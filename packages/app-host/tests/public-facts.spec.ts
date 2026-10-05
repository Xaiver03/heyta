/**
 * 公共事实下行的客户端半（W4b，判据①与"匿名"这条边界的客户端侧）
 * =====================================================================
 *
 * 服务端那一侧由 `scripts/check-public-facts.mjs` 钉着；这里钉的是**发请求的这一方**：
 *
 * · **匿名**：不许带 `authorization`、不许带 cookie，且条件请求命中 304 时也不许变成带身份。
 *   ADR-0052 §2.1 那句"唯一可判的边界"如果只在服务端判，客户端只要肯塞一个 token 进去，
 *   这条通道就立刻变成"按人下发"了 —— 所以两边都要有牙齿。
 * · **判据①**：拿不到 / 没缓存 / 服务端说谎，四种情况界面上都**不许**变成"日历上少了一块"。
 *   这一条在本文件里测到"缓存不动 + 返回可观测的 cause"，界面那一腿在 web 侧的截图验收里。
 *
 * 夹具是**手写的合法 body**（过契约），不是从服务端产物抄的 —— 抄一份服务端形状
 * 就等于用服务端当自己的判据（本仓那条"从产物取就是自我循环论证"）。
 */
import { describe, expect, it } from 'vitest';

import { META_KEYS } from '@heyta/storage';
import { HOLIDAY_ADJUSTMENT_PATHS, PUBLIC_FACT_SHAPES } from '@heyta/shared-schema';
import {
  adjustmentOn,
  clearHolidayAdjustmentOverrides,
  holidayAdjustmentSource,
  holidayCoverage,
  holidayPapersFor,
} from '@heyta/domain';

import {
  installPublicFactsFromCache,
  readPublicFactsCache,
  refreshPublicFacts,
  type PublicFactsCachePort,
} from '../src/public-facts.js';

const HOLIDAY_PUBLIC_PATH = '/api/holiday-adjustments';

// ── 夹具 ────────────────────────────────────────────────────────────

/**
 * 缓存端口 = `OpLogStore` 上那对 META 读写（`getMetaValue` / `setMetaValue`）。
 *
 * 🔴 这里刻意**不收 `DbAdapter`**：web 默认存储路径（Worker + OPFS SQLite）与桌面壳路径
 * 在页侧都拿不到 `DbAdapter`，只有 store 代理。用 `DbAdapter` 当端口，"接上了"这件事
 * 会在这两条路径上静默为假 —— 而那正是判据①要防的形状。
 * 端口只有这两个方法 —— 模块若多要存储能力（比如去碰 op-log），**编译期就过不去**，
 * 比运行时的"调到就抛"探针更硬。
 */
function fakeCache(): PublicFactsCachePort & { values: Map<string, string | number> } {
  const values = new Map<string, string | number>();
  return {
    values,
    getMetaValue: async (key: string) => values.get(key),
    setMetaValue: async (key: string, value: string | number) => {
      values.set(key, value);
    },
  };
}

const YEAR = 2027;
const BODY = {
  version: '1730000000000.1.2',
  years: [
    {
      year: YEAR,
      papers: ['https://www.gov.cn/gongshu/example-2027'],
      days: [
        { day: '2027-01-02', isOffDay: true },
        { day: '2027-02-20', isOffDay: false },
      ],
    },
  ],
};

/**
 * 桩的签名必须与 `typeof fetch` 兼容（`input` 是 `string | URL | Request`）。
 * 手写 `(url: string)` 的桩在 vitest 里跑得出读数、`tsc -p tsconfig.spec.json` 会红，
 * 而"改成 `as typeof fetch` 硬转"会把真实调用方传 `URL` 的那条路藏起来 —— 所以
 * 桩照实收 `RequestInfo`，取 URL 时归一化。
 */
type FetchImpl = typeof fetch;

