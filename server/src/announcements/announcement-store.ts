/**
 * 运营公告的数据面（ADR-0075）。
 * =================================
 *
 * 定性在 [`docs/adr/0075-announcements-are-a-content-channel.md`]
 * （../../../docs/adr/0075-announcements-are-a-content-channel.md）。
 * 这里只回答三件事：词表、"现在挂着没有"、以及投影。
 *
 * ## 🔴 `level` 是封闭词表，且**词表外直接抛**
 *
 * 与下单/退款那两处同一套做法：库里不设 CHECK。
 * 理由是 CHECK 的报错是一串 Postgres 文本，它到不了界面 ——
 * 而这里抛的是一个具名结果，路由能原样翻成 400。
 *
 * ## 🔴 "有效" 是**一条查询**，不是一个函数
 *
 * `publishedAt <= now` 且（`expiresAt` 为空 或 `> now`）—— 这一句只住在这里。
 * 界面、后台列表、缓存层都不许再各写一遍：两处的差会表现为
 * "运营以为已经下架了，用户还看得见"，而那正是公告最不该出的错。
 */
import { prisma } from '../db';

/** 公告的语义档位。**封闭词表** —— 加一档要同时改界面怎么画它。 */
export const ANNOUNCEMENT_LEVELS = ['info', 'warning'] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

export function isAnnouncementLevel(value: unknown): value is AnnouncementLevel {
  return typeof value === 'string' && (ANNOUNCEMENT_LEVELS as readonly string[]).includes(value);
}

/** 一次最多下发几条。公告不是信息流，十几条已经读不动了。 */
export const ACTIVE_ANNOUNCEMENT_LIMIT = 20;

export interface AnnouncementRecord {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly level: AnnouncementLevel;
  readonly publishedAt: number;
  readonly expiresAt: number | null;
  readonly createdBy: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 词表外的一行（库里躺着一条历史脏数据）⇒ 抛，不静默降级成 `info`。 */
function toRecord(row: {
  id: number;
  title: string;
  body: string;
  level: string;
  publishedAt: bigint;
  expiresAt: bigint | null;
  createdBy: number | null;
  createdAt: bigint;
  updatedAt: bigint;
}): AnnouncementRecord {
  if (!isAnnouncementLevel(row.level)) {
    throw new AnnouncementLevelError(row.level);
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    publishedAt: Number(row.publishedAt),
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export class AnnouncementLevelError extends Error {
  constructor(readonly storedLevel: string) {
    super(`announcement level 词表外的存量行：${JSON.stringify(storedLevel)}`);
    this.name = 'AnnouncementLevelError';
  }
}

/**
 * 当前有效的那几条，按发布时刻倒序。
 *
 * 🔴 「有效」的那两个谓词在本仓库里**只出现在这一处**。
 */
export async function listActiveAnnouncements(now: number): Promise<AnnouncementRecord[]> {
  const rows = await prisma.announcement.findMany({
    where: {
      publishedAt: { lte: BigInt(now) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: BigInt(now) } }],
    },
    orderBy: { publishedAt: 'desc' },
    take: ACTIVE_ANNOUNCEMENT_LIMIT,
  });
  return rows.map(toRecord);
}

/**
 * 一条公告在**某个时刻**的状态。
 *
 * 🔴 这个判定只住在这里。后台列表要标"还没生效 / 挂着 / 已过期"，
 * 而界面自己拿 `Date.now()` 比一次时间戳就是**第二套标准** ——
 * 两处的差表现为"运营以为已经下架了，用户还看得见"（ADR-0075 §3.4）。
 * 所以后台的投影带一个服务端算好的 `state`，界面只负责给它一个词。
 */
export type AnnouncementState = 'pending' | 'active' | 'expired';

export function announcementStateAt(record: AnnouncementRecord, now: number): AnnouncementState {
  if (record.publishedAt > now) return 'pending';
  if (record.expiresAt !== null && record.expiresAt <= now) return 'expired';
  return 'active';
}

/** 后台列表：含**还没生效**与**已经过期**的那些（运营要看的就是全部现状）。 */
export async function listAllAnnouncements(): Promise<AnnouncementRecord[]> {
  const rows = await prisma.announcement.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 100,
  });
  return rows.map(toRecord);
}

export interface PublishAnnouncementInput {
  readonly title: string;
  readonly body: string;
  readonly level: AnnouncementLevel;
  readonly publishedAt: number;
  readonly expiresAt: number | null;
}

/** 发一条。`actor` 是那个管理员的 user id —— 它是**归属记录**，不是外键。 */
export async function publishAnnouncement(
  input: PublishAnnouncementInput,
  actor: number,
  now: number,
): Promise<AnnouncementRecord> {
  if (!isAnnouncementLevel(input.level)) {
    // 路由那一侧的 zod 已经挡过一次；这一道是给"绕过路由直接调 store"的。
    throw new AnnouncementLevelError(String(input.level));
  }
  const created = await prisma.announcement.create({
    data: {
      title: input.title,
      body: input.body,
      level: input.level,
      publishedAt: BigInt(input.publishedAt),
      expiresAt: input.expiresAt === null ? null : BigInt(input.expiresAt),
      createdBy: actor,
      createdAt: BigInt(now),
      updatedAt: BigInt(now),
    },
  });
  return toRecord(created);
}

/**
 * 下架 = **删掉那一行**，不是"下发一条空公告"。
 *
 * 与调休那条同一理由：内容本身没有"部分状态"可言，留一行空的只是把一个
 * 已撤销的决定变成一个要解释的数据。返回是否真删到（0 行 = 那条已经不在了），
 * 界面要能说"它已经不在了"而不是"已完成"。
 */
export async function withdrawAnnouncement(id: number): Promise<boolean> {
  const deleted = await prisma.announcement.deleteMany({ where: { id } });
  return deleted.count > 0;
}
