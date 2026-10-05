/**
 * 托管 AI 的**境内供应商白名单**
 * ==============================
 *
 * [ADR-0053](../../../docs/adr/0053-endpoint-address-class-and-domestic-managed-allowlist.md)
 * 第二条裁决落在这里：产品要开 `mode: 'managed'` 这一档，红线是
 * **托管路径只能接中国境内的模型供应商**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么"境内"必须落成一张表，而不是一个形容词
 *
 * "只用境内模型供应商"这句话写在文档里，**它约束不了任何东西**：
 * 下一个接手的会话可以在 `classifyDestination` 里继续无条件返回 `heyta-cloud`，
 * 界面照旧说"数据到了 heyta 的服务器"，而实际打到的是一家境外 API。
 * 那句话不会变红，没有任何一层会失败。本仓库对这种形状已经登记过两次教训：
 * **文档里的封闭句式必须有一条对账门禁**（AGENTS §9「2026-10-03 L' 那条」），
 * 以及**"看起来在保护一件事，其实保护的是另一件"**（同上，管理后台那条）。
 *
 * 所以"境内"被拆成四件**可失败**的东西：
 *
 *   1. **这张表**（唯一事实源，主机名逐字精确匹配，见下面为什么不是后缀匹配）；
 *   2. **保存/启用点**：`assertEnableable` 在 `mode === 'managed'` 时查它；
 *   3. **发送点**：`provider.invoke` 在任何网络动作之前**复算一次目的地**
 *      （`classifyDestination` 对 `managed` 就是查这张表，所以端点一旦离开白名单，
 *      目的地必然离开 `heyta-cloud`，复算不等即拒）。
 *      ADR-0010 从 SSOS 抄来的那条纪律是它的出处：
 *      「Enforcement has to sit on the path that actually sends the request,
 *      not only on the path that stores it.」
 *   4. **门禁**：`scripts/check-ai-coverage.mjs` 第 8 段直接 import 构建产物，
 *      逐项核对表本身（每一项都必须是 `jurisdiction: 'cn'` + 非空出处 +
 *      真的能被匹配上），并核对"境外端点不得被说成 `heyta-cloud`"。
 *
 * ⚠️ 表的**内容**（哪家算境内）由 `jurisdiction` 字段与它登记的出处承担，
 * 门禁只保证**形状**：加一行 `'foreign'` 会红，加一行没有出处的 `'cn'` 也会红。
 * 它**不**保证"这条出处本身是真的"—— 那是人的判断，而把判断写成机器可核验的
 * 前提是**必须留下可核验的出处**，这一步是门禁能做的极限。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 🔴 为什么匹配是**主机名逐字相等**，不是"属于这个域名"
 *
 * `endsWith('api.deepseek.com')` 会把 `api.deepseek.com.evil.cn` 放进来；
 * 而"取后两段"的写法会把白名单从主机名扩大到注册域，等于把判断交给**别人能注册的
 * 名字**。逐字相等的代价是多一个子域就要**多登记一行** —— 这个成本是刻意的，
 * 它逼人为那个子域做一次"它真的还是同一家境内服务吗"的判断。
 */

/** 供应方所在地。**`'cn'` 是托管路径唯一接受的取值**，其余取值是为门禁准备的靶子。 */
export type ManagedJurisdiction =
  /** 中国境内主体 + 境内机房。 */
  | 'cn'
  /** 境外主体或境外机房 —— 托管路径**永不**接受。 */
  | 'foreign'
  /** 没查清。托管路径**不接受**"没查清"。 */
  | 'unknown';

/** 白名单里的一行。字段全部必填，缺一个都过不了类型，也不得过门禁。 */
export interface ManagedModelHost {
  /** 端点主机名（小写、无端口、无方括号）。 */
  readonly host: string;
  /** 供应方（主体名，不是产品昵称）。 */
  readonly provider: string;
  /** 所在地判定。 */
  readonly jurisdiction: ManagedJurisdiction;
  /**
   * 🔴 **出处**：这条"境内"的判断是从哪儿核的（备案/机房/取证记录/ADR）。
   * 门禁检查它非空 —— 因为一个形容词（"它是国内的"）不是出处。
   */
  readonly evidence: string;
}

/**
 * 托管路径**只**允许这些主机名。
 *
 * ⚠️ 今天是两行，而且两行的性质不同：
 *   - `api.deepseek.com` 是**第三方境内供应商**（ADR-0021 选定的那一家）；
 *   - `heyta.waytofuture.cn` 是**我们自己那台已备案的服务器**（托管档的入口）。
 * 加第三行之前要先想清楚 ADR-0053 §5 那两条边界：机房所在地与"备案 ≠ 境内"的区别。
 */
