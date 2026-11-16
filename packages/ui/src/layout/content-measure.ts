/**
 * 内容的**可读宽度**与**按钮宽度**策略 —— 一套规则，三端共用。
 *
 * ## 为什么要有这一层
 *
 * 2026-11-16（iPad 真机）：大屏上「单列内容一路拉到屏幕边」与「按钮被容器拉满整行」
 * 两个问题反复出现在各屏。它们不是某一屏的排版失误，是**缺少一条产品级规则** ——
 * 每端/每屏各凭手感决定，于是同一件事有了 N 个答案。
 *
 * 权威口径：
 *   · Apple HIG · Layout（iOS）明文「Avoid full-width buttons」；
 *     iPadOS 要求「按常见系统尺寸测试布局，缩放时尽量晚退化成紧凑」。
 *   · 单列文本/表单的**可读宽度**应有上限（HIG「给足空间」；web 端 `--ht-layout-prose-max`
 *     用 `65ch` 表达同一件事）。
 *
 * ## 两条规则
 *
 * 1. **内容宽度**按**外壳档**（`chrome`）推导：
 *    - `page`（表单 / 设置 / 阅读 / 列表）→ 收窄到 `CONTENT_MEASURE_MAX` 并居中；
 *    - `board` / `immersive`（看板 / 日历 / 全屏消费）→ **铺满**（HIG「让内容铺满屏幕/窗口」）。
 *    与 `form-factor.ts` 同一条纪律：**共享层给规则，各端只报尺寸 / 消费常量**。
 *
 * 2. **按钮宽度**：默认 **intrinsic（不撑满）**，只有「单一主操作 CTA」显式开 `fullWidth`。
 *    判据见 `buttonStretchesByDefault()` —— 它给三端一个共同的默认答案，而不是各端自己猜。
 */

/**
 * 单列内容的可读宽度上限（dp / px）。
 *
 * 680 ≈ 手机竖屏宽度的 1.9 倍：表单/设置/阅读放在 iPad（820–1366dp）上仍然"一行不会太长"，
 * 又不至于窄到和手机一样。取"两种尺度都成立"的下限而不是贴着某个设备写死。
 */
export const CONTENT_MEASURE_MAX = 680;

/** 屏幕外壳档（与 `docs/agents/screen-chrome.md` 的三档一致）。 */
export type ScreenChrome = 'page' | 'board' | 'immersive';

/**
 * 这一个外壳档下，内容列是否要收窄居中。
 *
 * 返回 `undefined` = **铺满**（看板 / 全屏消费）；返回数字 = 收窄到该宽度并居中（内容页）。
 */
export function contentMeasureMaxFor(chrome: ScreenChrome): number | undefined {
  return chrome === 'page' ? CONTENT_MEASURE_MAX : undefined;
}

/**
 * 按钮是否**默认**撑满父容器宽度。
 *
 * 🔴 默认 `false`（HIG「避免全宽按钮」）。只有「单一主操作 + 强引导」的 CTA
 * 才允许在调用点显式开 `fullWidth`（登录、提交、空状态主按钮这类）。
 * 三端共用这一个默认答案 —— 别在某一端悄悄又拉满。
 */
export function buttonStretchesByDefault(): boolean {
  return false;
}
