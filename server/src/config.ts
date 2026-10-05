import * as path from 'path';
import { Logger } from './logger';

/**
 * 产品名 —— **面向用户的地方只能有这一份**。
 *
 * 🔴 这里真的漂移过一次：SuperSync → heyta 的改名里 `pages.ts` 改到了
 * （"logging in to heyta"），**`email.ts` 整个漏了**。后果不是文案不统一那么轻：
 * 用户点邮件里的链接会落到一个说 heyta 的页面，而那封邮件本身写着
 * "Verify your SuperSync account" —— 看起来就像钓鱼。
 *
 * 根因是同一个字符串散在 7 处字面量里（3 个 subject、3 个正文、1 个 From 兜底）。
 * 收成常量不是为了好看，是为了下次改名时**一次改完**。
 */
export const PRODUCT_NAME = 'heyta';

/**
 * `SMTP_FROM` 未配置时的兜底发件人。
 *
 * ⚠️ `noreply@example.com` 是**占位符**：真部署必须设 `SMTP_FROM`，
 * 否则邮件会以一个不存在的域名发出（会被 SPF/DMARC 判失败）。
 */
export const DEFAULT_SMTP_FROM = `"${PRODUCT_NAME}" <noreply@example.com>`;

/** CORS origin can be a string or RegExp for pattern matching (e.g., localhost with any port) */
export type CorsOrigin = string | RegExp;

/**
 * Parse CORS origin string into CorsOrigin type (string or RegExp).
 * Supports wildcard subdomain syntax: https://*.example.com
 * Converts wildcards to safe RegExp patterns.
 *
 * SECURITY: The generated pattern only allows alphanumeric characters and
 * hyphens in the subdomain portion to prevent domain confusion attacks.
 * For example, https://*.example.com will NOT match https://evil.com.example.com
 *
 * @param origin - CORS origin string (exact match or wildcard pattern)
 * @returns CorsOrigin (string for exact match, RegExp for wildcard)
 * @throws Error if wildcard pattern is invalid or unsafe
 */
export const parseCorsOrigin = (origin: string): CorsOrigin => {
  const trimmed = origin.trim();

  // Validate non-empty
  if (!trimmed) {
    throw new Error('CORS origin cannot be empty');
  }

  // No wildcard - return as-is for exact match
  if (!trimmed.includes('*')) {
    return trimmed;
  }

  // Validate wildcard count
  const wildcardCount = (trimmed.match(/\*/g) || []).length;
  if (wildcardCount > 1) {
    throw new Error(`Invalid CORS origin "${trimmed}": multiple wildcards not allowed`);
  }

  // Only allow subdomain wildcards: https://*.example.com
  const subdomainWildcardPattern = /^(https?):\/\/\*\.([a-z0-9.-]+)(:\d+)?$/i;
  const match = trimmed.match(subdomainWildcardPattern);

  if (!match) {
    throw new Error(
      `Invalid CORS origin "${trimmed}": wildcard only allowed as subdomain (e.g., https://*.example.com)`,
    );
  }

  const [, protocol, domain, port] = match;

  // Convert to safe RegExp: https://*.example.com -> /^https:\/\/[a-zA-Z0-9-]+\.example\.com$/i
  // Only allow alphanumeric and hyphens in subdomain (prevents domain confusion)
  // Normalize domain to lowercase (browsers send Origin header in lowercase per RFC 6454)
  const escapedDomain = domain.toLowerCase().replace(/\./g, '\\.');
  const portPart = port ? port.replace(/\./g, '\\.') : '';
  const pattern = `^${protocol}:\\/\\/[a-zA-Z0-9-]+\\.${escapedDomain}${portPart}$`;

  // Use case-insensitive flag to handle uppercase/lowercase variations
  return new RegExp(pattern, 'i');
};

export interface PrivacyConfig {
  contactName: string;
  addressStreet: string;
  addressCity: string;
  addressCountry: string;
  contactEmail: string;
  /** Free-text address block of the hosting provider, if a third party hosts the data. */
  hostingProvider?: string;
  /** Free-text block naming the supervisory authority competent for the controller. */
  supervisoryAuthority?: string;
}

/**
 * Whether this instance may ask users to accept anything.
 *
 * Derived, never stored: consent is meaningful exactly when a privacy policy is published,
 * and that is decided solely by whether the operator identified themselves. Keeping this a
 * pure function of the environment means there is no initialisation order to get wrong and
 * no process-wide flag that a forgotten setter could leave pointing the wrong way.
 */
export const isConsentRequired = (config: ServerConfig): boolean => !!config.privacy;

