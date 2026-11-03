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

| 项 | 状态（2026-11-02 收本轮时） |
|---|---|
| 半屏原语（默认 medium / 记档 / 头部拖拽 / × 死按钮表级修复） | ✅ |
| 置顶 + 放弃（字段、op、actions、动作层分裂出口、领域层 `visibleTasks` 收口） | ✅ |
| 详情面板重排（内容层 + 折叠层 + 头部三件套 + 顺延 + 常驻动作条） | ✅ 内容层改渲染共享 `<TaskRow>`；`check:row-single-source` 断言 A 已绿（「扫到 1 棵 / 999 文件」）。🔴 **第一步要的"大字档"是 2026-11-03 才真正交付的**：共享组件加了 `detail` 档（标题走 `detail-title` = `font-size.xl`），见 §5.12 |
| 移动端行操作（长按菜单 + 左滑） | ✅ 代码与判据绿；`mobile.tasks.gestureHint` 已改口（原来还在教"长按=多选"） |
| 任务动态读路径（domain 投影 15 条 + app-host 适配层 5 条） | ✅ 类型与构建 rc=0。**已接到界面**（详情面板折叠层新增 `activity` 一格，见 §5.6） |
| 三枚旧弹层迁移 | 🟡 1/3 已迁（`ConflictSheet`）。G1（拖拽区表）/ **G2（具名文字出口）/ G4（把手文案可选）本轮已闭合**（见 §5.10）。剩两枚的阻塞**不是** G2/G4，而是 `OverlayModalClass` 里**没有 `modal-deferrable` 那一格** —— 逐个试过的替代都是一次行为回归，理由逐条写在 `PrivacyConsentSheet.tsx` 文件头。⇒ 保留自绘外壳，判错类别比不迁更糟 |
| 子任务就地新建 + 标签就地新建 | ✅ 2026-11-03：一条 op 的 `createSubtask`（见 §5.7）；标签复用 `mobile.tags.add` 就地建并点亮 |
| 已放弃出口 | ✅ 移动端：`AbandonedScreen` + 「我的」页入口（ADR-0083 §4.3）。🔴 **Web 端还没有**——web 现在既不能放弃也不能查看，所以不构成只进不出，但这是一处两端不一致（见 §5.8） |
| 附件 | 🟡 **共享层 / 服务端 / 移动端界面这一整段已落地**（实体 + 物化 + 写路径 + blob 通道 + 迁移 SQL + 门禁登记，读数在 §5.9）。⚠️ 迁移**没应用到任何库**（本机 5432 上没有这套 schema 的角色）；Android 那枚原生读字节方法**已远程编译通过**（`compileDebugKotlin` BUILD SUCCESSFUL，远端源 md5 与本机逐字相同；仍未装机、未跑真实上传，见 §5.9 尾巴 2）；**"点开/预览"没做**（这条通道上刻意没有 GET）；web/桌面没有附件入口。剩下的尾巴逐条列在 §5.9 |
| 真机验收 | ✅ 第二轮（当前产物）跑通并逐张真看：任务页 / 详情面板顶部 / **附件那一格** / 长按行菜单 / 左滑删除 / 折叠层「任务动态, 1 条变更」—— 读数与图在 **§6.5**。⚠️ 第一轮记的三张"看图"证据事后查明是 `simctl` 的**黑帧**（同一结论另有真图与无障碍树撑着，更正写在 §6.4 那段红字里）。仍未验：真实上传（iOS 无读通道 / Android 未编译）、跨设备同步 L5 |

| # | 项 | 档 | 状态 | 落点 / 读数 |
|---|---|---|---|---|
| 1 | 置顶 `Task.pinnedAt` + op + actions + 排序 | C | ✅ | `packages/domain/src/entities.ts`（`pinnedAt` + `byPinnedFirst`）、`packages/app-host/src/actions.ts`（`setPinned`）；11 条用例绿，变异验证过能红 |
| 2 | 放弃 `Task.abandonedAt` + 动作层 list 分裂（I5） | C | ✅ | 字段 + `isAbandoned` + `setAbandoned` + `listTasks()`/`listAbandonedTasks()` 分裂出口；领域层新增 `visibleTasks()`，五条显示路径（`filterTasks`/`sectionTasks`/`groupTasksByDate`/`scopeTasks`/`searchTasks`）与 `bucketByQuadrant` 全部改走它。13 条新判据绿。🔴 **剩两处"喂什么画什么"的下游未收敛**（见 §5.1） |
| 3 | 任务动态：op-log → 变更流水读路径 | C | ✅ | domain 纯投影 + app-host 读 `engine.getOpsForEntity`，**已接到界面**（折叠层 `activity` 一格，§5.6）。覆盖范围如实暴露：只有快照+增量的新设备不假装完整历史 |
| 4 | `BottomSheet` 默认 medium + 档位记忆 + 头部拖拽 | A | ✅ | `sheet-detents.ts`（`DEFAULT_SHEET_DETENT` + `resolveDetentSeed` 三级优先）、`sheet-drag.ts`（新，`body`/`closeButton` 刻意不在表内）、`BottomSheet.tsx` 接线 + 迟到的记忆"只采纳不回写"；26 条判据绿、`check:overlay` 账本无新增 |
| 5 | 移动端行操作：长按菜单 + 左滑 | A | ✅ | 代码与判据绿；旧默认档那条断言已被推翻（`overlay-sheet-detents.spec.ts` 里写着为什么）。真机读数见 §6.4 |
| 6 | 其余三枚 Sheet 迁到共享原语 | A | 🟡 1/3；G1/G2/G4 三条原语缺口已闭合，剩下的阻塞是 `OverlayModalClass` 缺 `modal-deferrable` 那一格（理由与逐条否证在 §5.10 与 `PrivacyConsentSheet.tsx` 文件头） |
| 7 | 详情面板重排（内容层 + 折叠层 + 头部三件套） | A | ✅ | 内容层改渲染共享 `<TaskRow>`；完成/删除在**常驻动作条**上（满足 ux-principles 那条「动作区常驻」）。走通后 `check:row-single-source` 断言 A 绿 |
| 8 | 逾期状态行 + 接 `postponeToToday` | A | ✅ | 详情面板的日期状态行接上顺延（此前 `actions.ts` 有这个动作、移动端零调用点） |
| 9 | 就地添加子任务 + 子任务列表/勾选/计数 | B | ✅ | 一条 op 的 `createSubtask`（§5.7），列表/勾选/计数走 `buildTaskTree` |
| 10 | 标签就地新建 | B | ✅ | 复用 `mobile.tags.add`，建完点亮 |
| 11 | 置顶/放弃/动态 接线到界面（含"已放弃"出口） | C | ✅ 移动端 | 宿主只调 `listAbandonedTasks()`，没有自己 filter。🔴 **Web 端还没有出口**（§5.8） |
| 12 | 附件：实体物化 + blob 通道 + 界面 | C | 🟡 | 共享层 / 服务端 / 移动端界面已落（§5.9）；三条尾巴未做：迁移没应用到任何库、Android 原生读方法没编译、iOS 没有读字节通道 |
| 13 | 单条任务分享（发送到共享清单） | C | ⏳ | 依赖 #7；公开链接**不在本轮**（ADR-0083 §3.3） |
| 14 | 门禁与验收串行跑 | — | 🔄 | 七把本线门禁 + 四个包整套 + 五把迁移/物化侧门禁的现量读数在 **§5.11**；真机腿见 §6.4 |

## 3.1 两条不属于本轮的红（现量，会过期）

| 红 | 归因 | 依据 |
|---|---|---|
| `packages/domain/tests/habit-backfill.spec.ts` B8 | 🔴 **门禁自身的缺陷**，不是产品缺陷 | 报的是 `ENOENT .../apps/mobile/ios/Pods/Headers/.../RCTAppDependencyProvider.h` —— 它的源码扫描 `walk()` 会遍历到 iOS 原生构建目录，任何人跑一次 `pod install` 它就红 |
| `packages/domain/tests/lunar.spec.ts` 逐日往返；`packages/app-host/tests/share-key-store.spec.ts` 信封往返 | 负载下的不确定性超时 | 同一命令两次跑出 **1 红**与 **4 红**，且两次都是 `Test timed out in 5000ms`；被测对象（农历换算 / 共享密钥信封）与本轮改的 Task 态无交集 |

⚠️ **上面那行 ENOENT 是当时的读数，今天不是这个形状**：2026-11-03 整套重跑时
`habit-backfill.spec.ts` B8 与 `lunar.spec.ts` 报的都是 `Test timed out in 25000ms`，
单独抬超时重跑 ⇒ 53/53 绿（读数与方法在 §5.11）。
⇒ 今天这两条红的定性是**负载超时**，别再拿 ENOENT 解释它们。
但那行 ENOENT **既没被复现也没被否证**（它要的是 `walk()` 遍历到 iOS 原生构建目录
这件事本身，今天这一次没撞上），所以留着不删 —— 撞上它是概率事件，取决于那棵树当时在不在动。

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

---

## 5. 剩余漏网与本轮顺手修掉的东西

### 5.1 🔴 还没收敛的两处下游（I5 的债，不是新功能）

这两处的**契约本身就写着"喂什么画什么"**，所以修法不是在里面加过滤（那会改掉
写明的语义），而是要先确认每一个调用方喂的是哪个出口：

| 位置 | 现状 | 为什么不能盲改 |
|---|---|---|
| `packages/ui/src/calendar/model.ts:710` `groupTasksByDueDate` | 不滤 | 共享板子，四端都喂；加了过滤等于把产品判断搬进 UI 层（违反 §3.5） |
| `packages/ui/src/task-list/model.ts:98` `toTaskRows` | 不滤 | 同上，且它的注释明写"比较规则只允许在 `@heyta/domain` 一份" |

