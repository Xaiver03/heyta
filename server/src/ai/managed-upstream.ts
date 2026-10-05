/**
 * 托管 AI 代理的**境内上游**判定 —— 服务端这一侧的那份表。
 * =========================================================
 *
 * 依据：[ADR-0053](../../../docs/adr/0053-endpoint-address-class-and-domestic-managed-allowlist.md) §5
 * 与 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md) §5。
 * 客户端那份在 `packages/ai/src/managed-endpoints.ts`，它管的是"这台设备肯不肯把明文交出去"；
 * 本文件管的是"**这台服务器肯不肯把明文转发出去**"—— 两个决定点，两张必须同形的表。
 *
 * ## 🔴 为什么是**镜像 + 对账**，而不是直接 import `@heyta/ai`
 *
 * 看起来最省事的写法是 `import { MANAGED_MODEL_HOSTS } from '@heyta/ai'`。它今天是**运行时会炸**的：
 *
 * | 事实 | 位置 |
 * |---|---|
 * | `server/package.json` 的运行时依赖只有 domain / shared-schema / sync-core 三枚工作区包 | `dependencies` |
 * | builder 阶段只 COPY 这三包的 `package.json` 与源码，并只 `pnpm pack` 这三包 | `server/Dockerfile` 第 53–56、79–109、270–272 行 |
 * | `packages/ai` 只在 **web 阶段**被 COPY（给 `apps/web` 构建用），它的产物不进服务端镜像 | 同文件第 161、183 行 |
 * | 运行时镜像的依赖由三条 `npm install` 决定，其中没有 `@heyta/ai` 的 tarball | 同文件第 309–315 行 |
 *
 * 也就是说：**加一枚 `@heyta/ai` 运行时依赖 = 本地 `pnpm -r build` 全绿、`pnpm check` 全绿，而镜像里
 * `Cannot find module '@heyta/ai'`。** 这正是 AGENTS §6.1「门禁绿 ≠ 能打包」那条，也是本仓库已经
 * 踩过三次的形状（Dockerfile 自己就记着 `@heyta/domain` 那一次："**潜伏过一段时间**……直到 billing
 * 开始用 `@heyta/domain`，镜像就再也构建不出来了"，以及 `b3397cda` 把三枚 devDep 加进去之后
 * `E404` 那一次）。要真走 import 这条路，改动面是 Dockerfile 的**三处**（清单 COPY、源码 COPY、
 * `pnpm pack` + `npm install ./ai.tgz`）+ `server/package.json` + 那条剪枝纪律，而不是一行 import。
 * 本轮不付这个代价，改为**镜像 + 逐字对账**：
 *
 * - 表在这里抄一份（含 `jurisdiction` 与 `provider`，不只是主机名 —— 只抄主机名会丢掉
 *   "这一行为什么算境内"那一半信息）；
 * - 🔴 `server/tests/managed-upstream-drift.spec.ts` **从盘上读** `packages/ai/src/managed-endpoints.ts`
 *   与 `packages/ai/src/egress.ts`，逐条比对两边的主机集合、所在地判定与功能词表。
 *   任一边漂开 ⇒ 那条测试红。
 *
 * ⚠️ 这条对账**只在仓库里跑**（镜像里没有 `packages/`，测试也不进镜像）—— 它是"改一边忘了改另一边"
 * 的唯一拦截点。所以**动那份表时必须同时跑一次** `NO_COLOR=1 npx vitest run tests/managed-upstream-drift.spec.ts`，
 * 不能只跑 `pnpm --filter @heyta/ai test`。
 *
 * ## 为什么匹配是**主机名逐字相等**
 *
 * 与 `packages/ai` 同一条理由，抄一遍要点：`endsWith('api.deepseek.com')` 会放行
 * `api.deepseek.com.evil.cn`；"取后两段"会把白名单从主机名放大到**别人能注册的**注册域。
 * 逐字相等的代价是多一个子域就多登记一行 —— 那个成本是刻意的。
 */

