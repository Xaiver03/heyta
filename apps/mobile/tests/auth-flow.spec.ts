/**
 * 移动端认证旅程的可测部分（W3）
 * ================================
 *
 * 🔴 这个文件**刻意不渲染任何 React 组件** —— 与 `tests/widget-bridge.spec.ts`
 * 同一条纪律：本仓库的移动端测试不 import `react-native`（在 node 里加载直接失败）。
 * 所以这里验的全是从屏幕里抽出来的**纯逻辑**，它们恰好也是这趟旅程里
 * 最会出错、而且出错后**不会报错**的那几处：
 *
 *   1. `redeemPastedAuthToken` —— "先当登录令牌试、不成立再当验证令牌试"，
 *      顺序或条件写错会让**登录令牌**被当成验证令牌，用户白跑一圈；
 *   2. `saveAuthSession` —— 会话必须落进活配置，否则界面显示已登录、
 *      同步却说未配置；
 *   3. `resolvePasskeyProvider` —— 这台设备今天没有通行密钥实现，
 *      它必须返回 `undefined`（→ `passkey-unsupported`），**不是**一个会失败的假实现。
 *   4. `device-prefs` —— 契约是"永不抛"，而且**写不进去要说出来**。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { redeemPastedAuthToken } from '../src/auth/paste';
import { describePasskeyError, resolvePasskeyProvider } from '../src/auth/passkey-host';
import {
  currentSignedInEmail,
  forgetSignedInUser,
  saveAuthSession,
} from '../src/auth/session';
import { readSyncConfig, clearSyncConfig } from '../src/sync/config';
import {
  hasSeenWelcome,
  markWelcomeSeen,
  PREF_KEY_WELCOME_SEEN,
  readDevicePref,
  resetDevicePrefsCacheForTests,
  writeDevicePref,
} from '../src/prefs/device-prefs';

// 🔴 这里**故意没有**「失败原因 → 词条 key」那一组测试，也没 import `@heyta/ui`。
//
//    那条映射已经收进共享层（`packages/ui/src/auth/model.ts`），它的测试在
//    `packages/ui/tests/auth-model.spec.ts`。而 `@heyta/ui` 的入口会带进
//    `react-native`（本仓库的移动端测试**刻意不 import 它** —— node 里加载直接失败，
//    实测报的是一个 Flow 语法的 parse error，指向 RN 的 copyright 头）。
//    所以这一层只测**本壳自己的**逻辑；跨端共用的那份由共享层的套件管。

afterEach(() => {
  clearSyncConfig();
  forgetSignedInUser();
  resetDevicePrefsCacheForTests();
  vi.restoreAllMocks();
});

describe('redeemPastedAuthToken', () => {
  const session = { token: 'jwt-1', user: { id: 7, email: 'a@b.c' } };

  it('完整链接里的令牌会被抽出来', async () => {
    const seen: string[] = [];
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async (token) => {
          seen.push(token);
          return { ok: true, session };
        },
        verifyEmailToken: async () => ({ ok: true }),
      },
      'https://example.com/magic-login?token=abc123',
    );
    expect(outcome).toEqual({ kind: 'session', session });
    expect(seen).toEqual(['abc123']);
  });

  it('裸令牌也能用（用户直接复制那串十六进制）', async () => {
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async (token) => ({ ok: true, session: { ...session, token } }),
        verifyEmailToken: async () => ({ ok: true }),
      },
      '  deadbeef  ',
    );
    expect(outcome.kind === 'session' && outcome.session.token).toBe('deadbeef');
  });

  it('抽不出令牌时**一个探针都不调**（不制造无意义的往返）', async () => {
    const login = vi.fn();
    const email = vi.fn();
    // ⚠️ 用"像一个链接但没有 token 参数"的输入，而不是一句中文：
    //    `extractAuthLinkToken` 对**不含空白**的裸串一律当令牌（那是正确的 ——
    //    邮件里的令牌本身就是一串十六进制），所以中文句子会被当成令牌传下去，
    //    测不到"不发请求"这件事。
    const outcome = await redeemPastedAuthToken(
      { verifyLoginToken: login, verifyEmailToken: email },
      'https://example.com/login?user=me',
    );
    expect(outcome).toEqual({ kind: 'failed', reason: 'invalid-input' });
    expect(login).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  });

  it('登录令牌不认时**才**去试验证令牌；验证成功 = email-verified（仍然没有令牌）', async () => {
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async () => ({ ok: false, reason: 'unauthorized' }),
        verifyEmailToken: async () => ({ ok: true }),
      },
      'verify-token',
    );
    expect(outcome).toEqual({ kind: 'email-verified' });
  });

  it('🔴 网络失败**不**去试第二种：那不是"令牌类型不对"', async () => {
    const email = vi.fn();
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async () => ({ ok: false, reason: 'network' }),
        verifyEmailToken: email,
      },
      'whatever',
    );
    expect(outcome).toEqual({ kind: 'failed', reason: 'network' });
    expect(email).not.toHaveBeenCalled();
  });

  it('两种都不是时，报**登录**那一次的原因（用户的本意是登录）', async () => {
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async () => ({ ok: false, reason: 'unauthorized' }),
        verifyEmailToken: async () => ({ ok: false, reason: 'invalid-input' }),
      },
      'nope',
    );
    expect(outcome).toEqual({ kind: 'failed', reason: 'unauthorized' });
  });
});

describe('saveAuthSession', () => {
  it('把地址 / 令牌 / 口令写进活配置，并记住邮箱', () => {
    const saved = saveAuthSession({
      serverUrl: ' http://10.0.2.2:3000 ',
      token: ' tok ',
      password: 'pw',
      email: ' me@example.com ',
    });
    expect(saved).toEqual({
      serverUrl: 'http://10.0.2.2:3000',
      token: 'tok',
      password: 'pw',
    });
    expect(readSyncConfig()).toEqual({
      serverUrl: 'http://10.0.2.2:3000',
      token: 'tok',
      password: 'pw',
    });
    expect(currentSignedInEmail()).toBe('me@example.com');
  });

  it('口令为空时**不写** password 字段（那是"没填"，不是"空口令"）', () => {
    saveAuthSession({ serverUrl: 'http://x', token: 'tok', password: '', email: 'a@b.c' });
    expect(readSyncConfig()).toEqual({ serverUrl: 'http://x', token: 'tok' });
  });

  it('清除凭据后邮箱也忘掉（不许留下"已登录"的假象）', () => {
    saveAuthSession({ serverUrl: 'http://x', token: 'tok', password: 'p', email: 'a@b.c' });
    expect(currentSignedInEmail()).toBe('a@b.c');
    forgetSignedInUser();
    expect(currentSignedInEmail()).toBeUndefined();
  });
});

describe('通行密钥的平台一半', () => {
  it('这台设备没有实现 → undefined（调用方据此判 passkey-unsupported，一个请求都不发）', () => {
    expect(resolvePasskeyProvider()).toBeUndefined();
  });

  it('平台异常的翻译：取消 / 已存在 / 断言没过是三句不同的话', () => {
    expect(describePasskeyError({ name: 'InvalidStateError' })).toBe(
      'passkey-already-registered',
    );
    expect(describePasskeyError({ name: 'NotAllowedError' })).toBe('passkey-cancelled');
    expect(describePasskeyError({ name: 'AbortError' })).toBe('passkey-cancelled');
    expect(describePasskeyError(new Error('boom'))).toBe('passkey-rejected');
    // 形状完全不对的异常也不能让它抛出去。
    expect(describePasskeyError(null)).toBe('passkey-rejected');
  });
});

describe('设备本地偏好（node 里 op-sqlite 不在）', () => {
  it('读不到就是 undefined / false —— 宁可多显示一次欢迎页，也不静默跳过', () => {
    expect(readDevicePref(PREF_KEY_WELCOME_SEEN)).toBeUndefined();
    expect(hasSeenWelcome()).toBe(false);
  });

  it('写不进去返回 false（调用方必须说出来），且**永不抛**', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(writeDevicePref(PREF_KEY_WELCOME_SEEN, '1')).toBe(false);
    expect(markWelcomeSeen()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
