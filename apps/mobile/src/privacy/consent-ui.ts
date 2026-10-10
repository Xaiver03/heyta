/**
 * 隐私同意面板的状态（移动端外壳）—— 与 web 的 `features/privacy/store.ts` 同形
 * ===========================================================================
 *
 * 这里只管**界面上的三件事**：面板开不开、为什么开、这次决定有没有被设备记住。
 * 判定与持久化在 `consent-gate.ts`（再往上是 `@heyta/app-host`），
 * 所以这个 store **不**存"同意了吗" —— 存了就是第二份事实源，
 * 而两份事实源迟早会给出不同答案（AGENTS.md §3.5 记过两次同形状的事故）。
 *
 * 🔴 为什么不用 `useState` 放在 `App.tsx` 里：面板要能**从两个地方**被打开
 * （首启时 `App` 自己开、用户在「我的」点同步而闸门关着时由同步那条路开）。
 * 跨组件传递一份状态又要避免第二个所有者，`useSyncExternalStore` 是
 * 本壳已有的做法（`sync/store.ts` 同一个形状），不为此引状态库。
 */

import { useSyncExternalStore } from 'react';

import { privacyConsent, privacyConsentActions } from './consent-gate';

/**
 * 面板被打开的原因：设置中的主动重选不冒充已撤回同意。
 *
 *   · `first-launch`        —— 还没问过（G-11）。唯一必须**主动**弹的一种。
 *   · `revoked`             —— 刚从设置页撤回，用户要重新选一次。
 *   · `required-for-action` —— 用户点了某个要出门的按钮（同步 / 登录），
 *     而闸门是关的。这时不能只把状态改成"失败"了事 —— 他得有一条走出去的路。
 */
export type PrivacySheetReason = 'first-launch' | 'revoked' | 'required-for-action' | 'settings';

interface PrivacyUiState {
  open: boolean;
  reason: PrivacySheetReason;
  /** 决定**没能落盘**（数据库不可用 / 写失败）。界面必须把这句说出来。 */
  notPersisted: boolean;
}

let state: PrivacyUiState = { open: false, reason: 'first-launch', notPersisted: false };

const listeners = new Set<() => void>();

function set(patch: Partial<PrivacyUiState>): void {
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
 * 🔴 这不是"为了测试另开一条路"：它就是下面那个 hook 交给
 * `useSyncExternalStore` 的 `getSnapshot`，所以它返回的就是界面正在显示的那一份。
 * 单独导出的理由是：本壳没有 RN 组件渲染测试栈，而"决定没落盘时面板不许静默收起"
 * 「关闭不等于同意」这两条是**有法律含义**的行为判据，必须有个归宿 ——
 * 在没有渲染树的进程里直接调 hook 只会得到 `Invalid hook call`。
 */
export function privacySheetState(): PrivacyUiState {
  return state;
}

export function usePrivacySheet(): PrivacyUiState {
  return useSyncExternalStore(subscribe, privacySheetState);
}

export function openPrivacySheet(reason: PrivacySheetReason): void {
  // 🔴 同时清掉 `notPersisted`：那是**上一次**决定的落盘结果。
  // 不清的话，"上次没记住"这句话会跟着每一次重新打开的面板。
  set({ open: true, reason, notPersisted: false });
}

export function closePrivacySheet(): void {
  set({ open: false });
}

/**
 * 用户点「同意并联网」。
 *
 * 🔴 同意之后**不**在这里补跑启动动作（自动同步、实时通道）。那些由
 * `sync/auto-sync.ts` 的订阅者负责 —— 面板不是唯一能改变决定的地方
 * （设置页撤回也能），把补跑写在面板里就等于"从设置页同意时没人补跑"。
 *
 * 🔴 没能落盘时**不收起面板**：这句警告必须出现在用户正看着的这一块上。
 * 收起来它就只躺在设置页里（而用户不会为这件事去翻设置）。
 */
export function acceptNetworkConsent(): void {
  const { persisted } = privacyConsentActions.accept();
  set(persisted ? { open: false, notPersisted: false } : { open: true, notPersisted: true });
}

/** 用户点「只用本机」。同样不许在没落盘时静默收起。 */
export function chooseLocalOnly(): void {
  const { persisted } = privacyConsentActions.localOnly();
  set(persisted ? { open: false, notPersisted: false } : { open: true, notPersisted: true });
}

/** 落盘失败时，用户看完那句警告之后把面板收起来。 */
export function acknowledgeNotPersisted(): void {
  set({ open: false, notPersisted: false });
}

/**
 * 🔴 用户主动发起一件"要出门"的事之前，**必须**过这一道。
 *
 * 返回 `false` 时调用方**什么都不该做**（面板已经替他打开了）。
 *
 * 为什么不让各处自己判 `privacyConsent.networkAllowed()`：那样每个调用点都要自己
 * 回答"拦下之后给用户什么"，而其中一定会有人只 `return` —— 于是症状是
 * 「点了同步没反应」，这在本仓库是被反复记过的那一类静默失效。
 */
export function requireNetworkConsent(): boolean {
  if (privacyConsent.networkAllowed()) return true;
  openPrivacySheet('required-for-action');
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

/** 仅供测试。 */
export function __resetPrivacySheetForTests(): void {
  state = { open: false, reason: 'first-launch', notPersisted: false };
  listeners.clear();
}
