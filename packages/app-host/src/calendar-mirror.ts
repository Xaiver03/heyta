/**
 * 外部日历（Hub）→ `CALENDAR_EVENT` 的只读镜像管道（阶段 A）
 * ==========================================================
 *
 * 形状：`GET /api/v1/events?expand=true&from&to` → 逐行投影 → 与物化状态逐字段比 →
 * 不同才 `dispatch` → 交集窗口内消失的行写 `deletedAt`（Hub 设计稿 §4.1 / §4.3）。
 *
 * ## 为什么轮询住在这里
 *
 * 它不在 `packages/sync-core`（那是 vendored 的 op 传输原语，不该知道第三方 API），
 * 也不在 `packages/op-log`（那是事实日志，"什么时候去 HTTP 一次"是调度器语义）。
 * 壳只负责在**启动 / 回前台 / 用户点同步**三个时机调一次；本模块**不建内部定时器** ——
 * 标签页会被节流、移动端会被挂起，定时器在这些环境里不是可靠的调度器。
 *
 * ## 五条硬约束（每条都对应一种"静默错"）
 *
 * 1. 🔴 **未配置就零请求**：`baseUrl` 或 `token` 为空 ⇒ 直接 `unconfigured`。
 *    自托管用户没接 Hub 时，每 5 分钟往一个空地址发请求只会在面板上留下红字。
 * 2. 🔴 **失败不动缓存**：网络失败 / 非 200 / 200 但 body 不是约定形状 ⇒
 *    不写窗口、不写 ETag、`dispatch` 一条都不发。界面照旧画上一轮（判据同
 *    `public-facts.ts:242-245` 的 `bad-shape`：一份说假话的新数据不该挤掉一份能用的旧数据）。
 * 3. 🔴 **内容相同不写 op**：去抖住在领域层的 `calendarEventEquivalent` /
 *    `calendarEventPatch` 里，这里只负责"不比就不发"。
 * 4. 🔴 **删除只在两轮窗口的交集里判**，且母事件不参与（`calendarEventShouldDelete`）。
 * 5. 🔴 **payload 不写 `updatedAt`**：那是 reducer 从 op 时间戳派生的"这条 op 什么时候
 *    被写入"。载荷里再给一份，离线重放与跨设备并发时会造出两个来源（`entities.ts`
 *    的 `sourceUpdatedAt` 就是为这件事单独开的格子）。
 *
 * ## 唯一一处"额外"的写：`sourceUpdatedAt`
 *
 * Hub 今天不输出事件级更新时间（设计稿 §1.2 U10），所以只能用**本机写入时刻**代替 ——
 * 这一格是 `待确认` 的临时值，读侧不许拿它做任何"源侧什么时候改的"的判断。
 */

import {
  CALENDAR_EVENT_WINDOW_FUTURE_MS,
  CALENDAR_EVENT_WINDOW_PAST_MS,
  calendarEventEquivalent,
  calendarEventFromHub,
  calendarEventPatch,
  calendarEventShouldDelete,
  calendarEventWindowIntersection,
  calendarEventWindowKey,
  parseCalendarEventWindow,
  type CalendarEventWindow,
} from '@heyta/domain';
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import { META_KEYS } from '@heyta/storage';
import { OpType } from '@heyta/sync-core';
import type { EntityType } from '@heyta/shared-schema';

import { joinEndpointUrl } from './endpoint-url.js';

/** Hub 的事件端点（`GET`）。路径写死在这里的理由：它不是本仓的契约注册表管的东西。 */
const CALENDAR_MIRROR_EVENTS_PATH = '/api/v1/events';

/** `dispatch` 用的实体类型字面量（`shared-schema` 的 `ENTITY_TYPES` 里有它）。 */
const CALENDAR_EVENT_ENTITY = 'CALENDAR_EVENT' as EntityType;

/**
 * 管道需要的宿主能力 —— **只有四个方法**。
 *
 * 收窄到"读状态 + 派发 + 一对 META 读写"，于是本模块**不可能**绕开 op-log 去改状态
 * （它压根没有 `setState`），也不可能顺手去碰别的桶。结构上 `AppHost` 直接满足它：
 * 三个宿主传 `host` 那一份即可，不必再造适配层。
 */
export interface CalendarMirrorPort {
  getState(): MaterializedState;
  dispatch(intent: OpIntent): Promise<unknown>;
  getMetaValue(key: string): Promise<string | number | undefined>;
  setMetaValue(key: string, value: string | number): Promise<void>;
}

