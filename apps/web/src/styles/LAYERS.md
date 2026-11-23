# Web 样式分层（LAYERS）

> 这份文件是**级联顺序的唯一契约**，由 `pnpm check:css-layers` 机械校验。
> 改 `apps/web/src/styles/app.css` 的 `@import` 顺序、或新增/删除模块，**必须同步改这里
> 和 `scripts/check-css-layers.mjs` 的 `EXPECTED_ORDER`**，否则门禁红。

## 为什么要"分层"

CSS 没有 import 作用域，**同特异性时源序后者胜**。所以"哪个文件覆盖哪个文件"就是本仓的
分层语义。2026-09-30 出过一次真实事故：`narrow.css` 的 ≤768px 媒体块写在了基础规则**之前**，
整块被后面的基础规则覆盖，移动端塌缩规则**一条都没生效**（而当时的检查全绿）。

于是分层不靠人记，靠一张**有序清单** + 一道门禁。

## 五层（从底到顶，后读的赢）

| 层 | 文件 | 职责 | 规则 |
|---|---|---|---|
| **L1 基础与布局** | `base` / `sidebar` / `main-area` / `sheets` / `profile` / `material` | 外壳网格、面板壳、材质 | 只描述"东西摆在哪"，不含业务配色 |
| **L2 控件与解剖** | `controls` → `menu` → `form` | 按钮/菜单/表单的**形状** | `controls` 必须早于 `menu`（菜单项要能继承按钮基类）；`form` 在 `controls` 之后 |
| **L3 功能区** | `rail` / `inbox` / `ai-panels` / `settings-account` / `growth` / `trash` / `danger-confirm` / `admin` / `habits` | 各功能视图 | 不许重声明 L2 的控件配方（`check:control-semantics` A6 守） |
| **L4 响应式** | `narrow` | ≤768px 塌缩 | **必须在所有基础规则之后**（这就是 9-30 那次事故） |
| **L5 皮肤与可达性** | `assistant-layout` → `scope-drawer` → `borderless-controls` | 助手面板皮肤 / 范围抽屉 / 无描边+焦点环裁决 | `borderless-controls` **必须最后**（焦点环要能落到任何控件上） |

## 聚合器结构

`apps/web/src/styles/app.css` **只放 @import**，一行一个模块，顺序 = 上表顺序。
大文件拆出的模块（如 `ai-panels` 的 5 个子模块）由各自的聚合器（`ai-panels.css`）内部
再 `@import`，**子模块顺序 = 原文件行序**，不得按主题重排。

## 功能级样式（L3 的延伸）

`apps/web/src/features/**/*.css` 与组件同址，由**组件自己 import**（不是 app.css）。
约束（门禁机检）：

1. 每个功能 CSS 必须**恰好被一个组件 import 一次**（否则是死文件或被两处抢着读）；
2. 功能 CSS **不许**被 `app.css` import（层要分清：app.css 是外壳，功能样式待在功能里）。

## 禁区

- 🔴 不把 `narrow` 前移、不把 `borderless-controls` 移出末位；
- 🔴 不在 `features/**` 里 `@import` `styles/app/**`（反向依赖会让打包顺序不可预测）；
- 🔴 不为"少一行"把两个模块合回大文件 —— 拆分是为了可维护性，聚合器零规则。