const urlOf = (input: URL | RequestInfo): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/** 一把抓到 body 并回 200。 */
function fetchJson(body: unknown = BODY, status = 200) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const impl: FetchImpl = async (input, init) => {
    seen.push({ url: urlOf(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, seen };
}

function fetchThrows() {
  const seen: string[] = [];
  const impl: FetchImpl = async (input) => {
    seen.push(urlOf(input));
    throw new TypeError('fetch failed');
  };
  return { impl, seen };
}

function fetchStatus(status: number) {
  const impl: FetchImpl = async () => new Response('{}', { status });
  return { impl };
}

const configured = (cache: PublicFactsCachePort, fetchImpl: typeof fetch, log?: (m: string) => void) => ({
  baseUrl: 'http://127.0.0.1:3100',
  cache,
  fetchImpl,
  ...(log === undefined ? {} : { log }),
});

// ── 判据 ────────────────────────────────────────────────────────────

describe('公共事实的下行（客户端半）', () => {
  it('🔴 匿名：不发 authorization、不发 cookie，且显式 credentials: omit', async () => {
    const cache = fakeCache();
    const { impl, seen } = fetchJson();

    const result = await refreshPublicFacts(configured(cache, impl));

    expect(result.kind).toBe('ok');
    expect(seen.length).toBe(1);
    const headers = (seen[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).filter((k) => /^(authorization|cookie|x-heyta)/i.test(k)), `请求头里出现了凭据：${Object.keys(headers).join(', ')}`).toEqual([]);
    expect(seen[0]!.init?.credentials, 'credentials 没写死成 omit —— 默认值随实现变，而"匿名"是这条通道存在的前提').toBe('omit');
    expect(seen[0]!.url).toContain(HOLIDAY_PUBLIC_PATH);
  });

  it('🔴 客户端请求的路径必须逐字等于契约注册的那条（第一版就是少了一层 /api 而界面完全看不出来）', async () => {
    const cache = fakeCache();
    const { impl, seen } = fetchJson();

    await refreshPublicFacts(configured(cache, impl));

    const registered = PUBLIC_FACT_SHAPES.find((s) => s.id === HOLIDAY_ADJUSTMENT_PATHS.public)?.path;
    expect(registered, '契约注册表里找不到这一条 shape —— 服务端与客户端已经不在同一条路径上了').toBeDefined();
    // 前缀住在服务端的 `register(…, { prefix: '/api' })`，路径住在契约：
    // 客户端任何一次"顺手写个字符串"都会把它变成一条 404 的静默降级。
    expect(registered).toBe('/api/holiday-adjustments');
    expect(seen.length).toBe(1);
    expect(seen[0]!.url.endsWith(registered as string), `请求发到了 ${seen[0]!.url}，契约注册的是 ${String(registered)}`).toBe(true);
  });

  it('判据④第一分支走通到读侧：拉下来的覆盖真的改答 `adjustmentOn`，出处也在', async () => {
    const cache = fakeCache();
    const { impl } = fetchJson();

    const result = await refreshPublicFacts(configured(cache, impl));
    expect(result.kind).toBe('ok');

    // 随包表里没有 2027 这一年 —— 下面三个读数只可能来自部署方下发的覆盖。
    expect(adjustmentOn('2027-01-02')).toBe('off');
    expect(adjustmentOn('2027-02-20')).toBe('work');
    expect(adjustmentOn('2027-01-01')).toBeUndefined();
    expect(holidayPapersFor(YEAR)).toEqual(['https://www.gov.cn/gongshu/example-2027']);
  });

  it('未配置：baseUrl 为空时**一个请求都不发**（自托管不该因此产生流量）', async () => {
    const cache = fakeCache();
    const { impl, seen } = fetchJson();

    const result = await refreshPublicFacts({ baseUrl: '   ', cache, fetchImpl: impl });

    expect(result.kind).toBe('unconfigured');
    expect(seen.length, `未配置却还是发了 ${String(seen.length)} 个请求`).toBe(0);
  });

  it('判据②客户端那半：papers 跟着数据一路装进领域层，界面才可能在标注"休/班"的同时给出出处', async () => {
    const cache = fakeCache();
    const { impl } = fetchJson();

    const result = await refreshPublicFacts(configured(cache, impl));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.installed.length).toBe(1);
    expect(result.installed[0]?.kind, 'domain 那一层的词表是 accepted/rejected，不是 installed').toBe('accepted');
    expect(result.snapshot.years[0]?.papers).toEqual(['https://www.gov.cn/gongshu/example-2027']);

    const cached = await readPublicFactsCache(cache);
    expect(cached?.years[0]?.papers, '缓存把 papers 弄丢了 —— 那界面就只能画标记、给不出出处').toEqual(BODY.years[0]!.papers);
  });

  it('条件请求：第二次带上第一次的 version，命中 304 时缓存一个字都不改写', async () => {
    const cache = fakeCache();
    const first = fetchJson();
    await refreshPublicFacts(configured(cache, first.impl));
    const writesBefore = JSON.stringify([...cache.values.entries()]);

    const seen: RequestInit[] = [];
    const second: FetchImpl = async (_input, init) => {
      seen.push(init ?? {});
      return new Response(null, { status: 304 });
    };

    const result = await refreshPublicFacts(configured(cache, second));

    expect(result.kind).toBe('not-modified');
    expect((seen[0]?.headers as Record<string, string>)?.['if-none-match']).toBe(BODY.version);
    expect(JSON.stringify([...cache.values.entries()]), '304 之后缓存被改写过了 —— 那条件请求就省不了任何东西').toBe(writesBefore);
  });

  it('🔴 服务端说谎（200 但过不了契约）：坏数据**不许**挤掉一份能用的好缓存', async () => {
    const cache = fakeCache();
    const good = fetchJson();
    await refreshPublicFacts(configured(cache, good.impl));
    const goodCached = await readPublicFactsCache(cache);
    expect(goodCached).toBeDefined();

    const logs: string[] = [];
    // `2027-02-30` 过得了正则但不是那一天 —— 契约那层就拒（判据③的两层校验里这一层）
    const bad = fetchJson({ version: 'x', years: [{ year: YEAR, papers: ['https://a'], days: [{ day: '2027-02-30', isOffDay: true }] }] });

    const result = await refreshPublicFacts(configured(cache, bad.impl, (m) => logs.push(m)));

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.cause).toBe('bad-shape');
    const after = await readPublicFactsCache(cache);
    expect(after?.version, '坏响应把旧缓存覆盖了 —— 一次服务端回归会让所有设备立刻退回随包表').toBe(goodCached?.version);
    expect(logs.length, '这条失败完全不可观测就是"静默吞掉"').toBe(1);
  });

  it('网络失败：cause 可观测、缓存不动、界面无从报错（判据①的失败面）', async () => {
    const cache = fakeCache();
    const { impl, seen } = fetchThrows();
    const logs: string[] = [];

    const result = await refreshPublicFacts(configured(cache, impl, (m) => logs.push(m)));

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.cause).toBe('network');
    expect(seen.length).toBe(1);
    expect(await readPublicFactsCache(cache), '失败路径写脏了缓存').toBeUndefined();
    expect(logs.length).toBe(1);
  });

  it('非 200（比如自托管那个版本还没有这条通道）：同样是不报错，而不是"日历少一块"', async () => {
    const cache = fakeCache();
    const { impl } = fetchStatus(404);

    const result = await refreshPublicFacts(configured(cache, impl));

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.cause).toBe('http-status');
  });

  it('判据①那半句"没有覆盖也是一种正常状态"：本机从没缓存过时 install 返回 undefined 而不是抛', async () => {
    const cache = fakeCache();

    await expect(installPublicFactsFromCache(cache)).resolves.toBeUndefined();
  });

  /**
   * 🔴 撤回必须落地：批次里**少一年** ⇒ 那一年退回随包表。
   *
   * 这条用例的存在理由：`installHolidayAdjustmentOverrides` 只做 `set`，
   * 覆盖表从来不清空，所以运营 DELETE 掉某一年之后，客户端**永远继续**替部署方
   * 说那句已被收回的话（`adjustmentOn()` 仍答那一年）。ADR-0052 §2.2 承诺的是
   * "下一次拉取退回随包表"，而修之前这条承诺没有任何一层在守。
   *
   * 断言写成**相对量**（与装覆盖之前那次现读的随包答案对账），不写死某一天是休是班 ——
   * 随包表每加一年就会漂，写死数值会让这条判据在 vendor 数据更新后悄悄变成恒真或恒红。
   */
  it('🔴 批次少一年 ⇒ 那一年退回随包表，而批次里剩下的那一年不许被牵连', async () => {
    const { to } = holidayCoverage();
    const probeDay = `${String(to)}-05-05`;
    clearHolidayAdjustmentOverrides();
    const bundledAnswer = adjustmentOn(probeDay);

    const cache = fakeCache();
    const bodyWithBoth = {
      version: '1730000000000.2.3',
      years: [
        {
          year: YEAR,
          papers: ['https://www.gov.cn/gongshu/example-2027'],
          days: [
            { day: '2027-01-02', isOffDay: true },
            { day: '2027-02-20', isOffDay: false },
          ],
        },
        {
          year: to,
          papers: [`https://www.gov.cn/gongshu/example-${String(to)}`],
          days: [
            { day: probeDay, isOffDay: false },
            { day: `${String(to)}-05-06`, isOffDay: true },
          ],
        },
      ],
    };

    const first = await refreshPublicFacts(
      configured(cache, fetchJson(bodyWithBoth).impl),
    );
    expect(first.kind).toBe('ok');
    expect(adjustmentOn(probeDay), '覆盖里说的"这天上班"必须改答').toBe('work');
    expect(holidayAdjustmentSource(probeDay)).toBe('override');

    // 运营把 `to` 那一年整年撤回：批次里只剩 2027。
    const second = await refreshPublicFacts(
      configured(cache, fetchJson({ version: '1730000000001.1.2', years: [bodyWithBoth.years[0]!] }).impl),
    );
    expect(second.kind).toBe('ok');

    expect(adjustmentOn(probeDay), '已撤回的那一年不许继续替部署方说话').toBe(bundledAnswer);
    expect(holidayAdjustmentSource(probeDay)).toBe('bundled');
    // 另一半：整批替换不是"全清"—— 批次里还在的那一年必须仍然用下发的那一份。
    expect(adjustmentOn('2027-01-02')).toBe('off');
    expect(holidayAdjustmentSource('2027-01-02')).toBe('override');

    clearHolidayAdjustmentOverrides();
  });
});
