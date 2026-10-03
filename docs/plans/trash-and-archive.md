# 回收站与归档：落地计划

> 状态：**规划中**（2026-10-03 立项，第四轮读代码后待拍条数从 4 扩到 **9**，见 §7）
> 事实与证据在 [回收站与归档调研](../research/trash-and-archive-best-practice.md)，本文不重复抄一遍
> （**抄件一定会漂**）；引用现状时只给该文的节号（§x.y），不重述行号
> ⚠️ 例外：§2.0、§3.5、§6 G-6/G-9 里的行号是**本轮现量**的（它们不在调研里），
> 每处都附了复跑方式 —— 别把它们读成"调研已经说过"
> 上位约束：`AGENTS.md` §3.3（不加必填字段 / 不 bump schema）、§3.4（op-log 纪律）、
> §6.1.1（四端重装），以及调研 §6 那 9 条"事实上的规格"

---

## 0. 要解决的问题，按用户能看到的样子排

| # | 用户能碰到的问题 | 今天的行为 |
|---|---|---|
| 1 | 删了一条便签/清单/标签/习惯，**任何端都找不回来** | 回收站只收任务（`restoreNote` 已实现但零调用点） |
| 2 | 删了任务，**提醒还在响**（🔴 **仅 Web**：移动端今天根本没投递，见 W2/G-6） | 投递处只看"任务记录存不存在"，墓碑是存在的（调研 D1） |
| 3 | 归档一条清单 = **数据进黑洞**（🔴 第四轮更正：**今天还没有用户能踩到** —— 组件层没有"归档"按钮，见调研 §2.5；这条讲的是**接上入口那一刻**的形状） | `archived` 只进不出：动作层有 `archiveProject`（web store 已转发 `features/projects/store.ts:75`）**但无组件调用点**，而 `unarchive` **全仓不存在**、也没有"显示已归档"界面 |
| 4 | "彻底删除"两端**说法不一样** | 移动端明说"这不是物理擦除"，Web 那句没有这半句 |
| 5 | 删清单/删标签**单击即生效**，无确认 | 回收站帮不上（它们根本不进回收站） |
| 6 | 倒数纪念日（EVENT）需要一个"归档"出口 | 实体本身还没建，但 [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) 已裁决它要可归档 |
| 7 | 🔴 政策里承诺的"服务器上 45 天后被清理"，对我们的数据**一次都不会发生** | 隐私政策草案 `privacy.ts:381,485` ↔ 代码判据（调研 §5.3 / D8）；文档尚未生效，现在改成本为零 |
| 8 | 🔴 **"彻底删除"之后，Web 搜索还能把它搜出来**（移动端不会） | 领域层 `searchTasks` 不滤墓碑、Web 递的是含墓碑的原始表（调研 D9）—— 而帮助中心 `s3p3` 已对外承诺"从我能看见的**所有地方**移除" |
| 9 | 🔴 **归档一条清单后，界面上它没了、助手嘴里它还在**（⚠️ 第四轮定性：**机制今天已成立，但今天还没有用户踩得到** —— 唯一写入口 `archiveProject` 无组件调用点、滴答导入不落成 `archived`，见调研 §2.5 更正。它排在 W3 **前面**的理由正是这个：**W3 一加界面按钮，这处当天变成用户可见**） | `archived` 唯一的过滤点在 UI 层（`packages/ui/src/projects/model.ts:107`），出口层 `project-actions.ts:205-207` 的 `listProjects()` 只滤 `deletedAt` ⇒ 归档清单对 local-api/MCP、AI、node-host CLI **全部可见**（本轮新照出，见 W9） |
| 10 | 在移动端设了提醒 → **什么都不会发生** | 不是"漏了一层"，是**整条投递路径从未实现**：`due()` 的移动端消费者 0、本包 Kotlin 源 0 处 `NotificationManager`、`package.json` 0 通知依赖（三层证据在 W2）。实现路径要拍系统权限，`BLOCKED.md` **B33** 已登记；本轮**不做**，但把它写进 §0，是因为它决定了第 2 条能修到哪一端 |

第 6 条是这份计划**必须现在做**而不是"以后再说"的理由：EVENT 批次二一开工，
`archived` 就会从"没人用的字段"变成"必须有出口"，届时再改语义就是撞已上线的数据。

---

## 1. 目标形状：四态 + 一条可见性契约

```
                    ┌──────────── archive ────────────┐
                    ▼                                  │
   alive ──delete──► trashed ──purge──► purged          │  （purged：全仓不可见、不可还原）
      ▲                │                                │
      └──── restore ───┘                                │
                    │                                   │
   archived ◄───────┴───────── unarchive ───────────────┘
   （archived：不出现在任何活视图**也不出现在任何出口**（搜索 / AI 与 MCP 工具 / CLI），
     但**出现在「已归档」列表里，且永远可回来**）
```

四条不变量，每条都要有能因注入转红的判据：

- **I1 每个箭头恰好一条 op。** 撤销/还原/归档/解档/彻底删除都是**一个用户意图 = 一个 op**（§3.4）。
- **I2 还原回到"删除前那一态"，包括归档态。** 一条被归档的清单被删除后再还原，
  应回到 `archived`，**不是**回到活跃列表。
  ✅ 今天 `restore` 只清 `deletedAt`、`archived` 从不被碰 ⇒ **这条现在就是免费成立的**；
  它需要的是**判据**而不是代码 —— 因为任何人日后"顺手"在 restore 里重置其他字段就会破。
- **I3 归档不许借用 `deletedAt`。** 已有裁决（调研 §2.5），本计划把它变成变异判据。
- **I4 `purgedAt` 不许清 `deletedAt`，且不许被宣传成物理擦除。** 已有裁决 + 已有文案；
  本计划补的是**把 Web 那句补齐**（问题 4）。
- 🔴 **I5（本轮新加，由 W8 + W9 共同逼出）"隐藏"由层负责，不由调用点负责。**
  两种隐藏各有**唯一**的定义处：
  `deletedAt`/`purgedAt` 归**领域/动作层自己滤**（W8：`searchTasks` 内部滤；W2：`due()` 内部滤掉所属任务已进墓碑的提醒），
  `archived` 归**动作层的 list 分裂**（W9：`listProjects()` 不含归档 + `listArchivedProjects()` 只含归档）。
  ⇒ 判据形状统一成一句话：**把原始表递进去也不得出现**。
  界面上那个"显示已归档"开关是**显式取第二路数据**，不是"把过滤关掉"。
  这条之所以要写成不变量：本轮实测的两个泄漏（搜索、AI 出口）**都不是有人写错了代码**，
  而是"滤"这个决定**留在了调用方手里**，而调用方不止一个。

### 1.5 为什么"自动过期清理"不做（P-2 的论证）

调研 §3.2 已回填各家保留期（一手：Microsoft 回收站两级窗口 **30 + 93 天**、
Kafka `delete.retention.ms` 默认 **1 天**，而它的语义根本不是"省存储"而是
"**墓碑窗口必须大于最慢消费者的最大落后时间**"，见 §4.3）。**我们不该照抄这个参数**，
理由不是"还没做"，而是三件事同时不成立：

1. **我们没有任何物理删除能力**（调研 §5）。所谓"30 天后自动彻底删除"，
   实际效果只是**把条目从唯一还看得见它的地方挪走**，而数据一分不少地留在
   本机 op-log 与服务端库里。做一个"到期自动执行的假删除"，比不做更糟 ——
   它会让用户相信"30 天后它就真的没了"，而那正是 `entities.ts:42-45`
   和帮助中心明令禁止的宣传。
2. **服务端算不出来**（E2EE，调研 §4.1），只能客户端各自裁决；而客户端时钟不同，
   "同一条在两台设备上一个还在回收站、一个已经消失"是**必然发生**的（调研 §4.2）。
   这属于"界面在说谎"那一类，是本仓库判据最严的一类 bug。
3. **两个真实动机我们都没有**：竞品做 TTL 主要为了云端存储成本与可对外承诺的删除时限，
   前者我们服务端今天对本仓账号一条都不清（调研 §5.2），后者要等加密擦除。

⇒ 立场：**回收站不设保留期**；条目一直可还原，直到用户亲手彻底删除。
  磁盘/内存回收这件事另立协议工单（§6 的后置债），**不借"回收站 30 天"这个由头偷偷做**。

🟢 **外部旁证**（[调研 §3.2](../research/trash-and-archive-best-practice.md)）：
市面那套 TTL 的动机在微软文档里写得很明白 —— 30+93 天的两级窗口是为**合规与电子数据展示**服务的
（"保留策略始终优先于标准删除过程"、"回收站未编制索引，因此 eDiscovery 找不到内容"）。
而我们同品类的竞品里，**Todoist 对项目根本没有回收站**，官方给的补救是一段
"新建一个项目并且导入备份文件"（自动备份最多 21 份）——
也就是说该品类"找回"的真实备选是**备份**，不是 TTL。
而 heyta 的备份还原**只支持还原到空库**（明确拒绝合并到非空库），
⇒ 我们比 Todoist **更没有**资格说"没回收站也行"，也比微软**更没有**条件做服务端 TTL。
⚠️ 这一条与市面主流相反，所以它必须写成 ADR（W0），而不能只留在这份计划里 ——
否则下一个读到"竞品都有 30 天"的人会当成漏做。

---

## 2. 工单

排序原则：**先做已经有一半零件的**（W1 的 `restoreNote` 已存在），
再做需要新界面的（W3 归档出口），**每条先查 §2.0 那张表确定它落到哪几端**
（`AGENTS.md` §3.5 那条"只有注入驱动那一行允许各端不同"仍然成立，但它的单位是宿主，不是"端"这个字）。

### 2.0 先讲清"落点"：动作层多一个方法 ≠ 某个端能用它

`AGENTS.md` §3.5 那条"跨端一次做完"是真的，但它的**单位是宿主**，不是"端"这个字。
本轮每条工单动之前，先在这张表上找到它那一格（全部行号本轮现量）：

| 宿主 | 回收站界面在哪 | 列表实现 | 壳级窄门面里有 `restore`/`purge`/`listTrashed` 吗 |
|---|---|---|---|
| **web** | `apps/web/src/features/trash/TrashView.tsx`（rail tab 见 `features/shell/view-tabs.ts`） | 共享 `packages/ui/src/trash/TrashBoard.tsx` | 不适用 |
| **mobile RN** | `apps/mobile/src/screens/TrashScreen.tsx`（`:150` `actions.restore`、`:173` `actions.purge`） | **同一份** `TrashBoard` | 不适用 |
| **node-host** | CLI：`apps/node-host/src/cli.ts` + `host.ts`（`purgeTask` / `listTrashed`） | 自己投影 | 不适用 |
| **macOS 原生壳** | 只在 **app 模式**有（`HeytaMacApp.swift:472` 载 `heyta-local://app/index.html` = `web-dist`）；壳级 `ShellView` 没有 | 载的是 web 那份产物 | 🔴 **没有** —— 门面全集是 `native-bridge.ts` 的 `open/listTasks/listTaskEntities/addTask/setTaskDone/removeTask/clientId/openOpLog/close`；`removeTask`（`:273-277`）**只发软删** ⇒ 壳级路径"能删不能找回" |
| **Windows 壳** | 同 macOS（`web-dist` 进包，判据 `PAYLOAD_WEBDIST=True`） | 同上 | 🔴 同一个门面 |
| **Linux 壳** | 无（`main.c:36` 只带 `native-bridge.js`；无 web-dist 装载路径） | — | 🔴 同上 |
| **Electron（待退役）** | `apps/desktop/src` 里 `trash` **0 命中**；它载自己的 `renderer-dist`（`main.ts:129`），不是 `apps/web/dist` | 自己的 | — |
| **鸿蒙** | 无壳（§1 前提） | — | — |

⇒ **本轮"跨端"的准确含义**：`packages/app-host` 的动作 + `packages/ui` 的共享行 + **web / mobile 两个有界面的宿主** + node-host CLI；
mac/Windows 靠 `web-dist` **自动跟随**（所以 W1 交付后必须跑 `pnpm reinstall:desktop` 才叫真的装上），
Linux / Electron / 鸿蒙**登记为边界**（§5），不许在工单里写成"四端已修"。

🔴 **两道门禁都不执法这件事**（这是本轮最要紧的一条元结论，§8 把它列为反哺样本）：

- `check:reachability`：判据 C 是**家族粒度**（`\bcreateXxxActions\s*\(`，`:596-603`；
  `ACTION_FAMILIES` 每项只有 `{entity, family}`，`:304`），且扫描范围是 `apps/*/src` 的 **`.ts`**
  （`HOST_ROOT='apps'` + `HOST_REQUIRED_SUBDIR='src'`，`:313-316`）
  ⇒ **Swift / C# / C / ArkTS 根本不在它眼里**，方法级的"写了没人接"它结构上看不见。
- `check:layering`：`EXTENSIONS = ['.ts','.tsx','.mts','.cts']`（`:68`）、只 `walk(APPS)`（`:250`）、
  规则是 **8 条禁止式**正则（`:71` 起：自己 `new SyncClient(`、自己定义 `resolveClientId`、
  `crypto.randomUUID()`、`'lastServerSeq'` 字面量、`entityType: 'X'` 构造 op、厂商 SDK import 等）。
  ⇒ 它拦"apps 里重新长出业务/接线"，**不要求**"每个宿主都转发某个 action"。

**推论**：任何"新动作要能在端上被用到"的要求，**必须由该工单自己的界面/CLI 判据来钉**，
不能写成"某道门禁会抓到"。这条推论适用于 W1/W3/W4/W9 全部四条（它们各加一个方法）。

### W1 · 便签进回收站（最便宜的闭环，先立形状）

零件几乎都在：`removeNote` ✅、`restoreNote` ✅（`note-actions.ts:201-215`，零调用点）、
回收站视图 ✅、共享行组件 ✅。缺的是：泛型行 + `listTrashedNotes` + 两端接线 + 词条。

- 领域/动作层：新增 `NoteActions.listTrashed()`，判据与任务同形
  （`deletedAt !== undefined && purgedAt === undefined`），序 `byDeletedOrder`。
  **本轮给便签做 `purge` 吗？** ⇒ 做，且**三件套一次配齐**。
  只做"能还原不能彻底删除"会让便签成为一个特例，而特例正是漂移的开始。
- 共享组件：`TrashBoard` 的 `items` 从 `readonly Task[]` 泛化成
  `readonly TrashItem[]`（`{ id, kind, title, deletedAt }`）。
  🔴 **不加 `showCheckbox` 一类的开关**（`packages/ui/src/trash/TrashBoard.tsx:13-25` 的
  契约理由）；改 `items` 类型是 breaking，一次改完两端，不留兼容分支。
  每行带一个 kind 徽标（任务/便签/清单/习惯），徽标文案走词条。
- 两端：Web `TrashView` 与移动端 `TrashScreen` 各并一路数据源；确认弹窗**仍留在宿主**（既有裁决）。
- 词条：`web.trash.intro` / `mobile.trash.intro` 现在写的是"已删除的**任务**"，必须改；
  **中英同步**（`check:ui-language`），且新增 kind 徽标要成对。

**判据**：`apps/web/tests/trash.spec.tsx` 加便签一组（删除后进回收站 / 还原回列表 /
purge 需二次确认 / 还原后 `content` 与 `projectId` 逐字段仍在）；
`packages/app-host/tests/` 加 op 级两引擎对（手机删 → 还原 → 另一台读到）。
**变异**：`restoreNote` 改成"只改本地状态不发 op" ⇒ 两引擎那条必须红。

### W2 · 修「已删除任务的提醒还在弹」（D1）

独立于 W1，且**优先级更高**（这是唯一一个"用户已经做完了决定、系统还在反对他"的问题）。

- 判据落在**投递**这一层，但**修法要选结构性的那一处**：
  `deliverDueReminders`（`apps/web/src/features/reminders/notify.ts:139`）现在只有 `task === undefined`，
  墓碑任务在 map 里**仍然在** ⇒ 照投。🔴 只在 web 补这行等于继续"N 处各自记得"（W8 同一条纪律），
  **正解是 `ReminderActions.due()`**（`packages/app-host/src/reminder-actions.ts:319-321`）
  不把"所属任务已进墓碑"的提醒算成到点 —— 它就在同一个文件里用现成的 `taskOf()`（`:324` 已在用），
  一处改完，web 与"以后真的接上投递的端"同时受益。`notify.ts:139` 那行**也补**，作为第二道闸。
- 顺手修掉 `notify.ts:137-138` 那句与实现相反的注释（这类"注释已经说了对的话、代码没做"
  正是 [§7 第 46 条](../reference/environment-traps.md) 那一族）。
