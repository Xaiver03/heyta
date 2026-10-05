/**
 * AI 设置页的宿主无关判定（`ai-settings-shared.ts`）
 * =================================================
 *
 * 这两个函数原来住在 `apps/web/src/features/settings/AiSettings.tsx` 里。
 * 2026-10-05 移动端接 AI 时需要同一份 —— 抽出来不是为了整洁，是因为**留在 web 里
 * 就只有两个选择**：第二端抄一遍（两套隐私规则，一定漂移），或者移动端硬编码目的地
 * （那就是 web 原来那个洞：授权记录看起来永远合理，"同意的是 A、放行的是 B"没人能发现）。
 *
 * 🔴 这里钉的是**隐私闸门的裁决**，不是"函数返回什么"：
 *
 *   1. 目的地**由端点地址推导**。一个都不许写死。
 *   2. 候选链上**只要有一个**端点会把明文送出设备，就要为那个目的地征求授权 ——
 *      回退也是出境（ADR-0010）。按"首选端点"判会漏。
 *   3. 换端点 = 换目的地 = **旧授权作废**。这条是本文件存在的理由：
 *      不做它，删掉云端点、再配一个别家的云端点，之前那条授权会重新变得可匹配。
 *   4. `none`（本机回环）**一条授权都不许留**。留着就是将来误放行的种子。
 *
 * ⚠️ web 那边真实通道的行为由 `apps/web/tests/*` 钉（抽取时**一行没改**仍然全绿，
 * 那才是"行为没变"的证据）。这里用纯对象，代表"下一个壳要给的东西"。
 */

import { describe, expect, it } from 'vitest';
import type { AiEndpointConfig, AiFeature, AiRoutingConfig, EgressConsent } from '@heyta/ai';

import { destinationForFeature, recomputeConsents } from '../src/ai-settings-shared.js';

const LOOPBACK: AiEndpointConfig = {
  id: 'ollama',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'llama3',
};

const REMOTE: AiEndpointConfig = {
  id: 'cloud',
  label: '自备云端点',
  endpoint: 'https://api.example.com/v1',
  model: 'gpt-x',
};

function routing(
  endpoints: readonly AiEndpointConfig[],
  routes: Partial<Record<AiFeature, readonly string[]>> = {},
): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: true,
    endpoints,
    routes: Object.fromEntries(
      Object.entries(routes).map(([feature, ids]) => [
        feature,
        ids.map((endpointId) => ({ endpointId })),
      ]),
    ),
  };
}

function consent(feature: AiFeature, destination: EgressConsent['destination']): EgressConsent {
  return { feature, destination, grantedAt: 1_700_000_000_000 };
}

describe('destinationForFeature —— 目的地由端点地址推导，一个都不写死', () => {
  it('回环端点是 none（不需要任何授权）', () => {
    expect(destinationForFeature('breakdown', routing([LOOPBACK], { breakdown: ['ollama'] }))).toBe(
      'none',
    );
  });

  it('非回环端点是 user-endpoint', () => {
    expect(destinationForFeature('breakdown', routing([REMOTE], { breakdown: ['cloud'] }))).toBe(
      'user-endpoint',
    );
  });

  it('🔴 候选链上只要有一个会把明文送出设备，就按那个目的地要授权', () => {
    // 首选是本机、回退是自备云端点。按"首选"判会返回 none ⇒ 一次授权都不要，
    // 而回退真的发生的时候明文就出去了 —— 那是 ADR-0010 明令不许的形状。
    expect(
      destinationForFeature('breakdown', routing([LOOPBACK, REMOTE], { breakdown: ['ollama', 'cloud'] })),
    ).toBe('user-endpoint');
  });

  it('这个功能一条路由都没有时是 none，不是"猜一个远端"', () => {
    expect(destinationForFeature('prioritize', routing([REMOTE]))).toBe('none');
  });

  it('路由指向一个已经不在端点表里的 id 时是 none（不拿旧配置当授权依据）', () => {
    expect(destinationForFeature('capture', routing([LOOPBACK], { capture: ['ghost'] }))).toBe('none');
  });
});

describe('recomputeConsents —— 换端点必须让旧授权作废', () => {
  it('🔴 云端点换成回环端点后，那条 user-endpoint 授权被清掉', () => {
    const before = [consent('breakdown', 'user-endpoint')];
    const after = recomputeConsents(before, routing([LOOPBACK], { breakdown: ['ollama'] }));
    expect(after).toEqual([]);
    // 独立说一句为什么这是**隐私**而不只是整洁：留着的话，下一次有人再配一个
    // 远端端点（目的地重新变成 user-endpoint），这条旧记录会**重新变得可匹配** ——
    // 用户从没同意过这个端点，链路却直接放行。
  });

  it('目的地没变时授权逐条留着（不能把用户的同意当噪声清掉）', () => {
    const before = [consent('breakdown', 'user-endpoint')];
    const after = recomputeConsents(before, routing([REMOTE], { breakdown: ['cloud'] }));
    expect(after).toEqual(before);
  });

  it('🔴 none 的授权一条都不许留', () => {
    const before = [consent('capture', 'none')];
    expect(recomputeConsents(before, routing([LOOPBACK], { capture: ['ollama'] }))).toEqual([]);
  });

  it('按功能各判各的：改了一个功能的路由不会顺手作废另一个功能的授权', () => {
    const before = [consent('breakdown', 'user-endpoint'), consent('capture', 'user-endpoint')];
    const after = recomputeConsents(
      before,
      // breakdown 换到本机；capture 仍走自备云端点。
      routing([LOOPBACK, REMOTE], { breakdown: ['ollama'], capture: ['cloud'] }),
    );
    expect(after).toEqual([consent('capture', 'user-endpoint')]);
  });

  it('授权里出现了一个路由表根本没有的功能时不崩（存储是磁盘上的旧数据）', () => {
    const before = [consent('duration-estimate', 'user-endpoint')];
    expect(recomputeConsents(before, routing([LOOPBACK], {}))).toEqual([]);
  });
});
