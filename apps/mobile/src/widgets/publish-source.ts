import { materializedState, type AppHost } from '@heyta/app-host';

import { currentFocusState } from '../lib/focus-timer';
import type { WidgetPublishSource } from './publish';

/**
 * 生产用的发布来源：物化状态 + 当前专注状态。
 *
 * ============================================================
 * 🔴 为什么这个函数**不在** `publish.ts` 里
 * ============================================================
 *
 * 因为它要 import `../lib/focus-timer`，而 `focus-timer` 又会（为了提交专注记录）
 * import `../db/open-host`，后者 import `@op-engineering/op-sqlite` ——
 * **在 node 里加载不了**（`Cannot find module '.../op-sqlite/node/dist/database'`）。
 *
 * 移动端的测试**刻意不 import `react-native` / 原生模块**，所以一旦
 * `publish.ts` 直接依赖 `focus-timer`，整个发布管线的纯逻辑就**一条都测不到** ——
 * 包括那个"补跑要重读状态"的合并语义，而那正是最容易悄悄丢数据的地方。
 *
 * 所以按"能不能在 node 里跑"把文件切开：
 *
 * | 文件 | 依赖 | 可测？ |
 * |---|---|---|
 * | `publish.ts` | 只有 domain / widget-core / 一个时间纯函数 | ✅ |
 * | 本文件 | app-host + focus-timer（→ op-sqlite） | ❌（靠类型检查兜住） |
 *
 * ⚠️ 这不是"为了测试而拆分"：切出来的正是**纯计算**与**平台接线**的分界，
 * 与 `src/sync/auto-sync-core.ts` 被抽出来的理由是同一个。
 */
export function hostPublishSource(host: AppHost): WidgetPublishSource {
  return {
    read: () => ({ state: materializedState(host), focus: currentFocusState() }),
  };
}
