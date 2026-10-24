/**
 * 桌面壳的提醒投递端口：判据在 seam，这里只验**平台那一层有没有说实话**
 * =====================================================================
 *
 * ⚠️ 与 `packages/app-host/tests/reminder-foreground.spec.ts` 的分工：
 * 那一份测的是"哪条算到点、投过不再投、投不成不写回执"；**这一份测的是端口的
 * 返回值本身对不对** —— 那一格是 `firedAt` 唯一的裁决依据，它错了，
 * 上面那份测得再绿也只是在给系统没投出去的通知补记账。
 *
 * 全部跑在纯 Node（`vitest.config.ts` 不起 Electron）：本文件只 import
 * `reminder-notify.ts`（Electron 无关的那半个文件），`Notification` / `shell`
 * 由 `DeliveryTarget` / `NotificationSurface` 这两个最小接口替身。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ForegroundDeliveryResult, NodeHost } from '@heyta/node-host';
import { handleDesktopRequest } from '../src/ipc-contract.js';
import { openDesktopHost } from '../src/host.js';
import {
  createDeliveryLedger,
  createReminderForegroundPort,
  readReminderStatus,
  waitForDeliveryEvidence,
  REMINDER_NOTIFICATION_LABELS,
  type DeliveryTarget,
  type NotificationSurface,
} from '../src/reminder-notify.js';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

function tempUserDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-desktop-notify-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一个只会按吩咐给证据的假系统通知中心。 */
function fakeSurface(
  options: {
    supported?: boolean;
    post?: (request: { occurrenceId: string; title: string; body: string }) => Promise<boolean>;
    openSettings?: () => Promise<boolean>;
  } = {},
): NotificationSurface & { calls: { occurrenceId: string; title: string; body: string }[] } {
  const calls: { occurrenceId: string; title: string; body: string }[] = [];
  return {
    calls,
    isSupported: () => options.supported ?? true,
    post: async (request) => {
      calls.push(request);
      return options.post === undefined ? true : options.post(request);
    },
    ...(options.openSettings === undefined
      ? {}
      : { openSettings: options.openSettings }),
  };
}

/** 可编排的 `DeliveryTarget`：测试自己决定系统回不回证据、回哪一个。 */
function fakeTarget(): DeliveryTarget & {
  emitShown(): void;
  emitFailed(reason?: string): void;
  shownCount: number;
} {
  let shown: (() => void) | undefined;
  let failed: ((reason: string) => void) | undefined;
  const target: DeliveryTarget & { shownCount: number } = {
    shownCount: 0,
    onShown: (listener) => {
      shown = listener;
    },
    onFailed: (listener) => {
      failed = listener;
    },
    show: () => {
      target.shownCount += 1;
    },
  };
  return Object.assign(target, {
    emitShown: () => shown?.(),
    emitFailed: (reason = 'denied by system') => failed?.(reason),
  });
}

const EMPTY_RESULT: ForegroundDeliveryResult = { delivered: [], reason: 'empty' };
const ok = (value: unknown): void => {
  if (value !== true) throw new Error(`期望 true，实际 ${String(value)}`);
};

describe('端口：authorizationStatus 说实话', () => {
  it('这台机器没有通知中心 ⇒ unsupported（不是 denied）', async () => {
    const port = createReminderForegroundPort(fakeSurface({ supported: false }));
    expect(await port.authorizationStatus()).toBe('unsupported');
  });

  it('查得到授权 ⇒ 只能报 granted，而真正的裁决在 show()（见端口注释）', async () => {
    // 🔴 这一条是**形状**断言，不是"系统已授权"的断言：Electron 44 没有
    // 任何读通知授权的 API（核对过 electron.d.ts），所以这一层能说的只有
    // "通知中心可用"。若哪天有人把它改成读真授权，这条会红，就得同步改注释。
    const port = createReminderForegroundPort(fakeSurface({ supported: true }));
    expect(await port.authorizationStatus()).toBe('granted');
  });

  it('没有 openSettings 的表面 ⇒ 端口也不提供这个方法（Linux 那一档）', () => {
    expect(createReminderForegroundPort(fakeSurface()).openSettings).toBeUndefined();
    expect(
      createReminderForegroundPort(fakeSurface({ openSettings: async () => true })).openSettings,
    ).toBeTypeOf('function');
  });
});

