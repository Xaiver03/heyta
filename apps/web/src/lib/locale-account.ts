/**
 * 登录态下把界面语言写回账号（应用语言解析链第 2 层的**写侧**，读侧在
 * `applyAuthSession` 的采纳逻辑与登录响应的 `user.locale`）。
 *
 * 由语言切换器调用，**fire-and-forget**：失败只 warn，不影响本机语言已切换 ——
 * 账号语言只影响「下一次登录 / 下一封邮件」，不是本机状态的事实源。
 * 未登录 / 未配置同步时静默跳过（没有令牌可带，也没有账号可写）。
 */

import { updateAccountLocale } from '@heyta/app-host';
import type { Locale } from '@heyta/i18n';

import { useSyncStore } from '../features/sync/store.js';

export async function pushLocaleToAccount(locale: Locale): Promise<void> {
  const { baseUrl, token } = useSyncStore.getState();
  if (baseUrl === '' || token === undefined) return;

  const outcome = await updateAccountLocale({ baseUrl }, token, locale);
  if (!outcome.ok) {
    console.warn('[heyta] 账号语言写回失败（不影响本机已切换的语言）', outcome.reason);
  }
}
