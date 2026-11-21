# AI 聊天界面参考（Markdown 渲染与消息操作）

## 参考对象（严格对照）

- 项目：**Chatbox** — `chatboxai/chatbox`（GitHub 42k+★，GPL-3.0，部分功能付费），
  一款开源 AI 客户端，**三端齐全**：桌面（Windows/macOS/Linux，Electron）、
  **Web**、**移动端（iOS/Android）**。取数：`gh api repos/Bin-Huang/chatbox`。
- 选择理由：在"桌面 + Web + 移动"三端同时成立的完整开源 AI 应用里，Chatbox 体量最大、
  UI 最完整，其消息渲染与操作按钮是成熟实现，适合作为本项目的**视觉与行为基准**。
  （LobeChat 为 Web/PWA + Electron 桌面，移动靠 PWA；NextChat 为 Web + Tauri 桌面。
   仅 Chatbox 提供原生移动端。）

## Chatbox 的相关技术栈（取自其 `package.json`）

| 关注点 | Chatbox 做法 | 本项目（RN）对应 |
|---|---|---|
| Markdown 渲染 | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `remark-breaks` | RN 无 DOM，不能直接用 `react-markdown`；改用同底座 **`markdown-it`**（MIT，2026 维护）的 token 流，自渲染为 RN 组件（`apps/mobile/src/ai/MarkdownMessage.tsx`） |
| 代码高亮 | `highlight.js` / `shiki` / `react-syntax-highlighter` | 暂以等宽字体 + 深色底呈现；高亮后续可加 |
| 图标 | **`lucide-react`**（复制=`Copy`、重试=`RotateCcw` 等） | 本项目用**自绘 SVG**（`custom-icons.tsx`），`action.copy`→`CopyGlyph`、`action.retry`→`RotateCcwGlyph` |
| 消息操作按钮 | 图标 + 文字的行内 ghost 按钮（复制/重新生成等） | `Button` 组件支持 `icon?: IconName`，复制/重试按钮已带图标 |

## 本项目为什么不用现成 RN Markdown 库

`@ronradtke/react-native-markdown-display`（9.x，仍在维护）会传递依赖
`@react-native-vector-icons/material-design-icons`（原生矢量图标模块），
引入需额外字体/原生链接，与 RN 0.84 构建风险高、包体大。
故只引入**纯 JS** 的 `markdown-it`，自写 token→RN 渲染器：零原生依赖、完全受设计 token 控制。

## 覆盖的 Markdown 语法

标题 h1–h6、段落、无序/有序（含嵌套）列表、引用、代码块、行内代码、粗体、斜体、
删除线、链接、分割线、表格、换行。渲染样式全部取自设计 token（`font-size.*`、
`line-height.*`、`color.foreground*`、`color.surface-sunken`、`font.mono`、`space.*`、`radius.md`）。

## 依赖两道门（AGENTS §3.1/§3.2）

- 维护性：`markdown-it` 最近发布 2026-10（>2021）。
- 许可证：`markdown-it` 为 **MIT**（白名单）。
