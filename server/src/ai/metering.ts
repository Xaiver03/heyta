/**
 * 托管（云端）AI 的**请求计量**：一次代理调用之前问一句"这一周期还能不能再走一次"。
 *
 * ## 它兑现的是哪句承诺
 *
 * `¥12 / 月 · 300 次/月` 已经写在落地页与《AI 服务条款》里（ADR-0020 §3.2 是**已锁定**
 * 的产品决定），而 ADR-0023 §3.1 把它反过来钉成一条硬约束：**计量存在之前这一档不得售卖**。
 * 本文件就是"计量存在"那一半 —— ADR-0054 §6 前置顺序的第 1–2 步：
 *
 * 1. 表 + 迁移 + **原子裁决**（本文件的 `consumeManagedAiRequest`）；
 * 2. 计数只在**服务端**做（客户端自报的计数一律不采信 —— AGENTS §8.10）；
 * 3. `ai-quota-ssot.enforcement` 翻到 `enforced`；
 * 4. 然后才把 `hosted-ai-monthly` 从 `NOT_YET_DELIVERABLE_SKUS` 摘出。
 *
 * 🔴 本文件**不**做第 3、4 步，也**不**碰收银台：顺序反了就等于"先收钱、后交付"，
 * 而那是 ADR-0023 立这条规矩时唯一想挡住的事。把状态翻过去是**另一个提交**的事，
 * 判据是 `pnpm check:ai-quota`（它的哨兵清单里已经有本文件的路径）。
 *
 * ## 🔴 这里只数次数，不存内容 —— 表形状就是保留承诺（ADR-0054 §2）
 *
 * 计数落在 `ai_usage_counters`：`user_id / period_anchor / requests / updated_at` 四列，
 * 没有 prompt、没有 completion、没有 payload。本文件同样**不**把请求体、提示词、
 * 模型输出、token 或凭据写进任何地方：
 *
 * - 不进日志（`Logger.audit` 那两处只带 `userId / used / limit / reason / anchor`，
 *   全是**计数与状态**）；
 * - 不进参数绑定的 SQL；
 * - 不在返回值里（调用方拿到的是布尔与两个数字，不是内容）。
 *
 * ⚠️ 这不是"以后再说"的性能优化，是**判据**：`server/tests/ai-metering.pglite.spec.ts`
 * 断言那张表的列集合**等于**那四个 —— 多一列就红。所以想加一列"顺手存一下便于排障"，
 * 必须先红一条测试，而不是悄悄加上去。
 *
 * ## 为什么裁决必须在一条语句里
 *
 * AGENTS §8.15：共享预算的**读取占用**与**裁决**要在同一个数据库锁/事务边界内完成，
 * 事务外预检只能用来提前报错，**不能当最终门禁**。这里的"占用"就是那一行的 `requests`，
 * 于是读它、比它、+1 全部塞进一条 `INSERT … ON CONFLICT DO UPDATE … WHERE requests < N
 * RETURNING requests`：
 *
 * | 形状 | 并发下的后果 |
 * |---|---|
 * | 先 `SELECT requests` 再在 JS 里比、再 `UPDATE` | 两个请求同时看见 299 ⇒ 两个都放行，库里 301 |
 * | `UPDATE … SET requests = requests + 1` 无 `WHERE` | 同上，只是晚一步发现 |
 * | **本文件**：同一条语句里读+判+写 | 同一行被行锁串行化，第 301 次**匹配不到任何行**，等于没写 |
 *
 * ⚠️ 那条 `SELECT status, grants, current_period_end FROM subscriptions …` 是**准入判定**，
 * 不是占用 —— 它决定"这一档买没买"，不消耗配额，所以它可以留在语句之外；
 * 把两者混为一谈会得出"整件事都要包在事务里"的结论，而那条语句本身就是原子的，
 * 再包一层事务只会多一个"额度扣了、外层回滚没回滚"的对账面。
 *
 * ## 这一层是纯 SQL 端口，不是 Prisma 调用
 *
 * `SqlExecutor` **复用** `billing/pricing-store.ts` 那一个端口（不另建第二份）：
 * 生产走 `createPrismaSqlExecutor(prisma)`，测试走 PGlite（= 真的 PostgreSQL，行锁、
 * 唯一索引、CHECK 全部按原生语义跑）。这一层的存在理由与定价那层一字不差：
 * "并发只放行 N 次"这件事**不能靠读代码相信**（`array-branch-equivalence.pglite.spec.ts`
 * 文件头记的就是同一类教训）。
 */
