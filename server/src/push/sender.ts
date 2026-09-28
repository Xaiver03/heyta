/**
 * 把一条推送**真的发出去**（RFC 8030 的 POST + RFC 8291 的载荷 + RFC 8292 的认证）。
 * ================================================================================
 *
 * 三件事在这个文件里合成一次请求，而它们各自都已经单独验过：
 * `push-crypto`（对着 RFC 8291 的向量）、`vapid`（对着 ES256 的形状）。
 * 这个文件本身**不做密码学**，它做的是**把三者按正确的方式拼起来** ——
 * 而这里仍然有两个只有真发过才知道的坑：
 *
 * | 坑 | 症状 |
 * |---|---|
 * | `Content-Encoding` 没写或写错 | 推送服务直接拒绝；而且**载荷是密文**，没有任何线索 |
 * | `TTL` 没写 | 很多推送服务要求它（`TTL: 0` 还有"只发在线设备"的语义） |
 *
 * ## 🔴 这个文件**故意**不重试
 *
 * Web Push 的重试语义由推送服务负责（它才是那个知道设备在不在线的一方）。
 * 我们自己重试的后果是**重复推送**：同一条"该刷新了"发两次，
 * 白天看起来没事，但每次重试都要重新走一遍 ECDH + AES —— 而设备端收到的
 * 是**两个**唤醒。所以：
 *
 * - `410 Gone` / `404` → 订阅**已经死了**，调用方应该删掉它（返回 `gone`）。
 * - `429` / `5xx` → 交给推送服务自己重试，这里如实返回 `retryable`。
 *
 * 这个区分是**承重的**：把 `410` 当成"过一会儿再试"会让一个死订阅
 * 被永远重试下去，而每次都要跑一遍密码学。
 */

import {
  encryptPushPayload,
  generateServerKeyPair,
  PUSH_CONTENT_ENCODING,
  PUSH_MAX_PLAINTEXT,
  type EncryptResult,
} from './push-crypto';
import { buildVapidHeader, type VapidKeys } from './vapid';

/** 推送的存活时间（秒）。**不是**"多久之后重试"，是"多久之后作废"。 */
export const DEFAULT_PUSH_TTL_SECONDS = 12 * 60 * 60;

/**
 * 推送的"紧急度"（RFC 8030 §5.3）。
 *
 * ⚠️ `high` 会让设备**立刻**醒来（省电模式下也会）。我们只是要刷新一个组件，
 * 用 `normal` 就够 —— 而用 `high` 换来的是"组件早几十秒更新"和
 * "用户在半夜被唤醒耗电"。所以默认 `normal`，且**不提供**改的入口。
 */
export const PUSH_URGENCY = 'normal';

export interface WidgetPushSubscription {
  /** 推送服务给的完整 URL。**它本身就是一个凭据** —— 不要记进日志。 */
  endpoint: string;
  /** 用户代理的 P-256 公钥，base64url。 */
  p256dh: string;
  /** 用户代理的 16 字节认证密钥，base64url。 */
  auth: string;
}

export interface SendWidgetPushInput {
  subscription: WidgetPushSubscription;
  /** 要发的内容（对 heyta 来说是**已经密封好的快照信封**）。 */
  plaintext: string;
  vapid: VapidKeys;
  /** VAPID 的 `sub`（`mailto:` / `https:`）。 */
  subject: string;
  /** 注入 `fetch` —— 测试里不真的发网络请求。 */
  fetchImpl?: typeof fetch;
  nowSeconds?: number;
  ttlSeconds?: number;
  /** 注入盐与密钥对，让测试能断言**逐字节**的请求体。 */
  salt?: Buffer;
  serverKeyPair?: { privateKey: Buffer; publicKey: Buffer };
}

export type PushOutcome =
  /** 推送服务收下了（`201` / `202`，有些实现回 `200`）。 */
  | { kind: 'sent'; status: number }
  /** 🔴 **订阅已经死了**（`404` / `410`）。调用方**必须**删掉它。 */
  | { kind: 'gone'; status: number }
  /** 推送服务暂时不行（`429` / `5xx` / 网络错）。**我们不重试**，交给它自己。 */
  | { kind: 'retryable'; status: number | null; reason: string }
  /** 请求本身有问题（`400` / `401` / `403`）。**重试没有意义**，要去改代码。 */
  | { kind: 'rejected'; status: number; reason: string };

/**
 * ⚠️ **交叉类型，不是 `interface extends`** —— `PushOutcome` 是一个**联合**，
 * 而 `interface` 只能继承"成员静态可知的对象类型"。
 * 写成 `interface … extends PushOutcome` 会得到：
 * `An interface can only extend an object type or intersection of object types
 * with statically known members.` —— 而报错落在 `extends` 那一行，
 * 不是落在真正想表达的类型上。
 */
