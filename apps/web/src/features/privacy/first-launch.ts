/**
 * 「这台设备首启必须问过用户」的唯一实现（G-11）。
 *
 * ## 为什么抽出来
 *
 * 这条判断原本是 `App.tsx` 挂载 effect 里的一行。管理后台页 `/admin` 现在走
 * **独立启动路径**（ADR-0078：不初始化本地 op-log，也就不经过 `App()`）——
 * 而它同样挂着 `PrivacyConsentSheet`。如果这里只留在 `App()` 里，后台页会
 * 在未同意时永远停在「正在加载…」（`useNetworkAllowed` 恒假），而那句话
 * 读起来像"服务器连不上"，是一句谎。
 *
 * ## 判据
 *
 * 判据是"这台设备从没作过决定"，不是"今天第一次打开"：
 *   · 点过「同意」的人不该再被打扰；
 *   · 点过「只用本机」的人**也是作过决定**（那是一条完整的产品选择），同样不再弹；
 *   · 撤回之后状态被清回"没问过"，下一次冷启动会重新问 —— 这是 `revoke()` 的
 *     预期后果（PIPL 第 15 条要求撤回后还能重新给一次选择的机会）。
 *
 * ⚠️ 幂等：`StrictMode` 下 effect 会跑两遍，`openSheet` 只是把同一个 `open: true`
 * 写进去，不会叠两层浮层。
 */
import { shouldAskOnFirstLaunch, usePrivacyStore } from './store.js';

export function armFirstLaunchConsent(): void {
  if (shouldAskOnFirstLaunch()) usePrivacyStore.getState().openSheet('first-launch');
}
