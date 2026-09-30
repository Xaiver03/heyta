/**
 * 移动端通行密钥的**平台一半**
 * ============================
 *
 * `@heyta/app-host` 的 `hosted-auth.ts` 刻意只做协议两半（取 options / 交 credential），
 * 中间那一步 —— `navigator.credentials.create()/.get()` 或原生等价物 ——
 * **留在宿主里**（见那份文件头的"通行密钥只做协议"）。
 *
 * 本文件就是移动端的那个"宿主"。
 *
 * ## 🔴 今天它返回 `undefined`，这是**结论**，不是占位
 *
 * React Native 0.84 的 Hermes 里**没有** `navigator.credentials`，也没有
 * `PublicKeyCredential`；而本仓库至今没有接任何原生 WebAuthn 模块
 * （引一个原生依赖要过 AGENTS §3.1–3.2 两道门，也得在 iOS/Android 两侧都接线）。
 *
 * 所以移动端的通行密钥**现在走不通**。这件事必须被**如实说出来**：
 *   - 不假装成功（那会让用户以为密钥建好了，其实账号上什么都没有）；
 *   - 不报成"用户取消"（`passkey-cancelled` 的契约是"用户可以重试"，
 *     而这里再试多少次都一样）；
 *   - 不装作按钮不存在（那会让"注册/登录"少掉规范 §3.2 ②a 那一整条分支）。
 *
 * 正确的原因是 app-host 里已有的 `passkey-unsupported`：**一个请求都不发**，
 * 界面据此说"这台设备不支持，请用邮件链接"。
 *
 * ## 接口为什么先定好
 *
 * 接原生模块时要改的**只有这一个文件**：把 `create` / `get` 实现出来，
 * 其余（AuthScreen 的流程、app-host 的协议、失败归类）一行都不用动。
 * 这就是把"平台差异"关在一个文件里的意义（AGENTS.md §3.5）。
 */

import type { HostedPasskeyCredential, HostedPasskeyOptions } from '@heyta/app-host';

/**
 * 通行密钥的平台调用。
 *
 * 🔴 `create` / `get` 都**不做**成功/失败的分类：它们要么返回 credential，
 * 要么**抛异常**，由 `describePasskeyError` 翻译成 app-host 的封闭原因集合。
 * 把分类写在两个地方（这里、协议层）必然漂移。
 */
export interface PasskeyCredentialProvider {
  create(options: HostedPasskeyOptions): Promise<HostedPasskeyCredential>;
  get(options: HostedPasskeyOptions): Promise<HostedPasskeyCredential>;
}

/**
 * 这台设备上有没有可用的通行密钥实现。
 *
 * 🔴 返回 `undefined` = **没有**。调用方必须把 `undefined` 当成
 * `passkey-unsupported` 处理，而不是"No-op 成功"。
 */
export function resolvePasskeyProvider(): PasskeyCredentialProvider | undefined {
  return undefined;
}

/**
 * 平台抛出的异常 → app-host 的封闭原因。
 *
 * ⚠️ 今天这条路径**跑不到**（没有 provider），保留它是为了**接上原生模块时**
 * 不必再补一次分类 —— 而分类正是最容易写错、也最容易悄悄退化成
 * "什么都报成失败"的一步。契约与 `hosted-auth.ts` 的注释逐条对应：
 *
 *   - `InvalidStateError`：设备上已经有这个账号的凭据（`excludeCredentials` 命中）
 *     → `passkey-already-registered`（该改用"登录"，重试永远同样失败）；
 *   - `NotAllowedError` / `AbortError`：用户在系统弹窗里取消或超时
 *     → `passkey-cancelled`（重试是有意义的）；
 *   - 其余：`passkey-rejected`（凭据认得但这次断言没验过）。
 */
export function describePasskeyError(
  error: unknown,
): 'passkey-already-registered' | 'passkey-cancelled' | 'passkey-rejected' {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name ?? '')
      : '';
  if (name === 'InvalidStateError') return 'passkey-already-registered';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'passkey-cancelled';
  return 'passkey-rejected';
}
