/**
 * 运营管理后台的状态（web 侧）。
 * ================================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../../docs/adr/0038-admin-console-scope.md)。
 *
 * ## 🔴 `access` 是"探测结果"，不是"权限"
 *
 * `probe()` 打一次 `/api/admin/overview`，把结果记成 `admin` / `denied`。
 * 它**只决定界面渲不渲染**。真正的授权在服务端 —— 一个改前端状态的人
 * 拿不到任何数据，因为每条请求都要过 `requireAdmin`。
 *
 * 所以这里没有"把入口藏起来"当作安全措施的成分；它纯粹是 UX：
 * 非管理员不该在设置页里看到一个点进去全是 403 的面板。
 *
 * ## 为什么探测失败也分成好几种
 *
 * `unavailable`（没配服务器 / 没登录 / 断网）与 `denied`（403）必须分开：
 * 前者是"现在问不到"，后者是"问到了，答案是不行"。混在一起会让一个
 * 刚断网的运营者以为自己的权限被撤了。
 *
 * ## 与其它 feature store 同形
 *
 * - 用 `zustand` 的 `create`；
 * - 数据访问全部经 `@heyta/app-host`（AGENTS §3.5：业务管道不进 `apps/`）；
 * - 提供 `__resetAdminForTests()`（跨测试残留是"随机变红"的常见来源）。
 */

import { create } from 'zustand';

import {
  adminApproveRefund,
  adminCreateRefundRequest,
  adminForceUserLogout,
  adminGrantSubscription,
  adminPublishAnnouncement,
  adminRejectRefund,
  adminRevokeSubscriptionGrant,
  adminSetUserQuota,
  adminUnlockUser,
  adminUpgradeSubscription,
  adminWithdrawAnnouncement,
  adminDeleteHolidayYear,
  adminPutHolidayYear,
  fetchAdminAnnouncements,
  fetchAdminCoupons,
  fetchAdminGrantSkus,
  fetchAdminHolidayYears,
  fetchAdminInvites,
  fetchAdminOrders,
  fetchAdminOverview,
  fetchAdminRefunds,
  fetchAdminRevenue,
  fetchAdminSubscriptionGrants,
  fetchAdminSubscriptions,
  fetchAdminUser,
  fetchAdminUsers,
  type AdminClientOptions,
  type AdminAnnouncementRow,
  type AdminCouponRow,
  type AdminFailureReason,
  type AdminGrantRow,
  type AdminGrantSku,
  type AdminHolidayYears,
  type AdminInvites,
  type AdminOrderRow,
  type AdminOverview,
  type AdminPage,
  type AdminRefundRow,
  type AdminResult,
  type AdminRevenue,
  type AdminSubscriptionRow,
  type AdminUserDetail,
  type AdminUserRow,
} from '@heyta/app-host';

import type { MessageKey } from '@heyta/i18n';

import { useSyncStore } from '../sync/store.js';

/** 面板的访问状态。见文件头：这是**探测结果**，不是权限本身。 */
export type AdminAccess = 'unknown' | 'checking' | 'admin' | 'denied' | 'unavailable';

export type AdminTab =
  | 'overview'
  | 'users'
  | 'subscriptions'
  | 'grants'
  | 'orders'
  | 'coupons'
  | 'invites'
  | 'revenue'
  | 'announcements'
  | 'holidays'
  | 'refunds';

/** 每一页拉多少。服务端上限 200；50 在宽屏表格上够看又不至于一次拉太多。 */
export const ADMIN_PAGE_SIZE = 50;

/** 失败原因 → i18n key。**穷举**，漏一个编译期就红。 */
export const ADMIN_REASON_KEY: Record<AdminFailureReason, string> = {
  unconfigured: 'web.admin.error.unconfigured',
  'no-token': 'web.admin.error.no-token',
  network: 'web.admin.error.network',
  unauthorized: 'web.admin.error.unauthorized',
  forbidden: 'web.admin.error.forbidden',
  'not-found': 'web.admin.error.not-found',
  invalid: 'web.admin.error.invalid',
  conflict: 'web.admin.error.conflict',
  server: 'web.admin.error.server',
};

/**
 * 发放被拒时服务端给的那个**机器码** → 词条键。
 *
 * 🔴 只按码取文案，**不许**读那句散文 —— `admin.routes.ts` 的 `reason` 带的是码，
 * 而 ADR-0074 §三.1 定的就是这条（散文进日志、不进线协议）。词表外的码 ⇒ `null` ⇒
 * 界面落到 `web.admin.error.conflict` 那一格，**不**替服务端编一个原因。
 *
 * ⚠️ 这里的穷举是**单向**的：加一枚码而没登记，症状是"界面对那次拒绝只说'状态冲突'"，
 * 而不是编译报错。真正逼着两处对齐的是 `server/tests/admin-subscription-grant.spec.ts`
 * 那条"`reason` 只许是码"的判据 —— 它保证码的形状稳定，本表才敢按码查词。
 */
export const ADMIN_GRANT_CODE_KEY: Record<string, MessageKey> = {
  SKU_NOT_DELIVERABLE: 'web.admin.grant.code.notDeliverable',
  NO_ACTIVE_GRANT: 'web.admin.grant.code.noActiveGrant',
  UNKNOWN_SKU: 'web.admin.grant.code.unknownSku',
};

/**
 * 公告表单**收集到的原始输入**（未修剪、未换算前的文本框内容）。
 *
 * 🔴 与 `HolidayYearInput` 同一条纪律：这一片界面**不判合法性**。
 * 长度、词表、"过期要晚于生效"全部住在服务端那一次 `safeParse`。
 */
export interface AnnouncementFormInput {
  readonly titleText: string;
  readonly bodyText: string;
  readonly level: 'info' | 'warning';
  /** `datetime-local` 的原值（`YYYY-MM-DDTHH:mm`），空串 = 现在。 */
  readonly publishesAtText: string;
  /** 空串 = 不过期。 */
  readonly expiresAtText: string;
}

/** 发公告表单的初值。全空 —— 不给默认标题，也不默认"一小时后过期"。 */
export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementFormInput = {
  titleText: '',
  bodyText: '',
  level: 'info',
  publishesAtText: '',
  expiresAtText: '',
};

/**
 * 「订阅发放」表单**收集到的原始输入**（三个动作共用一张表）。
 *
 * 🔴 与 `HolidayYearInput` 同一条纪律：全是字符串，**一片判定都没有**。
 * "账号编号必须是正整数""天数在不在界内""这一档今天能不能发"全部由服务端
 * 那一次 `safeParse` + `subscription-grant-store.ts` 的三道闸门裁决
 *（ADR-0076 §2 三）。在这里多判一次就是第二套标准，而漂移的表现是
 * "界面收了、服务端拒了"或反过来 —— 后者更坏，因为它会让运营以为已经发出去了。
 *
 * ⚠️ 这里**没有** `grants` 那一格，也不是忘了：能力只能由 SKU 派生，
 * 而服务端那一侧是 `strictObject`（多一个键就 400），所以界面**发不出**它。
 */
