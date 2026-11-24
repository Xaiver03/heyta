/**
 * 任务结构化子项（checklist）的**纯函数**
 * ======================================
 *
 * 无框架依赖。增 / 改 / 删 / 勾选 / 排序、n/m 进度、全勾自动完成父任务的判定都在这里。
 * 读取侧回退旧 `note` 里的 `- [ ]`（懒升级、不迁移）——旧数据不搬家、不失效。
 *
 * 🔴 与「子任务」是两套东西：子任务是带排期的 Task（`Task.parentId`），这里是任务详情里的勾选项。
 */

import type { Task, TaskChecklistItem } from './entities.js';
export type { TaskChecklistItem } from './entities.js';
import { parseChecklistFromNote } from './timeline.js';

export interface ChecklistView {
  id: string;
  text: string;
  done: boolean;
}

/**
 * 读取清单：结构化优先；否则从 `note` 的 `- [ ]` 回退（合成稳定 id `note-<i>`）。
 * 回退结果只用于**读**，不回写 `Task.checklist`（那是用户下次编辑时才发生的事）。
 */
export function readChecklist(task: Pick<Task, 'note' | 'checklist'>): ChecklistView[] {
  if (task.checklist !== undefined) {
    return task.checklist.map((it) => ({ id: it.id, text: it.text, done: it.done }));
  }
  return parseChecklistFromNote(task.note).map((it, i) => ({
    id: `note-${String(i)}`,
    text: it.title,
    done: it.done === true,
  }));
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

/** n/m 进度。 */
export function checklistProgress(items: readonly TaskChecklistItem[]): ChecklistProgress {
  let done = 0;
  for (const it of items) if (it.done) done += 1;
  return { done, total: items.length };
}

/** 全勾（且非空）。空清单不算"完成"。 */
export function isChecklistComplete(items: readonly TaskChecklistItem[]): boolean {
  return items.length > 0 && items.every((it) => it.done);
}

/** 追加一条（id 由调用方给；文本可重复，id 唯一即可）。 */
export function appendChecklistItem(
  items: readonly TaskChecklistItem[],
  item: TaskChecklistItem,
): TaskChecklistItem[] {
  return [...items, item];
}

export function updateChecklistItemText(
  items: readonly TaskChecklistItem[],
  id: string,
  text: string,
): TaskChecklistItem[] {
  return items.map((it) => (it.id === id ? { ...it, text } : it));
}

export function removeChecklistItem(items: readonly TaskChecklistItem[], id: string): TaskChecklistItem[] {
  return items.filter((it) => it.id !== id);
}

export function toggleChecklistItem(
  items: readonly TaskChecklistItem[],
  id: string,
  done: boolean,
): TaskChecklistItem[] {
  return items.map((it) => (it.id === id ? { ...it, done } : it));
}

/** 把某一条移到 `toIndex`（越界自动夹到 [0, len-1]）。找不到 id 原样返回副本。 */
export function reorderChecklistItem(
  items: readonly TaskChecklistItem[],
  id: string,
  toIndex: number,
): TaskChecklistItem[] {
  const from = items.findIndex((it) => it.id === id);
  if (from === -1) return [...items];
  const clamped = Math.max(0, Math.min(Math.trunc(toIndex), items.length - 1));
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * 子项全勾是否应**自动把父任务置完成**。
 * 仅当：非空、全勾、父任务未完成、未放弃、**非重复**（重复任务不自动完成，避免推进周期）。
 */
export function shouldAutoCompleteFromChecklist(
  task: Pick<Task, 'completedAt' | 'abandonedAt' | 'repeatRule'>,
  items: readonly TaskChecklistItem[],
): boolean {
  return (
    isChecklistComplete(items) &&
    task.completedAt === undefined &&
    task.abandonedAt === undefined &&
    task.repeatRule === undefined
  );
}
