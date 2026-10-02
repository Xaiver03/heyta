/**
 * 设备本地偏好（**永不进同步**）
 * ==============================
 *
 * 这里放的是"跟这台设备这一次安装有关"的一点点状态，今天只有一个：
 * **欢迎页看过没有**（`welcome.hasSeen`）。它存在的理由是一条规范判据：
 * 规范 §3.1 要求"点「先离线使用」后不再自动弹出"，而"不再"必须**跨冷启动**
 * 成立 —— 只放内存的话，那句话在第二次启动时就是假的。
 *
 * ## 🔴 为什么**不**用 `@heyta/domain` / 同步 schema
 *
 * `packages/storage` 的 `META_KEYS` 里写得很明确：那些是**同步协议的关键状态**
 * （clientId / 游标 / 加密开关），不是普通配置。往里塞一个 UI 开关会让
 * "哪些键是协议的一部分"这件事失去边界。
 *
 * 更重要的是语义：**欢迎页不是用户数据**。它是"这台设备这一次安装"的经历，
 * 不该跟着账号跑到另一台设备上（换台设备本来就是全新的第一印象）。
 * 把它做成一个同步实体，等于让"新设备上也看不到欢迎页"。
 *
 * ## 🔴 为什么**不**引 `@react-native-async-storage/async-storage`
 *
 * 那是社区标准做法，但它是一个**新的原生依赖**：要过 AGENTS §3.1–3.2 两道门
 * （可维护性 + 许可证），还要重新配 iOS/Android 的链接与 Podfile。
 * 而本应用**已经有**一个可用的本地 SQLite（op-sqlite，`db/open-host.ts` 在用），
 * 需求是"记住一个布尔值"。为它引一个原生依赖不划算。
 *
 * ⚠️ 这与 `sync/config.ts` 的取舍**不同**，不要混淆：那里的凭据是**秘密**
 * （E2EE 口令），所以刻意不落盘；这里的值是"欢迎页看过没有"，不构成秘密。
 *
 * ## 🔴 契约：**永不抛**
 *
 * 与 `widgets/widget-bridge.ts` 同一条纪律。调用点在**应用启动的第一帧**上：
 * 在那里抛异常 = 应用起不来，而代价是"用户多看一次欢迎页"这种小事。
 * 所以任何失败都降级成"读不到 / 写不进"，并且**写不进的后果要由调用方说出来**
 * （`writeDevicePref` 返回 `false`），不许静默假装成功。
 *
 * ## 为什么另开一个数据库文件
 *
 * 不复用 `heyta.sqlite`：那个库的 schema（`INDEXEDDB_SCHEMA`）与迁移由
 * `packages/storage` 拥有，而这个键跟 op-log 一点关系都没有。另开一个文件
 * 让"设备偏好"与"用户数据"在物理上分开 —— 也就不会有人误以为它会被同步。
 */

import type { DB } from '@op-engineering/op-sqlite';

/** 数据库名（不含路径）。op-sqlite 会放到平台约定的目录下。 */
export const DEVICE_PREFS_DB_NAME = 'heyta-device-prefs.sqlite';

/** 欢迎页是否已经展示过并被用户离开。`'1'` = 看过。 */
export const PREF_KEY_WELCOME_SEEN = 'welcome.hasSeen';

const TABLE = 'device_pref';

/**
 * `undefined` = 还没试过打开；`null` = 试过、失败了（本会话不再重试）。
 *
 * 🔴 失败结果**也要缓存**：启动路径上每次读都重开一次必然失败的数据库，
 * 会把"起不来"变成"每帧卡一下"。代价是原生模块修好之前不会自愈 ——
 * 而那种情况本来就要重启应用。
 */
let connection: DB | null | undefined;