/**
 * 微信支付（Native 扫码）运营者配置。
 *
 * 🔴 **默认不存在**：只有运营者显式设 `WECHAT_PAY_ENABLED=true` 且**六个凭证
 * 全部齐全**时，`loadConfigFromEnv` 才会填出这个对象。少一个变量是**启动期
 * 硬错误**，不是静默降级 —— 一个"看起来配了但注册不上"的支付通道
 * 会表现为"用户扫码付了钱但没权益"，而那是最晚才会被发现的失败。
 *
 * 自托管实例**不要开**：heyta 是 MIT、自托管免费
 * （`docs/plans/subscription-boundary.md` §1）。
 */
export interface WechatPayConfig {
  readonly appId: string;
  readonly mchId: string;
  /** 商户证书序列号。 */
  readonly serialNo: string;
  /** APIv3 密钥（32 个 ASCII 字节）。 */
  readonly apiV3Key: string;
  /** 商户私钥（PEM / 转义 PEM / PEM 的 base64）。 */
  readonly privateKey: string;
  /** 微信支付平台公钥（同上三种写法）。 */
  readonly publicKey: string;
  /** 回调地址，绝对 URL。默认 `PUBLIC_URL + /api/billing/webhooks/wechat`。 */
  readonly notifyUrl: string;
}

/**
 * Web Push 的配置（RFC 8292 的 VAPID 密钥对）。
 *
 * 🔴 **默认不存在**：只有运营者显式设 `WEB_PUSH_ENABLED=true` 且**两个变量
 * 齐全**时才填出这个对象 —— 与 `WechatPayConfig` 同一姿态。
 *
 * 为什么少了就**整个能力不存在**（而不是用一对临时密钥兜底）：
 * VAPID 密钥对是**长期身份**。用临时密钥起的服务能发出推送，但推送服务
 * 那边记录的身份每次重启都变；而更糟的是，换密钥会让**所有既有订阅全部作废**
 * （客户端是用旧公钥订阅的），而服务器无从知道这件事 ——
 * 表现是"某次重启之后，所有 Windows 用户的组件再也不刷新了"。
 * 所以：**宁可这个能力不存在，也不要一个会自己失效的身份。**
 *
 * 自托管实例**不需要开**：这只影响 Windows 上的组件刷新频率，
 * 组件本身照常工作（打开应用时会刷新）。见 U12。
 */
export interface WebPushConfig {
  /** 公钥，base64url 的 65 字节未压缩点。**不是秘密**，会发给每个浏览器。 */
  readonly publicKey: string;
  /** 私钥，base64url 的 32 字节。**是秘密**，只用于签 VAPID JWT。 */
  readonly privateKey: string;
  /** VAPID 的 `sub`：`mailto:` 或 `https:`。推送服务会校验它。 */
  readonly subject: string;
}

/**
 * 托管 AI 的**上游模型供应商**（服务端代理那一档）。
 *
 * 🔴 三个值**全部必填**、默认不存在（= 这台实例没有开通托管 AI，
 * `/api/ai/managed/chat` 一律回 503 而不是 404 —— 与 `webPush` 那两条路由同一姿态：
 * 404 与"这个能力没开"是两件事，客户端分不清"这台服务器不支持"和"我路径写错了"）。
 *
 * ## 为什么上游地址与模型 id 是**服务端配置**，不是客户端能决定的
 *
 * | 如果由客户端给 | 后果 |
 * |---|---|
 * | 上游地址 | 每个请求都在问"请把用户的明文转发到我给的这个 host" —— 那等于把境内白名单交给请求体，而 ADR-0053 §5 的红线正是**只有境内** |
 * | 模型 id | ADR-0021 §1 那句"换模型就是改价，这不是提醒，是等式"：pro 级的月度成本已经越过售价。客户端能选模型 = 客户端能选我们倒贴多少 |
 *
 * ⚠️ 地址的**所在地**不在这里校验，在 `ai/managed-upstream.ts` 的判定里校验 ——
 * 配置能写出一个合法 URL 却不合格（`https://api.openai.com/v1`）。启动期不拦它是有意的：
 * 一台已经跑着的服务器不该因为"上游以后会不合格"而起不来，而每一次转发前都会响亮拒绝。
 */
