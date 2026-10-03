/**
 * 同步失败原因 → 词条 key → 中英两句，**每一个原因都要在表里出现一次**
 * =====================================================================
 *
 * ## 这条判据为什么必须存在（而且为什么形状是"一张字面量对象"）
 *
 * `packages/sync-client/src/client.ts` 的 `SyncFailureReason` 是**闭集**：壳拿到一个
 * 原因，必须能翻成一句人话。翻不出来的后果不是报错，而是**界面少一句话** ——
 * 用户看到状态栏变了字，却不知道变了什么、更不知道该做什么。
 *
 * 🔴 **共享查表那一层，编译器管不了这件事**（2026-10-01 逐条核过；`client.ts` 里
 * 原先写着"两个壳都会编译不过"，那句是假的）：
 * `packages/ui/src/sync/model.ts` 那张表的类型是
 * `Record<string, SyncFailureMessageKey>` —— 用**字符串索引**，
 * 所以往 `SyncFailureReason` 里加一个成员、那张表不写对应行也**照样编译通过**，
 * 运行时只是回 `undefined`。（`packages/ui` 刻意不 import `@heyta/sync-client`，
 * 否则会被拖进第二份 React，见 `packages/ui/src/auth/model.ts` 文件头。）
 *
 * ⚠️ 但**有一处确实会红**：`apps/mobile/src/sync/status-text.ts` 里的
 * `KNOWN_FAILURE_REASON_COVERAGE ... satisfies Record<Exclude<SyncFailureReason,'unexpected'>, true>`
 * 会在新增原因时报错 —— 它只保证"被意识到一次"，**不登记句子**。
 * 本轮加 `'consent-required'` 时，缺这一条被抓出来的正是移动端。
 *
 * **本文件补的是 web 那一半**：下面这张 `EXPECTED` 的类型是
 * `Record<SyncFailureReason, SyncFailureMessageKey | undefined>` —— 对象字面量、
 * 每个联合成员都必须出现一次，缺一个就是 tsc 报错；而且它**登记的是句子本身**，
 * 再逐条查两份词条表里真有中英两句。于是"加原因"第一次在 web 侧有了强制。
 *
 * ⚠️ 为什么值允许 `undefined`：`'unexpected'` 是**故意没有词条**的那一个
 * （它的 `message` 是真正的诊断数据，由宿主拼进自己的兜底句）。
 * 把它写成"必填"会逼出一种坏修法 —— 给 `unexpected` 编一句假词条。
 * 所以现在**每个成员都要显式表态**：给 key，或者明确写 `undefined`。
 *
 * ## 四段各钉一件事
 *
 *   1. 表里每个 key 与 `syncFailureMessageKey()` 的实际返回**逐字一致**（防"表写对了、函数查错了"）；
 *   2. 每个 key 在**两份**词条表里都有非空句子（防只补中文）；
 *   3. 中文含汉字、英文一个汉字都不许有（防英文界面露出中文）；
 *   4. 🔴 按原因选出的句子必须**自足** —— 不许带 `{...}` 占位符。
 *      带参数就等于这句还要靠**包里的原文**补全，而那是内部诊断串；
 *      更要命的是 `consent-required` 那句：它的"参数"只能是"去同意"这个动作，
 *      写成占位符就会退化成"同步失败：xxx"，用户去检查网络而不是去点面板。
 */

import { describe, expect, it } from 'vitest';

import type { SyncFailureReason } from '@heyta/sync-client';
import { translate } from '@heyta/i18n';
import { syncFailureMessageKey, type SyncFailureMessageKey } from '@heyta/ui';

const zh = (key: Parameters<typeof translate>[1]): string => translate('zh-CN', key);
const en = (key: Parameters<typeof translate>[1]): string => translate('en', key);

/**
 * 🔴 这张表**就是**判据。加一个 `SyncFailureReason` 而不在这里登记 ⇒ tsc 报错。
 */
