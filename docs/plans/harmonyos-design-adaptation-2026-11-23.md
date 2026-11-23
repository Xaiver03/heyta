# 鸿蒙设计适配方案与首轮落地（HarmonyOS Design）

> 日期：2026-11-23　分支：`feat/app-auto-update`
> 参照：华为开发者联盟 · 设计（<https://developer.huawei.com/consumer/cn/design/>）、设计资源（<https://developer.huawei.com/consumer/cn/design/resource/>）、设计理念页（`/design/concept/`）

## 0. 结论（一句话）

在不改既有蓝白扁平设计系统的前提下，把鸿蒙端**「设计资源」这一层**补齐并用门禁钉死：鸿蒙原生资源（亮/暗色 + 字号/间距/圆角）由设计系统（`tokens.css` → `HeytaTokens.ets`）投影而来，服务卡片与小组件页改用 `$r('app.color.…')` 消费、**深色模式由系统自动切换**；新增 `check:harmony-tokens` 同源 + 引用门禁。共享 UI（`packages/ui`）接入 RNOH 属于另一件更大的工程，本轮不碰。

关键判断：**heyta 既有 token 与 HarmonyOS 的 8vp 网格、圆角档、字号阶梯本就高度接近**（间距 4/8/12/16/24、圆角 8/12/16、字号 12/14/16/20/24 基本同构）。因此"鸿蒙化"的成本不在"重画一套视觉"，而在**把设计系统真正投影到鸿蒙原生资源、并让深色/字体/卡片规范到位**——这正是本轮做的事。

## 1. 参照的官方规范要点

来源分级（本轮官网页面为 JS 渲染，`web_fetch` 取不到正文，故下列带【二次整理】者为官方/社区文章摘要，落地到具体数值前应以官方原文复核）：

- 【官方·设计理念页标题】关键词：纯净蓝白、舒适圆角、轻拟物、立体空间设计、**HarmonyOS Sans（书法美学，无级字重）**、**跨设备卡片式设计**、**万能卡片换肤**、全场景统一设计架构。
- 【官方·设计资源页】提供鸿蒙字体（HarmonyOS Sans）、设计组件库、图标资源等——即"字体/组件/图标"是官方希望各应用统一取材的三类资产。
- 【二次整理】设计原则：一致、流畅、聚焦、包容。
- 【二次整理】栅格 8vp 为其本单位，间距 4/8/12/16/24/32 vp；圆角默认 8vp，大屏可放大。
- 【二次整理】字号阶梯：12 / 14 / 16 / 20 / 24 vp；正文 16、行高约 1.5。
- 【二次整理】动效标准曲线 `cubic-bezier(0.4, 0, 0.2, 1.0)`，时长 200/300/400ms。

## 2. heyta 现状与差距

| 维度 | heyta 现状 | 鸿蒙规范 | 差距 / 本轮落点 |
|---|---|---|---|
| 色彩来源 | 设计系统唯一事实源 `packages/design-system/src/tokens.css`，已生成 `generated/HeytaTokens.ets`（含亮/暗常量） | 用 `$color` 资源引用 + 深/浅两套 | 鸿蒙 `resources/…/color.json` 此前只有 `start_window_background`；**本轮投影出 13 个语义色的亮/暗两套** |
| 卡片颜色 | ArkTS 卡片与 Index 页**硬编码 hex**（`#ffffff`/`#64748b`/`#0f172a`/`#94a3b8`/`#16a34a` 等） | 走资源、随深色切换 | **本轮改为 `$r('app.color.heyta_…')`，深色自动生效、与其它端同源** |
| 字体 | 鸿蒙系统默认即 HarmonyOS Sans（中文） | HarmonyOS Sans | 已天然满足；如需强制可显式 `fontFamily('HarmonyOS Sans')`（后续可选） |
| 间距/圆角 | `space` 4/8/12/16/20/24/32…、`radius` 8/12/16 | 8vp 网格、圆角 8vp 起 | 已接近；**本轮把字号/间距/圆角投影为 `float.json` 资源**，卡片可按需消费 |
| 动效曲线 | `ease.standard = cubic-bezier(.2,0,.2,1)` | 标准 `(.4,0,.2,1.0)` | 差异小；因会波及全端动效，**本轮不改**，列为后续在 ArkTS 层单独映射 |
| 服务卡片 | 已有今日/四象限/习惯/专注 4 张 ArkTS 卡片（共用 `WidgetCardRoot`） | 卡片式设计、换肤、数据可视化 | 本轮完成"卡片合法化"（资源 + 深色）；**换肤/可视化列为后续** |
| 共享 UI | `packages/ui`（RN）尚未接入鸿蒙壳（`entry` 依赖为空、无 rnoh 接线） | — | 属 P2-11 大工程，**本轮不碰** |

