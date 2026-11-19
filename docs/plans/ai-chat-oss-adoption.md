# AI 对话：借力成熟开源组件（选型与落地）

> 2026-11-19。现状：AI 页已修好两端渲染与输入框，空态改为建议卡。本文记录「可用的开源件」与我们该借什么、不该整体替换什么。

## 1. 候选依赖（npm 实测：版本 / 许可证 / 最近发布）

| 包 | 版本 | 许可证 | 最近发布 | 结论 |
|---|---|---|---|---|
| `@assistant-ui/react-native` | 0.1.52 | MIT | 2026-11-18 | 可引入：MIT、仍在更新；提供 RN 的 Thread/Composer/Message/Suggestion 原语 |
| `@assistant-ui/react` | 0.15.37 | MIT | 2026-11-18 | web 端同款原语，作结构参考 |
| `ai`（Vercel AI SDK） | 7.0.177 | Apache-2.0 | 2026-11-18 | 可引入：流式/状态原语；需适配我们的 BYOK 端点 |
| `@ai-sdk/react` | 4.0.181 | Apache-2.0 | 2026-11-18 | `useChat` 状态机；web 导向，RN 需自管 transport |
| `react-native-gifted-chat` | 3.5.0 | MIT | 2026-11-10 | 可参考气泡列表；纯 UI，无 agent 运行时 |

取数：`npm view <pkg> version license time.modified`（2026-11-19）。

## 2. 我们缺什么 → 借哪件

| 能力 | 现状 | 借谁 |
|---|---|---|
| 消息气泡列表 | 已有（ChatTranscript：左右气泡、流式光标、生成标识） | 保持，对齐 assistant-ui `Message` |
| 空态建议 | **已做** 2×2 建议卡（`ai/suggestion-grid.tsx`） | assistant-ui `Suggestion` |
| 输入框 Composer | 已有（多行、发送态、键盘避让） | 对齐 assistant-ui `Composer` |
| 每条消息动作（复制/重试/引用） | 缺 | assistant-ui `ActionBar` |
| 思考链 / 工具步骤 | 有 trace 文案，无结构 | assistant-ui `ChainOfThought` |
| 附件 | 缺 | assistant-ui `Attachment` |
| 会话列表 / 切换 | 有 history 开关，无列表 UI | assistant-ui `ThreadList` |
| 流式 + 状态机 | 自建 controller + streamingFetch | 评估 `ai` SDK 的 transport；**不整体替换 controller** |
| 会话持久化 | 已有（按账号/端点分开的 history） | 保持，字段对齐即可 |

## 3. 决策：借原语与交互，不盲换运行时

heyta 的 AI 是 **BYOK / 自托管端点 + 自建 controller + 自建会话存储 + 本地工具调用**。assistant-ui / Vercel AI SDK 的 runtime 默认面向它们自己的 HTTP 传输与工具协议；直接替换会牵动会话持久化、工具调用与隐私闸门。**结论：UI 原语与交互直接借；运行时先做隔离 spike，验证通过再迁移。**

## 4. 分期

- **P0（已完成）**：两端渲染/输入框修复；建议卡；顶栏 ⋯ 收历史/新会话。
- **P1**：ActionBar（复制/重试）、ChainOfThought（把 trace 结构化）、Attachment（选本地文件/任务）。
- **P2（spike）**：在隔离分支评估 `@assistant-ui/react-native` 的 runtime 适配我们现有端点；只在新分支，不动主线。
- **P3**：会话列表（ThreadList 形态）、多会话切换与重命名。

## 5. 引入前置（仓库规矩）

任何依赖先过 `docs/agents/hard-constraints.md` §3.1–3.2（2021 后仍在更新、白名单许可证）并在提交信息登记；上述候选均 MIT/Apache-2.0、近期仍在发布，满足门。禁止为了过门改测试。
