/**
 * AI 配置路由测试
 * ==================
 *
 * 这个文件里最要紧的**不是**"能不能调到模型"，而是三条不许被改坏的规矩：
 *
 *   1. 🔴🔴 **回退不得跨越隐私边界。** 本机端点挂了，不许悄悄改用云端。
 *      这是本设计与通用 AI 网关（CC Switch / LiteLLM / one-api）的**根本区别**。
 *      断言方式是**数网络请求**，不是看返回值 —— 一个"报告说没发、其实发了"的
 *      实现，只看返回值是抓不到的。
 *   2. 🔴 **不想用云的人不该被反复问"要不要授权云"。** `allowRemote: false`
 *      时远端端点**不进入候选**，不产生授权询问。
 *   3. 🔴 **"没声明能力"必须等于"保守"，而不是"什么都能"。**
 *      SSOS 的教训：按 provider 名猜能力（`VISION_PROVIDERS`）会随改名静默失效。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AI_ENDPOINT_PRESETS,
  DEFAULT_ROUTING_POLICY,
  EMPTY_HEALTH,
  classifyDestination,
  countsAsEndpointFailure,
  endpointCapabilities,
  findPreset,
  invokeRouted,
  isAvailable,
  recordOutcome,
  presetDestinations,
  requiredCapabilities,
  resolveRoute,
  shouldTryNextEndpoint,
  validateEndpointUrl,
  type AiEndpointConfig,
  type AiFailure,
  type AiFailureReason,
  type AiRoutingConfig,
  type EgressConsent,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────
// 测试台架
// ─────────────────────────────────────────────────────────────────────────

/** 本机端点：目的地 `none`，不需要任何授权。 */
const LOCAL: AiEndpointConfig = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
};

/** 远端端点：目的地 `user-endpoint`，需要授权。 */
const REMOTE: AiEndpointConfig = {
  id: 'remote',
  label: '云端中转',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  keyRef: 'remote-key',
};

/** 远端但**声明了视觉能力**（用于能力过滤测试）。 */
const REMOTE_VISION: AiEndpointConfig = {
  ...REMOTE,
  id: 'remote-vision',
  label: '云端视觉',
  capabilities: ['structured_output', 'vision', 'long_context'],
};

/** 成功响应。 */
const okResponse = (text = 'ok') =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: text } }] }),
  });

/** 失败响应。 */
const errResponse = (status: number) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });

/** 计数 fetch —— **本文件最重要的测试工具**。 */
interface FetchCall {
  url: string;
  body: unknown;
}

function countingFetch(
  handler: (url: string) => Promise<unknown>,
): { impl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body });
    return handler(String(url));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const INVOCATION = {
  feature: 'capture' as const,
  system: 's',
  user: 'u',
  fields: ['title'],
};

function config(overrides: Partial<AiRoutingConfig> = {}): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: false,
    endpoints: [LOCAL, REMOTE],
    routes: { capture: [{ endpointId: 'local' }] },
    ...overrides,
  };
}

const REMOTE_CONSENT: EgressConsent = {
  feature: 'capture',
  destination: 'user-endpoint',
  grantedAt: 1_000,
};

// ─────────────────────────────────────────────────────────────────────────

