# Dynamic Type（系统大字号）支持 · 立项

> 状态：立项（2026-11-18）。负责：移动端壳 + 设计系统。关联：[`docs/agents/design-system.md`](../agents/design-system.md)、[`docs/agents/ux-principles.md`](../agents/ux-principles.md)。

## 目标
移动端（iOS/Android）文字随系统「文字大小」缩放（Dynamic Type），在**超大 / 辅助功能大号**两档下布局不溢出、按钮可点、文字不被裁；同时少量关键小控件（角标 / 标签栏 / chip）设上限防破版。

## 现状（现量）
- `apps/mobile/src/ui/kit.tsx` 的 `<Text>` 直接用 `RNText`，**未关闭** `allowFontScaling`（RN 默认 `true`）。全仓唯一一处显式控制是 `kit.tsx:892` 角标 `maxFontSizeMultiplier={2}`；无任何 `allowFontScaling={false}`。⇒ 理论上文字应随系统字号缩放，且当前**没有上限策略**（大字号可能破版）。
- 验证受限（如实登记）：本机 harness 用 `devicectl` 改系统字号后**无法可靠重启 App**（`process terminate` 需 PID，`process launch` 不返回可用 PID，运行中的进程不会热更新 fontScale），两次改字号截图逐字节相同 ⇒ **"当前是否真的在缩放"尚未在真机上证实**。需要在真机上「先设字号→再冷启动」人工确认，或补一个可读 `PixelRatio.getFontScale()` 的调试入口。

## 规范（目标态）
1. **内容文字**随系统字号缩放（`allowFontScaling` 保持 true）。
2. **关键小控件**设上限：标签栏 / 角标 / chip / 分段控件用 `maxFontSizeMultiplier`（建议 1.3–1.5），防破版与挤压。
3. 布局用 `minHeight` 而非固定 `height`；行内文字 `numberOfLines` 明确；间距/行高走 token，不写死像素。
4. 大字号下不出现：文字截断丢失、按钮小于 44×44、水平溢出、文案压盖。

## 步骤
1. 在 `packages/design-system` 增共享策略：内容文字不封顶、chrome 类控件的 `maxFontSizeMultiplier` 常量。
2. `kit.tsx` 的 `Text` 暴露 `allowFontScaling`（默认 true）与可选 `maxFontScale`；`Button`/`Chip`/`TabBar`/`Badge` 接上限。
3. 真机逐屏 triage：系统「超大」「辅助功能大号」两档各拍一遍（iPhone 与 iPad 各一台）。
4. 门禁/单测：新增 spec 断言关键行/按钮不写死 `height`；`check:rn-aria`、`check:tap-targets` 仍绿。

## 验收
- iPhone + iPad，「超大」「辅助功能大号」两档：个人中心 / 设置 / 任务 / 登录 四屏逐张实拍，无溢出、无截断、按钮 ≥44、无水平滚动。
- 记录每屏字号档下的实测高度与是否换行。

## 已知环境限制（登记）
- 本机 DSH 沙箱无法完成 `xcodebuild` device 构建（SwiftPM 缓存 + 嵌套 sandbox-exec 被拒）；真机装包走「Metro 重打 bundle + dev 重签 + devicectl install」的等价路径（见 `.local/iphone-redesign-evidence-20261118/README.md`）。Dynamic Type 的真机复测同样依赖该安装路径 + 人工冷启动。
