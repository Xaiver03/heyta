/**
 * 补签面板的界面状态（web 外壳，G-27）
 * ==================================
 *
 * 只管**界面上的两件事**：面板开不开、这一次提交在不在途中。
 * 判定与出站闸门全在 `gate.ts`（再往上是 `@heyta/app-host`），所以这里
 * **不存**"要不要补签"，也不存版本号 —— 存了就是第二份事实源，
 * 而两份事实源迟早给出不同答案（同 `privacy/store.ts` 文件头那条纪律）。
 */

import { create } from 'zustand';

import { legalRecheck } from './gate.js';

/**
 * 面板为什么开。两种要说**不同的话**：
 *
 *   · `asked` —— 启动/登录后问出来"要补签"。这一种不需要解释"为什么现在弹"。
 *   · `required-for-action` —— 用户点了同步，而闸门拦着。他不该只看到状态栏
 *     变了字，得有一条走出去的路（与隐私面板同一条理由）。
 */
export type LegalReconfirmSheetReason = 'asked' | 'required-for-action';

interface LegalReconfirmStoreState {
  open: boolean;
  reason: LegalReconfirmSheetReason;
  /** 提交在途。按钮要禁用并显示那一句"正在记下"，否则用户会连点。 */
  submitting: boolean;
  openSheet(reason: LegalReconfirmSheetReason): void;
  /**
   * 「稍后再说」：**只收起面板，绝不放开闸门**。
   *
   * 🔴 这一条是本文件最容易写错的地方 —— 一个"面板没了"的直觉实现很容易被写成
   * "当没这回事"。这里收起来之后 `dataEgressAllowed()` 必须仍然是 `false`，
   * 而那正是"稍后再说（继续不同步）"这句话的内容。
   */
  defer(): void;
  setSubmitting(submitting: boolean): void;
  /** 用户点「我已读完并确认」。真正的请求与状态迁移在闸门里。 */
  confirm(): Promise<void>;
}

export const useLegalReconfirmStore = create<LegalReconfirmStoreState>((set, get) => ({
  open: false,
  reason: 'asked',
  submitting: false,

  openSheet: (reason) => {
    set({ open: true, reason });
  },

  defer: () => {
    set({ open: false });
  },

  setSubmitting: (submitting) => {
    set({ submitting });
  },

  confirm: async () => {
    if (get().submitting) return;
    set({ submitting: true });
    try {
      await legalRecheck.confirm();
    } finally {
      // 🔴 失败时**不收起面板**：闸门仍然拦着，而那句"没有提交成功"必须出现在
      // 用户正看着的这一块上。收起面板等于把失败藏起来 —— 那是"点了没反应"那一类。
      const blocked = legalRecheck.shouldShowSheet();
      set({ submitting: false, open: blocked });
    }
  },
}));

/**
 * 问出来"要补签"就开面板；状态一变（确认完成 / 登出 / 改版）就收。
 *
 * ⚠️ 订阅放在 store 一侧而不是闸门一侧：闸门（`@heyta/app-host`）不许知道有没有界面 ——
 * node-host 与验证壳没有界面，那里只该有拦，不该有弹。
 */
legalRecheck.subscribe(() => {
  const state = useLegalReconfirmStore.getState();
  if (legalRecheck.shouldShowSheet()) {
    // 已经在 `required-for-action`（用户自己撞上的）时不许被后台的重新询问改成 `asked`，
    // 那会让"为什么现在弹"那一句在用户眼前换内容。
    state.openSheet(state.open && state.reason === 'required-for-action' ? state.reason : 'asked');
    return;
  }
  if (state.open) state.defer();
});

/**
 * 🔴 用户主动发起一件"要出门"的事之前必须过这道（与 `requireNetworkConsent` 同一形状）。
 *
 * 返回 `false` 时调用方什么都不该做。
 *
 * ⚠️ 只在**真的要补签**时才弹：`checking`（还在问）也返回 `false`，但那时弹一个
 * 可能永远不消失的面板是错的 —— 拦下就好，答案回来由上面那个订阅者决定要不要弹。
 */
export function requireLegalReconfirm(): boolean {
  if (legalRecheck.dataEgressAllowed()) return true;
  if (legalRecheck.shouldShowSheet()) {
    useLegalReconfirmStore.getState().openSheet('required-for-action');
  }
  return false;
}