export interface GrantFormInput {
  readonly sku: string;
  /** 空串 ⇒ `Number('')` 是 `0`，服务端按"天数不合法"拒 —— 这里不替它兜成一个默认天数。 */
  readonly daysText: string;
  readonly reasonText: string;
}

/**
 * 发放表单的初值：档位空着 —— 不替运营预选一档，预选会让他没看就读到"能发"。
 */
export const EMPTY_GRANT_FORM: GrantFormInput = {
  sku: '',
  daysText: '',
  reasonText: '',
};

/**
 * 一次发放动作的六种可读出结果。**穷举**，漏一种编译期就红。
 *
 * 🔴 `denied` 与 `conflict` 是两句不同的话，这条不是措辞洁癖：
 * `denied` 带服务端给的码（"这一档现在交付不了""他本来就没有发放行"），
 * 运营看得懂就**不会**去改参数重试；`conflict` 是没给码，界面只能承认
 * "这是一次状态冲突，但服务端没说为什么"。把后者写成前者就是替服务端编原因
 * （同一件事在退款那一条上是 ADR-0053 §5 第 11 条点名的缺陷）。
 */
export type AdminGrantNotice = 'granted' | 'upgraded' | 'revoked' | 'denied' | 'conflict';

export const ADMIN_GRANT_NOTICE_KEY: Record<AdminGrantNotice, MessageKey> = {
  granted: 'web.admin.grant.notice.granted',
  upgraded: 'web.admin.grant.notice.upgraded',
  revoked: 'web.admin.grant.notice.revoked',
  denied: 'web.admin.grant.notice.denied',
  conflict: 'web.admin.error.conflict',
};

/** 服务端码 → 词条。**词表外的码 ⇒ `null`** ⇒ 界面落回 `conflict` 那一格。 */
export const grantCodeKey = (code: string | null): MessageKey | null =>
  code === null ? null : (ADMIN_GRANT_CODE_KEY[code] ?? null);

/**
 * 能力码 → 词条。
 *
 * 🔴 词表住在服务端（`entitlement.ts::ENTITLEMENT_CAPABILITIES`），这里只是**取词**。
 * 服务端加一档而这张表没登记时，界面念的是那个码本身（`capabilityLabelKey` 的回落），
 * 不编中文名 —— 一个没翻译的码是"这里要加词条"的响亮提示，编出来的名字是安静的错。
 */
export const ADMIN_CAPABILITY_KEY: Record<string, MessageKey> = {
  hosting: 'web.admin.user.entitlement.hosting',
  ai: 'web.admin.user.entitlement.ai',
  automation: 'web.admin.user.entitlement.automation',
};

export const capabilityLabelKey = (capability: string): MessageKey | null =>
  ADMIN_CAPABILITY_KEY[capability] ?? null;

/**
 * 订阅行的 `provider` 码 → 词条（并集读数里那一格要说"这一份能力是谁给的"）。
 *
 * ⚠️ 只给**运营看得懂的那几枚**配词。`server/src/admin/subscription-grant-store.ts`
 * 的 `ADMIN_GRANT_PROVIDER` 是本表的第一个成员 —— 它换了名而这里没跟，
 * `apps/web/tests/admin-entitlements.spec.tsx` 那条"赠送那一行要念成运营赠送"会红；
 * 码表外的 provider（比如线上那枚 `apple`）界面对它**念裸码**，不编一个中文名。
 */
export const ADMIN_PROVIDER_KEY: Record<string, MessageKey> = {
  'admin-grant': 'web.admin.provider.adminGrant',
  invite: 'web.admin.provider.invite',
  wechat: 'web.admin.provider.wechat',
  paycenter: 'web.admin.provider.paycenter',
};

export const providerLabelKey = (provider: string | null): MessageKey | null =>
  provider === null ? null : (ADMIN_PROVIDER_KEY[provider] ?? null);

/**
 * 权益拒绝码 → 词条。两张码表都可能出现在这里（`entitlement.ts` 的
 * `EntitlementDenialReason` 与只属于自动收集那一路的 `AutomationEntitlementDenialReason`），
 * 它们**刻意不相交**，所以这一格不许把它们当成一张表来猜。
 *
 * 码表外的码 ⇒ `null` ⇒ 界面只说"✕"，**不**替服务端编一个原因（同 `grantCodeKey`）。
 */
export const ADMIN_ENTITLEMENT_REASON_KEY: Record<string, MessageKey> = {
  NO_SUBSCRIPTION: 'web.admin.entitlement.reason.NO_SUBSCRIPTION',
  STATUS_NOT_ENTITLED: 'web.admin.entitlement.reason.STATUS_NOT_ENTITLED',
  MISSING_PERIOD_END: 'web.admin.entitlement.reason.MISSING_PERIOD_END',
  INVALID_PERIOD_END: 'web.admin.entitlement.reason.INVALID_PERIOD_END',
  PERIOD_ENDED: 'web.admin.entitlement.reason.PERIOD_ENDED',
  INVALID_NOW: 'web.admin.entitlement.reason.INVALID_NOW',
  MISSING_GRANTS: 'web.admin.entitlement.reason.MISSING_GRANTS',
  GRANT_NOT_INCLUDED: 'web.admin.entitlement.reason.GRANT_NOT_INCLUDED',
  ENTITLEMENT_MODE_UNCONFIGURED: 'web.admin.entitlement.reason.ENTITLEMENT_MODE_UNCONFIGURED',
  ISSUER_NOT_CONFIGURED: 'web.admin.entitlement.reason.ISSUER_NOT_CONFIGURED',
};

export const entitlementReasonKey = (reason: string | null): MessageKey | null =>
  reason === null ? null : (ADMIN_ENTITLEMENT_REASON_KEY[reason] ?? null);

/**
 * 「调休 / 补班」表单**收集到的原始输入**（未拆分、未修剪前的文本框内容）。
 *
 * 🔴 为什么这里全是字符串：这个面板**不判合法性**。日期存不存在、
 * `isOffDay` 是不是布尔、同一天有没有出现两次、年份在不在区间内 ——
 * 每一项的裁决权都在契约 `holidayYearPutSchema`（服务端那一次 `safeParse`），
 * 界面只负责把输入折成载荷发出去，然后把结果读回来。
 * 在这里写一条"日期必须形如 YYYY-MM-DD"就是 §3.5 那条"同一个判断抄两遍"，
 * 而两遍的区别会表现为"界面收了、服务端拒了"或反过来。
 */
export interface HolidayYearInput {
  readonly yearText: string;
  /** 公告原文链接，**一行一条**（契约要求至少一条，缺了由服务端拒）。 */
  readonly papersText: string;
  readonly noteText: string;
  /** 放假日，一行一个 `YYYY-MM-DD`。 */
  readonly offDaysText: string;
  /** 补班日，同上。落在哪个框里就是 `isOffDay` 的取值 —— 这是**输入格式**，不是业务判断。 */
  readonly workDaysText: string;
}