import { prisma } from '../db';
import {
  createPrismaSqlExecutor,
  type SqlRunner,
} from '../billing/pricing-store';
import {
  DEFAULT_ENTITLEMENT_POLICY,
  evaluateCapabilityAcross,
  toEpochMillis,
  type EntitlementCapability,
  type EntitlementDenialReason,
  type EntitlementPolicy,
  type EntitlementSubscription,
} from '../entitlement';
import { Logger } from '../logger';

/**
 * 🔴 **一个计费周期内允许的托管 AI 请求次数。**
 *
 * ## 这个数字为什么"抄"了一份
 *
 * 唯一事实源是 `docs/reference/pricing-and-entitlements.md` §2.1 那个
 * ```json ai-quota-ssot``` 块。代码里必须有一个能用类型检查、能在运行时参与比较的常量，
 * 而门禁 `scripts/check-ai-quota-consistency.mjs` 的对账对象是**文档五处文案**，
 * 它不读 TS —— 所以这一行确实是第二份 300。
 *
 * 那份重复由一条**测试**钉住，而不是由注释里那句"记得同步改"：
 * `server/tests/ai-metering.pglite.spec.ts` 用与门禁同一个正则从那个块里把数字解析出来，
 * 断言它**等于**本常量。改一边不改另一边 ⇒ 测试红。
 * ⚠️ 反过来也成立：**别为了"消除重复"把这里改成读文档**（运行时读不到仓库里的 md，
 * 镜像里没有那份文件 —— 与 `server/src/copy.generated.ts` 那条"真源只有一份、
 * 靠生成物搬到服务端"是同一条理由，而这里刻意不生成，因为一个数字被生成器搬一次
 * 会让"改额度"这件事看起来像改代码）。
 *
 * 单位是**计费周期**，不是"自然月" —— 一次付款 = 30 天且起点是支付时刻，
 * 见下面 `managedAiPeriodAnchor` 与迁移文件里那一节。
 */
export const MANAGED_AI_REQUESTS_PER_PERIOD = 300;

/**
 * 消耗额度的是**哪一项能力**。与 `entitlement.ts` 的 `ENTITLEMENT_CAPABILITIES`
 * 同源（那里是词表，这里是选词）：只有 `'ai'` 这一项由次数配额约束，
 * `hosting` 是按账号按月卖的、不限次。
 */
export const MANAGED_AI_CAPABILITY: EntitlementCapability = 'ai';

/**
 * 审计事件名。两个都是**计数级**事件，复用既有 `Logger.audit`，不新造一套日志。
 *
 * ⚠️ 加字段之前先读文件头那句"只数次数"：`AuditLogEntry` 有 `[key: string]: unknown`，
 * 类型层**拦不住**谁把 prompt 塞进来。所以这里的判据是测试与评审，不是编译器。
 */
export const AI_METERING_AUDIT_EVENTS = {
  /** 放行并计数 +1。 */
  CONSUMED: 'AI_METERING_CONSUMED',
  /** 拒绝（额度用尽或权益不成立）。拒绝同样要留痕：它是对账"我明明还有次数"的唯一凭据。 */
  DENIED: 'AI_METERING_DENIED',
} as const;

/** 额度用尽之外还可能被**权益**拒（没买这一档、已到期）。原因词表直接复用权益层。 */
export type AiMeteringDenialReason = EntitlementDenialReason | 'QUOTA_EXCEEDED';