export interface ManagedAiConfig {
  /** 上游基址，OpenAI 兼容形状（如 `https://api.deepseek.com/v1`）。**必须以 https**。 */
  readonly baseUrl: string;
  /** 上游密钥。**是秘密**：不进日志、不进响应、不发给客户端。 */
  readonly apiKey: string;
  /** 实际请求的 model id（ADR-0021 §3 第 3 条：模型 id 必须是配置）。 */
  readonly modelId: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /**
   * Publicly reachable base URL used for links in emails.
   * Should point to the reverse-proxied address users can access.
   */
  publicUrl: string;
  /**
   * 共享 UI（`apps/web` 的生产产物）在**这台服务器上**的位置。
   *
   * ## 为什么这是自托管的主要长度所在
   *
   * 这一串配置（compose、Caddyfile、env.example、helm、迁移脚本）以前"已经齐了"，
   * 但里面**没有一个是客户端**：Caddy 只 `reverse_proxy supersync:1900`，
   * `public/` 只有凭据页。⇒ 外人把服务端跑起来之后，手上是一个**没有界面的 API**。
   * 业界六个同类项目里五个把前端 bake 进服务端镜像，正是为了这一条
   * （证据与出处见 `docs/research/self-host-distribution-audit.md` §4）。
   *
   * ## 两个值都是"位置"，不是"开关"
   *
   * 开关由**目录在不在**决定，不由某个 `*_ENABLED` 布尔决定。理由是失败形态：
   * 布尔开着而目录不存在时，服务照常起来、`/health` 200、界面 404 ——
   * 那和本仓库反复出事的"界面对用户说谎"是同一类。
   * 由产物本身的存在决定，就只剩两种诚实状态：**挂着**，或启动日志里明说没挂。
   *
   * - `webAppDir`：镜像内的绝对路径。空串 = 显式不挂（开发机上用）。
   * - `webAppPath`：对外挂载路径，必须首尾都带斜杠。
   *   它要与产物**对上**：产物是 `HEYTA_WEB_BASE=/app/ vite build` 打出来的，
   *   挂在别的前缀下会拿到 HTML 而不是样式表 —— 这条由
   *   `scripts/check-web-artifact.mjs` 在构建期钉住，不在运行时猜。
   */
  webAppDir: string;
  webAppPath: string;
  cors: {
    enabled: boolean;
    allowedOrigins?: CorsOrigin[];
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
  };
  /**
   * Privacy policy contact information.
   * Required for German legal compliance (Impressum).
   */
  privacy?: PrivacyConfig;
  /**
   * Where this instance stores user data, as an operator-asserted region label.
   *
   * Independent of `privacy` on purpose: it is a claim about infrastructure, not about the
   * controller, and an operator may want the landing-page badge without publishing a full
   * policy. Only `EU`/`EEA` renders a badge today — every other value is accepted and
   * simply shows none, because an EU flag next to "US" would be exactly the kind of false
   * statement this whole change exists to remove.
   */
  dataRegion?: string;
  /**
   * 付费权益闸门（**默认关**）。
   *
   * 🔴 这是本仓库**唯一**允许推断"这是官方托管实例"的地方，而它不推断 ——
   * 它要求运营者用 `ENTITLEMENT_GATE_ENABLED=true` **显式**开启。
   *
   * 为什么必须显式：代码里没有任何"官方实例 vs 自托管"的程序化标志，
   * 而 heyta 的立身之本就是**自托管免费**（`docs/plans/subscription-boundary.md` §1）。
   * 任何靠现成信号（域名、CORS 默认值、是否有法律文本）去猜"官方实例"的写法，
   * 都会在自托管者身上误伤。默认关 = 自托管默认**全放行**，一次数据库都不查。
   *
   * 上游自己也承认这件事：`sync/services/storage-quota.service.ts` 的注释写着
   * "A self-hoster running this on their own disk has no reason to inherit our
   * hosted service's 100 MB budget."
   */
  entitlements: {
    enabled: boolean;
  };
  /**
   * 微信支付配置。**默认 undefined**（= 不注册微信 adapter，自托管不受影响）。
   * 见 `WechatPayConfig` 与 `docs/plans/subscription-boundary.md` §6。
   */
  wechatPay?: WechatPayConfig;
  /** Web Push（Windows PWA 小组件的刷新机制）。**默认不存在**，见下面接口的说明。 */
  webPush?: WebPushConfig;
  /** 托管 AI 的上游供应商。**默认不存在**（= 该档在这台实例上不可用）。 */
  managedAi?: ManagedAiConfig;
  /**
   * 注册是否必须以"点过验证邮件里的链接"为前提。**默认 true**。
   *
   * 🔴 为什么自托管要能关：`isVerified` 是**所有**登录路的硬门 —— `verifyToken`
   * 拒绝未验证账号（`auth.ts` 里那句 "a JWT ... represents a verified session"），
   * `loginWithEmailPassword` 更是在**口令校验通过之后**才抛 `email_not_verified`。
   * 而开这道闸的唯一动作是点邮件里的链接。一台没配 SMTP 的服务器于是得到：
   * 注册"成功" → 那封信从来没存在过 → 口令永远登录不进 —— 而"邮箱 + 口令"
   * 是本产品**主流**的登录方式（产品负责人 2026-10-02：即使用户自托管、
   * 给了自己的同步域名，也照样该是账号密码登录）。
   *
   * 与 `ENTITLEMENT_GATE_ENABLED` 同一条纪律：只有运营者**显式**写 env 才改变行为，
   * 代码不猜"这是自托管实例"（没有任何程序化标志），且取值严格 —— 写错在启动时
   * **报错**，不静默落到任何一边。
   */
  requireEmailVerification: boolean;
  /**
   * Test mode configuration. When enabled, provides endpoints for E2E testing.
   * NEVER enable in production!
   */
  testMode?: {
    enabled: boolean;
    /** Automatically verify users on registration (skip email verification) */
    autoVerifyUsers: boolean;
  };
}

