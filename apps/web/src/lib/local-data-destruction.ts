/**
 * Web 宿主的本机数据销毁：把这台浏览器里属于 heyta 的东西**逐类**清掉。
 * ==========================================================
 *
 * 为什么单独一个文件而不是塞进同步 store：注销信号到达时，正在跑的可能是
 * 任何一条同步路径（自动重试、手动按钮、realtime 通道）。销毁是**设备级**动作，
 * 不属于任何一个界面状态机。
 *
 * 🔴 为什么必须"逐类"而不是"清一个来源"（这是本文件存在的全部理由）：
 * `lib/oplog.ts` 的迁移在设计上**刻意不删旧库**（原文：「两者可并存一个版本周期」，
 * `apps/web/src/lib/oplog.ts` 的 `migrateLegacyIndexedDb` / `migrateLegacyOpfsSqlite`），
 * 而 `importIntoEmptyTarget` 的守卫是"**目标是空库就灌进去**"。
 * ⇒ 只清当前后端 = 下次启动时那个被留下的旧库把数据**原样复活**，
 * 而界面会说"已清除"。所以这里的清单必须覆盖每一个可能的来源。
 *
 * 四类存储（清单由 `tests/local-data-destruction.spec.ts` 与真源对账钉住）：
 *   1. IndexedDB：`heyta`（活体数据）、`heyta-vault`（**密钥材料**）、
 *      `heyta-widget`（Service Worker 写的今日小组件数据）
 *   2. OPFS：SAH Pool 的 `.heyta-web` 目录（`heyta.sqlite` 的字节住在这儿）
 *   3. `localStorage`：所有 `heyta*` 键（前缀扫，不点名 —— 见下面那条理由）
 *      加上 `sessionStorage` 里**不带前缀**的令牌/邮箱四键（点名，见
 *      {@link WEB_SESSION_KEYS_UNPREFIXED}）
 *   4. Service Worker：反注册 + 清空 CacheStorage（小组件数据在其中有副本）
 *
 * ⚠️ **`localStorage` 走前缀而不是点名清单**：键是各自模块自己加的
 * （`lib/theme.ts`、`lib/locale.ts`、`features/shell/modules.ts`…共 9 个以上），
 * 点名清单注定会漂 —— 漂了的症状是"注销后还有一个键留着"，
 * 而没人会去看第二遍。前缀扫把"以后又加了一个键"这件事自动覆盖掉。
 * 设备偏好（主题/语言/侧栏宽度）一起清掉是**对的**：注销之后这台设备
 * 上不该再留着关于这个人的一切痕迹。
 */

import { IndexedDbAdapter, type DbDestroyReport } from '@heyta/storage';

/**
 * 这个宿主管辖的 IndexedDB 数据库名。
 *
 * ⚠️ 三个名字的真源**不在这个文件里**（分别是 `lib/oplog.ts` 的默认库名、
 * `lib/vault-session.ts` 的 `DB_NAME`、`pwa/sw.ts` 的 `DB_NAME`）。
 * 这里是一份**抄件**，所以判据必须去比对真源 —— 见
 * `apps/web/tests/local-data-destruction.spec.ts` 的「逐条与真源对账」那一节。
 * 抄件本身是必要的：销毁动作必须能在**不 import** 那三个模块的情况下跑完
 * （`pwa/sw.ts` 是 Service Worker 的入口，import 进主线程会把它整个带进来）。
 */
export const WEB_DATABASE_NAMES = ['heyta', 'heyta-vault', 'heyta-widget'] as const;

/** `localStorage` / `sessionStorage` 里属于本应用的前缀。 */
export const WEB_STORAGE_PREFIX = 'heyta';

