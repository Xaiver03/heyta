import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFromEnv } from '../src/config';
import {
  createBillingAdapterRegistry,
  createBillingAdaptersFromConfig,
  isWechatBillingRegistered,
} from '../src/billing/registry';

/**
 * 微信支付的**运营者开关 + 凭证读取 + 注册条件**测试。
 *
 * 🔴 全程用**假的**凭证字符串：这里测的是"配不配得上 / 注册不注册"，
 * 与凭证真假无关。真实值绝不进仓库（`docs/plans/subscription-boundary.md` §6.5）。
 */

const WX_VARS = [
  'WX_APP_ID',
  'WX_MCH_ID',
  'WX_SERIAL_NO',
  'WX_API_V3_KEY',
  'WX_PRIVATE_KEY',
  'WX_PUBLIC_KEY',
  'WX_NOTIFY_URL',
] as const;

const TOUCHED = ['WECHAT_PAY_ENABLED', 'PUBLIC_URL', 'NODE_ENV', ...WX_VARS] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of TOUCHED) originalEnv[key] = process.env[key];

const FULL_CREDENTIALS: Record<string, string> = {
  WX_APP_ID: 'wx_test_appid',
  WX_MCH_ID: '1900000000',
  WX_SERIAL_NO: 'ABCDEF1234567890',
  // 32 个 ASCII 字节。
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

describe('微信支付配置 + 注册条件', () => {
  beforeEach(() => {
    setEnv({ PUBLIC_URL: 'https://sync.example.test', NODE_ENV: 'test' });
    for (const key of ['WECHAT_PAY_ENABLED', ...WX_VARS]) delete process.env[key];
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('🔴 默认（什么都不配）：config.wechatPay 不存在，注册表里只有 noop', () => {
    const config = loadConfigFromEnv();
    expect(config.wechatPay).toBeUndefined();

    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop']);
    // 自托管：微信 provider 解析不到 → 路由回 404，不落任何行。
    expect(registry.get('wechat')).toBeUndefined();
    expect(isWechatBillingRegistered(config)).toBe(false);
  });

  it('显式 false：凭证哪怕齐全也不注册（开关就是开关）', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'false', ...FULL_CREDENTIALS });
    const config = loadConfigFromEnv();
    expect(config.wechatPay).toBeUndefined();
    expect(isWechatBillingRegistered(config)).toBe(false);
  });

  it('显式 true + 六个凭证齐全 → 注册 wechat，notifyUrl 由 PUBLIC_URL 推导', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'true', ...FULL_CREDENTIALS });
    const config = loadConfigFromEnv();

    expect(config.wechatPay).toMatchObject({
      appId: 'wx_test_appid',
      mchId: '1900000000',
      serialNo: 'ABCDEF1234567890',
      apiV3Key: 'a'.repeat(32),
      notifyUrl: 'https://sync.example.test/api/billing/webhooks/wechat',
    });

    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop', 'wechat']);
    expect(registry.get('wechat')?.provider).toBe('wechat');
    expect(isWechatBillingRegistered(config)).toBe(true);
  });

  it('WX_NOTIFY_URL 优先于推导值', () => {
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_NOTIFY_URL: 'https://pay.example.test/hooks/wechat',
    });
    expect(loadConfigFromEnv().wechatPay?.notifyUrl).toBe(
      'https://pay.example.test/hooks/wechat',
    );
  });

  it('🔴 开关打开但缺一个凭证 → 启动期硬错误，报出缺的名字', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'true', ...FULL_CREDENTIALS });
    delete process.env.WX_PUBLIC_KEY;

    expect(() => loadConfigFromEnv()).toThrow(/WX_PUBLIC_KEY/);
  });

  it('🔴 开关取值不是 true/false → 报错（不静默变成关闭）', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'yes', ...FULL_CREDENTIALS });
    expect(() => loadConfigFromEnv()).toThrow(/WECHAT_PAY_ENABLED/);
  });

  it('🔴 APIv3 密钥不是 32 字节 → 启动期报错（不等到第一条回调才失败）', () => {
    setEnv({ WECHAT_PAY_ENABLED: 'true', ...FULL_CREDENTIALS, WX_API_V3_KEY: 'short' });
    expect(() => loadConfigFromEnv()).toThrow(/32/);
  });

  it('🔴 notify_url 不是 https → 启动期报错（微信拒绝非 HTTPS 回调）', () => {
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_NOTIFY_URL: 'http://sync.example.test/api/billing/webhooks/wechat',
    });
    expect(() => loadConfigFromEnv()).toThrow(/https/i);
  });

  it('PUBLIC_URL 是 http 且没有 WX_NOTIFY_URL → 报错，而不是注册一个微信收不到的回调', () => {
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      PUBLIC_URL: 'http://localhost:1900',
    });
    expect(() => loadConfigFromEnv()).toThrow(/https/i);
  });

  it('注册表是 fail-closed 的：没注册的 provider 解析为 undefined', () => {
    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(loadConfigFromEnv()));
    expect(registry.get('wechat')).toBeUndefined();
    expect(registry.get('paddle')).toBeUndefined();
  });
});