/** 保存/撤销之后界面上那一行的三种可读出状态。**穷举**，漏一种编译期就红。 */
export type AdminHolidayNotice = 'saved' | 'deleted' | 'failed';

export const ADMIN_HOLIDAY_NOTICE_KEY: Record<AdminHolidayNotice, string> = {
  saved: 'web.admin.holiday.notice.saved',
  deleted: 'web.admin.holiday.notice.deleted',
  failed: 'web.admin.holiday.notice.failed',
};

/**
 * 退款那一次动作的结果。**穷举**，漏一种编译期就红。
 *
 * 🔴 为什么 `submitted` 与 `channel-failed` 是**两句不同的话**：批准这个**决定**已经落库，
 * 通道那一跳失败只是"下一步还没成"。把它们合成"操作成功"会让运营以为钱已经退出去，
 * 而 `AGENTS.md §8` 第 10 条要的是"发出去 / 已到账 / 用户已看到"分层说话。
 * 同理，`denied`（服务端给了机器码）与 `conflict`（没给码）必须分开 ——
 * 前者能说出"为什么"，后者说不出，界面就不许假装说得出。
 *
 * `unknown` 那一档不是防御性装饰：2xx 体的 `outcome` 词表住在服务端，
 * 客户端这份类型是**手抄的**（`admin-client.ts` 注释里那条"这里不枚举词表"的代价）。
 * 服务端加一个 outcome 而这一片没跟上时，`unknown` 让界面说"不认识这个码"，
 * 而不是把它读成成功。
 */
export type AdminRefundNotice =
  | 'requested'
  | 'submitted'
  | 'channel-failed'
  | 'not-submittable'
  | 'rejected'
  | 'denied'
  | 'conflict'
  | 'unknown';

export const ADMIN_REFUND_NOTICE_KEY: Record<AdminRefundNotice, string> = {
  requested: 'web.admin.refund.notice.requested',
  submitted: 'web.admin.refund.notice.submitted',
  'channel-failed': 'web.admin.refund.notice.channelFailed',
  'not-submittable': 'web.admin.refund.notice.notSubmittable',
  rejected: 'web.admin.refund.notice.rejected',
  denied: 'web.admin.refund.notice.denied',
  conflict: 'web.admin.refund.notice.conflict',
  unknown: 'web.admin.refund.notice.unknown',
};

/**
 * 服务端 409 / 通道失败里的**机器码** → 专属措辞。
 *
 * 🔴 码的唯一来源是服务端（`server/src/billing/refund-policy.ts` 的 `RefundDenialReason`
 * 与 `admin.routes.ts` 那两个 409）。这里只负责"给已经存在的码配一句人话"，
 * **不**负责判定它合法 —— 传输层连词表都不枚举（见 `admin-client.ts` 文件头）。
 *
 * ⚠️ 这张表**没有**编译期穷举保护：跨的是包边界（`server` 不是 `apps/web` 的依赖），
 * TS 拿不到那份枚举。兜底是 `denied` 那条通用措辞会把原码打印出来 ——
 * 也就是说服务端加一个新码时，界面从"运营看得见确切原因"降级成"运营看得见原因码"，
 * **不会**降级成谎话。补齐这张表属于 ADR-0053 §5 那一条边界。
 */
export const ADMIN_REFUND_CODE_KEY: Record<string, string> = {
  WINDOW_PASSED: 'web.admin.refund.code.windowPassed',
  ALREADY_REFUNDED: 'web.admin.refund.code.alreadyRefunded',
  REFUND_ALREADY_OPEN: 'web.admin.refund.code.alreadyOpen',
  ORDER_NOT_PAYABLE: 'web.admin.refund.code.notPayable',
  AMOUNT_UNVERIFIED: 'web.admin.refund.code.amountUnverified',
  NOT_CHECKOUT_ORDER: 'web.admin.refund.code.notCheckoutOrder',
  NOT_DECIDABLE: 'web.admin.refund.code.notDecidable',
  REFUND_PROVIDER_NOT_REGISTERED: 'web.admin.refund.code.providerNotRegistered',
};

/**
 * 申请退款表单**收集到的原始输入**。
 *
 * 🔴 与 `HolidayYearInput` 同一条纪律：这里全是字符串，**一片判定都没有**。
 * "订单号必须是正整数""理由不能为空""例外必须配理由"全部由服务端那一次
 * `refundRequestSchema.safeParse` + `decideRefundEligibility` 裁决。
 * 在这一层加一条 `Number.isInteger` 守卫，就是 §3.5 那条"同一个判断抄两遍"。
 */
export interface RefundRequestInput {
  readonly orderIdText: string;
  readonly noteText: string;
  /** 跳过 7×24 时间窗的唯一开关（服务端要求它配一句非空理由）。 */
  readonly operatorApproved: boolean;
}

/** 一次动作之后界面要念的那几个数。 */
export interface AdminRefundEcho {
  readonly id: number;
  /** 申请那一步才知道的订单号；批准/驳回时是 `null`（那一行列表里本来就有）。 */
  readonly orderId: number | null;
  /** 服务端回的状态或结果码原文（`submitted` / `failed` / 未认识的 outcome…）。 */
  readonly detail: string | null;
}

/**
 * `approve` 的 2xx `outcome` → 界面那一句。
 *
 * 🔴 **不认识的 outcome 一律落 `unknown`**，而不是默认成"成功"：这一片的词表住在服务端
 * （`submitRefundToChannel` 的返回联合），客户端这份类型是手抄的。
 * 服务端加一臂而这里没跟上的话，"读成成功"就是界面替运营编了一个钱已经发出去的事实。
 */
export const ADMIN_REFUND_APPROVE_NOTICE: Record<string, AdminRefundNotice> = {
  submitted: 'submitted',
  'channel-failed': 'channel-failed',
  'not-submittable': 'not-submittable',
};

/**
 * 多行文本 → 项数组。**只是拆分与去空行**：不排序、不去重、不校验。
 *
 * ⚠️ 刻意不去重：同一天出现两次由契约拒（`NO_SAME_DAY_TWICE`），
 * 界面悄悄去重会把一次本该可见的录入错误变成"存成功了"。
 */
