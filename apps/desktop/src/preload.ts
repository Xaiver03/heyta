/**
 * Electron preload
 * =================
 *
 * 🔴 **Electron >= 29 起，`ipcRenderer` 不能经 `contextBridge` 直接暴露。**
 * 官方文档明确要求：必须在 preload 里包一层函数再暴露，
 * 否则渲染进程拿到的是被 contextBridge 拒绝的对象（四个方法全不可用）。
 *
 * 所以这里**不暴露 `ipcRenderer` 本身** —— 只暴露一个 `request` 函数，
 * 它只肯转发 `DesktopRequest` 这个白名单里的形状。
 * 渲染进程因此拿不到"发任意频道"的能力。
 *
 * ⚠️ 本文件会被 tsup **打包进产物**（相对 import 会被 inline），
 * 因为 sandbox 的 preload 只能 `require('electron')`，不能 require 工作区里的包。
 */

import { contextBridge, ipcRenderer } from 'electron';

import { DESKTOP_CHANNELS, type DesktopCommand, type DesktopRequest } from './ipc-contract.js';

/** 暴露给渲染进程的全局对象名。渲染进程只该通过 `window.heytaDesktop` 取数据。 */
export const DESKTOP_BRIDGE_KEY = 'heytaDesktop';

export interface DesktopBridge {
  request(request: DesktopRequest): Promise<unknown>;
  /**
   * 订阅主进程推来的命令（托盘菜单、全局热键的结果都从这里出来）。
   *
   * 🔴 这里**不暴露 `ipcRenderer` 本身**，也不让渲染进程挑频道：
   * 频道名由 preload 固定成 `DESKTOP_CHANNELS.command` 那一个，
   * 页面能收到的只有 `DesktopCommand` 这两种形状。
   * ⚠️ 返回的是 `void` 而不是退订函数 —— `contextBridge` 不能把主世界的函数
   * 当返回值递回来，而这两条命令都是幂等的"重新读一次"，不需要退订。
   */
  onCommand(handler: (command: DesktopCommand) => void): void;
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, {
  request: (request: DesktopRequest): Promise<unknown> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.request, request) as Promise<unknown>,
  onCommand: (handler: (command: DesktopCommand) => void): void => {
    ipcRenderer.on(DESKTOP_CHANNELS.command, (_event, command: DesktopCommand) => handler(command));
  },
} satisfies DesktopBridge);
