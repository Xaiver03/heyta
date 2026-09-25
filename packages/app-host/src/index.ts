/**
 * `@heyta/app-host`
 * ===================
 *
 * 宿主无关的应用接线与写入动作。ADR-0003 §2.1 的**唯一实现处**：
 *
 *   - `openAppHost()`     —— 把平台 SQLite 驱动接到 op-log 引擎与同步客户端
 *   - `createTaskActions()` —— 所有平台共用的 op 构造
 *   - `randomId()` / `newTaskId()` —— 带 RN 安全回退的标识符生成
 *
 * 宿主（`apps/*`）应当**只**提供三样东西：驱动工厂、库路径、同步参数。
 * 任何"这个平台要怎么建任务"的代码出现在 `apps/` 里，都是分层的失败。
 */

export {
  openAppHost,
  resolveClientId,
  materializedState,
  type AppHost,
  type AppHostOptions,
} from './host.js';

export {
  createTaskActions,
  type ActionContext,
  type TaskActions,
  type NewTaskFields,
} from './actions.js';

/**
 * 同步接线。**所有宿主共用这一份** —— 见 `sync-wiring.ts` 文件头：
 * 它此前在 `packages/app-host` 与 `apps/web` 里各有一份，连注释都是复制的。
 *
 * 🔴 `apps/*` 里**不得出现 `new SyncClient(`**。宿主能决定的只有
 * 地址、令牌、口令、网络实现，以及"应用远端后要不要通知 UI"。
 */
export { createSyncClient, type SyncWiringOptions } from './sync-wiring.js';

export { newTaskId, randomId, usingRandomIdFallback } from './ids.js';
