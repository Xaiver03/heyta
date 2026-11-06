# 决策备忘：heyta 要不要做「每个视图独立的手动排序」

> 日期：2026-11-06。输入：[`ticktick-data-model-parity.md`](../ticktick-data-model-parity.md) §2.3/#29、
> [`ticktick-sync-questions.md`](../ticktick-sync-questions.md) Q6、`packages/domain/src/{entities,task-order,task-filter,subtasks,ticktick-format,ticktick-import}.ts`。
> 这份备忘**只回答一个问题**：per-view 手动排序要不要做、最小形状是什么、代价落在哪。
> ⚠️ **本工作副本缺 `packages/app-host/` 与 `server/`** —— 凡结论依赖这两处的（`listTasks` 的规范顺序、
> 服务端实体白名单上线顺序、导入 `order` 是否真的落成 op），一律标**未核实**，不当事实用。

**一句话结论：现在不做 per-view 排序，但也不是"永远不做"——真正的门槛不是 `CURRENT_SCHEMA_VERSION`，
而是"视图不建实体"这条设计原则（`entity-types.ts:15-18`）和"顺序这个连续量在 LWW 下会被整片覆盖"这条并发事实。**

---

## 1. 滴答怎么做的：macOS 7 张表 / Windows 3 张表，而且两端不同构

**macOS 侧 7 张**（表名逐条来自 [`ticktick-data-model-parity.md`](../ticktick-data-model-parity.md) §1 #29、§2.2）：

| 表 | 服务的视图空间 |
|---|---|
| `ZTTSORTORDER` | 通用一张：`ZITEMTYPE` / `ZCONTEXTID` / `ZITEMID` / `ZKEY` / `ZORDER` / `ZSYNCSTATUS` |
| `ZTTTASKPINNEDSORTORDER` | 任务·置顶 |
| `ZTTPROJECTPINNEDSORTORDER` | 清单·置顶 |
| `ZTTTASKDUEDATESORTORDER` | 任务·按截止日分组内 |
| `ZTTTASKPROJECTSORTORDER` | 任务·清单内 |
| `ZTTTASKPRIORITYSORTORDER` | 任务·优先级分组内 |
| `ZTTTASKTAGSORTORDER` | 任务·标签内 |

`ZCONTEXTID` + `ZITEMTYPE` + `ZITEMID` + `ZORDER`（`ticktick-sync-questions.md` §2.7 给的是"强"档）就是
**「哪个视图 × 哪类对象 × 哪一项 → 第几位」**，而且**每一行自己带 `ZSYNCSTATUS`** —— 排序是逐行同步的数据，不是任务上的一个字段。

**Windows 侧 3 张表**（`ticktick-data-model-parity.md` §0.3 第 2 条、§3.3 (b)）：

- `SyncSortOrderModel`（属性 `EntityId` / `SortOrder` / `Type` / `SortOrderType` / `ColumnId`）——**用 `SortOrderType` 区分子空间**，把 macOS 那 6 张按视图分的表收成一张；
- `TaskSortOrderInDateModel`、`TaskSortOrderInPriorityModel` 两张仍是按视图单开；
- 🔴 `ProjectPinSortOrderModel` 带 `[Table("SyncSortOrderModel")]`，**与 `SyncSortOrderModel` 映射到同一张表**（这是已确证的第一处共表，不是"两个类两张表"）。

⇒ 同语义、不同拆分，而且**拆得更粗的那一端是后来者**：7 → 3 的方向是"从按视图一张表，收敛到一个 (scope, itemId, order) 泛化表"。
它两端都不把顺序写成任务字段（Windows `TaskModel` 有 `sortOrder` 属性，但它与上面那族排序表的关系**未核实**）。

`ticktick-sync-questions.md` §2.3 还有一条对本案直接相关：它的同步器里有专门的 `SYNC_TYPE_TASK_ORDER` 和
专门的 `TTOrderUpdatedTaskBatchSyncHandler` —— **"顺序变了"在它那里是一类独立事务**，与"正文变了"分家。

---

## 2. heyta 现状：不是"没做序字段"，是"禁了序字段 + 有一个死序字段"

按可指的行号列，全部本轮实测：

