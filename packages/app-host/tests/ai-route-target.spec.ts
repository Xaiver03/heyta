/**
 * 路由解析 → 界面视图（`resolveAiRoute` / `pickNoCandidateReason`）—— 判据面
 * ==============================================================
 *
 * 这两个函数此前**没有直接单测**。它们承重的地方（见源文件头）：
 *
 *   1. **取第一个候选是承重的**：`invokeRouted` 的尝试顺序就是 `resolveRoute` 的候选顺序。
 *      界面若另挑一个端点显示，就会出现"披露说 A、实际发到 B（另一家公司）"。
 *      `resolveAiRoute.target` 必须是候选链的**第 0 个**，`fallbacks` 是其后的标签 ——
 *      这样"用户同意了 A、数据也可能发到 B"才被如实披露。
 *   2. **只报一个排除原因、且优先级是产品决策**：`remote-not-allowed` 必须最先报，
 *      因为那道闸关着时其余原因在本机根本无从判断，报别的会让用户白改一轮配置。
 *      优先级顺序住在这里，不在壳里 —— 所以必须在**这里**钉住。
 *
 * 正例用**真实的 `resolveRoute`** 驱动（不 mock 被测单元）：`prioritize` 只需基线能力，
 * 回环端点、`allowRemote:false` 即可得到一个 `destination:'none'` 的候选。
 */
import { describe, expect, it } from 'vitest';

import type { AiEndpointConfig, AiRoutingConfig, RouteResolution } from '@heyta/ai';

import { pickNoCandidateReason, resolveAiRoute } from '../src/ai-route-target.js';

/** 一个回环端点（默认能力 = 基线 structured_output，够 `prioritize` 用）。 */
function loopback(id: string, label: string): AiEndpointConfig {
  return { id, label, endpoint: 'http://127.0.0.1:11434/v1', model: `${id}-model`, capabilities: ['structured_output'] };
}

function routing(partial: Partial<AiRoutingConfig> & Pick<AiRoutingConfig, 'endpoints'>): AiRoutingConfig {
  return { mode: 'own', enabled: true, allowRemote: false, routes: {}, ...partial };
}

/** 构造一个只关心 `unconfigured` / `excluded[].reason` 的 RouteResolution。 */
function resolution(partial: { unconfigured?: boolean; reasons?: RouteResolution['excluded'][number]['reason'][] }): RouteResolution {
  return {
    candidates: [],
    excluded: (partial.reasons ?? []).map((reason) => ({ target: { endpointId: 'x' }, reason })),
    unconfigured: partial.unconfigured ?? false,
  } as unknown as RouteResolution;
}

describe('pickNoCandidateReason —— 只报一个、且按产品优先级', () => {
  it('unconfigured 优先于任何排除原因', () => {
    expect(pickNoCandidateReason(resolution({ unconfigured: true, reasons: ['endpoint-missing'] }))).toBe('unconfigured');
  });

  it('🔴 remote-not-allowed 排在所有原因之前（把它挪下去 = 用户去改一条根本没被检查的配置）', () => {
    expect(pickNoCandidateReason(resolution({ reasons: ['capability-missing', 'remote-not-allowed'] }))).toBe(
      'remote-not-allowed',
    );
  });

  it('🔴 其余优先级：capability-missing > endpoint-disabled > endpoint-url-rejected > circuit-open > endpoint-missing', () => {
    expect(pickNoCandidateReason(resolution({ reasons: ['endpoint-missing', 'capability-missing'] }))).toBe(
      'capability-missing',
    );
    expect(pickNoCandidateReason(resolution({ reasons: ['circuit-open', 'endpoint-disabled'] }))).toBe('endpoint-disabled');
    expect(pickNoCandidateReason(resolution({ reasons: ['circuit-open', 'endpoint-url-rejected'] }))).toBe(
      'endpoint-url-rejected',
    );
    expect(pickNoCandidateReason(resolution({ reasons: ['endpoint-missing', 'circuit-open'] }))).toBe('circuit-open');
    expect(pickNoCandidateReason(resolution({ reasons: ['endpoint-missing'] }))).toBe('endpoint-missing');
  });

  it('既没配也没有排除记录 ⇒ unknown（宁可承认判断不了，也不编一个原因）', () => {
    expect(pickNoCandidateReason(resolution({}))).toBe('unknown');
  });
});

describe('resolveAiRoute —— 取候选链第 0 个，其余进 fallbacks', () => {
  it('没有配置路由 ⇒ target 无、原因是 unconfigured', () => {
    const out = resolveAiRoute(routing({ endpoints: [loopback('e1', '本地')] }), 'prioritize');
    expect(out.target).toBeUndefined();
    expect(out.noCandidate).toBe('unconfigured');
    expect(out.resolution.unconfigured).toBe(true);
  });

  it('唯一候选：target 指向它、isLocal=true、destination=none、无回退', () => {
    const out = resolveAiRoute(
      routing({ endpoints: [loopback('e1', '本地')], routes: { prioritize: [{ endpointId: 'e1' }] } }),
      'prioritize',
    );
    expect(out.noCandidate).toBeUndefined();
    expect(out.target).toEqual({
      endpointId: 'e1',
      label: '本地',
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'e1-model',
      isLocal: true,
      destination: 'none',
      fallbacks: [],
    });
  });

  it('🔴 两个候选：target 是第 0 个，第二个进 fallbacks（披露 A 也要披露可能发到 B）', () => {
    const out = resolveAiRoute(
      routing({
        endpoints: [loopback('e1', '本地A'), loopback('e2', '本地B')],
        routes: { prioritize: [{ endpointId: 'e1' }, { endpointId: 'e2' }] },
      }),
      'prioritize',
    );
    expect(out.target?.endpointId).toBe('e1');
    expect(out.target?.fallbacks).toEqual(['本地B']);
  });

  it('🔴 远端端点 + allowRemote:false ⇒ 不成为候选，原因为 remote-not-allowed', () => {
    const remote: AiEndpointConfig = {
      id: 'r1',
      label: '远端',
      endpoint: 'https://api.example.com/v1',
      model: 'm',
      capabilities: ['structured_output'],
    };
    const out = resolveAiRoute(routing({ endpoints: [remote], routes: { prioritize: [{ endpointId: 'r1' }] } }), 'prioritize');
    expect(out.target).toBeUndefined();
    expect(out.noCandidate).toBe('remote-not-allowed');
  });

  it('候选指向不存在的端点 ⇒ endpoint-missing', () => {
    const out = resolveAiRoute(
      routing({ endpoints: [loopback('e1', '本地')], routes: { prioritize: [{ endpointId: 'nope' }] } }),
      'prioritize',
    );
    expect(out.target).toBeUndefined();
    expect(out.noCandidate).toBe('endpoint-missing');
  });
});
