/**
 * 官方托管同步的权益读取与降级判定（**纯业务逻辑**）
 * =====================================================
 *
 * 产品边界：[`docs/plans/subscription-boundary.md`](../../../docs/plans/subscription-boundary.md) §2。
 * 一句话：**到期不许变成数据 hostage。** 本地数据一个字都不动，降级只影响
 * "能不能用 heyta 官方托管服务同步 / 新增设备"。
 *
 * ## 为什么它在 `packages/domain`，不在 `apps/web`
 *
 * 「这算不算到期」「该不该降级」是**业务判断**，不是展示逻辑 ——
 * 它必须是一个可单测的纯函数，而不是散在组件里的 `if`
 * （AGENTS.md §3.5 的判据：这段代码里有没有一行在决定"业务上该怎么做"？）。
 * 壳只负责把这里给出的判别联合渲染成句子。
 *
 * ## 🔴 唯一的语义来源是服务端，这里不另发明一套
 *
 * 服务端 `server/src/entitlement.ts` 已经定死了对外表达：
 * **HTTP 402 + `errorCode: 'SUBSCRIPTION_REQUIRED'` + `reason`**。
 * 客户端**只读**这套表达 —— `parseHostedEntitlementResponse` 消费的是它的原样形状，
 * 不引入第二个状态词表（`errorCode` 与 `reason` 联合逐字对齐服务端）。
 *
 * 到期边界（半开区间 `[start, end)`，`now === end` 即过期）也与服务端逐字一致：
 * 见 `evaluateSubscriptionPeriod`，它只实现**这一份**边界规则。
 *
 * ## 🔴 fail-open：不确定的时候不限制用户
 *
 * 网络失败 / 服务端不可达 / 未配置 / 响应不是权益拒绝 → 一律
 * `unrestricted`。默认必须是"不限制"。这与服务端闸门"默认关"是同一个道理：
 * 自托管默认全放行，客户端不能因为"问不到"就替用户降级。
 *
 * ## 🔴 本模块不认识任何任务内容
 *
 * 它只吃"订阅状态"这一小撮字段。出于降级判断而把任务发到服务器是
 * **明令禁止**的（E2EE 硬约束），所以本模块连一个任务字段都不接受 ——
 * 类型上就传不进来。
 */

/**
 * 服务端权益拒绝时对外的错误码。
 *
 * 🔴 **与服务端 `server/src/entitlement.ts` 的 `ENTITLEMENT_ERROR_CODE` 必须逐字相同。**
 * 漂移了就会让"客户端认得服务端的拒绝"这件事静默失效 —— 而失效方向恰好是
 * **不降级**（fail-open），也就是没人会发现。`packages/domain/tests/subscription.spec.ts`
 * 里有一条直接读服务端源文件的**漂移守卫测试**钉住它。
 */
export const HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE = 'SUBSCRIPTION_REQUIRED';

/**
 * 服务端拒绝原因的**同一份词表**（`EntitlementDenialReason`）。
 *
 * 顺序与成员都要与服务端一致；多一个少一个都会被漂移守卫测试抓到。
 */
export const ENTITLEMENT_DENIAL_REASONS = [
  'NO_SUBSCRIPTION',
  'STATUS_NOT_ENTITLED',
  'MISSING_PERIOD_END',
  'INVALID_PERIOD_END',
  'PERIOD_ENDED',
  'INVALID_NOW',
] as const;

export type EntitlementDenialReason = (typeof ENTITLEMENT_DENIAL_REASONS)[number];

/** 未知 `reason` 也**不猜成过期** —— 猜错方向会让文案说假话。 */
export const UNKNOWN_ENTITLEMENT_DENIAL_REASON = 'UNKNOWN_REASON';

export type HostedEntitlementDenialReason =
  | EntitlementDenialReason
  | typeof UNKNOWN_ENTITLEMENT_DENIAL_REASON;

/** 运行时判据：服务端回的是不是我们认识的拒绝原因。 */
export const isEntitlementDenialReason = (
  value: unknown,
): value is EntitlementDenialReason =>
  typeof value === 'string' &&
  (ENTITLEMENT_DENIAL_REASONS as readonly string[]).includes(value);

/**
 * 一个订阅周期的状态。
 *
 * - `active`  —— `now < currentPeriodEnd`（边界语义见下）。
 * - `expired` —— `now >= currentPeriodEnd`。
 * - `unknown` —— 时间戳缺失 / 非法 / `now` 非法。**不猜**。
 */
export type SubscriptionPeriodState = 'active' | 'expired' | 'unknown';

/**
 * 把服务端可能给的时间戳归一成 epoch 毫秒；非法值返回 `undefined`（**不抛异常**）。
 *
 * 只接受 `number`：线协议是 JSON，`bigint` 在传输中就没了。
 * 负数、`NaN`、`Infinity`、字符串一律算"无法确定时间"。
 */