/**
 * 🔴 `sessionStorage` 里**不带 `heyta` 前缀**、却装着这个人最敏感信息的键。
 *
 * 前缀扫抓不到它们，所以必须点名。理由不是洁癖：
 *   · **写入方不在 `apps/web`**：macOS 壳在授权回跳时直接往页面自己 origin 的
 *     `sessionStorage` 注入（`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift`
 *     的 `loginToken` / `sessionToken` 那一支），所以 web 里搜 `setItem` 搜不到。
 *   · 值是三类里最敏感的：**一枚登录令牌 / 一个会话 JWT + 用户邮箱明文**。
 *   · 正常路径下应用读到就立刻删（`takePendingLogin` 的「先抹再判」），
 *     但"登录走到一半被打断"就是这个集合存在的全部理由 —— 注销时若还留着，
 *     "这台设备上的副本已清除"当场是假话。
 *
 * 真源是 `features/auth/pending-login.ts` 的四个导出常量；判据逐条与它对账
 * （`tests/local-data-destruction.spec.ts`），改一边必须改另一边。
 */
export const WEB_SESSION_KEYS_UNPREFIXED = [
  'loginToken',
  'loginBaseUrl',
  'sessionToken',
  'loginEmail',
] as const;

/**
 * OPFS 里那个 SAH Pool 的目录名。
 *
 * 🔴 它由 `installOpfsSahPool` 从 VFS 名派生：`directory: '.${vfsName}'`，
 * 而 `vfsName` 是 `apps/web/src/worker/storage.worker.ts` 的 `DB_VFS_NAME`。
 * **换 VFS 名必须同时换这里**，否则销毁删的是一个空目录、报的是"删了"。
 * 这条耦合由判据盯着（同上那份 spec 的真源对账）。
 */
export const WEB_OPFS_DIRECTORY = '.heyta-web';

/** 主库（活体数据）用的适配器名 —— 与 `initOpLog()` 的默认值同为一个字面量。 */
const MAIN_DATABASE = 'heyta';

function report(
  target: string,
  containerRemoved: boolean,
  extra?: { readonly reason?: string; readonly storesCleared?: number },
): DbDestroyReport {
  return {
    target,
    containerRemoved,
    ...(extra?.reason !== undefined ? { reason: extra.reason } : {}),
    storesCleared: extra?.storesCleared ?? 0,
  };
}

/** 裸 `deleteDatabase`（用于不由我们的适配器管的那两个库）。 */
function deleteDatabase(name: string): Promise<DbDestroyReport> {
  return new Promise<DbDestroyReport>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(report(name, true));
      request.onerror = () =>
        resolve(
          report(name, false, {
            reason: `deleteDatabase 失败：${String(request.error?.message ?? '未知错误')}`,
          }),
        );
      // onblocked：与适配器同一取舍 —— 等，不假装成功。
    } catch (error) {
      resolve(
        report(name, false, { reason: `deleteDatabase 抛错：${(error as Error).message}` }),
      );
    }
  });
}

/**
 * 删掉 OPFS 里的那个池目录。
 *
 * ⚠️ `NotFoundError`（目录本来就没有）算**成功**：销毁的语义是"事后不存在"，
 * 不是"我删了一次"。
 * ⚠️ 池里的文件可能被 storage worker 的同步句柄占着 —— 那种失败**如实报出去**，
 * 由调用方决定怎么说（不静默、不重试到永远）。
 */
async function removeOpfsDirectory(): Promise<DbDestroyReport> {
  const root = globalThis.navigator?.storage?.getDirectory;
  if (typeof root !== 'function') {
    return report(`opfs:${WEB_OPFS_DIRECTORY}`, false, {
      reason: '这个浏览器没有 navigator.storage.getDirectory（OPFS 不可用）',
    });
  }
  try {
    const dir = await root.call(globalThis.navigator.storage);
    await dir.removeEntry(WEB_OPFS_DIRECTORY, { recursive: true });
    return report(`opfs:${WEB_OPFS_DIRECTORY}`, true);
  } catch (error) {
    const notFound = (error as { name?: string } | undefined)?.name === 'NotFoundError';
    if (notFound) return report(`opfs:${WEB_OPFS_DIRECTORY}`, true);
    return report(`opfs:${WEB_OPFS_DIRECTORY}`, false, {
      reason: `删除 OPFS 目录失败：${(error as Error).message}`,
    });
  }
}

