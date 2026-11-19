import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/** 可固定到底栏前四格的工作空间；profile 由壳固定在最右。 */
export const TAB_BAR_WORKSPACE_KEYS = [
  'tasks',
  'calendar',
  'focus',
  'ai',
  'habits',
  'countdown',
] as const;

export type WorkspaceKey = (typeof TAB_BAR_WORKSPACE_KEYS)[number];

export const DEFAULT_TAB_BAR_WORKSPACES: readonly WorkspaceKey[] = [
  'tasks',
  'calendar',
  'focus',
  'ai',
];

export const PREF_KEY_TAB_BAR_WORKSPACES = 'tab-bar.workspaces';

const WORKSPACE_KEY_SET: ReadonlySet<string> = new Set(TAB_BAR_WORKSPACE_KEYS);

/** 变更订阅：底栏自定义保存后，外壳（App）据此实时重排，不用重启。 */
const listeners = new Set<() => void>();
let cachedSnapshot: readonly WorkspaceKey[] | null = null;

function notifyChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeTabBarWorkspaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `useSyncExternalStore` 的快照：**引用必须稳定**，否则每次 render 都返回新数组
 * 会导致无限重渲染。缓存只在写入/失效时更新。
 */
export function getTabBarWorkspacesSnapshot(): readonly WorkspaceKey[] {
  if (cachedSnapshot === null) cachedSnapshot = readTabBarWorkspaces();
  return cachedSnapshot;
}
const MIN_WORKSPACES = 2;
const MAX_WORKSPACES = 4;

function validateWorkspaceKeys(value: unknown): WorkspaceKey[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length < MIN_WORKSPACES || value.length > MAX_WORKSPACES) return undefined;

  const normalized: WorkspaceKey[] = [];
  const seen = new Set<WorkspaceKey>();
  for (const key of value) {
    if (typeof key !== 'string' || !WORKSPACE_KEY_SET.has(key)) return undefined;
    const workspace = key as WorkspaceKey;
    if (seen.has(workspace)) return undefined;
    seen.add(workspace);
    normalized.push(workspace);
  }
  return normalized;
}

/** 把未知输入规范化为合法排列；任何非法或损坏值都回默认，不抛。 */
export function normalizeWorkspaceKeys(value: unknown): WorkspaceKey[] {
  return validateWorkspaceKeys(value) ?? [...DEFAULT_TAB_BAR_WORKSPACES];
}

/** 读取这台设备的底栏工作空间顺序。 */
export function readTabBarWorkspaces(): WorkspaceKey[] {
  const raw = readDevicePref(PREF_KEY_TAB_BAR_WORKSPACES);
  if (raw === undefined) return [...DEFAULT_TAB_BAR_WORKSPACES];
  try {
    return normalizeWorkspaceKeys(JSON.parse(raw));
  } catch {
    return [...DEFAULT_TAB_BAR_WORKSPACES];
  }
}

/** 按给定顺序保存 2–4 个工作空间；非法配置不写入。 */
export function writeTabBarWorkspaces(workspaces: readonly WorkspaceKey[]): boolean {
  const normalized = validateWorkspaceKeys(workspaces);
  if (normalized === undefined) return false;
  const ok = writeDevicePref(PREF_KEY_TAB_BAR_WORKSPACES, JSON.stringify(normalized));
  if (ok) {
    cachedSnapshot = normalized;
    notifyChange();
  }
  return ok;
}

/** 恢复默认前四格。 */
export function resetTabBarWorkspaces(): boolean {
  return writeTabBarWorkspaces(DEFAULT_TAB_BAR_WORKSPACES);
}
