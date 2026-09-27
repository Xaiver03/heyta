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

import { DESKTOP_CHANNELS, type DesktopRequest } from './ipc-contract.js';

/** 暴露给渲染进程的全局对象名。渲染进程只该通过 `window.heytaDesktop` 取数据。 */
export const DESKTOP_BRIDGE_KEY = 'heytaDesktop';

export interface DesktopBridge {
  request(request: DesktopRequest): Promise<unknown>;
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, {
  request: (request: DesktopRequest): Promise<unknown> =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.request, request) as Promise<unknown>,
} satisfies DesktopBridge);
