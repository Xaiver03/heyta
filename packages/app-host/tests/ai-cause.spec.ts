/**
 * `cause` 通道测试
 * ==================
 *
 * `packages/ai` 的路由层把失败分得很细（`no-route` / `egress-not-authorized` /
 * `fallback-needs-consent` / `not-configured` / `network` / `http-error` …），
 * 而界面要给**不同的**提示与不同的下一步（"去开总开关" vs "去配路由" vs
 * "去授权出境" vs "等一下它自己会恢复"）。
 *
 * 把这两者连起来的**唯一通道**就是失败结果上的 `cause` —— app-host 的四个
 * `request*()` 都写了 `cause: result.reason`。
 *
 * 🔴 **在加这个文件之前，`packages/app-host/tests/ai-*.spec.ts` 里对 `cause`
 * 的断言数是 0。** 也就是说：有人重构时把 `cause: result.reason` 那一行删掉，
 * 或者改成在这里重新概括一个原因，**四个功能的测试全都不会变红** ——
 * 而界面会退化成"AI 不可用"这一句，把用户引去查一个根本没问题的地方。
 * 这正是本仓库反复出现的那类失效（能力实现了、被测了、通道被悄悄掐断）。
 *
 * ## 为什么是**一个**文件而不是分散进四个 spec
 *
 * 它钉的是**一条契约**（"路由层的 reason 必须原样出现在 outcome.cause 上"），
 * 不是四个功能各自的业务。四个功能的差别只有"怎么造输入"，
 * 用一张表驱动，加一个功能就是加一行 —— 而不是把同一段断言抄四遍
 * （抄四遍就会漂移，本仓库已经为此付过代价）。
 *
 * ## 这里断言的是**具体字面量**
 *
 * `expect(outcome.cause).toBeDefined()` 这种写法等于没测：任何原因码都能让它绿。
 * 下面对每种场景都断言**它应当等于哪一个 reason**，并且有负向用例
 * （`unparseable` 时 `cause` 必须是 `undefined`）——
 * 因为"解析失败"不是路由层的失败，把它也塞一个 cause 进去是**编造**。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTING_POLICY,
  type AiFeature,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type EgressConsent,
} from '@heyta/ai';

import { requestBreakdown } from '../src/ai-breakdown.js';
import { requestCapture } from '../src/ai-capture.js';
import { requestDuration } from '../src/ai-duration.js';
import { requestPrioritize } from '../src/ai-prioritize.js';

// ─────────────────────────────────────────────────────────────────────────
// 夹具
// ─────────────────────────────────────────────────────────────────────────

/** 固定时钟。**不注入它，测试会过几天就变红**（AGENTS.md §7 #25）。 */
const NOW = Date.parse('2026-09-25T10:00:00');

/**
 * 两个端点都声明 `structured_output` + `long_context`。
 *
 * `breakdown` 需要 `long_context`（`DEFAULT_FEATURE_CAPABILITIES`），
 * 少声明它会被**能力过滤**拦成 `no-route` —— 那会让"缺授权"这条用例
 * 测到一个完全不同的分支（本文件的第一版就差点这么写）。
 * 多声明对 capture/prioritize/duration 无害：能力过滤只查"缺不缺"。
 */
const LOCAL = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'long_context'],
} as const;

const REMOTE = {
  id: 'remote',
  label: '云端中转',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output', 'long_context'],
} as const;

function routing(
  endpoints: readonly unknown[],
  routeIds: Partial<Record<AiFeature, readonly string[]>>,
): AiRoutingConfig {
  const routes: AiRoutingConfig['routes'] = {};
  for (const [feature, ids] of Object.entries(routeIds)) {
    if (ids === undefined) continue;
    routes[feature as AiFeature] = ids.map((endpointId) => ({ endpointId }));
  }
  return {
    enabled: true,
    allowRemote: true,
    endpoints: endpoints as AiRoutingConfig['endpoints'],
    routes,
  };
}

/** 计数用的、**永远失败**的 fetch：用来让首选端点在网络层就倒下。 */
function rejectingFetch(): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = ((url: unknown) => {
    calls.push(String(url));
    return Promise.reject(new Error('ECONNREFUSED'));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 永远成功、但正文读不成业务字段 —— 用来钉"解析失败没有 cause"。 */
const unparseableFetch = (() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: '抱歉，我做不到。' } }] }),
  })) as unknown as typeof fetch;

// ─────────────────────────────────────────────────────────────────────────
// 四个功能统一成一个可断言的视图
// ─────────────────────────────────────────────────────────────────────────

/** 四个 outcome 的公共失败面。断言只读这几项。 */
interface View {
  ok: boolean;
  reason: string;
  cause: string | undefined;
  message: string;
}

/** 各 outcome 的失败分支形状一致（`ok` / `reason` / `cause?` / `message`）。 */
type AnyOutcome =
  | { ok: true }
  | { ok: false; reason: string; cause?: string; message: string };

function view(outcome: AnyOutcome): View {
  if (outcome.ok) return { ok: true, reason: 'ok', cause: undefined, message: '' };
  return {
    ok: false,
    reason: outcome.reason,
    cause: outcome.cause,
    message: outcome.message,
  };
}

interface Deps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  fetchImpl: typeof fetch;
  policy?: AiRoutingPolicy;
}

/**
 * 把本文件的夹具折成四个 `request*()` 共用的依赖形状。
 *
 * ⚠️ `fetchImpl` 走 `routed`（HTTP 边界注入），**不是**顶层字段 ——
 * 四个函数的 deps 形状一致，所以这里只写一次。
 */
