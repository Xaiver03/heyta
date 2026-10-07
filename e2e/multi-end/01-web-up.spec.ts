import { expect, test } from '@playwright/test';

import {
  configureSync,
  metaFor,
  openApp,
  requireCredentials,
  rowFor,
  sidebar,
  syncNow,
} from './helpers.js';

/**
 * 三端验收 · 第 1 相：**Web 建数据并上传**
 * =========================================
 *
 * 这一相只做一件事：在真浏览器里建出清单 / 标签 / 任务并把它们挂好，
 * 然后真的同步上去。
 *
 * 🔴 **它自己判不了"上传成功了没有"。**
 * 界面上的「已同步」在上传被服务端拒收时**同样会出现**（本轮之前已经吃过
 * 两次这个亏 —— ADR-0016 记的那次是"上传成功但下载整批作废"）。
 * 所以真正的判据在 shell 脚本里：
 *
 *   1. 服务端 `operations` 表里按**任务标题**能查到那条 op；
 *   2. 第 2 端（`node-host` 真 SQLite、另一个 clientId）同步后读得到
 *      同名的清单 / 标签，并且任务上的 `tagIds` 就是那个标签的 id。
 *
 * 这个文件只负责把数据**造出来并推出去**，以及把失败点说清楚。
 */

const STAMP = Date.now().toString().slice(-6);

/** 名字统一带时间戳：断言的是**这个名字**，不是"有东西了"。 */
export const TITLE = `web-a-${STAMP}`;
export const LIST = `web-list-${STAMP}`;
export const TAG = `web-tag-${STAMP}`;

test.beforeAll(() => {
  requireCredentials();
});

test('Web 建清单/标签/任务并上传', async ({ page }) => {
  await openApp(page);
  await configureSync(page);

  // ── 建清单与标签 ────────────────────────────────────────────────
  const panel = sidebar(page);
  await expect(panel).toBeVisible();

  // 先确认侧栏里**还没有**这两个名字 —— 否则后面的"已经出现了"可能是因为
  // 上一次跑剩的数据成立，而不是这次真的建出来了。
  await expect(panel.getByText(LIST, { exact: true })).toHaveCount(0);
  await expect(panel.getByText(TAG, { exact: true })).toHaveCount(0);

  // 🔴 两个输入框**默认不在 DOM 里**（2026-09-30 起：点标题右侧的 + 才展开）。
  await panel.getByLabel('新建清单').click();
  await panel.locator('#ht-category-create-name').fill(LIST);
  await panel.getByRole('button', { name: '创建清单' }).click();
  await expect(panel.getByText(LIST, { exact: true })).toBeVisible();

  await panel.getByLabel('新建标签').click();
  await panel.locator('#ht-category-create-name').fill(TAG);
  await panel.getByRole('button', { name: '创建标签' }).click();
  await expect(panel.getByText(TAG, { exact: true })).toBeVisible();

  // ── 建任务并挂上两者 ────────────────────────────────────────────
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(TITLE);
  await composer.press('Enter');

  const row = rowFor(page, TITLE);
  await expect(row).toBeVisible();
  // 挂之前归属**不该出现在元信息槽里**（让后面的断言**有可能为假**）。
  // 🔴 选择器跟着迁移换了：行尾那枚清单 chip 已删，归属唯一的显示位
  // 是共享 `TaskBadges` 那一槽 —— 留着 chip 会让同一行里出现两遍清单名。
  await expect(metaFor(page, TITLE)).not.toContainText(LIST);
  await expect(row.getByTestId('task-chip-tag')).toHaveCount(0);

  await row.locator('summary').click();
  await row.getByLabel(`任务「${TITLE}」所属清单`).selectOption({ label: LIST });
  await expect(metaFor(page, TITLE), '归属没有出现在行的元信息槽里').toContainText(LIST);

  // ⚠️ `click()` 不是 `check()`：复选框是受控的，而 op 派发是异步的，
  // `check()` 会断言"控件当帧已勾选"并因此**假红**。理由见 AGENTS.md 陷阱 49。
  await row
    .getByRole('checkbox', { name: `给任务「${TITLE}」加上或去掉标签「${TAG}」` })
    .click();
  await expect(row.getByTestId('task-chip-tag')).toHaveText(TAG);

  // ── 推上去 ──────────────────────────────────────────────────────
  await syncNow(page);

  // 🔴 把三个名字交给 shell 脚本（它要用它们查 Postgres 和问第 2 端）。
  // 写成文件而不是 stdout：Playwright 的 stdout 里混着 reporter 的输出，
  // 去解析它是在赌 report 格式不变。
  const handle = process.env['HEYTA_MULTI_END_HANDLE'];
  if (handle !== undefined && handle !== '') {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(handle, JSON.stringify({ title: TITLE, list: LIST, tag: TAG }));
  } else {
    // 不写文件就等于 shell 拿不到名字，后面每一步都无从断言 —— 明说。
    throw new Error('HEYTA_MULTI_END_HANDLE 没传 —— shell 脚本拿不到本相创建的名字');
  }
});