- 🔴 **移动端取证已完成，结论比原假设更糟**（原第 1 条"先取证再动手"现在可以结案）：
  移动端的提醒**只有数据面**，投递路径**从未存在**——三层独立证据：
  ① `due()` 的消费者只有 `apps/web/src/features/reminders/store.ts:154`（+ app-host 自己的测试），移动端零；
  ② 本包自己的 Kotlin 源（`apps/mobile/android/app/src/main/java/` 共 30 个文件）里
  `NotificationManager` / `NotificationCompat` / `reminder` **各 0 命中**；
  ③ `apps/mobile/package.json` 零通知/后台调度依赖。
  ⇒ **D1 今天是 web-only 症状**，W2 的 e2e 判据只证得到 web 那一侧（别把它写成"四端修好了"）。
- ⚠️ 同批照出来的**另一件**（不在 W2 内做，登记为 §6 G-6）：
  `scripts/verify-mobile-reminder-ring.sh` 有 pnpm 入口（`package.json:79`；
  **HEAD 里是 78** —— 这条线号会随别人未提交的行漂移，判读时以串 `verify:mobile-reminder-ring` 为准）、
  并已登记进 `check:journey-coverage` 的**移动端已覆盖入口**（`:130`，注释"提醒到点：OS 通知栏真出现"），
  而它要求 `dumpsys notification` 里出现真通知 —— **与上面三层证据直接矛盾**，它不可能跑绿。
  根因在门禁的形状：`check:journey-coverage` 对登记项只做 `existsSync`（`:351`），
  它证明"有这个文件"，不证明"这个文件会过"。
  `BLOCKED.md` **B33** 已把实现本身记为"要产品负责人拍"（自研薄通知模块 + 两条系统权限），
  所以这条**不是漏做**，是**登记口径比现实乐观** —— 修法见 G-6。

**判据**：一条单测 + 一条真浏览器 e2e（建带提醒任务 → 删除 → 到点 → **数通知条数**）。
🔴 通知计数类判据必须配一条**同趟必然命中**的正向对照（任务未删时确实投了 1 条），
否则"0 条"可能只是投递根本没接上（同族教训：探针坏 / 探针够不着 / 真没发生，三者输出相同）。

### W3 · 归档要有出口（补黑洞 + 给 EVENT 铺路）

- 动作层：`archiveProject` 已有，**新增 `unarchiveProject`**（`UPD { archived: false }`
  —— 注意是 `false` 不是 `null`：`archived` 是布尔语义字段，
  写 `null` 会走"清除字段"、行为相同但**读侧 `!== true` 的判据要一致**，二者选一并在测试里钉死）。
- 界面：清单面板加一个**"显示已归档"开关**；每条已归档项上只给一个动作："取消归档"。
  🔴 **归档不进 rail**（主计划把 rail 默认按钮数钉成 5，多一个就是推翻那条），
  也**不进回收站**（两个面的语义不同：归档=我收起来的、随时回来；回收站=误删找回）。
- 一致性：归档清单**不出现在** 新建任务的目标选择 / 侧栏 / 搜索的活集合里，
  但它下面的任务**仍然照常出现在自己的视图里**（今天就是这个行为，W3 不改它，只补"看得见已归档"）。
  ⚠️ 这条"归档清单里的任务不受影响"是**新写下**的，此前无人裁决（调研 D3）。
- 🔴 **更正（本轮实测否证了本文先前的一句话）**：原文写"`check:reachability` 会**自动**要求
  `unarchiveProject` 有宿主调用点"——**这句不成立**。它的判据 C 是**家族粒度**：
  正则 `\bcreateProjectActions\s*\(`（`:596-603`）扫 `apps/**/src` 里对**工厂函数**的调用，
  而不是逐方法（`ACTION_FAMILIES` 每项只带 `{entity, family}`，见 `:304`）。
  ⇒ 只要任何一个宿主还在调 `createProjectActions(`，**新增的 `unarchiveProject` 零调用点也不会红**。
  "action 写了但没人接"这一半，这道门禁**结构上看不见方法级**。
  ⇒ W3 的调用点要靠**自己的判据**钉：`apps/web/tests/` 里那条"已归档清单能被取消归档"的
  界面用例就是调用点证据（点得到 = 接上了），**不要**把希望寄托在 `check:reachability` 上。
  📌 这条否证要留在计划正文里：它同时是 §8「调研反哺机制」的第二个活样本。
- **动作面沿用现成的行内图标**，本轮**不引入 ⋯ 菜单**。实测：全仓 `onLongPress` **0**、
  `onContextMenu` **0**、`role="menu"` **1**（只有头像菜单）—— 任何实体都还没有二级操作面。
  现成的形状是 `OrganizerList` 行尾那个 `Trash2`（`packages/ui/src/projects/OrganizerList.tsx:275-277`），
  加"归档/取消归档"就是再加一枚同形状的行内图标，**不新建一套跨四端的弹出菜单**。
- 🟢 外部旁证（仓内既有实测，非本次检索）：滴答清单倒数日卡片的长按菜单里
  **「归档」与「删除」是并列的两个动作**
  （[countdown 调研 §7](../research/countdown-anniversary-data-and-images.md):240），
  且它**专门为一篇 FAQ 处理"归档清单里的任务在日历里看不见"**
  ——「如果出现"任务已隐藏，因为日历中未显示所属清单"，该如何恢复？」
  （[帮助中心 IA](../research/dida365-help-center-ia.md):306）。
  ⇒ 上面那条"归档只收容器、不动里面的任务"的裁决**方向与竞品一致**，
  但竞品为此专门写了帮助文档 —— 说明**这件事用户会困惑**，W5 的帮助文档要跟写这一段，不能只改词条。

### W4 · 清单与习惯进回收站（P-1 的后半）

| 实体 | 处置 | 理由 |
|---|---|---|
| `PROJECT` | **进回收站**；删除时确认框显示"里面还有 N 条任务，它们不会被删除" | 重建成本中等、影响面大（任务归属会暂时看不见）；还原后 `projectId` 从未被改 ⇒ 归属**自动恢复** |
| `HABIT` | **进回收站**，且与"删习惯的入口本身"（P2-3）**同批**做 | 今天连删除入口都没接；分开做会出现"能删但找不回"的中间态 |
| `TAG` | 🔴 **不进回收站**，改成单击即删 + **删除确认里写明影响 N 条任务** | 标签的重建成本≈0，进回收站的收益低于多一个状态的成本；但它的**影响面**是真实风险，所以防护放在"删之前告诉你影响多少条"，而不是"删之后给你一个小箱子里翻" |
| `REMINDER` | **不进回收站** | 提醒的删除语义是"取消"，与任务不同 —— 这就是帮助中心 `s1p1` 那句"它们的删除语义和任务不一样"**终于可以兑现**的地方（W0 落 ADR） |
| `FOCUS_SESSION` | **不做删除**（现状连动作都没有）并登记理由 | 它是统计的事实源；能删番茄钟历史等于允许篡改成长数据，与激励体系的三条红线（只与自己比/不发行货币/不制造愧疚）里"历史不许被改写"直接冲突 |

⇒ W4 结束后，`s1p1` 那句文案改成如实描述（清单/习惯进、标签/提醒不进、**各自为什么**）。

### W5 · 两端"彻底删除"措辞对齐 + 帮助文档跟写

Web 确认框补上"这不是物理擦除"那一行（复用移动端 `trash-display.ts` 那个**纯函数**的形状：
界面与测试同源），帮助中心 `site.docs.trash.*` 随之改写。
🔴 受 `check:docs-voice`（禁内部字段名见客：`purgedAt`/`deletedAt`/`SQLite`）与 `check:legal-copy` 执法，
改完必须跑这两道。

### W6 · 回收站的跨设备**真机**验收（补 roadmap:537 那条自认的洞）

```bash
pnpm verify:mobile-trash   # 真模拟器 + 真服务端 + 真笔记本设备，零 mock
```

判据形状（每条都要"点了"和"生效了"分开证）：
① 手机删便签 → **服务端日志出现请求**；② 手机回收站列出它；③ 点还原 → 笔记本读到它活着；
④ 手机删清单 → 笔记本回收站**也**列出它（证明"在回收站"这个事实本身跨设备）；
⑤ 全程不点任何同步按钮（沿用 `verify:mobile-autosync` 的判据 a/b 两腿形状）。
🔴 设备坐标每次现取（§7 第 72 条那个 `--press` 假成功就是在回收站上骗出来的）。

### W7 · 把隐私政策里那句"45 天后会被清理"改成真的（P-4）

调研 §5.3：政策草案 `packages/legal/src/documents/privacy.ts:381,485` 向用户承诺
"承载删除的加密历史记录会在保留期（当前 45 天）届满后被清理掉"，
而调研 §5.2 的五环取证说明：**这条对 heyta 自己账号的数据永远命中 0 条**
—— 清理由"因果全量 op"授权，而我们的客户端从不产生那种 op。

这不是"回收站的一轮"，但它是**回收站无法对外宣称真删**的根因；
而且它现在**尚未生效**（同文件 `:590` 自陈"尚未经法务复核、尚未生效"）
—— 趁还没有用户改掉它，成本是零。

- 三条处置见调研 §5.3。选 ② 或 ③ 是一次纯文案改动（受 `check:legal-copy` 执法，
  中英两版必须同步）；选 ① 则是 G-1 那笔协议工单的量。
- 🔴 无论选哪条，**都要同时检查《个人信息收集清单》与帮助中心有没有抄过同一个 45 天**
  —— 改一处不 sweep 全仓是漂移的标准来源。

### W8 · 把"墓碑不进搜索"从**各调用方记得**改成**结构上做不到**

调研 D9：`packages/domain/src/search.ts:95` 的 `searchTasks` 自己不滤墓碑，
于是泄漏与否取决于调用方递进来什么 —— 而两端递的不一样：
Web 递 `Object.values(store.entities.tasks)`（含墓碑），移动端递 `actions.listTasks()`（已滤）。
**这就是 [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) §34
预警的形状**：它把"回收站"列为 8 条 TASK 读路径之一，原话是"每一处都要各自记得排除一次，
**漏一处的症状是…用户会截图来问的那类问题**"。现在这一处已经漏了。

- 修法放在**领域函数内部**（一处），不在各宿主补过滤：`searchTasks` 开头就要求
  `deletedAt === undefined`（并显式处理 `purgedAt`）。
  在调用方补等于把同一个决定权留在 N 个地方，`OrganizerList`/`QuadrantBoard` 那些
  `aliveOf` 已经证明这条路会漂。
- ⚠️ 要想清楚**副作用**：`apps/mobile/src/screens/TasksScreen.tsx:567` 那句是
  "在当前列表里筛选"，它传进来的是**已经分过组的可见集合**；
  在领域层加过滤对它是**空操作**（不会改变行为），但**不许**反过来为它开例外。
- 🔴 判据要是**结构性的**，不是"我又检查了一遍"：
  ① 单测——把一个带 `deletedAt` 与一个带 `purgedAt` 的任务放进输入，两者都不得出现在结果里；
  ② 变异——把领域层那行过滤删掉 ⇒ ①必须红；
  ③ 可选的更强形状：把入参类型收窄成一个"已过滤"的具名类型，让"递原始表"编译不过。
    这条成本要先量（`packages/ui` 的 `SearchPanel`  props 是 `readonly Task[]`），
    **先按 ①② 交付，③ 作为登记项**，别为它拖住整条。
- 🟢 外部旁证：微软官方文档把"**回收站未编制索引，因此搜索中找不到内容**"当作产品性质写出来
  （[调研 §3.2 A](../research/trash-and-archive-best-practice.md)）。
  我们已经在文案里承诺了同一件事（`s3p3`），只是代码没做到。

### W9 · 把"归档清单不出现在选择面"从**UI 记得**改成**出口层做不到**（D11）

W8 的同一条纪律，落在**归档**这一态上（这是本轮读代码新照出来的，前几轮的计划里没有它）。

实测（全部本轮现量）：全仓 `archived` 的**过滤**只有一处，在 UI 层 ——
`packages/ui/src/projects/model.ts:107`（`aliveProjects`，注释 `:53` 明说"一律**隐藏**归档清单"）。
而**出口层不过滤**：`packages/app-host/src/project-actions.ts:205-207` 的
`listProjects()` 只做 `aliveOf(...)`（= 只滤 `deletedAt`）。它的下游因此**全都看得见归档清单**：

| 出口 | 取证 |
|---|---|
| local-api / MCP | `packages/local-api/src/server.ts:111` 声明、`:360` 直接 `await host.listProjects()` 回给调用方 |
| AI 工具目录 | 走同一批 local-api / app-host 读口（ADR-0035 钉的"共用一份"） |
| node-host CLI | `apps/node-host/src/cli.ts` / `host.ts` |
| 导出 | `packages/app-host/src/export-dump.ts`（**这条是对的** —— 备份必须带归档，别顺手改） |
| 滴答格式导入导出 | `packages/domain/src/ticktick-format.ts` 6 处 `archived`：那是**线格式字段**，不是可见性决定（**同样别顺手改**） |

⇒ 用户把一个清单"收起来"之后，**界面上它没了、助手嘴里它还在**。这类两端说法不一致
正是 ADR-0044 §34 那一族，只是这次的主角是 `archived` 不是 `deletedAt`。
⚠️ **但要把机制与今天的暴露面分开**（第四轮更正，取证见调研 §2.5）：今天**组件层没有"归档"按钮**
（`archiveProject` 只到 web store 为止），而滴答导入对 `archived` **只记进 `report.unmapped`、不落 op**
（`packages/domain/src/ticktick-import.ts:620-627`）⇒ 库里有没有 `archived=true` 的行**未取证**。
所以 W9 **不是"正在发生的用户事故"**，它是**W3 的前置**：W3 一给界面加按钮，这处当天变成用户可见。

- **修法选结构性的那一处**：`listProjects()` 默认滤归档 + **新增 `listArchivedProjects()`**，
  与 `listTasks()` / `listTrashed()`（`actions.ts:339`、`:697`）**同一个形状** ——
  "另一种可见性 = 另一个 list 方法"这件事我们已经有现成先例，不需要发明。
  W3 的"显示已归档"开关因此改成**并两路数据源**，而不是"拿原始表自己滤"。
- ⚠️ **W9 是 W3 的前置**：先加开关再补出口，中间那一档比今天更糟
  （界面已经宣称"收起来了"，AI 还把它当活的推荐给用户）。
- 🔴 **要拍的**：归档清单对 AI/MCP 是"一起滤掉"还是"照实说但标注已归档"（P-9）。
  我的倾向是**默认滤掉**，理由是它必须与界面**同一个口径**，而界面对已归档的态度是"不出现"；
  "如实标注"要新写词条、新改工具描述，且会给 AI 一个用户以为已经不存在的目标。
- **判据**：① 单测 —— 归档一条清单后 `listProjects()` 不含它、`listArchivedProjects()` **只**含它；
  ② 出口层 —— 经 local-api 读清单列表时不得出现那条归档的（正向对照：未归档那条必须在）；
  ③ 变异 —— 把 `listProjects()` 里那行过滤删掉 ⇒ ①②都必红。
  🔴 ②的**正向对照腿不许省**：`server.ts` 这条路上"0 命中"同样可能是根本没接通
  （§7 元规则 1：探针坏 / 够不着 / 真没有，三者输出相同）。

---

## 3. W0 · 把 §6 那九条抬成一份 ADR（本计划唯一"文档即交付"的工单）

🔴 **编号说明**：本文原先写的 `ADR-0046` **已被占用** —— 2026-10-03 并行会话在工作树里新增了
`0046-lossless-vector-clock-frontiers.md`（取代 ADR-0008 的时钟裁剪）与
`0047-checkpointed-incremental-hydration.md`（**状态已写"已接受"**，但两份文件与
`packages/storage/src/checkpoint.ts` 都**尚未入库**：`git log -- <那两个路径>` 无输出、
死链门禁把它们报成"本机有、仓库里没有"）。
⇒ 本工单落 **ADR-0048**，且**开工前必须重新现量** `ls docs/adr/ | sort | tail` ——
按工作树取号，不按本文写死的号。

