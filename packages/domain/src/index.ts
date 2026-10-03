/**
 * @heyta/domain
 *
 * heyta 的领域层：**纯业务逻辑，不 import 任何框架**。
 *
 * 为什么独立成包而不是放进 apps/web：
 *   1. op-log 的 apply 逻辑全部建立在这些函数上（见 P1 计划 3.2）
 *   2. P2 要上移动端/桌面端 —— 这一层必须能直接复用
 *   3. 纯函数最容易测，而这里的不变量恰恰最需要测（时区、连续天数、状态机）
 */

export * from './entities.js';
export * from './date.js';
export * from './task-order.js';
export * from './quadrant.js';
export * from './task-filter.js';
export * from './subtasks.js';
export * from './reminders.js';
export * from './timeline.js';
export * from './timeline-position.js';
export * from './notes.js';
export * from './search.js';
export * from './habit-streak.js';
export * from './habit-resilience.js';
export * from './habit-icons.js';
export * from './milestones.js';
export * from './today-progress.js';
export * from './weekly-review.js';
export * from './activity-categories.js';
export * from './identity-tags.js';
export * from './focus.js';
export * from './recurrence.js';
export * from './capture.js';
export * from './countdown.js';
export * from './memory.js';
export * from './preferences.js';
export * from './preference-evidence.js';
export * from './preference-hints.js';
export * from './ai-feedback.js';
export * from './preference-corrections.js';
export * from './recall.js';
export * from './subscription.js';
export * from './activity.js';
export * from './ticktick-format.js';
export * from './ticktick-import.js';
export * from './quick-due-picks.js';
export * from './lunar.js';
export * from './holidays.js';