| 事实 | 出处 |
|---|---|
| `Task.pinnedAt` 一个字段**同时就是"排在最前"**，🔴 **明文不许另设 `isPinned` / `sortOrder`**（理由是"两个字段必然在某一次编辑里漂移"，引 [ADR-0083](../../adr/0083-task-abandonment-fifth-state-and-share-boundary.md) §3.2） | [`packages/domain/src/entities.ts:346-356`](../../../packages/domain/src/entities.ts) |
| 同一条推理在倒数日又写了一遍 | `entities.ts:798-802` |
| 置顶**只比"有没有"，不比时刻** ⇒ 结构上只有**两档**（钉住 / 没钉住），钉住的彼此之间不分先后 | `entities.ts:204-213`（`byPinnedFirst`） |
| 排序口径只有三档：`'display' \| 'addedAt' \| 'priority'`，且**没有"手动"这一档** | [`packages/domain/src/task-order.ts:42-58`](../../../packages/domain/src/task-order.ts) |
| "已完成沉底"与"置顶在前"写在**档位之外**（换档位不该让钉住的东西消失） | `task-order.ts:63-85` |
| ⚠️ 那里给出的"没有手动拖拽"的理由是「它需要一个持久化的 `order` 字段……**而 `Task` 今天没有**」 | `task-order.ts:50-53` |
| 🔴 **但 `Task.order` 是存在的**：`/** 排序键（在清单内的位置）。 */ order?: number;` | `entities.ts:423-424` |
| 且 `order` 已被同级排序消费：`order` 升 → `createdAt` 升 → `id` 字典序；**`order` 目前是死字段（没有任何一处写它）**，接线单点是 `compareTaskSiblings` | [`packages/domain/src/subtasks.ts:49-55、108-129`](../../../packages/domain/src/subtasks.ts) |
| 筛选层**刻意不排序**，"规范顺序在 app-host 的 `listTasks`" | [`packages/domain/src/task-filter.ts:26-31`](../../../packages/domain/src/task-filter.ts)（⚠️ `listTasks` 那份实现**本副本未核实**；`subtasks.ts:54` 提到的 `byCanonicalOrder` 在本副本 `grep` 只剩注释命中，函数体不存在） |
| 排序档位是**设备本地偏好**，不进 op-log、不跨设备：web 全局 `heyta.taskSort` | [`apps/web/src/features/tasks/sort-pref.ts:19-42`](../../../apps/web/src/features/tasks/sort-pref.ts) |
| **已经有一处"每个视图一份排序设置"**：按清单 id 存档位，仍是设备本地 | [`apps/web/src/features/projects/project-sort-pref.ts:9、29-37`](../../../apps/web/src/features/projects/project-sort-pref.ts) |
| 移动端同一件事：`task.sort`，默认档 `addedAt`（与 web 的 `display` **刻意不同**） | [`apps/mobile/src/lib/task-sort.ts:60-91`](../../../apps/mobile/src/lib/task-sort.ts) |
| 现在唯一的拖拽改的是**语义**（象限 → `dueDate` / important），不是顺序 | [`apps/web/src/features/quadrant/QuadrantBoard.tsx:311-343`](../../../apps/web/src/features/quadrant/QuadrantBoard.tsx) |
| 导入侧**已经在读**滴答的 `Order` 列，并塞进 draft：`draft.order = Order ?? rowIndex-1` | [`ticktick-format.ts:80`](../../../packages/domain/src/ticktick-format.ts) · [`ticktick-import.ts:147、703-712`](../../../packages/domain/src/ticktick-import.ts)（⚠️ 它最终有没有落成 `Task` 的 op 字段 → **未核实**，写路径在缺失的 `app-host/ticktick-import-actions.ts`） |

**两处需要立刻纠正的不一致**（这条备忘顺带记下的实测缺陷）：

1. `task-order.ts:50-53` 说"`Task` 今天没有 order"，`entities.ts:423` 就有 `order?: number`。**注释比代码旧。**
2. `ticktick-sync-questions.md` Q6 的判定"heyta **连任务上的序字段都没有**"在字面上已不成立 —— 成立的是后半句：
   **有字段、没人写、界面上不可达**。所以 Q6 的真实状态是"半接线的 `Task.order`"，而不是"结构上表达不出来"。

---

## 3. 若要做：两条最小实现，以及 bump 判定

### 路线 A（一份全局手排序，不是 per-view）：接通已有的 `Task.order`

改动面：`app-host` 加一条 `reorder` 动作（一次拖 = 一条 `TASK/UPD {order}` op）+ 给 `TaskSortKey` 加一档 `'manual'`
+ 把 `order` 的比较从 `compareTaskSiblings` 提到 `task-order.ts` 的公共档（`subtasks.ts:54` 已预留"只改这一个函数"）。
**不碰 `ENTITY_TYPES`、不碰线协议。**

### 路线 B（真 per-view）：一个泛化实体，而不是 7 张表

形状照 Windows 收敛后的那一张：`{scope: 'today'|'project'|'tag'|'priority'|'pinned', scopeId?: string, itemId: string, kind: 'task'|'project'|..., order: number}`，
一次拖 = 一个 `(scope, scopeId, itemId)` 的一条 op。**不是** 7 张按视图的表，也**不是**在 `Task` 上放 7 个字段。

### 🔴 `CURRENT_SCHEMA_VERSION` 会不会 bump：**两条都不会**

