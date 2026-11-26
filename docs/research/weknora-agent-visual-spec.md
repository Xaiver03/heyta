# WeKnora Agent 输出界面：视觉规范与逐值样式

> 状态：**调研记录**（归档层；结论有变时新增勘误、不改原文）
> 调研日期：**2026-11-26**（CST）。基线：`weknora` 仓库分支 `integrate/aidenwlf-20261124-001102`，HEAD `b6ee40476`（fork 自腾讯 WeKnora，合到上游 v0.9.0）。
> 方法：**只读静态阅读** + 逐点 `grep -n`，未运行应用、未截图；凡推测标「推测」，凡未读到实现标「未验证」。
> ⚠️ 文中 `file:line` 以**被调研仓库** `~/Desktop/All in one Data/01_PROJECTS/weknora` 为准，不是本仓库；一次改动即偏移。
> 范围：设计令牌（三层）、排版、组件样式、Markdown 输出、暗色、动效、断点。页面结构见 [会话页 IA](weknora-agent-chat-ia.md)，协议见 [输出协议](weknora-agent-output-protocol.md)。

---

---

## 0. 先看结论：这套体系的三层结构

| 层 | 前缀 | 定义文件 | 职责 |
|---|---|---|---|
| A. 应用层令牌 | `--app-*` | `frontend/src/assets/theme/theme.css` L251–298 | 圆角 / 字号 / 间距 / 动效 / z-index / 字体栈。**新代码必须引用这一层**，有样式守卫卡字面量 |
| B. TDesign 令牌覆盖 | `--td-*` | 同文件 L1（亮色）、L2–98（暗色） | 品牌色阶、语义色阶（warning/error/success）、灰阶、背景、文字四层、圆角、阴影、字号阶梯 |
| C. 语义/局部变量 | `--agent-step-*`、`--chat-code-*`、`--stream-brand-*`、`--refer-brand-*`、`--chat-*` | 各 mixin / 组件 | 时间线行、代码高亮、品牌透明叠加、引用面板 |

**唯一的设计令牌入口文件**：`frontend/src/assets/theme/theme.css`（298 行）。TD 组件的全局意图覆盖只在 `frontend/src/assets/theme/tdesign-overrides.less`（70 行）。

**令牌规模（现量，取数命令见 §8.4）**

| 口径 | 数量 |
|---|---|
| `theme.css` 内的变量声明行（`--x:`） | **396** |
| `theme.css` 内不重复变量名 | **221** |
| 全仓 `*.css` / `*.less` / `*.vue` 内**声明过**的不重复变量名 | **314** |
| ├ `--app-*` | 42 |
| ├ `--td-*` | 172 |
| ├ `--z-*` | 6 |
| ├ `--chat-code-*` / `--agent-step-*` / `--stream-*` / `--refer-*` | 28 |
| └ 其他（组件局部布局/动画旋钮，如 `--sidebar-*`、`--kb-folder-*`、`--wiki-list-*`、`--igv-*`、`--rotate`） | 66 |

样式守卫（棘轮）`frontend/src/assets/theme/styleGuard.test.mjs` 把「合法值域」写成了断言，可直接当作复刻时的校验清单：

| 规则名 | 断言的值域 | baseline（现存违规数） | 证据 |
|---|---|---|---|
| `brand-rgba` | 品牌透明叠加必须用 `color-mix(in srgb, var(--td-brand-color) N%, transparent)`，禁止 `rgba(7,192,95,…)`（旧绿色品牌） | 0 | styleGuard.test.mjs L30-35 |
| `legacy-blue-rgba` | 旧 TDesign 蓝 `rgba(0,82,217,…)` 已非品牌色 | 7 | L36-41 |
| `radius-literal` | 圆角只允许 `4/6/8/10/12/999px` | 160 | L48-53 |
| `font-size-literal` | 字号只允许 10~24px（`--app-text-2xs … 4xl`） | 33 | L54-59 |
| `motion-literal` | 时长只允许 `120/150/200/300ms` | 64 | L60-65 |
| `z-index-important` | 层级用 `--z-*` 令牌，禁止 `z-index: N !important` | 23 | L71-76 |

> 复刻注意：`radius-literal` 的 baseline 是 160、`!important` 是 414 —— 说明实际代码里**仍存在大量字面量**。下文凡遇字面量，我都标「字面量」以便你照抄真实渲染值。

---

## ① 令牌总表

### 1.1 字体栈

| 变量名 | 值 | 用途 | 定义处 |
|---|---|---|---|
| `--app-font-family` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 全站正文/UI | theme.css L1 |
| `--app-font-family-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` | 代码/kbd/JSON | theme.css L1 |
| `--td-font-family` | `var(--app-font-family)` | TD 组件 | theme.css L1、L92 |
| `--td-font-family-medium` | `var(--app-font-family)` | TD 中等字重（**与常规同栈，靠 font-weight 区分**） | 同上 |
| `--td-font-family-mono` | `var(--app-font-family-mono)` | TD 代码 | 同上 |

### 1.2 字号阶梯

**应用层（唯一推荐层）** — theme.css L263-273：

| 变量 | 值 | 复刻用途 |
|---|---|---|
| `--app-text-2xs` | `10px` | 角标数字、super 小标 |
| `--app-text-xs` | `11px` | 徽标、工具输出正文、tab 日期 |
| `--app-text-sm` | `12px` | 次要说明、代码块语言标、时间戳 |
| `--app-text-md` | `13px` | **Agent 时间线摘要行**、代码块正文、artifact 文件名 |
| `--app-text-base` | `14px` | 时间线标题、表格正文、卡标题 |
| `--app-text-lg` | `15px` | 空态标题 |
| `--app-text-xl` | `16px` | **回答正文**、用户气泡、输入框 |
| `--app-text-2xl` | `18px` | 页面 h3、区块标题 |
| `--app-text-3xl` | `20px` | 页面 h2 |
| `--app-text-4xl` | `24px` | 页面 h1 |

**TDesign 层（组件内部用，勿在业务里新引）** — theme.css L1、L92：

| 变量 | 值 | 行高（= 字号 + 8px） | 组合 `--td-font-*` 的字重 |
|---|---|---|---|
| `--td-font-size-link-small` | 12px | `--td-line-height-link-small` = 20px | normal |
| `--td-font-size-link-medium` | 14px | 22px | normal |
| `--td-font-size-link-large` | 16px | 24px | normal |
| `--td-font-size-mark-small` | 12px | 20px | **600** |
| `--td-font-size-mark-medium` | 14px | 22px | **600** |
| `--td-font-size-body-small` | 12px | 20px | normal |
| `--td-font-size-body-medium` | 14px | 22px | normal |
| `--td-font-size-body-large` | 16px | 24px | normal |
| `--td-font-size-title-small` | 14px | 22px | normal |
| `--td-font-size-title-medium` | 16px | 24px | normal |
| `--td-font-size-title-large` | 20px | **24px**（⚠️ 用了 `title-medium` 字号算行高，见 §0 注） | normal |
| `--td-font-size-headline-small` | 24px | 32px | normal |
| `--td-font-size-headline-medium` | 28px | 36px | normal |
| `--td-font-size-headline-large` | 36px | 44px | normal |
| `--td-font-size-display-medium` | 48px | 56px | normal |
| `--td-font-size-display-large` | 64px | 72px | normal |
| `--td-line-height-common` | **8px** | 所有行高 = 字号 + 8 | — |

> ⚠️ 已核实的**不一致**：`--td-line-height-title-large` 的计算式是 `calc(var(--td-font-size-title-medium) + var(--td-line-height-common))` = **24px**，而 `--td-font-size-title-large` 是 20px。原样复刻则 h4 级别只有 1.2 行高；若要 1:1，请照抄这个 bug（theme.css L92 第 31 个分号段）。

### 1.3 字重

| 值 | 用在哪 | 证据 |
|---|---|---|
| 400 | 回答正文、时间线标题、代码块内 `code`、Markdown 列表/引用 | chat-markdown.less L89-140、AgentStreamDisplay.vue L4490-4497 |
| 450 | `.doc-link`（全站文档/外链） | theme.css L168 |
| 500 | 行内代码、kbd、artifact 文件名、chip 文字、复制按钮、tab、用户时间 | chat-markdown.less L122、L106；theme.css L52 |
| 600 | `strong`、标题 h1–h6、代码块语言标、`.md-strong-title`、表格 th、diff 统计、空态标题 | chat-markdown.less L90、L445-490 |
| 700 | 列表 marker、Markdown `.hljs-section`、`.md-strong-title` 在文档预览内、测试页 h1 | chat-markdown.less L381、chat-hljs.less L70、markdown.less L44 |

### 1.4 间距阶梯（4px 网格）— theme.css L276-283

| 变量 | 值 | 典型用法 |
|---|---|---|
| `--app-space-1` | 4px | chip 内 gap、按钮 gap |
| `--app-space-2` | 8px | 卡片内 gap、列表 gap |
| `--app-space-3` | 12px | 卡片 padding、代码块头 padding |
| `--app-space-4` | 16px | 消息列左右 inset（实际用 20px） |
| `--app-space-5` | 20px | 消息列 `--chat-content-inset` |
| `--app-space-6` | 24px | 区块间距 |
| `--app-space-8` | 32px | 抽屉空态 padding、测试页 |
| `--app-space-10` | 40px | 大区块 |

### 1.5 圆角 — theme.css L256-261 / L94

| 变量 | 值 | 用在哪 |
|---|---|---|
| `--app-radius-xs` | `4px` | 行内代码、`.bot_msg` 外层、代码块复制按钮 |
| `--app-radius-sm` | `6px` | 代码块复制按钮、图标按钮 28×28、工具输出容器 |
| `--app-radius-md` | `8px` | 用户气泡、代码块整体、artifact 卡、表格外框、prompt dock 内块 |
| `--app-radius-lg` | `10px` | mermaid 块、citation 浮层、建议问题卡 |
| `--app-radius-xl` | `12px` | 输入框容器、`.wk-popover` |
| `--app-radius-pill` | `999px` | citation 药丸、agent-mode 按钮 |
| `--td-radius-small` | `2px` | TD 组件 |
| `--td-radius-default` | `3px` | TD 组件、`channel_tag`（字面量 3px 同值） |
| `--td-radius-medium` | `6px` | mention chip、work 行 |
| `--td-radius-large` | `9px` | TD |
| `--td-radius-extraLarge` | `12px` | TD |
| `--td-radius-round` | `999px` | TD |
| `--td-radius-circle` | `50%` | 圆形按钮（发送/停止） |

> 特例（字面量，需照抄）：`.selected-tags-inline` 内圆角 `11px 11px 0 0`（= 12 − 1px 边框，Input-field.vue L3523）；`.steer-queue` `10px 10px 0 0`（L3442）；`.artifact-search` 输入框 `7px`（ChatArtifactsPanel.vue L604）；复制/下载按钮 `7px`(30×30, L670)；`kbd` `5px`（chat-markdown.less L112）；`.ask-field-option-mark` 用 `--app-radius-xs`（AskUserCard L347）。

### 1.6 阴影

| 变量/选择器 | 值 | 用途 | 定义处 |
|---|---|---|---|
| `--td-shadow-1` | `0px 1px 10px rgba(0,0,0,.05), 0px 4px 5px rgba(0,0,0,.08), 0px 2px 4px -1px rgba(0,0,0,.12)` | TD 一级浮起 | theme.css L96 |
| `--td-shadow-2` | `0px 3px 14px 2px rgba(0,0,0,.05), 0px 8px 10px 1px rgba(0,0,0,.06), 0px 5px 5px -3px rgba(0,0,0,.1)` | tooltip / 浮层 | 同上 |
| `--td-shadow-3` | `0px 6px 30px 5px rgba(0,0,0,.05), 0px 16px 24px 2px rgba(0,0,0,.04), 0px 8px 10px -5px rgba(0,0,0,.08)` | 大浮层 | 同上 |
| `.wk-popover .t-popup__content` | `0 0 0 .5px rgba(0,0,0,.03), 0 2px 4px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.1)` + `backdrop-filter: blur(20px) saturate(180%)` | 下拉/选择器皮肤 | tdesign-overrides.less L10-15 |
| `.rich-input-container` | `0 2px 8px rgba(0,0,0,.04), 0 8px 16px -4px rgba(0,0,0,.06)` | **输入框** | Input-field.vue L3508 |
| `.prompt-dock` | 同上（完全相同） | Prompt 卡片 | PendingPromptDock.vue L184 |
| `.chat-code-block` | `0 1px 2px color-mix(in srgb, var(--td-text-color-primary) 6%, transparent)` | 代码块 | chat-markdown.less L149 |
| `.chat-mermaid-block` | `0 1px 3px …5%…` | mermaid 块 | chat-markdown.less L233 |
| `.deep-think` | `0 2px 4px color-mix(in srgb, var(--td-brand-color) 8%, transparent)` | 思考卡（旧） | deepThink.vue L91 |
| `.refer` | `0 2px 4px var(--refer-brand-8)`（品牌 8% 混色） | 引用面板 | docInfo.vue L227 |
| `.result-card` | `0 1px 2px rgba(0,0,0,.04)`；hover `0 2px 6px brand 8%` | 工具结果卡 | tool-results.less L17-18 |
| `.answer-toolbar__artifact-count` | 无阴影，纯色角标 | — | chat-message-shared.less L147-167 |
| `.chat-citation-float` | `0 2px 4px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.08)` | 引用浮层 | chat-citations.less L111 |
| `.scroll-to-bottom-btn` | `0 2px 8px rgba(0,0,0,.1)`；hover `0 4px 12px rgba(0,0,0,.15)` | 回底按钮 | index.vue L2258、L2269 |
| `.open-page-card` | `0 1px 2px rgba(0,0,0,.03)` | 打开页面卡 | OpenPageCard.vue L116 |
| `.suggested-question-card` | `0 1px 2px rgba(0,0,0,.04)`；hover `0 2px 6px rgba(0,0,0,.05)` | 建议问题卡 | suggested-questions.less L7、L119 |

### 1.7 边框（含「半像素」传统）

| 场景 | 值 | 证据 |
|---|---|---|
| 主描边（亮） | `1px solid var(--td-component-stroke)` = `#e7e7e7` | chat-markdown.less L128 等 |
| 次描边（亮） | `1px solid var(--td-component-border)` = `#dcdcdc` | 交互 hover 边界 |
| **半像素描边**（思考卡/引用面板/图片/浮层） | `.5px solid var(--td-component-stroke)` | deepThink.vue L90、docInfo.vue L226、chat-markdown.less L592、chat-citations.less L108 |
| 时间线主干线 | `1px solid var(--agent-step-line-color)`（= text-primary 16%） | AgentStreamDisplay.vue L3762 |
| 引用块左边 | `2px solid var(--td-component-stroke)` | chat-markdown.less L421 |
| 表格内网格 | 仅 `border-right` + `border-bottom`，`1px`，无外框（外框由 wrapper 提供） | chat-markdown.less L546-571 |
| 焦点环 | `outline: 2px solid var(--td-brand-color)`，`outline-offset: 2px`（局部 3px/−2px） | 多处 |

### 1.8 层级（z-index）

