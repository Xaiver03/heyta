/**
 * 「退出登录」的本机侧编排（Web 壳）
 * ==============================
 *
 * ## 这一枚 store 存在的唯一理由
 *
 * 在此之前 `apps/web` 的退出登录**只有一句 `clearCredentials()`** ——
 * 那枚令牌在服务端**仍然有效一整年**，于是"我已经退出了"在共享电脑上是一句
 * 界面在说谎。本轮服务端补了 `POST /api/auth/logout`（撤销手上这一枚）与
 * `POST /api/auth/sessions/revoke-all`（撤销全部），而**客户端这一侧的收尾**
 * （先撤销、再清本机、撤销没做成要老实说）必须只有一个实现：
 *
 *   - 头像菜单的「退出登录」（`App.tsx` 的 `onSignOut`）
 *   - 登录设备面板的「退出所有设备」（`SessionsPanel`）
 *   - 以后移动端接的同一个动作
 *
 * 各写一份的后果不是"某个按钮少了"，而是**某台设备上退完了令牌还活着**。
 * 判据在 `apps/web/tests/account-security.spec.tsx`：服务端调用失败时
 * 本机凭据**仍然**要被清掉，并且界面上**必须**出现那句实话。
 *
 * ## 🔴 两条不能写反的次序
 *
 *   1. **本机清理排在网络之前。** `planSignOut()` 给的 `clearLocalCredentials`
 *      是常量 `true`（撤销失败时把令牌留在本机是更坏的结果），所以点击**当场**生效，
 *      不等一次可能挂住的请求 —— 那会让"退出登录"在断网时看起来没有任何反应。
 *   2. 🔴 **重试那一次绝不清凭据。** 用户在等待期间可能已经重新登录，
 *      那是一枚**新的**会话；拿上一次失败的撤销结果去清当前会话就是误伤。
 *      同一条立场见 AGENTS §10 第 19 条（设备撤销"只有绑定仍一致时才清理当前凭据"）。
 *
 * ## 为什么这里会**留着一枚令牌**
 *
 * `pending` 里存的是已经登出那台设备的令牌，留着只为兑现"重新尝试撤销"。
 * 它**不落盘**（`clearStoredCredentials()` 已经在 `clearCredentials()` 里做过了）、
 * 不进日志、不进任何证据文件（AGENTS §10 第 10 条）。刷新页面它就没了 ——
 * 那时那枚只能等下次登录后用「退出所有设备」收拾，而界面上那句话不会假装它被撤掉了。
 */

import { create } from 'zustand';

import { logoutCurrentDevice, logoutEveryDevice, planSignOut } from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 撤销的范围：手上这一枚（「退出登录」）还是全部（「退出所有设备」）。 */
export type SignOutScope = 'current' | 'all';

/** 发起之前就捕获好的绑定 —— 重试必须用**当初那一组**，不能读"现在"的。 */
export interface SignOutCredentials {
  baseUrl: string;
  token: string;
}

export type SignOutNotice = 'idle' | 'pending-revocation' | 'signed-out-everywhere';

export interface SignOutStoreState {
  /** 撤销还没做成时留在内存里的那组凭据（它只为"再试一次"而存在）。 */
  pending: (SignOutCredentials & { scope: SignOutScope }) | undefined;
  notice: SignOutNotice;
  /**
   * 正在进行的那一次撤销的范围（`undefined` = 没有）。
   *
   * 🔴 不是 `busy: boolean`：「退出所有设备」的按钮忙态与"重试手上这一枚"的忙态
   * 是两件不同的事，一个布尔会把它们互相点亮（点了重试 ⇒ 那个大按钮也显示"正在处理"）。
   */
  running: SignOutScope | undefined;

  signOutCurrentDevice: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  retryPendingRevocation: () => Promise<void>;
  /** 「所有设备都已退出，请重新登录」那句在用户真的重新登录后就该消失。 */
  clearDoneNotice: () => void;
  reset: () => void;
}

/**
 * 读**当前**凭据。任何一项缺失 ⇒ `undefined` = 这台设备手上没有令牌。
 *
 * 🔴 没有令牌时不能报"服务器上那一枚没能撤销" —— 那一枚根本不存在，
 * 而那句谎会让用户以为还有一件事没做完。
 */
function captureCredentials(): SignOutCredentials | undefined {
  const { baseUrl, token } = useSyncStore.getState();
  const trimmedBase = baseUrl.trim();
  const trimmedToken = (token ?? '').trim();
  if (trimmedBase === '' || trimmedToken === '') return undefined;
  return { baseUrl: trimmedBase, token: trimmedToken };
}

