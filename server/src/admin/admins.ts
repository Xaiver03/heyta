/**
 * 管理员的授予与撤销 —— **唯一**的写入口。
 * ==========================================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../docs/adr/0038-admin-console-scope.md)。
 *
 * ## 为什么单独一个模块，而不是把逻辑写在 CLI 里
 *
 * 因为它有**一条必须被测试钉住的不变量**：**不能撤销最后一个管理员**。
 * 撤销错了不会报错 —— 它只是让这台服务器的后台**永远打不开**，
 * 而修它需要直连数据库改一行。把这条放进 CLI 就等于放进一个测不到的地方。
 *
 * ## 为什么用返回值而不是抛异常
 *
 * "用户不存在"与"这是最后一个管理员"都是**预期内的业务结果**，不是程序错误。
 * 用异常表达它们会让调用方写成 `catch`，而 `catch` 会顺手吞掉真正的故障
 * （数据库连不上、约束冲突）。所以：预期结果走返回值，真故障才抛。
 */

import { prisma } from '../db';
import { normalizeEmail } from '../account/email-normalize';

/** 管理员的公开投影。🔴 **白名单** —— 不含 `passwordHash`、任何 token、`isAdmin` 以外的账号内部字段。 */
export interface AdminSummary {
  readonly id: number;
  readonly email: string;
  readonly isVerified: boolean;
  /** epoch 毫秒；`null` = 未知。 */
  readonly createdAt: number | null;
}

export type GrantAdminResult =
  | { readonly ok: true; readonly admin: AdminSummary }
  | { readonly ok: false; readonly reason: 'user-not-found' };

export type RevokeAdminResult =
  | { readonly ok: true; readonly admin: AdminSummary }
  | { readonly ok: false; readonly reason: 'user-not-found' | 'not-an-admin' | 'last-admin' };

/**
 * 邮箱规范化。
 *
 * 🔴 必须与注册路径用**同一个**口径，否则 CLI 会对着一个"看起来一样"的邮箱报
 * "用户不存在"，而那个人其实在库里（大小写或首尾空格不同）。
 * 口径现在**不是这里的一份实现**，是 `account/email-normalize.ts` 的 `normalizeEmail`：
 * 上面那句“哪天注册改了这里要跟着改”的担心，正是它该被消掉的理由 ——
 * 一份实现没有“跟着改”这件事，它只有“本来就是同一份”。
 */
export function normalizeAdminEmail(raw: string): string {
  return normalizeEmail(raw);
}

const toEpochMillis = (value: Date | null): number | null =>
  value === null ? null : value.getTime();

function toSummary(user: {
  id: number;
  email: string;
  isVerified: number;
  createdAt: Date;
}): AdminSummary {
  return {
    id: user.id,
    email: user.email,
    // 库里是 Int（0/1），对外是 boolean —— 与 User 模型上其他 0/1 列同一口径。
    isVerified: user.isVerified === 1,
    createdAt: toEpochMillis(user.createdAt),
  };
}

/** 列出全部管理员（按 id 升序，稳定）。 */
export async function listAdmins(): Promise<AdminSummary[]> {
  const users = await prisma.user.findMany({
    where: { isAdmin: true },
    orderBy: { id: 'asc' },
    select: { id: true, email: true, isVerified: true, createdAt: true },
  });
  return users.map(toSummary);
}

/** 管理员总数。撤销路径用它做"最后一个"判定。 */
export async function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { isAdmin: true } });
}

/**
 * 授予管理员。
 *
 * 幂等：已经是管理员的再授予一次仍然返回 `ok`（不报"已存在"）——
 * 因为脚本会被重复执行的场景（部署脚本、人重跑一次）远比"手滑多授一次"常见，
 * 而对一个幂等操作报错只会让人学会忽略它的输出。
 */
export async function grantAdmin(rawEmail: string): Promise<GrantAdminResult> {
  const email = normalizeAdminEmail(rawEmail);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isVerified: true, createdAt: true, isAdmin: true },
  });
  if (user === null) return { ok: false, reason: 'user-not-found' };

  if (!user.isAdmin) {
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
  }

  return { ok: true, admin: toSummary(user) };
}

/**
 * 撤销管理员。
 *
 * 🔴 **拒绝撤销最后一个管理员。** 见文件头：这不是洁癖，是"后台会不会永远打不开"。
 * 要真的清空管理员，那应该是一次有意识的数据库操作，而不是这条命令的副作用。
 */
export async function revokeAdmin(rawEmail: string): Promise<RevokeAdminResult> {
  const email = normalizeAdminEmail(rawEmail);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isVerified: true, createdAt: true, isAdmin: true },
  });
  if (user === null) return { ok: false, reason: 'user-not-found' };
  if (!user.isAdmin) return { ok: false, reason: 'not-an-admin' };

  // ⚠️ 判定与写入之间有竞态窗口（两个进程同时撤销两个管理员 ⇒ 可能都通过判定）。
  // 当前它只由人在服务器上跑，且是单进程；真要做成 API 时必须放进一个事务里数
  // （`SELECT ... FOR UPDATE` 或串行化隔离）。这里如实记录，不假装它是原子的。
  if ((await countAdmins()) <= 1) return { ok: false, reason: 'last-admin' };

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: false } });
  return { ok: true, admin: toSummary(user) };
}