/**
 * 裁决结果。
 *
 * 🔴 `used` 的口径两种情况下**不同**，所以两分支都写明：
 * - `allowed: true` ⇒ 本次**之后**的已用数（含本次）—— 第 1 次请求返回 1；
 * - `allowed: false` ⇒ 本次**没有消耗**，返回库里当前的已用数。
 *
 * 把后者也写成"含本次"会让设置页那句"本周期已用 X / 300"在第 300 次之后显示 301/300，
 * 而那句 301 是界面在说谎（法务 §5.3 承诺的就是这两个数）。
 */
export type AiMeteringResult =
  | {
      readonly allowed: true;
      readonly used: number;
      readonly limit: number;
      readonly periodAnchor: number;
    }
  | {
      readonly allowed: false;
      readonly used: number;
      readonly limit: number;
      readonly reason: AiMeteringDenialReason;
      /** 权益根本不成立时为 `null` —— 那时候"哪一个周期"这个问题还没有答案。 */
      readonly periodAnchor: number | null;
    };

export interface ConsumeManagedAiRequestInput {
  /** 🔴 必须是**服务端认证过的**账号 id（`getAuthUser(req).userId`）。 */
  readonly userId: number;
  /** 当前时刻（epoch 毫秒）。可注入是为了把"跨周期边界"测成确定场景。 */
  readonly now?: number;
  /** 额度上限。默认取本文件那个常量；测试用小值把边界跑满。 */
  readonly limit?: number;
  /** SQL 执行面。默认 `createPrismaSqlExecutor(prisma)`。 */
  readonly sql?: SqlRunner;
  /** 权益判定策略。省略用 `DEFAULT_ENTITLEMENT_POLICY`。 */
  readonly policy?: EntitlementPolicy;
}

/** `SELECT` 出来的一行订阅（列名是库里的蛇形，不做别名是为了少一层映射）。 */
interface SubscriptionRow {
  status: unknown;
  grants: unknown;
  current_period_end: unknown;
}

/**
 * 把库里的 int8 归一成 `toEpochMillis` 认得的形状。
 *
 * ⚠️ 两个驱动给的不是同一个 JS 类型：Prisma 的 `$queryRawUnsafe` 对 `BIGINT` 返回
 * `bigint`，PGlite 在文本协议下可能给 `number` 或**十进制字符串**。字符串直接丢给
 * `toEpochMillis` 会被判"无法确定时间"⇒ 每个请求都拒 —— 那不是安全，那是把自己关掉。
 * 所以这里只认"纯数字字符串"这一种额外形状，转成 `bigint` 之后交给同一个
 * `toEpochMillis` 做范围校验（超大 bigint 必须拒绝那条规则**不许**在这里重写一遍，
 * 见 `entitlement.ts` 里那句"不要在别处再写一份"）。
 *
 * 🔴 认不出来的形状返回 `null` 而不是"猜一个"：`null` 会走 `MISSING_PERIOD_END`
 * 那条 fail-closed 的拒绝路，而"猜一个"（`?? now`、`?? 0`）会让这一期的计数写到别的锚上 ——
 * 那时"这一期用了几次"永久对不上账，而且两边都不报错。
 */
const normalizeInt8 = (value: unknown): number | bigint | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
};

/**
 * 把 `requests` 那一列归一成 JS 数字（同一份 int8 形状问题，见 `normalizeInt8`）。
 *
 * 🔴 拿不到数字就**抛**，不返回 0。这条路径上 `used` 是要显示给用户的两个数之一
 * （法务 §5.3 承诺的就是"已用 X / 300"），编一个 0 出来比失败更坏：
 * 症状是"明明刚被拒绝，界面说一次都没用过"。
 */
const normalizeCount = (value: unknown): number => {
  const raw = normalizeInt8(value);
  const count = raw === null ? undefined : toEpochMillis(raw);
  if (count === undefined || !Number.isInteger(count)) {
    throw new Error(
      `consumeManagedAiRequest: requests 不是数字形状（${String(value)}）—— ` +
        '拒绝编造一个已用次数。',
    );
  }
  return count;
};

