# 助手实测证据（2026-11-26）

复现条件：`pnpm --filter @heyta/web dev`，端点指向本机假模型（`http://127.0.0.1:8790/v1`，SSE 逐片返回，首轮返回一次 `list_tasks` 工具调用），隐私同意预置为 `accepted`，`memoryEnabled=true`、`autoExtractMemories=true`。

| 截图 | 事实 |
|---|---|
| `01-shell.png` | 空态只写事实（`Your inbox is empty`），没有首启引导、没有「下一步点哪里」。 |
| `02-disclosure.png` | 首次出境前的披露卡：目的地、模型、留存、**全部字段**（含 `memory.items`）。 |
| `05-memory-empty.png` | 设置 → Features & AI → 记忆：空态一句事实 `Nothing remembered`。 |
| `06-memory-added.png` | 用界面加一条「回答先给结论，别铺垫」：行内显示 `Preference` + 文本，右侧编辑 / 忘记；`Automatically note preferences I mention` 开关为开。 |
| `07-memory-edit.png` | 行内编辑态（Enter 保存 / Esc 取消）。 |
| `08-disclosure-memory.png` | 有记忆时的披露：字段列表包含 `memory.id / memory.kind / memory.text`。 |
| `09-streaming.png` | 进行中的回答：只有已到达的那一段（引用未闭合），不是整段突然出现。 |
| `10-final-with-memory.png` | 完成态：Markdown 表格 / 代码块 / 列表 / 加粗均渲染；顶部「Memory · 1」行可展开；**没有**「Applied (undoable)」——这一轮只读了工具，没写。 |

## 实测读到的三个缺陷（本轮已修）

1. **默认路径不流式**：Web 默认走云端 Harness（`useCloudHarness` 默认 true），而 Harness 分支没有接 `onTextDelta`，整段回答一次性出现。已在 `cloud-harness.ts` / `AssistantPanel.tsx` 接上逐片回调。
2. **默认路径不注入记忆**：Harness 分支绕过了 `requestAssistantTurn` 的 memory 注入，设置里加的条目对实际回答无效。已把同一套 `selectMemoryForPrompt` 接进 Harness 分支，并在会话里落「Memory · N」行。
3. **读工具被说成"已执行"**：`steps.some(s => s.ok)` 把 `list_tasks` 的成功也算成写入，回答下方因此出现「Applied (undoable) / Undo this AI action」。已改为只认 `kind === 'write' && ok`（`hasAppliedWrite`，有独立单测）。

## 复现脚本

截图由 Playwright 直接驱动（不经过任何 mock 组件），脚本要点：预置 `heyta.ai.settings` 与 `privacy.consent`、点击 `[data-testid="ai-assistant-send-button"]`、披露卡出现时点 `ai-assistant-send`。假模型源码与脚本是一次性验证工具，不随仓库发布。
