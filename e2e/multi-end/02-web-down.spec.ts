import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { configureSync, openApp, requireCredentials, rowFor, sidebar, syncNow } from './helpers.js';

/**
 * 三端验收 · 第 2 相：**全新 Web 安装把两台设备的数据都拉回来**
 * ==============================================================
 *
 * 🔴 这是本轮补上的那个洞。
 *
 * 在此之前，"Web 打的标签会同步到手机"**没有任何零 mock 证据**：
 * 移动端脚本证的是"手机 ↔ 服务端 ↔ 笔记本"，浏览器套件证的是"本地 op-log 落库"。
 * Web 的**下载**那一侧从来没被验证过 —— 而 ADR-0016 记的那次事故说明
 * "上传成功、下载整批作废"是一种真实存在、且界面看着完全健康的状态。
 *
 * ## 为什么必须开在**全新的浏览器上下文**里
 *
 * Playwright 每个用例一个全新 context = **空的 IndexedDB**。
 * 这一刻的 Web 就是"刚装好的新设备"：本地什么都没有，
 * 下面每一条断言都只能靠**从服务端下载并解密**来满足。
 *
 * ## 判据的顺序（顺序本身就是判据的一部分）
 *
 *   打开应用（**还没有凭据**）→ 断言这三样都不在
 *     → 配置同步 → 断言这三样都在
 *
 * 🔴 **前半句不能省。** 少了它，"出现了"有可能只是"本来就在"
 * （数据残留、或应用自己造了一条）。有了它，出现才是**归因明确**的证据。
 * 所以"先断言空"必须在 `configureSync` **之前** —— 「保存并同步」会当场
 * 触发一次同步，配完再来断言空就已经晚了。
 *
 * ## 数据来自两个不同的客户端
 *
 * | 断言对象 | 谁写的 | 它证明什么 |
 * |---|---|---|
 * | 清单 / 标签实体 | Web（第 1 相） | 实体下载并解密成功 |
 * | 任务 A 及其归属 + 标签引用 | Web（第 1 相） | 任务上的 `tagIds` 真的跨端到达 |
 * | 任务 B | **笔记本**（shell 脚本用 node-host 建的） | **另一台设备的写入**被 Web 拉到 |
 *
 * 第三条是"能多端"的正面证据：Web 从来没见过的数据，同步之后出现了。
 */

interface Handle {
  readonly title: string;
  readonly list: string;
  readonly tag: string;
}

function readHandle(): Handle {
  const path = process.env['HEYTA_MULTI_END_HANDLE'] ?? '';
  if (path === '') {
    throw new Error('HEYTA_MULTI_END_HANDLE 没传 —— 这个用例必须由 shell 脚本启动');
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Handle;
}

const handle = readHandle();
/** 第 2 端（笔记本）建的任务标题 —— 由 shell 脚本在两次 playwright 调用之间建出来。 */
const NODE_TASK = process.env['HEYTA_NODE_TASK'] ?? '';

test.beforeAll(() => {
  requireCredentials();
  if (NODE_TASK === '') {
    throw new Error(
      'HEYTA_NODE_TASK 没传 —— 没有它这条用例就退化成"Web 拉自己写的东西"，' +
        '证明不了跨设备。shell 脚本必须先用 node-host 建一条任务并上传。',
    );
  }
});

test('全新 Web 安装：同步前为空，同步后拉到两台设备的数据', async ({ page }) => {
  await openApp(page);

  // ── ① 同步之前：本机是空的（此刻还没有任何凭据，不可能同步过）────────
  await expect(
    rowFor(page, handle.title),
    '第 1 相建的任务在"新装"里就已经在了 —— 那后面"同步后出现"就不是下载的证据',
  ).toHaveCount(0);
  await expect(rowFor(page, NODE_TASK)).toHaveCount(0);
  await expect(sidebar(page).getByText(handle.list, { exact: true })).toHaveCount(0);
  await expect(sidebar(page).getByText(handle.tag, { exact: true })).toHaveCount(0);

  // ── ② 配好凭据（「保存并同步」当场触发一次同步）────────────────────
  await configureSync(page);
  // 再显式点一次并等「已同步」：`configureSync` 里那次同步可能还在跑，
  // 而下面的断言要的是一个**确定的终态**。
  await syncNow(page);

  // ── ③ 同步之后：三样都得在 ────────────────────────────────────────
  const panel = sidebar(page);
  await expect(panel.getByText(handle.list, { exact: true })).toBeVisible();
  await expect(panel.getByText(handle.tag, { exact: true })).toBeVisible();

  const rowA = rowFor(page, handle.title);
  await expect(rowA).toBeVisible();
  await expect(rowA.getByTestId('task-chip-project')).toHaveText(handle.list);
  await expect(rowA.getByTestId('task-chip-tag')).toHaveText(handle.tag);

  // 🔴 任务 B：**笔记本**建的，Web 从没见过它。
  // 它出现，才说明"另一台设备的写入能被 Web 拉到"。
  await expect(
    rowFor(page, NODE_TASK),
    `笔记本建的任务「${NODE_TASK}」没出现在 Web 上 —— 跨设备下载没通`,
  ).toBeVisible();
});