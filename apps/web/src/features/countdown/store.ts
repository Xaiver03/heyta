/**
 * 倒数日 store（Web 壳）
 * ======================
 *
 * 与 `features/notes/store.ts` 同一个模板：**建 action → 导出 → `refresh(today)`
 * → `onEngineChange(refresh)`**。这里**一个判断都不写**：
 * 什么算"在用"、什么算"已归档"、按什么顺序 —— 全部问
 * `@heyta/app-host#createEventActions`，本文件不读 `deletedAt` / `archivedAt`，
 * 也不 `sort()`。
 *
 * 🔴 也**绝不许**出现 `entityType: 'EVENT'` 字面量 —— 那是
 * `pnpm check:layering` 的 `no-op-construction-in-apps` 明令禁止的"外壳自己拼 op"。
 *
 * ## 为什么 `refresh` 要接一个 `today`
 *
 * 动作层的 `listEvents(today)` 用"距下一次的天数"排序，而**这个"今天"必须由宿主冻结**
 * （跨午夜的长会话里，同一个列表在两次刷新之间换一天，卡片就会自己重排）。
 * `CountdownView` 把它从 `App` 拿到的 `today` 交进来；引擎变化时沿用**最后一次**
 * 同步的那个 `today`，不是每次现取 `Date.now()`。
 */

import { createEventActions, type ActionContext } from '@heyta/app-host';
import type { CountdownEvent, LocalDate } from '@heyta/domain';
import type { EventEditPatch } from '@heyta/ui';
import { create } from 'zustand';

import { currentState, dispatchIntent, dispatchChecked, onEngineChange } from '../../lib/oplog.js';

interface CountdownState {
  /** 未删未归档（动作层给的顺序）。 */
  events: CountdownEvent[];
  /** 归档视图（顺序同上）。 */
  archivedEvents: CountdownEvent[];
  /** 上一次写入失败的原因（**必须显示**，不能点了没反应）。 */
  error?: string;
  /** 最近一次同步进来的"今天"（引擎变化时复用它，不现取墙上时钟）。 */
  today?: LocalDate;

  syncToday: (today: LocalDate) => void;
  /** 返回 `true` = 已落库（界面据此才清草稿）。 */
  addEvent: (title: string, date: LocalDate) => Promise<boolean>;
  /**
   * 编辑器的一次保存 = 一个 op。
   *
   * 🔴 这里**不做任何翻译**：`yearly` → RRULE 的构造在 `@heyta/app-host`
   * （预设词表是业务语义，让每个界面各拼一条规则串，结局是 web 与手机各拼一种、
   * 各自都能过自己的测试）。
   */
  patchEvent: (entityId: string, patch: EventEditPatch) => Promise<void>;
  togglePinned: (entityId: string, pinned: boolean) => Promise<void>;
  archive: (entityId: string) => Promise<void>;
  unarchive: (entityId: string) => Promise<void>;
  remove: (entityId: string) => Promise<void>;
}

/** 与任务 / 习惯 / 便签 store 同一个形状：只含两个函数引用，不含任何判断。 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  dispatchChecked,
  getState: currentState,
};

/**
 * 🔴 **web 端唯一一处** `createEventActions(...)` 的宿主调用点
 * —— `check:reachability` 断言 C 要的"真实宿主调用点"（W2 之后 `EVENT` 有写路径，
 * 而在这一笔之前没有任何界面能建它）。
 */
const eventActions = createEventActions(actionContext);

export const useCountdownStore = create<CountdownState>((set) => ({
  events: [],
  archivedEvents: [],

  syncToday: (today) => {
    set({ today });
    refresh();
  },

  addEvent: async (title, date) => {
    try {
      await eventActions.createEvent(title, date);
      set({ error: undefined });
      refresh();
      return true;
    } catch (error) {
      // 🔴 失败**不清草稿、不吞掉**：把原因交回界面（便签那条高危不复制）。
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  patchEvent: async (entityId, patch) => {
    try {
      await eventActions.patchEvent(entityId, patch);
      set({ error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
    refresh();
  },

  togglePinned: async (entityId, pinned) => {
    await eventActions.setEventPinned(entityId, pinned);
    refresh();
  },

  archive: async (entityId) => {
    await eventActions.archiveEvent(entityId);
    refresh();
  },

  unarchive: async (entityId) => {
    await eventActions.unarchiveEvent(entityId);
    refresh();
  },

  remove: async (entityId) => {
    await eventActions.removeEvent(entityId);
    refresh();
  },
}));

/**
 * 从动作层重新读。🔴 "哪些算未删除""哪些算归档""按什么顺序"都是产品语义，
 * 不在这里筛或排 —— 所以调的是 `listEvents` / `listArchivedEvents`。
 */
function refresh(): void {
  const today = useCountdownStore.getState().today;
  // 还没拿到宿主冻结的"今天"时**不猜**：一个现取的 `Date.now()` 会让两次刷新
  // 落在不同的天上，而列表自己重排看起来像"同步把顺序搞乱了"。
  if (today === undefined) return;
  useCountdownStore.setState({
    events: eventActions.listEvents(today),
    archivedEvents: eventActions.listArchivedEvents(today),
  });
}

// 引擎状态变化时自动刷新（含远程 op 应用后）
onEngineChange(refresh);
