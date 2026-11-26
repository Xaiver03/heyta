/**
 * 日历订阅列表的本机存储（读写 `META_KEYS.CALENDAR_SUBSCRIPTION_LIST`）
 * ================================================================
 *
 * 一条订阅 = `{id, name, url, enabled}`。它是**本机配置**（和 Hub 凭据同桶），
 * 不进 op-log、不跨设备：它回答的是"这台设备去拉哪个 URL"，不是一条用户意图。
 *
 * 纯函数（`add/remove/update`）与 I/O（`load/save`）分开，便于单测不碰存储。
 */

import { META_KEYS } from '@heyta/storage';

export interface CalendarSubscriptionRecord {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
}

/** 只有一对 META 读写 —— 测试可注入内存实现。 */
export interface SubscriptionMetaPort {
  getMetaValue(key: string): Promise<string | number | undefined>;
  setMetaValue(key: string, value: string | number): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 归一一条记录；没有 id 或没有 url 的丢弃（读取时容错，不让一条坏数据炸整组）。 */
function normalize(entry: unknown): CalendarSubscriptionRecord | undefined {
  if (!isRecord(entry)) return undefined;
  const id = text(entry['id']);
  const url = text(entry['url']);
  if (id === '' || url === '') return undefined;
  const rawName = text(entry['name']);
  return {
    id,
    url,
    name: rawName === '' ? hostOf(url) : rawName,
    enabled: entry['enabled'] !== false,
  };
}

/** 用 URL 的 host 当默认名字（去掉协议与常见后缀）。 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}

/** 从 META 读列表；坏 JSON / 坏形状一律当空数组。 */
export async function loadCalendarSubscriptions(
  port: SubscriptionMetaPort,
): Promise<CalendarSubscriptionRecord[]> {
  const raw = await port.getMetaValue(META_KEYS.CALENDAR_SUBSCRIPTION_LIST);
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CalendarSubscriptionRecord[] = [];
    for (const entry of parsed) {
      const record = normalize(entry);
      if (record !== undefined) out.push(record);
    }
    return out;
  } catch {
    return [];
  }
}

/** 写回列表（去重：同 id 只保留最后一条）。 */
export async function saveCalendarSubscriptions(
  port: SubscriptionMetaPort,
  list: readonly CalendarSubscriptionRecord[],
): Promise<void> {
  const seen = new Map<string, CalendarSubscriptionRecord>();
  for (const record of list) seen.set(record.id, record);
  await port.setMetaValue(META_KEYS.CALENDAR_SUBSCRIPTION_LIST, JSON.stringify([...seen.values()]));
}

/** 新增一条（同 id 已存在则替换；id 为空则生成）。 */
export function addCalendarSubscription(
  list: readonly CalendarSubscriptionRecord[],
  input: { readonly id?: string; readonly name?: string; readonly url: string },
): { readonly list: CalendarSubscriptionRecord[]; readonly record: CalendarSubscriptionRecord } {
  const url = input.url.trim();
  if (url === '') throw new Error('addCalendarSubscription: url is empty');
  const record: CalendarSubscriptionRecord = {
    id: input.id !== undefined && input.id.trim() !== '' ? input.id.trim() : newSubscriptionId(),
    url,
    name: input.name !== undefined && input.name.trim() !== '' ? input.name.trim() : hostOf(url),
    enabled: true,
  };
  return { list: [...list.filter((entry) => entry.id !== record.id), record], record };
}

export function removeCalendarSubscription(
  list: readonly CalendarSubscriptionRecord[],
  id: string,
): CalendarSubscriptionRecord[] {
  return list.filter((entry) => entry.id !== id);
}

export function updateCalendarSubscription(
  list: readonly CalendarSubscriptionRecord[],
  id: string,
  patch: { readonly name?: string; readonly url?: string; readonly enabled?: boolean },
): CalendarSubscriptionRecord[] {
  return list.map((entry) => {
    if (entry.id !== id) return entry;
    const url = patch.url !== undefined && patch.url.trim() !== '' ? patch.url.trim() : entry.url;
    return {
      ...entry,
      url,
      name: patch.name !== undefined && patch.name.trim() !== '' ? patch.name.trim() : entry.name,
      enabled: patch.enabled ?? entry.enabled,
    };
  });
}

/** 生成订阅 id。优先 `crypto.randomUUID`，没有就退化（RN / 旧 WebView）。 */
export function newSubscriptionId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoObject?.randomUUID === 'function') return `sub-${cryptoObject.randomUUID()}`;
  const rand = Math.random().toString(36).slice(2, 10);
  return `sub-${String(Date.now())}-${rand}`;
}
