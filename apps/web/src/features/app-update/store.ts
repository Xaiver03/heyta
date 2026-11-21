import { create } from 'zustand';

/**
 * 应用更新提示的本机状态（web）。
 * ================================
 *
 * 只放「当前这一屏要画哪一种提示」——**判定不在 store 里**：该不该弹、弹可选还是强制，
 * 由服务端给的 `updateAvailable` / `forceUpdate` 经 `@heyta/app-host` 的
 * `decideAppUpdatePrompt` 决定（见 `features/app-update/detect.ts`）。
 *
 * `prompt` 三态：`none` / `optional`（可关）/ `force`（不可关，没有 dismiss）。
 */
export type AppUpdatePromptState = 'none' | 'optional' | 'force';

export interface AppUpdateState {
  prompt: AppUpdatePromptState;
  /** 需要提示的目标版本；空串表示"有新构建但不带具体版本号"（如 SW 静默更新）。 */
  latestVersion: string;
  setPrompt: (next: { prompt: AppUpdatePromptState; latestVersion: string }) => void;
  /** 关掉可选提示（强制提示没有关掉的入口）。 */
  dismiss: () => void;
}

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  prompt: 'none',
  latestVersion: '',
  setPrompt: (next) => set({ prompt: next.prompt, latestVersion: next.latestVersion }),
  dismiss: () => set({ prompt: 'none' }),
}));
