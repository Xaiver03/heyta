/**
 * 补签面板的状态（移动端外壳，G-27）—— 与 web 的 `features/legal-recheck/store.ts` 同形
 * ================================================================================
 *
 * 只管**界面上的三件事**：面板开不开、为什么开、这一次提交在不在途中。
 * 判定与出站闸门全在 `gate.ts`（再往上是 `@heyta/app-host`），所以这里**不存**
 * "要不要补签"，也不存版本号 —— 存了就是第二份事实源，而两份事实源迟早给出不同答案
 * （同 `privacy/consent-ui.ts` 文件头那条纪律）。
 *
 * 🔴 唯一被存下来的**服务端派生值**是 `serverUrl`，而且它是"打开那一刻的快照"，
 * 不是第二份事实源：面板上的条款链接必须指向**作出那次裁决的那台服务端**，
 * 而移动端的地址是逐键写进活配置的。用户正读着 A 家的条款时，
 * 让面板跟着别处的写入换成 B 家的链接，等于把确认交给了另一家。
 *
 * ## 为什么这里没有「只用本机」那第二个同等动作
 *
 * 隐私面板必须给两条同等可达的路，因为"不同意"是一个合法决定（PIPL 第 16 条）；
 * 而"文本更新了要不要重新确认"不是一个可以选择同意的方向 —— 它是
 * `packages/legal` 那句已经对外说出去的话（服务条款 s10）在要求一次动作。
 * 这里摆一个「不同意」，要么它什么都不做（骗人的按钮），
 * 要么它把用户永久锁在用不了的账号上（《认定方法》点名的"不同意即无法使用"）。
 * 所以：**一个肯定动作 + 一条明确的「稍后再说」**。
 */

import { useSyncExternalStore } from 'react';

import { legalRecheck } from './gate';
import { readSyncConfig } from '../sync/config';

/**
 * 面板为什么开。两种要说**不同的话**：
 *
 *   · `asked` —— 保存凭据/登录后问出来"要补签"。这一种不需要解释"为什么现在弹"。
 *   · `required-for-action` —— 用户点了同步，而闸门拦着。他只该看到状态栏变了字的话，
 *     就找不到出路（与隐私面板同一条理由）。
 */
export type LegalReconfirmSheetReason = 'asked' | 'required-for-action';

interface LegalReconfirmUiState {
  open: boolean;
  reason: LegalReconfirmSheetReason;
  /** 提交在途。按钮要禁用并显示"正在记下"，否则用户会连点。 */
  submitting: boolean;
  /** 打开那一刻的服务端地址（见文件头那条快照理由）。空串 = 未配置 ⇒ 不显示链接。 */
  serverUrl: string;
}

let state: LegalReconfirmUiState = {
  open: false,
  reason: 'asked',
  submitting: false,
  serverUrl: '',
};

const listeners = new Set<() => void>();

function set(patch: Partial<LegalReconfirmUiState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 当前界面状态的**只读快照**。
 *
 * 🔴 与 `privacySheetState()` 同一条理由：本壳没有 RN 组件渲染测试栈，
 * 而「稍后再说**不放开闸门**」「确认失败不许静默收起」这两条是有法律含义的行为判据，
 * 必须有个归宿 —— 在没有渲染树的进程里调 hook 只会得到 `Invalid hook call`。
 */
export function legalReconfirmSheetState(): LegalReconfirmUiState {
  return state;
}

export function useLegalReconfirmSheet(): LegalReconfirmUiState {
  return useSyncExternalStore(subscribe, legalReconfirmSheetState);
}

export function openLegalReconfirmSheet(reason: LegalReconfirmSheetReason): void {
  set({ open: true, reason, serverUrl: readSyncConfig()?.serverUrl ?? '' });
}

/**
 * 「稍后再说（继续不同步）」：**只收起面板，绝不放开闸门**。
 *
 * 🔴 这里最容易写错的一处 —— "面板没了"的直觉实现很容易被写成"当没这回事"。
 * 收起来之后 `legalRecheck.dataEgressAllowed()` 必须**仍然**是 `false`，
 * 而那正是按钮上那句"继续不同步"的内容。推迟不是拒绝：下一次启动与下一次登录
 * 都会重新问一遍，它不会被"点掉"就消失。
 */
export function deferLegalReconfirm(): void {
  set({ open: false });
}

/**
 * 用户点「我已读完并确认」。真正的请求与状态迁移都在闸门里，这里只管在途标记。
 *
 * ⚠️ 重入直接返回：连点会打两次 POST，而第二次的 `documentVersion`
 * 可能已经不是界面所展示的那一版了。
 */
export async function confirmLegalReconfirm(): Promise<void> {
  if (state.submitting) return;
  set({ submitting: true });
  try {
    await legalRecheck.confirm();
  } finally {
    // 🔴 失败时**不收起面板**：闸门仍然拦着，而那句"没有提交成功"必须出现在
    // 用户正看着的这一块上。收起来就等于"点了没反应" —— 本仓库记过最多次的一类缺陷。
    set({ submitting: false, open: legalRecheck.shouldShowSheet() });
  }
}

/**
 * 🔴 用户主动发起一件"要出门"的事之前必须过这道（与 `requireNetworkConsent` 同一形状）。
 *
 * 返回 `false` 时调用方什么都不该做。
 *
 * ⚠️ 只在**真的要补签**时才弹：`checking`（还在问）也返回 `false`，但那时弹一个
 * 可能永远不消失的面板是错的 —— 拦下就好，答案回来由下面那个订阅者决定要不要弹。
 */
export function requireLegalReconfirm(): boolean {
  if (legalRecheck.dataEgressAllowed()) return true;
  if (legalRecheck.shouldShowSheet()) {
    // 直接写 `required-for-action`：**这条路径就是用户自己撞上的**，
    // 面板原来是 `asked` 也要升级 —— 不升级的话，那句"为什么现在弹"在他眼前不换内容，
    // 而他刚刚做的事正是"点同步"。反过来（订阅者里）才要保住这个值不被后台重问改回去。
    openLegalReconfirmSheet('required-for-action');
  }
  return false;
}

/**
 * 问出来"要补签"就开面板；状态一变（确认完成 / 登出 / 改版）就收。
 *
 * ⚠️ 订阅放在界面这一侧而不是闸门里：闸门（`@heyta/app-host`）不许知道有没有界面 ——
 * node-host 与验证壳没有界面，那里只该有拦、不该有弹。
 */
legalRecheck.subscribe(() => {
  if (legalRecheck.shouldShowSheet()) {
    openLegalReconfirmSheet(
      state.open && state.reason === 'required-for-action' ? state.reason : 'asked',
    );
    return;
  }
  if (state.open) deferLegalReconfirm();
});

/** 仅供测试。不清闸门的订阅（那是 `legalRecheck` 自己的生命周期）。 */
export function __resetLegalReconfirmSheetForTests(): void {
  state = { open: false, reason: 'asked', submitting: false, serverUrl: '' };
  listeners.clear();
}
