/**
 * 托管路径的**境内白名单**测试（ADR-0056 §3.3）
 * ============================================
 *
 * 这一档要证明的不是"代码写对了"，而是**"境内"这两个字落成了一件可失败的事**。
 * 五条腿，缺一条那句承诺就只是形容词：
 *
 *   1. 表本身的形状（唯一、规范化、每行都有**出处**而不是评价）；
 *   2. 正例放行 / 负例拒绝（含 `http://` 与非白名单域名两条**必须红**的负例）；
 *   3. `classifyDestination` 的 `managed` 那一支**看端点**（旧形状是无条件
 *      `heyta-cloud`，那正是被堵掉的洞）；
 *   4. `assertEnableable` 里**境内那条排在保留策略之前**，而"没配端点"那条不许
 *      被前面这条盖掉 —— 因为 `scripts/check-ai-coverage.mjs` 8b 钉的正是它；
 *   5. 🔴 **发送点的复算**：provider 构造出来之后把端点换成境外 / 换成回环，
 *      都必须**一个请求都不发**（2026-10-05 补 —— 补之前这段理由是一段假注释，
 *      详见文件末尾第 ⑤ 段）。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AiConfigError,
  DEFAULT_ROUTING_POLICY,
  MANAGED_MODEL_HOSTS,
  assertEnableable,
  classifyDestination,
  createProvider,
  extractServerCode,
  invokeRouted,
  isDomesticManagedEndpoint,
  managedEndpointVerdict,
  managedEndpointVerdictAgainst,
  requiresEgressConsent,
  resolveRoute,
  type AiRoutingConfig,
  type ManagedModelHost,
} from '../src/index.js';

/** 从真表里取一条**确实合格**的端点，用来做正例（不在测试里抄第二份白名单）。 */
const ALLOWLISTED_ENDPOINT = `https://${MANAGED_MODEL_HOSTS[0]?.host}/v1`;

