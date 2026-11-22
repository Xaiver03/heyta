/**
 * `requestCloudAssistantTurn` —— 把三块拼成**一个生产函数**：
 *   `runCloudAgentTurn`（设备本地循环） + `createRoutedModelCall`（云端模型，经 invokeRouted）
 *   + `CloudToolTransport`（云端工具）。
 *
 * 壳（桌面/手机/平板/Web）只需要：给 routing/consents/transport/grants，调这个函数。
 * 这就是"设备本地 loop + 云端模型 + 云端工具"的整机形态（引擎为原生循环；
 * 桌面若要换成 PI 内核，用 `toCloudAgentTools` + PI Agent 即可，契约不变）。
 */
import type {
  AiRoutingConfig,
  AiRoutingPolicy,
  EgressConsent,
  RoutedDeps,
} from '@heyta/ai';
import type { LocalApiConfig } from '@heyta/local-api';

import { toCloudToolDescriptors, type CloudToolTransport } from './ai-cloud-tools.js';
import { createRoutedModelCall, type RoutedInvoke } from './ai-routed-model.js';
import { runCloudAgentTurn, type CloudAgentTurnResult, type HarnessEvent } from './agent-harness.js';
import { createReportAwareTransport, REPORT_TOOL_DESCRIPTORS, type ReportState } from './ai-report-tools.js';

/** 默认系统提示（云端工具场景；壳可覆盖）。 */
export const CLOUD_ASSISTANT_SYSTEM_PROMPT = [
  '你是 heyta 任务管理器里的助手，用户可以让你读和改他自己的工作数据。',
  '需要了解情况就多次调用只读工具；能一次说清就一次说清。',
  '不要编造工具名，不要把没有对应工具的事说成能做到。',
  '如果产品里有、但你没有对应工具，就明确说明并告诉用户在应用里怎么做。',
].join('\n');

export interface CloudAssistantTurnDeps {
  readonly routing: AiRoutingConfig;
  readonly consents: readonly EgressConsent[];
  readonly policy?: AiRoutingPolicy;
  readonly routed?: RoutedDeps;
  readonly transport: CloudToolTransport;
  readonly grants: LocalApiConfig['grants'];
  readonly systemPrompt?: string;
  readonly maxSteps?: number;
  readonly runId?: string;
  readonly onEvent?: (event: HarnessEvent) => void;
  /** 文本流式回调（逐片）。 */
  readonly onTextDelta?: (text: string) => void;
  /**
   * 提供本机物化状态 → 自动挂上「周报/年终总结」两个 Harness 工具（零 C 端入口）。
   * 省略 = 不挂（默认行为不变）。
   */
  readonly getReportState?: () => ReportState;
  /** 注入以便离线测试；默认真实 invokeRouted。 */
  readonly invoke?: RoutedInvoke;
}

export async function requestCloudAssistantTurn(
  userText: string,
  deps: CloudAssistantTurnDeps,
): Promise<CloudAgentTurnResult> {
  const callModel = createRoutedModelCall({
    routing: deps.routing,
    consents: deps.consents,
    ...(deps.policy === undefined ? {} : { policy: deps.policy }),
    ...(deps.routed === undefined ? {} : { deps: deps.routed }),
    ...(deps.invoke === undefined ? {} : { invoke: deps.invoke }),
    ...(deps.onTextDelta === undefined ? {} : { onTextDelta: deps.onTextDelta }),
  });
  const baseTools = toCloudToolDescriptors(deps.grants);
  const useReports = deps.getReportState !== undefined;
  return runCloudAgentTurn(userText, {
    transport: useReports ? createReportAwareTransport(deps.transport, deps.getReportState!) : deps.transport,
    tools: useReports ? [...baseTools, ...REPORT_TOOL_DESCRIPTORS] : baseTools,
    systemPrompt: deps.systemPrompt ?? CLOUD_ASSISTANT_SYSTEM_PROMPT,
    callModel,
    ...(deps.maxSteps === undefined ? {} : { maxSteps: deps.maxSteps }),
    ...(deps.runId === undefined ? {} : { runId: deps.runId }),
    ...(deps.onEvent === undefined ? {} : { onEvent: deps.onEvent }),
  });
}