function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export interface AdminStoreState {
  access: AdminAccess;
  /** 上一次失败的 i18n key（成功时 `null`）。 */
  errorKey: string | null;
  loading: boolean;

  overview: AdminOverview | null;
  users: AdminPage<AdminUserRow> | null;
  subscriptions: AdminPage<AdminSubscriptionRow> | null;
  orders: AdminPage<AdminOrderRow> | null;
  coupons: AdminPage<AdminCouponRow> | null;
  invites: AdminInvites | null;
  /**
   * 营收看板（`GET /api/admin/revenue` 的响应原样搬回来）。
   *
   * `null` = 还没拉过。它与"窗口里一单都没有"**不是**同一件事 ——
   * 后者是 `series: []`，界面要能说"这段时间没有进账"，
   * 而前者只能说"还没问"。混起来的表现是：刚切到这一格时闪一句
   * "没有营收"，一秒后又冒出数字。
   */
  revenue: AdminRevenue | null;
  /** 当前窗口天数。界面那三个按钮改的就是它，也是下一次 `loadRevenue` 的参数。 */
  revenueDays: number;
  /**
   * 公告全量（含未生效与已过期 —— 后台要看的就是现状）。
   * `null` = 还没拉过，与"一条都没有"是两件事。
   */
  announcements: AdminAnnouncementRow[] | null;
  /** 上一次发公告的结果（`null` = 这次会话还没发过）。 */
  announcementNotice: 'done' | 'failed' | null;

  /**
   * 档位下拉 + 天数上界。**同一次读**拿回来（`GET /api/admin/skus` 一起给）。
   *
   * 🔴 `daysMax` 是**服务端给的数**，不是界面抄的：那两个数一旦各写一份，
   * 下一次抬上界时改一处留一处的症状是"界面说能发 5000 天、服务端说不能"。
   */
  grantBoard: { skus: AdminGrantSku[]; daysMax: number } | null;
  /**
   * 发放记录（动作史）。`null` = 还没拉过，与"一条都没有"是两件事。
   *
   * ⚠️ 它是**动作史**，不是当前权益：「谁在什么时候给他动过什么」在这里，
   * 「他此刻实际能用什么」在用户详情那格的并集读数里（`detail.entitlements`，
   * 与守卫同一次裁决）。这两格不许合成一格 —— 一份是流水，一份是当下的闸门状态。
   */
  grantHistory: AdminGrantRow[] | null;
  /**
   * 服务端回显的那一页坐标（`{ total, offset }`）。
   *
   * 🔴 两个数都取**响应里的那一份**，不在界面自己数 `items.length`、也不自己加偏移：
   * 界面记的页码与服务端给的那一页不一致时，翻页控件会停在"还能点下一页"而列表已经空了。
   * `null` 时是 0 —— 那一格翻页本来就不该出现。
   */
  grantHistoryTotal: number;
  grantHistoryOffset: number;
  /**
   * 「给谁发」。**故意住在 store 而不是表单的 `useState`**：它是跨格子的搬运，
   * 不是这一屏的输入 —— 路径是「用户」那一格搜到人 → 点「给他发一份」→ 切到「发放」。
   * 目标若住在面板自己的 state 里，切格子就是卸载重挂，那个编号会**静默变回空**，
   * 而他刚点的那一下看起来"什么都没发生"。
   *
   * ⚠️ 只搬"是谁"：档位、天数、理由仍然一次一填、成功就清空 ——
   * 把理由也跨格子留着，下一笔会带上上一笔的审计理由。
   *
   * 空串 = 还没选到人，输入框照旧由运营自己填。
   */
  grantTarget: string;
  /**
   * 上一次发放动作的结果。**说了是哪一件事** —— 三种动作的回执不是一句话：
   * 「已给这个人延长 30 天」「已把他升到另一档、一天没加」「已收回发放」
   * 是三件不同的事，合成"操作成功"会让运营不确定自己刚才点的是哪一个。
   */
  grantNotice: AdminGrantNotice | null;
  /** 409 时服务端给的那个**机器码**（`undefined` 时界面只说"状态冲突"，不编原因）。 */
  grantCode: string | null;
  detail: AdminUserDetail | null;
  /** 已录入的调休年度（含 `papers`，面板要把它们渲染成链接）。 */
  holidayYears: AdminHolidayYears | null;
  /** 保存 / 撤销之后那一行的状态（`null` = 这次会话还没动过）。 */
  holidayNotice: AdminHolidayNotice | null;
  /**
   * 服务端回显的坐标：`saved` 那一刻界面要说的是**这两个数**。
   *
   * ⚠️ `dayCount` 只有 PUT 才有意义（逐日行数）。DELETE 的 `deleted` 是
   * `deleteMany` 打在**年度表**上的计数 ⇒ 只能是 0 或 1，**不是天数**。
   * 把它塞进同一个字段再让文案念成"{count} 天"就是一句谎话，
   * 所以撤销时它是 `null`，对应文案里也没有 `{count}` 占位符。
   */
  holidayEcho: { year: number; dayCount: number | null } | null;

  /**
   * 退款行（`GET /api/admin/refunds` 的投影，**不分页**）。
   * `null` = 还没拉过（与空列表 `[]` 是两件事：空列表真的意味着"没有申请"）。
   */
  refunds: AdminRefundRow[] | null;
  /** 按用户编号筛选（服务端 `?userId=`）。空串 = 不筛选。 */
  refundFilter: string;
  refundNotice: AdminRefundNotice | null;
  /** 服务端给的那个**机器码**（`denied` / `channel-failed` / `unknown` 时非空）。 */
  refundCode: string | null;
  refundEcho: AdminRefundEcho | null;

  /** 用户搜索词（服务端按邮箱 `contains`）。 */
  query: string;
  /**
   * 当前所在的后台分区。
   *
   * 🔴 为什么在 store 而不是面板的 `useState`：现在**两个壳**消费它 ——
   * 设置页里那一排横向 tab，和 `/admin` 那个独立后台页的侧栏。
   * 各自持一份的话，"侧栏点了但内容区跟着另一份状态走"是编译期抓不到的错。
   */
  activeTab: AdminTab;
  /** 动作完成后的提示（成功/失败），界面显示一次即可。 */
  actionNotice: 'done' | 'failed' | null;

  probe: () => Promise<AdminAccess>;
  loadOverview: () => Promise<void>;
  loadUsers: (params?: { q?: string; offset?: number }) => Promise<void>;
  loadSubscriptions: (offset?: number) => Promise<void>;
  loadOrders: (offset?: number) => Promise<void>;
  loadCoupons: (offset?: number) => Promise<void>;
  loadInvites: (offset?: number) => Promise<void>;
  /**
   * 拉营收看板。`days` 不给就沿用界面上那一档。
   *
   * 🔴 时区偏移由**这一侧**算并传过去：这台浏览器知道运营者在哪个日子边界上
   * 看这张图，服务端不知道。`getTimezoneOffset()` 返回的是"本地→UTC 要加多少分钟"
   * （东八区给 -480），所以取反才是服务端那个 `offsetMinutes`。
   */
  loadRevenue: (days?: number) => Promise<void>;
  loadAnnouncements: () => Promise<void>;
  /**
   * 发一条公告。表单给的是**原始字符串**（含两个 `datetime-local` 的值）。
   *
   * 🔴 这里只把"墙上时钟"换算成 epoch 毫秒（那是设备本地事实，只有这台机器知道），
   * 除此之外**一个判断都不做**：长度、词表、"过期时刻不能早于生效时刻"
   * 全部由服务端那一次 `safeParse` 裁决（ADR-0075）。
   * 在这里多判一次就是第二套标准，而漂移表现为"界面收了、服务端拒了"。
   */
  publishAnnouncement: (input: AnnouncementFormInput) => Promise<boolean>;
  withdrawAnnouncement: (id: number) => Promise<void>;
  clearAnnouncementNotice: () => void;

  /**
   * 档位下拉 + 发放记录第一页（同一次进格子里拉齐，两样都是"这一屏要读的"）。
   */
  loadGrantBoard: () => Promise<void>;
  /**
   * 只重读发放记录那一页（翻页走这一条）。
   *
   * `offset` 不给就沿用**服务端上一次回显的那一页** —— 发完一次之后再点翻页，
   * 应该回到他刚才看着那一页，而不是被弹回第一页。
   *
   * 🔴 翻页不重读档位：档位是"能选什么"，它不因你看第几页而变。
   * 一次翻页打两把 GET 的症状不是报错，是每次翻页都闪一次下拉重新加载。
   */
  loadGrantHistory: (offset?: number) => Promise<void>;
  /** 运营在发放输入框里自己改目标账号。 */
  setGrantTarget: (value: string) => void;
  /**
   * 🔴 从「用户」那一格的行直接搬进发放格子：填好账号编号 + 切格子。
   *
   * 为什么不是"把整张表单搬过去"：这一格只有「是谁」值得跨格子存活（一次给同一个人
   * 发两档是常态），档位/天数/理由都是这一笔自己的，搬过去等于让上一笔的理由
   * 变成这一笔的审计记录。
   */
  openGrantForUser: (userId: number) => void;
  /**
   * 赠送订阅：发放行延长 N 天 + 设档位。
   *
   * 🔴 这里只做**字符串 → 数**的转换（`Number(...)`），一条合法性判断都没有：
   * `"abc"` 变成 `NaN`、`JSON.stringify` 把它写成 `null`、服务端按"天数不合法"拒 ——
   * 那条 400 就是这一格该有的答案，界面不许替它先拦一次（拦了就是第二套标准）。
   */
  grantSubscription: (input: GrantFormInput) => Promise<boolean>;
  /** 免费升级：只换档位，**一天都不加**（服务端那一条判据钉的就是它不写 `currentPeriodEnd`）。 */
  upgradeGrant: (input: GrantFormInput) => Promise<boolean>;
  /** 收回发放：只作用在发放行上。付费行一格不动 —— 停掉付费订阅是退款的职责（ADR-0053）。 */
  revokeGrant: (input: GrantFormInput) => Promise<boolean>;
  clearGrantNotice: () => void;

  loadHolidayYears: () => Promise<void>;
  /** 整年替换（一个用户意图 = 一次 PUT；不接受"半套数据"由服务端事务保证）。 */
  saveHolidayYear: (input: HolidayYearInput) => Promise<boolean>;
  /** 撤销某一年 = 那一年**退回随包表**，不是"下发空的一年"。 */
  deleteHolidayYear: (year: number) => Promise<void>;
  clearHolidayNotice: () => void;
  loadRefunds: (params?: { userId?: string }) => Promise<void>;
  /** 为一条已付订单开一张申请（`Promise<boolean>`：成功了界面才清输入框）。 */
  requestRefund: (input: RefundRequestInput) => Promise<boolean>;
  /** 批准 = 决定落库**并且**把这一跳发给通道。 */
  approveRefund: (id: number, noteText: string) => Promise<void>;
  /** 驳回 = 唯一"钱与权益都不动"的出口。 */
  rejectRefund: (id: number, noteText: string) => Promise<void>;
  clearRefundNotice: () => void;
  openUser: (id: number) => Promise<void>;
  closeUser: () => void;
  /**
   * 切分区，并把三个**一次性提示**清掉。
   *
   * 为什么清提示是这里的事而不是每个壳的 onClick：两条入口（设置页 tab 条 /
   * `/admin` 侧栏）都要同一个行为。漏一处的表现是"切走了，上一格的『已完成。』
   * 还挂在新一格下面"—— 一句关于**另一个分区**的话，比没有话更坏。
   */
  setActiveTab: (tab: AdminTab) => void;
  unlockUser: (id: number) => Promise<void>;
  setUserQuota: (id: number, quotaBytes: number) => Promise<void>;
  forceLogout: (id: number) => Promise<void>;
  clearNotice: () => void;
}