| 变量 | 值 | 注释里的语义 | 定义处 |
|---|---|---|---|
| `--z-sticky` | `10` | 页面内 sticky | theme.css L292 |
| `--z-dropdown` | `1000` | 下拉 | L293 |
| `--z-modal` | `1100` | 全屏弹窗壳 | L294 |
| `--z-drawer` | `2500` | TDesign 抽屉/弹窗 | L295 |
| `--z-popover` | `3000` | 弹层 | L296 |
| `--z-toast` | `5000` | 通知 | L297 |

**实际硬编码 z-index（复刻必须知道，令牌没覆盖）：**

| 元素 | z-index | 证据 |
|---|---|---|
| `.chat_composer` | `12` | index.vue L2189 |
| `.control-bar` | `10` | Input-field.vue L3723 |
| `.answers-input` | `99` | Input-field.vue L3410 |
| `.scroll-to-bottom-btn` | `10` | index.vue L2252 |
| `.artifact-preview-resize-overlay` | `2001` | ChatArtifactsDrawer.vue L696 |
| `.artifact-preview-resize-handle` | `2002` | L707 |
| `.chat-citation-float` | **`10000`** | chat-citations.less L103 |
| `.answer-toolbar__artifact-count` | `1` | chat-message-shared.less L151 |
| tool `.action-card > *` | `1` | AgentStreamDisplay.vue L3864 |

### 1.9 品牌色与语义色（亮/暗两套）

**品牌色阶（亮色 `--td-brand-color` = `-4`）** — theme.css L1：

| 级别 | 亮色 hex | 暗色 hex | 备注 |
|---|---|---|---|
| brand-1 | `#e6f4ff` | `#0c2a52` | light 变体 |
| brand-2 | `#cce9ff` | `#0d3468` | |
| brand-3 | `#99d2ff` | `#0e4388` | **亮色 hover** |
| brand-4 | `#0057f2` | `#0f54ad` | **亮色主色** |
| brand-5 | `#006dff` | `#136bd1` | **亮色 active** / 暗色 hover |
| brand-6 | `#0a83ff` | `#2a86f0` | **暗色主色** |
| brand-7 | `#2a9bff` | `#4c9bff` | 暗色 active |
| brand-8 | `#59b8ff` | `#76b4ff` | |
| brand-9 | `#8fd8ff` | `#a6d2ff` | |
| brand-10 | `#d6efff` | `#d6efff` | 两端同值 |
| brand-disabled | `#9cc4ff` | `#123d7a` | |
| brand-focus | `color-mix(brand 20%, transparent)` | `color-mix(brand 28%, transparent)` | 暗色透明度更高 |

**语义色（只列主色 + 关键档，完整 10 档见 theme.css L1/L2-47）**

| 语义 | 亮色主色 | 亮色 light 底 | 暗色主色 | 暗色 light 底 |
|---|---|---|---|---|
| warning | `#ed7b2f`（-5） | `#fef3e6`（-1） | `#dc7633`（-6） | `#4f2a1d`（-1） |
| error | `#e34d59`（-6） | `#fdecee`（-1） | `#c64751`（-6） | `#472324`（-1） |
| success | `#00a870`（-5） | `#e8f8f2`（-1） | `#43af8a`（-6） | `#193a2a`（-1） |

**灰阶（两端完全相同，语义靠映射变）** — theme.css L1、L47-60：

| 变量 | 值 | 亮色语义 | 暗色语义 |
|---|---|---|---|
| gray-1 | `#f3f3f3` | secondarycontainer | — |
| gray-2 | `#eee` | **page 背景** | disabled 底 |
| gray-3 | `#e7e7e7` | **stroke** / component | — |
| gray-4 | `#dcdcdc` | **border** | — |
| gray-5 | `#c5c5c5` | — | — |
| gray-6 | `#a6a6a6` | component-active | — |
| gray-7 | `#8b8b8b` | — | — |
| gray-8 | `#777` | — | — |
| gray-9 | `#5e5e5e` | container-select | **border** / secondarycontainer-active |
| gray-10 | `#4b4b4b` | — | component-hover、container-active |
| gray-11 | `#383838` | — | **stroke** / component / secondarycontainer-hover |
| gray-12 | `#2c2c2c` | — | **secondarycontainer** / container-hover / component-disabled |
| gray-13 | `#242424` | — | **container**（卡面） |
| gray-14 | `#181818` | — | **page / sidebar / settings-modal** |

**文字四层（这是「层级」的核心，不是字号）**

| 语义变量 | 亮色 | 暗色 |
|---|---|---|
| `--td-text-color-primary` | `rgba(0,0,0,0.9)` | `rgba(255,255,255,0.9)` |
| `--td-text-color-secondary` | `rgba(0,0,0,0.6)` | `rgba(255,255,255,0.55)` |
| `--td-text-color-placeholder` | `rgba(0,0,0,0.4)` | `rgba(255,255,255,0.35)` |
| `--td-text-color-disabled` | `rgba(0,0,0,0.26)` | `rgba(255,255,255,0.22)` |
| `--td-text-color-anti` | `#fff` | `#fff` |
| `--td-text-color-brand` / `link` | `var(--td-brand-color)` | 同 |

> 暗色不是「把黑翻白」，而是**四层透明度全部重设**（.9/.55/.35/.22），比亮色的 .9/.6/.4/.26 更收敛。

### 1.10 应用级语义色（非品牌但反复出现）— theme.css L205-236

| 变量 | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--app-accent-purple` | `#7c4dff` | `#9d7cff` | 智能体 / 图谱 |
| `--app-accent-blue` | `#2f6bff` | `#6f9bff` | 同上 |
| `--app-accent-teal` | `#0f8f83` | `#3cc4b4` | 同上 |
| `--app-source-highlight` | `#d6a124` | `#e6b94f` | 引用原文高亮文字色 |
| `--app-source-highlight-bg` | `rgba(250,204,75,0.34)` | `rgba(230,185,79,0.26)` | 高亮块 |
| `--app-source-highlight-soft-bg` | `rgba(250,204,75,0.09)` | `rgba(230,185,79,0.08)` | 弱高亮 |
| `--app-source-highlight-border` | `rgba(183,130,22,0.5)` | `rgba(230,185,79,0.5)` | 高亮描边 |
| `--app-selection-bg` | `color-mix(text-primary 4%, container)` | 同（自动跟随） | 选中行底（不抢眼） |
| `--app-selection-text` | `var(--td-text-color-primary)` | 同 | |
| `--app-selection-border` | `color-mix(brand 30%, stroke)` | 同 | |
| `--app-focus-border` | `var(--td-brand-color)` | 同 | |

### 1.11 布局尺寸令牌

| 变量 | 值 | 用途 | 定义处 |
|---|---|---|---|
| `--app-chat-header-height` | **`40px`** | 对话标题栏 / 右侧面板 / drawer 头统一高度 | theme.css L253 |
| `--chat-content-inset` | **`20px`** | 消息列与输入列左右留白 | index.vue L2060 |
| `--chat-composer-height` | JS 写入（`composerHeight` px） | 滚动区底部占位 | index.vue L33、Input-field |
| `--chat-scrollbar-gutter` | JS 写入 | 输入区右侧让位滚动条 | index.vue L35 |
| `--composer-input-min-height` | 默认 `72px`，compact `56px` | textarea 最小高 | Input-field.vue L3680、L3749 |
| `--references-panel-width` | 默认 `420px` | 右侧引用面板 | index.vue L36 |
| `--sandbox-panel-width` | 默认 `420px` | 沙箱面板 | index.vue L9 |
| `--agent-step-text-size` | `14px` | 时间线标题 | chat-timeline-theme.less L5 |
| `--agent-step-summary-size` | `13px` | 时间线摘要/思考正文 | L6 |
| `--agent-step-color` | `color-mix(secondary 90%, primary)` | 时间线文字色 | L3 |
| `--agent-step-icon-color` | `var(--agent-step-color)` | 时间线图标色 | L4 |
| `--agent-step-line-color` | `color-mix(primary 16%, transparent)` | 主干线 | L7 |

### 1.12 代码高亮令牌（GitHub Light / GitHub Dark 同源色板）— chat-hljs-theme.less

| 令牌 | 亮色 | 暗色 | 对应 hljs 类 |
|---|---|---|---|
| `--chat-code-fg` | `#24292e` | `#c9d1d9` | 正文 / `subst` |
| `--chat-code-keyword` | `#d73a49` | `#ff7b72` | doctag/keyword/type/template-tag |
| `--chat-code-title` | `#6f42c1` | `#d2a8ff` | title/class_/function_ |
| `--chat-code-attr` | `#005cc5` | `#79c0ff` | attr/attribute/literal/number/operator/variable/selector-* |
| `--chat-code-string` | `#032f62` | `#a5d6ff` | string/regexp/meta string |
| `--chat-code-builtin` | `#e36209` | `#ffa657` | built_in/symbol |
| `--chat-code-comment` | `#6a737d` | `#8b949e` | comment/code/formula |
| `--chat-code-name` | `#22863a` | `#7ee787` | name/quote/selector-tag/pseudo |
| `--chat-code-section` | `#005cc5` | `#1f6feb` | section（**另加 font-weight:700**） |

### 1.13 其他局部变量

| 变量族 | 定义处 | 生成规则 |
|---|---|---|
| `--stream-brand-2/3/4/5/6/8/10/12/15/20` | AgentStreamDisplay.vue L3665-3674 | `color-mix(in srgb, var(--td-brand-color) N%, transparent)`，N= 2,3,4,5,6,8,10,12,15,20 |
| `--refer-brand-4/8/12` | docInfo.vue L216-218 | 品牌 4/8/12% 透明 |
| `--refer-brand-*`（timeline 变体） | docInfo.vue L237-239 | 改为 **text-primary** 4/6/8%（`.refer-timeline` 下品牌色被摘掉） |
| `--weknora-faq-color` | 未定义（只有 fallback） | 所有使用处都是 `var(--weknora-faq-color, #0052d9)`，即**实际渲染恒为 #0052d9**（旧 TDesign 蓝，是全站唯一的「遗留蓝」） |

---

## ② 排版规范表

### 2.1 回答正文的微观排版（`.chat-markdown-typography()`）

定义处：`frontend/src/components/css/chat-markdown.less` L13-16（mixin 根）。

| 属性 | 值 | 备注 |
|---|---|---|
| `font-size` | `var(--app-text-xl)` = **16px** | 与用户气泡、输入框同号 |
| `color` | `var(--td-text-color-primary)` | 亮 #000 .9 / 暗 #fff .9 |
| `line-height` | **`1.625`** = 26px @16 | 全篇统一 |
| `letter-spacing` | `normal`（**不加字距**） | 与很多国内产品「中文字距 +0.2px」的做法相反 |
| `-webkit-font-smoothing` | `antialiased` | 只在回答体上开，不在全局开 |
| 中英混排 | **无 `font-feature-settings`、无 `text-autospace`、无 `word-break: keep-all`**；仅靠系统字体栈（PingFang SC / Segoe UI）自然混排 | 复刻时不要自作主张加字距 |

**段距（em 相对，跟着 16px 走）**

| 选择器 | margin | 行高 | 定义处 |
|---|---|---|---|
| `p` | `0 0 0.25em`（=4px 底） | 1.625 | L35-46 |
| `p + p` | `margin-top: 0.75em`（=12px）；但前一段 bottom 4px，**实际相邻段距 12px**（top 覆盖语义为「取大」） | 1.625 | L39-41 |
| `p:last-child` | `margin-bottom: 0` | — | L43-45 |
| `p:has(> .citation:only-child)`（纯引用段） | `0.125em 0 0.375em`（2px / 6px） | 1.625 | L49-52 |
| `p.md-strong-title`（整段只有一个粗体，模型常拿它当小标题） | `margin-top: 1.25em`(20px)、`margin-bottom: 0.5em`(8px) | **1.5** | L70-78 |
| `p + ul/ol`、`ul/ol + p`、`blockquote + p`、`p + blockquote` | `margin-top: 0.75em` | — | L80-87 |
| `p:has(> img:only-child)` | `margin: 1.25em 0` | **`line-height: 0`**（去图片下方空隙） | L630-633 |

> 关键细节：`md-strong-title` 是**渲染期打标**（`markStandaloneStrongParagraphs`，chatMarkdownRenderer.ts L484-497），不是 CSS `:has()` 猜的 —— 因为流式时 `p:has(> strong:only-child)` 会在半个粗体闭合瞬间误命中，造成段距跳动。复刻若要流式，必须同样在 HTML 阶段打标。

### 2.2 标题层级（em 相对 16px）

| 标签 | font-size | 计算值 | 字重 | margin | line-height | 计算行高 | 证据 |
|---|---|---|---|---|---|---|---|
| `h1` | `1.5em` | 24px | 600 | `0 0 0.375em`（0/6px） | `1.333` | 32px | L445-450 |
| `h2` | `1.25em` | 20px | 600 | `1em 0 0.25em`（16/4px） | `1.4` | 28px | L452-461 |
| `h3` | `1.125em` | 18px | 600 | `0.875em 0 0.25em`（14/4px） | `1.556` | 28px | L463-468 |
| `h4` | `1em` | 16px | 600 | `1em 0 0` | `1.5` | 24px | L470-480 |
| `h5` | `0.9375em` | 15px | 600 | `1em 0 0` | `1.5` | 22.5px | L482-484 |
| `h6` | `0.875em` | 14px | 600 | `1em 0 0` | `1.5` | 21px | L486-490 |
| h1–h6 `:first-child` | — | — | — | `margin-top: 0` | — | — | L492-499 |

> `h6` 额外 `color: var(--td-text-color-secondary)`（L489）—— 唯一降色的标题。
> `h2:first-child` 单独再写一次 `margin-top:0`（L458-460），与 L492 的通用规则重复，说明历史修补痕迹。

### 2.3 列表

| 项 | 值 | 证据 |
|---|---|---|
| `ul`/`ol` margin | `0.35em 0 0.75em`（5.6px / 12px） | L345-369 |
| `ul`/`ol` padding-left | `1.625em` = 26px | 同上 |
| 列表类型 | `disc` / `decimal`，`list-style-position: outside` | 同上 |
| 嵌套列表 padding-left | `1.25em` = 20px | L351-355 / L364-368 |
| 嵌套列表 margin | `0.25em 0 0` | 同上 |
| `li` | `margin: 0`，`line-height: 1.625`，`padding-left: 0.375em`(6px) | L371-374 |
| `li + li` | `margin-top: 0.375em`（6px） | L376-378 |
| `li::marker` | `font-weight: 700`，`color: text-primary` | L380-383 |
| `ol > li::marker` | `font-variant-numeric: tabular-nums`（数字等宽） | L394-396 |
| `li > p` | `margin: 0`；`p + p` `margin-top: 0.25em` | L385-391 |
| `li > ul/ol` | `margin-top: 0.25em; margin-bottom: 0` | L398-402 |
| 任务列表 `li:has(> input[type=checkbox])` | `list-style: none`，`margin-left: -1.625em`，`padding-left: 0`；checkbox `margin: 0 0.5em 0 0`、`vertical-align: middle`、`accent-color: brand` | L404-418 |

### 2.4 引用块

