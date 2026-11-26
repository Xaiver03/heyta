/**
 * 智能清单的显示配置（纯函数，零文案）
 * =====================================
 *
 * 覆盖图谱 #18：「显示哪几条智能清单 / 怎么排序」。
 *
 * ## 为什么判断住在这里
 *
 * 「有哪几条智能清单」是产品语义 —— 四个端必须认同同一批 key；
 * 「这台设备上显示哪几条、按什么顺序」是**本机界面偏好**（与 `modules.ts`
 * 的"开哪些模块"同一条推理，不进 op-log：同一份数据同步到另一台设备，
 * 侧栏该显示哪几条不该跟着跳）。
 *
 * 所以：**词表与归并规则**在领域层（这里），**存储与渲染**在壳里。
 * 壳里若自己编一个这里没有的 key，是编译错误而不是漂移。
 *
 * ## 归并规则（`normalizeSmartListConfig`）
 *
 * 写入方是本机 localStorage，里面可能有旧版本写下的、手改过的、或已删除的 key。
 * 类型在运行时不存在，所以读回来的 `unknown` 一律走这一条归一：
 *   · 认不出的 key 丢掉；
 *   · 重复的 key 只留第一次；
 *   · 存量里缺的 key **补在末尾**（按默认顺序），这样将来新增一条智能清单时，
 *     老用户也能拿到它，而不是被一份"当年存下来的完整列表"永久钉在旧状态上；
 *   · `visible` 不是布尔时回落 `true`。
 * 结果永远是**全集、有顺序、无重复**，调用方不必再兜底。
 */

/** 智能清单的稳定 key。顺序即默认顺序。 */
export const SMART_LIST_KEYS = ['today', 'next7Days', 'completed'] as const;

export type SmartListKey = (typeof SMART_LIST_KEYS)[number];

export interface SmartListEntry {
  readonly key: SmartListKey;
  readonly visible: boolean;
}

export interface SmartListConfig {
  readonly entries: readonly SmartListEntry[];
}

/** 默认：全部显示、按声明顺序。 */
export const DEFAULT_SMART_LIST_CONFIG: SmartListConfig = {
  entries: SMART_LIST_KEYS.map((key) => ({ key, visible: true })),
};

function isSmartListKey(value: unknown): value is SmartListKey {
  return typeof value === 'string' && (SMART_LIST_KEYS as readonly string[]).includes(value);
}

/**
 * 把任意持久化值归一成**全集、有顺序、无重复**的配置（规则见文件头）。
 *
 * 两种入参形状都接受：`{ entries: [...] }`（现行写法）与裸数组（早期可能的写法）。
 */
export function normalizeSmartListConfig(value: unknown): SmartListConfig {
  let rawEntries: unknown;
  if (Array.isArray(value)) {
    rawEntries = value;
  } else if (value !== null && typeof value === 'object' && 'entries' in value) {
    rawEntries = (value as { entries?: unknown }).entries;
  }

  const seen = new Set<SmartListKey>();
  const entries: SmartListEntry[] = [];
  if (Array.isArray(rawEntries)) {
    for (const item of rawEntries) {
      if (item === null || typeof item !== 'object') continue;
      const key = (item as { key?: unknown }).key;
      if (!isSmartListKey(key) || seen.has(key)) continue;
      seen.add(key);
      const visible = (item as { visible?: unknown }).visible;
      entries.push({ key, visible: typeof visible === 'boolean' ? visible : true });
    }
  }
  for (const key of SMART_LIST_KEYS) {
    if (!seen.has(key)) entries.push({ key, visible: true });
  }
  return { entries };
}

/** 当前要显示的 key，按配置顺序（侧栏据此渲染）。 */
export function visibleSmartListKeys(config: SmartListConfig): SmartListKey[] {
  return config.entries.filter((entry) => entry.visible).map((entry) => entry.key);
}

/** 切换某一条的显隐（不改入参）。未知 key 原样返回。 */
export function setSmartListVisible(
  config: SmartListConfig,
  key: SmartListKey,
  visible: boolean,
): SmartListConfig {
  return {
    entries: config.entries.map((entry) =>
      entry.key === key ? { key: entry.key, visible } : entry,
    ),
  };
}

/**
 * 上移 / 下移一条（不改入参）。
 *
 * 已在两端时**不越界**：返回原配置（而不是把第一条绕到末尾）——
 * 那会让"再点一下"看起来像没反应，绕排更像一个 bug。
 */
export function moveSmartList(
  config: SmartListConfig,
  key: SmartListKey,
  direction: 'up' | 'down',
): SmartListConfig {
  const index = config.entries.findIndex((entry) => entry.key === key);
  if (index < 0) return config;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= config.entries.length) return config;
  const entries = [...config.entries];
  const [moved] = entries.splice(index, 1);
  if (moved === undefined) return config;
  entries.splice(target, 0, moved);
  return { entries };
}
