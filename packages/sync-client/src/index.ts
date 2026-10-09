/**
 * 同步客户端（**宿主无关**）
 * ========================
 *
 * 🔴 它原本住在 `apps/web/src/features/sync/client.ts`，828 行同步编排逻辑，
 * **零浏览器 API**，只依赖 `@heyta/shared-schema` 与 `@heyta/sync-core`。
 *
 * 也就是说：它是可移植的业务逻辑，却被放在平台壳里。后果是实质的 ——
 * iOS 与鸿蒙要同步就得**重写一遍**上传/下载/冲突判定，而 ADR-0003 §2.1
 * 明确要求「所有业务逻辑必须在 `packages/` 里，`apps/*` 只允许放平台外壳」，
 * §3.3 也写明「各平台各写一份业务逻辑」已被否决：四条同步路径不可能保持一致，
 * 而同步逻辑的不一致 = 数据损坏。
 *
 * 现在它在这里，Web / Node / iOS / 鸿蒙共用同一份，
 * 平台差异通过 {@link SyncClientOptions} 注入（fetch、存储、令牌、口令）。
 */
export * from './client.js';
export * from './realtime.js';
export * from './server-url.js';

export * from './payload-cipher.js';
export * from './share-payload-cipher.js';
export * from './share-api-client.js';
