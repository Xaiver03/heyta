/**
 * 外部日历（Hub）连接在 web 的接线（阶段 A）
 * ==========================================
 *
 * 判断**一行都不在这里**：未配置零请求、失败不动缓存、内容相同不写 op、删除只在
 * 窗口交集里判 —— 全在 `@heyta/app-host` 的 `calendar-mirror.ts`（AGENTS §3.5）。
 *
 * 本文件只回答三个 web 的问题：
 *
 * 1. **凭据放哪**：`META_KEYS.CALENDAR_MIRROR_BASE_URL` / `…_TOKEN`。
 *    与公共事实缓存同一个桶（`STORES.META`），因此**不进 op-log、不跨设备** ——
 *    token 是"这台设备怎么访问我的 Hub"，不是一条用户意图（ADR-0052 §2.5 的同一条推理）。
 * 2. **谁去拉**：用户点「保存并同步」或同步按钮时调一次。这里**不建定时器** ——
 *    标签页会被节流、移动端会被挂起，定时器不是可靠调度器（`calendar-mirror.ts`
 *    文件头已经把这条写死）。
 * 3. **怎么交给管道**：`currentState` / `dispatchIntent` / `requireStore` 直接满足
 *    `CalendarMirrorPort` 与 `CalendarMirrorOptions` 的形状，不必再造适配层。
 *
 * ⚠️ `loadHubConnection()` 的失败（引擎还没 init）**不抛到界面上**：它唯一的含义是
 * "这台设备还没就绪或还没配过"，而两种情况的恢复动作是同一条 —— 填地址与 token。
 * 真正的故障会由 `runCalendarMirror()` 以一个 `unavailable` 分支回来说清楚。
 */

import {
  refreshCalendarMirror,
  type CalendarMirrorRefreshResult,
} from '@heyta/app-host';
import { META_KEYS } from '@heyta/storage';
import { useCallback, useEffect, useState } from 'react';

import { currentState, dispatchIntent, requireStore } from '../../lib/oplog.js';

/** Hub 连接的**可持久化部分**。token 只在这台设备上，不随数据同步。 */
export interface HubConnection {
  readonly baseUrl: string;
  readonly token: string;
}

/** 只有一对 META 读写 —— `OpLogStore` 结构上满足它，测试可以给一个内存假实现。 */
export interface HubMetaPort {
  getMetaValue(key: string): Promise<string | number | undefined>;
  setMetaValue(key: string, value: string | number): Promise<void>;
}

const EMPTY_CONNECTION: HubConnection = { baseUrl: '', token: '' };

/** META 里可能是数字或缺失；只有字符串才算"配过"。 */
function asText(value: string | number | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 读回本机保存的 Hub 连接。
 *
 * 默认走 `requireStore()`（任务要求的唯一入口）；测试注入一个假 store 即可
 * 不依赖 SQLite / IndexedDB 覆盖"存进去能读回来"这件事。
 */
export async function loadHubConnection(
  store: HubMetaPort = requireStore(),
): Promise<HubConnection> {
  const baseUrl = await store.getMetaValue(META_KEYS.CALENDAR_MIRROR_BASE_URL);
  const token = await store.getMetaValue(META_KEYS.CALENDAR_MIRROR_TOKEN);
  return { baseUrl: asText(baseUrl), token: asText(token) };
}

/**
 * 保存 Hub 连接并回读**归一后**的值（与 `refreshCalendarMirror` 的 `trim()` 同一口径）。
 *
 * 两个键**各写一次**：`setMetaValue` 没有事务语义，但这两个键不是原子事实 ——
 * 只有地址没有 token 时管道会判 `unconfigured` 并**零请求**，所以中间态是安全的。
 */
export async function saveHubConnection(
  baseUrl: string,
  token: string,
  store: HubMetaPort = requireStore(),
): Promise<HubConnection> {
  const next = { baseUrl: baseUrl.trim(), token: token.trim() };
  await store.setMetaValue(META_KEYS.CALENDAR_MIRROR_BASE_URL, next.baseUrl);
  await store.setMetaValue(META_KEYS.CALENDAR_MIRROR_TOKEN, next.token);
  return next;
}

/** 一次同步可以覆盖的参数（测试注入时钟 / fetch；正常路径一个都不传）。 */
export interface RunCalendarMirrorOverrides {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly now?: () => number;
  readonly windowPastMs?: number;
  readonly windowFutureMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (message: string) => void;
}

/**
 * 拉一轮并落 op。未保存连接时管道自己回 `unconfigured`（**零请求**），
 * 这里不替它判一次"配没配"。
 */
export async function runCalendarMirror(
  overrides: RunCalendarMirrorOverrides = {},
): Promise<CalendarMirrorRefreshResult> {
  const saved = await loadHubConnection();
  return refreshCalendarMirror(
    {
      baseUrl: overrides.baseUrl ?? saved.baseUrl,
      token: overrides.token ?? saved.token,
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
      ...(overrides.windowPastMs === undefined ? {} : { windowPastMs: overrides.windowPastMs }),
      ...(overrides.windowFutureMs === undefined
        ? {}
        : { windowFutureMs: overrides.windowFutureMs }),
      ...(overrides.fetchImpl === undefined ? {} : { fetchImpl: overrides.fetchImpl }),
      ...(overrides.log === undefined ? {} : { log: overrides.log }),
    },
    {
      getState: currentState,
      dispatch: dispatchIntent,
      getMetaValue: (key) => requireStore().getMetaValue(key),
      setMetaValue: (key, value) => requireStore().setMetaValue(key, value),
    },
  );
}

export interface HubConnectionState {
  /** META 读完了没有。`false` 时面板既不画表单也不画空态（避免闪一下"未配置"）。 */
  readonly ready: boolean;
  readonly connection: HubConnection;
  /** 保存凭据并**回读**保存后的值（面板随后用返回的这组去同步）。 */
  readonly save: (baseUrl: string, token: string) => Promise<HubConnection>;
  readonly sync: () => Promise<CalendarMirrorRefreshResult>;
}

/**
 * 面板用的读写口。**不是全局 store**：凭据只被这一块面板读写，没有第二个消费者，
 * 提到全局 store 只会让"哪块屏在什么时候重读"多一层推理。
 */
export function useHubConnection(): HubConnectionState {
  const [connection, setConnection] = useState<HubConnection>(EMPTY_CONNECTION);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadHubConnection()
      .then((loaded) => {
        if (!active) return;
        setConnection(loaded);
      })
      .catch((error: unknown) => {
        // 引擎没就绪 / 存储读不出来：保持"未配置"，让用户能重新填。
        // 不把内部错误原文渲染给用户（同 `card-export` 那次更正）。
        console.warn(
          `[calendar-hub] load connection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (baseUrl: string, token: string): Promise<HubConnection> => {
    const next = await saveHubConnection(baseUrl, token);
    setConnection(next);
    return next;
  }, []);

  const sync = useCallback((): Promise<CalendarMirrorRefreshResult> => runCalendarMirror(), []);

  return { ready, connection, save, sync };
}
