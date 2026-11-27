/**
 * 移动端主题层：**只剩转发**
 * ==========================
 *
 * 🔴 这个文件曾经是主题的**第二份实现**（2026-09-28 收敛）。
 *
 * 它以前自己调 `resolveNativeTokens` / `resolveAllTextStyles` 建 token 表与文字
 * 样式表，再由 `app.tsx` 的 `UiThemeBridge` 把值回灌给 `HeytaUiProvider` ——
 * 于是同一份主题被解析两遍、`reduceMotionChanged` 被订阅两次，而且两张表
 * 各有一份"谁是权威"的答案。两条都会漂移，且**都不报错**。
 *
 * 现在 token / 文本样式 / 归一化访问器全部由 `@heyta/ui` 提供
 * （它的 `HeytaUiTheme`），这里只做一件事：**把共享层的名字换成移动端一直在用的
 * 名字**（16 个文件 `import … from '../theme'`），好让收敛不用改任何调用点。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 平台差异只剩一件：**这一端可用的字体名**
 *
 * `@heyta/ui` 的 `native.fontSans` 只认登记在 `packagedFonts` 里的真实字体名
 * （见那边 `resolveFontFamily` 与 `DEFAULT_PACKAGED_FONTS` 的说明）。
 *
 * 🔴 2026-11-27：产品要求「全部用苹方」。iOS / macOS 系统自带 `PingFang SC`，所以
 * `App.tsx` 在 **iOS** 上把 `PingFang SC` 登记进清单（`PLATFORM_PACKAGED_FONTS`），
 * 让全部文字（含数字 / 拉丁）显式走苹方。Android / HarmonyOS 没有苹方、也不能随包
 * 分发 Apple 的版权字体，那份清单在那两平台保持为空 → 用各自系统字体。
 *
 * 将来真要打包自带字体（如思源黑体）时，同样在 `app.tsx` 把字体名加进清单
 * （`<HeytaUiProvider packagedFonts={…}>`）—— 但**不要**在这里重新解析 token。
 *
 * 🔴 门禁 `scripts/check-theme-single-source.mjs` 钉住这条边界：
 * 除 `packages/ui`（与 L0 的 `packages/design-system`）外，任何地方再出现
 * 第二张 token 表 / 文字样式表，`pnpm check:theme` 就会红。
 */

export {
  HeytaUiProvider as ThemeProvider,
  useHeytaText as useText,
  useHeytaTokens as useTokens,
  useHeytaUiTheme as useTheme,
} from '@heyta/ui';

export type { HeytaUiTheme as ThemeValue, HeytaUiNativeAccessors } from '@heyta/ui';
