/**
 * 隐私同意面板的状态（web 外壳）
 * ==============================
 *
 * 这里只管**界面上的三件事**：面板开不开、为什么开、这次决定有没有被设备记住。
 * 判定与持久化全在 `features/privacy/consent-gate.ts`（再往上是 `@heyta/app-host`），
 * 所以这个 store **不**存"同意了吗"—— 存了就是第二份事实源，
 * 而两份事实源迟早会给出不同答案（AGENTS.md §3.5 记过两次同形状的事故）。
 */

import { create } from 'zustand';

import { privacyConsent, privacyConsentActions } from './consent-gate.js';

/**
 * 面板被打开的原因：设置中的主动重选不冒充已撤回同意。
 *
 *   · `first-launch`    —— 还没问过（G-11）。这是唯一必须**主动**弹的一种。
 *   · `revoked`         —— 刚从设置页撤回，用户要重新选一次。
 *   · `required-for-action` —— 用户点了某个要出门的按钮（同步 / 登录 / 拉收件箱），
 *     而闸门是关的。这时不能只把状态改成"失败"了事 —— 他得有一条走出去的路。
 */
export type PrivacySheetReason = 'first-launch' | 'revoked' | 'required-for-action' | 'settings';

interface PrivacyStoreState {
  open: boolean;
  reason: PrivacySheetReason;
  /** 决定**没能落盘**（隐私模式 / 配额满）。界面必须把这句说出来，不许静默假装成功。 */
  notPersisted: boolean;
  openSheet(reason: PrivacySheetReason): void;
  closeSheet(): void;
  /** 用户点「同意并联网」。 */
  accept(): void;
  /** 用户点「只用本机」。 */
  chooseLocalOnly(): void;
  /** 落盘失败时，用户在看过那句警告之后把面板收起来。 */
  acknowledgeNotPersisted(): void;
}

export const usePrivacyStore = create<PrivacyStoreState>((set) => ({
  open: false,
  reason: 'first-launch',
  notPersisted: false,

  openSheet: (reason) => {
    // 🔴 同时清掉 `notPersisted`：那是**上一次**决定的落盘结果。
    // 不清的话，"上次没记住"这句话会跟着每一次重新打开的面板，
    // 而这一次可能根本是另一个决定（甚至还没作决定）。
    set({ open: true, reason, notPersisted: false });
  },
  closeSheet: () => {
    set({ open: false });
  },

  accept: () => {
    const { persisted } = privacyConsentActions.accept();
    // 🔴 同意之后**不**在这里补启动动作（注册 SW、连实时、采用待消费的登录）。
    // 那些由 `main.tsx` 的订阅者负责 —— 面板不是唯一能改变决定的地方（设置页也能），
    // 把补跑写在面板里就等于"从设置页同意时没人补跑"。
    //
    // 🔴 没能落盘时**不收起面板**：这句警告必须出现在用户正看着的这一块上。
    // 收起来它就只躺在设置页里（而用户不会为这件事去翻设置）——
    // 词条注释里那句"这句必须能在界面上出现"此前**并没有被满足**，
    // 症状是隐私模式下点了同意、界面毫无反应地关掉，下次启动又问一遍。
    set(persisted ? { open: false, notPersisted: false } : { open: true, notPersisted: true });
  },

  chooseLocalOnly: () => {
    const { persisted } = privacyConsentActions.localOnly();
    set(persisted ? { open: false, notPersisted: false } : { open: true, notPersisted: true });
  },

  acknowledgeNotPersisted: () => {
    set({ open: false, notPersisted: false });
  },
}));

/**
 * 🔴 用户主动发起一件"要出门"的事之前，**必须**过这一道。
 *
 * 返回 `false` 时调用方**什么都不该做**（面板已经替他打开了）。
 *
 * 为什么不让各处自己判 `privacyConsent.networkAllowed()`：那样每个调用点都要自己
 * 回答"拦下之后给用户什么"，而其中一定会有人只 return —— 于是症状是
 * 「点了同步没反应」，而这在本仓库是被反复记过的那一类静默失效。
 */
export function requireNetworkConsent(): boolean {
  if (privacyConsent.networkAllowed()) return true;
  usePrivacyStore.getState().openSheet('required-for-action');
  return false;
}

/**
 * 启动时该不该弹首启面板（G-11 的判据）。
 *
 * ⚠️ 只看 `undecided()`，**不看** `networkAllowed()`：明确选过「只用本机」的人
 * 不该每次刷新都被问一遍 —— 那会把"我们尊重你的决定"变成"我们其实不在乎"。
 */
export function shouldAskOnFirstLaunch(): boolean {
  return privacyConsent.undecided();
}
