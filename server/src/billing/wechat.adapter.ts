/**
 * 微信支付（Native 扫码）adapter。
 *
 * 规格来源：`docs/plans/subscription-boundary.md` §6 —— 微信**没有订阅对象**，
 * 回调只说"一笔订单付成功了"，所以 adapter 归一化出来的事件里
 * `externalSubscriptionId` / `status` / `currentPeriodEnd` **一律是 `null`**，
 * 只带一个 `oneTimeGrant`（"这笔支付买到多少天"），由 `apply-event.ts` 的
 * 一次性支付路径负责把它叠加成 `Subscription` 的周期。
 *
 * ## 🔴 零依赖
 *
 * 微信官方**没有 Node 服务端 SDK**（只有 Java / PHP / Go）。这里全部用
 * `node:crypto` 手写：
 * - RSA-SHA256 签名（`WECHATPAY2-SHA256-RSA2048`）；
 * - RSA-SHA256 验签 + **时间戳时效校验**（防重放）；
 * - AES-256-GCM 回调解密；
 * - HTTP 用内置 `fetch`（可注入，测试里是 stub —— 见交付报告的"未验证部分"）。
 *
 * ## 🔴 fail-closed
 *
 * `verifyWebhook` 的每一条失败路径都返回 `{ ok: false }` 且**不抛异常**：
 * 路由据此回 401 并**不落 `PaymentEvent`** —— 否则攻击者可以用垃圾请求把某个
 * eventId 提前占掉，真事件到达时被当成重复而丢弃（`webhook.routes.ts` 的注释）。
 *
 * ## 本文件分成两层
 *
 * 1. **纯函数层**（文件上半部分，全部导出）：签名串拼接 / 签名 / 验签 /
 *    时间戳时效 / AES-GCM 解密 / PEM 归一化 / `out_trade_no` 编解码。
 *    它们**不碰网络、不读环境变量**，可以脱离 adapter 单独测。
 * 2. **adapter 层**（`createWechatBillingAdapter`）：把上面这些拼成
 *    `BillingAdapter` 的四个方法。
 */
