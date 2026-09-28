/**
 * 便签的领域规则 —— **"哪些便签、按什么顺序、正文能有多长"只有一个定义**
 * ================================================================
 *
 * 这个文件补的是**幻觉 #12「笔记模块」**的领域层。实体形状在
 * `entities.ts` 的 {@link Note}，op 的构造在 `packages/app-host/src/note-actions.ts`；
 * 这里只有**纯函数**。
 *
 * ## 为什么便签是独立实体，而不是任务的一个字段
 *
 * 判据与 `reminders.ts` 是同一套（也可以对照 `entities.ts` 否决
 * `TASK_REPEAT_CFG` 的那段推理）：
 *
 * 1. **任务已经有 `note` 字段**（`packages/app-host/src/duration-note.ts` 往里面
 *    写估时）。那是**任务的正文**，生命周期与任务绑死。便签是**独立的一条记录**：
 *    可以不挂任何项目（`projectId: null`）、可以钉到「今天」、可以在任务
 *    不存在时仍然存在。把便签做成 `Task.note` 的别名会让"删掉任务"顺手
 *    删掉用户的便签 —— 而用户从没表达过这个意图。
 * 2. **一个用户意图 = 一个 op**（AGENTS.md §3.4）。做成 `Project.notes[]`：
 *    加一条便签要重写整个项目 → 与"改项目名"在同一实体上 LWW 互斥，
 *    且单条便签的删除/钉选根本表达不出来。独立实体让每条便签有自己的 id
 *    与时钟 —— 与 `HabitLog` 相对 `Habit`、`Reminder` 相对 `Task` 是同一条推理。
 *
 * ## 这个文件钉住的三件事（写在 UI 里就会各端漂移）
 *
 * 1. **排序**（{@link sortNotesForDisplay}）：钉到「今天」的在前，然后按
 *    `updatedAt` 降序，再按 id 字典序。三段缺一不可 ——
 *    少了最后一段，同一毫秒更新的两条便签在两端会**换位置**，用户会以为
 *    "同步把顺序搞乱了"。
 * 2. **"钉到今天就等于置顶"是同一个字段**（{@link isNoteHighlighted}），
 *    不是两套排序规则。做成两个字段必然在一次编辑里漂移。
 * 3. **正文长度是闸门不是玩法**（{@link NOTE_MAX_CONTENT_LENGTH}）：
 *    上限拦的是病态数据（一次粘贴整本书），不是产品限制。
 *
 * ⚠️ **不发明默认值**：`isPinnedToToday` / `projectId` 的默认值在
 * `note-actions.ts` 的 `createNote` 里显式写出，这里不做"缺省填充" ——
 * 一个纯函数悄悄替调用方决定默认值，会让两端出现两种默认。
 */

import type { Note } from './entities.js';

/**
 * 单条便签正文的长度上限（字符数）。
 *
 * ⚠️ 与 `MAX_CAPTURE_INPUT_LENGTH` 那类"输入框闸门"同一个性质：
 * 它拦的是**病态数据**（一次粘贴整本书 → 每次同步都要带上它、
 * 每次渲染都要测量它），不是产品规格。真要做长文，正确的做法是
 * 先定"便签要不要分页/懒加载"，而不是把这个数字调大。
 */
export const NOTE_MAX_CONTENT_LENGTH = 10_000;

/** 建便签 / 改正文的拒绝原因。**返回原因而不是抛错** —— 调用方要能给出提示。 */
export type NoteRejection = 'empty' | 'too-long';

/**
 * 校验正文。合法则返回 `undefined`。
 *
 * 🔴 **空白算空**（`trim()` 后判断）：一条内容全是空格的便签在列表里
 * 是一行看不见的字，用户点了却找不到自己建了什么。宁可拒绝。
 */
export function noteRejection(content: string): NoteRejection | undefined {
  if (content.trim() === '') return 'empty';
  if (content.length > NOTE_MAX_CONTENT_LENGTH) return 'too-long';
  return undefined;
}

/** 未删除的便签。 */
export function aliveNotes(notes: readonly Note[]): Note[] {
  return notes.filter((note) => note.deletedAt === undefined);
}

/**
 * 便签在界面上的**规范顺序**。
 *
 * 见文件头第 1 条：钉到「今天」的在前 → `updatedAt` 降序 → id 字典序。
 * 顺序**必须确定**：两台设备画的是同一批便签，顺序若不同，用户会以为
 * "同步把顺序搞乱了"。同刻按 id 是唯一在任何端都一致的决胜规则。
 */
export function sortNotesForDisplay(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.isPinnedToToday !== b.isPinnedToToday) return a.isPinnedToToday ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 这条便签是不是"高亮"的（钉到「今天」）。
 *
 * 🔴 见文件头第 2 条：**只有一个字段**。界面要画徽标、要分组、
 * 要决定排序，全部问这个函数 —— 不要在各端各写一次 `note.isPinnedToToday`，
 * 那样将来加第二种高亮（例如"重要"）时，只有一半的地方会更新。
 */
export function isNoteHighlighted(note: Note): boolean {
  return note.isPinnedToToday;
}

/**
 * 便签的**归属**：某个项目，还是"未归属"。
 *
 * `null` 与 `undefined` 在这里是**同一件事**（未归属）—— 上游用
 * `projectId: null`，而 op 载荷里"没给这个键"也会读成 `undefined`。
 * 两处不等价的话，"未归属的便签"在不同端会分成两组。
 */
export function noteProjectId(note: Note): string | null {
  return note.projectId ?? null;
}

/**
 * 某归属下的便签（已过滤墓碑，已排序）。
 *
 * `projectId` 传 `null` = 未归属那组。**这个函数是"便签属于谁"的唯一判据**，
 * 界面不要自己 `filterBy` —— 那会漏掉 `null` / `undefined` 的等价性。
 */
export function notesInGroup(notes: readonly Note[], projectId: string | null): Note[] {
  return sortNotesForDisplay(
    aliveNotes(notes).filter((note) => noteProjectId(note) === projectId),
  );
}

/**
 * 列表里显示正文的**摘要**：取第一段非空行，超长截断并加省略号。
 *
 * 为什么按**行**而不是按字符数硬切：便签正文常常第一行就是标题
 * （"买菜 / 西红柿 / 鸡蛋"）。硬切会在单词中间断开，读起来像乱码；
 * 取第一行则天然是用户自己写的结构。
 *
 * ⚠️ 省略号是 `…`（U+2026）而不是三个点：三个点在等宽字体里宽度是 3 格，
 * 在比例字体里是 1 个字符，会让两端截断位置看起来不一样。
 */
export function noteExcerpt(note: Note, maxLength: number): string {
  const firstLine =
    note.content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, Math.max(0, maxLength - 1))}…`;
}