describe('validateEndpointUrl —— 按目的地分岔的规则', () => {
  it('https 一律允许', () => {
    expect(validateEndpointUrl('https://api.example.com/v1').ok).toBe(true);
    expect(validateEndpointUrl('https://openai-proxy.miracleplus.com/v1').ok).toBe(true);
  });

  it('🔴 回环端点的明文 http **必须允许**（Ollama 就是 http）', () => {
    // SSOS 拒绝 localhost（它是服务端产品，那条规则防 SSRF）。
    // heyta 是本地优先 —— 照抄会把最主要的使用场景拒掉。
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234/v1',
      'http://[::1]:8080/v1',
    ]) {
      const v = validateEndpointUrl(url);
      expect(v.ok, url).toBe(true);
      if (v.ok) expect(v.destination, url).toBe('none');
    }
  });

  it('🔴 远端端点的明文 http **必须拒绝**（否则与 E2EE 承诺自相矛盾）', () => {
    const v = validateEndpointUrl('http://api.example.com/v1');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('plaintext-remote');
      expect(v.message).toContain('https');
    }
  });

  it('局域网主机名也算远端 —— 明文 http 同样拒绝', () => {
    const v = validateEndpointUrl('http://my-nas.lan:11434/v1');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('plaintext-remote');
  });

  it('🔴 URL 里带凭据必须拒绝（否则密钥会进配置、日志、以及一切打印 URL 的地方）', () => {
    const v = validateEndpointUrl('https://user:secret@api.example.com/v1');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('credentials-in-url');
  });

  it('非 http(s) 与解析不了的都拒绝', () => {
    for (const url of ['ftp://x/v1', 'file:///etc/passwd', 'not a url', '']) {
      expect(validateEndpointUrl(url).ok, url).toBe(false);
    }
  });
});

