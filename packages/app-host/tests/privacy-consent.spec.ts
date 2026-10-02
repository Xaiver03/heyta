/**
 * 隐私同意闸门（链 5：G-11 / G-12）
 * ==================================
 *
 * 这个模块只有一个价值：**没同意就没有请求**。所以判据全部围着两件事转：
 *
 * 1. **默认关闭**：任何"读不到 / 读坏了 / 值不在词表里"的形状都必须落到"没有同意"。
 *    反过来的错法（把它当成同意）不是崩溃、不是红 —— 是**合规前提悄悄失效**，
 *    所以每一种形状都要单独来一条，而不是只测"正常值"。
 * 2. **闸门真的在链路上**：{@link createConsentGatedFetch} 那组断言的是
 *    "底层 fetch 被调了几次"，不是"抛了个错"。次数为 0 才是 G-12 要的判据
 *    （AGENTS.md §7 元规则 2：一条永远通过的判据比没有判据更糟）。
 *
 * ⚠️ 这里**不发任何网络请求**，也不起任何浏览器 —— 纯逻辑 + 注入端口。
 * 界面与真浏览器的判据在 `apps/web/tests/` 与 `e2e/` 那一层（任务 #10 / #12）。
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PRIVACY_CONSENT_BLOCKED_MARKER,
  PRIVACY_CONSENT_KEY,
  PRIVACY_DECISIONS,
  PrivacyConsentBlockedError,
  UNAVAILABLE_PRIVACY_CONSENT_PORT,
  createConsentGatedFetch,
  createPrivacyConsentGate,
  formatPrivacyDecisionTime,
  parsePrivacyConsent,
  privacyNetworkAllowed,
  serializePrivacyConsent,
  type PrivacyConsentPort,
} from '../src/privacy-consent.js';

/** 一个内存端口：两个 `*Fail` 开关用来复现"存储不可用"。 */
function memoryPort(options: {
  writesFail?: boolean;
  removesFail?: boolean;
  initial?: string;
} = {}): { port: PrivacyConsentPort; values: Map<string, string> } {
  const values = new Map<string, string>();
  if (options.initial !== undefined) values.set(PRIVACY_CONSENT_KEY, options.initial);
  return {
    values,
    port: {
      read: (key) => values.get(key),
      write: (key, value) => {
        if (options.writesFail === true) return false;
        values.set(key, value);
        return true;
      },
      remove: (key) => {
        // 🔴 报失败时**不动磁盘** —— "删不掉但值还在"才是撤回最需要复现的那一侧
        // （否则测的是"内存清了"，而不是"闸门压住了还活着的磁盘值"）。
        if (options.removesFail === true) return false;
        values.delete(key);
        return true;
      },
    },
  };
}

const FIXED_TIME = '2026-10-01T10:00:00.000Z';

describe('parsePrivacyConsent：不确定就当作没同意', () => {
  it('两个合法取值各自解析回原样', () => {
    for (const decision of PRIVACY_DECISIONS) {
      const raw = JSON.stringify({ decision, decidedAt: FIXED_TIME });
      expect(parsePrivacyConsent(raw)).toEqual({ decision, decidedAt: FIXED_TIME });
    }
  });

  it('键不存在 / 空串 / 坏 JSON / 数组 / 非对象 —— 一律 null', () => {
    expect(parsePrivacyConsent(undefined)).toBeNull();
    expect(parsePrivacyConsent('')).toBeNull();
    expect(parsePrivacyConsent('{"decision":')).toBeNull();
    expect(parsePrivacyConsent('[]')).toBeNull();
    expect(parsePrivacyConsent('"accepted"')).toBeNull();
    expect(parsePrivacyConsent('null')).toBeNull();
  });

  it('🔴 取值必须**逐字**在词表里：不做大小写、布尔、同义词的模糊匹配', () => {
    // 这一条拦的是"顺手写成 true / 'YES' / 'ACCEPTED'"这类看起来无害的宽松解析：
    // 同意是**明确的**意思表示（PIPL 第 14 条），把表外值猜成同意就是替用户作出同意。
    for (const lookalike of ['true', 'ACCEPTED', 'yes', 'agree', 'local_only', '', 'undefined']) {
      expect(parsePrivacyConsent(JSON.stringify({ decision: lookalike, decidedAt: FIXED_TIME }))).toBeNull();
    }
    // 非字符串的 decision 同样不认（布尔 false 尤其危险：它读起来像"不同意"，
    // 但把它猜成 local-only 会让"没问过"和"明确拒绝"混在一起，界面就不知道该不该弹）。
    for (const wrongType of [true, false, 1, 0, null]) {
      expect(parsePrivacyConsent(JSON.stringify({ decision: wrongType, decidedAt: FIXED_TIME }))).toBeNull();
    }
  });

  it('decidedAt 缺失或为空 → 整条无效（记录必须是收据，不能是半条）', () => {
    expect(parsePrivacyConsent(JSON.stringify({ decision: 'accepted' }))).toBeNull();
    expect(parsePrivacyConsent(JSON.stringify({ decision: 'accepted', decidedAt: '' }))).toBeNull();
    expect(parsePrivacyConsent(JSON.stringify({ decision: 'accepted', decidedAt: 1730000000000 }))).toBeNull();
  });

  it('⚠️ 多余字段仍然认：加字段不能把用户已经给出的同意作废', () => {
    const raw = JSON.stringify({ decision: 'accepted', decidedAt: FIXED_TIME, futureField: 42 });
    expect(parsePrivacyConsent(raw)).toEqual({ decision: 'accepted', decidedAt: FIXED_TIME });
  });

  it('序列化-解析回环（写进去的形状必须是读得回来的形状）', () => {
    const record = { decision: 'accepted' as const, decidedAt: FIXED_TIME };
    expect(parsePrivacyConsent(serializePrivacyConsent(record))).toEqual(record);
  });
});

