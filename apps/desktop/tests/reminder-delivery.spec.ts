/**
 * 前台提醒的**接线**：真宿主 + 真 SQLite + 真到点提醒
 * ====================================================
 *
 * ⚠️ 这个文件存在的唯一理由，是本仓最高发的那类失效：
 * `reminder-foreground.ts` 有单测（`packages/app-host/tests/reminder-foreground.spec.ts`），
 * 本壳的端口也有单测（`tests/reminder-notify.spec.ts`）—— 而**两件各有测试的东西
 * 拼在一起没人拼过**，就等于"应用开着、提醒到点，仍然什么都不响"。
 * `apps/web/src/features/reminders/use-reminder-notifications.ts` 的文件头把这件事
 * 写得很直白：*纯函数有测试 ≠ 用户收得到*。
 *
 * 所以这里的每一格都是**从 `openDesktopHost()` 开始、走 `main.ts` 用的那同一个方法**
 * （`host.startForegroundReminders`），中间不另接一套：
 *
 *   1. 库里真有一条**已过点**的提醒（经 op-log 写进去，形状 = 同步从别的设备
 *      物化过来的那条；本壳没有提醒界面，也没有建提醒的 IPC 方法，
 *      所以"提醒从哪儿来"这一格只能由 op-log 代表 —— 它也正是同步的路径）；
 *   2. 循环挂上后**第一轮真的把它投出去**（`show()` 收到的是任务标题）；
 *   3. 投递成功 ⇒ `firedAt` 落库 ⇒ **换一个新宿主、新内存去重集**再跑一轮，
 *      结论是 `empty`（跨重启不重弹，靠的是写进同步事实的那条回执，不是内存）；
 *   4. 系统拒投 ⇒ **不许写假回执**：换一个宿主再跑，它会**再试一次**
 *      （这一条是本 seam 最要紧的红线 —— 假回执会让提醒永久消失）。
 *
 * 🔴 另外两格守的是"启动时不问权限"：
 * - 没有待投递的提醒时，端口**一次都不被调用**（连 `isSupported()` 都不问），
 *   所以不存在"应用一打开就弹系统授权框"那条路；
 * - 本壳的端口**不提供** `requestAuthorization`（Electron 主进程没有这个 API），
 *   seam 的"只在 `default` 时升级成系统询问"因此永远不会触发。
 *
 * 没有 mock 引擎：每个用例都开一个临时目录里的真实 `.sqlite` 文件。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ForegroundDeliveryResult,
  NodeHost,
  ReminderForegroundPort,
} from '@heyta/node-host';

import { openDesktopHost } from '../src/host.js';
import {
  createReminderForegroundPort,
  REMINDER_NOTIFICATION_LABELS,
  type NotificationSurface,
} from '../src/reminder-notify.js';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

function tempUserDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-desktop-remind-'));
  tempDirs.push(dir);
  return dir;
}

async function openHost(userDataDir: string): Promise<NodeHost> {
  const host = await openDesktopHost({ userDataDir });
  opened.push(host);
  return host;
}

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * `dispatch` 的入参类型**从共享接口派生**，不自己写一遍（同 `ipc-contract.ts` 的理由）。
 */
type DispatchIntent = Parameters<NodeHost['dispatch']>[0];

/**
 * 写一条**已过点**的提醒进库。
 *
 * ⚠️ 这里是**测试夹具**，不是壳的业务判断：`entityId` 与载荷的键名来自
 * `@heyta/app-host` 的 `reminder-actions.ts`（`createReminderActions().createReminder`
 * 落的就是这一发 CRT）。本壳**没有**、也不该有第二个建提醒的实现 ——
 * 桌面端真正的提醒来源是同一条 op-log（别的设备建好同步过来）。
 * 之所以要在测试里手写这一发：`NodeHost` 目前**没有**提醒动作的出口
 * （`createReminderActions` 没被透传出来，见交付说明里那条"建提醒的入口还缺"）。
 *
 * 🔴 夹具错了不会假绿：提醒没物化的话第一轮就是 `empty`，下面每一条断言都会红。
 */
async function seedDueReminder(
  host: NodeHost,
  title: string,
  minutesAgo: number,
): Promise<{ taskId: string; reminderId: string; triggerAt: number }> {
  const taskId = await host.addTask(title);
  const triggerAt = Date.now() - minutesAgo * 60_000;
  const reminderId = `${taskId}:${String(triggerAt)}`;
  await host.dispatch({
    entityType: 'REMINDER',
    entityId: reminderId,
    opType: 'CRT' as DispatchIntent['opType'],
    payload: { taskId, triggerAt },
  });
  return { taskId, reminderId, triggerAt };
}

/** 一个只记录"系统被问了什么、答了什么"的通知表面。 */
function stubSurface(
  delivers: boolean,
  supported = true,
): {
  surface: NotificationSurface;
  readonly posts: { occurrenceId: string; title: string; body: string }[];
  /** 用**函数**而不是数字：数字会是"取快照那一刻"的值，读之前就定死了。 */
  authCalls(): number;
} {
  const posts: { occurrenceId: string; title: string; body: string }[] = [];
  let asked = 0;
  const surface: NotificationSurface = {
    isSupported: () => {
      asked += 1;
      return supported;
    },
    post: async (request) => {
      posts.push(request);
      return delivers;
    },
  };
  return { surface, posts, authCalls: () => asked };
}

