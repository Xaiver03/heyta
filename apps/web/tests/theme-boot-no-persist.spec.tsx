/**
 * 主题：启动时**只应用、不记账**，只有用户点开关才记账
 * =====================================================
 *
 * 出处：`pnpm verify:password-web` 第 ⑥ 步的真浏览器红 ——
 * 「系统偏好暗色时 `<html data-theme>` 必须真的是 dark」Expected `dark` / Received `light`。
 *
 * 根因不在解析链，在**接线**：原来 `applyTheme()` 一边改 DOM 一边写 localStorage，
 * 而挂载 effect 每次启动都调它 ⇒ 应用一开就把"系统当时是亮色"记成了**用户的选择**。
 * 从此 `resolveInitialTheme()` 永远命中那一条没人做过的选择，操作系统入夜切暗色
 * 再也进不来 —— 而界面上那个开关明明在，用户只会以为是自己没点过。
 *
 * 🔴 为什么这组判据必须**挂载整个 App**：只测 `lib/theme.ts` 能证明
 * `applyTheme` 不写盘，证明不了"启动时没人叫它写盘"。上次漂移的正是接线那一层，
 * 而模块级单测对那种漂移完全无感（§7 里"每一段都绿、接起来断"的同一种形状）。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { translate, type MessageKey } from '@heyta/i18n';

import { openSettingsViaAvatar } from './open-settings-via-avatar.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { THEME_STORAGE_KEY } from '../src/lib/theme.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

const t = (key: MessageKey): string => translate('zh-CN', key);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 把系统的 `prefers-color-scheme` 钉成某一档（其余媒体查询一律不匹配）。 */
function systemScheme(scheme: 'light' | 'dark'): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    ((query: string) => ({
      // 只回答暗色那一条查询：`(pointer: coarse)` 之类必须继续返回不匹配，
      // 否则认证面板会以为这是触屏设备，把用例拖到别的形态上。
      matches: query.includes('prefers-color-scheme: dark') && scheme === 'dark',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia,
  );
}

async function mountApp(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  return container;
}

/**
 * 主题开关。🔴 2026-10-06 它在 **设置 → 显示** 里（H9 第三刀），而且不再是"纯图标 +
 * `aria-label`"：那一枚 `aria-label` 的措辞本来就写着"点下去会怎样"，现在直接当**可见文字**用，
 * 所以可访问名来自文本、没有 `aria-label` 可锚 —— 定位改按 `data-testid`。
 * 顺带把"它在设置那一节里、不在页头"钉在这里：这一族的既有立场是"同一个动作只有一个入口"。
 */
function themeButton(el: HTMLElement): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]');
  if (button === null) throw new Error('外壳里没有主题开关 —— 是没渲染，还是没打开设置？');
  expect(
    button.closest('[data-testid="display-pref-panel"]') !== null,
    '主题开关不在 设置 → 显示 那一节里',
  ).toBe(true);
  expect(
    button.closest('.ht-header__actions'),
    '页头那一排又长出主题开关了（同一个动作两个入口）',
  ).toBeNull();
  // 可见文字表达当前档位；aria-label 表达点击后的目标档位。
  const currentTheme = domTheme();
  expect(button.textContent?.trim()).toBe(
    currentTheme === 'dark' ? t('web.settings.display.themeDark') : t('web.settings.display.themeLight'),
  );
  expect(button.getAttribute('aria-label')).toBe(
    currentTheme === 'dark' ? t('common.a11y.toLightTheme') : t('common.a11y.toDarkTheme'),
  );
  return button;
}

const domTheme = (): string | undefined => document.documentElement.dataset['theme'];
const storedTheme = (): string | null => localStorage.getItem(THEME_STORAGE_KEY);

beforeEach(async () => {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
  __resetOpLogForTests();
  await initOpLog();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe('主题记账的时机', () => {
  it('🔴 系统偏好暗色时首启就是暗色，而**启动本身一个字都没记**', async () => {
    systemScheme('dark');
    await mountApp();

    expect(domTheme(), '系统暗色 ⇒ 应用暗色').toBe('dark');
    // 这条才是本次修复的判据：以前这里存进了 'dark'，"用户已选"从此永久成立。
    expect(storedTheme(), '启动时不许替用户做选择').toBeNull();
  });

  it('🔴 用户点了开关**才**记账，且存的与界面当下那一档一致', async () => {
    systemScheme('dark');
    const el = await mountApp();
    expect(storedTheme()).toBeNull();
    // 开关住在设置那一节里 ⇒ 先走真路径过去（不是往 store 里塞 view）。
    await openSettingsViaAvatar(el);

    await act(async () => {
      themeButton(el).click();
    });

    expect(domTheme()).toBe('light');
    expect(storedTheme(), '只有真实点击才配写盘').toBe('light');
    expect(themeButton(el).textContent?.trim()).toBe(t('web.settings.display.themeLight'));
    expect(themeButton(el).getAttribute('aria-label')).toBe(t('common.a11y.toDarkTheme'));
  });

  /** 优先级那一半：这一条证明"不记账"没有被做过头。 */
  it('用户已经选过亮色时，系统偏好暗色**不再**覆盖它', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    systemScheme('dark');
    await mountApp();

    expect(domTheme()).toBe('light');
  });

  it('没有存储、系统偏好亮色时就是亮色（默认档仍然要落到 DOM 上）', async () => {
    systemScheme('light');
    await mountApp();

    expect(domTheme()).toBe('light');
    expect(storedTheme()).toBeNull();
  });
});
