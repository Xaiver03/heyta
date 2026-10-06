/**
 * 退款的状态机与**唯一**的权益回收落点（临时方案，ADR-0053）
 * ==========================================================
 *
 * 政策本身（7×24 小时、全额、例外只走后台）在 `refund-policy.ts`，是纯函数；
 * 本文件只做四件事：读库、按政策决定、把状态推进一步、在**唯一**允许的时刻动权益。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 状态机：谁能到谁，以及"动权益"只有一条边
 *
 * ```
 *  (申请) ──▶ requested ──(运营批准)──▶ approved ──(发给通道)──▶ processing
 *                 │                        │                        │
 *                 │(运营拒绝)               │(通道拒 / 抛错)           │
 *                 ▼                        ▼                        ├─▶ success  ◀── 只有这一格动权益
 *              rejected                 failed                      │
 *                                                                   ├─▶ abnormal
 *                                                                   └─▶ closed
 * ```
 *
 * `success` 有两个来源（同步响应里就回 SUCCESS、或 `REFUND.SUCCESS` 通知），
 * 所以它**必须**是幂等的：回收由一条带条件的 `UPDATE … WHERE refunded_at IS NULL`
 * 决定，第二次到达得到 `already-applied` 且**不再动任何东西**。
 * 这不是"防手滑"：微信明确是 at-least-once 投递且不保证顺序。
 *
 * ⚠️ 图上少画了一条边：`failed → success` **也**允许（只由带签名的通知认领）。
 * 本系统写 `failed` 的唯一时刻是"发通道时抛错"，而那里面包含"请求到了、响应丢了"，
 * 挡掉这条边会让那一行**永远**不能回收 —— 症状正是要防的"钱退了而权益还在"。
 * 详见 `applyRefundResultInTransaction` 里那段注释与 ADR-0053 §5 的边界。
 *
 * ## 🔴 为什么"通道说受理了"不许动权益
 *
 * `processing` 与 `success` 的区别就是"钱还没出去"与"钱已经出去"。
 * 在 `processing` 上回收 = **用户没拿到钱、权益却掉了** —— 那与 ADR-0026
 * 禁止的"订单已退款而权益还在"是同一类半真状态，只是方向更坏。
 * 所以 `refunded_at` 只由 `success` 写，而库里那条
 * `status='success' ⟺ refunded_at IS NOT NULL` 的 CHECK
 * （迁移 `20261014000000_add_refunds`）把这件事钉到了**结构层**：
 * 就算有人在这里写错字段，`INSERT/UPDATE` 自己会拒。
 *
 * ## 🔴 回收量 = `period_days`，不是"当前到期日减到 now"
 *
 * ADR-0026 §1 查实订阅行记不下"哪一笔买了哪一段"，所以任何按当前状态猜的回收
 * 都是过度回收。这里回收的是**冻在这一行上的那一段**（申请时从订单写进来的天数），
 * 并且只在"这一行之外已经没有别的已付订单"时才让整行失效
 * （`retractGrantedPeriod` 的两条规则）。
 */
import { randomBytes } from 'node:crypto';

import type { SqlExecutor, SqlRunner } from './pricing-store';
import {
  appendAudit,
  reverseOrderOnRefundInTransaction,
} from './pricing-store';
import { isCurrency } from './money';
import type { Currency } from './money';
import {
  REFUND_PERIOD_DAYS,
  decideRefundEligibility,
  retractGrantedPeriod,
  type RefundDenialReason,
} from './refund-policy';
import type { BillingAdapter, ProviderRefundStatus } from './types';

/** 我方退款状态词表。库不设 CHECK，由写入函数在词表外直接抛（与订单侧同一做法）。 */
export const REFUND_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'processing',
  'success',
  'abnormal',
  'closed',
  'failed',
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const isRefundStatus = (value: unknown): value is RefundStatus =>
  typeof value === 'string' && (REFUND_STATUSES as readonly string[]).includes(value);

