/**
 * 移动端**共享清单的本地落盘**（日志 / 同意态 / 通知偏好）—— 设备本地偏好之上的窄 KV。
 * ================================================================================
 *
 * ## 为什么这一份住在壳里
 *
 * 三样东西的**判定本体都不在这里**：
 * - share 日志的折叠产物由 `@heyta/app-host` 的 `createShareCommentDispatch` 写，
 *   这里只实现它要求的 `ShareLogStorage` 端口；
 * - 同意态的形状（`ShareConsentStore`）与"该不该弹"（`shouldShowConsent`）在
 *   `@heyta/ui` 的 `share-consent-model`；
 * - 通知偏好的形状与"响不响"（`selectNotifiedActivities`）在 `@heyta/ui` 的
 *   `notification-model`。
 * 本文件回答的只有一件事：**这台手机上这些东西住在哪**（AGENTS §3.5）。
 * web 那端答案是 `localStorage`，移动端答案是 `prefs/device-prefs` 的那张 SQLite 表
 * （同一模块在 `lib/share-key-store.ts` 的先例：密钥走原生安全存储、
 * 而**不是**秘密的这三样走设备本地偏好 —— 密钥那一格不能落 sqlite，这一格可以）。
 *
 * ## 🔴 盘上键名与 web 逐字同名
 *
 * `heyta.share-log.` / `.index` / `.cursor.` 三族前缀照 `apps/web/src/features/share/
 * comment-actions.ts`。同名的理由不是省事：排查时"同一份数据在两端叫什么"必须只有一个答案。
 * 游标与日志**分两条键**（而不是塞进同一份 JSON）也是照它 —— 折叠产物是纯核的东西，
 * 把传输序混进去等于让它认识 HTTP。
 *
 * ## 🔴 写不进去必须说出口
 *
 * `writeDevicePref` 返回 `boolean`（库打不开时是 `false`）。`ShareLogStorage.save`
 * 的契约是 `void`，端口层塞不进"失败"这个形状 —— 所以这里把最近一次失败**记下来**，
 * 由界面读（`mobileShareLogWriteError()`）。症状是"评论写得进去、下次冷启动看不见"，
 * 而那正是本仓反复记过的"没有任何一处报错"那一类。
 *
 * ⚠️ 偏好与同意态是**本机**的（ADR-0062 决策 7：服务端零知识，改开关零请求）。
 * 它们不该跟着账号跑到另一台设备上 —— 与 `prefs/device-prefs.ts` 文件头那条
 * "设备经历不是用户数据"的裁决同一个理由。
 */

import type { ShareLogStorage } from '@heyta/app-host';
// 🔴 值导入走 `@heyta/ui/node`（`DEFAULT_NOTIFICATION_PREFS` 是纯模型）：主入口在
// node 加载即拖入 `react-native`，这一份存储的判据就必须能在 node 里真跑
// （本壳 `lib/habits-display.ts` 同一先例）。类型仍指主入口，两端是同一个形状。
import { DEFAULT_NOTIFICATION_PREFS } from '@heyta/ui/node';
import type { ShareConsentStore, ShareNotificationPrefs } from '@heyta/ui';

import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';

const LOG_PREFIX = 'heyta.share-log.';
const LOG_INDEX_KEY = 'heyta.share-log.index';
const CURSOR_PREFIX = 'heyta.share-log.cursor.';
const CONSENT_KEY = 'heyta.share-consent.v1';
const PREFS_KEY = 'heyta.share-notif-prefs.v1';

/** 注入的窄 KV（生产 = 设备本地偏好；判据 = 内存替身）。 */
export interface MobileLocalKv {
  read(key: string): string | undefined;
  write(key: string, value: string): boolean;
  remove(key: string): boolean;
}

export const devicePrefKv: MobileLocalKv = {
  read: readDevicePref,
  write: writeDevicePref,
  remove: deleteDevicePref,
};

/** 内存替身（判据与"没装原生模块"的开发路径用；不假装跨启动保留）。 */
export function createMemoryLocalKv(initial: Record<string, string> = {}): MobileLocalKv & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    read: (key) => map.get(key),
    write: (key, value) => {
      map.set(key, value);
      return true;
    },
    remove: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

/* ── share 日志（折叠产物 + 下行游标 + 可枚举索引） ─────────────────────── */

type ShareLogState = NonNullable<ReturnType<ShareLogStorage['load']>>;