- **标题**：`ADR-0048：删除的四态语义，与"彻底删除不是物理擦除"的边界`
- 必须包含的结论（否则它不配当 ADR）：
  1. 四态定义 + §1 的 **I1–I5**；
  2. **回收站不收哪些实体，以及"为什么不收"是语义差异而不是排期**（回答 `s1p1` 那句承诺）；
  3. **不设自动保留期**，理由按 §1.5 三条写全，并写明**终点**：
     因果全量边界（checkpoint/REPAIR）+ 客户端 op-log 压缩落地之日，才允许重新讨论 TTL；
  4. **物理擦除的两个候选路径**（定向删除 vs 逐实体密钥封装）与"两者都不是回收站一轮能带走的"；
  5. 明确**否决**过的方案：清 `deletedAt`、写 `deleted: false` 布尔、服务端 TTL、
     加密擦除的"顺手版"（复用账号级密钥做不出逐记录擦除，见调研 §5.4）。
  6. **一条新的规则**（现在没有、D9 证明它必需）：**"已删除条目对所有读路径不可见"由领域层负责，
     不由各宿主调用点各自记得**。理由就是 [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) §34
     那句话（回收站是 8 条 TASK 读路径之一）＋ 实测后果：Web 搜索已经漏了、移动端没漏。
  7. 🔴 **同一条规则要覆盖 `archived`**（W9 / I5，本轮新添）：归档的隐藏归**动作层的 list 分裂**，
     界面开关是"显式取第二路数据"而不是"关掉过滤"。
     必须写进 ADR 的理由：今天唯一那处过滤在 `packages/ui`（`projects/model.ts:107`），
     而**共享 UI 不是安全边界** —— 它管得住界面，管不住 local-api/MCP、AI、CLI 与任何未来的非 UI 消费者。
  8. **壳级门面的边界**（§2.0 / G-7）：`native-bridge.ts` 的门面**没有** `restore`/`purge`/`listTrashed`，
     `removeTask` 只发软删 ⇒ ADR 要写明"走壳级路径的端当前**不提供误删恢复**"是**边界**而不是缺陷，
     以及它要由谁在哪一轮闭合。
- 骨架照 [ADR-0023](../adr/0023-managed-ai-quota-not-implemented.md) /
  [ADR-0026](../adr/0026-refund-side-entitlement-revocation-not-implemented.md)：
  "不做"要写成**有终点的决定**（§5 最小实现清单），并**如实声明有没有配套门禁**
  （ADR-0026 承认自己没门禁，那是诚实而不是缺陷）。
- 状态：**P-1…P-9 已于 2026-10-03 拍板（§7.1）⇒ 本工单现在可以开工**，ADR 直接按"已接受"写。
  ⚠️ **两处例外要留口子**：① 涉及隐私政策那句的第 3 条结论（P-4）要标"法务口径待最后确认"，
  因为产品负责人是靠"其他按你的建议"覆盖的、没逐字拍；② 编号必须**开工那一刻**重新现量
  （`ls docs/adr | sort | tail`，按工作树取号）。

---

## 3.5 开工前置条件（全部本轮现量，附复跑命令）

这一段不是仪式：本轮**四条**工单要在界面上加东西，而仓库里**两道棘轮的余量正好是 0**，
先读它们才不会在第一步就被"消掉净增"打回。

| # | 前置 | 本轮实测读数 | 对工单的约束 |
|---|---|---|---|
| **C-1** | 内联样式只减不增 | `node scripts/check-l4-no-style.mjs` ⇒ **web 98 ≤ 基线 104**（余量 6）；🔴 **mobile 90 = 基线 90，余量 0** | 新的**形状**要落在 `packages/ui`（W1 的 kind 徽标、W4 的行），**不许**往 `apps/mobile/src/screens` 加 `style={{`。真要加，同屏先消掉一处（"消掉净增"是本项目验证过的打法，见样式三道门禁那条线债的记录） |
| **C-2** | `ht-*` 顶层前缀族只减不增 | `node scripts/check-row-single-source.mjs` ⇒ **28 = 基线 28，余量 0**；🔴 且它自 2026-10-02 起**连 `apps/web/src/styles/app/*.css` 一起扫**（脚本 `:356-363`）—— 本轮一度以为 `.ht-trash` 不在账上（只 grep 了 `app.css`），实测它**正是**第 26 个族 | 回收站的新样式只能用 **`.ht-trash__*` 子元素**（提取式 `^\.ht-[a-z]+` 抓不到 `__` 段 ⇒ 子元素不新增族）；**新增任何顶层 `.ht-` 块 = 直接红** |
| **C-3** | 空态站点登记只减不增 | `node scripts/check-empty-state.mjs` ⇒ 三道断言**当前全绿**；而回收站两端**仍挂在债账上**（`scripts/check-empty-state.mjs:337` `TrashScreen.tsx`、`:388` `TrashView.tsx`） | W1/W6 的新面板**不许新增空态站点**：用自闭合的 `<EmptyState/>`，并且**把它原有的 `data-testid` 传给 `testID`**（脚本自己写了：否则定位钩子与登记项**同时**静默消失） |
| **C-4** | 词条口径先统一 | `common.entity.NOTE` / `mobile.entity.NOTE` 都译作「**笔记**」（`packages/i18n/src/locales/zh-CN.ts:2699,3651`），而界面通篇是「**便签**」（同文件 25 处含"便签"、代码侧 246 处提及） | 🔴 W1 的 kind 徽标**正是**消费实体名词条的地方 ⇒ 不先统一就会在同一行里出现"便签（笔记）"两种叫法。`check:ui-language` **拦不住**这种漂移（它管裸值，不管两个都合规的说法）→ 见 **P-6** |
| **C-5** | 验收载体 | `scripts/lib/sync-windows-sources.sh:42-44` 打的是**工作树**（`git ls-files` + `git ls-files --others --exclude-standard`） | 🔴 `pnpm reinstall:all` **必须在隔离检出里跑**：混合工作树下那条"远端字节 == 本地工作树"的对账会**忠实地**把别人的未提交源码当成当前产物打进 Windows 包，并且**判绿** |
| **C-6** | 错峰 | W1/W2/W9 同时碰 `packages/ui` + `apps/web` + `apps/mobile` | 按 `AGENTS.md` §6.1.1 与并行会话错峰；**不碰 `packages/op-log`**（§6 G-4/G-5） |

---

## 4. 门禁与判据总账

| 面 | 用哪道现成的 | 要新写什么 |
|---|---|---|
| 新 action 必须有调用点 | 🔴 **`check:reachability` 帮不上** —— 判据 C 是**家族粒度**（`\bcreateXxxActions\s*\(`，`:596-603`），方法级"写了没人接"它结构上看不见；且只扫 `apps/*/src` 的 `.ts`（`:313-316`），Swift/C#/C/ArkTS 不在范围内 | **每条加工单自己的界面/CLI 判据**（W3、W9 已各写一条）。是否另建方法级判据 = **P-8** |
| 新移动屏订阅同步信号 | `check:materialized-reads` | 无 |
| 文案中英成对 / 界面不许裸值 | `check:ui-language`、`check:design`、`check:l4`（内联样式**只减不增**）、`check:row-single-source` | 无 |
| 空态只有一个实现 | `check:empty-state`（回收站两端各已记一笔债；本轮**消掉**而不是新增） | 无 |
| 公开文案不许出现内部字段名 | `check:docs-voice`、`check:legal-copy` | 无 |
| **I2 还原回到归档态** | 无 | 新单测 + 变异（restore 里顺手重置 `archived` ⇒ 红） |
| **I3 归档不许借用 deletedAt** | 无 | 变异判据（照 countdown 的形状：把归档实现成改 `deletedAt` ⇒ 红） |
| **W2 通知不投已删任务** | 无 | 单测 + e2e（带正向对照腿）。🔴 修法主闸在 `reminder-actions.due()`（见 W2），`notify.ts:139` 补第二道；**e2e 只证 web 那一侧**（移动端无投递，W2 三层证据） |
| **W9 归档清单不进任何出口** | 无 | ① `listProjects()` 不含归档 / `listArchivedProjects()` 只含归档；② 经 local-api 读清单不得出现归档那条（**带正向对照腿**）；③ 变异：删掉那行过滤 ⇒ ①② 必红 |
| **W8 搜索不返回墓碑** | 无 | 单测（带 `deletedAt` 与 `purgedAt` 的两条输入都不得出现）+ 变异（删掉领域层那行过滤 ⇒ 红）。🔴 **判据要落在领域函数上**，落在宿主调用点上等于继续"N 处各自记得" |
| 跨设备收敛 | 无 | `verify:mobile-trash`（W6） |
| **新脚本不许变成"没人跑的脚本"** | `check:journey-coverage` | 🔴 **更正**：它对新脚本**什么也不判** —— `REGISTERED_GAPS` 是"这一端还没做旅程验收"的**账**，不是脚本账；W6 的脚本一旦存在就自动被算成"入口"（`:351` 只做 `existsSync`）。⇒ 登记进 `ENDPOINTS` 时**必须同批留下一条跑绿读数**（脚本自己打印的 `summary` 行 + 日期），否则它会变成 `verify-mobile-reminder-ring.sh` 那种形状：**登记为已覆盖、却与代码矛盾、且不可能跑绿**（§6 G-6） |

🔴 一条通用要求：**每条新判据都要做一次"能不能失败"的实测**（`AGENTS.md` §8 第 3 条）。
不能失败的检查没有价值 —— 这条纪律在许可证门禁上曾经坏过一次，且坏得很典型。

---

## 5. 明确不做 / 后置（每条带理由，不写"暂不支持"）

| 不做 | 理由 | 重启条件 |
|---|---|---|
| 回收站自动过期（TTL） | §1.5 三条 | ADR-0048 的终点条款 |
| 物理擦除 / 合规"删干净" | 需要因果全量边界或逐实体密钥，两者都是协议变更 | 见 §6 G-1 |
| 撤销 toast 体系 | 全仓没有撤销机制，新建一套（浮层 + 定时 + 焦点 + 各端返回键）不是回收站的一轮；回收站已经承担"找回"这件事 | 若 W1–W4 上线后仍有"删了但回收站里翻不到"的真实反馈 |
| 回收站计数徽标 | **已有裁决**：`bec7e16b` 判定"挂 N 件可找回是我们自己加的产品语义，不是对齐参照图" | 有人推翻那条误诊 |
| 批量彻底删除 | 一次确认落多条 op 违反 §3.4 的"一个意图一个 op"；且我们删不掉任何东西，"批量清回收站"卖的是错觉 | 同上 |
| 给 AI/MCP 开 `remove_*`/`purge_*` 工具 | **MCP/local-api 目录本轮现量 6 个**（`packages/local-api/src/tools.ts:94` 起的数组：3 读 3 写 —— `list_tasks` / `get_task` / `list_projects` / `create_task` / `update_task` / `complete_task`），**一个删除动作都没有**。⚠️ 内置 AI 助手的能力目录是**另一本账**（要引数字就 `pnpm check:ai-coverage` 现量，别把两本混着写）。开删除工具是**从零到一的新写入口**，要过 `check:ai-tools`、逐工具授权、出境字段披露、默认 `defaultEnabled: false` 四道闸，且 ADR-0045 钉了"读放开、写不放开" | 单独一轮，随 `purge` 的语义稳定之后 |
| 归档嵌套（清单文件夹的归档） | `parentId` 只支持一层，归档态传播规则**从未裁决** | 有人要这个功能时 |
| 三个原生壳的**壳级**回收站 | Linux 壳没有 web-dist 装载路径、Electron 载自己的 `renderer-dist` 且 `trash` 0 命中、鸿蒙无壳；mac/Windows 的回收站来自 `web-dist`（§2.0 那张表）⇒ **本轮不为它们新写任何界面**，那属于"共享 UI 落到原生壳"那条更大的线（主计划 §4.3） | 有人要桌面端壳级功能时 |
| 移动端 OS 提醒投递 | 代码三层证据显示**从未实现**（W2），而 `BLOCKED.md` **B33** 已把它拍成"要产品负责人决定：自研薄通知模块 + `POST_NOTIFICATIONS`/精确闹钟两条系统权限"。**这不是回收站的一轮** | 同 B33：产品负责人拍了那条实现路径 |

---

## 6. 已知边界与后置债（登记，不假装解决了）

- **G-1 因果全量边界缺失**（调研 §4.3 / §5.2）：它同时挡住 ① 服务端保留清理生效、
  ② 客户端 op-log 压缩（磁盘回收）、③ 任何形式的真删、④ 长期离线设备回来后的可信重建
  （`gapDetected` 服务端在算、客户端 `planDownloadGapReset()` 已写好、**零消费者**）。
  🔴 这是一次协议工单的量（涉及 vendored `sync-core`，改它要更新 `PROVENANCE.md`），
  **不在本计划内**，但本计划的"不做 TTL"结论以它为前提，所以必须写在同一处。
  ⚠️ **2026-10-03 更新**：**② 这一半已经被并行会话拍成 ADR-0047**
  （`MaterializedCheckpoint` + checksum + "`archiveUpTo()` 在没有有效 checkpoint 时拒绝执行"；
  文件与 `packages/storage/src/checkpoint.ts` **都还没入库**）。
  🔴 但 0047 定的是**本地**物化边界，**不产生线上的因果全量 op** ⇒
  **① 与 ③ 仍然开着**（复核：`app-host`/`sync-client`/`apps` 里 `SYNC_IMPORT|BACKUP_IMPORT` 仍 0 命中）。
  本计划"不做 TTL"的前提是①③，**不是②**，所以 0047 落地不会让这条结论松动。
- **G-2 回收站无分页/无上限**：`listTrashed` 是全量内存过滤 + 排序，真实数据量下未测。
- **G-3 删父任务与子任务**：现状"提到顶级显示"，还原不带回 —— 行为可辩护但**从未裁决**（调研 D2）。
  W4 若把清单纳入回收站，会第一次真正撞上"归属的恢复"，届时要么补裁决要么显式接受现状。
- **G-4 墓碑字段屏蔽语义正在被并行会话改**（调研 §2.7）：若它落地，
  回收站显示标题要改从 op 历史取。**本计划不等它**，但 W1 的判据必须断"标题在"，
  这样那条改动一旦合入会把这件事照成红，而不是无声过去。
- **G-5 共享工作树**：本计划的 W1/W2 会同时碰 `packages/ui`、`apps/web`、`apps/mobile`。
  开工前按 §6.1.1 与并行会话约定错峰；**不碰 `packages/op-log`**。
- **G-6 一条"登记为已覆盖、却不可能跑绿"的验收**（本轮新照出，取证见 W2）：
  `scripts/verify-mobile-reminder-ring.sh` 要求 `dumpsys notification` 出现真通知、
  且 `force-stop` 后 `dumpsys alarm` 仍持有本包调度（脚本尾部两条 `ok/bad`），
  而移动端**没有任何投递实现**（三层证据）⇒ 它**结构上跑不过**。
  它同时在 `check:journey-coverage` 的移动端 `ENDPOINTS.scripts` 里被列为已覆盖入口（`:130`），
  而那道门禁对脚本只做 `existsSync`（`:351`）—— 门禁绿与脚本会红**可以同时成立**。
  🔴 两种修法都要人碰一下：① 把那条注释改成如实描述（"脚本存在、投递未实现，见 B33"）并**移出**已覆盖清单；
  ② 给 `check:journey-coverage` 加"入口登记必须带最近一次跑绿读数"的形状要求。
  **本计划不顺手改它**（它不属于回收站，属于那条提醒投递线），但必须留在这里 ——
  否则下一轮又会把它当成"已验收"。
- **G-7 壳级窄门面"能删不能找回"**（§2.0 实测）：`packages/app-host/src/native-bridge.ts`
  的导出全集是 `open / listTasks / listTaskEntities / addTask / setTaskDone / removeTask / clientId / openOpLog / close`，
  其中 `removeTask`（`:273-277`）**只发软删**，没有 `restore` / `purge` / `listTrashed`。
  ⇒ 走壳级路径的那两端（Linux 壳、以及未来真起来的鸿蒙壳）**误删即不可恢复**；
  mac/Windows 靠 `web-dist` 的 app 模式躲过了这一档。修法要么补门面（一次协议级的小扩展，
  改它要同步 `AGENTS.md` §2 那行的"5 条能力"），要么让壳只做 app 模式。
  🔴 不在本轮：门面每加一个方法，Swift/C 两侧要各接一次，而**两道门禁都看不见那两个目录**（§2.0）。
- **G-8 任务侧 `restore` / `purge` 的 `void` 契约丢了"没做成"这个信号**
  （`actions.ts:172`、`:189`；文档自己写着"本来就没被删除时不发 op" `:169-171`）。
  P-5 拍了保留便签那种 `boolean` 之后，这一条就是剩下的那一半：改它要同时动
  `apps/web/src/features/tasks/store.ts` 与 `apps/mobile/src/screens/TrashScreen.tsx:150` 两个调用方，
  **登记为下一批**，不在本轮顺手改（一个动作两种契约比一个契约两种动作更难解释）。
