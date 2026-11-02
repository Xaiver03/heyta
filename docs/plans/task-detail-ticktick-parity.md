# 任务详情面对标滴答清单：A/B/C 三档落地工单

> 起源：产品负责人 2026-11-02 给出两张某对标产品的单任务界面截图（一张"更多"动作面板、
> 一张半屏详情面板），要求「从功能上和 UX 上找差距」，随后拍定
> 「**A、B、C 都是要做的**……你来判断依赖顺序，判断哪些优先做，然后并行执行」。
> 需要落字裁决的三处边界在 [ADR-0083](../adr/0083-task-abandonment-fifth-state-and-share-boundary.md)。
> 本文是**执行台账**：每格的状态只从"执行状态"那一节读，别处不许抄一份。

---

## 1. 差距是怎么量出来的

对标对象的两个界面拆成两层看：**能力清单**（那 12 项动作有没有）与
**结构**（首屏回答的是"这是什么任务"还是"这条记录有哪些列"）。
后者才是主要差距，因为它决定前者补完了以后好不好用。

### 1.1 半屏这条线的现状（改动前读数）

| 环节 | 状态 | 证据 |
|---|---|---|
| 共享 `BottomSheet` 原语（把手 / 拖拽 / 三档 30·60·90 / 关闭策略表） | ✅ 有 | `packages/ui/src/overlay/BottomSheet.tsx`、`sheet-detents.ts:39` |
| 任务详情面板迁到它 | ✅ 有 | `apps/mobile/src/screens/TaskDetailSheet.tsx:445` |
| 默认开在哪一档 | 🔴 最大档 0.9 | `sheet-detents.ts` 的 `resolveInitialDetent`："没有记忆时用最大那一档" |
| 记住用户上次拖到哪一档 | 🔴 钩子有、零宿主使用 | `onDetentChange` 全仓除组件自身外无调用点 |
| 其余三枚 `*Sheet.tsx` | 🔴 仍是自绘 `Modal` + 居中 + `maxHeight:90%` | `ConflictSheet.tsx:91`、`LegalReconfirmSheet.tsx:61`、`PrivacyConsentSheet.tsx:87` |
| 内容区往下拖能否收起 | 🔴 不能（只在把手上接拖拽） | `BottomSheet.tsx` 文件头取舍第 2 条 |

结论：**地基是好的，缺的是"谁住进去"和"默认值对不对"。**
`sheet-detents.ts` 里 medium 那一档的注释写的正是"底下还留着 40% 的上下文，
用户能看见自己是从哪一行点进来的"——那条理由对，但没有任何面板用它当默认。

### 1.2 动作面板那 12 项的逐项对账（改动前）

| 对标项 | 我们 | 差在哪一层 |
|---|---|---|
| 置顶 | ❌ | `Task` 无字段、无 op（`pinnedAt` 只在 `CountdownEvent`）。→ ADR-0083 §3.2 |
| 分享（单条任务） | ❌ | 只有清单级共享。→ ADR-0083 §3.3 |
| 放弃 | ❌ | 任务无 abandoned 态。→ ADR-0083 §3.1 |
| 删除 | ✅ | 软删进回收站（ADR-0048） |
| 添加子任务 | ⚠️ **半有** | 能挂父（`setParent` + `canSetParent`），**不能就地生一条**，也没有子任务列表/勾选/计数。`apps/mobile/tests/subtask-entry.spec.ts` 钉的是"挂父"那一格 |
| 关联主任务 | ✅ | 上级任务 chips |
| 开始专注 | ⚠️ | 专注屏有，任务行与详情面板无入口（[row-actions-redesign §9.4](row-actions-redesign.md) 自登记） |
| 转换为笔记 | ⚠️ | 笔记模块是活的，但没有 task→note 这个 op |
| 附件 | ❌ | 全仓无实体、无上传、无对象存储。→ ADR-0083 §3.4 |
| 标签 | ⚠️ | 能挂不能就地新建 |
| 任务动态 | ❌ | op-log 里有历史（`engine.ts:378-385` `getOpsForEntity` + reducer 的 `FIELD_VERSIONS`），没有界面 |
| 更多（第二层） | ❌ | 移动端没有第二层：行尾只有一枚删除图标，长按被批量选择占用 |

### 1.3 结构差距（不是字段清单）