/** 打开（并建表）。任何失败都返回 `null`，**永不抛**。 */
function openPrefsDb(): DB | null {
  if (connection !== undefined) return connection;
  try {
    // 🔴 懒加载，与本仓库其它"原生模块可能不在"的路径一致
    // （见 `widgets/widget-bridge.ts`）：node 里的单测**故意**不装 react-native /
    // op-sqlite，顶层 import 会让那些测试连加载都失败。
    const mod = require('@op-engineering/op-sqlite') as {
      open: (options: { name: string }) => DB;
    };
    const db = mod.open({ name: DEVICE_PREFS_DB_NAME });
    db.executeSync(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
    );
    connection = db;
  } catch (error) {
    console.warn('[prefs] 设备本地偏好库不可用，偏好将不会跨启动保留：', error);
    connection = null;
  }
  return connection;
}

/** 读一个偏好。读不到（没有 / 库不可用）一律 `undefined` —— 不猜默认值。 */
export function readDevicePref(key: string): string | undefined {
  const db = openPrefsDb();
  if (db === null) return undefined;
  try {
    const result = db.executeSync(`SELECT value FROM ${TABLE} WHERE key = ?`, [key]);
    const rows = (result.rows ?? []) as Array<{ value?: unknown }>;
    const value = rows[0]?.value;
    return typeof value === 'string' ? value : undefined;
  } catch (error) {
    console.warn(`[prefs] 读偏好 ${key} 失败：`, error);
    return undefined;
  }
}

/**
 * 写一个偏好。返回**是否真的写进去了**。
 *
 * 🔴 返回值不是装饰：调用方（欢迎页）必须知道"这次点击有没有被记住"。
 * 返回 `false` 时用户下次启动还会看到欢迎页 —— 那是可以接受的降级，
 * 但**不能假装成功**，否则"点了先离线使用、下次还弹"会变成一个没人解释得清的现象。
 */
export function writeDevicePref(key: string, value: string): boolean {
  const db = openPrefsDb();
  if (db === null) return false;
  try {
    db.executeSync(
      `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
    return true;
  } catch (error) {
    console.warn(`[prefs] 写偏好 ${key} 失败：`, error);
    return false;
  }
}

/**
 * 删掉一个偏好。返回**是否真的删干净了**。
 *
 * 🔴 这条不是 `writeDevicePref(key, '')` 的替代品：**"没决定过"与"决定是空串"
 * 是两件事**。隐私同意的撤回要清回"还没问过"（PIPL 第 15 条要求撤回后还能
 * 重新给一次选择），而写入空串会让磁盘上留一条记录 —— 读取侧要为此特判，
 * 而任何"为此特判"的代码都是下一个漂移点。所以这里必须是真 DELETE。
 *
 * 与 `writeDevicePref` 同一条纪律：**永不抛**，把失败如实返回给调用方。
 * 撤回落盘失败的后果是"下次冷启动又带着旧决定"，那必须说出口，不能静默。
 */
export function deleteDevicePref(key: string): boolean {
  const db = openPrefsDb();
  if (db === null) return false;
  try {
    db.executeSync(`DELETE FROM ${TABLE} WHERE key = ?`, [key]);
    // 验一遍"真的不在了"：与 web 侧 `localStorage` 那条同一纪律 ——
    // 只有不抛、没生效的写入（这里是删除）不能算成功。
    const left = db.executeSync(`SELECT value FROM ${TABLE} WHERE key = ?`, [key]);
    return ((left.rows ?? []) as unknown[]).length === 0;
  } catch (error) {
    console.warn(`[prefs] 删偏好 ${key} 失败：`, error);
    return false;
  }
}

/**
 * 欢迎页是否已经被离开过。
 *
 * 🔴 只有 `'1'` 才算"看过"。缺键、库不可用、值被写坏 —— 一律当**没看过**
 * 处理（显示欢迎页）。宁可多显示一次，也不要静默跳过一段用户从没见过的引导。
 */
export function hasSeenWelcome(): boolean {
  return readDevicePref(PREF_KEY_WELCOME_SEEN) === '1';
}

/** 记下"欢迎页已经离开过"。返回是否写成功。 */
export function markWelcomeSeen(): boolean {
  return writeDevicePref(PREF_KEY_WELCOME_SEEN, '1');
}

/** 仅供测试：忘掉已打开的连接（node 里本来就是 `null`）。 */
export function resetDevicePrefsCacheForTests(): void {
  connection = undefined;
}