依据（逐条可指）：

- [`packages/shared-schema/src/schema-version.ts`](../../../packages/shared-schema/src/schema-version.ts) 文件头把政策写死：**默认不 bump**（`:4-28`），现值 `CURRENT_SCHEMA_VERSION = 1`（`:36`），只有"转换型迁移（字段改名/删除、op 被丢弃）或必须硬栅栏的语义"才值得付那个代价（`:25-28`）。加一个可选字段、或加一个**新实体类型**，都不是转换型迁移。
- **可选字段先例**：`entities.ts:346`「纯可加性，不 bump schema」（`pinnedAt`）、`entities.ts:358`（`abandonedAt`）。🔴 新字段一律写成可选 + 运行时默认值（AGENTS §3.3：**必填字段会在 hydration 时炸，TS 与构建都不会告诉你**）。
- **新实体先例**：`entity-types.ts` 里 `EVENT`(`:35-39`)、`AI_FEEDBACK`(`:67-69`)、`PREFERENCE_CORRECTION`(`:79`)、`ASSISTANT_TURN`(`:91-97`)、`COMMENT`(`:109-113`)、`ATTACHMENT`(`:132-135`) **六次加实体、六次都不 bump**。

⇒ **版本号不是这条决定的门槛。** 门槛是三件别的事：

1. **设计原则**：`entity-types.ts:15-18` 原则 2「**视图不建实体**……否则会出现"视图数据与任务数据不一致"这一类经典 bug」。路线 B 正面撞它。（`ticktick-data-model-parity.md` §2.7 已经把这条界线画准了：**保存的筛选是用户数据、不是视图** —— per-view 排序行落在哪一侧，是要新写 ADR 论证的那一步。）
2. **服务端必须先上线**：`entity-types.ts:37-39、93-95` 明写 —— 老服务端白名单（从该数组派生）里没有它，op 会被判 `INVALID_ENTITY_TYPE` **永久拒绝**。⚠️ 服务端派生代码本副本**未核实**。
3. **物化与门禁**：加进 `ENTITY_TYPES` 却不在同批进 `BUCKET_BY_ENTITY` / `EntityModelMap`（`entities.ts:996-1011`），就是 `op-log/src/state.ts:513-537` 那条"合法但静默丢用户数据"的坑；要么实现，要么显式登记 `UNMODELED_ENTITY_TYPES`。`check:ai-coverage` 分母同时 +1（`package.json:204`）。

### 顺序这个量本身的并发难题（本案最难的一条，与 bump 无关）

`order` 是**连续数值**，而本引擎的 LWW 对字段是**覆盖语义**。两台设备各拖一次，胜出的一方会把对端刚写的**整段序**盖掉；
更糟的是"第 3 位"这个整数**依赖同一视图里其他项的序**，并发写出来的中间态可以是一串重复号。
滴答为此把 `TASK_ORDER` 单列成一种同步事务（§1 末）。heyta 若做路线 B，**必须**把序设计成
**不依赖邻居的稳定键**（稀疏/分数序，或字典序可插入的字符串 key），让"插入 A 与 B 之间"不需要重写其他行 ——
否则就是"每视图一条排序行"换来了"每视图一条会互相吞掉的数据"。

---

## 4. 用户能感知到什么（做了之后）

- **拖到第几位就是第几位**，且**重排不会被"改了日期 / 勾了完成 / 换了优先级"冲掉** —— 现在手排无处可存，任何一次字段变更都会让它退回派生序。
- **同一个任务在不同视图可以排不同位置**：在「今天」第 1、在它的清单里第 9。这是 per-view 与路线 A 的**唯一**体验差别；路线 A 只能保证"一份全局手排序"，各视图看到的是同一个序（或由派生规则盖掉）。
- **换设备/换端以后还在**（进 op-log 才成立；现在的设备本地偏好 `heyta.taskSort` / `task.sort` 做不到，见 §2）。
- 反过来，**看不见的部分也要说清**：用户不会感知"7 张表 vs 1 张表"，只会感知"我昨天在手机上拖的顺序，今天在电脑上没了" —— 那正是**路线 A/B 共同要交付的那件事**，B 只是额外多交付"跨视图不同"。

## 5. 不做的话，用户怎么绕过

