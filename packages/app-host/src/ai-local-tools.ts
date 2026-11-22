/**
 * 本地工具传输 —— 同一套 `CloudToolTransport` 契约，但工具**在设备本地**对 app 自己的
 * 物化数据执行（经 `runSelectedTool`），不走服务器。
 *
 * ## 用途
 *
 * 产品裁决：「Agent 只拥有 talk-calling 能力，但不需要针对任何**本地系统**的东西」——
 * 即 AI 不该拿到 OS 级工具（bash/文件/进程），但它**读/改的是用户自己的工作数据**。
 * 于是：
 *   · 模型 = 云端（`createRoutedModelCall` → `invokeRouted`）；
 *   · 循环 = 设备本地（`runCloudAgentTurn`）；
 *   · 工具 = **本地执行在 app 数据上**（本文件），或云端执行（`createHttpCloudToolTransport`）。
 * 两者实现同一 `CloudToolTransport`，壳按需注入。
 *
 * ## 边界（诚实标注）
 *
 * - **只读工具直接可用**（`runSelectedTool` 返回 `observation`）。
 * - **写工具本次返回 `write-needs-confirm`**：写必须走助手既有的"提案 + 确认 + 自动执行"
 *   （`executeAiToolProposal`，唯一落库点），不在本传输里静默执行。壳要支持写，
 *   应接既有确认流程，而不是放开这里。
 * - 不碰本地文件系统（`runSelectedTool` 只动 app 数据）。
 */
import type { CloudToolInvokeResult, CloudToolTransport } from './ai-cloud-tools.js';
import { executeAiToolProposal, runSelectedTool, type AiToolRunnerDeps, type AiToolRunOutcome } from './ai-tool-run.js';

/** `runSelectedTool` 的结果 → 传输结果（纯映射，单测直接覆盖）。 */
export function toolRunToCloudResult(run: AiToolRunOutcome): CloudToolInvokeResult {
  switch (run.kind) {
    case 'observation':
      return { ok: true, data: run.data };
    case 'executed':
      // 传输层不执行写；但若上游给了已执行结果，如实返回。
      return { ok: true, data: run.result };
    case 'proposal':
      return {
        ok: false,
        reason: 'write-needs-confirm',
        message: `「${run.proposal.tool}」是写操作，需要确认后再执行（走助手的写入确认流程）。`,
      };
    case 'denied':
      return { ok: false, reason: 'denied', message: run.message };
    case 'failed':
      return { ok: false, reason: 'failed', message: run.message };
    case 'ambiguous':
      return { ok: false, reason: 'ambiguous', message: '没匹配到唯一的工具，请说得更具体一点。' };
    case 'none':
      return { ok: false, reason: 'none', message: '没有匹配到可用的工具。' };
  }
}

/**
 * 造一个本地工具传输：每次 `invoke` 经 `runSelectedTool` 在本地数据上执行。
 * 只读可跑；写操作返回 `write-needs-confirm`（见文件头）。
 */
export function createLocalToolTransport(deps: AiToolRunnerDeps): CloudToolTransport {
  return {
    async invoke(name, args) {
      const run = await runSelectedTool(
        { kind: 'tool', ruleId: `cloudagent:${name}`, tool: name, args: args as Record<string, unknown> },
        deps,
      );
      return toolRunToCloudResult(run);
    },
  };
}

/**
 * 可写版本地工具传输 —— Harness 模式支持"AI 直接写 + 靠版本回溯撤销"（产品裁决 D1）。
 *
 * 与 `createLocalToolTransport` 的差别：只读照旧；**写工具不再停在 write-needs-confirm**，
 * 而是经唯一落库点 `executeAiToolProposal` 执行（该方法内部按 risk 判定：
 * `destructive-irreversible` 仍需确认/被拦，其它低危写自动落地）。撤销由壳在运行前
 * 记 `currentLocalSeq`、运行后 `undoSince` 完成。
 *
 * ⚠️ 仅用于**明确开启 Harness 模式**的壳；默认路径仍用 `createLocalToolTransport`（写走提案确认）。
 */
export function createAutoWriteLocalToolTransport(
  deps: AiToolRunnerDeps & { readonly executionIdPrefix?: string },
): CloudToolTransport {
  let counter = 0;
  return {
    async invoke(name, args) {
      const run = await runSelectedTool(
        { kind: 'tool', ruleId: `cloudagent:${name}`, tool: name, args: args as Record<string, unknown> },
        deps,
      );
      if (run.kind === 'observation') return { ok: true, data: run.data };
      if (run.kind === 'proposal') {
        // 写：经唯一落库点执行。授权来自 deps.getGrants ?? deps.grants。
        const grants = deps.getGrants?.() ?? deps.grants;
        const executionId = `${deps.executionIdPrefix ?? 'cloudagent'}:${name}:${String(++counter)}`;
        const write = await executeAiToolProposal(deps.host, run.proposal, executionId, { getGrants: () => grants });
        if (!write.ok) {
          return { ok: false, reason: write.reason ?? 'write-failed', message: 'message' in write ? String(write.message) : '写入失败。' };
        }
        return { ok: true, data: { applied: true } };
      }
      return toolRunToCloudResult(run);
    },
  };
}
