/**
 * Node 宿主的 Agent 工具传输 —— 把 `@heyta/app-host` 的本地工具传输接到本宿主的真实引擎/数据上。
 *
 * 这是"设备本地 loop + 云端模型 + 本地数据工具"在 **node 壳**上的真实落点：
 * 工具经 `runSelectedTool` 在本机 op-log 物化状态上执行（读真数据；写仅提案）。
 * 模型（`createRoutedModelCall`/`invokeRouted`）与循环（`runCloudAgentTurn`）由调用方注入，
 * 撤销用 `host.engine.currentLocalSeq()` / `undoSince()`。
 */
import {
  createLocalApiHost,
  createLocalToolTransport,
  createTaskActions,
  type CloudToolTransport,
} from '@heyta/app-host';
import type { LocalApiConfig } from '@heyta/local-api';

import type { NodeHost } from './host.js';

/** 用本宿主的引擎/分发构造一个本地工具传输（读真数据；写走确认，见 app-host 说明）。 */
export function createNodeAgentToolTransport(
  host: NodeHost,
  grants: LocalApiConfig['grants'],
): CloudToolTransport {
  const ctx = {
    dispatch: host.dispatch,
    dispatchChecked: host.engine.dispatchChecked.bind(host.engine),
    getState: () => host.engine.getState(),
  };
  const actions = createTaskActions(ctx);
  const apiHost = createLocalApiHost(ctx, actions, { isReadable: () => true });
  return createLocalToolTransport({ host: apiHost, grants, getGrants: () => grants });
}
