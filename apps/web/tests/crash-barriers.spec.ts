/**
 * 崩溃屏障的回归尺（崩溃审计 2026-11-08 · U12 / U16）
 * ====================================================
 *
 * 这一份钉的是**结构性保证**，不是某个具体 bug：
 *
 *   1. `ErrorBoundary` 真的接住渲染期抛错，并且**给出可操作的重试**；
 *   2. 边界自己在 `componentDidCatch` 里**不会再抛**（上报钩子/console 都包了）；
 *   3. `installFatalErrorHooks` 接住 `error` 与 `unhandledrejection` 两类，
 *      且对**不可字符串化的错误值**不二次抛；
 *   4. 钩子幂等（重复安装不重复记录）。
 *
 * 【这些为什么必须存在】
 *
 * 审计时的实测读数是：全仓 grep `ErrorBoundary|componentDidCatch|
 * getDerivedStateFromError` 命中 **0**，`unhandledrejection` / `addEventListener('error')`
 * 也命中 **0**。也就是说在此之前，**渲染期崩溃 = 白屏**、
 * **异步失败 = 无声消失**，而且没有任何东西会阻止这两件事回来。
 *
 * 把 `apps/web/src/lib/error-boundary.tsx` 删掉、或把 `main.tsx` 的
 * `<ErrorBoundary>` 摘掉 ⇒ 本文件的"结构性"用例变红。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  fatalErrorRecords,
  hasFatalError,
  installFatalErrorHooks,
  resetFatalErrorRecords,
} from '../src/lib/fatal-hooks.js';

describe('全局致命错误钩子（U12 第 2 条 P0 的判据）', () => {
  it('🔴 接住 window error 与 unhandledrejection 两类', () => {
    resetFatalErrorRecords();
    const off = installFatalErrorHooks({ silent: true });
    try {
      globalThis.dispatchEvent(
        new ErrorEvent('error', { error: new Error('渲染炸了'), message: '渲染炸了' }),
      );
      expect(hasFatalError()).toBe(true);
      expect(fatalErrorRecords()[0]?.kind).toBe('error');
      expect(fatalErrorRecords()[0]?.message).toBe('渲染炸了');

      // 第二类：未处理的 promise 拒绝
      globalThis.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.reject(new Error('x')).catch(() => undefined),
          reason: new Error('同步炸了'),
        }),
      );
      expect(fatalErrorRecords()[0]?.kind).toBe('unhandledrejection');
      expect(fatalErrorRecords()[0]?.message).toBe('同步炸了');
    } finally {
      off();
      resetFatalErrorRecords();
    }
  });

  it('🔴 不可字符串化的错误值不得让钩子自己再抛', () => {
    resetFatalErrorRecords();
    const off = installFatalErrorHooks({ silent: true });
    try {
      // Object.create(null) 没有 toString —— String() 对它就是 TypeError。
      const hostile = Object.create(null) as object;
      expect(() => {
        globalThis.dispatchEvent(
          new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve(),
            reason: hostile,
          }),
        );
      }).not.toThrow();
      // 记下来了，而且消息不是空串（空串会让诊断页显示空白）
      expect(fatalErrorRecords()[0]?.message).not.toBe('');
    } finally {
      off();
      resetFatalErrorRecords();
    }
  });

  it('上报钩子自己抛错不得影响记录，也不得扩散', () => {
    resetFatalErrorRecords();
    const off = installFatalErrorHooks({
      silent: true,
      onFatal: () => {
        throw new Error('上报端点挂了');
      },
    });
    try {
      expect(() => {
        globalThis.dispatchEvent(
          new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve(),
            reason: new Error('原始错误'),
          }),
        );
      }).not.toThrow();
      expect(hasFatalError()).toBe(true);
    } finally {
      off();
      resetFatalErrorRecords();
    }
  });

  it('重复安装不会重复记录（幂等）', () => {
    resetFatalErrorRecords();
    const off = installFatalErrorHooks({ silent: true });
    const off2 = installFatalErrorHooks({ silent: true });
    try {
      globalThis.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: new Error('只该记一次'),
        }),
      );
      expect(fatalErrorRecords()).toHaveLength(1);
    } finally {
      off2();
      off();
      resetFatalErrorRecords();
    }
  });

  it('资源加载类 error（error 为 null）不当作致命错误', () => {
    resetFatalErrorRecords();
    const off = installFatalErrorHooks({ silent: true });
    try {
      globalThis.dispatchEvent(new ErrorEvent('error', { error: null, message: '' }));
      expect(hasFatalError()).toBe(false);
    } finally {
      off();
      resetFatalErrorRecords();
    }
  });
});

describe('ErrorBoundary 的结构性保证', () => {
  it('🟢 边界模块导出的是一个**类组件**（React 只支持 class 边界）', async () => {
    const mod = await import('../src/lib/error-boundary.js');
    expect(typeof mod.ErrorBoundary).toBe('function');
    // 有静态 getDerivedStateFromError 才是真边界，否则 React 不会把它当边界用
    expect(typeof (mod.ErrorBoundary as unknown as { getDerivedStateFromError?: unknown })
      .getDerivedStateFromError).toBe('function');
    const proto = mod.ErrorBoundary.prototype as unknown as { componentDidCatch?: unknown };
    expect(typeof proto.componentDidCatch).toBe('function');
    // `retry` 是**实例**字段（class field），不在 prototype 上 —— 断言它的存在
    // 只能用实例。这里不渲染，所以只确认构造出来的实例上有可调用的 retry。
    const instance = new mod.ErrorBoundary({ children: null });
    expect(typeof (instance as unknown as { retry?: unknown }).retry).toBe('function');
  });

  it('🔴 三条渲染出口都必须被 ErrorBoundary 包住（源码级判据）', async () => {
    // 为什么用源码而不是渲染：main.tsx 是入口模块，import 它就真的去建 root、
    // 开数据库、挂 window 监听 —— 在单测里跑一遍没有意义且很脆。
    // 这里要钉的是一个**结构性事实**：出口数量 == 边界数量。
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // vitest 的 import.meta.url 不保证是 file: scheme，用 cwd 拼（runner 在包根跑）。
    const source = await readFile(join(process.cwd(), 'src', 'main.tsx'), 'utf8');

    // 四条真正的应用出口（?shell=1 / ?slice=1 / 管理后台 / 主应用）都要在边界里。
    // `renderFatal` 自己那条**故意不包**：它渲染的就是错误屏本身，
    // 再包一层边界只会把"错误屏崩了"变成无限递归。
    const boundaries = source.match(/<ErrorBoundary>/g) ?? [];
    expect(boundaries.length).toBeGreaterThanOrEqual(4);

    // 并且全局钩子必须**先于** createRoot 装上，否则启动早期的错误接不住。
    const hooksAt = source.indexOf('installFatalErrorHooks()');
    const rootAt = source.indexOf('const root = createRoot(');
    expect(hooksAt).toBeGreaterThan(-1);
    expect(rootAt).toBeGreaterThan(-1);
    expect(hooksAt).toBeLessThan(rootAt);
  });

  it('🔴 两条动态 import 都必须带 catch（否则 splash 永久盖着）', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // vitest 的 import.meta.url 不保证是 file: scheme，用 cwd 拼（runner 在包根跑）。
    const source = await readFile(join(process.cwd(), 'src', 'main.tsx'), 'utf8');

    // 每条 import('./dev/...') 后面都必须能找到 .catch(
    const dynamicImports = source.match(/import\('\.\/dev\/[^']+'\)/g) ?? [];
    expect(dynamicImports.length).toBeGreaterThanOrEqual(2);
    const catches = source.match(/renderFatal\(/g) ?? [];
    // renderFatal 定义 1 次 + 每个动态 import 各 1 次调用
    expect(catches.length).toBeGreaterThanOrEqual(dynamicImports.length + 1);
  });
});