⚠️ 这两处是**存量债**（今天之前它们也不滤 `deletedAt`），本轮没有让它们更糟：
所有走动作层出口与领域层过滤族的路径现在都滤了。收口它需要先做一次调用方审计。

### 5.2 本轮顺手修掉的两个真缺陷（都与对标无关，撞见就修了）

1. `packages/domain/src/quadrant.ts` 里有一行 `if (task.deletedAt !== undefined) continue;`
   —— 那是 `isLive` 文件头点名的"散在六处各写一遍"里的**第七份字面量**。已换成
   `!isLive(task) || isAbandoned(task)`。
2. `packages/domain/tests/habit-backfill.spec.ts` 的 B8 门禁**单独跑绿、整套跑红**。
   两层原因叠在一起，都修了：
   - 跳过集在 `statSync` **之后**才判，所以它对会抛异常的路径根本不生效；
   - 它爬的是**一棵正在被别的进程改动的树**（并行构建、`dist/`、iOS `Pods` 软链农场），
     条目在 `readdirSync` 与 `lstat` 之间消失就抛 `ENOENT`。
   判据的射程没变（产品源码不是软链、消失的条目必然不是源码），但它不再会因为
   隔壁在跑构建而红。**这类"谁都没改判据，判据自己红了"的门禁会被所有人忽略掉**，
   那才是它真正的代价。

### 5.3 🔴 源码扫描型门禁不能与并发写入同跑（本轮实测）

三条红在**单跑时全绿、整套跑时才红**：

| 门禁 | 症状 | 现量依据 |
|---|---|---|
| `packages/ui/tests/task-row-priority.spec.ts` W5「全仓只有一份 `priorityColorToken` 定义」 | 整套跑红，单跑绿 | 单跑后现量：全仓**只有** `packages/ui/src/task-list/priority-color.ts:66` 一处定义 |
| `packages/domain/tests/habit-backfill.spec.ts` B8 | 同上（已修，见 §5.2） | 修的是"跳过集在 `statSync` 之后才判" + "条目在 `readdir` 与 `lstat` 之间消失" |
| `packages/ui/tests/habit-artwork.spec.ts` | 整套跑红，单跑绿 | 生成资源 `habit-artwork.generated.json` 在场（204,502 B） |

**共同形状**：这类判据是"扫一遍全仓源码数定义处"，而它扫的是**一棵正被别的进程改动的树**——
并行作业把中间态文件写进去的那一瞬间，扫描就会看见重复定义 / 半截文件 / 刚消失的条目。

⇒ 对交付的含义（这条是本节的全部目的）：**S4 的整套门禁必须在所有并行作业落地之后串行跑**。
作业在飞时拿到的"全仓扫描型"红**不可归因**：既不能当回归修，也不能当噪声忽略——
唯一正确的动作是等写的人停手再量一次。

---

## 5.4 「任务动态」的前提已经量过（别再重做这次调查）

上一版接这活的作业到死都没答这个问题，现量结论：

**同步下行的 op 会进本地 op-log。** 依据是
`packages/op-log/src/engine.ts:597` 的 `applyRemoteLocked` —— 它的第一步就是
`store.appendBatchSkipDuplicates(ops, 'remote', { pendingApply: true })`（`:610-613`），
落盘之后才应用。所以 `getOpsForEntity('TASK', id)` 拿到的**包含别的设备写的 op**，
"任务动态"不是只能显示本机历史。

⚠️ 但有一个诚实的边界要写进界面与 API：一台**新设备**是先拿快照再增量同步的，
它的本地日志可能不含全部历史 op。所以这一格能说的是"这台设备记录到的变更流水"，
**不许**说成"这条任务的完整历史"。要做成完整历史需要服务端按实体提供历史端点，
而现量服务端没有那样的端点（只有 `(userId, entityType, entityId, serverSeq)` 的索引）。

另外两条写的时候要用到的事实：
- reducer 内部本就保留字段级版本历史（`packages/op-log/src/state.ts:160-198` 的
  `ENTITY_VERSIONS` / `FIELD_VERSIONS`），这是"旧值→新值"的现成来源，不必自己 diff。
- 一条 op 可以覆盖多实体（`entityIds` / BATCH，`hasTaskBatchMarker`），
  投影**必须按 entityId 切**，不能把整条 op 的载荷算给这一条任务。
  ⚠️ 且 `packages/local-api/src/tools/shared.ts:556-566` 明令批量落多条 op 而非一条，
  两种形状都要能遇到。

---

## 5.5 🔴 本轮验证方法上的三个洞（每个都曾给出**假绿**）

| 洞 | 症状 | 正确做法 |
|---|---|---|
| **`pnpm check \| tail -60` 把退出码换成了 `tail` 的** | 第一次跑完整链，工具报 **exit 0**，而实际 `pnpm check` 在 `packages/app-host build` 就 **Exit status 1** 了。差点据此报"门禁全绿" | 要么 `set -o pipefail`，要么 `pnpm check > 日志 2>&1; echo $?`。**管道尾巴的 rc 不是命令的 rc** |
| **vitest 不做类型检查** | `packages/app-host` 2120 条测试全绿，而同一个包里 `byPinnedFirst(byCreatedAtOrder)` 是**类型方差错误**，只有 DTS 构建才照得出来 | 测试绿 ≠ 类型过。跨包加 API 后必须单独量 `tsc -p tsconfig.spec.json` 或跑 build |
| **包入口指向 `dist/`，改 `src` 不重建依赖方看不见** | 三次误判：`isAbandoned` 运行时 undefined（以为撞名）、21 个 i18n 键"不存在"（以为没写进去）、`RowActionMenu` 无导出（以为漏写）—— 三个都是同一个原因 | 改 `packages/{domain,ui,i18n}/src` 后先 `pnpm --filter <包> build` 再验依赖方 |

⚠️ 三条的共同形状：**判据没坏，是"读判据的那只手"错了**。一条被管道吃掉退出码的命令、
一个不查类型的测试运行器、一份陈旧的构建产物，都会把红报成绿。
本轮实际交付前必须按这张表重跑一次，不能沿用中途任何一次"绿"。

---

## 6. 🔴 待拍板：详情面板的"内容层"与「行骨架只有一份」冲突

`pnpm check` 现在唯一因本单而红的门是 `check:row-single-source` 断言 A：

```
🔴 任务行有 1 处手写副本（应当只有 packages/ui 一份）：
   apps/mobile/src/screens/TaskDetailSheet.tsx:675
      这里渲染了一棵 <BottomSheet>，同时含勾选框 + 标题槽 + 截止槽。
      ⚠️ 这道红是**正确**的：M3 的主体工作就是把这些副本收编。不要为了变绿放宽判据。
```

**冲突的两条规则**：本单 §1.3 要的内容层是滴答那种"勾选框 + 大字标题 + 日期状态行"，
而这一族判据要求"勾选框 + 标题 + 截止"这个骨架全仓只有一份实现。
面板已经复用了共享 `<Checkbox>`，但**排版是自己排的**，于是被判成第二份行实现。

**判据怎么切的（这决定解法，别再靠猜）**：`findTaskRows` 扫 JSX 树，取**同时含三种信号的最内层子树**
（`scripts/check-row-single-source.mjs:203-223`）。它报的是 `<BottomSheet>` 本身，
说明三样信号分散在兄弟节点、只有共同祖先同时含三者 ⇒ **只搬走勾选框没有用**。

**我先后给过的两个方案都被实测否证了**（记在这里，别第三次提）：

| 方案 | 否证依据 |
|---|---|
| 给 `TaskRow` 加一档 `detail` density 拿大字标题 | `packages/ui/src/task-list/density.ts:32` 的"不允许"列明文写着：density 只管空间与插槽显隐，**改文字样式语义不行（"标题永远是 `row-title`"）** |
| 让面板直接渲染共享 `TaskRow` | `TaskRow` 的标题是只读的、没有 tap-to-edit；硬套会丢掉"能改标题/备注"，而那是对标文档自己列的 **P0-4** |

### 6.1 🔴 实测推翻了我自己第一步的方案（记下来，别再走一遍）

按"先抽共享 `TaskCheckbox`、再抽共享详情头部"做了第一步，结果 **`check:row-single-source`
从"发现重复"变成了"锚点自检失败"**：

```
🔴 packages/ui 里扫不出任何一棵"复选框 + 标题 + 截止"的 JSX 子树。
   ⇒ 这不是"没有违规"，是**这道检查已经不能做事了**
```

成因：该门禁的锚点自检要求**唯一实现存在于 `packages/ui` 的某一棵子树里**
（`findTaskRows` 取"同时含三种信号的最内层子树"）。把勾选框拆成独立文件之后，
`TaskRow.tsx` 只剩标题与截止，控件在另一个文件 —— **没有任何一棵子树同时含三者**，
于是锚点断掉。同时 `task-row-priority.spec.ts` 有两条钉的是
"`box` / `boxDone` 在 `TaskRow` 源码里的先后顺序"，也一起红。

⇒ **抽取控件不是第二步的前置，是我多加的一步。** 共享的详情头部完全可以自己含一棵
"勾选框 + 标题 + 截止"的子树放在 `packages/ui` 里：那样锚点仍然找得到 `TaskRow`
（`sharedRowCount` 只要求 ≥1），面板也不再含三种信号。
本轮已把抽取**完整退回**并验证：`@heyta/ui` build rc=0、`task-row-priority.spec.ts` 11/11 绿。

⚠️ 顺带一条未定性的 flaky：退回过程中 `priorityColorToken 只出现一次` 那条**在刚跑完
`pnpm build` 的那一次红**，之后连跑三次全绿，且全仓现量只有一份定义
（`packages/ui/src/task-list/priority-color.ts:66`）。
怀疑方向是扫描器把 `dist/index.d.ts` 里的 `declare function priorityColorToken` 当成了
第二份定义，但**没有证实**（`sourceFiles` 的实现还没读到）。
一条"偶尔把自己包的产物数成第二份定义"的单来源判据，会被所有人当噪声忽略 —— 这比它红更贵。