| 属性 | 值 | 证据 |
|---|---|---|
| border-left | `2px solid var(--td-component-stroke)` | L421 |
| padding | `0.5em 0 0.5em 1.25em`（8px 0 8px 20px） | L422 |
| margin | `0.5em 0 0.75em`（8px / 12px） | L423 |
| color | `--td-text-color-secondary` | L424 |
| font-weight / style | `400` / `normal`（**不做斜体**） | L425-426 |
| 嵌套 quote | `margin-top: 0.35em; margin-bottom: 0` | L428-431 |
| 行高 | `blockquote` 与 `blockquote p` 都是 **`1.5`**（比正文 1.625 紧） | L434-437 |

### 2.5 行内元素

| 元素 | 值 | 证据 |
|---|---|---|
| `strong` | `font-weight: 600` | L89-91 |
| `em` | `font-style: italic` | L93-95 |
| `del` | `line-through` + **`opacity: 0.72`** | L97-100 |
| 行内代码 `code:not(pre code)` | bg `color-mix(text-primary 8%, transparent)`；padding `0.15em 0.3em`；radius `4px`；mono；`0.875em`(14px)；`500` | L116-123 |
| `kbd` | `inline-block`；padding `0.15em 0.45em`；mono；`0.8125em`(13px)；`500`；`line-height: 1.4`；bg secondarycontainer；border `1px`；radius `5px`；shadow `0 1px 0 color-mix(text-primary 8%, transparent)` | L102-114 |
| `a` | color brand；`text-decoration: underline`；`text-decoration-color: color-mix(brand 45%, transparent)`；`text-underline-offset: 0.18em` | L501-511 |
| `a:hover` | color brand-hover；`text-decoration-color: brand`（从 45% 变实色） | L507-510 |
| `hr` | `margin: 1.75em 0`(28px)；`border: none`；`border-top: 1px solid stroke` | L439-443 |
| `img` | 见 §4.6 | L584-596 |

### 2.6 断行与溢出策略（逐组件）

| 容器 | 规则 | 证据 |
|---|---|---|
| 用户气泡 | `word-break: break-word` + `overflow-wrap: anywhere` + `white-space: pre-wrap` | usermsg.vue L281-284 |
| 回答正文 | 无显式 word-break（跟随容器）；表格 `word-break: initial` | chat-markdown.less L525 |
| 思考正文 | `overflow-wrap: anywhere` | AgentStreamDisplay.vue L4414 |
| 工具参数预览 | `white-space: pre-wrap` + `word-break: break-word` | agent-interaction-card.less L183-184 |
| 工具输出 | `white-space: pre-wrap` + `word-break: break-word` + `max-height: 400px` + 双向滚动 | AgentStreamDisplay.vue L4289-4294 |
| citation 文本 | `max-width: 180px` + `text-overflow: ellipsis` | chat-citations.less L42-48 |
| 代码块 `code` | `white-space: pre` + `display: block` | chat-markdown.less L222-223 |
| 表格 | `word-break: initial`（**不动 CJK 断行**）+ `white-space: nowrap` 仅 th | L525 / L552 |
| Prompt 表单值 | `overflow-wrap: anywhere` | agent-interaction-card.less L313 |

---

## ③ 组件样式表

### 3.0 骨架布局（先定这个，组件才摆得对）

| 元素 | 值 | 证据 |
|---|---|---|
| `.chat` | `display:flex; flex-direction:column; align-items:center; min-width:400px; position:relative` | index.vue L2046-2063 |
| `.chat_thread` | `flex:1; min-height:0; overflow:hidden` | L2134-2142 |
| `.chat-topbar` | `flex: 0 0 var(--app-chat-header-height)`=40px；`padding: 0 12px 0 20px`；`border-bottom: 1px solid stroke`；`bg: container` | L2144-2155 |
| `.chat_scroll_box` | `flex:1; padding: 8px 0 0`；`overflow-y:auto`；`overscroll-behavior-y: contain`；`scroll-padding-bottom: var(--chat-composer-height)` | L2188-2199 |
| `.chat_scroll_content::after` | `flex: 0 0 var(--chat-composer-height)`（占位，防遮挡） | L2210-2213 |
| `.msg_list` | `gap: 16px`；`max-width: 960px`；非嵌入时 `max-width: calc(960px + 2*20px)` + `padding: 0 20px` | L2399-2412 |
| `.chat_composer` | `position:absolute; bottom:0; z-index:12`；`padding: 16px 0 max(8px, env(safe-area-inset-bottom))` | L2184-2192 |
| `.msg-item-wrapper` | `contain: layout style`（**不要**加 `contain: paint`，会裁掉 tooltip） | L2432-2436 |
| 骨架屏列表 | `gap:20px; max-width:960px; padding:16px 0; animation: contentFadeIn .3s ease-out` | L2300-2307 |

### 3.1 消息气泡

**用户消息（`usermsg.vue`）**

| 属性 | 值 | 证据 |
|---|---|---|
| 外层 | `display:flex; flex-direction:column; align-items:flex-end; gap:6px; width:100%` | L239-246 |
| 气泡 | `width: max-content`；`max-width: min(76%, 820px)`；`padding: 8px 12px`；`gap: 4px`；`border-radius: 8px`；`background: secondarycontainer`；`margin-left:auto` | L264-285 |
| 文字 | `font-size:16px`；`line-height:1.6`；`text-align:left`；`white-space: pre-wrap` | 同上 |
| 暗色 | 背景仍 `secondarycontainer`，文字 `primary`（**不加边框、不反色**） | L395-400 |
| 图片行 | `display:flex; gap:6px; justify-content:flex-end` | L287-293 |
| 附件卡 | `width:240px`；`padding: 8px 12px 8px 8px`；`gap:10px`；radius 8；bg secondarycontainer | L303-313 |
| 附件名 | 13px / 500 / 1.35 / primary / 单行省略 | L331-339 |
| 附件元信息 | 12px / 1.3 / placeholder / `margin-top:2px` | L341-347 |
| 图片缩略 | **120×120**；`object-fit: cover`；radius 6；`border: 1px solid var(--td-border-level-2-color)`；hover `opacity:.85`，`transition: opacity 200ms` | L350-362 |
| 渠道标签 | `padding: 1px 6px`；`border-radius: 3px`；`11px`；`500`；`line-height:18px`；变体：`.channel-web`(brand/brand-1/brand-2)、`.channel-api`(success)、`.channel-im`(warning) | L364-393 |
| 时间+操作条 | `min-height:28px`；`gap:8px`；`padding-right:4px`；`opacity:0 → 1`（hover/focus-within/`.is-actions-pinned`）；`transition: opacity 140ms ease` | L409-440 |
| 操作按钮 | `28×28`；radius 6；透明底；图标 16×16；hover bg container-hover + 文字 secondary | L442-468 |

**助手消息（`botmsg.vue`）**

| 属性 | 值 | 证据 |
|---|---|---|
| `.bot_msg` | `border-radius: var(--app-radius-xs)`(4px)；`width:100%`；`max-width:100%`；`margin-right:auto`；`font-size:16px` | L707-718 |
| **无气泡背景**（`background` 被注释掉，L708） | 回答直接落在页面底 | 同上 |
| 内容包装 | `padding: 2px 0` | L648-650 |
| 外链/文档链接 | `.doc-link`：`inline-flex; gap:4px; font-weight:450; color:brand; hover: brand-active + underline` | theme.css L164-180 |
| 图片 | `margin: 8px 0 8px 16px`（**左缩进 16px**，非居中）；`max-width:80%`；`max-height:300px`；`border:.5px`；`hover: scale(1.02)` | L689-705 |
| 加载 GIF | `24×18`；`margin-left:16px` | L720-724 |
| 加载占位块 | `230×230`；bg container-hover；radius 8；12px；`gap:4px`；`margin-left:16px` | L726-739 |
| 出现动画 | `fadeInUp`：`opacity 0→1` + `translateY(8px→0)`（botmsg 用 8px） | L677-687 |

### 3.2 思考块（两代并存，必须分清）

**A. 独立「深度思考」卡 `deepThink.vue`（旧版，带边框的卡）**

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `border-radius:8px`；bg container；`border: .5px solid stroke`；`box-shadow: 0 2px 4px brand 8%`；`margin: -8px 0 10px`（**负上边距**，让卡贴上一条消息） | L83-95 |
| 过渡 | `transition: all .25s cubic-bezier(0.4,0,0.2,1)`（字面量，守卫记为技术债） | L94 |
| 头部 | `padding: 6px 14px`；`font-weight:500`；`cursor:pointer`；hover bg brand 4% | L97-109 |
| 进行态圆点 | `6×6` 圆；brand；`animation: pulse-dot 1.8s ease-in-out infinite`（scale .85/1.1，opacity .6/1） | L129-135、L207-216 |
| 进行态光环 | `inset:0`；`border: 1.5px solid brand`；`animation: pulse-ring 1.8s ease-out infinite`（scale .5→1.2，opacity .6→0） | L137-144、L218-227 |
| 状态文字 | `12px`；primary；`white-space:nowrap` | L147-151 |
| 完成图标 | `16×16`；`margin-right:8px` | L158-162 |
| 折叠箭头 | `font-size:14px`；brand；`transition: transform 200ms` | L171-178 |
| 内容区 | `border-top: 1px solid secondarycontainer`；内层 `padding: 8px 14px`；`12px`；`line-height:1.6`；secondary；`max-height:200px`；`overflow-y:auto`；`word-break:break-word`；`white-space:pre-wrap` | L182-193 |
| 内容滚动条 | `width:4px`；thumb `rgba(0,0,0,.1)` radius 2（暗色 `rgba(255,255,255,.15)`） | L195-202、L229-237 |

**B. 时间线内联思考（新，无边框，主流形态）**

| 属性 | 值 | 证据 |
|---|---|---|
| 行容器 | 参与 `.tree-child` 几何（见 §3.3） | AgentStreamDisplay.vue |
| `.thinking-inline-content` | `flex:1; min-width:0`；`font-size: var(--agent-step-summary-size)`=13px；`color: var(--agent-step-color)`；`line-height:1.6`；`overflow-wrap:anywhere`；`user-select:text` | L4408-4416 |
| `.thinking-detail-content` | `padding: 7px 0 0 0`（覆盖左 30px 版本）；13px；`color: var(--agent-step-color)`；`max-height:none`；`overflow-y:visible` | L4390-4396 |
| 活动窗口（只露最后 5 行） | `display:flex; flex-direction:column; justify-content:flex-end`；**`max-height: calc(1.6em * 5)`** = 104px；`overflow:hidden`；溢出时 `mask-image: linear-gradient(to bottom, transparent, #000 1.6em)` | L4427-4439 |
| 正文首末段归零 | `:deep(.thinking-inline-markdown > :first-child){margin-top:0}` / `> :last-child{margin-bottom:0}` | L4417-4423 |
| 思考正文不套回答体排版 | 明确注释：紧凑思考面板**不**复用 answer 的 Markdown 排版；只在 `.markdown-content` 变体里额外挂 `.chat-citation-pills()` | L3796-3800 |
| 灯泡图标锚定 | 折叠时 `position: static`，让 18×18 灯泡贴 24px 高的头部而不是标题行 | L4402-4406 |

### 3.3 Agent 时间线几何（工具调用卡的外层骨架）

| 元素 | 值 | 证据 |
|---|---|---|
| `.agent-stream-display` | `display:flex; flex-direction:column; gap:0; margin-bottom:10px; position:relative` | L3658-3662 |
| `.tree-container` | `margin: 0 0 16px` | L3718-3721 |
| `.tree-children` | `margin-top:14px; margin-left:10px; border-left:0` | L3737-3745 |
| `.tree-child` | `padding-left:42px`；`margin-bottom:14px` | L3747-3751 |
| 主干竖线 `::before` | `left:9px; top:22px; bottom:-14px; width:0; border-left:1px solid var(--agent-step-line-color)` | L3755-3763 |
| 无图标行（progress） | `::before { top: 0 }` | L3766 |
| 最后一节 `.tree-child-last` | `margin-bottom:0`；`::before { content:none }`（线在此收口） | L3774-3780 |
| 图标 | `position:absolute; left:-42px; top:3px; width:18px; height:18px; color: var(--agent-step-icon-color)` | L4478-4488 |
| 行容器 `.action-header` | `min-height:24px`；`padding:0`；`cursor:pointer`；`transition: background-color 150ms`；**hover 背景透明**（不留 hover 底） | L3938-3960 |
| 行标题 `.action-name` | `font-size:14px`；`400`；`line-height:1.55`；`color: var(--agent-step-color)`；单行省略；`max-width:100%` | L4052-4062、L4490-4497 |
| 行摘要 `.action-summary` | `13px`；`color: var(--agent-step-color)`；单行省略 | L4504-4507 |
| 行内徽标 `.action-badge` | `padding: 0 6px`；`height:18px`；`border-radius:9px`；`background: var(--stream-brand-10)`；`color: color-mix(brand 80%, secondary)`；`11px`；`500` | L4003-4015 |
| 展开箭头 `.action-show-icon` | `12px`；`padding: 0 2px`；placeholder | L4148-4153 |
| 参数/详情区 | `padding:0`；无上边框；透明底 | L4155-4161 |
| 推理折叠按钮 | `20×20`；`margin-left:-6px`；radius 6；`color: var(--agent-step-icon-color)`；`opacity:.6`；hover/focus/`.is-open` → `opacity:1` + bg container-hover | L4084-4107 |
| 事件行 | `.event-item{ margin-bottom:8px }`；`tree-child + answer` 时 `margin-top:16px` | L3701-3715 |
| 出现动画 | `animation: fadeInUp .25s ease-out`（**6px** 位移版本） | L3805、L3850、L4028-4038 |

### 3.4 工具调用卡 / 工具结果

**外层（时间线内，无卡面）**

| 属性 | 值 | 证据 |
|---|---|---|
| `.action-card` | `background: transparent`；`border: 0`；`border-radius: 0`；`box-shadow: none`；`overflow: visible`；`transition: border-color 200ms` | L3852-3891 / L4353-4374 |
| 错误态 | `.action-error { color: var(--td-error-color) }`（**只染色，不加红底/红框**） | L3882-3884 |
| 待执行态 | `.action-pending`：`opacity:1`；`background:transparent`；**标题走 shimmer**（见 §6） | L3886-3890 |
| 可点引用态 | `.reference-trigger:hover` 时 `.action-name`/`.results-summary-text` → primary | L3871-3880 |
| 工具摘要块 `.tool-summary` | `padding: 6px 12px`；`12px`；`500`；bg container；`border-top: 1px solid stroke`；`line-height:1.6`；`animation: slideIn .2s ease-out`（`translateX(-6px)→0`） | L3893-3901、L4040-4050 |
| 摘要内 Markdown | `400`；`p{margin:3px 0}`；`ul/ol{margin:3px 0; padding-left:18px}`；行内 `code{ bg secondarycontainer; padding:2px 5px; radius:3px; font-size:11px; color:brand; 500 }`；`strong{600; primary}` | L3903-3934 |
| diff 统计 | `gap:6px`；`margin-left:4px`；`12px`；`600`；`letter-spacing:.02em`；`.diff-add` success、`.diff-del` error | L4064-4082 |
| 工具输出容器 | `margin:10px 0`；`padding: 0 8px`；内部 `.detail-output-wrapper` bg secondarycontainer + `1px` border + radius 6 | L4256-4281 |
| 工具输出正文 | mono；`11px`；`padding:12px`；`white-space:pre-wrap`；`word-break:break-word`；`line-height:1.6`；`max-height:400px`；bg container；滚动条 `6px`（thumb `--td-bg-color-component-disabled`，radius 3） | L4283-4316 |
| 工具参数区 | `margin-top:8px`；`padding: 0 10px`；标签 `12px/600/uppercase/letter-spacing:.5px`；代码 `12px`；bg container；`padding:10px`；radius 6；`border:1px solid stroke`；`line-height:1.5` | L4320-4349 |
| 沙箱文件预览 | `margin: 6px 0 0`；`padding: 8px 10px`；mono；`12px`；`line-height:1.5`；bg secondarycontainer；radius 6；`pre{max-height:180px; white-space:pre-wrap}` | L4123-4140 |

