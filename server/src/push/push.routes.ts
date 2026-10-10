/**
 * Web Push 订阅的用户侧路由（`/api/push/*`）。
 * ============================================
 *
 * 三个路由，缺一个这条链就断：
 *
 * | 路由 | 为什么必须有 |
 * |---|---|
 * | `GET /vapid-public-key` | 浏览器调 `pushManager.subscribe({ applicationServerKey })` 时**必须**拿到它 —— 没有这个接口，客户端就只能把公钥硬编码进 JS 包 |
 * | `POST /subscribe` | 把浏览器给的 endpoint + 两个密钥登记到用户名下 |
 * | `DELETE /subscribe` | 注销（也用于"发送时发现 410 之外的主动清理"） |
 *
 * ## 🔴 三条纪律
 *
 * **（1）`endpoint` 不回显、不进日志、不进错误信息。**
 * 它是能力 URL —— 拿到它就能给那台设备发推送。所以响应体里只有 `ok` 与计数，
 * 校验失败时的报错也只说"字段名 + 长度"，**不**把它抄进去。
 *
 * **（2）没配 VAPID 时回 `503`，不是 `500`。**
 * 与 `checkoutRoutes` 同一姿态：自托管用户不配 Web Push 是完全正常的部署形态，
 * 那不是"服务器坏了"，而是"这个能力在这台服务器上没开"。
 * 回 `500` 会让自托管用户去翻日志找一个不存在的故障。
 *
 * **（3）校验在这里做**，而且报错带字段名。
 * 存进去一个 `p256dh` 只有 30 字节的行，要到**发送时**才炸 ——
 * 而那时的报错来自 `push-crypto` 的 ECDH，与"哪次请求写坏的"毫无关联。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { authenticate, getAuthUser } from '../middleware';

/** 注入依赖，让路由可以在没有数据库的情况下被测。 */
export interface PushRoutesOptions {
  store: {
    upsert(input: {
      userId: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      nowMs: number;
    }): Promise<{ id: number }>;
    deleteByEndpoint(endpoint: string): Promise<number>;
  };
  /**
   * VAPID 公钥（base64url 的 65 字节未压缩点）。
   *
   * `null` = **这台服务器没开 Web Push**。此时三个路由全部回 503。
   * ⚠️ 公钥**不是秘密**（它本来就要给每一个浏览器），但它是**配置**，
   * 不是代码里的常量 —— 换一对密钥意味着所有既有订阅作废，所以它必须来自 env。
   */
  vapidPublicKey: string | null;
  now?: () => number;
}

interface SubscribeBody {
  endpoint?: unknown;
  p256dh?: unknown;
  auth?: unknown;
}

/** base64url 解码后必须是这个长度。与 `push-crypto` 的校验**同源**。 */
export const PUSH_P256DH_BYTES = 65;
export const PUSH_AUTH_BYTES = 16;
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;

/**
 * 校验一个 base64url 字段，返回**带字段名**的报错。
 *
 * ⚠️ 报错里**只放字段名与长度**，绝不放那个值本身 ——
 * 见文件头纪律（1）。`endpoint` 尤其不能进。
 */
export function decodeField(
  name: string,
  value: unknown,
  expectedBytes: number,
): { ok: true; bytes: number } | { ok: false; message: string } {
  if (typeof value !== 'string' || value === '') {
    return { ok: false, message: `${name} 必须是非空字符串` };
  }
  // ⚠️ `Buffer.from(x, 'base64url')` **不抛**，它对非法字符是静默截断的。
  //    所以不能靠 try/catch，必须回编码一次比对 —— 否则 `"!!!!"` 会解出 0 字节
  //    然后再被长度检查挡下（碰巧对），而 `"AAAA===="` 这类会解出**非零但错误**
  //    的长度，报错信息就会变成"长度不对"而不是"这不是 base64url"。
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    return { ok: false, message: `${name} 不是合法的 base64url` };
  }
  if (decoded.length !== expectedBytes) {
    return { ok: false, message: `${name} 解码后必须是 ${expectedBytes} 字节，收到 ${decoded.length}` };
  }
  return { ok: true, bytes: decoded.length };
}

/**
 * `endpoint` 必须是 http(s) 的绝对 URL。
 *
 * ⚠️ **允许 `http://`** —— heyta 明确可自托管，本地推送服务（如
 * `web-push` 的测试服务、自建的 Mozilla autopush）会用 `http://127.0.0.1:port/...`。
 * 只允许 https 会把自托管用户整条路堵死，而报错会落在一个看不出原因的 400 上。
 * （迁移里的 CHECK 也是同一决定，见那个文件的注释。）
 */