import {
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';
import { MIN_CHARGEABLE_AMOUNT_MINOR, isMinorAmount } from './money';
import { DEFAULT_PRICE_BOOK, projectPrices } from './price-book';
import type {
  BillingAdapter,
  CheckoutResult,
  CreateCheckoutInput,
  NormalizedPaymentEvent,
  RevokeEntitlementInput,
  SubscriptionStatus,
  WebhookHeaders,
  WebhookVerification,
} from './types';

/** provider 名。与 `PaymentEvent.provider` / 路由路径 `/webhooks/wechat` 同值。 */
export const WECHAT_PROVIDER = 'wechat';

/** Native 下单的 APIv3 路径（**相对路径**，签名串里用的就是它）。 */
export const WECHAT_NATIVE_PATH = '/v3/pay/transactions/native';

/**
 * APIv3 入口。刻意是常量而不是配置项：微信支付只有一个生产入口，
 * 把它做成可配置只会让"指向哪里"在部署里漂移（沙箱环境另说，见 TODO）。
 */
export const WECHAT_API_BASE_URL = 'https://api.mch.weixin.qq.com';

/**
 * 回调签名的**时间戳时效窗口**。微信文档是 5 分钟。
 *
 * 🔴 只有验签是不够的：一个被录下来的合法回调可以**永远**重放。时间戳时效
 * 是防重放的那一半，必须在验签之外**单独**检查（两者都过才放行）。
 * 用 `Math.abs` 双向约束：既拒绝过旧的，也拒绝**过于超前**的 —— 否则一个
 * 时间戳写着"100 年后"的伪造体可以让重放窗口变成永远（虽然它仍然要过签名）。
 */
export const WECHAT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** 阶段一的产品：一次性年付。与 `packages/domain` 的 `SUBSCRIPTION_PERIOD_DAYS` 同值。 */
export const WECHAT_ONE_TIME_PERIOD_DAYS = 365;

/** 默认回调地址的路径（`notify_url` 一般是 `PUBLIC_URL` + 它）。 */
export const WECHAT_NOTIFY_PATH = '/api/billing/webhooks/wechat';

// ---------------------------------------------------------------------------
// 1. 请求签名（纯函数）
// ---------------------------------------------------------------------------

export interface WechatRequestSignatureInput {
  /** HTTP 方法，大小写不敏感（内部会转大写）。 */
  readonly method: string;
  /** 参与签名的 URL：**路径 + query**，不含 scheme/host。 */
  readonly url: string;
  /** Unix 秒。 */
  readonly timestamp: number;
  readonly nonce: string;
  /** **原样的**请求体字符串（不是重新序列化的对象）。 */
  readonly body: string;
}

/**
 * 请求签名串：`method\nurl\ntimestamp\nnonce\nbody\n`。
 *
 * 🔴 末尾的 `\n` 是签名串的一部分。少了它签出来的串微信一律拒绝，
 * 而错误信息只会说"签名错误" —— 这是最容易在联调里烧掉半天的一处。
 *
 * 🔴 `body` 必须是**发出去的那个字符串**。先 `JSON.stringify` 存下来再签名、
 * 再用同一个字符串发出去；签名和发送分别 stringify 会在键序/空白上漂移。
 */
export const buildRequestSignatureMessage = (
  input: WechatRequestSignatureInput,
): string =>
  `${input.method.toUpperCase()}\n${input.url}\n${input.timestamp}\n${input.nonce}\n${input.body}\n`;

/** 用商户私钥做 RSA-SHA256，返回 base64 签名。 */
export const signWechatRequest = (
  input: WechatRequestSignatureInput,
  privateKeyPem: string,
): string =>
  createSign('RSA-SHA256')
    .update(buildRequestSignatureMessage(input), 'utf8')
    .sign(privateKeyPem, 'base64');

export interface WechatAuthorizationInput {
  readonly mchId: string;
  readonly serialNo: string;
  readonly nonce: string;
  readonly timestamp: number;
  readonly signature: string;
}

/**
 * `Authorization` 头的形状（字段顺序与微信文档一致；它不参与签名）。
 */
export const buildWechatAuthorizationHeader = (
  input: WechatAuthorizationInput,
): string =>
  'WECHATPAY2-SHA256-RSA2048 ' +
  `mchid="${input.mchId}",` +
  `nonce_str="${input.nonce}",` +
  `signature="${input.signature}",` +
  `timestamp="${input.timestamp}",` +
  `serial_no="${input.serialNo}"`;

// ---------------------------------------------------------------------------
// 2. 回调验签 + 时间戳时效（纯函数）
// ---------------------------------------------------------------------------

/**
 * 验签串：`timestamp\nnonce\nbody\n`。
 *
 * 用 `Buffer` 拼接而不是先把 body 转成字符串：body 是**原始字节**，
 * 先解码再编码会经过一次 UTF-8 往返，任何非规范字节都会让签名对不上。
 */
export const buildWebhookSignatureMessage = (
  input: { readonly timestamp: string; readonly nonce: string },
  rawBody: Buffer,
): Buffer =>
  Buffer.concat([
    Buffer.from(`${input.timestamp}\n${input.nonce}\n`, 'utf8'),
    rawBody,
    Buffer.from('\n', 'utf8'),
  ]);

/**
 * 平台公钥验签。**任何异常都返回 `false`**（密钥格式错、签名不是合法 base64…），
 * 这是 fail-closed 的落点：验不出来就是没通过，不是"抛出去让上层决定"。
 */
export const verifyWechatSignature = (input: {
  readonly message: Buffer;
  readonly signature: string;
  readonly publicKeyPem: string;
}): boolean => {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(input.message);
    verifier.end();
    return verifier.verify(input.publicKeyPem, Buffer.from(input.signature, 'base64'));
  } catch {
    return false;
  }
};