/** 供应方所在地。`'cn'` 是托管路径唯一接受的取值。 */
export type ServerManagedJurisdiction = 'cn' | 'foreign' | 'unknown';

/** 白名单里的一行。字段全部必填，与 `ManagedModelHost` 同形。 */
export interface ServerManagedModelHost {
  /** 端点主机名（小写、无端口、无方括号）。 */
  readonly host: string;
  /** 供应方主体名（不是产品昵称）。 */
  readonly provider: string;
  /** 所在地判定。 */
  readonly jurisdiction: ServerManagedJurisdiction;
  /** 这句"境内"是从哪儿核的。**空 = 不合格**。 */
  readonly evidence: string;
}

/**
 * 🔴 与 `packages/ai/src/managed-endpoints.ts` 的 `MANAGED_MODEL_HOSTS` **逐条对应**。
 *
 * 两行的性质不同（同那份表的注释）：`api.deepseek.com` 是第三方境内供应商（ADR-0021 选定），
 * `heyta.waytofuture.cn` 是我们自己那台已备案的服务器。**这里没有回环地址、没有私网地址**，
 * 所以"明文不许走 http"这一条在本文件里不需要为"本机模型服务"开口子（下面
 * `plaintextHosts` 那个入参只为**测试的假端点**存在，生产调用点一律不传）。
 */
export const SERVER_MANAGED_MODEL_HOSTS: readonly ServerManagedModelHost[] = [
  {
    host: 'api.deepseek.com',
    provider: 'DeepSeek（杭州深度求索人工智能基础技术研究技术有限公司）',
    jurisdiction: 'cn',
    evidence:
      'ADR-0021 §1 第 3 条：单价已于 2026-09-27 从官方定价页 https://api-docs.deepseek.com/quick_start/pricing 直取；' +
      '该 API 由境内主体在境内机房运营。⚠️ 机房所在地未独立核验，见 ADR-0053 §5 第 2 条。',
  },
  {
    host: 'heyta.waytofuture.cn',
    provider: 'heyta 自建（腾讯云国内 region 服务器）',
    jurisdiction: 'cn',
    evidence:
      'docs/runbooks/deployment.md §3.7.2：主域 waytofuture.cn 已完成 ICP 备案，heyta 子域 A 记录指向境内 IP，' +
      '证书由 certbot 签发；同节记录的容器与端口均在同一台境内机器上。',
  },
];

/**
 * 会被写进审计日志的**功能名**词表。
 *
 * 🔴 与 `packages/ai/src/egress.ts` 的 `AiFeature` 同源（那边定义、这边镜像，
 * 漂移由 `managed-upstream-drift.spec.ts` 拦）。为什么服务端需要它：
 * ADR-0054 §4 允许保留的运维元数据里就有"功能名（封闭词表里的那 5 个之一）"，
 * 而**封闭**才是这句话有意义的原因 —— 一个自由字符串会让日志变成"用户输入的一小段"，
 * 于是第 3 节那句"不保留内容"从后门被推翻。所以这里按词表校验，词表外的值 400。
 */
export const SERVER_MANAGED_AI_FEATURES = [
  'capture',
  'breakdown',
  'prioritize',
  'duration-estimate',
  'tool-calling',
] as const;

export type ServerManagedAiFeature = (typeof SERVER_MANAGED_AI_FEATURES)[number];

/** 为什么这份端点不算合格的托管上游。**封闭词表**，每条对应一个不同的修复动作。 */
export type DomesticUpstreamRejection =
  /** 没配端点 —— 这台实例没有开通托管 AI。 */
  | 'empty'
  /** 地址解析不出主机名。 */
  | 'unparseable'
  /** 不是 http/https。 */
  | 'bad-scheme'
  /**
   * 🔴 明文 `http://`。
   *
   * 这条**不是**"顺手加的 TLS 洁癖"：托管路径送出去的是**用户任务的明文**（ADR-0005 §1 里
   * 那个唯一的例外）。一次明文转发等于在"端到端加密"的承诺之外再加一次泄露，而症状是
   * "配了地址也能通"，没有任何一层会报错。
   */
  | 'plaintext'
  /** 主机名不在表上，**或**在表上但所在地不是 `'cn'`。 */
  | 'not-allowlisted';