现量：`TaskRow`（`packages/ui`）的勾选框是**内联画的** —— `accessibilityRole="checkbox"`
+ 自己的 `checkboxHit` 样式（`TaskRow.tsx:205-215, 350-361`）；
而 `apps/mobile/src/ui/kit.tsx` 里另有一枚 `Checkbox`，详情面板用的是它。
判据的两个匹配式（`accessibilityRole="checkbox"` 与 `<Checkbox\b`）**正好各抓一种** ——
也就是说**勾选框控件在本仓已经是两份**，这个存量重复与本次改动无关，但它是解法的一部分。

1. **先收控件**：在 `packages/ui` 落一枚共享 `TaskCheckbox`，让 `TaskRow` 的内联那份
   与移动端 kit 的 `Checkbox` 都改为消费它。这一步单独就有价值（消掉一份存量重复），
   而且是第二步的前提 —— 否则共享头部要么用 kit 的（`apps/*` 的东西，共享层不能反向依赖），
   要么再画第三份。
2. **再收排版**：把详情面板的内容层（勾选框 + 截止状态行 + 可编辑标题 + 可编辑备注
   + 截止编辑器插槽）搬成 `packages/ui/src/task-list/TaskDetailHeader.tsx`。
   分工照 `TaskRow` 现有的样子：**宿主注入内容，共享层持有排版** ——
   截止读数由宿主算（`toDueDisplay` 在 `apps/mobile/src/lib/due-display.ts`，
   web 有自己那份，共享层不接管日期语义），`DatePicker` 走 children/插槽。

### 6.3 ✅ 那条未定性的红，已定性为**环境**（2026-11-03 现量）

`apps/mobile/tests/legal-recheck-mobile.spec.ts` 2 条：同一个
`GET /api/account/legal-consent` **发了两次**，判据要恰好一次。

**定性结论：不是产品缺陷，也不是本单造成的 —— 是冷 import 撞穿该文件自带的 5 秒默认超时。**

现量读数（同一台机器、同一份工作树、未动任何文件）：

| 跑法 | 结果 |
|---|---|
| 单跑，默认超时 | 2 failed / 27 passed；第 1 枚 `Test timed out in 5000ms`，耗时 **5143ms** |
| 单跑 `--testTimeout=30000` | **29/29 绿**，第 1 枚耗时 **7307ms** |
| 跑的时候 `uptime` | load average **73.80 / 63.00 / 59.58** |

因果链（读源码得出的，不是猜的）：该 spec 每个用例都 `vi.resetModules()` + 动态
import 六份模块（文件头写明原因：`consentFetch` 在**模块求值期**绑死 `globalThis.fetch`）。
第 1 枚用例是**本 worker 第一次**求值这张图 ⇒ 付全部 transform 代价。它在 5 秒处被判超时，
但 vitest **不会取消已在跑的异步函数** —— 它继续跑完 `load()`，再调 `askLegalRecheck()`，
而此时 `net.sent` 已被第 2 枚用例的 `load()` 清空、配置模块已被第 2 枚写入 `TK-1`。
⇒ 第 2 枚看到的"两次 GET"里，一次是它自己的，一次是第 1 枚的后台余波。
**两条失败同一个因**，且第 2 枚不是独立缺陷。

归属：该 spec 自 `ab0956a9f`（2026-10-03）起未再改动，工作树**干净**，
本单没碰过 `apps/mobile/src/legal-recheck`；`packages/app-host` 那三处改动
（`setPinned`/`setAbandoned`/list 分裂、`readTaskActivity`、新 `task-activity.ts`）
不在这个 fetch 路径上 —— 现在有了"放宽超时就全绿"这条反证，不必再做干净检出 bisect。

⚠️ **本单不改它**：它不是本单的对象，且真正的修法有两条口径（给这张图的第一枚用例
单独抬超时 / 让 `load()` 不复用进程级 `net.sent`），改哪条属于该线。已登记。



把三条规则摆在一起，可行解只剩一个：

| 规则 | 它禁掉了什么 |
|---|---|
| `check:row-single-source` 锚点自检 | `packages/ui` 里必须**至少有一棵**同时含"勾选框+标题+截止"的子树 ⇒ 不能把勾选框再拆成独立文件（拆了就没有任何一棵含三者），也不能让宿主自己含三者 |
| `density.ts:32` | density 不许改排印 ⇒ 详情面板拿不到"大字标题" |
| `ux-principles.md` §8（判据总表与欠账里那条实测记录） | **表单字段的渲染器归各端 kit** ⇒ 不能在 `packages/ui` 里造可编辑标题/备注的输入框（那里删过一个 `form/Field.tsx`，理由原文是"那不是共享，是第三份实现"） |

**唯一同时满足三者的设计**：详情面板的**内容层直接渲染共享 `<TaskRow>`**，编辑态留在宿主。

```
<TaskRow
  row={detailRow}                    // 宿主用共享 model 造，不在这里重画行骨架
  onToggleTask={…setCompleted…}      // 勾选框 = 完成/取消完成
  onOpenTask={() => setEditingTitle(true)}   // 面板语境里"点行"= 进标题编辑
  renderMeta={() => dueStatusLine}   // 截止读数 + 已逾期 N 天 + 顺延 + 展开箭头
  labels={taskRowLabels}
  busy={busy}
/>
{editingTitle ? <kit.TextField …/> : null}   // 编辑归 kit（§8.1）
{dueOpen ? <DatePicker …/> : null}
{editingNote ? <kit.TextField …/> : null}
```

为什么这样判据就绿：`<TaskRow>` 是组件标签，**不匹配** `<Checkbox\b`，面板里也没有
`accessibilityRole="checkbox"` ⇒ 宿主侧最多只剩"标题槽 + 截止槽"两种信号，
而判据要三种同时出现才算一份行实现。这不是绕：勾选框确实回到了唯一那份实现里。

⚠️ 两条已知代价，都要如实写进交付说明：
1. ~~**标题字号退回 `row-title`**，拿不到对标产品的大字正文（`density.ts:32` 明文）。
   要拿到它必须有人推翻那条规则 —— 那是产品决定，不是本轮的工程决定。~~
   ✅ **这一条已作废（2026-11-03）**：工单第一步就是那个授权，
   `detail` 档 + `detail-title`(20px) 已落地，见 **§5.12**。
2. `onOpenTask` 在面板里的语义是"进编辑"而不是"打开详情"。它本来就是宿主给的回调，
   组件不认识"算哪件事"（见 `TaskRow.tsx:106-113` 同一条分工），所以不违规；
   但**无障碍名要说清楚**（`labels.open` 在面板语境下应给"编辑标题"那句）。

实现前要先量的两件事（避免又走弯路）：
- `toTaskRow` 的真实签名与它需要哪些注入（宿主 `TasksScreen.tsx` 已在用，照它抄）；
- `apps/mobile/tests/task-detail-layout.spec.ts` 与 `verify-mobile-task-edit.sh`
  钉的是 `task-detail-title-text` / `task-detail-checkbox` 这些 testID ——
  换成 `<TaskRow>` 后命中区 id 会变成 `task-toggle-<id>`，**要么给 TaskRow 传宿主
  testID（若它支持），要么同步改钉**（本仓纪律：被判对象合法消失才算改钉，见
  row-actions-redesign §9.3）。

### 6.1 另一条红不属于本单

`check:locator-labels` 通篇只点 `scripts/qa/*.py`（本单零改动），
且它点名的键（`mobile.auth.*`、`mobile.settings.section.*`、`mobile.tasks.a11y.delete` 等）
**全是既有键，本单新增的 21 个键一个都没出现**。判为存量/别线，未动。

🔴 **2026-11-03 把这句判断换成了一条可推的论证**（原来那句只是"看着不是我的"）：
逐枚 `git show HEAD:packages/i18n/src/locales/zh-CN.ts | grep -c '<key>'` 点过 ——
它红话里点名的键**在 HEAD 就已存在**，`scripts/qa/**` 本单一行没碰。
再加一条**单调性**：这把尺的判据是"这句中文只挂在**移动端从不读**的键上"，
而本单只会让移动端**多读**键（新增 `mobile.detail.attachments.*` 等），
"从不读"那个集合因此**只减不增** ⇒ 今天的红集 ⊆ HEAD 的红集。
**HEAD 上它必然同样红**，不需要跑一次干净检出 bisect 来证明。

### 6.2 本单已修掉的三条门禁级问题

| 红 | 定性 | 处理 |
|---|---|---|
| `check:ui-language` 2 处 | **假阳性**：`t(done ? 'A' : 'B', {title})` 被把两个**键**当成硬编码字面量 | 没动那枚门禁（它在别线名下是脏的），改调用点为两个完整 `t()` 调用 ⇒ 绿 |
| `check:selection-single-source` 断言 G | **合法**：行菜单新增的 `rowMenuId` 是未登记的行 id 瞬态 | 按门禁自己指的正解登记为 `confirm-gate`，理由逐字写进表里（两步、单所有者、互斥；"当前看的是哪一条"已经是 `useSelected('task')`）⇒ 绿 |
| `packages/app-host` DTS 构建 | **本单的代码缺陷**：`byPinnedFirst(byCreatedAtOrder)` 泛型方差错误 | 三处调用点显式 `byPinnedFirst<Task>(...)` ⇒ 绿。⚠️ 它是被 DTS 构建照出来的，不是被 2120 条测试 —— 见 §5.5 |

---

## 5.6 任务动态接到界面（2026-11-03）

详情面板折叠层多一格 `activity`（`SECTION_IDS` 与 `task-detail-layout.spec.ts` 的 `FOLDED`
同步登记，计数判据仍绿）。三条判断都不在界面里：