/**
 * 行 → 权益层认得的形状。
 *
 * 🔴 `grants` **不做任何宽容处理**：不是数组就交回 `null`，让 `evaluateCapability`
 * 判成 `MISSING_GRANTS`。数组被序列化成字符串（`'hosting,ai'`）在子串匹配下会让
 * `includes('ai')` 变成真 —— 一个本该 fail-closed 的位置变成 fail-open，
 * 这个坑在 `entitlement.ts` 那条注释里已经记过一次，这里不重犯。
 */
const toEntitlementSubscription = (row: SubscriptionRow): EntitlementSubscription => ({
  status: typeof row.status === 'string' ? row.status : null,
  grants: Array.isArray(row.grants) ? row.grants : null,
  currentPeriodEnd: normalizeInt8(row.current_period_end),
});

/**
 * 周期边界**已经在库里**，不要在服务端猜。
 *
 * 语义：取**所有"此刻有效且授予 `ai`"那一行里最晚的 `current_period_end`**。
 *
 * - 为什么取**最晚**而不是第一行：权益是多个来源的并集（付费 / 邀请 / 运营赠送），
 *   `evaluateCapabilityAcross` 已经因为这个形状写过一条事故 —— "最新那一行说了算"
 *   会让后建的短奖励行把用户已付的时长盖掉。锚点如果跟着"最新一行"漂，
 *   同一个周期会因为行的插入顺序被算成两个锚，计数器**凭空清零**。
 * - 为什么锚就是到期时刻本身：跨过这一刻 ⇒ 换一行 ⇒ 新的一轮从 0 开始，
 *   不需要任何"清零"写入，也就没有清零窗口（那条清零任务本来就是 ADR-0054 §8
 *   里"还没做到的"那一半，这里不让它变成正确性的前提）。
 * - 提前续费会把到期时刻往后推 ⇒ 换锚、从 0 起。方向是**多给一轮**，
 *   而多给一轮的前提是用户又付了一次 ¥12，与"一个周期 300 次"一致。
 *   反方向（续费后立刻被判超额）才是会挨投诉的那种错。
 *
 * 纯函数：不碰数据库、不读时钟。`now` 由调用方传入。
 */
export const managedAiPeriodAnchor = (
  subscriptions: readonly EntitlementSubscription[],
  now: number,
  capability: EntitlementCapability = MANAGED_AI_CAPABILITY,
  policy: EntitlementPolicy = DEFAULT_ENTITLEMENT_POLICY,
): number | null => {
  let anchor: number | null = null;
  for (const row of subscriptions) {
    // 只有"这一行确实授予该能力且此刻有效"才参与锚点 —— 与 `evaluateCapabilityAcross`
    // 用的是同一个判定函数，两处不可能漂开。
    if (!evaluateCapabilityAcross([row], capability, now, policy).allowed) continue;
    const end = toEpochMillis(row.currentPeriodEnd ?? null);
    if (end === undefined) continue;
    if (anchor === null || end > anchor) anchor = end;
  }
  return anchor;
};

/** 准入 + 锚点所需的最小投影。三列里没有一列是"内容"。 */
const SELECT_SUBSCRIPTION_PROJECTION = `
  SELECT "status", "grants", "current_period_end"
    FROM "subscriptions"
   WHERE "user_id" = $1::integer
   ORDER BY "id" DESC
`;

/**
 * 🔴 **唯一的额度消耗入口**：读占用 → 对上限裁决 → +1，全部在**一条语句**里。
 *
 * `INSERT … ON CONFLICT DO UPDATE … WHERE requests < $4 RETURNING requests`：
 * - 行不存在 ⇒ 走 `INSERT`，`requests = 1`；
 * - 行存在且 `< limit` ⇒ 走 `DO UPDATE`，`requests + 1`，`RETURNING` 给出新值；
 * - 行存在且 `>= limit` ⇒ `WHERE` 不成立 ⇒ **既没更新也没插入**，`RETURNING` 零行。
 *   这就是"超额不消耗"的机制本身，不是一次额外的减法或回滚。
 *
 * 超额那一路之后会**只读**一次当前值来填 `used`（给设置页那两个数字用）。
 * 那次读**不是**裁决依据 —— 裁决在上一条语句里已经做完了；把它当成裁决依据的形状
 * 就是表里第二行那个"先 SELECT 再比"的并发洞。
 *
 * 拒绝路径一律不写计数行：权益不成立时**连那一行都不创建**（一个没买这一档的人
 * 在库里留下计数行，等于我们替他记了一份他没有的账）。
 */
