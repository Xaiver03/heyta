/**
 * 账号级通知的读写。
 *
 * ## 🔴 这里只装服务端**本来就知道**的事
 *
 * E2EE 是硬约束：服务端看不到任务明文，所以这张表**不可能**装
 * "你的任务 X 到期了"。它装的是账号级事实 —— 目前只有一类：
 * 有人用你的邀请码激活了，以及给你发了几天的会员。
 *
 * ## 为什么写入端只收「语义 + 参数」，不收渲染好的文案
 *
 * 界面文案的唯一事实源是 `packages/i18n`，而且用户随时能切语言。
 * 所以服务端存的是"发生了什么"（`kind` + `payload`），客户端负责
 * "这件事该怎么用中文说"。存成品文案的话，改一次措辞就要写一条数据迁移，
 * 而且一条三年前的通知会永远停在当年的措辞上。
 */
import { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { Logger } from '../logger';

/** 通知事件的词表。与 `packages/domain/src/activity.ts` 的 `NOTIFICATION_KINDS` 同源。 */
export type AccountNotificationKind = 'referral-activated';

/** 一条通知的对外投影（**白名单**，不带 `userId`）。 */
export interface AccountNotificationSummary {
  readonly id: number;
  readonly kind: string;
  readonly payload: Prisma.JsonValue;
  /** epoch 毫秒。 */
  readonly createdAt: number;
  /** epoch 毫秒；`null` = 未读。 */
  readonly readAt: number | null;
}

/**
 * 列表默认条数 / 硬上限。
 *
 * 有上限不是因为"多了会慢"（这张表按用户分区、索引齐），而是因为
 * **界面上那是一个下拉面板**：没有上限的列表在重度用户那里会长到
 * 把面板撑出屏幕，而用户真正会翻的是最近几条。
 * 分页游标留到真的有人翻到底时再加 —— 那时它是加法，不是破坏性变更
 * （响应已经是 `{ notifications: [...] }` 而不是裸数组）。
 */
export const NOTIFICATION_LIST_DEFAULT_LIMIT = 30;
export const NOTIFICATION_LIST_MAX_LIMIT = 100;

/** Prisma 的 `BigInt` 列 → epoch 毫秒。非法值返回 `null`（**不抛**）。 */
const toEpochMillis = (value: bigint | null): number | null => {
  if (value === null) return null;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
};

export interface CreateNotificationInput {
  readonly userId: number;
  readonly kind: AccountNotificationKind;
  /** 措辞参数。🔴 只放账号级事实，不放任何用户内容。 */
  readonly payload: Prisma.InputJsonValue;
  /** epoch 毫秒。 */
  readonly createdAt: number;
}

/**
 * 写一条通知。
 *
 * ⚠️ 接受 `tx` 是有意的：调用点（邀请结算）**必须**与"发奖"在同一个事务里，
 * 否则会出现"会员加了但通知没写"或反过来 —— 两者都不会报错，
 * 只是用户看到的和他实际拥有的对不上。
 */
export const createNotification = async (
  tx: Prisma.TransactionClient,
  input: CreateNotificationInput,
): Promise<void> => {
  await tx.accountNotification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      payload: input.payload,
      createdAt: BigInt(input.createdAt),
    },
  });
};

/**
 * 取某个用户的通知，**新的在前**。
 *
 * 返回 `{ notifications, unreadCount }`：未读数与列表一起给，是因为
 * 它们**必须来自同一次读取**。分两次查的话，中间新到一条通知会让
 * "列表里 3 条未读、徽标写 4" —— 而那是用户唯一能看见的那种不一致。
 */
export const listNotifications = async (
  userId: number,
  limit: number = NOTIFICATION_LIST_DEFAULT_LIMIT,
): Promise<{ notifications: AccountNotificationSummary[]; unreadCount: number }> => {
  const clamped = Math.min(
    Math.max(Math.trunc(limit), 1),
    NOTIFICATION_LIST_MAX_LIMIT,
  );

  const [rows, unreadCount] = await Promise.all([
    prisma.accountNotification.findMany({
      where: { userId },
      select: { id: true, kind: true, payload: true, createdAt: true, readAt: true },
      orderBy: { createdAt: 'desc' },
      take: clamped,
    }),
    prisma.accountNotification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      createdAt: toEpochMillis(row.createdAt) ?? 0,
      readAt: toEpochMillis(row.readAt),
    })),
    unreadCount,
  };
};

/**
 * 标记已读。`ids === null` 表示"全部标记"。
 *
 * 🔴 `where` 里**必须**带 `userId`：`ids` 是客户端给的，只按 id 更新的话
 * 任何登录用户都能把别人的通知标成已读（一个不需要任何构造的越权）。
 *
 * 已经读过的行不会被改写 —— `readAt: null` 是条件的一部分，
 * 这样"第一次读的时刻"是稳定的事实，而不是每次点击都被刷新。
 */
export const markNotificationsRead = async (
  userId: number,
  ids: readonly number[] | null,
  now: number,
): Promise<{ updated: number; unreadCount: number }> => {
  const where: Prisma.AccountNotificationWhereInput = { userId, readAt: null };
  if (ids !== null) {
    // 空数组是"标 0 条"，不是"标全部" —— 后者会让一个用户的误操作清空徽标。
    where.id = { in: [...ids] };
  }

  const result = await prisma.accountNotification.updateMany({
    where,
    data: { readAt: BigInt(now) },
  });

  const unreadCount = await prisma.accountNotification.count({
    where: { userId, readAt: null },
  });

  if (result.count > 0) {
    Logger.info(`Marked ${result.count} notification(s) read`);
  }
  return { updated: result.count, unreadCount };
};
