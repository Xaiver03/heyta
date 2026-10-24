/**
 * 前台提醒投递：桌面壳的**平台端口**（Electron 无关的那一半）
 * ==========================================================
 *
 * 分工只有一句：**"该不该投、投过没有"不归本文件**。
 * 那套判据在 `packages/app-host/src/reminder-foreground.ts`（到期判定、去重、
 * `firedAt` 回执全在那里，全仓 `firedAt` 只有它一个写入点）。本文件写的
 * 是它下面那一层 —— `ReminderForegroundPort`：**这台机器的通知中心怎么弹、
 * 让不让弹**。AGENTS.md §3.5 的判据（"有没有任何一行在决定业务上该怎么做"）
 * 在这里的落点是：本文件不许出现"哪条提醒算到点""要不要重试"这类判断。
 *
 * 为什么拆成两个文件（本文件 + `reminder-notify-electron.ts`）：
 * 本壳的单测跑在**纯 Node**（`vitest.config.ts` 刻意不用 jsdom，也不起 Electron），
 * 而 `import { Notification } from 'electron'` 在纯 Node 里根本解析不出来
 * （那个包在非 Electron 进程里导出的只是二进制路径）。所以**真正带判断的那一段**
 * （等系统证据的策略）放在这里、对着一个最小接口写，可以被测到；
 * Electron 的 API 形状收在另一个文件里，与 `main.ts` / `preload.ts` 同等待遇
 * ——`index.ts` 不导出它，见那份文件的注释。
 */

import type {
  ForegroundDeliveryResult,
  ForegroundReminderLabels,
  ReminderAuthorization,
  ReminderForegroundPort,
} from '@heyta/node-host';

/**
 * 一条通知在系统里走完投递所需的最小接口（由 `reminder-notify-electron.ts` 提供）。
 *
 * ⚠️ 故意**不是** Electron 的 `Notification` 类型：那样本文件就得 import electron，
 * 纯 Node 的单测就起不来。这里只要求实现方把三个动作递过来，
 * 于是"系统给了什么证据"这条策略能在测试里被逐臂验证。
 */
export interface DeliveryTarget {
  /** 注册"系统确认已展示"的回调（Electron 的 `show` 事件）。 */
  onShown(listener: () => void): void;
  /** 注册"系统拒绝投递"的回调（Electron 的 `failed` 事件，带原因）。 */
  onFailed(listener: (reason: string) => void): void;
  /** 真的交给系统。**只许调用一次。** */
  show(): void;
}

/**
 * 会回投递证据的平台集合。
 *
 * 🔴 依据是实测核对 `node_modules/electron/electron.d.ts`（electron 44.4.5）：
 * `Notification` 的 `failed` 事件带着 `@platform darwin,win32` —— Linux 上
 * **既没有拒绝回调，也没有确认回调**。所以 Linux 只能退化成"抛异常=拒绝"。
 */
const PLATFORMS_WITH_EVIDENCE = new Set(['darwin', 'win32']);

/** 拿不到系统证据时最多等多久。超时就按"没投出去"处理，见下面的返回值说明。 */
export const DELIVERY_EVIDENCE_TIMEOUT_MS = 2_000;

/**
 * 把一条通知交给系统，并**如实回答"系统到底投出去了没有"**。
 *
 * 返回值直接决定 `firedAt` 回执写不写，所以这一格的语义是承重的：
 * - `true`  = 拿到了系统"已展示"的证据（`show` 事件），或该平台根本没有证据通道且没抛。
 * - `false` = 系统明说失败（`failed`），或抛了，或 darwin/win32 上
 *   在 {@link DELIVERY_EVIDENCE_TIMEOUT_MS} 内**两种证据都没等到**。
 *
 * 🔴 为什么"没等到证据"在 darwin/win32 上要判 false 而不是 true：
 * seam 的第一条纪律是**投递成功才记账**（`reminder-foreground.ts` 文件头）。
 * 判成 true 的后果是给用户写了一条**假回执** —— 通知一条没弹，提醒却被标成
 * 已投并同步到每一台设备，从此再也不会响，也没有任何东西能把它捞回来。
 * 判成 false 的代价只是"同一轮里再试一次"，小得多。
 *
 * ⚠️ 反过来，Linux 上没有证据通道，若照同一策略判 false 就等于
 * **"每次都弹了但永远不记账"** ⇒ 每次启动把历史到点的提醒重弹一遍。
 * 那一档因此只把异常当拒绝，并把这一条如实写在这里。
 *
 * 本机实测（electron 44.4.5 / macOS arm64，`pnpm --filter @heyta/desktop smoke -- --notify`）：
 * - `node_modules` 里那份未 seal 的开发 `Electron.app`：`show()` 后 6ms 回
 *   `failed: 未能完成操作。（UNErrorDomain错误1。）` ⇒ 本函数返回 `false`
 *   ⇒ seam 不写 `firedAt`。（Electron 42 起 macOS 改用 `UNNotification`，
 *   官方发布说明写明未签名的 bundle 会以 `failed` 收场。）
 * - 同一份 bundle 复制出来 `codesign --force --deep -s -` 重签后：6ms 回 `show`，
 *   且 `Notification.getHistory()` 读得到本轮那条标题 ⇒ 返回 `true`。
 */
