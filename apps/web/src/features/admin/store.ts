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
  adminForceUserLogout,
  adminSetUserQuota,
  adminUnlockUser,
  fetchAdminCoupons,
  fetchAdminInvites,
  fetchAdminOrders,
  fetchAdminOverview,
  fetchAdminSubscriptions,
  fetchAdminUser,
  fetchAdminUsers,
  type AdminClientOptions,
  type AdminCouponRow,
  type AdminFailureReason,
  type AdminInvites,
  type AdminOrderRow,
  type AdminOverview,
  type AdminPage,
  type AdminResult,
  type AdminSubscriptionRow,
  type AdminUserDetail,
  type AdminUserRow,
} from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 面板的访问状态。见文件头：这是**探测结果**，不是权限本身。 */
export type AdminAccess = 'unknown' | 'checking' | 'admin' | 'denied' | 'unavailable';

export type AdminTab = 'overview' | 'users' | 'subscriptions' | 'orders' | 'coupons' | 'invites';

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
  server: 'web.admin.error.server',
};

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
    query: '',
    actionNotice: null,
  });
}
