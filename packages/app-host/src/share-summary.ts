/**
 * 本周小结的纯文本 —— **两端共用的那一份**
 * ==========================================
 *
 * 原来它只有 web 一份实现（`apps/web/src/features/motivation/copy.ts`）。移动端要接
 * 分享块（`GrowthBoard` 的 `share` prop）时只有两条路：要么从 `apps/web` 里 import
 * （壳与壳之间不许互相依赖），要么在移动壳里再写一份。第二条正是本仓库已经付过两次
 * 学费的那种做法（AGENTS §3.5：`addTask` 与 `SyncClientOptions` 各写一份，两份都漂了）。
 * 所以搬到这里，**旧的那份不再是实现，只是一层转发**。
 *
 * 「列哪几行、什么顺序、用什么量词」是**产品语义**，不是平台差异 —— 按 §3.5 的判断
 * 方法，它不许出现在 `apps/`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这里的 `t` 是本地声明的形状，而不是 `@heyta/i18n` 的 `I18nValue['t']`
 *
 * `packages/app-host` **刻意不依赖** `@heyta/i18n`（见 `ai-output-language.ts` 文件头：
 * 加这条边会让 packages/ 反向依赖界面词表）。这里只把用到的**四条 key 写成字面量联合**
 * `ShareSummaryKey`，效果反而更硬：
 *
 * - 宿主传进来的真 `t: (key: MessageKey, vars?) => string` 参数更宽 ⇒ **可赋值**，能编译；
 * - 一旦某条 key 在 `packages/i18n` 里被改名或删掉，`ShareSummaryKey` 就不再是
 *   `MessageKey` 的子集 ⇒ **在宿主的调用点直接编译报错**。
 *
 * 也就是说"漏翻/改错 key"仍然是编译期事故，不是运行时少一句话。`SHARE_SUMMARY_KEYS`
 * 那张表同时是给判据用的穷尽清单。
 */

import type { ActivityTotals, WeeklyReview } from '@heyta/domain';

/** 小结用到的四条词条，顺序 = 句子的输出顺序。 */
export type ShareSummaryKey =
  | 'web.growth.summary.title'
  | 'web.growth.summary.line'
  | 'web.growth.summary.bestDay'
  | 'web.growth.summary.totals';

export const SHARE_SUMMARY_KEYS: readonly ShareSummaryKey[] = [
  'web.growth.summary.title',
  'web.growth.summary.line',
  'web.growth.summary.bestDay',
  'web.growth.summary.totals',
];

/** 注入的翻译函数。形状与两端的 `t()` 兼容（理由见文件头）。 */
export type ShareSummaryTranslate = (
  key: ShareSummaryKey,
  vars?: Record<string, string | number>,
) => string;

/**
 * 生成一份**纯文本**的本周小结，用于复制到任何地方。
 *
 * 🔴 刻意不做成图片分享卡：出图要引 canvas/字体/排版三套东西，而它换来的传播收益
 * 在这个阶段无法验证（E2EE 下我们也拿不到任何回传数据）。纯文本能被粘进任意对话、
 * 笔记、待办 —— 而且它**不携带任何标识符**。
 *
 * ⚠️ `t` 是**参数**而不是 hook：这是纯函数，而它拼出来的东西会离开界面（进剪贴板）
 * —— 拿当前语言拼，是它唯一正确的行为。
 */
export function buildShareSummary(
  review: WeeklyReview,
  totals: ActivityTotals,
  t: ShareSummaryTranslate,
): string {
  const lines: string[] = [];
  lines.push(t('web.growth.summary.title', { start: review.weekStart, end: review.weekEnd }));
  lines.push(
    t('web.growth.summary.line', {
      checkIns: review.checkIns,
      tasks: review.tasksCompleted,
      minutes: review.focusMinutes,
    }),
  );

  if (review.bestFocusDay !== undefined) {
    lines.push(
      t('web.growth.summary.bestDay', {
        date: review.bestFocusDay.date,
        minutes: review.bestFocusDay.minutes,
      }),
    );
  }

  lines.push(
    t('web.growth.summary.totals', {
      checkIns: totals.checkIns,
      hours: Math.floor(totals.focusMs / 3_600_000),
      tasks: totals.tasksCompleted,
      activeDays: totals.activeDays,
    }),
  );

  return lines.join('\n');
}