**通用结果卡（`tool-results.less`，供各 ToolResult 子组件）**

| 变量/类 | 值 | 证据 |
|---|---|---|
| `@relevance-high/medium/low/weak` | success / warning / placeholder / disabled | L7-10 |
| `@card-bg` / `@card-border` / `@card-hover-border` | container / stroke / brand | L13-15 |
| `@card-radius` | `6px`（字面量） | L16 |
| `@card-shadow` | `0 1px 2px rgba(0,0,0,.04)`；hover `0 2px 6px brand 8%` | L17-18 |
| `@transition-time` | `0.2s` | L21 |
| `.tool-result-container` | `margin: 12px 0` | L24-26 |
| `.relevance-badge` | `padding:2px 6px`；radius 3；`11px`；`600`；`line-height:1.4`；底：high `rgba(0,168,112,.12)`、medium `rgba(255,152,0,.12)`、low `rgba(117,117,117,.12)`、weak `rgba(189,189,189,.12)` | L29-58 |
| `.match-type-badge` | `padding:2px 6px`；radius 3；`10px`；bg secondarycontainer | L61-71 |
| `.result-card` | bg container；`1px` border；radius 6；hover 换 brand 边 + 品牌阴影 | L74-87 |
| `.result-header` | `padding:10px 12px`；`gap:8px`；`cursor:pointer`；hover bg brand 4% | L89-108 |
| `.result-title` | `13px`；`500`；`line-height:1.4`；`gap:6px` | L110-118 |
| `.result-meta` | `11px`；secondary；`gap:6px` | L120-127 |
| `.result-content`（折叠） | `max-height:0; opacity:0; padding:0`；`transition: max-height/opacity/padding .2s ease`；展开 `.expanded{ max-height:2000px; opacity:1; padding:12px }` | L129-143 |
| `.expand-icon` | `12px`；placeholder；展开 `rotate(180deg)` | L145-153 |
| `.stats-card` | bg brand 4% + `1px border brand 15%` + radius 6 + `padding:10px 12px` | L195-201 |
| `.card-grid` | `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`；`gap:10px` | L225-230 |
| `.list-item` | `padding: 6px 0`；`border-bottom:1px` | L233-243 |
| `.content-preview` | `12px`；`line-height:1.6`；`max-height:60px`；`-webkit-line-clamp:3` | L246-256 |
| `.full-content` | `12px`；`1.6`；`padding:10px`；bg secondarycontainer；radius 4 | L259-269 |
| `.action-button` | `padding:4px 10px`；`11px`；radius 4；`1px` border；hover 品牌边+品牌字+brand 4% 底 | L272-288 |
| `.empty-state` | `padding:20px`；居中；placeholder；`12px`；**`italic`**；bg secondarycontainer；radius 6；`1px dashed` | L291-300 |
| `.code-block` | mono；`11px`；bg secondarycontainer；`padding:8px`；radius 4；`1px` border | L303-312 |

### 3.5 进度表达（**没有进度条**）

> 已核实：Agent 输出区**不存在线性进度条**（全仓 `views/chat` 内无 `.progress-bar` / `width: N%` 的进度填充，`RagPipelineProgress.vue` 的 `tree-root-toolbar` 只是排布行，L618-678、L145）。进度用的是**四种词法**：

| 词法 | 实现 | 值 | 证据 |
|---|---|---|---|
| ① 行内文字扫光 | `.chat-stream-shimmer-text()` | `linear-gradient(100deg, placeholder 0%, placeholder 36%, primary 50%, placeholder 64%, placeholder 100%)`；`background-size:200% 100%`；`background-clip:text`；`animation: chatStreamShimmer 1.5s linear infinite`；`will-change:background-position` | chat-timeline-loading.less L15-36 |
| ② 旋转 spinner | `.chat-global-wait__spinner` | `12×12`；`border: 1.5px solid stroke`；`border-top-color: secondary`；`border-radius:50%`；`animation: wk-spin .8s linear infinite` | index.vue L2418-2426 |
| ③ 暂停点脉冲 | 子代理运行点 | `6×6`；brand；`box-shadow: 0 0 0 0 brand 45% → 0 0 0 5/6px transparent`；`1.6s ease-out infinite` | ChildAgentTabBar L86-89；ChildAgentStream L164-167 |
| ④ 整行扫光（子任务） | `.child-task-row.is-running::before` | `inset: -2px -6px`；`linear-gradient(100deg, transparent 30%, primary 5% 50%, transparent 70%) 0 0 / 250% 100%`；`2.8s ease-in-out infinite` | CollaborationTasks.vue L55-69 |

**进度行（RAG 管线）结构**

| 属性 | 值 | 证据 |
|---|---|---|
| `.rag-pipeline-progress` | `margin:0`；继承 timeline theme | RagPipelineProgress.vue L592-596 |
| `.tree-container` | `margin: 0 0 8px` | L610-613 |
| 根行展开按钮 | `font-size:14px`；`line-height:22px`；`gap:6px`；hover 只变色不变底 | L626-647 |
| 根行分隔点 | `3×3` 圆；`background: currentColor`；`opacity:.65` | L661-669 |
| 折叠/展开间距差 | `.tree-children-expanded { margin-top: 14px }` | L687-689 |
| 思考步正文（RAG 版） | `margin-top:4px`；`padding:0`；13px；`line-height:1.55`；`white-space:pre-wrap`；`max-height:200px`；可滚 | L803-815 |

### 3.6 引用角标与来源列表

**角标（药丸）`chat-citations.less`**

| 属性 | 值 | 证据 |
|---|---|---|
| `.citation` | `inline-flex`；`align-items:center`；`gap:2px`；`vertical-align: baseline`；`border-radius: 999px`；`padding: 0 5px`；**`font-size: 0.72em`**（@16px = 11.5px）；`line-height: 1.45`；`margin: 0 0.06em`；`background-clip: padding-box`；`transform: translateY(-0.04em)` | L2-15 |
| 角标图标 | `1em × 1em`；`background-color: currentColor`；`opacity: .68`；`mask-size: contain`；mask 图：`ziliao.svg`（书）/ `websearch-globe.svg`（网页） | L17-40 |
| 角标文字 | `line-height:1.45`；`max-width:180px`；省略号 | L42-48 |
| `.citation-kb` / `.citation-web` | bg `text-primary 6%`；color secondary；**`border: 0`**（注释：不加描边，避免像按钮抢正文）；`white-space: nowrap`；`transition: background 150ms, color 150ms` | L50-61 |
| hover | bg `text-primary 10%`；color primary | L63-67 |
| focus-visible | `outline: 2px solid var(--td-component-border)`；`outline-offset: 2px` | L69-73 |
| 实体链接（wiki/weknora） | color brand；`border-bottom: 1px dashed brand`；`500`；hover 变 solid | L79-98 |
| 纯引用段压缩 | `p:has(> .citation:only-child){ margin: .125em 0 .375em }` | chat-markdown.less L49-52 |

**引用浮层（hover 预览）**

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `position:absolute`；`z-index:10000`；**`width:300px`**；`max-width: calc(100vw - 32px)`；`padding: 10px 12px 12px`；`border: .5px solid stroke`；`border-radius: 10px`；bg container；阴影 `0 2px 4px 4%, 0 6px 20px 8%`；`12px`；`line-height:1.6`；`overflow-wrap:anywhere` | L101-117 |
| 出现动画 | `animation: chat-citation-float-in 150ms ease-out both`（`opacity 0` + `translateY(-4px)`） | L117、L201-206 |
| 头部 | `gap:6px`；`padding-bottom:8px`；`margin-bottom:8px`；`border-bottom:1px solid stroke` | L119-126 |
| 头部图标 | `14×14`；`margin-top:3px`；placeholder 色 | L128-132 |
| 标题 | `13px`；`500`；`line-height:20px`；**`-webkit-line-clamp:2`** | L152-162 |
| 链接行 | `12px`；secondary；单行省略；hover brand | L164-175 |
| 摘录 | `-webkit-line-clamp:7`；`white-space:pre-line`；secondary | L178-186 |

**来源列表（`docInfo.vue`）**

| 属性 | 值 | 证据 |
|---|---|---|
| `.refer` | `12px`（整体）；`border-radius:8px`；bg container；`border:.5px solid stroke`；`box-shadow: 0 2px 4px var(--refer-brand-8)`；`margin-bottom:8px`；`transition: all .25s cubic-bezier(.4,0,.2,1)` | L215-232 |
| 头部 | `padding: 6px 14px`；`500`；hover bg brand 4% + `cursor:pointer` | L313-343 |
| 头部标题 | `12px`；`gap:4px`；`white-space:nowrap` | L320-330 |
| 展开箭头 | `14px`；`padding: 0 2px 1px 2px`；brand | L332-337 |
| 主体 | `padding: 4px 14px 8px 14px`；`border-top: 1px solid secondarycontainer` | L345-349 |
| 文档链接 `.doc` | brand；`line-height:20px`；`padding:2px 0`；`border-bottom: 1px dashed brand`；`max-width: calc(100% - 24px)`；hover bg brand 8% + `padding-right:4px` + radius 3 | L360-384 |
| 分组头 | `padding: 4px 4px`；radius 4；hover bg brand 4% | L386-400 |
| 分组标题 | `500`；`max-width:200px`；省略 | L421-428 |
| 分组计数 | `11px`；placeholder；`margin-left:6px` | L430-436 |
| 跳转图标按钮 | `22×22`；radius 4；brand；hover bg brand 12% | L443-458 |
| 分组块缩进 | `padding-left: 22px` | L461-463 |
| chunk 行 | `12px`；`line-height:18px`；`padding:3px 6px`；radius 4；hover bg brand 4% + brand 字 | L466-490 |
| timeline 变体（`.refer-timeline`） | 圆角 0；无边框无阴影；字号升到 13px；**品牌色被替换为 placeholder**（`--td-brand-color: var(--td-text-color-placeholder)`），`--refer-brand-*` 改为 text-primary 4/6/8% | L234-311 |
| 浮层 `.refer-to-layer` | `width:400px`；`max-width:500px`；内容 `max-height:400px` 可滚 | L494-507 |

### 3.7 Artifact 卡（三种形态）

**A. 行内引用卡（回答正文里，`artifact-ref-card`）**

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `inline-flex`；`align-items:center`；`gap:12px`；**`width:420px`**；`max-width: min(420px,100%)`；`margin: .75em 0`；`padding: 12px 8px`；`border-radius:8px`；**背景透明**；`cursor:pointer`；`vertical-align:middle`；`text-align:left`；`transition: background 150ms` | chat-markdown.less L645-669 |
| hover | `background: var(--td-bg-color-container-hover)` | L661-663 |
| focus-visible | `outline: 2px solid var(--td-text-color-secondary)`；`outline-offset:2px` | L665-668 |
| 图标框 | `32×38`（非正方，纸形比例） | L702-709 |
| 文件名 | `13px`；`500`；`letter-spacing:.01em`；`line-height:1.35`；单行省略 | L722-731 |
| 副行（hint） | `margin-top:2px`；`12px`；`1.3`；placeholder | L733-738 |
| 快操作按钮（存知识库/装技能） | `28×28`；`margin-left:2px`；radius 6；placeholder；hover → brand + bg container-hover | L740-781 |
| `--pending`（引用了不存在的产物） | `opacity:.7`；`cursor:default`；hover 不变底 | L672-679 |
| `--deleted`（生成过但已删） | 图标 `opacity:.45` + `filter:grayscale(1)`；文件名 placeholder + `line-through`（`text-decoration-thickness:1px`） | L683-700 |

**B. 打开页面卡（`OpenPageCard`）**

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `flex column`；**`width:360px`**；`max-width:100%`；`margin-top:8px`；`padding:0`；`border:1px solid stroke`；`border-radius:8px`；bg secondarycontainer；`box-shadow: 0 1px 2px 3%`；`cursor:pointer` | OpenPageCard.vue L104-144 |
| hover | bg secondarycontainer-hover；border → component-border；`.go` 变 primary | L123-130 |
| 主行 | `gap:10px`；`padding:12px` | L146-154 |
| 图标 | `28×28`；radius 6；bg container | L156-166 |
| 标题 | `14px`；`600`；`1.5` | L182-187 |
| 元信息 | `margin-top:2px`；`12px`；`1.5`；placeholder | L189-194 |
| 尾部附加区 | `margin: 0 12px`；`padding: 8px 0 10px`；`border-top:1px solid stroke`；`12px` | L207-217 |
| endpoint 代码 | mono；secondary；`overflow-wrap:anywhere` | L225-238 |

**C. 页面编辑卡（`PageEditCard`）**

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `flex column`；`gap:8px`；`width:360px`；`margin-top:8px`；`padding: 8px 10px 10px 8px`（不对称）；radius 8；bg secondarycontainer | PageEditCard.vue L63-75 |
| 图标 | `36×36`；radius 8；bg container；brand | L84-94 |
| eyebrow | `12px`；`line-height:18px`；placeholder | L108-112 |
| 标题 | `13px`；`500`；`1.35` | L114-119 |
| 列表 | `gap:4px`；`margin-left:2px`；`12px`；`1.6` | L126-141 |
| 标签列 | `max-width:40%`；单行省略；secondary | L143-150 |
| 脚注 | `padding-top:8px`；`border-top:1px`；`12px`；`18px` 行高 | L158-167 |

**D. 产物列表项（`ChatArtifactsPanel` / `ChatArtifactsDrawer`）**

| 属性 | 面板 | 抽屉 | 证据 |
|---|---|---|---|
| 行 | `padding: 12px 8px`；`gap:12px`；radius 8；hover bg container-hover | `padding: 10px 4px`；`gap:10px`；`border-bottom:1px`；radius 8 | L560-575 / L607-630 |
| 图标 | — | `28×28`；radius 6；bg secondarycontainer；hover 变 brand | L632-644 |
| 文件名 | `13px`；`500`；`.01em`；`1.35` | `14px`；`600`；`.01em`；`1.35` | L633-643 / L651-660 |
| 元信息 | `margin-top:2px`；`12px`；`1.3`；`gap:4px` | 同 | L645-653 / L662-670 |
| 头 | `padding: 8px 12px`；`border-bottom:1px`；标题 `13px/600/1.4` | 头高 = **40px**（`--app-chat-header-height`）；`padding: 0 12px`；标题 `14px/500/20px` | L476-514 / L731-745 |
| 空态 | `padding: 32px 16px`；`gap:8px`；placeholder；`13px` | `padding: 48px 16px`；`13px` | L524-535 / L590-599 |
| 下载按钮 | `30×30`；radius **7px**；hover bg `text-primary 10%` + container；active 16%；删除态 hover → `--td-error-color-1` 底 + error 字 | 同（用 t-button 默认） | L666-696 |

