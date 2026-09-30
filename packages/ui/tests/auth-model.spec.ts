/**
 * 认证纯逻辑测试（W8 收编的验收）
 * ================================
 *
 * 它钉住两件事：
 *
 *   1. **映射本身是对的** —— 每个已知原因落到正确的那条词条 key，
 *      认不出来的原因落到 `unknown`（**不崩、不编一句**）。
 *   2. 🔴 **它真的是"只有一份"** —— `apps/web` 与 `apps/mobile` 里
 *      **不许再各自定义一份映射**。这一条是源码级断言，
 *      因为"两份同一职责的实现"不会在任何行为测试里露出来
 *      （两边各自都对、就是不一样），只能查源码。
 *      ⚠️ 形状照 `scripts/check-row-single-source.mjs` 的思路：
 *      **断言一个不该出现的形状不存在**。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  STEPS_WITHOUT_TOKEN,
  authFailureMessageKey,
  hasTokenAfter,
  type AuthJourneyStep,
} from '../src/auth/model.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * `HostedAuthFailureReason` 的**全部 16 个成员**。
 *
 * 🔴 这里**硬编码**而不是 import `@heyta/app-host`：`packages/ui` 今天不依赖它
 * （见 `auth/model.ts` 文件头的说明），而且这份清单的价值恰恰在于**它是一份快照** ——
 * app-host 将来新增一个 reason 时，这条测试**不会自动跟着变**，
 * 于是有人会来看一眼"新原因该说什么话"。自动跟随反而会漏掉那个决定。
 */
const ALL_REASONS = [
  'unconfigured',
  'invalid-input',
  'not-allowed',
  'unauthorized',
  'rate-limited',
  'request-rejected',
  'network',
  'server-error',
  'malformed-response',
  'passkey-unsupported',
  'passkey-cancelled',
  'passkey-already-registered',
  'passkey-not-found',
  'passkey-rejected',
  'last-passkey',
  'passkey-name-too-long',
] as const;

describe('authFailureMessageKey —— 原因 → 词条 key', () => {
  it('每个已知原因都落到**具体**的那一条（不是笼统的 unknown）', () => {
    const expected: Record<string, string> = {
      unconfigured: 'common.auth.error.unconfigured',
      'invalid-input': 'common.auth.error.invalidInput',
      'not-allowed': 'common.auth.error.notAllowed',
      unauthorized: 'common.auth.error.unauthorized',
      'rate-limited': 'common.auth.error.rateLimited',
      network: 'common.auth.error.network',
      'server-error': 'common.auth.error.server',
      'passkey-unsupported': 'common.auth.error.passkeyUnsupported',
      'passkey-cancelled': 'common.auth.error.passkeyCancelled',
      'passkey-already-registered': 'common.auth.error.passkeyAlreadyRegistered',
      'passkey-not-found': 'common.auth.error.passkeyNotFound',
      'passkey-rejected': 'common.auth.error.passkeyRejected',
      'last-passkey': 'common.auth.error.lastPasskey',
    };
    for (const [reason, key] of Object.entries(expected)) {
      expect(authFailureMessageKey(reason), reason).toBe(key);
    }
  });

  it('🔴 全部 16 个原因都不会崩，且返回的永远是 `common.auth.error.*`', () => {
    for (const reason of ALL_REASONS) {
      const key = authFailureMessageKey(reason);
      expect(key, reason).toMatch(/^common\.auth\.error\./);
    }
  });

  it('认不出来 / 没给原因 → unknown（**不编一句**）', () => {
    expect(authFailureMessageKey(undefined)).toBe('common.auth.error.unknown');
    expect(authFailureMessageKey('')).toBe('common.auth.error.unknown');
    expect(authFailureMessageKey('some-future-reason')).toBe('common.auth.error.unknown');
  });

  it('`malformed-response` 归到 unknown —— 这是**有意的合并**，不是漏了', () => {
    // 它意味着"服务端回了 2xx 但响应体读不懂"，用户能做的与 server-error 完全一样。
    // 钉住它，免得将来有人以为这是漏项而补一条重复语义的词条。
    expect(authFailureMessageKey('malformed-response')).toBe('common.auth.error.unknown');
  });

  it('两条 passkey 错误**必须是不同的 key**（它们要用户做相反的事）', () => {
    // passkey-not-found ⇒ 重新注册一条；passkey-rejected ⇒ 再试一次。
    // 合并成一句就会让"该重新注册的人一直重试"。
    expect(authFailureMessageKey('passkey-not-found')).not.toBe(
      authFailureMessageKey('passkey-rejected'),
    );
  });
});

describe('旅程步骤 —— 把服务端的真实语义变成有类型的步骤', () => {
  it('🔴 注册与验证邮箱**拿不到令牌**（服务端那两条端点只回 `{message}`）', () => {
    expect(STEPS_WITHOUT_TOKEN).toContain('register');
    expect(STEPS_WITHOUT_TOKEN).toContain('verify-email');
    expect(hasTokenAfter('register')).toBe(false);
    expect(hasTokenAfter('verify-email')).toBe(false);
    expect(hasTokenAfter('identify')).toBe(false);
  });

  it('登录是**唯一**开始有令牌的落点', () => {
    expect(hasTokenAfter('login')).toBe(true);
    // 而"注册"是它前面那一步，不是替代品
    expect(hasTokenAfter('register')).toBe(false);
  });

  it('每个步骤要么在有令牌之前、要么之后 —— 没有第三种', () => {
    const steps: AuthJourneyStep[] = [
      'identify',
      'register',
      'verify-email',
      'login',
      'set-passphrase',
      'ready',
    ];
    for (const step of steps) {
      const without = STEPS_WITHOUT_TOKEN.includes(step);
      expect(hasTokenAfter(step), step).toBe(!without);
    }
  });
});

describe('🔴 "只有一份"的机器保证（源码级）', () => {
  /**
   * 两个壳里**都不许**再出现自己的"原因 → key"映射。
   *
   * 断言的是**一个不该存在的形状**：出现 `'web.auth.error.'` / `'mobile.auth.error.'`
   * 字样、或出现一个叫 `authFailureKey` 的本地函数定义。
   */
  const FORBIDDEN: ReadonlyArray<{ file: string; patterns: readonly RegExp[] }> = [
    {
      file: 'apps/web/src/features/auth/AuthPanel.tsx',
      patterns: [/'web\.auth\.error\./, /function authFailureKey\b/],
    },
    {
      file: 'apps/mobile/src/auth/failure-key.ts',
      patterns: [/'mobile\.auth\.error\./, /'web\.auth\.error\./],
    },
  ];

  for (const { file, patterns } of FORBIDDEN) {
    it(`${file} 不再自己维护一份映射`, () => {
      let src: string;
      try {
        src = readFileSync(join(REPO, file), 'utf8');
      } catch {
        // 文件不存在（例如移动端那份已被删）—— 那正是收编成功的样子。
        return;
      }
      for (const pattern of patterns) {
        expect(src, `${file} 命中了 ${pattern}`).not.toMatch(pattern);
      }
    });
  }

  it('web 的 AuthPanel 真的改用了共享的那一份', () => {
    const src = readFileSync(join(REPO, 'apps/web/src/features/auth/AuthPanel.tsx'), 'utf8');
    expect(src).toContain('authFailureMessageKey');
    expect(src).toMatch(/from '@heyta\/ui'/);
  });
});