| 绕法 | 它借用了什么 | 症状 |
|---|---|---|
| **置顶**（`pinnedAt`） | 唯一的"排在最前"出口 | 只有两档、钉住的彼此不分先后（§2），"前三条我要按 A/B/C 排"表达不了 |
| **改截止日**（把三条排成今天/明天/后天） | `display` 档按日期升序 | 把注意力语义写成排程语义，日历与提醒跟着变 —— 这正是 `entities.ts:353-354` 明说"是错的"那种用法 |
| **改优先级**（`priority` 档） | 三档优先级当序号用 | 只有 4 个槽（无/低/中/高），且污染所有按优先级消费的地方（四象限、AI 偏好推断） |
| **拆清单 / 加标签** | 结构固化顺序 | 为了"我要这个顺序"造出一堆只有一个用途的清单 |
| **换排序档位 / per-list 档位** | `sort-pref.ts` / `project-sort-pref.ts` | 排的是**口径**不是**位置**，且**不跨设备**（手机选的和电脑选的不同是设计允许的自由） |
| **搜索 / 只看前几条** | 放弃顺序 | 列表一长就失效 |

## 6. 建议与代价

**建议：本轮不做路线 B；把"要不要一份用户手排序"（路线 A）当作一个可拍的小决定单独拍，per-view 等有真需求再新写 ADR。**

理由三条，按硬度排：

1. **需求侧没有读数。** 本轮没有任何一条实测证据说明"跨视图不同序"是被要的；`ticktick-sync-questions.md` Q6 的判定是"没答"，
   它同时明写「⚠️ 这些**不是缺陷**，是**尚未拍过的产品决定**」。在没有负载/需求读数之前提出路线 B，就是臆测需求（同一份文档 §5 第 5 条自己立的规矩）。
2. **原则成本不对称。** 路线 B 要破 `entity-types.ts:15-18` 原则 2，一旦破口，"每视图一份数据"就会有第二、第三个申请
   （折叠状态、列宽、分组内隐藏）；而路线 A 完全在既有形状里（字段已有、比较函数已留了单点接线口）。
3. **真正难的是序的并发合并，不是 schema。** §3 最后那一条在路线 A 上就已经存在（`Task.order` 也会被并发写覆盖）。
   **先在一份序上把"稳定插入键"设计对，再谈复制到 N 个视图**，顺序反过来等于在 N 份数据上各踩一次。

| 路线 | 要动的东西 | 不 bump schema？ | 主要代价 |
|---|---|---|---|
| **A：一份全局手排序** | `TaskSortKey` +1 档；`app-host` 加一条 reorder 动作；`task-order.ts` 消费 `order`；三端 UI 加握把 | ✅ 不 bump | 序的并发覆盖要解决；档位是设备本地、手排序是同步数据 —— **两套事实源要在 UI 上说清"这一档改的是数据"** |
| **B：per-view 一份泛化实体** | `ENTITY_TYPES` +1、`EntityModelMap` +1、reducer 桶 +1、删除级联（删任务/删清单要清排序行）、服务端白名单先行、`check:ai-coverage` +1、每视图一个 scope key 的**稳定定义** | ✅ 不 bump | 破"视图不建实体"；N 份顺序事实源；并发覆盖 × N；AI/搜索/导出对"这条任务的第几位"要多问一句是哪个视图的 |
| **不做** | 无 | — | §5 那六条绕法继续存在，其中"改日期/改优先级当序号"会**污染别的语义**，比没有手排更糟 |

**顺手要修的**（不属于新需求，属于现状错到）：`task-order.ts:50-53` 那句"`Task` 今天没有 order"` 与 `entities.ts:423-424` 直接矛盾，
`ticktick-sync-questions.md` Q6 的"连序字段都没有"也跟着漂了 —— **留一个 TODO 让人以为字段是空的，比空字段更贵**，
因为下一个 agent 会照注释重新加一遍，加出第二个序字段，正好撞上 `entities.ts:348-351` 禁止的那件事。

## 7. 未核实清单

1. 本工作副本**缺 `packages/app-host/` 与 `server/`**：`listTasks` 的规范顺序实现、服务端实体白名单派生、
   以及"导入 `draft.order` 是否写成 `Task` 的 op 字段"三条**均未核实**（只引到注释与文档层）。
2. 滴答 **per-view 的用户可见行为**（同一任务在不同视图确实显示不同序）是从表形状 + `ZCONTEXTID` 推的，
   **没有运行期样本**；`SyncSortOrderModel.SortOrderType` 与 `ZTTSORTORDER.ZKEY` 的**取值词表不可见**。
3. macOS 侧 7 张表来自迁移 DDL 基线列，**可能漏掉 `ALTER TABLE ADD COLUMN`**（[`ticktick-data-model-parity.md`](../ticktick-data-model-parity.md) §4 第 1 条）；
   Windows 侧"表名 = 类名"是**强推断**，若还有第三处 `[Table]` 覆写没解出来，"3 张表"这个计数会再变（同文 §4 第 2/4 条）。
4. `TaskModel.sortOrder`（Windows 属性）与那族排序表的**关系未核实**，本文不用它做任何判定。
5. heyta 侧**没有任何手排序的需求/负载读数**；§6 第 1 条正是因为"没有读数"才建议不拍路线 B。