/**
 * 挂上循环、等**第一轮**投递落回来、立刻取消。
 *
 * 🔴 走的就是 `main.ts` 里那一行 `opened.startForegroundReminders(port, {...})` ——
 * 测试里另接一份"看起来一样的"接线，测的就不是应用了。
 * 超时不是"算了"而是**红**：第一轮没跑完正是"接线没挂上"的症状。
 */
async function firstPass(
  host: NodeHost,
  port: ReminderForegroundPort,
): Promise<ForegroundDeliveryResult> {
  return await new Promise<ForegroundDeliveryResult>((resolve, reject) => {
    let settled = false;
    let cancel: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      cancel?.();
      action();
    };
    timer = setTimeout(
      () => finish(() => reject(new Error('前台提醒的第一轮投递没跑完（接线没挂上？）'))),
      5_000,
    );
    cancel = host.startForegroundReminders(port, {
      labels: REMINDER_NOTIFICATION_LABELS,
      onDelivery: (result) => finish(() => resolve(result)),
      onError: (error) => finish(() => reject(error)),
    });
  });
}

describe('桌面端前台提醒：从宿主到通知中心的整条路', () => {
  it('🔴 到点的提醒真的被投出去，正文是任务标题', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openHost(userDataDir);
    const { reminderId } = await seedDueReminder(host, '交周报', 2);
    const stub = stubSurface(true);

    const result = await firstPass(host, createReminderForegroundPort(stub.surface));

    expect(result.delivered).toEqual([reminderId]);
    expect(result.reason).toBeUndefined();
    expect(stub.posts).toHaveLength(1);
    // seam 的 occurrenceId = `<提醒 id>|<生效时刻>`：丢了我发现不了"重复投递"。
    expect(stub.posts[0]?.occurrenceId.startsWith(reminderId)).toBe(true);
    // 标题/正文来自宿主注入的那一份 labels（产品名 + 任务标题），不是泛泛的一句"你有新提醒"。
    expect(stub.posts[0]?.title).toBe(REMINDER_NOTIFICATION_LABELS.title);
    expect(stub.posts[0]?.body).toBe('交周报');
  });

  it('🔴 投出去的那条写了 firedAt：换一个新宿主（新内存去重集）再跑就是 empty', async () => {
    const userDataDir = tempUserDataDir();
    const first = await openHost(userDataDir);
    await seedDueReminder(first, '交周报', 2);
    const firstStub = stubSurface(true);
    expect((await firstPass(first, createReminderForegroundPort(firstStub.surface))).delivered)
      .toHaveLength(1);
    first.close();
    opened.pop(); // 已经手动关过，别让 afterEach 再关一次

    // 同一个文件、全新引擎、全新 `shown` 集合 —— 只有落库的回执能挡住第二次弹。
    const second = await openHost(userDataDir);
    const secondStub = stubSurface(true);
    const result = await firstPass(second, createReminderForegroundPort(secondStub.surface));

    expect(result).toEqual({ delivered: [], reason: 'empty' });
    expect(secondStub.posts).toHaveLength(0);
  });

  it('🔴 系统拒投 ⇒ 不写假回执：换一个新宿主还会**再试一次**', async () => {
    const userDataDir = tempUserDataDir();
    const first = await openHost(userDataDir);
    await seedDueReminder(first, '交周报', 2);
    const refused = stubSurface(false); // 通知中心说"弹不出去"
    const firstResult = await firstPass(first, createReminderForegroundPort(refused.surface));

    expect(firstResult.delivered).toEqual([]);
    expect(firstResult.reason).toBe('failed');
    expect(refused.posts).toHaveLength(1);
    first.close();
    opened.pop();

    const second = await openHost(userDataDir);
    const retry = stubSurface(false);
    const secondResult = await firstPass(second, createReminderForegroundPort(retry.surface));

    // 这条断言是整个设计的重心：拒投**不能**被记成"已经提醒过了"。
    expect(retry.posts).toHaveLength(1);
    expect(secondResult.reason).toBe('failed');
  });

  it('这台机器没有通知中心 ⇒ reason 是 unsupported，一条都不投', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openHost(userDataDir);
    await seedDueReminder(host, '交周报', 2);
    const stub = stubSurface(true, false);

    const result = await firstPass(host, createReminderForegroundPort(stub.surface));

    expect(result).toEqual({ delivered: [], reason: 'unsupported' });
    expect(stub.posts).toHaveLength(0);
  });

  it('🔴 没有待投递的提醒时，端口一次都不被调用（启动时不问权限、不弹系统框）', async () => {
    const userDataDir = tempUserDataDir();
    const host = await openHost(userDataDir);
    await host.addTask('没有提醒的任务');
    const stub = stubSurface(true);

    const result = await firstPass(host, createReminderForegroundPort(stub.surface));

    expect(result).toEqual({ delivered: [], reason: 'empty' });
    expect(stub.authCalls()).toBe(0);
    expect(stub.posts).toHaveLength(0);
  });

  it('🔴 本壳的端口不提供 requestAuthorization（Electron 主进程没有这个 API）', async () => {
    const port = createReminderForegroundPort(stubSurface(true).surface);
    // seam 的"升级成系统询问"只在这个方法**存在**时才发生；不提供 = 永远不会在
    // 启动或空转时替用户弹一个系统授权框。
    expect(port.requestAuthorization).toBeUndefined();
  });
});
