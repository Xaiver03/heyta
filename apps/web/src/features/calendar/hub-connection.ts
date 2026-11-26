/**
 * 外部日历（Hub）连接在 web 的接线（阶段 A）
 * ==========================================
 *
 * 判断**一行都不在这里**：未配置零请求、失败不动缓存、内容相同不写 op、删除只在
 * 窗口交集里判 —— 全在 `@heyta/app-host` 的 `calendar-mirror.ts`（AGENTS §3.5）。
 * 连「多久算该同步一次」也是 `@heyta/app-host` 的纯函数 `shouldAutoSync`，
 * 本文件只是把浏览器的三个时机（挂载 / 可见·聚焦 / 5 分钟定时器）接到它上面。
 *
 * 本文件只回答 web 的问题：
 *
 * 1. **凭据放哪**：`META_KEYS.CALENDAR_MIRROR_BASE_URL` / `…_TOKEN`。
 *    与公共事实缓存同一个桶（`STORES.META`），因此**不进 op-log、不跨设备** ——
 *    token 是"这台设备怎么访问我的 Hub"，不是一条用户意图（ADR-0052 §2.5 的同一条推理）。
 * 2. **谁去拉**：挂载后、回前台/聚焦时、以及每 5 分钟的定时检查时，按 `shouldAutoSync`
 *    节流决定；用户点「保存并同步」或同步按钮时无条件调一次。
 *    🔴 **定时器只在这一层**（浏览器事件/定时器是平台差异），`calendar-mirror.ts`
 *    里一个定时器都没有。
 * 3. **怎么交给管道**：`currentState` / `dispatchIntent` / `requireStore` 直接满足
 *    `CalendarMirrorPort` 与 `CalendarMirrorOptions` 的形状，不必再造适配层。
 *
 * ⚠️ `loadHubConnection()` 的失败（引擎还没 init）**不抛到界面上**：它唯一的含义是
 * "这台设备还没就绪或还没配过"，而两种情况的恢复动作是同一条 —— 填地址与 token。
 * 真正的故障会由 `runCalendarMirror()` 以一个 `unavailable` 分支回来说清楚。
 */

import {
  CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS,
  refreshCalendarMirror,
  shouldAutoSync,
  type CalendarMirrorRefreshResult,
} from '@heyta/app-host';
import { META_KEYS } from '@heyta/storage';
import { useCallback, useEffect, useRef, useState } from 'react';

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
 * 把 META 里「最近同步时间」归一成毫秒数。
 *
 * 数字型 META 常被当字符串存进来（WebView / 手写值 / 跨版本），所以两型都收；
 * 空串、非数字、`0`、负数、`NaN`、`Infinity` 一律当**没有记录**（`undefined`）——
 * 它们表达的是"读不出有效时间"，而不是"很久以前"。
 *
 * 纯函数，单测直接打它（不依赖 React / 存储）。
 */