export type SendWidgetPushResult = PushOutcome & {
  /** 请求体的字节数。用来核对"有没有超过推送服务的 4096 上限"。 */
  bodyBytes: number;
};

/** base64url → Buffer，并给出**带字段名**的错误 —— 不然只能靠猜是哪个字段坏了。 */
function decodeField(name: string, value: string, expectedLength: number): Buffer {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== expectedLength) {
    throw new Error(`${name} 必须是 ${expectedLength} 字节，收到 ${bytes.length}`);
  }
  return bytes;
}

export async function sendWidgetPush(input: SendWidgetPushInput): Promise<SendWidgetPushResult> {
  const fetchImpl = input.fetchImpl ?? fetch;

  // ⚠️ 明文超限在这里**早失败**（`encryptPushPayload` 也会拦，但那里的报错
  //    不会说"这是 heyta 的快照信封太大了"，排查时会往证书/网络方向想）。
  const plaintextBytes = Buffer.byteLength(input.plaintext, 'utf8');
  if (plaintextBytes > PUSH_MAX_PLAINTEXT) {
    throw new Error(
      `快照信封 ${plaintextBytes} 字节超过单条推送上限 ${PUSH_MAX_PLAINTEXT} —— ` +
        'Windows 推送服务只保证支持 4096 字节请求体',
    );
  }

  const serverKeyPair = input.serverKeyPair ?? generateServerKeyPair();
  const encrypted: EncryptResult = encryptPushPayload({
    plaintext: Buffer.from(input.plaintext, 'utf8'),
    uaPublic: decodeField('p256dh', input.subscription.p256dh, 65),
    authSecret: decodeField('auth', input.subscription.auth, 16),
    asPrivate: serverKeyPair.privateKey,
    asPublic: serverKeyPair.publicKey,
    ...(input.salt ? { salt: input.salt } : {}),
  });

  const vapidHeader = buildVapidHeader({
    endpoint: input.subscription.endpoint,
    keys: input.vapid,
    subject: input.subject,
    ...(input.nowSeconds === undefined ? {} : { nowSeconds: input.nowSeconds }),
  });

  const response = await fetchImpl(input.subscription.endpoint, {
    method: 'POST',
    headers: {
      // 🔴 这三个头缺一个都会被拒，而**载荷是密文** —— 报错里不会有任何线索。
      Authorization: vapidHeader.authorization,
      'Content-Encoding': PUSH_CONTENT_ENCODING,
      'Content-Type': 'application/octet-stream',
      // ⚠️ `TTL` 是**必须**的：RFC 8030 §5.2 要求它，而在没有 `Topic` 时
      //    它也决定了"设备离线时这条还留多久"。
      TTL: String(input.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS),
      Urgency: PUSH_URGENCY,
    },
    // ⚠️ `Buffer` 在 fetch 里是合法的 BodyInit，但显式转成 `Uint8Array`
    //    能避免不同 runtime 对 `Buffer` 的待遇差异（Node 的 undici 认它）。
    body: new Uint8Array(encrypted.body),
  });

  const status = response.status;
  const bodyBytes = encrypted.body.length;

  if (status === 404 || status === 410) {
    // 🔴 **死订阅**。这个分支必须与"暂时不行"分开 —— 见文件头。
    return { kind: 'gone', status, bodyBytes };
  }
  if (status === 429 || status >= 500) {
    return { kind: 'retryable', status, reason: `推送服务暂时不行（HTTP ${status}）`, bodyBytes };
  }
  if (status >= 200 && status < 300) {
    return { kind: 'sent', status, bodyBytes };
  }
  return {
    kind: 'rejected',
    status,
    reason: `推送服务拒绝了（HTTP ${status}）—— 多半是 VAPID 或 Content-Encoding 写错`,
    bodyBytes,
  };
}

/**
 * 把一批订阅各发一条，**互不影响**。
 *
 * 🔴 单条失败**不能**让整批停下：一个死订阅会让后面所有设备都收不到刷新，
 * 而症状是"有些人的组件不更新" —— 那种问题几乎不可能从现场信息里定位。
 *
 * 返回里带上每条的结果，调用方据此决定删哪些（`gone`）。
 */
export async function sendWidgetPushToAll(
  inputs: SendWidgetPushInput[],
): Promise<Array<SendWidgetPushResult | { kind: 'failed'; reason: string }>> {
  return Promise.all(
    inputs.map(async (input) => {
      try {
        return await sendWidgetPush(input);
      } catch (error) {
        return { kind: 'failed' as const, reason: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}