const parseIndex = (raw: string | undefined): string[] => {
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * 最近一次**写日志/游标**失败的原因（`undefined` = 没有失败过）。
 * 界面读它并把这句话画出来 —— 静默的写失败等于"评论存在但下次开机没了"。
 */
let lastWriteError: string | undefined;

export function mobileShareLogWriteError(): string | undefined {
  return lastWriteError;
}

export function clearMobileShareLogWriteError(): void {
  lastWriteError = undefined;
}

function write(kv: MobileLocalKv, key: string, value: string): void {
  if (kv.write(key, value)) {
    lastWriteError = undefined;
    return;
  }
  lastWriteError = key;
}

/**
 * `ShareLogStorage` 的移动端实现（设备本地偏好之上）。
 *
 * ⚠️ 存的是**已解密的 op**（与 web 同一格事实：物化不可能拿密文过 reducer）。
 * 所以这一族键落在 sqlite 而密钥落在 Keychain —— 密钥那格是秘密，这一格
 * 是"已经解给自己看过的内容"，与主库里那些明文元数据同一档。
 */
export function createMobileShareLogStorage(kv: MobileLocalKv = devicePrefKv): ShareLogStorage {
  const readIndex = (): string[] => parseIndex(kv.read(LOG_INDEX_KEY));
  return {
    load: (shareId) => {
      const raw = kv.read(`${LOG_PREFIX}${shareId}`);
      if (raw === undefined) return undefined;
      try {
        return JSON.parse(raw) as ShareLogState;
      } catch {
        // 坏 JSON ⇒ 当作没有（下一次 save 整块覆盖）。与 app-host 对密钥环
        // "坏 JSON ⇒ 空存储"同一口径：不让一格坏数据把整条通道判成"需要解锁"。
        return undefined;
      }
    },
    save: (shareId, log) => {
      write(kv, `${LOG_PREFIX}${shareId}`, JSON.stringify(log));
      const index = readIndex();
      if (!index.includes(shareId)) {
        write(kv, LOG_INDEX_KEY, JSON.stringify([...index, shareId]));
      }
    },
    list: readIndex,
    cursor: (shareId) => {
      const raw = kv.read(`${CURSOR_PREFIX}${shareId}`);
      const n = raw === undefined ? Number.NaN : Number(raw);
      // 坏值退到 0：退到 0 只会多拉一次（折叠是幂等的），退到别的值会**少拉**。
      return Number.isInteger(n) && n >= 0 ? n : 0;
    },
    setCursor: (shareId, seq) => {
      write(kv, `${CURSOR_PREFIX}${shareId}`, String(seq));
    },
  };
}

/**
 * 清掉一份共享在本机的**下行数据**（日志 + 游标 + 索引那一格）。
 * 密钥不在这里删 —— 那是 `lib/share-key-store.ts` 那一格（`deleteShareKeyPortable`）。
 * 两件都做才叫离场，判据在 app-host 的 `forgetShareLocally`。
 */
export function clearMobileShareLog(kv: MobileLocalKv, shareId: string): void {
  kv.remove(`${LOG_PREFIX}${shareId}`);
  kv.remove(`${CURSOR_PREFIX}${shareId}`);
  write(kv, LOG_INDEX_KEY, JSON.stringify(parseIndex(kv.read(LOG_INDEX_KEY)).filter((id) => id !== shareId)));
}

/* ── PIPL 23 单独同意态 ─────────────────────────────────────────────────── */

/**
 * 读同意态。**读不到 = 没有记录**，而"没有记录"在模型那边是 fail-closed
 * （`shouldShowConsent` 返回 `show: true`）—— 所以这里不许猜一个默认值。
 */
export function loadMobileShareConsent(kv: MobileLocalKv = devicePrefKv): ShareConsentStore {
  const raw = kv.read(CONSENT_KEY);
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as ShareConsentStore;
    if (parsed === null || typeof parsed !== 'object') return {};
    return {
      consentAcceptedAt:
        typeof parsed.consentAcceptedAt === 'number' ? parsed.consentAcceptedAt : undefined,
      dontAskAgain: parsed.dontAskAgain === true,
    };
  } catch {
    return {};
  }
}

/** 写同意态。返回**是否真的写进去了** —— 「不再提示」写不进去下次还会弹，那句话要说出口。 */
export function saveMobileShareConsent(store: ShareConsentStore, kv: MobileLocalKv = devicePrefKv): boolean {
  return kv.write(CONSENT_KEY, JSON.stringify(store));
}

/* ── 通知偏好（ADR-0062 决策 7：只落本地，零网络请求） ─────────────────── */

/**
 * 逐字段回填而不是整块信任磁盘（坏数据回落默认值，不让一个键拖垮整组偏好）。
 * 与 `apps/web/src/features/share/share-notif-prefs.ts` 同一条读法 —— 那份签名吃
 * DOM 的 `Storage`，移动端没有那个全局，所以这里只能同形另写一份（登记在册）。
 */
export function loadMobileShareNotificationPrefs(
  kv: MobileLocalKv = devicePrefKv,
): ShareNotificationPrefs {
  const raw = kv.read(PREFS_KEY);
  if (raw === undefined) return DEFAULT_NOTIFICATION_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<ShareNotificationPrefs>;
    return {
      activities: {
        onCompleted:
          parsed.activities?.onCompleted ?? DEFAULT_NOTIFICATION_PREFS.activities.onCompleted,
        onAdded: parsed.activities?.onAdded ?? DEFAULT_NOTIFICATION_PREFS.activities.onAdded,
        onDeleted: parsed.activities?.onDeleted ?? DEFAULT_NOTIFICATION_PREFS.activities.onDeleted,
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

/** 存偏好。返回**是否真的落盘** —— 开关点了没落盘的后果是"下次开机又全关上"。 */
export function saveMobileShareNotificationPrefs(
  prefs: ShareNotificationPrefs,
  kv: MobileLocalKv = devicePrefKv,
): boolean {
  return kv.write(PREFS_KEY, JSON.stringify(prefs));
}