export interface CalendarMirrorOptions {
  /** Hub 根地址，例如 `http://127.0.0.1:8787`。空串 = 未配置（零请求）。 */
  readonly baseUrl: string;
  /** Hub 的 Bearer token。空串 = 未配置（零请求）。 */
  readonly token: string;
  /** 时钟，便于测试注入。默认 `Date.now`。 */
  readonly now?: () => number;
  /** 窗口往前多少毫秒，默认 14 天。 */
  readonly windowPastMs?: number;
  /** 窗口往后多少毫秒，默认 60 天。 */
  readonly windowFutureMs?: number;
  /** 网络实现，便于测试注入。默认 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 只读日志端口。宿主不给就静默。 */
  readonly log?: (message: string) => void;
}

export type CalendarMirrorUnavailableCause =
  | 'network'
  /** Hub 回了非 200/304（含 401：token 过期也是这一档，不单独分支）。 */
  | 'http-status'
  /** 200 但 body 不是 `{events: [...]}` —— 绝不能拿它去覆盖一份好缓存。 */
  | 'bad-shape';

/**
 * 一轮的结果。
 *
 * ⚠️ **没有 `error` 这一支**是刻意的：这条通道的失败在产品里不是事件（与
 * `public-facts.ts` 的 `PublicFactsRefreshResult` 同一条纪律）。它必须可观测，
 * 所以带着 `cause` 回来给日志与测试，但类型上就产生不出"把日历清空"这个动作。
 */
export type CalendarMirrorRefreshResult =
  | {
      readonly kind: 'ok';
      readonly added: number;
      readonly updated: number;
      readonly deleted: number;
      /** 投影被拒（缺键 / 空标题）而跳过、且**没有** dispatch 的行数。 */
      readonly skipped: number;
    }
  /** 条件请求命中 304：本轮不 diff、不 dispatch。 */
  | { readonly kind: 'not-modified' }
  /** 没配 Hub ⇒ 一个请求都不发。 */
  | { readonly kind: 'unconfigured' }
  /** 拿不到：窗口与缓存一个字节都不动。 */
  | { readonly kind: 'unavailable'; readonly cause: CalendarMirrorUnavailableCause };

/**
 * 拉一轮并落 op。
 *
 * 顺序是刻意的：**先请求、后取状态**。反过来（先取状态再等网络）会把一轮几百毫秒
 * 的网络延迟算进"状态快照"的年龄里，而这段时间里用户可能刚在本机删了某条日程 ——
 * 于是删除判定会基于一份过期的"上轮在"，把一条刚被用户删掉的日程再写一次墓碑。
 */