export const consumeManagedAiRequest = async (
  input: ConsumeManagedAiRequestInput,
): Promise<AiMeteringResult> => {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? MANAGED_AI_REQUESTS_PER_PERIOD;
  const policy = input.policy ?? DEFAULT_ENTITLEMENT_POLICY;
  const sql = input.sql ?? createPrismaSqlExecutor(prisma);

  // 🔴 限额配错必须**响**，不能退化成"用默认值继续"或"按 0 处理"。
  // `limit = 0` 会让每一次请求都被拒（用户付了钱却一次都用不上），
  // `limit = NaN` 会让那条 `WHERE requests < NaN` **恒为假**（同样的表现，但没有报错），
  // `limit = 1e9` 会让额度变成"不限"而这一档只有 ¥12。三种都是"没人报错的错账"。
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError(
      `consumeManagedAiRequest: limit 必须是正的安全整数（收到 ${String(limit)}）。` +
        '   🔴 不许退化成默认值 —— 那会把一次配置错误变成"额度要么全拒要么不限"。',
    );
  }

  // ── 1. 准入：服务端自己读订阅，**绝不**接受调用方传来的 tier / 计数 ──────────
  const rows = await sql.query<SubscriptionRow>(SELECT_SUBSCRIPTION_PROJECTION, [
    input.userId,
  ]);
  const subscriptions = rows.map(toEntitlementSubscription);
  const entitlement = evaluateCapabilityAcross(
    subscriptions,
    MANAGED_AI_CAPABILITY,
    now,
    policy,
  );
  if (!entitlement.allowed) {
    Logger.audit({
      event: AI_METERING_AUDIT_EVENTS.DENIED,
      userId: input.userId,
      reason: entitlement.reason,
      limit,
    });
    return {
      allowed: false,
      used: 0,
      limit,
      reason: entitlement.reason,
      periodAnchor: null,
    };
  }

  // ── 2. 锚点：数据已经回答了"这是哪一个周期"，不用墙上时钟猜 ────────────────
  const periodAnchor = managedAiPeriodAnchor(subscriptions, now, MANAGED_AI_CAPABILITY, policy);
  if (periodAnchor === null) {
    // 理论上到不了这里：`evaluateCapabilityAcross` 放行意味着至少有一行带着合法的
    // `current_period_end`。走到这里说明两处判定被改成了**不同**的口径 ——
    // 那是漂移，必须响着拒绝，不能猜一个锚（猜出来的锚会把这一期的计数写到别期去，
    // 于是"这一期用了几次"永久对不上账）。
    Logger.audit({
      event: AI_METERING_AUDIT_EVENTS.DENIED,
      userId: input.userId,
      reason: 'MISSING_PERIOD_END',
      limit,
    });
    return { allowed: false, used: 0, limit, reason: 'MISSING_PERIOD_END', periodAnchor: null };
  }

  // ── 3. 原子消耗：读占用、裁决、+1 在同一条语句里 ──────────────────────────
  const consumed = await sql.query<{ requests: unknown }>(
    `
      INSERT INTO "ai_usage_counters" ("user_id", "period_anchor", "requests", "updated_at")
      VALUES ($1::integer, $2::bigint, 1, $3::bigint)
      ON CONFLICT ("user_id", "period_anchor") DO UPDATE
        SET "requests" = "ai_usage_counters"."requests" + 1,
            "updated_at" = EXCLUDED."updated_at"
        WHERE "ai_usage_counters"."requests" < $4::integer
      RETURNING "requests"
    `,
    [input.userId, periodAnchor, now, limit],
  );

  if (consumed.length > 0) {
    const used = normalizeCount(consumed[0]!.requests);
    Logger.audit({
      event: AI_METERING_AUDIT_EVENTS.CONSUMED,
      userId: input.userId,
      used,
      limit,
      periodAnchor,
    });
    return { allowed: true, used, limit, periodAnchor };
  }

  // ── 4. 超额：一条都没消耗，只把当前值读回来填那两个数 ──────────────────────
  const current = await sql.query<{ requests: unknown }>(
    `SELECT "requests"
       FROM "ai_usage_counters"
      WHERE "user_id" = $1::integer
        AND "period_anchor" = $2::bigint`,
    [input.userId, periodAnchor],
  );
  // 读回来是空只有一种实际可能：这一行在两条语句之间被级联删掉了（账号在这一次
  // 请求里被删除）。那种情况下报 `limit` 而不是 0 —— 裁决已经是"拒"，
  // 把 `used` 报成 0 会让界面显示"0/300 却被拒绝"，那是一句自相矛盾的话。
  const used = current.length > 0 ? normalizeCount(current[0]!.requests) : limit;

  Logger.audit({
    event: AI_METERING_AUDIT_EVENTS.DENIED,
    userId: input.userId,
    reason: 'QUOTA_EXCEEDED',
    used,
    limit,
    periodAnchor,
  });

  return { allowed: false, used, limit, reason: 'QUOTA_EXCEEDED', periodAnchor };
};

