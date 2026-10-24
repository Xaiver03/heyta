/**
 * 原生壳那条通知腿（`shell-reminder-center.ts`）
 * =============================================
 *
 * ## 这一组钉的是什么
 *
 * macOS 的 WKWebView、Linux 的 WebKitGTK 与 Windows 的 WebView2 **都没有可用的
 * Web Notifications API**（页面里的 `new Notification()` 要么不存在、要么弹的不是
 * 系统通知中心那一条）。
 * 在那三枚壳里，页侧那份投递逻辑一路都是对的，只在最后一步
 * "弹出去"上撞到 `reason:'unsupported'` ⇒ **桌面应用里的提醒永远不响**。
 * 补法是问壳要一次系统通知中心的投递。这里测的就是那一次往返的形状。
 *
 * 🔴 每一条都指向一个**只有真机才会暴露**的失效，所以全部用注入的假通道跑：
 *
 *   1. **回不来必须算"没投出去"**。返回 `true` 的话页侧就写 `firedAt` 回执，
 *      而那条提醒其实没响过 —— 那是"假装交付"，比不响更糟。
 *   2. **只认字面 `true`**。桥接层（WKScriptMessageHandlerWithReply / WebView2 Reply /
 *      `evaluateJavaScript`）把值转一手之后很容易变成 `undefined`、`"true"` 或 `1`。
 *      把它们当成功 = 上面那条失效的另一种触发路径。
 *   3. **认不出的授权词表落成 `unsupported` 而不是 `denied`**。
 *      界面据此说话：`denied` 是"你拒了"，`unsupported` 是"这台机器读不到"。
 *   4. **同一条提醒不许弹两遍**。壳那一支是异步的，`await` 期间 store 的下一条
 *      变化会再把同一份 `due` 交进来。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHELL_REMINDER_ACK_GLOBAL,
  SHELL_REMINDER_HANDLER_NAME,
  askShell,
  detectShellReminderChannel,
  resolveReminderCenter,
  shellNotificationCenter,
  type ShellReminderRequest,
} from '../src/features/reminders/shell-reminder-center.js';
import { deliverDueReminders, type ReminderNotificationCenter } from '../src/features/reminders/notify.js';
import type { Reminder, Task } from '@heyta/domain';

function task(id: string, title: string): Task {
  return { id, title, createdAt: 0, updatedAt: 0 } as Task;
}

function reminder(id: string, taskId: string): Reminder {
  return { id, taskId, triggerAt: 1000, createdAt: 0, updatedAt: 0 } as Reminder;
}

const LABELS = { title: 'heyta', body: (t: string) => `该做「${t}」了` };

/** 一条假通道：记请求，回法由调用方决定。 */
function fakeChannel(reply?: (request: ShellReminderRequest) => unknown) {
  const requests: ShellReminderRequest[] = [];
  return {
    requests,
    channel: {
      postMessage(message: ShellReminderRequest): unknown {
        requests.push(message);
        return reply?.(message);
      },
    },
  };
}

/** 一个只装着 `webkit.messageHandlers` 的全局替身（真壳由 WKWebView 注入那三层）。 */
const globalWith = (handlers: Record<string, unknown> | undefined): Record<string, unknown> =>
  ({ webkit: handlers === undefined ? undefined : { messageHandlers: handlers } }) as Record<string, unknown>;

/** WebView2 那根管道的全局替身：只有 `chrome.webview.postMessage`，且返回 void。 */
function globalWithWebview2(postMessage?: (message: unknown) => void): Record<string, unknown> {
  return { chrome: postMessage === undefined ? {} : { webview: { postMessage } } } as Record<string, unknown>;
}

