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

export { newTaskId, randomId, usingRandomIdFallback } from './ids.js';
