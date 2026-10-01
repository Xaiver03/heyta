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
  AUTH_EMAIL_AUTOCOMPLETE,
  AUTH_TERMS_REQUIRED_KEY,
  E2EE_PASSPHRASE_LABEL_KEY,
  SIGN_IN_PASSWORD_LABEL_KEY,
  STEPS_WITHOUT_TOKEN,
  authFailureMessageKey,
  authFormStageAfterContinue,
  defaultPasswordRevealed,
  firstAuthErrorField,
  hasTokenAfter,
  passwordAutocomplete,
  passwordPolicyMessageKey,
  policyMentionsMax,
  type AuthJourneyStep,
} from '../src/auth/model.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * 词条表里**真的**有这一条吗（直接读两张表的源码）。
 *
 * 🔴 为什么用源码而不是 import `@heyta/i18n`：`packages/ui` 不许依赖它
 * （会拖进第二份 React —— 理由写在 `auth/model.ts` 文件头）。
 * 而这条检查要的恰好是"key 与词条表之间的一致性"，读文本是最直接的做法。
 *
 * 匹配的是 `'key':` 这种行首词条形状 —— 与 `check:ui-language` 那个解析器同一形态。
 */
function localeHasKey(locale: 'zh-CN' | 'en', key: string): boolean {
  const src = readFileSync(
    join(REPO, 'packages/i18n/src/locales', `${locale}.ts`),
    'utf8',
  );
  return src.includes(`'${key}':`);
}

/**
 * `HostedAuthFailureReason` 的**全部成员**。
 *
 * 🔴 这里**硬编码**而不是 import `@heyta/app-host`：`packages/ui` 今天不依赖它
 * （见 `auth/model.ts` 文件头的说明），而且这份清单的价值恰恰在于**它是一份快照** ——
 * app-host 将来新增一个 reason 时，这条测试**不会自动跟着变**，
 * 于是有人会来看一眼"新原因该说什么话"。自动跟随反而会漏掉那个决定。
 *
 * ⚠️ 快照会过期，所以它**不能只用来"遍历一遍不崩"**：见下面那条
 * "每个已知原因都落到具体的那一条"。那条断言的存在就是为了让
 * "原因落进 `unknown`"这件事在**测试里**而不是**在用户面前**现形 ——
 * 2026-10-01 实测：`request-rejected` 与 `passkey-name-too-long` 早就在这份
 * 快照里，却**一直**返回 `unknown`，而上面的遍历全绿（`unknown` 也匹配那个正则）。
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
  // 邮箱 + 口令这一条路（ADR-0040）带来的八条。
  'invalid-credentials',
  'email-not-verified',
  'password-locked',
  'password-backend-busy',
  'invalid-reset-link',
  'no-password-set',
  // 与上一条互为反面（账号**已经有**口令 ⇒ 该摆"修改密码"那张表）。
  'password-already-set',
  'password-policy',
] as const;

/** 🔴 刻意落到 `unknown` 的那些（每条都要有一句理由，写在 model.ts 里）。 */
const REASONS_MERGED_INTO_UNKNOWN = new Set(['malformed-response']);

