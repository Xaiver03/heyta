/**
 * 批次 E2 —— 「账号已注销」必须**真的**清掉本机明文
 * ===================================================
 *
 * E1 让服务端把"账号没了"和"这枚令牌没了"分成两个码；E2 判的是客户端拿到码之后
 * **做了什么**。这一组里最贵的不是"没清"，而是**清错了对象**：
 *
 *   把 401（口令错 / 别的设备登出）读成注销 ⇒ 用户重登一次就发现自己的数据没了。
 *   把注销读成 401 ⇒ 明文永远留在这台机器上，而注销的法律承诺是"这台设备上的副本已清除"。
 *
 * 两个方向都是不可逆的，所以这里的判据成对出现：每一条"会清"的用例旁边都放着
 * 一条"不许清"的用例。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncClient } from '../src/client.js';

const BASE = 'https://sync.test';
const PASSWORD = 'correct horse';

interface HarnessOptions {
  onAccountClosed?: () => Promise<void>;
}

/** 只带必填回调的最小宿主；用例只关心错误分类与销毁动作。 */
function makeClient(handler: (url: string) => Response, opts: HarnessOptions = {}) {
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(init?.method === 'POST' ? `POST ${url}` : url);
    return handler(url);
  }) as unknown as typeof fetch;

  let cursor = 0;
  const client = new SyncClient({
    baseUrl: BASE,
    clientId: 'device-a',
    getToken: async () => 'test-token',
    getPassword: async () => PASSWORD,
    encryptionMode: 'password' as const,
    getLastServerSeq: async () => cursor,
    setLastServerSeq: async (s: number) => {
      cursor = s;
    },
    getLocalOps: async () => [],
    markUploaded: async () => undefined,
    applyRemote: async () => undefined,
    mergeRemoteClock: async () => undefined,
    redispatch: async () => undefined,
    discardLocal: async () => undefined,
    markRejected: async () => undefined,
    getOpsForEntity: async () => [],
    getOpById: async () => undefined,
    redispatchPayload: async () => undefined,
    fetchImpl,
    ...(opts.onAccountClosed === undefined ? {} : { onAccountClosed: opts.onAccountClosed }),
  });

  return { client, seen };
}

function closed(status: number, code: string | undefined, reason = 'Account closed'): Response {
  const body: Record<string, unknown> = { error: reason };
  if (code !== undefined) body.code = code;
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('E2 —— 码决定动作，状态码不决定', () => {
  it('410 + ACCOUNT_CLOSED ⇒ reason `account-closed`、不可重试、**销毁器被调用**', async () => {
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => closed(410, 'ACCOUNT_CLOSED'), { onAccountClosed: eraser });

    const status = await client.sync();

    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).toBe('account-closed');
    // 不可重试：账号不存在了，退避重敲只是噪音。
    expect(status.retryable).toBe(false);
    expect(eraser).toHaveBeenCalledTimes(1);
  });

  it('🔴 401 + TOKEN_REVOKED ⇒ `unauthorized`，销毁器**一次都不许调用**', async () => {
    // 这条是全组里唯一"判错就删用户数据"的方向：
    // 在别的设备点「登出所有设备」或改口令，拿到的就是 401。
    // 正确动作是"重新登录"，本地数据必须**完好**。
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => closed(401, 'TOKEN_REVOKED', 'Token revoked'), {
      onAccountClosed: eraser,
    });

    const status = await client.sync();

    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).toBe('unauthorized');
    expect(eraser, '把凭据失效读成注销 = 删掉了还在用的数据').not.toHaveBeenCalled();
  });

  it('an unrelated errorCode field cannot become an account-erasure signal', async () => {
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => Response.json({ errorCode: 'ACCOUNT_CLOSED' }, { status: 401 }), {
      onAccountClosed: eraser,
    });
    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).toBe('unauthorized');
    expect(eraser).not.toHaveBeenCalled();
  });

  it('🔴 401 + ACCOUNT_CLOSED 仍算注销（E1b 之前服务端就是回 401）', async () => {
    // 判定只认码。状态码从 401 换成 410 是**对外**语义（别重试），
    // 不是客户端识别注销的前提 —— 否则先发服务端、后发客户端的窗口里
    // 所有已注销设备都会静默留着明文。
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => closed(401, 'ACCOUNT_CLOSED'), {
      onAccountClosed: eraser,
    });

    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).toBe('account-closed');
    expect(eraser).toHaveBeenCalledTimes(1);
  });

  it('410 但**没有码** ⇒ 不许当成注销（未知资源不许触发销毁）', async () => {
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => closed(410, undefined, 'Gone'), {
      onAccountClosed: eraser,
    });

    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).not.toBe('account-closed');
    expect(eraser, '没有稳定码就删数据 = 任何 410 都能毁掉本机').not.toHaveBeenCalled();
  });

  /**
   * 🔴 除 `ACCOUNT_CLOSED` 外，**每一个**真实存在的令牌失效码都不许触发销毁。
   *
   * 这份清单的权威定义在 `server/src/auth.ts` 的 `TokenFailureCode`。
   * 这里**不是**穷尽性判据（上游加一个新码不会让本条变红，那是服务端
   * `account-closed-signal.spec.ts` 那边的事）；它是"误删方向"的取样：
   * 每一个码各自走一遍"401 + 文案里带 closed"这个最坏组合。
   */
  const OTHER_TOKEN_FAILURE_CODES = ['ACCOUNT_UNVERIFIED', 'TOKEN_REVOKED', 'TOKEN_INVALID'];

  it.each(OTHER_TOKEN_FAILURE_CODES)(
    '🔴 401 + %s（文案里还带着 "closed"）⇒ 不算注销、不销毁',
    async (code) => {
      // 这个仓库已经有两处栽在"对一句随时会变的中文/英文做正则"上（见 isNetworkError）。
      // 这里的下游动作是销毁，判据更不能长在人可读的字段上。
      const eraser = vi.fn(async () => undefined);
      const { client } = makeClient(
        () => closed(401, code, 'your account was closed per policy'),
        { onAccountClosed: eraser },
      );

      const status = await client.sync();
      expect(status.kind).toBe('error');
      if (status.kind !== 'error') return;
      expect(status.reason).toBe('unauthorized');
      expect(eraser).not.toHaveBeenCalled();
    },
  );
});

