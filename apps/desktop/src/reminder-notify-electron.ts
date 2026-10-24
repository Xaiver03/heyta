/**
 * 前台提醒投递：**Electron 的那一半**
 * ===================================
 *
 * 本文件是全壳唯一 `import { Notification, shell } from 'electron'` 的投递代码。
 * 判据（等哪种证据算投成）在 `reminder-notify.ts`，可测；这里只做 API 形状转换。
 *
 * ⚠️ 与 `main.ts` / `preload.ts` 同等待遇：**不从 `index.ts` 导出** ——
 * 一旦导出，任何 import 本包的纯 Node 代码都会被迫解析 `electron`。
 */

import { Notification, shell } from 'electron';

import type { DeliveryTarget, NotificationSurface } from './reminder-notify.js';
import { waitForDeliveryEvidence } from './reminder-notify.js';

/**
 * 🔴 还没投完的通知要**留在内存里**。
 *
 * Electron 文档在 `Notification.getHistory()` 那段明写：`new Notification()` 造出来的
 * 通知**会随对象被 GC 一起从通知中心消失**。而 `show()` 之后系统的事件是异步回来的，
 * 中间这一段如果只剩一个局部变量，V8 完全可以把它收走 —— 症状是"通知一闪就没、
 * `show` 事件永远等不到"，看起来像权限问题，实际是引用寿命问题。
 */
const pending = new Set<Notification>();

/**
 * 各平台的通知设置页深链。
 *
 * 🔴 只能由**主进程**拼，且**不接受渲染进程传进来的任何参数** ——
 * `shell.openExternal` 喂一个页面可控的 URL 等于让它拉起任意 handler。
 * Linux 没有标准入口 ⇒ `undefined` ⇒ 端口压根不提供 `openSettings()`。
 */
function notificationSettingsUrl(platform: NodeJS.Platform): string | undefined {
  switch (platform) {
    case 'darwin':
      return 'x-apple.systempreferences:com.apple.preference.notifications';
    case 'win32':
      return 'ms-settings:notifications';
    default:
      return undefined;
  }
}

async function openNotificationSettings(platform: NodeJS.Platform): Promise<boolean> {
  const url = notificationSettingsUrl(platform);
  if (url === undefined) return false;
  try {
    await shell.openExternal(url);
    // `openExternal` 成功只代表"系统接下了这个 URL"，**不**保证设置页真的打开了。
    // 这里因此不冒充"已打开"，界面文案也不该这么说。
    return true;
  } catch {
    return false;
  }
}

/**
 * 真·系统通知中心。
 *
 * @param platform 注入而是不直接读 `process.platform`：三端的证据通道不同
 * （见 `waitForDeliveryEvidence`），单测要能逐臂覆盖。
 */
export function createElectronNotificationSurface(
  platform: NodeJS.Platform = process.platform,
): NotificationSurface {
  return {
    isSupported: () => Notification.isSupported(),
    post: (request) => {
      if (!Notification.isSupported()) return Promise.resolve(false);

      let notification: Notification;
      try {
        notification = new Notification({
          // `occurrenceId` 形如 `<reminderId>|<effectiveAt>`；把它当系统侧的稳定 id，
          // 同一条提醒的重复投递在通知中心里会**合并**而不是堆叠（与 Web 端 `tag` 同义）。
          id: request.occurrenceId,
          title: request.title,
          body: request.body,
        });
      } catch {
        return Promise.resolve(false);
      }

      pending.add(notification);
      const target: DeliveryTarget = {
        onShown: (listener) => notification.once('show', listener),
        onFailed: (listener) => notification.once('failed', (_event, error) => listener(String(error))),
        show: () => notification.show(),
      };

      return waitForDeliveryEvidence(target, platform).then(
        (delivered) => {
          pending.delete(notification);
          return delivered;
        },
        (error: unknown) => {
          pending.delete(notification);
          throw error;
        },
      );
    },
    ...(notificationSettingsUrl(platform) !== undefined
      ? { openSettings: (): Promise<boolean> => openNotificationSettings(platform) }
      : {}),
  };
}
