/**
 * 应用更新检测在 web 的接线。
 * ==============================
 *
 * 判断（要不要更新、弹哪一种）**都不在这里**：请求与契约校验在 `@heyta/app-host` 的
 * `checkAppUpdate`，"该不该弹"在 `decideAppUpdatePrompt`。本文件只回答 web 的两件事：
 *
 * 1. **什么时候查**：启动后延迟一次 + 每 6 小时一次 + 回前台一次 +
 *    新 service worker 接管（`heyta:sw-update-ready`）时立刻查。避开首屏阻塞。
 * 2. **查到了怎么让人知道**：把结果写进 `useAppUpdateStore`，由 `AppUpdateNotice` 画出来。
 *
 * ## 🔴 为什么用版本接口，而不是只靠 SW
 *
 * 这个应用的 service worker 只拦小组件数据请求，**不缓存应用资源**（见 `pwa/sw.ts` 的
 * fetch 处理器）—— 所以"刷新就拿到新构建"是成立的，不会有 stale chunk。但 SW 的
 * `updatefound` 只在**新构建部署**时响，缺失"版本号 + 跳过灰度 + 读服务端底线"这层语义。
 * 所以两路都要：SW 接管给一次"立刻刷新"的提示，版本接口给带版本的、按灰度/强制判定过的提示。
 *
 * ## 匿名 + 同意闸门
 *
 * 版本接口匿名，但这仍是一次"这台应用会不会跟服务端说话"（G-12），所以：
 * 闸门没放行时**一个请求都不发**，走 `consentFetch`。
 */

import {
  APP_UPDATE_INTERVAL_MS,
  APP_UPDATE_START_DELAY_MS,
  checkAppUpdate,
  decideAppUpdatePrompt,
  HEYTA_APP_VERSION,
} from '@heyta/app-host';

import { consentFetch, privacyConsent } from '../privacy/consent-gate.js';
import { useSyncStore } from '../sync/store.js';
import { useAppUpdateStore } from './store.js';

const LAST_PROMPTED_KEY = 'heyta.update.lastPromptedVersion';
const DEVICE_ID_KEY = 'heyta.update.deviceId';
/** 新 SW 接管的页面事件（由 `pwa/register.ts` 派发）。 */
export const SW_UPDATE_READY_EVENT = 'heyta:sw-update-ready';

let started = false;
let startTimer: ReturnType<typeof setTimeout> | undefined;
let intervalTimer: ReturnType<typeof setInterval> | undefined;
let onVisible: (() => void) | undefined;
let onSwReady: (() => void) | undefined;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage 被禁/配额满：不影响更新检测，只是"不重复打扰"记不住 —— 可接受。
  }
}

/** 稳定设备标识（只用于灰度分桶；落 localStorage，一次生成后不变）。 */
function stableDeviceId(): string {
  const existing = readLocal(DEVICE_ID_KEY);
  if (existing !== null && existing !== '') return existing;
  const generated = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  writeLocal(DEVICE_ID_KEY, generated);
  return generated;
}

async function runCheck(): Promise<void> {
  if (!privacyConsent.networkAllowed()) return;
  const result = await checkAppUpdate({
    baseUrl: useSyncStore.getState().baseUrl,
    platform: 'web',
    channel: 'stable',
    currentVersion: HEYTA_APP_VERSION,
    deviceId: stableDeviceId(),
    fetchImpl: consentFetch,
    log: (message) => console.warn(`[app-update] ${message}`),
  });
  if (result.kind !== 'ok') return;

  const lastPrompted = readLocal(LAST_PROMPTED_KEY);
  const prompt = decideAppUpdatePrompt(result.info, lastPrompted);
  if (prompt === 'none') return;

  useAppUpdateStore
    .getState()
    .setPrompt({ prompt, latestVersion: result.info.latestVersion });
  // 记住"已经提示过这个版本"：可选提示不再重复；强制提示仍会照常弹（判定层不看它）。
  writeLocal(LAST_PROMPTED_KEY, result.info.latestVersion);
}

/** 幂等启动。入口在 `main.tsx`，排在 `initOpLog()` 之后、同意闸门装好之后。 */
export function startAppUpdate(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  startTimer = setTimeout(() => {
    void runCheck();
  }, APP_UPDATE_START_DELAY_MS);
  intervalTimer = setInterval(() => {
    void runCheck();
  }, APP_UPDATE_INTERVAL_MS);

  onVisible = (): void => {
    if (!document.hidden) void runCheck();
  };
  document.addEventListener('visibilitychange', onVisible);

  // 新 SW 接管 = 新构建已部署。给一次"刷新即可"的可选提示（不覆盖已有的强制提示）。
  onSwReady = (): void => {
    const state = useAppUpdateStore.getState();
    if (state.prompt === 'none') state.setPrompt({ prompt: 'optional', latestVersion: '' });
  };
  window.addEventListener(SW_UPDATE_READY_EVENT, onSwReady);
}

/** 只为测试与热重载：拆掉订阅与定时器。 */
export function stopAppUpdate(): void {
  if (startTimer !== undefined) clearTimeout(startTimer);
  if (intervalTimer !== undefined) clearInterval(intervalTimer);
  if (onVisible) document.removeEventListener('visibilitychange', onVisible);
  if (onSwReady) window.removeEventListener(SW_UPDATE_READY_EVENT, onSwReady);
  startTimer = undefined;
  intervalTimer = undefined;
  onVisible = undefined;
  onSwReady = undefined;
  started = false;
}

/** 用户点「刷新」：整页重载。SW 已 skipWaiting + claim，重载即拿到新构建资源。 */
export function applyAppUpdate(): void {
  window.location.reload();
}

/** 手动触发一次检查（测试与设置页手动重试用）。 */
export { runCheck as checkAppUpdateNow };