### 3.8 AskUser 卡（`AskUserCard`，走 `agent-interaction-card.less`）

| 属性 | 值 | 证据 |
|---|---|---|
| 标题行 gap | `column-gap:8px; row-gap:4px`；`.action-name` 降为 13px | AskUserCard.vue L258-265 |
| 状态徽标 | `padding:1px 6px`；radius 4；bg secondarycontainer；secondary；`11px`（fallback 写 12px）；`1.5` | L268-275 |
| 问题文字 | `margin-top:6px`；13px；**`line-height:1.65`**；secondary；`pre-wrap`；`overflow-wrap:anywhere` | L277-284 |
| 字段 | `flex column`；`gap:6px` | L286-290 |
| 字段标签 | 13px；`1.55`；secondary | L292-296 |
| 选项网格 | `grid-template-columns: repeat(auto-fit, minmax(min(100%,150px),1fr))`；`gap:6px`；`max-height:200px`；`overscroll-behavior:contain`；`padding:2px` | L302-310 |
| 选项 | `gap:8px`；`padding: 9px 10px`；`border:1px solid stroke`；radius 8；bg container；13px；`1.5`；`transition: background 150ms, border-color 150ms` | L312-336 |
| 选项 hover / 选中 / 禁用 | hover bg container-hover；选中 bg secondarycontainer + border component-border；禁用 `opacity:.5` | L328-334 |
| 勾选标记 | `15×15`；`1px solid component-border`；radius 4（fallback 3px）；未选 `color:transparent`；选中 brand 底 + anti 字 | L339-354 |
| 输入框（填充式） | `min-height:32px`；**`border-color: transparent`**；radius 8；bg secondarycontainer；`box-shadow:none`；13px | L358-372 |
| 输入聚焦 | `border-color: color-mix(brand 45%, stroke)`；bg container | L374-379 |
| 回答回显块 | `gap:4px`；`margin-top:10px`；`padding: 10px 12px`；radius 8；bg secondarycontainer | L395-403 |
| 回显标签 / 正文 | 标签 12px/1.5/secondary；正文 14px/1.6/primary/`pre-wrap` | L405-417 |
| 必填星号 | `margin-left:2px`；error 色 | L419-422 |

### 3.9 审批卡（`ToolApprovalCard`）

| 属性 | 值 | 证据 |
|---|---|---|
| 标题 | `.action-title` column-gap 8 / row-gap 4；名称 13px；`white-space:normal`；`overflow-wrap:anywhere` | L440-444 |
| 状态徽标 | `padding:1px 6px`；radius 4；bg secondarycontainer；secondary；**`11px`**（`var(--app-text-xs, 12px)`，主值 11）；`line-height:1.5` | L446-453 |
| 标题按钮 | `inline-flex`；`gap: 4px 8px`；透明；`font: inherit`；hover → primary | L455-474 |
| 任务摘要 | placeholder 色；13px；`overflow-wrap:anywhere` | L475-479 |
| 参数块 | `margin-top:10px`；radius 8；bg secondarycontainer；`overflow:hidden` | L486-491 |
| 参数折叠行 | `gap:8px`；`padding: 10px 12px`；12px；`1.5`；箭头 `margin-left:auto`；`focus-visible` offset **-2px**（内嵌） | L493-511 |
| 参数内容 | `padding: 0 12px 12px`；`max-height:280px`；`overflow:auto`；12px；`1.6`；`pre-wrap` | L520-530 |
| 参数标签 | `padding: 10px 12px 6px`；secondary；12px | L480-484 |
| 工具描述 | `margin-top:8px`；12px；secondary；`.prompt-desc{max-height:180px; overflow-y:auto}` | L534-537 |

### 3.10 错误呈现（**没有独立错误条组件**）

| 场景 | 视觉 | 值 | 证据 |
|---|---|---|---|
| 工具行失败 | **仅换文字色**，不加红底/红框/图标 | `color: var(--td-error-color)` = `#e34d59`(亮) / `#c64751`(暗) | AgentStreamDisplay.vue L3882-3884、L4367-4369 |
| 代码块复制失败 | 按钮文字变 error | `.chat-code-block__copy.is-error{ color: var(--td-error-color) }` | chat-markdown.less L198-200 |
| 子代理流失败 | 12px 级正文行 | `.child-stream-error{ color: error; margin: 12px 0 }` | ChildAgentStream.vue L172 |
| Shell 非零退出码 | `.is-error` 仅染色 | tool-results/ShellExecResult.vue L143 | — |
| 计时器告警/超时 | warning / error 色 | `.timer-warning`/`.timer-critical` | agent-interaction-card.less L72-78、L163-169、L487-493 |
| 用户消息发送失败 | 12px；error；右侧对齐；重试按钮 `26×26` | usermsg.vue L404-407 |
| 图片链接非法 | 退化为 `<p>` 文案 | `invalidImageHtml`，botmsg.vue L423 | — |

> 复刻提示：WeKnora 的「错误」几乎是**零装饰**的（只染字色）。若你复刻时加了红色 Alert 块，就与原版不一致。

### 3.11 复制 / 操作条

**回答操作条（`.answer-toolbar`）**

| 属性 | 值 | 证据 |
|---|---|---|
| 布局 | `flex`；`justify-content:flex-start`；`gap:2px`；`margin-top:10px`；**`margin-left:-5px`**（抵消按钮内边距，视觉左对齐正文）；`min-height:28px` | chat-message-shared.less L3-14 |
| 默认态 | `color: color-mix(text-primary 55%, transparent)`；**`opacity:0`；`pointer-events:none`**；`transition: opacity 150ms ease` | 同 |
| 显示条件 | `.bot_msg:hover` / `:focus-within` / `.agent-stream-display:hover` / `:focus-within` / `.answer-toolbar--persistent` → `opacity:1; pointer-events:auto` | L92-99 |
| 触屏 | `@media (hover:none)` → 常显 | L101-106 |
| 按钮 | `28×28`；`padding:0`；`border:none`；radius 6；透明；`box-shadow:none`；`transition: background-color 150ms, color 150ms` | L17-30 |
| 图标 | `16×16`；`font-size:16px`；`stroke-linecap:round; stroke-linejoin:round` | L46-65 |
| hover / active | bg `text-primary 5%` / `9%`；文字 → secondary | L67-83 |
| focus-visible | `outline: 2px solid var(--td-brand-color-focus)`；offset 2 | L85-88 |
| 产物角标 | `top:-2px; right:-2px`；`min-width:14px; height:14px`；`padding: 0 3px`；`border-radius:7px`；brand 底 + anti 字；`10px/600/1`；`tabular-nums` | L147-167 |
| 产物到达动画 | `artifact-toolbar-arrive .7s cubic-bezier(.22,1.2,.36,1)`（scale .82→1.12→1）；角标 `artifact-count-arrive .7s cubic-bezier(.22,1.4,.36,1)`（scale .4/opacity0 → 1.28 → 1） | L120-187 |
| 收藏中 | 按钮色 → placeholder；`cursor: wait`；spinner `wk-spin .8s` | L124-131 |
| 后续问题加载 | `gap:5px`；`height:18px`；`margin-left:5px`；`padding-left:9px`；`border-left:1px solid stroke`；12px；placeholder；文字走 shimmer `1.5s linear infinite` | L196-236 |
| 该行出现/离开 | `.16s ease` + `transform .16s cubic-bezier(.4,0,.2,1)`；enter `translateX(-3px) scale(.92)`；leave `translate(4px,3px) scale(.82)`；`transform-origin: left center` | L238-252 |

### 3.12 输入框（`Input-field.vue`）

| 属性 | 值 | 证据 |
|---|---|---|
| `.answers-input` | `position:absolute`；`z-index:99`；`bottom:60px`；`left:50%`；`translateX(-50%)`；`width:100%`；`flex column align-items:center` | L3408-3417 |
| `.rich-input-container` | `width:100%`；**`max-width:960px`**；bg container；`border-radius:12px`；`border:1px solid stroke`；`box-shadow: 0 2px 8px 4%, 0 8px 16px -4px 6%` | L3501-3508 |
| 聚焦 | `border-color: var(--td-brand-color)`（**只换边框色，不加外发光**） | L3510-3512 |
| textarea | `max-height:152px !important`；`min-height: var(--composer-input-min-height,72px) !important`；`resize:none`；`font-size:16px`；`400`；**`line-height:24px`**；`padding: 12px 16px`；`border-radius: 0 0 12px 12px`；无边框无阴影；透明底 | L3677-3706 |
| textarea（无标签时） | `border-radius:12px`；`padding-top:16px` | L3709-3712 |
| placeholder | 同字号 16px / 400 / 24px；placeholder 色 | L3699-3705 |
| 选中标签条 | `gap:6px`；`padding: 12px 16px 0`；bg container；`border-radius: 11px 11px 0 0` | L3516-3525 |
| 标签条存在时 textarea | `padding-top:8px` | L3527-3529 |
| mention chip | `min-height:26px`；`padding: 3px 7px 3px 6px`；radius 6；`12px/500/18px`；去掉按钮 `14×14`；图标 `16×16`；名称 `max-width:100px`；agent 类 chip 用**虚线边框** | L3531-3675 |
| 控制栏 | `margin: 0 12px 12px`；`padding-top:8px`；`gap:8px`；`z-index:10` | L3715-3725 |
| 控制按钮 | `padding: 6px 10px`；radius 6；secondary；`transition: background 120ms, color 120ms`；禁用 `opacity:.5` | L3775-3802 |
| agent 模式按钮 | `height:28px`；`padding: 0 8px 0 10px`；`margin-right:4px`；**radius 999（pill）**；bg secondarycontainer；`500` | L3804-3814 |
| 图标按钮（KB/图片/语音/附件/联网/生图/浏览器） | 统一 `28×28`；`padding:0`；hover bg secondarycontainer-hover + primary；`.active` bg secondarycontainer + brand | L3841-4173 |
| 图标尺寸 | `18×18`（compact 下 `16×16`） | L3841-3844、L3760-3763 |
| 计数角标（图片/附件） | `top:-2px; right:-2px`；`14×14`；圆形；brand 底；anti 字；`10px` | L3914-3928、L3998-4012 |
| **发送 / 停止按钮** | `28×28`；`border-radius:50%`；`padding:0`；`font-size:16px`；brand 底 + `#fff`；hover → brand-active；禁用 → bg `--td-bg-color-component` + placeholder 字（`opacity:1`，**靠换底不靠降透明**） | L4223-4260 |
| 图片预览条 | `gap:8px`；`padding: 8px 12px 4px` | L4015-4020 |
| 图片缩略 | `60×60`；radius 8；`1px solid var(--td-border-level-1-color)`；删除钮 `16×16`；`rgba(0,0,0,.5)`；hover `.7` | L4022-4056 |
| steer 队列 | `width: calc(100% - 24px)`；`max-width:936px`；`max-height:140px`；bg secondarycontainer；`border:1px`；`border-bottom:0`；`border-radius: 10px 10px 0 0` | L3433-3443 |
| 队列行 | `gap:8px`；`padding: 4px 12px`；分隔 `border-top:1px`；文字 13px/1.5 单行省略；按钮 `26×26` radius 6 | L3445-3495 |
| 紧凑模式 `.is-compact` | `--composer-input-min-height:56px`；textarea `padding: 12px 14px`；控制栏 `margin: 0 12px 8px`、`padding-top:4px`；图标 16×16 | L3748-3764 |

### 3.13 Prompt 停靠卡（`PendingPromptDock`）

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `max-width:960px`；`margin: 0 auto 8px`；bg container；`1px solid stroke`；**radius 12**；阴影同输入框；`transition: border-color 150ms` | L176-186 |
| focus-within | `border-color: color-mix(brand 45%, stroke)` | L188-190 |
| 头部 | `min-height:34px`；`padding: 6px 8px 0 14px`；`gap:6px`；收起时 `padding-bottom:6px` + `cursor:pointer` | L198-206 |
| 标题 | `flex:1`；12px；secondary；单行省略 | L214-222 |
| 计数 | `min-width:36px`；12px；`tabular-nums`；居中 | L236-242 |
| 小按钮 | `24×24`；radius 6；placeholder；hover container-hover + primary；禁用 `opacity:.35` | L244-269 |
| 主体 | `max-height: min(50vh, 440px)`；`padding: 6px 14px 12px`；`overscroll-behavior:contain` | L271-276 |
| 出现/离开 | `200ms ease`；`translateY(6px)` + opacity | L278-287 |
| 内部 prompt 表单 | 见 agent-interaction-card.less L259-544：`.prompt-panel` gap 10；`.prompt-question` 14px/1.55/500/`pre-wrap`；`.prompt-desc` 13px/1.55/`pre-line`/`max-height: calc(1.55em*8)`；`.prompt-fields` 网格 `fit-content(120px) minmax(0,1fr)`、`column-gap:16px`、`row-gap:6px`、`padding:10px 12px`、radius 8、bg secondarycontainer、`max-height: calc(1.55em*9 + 20px)` | — |
| 选项行 | `gap:10px`；`padding: 6px 8px`；radius 8；14px/1.5；hover/focus 底 container-hover；禁用 `opacity:.6` | L341-378 |
| 选项键帽 | `20×20`；radius 6；bg secondarycontainer；12px/500/secondary；选中时 brand 底 + anti 字 | L380-393 |
| prompt 主按钮 | `height:28px`；`padding: 0 12px`；radius 8；`.is-primary` brand 底 + anti 字，hover brand-hover；禁用 `opacity:.45` | L504-538 |

### 3.14 按钮变体汇总

| 变体 | 尺寸 | 圆角 | 底 | 字 | hover | 禁用 | 证据 |
|---|---|---|---|---|---|---|---|
| 主按钮（发送/停止） | 28×28 | 50% | `--td-brand-color` | `#fff` | brand-active | bg component + placeholder | Input-field L4223-4260 |
| prompt 主按钮 | h28 × padding 0 12 | 8px | brand | anti | brand-hover | opacity .45 | agent-interaction-card L524-536 |
| prompt 次按钮 | h28 × padding 0 12 | 8px | transparent | secondary | container-hover + primary | opacity .45 | L504-523 |
| 图标按钮（操作条） | 28×28 | 6px | transparent | primary 55% | bg 5% | — | chat-message-shared L17-88 |
| 图标按钮（输入框） | 28×28 | 6px | transparent | secondary | secondarycontainer-hover | opacity .5 | Input-field L3775-3802 |
| 小图标按钮（dock） | 24×24 | 6px | transparent | placeholder | container-hover | opacity .35 | PendingPromptDock L244-269 |
| 下载按钮 | 30×30 | **7px** | transparent | secondary | bg text-primary 10% | — | ChatArtifactsPanel L666-696 |
| 工具结果 action | h≈? × padding 4 10 | 4px | container | secondary | brand 边/brand 字/4% 底 | — | tool-results L272-288 |
| 分页/关闭 tab 钮 | 22×22 | 4px | transparent | placeholder | — | — | ChildAgentTabBar L73 |
| 渠道标签 | h18 | 3px | 语义浅底 | 语义色 | — | — | usermsg L364-393 |

