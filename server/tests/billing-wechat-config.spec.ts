import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFromEnv } from '../src/config';
import {
  createBillingAdapterRegistry,
  createBillingAdaptersFromConfig,
} from '../src/billing/registry';

/**
 * 微信直连**已经去掉** —— 收单与退款统一走支付中心。
 *
 * 本文件钉的是**去掉之后**的行为，而不是删掉它：
 * 一个"配置项还在、但什么都不做"的开关是收钱路径上最坏的一种静默，
 * 所以这里要证明的是「**打开它就是启动红**」，以及「**它永远不会被注册**」。
 */

const WX_VARS = [
  'WX_APP_ID',
  'WX_MCH_ID',
  'WX_SERIAL_NO',
  'WX_API_V3_KEY',
  'WX_PRIVATE_KEY',
  'WX_PUBLIC_KEY',
  'WX_PRIVATE_KEY_PATH',
  'WX_PUBLIC_KEY_PATH',
  'WX_NOTIFY_URL',
  'WX_NOTIFY_URL_CONFIRM',
] as const;

const TOUCHED = ['WECHAT_PAY_ENABLED', 'PUBLIC_URL', 'NODE_ENV', ...WX_VARS] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of TOUCHED) originalEnv[key] = process.env[key];

/** 假的、但格式齐全的凭证。真实值绝不进仓库。 */
const FULL_CREDENTIALS: Record<string, string> = {
  WX_APP_ID: 'wx_test_appid',
  WX_MCH_ID: '1900000000',
  WX_SERIAL_NO: 'ABCDEF1234567890',
  WX_API_V3_KEY: 'a'.repeat(32),
  WX_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----',
  WX_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nFAKE\\n-----END PUBLIC KEY-----',
};

const setEnv = (values: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

describe('微信直连已去掉', () => {
  beforeEach(() => {
    setEnv({ PUBLIC_URL: 'https://sync.example.test', NODE_ENV: 'test' });
    for (const key of ['WECHAT_PAY_ENABLED', ...WX_VARS]) delete process.env[key];
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('默认：注册表里只有 noop', () => {
    const config = loadConfigFromEnv();
    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop']);
  });

  // 🔴 本文件最要紧的一条。静默忽略等于骗人：运营者以为那条路还在，
  //    而症状是"用户付了钱没权益"。
  it('🔴 WECHAT_PAY_ENABLED=true → **启动红**，且指出该换成什么', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'true', ...FULL_CREDENTIALS });
    expect(() => loadConfigFromEnv()).toThrow(/no longer supported/);
    // 报错里必须点出替代品，否则运维只知道坏了、不知道该改什么
    expect(() => loadConfigFromEnv()).toThrow(/PAYCENTER_ENABLED=true/);
  });

  // 凭证给全也**不能**让那条路回来 —— 否则"去掉"就只是一句注释。
  it('🔴 六个凭证齐全也照样启动红（去掉的是路，不是开关形状）', () => {
    for (const missing of Object.keys(FULL_CREDENTIALS)) {
      const partial = { ...FULL_CREDENTIALS };
      delete partial[missing];
      setEnv({ WECHAT_PAY_ENABLED: 'true', ...partial });
      expect(() => loadConfigFromEnv(), `缺 ${missing}`).toThrow(/no longer supported/);
    }
  });

  it('显式 false 与不设等价：只有 noop', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'false', ...FULL_CREDENTIALS });
    const config = loadConfigFromEnv();
    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop']);
    expect(registry.get('wechat')).toBeUndefined();
  });

  // 取值校验仍然有效：写错不该静默落到"关"。
  it('取值非法仍然启动红', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'yes', ...FULL_CREDENTIALS });
    expect(() => loadConfigFromEnv()).toThrow(/Invalid WECHAT_PAY_ENABLED/);
  });

  // 微信**没有**被注册 —— 未注册的 provider 一律 404（fail-closed）。
  it('🔴 任何时候都不注册 wechat', () => {
    for (const flag of ['false', undefined]) {
      setEnv({ WECHAT_PAY_ENABLED: flag, ...FULL_CREDENTIALS });
      const config = loadConfigFromEnv();
      const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
      expect(registry.get('wechat'), String(flag)).toBeUndefined();
    }
  });

  it('config 上不再有 wechatPay（没有东西能填它）', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'false', ...FULL_CREDENTIALS });
    expect(loadConfigFromEnv()).not.toHaveProperty('wechatPay');
  });
});