export function waitForDeliveryEvidence(
  target: DeliveryTarget,
  platform: string,
  timeoutMs: number = DELIVERY_EVIDENCE_TIMEOUT_MS,
): Promise<boolean> {
  if (!PLATFORMS_WITH_EVIDENCE.has(platform)) {
    try {
      target.show();
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };

    timer = setTimeout(() => finish(false), timeoutMs);
    target.onShown(() => finish(true));
    target.onFailed(() => finish(false));
    try {
      target.show();
    } catch {
      finish(false);
    }
  });
}

/**
 * 操作系统通知中心的能力面 —— 本壳唯一碰 `Notification` / `shell` 的地方
 * （实现在 `reminder-notify-electron.ts`）。
 */
export interface NotificationSurface {
  /** 这台机器有没有可用的通知中心（Electron `Notification.isSupported()`）。 */
  isSupported(): boolean;
  /** 交给系统弹一条；返回"系统确认投出去了"。 */
  post(request: {
    readonly occurrenceId: string;
    readonly title: string;
    readonly body: string;
  }): Promise<boolean>;
  /**
   * 跳到系统的通知设置页。
   * 🔴 Linux 没有标准入口 ⇒ 这个字段是 `undefined`，端口据此**不给** `openSettings()`，
   * 界面就不会画一个点了没反应的按钮。
   */
  openSettings?(): Promise<boolean>;
}

/**
 * 把能力面包装成 seam 要的端口。
 *
 * 两个契约要钉住：
 * 1. **`show()` 永不抛** —— 端口抛出去会打断整轮投递（其余几条提醒就都不投了），
 *    而"这一条弹失败"本来只是一个可以被 `false` 表达的普通事实。
 * 2. **授权查不到时不许谎报成"被拒绝"** —— 见下面那段。
 *
 * ⚠️ 本端口**故意不提供** seam 上那个可选的 `requestAuthorization()`：
 * Electron 主进程没有 `UNUserNotificationCenter requestAuthorizationWithOptions`
 * 的等价 API（核对过 electron.d.ts，见下面 `authorizationStatus` 那段），
 * 所以那条"只在 `default` 时升级成系统询问"的路在本壳永远不会触发。
 * 这也是 `authorizationStatus()` **不回 `'default'`** 的另一条理由：
 * 回了 `'default'` 而升级又不存在，seam 每一轮都会以 `reason: 'permission'` 收工
 * ⇒ 一条都不投，用户那边就是"提醒永远不响"。
 */
export function createReminderForegroundPort(surface: NotificationSurface): ReminderForegroundPort {
  const port: ReminderForegroundPort = {
    /**
     * 🔴 这里返回的 `'granted'` **不是**"系统已经授权"，而是
     * **"这一层查不到授权状态，让系统在 `post()` 上裁决"**。
     *
     * 为什么查不到（实测核对 electron 44.4.5 的 `electron.d.ts`）：
     * - `Notification` 只有 `isSupported()` 与 macOS 独有的 `getHistory()`
     *   （文档明写它要求代码签名，未签名的开发构建返回空数组）；
     * - `systemPreferences` 里**没有**任何通知授权查询接口
     *   （既没有 `getAuthNotificationStatus`，也没有 `getNotificationSettings`；
     *   本文件的判据只承认查得到 `AuthorizationStatus` 的 API，
     *   没查到就不编一个出来）；
     * - 主进程也没有 Web 端那个 `Notification.permission` 属性可读。
     *
     * 于是真实授权状态在这个壳上拿不到，只剩两种可判的事实：
     * `isSupported()` 为假 ⇒ `'unsupported'`（这台机器根本没有通知中心，
     * 例如 Linux 上没有 libnotify / 没有会话级 dbus）；其余一律 `'granted'`，
     * 真判据由 `post()` 给：投不出去就返回 `false`，seam 因此**不会**写假回执。
     *
     * ⚠️ 代价如实写出：用户真的把通知关了，这一层不会**提前**知道，
     * 而是表现为每轮投递 `reason: 'failed'` —— 界面那句"到点不会响"读的就是它
     * （见 {@link readReminderStatus}）。
     * 反过来若这里回 `'denied'`/`'default'`，seam 会**一条都不投**，
     * 等于把"查不到"当成"被拒绝"来惩罚用户，也直接违背这一轮的产品决定。
     */
    authorizationStatus: async (): Promise<ReminderAuthorization> =>
      surface.isSupported() ? 'granted' : 'unsupported',

    show: async (request) => {
      try {
        return await surface.post(request);
      } catch {
        // 系统层抛了（构造失败、通知中心进程不在了…）—— 按"没投出去"表达，
        // 不写回执、不打断其余几条，也不把异常递给循环。
        return false;
      }
    },
  };

  if (surface.openSettings !== undefined) {
    const open = surface.openSettings;
    // 与 `show()` 同一条纪律：**永不抛**。这一格直通渲染进程的那个按钮，
    // 抛出去会变成一次 IPC rejection（界面只能显示一串错误文本），
    // 而"跳不过去"本来只是一个可以用 `false` 表达的普通事实。
    port.openSettings = async () => {
      try {
        return await open.call(surface);
      } catch {
        return false;
      }
    };
  }

  return port;
}

