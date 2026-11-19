/**
 * 助手**多会话**本机存储（按账号隔离）
 * =====================================
 *
 * 与 `assistant-local-history.ts`（单槽：一个账号只留一段对话）并列的第二层。
 * 为什么另开一个模块、而不是把单槽那层直接改成列表：
 *
 * 🔴 1. 单槽那层的落盘信封被两套测试**逐字段钉死**
 *   （`apps/web/tests/assistant-history.spec.ts` 断言信封里有 `version` 与 `items`、
 *   `packages/app-host/tests/assistant-history-accounts.spec.ts` 断言旧单槽的迁移与
 *   删除计数）。把信封换成 `sessions:[…]` 会同时推翻 web 与 app-host 的两套判据，
 *   而那两层守的是**账号隔离、未确认提案不复活、读不懂就清**这些安全性质 ——
 *   不是形状洁癖。为了加一个列表去动它们，是拿已证的安全换未证的功能。
 *
 *   所以这里**不碰** `assistant-local-history.ts` 的信封：多会话落在一个**新的键**
 *   （`ASSISTANT_SESSIONS_STORAGE_KEY`）里，两者可以同时存在。移动端控制器读多会话层、
 *   仍把"当前那一段"镜像进单槽层（见 `chat-controller.ts` 的 `persist`）—— 于是旧单槽的
 *   测试与 web 的读法**无需改一个字**，而多会话是纯增量。
 *
 * 🔴 2. 账号隔离的判据与单槽同一条
 *   换账号必须看不见上一段对话。本模块按账号拼**各自的键**（`…:account:<enc>` /
 *   `…:guest`），并在信封里再记一份 `account` 做二次核对 —— 键被别的路径写脏时，
 *   `loadAssistantSessions` 读到不相等只返回 `null`，**不删**（那可能是别的账号的会话）。
 *
 * 🔴 3. 读不懂就清，但"认得出不是我的"只返回 null
 *   与单槽同一条（`loadAssistantHistory` 的注释写死了这个区分）：版本不符 / 形状不对 ⇒
 *   清掉，免得每次启动再失败一次；账号不等 ⇒ 只返回 null，留给它的主人。
 *
 * 🔴 4. 未确认的提案跨重载同样变成 `expired`
 *   复用单槽层的 `reviveStoredChatItems`，不另写一份复活逻辑（两份就是漂移起点）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 条数上界是从出境上界推导的，不是另抄一个数（同单槽层第 5 条）：
 *    每个会话的条数由 `truncateForPersistence` 截到 `MAX_PERSISTED_ITEMS`；
 *    会话**个数**的上界是本模块自己的产品判断（设备本机历史的体量），
 *    与出境无关，所以是独立常量 `MAX_ASSISTANT_SESSIONS`。
 */

import type { ChatItem } from './assistant-local-transcript.js';
import {
  truncateForPersistence,
  reviveStoredChatItems,
  type HistoryStorage,
  type StoredChatItem,
} from './assistant-local-history.js';
import { randomId } from './ids.js';

/** 与 `ASSISTANT_HISTORY_STORAGE_KEY` 并列。键名只在这里定义一次。 */
export const ASSISTANT_SESSIONS_STORAGE_KEY = 'heyta.ai.assistant.sessions';

/** 落盘结构版本。改形状必须 bump，并写迁移（同单槽层那条教训）。 */
export const ASSISTANT_SESSIONS_VERSION = 1;

/** 本机最多保留几段会话（按 `updatedAt` 保留最近的）。产品体量判断，非出境上界。 */
export const MAX_ASSISTANT_SESSIONS = 50;

/** 一个会话（含正文）。控制器用它做落盘与切换。 */
export interface AssistantSessionInput {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly disclosed: boolean;
  readonly items: readonly ChatItem[];
}

/** 读回的一个会话（正文已复活成 `ChatItem`）。 */
export interface LoadedAssistantSession {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly disclosed: boolean;
  readonly items: readonly ChatItem[];
}

export interface LoadedAssistantSessions {
  readonly activeId: string | null;
  readonly sessions: readonly LoadedAssistantSession[];
}

/** 落盘的信封。 */
interface PersistedAssistantSessions {
  readonly version: number;
  readonly account: string | null;
  readonly activeId: string | null;
  readonly sessions: readonly {
    readonly id: string;
    readonly title: string;
    readonly updatedAt: number;
    readonly disclosed: boolean;
    readonly items: readonly StoredChatItem[];
  }[];
}

