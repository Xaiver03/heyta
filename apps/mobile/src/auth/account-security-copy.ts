/**
 * 换绑邮箱 / 登录设备这三条路上的**措辞与数值判定**（纯函数，node 可测）
 * ======================================================================
 *
 * 🔴 **本文件一个运行时 import 都没有。**
 *
 * 移动端跑在 node 里（`apps/mobile` 刻意不 mock `react-native` —— 见
 * `packages/ui/src/node.ts` 文件头那段），所以从 `@heyta/ui` 的 barrel 拿
 * `authFailureMessageKey` 会把 RN 整个拖进来，测试连加载都过不去（实测症状是
 * `RolldownError: Flow is not supported`）。这里的处理是**把兜底注入进来**：
 * 本模块只负责"哪些失败原因是换绑这条路**特有**的、该说哪句"，
 * 剩下那一半由调用方（`.tsx` 屏，加载 RN 无所谓）用共享层的
 * `authFailureMessage` 补 —— 而**不是**在这里再抄一份那张词表。
 *
 * 抄一份的后果本仓写过账：`apps/mobile/src/auth/failure-key.ts` 就是因为
 * 各自抄了一份 `common.auth.error.*` 的映射才被删掉、统一收进 `@heyta/ui`
 * （`packages/ui/src/index.ts` ⑩ 那块注释记着这件事）。这里不重演。
 *
 * ## 三条不许讲成一条的实话
 *
 * 1. **哪一边还没点，只有 `getEmailChangeStatus` 知道。** 所以本文件对
 *    `EmailChangeStage` 只做"翻成哪句话"，**不做**"我现在处于哪一阶段" ——
 *    后者要是由组件自己记，刷新一次就丢，而界面会指着一封没人点过的信说
 *    "另一边已经确认了"。
 * 2. **服务端只是"发出了两封信"，不是"已经换好了"。** 生效发生在两个收件箱
 *    各点一次之后，而那一步在**服务端渲染的凭据页**上，不在这个屏里。
 * 3. **`resendAvailableAt` 与"现在"之差不能为负。** 设备时钟被回拨时它会算到
 *    现在之前，负数会渲染成"再等 -30 秒"。
 */

import type { EmailChangeStage, HostedAuthFailureReason } from '@heyta/app-host';
import type { MessageKey } from '@heyta/i18n';
import type { SessionSummary } from '@heyta/shared-schema';

/**
 * 一句话**连同要填的数字**一起交出。
 *
 * 🔴 形状照 `@heyta/ui` 的 `authFailureMessage`（同一文件 :295 记着它的来历）：
 * 只交 key 的映射会让宿主"拿到 key、忘了填数"，而 `@heyta/i18n` 缺变量时
 * **保留原占位符**，于是界面上印出"再等 {seconds} 秒"。这里不重演那个坑。
 *
 * `vars` 刻意不是 `Readonly` —— 它要原样交给 `t(key, vars)`，
 * 而那个参数是 `Record<string, string | number>`。
 */
export interface CopyMessage {
  readonly key: MessageKey;
  readonly vars?: Record<string, string | number>;
}

/**
 * 换绑那条路上**特有**的失败原因。
 *
 * 🔴 写成 `as const` 数组 + 由它推出联合类型，而不是手写六个字符串字面量：
 * 下面那张 `SPECIFIC_KEYS` 表是 `Record<EmailChangeSpecificReason, …>`，
 * 少登记一条就是**编译错误**。判据 `account-security-copy.spec.ts` 另外钉住
 * "这六条确实都是 `HostedAuthFailureReason` 的成员"（原因集合改了名字，
 * 这里要在编译期发现，而不是靠某句错误文案悄悄落到 `unknown`）。
 */
export const EMAIL_CHANGE_SPECIFIC_REASONS = [
  'email-unchanged',
  'email-taken',
  'email-not-verified',
  'email-change-cooldown',
  'invalid-change-link',
  'network',
] as const satisfies readonly HostedAuthFailureReason[];

export type EmailChangeSpecificReason = (typeof EMAIL_CHANGE_SPECIFIC_REASONS)[number];

/**
 * `email-change-cooldown` **不在这张表里**，而是单独处理：它那句词条带
 * `{seconds}`，必须连着数字一起交出来。
 *
 * 🔴 用 `Exclude<…>` 而不是"表里少写一条也没关系"：少登记一条就是**编译错误**，
 * 而漏一条的后果是那句换绑特有的实话悄悄落到通用词表（"这个邮箱地址或令牌看起来
 * 不对"），界面从此不再解释到底为什么不能换。
 */