describe('能力声明 —— 不做推断，未声明 = 保守', () => {
  it('未声明能力时只有基线（structured_output）', () => {
    const caps = endpointCapabilities(LOCAL);
    expect(caps).toEqual(['structured_output']);
    expect(caps).not.toContain('vision');
    expect(caps).not.toContain('long_context');
  });

  it('显式声明的能力被如实采纳', () => {
    expect(endpointCapabilities(REMOTE_VISION)).toContain('vision');
  });

  it('各功能需要的能力是明确写出来的', () => {
    expect(requiredCapabilities('capture')).toEqual(['structured_output']);
    // 拆解天然需要长上下文（要读整条任务的备注）
    expect(requiredCapabilities('breakdown')).toContain('long_context');
  });

  it('🔴 没声明 long_context 的端点做不了拆解（保守失败，而不是试了才知道）', () => {
    const r = resolveRoute(
      config({
        allowRemote: true,
        endpoints: [LOCAL, REMOTE],
        routes: { breakdown: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      'breakdown',
      { now: 0 },
    );
    // 两个端点都没声明 long_context → 全部被能力过滤掉
    expect(r.candidates).toHaveLength(0);
    expect(r.excluded.every((e) => e.reason === 'capability-missing')).toBe(true);
  });
});

describe('resolveRoute —— 候选解析', () => {
  it('顺序即回退顺序', () => {
    const r = resolveRoute(
      config({
        allowRemote: true,
        routes: { capture: [{ endpointId: 'remote' }, { endpointId: 'local' }] },
      }),
      'capture',
      { now: 0 },
    );
    expect(r.candidates.map((c) => c.endpointConfig.id)).toEqual(['remote', 'local']);
  });

  it('🔴 allowRemote=false 时远端端点**不进入候选**（而不是"进去了再拒"）', () => {
    const r = resolveRoute(
      config({
        allowRemote: false,
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      'capture',
      { now: 0 },
    );
    expect(r.candidates.map((c) => c.endpointConfig.id)).toEqual(['local']);
    expect(r.excluded).toEqual([
      { target: { endpointId: 'remote' }, reason: 'remote-not-allowed' },
    ]);
  });

  it('路由目标可以覆盖端点的默认模型', () => {
    const r = resolveRoute(
      config({
        routes: { capture: [{ endpointId: 'local', model: 'qwen3:32b' }] },
      }),
      'capture',
      { now: 0 },
    );
    expect(r.candidates[0]?.model).toBe('qwen3:32b');
  });

  it('端点不存在 / 被禁用 → 各自的原因', () => {
    const r = resolveRoute(
      config({
        endpoints: [LOCAL, { ...REMOTE, disabled: true }],
        routes: { capture: [{ endpointId: 'nope' }, { endpointId: 'remote' }] },
      }),
      'capture',
      { now: 0 },
    );
    expect(r.candidates).toHaveLength(0);
    expect(r.excluded.map((e) => e.reason)).toEqual(['endpoint-missing', 'endpoint-disabled']);
  });

  it('没配路由的功能报告 unconfigured（不是"回退到默认模型"）', () => {
    const r = resolveRoute(config(), 'prioritize', { now: 0 });
    expect(r.unconfigured).toBe(true);
    expect(r.candidates).toHaveLength(0);
  });

  it('跳闸中的端点在冷却期内被排除，冷却后恢复', () => {
    const health = { local: { endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: 5_000 } };
    expect(resolveRoute(config(), 'capture', { health, now: 4_000 }).candidates).toHaveLength(0);
    expect(resolveRoute(config(), 'capture', { health, now: 5_000 }).candidates).toHaveLength(1);
  });

  it('🔴 非法 URL 的端点在解析阶段就被排除', () => {
    const r = resolveRoute(
      config({
        allowRemote: true,
        endpoints: [{ id: 'bad', label: '明文远端', endpoint: 'http://api.example.com/v1', model: 'm' }],
        routes: { capture: [{ endpointId: 'bad' }] },
      }),
      'capture',
      { now: 0 },
    );
    expect(r.candidates).toHaveLength(0);
    expect(r.excluded[0]?.reason).toBe('endpoint-url-rejected');
  });
});

describe('熔断 —— 只有端点的锅才算', () => {
  it('连续失败到阈值就跳闸，一次成功立刻清零', () => {
    const policy = DEFAULT_ROUTING_POLICY;
    let health = EMPTY_HEALTH;
    health = recordOutcome(health, 'local', { ok: false, reason: 'network' }, policy, 100);
    health = recordOutcome(health, 'local', { ok: false, reason: 'network' }, policy, 200);
    expect(isAvailable(health['local'] ?? undefined, 300)).toBe(true); // 还没到 3 次
    health = recordOutcome(health, 'local', { ok: false, reason: 'network' }, policy, 300);
    expect(isAvailable(health['local'] ?? undefined, 400)).toBe(false); // 跳闸了

    health = recordOutcome(health, 'local', { ok: true }, policy, 400);
    expect(isAvailable(health['local'] ?? undefined, 500)).toBe(true);
    expect(health['local']?.consecutiveFailures).toBe(0);
  });

  it('🔴 授权问题**不能**记到端点头上（否则好好的端点会被跳闸）', () => {
    let health = EMPTY_HEALTH;
    for (let i = 0; i < 10; i += 1) {
      health = recordOutcome(health, 'local', { ok: false, reason: 'egress-not-authorized' }, DEFAULT_ROUTING_POLICY, i * 100);
    }
    expect(health['local']).toBeUndefined();
    expect(isAvailable(undefined, 1_000)).toBe(true);
  });

  it('🔴 回退被隐私拦住，也不算端点的锅（端点本身是好的）', () => {
    let health = EMPTY_HEALTH;
    health = recordOutcome(health, 'remote', { ok: false, reason: 'fallback-needs-consent' }, DEFAULT_ROUTING_POLICY, 0);
    expect(health['remote']).toBeUndefined();
  });

  it('计数表逐项钉死（改了这张表就要改测试）', () => {
    expect(countsAsEndpointFailure('network')).toBe(true);
    expect(countsAsEndpointFailure('http-error')).toBe(true);
    expect(countsAsEndpointFailure('empty-response')).toBe(true);
    expect(countsAsEndpointFailure('egress-not-authorized')).toBe(false);
    expect(countsAsEndpointFailure('fallback-needs-consent')).toBe(false);
    expect(countsAsEndpointFailure('not-configured')).toBe(false);
    expect(countsAsEndpointFailure('no-route')).toBe(false);
  });
});

describe('shouldTryNextEndpoint —— "换个端点有可能成功吗"', () => {
  const fail = (
    reason: AiFailureReason,
    status?: number,
  ): AiFailure => ({
    ok: false,
    reason,
    message: '',
    ...(status === undefined ? {} : { status }),
  });

  it('网络类错误换下一个', () => {
    expect(shouldTryNextEndpoint(fail('network'))).toBe(true);
    expect(shouldTryNextEndpoint(fail('empty-response'))).toBe(true);
  });

  it('401 / 402 / 404 / 429 / 5xx 都换（可能是这个端点特有的）', () => {
    for (const s of [401, 402, 403, 404, 429, 500, 503]) {
      expect(shouldTryNextEndpoint(fail('http-error', s)), String(s)).toBe(true);
    }
  });

  it('🔴 400 / 422 不换 —— 是我们发的请求错了，换谁都会错', () => {
    expect(shouldTryNextEndpoint(fail('http-error', 400))).toBe(false);
    expect(shouldTryNextEndpoint(fail('http-error', 422))).toBe(false);
  });

  it('🔴 没授权 / 回退被隐私拦住 —— **绝不能**"换下一个"', () => {
    // 换下一个端点不是重试，是换一个目的地偷发。
    expect(shouldTryNextEndpoint(fail('egress-not-authorized'))).toBe(false);
    expect(shouldTryNextEndpoint(fail('fallback-needs-consent'))).toBe(false);
  });
});

describe('invokeRouted —— 闸门与短路', () => {
  it('总开关关掉时明确失败，且不发请求', async () => {
    const { impl, calls } = countingFetch(() => okResponse());
    const out = await invokeRouted(config({ enabled: false }), INVOCATION, [], DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
    });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.reason).toBe('not-configured');
    expect(calls).toHaveLength(0);
  });

  it('没配路由时是 no-route（与"AI 整体没开"区分开）', async () => {
    const { impl, calls } = countingFetch(() => okResponse());
    const out = await invokeRouted(config(), { ...INVOCATION, feature: 'prioritize' }, [], DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
    });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.reason).toBe('no-route');
    expect(calls).toHaveLength(0);
  });

  it('🔴 全部是远端而 allowRemote=false → no-route，且**不发请求**', async () => {
    const { impl, calls } = countingFetch(() => okResponse());
    const out = await invokeRouted(
      config({ allowRemote: false, routes: { capture: [{ endpointId: 'remote' }] } }),
      INVOCATION,
      [],
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.reason).toBe('no-route');
      // 要解释清楚"这不是故障"，否则用户会以为坏了
      expect(out.result.message).toContain('允许远程');
    }
    expect(calls).toHaveLength(0);
  });

  it('首选端点需要授权时 → egress-not-authorized，带披露，且不发请求', async () => {
    const { impl, calls } = countingFetch(() => okResponse());
    const out = await invokeRouted(
      config({ allowRemote: true, routes: { capture: [{ endpointId: 'remote' }] } }),
      INVOCATION,
      [],
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.reason).toBe('egress-not-authorized');
      expect(out.result.message).toContain('title');
    }
    expect(calls).toHaveLength(0);
  });

  it('本机端点不需要授权，直接成功', async () => {
    const { impl, calls } = countingFetch(() => okResponse('结果'));
    const out = await invokeRouted(config(), INVOCATION, [], DEFAULT_ROUTING_POLICY, { fetchImpl: impl });
    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      expect(out.result.suggestion.text).toBe('结果');
      expect(out.result.suggestion.destination).toBe('none');
    }
    expect(calls).toHaveLength(1);
  });
});