export type DomesticUpstreamVerdict =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly reason: DomesticUpstreamRejection; readonly message: string };

/** 取小写主机名与协议；解析不出主机名返回 `undefined`。 */
function parseUpstreamUrl(endpoint: string): { host: string; protocol: string } | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.hostname === '') return undefined;
  return { host: url.hostname.toLowerCase(), protocol: url.protocol };
}

/**
 * 这份上游端点**能不能**被转发。
 *
 * 🔴 表与 `plaintextHosts` 都是**入参**，不是闭包里的常量 —— 与 `packages/ai` 那份
 * `managedEndpointVerdictAgainst(endpoint, table)` 同一条设计：**一个"默认就是那张表"的
 * 参数会把这条判据变成测不到的**，因为想证伪 `jurisdiction !== 'cn'` 那一支的唯一办法是
 * 往生产表里塞一行境外供应商（等于在产品上开个洞）。入参化之后，生产调用点必须点名传
 * `SERVER_MANAGED_MODEL_HOSTS`（默认值就是它，且**没有**第二个默认），测试则拿合成表打那两支。
 *
 * ⚠️ `plaintextHosts` 的默认值是**空数组**，也就是说：**默认一切明文都拒**。
 * 它只为测试的假上游（`http://127.0.0.1:<port>`）存在；`server.ts` 的那次注册**不传**它，
 * 而 `managed-proxy.routes.spec.ts` 有一条用例专门拿"不传它的默认路由 + 明文地址"钉住这个默认。
 */
export function domesticUpstreamVerdict(
  endpoint: string | undefined,
  table: readonly ServerManagedModelHost[] = SERVER_MANAGED_MODEL_HOSTS,
  plaintextHosts: readonly string[] = [],
): DomesticUpstreamVerdict {
  if (endpoint === undefined || endpoint.trim() === '') {
    return {
      ok: false,
      reason: 'empty',
      message: '这台实例没有配置托管 AI 的上游端点，因此无法判定数据落到哪一家。',
    };
  }
  const parsed = parseUpstreamUrl(endpoint);
  if (parsed === undefined) {
    // 🔴 不回显端点：自托管者可能把密钥写在 URL 里（`https://key@host` 是合法形状）。
    return { ok: false, reason: 'unparseable', message: '托管上游端点无法解析出主机名。' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'bad-scheme',
      message: `托管上游必须是 http 或 https，收到 ${parsed.protocol}`,
    };
  }
  if (parsed.protocol !== 'https:' && !plaintextHosts.includes(parsed.host)) {
    return {
      ok: false,
      reason: 'plaintext',
      message: '托管上游必须是 https：明文会把用户的任务内容以未加密的方式送到远端。',
    };
  }
  const allowance = table.find((entry) => entry.host === parsed.host);
  if (allowance === undefined) {
    return {
      ok: false,
      reason: 'not-allowlisted',
      message: `主机名 ${parsed.host} 不在托管白名单里（逐字相等匹配，不做子域或后缀匹配）。`,
    };
  }
  // 🔴 在表上、但所在地不是 `'cn'` ⇒ 仍然拒。两把尺子**相互独立**：
  // 表回答"这是谁"，所在地回答"数据落在哪儿"。合成表的用例盯着这一支，
  // `managed-upstream-drift.spec.ts` 盯着生产表本身没有非 `cn` 行。
  if (allowance.jurisdiction !== 'cn') {
    return {
      ok: false,
      reason: 'not-allowlisted',
      message: `主机名 ${parsed.host} 虽然在表上，但所在地被登记为「${allowance.jurisdiction}」；托管路径只接受境内。`,
    };
  }
  return { ok: true, host: parsed.host };
}
