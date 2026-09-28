/**
 * `/api/push/*` 的校验与配置闸门。
 * ================================
 *
 * 这个文件测的不是"路由能返回 200"，而是两件**只有这里能挡住**的事：
 *
 * 1. **能力 URL 不能泄漏进报错**。`endpoint` 是能力凭据，
 *    而"校验失败时把原值抄进 message"是最自然、也最容易写出来的错误 ——
 *    这条路径上的错误信息会进客户端、进日志、进错误上报。
 * 2. **配置不全必须启动期就炸**。缺一个变量而静默降级，会变成一个
 *    "看起来配了但发不出"的通道，症状是"组件有时候更新有时候不更新"。
 */

import { describe, expect, it } from 'vitest';

import { loadConfigFromEnv } from '../src/config';
import {
  decodeField,
  PUSH_AUTH_BYTES,
  PUSH_P256DH_BYTES,
  validateEndpoint,
} from '../src/push/push.routes';

const key65 = Buffer.alloc(65, 7).toString('base64url');
const key16 = Buffer.alloc(16, 3).toString('base64url');

describe('validateEndpoint', () => {
  it('https 的绝对 URL 通过', () => {
    expect(validateEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toEqual({
      ok: true,
    });
  });

  it('🔴 http 也通过 —— heyta 可自托管，本地推送服务走 http', () => {
    // 只允许 https 会把自托管用户整条路堵死，而报错会落在一个看不出原因的 400 上。
    expect(validateEndpoint('http://127.0.0.1:8090/push/abc')).toEqual({ ok: true });
  });

  it('不是 URL 时拒绝', () => {
    expect(validateEndpoint('not a url')).toMatchObject({ ok: false });
    expect(validateEndpoint('example.com/push')).toMatchObject({ ok: false });
  });

  it('非 http(s) 协议时拒绝，且报错里说的是协议', () => {
    const result = validateEndpoint('ftp://example.com/x');
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toMatch(/协议/);
  });

  it('空串 / 非字符串时拒绝', () => {
    expect(validateEndpoint('')).toMatchObject({ ok: false });
    expect(validateEndpoint(undefined)).toMatchObject({ ok: false });
    expect(validateEndpoint(123)).toMatchObject({ ok: false });
  });

  /**
   * 🔴 **本文件最重要的一条。**
   *
   * `endpoint` 是能力 URL。校验失败时把原值抄进 message 是最自然的写法，
   * 而那条 message 会进客户端、进日志、进错误上报 —— 等于把凭据散出去。
   */
  it('🔴 报错里绝不包含 endpoint 的原值', () => {
    const secretish = 'https://push.example/very-secret-capability-token-xyz';
    // 用一个**协议不合法**的变体触发报错，原值仍然带着那个 token。
    const bad = secretish.replace('https://', 'ftp://');
    const result = validateEndpoint(bad);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).not.toContain('very-secret-capability-token-xyz');
    expect(result.ok === false && result.message).not.toContain('push.example');
  });
});

