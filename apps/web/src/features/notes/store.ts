/**
 * 便签 store（Web 壳）
 * ======================
 *
 * 与 `features/habits/store.ts` 同一个模板：**建 action → 导出 → `refresh()`
 * → `onEngineChange(refresh)`**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件里**一个判断都不能写**
 *
 * 顺序（钉选 → 更新时间 → id）、摘要怎么截、什么算"空内容"、删除是软删除
 * 还是物理删 —— 全部由 `@heyta/app-host` 的 `createNoteActions` 与
 * `@heyta/domain` 的 `notes.ts` 决定。这里连 `deletedAt` 都不读：
 * `listNotes()` 已经是"未删除且已排序"。
 *
 * ⚠️ 也**绝不许**出现 `entityType: 'NOTE'` 字面量 ——
 * 那是 `pnpm check:layering` 的 `no-op-construction-in-apps` 明令禁止的
 * "外壳自己拼 op"（op 的构造只有 app-host 一份）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createNoteActions, type ActionContext } from '@heyta/app-host';
import type { Note } from '@heyta/domain';
import { create } from 'zustand';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

interface NoteState {
  /** 未删除的便签，**规范顺序**（来自动作层的 `listNotes()`）。 */
  notes: Note[];
  /** 新建失败的原因（内容空白等）。**必须显示出来**，不能点了没反应。 */
  error?: string;
  /**
   * 编辑失败的原因。**刻意与 `error` 分两个字段**：合成一个的话，
   * 上一次"添加失败"的原因会在下一次打开编辑器时出现在编辑器里 ——
   * 那是一条对当下这个动作没有解释的旧错误。
   */
  editError?: string;

  addNote: (content: string) => Promise<void>;
  /**
   * 改正文。**内容没变时动作层不写 op**（`updateNoteContent` 里那条闸门：
   * `UPD` 会推进 `updatedAt`，而它是列表排序的第二段 —— 看一眼就保存会把
   * 这条便签顶到最前）。这里不重复判一遍，只负责"失败要看得见"。
   */
  /**
   * 返回**有没有落成**。界面上"保存成功就收起面板"要的是这个信号；
   * 只回 `Promise<void>` 的话，失败也被 `catch` 咽成 resolve，
   * 面板会在错误刚显示出来的同一帧被关掉。
   */
  updateNote: (entityId: string, content: string) => Promise<boolean>;
  removeNote: (entityId: string) => Promise<void>;
  /** `pinned` 是**目标值**，不是"切换一下"（与动作层契约一致）。 */
  togglePinned: (entityId: string, pinned: boolean) => Promise<void>;
}

/** 与任务 / 习惯 / 提醒 store 同一个形状。只含两个函数引用，不含任何判断。 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

/**
 * 🔴 **web 端唯一一处** `createNoteActions(...)` 的宿主调用点
 * （mobile 侧在 `apps/mobile/src/screens/NotesSection.tsx`）—— `check:reachability`
 * 断言 C 要的"真实宿主调用点"（在那之前 `NOTE` 有写路径却没有任何界面能建它）。
 */
const noteActions = createNoteActions(actionContext);

export const useNoteStore = create<NoteState>((set) => ({
  notes: [],

  addNote: async (content) => {
    try {
      await noteActions.createNote(content);
      set({ error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
    refresh();
  },

  updateNote: async (entityId, content) => {
    let ok = false;
    try {
      await noteActions.updateNoteContent(entityId, content);
      ok = true;
      set({ editError: undefined });
    } catch (error) {
      set({ editError: error instanceof Error ? error.message : String(error) });
    }
    refresh();
    return ok;
  },

  removeNote: async (entityId) => {
    await noteActions.removeNote(entityId);
    refresh();
  },

  togglePinned: async (entityId, pinned) => {
    await noteActions.setNotePinnedToToday(entityId, pinned);
    refresh();
  },
}));

/** 从动作层重新读 —— "哪些算未删除""顺序"都是产品语义，不在这里过滤或排序。 */
function refresh(): void {
  useNoteStore.setState({ notes: noteActions.listNotes() });
}

// 引擎状态变化时自动刷新（含远程 op 应用后）
onEngineChange(refresh);