export function validateEndpoint(value: unknown): { ok: true } | { ok: false; message: string } {
  if (typeof value !== 'string' || value === '') {
    return { ok: false, message: 'endpoint 必须是非空字符串' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // ⚠️ 这里也**不**把 value 抄进报错（它是能力 URL）。
    return { ok: false, message: 'endpoint 不是合法的绝对 URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: `endpoint 的协议必须是 http 或 https，收到 ${url.protocol}` };
  }
  return { ok: true };
}

export async function pushRoutes(
  fastify: FastifyInstance,
  opts: PushRoutesOptions,
): Promise<void> {
  const now = opts.now ?? (() => Date.now());

  fastify.addHook('preHandler', authenticate);

  /**
   * 没配 VAPID 时统一 503。
   *
   * 抽成一个函数而不是三处 if：三个路由的**行为必须一致** ——
   * 一处回 503、另一处回 200 会让客户端以为"订阅成功但永远不会收到推送"，
   * 而那正是最难查的一类。
   */
  const guard = async (reply: FastifyReply): Promise<boolean> => {
    if (opts.vapidPublicKey !== null && opts.vapidPublicKey !== '') return true;
    await reply.code(503).send({
      code: 'web_push_disabled',
      message: '这台服务器没有配置 Web Push（VAPID 密钥对缺失）',
    });
    return false;
  };

  /**
   * 浏览器要的 VAPID 公钥。
   *
   * ⚠️ 这个接口**故意不校验登录之外的任何东西**，也故意**不**返回密钥对里的私钥部分。
   * 公钥是公开信息（它会被写进每一个订阅请求），但只从 env 来 ——
   * 硬编码进 JS 包会让"换密钥"变成一次必须重新发版的操作。
   */
  fastify.get('/vapid-public-key', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await guard(reply))) return;
    // 即使已认证也再取一次用户，保证未登录时抛 401 而不是悄悄返回公钥 ——
    // 公钥本身不敏感，但这个接口的存在不应该成为一个匿名可探测的端点。
    getAuthUser(request);
    return reply.send({ publicKey: opts.vapidPublicKey });
  });

  fastify.post<{ Body: SubscribeBody }>(
    '/subscribe',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!(await guard(reply))) return;
      const userId = getAuthUser(request).userId;
      const body = request.body ?? {};

      const endpointCheck = validateEndpoint(body.endpoint);
      if (!endpointCheck.ok) {
        return reply.code(400).send({ code: 'invalid_endpoint', message: endpointCheck.message });
      }
      const p256dhCheck = decodeField('p256dh', body.p256dh, P256DH_BYTES);
      if (!p256dhCheck.ok) {
        return reply.code(400).send({ code: 'invalid_p256dh', message: p256dhCheck.message });
      }
      const authCheck = decodeField('auth', body.auth, AUTH_BYTES);
      if (!authCheck.ok) {
        return reply.code(400).send({ code: 'invalid_auth', message: authCheck.message });
      }

      await opts.store.upsert({
        userId,
        endpoint: body.endpoint as string,
        p256dh: body.p256dh as string,
        auth: body.auth as string,
        nowMs: now(),
      });

      // 🔴 响应里**没有 endpoint**。见文件头纪律（1）。
      return reply.code(201).send({ ok: true });
    },
  );

  fastify.delete<{ Body: { endpoint?: unknown } }>(
    '/subscribe',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!(await guard(reply))) return;
      // ⚠️ 也校验登录：否则任何人都能用别人的 endpoint 把别人的订阅注销掉
      //   （只要他从哪里拿到那个 URL）—— 而"注销"是一个**破坏性**操作。
      getAuthUser(request);
      const endpoint = request.body?.endpoint;
      if (typeof endpoint !== 'string' || endpoint === '') {
        return reply.code(400).send({
          code: 'invalid_endpoint',
          message: 'endpoint 必须是非空字符串',
        });
      }

      const removed = await opts.store.deleteByEndpoint(endpoint);
      // ⚠️ 删掉 0 行也回 200 —— **刻意**。
      //    回 404 会把"这条订阅已经不在了"暴露成一个可探测的差异
      //    （配合上面的端点校验，可以用来判断某个 endpoint 是否存在）。
      //    而调用方（注销按钮 / 发送时发现订阅死了）在两种情况下要做的事
      //    完全一样：继续往下走。
      return reply.send({ ok: true, removed });
    },
  );
}