/**
 * 我方退款单号 —— 通道的幂等键。
 *
 * 形状 `hyrf<orderId>x<epochSec>x<nonce>`：
 * · 带 `orderId` 是为了**排查时一眼能对上单**（微信后台只能按这个号搜）；
 * · 带时间戳与随机段是为了"同一单失败后重试"必须换号 —— 微信对同一
 *   `out_refund_no` 的重复请求会回**原结果**，那会让一次"改金额重试"被静默吃掉。
 *   🔴 所以重试**必须**生成新号，本函数的输入里没有"第几次"，唯一性由库上的
 *   `out_refund_no` 唯一约束兜底。
 */
export const buildOutRefundNo = (
  orderId: number,
  now: number,
  nonce: string = randomBytes(6).toString('hex'),
): string => `hyrf${orderId}x${Math.floor(now / 1000)}x${nonce}`;

interface RefundRow {
  readonly id: unknown;
  readonly order_id: unknown;
  readonly user_id: unknown;
  readonly provider: unknown;
  readonly out_refund_no: unknown;
  readonly amount_minor: unknown;
  readonly currency: unknown;
  readonly period_days: unknown;
  readonly status: unknown;
}

interface OrderForRefundRow {
  readonly id: unknown;
  readonly user_id: unknown;
  readonly provider: unknown;
  readonly out_trade_no: unknown;
  readonly status: unknown;
  readonly paid_at: unknown;
  readonly currency: unknown;
  readonly final_amount_minor: unknown;
}

const asNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** 审计里的 `actor` 是 `admin:<id>` / `system` 这种字符串；`users.id` 列只认前者。
 *  解析不出来就是 `null` —— 宁可留空，也不写一个看起来像 id 的假归属。 */
const userIdFromActor = (actor: string): number | null => {
  const matched = /^admin:(\d+)$/.exec(actor);
  return matched === null ? null : Number(matched[1]);
};

/** 读一行退款。**唯一**的读取形状：字段名到驼峰只在这里做一次。 */
const mapRefundRow = (row: RefundRow) => ({
  id: Number(row.id),
  orderId: Number(row.order_id),
  userId: Number(row.user_id),
  provider: String(row.provider),
  outRefundNo: String(row.out_refund_no),
  amountMinor: Number(row.amount_minor),
  currency: String(row.currency),
  periodDays: Number(row.period_days),
  status: row.status,
});

export type RequestRefundResult =
  | {
      readonly outcome: 'requested';
      readonly refundId: number;
      readonly outRefundNo: string;
      readonly amountMinor: number;
    }
  | { readonly outcome: 'not-found' }
  | { readonly outcome: 'denied'; readonly reason: RefundDenialReason };

/**
 * 申请退款：读订单 → 过政策 → 落一行 `requested`。
 *
 * 🔴 金额与天数在**这一步**就冻结。之后的审批、通道答复、权益回收都只读这一行 ——
 * 中间任何一次价目表改动或券状态变化都不许改变"该退多少、该扣几天"。
 *
 * ⚠️ `operatorApproved` 只能由**后台带理由的审批路径**传 true。
 * 它跳过的是时间窗，不是"这单付过钱"这种更基本的事实（判定顺序见政策函数）。
 *
 * ⚠️ 这里**没有** `periodDays` 旋钮：回收量必须等于"那一单当初授予的量"，
 * 而授予侧用的是 `@heyta/domain` 那个常量（`webhook.routes.ts` 写单就是拿它写的）。
 * 让调用方能传天数 = 让运营可以凭手感决定扣几天，那不是"临时方案的弹性"，是第二个事实源。
 */
