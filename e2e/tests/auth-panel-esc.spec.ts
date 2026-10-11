import { existsSync, rmSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { openApp } from './helpers';

/**
 * 认证面板的键盘出口（§8.2 第 6 条）—— **真浏览器**判据
 * ====================================================
 *
 * 登记的缺陷：面板自报 `role="dialog" aria-modal="true"`，却**没有 Esc、
 * 焦点也不入内**。修法在 `apps/web/src/lib/use-modal-dismiss.ts`。
 *
 * 🔴 为什么这条必须在真浏览器里跑（§6.2 规定一）：面板里的邮箱/口令输入框是
 * `@heyta/ui` 的 react-native-web `TextInput`，它在 keydown 里**无条件**
 * `stopPropagation()`（AGENTS §7 第 80 条）。所以：
 *   · jsdom 里 `window.dispatchEvent(keydown)` 从 window 起步，**绕开了那条被吞的路**，
 *     冒泡阶段的实现也能"通过"；
 *   · 只有真键盘事件会真的从输入框往上冒 —— 那才是用户敲 Esc 时发生的事。
 * 这一条因此把焦点**放进输入框、在里面真的敲字**之后再按 Esc。
 * 它对应的变异臂：把 `addEventListener('keydown', fn, true)` 的 `true` 摘掉 ⇒ 这一条转红
 * （jsdom 那一半由 `apps/web/tests/auth-panel-modal-dismiss.spec.tsx` 的 A 组钉着）。
 *
 * 截图走固定路径，采集前清掉同名旧图（§6.2 第 2 条）。
 */

const DIALOG = '.ht-sheet__auth';
const SHOTS = ['auth-panel-1-open.png', 'auth-panel-2-after-esc.png'];

test.beforeEach(() => {
  for (const name of SHOTS) {
    const p = `test-results/${name}`;
    if (existsSync(p)) rmSync(p);
  }
});

test('认证面板：焦点进得去、Esc 在输入框里也关得掉', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);

  const taskList = page.locator('[data-testid="task-list"]');

  // 走真实入口：头像 → 菜单第一项「登录 / 注册」。
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('sync-signin-entry').click();

  const dialog = page.locator(DIALOG);
  await expect(dialog, '点头像→「登录 / 注册」要真的把认证面板挂出来').toBeVisible();

  // ① 焦点在面板**内部** —— 没有这一步，`aria-modal` 就是句空话：
  //    读屏用户按 Tab 会从背后那层开始，而那一层已经被宣布"不在界面上"。
  const focusInside = await page.evaluate(
    (sel) => {
      const root = document.querySelector(sel);
      const active = document.activeElement;
      return root !== null && active !== null && (root === active || root.contains(active));
    },
    DIALOG,
  );
  expect(focusInside, '打开面板后焦点必须落在面板内部').toBe(true);

  // ② 焦点放进输入框、在里面真的敲字 —— 这一句决定这条判据测的是哪条 DOM 路径。
  const email = page.getByTestId('auth-form-email');
  await email.click();
  await page.keyboard.type('reader@example.test');
  await expect(email).toHaveValue('reader@example.test');
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
    '按 Esc 之前焦点必须真的在输入框里',
  ).toBe('auth-form-email');

  await page.screenshot({ path: 'test-results/auth-panel-1-open.png' });

  // ③ 真键盘 Esc ⇒ 面板消失。
  await page.keyboard.press('Escape');
  await expect(dialog, 'Esc 之后认证面板必须消失').toHaveCount(0);

  // ④ 关掉之后底下那层完好（这一条只关它自己那一层）。
  await expect(taskList).toBeVisible();
  await page.screenshot({ path: 'test-results/auth-panel-2-after-esc.png' });

  // ⑤ 再开一次、改用面板自己的 ✕ 关 —— 两条退出口都要真的通
  //    （与设置浮层那条判据同一形状）。
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('sync-signin-entry').click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('auth-form-close').click();
  await expect(dialog, '面板自己的关闭按钮也必须通').toHaveCount(0);
});