describe('端口：show() 的返回值决定写不写 firedAt', () => {
  it('把 seam 的请求原样递给系统（occurrenceId 不许丢）', async () => {
    const surface = fakeSurface();
    const port = createReminderForegroundPort(surface);
    ok(
      await port.show({
        occurrenceId: 'task-1:1700000000000|1700000000000',
        title: 'heyta',
        body: '该做「交周报」了',
      }),
    );
    expect(surface.calls).toEqual([
      {
        occurrenceId: 'task-1:1700000000000|1700000000000',
        title: 'heyta',
        body: '该做「交周报」了',
      },
    ]);
  });

  it('🔴 系统拒绝投递 ⇒ false（投出去才记账，假回执会让提醒永久消失）', async () => {
    const port = createReminderForegroundPort(fakeSurface({ post: async () => false }));
    expect(await port.show({ occurrenceId: 'a|1', title: 't', body: 'b' })).toBe(false);
  });

  it('🔴 端口永不抛：post() 抛了也表达成 false', async () => {
    const port = createReminderForegroundPort(
      fakeSurface({
        post: () => Promise.reject(new Error('通知中心进程不在了')),
      }),
    );
    await expect(port.show({ occurrenceId: 'a|1', title: 't', body: 'b' })).resolves.toBe(false);
  });

  it('openSettings 也不许抛：跳不过去就是 false', async () => {
    const port = createReminderForegroundPort(
      fakeSurface({ openSettings: () => Promise.reject(new Error('openExternal 失败')) }),
    );
    await expect(port.openSettings?.()).resolves.toBe(false);
  });

  it('正文是任务标题本身，不是泛泛的一句"你有新提醒"', () => {
    expect(REMINDER_NOTIFICATION_LABELS.body('交周报')).toContain('交周报');
  });
});

describe('投递证据策略（waitForDeliveryEvidence）', () => {
  const TINY = 20;

  it('darwin：系统回 show ⇒ true', async () => {
    const target = fakeTarget();
    const pending = waitForDeliveryEvidence(target, 'darwin', TINY);
    target.emitShown();
    expect(await pending).toBe(true);
    expect(target.shownCount).toBe(1);
  });

  it('darwin：系统回 failed ⇒ false', async () => {
    const target = fakeTarget();
    const pending = waitForDeliveryEvidence(target, 'darwin', TINY);
    target.emitFailed();
    expect(await pending).toBe(false);
  });

  it('🔴 darwin：两种证据都没等到 ⇒ false，且迟到的 show 不许翻案', async () => {
    const target = fakeTarget();
    const result = await waitForDeliveryEvidence(target, 'darwin', TINY);
    expect(result).toBe(false);
    // 超时之后事件才来 —— 结论已经交出去了，不能把已经判过的 false 改成 true。
    target.emitShown();
    await new Promise((resolve) => setTimeout(resolve, TINY));
    expect(result).toBe(false);
  });

  it('darwin：show() 自己抛 ⇒ false', async () => {
    const target: DeliveryTarget = {
      onShown: () => undefined,
      onFailed: () => undefined,
      show: () => {
        throw new Error('构造失败');
      },
    };
    expect(await waitForDeliveryEvidence(target, 'darwin', TINY)).toBe(false);
  });

  it('🔴 linux：没有任何证据通道 ⇒ 不抛就算投出去了（否则每次都弹而不记账）', async () => {
    const target = fakeTarget();
    expect(await waitForDeliveryEvidence(target, 'linux', TINY)).toBe(true);
    expect(target.shownCount).toBe(1);
  });

  it('linux：抛了才算被拒', () => {
    const target: DeliveryTarget = {
      onShown: () => undefined,
      onFailed: () => undefined,
      show: () => {
        throw new Error('libnotify 发不出去');
      },
    };
    return expect(waitForDeliveryEvidence(target, 'linux', TINY)).resolves.toBe(false);
  });
});

