/**
 * 账号级"重新确认"闸门（G-27 的**客户端执行层**）
 * =============================================
 *
 * 服务端那一刀证明的是"裁决算得对"（`server/tests/legal-recheck*.spec.ts`）。
 * 本文件证明另一半，也是那句对外承诺真正缺的那一半：
 * **算出来"要补签"之后，数据真的没有出门。**
 *
 * ## 判据围着三件事转
 *
 * 1. **拦得住**：`needs-reconfirm` 与 `checking` 两种状态下 `dataEgressAllowed()` 必须是
 *    `false`。`checking` 这一条最容易被"顺手优化掉"（看着只是"还没问到答案"），
 *    而它恰好是启动竞态的落点：自动同步在冷启动就会跑。拦不住的话每次都是
 *    **先把数据推出去、再收到"你要补签"**，那道闸就只剩弹个窗。
 * 2. **不误伤**：服务端答 `current` 时**一个面板都不许出现**。注册期已同意当前版本的
 *    人是绝大多数，每次都拦等于把承诺变成骚扰。
 * 3. **不谎报**：问不到（离线 / 5xx / 形状不对 / 令牌过期）时**不拦、也不弹** ——
 *    我们从没把任何条款指给那个人看，弹一句"你需要同意条款"的每个字都是假的。
 *    方向与链 5 的 fail-closed 相反，理由见 `legal-recheck.ts` 文件头那张对照表；
 *    这里对**同一个闸门**造两条相反方向的正对照，防止有人以后"统一成关闭"。
 *
 * ## 不发任何真请求、不起浏览器
 *
 * 纯逻辑 + 注入 `fetch` 替身。界面与真浏览器的判据在 `apps/web/tests/` 与 `e2e/`。
 */

import { describe, expect, it } from 'vitest';

import { createLegalRecheckGate, type LegalRecheckPorts } from '../src/legal-recheck.js';
import {
  LEGAL_CONSENT_REASONS,
  parseLegalConsentStatus,
  type LegalConsentStatus,
} from '../src/hosted-auth.js';

const BASE = 'https://heyta.example.test';
const PATH = '/api/account/legal-consent';
const NEW = 'terms@1.2;privacy@1.0';
const OLD = 'terms@1.1;privacy@1.0';

interface Recorded {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

/** 一个由用例决定什么时候答的复现器。 */
type Responder = (req: Recorded) => Promise<Response> | Response;
type Reply = { status: number; body: unknown } | { throw: true } | Responder;

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const asResponder = (reply: Reply): Responder => {
  if (typeof reply === 'function') return reply;
  if ('throw' in reply) {
    return async () => {
      throw new Error('网络层抛错');
    };
  }
  return async () => json(reply.status, reply.body);
};

function harness(
  replies: Reply[],
  overrides: Partial<LegalRecheckPorts> = {},
): { gate: ReturnType<typeof createLegalRecheckGate>; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const queue = replies.map(asResponder);

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req: Recorded = {
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : String(input),
      authorization: new Headers(init?.headers ?? {}).get('authorization'),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    requests.push(req);
    const responder = queue.shift();
    // 队列空 ⇒ 响亮地炸，而不是回一个 200：回 200 会把"多发了一次请求"
    // 伪装成"那次请求成功了"，而本文件最要紧的判据恰恰是次数与顺序。
    if (responder === undefined) throw new Error(`没有为第 ${requests.length} 个请求准备答复`);
    return responder(req);
  }) as unknown as typeof fetch;

  const ports: LegalRecheckPorts = {
    getToken: () => 'TK-1',
    getBaseUrl: () => BASE,
    fetchImpl,
    now: () => 1_800_000_000_000,
    ...overrides,
  };
  return { gate: createLegalRecheckGate(ports), requests };
}

const status = (over: Partial<LegalConsentStatus> = {}): LegalConsentStatus => ({
  needsReconfirm: false,
  reason: 'current',
  currentVersion: NEW,
  recordedVersion: NEW,
  ...over,
});

