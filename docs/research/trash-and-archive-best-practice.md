# 回收站与归档：现状勘察 + 市面实践

> 状态：**已成稿**（2026-10-03；§3.2 外部一手已回填，§3.3 如实列出取不到的项；
> **同日第四轮"读现有代码"的结论已折入** —— §2.6 之外新增 §7.2、D11/D12/D13，§八 第 1 条已结案）
> 勘察基线：工作树 @ `f79d3733` 起量，**复核于 `a5c77e3b`**，第四轮的承重行号**复核于 `437e7c1a`**
> （本文写作期间 `main` 被并行会话推进过三次，故每次复核都记 SHA）
> 🔴 本文所有 `文件:行号` 都是**工作树读数**，不是 HEAD 读数。承重那五条已逐一复跑
> （`search.ts:95`、`App.tsx:1130`、`notify.ts:139`、`project-actions.ts:66/163`、`selectors.ts:243`
> 均仍成立）；第四轮新增加进承重的五条：`project-actions.ts:205-207`（`listProjects()` 不滤 `archived`）、
> `projects/model.ts:107`（全仓唯一的归档过滤）、`server.ts:359-360`（MCP 直接把它回给调用方）、
> `native-bridge.ts:273-277`（`removeTask` 只发软删）、`check-journey-coverage.mjs:351`（只做 `existsSync`）。
> 其余行号引用前请先复跑：
> `grep -n "export function searchTasks" packages/domain/src/search.ts` 这类一条命令即可核对一条。
> 工作树含并行会话未提交改动，单列在 §2.7
> 方法：逐文件读被调方本体（不采信转述）+ `git show HEAD:` 对照 + 外部官方文档
> 交付：本文给**事实与约束**；方案与工单在 [trash-and-archive.md](../plans/trash-and-archive.md)

---

## 一、结论先行

1. **heyta 今天有四个"从主视图消失"的状态，但只有两个对用户可见。**
   `completedAt`（已完成）与 `deletedAt`（回收站）有界面；`archived`（归档）**只进不出、没有任何界面**；
   `purgedAt`（已彻底删除）刻意没有任何界面。四者都是 `EntityBase`/实体上的**独立可选字段**，
   互相不清除。

2. **"彻底删除"在整个系统里不存在物理删除路径 —— 一条都没有。** 客户端 op-log 只追加、
   从不压缩（`archiveUpTo()` 有实现有契约测试、**生产调用方零处**）；服务端那个"45 天清历史"的
   日常任务**受一条因果全量边界授权**，而 heyta 的客户端**从不产生那种 op** ——
   所以对本仓账号它今天**永远删 0 条**（§5.2）。这意味着界面上那句"这不是物理擦除"
   不只是措辞谨慎，而是**当前唯一诚实的说法**。
   🔴 而我们的**隐私政策草案**已经把"45 天后被清理掉"写成了对用户的承诺
   （`packages/legal/src/documents/privacy.ts:381,485`）—— 见 §5.3 与缺陷 D8。

3. **没有任何一份 ADR 定义过删除语义。** 现量方式（2026-10-03，
   `git ls-files docs/adr | grep '\.md$' | grep -v README` = **45 份已入库**，
   工作树另有 2 份并行会话未入库的 0046/0047）：逐份检索
   `trash|delete|archive|tombstone|回收站|墓碑|purgedAt` —— 已入库那份里的命中项**全是别的领域的删除**
   （[ADR-0029](../adr/0029-refuse-to-delete-last-passkey.md)/0041 删通行密钥、
   [ADR-0018](../adr/0018-adjustable-pricing-and-coupons.md) 价目表旧行永不删除）；
   未入库的 0046 讲向量时钟存储，0047 讲水合与归档边界 —— 后者只把"墓碑必须随恢复保留"
   当作**前提**引用（`0047:8,15`），**没有定义删除/还原/彻底删除谁是谁、并发谁赢**。
   删除语义事实上的规格散在
   [`AGENTS.md:825`（§9「第一段用户旅程闭环」第 4 条）](../../AGENTS.md)、[roadmap.md:411](../plans/roadmap.md)、
   `packages/domain/src/entities.ts:30-51` 的注释、以及帮助中心已上线的公开文案里。
   **这不是"没人想到"，是"没写下来所以每个人各自重新解释一遍"** —— 本次勘察查出的
   14 条缺陷（§7，其中 D1、D8、D9 与第四轮的 D11/D12/D13/D14 是此前任何文档都没记过的）全部长在这个空洞上。

4. **回收站只收 TASK 这件事，仓库里有三种互不相容的口径**（§6.3）：
   `AGENTS.md` 写成范围边界、覆盖审计写成 **P2-4 缺口**、帮助中心写成
   "**这不是遗漏：它们的删除语义和任务不一样**"。第三种是最强的断言，也是唯一
   对外承诺过的，但它**没有 ADR 支撑**。

5. **架构上真正缺的那一块是「因果全量边界」（checkpoint）。** 它同时是
   ① 服务端保留清理生效的前提、② 客户端 op-log 压缩（磁盘回收）的前提、
   ③ 任何"真删/加密擦除"的前提。补齐它是一次协议工单，不是回收站的一行；
   **回收站方案不该顺手把它做掉，但必须写清"真删等的是它"**。

6. 🔴 **第四轮的主结论：两种"隐藏"的唯一定义处，都长在拦不住下游的那一层。**
   `deletedAt` 的隐藏**没有定义处** —— 它取决于每个调用方递进来的是原始桶还是 `alive*`
   （于是 Web 搜索漏、移动端不漏，D9）；`archived` 的隐藏**只有一处，在共享 UI 层**
   （`packages/ui/src/projects/model.ts:107`），而**共享 UI 不是边界** ——
   它管得住界面，管不住 `listProjects()` 的其余消费者（MCP/AI 工具、node-host CLI、写入侧 `projectOf`）。
   ⇒ 一句话可复述的后果：**"隐藏"今天只对 heyta 自己的界面有效。**
   ⚠️ 但要把**机制**与**今天的暴露面**分开说（§2.5 第四轮更正）：`archived` 那条今天**还没有用户能踩到**
   （唯一写入口 `archiveProject` 无组件调用点、滴答导入刻意不落成 `archived`），
   它是"W3 加上界面按钮当天就成立"的形状；`deletedAt` 那条（D9）**今天就在漏**。
   两处缺陷（D9、D11）不是两个 bug，是同一个结构决定缺失的两副面孔，
   所以计划把它们合成一条不变量（[计划 §1 的 I5](../plans/trash-and-archive.md)）而不是两张工单各修各的。

7. 🔴 **"会有门禁抓到"在本仓不构成论据**（§7.2 现量）：`check:reachability` 是**家族粒度**
   且只扫 `apps/*/src` 的 `.ts`；`check:layering` 是 8 条**禁止式**正则、同样不看非 TS 宿主；
   `check:journey-coverage` 对登记项只做 `existsSync`。
   ⇒ 涉及原生壳、或依赖"某个新动作必须有人接"的设计，**判据必须自己写**，
   并且方法级"写了没人接"的存量是 **HEAD 9 条 / 活树 8 条**（68 个动作方法里；
   ⚠️ 这九个**不是一类东西**——有人正在接的、该删的多余门面、缺陷根因、独立产品缺口四种，逐条定性见 §7.2）。

---

## 二、现状：四态各自怎么进、怎么出、谁看得见

### 2.1 已完成 `completedAt`

| | |
|---|---|
| 进 | `TaskActions.toggleCompleted` / `setCompleted`（`packages/app-host/src/actions.ts`） |
| 出 | 同一条路径反向 |
| 可见性 | Web：侧栏智能清单「已完成」（`apps/web/src/features/shell/view-tabs.ts:102`）。移动端：任务页的 `completed` 分组（`apps/mobile/src/screens/TasksScreen.tsx:632`） |
| 与删除的关系 | 正交。`task-filter.ts:77` 先滤 `deletedAt`，所以回收站里的任务**绝不**出现在已完成列表；墓碑保留其 `completedAt`，还原后回到原本那一侧 |

