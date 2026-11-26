# 方向 A ·《他的样子》落地到 heyta AssistantPanel — 实施计划

> 状态：方向已定（A）。本文件是落地计划；原型 `A-weknora.html` 即「可跑静态壳」的可视目标。

## 关键前提（读代码后确认，会改变做法）
真实产品里 AI 对话**不是整页**，而是右侧 detail 面板 / 窄屏浮层：
- 容器：`.ht-app__detail`（宽度受 `--ht-layout-detail-*` 约束，约 360–520px），窄屏走 `ht-app__detail[data-assistant-overlay]` 浮层（`assistant-layout.css`）。
- 现有结构：`AssistantPanel.tsx` 的 `.ht-ai__workspace` = 左「历史」aside + 右「main」（header + chat-body + footer），composer 在 chat-body 内。
- 现有 token 已足够：`--ht-color-primary/-subtle`、`--ht-color-surface/-sunken`、`--ht-color-border`、`--ht-radius-md/lg`、`--ht-space-*`、`--ht-font-size-*`。

⇒ 所以 A 要**按侧栏宽度适配**，不是照搬 1440 整页：A 的「居中阅读列」在面板里退化为「满宽单列」，A 的「结果卡/确认卡/追问 chip」仍是满宽卡片。这是设计转译，不是缩放。

## 分三期（先壳，后数据，最后流式）
### Phase 1 · 视觉壳（只动 CSS + 极少 class，不动逻辑）
- 新建 `apps/web/src/styles/app/ai-chat-direction-a.css`（全部用 `var(--ht-*)`，零裸值），在 `apps/web/src/styles/app.css` 的 `@import './app/ai-panels.css';` **之后**加一行 import 覆盖级联。
- 覆盖点（对应 `ai-chat-log.css` / `ai-chat-workspace.css` 现有类）：
  - `.ht-ai__items--chat{ gap }` 更疏；`.ht-ai__item--user` 圆角与 A 一致（浅蓝底、右下小圆角）；`.ht-ai__item--assistant{ background:transparent }` 让回答回到正文（A 的无卡感）。
  - `.ht-ai__composer` 做成「浮起输入框」：`border + radius-lg + shadow`（用 `--ht-shadow-*`）。
  - 历史项 `.ht-ai__history-item--active` 用 A 的「白底 + 细描边」而非整块蓝。
  - header/间距对齐 A 的留白节奏。
- 判据：`pnpm --filter @heyta/web typecheck` 绿；`pnpm check:theme` / `pnpm check:l4` 不红；跑 `pnpm --filter @heyta/web dev` 逐屏截图与 `A-weknora.png` 并排比对。

### Phase 2 · 富内容（需数据/结构，非纯样式）
- 「任务变更结果卡」：当前 `item.role` 只有 user/assistant/proposal/error + live。需要一个结构化的 `role:'result'`（或把 proposal 扩展成带表格的卡）——要有后端/流式工具结果里的 `tasks` 结构化数据。**这是「接通流式」的一部分。**
- 「确认卡」：已有 `ProposalCard`（`ai-chat-proposal`），改成 A 的浅蓝确认条 + 「确认执行/放弃」即可（样式层）。
- 「追问 chip」：A 里的 3 个 `+` chip 目前不存在；可用现有 `ht-ai__suggestion` 的样式延用，或新增 `ht-ai__followups`（需 i18n key）。

### Phase 3 · 流式与真实数据
- 把 Phase 2 的结构化渲染接到 `useChatStreamHandler` 的工具结果事件上。

## 只在「跑起来看着改」时才能定的事
- 面板实际宽度下 A 的留白、字号、卡片密度都要现场微调；
- `.ht-ai__composer` 现有基础样式在 `ai-panels.css`（未展开读）里，覆盖前要先确认它现在长什么样，避免阴影叠加。

## 验收命令
```bash
pnpm --filter @heyta/web typecheck
pnpm --filter @heyta/web dev      # 打开后进入 AI 助手，逐屏对照 A-weknora.png
pnpm check:theme && pnpm check:l4 # 样式层门禁
```
