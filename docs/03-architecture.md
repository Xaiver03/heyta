# 架构决策草案（v0.1）

> 已确定的约束（来自你的选择）：
> 1. **开源核心 + 自建/托管收费** —— 代码对外开源，靠托管服务与上架版本变现
> 2. **全平台同时** —— iOS / Android / Web / Windows / macOS / Linux
> 3. **本地优先（local-first）** —— 数据先落本地，云端只是同步通道
>
> 状态：**待你确认**。选定后本节转为 ADR-0001 正式记录。

---

## 1. "全平台同时"必须先想清楚的一件事

全平台 ≠ 六端同时开工。现实约束：

- 一个人维护六端，一定会烂尾
- 但**架构必须一次性设计对**，否则后期补同步协议会推倒重来

所以正确姿势是：**一次设计六端架构，分三批交付**。

| 批次 | 内容 | 为什么这个顺序 |
|---|---|---|
| 第一批 | 共享核心包（数据模型 + 同步引擎 + 业务逻辑）+ 1 个端跑通 | 核心不写对，后面全是重构 |
| 第二批 | 补齐其余端 | 核心稳定后，端只是 UI 外壳 |
| 第三批 | 小组件、通知、日历双向同步等平台特有能力 | 依赖前两批 |

---

## 2. 跨端技术栈：三条路

| 方案 | 复用程度 | iOS/Android | 桌面 | Web | 评估 |
|---|---|---|---|---|---|
| **Flutter** | 几乎 100%（含 UI） | 原生编译，体验好 | 支持 | 支持但首屏体积大 | ✅ 单代码库覆盖六端最现实的选择。AppFlowy（76k star）已证明 Flutter 能做这类应用 |
| **React Native + Web 共用逻辑** | 逻辑共享，UI 各写 | 成熟 | 需另做 | 原生 | 生态最大，但桌面端要另起灶 |
| **Kotlin Multiplatform** | 只共享逻辑，UI 各写 | 最佳 | 支持 | 支持 | 质量最高，但**六端 UI 要写六遍**，单人不现实 |

**倾向结论：Flutter。**
理由：这是唯一能让一个人同时覆盖"手机 + 桌面 + Web"的方案；待办类应用对性能不敏感，Flutter 的短板（体积）影响小。

**代价**：无法直接复用 Angular/React 生态的开源待办项目代码——只能**借鉴其数据模型与交互逻辑**，代码要重写。

---

## 3. 同步引擎：不要急着上 CRDT

本地优先的核心是"多端改同一份数据怎么合"。选项：

| 方案 | License | 特点 | 对我们的适配度 |
|---|---|---|---|
| **自研 LWW + 操作日志** | 自有 | 每条记录带 `updatedAt`/`rev`，字段级合并 | ✅ **推荐**。待办数据是"独立条目 + 少量字段"，冲突场景极简单（最多两端同时改同一任务的标题） |
| Electric | Apache-2.0 | Postgres 逻辑复制下发，写入要自己写 REST 端点 | ⚠️ 它 2026 年已转向"AI agent 状态同步"，方向漂移 |
| PowerSync | 客户端 SDK Apache-2.0，**服务端 source-available 且限制竞品商用** | Postgres → 客户端 SQLite | ❌ **许可证有坑**：我们自己就是做同类产品 |
| Zero (Rocicorp) | 开源可自建 | Postgres → 响应式客户端 | ⚠️ 较新，托管 $30/月起 |
| LiveStore | 开源 | 事件日志 + SQLite，偏 Cloudflare | ⚠️ 绑定 Cloudflare |
| Yjs | MIT | 文本/文档 CRDT | ✅ 只在"任务描述协同编辑"场景需要，可后置 |

**关键判断**：摘要是**不要引入 CRDT 同步框架**。
滴答清单的冲突场景不是 Google Docs 那种字符级并发编辑，而是"手机勾了完成、电脑改了日期"。用
`字段级 last-write-wins + 软删除墓碑（tombstone） + 单调递增版本号` 就能正确解决，代码量几百行，
且完全可控、无许可证风险、无外部服务依赖。

→ 真正难的不是合并算法，而是**离线队列、时钟漂移、墓碑回收**。这三件事自研也要做，引框架也要做。

---

## 4. 数据模型要点

```
Task       — id, listId, parentId, title, desc, priority, dueDate, startDate,
             allDay, rrule, completed, completedAt, sortOrder, deletedAt, rev, updatedAt
List       — id, name, icon, color, folderId, sortOrder, rev, ...
Tag        — id, name, color            TaskTag — taskId, tagId
Habit      — id, name, icon, color, goalType(target/unit), frequency, rrule
HabitLog   — id, habitId, date, value, note
FocusSession — id, taskId?, startedAt, endedAt, mode(pomo/stopwatch), duration
Reminder   — id, taskId, triggerAt, offset, fired
```

必须提前定的三个细节（后期改代价极大）：
1. **排序字段**：用 `sortOrder` 小数或 LexoRank 字符串，避免拖拽时整表重排
2. **时区**：日期存 UTC + 记录用户时区；**习惯打卡的"今天"必须按用户本地时区算**
3. **删除**：一律软删除 + 墓碑，否则离线端会把已删数据"复活"

---

## 5. 服务端（托管收费的那部分）

| 组件 | 选型建议 | 理由 |
|---|---|---|
| 语言 | 与客户端共享逻辑的话用 Dart（`dart_frog`/`serverpod`）；否则 TypeScript | 共享 RRULE 解析与校验逻辑是巨大优势 |
| 数据库 | PostgreSQL | 标配，托管成本低 |
| 部署 | Docker 一键 compose（自建友好）+ 托管版 | 开源项目的自建体验 = 口碑 |
| 推送 | 自建（APNs + FCM）或 ntfy 类方案 | 推送是待办类产品的生命线，不能用第三方依赖 |

---

## 6. 待定项（等调研结论）

- [ ] 底座选型：fork 现成项目 vs 自研（见 `docs/01-oss-landscape.md`）
- [ ] 是否采用 Flutter（若决定 fork Super Productivity，则此项推翻）
- [ ] 开源许可证选择：AGPL-3.0（防他人白嫖做托管）vs Apache-2.0（生态友好）
  → 你选了"开源核心 + 托管收费"，**AGPL-3.0 更契合**：别人拿你的代码做闭源托管会被强制开源

---

*本文档会随调研结论更新。确认后转为 ADR。*