describe('privacyNetworkAllowed：能不能出门', () => {
  it('只有 accepted 放行；local-only 与"没问过"都拦', () => {
    expect(privacyNetworkAllowed({ decision: 'accepted', decidedAt: FIXED_TIME })).toBe(true);
    expect(privacyNetworkAllowed({ decision: 'local-only', decidedAt: FIXED_TIME })).toBe(false);
    expect(privacyNetworkAllowed(null)).toBe(false);
  });

  it('🔴 但两者在"要不要弹面板"上必须给出不同答案（所以它不是 record !== null 的别名）', () => {
    const { port } = memoryPort();
    const asked = createPrivacyConsentGate(port);
    const refused = createPrivacyConsentGate(memoryPort().port);
    refused.decide('local-only', FIXED_TIME);
    expect(asked.undecided()).toBe(true);
    expect(refused.undecided()).toBe(false);
    expect(asked.networkAllowed()).toBe(false);
    expect(refused.networkAllowed()).toBe(false);
  });
});

describe('createPrivacyConsentGate：决定的落地与生效', () => {
  it('同意后落盘，且**新实例**（= 冷启动）读得到同一条', () => {
    const { port, values } = memoryPort();
    const gate = createPrivacyConsentGate(port);
    const readout = gate.decide('accepted', FIXED_TIME);

    expect(readout.persisted).toBe(true);
    expect(readout.record).toEqual({ decision: 'accepted', decidedAt: FIXED_TIME });
    expect(values.get(PRIVACY_CONSENT_KEY)).toBe(
      JSON.stringify({ decision: 'accepted', decidedAt: FIXED_TIME }),
    );
    // 冷启动复现：同一份存储、换一个 gate —— 这条钉的是"持久化的确实是存储而不是内存"。
    expect(createPrivacyConsentGate(port).networkAllowed()).toBe(true);
  });

  it('注入的时钟只在没给 nowIso 时兜底', () => {
    const gate = createPrivacyConsentGate(memoryPort().port, () => FIXED_TIME);
    expect(gate.decide('accepted').record.decidedAt).toBe(FIXED_TIME);
  });

  it('🔴 词表外的决定当场抛错，不写出一条读不回来的记录', () => {
    const { port, values } = memoryPort();
    const gate = createPrivacyConsentGate(port);
    expect(() => gate.decide('maybe' as 'accepted')).toThrow(/词表|可选/);
    expect(values.has(PRIVACY_CONSENT_KEY)).toBe(false);
  });

  it('⚠️ 写盘失败：本次会话仍然认这次同意，但 persisted=false', () => {
    // 拦的是两种相反的错法：
    //   - 当成"没同意" ⇒ 用户点了「同意并继续」而同步永远不开始（静默失效）；
    //   - 当成"记住了" ⇒ 界面在说谎，下次启动又弹一次，没人解释得清。
    const { port, values } = memoryPort({ writesFail: true });
    const gate = createPrivacyConsentGate(port);
    const readout = gate.decide('accepted', FIXED_TIME);

    expect(readout.persisted).toBe(false);
    expect(values.has(PRIVACY_CONSENT_KEY)).toBe(false);
    expect(gate.networkAllowed()).toBe(true);
    // 而冷启动确实不认（这就是界面必须提前说出口的那句"这台设备可能记不住"）。
    expect(createPrivacyConsentGate(port).networkAllowed()).toBe(false);
  });

  it('🔴 会话值优先于磁盘上的旧值：存储写不进去时新同意不能被旧决定盖掉', () => {
    const { port } = memoryPort({
      writesFail: true,
      initial: JSON.stringify({ decision: 'local-only', decidedAt: FIXED_TIME }),
    });
    const gate = createPrivacyConsentGate(port);
    expect(gate.networkAllowed()).toBe(false);
    gate.decide('accepted', FIXED_TIME);
    expect(gate.networkAllowed()).toBe(true);
  });

  it('撤回：清回"没问过"，闸门当场关闭', () => {
    const { port, values } = memoryPort();
    const gate = createPrivacyConsentGate(port);
    gate.decide('accepted', FIXED_TIME);
    expect(gate.networkAllowed()).toBe(true);

    expect(gate.revoke().persisted).toBe(true);
    expect(values.has(PRIVACY_CONSENT_KEY)).toBe(false);
    expect(gate.networkAllowed()).toBe(false);
    expect(gate.undecided()).toBe(true);
  });

  it('🔴 撤回落盘失败也必须当场关门（"界面说已撤回、请求照发"是唯一更坏的状态）', () => {
    const { port, values } = memoryPort({
      removesFail: true,
      initial: JSON.stringify({ decision: 'accepted', decidedAt: FIXED_TIME }),
    });
    const gate = createPrivacyConsentGate(port);
    expect(gate.networkAllowed()).toBe(true);

    expect(gate.revoke().persisted).toBe(false);
    expect(values.has(PRIVACY_CONSENT_KEY)).toBe(true); // 磁盘上那条还活着
    expect(gate.networkAllowed()).toBe(false); // 但本次会话绝不放行
    expect(gate.undecided()).toBe(true);
  });

  it('撤回之后再同意要能重新放行（撤回不是终身封条）', () => {
    const { port } = memoryPort();
    const gate = createPrivacyConsentGate(port);
    gate.decide('accepted', FIXED_TIME);
    gate.revoke();
    expect(gate.decide('accepted', FIXED_TIME).persisted).toBe(true);
    expect(gate.networkAllowed()).toBe(true);
  });

  it('存储永远不可用的端口：闸门关闭，decide 报 persisted=false', () => {
    const gate = createPrivacyConsentGate(UNAVAILABLE_PRIVACY_CONSENT_PORT);
    expect(gate.undecided()).toBe(true);
    expect(gate.networkAllowed()).toBe(false);
    expect(gate.decide('accepted', FIXED_TIME).persisted).toBe(false);
    // 与"写盘失败"同一口径：本会话认，冷启动不认。
    expect(gate.networkAllowed()).toBe(true);
    expect(createPrivacyConsentGate(UNAVAILABLE_PRIVACY_CONSENT_PORT).networkAllowed()).toBe(false);
  });
});

