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
export * from './checklist.js';
export * from './date.js';
export * from './task-order.js';
export * from './quadrant.js';
export * from './calendar-drop.js';
// ADR-0089：外部日历的只读镜像实体 `CALENDAR_EVENT` —— 幂等键 / 上游行投影 /
// 内容比较 / 删除判定。纯函数；写入方只有 `app-host` 的 connector。
export * from './calendar-event.js';
// 任务 → iCalendar 导出（`.ics` 下载 / 订阅源，纯函数，服务端与客户端共用）。
export * from './calendar-feed.js';
export * from './task-filter.js';
// ADR-0092：保存筛选（`FILTER.rule`）的编译器与写侧校验（复用 task-filter 语义）。
export * from './filter-rule.js';
// B 包 R8：标签合并别名的**唯一解析入口**（`resolveTagIds` / `resolveTags`）。
export * from './tags.js';
export * from './task-activity.js';
export * from './subtasks.js';
export * from './project-hierarchy.js';
// 标签层级（父 / 子，两层）—— ADR-0090。
export * from './tag-hierarchy.js';
export * from './reminders.js';
export * from './timeline.js';
export * from './timeline-position.js';
export * from './notes.js';
export * from './sections.js';
export * from './trash-rows.js';

export * from './events.js';
// W8：跨端唯一一份的**功能域词表**（为什么在这里而不是 app-host，见那个文件头）。
export * from './feature-modules.js';
export * from './events.js';
// W8：跨端唯一一份的**功能域词表**（为什么在这里而不是 app-host，见那个文件头）。
export * from './feature-modules.js';
export * from './trash-rows.js';
export * from './search.js';
export * from './habit-streak.js';
export * from './course-import.js';
export * from './habit-resilience.js';
export * from './habit-icons.js';
export * from './habit-backfill.js';
export * from './habit-review.js';
export * from './habit-year.js';
export * from './milestones.js';
export * from './today-progress.js';
export * from './weekly-review.js';
export * from './activity-categories.js';
export * from './project-settings.js';
export * from './identity-tags.js';
export * from './focus.js';
export * from './recurrence.js';
export * from './capture.js';
// 2026-11-15：任务行「今天」快捷要用它算到期 epoch（与捕获面板同一个换算）。
export { dueDateToEpoch } from './capture.js';
export * from './countdown.js';
export * from './memory.js';
export * from './preferences.js';
export * from './preference-evidence.js';
export * from './preference-hints.js';
export * from './user-memory.js';
export * from './ai-feedback.js';
export * from './preference-corrections.js';
export * from './recall.js';
export * from './subscription.js';
export * from './activity.js';
export * from './ticktick-format.js';
export * from './ticktick-import.js';
// 通用 CSV / Todoist 导入（复用滴答导入的计划/报告管线，新增两个来源）。
export * from './import-csv.js';
export * from './quick-due-picks.js';
export * from './lunar.js';
export * from './holidays.js';
// ADR-0045 D-4 (ii)：助手会话消息的**判定**（一条消息=一个实体；
// 提案的可确认性只在产生它的那台设备上，跨设备一律按过期呈现。理由在文件头）。
export * from './assistant-turn.js';
// ADR-0062 W3：共享清单里任务评论的**判定**（一条评论=一个实体；
// 正文上限 / 空白拒绝 / 线程顺序只在这里定义 —— UI 与动作层都从这里取）。
export * from './comments.js';
// 工单 `task-detail-ticktick-parity` #9：任务附件的**判定**（一个附件=一个实体；
// 文件名闸门 / 列表顺序 / 字节求和只在这里定义 —— UI 与动作层都从这里取，
// 字节本身走 shared-schema 的那条 HTTP 契约，领域层不碰）。
export * from './attachments.js';
// 危险操作的**档位判定**（轻/中/重/重+键入名称）。通用判据住在全局 Skill
// `overlay-feedback-patterns`，这里是本仓唯一一份可被调用的阈值实现 ——
// 各页自判会让「删一条」和「删一批」的摩擦差异由页面作者临时决定。
export * from './danger-tier.js';

// `@` 提及的文本语法（纯函数）：chip 只是它的可视化投影，文本才是事实源。
export * from './mentions.js';

// `@任务` 的候选与标签：同名任务必须加消歧后缀，否则标签没有唯一解。
export * from './mention-tasks.js';

// 任务动态（谁在什么时候改了什么）：投影给「清单动态」用，纯函数。
// ⚠️ 这一行是**补的**（2026-11-02）：模块与 `apps/web`/`app-host` 的消费点都已在树上，
//    唯独 barrel 没接 —— 于是 `@heyta/app-host` 的 DTS 构建报
//    「Module '@heyta/domain' has no exported member 'projectTaskActivity'」，
//    而 domain 自己的 build 是绿的（它编译的是模块，不是入口）。
export * from './task-activity.js';
