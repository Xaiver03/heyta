/**
 * 助手会话历史 —— **只落这台设备**
 * =================================
 *
 * ADR-0045 的 D-4 (i)：对话历史跨不过一次页面刷新，而「新会话」按钮和
 * "刷新丢了"长得一模一样 —— 用户分不清是自己开了新会话还是应用忘了。
 * 这一层把"这台设备上继续同一段对话"补上。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 1. 为什么放 `localStorage` 不算新开一处明文敞口（这一步必须先查，不能想当然）
 *
 * `AssistantPanel.tsx` 的文件头原来写的是"聊天文本进 `localStorage` 等于把用户
 * 内容明文放在任何同源脚本都读得到的地方"。查过之后这句**不成立为反对理由**，
 * 因为它描述的已经是现状而不只是风险：
 *
 * | 事实 | 出处 |
 * |---|---|
 * | 端到端加密发生在**上传那一步**（`encrypt(JSON.stringify(op.payload), password)`），落库的是明文 op | `packages/sync-client/src/client.ts:873` |
 * | 因此本地那份 `state` store 里本来就是**解开的实体**（不然离线打开要重新输口令才能看列表） | `packages/storage/src/stores.ts:20`（"物化后的实体状态"） |
 * | 这个仓库真正守住的线是**口令/密钥不落盘**，不是"用户内容不落盘" | `apps/web/src/features/sync/credential-storage.ts:17`（口令❌、JWT✅，理由逐条写着） |
 *
 * 同源脚本读得到 `localStorage`，也同样读得到 IndexedDB 里那份 `state`。
 * 所以把对话文本放哪儿，在 XSS 面前**是同一档**；把它加密存放反而是自欺
 * （密钥仍然只在内存，与密文同域可被同一次 XSS 一起拿到）。
 *
 * ⚠️ 反面同样要说清：这**不**意味着可以存密钥。纪律照旧 ——
 * API key 与口令一个字节都不进这里（`aiStore.ts` 文件头第 ② 条）。
 *
 * **2. 不进 op-log、不参与同步**
 *
 * 与 `aiStore.ts` 同一条判断：这是"这台设备怎么用助手"的本机状态。
 * 同步过去的后果是"手机上的对话出现在电脑上"，而两端配的根本不是同一个端点；
 * 更要紧的是 D-4 的 (ii)（跨设备会话实体）**没有拍** —— 那要新实体、要墓碑、
 * 要回答"改动提案在另一台设备上能不能确认"。本文件不预支那个决定。
 *
 * **3. 换账号必须看不见上一段的对话**
 *
 * 记录里绑 `account`（凭据里那个邮箱标签）。读的时候不相等就当没有 ——
 * 多设备共用一台电脑是真实用法，而"助手记得上一个账号让我改了什么"是泄漏，
 * 不是贴心。
 *
 * **4. 未确认的改动提案不复活**
 *
 * 恢复时把 `confirmed === undefined` 的提案标成 `expired`：卡片留着（用户看得懂
 * 对话为什么断在这里），确认按钮去掉。见 `assistant-transcript.ts` 那条注释。
 *
 * **5. 上界是从出境上界推导的，不是另抄一个数**
 *
 * 存的条数不可能超过"一轮请求允许携带的消息数"，否则存下来的部分永远发不出去，
 * 而界面还以为它在历史里。抄一个固定数字就是等它漂。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { MAX_ASSISTANT_MESSAGES } from '@heyta/ai';

import type { ChatItem } from './assistant-local-transcript.js';
import { randomId } from './ids.js';

/** 与 `heyta.ai.settings` / `heyta.sync.credentials` 并列。键名只在这里定义一次。 */
export const ASSISTANT_HISTORY_STORAGE_KEY = 'heyta.ai.assistant.history';

/**
 * 落盘结构版本。
 *
 * ⚠️ 落盘的东西没有版本号，下次改形状就只能猜用户存的是哪一版
 * （`health-store.ts` 与 `aiStore.ts` 为同一件事各写了一份，这里是第三次的同一个教训）。
 */
export const ASSISTANT_HISTORY_VERSION = 1;

/** 最多存多少条。🔴 从出境上界推导，理由见文件头第 5 条。 */
export const MAX_PERSISTED_ITEMS = MAX_ASSISTANT_MESSAGES;