1. **首屏回答的问题不同**：对标产品是"这是什么任务"（24pt 正文 + 日期状态行 + 勾选框），
   我们是"这条记录有哪些列"（带"标题"标签的输入框 + 13 个区段全展开）。
2. **动作区不常驻**：完成/删除在 0.9 屏的滚动内容**之外**，
   直接违反 `docs/agents/ux-principles.md` §3（判据 S1：不滚动就能 `click()`）。
3. **没有"次要"这个概念**：13 段平铺，违反 §4「配置项默认收起」。
4. **面板糊住上下文**（90% 档 + 不记档位）。
5. **行上操作移动端是空的**：Web 那套右键/滑动重设计（row-actions-redesign §9.1）
   自己写明"设计已定，代码未改，只落了 Web"。

### 1.4 ⚠️ 别照旧文档下判断

`docs/research/dida365-feature-benchmark.md` §2.1 里"没有备注输入框""无 `parentId`"
"提醒全链路 0""UI 只有日期粒度"这几行**已过期** —— 这四件现在都做了。
该文档 §3 的"撞名清单"方法仍然有效，但逐格读数要现量。

同一类漂移在 [ADR-0048](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md) §4 里也有一处：
它写 `archived` 的动作层 list 分裂（W9）**尚未落**，但 2026-11-02 现量它已经落了 ——
`packages/app-host/src/project-actions.ts:148` 的 `listProjects()` 与 `:155`
的 `listArchivedProjects()` 都在，且注释明说界面上「显示已归档」开关的数据源是后者。
本工单与 ADR-0083 §3.1 引用的正是**这个已落地的形状**，不是那份旧读数。
（不改 0048 的结论，只在这里记下它这句状态说明已经漂了。）

---

## 2. 三档切法与依赖顺序

| 档 | 判据 | 项 |
|---|---|---|
| **A** | 不碰数据模型 | 面板重排、默认档 + 记档、头部三件套、逾期状态行 + 顺延、行操作（长按菜单 / 左滑）、三枚 Sheet 迁移 |
| **B** | 要新 op，不碰不可逆层 | 就地添加子任务、子任务列表/勾选/计数、标签就地新建 |
| **C** | 碰实体清单或状态机（🔴 不可逆层） | 置顶、放弃、附件、任务动态、单条任务分享 |

依赖：**C 的字段/实体是 A、B 接线的输入；A 的结构定型是 B、C 界面落点的输入。**
所以按阶段走，而不是按档位走 —— 同阶段内并行，跨阶段串行。

---

## 3. 执行状态（**唯一事实源**，逐格现量）

图例：⏳ 未开始 · 🔄 在跑 · ✅ 已落 · 🔴 受阻（写清卡在谁手里）

| # | 项 | 档 | 状态 | 落点 / 读数 |
|---|---|---|---|---|
| 1 | 置顶 `Task.pinnedAt` + op + actions + 排序 | C | ✅ | `packages/domain/src/entities.ts`（`pinnedAt` + `byPinnedFirst`）、`packages/app-host/src/actions.ts`（`setPinned`）；11 条用例绿，变异验证过能红 |
| 2 | 放弃 `Task.abandonedAt` + 动作层 list 分裂（I5） | C | 🔄 | 字段 + `isAbandoned` + `setAbandoned` + `listTasks()`/`listAbandonedTasks()` 分裂出口已落；🔴 **剩四处"既不滤也没人滤"的下游未收敛**（见 §5） |
| 3 | 任务动态：op-log → 变更流水读路径 | C | ⏳ | 底座已确认：`engine.getOpsForEntity('TASK', id)` 可用（`actions.spec.ts` 自己就在用它） |
| 4 | `BottomSheet` 默认 medium + 档位记忆 + 头部拖拽 | A | ✅ | `sheet-detents.ts`（`DEFAULT_SHEET_DETENT` + `resolveDetentSeed` 三级优先）、`sheet-drag.ts`（新，`body`/`closeButton` 刻意不在表内）、`BottomSheet.tsx` 接线 + 迟到的记忆"只采纳不回写"；26 条判据绿、`check:overlay` 账本无新增 |
| 5 | 移动端行操作：长按菜单 + 左滑 | A | ⏳ | 旧默认档那条断言已被推翻（`overlay-sheet-detents.spec.ts` 里写着为什么） |
| 6 | 其余三枚 Sheet 迁到共享原语 | A | ⏳ | 原语侧新增的 `rememberedDetent` 与拖拽区域表可直接用 |
| 7 | 详情面板重排（内容层 + 折叠层 + 头部三件套） | A | ⏳ | 依赖 #4（已解锁）。🔴 必须同时满足 `ux-principles.md` §3「动作区常驻」—— 现在完成/删除在滚动内容之外，是**现成的违规** |
| 8 | 逾期状态行 + 接 `postponeToToday` | A | ⏳ | 依赖 #7；`actions.ts:275` 已有动作，移动端零调用点 |
| 9 | 就地添加子任务 + 子任务列表/勾选/计数 | B | ⏳ | 依赖 #7 |
| 10 | 标签就地新建 | B | ⏳ | 依赖 #7 |
| 11 | 置顶/放弃/动态 接线到界面（含"已放弃"出口） | C | ⏳ | 依赖 #1/#2/#3/#5/#7。宿主**不许**自己 filter 放弃态，只能调 `listAbandonedTasks()` |
| 12 | 附件：实体物化 + blob 通道 + 界面 | C | ⏳ | 依赖 #1/#2（同文件）、#7（同落点） |
| 13 | 单条任务分享（发送到共享清单） | C | ⏳ | 依赖 #7；公开链接**不在本轮**（ADR-0083 §3.3） |
| 14 | 门禁与验收串行跑 | — | 🔄 | 已过：`@heyta/ui` 834 条、`@heyta/domain` 1116 条、`@heyta/app-host` 2120 条、`check:overlay` |