/** 前缀扫掉一个 Storage 上属于本应用的键。返回删掉的个数。 */
function wipePrefixedKeys(store: Storage | undefined): number {
  if (store === undefined) return 0;
  let removed = 0;
  try {
    // 先收集再删：`removeItem` 会让 `length`/`key(i)` 当场变化，
    // 边遍历边删会跳过一半的键（这是这一类代码最常见的错法）。
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null && key.startsWith(WEB_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      store.removeItem(key);
      removed++;
    }
  } catch {
    // 隐私模式下**访问** localStorage 这个属性本身就会抛（同 `lib/theme.ts` 的契约）。
    // 这里不抛出去：抛了会让后面几类（OPFS/SW）都不做。
    return -1;
  }
  return removed;
}

/**
 * 点名删掉几个键（前缀扫抓不到的那些，见 {@link WEB_SESSION_KEYS_UNPREFIXED}）。
 * 返回**实际删掉的**个数：键本来不存在是常态（正常登录路径读到就抹了），
 * 不是失败。
 */
function wipeExactKeys(store: Storage | undefined, keys: readonly string[]): number {
  if (store === undefined) return 0;
  let removed = 0;
  try {
    for (const key of keys) {
      if (store.getItem(key) !== null) {
        store.removeItem(key);
        removed++;
      }
    }
  } catch {
    return -1;
  }
  return removed;
}

/** 清掉 CacheStorage 里的一切，并反注册 Service Worker。 */
async function clearServiceWorkerLayer(): Promise<DbDestroyReport> {
  const cachesApi = globalThis.caches;
  let removed = 0;
  const failures: string[] = [];
  if (cachesApi?.keys !== undefined) {
    for (const key of await cachesApi.keys()) {
      try {
        await cachesApi.delete(key);
        removed++;
      } catch (error) {
        failures.push(`${key}: ${(error as Error).message}`);
      }
    }
  }
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.();
    await registration?.unregister();
  } catch (error) {
    failures.push(`unregister: ${(error as Error).message}`);
  }
  return report(
    `sw:caches(${String(removed)})`,
    failures.length === 0,
    failures.length === 0 ? undefined : { reason: failures.join('; '), storesCleared: removed },
  );
}

/**
 * 执行销毁。**每一类都要跑完**，一类的失败不许让其余几类不做。
 *
 * 逐类交回 {@link DbDestroyReport}：调用方（`@heyta/app-host` 的注册表）
 * 把它们留作凭据，界面据此决定能说"已清除"还是只能说"没清干净"。
 *
 * 🔴 返回的数组**长度是判据**：少于 4 类就是有代码没跑到。
 */
export async function eraseWebLocalData(): Promise<DbDestroyReport[]> {
  const reports: DbDestroyReport[] = [];

  // 1. 主库走**适配器自己的 destroy**（`DbAdapter.destroy` 契约的调用方就是这里；
  //    它此前零调用方，是 §10.2 那条取证点名的洞）。
  try {
    reports.push(await new IndexedDbAdapter(MAIN_DATABASE).destroy());
  } catch (error) {
    reports.push(
      report(MAIN_DATABASE, false, { reason: `适配器销毁失败：${(error as Error).message}` }),
    );
  }

  for (const name of WEB_DATABASE_NAMES) {
    if (name === MAIN_DATABASE) continue;
    reports.push(await deleteDatabase(name));
  }

  reports.push(await removeOpfsDirectory());

  const local = wipePrefixedKeys(globalThis.localStorage);
  reports.push(
    local < 0
      ? report('localStorage', false, { reason: 'localStorage 不可访问（隐私模式？）' })
      : report(`localStorage(${String(local)})`, local >= 0),
  );
  const session = wipePrefixedKeys(globalThis.sessionStorage);
  reports.push(
    session < 0
      ? report('sessionStorage', false, { reason: 'sessionStorage 不可访问（隐私模式？）' })
      : report(`sessionStorage(${String(session)})`, session >= 0),
  );
  // 令牌与邮箱那四个键**不带前缀**（写入方是 macOS 壳的注入），前缀扫抓不到。
  const pending = wipeExactKeys(globalThis.sessionStorage, WEB_SESSION_KEYS_UNPREFIXED);
  reports.push(
    pending < 0
      ? report('sessionStorage:令牌键', false, { reason: 'sessionStorage 不可访问（隐私模式？）' })
      : report(`sessionStorage:令牌键(${String(pending)})`, true),
  );

  reports.push(await clearServiceWorkerLayer());

  return reports;
}