/** 从同步 store 取"服务器在哪、令牌是什么" —— 与 `subscription/store.ts` 同一处来源。 */
function clientOptions(): AdminClientOptions {
  const { baseUrl, token } = useSyncStore.getState();
  return { baseUrl, getToken: async () => token };
}

/**
 * 把一次请求的结果折进 store。
 *
 * 🔴 `forbidden` 特殊处理：它把 `access` 降成 `denied` —— 权限在会话中途被
 * 撤销时，面板应当**自己消失**，而不是继续显示一堆 403 的空白表格。
 * 其余失败只记 `errorKey`，不动 `access`（断网不该被读成"权限被撤"）。
 */
function applyFailure(
  result: Extract<AdminResult<unknown>, { ok: false }>,
  set: (partial: Partial<AdminStoreState>) => void,
): void {
  const errorKey = ADMIN_REASON_KEY[result.reason];
  if (result.reason === 'forbidden') {
    set({ access: 'denied', errorKey, loading: false });
    return;
  }
  set({ errorKey, loading: false });
}

/**
 * 退款动作的失败：先走 `applyFailure`（那一条对所有后台请求都一样），
 * 再补退款这一层特有的一句 —— **状态冲突时把服务端给的原因码带进界面**。
 *
 * 🔴 这正是 ADR-0053 §5 第 11 条点名的那件事：409 的 `{reason:'WINDOW_PASSED'}`
 * 如果只落成"服务端错误"，运营会去改参数重试，而改参数永远改不动"这一单已过 7 天"。
 * 服务端没给码（`serverReason === undefined`）时写成 `conflict`：界面承认"这是一次
 * 状态冲突，但服务端没说为什么"，**不**替它编一个原因。
 */
function applyRefundFailure(
  result: Extract<AdminResult<unknown>, { ok: false }>,
  set: (partial: Partial<AdminStoreState>) => void,
): void {
  applyFailure(result, set);
  if (result.reason !== 'conflict') {
    set({ refundNotice: null, refundCode: null, refundEcho: null });
    return;
  }
  set({
    refundNotice: result.serverReason === undefined ? 'conflict' : 'denied',
    refundCode: result.serverReason ?? null,
    refundEcho: null,
  });
}

/**
 * 发放动作的失败：先走 `applyFailure`，再补这一层特有的一句 ——
 * **409 时把服务端给的码带进界面**。
 *
 * 🔴 与 `applyRefundFailure` 同一形状，不是复制粘贴的巧合：这两类动作都会
 * "参数完全正确、但当前状态不允许"。运营对着这样一句"操作失败"唯一能做的事
 * 就是把同一个请求再点一遍，而"这一档现在交付不了"不会因为他重试就变成能交付。
 *
 * ⚠️ 非 409（400 / 404 / 断网）**不留** `grantNotice`：那几种情况下
 * `errorKey` 那一行已经说清了是哪一类问题，再补一句"发放被拒"就是同一件事说两遍。
 */