### 3.15 Chip / Tag

| 类型 | 值 | 证据 |
|---|---|---|
| 通用资源 chip 表面 | bg secondarycontainer；`1px solid stroke`；primary 字；**内阴影** `inset 0 1px 0 color-mix(container 72%, transparent)` | chat-resource-chips.less L1-6 |
| hover | bg secondarycontainer-hover；border → component-border | L8-11 |
| mentioned 标签 | `inline-flex`；`gap:5px`；`min-height:26px`；`max-width:200px`；`padding: 3px 8px`；radius 6；12px/500/`18px` | L22-37 |
| 类型图标色 | kb → brand；faq → `#0052d9`；file → secondary；tag → `#9f7aea`；mcp → `#0f766e`；skill → `#7c3aed`；tool → `#b7791f` | L38-64 |
| 建议问题 chip | `padding: 8px 14px`；radius 10；`1px solid stroke`；bg container；`0 1px 2px 4%`；hover `border-mix 10%` + `bg text-primary 4%` + `0 2px 6px 5%`；active `bg 6%` + `0 1px 3px 4%` | suggested-questions.less L4-13、L104-128 |
| 建议问题徽标（FAQ） | `padding: 1px 6px`；radius 6；`background: var(--td-brand-color-light)`；`10px/600/1.6`；`letter-spacing:.04em`；**uppercase**；brand 字 | L180-193 |
| 建议问题骨架 | 宽 180 / 240(nth-2n) / 150(nth-3n) / 210(nth-5n)；bg secondarycontainer；无阴影 | L130-165 |
| 状态小标（ask/approval） | `padding:1px 6px`；radius 4；bg secondarycontainer；secondary；**11px**（`var(--app-text-xs, 12px)`，主值 11） | AskUserCard L268、ToolApprovalCard L446 |
| 记忆类型标 | `padding: 0 6px`；radius 3；bg secondarycontainer；placeholder；12px/18px | ChatMemoryStep L161-169 |
| 相关度徽标 | 见 §3.4（`2px 6px` / radius 3 / 11px / 600 / 4 档 12% 底） | tool-results L29-58 |

### 3.16 Tab

**A. 子代理 Tab 栏**

| 属性 | 值 | 证据 |
|---|---|---|
| 栏 | `gap:4px`；`padding: 6px 12px`；`border-bottom: 1px solid var(--td-component-border)` | ChildAgentTabBar L54 |
| 栏内滚 | `gap:4px`；`overflow-x:auto`；`scrollbar-width:none`；`::-webkit-scrollbar{display:none}` | L55-56 |
| Tab 项 | `gap:7px`；`padding: 7px 10px`；radius 6；透明；secondary；13px；`1.4`；`white-space:nowrap` | L58 |
| 选中 | 条目 + tab 都 `background: secondarycontainer`；字变 primary | L65-66 |
| hover | 条目 bg container-hover；tab 字 primary；`transition: background-color 150ms` | L67-69 |
| 头栏内嵌（`.in-header`） | tab 高 **28px**、`padding: 0 4px 0 10px`、字号 12px（fallback 13px）、条目 radius 8、名称 `max-width:130px` | L59-63 |
| 关闭按钮 | `22×22`；`margin-right:5px`；radius 4；placeholder；**`opacity:0`，hover/选中/focus 才 1**（transition 150ms） | L73、L84-85 |
| 状态点 | `6×6`；placeholder；running brand + `1.6s ease-out infinite`；succeeded success；waiting/needs_attention warning；failed error | L74-76、L98-99 |
| 运行中名称 | 三段渐变扫光：`linear-gradient(90deg, currentColor 30%, placeholder 50%, currentColor 70%) 0 0 / 300% 100%`；`2.4s linear infinite` | L77-83 |
| focus-visible | `outline: 2px solid brand`；offset **-2px** | L72 |

**B. 分段控件（artifact 筛选）**

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `inline-flex`；`flex-wrap:wrap`；`gap:2px`；**`padding:3px`**；radius 8；bg secondarycontainer | artifact-filter-tabs.less L2-7 |
| 按钮 | `padding: 5px 12px`；radius 6；透明；secondary；13px；`transition: 150ms` | L9-18 |
| 选中 | bg container；字 brand；`box-shadow: 0 1px 3px rgba(0,0,0,.08)` | L24-29 |
| 计数 | `opacity:.7`；12px；`tabular-nums` | ChatArtifactsPanel L594-599 |

### 3.17 抽屉

| 属性 | 值 | 证据 |
|---|---|---|
| 头 | `height/min-height: var(--app-chat-header-height)`=**40px**；`padding: 0 12px`；`border-bottom:1px`；`font-weight: normal` | ChatArtifactsDrawer L732-739 |
| 关闭钮 | `top: calc((40px - 28px)/2)` = 6px；`28×28` | L741-745 |
| body | `padding: 4px 20px 16px` | L747-749 |
| 预览态 body | `padding: 12px 16px 16px`；`flex:1`；`overflow:hidden` | L758-765 |
| 头图标（抽屉） | `24×24`；radius 6；底 `brand 10%`；字 brand；`15px` | L557-568 |
| 拖宽遮罩 / 手柄 | 遮罩 `position:fixed; inset:0; z-index:2001; cursor:col-resize`；手柄宽 **12px**、`margin-left:-6px`、`z-index:2002` | L693-712 |
| 拖宽指示线 | `2×48`；radius 1；bg component-border；`opacity:.55`；hover/active → `1` + brand | L714-727 |
| 拖拽中 | `.t-drawer__content{ transition: none !important }`；内部 iframe/preview `pointer-events:none` | L768-781 |

### 3.18 空态

| 属性 | 值 | 证据 |
|---|---|---|
| 容器 | `flex:1`；`flex column`；居中；`text-align:center`；`padding: 56px 20px` | EmptyState.vue L37-49 |
| compact | `padding: 32px 16px` | L46-48 |
| 图标盘 | `64×64`；`border-radius:50%`；bg secondarycontainer；placeholder 字；`font-size:30px`；`margin-bottom:16px` | L51-66 |
| 图标内 img | `40×40` | L63-66 |
| compact 图标 | `48×48`；`margin-bottom:12px`；`font-size:22px` | L68-73 |
| 标题 | `15px`；`600`；`line-height:22px`；primary | L76-81 |
| 描述 | `margin-top:6px`；`max-width:360px`；13px；`line-height:20px`；secondary | L83-89 |
| 操作区 | `gap:12px`；`margin-top:20px` | L91-96 |
| 会话内空态 | 不是插画，而是**建议问题标签云**（`.suggested-questions-container`）：`padding: 12px 16px`；`max-width:860px`；`min-height:0`（有题时 `64px`） | suggested-questions.less L15-28 |
| 会话内空态标题 | 13px；placeholder；`400`；`letter-spacing:.01em` | L51-56 |
| 网格 gap | `10px`；居中换行 | L96-102 |

---

## ④ Markdown 规范

### 4.1 渲染管线（顺序要紧）

`renderChatMarkdown()`（`frontend/src/utils/chatMarkdownRenderer.ts` L499-557）按固定顺序做 14 步，**任何一步顺序错了，流式就会出现闪烁**：

1. `stripStreamingMarkerLines`（流式：删悬空的 `---`、`1.`、`- `）→ L505-507
2. `normalizeLegacyImageContextMarkup`（把 `<image url>` 转成 `![]()`）→ L508-511
3. `stripIncompleteCitationTag`（切除未闭合引用标签）→ L512
4. `preserveCitationTags`（`<kb>/<web>/wiki` 换成占位符）→ L513
5. `normalizeFullwidthMarkdownImageParentheses`（`![alt]（url）` 全角括号修复）→ L514
6. `normalizeSandboxArtifactRefs`（文件名含空格/括号的产物引用压成单 token）→ L518
7. `replaceIncompleteImageWithPlaceholder`（未闭合图片 → 骨架 span）→ L519
8. `preprocessMathDelimiters`（`\[...\]`→`$$`，`\(...\)`→`$`）→ L520
9. `restoreCitationTags` → `joinCitationTagsToPreviousLine` → L521-522
10. `closeDanglingStreamingEmphasis`（补全落单的 `**`/`*`/`~~`/`` ` ``）→ L527-529
11. `prepareMarkdown`（mermaid 缓存注入）→ L530-532
12. `chatMarked.parse()`（`breaks:true, gfm:true` + katex + 字面单波浪号扩展 + 自定义 emStrong/del tokenizer）→ L538-542
13. `collapseStandaloneCitationParagraphs` → `renderWeKnoraEntityLinks` → `wrapChatMarkdownTables` → `markStandaloneStrongParagraphs` → `sanitizeHtml` → L543-552
14. `applyStreamingTailFade`（只包最后 24 个字符）→ L556

**解析器配置**（L53-59、L367-372）：

| 项 | 值 |
|---|---|
| `breaks` | **true**（单个换行即 `<br>`，对中文短句影响极大） |
| `gfm` | true |
| KaTeX | `{ throwOnError: false, nonStandard: true }` |
| 单波浪号 | 字面量直通（`literalSingleTildeExtension`），不做删除线 |
| 强调 tokenizer | 自定义 `chatEmphasis`，修补 CJK 两侧标点导致的 `**` 不生效 |

### 4.2 代码块（HTML 结构 + 全部数值）

结构（`frontend/src/utils/markdownEnhancements.ts` L92-102）：

```html
<div class="chat-code-block">
  <div class="chat-code-block__header">
    <span class="chat-code-block__lang">TypeScript</span>
    <div class="chat-code-block__actions">
      <button class="chat-code-block__copy" aria-label="复制代码" title="复制代码">
        <svg class="chat-code-block__copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/>
             <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span class="chat-code-block__copy-text">复制代码</span>
      </button>
    </div>
  </div>
  <pre class="chat-code-block__pre"><code class="hljs language-typescript">…</code></pre>
