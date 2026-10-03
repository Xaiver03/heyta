/**
 * 公共事实（调休 / 补班）的下行 —— heyta 第一条服务端→客户端内容通道（W4b）
 * =====================================================================
 *
 * ## 这条通道是什么、凭什么存在
 *
 * 定性在 [`docs/adr/0052-public-facts-are-deployer-supplied.md`]：AGENTS §1 那句
 * "云端不是事实源"约束的是**用户数据**；"2026-10-10 是休息日"不是任何人的数据、
 * 服务端完全读得写得出、事实源本来就在设备之外。⇒
 * **对公共事实而言部署方就是事实源；对用户数据而言设备才是。**
 *
 * ## 三条形状上的硬约束（都是判据，不是风格）
 *
 * 1. 🔴 **不带身份**。这条请求不许出现 `authorization` / cookie / `clientId` ——
 *    ADR-0052 §2.1 把"匿名、无身份维度"列为整条定性唯一可判的边界：一旦服务端能
 *    按人给不同的公共事实，它就从公共事实变成用户画像。`scripts/check-public-facts.mjs`
 *    在服务端那一侧钉着它，本文件在客户端这一侧钉着它（判据见 `tests/public-facts.spec.ts`）。
 * 2. 🔴 **不进 op-log、不跨设备**（ADR-0052 §2.5）。它不是"用户的某个意图"，写进
 *    op-log 会让另一台设备回放时产生一个从未发生过的用户动作（AGENTS §3.4 的反面）。
 *    缓存落 `STORES.META`，也不 bump `CURRENT_SCHEMA_VERSION`（AGENTS §3.3）。
 * 3. 🔴 **拉取带外做**。`packages/domain/src/holidays.ts` 文件头把"让 `adjustmentOn()`
 *    变 async"明确列为**已否证**方案 —— 理由原文是"『不确定』在日历上就是空白块，
 *    而那正是判据①要防的东西"。所以这里的形状只能是：
 *    启动/回前台 → `fetch` → 写 META → `installHolidayAdjustmentOverrides()` → 界面重算。
 *    读侧永远是纯同步的一问一答（渲染一个月 = 42 格 × 每格一问）。
 *
 * ## 降级是产品语义，不是兜底代码（ADR-0052 §2.6）
 *
 * 拿不到 / 年份缺失 ⇒ **退回随包表**，界面不报错、不留空块。注意"退回随包表"和
 * "下发空的一年"是两件事 —— 后者会让界面上"什么标记都没有"被读成"今年没有调休"，
 * 而真相是"这个部署方没录"。所以这里对失败的处理是**不动缓存**，不是"清空缓存"。
 */
import { HOLIDAY_ADJUSTMENT_PATHS, PUBLIC_FACT_SHAPES, holidayAdjustmentsResponseSchema } from '@heyta/shared-schema';
import {
  installHolidayAdjustmentOverrides,
  type HolidayAdjustmentOverride,
  type HolidayOverrideInstallResult,
} from '@heyta/domain';
import { META_KEYS } from '@heyta/storage';

import { joinEndpointUrl } from './endpoint-url.js';

/** 缓存里那份响应的形状（与公开 GET 的 body 逐字相同，见契约 `PUBLIC_FACT_SHAPES`）。 */
export interface PublicFactsSnapshot {
  readonly version: string;
  readonly years: readonly HolidayAdjustmentOverride[];
  readonly fetchedAt: number;
}

/**
 * 缓存落在哪里 —— 🔴 收的是 `OpLogStore` 上那对 META 读写，**不是 `DbAdapter`**。
 *
 * 理由不是风格：web 的**默认**存储路径是 Worker + OPFS SQLite，桌面壳那条是壳里的
 * SQLite —— 这两条路上页侧**根本没有 `DbAdapter`**，只有一个 store 代理。若这个端口
 * 要 `DbAdapter`，"公共事实在 web 上生效"就会是**静默的假**（日历照旧画随包表，
 * 谁都不会报错），而那正是判据①要防的形态。
 *
 * 结构上 `OpLogStore` 直接满足它，三个宿主都传 `requireStore()` 那一份，
 * 谁都不必再造一个适配层（ADR-0052 §2.5：缓存在 `STORES.META`，不进 op-log、不跨设备）。
 */