/**
 * "这个实例是否**靠那封验证邮件**来激活账号" —— 三条注册路共用的**唯一**判点。
 *
 * 🔴 为什么要有这个函数而不是各处写条件：`registerWithMagicLink`（邮箱+口令与
 * 魔法链接共用）、`registerPasskey` 两条路各自都要回答这一个问题，而答案必须
 * 一样 —— 一台没配 SMTP 的自托管服务器上，"只关掉一半"的后果是用户换一条注册路
 * 就又撞回同一堵墙。两条路各抄一遍 `config.testMode?.autoVerifyUsers` 正是
 * 这种漂移的起点（AGENTS §3.5）。
 *
 * 两个让它为 false 的理由刻意不同：`TEST_MODE.autoVerifyUsers` 是 E2E 夹具，
 * `REQUIRE_EMAIL_VERIFICATION=false` 是运营者的显式选择。判点相同、日志不同
 * （调用方各自打），因为"[TEST_MODE] 出现在一台生产服务器上"是要能一眼看出来的。
 */
export const emailVerificationRequired = (config: ServerConfig): boolean =>
  config.requireEmailVerification && config.testMode?.autoVerifyUsers !== true;

/**
 * Default CORS origins — the stable production app, and nothing else.
 *
 * Every self-hosted instance inherits this default, and CORS is registered with
 * `credentials: true`. A Cloudflare Pages preview wildcard used to sit here too, which
 * meant servers we do not run granted credentialed cross-origin access to our preview
 * infrastructure by default. Preview origins belong in our own deployment's CORS_ORIGINS.
 *
 * Use the CORS_ORIGINS env var to set your own origins; wildcard subdomain patterns are
 * still supported there (see `parseCorsOrigin`), they just are not shipped as a default.
 */
const DEFAULT_CORS_ORIGINS: CorsOrigin[] = ['https://app.super-productivity.com'];

const DEFAULT_CONFIG: ServerConfig = {
  port: 1900,
  host: '0.0.0.0',
  dataDir: './data',
  publicUrl: 'http://localhost:1900',
  cors: {
    enabled: true,
    allowedOrigins: DEFAULT_CORS_ORIGINS,
  },
  // 🔴 默认关：自托管默认全放行。只有官方托管实例才该用 env 打开它。
  entitlements: {
    enabled: false,
  },
  // 🔴 默认**要**验证邮箱：官方托管实例的行为不变，关掉它是自托管的显式选择。
  requireEmailVerification: true,
  // 镜像里 bake 进来的共享 UI 位置（`server/Dockerfile` 的 web 阶段产物）。
  // 这两个默认值在容器外（本机、测试）指向不存在的目录 ⇒ 界面不挂，
  // 而启动日志会明说不挂 —— 见 `web-app.ts` 里那条日志为什么必须是 info 而不是 debug。
  webAppDir: '/app/web-dist',
  webAppPath: '/app/',
};

/**
 * Load configuration from environment variables.
 * Environment variables take precedence over defaults.
 */
/**
 * `PUBLIC_URL` 的 host 是不是**私网/回环**地址。
 *
 * 用途见 ADR-0012 §4.2：生产模式对明文 HTTP 的禁令**只该对准公网**。
 * 局域网自建（`http://192.168.1.5:3000` 这类）是自托管里最常见的形态，
 * 而 iOS 侧本来就放行它（ATS 的判据是"本地网络 vs 公网"，见 ADR-0007 §6.1）。
 * 两端口径因此一致。
 *
 * 🔴 **必须是"整个 host 就是一个私网 IP 字面量"，不能是"包含私网前缀"。**
 *    `192.168.1.5.evil.com` 前缀完全一样，但它是**公网域名**，必须返回 `false`。
 *    所以这里先把 host 整体匹配成 IPv4/IPv6 字面量，是字面量才看网段；
 *    任何域名（含上面那个）一律 `false`。
 *
 *    用 `startsWith('192.168.')` 写会把这个域名判成私网并**静默放行**，
 *    而且**不会有任何测试失败** —— 这正是 `config-public-url.spec.ts` 里
 *    专门留了一条负例的原因。
 */
