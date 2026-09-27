/**
 * AI 供给模式与出境闸门测试
 * ============================
 *
 * 这个文件测的不是"功能能不能用"，而是**几条不许被改掉的承诺**。
 * 它们全都是"如果没有测试，下一个人会顺手改坏"的类型：
 *
 *   1. 🔴 **托管模式的文案不许出现"端到端加密"** —— ADR-0006 §3.2 第 5 条。
 *      这是产品承诺，靠人记是记不住的，而说错一次的代价不可逆。
 *   2. 🔴 **授权绑定在 `(功能, 目的地)` 上** —— 换端点后旧授权必须失效，
 *      否则会出现"我没同意过这个组合，但它放行了"。
 *   3. 🔴 **本地端点免授权** —— 这是"自备"相对"托管"的实质优势。
 *      如果它也要走一遍提示，用户会被训练成"看到提示就点同意"。
 *   4. 🔴 **托管模式当前必须启用失败** —— 保留策略未定案前不许打开。
 *   5. **provider 只产出建议** —— 类型上就没有能变成 op 的东西。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AiConfigError,
  assertEnableable,
  authorizeEgress,
  buildDisclosure,
  classifyDestination,
  createProvider,
  describeDestination,
  describeRetention,
  extractContent,
  isLoopbackEndpoint,
  previewDisclosure,
  requiresEgressConsent,
  retainValidConsents,
  type EgressConsent,
  type EgressDecision,
} from '../src/index.js';

describe('isLoopbackEndpoint —— 只认字面上的回环地址', () => {
  it('认出常见的回环写法', () => {
    expect(isLoopbackEndpoint('http://localhost:11434/v1')).toBe(true);
    expect(isLoopbackEndpoint('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLoopbackEndpoint('http://127.1.2.3:8080/v1')).toBe(true);
    expect(isLoopbackEndpoint('https://LOCALHOST/v1')).toBe(true);
    expect(isLoopbackEndpoint('http://[::1]:11434/v1')).toBe(true);
  });

  it('🔴 局域网主机名判成远端（宁可多问一次）', () => {
    // 这是刻意的：我们无法证明 my-nas.lan 是本机。
    // 用"少问一次"换"以为没出设备、其实出了"是不划算的。
    expect(isLoopbackEndpoint('http://my-nas.lan:11434/v1')).toBe(false);
    expect(isLoopbackEndpoint('http://192.168.1.50:11434/v1')).toBe(false);
    expect(isLoopbackEndpoint('http://10.0.0.5:11434/v1')).toBe(false);
  });

  it('公网端点判成远端', () => {
    expect(isLoopbackEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackEndpoint('https://api.example.com/v1')).toBe(false);
  });

  it('解析不出的地址判成远端（保守方向）', () => {
    expect(isLoopbackEndpoint('not a url')).toBe(false);
    expect(isLoopbackEndpoint('')).toBe(false);
  });
});

describe('classifyDestination —— 目的地由端点推导，不由模式声明', () => {
  it('关闭 → none', () => {
    expect(classifyDestination({ mode: 'off' })).toBe('none');
  });

  it('托管 → heyta-cloud', () => {
    expect(classifyDestination({ mode: 'managed' })).toBe('heyta-cloud');
  });

  it('🔴 自备 + 本地端点 → none（明文没出设备）', () => {
    expect(classifyDestination({ mode: 'own', endpoint: 'http://localhost:11434/v1' })).toBe('none');
  });

  it('🔴 自备 + 远端端点 → user-endpoint（不是 none）', () => {
    expect(classifyDestination({ mode: 'own', endpoint: 'https://api.example.com/v1' })).toBe(
      'user-endpoint',
    );
  });

  it('自备但没配端点 → none（还没到能出境的状态）', () => {
    expect(classifyDestination({ mode: 'own' })).toBe('none');
    expect(classifyDestination({ mode: 'own', endpoint: '' })).toBe('none');
  });
});

describe('🔴🔴 隐私文案不许出现"端到端加密"', () => {
  // 这是 ADR-0006 §3.2 第 5 条的**可失败检查**。
  // 原因（ADR-0006 §2.1）：E2EE 的定义就是"服务端到不了明文"，
  // 而托管 AI 必须把明文送到服务端 —— 两者在定义上互斥。
  // ⚠️ 第一版这条测试写错了：它禁掉了整个词，于是**连"不受端到端加密保护"
  // 这句诚实的否定也一起禁掉了**。约束是"不许宣称"，不是"不许提及" ——
  // 恰恰相反，托管模式**必须主动否认**，含糊其辞才是问题。
  // 所以下面按目的地分开断言：该否认的必须否认，其余的一律不许提。
  /** 英文缩写在任何模式下一律不出现（界面文案统一用中文，缩写是行话）。 */
  const JARGON = ['E2EE', 'E2E', 'end-to-end', 'End-to-End'];

  it('都不含英文缩写', () => {
    for (const d of ['none', 'user-endpoint', 'heyta-cloud'] as const) {
      const text = describeDestination(d);
      for (const word of JARGON) {
        expect(text).not.toContain(word);
      }
    }
  });

  it('🔴 不宣称加密：本地与自备端点的文案不出现任何加密承诺', () => {
    // 这两条路径上我们**不**做加密声明 —— 本地不必说，
    // 自备端点我们无权代表它承诺。
    for (const d of ['none', 'user-endpoint'] as const) {
      expect(describeDestination(d)).not.toContain('端到端加密');
    }
  });

  it('🔴🔴 托管模式**必须主动否认**，且否认要能被机器检查', () => {
    const text = describeDestination('heyta-cloud');
    // 必须出现"不受端到端加密"这个确切的否定，而不是含糊过去。
    expect(text).toContain('不受端到端加密');
    // 且不许出现任何**肯定**的说法。
    // （"不受端到端加密"里含有这个词，所以先把它挖掉再查残留。）
    expect(text.replaceAll('不受端到端加密', '')).not.toContain('端到端加密');
  });

  it('保留声明同样不含加密承诺', () => {
    for (const d of ['none', 'user-endpoint'] as const) {
      const text = describeRetention(d);
      expect(text).toBeDefined();
      for (const word of [...JARGON, '端到端加密']) {
        expect(text!).not.toContain(word);
      }
    }
  });

  it('托管模式的文案明确指出明文可见（而不是含糊其辞）', () => {
    expect(describeDestination('heyta-cloud')).toContain('明文');
  });

  it('托管模式的文案明确指出同步仍然是加密的（避免用户以为全都泄露了）', () => {
    expect(describeDestination('heyta-cloud')).toContain('同步');
  });

  it('自备远端端点的文案说明 heyta 无法审计它', () => {
    expect(describeDestination('user-endpoint')).toContain('无法审计');
  });
});

