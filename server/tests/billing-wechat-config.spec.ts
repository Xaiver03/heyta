import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
  'WX_PRIVATE_KEY_PATH',
  'WX_PUBLIC_KEY_PATH',
  'WX_NOTIFY_URL',
  'WX_NOTIFY_URL_CONFIRM',
] as const;

const TOUCHED = ['WECHAT_PAY_ENABLED', 'PUBLIC_URL', 'NODE_ENV', ...WX_VARS] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of TOUCHED) originalEnv[key] = process.env[key];

const FAKE_PRIVATE_PEM = '-----BEGIN PRIVATE KEY-----\nFAKE-PRIVATE\n-----END PRIVATE KEY-----\n';
const FAKE_PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nFAKE-PUBLIC\n-----END PUBLIC KEY-----\n';

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

/** 测试自己造的 PEM 文件目录（只在本用例内读写，不留给第二轮）。 */
const makeKeyDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-wx-keys-'));

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

  it('WX_NOTIFY_URL 优先于推导值（同 host 换路径，不需要跨 host 确认）', () => {
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_NOTIFY_URL: 'https://sync.example.test/hooks/wechat',
    });
    expect(loadConfigFromEnv().wechatPay?.notifyUrl).toBe(
      'https://sync.example.test/hooks/wechat',
    );
  });

  it('🔴 回调 host 与 PUBLIC_URL 不同 → 启动期报错（钱的消息不许送去别的实例的库）', () => {
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_NOTIFY_URL: 'https://pay.example.test/hooks/wechat',
    });
    expect(() => loadConfigFromEnv()).toThrow(/host/i);
  });

  it('跨 host 但有显式确认 → 放行（运维确实要独立支付域名时不至于卡死）', () => {
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_NOTIFY_URL: 'https://pay.example.test/hooks/wechat',
      WX_NOTIFY_URL_CONFIRM: 'host-mismatch-is-intentional',
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

  it('🔴 只用 _PATH（复用另一套部署的证书文件）→ 读到内容并注册成功', () => {
    const dir = makeKeyDir();
    const priv = path.join(dir, 'apiclient_key.pem');
    const pub = path.join(dir, 'wechat_public_key.pem');
    fs.writeFileSync(priv, FAKE_PRIVATE_PEM);
    fs.writeFileSync(pub, FAKE_PUBLIC_PEM);

    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      WX_APP_ID: FULL_CREDENTIALS.WX_APP_ID,
      WX_MCH_ID: FULL_CREDENTIALS.WX_MCH_ID,
      WX_SERIAL_NO: FULL_CREDENTIALS.WX_SERIAL_NO,
      WX_API_V3_KEY: FULL_CREDENTIALS.WX_API_V3_KEY,
      WX_PRIVATE_KEY_PATH: priv,
      WX_PUBLIC_KEY_PATH: pub,
    });

    const config = loadConfigFromEnv();
    expect(config.wechatPay?.privateKey).toContain('FAKE-PRIVATE');
    expect(config.wechatPay?.publicKey).toContain('FAKE-PUBLIC');
    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(config));
    expect(registry.providers()).toEqual(['noop', 'wechat']);
  });

  it('内联写法与 _PATH 内容一致（转义换行 vs 真换行）→ 放行', () => {
    const dir = makeKeyDir();
    const priv = path.join(dir, 'apiclient_key.pem');
    fs.writeFileSync(priv, FAKE_PRIVATE_PEM);

    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_PRIVATE_KEY: FAKE_PRIVATE_PEM.replace(/\n/g, '\\n'),
      WX_PRIVATE_KEY_PATH: priv,
    });
    expect(loadConfigFromEnv().wechatPay?.privateKey).toContain('FAKE-PRIVATE');
  });

  it('🔴 内联与 _PATH 内容不一致 → 启动红，且**错误消息里没有密钥内容**', () => {
    const dir = makeKeyDir();
    const priv = path.join(dir, 'apiclient_key.pem');
    fs.writeFileSync(priv, FAKE_PRIVATE_PEM);

    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_PRIVATE_KEY_PATH: priv,
    });

    let message = '';
    try {
      loadConfigFromEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/WX_PRIVATE_KEY_PATH/);
    expect(message).toContain(priv);
    // 报错只报键名与路径。把密钥值写进错误消息 = 它会被记进日志。
    expect(message).not.toContain('FAKE-PRIVATE');
  });

  it('🔴 _PATH 指向读不出的文件 → 启动红并带路径（不许带着空密钥注册）', () => {
    const missing = path.join(makeKeyDir(), 'nope.pem');
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_PRIVATE_KEY_PATH: missing,
    });
    expect(() => loadConfigFromEnv()).toThrow(/读不出来/);
  });

  it('🔴 _PATH 指向的不是 PEM → 启动红（配了个 README 也要当场说）', () => {
    const dir = makeKeyDir();
    const notPem = path.join(dir, 'notes.txt');
    fs.writeFileSync(notPem, '这里什么都没有\n');
    setEnv({
      WECHAT_PAY_ENABLED: 'true',
      ...FULL_CREDENTIALS,
      WX_PUBLIC_KEY_PATH: notPem,
    });
    expect(() => loadConfigFromEnv()).toThrow(/没有 PEM/);
  });

  it('注册表是 fail-closed 的：没注册的 provider 解析为 undefined', () => {
    const registry = createBillingAdapterRegistry(createBillingAdaptersFromConfig(loadConfigFromEnv()));
    expect(registry.get('wechat')).toBeUndefined();
    expect(registry.get('paddle')).toBeUndefined();
  });
});