describe('主进程的投递账本 → 界面那一行状态', () => {
  it('还没跑过一轮 ⇒ lastDelivery 是 null，不是"已投 0 条"', async () => {
    const port = createReminderForegroundPort(fakeSurface());
    const status = await readReminderStatus(port, createDeliveryLedger());
    expect(status).toEqual({
      supported: true,
      authorization: 'granted',
      canOpenSettings: false,
      lastDelivery: null,
    });
  });

  it('记一轮权限被拒 ⇒ supported=false 时界面能说"到点不会响"', async () => {
    const ledger = createDeliveryLedger();
    const port = createReminderForegroundPort(
      fakeSurface({ supported: false, openSettings: async () => true }),
    );
    ledger.note(EMPTY_RESULT);
    ledger.note({ delivered: ['r-1'] });
    const status = await readReminderStatus(port, ledger);
    expect(status.supported).toBe(false);
    expect(status.authorization).toBe('unsupported');
    expect(status.canOpenSettings).toBe(true);
    // 账本只留最近一轮，而且只留**观察到的事实**。
    expect(status.lastDelivery).toEqual({ delivered: 1 });
  });
});

describe('IPC 白名单：两个新方法走的就是 main.ts 那条路', () => {
  it('notificationStatus 返回主进程账本的快照', async () => {
    const host = await openDesktopHost({ userDataDir: tempUserDataDir() });
    opened.push(host);
    const ledger = createDeliveryLedger();
    ledger.note({ delivered: [], reason: 'permission' });
    const access = {
      status: async () => ({
        supported: true,
        authorization: 'granted' as const,
        canOpenSettings: true,
        lastDelivery: ledger.snapshot(),
      }),
      openSettings: async () => true,
    };

    expect(await handleDesktopRequest(host, { method: 'notificationStatus' }, access)).toEqual({
      supported: true,
      authorization: 'granted',
      canOpenSettings: true,
      lastDelivery: { delivered: 0, reason: 'permission' },
    });
    expect(await handleDesktopRequest(host, { method: 'openNotificationSettings' }, access)).toBe(
      true,
    );
  });

  it('🔴 没接上循环时**明说**，不回一个看起来像"没授权"的默认值', async () => {
    const host = await openDesktopHost({ userDataDir: tempUserDataDir() });
    opened.push(host);
    await expect(
      handleDesktopRequest(host, { method: 'notificationStatus' }),
    ).rejects.toThrow(/前台提醒还没在主进程接上/);
  });

  it('请求里仍然没有任何字段能指定要打开的 URL（shell.openExternal 的参数不许来自页面）', async () => {
    const host = await openDesktopHost({ userDataDir: tempUserDataDir() });
    opened.push(host);
    const calls: unknown[] = [];
    const access = {
      status: async () => ({
        supported: true,
        authorization: 'granted' as const,
        canOpenSettings: true,
        lastDelivery: null,
      }),
      openSettings: async () => {
        calls.push('openSettings');
        return true;
      },
    };
    const forged = {
      method: 'openNotificationSettings',
      url: 'https://example.com',
    } as unknown as Parameters<typeof handleDesktopRequest>[1];

    await expect(handleDesktopRequest(host, forged, access)).resolves.toBe(true);
    // 伪造的 `url` 被**整条丢弃**：契约里那个方法没有参数，实现也就无处可传。
    expect(calls).toEqual(['openSettings']);
  });
});