/**
 * 回调时间戳（**Unix 秒**）是否落在时效窗口内。见 `WECHAT_SIGNATURE_MAX_AGE_MS`。
 *
 * 非数字 / 空串一律 `false`。`toleranceMs` 可注入，便于把边界测成确定场景。
 */
export const isWechatTimestampFresh = (
  timestamp: unknown,
  now: number,
  toleranceMs: number = WECHAT_SIGNATURE_MAX_AGE_MS,
): boolean => {
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return false;
  const raw = typeof timestamp === 'string' ? timestamp.trim() : timestamp;
  if (raw === '') return false;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return false;
  if (!Number.isFinite(now)) return false;
  return Math.abs(now - seconds * 1000) <= toleranceMs;
};

// ---------------------------------------------------------------------------
// 3. 回调解密（AES-256-GCM，纯函数）
// ---------------------------------------------------------------------------

export interface WechatResourceCiphertext {
  /** base64。**密文与 16 字节 auth tag 拼在一起**（微信就是这么给的）。 */
  readonly ciphertext: string;
  /** 12 字节 ASCII nonce。 */
  readonly nonce: string;
  /** AAD；微信在没有关联数据时给空串，也可能是 `undefined`。 */
  readonly associatedData?: string | undefined;
}

/**
 * 解密 `resource`。密钥是 **APIv3 密钥的 32 个 ASCII 字节**（不是 base64 解码）。
 *
 * 🔴 微信的 `ciphertext` 是 `base64(密文 || authTag)` —— authTag 是**最后 16 字节**，
 * 必须切出来单独 `setAuthTag`，否则 `final()` 恒抛。这是 AES-GCM 手写的经典坑。
 *
 * 认证失败（密钥错 / 数据被改）时**抛异常**：调用方 `verifyWebhook` 会把它转成
 * `{ ok: false, reason: 'decrypt-failed' }`，仍然不落任何行。
 * 这里刻意不返回 `null` —— 解密是"要么对要么错"，静默返回空值会让上层
 * 拿一个空对象继续走。
 */
export const decryptWechatResource = (
  resource: WechatResourceCiphertext,
  apiV3Key: string,
): Buffer => {
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== 32) {
    throw new Error(
      `微信 APIv3 密钥必须是 32 个字节，实际 ${key.length} 个（WX_API_V3_KEY 配置错误）`,
    );
  }
  if (resource.nonce.length === 0) {
    throw new Error('微信回调 resource.nonce 为空');
  }

  const raw = Buffer.from(resource.ciphertext, 'base64');
  if (raw.length <= 16) {
    throw new Error('微信回调 resource.ciphertext 太短（密文 + 16 字节 authTag）');
  }
  const authTag = raw.subarray(raw.length - 16);
  const encrypted = raw.subarray(0, raw.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(resource.associatedData ?? '', 'utf8'));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

// ---------------------------------------------------------------------------
// 4. 杂项纯函数
// ---------------------------------------------------------------------------

/**
 * 把环境变量里的密钥归一成 PEM。
 *
 * 运营者可能三种写法之一：多行 PEM、把换行写成 `\n` 的单行 PEM、
 * 或整个 PEM 的 base64。这里都接受；**其余一律抛异常**，不猜、不兜底 ——
 * 密钥解析失败必须响，静默用一个坏密钥会让所有回调验签失败而看起来像"微信没回调"。
 */
export const normalizePemKey = (value: string, label: string): string => {
  const unescaped = value.replace(/\\n/g, '\n').trim();
  if (unescaped.includes('-----BEGIN')) return unescaped;

  const decoded = Buffer.from(unescaped, 'base64').toString('utf8').trim();
  if (decoded.includes('-----BEGIN')) return decoded;

  throw new Error(`${label} 既不是 PEM，也不是 PEM 的 base64 编码`);
};