describe('WebView2（Windows 壳）那根共用管道也算桥', () => {
  it('普通 Chrome 没有 chrome.webview ⇒ 不误认成壳（继续走浏览器那条腿）', () => {
    expect(detectShellReminderChannel({ chrome: {} })).toBeNull();
  });

  it('chrome.webview.postMessage 在 ⇒ 认出通道，并原样交出那条消息', () => {
    const sent: unknown[] = [];
    const channel = detectShellReminderChannel(globalWithWebview2((message) => sent.push(message)));
    expect(channel).not.toBeNull();
    channel?.postMessage({ requestId: '1', method: 'permission', args: [] });
    expect(sent).toHaveLength(1);
    // 🔴 分流依据必须带上：这根管道**整页共用**（op-log 消息也走它），壳靠 `handler`
    // 认得出这一条归提醒腿。少了它，壳要么把它转给 `handleHostMessage`（协议层报错），
    // 要么整条消息被丢弃（症状是"提醒永远等不到回执"）。
    expect(sent[0]).toEqual({
      requestId: '1',
      method: 'permission',
      args: [],
      handler: 'heytaReminder',
    });
    // ⚠️ 返回值必须是 undefined：伪造一个 Promise 会让 askShell 走回法①，
    // 而 WebView2 的回复其实落在 `__heytaReminderAck` 上 ⇒ 那一问永远等不到答案。
  });

  it('两族管道同时在场时按 WebKit 那一族（per-name 处理器能回 Promise）', () => {
    const global = {
      ...globalWithWebview2(() => undefined),
      ...globalWith({ heytaReminder: { postMessage: () => Promise.resolve('granted') } }),
    } as Record<string, unknown>;
    const channel = detectShellReminderChannel(global);
    expect(channel?.postMessage({ requestId: '1', method: 'permission', args: [] })).toBeInstanceOf(Promise);
  });

  it('🔴 WebView2 那一支的回复落在 ack 上：壳执行 `window.__heytaReminderAck` ⇒ 页侧拿到结果', async () => {
    let sent: ShellReminderRequest | undefined;
    const global = {
      chrome: {
        webview: {
          postMessage: (message: unknown) => {
            sent = message as ShellReminderRequest;
          },
        },
      },
    } as unknown as Record<string, unknown>;

    const center = resolveReminderCenter(global);
    const pending = center.show({ id: 'a|1', title: 'heyta', body: '该做「写周报」了' });

    // 壳那一侧现在才能回话：它拿到的就是这条消息里自带的 requestId。
    expect(sent?.method).toBe('show');
    const ack = global[SHELL_REMINDER_ACK_GLOBAL] as (requestId: string, ok: unknown) => void;
    expect(typeof ack).toBe('function');
    ack(sent!.requestId, true);

    await expect(pending).resolves.toBe(true);
  });
});

describe('桥在不在，只看壳真的注入了什么', () => {
  it('没有 webkit.messageHandlers ⇒ null（浏览器/PWA 继续走 Notification 那条腿）', () => {
    expect(detectShellReminderChannel({})).toBeNull();
    expect(detectShellReminderChannel(globalWith(undefined))).toBeNull();
  });

  it('有名字但 postMessage 不是函数 ⇒ 仍然 null', () => {
    expect(detectShellReminderChannel(globalWith({ heytaReminder: { postMessage: 'nope' } }))).toBeNull();
  });

  it('🔴 桥在 ⇒ 装配层选壳那条腿，而不是浏览器那条（用户在桌面应用里要收到系统通知中心那一条）', () => {
    const { channel } = fakeChannel();
    const center = resolveReminderCenter(
      globalWith({ heytaReminder: channel }) as Record<string, unknown> & { Notification?: unknown },
    );
    expect(center.kind).toBe('shell');
  });

  it('桥不在 ⇒ 选浏览器那条腿；两边都没有时也不许抛（投递是增强）', () => {
    expect(resolveReminderCenter({}).kind).toBe('web');
  });
});

