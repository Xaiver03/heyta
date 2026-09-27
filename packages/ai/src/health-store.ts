/**
 * 熔断状态落盘
 * ==============
 *
 * `invokeRouted()` 每次都会算出新的 `HealthMap`，但它只活在内存里 ——
 * 进程一重启，"这个端点连着失败三次、已经跳闸"这件事就忘了，
 * 于是下次启动会**立刻再撞一次**那个坏端点。
 *
 * 本模块只做一件事：把这个 `HealthMap` 安全地**存下来、读回来**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 为什么这属于 `packages/ai` 而不是壳
 *
 * ADR-0003 的判据："这一行在决定**业务上该怎么做**吗？"
 *
 * "跳闸的端点重启后还算不算跳闸"是业务判断，不是平台差异。
 * 存到哪个键、哪个文件才是平台差异 —— 那部分留在壳里。
 *
 * ## 🔴 读回来的东西是**不可信**的
 *
 * 落盘的数据可能被用户手改、被旧版本写坏、被同步工具弄乱。
 * 而它的作用恰恰是"阻止请求发出去" —— 所以一个坏掉的记录
 * 可能让 AI **永久不可用**。
 *
 * 三道防线：
 *   1. 形状不对的条目直接**丢掉**，不抛错
 *   2. `circuitOpenUntil` **封顶**（见下）
 *   3. 已经过期的跳闸**立刻清掉**，不等下一次调用
 *
 * ## 🔴 为什么必须封顶
 *
 * 假设某个端点的 `circuitOpenUntil` 被写成 `Date.now() + 10 年`
 * （时钟跳变、手改、旧 bug）。没有封顶的话，用户会遇到一个
 * **再也修不好**的状态：改配置没用、重启没用，只能去删存储。
 *
 * 所以读回来时一律夹到 `now + MAX_CIRCUIT_MS`。
 * **一个跳闸最多只能持续这么久**，过期自动恢复。
 * 这是"宁可多试一次，不可永久卡死"。
 */

import type { EndpointHealth, HealthMap } from './routing.js';

/** 落盘格式版本。将来改结构时用它做迁移。 */
export const HEALTH_SNAPSHOT_VERSION = 1;

/**
 * 🔴 跳闸时长上限。
 *
 * 读回来时任何超过 `now + 这个值` 的 `circuitOpenUntil` 都会被夹到这个值。
 * 见文件头"为什么必须封顶"。
 */
export const MAX_CIRCUIT_MS = 30 * 60 * 1000;

/**
 * 失败记录的保留时长。
 *
 * `consecutiveFailures` 是有用的（它是跳闸的依据），但不能无限期留着：
 * 一个三个月前失败过一次的端点，不该在今天的界面上显示成"有问题"。
 */
export const FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

/** `lastError` 的截断长度。错误信息可能很长（HTML 错误页），没必要全存。 */
export const MAX_LAST_ERROR_LENGTH = 200;

/** 落盘用的条目形状。**每个字段都可选**，因为读回来的东西可能缺字段。 */
export interface PersistedEndpointHealth {
  endpointId: string;
  consecutiveFailures: number;
  circuitOpenUntil?: number;
  lastError?: string;
  lastSuccessAt?: number;
}

export interface AiHealthSnapshot {
  version: number;
  entries: readonly PersistedEndpointHealth[];
}

/**
 * 把 `HealthMap` 转成可落盘的快照。
 *
 * 会做三件清理，避免存储无限膨胀：
 * - 已经**恢复正常**的条目（没失败、没跳闸、没错信息）直接丢掉
 * - 已经**过期**的跳闸当作已恢复
 * - 太久以前的失败记录丢掉
 */
