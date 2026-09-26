/**
 * 官方托管同步的权益探测（**宿主无关**）
 * =========================================
 *
 * 客户端要判断"该不该按权益降级"，必须先**从服务端拉一个独立小状态**。
 * 这个文件就是那次拉取 —— 所有宿主共用同一份。
 *
 * ## 🔴 为什么必须是独立的 GET，而不是从同步请求的失败里"顺便"读出来
 *
 * 同步上传（`POST /api/sync/ops`）会**携带任务内容**。如果权益只能从同步的
 * 402 里读到，那么"判断该不该降级"这件事本身就会**把任务发到服务器** ——
 * 而这是本目标明令禁止的（E2EE 硬约束：计费只碰账户与权益状态，永远不碰任务内容）。
 *
 * 所以这里发的是一个**不携带任何载荷的 GET**：
 *
 *   - 方法固定 `GET`；
 *   - **没有 body**（`fetch` 调用里根本没有 `body` 字段）；
 *   - URL 里不含任何实体 / op / 任务字段。
 *
 * `packages/app-host/tests/entitlement.spec.ts` 用抓取到的 `RequestInit`
 * 把这三条**机械钉住** —— 不是靠注释保证。
 *
 * ## 为什么探 `/api/sync/status`
 *
 * 它是服务端既有的、**有身份校验且不携带任务内容**的轻量端点，
 * 并且它和上传/下载同处一个插件 —— 服务端的权益守卫
 * （`server/src/entitlement.ts` 的 `createEntitlementGuard`）挂在整个插件上，
 * 所以它对该端点的拒绝**与对同步的拒绝逐字相同**：
 * `402` + `errorCode: 'SUBSCRIPTION_REQUIRED'` + `reason`。
 *
 * 于是客户端**不需要服务端新增任何端点、也不发明第二套状态**，
 * 就能读到那套既有表达。响应体本身（`latestSeq` 之类）我们**一个字段都不消费**。
 *
 * ## fail-open
 *
 * 未配置 / 没令牌 / 断网 / 超时 / 非 2xx 非 402 —— 全部落成"问不到"，
 * 由 `decideHostedSyncAccess` 判为**不限制**。不确定的时候不为难用户。
 * 自托管默认关闸门 → 该端点直接 200 → 客户端看到"放行"，**什么提示都不出现**。
 */
import {
  parseHostedEntitlementResponse,
  type HostedEntitlementReading,
} from '@heyta/domain';

/**
 * 权益探测端点。放在常量里而不是散落的字面量：它同时被测试当作断言目标。
 *
 * ⚠️ 它是 `GET`，且**没有任何 body** —— 见文件头。
 */
export const HOSTED_ENTITLEMENT_PATH = '/api/sync/status';

export interface HostedEntitlementProbeOptions {
  /** 服务端根地址，例如 `http://127.0.0.1:3000`。空串 = 未配置。 */
  baseUrl: string;
  /** 取访问令牌。`undefined` = 未登录。 */
  getToken: () => Promise<string | undefined>;
  /** 网络实现，便于测试注入。默认 `globalThis.fetch`。 */
  fetchImpl?: typeof fetch;
  /** 探测端点，便于测试。默认 {@link HOSTED_ENTITLEMENT_PATH}。 */
  path?: string;
}

/** 去掉根地址末尾的斜杠，避免 `//api/...` 这种拼法。 */
const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`;

/**
 * 拉一次权益状态。
 *
 * 🔴 **不抛异常。** 任何失败都归一成 `unavailable` —— 探测本身绝不能变成
 * 一个新的崩溃点，更不能让"探测失败"被误当成"没权益"。
 */
export async function fetchHostedEntitlementReading(
  options: HostedEntitlementProbeOptions,
): Promise<HostedEntitlementReading> {
  if (options.baseUrl.trim() === '') {
    // 没配服务器 → 连请求都不发。这是"自托管/未配置不受影响"的第一道保证。
    return { kind: 'unconfigured' };
  }

  const token = await options.getToken();
  if (token === undefined || token === '') {
    return { kind: 'unavailable', cause: 'no-token' };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(joinUrl(options.baseUrl, options.path ?? HOSTED_ENTITLEMENT_PATH), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      // 🔴 刻意没有 `body`：这次请求不携带任何用户内容。
    });
  } catch {
    // 断网 / DNS / 证书 / 平台策略拦截 —— 一律 fail-open，不降级。
    return { kind: 'unavailable', cause: 'network' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // 响应体不是 JSON（或为空）。状态码仍然有效 —— 别因为解析失败丢掉结论。
    body = undefined;
  }

  return parseHostedEntitlementResponse({ status: response.status, body });
}