- **G-9 方法级"写了没人接"的存量清单**（P-8 的账，🔴 **已按逐条定性重写**）：
  探针读数：app-host 的动作接口共 **68 个方法**，`apps/*/src` + `packages/ui/src` 里零 `.method(` 命中的是
  **HEAD 9 条 / 活树 8 条**（差的那一条是 `updateNoteContent` —— 并行会话**正在**接它，见下）。
  ⚠️ **"零消费者"不是一种状态而是四种**，把它们合成一条账就会把交接做错（本轮实测到第 8 条时就被这个坑咬了一次）：

  | 方法 | 定性 | 依据与处置 |
  |---|---|---|
  | `NoteActions.updateNoteContent` | 🟡 **正在被别人接** | 工作树 `apps/web/src/features/notes/store.ts:86` 已调它，而 **HEAD 那份没有**（`git show HEAD:… \| grep -c` = 0，且该文件是 ` M` 未提交）⇒ **交接书里不许把它列成待做项**，否则会跟别人撞同一刀 |
  | `NoteActions.restoreNote` | ✅ **本轮的活** | W1（便签进回收站）就是接它 |
  | `NoteActions.setNoteProject` / `notesOf` / `highlightedNotes` | 🔵 **各自是独立产品缺口** | 全仓 `pinnedToToday` 与 `projectId` 在便签界面里**零命中** ⇒ 缺的是"便签归入清单"与"按清单/今日分组"两个界面能力（注释还专门要求"界面上的今日便签分组直接用它，不要自己 filter"，`note-actions.ts:94-95`）⇒ 交接书 D 组，且**正撞在别人那批文件上** |
  | `ReminderActions.markReminderFired` | 🔴 **它是缺陷 D14 的根因，不是"顺便加功能"** | `dueReminders` 靠 `firedAt` 判"还没投递"（`packages/domain/src/reminders.ts:130-131,123`），而**没有任何一方写 `firedAt`** ⇒ web 侧唯一去重是 `useRef(new Set())`（`use-reminder-notifications.ts:48`）：刷新页面后、以及**另一台设备上**，同一条到点提醒会**再弹一次** ⇒ 归进交接书 **A 组**（与 W2 同刀） |
  | `ReminderActions.rescheduleReminder` / `undoDismissReminder` | 🔵 独立缺口 | 提醒面板只有 snooze / dismiss（`ReminderPanel.tsx:124-125,176-179`），**没有改时刻**（要改只能删了重建）、"不再提醒"**撤不回来** ⇒ 交接书 D 组 |
  | `ReminderActions.rescheduleForRepeat` | ⛔ **多余的门面，不是缺口** | 能力早已由抽出来的函数接上：`packages/app-host/src/actions.ts:439` 调 `rescheduleRemindersForRepeat(...)`（同文件 `:61` import），而 `site-and-parity-alignment.md:384` B2-3 记的就是这件事 ⇒ **正确处置是删掉这个方法**（`AGENTS.md` §8：确定没人用就彻底删），**给它找调用点 = 造第二条写路径**，违反 §3.4"一个意图一个 op" |

  复跑（这就是本轮用的探针）：遍历 `packages/app-host/src/**.ts` 里 `export interface *Actions { … }` 块的方法名，
  再在 `apps/**` + `packages/ui/src`（排除 `tests/`、`*.spec.*`、`dist*`）里找 `\.方法名\s*\(`。
  🔴 **必须跑两次并都记下来**：一次对**活树**、一次对 **HEAD**（`git grep -l "<方法名>" HEAD -- apps packages/ui`）。
  只对活树跑 ⇒ 数字是别人在飞的瞬时读数（本轮 9→8 就是这么变的）；只对 HEAD 跑 ⇒ 会列出别人已经做完的活。
  ⚠️ 它还**只证"没有 `.method(` 形式的调用"**：解构（`const { restoreNote } = actions`）与动态派发看不见，
  而**能力可能由同包的另一个导出实现**（`rescheduleForRepeat` 那一格就是）⇒
  每一条在写进交接之前都要像上表那样**逐条 grep 裸方法名 + 读被调方本体**定性，探针单独不构成结论。

---

## 7. 待拍板（9 条，都不是代码能解决的）

| # | 决策 | 我的倾向 | 拍错的方向 |
|---|---|---|---|
| **P-1** | 回收站覆盖范围 | **任务 + 便签 + 清单 + 习惯**进；标签/提醒/专注记录不进。🟢 外部旁证支持"清单该进"：Todoist 恰恰**没有**项目回收站，官方补救是"新建项目 + 导入自动备份"（[调研 §3.2 B](../research/trash-and-archive-best-practice.md)）—— 那是我们要避开的形态，不是要对齐的规格 | 想"全都收"会把标签的多米诺拖进同一个面，收益不抵状态数翻倍 |
| **P-2** | 是否设自动保留期 | **不设**（§1.5） | 设了会立刻得到一个无法兑现的承诺 —— 我们根本没有物理删除能力 |
| **P-3** | 已归档内容放在哪 | 清单面板内的"显示已归档"开关，**不加第六个 rail 按钮**、不进回收站 | 放 rail 推翻主计划钉过的默认按钮数；放回收站混淆两种完全不同的用户意图 |
| **P-4** | 政策里那个"45 天"怎么办（W7） | 改文案（处置 ②）—— 在因果全量边界落地之前，**不许留一句验证会失败的承诺** | 留着不改：文档一旦生效就是可被监管核验且核验不过的陈述；或顺手把 G-1 那笔协议工单塞进本轮 |
| **P-5** | 还原的**返回契约**两种并存怎么办 | 🔴 保留便签那种 `Promise<boolean>`，**不要**为了"与任务同形"把它降级成 `void`。实测：`restoreNote` 是诚实的（`note-actions.ts:201-215`，找不到/没删过 ⇒ `false`），而任务侧 `restore(entityId): Promise<void>` 的文档自己写着"本来就没被删除时**不发 op**"（`actions.ts:169-171`）—— **void 才是信息丢失的那一个**。**建议**：W1 用 boolean 交付，任务侧补 boolean 登记成 G-8（改它会动 web store 与移动端 `TrashScreen.tsx:150` 两个调用点，不属于"顺手"） | 把 boolean 当成"和任务不一致"抹掉 ⇒ 唯一一处会说"我没做成"的信号消失，界面退回"点了没反应"那一类 |
| **P-6** | 同一个实体两个名字（C-4） | 统一成「**便签**」：改 `common.entity.NOTE`（`zh-CN.ts:3651`）与 `mobile.entity.NOTE`（`:2699`）两条，**中英成对**（`en` 侧 `Note` 不用动）。界面既成事实是 25 处"便签"、代码侧 246 处提及，而实体名词条是"笔记" | 反过来把界面全改成"笔记"（改动面大得多，且 `web.search.notesSection` 等一串已上线词条跟着漂）；或**不统一**直接在回收站徽标里用实体名词条 ⇒ 同一行里两种叫法 |
| **P-7** | `unarchive` 写 `false` 还是 `null` | 写 **`null`**，并把"读侧一律 `!== true`"钉进 I3 判据。理由：清字段写 `null` 是本项目已有纪律（`restoreNote` 的 `deletedAt: null` 注释 `:210-211` 写清了为什么不能写 `undefined`）；而读侧已经用 `archived !== true`（`packages/ui/src/projects/model.ts:107`）⇒ **两种写法今天等价**，正因等价才必须选一个并钉死，否则下一处读侧会随机挑 | 任选其一但不写判据 ⇒ "等价"只在这一天成立；`false` 会让字段永久留在 payload 里，与"可加性标记"的方向相反 |
| **P-8** | 要不要新建**方法级**可达性判据 | 本轮**不建**，但把存量清单落进文档（G-9）并附复跑命令。实测读数：app-host 的动作接口共 **68 个方法**，其中 **9 个在 `apps/*/src` + `packages/ui/src` 里零 `.method(` 命中**（5 条在 `NoteActions`、4 条在 `ReminderActions`，全部只被自己的测试消费）。⇒ 建门禁的**第一天就是 9 红**，而那 9 条里只有 `restoreNote` 属于本轮（W1 会接上它）。真实取舍是"要不要为另外 8 条同时补界面" —— 那是便签模块与重复任务顺延那两条线的事 | 建了门禁再逐条加 `// reachability: ignore` ⇒ 把"没人接"变成合法状态，比不建更糟 |
| **P-9** | 归档清单对 AI/MCP 要"滤"还是"如实标注"（W9） | **默认滤掉**（与界面同一口径）。"如实标注"要新写工具描述与词条，且会把用户以为已不存在的目标重新摆到助手面前 | 保持现状（界面藏、出口露）⇒ 两端说法不一致，正是 ADR-0044 §34 那一族 |


### 7.1 ✅ 拍板记录（2026-10-03，产品负责人口头拍，转写如下）

| # | 结论 | 他是怎么说的（口语原话按字记） |
|---|---|---|
| **P-1** | **采纳**：任务 + 便签 + 清单 + 习惯进；标签 / 提醒 / 番茄钟记录不进 | 「便签清单和习惯都可以收…提醒确实…番茄钟记录是不留的」 |
| **P-2** | **采纳**：不做自动保留期 | 「N 天后自动彻底删除是没有必要去做的」 |
| **P-3** | **采纳**：清单面板内"显示已归档"开关，不加 rail 按钮、不进回收站 | 「归档的东西就是显示已归档」 |
| **P-4** | **采纳处置 ②**（把政策改成如实描述） | 🔴 **这条他没有逐字说**，是"其他的按照你的建议来吧"那句覆盖的 ⇒ 因为它是**法务口径**，落到文字之前建议再确认一次（`check:legal-copy` 那一步会把中英两版一起拦住，改错了不会静默上线） |
| **P-5** | **采纳**：保留"会回答成/不成"的那种契约，任务侧下一批补 | 「我觉得应该会回答，还原没成功还是没成功」 |
| **P-6** | **采纳**：统一叫「便签」 | 「可以统一叫变迁」——**转写错字，按「便签」理解**；如果他本意是别的词，这条要重拍 |
| **P-7** | **采纳**：解档写 `null` + 读侧一律 `!== true` 钉死 |  blanket「其他按建议」 |
| **P-8** | **采纳**：**不新建**方法级可达性门禁 | blanket「其他按建议」；另见下面"他额外授权的那件" |
| **P-9** | **采纳**：归档清单对 AI / MCP / CLI **一起藏**（默认滤） | blanket「其他按建议」 |

🟢 **他额外授权了一件**（不在原 9 条里）：「顺便要做的那些功能的话，你可以把它做了，没关系」
—— 指的是 §6 G-9 那批"动作写了但没人接"的方法。本轮的处置写进
[执行交接书](trash-and-archive-execution-brief.md) 的 **D 组**，其中三条要点先说清：

- 🔴 `markReminderFired` 不是"顺便加个功能"，它是**缺陷 D14 的修复**（已投递的提醒从没落库 ⇒
  刷新页面或换一台设备会把同一条提醒**再弹一次**）⇒ 归进 A 组一起做。
- `rescheduleForRepeat` 是**多余的门面**，不是缺口：能力早就由抽出来的
  `rescheduleRemindersForRepeat` 在生产里接上了（`packages/app-host/src/actions.ts:439`）
  ⇒ 正确处置是**删掉这个方法**（`AGENTS.md` §8：确定没人用就彻底删），**不是**给它找调用点。
- 便签那三条（`setNoteProject` / `notesOf` / `highlightedNotes`）与提醒的改时刻/撤销关闭，
  是**各自独立的产品缺口**（归属分组、今日分组、改时间只能删了重建、"不再提醒"撤不回来），
  不是同一刀；且**前三条正撞在并行会话此刻在改的文件上**（见交接书 §2 现场门）。

三条同属"界面/文书在说谎"那一类（前两条正在对已发生的事说谎，后一条对将要发生的事说谎），
且各自都是独立小改动；W1（便签）→ W5（措辞）可并行；
**已拍完之后（§7.1）的顺序**：**W2（通知，含 D14 的重复投递修复）、W8（搜索泄漏）与 W7（政策文案）最先做** ——
三条同属"界面/文书在说谎"那一类（前两条正在对已发生的事说谎，后一条对将要发生的事说谎），
且各自都是独立小改动；W1（便签）→ W5（措辞）可并行；
🔴 **W9 与 W3 同批、且 W9 在前**（W9 单独看是"预防"，看 W3 的依赖就是**硬前置**：
先加界面按钮再补出口，中间那一档比今天更糟 —— 见 ⑤ 第 3 条的定性）；
W3（归档出口）**必须先于 EVENT 批次二**；W4（清单/习惯）量最大放最后。
每批结束跑 `pnpm check` + 相关 `verify:*` + `pnpm reinstall:all`
（🔴 按 C-5：**在隔离检出里跑**），并按 §2.0 那张表逐格确认"这轮真的落到了哪几端"，
**不许把"四端都装上当前产物"当成结论** —— 那一轮的结论是表里被填了的那几格。

---

## 8. 调研是怎么反哺进这份计划的（机制，不是口号）

这份计划在同一天里被自己的调研**改写了三轮**：第一轮立起 W0–W8，第二轮折入可见性对账，
第四轮（"再认真读一遍现有代码"那一轮）新增 **W9 + §2.0 + §3.5 + I5 + G-6/G-7/G-8/G-9 + P-5…P-9**，
并且**否证了它自己写下的三句话**（⑤ 那一节，原句都留在原地）。
下一轮读它的人（包括 agent）照下面这五种去向检查自己的调研，就能避免"读了但没改"。

| 去向 | 判据 | 本轮的真实样本 |
|---|---|---|
| **① 变成工单** | 症状是用户看得见的（**或机制已成立、入口在即**），且修法在既有边界内 | **W8**（Web 搜索返回墓碑，今天就在漏）、**W9**（本轮读代码新照出来的：`archived` 只在 `packages/ui/src/projects/model.ts:107` 滤，出口层 `project-actions.ts:205-207` 不滤；⚠️ 它**今天还没有用户能踩到**，定性见 ⑤ 第 3 条） |
| **② 变成"不做 + 重启条件"** | 做它需要协议级前置 | **§1.5 不做 TTL**、**§5 的"移动端 OS 提醒投递"**（B33 要人拍） |
| **③ 变成判据 / 门禁措辞** | 调研发现某道门禁**结构上**看不见这件事 | §4 第一行从"无需新门禁"改成 🔴**这道门禁帮不上**（`check:reachability` 家族粒度 `:596-603`）；`check:journey-coverage` 那行改成"只做 `existsSync`，登记≠跑绿"（`:351`） |
| **④ 变成带复跑命令的基线** | 数字会被引用第二次以上 | **C-1/C-2/C-3** 的 90/90、28/28、25 vs 246；**G-9** 的 68/9 清单连探针逻辑一起写进正文 |

🔴 **还有一种必须写下来的去向：⑤ 调研否证了计划自己的句子 —— 要原地更正并留原句。**
本轮三处（都不是小事）：

1. W3 原写"`check:reachability` 会**自动**要求 `unarchiveProject` 有宿主调用点"。
   **否证**：判据 C 的正则是 `\bcreateProjectActions\s*\(`，扫的是**工厂函数**在 `apps/*/src` 的调用，
   方法级零调用点不会红。原句留在 W3 正文里划掉式更正，因为**它是那种"读起来像保障"的句子** ——
   只删掉它，下一个人会重新写一遍。
2. 本文先前（以及我在对话里的口头结论）说 `verify-mobile-reminder-ring.sh`
   "**没有 pnpm 入口**"。**否证**：`package.json:79` 有 `verify:mobile-reminder-ring`，
   而且它还在 `check:journey-coverage` 的移动端已覆盖入口里（`:130`）。
   ⇒ 结论**更严重而不是更轻**：一条不可能的判据被登记成"已覆盖"（G-6）。
   📌 这条按老规矩留在原地：**"没有 X"这类断言的保质期取决于别人什么时候补上它**，
   所以它旁边必须写核对日期与取证行号。
3. §0 第 3 行与调研 §2.5 先前都写着归档"**零 UI 调用点**"。**部分否证**：web store 其实**已经转发**了
   （`apps/web/src/features/projects/store.ts:75-76`），缺的是**组件层调用点**；
   同时"归档一条清单 = 数据进黑洞"**今天还没有用户能踩到** —— 滴答导入对 `archived`
   只记进 `report.unmapped`、不落 op（`packages/domain/src/ticktick-import.ts:620-627`），
   所以库里是否有 `archived=true` 的行**未取证**。
   ⇒ 这条更正**削弱了 W9 的紧迫性、但没有削弱 W9**：它的定位从"正在说谎的界面"降为
   "**W3 一加按钮就当周会开始说谎**"，所以 §7 末尾的开工顺序把它排在 W3 **之前**而不是与 W2/W8 同批。
   📌 一般规律：**"store 有转发"与"界面点得到"是两件事**，把它们写成一句会同时高估入口、低估出口。

