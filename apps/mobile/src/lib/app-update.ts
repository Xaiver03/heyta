/**
 * 移动端（React Native iOS / Android / 鸿蒙）的自动更新检测 —— RN 侧接线。
 * =====================================================================
 *
 * 纯逻辑在 `app-update-core.ts`（可单测）。本文件只放**要 react-native 的两步**：
 * 读 `Platform.OS` 定端、弹 `Alert` 并把「前往更新」交给 `Linking.openURL`。
 *
 * ## 平台硬限制（不承诺做不到的事）
 *
 * - **iOS**：App 不能自更新（审核禁止下载/执行改变功能的代码）—— 只能检测 + 提示 + 跳商店，
 *   强制靠后端底线 + 拦业务入口。这里点击就是 `Linking.openURL(downloadUrl)`（App Store 链接）。
 * - **Android**：可下载 APK 后由系统安装器接管（versionCode 必须单调递增、同签名、
 *   API 26+ 必须用户点安装）；`downloadUrl` 指向 APK 或市场页，`Linking` 打开。
 * - **鸿蒙**：需已上架用 AppGalleryKit；点击同样先跳下载页。不能静默强装。
 *
 * ## 何时查
 *
 * 启动延迟 + 定时；`startMobileUpdateCheck` 幂等（React 严格模式 effect 跑两次也只装一套）。
 */

import { Alert, Linking, Platform } from 'react-native';

import { APP_UPDATE_INTERVAL_MS, APP_UPDATE_START_DELAY_MS, HEYTA_APP_VERSION } from '@heyta/app-host';

import { readSyncConfig } from '../sync/config';
import { platformForOs, runMobileUpdateCheck } from './app-update-core';

export interface MobileUpdateWiringOptions {
  /** 取词（由宿主注入 `t`，保证文案跟着界面语言走）。 */
  getText: (key: string, vars?: Record<string, string>) => string;
  /** 打开下载/商店地址（默认 `Linking.openURL`）。 */
  openUrl?: (url: string) => void;
  fetchImpl?: typeof fetch;
}

/**
 * 启动检查。返回 stop。幂等由调用方（`useEffect` 单次）保证。
 * `serverUrl` 为空（未登录/未配置）时**一个请求都不发**。
 */
export function startMobileUpdateCheck(opts: MobileUpdateWiringOptions): () => void {
  const platform = platformForOs(Platform.OS);
  if (platform === null) return () => {};

  const openUrl = opts.openUrl ?? ((url: string) => void Linking.openURL(url));
  let stopped = false;

  const check = async (): Promise<void> => {
    const config = readSyncConfig();
    if (config === undefined) return;
    try {
      const outcome = await runMobileUpdateCheck({
        serverUrl: config.serverUrl,
        platform,
        currentVersion: HEYTA_APP_VERSION,
        fetchImpl: opts.fetchImpl ?? fetch,
        log: (message) => console.warn(`[app-update] ${message}`),
      });
      if (stopped || outcome.prompt === 'none') return;
      const force = outcome.prompt === 'force';
      const title = opts.getText(force ? 'mobile.appUpdate.forceTitle' : 'mobile.appUpdate.optionalTitle');
      const body = outcome.latestVersion === '' ? '' : opts.getText('mobile.appUpdate.body', { version: outcome.latestVersion });
      const go = (): void => {
        if (outcome.downloadUrl !== '') openUrl(outcome.downloadUrl);
      };
      const buttons = force
        ? [{ text: opts.getText('mobile.appUpdate.download'), onPress: go }]
        : [
            { text: opts.getText('mobile.appUpdate.later'), style: 'cancel' as const },
            { text: opts.getText('mobile.appUpdate.download'), onPress: go },
          ];
      Alert.alert(title, body, buttons, { cancelable: !force });
    } catch (error) {
      console.warn('[app-update] mobile check crashed', error);
    }
  };

  const startTimer = setTimeout(() => void check(), APP_UPDATE_START_DELAY_MS);
  const intervalTimer = setInterval(() => void check(), APP_UPDATE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearTimeout(startTimer);
    clearInterval(intervalTimer);
  };
}