/**
 * 🔴 **计数行的保留天数 —— 这一句是对外承诺的另一半。**
 *
 * 界面上「保留：… 45 天」那句（`packages/ai` 的 `describeRetention` 与两个壳的词条）
 * 说的就是这个数字。它承诺的是**删除**，而承诺删除的东西必须有一条真的在执行的语句，
 * 否则那句话从写下那一刻就是假话 —— 所以本文件下面有 `purgeExpiredAiUsageCounters`，
 * 而它挂在 `sync/cleanup.ts` 那条每日任务上（不是"以后补一条 cron"，
 * 那正是 ADR-0054 §8 点名过的洞）。
 *
 * ⚠️ 这份 45 是**第二处**（第一处在 `packages/ai/src/supply.ts`）。服务端不依赖
 * `@heyta/ai`（`server/Dockerfile` 不打包 `packages/`，运行时读不到），
 * 所以不能 import。重复由
 * `server/tests/ai-metering.pglite.spec.ts` 里那条"从源码解析两个数字并断言相等"钉住 ——
 * 与 `MANAGED_AI_REQUESTS_PER_PERIOD` 对账 `ai-quota-ssot` 块同一个手法。
 * 改一边不改另一边 ⇒ 测试红，而不是界面上悄悄少一天。
 */
export const AI_USAGE_RETENTION_DAYS = 45;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 删除**已经过期**的计数行 —— 兑现"保留 45 天"那句的机械部分。
 *
 * 🔴 两个条件**都要**，缺一不可：
 *
 * | 条件 | 少了它会怎样 |
 * |---|---|
 * | `updated_at < now - 45d` | 变成"每天扫全表删旧行"，而老用户的行会被无期限留着 |
 * | `period_anchor < now`（周期已结束） | **把还在生效的那一期的额度清零** —— 一个付费后用了一次、之后 50 天没碰的用户，行只剩 `updated_at = 50 天前`，删掉它 ⇒ 下一次 `INSERT` 建新行 `requests = 1`，他这期的 300 次又变满。那不是隐私清理，是白送额度，而且没人报错 |
 *
 * 第二条正是 `peekManagedAiUsage` / `consumeManagedAiRequest` 用**库里的**到期时刻
 * 当锚点的同一个理由：周期边界只能有一个出处，删除也一样 ——
 * "这一期还开着不删"必须问那一行自己，不能问墙上时钟猜出来的自然月。
 *
 * 纯 `DELETE`，不需要事务：单条语句本身原子，而且这里没有"读占用再裁决"那类竞态
 * （它不消耗额度，也不与并发请求争同一行的语义 —— 争到的最坏结果是那一行刚被删、
 * 下一次消耗重建一个新锚的行，而那个锚仍是当期）。
 */