function applyGrantFailure(
  result: Extract<AdminResult<unknown>, { ok: false }>,
  set: (partial: Partial<AdminStoreState>) => void,
): void {
  applyFailure(result, set);
  if (result.reason !== 'conflict') {
    set({ grantNotice: null, grantCode: null });
    return;
  }
  set({
    grantNotice: result.serverReason === undefined ? 'conflict' : 'denied',
    grantCode: result.serverReason ?? null,
  });
}

/**
 * 动作成功后重新读回服务端状态：**详情和列表都要**。
 *
 * 🔴 只重拉详情会留下一张说谎的界面。用户列表那一行有自己的「已锁定」徽标，
 * 而再点一次「用户」Tab **不会**重拉（数据已在 store 里，那条判据是"点两下不重拉"）——
 * 于是运营者解完锁，列表上仍写着"已锁定"，而且**没有任何动作能把它刷掉**。
 *
 * 修法只能是"再读一遍"，不能是本地把徽标抹掉：服务端是唯一裁决者（ADR-0038），
 * 乐观补丁会让界面显示一个还没被证实的状态 —— 那与它要修的缺陷是同一类问题。
 *
 * 翻页与搜索词必须**照原样**带着：重置成第一页会让运营者刚刚定位到的那一屏凭空跳走。
 */
async function reloadAfterUserAction(id: number): Promise<void> {
  const { openUser, loadUsers, users, query } = useAdminStore.getState();
  await openUser(id);
  if (users !== null) {
    await loadUsers({ q: query, offset: users.offset });
  }
}