/** 这个账号的会话落在哪个键上（与单槽层的 scopedKey 同一形状，但不读写旧单槽）。 */
export function assistantSessionsStorageKey(account: string | null): string {
  return `${ASSISTANT_SESSIONS_STORAGE_KEY}:${account === null ? 'guest' : `account:${encodeURIComponent(account)}`}`;
}

/**
 * 把整份多会话状态写进本机存储。
 *
 * @returns 真写进去了 `true`；存储不可用或写失败 `false`（**不抛**）。
 *   会先按 `updatedAt` 保留最近 `MAX_ASSISTANT_SESSIONS` 段，再逐段截正文条数。
 *   正文为空的会话**不落盘**（空会话由控制器以"当前会话"的形式另行呈现，
 *   落一堆空壳只会让列表变脏）。
 */
export function saveAssistantSessions(
  state: { readonly activeId: string | null; readonly sessions: readonly AssistantSessionInput[] },
  account: string | null,
  storage: HistoryStorage | null,
): boolean {
  if (storage === null) return false;
  const nonEmpty = state.sessions
    .filter((session) => session.items.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ASSISTANT_SESSIONS)
    .map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      disclosed: session.disclosed,
      items: truncateForPersistence(session.items),
    }));
  const key = assistantSessionsStorageKey(account);
  // 一段有内容的都没有 ⇒ 不必留一个空信封（"清空"与"从没存过"在这里是同一个结果）。
  if (nonEmpty.length === 0) {
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
  const envelope: PersistedAssistantSessions = {
    version: ASSISTANT_SESSIONS_VERSION,
    account,
    activeId: state.activeId,
    sessions: nonEmpty,
  };
  try {
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    // 配额满 / 被策略拒绝。
    return false;
  }
}

/**
 * 读回这个账号的多会话。
 *
 * - 版本不符 / 形状不对 / 一段都恢复不出来 ⇒ `null` 并顺手清掉（读不懂才清）。
 * - 账号不相等 ⇒ `null`，**不删**（可能是别的账号的会话，用户可能只是这次没登录）。
 */
export function loadAssistantSessions(
  account: string | null,
  storage: HistoryStorage | null,
): LoadedAssistantSessions | null {
  if (storage === null) return null;
  const key = assistantSessionsStorageKey(account);
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;

  const drop = (): null => {
    try {
      storage.removeItem(key);
    } catch {
      // 清不掉不是致命错误。
    }
    return null;
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return drop();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return drop();
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== ASSISTANT_SESSIONS_VERSION) return drop();
  // 🔴 账号不等 → 只返回 null，不删（同单槽层那一句）。
  if (record['account'] !== account) return null;
  if (!Array.isArray(record['sessions'])) return drop();

  const sessions = (record['sessions'] as readonly unknown[]).flatMap((entry) => {
    const loaded = reviveSession(entry);
    return loaded === undefined || loaded.items.length === 0 ? [] : [loaded];
  });
  if (sessions.length === 0) return drop();

  const activeId =
    typeof record['activeId'] === 'string' && sessions.some((s) => s.id === record['activeId'])
      ? (record['activeId'] as string)
      : sessions[0]!.id;
  return { activeId, sessions };
}

/** 删掉这个账号的全部多会话（"清除本机历史"走这里）。 */
export function clearAssistantSessions(account: string | null, storage: HistoryStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(assistantSessionsStorageKey(account));
  } catch {
    // 不抛。
  }
}

/** 新建一个空的会话 id（控制器建新会话时用；与渲染计数无关）。 */
export function newAssistantSessionId(): string {
  return randomId();
}

/** 把落盘的一段会话复活成 `LoadedAssistantSession`；认不出返回 `undefined`。 */
function reviveSession(entry: unknown): LoadedAssistantSession | undefined {
  if (entry === null || typeof entry !== 'object') return undefined;
  const raw = entry as Record<string, unknown>;
  const id = typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : undefined;
  if (id === undefined) return undefined;
  const title = typeof raw['title'] === 'string' ? raw['title'] : '';
  const updatedAt =
    typeof raw['updatedAt'] === 'number' && Number.isFinite(raw['updatedAt']) ? raw['updatedAt'] : 0;
  const items = Array.isArray(raw['items']) ? reviveStoredChatItems(raw['items'] as readonly unknown[]) : [];
  return { id, title, updatedAt, disclosed: raw['disclosed'] === true, items };
}
