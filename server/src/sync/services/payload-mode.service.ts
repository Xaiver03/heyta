import type { PrismaClient } from '@prisma/client';

import { syncPayloadModeSchema, type SyncPayloadMode } from '@heyta/shared-schema';

import { prisma } from '../../db';
import { Logger } from '../../logger';

/**
 * 账号级载荷模式的**唯一**读取入口（[ADR-0080](../../../docs/adr/0080-e2ee-is-optional-with-device-held-key.md)）。
 *
 * 两个调用面共用它：`GET /sync/payload-mode`（告诉客户端该写哪种载荷）与
 * 上传/快照入口的闸门（决定该收哪种载荷）。两处各写一份的话，
 * "客户端以为自己是 readable、服务端以为它是 e2ee"这种错配会在某次改动后悄悄出现。
 *
 * 🔴 **fail-closed 到 `'e2ee'`**：读失败、行不存在、值不认识，一律按最严那一档。
 * 反过来（失败时猜 `readable`）等于因为一次数据库抖动就把明文放进来。
 */
type PayloadModeReader = Pick<PrismaClient, 'userSyncState'>;

export const readPayloadMode = async (
  client: PayloadModeReader,
  userId: number,
): Promise<SyncPayloadMode> => {
  try {
    const row = await client.userSyncState.findUnique({
      where: { userId },
      select: { payloadMode: true },
    });
    // 没有 `user_sync_state` 行 = 这个账号还从没同步过 = 按默认值。
    const parsed = syncPayloadModeSchema.safeParse(row?.payloadMode ?? 'e2ee');
    if (!parsed.success) {
      Logger.error(`[user:${userId}] Unrecognised payload mode stored; treating as e2ee`);
      return 'e2ee';
    }
    return parsed.data;
  } catch (err) {
    Logger.error(
      `[user:${userId}] Payload mode read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'e2ee';
  }
};

/** 进程级默认读取器。事务里请把 `tx` 传进去，别绕开快照读。 */
export const readPayloadModeFromDb = (userId: number): Promise<SyncPayloadMode> =>
  readPayloadMode(prisma, userId);