describe('两种回法都要能拿到结果', () => {
  it('回法①：postMessage 直接回 Promise（macOS WithReply / WebView2 Reply）', async () => {
    const { channel, requests } = fakeChannel((request) =>
      Promise.resolve(request.method === 'permission' ? 'granted' : true),
    );
    const center = shellNotificationCenter(channel);
    await expect(center.permission()).resolves.toBe('granted');
    await expect(center.show({ id: 'r1:t1', title: 'heyta', body: 'x' })).resolves.toBe(true);
    expect(requests.map((r) => r.method)).toEqual(['permission', 'show']);
    expect(requests[1]!.args).toEqual(['r1:t1', 'heyta', 'x']);
  });

  it('回法②：单向消息 + `__heytaReminderAck(requestId, ok)`（Linux WebKitGTK）', async () => {
    const global: Record<string, unknown> = {
      setTimeout: (fn: () => void) => fn,
    };
    const { channel } = fakeChannel(() => undefined);
    const pending = askShell(channel, { requestId: 'req-7', method: 'permission', args: [] }, { global });
    (global[SHELL_REMINDER_ACK_GLOBAL] as (id: string, ok: unknown) => void)('req-7', 'granted');
    await expect(pending).resolves.toBe('granted');
  });

  it('🔴 ack 的 requestId 对不上 ⇒ 不许把别人的结果算成自己的', async () => {
    const global: Record<string, unknown> = {};
    const { channel } = fakeChannel(() => undefined);
    const center = shellNotificationCenter(channel, { global });
    const pending = Promise.resolve(center.show({ id: 'r', title: 't', body: 'b' }));
    // 桥把别的请求的 ack 送进来（真机上完全可能：两条提醒同时在飞）。
    (global[SHELL_REMINDER_ACK_GLOBAL] as (id: string, ok: unknown) => void)('someone-else', true);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('🔴 永远不 ack ⇒ 按"没投出去"算，而且不抛（回执因此不会被写）', async () => {
    const timers: (() => void)[] = [];
    const global: Record<string, unknown> = {
      setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
      clearTimeout: () => {},
    };
    const { channel } = fakeChannel(() => undefined);
    const center = shellNotificationCenter(channel, { global, timeoutMs: 5 });
    const pending = Promise.resolve(center.show({ id: 'r1:t1', title: 'heyta', body: 'x' }));
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    timers.forEach((run) => run());
    await expect(pending).resolves.toBe(false);
  });

  it('ack 用完必须把全局上那枚处理器摘掉（否则下一个请求的 ack 会被这一支吃掉）', async () => {
    const global: Record<string, unknown> = { setTimeout: () => 1 };
    const { channel, requests } = fakeChannel(() => undefined);
    const center = shellNotificationCenter(channel, { global });
    const first = center.show({ id: 'a', title: 't', body: 'b' });
    const requestId = requests[0]!.requestId;
    (global[SHELL_REMINDER_ACK_GLOBAL] as (id: string, ok: unknown) => void)(requestId, true);
    await expect(first).resolves.toBe(true);
    expect(global[SHELL_REMINDER_ACK_GLOBAL]).toBeUndefined();
  });

  it('桥把值转成 `undefined`/字符串/数字时，统统算"没投出去"（只认字面 true）', async () => {
    for (const value of [undefined, null, 'true', 1, {}]) {
      const { channel } = fakeChannel(() => Promise.resolve(value));
      await expect(shellNotificationCenter(channel).show({ id: 'r', title: 't', body: 'b' })).resolves.toBe(false);
    }
  });

  it('🔴 认不出的授权词表 ⇒ `unsupported`（"读不到"不许说成"你拒了"）', async () => {
    const { channel } = fakeChannel(() => Promise.resolve('weird-value'));
    await expect(shellNotificationCenter(channel).permission()).resolves.toBe('unsupported');
  });

  it('索要授权那条腿：四词原样交回，认不出算 `error`', async () => {
    const granted = fakeChannel(() => Promise.resolve('denied'));
    await expect(shellNotificationCenter(granted.channel).request?.()).resolves.toBe('denied');
    const junk = fakeChannel(() => Promise.resolve(undefined));
    await expect(shellNotificationCenter(junk.channel).request?.()).resolves.toBe('error');
  });

  it('每一次请求都带**唯一** requestId（两个请求同时飞着时不许互相顶掉回执）', async () => {
    const { channel, requests } = fakeChannel(() => Promise.resolve(true));
    const center = shellNotificationCenter(channel);
    await Promise.all([
      center.show({ id: 'a', title: 't', body: 'b' }),
      center.show({ id: 'b', title: 't', body: 'b' }),
    ]);
    expect(new Set(requests.map((r) => r.requestId)).size).toBe(requests.length);
  });
});

describe('壳这条腿接进 `deliverDueReminders`：回执只记真投出去的', () => {
  const due = [reminder('r1:t1', 't1')];
  const tasks = { t1: task('t1', '交周报') };

  it('壳回 true ⇒ 记账、写回执候选', async () => {
    const shown = new Set<string>();
    const { channel, requests } = fakeChannel((request) =>
      Promise.resolve(request.method === 'permission' ? 'granted' : true),
    );
    const outcome = await deliverDueReminders(due, tasks, shown, LABELS, shellNotificationCenter(channel));
    expect(outcome).toEqual({ delivered: 1, deliveredIds: ['r1:t1'] });
    expect(shown.has('r1:t1')).toBe(true);
    expect(requests.filter((r) => r.method === 'show')).toHaveLength(1);
  });

  it('🔴 壳回 false ⇒ 一条都不算投出、**认领要释放**（否则这条提醒被永久消音）', async () => {
    const shown = new Set<string>();
    const { channel } = fakeChannel((request) =>
      Promise.resolve(request.method === 'permission' ? 'granted' : false),
    );
    const outcome = await deliverDueReminders(due, tasks, shown, LABELS, shellNotificationCenter(channel));
    expect(outcome.deliveredIds).toEqual([]);
    expect(outcome.reason).toBe('permission');
    expect(shown.size).toBe(0);
  });

  it('🔴 壳读不到授权时不许偷偷去弹（`permission` 之后一条 `show` 都不发）', async () => {
    const { channel, requests } = fakeChannel(() => Promise.resolve('denied'));
    const outcome = await deliverDueReminders(due, tasks, new Set(), LABELS, shellNotificationCenter(channel));
    expect(outcome.reason).toBe('permission');
    expect(requests.map((r) => r.method)).toEqual(['permission']);
  });

  it('壳抛错时按没投出去办，而不是把整个投递打断', async () => {
    const { channel } = fakeChannel((request) =>
      request.method === 'permission' ? Promise.resolve('granted') : Promise.reject(new Error('桥断了')),
    );
    const outcome = await deliverDueReminders(due, tasks, new Set(), LABELS, shellNotificationCenter(channel));
    expect(outcome.deliveredIds).toEqual([]);
  });

  it('🔴 await 期间同一条提醒被再次交进来 ⇒ 只弹一遍（先认领，不是投完才记）', async () => {
    let release!: (ok: boolean) => void;
    const gate = new Promise<boolean>((resolve) => { release = resolve; });
    const { channel, requests } = fakeChannel((request) =>
      request.method === 'permission' ? Promise.resolve('granted') : gate,
    );
    const center = shellNotificationCenter(channel);
    const shown = new Set<string>();
    const first = deliverDueReminders(due, tasks, shown, LABELS, center);
    const second = deliverDueReminders(due, tasks, shown, LABELS, center);
    release(true);
    const [a, b] = await Promise.all([first, second]);
    expect(requests.filter((r) => r.method === 'show')).toHaveLength(1);
    expect([a.delivered, b.delivered].reduce((x, y) => x + y, 0)).toBe(1);
  });
});

describe('浏览器那条腿的形状没被这次改造弄坏', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('中心对象由构造器包出来：构造成功=true，抛错=false（**这一支仍是同步的**）', async () => {
    const ctor = function (this: unknown, _title: string, options?: { tag?: string }): unknown {
      if (options?.tag === 'boom') throw new TypeError('nope');
      return {};
    } as unknown as Parameters<typeof import('../src/features/reminders/notify.js').browserNotificationCenter>[0];
    const { browserNotificationCenter } = await import('../src/features/reminders/notify.js');
    const center = browserNotificationCenter(ctor);
    // ⚠️ 不是 `.resolves`：浏览器那条腿**本来就是同步返回**的，
    // 把它改成 Promise 会让"没有 await 的旧调用点"在类型上看不出来地晚一帧。
    expect(center.show({ id: 'ok', title: 't', body: 'b' })).toBe(true);
    expect(center.show({ id: 'boom', title: 't', body: 'b' })).toBe(false);
    expect(center.permission()).toBe('unsupported');
  });

  it('两个后端在 `deliverDueReminders` 里走的是同一份选择逻辑（墓碑任务两边都不投）', async () => {
    const purged = { 't-p': { ...task('t-p', '已删'), deletedAt: 5 } };
    const center: ReminderNotificationCenter = {
      kind: 'shell',
      permission: () => 'granted',
      show: () => true,
    };
    const outcome = await deliverDueReminders([reminder('r-p', 't-p')], purged, new Set(), LABELS, center);
    expect(outcome.deliveredIds).toEqual([]);
  });
});

/* ── 三壳的名字对账（跨语言，只能读源文件）──────────────────────────────
 *
 * 🔴 这一组钉的是**漂**，不是逻辑。页侧与壳之间只有三个字符串是承重的：
 *   处理器名、ack 全局名、四个方法名。任何一处打错字，症状都是
 *   "桌面应用里提醒永远不响，而界面上一个字都不报" —— 因为没有类型跨 C#/C/Swift。
 * 与 `apps/mobile/tests/reminder-delivery-settings.spec.ts` 里那组源钉同一口径。
 */
describe('三壳的契约名字必须与页侧逐字相同', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (relative: string) => readFileSync(resolve(here, relative), 'utf8');
  const macos = read('../../desktop-macos/Sources/HeytaMac/HeytaMacApp.swift');
  const windows = read('../../desktop-windows/HeytaWindows/MainWindow.xaml.cs');
  const linux = read('../../desktop-linux/src/heyta_web.c');

  it('macOS：以 .page world 注册了页侧要找的那个名字', () => {
    // ⚠️ 世界（contentWorld）也是契约的一部分：注册进 defaultClient 的话
    // 页面自己的 `window.webkit.messageHandlers` 里**没有**这一枚 ⇒ 探测恒 null。
    const registration = new RegExp(
      `addScriptMessageHandler\\([\\s\\S]{0,120}contentWorld: \\.page,[\\s\\S]{0,40}name: "${SHELL_REMINDER_HANDLER_NAME}"`,
    );
    expect(registration.test(macos)).toBe(true);
  });

  it('Windows：共用管道靠 handler 标记分流，且标记名与页侧一致', () => {
    expect(windows).toContain(`ReminderHandlerName = "${SHELL_REMINDER_HANDLER_NAME}"`);
    expect(windows).toContain(`${SHELL_REMINDER_ACK_GLOBAL}`);
    // 🔴 分流必须发生在 op-log 转发**之前**：反了的话这条消息会被喂给 `handleHostMessage`，
    // 而它根本不认这个形状（症状：存储交握报错 + 提醒永远等不到回执）。
    const reminderAt = windows.indexOf('TryHandleReminderMessage(args.Source');
    const hostAt = windows.indexOf('HandleHostMessage(args.WebMessageAsJson)');
    expect(reminderAt).toBeGreaterThan(-1);
    expect(hostAt).toBeGreaterThan(-1);
    expect(reminderAt).toBeLessThan(hostAt);
  });

  it('Linux：注册了同一枚处理器，并把它接到回执上', () => {
    const defined = linux.match(/#define REMINDER_HANDLER_NAME "([^"]+)"/);
    expect(defined?.[1]).toBe(SHELL_REMINDER_HANDLER_NAME);
    expect(linux).toContain('script-message-received::" REMINDER_HANDLER_NAME');
    expect(linux).toContain(SHELL_REMINDER_ACK_GLOBAL.slice(2)); // __heytaReminderAck
    // 单向管道 ⇒ 没有 ack 就等于这一问永远不落地；处理器必须**每条路径**都回执。
    expect(linux.match(/ack_reminder\(view, request_id/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('四端都装了投递端口，且没有一个地方把"没弹出去"写成 true', () => {
    // `show` 的返回值方向是这条契约的命门：三壳各自只能从"真投出去"那一个分支回 true。
    for (const source of [macos, windows, linux]) {
      expect(source).toMatch(/REMINDER_PAGE|ShellReminderBridge|TryHandleReminderMessage|on_reminder_message/);
    }
    expect(linux).toContain('delivered ? "true" : "false"');
    expect(windows).toContain('REMINDER_PAGE_SHOW=delivered=');
  });
});