export interface PublicFactsCachePort {
  getMetaValue(key: string): Promise<string | number | undefined>;
  setMetaValue(key: string, value: string | number): Promise<void>;
}

/**
 * 一次拉取的结果。
 *
 * ⚠️ **没有 `error` 这一支**是刻意的：这条通道的失败在产品里不是事件（判据①），
 * 界面既不许报错也不许留空块。它必须**可观测**，所以带着 `cause` 回来给日志与测试，
 * 但类型上就产生不出"把日历清空"这个动作。
 */
export type PublicFactsRefreshResult =
  | { readonly kind: 'ok'; readonly installed: readonly HolidayOverrideInstallResult[]; readonly snapshot: PublicFactsSnapshot }
  /** 条件请求命中 304：内容没变，缓存原样继续用。 */
  | { readonly kind: 'not-modified'; readonly version: string }
  /** 没配服务端地址 ⇒ **连请求都不发**（与 `inbox.ts` 同一条纪律：自托管不该产生流量）。 */
  | { readonly kind: 'unconfigured' }
  /** 拿不到：缓存不动、界面退回随包表。 */
  | { readonly kind: 'unavailable'; readonly cause: PublicFactsUnavailableCause };

export type PublicFactsUnavailableCause =
  | 'network'
  /** 服务端回了非 200/304。它可能是"这条通道在这个部署里根本不存在"（自托管旧版本）。 */
  | 'http-status'
  /** 200 但 body 过不了契约 —— 这是服务端在说谎，绝不能拿它去覆盖一份好缓存。 */
  | 'bad-shape';

export interface PublicFactsRefreshOptions {
  /** 服务端根地址，例如 `http://127.0.0.1:3000`。空串 = 未配置。 */
  readonly baseUrl: string;
  readonly cache: PublicFactsCachePort;
  /** 网络实现，便于测试注入。默认 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 只读日志端口。宿主不给就静默 —— 这条通道的失败不许变成界面上的东西。 */
  readonly log?: (message: string) => void;
}

/**
 * 🔴 客户端请求的**完整路径**，从契约注册表里取，不在这里手写。
 *
 * 第一版这里是手写 `/${HOLIDAY_ADJUSTMENT_PATHS.public}` —— 那少了一层 `/api`
 * （服务端是 `register(holidayAdjustmentRoutes, { prefix: '/api' })` 挂上去的），
 * 真发出去会 404，而 404 在这条通道上的产品表现是"退回随包表"（判据①要求的不报错），
 * 于是**一个纯接线错误在界面上完全看不出来**。`check:public-facts` 也抓不到它：
 * 那条门禁判的是服务端那一侧的注册面。
 * ⇒ 路径只能有一个来源：契约里那条 shape 的 `path`，服务端拿它注册、客户端拿它请求。
 * 找不到那条 shape 时**在模块加载时就抛**，不给它兜底字符串 —— 兜底会把"契约被人摘掉"
 * 这件事伪装成一次正常的降级（判据①要求失败在界面上不可见，正好是它最该响的地方）。
 */
const publicFactsShape = PUBLIC_FACT_SHAPES.find((s) => s.id === HOLIDAY_ADJUSTMENT_PATHS.public);
if (publicFactsShape === undefined) {
  throw new Error(
    `契约注册表里没有 id=${HOLIDAY_ADJUSTMENT_PATHS.public} 的公共事实 shape —— 客户端不知道该请求哪条路径，而任何手写的路径都是一条静默的 404`,
  );
}
const PUBLIC_FACTS_PATH = publicFactsShape.path;

/** 读缓存。没有任何缓存时回 `undefined`（那是"这个部署方没录过"，不是错误）。 */
export async function readPublicFactsCache(
  cache: PublicFactsCachePort,
): Promise<PublicFactsSnapshot | undefined> {
  const raw = await cache.getMetaValue(META_KEYS.PUBLIC_FACTS_JSON);
  if (typeof raw !== 'string' || raw === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 磁盘上的东西过不了 JSON —— 与"没有缓存"同构处理：退回随包表，不去清空它。
    return undefined;
  }
  const checked = holidayAdjustmentsResponseSchema.safeParse(parsed);
  if (!checked.success) return undefined;

  const etag = await cache.getMetaValue(META_KEYS.PUBLIC_FACTS_ETAG);
  const fetchedAt = await cache.getMetaValue(META_KEYS.PUBLIC_FACTS_FETCHED_AT);

  return {
    version: typeof etag === 'string' && etag !== '' ? etag : checked.data.version,
    years: toOverrides(checked.data),
    fetchedAt: typeof fetchedAt === 'number' ? fetchedAt : 0,
  };
}