describe('authFailureMessageKey —— 原因 → 词条 key', () => {
  it('每个已知原因都落到**具体**的那一条（不是笼统的 unknown）', () => {
    const expected: Record<string, string> = {
      unconfigured: 'common.auth.error.unconfigured',
      'invalid-input': 'common.auth.error.invalidInput',
      'not-allowed': 'common.auth.error.notAllowed',
      unauthorized: 'common.auth.error.unauthorized',
      'rate-limited': 'common.auth.error.rateLimited',
      'request-rejected': 'common.auth.error.requestRejected',
      network: 'common.auth.error.network',
      'server-error': 'common.auth.error.server',
      'passkey-unsupported': 'common.auth.error.passkeyUnsupported',
      'passkey-cancelled': 'common.auth.error.passkeyCancelled',
      'passkey-already-registered': 'common.auth.error.passkeyAlreadyRegistered',
      'passkey-not-found': 'common.auth.error.passkeyNotFound',
      'passkey-rejected': 'common.auth.error.passkeyRejected',
      'last-passkey': 'common.auth.error.lastPasskey',
      'passkey-name-too-long': 'common.auth.error.passkeyNameTooLong',
      'invalid-credentials': 'common.auth.error.invalidCredentials',
      'email-not-verified': 'common.auth.error.emailNotVerified',
      'password-locked': 'common.auth.error.passwordLocked',
      'password-backend-busy': 'common.auth.error.passwordBackendBusy',
      'invalid-reset-link': 'common.auth.error.invalidResetLink',
      'no-password-set': 'common.auth.error.noPasswordSet',
      'password-already-set': 'common.auth.error.passwordAlreadySet',
      'password-policy': 'common.auth.error.passwordPolicy',
    };
    for (const [reason, key] of Object.entries(expected)) {
      expect(authFailureMessageKey(reason), reason).toBe(key);
    }
  });

  it('🔴 除刻意合并的那几条，**没有一个已知原因**落到 `unknown`', () => {
    // 这一条才是"遍历不崩"真正想要的东西：`unknown` 也匹配 `common.auth.error.`，
    // 所以只查前缀等于什么都没查（上面那条注释记的就是这个假绿）。
    for (const reason of ALL_REASONS) {
      if (REASONS_MERGED_INTO_UNKNOWN.has(reason)) continue;
      expect(authFailureMessageKey(reason), reason).not.toBe('common.auth.error.unknown');
    }
  });

  it('🔴 全部已知原因都不会崩，且返回的永远是 `common.auth.error.*`', () => {
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

  /**
   * 🔴 这两条**必须**是两个不同的 key。
   *
   * 它们让用户做的事正好相反：一个"设第一个密码"（只有一个框），
   * 一个"这个账号已经有密码了，去改"（当前密码 + 新密码两个框）。
   * 合并成一句统称的表现是界面摆错表单 —— 而用户会在那张表里一直打错。
   */
  it('「没设过口令」与「已经设过口令」是两个不同的 key（要摆两张不同的表）', () => {
    expect(authFailureMessageKey('no-password-set')).not.toBe(
      authFailureMessageKey('password-already-set'),
    );
    // 而且两句都不是那句"链接无效"：三条的 CTA 各不相同。
    expect(authFailureMessageKey('password-already-set')).not.toBe(
      authFailureMessageKey('invalid-reset-link'),
    );
  });

  it('口令被拒 vs 链接失效 vs 账号没设口令 —— 三条**互不相同**（CTA 相反）', () => {
    const keys = [
      authFailureMessageKey('invalid-credentials'),
      authFailureMessageKey('invalid-reset-link'),
      authFailureMessageKey('no-password-set'),
      authFailureMessageKey('unauthorized'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('🔴 `password-locked`：有秒数说"等 N 秒"，没秒数只说换路 —— 不许拼出"等 0 秒"', () => {
    expect(authFailureMessageKey('password-locked')).toBe('common.auth.error.passwordLocked');
    expect(authFailureMessageKey('password-locked', { retryAfterSeconds: undefined })).toBe(
      'common.auth.error.passwordLocked',
    );
    // 0 与 undefined 是同一件事（都是"服务端没说还要多久"），不是"已经可以试了"。
    expect(authFailureMessageKey('password-locked', { retryAfterSeconds: 0 })).toBe(
      'common.auth.error.passwordLocked',
    );
    expect(
      authFailureMessageKey('password-locked', { retryAfterSeconds: 900 }),
    ).toBe('common.auth.error.passwordLockedWithWait');
    // 而秒数只被 `password-locked` 读：别的理由带秒数也不许换句子。
    expect(authFailureMessageKey('rate-limited', { retryAfterSeconds: 900 })).toBe(
      'common.auth.error.rateLimited',
    );
  });

  it('`password-locked` 与 `rate-limited` 是两句话（一条锁的是认证器、一条是限流）', () => {
    expect(authFailureMessageKey('password-locked')).not.toBe(
      authFailureMessageKey('rate-limited'),
    );
    // 容量问题不许与"你发得太猛"共用一句。
    expect(authFailureMessageKey('password-backend-busy')).not.toBe(
      authFailureMessageKey('rate-limited'),
    );
    expect(authFailureMessageKey('password-backend-busy')).not.toBe(
      authFailureMessageKey('server-error'),
    );
  });

  it('🔴 `email-not-verified` 不许复用 `not-allowed`（一句把服务端策略说成用户行为）', () => {
    expect(authFailureMessageKey('email-not-verified')).not.toBe(
      authFailureMessageKey('not-allowed'),
    );
  });
});

describe('passwordPolicyMessageKey —— 四种拒绝给四种动作', () => {
  it('四个策略码各落到自己那条', () => {
    expect(passwordPolicyMessageKey('too_short')).toBe('common.auth.policy.tooShort');
    expect(passwordPolicyMessageKey('too_long')).toBe('common.auth.policy.tooLong');
    expect(passwordPolicyMessageKey('too_common')).toBe('common.auth.policy.tooCommon');
    expect(passwordPolicyMessageKey('breached')).toBe('common.auth.policy.breached');
  });

  it('认不出来 / 没给 → 统称那条（**不许**把服务端给的码原样拼成 key）', () => {
    // 原样拼的失败形状：界面冒出一行 `common.auth.policy.<服务端新加的码>`。
    expect(passwordPolicyMessageKey(undefined)).toBe('common.auth.error.passwordPolicy');
    expect(passwordPolicyMessageKey('too_young')).toBe('common.auth.error.passwordPolicy');
    expect(passwordPolicyMessageKey('common.auth.policy.tooShort')).toBe(
      'common.auth.error.passwordPolicy',
    );
  });

  it('只有 `too_long` 那句话需要带上限那个数', () => {
    // 给"太短"那句带上限，用户会以为自己写得**太长**了才没过 —— 带错数字比不带更糟。
    expect(policyMentionsMax('too_long')).toBe(true);
    expect(policyMentionsMax('too_short')).toBe(false);
    expect(policyMentionsMax(undefined)).toBe(false);
  });
});

describe('表单的两步与 autofill（FIDO 2023 UX + web.dev 口令管理器）', () => {
  it('🔴 空的邮箱不许前进到口令步 —— 否则口令框不知道属于谁', () => {
    expect(authFormStageAfterContinue({ stage: 'identify', email: '' })).toBe('identify');
    expect(authFormStageAfterContinue({ stage: 'identify', email: '   ' })).toBe('identify');
    expect(authFormStageAfterContinue({ stage: 'identify', email: 'a@b.c' })).toBe('credential');
    // 「继续」不许把已经前进过的阶段拉回去（用户从口令步点浏览器后退式重提）。
    expect(authFormStageAfterContinue({ stage: 'credential', email: '' })).toBe('credential');
  });

  it('它**不做**邮箱格式裁决（那是服务端的职权，提前飘红是 NNG 反对的即时校验）', () => {
    expect(authFormStageAfterContinue({ stage: 'identify', email: 'not-an-email' })).toBe(
      'credential',
    );
  });

  it('🔴 登录用 `current-password`、注册用 `new-password` —— 用反了管理器会把旧口令填进新账号', () => {
    expect(passwordAutocomplete('sign-in')).toBe('current-password');
    expect(passwordAutocomplete('register')).toBe('new-password');
    // 两个值都不许退化成 'on'（那一档既不填口令也不建议强口令）。
    expect(passwordAutocomplete('sign-in')).not.toBe('on');
    expect(passwordAutocomplete('register')).not.toBe('on');
  });

  it('邮箱框带 FIDO 的混合标记（口令管理器 + 通行密钥都允许）', () => {
    expect(AUTH_EMAIL_AUTOCOMPLETE).toBe('username webauthn');
  });

  it('显隐默认档：桌面遮住、移动显示，但两档都有开关', () => {
    expect(defaultPasswordRevealed('desktop')).toBe(false);
    expect(defaultPasswordRevealed('mobile')).toBe(true);
  });

  it('第一个错误字段按**视觉顺序**，不是按严重度', () => {
    const none = { baseUrlMissing: false, emailMissing: false, passwordMissing: false, termsMissing: false };
    expect(firstAuthErrorField(none)).toBeUndefined();
    expect(firstAuthErrorField({ ...none, termsMissing: true })).toBe('terms');
    // 同时缺口令与条款时，焦点去上面那个（口令）—— 跳到底部会让用户以为上面没错。
    expect(firstAuthErrorField({ ...none, passwordMissing: true, termsMissing: true })).toBe(
      'password',
    );
    expect(firstAuthErrorField({ ...none, emailMissing: true, passwordMissing: true })).toBe('email');
    expect(firstAuthErrorField({ ...none, baseUrlMissing: true, emailMissing: true })).toBe(
      'baseUrl',
    );
  });
});

describe('🔴 两个秘密的命名是两条词条（共用一句就是本轮最大的认知风险）', () => {
  it('「登录密码」与「加密口令」的 key 必须不同', () => {
    expect(SIGN_IN_PASSWORD_LABEL_KEY).not.toBe(E2EE_PASSPHRASE_LABEL_KEY);
  });

  it('两条 key 各自在**中英两张表里都真实存在**', () => {
    for (const key of [SIGN_IN_PASSWORD_LABEL_KEY, E2EE_PASSPHRASE_LABEL_KEY]) {
      for (const locale of ['zh-CN', 'en'] as const) {
        expect(localeHasKey(locale, key), `${locale} 缺 ${key}`).toBe(true);
      }
    }
  });
});

describe('🔴 key 不能只存在于代码里（词条表必须真的有这一条）', () => {
  /**
   * 把两个映射函数**跑一遍**收集所有返回的 key，再去两张词条表里查。
   *
   * 为什么这条承重：模型返回一个没人写过词条的 key 时，界面会把 key 本身
   * 显示给用户（或者落回空串），而**单测里谁也发现不了** —— 因为 key 是个合法字符串。
   * 遍历函数而不是解析源码，是为了让"新增一个 case"自动被这条检查覆盖。
   */
  const keysUsed = new Set<string>();
  for (const reason of ALL_REASONS) keysUsed.add(authFailureMessageKey(reason));
  for (const reason of ALL_REASONS) {
    keysUsed.add(authFailureMessageKey(reason, { retryAfterSeconds: 900 }));
  }
  for (const code of ['too_short', 'too_long', 'too_common', 'breached', 'unknown', undefined]) {
    keysUsed.add(passwordPolicyMessageKey(code));
  }
  keysUsed.add(AUTH_TERMS_REQUIRED_KEY);
  keysUsed.add(SIGN_IN_PASSWORD_LABEL_KEY);
  keysUsed.add(E2EE_PASSPHRASE_LABEL_KEY);

  for (const key of [...keysUsed].sort()) {
    it(`${key} 在 zh-CN 与 en 两张表里都有`, () => {
      expect(localeHasKey('zh-CN', key), 'zh-CN 缺这一条').toBe(true);
      expect(localeHasKey('en', key), 'en 缺这一条').toBe(true);
    });
  }
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