export function parseLastSyncMs(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

/** 相对时间的**结构化**结果 —— 具体哪个词由 i18n 决定（这里不产出任何可见文案）。 */
export type SyncAge =
  | { readonly kind: 'never' }
  | { readonly kind: 'justNow' }
  | { readonly kind: 'minutes'; readonly minutes: number }
  | { readonly kind: 'hours'; readonly hours: number }
  | { readonly kind: 'days'; readonly days: number };

/**
 * 「距上次同步多久了」→ 一个分档，交给面板翻成「3 分钟前」这类文案。
 *
 * 分档阈值是纯 UI 语义（多细算"刚刚"、多少个小时折成天），所以放在 web；
 * 它**不**决定要不要同步（那是 `shouldAutoSync`）。时钟回拨（`now < lastSync`）
 * 时把负差夹到 0，显示成「刚刚」而不是「-3 分钟前」。
 */
export function syncAge(lastSyncMs: number | undefined, nowMs: number): SyncAge {
  if (lastSyncMs === undefined || !Number.isFinite(lastSyncMs) || lastSyncMs <= 0) {
    return { kind: 'never' };
  }
  const elapsedRaw = nowMs - lastSyncMs;
  const elapsed = Number.isFinite(elapsedRaw) && elapsedRaw > 0 ? elapsedRaw : 0;
  if (elapsed < 60_000) return { kind: 'justNow' };
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return { kind: 'minutes', minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: 'hours', hours };
  return { kind: 'days', days: Math.floor(hours / 24) };
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
  /** 最近一次成功同步的本地毫秒时间戳；`undefined` = 从未同步过。 */
  readonly lastSyncMs: number | undefined;
  /** 是否有一次自动同步正在进行（面板据此复用「正在同步…」）。 */
  readonly autoSyncing: boolean;
  /** 保存凭据并**回读**保存后的值（面板随后用返回的这组去同步）。 */
  readonly save: (baseUrl: string, token: string) => Promise<HubConnection>;
  /** 手动同步一轮；成功后回读 `lastSyncMs` 并触发重渲染。 */
  readonly sync: () => Promise<CalendarMirrorRefreshResult>;
}

/** 自动同步接线可注入的 web 侧差异（正常路径一个都不传）。 */
export interface HubConnectionHookOptions {
  /** 时钟，默认 `Date.now`。 */
  readonly now?: () => number;
  /** 节流阈值，默认 `CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS`。 */
  readonly minIntervalMs?: number;
  /** 定时检查间隔，默认 `CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS`（5 分钟）。 */
  readonly checkIntervalMs?: number;
  /** 定时器实现，默认全局 `setInterval`（测试注入假实现）。 */
  readonly setIntervalImpl?: (handler: () => void, timeout: number) => ReturnType<typeof setInterval>;
  /** 清定时器实现，默认全局 `clearInterval`。 */
  readonly clearIntervalImpl?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * 面板用的读写口 + 浏览器自动同步接线。
 *
 * **不是全局 store**：凭据只被这一块面板读写，没有第二个消费者，
 * 提到全局 store 只会让"哪块屏在什么时候重读"多一层推理。
 *
 * 自动同步的三个触发点全在这里（`apps/web` 这一层的平台差异），而"该不该同步"
 * 一律交给 `shouldAutoSync` 纯函数：
 *
 *   · 挂载后一次（若判定该同步）；
 *   · `visibilitychange` 变可见 / `window.focus` 时（若判定该同步）；
 *   · 每 `checkIntervalMs` 一次，但只在页面可见时真正检查。
 *
 * 卸载时清掉全部监听与定时器。
 */
export function useHubConnection(options: HubConnectionHookOptions = {}): HubConnectionState {
  const [connection, setConnection] = useState<HubConnection>(EMPTY_CONNECTION);
  const [lastSyncMs, setLastSyncMs] = useState<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);

  // 最新值进 ref：自动同步的回调是稳定的，但它要读"当下的"连接与时间。
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const lastSyncRef = useRef(lastSyncMs);
  lastSyncRef.current = lastSyncMs;
  const mountedRef = useRef(true);
  const autoRunningRef = useRef(false);

  // 挂载时装一次 ref；卸载时置 false，避免异步回来再 setState。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readLastSync = useCallback(async (): Promise<number | undefined> => {
    try {
      return parseLastSyncMs(
        await requireStore().getMetaValue(META_KEYS.CALENDAR_MIRROR_LAST_SYNC),
      );
    } catch {
      return undefined;
    }
  }, []);

  // 首屏：连接 + 最近同步时间一起读（失败都退化成"未配置 / 从未同步"）。
  useEffect(() => {
    let active = true;
    void Promise.all([loadHubConnection(), readLastSync()])
      .then(([loaded, storedLastSync]) => {
        if (!active) return;
        setConnection(loaded);
        setLastSyncMs(storedLastSync);
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
  }, [readLastSync]);

  // 连接在别处（设置 → 数据与同步）被保存后广播 `heyta:calendar-hub-changed`：
  // 重读一次，让日历侧栏的只读议程立刻出现，不必刷新页面。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reload = (): void => {
      void Promise.all([loadHubConnection(), readLastSync()])
        .then(([loaded, storedLastSync]) => {
          setConnection(loaded);
          setLastSyncMs(storedLastSync);
        })
        .catch(() => {
          // 读不出来就维持现状，等下一次事件或刷新。
        });
    };
    window.addEventListener('heyta:calendar-hub-changed', reload);
    return () => {
      window.removeEventListener('heyta:calendar-hub-changed', reload);
    };
  }, [readLastSync]);

  /** 手动同步：拉一轮，成功后回读 lastSync（写盘是管道做的），并触发重渲染。 */
  const sync = useCallback(async (): Promise<CalendarMirrorRefreshResult> => {
    const result = await runCalendarMirror();
    if (result.kind === 'ok' || result.kind === 'not-modified') {
      const next = await readLastSync();
      if (mountedRef.current) setLastSyncMs(next);
    }
    return result;
  }, [readLastSync]);

  /** 自动同步一次（若 `shouldAutoSync` 判定该同步）。任何失败都静默，不打断用户。 */
  const maybeAutoSync = useCallback(async (): Promise<void> => {
    if (autoRunningRef.current) return;
    if (!mountedRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const conn = connectionRef.current;
    if (conn.baseUrl === '' || conn.token === '') return;

    const opts = optionsRef.current;
    const nowMs = (opts.now ?? Date.now)();
    const due = shouldAutoSync({
      lastSyncMs: lastSyncRef.current,
      nowMs,
      ...(opts.minIntervalMs === undefined ? {} : { minIntervalMs: opts.minIntervalMs }),
    });
    if (!due) return;

    autoRunningRef.current = true;
    if (mountedRef.current) setAutoSyncing(true);
    try {
      await sync();
    } catch {
      // 自动同步失败保持静默：面板上的 lastSync 不动就是"这轮没成功"的证据，
      // 不需要再写一条红字打断用户（与手动同步的显式 status 是两回事）。
    } finally {
      autoRunningRef.current = false;
      if (mountedRef.current) setAutoSyncing(false);
    }
  }, [sync]);

  // 浏览器事件 / 定时器 —— 全部只活在 apps/web 这一层。
  useEffect(() => {
    if (!ready) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    // 挂载后先看一次（配置与 shouldAutoSync 由 maybeAutoSync 自己判）。
    void maybeAutoSync();

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void maybeAutoSync();
    };
    const onFocus = (): void => {
      void maybeAutoSync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    const opts = optionsRef.current;
    const checkIntervalMs = opts.checkIntervalMs ?? CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS;
    const setIntervalImpl = opts.setIntervalImpl ?? setInterval;
    const clearIntervalImpl = opts.clearIntervalImpl ?? clearInterval;
    const timer = setIntervalImpl(() => {
      if (document.visibilityState === 'visible') void maybeAutoSync();
    }, checkIntervalMs);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      clearIntervalImpl(timer);
    };
  }, [ready, maybeAutoSync]);

  const save = useCallback(async (baseUrl: string, token: string): Promise<HubConnection> => {
    const next = await saveHubConnection(baseUrl, token);
    setConnection(next);
    return next;
  }, []);

  return { ready, connection, lastSyncMs, autoSyncing, save, sync };
}