⚠️ **一条方法论**（本轮第 N 次撞上，值得固定）：
"全仓 grep 某符号 0 命中"从来不是结论，**"扫了哪些目录、哪些扩展名、按什么形状匹配"才是**。
本轮三个 0 命中里有一个是假的（`.ht-trash` 不在 `app.css` —— 但 2026-10-02 起 CSS 已拆进
`app/*.css`，门禁两个目录都扫，实测它就是第 26 个族）；另两个是**真的但范围不同**
（Swift/C#/C 不在 `check:reachability` 眼里；`native-bridge` 门面里确实没有 `restore`）。
⇒ 所以 §2.0 那张表把每格的**取证行号**写全：读的人不必信我，重跑一遍就行。
---

## 9. 批次 A 执行账（2026-10-03，本会话亲跑；每条带命令与读数）

交接书原本要交给别的 agent 跑；产品负责人改口「由你来执行」⇒ 批次 A 四条**本轮已落**。
这一节是交付账，不是计划的第 N 次复述：**只写跑出来的读数和没跑的部分**。

| 工单 | 落点 | 判据读数 | 变异读数（摘掉修复 ⇒ 谁红） |
|---|---|---|---|
| **A1 = W8 的一半** | `packages/domain/src/search.ts` 的 `searchTasks()` 内部先过 `aliveTasks`（复用 `task-filter.ts:76`，**不在调用方补**） | `packages/domain/tests/search.spec.ts` **22 passed**（新增 3 条：命中查询的回收站/已彻底删除都不出现、**空查询那条分支同样不出现**、已完成仍搜得到）；`pnpm --filter @heyta/domain exec vitest run` ⇒ **31 文件 / 841 passed** | MUTANT-1 摘掉整道 `aliveTasks` ⇒ **恰好 3 红**；MUTANT-2 只把早退分支改回 `return [...tasks]` ⇒ **恰好 1 红**（证明第二条腿独立有牙）；MUTANT-3 同变异喂给**宿主级** `apps/web/tests/search-panel.spec.tsx` ⇒ 1 红，且面板文本原样打出 `任务3 条…季度报告 在回收站…已彻底删除`（**这就是 D9 的用户可见形状**） |
| **A2 = W2（含 D14）** | 主修 `reminder-actions.ts` 的 `due()`：内部先滤「所属任务不活着」，**复用同文件已有的 `taskOf()`**（它对 `deletedAt` 返回 `undefined` ⇒ `purgedAt` 一并挡住）；次修 `apps/web/.../notify.ts` 投递处第二道门 + 把**与实现相反的注释**改成实话；`DeliveryOutcome` 新增 `deliveredIds`；接线处投递成功后调 store 的 `markDelivered` → `markReminderFired` | `packages/app-host/tests/reminder-actions.spec.ts` **27 passed**（新增 5 条）；app-host 全量 **48 文件 / 995 passed**；`apps/web/tests/reminder-notify.spec.ts` **19 passed**（新增 5 条）；`reminder-notify-wiring.spec.tsx` **6 passed**（新增 2 条真 App 判据） | ① 把 `due()` 的过滤摘掉 ⇒ **app-host 3 红**（三条 D1 腿各一），而**真 App 那 6 条仍全绿** —— 见下面「两道门」那条发现；② 摘掉 `markDelivered` 那一次调用 ⇒ **恰好 1 红**（`等待「firedAt 落库」超时`）；③ 只摘投递处第二道门 ⇒ 纯函数 **2 红**、真 App 仍绿（证明两道门各自的载体分开了） |
| **A3 = W7** | `packages/legal/src/documents/{privacy,personal-info-list,data-rights}.ts` 按实话改写，**20 个字符串位**（`git diff --numstat` 现量：privacy 8、personal-info-list 6、data-rights 6 ⇒ 中英各 10）；新门槛 `packages/legal/tests/retention-claim.spec.ts` | `pnpm --filter @heyta/legal exec vitest run` ⇒ **2 文件 / 63 passed**；`typecheck` 干净；`check:legal-copy` 与 `check:docs-voice`（扫 `site.*` **1028** 条）全绿 | 把 `privacy.ts` 那句改回**被撤掉的旧承诺** ⇒ 新门槛 **1 红**；另有一条**自反判据**：把四句被撤掉的原文逐字喂给分类器，必须逐句判红（`Tests 4 passed` 含这条），防止有人哪天把正则改宽到"见谁都放行" |
| **A4 = W0** | [`docs/adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md`](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md) | 开工那一刻现量取号：`ls docs/adr | sort | tail -3` ⇒ 工作树最大 **0047**、`git ls-files` 最大 **0045**、0048 空闲 ⇒ 落 **0048**。`docs-link-check` 对新文件**零死链** | ——（文档交付，无代码变异；它的"牙齿"是 §9 那张「有没有常驻判据」表里两条 ⏳ 与一条 ❌，不是自评） |

### 9.1 执行时才照出来的四件事（写计划时不知道）

1. 🔴 **「撤掉一道门」≠「宿主级判据会红」** —— 因为本轮真的落了两道门（动作层 `due()` + 投递处）。
   把动作层那道摘掉，**真 App 的 6 条一条都不红**。所以每条门必须有**自己的载体**：
   动作层归 app-host 单测、投递处归纯函数测、接线归真 App。
   这条补在 §2.0 那句「新动作要被自己的 UI/CLI 判据钉住」旁边 —— 反向也成立：
   **同一个决定落在两层，判据也要落在两层**。
2. 🔴 **同一个假承诺不止三份文档、而是三份文档 20 个字符串位**（中英各 10；门槛点名判红的
   假承诺本体是 4 条字面串 = 3 中 + 1 英，其余是把同节配套句子改到与之一致）。
   ⚠️ **本节初稿这里写过「8 处（中英各 4）」，是抄件漂移**：那是"假承诺本体 4 段"被
   顺手当成了"改写总条数"。改完文案后我用 `git diff --numstat` 现量才发现对不上。
   ⇒ 新门槛第一条用例就照出我原计划漏改的第四处（`data-rights.ts` 状态表那格，中英各一）。
   ⇒ 交接书 A3 那条只写了「privacy.ts 两处」，**那句现在作废**，改为：
   「跑 `packages/legal/tests/retention-claim.spec.ts`，它自己会点名」。
3. ⚠️ **`projects/model.ts:86` 这个行号本轮又漂了一次**（现量 `:107`，`aliveProjects` 的 return）。
   三份文档里 8 处已全量替换。⇒ 印证 §8 那条：**行号是读数，不是事实**；
   下一轮开工前重跑 `grep -n "archived !== true" packages/ui/src/projects/model.ts`。
4. ⚠️ **交接书让「在 `docs/adr/README.md` 加索引行」是错的**：那个文件明写
   「ADR 的完整列表在 `docs/README.md`，避免两处各维护一份而不同步」。
   已按真规矩只加 `docs/README.md` 一行，并把它原来那句「ADR-0048 尚未写」**就地改掉**（留了日期）。

### 9.2 没跑的部分（写明没跑，不算绿）

- 🔴 **真浏览器数通知条数**那一条**没有跑**，也没有写成判据文件。三个具体阻碍，各自有解：
  ① Playwright 1.63 的 `types.d.ts` 里**没有**通知事件 API（穷举 58 处 `on(event:` 形状后确认；
  第一趟探针用错引号形状时误报 0，已用 `dialog` 做阳性对照重跑）⇒ 可行解是
  `addInitScript` 里包一层 `window.Notification` 记账；
  ② 真浏览器跑的是 `apps/web/dist`，而本轮改的是 `packages/*/src` ⇒ 要先重建那枚**共享产物**，
  会动到并行会话正在用的 `apps/web/dist`；
  ③ 提醒没有既有的 e2e 播种路径（e2e 里所有用例都是走 UI 驱动的）。
  ⇒ **本轮证到的是 jsdom 真 `<App />` 树**（`reminder-notify-wiring.spec.tsx` 断言
  「有人真的 `new` 了一次 Notification，且正文是那条任务」）。
  这一条留在批次 C，不写成"四端已验"。
- **移动端投递没验，而且结构上验不了**：整条通知投递路径在移动端从未实现（§5）。
  交付说明的口径是「**Web 端已修；移动端无投递**」。
- **`pnpm check` 全量没跑**：负载 8–16、并行会话有 12+ 个测试进程在跑，而 `check:ai-e2e`
  会 `SIGKILL` 别人的 dev server（§7 第 87 条）。按交接书第 6 条改成**逐条 targeted gate**：
  已跑 domain 841 / app-host 995 / legal 63 / web 相关 spec，其余留待批次收口统一跑。
- 🔴 **一处红灯不属于本批**：`apps/web/tests/due-date-edit.spec.tsx`
  在 web 全量里 1 红（`月历里应有 10月25日 这格: expected null not to be null`）。
  归属取证：该文件工作树 **+221 行未提交**，失败那条用例是**新增行**（`git diff` 第 254 行 `+`），
  属并行的日历那条线 ⇒ **登记不代改**（`pnpm --filter @heyta/web exec vitest run` ⇒
  1558 passed / 1 failed / 12 skipped）。
- 🔴 **A1/A2 的宿主级判据在 17:29 起跑不动了，原因不在本批**（读数留档，避免下一轮误判成"回收站弄坏了搜索"）：
  17:25 `search-panel.spec.tsx` **11 passed**、17:02 `reminder-notify-wiring.spec.tsx` **6 passed**，
  而 17:29 起两条 `.tsx` 套件**整片 17 红**，抛点是
  `apps/web/src/features/projects/ProjectsPanel.tsx:125` ⇒
  `TypeError: archivedProjects is not a function`。三条现量把归属钉死：
  ① `git grep -c archivedProjects HEAD -- packages/ui apps/web` **空** —— 这个 API 在 HEAD 里不存在；
  ② `packages/ui/src/projects/model.ts` mtime **17:28**，而 `packages/ui/dist/index.js` mtime **17:21**，
  dist 里 `grep -c archivedProjects` = **0** ⇒ 并行会话刚写进 src、产物还没跟上；
  ③ `apps/web/src/features/{projects/ProjectsPanel.tsx,projects/store.ts}` 与
  `packages/app-host/src/project-actions.ts` 同属那批未提交改动（`git status` 现量）。
  ⇒ 那正是 **W9 的归档 list 分裂**（本计划排在 W3 前面那条）在被人实现。
  **本轮不替他们重建 `packages/ui`**：那等于拿别人在飞的源码出产物，
  而且他们的 `dts` 那一步当时就没出 `index.d.ts`（见上一条）。
  接手的人复跑：`pnpm --filter @heyta/ui build && pnpm --filter @heyta/web exec vitest run tests/search-panel.spec.tsx tests/reminder-notify-wiring.spec.tsx`。

- ⚠️ **`apps/web` 的 typecheck 在本机是 317 个 error，但零个落在我改的文件上**。
  首因一条就够：`packages/ui/dist/` 里**没有 `index.d.ts`**（现量 `ls packages/ui/dist/` ⇒
  只有 `index.cjs` / `index.js` / `*.map`，时间戳 17:21），于是 69 处
  `Could not find a declaration file for module '@heyta/ui'` 级联成 `implicitly has 'any' type`。
  而 `git status --porcelain -- packages/ui` 显示它的 `src/` 正被并行会话整批改着
  （`calendar/*`、`capture/model.ts`、`date-picker/*` …）。
  ⇒ **这是本机态，不是仓库属性**：分辨方法是 `ls packages/ui/dist/index.d.ts`；
  重建它等于替别人在飞的源码出产物，本轮**不做**。
  我改的四个文件（`domain/src/search.ts`、`app-host/src/reminder-actions.ts`、
  `web/src/features/reminders/{notify,store,use-reminder-notifications}.ts`）
  在这 317 行里**一条都不出现**，且三个 `packages/` 的 `typecheck` 各自 `Done`。

- **没有提交**：产品负责人未下"提交"这句指令，且 `docs/README.md` 这份工作树副本里
  还夹着别人 2 行未提交索引（0046/0047）⇒ 点名路径提交会把它们带进同一笔。
  要提交时：代码/测试/legal/ADR 文件可 `git commit --only` 逐个点名；
  `docs/README.md` 与 `docs/plans/README.md`、`docs/reference/environment-traps.md` **先问归属**。

---

## 10. 批次 E · 注销账号 = 彻底销毁（2026-10-03 新增，产品负责人两条指令逼出来的）

**指令原文**：「但删除账号一定是要彻底销毁的。」+「我们必须按照欧盟的标准走 GDPR。」

这条不是 W1–W9 里任何一张工单的延伸。它推翻了我自己刚写在政策里的一句话的前提：
批次 A（A3）把"45 天会清理"改成实话之后，那句实话写的是
**"这段加密历史实际只有一条路真的消失：注销账号"** —— 而取证发现这条路
① 用户**走不到**（客户端从不调用 `DELETE /api/account`），
② 走到了也**只销毁五层里的一层**。所以 A3 的收口其实没收口，它把问题挪到了这里。

### 10.1 现状：注销时"销毁"到底覆盖到哪一层（全部本轮现量）

| 层 | 今天真的发生什么 | 证据（复跑：读那一行） |
|---|---|---|
| **服务端主路径** | `prisma.user.delete` 一句，靠数据库级联删干净：**引用 `users` 且 `ON DELETE CASCADE` 的外键 16 条、覆盖 15 张表** | `server/src/api.ts:713-757`；推导见 `packages/legal/tests/structure.spec.ts` |
| **级联之外** | `payment_events` 没有 `userId`，注销后**行仍在**，只是订阅指针 `SetNull`（金额+时间留存，断链） | `server/prisma/schema.prisma:305-345`（:336 原话「删订阅不删事件审计」） |
| **备份** | 每日 `pg_dump` 两份：整库 + **accounts（邮箱明文/口令散列/passkey）**，保留期默认 14 天；代码里**没有**"从既有备份中定点删掉某一个人"的能力 | `server/scripts/backup.sh:98,107,135`；`server/docs/backup-and-recovery.md:45`（示例 cron 写 3 天，与默认值不一致 → 待核） |
| **日志** | `admin.routes.ts:423/:493` 把**邮箱明文**打进日志；注销自身留 `userId` 审计行；无轮转与到期删除 | 现量 grep `Logger.audit` |
| **其它设备的本地库** | 🔴 **一行都不会少**。这是最大的一块，且以前没有任何文档写过 | 见下面 10.2 的四条证据 |

### 10.2 「本地库删不掉」的四条独立取证（每条都推翻了"应该有吧"）

1. `DbAdapter` 接口**根本没声明** `destroy`（`packages/storage/src/db.types.ts:164-215` 只有 `close`/`clear(store)`）；
   SQLite 实现**完全没有**删库能力（`sqlite-adapter.ts` 只有逐行 `DELETE FROM`）；op-sqlite 驱动只有 `close()`，无删文件位。
2. IndexedDB 那份 `destroy()`（`indexeddb-adapter.ts:556-559`）**零调用方** —— 连测试都没用它。
3. 全仓**没有任何客户端调用 `DELETE /api/account`**：`HOSTED_AUTH_PATHS`（`packages/app-host/src/hosted-auth.ts:109-124`）里连注销条目都没有。
4. 同步客户端拿到鉴权失败后的既有立场是**反向的**：`packages/sync-client/src/client.ts:383` 明写「🔴 绝不清本地数据」，
   `:1609` 只认 401/403 且上报后没有任何一端清数据（web 只 `set({status})`，`app-host/src/host.ts:340` 连回调都不传）。

🔴 **而且"清一份"不等于"清干净"**：Web 有 **4 类**本地存储（IndexedDB `heyta`、OPFS `heyta.sqlite`+VFS、
IndexedDB `heyta-widget`、localStorage ≥9 键），迁移期间**刻意不删旧库**（`apps/web/src/lib/oplog.ts:252`）
⇒ 只删一个来源，另一个会把数据**复活**。Windows 壳是**两份独立数据**（壳的 `heyta.sqlite` + WebView2 自己的
IndexedDB/OPFS，`MainWindow.xaml.cs:640-643` 与 `:65` 原话），macOS 还有 WKWebView 持久 websiteData 第二份
（`HeytaMacApp.swift:414-416`，只有 `HEYTA_WEBKIT_EPHEMERAL=1` 才不持久）。

### 10.3 工单与执行账

