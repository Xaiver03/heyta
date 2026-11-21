/**
 * 移动端更新的**纯运行体**（不 import react-native，可单测）。
 * ==========================================================
 *
 * 判定在 `@heyta/app-host`（`checkAppUpdate` / `decideAppUpdatePrompt`）；这里只做
 * 「平台映射 + 查一次」。原生弹窗/跳店在 `app-update.ts`（要 react-native）。
 *
 * 本机版本用 `HEYTA_APP_VERSION`（根 package.json 的生成常量）—— 与同步客户端上报给
 * 服务端的 `appVersion` 是**同一个数**，不另造一份、也不需要原生桥读 Info.plist。
 */

import { checkAppUpdate, decideAppUpdatePrompt } from '@heyta/app-host';

/** RN 的 `Platform.OS` → 契约里的端标识。不认识的平台返回 null（不查）。 */
export function platformForOs(os: string): 'ios' | 'android' | 'harmony' | null {
  if (os === 'ios') return 'ios';
  if (os === 'android') return 'android';
  if (os === 'harmony' || os === 'harmonyos' || os === 'ohos') return 'harmony';
  return null;
}

export type MobileUpdatePrompt = 'none' | 'optional' | 'force';

export interface MobileUpdateOutcome {
  prompt: MobileUpdatePrompt;
  latestVersion: string;
  downloadUrl: string;
}

export interface MobileUpdatePorts {
  serverUrl: string;
  platform: 'ios' | 'android' | 'harmony';
  currentVersion: string;
  fetchImpl: typeof fetch;
  deviceId?: string;
  log?: (message: string) => void;
}

/**
 * 查一次并给出该弹哪一种。空 serverUrl ⇒ 不查 ⇒ none（未登录/未配置服务端）。
 * 任何失败都收成 none —— 更新检查失败绝不弹窗打扰。
 */
export async function runMobileUpdateCheck(ports: MobileUpdatePorts): Promise<MobileUpdateOutcome> {
  if (ports.serverUrl.trim() === '') return { prompt: 'none', latestVersion: '', downloadUrl: '' };
  const result = await checkAppUpdate({
    baseUrl: ports.serverUrl.trim(),
    platform: ports.platform,
    channel: 'stable',
    currentVersion: ports.currentVersion,
    deviceId: ports.deviceId,
    fetchImpl: ports.fetchImpl,
    log: ports.log,
  });
  if (result.kind !== 'ok') return { prompt: 'none', latestVersion: '', downloadUrl: '' };
  const prompt = decideAppUpdatePrompt(result.info, undefined);
  return {
    prompt,
    latestVersion: result.info.latestVersion,
    downloadUrl: result.info.downloadUrl,
  };
}