export async function refreshCalendarMirror(
  options: CalendarMirrorOptions,
  port: CalendarMirrorPort,
): Promise<CalendarMirrorRefreshResult> {
  const baseUrl = options.baseUrl.trim();
  const token = options.token.trim();
  // 约束 1：未配置零请求。
  if (baseUrl === '' || token === '') return { kind: 'unconfigured' };

  const nowMs = (options.now ?? Date.now)();
  const window: CalendarEventWindow = {
    fromMs: nowMs - (options.windowPastMs ?? CALENDAR_EVENT_WINDOW_PAST_MS),
    toMs: nowMs + (options.windowFutureMs ?? CALENDAR_EVENT_WINDOW_FUTURE_MS),
  };

  const previousWindow = parseCalendarEventWindow(
    await port.getMetaValue(META_KEYS.CALENDAR_MIRROR_WINDOW),
  );
  // 条件请求只在**窗口没变**时才可能命中：窗口变了，上一轮那个 ETag 代表的
  // 是另一段内容的摘要，拿它去 If-None-Match 只会换来一个不属于本窗口的 304。
  const storedEtag = await port.getMetaValue(META_KEYS.CALENDAR_MIRROR_ETAG);
  const conditional =
    previousWindow !== undefined &&
    calendarEventWindowKey(previousWindow) === calendarEventWindowKey(window) &&
    typeof storedEtag === 'string' &&
    storedEtag !== '';

  const url = joinEndpointUrl(
    baseUrl,
    `${CALENDAR_MIRROR_EVENTS_PATH}?expand=true&from=${String(window.fromMs)}&to=${String(window.toMs)}`,
  );

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (conditional) headers['if-none-match'] = storedEtag;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      // Hub 是第三方服务，不是本应用的源：不把本应用的 cookie 带过去。
      credentials: 'omit',
    });
  } catch (error) {
    options.log?.(
      `calendar mirror fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    // 约束 2：窗口 / ETag / 状态一个都不动。
    return { kind: 'unavailable', cause: 'network' };
  }

  if (response.status === 304) {
    // 304 只在 conditional 时才是"内容没变"的结论；即便服务端在无条件请求上回 304，
    // 也不该去猜内容 —— 跳过一轮的代价远小于拿空数据覆盖一份好缓存。
    //
    // 304 是**成功**分支：内容没变，但"这一轮确实拉通了"，所以刷新最近成功同步时间。
    // 它不写窗口 / ETag（那两格只在拿到 200 的新内容时才推进）。
    await port.setMetaValue(META_KEYS.CALENDAR_MIRROR_LAST_SYNC, nowMs);
    return { kind: 'not-modified' };
  }

  if (!response.ok) {
    options.log?.(`calendar mirror http ${String(response.status)}`);
    return { kind: 'unavailable', cause: 'http-status' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    options.log?.('calendar mirror body is not JSON');
    return { kind: 'unavailable', cause: 'bad-shape' };
  }

  const rows = eventsOf(body);
  if (rows === undefined) {
    options.log?.('calendar mirror body has no events array');
    return { kind: 'unavailable', cause: 'bad-shape' };
  }

  const state = port.getState();
  const current = state.calendarEvents;

  /** 本轮"确实见过"的 id（含身份齐了但投影被拒的行，见 `CalendarEventPruneContext`）。 */
  const presentIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const projection = calendarEventFromHub(row);
    if (!projection.ok) {
      skipped += 1;
      if (projection.id !== undefined) presentIds.add(projection.id);
      options.log?.(`calendar mirror skipped row: ${projection.code}`);
      continue;
    }

    const next = projection.event;
    presentIds.add(next.id);
    const existing = current[next.id];

    if (existing === undefined) {
      await port.dispatch({
        entityType: CALENDAR_EVENT_ENTITY,
        entityId: next.id,
        opType: OpType.Create,
        payload: { ...next, sourceUpdatedAt: nowMs },
      });
      added += 1;
      continue;
    }

    // 约束 3：内容相同就不写 op。
    const patch = calendarEventPatch(existing, next);
    const reviving = existing.deletedAt !== undefined;

    if (patch === undefined) {
      if (!reviving) continue;
      // 复活：清掉墓碑，与回收站还原同形（设计稿 §4.3）。只带这一格，
      // 不把整行重写一遍 —— 内容没变，重写只会推高无关节点的字段时间戳。
      await port.dispatch({
        entityType: CALENDAR_EVENT_ENTITY,
        entityId: next.id,
        opType: OpType.Update,
        payload: { deletedAt: null },
      });
      updated += 1;
      continue;
    }

    await port.dispatch({
      entityType: CALENDAR_EVENT_ENTITY,
      entityId: next.id,
      opType: OpType.Update,
      payload: reviving ? { ...patch, deletedAt: null, sourceUpdatedAt: nowMs } : { ...patch, sourceUpdatedAt: nowMs },
    });
    updated += 1;
  }

  // 约束 4：删除只在两轮窗口的交集里判；没有上一轮窗口 ⇒ 一轮都不删。
  const intersection = calendarEventWindowIntersection(previousWindow, window);
  let deleted = 0;
  if (intersection !== undefined) {
    const pruneContext = { presentIds, window: intersection };
    // 遍历的是**本轮 dispatch 之前**的快照：新加的行已经在 `presentIds` 里，
    // 而这里要的正是"上一轮存在、这一轮不见"的那批。
    for (const event of Object.values(current)) {
      if (!calendarEventShouldDelete(event, pruneContext)) continue;
      // 墓碑走 UPD + `deletedAt`，不走 DEL：DEL 会让 reducer 用 op 时间戳当墓碑时间，
      // 而这里要的是"这一轮判定它消失的时刻"（两者通常差几毫秒，但语义不同）。
      await port.dispatch({
        entityType: CALENDAR_EVENT_ENTITY,
        entityId: event.id,
        opType: OpType.Update,
        payload: { deletedAt: nowMs },
      });
      deleted += 1;
    }
  }

  // 全部 dispatch 成功之后才更新基线：中途抛错时窗口停在上一轮，
  // 下一轮会重新覆盖这一段（幂等），而不是留下一段"以为已经同步过"的空洞。
  await port.setMetaValue(META_KEYS.CALENDAR_MIRROR_WINDOW, JSON.stringify(window));
  const etag = response.headers.get('etag');
  if (etag !== null && etag !== '') {
    await port.setMetaValue(META_KEYS.CALENDAR_MIRROR_ETAG, etag);
  }
  // 成功分支才推进「最近一次成功同步」。它与窗口/ETag 同一批写、同一前提：
  // 上面任何一步抛错都到不了这里，于是失败轮次不会留下一个假的新鲜时间戳。
  await port.setMetaValue(META_KEYS.CALENDAR_MIRROR_LAST_SYNC, nowMs);

  return {
    kind: 'ok',
    added,
    updated,
    deleted,
    skipped,
  };
}

/** `{events: [...]}` 的数组；不是这个形状就回 `undefined`（调用方判 `bad-shape`）。 */
function eventsOf(body: unknown): readonly unknown[] | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const events = (body as Record<string, unknown>)['events'];
  return Array.isArray(events) ? events : undefined;
}
