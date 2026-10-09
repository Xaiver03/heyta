/**
 * 邮箱归一化的**唯一实现**。
 *
 * ## 为什么这是一枚单独的文件
 *
 * `users.email` 是 `@unique`，而 `email_change_requests.pending_email` 这次也建了 `@unique`。
 * 两张唯一约束比的是**落库的那一串** —— 所以"同一个邮箱"这件事由谁裁决，取决于每个写入点
 * 各自调了哪一个 `toLowerCase()`。侦察实测（2026-10-08）这种写法在 `server/src` 里有 **6 份**：
 *
 * | 位置 | 原来写的 |
 * |---|---|
 * | `auth.ts` 申请登录魔法链接 | `email.toLowerCase()`（**不 trim**） |
 * | `auth.ts` 魔法链接注册 | `email.toLowerCase()` |
 * | `password/recovery.ts` 申请重置 | `email.toLowerCase()` |
 * | `password/service.ts` 口令登录 | `email.toLowerCase()` |
 * | `password/registration-otp.ts` | `normalizeEmail = trim().toLowerCase()`（本地私有的一份） |
 * | `account/account-tombstones.ts` | `trim().toLowerCase()` 后取 SHA-256 |
 *
 * 于是 ` a@x.com` 与 `a@x.com` 可以是两行，而同一个地址在某个入口下查不到账号。
 * 这不是整洁问题：**邮箱就是这台系统里唯一的登录标识**，两份归一化 = 两套裁决标准。
 *
 * 这正是 AGENTS §3.5 那条教训的第四次复发（前三次：`ids.ts`、任务 op 构造、
 * `SyncClientOptions`）——「抽取的收尾动作是**删掉旧的那份并加门禁**，不是写一个更好的新版本」。
 * 所以本文件的存在**只有在上面那 6 处都被改成调用它之后**才成立；判据是
 * `pnpm check:email-normalization`（`scripts/check-email-normalization.mjs`），
 * 它对 `server/src/**` 里除本文件之外任何"自己拼一份归一化"的形状判红。
 *
 * ## 口径为什么是 `trim().toLowerCase()`
 *
 * 取的是**墓碑那一族**的口径（`account-tombstones.ts` 原来的那份），不是新拍的：
 * ADR-0055 §2.2 把 `email_hash` 的归一化与一条 `CHECK ("email_hash" ~ '^[0-9a-f]{64}$')` 绑在一起，
 * 而那条哈希的输入口径已经被写进对外政策。换绑与登录向它对齐，而不是反过来 ——
 * 改一个已经进政策的口径要重新走一遍法务，改六行代码不用。
 *
 * ⚠️ 两件**故意不做**的事：
 *
 * 1. **不做 Unicode NFKC / 大小写折叠（`toLocaleLowerCase`）**。口令那条路上有 NFC/NFD 的
 *    既有裁决（`email-password-auth.md` §10 那条：不顺手修的理由是**存量密文**），邮箱这一族
 *    同样不能今天换算法 —— 换了之后，存量账号里那一行与新口径可能不是同一个字符串。
 * 2. **不去掉 `+tag`、不折叠 Gmail 的点号**。那些是各家自己的把戏，不是 RFC 的一部分，
 *    而"帮用户把两个地址当成一个"在找回通道上是一次**判定**，不是格式化。
 *
 * 🔴 这里也**不查 MX、不发探测信**。合法性由"他收到并点开了那一封信"证明，不由格式猜。
 */
import { z } from 'zod';


/**
 * 把用户输入邮箱归一到**用于查与用于存**的那一串。
 *
 * 只做 `trim()` + ASCII 小写，**不动**其它字符。返回空串意味着输入里只有空白
 * —— 调用方必须把它当"没有邮箱"处理（路由层的 zod 已经会拦，这里只是不让它变成一枚
 * 对空字符串的哈希查询）。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 比较两个地址是否"同一个账号标识"。**唯一**的比较入口。
 *
 * 存在的理由是一条具体的失误形状：写 `a === b` 的人会先去检查自己是不是两边都 `toLowerCase()`
 * 过了，而只要有一边漏了，症状就是"换绑到一个已经属于自己的地址、却成功写进去了"。
 */
export function isSameNormalizedEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

/**
 * 界面回显用的**脱敏**形态。
 *
 * 🔴 只在"必须显示一个不能是全址的地址"时用。换绑的**新**地址不需要脱敏 —— 那是本人刚输入的值、
 * 由一条 Bearer 归属的接口原样回显，假装脱敏只会让人无法确认自己有没有打错字。
 * 它真正的位置是日志与后台列表那一侧（`admin-log-pii` 那道门禁管的就是这个）。
 */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf('@');
  if (at <= 0) return '•••';
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/**
 * 邮箱输入框的**唯一**校验形状。
 *
 * ⚠️ 侦察实测：`api.ts` 里 `z.string().email('Invalid email format')` 手写了 **8 遍**
 * （:160 :220 :226 :317 :326 :330 :335 :387），而 `shares/share.routes.ts:108` 那一处
 * 是 `.email().max(254)` —— 已经漂了：一份有长度上限、七份没有。
 * 本笔的新路由从这里取，**那 8 处的收口登记在工单 W8**（不在这里顺手改：
 * 那枚文件正被并行会话写，而长度上限一旦加上会让某些既有输入开始被拒 —— 那是一次
 * 有意的行为变更，要单独一条提交与单独一条判据，不能夹在换绑里）。
 *
 * 上限 254 的理由：RFC 5321 的 `PATH` 上限，也是 `shares` 那一族已经在用的数。
 * 🔴 **不**用 `maxlength` 之类的输入期截断（`auth-http-contract.ts:25-29` 那条纪律：
 * 截断后的地址与用户心里那个不是同一个东西，而它会被存下来当唯一登录标识）。
 */
export const emailFieldSchema = z.string().trim().min(1).email('Invalid email format').max(254);