/** 微信时间戳（ISO 8601，带 `+08:00` 偏移）→ epoch 毫秒；无法解析返回 `undefined`。 */
export const parseWechatTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * 商户订单号格式：`hy<uid 的 36 进制>x<unix 秒的 36 进制>x<8 字节随机 hex>`。
 *
 * 🔴 为什么把 userId 编进订单号：微信的 `attach` 字段**在回调里可能出现也可能不出现**
 * （它取决于下单时是否带了、以及通知模板）。订单号是我们自己生成的，把它当作
 * **兜底**的用户归属来源，可以让"attach 丢了"从"授予不到用户"降级成"照常授予"。
 * 长度 ~28 字符，在微信 32 字符上限内。
 */
export const buildWechatOutTradeNo = (
  userId: number,
  nowMs: number,
  randomHex: string,
): string => {
  const uid = Math.trunc(userId).toString(36);
  const ts = Math.floor(nowMs / 1000).toString(36);
  return `hy${uid}x${ts}x${randomHex}`;
};

const OUT_TRADE_NO_PATTERN = /^hy([0-9a-z]+)x[0-9a-z]+x[0-9a-f]+$/;

/** 从商户订单号里取回 userId；不符合本 adapter 的格式返回 `null`。 */
export const parseUserIdFromOutTradeNo = (outTradeNo: string): number | null => {
  const match = OUT_TRADE_NO_PATTERN.exec(outTradeNo);
  if (match === null) return null;
  const id = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** 从 `attach` 字段取 userId（我们下单时写的是十进制字符串）。 */
export const parseUserIdFromAttach = (attach: unknown): number | null => {
  if (typeof attach !== 'string' || attach.trim() === '') return null;
  if (!/^\d+$/.test(attach.trim())) return null;
  const id = Number.parseInt(attach, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** header 取值：Node/Fastify 遇到重复 header 会给数组。 */
const readHeader = (
  headers: WebhookHeaders,
  name: string,
): string | undefined => {
  const lower = name.toLowerCase();
  let raw: string | string[] | undefined;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      raw = headers[key];
      break;
    }
  }
  if (Array.isArray(raw)) return raw[0];
  return raw;
};

// ---------------------------------------------------------------------------
// 5. adapter 层
// ---------------------------------------------------------------------------

/** 一个 priceId 对应的金额与描述。金额用**分**（整数），避免浮点。 */
export interface WechatPrice {
  readonly totalFen: number;
  readonly description: string;
}

/**
 * 默认价目表 —— **由代码基线价目表投影出来，不是又一个字面量**。
 *
 * ✅ **已定价**（一次性年付 ¥99 = 9900 分）。价格结论见 ADR-0017 / ADR-0018，
 * 价格表见 `docs/reference/pricing-and-entitlements.md`。
 *
 * 🔴 **这里刻意没有 `totalFen: 9_900` 这样的字面量。** 在有这一版之前，
 * 同一个数字住在三个地方（这个文件、词条表、法务文本），靠
 * `scripts/check-pricing-consistency.mjs` 事后比对来维持一致；而门禁的比对
 * 本身也可能失效。现在**同一个数字只写一次**（`price-book.ts` 的
 * `DEFAULT_PRICE_BOOK`），这个文件只是它的投影，"改了这里忘了改那里"
 * 这个失效模式就从"靠门禁抓"变成了**不可能发生**。
 *
 * ⚠️ 门禁仍然保留，而且现在多了一条：`wechat.adapter.ts` 里**不许再出现
 * `totalFen: <数字>`** —— 防止有人"顺手"把数字抄回来。
 *
 * ---------------------------------------------------------------------------
 * 🔴 **这张表不再决定收多少钱。** 它现在只提供 `description`（账单上给用户看的
 * 商品名），**金额由调用方通过 `CreateCheckoutInput.amountMinor` 传入**。
 *
 * 原因：价格有运行期版本（`price_versions`），只有计价层知道"这一刻该收多少"，
 * 而那个数已经和券一起冻在 `checkout_orders.final_amount_minor` 上。
 * 在改掉之前，adapter 自己查这张表下单 —— 于是运营者 `publishPriceVersion` 之后
 * **报价层收新价、收银台按旧价下单**，静默分叉。那正是 ADR-0018 §3.1 要消灭的形状，
 * 而且它发生在这条路径的**最末端**（真收钱的那一步）。
 *
 * `prices` 选项保留下来只为覆盖 `description`；改价**不再**经过它。
 * 运行期改价走 `publishPriceVersion`（见 `pricing-store.ts`）。
 * （本轮**不做** env 价目表解析：把一个 JSON 表塞进环境变量比它的价值更容易出错。）
 */
export const WECHAT_DEFAULT_PRICES: Readonly<Record<string, WechatPrice>> = projectPrices(
  DEFAULT_PRICE_BOOK,
  'CNY',
  0,
);

export interface WechatPayAdapterOptions {
  readonly appId: string;
  readonly mchId: string;
  /** 商户证书序列号。 */
  readonly serialNo: string;
  /** APIv3 密钥（32 个 ASCII 字节）。 */
  readonly apiV3Key: string;
  /** 商户私钥（PEM 或 PEM 的 base64）。 */
  readonly privateKey: string;
  /** 微信支付平台公钥（PEM 或 PEM 的 base64）。 */
  readonly publicKey: string;
  /** 回调地址，绝对 URL。 */
  readonly notifyUrl: string;
  readonly prices?: Readonly<Record<string, WechatPrice>>;
  /** 可注入时钟（epoch 毫秒）。默认 `Date.now`。 */
  readonly now?: () => number;
  /** 可注入 fetch，仅用于测试打桩。默认全局 `fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /**
   * 退款 / 拒付时的权益回收端口。
   *
   * 🔴 微信 adapter **没有数据库访问**，而且微信的一次性支付**没有订阅对象**，
   * 所以 `RevokeEntitlementInput.externalSubscriptionId` 对微信是空串。
   * 真正的回收必须由调用方按 `out_trade_no` 找到用户后**只改状态**。
   * 没注入时这里是**有意的空操作**，且绝不删除任何数据 ——
   * 与 `noop.adapter.ts` 同一条硬约束。
   */
  readonly onRevoke?: (input: RevokeEntitlementInput) => Promise<void>;
}

/** 微信 APIv3 返回非 2xx 时抛这个。**不吞状态码**：调用方要能看见原因。 */
export class WechatApiError extends Error {
  readonly code = 'WECHAT_API_ERROR';

  constructor(
    readonly httpStatus: number,
    readonly apiCode: string | undefined,
    apiMessage: string | undefined,
  ) {
    super(
      `微信支付 APIv3 请求失败（HTTP ${httpStatus}` +
        `${apiCode ? `, code=${apiCode}` : ''}${apiMessage ? `, message=${apiMessage}` : ''}）`,
    );
    this.name = 'WechatApiError';
  }
}

/** 价目表里没有这个 priceId 时抛这个 —— 不静默按 0 元下单。 */
export class WechatUnknownPriceError extends Error {
  readonly code = 'WECHAT_UNKNOWN_PRICE';

  constructor(priceId: string) {
    super(`微信支付价目表里没有 priceId "${priceId}"，拒绝下单`);
    this.name = 'WechatUnknownPriceError';
  }
}

/**
 * 调用方传进来的 `amountMinor` 不是可收的金额（非正整数）时抛这个。
 *
 * 🔴 这一条不是防御性编程，它是**本轮那个 HIGH 缺陷的封堵**：
 * 在它之前，adapter 自己从价目表里查金额下单（代码基线），于是运营者用
 * `publishPriceVersion` 改了价之后，**报价层收新价、收银台仍按旧价下单** ——
 * 没有报错、没有日志，只有少收的钱。现在金额只能由调用方（计价层）给出，
 * 而计价层的金额来自带生效区间的价目表版本、并在 `checkout_orders` 上冻结。
 */
export class WechatInvalidAmountError extends Error {
  readonly code = 'WECHAT_INVALID_AMOUNT';

  constructor(amountMinor: unknown) {
    super(`微信支付金额必须是正整数最小单位，收到 ${JSON.stringify(amountMinor)}，拒绝下单`);
    this.name = 'WechatInvalidAmountError';
  }
}

/**
 * 构造微信 Native 扫码 adapter。
 *
 * 行为逐条：
 * - `createCheckout` → `POST /v3/pay/transactions/native`，返回 `{ qrCode: code_url }`。
 *   `successUrl` / `cancelUrl` **对 Native 无意义，被忽略**（扫码支付没有回跳；
 *   到账靠 webhook）。
 * - `verifyWebhook` → 验签 + 时间戳时效 + 解密 + 归一化；任何一步失败都 fail-closed。
 * - `mapSubscriptionState` → **恒 `null`**：微信没有订阅状态机，
 *   不编一个（这是 `types.ts` 明说的"支付宝 / 微信没有订阅状态机 → status 为 null"）。
 * - `revokeEntitlement` → 走注入的 `onRevoke`；没注入就什么都不做，**从不删除**。
 */
export const createWechatBillingAdapter = (
  options: WechatPayAdapterOptions,
): BillingAdapter => {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const prices = options.prices ?? WECHAT_DEFAULT_PRICES;
  const privateKey = normalizePemKey(options.privateKey, 'WX_PRIVATE_KEY');
  const publicKey = normalizePemKey(options.publicKey, 'WX_PUBLIC_KEY');

  return {
    provider: WECHAT_PROVIDER,

    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
      // `priceId` 仍然要认得出来（它决定账单上的商品名），但**它不再决定金额**。
      const price = prices[input.priceId];
      if (price === undefined) {
        throw new WechatUnknownPriceError(input.priceId);
      }
      if (!isMinorAmount(input.amountMinor) || input.amountMinor < MIN_CHARGEABLE_AMOUNT_MINOR) {
        throw new WechatInvalidAmountError(input.amountMinor);
      }

      const outTradeNo = buildWechatOutTradeNo(
        input.userId,
        now(),
        randomBytes(8).toString('hex'),
      );
      const payload = {
        appid: options.appId,
        mchid: options.mchId,
        description: price.description,
        out_trade_no: outTradeNo,
        notify_url: options.notifyUrl,
        // attach 是**兜底**的用户归属来源；真正的归属也编在 out_trade_no 里。
        attach: String(input.userId),
        amount: { total: input.amountMinor, currency: 'CNY' },
      };
      // 🔴 只 stringify 一次：签名和发送必须是同一个字节串。
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(now() / 1000);
      const nonce = randomBytes(16).toString('hex');
      const signature = signWechatRequest(
        { method: 'POST', url: WECHAT_NATIVE_PATH, timestamp, nonce, body },
        privateKey,
      );

      const response = await fetchImpl(`${WECHAT_API_BASE_URL}${WECHAT_NATIVE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'heyta-sync-server/wechat-native',
          Authorization: buildWechatAuthorizationHeader({
            mchId: options.mchId,
            serialNo: options.serialNo,
            nonce,
            timestamp,
            signature,
          }),
        },
        body,
      });

      const parsed = (await response.json().catch(() => ({}))) as {
        code_url?: unknown;
        code?: unknown;
        message?: unknown;
      };

      if (!response.ok) {
        throw new WechatApiError(
          response.status,
          typeof parsed.code === 'string' ? parsed.code : undefined,
          typeof parsed.message === 'string' ? parsed.message : undefined,
        );
      }
      if (typeof parsed.code_url !== 'string' || parsed.code_url === '') {
        throw new WechatApiError(response.status, 'MISSING_CODE_URL', '响应里没有 code_url');
      }

      // Native 的 code_url 是**二维码内容**，不是跳转地址 → 走 qrCode 这一支。
      return { qrCode: parsed.code_url };
    },

    async verifyWebhook(
      rawBody: Buffer,
      headers: WebhookHeaders,
    ): Promise<WebhookVerification> {
      const signature = readHeader(headers, 'wechatpay-signature');
      const timestamp = readHeader(headers, 'wechatpay-timestamp');
      const nonce = readHeader(headers, 'wechatpay-nonce');
      if (!signature || !timestamp || !nonce) {
        return { ok: false, reason: 'missing-signature-headers' };
      }

      // 时效**先于**验签：省掉对一个必然过期的报文做 RSA 运算（也顺手挡掉重放）。
      if (!isWechatTimestampFresh(timestamp, now())) {
        return { ok: false, reason: 'stale-timestamp' };
      }

      const verified = verifyWechatSignature({
        message: buildWebhookSignatureMessage({ timestamp, nonce }, rawBody),
        signature,
        publicKeyPem: publicKey,
      });
      if (!verified) {
        return { ok: false, reason: 'invalid-signature' };
      }

      let envelope: {
        event_type?: unknown;
        resource_type?: unknown;
        resource?: {
          ciphertext?: unknown;
          nonce?: unknown;
          associated_data?: unknown;
        };
      };
      try {
        envelope = JSON.parse(rawBody.toString('utf8')) as typeof envelope;
      } catch {
        return { ok: false, reason: 'malformed-payload' };
      }

      // 本轮只接"支付成功"。其余事件（退款 / 撤销）**明确拒绝**而不是静默忽略：
      // 静默忽略会落一条 PaymentEvent 却没有对应语义，比 401 更难排查。
      // 退款回收仍是已知缺口（见文件头与 `onRevoke` 注释）。
      if (envelope.event_type !== 'TRANSACTION.SUCCESS') {
        return { ok: false, reason: 'unsupported-event-type' };
      }

      const resource = envelope.resource;
      if (
        resource === undefined ||
        typeof resource.ciphertext !== 'string' ||
        typeof resource.nonce !== 'string'
      ) {
        return { ok: false, reason: 'malformed-resource' };
      }

      let plaintext: Buffer;
      try {
        plaintext = decryptWechatResource(
          {
            ciphertext: resource.ciphertext,
            nonce: resource.nonce,
            associatedData:
              typeof resource.associated_data === 'string'
                ? resource.associated_data
                : undefined,
          },
          options.apiV3Key,
        );
      } catch {
        return { ok: false, reason: 'decrypt-failed' };
      }

      let payload: {
        out_trade_no?: unknown;
        trade_state?: unknown;
        success_time?: unknown;
        attach?: unknown;
        amount?: { total?: unknown } | undefined;
      };
      try {
        payload = JSON.parse(plaintext.toString('utf8')) as typeof payload;
      } catch {
        return { ok: false, reason: 'malformed-resource' };
      }

      if (payload.trade_state !== 'SUCCESS') {
        return { ok: false, reason: 'unsupported-trade-state' };
      }
      if (typeof payload.out_trade_no !== 'string' || payload.out_trade_no === '') {
        return { ok: false, reason: 'missing-out-trade-no' };
      }

      const occurredAt = parseWechatTime(payload.success_time);
      if (occurredAt === undefined) {
        return { ok: false, reason: 'invalid-event-time' };
      }

      const userId =
        parseUserIdFromAttach(payload.attach) ??
        parseUserIdFromOutTradeNo(payload.out_trade_no);

      // 🔴 金额校验 —— 付的钱必须落在价目表上，否则**不授予**。
      //
      // 没有这一道的话：一笔 ¥1 的订单（或任何未来新增的低价 SKU、测试单）
      // 会按 `WECHAT_ONE_TIME_PERIOD_DAYS` 授予**整整一年**。
      // 这是会实际损失钱的那类洞，不是理论问题。
      //
      // ⚠️ **判据是"金额是价目表里的某一个"**，不是"金额对应的是这一单买的那一项"。
      // 有券之后两者**不再等价**（¥99 用 ¥20 券 → 实付 ¥79，而 ¥79 不在价目表上）。
      //
      // 🔴 **诚实的现状：这一层目前是终局判定，不是粗筛。** 它给出
      // `oneTimeGrant: null` 之后，`apply-event.ts` 会把这笔事件归成
      // `{ status: 'ignored', reason: 'NO_SUBSCRIPTION_REFERENCE' }` ——
      // 也就是**一笔用了券、真实到账的支付会被拒绝授予权益**。
      //
      // 本该接住这个假阴性的是 `pricing-store.ts` 的 `settleOrderPaid`
      // （它比的是订单上冻结的 `final_amount_minor`，同时覆盖 SKU 与折扣），
      // 但**它目前没有任何生产调用方** —— 只有测试与 `index.ts` 的导出。
      // 支付通道本身还没接线（ADR-0017 §5），所以这个洞今天是**潜伏的**：
      // 还没有代码能把一张券带进收银台。
      //
      // 🔴 接线时必须一起做的：金额的**权威判定只留在 `settleOrderPaid`**
      // （比订单冻结金额），这一层退化成"把观察到的金额与异常如实报上去"。
      // 在那之前，**不要把任何打折的支付接进来** —— 它会被静默拒付。
      // 见 `docs/reference/pricing-and-coupons.md` §7。
      const paidFen =
        typeof payload.amount?.total === 'number' ? payload.amount.total : null;
      const knownAmounts = new Set(
        Object.values(options.prices ?? WECHAT_DEFAULT_PRICES).map((x) => x.totalFen),
      );
      const amountMatchesPrice = paidFen !== null && knownAmounts.has(paidFen);

      return {
        ok: true,
        event: {
          provider: WECHAT_PROVIDER,
          // 🔴 幂等键 = `out_trade_no`（规格 §3.1/§6.2），并带上归一化事件类型，
          // 这样同一订单的**不同事件**（未来的退款）不会和支付事件互相顶掉。
          // 复投的同一通知 → 同一个 out_trade_no → 同一个键 → 唯一约束挡住。
          providerEventId: `payment_succeeded:${payload.out_trade_no}`,
          // 金额对不上时用**不同的事件类型**落审计 —— 能查到"有人付了不对的钱",
          // 而不是悄悄当成一次正常支付。
          eventType: amountMatchesPrice ? 'payment_succeeded' : 'payment_amount_mismatch',
          occurredAt,
          externalSubscriptionId: null,
          // 微信没有订阅状态机 → 明确 null，不编。
          status: null,
          currentPeriodEnd: null,
          userId,
          // 🔴 授予语义的入口：apply-event 据此走一次性支付路径。
          // 金额对不上 → `null` → **不授予任何权益**（fail-closed）。
          oneTimeGrant: amountMatchesPrice
            ? { periodDays: WECHAT_ONE_TIME_PERIOD_DAYS }
            : null,
        } satisfies NormalizedPaymentEvent,
      };
    },

    mapSubscriptionState(_providerState: unknown): SubscriptionStatus | null {
      // 🔴 微信支付**没有订阅状态机**。这里不是"还没实现"，而是正确答案：
      // 编一个映射表等于把"一次性支付"假装成"订阅"。
      return null;
    },

    async revokeEntitlement(input: RevokeEntitlementInput): Promise<void> {
      // 只回收权益状态，**从不删除任何数据**（本文件里没有任何删除调用）。
      if (options.onRevoke !== undefined) {
        await options.onRevoke(input);
      }
      // 没注入端口时是有意的空操作 —— 退款回收的已知缺口见文件头。
    },
  };
};