- **「事件 → 人话」只有一份**：`packages/ui/src/task-list/activity-model.ts`。
  它**不依赖** `@heyta/i18n`（与 `auth/model.ts`、`subtasks/model.ts` 同形），
  导出的是字面量 key 的联合，宿主拿 key 去 `t()`。
  映射表是 `Record<TaskActivityField, …>` 穷尽领域层那个封闭联合 ⇒
  往联合里加字段而忘了接词条是**编译错误**，不会静默念成"其他字段"。
- **`repeatRule` + `repeatDtstart` 念成一句「重复」**：两个字段、一个 key，
  所以导出的是**按 key 去重**的集合。不这么做，设一次重复会念出「重复 · 重复」。
- **覆盖范围那句必须说出来**：`complete` 返回 `undefined`（完整历史时不多嘴），
  另两档各有一句。**读失败与没有记录是两句不同的话** ——
  把一次故障念成"这条任务没被改过"是不实陈述（`mobile.detail.activity.unavailable`）。

数据源是 `host.engine`（本机 op-log；`TaskActivityOpSource` 这个形状
`OpLogEngine` 直接满足，不需要适配器）。**没展开那一格就不查** ——
否则"看详情"变成"查历史"。`activitySource === null` 时**整格不出现**。

`includeValues: false`：这一格只说"改了哪个字段"。要显示新旧值，
得先有逐字段的格式化（日期 / 优先级名 / 清单名），那是另一刀。

## 5.7 子任务就地新建：一条 op，不是两条（与工单原方案的偏差）

工单原文写的是「`createTask` + `setParent` 两个 op」。实现时改成了
**一条 CREATE 载荷直接带 `parentId`**（`TaskActions.createSubtask`）。理由具体：

| 两条 op | 一条 op |
|---|---|
| 新任务先以**顶级任务**身份出现在列表里（中间态可被看见） | 要么成立，要么一条都没写 |
| `setParent` 被上限拒绝时，那条顶级任务**永久留下** —— op-log 没有撤回，界面只能提示失败 | 拒绝发生在**写之前**，库里不多东西（这一条有判据：`packages/app-host/tests/subtask-create.spec.ts`） |
| 违背"一个用户意图 = 一条 op"（AGENTS §3.4） | 符合 |

代价与守法：`NewTaskFields` 刻意**没有** `parentId` 字段 —— 否则
`create(title, {parentId})` 就是一条绕过 `MAX_SUBTASK_DEPTH` 的后门。
上限校验放在 `createSubtask` 里，用领域层新加的 `validateNewChildPosition`
（与 `validateParentChange` 共用同一份 `MAX_*` 常量与同一组 helper，
两处式子同源，改上限时不会分叉）。

界面侧：子任务区在**内容层**（它是工作内容，不是"这条记录的某一列"），
每行渲染共享 `<TaskRow density="compact">`（`minimal` 那一档**没有触控下限**，
而这里是要用手指点的）。取数走 `buildTaskTree`，与 `TasksScreen` 数子任务同一口径。
「什么算完成」用领域层 `isCompleted`，不在界面里比 `completedAt`。
点子任务 = 宿主把面板切到那条子任务（`onOpenSubtask` → `selection.select('task', id)`）；
宿主没给时**整行不可点**，不降级成"点行=切换完成"。

## 5.8 「已放弃」出口：移动端已交付，Web 端欠

`apps/mobile/src/screens/AbandonedScreen.tsx` + 「我的」页入口
（`profile-entry-abandoned`，与回收站同一档、同一条第二层整屏纪律）。
只读 `listAbandonedTasks()`，**不自己 filter**（有判据钉住这两条）。
这一屏只有一个动作（恢复）—— 删除属于那条任务自己的行菜单，
一个目的地只允许一个控件。

🔴 **Web 端现在既不能放弃、也不能查看已放弃**（`grep abandoned apps/web/src` 零命中）。
所以 web 上不构成"只进不出"的抽屉，但这是一处**两端不一致**：
同一个用户在手机上放弃的任务，在网页上根本找不到入口。
补法与判据形状与移动端一致（web 的「侧栏 → 回收站旁边」+ 复用同一份 `RowActionId` 词表）。
本轮没做，登记在此而不是留成隐债。

## 5.9 附件（#9）：已落地的与剩下的尾巴

**这一条已经做完了可逆范围内的那一整段**（2026-11-03）。原来的"整条留给下一轮"作废。

### 已落地（每一格都给了现量命令，别信这段文字，跑它）

| 落点 | 现在在哪 | 现量 |
|---|---|---|
| 实体登记 | `packages/shared-schema/src/entity-types.ts` 的 `ENTITY_TYPES` += `ATTACHMENT`（**没有** bump `CURRENT_SCHEMA_VERSION`） | `grep -c ATTACHMENT packages/shared-schema/src/entity-types.ts` |
| 线协议契约 | `packages/shared-schema/src/attachment-http-contract.ts`（20 MiB 单文件上限、路由、错误码、base64 上限**由源字节上限推导**） | `pnpm --filter @heyta/shared-schema test` |
| 领域模型 | `packages/domain/src/entities.ts` 的 `Attachment` + `EntityModelMap` + `MODELED_ENTITY_TYPES`；纯判据在 `packages/domain/src/attachments.ts`（闸门 / 顺序 / 求和 / 单位档位 / 图片判定） | `pnpm --filter @heyta/domain test` |
| 物化 | `packages/op-log/src/state.ts`：`BUCKET_BY_ENTITY.ATTACHMENT = 'attachments'` + `MaterializedState.attachments` + `emptyState()`。⚠️ **没有第四份定义**：`MODELED_ENTITY_TYPES` 与 `snapshot()` 都从那张表派生，所以只改一处就够 —— 这正是它当初收成一个来源的理由 | `cd packages/op-log && npx vitest run tests/entity-coverage.spec.ts`（6 条） |
| 写路径 | `packages/app-host/src/attachment-actions.ts`（`createAttachmentActions`：`addAttachment` / `renameAttachment` / `removeAttachment` + 两个读出口）；字节通道是**注入的端口** `packages/app-host/src/attachment-http.ts` | `cd packages/app-host && npx vitest run tests/attachment-actions.spec.ts`（17 条） |
| 宿主接入 | `apps/mobile/src/screens/TasksScreen.tsx` 拼端口并传进面板；界面在 `TaskDetailSheet` 内容层那一格（列表 / 添加 / 二次确认移除 / 逐类失败各一句话） | `cd apps/mobile && npx vitest run tests/attachment-entry.spec.ts`（10 条） |
| 服务端 | `server/prisma/schema.prisma` 的 `AttachmentBlob` + `server/src/attachments/attachment.routes.ts`（`PUT` / `DELETE`），注册在 `server.ts` 的 `/api` 前缀下 | `cd server && npx vitest run tests/attachment-routes.spec.ts`（11 条） |
| 门禁登记 | `scripts/check-reachability.mjs` 的 `ACTION_FAMILIES` += `ATTACHMENT`（**先有实现后进表**，按 `REMINDER`/`NOTE`/`COMMENT` 那几行的同一条纪律核过）；`check:ai-coverage` 的 `ENTITY_COVERAGE_DEBT` += `ATTACHMENT=AI-COV-9` | `node scripts/check-reachability.mjs --entity=ATTACHMENT`（四条断言全过）+ `pnpm check:ai-coverage` |

### 这一刀里两个不是"照抄先例"的决定

1. 🔴 **附件字节绝不写 `users.storage_used_bytes`。** 那个计数器是 **op-log + 快照** 的缓存值，
   它的两条对账路径（`calculateStorageUsage` 扫描、clean-slate 归零）只认识 op 与快照。
   把附件字节加进去 ⇒ 任何一次对账都把它们**静默抹掉**（症状是配额突然变小）。
   所以计数器保持原语义，配额闸门把两项**相加**后再判（`checkStorageQuota(userId, 附件已用 + 新增)`）。
   头像是同一个先例。判据钉在 `server/tests/attachment-routes.spec.ts`：`user.update` 一次都不许被调。
2. 🔴 **`sizeBytes` 写的是服务端测到的那个数**，不是客户端估的。客户端估算只用来自拒
   "注定失败的上传"，从不进实体 —— 否则虚报一个 `1` 就能少占额度，而显示与配额会分叉。

### 迁移：**写在树上，没有应用到任何数据库**

`server/prisma/migrations/20261103000000_add_attachment_blobs/migration.sql`（新表 + 两个普通索引，
按 `prisma/migrations/README.md` 第 1 优先：**新表空表不需要 `CONCURRENTLY`**，因此不走 out-of-band 恢复路径）。