export function toHealthSnapshot(health: HealthMap, now: number): AiHealthSnapshot {
  const entries: PersistedEndpointHealth[] = [];

  for (const entry of Object.values(health)) {
    const circuitOpenUntil =
      entry.circuitOpenUntil !== undefined && entry.circuitOpenUntil > now
        ? Math.min(entry.circuitOpenUntil, now + MAX_CIRCUIT_MS)
        : undefined;

    const failuresAreFresh =
      entry.lastSuccessAt === undefined || now - entry.lastSuccessAt <= FAILURE_MEMORY_MS;
    const consecutiveFailures = failuresAreFresh ? entry.consecutiveFailures : 0;

    const freshError =
      failuresAreFresh && entry.lastError !== undefined
        ? entry.lastError.slice(0, MAX_LAST_ERROR_LENGTH)
        : undefined;

    // 三者都空的条目没有信息量 —— 不存。
    if (consecutiveFailures === 0 && circuitOpenUntil === undefined && freshError === undefined) {
      continue;
    }

    entries.push({
      endpointId: entry.endpointId,
      consecutiveFailures,
      ...(circuitOpenUntil === undefined ? {} : { circuitOpenUntil }),
      ...(freshError === undefined ? {} : { lastError: freshError }),
      ...(entry.lastSuccessAt === undefined ? {} : { lastSuccessAt: entry.lastSuccessAt }),
    });
  }

  // 顺序稳定：按 endpointId 排，避免每次落盘内容抖动。
  entries.sort((a, b) => (a.endpointId < b.endpointId ? -1 : a.endpointId > b.endpointId ? 1 : 0));

  return { version: HEALTH_SNAPSHOT_VERSION, entries };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 读回快照。**绝不抛错** —— 坏数据退化成空状态。
 *
 * 🔴 退化方向是"当作没有熔断历史"（= 会去试）。
 * 因为反过来（当作全部跳闸）会让 AI 永久不可用，
 * 而多试一次的代价只是多一次失败的请求。
 */
export function fromHealthSnapshot(raw: unknown, now: number): HealthMap {
  if (typeof raw !== 'object' || raw === null) return {};

  const snapshot = raw as { version?: unknown; entries?: unknown };
  // 版本对不上就丢掉 —— 比按错误的结构解析安全。
  if (snapshot.version !== HEALTH_SNAPSHOT_VERSION) return {};
  if (!Array.isArray(snapshot.entries)) return {};

  const health: Record<string, EndpointHealth> = {};

  for (const item of snapshot.entries) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;

    const endpointId = entry['endpointId'];
    if (typeof endpointId !== 'string' || endpointId === '') continue;

    // 同一个 id 出现两次时，**取更保守的那条**（失败次数多的）。
    const previous = health[endpointId];

    const rawFailures = entry['consecutiveFailures'];
    const consecutiveFailures =
      isFiniteNumber(rawFailures) && rawFailures >= 0 ? Math.floor(rawFailures) : 0;

    const rawUntil = entry['circuitOpenUntil'];
    // 🔴 封顶：见文件头"为什么必须封顶"
    const circuitOpenUntil =
      isFiniteNumber(rawUntil) && rawUntil > now
        ? Math.min(rawUntil, now + MAX_CIRCUIT_MS)
        : undefined;

    const rawSuccess = entry['lastSuccessAt'];
    const lastSuccessAt = isFiniteNumber(rawSuccess) ? rawSuccess : undefined;

    const rawError = entry['lastError'];
    const lastError =
      typeof rawError === 'string' ? rawError.slice(0, MAX_LAST_ERROR_LENGTH) : undefined;

    const merged: EndpointHealth = {
      endpointId,
      consecutiveFailures: Math.max(consecutiveFailures, previous?.consecutiveFailures ?? 0),
      ...(circuitOpenUntil !== undefined
        ? { circuitOpenUntil: Math.max(circuitOpenUntil, previous?.circuitOpenUntil ?? 0) }
        : previous?.circuitOpenUntil === undefined
          ? {}
          : { circuitOpenUntil: previous.circuitOpenUntil }),
      ...(lastError !== undefined
        ? { lastError }
        : previous?.lastError === undefined
          ? {}
          : { lastError: previous.lastError }),
      ...(lastSuccessAt !== undefined
        ? { lastSuccessAt }
        : previous?.lastSuccessAt === undefined
          ? {}
          : { lastSuccessAt: previous.lastSuccessAt }),
    };

    health[endpointId] = merged;
  }

  return health;
}

/**
 * 熔断状态的**结构化**形态 —— "这个端点现在什么情况"，**不含任何措辞**。
 *
 * 🔴 与 `supply.ts` 的披露同一个理由：这段文字会渲染给用户，而界面要中英双语，
 * 所以"怎么说"必须归壳。三个 kind 也刻意**不做温和化**：
 * 跳闸就是跳闸（`circuit-open`），不叫"暂时休息"。
 */
export type EndpointHealthDisclosure =
  /** 一切正常。 */
  | { kind: 'ok' }
  /** 最近失败过，但还没跳闸。 */
  | { kind: 'failing'; failures: number }
  /** 已跳闸，`retryInSeconds` 秒后自动恢复。 */
  | { kind: 'circuit-open'; failures: number; retryInSeconds: number };

/**
 * 结构化：一条健康记录 → 它现在是什么情况。
 *
 * ⚠️ 判定的**优先级**是这条函数的一部分，不是实现细节：
 * 先看跳闸（且**未过期**）→ 再看失败次数 → 否则正常。
 * 把"已过期的跳闸"仍当成跳闸，会让一个其实已经恢复的端点永远显示成不可用。
 */
export function endpointHealthDisclosure(
  entry: EndpointHealth,
  now: number,
): EndpointHealthDisclosure {
  if (entry.circuitOpenUntil !== undefined && entry.circuitOpenUntil > now) {
    return {
      kind: 'circuit-open',
      failures: entry.consecutiveFailures,
      retryInSeconds: Math.ceil((entry.circuitOpenUntil - now) / 1000),
    };
  }
  if (entry.consecutiveFailures > 0) {
    return { kind: 'failing', failures: entry.consecutiveFailures };
  }
  return { kind: 'ok' };
}

/**
 * 描述一条熔断状态，给界面用。
 *
 * ⚠️ 这是"给用户看的"，所以要说人话 —— 不要出现 `consecutiveFailures` 这种词。
 *
 * ⚠️ **兼容路径，且壳已经切走了**：设置页现在用
 * `apps/web/src/features/settings/health-copy.ts` 把 `endpointHealthDisclosure()`
 * 的 kind 映射成双语词条 + 插值参数（中文逐字沿用这里的句子）。
 * 因此本函数**当前只剩测试在用** —— 但它不是死代码：
 * `tests/health-store.spec.ts` 用它钉住中文句子与 kind 的对应关系，
 * 而那正是"壳翻译得对不对"的参照物。
 * 🔴 **要删它，必须先让 `apps/**` 不再引用它的注释/断言，并确认没有第二个壳要用**；
 * 在那之前保留，并保持它与 `endpointHealthDisclosure()` 同源（这里 switch 的就是 kind）。
 */
export function describeEndpointHealth(entry: EndpointHealth, now: number): string {
  const d = endpointHealthDisclosure(entry, now);
  switch (d.kind) {
    case 'circuit-open':
      return `暂时停止使用（连续失败 ${String(d.failures)} 次，${String(d.retryInSeconds)} 秒后重试）`;
    case 'failing':
      return `最近失败过 ${String(d.failures)} 次`;
    case 'ok':
      return '正常';
  }
}
