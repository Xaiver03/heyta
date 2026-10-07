import { mkdir } from 'node:fs/promises';
import { test } from '@playwright/test';
import { addTask, openApp, switchTheme } from './helpers';

test('任务行 390px 亮暗主题取证', async ({ page }) => {
  test.setTimeout(120_000);
  const out = '../apps/web/evidence/page-taste-review';
  await mkdir(out, { recursive: true });
  await openApp(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addTask(page, '准备项目复盘');
  await addTask(page, '整理下一阶段的阅读计划');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/tasks-390-light.png` });
  await switchTheme(page, 'dark');
  await page.screenshot({ path: `${out}/tasks-390-dark.png` });
});
