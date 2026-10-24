/**
 * 用户侧的公告状态（ADR-0075）。
 * ==============================
 *
 * ## 🔴 "忽略"是**这台设备**的，不是账号的
 *
 * 关掉一条公告 ⇒ 只记在本机。服务端记"谁读过哪条公告"是一次**新增的个人信息处理**
 * （账号维度的阅读史），而它换来的便利只是少点一次关闭 —— 与"本地优先 +
 * 服务端看不到用户明文"这个前提方向相反。ADR-0075 §3.5 记的就是这笔取舍。
 *
 * 后果要写清楚：换一台设备，同一条公告会再出现一次。
 *
 * ## 它**不**判有效性
 *
 * 列表来自服务端那条查询，界面不许再比一次时间戳（§3.4 只有一个裁决者）。
 * 所以这里也没有"过期就自动消失"的定时器 —— 下一次 `load()` 自然带回正确答案。
 */
import { create } from 'zustand';

import { fetchActiveAnnouncements, type ActiveAnnouncement } from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 本机已忽略的公告 id。存 localStorage，**不进 op-log**（它不是用户的数据）。 */
const DISMISSED_STORAGE_KEY = 'heyta.announcements.dismissed';

function readDismissed(): number[] {
  try {
    const raw = globalThis.localStorage?.getItem(DISMISSED_STORAGE_KEY);
    if (raw === null || raw === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === 'number');
  } catch {
    // 隐私模式下**访问** localStorage 这个属性本身就会抛（同 `lib/theme.ts` 的契约）。
    // 抛了就当"没忽略过任何一条" —— 宁可多看一眼，不许因此不显示公告。
    return [];
  }
}

function writeDismissed(ids: number[]): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 存不上不致命：本次会话内仍然生效。
  }
}

interface AnnouncementStoreState {
  /** 服务端说"现在挂着"的那些。`null` = 还没拉过（与"一条都没有"是两件事）。 */
  items: readonly ActiveAnnouncement[] | null;
  dismissed: number[];
  load: () => Promise<void>;
  dismiss: (id: number) => void;
}

export const useAnnouncementStore = create<AnnouncementStoreState>((set, get) => ({
  items: null,
  dismissed: readDismissed(),

  load: async () => {
    const { baseUrl, token } = useSyncStore.getState();
    const result = await fetchActiveAnnouncements({ baseUrl, getToken: async () => token });
    // 拉不到就**什么都不画**：一条"服务器出错了"的红条会把这个横条变成故障现场，
    // 而它承载的不是用户的数据，坏了也不该打扰他。
    if (!result.ok) {
      set({ items: [] });
      return;
    }
    set({ items: result.announcements });
  },

  dismiss: (id) => {
    const next = [...new Set([...get().dismissed, id])];
    writeDismissed(next);
    set({ dismissed: next });
  },
}));

/** 测试用：归零（与其它 feature store 同名同形）。 */
export function __resetAnnouncementsForTests(): void {
  useAnnouncementStore.setState({ items: null, dismissed: [] });
  try {
    globalThis.localStorage?.removeItem(DISMISSED_STORAGE_KEY);
  } catch {
    // 同上，忽略。
  }
}
