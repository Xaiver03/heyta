/**
 * 托管 AI 的**用量读数**（`GET /api/ai/managed/usage`）。
 *
 * ## 它兑现的是哪句话
 *
 * 《AI 服务条款》§5.3 承诺「设置页可以查到本周期已用 X / 300 次」。
 * 服务端那一半已经就位（`server/src/ai/managed-proxy.routes.ts` 的读路由，
 * 走 `peekManagedAiUsage`，**只读不扣费**）；这个文件是**客户端那一半的传输**。
 *
 * ## 🔴 三条不能改的形状
 *
 * 1. **不抛异常。** 任何失败都归一成 `unavailable` —— 一次用量查询绝不能
 *    变成一个崩溃点，更不能让"查不到"被界面读成"用完了"或"还剩 300 次"。
 *    所以返回值是**判别式联合**，"读不到"有自己的成员，不借 `used: 0` 表达。
 * 2. **`unconfigured` 与 `unavailable` 分开。** 前者是"这台设备没配服务器"
 *    （自托管 / 还没登录），后者是"配了但这次没读到"。前者的修复动作是去「同步」，
 *    后者是稍后再看 —— 合成一句就会指错方向。
 * 3. **响应体要验形**，不能 `as` 一下就信：服务端改字段不会让客户端编译红，
 *    而界面会拿 `undefined` 去算百分比。数字不是有限数就当 `malformed`。
 *
 * ⚠️ **这个读数不参与任何扣费**：它只读。真正扣费在服务端那条 `POST` 上。
 */

import { joinEndpointUrl } from './endpoint-url.js';

/** 读用量的路径。写成常量，好让测试与宿主指向别处。 */
export const MANAGED_AI_USAGE_PATH = '/api/ai/managed/usage';

export type ManagedAiUsageReading =
  /** 这台设备没配服务器（自托管 / 没登录）—— 修复动作是去「同步」。 */
  | { readonly kind: 'unconfigured' }
  /** 配了，但这次没读到。`cause` 给运维定位，**不进界面文案**。 */
  | {
      readonly kind: 'unavailable';
      readonly cause: 'no-token' | 'network' | 'http' | 'malformed';
    }
  /**
   * 读到了。
   *
   * 🔴 `entitled: false` 时 `used` 恒为 0，而它**不是**"这一期还没用过"，
   * 是"根本没有这一期"（没买这一档 / 已到期）。界面渲染成「已用 0 / 300」
   * 就是在说反话 —— 正确渲染是"未订阅"那一档。
   */
  | {
      readonly kind: 'ok';
      readonly used: number;
      readonly limit: number;
      readonly periodAnchor: number | null;
      readonly entitled: boolean;
    };

export interface ManagedAiUsageProbeOptions {
  /** 服务端根地址，例如 `https://heyta.waytofuture.cn`。空串 = 未配置。 */
  readonly baseUrl: string;
  /** 取访问令牌。`undefined` = 未登录。 */
  readonly getToken: () => Promise<string | undefined>;
  /** 网络实现，便于测试注入。默认 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 探测端点，便于测试。默认 {@link MANAGED_AI_USAGE_PATH}。 */
  readonly path?: string;
}

/** 非负有限整数才认。**不是**"能转成数字就认" —— `NaN` / `Infinity` / `-1` 都要挡住。 */
function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 拉一次用量读数。**不抛异常**（见文件头第 1 条）。
 */
export async function fetchManagedAiUsage(
  options: ManagedAiUsageProbeOptions,
): Promise<ManagedAiUsageReading> {
  if (options.baseUrl.trim() === '') return { kind: 'unconfigured' };

  let token: string | undefined;
  try {
    token = await options.getToken();
  } catch {
    // 取令牌失败（网络 / 钥匙串）与"没登录"对界面是同一件事：现在读不到。
    return { kind: 'unavailable', cause: 'no-token' };
  }
  if (token === undefined || token.trim() === '') return { kind: 'unavailable', cause: 'no-token' };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(
      joinEndpointUrl(options.baseUrl, options.path ?? MANAGED_AI_USAGE_PATH),
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        // 🔴 刻意没有 body：这次请求不携带任何用户内容。
      },
    );
  } catch {
    return { kind: 'unavailable', cause: 'network' };
  }

  if (!response.ok) return { kind: 'unavailable', cause: 'http' };

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { kind: 'unavailable', cause: 'malformed' };
  }

  if (typeof raw !== 'object' || raw === null) return { kind: 'unavailable', cause: 'malformed' };
  const body = raw as Record<string, unknown>;
  const used = asCount(body.used);
  const limit = asCount(body.limit);
  const entitled = body.entitled;
  // `periodAnchor` 允许 `null`（没有周期时服务端就是这么回的），但**不是数字就必须是 null**。
  const anchor = body.periodAnchor;
  if (used === undefined || limit === undefined || typeof entitled !== 'boolean') {
    return { kind: 'unavailable', cause: 'malformed' };
  }
  if (anchor !== null && typeof anchor !== 'number') {
    return { kind: 'unavailable', cause: 'malformed' };
  }

  return { kind: 'ok', used, limit, periodAnchor: anchor, entitled };
}
