import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 注销要清的那几类本机存储，在**真 Chromium** 里逐类真的没了。
 * ==========================================================
 *
 * ## 为什么这一发要单独存在
 *
 * `apps/web/tests/local-data-destruction.spec.ts`（11 条）证的是**调用序列与如实回报**，
 * 而它的 OPFS 是 `override(navigator, 'storage', { getDirectory: async () => ({ removeEntry }) })`
 * 造的一个**手搓桩**，CacheStorage 也是自造对象。于是那 11 条绿**证明不了**：
 *
 * · 真的 SAH Pool 目录（`.heyta-web/`，`heyta.sqlite` 的字节住在这儿）会不会被删掉；
 * · `indexedDB.deleteDatabase` 在真库里会不会因为**连接还开着**而永远不完成；
 * · 真 CacheStorage 里那个 `app-shell` 是不是真的没了。
 *
 * ⇒ 这三条正是"注销之后本机还留着明文"的形状。桩**能**回答"代码调了哪个函数"，
 * **不能**回答"这台机器上还有没有字节"。所以这一发用真 API 播种、用真 API 回读。
 *
 * ## 为什么它不算重复那 11 条
 *
 * 那 11 条钉的是**降级形状**（一类抛错其余照做、OPFS 不可用要如实报 `false`）—— 那些分支
 * 在真浏览器里**构造不出来**（真浏览器总有 `getDirectory`）。两层的判据不重叠。
 *
 * 🔴 库名 / 目录名 / 键前缀 / 令牌四键**一律从被测模块自己 import**，不在测试里抄第二份
 * （抄件一定会漂，而这里漂了的代价是"扫过期字符串却报绿"）。
 *
 * ## 这一发钉住的那一条实测结论（16:44:34 – 16:44:4x，真 Chromium）
 *
 * `eraseWebLocalData()` 删 OPFS 里那个 SAH Pool 目录 `.heyta-web` **必须先把存储 worker 关掉**，
 * 否则主线程的递归 `removeEntry` 会被**连续**拒绝（`NoModificationAllowedError`）：
 *
 * · 修复在位：**1 passed**（连跑两趟都过，不是碰巧）；
 * · 只摘掉 `local-data-destruction.ts:146` 那一句 `await releaseStorageWorker();`：
 *   **1 failed**，报错正是 `OPFS 目录 .heyta-web 还在` —— 这条变异读数才是"释放"这件事的判据；
 * · 摘掉后原样放回：产品文件 md5 前后逐字节相同。
 *
 * 计划 §10.59 / §10.60 / §10.61。
 */
