/**
 * 便签板（共享模型）
 * ====================
 *
 * M3 第十刀（reminders / notes 同一刀）里便签那一半的**判断层**：
 * 列表按什么顺序排、每条的摘要是什么、这一条算不算"钉到今天"。**组件里
 * 因此没有排序、没有截断、没有高亮判断**，不需要靠快照测试兜。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 领域规则**一条都不在这里重写**
 *
 * 顺序只有一个定义：`@heyta/domain` 的 {@link sortNotesForDisplay}
 * （钉到今天的在前 → `updatedAt` 降序 → id 字典序，三段缺一不可，
 * 少最后一段会让同毫秒更新的两条便签在两端换位置）。
 * 摘只有一个定义：{@link noteExcerpt}（取第一段非空行，超长截断带 `…`）。
 *
 * 🔴 `isPinned` 走 `isNoteHighlighted()` 而不是 `note.isPinnedToToday`。
 * `notes.ts` 的文件头点名了这件事：高亮**只有一个字段**，界面要画徽标、
 * 要排序、要分组都问那个函数 —— 各端各写一次 `note.isPinnedToToday`，
 * 将来加第二种高亮时只有一半的地方会更新。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native`
 * 是 Flow 源码，node 解析不了它。这条约束顺带钉住了"model 必须宿主无关"。
 * 后者：i18n 包自己带过一份 React，四端会同时中招（见 `TaskList.tsx` 文件头）。
 */

import {
  isNoteHighlighted,
  noteExcerpt,
  sortNotesForDisplay,
  type Note,
} from '@heyta/domain';

/**
 * 列表默认的摘要长度（字符数）。
 *
 * ⚠️ 它是**展示**尺度，不是领域闸门（内容上限是 `noteExcerpt` 之外的
 * `NOTE_MAX_CONTENT_LENGTH`）。60 与迁移前 web 便签列表的视觉行宽一致 ——
 * 改它会让所有已有截图里的截断位置变一次，所以它是常量而不是随手传的魔数。
 */
export const NOTE_EXCERPT_LENGTH = 60;

/**
 * 一条便签在列表里的一行。
 *
 * `id` 同时是 React key、`onRemove` / `onTogglePinned` 的 `entityId`，
 * 以及 `a11yRemove(excerpt)` 之外各无障碍名的来源 —— 便签的动作都作用于
 * 便签自己（不像提醒要作用到归属任务），所以这里没有第二个 id 字段。
 */
export interface NoteRow {
  /** 便签实体 id。 */
  readonly id: string;
  /** 摘要（**由 `noteExcerpt` 产出**，已截断/取首行）。 */
  readonly excerpt: string;
  /** 是否钉到「今天」（**由 `isNoteHighlighted` 判定**）。 */
  readonly isPinned: boolean;
}

/**
 * 未删除的便签 → 列表行，**顺序即展示顺序**。
 *
 * ⚠️ 传进来的 `notes` 必须已经滤掉墓碑（宿主的 `listNotes()` 已经是）。
 * 这里**不再滤一遍** —— `sortNotesForDisplay` 本身也不滤，
 * 两处各滤一次会让"删除之后这一条还算不算数"出现两个答案
 * （与 `toReminderRows` / `toHabitProgressRows` 同一条约定）。
 *
 * `excerptLength` 默认 {@link NOTE_EXCERPT_LENGTH}，显式传入即可在窄屏上
 * 收短摘要 —— 但**截断算法仍然只有 `noteExcerpt` 一处**。
 */
export function toNoteRows(
  notes: readonly Note[],
  excerptLength: number = NOTE_EXCERPT_LENGTH,
): NoteRow[] {
  return sortNotesForDisplay(notes).map((note) => ({
    id: note.id,
    excerpt: noteExcerpt(note, excerptLength),
    isPinned: isNoteHighlighted(note),
  }));
}