describe('🔴🔴 invokeRouted —— 回退不得跨越隐私边界（本文件的核心）', () => {
  it('🔴 本机失败 → 云端备用未授权 → **一次请求都不发**，并报 fallback-needs-consent', async () => {
    // 场景：用户配了 [本机 Ollama, 云端] 作为候选链，只同意过"本机"。
    // 本机挂了。通用网关会直接改用云端 —— 那正是在用户没同意的情况下把数据送出去。
    const { impl, calls } = countingFetch((url) => {
      if (url.includes('localhost')) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      return okResponse('云端的结果');
    });

    const out = await invokeRouted(
      config({
        allowRemote: true,
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      INVOCATION,
      [], // ← 没有任何授权
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );

    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.reason).toBe('fallback-needs-consent');
      // 必须说清"停在哪里"和"为什么"
      expect(out.result.message).toContain('设备之外');
    }

    // 🔴 最关键的断言：**只有本机那次请求**，云端一次都没碰
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('localhost');
    expect(calls.some((c) => c.url.includes('api.example.com'))).toBe(false);

    // 而且那次尝试被记了账（本机确实失败了），云端没被记
    expect(out.attempts.map((a) => a.endpointId)).toEqual(['local']);
  });

  it('🔴 有云端授权时，同样的场景才允许真的回退', async () => {
    const { impl, calls } = countingFetch((url) => {
      if (url.includes('localhost')) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      return okResponse('云端的结果');
    });

    const out = await invokeRouted(
      config({
        allowRemote: true,
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      INVOCATION,
      [REMOTE_CONSENT], // ← 用户授权了
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );

    expect(out.result.ok).toBe(true);
    if (out.result.ok) {
      expect(out.result.suggestion.text).toBe('云端的结果');
      // 目的地必须如实标注为远端 —— UI 才能告诉用户"这条来自云端"
      expect(out.result.suggestion.destination).toBe('user-endpoint');
    }
    expect(calls).toHaveLength(2);
    expect(out.attempts.map((a) => a.endpointId)).toEqual(['local', 'remote']);
  });

  it('同一边界内回退不需要新授权（本机 → 本机）', async () => {
    const local2 = { ...LOCAL, id: 'local2', label: '本机 LM Studio', endpoint: 'http://127.0.0.1:1234/v1' };
    const { impl, calls } = countingFetch((url) => {
      if (url.includes('11434')) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      return okResponse('第二个本机端点');
    });

    const out = await invokeRouted(
      config({
        endpoints: [LOCAL, local2],
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'local2' }] },
      }),
      INVOCATION,
      [], // 本机端点本来就不需要授权
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );

    expect(out.result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(out.attempts.map((a) => a.endpointId)).toEqual(['local', 'local2']);
  });

  it('🔴 首选是本机、但**唯一**的备用是"不允许远程"时 → 直接 no-route，不进入授权流程', async () => {
    // 不想用云的人不该被反复问"要不要授权云"。
    const { impl, calls } = countingFetch(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );
    const out = await invokeRouted(
      config({
        allowRemote: false,
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      INVOCATION,
      [],
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );
    // 本机真的试了并且失败了
    expect(calls).toHaveLength(1);
    // 结果是本机那条失败，**不是** fallback-needs-consent
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.reason).toBe('http-error');
    }
    expect(out.resolution.excluded.map((e) => e.reason)).toEqual(['remote-not-allowed']);
  });
});

