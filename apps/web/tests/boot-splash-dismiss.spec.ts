/**
 * 首屏遮罩的**移除上界**（`boot-splash.ts`）。
 *
 * 为什么单独立一份：这条路径原来的全部判据都隐含"动画会结束"。实测 macOS 原生壳里
 * 窗口不是活动窗口时页面 `visibilityState === 'hidden'`，那条退场动画被创建
 * （`anims: 1`、`playState: 'running'`）却停在 `currentTime: 0` —— 于是遮罩**永远**
 * 盖在应用上，而 DOM 侧一切正常（探针点得到头像、进得了设置），
 * 只有像素证据看得见。2026-10-05 量到，见 B79 补记 #4。
 *
 * 这里不测"好不好看"，只测一件事：**任何一臂都不允许遮罩无限期留在 DOM 里**。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armBootSplashDismiss } from '../src/boot-splash.js';

function mountBoot(opts: { animationName?: string; animationDuration?: string }): HTMLElement {
  const boot = document.createElement('div');
  boot.id = 'heyta-boot';
  boot.style.animationName = opts.animationName ?? 'heyta-boot-leave';
  boot.style.animationDuration = opts.animationDuration ?? '0.26s';
  document.body.appendChild(boot);
  return boot;
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

let root: HTMLDivElement;
let realVisibility: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  realVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
});

afterEach(() => {
  vi.useRealTimers();
  if (realVisibility) Object.defineProperty(document, 'visibilityState', realVisibility);
  else delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  document.getElementById('heyta-boot')?.remove();
  root.remove();
});

describe('首屏遮罩的移除', () => {
  it('页面可见：等 animationend，不等就不摘（这条判的是"淡出没被跳过"）', () => {
    setVisibility('visible');
    const boot = mountBoot({});
    root.appendChild(document.createElement('div'));
    armBootSplashDismiss(root);
    expect(boot.isConnected).toBe(true);
    boot.dispatchEvent(new Event('animationend'));
    expect(boot.isConnected).toBe(false);
  });

  it('页面可见但动画永不收尾：有界兜底必须摘掉（时长取自计算样式 + 余量）', () => {
    setVisibility('visible');
    const boot = mountBoot({ animationDuration: '0.26s' });
    root.appendChild(document.createElement('div'));
    armBootSplashDismiss(root);
    vi.advanceTimersByTime(260);
    expect(boot.isConnected).toBe(true); // 只到时长本身还不算到点，余量是有意的一条界
    vi.advanceTimersByTime(120);
    expect(boot.isConnected).toBe(false);
  });

  it('🔴 页面不可见（macOS 壳那种后台窗口）：**立刻**摘，不等动画', () => {
    setVisibility('hidden');
    const boot = mountBoot({});
    root.appendChild(document.createElement('div'));
    armBootSplashDismiss(root);
    expect(boot.isConnected).toBe(false);
  });

  it('没有声明动画（animationName: none）：立刻摘，且不留计时器', () => {
    setVisibility('visible');
    const boot = mountBoot({ animationName: 'none' });
    root.appendChild(document.createElement('div'));
    armBootSplashDismiss(root);
    expect(boot.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('React 先跑完（容器已非空）也要摘，而不是只认 MutationObserver 那一拍', () => {
    setVisibility('hidden');
    const boot = mountBoot({});
    root.appendChild(document.createElement('div'));
    armBootSplashDismiss(root);
    expect(boot.isConnected).toBe(false);
  });

  it('产物里没有品牌帧（老构建 / 没跑生成器）：安静通过，不抛错', () => {
    setVisibility('visible');
    root.appendChild(document.createElement('div'));
    expect(() => armBootSplashDismiss(root)).not.toThrow();
  });
});
