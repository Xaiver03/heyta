/**
 * 网络闸门现在允许出站请求吗 —— 订阅它，不是读一次。
 * ==============================================
 *
 * 🔴 为什么需要这一格（不是一层"顺手加的加载态"）：
 * `installConsentGatedFetch()` 挡的是整个 `window.fetch`，所以**同意之前**任何
 * 出站读面拿到的都是"这个请求被拒了"，而不是"服务端说没有"。界面若把前者画成
 * 后者，就是在说谎。两个真出现过的形状：
 *
 *   · `/admin` 全新浏览器：探测被闸门挡下 ⇒ 停在「连不上服务器，请检查网络后重试」，
 *     真话是"你还没同意"；
 *   · 应用顶部那一横条公告：挂载时拉一次被挡 ⇒ `items: []` ⇒ **什么都不画**，
 *     用户答完同意之后也没有人会再拉一次 —— 表现是"这个部署永远不会显示公告"。
 *
 * 所以"要不要挂载 / 要不要拉"必须由一个**会变的值**驱动，而挂载那一次的读数不够。
 * 这也是这里用 `useState` + 订阅、而不是在模块里读一次的原因。
 *
 * ⚠️ 判定本身全在 `@heyta/app-host` 的 `privacyConsent`（AGENTS §3.5：
 * 宿主外壳只订阅结果，不重做"该不该出门"的判断）。
 */
import { useEffect, useState } from 'react';

import { privacyConsent, subscribePrivacyConsent } from './consent-gate.js';

export function useNetworkAllowed(): boolean {
  const [allowed, setAllowed] = useState(() => privacyConsent.networkAllowed());
  useEffect(() => subscribePrivacyConsent(() => setAllowed(privacyConsent.networkAllowed())), []);
  return allowed;
}
