import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * 账号硬删 + 墓碑（P-12 / ADR-0055）。
 *
 * 两条硬删路径（`DELETE /account` 与 `scripts/delete-user.ts`）必须走这一个函数：
 * 少写一次墓碑，症状不是报错，是**恢复旧备份时没有任何一层知道该拒绝谁** ——
 * 而"恢复不得把已注销的账号复活"是这次变更唯一要兑现的承诺。
 */

/** 与 `server/src/admin/admins.ts` 的查找口径一致（trim + 小写），不是新的一套归一化。 */
export function hashAccountEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

export interface AccountClosureRecord {
  readonly userId: number;
  readonly emailHash: string;
  readonly closedAt: Date;
}

/**
 * 在**同一个事务里**写墓碑、删账号。调用方传进来的必须是事务客户端
 * （`prisma.$transaction(async (tx) => …)` 的那个 `tx`），不是 `prisma` 本身：
 * 两步分开提交的形状是"账号没了、墓碑没落"，而那是最坏的一半 ——
 * 库面上看不出来，直到某次恢复把这个人带回来。
 *
 * 墓碑用 `upsert` 而不是 `create`：一个 id 已经有墓碑只可能是有人**绕过恢复闸**
 * 把旧备份导回去过（闸会把墓碑 id 的行再删一遍，见 `scripts/restore.sh`）。
 * 那种情况下注销仍然要能完成，墓碑刷新成最近一次的时刻，而不是撞 `P2002` 卡在
 * "这个人删不掉"。
 */
export async function deleteAccountWithTombstone(
  tx: Prisma.TransactionClient,
  userId: number,
  closedAt: Date = new Date(),
): Promise<AccountClosureRecord> {
  const victim = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  const emailHash = hashAccountEmail(victim.email);

  await tx.accountTombstone.upsert({
    where: { userId },
    create: { userId, emailHash, closedAt },
    update: { emailHash, closedAt },
  });
  await tx.user.delete({ where: { id: userId } });

  return { userId, emailHash, closedAt };
}