describe('createConsentGatedFetch：G-12 的判据本体（底层调用次数）', () => {
  /** 数得清次数的假 fetch：返回值也带标记，好确认"同意后确实透传了"。 */
  function countingFetch(): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response('sent'));
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('🔴 未同意：抛 PrivacyConsentBlockedError，而底层 fetch **一次都没被调用**', async () => {
    const { port } = memoryPort();
    const gate = createPrivacyConsentGate(port);
    const { fetchImpl, calls } = countingFetch();
    const gated = createConsentGatedFetch(fetchImpl, () => gate.networkAllowed());

    let caught: unknown;
    try {
      await gated('https://heyta.waytofuture.cn/api/sync/ops', { method: 'POST' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PrivacyConsentBlockedError);
    expect((caught as Error).message).toContain(PRIVACY_CONSENT_BLOCKED_MARKER);
    expect(calls).toEqual([]); // 这一行才是 G-12：不是"报错了"，是"一个字节都没发出去"
  });

  it('明确拒绝（local-only）同样零请求 —— 与"没问过"在链路上必须同一个答案', async () => {
    const gate = createPrivacyConsentGate(memoryPort().port);
    gate.decide('local-only', FIXED_TIME);
    const { fetchImpl, calls } = countingFetch();
    const gated = createConsentGatedFetch(fetchImpl, () => gate.networkAllowed());

    await expect(gated('https://example.test/api/notifications')).rejects.toBeInstanceOf(
      PrivacyConsentBlockedError,
    );
    expect(calls).toEqual([]);
  });

  it('同意后：原样透传，参数与响应都不动', async () => {
    const gate = createPrivacyConsentGate(memoryPort().port);
    gate.decide('accepted', FIXED_TIME);

    const seen: Array<{ input: unknown; init?: RequestInit }> = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input, init });
      return Promise.resolve(new Response('ok'));
    }) as typeof fetch;
    const gated = createConsentGatedFetch(fetchImpl, () => gate.networkAllowed());

    const response = await gated('https://example.test/api/sync/ops', {
      method: 'POST',
      body: '{}',
    });
    expect(await response.text()).toBe('ok');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.input).toBe('https://example.test/api/sync/ops');
    expect(seen[0]!.init?.method).toBe('POST');
  });

  it('闸门中途关门后立刻停止放行（撤回不需要重新加载页面）', async () => {
    const gate = createPrivacyConsentGate(memoryPort().port);
    gate.decide('accepted', FIXED_TIME);
    const { fetchImpl, calls } = countingFetch();
    const gated = createConsentGatedFetch(fetchImpl, () => gate.networkAllowed());

    await gated('https://example.test/a');
    gate.revoke();
    await expect(gated('https://example.test/b')).rejects.toBeInstanceOf(
      PrivacyConsentBlockedError,
    );
    expect(calls).toEqual(['https://example.test/a']);
  });

  it('⚠️ 拒绝原因里要能报出目标地址，且**以拒绝的 Promise** 而不是同步抛错', async () => {
    // 形状必须跟被替换的那个东西一致：真 fetch 从不同步抛，
    // 而调用点里确实有 `fetchImpl(...).catch(...)` 这种写法 —— 同步抛会逃过它。
    const gated = createConsentGatedFetch(countingFetch().fetchImpl, () => false);
    await expect(gated(new URL('https://example.test/c'))).rejects.toThrow(/example\.test\/c/);
    await expect(gated(new Request('https://example.test/d'))).rejects.toThrow(/example\.test\/d/);
  });
});

