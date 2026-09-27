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
  | { method: 'pendingUploadCount' };

/**
 * 执行一个渲染进程请求。
 *
 * 主进程与测试**走同一条路径** —— 所以测试里跑通的东西就是应用里跑的东西。
 * 这是刻意的：如果测试自己另接一套，那测的就不是应用了。
 */
export async function handleDesktopRequest(
  host: NodeHost,
  request: DesktopRequest,
): Promise<unknown> {
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