export const purgeExpiredAiUsageCounters = async (input: {
  readonly now?: number;
  readonly retentionDays?: number;
  readonly sql?: SqlRunner;
} = {}): Promise<{ readonly deleted: number; readonly cutoffTime: number }> => {
  const now = input.now ?? Date.now();
  const retentionDays = input.retentionDays ?? AI_USAGE_RETENTION_DAYS;
  // 🔴 与 `consumeManagedAiRequest` 里那条 `limit` 校验同口径：配错必须响，
  //   不能退化成"按 0 天处理"（那等于每天删光全表），也不能按 `undefined` 继续。
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new RangeError(
      `purgeExpiredAiUsageCounters: retentionDays 必须是正的安全整数（收到 ${String(retentionDays)}）。`,
    );
  }
  const sql = input.sql ?? createPrismaSqlExecutor(prisma);
  const cutoffTime = now - retentionDays * MS_PER_DAY;

  const rows = await sql.query<{ user_id: unknown }>(
    `
      DELETE FROM "ai_usage_counters"
       WHERE "updated_at" < $1::bigint
         AND "period_anchor" < $2::bigint
      RETURNING "user_id"
    `,
    [cutoffTime, now],
  );

  return { deleted: rows.length, cutoffTime };
};

/**
 * 只读：查某账号在**当前**计费周期的已用次数。**不消耗额度**，所以一行都不写。
 *
 * 存在的全部理由是法务 §5.3 那句"设置页可以查到本周期已用 X / 300 次"——
 * 那两个数必须与裁决用的是**同一个出处**，否则界面显示"还剩 3 次"而实际已经被拒。
 * 所以它复用同一个 `SELECT_SUBSCRIPTION_PROJECTION` 与同一个
 * `managedAiPeriodAnchor`，**不**自己算边界（自己算就是第二套锚点规则，
 * 而锚点决定的是"哪一行"，两套规则 = 一个账号同时存在两个"本周期"）。
 */
export const peekManagedAiUsage = async (input: {
  readonly userId: number;
  readonly now?: number;
  readonly limit?: number;
  readonly sql?: SqlRunner;
  readonly policy?: EntitlementPolicy;
}): Promise<{
  readonly used: number;
  readonly limit: number;
  readonly periodAnchor: number | null;
  readonly entitled: boolean;
}> => {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? MANAGED_AI_REQUESTS_PER_PERIOD;
  const policy = input.policy ?? DEFAULT_ENTITLEMENT_POLICY;
  const sql = input.sql ?? createPrismaSqlExecutor(prisma);

  const rows = await sql.query<SubscriptionRow>(SELECT_SUBSCRIPTION_PROJECTION, [input.userId]);
  const subscriptions = rows.map(toEntitlementSubscription);
  const periodAnchor = managedAiPeriodAnchor(
    subscriptions,
    now,
    MANAGED_AI_CAPABILITY,
    policy,
  );
  // 拿不到锚 = 此刻没有任何"授予该能力且有效"的周期 ⇒ 没有"本周期已用几次"这个问题。
  // 报 `entitled: false` 而不是 `used: 0`：后者会被界面读成"这个月还剩 300 次"。
  if (periodAnchor === null) {
    return { used: 0, limit, periodAnchor: null, entitled: false };
  }
  const current = await sql.query<{ requests: unknown }>(
    `SELECT "requests"
       FROM "ai_usage_counters"
      WHERE "user_id" = $1::integer
        AND "period_anchor" = $2::bigint`,
    [input.userId, periodAnchor],
  );
  // **没有这一行**与**这一行读不出数字**是两件事：前者是"这一期还没用过"（合法的 0），
  // 后者交给 `normalizeCount` 抛出去。把两者都当成 0 就是 AGENTS §8.15
  // 那句"读取失败不得按零处理"的形状。
  const used = current.length > 0 ? normalizeCount(current[0]!.requests) : 0;
  return { used, limit, periodAnchor, entitled: true };
};