describe('invokeRouted —— 重试分级与熔断持久化', () => {
  it('400 不会换下一个端点（同一个错误不该重放）', async () => {
    const { impl, calls } = countingFetch(() => errResponse(400));
    const out = await invokeRouted(
      config({
        allowRemote: true,
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      INVOCATION,
      [REMOTE_CONSENT],
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );
    expect(calls).toHaveLength(1);
    expect(out.result.ok).toBe(false);
  });

  it('401 会换下一个端点（这个端点的凭据错了，别的可能是对的）', async () => {
    const { impl, calls } = countingFetch((url) =>
      url.includes('localhost') ? errResponse(401) : okResponse('云端救回来了'),
    );
    const out = await invokeRouted(
      config({
        allowRemote: true,
        routes: { capture: [{ endpointId: 'local' }, { endpointId: 'remote' }] },
      }),
      INVOCATION,
      [REMOTE_CONSENT],
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl },
    );
    expect(calls).toHaveLength(2);
    expect(out.result.ok).toBe(true);
  });

  it('maxAttempts 限制跨端点的总尝试数', async () => {
    const { impl, calls } = countingFetch(() => errResponse(500));
    await invokeRouted(
      config({
        allowRemote: true,
        routes: {
          capture: [{ endpointId: 'local' }, { endpointId: 'remote' }, { endpointId: 'local' }],
        },
      }),
      INVOCATION,
      [REMOTE_CONSENT],
      { ...DEFAULT_ROUTING_POLICY, maxAttempts: 1 },
      { fetchImpl: impl },
    );
    expect(calls).toHaveLength(1);
  });

  it('🔴 熔断状态可以喂回来（冷却跨会话才有意义，否则重启就忘了）', async () => {
    const { impl, calls } = countingFetch(() => errResponse(500));
    const seeded = {
      local: { endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: 10_000 },
    };
    const out = await invokeRouted(config(), INVOCATION, [], DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      now: () => 5_000, // 还在冷却期内
      healthSeed: seeded,
    });
    expect(calls).toHaveLength(0);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.message).toContain('熔断');
  });

  it('成功会把 health 里的失败计数清零（返回值可直接持久化）', async () => {
    const { impl } = countingFetch(() => okResponse());
    const out = await invokeRouted(config(), INVOCATION, [], DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      healthSeed: { local: { endpointId: 'local', consecutiveFailures: 2 } },
      now: () => 1_000,
    });
    expect(out.health['local']?.consecutiveFailures).toBe(0);
    expect(out.health['local']?.lastSuccessAt).toBe(1_000);
  });

  it('密钥从 SecretStore 取，**不**出现在配置里', async () => {
    const seen: string[] = [];
    const { impl } = countingFetch(() => okResponse());
    const secretStore = {
      get: (ref: string) => {
        seen.push(ref);
        return Promise.resolve('sk-from-keychain');
      },
    };
    await invokeRouted(
      config({ allowRemote: true, routes: { capture: [{ endpointId: 'remote' }] } }),
      INVOCATION,
      [REMOTE_CONSENT],
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl, secretStore },
    );
    expect(seen).toEqual(['remote-key']);
  });

  it('请求体里只有 model + messages（数据面不多一个字段）', async () => {
    const { impl, calls } = countingFetch(() => okResponse());
    await invokeRouted(config(), INVOCATION, [], DEFAULT_ROUTING_POLICY, { fetchImpl: impl });
    const body = JSON.parse(String(calls[0]?.body));
    expect(Object.keys(body).sort()).toEqual(['messages', 'model']);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('端点预设 —— 只内置本机', () => {
  it('🔴 全部预设都是本机端点（不需要出境授权）', () => {
    // 这条断言是**刻意的守门**：将来若有人加了云端预设，
    // 它会红 —— 而那正是需要有人明确决定"要不要推荐云端"的时刻。
    for (const { id, isLocalOnly } of presetDestinations()) {
      expect(isLocalOnly, id).toBe(true);
    }
  });

  it('🔴 每个预设的目的地推导都是 none', () => {
    for (const preset of AI_ENDPOINT_PRESETS) {
      const d = classifyDestination({ mode: 'own', endpoint: preset.config.endpoint });
      expect(d, preset.id).toBe('none');
    }
  });

  it('每个预设都通过 URL 校验（含明文 http 本机例外）', () => {
    for (const preset of AI_ENDPOINT_PRESETS) {
      const v = validateEndpointUrl(preset.config.endpoint);
      expect(v.ok, preset.id).toBe(true);
    }
  });

  it('预设 id 唯一，且配置里的 id 与预设 id 一致', () => {
    const ids = AI_ENDPOINT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of AI_ENDPOINT_PRESETS) {
      expect(preset.config.id).toBe(preset.id);
    }
  });

  it('预设必须说清"数据去哪"和"需要什么前提"', () => {
    for (const preset of AI_ENDPOINT_PRESETS) {
      expect(preset.note, preset.id).toContain('不出这台设备');
      expect(preset.prerequisite, preset.id).toBeTruthy();
    }
  });

  it('findPreset 认得自己目录里的，不认别的', () => {
    expect(findPreset('ollama')?.label).toBe('本机 Ollama');
    expect(findPreset('nope')).toBeUndefined();
  });

  it('预设的端点不被当成远端（否则会被 allowRemote 拦掉，一键就没意义了）', () => {
    for (const preset of AI_ENDPOINT_PRESETS) {
      const r = resolveRoute(
        config({
          allowRemote: false,
          endpoints: [preset.config],
          routes: { capture: [{ endpointId: preset.config.id }] },
        }),
        'capture',
        { now: 0 },
      );
      expect(r.candidates, preset.id).toHaveLength(1);
    }
  });
});