type EmailChangeKeyedReason = Exclude<EmailChangeSpecificReason, 'email-change-cooldown'>;

const EMAIL_CHANGE_SPECIFIC_KEYS: Record<EmailChangeKeyedReason, MessageKey> = {
  'email-unchanged': 'common.emailChange.unchanged',
  'email-taken': 'common.emailChange.taken',
  'email-not-verified': 'common.emailChange.notVerified',
  'invalid-change-link': 'common.emailChange.invalidLink',
  network: 'common.emailChange.network',
};

/** 只认这张表里真有的键 —— 不是 `in` 一个 `Partial`，那样"没登记"与"登记成 undefined"分不开。 */
function isEmailChangeKeyedReason(value: string): value is EmailChangeKeyedReason {
  return Object.prototype.hasOwnProperty.call(EMAIL_CHANGE_SPECIFIC_KEYS, value);
}

/**
 * 失败原因 → 句子。返回 `undefined` = **这不是换绑特有的**，
 * 调用方必须落到共享层那句（`authFailureMessage`）。
 *
 * `cooldownSeconds` 只在 `email-change-cooldown` 上被读，而且**两条话都有**：
 *   · 有秒数 ⇒ `common.emailChange.cooldown`（带 `{seconds}`）；
 *   · 服务端没给 `Retry-After` ⇒ `mobile.emailChange.cooldownNoSeconds`。
 *
 * 🔴 第二句不是多余：共享层对 `password-locked` 也是同样的两分裂
 * （`common.auth.error.passwordLocked` / `…WithWait`），理由一样 ——
 * 把 `undefined` 当 0 会渲染成"再等 0 秒"，而那一刻这张请求**还在冷却里**。
 */
export function emailChangeFailureCopy(
  reason: HostedAuthFailureReason | undefined,
  cooldownSeconds: number,
): CopyMessage | undefined {
  if (reason === undefined) return undefined;
  if (reason === 'email-change-cooldown') {
    return cooldownSeconds > 0
      ? { key: 'common.emailChange.cooldown', vars: { seconds: cooldownSeconds } }
      : { key: 'mobile.emailChange.cooldownNoSeconds' };
  }
  if (!isEmailChangeKeyedReason(reason)) return undefined;
  return { key: EMAIL_CHANGE_SPECIFIC_KEYS[reason] };
}

/**
 * 阶段 → 那句"还等谁点"。
 *
 * `idle` 返回 `undefined`：**没有活请求时不画待办块**，而不是画一句
 * "已经在等了"。'invalid' 有自己那句 —— 服务端说 pending 为真却两边都不等，
 * 那是数据库里一行本不该存在的状态，说"等另一边"和说"已生效"**都是假话**。
 */
export function emailChangeStageCopy(stage: EmailChangeStage): MessageKey | undefined {
  switch (stage) {
    case 'idle':
      return undefined;
    case 'awaiting-both':
      return 'common.emailChange.awaitingBoth';
    case 'awaiting-old':
      return 'common.emailChange.awaitingOld';
    case 'awaiting-new':
      return 'common.emailChange.awaitingNew';
    case 'invalid':
      return 'mobile.emailChange.stage.invalid';
  }
}

/**
 * 冷却还剩几秒。**向下取整、负数归零、没有值归零。**
 *
 * ⚠️ `undefined`（服务端没回 `resendAvailableAt`，或请求已经不在pending）
 * 与 `0`（正好到点）在界面上走的是**同一句**"可以再发起"，所以合并成一个数
 * 不丢信息；而 `null`/缺失被当成一个很大的值是另一种错法。
 */
export function cooldownSecondsLeft(resendAvailableAt: number | undefined, now: number): number {
  if (resendAvailableAt === undefined) return 0;
  const left = Math.floor((resendAvailableAt - now) / 1000);
  return left > 0 ? left : 0;
}

/**
 * 会话行上那台设备叫什么。
 *
 * 顺序是 `deviceName` → `userAgent` → 那句"未命名设备"。
 *
 * 🔴 为什么**不**回落到 `sessionId`：那枚 id 是 SHA-256 hex，用户认不出它，
 * 而它会出现在"退出这一台：b41a…"这种**要用户判断退谁**的地方。
 * 认不出来就老实说认不出来。
 */
export function sessionDeviceLabel(
  session: Pick<SessionSummary, 'deviceName' | 'userAgent'>,
  unlabeledLabel: string,
): string {
  const name = session.deviceName?.trim();
  if (name !== undefined && name !== '') return name;
  const agent = session.userAgent?.trim();
  if (agent !== undefined && agent !== '') return agent;
  return unlabeledLabel;
}