| 工单 | 内容 | 落点 | 状态 | 判据读数 | 变异读数（只拿掉修复） |
|---|---|---|---|---|---|
| **E1** | 注销必须**可辨识**：`TokenFailureCode` 必填（`ACCOUNT_CLOSED` / `ACCOUNT_UNVERIFIED` / `TOKEN_REVOKED` / `TOKEN_INVALID`），middleware 把稳定码写进 401 响应体 | `server/src/auth.ts:246-`、`server/src/middleware.ts:39-44` | ✅ 已落 | `server/tests/account-closed-signal.spec.ts` **10 passed**；server 全量 **2110 passed / 1 skipped**（还原后复跑红 0） | M1 摘掉"账号行不存在"那一支的码 ⇒ **3 红**；M2 把"未验证"错标成 `ACCOUNT_CLOSED` ⇒ **2 红**；M3 middleware 不发码 ⇒ **3 红**；M4 摘掉 DELETE 里两处 `authCache.invalidate` ⇒ **1 红**（证明那两行是承重的，此前无任何判据钉它） |
| **E1b** | 状态码 401 → **410 `ACCOUNT_CLOSED`** | 同上 + `packages/sync-client` | ⏸ **与 E2 同批**（现在改会让当前客户端把注销读成"可重试的普通错误"，反而丢掉它唯一的终止信号） | —— | —— |
| **E2** | 收到注销信号 ⇒ 本机数据真的销毁：`DbAdapter` 补 `destroy` 契约 + SQLite/op-sqlite 实现 + 每端按 10.2 清单逐类清（Web 4 类 / Windows 2 份 / macOS 2 份）+ 扩 storage 契约测试 | `packages/storage/*`、`packages/sync-client/src/client.ts`、各宿主 | 🔴 **阻塞**：这些文件 17:36 现量整片被别人脏着（`checkpoint.ts` 已 staged、`client.ts` M、`indexeddb-adapter.ts` M、`sqlite-adapter.ts` M） ⇒ 错峰 | 待 E2 | 待 E2 |
| **E3** | 注销入口（Web 设置 + 移动端我的 + CLI），带"会清掉本机包括未同步数据"的二次确认与"先导出"提示 | `packages/app-host/src/hosted-auth.ts`、`features/settings/ProfilePanel.tsx`、`apps/mobile/src/screens/ProfileScreen.tsx` | 🔴 **阻塞**同上；且**顺带闭合 G-08**（苹果 5.1.1(v) 要求应用内可注销） | 待 E3 | 待 E3 |
| **E4** | 政策与 ADR 写成**分层实话** + 数字回到真源 | `packages/legal/src/documents/*`、`packages/legal/tests/structure.spec.ts`、ADR-0048 | ✅ 已落 | legal **66 passed**；新门禁 4 条（推导前提 / 逐类覆盖 / 数字对账 / 边界成对） | M5 数字抄回 19 ⇒ 1 红；M6 中文句里删掉「墓碑」⇒ 1 红；M7 英文句删掉边界 ⇒ 1 红；M8 minors 删「其它设备」⇒ 1 红；M9 表名推导退回 `split('_')[0]` ⇒ **3 红**；M10 类别表塞一条真源没有的表 ⇒ 2 红 |
| **E5** | 三处结构性敞口的处置（备份无定点删除、日志明文邮箱、`recover-user.ts` 能导全量明文且自陈 UNVERIFIED） | `server/scripts/*` | ⏸ 待拍（见 P-10/P-11） | —— | —— |

### 10.4 E4 照出来的三条，写下来免得下一轮重新踩

1. 🔴 **同一个事实的抄件不止漂一次，还各漂一个数**：政策正文 19、`data-rights.ts` 头注 18、两份 research 18、
   `schema.prisma` 声明 16 —— 而**已有门禁只钉 privacy 一份**。新门禁改成扫**全部 9 份法务文档 × 两栏**，
   并要求"级联硬删"那句**中英两栏都自带设备边界**（否则改一栏留一栏夸大）。
2. 🔴 **口径错比数字错更贵**：19 不是"算错的 16"，它数的是**42 个迁移文件里 `ON DELETE CASCADE` 的累计出现次数**
   —— 与被删账号无关的级联算进来、同一条约束被重建过算两次。判据回到真源时，要先把"真源是哪一棵树"写清楚。
3. ⚠️ **中英镜像判据挡不住"两栏一起夸大"**：它只比形状（块序、单元格数）。
   本轮我先把中文两格改了、英文漏了一格，形状判据全绿 —— 是新加的语义判据把它抓出来的。

### 10.5 待拍（GDPR 引出的，不是回收站引出的）

- **P-10**：法律文本今天**只写 PIPL**（`data-rights.ts:5` 逐条对的是第 44–50 条），全仓 `GDPR` 命中 2 处且都是待办登记。
  "按欧盟标准走 GDPR"要么是给现有九份文档**加 GDPR 口径的一节**（Art.13/15/16/17/20 逐项 + 处理者/控制者措辞 + 跨境传输），
  要么是一份**面向欧盟用户的独立政策**。这两件事的成本差一个量级，需要拍。
- **P-11**：**注销要不要冷静期**。GDPR Art.17 是"无不当延迟"，苹果要求应用内可注销；
  而不可逆的自助注销 + 会毁掉"未同步的本地数据"（E2 之后每台设备都会清）。
  倾向：**72 小时可撤销的冷静期 + 期间只停同步不删数据**，但它与 ADR-0048 现在写的"没有冷静期"冲突 ⇒ 要么改政策要么改实现，不能两边都留着。
- **P-12**：备份侧的"彻底销毁"要不要做 **crypto-erase**（备份用可销毁的密钥整卷加密，销毁密钥即视为删除）。
  这是唯一能在**不改整库快照机制**的前提下让"备份里的我也没了"成立的路，但要运维配合，且政策必须写清它的边界。

## 11. 批次 B 执行账（2026-10-03，本会话亲跑；每条带落点 / 判据 / 变异读数）

⚠️ **全部未提交**（产品负责人要求等明示）。所有读数是**工作树**读数，逐包现量于 2026-10-03 20:2x。

### 11.1 W1 · 便签进回收站 ✅

**落点**

| 层 | 改动 |
|---|---|
| `packages/domain/src/entities.ts` | `inTrash` 收成**类型谓词**（`deletedAt` 顺带收窄成 `number`）+ `byDeletedOrder` 成为唯一所有者 |
| `packages/domain/src/notes.ts` | `trashedNotes()` |
| `packages/app-host/src/note-actions.ts` | 三件套补齐：`purgeNote` / `listTrashed`；`restoreNote` 保持 P-5 的 boolean 契约，而"已被彻底删除"另给一条**抛错**（不可逆动作不与"没变化"混成同一个返回值） |
| `packages/ui/src/trash/{model.ts,TrashBoard.tsx}` | `toTrashItems()`（合并 + 排序 + 取标题）；行模型**泛型化**成 `TrashItem` —— 破坏式，两端同批改，不留兼容分支 |
| 两端 | `apps/web/src/features/trash/TrashView.tsx`、`apps/mobile/src/screens/TrashScreen.tsx` + `apps/mobile/src/lib/trash-display.ts` |
| `packages/i18n` | intro / empty.hint 两语各 2 处改成"任务和便签"；新增 `web.trash.confirm.notErasure`、`web.trash.error`；P-6 把 `common.entity.NOTE` / `mobile.entity.NOTE` 的"笔记"改"便签" |

**判据**（现量）：ui `tests/trash-model.spec.ts` **11**、app-host `tests/note-actions.spec.ts` **34**（含双引擎那组）、web `tests/trash.spec.tsx` **14**、mobile `tests/trash-display.spec.ts` **11**。

**变异读数**（七臂里逐臂留下读数的五臂）：

| 臂 | 摘掉的东西 | 红集 |
|---|---|---|
| MUT-1 | `restoreNote` 不发 op（只 `return true`） | **4 红**（期望 ≥2，含双引擎那条） |
| MUT-2 | `toTrashItems` 合并后不排序（谁先传谁在前） | **3 红**（期望 ≥3） |
| MUT-3 | 摘掉 `inTrash` 那道门（整张原始表进回收站 = ADR-0048 的 I5） | **3 红**（期望 ≥3） |
| MUT-4 | 摘掉 `restoreNote` 对 `purgedAt` 的拒绝 | **1 红** |
| MUT-7 | 共享板不渲染种类徽标 | **1 红**（web 那条按 `testID` 精确取文本） |

⚠️ MUT-5 / MUT-6 是 MUT-7 与"词条退回"那两条腿的前身方案，**没有单独留下载数** —— 别把它们算成第六条独立证据。

**执行时才照出来的三件事（写计划时不知道）**

1. W1 的真实内容**不是**"便签能进回收站"，而是它逼出的**三处重复**：回收站判据 + 顺序 + 两路合并，此前在 `actions.ts` 与 `apps/web/.../tasks/store.ts` 各一份，而 `selectTrashedTasks` 是**第三份**手写判据。现在三处都指向 domain/ui 的唯一所有者。
2. `deletedAt ?? updatedAt` 那个兜底**永远走不到**（`inTrash` 已保证字段在）。把它改成类型谓词之后它自然消失 —— 这类"防御性兜底"是判据没收窄时的替代品，**删它以前先证明它到不了**。
3. `apps/mobile/src/lib/*.ts` 会被 node 单测**直接加载**，那里**值 import `@heyta/ui` 会拉进 react-native 源码**并炸在 `RolldownError: Flow is not supported`。徽标措辞因此留在屏幕层（`TrashScreen.tsx`），不留在 `lib/`。

### 11.2 W9 · 归档清单不进任何出口 ✅（与并行会话同批收口）

**先量再动**：并行会话的 `192a516d` 已经把 **W9 的界面那一半**落地（两端「显示已归档」开关 + 共享层 `includeArchived`），**出口那一半一条没落**；而同一提交在 `apps/mobile/tests/organizer-rename.spec.ts:144` 把"归档后**仍然列得出来**"钉成了判据，理由写在注释里：*"动作层一滤，移动端那个「显示已归档」开关就永远读不到数据了"*。

⇒ 那句话**当时是对的**（当时没有第二路）。本工单按计划 §W9 落 **list 分裂**，同时把它的理由兑现成一条新锁（见下面"第四把锁"），而不是把判据改掉就完事。

**落点**

| 层 | 改动 |
|---|---|
| `packages/domain/src/entities.ts` | 新增 `isArchived()`（P-7 读侧唯一判据）与 `byCreatedAtOrder()` —— 后者此前在 `TaskActions` / `ProjectActions` / `HabitActions` 里**各抄一遍、逐字相同**，三处副本现已归零 |
| `packages/app-host/src/project-actions.ts` | `listProjects()` **不含归档** / `listArchivedProjects()` **只含归档** / `listAllProjects()` 由前两路**派生**合并（不是第三份判据）；文件头"由这里独占的语义决定"三条 → **四条** |
| `packages/app-host/src/local-api-host.ts` | 删掉那份第二判据 `Object.values(state.projects).filter(p => p.deletedAt === undefined)`，改走 `projectActions.listProjects()`；`taskCount` 改数 `actions.listTasks()` |
| `packages/ui/src/projects/model.ts` | `aliveProjects` / `archivedProjects` 不再写 `archived !== true` / `=== true` 字面量，走 `isArchived` |
| 两宿主 | `apps/web/src/features/projects/store.ts` 与 `apps/mobile/src/screens/ListsSection.tsx` 的侧栏数据源改成 `listAllProjects()` |
| 零改动就修好的 | `apps/node-host`（CLI）与 `apps/mobile/src/screens/TasksScreen.tsx`（归入选择面）此前露出归档清单，现在自动不露 —— 因为判据不在它们手里 |

**判据**（新增断言，全部带正向对照）

- `packages/app-host/tests/project-actions.spec.ts` **31 passed**
  - 归档后：可见那路不含它、归档那路**只**含它（长度 2 / 1 各自断言，挡"两路都返回空"）
  - 取消归档 ⇒ 回到可见那路（并断言三条都在，不是列表整个空了）
  - 归档 + 删除 ⇒ **两路都不含**（墓碑优先；挡的是"`listArchivedProjects` 直接读原始表只判 `archived`"那种写法）
  - `listAllProjects()` = 两路合并且顺序仍是规范序（归档那条**刻意放在中间**，否则"可见的全在前"看不出来）
- `packages/app-host/tests/local-api-host.spec.ts`：出口层三条 —— ① 归档那条不许出现、② 🔴 **正向对照腿**（未归档那条必须出现）、③ 形状判据（剥注释后 `local-api-host.ts` 里不许再出现 `.projects`，见 §11.4 第 3 条）。
  ⚠️ 顺带照出一条**一直存在的假判据**：`listProjects 带上任务数` 原先只写了 `expect(Array.isArray(projects)).toBe(true)` —— 名字写着任务数、**没有一行在看任务数**，`taskCount` 恒 0 也照样绿。已按它自己的名字验实（两进一出 + 一条已删除不计入）。
- `apps/mobile/tests/organizer-rename.spec.ts` **26 passed**：原判据改成"两路分裂"，并在 `ListsSection` 的接线判据里加**第四把锁** `toContain('actions.listAllProjects()')` + `not.toContain('actions.listProjects()')`。
- `apps/web/tests/projects-panel.spec.tsx` **25 passed**：新增侧栏数据源那把锁（store 读哪一路 + 面板两半都在场）。

**变异读数（四臂 + 一臂 W3 的，全部还原后 `cmp -s` 逐字节相同）**

| 臂 | 摘掉 / 退回的东西 | 红集 |
|---|---|---|
| 1 | `visibleProjects` 里那行 `.filter(!isArchived)`（= 计划 §W9 判据 ③ 要求的那一臂） | app-host **3 红**（含出口层那条）+ mobile **1 红** ⇒ 计划要求的"①②都必红"成立 |
| 2 | 出口层退回"自己遍历原始表" | local-api-host **2 红**（行为 + 形状） |
| 3a | `ListsSection` 只读 `listProjects()` | mobile 接线判据 **1 红** |
| 3b | web store 只读 `listProjects()` | web 数据源锁 **1 红** |
| 4 | `listTasks()` 把归档清单里的任务一起滤掉 | W3 那两条 **2 红** |

### 11.3 W3 · 归档要有出口 ✅ 大部分被并行会话抢先落地，本批补的是边界

- **P-7 那句"解档写 `null`"没有落地机会**：并行会话把两端解档实现成 `archiveProject(id, false)` ⇒ 写 `archived: false`，而**读侧仍是 `archived !== true`**。承重的其实是读侧那一半，本轮由 `@heyta/domain` 的 `isArchived()` 独占（`packages/ui/projects/model.ts` 里的字面量副本一并收掉）。
  ⇒ **不**再改写成 `archived: null`：两种写法并存才是问题，而不是哪一种对；`archiveProject(id, false)` 已经在写，改它等于凭空造第三条路径。
- **"归档只藏容器、不藏内容"这条边界本轮第一次变成判据**（`project-actions.spec.ts` 那个 describe 两条；变异臂 4 会红）。以前它只是 P-3 的一句话，没有任何东西挡得住"顺手把里面的任务也收起来" —— 而那会让归档变成**另一种删除**：任务从收集箱/日历/搜索里消失，而回收站里也没有它们（`deletedAt` 从没写过），没有任何一处能找回来。

### 11.4 本批照出来的、写计划时不知道的四件事

1. **W9 的"今天没人踩得到"那句定性当天过期了**。计划第四轮写的是"`archiveProject` 只到 web store 为止、组件层没有按钮"，而 `192a516d` 已给两端画上归档按钮 ⇒ 出口层那半**从预防变成用户可见**。⚠️ 撞车的判据仍然是"同一文件的未提交 diff"，但**定性过期**的判据是**别人的提交** —— 只看工作树会读到一个已经不成立的前提。
2. **一条判据曾经把"动作层不许滤归档"钉死过**（理由见 11.2 开头）。改这种判据时必须**同时**把它的理由落成一条新锁，否则下一轮会有人只接一路，而所有旧的接线判据照样绿 —— 症状不是报错，是"开关按了什么都没出现"。
3. **形状判据（读源码的那种）必须先剥注释**：本工单在 `local-api-host.ts` 的注释里**逐字引用了那句旧代码**，不剥注释的话，那条"不许再出现 `.projects`"会先把**说明文字**当成违规。（`packages/app-host/tests/privacy-consent.spec.ts:349` 早就用同一个 `replace` 两步剥法，照它。）
4. **`Object.values(...).filter(判据)` 这种"第二份判据"在出口层不止一处**：本轮把清单那处收掉了，`actions.ts` 里的 `listAlive()` 与 `project-actions.ts` 的 `aliveOf()` 仍是**同一句话的两份**（泛型不同）。收成一处需要一个跨实体的 `aliveOf` —— 那是 W8 的延伸，登记为债，不在本批顺手做（顺手做会牵动任务/习惯/便签三条读路径的判据）。