describe('E2 —— 处置结果必须进诊断，三种结局互相可分', () => {
  it('成功：说"已按宿主的销毁器清除"，**不**宣称彻底销毁', async () => {
    // ADR-0048 的分层实话：这次动作只覆盖本机副本。
    // 备份与其它设备有各自的边界（写在隐私政策里），这里越权承诺就是撒谎。
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => closed(410, 'ACCOUNT_CLOSED'), {
      onAccountClosed: eraser,
    });

    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.message).toContain('本机数据已按宿主的销毁器清除');
    expect(status.message).not.toMatch(/彻底销毁|已永久删除|所有数据都已删除/);
  });

  it('🔴 宿主没装销毁器：console.error 响 + message 明说「本机明文仍在」', async () => {
    // 批次 E 量的原始缺陷就是"信号收到了、没人清"，而它**一个字节都不报**。
    // 这条判据防的是同一件事的第二次发生：不是产品坏了，是宿主忘了接线。
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = makeClient(() => closed(410, 'ACCOUNT_CLOSED'));

    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.message).toContain('本机明文仍在');
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls.at(-1)?.[0])).toContain('销毁器');
  });

  it('销毁器抛错：不许吞，message 带原因并说"没能清干净"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const eraser = vi.fn(async () => {
      throw new Error('OPFS 里没有权限');
    });
    const { client } = makeClient(() => closed(410, 'ACCOUNT_CLOSED'), {
      onAccountClosed: eraser,
    });

    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    // 三种结局（没装 / 失败 / 成功）必须两两可分，否则界面与取证回答不了
    // "这台机器到底清了没有"。
    expect(status.message).toContain('没能清干净');
    expect(status.message).toContain('OPFS 里没有权限');
    expect(status.message).not.toContain('已按宿主的销毁器清除');
    expect(error).toHaveBeenCalled();
  });

  it('🔴 上报状态时销毁**已经完成**（不是发出去之后再补）', async () => {
    // 反过来的顺序会变成：界面已经显示"已清除"，磁盘上还留着明文。
    // 用户按界面上的话说下一步（比如把设备转卖），而那一步此时不安全。
    let cleared = false;
    const eraser = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      cleared = true;
    });
    const { client } = makeClient(() => closed(410, 'ACCOUNT_CLOSED'), {
      onAccountClosed: eraser,
    });

    const observed: boolean[] = [];
    await client.sync((status) => {
      if (status.kind === 'error' && status.reason === 'account-closed') observed.push(cleared);
    });

    expect(observed).toHaveLength(1);
    expect(observed[0], 'onStatus 收到时数据还没清 ⇒ 界面在说谎').toBe(true);
  });

  it('其它失败原因不许带销毁语义（message 里不许出现"已清除"）', async () => {
    const eraser = vi.fn(async () => undefined);
    const { client } = makeClient(() => closed(503, undefined, 'boom'), {
      onAccountClosed: eraser,
    });

    const status = await client.sync();
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') return;
    expect(status.reason).not.toBe('account-closed');
    expect(status.message).not.toContain('已按宿主的销毁器清除');
    expect(eraser).not.toHaveBeenCalled();
  });
});
