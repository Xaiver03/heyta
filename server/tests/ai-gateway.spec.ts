/** AI 网关：env 解析 / 选上游 / 脱敏（纯函数，可转红）。 */
import { describe, expect, it } from 'vitest';

import { gatewayPrimaryConfig, parseGatewayFromEnv, redactUpstreams, selectUpstream, type GatewayUpstream } from '../src/ai/ai-gateway';

const up = (o: Partial<GatewayUpstream>): GatewayUpstream => ({
  id: 'x', label: 'x', baseUrl: 'https://a/v1', apiKey: 'k', modelId: 'm', enabled: true, weight: 1, priority: 0, ...o,
});

describe('parseGatewayFromEnv', () => {
  it('MANAGED_AI_UPSTREAMS JSON 数组解析；非法项进 skipped', () => {
    const r = parseGatewayFromEnv({
      MANAGED_AI_UPSTREAMS: JSON.stringify([
        { id: 'pp', label: 'PP网关', baseUrl: 'https://pp.example/v1', apiKey: 'secret', modelId: 'gpt-x', weight: 2 },
        { id: 'bad', baseUrl: '', modelId: '' },
      ]),
    });
    expect(r.upstreams.map((u) => u.id)).toEqual(['pp']);
    expect(r.upstreams[0]).toMatchObject({ baseUrl: 'https://pp.example/v1', weight: 2, enabled: true });
    expect(r.skipped).toEqual([{ index: 1, reason: '缺少 baseUrl/modelId' }]);
  });

  it('无 MANAGED_AI_UPSTREAMS → 回退单上游 env', () => {
    const r = parseGatewayFromEnv({ MANAGED_AI_UPSTREAM_BASE_URL: 'https://d/v1/', MANAGED_AI_UPSTREAM_API_KEY: 'k', MANAGED_AI_UPSTREAM_MODEL_ID: 'm' });
    expect(r.upstreams).toHaveLength(1);
    expect(r.upstreams[0]!.baseUrl).toBe('https://d/v1'); // 尾斜杠去掉
    expect(r.upstreams[0]!.id).toBe('default');
  });

  it('坏 JSON → 空 + skipped 说明（不静默）', () => {
    const r = parseGatewayFromEnv({ MANAGED_AI_UPSTREAMS: '{bad' });
    expect(r.upstreams).toEqual([]);
    expect(r.skipped[0]!.reason).toContain('JSON');
  });
});

describe('selectUpstream', () => {
  it('跳过 disabled / 空 baseUrl；按 priority 升、weight 降', () => {
    const picked = selectUpstream([
      up({ id: 'off', enabled: false, priority: -1 }),
      up({ id: 'a', priority: 1, weight: 9 }),
      up({ id: 'b', priority: 0, weight: 1 }),
      up({ id: 'c', priority: 0, weight: 5 }),
    ]);
    expect(picked?.id).toBe('c'); // priority0 中 weight 最大
  });

  it('空 apiKey 的上游不可用（防 Bearer 空值出网）', () => {
    expect(selectUpstream([up({ id: 'nokey', apiKey: '' })])).toBeUndefined();
  });

  it('全部不可用 → undefined', () => {
    expect(selectUpstream([up({ enabled: false })])).toBeUndefined();
    expect(selectUpstream([])).toBeUndefined();
  });
});

describe('gatewayPrimaryConfig / redact', () => {
  it('主上游转 ManagedAiConfig', () => {
    const cfg = gatewayPrimaryConfig({ MANAGED_AI_UPSTREAM_BASE_URL: 'https://d/v1', MANAGED_AI_UPSTREAM_API_KEY: 'k', MANAGED_AI_UPSTREAM_MODEL_ID: 'm' });
    expect(cfg).toEqual({ baseUrl: 'https://d/v1', apiKey: 'k', modelId: 'm' });
  });
  it('redact 不回显 apiKey', () => {
    const view = redactUpstreams([up({ id: 'pp', apiKey: 'secret' })]);
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(view[0]!.hasApiKey).toBe(true);
    expect('apiKey' in view[0]!).toBe(false);
  });
});