const NEEDS = status({
  needsReconfirm: true,
  reason: 'version-changed',
  recordedVersion: OLD,
});

describe('读侧：问一次，按答案决定拦不拦', () => {
  it('🔴 请求打在**这一条路径**上：方法 GET、URL 逐字、带 Bearer', async () => {
    const { gate, requests } = harness([{ status: 200, body: status() }]);
    await gate.refresh();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${BASE}${PATH}`, authorization: 'Bearer TK-1' });
  });

  it('没有令牌 ⇒ **一个请求都不发**、不拦、不弹（也没东西可同步）', async () => {
    const { gate, requests } = harness([], { getToken: () => undefined });
    await gate.refresh();
    expect(requests).toHaveLength(0);
    expect(gate.current().phase).toBe('anonymous');
    expect(gate.dataEgressAllowed()).toBe(true);
    expect(gate.shouldShowSheet()).toBe(false);
  });

  it('🔴 服务端说要补签 ⇒ 数据**不许**出门、面板要弹、两版都带回来', async () => {
    const { gate } = harness([{ status: 200, body: NEEDS }]);
    await gate.refresh();
    expect(gate.dataEgressAllowed()).toBe(false);
    expect(gate.shouldShowSheet()).toBe(true);
    expect(gate.current()).toEqual({
      phase: 'needs-reconfirm',
      reason: 'version-changed',
      currentVersion: NEW,
      recordedVersion: OLD,
      confirmFailure: null,
    });
  });

  it('🔴 防误伤：已同意当前版本 ⇒ 不拦，且**一个面板都不许出现**', async () => {
    const { gate } = harness([{ status: 200, body: status() }]);
    await gate.refresh();
    expect(gate.dataEgressAllowed()).toBe(true);
    expect(gate.shouldShowSheet()).toBe(false);
    expect(gate.current().phase).toBe('clear');
  });

  it('🔴 答案还在路上时就是拦的（挡的是冷启动那一次抢跑的同步）', async () => {
    const gateAnswers = deferred();
    let arrived = (): void => {};
    const arrivedSignal = new Promise<void>((r) => {
      arrived = r;
    });
    const { gate } = harness([
      async () => {
        arrived();
        await gateAnswers.promise;
        return json(200, status());
      },
    ]);
    const done = gate.refresh();
    await arrivedSignal;
    expect(gate.current().phase).toBe('checking');
    expect(gate.dataEgressAllowed()).toBe(false);
    // 但**不许**弹面板：还不知道要不要，弹一个可能永远不消失的东西是错的。
    expect(gate.shouldShowSheet()).toBe(false);
    gateAnswers.resolve();
    await done;
    expect(gate.dataEgressAllowed()).toBe(true);
  });

  it('🔴 问不到 ⇒ **放行**且**不弹**（三种问不到的形态各来一遍）', async () => {
    for (const [label, reply] of [
      ['5xx', { status: 500, body: { error: 'boom' } }],
      ['网络层抛错', { throw: true }],
      ['形状不对', { status: 200, body: { unexpected: 'shape' } }],
      ['词表外的原因码', { status: 200, body: status({ reason: 'brand-new' as never }) }],
    ] as const) {
      const { gate } = harness([reply as Reply]);
      await gate.refresh();
      expect({ label, phase: gate.current().phase }).toEqual({ label, phase: 'unavailable' });
      expect(gate.dataEgressAllowed()).toBe(true);
      expect(gate.shouldShowSheet()).toBe(false);
    }
  });

  it('令牌不被认得 ⇒ `anonymous`，不是"要补签"（同步那边自会说"要重新登录"）', async () => {
    const { gate } = harness([{ status: 401, body: { error: 'unauthorized' } }]);
    await gate.refresh();
    expect(gate.current().phase).toBe('anonymous');
    expect(gate.shouldShowSheet()).toBe(false);
  });

  it('🔴 晚到的旧答案不许覆盖新状态（否则刚确认完又被旧版本弹回去）', async () => {
    const slow = deferred();
    let slowArrived = (): void => {};
    const slowArrivedSignal = new Promise<void>((r) => {
      slowArrived = r;
    });
    const { gate, requests } = harness([
      async () => {
        slowArrived();
        await slow.promise;
        return json(200, NEEDS);
      },
      { status: 200, body: status() },
    ]);
    const slowRound = gate.refresh();
    await slowArrivedSignal;
    // 令牌刷新/重登之后立刻重问，而它**先**答完。
    await gate.refresh();
    expect(gate.current().phase).toBe('clear');
    slow.resolve();
    await slowRound;
    expect(gate.current().phase).toBe('clear');
    expect(requests.map((r) => r.method)).toEqual(['GET', 'GET']);
  });

  it('登出 ⇒ `reset()` 当场清回 anonymous，不许留着上一个人的答案', async () => {
    const { gate } = harness([{ status: 200, body: NEEDS }]);
    await gate.refresh();
    expect(gate.dataEgressAllowed()).toBe(false);
    let notified = 0;
    const stop = gate.subscribe(() => notified++);
    gate.reset();
    stop();
    expect(gate.current()).toEqual({
      phase: 'anonymous',
      reason: null,
      currentVersion: null,
      recordedVersion: null,
      confirmFailure: null,
    });
    expect(notified).toBe(1);
    gate.reset();
    expect(notified).toBe(1);
  });
});

describe('写侧：只有"看完并确认"这一个动作能调它', () => {
  it('🔴 发出去的 `documentVersion` **逐字等于读侧带回的那一版**，且带 Bearer', async () => {
    const { gate, requests } = harness([
      { status: 200, body: NEEDS },
      { status: 200, body: { ok: true, recordedVersion: NEW } },
    ]);
    await gate.refresh();
    await gate.confirm();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ method: 'POST', url: `${BASE}${PATH}`, authorization: 'Bearer TK-1' });
    expect(requests[1]!.body).toEqual({ documentVersion: NEW, acceptedAt: 1_800_000_000_000 });
  });

  it('确认成功 ⇒ 闸门放开、面板收起、订阅者收到通知', async () => {
    const { gate } = harness([
      { status: 200, body: NEEDS },
      { status: 200, body: { ok: true, recordedVersion: NEW } },
    ]);
    await gate.refresh();
    const seen: string[] = [];
    gate.subscribe(() => seen.push(gate.current().phase));
    await gate.confirm();
    expect(gate.current().phase).toBe('clear');
    expect(gate.dataEgressAllowed()).toBe(true);
    expect(gate.shouldShowSheet()).toBe(false);
    expect(seen).toEqual(['clear']);
  });

  it('🔴 确认**失败**时闸门仍拦着（不许把"没提交成功"演成"已经确认过"）', async () => {
    const { gate } = harness([{ status: 200, body: NEEDS }, { throw: true }]);
    await gate.refresh();
    await gate.confirm();
    expect(gate.current().phase).toBe('needs-reconfirm');
    expect(gate.dataEgressAllowed()).toBe(false);
    expect(gate.shouldShowSheet()).toBe(true);
    expect(gate.current().confirmFailure).toBe('network');
  });

  it('服务端这期间又改版（409 version_mismatch）⇒ **重新问一次**，不再发一遍旧版', async () => {
    const { gate, requests } = harness([
      { status: 200, body: NEEDS },
      { status: 409, body: { error: 'version_mismatch', code: 'version_mismatch' } },
      { status: 200, body: status({ needsReconfirm: true, reason: 'version-changed' }) },
    ]);
    await gate.refresh();
    await gate.confirm();
    // 第三次是新的 GET；那次 409 之后**没有**第二个 POST。
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST', 'GET']);
    expect(gate.dataEgressAllowed()).toBe(false);
    expect(gate.current().phase).toBe('needs-reconfirm');
  });

  it('自建实例答 409 instance_cannot_name_text ⇒ 本机制对它整体不适用（clear）', async () => {
    const { gate } = harness([
      { status: 200, body: NEEDS },
      { status: 409, body: { error: 'instance_cannot_name_text', code: 'instance_cannot_name_text' } },
    ]);
    await gate.refresh();
    await gate.confirm();
    expect(gate.current().phase).toBe('clear');
    expect(gate.dataEgressAllowed()).toBe(true);
  });

  it('🔴 还没问过（currentVersion 为 null）时 confirm() **一个请求都不发**', async () => {
    const { gate, requests } = harness([]);
    await gate.confirm();
    expect(requests).toHaveLength(0);
    expect(gate.current().phase).toBe('anonymous');
  });

  it('时钟给出小数 / 0 / 负数 ⇒ 发出去的 `acceptedAt` 仍是正整数（服务端会拒非正数）', async () => {
    for (const [clock, expected] of [
      [1_780.7, 1_780],
      [-5, 1],
      [0, 1],
    ] as const) {
      const { gate, requests } = harness(
        [{ status: 200, body: NEEDS }, { status: 200, body: { ok: true, recordedVersion: NEW } }],
        { now: () => clock },
      );
      await gate.refresh();
      await gate.confirm();
      const body = requests[1]!.body as { acceptedAt: number };
      expect({ clock, acceptedAt: body.acceptedAt }).toEqual({ clock, acceptedAt: expected });
    }
  });
});

describe('订阅与响应形状', () => {
  it('一个订阅者抛错不许影响其余的（这条通知驱动实时通道重建）', async () => {
    const { gate } = harness([{ status: 200, body: NEEDS }]);
    let second = 0;
    gate.subscribe(() => {
      throw new Error('订阅者炸了');
    });
    gate.subscribe(() => {
      second++;
    });
    await gate.refresh();
    // 两次通知 = `anonymous → checking` 与 `checking → needs-reconfirm`。
    // 第一个订阅者每次都在同一批里抛错，第二个必须照样收满（否则实时通道会停在旧状态）。
    expect(second).toBe(2);
  });

  it('同一个状态重复落回时不重复通知（否则每问一次白断一次实时连接）', async () => {
    const { gate } = harness([
      { status: 200, body: status() },
      { status: 200, body: status() },
    ]);
    await gate.refresh();
    const seen: string[] = [];
    gate.subscribe(() => seen.push(gate.current().phase));
    await gate.refresh();
    // checking → clear 两步各通知一次；停在 clear 的那一步**不再**多通知。
    expect(seen).toEqual(['checking', 'clear']);
  });

  it('🔴 `parseLegalConsentStatus`：词表外与缺字段都判 null，绝不当成功', () => {
    expect([...LEGAL_CONSENT_REASONS]).toEqual([
      'current',
      'version-changed',
      'unprovable',
      'not-applicable',
    ]);
    expect(parseLegalConsentStatus(status())).toEqual(status());
    // 服务端以后加一个原因码 ⇒ null（→ `unavailable` → 不拦、不弹），
    // 而不是"某种大概不需要确认的原因"。漏拦比多拦一次严重。
    expect(parseLegalConsentStatus(status({ reason: 'brand-new' as never }))).toBeNull();
    expect(
      parseLegalConsentStatus({ reason: 'current', currentVersion: null, recordedVersion: null }),
    ).toBeNull();
    expect(parseLegalConsentStatus({ ...status(), needsReconfirm: 'true' })).toBeNull();
    expect(parseLegalConsentStatus({ ...status(), currentVersion: 42 })).toBeNull();
    expect(parseLegalConsentStatus(null)).toBeNull();
    expect(parseLegalConsentStatus('[]')).toBeNull();
    // `not-applicable` 那一版**允许**是 null —— 那台实例没有可宣告的版本，是合法形状。
    expect(
      parseLegalConsentStatus({
        needsReconfirm: false,
        reason: 'not-applicable',
        currentVersion: null,
        recordedVersion: null,
      }),
    ).toEqual({
      needsReconfirm: false,
      reason: 'not-applicable',
      currentVersion: null,
      recordedVersion: null,
    });
    // 多余字段照收（向前兼容），与 `parsePrivacyConsent` 同一条理由。
    expect(parseLegalConsentStatus({ ...status(), futureField: 1 })).not.toBeNull();
  });
});
