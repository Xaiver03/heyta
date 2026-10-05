/**
 * 托管路径的**境内白名单**测试（ADR-0053 §3.3）
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
  MANAGED_MODEL_HOSTS,
  assertEnableable,
  classifyDestination,
  createProvider,
  isDomesticManagedEndpoint,
  managedEndpointVerdict,
  managedEndpointVerdictAgainst,
  requiresEgressConsent,
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
