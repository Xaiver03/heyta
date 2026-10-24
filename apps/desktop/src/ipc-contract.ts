/**
 * 渲染进程 ↔ 主进程的契约（唯一入口）
 * ====================================
 *
 * 这个文件是**安全边界**，不只是类型定义。两条约束：
 *
 * 1. **白名单**：渲染进程只能调下面 `DesktopRequest` 列出的方法。
 *    `NodeHost` 上另有 `close()`、`engine`、`dbPath`、`clientId` ——
 *    那些**不暴露**：关库是主进程生命周期的事，路径不该给渲染进程。
 * 2. **无路径参数**：请求里没有任何字段能让渲染进程指定数据库位置
 *    （见 `host.ts` 的 `openDesktopHost`）。
 *
 * 🔴 **为什么这里必须是纯函数、不能直接用 `ipcMain.handle(host.方法名)`**：
 * 那样等于把整个 `NodeHost` 反射给渲染进程，而且**加一个新方法时不会被任何人发现**。
 * 写成显式 switch 之后，"渲染进程能做什么"变成一份**可读、可测、可 diff** 的清单 ——
 * 下面的 `never` 检查还会让新增的 `NodeHost` 方法在**编译期**提醒你做个决定。
 */

import type { NodeHost } from '@heyta/node-host';

import type { DesktopReminderStatus } from './reminder-notify.js';

/** IPC 频道名。带前缀避免与将来其它通道撞车。 */
export const DESKTOP_CHANNELS = { request: 'heyta:host:request' } as const;

/**
 * `addTask` 的第二个参数类型**从共享接口派生**，不自己写一遍。
 *
 * 这样做的理由是本仓库反复踩过的形状：自己抄一遍类型，上游改了字段之后
 * 这里**不会报错**，只会在运行时静默丢掉那个字段（`dueDate` 当初就是这么丢的）。
 * 派生的话，上游一动这里立刻编译失败。
 */
type AddTaskFields = Parameters<NodeHost['addTask']>[1];

/** 渲染进程**被允许**发起的请求。*/
export type DesktopRequest =
  | { method: 'addTask'; title: string; over?: AddTaskFields }
  | { method: 'renameTask'; entityId: string; title: string }
  | { method: 'setCompleted'; entityId: string; completed: boolean }
  | { method: 'listTasks' }
  | { method: 'listProjects' }
  | { method: 'listTags' }
  | { method: 'sync' }
  | { method: 'pendingUploadCount' }
  /**
   * 提醒投递的状态那一行（"到点会不会响"）。
   *
   * 🔴 **没有参数**，而且**永远不许加参数**：这条方法的作用是让界面如实说话，
   * 页面能指定的只有"想知道状态"这件事本身。
   */
  | { method: 'notificationStatus' }
  /**
   * 跳到系统的通知设置。
   *
   * 🔴 同样**没有参数** —— `shell.openExternal` 的参数一旦能从页面来，
   * 白名单就白做了（渲染进程里的任何一段代码都能让桌面应用开一个任意外链）。
   * 落点是系统自己的设置页，由主进程决定，不由请求决定。
   */
  | { method: 'openNotificationSettings' };

/**
 * 主进程把"这台机器的通知中心"那一层递给契约实现的样子。
 *
 * ⚠️ 它是**可选参数**：没有它 = 前台提醒循环还没挂上，
 * 那时这两个方法**必须报错**，不许回一个"看起来像没授权"的默认值 ——
 * 那会让界面显示"你没给通知权限"，而真正的原因（这一端还没接上）永远不会被说出来。
 */
export interface DesktopReminderAccess {
  status(): Promise<DesktopReminderStatus>;
  openSettings(): Promise<boolean>;
}

/**
 * 执行一个渲染进程请求。
 *
 * 主进程与测试**走同一条路径** —— 所以测试里跑通的东西就是应用里跑的东西。
 * 这是刻意的：如果测试自己另接一套，那测的就不是应用了。
 */
export async function handleDesktopRequest(
  host: NodeHost,
  request: DesktopRequest,
  access?: DesktopReminderAccess,
): Promise<unknown> {
  const requireAccess = (method: string): DesktopReminderAccess => {
    if (access === undefined) {
      throw new Error(
        `前台提醒还没在主进程接上（${method}）：这一端没有可查的通知中心状态。` +
          `\n   不是"用户没授权" —— 授权与否由端口回答，这里回答的是"端口不存在"。`,
      );
    }
    return access;
  };
  switch (request.method) {
    case 'addTask':
      return host.addTask(request.title, request.over);
    case 'renameTask':
      return host.renameTask(request.entityId, request.title);
    case 'setCompleted':
      return host.setCompleted(request.entityId, request.completed);
    case 'listTasks':
      return host.listTasks();
    case 'listProjects':
      return host.listProjects();
    case 'listTags':
      return host.listTags();
    case 'sync':
      return host.sync();
    case 'pendingUploadCount':
      return host.pendingUploadCount();
    case 'notificationStatus':
      return requireAccess('notificationStatus').status();
    case 'openNotificationSettings':
      return requireAccess('openNotificationSettings').openSettings();
    default: {
      /**
       * 🔴 这个分支**永远不会执行**，它的作用是让"忘了处理新方法"变成编译错误。
       *
       * 若哪天 `NodeHost` 加了新方法而这里没跟上，`request` 就不再是 `never`，
       * 赋值失败 → 构建报错。这正是我们要的：**契约变更必须被看见**。
       */
      const unhandled: never = request;
      throw new Error(`未处理的桌面请求：${JSON.stringify(unhandled)}`);
    }
  }
}