- 形状对过：`npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
  生成的 `attachment_blobs` DDL 与这份 `migration.sql` **逐字一致**（列名/类型/NOT NULL/约束名/两个索引名）。
  这一步**不需要数据库**，所以它现在就是可复现的证据。
- 🔴 **本机 5432 上那个 postgres 里没有 `supersync` 角色**（实测 `P1010` / `role "supersync" does not exist`）
  ⇒ 这台机器不是这套 schema 的落库目标，本轮**没有**部署迁移。要应用时按纪律走
  `cd server && sh scripts/migrate-deploy.sh`，**不要** `prisma migrate deploy`。
- 🔴 **上线顺序是硬的**：服务端白名单从 `ENTITY_TYPES` 派生，老服务端会把 `ATTACHMENT` 的 op
  判成 `INVALID_ENTITY_TYPE` 永久拒绝 ⇒ **服务端（含迁移）必须先于客户端上线**。

### 🔴 剩下的尾巴（没做，不是"忘了"）

1. **点开 / 预览没有做，这条通道上刻意没有 `GET`。** 读字节只有两条路，两条都不该塞进这一刀：
   base64 过 RN 桥给一张 20 MB 的图 = 可观测的卡顿加内存尖峰；原生直接落进本机文件 = 需要一枚新原生方法。
   那条"只有 upload / remove"的断言在 `packages/shared-schema/tests/attachment-contract.spec.ts` 守着 ——
   谁加 `GET` 必须同时加消费者。
2. **Android 的 `readUriBase64`：✅ 已编译（2026-11-03 远程实测），仍未装机。**
   `apps/mobile/android/.../fs/LocalFsModule.kt`（流式读 + `maxBytes` 超限先拒）。
   Android 构建不在本机 ⇒ 走本仓现成的远程通路（同步**当前工作树** + tar sha256 对账）：
   ```bash
   cd apps/mobile && HEYTA_ANDROID_HOST=linux-dev-lan \
     node ../../scripts/run-gradle.mjs compileDebugKotlin
   ```
   读数：`BUILD SUCCESSFUL in 16s`，`:app:compileDebugKotlin` 是**那一趟里唯一 executed 的任务**
   （其余 106 个 up-to-date ⇒ 编的确实是新同步进来的那份源），
   远端源文件 md5 与本机**逐字相同**（`4337e6b1…`），
   `javap` 在 `LocalFsModule.class` 里读到
   `public final void readUriBase64(String, int, Promise)`。
   ⚠️ 两点如实边界：① 只跑 `compileDebugKotlin`，**没产 APK、没装机、没跑真实上传**；
   ② 默认别名 `linux-dev`（10.111.127.12）本轮 `banner exchange` 超时，
   走的是 `linux-dev-lan`（机器活着，load 0.43、无 gradle 在跑）—— 这是路由读数，不是"主机不可达"。
   脚本自己打了「0 个产物路径已在远端清除」，那台机器上 02:28 那枚**别人那轮的 APK 原样未动**。
3. **iOS 没有读本机字节的原生通道**（与头像同一个已知边界：本工程 Xcode 是经典分组，加 `.m/.swift` 要改 pbxproj）。
   界面上说的是 `mobile.detail.attachments.error.no-channel`（"这台设备还不能选本机文件，请在电脑上添加"），
   **不是**"这个文件坏了" —— 两类失败的动作不同，所以两个码。
4. **孤儿 blob 还没有回收任务。** `addAttachment` 在"字节传成功、op 没写成"时会尽力 `DELETE` 自己刚传的那块；
   回收本身失败（断网）时服务端就留下一块没有主人的字节。表上 `@@index([createdAt])` 是为这个扫描留的，
   扫描本身没写。⇒ 配额会在少数情况下多算，不会少算。
5. **web / 桌面壳没有附件入口**（只有移动端装了 `createAttachmentActions`）。
   `check:reachability` 的判据是"至少一个宿主"，它答不了"每一端都接了吗" ——
   与评论那行同样的边界。
   ⚠️ **本轮量过"能不能顺手补"**：不能，理由不是懒 —— `git status --porcelain apps/web/src`
   现量 **17 个文件在飞**（含 `App.tsx` 与 `features/tasks/` 那几枚），
   而 web 的详情面与宿主装配正落在那几枚上 ⇒ 补 web 入口必然踩到别线在飞文件，
   被本单纪律「不碰别线在飞文件」挡住。等那几枚落定再做。
6. `AI-COV-9`：助手没有附件工具。理由写在 `check-ai-coverage.mjs` 的登记里（助手产不出真实文件字节，
   而写路径刻意拒绝"先建实体后补字节"那个顺序）。

```
# 这一条的门禁全绿读数（串行跑，一次一条）
pnpm --filter @heyta/shared-schema test && pnpm --filter @heyta/domain test
pnpm --filter @heyta/i18n test && pnpm --filter @heyta/ui test
cd apps/mobile && pnpm typecheck && npx vitest run tests/attachment-entry.spec.ts
cd server && npx vitest run tests/attachment-routes.spec.ts
pnpm check:row-single-source && pnpm check:selection-single-source && pnpm check:empty-state
pnpm check:ui-language && pnpm check:docs && pnpm check:ai-coverage && pnpm check:shell-surfaces
```

⚠️ **上面那段命令跑出来的红不能直接读成"本单有回归"**。这台机器负载高时，
`packages/domain`、`packages/ui`、`apps/mobile` 都有测试在**默认超时**下会停
（本轮点到的：`habit-backfill` B8、`lunar` 逐日往返、`habit-artwork`、`task-row-priority`、
`notification-model`、`legal-recheck-mobile`、`privacy-consent-gate`、`focus-widget-lifecycle`）。
定性方法与现量读数在 **§5.11**（把红的那几个文件单独重跑，抬超时 ⇒ 全绿），
那里还记了两个装置坑：`--testTimeout` **不抬 hook 超时**，
`pnpm test -- --testTimeout=…` **不透传 flag**。因果链另见 §6.3。


---

## 5.10 浮层原语的两条能力（G2 / G4）已闭合

**G4**（`expand` / `collapse` 从必填改成可选）在上一轮就落了：`BottomSheetLabels` 里两枚都是
`?: string`，而 `ConflictSheet` 拿"关闭"那句去占位的假文案已经删掉 —— 必填项逼出来的假文案
比缺一项更糟（无障碍树里两句同样的话，其中一句的名字在说"展开"）。

**G2**（关闭那格要能显示**看得见的字**）本轮补齐：

- `packages/ui/src/overlay/BottomSheet.tsx` 的 `BottomSheetLabels` 多一枚**可选** `closeText`。
  给了它，右上角渲染那句字而不是那枚 ×；不给则维持原样（绝大多数面板要的还是 ×）。
- 🔴 无障碍名跟着换：`accessibilityLabel={labels.closeText ?? labels.close}`。
  可见文字本身就是名字，再叠一层 `close` 会让读屏念两句。
- 真消费者已经接上：`ConflictSheet` 交的是它自己那句「以后再说」
  （这一族的关闭有后果 —— 关掉 = 这批冲突还留在这里没处理，后果要写在可点区域上）。
- 尺：`apps/mobile/tests/sheet-named-close.spec.ts`（7 条，现量 `npx vitest run
  tests/sheet-named-close.spec.ts`）。它是**结构尺**：声明在不在、两个渲染分支在不在、
  无障碍名有没有跟着换、消费者是不是真交了一句话。
  ⚠️ 它**不**证明视觉长什么样 —— 那要真机/浏览器看图（`docs/agents/ui-acceptance.md`）。

### 🔴 #7 剩下的阻塞不是 G2/G4，别把它记成"还欠原语能力"

`PrivacyConsentSheet` 与 `LegalReconfirmSheet` 需要的是 `OverlayModalClass` 上**一格
`modal-deferrable`**（背景=deny / 返回键=dismiss / 显式出口=可见文字），
逐条试过并否证的替代写在 `apps/mobile/src/screens/PrivacyConsentSheet.tsx` 文件头：
`modal-forced-read` 会让 Android 返回键不再收面板、`modal-readonly` 会把"误点遮罩"变成
"把同意推掉"、`modal-dirty-form` 是**假判据**（那两枚面板没有任何未保存输入，
而 `check:dirty-form-policy` 之后会信它）。⇒ 这一格补上之前保留自绘外壳。

### G5 —— 原判"`check:l4` 的正则漏计两种形状"**被现量否证**；结论：基线**已按实测下调**（73 → 52）

2026-11-03 现量（`pnpm check:l4`，rc=0）：`apps/mobile/src/screens` 内联样式 **52 处 ≤ 基线 73**，
门禁自己打了一句「建议把 baseline 下调到 52」。

**第一步：把"漏计两种形状"这个前提量掉 —— 它不成立。**
尺的谓词是 `scripts/check-l4-no-style.mjs:246` 的 `/style=\{\{/`，
计数前 `:382` 会 `stripComments`（注释里的 `style={{…}}` 例子**不该**计入）。
**这 13 行的差已逐行分完账**：`rg` 在这个目录数到 65 行，其中
10 行行首就是注释符，3 行是**块注释正文里的散文**（`TasksScreen.tsx:321`、
`ProfileScreen.tsx:1343`、`ProfileScreen.tsx:1352` —— 都是"这一段不许出现 `style={{ }}`"
那种警示句，行首没有 `*`，所以按行首判注释的粗筛会把它们留在代码侧），
剩下 **52 行就是真的代码** —— 与尺打的数**逐字相同**。
⇒ 尺**没有漏计**，52 是准确读数。
现量：`rg -c 'style=\{\{' -g '*.tsx' -g '*.ts' apps/mobile/src/screens`（65）
与 `rg -N --no-heading -n 'style=\{\{' … | grep -vE ':[0-9]+: *(\*|//|/\*|\{/\*)'`（55，再剔那三行散文 = 52）。
另按"注释外、且不是 `style={{` 形状的内联对象"这一维现量两个扫描根
（`style=\[\{` / `style=\{\w+ \? \{` / `style=\{`` ` `` / `style=\{\w+\(\{`）：**各 0 命中**。

**第二步：既然读数准确，就按本仓棘轮政策把它钉住。**
本文件原先写"这一轮不动基线"，理由是"这把尺同时被并发的另一条线读着，单方面降会让对方
下一轮拿到查不到来源的红"。**这条理由现在被判定不够格**，两条根据：
① 当前工作树**已经包含**别线那 342 个未提交路径，而它实测就是 52 ⇒ 降到 52 对
"此刻的树"是绿的，不会凭空让谁红；② 真要有人再加内联样式，那正是这把尺**该**抓的事，
把它当"别线的风险"来豁免，等于永久保留那 21 个回潮额度 ——
门禁自己的注释写着「基线不跟着降就会变成永久豁免，'只减不增'就只剩前半句」。
⇒ 已把 `SCOPES` 里 mobile 那格 **73 → 52**，并按文件里前六次棘轮的同一格式
写下日期、差值、"降之前先核过读数没被少算"的逐行分账。
判据本身一个字没改，改的只是上限（**这是收紧，不是放宽**）。
现量：`pnpm check:l4` ⇒ `apps/mobile/src/screens：内联样式 52 处，恰在基线 52（未新增）`，
`apps/web/src/features` 那格是 `74 恰在基线 74`（没有下调空间，未动），rc=0。
按"注释外、且 `style={{` 之外的内联对象"这一维现量两个扫描根：

```bash
# 现量（只读）。命中数就是"漏计的形状"的处数。
rg -c 'style=\[\{|style=\{\w+ \? \{|style=\{`|style=\{\w+\(\{' \
   apps/mobile/src/screens apps/web/src/features -g '*.tsx'
```

2026-11-03 的读数是**两处都是 0 命中**。
⇒ **52 不是偏低读数**，门禁那句"下调到 52"在数值上是对的。
本单**不跟着下调**，理由只剩一条、而且是真的那条：
这把尺的判据数值同时被并发的另一条线读着（它的"没有新增"是按当前基线 73 说的），
单方面把 73 改成 52 会让对方下一轮拿到一个"突然多出来"的红，却查不到是谁改的尺。
⇒ 要动就连同那条线同批动。**旧写法里"因为漏计所以读数偏低"那句作废**，
别在下一次讨论里再拿它当理由。

## 5.11 收尾那趟全量验证（2026-11-03 现量，串行跑）

**门禁**（七把，全部对最终源码状态跑，逐条 `set -o pipefail` 取 rc，rc 都是 0）：
`check:row-single-source` / `check:empty-state` / `check:ui-language` /
`check:selection-single-source` / `check:docs` / `check:ai-coverage` /
`scripts/check-reachability.mjs`（这一把打的是 4/4 族，含新登记的 `ATTACHMENT`）。
另两把：`pnpm check:shell-surfaces` 先红在"W5 产物比源码旧"，`pnpm --filter @heyta/web build`
后绿；`pnpm check:l4` 的读数就是上面 G5 那一格（**52 = 基线 52**，基线已从 73 按实测下调）。

🔴 **收尾还有一把"对最终树"的全量复扫**（改完那枚 ui 夹具与本轮全部文档之后重跑，
15 把串行、逐条取 rc，**全部 rc=0**）：
`row-single-source` `empty-state` `ui-language` `selection-single-source`
`docs` `md-tables` `doc-citations` `doc-command-claims` `claims`
`ai-coverage` `overlay` `l4` `detail-pane-slot` `detail-pane-c1-coverage`
`reachability`。
⇒ 下面那些"某把尺曾经红过"的段落都是**过程读数**，最终状态以这一把为准。

**改到的四个包的整套测试**（一次一条，串行）：

| 包 | rc | 读数 |
|---|---|---|
| `packages/shared-schema` | 0 | 188/188 |
| `packages/op-log` | 0 | 147/147 |
| `packages/app-host` | 0 | 2151/2151 |
| `packages/domain` | **1** | 2 failed / 1170 passed —— 见下面那段定性 |
| `packages/ui` | 0 | 852/852 |
| `packages/i18n` | 0 | 30/30 |
| `apps/mobile` | **1** | 3 个文件 / 7 条超时，1289 passed —— 定性见下面 |

⚠️ 上面这一行是**加 `detail` 档之前**那一趟的读数。加档之后重跑（同一命令、`--testTimeout=60000`）：
**`Test Files 100 passed (100) / Tests 1296 passed (1296)`，rc=0** —— 连那三枚曾经超时的文件也一起过了。
`packages/ui` 同理：那一趟 852，加档后 **853/853**（多的那 1 条就是新加的 A3）。

🔴 **domain 那两条是环境，不是本单的回归**，证据不是"看着像"，是把它俩单独重跑：
`tests/habit-backfill.spec.ts` 的 B8（源码扫描：产品代码里不许有第二处 `backfillDays` 读取）
与 `tests/lunar.spec.ts` 的逐日往返（1901-01-01 → 2100-12-31，七万多天的纯循环）
在整套里都停在 `Error: Test timed out in 25000ms`，
单独跑 `npx vitest run tests/habit-backfill.spec.ts tests/lunar.spec.ts --testTimeout=180000`
⇒ **rc=0，2 个文件 / 53 条全绿**。跑的时候 `uptime` = load average **52.74**。
两把都不在附件的读路径上（一枚扫 `backfillDays` 这个 token，一枚只算农历），
且本单给 `packages/domain` 加的只有 `Attachment` 实体与 `attachments.ts` 纯函数。

`apps/mobile` 那三个文件同理（都是 `Test timed out in 5000ms`，本单的 5 枚 spec
单独重跑 62/62 全绿）：`legal-recheck-mobile` / `privacy-consent-gate` /
`focus-widget-lifecycle`。现量：前两枚 + 第三枚一起单独跑
`--testTimeout=180000` ⇒ `legal-recheck-mobile` 与 `focus-widget-lifecycle` **全绿**
（75 条里过 72），`privacy-consent-gate` 反而换了失败形状 ——
**`Error: Hook timed out in 10000ms`**（3 failed / 72 passed）。
再单跑它一枚，`--testTimeout=180000 --hookTimeout=180000` ⇒ **rc=0，38/38 绿**（load 45）。

**服务端那一侧**（本单的 blob 通道与 schema 改动）：
`cd server && npx vitest run tests/attachment-routes.spec.ts` ⇒ **11/11 绿**；
`npx tsc --noEmit`（整套服务端源码，含新路由）⇒ **rc=0**。
⚠️ 它需要先有 `prisma generate` 出来的客户端类型（新模型 `AttachmentBlob`）——
本轮生成过一次，所以 tsc 的绿**依赖那份生成产物**，不是纯源码状态。
`apps/mobile && pnpm typecheck` ⇒ rc=0（本单最初交出的 5 处 TS2322/TS2538 都已修）。

**这一刀会牵动的物化/迁移侧门禁**（§5.9 尾巴第 7 条预言"都会跟着动"，现量：
串行跑，逐条取 rc，**全部 rc=0**）：
`check:migrations`、`check:schema-migration-drift`、`check:materialized-reads`、
`check:layering`、`check:op-log-semantics`、`check:crosslang-contract`、
`check:credential-routes`。

🔴 **本单自己有一处"测试全绿但类型面不成立"，是收尾时被 `pnpm --filter @heyta/ui typecheck` 照出来的**：
`packages/ui/tests/task-activity-model.spec.ts`（#2 那族「事件→人话」的尺）里那枚夹具写成了
`const change = (field: string): { field: never } => ({ field: field as never })` ——
`as never` 把 `TaskActivityChange` 的三个必填成员（`from` / `to` / `cleared`）绕掉了。
后果不是"测试跑不过"，**恰好相反**：`pnpm --filter @heyta/ui test` 852 条全绿，
而 typecheck 报 **9 × TS2739**。
修法是把夹具补成真的 `TaskActivityChange`（断言一个字没改，不是放宽判据）。
⚠️ 纪律那句"vitest 不做类型检查，跨包加 API 后必须单独 tsc"**射程包括测试文件自己** ——
而 `packages/ui` 的 `typecheck` 用的是 `tsconfig.spec.json`（含 `tests/`），
所以这把尺本来就在，只是我前面只跑了 `test` 没跑它。
现量：`pnpm --filter @heyta/ui typecheck` 修前 rc=2 / 9 处，修后 **rc=0**；
`pnpm --filter @heyta/{domain,app-host,shared-schema} typecheck` 各自 **rc=0**（同一把尺扫过本单其余四枚新 spec）。
聚合那一把是 **`pnpm typecheck`（= `pnpm -r typecheck`，每包都用自己的 `tsconfig.spec.json`，含 `tests/`）** ——
2026-11-03 现量 **rc=0**（全仓逐包 Done），修完夹具后 `pnpm --filter @heyta/ui test` 重跑 **852/852 rc=0**。

⚠️ **两个装置坑，都会把人引向错的定性**：
1. **`--testTimeout` 不抬 `beforeEach` / `afterEach` 的超时**（那是另一个 flag
   `--hookTimeout`，默认 10 秒）。只抬前者，慢机器上会出现一种**新形状的失败**，
   看着像"这个文件真有产品缺陷"，实际还是同一件慢。
2. **`pnpm test -- --testTimeout=…` 不会把这个 flag 透传下去**（本轮踩过）。
   要抬超时只能 `npx vitest run …`。

⚠️ 这三枚都不在本单名下（`legal-recheck` / `privacy-consent` / `focus-widget`），
本单**没有**给它们改超时或改判据 —— 只做了一次单独重跑取证。
按 §6.3 那条的方法，真正的修法属于各自那条线。

## 5.12 🔴 第一步要的"大字档"是**这一轮才真正交付的**（前面那轮只做到了"门禁绿"）

回头逐字对工单第一步，发现一处**要求没做完**：它写的是
"给共享 `TaskRow` 加一档 density（row / detail），让详情面板渲染共享组件的**大字档**"。
而当时的实际状态是 —— 门禁 `check:row-single-source` 绿了（因为面板改成渲染共享 `<TaskRow>`），
但 `packages/ui/src/task-list/density.ts` 只有 `comfortable | compact | minimal` 三档，
**没有 `detail`，标题也仍然是列表档的 16px**。
本工单 §6 那一节当时把这件事写成了一条"已知代价"：

> 标题字号退回 `row-title`，拿不到对标产品的大字正文（`density.ts:32` 明文）。
> 要拿到它必须有人推翻那条规则 —— 那是产品决定，不是本轮的工程决定。

**这条"已知代价"现在作废** —— 工单（用户写的）就是那个授权，而且它给的解法正是
"加一档 density"，不是"在宿主里再写一份行"。

### 改了什么

| 落点 | 改动 |
|---|---|
| `packages/design-system/src/typography.ts` | 新增语义样式 `detail-title`：`font-size.xl`(20) + medium + `line-height.normal` |
| `packages/ui/src/task-list/density.ts` | 档位加 `detail`；`TaskRowDensitySpec` 多一个 **`title: TextStyleName`** 轴；四档全部登记 |
| `packages/ui/src/task-list/TaskRow.tsx` | 标题从 `text[TASK_ROW_TEXT.title]` 改成 `text[spec.title]` |
| `apps/mobile/src/screens/TaskDetailSheet.tsx` | 内容层那一行传 `density="detail"`（子任务那几行照旧 `compact`） |

**为什么是 20 而不是 18**：`typography.ts` 自己判过"16:14 = 1.14 在阅读距离上不构成层级"。
18:16 = **1.125**，比它抱怨的那个还小 —— 加一档却读不出差别。20:16 = 1.25，20:12(`row-meta`) = 1.67。
字重**沿用** medium，不靠加粗补层级（那会跟 `headline` 那个角色混起来）。

### 🔴 那条"density 不许改排印"的规则是谁定的、我凭什么改它

现量：这条规则**只存在于 `density.ts` 的文件头注释**。
`grep -rnE "密度|density" docs/agents/ux-principles.md docs/agents/design-system.md` 里
没有任何一条讲排印；`design-system/heyta/MASTER.md` 里"密度"只出现在落地页那一格。
⇒ 它不是设计系统的硬规则，是这个文件自己立的边界。
而它当时的两条出路是：① 在宿主里再手写一份"勾选框+标题+截止"（正是
`check:row-single-source` 断言 A 抓的形状，也就是本工单第一步要消掉的那条红），
② 让密度表允许换标题的**语义样式**。① 比 ② 糟得多，所以走 ②。

**它不是"从此可以随便调排版"的开口**，四把尺钉着（都在 `task-row-density.spec.ts`）：
值只能是 `TEXT_STYLES` 的键（裸值被 `check:design` 拦）；
**只有 `detail` 一档偏离**，另外三档逐字等于 `TASK_ROW_TEXT.title`；
`detail` 与 `comfortable` 除 `title` 外**必须完全相同**（几何/插槽都不许多改）；
组件必须真读 `spec.title`，且**不许**再直接读 `text[TASK_ROW_TEXT.title]`。

⚠️ 加这一档撞到了 `design-system` 的**样式数量棘轮**（13 → 14）。
按同文件里上一档层级新增的同一先例处理：把"为什么不能复用已有的"写进测试注释
（比 `row-title` 大的语义档只有 `screen-title`(30，页面级) 与 `numeric-summary`(24，数字专用角色)，
中间没有一档），并写明"这是棘轮不是配额"。

### 这一刀的现量（串行，逐条取 rc）

`design-system` 套件 **546/546**（含 `generated.spec.ts`：跑
`pnpm --filter @heyta/design-system run generate` 重生成 `typography.css` 后一致）、
`ui` 套件 **853/853**（比上一轮多的那 1 条就是新加的 A3）、
整仓 `pnpm typecheck` **rc=0**、web 那三枚行相关 spec **76/76**、
`check:design` / `design-token-refs` / `text-color` / `tokens` / `theme` /
`row-single-source` / `empty-state` / `ui-language` / `selection-single-source` / `l4` /
`docs` / `md-tables` / `detail-pane-slot` / `detail-pane-c1-coverage` **各 rc=0**。
🔴 **新尺验过能红**：把 `comfortable.title` 改成 `'detail-title'` ⇒
`task-row-density.spec.ts` **3 条红**（A3 + B + A 的"两两不同"），还原后 7/7 绿。

⚠️ **一处必须披露的副作用**：跑 `design-system run generate` 时，生成器把工作树里
**别人未提交的** `packages/design-system/src/format-matte.ts` 的导出也写进了
`src/index.ts`（barrel 是按目录重写的）。我**没有回滚它** —— 回滚会拆掉那条线在飞的功能。
本轮没提交任何东西，所以那一处只是工作树里的生成物。

### 真机读数（当前产物，`e1-detail-bigtitle.png`）

重新 `xcodebuild` Release（`BUILD SUCCEEDED`）→ `simctl install` → 重启应用 → 打开详情面板。
**判据是无障碍框，不是像素**：标题所在那一行
`task-row-task-mvzlt9wb-1-d8sqiuww`（名字仍是「编辑标题」）的 frame 从
**40pt 高 → 46pt 高**（宽仍是 306）。
+6pt 正是 `16px × line-height.normal(1.5) = 24` 与 `20px × 1.5 = 30` 之差
⇒ **`detail` 档在设备上确实生效了**，字号走的是登记过的 token，不是宿主自己写的数。

🔴 **这台装置连着骗了我两次，两次都是"我以为我在量标题"**：
1. 先按 `1242x2688 / 3.218` 算坐标裁带 —— 真实截图是 **1398x2034**（含折叠屏黑边），
   比例根本不是我以为的那个；
2. 于是裁到的两条带落在**备注/子任务行**上，`magick compare -metric AE` 读出 **0 个差异像素**，
   看起来像"改了没生效"。**一个量错位置的 0，比没有读数更坏** —— 它长得像证据。
⇒ 收尾量字号这类"某个节点变了没有"，**优先用无障碍框**（`idb ui describe-all` 的 `frame.height`），
它直接给语义节点的盒子；像素裁带只在已经用框定过位置之后才用。

---

## 6.4 真机腿（2026-11-03，iOS 模拟器，第一次跑）

**跑到哪一步**：`pnpm verify:mobile-ios` 的构建与安装段全过 ——
用**当前源码**打出 Release、装进 `iPhone Duo heyta`、写了产物归属章
（`/tmp/heyta-ios-release/.heyta-build-owner`）、idb companion 连上。
脚本随后停在它自己的前置：它要宿主机服务端在 `127.0.0.1:3000`，
而**这台机器上那个端口被一个与本仓无关的服务占着**
（`~/.claude/mcp-servers/.../open-websearch`）。那不是本线的对象，
所以按"只对自己创建的对象动手"，我没停它，也没改它的配置。
⇒ 跨设备那几步（L5）本轮没跑，**不能说真机验收通过**。

**离线能证的部分已经证了**（自己用 idb 驱动，不依赖服务端）：
首启隐私闸 →「只用本机」→「先离线使用」→ 任务页空态 → 建一条任务 →
点开详情面板。面板在真机上画出来的就是本轮改的结构：
头部三件套（清单⌄ / 旗标 / ⋯）、共享 `TaskRow` 那一行、日期状态行、备注、
**子任务空态那句 + 「添加子任务」**、折叠层里**新加的「任务动态」一格**。
默认档实测落在屏幕 31% 处（medium ✅）。

🔴 **上面这段里"画出来的"那三张图，事后查明是黑帧**（2026-11-03 第二轮取证时发现的）。
`md5 /tmp/heyta-rig/{tasks,sheet1,kbfix}.png` 三个**逐字节相同**（同一枚 106123 B 的全黑帧），
而那张全黑帧与 `xcrun simctl io … screenshot` 在**这台机器上**产出的东西是同一枚。
⇒ 那一段的**结论**当时是从无障碍树 + 另外四张真图（`sheet2` / `activity` / `subtask1` / `kbfix2`）
读出来的，那四张是真的；但"看图"这一步里**混了三张没看到任何东西的图**。
教训：**同一把尺连出两枚相同哈希 = 尺坏了**，不是"界面没变"。
现量命令（每次取证收尾都跑一发）：
`md5 -q /tmp/heyta-rig/*.png | sort | uniq -c | sort -rn` —— 出现计数 >1 就是重复帧。

⚠️ **这条本仓早就在册**：环境陷阱 **#630**「没有 GUI 的 `xcrun simctl io screenshot` 全是黑帧」
连"三张黑帧字节数一模一样"的判据都写好了。本轮是**动手前没先查现成条目、自己重新撞了一遍**。
⇒ 顺出来另一类：已入库的证据图里也有"两个步骤名、同一枚字节"，登记成 **#634**
（含那把只读的撞哈希尺与"不能一律判成缺陷"的三种成因分诊）。

## 6.5 真机腿第二轮（2026-11-03 06:0x，当前产物，`idb screenshot` 通道）

**产物**：`xcodebuild … -configuration Release` 对**当前源码**（含 #9 附件那一整段）**BUILD SUCCEEDED**，
`Heyta.app` 内 `main.jsbundle` 与 `Heyta` 二进制的 mtime 都晚于最后一笔源码改动，
`xcrun simctl install` rc=0，`com.heyta` 起来后无障碍树有 25 枚节点（**不是**空树）。

**逐张真看过**（都在 `/tmp/heyta-rig/`，每张哈希互不相同）：

| 图 | 看到的东西 |
|---|---|
| `v1-tasks.png` | 任务页：日期头 + "2 项待办，0 项已完成" + 搜索框 + 「… 列表 / 选择任务」+ 收集箱分组 + 两行任务（勾选框 + 标题 + 清单图标）+ 蓝底 + |
| `v2-detail.png` | 详情面板顶部：把手、标题「收集箱」+ ×、**头部三件套**（清单⌄ / 旗标 / ⋯）、共享 `TaskRow` 那一行、日期状态行「未设截止」+ ⌄、备注占位、**子任务空态那句** |
| `v16-att3.png` | **附件那一格**：「附件」标题（被滚动视口切掉一半）+「还没有附件」+「+ 添加附件」，下面接折叠层「提醒 / 未设置」「重复 / 不重复」 |
| `v13-rowmenu.png` | **长按行菜单**：打开详情 ↗ / 置顶 / 放弃 / 多选 ─ 删除（删除是红的） |
| `v14-swipe.png` | **左滑**：行往左移，右侧露出一块红色「删除」（垃圾桶图标 + 文字），第二行未受影响 |
| `v17-activity.png` | 折叠层底部：清单 / 收集箱、上级任务 / milk 123、标签 / 未设置、**任务动态** |

无障碍树侧的三条硬读数（同一台、同一产物）：
`task-detail-add-subtask`、`task-detail-add-attachment`、
`task-detail-section-activity` 都在；点「任务动态」之后它的名字变成
**「任务动态, 1 条变更」** —— 这一枚是 #2 那条读路径（`engine.getOpsForEntity` → 投影）
**在真机上读到了一条真实 op** 的证据，不是空壳。

### 暗色那一维（`ui-acceptance.md` 没要求，本轮还是量了一发）

`xcrun simctl ui <udid> appearance dark` → 重启应用 → 滚到附件那一格 →
`d2-dark-attachment.png`（真看过）：面板面是深蓝、`还没有附件` 走 muted 灰仍可读、
`+ 添加附件` 是白字胶囊、折叠层「提醒 / 未设置」正常。
⇒ **本单新增的那一格在暗色下没有对比度问题**（没看到"文字贴在同色底上"那种失效）。
⚠️ 这不是全暗色验收：只看了这一格；设备随后已恢复 `light`（`xcrun simctl ui … appearance` 回读 `light`）。
另：两张图里「附件」那行标题都被滚动视口切掉半行 —— 那是**滚动位置**，
亮色那张（`v16-att3`）同样如此，不是暗色独有的缺陷，也不是缺陷。

### 🔴 这一轮把装置的四件事量清楚了（写下来，下一个人别再撞）

1. **`xcrun simctl io … screenshot` 在这台 Mac 上产全黑帧** —— 在册的 **#630**，本轮复现。
   可用的那条是 **`idb screenshot`**（走 companion，从设备内部取帧），已作为第 4 条出路补回 #630。
   ⚠️ 它同时解释了为什么"截图存在、大小非零"完全不能当判据；收尾撞哈希那条尺见 **#634**。
2. **`idb ui swipe` 不带 `--duration` 一点都不滚**（`ios-ax-shim.py` 文件头第 54 行早就写了，
   本轮现量复现：连发两次，图只差时钟）。
3. **`--duration` 的单位是秒**，不是毫秒。写 `--duration 700` = 一次 700 秒的按住拖动
   ⇒ CLI 挂住（本轮挂了一发，`TaskStop` 掉）。要正常滚：`--duration 1`。
4. **`ios-ax-shim.py --scroll-into-view` 回给你的 `visible:"True"` 不能全信**：
   它拿 AX 矩形和**整块屏幕**比，不扣面板自己的裁剪区（`styles.clip`）。
   实测有一次报 `visible:True / y=333`，而那一格其实被面板头部盖住。
   ⇒ 判"滚到了没有"要么看 `idb screenshot` 的图，要么自己按裁剪区重算。

**仍然没在真机上验的**（不说成已验）：附件的**真实上传**（iOS 没有读本机字节的原生通道，
点了只会得到 `no-channel` 那句；Android 那枚方法未编译）；跨设备同步（L5，
宿主机 3000 端口被与本仓无关的服务占着）；暗色档那一轮只改了阴影，本轮没重跑暗色
（⚠️ 这句是**第一轮**的读数 —— 第二轮已经对本单新增那一格量过暗色，见 §6.5 那一节；
其余各格的暗色仍未逐格走过）。

### 🔴 真机抓到一处静态判据全绿也发现不了的缺陷

点「添加子任务」之后：键盘起来了、输入框**确实拿到焦点**，
但屏幕上从头部三件套到键盘之间**整段是空白** —— 用户视角就是"点了没反应"。
成因：外层 `KeyboardAvoidingView` 只把**整块面板**抬起来，面板高度仍由档位决定，
所以焦点输入框如果在折叠内容更靠下的位置，抬完还是被键盘盖住。
这一格在 `check:row-single-source`、类型检查、46 条移动端判据、2100+ 条测试下**全是绿的**。

修法落在**原语**里（不在宿主绕）：`packages/ui/src/overlay/BottomSheet.tsx` 的
`ScrollView` 加 `automaticallyAdjustKeyboardInsets`（iOS 13.4+ 的平台行为：
按键盘高度顶出内容 inset，并把第一响应者滚进可视区）。

✅ **修完已在同一台设备复验**（重新打 Release + 重装 + 重跑同一条路）：
点「添加子任务」后输入框落在 **y=345pt**（键盘上沿之下、屏幕之内），
`idb` 能按标签找到它并输入，提交后真机上出现
「子任务」+「已完成 0/1」+ 子任务行（无障碍名 `完成：wash bottle` 与
`打开子任务「wash bottle」`）。⇒ 这一格从"点了没反应"变成走得通。

### 本轮改动被门禁照出来的三处（都已按门禁指的路修，不放宽判据）

| 红 | 定性 | 处理 |
|---|---|---|
| `check:ui-language`：`mobile.detail.subtasks.progress` 是不含汉字的中文词条 | **本单的**，形状正是它要防的"拿别的语言占位" | 没有塞进 `UNTRANSLATABLE_KEYS`，改成「已完成 {done}/{total}」（信息量也更大）⇒ 绿 |
| `check:empty-state` 断言 B：`AbandonedScreen` 手写空态 | **本单的**，新空态不许在视图里手写 | 改用 `apps/mobile/src/ui/kit.tsx` 的共享 `EmptyState`，并补一句"东西是怎么进来的"（`mobile.abandoned.emptyHint`）⇒ 绿 |
| `check:selection-single-source` 断言 G：`AbandonedScreen.busyId` 未登记 | **本单的**，但是合法瞬态（in-flight，不是第二个选中所有者） | 按门禁自己指的路在 `ROW_ID_EXEMPT` 登记一行并写明类别与理由 ⇒ 绿 |
| `check:docs`：本工单里有一条 ux-principles 的子编号引用是死链 | **本单的**（那条实测记录只登记在 §8，没有再往下的子编号） | 把那处子编号去掉、改成 §8 ⇒ 绿 |

### 🔴 一条红不是本单的（登记，不代改）

`packages/i18n/tests/catalog.spec.ts`「中文表每一条都含汉字」红在
`web.ai.attach.meta = {width}×{height} · {kb} KB` —— 该键由
`86a30c14a feat(ai): 对话面板贴图` 引入、**已在 HEAD**，与本单无关。
它撞的是与上面 `subtasks.progress` 同一类形状（尺寸元数据没有汉字），
但"翻译还是登记为不可译"是那条线的语义决定，不代它拍。

### 还没在真机上验的（不说成已验）

- 「任务动态」展开后的**内容**：折叠层里那一格在真机上存在且能点到，
  但它在 medium 档的折叠线以下，本轮没滚到它就停了 ⇒ 展开态读数**未取证**。
- 行长按菜单与左滑的**视觉**：本轮只验过无障碍名与接线（`打开任务：…` / `完成：…` / `删除`），
  没截到菜单与露出动作的图。
- 跨设备那几步（L5）：需要宿主机服务端在 `127.0.0.1:3000`，
  这台机器上该端口被一个与本仓无关的服务占着（不是本线的对象，没停它）。
  ⇒ **真机验收整体算"部分完成"**，不能说通过。


### ⚠️ 两处读数装置本身的坑（不是产品）

- `xcrun simctl io <udid> screenshot` **不带 `--display` 时截出全黑**（106 KB 的黑图），
  而应用正在渲染；加 `--display=1` 才拿到真图。截图判据若不先看像素就会把"全黑"读成"白屏缺陷"。
- `idb ui text` **打不出中文**（`No keycode found for 买`）。
  设备腿里的输入内容因此只能用 ASCII，或者走粘贴板。
- 键盘弹起时 `idb ui describe-all` 的可访问性树**塌到 2 个节点**（只剩 Application 与标题），
  所以"按标签找控件"这类断言在键盘开着的时候**读不到东西**——
  这是装置读数，不是界面没有内容（同一时刻截图里内容是在的）。

### 待判定（记下来，不当缺陷也不当正常）

日期状态行（图标 +「未设截止」+ 展开箭头）在真机上**整组水平居中**，
而对标产品与这一屏的其他属性行都是左对齐。本轮没改它，
也没在没量之前写进缺陷账 —— 判它的断言是：
`task-detail-due-toggle` 那一行的图标左缘 x 应当等于面板内容左缘（16pt），
实测要先取 `styles.propRow` 的 `justifyContent`。

---

## 7. 并行作业的实测代价（决定后面还派不派）

| 作业 | token | 工具调用 | 落地 |
|---|---|---|---|
| 第一轮 5 枚实现作业 | 约 990 万 | 各 20–29 | **2 个文件**（其余全死在重读仓库上，且撞上额度墙） |
| 只读探针（读路径清点） | 520 万 | 62 | 一张穷举表 + 四处存量 I5 违规（值，但极贵） |
| 三枚弹层迁移（第二轮，锚点喂全 + 禁止全仓 grep） | 1178 万 | 66 | 1 枚迁移 + 5 条原语缺口 G1–G5，其中 G3 是真 bug（⚠️ G5 那条"`check:l4` 漏计"2026-11-03 被现量否证，见 §5.10） |

⚠️ 结论与直觉相反：**给了完整 file:line 锚点并没有把成本降下来**（第二轮反而更高）。
这些作业把预算花在"读完整目标文件 + 它的 spec + 相关规则文档"上，而这是改它们的必要前置。
所以"并行加快速度"在这里换到的是**墙钟时间**，不是 token；额度是硬约束，超了就整批中断。
后面按这个前提排：**能自己做的精确小改（字段、判据、门禁修复）留在主线，
只有"整枚文件的重写"才值得派出去。**
