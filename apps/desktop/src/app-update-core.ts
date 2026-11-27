/**
 * 桌面更新的**纯运行体**（不 import electron，可单测）。
 * ======================================================
 *
 * 真正"查一次 + 决定弹哪一种"的逻辑放这里；弹原生对话框 / 打开浏览器那两步在
 * `app-update.ts`（要 electron）。分开的唯一理由是**可测**：测试不该为了验一个
 * 提示判定就去拉起 electron。
 */

import { checkAppUpdate, decideAppUpdatePrompt } from '@heyta/node-host';

/** 更新检查要问的发布服务器（env 配置）。空串 = 不查。 */
export function resolveUpdateBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HEYTA_UPDATE_BASE_URL ?? '').trim();
}

export type DesktopUpdatePrompt = 'none' | 'optional' | 'force';

export interface DesktopUpdateOutcome {
  prompt: DesktopUpdatePrompt;
  latestVersion: string;
  downloadUrl: string;
}

export interface DesktopUpdatePorts {
  baseUrl: string;
  currentVersion: string;
  fetchImpl: typeof fetch;
  log?: (message: string) => void;
}

/**
 * 查一次并给出该弹哪一种。空 baseUrl ⇒ **不查** ⇒ none（自托管/开发形态）。
 * 任何失败（离线 / 非 2xx / 形状不对）都收成 none —— 更新检查失败绝不能弹框打扰。
 */
export async function runDesktopUpdateCheck(ports: DesktopUpdatePorts): Promise<DesktopUpdateOutcome> {
  if (ports.baseUrl === '') return { prompt: 'none', latestVersion: '', downloadUrl: '' };
  const result = await checkAppUpdate({
    baseUrl: ports.baseUrl,
    platform: 'desktop',
    channel: 'stable',
    currentVersion: ports.currentVersion,
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
