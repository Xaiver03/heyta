/**
 * 「退出登录」这一步的**编排**（纯函数，node 可测）
 * ================================================
 *
 * 裁决在 [ADR-0063](../../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md)；
 * 协议、路径、失败归类全在 `@heyta/app-host` 的 `account-security.ts`，
 * **本文件一条都不重述** —— 它只做一件事：把"打完那一发"与"本机该怎么办"接起来。
 *
 * ## 🔴 为什么"清本机"不取决于"服务端有没有撤销成"
 *
 * 在这一笔之前，移动端的"退出"只删本机凭据，而那枚访问令牌在服务端**还能用一整年**
 * （`session-contract.ts` 文件头记的就是这件事）。反过来的错法同样真实存在：
 * 断网时"因为撤销没成，所以先不清本机、免得用户丢数据"。那句话听着稳妥，后果是
 * **那台设备继续以用户身份活着，而他以为自己退出了** —— 在共享电脑上这是最坏的一种
 * "界面没有报错"。
 *
 * 所以 `planSignOut()` 把 `clearLocalCredentials` 写成**恒为 true** 的常量，
 * 而且由共享层说、不由界面说。本函数只是那条纪律的执行处，并且把它变成
 * **可测的**：失败分支必须同样清一次，一次都不许多、一次都不许少。
 *
 * ## 重试为什么要有"已经不用重试了"这一档
 *
 * 令牌已经失效时（`unauthorized`）再点重试，永远只会得到同一个 401，而界面会一直
 * 挂着那句"还没撤销成"。那种界面不是老实，是**卡死**：它承诺了一个不可能的动作。
 * 服务端既然已经拒绝这枚令牌，它就拿不出任何"还能用这枚令牌做的事"了。
 */

import {
  logoutCurrentDevice,
  planSignOut,
  type HostedAuthOptions,
  type HostedAuthOutcome,
  type SignOutPlan,
} from '@heyta/app-host';

/** 一发「撤销手上这一枚」的调用。与 `logoutCurrentDevice` 同签名，测试里换成桩。 */
export type LogoutCall = (
  options: HostedAuthOptions,
  token: string,
) => Promise<HostedAuthOutcome<{ message: string }>>;

export interface SignOutDeps {
  readonly options: HostedAuthOptions;
  readonly token: string;
  /** 宿主那一份"清本机"（凭据 + 小组件 + 会话状态 + 原生密钥），按序组合，见调用方。 */
  readonly clearLocal: () => void;
  /** 注入点只为测试存在；产品代码走 `logoutCurrentDevice` 这一条。 */
  readonly logout?: LogoutCall;
}

/**
 * 有没有**值得发的那一发**。
 *
 * 空令牌 / 空地址 ⇒ 一个请求都不发（与 `account-security.ts` 的 `bearer()` 同一条闸门），
 * 而"本机本来就没有会话"也不欠用户一句"服务器上还有东西没撤"。
 */
export function hasSessionToRevoke(token: string, baseUrl: string): boolean {
  return token.trim() !== '' && baseUrl.trim() !== '';
}

/**
 * 重试之后还要不要继续挂着那句"还没撤销成"。
 *
 * `ok` ⇒ 撤了。`unauthorized` ⇒ 这枚令牌**服务端已经不认了**，它已经不可能被用来
 * 做任何事，再挂"待撤销"就是承诺一个不可能的动作。其余（网络 / 5xx / 限流 / 响应读不懂 /
 * 闸门拦下）⇒ 还挂着，还能重试。
 */
export function revocationStillPending(
  outcome: HostedAuthOutcome<{ message: string }>,
): boolean {
  if (outcome.ok) return false;
  return outcome.reason !== 'unauthorized';
}

/**
 * 打那一发，并**无论成败**清本机。返回界面要用的那份 `SignOutPlan`。
 *
 * 🔴 `clearLocal` 在请求**之后**、但在任何分支上都不会被跳过：
 * 连 `logout` 自己抛异常（不该发生，但桩里会）也照样清。
 */
export async function signOutCurrentDevice(deps: SignOutDeps): Promise<SignOutPlan> {
  const logout = deps.logout ?? logoutCurrentDevice;
  const baseUrl = deps.options.baseUrl;

  if (!hasSessionToRevoke(deps.token, baseUrl)) {
    deps.clearLocal();
    return { clearLocalCredentials: true, serverRevocationPending: false };
  }

  let outcome: HostedAuthOutcome<{ message: string }>;
  try {
    outcome = await logout(deps.options, deps.token);
  } catch {
    outcome = { ok: false, reason: 'network' };
  }

  const plan = planSignOut(outcome);
  deps.clearLocal();
  return plan;
}

/**
 * 重试那一发。**不再清本机**（早就清了），只回答"那句待撤销的话可以摘掉了没有"。
 */
export async function retryServerRevocation(
  deps: Pick<SignOutDeps, 'options' | 'token' | 'logout'>,
): Promise<boolean> {
  const logout = deps.logout ?? logoutCurrentDevice;
  if (!hasSessionToRevoke(deps.token, deps.options.baseUrl)) return true;
  try {
    return revocationStillPending(await logout(deps.options, deps.token));
  } catch {
    return true;
  }
}