/**
 * 两个动作的返回类型不同（`{ message }` 与 `{ count }`），但**计划只看 `ok`**，
 * 所以这里收成一个联合，不在界面上重述那两个字段。
 */
type SignOutResult =
  | Awaited<ReturnType<typeof logoutCurrentDevice>>
  | Awaited<ReturnType<typeof logoutEveryDevice>>;

const send = (
  scope: SignOutScope,
  credentials: SignOutCredentials,
): Promise<SignOutResult> =>
  scope === 'all'
    ? logoutEveryDevice({ baseUrl: credentials.baseUrl }, credentials.token)
    : logoutCurrentDevice({ baseUrl: credentials.baseUrl }, credentials.token);

export const useSignOutStore = create<SignOutStoreState>((set, get) => {
  /**
   * 第几次登出/重试。🔴 **不是**"防止并发点击"的锁，而是"迟到结果作废"的代际计数。
   *
   * 原来这里写的是一把 in-flight 锁（`if (running !== undefined) return`），
   * 而它的后果恰好是这一单要修的那件事的反面：**服务器挂着不回话时，
   * 用户第二次点「退出登录」什么都不会发生**（连本机都不清）。
   * 现在每一次点击**都**立刻清本机；代际只用来决定"谁的结果可以写回状态" ——
   * 旧那一次迟到的失败/成功不许覆盖新那一次（AGENTS §7 第 66 条同族的"代际计数防丢写"）。
   */
  let generation = 0;

  const signOut = async (scope: SignOutScope): Promise<void> => {
    const mine = ++generation;
    const credentials = captureCredentials();
    // 次序第 1 条：本机清理**先于**网络。
    useSyncStore.getState().clearCredentials();

    if (credentials === undefined) {
      set({ pending: undefined, notice: 'idle', running: undefined });
      return;
    }

    set({ pending: { ...credentials, scope }, notice: 'idle', running: scope });
    const result = await send(scope, credentials);
    // 🔴 迟到作废：有一次更新的登出已经收尾了，这一次的结果**不属于当前世界**。
    if (generation !== mine) return;
    const plan = planSignOut(result);

    if (plan.serverRevocationPending) {
      // 实话 + 一个出口（`common.signOut.retry`）。吞掉它就等于让"退出登录"
      // 在断网时**看起来成功了** —— 那正是本轮要修的那句话。
      set({ running: undefined, notice: 'pending-revocation' });
      return;
    }

    set({
      running: undefined,
      pending: undefined,
      // 单台退出是**看得见**的（界面已经落到未登录态），不需要一句额外话；
      // 「退出所有设备」不一样：用户在别的设备上看不见，必须有一句确认。
      notice: scope === 'all' ? 'signed-out-everywhere' : 'idle',
    });
  };

  return {
    pending: undefined,
    notice: 'idle',
    running: undefined,

    signOutCurrentDevice: () => signOut('current'),
    signOutEverywhere: () => signOut('all'),

    retryPendingRevocation: async () => {
      const pending = get().pending;
      if (pending === undefined || get().running !== undefined) return;
      const mine = ++generation;
      set({ running: pending.scope });
      const result = await send(pending.scope, { baseUrl: pending.baseUrl, token: pending.token });
      // 迟到作废：用户在等待期间又点了一次「退出登录」⇒ 那一次才是当前世界。
      if (generation !== mine) return;
      const plan = planSignOut(result);
      // 🔴 次序第 2 条：这里**不**调 `clearCredentials()` —— 用户可能已经用另一枚
      //    新令牌重新登录了，那不该被上一次失败的撤销连带清掉。
      set({
        running: undefined,
        ...(plan.serverRevocationPending
          ? { notice: 'pending-revocation' as const }
          : {
              pending: undefined,
              notice: pending.scope === 'all' ? ('signed-out-everywhere' as const) : ('idle' as const),
            }),
      });
    },

    clearDoneNotice: () => {
      set((current) => (current.notice === 'signed-out-everywhere' ? { notice: 'idle' } : {}));
    },

    reset: () => {
      set({ pending: undefined, notice: 'idle', running: undefined });
    },
  };
});

/**
 * 测试用：归零（跨测试残留的凭据是"随机变红"的常见来源）。
 * 与其它 feature store 的 `__resetXxxForTests` 同名同形。
 */
export function __resetSignOutForTests(): void {
  useSignOutStore.setState({ pending: undefined, notice: 'idle', running: undefined });
}