> 📌 [dida365 对标审计](dida365-feature-benchmark.md):98 曾把「已完成」判为 P0-5
> （"没有任何 UI 能把 filter 设成 completed"）。**该条已过期** —— `view-tabs.ts:102`
> 现在有入口。引用那份审计时要现量，别照抄它的分级。

### 2.2 软删除 → 回收站 `deletedAt`

```
用户点删除 → TaskActions.remove()  →  一条 OpType.Delete（payload {}）
                                    →  reducer 物化成 deletedAt = op.timestamp
                                    →  实体从所有活视图消失，出现在回收站
```

- **删除一律发 `DEL`，不用 `UPD` 改标志位**（8 处生产 `DEL` 全在这：`actions.ts:490`、
  `project-actions.ts:173,200`、`note-actions.ts:196`、`habit-actions.ts:270,317`、
  `reminder-actions.ts:310`、`ai-feedback-actions.ts:117`）。
- **回收站 = `deletedAt !== undefined && purgedAt === undefined`**，
  按 `byDeletedOrder` 排（最近删的在前，同刻按 id 字典序 —— 那个 id 决胜是刻意的：
  毫秒时钟下同设备连删两条常落同一毫秒，`Object.values` 的枚举序**各端不同**，
  `actions.ts:714-726`）。
- 入口：**不给关、不是功能模块开关**（[主计划](../plans/multi-end-unified-strategy.md):1411
  "rail 下段 回收站/设置 贴底，**不给关**"）。Web 在 rail 工具段
  （`view-tabs.ts:244-246`），移动端在「我的 → 回收站」二级页（`ProfileScreen.tsx:334-338`）。
- 列表行是**四端同一份共享组件** `packages/ui/src/trash/TrashBoard.tsx`（201 行），
  它刻意**不复用** `TaskList`（回收站没有勾选框、主操作是还原），且刻意**不共享确认弹窗**
  （Web 自绘 `role="dialog"`、移动端原生 `Modal` —— 弹确认是宿主的事）。

### 2.3 还原

`TaskActions.restore()`（`actions.ts:495-513`）发的是**一条普通 `UPD`，payload `{ deletedAt: null }`** ——
`null` 走 reducer 既有的"显式清除该字段"语义，因此**不需要新 op 类型、不改 reducer、不 bump schema**，
老客户端回放同一条 `UPD` 得到逐字相同的结果。`actions.ts:141-172` 把为什么不"清墓碑"、
为什么不写 `completed: false` 那样的布尔，逐条写在了注释里 —— **那段注释是这块目前最接近规格的文件**。

两个前置拒绝：已 `purgedAt` → 抛错拒绝；本来没被删 → **不发 op**（没有用户意图要落库）。

### 2.4 彻底删除 `purgedAt`

`TaskActions.purge()`（`actions.ts:515-526`）= `UPD { purgedAt: now() }`。**它只做两件事**：
让回收站按 `purgedAt` 把它滤掉、让 `restore()` 从此拒绝它。`deletedAt` **保留** ——
清掉会让离线对端把这条旧数据当成"从未删除"又同步回来。

字段注释（`packages/domain/src/entities.ts:32-51`）已经替这个设计写过一次"不许外推"：

> ⚠️ **它不等于把 op-log 里的历史抹掉。** …… 真正的加密擦除需要协议级支持，
> 不在本字段的语义范围内 —— **不要把它当"数据已经不存在"来宣传。**

界面对用户说的话与之一致，而且是**纯函数产出、界面与测试同源**
（`apps/mobile/src/lib/trash-display.ts` → `mobile.trash.confirm.notErasure`：
"这不是物理擦除：操作日志里仍然留着这条记录，只是界面不再提供恢复。"，`zh-CN.ts:2897`）。
🔴 注意这条措辞**只有移动端有**：Web 那句 `web.trash.confirm.body`
（`zh-CN.ts:601`）没有"不是物理擦除"这半句 —— 这是**刻意的不对称**（`TrashScreen.tsx:23-24` 自陈），
但它带来的实际后果是：**同一件事两端说法不同，且 Web 的说法更容易被用户读成"真删了"**。

### 2.5 归档 `archived` —— 一个只进不出的黑洞

| 事实 | 证据 |
|---|---|
| `archived` **只在 `Project` 上存在**；TASK/TAG/NOTE/HABIT/EVENT 都没有这个字段 | `packages/domain/src/entities.ts:202-203`（`Tag` 明确没有：`packages/ui/src/projects/model.ts:216-217`） |
| 写入方只有一处，且**只往 `true` 写** | `project-actions.ts:164` `updateProject(entityId, { archived: true })` |
| **没有 `unarchive`** | 全仓 `unarchive` 零命中 |
| 界面上**今天点不到"归档"**（🔴 第四轮更正本行原措辞"零 UI 调用点"——那不准） | 链路是：动作层 `project-actions.ts:163` ✅ → **web store 有转发** `apps/web/src/features/projects/store.ts:75-76`（接口声明 `:42`）✅ → **组件层 0 处调用**（全仓 `archiveProject` 的非测试命中只有上面这两个文件）⇒ "store 没接"与"界面没入口"是两件事，先前那句把它们混成一件 |
| **导入不会造出已归档的清单**（所以黑洞今天不可达） | `packages/domain/src/ticktick-import.ts:620-627`：滴答的 `archived` 状态只被推进 `report.unmapped`（字段名 `archiveStatus`）**不落成 op**；全仓 `archived:` 的**写入**只有 `project-actions.ts:164` 一处（另一处 `apps/node-host/src/cli.ts:395` 是**打印**） |
| 一旦被归档，任何界面都读不到它 | `packages/ui/src/projects/model.ts:107` `aliveProjects` 无条件滤掉 `archived === true`，且注释明确"显示已归档是一个新界面，不在这刀"（`:53`） |

⇒ **准确的结论要分两半说**（第四轮更正后）：
① **今天还没有用户能踩到这个洞** —— 因为唯一的写入口（`archiveProject`）没有组件调用点，
而导入刻意不落成 `archived`。库里是否已存在 `archived=true` 的行**未取证**（那要读真库，本文是代码判据）。
② 但**"接上入口而不接出口"就是黑洞的形状**，而 D11 已经证明：**出口层今天就在漏**
（`listProjects()` 不滤归档 ⇒ 界面藏得住、AI/MCP/CLI 藏不住）。
⇒ 所以"归档要有出口"这件事的紧迫性**不来自今天有数据掉进去**，来自
**W3 一旦给界面加按钮，D11 那处立刻变成用户可见的两端不一致**。
这比删除更糟：删除至少回收站看得见。

同时，归档 ≠ 删除**已经有一条裁决**（[倒数纪念日计划](../plans/countdown-anniversary.md) §2.5）：

> 回收站的既有纪律：彻底删除打 `purgedAt` 标记而**不清 `deletedAt`**……
> **归档同理 —— 它必须是一个独立标记字段，不能靠"改 `deletedAt` 再改回来"实现。**

并已有配套判据形状（同文 §判据）：**"归档实现成改 `deletedAt`" ⇒ 变异测试必须红**。

### 2.6 逐实体能力表（现量 2026-10-03）

| 实体 | 删除（`DEL`） | 回收站可见 | 还原 | 彻底删除 | 归档 | 界面入口 |
|---|---|---|---|---|---|---|
| `TASK` | ✅ | ✅ | ✅ | ✅ | ❌ 无字段 | web + mobile + node-host CLI |
| `PROJECT` | ✅ | ❌ | ❌ **动作不存在** | ❌ | ✅ 字段+动作，**无解档无界面** | — |
| `TAG` | ✅ | ❌ | ❌ | ❌ | ❌ | — |
| `NOTE` | ✅ | ❌ | ✅ **动作已实现，零调用点** | ❌ | ❌ | — |
| `HABIT` | ✅ | ❌ | ❌ | ❌ | ❌ | **删习惯的入口本身未接**（`HabitBoard.tsx:64`） |
| `HABIT_LOG` | ✅（撤销打卡） | — | 重新打卡写 `deletedAt:null` 复用同一 id | — | — | ✅ |
| `FOCUS_SESSION` | ❌ **没有删除动作** | — | — | — | — | — |
| `REMINDER` | ✅ | ❌ | ❌ | ❌ | ❌ | — |
| `AI_FEEDBACK` / `PREFERENCE_CORRECTION` | ✅（`DEL` 当"撤销"用） | ❌ | — | — | — | 记忆面板「忘掉」 |
| `EVENT` | — | — | — | — | — | 🔴 **实体本身还不存在**（不在 `ENTITY_TYPES`，也不在 `EntityModelMap`；[ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) 只是裁决） |