证据位置：卡片 `apps/mobile/harmony/entry/src/main/ets/widget/{WidgetCardRoot,WidgetCardParts}.ets`、页面 `.../pages/Index.ets`、生成物 `packages/design-system/generated/HeytaTokens.ets`。

## 3. 本轮落地（可验证）

### 3.1 鸿蒙原生设计资源（新增/扩充，纯 JSON）

- `apps/mobile/harmony/entry/src/main/resources/base/element/color.json`（亮）：新增 `heyta_surface / surface_subtle / foreground / foreground_muted / foreground_subtle / border / border_strong / primary / success / disabled_fg / warning / warning_strong / danger`。
- `…/resources/dark/element/color.json`（暗）：同名资源给出暗色值（如 `surface #0D1526`、`foreground #F1F5F9`、`success #34D399`）。**系统切深色即自动取暗值。**
- `…/resources/base/element/float.json`：新增字号（xs/md/sm/base/lg/xl/2xl，`fp`，随系统字体缩放）、间距（4/8/12/16/24 `vp`）、圆角（8/12/16 `vp`）。
- 原有 `start_window_background`、`page_text_font_size` 原样保留。

### 3.2 卡片与页面改为消费资源

`WidgetCardRoot.ets`、`WidgetCardParts.ets`、`pages/Index.ets` 三处的全部颜色字面量替换为 `$r('app.color.heyta_…')`（主按钮用 `heyta_primary`、危险按钮用 `heyta_danger`、警示文案用 `heyta_warning_strong`）。**组件结构、渲染逻辑、注释一律未动**，仅替换颜色取值方式。

字号与主内边距也改为资源：字号 12/13/14/16/24 → `$r('app.float.heyta_font_size_{xs,md,sm,base,2xl}')`（`fp`，随系统字体缩放）；主内边距 12/24 → `$r('app.float.heyta_space_{3,6}')`（`vp`，落在 8vp 网格上）。至此卡片与页面的**颜色、字号、间距**全部来自设计系统投影，`.ets` 内不再有裸值。

### 3.3 门禁：`check:harmony-tokens`

新增 `scripts/check-harmony-tokens-sync.mjs`（接入 `package.json` 的 `check` 链，紧跟 `check:arkts-widgets`）：

1. **同源**：`color.json`（亮/暗）与 `float.json` 里每个 `heyta_*`，必须与 `HeytaTokens.ets` 的对应常量逐值相等（颜色忽略大小写、尺寸忽略 fp/vp）。`tokens.css` 改了而资源没跟上即红。
2. **引用完整性**：扫描 `entry/src` 下所有 `.ets`，`$r('app.color.X')/$r('app.float.X')` 的 `X` 必须已定义；`widget/`、`pages/` 下不得再出现裸 hex。
3. **`--self-test`**：用内存里蓄意篡改的数据证明"正确输入绿、篡改输入红"——门禁不能失败等于没有。

### 3.4 本轮验证结果（实测）