describe('describeRetention —— 不许编造数字', () => {
  it('none 与 user-endpoint 有诚实文案', () => {
    expect(describeRetention('none')).toContain('未离开设备');
    expect(describeRetention('user-endpoint')).toContain('由你自己的端点决定');
  });

  it('🔴 heyta-cloud 返回 undefined（策略未定案，不许编）', () => {
    expect(describeRetention('heyta-cloud')).toBeUndefined();
  });
});

describe('assertEnableable', () => {
  it('off 永远可以', () => {
    expect(() => {
      assertEnableable({ mode: 'off' });
    }).not.toThrow();
  });

  it('🔴 托管模式当前**必须**启用失败（保留策略未定案）', () => {
    expect(() => {
      assertEnableable({ mode: 'managed' });
    }).toThrow(AiConfigError);
    // 原因要能被程序识别，而不只是给人看的一句话
    try {
      assertEnableable({ mode: 'managed' });
      expect.unreachable('应当抛错');
    } catch (e) {
      expect((e as AiConfigError).reason).toBe('retention-undecided');
    }
  });

  it('🔴 自备模式必须有端点 —— 原因是 `endpoint-required`', () => {
    // 只断言 `toThrow(AiConfigError)` 证明不了"因为正确的原因失败"：
    // 端点为空和端点写错都会抛同一个类。这里把 reason 钉死。
    for (const config of [{ mode: 'own' } as const, { mode: 'own', endpoint: '' } as const]) {
      try {
        assertEnableable(config);
        expect.unreachable('应当抛错');
      } catch (e) {
        expect(e).toBeInstanceOf(AiConfigError);
        expect((e as AiConfigError).reason).toBe('endpoint-required');
      }
    }
  });

  it('🔴 自备模式的端点必须能解析且是 http(s) —— 原因是 `endpoint-invalid`', () => {
    for (const endpoint of ['not a url', 'ftp://x/v1']) {
      try {
        assertEnableable({ mode: 'own', endpoint });
        expect.unreachable('应当抛错');
      } catch (e) {
        expect(e).toBeInstanceOf(AiConfigError);
        // 解析失败与协议不对，是**同一个** reason（都是"地址不能用"）
        expect((e as AiConfigError).reason).toBe('endpoint-invalid');
      }
    }
  });

  it('合法地址放行（对照组，确保上面两条不是"什么都拒"）', () => {
    expect(() => {
      assertEnableable({ mode: 'own', endpoint: 'http://localhost:11434/v1' });
    }).not.toThrow();
    expect(() => {
      assertEnableable({ mode: 'own', endpoint: 'https://api.example.com/v1' });
    }).not.toThrow();
  });
});

