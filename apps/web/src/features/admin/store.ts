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
  adminRejectRefund,
  adminSetUserQuota,
  adminUnlockUser,
  adminDeleteHolidayYear,
  adminPutHolidayYear,
  fetchAdminCoupons,
  fetchAdminHolidayYears,
  fetchAdminInvites,
  fetchAdminOrders,
  fetchAdminOverview,
  fetchAdminRefunds,
  fetchAdminSubscriptions,
  fetchAdminUser,
  fetchAdminUsers,
  type AdminClientOptions,
  type AdminCouponRow,
  type AdminFailureReason,
  type AdminHolidayYears,
  type AdminInvites,
  type AdminOrderRow,
  type AdminOverview,
  type AdminPage,
  type AdminRefundRow,
  type AdminResult,
  type AdminSubscriptionRow,
  type AdminUserDetail,
  type AdminUserRow,
} from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 面板的访问状态。见文件头：这是**探测结果**，不是权限本身。 */
export type AdminAccess = 'unknown' | 'checking' | 'admin' | 'denied' | 'unavailable';

export type AdminTab =
  | 'overview'
  | 'users'
  | 'subscriptions'
  | 'orders'
  | 'coupons'
  | 'invites'
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
  /** 动作完成后的提示（成功/失败），界面显示一次即可。 */
  actionNotice: 'done' | 'failed' | null;

  probe: () => Promise<AdminAccess>;
  loadOverview: () => Promise<void>;
  loadUsers: (params?: { q?: string; offset?: number }) => Promise<void>;
  loadSubscriptions: (offset?: number) => Promise<void>;
  loadOrders: (offset?: number) => Promise<void>;
  loadCoupons: (offset?: number) => Promise<void>;
  loadInvites: (offset?: number) => Promise<void>;
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
    actionNotice: null,
  });
}
