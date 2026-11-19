# P2 spike：@assistant-ui/react-native runtime 适配评估

> 2026-11-19。基于 `@assistant-ui/react-native@0.1.52`（MIT，2026-11-18 发布，npm 实测）与其官方 RN 页说明。

## 它提供什么
原语：`Thread / ThreadList / ThreadListItem / Message / Composer / ActionBar / Attachment / BranchPicker / ChainOfThought / Error / QueueItem / Suggestion`；运行时与适配器（AI SDK / LangGraph）。

## 与我们现状的差距
| 维度 | 我们 | 它的默认 |
|---|---|---|
| 端点 | BYOK / 自托管，URL 由用户填 | 自带 transport 约定 |
| 状态机 | 自建 `chat-controller` + `streamingFetch` | 其 runtime 驱动 |
| 工具 | 本地工具 `createToolHost`（app-host） | 需按它的工具协议 |
| 会话 | 每账号一条，device-prefs 落盘 | 其 runtime 内存态，需自带持久化 |
| 依赖 | 已多端共用 token | 引入会增大 RN 包体 |

## 结论（现在）
**不整体替换 runtime**，继续只借 UI 原语（Suggestion / ActionBar / ChainOfThought / Attachment / ThreadList 已逐步落地）。原因：其 runtime 主要解决"它自己的 transport 与工具协议"，而我们的端点是用户自带、工具在 app-host 本地执行；替换会把会话持久化与隐私闸门一起牵动。

## 隔离 spike 步骤（若将来要接）
1. 独立分支，装 `@assistant-ui/react-native` + `ai`（MIT/Apache，过依赖门）。
2. 写一个 transport 适配器包住现有 `streamingFetch`，把 provider 增量映射成它的消息流。
3. `<AssistantRuntimeProvider>` 只接管线程；`ChatItem` ↔ 它的 `Message` 做一层投影。
4. 验收：对测试端点完成 发送/流式/中止/重试 四件事；一条不达标即回退。
5. 会话持久化仍留在我们侧（它不落盘），避免两套真相。

## 风险
- RN 包体与启动成本；- 工具协议二次适配；- 与隐私披露/同意的耦合；- 版本 0.1.x 尚早期。\