/** 存储的最小接口（注入是为了能测隐私模式与写失败，与 `credential-storage.ts` 同一形状）。 */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 相同邮箱在不同服务器不是同一个账号；不把 token 或口令放进历史标识。 */
export function assistantHistoryAccount(identity: {
  serverUrl: string;
  accountId?: string;
  email?: string;
  /** Non-secret, ephemeral scope for sessions without authenticated identity. */
  sessionId?: string;
} | undefined): string | null {
  if (identity === undefined) return null;
  let server = identity.serverUrl.trim().replace(/\/+$/, '');
  try { server = new URL(server).origin; } catch { /* 未完成配置仍保留服务器隔离。 */ }
  const accountId = identity.accountId?.trim();
  const email = identity.email?.trim();
  const sessionId = identity.sessionId?.trim();
  if (accountId) return JSON.stringify([server, 'id', accountId]);
  if (email) return JSON.stringify([server, 'email', email]);
  if (sessionId) return JSON.stringify([server, 'session', sessionId]);
  throw new Error('Assistant history requires an account identity or an ephemeral session scope');
}

/** Keep manual-session identity across UI remounts without persisting a credential. */
export function createAssistantHistoryAccountResolver(): (identity: {
  serverUrl: string; accountId?: string; token?: string;
} | undefined) => string | null {
  let manual: { serverUrl: string; token: string | undefined; scope: string } | undefined;
  return (identity) => {
    if (identity === undefined || identity.accountId?.trim()) {
      manual = undefined;
      return assistantHistoryAccount(identity);
    }
    if (manual === undefined || manual.serverUrl !== identity.serverUrl || manual.token !== identity.token) {
      manual = { serverUrl: identity.serverUrl, token: identity.token, scope: randomId() };
    }
    return assistantHistoryAccount({ serverUrl: identity.serverUrl, sessionId: manual.scope });
  };
}

/** 每个账号独立保存本机会话；兼容读取该账号的旧单槽记录。 */
export function scopeAssistantHistoryStorage(
  storage: HistoryStorage,
  account: string | null,
): HistoryStorage {
  const scopedKey = `${ASSISTANT_HISTORY_STORAGE_KEY}:${account === null ? 'guest' : `account:${encodeURIComponent(account)}`}`;
  const ownLegacy = (): string | null => {
    const raw = storage.getItem(ASSISTANT_HISTORY_STORAGE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && (parsed as Record<string, unknown>)['account'] === account ? raw : null;
    } catch {
      return null;
    }
  };
  return {
    getItem: () => storage.getItem(scopedKey) ?? ownLegacy(),
    setItem: (_key, value) => {
      // 新记录落盘成功之后才移除属于自己的旧记录，写入失败时保留旧记录。
      storage.setItem(scopedKey, value);
      if (ownLegacy() !== null) storage.removeItem(ASSISTANT_HISTORY_STORAGE_KEY);
    },
    removeItem: () => {
      storage.removeItem(scopedKey);
      if (ownLegacy() !== null) storage.removeItem(ASSISTANT_HISTORY_STORAGE_KEY);
    },
  };
}

/**
 * 落盘的那一条对话记录 = `ChatItem` 去掉 `id`。
 *
 * `id` 是组件里的渲染计数（React key），**不是数据**：跨进程恢复时它必然与
 * 新的计数器打架，所以不存。恢复时按顺序重新编号。
 */
export type StoredChatItem = WithoutIdInternal<ChatItem>;

type WithoutIdInternal<T> = T extends { readonly id: number } ? Omit<T, 'id'> : never;

/** 落盘的信封。 */
export interface PersistedAssistantHistory {
  readonly version: number;
  /** 账号标签（凭据里的邮箱）。`null` = 未登录时产生的对话。 */
  readonly account: string | null;
  /** 🔴 本段会话是否已经看过一次性披露（「新会话」把它和 items 一起清掉）。 */
  readonly disclosed: boolean;
  readonly items: readonly StoredChatItem[];
}

/** 只保留最近 `MAX_PERSISTED_ITEMS` 条（丢的是**最老**的，不是最近的）。 */
export function truncateForPersistence(
  items: readonly ChatItem[],
): readonly StoredChatItem[] {
  const withoutIds = items.map((item) => {
    const { id: _id, ...rest } = item;
    return rest as StoredChatItem;
  });
  return withoutIds.length > MAX_PERSISTED_ITEMS
    ? withoutIds.slice(withoutIds.length - MAX_PERSISTED_ITEMS)
    : withoutIds;
}

/**
 * 把整段会话写进本机存储。
 *
 * @returns 真写进去了 `true`；存储不可用或写失败 `false`（**不抛**）。
 *   写失败的后果是"下次刷新还要重新说一遍"，比让面板崩掉轻。
 */
