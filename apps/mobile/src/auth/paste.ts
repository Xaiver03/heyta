/**
 * 「粘贴邮件里的链接 / 令牌」这一步的**判定**
 * ==========================================
 *
 * 用户手里可能有两种令牌，而它们**长得一模一样**（都是 32 字节十六进制），
 * 只有服务端能分辨：
 *
 *   1. **验证令牌** —— 注册那封信里的。`POST /api/verify-email`。
 *      它**不产出会话**（规范 §2-A1），只是把账号标成已验证。
 *   2. **登录令牌** —— 登录那封信里的。`POST /api/login/magic-link/verify`。
 *      **这是产出 token 的落点**（规范 §2-A1）。
 *
 * 界面上只有一个输入框（多一个框就要用户自己判断"我手里这串是哪种" —— 他判不了），
 * 所以判定必须在这里做：**先当登录令牌试，不成立再当验证令牌试**。
 *
 * ## 🔴 为什么只在**特定**失败上继续试第二种
 *
 * "两种都试一遍"听起来简单，但会制造一个真实的坏行为：断网时第一条请求
 * 就失败成 `network`，这时再去发第二条同样注定失败 —— 用户看到的是
 * "它转了两圈才告诉我连不上"。所以只在"这串东西**不是**登录令牌"这一类
 * 失败上继续：`unauthorized`（服务端说这令牌不认）与 `invalid-input`。
 *
 * 其余失败（网络 / 5xx / 限流 / 未配置）**原样上报**，因为它们与
 * "这是哪种令牌"无关，试第二种不会得到不同结论。
 *
 * ## 顺序为什么不能反
 *
 * 先试验证令牌的话，用户拿登录令牌粘贴时**会收到"邮箱已验证"** ——
 * 一句真话，但**不是他要的结果**（他要的是登录）。而且服务端对
 * "已经验证过的账号再验证一次"的答复可能同样是成功，于是界面会告诉他
 * "验证成功，请再发一封登录链接" —— 让一个已经有登录链接的人白跑一圈。
 */

import {
  extractAuthLinkToken,
  type HostedAuthFailureReason,
  type HostedAuthSession,
} from '@heyta/app-host';

export type PastedAuthOutcome =
  /** 拿到会话 —— **只有登录令牌能走到这里**。 */
  | { kind: 'session'; session: HostedAuthSession }
  /** 邮箱验证成功了，但**还没有**会话：用户要再去发一封登录链接。 */
  | { kind: 'email-verified' }
  /** 两种都不是。`reason` 取登录那一次的失败 —— 那才是用户的本意。 */
  | { kind: 'failed'; reason: HostedAuthFailureReason };

/** 只在"这串东西不像登录令牌"时才值得再试一次的那几种失败。 */
const RETRY_AS_VERIFICATION: ReadonlySet<HostedAuthFailureReason> = new Set([
  'unauthorized',
  'invalid-input',
]);

export interface PastedAuthProbes {
  verifyLoginToken: (
    token: string,
  ) => Promise<{ ok: true; session: HostedAuthSession } | { ok: false; reason: HostedAuthFailureReason }>;
  verifyEmailToken: (
    token: string,
  ) => Promise<{ ok: true } | { ok: false; reason: HostedAuthFailureReason }>;
}

/**
 * 兑换用户粘贴的东西。
 *
 * ⚠️ 两个探针都是**注入**的：单测里不需要网络，也不需要 mock `fetch` ——
 * 这一层验的只是"什么时候试哪一种、结论怎么合并"，而那是这里唯一的逻辑。
 */
export async function redeemPastedAuthToken(
  probes: PastedAuthProbes,
  rawInput: string,
): Promise<PastedAuthOutcome> {
  // 链接里抽不出令牌 → 连请求都不发。这不是"网络失败"，是"这段文本里没有令牌"。
  const token = extractAuthLinkToken(rawInput);
  if (token === undefined) return { kind: 'failed', reason: 'invalid-input' };

  const login = await probes.verifyLoginToken(token);
  if (login.ok) return { kind: 'session', session: login.session };
  if (!RETRY_AS_VERIFICATION.has(login.reason)) {
    return { kind: 'failed', reason: login.reason };
  }

  const verification = await probes.verifyEmailToken(token);
  if (verification.ok) return { kind: 'email-verified' };

  // 两种都不是：报**登录**那一次的原因。用户的本意是登录，
  // 而"验证令牌也不对"不改变"这串东西不能用"这个结论。
  return { kind: 'failed', reason: login.reason };
}