export const useAdminStore = create<AdminStoreState>((set, get) => ({
  access: 'unknown',
  errorKey: null,
  loading: false,

  overview: null,
  users: null,
  subscriptions: null,
  orders: null,
  coupons: null,
  invites: null,
  revenue: null,
  revenueDays: 90,
  announcements: null,
  announcementNotice: null,
  grantBoard: null,
  grantHistory: null,
  grantHistoryTotal: 0,
  grantHistoryOffset: 0,
  grantTarget: '',
  grantNotice: null,
  grantCode: null,
  detail: null,
  holidayYears: null,
  holidayNotice: null,
  holidayEcho: null,

  refunds: null,
  refundFilter: '',
  refundNotice: null,
  refundCode: null,
  refundEcho: null,

  query: '',
  activeTab: 'overview',
  actionNotice: null,

  probe: async () => {
    // 已经在探测或已判定为否，就不重复打 —— 设置页每次打开都探测会白费请求。
    const current = get().access;
    if (current === 'checking' || current === 'denied') return current;

    set({ access: 'checking' });
    const result = await fetchAdminOverview(clientOptions());

    if (result.ok) {
      // 探测顺手就把概览带回来了：省一次请求，而且两个标签页共用同一份数据。
      set({ access: 'admin', overview: result.data, errorKey: null });
      return 'admin';
    }

    if (result.reason === 'forbidden') {
      set({ access: 'denied', errorKey: ADMIN_REASON_KEY.forbidden });
      return 'denied';
    }
    if (result.reason === 'unauthorized') {
      set({ access: 'unavailable', errorKey: ADMIN_REASON_KEY.unauthorized });
      return 'unavailable';
    }
    set({ access: 'unavailable', errorKey: ADMIN_REASON_KEY[result.reason] });
    return 'unavailable';
  },

  loadOverview: async () => {
    set({ loading: true });
    const result = await fetchAdminOverview(clientOptions());
    if (!result.ok) return applyFailure(result, set);
    set({ overview: result.data, errorKey: null, loading: false });
  },

  loadUsers: async (params = {}) => {
    const q = params.q ?? get().query;
    set({ loading: true, query: q });
    const result = await fetchAdminUsers(clientOptions(), {
      q,
      limit: ADMIN_PAGE_SIZE,
      offset: params.offset ?? 0,
    });
    if (!result.ok) return applyFailure(result, set);
    set({ users: result.data, errorKey: null, loading: false });
  },

  loadSubscriptions: async (offset = 0) => {
    set({ loading: true });
    const result = await fetchAdminSubscriptions(clientOptions(), {
      limit: ADMIN_PAGE_SIZE,
      offset,
    });
    if (!result.ok) return applyFailure(result, set);
    set({ subscriptions: result.data, errorKey: null, loading: false });
  },

  loadOrders: async (offset = 0) => {
    set({ loading: true });
    const result = await fetchAdminOrders(clientOptions(), { limit: ADMIN_PAGE_SIZE, offset });
    if (!result.ok) return applyFailure(result, set);
    set({ orders: result.data, errorKey: null, loading: false });
  },

  loadCoupons: async (offset = 0) => {
    set({ loading: true });
    const result = await fetchAdminCoupons(clientOptions(), { limit: ADMIN_PAGE_SIZE, offset });
    if (!result.ok) return applyFailure(result, set);
    set({ coupons: result.data, errorKey: null, loading: false });
  },

  loadInvites: async (offset = 0) => {
    set({ loading: true });
    const result = await fetchAdminInvites(clientOptions(), { limit: ADMIN_PAGE_SIZE, offset });
    if (!result.ok) return applyFailure(result, set);
    set({ invites: result.data, errorKey: null, loading: false });
  },

  loadRevenue: async (days) => {
    const wanted = days ?? get().revenueDays;
    set({ loading: true, revenue: null, revenueDays: wanted });
    const result = await fetchAdminRevenue(clientOptions(), {
      days: wanted,
      offsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (!result.ok) return applyFailure(result, set);
    set({ revenue: result.data, errorKey: null, loading: false });
  },

  loadAnnouncements: async () => {
    set({ loading: true });
    const result = await fetchAdminAnnouncements(clientOptions());
    if (!result.ok) return applyFailure(result, set);
    set({ announcements: result.data.announcements, errorKey: null, loading: false });
  },

  publishAnnouncement: async (input) => {
    // 空文本框 ⇒ `Date.parse('')` 是 NaN，而 NaN 进 JSON 会变成 `null` ——
    // 服务端那一条 `int().positive()` 会把它判成 400，界面于是报一个
    // "参数不合法"却不说哪一格。所以**空 = 现在**在这里落地（它是一个缺省值，
    // 不是一条合法性判断，与"界面不判合法性"那条纪律不冲突）。
    const publishedAtMs =
      input.publishesAtText.trim() === '' ? Date.now() : Date.parse(input.publishesAtText.trim());
    const expiresRaw = input.expiresAtText.trim();
    const expiresAtMs = expiresRaw === '' ? undefined : Date.parse(expiresRaw);

    set({ loading: true, announcementNotice: null });
    const result = await adminPublishAnnouncement(clientOptions(), {
      title: input.titleText,
      body: input.bodyText,
      level: input.level,
      publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : Date.now(),
      ...(expiresAtMs === undefined || Number.isNaN(expiresAtMs) ? {} : { expiresAtMs }),
    });
    if (!result.ok) {
      applyFailure(result, set);
      set({ announcementNotice: 'failed' });
      return false;
    }
    // 🔴 发完**重新拉列表**，而不是把返回的那一行本地插进去：
    // 界面要显示的是服务端存下来的样子（含它算的 `createdAt` 与它裁过的长度）。
    await get().loadAnnouncements();
    set({ announcementNotice: 'done' });
    return true;
  },

  withdrawAnnouncement: async (id) => {
    set({ loading: true, announcementNotice: null });
    const result = await adminWithdrawAnnouncement(clientOptions(), id);
    if (!result.ok) {
      applyFailure(result, set);
      set({ announcementNotice: 'failed' });
      return;
    }
    await get().loadAnnouncements();
    set({ announcementNotice: 'done' });
  },

  clearAnnouncementNotice: () => {
    set({ announcementNotice: null });
  },

  loadGrantHistory: async (offset) => {
    set({ loading: true });
    const skip = offset ?? get().grantHistoryOffset;
    const history = await fetchAdminSubscriptionGrants(clientOptions(), {
      limit: ADMIN_PAGE_SIZE,
      offset: skip,
    });
    if (!history.ok) return applyFailure(history, set);
    set({
      grantHistory: history.data.items,
      // 🔴 页坐标取**服务端回显的那一份**（`total` / `offset` 都在响应里）。
      // 界面自己数 `items.length` 当总数，第二页就会永远点不动 —— 它数到的是这一页的条数。
      grantHistoryTotal: history.data.total,
      grantHistoryOffset: history.data.offset,
      errorKey: null,
      loading: false,
    });
  },

  loadGrantBoard: async () => {
    set({ loading: true });
    // 两把读并发：档位是"能选什么"，历史是"已经动过什么"，同一屏都要显示，
    // 串行会让这一屏多等一个 RTT 而没有任何一侧依赖另一侧。
    const [skus] = await Promise.all([fetchAdminGrantSkus(clientOptions()), get().loadGrantHistory()]);
    if (!skus.ok) return applyFailure(skus, set);
    set({
      grantBoard: { skus: skus.data.skus, daysMax: skus.data.grantDaysMax },
      errorKey: null,
      loading: false,
    });
  },

  setGrantTarget: (value) => {
    set({ grantTarget: value });
  },

  openGrantForUser: (userId) => {
    // 「是谁」先落到 store，再走 `setActiveTab`，不是直接 `set({ activeTab })`：
    // 那一趟负责把每一格的服务端回显清掉，而面板那个 `switch (tab)` 会在这时把档位
    // 与记录读回来。自己在这里调 `loadGrantBoard` 等于开出第二条加载路径，
    // 而它绕过那些 clear —— 症状是「发放」那一格里还挂着上一格刚清掉的那句回执。
    set({ grantTarget: String(userId) });
    get().setActiveTab('grants');
  },

  grantSubscription: async (input) => {
    set({ loading: true, grantNotice: null, grantCode: null });
    const result = await adminGrantSubscription(clientOptions(), {
      userId: Number(get().grantTarget),
      sku: input.sku,
      days: Number(input.daysText),
      reason: input.reasonText,
    });
    if (!result.ok) {
      applyGrantFailure(result, set);
      return false;
    }
    // 🔴 动完**重新读**，而不是把返回的那一行本地拼进列表：
    // 与发公告那一条同一纪律 —— 界面要显示的是服务端存下来的样子。
    await get().loadGrantBoard();
    set({ grantNotice: 'granted', loading: false });
    return true;
  },

  upgradeGrant: async (input) => {
    set({ loading: true, grantNotice: null, grantCode: null });
    const result = await adminUpgradeSubscription(clientOptions(), {
      userId: Number(get().grantTarget),
      sku: input.sku,
      reason: input.reasonText,
    });
    if (!result.ok) {
      applyGrantFailure(result, set);
      return false;
    }
    await get().loadGrantBoard();
    set({ grantNotice: 'upgraded', loading: false });
    return true;
  },

  revokeGrant: async (input) => {
    set({ loading: true, grantNotice: null, grantCode: null });
    const result = await adminRevokeSubscriptionGrant(clientOptions(), {
      userId: Number(get().grantTarget),
      reason: input.reasonText,
    });
    if (!result.ok) {
      applyGrantFailure(result, set);
      return false;
    }
    await get().loadGrantBoard();
    set({ grantNotice: 'revoked', loading: false });
    return true;
  },

  clearGrantNotice: () => {
    set({ grantNotice: null, grantCode: null });
  },

  loadHolidayYears: async () => {
    set({ loading: true });
    const result = await fetchAdminHolidayYears(clientOptions());
    if (!result.ok) return applyFailure(result, set);
    set({ holidayYears: result.data, errorKey: null, loading: false });
  },

  saveHolidayYear: async (input) => {
    // 一次录入 = 一次 PUT，**整年替换**。这里唯一的加工是把"一行一条"拆成数组
    // （见 `splitLines` 的注释：不去重、不排序、不校验 —— 那些裁决都在契约里）。
    // ⚠️ 年份**故意不做 `Number.isInteger` 之类的守卫**：`'2026a'` 会变成 `NaN`、
    // 序列化后是 `null`，服务端以 400 拒绝，界面把"请求参数不合法"显示出来 ——
    // 与在界面里先拦一遍相比，前者只有一套裁决标准。
    const payload = {
      year: Number(input.yearText),
      papers: splitLines(input.papersText),
      note: input.noteText.trim() === '' ? null : input.noteText,
      days: [
        ...splitLines(input.offDaysText).map((day) => ({ day, isOffDay: true })),
        ...splitLines(input.workDaysText).map((day) => ({ day, isOffDay: false })),
      ],
    };

    set({ loading: true, holidayNotice: null, holidayEcho: null });
    const result = await adminPutHolidayYear(clientOptions(), payload);
    if (!result.ok) {
      applyFailure(result, set);
      set({ holidayNotice: 'failed' });
      return false;
    }

    // 🔴 成功之后**重新读回服务端**，不拿 PUT 的响应去拼界面：
    // 判据②要的是"出处链接随数据入库并回显"，只有再 GET 一次才证明它落了库，
    // 而不是"回显了请求里带上去的那几个字符串"（§7 第 50 条同一族）。
    await get().loadHolidayYears();
    set({
      holidayNotice: 'saved',
      holidayEcho: { year: result.data.year, dayCount: result.data.dayCount },
      loading: false,
    });
    return true;
  },

  deleteHolidayYear: async (year) => {
    set({ loading: true, holidayNotice: null, holidayEcho: null });
    const result = await adminDeleteHolidayYear(clientOptions(), year);
    if (!result.ok) {
      applyFailure(result, set);
      set({ holidayNotice: 'failed' });
      return;
    }
    // `deleted` 是**年度表**上的删除计数（0 或 1），不是天数 ⇒ 只取年份。
    // `deleted: 0` 是**幂等成功**（那一年本来就没录过，服务端把它当成功，
    // 理由写在 `admin.routes.ts` 那条 DELETE 的注释里），界面照成功说。
    await get().loadHolidayYears();
    set({
      holidayNotice: 'deleted',
      holidayEcho: { year: result.data.year, dayCount: null },
      loading: false,
    });
  },

  clearHolidayNotice: () => {
    set({ holidayNotice: null, holidayEcho: null });
  },

  loadRefunds: async (params = {}) => {
    // 筛选词**必须跟着重载走**（与 `reloadAfterUserAction` 里那句"翻页与搜索词照原样带着"
    // 同一件事）：动作之后把筛选清掉，运营刚定位到的那一屏会凭空变成全量最新 50 条。
    const filter = params.userId ?? get().refundFilter;
    set({ loading: true, refundFilter: filter });
    const result = await fetchAdminRefunds(clientOptions(), {
      // ⚠️ 刻意不做 `Number.isFinite` 守卫：`'2a'` → `NaN` → 查询串里是 `userId=NaN`
      // → 服务端 400 → 界面说"请求参数不合法"。在这里先拦一遍就是两套裁决标准。
      userId: filter.trim() === '' ? undefined : Number(filter),
      limit: ADMIN_PAGE_SIZE,
    });
    if (!result.ok) return applyFailure(result, set);
    set({ refunds: result.data.refunds, errorKey: null, loading: false });
  },

  requestRefund: async (input) => {
    const note = input.noteText.trim();
    set({ loading: true, refundNotice: null, refundCode: null, refundEcho: null });
    const result = await adminCreateRefundRequest(clientOptions(), {
      orderId: Number(input.orderIdText),
      ...(note === '' ? {} : { note }),
      ...(input.operatorApproved === true ? { operatorApproved: true } : {}),
    });
    if (!result.ok) {
      applyRefundFailure(result, set);
      return false;
    }

    // 🔴 成功之后**重新读回服务端**，界面那一行念的数是列表里的那一行，
    // 不是 POST 请求里带上去的那几个字符（与 `saveHolidayYear` 同一判据、同一理由）。
    await get().loadRefunds();
    const row = (get().refunds ?? []).find((item) => item.id === result.data.refundId);
    set({
      refundNotice: 'requested',
      refundCode: null,
      refundEcho: { id: result.data.refundId, orderId: row?.orderId ?? null, detail: row?.status ?? null },
      loading: false,
    });
    return true;
  },

  approveRefund: async (id, noteText) => {
    set({ loading: true, refundNotice: null, refundCode: null, refundEcho: null });
    const result = await adminApproveRefund(clientOptions(), id, noteText.trim());
    if (!result.ok) {
      applyRefundFailure(result, set);
      return;
    }
    await get().loadRefunds();
    const body = result.data;
    const notice = ADMIN_REFUND_APPROVE_NOTICE[body.outcome] ?? 'unknown';
    set({
      refundNotice: notice,
      // 通道失败那一臂服务端给的是**它的**原因码；`unknown` 那一档把没认识到的 outcome
      // 原文交出去，界面就说"不认识这个码"，不猜它的意思。
      refundCode:
        body.outcome === 'channel-failed' ? body.reason : notice === 'unknown' ? body.outcome : null,
      refundEcho: {
        id,
        orderId: (get().refunds ?? []).find((item) => item.id === id)?.orderId ?? null,
        detail: 'status' in body ? String(body.status) : null,
      },
      loading: false,
    });
  },

  rejectRefund: async (id, noteText) => {
    set({ loading: true, refundNotice: null, refundCode: null, refundEcho: null });
    const result = await adminRejectRefund(clientOptions(), id, noteText.trim());
    if (!result.ok) {
      applyRefundFailure(result, set);
      return;
    }
    await get().loadRefunds();
    set({
      refundNotice: 'rejected',
      refundCode: null,
      refundEcho: { id, orderId: null, detail: result.data.status },
      loading: false,
    });
  },

  clearRefundNotice: () => {
    set({ refundNotice: null, refundCode: null, refundEcho: null });
  },

  openUser: async (id) => {
    set({ loading: true, detail: null });
    const result = await fetchAdminUser(clientOptions(), id);
    if (!result.ok) return applyFailure(result, set);
    set({ detail: result.data, errorKey: null, loading: false });
  },

  closeUser: () => {
    set({ detail: null, actionNotice: null });
  },

  unlockUser: async (id) => {
    set({ actionNotice: null });
    const result = await adminUnlockUser(clientOptions(), id);
    if (!result.ok) {
      applyFailure(result, set);
      set({ actionNotice: 'failed' });
      return;
    }
    await reloadAfterUserAction(id);
    set({ actionNotice: 'done' });
  },

  setUserQuota: async (id, quotaBytes) => {
    set({ actionNotice: null });
    const result = await adminSetUserQuota(clientOptions(), id, quotaBytes);
    if (!result.ok) {
      applyFailure(result, set);
      set({ actionNotice: 'failed' });
      return;
    }
    await reloadAfterUserAction(id);
    set({ actionNotice: 'done' });
  },

  forceLogout: async (id) => {
    set({ actionNotice: null });
    const result = await adminForceUserLogout(clientOptions(), id);
    if (!result.ok) {
      applyFailure(result, set);
      set({ actionNotice: 'failed' });
      return;
    }
    await reloadAfterUserAction(id);
    set({ actionNotice: 'done' });
  },

  clearNotice: () => {
    set({ actionNotice: null });
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    // 🔴 复用那三个 clear\*，不在这里手写它们清空的字段。
    // 手写会清**少**：`clearHolidayNotice` 除了 `holidayNotice` 还要清 `holidayEcho`，
    // `clearRefundNotice` 还要清 `refundCode` 与 `refundEcho` —— 那三格是界面
    // 要念出来的**服务端回显坐标**，留着就是在下一格里复述上一格的事实。
    get().clearNotice();
    get().clearHolidayNotice();
    get().clearRefundNotice();
    get().clearAnnouncementNotice();
    get().clearGrantNotice();
  },
}));

/** 测试用：把 store 归零（与其它 feature store 同名同形）。 */
export function __resetAdminForTests(): void {
  useAdminStore.setState({
    access: 'unknown',
    errorKey: null,
    loading: false,
    overview: null,
    users: null,
    subscriptions: null,
    orders: null,
    coupons: null,
    invites: null,
    revenue: null,
    revenueDays: 90,
    announcements: null,
    announcementNotice: null,
    grantBoard: null,
    grantHistory: null,
    grantHistoryTotal: 0,
    grantHistoryOffset: 0,
    grantTarget: '',
    grantNotice: null,
    grantCode: null,
    detail: null,
    holidayYears: null,
    holidayNotice: null,
    holidayEcho: null,
    refunds: null,
    refundFilter: '',
    refundNotice: null,
    refundCode: null,
    refundEcho: null,
    query: '',
    activeTab: 'overview',
    actionNotice: null,
  });
}