/**
 * 🔴 「什么时候作的决定」那一行 —— 它是**收据**，不是排版。
 *
 * 四个壳必须逐字说出同一个字符串：同一个决定在 web 上显示 `2026-09-30 21:04`、
 * 在移动端显示成本地时区的 `9/30/2026, 9:04 PM`，用户读到的是两次不同的决定。
 * 所以这一条判据钉的是**字节**，不是"看起来像个日期"。
 */
describe('formatPrivacyDecisionTime：四个壳共用的一行收据', () => {
  it('🔴 字节固定：`YYYY-MM-DD HH:mm`，不补零歧义、不本地化', () => {
    expect(formatPrivacyDecisionTime('2026-09-30T21:04:07.000Z')).toBe('2026-09-30 21:04');
    // 个位数的月/日/时/分：ISO 串本来就补零，这里不许出现 `9/30` 这类二次加工。
    expect(formatPrivacyDecisionTime('2026-01-09T05:07:59.999Z')).toBe('2026-01-09 05:07');
  });

  it('🔴 输出里**没有**时区标记 —— 这一行说的是 UTC 那一刻，界面上别读成本地时间', () => {
    const line = formatPrivacyDecisionTime('2026-09-30T21:04:07.000Z');
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 这三条不是仪式：只要有人"顺手"改成 `toLocaleString()`，`Z`/`+08:00`/本地
    // 时区就会带着运行环境漂移回来，而**四个壳会各自漂成不同的样子**。
    expect(line).not.toContain('Z');
    expect(line).not.toContain('+');
  });

  /**
   * 🔴 源码级判据：这一行**不许**改成 `Intl` / `toLocaleString`。
   *
   * 为什么行为判据不够：`Intl` 在开发机上永远"工作正常"，而它破坏的是两个
   * 看不见它的地方 —— Hermes（`Intl` 是可选编译的，拿不到时**直接抛**，
   * 症状是设置页整页打不开）与这条判据本身（输出随环境变 ⇒ 断言挂在开发机配置上）。
   * 只能钉在写法上。⚠️ 必须先去掉注释再匹配：文件头的说明里就写着 `Intl` 两个字，
   * 不去注释这条判据**永远红**。
   */
  it('🔴 实现里不出现 Intl / toLocaleString（移动端会抛，判据会随环境漂）', () => {
    const src = readFileSync(new URL('../src/privacy-consent.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1');
    const at = src.indexOf('export function formatPrivacyDecisionTime');
    expect(at, '这个格式化函数被挪走或改名了 —— 四个壳会各自长回一套').toBeGreaterThanOrEqual(0);
    const body = src.slice(at, at + 400);
    expect(/Intl/.test(body)).toBe(false);
    expect(/toLocale\w+/.test(body)).toBe(false);
  });

  it('与裁决无关：`decidedAt` 只用于展示，改时间不影响"能不能出门"', () => {
    const { port } = memoryPort();
    const gate = createPrivacyConsentGate(port);
    gate.decide('local-only', '2020-01-01T00:00:00.000Z');
    expect(gate.networkAllowed()).toBe(false);
    expect(formatPrivacyDecisionTime(gate.current()!.decidedAt)).toBe('2020-01-01 00:00');
  });
});
