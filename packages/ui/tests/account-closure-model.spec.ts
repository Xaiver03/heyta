/**
 * 注销账号的"结局 → 词条 key"路由表（批次 E3 的共享那一层）
 * =========================================================
 *
 * 这张表由 Web 的设置页与移动壳的「我的」**共用**。它一旦漂，症状不是报错，而是
 * 两端对同一件事说两句不同的话 —— 而这句话的内容是"你的账号没了没有、这台设备上
 * 的明文还在不在"。所以这里断言的不是"函数能跑"，而是三件会敞开的事：
 *
 *   1. `ClosureDisposition` 的**每一档**都落到一条具体的 key（不是兜底的 `other`）；
 *      上游加一档而这里没登记句子 ⇒ 红。
 *   2. 每条失败原因给出的 key **在两份词条表里真的存在**；
 *      指向一句没翻译的话时，运行时界面上会直接显示 key 本身。
 *   3. 兜底句的方向：它只可以说"没注销、本机没动"，永远不许落在 `done.*` 上。
 *
 * 🔴 两个封闭集合的取法不一样，各有各的理由：
 *   · `ClosureDisposition` 从 app-host **源码现取** —— "少登记一档"的后果是界面朝
 *     "已经注销"的方向说谎，所以要让机器替人盯住。
 *   · 失败原因用**下面的快照表**，并配一条"快照必须与源码逐字相同"的对账。
 *     与 `auth-model.spec.ts` 同一个立场：新增一条原因时该由人决定它说什么话，
 *     自动跟随会把那个决定悄悄跳过去；而对账让漂移必须经过这里，不会无声过去。
 *
 * ⚠️ 与 `auth-model.spec.ts` 一样：这里**不 import `@heyta/i18n`**（`packages/ui`
 * 不许依赖它，会拖进第二份 React），词条按源码文本读。也不走 `@heyta/ui` 那桶
 * —— 它会 `from "react-native"`，node 里值导入即炸。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { accountClosureMessageKey } from '../src/auth/model.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function localeSrc(locale: 'zh-CN' | 'en'): string {
  return readFileSync(join(REPO, 'packages/i18n/src/locales', `${locale}.ts`), 'utf8');
}

function localeHasKey(locale: 'zh-CN' | 'en', key: string): boolean {
  return localeSrc(locale).includes(`'${key}':`);
}

/** 取某条词条的文本本身（占位符对不对、有没有说反，都是文本决定的）。 */
function localeText(locale: 'zh-CN' | 'en', key: string): string {
  const line = localeSrc(locale)
    .split('\n')
    .find((one) => one.trimStart().startsWith(`'${key}':`));
  if (line === undefined) throw new Error(`${locale} 里没有词条 ${key}`);
  const value = line.slice(line.indexOf(':', line.indexOf("'") + 1) + 1).trim();
  const quoted = /^'((?:[^'\\]|\\.)*)'/.exec(value);
  if (quoted === null || quoted[1] === undefined) {
    throw new Error(`${locale} 的 ${key} 不是预期的单引号词条形状`);
  }
  return quoted[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/**
 * 从 `export type X = …;` 里取 `'字面量'` 成员。
 *
 * 🔴 锚在**行首的 `| '…'`** 上，不扫整段：那两个联合的注释里就有反引号包着的
 * 字面量（例如 `` `'account-closed'` ``），不锚行首会把注释里的词当成成员，
 * 于是"快照与源码相同"那条判据会在**探针**坏掉时报红 —— 而那句红看着像上游漂了。
 */
function unionMembers(file: string, typeName: string): string[] {
  const src = readFileSync(join(REPO, file), 'utf8');
  const start = src.indexOf(`export type ${typeName} =`);
  expect(start, `${file} 里找不到 export type ${typeName} = —— 它改名了？`).toBeGreaterThan(-1);
  const end = src.indexOf(';', start);
  return [...src.slice(start, end).matchAll(/^\s*\| '([a-z-]+)'/gm)].map((match) => match[1]!);
}

const DISPOSITIONS = unionMembers(
  'packages/app-host/src/account-closure.ts',
  'ClosureDisposition',
);
const SOURCE_REASONS = unionMembers(
  'packages/app-host/src/hosted-auth.ts',
  'HostedAuthFailureReason',
);

/** `HostedAuthFailureReason` 的快照（现量 2026-10-04：25 条）。 */
const SNAPSHOT_REASONS = [
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
  'invalid-credentials',
  'email-not-verified',
  'password-locked',
  'password-backend-busy',
  'invalid-reset-link',
  'no-password-set',
  'password-already-set',
  'password-policy',
  'consent-required',
];

const OTHER = 'common.accountClosure.failed.other';

describe('注销账号的共享路由表', () => {
  it('前提：两个封闭集合都真的取到了（取空集会让下面每条判据都无条件绿）', () => {
    expect(DISPOSITIONS).toHaveLength(4);
    expect(SOURCE_REASONS.length).toBeGreaterThan(20);
  });

  it('🔴 失败原因的快照与源码逐字相同 —— 新增一条必须在这里做一次决定', () => {
    expect([...SOURCE_REASONS].sort()).toEqual([...SNAPSHOT_REASONS].sort());
  });

  it('🔴 四种结局各落到一条具体的 key，没有一种掉进兜底句', () => {
    for (const disposition of DISPOSITIONS) {
      if (disposition === 'not-closed') continue; // 那一档按原因逐条断言。
      const key = accountClosureMessageKey({ disposition });
      expect(key, `结局 ${disposition} 落到了兜底句`).not.toBe(OTHER);
      expect(key, `结局 ${disposition} 的 key 不是 done 那族`).toMatch(
        /^common\.accountClosure\.done\./,
      );
    }
  });

  it('🔴 三种"账号已经没了"的结局互不相同 —— 合并就等于对其中两种说谎', () => {
    const keys = ['closed-and-erased', 'closed-erase-partial', 'closed-erase-failed'].map(
      (disposition) => accountClosureMessageKey({ disposition }),
    );
    expect(new Set(keys).size, `三档拿到了同一句：${keys.join(' / ')}`).toBe(3);
  });

  it('🔴 每一条原因都给出一个**两份词条表里都有**的 key', () => {
    for (const reason of SNAPSHOT_REASONS) {
      const key = accountClosureMessageKey({ disposition: 'not-closed', failure: reason });
      expect(key, `原因 ${reason} 没给出 key`).toBeTruthy();
      expect(localeHasKey('zh-CN', key), `zh 里没有 ${key}（原因 ${reason}）`).toBe(true);
      expect(localeHasKey('en', key), `en 里没有 ${key}（原因 ${reason}）`).toBe(true);
    }
  });

  it('注销够得着的 7 条原因各说各的话；够不着的才允许共用兜底句', () => {
    // 这 7 条是 `DELETE /api/account` 真的会产生的一类（状态码分类 + 本机闸门 + 没配地址）。
    // 其余的是通行密钥 / 口令那几条流程专属的，这条路径产生不了 —— 共用兜底句是
    // **有意的合并**，写在这条判据里是因为"合并"与"漏了"在输出上长得一模一样。
    const reachable = [
      'unconfigured',
      'consent-required',
      'unauthorized',
      'rate-limited',
      'server-error',
      'network',
      'malformed-response',
    ];
    const keys = reachable.map((reason) =>
      accountClosureMessageKey({ disposition: 'not-closed', failure: reason }),
    );
    expect(new Set(keys).size, `有几条原因被并成同一句：${keys.join(' / ')}`).toBe(
      reachable.length,
    );

    for (const reason of ['passkey-cancelled', 'password-policy', 'invalid-credentials']) {
      expect(SNAPSHOT_REASONS).toContain(reason);
      expect(accountClosureMessageKey({ disposition: 'not-closed', failure: reason })).toBe(OTHER);
    }
  });

  it('认不出来的原因、没登记的结局：落到保守那一句，且永远不是 done.*', () => {
    expect(accountClosureMessageKey({ disposition: 'not-closed', failure: 'brand-new' })).toBe(
      OTHER,
    );
    expect(accountClosureMessageKey({ disposition: 'brand-new-disposition' })).toBe(OTHER);
    expect(OTHER).not.toMatch(/\.done\./);
    // 上游漏传失败原因时不能崩，也不能说成"已注销"。
    expect(accountClosureMessageKey({ disposition: 'not-closed' })).toBe(OTHER);
  });

  it('兜底那句的方向：同时说"没注销"与"本机没动"', () => {
    const text = localeText('zh-CN', OTHER);
    expect(text).toContain('账号还在');
    expect(text).toContain('本机数据也没动');
  });

  it('🔴 `pending` 那句带着 `{count}` 占位符 —— 两个壳都靠它把现量数字说出来', () => {
    // 这条不属于路由表，但它钉的是同一句承诺：那句"还有多少条没同步出去"必须是
    // **数字**，不是"可能有未同步数据"。占位符没了，界面就显示字面量 `{count}`。
    for (const locale of ['zh-CN', 'en'] as const) {
      expect(localeText(locale, 'common.accountClosure.pending')).toContain('{count}');
    }
  });

  it('中英两条都有字，且方向对（中文含汉字、英文不含）', () => {
    const keys = [
      ...DISPOSITIONS.filter((d) => d !== 'not-closed').map((d) =>
        accountClosureMessageKey({ disposition: d }),
      ),
      ...SNAPSHOT_REASONS.map((reason) =>
        accountClosureMessageKey({ disposition: 'not-closed', failure: reason }),
      ),
    ];
    expect(keys.length).toBeGreaterThan(8);
    for (const key of new Set(keys)) {
      expect(localeText('zh-CN', key)).toMatch(/[一-龥]/u);
      expect(localeText('en', key)).not.toMatch(/[一-龥]/u);
    }
  });
});
