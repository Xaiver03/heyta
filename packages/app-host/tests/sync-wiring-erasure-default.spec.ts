/**
 * 批次 E2 —— 共享接线里那条**默认销毁回调**
 * ==========================================
 *
 * `createSyncClient()` 是三个非 Web 宿主唯一的同步构造点（node-host、移动壳、
 * 桌面壳都经 `openAppHost()` 走这里）。它给 `onAccountClosed` 装了默认值
 * "读注册表"，这一条是**承重的**：
 *
 *   没有默认值 ⇒ 构造点在别的文件里、这一轮改不动的那些宿主**静默没有销毁器**，
 *   而"信号收到了、本机什么都没少"正是这批工单要修的原始缺陷。
 *
 * 所以这里量的不是"SyncClient 会不会清"（那是 `packages/sync-client` 那套判据的事），
 * 而是"**接线有没有把清的动作交到 SyncClient 手上**"。
 */

import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));

vi.mock('@heyta/sync-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // 只换构造函数：捕获传进去的选项，其余模块表面保持真实。
    SyncClient: class {
      constructor(options: Record<string, unknown>) {
        captured.options = options;
      }
    },
  };
});

import type { OpLogEngine } from '@heyta/op-log';
import type { OpLogStore } from '@heyta/storage';
import { createSyncClient, type SyncWiringOptions } from '../src/sync-wiring.js';
import { registerLocalEraser } from '../src/local-erasure.js';

/**
 * 被测对象是**接线**，不是引擎：`createSyncClient` 只在闭包里引用这些回调，
 * 构造阶段一个都不调用，所以桩足够 —— 而那些闭包本身要逐条转发的语义
 * 由 `host.spec.ts` 那条"与手写接线等价"的判据看着。
 */
function wiring(over: Pick<SyncWiringOptions, 'onAccountClosed'> = {}): SyncWiringOptions {
  return {
    engine: { getClientId: () => 'device-x' } as unknown as OpLogEngine,
    store: {} as unknown as OpLogStore<never>,
    baseUrl: 'https://sync.test',
    getToken: async () => 'token',
    getPassword: async () => 'password',
    applyRemote: async () => undefined,
    encryptionMode: 'password' as const,
    ...over,
  };
}

type Eraser = () => Promise<void>;

function capturedEraser(): Eraser | undefined {
  const value = captured.options?.['onAccountClosed'];
  if (value === undefined) return undefined;
  if (typeof value !== 'function') throw new Error(`onAccountClosed 不是函数：${String(value)}`);
  return value as Eraser;
}

describe('createSyncClient 的默认销毁回调', () => {
  it('🔴 宿主没传时，装的默认值真的去**读注册表**（不是空函数）', async () => {
    const eraser = vi.fn(async () => [{ target: 'x', containerRemoved: true, storesCleared: 1 }]);
    const previous = registerLocalEraser(eraser);
    try {
      createSyncClient(wiring());
      const hook = capturedEraser();
      expect(hook, '接线没交任何东西给 SyncClient = 原生宿主静默没有销毁器').toBeDefined();

      await hook!();
      expect(eraser).toHaveBeenCalledTimes(1);
    } finally {
      registerLocalEraser(previous);
    }
  });

  it('宿主自己传了就用宿主的那一个，**不双清**', async () => {
    const registry = vi.fn(async () => [{ target: 'registry', containerRemoved: true, storesCleared: 1 }]);
    const owner = vi.fn(async () => undefined);
    const previous = registerLocalEraser(registry);
    try {
      createSyncClient(wiring({ onAccountClosed: owner }));
      await capturedEraser()!();
      expect(owner).toHaveBeenCalledTimes(1);
      expect(registry, '两个销毁器都跑 = 第二次清的是已经没了的东西，还多一层失败面').not.toHaveBeenCalled();
    } finally {
      registerLocalEraser(previous);
    }
  });

  it('没注册时默认回调**抛错**（SyncClient 会把它写成"没能清干净"，不许静默）', async () => {
    const previous = registerLocalEraser(undefined);
    try {
      createSyncClient(wiring());
      await expect(capturedEraser()!()).rejects.toThrow(/明文仍在/);
    } finally {
      registerLocalEraser(previous);
    }
  });
});