/** 最近一轮投递的实况 —— **只记录观察到的事**，不含任何"该不该响"的判断。 */
export interface DesktopReminderDelivery {
  readonly delivered: number;
  readonly reason?: ForegroundDeliveryResult['reason'];
}

/**
 * `notificationStatus` 的线形状。
 *
 * ⚠️ `authorization: 'granted'` 在这一档**不等于**"通知是开着的"，
 * 见 {@link createReminderForegroundPort}。界面要判"到点会不会响"，
 * 读的是 `supported` 与 `lastDelivery.reason`，不是 `authorization`。
 */
export interface DesktopReminderStatus {
  /** 这台机器有没有可用的通知中心。 */
  readonly supported: boolean;
  readonly authorization: ReminderAuthorization;
  /** 能不能从这个壳直接跳到系统设置（Linux 没有标准入口 ⇒ false）。 */
  readonly canOpenSettings: boolean;
  /** 最近一轮投递的实况；`null` = 这个进程还没跑过一轮。 */
  readonly lastDelivery: DesktopReminderDelivery | null;
}

/**
 * 主进程-side 的投递账本。
 *
 * 🔴 为什么要它：seam 每一轮的结论只从 `onDelivery` 出来，而渲染进程
 * 拿不到主进程的回调 —— 中间必须有人把"最近一次实况"存下来。
 * 这里存的**只是回执**（几条、为什么没投），不解释、不重试、不排队。
 */
export function createDeliveryLedger(): {
  note(result: ForegroundDeliveryResult): void;
  snapshot(): DesktopReminderDelivery | null;
} {
  let last: DesktopReminderDelivery | null = null;
  return {
    note: (result) => {
      last = { delivered: result.delivered.length, ...(result.reason !== undefined ? { reason: result.reason } : {}) };
    },
    snapshot: () => last,
  };
}

/** 组合端口 + 账本，得到界面上那一行状态。异步是因为授权判定在端口上。 */
export async function readReminderStatus(
  port: ReminderForegroundPort,
  ledger: ReturnType<typeof createDeliveryLedger>,
): Promise<DesktopReminderStatus> {
  const authorization = await port.authorizationStatus();
  return {
    supported: authorization !== 'unsupported',
    authorization,
    canOpenSettings: port.openSettings !== undefined,
    lastDelivery: ledger.snapshot(),
  };
}

/**
 * 投递文案 —— seam 要求**宿主注入**（那一层不引 i18n，理由写在它的文件头）。
 *
 * 🔴 这一份**不是本壳自己编的**：它就是 `packages/app-host/src/native-bridge.ts`
 * 递给另外三个桌面壳（macOS / Windows / Linux）的那一份（`reminderLabels`），
 * 逐字相同 —— 标题是产品名、正文是**任务标题本身**。
 * 于是"同一条提醒在四端弹出来是同一句话"这件事**由构造保证**，而不是靠四份抄本彼此对齐。
 *
 * ⚠️ 这里**没有** import `@heyta/i18n`：本壳的主进程 import 白名单
 * （`tests/reuse.spec.ts`）只放 `electron` / `node:` / `@heyta/node-host` 三条，
 * 而 `@heyta/i18n` 的根入口会连带 `react.js` —— 那等于往主进程产物里拖进第二份 React
 * （`tsup.config.ts` 把 `@heyta/*` 全打进 `main.cjs`）。
 *
 * ⚠️ **已登记的债**：想让正文变成"到期：{标题}"那种**带句式**的文案，
 * 需要的是一条 `desktop.reminder.notify.body` 词条 + 一个"壳解析当前语言"的通道，
 * **两者现在都不存在**，本轮**不**在壳里私造句子（那正是"文案的第二事实源"）。
 * 这条债写进交付说明，不在投递路径上打洞。
 */
export const REMINDER_NOTIFICATION_LABELS: ForegroundReminderLabels = {
  title: 'heyta',
  body: (taskTitle: string) => taskTitle,
};