const EXPECTED: Record<SyncFailureReason, SyncFailureMessageKey | undefined> = {
  'not-configured': 'common.sync.error.notConfigured',
  'not-signed-in': 'common.sync.error.notSignedIn',
  'no-encryption-password': 'common.sync.error.noPassword',
  'account-closed': 'common.sync.error.accountClosed',
  'local-op-missing': 'common.sync.error.localOpMissing',
  'remote-version-unavailable': 'common.sync.error.remoteVersionUnavailable',
  'undecryptable-ops': 'common.sync.error.undecryptableOps',
  'undecryptable-page': 'common.sync.error.undecryptablePage',
  'upload-rejected': 'common.sync.error.uploadRejected',
  'unauthorized': 'common.sync.error.unauthorized',
  // 🔴 G-12：被本机拦下、**一个请求都没发**。这句绝不能复用上面任何一句 ——
  // 它们的用户动作是"检查网络/填地址/重输口令"，而这里的动作是"去作出同意"。
  'consent-required': 'common.sync.error.consentRequired',
  // 🔴 G-27：设备同意过、账号没补签。这句必须与上一句不同 —— 复用"去同意隐私规则"
  // 等于对一个已经作出过那个决定的人重复索取同意。
  'legal-reconfirm-required': 'common.sync.error.legalReconfirmRequired',
  // 唯一"故意没有词条"的那个：它带的是诊断数据，走宿主的兜底句。
  'unexpected': undefined,
};

const REASONS = Object.keys(EXPECTED) as SyncFailureReason[];
const WITH_KEY = REASONS.filter((reason) => EXPECTED[reason] !== undefined);

describe('同步失败原因的词条覆盖（compiler + 两份词条表 + 句子自足）', () => {
  it('🔴 每个原因都走查表得到 EXPECTED 里那一句（表与函数不许各说一套）', () => {
    for (const reason of REASONS) {
      expect(syncFailureMessageKey(reason), `原因 ${reason} 的实际映射与表不一致`).toBe(
        EXPECTED[reason],
      );
    }
  });

  it('`unexpected` 与"认不出来的原因"都回 undefined，而不是编一句', () => {
    expect(syncFailureMessageKey('unexpected')).toBeUndefined();
    expect(syncFailureMessageKey('no-such-reason')).toBeUndefined();
    expect(syncFailureMessageKey(undefined)).toBeUndefined();
  });

  it('每个 key 在中英两份表里都有非空句子', () => {
    for (const reason of WITH_KEY) {
      const key = EXPECTED[reason]!;
      expect(zh(key).trim(), `中文缺 ${key}`).not.toBe('');
      expect(en(key).trim(), `英文缺 ${key}`).not.toBe('');
    }
  });

  it('🔴 中文含汉字、英文一个汉字都不许有', () => {
    for (const reason of WITH_KEY) {
      const key = EXPECTED[reason]!;
      expect(zh(key), `这句没有中文：${zh(key)}`).toMatch(/[\u3400-\u9fff]/u);
      expect(en(key), `这句会在英文界面露出中文：${en(key)}`).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('🔴 按原因选出的句子必须自足 —— 不许带占位符', () => {
    for (const reason of WITH_KEY) {
      const key = EXPECTED[reason]!;
      expect(zh(key), `${key} 的中文句还在等参数`).not.toContain('{');
      expect(en(key), `${key} 的英文句还在等参数`).not.toContain('{');
    }
  });

  it('🔴 `consent-required` 那句必须说清"没发出任何数据"，不许写成网络故障', () => {
    // 这一条看着像文案洁癖，但它钉的是**事实**：闸门是在本机拦的，
    // 服务端从来没收到过这次请求。说成"网络有问题/服务端连不上"的每一字都是假的，
    // 而用户会照着假话去改地址、改完还是不行。
    const sentence = zh('common.sync.error.consentRequired');
    expect(sentence).toMatch(/没/);
    expect(sentence).not.toMatch(/网络|检查地址|服务端连不上/);
    // 还要给出一条走出去的路（"同意"这个词必须出现，否则用户不知道下一步做什么）。
    expect(sentence).toMatch(/同意/);
  });

  it('表里登记的成员数与联合的成员数对得上（防止两边各长一半）', () => {
    // 这条断言的**唯一价值**是把"总共数了几个"印出来：上面几条都是循环，
    // 循环体一条没跑也能全绿（§7 第 50 条那一类）。这里给出总数。
    expect(REASONS.length, 'EXPECTED 表的成员数').toBe(12);
    expect(WITH_KEY.length).toBe(11);
  });
});
