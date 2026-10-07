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
  NOTE_EXCERPT_LENGTH,
  noteExcerpt,
  sortNotesForDisplay,
  type Note,
} from '@heyta/domain';

/**
 * 摘要长度的**所有者是领域层**（`@heyta/domain#NOTE_EXCERPT_LENGTH`）：
 * 回收站那一行与 node-host 的 CLI 都要用同一个截断位置，而它们不依赖本包。
 * 这里不再转出它 —— 一个常量有两个转出点，抄件就开始漂。
 */

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

/**
 * 草稿"看起来是空的"吗 —— **共享层唯一的交互挡板**。
 *
 * 与 `NotesBoard` 的 composer 同一条判据、同一个出处：按了提交却什么都没发生，
 * 用户读到的是"这个按钮坏了"。它**不是**内容规则 —— 什么算空正文、多长算超长，
 * 权威在 `@heyta/app-host#createNoteActions`（`noteRejection`）。
 *
 * ⚠️ "正文没改动就不要写 op" **不在这里判**，那条住在 `updateNoteContent`：
 * 写不写 op 是产品语义（AGENTS §3.5），而这里只决定按钮灰不灰。
 */
export function isNoteDraftBlank(draft: string): boolean {
  return draft.trim() === '';
}

/* ════════════════════════════════════════════════════════════════════════
 * 提交结局与 composer 状态机（W8a）
 * =======================================================================
 *
 * 🔴 修的是哪条：`NotesBoard` 的 submit 原来是「先 `onAdd` 再无条件
 * `setDraft('')`」—— `onAdd` 失败（最现实的一例：正文超过 10,000 字上限被
 * `createNoteActions` 拒绝）时，**错误被吞掉、用户刚敲的内容也被清掉**。
 * 上限拒绝恰恰发生在用户写得最用心的那一次。
 *
 * 两件事分开定义、分开可测：
 *   1. 「这一次提交成没成」（{@link runNoteSubmit}）—— 两种失败形态
 *      （同步 throw / Promise reject）在这里折成一个结局；
 *   2. 「结局落到界面上是什么样」（{@link noteComposerAfterOutcome}）——
 *      失败保草稿、成功才清。组件零分支套用它们的输出，所以这里红 = 那里红。
 * ════════════════════════════════════════════════════════════════════════ */

/** 一次提交尝试的结局。 */
export type NoteSubmitOutcome =
  | /** 草稿看起来是空的：**没有调用 `onAdd`**（挡板，见 `isNoteDraftBlank`）。 */
  'blank'
  | /** `onAdd` 正常返回，或返回的 Promise 兑现。 */
  'saved'
  | /** `onAdd` 同步 throw，或返回的 Promise reject —— 两种形态一视同仁。 */
  'failed';

/**
 * 跑一次提交：空白挡板 + 把两种失败形态都兜住。
 *
 * ⚠️ 宿主的 `onAdd` 两种形态都真实存在：`createNote` 是 async 函数，它内部
 * 同步 `throw` 出去也会变成 reject；而宿主的接线函数本身完全可能同步 throw。
 * 只兜其中一种，另一种就还是"静默吞掉"。
 *
 * 这一层**不决定**失败后界面长什么样（那是 `noteComposerAfterOutcome` 的事），
 * 也不吞掉错误细节之外的东西：错误对象在这里就地丢弃 —— 共享层只呈现
 * `labels.saveFailed` 那一句，要说更具体的原因是宿主（i18n）的事。
 */
export async function runNoteSubmit(
  draft: string,
  onAdd: (content: string) => void | Promise<void>,
): Promise<NoteSubmitOutcome> {
  if (isNoteDraftBlank(draft)) return 'blank';
  try {
    await onAdd(draft);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** composer 的状态：草稿 +「上一次提交失败了吗」。 */
export interface NoteComposerState {
  readonly draft: string;
  /** 为 `true` 时 composer 下方渲染 `labels.saveFailed`（alert 语义）。 */
  readonly saveFailed: boolean;
}

/** 初始状态：空草稿、无提示。 */
export const NOTE_COMPOSER_INITIAL: NoteComposerState = { draft: '', saveFailed: false };

/**
 * 用户又敲了一个字。🔴 **错误提示不在打字时熄灭**，保留到下一次提交的结局
 * 来更新它为止："上一次没存上"这个事实在用户改字期间仍然成立，边打边闪
 * 还会让读屏用户听到提示被反复播报又反复撤回。
 */
export function noteComposerTyping(state: NoteComposerState, draft: string): NoteComposerState {
  return { ...state, draft };
}

/**
 * 把提交结局落到 composer 状态上。
 *
 * - `blank`：什么都没发生，状态原样；
 * - `failed`：🔴 **草稿原样保留**（W8a 的核心）+ 亮提示 —— 保留的是**当前**
 *   整份草稿：落库在途期间用户接着敲的字也是用户的输入，一样不能吞；
 * - `saved`：清草稿 + 熄提示 —— 但**只清"仍是所提交内容"的那一份**：草稿
 *   若已在落库期间被改动，说明用户开始了下一条，清掉等于把在途输入吞掉
 *   （与失败吞草稿同一种罪，只是更难得逞）。
 */
export function noteComposerAfterOutcome(
  state: NoteComposerState,
  submitted: string,
  outcome: NoteSubmitOutcome,
): NoteComposerState {
  if (outcome === 'blank') return state;
  if (outcome === 'failed') return { ...state, saveFailed: true };
  return { draft: state.draft === submitted ? '' : state.draft, saveFailed: false };
}