export function saveAssistantHistory(
  history: { readonly items: readonly ChatItem[]; readonly disclosed: boolean; readonly account: string | null },
  storage: HistoryStorage | null,
): boolean {
  if (storage === null) return false;
  const envelope: PersistedAssistantHistory = {
    version: ASSISTANT_HISTORY_VERSION,
    account: history.account,
    disclosed: history.disclosed,
    items: truncateForPersistence(history.items),
  };
  try {
    storage.setItem(ASSISTANT_HISTORY_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    // 配额满 / 被策略拒绝。
    return false;
  }
}

/**
 * 读回这台设备上这段会话。
 *
 * 两种"读不懂"会返回 `null` 并**顺手清掉**（留着一个读不懂的值，只会在每次
 * 启动时再失败一次，同 `loadCredentials`）：版本对不上、形状不是记录的样子、
 * 以及一条都恢复不出来。
 *
 * 🔴 而**账号不相等**只返回 `null`、**不清** —— 那是别人（或另一个账号）的
 * 会话，用户可能只是这次没登录，抹掉它就是不可逆的数据丢失。
 */
export function loadAssistantHistory(
  account: string | null,
  storage: HistoryStorage | null,
): { readonly items: readonly ChatItem[]; readonly disclosed: boolean } | null {
  if (storage === null) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(ASSISTANT_HISTORY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;

  const drop = (): null => {
    try {
      storage.removeItem(ASSISTANT_HISTORY_STORAGE_KEY);
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
  if (record['version'] !== ASSISTANT_HISTORY_VERSION) return drop();
  // 🔴 账号不相等 → **只返回 null，不删**。
  // 这一句是本轮自己抓出来的实现缺陷：把"不是这一个账号的会话"当成"读不懂的数据"
  // 顺手清掉，等于用户一次登出/切换就抹掉了另一段对话 —— 而那段话在他自己的
  // 设备上明明还在。读不懂才清；认得出是谁的、只是不是当前这个，就留着。
  if (record['account'] !== account) return null;
  if (!Array.isArray(record['items'])) return drop();

  const items = (record['items'] as readonly unknown[]).flatMap((entry, index) => {
    const restored = reviveItem(entry, index + 1);
    return restored === undefined ? [] : [restored];
  });
  // 一条都没恢复出来 ≠ "存了空的会话"：那种情况直接按没有处理，
  // 免得界面显示一段空白历史却以为它是对话。
  if (items.length === 0) return drop();

  return { items, disclosed: record['disclosed'] === true };
}

/** 删掉本机存的那段会话（「新会话」与"清除数据"走这里）。 */
export function clearAssistantHistory(storage: HistoryStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(ASSISTANT_HISTORY_STORAGE_KEY);
  } catch {
    // 不抛。
  }
}

/**
 * 把落盘的一条恢复成 `ChatItem`。
 *
 * 只认四种 `role`；认不出来返回 `undefined`（丢掉这一条，而不是让整个面板报错）。
 * 🔴 未确认的提案在这里被标成 `expired` —— 界面对 `expired` 不渲染确认按钮。
 */
function reviveItem(entry: unknown, id: number): ChatItem | undefined {
  if (entry === null || typeof entry !== 'object') return undefined;
  const raw = entry as Record<string, unknown>;
  const role = raw['role'];
  const text = typeof raw['text'] === 'string' ? raw['text'] : undefined;

  switch (role) {
    case 'user':
      return text === undefined ? undefined : { id, role, text };
    case 'assistant':
      return text === undefined
        ? undefined
        : {
            id,
            role,
            text,
            steps: Array.isArray(raw['steps']) ? (raw['steps'] as never[]) : [],
            stoppedAt: typeof raw['stoppedAt'] === 'string' ? raw['stoppedAt'] : undefined,
          };
    case 'proposal': {
      if (text === undefined) return undefined;
      const proposal = raw['proposal'];
      if (proposal === null || typeof proposal !== 'object') return undefined;
      const confirmed = raw['confirmed'];
      const unresolved = confirmed === null || confirmed === undefined;
      return {
        id,
        role,
        text,
        proposal: proposal as never,
        confirmed: unresolved ? undefined : (confirmed as never),
        ...(unresolved ? { expired: true as const } : {}),
      };
    }
    case 'error': {
      const message = typeof raw['message'] === 'string' ? raw['message'] : undefined;
      const reason = raw['reason'];
      if (message === undefined || typeof reason !== 'string') return undefined;
      return {
        id,
        role,
        reason: reason as never,
        message,
        cause: typeof raw['cause'] === 'string' ? (raw['cause'] as never) : undefined,
        endpointUrl: typeof raw['endpointUrl'] === 'string' ? raw['endpointUrl'] : undefined,
        outsideFields: Array.isArray(raw['outsideFields'])
          ? (raw['outsideFields'] as never[])
          : undefined,
      };
    }
    default:
      return undefined;
  }
}