test.describe('注销销毁：真浏览器里逐类真的没了', () => {
  test('播种真库/真 OPFS/真 CacheStorage → eraseWebLocalData → 逐类回读为空', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await openApp(page);

    const seeded = await page.evaluate(async () => {
      const mod = await import('/src/lib/local-data-destruction.ts');
      const names: string[] = [...mod.WEB_DATABASE_NAMES];
      const dirName: string = mod.WEB_OPFS_DIRECTORY;
      const prefix: string = mod.WEB_STORAGE_PREFIX;
      const tokenKeys: string[] = [...mod.WEB_SESSION_KEYS_UNPREFIXED];

      // 1) 真 IndexedDB。
      //    ⚠️ 不能一律 `open(name, 1)`：`openApp()` 已经让**应用自己**把主库按它的真实 schema
      //    建出来了（实测 v2），带着更低的版本号去开会撞 `VersionError: requested version (1)
      //    is less than the existing version (2)` —— 那是探针坏了，不是产品坏了。
      //    所以：**应用建过的库直接沿用**（那本来就是真的明文宿主），没建过的才新建一条真库。
      const existing = new Set((await indexedDB.databases()).map((d) => d.name ?? ''));
      for (const name of names) {
        if (existing.has(name)) continue;
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('seed-store');
          };
          req.onsuccess = () => {
            const db = req.result;
            if (db.objectStoreNames.contains('seed-store')) {
              const tx = db.transaction('seed-store', 'readwrite');
              tx.objectStore('seed-store').put('plaintext-op-log-row', 'k');
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            } else {
              db.close();
              resolve();
            }
          };
          req.onerror = () => reject(req.error);
        });
      }

      // 2) 真 OPFS：SAH Pool 目录里落一个文件，并把它的存在**回读出来**当分母。
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(dirName, { create: true });
      const fh = await dir.getFileHandle('heyta.sqlite', { create: true });
      const writable = await fh.createWritable();
      await writable.write('plain bytes that must not survive closure');
      await writable.close();
      let opfsSeen = false;
      await root.getDirectoryHandle(dirName).then(
        () => {
          opfsSeen = true;
        },
        () => {
          opfsSeen = false;
        },
      );

      // 3) 真 localStorage / sessionStorage：带前缀的一把 + 令牌四键。
      //    🔴 令牌四键**只种 sessionStorage**，这一档的通道是实测出来的，不是挑的：
      //    全仓真实写入方只有 `apps/desktop-macos/.../HeytaMacApp.swift:552-554`
      //    （`sessionStorage.setItem`）与 `server/public/*`（魔法登录那条今天改走
      //    URL fragment，交付说明写在 `magic-login-confirm.js:3-6`）。
      //    **没有任何一处把这四个键写进 localStorage** —— 前一版在这里也种进
      //    localStorage，于是它钉的是产品从未承诺的通道（计划 §10.61）。
      localStorage.setItem(`${prefix}:seed`, 'x');
      sessionStorage.setItem(`${prefix}:seed`, 'x');
      for (const k of tokenKeys) {
        sessionStorage.setItem(k, 'tok');
      }

      // 4) 真 CacheStorage。
      const cache = await caches.open('app-shell');
      await cache.put('/seed.txt', new Response('cached shell'));

      const before = {
        databases: (await indexedDB.databases()).map((d) => d.name ?? ''),
        ls: Object.keys(localStorage).filter((k) => k.startsWith(prefix)).length,
        tokenKeysPresent: tokenKeys.filter((k) => sessionStorage.getItem(k) !== null).length,
        caches: await caches.keys(),
      };
      return { names, dirName, prefix, tokenKeys, opfsSeen, before };
    });

    // 播种门：每一类都得**真的种上了**，否则后面的"没了"是空的真。
    expect(seeded.opfsSeen, 'OPFS 里那个目录没建出来（分母是 0，回读没有意义）').toBe(true);
    for (const name of seeded.names) {
      expect(seeded.before.databases, `库 ${name} 没种上`).toContain(name);
    }
    expect(seeded.before.caches).toContain('app-shell');
    expect(seeded.before.ls, '带前缀的键一个都没落进 localStorage').toBeGreaterThan(0);
    expect(seeded.before.tokenKeysPresent, '令牌四键一个都没落进 sessionStorage').toBeGreaterThan(0);

    const reports = await page.evaluate(async () => {
      const mod = await import('/src/lib/local-data-destruction.ts');
      const list = await mod.eraseWebLocalData();
      return list.map((r) => ({
        target: r.target,
        containerRemoved: r.containerRemoved,
        reason: r.reason ?? null,
      }));
    });

    // 凭据形状：模块自己写着"数组长度是判据，少于 4 类就是有代码没跑到"。
    expect(
      reports.length,
      `只交回 ${String(reports.length)} 类凭据：${JSON.stringify(reports)}`,
    ).toBeGreaterThanOrEqual(4);

    const after = await page.evaluate(
      async (arg) => {
        const root = await navigator.storage.getDirectory();
        let dirStillThere = true;
        await root.getDirectoryHandle(arg.dirName).then(
          () => {
            dirStillThere = true;
          },
          () => {
            dirStillThere = false;
          },
        );
        return {
          databases: (await indexedDB.databases()).map((d) => d.name ?? ''),
          lsLeft: Object.keys(localStorage).filter((k) => k.startsWith(arg.prefix)),
          ssLeft: Object.keys(sessionStorage).filter((k) => k.startsWith(arg.prefix)),
          tokenLeft: arg.tokenKeys.filter((k) => sessionStorage.getItem(k) !== null),
          caches: await caches.keys(),
          dirStillThere,
        };
      },
      { dirName: seeded.dirName, prefix: seeded.prefix, tokenKeys: seeded.tokenKeys },
    );

    for (const name of seeded.names) {
      expect(after.databases, `库 ${name} 还在（凭据：${JSON.stringify(reports)}）`).not.toContain(name);
    }
    expect(after.dirStillThere, `OPFS 目录 ${seeded.dirName} 还在`).toBe(false);
    expect(after.lsLeft, `带前缀的键还留着：${after.lsLeft.join(', ')}`).toEqual([]);
    expect(after.ssLeft, `sessionStorage 还留着：${after.ssLeft.join(', ')}`).toEqual([]);
    expect(after.tokenLeft, `令牌四键还留着：${after.tokenLeft.join(', ')}`).toEqual([]);
    expect(after.caches, `CacheStorage 还有条目：${after.caches.join(', ')}`).not.toContain('app-shell');

    // 每一类的凭据必须自己说"清到了"，不许"没清却报 true"，也不许悄悄少一类。
    const notClean = reports.filter((r) => r.containerRemoved !== true);
    expect(notClean, `有类回报没清掉：${JSON.stringify(notClean)}`).toEqual([]);

    expect(consoleErrors, `控制台报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