describe('🔴 出境闸门：授权绑定在 (功能, 目的地) 上', () => {
  const consent: EgressConsent = {
    feature: 'breakdown',
    destination: 'heyta-cloud',
    grantedAt: 1_700_000_000_000,
  };

  it('本地端点免授权', () => {
    const d = authorizeEgress({ feature: 'breakdown', destination: 'none', fields: ['title'] }, []);
    expect(d.allowed).toBe(true);
  });

  it('无授权时拒绝，并带回披露内容', () => {
    const d = authorizeEgress(
      { feature: 'breakdown', destination: 'heyta-cloud', fields: ['title', 'note'] },
      [],
    );
    expect(d.allowed).toBe(false);
    if (d.allowed) throw new Error('unreachable');
    expect(d.reason).toBe('consent-missing');
    // 🔴 拒绝时**必须**仍能说清"授权后什么会被发出去"，否则是逼用户盲签
    expect(d.disclosure.fields).toEqual(['title', 'note']);
    expect(d.disclosure.destinationText).not.toBe('');
  });

  it('有匹配授权时放行', () => {
    const d = authorizeEgress(
      { feature: 'breakdown', destination: 'heyta-cloud', fields: ['title'] },
      [consent],
    );
    expect(d.allowed).toBe(true);
  });

  it('🔴 目的地不同 → 授权**不**匹配（这是本文件最重要的一条）', () => {
    // 用户同意的是"发给 heyta 云"，现在要发给"自备远端" → 必须重新征求。
    const d = authorizeEgress(
      { feature: 'breakdown', destination: 'user-endpoint', fields: ['title'] },
      [consent],
    );
    expect(d.allowed).toBe(false);
  });

  it('🔴 功能不同 → 授权**不**匹配', () => {
    // 同意过"拆解"不等于同意"优先级排序"。
    const d = authorizeEgress(
      { feature: 'prioritize', destination: 'heyta-cloud', fields: ['title'] },
      [consent],
    );
    expect(d.allowed).toBe(false);
  });

  it('没有授权记录时，需要授权的目的地一律拒绝', () => {
    expect(
      requiresEgressConsent(classifyDestination({ mode: 'managed' })),
    ).toBe(true);
    expect(requiresEgressConsent('none')).toBe(false);
  });

  it('🔴 `consent-required` 已从类型里收敛掉（下面这行是**承重的**）', () => {
    // 这条用例钉的是**类型**，不是运行时行为：
    // 一旦有人把 `consent-required` 加回 `EgressDecision`，
    // `@ts-expect-error` 就变成"未使用的指令"，`pnpm typecheck` 立刻报 TS2578。
    // 换句话说：**"删掉一个死成员"这件事本身现在有测试守着**，
    // 而不是靠"我记得当时删过"。
    const decision: EgressDecision = {
      allowed: false,
      // @ts-expect-error `consent-required` 从来没有构造点（见 egress.ts 的说明）。
      reason: 'consent-required',
      disclosure: buildDisclosure({
        feature: 'capture',
        destination: 'heyta-cloud',
        fields: ['title'],
      }),
    };
    expect(decision.allowed).toBe(false);
  });
});

