/**
 * 换绑邮箱 / 登录设备那些**措辞与数值判定**的判据
 * ==============================================
 *
 * 为什么这一层值得单独测：界面上"还等谁点""还要等几秒""这次失败该怎么说"
 * 全是**能讲错话**的地方，而它们都发生在组件之外 —— 在这里钉住，
 * 比在 `.tsx` 里断言"渲染出了某个字符串"便宜得多，也准得多。
 *
 * 变异复现（每条都验过会红）见文件末尾那段注释。
 */

import { describe, expect, it } from 'vitest';
import type { HostedAuthFailureReason } from '@heyta/app-host';
import { translate } from '@heyta/i18n';

import {
  EMAIL_CHANGE_SPECIFIC_REASONS,
  cooldownSecondsLeft,
  emailChangeFailureCopy,
  emailChangeStageCopy,
  sessionDeviceLabel,
} from '../src/auth/account-security-copy';

/**
 * 读词条走 `translate()` —— 与 `tests/plural-keys.spec.ts` 同一手法。
 * 刻意**不** import `@heyta/i18n/zh-CN`：那只是查表，绕过了占位符替换，
 * 而这一族最容易出的错正是"key 拿到了、数字没填进句子"。
 */
const zh = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

/** 把一个 `CopyMessage` 真的渲染成句子（key + vars 一起过 `translate`）。 */
const render = (
  locale: 'zh-CN' | 'en',
  copy: { key: Parameters<typeof translate>[1]; vars?: Record<string, string | number> },
): string => (locale === 'zh-CN' ? zh(copy.key, copy.vars) : en(copy.key, copy.vars));

describe('换绑失败原因 → 句子', () => {
  it('每一条特有的原因都有自己的句子，且**不是**通用那句', () => {
    // 🔴 变异：把 `EMAIL_CHANGE_SPECIFIC_KEYS` 里 `'email-taken'` 删掉 ⇒ 本条红。
    // 漏一条的症状不是崩溃，而是"另一个账号已经在用这个邮箱"被说成
    // "这个邮箱地址或令牌看起来不对" —— 用户会去重打同一个正确的地址。
    const cases: Array<readonly [HostedAuthFailureReason, string]> = [
      ['email-unchanged', 'common.emailChange.unchanged'],
      ['email-taken', 'common.emailChange.taken'],
      ['email-not-verified', 'common.emailChange.notVerified'],
      ['invalid-change-link', 'common.emailChange.invalidLink'],
      ['network', 'common.emailChange.network'],
    ];
    for (const [reason, key] of cases) {
      expect(emailChangeFailureCopy(reason, 0)?.key, reason).toBe(key);
    }
  });

  it('特有的那六条**全部**被处置（新增一条而这里没跟上 = 本条红）', () => {
    for (const reason of EMAIL_CHANGE_SPECIFIC_REASONS) {
      expect(emailChangeFailureCopy(reason, 30), reason).toBeDefined();
    }
  });

  it('不属于换绑的原因一律交回 `undefined`，由调用方落共享词表', () => {
    // 判据方向是**反的**：不许本模块替 `unauthorized` / `consent-required` 造句子 ——
    // 那会在移动端长出第二份 `common.auth.error.*` 映射（本仓删过一次那种东西）。
    for (const reason of ['unauthorized', 'consent-required', 'rate-limited', 'malformed-response'] as const) {
      expect(emailChangeFailureCopy(reason, 30), reason).toBeUndefined();
    }
    expect(emailChangeFailureCopy(undefined, 30)).toBeUndefined();
  });

  it('冷却有秒数 ⇒ 带 `{seconds}` 的那句，且数字真的填进去了', () => {
    const copy = emailChangeFailureCopy('email-change-cooldown', 90);
    expect(copy?.key).toBe('common.emailChange.cooldown');
    expect(copy?.vars).toEqual({ seconds: 90 });
    // 🔴 正向对照：句子**渲染出来**含那个数字。只断 key 与 vars 各就各位，
    //    测不到"占位符名字与 vars 的键不一致"（那种情况下界面印的是 `{seconds}`）。
    if (copy !== undefined) {
      expect(render('zh-CN', copy)).toContain('90');
      expect(render('en', copy)).toContain('90');
      expect(render('en', copy)).not.toContain('{seconds}');
    }
  });

  it('服务端没回秒数 ⇒ 换用**不需要数字**的那句，而不是渲染 "{seconds}"', () => {
    // `@heyta/i18n` 缺变量时刻意**原样保留占位符**（漏填一眼看得见，方向正确）。
    // 所以"没有秒数还去用带占位符的词条"= 界面上印出"再等 {seconds} 秒"。
    const copy = emailChangeFailureCopy('email-change-cooldown', 0);
    expect(copy).toBeDefined();
    if (copy === undefined) return;
    expect(copy.key).toBe('mobile.emailChange.cooldownNoSeconds');
    expect(copy.vars).toBeUndefined();
    expect(render('zh-CN', copy)).not.toContain('{');
    expect(render('en', copy)).not.toContain('{');
  });
});