</div>
```

| 元素 | 属性 | 值 | 证据 |
|---|---|---|---|
| 外层 | margin | `.75em 0` | chat-markdown.less L144 |
| | border | `1px solid var(--td-component-stroke)` | L145 |
| | radius | `8px` | L146 |
| | overflow | `hidden`（**左右不单独滚，整体裁切**） | L147 |
| | bg | `var(--td-bg-color-container)` | L148 |
| | shadow | `0 1px 2px …6%…` | L149 |
| 头 | 布局 | `flex; space-between; gap:12px` | L153-156 |
| | `min-height` | **`36px`** | L157 |
| | padding | `6px 10px 6px 12px`（**上右下左不对称**） | L158 |
| | bg | secondarycontainer | L159 |
| | 下边 | `1px solid stroke` | L160 |
| 语言标 | 字号/字重 | `12px` / `600` | L164-165 |
| | 行高 | `1.2` | L166 |
| | 色 | secondary | L167 |
| | 字距 | `.02em` | L168 |
| | 大小写 | `none`（**不做 uppercase**，与 mermaid 徽标相反） | L169 |
| 复制按钮 | 布局 | `inline-flex; gap:6px` | L173-175 |
| | padding | `4px 8px` | L177 |
| | border | `1px solid transparent` | L178 |
| | radius | `6px` | L179 |
| | bg | transparent | L180 |
| | 字 | `12px` / `500` / `line-height:1` / secondary | L182-184 |
| | 过渡 | `background 150ms, color 150ms, border-color 150ms` | L186 |
| | hover | bg `color-mix(text-primary 6%, secondarycontainer)`；border component-border；字 primary | L188-192 |
| | 已复制 | 字 primary | L194-196 |
| | 失败 | 字 error | L198-200 |
| | 图标 | `flex-shrink:0`（16×16 由 SVG 属性给） | L203-205 |
| 代码区 | padding | `14px 16px` | L209 |
| | radius | `0`（由外层裁） | L210 |
| | bg | `color-mix(in srgb, secondarycontainer 88%, container)` | L211 |
| | 滚动 | `overflow-x:auto` 单向 | L212 |
| | 字号 | `13px` | L213 |
| | 行高 | `1.55` | L214 |
| | `code` | bg transparent；padding 0；radius 0；`font-size:inherit`；`400`；`white-space:pre`；`display:block` | L216-224 |
| 高亮 | 类名 | `.hljs` + `.language-<lang>`；色见 §1.12 | chat-hljs.less |
| 语言名映射 | 27 个 | js/ts/py/go/rust/java/kotlin/swift/rb/php/cs/cpp/c/sql/bash/sh/shell/json/yaml/yml/xml/html/css/markdown/md → 显示名；未知则首字母大写；空则 `Code` | markdownEnhancements.ts L37-82 |
| **行号** | — | **没有行号**（已核实：无 `linenumber`/`line-numbers`/`counter` 相关实现） | — |

### 4.3 无语言包裹的裸 `<pre>`

| 属性 | 值 | 证据 |
|---|---|---|
| bg | secondarycontainer | L126 |
| padding | `14px 16px` | L127 |
| border | `1px solid stroke` | L128 |
| radius | 8px | L129 |
| 滚动 | `overflow-x:auto` | L130 |
| margin | `.75em 0` | L131 |
| 行高 | `1.55` | L132 |
| 字号 | 13px | L133 |
| 内 `code` | bg none；padding 0；`inherit`；`400` | L135-140 |

### 4.4 表格

| 属性 | 值 | 证据 |
|---|---|---|
| wrapper `.chat-markdown-table`（渲染期加的 div） | `width: fit-content`；`max-width:100%`；`margin: .875em 0 1em`；`overflow-x:auto`；`border:1px solid stroke`；`border-radius:8px`；bg container；`-webkit-overflow-scrolling: touch` | L513-522 |
| `table` | `border-collapse: separate`；`border-spacing: 0`；`display: table`；**`font-size:14px`**；`line-height:1.55`；`width: max-content`；`min-width:0`；`word-break: initial` | L524-533 |
| `thead` | bg `color-mix(secondarycontainer 75%, container)` | L535-537 |
| `tbody tr:nth-child(2n)` | bg `color-mix(secondarycontainer 45%, transparent)`（**斑马纹很淡**） | L539-541 |
| `th` | `600`；`border:0` + `border-right/bottom 1px`；同 thead 底色（**再叠一次**）；`text-align:left`；`padding: 8px 12px`；`white-space: nowrap` | L543-553 |
| `td` | `border-right/bottom 1px`；`padding: 8px 12px`；`vertical-align: top` | L555-563 |
| 末列 / 末行 | `border-right: 0`；`tbody tr:last-child td { border-bottom: 0 }` | L565-572 |
| 对齐 | `th[align=center]/td[align=center]` → center；`right` → right | L574-582 |

### 4.5 链接

| 状态 | 值 | 证据 |
|---|---|---|
| 默认 | color brand；`text-decoration: underline`；`text-decoration-color: color-mix(brand 45%, transparent)`；`text-underline-offset: .18em` | L501-505 |
| hover | color brand-hover；`text-decoration-color: brand` | L507-510 |
| 全站 `.doc-link`（非 Markdown，卡片用） | `inline-flex`；`gap:4px`；**`font-weight:450`**；brand；无下划线；hover brand-active + underline | theme.css L164-180 |
| 实体链接（wiki） | brand；**`border-bottom: 1px dashed brand`**；`500`；hover solid；不是 `text-decoration` | chat-citations.less L79-98 |

### 4.6 图片

| 属性 | 值 | 证据 |
|---|---|---|
| 通用 | `max-width:80%`；`max-height:300px`；`width/height:auto`；`border-radius:8px`；`display:block`；`margin: 1.25em 0`；`border:.5px solid stroke`；`object-fit:contain`；`cursor:pointer`；`transition: transform 200ms ease` | L584-596 |
| 回答内（botmsg） | 覆盖 margin 为 `8px 0 8px 16px`；hover `scale(1.02)` | botmsg.vue L689-705 |
| 未加载骨架 | `260×180`；`min-width: min(260px,80%)`；`min-height:180px`；`object-fit:cover`；`cursor:default`；三停渐变 `secondarycontainer 30% / container-hover 50% / secondarycontainer 70%`；`background-size:200% 100%`；`animation: chat-img-skeleton 1.2s ease-in-out infinite` | L606-628 |
| 图片段 | `p:has(> img:only-child)` → `margin:1.25em 0; line-height:0` | L630-633 |
| 流式图片占位 | `clamp(150px,30vw,260px)`；`aspect-ratio: 4/3`；radius 10；`1px solid rgba(175,190,210,.55)`；145deg 三段蓝白渐变；三层阴影；`backdrop-filter: blur(3px) saturate(115%)`；`animation: streamingImageBreath 2.2s`；`::before` 1px 白 45% 内描边；`::after` 高光条 `rotate(16deg)` 宽 62% 高 210%，`2.8s` | chat-message-shared.less L265-356 |
| 骨架流光 | `linear-gradient(110deg, rgba(234,239,246,.95) 8%, rgba(248,250,252,.98) 18%, rgba(234,239,246,.95) 33%)`；`background-size:220% 100%`；`1.4s linear infinite` | L290-301、L330-334 |

### 4.7 Mermaid

| 属性 | 值 | 证据 |
|---|---|---|
| 块 | `margin:.75em 0`；`border:1px solid stroke`；radius **10px**；bg container；shadow `0 1px 3px 5%` | chat-markdown.less L227-234 |
| 头 | `min-height:36px`；`padding: 6px 10px 6px 12px`；`gap:8px`；bg secondarycontainer；下边框 1px | L236-245 |
| 徽标 | `inline-flex`；`gap:6px`；`12px`；`600`；`letter-spacing:.04em`；**`text-transform:uppercase`**；secondary | L247-256 |
| 展开按钮 | `28×28`；radius 6；透明；hover bg 6% + border + primary；禁用 `opacity:.35` | L258-284 |
| 画布 | `padding: 20px 16px 18px`；无边框；`overflow-x:auto`；`text-align:center`；`cursor: zoom-in` | L286-299 |
| SVG 节点线宽 | `.node rect/circle/ellipse/polygon/path { stroke-width: 1.5px }`；`.edgePath path/.flowchart-link { stroke-width: 1.6px }`；文字字体 `var(--app-font-family)` | L301-318 |
| 旧式裸 `pre.mermaid` | `padding: 20px 16px`；radius 10；bg secondarycontainer；`cursor:zoom-in` | L329-343 |
| 加载占位 | `min-height:200px`；无边框无圆角（嵌在块内） | L321-327 |

### 4.8 KaTeX / 脚注 / 分割线

| 项 | 值 | 证据 |
|---|---|---|
| KaTeX | 只做 delimiters 预处理 + 扩展注册；**仓库内无自定义 `.katex` 尺寸覆盖**（沿用 katex 0.16 默认） | chatMarkdownRenderer.ts L61-66、L370 |
| 脚注 | **不支持**（未注册 footnote 扩展，无 `.footnotes` 样式） | — |
| `hr` | `margin: 1.75em 0`；`border-top: 1px solid stroke`；无其他装饰 | chat-markdown.less L439-443 |
| 流式时的 `hr` 抑制 | 末尾 `---`/`***`/`___` 在流式期间被剥离，避免表格分隔符误渲染 | chatMarkdownRenderer.ts L201-207 |

### 4.9 流式渲染的「光标」——不是光标，是尾字渐隐

| 项 | 值 | 证据 |
|---|---|---|
| 机制 | 只把**最后 24 个字符**包进 `<span class="stream-fade-tail">` | chatMarkdownRenderer.ts L406-433 |
| 蒙版 | `-webkit-mask-image/mask-image: linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,.7) 30%, rgba(0,0,0,0) 100%)` | chat-markdown.less L24-33 |
| 结束行为 | 流式停止后不再输出该 span，文字自然回到全实色 | 注释 L20-23 |
| 无闪烁光标 | 全仓无 `caret`/`blink` 动画（`caret-color` 只出现在 autofill 修复里） | 已核实 |

### 4.10 文档预览用的另一套 Markdown（非回答气泡，勿混用）

`frontend/src/components/css/markdown.less`（542 行）是文档/wiki 预览，标题阶梯与回答体**不同**：

| 标签 | 字号 | 字重 | margin-top / bottom | 行高 |
|---|---|---|---|---|
| h1 | 24px (`4xl`) | 700 | 24 / 10 | 1.35 |
| h2 | 20px (`3xl`) | 700 | 22 / 10 | 1.35 |
| h3 | 18px (`2xl`) | 600 | 18 / 8 | 1.35 |
| h4 | 16px (`xl`) | 600 | 16 / 8 | 1.35 |
| h5 | 15px (`lg`) | 600 | 14 / 6 | 1.35 |
| h6 | 14px (`base`) | 600 | 12 / 6 | 1.35 |

> 该文件的注释明确记录了一次修复：「旧规则把 h1~h6 都设成 20px，导致 h4 比 h3 还大」（markdown.less L51-52）。复刻**回答气泡**请只用 `chat-markdown.less`，两者不可互换。

---

## ⑤ 暗色差异

### 5.1 切换机制

| 项 | 事实 | 证据 |
|---|---|---|
| 属性 | `document.documentElement.setAttribute('theme-mode', effective)` | useTheme.ts L67 |
| 三态 | `'light'` / `'dark'` / `'system'` | L8 |
| 存储 | key = `'theme'`（`loadPreference`/`savePreference`），默认 **`'light'`**（不是 system） | L10-16 |
| system 解析 | `matchMedia('(prefers-color-scheme: dark)')` | L23-25 |
| 监听 | `addEventListener('change')`，仅当 `currentTheme === 'system'` 时重算 | L89-93 |
| 去重 | `lastEffective` 相同则直接 return（避免重复写 DOM） | L65 |
| 原生壳同步 | dark → `WindowSetDarkTheme()` + 背景 `rgb(24,24,24)`；light → `WindowSetLightTheme()` + `rgb(238,238,238)`；同时写 `documentElement/body/#app` 的 `background` 与 `color-scheme` | L28-61 |
| CSS 选择器 | 亮色 `:root:root, :root:root[theme-mode="light"]`；暗色 `:root:root[theme-mode="dark"]` | theme.css L1-2 |
| ⚠️ 选择器不一致 | 代码高亮用 `html[theme-mode='dark']`；嵌入页用 `html[theme-mode='dark']`；主 token 用 `:root[theme-mode='dark']`。**同一属性两种前缀并存**，复刻时两者都要写 | chat-hljs-theme.less L14；EmbedUserMessage.vue L172 |
| 无过渡 | **没有全局 `transition` 做主题切换动画**（瞬切） | 已核实 |

### 5.2 两套值差异对照

| 语义 | 亮色 | 暗色 | 差异性质 |
|---|---|---|---|
| 页面底 | `#eee`（gray-2） | `#181818`（gray-14） | 明度翻转 |
| 卡面/容器 | `#fff` | `#242424`（gray-13） | **不是纯黑**，留 0x24 |
| 侧栏 / 设置弹窗 | `#f9f9f9` | `#181818` | 暗色与页面同底（亮色是更浅） |
| 二级容器 | `#f3f3f3` | `#2c2c2c` | |
| 组件底 | `#e7e7e7` | `#383838` | |
| 描边 | `#e7e7e7` | `#383838` | |
| 边界 | `#dcdcdc` | `#5e5e5e` | **暗色边界更亮**（对比反转） |
| 主文字 | `rgba(0,0,0,.9)` | `rgba(255,255,255,.9)` | 同透明度 |
| 次文字 | `.6` | **`.55`** | 暗色更低 |
| placeholder | `.4` | **`.35`** | 暗色更低 |
| 禁用 | `.26` | **`.22`** | 暗色更低 |
| 品牌主色 | `#0057f2`（-4） | `#2a86f0`（-6） | **暗色跳两档**，不是同档换值 |
| 品牌 hover | -3 `#99d2ff` | -5 `#136bd1` | 暗色 hover 变深、亮色变浅 |
| 品牌 active | -5 `#006dff` | -7 `#4c9bff` | 同一方向 |
| 品牌 disabled | `#9cc4ff` | `#123d7a` | |
| 品牌 focus 环 | 20% 透明 | **28%** 透明 | 暗色更明显 |
| 品牌 light 底 | `#e6f4ff` | `#0c2a52` | |
| popover 皮肤 | bg container + `0.5px` stroke + 三层阴影 + `blur(20px) saturate(180%)` | bg **`rgba(36,36,36,.92)`** + border `rgba(255,255,255,.08)` | 暗色改用半透明+白描边 |
| 代码高亮 | GitHub Light 9 色 | GitHub Dark 9 色 | 见 §1.12 |
| 用户气泡 | secondarycontainer | secondarycontainer（同变量） | 自动跟随，无需单独覆写 |
| 思考卡滚动条 | `rgba(0,0,0,.1)` | `rgba(255,255,255,.15)` | 唯一显式覆写的滚动条 |
| 全局滚动条 thumb | 跟随 `--td-scrollbar-color` | **`#4b4b4b`**，hover `#5e5e5e`，track 透明 | theme.css L101-109（`!important`） |
| 位图图标 `.more-icon` | 原色 | `filter: invert(1)` + `opacity:.55`，hover `.9` | theme.css L112-118 |
| 强调色紫/蓝/青 | `#7c4dff` / `#2f6bff` / `#0f8f83` | `#9d7cff` / `#6f9bff` / `#3cc4b4` | 暗色整体提亮 |
| 原文高亮 | `#d6a124` + `rgba(250,204,75,.34)` | `#e6b94f` + `rgba(230,185,79,.26)` | 暗色降透明 |
| 图片加载骨架 | `rgba(234,239,246,.95)` 系 | **未覆写（仍是浅色渐变）** | 暗色下会闪白，属已知不一致 |

---

## ⑥ 动效

### 6.1 令牌

| 令牌 | 值 | 用途 |
|---|---|---|
| `--app-motion-instant` | `120ms` | 图标按钮 hover 底 |
| `--app-motion-fast` | `150ms` | **主用**：hover 换色、toolbar 透明度、citation 浮层 |
| `--app-motion-base` | `200ms` | 边框/阴影过渡、折叠箭头、图片 hover |
| `--app-motion-slow` | `300ms` | 侧栏让位（`padding-right`） |

### 6.2 缓动曲线清单

| 曲线 | 用在哪 | 证据 |
|---|---|---|
| `ease` | 多数颜色/透明度过渡 | 各处 |
| `ease-out` | `fadeInUp`、`slideIn`、`contentFadeIn`、citation 浮层 | — |
| `linear` | 所有 infinite 扫光（shimmer）、`wk-spin` | — |
| `ease-in-out` | `pulse-dot`、`streamingImageBreath`、`chat-img-skeleton` | — |
| `cubic-bezier(0.4, 0, 0.2, 1)` | 思考卡整体过渡、follow-up 位移 | deepThink L94；chat-message-shared L241 |
| `cubic-bezier(0.22, 0.61, 0.36, 1)` | 右侧面板让位 | index.vue L2053 |
| `cubic-bezier(0.22, 1.2, 0.36, 1)` | 产物到达（**带回弹**） | chat-message-shared L121 |
| `cubic-bezier(0.22, 1.4, 0.36, 1)` | 产物角标到达（回弹更强） | L170 |
| `cubic-bezier(0.16, 1, 0.3, 1)` | 建议问题容器/淡入（`@suggested-ease`） | suggested-questions.less L1 |

### 6.3 关键帧逐条

| 名称 | 定义 | 时长/曲线 | 用途 | 证据 |
|---|---|---|---|---|
| `wk-spin` | `to { rotate(360deg) }` | `.8s linear infinite` | **全站唯一旋转**（spinner/刷新） | theme.css L239-243 |
| `fadeInUp` | `opacity 0→1`；`translateY(8px→0)`（botmsg）/ **`6px→0`**（AgentStreamDisplay） | `.25s ease-out` | 消息/事件出现 | botmsg L677-687；ASD L4028-4038 |
| `slideIn` | `opacity 0→1`；`translateX(-6px→0)` | `.2s ease-out` | 工具摘要 | ASD L4040-4050 |
| `contentFadeIn` | `opacity 0→1`；`translateY(6px→0)` | `.3s ease-out` | 骨架屏/建议问题 | index.vue L2288-2298 |
| `chatStreamShimmer` | `background-position 100% 50% → -100% 50%` | `1.5s linear infinite` | **流式文字扫光** | chat-timeline-loading.less L5-13 |
| `followUpToolbarShimmer` | 同上方向 | `1.5s linear infinite` | 后续问题加载 | chat-message-shared L233-236 |
| `artifact-toolbar-arrive` | `scale .82 → 1.12(55%) → 1` | `.7s cubic-bezier(.22,1.2,.36,1)` | 产物按钮出现 | L133-145 |
| `artifact-count-arrive` | `scale .4/op .0 → 1.28/1(60%) → 1` | `.7s cubic-bezier(.22,1.4,.36,1)` | 角标出现 | L173-187 |
| `child-tab-shimmer` | `background-position 100% 0 → 0 0` | `2.4s linear infinite` | 子代理 tab 运行中 | ChildAgentTabBar L90-93 |
| `child-tab-pulse` | `box-shadow 0 0 0 0 brand45% → 0 0 0 5px transparent` | `1.6s ease-out infinite` | tab 状态点 | L86-89 |
| `child-task-shimmer` | 同 tab | `2.4s linear infinite` | 子任务名 | CollaborationTasks L111-114 |
| `child-task-sweep` | `background-position 100% 0 → -50% 0` | `2.8s ease-in-out infinite` | 子任务整行扫光 | L115-118 |
| `child-assignment-pulse` | `box-shadow 0 0 0 0 brand45% → 0 0 0 6px transparent` | `1.6s ease-out infinite` | 子代理流状态点 | ChildAgentStream L164-167 |
| `pulse-dot` | `scale .85/op .6 → 1.1/op 1(50%)` | `1.8s ease-in-out infinite` | 思考点 | deepThink L207-216 |
| `pulse-ring` | `scale .5/op .6 → 1.2/op 0` | `1.8s ease-out infinite` | 思考光环 | L218-227 |
| `chat-img-skeleton` | `background-position 100% 0 → -100% 0` | `1.2s ease-in-out infinite` | 图片骨架 | chat-markdown.less L625-628 |
| `streamingImageShimmer` | `background-position-x → -220%` | `1.4s linear infinite` | 流式图片骨架 | chat-message-shared L330-334 |
| `streamingImageMirror` | `left -38%→110%`，`opacity .35→.75` | `2.8s ease-in-out infinite` | 高光扫过 | L336-345 |
| `streamingImageBreath` | `translateY(0)/scale(1)/saturate(1)` → `translateY(-.5px)/scale(1.01)/saturate(1.06)` | `2.2s ease-in-out infinite` | 占位「呼吸」 | L347-356 |
| `voice-input-pulse` | `box-shadow 0 0 0 0 error-focus → 0 0 0 4px` | `1.2s ease-in-out infinite` | 录音中 | Input-field L3967-3970 |
| `chat-citation-float-in` | `opacity 0` + `translateY(-4px)` → 默认 | `150ms ease-out both` | 引用浮层 | chat-citations L201-206 |
| `prompt-dock` enter/leave | `opacity` + `translateY(6px)` | `200ms ease` | 停靠卡 | PendingPromptDock L278-287 |
| `scroll-btn-fade` | `opacity` + `translateX(-50%) translateY(8px)` | `200ms ease` | 回底按钮 | index.vue L2277-2286 |
| `sq-fade` | `opacity 0→1` | `.25s @suggested-ease` | 建议问题 | index.vue L2445-2453 |
| `follow-up-toolbar-loading` | enter `translateX(-3px) scale(.92)`；leave `translate(4px,3px) scale(.82)` | `.16s ease` + `.16s cubic-bezier(.4,0,.2,1)` | 后续问题徽标 | chat-message-shared L238-252 |