function requestDeps(d: Deps) {
  return {
    routing: d.routing,
    consents: d.consents,
    policy: d.policy,
    routed: { fetchImpl: d.fetchImpl },
  };
}

interface FeatureCase {
  name: string;
  run: (deps: Deps) => Promise<View>;
}

/**
 * 四个功能各一行。**差别只有"怎么造一份合法输入"** ——
 * 断言与场景全部共享，这正是本文件存在的意义。
 */
const FEATURES: readonly FeatureCase[] = [
  {
    name: 'capture',
    run: async (d) => view(await requestCapture({ locale: 'zh-CN', text: '明天下午三点开会', now: NOW }, requestDeps(d))),
  },
  {
    name: 'breakdown',
    run: async (d) => view(await requestBreakdown({ locale: 'zh-CN', title: '搬家' }, requestDeps(d))),
  },
  {
    name: 'prioritize',
    run: async (d) =>
      view(await requestPrioritize({ locale: 'zh-CN', tasks: [{ id: 't1', title: '搬家' }] }, requestDeps(d))),
  },
  {
    name: 'duration-estimate',
    run: async (d) => view(await requestDuration({ locale: 'zh-CN', title: '搬家' }, requestDeps(d))),
  },
];

// ─────────────────────────────────────────────────────────────────────────

describe('🔴 `cause` 通道 —— 场景 1：这个功能没配路由', () => {
  it.each(FEATURES)('$name：cause 是 `no-route`（不是"AI 不可用"这类概括）', async (feature) => {
    const { impl, calls } = rejectingFetch();
    const v = await feature.run({ routing: routing([LOCAL], {}), consents: [], fetchImpl: impl });

    expect(v.ok).toBe(false);
    // 粗粒度那层仍然是 ai-unavailable —— 界面靠 `cause` 才能细分
    expect(v.reason).toBe('ai-unavailable');
    // 🔴 具体原因码：**字面量**，不是 toBeDefined()
    expect(v.cause).toBe('no-route');
    expect(calls).toHaveLength(0);
  });
});

describe('🔴 `cause` 通道 —— 场景 2：远端端点但没有出境授权', () => {
  it.each(FEATURES)('$name：cause 是 `egress-not-authorized`，且一个请求都不发', async (feature) => {
    const { impl, calls } = rejectingFetch();
    const v = await feature.run({
      routing: routing([REMOTE], { capture: ['remote'], breakdown: ['remote'], prioritize: ['remote'], 'duration-estimate': ['remote'] }),
      consents: [], // ← 没有授权
      fetchImpl: impl,
    });

    expect(v.ok).toBe(false);
    expect(v.cause).toBe('egress-not-authorized');
    // 闸门在网之前：一次都没打出去
    expect(calls).toHaveLength(0);
  });
});

describe('🔴 `cause` 通道 —— 场景 3：首选失败且回退跨隐私边界', () => {
  it.each(FEATURES)('$name：cause 是 `fallback-needs-consent`，且只碰了本机端点', async (feature) => {
    const { impl, calls } = rejectingFetch();
    const v = await feature.run({
      routing: routing([LOCAL, REMOTE], {
        capture: ['local', 'remote'],
        breakdown: ['local', 'remote'],
        prioritize: ['local', 'remote'],
        'duration-estimate': ['local', 'remote'],
      }),
      consents: [], // 只同意过本机（本机本来就不需要授权）
      fetchImpl: impl,
      policy: { ...DEFAULT_ROUTING_POLICY, maxAttempts: 3 },
    });

    expect(v.ok).toBe(false);
    // 这与 `no-route` / `egress-not-authorized` 是**三件不同的事**：
    // 前者是"没路"，这个是"有路但那条路要你先同意"。
    expect(v.cause).toBe('fallback-needs-consent');
    // 只有本机那一次尝试；云端一次都没碰（不许"换一个目的地偷发"）
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('localhost');
  });
});

describe('🔴 `cause` 通道 —— 场景 4：总开关关着', () => {
  it.each(FEATURES)('$name：cause 是 `not-configured`（与"没配路由"分开）', async (feature) => {
    const { impl, calls } = rejectingFetch();
    const v = await feature.run({
      routing: { ...routing([LOCAL], {}), enabled: false },
      consents: [],
      fetchImpl: impl,
    });

    expect(v.ok).toBe(false);
    expect(v.cause).toBe('not-configured');
    expect(calls).toHaveLength(0);
  });
});

describe('🔴 `cause` 通道 —— 负向：解析失败**没有** cause（不许编）', () => {
  it.each(FEATURES)('$name：模型回了一坨没用的东西 → cause 必须是 undefined', async (feature) => {
    const v = await feature.run({
      routing: routing([LOCAL], {
        capture: ['local'],
        breakdown: ['local'],
        prioritize: ['local'],
        'duration-estimate': ['local'],
      }),
      consents: [],
      fetchImpl: unparseableFetch,
    });

    expect(v.ok).toBe(false);
    expect(v.reason).toBe('unparseable');
    // 🔴 这条是**承重的**：`unparseable` 不是路由层的失败，
    // 所以它没有 reason 可给。如果谁为了让 cause "看起来更完整"，
    // 在这里也塞一个值，界面就会去解释一个不存在的路由问题。
    expect(v.cause).toBeUndefined();
  });
});