三点值得单列：

- **`purgedAt` 定义在 `EntityBase` 上，十个实体全都"有"这个字段** —— 只有 TASK 有写路径。
  所以"回收站扩实体"**不需要加字段、不需要 bump schema**，缺的是每个实体的
  `restore / purge / listTrashed` 三件套（`restoreNote` 已经写好了，只是没人调）。
- **`FOCUS_SESSION` 连删除动作都没有** —— 它是唯一一个"能建不能删"的物化实体。
- `docs/research/dida365-feature-benchmark.md:84` 里引用的 `actions.ts:393-434` /
  `state.ts:199-222` **行号已漂**（现值见本表；还原在 `actions.ts:495-513`）。
  那份审计当"缺口清单"读可以，当"行号索引"读会指向错处。

### 2.7 工作树里正在改这块的未提交改动 ⚠️

`packages/op-log/src/{state.ts,engine.ts}` 有一批**未提交**改动（+ 未跟踪的
`docs/research/op-log-e1-semantic-spec.md`、`packages/op-log/tests/semantic-invariants.spec.ts`），
它把墓碑物化改成"活动墓碑**屏蔽因果上更旧的字段版本**"，与 `HEAD` 的语义**相反**
（`git show HEAD:packages/op-log/src/state.ts` 第 205 行原话："🔴 墓碑**保留实体的全部原字段**
（`...existing`）—— 这正是'删除可恢复'的前提"）。

后果是**回收站直接依赖的那条契约被推翻**：新语义下回收站里的任务物化后只剩
`id/deletedAt/updatedAt`，`TrashView` 渲染不出标题（另一路勘察实测 `apps/web/tests/trash.spec.tsx`
**1 failed / 7 passed** —— 本次未复跑：当时机器负载 11、另有 12 个测试进程在跑，
与其它验收并发会互相污染读数）。

🔴 **本轮不动它**：归属在并行会话手里，且它改的是物化内核。**方案层要做的只是把这条依赖写下来**：
回收站要显示"删掉的是不是这条"，就必须有办法读到删除发生时的标题；
若字段屏蔽语义成立，则**回收站的标题要改从 op 历史/导出版取**，而不是改测试。

---

## 三、市面实践

### 3.1 仓内**已有一手实测**的竞品事实（基线，本轮之前就已取证）

这三条来自本仓库先前的实测调研，不是本次检索得到的，但它们已经能定住方案的两个关键形状：

