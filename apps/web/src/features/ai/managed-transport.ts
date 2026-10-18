/**
 * web 壳的托管通道 —— 把**同步会话**接到那唯一一份组装上。
 *
 * 🔴 组装逻辑（空串算不算没配、取令牌失败算不算可用、要不要缓存）**只有一份**，
 * 在 `packages/app-host` 的 `createManagedTransport`。这里**只做一件事**：
 * 告诉它"web 的服务器地址与令牌从 `useSyncStore` 现取"。
 *
 * ⚠️ 两个取值器都是**活取值器**：用户是应用起来之后才填地址/令牌的
 * （与 `sync/store.ts` 文件头那条同源），写死一个模块级快照会让
 * "刚登录完就用 AI"落进 `not-configured`。
 *
 * ⚠️ 每个用到 `deps.routed` 的面板都要传它（本目录 6 处）。**漏传一处**的表现是
 * 那个面板在托管档上不走代理，用户只看到一句"AI 不可用" ——
 * 所以这里导出的是**一个常量**，而不是让各面板自己拼。
 */
import { createManagedTransport } from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

export const webManagedTransport = createManagedTransport({
  getServerUrl: () => useSyncStore.getState().baseUrl,
  getToken: async () => useSyncStore.getState().token,
});