describe('decodeField', () => {
  it('长度正确时通过', () => {
    expect(decodeField('p256dh', key65, PUSH_P256DH_BYTES)).toEqual({ ok: true, bytes: 65 });
    expect(decodeField('auth', key16, PUSH_AUTH_BYTES)).toEqual({ ok: true, bytes: 16 });
  });

  it('🔴 长度不对时报错带**字段名**（否则只能猜是哪个字段坏了）', () => {
    const a = decodeField('p256dh', key16, PUSH_P256DH_BYTES);
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.message).toMatch(/^p256dh /);
    expect(a.ok === false && a.message).toMatch(/65 字节，收到 16/);

    const b = decodeField('auth', key65, PUSH_AUTH_BYTES);
    expect(b.ok === false && b.message).toMatch(/^auth /);
  });

  /**
   * 🔴 `Buffer.from(x, 'base64url')` **不抛** —— 它对非法字符是静默处理的。
   * 所以不能靠 try/catch 判断"是不是合法 base64url"，必须回编码一次比对。
   */
  it('🔴 不是合法 base64url 时拒绝 —— 靠回编码比对，不是靠 try/catch', () => {
    // 这个值能解出**非零长度**，所以单纯的长度检查会给出一条误导性的报错。
    const notB64 = '!!!!not-base64!!!!';
    const result = decodeField('p256dh', notB64, PUSH_P256DH_BYTES);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/不是合法的 base64url/);
  });

  it('带 padding 的 base64 会被判成非法 base64url（浏览器给的一定没有 padding）', () => {
    const withPadding = `${Buffer.alloc(65, 7).toString('base64')}`;
    // Node 的标准 base64 一定带 `=`，而 base64url 不带。
    expect(withPadding).toContain('=');
    const result = decodeField('p256dh', withPadding, PUSH_P256DH_BYTES);
    expect(result.ok).toBe(false);
  });

  it('空串与非字符串时拒绝', () => {
    expect(decodeField('auth', '', 16)).toMatchObject({ ok: false });
    expect(decodeField('auth', undefined, 16)).toMatchObject({ ok: false });
    expect(decodeField('auth', {}, 16)).toMatchObject({ ok: false });
  });

  it('🔴 报错里不含字段的原值', () => {
    const result = decodeField('auth', 'super-secret-value-abc', PUSH_AUTH_BYTES);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).not.toContain('super-secret-value-abc');
  });
});

describe('🔴 配置闸门：不全就启动期炸，不静默降级', () => {
  const KEYS = [
    'WEB_PUSH_ENABLED',
    'WEB_PUSH_VAPID_PUBLIC_KEY',
    'WEB_PUSH_VAPID_PRIVATE_KEY',
    'WEB_PUSH_VAPID_SUBJECT',
  ] as const;

  function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, run: () => void): void {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, env);
    try {
      run();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it('不设 WEB_PUSH_ENABLED 时没有 webPush（自托管默认形态）', () => {
    withEnv({}, () => {
      expect(loadConfigFromEnv().webPush).toBeUndefined();
    });
  });

  it('三个变量齐全时填出 webPush', () => {
    withEnv(
      {
        WEB_PUSH_ENABLED: 'true',
        WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
        WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
        WEB_PUSH_VAPID_SUBJECT: 'mailto:a@b.c',
      },
      () => {
        expect(loadConfigFromEnv().webPush).toEqual({
          publicKey: 'pub',
          privateKey: 'priv',
          subject: 'mailto:a@b.c',
        });
      },
    );
  });

  it('🔴 ENABLED 但缺变量时**抛**，而不是静默降级', () => {
    withEnv({ WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: 'pub' }, () => {
      expect(() => loadConfigFromEnv()).toThrow(/WEB_PUSH_VAPID_PRIVATE_KEY/);
    });
  });

  it('🔴 报错里点名**所有**缺失的变量（一次配全，而不是一个个试）', () => {
    withEnv({ WEB_PUSH_ENABLED: 'true' }, () => {
      try {
        loadConfigFromEnv();
        throw new Error('应该抛');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        expect(message).toContain('WEB_PUSH_VAPID_PUBLIC_KEY');
        expect(message).toContain('WEB_PUSH_VAPID_PRIVATE_KEY');
        expect(message).toContain('WEB_PUSH_VAPID_SUBJECT');
        // ⚠️ 报错要告诉人**怎么修**，而不是只说"缺东西"。
        expect(message).toMatch(/gen-vapid-keys\.mjs|删掉 WEB_PUSH_ENABLED/);
      }
    });
  });

  it('🔴 空白（只有空格）也算缺失 —— 不能把 "  " 当成配好了', () => {
    withEnv(
      {
        WEB_PUSH_ENABLED: 'true',
        WEB_PUSH_VAPID_PUBLIC_KEY: 'pub',
        WEB_PUSH_VAPID_PRIVATE_KEY: 'priv',
        WEB_PUSH_VAPID_SUBJECT: '   ',
      },
      () => {
        expect(() => loadConfigFromEnv()).toThrow(/WEB_PUSH_VAPID_SUBJECT/);
      },
    );
  });

  it('ENABLED=false 时不存在（不是"存在但为假"）', () => {
    withEnv({ WEB_PUSH_ENABLED: 'false' }, () => {
      expect(loadConfigFromEnv().webPush).toBeUndefined();
    });
  });
});