/**
 * 契约的逐日形状 → domain 的 `offDays` / `workDays` 分组。
 *
 * 这一步**故意放在这里**而不是 domain：domain 收的是领域形状，契约收的是线上形状，
 * 两者谁都不该认识对方（否则 `shared-schema` 要依赖 `domain`，那条依赖在服务端不存在）。
 */
function toOverrides(body: { years: readonly { year: number; papers?: readonly string[]; days: readonly { day: string; isOffDay: boolean }[] }[] }): readonly HolidayAdjustmentOverride[] {
  return body.years.map((year) => ({
    year: year.year,
    offDays: year.days.filter((d) => d.isOffDay).map((d) => d.day),
    workDays: year.days.filter((d) => !d.isOffDay).map((d) => d.day),
    papers: year.papers,
  }));
}

/**
 * 把缓存装进 domain 的覆盖表。启动时调用（纯本地、不发网络、不抛）。
 *
 * 返回 `undefined` = 本机从来没有过这份数据 ⇒ `adjustmentOn()` 读随包表（判据①的
 * "不留空块"就是这么成立的：**没有覆盖也是一种正常状态**）。
 */
export async function installPublicFactsFromCache(
  cache: PublicFactsCachePort,
): Promise<readonly HolidayOverrideInstallResult[] | undefined> {
  const snapshot = await readPublicFactsCache(cache);
  if (snapshot === undefined) return undefined;
  return installHolidayAdjustmentOverrides(snapshot.years);
}

/**
 * 拉一次公共事实并装上它（启动 / 回前台时调）。
 *
 * 🔴 全程不带凭据：没有 `authorization`、没有 cookie（`credentials: 'omit'` 显式写出来，
 * 因为默认值随浏览器实现而变，而"匿名"是这条通道存在的前提）。
 */
export async function refreshPublicFacts(
  options: PublicFactsRefreshOptions,
): Promise<PublicFactsRefreshResult> {
  if (options.baseUrl.trim() === '') return { kind: 'unconfigured' };
  const url = joinEndpointUrl(options.baseUrl, PUBLIC_FACTS_PATH);

  const cached = await readPublicFactsCache(options.cache);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      headers: cached === undefined ? {} : { 'if-none-match': cached.version },
    });
  } catch (error) {
    options.log?.(`public facts fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: 'unavailable', cause: 'network' };
  }

  if (response.status === 304 && cached !== undefined) {
    installHolidayAdjustmentOverrides(cached.years);
    return { kind: 'not-modified', version: cached.version };
  }

  if (!response.ok) {
    options.log?.(`public facts http ${String(response.status)}`);
    return { kind: 'unavailable', cause: 'http-status' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    options.log?.('public facts body is not JSON');
    return { kind: 'unavailable', cause: 'bad-shape' };
  }

  const checked = holidayAdjustmentsResponseSchema.safeParse(body);
  if (!checked.success) {
    // 🔴 坏形状**不覆盖**缓存：一份说假话的新数据不该把一份能用旧数据挤掉，
    // 否则一次服务端回归会让所有设备立刻退回随包表（那是判据①要防的"空块"的另一种形态）。
    options.log?.(`public facts failed the contract: ${checked.error.issues.map((i) => i.message).join('; ')}`);
    return { kind: 'unavailable', cause: 'bad-shape' };
  }

  const years = toOverrides(checked.data);
  const fetchedAt = Date.now();
  await options.cache.setMetaValue(META_KEYS.PUBLIC_FACTS_JSON, JSON.stringify(checked.data));
  await options.cache.setMetaValue(META_KEYS.PUBLIC_FACTS_ETAG, checked.data.version);
  await options.cache.setMetaValue(META_KEYS.PUBLIC_FACTS_FETCHED_AT, fetchedAt);

  const installed = installHolidayAdjustmentOverrides(years);
  const snapshot: PublicFactsSnapshot = { version: checked.data.version, years, fetchedAt };
  return { kind: 'ok', installed, snapshot };
}