export const MANAGED_MODEL_HOSTS: readonly ManagedModelHost[] = [
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

/** 端点为什么不算"境内的托管端点"。**封闭词表**，每条对应一个不同的修复动作。 */
export type ManagedEndpointRejection =
  /** 端点没配 —— 还没到能出境的状态。 */
  | 'empty'
  /** 地址解析不出主机名。 */
  | 'unparseable'
  /** 不是 http/https。 */
  | 'bad-scheme'
  /**
   * 🔴 用了明文 `http://`。
   *
   * 托管端点**必然**是远端服务（白名单里没有回环地址），所以这里不给本机豁免，
   * 与 `validateEndpointUrl` 那张"回环允许 http / 远端必须 https"的分岔表一致。
   */
  | 'plaintext'
  /** 主机名不在白名单上（包括在白名单**域名下**但没逐字登记的子域）。 */
  | 'not-allowlisted';

export type ManagedEndpointVerdict =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly reason: ManagedEndpointRejection; readonly message: string };

/** 取小写主机名与协议；解析不出主机名返回 undefined。 */
function parseManagedUrl(endpoint: string): { host: string; protocol: string } | undefined {
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
 * 判定实现。**表是入参**，不是闭包里的常量。
 *
 * 🔴 为什么故意不给它默认值：一个"默认就是那张表"的参数会把这条判据变成
 * **测不到**的 —— 要证伪 `jurisdiction !== 'cn'` 那一支，唯一办法是往生产表里塞一行
 * 境外供应商（那等于在产品里开一个洞）。表作为必填参数，生产调用点**必须**点名
 * 传 `MANAGED_MODEL_HOSTS`（TypeScript 兜住），测试则拿一张合成的表去证明那一支真的会拒。
 * 注入的是**数据**，不是授权 —— 与 `resolveRoute(config, …)` / `authorizeEgress(request, consents)`
 * 同一手法。
 */
export function managedEndpointVerdictAgainst(
  endpoint: string | undefined,
  table: readonly ManagedModelHost[],
): ManagedEndpointVerdict {
  if (endpoint === undefined || endpoint.trim() === '') {
    return {
      ok: false,
      reason: 'empty',
      message: '托管模式没有配置端点地址，因此无法判定数据落到哪一家。',
    };
  }
  const parsed = parseManagedUrl(endpoint);
  if (parsed === undefined) {
    return {
      ok: false,
      reason: 'unparseable',
      message: `托管端点地址无法解析出主机名：${endpoint}`,
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'bad-scheme',
      message: `托管端点必须是 http 或 https，收到 ${parsed.protocol}`,
    };
  }
  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'plaintext',
      message: `托管端点必须是 https（明文会把任务内容以未加密的方式送到远端）：${endpoint}`,
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
  // 🔴 在表上、但所在地不是 'cn' ⇒ 仍然拒。
  // 这条与上一条是**两把独立的尺子**：表回答"这是谁"，所在地回答"数据落在哪儿"。
  // 合成表的单测（`managed-allowlist.spec.ts`）盯着它，门禁 8d 盯着生产表本身。
  if (allowance.jurisdiction !== 'cn') {
    return {
      ok: false,
      reason: 'not-allowlisted',
      message: `主机名 ${parsed.host} 虽然在表上，但它的所在地被登记为「${allowance.jurisdiction}」；托管路径只接受境内。`,
    };
  }
  return { ok: true, host: parsed.host };
}

/**
 * 这份托管端点**能不能**被说成"数据到了 heyta 的服务器"。
 *
 * 它是 `classifyDestination`（目的地推导）、`assertEnableable`（保存/启用点）与
 * `provider.invoke`（发送点）**共用的唯一一份判断**。写第二遍就是制造两套裁决标准。
 */
export function managedEndpointVerdict(
  endpoint: string | undefined,
): ManagedEndpointVerdict {
  return managedEndpointVerdictAgainst(endpoint, MANAGED_MODEL_HOSTS);
}

/** 谓词形式：能不能作为托管目的地。 */
export function isDomesticManagedEndpoint(endpoint: string | undefined): boolean {
  return managedEndpointVerdict(endpoint).ok;
}

/** 表的可读摘要（诊断与门禁用；**不进界面**，界面文案归 `packages/i18n`）。 */
export function describeManagedModelHosts(): readonly string[] {
  return MANAGED_MODEL_HOSTS.map(
    (entry) => `${entry.host} ← ${entry.provider}（${entry.jurisdiction}）· 出处：${entry.evidence}`,
  );
}
