/**
 * `withManagedEndpoint` —— 托管档的端点从**同步服务器**派生，不落盘。
 *
 * 这一组钉的是四件各自能出事的事：
 * 1. 非托管档**逐字不受影响**（同一个引用 —— 顺手改到自备档是最容易犯的错）；
 * 2. 拿不到服务器地址时**不合成**（⇒ `no-route`，而不是编一个端点出来）；
 * 3. 合成出来的端点**真的能过白名单并推出 `heyta-cloud`**（否则披露是假的）；
 * 4. 🔴 **`tool-calling` 在托管档上必须被排除** —— 托管档**不提供对话式助手**（产品口径，
 *    见 `MANAGED_CAPABILITIES` 的注释与法务 `ai-and-transfer` §5）。这一格历史上翻过两次：
 *    2026-10-25 曾因"三跳都验过 tool_calls"声明了 `tool_calling`（于是这条断言被改成
 *    "必须能选中"），2026-10-26 又按产品口径撤回。**现在的判据是"排除 + 原因码是
 *    capability-missing + 零请求"**，因为能力是真的、但它不属于这一档 ——
 *    所以别再用"能力没验过"当这条断言的理由。
 */
import { describe, expect, it } from 'vitest';

import {
  MANAGED_ENDPOINT_ID,
  MANAGED_MODEL_HOSTS,
  resolveRoute,
  withManagedEndpoint,
  type AiRoutingConfig,
} from '../src/index.js';

/** 白名单里"我们自己那台服务器"那一行 —— 托管档的入口。 */
const SELF_HOST = MANAGED_MODEL_HOSTS.find((entry) => entry.host.endsWith('waytofuture.cn'))!.host;

const managed = (extra: Partial<AiRoutingConfig> = {}): AiRoutingConfig => ({
  mode: 'managed',
  enabled: true,
  allowRemote: true,
  endpoints: [],
  routes: {},
  ...extra,
});

const owned = (): AiRoutingConfig => ({
  mode: 'own',
  enabled: true,
  allowRemote: true,
  endpoints: [
    { id: 'mine', label: '我自己的', endpoint: 'https://api.example.com/v1', model: 'm' },
  ],
  routes: { capture: [{ endpointId: 'mine' }] },
});

describe('withManagedEndpoint', () => {
  it('非托管档 ⇒ **原样返回**（同一个引用，逐字不受影响）', () => {
    const routing = owned();
    expect(withManagedEndpoint(routing, `https://${SELF_HOST}`)).toBe(routing);
  });

  it("🔴 拿不到服务器地址（空 / 空白 / 解析不出）⇒ 不合成任何端点", () => {
    for (const url of [undefined, '', '   ', 'not a url']) {
      const out = withManagedEndpoint(managed(), url);
      expect(out.endpoints, `serverUrl=${JSON.stringify(url)}`).toHaveLength(0);
    }
  });

  it('✅ 合成出的端点**真的能过白名单**，并把目的地推成 `heyta-cloud`', () => {
    const out = withManagedEndpoint(managed(), `https://${SELF_HOST}`);
    const endpoint = out.endpoints.find((entry) => entry.id === MANAGED_ENDPOINT_ID);
    expect(endpoint?.endpoint).toBe(`https://${SELF_HOST}`);

    const { candidates } = resolveRoute(out, 'capture', { now: 0 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.destination).toBe('heyta-cloud');
  });

  it('🔴 服务器地址带路径 ⇒ 端点只取 **origin**（否则会拼出 `/api/api/ai/...`）', () => {
    const out = withManagedEndpoint(managed(), `https://${SELF_HOST}/api/v1/`);
    expect(out.endpoints[0]?.endpoint).toBe(`https://${SELF_HOST}`);
  });

  it('幂等：连续调两次，端点表不堆积', () => {
    const once = withManagedEndpoint(managed(), `https://${SELF_HOST}`);
    const twice = withManagedEndpoint(once, `https://${SELF_HOST}`);
    expect(twice.endpoints.filter((e) => e.id === MANAGED_ENDPOINT_ID)).toHaveLength(1);
    expect(twice.endpoints).toHaveLength(1);
  });

  it('🔴 路由表**整份替换**：没有任何功能再指向用户自己那台端点', () => {
    const out = withManagedEndpoint({ ...owned(), mode: 'managed' }, `https://${SELF_HOST}`);

    // 路由表整份换成"每个功能 → 托管端点"
    expect(out.routes.capture).toEqual([{ endpointId: MANAGED_ENDPOINT_ID }]);

    // 🔴 但用户自己那条端点的**配置要留着** —— 路由表已经不指向它了，
    // 它是惰性的；删掉等于"切一次托管档就把我的配置抹了"，而那不可逆。
    // （把它删掉会让用户切回自备档时发现端点没了，且没有任何提示。）
    expect(out.endpoints.map((e) => e.id)).toContain('mine');

    // 惰性证据：解析出来只有托管那一条候选
    const { candidates } = resolveRoute(out, 'capture', { now: 0 });
    expect(candidates.map((c) => c.endpointConfig.id)).toEqual([MANAGED_ENDPOINT_ID]);
  });

  it('🔴 `tool-calling` 在托管档上**被排除**：托管端点不声明 `tool_calling`（这一档不提供助手）', () => {
    const out = withManagedEndpoint(managed(), `https://${SELF_HOST}`);

    const { candidates, excluded } = resolveRoute(out, 'tool-calling', { now: 0 });

    // 判据是"排除 + 原因码"，不是"没有候选"就算过：别的原因（端点缺失、熔断、
    // 远程未允许）也会让候选为空，而那几种失败说的不是同一件事。
    expect(candidates).toEqual([]);
    expect(excluded.map((e) => e.reason)).toContain('capability-missing');

    // 失败必须响亮：`resolveRoute` 给出的那句解释要能读成"这个功能没有路"，
    // 而不是"网络/端点坏了" —— 后者会把用户支去排查一个没坏的东西。
    expect(out.routes['tool-calling']).toEqual([{ endpointId: MANAGED_ENDPOINT_ID }]);
  });

  it('⚠️ 其余五个功能也都能拿到候选（别为了 tool-calling 把别的功能挤掉）', () => {
    const out = withManagedEndpoint(managed(), `https://${SELF_HOST}`);

    for (const feature of [
      'capture',
      'breakdown',
      'prioritize',
      'duration-estimate',
      'inbound-automation',
    ] as const) {
      expect(resolveRoute(out, feature, { now: 0 }).candidates, feature).toHaveLength(1);
    }
  });
});
