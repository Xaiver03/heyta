/**
 * 自动更新：客户端的**检查核心**（宿主无关）。
 * ============================================
 *
 * 判断「要不要更新」**不在这里算** —— 服务端算好 `updateAvailable` / `forceUpdate` 两个布尔
 * （`GET /api/app-version`，见 `server/src/app-version/policy.ts` 与
 * `docs/plans/app-auto-update.md`）。本文件只做三件宿主无关的事：
 *
 *   1. 拼请求 URL、发请求、按契约 schema 校验响应（`checkAppUpdate`）；
 *   2. 把「两个布尔 + 本机上次提示过的版本」翻译成一次**该不该弹、弹哪一种**（`decideAppUpdatePrompt`）；
 *   3. 提供统一的检查时机常量（延迟启动 / 定时 6 小时）。
 *
 * ## 🔴 为什么不自己比版本大小
 *
 * 客户端一旦自己比，就会有人用字符串比较，`"1.2.10" < "1.2.9"` 于是永远检测不到更新。
 * 这里**只读标志**，把「比大小」这件事关在服务端一处。
 *
 * ## 🔴 「同一版本不重复打扰」
 *
 * 可选更新：`latestVersion` 与上次提示过的版本相同就不再弹（除非升级为强制）。
 * 强制更新：**永不因「已提示过」被抑制** —— 它就是要每次拦。
 *
 * 各宿主把「上次提示过的版本」存在自己的持久层（web 用 localStorage），本文件不碰存储：
 * 存储是宿主差异，判定是共享语义。
 */

import {
  APP_VERSION_PATHS,
  appVersionResponseSchema,
  type AppUpdatePlatform,
  type AppVersionResponse,
} from '@heyta/shared-schema';

import { joinEndpointUrl } from './endpoint-url.js';

/** 启动后延迟检查，避开首屏阻塞。 */
export const APP_UPDATE_START_DELAY_MS = 15_000;
/** 定时检查间隔。 */
export const APP_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface AppUpdateCheckInput {
  /** 服务端根地址（空串 = 同源，拼出相对路径 `/api/app-version`）。 */
  baseUrl: string;
  platform: AppUpdatePlatform;
  channel?: string;
  /** 本机当前版本（各宿主注入：web=HEYTA_APP_VERSION，桌面=app.getVersion，移动=原生版本）。 */
  currentVersion: string;
  currentBuild?: number;
  /** 稳定设备标识，仅用于灰度分桶。 */
  deviceId?: string;
  fetchImpl: typeof fetch;
  log?: (message: string) => void;
}

export type AppUpdateCheckResult =
  | { readonly kind: 'ok'; readonly info: AppVersionResponse }
  | { readonly kind: 'failed'; readonly reason: string };

/** 拼接版本检查请求 URL（独立成函数，便于单测覆盖 baseUrl 的几种填法）。 */
export function buildAppVersionUrl(input: {
  baseUrl: string;
  platform: AppUpdatePlatform;
  channel?: string;
  currentVersion: string;
  currentBuild?: number;
  deviceId?: string;
}): string {
  const params = new URLSearchParams({
    platform: input.platform,
    channel: input.channel ?? 'stable',
    currentVersion: input.currentVersion,
  });
  if (input.currentBuild != null) params.set('currentBuild', String(input.currentBuild));
  if (input.deviceId) params.set('deviceId', input.deviceId);
  return joinEndpointUrl(input.baseUrl, `/api/${APP_VERSION_PATHS.public}?${params.toString()}`);
}

/**
 * 发一次检查。**不抛**：网络/形状问题都收成一个 `failed` —— 更新检查失败绝不能
 * 拖垮应用（它是增强，不是功能前提），但也不能静默（落 `log`）。
 */
export async function checkAppUpdate(input: AppUpdateCheckInput): Promise<AppUpdateCheckResult> {
  const url = buildAppVersionUrl(input);
  let raw: Response;
  try {
    raw = await input.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    input.log?.(`app update check failed: ${reason}`);
    return { kind: 'failed', reason };
  }

  if (!raw.ok) {
    input.log?.(`app update check http ${raw.status}`);
    return { kind: 'failed', reason: `http ${raw.status}` };
  }

  let json: unknown;
  try {
    json = await raw.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    input.log?.(`app update check bad json: ${reason}`);
    return { kind: 'failed', reason };
  }

  const parsed = appVersionResponseSchema.safeParse(json);
  if (!parsed.success) {
    // 形状不对 ⇒ 当成失败，而不是"没有更新"：把坏响应当成最新版本会静默吞掉一次更新。
    input.log?.('app update check response did not match contract');
    return { kind: 'failed', reason: 'schema mismatch' };
  }

  return { kind: 'ok', info: parsed.data };
}

export type AppUpdatePrompt = 'none' | 'optional' | 'force';

/**
 * 该不该弹、弹哪一种。纯函数，输入只有服务端给的信息 + 本机上次提示过的版本。
 *
 * - 服务端说没更新 ⇒ `none`。
 * - 强制 ⇒ `force`（**不看**上次提示过没有）。
 * - 可选 ⇒ 与上次提示过的版本相同则 `none`（不重复打扰），否则 `optional`。
 */
export function decideAppUpdatePrompt(
  info: AppVersionResponse,
  lastPromptedVersion?: string | null,
): AppUpdatePrompt {
  if (!info.updateAvailable) return 'none';
  if (info.forceUpdate) return 'force';
  if (lastPromptedVersion != null && lastPromptedVersion === info.latestVersion) return 'none';
  return 'optional';
}
