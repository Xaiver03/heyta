/**
 * `NodeHost.startForegroundReminders`：透传**递的是真宿主**，不是形状像的东西
 * ==========================================================================
 *
 * 这一层夹在两个已被测过的东西中间，而两边都摸不到它：
 * - `packages/app-host/tests/reminder-foreground.spec.ts` 用的是一个手搭的
 *   `{ getState, dispatch }` 假宿主；
 * - `apps/desktop/tests/reminder-notify.spec.ts` 用的是假的系统通知中心。
 * ⇒ 中间这一格（真 SQLite 文件上的真宿主 + 真提醒 + 投递回执真的落库）
 *   若没人测，坏起来的形状是"两端都绿，而循环从来没拿到过宿主"。
 *
 * 每个用例都开临时目录里的**真实** `.sqlite` 文件，零 mock。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reminderIsFired } from '@heyta/domain';
import { createReminderActions } from '@heyta/app-host';
import type { ReminderForegroundPort } from '@heyta/app-host';

import { openNodeHost, type NodeHost } from '../src/host.js';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];
const labels = { title: 'heyta', body: (taskTitle: string) => `该做「${taskTitle}」了` };

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-node-reminder-'));
  tempDirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function recordingPort(): {
  port: ReminderForegroundPort;
  shown: { occurrenceId: string; title: string; body: string }[];
} {
  const shown: { occurrenceId: string; title: string; body: string }[] = [];
  return {
    shown,
    port: {
      authorizationStatus: async () => 'granted',
      show: async (request) => {
        shown.push(request);
        return true;
      },
    },
  };
}

describe('NodeHost 的前台提醒循环', () => {
  it('🔴 真到点的提醒：经真宿主投出去，并把 firedAt 落进真 SQLite 的 op-log', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    const taskId = await host.addTask('交周报');
    const triggerAt = Date.now() - 1_000;
    const reminderId = await createReminderActions(host.engine).createReminder(taskId, triggerAt);
    const { port, shown } = recordingPort();

    const cancel = host.startForegroundReminders(port, { labels });
    await flush();
    cancel();

    // 正文里必须有任务标题 —— "你有新提醒"那种泛泛的一句不算投递。
    expect(shown).toEqual([
      { occurrenceId: `${reminderId}|${String(triggerAt)}`, title: 'heyta', body: '该做「交周报」了' },
    ]);
    // 回执是**经 op-log 写的**：领域层判 fired，之后任何一端重放都不该再进 due()。
    const reminder = host.engine.getState().reminders[reminderId] as never;
    expect(reminderIsFired(reminder)).toBe(true);

    // 同一进程里再挂一次循环：已投过的不许再弹（去重落在库里，不只在内存）。
    const second = recordingPort();
    const cancelSecond = host.startForegroundReminders(second.port, { labels });
    await flush();
    cancelSecond();
    expect(second.shown).toEqual([]);
  });

  it('投递被系统拒绝时不写回执，下一轮还会再投', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    const taskId = await host.addTask('交周报');
    const triggerAt = Date.now() - 1_000;
    const reminderId = await createReminderActions(host.engine).createReminder(taskId, triggerAt);
    let attempts = 0;
    const refusing: ReminderForegroundPort = {
      authorizationStatus: async () => 'granted',
      show: async () => {
        attempts += 1;
        return false;
      },
    };

    const first = host.startForegroundReminders(refusing, { labels });
    await flush();
    first();
    expect(attempts).toBe(1);
    expect(reminderIsFired(host.engine.getState().reminders[reminderId] as never)).toBe(false);

    const again = host.startForegroundReminders(refusing, { labels });
    await flush();
    again();
    expect(attempts).toBe(2);
  });

  it('close() 会停掉循环的定时器；关掉之后不许再挂', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    const { port } = recordingPort();
    // 一条未来的提醒 ⇒ 循环会真的排一个 setTimeout（不排就证不了"停"）。
    const taskId = await host.addTask('交周报');
    await createReminderActions(host.engine).createReminder(taskId, Date.now() + 60_000);

    vi.useFakeTimers();
    try {
      host.startForegroundReminders(port, { labels });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      host.close();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => host.startForegroundReminders(port, { labels })).toThrow('Host is closed');
    } finally {
      vi.useRealTimers();
      opened.push(host); // 交给 afterEach 收尾（close 幂等）。
    }
  });
});