| 事实 | 出处 | 它约束我什么 |
|---|---|---|
| 滴答清单**把「归档」与「删除」做成并列的两个动作**（倒数日卡片 `⋯` 长按菜单：编辑/样式/备注/**归档/删除**） | [countdown 调研 §7 第 7 屏](countdown-anniversary-data-and-images.md):240 | 四态模型不是我们的发明；竞品同样不把归档当成删除的别名 |
| 滴答**专门为一类困惑写了 FAQ**：「如果出现"任务已隐藏，因为日历中未显示所属清单"，该如何恢复？」 | [帮助中心 IA](dida365-help-center-ia.md):306 | "归档一个容器之后，里面的东西去哪了"是**真实会被问到的**问题；只加归档不给出口 = 制造客服工单 |
| 滴答的统计口径 tooltip 明写「清单数量」**不含已归档清单**、「任务&笔记数量」不含已完成任务 | [帮助中心 IA](dida365-help-center-ia.md):501 | 归档态要**从统计口径里剔除**，并与"已完成"分开计 —— 这是 heyta 成长/统计面将来必须对齐的一条口径 |
| 滴答帮助中心 FAQ 里「**怎么恢复删除的任务？**」是第 4 问 | [帮助中心 IA](dida365-help-center-ia.md):298 | 恢复路径是高频疑问，不是长尾；回收站的存在本身已经被竞品验证 |

⚠️ 这四条**不能**用来定"保留期多少天""哪些实体进回收站"—— 那两类参数只能等外部一手文档
（下面 3.2），照抄会得出没有依据的数字。

### 3.2 外部一手来源（2026-10-03 直取官方页面）

方法说明：本机搜索索引被中文 SEO 站污染，泛用英文查询基本只返回垃圾；
**域名限定检索（`allowed_domains`）+ 直取官方页面**才有效。另有一类页面根本取不到 ——
Dropbox / Notion / Apple 支持页是 SPA，抓取只拿到 CSS；Wayback 回 429。
取不到的**列在 3.3，不凭记忆填数**。

**A. Microsoft 365 / SharePoint — 两级回收站与它的合规动机**
<https://learn.microsoft.com/zh-cn/sharepoint/retention-and-deletion>（`ms.date: 2026-06-02`）

- 被删用户的 OneDrive 默认保留 **30 天**，可由管理员改
  （`Set-SPOTenant -OrphanedPersonalSitesRetentionPeriod <int32>`）；
  到期前 **7 天**再发一封提醒邮件；"七天后，已删除用户的 OneDrive 将移动到网站集回收站，
  **并保留 93 天**"。⇒ **两阶段窗口是 30 + 93，且第二级仍可恢复、只能靠 PowerShell 还原。**
- 🔑 原话：**"回收站未编制索引，因此搜索中找不到内容。这意味着电子数据展示保留无法在
  回收站中找到任何内容，从而无法保留内容。"**
  ⇒ 微软把"删除的内容对搜索不可见"当成**产品性质**来写，而不是实现细节 —— 而且它诚实写出代价
  （连法务取证都抓不到它）。这条直接命中我们查出的缺陷 **D9**（见 §7）。
- **"Microsoft 365 保留策略和保留标签中的保留设置始终优先于标准 OneDrive 删除过程"**，
  in-place hold 会**挂起**删除 ⇒ 竞品的 TTL 是被合规钩子托住的；
  另一侧的兜底也很硬："在 12 个月未付费存储/存档后，OneDrive 数据**可能会被删除，
  而不管保留设置、保留策略、电子数据展示和所有保留**"。

**B. Todoist — 同品类竞品，而且它的答案恰好相反**
<https://www.todoist.com/zh-CN/help/articles/introduction-to-projects-TLTjNftLM>

- 归档有**完整出口**："点击侧栏中项目旁边的省略符号图标。从菜单中选择存档"→
  "打开仅限已存档的项目选项，您将会看到已存档项目的列表"→"选择撤销存档。
  **当您撤销存档项目时，其所有数据都将恢复并保留**"。
  ⇒ 我们 W3 的形状（解档动作 + 独立的"仅限已归档"视图）与之一致，**且竞品已验证用户会用它**。
- 🔴 **项目删除没有回收站**，官方给的补救是："如果您意外删除了一个项目，
  **请新建一个项目并且导入备份文件**"（专业版/商务版每次登录自动备份，**最多 21 个备份**）。
  帮助文里**通篇未出现 Trash/回收站或任何保留天数**。
  ⇒ 这条是本节最有力的证据：**"容器类对象不进回收站"确实是一种真实存在的产品形态**，
  而它的代价在官方文档里现形为一段"教用户手工重建再导备份"的补救说明。
  ⇒ 对 P-1 的含义：把 `PROJECT` **纳进**回收站是对的，但**不要**把它做进"撤销 toast"那一层；
  真正的反面教材不是"有 TTL"，而是"没有找回路径，只能靠备份"。
- 配额口径值得单记："免费方案最多可以同时拥有 **5 个活跃项目**。要管理更多项目，
  您可以**归档或删除**旧项目" ⇒ 竞品把**归档当作配额出口**（归档不计入活跃数）。
  ⚠️ 对我们的收费设计是一条直接提醒：一旦将来按清单/项目数设闸门，
  `archived` 是否计数必须**当场定死并写进判据**，否则会重现
  [pricing 一致性门禁](../reference/pricing-and-entitlements.md) 那一类"三处各说一套"。

**C. Apache Kafka（Confluent 文档）— 墓碑保留窗口的定义式**
<https://docs.confluent.io/platform/current/installation/configuration/topic-configs.html>

- `delete.retention.ms`，默认 **`86400000`（1 天）**，原话
  **"The amount of time to retain delete tombstone markers for log compacted topics."**
- 🔑 它同时是**消费者侧的时限**："This setting also gives a bound on the time in which a
  consumer must complete a read"，失败后果原话 **"(otherwise delete tombstones may be collected
  before they complete their scan)"**。
  ⇒ 业界对这个问题的表述就是**一个不等式**：`墓碑窗口 > 任何一个消费者可能落后的时间`。
  这正是 §4.3 那条约束的一般形式，而 heyta 现在连这个不等式的**左边都不存在**（没有 GC），
  右边的**测量也没有**（`gapDetected` 无人消费）。

### 3.3 想要但**没取到**一手文档的项（不许凭记忆填）

| 想查 | 为什么没拿到 | 下一轮怎么拿 |
|---|---|---|
| 滴答清单回收站的保留期与收录范围 | `help.ticktick.com` 是 Next.js，条目路径靠猜全是 404；仓内那份 [帮助中心 IA](dida365-help-center-ia.md) 只留了 FAQ **标题**（"4. 怎么恢复删除的任务？"），没留条目 URL | 从帮助中心首页把分类树渲染出来取 `articles/<id>`，用**真实 Chrome**（现成通道），不要用抓取 |
| Google Drive / Photos 回收站天数 | `allowed_domains=support.google.com` 中英文各试两次，中文查询返回"无结果"、英文只回来一篇且页面是 CSS | 同上 |
| Dropbox 分套餐恢复期 + 删除后元数据保留 | 帮助站是 SPA，WebFetch 只拿到样式；Wayback 回 **429** | 真实 Chrome；或改取 Dropbox **隐私政策 PDF**（服务端渲染） |
| Apple 备忘录 / 提醒事项「最近删除」天数 | `support.apple.com` 返回的也是样式 | 同上 |
| Notion 回收站按套餐天数、Salesforce 回收站 15 天 | 域名限定检索两次都"无结果" | 先不加域名过滤搜，再从结果里挑官方域名 |
| CouchDB 墓碑修剪 / GitHub GANTZ 白皮书 | 泛用检索只返回 SEO 站；`allowed_domains=["github.blog"]` 无结果 | CouchDB 官方文档站可直取（`couchdb.readthedocs.io`），GANTZ 找 GitHub 工程博客的正式链接 |

⚠️ 这三类缺口**不影响**本文的方案结论：§1.5 那三条论证是从我们自己的代码判据推出来的
（服务端读不到明文、没有物理删除路径、无权威时钟），外部数字只能**校准参数**、
不能**替代前提**。缺口的真实代价是：**"X 天"这种数字我们暂时一个都不能对外引用**。



---

## 四、heyta 与市面做法的三处结构性不同

这三处决定了"照着抄参数"会抄错，即使第三节给出再多的"30 天"。

### 4.1 服务端看不到内容，所以**云端按内容过期在结构上不可能**

E2EE 下服务端只存密文（`server/src/sync/sync.types.ts:245,249`），它不知道哪条 op 是删除、
哪个实体 `deletedAt` 过期了。业界通用的"服务端 TTL 自动清回收站"（Google Drive /
Dropbox / SharePoint 那一类）**在这里不成立**。

⇒ 任何"保留期"只能由**客户端**裁决，或者干脆做成**视图窗口**（派生、不写任何 op）。

### 4.2 没有权威时钟，"过期"在设备间不会同时发生

`deletedAt` 来自写入设备的毫秒时钟。派生式过期（`now - deletedAt > N`）在不同设备上
会给出不同答案；写 `purgedAt` 让云端裁决又违反 §3.4（被回放的 op 不得触发副作用）
并且会"N 台设备各扫一遍"。这不是致命问题（时间单调向前，最终收敛），
但**它决定了文案不能承诺具体日期** —— "X 天后自动清理"这种承诺在我们的模型里
本身就是各端不同步的。

### 4.3 墓碑必须活过"最久离线的设备"，而我们现在**没有任何机制知道那台设备是谁**

这是 op-log 同步系统的经典失效模式（Kafka log compaction 的 `delete.retention.ms`、
CouchDB 的 tombstone 修剪、GitHub GANTZ 的 tombstone GC 都在处理同一件事）。
heyta 的现状是这条约束**尚未成形**：

| 应有 | 现有 |
|---|---|
| 服务端知道"每台设备的同步位置"，清理只清所有设备都已越过的历史 | `Device` 表与 `touchDevice` 有，但清理判据用的是"是否存在因果全量 op"（§5.2），不是"最落后的设备" |
| 客户端落后太多时**能察觉**并走全量重建 | 服务端算并回传 `gapDetected`，客户端 `planDownloadGapReset()` 也写好了 —— **但全仓零消费者**（`packages/sync-client/src/client.ts` 读 `snapshotVectorClock`/`causalFrontier`，**不读 `gapDetected`**） |
| 客户端会周期产出全量快照作为重建锚点 | `createFullStateOpTypeHelpers()` **零调用方**；heyta 客户端只发 `CRT/UPD/DEL`，从不发 `SYNC_IMPORT`/`BACKUP_IMPORT`/`REPAIR` |

🔴 **一句要紧的区分**（免得把 ADR-0047 当成已经解决这件事）：
那份在途 ADR 定的是**本地** `MaterializedCheckpoint`（用于增量水合与本地归档边界），
而服务端那个 45 天裁剪要的是**线上传输的**因果全量 op（`op_type` 落在 `operations` 行上，
见 §5.2 判据）。两者**不是同一个东西** —— checkpoint 落地不会让服务端开始清理。
2026-10-03 复核：`packages/app-host/src`、`packages/sync-client/src`、`apps/*` 里
`SYNC_IMPORT|BACKUP_IMPORT` 仍然 **0 命中**（现量方式见 §5.2 取证表第 3 行）。

---

### 4.4 可见性对账：**分母是 27 个原始桶读取点**，不是"我想到 8 条读路径"

这条是第二轮全量枚举得到的（现量命令与判定方式附后），它把 D1/D9 从"两个孤立 bug"
变成"一个可测量的面"。

**先立两条不变量，它们决定了要不要到处加判据：**

1. **`purgedAt !== undefined ⇒ deletedAt !== undefined`**，由 `TaskActions.purge()`
   在 `deletedAt === undefined` 时抛错保证（`packages/app-host/src/actions.ts:519-521`）。
   ⇒ **凡是滤了 `deletedAt` 的路径自动排除 purged**；只有「回收站列表」与「restore 拒绝」
   这两类需要单独看 `purgedAt`。
   🔴 所以正确的做法**不是**"到处补 `purgedAt` 检查"，而是**保住这条不变量** ——
   唯一能让它失效的是 import/还原路径直接写桶（本轮未做，但要在 ADR 里钉住）。
2. **`archived` 是 `Project` 独有的第三个可见性轴，而且比 `purgedAt` 更薄**：
   全仓**只有一个**过滤点（`packages/ui/src/projects/model.ts:85-86 aliveProjects`），
   它是**共享 UI 层**的函数，不是动作层的。
   ⇒ 任何**不经过 `packages/ui`** 的消费者（AI/MCP、CLI、原生桥、小组件、写入侧校验）
   **默认都看得见归档清单**。这直接产生了 D11。

**分母与现量命令**（排除 `node_modules|/dist|bridge-bundle|*.spec.*|/tests/`）：

| 数 | 含义 | 命令要点 |
|---|---|---|
| **27** | 直接读原始桶的点数（`Object.values(state.tasks/notes/projects/…)`） | `grep -rnE "Object\.values\([a-zA-Z_.]*\b(tasks\|notes\|projects\|reminders\|habits\|focusSessions\|habitLogs)\)" apps packages` |
| **53** | 走 `alive*` 过滤入口的调用点数 | 同形，匹配 `listAlive\|aliveOf\|aliveTasks\|aliveNotes\|aliveProjects\|aliveReminders\|aliveRecords\|aliveOfTask` |
| 23 / 14 | `purgedAt` / `archived` 的非测试命中 | ⚠️ 两条命令的**排除口径不同**，不能横向比 |

**结构性结论（这句话是 ADR-0048 该收的第 7 条，比"每处记得滤"有用得多）：**

> 过滤**不能**下沉到 `getState()` / 仓库层（那会打断回收站、导出、还原核对、op 历史、
> 同步判据、写入侧判环这六类**合法需要读墓碑**的场景），
> 也**不该**只下沉进 `searchTasks` 这类**纯匹配器**（空查询早退那行会漏，且反查场景会失效）。
> 可执行的边界是：**"集合形态"的读路径必须从 `app-host` 的 `list*` 出口出来，
> 宿主不得直接从 `entities.X` / `Object.values(getState().X)` 取集合。**
> 按上面那 27 个点数，这就是 27 处待收编的债 —— 有分母、可逐条销账，
> 而不是"我检查过了"。

**本次枚举的已知盲区**（写下来，免得下一轮把这表当完整答案）：
`Object.entries` 与 `for…of` 形态不被那条正则抓到；解构别名（`const {tasks} = state.entities`）
会脱离 `entities.` 前缀；**按 id 直读**（`tasks[id]`、`state.projects[task.projectId]`）
完全在分母之外，是独立的一类；
"某文件里没有 `deletedAt` 字样"**不构成**泄漏证据（可能由被调方滤），
反过来"有该字样"也不构成安全证据（可能三个循环只滤了两个）。



---

## 五、"真删"与"保留清理"今天到底走到哪一步

### 5.1 客户端：永不物理删除

- op-log 只追加；每次启动 `engine.recover()` 从 `getOpsSince(0)` **全量重放**，
  物化状态只在内存（`state` 表在生产路径上**没有写入方**）。
  ⇒ 任何裸 SQL `DELETE` 要么删的是没人读的东西，要么让 op-log 与状态永久分叉、**下次启动复活**。
  这条是 [ui-review-fill-zh-timeline.md](../plans/ui-review-fill-zh-timeline.md) §719-728 写下的，
  也正是"判据只能落在视图三态上、落不到'库里 grep 不到'"的理由。
- 压缩原语 `archiveUpTo()` 有接口、有实现、有契约测试，**生产调用方零处**
  （`packages/storage/src/db-op-log-store.ts:341-367`；[ADR-0008](../adr/0008-vector-clock-limit.md):123
  白纸黑字："**也没有启用 `archiveUpTo()` 或删除任何历史**"）。
  ⚠️ **2026-10-03 状态更新（复核过，不是引用记忆）**：并行会话在工作树里新加了
  `ADR-0047-checkpointed-incremental-hydration.md`（文件内状态写"**已接受**"：
  `MaterializedCheckpoint` + checksum + 增量重放 + 损坏时完整回退，
  且"`archiveUpTo()` 在没有覆盖归档 cutoff 的有效 checkpoint 时拒绝执行"），
  `packages/storage/src/checkpoint.ts` 也已存在。
  🔴 但**这两份 ADR 与 checkpoint.ts 都还没入库** —— `git log -- <那两个路径>` 无输出，
  死链门禁把它们报成"本机有、仓库里没有"。
  所以本文这句"生产调用方零处"描述的是**已提交的仓库**；他们落地后会失效，
  **下一轮要重新现量，别把这句当长期事实引用**。
  另一处引用同样要带日期：[ADR-0046](../adr/0046-lossless-vector-clock-frontiers.md)
  （工作树，未入库）**取代 ADR-0008** 的时钟裁剪部分，但"没启用归档"那句不受它影响。
- 唯一真在清历史的是 `clearFullStateOpsExcept()`，但它只清**全量重建类 op**
  （`SYNC_IMPORT`/`BACKUP_IMPORT`），不碰普通 `TASK` 的 `DEL`/`UPD`。

### 5.2 服务端：45 天清理**今天对本仓账号是空转**

日常任务确实按 `retentionMs = 45 天` 跑（`server/src/sync/cleanup.ts:25-49`、
`sync.types.ts:557`），但被调方本体写明删除**由因果全量 op 授权**
（`server/src/sync/services/storage-quota.service.ts:417-446`）：

> `Deletion is authorized by the newest CAUSAL full-state op in the user's
> operation stream (SYNC_IMPORT / BACKUP_IMPORT / causal REPAIR)`

判据是 `CAUSAL_FULL_STATE_OPERATION_WHERE`（`sync.types.ts:27-32`）+ `serverSeq > 1` 的 `groupBy`。
heyta 客户端从不产生这类 op（§4.3）⇒ 账号不进候选集 ⇒ **`totalDeleted` 恒为 0**。

🔴 所以要更正一种说法：**"云端 45 天后墓碑密文会物理消失"目前不成立**。
真实情况是"**用户数据在整个系统里没有任何物理删除路径**，除了注销账号那条
（`prisma.user.delete`，19 处 FK 级联真删、无冷静期）"。

**逐环取证**（这条推论很强，所以每一环都单独验过）：

| 环 | 事实 | 证据 |
|---|---|---|
| 1 | 清理候选集**只**由"该用户名下是否存在因果全量 op"决定 | `server/src/sync/services/storage-quota.service.ts:417-446`：`groupBy` 的 `where` 是 `CAUSAL_FULL_STATE_OPERATION_WHERE` + `serverSeq: { gt: 1 }` |
| 2 | 该判据只认 `SYNC_IMPORT` / `BACKUP_IMPORT` / 带 `repairBaseServerSeq` 的 `REPAIR` | `server/src/sync/sync.types.ts:27-32` |
| 3 | **heyta 客户端不产生其中任何一类** —— 全仓 `packages/*/src`、`apps/*/src`、`scripts` 里 op 生产者只用 `OpType.Create/Update/Delete`；三个字符串在**任何客户端文件里 0 命中**（出现处全在 server 侧、`shared-schema` 的线协议契约、以及 vendored `sync-core` 类型里） | 按文件统计 `grep -rn "SYNC_IMPORT\|BACKUP_IMPORT\|REPAIR" packages apps server/src scripts`；`packages/domain/src/habit-resilience.ts:58` 那两处的 `REPAIR_WINDOW_DAYS` 是习惯补打卡窗口，**与 op 类型无关，不计入** |
| 4 | 也没有任何宿主会**生产**它：分类用的 `createFullStateOpTypeHelpers()` **零调用方** | `grep -rn fullStateOpTypes packages apps` → 只命中它自己的定义文件 |
| 5 | 客户端**不会回写快照**，只读服务端下发的快照时钟 | `packages/sync-client/src/client.ts:1392-1396`（`snapshotVectorClock` → `mergeRemoteClock`）；snapshot 上传端点存在但零消费者 |

⚠️ 这条本身也是**一个探针陷阱**：`cleanup.ts` 无条件打印 `removed N entries`（含 N=0），
所以日志会**每轮都显示这一趟跑了**，只有 N 一直是 0 才现出"它其实什么都没删"。
那个日志形状正是上游一次全车队保留失效（#9688）的原因，注释里写清了为什么"0 也要打"。
⇒ **反证方式**：这一条不能靠"日志里看到了 removed"来判活，只能靠"某一趟的 N > 0"或
"某用户名下确实存在 ≥2 个因果全量 op"。线上实测**尚未做**（§8 第 4 条）。

### 5.3 🔴 而我们**自己的隐私政策**正把它当成承诺在写

`packages/legal/src/documents/privacy.ts` 草案（2026-10-01 起草，`:590` 自陈
"**尚未经法务复核、尚未生效**"）里有两处：

> `:381`「🔴 **45 天**。这是代码里的固定常量，当前**不可由配置改**，配合**每日一次**的自动清理任务。」
> `:485`「应用内的删除在事件模型里是**追加一条删除事件**，不是抹掉记录。它从你的所有设备与界面上消失，
> 但服务器上承载它的加密历史记录**会在保留期（当前 45 天）届满后被清理掉**。」

对照 §5.2：**这句话对我们自己的账号不成立** —— 那条清理对本仓客户端写入的数据永远命中 0 条。
`AGENTS.md` 的前提是"heyta 还在开发阶段、不可能有用户"，所以现在改**不欠任何人**；
但这份文档一旦生效、或产品上架，它就是一句**可被监管核验且核验不过**的陈述。

🔴 三种处置，必须选一种（这是 §7 D8 的落点）：
① 让因果全量边界真的落地（G-1），使"45 天"成为事实；
② 把政策改成如实描述（"服务器保存加密历史，当前**不做**定期清理；注销账号才触发硬删除"）；
③ 政策先不写具体天数，改"合理期限 + 注销即硬删"。
**不可维持现状** —— `:422` 那句"一项可被验证的运维承诺，比一个绝对化的保证更靠得住"
写得很对，但一个**验证会失败**的承诺比绝对化的保证更糟。


### 5.4 加密擦除：结构上做不到，因为**密钥是账号级一把**

`deriveKeyFromPassword(password, salt)`（`packages/sync-core/src/encryption.ts:151`）派生**一把**
账号密钥，所有 op 共用。crypto-shredding（销毁某条记录的密钥 ⇒ 该记录密文永久不可解）
要求**逐记录/逐实体包一层密钥**，那是一次协议变更：新实体的 op 信封形状、老客户端如何读、
以及换口令时的重放（[ADR-0016](../adr/0016-undecryptable-ops-do-not-block-sync.md) §未做
已经留了"换口令后如何重放历史"这个洞）。

⇒ **"真删"的正确排期不是一行 `prisma.delete`，也不是 `purgedAt`，而是这两件之一：**
① 建立因果全量边界后，允许按 op id 向服务端定向删除（并要求所有设备已越过该边界）；
② 逐实体密钥封装。两者都不是回收站一轮能带走的。

---

## 六、"事实上的规格"清单（本次要抬成 ADR 的东西）

这 9 条今天**生效但无 ADR**，逐条给出处。方案的任何一步都不许违反它们；
要改哪条，就为新语义写 ADR，而不是让代码各自漂移。

1. **一切处置只能走 op-log**（`OpType.Delete` 或 `UPD`），UI 不许直接改状态 ——
   [phase-1 §D4](../plans/phase-1-single-client-loop.md)。
2. **删除 = `DEL` op → `deletedAt` 墓碑**；不用 `UPD` 写布尔删除位（理由见 §2.3 引用段）。
3. **还原 = `UPD { deletedAt: null }`**；已 purge 者拒绝；未删除者不发 op。
4. **彻底删除 = `UPD { purgedAt }`，永不清 `deletedAt`**（清了离线端会复活它）。
5. **墓碑保留实体全部原字段**（回收站靠它显示标题）—— 现状 `HEAD:state.ts:205`；
   ⚠️ 工作树正在改这条（§2.7）。
6. **归档必须是独立加性字段，不许借用 `deletedAt`**（[countdown §2.5](../plans/countdown-anniversary.md)）。
7. **"移出可见集合" ≠ "删除"**（[ADR-0019](../adr/0019-upload-rejection-does-not-block-download.md):149
   "移出队列与删除是两件事"）—— 这条是 §2.4 的形状来源。
8. **到期/降级绝不许动用户数据**（[subscription-boundary §2](../plans/subscription-boundary.md)：
   "删除用户数据当催收手段是勒索"）。🔴 **推论**：保留期**不许**做成付费档差异。
9. **判据只能落在视图三态**（列表 / 回收站 / 都看不到），落不到"库里查不到"
   （commit `b0fca047`；[ui-review-fill §719-743](../plans/ui-review-fill-zh-timeline.md)）。

### 6.3 同一件事的三种口径（必须先选一个）

| 口径 | 原文 | 位置 |
|---|---|---|
| 范围边界（中性） | "**只有 TASK**，不含 PROJECT / TAG" | `AGENTS.md:825`（§9 交付清单第 4 条） |
| 缺口（要做） | "P2-4 **回收站只覆盖任务**：清单/标签/习惯/便签软删后任何端都看不见、还原不了" | [multi-end-entry-coverage-audit.md:96](multi-end-entry-coverage-audit.md) |
| **不是遗漏**（强断言，已对外） | "清单、标签、便签目前不进回收站……**这不是遗漏：它们的删除语义和任务不一样。**" | `packages/i18n/src/locales/zh-CN.ts:3486`（帮助中心 `site.docs.trash.s1p1`，中英成对，受 `check:docs-voice` 执法） |

第三种是**唯一对客户承诺过的**。它此刻没有 ADR 与代码理由支撑 ——
`AGENTS.md` 那句只写范围没写理由，而 §7 的三条缺陷恰恰都是"删除语义不同"造成的后果。
**要么给它写出理由并落 ADR，要么改那句文案**；不许两边都挂着。

---

## 七、本次勘察查出的缺陷（逐条带证据）

| # | 缺陷 | 证据 | 严重度 |
|---|---|---|---|
| D1 | **软删除的任务，它的提醒照样弹**。投递处只挡"任务记录不存在"（`task === undefined`），而墓碑在 `entities.tasks` 里是**存在**的；领域层 `isReminderPending` 只看**提醒自己**的 `deletedAt`，不看所属任务 | `apps/web/src/features/reminders/notify.ts:136-139`（它上方的注释还写着"任务被删掉时……这种情况**不投**"——**注释与实现互相矛盾**）；`packages/domain/src/reminders.ts:131`；`use-reminder-notifications.ts:40` 传的就是含墓碑的全量 map。🔴 结构性修法在**出口层**：`packages/app-host/src/reminder-actions.ts:319-321` 的 `due()` 直接 `Object.values(state.reminders)` 时间过滤，**从不查所属任务**（同文件 `:324` 已有 `taskOf()` 可用） | 高（**仅 Web**，见 §八 第 1 条）：用户明明白白删掉了，手机还在响 |
| D2 | **删父任务不级联，但也没人管子任务去哪**。父墓碑留下后，读时把子任务**提到顶级显示**并记 `promotedFromDeletedParent`；从回收站还原父任务时，**没有任何逻辑把子任务带回来**（它们本来就没被删，只是"看起来换爹了"） | `packages/domain/src/subtasks.ts:166-172,181,212`；`entities.ts:119-121` 明写"删父任务时子任务怎样 —— 仓库现状没有任何逻辑" | 中：行为不算错，但**没人定义过**，回收站扩实体后会被放大 |
| D3 | **删清单不级联删任务**，于是"清单被删"和"清单里的任务"是两个独立事实；清单**没有回收站**，任务却还活着并显示成"无清单" | `project-actions.ts:20-22,67-68`；测试 `packages/app-host/tests/project-actions.spec.ts:163-164` | 中：与 §6.3 第三种口径直接冲突 |
| D4 | **`restoreNote` 实现了、零调用点**；便签删了在任何端都找不回来 | `packages/app-host/src/note-actions.ts:201-215`；[goal-layout-audit §8.2 第 8 条](../plans/goal-layout-audit.md) | 中：典型"基础设施做完了、最后一米没接"（13 个幻觉的共同形状） |
| D5 | **清单/标签的"删除"单击即生效、无确认、无找回** | [goal-layout-audit §8.2 第 7 条](../plans/goal-layout-audit.md):302；本次补实测：共享行组件 `packages/ui/src/projects/OrganizerList.tsx:271` 的垃圾桶 `Pressable` **直接调 `onRemove`**，`apps/web/src/features/projects/` 的 store 侧也无 confirm ⇒ 整条链路一次点击到底 | 中：[ADR-0029](../adr/0029-refuse-to-delete-last-passkey.md) 已经判过这类形态（"宁可拒绝，也不让用户把自己锁在门外"），不可逆动作无确认在本仓库不是可接受的产品形状 |
| D6 | `actions.ts:153` 注释指向 `op-log/src/state.ts` 的 **`toDelete`** —— 该符号**全仓不存在**（null→删字段现在是 `state.ts:336,364` 的内联逻辑） | `grep -rn toDelete packages/op-log/src` = 0 | 低：但它正是"回收站为什么能向前兼容"的机制解释，指错了地方 |
| D7 | `apps/web/src/styles/app/trash.css` 里 6 个列表类（`ht-trash__intro/__list/__item/__title/__time/__actions`）在 `TrashBoard` 收编后**零引用**，只有 dialog 系列还在用 | 逐一 grep | 低：死样式，会让下一个人把"回收站能这样调样式"当成现状能力 |
| D8 | 🔴 **隐私政策承诺的"45 天后清理"对本仓数据不成立**（政策说会清，代码判据决定它永远命中 0 条） | `packages/legal/src/documents/privacy.ts:381,485` ↔ 本文 §5.2 五环取证 | 高（当前缓解：该文档自陈**尚未生效**，`:590`）：这是一句可被监管核验且核验不过的陈述 |
| D9 | 🔴 **Web 搜索能搜出已删除、甚至已彻底删除的任务；移动端不会** | `packages/domain/src/search.ts:95` 的 `searchTasks` **本身不滤墓碑**（该文件 `deletedAt`/`listAlive` **0 命中**），全靠调用方递对的东西。Web 递的是原始物化表：`apps/web/src/App.tsx:1130` `searchTasks(Object.values(store.entities.tasks), q)`（`store.ts:388` 的 `selectTrashedTasks` 恰好证明这张表**含墓碑**）；移动端递的是 `actions.listTasks()`（`TasksScreen.tsx:524`，内部走 `listAlive`）⇒ **两端行为不同，Web 端泄漏** | 高：直接违背我们自己写出去的承诺 —— 帮助中心 `site.docs.trash.s3p3` 说"彻底删除"的准确含义是「**从我能看见的所有地方移除**」。🟢 外部旁证：微软官方把"回收站未编制索引，因此搜索中找不到内容"当作**产品性质**来写（§3.2 A） |

| D10 | **专注中的任务被删掉后，小组件还会显示它的标题并继续倒计时**。数据入口递的是原始桶（含墓碑），而专注标题那一行是**按 id 直读、不滤** | `apps/web/src/pwa/publish.ts:117-119` 与 `apps/mobile/src/widgets/publish.ts:78-80` 递 `Object.values(state.tasks)`；`packages/widget-core/src/selectors.ts:243` `input.tasks.find(...)` 无 `deletedAt` 判据（同文件 `:189`/`:194` 对习惯与打卡**是**滤的 ⇒ 这是漏写，不是设计） | 中：两处机制我分别核实过；**"用户真能看到"仍是推断**，未跑真机/真组件取证 |
| D11 | 🔴 **归档清单对 AI / MCP / CLI / 写入侧全都"看得见且像是活的"**。同一个原因：全仓唯一的 `archived` 过滤住在**共享 UI 层** | 读路径 `packages/app-host/src/project-actions.ts:205-207` `listProjects()` = `aliveOf(...)`（只滤 `deletedAt`）⇒ `packages/local-api/src/server.ts:359-360` 的 `case 'list_projects'` 直接 `await host.listProjects()`，AI 上下文同一条路；CLI `apps/node-host/src/cli.ts:395` 打印 `archived ?? false` 但与正常清单**混列、无标记**；写入侧 `project-actions.ts:102-105 projectOf` 同样只滤 `deletedAt` ⇒ **归档清单仍可被改名/挂父级** | 中高（🔴 **第四轮定性**：**机制已成立、当前暴露面待定** —— 见 §2.5 的更正：今天唯一的写入口 `archiveProject` 没有组件调用点、导入刻意不落 `archived`，所以库里有没有 `archived=true` 的行**未取证**；W3 一给界面加按钮，这处**当天变成用户可见**）：症状将是"AI 说你有 6 个清单，界面上只有 3 个"。这是 §4.4 第 2 条（`archived` 只有一个过滤点、还在错的层）的直接后果 |
| D12 | 🔴 **一条"登记为已覆盖、却结构上不可能跑绿"的验收**：`scripts/verify-mobile-reminder-ring.sh` 要求 `dumpsys notification` 出现真通知、`force-stop` 后 `dumpsys alarm` 仍持有本包调度，而移动端**没有任何投递实现**（§八 第 1 条已结案，三层证据） | 脚本尾部两条 `ok/bad`（本轮读到）；`package.json:79` 有 `verify:mobile-reminder-ring` 入口；`scripts/check-journey-coverage.mjs:130` 把它列进移动端 `ENDPOINTS.scripts` 且注释写"提醒到点：OS 通知栏真出现"；**而那道门禁对登记项只做 `existsSync`（`:351`）** ⇒ 门禁绿与脚本必红可以同时成立。实现本身在 `BLOCKED.md` **B33** 已拍为"要产品负责人决定" | 中高：这是"判据存在 ≠ 判据能过"的活样本，也正是 `AGENTS.md` §7 元规则 2 说的"一条永远通过的判据比没有判据更糟"的**镜像形状**（永远**不**通过的判据被当成通过） |
| D13 | **壳级窄门面"能删不能找回"**：走 `native-bridge` 的端没有 `restore`/`purge`/`listTrashed`，`removeTask` 只发软删 | `packages/app-host/src/native-bridge.ts` 的导出全集 = `open :176` / `listTasks :204` / `listTaskEntities :248` / `addTask :257` / `setTaskDone :263` / `removeTask :273`（注释自己写"软删除（发 DEL op）"）/ `clientId :280` / `openOpLog :306` / `handleHostMessage :342` / `close :366`；Linux 壳 `apps/desktop-linux/src/main.c:36` 只带这份 bundle；mac 壳另有 app 模式（`HeytaMacApp.swift:472` 载 `heyta-local://app/index.html`）才碰得到回收站 | 中：影响面是"未来真起来的非 Web 壳"（Linux、鸿蒙）；今天有界面的两端不受影响。**两道门禁都看不见这件事**（§7.2） |
| D14 | 🔴 **同一条到点提醒会再弹一次**：投递后**没有任何一方把 `firedAt` 落库** | `ReminderActions.markReminderFired`（`reminder-actions.ts:98`，注释还专门写了"幂等…否则每次进前台都会推高 `updatedAt`，在两端制造假冲突"）**在生产代码里零调用点**（`git grep -l markReminderFired HEAD` 只命中 app-host 自己与它的测试）⇒ `dueReminders` 靠 `firedAt` 判"未投递"（`packages/domain/src/reminders.ts:130-131` + `:123` 的 `fired` 相位），而这个字段**永远没人写** ⇒ 唯一去重是 `useRef(new Set<string>())`（`apps/web/src/features/reminders/use-reminder-notifications.ts:48`）——**一次页面加载、一台设备**的内存 | 中高（**仅 Web**，因为移动端没有投递，见 §八 第 1 条）：症状是"刷新一下又弹一次""手机没弹、电脑弹过之后我这边又弹一遍"。🔴 它不是"顺便加个功能"，**接上 `markReminderFired` 就是这条的修复**，所以它与 D1 同刀（计划 W2） |

### 7.1 对账表的置信度说明（这一节不许删）

第二轮全量枚举（§4.4）报出 6 条候选泄漏，**其中 2 条被我否证或降级**。留在这里，
防止这张表被当成"已证清单"往下传：

| 候选 | 结论 | 复现 |
|---|---|---|
| 「`packages/domain/src/ai-feedback.ts` 不滤墓碑」 | ❌ **否证**。`:92` 紧挨着 `:91` 那个循环就有 `if (row.deletedAt !== undefined) continue;` | `grep -n deletedAt packages/domain/src/ai-feedback.ts` → **2 处**（报"0 处"的那条命令口径不对） |
| 「MCP `get_task` 泄漏」 | 🟡 **未证**。枚举报的是"没读到 `local-api-host` 里那一行守卫"，我也没补上 | 要判它得先读 `packages/app-host/src/local-api-host.ts` 的 `getTask` 实参链。**"未证"不许当"已漏"写进工单** |

📌 一般规律：**"某文件里 grep 不到某个字段"既不能证明泄漏、也不能证明安全** ——
安全可能由被调方实现，泄漏可能藏在"三个循环只滤了两个"里。
要判这类事只能用**比值**（循环数 ↔ 守卫数）并把比值列出来；
本次只有 `preferences.ts`（3↔3）与 `memory.ts`（2↔2）做到了这一步，其余按"未证"处理。

D1、D2/D3、**D8**、**D9** 是本报告里**较新**的发现 —— 此前仓内的 ADR、计划、调研记录与环境陷阱
都没有"已软删任务的提醒仍会弹"、"政策里的 45 天在 heyta 账号上是空转"、
"Web 搜索把墓碑搜出来"这三条。
（**故意不写"多少份文档里都没有"**：`AGENTS.md` §7 自己就记过"写过一次 83 条，六天后就漂了"。）

### 7.2 第四轮读代码读出的**门禁结构事实**（不是缺陷，是"谁能拦住什么"）

这一节单独列，是因为它决定了工单的判据该写在哪：把"某道门禁会抓到"当成保障，
而它**结构上**看不见这件事 —— 比没有门禁更贵（它会让人不去写自己的判据）。

| 门禁 | 它**实际**扫什么 | 所以它看不见什么 |
|---|---|---|
| `check:reachability` 判据 C | 正则 `\bcreateXxxActions\s*\(`（`:596-603`），扫 `apps/*/src` 的 **`.ts`**（`HOST_ROOT='apps'` + `HOST_REQUIRED_SUBDIR='src'`，`:313-316`）；`ACTION_FAMILIES` 每项只有 `{entity, family}`（`:304`） | **方法级**"写了没人接"（家族粒度）；**Swift / C# / C / ArkTS** 整个不在范围内 |
| `check:layering` | `EXTENSIONS = ['.ts','.tsx','.mts','.cts']`（`:68`）、只 `walk(APPS)`（`:250`）、**8 条禁止式**正则（`:71` 起） | 它拦"apps 里重新长出业务/接线"，**不要求**"每个宿主都转发某个 action" |
| `check:journey-coverage` | 对 `ENDPOINTS.scripts` 只做 `existsSync`（`:351`） | **脚本会不会红**（D12 就是它照不到的那一格） |

🔴 **同轮实测的存量**（P-8 / G-9 的依据）：按"方法级"现量一遍 ——
`packages/app-host/src` 里 `export interface *Actions` 共 **68 个方法**，
零 `.method(` 命中的是 **HEAD 9 条 / 活树 8 条**：
`NoteActions` 的 `updateNoteContent / setNoteProject / restoreNote / notesOf / highlightedNotes`、
`ReminderActions` 的 `rescheduleReminder / markReminderFired / undoDismissReminder / rescheduleForRepeat`。

🔴 **"零消费者"不是一种状态而是四种**，合成一锅就会把交接做错（本轮就在 9→8 那一步被咬了一次）：

| 定性 | 条目 | 依据 |
|---|---|---|
| **正在被别人接** | `updateNoteContent` | 工作树 `apps/web/src/features/notes/store.ts:86` 已经调它，**HEAD 那份没有**（该文件状态 ` M`、未提交）⇒ 数字变化是**别人的一刀**，不是探针坏了 |
| **本轮的活** | `restoreNote` | 计划 W1 |
| 🔴 **缺陷的根因** | `markReminderFired` | 全仓无人写 `firedAt`，而 `dueReminders` 靠它判"未投递"（`packages/domain/src/reminders.ts:130-131` + `:123`）⇒ 见 **D14**：同一条到点提醒刷新后/另一台设备上会**再弹一次** |
| ⛔ **多余的门面**（能力早已接） | `rescheduleForRepeat` | 生产走抽出来的 `rescheduleRemindersForRepeat`（`packages/app-host/src/actions.ts:439`，`site-and-parity-alignment.md:384` B2-3 记的正是这件事）⇒ 该**删掉这个方法**，**给它找调用点等于造第二条写路径**（违反 `AGENTS.md` §3.4） |
| 🔵 **各自独立的产品缺口** | `setNoteProject` / `notesOf` / `highlightedNotes` / `rescheduleReminder` / `undoDismissReminder` | 便签界面里 `projectId` 与 `pinnedToToday` **零命中**；提醒面板只有 snooze / dismiss（`apps/web/src/features/reminders/ReminderPanel.tsx:124-125,176-179`）⇒ 缺的是"归属清单 / 按清单与今日分组 / 改提醒时刻 / 撤销不再提醒"四个界面能力，**不是一刀** |

⚠️ **这条探针的口径要跟着传**（三件事，缺一件就会得出错结论）：
① 它只证"没有 `.method(` 形式的调用" —— 解构（`const { restoreNote } = actions`）与动态派发看不见；
② **能力可能由同包的另一个导出实现**（`rescheduleForRepeat` 那一格就是，`reminder-actions.ts:340-341` 的注释自己解释了这个形状）；
③ **活树与 HEAD 是两个读数**，必须各跑一遍（`git grep -l <方法名> HEAD -- apps packages/ui` 一遍、
对活树再一遍），只对活树跑 ⇒ 数字是别人在飞的瞬时读数，只对 HEAD 跑 ⇒ 会把别人已经做完的活列成待做。
⇒ 所以 P-8 的实底是：**建那条门禁第一天眼是 8–9 红，其中只有 1 条属于本轮、1 条该删、1 条是别的缺陷的修复。**
先前那句"九条全部只被自己的单测消费"**不准**（`rescheduleReminder` 在 `bridge-bundle/native-bridge.js` 里出现过，
那是生成物里的源码副本不是调用点；而 `updateNoteContent` 在活树里已有真调用点），留在原地供后来者认出这个形状。

---

## 八、我没证实的东西

按 [docs/README.md](../README.md) §四第 3 条，未核实项必须显式列出而不是写成结论：

1. ~~移动端提醒投递有没有同一个洞 —— **未取证**。本次只核到 Web（`notify.ts`）；
   `apps/mobile/src` 里没搜到读 `reminderActions.due()` 的投递点，但"没搜到"不等于"没有"。~~
   ✅ **2026-10-03 第四轮结案**（这次是**正面取证**，不再是"没搜到"）：移动端不是"有没有同一个洞"，
   而是**整条投递路径从未存在** —— 三层独立证据：
   ① `due()` 的消费者只有 `apps/web/src/features/reminders/store.ts:154`（+ app-host 自己的测试），移动端 **0**；
   ② 本包自己的 Kotlin 源（`apps/mobile/android/app/src/main/java/`，30 个文件）里
   `NotificationManager` / `NotificationCompat` / `reminder` **各 0 命中**；
   ③ `apps/mobile/package.json` **零**通知/后台调度依赖。
   ⇒ 由此**修正两条先前写下的话**：(a) D1 是 **web-only** 症状，本轮任何 e2e 判据只证得到 Web；
   (b) 我在对话里说过"那条验收脚本没有 pnpm 入口"——**错了**，`package.json:79` 有
   `verify:mobile-reminder-ring`，而且它已被登记成"已覆盖"（**D12**）。
   原句留在划线处：按本报告自己的纪律，**"没有 X"这类断言旁边必须写核对日期与取证行号**。
2. `apps/web/tests/trash.spec.tsx` 现在到底几条红 —— 子代理实测 1 failed / 7 passed，
   **本次未复跑**（当时负载 11、12 个测试进程，按 §6 串行约定不抢跑）。
3. 回收站在**真实数据量**下的表现 —— 未测。`listTrashed` 是全量内存过滤 + 排序，
   无分页；"回收站里 5000 条"没有任何实测。
4. 服务端保留清理在**线上那台**是否真在跑（`OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN` 的实际取值、
   日志里 `removed N` 的 N）—— 未取证。§5.2 说的是代码判据推论，不是线上读数。
5. `dida365` 导入里 `status=2 → 已完成` 这个近似丢了多少真实数据 —— 未取证。
   代码自己标了"含义**未核实**"（`packages/ticktick-format.ts:223-225`）。