export const requestRefund = async (
  sql: SqlExecutor,
  input: {
    readonly orderId: number;
    readonly now: number;
    readonly actor: string;
    readonly operatorApproved?: boolean;
    readonly note?: string;
  },
): Promise<RequestRefundResult> =>
  sql.transaction(async (tx) => {
    const rows = await tx.query<OrderForRefundRow>(
      `SELECT id, user_id, provider, out_trade_no, status, paid_at, currency, final_amount_minor
         FROM checkout_orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const order = rows[0];
    if (order === undefined) return { outcome: 'not-found' };

    // 🔴 这一单是否**已经**在退款路上。必须在 `FOR UPDATE` 之后查：订单行锁就是这里的
    // 互斥量，两次并发申请会在 `SELECT … FOR UPDATE` 上排队，第二个一定读到第一个刚插的
    // 那一行。不拿锁的"先查再插"会双双读到"没有"，于是同一笔钱有两行退款、
    // 两次批准、两次发给通道 —— 而每一行都声称自己回收了一次。
    //
    // `rejected` / `failed` / `closed` **不算开着**：被拒的申请、通道没受理的申请、
    // 以及通道自己关掉的申请都不欠用户钱，重试应当是可行的（临时方案的口径）。
    // `success` 算开着（虽然那种情况下订单一般已经是 `refunded` 而被上一条挡掉），
    // 把它留在集合里是为了**不依赖**那条假设。
    const open = await tx.query<{ one: number }>(
      `SELECT 1 AS one FROM refunds
        WHERE order_id = $1 AND status IN ('requested', 'approved', 'processing', 'success')
        LIMIT 1`,
      [input.orderId],
    );

    // 🔴 币种不认识时**抛**，不按某个默认币种退：`amount_minor` 是"最小单位的整数"，
    // 数不带币种就不可比（同 `CreateCheckoutInput.currency` 那条纪律）。
    // 一个静默的 `CNY` 会让一笔 USD 单被按人民币退出去。
    if (!isCurrency(order.currency)) {
      throw new Error(
        `订单 ${Number(order.id)} 的币种 ${JSON.stringify(order.currency)} 不在词表里 —— 数据已损坏`,
      );
    }
    const currency: Currency = order.currency;

    const decision = decideRefundEligibility({
      status: String(order.status),
      paidAt: asNumber(order.paid_at),
      paidAmountMinor: asNumber(order.final_amount_minor),
      outTradeNo:
        order.out_trade_no === null || order.out_trade_no === undefined
          ? null
          : String(order.out_trade_no),
      openRefundExists: open.length > 0,
      now: input.now,
      operatorApproved: input.operatorApproved === true,
    });

    if (!decision.allowed) {
      // 被拒也要落审计：用户/运营问"为什么不能退"时，那一次判断必须是查得到的事实，
      // 而不是"当时接口返回了什么"。
      await appendAudit(tx, {
        action: 'refund_denied',
        target: `order:${Number(order.id)}`,
        beforeJson: JSON.stringify({ status: String(order.status), paidAt: asNumber(order.paid_at) }),
        afterJson: null,
        actor: input.actor,
        note: `退款申请被拒：${decision.reason}`,
        now: input.now,
      });
      return { outcome: 'denied', reason: decision.reason };
    }

    const outRefundNo = buildOutRefundNo(Number(order.id), input.now);
    // `requested_by` / `decided_by` 收的是 `users.id`，而审计里的 `actor` 是字符串
    // （`admin:<id>` / `system`）。解析不出来就留 null —— **不**拿 actor 硬塞一个假的用户 id。
    const actorUserId = userIdFromActor(input.actor);
    const inserted = await tx.query<RefundRow>(
      `INSERT INTO refunds
         (order_id, user_id, provider, out_refund_no, amount_minor, currency, period_days,
          status, operator_note, requested_by, requested_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'requested', $8, $9, $10, $10, $10)
       RETURNING id, order_id, user_id, provider, out_refund_no, amount_minor, currency, period_days, status`,
      [
        Number(order.id),
        Number(order.user_id),
        String(order.provider),
        outRefundNo,
        decision.amountMinor,
        currency,
        REFUND_PERIOD_DAYS,
        input.note ?? (input.operatorApproved === true ? '运营批准：超出时间窗' : null),
        actorUserId,
        input.now,
      ],
    );
    const row = inserted[0];
    if (row === undefined) {
      throw new Error('退款申请写入后读不回那一行 —— 事务里发生了一件没有解释的事');
    }
    const parsed = mapRefundRow(row);

    await appendAudit(tx, {
      action: 'refund_requested',
      target: `refund:${parsed.id}`,
      beforeJson: JSON.stringify({ orderStatus: String(order.status) }),
      afterJson: JSON.stringify({ amountMinor: parsed.amountMinor, outRefundNo: parsed.outRefundNo }),
      actor: input.actor,
      note: `退款申请已受理（${input.operatorApproved === true ? '运营批准' : '时间窗内'}）`,
      now: input.now,
    });

    return {
      outcome: 'requested',
      refundId: parsed.id,
      outRefundNo: parsed.outRefundNo,
      amountMinor: parsed.amountMinor,
    };
  });

export type DecideRefundResult =
  | { readonly outcome: 'decided'; readonly status: RefundStatus }
  | { readonly outcome: 'not-found' }
  /** 已经决定过一次 / 已经有终态：条件更新挡掉的，不是异常。 */
  | { readonly outcome: 'not-decidable' };

/**
 * 运营批准或拒绝一次申请。
 *
 * 🔴 条件更新 `WHERE status = 'requested'` 是这条路径唯一的闸门。
 * "先读再写"在这里不行：两个管理员同时点批准会得到两次 `approved`，
 * 而批准之后就是**真的发钱**（`submitRefundToChannel`）。
 */
export const decideRefund = async (
  sql: SqlExecutor,
  input: {
    readonly refundId: number;
    readonly decision: 'approve' | 'reject';
    readonly actor: string;
    readonly note?: string;
    readonly now: number;
  },
): Promise<DecideRefundResult> =>
  sql.transaction(async (tx) => {
    const next: RefundStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    const changed = await tx.execute(
      `UPDATE refunds
          SET status = $2, decided_by = $3, decided_at = $4, updated_at = $4,
              operator_note = COALESCE($5, operator_note),
              reason = CASE WHEN $2 = 'rejected' THEN 'OPERATOR_REJECTED' ELSE reason END
        WHERE id = $1 AND status = 'requested'`,
      [
        input.refundId,
        next,
        userIdFromActor(input.actor),
        input.now,
        input.note ?? null,
      ],
    );
    if (changed === 0) {
      const exists = await tx.query<{ id: unknown }>(`SELECT id FROM refunds WHERE id = $1`, [
        input.refundId,
      ]);
      return exists[0] === undefined ? { outcome: 'not-found' } : { outcome: 'not-decidable' };
    }

    await appendAudit(tx, {
      action: 'refund_decided',
      target: `refund:${input.refundId}`,
      beforeJson: JSON.stringify({ status: 'requested' }),
      afterJson: JSON.stringify({ status: next }),
      actor: input.actor,
      note: input.note ?? (input.decision === 'approve' ? '批准退款' : '拒绝退款'),
      now: input.now,
    });

    return { outcome: 'decided', status: next };
  });

/** 库里读出来的币种 → 端口要的 `Currency`。陌生值抛，不猜。 */
const refundCurrencyOf = (value: string): Currency => {
  if (!isCurrency(value)) {
    throw new Error(`退款行的币种 ${JSON.stringify(value)} 不在词表里 —— 数据已损坏`);
  }
  return value;
};

export type SubmitRefundResult =
  | { readonly outcome: 'submitted'; readonly status: RefundStatus; readonly providerRefundId: string | null }
  | { readonly outcome: 'channel-failed'; readonly reason: string }
  | { readonly outcome: 'not-found' }
  | { readonly outcome: 'not-submittable'; readonly status: unknown };

/**
 * 把一次已批准的退款发给通道。
 *
 * 🔴 **不在事务里**：网络调用不能占住一个开了 `FOR UPDATE` 的数据库事务
 * （那会把这张行的后续读写排在一次可能几十秒的 HTTP 后面）。
 * 所以这里的写法是"先发、再按条件落状态"，两半各自可重入：
 * · 发成功但落库前进程死了 ⇒ 行停在 `approved`，重试会换一个 `out_refund_no`
 *   再发一次 —— 那**不是**双退，因为通道侧两次请求是两个不同的退款单号，
 *   而第二次会因金额超过可退额被拒（`refund ≤ total` 那条），失败如实落 `failed`。
 *   ⚠️ 这是本方案已知的最粗的一处，写进 ADR-0053 §5 而不是藏起来。
 * · 发失败 ⇒ 行落 `failed` + 原因，权益一格都不动。
 */
export const submitRefundToChannel = async (
  sql: SqlExecutor,
  input: { readonly refundId: number; readonly adapter: BillingAdapter; readonly now: number },
): Promise<SubmitRefundResult> => {
  const rows = await sql.query<
    RefundRow & { readonly out_trade_no: unknown; readonly final_amount_minor: unknown }
  >(
    `SELECT r.id, r.order_id, r.user_id, r.provider, r.out_refund_no, r.amount_minor, r.currency,
            r.period_days, r.status, o.out_trade_no, o.final_amount_minor
       FROM refunds r JOIN checkout_orders o ON o.id = r.order_id
      WHERE r.id = $1`,
    [input.refundId],
  );
  const row = rows[0];
  if (row === undefined) return { outcome: 'not-found' };
  const status = row.status;
  if (!isRefundStatus(status)) {
    throw new Error(`退款 ${Number(row.id)} 的状态 ${JSON.stringify(row.status)} 不在词表里 —— 数据已损坏`);
  }
  if (status !== 'approved') return { outcome: 'not-submittable', status };

  const parsed = mapRefundRow(row);
  let result: { providerRefundId: string | null; status: ProviderRefundStatus };
  try {
    result = await input.adapter.refund({
      outTradeNo: String(row.out_trade_no),
      outRefundNo: parsed.outRefundNo,
      refundAmountMinor: parsed.amountMinor,
      totalAmountMinor: Number(row.final_amount_minor),
      // 库里那一列是字符串，而端口收的是 `Currency` 联合类型 —— 中间必须有**一次**
      // 运行时判定。直接 `as` 会让一个陌生币种静默进到通道请求里。
      currency: refundCurrencyOf(parsed.currency),
      reason: 'heyta 托管同步退款',
    });
  } catch (error) {
    // 只记**错误类的名字**，不记 message：通道报错的 message 里可能带响应体，
    // 而这一列会经后台接口渲染给运营看（写盘的那一步就脱敏，不是渲染时再遮）。
    // 但 `'Error'` 是一个**没有信息量**的名字（任何 `new Error()` 或没设 `name`
    // 的子类都是它）—— 那就退回一个稳定的哨兵值，而不是让审计里出现一个
    // 看起来像 bug 报错的单词。
    const name = error instanceof Error ? error.name : '';
    const reason = name === '' || name === 'Error' ? 'REFUND_CHANNEL_FAILED' : name;
    await sql.execute(
      `UPDATE refunds SET status = 'failed', reason = $2, updated_at = $3
        WHERE id = $1 AND status = 'approved'`,
      [parsed.id, reason, input.now],
    );
    await appendAudit(sql, {
      action: 'refund_channel_failed',
      target: `refund:${parsed.id}`,
      beforeJson: JSON.stringify({ status: 'approved' }),
      afterJson: JSON.stringify({ status: 'failed', reason }),
      actor: 'system',
      note: '通道拒绝了退款请求 —— 权益一格未动',
      now: input.now,
    });
    return { outcome: 'channel-failed', reason };
  }

  // 🔴 即使通道当场回 `success`，这里也**只写 `processing`**。
  // 理由不是保守，是"只有一个落点能动权益"这条纪律：`refunded_at` 与回收
  // 都由 `applyRefundResult` 一次完成。这里若直接写 `success`，就会出现
  // "状态已经是 success、`refunded_at` 却还是 NULL" 的一刻 —— 而那正好被
  // 迁移里那条 `success ⟺ refunded_at IS NOT NULL` 的 CHECK 判为非法写入。
  await sql.execute(
    `UPDATE refunds
        SET status = 'processing', provider_refund_id = COALESCE($2, provider_refund_id), updated_at = $3
      WHERE id = $1 AND status = 'approved'`,
    [parsed.id, result.providerRefundId, input.now],
  );

  if (result.status === 'success') {
    await applyRefundResult(sql, {
      outRefundNo: parsed.outRefundNo,
      status: 'success',
      providerRefundId: result.providerRefundId,
      now: input.now,
    });
  }

  return { outcome: 'submitted', status: result.status, providerRefundId: result.providerRefundId };
};

export type ApplyRefundResultOutcome =
  /** 回收完成：订单已 `refunded`、权益已按那一段回退。 */
  | { readonly outcome: 'retracted'; readonly refundId: number; readonly currentPeriodEnd: number | null }
  /** 非 success 的终态：只落状态，一格权益都不动。 */
  | { readonly outcome: 'recorded'; readonly refundId: number; readonly status: RefundStatus }
  /** 同一状态第二次到达（幂等命中）。**不是**错误。 */
  | { readonly outcome: 'already-applied'; readonly refundId: number }
  | { readonly outcome: 'unknown-refund' };

/**
 * 🔴 **唯一**允许因为退款而动权益的地方。
 *
 * 幂等靠 `UPDATE … WHERE refunded_at IS NULL` 的**影响行数**：
 * 只有从"没退成"翻到"退成了"的那一次返回 1，才继续回收。
 * 这比"先查一下是不是已经处理过"可靠 —— 后者在两个并发通知之间会双双读到"没处理过"。
 *
 * 回收分两小步，且在**同一个事务**里（缺一半都会留下说不清的状态）：
 * 1. `reverseOrderOnRefund`：订单 `paid → refunded`、券核销 `applied → reversed`（不归还名额）；
 * 2. `retractGrantedPeriod`：按**这一行冻住的天数**回退到期日，一笔都不剩时整行失效。
 */
/** 退款通知/同步响应的入参。两个来源共用，所以幂等是**必须**的。 */
export interface ApplyRefundResultInput {
  readonly outRefundNo: string;
  readonly status: ProviderRefundStatus;
  readonly providerRefundId: string | null;
  readonly now: number;
}

/**
 * **在调用方已经开着的事务里**处理一条退款结果。
 *
 * 与 `settleOrderPaid` / `settleOrderPaidInTransaction` 同一对形状：
 * webhook 的那个 Prisma 事务里已经插好了 `payment_events` 占位行，
 * 回收必须与它同生共死（否则"事件记了、权益没回"会留下一个**幂等键已占用**、
 * 重投又被挡掉的永久缺口）。
 */
export const applyRefundResultInTransaction = async (
  tx: SqlRunner,
  input: ApplyRefundResultInput,
): Promise<ApplyRefundResultOutcome> => {
  {
    const rows = await tx.query<RefundRow>(
      `SELECT id, order_id, user_id, provider, out_refund_no, amount_minor, currency, period_days, status
         FROM refunds WHERE out_refund_no = $1 FOR UPDATE`,
      [input.outRefundNo],
    );
    const row = rows[0];
    if (row === undefined) return { outcome: 'unknown-refund' };
    const parsed = mapRefundRow(row);

    if (input.status === 'success') {
      // 🔴 `failed` 在集合里，而且这不是手滑。
      // 本系统写 `failed` 的**唯一**时刻是"发通道时抛错"（见 `submitRefundToChannel`）——
      // 那里面包含"请求其实到了、响应丢了"这一类。这种行如果不能再被 `success` 认领，
      // 后果是永久的**"钱退了而权益还在"**：通知重投会被条件更新挡掉，而它挡掉的
      // 恰好是唯一一次回收。
      // 反过来不成立：一条签名有效、`out_refund_no` 与金额都对得上的 `success` 通知
      // 就是"钱已经退给用户"这件事的证据本身，没有比它更权威的来源可以否决它。
      // ⚠️ 代价：真的被通道拒绝、只是又收到一条误发的通知，会被当成退成。
      // 本方案的通道侧对账（`reconcile.ts`）只覆盖支付事件、**不**覆盖退款，
      // 这条边界如实写进 ADR-0053 §5。
      const changed = await tx.execute(
        // ⚠️ `refunded_at IS NULL` 与后面的状态集合**在库层是重复的**：迁移里的
        // `refunds_success_needs_refunded_at` 是双向的（`status<>'success' ⟹ refunded_at IS NULL`），
        // 所以没有任何可达的行能让这两半给出不同答案。实测：变异臂（拿掉这一半）**存活**，
        // 不是判据没牙，是**这条判据够不到一个存在的形状** —— 它的牙在 schema 那一侧，
        // 由 `billing-refund-store.pglite.spec.ts` 的「三条 CHECK 双向」那组咬住。
        // 这里仍留着它：钱的路径上，一道冗余闸门比一道"以后 CHECK 被放宽了就静默失效"的闸门好。
        `UPDATE refunds
            SET status = 'success', refunded_at = $2, updated_at = $2,
                provider_refund_id = COALESCE($3, provider_refund_id)
          WHERE id = $1 AND refunded_at IS NULL AND status IN ('approved', 'processing', 'failed')`,
        [parsed.id, input.now, input.providerRefundId],
      );
      if (changed === 0) return { outcome: 'already-applied', refundId: parsed.id };

      await retractEntitlementInTx(tx, {
        refundId: parsed.id,
        orderId: parsed.orderId,
        userId: parsed.userId,
        provider: parsed.provider,
        periodDays: parsed.periodDays,
        now: input.now,
      });

      const after = await tx.query<{ current_period_end: unknown }>(
        `SELECT current_period_end FROM subscriptions WHERE user_id = $1 AND provider = $2 LIMIT 1`,
        [parsed.userId, parsed.provider],
      );
      return {
        outcome: 'retracted',
        refundId: parsed.id,
        currentPeriodEnd: asNumber(after[0]?.current_period_end),
      };
    }

    // abnormal / closed / processing：只推进状态，**绝不**动权益。
    const changed = await tx.execute(
      `UPDATE refunds
          SET status = $2, updated_at = $3,
              provider_refund_id = COALESCE($4, provider_refund_id)
        WHERE id = $1 AND refunded_at IS NULL AND status <> $2`,
      [parsed.id, input.status, input.now, input.providerRefundId],
    );
    if (changed === 0) return { outcome: 'already-applied', refundId: parsed.id };
    return { outcome: 'recorded', refundId: parsed.id, status: input.status };
  }
};

/** 事务外的入口：自己开一层事务跑上面那个主体（CLI / 后台直接调用用）。 */
export const applyRefundResult = async (
  sql: SqlExecutor,
  input: ApplyRefundResultInput,
): Promise<ApplyRefundResultOutcome> => sql.transaction((tx) => applyRefundResultInTransaction(tx, input));

/**
 * 回收那一段权益。**只在 `applyRefundResult` 的事务里被调用**，所以它收 `SqlRunner`。
 *
 * 🔴 顺序是有意的：**先改订单、再算剩余**。反过来会让"还剩几笔已付订单"
 * 把这一单自己也算进去，于是回收量少算一段（用户白拿 30 天，且没有任何一层会报错）。
 */
const retractEntitlementInTx = async (
  tx: SqlRunner,
  input: {
    readonly refundId: number;
    readonly orderId: number;
    readonly userId: number;
    readonly provider: string;
    readonly periodDays: number;
    readonly now: number;
  },
): Promise<void> => {
  await reverseOrderOnRefundInTransaction(tx, { orderId: input.orderId, now: input.now });

  const remaining = await tx.query<{ n: unknown }>(
    `SELECT count(*)::int AS n FROM checkout_orders
      WHERE user_id = $1 AND provider = $2 AND status = 'paid'`,
    [input.userId, input.provider],
  );

  const existing = await tx.query<{ id: unknown; current_period_end: unknown }>(
    `SELECT id, current_period_end FROM subscriptions WHERE user_id = $1 AND provider = $2 LIMIT 1`,
    [input.userId, input.provider],
  );
  const subscription = existing[0];
  if (subscription === undefined) {
    // 钱退了、库里却没有任何订阅行：这是**事实**，不是错误 —— 比如那一段已经被
    // 更早的一次到期覆盖掉了。这里如实落审计，不猜一个到期日、也不建一行。
    await appendAudit(tx, {
      action: 'refund_retraction_skipped',
      target: `refund:${input.refundId}`,
      beforeJson: null,
      afterJson: JSON.stringify({ remainingPaidOrders: Number(remaining[0]?.n ?? 0) }),
      actor: 'system',
      note: '没有可回收的订阅行（订单已置 refunded，权益侧一格未动）',
      now: input.now,
    });
    return;
  }

  const currentPeriodEnd = asNumber(subscription.current_period_end);
  if (currentPeriodEnd === null) {
    // 到期日本身就是空的：没有"那一段"可扣。钱退了是事实（`refunded_at` 已经写上），
    // 但这里**不**建一个到期日、也不写 `now` —— 那等于凭一次退款发明一段时长。
    await appendAudit(tx, {
      action: 'refund_retraction_skipped',
      target: `refund:${input.refundId}`,
      beforeJson: null,
      afterJson: JSON.stringify({ remainingPaidOrders: Number(remaining[0]?.n ?? 0) }),
      actor: 'system',
      note: '订阅行没有可用的到期日（订单已置 refunded，权益侧一格未动）',
      now: input.now,
    });
    return;
  }
  const nextPeriodEnd = retractGrantedPeriod({
    currentPeriodEnd,
    now: input.now,
    remainingPaidOrders: Number(remaining[0]?.n ?? 0),
    periodDays: input.periodDays,
  });

  await tx.execute(
    // 🔴 `$2::bigint` 那两处显式类型转换**不是风格**，是必需的：同一个参数既出现在
    // `current_period_end = $2`（赋值上下文）又出现在 `$2 <= $3`（比较运算符）时，
    // PostgreSQL 解析阶段会报 `inconsistent types deduced for parameter $2` ——
    // 实测于 PGlite（同一条 SQL 在真库上一样会失败，这不是测试载体的毛病）。
    // 症状会是"钱退了、权益那一格永远写不进去"，而且失败在**回收那一步**，
    // 前面的 `refunded_at` 已经写了，所以它比不写更难发现。
    `UPDATE subscriptions
        SET current_period_end = $2,
            status = CASE WHEN $2::bigint <= $3::bigint THEN 'expired' ELSE 'active' END,
            last_event_at = $3,
            updated_at = $3
      WHERE id = $1`,
    [Number(subscription.id), nextPeriodEnd, input.now],
  );

  await appendAudit(tx, {
    action: 'refund_retracted',
    target: `refund:${input.refundId}`,
    beforeJson: JSON.stringify({ currentPeriodEnd }),
    afterJson: JSON.stringify({ currentPeriodEnd: nextPeriodEnd, remainingPaidOrders: Number(remaining[0]?.n ?? 0) }),
    actor: 'system',
    note: `退款到账，回收 ${input.periodDays} 天（只减不增：已消费的天数不追回）`,
    now: input.now,
  });
};

/**
 * 读一行退款的**归属通道与当前状态** —— 后台在"批准"之前要用它挑 adapter。
 *
 * 🔴 挑 adapter 必须按**订单当初的 provider**，不是按"这台实例现在配了哪家"：
 * 换支付商之后，旧通道那笔钱只能回到旧通道去退。挑错了不会报错，
 * 只会得到一个"通道说没有这笔订单"的失败 —— 而用户已经在等退款。
 */
export const refundChannelOf = async (
  sql: SqlRunner,
  refundId: number,
): Promise<{ readonly provider: string; readonly status: unknown } | null> => {
  const rows = await sql.query<{ provider: unknown; status: unknown }>(
    `SELECT provider, status FROM refunds WHERE id = $1`,
    [refundId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { provider: String(row.provider), status: row.status };
};

/** 后台列表用：按账号取退款行（新→旧）。 */
export const listRefunds = async (
  sql: SqlRunner,
  input: { readonly userId?: number; readonly limit?: number } = {},
): Promise<readonly {
  readonly id: number;
  readonly orderId: number;
  readonly userId: number;
  readonly provider: string;
  readonly outRefundNo: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly periodDays: number;
  readonly status: unknown;
}[]> => {
  const rows = await sql.query<RefundRow>(
    `SELECT id, order_id, user_id, provider, out_refund_no, amount_minor, currency, period_days, status
       FROM refunds
      WHERE ($1::int IS NULL OR user_id = $1)
      ORDER BY id DESC
      LIMIT $2`,
    [input.userId ?? null, Math.min(Math.max(input.limit ?? 50, 1), 200)],
  );
  return rows.map(mapRefundRow);
};