export const isPrivateNetworkHost = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  // `localhost` 是回环的**名字**，不是字面量，但语义上无疑属于本地。
  if (host === 'localhost') return true;

  // IPv4 字面量：整串必须是 4 段数字，否则当域名处理。
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 127) return true; // 回环 127/8
    if (a === 10) return true; // 私有 10/8
    if (a === 192 && b === 168) return true; // 私有 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 私有 172.16/12
    if (a === 169 && b === 254) return true; // 链路本地 169.254/16
    return false;
  }

  // IPv6 字面量（含 `:`）：只看回环与唯一本地地址 fc00::/7。
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(host);
  }

  // 其余一律是域名 —— **包括 `192.168.1.5.evil.com`**。
  return false;
};

export const loadConfigFromEnv = (
  overrides: Partial<ServerConfig> = {},
): ServerConfig => {
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    cors: {
      ...DEFAULT_CONFIG.cors,
      ...(overrides.cors || {}),
    },
  };

  // Override with environment variables
  if (process.env.PORT) {
    const parsedPort = parseInt(process.env.PORT, 10);
    if (Number.isInteger(parsedPort) && parsedPort > 0) {
      config.port = parsedPort;
    } else {
      throw new Error(`Invalid PORT: ${process.env.PORT}. Must be a positive integer.`);
    }
  }

  if (process.env.HOST !== undefined) {
    const trimmedHost = process.env.HOST.trim();
    if (!trimmedHost) {
      throw new Error('Invalid HOST: must not be empty.');
    }
    if (/\s/.test(trimmedHost)) {
      throw new Error(`Invalid HOST: ${process.env.HOST}. Must not contain whitespace.`);
    }
    if (/^https?:\/\//i.test(trimmedHost) || trimmedHost.includes('/')) {
      throw new Error(
        `Invalid HOST: ${process.env.HOST}. Use a hostname or IP address without protocol or path.`,
      );
    }
    config.host = trimmedHost;
  }

  if (process.env.DATA_DIR) {
    const resolvedPath = path.resolve(process.env.DATA_DIR);
    if (!resolvedPath) {
      throw new Error(`Invalid DATA_DIR: ${process.env.DATA_DIR}`);
    }
    config.dataDir = resolvedPath;
  } else {
    // Resolve default data dir relative to cwd
    config.dataDir = path.resolve(config.dataDir);
  }

  // Public URL (for email links)
  if (process.env.PUBLIC_URL) {
    const trimmed = process.env.PUBLIC_URL.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('PUBLIC_URL must start with http:// or https://');
    }
    config.publicUrl = trimmed.replace(/\/+$/, '');
  } else {
    config.publicUrl = `http://localhost:${config.port}`;
  }

  // Enforce HTTPS for PUBLIC_URL in production — **但只对公网**。
  //
  // 这条禁令要防的是"公网上的明文"；局域网自建的明文不出网线，而 iOS 侧本来
  // 就放行它（ADR-0007 §6.1）。一律禁止会把自托管里最常见的那种形态也否掉，
  // 逼用户去跑未文档化的非生产模式。收窄的理由与负例见 ADR-0012 §4.2。
  if (process.env.NODE_ENV === 'production' && !config.publicUrl.startsWith('https://')) {
    let publicHost = '';
    try {
      publicHost = new URL(config.publicUrl).hostname;
    } catch {
      // 解析不出 host 就不放行 —— 放行是静默的，失败必须是响的。
      publicHost = '';
    }
    if (!isPrivateNetworkHost(publicHost)) {
      throw new Error('PUBLIC_URL must use HTTPS in production');
    }
  }

  // CORS configuration
  // CORS_ORIGINS overrides defaults (comma-separated list of origins)
  // Use CORS_ORIGINS=* for wildcard (NOT recommended for production)
  if (process.env.CORS_ENABLED !== undefined) {
    config.cors.enabled = process.env.CORS_ENABLED === 'true';
  }
  if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map((o) => o.trim());

    // Block universal wildcard in production - security vulnerability
    if (origins.includes('*')) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'CORS_ORIGINS wildcard (*) is not allowed in production. ' +
            'Specify explicit allowed origins for security.',
        );
      }
      Logger.warn(
        'CORS_ORIGINS contains wildcard (*). This is insecure and not recommended for production.',
      );
      // Parse non-wildcard origins, keep * as-is
      try {
        config.cors.allowedOrigins = origins.map((o) =>
          o === '*' ? o : parseCorsOrigin(o),
        );
      } catch (err) {
        throw new Error(
          `Invalid CORS_ORIGINS configuration: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      // Parse each origin (converts wildcard patterns to RegExp)
      try {
        config.cors.allowedOrigins = origins.map(parseCorsOrigin);
      } catch (err) {
        throw new Error(
          `Invalid CORS_ORIGINS configuration: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // If origins are provided, implicitly enable CORS if not explicitly disabled
    if (process.env.CORS_ENABLED === undefined) {
      config.cors.enabled = true;
    }
  }

  // SMTP Configuration
  if (process.env.SMTP_HOST) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    config.smtp = {
      host: process.env.SMTP_HOST,
      port,
      secure:
        process.env.SMTP_SECURE !== undefined
          ? process.env.SMTP_SECURE === 'true'
          : port === 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || DEFAULT_SMTP_FROM,
    };
  }

  // Privacy policy configuration. The generated policy is only served when the operator
  // has identified themselves as the controller — a policy naming the wrong controller is
  // worse than no policy at all, so every field below is required to enable it. Partial
  // configuration is a hard error rather than a silent fallback to placeholder text.
  const privacyEnv = {
    contactName: process.env.PRIVACY_CONTACT_NAME,
    addressStreet: process.env.PRIVACY_ADDRESS_STREET,
    addressCity: process.env.PRIVACY_ADDRESS_CITY,
    addressCountry: process.env.PRIVACY_ADDRESS_COUNTRY,
    contactEmail: process.env.PRIVACY_CONTACT_EMAIL,
  };
  const privacyKeys = Object.keys(privacyEnv) as (keyof typeof privacyEnv)[];
  const privacySet = privacyKeys.filter((key) => !!privacyEnv[key]?.trim());
  if (privacySet.length > 0 && privacySet.length < privacyKeys.length) {
    const missing = privacyKeys
      .filter((key) => !privacyEnv[key]?.trim())
      .map((key) => `PRIVACY_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
    throw new Error(
      `Incomplete privacy policy configuration. Missing: ${missing.join(', ')}. ` +
        `Set all of them to publish a privacy policy, or none to disable the legal pages.`,
    );
  }
  if (privacySet.length === privacyKeys.length) {
    config.privacy = {
      contactName: privacyEnv.contactName as string,
      addressStreet: privacyEnv.addressStreet as string,
      addressCity: privacyEnv.addressCity as string,
      addressCountry: privacyEnv.addressCountry as string,
      contactEmail: privacyEnv.contactEmail as string,
      hostingProvider: process.env.PRIVACY_HOSTING_PROVIDER?.trim() || undefined,
      supervisoryAuthority:
        process.env.PRIVACY_SUPERVISORY_AUTHORITY?.trim() || undefined,
    };
  }

  config.dataRegion = process.env.PRIVACY_DATA_REGION?.trim() || undefined;

  // 付费权益闸门（默认关）。
  //
  // 🔴 这个开关只有**官方托管实例**才该打开：它是 heyta 收"托管同步服务"费用的
  // 唯一入口（见 docs/plans/subscription-boundary.md）。自托管**不要开** ——
  // 开了会让自己的用户因为"没有订阅"而被拒，而自托管免费是本项目的承诺。
  //
  // 取值严格：只接受 'true' / 'false'。写错（例如 '1' / 'yes'）在这里**报错**，
  // 而不是静默落到"关" —— 一个静默失效的收费闸门比没有闸门更危险。
  if (process.env.ENTITLEMENT_GATE_ENABLED !== undefined) {
    const rawEntitlementGate = process.env.ENTITLEMENT_GATE_ENABLED.trim().toLowerCase();
    if (rawEntitlementGate !== 'true' && rawEntitlementGate !== 'false') {
      throw new Error(
        `Invalid ENTITLEMENT_GATE_ENABLED: ${process.env.ENTITLEMENT_GATE_ENABLED}. ` +
          `Use 'true' or 'false'.`,
      );
    }
    config.entitlements = { enabled: rawEntitlementGate === 'true' };
  }

  // 注册是否必须验证邮箱（默认 true = 与官方托管实例一致）。
  //
  // 关掉它 = "邮箱 + 口令"注册**当场可用**，不等那封信。这是给自托管的一等公民
  // 开关，不是测试开关（`TEST_MODE` 的 `autoVerifyUsers` 那条留给 E2E）：
  // 一台没配 SMTP 的服务器若保持 true，注册接口会返回成功话而信从来没发出去，
  // 用户被永久挡在门外 —— 见 `ServerConfig['requireEmailVerification']` 上那段。
  //
  // 🔴 代价必须写清楚：关掉以后"证明你收得到这个邮箱"这一环**没有了**，
  // 任何人都能用任意邮箱建号（找回密码也就找不到真人）。所以它只该出现在
  // "这台服务器只给自己/自己人用"的部署里。
  //
  // 取值与上面那道闸门同样严格：只接受 'true' / 'false'，写错**报错**。
  if (process.env.REQUIRE_EMAIL_VERIFICATION !== undefined) {
    const rawRequireEmailVerification =
      process.env.REQUIRE_EMAIL_VERIFICATION.trim().toLowerCase();
    if (
      rawRequireEmailVerification !== 'true' &&
      rawRequireEmailVerification !== 'false'
    ) {
      throw new Error(
        `Invalid REQUIRE_EMAIL_VERIFICATION: ${process.env.REQUIRE_EMAIL_VERIFICATION}. ` +
          `Use 'true' or 'false'.`,
      );
    }
    config.requireEmailVerification = rawRequireEmailVerification === 'true';
  }

  // 共享 UI 的位置。取值严格，理由与本文件其它闸门一致：**拼错要报错，不许静默落到"没界面"**。
  if (process.env.WEB_APP_DIR !== undefined) {
    const raw = process.env.WEB_APP_DIR.trim();
    // 空串是显式的"不挂"（本机开发与测试用），不是"忘了配"。
    if (raw !== '' && !path.isAbsolute(raw)) {
      throw new Error(
        `Invalid WEB_APP_DIR: ${JSON.stringify(process.env.WEB_APP_DIR)}. ` +
          `要的是绝对路径（例如 /app/web-dist），或空串表示这台实例不服务共享 UI。`,
      );
    }
    config.webAppDir = raw;
  }
  if (process.env.WEB_APP_PATH !== undefined) {
    const raw = process.env.WEB_APP_PATH.trim();
    if (!/^\/(?:.*\/)?$/.test(raw)) {
      throw new Error(
        `Invalid WEB_APP_PATH: ${JSON.stringify(process.env.WEB_APP_PATH)}. ` +
          `要的是首尾都带斜杠的路径（例如 /app/，或根路径用 /）。`,
      );
    }
    config.webAppPath = raw;
  }

  // 微信支付（Native 扫码）—— **运营者显式开关 + 六个凭证全齐**才注册。
  //
  // 🔴 默认关：自托管实例不接任何支付商，`registry.ts` 只注册 noop。
  // 🔴 取值严格：写错在这里**报错**，不静默落到"关"。
  // 🔴 凭证不全也是**报错**：错拼一个变量名会让 adapter 悄悄不注册，
  //    而症状是"用户付了钱没权益" —— 那是收钱路径上最坏的一种静默。
  if (process.env.WECHAT_PAY_ENABLED !== undefined) {
    const raw = process.env.WECHAT_PAY_ENABLED.trim().toLowerCase();
    if (raw !== 'true' && raw !== 'false') {
      throw new Error(
        `Invalid WECHAT_PAY_ENABLED: ${process.env.WECHAT_PAY_ENABLED}. Use 'true' or 'false'.`,
      );
    }

    if (raw === 'true') {
      const credentials = {
        appId: process.env.WX_APP_ID,
        mchId: process.env.WX_MCH_ID,
        serialNo: process.env.WX_SERIAL_NO,
        apiV3Key: process.env.WX_API_V3_KEY,
        privateKey: process.env.WX_PRIVATE_KEY,
        publicKey: process.env.WX_PUBLIC_KEY,
      };
      const credentialKeys = Object.keys(credentials) as (keyof typeof credentials)[];
      const missing = credentialKeys.filter((key) => !credentials[key]?.trim());
      if (missing.length > 0) {
        throw new Error(
          'WECHAT_PAY_ENABLED=true but wechat pay credentials are incomplete. Missing: ' +
            `${missing.map((key) => `WX_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`).join(', ')}. ` +
            'Set all of them, or turn WECHAT_PAY_ENABLED off.',
        );
      }

      // APIv3 密钥必须是 32 个字节：在启动期挡掉，而不是等第一条真实回调验签失败。
      const apiV3Key = credentials.apiV3Key as string;
      if (Buffer.byteLength(apiV3Key, 'utf8') !== 32) {
        throw new Error(
          `Invalid WX_API_V3_KEY: must be exactly 32 bytes, got ${String(Buffer.byteLength(apiV3Key, 'utf8'))}.`,
        );
      }

      // 回调地址默认由 PUBLIC_URL 推导 —— 它必须是**微信能访问到**的公网地址。
      const notifyUrl =
        process.env.WX_NOTIFY_URL?.trim() ||
        `${config.publicUrl}/api/billing/webhooks/wechat`;
      if (!/^https:\/\//i.test(notifyUrl)) {
        throw new Error(
          `WX_NOTIFY_URL must be an absolute https:// URL (got ${notifyUrl}). ` +
            'WeChat Pay refuses non-HTTPS notify URLs.',
        );
      }

      config.wechatPay = {
        appId: credentials.appId as string,
        mchId: credentials.mchId as string,
        serialNo: credentials.serialNo as string,
        apiV3Key,
        privateKey: credentials.privateKey as string,
        publicKey: credentials.publicKey as string,
        notifyUrl,
      };
    }
  }

  // Test mode configuration
  // Requires both TEST_MODE=true AND TEST_MODE_CONFIRM=yes-i-understand-the-risks
  // This double-check prevents accidental test mode enablement
  if (process.env.TEST_MODE === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TEST_MODE cannot be enabled in production');
    }
    if (process.env.TEST_MODE_CONFIRM !== 'yes-i-understand-the-risks') {
      throw new Error(
        'TEST_MODE requires TEST_MODE_CONFIRM=yes-i-understand-the-risks to prevent accidental enablement',
      );
    }
    Logger.warn(
      '⚠️  TEST_MODE is enabled - test routes are exposed. DO NOT use in production!',
    );
    config.testMode = {
      enabled: true,
      autoVerifyUsers: true,
    };
  }

  // Validation
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error(`Invalid port configuration: ${config.port}`);
  }

  if (!config.host) {
    throw new Error('Host configuration is missing');
  }

  if (!config.dataDir) {
    throw new Error('Data directory configuration is missing');
  }

  // Web Push（可选能力）。与微信支付同一姿态：ENABLED 且两个变量齐全才存在。
  if (process.env.WEB_PUSH_ENABLED === 'true') {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
    // 🔴 `sub` **没有默认值**：RFC 8292 §2.1 要求它是一条真实的联系方式
    //    （`mailto:` 或 `https:`），而推送服务**真的会校验**。给它编一个默认值
    //    等于把"你没配全"变成一个会在第一次推送时才暴露的 403。
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
    const missing = [
      ['WEB_PUSH_VAPID_PUBLIC_KEY', publicKey],
      ['WEB_PUSH_VAPID_PRIVATE_KEY', privateKey],
      ['WEB_PUSH_VAPID_SUBJECT', subject],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      // ⚠️ **启动期硬错误**，不是静默降级 —— 与 `WechatPayConfig` 同一理由：
      //    一个"看起来配了但发不出"的通道，表现为"组件有时候更新有时候不更新"。
      throw new Error(
        `WEB_PUSH_ENABLED=true 但缺少 ${missing.join(' / ')}。` +
          '要不用它就删掉 WEB_PUSH_ENABLED，要不用 server/scripts/gen-vapid-keys.mjs 生成一对密钥。',
      );
    }
    config.webPush = {
      publicKey: publicKey as string,
      privateKey: privateKey as string,
      subject: subject as string,
    };
  }

  // 托管 AI 的上游（可选能力）。与 `WECHAT_PAY_ENABLED` / `WEB_PUSH_ENABLED` 同一姿态：
  // **显式 ENABLED=true 且三项齐全才存在**，缺任何一项就在启动期**硬报错**，不静默落到"没开"。
  //
  // 🔴 为什么齐全性要在启动期判，而不是等第一个请求：一个"配了地址但没配密钥"的实例
  // 会走到"向境内供应商发一次**无授权头**的请求"—— 那既是一个 401，又是一次
  // 用户明文已经出去了的事实。顺序上它还在额度之后（`managed-proxy.routes.ts` 的闸门顺序），
  // 于是症状是"扣了一次数、拿到一个 502"。启动期报错是唯一不会付出这个代价的位置。
  //
  // ⚠️ 这里**故意不做**境内白名单校验：那是每次转发前的判据（`ai/managed-upstream.ts`），
  // 而且它必须在**发送点**再算一次（ADR-0053 §5 第 2 条）。配置层判一次就够的错觉，
  // 正是 ADR-0010 从 SSOS 抄来的那句「Enforcement has to sit on the path that actually
  // sends the request, not only on the path that stores it.」所要防的。
  if (process.env.MANAGED_AI_ENABLED === 'true') {
    const baseUrl = process.env.MANAGED_AI_UPSTREAM_BASE_URL?.trim();
    const apiKey = process.env.MANAGED_AI_UPSTREAM_API_KEY?.trim();
    const modelId = process.env.MANAGED_AI_UPSTREAM_MODEL_ID?.trim();
    const missing = [['MANAGED_AI_UPSTREAM_BASE_URL', baseUrl], ['MANAGED_AI_UPSTREAM_API_KEY', apiKey], ['MANAGED_AI_UPSTREAM_MODEL_ID', modelId]]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(
        `MANAGED_AI_ENABLED=true 但缺少 ${missing.join(' / ')}。` +
          '要么三项都配上，要么把 MANAGED_AI_ENABLED 去掉 —— 半套配置比没有配置危险：' +
          '它会先扣掉用户一次额度，再把明文送到一个必然拒绝它的端点。',
      );
    }
    config.managedAi = {
      baseUrl: (baseUrl as string).replace(/\/+$/, ''),
      apiKey: apiKey as string,
      modelId: modelId as string,
    };
  }

  return config;
};