### 6.4 展开/折叠

| 组件 | 机制 | 时长 | 证据 |
|---|---|---|---|
| 思考卡（deepThink） | Vue 条件渲染 + 容器 `transition: all` | `.25s cubic-bezier(.4,0,.2,1)` | deepThink L94 |
| 工具结果卡 | **`max-height` 0 ↔ 2000px** + `opacity` + `padding` | `.2s ease` | tool-results L129-143 |
| 思考活动窗口 | `max-height: calc(1.6em*5)` + `justify-content:flex-end`（底部对齐，旧行被裁） | 无过渡（瞬时） | ASD L4427-4439 |
| 箭头旋转 | `transform: rotate(90deg)`（details） / `rotate(180deg)`（tool results） | `150ms ease` / `150ms ease` | ProgressUpdates L81；tool-results L148-152 |
| 子代理分配块 | `<details>` 原生 + chevron rotate 90 | `150ms ease` | ChildAgentStream L147-148 |
| 产物抽屉预览 | 无展开动画（抽屉自身由 TDesign 提供） | — | — |

### 6.5 无障碍：`prefers-reduced-motion` 覆盖面

**已适配**（动画被 `animation:none` / `transition:none` 关闭，且 shimmer 退化为实色）：

`answer-toolbar`、产物到达动画、follow-up 徽标、citation 浮层、用户操作条、深度思考（部分）、`chat-global-wait__spinner`、`progress-count/chevron`、`child-assignment-*`、`child-agent-tab-*`、`child-task-*`、`voice-input-btn`、`prompt-dock`、`steer-sending`、`BrowserTaskPreview`、`RagPipelineProgress` 的 spinner。

**未适配**（仍会动）：

| 动画 | 证据 |
|---|---|
| `wk-spin`（多数 spinner） | 无 media 包裹 |
| `chat-img-skeleton` | 无 |
| `streamingImageShimmer/Mirror/Breath` | 无 |
| `pulse-dot` / `pulse-ring`（deepThink） | 无 |
| `fadeInUp` / `slideIn` | 无 |

> 复刻若要「完全一致」，就别给这些补 reduced-motion；若要「更好」，这是原版缺口。

---

## ⑦ 响应式断点

**断点全表**（`views/chat` + 相关组件，已穷举）：

| 断点 | 位置 | 变化 | 证据 |
|---|---|---|---|
| `min-width: 960px` | `.chat:not(.is-embedded)` | 加 `transition: padding-right 300ms cubic-bezier(.22,.61,.36,1)`（面板让位动画只在宽屏有） | index.vue L2052-2056 |
| `min-width: 960px` | `.has-references-panel` | `padding-right: var(--references-panel-width,420px)`；`.chat_scroll_box{padding-top:0}` | L2059-2066 |
| `min-width: 960px` | `.has-sandbox-panel` | `padding-right: var(--sandbox-panel-width,420px)` | L2071-2076 |
| `min-width: 1400px` | 双面板同时开 | `padding-right: calc(420px + 420px)` | L2078-2080 |
| `max-width: 1399.98px` 且 `min-width: 960px` | 双面板 | 只让沙箱面板（`padding-right: 420px`），引用面板叠在下方 | L2082-2084 |
| `max-width: 640px` | `.rag-pipeline-progress .tree-root-toolbar` | `gap: 8px`；展开按钮 `max-width:100%` | RagPipelineProgress L822-832 |
| `max-width: 720px` | `.browser-task-preview` | `right:12px; bottom:12px; width:280px; max-width: calc(100% - 24px)`；toolbar `padding-left: 8px` | BrowserTaskPreview.vue |
| `max-width: 480px` | `.browser-task-preview.needs-help` | `width: calc(100% - 24px)`；PIP 态 `width:100%; max-width:none` | 同上 |
| `hover: none` | `.answer-toolbar`、`.user_msg_meta` | 操作条**常显**（触屏无 hover） | chat-message-shared L101-106；usermsg L475-480 |

**尺寸常量（不是断点但决定小屏表现）**

| 常量 | 值 | 后果 |
|---|---|---|
| `.chat { min-width: 400px }` | 400px | 窄于 400px 时外层出现横向滚动 |
| 消息列 `max-width: 960px` + `padding: 0 20px` | 有效内容宽 920px | 1440 屏下正文两侧各留 ~260px |
| 用户气泡 `max-width: min(76%, 820px)` | 76% 或 820px 取小 | 宽屏下不超过 820px |
| 输入框 `max-width: 960px` | 与消息列同宽（含 20px inset 时是 1000px） | 视觉上与正文左缘对齐 |
| 建议问题容器 `max-width: 860px` | 比消息列窄 100px | 空态时略收 |
| prompt dock `max-width: 960px` | 同输入框 | |
| 工具输出 `max-height: 400px` | | 超出滚动 |
| 思考窗口 `max-height: 104px`（5 行 ×1.6em@13px） | | |
| 引用浮层 `width: 300px`；`max-width: calc(100vw - 32px)` | 小屏自适应 | |
| 原文引用浮层 `width:400px; max-width:500px` | 固定 | |
| AskUser 选项网格 `minmax(min(100%,150px), 1fr)` | 150px 一列 | 窄屏自动单列 |
| Prompt 字段网格 `fit-content(120px) minmax(0,1fr)` | 标签列 ≤120px | |
| 产物卡 `width:420px` / 页面卡 `360px` / prompt dock 正文 `min(50vh,440px)` | 固定 | 小屏靠 `max-width:100%` 兜底 |

---

## ⑧ 证据索引

### 8.1 令牌与主题

| 内容 | 文件 | 行 |
|---|---|---|
| 亮色全部 `--td-*`（品牌/warning/error/success/灰阶/背景/文字） | `frontend/src/assets/theme/theme.css` | L1（单行，182 段分号） |
| 暗色全部 `--td-*` + 字体/圆角/阴影重复声明 | 同上 | L2–98 |
| 暗色滚动条 `!important` | 同上 | L101–109 |
| `.more-icon` 暗色反相 | 同上 | L112–118 |
| t-radio-button 全局态 | 同上 | L121–161 |
| `.doc-link` | 同上 | L164–180 |
| autofill 覆写 | 同上 | L183–193 |
| 输入聚焦只换边框 | 同上 | L196–202 |
| `--app-selection-*` / `--app-focus-border` | 同上 | L205–210 |
| `--app-accent-*` | 同上 | L213–222 |
| `--app-source-highlight*` | 同上 | L225–236 |
| `wk-spin` | 同上 | L239–243 |
| **应用级令牌全量**（radius/text/space/motion/z/header） | 同上 | L251–298 |
| TD 皮肤 `.wk-popover` | `frontend/src/assets/theme/tdesign-overrides.less` | L5–45 |
| select 选中态 / 勾 | 同上 | L48–70 |
| 样式守卫规则与 baseline | `frontend/src/assets/theme/styleGuard.test.mjs` | L20–77 |
| 主题切换 | `frontend/src/composables/useTheme.ts` | L1–101 |

### 8.2 Markdown

| 内容 | 文件 | 行 |
|---|---|---|
| **回答体排版总 mixin** | `frontend/src/components/css/chat-markdown.less` | L13–784 |
| 段落/标题/列表/引用/表格/图片 | 同上 | L35–596 |
| 代码块（含复制按钮） | 同上 | L143–225 |
| Mermaid 块 | 同上 | L227–343 |
| artifact 行内卡 | 同上 | L645–781 |
| 高亮 token 映射 | `frontend/src/components/css/chat-hljs.less` | L1–73 |
| 高亮配色（亮/暗） | `frontend/src/components/css/chat-hljs-theme.less` | L1–24 |
| 渲染管线 | `frontend/src/utils/chatMarkdownRenderer.ts` | L499–557 |
| 尾字渐隐 | 同上 | L406–433 |
| 表格包裹 | 同上 | L460–466 |
| 独立粗体段打标 | 同上 | L468–497 |
| 代码块 HTML + 语言名 | `frontend/src/utils/markdownEnhancements.ts` | L37–103 |
| Mermaid HTML | 同上 | L105–118 |
| 文档预览版 Markdown | `frontend/src/components/css/markdown.less` | L37–300 |
| Dev 测试页（复用同一 mixin） | `frontend/src/views/dev/MarkdownTestPage.vue` | L517–656 |

### 8.3 组件

| 组件 | 文件 | 样式行 |
|---|---|---|
| 助手气泡 | `frontend/src/views/chat/components/botmsg.vue` | L626–745 |
| 用户气泡 | `frontend/src/views/chat/components/usermsg.vue` | L236–487 |
| Agent 流（时间线/思考/工具） | `frontend/src/views/chat/components/AgentStreamDisplay.vue` | L3649–4518 |
| 深度思考卡 | `frontend/src/views/chat/components/deepThink.vue` | L82–238 |
| 交互卡（prompt 表单） | `frontend/src/views/chat/components/agent-interaction-card.less` | L1–544 |
| AskUser | `frontend/src/views/chat/components/AskUserCard.vue` | L252–423 |
| 审批卡 | `frontend/src/views/chat/components/ToolApprovalCard.vue` | L437–539 |
| 工具结果（通用） | `frontend/src/views/chat/components/tool-results/tool-results.less` | L1–313 |
| 工具结果分发 | `frontend/src/views/chat/components/ToolResultRenderer.vue` | L240–322 |
| RAG 管线进度 | `frontend/src/views/chat/components/RagPipelineProgress.vue` | L588–833 |
| 进度更新行 | `frontend/src/views/chat/components/ProgressUpdates.vue` | L34–102 |
| 时间线令牌 | `frontend/src/components/css/chat-timeline-theme.less` | L1–8 |
| 流式扫光 | `frontend/src/components/css/chat-timeline-loading.less` | L1–56 |
| 消息共享（操作条/图片骨架） | `frontend/src/components/css/chat-message-shared.less` | L1–383 |
| 引用药丸 + 浮层 | `frontend/src/components/css/chat-citations.less` | L1–212 |
| 资源 chip | `frontend/src/components/css/chat-resource-chips.less` | L1–80 |
| 来源列表 | `frontend/src/views/chat/components/docInfo.vue` | L214–508 |
| 产物面板 / 抽屉 | `frontend/src/views/chat/components/ChatArtifactsPanel.vue` L464–697；`ChatArtifactsDrawer.vue` L530–782 | — |
| 子代理 tab | `frontend/src/views/chat/components/ChildAgentTabBar.vue` | L53–100 |
| 子代理流 | `frontend/src/views/chat/components/ChildAgentStream.vue` | L118–173 |
| 协作任务 | `frontend/src/views/chat/components/CollaborationTasks.vue` | L26–124 |
| 记忆步 | `frontend/src/views/chat/components/ChatMemoryStep.vue` | L78–216 |
| 后台任务 chip | `frontend/src/views/chat/components/BackgroundWorkChip.vue` | L112–218 |
| 打开页面卡 | `frontend/src/views/chat/components/OpenPageCard.vue` | L103–256 |
| 页面编辑卡 | `frontend/src/views/chat/components/PageEditCard.vue` | L62–174 |
| Prompt 停靠卡 | `frontend/src/views/chat/components/PendingPromptDock.vue` | L175–295 |
| 输入框 | `frontend/src/components/Input-field.vue` | L3405–4300+ |
| 空态 | `frontend/src/components/EmptyState.vue` | L36–97 |
| 建议问题 | `frontend/src/components/css/suggested-questions.less` | L1–194 |
| 分段筛选 | `frontend/src/components/css/artifact-filter-tabs.less` | L1–36 |
| 会话布局/断点 | `frontend/src/views/chat/index.vue` | L2040–2454 |

### 8.4 未覆盖 / 待补

| 项 | 原因 |
|---|---|
| 实际渲染截图与像素校验 | 本任务为只读静态分析，未启动应用，未做视觉回归比对 |
| TDesign 组件内部默认值（按钮/输入/抽屉/弹窗的 padding、字体、hover） | 来自 `node_modules/tdesign-vue-next`，未展开；本项目只覆盖了「意图差异」（tdesign-overrides.less） |
| `t-skeleton` 动画细节 | 由 TDesign 提供（`animation="gradient"`），未取内部 keyframes |
| 沙箱/终端（xterm）主题色 | `SandboxTerminal.vue` 从 `useTheme` 派生，未逐值提取 |
| i18n 文案 | 未提取（视觉规范不含文案） |
| 移动端独立样式表 | 仓库内未见独立移动端样式，仅上述断点与 `hover:none` |

### 8.5 取数命令（可复验）

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/weknora/frontend/src"

# 令牌规模
grep -o -- "--[a-zA-Z0-9-]*[[:space:]]*:" assets/theme/theme.css | wc -l          # 396 声明
grep -o -- "--[a-zA-Z0-9-]*[[:space:]]*:" assets/theme/theme.css \
  | sed 's/[[:space:]]*:$//' | sort -u | wc -l                                     # 221 唯一名
cat $(find . -name "*.css" -o -name "*.less" -o -name "*.vue") \
  | grep -oE -- '--[a-zA-Z0-9-]+:' | sed 's/:$//' | sort -u | wc -l                # 314 全仓唯一名

# 暗色覆盖点
grep -rn "theme-mode=\"dark\"\|theme-mode='dark'" --include="*.vue" --include="*.less" . | wc -l

# 是否有代码行号 / 流式光标（应为 0）
grep -rn "line-numbers\|linenumber\|data-line" utils/markdownEnhancements.ts components/css/*.less
grep -rn "blink\|typing-cursor" components/css/*.less views/chat/components/*.vue

# 是否有线性进度条（应为 0，只有 step 行）
grep -rn "progress-bar\|progress__bar\|progress-fill" views/chat
```
