# 助手质量收口（2026-11-26）

> 范围：本轮实测发现的**界面说假话 / 默认路径不生效**，以及仓库里既有的红门禁。实现与证据见 [`docs/research/assistant-parity-2026-11-26/`](../research/assistant-parity-2026-11-26/README.md)。

## 1. 实测暴露的三件事（按严重度）

| # | 现象 | 根因 | 已做 |
|---|---|---|---|
| 1 | 回答整段出现，不是逐字 | Web 默认走云端 Harness，Harness 分支没接 `onTextDelta` | Harness 接文本流；`live` 与直接路径共用 `reduceAssistantLive` |
| 2 | 设置里加的记忆对回答无效，也没有「记忆 · N」行 | Harness 分支绕过了 `requestAssistantTurn` 的记忆注入 | Harness 分支用同一 `selectMemoryForPrompt`，并回调 `onMemoryUsed` |
| 3 | 只读工具成功后显示「Applied (undoable)」 | `steps.some(s => s.ok)` 把读也算成写 | `hasAppliedWrite` 只认 `kind==='write' && ok`；两端同步 |

## 2. 红门禁：产品判断与处置

| 红 | 判断 | 处置 |
|---|---|---|
| `check:l4` 62>52 | 移动端把样式写在视图里，和"设计系统单一来源"冲突；不是功能债 | 课表导入/作息编辑/通知屏改 `StyleSheet`，实测降到 51，棘轮跟着降 |
| `check:empty-state` 5 处 | 侧栏/设置卡里的空态是**一行事实**，套页面级 `EmptyState` 会改变行高；不是第二份实现 | 登记这 4 个"一行式"站点并写明理由；删掉 2 个已消失的登记 |
| `check:overlay` 6 处 | 三处 `Alert` 是**信息提示**（导入结果/为空），信息不该弹系统框；另三行是账本过期 | 信息提示改为页内一行；剪贴板失败改为页内可复制文本；删除过期账本 |
| `check:reachability` | `CALENDAR_EVENT` 是**只读镜像**（ADR-0089）；`FILTER`/`SECTION` 是工具先行 | 新增"声明式例外"（只读 / tool-first），断言 E 验声明仍成立、接上 UI 即红；补 FILTER/SECTION 家族登记 |
| `check:persistence-keys` | 三枚既有键未登记 | 按 ADR-0085 登记（对话会话、更新设备号、已提示版本） |
| `check:docs` 死链 | `.local` 是本机笔记；ADR-0089 那条是路径写法被当成链接 | 扫描面排除 `.local`；ADR 改成书名号；本机截图登记豁免 |
| web/mobile 全量 13+7 条 | 多数是产品改版后的**过期断言**；少数是真 bug（读被说成写、注入被绕过） | 逐条对账：改文案/计数/口径，或修实现（见 §1） |

## 3. 方向（产品）

1. **一条流式路径**：Harness 与直接请求必须共用同一套事件归约与 UI；默认路径不能因为"另一个开关"就退化成整段。
2. **记忆在默认路径可见**：设置里能加，回答里必须能看到"用了哪几条"；否则用户会以为设置没生效。
3. **"已执行"只对写**：凡是界面说"已执行/可撤销"，判据必须落在**写步骤成功**上，不能落在"这一轮跑完了"。
4. **单一后端**：`FILTER` 的 op-log 与 localStorage 双轨要收敛（当前声明为 tool-first 债）；`SECTION` 的 UI 入口应补，否则 AI 能建分组而用户看不见。
5. **只读实体要有说法**：镜像类实体不该被"必须有写路径"的门禁逼出假写入；用声明 + 到期检查替代。

## 4. 判据

- `hasAppliedWrite`：读成功/写失败/空列表都不得说"已执行"。
- Harness 与直接请求：同一句提问，默认路径必须产生 `live` 文本与 `Memory · N` 行。
- 视觉证据：`docs/research/assistant-parity-2026-11-26/README.md` 的 10 张截图。
