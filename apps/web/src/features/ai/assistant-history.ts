/** Web 的本地历史适配；解析、账号隔离及未确认提案失效规则只在 app-host。 */
import {
  clearAssistantHistory as clear,
  scopeAssistantHistoryStorage,
  loadAssistantHistory as load,
  saveAssistantHistory as save,
  type HistoryStorage,
} from '@heyta/app-host';

export {
  ASSISTANT_HISTORY_STORAGE_KEY,
  ASSISTANT_HISTORY_VERSION,
  MAX_PERSISTED_ITEMS,
  truncateForPersistence,
  type HistoryStorage,
  type PersistedAssistantHistory,
  type StoredChatItem,
} from '@heyta/app-host';

function defaultStorage(): HistoryStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 未传表示启用当前账号的本机历史；显式 null 表示禁用，不回退默认存储。 */
export function assistantSessionStorage(account: string | null, supplied?: HistoryStorage | null): HistoryStorage | null {
  if (supplied !== undefined) return supplied;
  const storage = defaultStorage();
  return storage === null ? null : scopeAssistantHistoryStorage(storage, account);
}

export function saveAssistantHistory(
  history: Parameters<typeof save>[0],
  storage: HistoryStorage | null = defaultStorage(),
): boolean {
  return save(history, storage);
}

export function loadAssistantHistory(
  account: string | null,
  storage: HistoryStorage | null = defaultStorage(),
): ReturnType<typeof load> {
  return load(account, storage);
}

export function clearAssistantHistory(storage: HistoryStorage | null = defaultStorage()): void {
  clear(storage);
}
