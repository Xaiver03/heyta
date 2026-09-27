import { describe, it, expect } from 'vitest';
import {
  applyPaymentEvent,
  type ApplyPaymentEventDeps,
  type ExistingSubscription,
} from '../src/billing/apply-event';
import type { NormalizedPaymentEvent } from '../src/billing/types';
// 🔴 注入的就是 domain 的**那一份**纯函数（相对路径，测试可以跨包 import）。
// 这样这组用例证明的是 domain 的语义被接上了，而不是"服务端自己又写了一个"。
import { extendSubscriptionPeriod } from '../../packages/domain/src/subscription';

/**
 * `applyPaymentEvent` 的**一次性支付授予路径**（阶段一主路径）单元测试。
 *
 * 🔴 这些用例不碰数据库、不碰网络、不用真凭证。
 * 路由级的幂等（同一 `out_trade_no` 只授予一次）在
 * `billing-wechat.routes.spec.ts` 里测 —— 那里才有一条真实的唯一约束。
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const YEAR = 365 * DAY;

interface Row extends ExistingSubscription {
  userId: number;
  provider: string;
  externalSubscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: number | bigint | null;
  lastEventAt: number | bigint | null;
  createdAt: number;
  updatedAt: number;
}

const makeDeps = () => {
  const rows = new Map<number, Row>();
  const created: Row[] = [];
  const updated: Array<{ id: number; data: Record<string, unknown> }> = [];
  let seq = 0;

  const deps: ApplyPaymentEventDeps = {
    async findSubscription(externalSubscriptionId) {
      return (
        [...rows.values()].find(
          (row) => row.externalSubscriptionId === externalSubscriptionId,
        ) ?? null
      );
    },
    async findSubscriptionByUser(userId, provider) {
      return (
        [...rows.values()].find(
          (row) => row.userId === userId && row.provider === provider,
        ) ?? null
      );
    },
    async createSubscription(data) {
      seq += 1;
      const row: Row = { id: seq, ...data } as Row;
      rows.set(seq, row);
      created.push(row);
      return { id: seq };
    },
    async updateSubscription(id, data) {
      const row = rows.get(id);
      if (row) {
        rows.set(id, { ...row, ...data });
      }
      updated.push({ id, data: data as unknown as Record<string, unknown> });
      return row;
    },
    extendPeriod: extendSubscriptionPeriod,
    now: () => NOW,
  };

  return { deps, rows, created, updated };
};

const wechatEvent = (
  overrides: Partial<NormalizedPaymentEvent> = {},
): NormalizedPaymentEvent => ({
  provider: 'wechat',
  providerEventId: 'payment_succeeded:hy1x1xdeadbeef',
  eventType: 'payment_succeeded',
  occurredAt: NOW,
  externalSubscriptionId: null,
  status: null,
  currentPeriodEnd: null,
  userId: 42,
  oneTimeGrant: { periodDays: 365, priceId: 'hosted-ai-monthly', grants: ['hosting', 'ai'] },
  ...overrides,
});

describe('applyPaymentEvent — 一次性支付授予路径', () => {
  it('首次购买：建一行 (userId, provider)，externalSubscriptionId = null，+365 天', async () => {
    const { deps, created, rows } = makeDeps();
    const outcome = await applyPaymentEvent(wechatEvent(), deps);

    expect(outcome).toEqual({ status: 'applied', subscriptionId: 1 });
    expect(created).toHaveLength(1);
    expect(rows.size).toBe(1);
    const row = created[0];
    expect(row.provider).toBe('wechat');
    expect(row.userId).toBe(42);
    // 🔴 免费 / 微信：没有订阅对象，这一列是 null。
    expect(row.externalSubscriptionId).toBeNull();
    expect(row.status).toBe('active');
    expect(row.currentPeriodEnd).toBe(NOW + YEAR);
    expect(row.lastEventAt).toBe(NOW);
  });

  it('🔴 提前续费必须叠加：已有到期日在未来 → max(now, 已有) + 365 天', async () => {
    const { deps, rows, updated } = makeDeps();
    await applyPaymentEvent(wechatEvent(), deps);

    // 90 天后用户提前续费（此时距到期还有 275 天）。
    const later = NOW + 90 * DAY;
    (deps as { now: () => number }).now = () => later;
    const outcome = await applyPaymentEvent(
      wechatEvent({ occurredAt: later, providerEventId: 'payment_succeeded:order2' }),
      deps,
    );

    expect(outcome).toEqual({ status: 'applied', subscriptionId: 1 });
    // 只更新那一行，**没有新建第二行**。
    expect(rows.size).toBe(1);
    expect(updated).toHaveLength(1);
    // 从"原到期日"再叠 365 天，而不是从 later 起算（那会吃掉剩余 275 天）。
    expect(updated[0].data.currentPeriodEnd).toBe(NOW + YEAR + YEAR);
  });

  it('已过期：到期日在过去 → 从 now 起算（不把新时长埋进过去）', async () => {
    const { deps, rows } = makeDeps();
    rows.set(1, {
      id: 1,
      userId: 42,
      provider: 'wechat',
      externalSubscriptionId: null,
      status: 'active',
      currentPeriodEnd: NOW - 30 * DAY,
      lastEventAt: NOW - 400 * DAY,
      createdAt: NOW - 400 * DAY,
      updatedAt: NOW - 400 * DAY,
    });

    await applyPaymentEvent(wechatEvent(), deps);
    expect([...rows.values()][0].currentPeriodEnd).toBe(NOW + YEAR);
  });

  it('🔴 不同订单 = 两次授予：两次事件各叠加一次', async () => {
    const { deps, updated, created } = makeDeps();
    await applyPaymentEvent(wechatEvent(), deps);
    const second = NOW + 10 * DAY;
    (deps as { now: () => number }).now = () => second;
    await applyPaymentEvent(
      wechatEvent({ occurredAt: second, providerEventId: 'payment_succeeded:order2' }),
      deps,
    );

    // 两笔都真授予了：一次建行 + 一次叠加。
    expect(created).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(updated[0].data.currentPeriodEnd).toBe(NOW + YEAR + YEAR);
  });

  it('乱序：事件时间更早 → stale，绝不把到期日改小', async () => {
    const { deps, rows } = makeDeps();
    await applyPaymentEvent(wechatEvent({ occurredAt: NOW + DAY }), deps);
    const before = [...rows.values()][0].currentPeriodEnd;

    const stale = await applyPaymentEvent(
      wechatEvent({ occurredAt: NOW, providerEventId: 'payment_succeeded:late' }),
      deps,
    );
    expect(stale).toEqual({ status: 'stale', subscriptionId: 1 });
    expect([...rows.values()][0].currentPeriodEnd).toBe(before);
    expect(rows.size).toBe(1);
  });

  it('没有 userId → 不建行，ignored / NO_USER_REFERENCE', async () => {
    const { deps, created, rows } = makeDeps();
    const outcome = await applyPaymentEvent(wechatEvent({ userId: null }), deps);
    expect(outcome).toEqual({ status: 'ignored', reason: 'NO_USER_REFERENCE' });
    expect(created).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it('occurredAt 非法 → ignored / INVALID_OCCURRED_AT，不写任何行', async () => {
    const { deps, created } = makeDeps();
    const outcome = await applyPaymentEvent(
      wechatEvent({ occurredAt: Number.NaN }),
      deps,
    );
    expect(outcome).toEqual({ status: 'ignored', reason: 'INVALID_OCCURRED_AT' });
    expect(created).toHaveLength(0);
  });

  it('🔴 没有 oneTimeGrant 的"无订阅引用"事件**不发权益**（不被推断成发一年）', async () => {
    const { deps, created, rows } = makeDeps();
    const outcome = await applyPaymentEvent(
      wechatEvent({ oneTimeGrant: null }),
      deps,
    );
    expect(outcome).toEqual({ status: 'ignored', reason: 'NO_SUBSCRIPTION_REFERENCE' });
    expect(created).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it('🔴 有券的支付（金额落不到档位）→ REQUIRES_ORDER_SETTLEMENT，**不是** NO_SUBSCRIPTION_REFERENCE', async () => {
    // 这正是 §7 第 9 条那个洞：adapter 观察到钱、却推不出档位（¥12 档用券后
    // 实付落不到任何档位原价）。以前它与"退款 / 对账通知"共用一个原因 ——
    // 对一笔真实到账的支付是**假话**，运维在日志里看不到"有一笔钱没交付权益"。
    const { deps, created, rows } = makeDeps();
    const outcome = await applyPaymentEvent(
      wechatEvent({ oneTimeGrant: null, requiresOrderSettlement: true }),
      deps,
    );

    expect(outcome).toEqual({ status: 'ignored', reason: 'REQUIRES_ORDER_SETTLEMENT' });
    // 仍然 fail-closed：金额推不出档位，所以在这里**不发**权益。
    expect(created).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it('🔴 两个原因**必须可区分**：有无"钱"是两种不同的事', async () => {
    const noGrant = makeDeps();
    const a = await applyPaymentEvent(wechatEvent({ oneTimeGrant: null }), noGrant.deps);
    const needSettle = makeDeps();
    const b = await applyPaymentEvent(
      wechatEvent({ oneTimeGrant: null, requiresOrderSettlement: true }),
      needSettle.deps,
    );

    // 打平成字符串比较，确保它们不相等 —— 这正是"静默"与"响亮"的分界。
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(a).toEqual({ status: 'ignored', reason: 'NO_SUBSCRIPTION_REFERENCE' });
    expect(b).toEqual({ status: 'ignored', reason: 'REQUIRES_ORDER_SETTLEMENT' });
  });

  it('自定义 periodDays 生效', async () => {
    const { deps, created } = makeDeps();
    await applyPaymentEvent(
      wechatEvent({
        oneTimeGrant: { periodDays: 30, priceId: 'hosted-monthly', grants: ['hosting'] },
      }),
      deps,
    );
    expect(created[0].currentPeriodEnd).toBe(NOW + 30 * DAY);
  });

  it('🔴 档位与能力**必须落到订阅行**：¥12 买到的是 hosted-ai-monthly + ai', async () => {
    const { deps, created } = makeDeps();
    await applyPaymentEvent(wechatEvent(), deps);

    // 夹具买的是 `hosted-ai-monthly`（¥12）。断言这两列真的被写下来 ——
    // 只写到期日的话，付 ¥12 与付 ¥5 会得到完全一样的行。
    expect(created[0].priceId).toBe('hosted-ai-monthly');
    expect(created[0].grants).toEqual(['hosting', 'ai']);
  });

  it('🔴 降级立即生效：能力是**替换**而不是并集（否则付 ¥5 的人一直用着 ¥12）', async () => {
    const { deps, created, updated } = makeDeps();
    // 先买 ¥12（hosting + ai）……
    await applyPaymentEvent(wechatEvent(), deps);
    expect(created[0].grants).toEqual(['hosting', 'ai']);

    // ……再买 ¥5（只有 hosting）。同一行、只有一个到期日，所以后一次定调。
    await applyPaymentEvent(
      wechatEvent({
        occurredAt: NOW + DAY,
        providerEventId: 'o2',
        oneTimeGrant: { periodDays: 30, priceId: 'hosted-monthly', grants: ['hosting'] },
      }),
      deps,
    );
    expect(updated[0].data.grants).toEqual(['hosting']);
    expect(updated[0].data.priceId).toBe('hosted-monthly');
    // 并集（`['hosting','ai']`）是更坏的选择：它让降级永远不生效。
    expect(updated[0].data.grants).not.toContain('ai');
  });

  it('🔴 写入字段里**没有删除语义**：只写 status / currentPeriodEnd / lastEventAt', async () => {
    const { deps, updated, created } = makeDeps();
    await applyPaymentEvent(wechatEvent(), deps);
    await applyPaymentEvent(
      wechatEvent({ occurredAt: NOW + DAY, providerEventId: 'o2' }),
      deps,
    );
    for (const payload of [...created, ...updated.map((u) => u.data)]) {
      expect(Object.keys(payload).every((key) => !/delete/i.test(key))).toBe(true);
      expect(payload).not.toHaveProperty('deletedAt');
      expect(payload).not.toHaveProperty('deleted');
    }
  });

  it('其它用户的订阅行不会被这条事件碰到（一行一用户）', async () => {
    const { deps, rows } = makeDeps();
    rows.set(9, {
      id: 9,
      userId: 7,
      provider: 'wechat',
      externalSubscriptionId: null,
      status: 'active',
      currentPeriodEnd: NOW + 50 * DAY,
      lastEventAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await applyPaymentEvent(wechatEvent({ userId: 42 }), deps);
    expect(rows.get(9)!.currentPeriodEnd).toBe(NOW + 50 * DAY);
    expect(rows.size).toBe(2);
  });

  it('带 externalSubscriptionId 的订阅路径不受影响（回归）', async () => {
    const { deps, created } = makeDeps();
    const outcome = await applyPaymentEvent(
      {
        provider: 'paddle',
        providerEventId: 'evt_1',
        eventType: 'subscription.renewed',
        occurredAt: NOW,
        externalSubscriptionId: 'sub_1',
        status: 'active',
        currentPeriodEnd: NOW + 30 * DAY,
        userId: 42,
      },
      deps,
    );
    expect(outcome).toEqual({ status: 'applied', subscriptionId: 1 });
    expect(created[0].externalSubscriptionId).toBe('sub_1');
    expect(created[0].currentPeriodEnd).toBe(NOW + 30 * DAY);
  });
});