- `pnpm check:harmony-tokens`：✅ 通过——13 色 × 亮/暗、15 尺寸同源；20 份 `.ets` 的 `$r` 引用全部命中、无裸 hex。
- `node scripts/check-harmony-tokens-sync.mjs --self-test`：✅ 全绿（含"篡改→红"两臂）。
- 三个资源 JSON：`JSON.parse` 通过。
- 三份改动的 `.ets`：括号/引号平衡、无残留裸 hex。
- `$r('app.color.…')` 覆盖卡片与页面的全部颜色；`$r('app.float.…')` 覆盖 7 类字号/间距档。

## 4. 诚实边界（务必知悉）

- **本机未装 DevEco Studio / `es2abc`**，故 `.ets` 的 ArkTS **编译未在本机执行**；`pnpm check:arkts*` 会"响亮跳过"（exit 0，并打印未验证什么）。**真编译验证需在装有 DevEco 的机器上跑**：`pnpm verify:harmony-toolchain`（出 HAP），或在 `apps/mobile/harmony` 下 `ohpm install && hvigorw assembleHap`。
- 本轮对 `.ets` 只做**等价字面量替换**（hex → `$r`），未改结构，风险已通过静态校验降到最低，但不替代编译器。
- `pnpm check:design` 当前有一处**既有红**：`apps/mobile/src/ui/custom-icons.tsx` 的 `#334155`（HEAD 已提交内容，见 `24778e5b`）及工作区中他人未提交的 web/ui/mobile 改动——**不在本任务改动的文件类型/目录内**（`check-hardcoded.mjs` 只扫 `apps/web/src`、`apps/mobile/src`、`packages/ui/src`，不扫 `apps/mobile/harmony` 与 `packages/design-system`），与本任务无关。
- 对比度保证继承 `packages/design-system/tests`：资源与 token 同源，即继承其 WCAG 实测。
- `@heyta/design-system` 测试当前有 **2 处既有失败**（`tests/typography.spec.ts` 的样式数量棘轮 `16 > 15`）；`packages/design-system` 源码树与 HEAD 一致、本任务未改动它，故与本任务无关。

## 5. 后续路线（鸿蒙特征增量，按价值排序）

1. **共享 UI 接入鸿蒙壳（RNOH）**：让 `packages/ui` 那套任务界面跑在 `entry` 里（`oh-package.json5` 加依赖、`Index.ets` 挂 RN 根）。这是"鸿蒙端成为可用应用"的前提，工程量最大。
2. **服务卡片进阶**：万能卡片换肤、数据可视化（数形融合）、轻拟物层次——按官方卡片规范细化。
3. **深色模式全量**：本轮已具备资源基础；再把卡片内的次要块、分隔、图表色补齐到 dark。
4. **沉浸式窗口**：`module.json5` 增加 window / statusBar 配置（安全区、状态栏配色）。
5. **动效曲线 ArkTS 映射**：把 `ease.standard` 在 ArkTS 层映射到鸿蒙标准 `cubic-bezier(0.4,0,0.2,1.0)`（不影响其它端）。
6. **字体显式声明**：需要时可对关键文本 `fontFamily('HarmonyOS Sans')` 显式化。

## 6. 回滚

本轮改动均为纯新增/等价替换，回滚只需对下列文件 `git checkout --`：

```
apps/mobile/harmony/entry/src/main/resources/base/element/color.json
apps/mobile/harmony/entry/src/main/resources/dark/element/color.json
apps/mobile/harmony/entry/src/main/resources/base/element/float.json
apps/mobile/harmony/entry/src/main/ets/widget/WidgetCardParts.ets
apps/mobile/harmony/entry/src/main/ets/widget/WidgetCardRoot.ets
apps/mobile/harmony/entry/src/main/ets/pages/Index.ets
scripts/check-harmony-tokens-sync.mjs
```

另需从 `package.json` 移除 `check:harmony-tokens` 脚本项与 `check` 链中的该环。

## 7. 验收命令

```bash
pnpm check:harmony-tokens            # 同源 + 引用 + self-test
pnpm verify:harmony-toolchain        # 需 DevEco：真编译出 HAP（另一台机器）
```