describe('换绑阶段 → 那句"还等谁点"', () => {
  it('四种等待各有自己的句子，`idle` **没有**句子', () => {
    expect(emailChangeStageCopy('awaiting-both')).toBe('common.emailChange.awaitingBoth');
    expect(emailChangeStageCopy('awaiting-old')).toBe('common.emailChange.awaitingOld');
    expect(emailChangeStageCopy('awaiting-new')).toBe('common.emailChange.awaitingNew');
    // 🔴 `idle` 返回 undefined 是语义，不是偷懒：没有活请求时不许画"还在等"。
    expect(emailChangeStageCopy('idle')).toBeUndefined();
  });

  it('`invalid` 有一句话，而且它**不说**"等另一边"也不说"已生效"', () => {
    const key = emailChangeStageCopy('invalid');
    expect(key).toBe('mobile.emailChange.stage.invalid');
    if (key === undefined) return;
    // 🔴 断的是**渲染出来的句子**，不是 key：这一档最诱人的错法是抄一句
    //    "还在等另一边点" —— 而那是一句界面在编造的事实（服务端两边都不等）。
    const text = zh(key);
    expect(text).toContain('取消');
    for (const forbidden of ['已经更换', '已生效', '等新邮箱点一次', '等当前邮箱点一次']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('四种等待的说法互相**能区分**（三端共用一份，不许两条抄成一样）', () => {
    const keys = ['awaiting-both', 'awaiting-old', 'awaiting-new', 'invalid'].map(
      (stage) => emailChangeStageCopy(stage as never) as string,
    );
    expect(new Set(keys).size).toBe(4);
  });
});

describe('冷却倒计时', () => {
  it('还剩的时间向下取整', () => {
    expect(cooldownSecondsLeft(10_000 + 90_500, 10_000)).toBe(90);
  });

  it('到点与已经过期都是 0，**绝不是负数**', () => {
    // 设备时钟被回拨时 `resendAvailableAt` 会算到"现在"之前（`lib/date.ts`
    // 的 `MIN_TICK_DELAY_MS` 注释记着同一件事）。负数会渲染成"再等 -30 秒"。
    expect(cooldownSecondsLeft(10_000, 10_000)).toBe(0);
    expect(cooldownSecondsLeft(5_000, 10_000)).toBe(0);
    expect(cooldownSecondsLeft(-1_000_000, 0)).toBe(0);
  });

  it('服务端没回这个字段时是 0（不拿 `undefined` 当"很久"也不当"负数"）', () => {
    expect(cooldownSecondsLeft(undefined, 10_000)).toBe(0);
  });

  it('不足一秒的余量向下归零，而不是显示 0.4 或 1', () => {
    expect(cooldownSecondsLeft(10_000 + 400, 10_000)).toBe(0);
  });
});

describe('会话行上那台设备叫什么', () => {
  const fallback = '未命名密钥';

  it('有名字用名字', () => {
    expect(sessionDeviceLabel({ deviceName: 'MacBook', userAgent: 'UA' }, fallback)).toBe('MacBook');
  });

  it('名字是空串或全空白 ⇒ 落到 UA，而不是画出**一个空标题的行**', () => {
    expect(sessionDeviceLabel({ deviceName: '   ', userAgent: 'Safari' }, fallback)).toBe('Safari');
    expect(sessionDeviceLabel({ deviceName: null, userAgent: 'Safari' }, fallback)).toBe('Safari');
  });

  it('两个都没有 ⇒ 老实说"未命名"，**不**回落到 sessionId', () => {
    // 用户认不出一枚 SHA-256，而那行正是要他判断"退掉哪一台"的地方。
    const label = sessionDeviceLabel({ deviceName: null, userAgent: null }, fallback);
    expect(label).toBe(fallback);
    expect(label).not.toMatch(/^[0-9a-f]{16,}$/);
  });
});

/*
 * 变异复现（逐条手工注入后跑 `pnpm --filter @heyta/mobile test`，全部转红）：
 *   ① 删掉 `'email-taken'` 那行登记                ⇒ 「特有的那六条全部被处置」+「每一条都有自己的句子」红
 *   ② 把 `cooldownSecondsLeft` 的 `left > 0 ? left : 0` 改成 `left`  ⇒ 「绝不是负数」红
 *   ③ 让冷却无秒数时也返回 `common.emailChange.cooldown`  ⇒ 「不需要数字的那句」红
 *   ④ 把 `idle` 映射成 `awaitingBoth`               ⇒ 「`idle` 没有句子」红
 *   ⑤ 让 `sessionDeviceLabel` 回落到 sessionId      ⇒ 「老实说未命名」红
 *   ⑥ 把 `'network'` 从 `EMAIL_CHANGE_SPECIFIC_KEYS` 删掉 ⇒ 「六条全部被处置」红（编译期也会红：
 *      那张表是 `Record<EmailChangeKeyedReason, MessageKey>`，少一条不是运行时报错而是**类型不满足**）
 */
