import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFromEnv } from '../src/config';
import {
  createBillingAdapterRegistry,
  createBillingAdaptersFromConfig,
  isPaycenterBillingRegistered,
} from '../src/billing/registry';

/**
 * 统一支付中心的**运营者开关 + 凭证读取 + 注册条件**测试。
 *
 * 🔴 全程用**假的**凭证字符串：这里测的是"配不配得上 / 注册不注册"，
 * 与凭证真假无关。真实值绝不进仓库。
 */

const PAYCENTER_VARS = [
  'PAYCENTER_BASE_URL',
  'PAYCENTER_CLIENT_ID',
  'PAYCENTER_CLIENT_SECRET',
  'PAYCENTER_WEBHOOK_PATH',
  'PAYCENTER_TIMEOUT_MS',
  'PAYCENTER_PAYMENT_TYPE',
] as const;

const TOUCHED = ['PAYCENTER_ENABLED', 'PUBLIC_URL', 'NODE_ENV', ...PAYCENTER_VARS] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of TOUCHED) originalEnv[key] = process.env[key];

/** 假凭证。密钥 32 字节起。 */
const FULL: Record<string, string> = {
  PAYCENTER_BASE_URL: 'https://center.example.test',
  PAYCENTER_CLIENT_ID: 'heyta',
  PAYCENTER_CLIENT_SECRET: 'f'.repeat(48),
};

const setEnv = (values: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

describe('统一支付中心配置 + 注册条件', () => {
  beforeEach(() => {
    setEnv({ PUBLIC_URL: 'https://sync.example.test', NODE_ENV: 'test' });
    for (const key of ['PAYCENTER_ENABLED', ...PAYCENTER_VARS]) delete process.env[key];
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('🔴 默认（什么都不配）：config.paycenter 不存在，注册表里只有 noop', () => {
    const config = loadConfigFromEnv();
    expect(config.paycenter).toBeUndefined();

    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop']);
    // 自托管：中心 provider 解析不到 → 路由回 404，不落任何行。
    expect(registry.get('paycenter')).toBeUndefined();
    expect(isPaycenterBillingRegistered(config)).toBe(false);
  });

  it('PAYCENTER_ENABLED=false 与不配等价', () => {
    setEnv({ PAYCENTER_ENABLED: 'false', ...FULL });
    const config = loadConfigFromEnv();
    expect(config.paycenter).toBeUndefined();
    expect(isPaycenterBillingRegistered(config)).toBe(false);
  });

  it('配齐 → 注册，且 noop 之后多出 paycenter', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL });
    const config = loadConfigFromEnv();
    expect(config.paycenter?.baseUrl).toBe('https://center.example.test');
    expect(config.paycenter?.clientId).toBe('heyta');
    // 路径没给时用默认（签名要按它算）
    expect(config.paycenter?.webhookPath).toBe('/api/billing/webhooks/paycenter');

    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop', 'paycenter']);
    expect(registry.get('paycenter')?.provider).toBe('paycenter');
    expect(isPaycenterBillingRegistered(config)).toBe(true);
  });

  it('💰 声明只收 CNY（汇付聚合收人民币）', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL });
    const config = loadConfigFromEnv();
    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.get('paycenter')?.supportedCurrencies).toEqual(['CNY']);
  });

  it('baseUrl 去尾部斜杠（否则拼出来的路径会多一个 /）', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_BASE_URL: 'https://center.test///' });
    expect(loadConfigFromEnv().paycenter?.baseUrl).toBe('https://center.test');
  });

  it('PAYCENTER_ENABLED 取值非法 → 启动红（不静默落到任何一边）', () => {
    setEnv({ PAYCENTER_ENABLED: 'yes', ...FULL });
    expect(() => loadConfigFromEnv()).toThrow(/Invalid PAYCENTER_ENABLED/);
  });

  // 🔴 凭证不全必须是**启动期硬错误**：错拼一个变量名会让 adapter 悄悄不注册，
  //    而症状是"用户付了钱没权益" —— 收钱路径上最坏的一种静默。
  it('🔴 凭证不全 → 启动红，且报出缺的是哪一个', () => {
    for (const missing of Object.keys(FULL)) {
      setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, [missing]: undefined });
      expect(() => loadConfigFromEnv(), `缺 ${missing}`).toThrow(
        new RegExp(`Missing: .*${missing}`),
      );
    }
  });

  it('🔴 密钥不足 32 字节 → 启动红（与中心约定一致）', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_CLIENT_SECRET: 'short' });
    expect(() => loadConfigFromEnv()).toThrow(/PAYCENTER_CLIENT_SECRET: must be at least 32 bytes/);
  });

  it('🔴 webhookPath 不以 / 开头 → 启动红（签名按路径算，写错每条回调都 401）', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_WEBHOOK_PATH: 'api/webhooks/x' });
    expect(() => loadConfigFromEnv()).toThrow(/PAYCENTER_WEBHOOK_PATH must start with/);
  });

  it('webhookPath 可覆盖（换挂载点时必须同步，否则回调全 401）', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_WEBHOOK_PATH: '/custom/hook' });
    expect(loadConfigFromEnv().paycenter?.webhookPath).toBe('/custom/hook');
  });

  it('TIMEOUT_MS 非法 → 启动红；合法时原样带上', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_TIMEOUT_MS: 'abc' });
    expect(() => loadConfigFromEnv()).toThrow(/Invalid PAYCENTER_TIMEOUT_MS/);

    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_TIMEOUT_MS: '8000' });
    expect(loadConfigFromEnv().paycenter?.timeoutMs).toBe(8000);
  });

  it('paymentType 默认不存在（adapter 内部才落到 huifu），显式给了才带上', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL });
    expect(loadConfigFromEnv().paycenter?.paymentType).toBeUndefined();

    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL, PAYCENTER_PAYMENT_TYPE: 'huifu_alipay' });
    expect(loadConfigFromEnv().paycenter?.paymentType).toBe('huifu_alipay');
  });

  it('中心与微信互不影响：只配中心时微信仍然不注册', () => {
    setEnv({ PAYCENTER_ENABLED: 'true', ...FULL });
    const config = loadConfigFromEnv();
    expect(config.wechatPay).toBeUndefined();
    expect(createBillingAdapterRegistry(createBillingAdaptersFromConfig(config)).providers()).toEqual([
      'noop',
      'paycenter',
    ]);
  });
});