describe('🔴 retainValidConsents —— 切换供给模式时必须失效旧授权', () => {
  const consents: EgressConsent[] = [
    { feature: 'breakdown', destination: 'heyta-cloud', grantedAt: 1 },
    { feature: 'prioritize', destination: 'heyta-cloud', grantedAt: 2 },
    { feature: 'breakdown', destination: 'user-endpoint', grantedAt: 3 },
  ];

  it('切到本地端点 → 一条都不留', () => {
    // 留着就是将来误放行的种子：用户从本地切回云端时，
    // 那些陈旧记录会重新变得可匹配。
    expect(retainValidConsents(consents, 'none')).toEqual([]);
  });

  it('切到自备远端 → 只留 user-endpoint 的那些', () => {
    const kept = retainValidConsents(consents, 'user-endpoint');
    expect(kept).toHaveLength(1);
    expect(kept[0]!.feature).toBe('breakdown');
  });

  it('切到托管 → 只留 heyta-cloud 的那些', () => {
    const kept = retainValidConsents(consents, 'heyta-cloud');
    expect(kept).toHaveLength(2);
    expect(kept.every((c) => c.destination === 'heyta-cloud')).toBe(true);
  });

  it('🔴 被清掉的授权**不能**再放行', () => {
    // 完整走一遍那个坏场景：本地 → 云端 → 远端
    const afterLocal = retainValidConsents(consents, 'none');
    const afterCloud = retainValidConsents(afterLocal, 'heyta-cloud');
    // 用户在"本地"阶段清空过授权，所以切到云端时手上什么都没有
    expect(afterCloud).toEqual([]);
    const d = authorizeEgress(
      { feature: 'breakdown', destination: 'heyta-cloud', fields: ['title'] },
      afterCloud,
    );
    expect(d.allowed).toBe(false);
  });
});

describe('buildDisclosure / previewDisclosure', () => {
  it('披露里字段是逐项列出的', () => {
    const d = buildDisclosure({
      feature: 'prioritize',
      destination: 'user-endpoint',
      fields: ['title', 'dueDate', 'priority'],
    });
    expect(d.fields).toEqual(['title', 'dueDate', 'priority']);
    expect(d.requiresConsent).toBe(true);
  });

  it('关闭态预览不报错，且不需要授权', () => {
    const d = previewDisclosure({ mode: 'off' }, { feature: 'capture', fields: ['title'] });
    expect(d.requiresConsent).toBe(false);
    expect(d.destination).toBe('none');
  });

  it('托管态预览会抛错（因为整体不许启用）', () => {
    expect(() => previewDisclosure({ mode: 'managed' }, { feature: 'capture', fields: ['title'] })).toThrow(
      AiConfigError,
    );
  });
});

