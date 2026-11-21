# check:ai-coverage 的 mobile 入口 —— 范围与计划

> 2026-11-22。`check:ai-coverage` 现红：mobile 缺 `breakdown` / `prioritize` / `duration` 三个入口。

## 事实（现量）

- 这三个功能在 **web 有完整组件**：`AiBreakdown.tsx`(598) / `AiPrioritize.tsx`(557) / `AiDuration.tsx`(601)，共 ~1756 行，并在 `App.tsx` 渲染。
- **mobile 端完全没有这三个组件**（`grep` 无命中）——不是"缺一行接线"，是**三个 AI 功能尚未移植到移动端**。
- 门禁（`scripts/check-ai-coverage.mjs`）要求：入口符号出现在 `apps/mobile/src/` 且**组件被渲染**；`NO_UI_ENTRY_BY_END` 只允许"确实只给本机 API/MCP 用"的功能豁免——这三个是产品功能，不能豁免。

## 结论

这不是本 Harness 的胶水，而是**独立的移动端功能移植**（~1.7k 行 UI + 移动端交互/i18n/无障碍/验收）。草率实现会违反质量门槛，且 `apps/mobile` 正被另一会话改动（`WelcomeScreen.tsx`/`xcodeproj`），并发风险高。

## 计划（建议单独立项，不在 Harness goal 内强行塞入）

1. 先与并发的移动端改动协调窗口（`git status`、确定无人动 `screens/`）。
2. 逐功能移植，复用 `packages/app-host` 的构建器（`requestBreakdown` 等已是共享层入口），移动端只做 UI 绑定（符合 `apps/*` 只放平台差异）。
3. 每移植一个：组件用入口 + 在真实屏幕渲染 + 移动端验收（`docs/agents/ui-acceptance.md`）→ 门禁转绿一格。
4. 三格都绿后 `check:ai-coverage` 归零。

## 与 Harness 的关系

Harness（云端模型+本地工具循环）与这三个功能**正交**：它们各自有自己的 app-host 构建器与既有本地路径。移植它们不改变 Harness；Harness 也不依赖它们。故本 goal 先交付 Harness，此项作为已知剩余单独推进。
