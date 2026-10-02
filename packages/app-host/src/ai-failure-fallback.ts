/**
 * 路由层失败的**兜底句**（`packages/ai` 没给句子时才用）
 * =====================================================
 *
 * 🔴 这个文件存在的原因：`describeRoutedFailure()` 原来在
 * `ai-breakdown` / `ai-capture` / `ai-duration` / `ai-prioritize` 里**各抄了一份**，
 * 四份逐字节相同（2026-10-02 实测：把四段函数体并排 diff，零差异）。
 * 本仓库对"同一个判断写四遍"的账是有价格的 —— AGENTS §3.5 那条抽取教训的结尾是
 * **「抽出一个共享实现不等于重复被消除了，收尾动作是删掉旧的那份并加门禁」**，
 * 所以这里删掉了四份，只留这一份。
 *
 * ## 它**不是**界面文案的事实源
 *
 * 界面文案在 `packages/i18n`，由壳按 `cause` 取词条（`apps/web/src/features/ai/
 * ai-failure-copy.ts` 的 `CAUSE_KEY`，对 `AiFailureReason` **穷尽**）。
 * 本文件的句子只在 `packages/ai` **没有**给出 `message` 时出现（调用点写成
 * `specific === '' ? describeRoutedFailure(reason) : specific`），
 * 而现在它只会落到面板的**折叠诊断块**里 —— 与 `ErrorScreen` 对原始错误文本
 * 同一处置：**诊断数据，不翻译**。
 *
 * ⚠️ 正因为它是兜底，它**不该**长出新职责：要改用户看到的话，改词条，不要改这里。
 *
 * ## 为什么这里用 `Record` 而不是 `switch`
 *
 * 四份旧实现都是 `switch (reason: string)` + `default` —— `string` 加上 `default`
 * 意味着 `packages/ai` 新增一个失败原因时**四份都不会报错，只是静默落到 default**。
 * `AiFailureReason` 是封闭词表，`Record<AiFailureReason, string>` 让它变成
 * **编译错误**：少一条就编译不过，这正是本仓库对封闭词表的一贯做法。
 */

import type { AiFailureReason } from '@heyta/ai';

const FALLBACK_SENTENCES: Record<AiFailureReason, string> = {
  'not-configured': 'AI 还没打开。去「设置」里打开总开关，并添加一个端点。',
  'no-route': '没有可用端点能处理这个功能。检查端点是否启用、地址是否合法。',
  'egress-not-authorized': '这个功能还没有授权把数据发到所选端点。去「设置」里逐功能授权。',
  'fallback-needs-consent': '首选端点失败了，而备用端点会把数据发到别处，所以没有自动切换。需要你重新授权。',
  network: '连不上端点。检查它是不是在运行。',
  'http-error': '端点返回了错误。',
  'empty-response': '端点返回了空内容。',
};

/**
 * 路由层失败原因 → 一句兜底说明。
 *
 * ⚠️ 入参刻意是**封闭词表**而不是 `string`：四份旧实现传的是 `string` + `default`，
 * 那等于把"这个词表里有哪些取值"的知识丢掉 —— 而丢掉知识的地方就是漂移溜进来的地方。
 *
 * 🔴 那句"词表外"的兜底**不是装饰**：`noUncheckedIndexedAccess` 让
 * `FALLBACK_SENTENCES[reason]` 的类型是 `string | undefined`，编译期就要求处理它。
 * 运行时它确实可能命中 —— 同一个包被加载两份时跨模块的枚举比较会静默为假，
 * 那时传进来的就是词表外的值。宁可不粘一句，也不能把 `undefined` 交给调用方
 * （面板对它做 `.includes()`，那是白屏）。
 */
export function describeRoutedFailure(reason: AiFailureReason): string {
  return FALLBACK_SENTENCES[reason] ?? 'AI 暂时不可用。';
}