describe('① 白名单表的形状', () => {
  it('非空（空表意味着托管档一条都放不了，那要响亮地知道）', () => {
    expect(MANAGED_MODEL_HOSTS.length).toBeGreaterThan(0);
  });

  it('主机名规范化且唯一：小写、无协议、无端口、无方括号', () => {
    const hosts = MANAGED_MODEL_HOSTS.map((entry) => entry.host);
    for (const host of hosts) {
      expect(host, host).toBe(host.toLowerCase());
      expect(host, host).not.toMatch(/:\/\//);
      expect(host, host).not.toContain(':');
      expect(host, host).not.toContain('[');
      expect(host, host).not.toContain('/');
      expect(host.includes('.'), host).toBe(true);
    }
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('🔴 每一行的所在地都是境内 —— 加一行境外供应商，这里立刻红', () => {
    const offenders = MANAGED_MODEL_HOSTS.filter((entry) => entry.jurisdiction !== 'cn');
    expect(offenders.map((entry) => `${entry.host}=${entry.jurisdiction}`)).toEqual([]);
  });

  it('🔴 每一行都带**可核对的出处**，不是一句评价', () => {
    // 出处必须是"指向某样东西"：一份 ADR、一份仓库文档、或一个 URL。
    // 「它是国内的」「大厂所以可信」这类句子过不了这条 —— 那正是本轮要拦的形状。
    for (const entry of MANAGED_MODEL_HOSTS) {
      expect(entry.evidence.length, entry.host).toBeGreaterThan(20);
      expect(entry.evidence, entry.host).toMatch(/ADR-\d{4}|docs\/|https?:\/\//);
      expect(entry.provider.length, entry.host).toBeGreaterThan(1);
    }
  });

  it('表里每一行都真的能被匹配上（写了却匹配不到的行 = 一条装饰）', () => {
    for (const entry of MANAGED_MODEL_HOSTS) {
      expect(isDomesticManagedEndpoint(`https://${entry.host}/v1`), entry.host).toBe(true);
      expect(classifyDestination({ mode: 'managed', endpoint: `https://${entry.host}/v1` }), entry.host).toBe(
        'heyta-cloud',
      );
    }
  });
});

describe('② 正例与负例', () => {
  it('正例：https + 白名单主机名 ⇒ 合格', () => {
    const verdict = managedEndpointVerdict(ALLOWLISTED_ENDPOINT);
    expect(verdict.ok).toBe(true);
  });

  it('🔴 负例一：明文 http 的境内端点 —— 拒，原因是 plaintext', () => {
    const verdict = managedEndpointVerdict(`http://${MANAGED_MODEL_HOSTS[0]?.host}/v1`);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('plaintext');
    expect(isDomesticManagedEndpoint(`http://${MANAGED_MODEL_HOSTS[0]?.host}/v1`)).toBe(false);
  });

  it('🔴 负例二：境外/非白名单域名 —— 拒，原因是 not-allowlisted', () => {
    for (const endpoint of [
      'https://api.openai.com/v1',
      'https://generativelanguage.googleapis.com/v1',
      'https://api.anthropic.com/v1',
      'https://dashscope.aliyuncs-intl.com/compatible-mode/v1',
    ]) {
      const verdict = managedEndpointVerdict(endpoint);
      expect(verdict.ok, endpoint).toBe(false);
      if (!verdict.ok) expect(verdict.reason, endpoint).toBe('not-allowlisted');
    }
  });

  it('匹配看主机名，不看路径（同一家的两个路径都是合格端点）', () => {
    const host = MANAGED_MODEL_HOSTS[0]?.host ?? '';
    expect(isDomesticManagedEndpoint(`https://${host}`)).toBe(true);
    expect(isDomesticManagedEndpoint(`https://${host}/v1/chat/completions`)).toBe(true);
    // 反过来说：白名单**不**认注册域，也不认子域 —— 加子域要另登记一行。
    expect(isDomesticManagedEndpoint(`https://cn.${host}/v1`)).toBe(false);
  });

  it('后缀匹配的攻击一律拒（白名单是主机名相等，不是"属于这个域名"）', () => {
    const anchor = MANAGED_MODEL_HOSTS[0]?.host ?? '';
    for (const endpoint of [
      `https://${anchor}.evil.cn/v1`,
      `https://evil.com/${anchor}`,
      `https://${anchor}.evil.cn:443/v1`,
      `https://x-${anchor}/v1`,
    ]) {
      expect(isDomesticManagedEndpoint(endpoint), endpoint).toBe(false);
      expect(classifyDestination({ mode: 'managed', endpoint }), endpoint).not.toBe('heyta-cloud');
    }
  });

  it('其它拒绝原因各有其名', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['ftp://example.com/v1', 'bad-scheme'],
      ['not a url', 'unparseable'],
      ['', 'empty'],
    ];
    for (const [endpoint, reason] of cases) {
      const verdict = managedEndpointVerdict(endpoint);
      expect(verdict.ok, endpoint).toBe(false);
      if (!verdict.ok) expect(verdict.reason, endpoint).toBe(reason);
    }
    const missing = managedEndpointVerdict(undefined);
    expect(!missing.ok && missing.reason).toBe('empty');
  });

  it('🔴 合成一张含境外行的表：第二把尺子（所在地）自己会咬人', () => {
    // 生产表里全是 'cn'，所以 `jurisdiction !== 'cn'` 那一支**没法**用真表打到。
    // 表是入参（见 `managed-endpoints.ts` 的注释）⇒ 这里用一张合成表证明它活着。
    const synthetic: readonly ManagedModelHost[] = [
      {
        host: 'api.foreign.example',
        provider: '测试用的境外供应商',
        jurisdiction: 'foreign',
        evidence: '本行只存在于这条单测里，用来证明所在地判定与主机名判定是两把尺子。',
      },
    ];
    const verdict = managedEndpointVerdictAgainst('https://api.foreign.example/v1', synthetic);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain('foreign');
    // 同一家换成 'cn' 就放行 —— 证明红的是所在地，不是主机名匹配。
    const flipped: readonly ManagedModelHost[] = [{ ...synthetic[0]!, jurisdiction: 'cn' }];
    expect(managedEndpointVerdictAgainst('https://api.foreign.example/v1', flipped).ok).toBe(true);
  });
});

describe('③ 托管的目的地**也从端点推导**（旧形状那个不看端点的洞）', () => {
  it('白名单端点 → heyta-cloud', () => {
    expect(classifyDestination({ mode: 'managed', endpoint: ALLOWLISTED_ENDPOINT })).toBe(
      'heyta-cloud',
    );
  });

  it('非白名单 / 明文 / 没配 ⇒ 一律推不出 heyta-cloud', () => {
    for (const endpoint of [
      undefined,
      '',
      'https://api.openai.com/v1',
      `http://${MANAGED_MODEL_HOSTS[0]?.host}/v1`,
      `https://${MANAGED_MODEL_HOSTS[0]?.host}.evil.cn/v1`,
      'not a url',
    ]) {
      const destination = classifyDestination({
        mode: 'managed',
        ...(endpoint === undefined ? {} : { endpoint }),
      });
      expect(destination, String(endpoint)).not.toBe('heyta-cloud');
    }
  });

  it('🔴 推导不出 heyta-cloud 的那些，仍然**要授权**（这条改动没有放宽任何东西）', () => {
    for (const endpoint of [
      undefined,
      '',
      'https://api.openai.com/v1',
      `http://${MANAGED_MODEL_HOSTS[0]?.host}/v1`,
    ]) {
      const destination = classifyDestination({
        mode: 'managed',
        ...(endpoint === undefined ? {} : { endpoint }),
      });
      expect(requiresEgressConsent(destination), String(endpoint)).toBe(true);
    }
  });
});

describe('④ assertEnableable：境内那条是硬门，而"能不能启用"只剩这一道门', () => {
  function reasonOf(config: { mode: 'managed'; endpoint?: string }): unknown {
    try {
      assertEnableable(config);
      return '（没抛错）';
    } catch (error) {
      expect(error).toBeInstanceOf(AiConfigError);
      return (error as AiConfigError).reason;
    }
  }

  it('没配端点 → `endpoint-required`（配置缺口，不是隐私事件）', () => {
    expect(reasonOf({ mode: 'managed' })).toBe('endpoint-required');
  });

  it('🟢 接上了境内白名单 → **可以启用**（ADR-0054 把保留策略定案之后）', () => {
    // 这一条是"开档"这件事本身的可失败判据：把它改回抛错，
    // 上面那条"境内 ≠ 放行牌"的守卫就再也分不出"被白名单挡住"与"被保留策略挡住"。
    expect(() => {
      assertEnableable({ mode: 'managed', endpoint: ALLOWLISTED_ENDPOINT });
    }).not.toThrow();
  });

  it('接了境外供应商 → 仍然以 managed-endpoint-not-domestic 被拒（可达的那半）', () => {
    expect(reasonOf({ mode: 'managed', endpoint: 'https://api.openai.com/v1' })).toBe(
      'managed-endpoint-not-domestic',
    );
  });

  it('境内但走明文 http → 同样被拒，且理由说的是境内那条', () => {
    expect(reasonOf({ mode: 'managed', endpoint: `http://${MANAGED_MODEL_HOSTS[0]?.host}/v1` })).toBe(
      'managed-endpoint-not-domestic',
    );
  });

  it('自备模式不受这条影响（对照组，防止"顺手把 own 也管起来"）', () => {
    expect(() => {
      assertEnableable({ mode: 'own', endpoint: 'https://api.openai.com/v1' });
    }).not.toThrow();
    expect(() => {
      assertEnableable({ mode: 'own', endpoint: 'http://localhost:11434/v1' });
    }).not.toThrow();
  });
});

// ── ⑤ 发送点的复算：托管档**构造得出来之后**，白名单还在不在 ──────────────────
//
// 🔴 这一段是 2026-10-05 补的，起因是一段**当时写成"做不到"的注释**：
// `packages/ai/src/provider.ts` 里那句"`managed` 在工厂里就被保留策略挡住，
// 构造不出 provider，所以那条判据今天写不出可达用例"—— 闸门拆掉之后**这句不再为真**，
// 于是"没有第二支 if"的理由从"测不到"变成了"复算会接住"。
// 理由变了就必须换证据：这里就是把那句话换成一条**跑得起来、并且会红**的用例。
// ⚠️ 顺序也是判据的一部分：目的地复算排在出境授权**之前**，所以未授权状态下
// 打到的也必须是复算那一支（否则"已披露的那份目的地"和"实际要发的目的地"分叉时，
// 用户看到的失败原因会是错的）。
describe('⑤ 发送点复算：托管端点在构造之后被换成境外 ⇒ 一个请求都不发', () => {
  it('阳性对照：境内白名单上的托管 provider **现在构造得出来**（闸门已拆）', () => {
    // 这条不是装饰：下面两条都靠它成立。若哪天这里开始抛，
    // 说明 `managed` 又被挡回不可启用，而那是一条**对外承诺的撤回**，必须响亮地红。
    const config = { mode: 'managed' as const, endpoint: ALLOWLISTED_ENDPOINT, model: 'm' };
    const provider = createProvider(config);
    expect(provider.mode).toBe('managed');
    expect(provider.destination).toBe('heyta-cloud');
  });

  it('🔴 构造之后把端点换成境外：拒绝、点明白名单、fetch 零调用', async () => {
    const config = { mode: 'managed' as const, endpoint: ALLOWLISTED_ENDPOINT, model: 'm' };
    const fetchImpl = vi.fn();
    const provider = createProvider(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    // 模拟"配置在 provider 活着的期间被改过"——这正是复算那一支存在的理由
    config.endpoint = 'https://api.openai.com/v1';

    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      [], // 故意不给授权：复算必须排在索要同意之前
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('http-error');
    expect(result.message).toContain('境内白名单');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🔴 换成回环地址也一样拒：目的地一离开 `heyta-cloud` 就不许发', async () => {
    // 这一支挡的是最坏的那种分叉：目的地从 `heyta-cloud`（要授权）变成 `none`
    // （**免授权**），于是不但话变了，连闸门本身都会被绕开。
    const config = { mode: 'managed' as const, endpoint: ALLOWLISTED_ENDPOINT, model: 'm' };
    const fetchImpl = vi.fn();
    const provider = createProvider(config, { fetchImpl: fetchImpl as unknown as typeof fetch });

    config.endpoint = 'http://localhost:11434/v1';

    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      [],
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('境内白名单');
    expect(fetchImpl).not.toHaveBeenCalled();
    // 而且目的地判定确实变了 —— 否则这条用例测的是"什么都没发生"
    expect(classifyDestination({ mode: 'managed', endpoint: config.endpoint })).not.toBe(
      'heyta-cloud',
    );
  });
});

/**
 * ⑥ `AiRoutingConfig.mode` —— [ADR-0056](../../../docs/adr/0056-endpoint-address-class-and-domestic-managed-allowlist.md)
 * §5 第 1 条点名的那一格（原文：「`AiRoutingConfig` 没有 `mode` 字段，所以自家服务器上的
 * 托管端点会被推导成 `user-endpoint`，于是披露变成"该端点由你提供、heyta 不参与"——**那句是假的**」）。
 *
 * 🔴 这一组钉的是**两件相反方向的事**，缺一条都会出事：
 * 1. `mode: 'managed'` 时白名单端点**必须**说成 `heyta-cloud`（否则披露在撒谎）；
 * 2. 但它**不能**把任何端点都说成 `heyta-cloud`（否则这个字段就成了一个"说好话的开关"）。
 */
describe('⑥ 路由配置必须知道供给模式（ADR-0056 §5 第 1 条那格已补）', () => {
  // ⚠️ 只有两档：`'off'` 已被 `AiRoutingConfig.mode` 的类型排除（见那条注释 ——
  // 它在路由里会把每个端点都变成免授权的 `'none'`）。运行时的兜底另有一段 ⑨。
  const managedRouting = (mode?: 'own' | 'managed') => ({
    ...(mode === undefined ? {} : { mode }),
    enabled: true,
    allowRemote: true,
    endpoints: [
      { id: 'managed', label: 'heyta 托管', endpoint: ALLOWLISTED_ENDPOINT, model: 'deepseek' },
    ],
    routes: { capture: [{ endpointId: 'managed' }] },
  });

  it('🔴 `mode: managed` + 白名单端点 ⇒ 目的地是 `heyta-cloud`（过去这里恒为 `user-endpoint`）', () => {
    const { candidates } = resolveRoute(managedRouting('managed'), 'capture', { now: 0 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.destination).toBe('heyta-cloud');
  });

  it('⚠️ 不写 `mode` ⇒ 与引入这个字段之前**逐字相同**（`user-endpoint`），没有静默行为变更', () => {
    const { candidates } = resolveRoute(managedRouting(), 'capture', { now: 0 });

    expect(candidates[0]?.destination).toBe('user-endpoint');
  });

  it('🔴 `mode: managed` 但端点**不在白名单** ⇒ 仍推 `user-endpoint`（这个字段放宽不了任何东西）', () => {
    const routing = managedRouting('managed');
    const { candidates } = resolveRoute(
      {
        ...routing,
        endpoints: [
          { ...routing.endpoints[0]!, endpoint: 'https://api.example.com/v1' },
        ],
      },
      'capture',
      { now: 0 },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.destination).toBe('user-endpoint');
  });

  it('🔴 发送点复算与解析候选**用同一个 mode**：端点换成境外之后，同一份 mode 下推不出 `heyta-cloud`', () => {
    // 解析候选那一侧（`resolveRoute` → `validateEndpointUrl`）
    const { candidates } = resolveRoute(managedRouting('managed'), 'capture', { now: 0 });
    expect(candidates[0]?.destination).toBe('heyta-cloud');

    // 发送点那一侧（`attemptOnce` → `validateEndpointUrl`，同一个函数、同一个 mode）
    // 端点一旦离开白名单，两处都必须推不出 `heyta-cloud` —— 否则就是"披露按 A 说、发送点按 B 判"。
    expect(
      classifyDestination({ mode: 'managed', endpoint: 'https://api.example.com/v1' }),
    ).not.toBe('heyta-cloud');
  });
});

/**
 * ⑦ 托管档的**传输**：打到的是我们自己的服务端代理，不是 OpenAI 兼容端点。
 *
 * 🔴 三条判据，对应三个各自能出事的形状：
 * 1. 契约：URL 是 `/api/ai/managed/chat`、body **恰好** `{feature, messages}`
 *    （多一个 `model` 就意味着客户端能选我们倒贴多少钱，ADR-0021）；
 * 2. 拿不到托管通道时**不许回退**到自备端点那条路（"你以为发给了托管、实际发给了别处"）；
 * 3. 带工具时**响亮拒绝**（服务端不转发 `tools`，静默降级=纯文本回答）。
 */
describe('⑦ 托管档的传输：打到我们自己的代理，而不是 OpenAI 兼容端点', () => {
  const consent = (feature: 'capture' | 'tool-calling') => [
    { feature, destination: 'heyta-cloud' as const, grantedAt: 0 },
  ];
  const okResponse = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const managedConfig = () => ({
    mode: 'managed' as const,
    endpoint: ALLOWLISTED_ENDPOINT,
    model: 'm',
  });

  it('✅ 有托管通道 ⇒ 打到 `<基址>/api/ai/managed/chat`，body 只有 `{feature, messages}`，带 Bearer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const provider = createProvider(managedConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // 尾斜杠必须归一化：同一个服务器两种写法不该拼出两个不同的串
      managedTransport: async () => ({ baseUrl: 'https://heyta.example.cn/', token: 'T0K' }),
    });

    const result = await provider.invoke(
      { feature: 'capture', system: 'sys', user: 'usr', fields: ['title'] },
      consent('capture'),
    );

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://heyta.example.cn/api/ai/managed/chat');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    // 🔴 这次调用**没有 `tools`** ⇒ 键集恰好两项：没有 `model`（服务端定），也没有 `tools`
    // （请求构造器只在 invocation.tools 非空时才加进来；见 `wire.ts` 的 `withTools` 判定）
    expect(Object.keys(body).sort()).toEqual(['feature', 'messages']);
    expect(body.feature).toBe('capture');
    expect(init.headers).toMatchObject({ authorization: 'Bearer T0K' });
  });

  it('🔴 没有托管通道 ⇒ `not-configured`，且**零请求**（不许回退到自备端点那条路）', async () => {
    const fetchImpl = vi.fn();
    const provider = createProvider(managedConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => undefined,
    });

    const result = await provider.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      consent('capture'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🔴 带工具 ⇒ `no-route` 且**零请求**（托管档不转发 tools，不许静默降级成纯文本）', async () => {
    const fetchImpl = vi.fn();
    const provider = createProvider(managedConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => ({ baseUrl: 'https://heyta.example.cn', token: 'T' }),
    });

    const result = await provider.invoke(
      {
        feature: 'tool-calling',
        system: 's',
        user: 'u',
        fields: ['title'],
        tools: [{ name: 'get_task', description: 'd', parameters: {} }],
      },
      consent('tool-calling'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no-route');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * ⑧ **生产路径**（`invokeRouted`）上的托管档 —— 这是真正被宿主调用的那条。
 *
 * 🔴 为什么单开一段：`createProvider()`（⑦ 那段）是**历史/测试路径**，
 * `packages/app-host` 的注释逐字写着"新增出境功能请接 `invokeRouted`，不要接这里"。
 * 只在 ⑦ 上接线等于**没接生产**。
 *
 * 🔴 本段最值钱的一条是**主机一致性守卫**：披露说 `heyta-cloud` 是按
 * `candidate.endpoint` 推的，而字节实际打到 `transport.baseUrl`。
 * 两者不同主机时**必须一个请求都不发** —— 否则就是"披露按 A 说、字节发到 B"。
 */
describe('⑧ 生产路径 invokeRouted 上的托管档', () => {
  const routing = () => ({
    mode: 'managed' as const,
    enabled: true,
    allowRemote: true,
    endpoints: [
      { id: 'managed', label: 'heyta 托管', endpoint: ALLOWLISTED_ENDPOINT, model: 'deepseek' },
    ],
    routes: { capture: [{ endpointId: 'managed' }] },
  });
  const invocation = { feature: 'capture' as const, system: 's', user: 'u', fields: ['title'] };
  const consents = [{ feature: 'capture' as const, destination: 'heyta-cloud' as const, grantedAt: 0 }];
  const okResponse = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  /** 白名单端点的主机名 —— 用它拼出一个"同一台主机、不同写法"的基址。 */
  const MANAGED_HOST = MANAGED_MODEL_HOSTS[0]!.host;

  it('✅ 打到 `<基址>/api/ai/managed/chat`，body 恰好 `{feature, messages}`', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const out = await invokeRouted(routing(), invocation, consents, DEFAULT_ROUTING_POLICY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => ({ baseUrl: `https://${MANAGED_HOST}`, token: 'T0K' }),
    });

    expect(out.result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://${MANAGED_HOST}/api/ai/managed/chat`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['feature', 'messages']);
  });

  it('🔴 宿主给的基址与披露的端点**不是同一台主机** ⇒ 拒发，零请求', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const out = await invokeRouted(routing(), invocation, consents, DEFAULT_ROUTING_POLICY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // 披露的是白名单上那台；通道却指到别处 —— 这正是"发到 B"的形状
      managedTransport: async () => ({ baseUrl: 'https://evil.example.com', token: 'T' }),
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.message).toContain('不是同一台主机');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🔴 有托管路由但拿不到通道 ⇒ `not-configured`，零请求（不回退到 OpenAI 契约）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const out = await invokeRouted(routing(), invocation, consents, DEFAULT_ROUTING_POLICY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => undefined,
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.reason).toBe('not-configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * ⑨ **运行时兜底**：`mode: 'off'` 不许拆掉出境闸门。
 *
 * 🔴 类型上 `AiRoutingConfig.mode` 已经排除 `'off'`，但配置可能来自
 * **持久化 JSON / 导入 / 手工改文件** —— 那些路径里没有类型系统。
 * 而 `'off'` 在路由里是危险值：`classifyDestination({ mode: 'off' })` 对**任何**端点
 * 都返回 `'none'`，而 `'none'` = 本机目的地、**免授权**
 * ⇒ `resolveRoute` 的第 2 道闸（`destination !== 'none' && !allowRemote`）**整条失效**，
 * 一个远端端点会被当成"本机"放行。用户看不出任何变化。
 */
describe("⑨ 运行时兜底：磁盘上的 `mode: 'off'` 不许拆掉出境闸门", () => {
  it("🔴 `mode: 'off'` 被归一到 `'own'` ⇒ 远端端点仍被第 2 道闸排除（不是免授权放行）", () => {
    // 故意绕过类型：模拟"磁盘上就是这串"这条真实路径
    const routing = {
      mode: 'off',
      enabled: true,
      allowRemote: false,
      endpoints: [{ id: 'r', label: 'R', endpoint: 'https://api.example.com/v1', model: 'm' }],
      routes: { capture: [{ endpointId: 'r' }] },
    } as unknown as AiRoutingConfig;

    const { candidates, excluded } = resolveRoute(routing, 'capture', { now: 0 });

    // 若 `'off'` 生效：目的地会是 `'none'` ⇒ 不被 `allowRemote` 排除 ⇒ candidates 有 1 条
    expect(candidates).toHaveLength(0);
    expect(excluded.map((e) => e.reason)).toContain('remote-not-allowed');
  });
});

/**
 * ⑩ 托管档**被拒时的稳定码**：`402 SUBSCRIPTION_REQUIRED` / `409 AI_QUOTA_EXCEEDED`。
 *
 * 🔴 这两件事都落在失败词表的 `http-error` 一档里，只靠状态码界面分不清 ——
 * 而它们的**修复动作完全相反**：一个是"去买"，一个是"等下一周期"。
 * 所以服务端那个 UPPER_SNAKE 必须一路带到壳里（`packages/ai` 只带码，不决定措辞）。
 */
describe('⑩ 托管档被拒：服务端稳定码要一路带出来', () => {
  /** 与 ⑧ 同源：白名单端点的主机名（不抄第二份白名单）。 */
  const MANAGED_HOST = MANAGED_MODEL_HOSTS[0]!.host;
  const managedRouting = () => ({
    mode: 'managed' as const,
    enabled: true,
    allowRemote: true,
    endpoints: [
      { id: 'managed', label: 'heyta 托管', endpoint: ALLOWLISTED_ENDPOINT, model: 'm' },
    ],
    routes: { capture: [{ endpointId: 'managed' }] },
  });
  const invocation = { feature: 'capture' as const, system: 's', user: 'u', fields: ['title'] };
  const consents = [
    { feature: 'capture' as const, destination: 'heyta-cloud' as const, grantedAt: 0 },
  ];
  const refuse = (status: number, code: string) =>
    new Response(JSON.stringify({ code, message: 'x', reason: 'y' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('🔴 `402 SUBSCRIPTION_REQUIRED` ⇒ `http-error` + `status:402` + `serverCode` 原样带出', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(refuse(402, 'SUBSCRIPTION_REQUIRED'));

    const out = await invokeRouted(managedRouting(), invocation, consents, DEFAULT_ROUTING_POLICY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => ({ baseUrl: `https://${MANAGED_HOST}`, token: 'T' }),
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.reason).toBe('http-error');
    expect(out.result.status).toBe(402);
    expect(out.result.serverCode).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('🔴 `409 AI_QUOTA_EXCEEDED` ⇒ 同一个 `http-error` 档，但码不同（界面据此分开说话）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(refuse(409, 'AI_QUOTA_EXCEEDED'));

    const out = await invokeRouted(managedRouting(), invocation, consents, DEFAULT_ROUTING_POLICY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => ({ baseUrl: `https://${MANAGED_HOST}`, token: 'T' }),
    });

    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.serverCode).toBe('AI_QUOTA_EXCEEDED');
  });

  it('✅ 成功响应**不碰** body：`serverCode` 不出现，正文照常解析出来', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const out = await invokeRouted(managedRouting(), invocation, consents, DEFAULT_ROUTING_POLICY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      managedTransport: async () => ({ baseUrl: `https://${MANAGED_HOST}`, token: 'T' }),
    });

    expect(out.result.ok).toBe(true);
    if (!out.result.ok) throw new Error('unreachable');
    expect(out.result.suggestion.text).toBe('ok');
  });

  it('⚠️ `extractServerCode` 只认非空字符串：`null` / 数字 / 空串 / 数组一律 `undefined`', () => {
    // 一个空串进了界面会命中一张取不到词条的表，看起来像"未知错误"——
    // 比 `undefined`（壳知道"服务端没给码"）更难查。
    for (const [input, expected] of [
      [{ code: 'X' }, 'X'],
      [{ code: '' }, undefined],
      [{ code: '   ' }, undefined],
      [{ code: 1 }, undefined],
      [{ code: null }, undefined],
      [{}, undefined],
      [null, undefined],
      [[], undefined],
      ['{"code":"X"}', undefined],
    ] as const) {
      expect(extractServerCode(input), JSON.stringify(input)).toBe(expected);
    }
  });
});