### 11.5 本批的总读数（逐包，2026-10-03 20:2x）

```
domain    31 files / 841 passed
ui        27 / 484
app-host  49 / 1020
node-host  9 / 165
mobile    42 / 637
web      114 / 1571 passed + 13 skipped（浏览器 E2E 默认跳过）
```

`pnpm -r typecheck` 与全量 `pnpm check` 的读数是**下一节**的事（本批还没跑完整门禁），**不在此处主张**。

### 11.6 W4 · 清单与习惯进回收站 ✅

**落点**（一句话：四路合并的那一处判序只有一份，两端只喂自己已有的那几路）

| 层 | 落点 | 为什么在这层 |
|---|---|---|
| 共享模型 | `packages/ui/src/trash/model.ts`：`TRASH_KINDS` 成为"**哪些类别在回收站里有行**"的**运行时**唯一所有者，`TrashKind` 从它派生 | 两端宿主那张路由表的**类型**也从它派生 ⇒ 加一类不接线是**编译错误**，不是"能还原但不出现在列表里" |
| 共享模型 | `projectTrashItem` / `habitTrashItem` 的标题用 `name`；`liveTaskCountOfProject()` 新导出 | "删一条清单会牵动几条任务"这句影响面话术的**算法**只有一份，两端的确认框各自只负责摆出来 |
| 动作层 | `project-actions.ts` / `habit-actions.ts` 各加 `restoreX` / `purgeX` / `listTrashedX` | 与任务、便签同一条契约（P-5：还原成功给 boolean、"已被彻底删除"**单独抛错**；purge 幂等；**绝不清墓碑**） |
| Web | `TrashView`：四路 `toTrashItems` + `byKind: Record<TrashKind, …>` + 影响面那一行 `trash-confirm-impact` | 穷尽表 ⇒ 少一路编译不过（嵌套三元会**静默不做事**） |
| 移动端 | `TrashScreen`：四路 + `byKind … satisfies Record<TrashKind, …>`；`trash-display.ts` 的 `purgeConfirmCopy(title, t, impact?)` 与新纯函数 `purgeImpactText` | 与 Web 同源的那条诚实条款形状（界面与测试读同一个函数） |
| 词条 | `web\|mobile.trash.confirm.projectTasks` / `.habitLogs`（中英各两条）；intro / empty.hint / entry.hint 两端 × 两语都点名四类 | P-6 的叫法（「便签」）由 `common.entity.*` 独占，界面不另起名字 |

**判据与变异**（`project-actions.spec.ts` 39 条 / `habit-actions.spec.ts` +6 / ui 18 / web 19 / mobile 17；每臂还原后逐字节相同，还原后复跑 app-host 77、ui 18、mobile 17 全绿）

| 臂 | 只拿掉的那一步 | 读数 |
|---|---|---|
| A | purge 顺手把墓碑清了（ADR-0048 明令禁止的那一步） | app-host **6 红**（清单 + 习惯各三条：回收站归属、三条拒绝、跨设备回放） |
| B | "已彻底删除的那条不许还原"从抛错改成 `return false` | app-host **2 红** |
| C | 数影响面用 `!inTrash` 代替 `isLive` | ui **1 红**；web **第一趟存活** ⇒ 往夹具里补一条"先删再彻底删除"的任务后 web **1 红**（`里面还有 3 条任务` ≠ 期望的 2） |
| D | 影响面那句对任务/便签也无条件给 | mobile **1 红**（要的是 `undefined` 而不是空串） |

C 那一臂是本工单真正的产出，值得单独记：**`!inTrash` 与 `isLive` 只在"已彻底删除"这一档不同**，而原夹具里没有这种行 —— 于是 web 那条腿当时是在给一件**不会发生**的事打分。判据写得像有牙、夹具里却没有那一档，读数和"没写判据"完全一样。

### 11.7 W5 · 帮助中心那节改写 + 一条会失败的门禁 ✅

**落点**

- `packages/i18n`（中英）：`site.docs.trash.s1` 改成「回收站里有什么」，`s1p1` 如实点名**四类进、三类不进并各给理由**，新增 `s1p3`（删容器不删内容），`s1p2` / `s2p1` 的"任务"改成"记录"，`fig.trash` / `fig.trash.alt` 两句随之改写。
- `apps/landing/src/site/docs.ts`：把 `s1p3` 挂进第一节 `bodyKeys`（键存在但没挂 = 用户永远读不到）。
- 分区锚点 `tasks-only` → `what-the-trash-holds`，**3 个文件 5 处**：`docs.ts` 1、`helpFigures.ts` 2、`e2e/landing/docs-centre.spec.ts` 2。现量：`grep -rn tasks-only`（排除 `node_modules` / `dist` / `dist-types` / `.worktrees` / `.git`）**0 处**。
- 新门禁 `apps/landing/tests/trash-coverage-copy.spec.ts`（5 条：代码集合 == 拍板 / 四类被点名 / 不进的三类带理由 / 注册表与词条双向对账 / 分区锚点改名不许把配图甩掉）。

**判据的形状**：三本账**两两**对账，而不是"文档 == 我以为的集合" ——
拍板（P-1，**写死在测试里**；从代码派生就等于取消了对代码的约束）、代码（`TRASH_KINDS`）、文档（`site.docs.trash.s1p1` 那一句 + 注册表实际引用的键）。红的时候能指出是哪两本在打架。
⚠️ 点名判据只取 **`s1p1` 那一句本身**，不取整节拼接：拼接会让"某一类只在下面解释归属的段落里出现过"也算通过，而那恰好是要拦的形状（声明里漏了一类）。

**变异读数**（8 臂，每臂还原后 sha256 逐字节相同；词条臂带 `pnpm --filter @heyta/i18n build` 前后各一次）

| 臂 | 拿掉的那一步 | 读数 |
|---|---|---|
| A | zh 那句漏掉「习惯」 | 1 红（点名那条，`zh-CN … 没有点名「习惯」`） |
| B | 代码里去掉 `HABIT` | 1 红（集合 == 拍板那条，报出实际集合） |
| C | 注册表不挂 `s1p3` | 1 红（双向对账那条） |
| D | zh 那句把专注记录**两处**都抹掉 | 1 红 |
| E | en 去掉 `deliberately` | 1 红 |
| F | en 那句漏掉 `lists` | 1 红 |
| G | en 把 focus sessions **两处**都抹掉 | 1 红 |
| H | `helpFigures.ts` 里 `W07` 的 `sectionId` 改回旧锚点名 | 1 红（第 5 条，报的正是「配图挂在不存在分区上」） |

D 的**第一趟存活**，值得和 11.6 的 C 并列记：我只删了「和专注记录」这一处，而同一句后半还留着「而专注记录是统计的事实源」⇒ `includes` 仍然命中。**这条不是判据坏了，是臂写错了** —— 一个 needle 在句子里出现两次时，删一处不构成"文档不再说它"。记下来是因为同一个错误很容易在别的臂上重犯。

**门禁读数**（2026-10-03 22:1x，逐条带 rc；`bash /private/tmp/w5-gates.sh`）

```
check:docs-voice      rc=0
check:legal-copy      rc=0
check:entries         rc=0
gen-help-figures --check  rc=0
check:ui-language     rc=0
landing test          1307 passed（加第 5 条判据后复跑 **1308** passed）
landing typecheck     初跑 rc=2（新判据初稿 2 处 TS18048：`label` possibly undefined）⇒ 改成显式 throw 守卫后复跑 rc=0；第 5 条加完再跑仍 rc=0
check:docs            rc=1   ← 两条都不是本工单造成的，见下
```

`check:docs` 那两条（现量：`pnpm check:docs`）：

1. 1 处**失效的章节引用**：`docs/plans/countdown-anniversary.md:1280` 指向 `docs/adr/README.md` 里一个不存在的章节号（倒数纪念日那条线的文件，不属于本批）。⚠️ 这一条**不能照抄 checker 的输出形状**：本文件第一版把那句原样贴了进来，于是 `check:docs` 把**这句引用**也当成一处真引用并报红 —— 与 §11.4 第 3 条同族（形状判据会吃掉逐字引用的说明文字）。
2. **本机有、git 没跟踪**的链接：初测 45 处，随后**变成 48**（本批给文档中心补登记行时又加了 3 条链接）。列的是 `docs/README.md` 指向 ADR-0046/0047/0048/0049/0050/0051 与本计划与执行简报的链接。⚠️ **症状是死链，成因是没提交** —— 本批按用户指令不提交，所以这条红的闭合动作是提交，不是改文档。⇒ 反过来也成立：**`check:docs` 的输出不能用来判断"这一批改坏了没有"**，只能用来判断"批次收口还差提交"。

**没做（登记，不在本批顺手做）**

- 🔴 **配图 `W07-trash.png` / `W07-en-trash.png` 还是旧的**（只画任务）。源图来自 `scripts/screenshots/` 那条真设备/真浏览器取证流水线，重跑要占模拟器与端口；本轮只改了两句话（`fig.trash` / `fig.trash.alt`），**图本身没有跟着改**。⇒ 这是"文档说四类、图演示任务"的一次**已知不一致**，`gen-help-figures --check` 只比 sha256，它挡不住"源图内容过期"。闭合动作：`pnpm reinstall:all` 那一轮顺带重跑截图 + 生成器。写清楚是因为它属于 §7 第 82 条那一族 —— 非空白挡不住"那是别的界面"，而**图注正确挡不住图画的是旧东西**。
- 该门禁读 `@heyta/i18n` 的 **dist**（落地页运行时同样读 dist），所以"改了源码没重跑 build"这一族漂移它挡不住 —— 与全仓所有落地页测试同一条边界（§7 第 79 条）。


### 11.8 W8 · 余下的两半：一层判据的重复被收掉，③ 仍然只是登记

**先回答 W8 剩下的那个问题**（还有没有别处把墓碑判据重写了一遍）。现量一条命令：

```
rg -n 'deletedAt !==? undefined|purgedAt ===? undefined' packages apps   # 排除 dist / node_modules / .worktrees
  packages/**  → 41 处 / 22 个文件
  apps/**      → 2 处 / 2 个文件（其中 1 处是集成测试）
```

🔴 **含 `purgedAt` 的那一条判据（"算不算在回收站里"）全仓只有一处**：`packages/domain/src/entities.ts:73`（`inTrash` 本体）。其余全是**单条件**的"还活着吗"。⇒ W8 担心的那个形状（两个条件各写一遍、各漏一半）现在**结构上做不到**了。

**本批收掉的**：单条件那句曾被 **6 个具名辅助函数**各写一遍字面量 —— `aliveTasks`（`domain/task-filter.ts:77`）、`aliveNotes`（`domain/notes.ts:76`）、动作层的 `aliveOf` **两份**（`project-actions.ts:172`、`habit-actions.ts:172`）、`listAlive`（`actions.ts:711`），加上回收站数任务那一处。六处现在都调 `isLive()`。

同时把 `isLive` 的入参从 `EntityBase` 放宽成 `{ deletedAt?: number }` —— ⚠️ **这不是松语义**：它只读 `deletedAt`，而收窄成 `EntityBase` 会让跨实体的辅助函数**为了调用它而必须先收紧自己的泛型**，那一档的症状是"改不动，那就再写一份字面量"，也就是 §11.4 第 4 条登记的那笔债。

读数：domain **842** / app-host **1052** / ui **498** / node-host **165** passed，`pnpm -r typecheck` **rc=0**（含 web、mobile）。六处都是同一句话的等价改写 ⇒ **零行为变更，因此没有新增判据**；变化是 `isLive` 这条既有判据的消费者从 1 处变成 6 处。

**没收的两处，以及为什么**

- `packages/domain/src/reminders.ts` 的 `aliveReminders`（:161）。⚠️ 该文件此刻正被并行会话改：现量 `git diff` 是 `reminderIsFired` / `firedForTriggerAt` 那套 occurrence 语义（ADR-0051 那条线）。**撞车的判据是同一文件的未提交 diff** ⇒ 留给它的所有者顺手收，不在别人在飞的 hunk 上叠一刀。
- 算法**内部**的 inline guard（`subtasks.ts` 4、`today-progress.ts` 4、`activity-categories.ts` 4、`preferences.ts` 3、`weekly-review.ts` 3、`milestones.ts` 3、`memory.ts` 2，其余 10 个文件各 1）。这些不是"第二份所有者"，是大算法里的单行守卫；把 25 处一次换成函数调用是**纯机械 sweep**，改坏其中任一处的代价与收益不成比例 ⇒ 登记为债。

**③（把入参收窄成"已过滤"的具名类型）仍然只是登记**，本轮把它的价量出来了：`searchTasks(` 全仓 **15 处**调用（生产 3 处：web `App.tsx:1130`、mobile `SearchScreen.tsx:131`、mobile `TasksScreen.tsx:579`），而 `SearchPanelProps.tasks` 的注释写着"已经过滤好的"、类型仍是 `readonly Task[]`。⇒ 收窄需要一个**只有 `aliveTasks()` / `listTasks()` 产得出来**的具名类型，而它的方向**与 A1 相反**（A1 把滤放进领域函数内部，③ 要求"递原始表"编译不过）；两者并存的代价是每个宿主调用点多一行，而那一行没有任何东西保证后来者留着它。**建议**：等出现第二个搜索入口（例如原生壳）再做。


### 11.9 W4b · 标签删除确认（登记，本轮**没做**，因为落点正被别人重写）

✅ **本节已被 §11.13 取代（2026-10-04 0:3x）**：撞车条件在 10-03 23:5x 现量已不成立，
这一单当晚做掉了。下面这节**整段留着**，因为它是"登记时成立的理由会过期"的样本 ——
读它的时候请连着 §11.13 那张落点表一起看，别看成本节就以为还没做。

W4 那张表的 `TAG` 行是拍过板的：**不进回收站，改成单击即删 + 删除确认里写明影响 N 条任务**（理由在 §7.1 P-1 与 §W4 表格那一行 —— 标签重建成本≈0，但**影响面**是真实风险，所以防护放在"删之前告诉你影响多少条"）。本轮把它量清楚了，然后停在门口。

**现状（全部本轮现量）**

| 事实 | 证据 |
|---|---|
| 两端删标签都是**一次点击立即写 op**，没有任何确认 | web `apps/web/src/features/projects/ProjectsPanel.tsx:356` `onRemove={(item) => { void projects.deleteTag(item.id); }}`；mobile `apps/mobile/src/screens/TagsSection.tsx:142` `run(actions.removeTag(item.id))`；动作层 `packages/app-host/src/project-actions.ts:306` `removeTag` 直接 dispatch `DEL` |
| 共享行组件把"删除确认"当作**宿主的事** | `packages/ui/src/projects/OrganizerList.tsx:45` 注释："摘要：composer · 取色控件 · 删除确认 —— 留在各端"。而**两个宿主都没做**（注释描述的分工从未落地） |
| 唯一缓解是移动端列表下面一句静态提示 | `TagsSection.tsx:150` `t('mobile.tags.removeHint')` |
| 影响条数在 web 已经有、在移动端**刻意没给** | web `ProjectsPanel.tsx:146` `openTagCounts(...)` → `counts={tagCounts}`（:334）；mobile `TagsSection.tsx:113-120` 注释说明为什么不传 |
| ⚠️ 那个 `counts` 数的是**活着且未完成**的任务 | `packages/ui/src/projects/model.ts:299` `openTagCounts`（`deletedAt === undefined && completedAt === undefined`）—— 而"删标签会动到哪些任务"**包含已完成的任务**，所以这一份数字**不能**直接拿来写影响面 |

**为什么它属于 W4 而不是新需求**：删一条标签会 `DEL` 掉标签实体，而任务上的 `tagIds` 仍指向那个**已经不存在的 id**；重新建一个同名标签拿到的是**新 id**，那 N 条任务的归属**不会**回来。⇒ 界面今天说的"标签随时可以重新建一个"是真的，"重建之后一切照旧"是假的，只有确认框那一行能把这个区别说清。

**下一轮的落点（写死，免得重新调研）**