const toEpochMillis = (value: unknown): number | undefined => {
  if (typeof value !== 'number') return undefined;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

/**
 * 🔴 到期边界：**半开区间 `[start, end)`** —— `now === currentPeriodEnd`
 * 的那一刻已经过期。
 *
 * 与服务端 `evaluateEntitlement`（`server/src/entitlement.ts`）**逐字一致**：
 * 服务端写的是 `if (now >= periodEnd) → PERIOD_ENDED`，这里写的是
 * `now >= periodEnd → expired`。选半开区间是为了让"到期时刻"只有一个确定答案，
 * 而不是两处各判一次。
 *
 * ⚠️ **不要在这里加宽限期。** 要不要宽限是服务端的**策略**（`EntitlementPolicy`），
 * 客户端私自加一个 grace 就是第二套边界语义，会让"到没到期"在两端给出不同答案。
 *
 * ⚠️ 服务端的 402 响应体**当前不带 `currentPeriodEnd`**（只有 `errorCode` + `reason`）。
 * 所以这个函数在真实链路上通常拿不到入参、返回 `unknown`；写入收窄为
 * "只在服务端真的给了周期结束时间时才用它"，其余情况以服务端的 `reason` 为准。
 * 见 `decideHostedSyncAccess` 与交付报告里"未验证部分"的说明。
 */
export const evaluateSubscriptionPeriod = (
  currentPeriodEnd: unknown,
  now: number,
): SubscriptionPeriodState => {
  const periodEnd = toEpochMillis(currentPeriodEnd);
  if (periodEnd === undefined) return 'unknown';
  if (!Number.isFinite(now)) return 'unknown';
  return now >= periodEnd ? 'expired' : 'active';
};

/**
 * 客户端从服务端读到的一次权益观察。
 *
 * 🔴 它描述的是**服务端说了什么**，不是客户端自己算出来的结论 ——
 * 这正是"不要自己另发明一套状态"的落点。
 *
 * - `unconfigured` —— 用户还没配服务器 / 没登录。**没有任何限制**。
 * - `unavailable`  —— 问不到（断网 / 没令牌 / 响应不是权益拒绝）。**没有任何限制**。
 * - `entitled`     —— 服务端放行（含自托管默认关闸门的情况）。
 * - `denied`       —— 服务端明确拒绝，`reason` 原样透传。
 */
export type HostedEntitlementReading =
  | { readonly kind: 'unconfigured' }
  | {
      readonly kind: 'unavailable';
      readonly cause: 'network' | 'no-token' | 'unexpected-response';
    }
  | { readonly kind: 'entitled' }
  | {
      readonly kind: 'denied';
      readonly reason: HostedEntitlementDenialReason;
      /** 仅当服务端响应体真的带了周期结束时间时才存在。 */
      readonly currentPeriodEnd?: number;
    };

/**
 * 降级判定：**只**在服务端明确说"没权益"时才受限。
 *
 * 🔴 fail-open 的机械保证：其余三种观察全部落在 `unrestricted`。
 * 换句话说，把服务端拔掉、把网断掉、什么都不配，用户都不会被限制。
 */
export type HostedSyncAccess =
  | {
      readonly kind: 'unrestricted';
      readonly because: 'not-configured' | 'entitlement-unknown' | 'entitled';
    }
  | {
      readonly kind: 'restricted';
      readonly reason: HostedEntitlementDenialReason;
      /** 仅用于措辞（"已到期" vs 泛化拒绝），**不是**限制与否的判据。 */
      readonly expired: boolean;
    };

/**
 * 服务端响应 → 权益观察。
 *
 * 只认服务端既有表达：`402` + `errorCode === 'SUBSCRIPTION_REQUIRED'`。
 *
 * - `2xx`            → `entitled`（放行）。
 * - `402` + 本错误码 → `denied`（`reason` 无法识别时归成 `UNKNOWN_REASON`，
 *                      而**不是**猜成 `PERIOD_ENDED`）。
 * - 其它一切（401 / 403 / 5xx / 402 但错误码不是本码）→ `unavailable`。
 *   🔴 这一支同样 fail-open：**只有服务端明确点名订阅，才谈得上降级**。
 */
export const parseHostedEntitlementResponse = (response: {
  readonly status: number;
  readonly body?: unknown;
}): HostedEntitlementReading => {
  if (response.status >= 200 && response.status < 300) {
    return { kind: 'entitled' };
  }

  if (response.status !== 402) {
    return { kind: 'unavailable', cause: 'unexpected-response' };
  }

  const body =
    response.body !== null && typeof response.body === 'object'
      ? (response.body as Record<string, unknown>)
      : undefined;

  if (body?.errorCode !== HOSTED_SYNC_SUBSCRIPTION_ERROR_CODE) {
    // 402 但不是订阅闸门（例如某个路由自己的付费墙）：不认识就不降级。
    return { kind: 'unavailable', cause: 'unexpected-response' };
  }

  const rawReason = body.reason;
  const reason: HostedEntitlementDenialReason = isEntitlementDenialReason(rawReason)
    ? rawReason
    : UNKNOWN_ENTITLEMENT_DENIAL_REASON;

  const periodEnd = toEpochMillis(body.currentPeriodEnd);

  return {
    kind: 'denied',
    reason,
    ...(periodEnd === undefined ? {} : { currentPeriodEnd: periodEnd }),
  };
};

/**
 * 权益观察 + 现在 → 客户端该不该限制"通过官方托管服务同步"。
 *
 * `now` 可注入，便于把到期边界测成确定场景（与仓库其它纯函数同一取向）。
 *
 * `expired` 的取值顺序（只影响措辞，不影响限制与否）：
 *   1. 服务端 `reason === 'PERIOD_ENDED'` → 已到期（服务端是权威）。
 *   2. 否则若服务端给了周期结束时间，且本地时钟判定它已过 → 已到期。
 *   3. 否则 → 不是"到期"这一类，用泛化拒绝的措辞。
 */
export const decideHostedSyncAccess = (
  reading: HostedEntitlementReading,
  now: number,
): HostedSyncAccess => {
  switch (reading.kind) {
    case 'unconfigured':
      return { kind: 'unrestricted', because: 'not-configured' };
    case 'unavailable':
      return { kind: 'unrestricted', because: 'entitlement-unknown' };
    case 'entitled':
      return { kind: 'unrestricted', because: 'entitled' };
    case 'denied': {
      const periodState = evaluateSubscriptionPeriod(reading.currentPeriodEnd, now);
      return {
        kind: 'restricted',
        reason: reading.reason,
        expired: reading.reason === 'PERIOD_ENDED' || periodState === 'expired',
      };
    }
  }
};