## 3.1 两条不属于本轮的红（现量，会过期）

| 红 | 归因 | 依据 |
|---|---|---|
| `packages/domain/tests/habit-backfill.spec.ts` B8 | 🔴 **门禁自身的缺陷**，不是产品缺陷 | 报的是 `ENOENT .../apps/mobile/ios/Pods/Headers/.../RCTAppDependencyProvider.h` —— 它的源码扫描 `walk()` 会遍历到 iOS 原生构建目录，任何人跑一次 `pod install` 它就红 |
| `packages/domain/tests/lunar.spec.ts` 逐日往返；`packages/app-host/tests/share-key-store.spec.ts` 信封往返 | 负载下的不确定性超时 | 同一命令两次跑出 **1 红**与 **4 红**，且两次都是 `Test timed out in 5000ms`；被测对象（农历换算 / 共享密钥信封）与本轮改的 Task 态无交集 |

### 3.1 并发前提（本轮开工时的读数，会过期）

工作树在本轮开工时**不干净**：另一条会话有 20 个未提交文件在飞
（`packages/ai/**`、`apps/web/src/App.tsx`、`packages/i18n/src/locales/**`、
`apps/landing/src/mockup/app-shell-shape.ts` 等）。
本轮所有作业**不碰**那批文件；`packages/i18n/**` 与所有 `index.ts` 导出桶
由主线统一改，避免并发覆盖。
基线红一条且不属于本轮：`apps/landing/tests/mockup-shell-shape.spec.tsx:563`
（`optionKey` 不存在）。

---

## 4. 明确不做（每项写清为什么）

| 项 | 不做的原因 | 什么条件下重判 |
|---|---|---|
| 单条任务的**公开只读链接** | 可行性取决于对端账号的加密档位（ADR-0081），且转发后无法撤销；要先解决密钥分发（ADR-0062 那一份的独立问题） | 有人为"公开链"单独写一份密钥分发与撤销的 ADR |
| 用 `completedAt` 冒充"放弃" | 会污染完成率统计与重复任务的推进 | 永远不做 |
| 各宿主自己 filter `abandonedAt` | ADR-0048 I5 点名的失效形状，四条实测缺陷的共同根因 | 永远不做 |
| 给附件单独加强制 E2EE | 违反 ADR-0081：加密是整库档位，不给单类数据开例外 | 用户显式开启 E2EE 时自然覆盖到它 |
| 内容区任意位置下拉收起面板 | 无 gesture-handler 时与 ScrollView 的滚动协调做不对，"想滚却把面板关了"比没有更糟 | 引入 gesture-handler 且过 §3.1/§3.2 两道门 |
| 全滑直删 | row-actions-redesign §9.3 明文采用"露出动作、点击执行" | 配撤销回执与"误触后能反悔"的证据之后 |