describe('createProvider —— 关闭态', () => {
  it('关闭态调用明确失败，不静默返回空建议', async () => {
    const p = createProvider({ mode: 'off' });
    expect(p.mode).toBe('off');
    const r = await p.invoke({ feature: 'capture', system: 's', user: 'u', fields: ['title'] }, []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('not-configured');
  });

  it('关闭态不提供端点标签', () => {
    expect(createProvider({ mode: 'off' }).endpointLabel).toBeUndefined();
  });
});

describe('createProvider —— 闸门在**网络之前**', () => {
  it('🔴 未授权时**一次网络请求都不发**', async () => {
    const fetchImpl = vi.fn();
    const p = createProvider(
      { mode: 'own', endpoint: 'https://api.example.com/v1', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const r = await p.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      [], // 没有授权
    );

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('egress-not-authorized');
    // 关键断言：门在网之前
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('本地端点无需授权，直接发请求', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: '好的' } }] }),
      }),
    );
    const p = createProvider(
      { mode: 'own', endpoint: 'http://localhost:11434/v1', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const r = await p.invoke({ feature: 'capture', system: 's', user: 'u', fields: ['title'] }, []);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('有匹配授权时发请求，且目的地如实标注', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'x' } }] }),
      }),
    );
    const p = createProvider(
      { mode: 'own', endpoint: 'https://api.example.com/v1', model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    const consents: EgressConsent[] = [
      { feature: 'capture', destination: 'user-endpoint', grantedAt: 1 },
    ];
    const r = await p.invoke(
      { feature: 'capture', system: 's', user: 'u', fields: ['title'] },
      consents,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.suggestion.destination).toBe('user-endpoint');
  });

  it('🔴 请求体里只有 system + user，**没有**多余的任务字段', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'x' } }] }),
      }),
    );
    const p = createProvider(
      { mode: 'own', endpoint: 'http://localhost:9/v1', model: 'my-model' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await p.invoke({ feature: 'capture', system: 'S', user: 'U', fields: ['title'] }, []);

    const call = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['messages', 'model']);
    expect(body['model']).toBe('my-model');
  });
});

describe('createProvider —— 失败分类', () => {
  const okFetch = (payload: unknown) =>
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
    ) as unknown as typeof fetch;

  it('HTTP 错误带状态码', async () => {
    const p = createProvider(
      { mode: 'own', endpoint: 'http://localhost:9/v1' },
      {
        fetchImpl: vi.fn(() =>
          Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
        ) as unknown as typeof fetch,
      },
    );
    const r = await p.invoke({ feature: 'capture', system: 's', user: 'u', fields: ['title'] }, []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('http-error');
    expect(r.status).toBe(401);
  });

  it('空响应被识别出来（而不是当成空建议）', async () => {
    const p = createProvider(
      { mode: 'own', endpoint: 'http://localhost:9/v1' },
      { fetchImpl: okFetch({ choices: [{ message: { content: '   ' } }] }) },
    );
    const r = await p.invoke({ feature: 'capture', system: 's', user: 'u', fields: ['title'] }, []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('empty-response');
  });

  it('网络异常被包成失败，不抛出', async () => {
    const p = createProvider(
      { mode: 'own', endpoint: 'http://localhost:9/v1' },
      {
        fetchImpl: vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
      },
    );
    const r = await p.invoke({ feature: 'capture', system: 's', user: 'u', fields: ['title'] }, []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('network');
    expect(r.message).toContain('ECONNREFUSED');
  });
});

describe('extractContent —— 不信任外部响应形状', () => {
  it('取出正常形状', () => {
    expect(extractContent({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
  });

  it('🔴 各种畸形输入都返回 undefined，而不是抛错或返回假值', () => {
    expect(extractContent(null)).toBeUndefined();
    expect(extractContent(undefined)).toBeUndefined();
    expect(extractContent('字符串')).toBeUndefined();
    expect(extractContent(42)).toBeUndefined();
    expect(extractContent({})).toBeUndefined();
    expect(extractContent({ choices: [] })).toBeUndefined();
    expect(extractContent({ choices: 'nope' })).toBeUndefined();
    expect(extractContent({ choices: [null] })).toBeUndefined();
    expect(extractContent({ choices: [{ message: null }] })).toBeUndefined();
    expect(extractContent({ choices: [{ message: { content: 123 } }] })).toBeUndefined();
    expect(extractContent({ choices: [{ message: { content: null } }] })).toBeUndefined();
  });

  it('代理返回 200 + HTML 时也不会崩', () => {
    // 反向代理返回 200 但内容是登录页 —— 解析出来应是 undefined
    expect(extractContent({ error: 'unauthorized' })).toBeUndefined();
  });
});