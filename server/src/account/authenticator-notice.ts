/**
 * 「账号多了一种登录方式」的告知信（ADR-0063 §2.6，兑现 `email-password-auth.md` 缺口 13）。
 *
 * ## 为什么两个调用点共用这一个收口函数
 *
 * `/password/set`（加上第一个登录口令）和 `/passkeys/registration/complete`（加一条通行密钥）
 * 要做的是**同一件事**：写已经成功了，现在要往账号**当前**那个邮箱发一封信。
 * 各写一遍就会各漂一次 —— 而这两处最容易漂的不是文案，是下面那三条纪律里的某一条。
 *
 * ## 三条纪律
 *
 * 1. 🔴 **只在写成功之后调用**。挂在失败路径上，这个接口就成了给别人邮箱发骚扰信的按钮，
 *    而且顺带承认"这个地址有账号"（与 `recovery.ts:161` 那条同一个理由）。
 * 2. 🔴 **失败绝不改变 HTTP 结果**。认证器**已经**加上了；因为一封通知发不出去就报 500，
 *    用户会以为没加上而再去点一次 —— 那比少一封邮件糟得多。
 *    所以这里连 DB 读取都圈在 `try` 里，而不只是发信那一步。
 * 3. 🔴 **收件地址取账号当前的 `email`，不取任何调用方传进来的地址**。这两个调用点都带
 *    Bearer，传地址进来等于让调用者指定"往谁的邮箱发这封信"。
 *
 * 语言取 `users.locale`（账号资料里那个字段就是"这个人在界面上最后一次选的语言"，
 * `updateAccountLocale` 写的就是它），不取请求体：这一封的收件人和操作者是同一个人，
 * 而账号上的值是**已落盘的选择**，比这一次调用恰好用什么界面语言更稳定。
 */
import { prisma } from '../db';
import { Logger } from '../logger';
import { asServerLocale, DEFAULT_SERVER_LOCALE } from '../design-html.js';
import { sendAuthenticatorAddedEmail } from '../email';

export type AuthenticatorKind = 'password' | 'passkey';

/**
 * 发那封"新增认证器"的告知信。
 *
 * ⚠️ 返回 `void` 是刻意的：调用点**没有任何有意义的动作**能对 `false` 做。
 * 把它做成 `Promise<boolean>` 只会诱使下一个调用点去"处理"它 ——
 * 而处理的方向必然是把成功改成失败，那正是纪律 2 拦的事。
 */
export const notifyAuthenticatorAdded = async (
  userId: number,
  kind: AuthenticatorKind,
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, locale: true },
    });
    if (!user) {
      // 账号在写入之后、发信之前消失了（并发的注销）。没有地址可发，也没有可失败的承诺。
      Logger.warn(`Authenticator-added notice skipped: no user (ID: ${userId})`);
      return;
    }
    const sent = await sendAuthenticatorAddedEmail(
      user.email,
      kind,
      asServerLocale(user.locale) ?? DEFAULT_SERVER_LOCALE,
    );
    if (!sent) {
      Logger.error(`Authenticator-added notice (${kind}) could not be delivered (ID: ${userId})`);
    }
  } catch (err) {
    // 🔴 这一层**唯一**允许的失败形状：记下、然后什么都不改。
    Logger.error(
      `Authenticator-added notice failed (ID: ${userId}): ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
};