1. 共享层新增**一个**纯函数 `liveTaskCountOfTag(tasks, tagId)`（放 `packages/ui/src/projects/model.ts`，紧挨 `openTagCounts`），用 `isLive` 而不是再写一遍字面量，并在注释里写明它与 `openTagCounts` 的**差在哪里**（两者不是同一件事，混用会少承诺）。
2. 确认交互走**共享行组件的一个默认值等于原值的可选 prop**（`confirmRemove?`），不要两端各写一个对话框：`OrganizerList.tsx:452` 那个 `Pressable` 是唯一的按下点，加 prop ⇒ 两端零改动拿到同一套语义。这与 §11.3 归档出口、批次二 W4b `dayMarker?` 是同一个配方。
3. 词条：`common.organizer.confirmRemoveTag` + `…impact`（中英各两条），措辞必须包含"任务不会被删除，只是不再带这个标签"。
4. 判据：① 共享层 `liveTaskCountOfTag` 那条"含已完成的任务也要算"（变异：换成 `openTagCounts` ⇒ 红）；② 两端各一条"点删除**不**立刻写 op、确认才写"（变异：把 `confirmRemove` 的默认值改成'立即删' ⇒ 两端各红）；③ 一条形状锁：`ProjectsPanel.tsx` / `TagsSection.tsx` 剥注释后不许再出现"直接 `removeTag(`"。

**本轮不做的唯一理由（撞车现量）**：`git status --porcelain -- packages/ui/src/projects/OrganizerList.tsx` = `M`，而其未提交 diff 正是**重写 `OrganizerRow` 的后半**（`flexWrap`、`actions` 样式组、`:380-470` 整段挪动），删除按钮就在那一段里。此时加 prop = 造一次没人能干净解的三方冲突。**撞车的判据是同一文件的未提交 diff，不是"某条线在忙"的印象。**

### 11.10 批次 B 的两条外部红（都不属于本批，也都不是"改绿"的对象）

1. `packages/legal` 2 红（`tests/structure.spec.ts:466` 与 `:500`）。
   - 症状：文案写 16 处级联 / 15 张表，判据现量 19 / 18，并点名三张没有类别名的表 `revoked_sync_devices, vault_key_packages, vault_key_migrations`。
   - ⚠️ **归因先前写错过一次**（我记成"`server/prisma/schema.prisma` 的改动"）。真源不是那个文件：**级联条数是从 `server/prisma/migrations/**` 的 SQL 逐条约束推出来的**（见 `structure.spec.ts:395-420`，含"约束名不是 `<表>_<列>_fkey` 形状就响亮地失败"那一段）。
   - 现量：`git status --porcelain -- server/prisma` ⇒ `M server/prisma/schema.prisma` + **4 个未跟踪迁移目录**（`20261009000000_add_vault_key_packages` / `20261010000000_add_revoked_sync_devices` / `20261011000000_atomic_vault_key_migration` / `20261012000000_stage_vault_key_migration`），全部属于并行那条 E2EE 密钥线。
   - ⇒ 这是 §7 那一族"**只在混合工作树成立**"的红：相对 **HEAD** 它是绿的（HEAD 的迁移目录推出来正是 16/15，与文案一致），相对**活树**它是真的。**闭合动作属于那四张表的作者**（提交迁移时必须同时补文案的 16/15 与三个类别名），不是本批代改 —— 代改等于把对外文案钉在一个**还没提交的真源**上。
2. `pnpm check:docs` rc=1 的两条见 §11.7 末尾：一条在别人的 countdown 文档里，一条的成因是本批按指令**没有提交**。


### 11.11 批次 B 的收口读数（2026-10-03 22:4x，全部带现量命令）

**全量单元测试**：`pnpm -r --no-bail --filter '!@heyta/sync-server' test`（`/private/tmp/full-test2.log`）
⇒ 19 个包 **8207 passed / 13 skipped / 2 failed**（随后给新门禁加第 5 条，landing 1307→1308，总数 **8208**），唯一失败的是 §11.10 那条外部红（`packages/legal`）。
⚠️ 第一次跑用的是**默认 bail**，`packages/legal` 一红就截断了整条链（只有 6 个包报了数）—— 那一趟的"读数"是**探针截断**，不是结果；改成 `--no-bail` 才有 19 个包。这是 §7 那族"报 0 条是因为数法错了"的下一种面目：**报少了不等于没跑**。

本批增量后的逐包读数（对照 §11.5 的 20:2x）：domain 841→**842**、ui 484→**498**、app-host 1020→**1052**、mobile 637→**652**、web 1571→**1581**（+13 skipped 不变）、landing 1303→**1308**（新门禁 5 条）、sync-client 113→**114**，其余 node-host 165、desktop 12、op-log 100、widget-core 193、storage 378、design-system 489、ai 222、local-api 103、shared-schema 110、sync-core 303、i18n 22、legal 64 passed + 2 failed。

**静态门禁子集**（`bash /private/tmp/w6-gates.sh`，21 条）：**20 条 rc=0**（`layering / ui-provider / design / text-color / rn-aria / empty-state / theme / materialized-reads / ai-tools / ai-coverage / claims / reachability / op-log-semantics / script-snapshot / journey-coverage / mobile-settings / native-bare / docs-voice / ui-language`，`check:docs` 另跑）。

**唯一一条红：`check:l4`（内联样式只减不增的棘轮），且不是本批的。** 现量分三步：

```
# 1) 本批在 apps/web/src/features 贡献了几处内联样式？
HEAD 合计 = 106，工作树（已跟踪文件）= 106  ⇒ **净增 0**
# 2) 那"110 > 基线 104"从哪来？
git status --porcelain -- apps/web/src/features  ⇒ ?? apps/web/src/features/sync/VaultSettingsPanel.tsx
   （并行密钥线的新文件，里面 12 处 `style={{`；另有 2 处是**已提交**的增长）
# 3) 移动端那一腿
✅ apps/mobile/src/screens 内联样式 90 处，恰在基线 90（本批 TrashScreen 新加的那一行只有 variant/tone，没有 `style={{`）
```

⇒ 这条红 = **已提交债 + 别人未提交的新文件**，落在并行会话手里。本批既不吸收它凑绿，更**不把基线从 104 调到 110**（门禁自己的输出就写着这两条禁止项）。闭合动作属于那两个文件的所有者：把 `VaultSettingsPanel` 的内联样式换成共享模式组件，或由产品负责人就"基线要不要随 M3 迁移进度重设"拍一次。

**没跑的重门禁（写明没跑，不算绿）**：`check:ai-e2e`、`check:landing-e2e`、`check:privacy-consent-e2e`、`check:macos-window` / `macos-shell` / `windows-shell` / `linux-shell`、`screenshot:verify`、`check:mobile-bundle`、`pnpm reinstall:all`。
现量理由（22:4x）：`uptime` 报 **load average 39.53**，`pgrep -fl playwright` 抓到 **5 个以上** `chrome-headless-shell` 在跑（并行会话的浏览器验收正在进行）。本仓纪律是这些载体**必须串行**，且 `check:ai-e2e` 会 SIGKILL 别人的 vite（§7 第 87 条）。
⇒ 这批重门禁里**与本批有关的只有 `check:landing-e2e`**：本批改了落地文档中心一个分区锚点（`tasks-only` → `what-the-trash-holds`，3 个文件 5 处，`grep` 现量残留 0）。这条风险**没有留给浏览器验收**，它落成了常驻判据：新门禁第 5 条调 `docsFiguresOf()`（对找不到的分区是**抛错**而不是静默丢图），**变异臂 H**：把 `helpFigures.ts` 里 `W07` 那一处的 `sectionId` 改回旧名 ⇒ **恰好 1 红**，报的正是"配图挂在不存在分区上"，还原后 sha256 逐字节相同、`typecheck` rc=0。⚠️ 浏览器那一趟**仍未跑**（本批没有主张它的读数）：它验的是渲染形状，而这一条风险住在注册表映射层，两者不互相替代。

### 11.12 W6-a / W6-b ✅ 回收站那一路合并搬进领域层（第三个宿主是逼出它的东西）

**起因（不是"少写点代码"）**：W6 的判据 ④ 要在**笔记本**上断言"回收站里也列出那条清单"，
而 `apps/node-host` 当时**根本没有这个读通道** —— 它的 `trash` 只列任务，且那份四路合并
在 `packages/ui`（`trash/model.ts`）里，node 进程 import 不动（RN 是 Flow 源码）。
于是"同一台设备的同一个回收站"有了两个答案：界面四类、CLI 一类。缺读通道与真的没收到
在输出上长得一模一样（§7 元规则一）。

| 步 | 落点 | 一条现量 |
|---|---|---|
| W6-a 归属 | `packages/domain/src/trash-rows.ts`（166 行，新）：`TRASH_KINDS` / `toTrashItems` / `liveTaskCountOfProject`；`NOTE_EXCERPT_LENGTH` 从 `packages/ui` 挪进 `notes.ts` | `packages/ui/src/trash/model.ts` **已删除**；`ui/src/index.ts` 那 8 行转出摘掉，不留兼容再导出 |
| 三宿主改读同一份 | `apps/web/.../TrashView.tsx`、`apps/mobile/.../TrashScreen.tsx`、`apps/node-host/src/host.ts` | `packages/domain/tests/trash-rows.spec.ts` 里"三宿主同源"那 6 条：存在性（`toTrashItems(`）+ 形状禁止（`deletedAt ?? updatedAt`、`b.deletedAt - a.deletedAt`、`noteExcerpt(…, <数字>)`） |
| W6-b CLI | `host.trashRows()` / `host.listNotes()` 上到 `NodeHost` 接口；`cli.ts` 的 `trash` 改吐四类、新增 `notes` | `apps/node-host/tests/trash-rows.spec.ts` **8 passed**（真 SQLite）+ USAGE↔`case` 对账门禁 |
| 探针去重 | `settle_foreground` / `dismiss_permission_dialog` / `tap_tab` / `blame_crash` 从 `verify-mobile-notes.sh` 搬进 `scripts/lib/mobile-e2e.sh` | 四段函数体 `awk`+`md5` 逐字节相同；notes 脚本 522→**521** 行、11 个调用点没动 |
| W6-c 脚本 | `scripts/verify-mobile-trash.sh`（六条判据，含第 0.5 步的元判据）+ `package.json` 与 `check:script-snapshot` 注册 | 元判据现量 **0**（真文件）/ **1**（临时副本里塞一条 `phone_sync`）；`bash -n` 通过；快照门 `✅ 36 个脚本` |

**变异读数（2026-10-04 0:3x 重跑；上一批读数跨了上下文压缩，不拿旧数报）**

| 臂 | 只拿掉哪一处修复 | 领域层 | node-host | web |
|---|---|---|---|---|
| A1 | `toTrashItems` 里 NOTE 那一路不并入 | **8 红** | **2 红** | **6 红** |
| A2′ | 成员判据把 `purgedAt` 那一半漏回来 | **3 红** | 0 红 | 0 红 |
| A3 | 排序退回只按 `deletedAt`（丢 id 决胜） | **2 红** | 0 红 | 0 红 |
| A4′ | CLI 的 `trash` 退回 `host.listTrashed()` | —— | **1 红**（新加的 CLI 形状锁） | —— |

🔴 **A4 第一次跑是 0 红，这条臂本身才是本轮 W6-b 的真正产出**：上面那些判据测的是
宿主层的 `host.trashRows()`，而 **CLI 那句"取哪一路"没有任何东西在看**。补的判据是形状锁
（读 `src/cli.ts`，钉 `case 'trash'` 块必须调 `host.trashRows()`、不许出现 `listTrashed(`）。
⚠️ 它是形状锁不是行为验证：真把四类打进行为需要跑子进程，而 CLI 要先 `auth` 才碰库 ——
**这条成本登记在这里，没假装已做**。

⚠️ A2′ / A3 在 node-host 与 web 上 0 红，**不是判据没牙，是输入够不着**：宿主那两路的入参来自
`listTrashed()` / `listTrash*()`，**已彻底删除的条目在动作层就被滤掉了**，而"同一毫秒删除的两条"
真动作也造不出确定值。这两半只有直接喂原始表的领域层判据能钉 —— 覆盖分工，不是缺口。

⚠️ 两条命令性的教训（都在这一批现量到）：
1. **变异臂必须自证载体变了。** 第一版 A2 让 `pnpm --filter @heyta/domain build` 在 DTS 阶段红
   （`inTrash` 变成未使用），而判据跑的是 **dist** —— 那次报的"node-host 全绿"同时可能是
   "判据没牙"和"变异根本没进载体"。重跑改成 `inTrash(x) || x.purgedAt !== undefined`
   （保留 `inTrash` 引用，构建干净）并**先打印 dist 里变异针脚的命中数**，再报红集。
2. **还原一律按字节回写、放在每臂自己的 `finally` 里。** 前两版分别用"字符串再替换"和
   "try 体内还原"，都被异常跳过过一次，**两次都把变异体留在了共享工作树里**（一次连 dist 都照它重打了）。
   构建失败在这一版里是一条读数（`BUILD=…`），不是异常。

### 11.13 W4b ✅ 标签删除确认（撞车解除后当轮做完，不是登记）

§11.9 把它停在门口时给的理由是"`OrganizerList.tsx` 正被别人整段重写"。
2026-10-03 23:5x 现量：那五个落点（`OrganizerList.tsx` / `projects/model.ts` /
`project-actions.ts` / `ProjectsPanel.tsx` / `TagsSection.tsx`）**逐个都是干净的** ⇒ 条件已经不成立，
这一单当场做掉。**撞车的判据是同一文件的未提交 diff，不是写下结论时的那个瞬间。**

| 步 | 落点 | 说明 |
|---|---|---|
| 取数 | `packages/ui/src/projects/model.ts#liveTaskCountsByTag` | 与 `openTagCounts` **差一条滤**：影响面含已完成（`isLive` 判据）。§11.9 原写的是 `liveTaskCountOfTag(tasks, tagId)`，落成 map 是因为行要的是按 id 查表 |
| 交互 | `OrganizerList.tsx`：`labels.confirmRemove`（四句文案）+ `removeImpact`（按 id 的影响面） | 传了文案=打开这一步；省略=按下即 `onRemove`，渲染与从前逐字相同。armed 态收掉原删除按钮，确认行走 `accessibilityLiveRegion="polite"`；改名与"先确认"互斥 |
| 两端 | `ProjectsPanel.tsx`（标签那一列）、`TagsSection.tsx` | 移动端为算影响面第一次读了 `createTaskActions(host).listTasks()`（在 `dataRevision` 订阅内，`check:materialized-reads` 绿） |
| 词条 | `common.organizer.confirm.{ask,impactTags,delete,cancel}` | 中英各 4 条成对；`impact` 那句写清"任务不会被删除，只是不再带这个标签" |
| 判据 | `packages/ui/tests/projects-model.spec.ts` +5、`apps/web/tests/projects-panel.spec.tsx` +7（含把原来那条"按下即删"改掉并写明为什么改）、`apps/mobile/tests/projects-sections.spec.ts` +5 | 另有设备级判据并入 `verify-mobile-trash.sh` 第 6b 步（点一下不写 op / 取消不写 / 确认恰好 +1 条 `TAG/DEL`） |

**变异读数（只拿掉修复，同一台机器同一晚）**

| 臂 | 拿掉什么 | 读数 |
|---|---|---|
| M1/M7 | armed 分支改成直接 `onRemove`（闸门没了） | web **7 红** |
| M2 | 宿主把 `removeImpact` 传成 `tagCounts`（口径顶替） | web **恰好 1 红** —— 只有"常驻计数=1 与影响面=3 同时在场"那条抓得住 |
| M3 | 移动端没打开确认 | mobile **1 红** |
| M4′ | 组件里 `impact <= 0` 那一半闸门去掉 | **0 红**（见下） |
| M5 | `liveTaskCountsByTag` 也滤已完成 | 领域 **2 红** + web **1 红**（mobile 源码级判据不受影响，已单独复跑确认） |
| M6 | 组件里多一个不受文案挡的 `onRemove(item)` | mobile 形状锁 **1 红**（`onRemove` 调用点数 = 2 那条） |

⚠️ **M4′ 是一条没有牙的腿，如实写**：两个宿主传进来的 map **永远不含 0 键**
（`liveTaskCountsByTag` 只在命中时建键），所以"影响面为 0 也不画句子"这半条在现有载体下不可观测。
保留它的理由是**与同一组件里 `counts` 的 `> 0` 形状对称**（组件契约"只在非零时渲染"），
不是因为有任何判据在守它 —— 将来给第三个宿主接 `removeImpact` 时，这半条才第一次有被需要的可能。

⚠️ 顺带照出来并当场改掉的两处过期注释：`OrganizerList.tsx` 文件头把"删除确认"划给宿主
（而两端都没做 —— 那句"分工"其实是一句没人认领的 TODO）；`projects/model.ts` 第 3 条同款；
`TagsSection.tsx` 的"不改名"早被 10-03 那批否证。三处都**留原句 + 划线 + 写清为什么错**，
没有原地抹平。
