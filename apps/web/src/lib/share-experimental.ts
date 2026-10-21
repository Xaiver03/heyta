/**
 * 共享清单入口的实验开关（Web 端，设备本地）
 * ==========================================
 *
 * ## 为什么入口默认是隐藏的（产品裁决 P-1，见 `docs/plans/collaboration-shared-lists.md` §9.2）
 *
 * 元数据面（同意 → 邀请 → 成员 → 角色 → 转让）今天全链都在，页头上那枚入口也是亮的；
 * 而**内容面还没有交付到界面上**。2026-10-21 的 M1 接上了下行的那条腿
 * （`downloadOps` 有人调了、游标落盘），但成员那边**看不到这条共享任务本身** ——
 * 任务与清单的写路径仍进个人 op-log（`packages/app-host/src/project-actions.ts` 里唯一与
 * share 有关的方法是 `setProjectShareId`，没有分流；那是 M2）。
 * ⇒ 用户能把同事邀请进来、能给角色、能转让，**但两个人互相看不到对方改了什么**。
 *
 * 那不是一个"还没做完的功能"，而是一个**会让用户替我们发现它是假的**的功能 ——
 * 而且发生在他已经把清单交出去之后。所以入口默认不放出来，只留这一条措辞明确的实验开关。
 *
 * 🔴 **翻案条件**（写在这里，是为了让"撤掉隐藏"是一个有判据的动作而不是一个心情）：
 * M1（下行链路接通）+ M2（写路径路由）落地，且**两台独立浏览器上下文互相看得到对方的改动**
 * 验过（`e2e/tests/collab-journey.spec.ts` 扩成双向下行）⇒ 把 `DEFAULT_ENABLED` 翻成 `true`，
 * 同时把 `check:share-entry-hidden` 从钉"默认不可达"改成钉"可达"。
 *
 * ## 为什么是设备本地偏好，不进 op-log
 *
 * 与 `lib/theme.ts`、`features/shell/modules.ts` 同一条推理：这是**这台设备的界面选择**，
 * 不是用户数据。所以它不进 `packages/shared-schema`、不 bump 版本、不跨设备同步。
 *
 * ⚠️ 它刻意**不是** `FEATURE_MODULE_KEYS` 里的一项：那词表是"heyta 有哪几个功能域"，
 * 加了就要 `SHELL_MODULES` 同步一项（`apps/mobile/tests/feature-entries.spec.ts` 判集合相等），
 * 而移动端那条线（M6）今天一段都没接 —— 把一个移动端还没有的域塞进共用词表，
 * 只会让两端在同一张表上各说各话。
 *
 * ## 契约：**永不抛**
 *
 * 与 `theme.ts` 一致 —— 隐私模式下 `localStorage` 会抛，而"读不到偏好"绝不等于"应用起不来"。
 * 读失败退到默认值，写失败静默。
 */

const STORAGE_KEY = 'heyta.share.experimental';

/** 🔴 默认关 —— 这一行就是 P-1 那条产品裁决在代码里的形状，改它=翻案，要按上面的判据。 */
const DEFAULT_ENABLED = false;

export function loadShareExperimentalEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_ENABLED;
    return raw === '1' ? true : raw === '0' ? false : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

/** 写失败静默（与 `theme.ts` 同）：本次会话仍然生效，只是留不下。 */
export function saveShareExperimentalEnabled(enabled: boolean): void {
  try {
    if (enabled === DEFAULT_ENABLED) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 存不上不拦本次生效。
  }
}

/** 供 e2e / 验收在应用启动前直接落盘（不依赖任何界面路径）。 */
export const SHARE_EXPERIMENTAL_STORAGE_KEY = STORAGE_KEY;
