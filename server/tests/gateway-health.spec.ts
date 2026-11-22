import { describe, expect, it, beforeEach } from 'vitest';
import { __resetGatewayHealthForTests, isUpstreamAvailable, recordUpstreamResult, upstreamHealthSnapshot } from '../src/ai/gateway-health';

beforeEach(() => __resetGatewayHealthForTests());

describe('网关上游健康', () => {
  it('连续失败达阈值 → 冷却期不可用；成功复位', () => {
    const t = 1000;
    recordUpstreamResult('pp', false, t);
    recordUpstreamResult('pp', false, t);
    expect(isUpstreamAvailable('pp', t)).toBe(true);
    recordUpstreamResult('pp', false, t);
    expect(isUpstreamAvailable('pp', t)).toBe(false); // 3 连败，冷却内
    expect(isUpstreamAvailable('pp', t + 31_000)).toBe(true); // 过冷却
    recordUpstreamResult('pp', true, t + 32_000);
    expect(upstreamHealthSnapshot('pp').consecutiveFails).toBe(0);
    expect(upstreamHealthSnapshot('pp').totalOk).toBe(1);
  });
});
