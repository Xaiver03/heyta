# 性能热路径审计：哪些代码会随数据量恶化

**日期**：2026-10-03 · **方法**：7 条线并行读码（同步内核 / 存储层 / 定时器普查 / Web 渲染 / 共享 UI 与移动端 / 服务端与索引 / 编排层计算量）。其中三条首趟不合格被**重派并已于 20:10 收齐折入**（同步内核 53 KB / 存储层 52 KB / Web 渲染 19 KB），**本文 11 条 P0 每条都由本次会话在源码里逐条复核过**（复核方式与读数写在条目内），**一条子 Agent 的 P0 因频率判错被当场降级**（→ §5 第 4 条），**一条整份编造的报告已作废**（→ §5 第 1 条） · **性质**：**只读审计，零源码改动**

**判据沿用本仓库既有纪律**：AGENTS.md §8 第 3 条「测试要能失败 —— **不能失败的检查没有价值**」——所以每条发现都附一栏**「这条判据怎么才会红」**。没有那一栏的条目一律标 🟡 未闭合。

---

## 0. 一句话结论

**渲染侧是全仓最贵的一面**：`apps/web`、`apps/mobile`、`packages/ui` 三处 **`React.memo` 命中 0 次**，而 `apps/mobile/src` 里 **`FlatList`/`SectionList`/`FlashList` 命中 0 次**、整个共享层只有 `packages/ui/src/task-list/TaskList.tsx` **一个** `FlatList`，且它每个使用点都被宿主自己的 `ScrollView` 套住 ⇒ **虚拟化结构性不成立**。这三条相乘的结果是：**一次本地写入 = 全部任务行重建**，**一次同步 = 重建三遍**。

**数据侧最贵的一条是「已缓解但只缓解了被测的那一半」**：[ADR-0047](../adr/0047-checkpointed-incremental-hydration.md) 登记的 `100k op 全量重放 9.5672s → 用 checkpoint 约 30.9ms` 是**读路径**；checkpoint 的**写路径**每 250 条应用记录触发一次、每次都序列化**全量状态 + 全部历史 op id** 再跑两遍同一次 FNV 校验，量级是 **O(N²/250)**。

**服务端最贵的一条是「每 op 的发数」**：一次上传批次在同一个事务、同一个连接上打 **约 5–6 发查询/op**，且**每 op 自增一次同一行** `user_sync_state`。

**取数层的两条是本次审计最"便宜可修"的一条和最"隐形"的一条**：习惯连续按**活了多少天**逐日走（每步 4 次日期解析，上限 7300 步），而 web 的成长视图五个选择器**一个 `useMemo` 都没包**、`apps/web/src/App.tsx:723` 每 60 秒换一次 `now` ⇒ **开着不动也每分钟付一整轮**；移动端同一个视图已经全包在 `useMemo` 里 —— 修法现成。另一条是提醒读侧 **O(任务数 × 提醒数)** 挂在**每一条 op** 上（`onEngineChange`）。

🔴 **20:08 收齐后三条扫描线，结论层的重心变了。现在最贵的三条是：**

1. **`packages/op-log/src/state.ts:545` 的整桶复制（P0-8）** —— 物化每一条 op 都展开该桶的**全部**实体 ⇒ 单次写入 O(T)、冷启动重放 O(N·T)。**它不受 `checkpointEvery = 250` 节流**，所以它比已定论的 checkpoint 那条（P0-2）更常付：每一次启动、每一条 op。
2. **Web 首屏是一个 1,936,369 B 的单文件 JS（P0-9）** —— 其中 **781,062 B 是两份语言表**，而任何时刻只显示一种。这条不需要"要不要懒加载"这种产品决定就能修掉一半。
3. **上传把 per-op `encrypt()` 放进 `Promise.all`（P0-11）** —— 会话**首批**并发跑 N 次 Argon2id、每次 64 MiB。🔴 **同一个包的解密侧已经把这件事写成禁令并改成了串行**（`packages/sync-core/src/encryption.ts:263-269`），现成的 `encryptBatch` 生产零调用点。症状形状是"装好后第一次同步特别吃力"，因此最容易长期躲过观察。

📌 一条贯穿性的更正：**"数据量还小所以不急"这个论证在本文里不成立** —— P1-13 实测 `archiveUpTo` 与 `limitVectorClockSize` 的**通道全部建好（接口声明 / 实现 / worker 转发 / server import+re-export）而调用点为 0** ⇒ 日志与向量时钟维度**只增不减**（服务端的 `MAX_ACCEPTED_VECTOR_CLOCK_ENTRIES = 4096` 是**拒绝型**闸门、不是压缩），本文所有 O(N)/O(N²) 项的系数是单调上升的。

---

## 1. 取证分层（先说清哪些数是我自己拿的）

这份文档刻意把三种可信度分开写，因为**本次审计里出现过一条路径和符号都是编造的 P0**（见 §5）。

| 层 | 含义 | 本文里的标记 |
|---|---|---|
| **实测** | 本次会话跑过的命令，数字可复现 | `📊 实测` + 附命令 |
| **读码复核** | 本次会话打开过那个文件、引用的是原文 | `✅ 已复核` |
| **未复核** | 来自并行子 Agent，我没在源码里确认 | `⚠️ 待复核`，且**不进 P0** |

三条全仓计数的复核命令（本文所有 0 命中结论都出自这三条）：

```bash
# ① 三个 UI 面里 React.memo 的命中文件数 → 全是 0
grep -rlE '\b(React\.)?memo\(' apps/web/src packages/ui/src apps/mobile/src | wc -l
# ② 移动端有没有任何虚拟化原语 → 0
grep -rn 'FlatList\|SectionList\|FlashList' apps/mobile/src | wc -l
# ③ 共享层里 FlatList 住在哪个文件 → 只有 TaskList.tsx
grep -rl 'FlatList' packages/ui/src
```

**同时成立的对照**（说明这不是"没人关心性能"）：`useMemo|useCallback` 在 `apps/web/src` 有 **100** 处、`packages/ui/src` 有 **112** 处（20:08 现量）。⇒ **记忆化用在数据上，从来没用在组件边界上。**

> ⚠️ **这两个数字是会漂的，照抄就等着它变错。** 同一条命令在本轮中的读数序列是 **98 → 100 → 112**：`apps/web` 从 98 涨到 100，`packages/ui` 从 107 涨到 112 ——
> 因为有并行会话正在改这两处（本文 §1.1 那三个未入库的日历文件就是他们的工作）。要当前值就重跑上面那两条命令，不要引用本文的数。
> 所以这类计数**必须以命令为准**、只作为"当时读到什么"的记录，不能作为事实本身引用。
> 上面三条 0 命中的判据不受影响（它们数的是"有没有"，不是"有多少"）。

### 1.1 引用完整性自检（本文全部 `file:line` 的机械核对）

一份审计文档最坏的失效方式不是数字不准，而是**引用的文件根本不存在**（本文 §5 就记录了一次）。所以全部引用做过一次机械核对（下表读数 = **19:36 现量**；⚠️ 这张表**会随本文档自身改动而漂** —— 它自己就包含一条被统计在内的示例引用，所以引用它时请重跑脚本，别照抄数字），脚本在 `/tmp/heyta-perf-scan/cite-audit4.mjs`（一次性探针，**建议后续收进 `scripts/` 当常驻门禁**——它对本仓库是通用的，任何一份带 `file:line` 的调研都能用）。

| 读数 | 数量 | 含义 |
|---|---|---|
| 唯一引用 | 143 | 按 `path.ext:N` 与同行 `` `:N` `` 继承上一文件抽取。**读数出自 v5、20:25 那一趟**（v4 报 112、更早报 85/105）—— 三版差异见下面"歧义"那格的 🔴 |
| 入库 + 行号在范围内 | **126** | ✅ 干净检出上可复现（v4 报 95） |
| 行号越界 | **0** | 没有"`:300` 但文件只有 280 行"这种。**v4/v5 两版在这格一致 —— 所以本表承重的那一格不依赖探针版本** |
| 歧义（裸文件名命中多个） | **5** | 🔴 **v5 报 5 条，且这 5 条全部是「举例身份」、没有一条是该修而未修**：`App.tsx:723`（示范裸名为什么会指错文件）+ 本单元下面为描述 #185 而写下的 `App.tsx:789`、`index.ts:62`、`host.ts:358`、`encryption.ts:263`。改掉等于把示范弄丢。本轮真实修掉的裸名共 **8 处**（前一趟 6 处 + 折入三条扫描线时新引入 2 处：`App.tsx:789`、`index.ts:62`，都在 20:09 那次重跑里被抓到）。<br>　　📌 **这条自检连着三次抓到我自己**：第一次报 4 处歧义，补完全路径后**重跑又报 2 处新引入的** —— `publish.ts` 与 `apps/web/src/pwa/publish.ts` 同名、`selectors.ts` 与 `apps/web/src/features/motivation/selectors.ts` 同名；20:09 折入新三条时**又**引入 2 处。而那两处都是我在上一次改写里亲手写进去的，肉眼过一遍完全没看出来。⇒ **这类判据必须每次改动后重跑，一次通过不代表以后通过。**<br>　　🔴 **20:10 新机制（比"读者开错文件"严重一档）**：歧义会让**复核本身失效，而且复核下来是"证实了"**。折入三条扫描线时我按歧义引用去核，实际发生三次 —— `host.ts:358` 命中三个文件，我读了 `packages/app-host/src/host.ts` 那份、看到 `getAllOps()` 就以为确认了 P0，而真正的落点在 `apps/web/src/lib/oplog.ts`；`client.ts:906` 被子 Agent 归到 `sync-core`，真身是 `packages/sync-client/src/client.ts`（行号却完全对得上）；`sqlite-adapter.ts` 少了 `sqlite/` 子目录。**同一个裸文件名在另一个包里的"长得像的那一行"，足以让一次复核得出错误的确证。** ⇒ 复核别人的引用时，先把裸名 `git ls-files` 展开成全部候选、逐个看完，不能只看第一个。<br>　　🔴 **20:20 自检探针自己被抓到坏了**：v4 把一行里的裸 `` `:N` `` 挂给**该行最后一个**路径 token，而不是**它前面最近**的那个 ⇒ 对「…（``:49`` 某代码），``package.json`` 里…」这种行文，它报出一条根本不存在的「package.json 的第 49 行」歧义。v5 改成单遍按位置扫描后该假歧义消失。**代价**：v5 会把 `` `Object.values:110` ``、`` `labels.dayTitle:246` `` 这类**被反引号包住的代码 token**当成路径承接点 ⇒ "非路径 token" 5→9、"唯一引用" 112→145。⇒ **两版各有已知误伤，v5 不是严格更好**；本表以 v5 为准的理由只有一条：它消除了那个结构性缺陷，而**承重的"行号越界"两版一致为 0**。 |
| **存在但未入库** | **6** | ⚠️ 见下（20:20 比上一趟多出**一整组 3 条**：`packages/storage/src/checkpoint.ts:6/:14/:41` —— 它是 ADR-0047 的配套实现、`??` 未跟踪，而本文 P1-16 的三条证据全落在它身上） |
| 非路径 token | 6 | 5 条是脚本误伤（`Object.values:110/:137/:151`、`labels.dayTitle:246`、`JSON.stringify:41` —— 被反引号包住的**代码 token**，v5 会把它们当路径承接点）；`packages/shared-schema/src/line.ts:101` **是本文 §5 故意引用的那条编造路径，它必须报"不存在"** |

🔴 **"存在但未入库"分成三组，是本轮最需要后来者知道的一件事**（表里那个 6 是 v5 在 20:25 的读数；第 3 组是 21:44 现量补的，v5 再跑应报 **7**）：

```
第 1 组 · 日历线（3 条）
packages/ui/src/calendar/CalendarDayBoard.tsx:179
packages/ui/src/calendar/CalendarYearBoard.tsx:246 / :300

第 2 组 · ADR-0047 的配套实现（3 条）🔴 20:20 新增
packages/storage/src/checkpoint.ts:6 / :14 / :41

第 3 组 · 取数脚本本体（1 条）🔴 21:44 新增
scripts/measure-hydration.mjs        ← 文件在磁盘上，但 git 没跟踪它
```

第 1 组：这三个文件此刻是 `??`（**别人工作树里的未入库文件**），而同目录的 `CalendarBoard.tsx` 是 `M`（正被改）。也就是说本文 P0-1 的四个宿主之一、以及 P1-4 / P2-1 的**行号是别人在飞代码的瞬时读数** —— 在干净检出（CI 的唯一形态）上这些行号**指向一个不存在或不同的文件**。这不是本文的错，但它意味着：**照 §8 动手做那几步之前必须重新 `grep -n` 现量**，并且那一片正被并行会话整片重写（AGENTS.md §9 倒数纪念日那节明写了 W6 的落点就是 `packages/ui/src/calendar/*`）。

🔴 第 2 组更要紧，因为它**是这一趟才出现的**：本文 **P1-16 的三条证据全部落在 `packages/storage/src/checkpoint.ts` 上，而这个文件现在是 `??`** —— 它是 [ADR-0047](../adr/0047-checkpointed-incremental-hydration.md) 的实现，与那批未跟踪的 ADR 属同一趟工作。⇒ "同一份 state 被 stringify+hash ≥2 遍"这条今天在本机可读、在干净检出上引的是一张还不存在的文件。**它随那批 ADR 入库而自动变合法；若不入库，P1-16 必须改写成引用 ADR 的文字描述而不是代码行号。** 这是本文目前唯一一条**证据本体依赖别人提交**的条目，接手前先跑下面第二条命令。

第 3 组是 21:44 补的，性质和前两组不一样：`scripts/measure-hydration.mjs` **磁盘上有、git 没跟踪**，而本文 §6 拿它当"实测 9.5672s → 30.9ms"的出处。⇒ 它和 ADR-0047 那批是同一趟未提交工作的一部分；**这一条读数在干净检出上无法复现**，引用它时按第 2 组同样的规则处理（要么它入库，要么 §6 那格改写成"由 ADR-0047 记录"而不是脚本路径）。

复现：

```bash
git status --porcelain packages/ui/src/calendar/            # ?? = 未入库；M = 正被改
git status --porcelain packages/storage/src/checkpoint.ts   # 当前输出 "?? …" ⇒ 未跟踪（P1-16 的证据所在）
git ls-files --error-unmatch scripts/measure-hydration.mjs >/dev/null 2>&1 \
  && echo "tracked" || echo "UNTRACKED（磁盘上：$([ -e scripts/measure-hydration.mjs ] && echo 有 || echo 无)）"
```

🔴 **本节自己的一次"探针消失"事件（21:4x），以及它为什么必须记在这里**：v5 那份 `cite-audit5.mjs` 和三条扫描线的报告产物**一起从 `/tmp` 消失了**（详见 §7 第 14 条的时间窗）。21:43 我按 v5 的设计要点（单遍按位置扫描 + 裸行号挂给前面最近的 token + 歧义只对裸名成立）重建了一份 `v5r` 跑通，读数是：

| 格 | v5（20:25 趟，探针已失） | **v5r（21:50 末次跑）** | 两版是否可比 |
|---|---|---|---|
| 引用出现次数 | 未单列 | **391** | v5r 新增的一格（单位：token 出现次数，非去重） |
| 唯一引用 | 143 | **194** | ⚠️ **不可直接比** —— v5r 把裸行号继承、缩写路径的解析结果一并计入 |
| **行号越界** | **0** | **0** | ✅ **两版一致；且 v5r 在 21:43 / 21:49 / 21:50 三趟里都是 0。本表承重的还是这一格** |
| 歧义（裸名多命中） | 5 | **35 行 / 去重 9 个裸名**（`App.tsx` `index.ts` `host.ts` `encryption.ts` `compression.ts` `package.json` `publish.ts` `selectors.ts` `vector-clock.ts`） | ⚠️ **口径不同**：v5 按"该修而未修"分类只留下 5 条、且全部是举例身份；v5r 按**每一行 occurrence** 计，且把 `package.json`（23 个候选）这类"行文中提及、不指向某个位置"的用法也算进来 ⇒ **35 与 5 不构成互相否证**，谁都不能拿来推翻谁 |
| 未入库 | 6 | **41** | 🔴 **v5r 带着本节 ① 那个已知缺陷**（把简写引用当全路径解），所以 41 里有一整类是 `features/quadrant/QuadrantBoard.tsx` 这种**缩写**，不是新发现的 35 条缺陷。逐条看过后真正的新事实只有 1 条，就是上面第 3 组 |
| 非路径 token | 6 | **101** | ⚠️ v5r 这一格最松：它把所有 `` `a.b` `` 形式的代码 token 都收进来（`React.memo`、`Promise.all`），与 v5 的"被反引号包住的代码 token"不是同一集合 |

⚠️ **v5r 自己的读数在一小时内漂过三次**（21:43 = 371/192/22/39/99 → 21:49 = 389/192/35/41 → 21:50 = 391/194/35/41/101），**漂的原因全是我在往本文里加内容**（§7 第 14/15 条、§1.1 本节自身），不是仓库变了。⇒ 这类"文档自指"的判据必须写清**哪一格随文档长度变、哪一格不随**：这里唯一不随的是「行号越界 = 0」，其余五格都在跟着本文的字数走。**22:21 = 442 / 206 / 越界 0 / 歧义 40 行（去重 10 个裸名）/ 未入库 41 / 非路径 106；22:25 = 447 / 207 / 越界 0 / 歧义 40 / 未入库 43 / 非路径 107** —— 涨的原因仍然全是本文在加内容（§1.1 的第二把尺子那一节、§5.2 g、§7 第 16 条）。⚠️ **记录这件事的那句话本身就是一次漂移源**：22:21 → 22:25 之间只隔了一趟"把 22:21 的读数写进文档"的编辑。⇒ 这类格子的正确用法是**只读两个 0**（越界、空行/纯闭合），其余四格当"这一趟的现场"，不拿来比较两趟。

📌 **这条重建事件的可迁移结论，和本节 a/b/c 是同一族**：探针**必须落进仓库**才有第二_life_。放在 `/tmp` 的自检脚本，它的读数就有一段"只有作者本人、只有这台机器、只有这段时间"的有效期 —— 而文档里如果只抄读数不抄判据，读数一消失，下一轮就**无法分辨"结论变了"还是"尺子没了"**。这次靠得住的只有「行号越界 = 0」，因为它是**两版独立实现都给 0** 的那一格。
⚠️ 未做（明确登记，不说"已完备"）：v5r 的缩写路径解析缺陷没修（修法就是把本节 ① 的候选集从 `git ls-files` 换成"磁盘 + 跟踪集"并允许尾段匹配）；本节 a 那条"举例身份要免检"在 v5r 里也没实现 —— 所以 v5r 报的 9 个歧义裸名里，`App.tsx` / `index.ts` / `host.ts` / `encryption.ts` 等仍是 §1.1 表里说明过的**示范用法**。

⚠️ 写这段自检的过程中，脚本前两版各自造过一批假阳性，都是同一族的新面目：
① 把仓库根相对路径之外的**简写引用**（`App.tsx:723`）当全路径解 → 报 34 条"文件不存在"；
② 用 `git ls-files` 当全集 → 把**存在但未入库**的文件误报成"不存在"，把最该单独列出的那一类混进了错误里。
⇒ 判"引用不成立"之前，先分清是**文档错了**还是**探针够不着**。

#### 第二把尺子：行内容 + 标识符邻近自检（22:03 首趟 / 22:14 复趟）

上面每一格回答的都只是"**那一行存在吗**"。这一把问的是另外两问 —— **那一行写的是我说的那件事吗**：

| 步 | 判据 | 首趟读数（22:03，124 条引用） | 修完读数（**22:21**，129 条） |
|---|---|---|---|
| 1 | 被引那一行**非空**，且**不是纯闭合符**（`}` / `)` / `];`） | 🔴 **5 条命中** | **0** |
| 2 | 同一句里用反引号包住的标识符，要出现在**被引行 ±10 行**内 | 32 条参与检查 · 未命中 **26** occurrence | 36 条 · 未命中 **24** |

⚠️ **未命中从 21 涨到 24 不是新缺陷，是本节自己在长**：多出的 3 条是 `packages/ui/src/habits/HabitBoard.tsx:645`、`packages/op-log/src/state.ts:545`、`packages/sync-client/src/client.ts:912` 落在「讲这件事怎么做」的句子里，同行的标识符属于句子的另一半 —— 与 §1.1 那格「只有『越界』不随本文字数漂」是同一条规律。承重格仍然是**两把尺子的 0**（越界 0、空行/纯闭合 0）。

🔴 **两把尺子合起来抓到 8 处真引用错误，而第一把尺子（"行号越界 = 0"）对这 8 处全部报绿** —— 因为那些行都存在，只是内容不是我说的事：

⚠️ **「改前」那一列故意不写成 `file:line` 形状**（写成「`client.ts` 的 905 行」）。原因不是排版：尺子是按 `file.ext:N` 语法扫全文的，把**已经作废的坐标**原样留在表里，下一轮跑尺子就会把它重新点成红 —— 而它不是本文的主张，是本文记录的**历史**。这与 §1.1 表里"举例身份要免检"是同一族：**机器可检的语料里只放本文主张为真的坐标**，历史用散文形状留。

| 改前的引用 | 我在文中说的话 | 22:0x 现量 | 改后 |
|---|---|---|---|
| `client.ts` 的 **905 行**（3 处） | 「`const ops = await Promise.all(batch.map(…))`」 | 那一行是分批循环里的 `if`；`Promise.all` 在 **`:912`** | `:912` |
| `client.ts` 的 **917 行** + 引文 `encrypt(…, password)` | 密文调用的形状 | 实为 **`:923`**，且接收者/形参是 `payloadCipher.encrypt(…, op)` —— **第二个实参是 op，不是 password**（我把语义写成了我以为的名字） | 逐字照抄源码 |
| `apps/mobile/src/App.tsx` 的 **103 行** | 「`startAutoSync` 的**唯一生产调用点**」 | 那一行是上一个 effect 的 `return () => subscription.remove();`，调用在 **`:118`**（`useEffect(() => startAutoSync(), [])`） | `:118` |
| `sync.routes.ts` 的 **149 行** | 「zod 只在服务端边界每请求跑一发」 | 那一行是 `config: {`；`SuperSyncDownloadOpsQuerySchema.safeParse` 当时在 163 行 | 按符号定位（该文件 ` M`，22:32 已到 166 行） |
| `Icon.tsx` 的 **94-101 行** 的 `HeytaIcon` 只吃 `IconNode[]` | 组件签名已经受控 | 那 8 行是 `ELEMENTS` **标签白名单**；`HeytaIcon` 在 **`:120`**，类型是 `HeytaIconData = readonly IconChild[]`（`:59`/`:72`）。`IconNode` 只出现在 `:16`/`:53` 的**注释**里，是"lucide 那边叫什么"的说明 | 换成真行号 + 真类型名 |
| `publish.ts:78-81` **三次** `Object.values` | 全量摊平的次数 | 那四行是 **4** 次（tasks/projects/habits/habitLogs）；同文件第 5 次在别处 ⇒ **引的行段是 4 行、写的次数是 3 次，两者自身就不自洽** | 四次，并逐个列出字段 |
| `CalendarYearBoard.tsx:246` 说 key 用 `index` | 下标当 key | 断言成立，但**变量名是 `rowIndex`**（`key={`row-${String(rowIndex)}`}`） | 措辞改准 |
| `HabitBoard.tsx` 的 **637 行** | 同上（index key） | 那一行落在一个 `<View>` 的 **props 中间**（`accessible`）；index key 实为 `:645`/`:657`/`:660` | `:645` |

🔴 **最后一条不是探针点出来的，是我人工顺路查出来的**，而它暴露了这把尺子的分辨率极限：**637 那一行差 8 行却被放过，因为 ±10 的窗口里正好有 `packages/ui/src/habits/HabitBoard.tsx:645` 那处真的 index key**。⇒ **窗口宽度就是这把尺子的分辨率**：放宽到 ±10 才能容纳"引用函数体内某行、用函数名做归属说明"这种合法写法（`state.ts:545` 的 `applyOperationToEntity` 定义在 `:498`，47 行外），代价就是"差 8 行"的错引用一律看不见。**结论：第 2 步只能当分诊，不能当判决** —— 本轮 26 条 occurrence 是**逐条人工 adjudicate** 的，不是读探针读数读的。

剩下的 occurrence（22:21 = 24 条，其中 21 条来自首趟那 26 条；10-04 00:1x 复跑 = 33 条，新增的 9 条属下面 ⑦ 那一类；**00:5x 再复跑 = 仍然 33 条** —— 这一趟文档又长了 §5.2 h 的否证表、§7 第 8/11/13/16 条的四段新正文和 §8 第 17 步，尺子 1 的"唯一引用"现量 **257**、引用出现次数 **540**、**行号越界仍然 0**、尺子 2 的 refs **162**，而未命中数一格没涨（⚠️ 上一格记的"唯一引用 194"出自 22:2x，期间本文长了六段正文，**两个数不可直接比** —— 这里只报现量、不报差值）。⇒ 这不是巧合：**新写的每一处行号都刻意用了"打断邻接"的形状**（路径与数字分写、不写成可被解析的 `file:line §N`），这正是 §7 第 13 条那条纪律的第一次**向前生效**，不只是事后复盘）**，全部判为探针假阳性**，七类，每类都记下来免得下一轮重查：

⚠️ 这一行原本写的是「**五类**」，而下面列到 ⑥ —— ⑥ 是后来加的，加的时候没回头改计数句。**本文自己刚在 P1-18 里批评过"注释里的复杂度断言没人守"，这里就是同一条纪律的反面教材：任何"N 类/N 条"的句子，加一项时必须改它。**
① **同行多引用**（主导类）：一句里 3 条 `file:line` + 3 个标识符，探针做 many-to-many，于是每条 ref 都被要求满足整句的词表；
② **函数名归属**（就是上面 ±10 那一类）；
③ **"某个词不存在"本身就是结论**：`pricing-store.ts:81` 那条 P1 说的正是"词表里**没有** `settled`"，探针按"标识符应出现"判它必错；
④ **注释里的 API 清单**（上一轮 `encryptBatch` 那条同一族）；
⑤ **复合标识符**：`\bindex\b` 匹配不到 `rowIndex`；
⑥ **点名一个"还不存在的载体"本身就是一次引用**：§7 第 16 条提议的 `research/tools/cite-self-check.mjs`，与此刻仍住在 `/tmp` 的那两个尺子文件名，各占一格"未入库/不存在"（22:25 那趟 未入库 41 → 43 就是这两条）。⇒ 这不是该修的缺陷，但**必须写明**，否则下一轮看到"未入库涨 2 条"会先怀疑代码，而真正变的是文档里新登记的一个计划。
⑦ **标识符与它自己的行号被写进了不同分句**（10-04 00:1x 新探明，本轮 33 条里有 6 条属于这一类）。两个亚种：**⑦a 外层函数名 vs 内层行** —— 引 `sqlite-adapter.ts:698` 时同句点名 `insertRow`，而 `insertRow` 的声明在 679（超出 ±10 窗口）；**⑦b 一句里跨两个文件** —— 说"web 那档没有第③遍"时同句出现 `db-op-log-store.ts:517` 与 `dataColumn`（后者的家在另一个适配器文件）。📌 **写法配方（比解释便宜）**：把标识符紧贴在它自己的行号后面 —— 「`sqlite-adapter.ts:679` 的 `private insertRow`，其中第 698 行…」一次消掉 ⑦a；跨文件的那半句改写成"另一个文件里"或干脆拆两句。本轮 P1-16 的③行已按这个配方重写。

⚠️ 这两把尺子仍然只住在 `/tmp`（同一节上面刚记过一次"探针消失"）⇒ 落成仓库门禁这件事登记在 §7 第 16 条，不假装已做。

**抽查一律按符号定位，不用裸行号** —— 原因是下面"第三把尺子"那一节：本文被引的文件里近半正被并行会话改着，**行号是一天之内会动两次的东西**。

```bash
grep -n "useEffect(() => startAutoSync" apps/mobile/src/App.tsx                       # 22:32 → 121（22:13 时是 118）
grep -n "SuperSyncDownloadOpsQuerySchema.safeParse" server/src/sync/sync.routes.ts    # 22:32 → 166（22:13 时是 163）
grep -n "const ops = await Promise.all" packages/sync-client/src/client.ts            # 22:32 → 912
grep -n "export function HeytaIcon" packages/ui/src/icon/Icon.tsx                     # 22:32 → 120
grep -nE ': Object\.values' apps/mobile/src/widgets/publish.ts                  # 22:32 → 恰好 78/79/80/81 四行
grep -n 'String(index)' packages/ui/src/habits/HabitBoard.tsx | head -3               # 22:32 → 645 起
```
（⚠️ 最后一条**必须用单引号**：pattern 里的 `` ` `` 在双引号里会被 shell 当命令替换执行，症状是"什么都没匹配"而不是报错。）

#### 第三把尺子：引用落在**活文件**上吗（22:32 新增；前两把都看不见这件事）

尺子 1 与尺子 2 有个共同的前提：**它们读的是当前磁盘**。可文档是在**更早的磁盘**上写的。⇒ 一个引用可以在被写下的那一刻完全正确、在被检查的那一刻仍然"行存在且内容对得上"、却在**下一次别人改过那文件之后**变成错的 —— **而这两把尺子对这种失效是永久盲的**（它们永远拿最新磁盘去比对，比对结果当然是"对"）。

普查命令（只依赖 git 与本文，可整块粘贴）：

```bash
D=docs/research/performance-hotpaths-audit.md
grep -oE '(packages|apps|server|scripts)/[A-Za-z0-9_./-]+\.(ts|tsx|js|mjs|json|css):[0-9]+' $D \
  | sed 's/:[0-9]*$//' | sort -u > /tmp/cited.txt
echo "被引全路径形状文件 $(wc -l < /tmp/cited.txt | tr -d ' ') 个"      # 22:32 实测 62
git status --porcelain -- $(tr '\n' ' ' < /tmp/cited.txt) | tee /tmp/dirty.txt | wc -l
echo "  其中 M $(grep -c '^ M' /tmp/dirty.txt) / ?? $(grep -c '^??' /tmp/dirty.txt)"   # 22:32 实测 26 / 3
```
🔴 **22:32 读数：被引 62 个文件形状里 29 个（47%）正在被动**（26 个 ` M` + 3 个 `??`）。⇒ 本文接近一半的 `file:line` 是**瞬时读数**，而不是仓库属性。
⚠️ **这块普查的范围要说清**：它只认**以仓库根开头的全路径形状**。把缩写（`client.ts:912`、`features/sync/store.ts:219` 这类）也解析回真实文件后再数，量大得多：**109 个引用形状 / 干净 46 · 正在被改 49 形状（69 处）· 未入库 6 形状（3 个文件、12 处）· 不可解析 8 形状**。⇒ **"近半"是按最保守口径给的**，宽口径只会更高；缩写解析需要候选集与歧义判定，所以那份实现只在 `/tmp` 的 `live-file-cites2.cjs` 里（连同尺子 1/2 一起挂在 §7 第 16 条那条"落成仓库门禁需要授权"的债上）。

而且**不需要假设它会坏 —— 它这一趟就坏了两处**：

| 引用 | 22:13 我校准时 | 22:31 复跑抽查块 | 成因 |
|---|---|---|---|
| `apps/mobile/src/App.tsx` 的 `startAutoSync` 调用点 | `:118` ✅ | 落到 `:118` 的**注释行**，真实调用已到 **`:121`** | 该文件标着 ` M`（提醒那条线在改） |
| `server/src/sync/sync.routes.ts` 的 `safeParse` | `:163` ✅ | 落到另一处 `const userId = …`，真实已到 **`:166`** | 同上，`M` |

📌 **这条的结论不是"再校一次号"** —— 再校一次也会在下次编辑后失效。可迁移的做法是**换引用的形状**：
① **按符号定位**（`grep -n "<符号>" <文件>`）而不是 `:N`，上面那块抽查已全部改成这个形状；
② 非写行号不可时（比如要指"这一行的代码形状"），**行号旁写清它是哪一刻的读数**，并把符号名一起写进来；
③ **`??`（未入库）文件上的行号单独立册** —— 它们不是"会漂"，是"在干净检出上根本不存在"（§1.1 第 1/2/3 组那 12 处就是这个性质，性质不同、处置也不同）。
⚠️ 这把尺子同样只住在 `/tmp`（`live-file-cites2.cjs`），且它给的 62/29 是**活读数**，下一趟必然再变 —— 要当前值就重跑上面那块。

---

## 2. P0（每条都 📊 实测 或 ✅ 已复核）

### P0-1 三条全仓事实：零 `memo` × 零虚拟化 × 整店订阅 ⇒ 一次写入重建全部行

- 位置：`packages/ui/src/task-list/TaskList.tsx:307`（唯一的 `FlatList`）、`apps/mobile/src/ui/kit.tsx:238`（`Screen` 默认 `scroll = true`）+ `:270`（那里就是 `ScrollView`）、`apps/web/src/App.tsx:197-198`（整店订阅：`useTaskStore()` / `useProjectStore()` 不带 selector）
- 代码形状：

  ```tsx
  // apps/mobile/src/ui/kit.tsx:238 / :270 —— 宿主默认给整屏套 ScrollView
  scroll = true,
  …
  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: t['space.4'], flexGrow: 1 }} …>
  ```
  ```tsx
  // apps/web/src/App.tsx:197-198 —— 不带 selector 的整店订阅
  const store = useTaskStore();
  const projects = useProjectStore();
  ```
- 频率与放大（🔴 **20:07 重测并更正本行原句**，原文写的是"共 9 个面"）：**无参整店订阅 = 19 处 / 跨 12 个文件**（20:07 测得 18/11；22:31 复跑涨到 19/12，多出的是未入库的 `apps/web/src/features/sync/VaultSettingsPanel.tsx` 一处 ⇒ 这条是**活读数**，随并行会话增删）。复现：

  ```bash
  grep -rnE '=\s*use[A-Za-z0-9_]*Store\(\)' apps/web/src | grep -v '\.test\.\|\.spec\.' | wc -l   # 22:31 现量 19（20:07 为 18）
  ```

  12 个文件（全路径，避免与移动端同名文件混；末位 `features/sync/VaultSettingsPanel.tsx` 是 22:31 复跑新增，且它 `??` 未入库）：`apps/web/src/App.tsx`、`features/quadrant/QuadrantBoard.tsx`、`features/calendar/CalendarView.tsx`、`features/calendar/CalendarSidebar.tsx`、`features/calendar/CalendarHeaderToolbar.tsx`、`features/focus/FocusTimer.tsx`、`features/projects/ProjectsPanel.tsx`、`features/habits/HabitsView.tsx`、`features/admin/AdminPanel.tsx`、`features/sync/SyncBar.tsx`、`features/tasks/TaskOrganizer.tsx`（前缀均为 `apps/web/src/`）。
  ⚠️ 原句错在哪：**"面"和"处"是两个不同的计数单位**，而一个文件里可以有多处（`apps/web/src/App.tsx:197-198` 本身就是两处）。写"9 个面"等于没定义单位，于是 `CalendarHeaderToolbar.tsx` 与 `TaskOrganizer.tsx` 两个文件整个漏掉了。行数级样本（子 Agent 报的位置**逐字对上**）：`apps/web/src/features/tasks/TaskOrganizer.tsx:62` `const projectState = useProjectStore();`；`CalendarView.tsx:67`、`CalendarHeaderToolbar.tsx:85`、`CalendarSidebar.tsx:208` 三处同为 `const view = useCalendarViewStore();`；`apps/web/src/features/focus/FocusTimer.tsx:63` `const focus = useFocusStore();`。
- 🆕 **每一行任务挂 9 个交互组件**（`apps/web/src/App.tsx:756` 定义 `renderTaskTrailing`，`:1971` 与 `:2035` 两处传给列表）：`NoteEditor`、`SubtaskPicker`、`TaskOrganizer`、`TaskRepeat`、`DueEditor`、`ReminderPanel`、`AiBreakdown`、`AiDuration`、`Trash2`。复现：`sed -n '760,912p' apps/web/src/App.tsx | grep -oE '<[A-Z][A-Za-z0-9]*' | sort -u | wc -l`。**其中 8 个是编辑器/浮层而不是展示件** ⇒ 真实代价不是"整行重建"，是"整行连同全部编辑器一起重建"。
- 🆕 **web 侧零虚拟化是结构性缺失，不是"没配好"**：`@tanstack/react-virtual` 在 `apps/web/package.json` 与根 `package.json` **都未声明**，`apps/web/src` 内 0 命中（复现：`grep -c 'react-virtual' apps/web/package.json`）⇒ N 行 = N 个真实 DOM 子树，再乘上面那 9 个。这条与移动端的"ScrollView 击穿 FlatList"是**两个端的两种零虚拟化**，修法不同。
- 外层与内层：`FlatList` 的父链上有 `ScrollView` ⇒ 它拿到**无界高度**，`VirtualizedList` 的窗口化前提不成立，N 条任务就建 N 套视图、行从不回收；`contentContainerStyle` 里的 `flexGrow: 1` 把这条推得更实。
- 同一个形状在共享层有 4 个宿主：`packages/ui/src/quadrant/QuadrantBoard.tsx:367`（**一屏嵌 4 个**）、`calendar/CalendarBoard.tsx:522`、`calendar/CalendarDayBoard.tsx:179`（⚠️ 未入库）、`search/SearchPanel.tsx:243`。
- 置信度：📊 实测（三条计数）+ ✅ 已复核（外层与内层两侧代码都读过；"外层 ScrollView 击穿虚拟化"是 RN 既定行为）
- **这条判据怎么才会红**：jsdom 测不到（渲染次数不是 DOM 断言）。可行的形态是给 `TaskList` 挂一个 **render 计数探针**，用例「勾一条任务的复选框 ⇒ `TaskRow` 渲染次数 ≤ 视口行数 × 2」——今天这条必然红，红就是价值。移动端另加一条静态门禁：`packages/ui` 里出现 `FlatList` 的文件，其宿主不得在同一 `Screen` 默认 `scroll` 下使用它。

### P0-2 checkpoint 的**写**路径是 O(N²)，而 ADR-0047 只测了读路径

- 位置：`packages/op-log/src/engine.ts:123`（节奏）、`:133-140`（每次写的内容）、`:386`/`:485`/`:659`（三个触发点）、`packages/storage/src/db-op-log-store.ts:510` + `packages/storage/src/checkpoint.ts:41`（**同一发校验跑两遍**）
- 代码形状：

  ```ts
  // engine.ts:123 —— 硬编码，注释说"zero disables"，但没有任何宿主能把它设成 0
  this.checkpointEvery = 250;

  // engine.ts:133-140 —— 每次写都摊平"全量状态 + 全部历史 op id"
  const base = {
    formatVersion: 1 as const, coveredSeq,
    state: serializeMaterializedState(this.state),
    clock: this.getClock(),
    appliedOpIds: [...this.appliedOpIds],      // 这个 Set 只增不减（engine.ts:107）
  };
  await write.call(this.options.store, { ...base, checksum: checkpointChecksum(base) });
  ```
  ```ts
  // checkpoint.ts:14-20 —— checksum = JSON.stringify 整个对象，再逐字符 FNV-1a
  const input = JSON.stringify(checkpoint);
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); … }
  // checkpoint.ts:41 —— isValidCheckpoint 落盘前把上面两行**再做一遍**
  ```
- 量级：导入/回放 N 条 ⇒ **N/250 次写，每次 O(N)** ⇒ **O(N²/250)**。
- 📊 **本次实测的下限**（只算 stringify + FNV，**不含** `[...Set]` 展开、真实 `serializeMaterializedState`、SQLite/IDB 写这几 MB blob、worker 桥的结构化克隆）：

  | 历史 op 数 | checkpoint 体积 | 单次写 | 期间写次数 | 累计纯序列化+校验 |
  |---|---|---|---|---|
  | 10k | 0.28 MB | 2.3 ms | 40 | 0.1 s |
  | 50k | 1.46 MB | 8.7 ms | 200 | 1.7 s |
  | 100k | 2.93 MB | 14.9 ms | 400 | **6.0 s** |
  | 200k | 6.00 MB | 33.3 ms | 800 | 26.7 s |

  复现命令在 `/tmp/heyta-perf-scan/ckpt-cost.mjs`（一次性探针，**故意没进仓库**：它只镜像 `checkpointChecksum` 的算法，不具备长期维护价值；要长期守就按下面判据写成 `scripts/measure-checkpoint.mjs`）。
  对照 [ADR-0047](../adr/0047-checkpointed-incremental-hydration.md) §5 登记的 `scripts/measure-hydration.mjs`：**100k 全量重放 9.5672s**。⇒ **光是写 checkpoint 就相当于一次完整全量重放的约 60%，而它是每 250 条拆成 ≥15ms 的一次次前景卡顿，不是只发生一次。**
- 最受伤的两条旅程：新设备首次同步、从备份还原（都走 `engine.ts:485` 的批量应用路径）。附带**写放大**：约 3 MB 的 META 行被重写 400 次。
- 置信度：✅ 已复核（链路逐段读过）+ 📊 实测（数字是自己跑的，且是**下限**）
- **这条判据怎么才会红**：仿 `measure-hydration.mjs` 的写法加一条 `measure-checkpoint.mjs`，断言"写 N/250 次 checkpoint 的总耗时 ≤ 全量重放耗时 × 0.5"，并从 `checkpointEvery` 这个**被约束的常量**推导阈值。今天它必红；红即是基线。
- 改法方向（供后续决策，本文不拍）：`appliedOpIds` 是 checkpoint 里唯一的 O(N) 项，而它的用途只是"判断覆盖范围内有没有洞"——**洞的存在性 store 自己就知道**（`findPendingApply`），所以它属于可派生状态，可用前沿+计数替代整张 id 表。另一发 `isValidCheckpoint` 的重复 checksum 可以省成写路径只算一遍。

### P0-3 移动端每一条 SQL 都是同步桥调用，首帧 render 阶段里就藏着 3 次

- 位置：`apps/mobile/src/db/op-sqlite-driver.ts:82/87/92`、`apps/mobile/src/App.tsx:142`、`apps/mobile/src/prefs/device-prefs.ts:74-92`
- 代码形状：

  ```ts
  // apps/mobile/src/App.tsx:142 —— useState 初始化函数，在**第一次 render 期间**执行
  const [welcomeDone, setWelcomeDone] = useState<boolean>(() => hasSeenWelcome());
  ```
  ```ts
  // op-sqlite-driver.ts:92-94 —— 同步 SQL
  const result = this.db.executeSync(sql, params ? params.map(toScalar) : undefined);
  ```
- 为什么贵：RN 只有一条 JS 线程，`executeSync` 返回前整条线程不能做事——**这个文件自己的注释就承认这点**（`:20-23` 引 op-sqlite 官方原话，`:12-34` 把"把 `SqliteDriver` 改成异步"登记为未做的正解）。叠加 `engine.recover()` 在启动时重放整条日志，几千条 op 就是几千次串行阻塞往返。另外 `params.map(toScalar)`（`:87`/`:92`）每次新建一个数组，而 `toScalar` 是恒等函数。
- 置信度：✅ 已复核（三处 `executeSync` + 首帧调用链都读过）。**具体毫秒数未测** —— 需要真机 profiler，本文不编。
- **这条判据怎么才会红**：静态门禁 `grep -c 'executeSync' apps/mobile/src/db/*.ts` 必须为 0 才允许关掉；现在改不了，所以先钉成**只减不增的棘轮**，并把"首帧 render 阶段不得有同步原生往返"写成一条 `App.tsx` 的探针（`hasSeenWelcome` 移出 `useState` 初始化函数）。

### P0-4 服务端：一次上传批次 = 每 op 约 5–6 发串行查询 + 每 op 一次同一行 UPDATE

- 位置：`server/src/sync/services/operation-upload.service.ts`（`290` `findUnique` → `350` `detectConflict` → `370-372` `userSyncState.update{ lastSeq: { increment: 1 } }` → `397` `createMany` → 可能再 `430` `findUnique` + `442` `update`）、入口 `server/src/sync/sync.service.ts:413`
- 为什么贵：100 op 的批次 ⇒ 单事务内约 **500–600 发查询、占住 1 个连接**；每 op 自增一次 `user_sync_state` 那一行 ⇒ **同一用户的并发上传直接撞序列化失败**。文件里 `:380-382` 的注释自己写着"并发上传被上面那个 `lastSeq` increment 排除掉"——它把**并发当成失败来处理**，而不是当成要支持的事。
- 置信度：✅ 已复核（行号与调用形状是自己 grep 出来的）。**每批总耗时未测**（没跑真库 EXPLAIN）。
- **这条判据怎么才会红**：给一条真实 HTTP 集成用例数**发数**（Prisma 查询日志计数），断言"100 op 批次的查询发数 ≤ 常数上界"——形状上界今天约 600，红即是基线。**不要**用"响应成功"当判据，那正是它现在就会给你的东西。

### P0-5 移动端的图标体积：1854 个图标整个进包，实际用 88 个字形

- 依赖边：`packages/ui/package.json:23` → `lucide@1.48.0`；`apps/mobile/package.json:33` → `lucide-react-native@1.48.0`；`apps/web/package.json:35` → `lucide-react@^0.545.0`（**三端三套图标包**）
- 📊 实测（本机 `node_modules/.pnpm/lucide@1.48.0`）：

  | 项 | 读数 |
  |---|---|
  | `package.json` | `main=dist/cjs/lucide.js`、`module=dist/esm/lucide.mjs`、**`exports` 不存在**、**`react-native` 字段不存在** |
  | CJS 入口 | **622,890 B 单文件**，`^const [A-Z]… = [` 图标常量 **1853** 条，含 DOM 专用 `document.createElementNS` |
  | ESM 入口 | `from './icons/'` 静态 import **1854** 条；`dist/esm/icons/` **3708** 个文件 |
  | `packages/ui` 里 import `lucide` 的文件数 | **24** |
  | `@heyta/ui` 产物 | `dist/index.cjs` **416,162 B** / `dist/index.js` **371,503 B**（单文件 barrel，`package.json` **无 `sideEffects`**） |
  | 实际用字 | `apps/mobile/src/ui/icons.tsx` **43** 个 + 共享层去重 **45** 个 ≈ **88** |
  | 当前 release Android bundle | `…/react/release/index.android.bundle` **2,260,228 B**（Hermes 字节码） |
- 为什么贵：`exports` 与 `react-native` 两个字段都不存在 ⇒ Metro 按 `mainFields`（`react-native`→`browser`→`main`）落 **CJS 单体**；Metro 不做 tree-shaking，而 `@heyta/ui` 是 barrel ⇒ 任何一个组件都激活 24 个 `lucide` 引入点。**选哪条入口都省不掉。**
- ⚠️ **诚实边界**：**没有在真机产物里数到 lucide 的模块数**。Hermes 字节码里字符串已剥（`grep 'lucide'` 恒 0）——这正是 [环境陷阱 §7 第 171 条](../reference/environment-traps.md) 记的那类"探针够不着"。上表来自包结构与解析规则，**不是产物计数**。
- 与既有规则的关系：AGENTS.md §5「不许用 emoji 当图标、统一用 Lucide」——本条**不违反它**（改法仍然是 Lucide 的字形源，只是换成自己登记的一小张表；`packages/ui/src/icon/Icon.tsx:120` 的 `HeytaIcon` 已经只吃一张受控数据表（`HeytaIconData` = `readonly IconChild[]`，定义 `:59`/`:72`；标签白名单才是 `:94-101` 的 `ELEMENTS`，未知标签在 `:140` 抛错）），也**不引入新依赖**（§3.1/§3.2 两道门不用过）。
- **这条判据怎么才会红**：`scripts/check-mobile-bundle.mjs` 现在**只数 React 份数、不数体积也不数模块**。给它加两条：bundle 字节数上限（今天 2,260,228 B 作基线）+ `lucide/dist` 前缀的模块计数上限（要坐实必须先出一份 `--dev false --minify false` 的可读 bundle）。

### P0-6 习惯连续按「活了多少天」逐日走，而不是按打卡记录数 —— 且成长视图每 60 秒自动重跑一整轮

- 位置：`packages/domain/src/habit-streak.ts:104-119`（历史最长那条 while）、`:133-136`（当前连续，第二个 while）、每步的代价在 `packages/domain/src/date.ts:211-220/229`、触发频率在 `apps/web/src/App.tsx:722-724` + `apps/web/src/features/motivation/GrowthView.tsx:286/290-299`
- 代码形状：

  ```ts
  // habit-streak.ts:107-119 —— 步数 = 天数，不是记录数
  const maxSpan = 365 * 20;                       // 上限 7300 步
  let guard = 0;
  while (diffDays(cursor, end) >= 0 && guard++ < maxSpan) {
    if (isScheduledOn(habit.frequency, cursor)) { /* 命中与否 */ }
    cursor = addDays(cursor, 1);
  }
  ```
  ```ts
  // date.ts —— 一个 while 步里 parseLocalDate 被调 4 次（我自己逐函数数出来的）
  addDays:212          parseLocalDate(date)                 // ×1
  diffDays:219-220     parseLocalDate(a); parseLocalDate(b) // ×2
  isScheduledOn:229    parseLocalDate(date).getDay()        // ×1
  ```
  ```tsx
  // apps/web/src/App.tsx:722-724 —— 每 60 秒把 now 换一次
  const id = window.setInterval(() => store.refreshNow(), 60_000);
  ```
  ```tsx
  // GrowthView.tsx:290-299 —— 五个选择器是渲染体里的裸调用
  const review = selectWeeklyReview(entities, now);
  const totals = selectTotals(entities);
  const milestones = selectMilestones(entities);
  const tags = selectIdentityTags(entities, now);
  const activityDays = dailyActivityCountsFromState(entities, now, 365);
  ```
- 为什么贵：**代价随"这个习惯存在多久"增长，而不是随"打卡了多少次"增长。** 一个三年前的每周习惯，为了数出约 150 条记录要走约 1095 步 × 4 次 `parseLocalDate`；上限 7300 步 ≈ **29,200 次日期解析**，而同一函数体里还有第二个同量级的 while。
- 频率（这是它成为 P0 而不是 P1 的唯一理由）：`GrowthView.tsx` 全文只有 **1 个** `useMemo`（`:286`，包的只是 `labels`）——上面五个选择器**一个都没被包住**。`apps/web/src/App.tsx:723` 每 60 秒换一次 `now` ⇒ 视图重渲染 ⇒ 五个选择器**无条件重跑**。用户把成长页开着不动，**每分钟付一整轮**，与有没有新数据无关。
- ✅ **修法在本仓库已有参照**：移动端同一个视图 `apps/mobile/src/screens/GrowthScreen.tsx` 把这些取数包在 `useMemo` 里（`:173` `data`、`:194` `summary`、`:198` `share`、`:211` `labels`）——**同一份逻辑，移动端接对了、web 没接**。所以这不是"要不要 memo"的争论，是漏接线。
- 置信度：✅ 已复核（while 本体、四处 `parseLocalDate` 落点、60 秒定时器、五个裸调用、移动端四处 `useMemo` 逐行读过）。⚠️ **本文不给毫秒数**，按 §1 的规矩只给可推导的操作计数。
- **这条判据怎么才会红**：给 `habit-streak` 加一条**循环步数**判据 —— 「一个跨 3 年、只有 150 条打卡记录的习惯，循环步数应与记录数同阶（≤ 150 × 4），不是与天数同阶」，今天必然报约 1095。再加一条 web 侧的：「`now` 变而 `entities` 没变 ⇒ 五个选择器不应重新执行」，今天必红。
- 改法方向（不在这份 research 里拍）：连续/最长改成**在已排序的打卡日期数组上走**（步数 = 记录数），只在判断"该打卡的日子被跳过没有"时按 `frequency` 生成 schedulable 序列；`isScheduledOn` 与 `addDays` 共享一次解析。

### P0-7 提醒读侧是 O(任务数 × 提醒数)，且挂在**每一条 op** 上

- 位置：`packages/app-host/src/reminder-actions.ts:177-181`（全表扫）、`:347-349`（`listForTask` → `aliveOfTask` 这一跳）、`apps/web/src/features/reminders/store.ts:168-172`（逐任务调用）+ `:177`（挂 `onEngineChange`）
- 代码形状：

  ```ts
  // reminder-actions.ts:177-181 —— 每次调用都把全部提醒摊平再滤
  const aliveOfTask = (taskId: string): Reminder[] =>
    aliveReminders(
      Object.values(ctx.getState().reminders).filter((reminder) => reminder.taskId === taskId),
    );
  // :347-349
  listForTask(taskId) { return aliveOfTask(taskId); },
  ```
  ```ts
  // apps/web/src/features/reminders/store.ts:168-172 —— 对每个任务各调一次
  const tasks = currentState().tasks;
  for (const taskId of Object.keys(tasks)) {
    byTask[taskId] = reminderActions.listForTask(taskId);
  }
  // :177 —— 而这条刷新挂在引擎变化上
  onEngineChange(refresh);
  ```
- 量级：**T 个任务 × R 条提醒，每条 op 付一次**（本地写入、远端应用、同步回来的每一批都算）。1000 任务 + 1000 提醒 ⇒ 单条 op 触发约 **10⁶ 次 `taskId` 比较**，且 `Object.values` 那一步本身也重复 1000 次；再乘 P1-3 的一次同步 3 次广播。
- 正确的形状就在同一个文件里：一次 `Object.values(reminders)` + 按 `taskId` 归组（`Map<string, Reminder[]>`）= **O(R)，一遍就够**。
- 置信度：✅ 已复核（四处代码块逐段读过，含 `listForTask` → `aliveOfTask` 这一跳）
- **这条判据怎么才会红**：在 `refresh` 上挂一个"提醒表完整遍历次数"计数器，断言「N 个任务 + M 条提醒的一次刷新 ⇒ 遍历次数 = 1，不是 N」。今天报 N。
- ⚠️ **动这段之前先读那份调研**：这条链同时是 [回收站与归档调研](trash-and-archive-best-practice.md) 里缺陷 **D1**（已软删任务的提醒仍会弹，仅 Web）所在的层 —— "任务活着"这道滤就写在 `aliveOfTask` 里（`:106` 的接口注释明写它是防 D1 的那一道，"宿主只管订阅结果"）。**改归组方式会把那层滤挪动位置，两件事互相影响。**

---

### P0-8 op-log 的物化是「整桶复制」：单条 op 的代价与该桶实体数成正比，冷启动重放因此是 O(N·T)

- 位置：`packages/op-log/src/state.ts:545`（`applyOperationToEntity` 的返回值）
- 代码形状：

  ```ts
  // packages/op-log/src/state.ts:543-546
  return {
    ...state,
    [bucket]: { ...(state[bucket] as Record<string, unknown>), [entityId]: materialized },
  } as MaterializedState;
  ```

- 为什么贵：`{...state[bucket]}` 复制的是**该桶的全部实体**。改 1 条任务 ⇒ 复制 T 个任务对象。冷启动全量重放 N 条 op ⇒ **O(N·T)**；op 数与实体数同阶时就是 O(N²)。
- 🔴 **与已定论的 P0-2 是两条独立的**：P0-2 是 checkpoint **写**路径、被 `checkpointEvery = 250` 节流；这条挂在**每一条 op** 上，包括每一次启动的重放，**不受任何节流**。
- ⚠️ **这不是"写错了"**：`MaterializedState` 必须是纯函数返回的新对象（reducer  purity 是 checkpoint 确定性 checksum 的前提）。正确的改法是换**数据结构**（持久化字典树 / 物化层浅结构共享），**不是就地 mutate**。
- 置信度：✅ 已复核（19:41 现量：`grep -n 'state\[bucket\]\|\.\.\.state\[' packages/op-log/src/state.ts` → `:310` 与 `:545` 两处展开、`:511` 一处读取）
- **这条判据怎么才会红**：给 `applyOperationToEntity` 挂"被复制的实体数"计数，断言「桶内 1000 个实体、改其中 1 个 ⇒ 复制数 = 1」。今天是 1000。变异：恢复 `{...state[bucket]}` ⇒ 计数转红。
- ⚠️ 绝对耗时**未实测**（需 profiler）；本文只给形状与阶。

### P0-9 Web 首屏是一个 1.94 MB 的单文件 JS：没有 `build` 配置块，且**两份语言表同时在包里**

- 位置：`apps/web/vite.config.ts`（410 行，**无 `build:` 键 ⇒ 无 `manualChunks`**）+ `apps/web/src/App.tsx`（24 个功能面条件渲染但全部静态 import）
- 📊 实测（2026-10-03 19:41，本机 `apps/web/dist` 现有产物）：

  | 读数 | 复现命令 |
  |---|---|
  | 主入口 **1,936,369 B** | `ls -la apps/web/dist/assets/` → `index-*.js` |
  | gzip **573,480 B** | `gzip -c apps/web/dist/assets/index-DN0UdCcU.js \| wc -c` |
  | `build:` / `manualChunks` **0 命中** | `grep -c 'build\s*:\|manualChunks' apps/web/vite.config.ts` |
  | 两份语言表 **467,684 + 313,378 = 781,062 B** | `find packages/i18n/dist -name 'chunk-*.js' ! -name '*.map' -exec ls -la {} \; \| awk '$5>300000 {s+=$5} END {print s+0}'` ⇒ 实测 **781062**。⚠️ 该目录有 3 个 chunk，第三个是 2,170 B 的 `chunk-6ZDM2JGK.js`，**不是词条表**；`$1` 在 `ls -la` 的输出里是权限串不是字节数（本条命令第一版写的就是 `$1>300000`，它**恒假且 `END{print s}` 静默印空**，见 §5.2） |

- 🔴 **781,062 B ≈ 入口的 40%，而任何时刻只显示一种语言**。两块由 `packages/i18n/dist/index.js` 静态 import，页侧 90 处 `from '@heyta/i18n'` 把它拽进主入口。这是**单独一条可修的最大项**，且不依赖"要不要懒加载"这个更大的决定。
- `apps/web/src/main.tsx` 把 `root.render` 排在 `initOpLog()` 之后 ⇒ 这 1.94 MB **全部在第一次绘制之前**。🔴 这条我差点自己否证掉：`grep -n 'root.render\|initOpLog'` 会先看到 `:103` 与 `:111` 两次 render **早于** `:125` 的 `initOpLog()`。读完分支才知道那两次在 `?shell=1` / `?slice=1` 的 **dev 验证入口**里；真实用户走 `else`（`:118` 起，注释明写「必须先完成 op-log 初始化（含崩溃恢复）再渲染，顺序不能换」），真的 `render(<App/>)` 在 `:186` 的 `.then()` 里。⇒ **判"执行顺序"必须连分支归属一起看**，行号先后本身不是证据。
- 🆕 **首屏不止那 1.94 MB —— 默认后端是 sqlite，worker 侧再 ~1.3 MB**（📊 20:30 实测同一份 `apps/web/dist/assets/`）：

  | 文件 | 字节 |
  |---|---|
  | `sqlite3-*.wasm` | 868,907 |
  | `sqlite3-worker1-*.js` | 213,124 |
  | `storage.worker-*.js` | 188,680 |
  | `sqlite3-opfs-async-proxy-*.js` | 32,505 |
  | **worker/wasm 侧合计** | **1,303,216** |

  复现：`ls -la apps/web/dist/assets/ \| awk '/sqlite3|storage.worker/ {s+=$5} END {print s+0}'` ⇒ 实测 **1303216**。⚠️ 本条第一版写成 `'/sqlite3\|storage.worker/'`（转义竖线），awk 用的是 **ERE**，`\|` 是**字面竖线** ⇒ 永不匹配 ⇒ 打印 0。**这条反例留在原地的理由是它和 [环境陷阱 #186](../reference/environment-traps.md) 是同一族**：写 `s+0` 让"没命中"输出一个能判断的 0，而不是静默空值 —— 我这次靠那个 0 才发现命令坏了。
  ⇒ 首屏关键路径实为 **≈ 3.24 MB**（1,936,369 + 1,303,216），而 `resolveStorageBackend()` 默认就返回 `'sqlite'`（P1-11 那条同一个事实）。⚠️ 这 1.3 MB 是否在**第一次绘制的关键路径上**取决于 worker 的拉起时机，本文未实测（需一次真浏览器的 network 时序取证）。
- ⚠️ 哈希文件名（`index-DN0UdCcU.js`）随构建变；**字节数才是判据，文件名不是**。
- 置信度：📊 实测（上表四条命令当场跑过）。⚠️ 子 Agent 报的 gzip 是 573,**448**，我实测 573,**480** —— 差 32 B（gzip 级别不同），本文只保留**自己能复现**的那个数。
- **这条判据怎么才会红**：构建后断言 ①「入口 chunk 的 gzip ≤ 由当前启用功能面推导的阈值」②「入口 chunk 里 zh 表与 en 表**不得同时出现**」。今天的产物两条都红。

### P0-10 任务列表**每一行**都算一遍 O(N²) 的子任务候选 ⇒ 整个列表 O(N³)

- 位置：`apps/web/src/features/tasks/SubtaskPicker.tsx:69-75` + `packages/domain/src/subtasks.ts:488`（`validateParentChange`，其 `:493` 与 `:511` 各 new 一个覆盖全量任务的 Map）+ `apps/web/src/App.tsx:789`（**每行无条件挂载**）
- 代码形状：

  ```ts
  // apps/web/src/features/tasks/SubtaskPicker.tsx:69-75
  const candidates = useMemo(
    () =>
      allTasks
        .filter((t2) => t2.deletedAt === undefined)
        .filter((t2) => canSetParent(allTasks, task.id, t2.id))   // ← 每个候选一次全量遍历
        .sort((a, b) => a.title.localeCompare(b.title)),
    [allTasks, task.id],
  );
  ```

- 为什么是 O(N³)：`canSetParent` → `validateParentChange` 每次调用 **new 两个覆盖全部 N 条任务的 Map**（`:493`、`:511`）⇒ 单次 O(N)；一行算 N 次 ⇒ O(N²)；而 `apps/web/src/App.tsx:789` 把它挂在**每一行**（实测该行在 per-row JSX 里，外层**没有** `{expanded && …}` 之类的条件）⇒ N 行 = **O(N³)**。
- 🔴 **与 P0-1 不同轴**：P0-1 是"渲染次数"，这条是"每次渲染的算法阶"。加了 memo 与虚拟化之后**它还在**。
- 正确的形状：`validateParentChange` 接受一个**预先建好的索引**（`byId` / `parentOf` 由调用方传入），一次 O(N) 建表、N 行复用 ⇒ 回到 O(N)。
- 置信度：✅ 已复核（三处源码逐段读过；挂载条件由 `grep -n 'SubtaskPicker' apps/web/src/App.tsx` 现量 = 3 处，`:87` import、`:789` JSX 挂载、`:1691` 注释）
- ⚠️ 绝对耗时未实测。子 Agent 写的"500 条任务时秒级卡顿"我**没有复现**，不搬进本文。
- **这条判据怎么才会红**：给 `validateParentChange` 挂调用计数，断言「N 条任务渲染一次列表 ⇒ 调用次数是 O(N) 而不是 O(N²)」，或断言「单次调用内新建 Map 数 ≤ 1」。今天是 N² 次调用 × 每次 2 个 Map。

---

### P0-11 上传把 per-op `encrypt()` 放进 `Promise.all`，而密钥缓存是「检查后 await、无在途去重」⇒ 会话首批并发跑 N 次 Argon2id（每次 64 MiB）

- 位置（三处必须一起看）：
  - `packages/sync-client/src/client.ts:912` `const ops = await Promise.all(batch.map(async (op) => { … })`，`:923` `const cipher = await payloadCipher.encrypt(JSON.stringify(op.payload ?? {}), op);`
  - `packages/sync-core/src/encryption/session-cache.ts:55` 同步查缓存 → `:58` `const key = await deriveKeyFromPassword(password);`（**miss 时没有"在途 Promise"复用**）
  - `packages/sync-core/src/encryption/argon2.ts:11-15` `parallelism: 1, iterations: 3, memorySize: 65536 // 64 MB`
- 🔴 **最强的证据不是我的推断，是同一个包里另一边写着的禁令**：`packages/sync-core/src/encryption.ts:263-269` 的注释原文是
  > `// Phase 2: derive keys for unique salts SERIALLY and keep them in a batch-local map. Argon2id is single-threaded and allocates 64MB per derivation; parallel derivations via Promise.all only interleave microtasks (no real parallelism) and risk OOM on mobile. Holding keys locally also ensures Phase 3 cannot see an entry evicted by the LRU session cache (capped at SESSION_DECRYPT_CACHE_MAX_SIZE) when a batch contains more unique salts than the cache can hold.`
  >
  > ⚠️ **这条引用我校了两次才对**（22:03 行内容自检抓出来的）：① 起点不是 261 —— `:261` 是上一个块的闭合 `}`，注释实为 **263–269**；② 本行**上一版把后半段截掉了**。被截的那半不是修饰语，它给了**第二条独立的设计理由**：本地 Map 还保证 Phase 3 不会看到被 LRU 会话缓存（上限 `SESSION_DECRYPT_CACHE_MAX_SIZE`）逐出的条目。⇒ 完整读下来，这段注释比原版写的更强：它同时拦"并发派生 OOM"和"批内缓存逐出"，而加密侧两个都没照做。原文在源码里分 7 行写，上面按行拼成一段。
  > 复现：`sed -n '263,269p' packages/sync-core/src/encryption.ts`

  也就是说：**解密侧已经诊断过这个病并改成了串行 + 批内本地 Map**，加密侧留在原样。这不是"没人想过"，是"想到了、修了一半"。
- 后果：会话的**第一个**上传批次里，N 条 op 各自 miss 缓存 ⇒ 并发发起 N 次 Argon2id ⇒ **N × 64 MiB** 峰值 + N × (~500–2000 ms 的串行等价工作量) 挤在同一时刻。移动端最坏。之后缓存命中就不付了 —— 所以症状是"**装好后第一次同步特别慢/特别吃内存**"，而不是"每次同步都慢"，这类形状最容易躲过观察。
- 现成的解法已在包里：`encryptBatch`（`packages/sync-core/src/encryption.ts:190`）由 `packages/sync-core/src/index.ts:62` 导出。📊 **真调用点 0**（21:10 用 `git grep` 逐枚归类，命令与 P1-13 同款）：非 dist / 非 tests / 非 `research/standalone` 的 src 侧命中 **4** 处 —— `encryption.ts:190` 定义、`index.ts:62` 导出、`encryption.ts:11` 与 `:33` 是**文件头那张公共 API 清单注释**；带括号的调用形状命中 **1**，而那 1 处正是 `:33` 注释里的 `` `encryptBatch()` `` ⇒ **读代码的人一看就知道不是调用**。其余命中在 `packages/sync-core/tests/encryption.spec.ts` 与 `research/standalone/`。
  ⚠️ 这里补一条 P1-13 判据的已知假阳性（同一趟查出来的）：**"调用形状"grep 会把注释里的 API 清单算进来** —— 所以命中数不是答案，**逐行读身份**才是。上面那句"那 1 处正是注释"就是这么读出来的。
- 置信度：📊 实测（四处 file:line 逐段读过；64 MiB/3 轮是当场读到的常量；`encryptBatch` 零生产调用点是 grep 全量读数）。⚠️ **峰值内存与首批次耗时未实测** —— 要真机 profiler。
- **这条判据怎么才会红**：断言「一次 `upload` 期间 `deriveKeyFromPassword` 的调用次数 = 1（同一 password）」，而不是"缓存最终命中"。今天首批会数出 N。变异：把 `client.ts:912` 的 `Promise.all` 换成串行 `for` ⇒ 计数从 N 降到 1；这条断言就能区分两者。

---

## 3. P1

### P1-1 Web 番茄钟：`pause()` 不停表 ⇒ 250ms 定时器永久 4Hz 空转

- 位置：`apps/web/src/features/focus/store.ts:156-158`（`pause`）、`:259-273`（`ensureTicking`/`stopTicking`）、`:200-207`（`tickOnce`）
- 代码形状：

  ```ts
  pause: () => {
    set({ state: pauseFn(get().state, Date.now()), tick: get().tick + 1 });
  },                                   // 🔴 没有 stopTicking()
  ```
  ```ts
  // :204-207 —— 未到点也要重绘，暂停态永远走这一支
  if (!isFinished(state, now)) { set({ tick: get().tick + 1 }); return; }
  ```
- 为什么贵：`stopTicking()` 只在 `abort`(`:172`)、跑完(`:212`)、落盘失败(`:239`)、测试复位(`:277`) 四处调。点暂停后 interval 继续跑，每 250ms 把 `tick` 自增一次 ⇒ 订阅了整个 focus store 的 `FocusTimer`（`apps/web/src/features/focus/FocusTimer.tsx:63`）**每秒重渲染 4 次，跨视图不停**，直到 abort。移动端同一套逻辑两处都写对了（`apps/mobile/src/lib/focus-timer.ts:118` 用 `lastPublishedSecond` 压到 1 次/秒，注释里还记着压之前 4 次/秒把真机取证打成"8 次只成 1 次"）——**可以直接照抄参照实现**。
- 置信度：✅ 已复核（`pause` 函数体与 `stopTicking` 全部调用点都读过）
- **这条判据怎么才会红**：用例「`pause()` 之后推进 2 秒 ⇒ `tick` 不再变化」。今天必红。

### P1-2 任务详情浮层每敲一个字重建两个完整月历

- 位置：`packages/ui/src/date-picker/DatePicker.tsx:157`、`apps/mobile/src/screens/TaskDetailSheet.tsx:447/687/730`
- 📊 实测：`DatePicker.tsx` 里 **`useMemo` 命中 0 处**（我 grep 过整个文件），而 `:157` 就是 `const weeks = monthGrid(month);`
- 为什么贵：`title` 是 `TaskDetailSheet` 自己的 `useState`（`:151`）⇒ **每敲一个字符**整张浮层重渲染 ⇒ 2 × `monthGrid()`（每次 6 周 × 7 天 = 42 个格子对象）+ 每格 1–2 个内联 style。手机上打字延迟是用户直接感知的。
- 置信度：✅ 已复核
- 判据：`TaskDetailSheet` 输入 20 个字符 ⇒ `monthGrid` 调用次数应为 2（按 `month` 记忆化后），今天是 40。

### P1-3 一次同步里移动端 `set()` 广播 3 次（失败 4 次），且订阅是全量对象

- 位置：`apps/mobile/src/sync/store.ts:71-74`（`state = {...state, ...patch}` + 通知全部监听者）、`:186`/`:192`/`:203`/`:209`、消费者 `TasksScreen.tsx:487`、`CalendarScreen.tsx:91`、`FocusScreen.tsx:176`、`ProfileScreen.tsx:106`、`CategoriesScreen.tsx:107`
- 为什么贵：与 P0-1 相乘 ⇒ **同步一次 = 未虚拟化、无 memo 的全列表重建 3 遍（失败 4 遍）**。`useMobileSync()` 返回整个 `MobileSyncState`，`useSyncExternalStore` 按引用相等判定 ⇒ 任一字段变 = 所有组件重渲染。
- 缓解因素（如实记录）：`apps/mobile/src/App.tsx:203-209` 是**条件渲染**，同一时刻只挂一个 tab，所以监听者数是 1+面板，不是 5。
- 置信度：✅ 已复核（四处 `set()` 行号自己 grep 到）
- 判据：一次同步里 `TasksScreen` 的渲染次数 ≤ 2。

### P1-4 共享层每次渲染重算日历派生表

- `packages/ui/src/calendar/CalendarBoard.tsx:170`（42 个 `DayCell` 各自 `makeStyles(tokens)`，那份表 16 条 / 105 行）+ `:473-481`（每格的 `calendarCellBars`/`calendarDayTone`/`labels.dayTitle` 每轮重算）；`CalendarYearBoard.tsx:238-239/285`（年档每轮 12 × `monthGrid` ≈ 504 个对象、约 **371 次日期格式化**）、`rows` 的 key 是 `row-${rowIndex}`（`:246`）⇒ 横竖屏切换整片重挂。
- 做得对的反例就在同目录：`packages/ui/src/calendar/CalendarYearBoard.tsx:300` 的 `MiniDay` 是父组件建一次样式、`styles` 传下去（⚠️ 该文件此刻是**别人工作树里的未入库文件**，见本节末「引用完整性自检」）——**照它改即可**。
- 置信度：⚠️ 待复核（数字来自子 Agent，我只复核了其中 `DayCell` 的 `useMemo(() => makeStyles(tokens), [tokens])` 形状与 `CalendarBoard.tsx` 的位置）。🔴 **并且它的载体正被人改写**：`CalendarYearBoard.tsx`、`CalendarDayBoard.tsx` 此刻是**未入库**文件、`CalendarBoard.tsx` 是 ` M` ⇒ 这些数字到那批代码定稿时会失效，**必须重测**（见 §1.1）
- 判据：`calendarCellBars` 每次切月的调用次数应等于"该月有任务的格子数"，不是 42。

### P1-5 每次本地写入都全量重算小组件载荷

- `apps/mobile/src/db/open-host.ts:46-66` 挂在唯一写入口 `dispatch` 上 → `void publishWidgetSnapshot(...)`；`apps/mobile/src/widgets/publish.ts:77-87` 每次把四类实体 `Object.values` 摊平 → `packages/widget-core/src/selectors.ts:205` 每个习惯扫一遍**全部**日志算连续天数 → `:110` `JSON.stringify` 整份 → `:151/154` 两次跨桥。
- 🔑 关键形状：**`WIDGET_MAX_TASKS` 截断了输出，但没截断计算**（`bucketByQuadrant` 与 `computeStreak` 仍扫全量）。
- 置信度：✅ 已复核（19:34 自己走完整条链：`apps/mobile/src/db/open-host.ts` 里 `emitLocalWrite();` 那一行（**按符号定位，不要写死行号** —— 19:34 时它是 48，00:0x 现量是 **53**，漂了 5 行，原因见下） → `apps/mobile/src/widgets/publish.ts:78-81` 四次 `Object.values`（tasks/projects/habits/habitLogs） → 同文件 `:110` `JSON.stringify(payload)` → 同文件 `:151` `seal` → 同文件 `:137` `write: setWidgetSnapshot` → `packages/widget-core/src/selectors.ts:205` `computeStreak(habit, input.logs, input.today)`）。
  🔴 **这次漂移是 §7 第 8 条没预见过的一种成因**：`open-host.ts` 现在是**干净的**（`git status --porcelain` 空），漂移不是"有人正在改"，而是**那次改动已经在 23:58 随 `b3397cda` 提交了**。⇒ 判断"这个引用还活着吗"，光看脏不脏会把**已提交的邻居**判成安全；要判得准只能用 `grep -n "<符号>" <文件>`，§7 第 8 条那句"不许照本文行号直接改"因此**对干净文件也成立**。
  ⚠️ 顺带修掉本行一处 markdown 缺陷：原文写成 `` `apps/mobile/src/widgets/`publish.ts:78-81` ``（反引号提前闭合，路径被截成两半），现改成完整路径。
  🔑 **并且把"上限截断的是输出、不是计算"这一句坐实了**：`WIDGET_MAX_TASKS = 20`（`contract.ts:64`）只出现在**契约校验**里（`contract.ts:386` 判 `raw.today.length > WIDGET_MAX_TASKS`，注释还写着"截断应在应用侧完成"），而应用侧 `apps/mobile/src/widgets/publish.ts:78-81` 把**全部**任务摊平喂进去算 ⇒ 上限挡住了载荷大小、**没挡住计算量**。
- 判据：`computeStreak` 每次写入的日志访问次数应从 O(习惯数 × 全部日志) 降到 O(该习惯日志)。

### P1-6 下载路径默认打开"昂贵的向量时钟聚合"

- 位置：`server/src/sync/sync.service.ts:637`
- 代码形状：`includeSnapshotMetadata: boolean = true` —— 而 `operation-download.service.ts:127` 的注释自己写着它 "controls **only the expensive vector-clock aggregate**"。默认值 = 打开 = 每次下载都算；两处 `LATERAL jsonb_each_text(vector_clock)` 全历史聚合分别在 `server/src/sync/services/operation-upload.service.ts:170` 与 `server/src/sync/services/operation-download.service.ts:389`（同一形状的两份拷贝；调用点分别是各自的 `:168` / `:385`）。
- 置信度：✅ 已复核（默认值 `sync.service.ts:637`、那句注释 `operation-download.service.ts:127`、两处 `LATERAL jsonb_each_text(vector_clock)` 的原文，全部我自己读到）。
- 📊 **`vector_clock` 无任何索引 —— 已从"子 Agent 断言"升级为实测**（19:37，按 #183 校准后的列集法，不是按名字 grep）：
  - 迁移里 `CREATE INDEX` 语句**没有一条**提到 `vector_clock`（把语句按 `;` 切分后逐条匹配，命中 0）；
  - `schema.prisma` 里 `Operation` 的四个索引列集分别是 `(userId,serverSeq)` unique、`(userId,entityType,entityId,serverSeq)`、`(userId,receivedAt,serverSeq)`、`(entityIds)` GIN —— **一个都不含 `vectorClock`**（列名 `vector_clock`，`@map` 在 `schema.prisma` 里）。
  ⇒ 这两处聚合是**对该用户全部历史逐行展开 jsonb**，没有任何索引能少读一行；`server_seq <` / `<=` 那个谓词能靠 `(user_id, server_seq)` 收窄，但**展开与聚合本身仍是 O(历史长度)**。
- ⚠️ 仍未测的是**当前最大账号上的实际 ms**（要真库 EXPLAIN，见 §7）。
- 判据：真库 EXPLAIN 一次，记录该聚合在当前最大账号上的 ms。

### P1-7 `/api/admin/overview` 一发请求并发 15 条聚合，其中 6 条无索引

- 位置：`server/src/admin/admin.routes.ts:157-196`
- 置信度：📊 实测（19:34 数过：`admin.routes.ts` 第 155–200 行里 `prisma.` 调用 **15** 处，与"一发请求 15 条聚合"相符）；⚠️ 其中**哪几条无索引**仍未逐条对过 —— 那必须按**列集**比对（按名字 grep `schema.prisma` 会恒判缺失，见 #183）
- 判据：把发数写进集成用例断言（≤ 常数），而不是断"响应 200"。

### P1-8 🔴 顺带掉出的**正确性** bug：管理后台有个数恒为 0

- 位置：`server/src/admin/admin.routes.ts:190`
- 代码形状：`prisma.couponRedemption.count({ where: { state: 'settled' } })`
- 📊 已复核的事实：核销状态词表在 `server/src/billing/pricing-store.ts:81` = `['reserved','applied','expired','reversed']`，**没有 `settled`**；"结算"是另一列 `settledAt`。⇒ 这个 count **永远返回 0**，而它投影到 `packages/app-host/src/admin-client.ts:89` 的 `settledRedemptions`，界面上就写着 0。
- 为什么这是本轮最该单独修的一条：它走的索引恰好存在（`coupon_redemptions_coupon_id_state_idx`），所以**又快又错**，不会以慢的形式暴露自己。与 [环境陷阱](../reference/environment-traps.md) 里"`SELECT COUNT(*)` 漏 FROM 恒等于 1"同族。
- 判据：断言 `settledRedemptions` 的定义列是 `settledAt IS NOT NULL`；并让词表成为唯一真源（`REDEMPTION_STATES` 里不存在的取值不许出现在 `where` 里 —— 这条可以做成门禁）。

### P1-9 Web 侧本地写入**不触发**同步（功能缺口，但它是性能的地雷）

- 📊 已复核：`startAutoSync` 的**唯一生产调用点**在 `apps/mobile/src/App.tsx:118`；web 没有任何 auto-sync 模块。web 的 `syncNow()` 调用点只有 `SyncBar.tsx:226/229/366`（手点按钮）与 `features/sync/store.ts:219` 注释所述的实时下行信号。
- 🔴 为什么记在性能文档里：`apps/web/src/features/sync/store.ts:222` 的注释自己写着 **"`syncNow()` 没有在途保护（它每次都会新建客户端并发请求）"**。也就是说——**现在给 web 接上"写入即同步"，会直接撞上 P0-1 的三次广播 × 无互斥重入**。顺序必须是：先补 memo/selector 与在途保护，再接自动同步。

---

### P1-10 `OpLogStore` 接口上**没有计数/存在性方法** ⇒ 任何"库里有多少条"只能把整库搬进内存

- 位置：`packages/storage/src/op-log-store.ts`（`export interface OpLogStore<` 起于 `:90`）
- 📊 实测：读侧只有 4 个方法 —— `getOpsSince` / `getOpsForEntity` / `getLastLocalSeq` / `getAllOps`（`:122`/`:129`/`:135`/`:138`）。**没有 `count()`，也没有 `hasAny()`。**
- 为什么单独列一条：它是**三条不同症状的同一个根因**。"待上传条数"（界面徽标）、"引擎里队列是否非空"、"目标库是否为空（迁移守卫）"三件事都只能 `getAllOps().length` ⇒ 每次都把含密文正文的全表物化。P0-9 那条首屏之外，这是运行期的主要无界读。
- 修一处、三个消费者受益 —— 这也是本文档 §8 里性价比最高的一步。
- 置信度：📊 实测（接口逐行读过）。
- **这条判据怎么才会红**：断言「取待上传条数时，被物化的 `StoredOperation` 对象数 = 0」，并断言接口上存在 `count*` 形状的方法。今天两条都红。

### P1-11 SQLite 适配器把「只要 key / 只要计数」实现成「取回全部命中行并逐行 `JSON.parse`」

- 位置：`packages/storage/src/sqlite/sqlite-adapter.ts`（⚠️ 真实路径带 `sqlite/` 子目录）
- 📊 实测（19:46）：四个方法共用同一个 `fetchIndexRecords`（定义在 `:756`）——
  `:564`（getAllFromIndex）、`:571`（getKeyFromIndex）、`:578`（getFromIndex）、`:584`（`return this.fetchIndexRecords(...).length`）。
  ⇒ **`countFromIndex` 的返回值就是"取回所有行再数一下"**，而 IndexedDB 那条对应的是原生 `index.count()`。
- 🔴 这一条的要点是**后端不对称**：`resolveStorageBackend()`（`apps/web/src/lib/oplog.ts:97-103`）默认返回 `'sqlite'`，`'indexeddb'` 只在显式 `VITE_HEYTA_STORAGE=indexeddb` 时才走。也就是说**默认生产路径昂贵、回退路径便宜** —— 上层同一行代码换个后端就差一个数量级。
- 置信度：📊 实测（四处共用点与 `:756` 定义逐行读到；后端默认值读到原文）。
- **这条判据怎么才会红**：给适配器挂"被反序列化的行数"计数，断言「`countFromIndex` 期间 = 0」。今天是命中行数。

### P1-12 `archive` 参与**每一次**无界 `getAllOps`（有意的正确性设计，代价随归档量线性增长）

- 位置：`packages/storage/src/db-op-log-store.ts:327-336`
- 代码形状：

  ```ts
  // :329-331 注释：A shared read transaction cannot observe an op both before and after
  //          an archive move, or miss it between separate hot/cold reads.
  const hot = await tx.getAll<StoredOperation<TOperation>>(STORES.OPS, range, limit);
  const archived = await tx.getAll<StoredOperation<TOperation>>(STORES.ARCHIVE, range, limit);
  const sorted = [...hot, ...archived].sort((a, b) => a.seq - b.seq);
  ```

- ⚠️ **这条不是疏忽，别当 bug 修**：那个共享只读事务防的是"归档移动前后各读到一次 / 两次读之间漏掉"。动它之前要保这条不变量。
- 📊 实测的限定（比子 Agent 的原句更窄）：`limit` **会下推**给两次 `getAll`，所以只有**不带 `limit` 的调用**才是真全量。要修的是调用方（见 P1-10），不是这段。
- 🔴 **20:47 与存储线那条"`limit` 不下推"对账：两句都是半真的，差别在哪个入口。** 下推条件在 `packages/storage/src/sqlite/sqlite-adapter.ts:739` 与 `:745`：
  ```ts
  const pushDown = plan.pkColumns.length === 1 && range !== undefined;                       // :739
  const sqlLimit = limit !== undefined && (pushDown || range === undefined);                 // :745
  ```
  | 入口 | 是否带 limit 进 SQL | 结论 |
  |---|---|---|
  | `getAll(store, range, limit)`（`db-op-log-store.ts:331-332` 走的就是这条）| `ops`/`archive` 主键是**单列 `seq`** ⇒ `pushDown` 真 ⇒ SQL 带 `WHERE` 区间 **+ `LIMIT ?`** | ✅ **下推**（本文 P1-12 这句成立） |
  | 复合主键 + 带 range | `pushDown` 假且 `range !== undefined` ⇒ `sqlLimit` **假** ⇒ 取回整段再 `filter().slice()` | ❌ 不下推 |
  | `iterate(store, options, visit)`（`:586-616`）| 调 `fetchRecords(driver, plan, { lower, upper })`（`:598`）与 `fetchIndexRecords(…, { lower, upper })`（`:601`）时**根本不传 limit**，然后在 JS 里 `cap = limit ?? DEFAULT_ITERATE_LIMIT`（`:605`，值 = **10_000**，`db.types.ts:231`）截断 | ❌ **永不下推**（存储线那条成立） |
  ⚠️ 而 `iterate` 这条**今天没有生产调用者**：`git grep -n "\.iterate(" -- packages apps server/src`（排除 dist / tests / research）实测 **0 命中**，全部 `iterate` 命中都是三套适配器**自己的实现**（`indexeddb-adapter.ts:422/:432/:542`、`sqlite-adapter.ts`、`memory-adapter.ts`）。⇒ 所以它不进 P1/P2 正文，只在 §7 第 14 条登记。
  📌 但这处登记里有一个**独立于调用点**的真问题：同一个 `iterate` 接口在 **IndexedDB 上是真游标**（能早停），在 **SQLite 上是"物化整段再截断"** —— 适配器契约的语义在两实现间不一致，而 `DEFAULT_ITERATE_LIMIT=10_000` 限的是**访问次数**、不是**取回行数**。将来谁第一次接线，会按 IDB 的直觉写代码。
- 置信度：✅ 已复核（函数体逐行读过，含 `limit` 下推与 `slice(0, limit)` 那行的关系；20:47 补读 `pushDown`/`sqlLimit` 条件与 `iterate` 路径）。
- **这条判据怎么才会红**：断言「带 `limit` 的 `getAllOps` 期间，从 `archive` 取回的行数 ≤ `limit`」。今天成立 ⇒ 这条判据现在该**绿**；它的价值在于有人改成"先合表再截断"时会红。

### P1-13 归档与裁剪**通道全部建好、没有一处调用** ⇒ op-log 只增、时钟维度只增（本条的证据在 20:47 被我自己否证过一次，改的是证据不是结论）

- 🔴 **先记我自己的错**。这一条第一版写的现量是：
  > ~~`archiveUpTo` 命中只在 `packages/storage/dist/*` 与 `packages/storage/tests/contract/op-log-store.contract.ts:485/:500` ⇒ 零生产调用点~~
  > ~~`limitVectorClockSize` 命中只在 `packages/sync-core/dist/*` ⇒ 零生产调用点~~

  20:47 改用 `git grep` 复跑，**两句都是错的**：`archiveUpTo` 在 src 侧有 **3** 处命中、`limitVectorClockSize` 有 **5** 处。**结论没变（调用点仍然是 0），但证据的形状完全变了** —— 原先那两句把"没有调用点"说成了"这东西不存在"，而真相是**声明 / 实现 / worker 转发 / import / re-export 全都在，唯独没有任何一处调用**。后者才是这条真正的分量：它不是"没人想到"，是**整条通道铺好了、开关从没人按**。
  📌 可迁移：**「零调用点」和「零命中」是两个不同的断言**。前者要求把每一枚命中**归类**（声明？实现？转发？注释？调用？），只做 `grep | wc -l` 拿到的是后者。
- 📊 现量（20:47 当场跑，逐条读过源码）：

| 符号 | src 侧命中（非 tests / 非 dist / 非 `research/standalone` / 不限扩展名） | 命中身份 | 调用形状命中 |
|---|---|---|---|
| `archiveUpTo` | 3 | `packages/storage/src/op-log-store.ts:199` **接口声明** · `db-op-log-store.ts:365` **实现** · `sqlite/oplog-worker-bridge.ts:335` **worker 转发** | **0**（`.archiveUpTo(` 的 11 行命中全在 tests：`packages/op-log/tests/engine.spec.ts:490` ×1、`packages/storage/tests/contract/op-log-store.contract.ts` ×6、`packages/storage/tests/indexeddb.spec.ts` ×4） |
| `limitVectorClockSize` | 5 | `packages/sync-core/src/vector-clock.ts:138` **定义** · 同文件 `:66` **注释** · `src/index.ts:26` **导出** · `server/src/sync/sync.types.ts:15` **import** · `:140` **re-export** | **0**（`limitVectorClockSize(` 命中 30 行**全在** `packages/op-log/tests` 与 `packages/sync-core/tests`；namespace 式 `.limitVectorClockSize` 命中 0） |
| `trimClock` | 1 文件 / 5 行，全在 `packages/op-log/src/engine.ts` | `:196-203` 函数体是 `return { ...clock };` —— 同名替换，不裁剪；注释明写理由（旧的 top-K 会静默删维度、让合法的离线写永久与服务端头并发） | — |

  复现命令：
  ```bash
  git grep -n "limitVectorClockSize" | grep -vE "/dist/|node_modules|research/standalone|/tests/|\.md:"
  git grep -nE "\.archiveUpTo\(|limitVectorClockSize\(" -- "*.ts" "*.tsx" "*.js" "*.mjs" \
    | grep -vE "/dist/|node_modules|research/standalone|/tests/"     # ← 实测命中 0
  ```
  ⚠️ **别用 `grep -rn … packages apps server`**：它会遍历 `node_modules`。同一条 `encryptBatch` 查询在两种口径下分别是 **43** 行（`grep -rn` 排除 `dist`）与 **68** 行（`git grep` 排除 `dist`），**两个都不是答案** —— 真正的答案要按命中身份分类，不是数行。
- 🔴 **server 的 import + re-export 会让复核者误判**：`sync.types.ts:15` 把 `limitVectorClockSize` 引进来、`:140` 又原样再导出，**中间没有任何调用**。只 `grep` 符号名的人会以为服务端在做时钟裁剪。⇒ 复核"某函数有没有被用"时，**import/re-export 行不构成调用点**，必须看带括号的调用形状（本节表第四列）。
- **这条与 ADR-0008 的关系 —— 别读成"ADR 没执行"**：ADR-0008「根因」那张表把「服务端存储时 `limitVectorClockSize(op.vectorClock, …)`」「客户端派发时 `limitVectorClockSize(clock, …)`」写成**事故当时的机制描述**（诊断，不是待办）。实测**这两处调用今天都不存在** ⇒ 那条"两边各自裁剪、保留规则还不一样"的分歧**不是被修好的，是被"裁剪从不运行"消解掉的**（vacuously）。后果分两面：
  1. **性能面**：`MAX_VECTOR_CLOCK_SIZE = 100`（`vector-clock.ts:71`）只在那个永不执行的裁剪函数里被读到 ⇒ 时钟维度**实际无界**。ADR-0008 说"100 对个人任务应用实际不可达"，那个论证的**对象是裁剪阈值**，它没有覆盖"根本没有裁剪"这个形状。P1-14 每次比较分配 Set 的键数、以及 P0-1 / P0-8 的每 op 系数都跟着维度单调上升。
  2. **可观测面**：ADR-0008 §3 明写那条 `console.warn`（`vector-clock.ts:156`）是「这个已知限制**唯一的出口信号**」。**信号挂在一个永远不执行的函数上 ⇒ 它永远不会响。** 今天真正在生效的边界是服务端的**拒绝型**闸门：`sync.types.ts:25` `MAX_ACCEPTED_VECTOR_CLOCK_ENTRIES = 4096`，由 `sanitizeVectorClock`（`:185`，判定在 `:195-199`）执行，调用者是 `server/src/sync/services/validation.service.ts:235`。那个常量自己的注释写着「This is an explicit **rejection** bound, **never** a storage/comparison pruning bound: accepted clocks retain every client dimension」——**不裁剪是明文选择**。⇒ 本文报的是这个选择的**代价**，不是遗漏。
- 🔴 为什么这条重要：它把本文所有 O(N) 与 O(N²) 项**从"暂时能忍"变成"必然变糟"**。N 不会自我收敛：日志只增、时钟维度只增。P0-2（checkpoint 写路径）与 P0-8（整桶复制）的系数都跟着单调上升。
- ⚠️ 这同时意味着**不能靠"数据量还小"来论证不修**。
- ⚠️ 仍需的载体：**维度实际长到多少**。本文只有代码层证据，没有分布 —— 要一台长期使用的设备的 op-log，数各实体 `vectorClock` 的 `Object.keys(…).length` 分布（真机数据，不是 profiler）。
- 置信度：📊 实测（上表每枚命中的身份都读到源码本体；两条命令当场跑）。
- **这条判据怎么才会红**：① 断言「`archiveUpTo` 与 `limitVectorClockSize` 在生产源码里的**调用形状**命中 = 0」—— 今天**绿**；它的用途是**防回潮**：将来谁接了线而本文没更新，这条会红，逼着结论跟着变。② 断言「`console.warn`（向量时钟超上限）在真实数据上**至少能被触发一次**」—— 今天**结构上不可能触发**，它红就等价于承认 ADR-0008 的"唯一出口信号"是死代码。③ 断言「某设备冷启动后 `getState()` 的时钟维度数 ≤ `MAX_VECTOR_CLOCK_SIZE`」—— 需真数据才能判（⚠️ 尚未实测）。变异对照：把 `oplog-worker-bridge.ts:335` 那行转发送掉 ⇒ ① 不变（它本来就不是调用点）；把 `validation.service.ts:235` 那次调用里的 clock 换成 5000 维 ⇒ 服务端应回 `valid:false`，这才是 4096 那道闸门**能红**的样子。

### P1-14 `compareVectorClocks` 每次比较分配一个 Set —— 🔴 但它**不**嵌在 per-field × O(k²) 的版本选择循环里（原句已被否证）

- 位置：`packages/sync-core/src/vector-clock.ts:95` `const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);`
- 📊 实测：这一行当场读到，且它不在 HEAD 与工作树里浮动（`git show HEAD:packages/sync-core/src/vector-clock.ts | sed -n '95p'` 输出该行原文）。

> 🔴 **22:5x 逐层读通了，结论和原句相反，原句留在下面不删**：
> ~~外层嵌套（`state.ts` 的 per-op × per-entity × per-field 里调 `selectVersion`）未逐层复核 ⇒ ⚠️ 嵌套深度与放大倍数待复核。~~
>
> 🔴🔴 **00:2x 复量：上面那段"HEAD 上没有 `selectVersion`"只活了 40 分钟就被一笔提交推翻了。** 本节下面那段否证里**关于 HEAD 的部分现在不成立**，成立的是后半段（k 的语义）。两份读数都留着，因为"一条以 `git show HEAD:` 为证据的断言也会过期"这件事本身就是要记的东西：
>
> ```bash
> git rev-parse --short HEAD; git log -1 --format='%ad %s' --date=format:'%m-%d %H:%M'
> #   22:5x 那趟 = 0a61c0a6 前后        00:2x 这趟 = d27bccde 10-04 00:10
> git show HEAD:packages/op-log/src/state.ts | grep -c 'selectVersion'    # 22:5x = 0 → 00:2x = 3
> git show HEAD:packages/op-log/src/state.ts | grep -c 'FIELD_VERSIONS'   # 22:5x = 0 → 00:2x = 6
> git show HEAD:packages/op-log/src/state.ts | grep -c 'shouldAcceptWrite' # 22:5x = 3 → 00:2x = 0（旧闸门已被替换）
> git show HEAD:packages/op-log/src/state.ts | wc -l                      # 22:5x = 371 → 00:2x = 599
> ```
>
> ⇒ **当前仓库事实**：per-field 版本前沿**已经入库**，`selectVersion` 在 `git show HEAD:packages/op-log/src/state.ts` 的 **198** 行、`addUnique` **211**、`materializeVersions` **273**、`legacyFieldVersions` **246**、`applyOperationToEntity` **498**。所以"嵌在 per-field 循环里"这半句**是对的**，而我 22:5x 用来推翻它的整个前提**已经不存在**。
> 🔵 **但本条真正要留下的结论不是那个反转，是 `k` 的语义**：`addUnique`（HEAD `state.ts:211-220`）会把被新时钟支配的旧版本 `splice` 掉，只留极大元 antichain ⇒ 单设备顺序写入时每个字段的版本数组长度恒为 **1**。这条现在有仓库自带夹具直接断（`packages/op-log/tests/checkpoint-recovery.spec.ts` 造 **601 条同设备单调时钟**的 op，再断 `entityVersions` 与 `fieldVersions.title` **各 `toHaveLength(1)`**），而 `checkpoint.ts`/该夹具**也已随同一批提交入库**（`git cat-file -e HEAD:packages/storage/src/checkpoint.ts` 现在通过）。⇒ **平方项随并发度、不随编辑史长度**；每条 op 的固定成本是 `legacyFieldVersions` 对全部字段版本表的 O(F) 拷贝 + `materializeVersions` 对全部 F 个字段的重新选边，**这两项才随实体字段数、也不随历史长度**。
- ⚠️ 我 22:5x 写过一句"本文不许把别人在飞的代码当成当前仓库的事实"。**这句话本身没错，但它当时的用法是错的**：我当时观察到的是"它还没入库"，而我从中得出的是"所以本文按 HEAD 定罪" —— 结果**按 HEAD 定罪定的是一个 40 分钟后就被替换掉的形状**。📌 可迁移：**"未入库"是一个时刻的快照，不是一个可以据以下结论的属性**。凡论据形式是「X 还没进 HEAD ⇒ 仓库现状不是 X」，都必须写成带 SHA 的、并配一条"重新量一次"的命令 —— 本节现在就照这个改了。
- 与 P1-13 的关系要**降级**：原文写"维度 d 只增不减 ⇒ 这里每次分配的 Set 也越来越大"。前半句仍成立（P1-13 证过裁剪函数零调用），但它给的是**单次比较**的键数上界从"实际几维"挪到"最多 200 维"，不是循环次数。
- 置信度：📊 已复核（**00:2x 按新 HEAD 重量过一遍**；22:5x 那份"HEAD 无嵌套"的否证已就地标注为被后续提交推翻）。
- **这条判据怎么才会红**：① 复现命令 `git show HEAD:packages/op-log/src/state.ts | grep -c 'selectVersion'` 的**值本身就是漂移探测器** —— 它在 40 分钟内从 0 变 3。常驻门禁应当断言的是「**本节主张的 SHA 与当前 HEAD 一致**」而不是断某个计数：`test "$(git rev-parse HEAD)" = "$(sed -n 's/.*锚定 SHA：\`\([0-9a-f]*\)\`.*/\1/p' 本文件)"` 之类；否则下一次合流又会把这段变成假话（**本条现在还没有那个 SHA 锚，这是它已知的下一个缺陷，登记在 §7**）。② `checkpoint-recovery.spec.ts` 里那两条 `toHaveLength(1)` 变红 ⇒ antichain 折叠失效，"随并发度而非历史长度"这条下界推理同时失效。

### P1-15 每条 full-state op 被**执行两遍**（一遍预校验丢返回值、一遍真应用）

- 位置：`packages/op-log/src/engine.ts:446-448` 与 `:573`
- 📊 实测两处原文：

  ```ts
  // :446-448 —— 返回值被丢弃
  if (ops.length === 0) return { applied: [], skipped: 0, overwritten: [] };
  for (const op of ops) {
    if (isFullStateOperation(op)) applyOperation(emptyState(), op);
  }
  // :573 —— 真正应用
  this.state = applyOperation(this.state, op);
  ```

- 为什么贵：单遍 full-state 应用本身就是"整份状态反序列化 + 逐实体版本合并"，而预校验那遍**从 `emptyState()` 起做同样的事**、结果直接扔。
- ⚠️ 预校验的目的（大概是"在提交前先确认这条 op 解得开"）必须保留 —— 可省的是"重做一遍完整物化"。改成只解析不落状态的形式化校验即可。
- 置信度：✅ 已复核（两处读到原文，确认第一处返回值被丢弃）。
- **这条判据怎么才会红**：断言「一条 full-state op 的 `applyOperation` 调用次数 = 1」。今天是 2。

### P1-16 同一份 checkpoint 一生要被 `JSON.stringify` —— 🔴 遍数**按宿主分档**：web 2 遍、SQLite 那三档 3 遍（子 Agent 的"三遍"只对了一半）

> ⚠️ 原句（22:5x 前）：「同一份 checkpoint 一生要被 `JSON.stringify` **至少两遍**（子 Agent 报三遍，我只证到两遍）……**第三遍（序列化后真正落盘那一次）我没有逐行证到** ⇒ 本文只主张「≥2 遍」」。
> 🔴 **22:5x 逐行读通了，第三遍存在，但它不在所有宿主上** —— 所以"≥2 遍"这个下界不是保守，是**把一个分档事实写成了一个笼统数字**。

- 📊 **每一遍的落点（全部读到原文）**：

  | 遍 | 位置（活文件，按符号重定位） | 序列化的对象 | 在哪一档宿主上发生 |
  |---|---|---|---|
  | ① | `packages/op-log/src/engine.ts:140` `checksum: checkpointChecksum(base)` → `packages/storage/src/checkpoint.ts:14` | 整份 checkpoint（去 checksum 字段） | **全部** |
  | ② | `packages/storage/src/db-op-log-store.ts:510` `isValidCheckpoint(…)` → `checkpoint.ts:41` → `:14` | **同一份再来一遍** | **全部** |
  | ③ | `packages/storage/src/sqlite/sqlite-adapter.ts:679` 的 `private insertRow`，其中第 **698** 行 `values.push(JSON.stringify(record))`；进入路径是 `sqlite-adapter.ts:501` 的 `put:`，它在第 **511** 行调 `insertRow` | 整条 META 记录（含 `value` = 整份 checkpoint） | **只有 SQLite 档**（node-host、移动端） |

- 📊 **为什么 web 没有第③遍**：`db-op-log-store.ts:517` 落盘的是 `tx.put(STORES.META, { key, value: checkpoint })` —— 把**对象**交给适配器。三个 `DbAdapter` 的 `put` 各自怎么处理这个值，是逐个数出来的：`indexeddb-adapter.ts` 里 `JSON.stringify` **0 命中**（结构化克隆直接存对象）；`memory-adapter.ts` 只有 `:90 JSON.stringify(key)`，**哈希的是主键、不是记录**；`sqlite-adapter.ts` 在 `:698` 把整条记录 stringify 进 `dataColumn`。
- 复现命令（每条当场跑过，期望=实读）：

  ```bash
  grep -n 'checksum: checkpointChecksum(base)' packages/op-log/src/engine.ts            # 140
  grep -n 'async writeCheckpoint' packages/storage/src/db-op-log-store.ts               # 509
  sed -n '510p;517p' packages/storage/src/db-op-log-store.ts                             # isValidCheckpoint / tx.put(STORES.META…
  grep -n 'put: async (storeName, value, explicitKey)' packages/storage/src/sqlite/sqlite-adapter.ts   # 501
  grep -n 'values.push(JSON.stringify(record))' packages/storage/src/sqlite/sqlite-adapter.ts          # 698
  grep -rc 'JSON.stringify' packages/storage/src/indexeddb/indexeddb-adapter.ts                        # 0
  grep -n 'JSON.stringify' packages/storage/src/memory/memory-adapter.ts                               # 只有 90，参数是 key
  ```

- 🔴 **入库状态这一维在 00:10 那笔提交前后翻转过，两个读数都记下来**：22:5x 量到的是「三遍里**只有第③遍**已入库 —— `checkpoint.ts` 是 `??` 未跟踪、`engine.ts`/`db-op-log-store.ts` 是 ` M`」；00:2x 重量是「**三遍全部已入库**」（`git cat-file -e HEAD:packages/storage/src/checkpoint.ts` 现在通过，且 `git show HEAD:packages/storage/src/checkpoint.ts | grep -nE 'JSON.stringify|return checksum ==='` 直接给出 `:14` 与 `:41` 两行）。⇒ 本条的**分档结论没变**（web 2 遍 / SQLite 3 遍，逐行取证仍然成立），变的只是"这条是别人的在飞代码还是仓库现状"这一标签 —— 而**那一标签曾经是本条降级 P0-2 系数的理由之一**。📌 教训：把"未入库"当降级理由是**有时间保质期**的，写完要复查，见 §7 第 10 条同一趟的完整复盘。
- 🔴 与已定论那条的关系不变：这条是 P0-2 的**系数**，不是新问题。改法要留校验本身（`checkpoint.ts:6-9` 写明它防的是撕裂写/截断/不兼容载荷），可省的是**重复**那一份 —— 而且**省的位置很明确**：②是①的纯重复计算（同一个函数、同一个 `base`），合并只需把 ① 算出的串传进校验、或在 `writeCheckpoint` 里复用已算好的 checksum。③是存储格式，省不掉（除非改 SQLite 表的存法）。
- 置信度：📊 **已复核并闭合**（三遍逐行读到、三档适配器逐个穷举、入库/未入库状态逐文件查）。
- **这条判据怎么才会红**：① 常驻门禁断言「一次 `writeCheckpoint` 上，`checkpointChecksum` 被调用次数 == 1」—— 今天是 **2**（①与②各一次），这一条就是 §8 第 7 步 `scripts/measure-checkpoint.mjs` 应当量的东西；② 断言「`grep -c 'JSON.stringify' packages/storage/src/checkpoint.ts` 与 `isValidCheckpoint` 里那次复用同一份串」—— 有人把 ② 改成"重新 stringify 一次"就会红；③ 若哪天 `indexeddb-adapter.ts` 的 `JSON.stringify` 命中从 **0** 变成非 0 ⇒ "web 只有两遍"这半条当场作废，两档合成一档、本条要重写。

  ⚠️ 这条的**分档结构本身**也要有判据：`memory`/`indexeddb`/`sqlite` 三个适配器各自的 stringify 命中数是 0/0/1，写成常驻断言后，任何"新增第四个适配器"或"把 stringify 挪进公共层"都会撞红 —— 而不是像现在这样，只有人去逐行读才知道 web 和移动端付的不是同一个数。

---

### P1-17 行尾插槽的 `useCallback` 依赖里带着**整个 store 快照** ⇒ 每个 op 让全部行的全部编辑器重建一遍

- 位置：`apps/web/src/App.tsx:756`（`renderTaskTrailing` 定义）+ `:912`（它的依赖数组）
- 📊 实测原文（依赖数组逐字读到）：

  ```ts
  // apps/web/src/App.tsx:912
  [aiSecrets, aiSettings, memory.preferenceSet, store, t],
  ```

- 为什么是独立的一条：`store` 是 `useTaskStore()` 的**整店返回**（P0-1 那格里的 `apps/web/src/App.tsx:197`），所以**任一 op ⇒ 新引用 ⇒ 这个 callback 重建 ⇒ 作为 `renderTrailing` 传给 `:1971`/`:2035` 两处列表 ⇒ 每行的 9 个组件全部重建**。
- 🔴 它是 **P0-1 的放大器而不是重复**：P0-1 说"行会重建"，这条说"重建的是整行连同 8 个编辑器/浮层"。即使给 `TaskRow` 加了 `React.memo`，只要这个 callback 每次新引用，**memo 的比较必输**（函数 props 是引用相等）⇒ 所以 §8 第 9 步必须把这条和 memo 那步**一起做**，单做 memo 无效。
- 正确的形状：依赖收到 `store` 里真正被用到的那几个**方法引用与派生值**（zustand 风格 store 的方法是稳定引用），或者把 trailing 改成 `React.lazy`/受控展开——只挂载当前被点开的那几个编辑器。
- 置信度：✅ 已复核（定义与依赖数组两处原文读到；传入点 `:1971`/`:2035` 由 grep 现量）
- ⚠️ 每行的重建次数**未实测**（需 profiler）。
- **这条判据怎么才会红**：断言「一条与行尾插槽无关的 op（例如改另一条任务的便签）之后，`renderTaskTrailing` 的引用**不变**」。今天必变。变异：把 `store` 放回依赖数组 ⇒ 转红。

---

### P1-18 记忆层**关着也要付**：`inferPreferences` 的隐私闸门在**被调方里面**，而它的入参在调用点就已经把全表展开了

- 位置：`apps/web/src/App.tsx:629-640`（四处入参构造）+ 闸门 `packages/domain/src/preferences.ts:727`、`packages/domain/src/ai-feedback.ts:286`
- 📊 机制（JS 的求值顺序，不是推测）：`if (!input.memoryEnabled) return emptyPreferenceSet(false)` 是**函数体第一行**，而 `Object.values(store.entities.tasks)` 是**实参表达式** —— 实参先求值，函数体后执行。所以"关掉记忆层"省掉的是**推断**，**省不掉那几次全表数组分配**。
- 📊 到底几处：`sed -n '619,641p' apps/web/src/App.tsx | grep -c 'Object.values('` = **6** 处，其中**只有 2 处在闸门后面**（`computeFocusGaps` 那两个实参，因为整个调用被 `aiSettings.memoryEnabled === true && opWindow !== null ? … : null` 包住了）。剩下 **4 处无条件执行**：`:631` tasks、`:632` focusSessions、`:637` aiFeedback、`:640` preferenceCorrections。
- 📊 频率：这个 `useMemo` 的依赖数组是 `apps/web/src/App.tsx:658` 的 `[aiSettings.memoryEnabled, store.entities, opWindow]`，而 `store.entities` 的身份**每条 op 换一次** —— `apps/web/src/features/tasks/store.ts:230-231` 是 `onEngineChange(() => useTaskStore.setState({ entities: currentState() }))`，`currentState()`（`apps/web/src/lib/oplog.ts:404`）返回引擎那份物化状态，而引擎**每条 op 返回一个新的顶层对象**（这正是 **P0-8 整桶复制**的后果）。⇒ 这条不是独立缺陷，**是 P0-8 的下游受害者**：P0-8 让身份每条 op 变一次，这里就每条 op 重扫四张表。
- 🔴 **谁在付**：`apps/web/src/features/settings/aiStore.ts:118` 的默认值是 **`memoryEnabled: false`**（ADR-0014 的 fail-closed）。也就是**每一个从没用过记忆层的 web 会话**都在每条 op 后把这四张表各展开一遍。功能越没人用，这笔钱越白花 —— 这是它比"开了功能慢"更值得修的原因。
- ⚠️ 原注释是一句**没人守的性能断言**：`App.tsx:602` 写着「`inferPreferences` 是纯函数，重算的代价是 O(任务数) —— 可以忽略」。两处偏差：① 实际是 `O(任务数 + 专注会话数 + aiFeedback 数 + 纠正数)`（四张表），② "可以忽略"判的是**推断**那一段，而闸门之前那四次分配被这句话一起盖过去了。**注释里的复杂度断言既不进类型也不进门禁，它只会跟着代码漂。**
- ✅ **修法不需要新抽象，同一段 9 行之上就有正确形状**：把 `:629-640` 也写成 `aiSettings.memoryEnabled === true ? (…) : { preferenceSet: emptyPreferenceSet(false), feedbackSet: emptyFeedbackPreferenceSet(false), … }`，与 `computeFocusGaps` 那条三元一致。零新增概念、零行为变化（关闭时 `inferPreferences` 本来就返回空集 —— 这是它自己的契约，见 `preferences.ts:722` 那句"立即返回空集"）。
- 置信度：📊 已复核（四处实参、闸门位置、依赖数组、默认值、`entities` 身份来源五处原文逐行读到；未实测的是**毫秒**）。
- **这条判据怎么才会红**：① 断言「`memoryEnabled === false` 时，一条无关 op 之后 `Object.values(store.entities.tasks)` 被调用 **0** 次」—— 今天是 ≥1，且这一条**不需要真机 profiler**，jsdom 里挂个 getter 计数就能断（`Object.defineProperty(store.entities, 'tasks', {get: spy})`）；② 反向防回潮：断言「`aiStore.ts` 里 `memoryEnabled` 的默认值仍是 `false`」—— 若哪天有人把默认改成 true，本条"每个人都在付"升级为"付费的人更多"，判据要跟着改级别。变异对照：把那四处实参改成 `memoryEnabled ? Object.values(...) : []` ⇒ ① 转绿；把 `App.tsx:658` 依赖里的 `store.entities` 换成 `store.entities.tasks` ⇒ ① 仍红（因为 tasks 身份也每条 op 变），**这恰好证明这条的根在 P0-8，不在这里**。

---

## 4. P2（只列 📊 实测过的计数，其余进 §7）

| 形状 | 位置 | 计数/事实 |
|---|---|---|
| **P2-1** 循环 key 用 `index`（甘特行 `index + 标题`、年档行 `rowIndex`） | `packages/ui/src/timeline/GanttChart.tsx:336`、`packages/ui/src/calendar/CalendarYearBoard.tsx:246`（⚠️ 未入库）、`motivation/ActivityHeatmap.tsx:158`、`habits/HabitBoard.tsx:645` | `title` 进 key ⇒ 改一次名就卸载重挂那一行；而甘特条宽度是**测出来**的 |
| **P2-2** 内联 `style={{…}}` 与函数式 style | `apps/mobile/src/ui/kit.tsx:209/436/699/761/1028` | 📊 实测（19:34）：`apps/mobile/src` = **135**、`packages/ui/src` = **15**，与子 Agent 报的逐字相同 ⇒ 计数成立。复现：`grep -rn 'style={{' apps/mobile/src \| wc -l` |
| **P2-3** `native.shadow()` 每次渲染跑正则解析 CSS | `packages/design-system/src/native-values.ts:131-170` | 5 个调用点都是低频浮层/FAB，影响面小。**同目录其余 token 全走编译期生成表**（`native.ts:57-93`）——这条设计是对的 |
| **P2-4** `useHeytaTokens()` 116 个调用点跨 45 文件（行级组件也是订阅者） | `packages/ui/src/task-list/TaskRow.tsx:131`、`CalendarBoard.tsx:168` | 今天不是问题（换主题很少），但它把"主题变一次"固定成"整树重建" |

### 本文计数的自检命令（发布数字必须由命令复现，不靠记忆）

```bash
D=docs/research/performance-hotpaths-audit.md
echo "P0=$(grep -cE '^### P0-' $D) P1=$(grep -cE '^### P1-' $D) P2=$(grep -cE '^\| \*\*P2-' $D)"
# 期望：P0=11 P1=18 P2=4  —— 与 docs/README.md 索引里那句逐字相等，改任何一条都要同时改那一句
# （18 是 10-04 00:08 由 17 变来的：闭合 §7 第 5 条时落出一条真的新 P1-18，不是重新编号）

# 表格列数一致性（22:40 新增；它抓到过一处真缺陷：§5.1 的 B 行里 `.every(… || …)` 那个裸 `||`
# 把单元格劈成了两列 —— 代码段里的竖线在 markdown 表格里**不豁免**，必须写成 `\|\|`）
node -e 'const fs=require("fs");const d=fs.readFileSync(process.argv[1],"utf8").split("\n");
let i=0,bad=[];
while(i<d.length){if(d[i].trim().startsWith("|")&&d[i+1]&&/^\|[\s:|-]+\|$/.test(d[i+1].trim())){
 let j=i;const cols=new Set();while(j<d.length&&d[j].trim().startsWith("|")){cols.add((d[j].match(/(?<!\\)\|/g)||[]).length);j++;}
 if(cols.size>1)bad.push((i+1)+":列数{"+[...cols].join("/")+"}");i=j;}else i++;}
console.log("列数不一致的表:",bad.length?bad.join("  "):"0 张 ✅");' $D
# 期望：0 张 ✅（22:40 实测修完 B 行后为 0）

# §7 台账自检（10-03 22:54 新增）。为什么现算而不是手抄：手抄那句「§7 共 16 条未闭合」在我
# 闭合掉两条之后**当场就过期了** —— 台账类数字只有从文件本身推导才不会漂。
awk '
/^## 7\./{f=1; next}
/^## 8\./{f=0}
f && /^[0-9]+\. /{
  n=$1+0; items[++k]=n;
  g=index($0,"已闭合"); c=index($0,"✅");
  if ((g>0 && g<=80) || (c>0 && c<=8)) cl[n]=1;      # 80/8 这两个阈值有依据，见下行
}
END{
  if (k==0) { print "§7 自检失效：一条编号项都没抓到 —— 标题锚点 `## 7.` 改名了，或整节被挪走"; exit 1 }
  max=0; for(i=1;i<=k;i++) if(items[i]>max) max=items[i];
  miss=""; for(x=1;x<=max;x++){h=0; for(i=1;i<=k;i++) if(items[i]==x) h=1; if(!h) miss=miss x " ";}
  if (miss!="") miss=substr(miss,1,length(miss)-1);   # 同上：不摘就是"缺号 [13 ]"这种带尾空格的读数
  s=""; c2=0; for(x=1;x<=max;x++) if(cl[x]){s=s x " "; c2++;}
  if (c2>0) s=substr(s,1,length(s)-1);      # 末项后的那个空格要摘掉，否则单条闭合时输出成"第 10 "
  printf "§7 登记 %d 条 / 最大号 %d / 缺号 [%s] / 已闭合 %d 条(第 %s 条) / 未闭合 %d\n", k, max, (miss==""?"无":miss), c2, s, k-c2;
}' $D
# 期望（10-04 00:3x 现量）：§7 登记 16 条 / 最大号 16 / 缺号 [无] / 已闭合 2 条(第 11 12 条) / 未闭合 14
# 🔴 这一行期望**会随台账闭合进度漂**，它自己就是上一轮的受害者：曾写"3 条(第 10 11 12)"，
#    第 10 条在 00:2x 被现量否证、降级成 🟡 之后当场过期。所以别抄这一行 —— 跑一次，
#    只断言那条自洽式：**登记数 == 已闭合数 + 未闭合数，且 最大号 == 登记数、缺号为空**。
#    四臂变异的期望已经改成**从基线推导**、不再写死数字（见 §5.2 的 h 那件）。
# ⚠️ 阈值不是拍的：实测「已闭合」三个真命中的字节位置是 17/17/71，而两个**假候选**
#    （"闭合判据""闭合代价"那两处）在 85 和 88 —— 所以窗口取 80 且匹配的是**"已闭合"整词**。
#    "1..N 无缺号"这一维也必须留：N 从文件里现取，不写死上界（写死就会漏掉号段外整段）。
```
⚠️ 这两条是**结构自检**，不是内容自检 —— 它们能抓到"表格被竖线劈坏""发布数与索引句不符"，抓不到"某条结论错了"。后者的三把尺子在 §1.1。

---

## 5. 撤回与否证（原句留在这里，不要删）

**这一节和发现本身一样重要。**

1. 🔴 **一条整份作废的子 Agent 报告。** 负责"编排层与支撑包"的 agent 报了一条 P0，写成 `packages/shared-schema/src/line.ts:101` 的 `tryParseOpEnvelope`，并给出"单条约 180ms、100k op ≈ 5 小时"，同时声称报告"已落盘 32,391 字节"。
   📊 复核结果：`packages/shared-schema/` 下**没有 `line.ts`**（实际文件是 `supersync-http-contract.ts`、`entity-types.ts`、`schema-version.ts`、`full-state-payload.ts`、`migrate.ts`、`migration.types.ts`、`auth-http-contract.ts`、`account-profile-contract.ts`、`index.ts`、`migrations/`）；`tryParseOpEnvelope` 全仓 **0 命中**；`strictObject` **0 命中**；**`packages/sync-client/src/` 里 `.parse`/`safeParse` 命中 0 处**（只有注释和 `client.ts:655` 的 `JSON.parse`）。zod 只在服务端边界每**请求**跑一发：`server/src/sync/sync.routes.ops-handler.ts:96`、`server/src/sync/sync.routes.ts` 的 `SuperSyncDownloadOpsQuerySchema.safeParse`（**22:32 在 166 行；22:13 在 163 行 ⇒ 这个文件正被并行会话改着，所以这里按符号定位、行号只作当趟读数**）。
   ⇒ **"逐 op 跑 zod 校验"这个前提本身不成立，那条 P0 与它的数字全部撤回。** 那份报告其余 9 条一并降级为"不可采信"，重发的那趟要求每条引用先自检存在性。
   📌 **可迁移的教训**：子 Agent 回报的"已落盘 N 字节"是**它的意图**，不是磁盘事实。凡是引用一个 `file:line` 就要能一行命令复现它——本文所有 P0 因此都附了取证命令。

2. ✅ **一条我自己判错、被实测否证的怀疑（原句留在这里）。** 我最初把 `packages/op-log/src/engine.ts:635` 判成 P0 候选：

   ```ts
   pendingAtStart.every((row) => row.seq > checkpoint.coveredSeq || checkpoint.appliedOpIds.includes(row.op.id));
   ```

   形状上是 O(pending × N) 的**线性数组查找**（`appliedOpIds` 从 checkpoint 读出来是 plain array）。实测**不成立**：`coveredSeq` 接近日志末尾，`row.seq > coveredSeq` 正常情况**短路为真**，`includes` 基本不执行——它只在真的出现覆盖洞时才跑，而那正是这个检查要防的稀有情况。**这条不是性能问题。** 记下来是因为：如果我没跑那 5 行微基准，它会作为一条 P0 进入这份文档，并且看起来完全合理。

3. ⚠️ **一条落盘但通知没送达**：负责"共享 UI 与移动端"的 agent 写成了 33.5 KB 的报告却没回报。⇒ 判"某个子任务没做完"之前先 `ls` 产物目录，别只看回报。

4. 🔴 **一条被我当场降级的子 Agent P0 —— 形状读对了，频率读反了。** 存储线报的 P0-2 原文是：

   > **桌面壳每次启动**都把壳的 store 全表读进页侧内存，只为判断一个整数是否 > 0

   我按这条去读 `apps/web/src/lib/oplog.ts:305-317`，两处与原文不符：
   - **频率**：守卫在 `:311` `if ((await target.getLastLocalSeq()) > 0) return;` —— 壳的库**非空时当场早退**。所以这条全表读只在"目标为空"的那一次（首次迁移）付，**不是每次启动**。
   - **对象**：`getAllOps()` 读的是 `:317` 的 **`source.store`（旧 OPFS 库）**，不是壳的 store。壳的 store 只付了一次 `getLastLocalSeq()`。
   ⇒ 降级结论：这条**不是 P0**。但它顺带证出的那件事实是真的、而且更重要 —— 接口上根本没有计数方法（→ **P1-10**）。
   📌 可迁移的规律：**"每次 X 都付"这类频率主张，必须去找那个守卫语句本身**，不能只看调用点存在。形状（全表读）与频率（每次启动）是两个独立的断言，只有一个能靠 grep 调用点证。

5. ✅ **三条否证（两条由子 Agent 自己否证自己，我复核了第 a 条）**：
   - **a.「每条 op 一次事务提交」不成立。** 📊 我实测：`grep -c 'this\.db\.transaction(' packages/storage/src/db-op-log-store.ts` = **17**，且 `appendBatch` 的整体就在 `:142` 那个事务里（批内 `:146` 起逐条累积）。一批 N 条 = **一个**事务。真正的代价在批内的语句数与序列化次数（→ **P1-11**；子 Agent 另有一条"批内逐条 3 语句 + 整行重写"本文**未折入**，见 §7 第 14 条），不在提交次数。
   - **b.「缺索引导致全表扫描」在 `ops` 上不成立**（存储线逐条谓词对表核过）。全表扫描来自**调用方发的是无界 `getAll`**（→ **P1-10** 与 **P1-12**；⚠️ 原句这里写的是"已定论那条与 P1-10"，但本文那条已定论的 P0 是 checkpoint 写路径、与无界读无关，20:28 按语义判读改成 P1-10/P1-12），不是 DDL 缺东西。
   - **c.「worker 桥每条 SQL 一次 postMessage」不成立**：边界画在 `OpLogStore` 方法上，一次方法调用 = 一次往返，SQL 在 Worker 内部。
   📌 三条的共同点：它们都是**任务书原本的假设**。把它们写进文档不是为了批评，是因为后来者会照这些假设去"修" —— 而照着修会得到零收益的改动。

6. 🔴 **一条被实测否证的子 Agent P1 —— 同族事故的第三个实例。** Web 线把它的一条 P1 写成「**搜索 memo 在浮层关着的时候仍然全库扫**」。我去读 `apps/web/src/App.tsx:1126-1134`：

   ```ts
   const searchResults = useMemo(() => {
     const q = searchQuery.trim();
     if (q === '') return { tasks: [], notes: [], quick: [] as QuickAction[] };   // ← :1128 空查询当场返回三个空数组
     return {
       tasks: searchTasks(Object.values(store.entities.tasks), q),
       notes: searchNotes(allNotes, q),
       quick: filterQuickActions(quickActions, q),
     };
   }, [searchQuery, store.entities.tasks, allNotes, quickActions]);
   ```

   ⇒ **成立的部分只有**"依赖里带着整店引用、每个 op 会让这个 memo 重算一次"；**"全库扫"不成立** —— `:1128` 那行对空查询直接早退，`searchTasks` 一次都不进。重算的成本是 O(1)。
   📌 这与 [环境陷阱 #182](../reference/environment-traps.md) 是**同一族的第三个实例**（前两个：`.includes` 被 `seq > coveredSeq` 短路、形状像 O(N²) 的循环查找被短路整体废掉）。⇒ 可迁移的规律：**"昂贵形状 + 外层早退"的组合，在只读代码的审查里必然被读成性能问题** —— 判性能之前必须先看那个形状**外面第一层 guard** 是什么，而不是看形状本身。本文 §7 第 9 条把它列为未折入而不是缺陷，就是因为否证优先。

### 5.1 已入 [环境陷阱](../reference/environment-traps.md) —— 落成了 **#181–#186**

**第二次追加（20:16，#185–#186）**：本轮收齐三条扫描线后新出两条，都是**取证装置**层面的，不在这四条原草拟表里 ——

- **#185 🔴 歧义引用会让一次复核得出「错误的确证」**。本轮实测三次：`host.ts:358` 命中三份同名文件、我读了 app-host 那份就以为确认了那条 P0（真落点在 `apps/web/src/lib/oplog.ts`）；`client.ts:906` 被归到 `sync-core` 而真身是 `sync-client`（**包名错、行号完全对得上**）；`sqlite-adapter.ts:561` 少了一层 `sqlite/` 子目录。它与 #181 的区别是致命的：**#181 管编造（核不过），#185 管真内容配了不可唯一定位的坐标（能核过，而且核出个错的）**。
- **#186 🔴 两个"装置自己造红/造空"的形态**：逐行执行 markdown 代码块的 runner 把一个 `D=…` + `echo "$(…$D)"` 的两行块拆成两个进程 ⇒ 报 `P0=0 P1=0 P2=0`（我差点据此宣布文档的判据坏了）；以及 `ls -la | awk '$1>300000 …'` 恒假 + `END{print s}` **印空**（`ls -la` 的 `$1` 是权限串）。⇒ 这两条也就是 §5.2 那两处的台账版本。

判可以安全 append 的现量（20:16 实跑）：最大号 **184**、`stat -f %Sm` = **19:28:20**（= 我上一趟写入，此后无第三方写入）；追加后自检为「**原 4,626 行逐字节未变** + 185/186 存在 + 最大号 186」。脚本用的 throw-on-mismatch 守卫：`maxBefore!==184` 或 `185` 已存在就**不写盘**。

⚠️ **#178–#180 也是未提交状态**（别人/早先会话加的：四端重装判据、`tee` 吞退出码、共享组件双 setter），实测 `git diff -U0 | grep '^+[0-9]+\. '` 得 **178/179/180/181/182/183/184** 七条 —— 也就是**我这四条没有和别人撞号**，但整文件 `git add` 会把七条一起带走。接手的人注意这不是一个人写的。

**落盘证据**（第一次，2026-10-03 19:28）：#181 = 下面的 A，#182 = B，**#183 = C 与 D 合并成一条**（C 是项目事实、D 是让 C 判错的探针，分开写会让人只读到一半），**#184 是新增的**（zsh 下 `${PIPESTATUS[0]}` 是空值 —— 本文 §4 那条坏探针跑的时候当场踩到，原草拟表里没有）。

为什么判定"可以安全 append"：台账确有别人的未提交改动（**+48 行，最大号从 `HEAD` 的 177 漂到工作树的 180**），但**文件最后写入时间是当天 11:53，距当时已 7.5 小时无写入**，且末尾正好停在 #180、后面没有收尾段 ⇒ 末尾追加不会插进别人段落中间，而后续整文件 `git add` 会把 181–184 一起带走而不是抹掉。

⚠️ **仍存的撞号风险（如实登记）**：那 +48 行的作者如果**稍后**再往同一个台账 append，会从他看见的下一个号开始 —— 也就是可能撞上 181。接手的人若发现两条 181，**按"编号只增不改"的规则，后来者改号**，并把本文这四条的编号同步改掉。
   ✅ **21:53 这条风险的结局已可查，而且和预测不一样**：那位作者**又追加了两次**（#187 提醒包身份 / #188 提醒回执乱序收敛，两条都署 ADR-0051 那条线），但**没有撞号** —— 他从 **187** 起，正是工作树当时的最大号 + 1。⇒ 没撞的原因不是运气，是**他也跑了同一条取号命令**。这条纪律真正的保护力在这里：**防撞靠的是"所有写者都从工作树现量取号"，不是靠谁预留了号段**。反之，我这边预留的 #188 就被他占掉了（见 §7 第 15 条，已改号为 #189）——**预留号是会过期的资源**，这一格两头都验证过了。

现量命令（判能不能追加，就这两条）：

```bash
grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1   # 编号按工作树取，不按 HEAD
git diff --numstat docs/reference/environment-traps.md   # 非 0 = 有未提交改动（不等于"正有人在写"）
stat -f %Sm -t '%H:%M:%S' docs/reference/environment-traps.md   # 🔴 这条才是"有没有人在写"的读数：写入时刻
```

> 📌 本轮差点在这里犯第二个错：只看 `git diff --numstat` 会得出"正有人写 ⇒ 不能追加"。
> 但**未提交的改动 ≠ 正在发生的写入** —— 加上 `stat` 那个写入时刻之后，结论从"等着"变成"可以落"。
> 而且 `条目总数 189 > 最大号 180` 也是同一个陷阱的小兄弟：`^[0-9]+\. ` 会命中条目**正文里的编号列表**，
> 它不是条数，别拿它当"有多少条陷阱"。

| 草拟 → 实际 | 症状 | 为什么值得进台账 |
|---|---|---|
| **A. 子 Agent 回报的"已落盘 N 字节"是它的意图，不是磁盘事实** | 一条 P0 连同引用路径、符号名、毫秒数全是编的（`shared-schema/src/line.ts` / `tryParseOpEnvelope` 均不存在），却同时声称报告已写成 32,391 B | 本仓库已有大量"探针坏 vs 真故障"的条目，但**这一类的新载体是 agent 回报**。判别动作只花一条命令：`ls` 产物 + `grep -n` 复现那个 `file:line` |
| **B. 形状像 O(N²) 的循环查找，可能被一个短路条件整体废掉** | `engine.ts:635` 的 `.every(… \|\| arr.includes(…))` 我判成 P0 候选，实测被 `row.seq > coveredSeq` 短路、`includes` 几乎不跑 | 与既有"一条永远通过的判据比没有判据更糟"对偶：**一条永远不执行的循环也不构成瓶颈**。判形状之前要读**求值顺序** |
| **C. 有 4 个索引在 `schema.prisma` 里根本不存在，而且不是漏写 —— Prisma 表达不了 partial index** | 4 个 partial 索引只活在迁移裸 SQL：`operations_user_id_server_seq_encrypted_idx`（`WHERE is_payload_encrypted = true`）、`operations_user_id_full_state_server_seq_idx`（`WHERE op_type IN ('SYNC_IMPORT','BACKUP_IMPORT','REPAIR')`）、`operations_user_id_causal_full_state_server_seq_idx`（`WHERE op_type IN (…) OR (op_type='REPAIR' AND repair_base_server_seq IS NOT NULL)`）、`operations_payload_bytes_unbackfilled_idx`（`WHERE payload_bytes = 0`）。前两个与第三个**列集完全相同**（都是 `(user_id, server_seq)`），只靠谓词区分 ⇒ **按列集去比对也看不出来** | "这个查询有没有索引"若只读 `schema.prisma`，会把这 4 条判成缺失并重复建；要判得对只有两条路：读迁移 DDL，或直接查 `pg_indexes`。见下面命令① |
| **D. 🔴 按索引名 `grep schema.prisma` 会恒判"缺失" —— 我踩过，命令跑出一条 47 条假阳性的证据** | Prisma 的 `@@index([...])` / `@@unique([...])` **默认不写索引名**，名字是 Prisma 自己按 `<table>_<cols>_idx` 约定生成的；本仓库 24 条 `@@index` 里**只有 1 条**用了 `map:`（那个 GIN）。所以拿迁移里的 `"operations_user_id_received_at_server_seq_idx"` 去 grep schema 必然 0 命中 —— 而它其实就写在 `@@index([userId, receivedAt, serverSeq])` | **本次审计我自己写进文档的第一条判据就是坏的**，而且它输出 47 条、看起来非常权威（`users_email_key` 也在里面，而那实际是 `@@unique([email])`）。发现方式：把命令照原样跑一遍，发现期望 4、实际 47。📌 一般规律：**"名字对不上"和"东西不存在"是两件事**；比对索引只能比**列集 + 谓词**，或干脆问数据库 |

复现命令（**下面每条都在 2026-10-03 真跑过，期望值就是当时的实际读数**）：

```bash
# ① 迁移里带 WHERE 谓词的索引（Prisma 表达不了 ⇒ 必然在 schema 之外）→ 实测 4 条
find server/prisma/migrations -name 'migration.sql' -exec \
  awk 'BEGIN{RS=";"} /CREATE[ \t]+INDEX/ && /WHERE/ {n=$0; gsub(/[ \t\n]+/," ",n); print n}' {} \; \
  | grep -c 'CREATE INDEX'

# ② 对照 schema.prisma 里 Operation 声明的列集（只能按列集比，不能按名字比）
awk '/^model Operation /,/^}/' server/prisma/schema.prisma | grep -E '@@index|@@unique'
#    实测 4 行：@@unique([userId, serverSeq]) / @@index([userId, entityType, entityId, serverSeq])
#             / @@index([userId, receivedAt, serverSeq]) / @@index([entityIds], type: Gin, map: "operations_entity_ids_gin")

# ③ 名字法为什么不可用的直接证据：全 schema 里 map: 的出现次数 → 实测 1
grep -c 'map:' server/prisma/schema.prisma
```

**已被实测否证、留在原句旁不许删的两句**（本次审计过程中我自己说错的，都不成立）：

- ~~"还有 5 个 schema 里写着、已被迁移删掉的假索引"~~ —— 按列集看，`schema.prisma` 里确实没有 `(userId,clientId)`、`(userId,opType)`、`(userId,entityType,entityId)` 三列版、`(userId,receivedAt)` 两列版这些列集，**Prisma 正确反映了那些 DROP**。方向不成立。
- ~~"含一个 GIN，schema 看不到"~~ —— GIN 在 schema 里，而且是唯一一条带 `map:` 的声明（命令③的读数 1 就是它）。

⚠️ **仍未闭合的缺口（本文不假装解决）**：上面三条命令都只在**仓内两份声明**之间比，真正的对账是 **`pg_indexes`（生产库实况）↔ 仓内声明** 两两核对 —— 需要一个能连库的门禁，本轮没有做。


---

### 5.2 本文每条命令的复跑读数（期望值必须等于实际读数）

20:14 把本文 **6 个 bash 代码块 + 6 条行内命令当场全部跑了一遍**。逐条对照：

| 命令（本文位置） | 文档写的期望 | 实跑读数 | 判定 |
|---|---|---|---|
| §1 ① `React.memo` 命中文件数 | 0 | 0 | ✅ |
| §1 ② 移动端虚拟化原语命中 | 0 | 0 | ✅ |
| §1 ③ 共享层 `FlatList` 所在文件 | 只有 TaskList.tsx | `packages/ui/src/task-list/TaskList.tsx` | ✅ |
| §4 计数自检 | P0=11 P1=17 P2=4 | 20:14 那趟是 11 / **16** / 4；20:42 折入 P1-17 后重跑得 11 / **17** / 4，并已同步 `docs/README.md` 那句。🔴 **10-04 00:08 再到 18**：闭合 §7 第 5 条（那批"子 Agent 报过、我没复核"）时落出一条真的新 **P1-18**，两处副本同批改掉 ⇒ 本行左列是**当时**的读数，不是当前值 | ✅（期望值曾落后一条，见 d） |
| P0-8 `state[bucket]` 展开点 | 3 处 | 3 | ✅ |
| P0-9 主入口字节 | 1,936,369 | 1936369 | ✅ |
| P0-9 gzip | 573,480 | 573480 | ✅ |
| P0-9 `build:` / `manualChunks` | 0 | 0 | ✅ |
| P0-9 两份语言表 | 781,062 | **第一版命令印空 → 修正后 781062** | ⚠️ 见 b |
| P0-1 无参整店订阅 | 18 | 18 | ✅（⚠️ 22:31 复跑 = **19**：多出那处在未入库的 VaultSettingsPanel.tsx ⇒ **活读数**，见 P0-1 那行） |
| P0-1 每行交互组件 | 9 | 9 | ✅ |
| P0-1 `react-virtual` 声明 | 0 | 0 | ✅ |
| §5.1 陷阱现量（最大编号 / partial 索引 / `map:` 处数） | 184 / 4 / 1 | 184 / 4 / 1 | ✅ |
| §1.1 未入库引用 `git status` | 3 条 | `??` 的正是那几个日历文件 | ✅ |
| **（20:47 补跑）** P1-13 `limitVectorClockSize` src 侧命中 | 5 | **5**（原先文档写"只在 `sync-core/dist/*`" ⇒ **错**，见 d） | 🔴 已更正 |
| **（20:47 补跑）** P1-13 调用形状（排除 tests/dist/research） | 0 | **0** | ✅ |
| **（20:47 补跑）** P1-13 `archiveUpTo` src 侧命中 | 3 | **3**（原先文档写"只在 dist 与 tests" ⇒ **错**，见 d） | 🔴 已更正 |
| **（20:47 补跑）** P1-13 `limitVectorClockSize(` 命中所在目录 | 两个 tests 目录 | `packages/op-log/tests/vector-clock-trim.spec.ts` 6 行 + `packages/sync-core/tests/vector-clock.spec.ts` 24 行 = **30** | ✅ |
| **（20:47 补跑）** P1-13 服务端拒绝闸门 | `MAX_ACCEPTED…= 4096`，判定在 `:195-199`，调用者 `validation.service.ts:235` | 逐行读到原文 | ✅ |
| **（20:47 补跑）** P0-9 worker/wasm 合计 | 1,303,216 | 1303216 | ✅ |
| **（20:47 补跑）** P0-9 两份语言表 | 781,062 | 781062 | ✅ |

🔴 这一步抓到**两处**。两处的共同点很重要：**都不是文档内容的错，而是取证装置的错** —— 这就是"把命令跑一遍"这件事的价值所在。

**a. 一个逐行执行 markdown 代码块的 runner 会自己造红。** 我用 `node -e` 抽出文档里的 bash 块、对**每一行单独** `execSync`，于是 §4 那个两行块（先 `D=…`、再 `echo "P0=$(… $D)"`）被拆进**两个进程** ⇒ 第二行里 `D` 不存在 ⇒ 三个计数全部打印 **0**。我的复跑工具因此报告"文档的自检命令输出 0/0/0"。
   如果照这个输出宣布"文档的判据坏了"，那就是**用探针自身的缺陷制造了一条假红**（AGENTS.md §7 元规则第 1 条的具体形态）。
   ✅ 正确做法：**一个代码块 = 一次执行**（`bash -c '<整块>'`）。改成整块执行后立刻得到 11 / 16 / 4。
   📌 可迁移：**逐行执行的 runner 只适用于"每行自足"的命令**；任何 `VAR=` 之后被引用的块都必须整块执行。

**b. `ls -la | awk '$1>300000 …'` 恒假，而且它的失败方式是"印一个空行"。** `ls -la` 的 `$1` 是权限串（`-rw-r--r--@`），字节数在 `$5` ⇒ 条件恒假 ⇒ `s` 从未累加 ⇒ `END {print s}` 打印**空**。⇒ 我写进文档的第一版复现命令产出空值，而**空值在终端上和"命令跑通了、数据就是这样"几乎无法区分**。
   ✅ 已改成 `$5>300000` 并把输出写成 `print s+0`（无命中时打印 **0** 而不是空），实测 781062。
   📌 可迁移：**awk 汇总打印要写 `s+0`** —— 否则"没有命中"和"字段号用错"两类故障长得一样，而 `0` 至少是一个能判断的读数。

**c. 🔴 自检探针自己也坏了一次，而且坏的方式是"报出一条不存在的问题"。** v4 对每行跑**两遍**循环：第一遍扫完整行、把 `last` 停在**该行最后一个**路径 token 上，第二遍才处理裸 `` `:N` `` ⇒ 对 §6 那行「判据对象只有 `apps/mobile`（**冒号 49 那个裸引用**），然后 `package.json` 里带 `check:*` 的只有…」，行号 49 明明属于前面的 `scripts/check-mobile-bundle.mjs`，却被记成 **`package.json` 的"歧义"**。
   ✅ v5 改成**单遍按位置顺序**扫描（每个裸行号挂给它**前面最近**的 token），那条假歧义消失。**但它不是严格更好**：v5 会把 `` `Object.values:110` ``、`` `labels.dayTitle:246` `` 这类**被反引号包住的代码 token**当成路径承接点，于是"非路径 token" 涨、"唯一引用"从 112 涨到 145。两版读数都写进了 §1.1 那张表。
   🔴 **本条还有一个自我指涉的尾巴，值得单独记**：我把 v4 的病因写进本节时，**原样照抄了那行字面**，于是 v5 立刻又报出一次 `package.json` 的歧义 —— 这一次**不是探针坏，是我的"举例"没有被排除在判据之外**。处置是**改写引文**（上面那行现在写"冒号 49 那个裸引用"而不是真字面），**不是**给判据加豁免。
   📌 可迁移：**举例身份要免检，靠的是把例子写成判据认不出的形状，而不是给判据开洞**。同一条规律的另一面写在 §1.1 那格和 [环境陷阱 #185](../reference/environment-traps.md) 里。
   📌 可迁移：这条和本节 a 是同一件事的两面 —— **判据升级必须报"旧读数 vs 新读数"以及"哪些格是两版一致的"**。本文那格里承重的是「**行号越界 = 0，两版一致**」：它不随探针版本变，所以结论可以依赖；而"唯一引用 145"这种依赖 token 切分的数，写出来就必须带上是哪一版。

**d. 🔴 20:47 复跑否证了我自己写进 P1-13 的两行现量 —— 而且结论没错、证据全错。** 原文写「`archiveUpTo` 命中只在 `packages/storage/dist/*` 与 `…/tests/contract/…`」「`limitVectorClockSize` 命中只在 `packages/sync-core/dist/*`」。换 `git grep` 复跑：**src 侧分别有 3 处与 5 处命中**（接口声明 / 实现 / worker 转发；定义 / 注释 / 导出 / server import / server re-export）。
   三个成因叠在一起：① 我第一版用的是 `grep -rn`，**它会遍历 `node_modules`** —— 同一条 `encryptBatch` 查询在 `grep -rn`（排 dist）下 **43 行**、在 `git grep`（排 dist）下 **68 行**，两个都不是答案；② 我把"排除 dist 之后没看到 src 命中"当成了"src 没有命中"，但真正的 src 命中被我的目录参数范围漏掉了；③ **最本质的**：我把「零命中」当成了「零调用点」。这两句话不一样 —— 后者要求**逐枚归类**每处命中的身份。
   ✅ 已把 P1-13 整条的证据重写为归类表，并把错误原句划掉留在原地。**结论没有变（调用形状命中 = 0），但这条的分量变了**：真相不是"没有归档/裁剪功能"，而是"**通道全部铺好、开关从没人按**"，后者才是要报的东西。
   📌 可迁移：数"有没有人用某函数"时，**import / re-export / 声明 / 转发 / 注释一律不算调用点**，判据必须是带括号的调用形状；命令口径统一用 `git grep`（只扫跟踪文件），别用 `grep -rn` 扫目录树。已按 §5.1 的取号流程拟入环境陷阱（见 §7 第 15 条）。

**e. 我这次 Edit 又吃掉了一行表格的首格。** 给 §6 追加 ADR-0008 那行时，`old_string` 取的是下一行（`encryption.ts` 那行）的**开头**，`new_string` 只带回了我新写的那行 ⇒ 相邻行的第一格被静默删除，两行粘成一行 5 格。是 `grep -n "ADR-0008"` 复跑时看到那行长度不对才发现的。
   📌 可迁移（与用户记忆里那条同族，但这次的形态是**表格行**而不是代码块）：往 markdown 表格里插行，`old_string` 要么**整行含首格完整带上**，要么锚在**行尾的 `|` 与换行**上，不要锚在下一行的开头。追加完必须把新行和它的下一行都读一遍列数。

**f. 21:53 把本文**全部 11 个命令块**整块复跑了一遍（Goal ⑤ 的收口动作），并当场又抓到自己的 runner 一次。** 逐块结果：

| 块（文档行） | 期望 | 实跑 | 判定 |
|---|---|---|---|
| L42 §1 三条实测 | 0 / 0 / `TaskList.tsx` | `0`、`0`、`packages/ui/src/task-list/TaskList.tsx` | ✅ |
| L93 §1.1 未入库现量 | `??` 三个日历 + `checkpoint.ts` + `UNTRACKED（磁盘上：有）` | 全中（另多出 `?? CalendarViewTabs.tsx` —— 别人在飞的第 4 个文件，非缺陷） | ✅ |
| L143 整店订阅 | 18 | 18 | ✅（⚠️ 22:31 = 19：见 §1.1「第三把尺子」，同一趟还有两处行号漂） |
| L553 P1-13 两条 | src 侧 5 命中；调用形状 **0**（rc=1） | 5 条逐字对上；第二条 **0 命中 ⇒ rc=1** | ✅（rc 语义已写进 §7 第 13 条那块） |
| 「§4 计数自检」块（原文这里写的是 `L637` —— 本文自己的行号，已经漂了，改按标题定位） | P0=11 P1=17 P2=4 | `P0=11 P1=17 P2=4` | ✅ Goal ③ 第三次复现。⚠️ **该行是 22:4x 那趟的读数；10-04 00:08 起当前值是 18**（见上一行） |
| L716 §5.1 取号三条 | 块内**不写期望值**（它就是"现取"命令） | 最大号 **188** · `git diff --numstat` = **173 行未提交** · `stat` = **21:21:16** | ✅ 三行都可跑。🔴 反倒是**我这一行原先写了"期望 184"** —— 那是我把 §5.1 正文里 20:16 那次的历史读数错当成这块的期望值。已改成本句 |
| L736 §5.1 三条索引现量 | 4 / 4 行 / 1 | `4`、四行原文、`1` | ✅ |
| L873 §7 第 13 条 | 目标清单 + `0008` 是 ` M` + HEAD 命中 0 | 15 个目标；` M`；`0`（rc=1） | ✅，但**该块原来带一个 `<link-check 输出>` 占位符，粘上去跑不了** ⇒ 已改成自包含三行 |
| L885 本文链接自检 | 链接 6 · 磁盘缺 0 | `链接 6 · 磁盘缺 0` | ✅ |
| L909 §7 第 14 条报告现量 | 三行"已不在" | 三行"已不在" | ✅（这条命令的 else 分支在写它时就预想过会用到） |
| L955 §7 第 15 条台账现量 | 187 / 4,670 / 20:46 / 341,644 | **188 / 4,681 / 21:21:16 / 342,623** | 🔴 已整表更新，预留号 #188→**#189**；⚠️ **22:28 第四次取号时 #189 也被占了 ⇒ 现预留 #190**（见 §7 第 15 条） |

🔴 **runner 这次坏的方式和 a/b/c 同族，但更基础**：我第一版用 `execSync("bash -c " + JSON.stringify(body))`，`JSON.stringify` 把换行转成**字面 `\n`**，而外层是双引号 ⇒ bash 收到的是"一行里有若干 `\n` 文本"，于是 `grep` 把下一个词当文件名、`for` 循环体塌成 `do\n`、`wc -c <$f` 变 `ambiguous redirect`。**11 块里 6 块报"错"**，而**报错内容全是 runner 的形状，不是文档命令的形状**。
   ✅ 改成**每块落一个临时 `.sh` 再 `bash file`**，11 块立刻全部跑出可用读数。
   📌 可迁移：**跨语言传多行 shell 给子进程，只有"写文件再执行"是无损的**；字符串转义（`JSON.stringify`、heredoc、`-c` 引号嵌套）都会在某一层把换行吃掉，而它的症状是**被测对象大面积失败**——按 AGENTS.md §7 的元规则第 1 条，大面积齐刷刷报错先怀疑探针。

   **22:31 用修好的 runner 复跑全文（此时是 12 个 bash 块，本表写下的那趟是 11 个，多出的是 §1.1 的抽查块）**：11 块 rc=0、1 块 rc=1（P1-13「调用形状 0 命中」那条，属预期，判据只认打印值）。**三处读数与 21:53 不同，全部是"活读数随并行会话变"**：整店订阅 18 → **19**（新未入库文件）、§5.1 取号块 187 → **189**（台账又被追加两次）、§7-13 目标数 44 → **45 处**。🔴 而**最值钱的一条不是这三个数**：抽查块里 `apps/mobile/src/App.tsx` 与 `server/src/sync/sync.routes.ts` 两行 `sed -n 'Np'` 打出来的**不是我说的那件事** —— 而这两条引用 18 分钟前才被我按尺子 2 校准过、尺子 1/2 此刻仍然双双报 0。⇒ 这就是 §1.1「第三把尺子」那一节的由来，也是本表从"整块复跑"升级成"复跑 + 查活文件"的原因。
   **22:40 再跑一趟（此时全文 13 个块，读数出自 runner 打印的「块总数」）**：逐块与期望一致，并把这一轮新长出的两条常驻自检收了进来 —— §4 的**表格列数一致性**（它当场抓到 §5.1 表 B 行里 `.every(… || …)` 那个裸 `||` 把单元格劈成两列，已改成 `\|\|`）与 §1.1 的**活文件普查**。⚠️ **这一句我第一次落笔写的是"14 个块"，没跑命令** —— 一测就是 13。这正是本文从头到尾在登记的那类失效（凭印象写数），差别只是这次的对象是本文件自己的块数；写进来是因为**"最后一段才犯的错"最容易不被记录**。⇒ 本表（21:53 那趟 11 块）到此停止追加；要当前值就重跑 `run-blocks` 那个形状，别引用本表。

**g. 22:13 批量修 8 处引用时，替换装置自己造了两处新缺陷 —— 而"命中数全部达标"一点都没抓到它们。**

修引用用的是"读全文 → 逐条 `split/join` → 每条带最小命中数断言 → 全部成功才 `writeFileSync`"。这一趟它**两次拒绝写盘**：

1. 我给 `packages/sync-client/src/client.ts` 的 905 行写了"期望 ≥3"，实到 2 —— 第三条是**短形式** `client.ts:905`（同一行号、不同写法）。脚本在**内存里**就停了，磁盘上那份还是原样。
2. 第二条模式我多打了一个前导反引号（`` `publish.ts:78-81 `` 而正文里反引号在 `apps/…/publish.ts` 的开头）⇒ 0 命中，又是拒绝写盘。

✅ 这两次都是**装置按设计工作**。真正的新缺陷是**过了断言之后的**：

| 造出来的东西 | 为什么断言抓不到 | 怎么发现的 |
|---|---|---|
| `:923` 前面**少了开反引号** ⇒ markdown 里多出一个游离反引号，内联代码整体错位一行 | 断言量的是"旧串命中几次"，不看**替换串自身**是否带回了两端的定界符 | 事后 `sed -n '388p'` 逐行看被改的行 |
| 给 `apps/web/src/App.tsx:197-198` 加"整店订阅"标注时**命中 2 处**，第二处落在一个本来就带括号的句子里 ⇒ 双层嵌套 + 一个尾随空格 | 命中数断言写的是"≥1"，`split/join` 就把**两处都改了**，而我只打算改一处 | 同上（打印两处上下文才看见第二处不是位置行） |

📌 可迁移（与 §5.2 a–f 同族，但补的是**替换**这一半）：**"命中数达标"只证明旧串存在，不证明替换结果是对的**。批量替换之后至少做两件：① 重跑那两把尺子（本轮越界仍 0、空行/纯闭合仍 0）；② **把每条被改的行原样打印一遍看一眼** —— 我这次是第 ② 步救回来的，而它便宜。另：给"标注类"替换写期望命中数时要先数**这个串在文中共几种身份**（位置行 vs 正文句子），"≥1"是这次两处误伤的根源。

⚠️ **同一种装置缺陷这轮又出现第三次，记下来是因为它和前两次不同：它失败得很干净。** 我在 heredoc 里写 `node -e '…'` / `.cjs`，替换文本是**双引号 JS 字符串**，而中文句子用了 ASCII `"…"` ⇒ JS 在 `SyntaxError: Unexpected identifier '讲这件事怎么做'` 处停住，**一个字都没写进文件**。同一形状连撞三次（第二次连"该不该收进 scripts"那句也被截断）。✅ 正确的修法不是转义，是**改通道**：中文正文里的引一律用全角「」，或干脆走 Edit 工具而不是脚本。📌 可迁移：**"替换脚本没运行"和"替换没写盘"在这条通道上是同一件安全的事**（`writeFileSync` 在末尾），而它只在"所有断言都通过"时才发生 —— 这就是把写盘放到最后一步的全部价值。

**h. 10-03 23:54 → 10-04 00:00 新加的那条常驻自检，是踩着自己两个新缺陷才学会不撒谎的。**

给 §4 加"§7 台账自检"这一条时（就是本节上面那块 awk），先后撞出两件性质不同的事：

| # | 发生了什么 | 症状 | 为什么严重 |
|---|---|---|---|
| 1 | 变异臂用 `sed -E '…{s/✅//; s/…/…/ }'`（BSD sed 不吃这种分组写法）**报错**，而 `> /tmp/mut10.md` 这个重定向**在 sed 跑之前就把文件截断了** | awk 读到空文件 ⇒ 打印 `已闭合 0 条 / 未闭合 0` | 这是 §5.2 整节反复讲的那个形状：**空测量看着最干净**。四臂里三臂 rc=2、一臂报"0 条"，如果我当时只看"有没有红"，那臂"0 条"会被读成"台账空了"而不是"输入空了" |
| 2 | 我用 Edit 给 awk 加非空守卫时，`old_string` 覆盖了三行、`new_string` 只带回两行 ⇒ **把 `miss=…` 那行计算吃掉了**，而 `printf` 里仍然引用 `miss` | 输出**照旧**是 `缺号 [无]` —— 一模一样 | 🔴 比第 1 件严重得多：这不是"探针没测到"，是**门禁当场掉牙而且不掉色**。`miss` 变成未初始化 ⇒ 恒为 `""` ⇒ "1..N 无缺号"这一维从此**永远报无缺号**。没有报错、没有红、没有形状变化 |

两处都是**先红一次再改对**：第 1 件把变异装置换成 node（`replace` 命中数不达标就拒绝继续、并且打印 awk 的 **stderr**，rc=2 不再伪装成读数）；第 2 件是把丢的那行补回去之后重跑，才拿到下面那份四臂读数。守卫本身也留了下来（`if (k==0) { print "…自检失效…"; exit 1 }`）—— 它是第 1 件教的，但**它挡不住第 2 件**：第 2 件里 k 是 16、一切正常。⇒ 可迁移的那条不是"再加一个守卫"，而是：**改门禁的代码时，改完必须让门禁在一个"本该命中"的样本上跑一次**（这里就是臂 2：造一个缺号，看它点不点名）。

四臂读数（第一趟的装置是 `/tmp/heyta-perf-scan/mutate-s7-check.cjs`，**已换成仓库里的 `research/tools/audit-self-check-mutation.mjs`** —— 理由就是紧跟在这张表后面的那次否证）。装置从文档里**现抽** awk 程序而不是抄第二份 —— 抄一份就是 §5.2 老话题里的"同一个判断写两遍"：

| 臂 | 变异 | 期望 | 实读（10-03 23:5x） |
|---|---|---|---|
| 0 | 无（对照） | 已闭合 3 条(第 10 11 12 条) / 未闭合 13 | ✅ 同 |
| 1 | 抹掉第 10 条的 `✅` 与"已闭合" | 已闭合 **2** 条(第 11 12 条) / 未闭合 14 | ✅ 同 |
| 2 | 把第 13 项编号改成 `13x` | 登记 15 条 / 最大号 16 / **缺号 [13]** | ✅ 同 |
| 3 | 把 `## 7.` 标题改名为 `## 七、` | **rc=1** 且打印"§7 自检失效…" | ✅ 同 |

🔴 **上面这张表在两趟之间被现量否证了一半，而否证它的正是它自己**（10-04 00:3x 重跑旧装置）：

| 臂 | 00:3x 重跑 | 原因 |
|---|---|---|
| 0 | **FAIL** | 期望写成字面量"已闭合 3 条(第 10 11 12 条)"，而第 10 条在 00:2x 降级成 🟡 ⇒ 基线实读 `已闭合 2 条(第 11 12 条) / 未闭合 14`。**门禁没错，是装置过期** |
| 1 | **FAIL（响亮）** | 变异正则 `^10\. ✅ \*\*P1-14 已闭合` 命中 0 次 ⇒ 走到 `if (a1 === orig)` 那个守卫并报"装置失效"。**那条守卫是承重的**：它让"靶子没了"以 FAIL 收场，而不是以"四臂全对"收场 |
| 2 | PASS | 但**原设计是运气**：它删的是第 13 项（非最大号），所以缺号维度留得下洞 |
| 3 | PASS | 锚点与措辞都没变 |

⇒ 新装置改了三个地方，每处都是被上面某一臂教出来的：① **期望从基线推导**，臂 0 断言的是自洽式（登记 == 闭合 + 未闭合、最大号 == 登记、缺号为空、闭合号不越界不重复）而不是具体数字；② **臂 1 的靶子从基线闭合列表里取**（当前取到第 12 条），不再写死编号；③ **臂 2 改删"最大号减 1"那一项** —— 这不是随手挑的：**删最大号自己造不出缺号**，awk 的 `max` 是从现存编号现取的，把最大项摘掉 `max` 会跟着降、缺号反而报"无"（这一条是我先按"删最大号"写、跑出来 `最大号 15 / 缺号 [无]` 才看到的，属于**装置自己的期望错**，第 5 个真凶）。

00:3x 新装置实读（`node research/tools/audit-self-check-mutation.mjs` ⇒ `4 臂：4 对 / 0 不对 ✅`，RC=0）：

| 臂 | 变异 | 期望（推导） | 实读 |
|---|---|---|---|
| 0 | 无（对照） | 登记 16 = 闭合 2 + 未闭合 14，最大号 16，缺号空 | `§7 登记 16 条 / 最大号 16 / 缺号 [无] / 已闭合 2 条(第 11 12 条) / 未闭合 14` ✅ |
| 1 | 抹掉**闭合列表里最后一条**（现取到 12）的 `✅` 与"已闭合" | 闭合少 1 ⇒ `第 11 条`、未闭合 +1 | `已闭合 1 条(第 11 条) / 未闭合 15` ✅ |
| 2 | 把第 15 项编号改成 `15x` | 登记 15 / 最大号仍 16 / 缺号点名 `[15]` | `§7 登记 15 条 / 最大号 16 / 缺号 [15]` ✅ |
| 3 | `## 7.` → `## 七、` | **rc=1** 且打印"§7 自检失效…" | `rc=1 出=[§7 自检失效：一条编号项都没抓到…]` ✅ |

⚠️ **新装置仍然不是门禁**：它没挂进 `pnpm check`，而且它**自己没带阳性对照**（臂 0 的自洽式在"台账 0 条闭合"时会退化成"臂 1 无靶子 ⇒ FAIL"，这是设计如此、不是漏）。这两点和 §7 第 16 条讲的是同一件事。

⚠️ 阈值 `80` / `8` 不是拍的：实测三处真命中的字节位置是 17 / 17 / **71**，而两个假候选（正文里的"闭合判据""闭合代价"）在 **85 / 88** —— 窗口取 80 恰好把假候选挡在外面，同时匹配的是**"已闭合"整词**而不是"闭合"。⚠️ 这类"从相邻文本里划窗口"的阈值**只在当前文档长度与措辞下成立**，谁把第 12 条那行改长，它就可能掉出窗口 —— 所以臂 1 那种"抹标记"的变异要跟着常驻，不能只跑一次。

📌 与本节 a–g 的关系：a–g 全是**尺子误读**（假阳性/假阴性），h 是**第一例"门禁静默失去牙齿"**，而且它不是被任何检查抓到的，是我把 `old_string` 与 `new_string` 逐行对了一遍才看到的。⇒ 这一条应该进环境陷阱（见 §5.1 追加的 E）。

⚠️ **本节自身也会漂**：它记的是 10-03 的 20:14–20:22、20:47、21:53、22:13、22:47–22:56（P1-14/P1-16 两条否证）与 23:54–00:00（h）六趟的读数。要当前值请重跑命令，不要引用本表。

---

## 6. 与既有决策/门禁的关系（避免把已缓解的当新问题报）

| 既有物 | 它实际覆盖到哪 | 本文哪条在它之外 |
|---|---|---|
| [ADR-0047](../adr/0047-checkpointed-incremental-hydration.md) 增量水合 | **读路径**（冷启动只重放尾部），各端已接上：`apps/web/src/lib/oplog.ts:363`、`packages/app-host/src/host.ts:270` | **P0-2 写路径**不在它的实测范围内 |
| `scripts/measure-hydration.mjs` | 只在 `recover()` 上取数（全量 9.5672s / 尾部 30.9ms），且它自己声明"不能冒充 Hermes 性能结论" | 同上；且**没有任何门禁常驻跑它** |
| `scripts/check-mobile-bundle.mjs` | **只数 React 份数**（防双实例，那是修过的真事故） | **P0-5** 的体积与模块数它一条都不管 |
| AGENTS.md §5「统一用 Lucide」 | 规定图标**来源**，没规定引入方式 | **P0-5** 的改法仍在规则内 |
| AGENTS.md §3.4 op-log 纪律 | 规定"一个意图 = 一个 op" | P0-1/P0-2 是 op **之后**的成本，不冲突 |
| [环境陷阱 §7 第 171 条](../reference/environment-traps.md) | Hermes 字节码里的中文是 UTF-16LE，`grep` 恒 0 | 同一个探针盲区让 `grep lucide` 在产物里恒 0 ⇒ **P0-5 的诚实边界** |
| **（新）** AGENTS.md §3.4 op-log 纪律 | 规定"一个意图 = 一个 op"、回放不得再触发副作用 —— 全是**写入口的形状** | **P0-8** 是 op **物化时**的成本，纪律一条没违反，形状却是整桶展开。⇒ 这条不会被任何现有规则拦住，只能靠判据 |
| **（新）** web 产物体积门禁 | 📊 实测：**不存在**。`scripts/check-mobile-bundle.mjs` 的判据对象只有 `apps/mobile`（`:49` `const MOBILE = path.join(ROOT, 'apps/mobile')`），`package.json` 里带 bundle/size 的 `check:*` 只有 `check:mobile-bundle` 与 `check:calendar` | **P0-9** 整个落在这格空白里 —— 首屏从 0.5 MB 长到 1.94 MB 不会有任何东西失败 |
| **（新）** `packages/domain/src/subtasks.ts` 的环防护 | 它是 `canSetParent` 的**唯一实现**，文件注释明写"土办法会漏掉后代这一整类 = 环" ⇒ 语义上被守得很严 | **P0-10** 恰恰是**因为**守得严才贵（每次调用重建全量索引）。这提示 §8 第 8 步的正确改法是"把索引提到调用方"，**不是**简化判定 |
| 🔴 **（新）[ADR-0008](../adr/0008-vector-clock-limit.md) 的时钟上限决策** | 它把 20→100 的理由、以及"因果安全的压缩**没有做**"都写清了；§根因 那张「服务端存储时 / 客户端派发时」表是**对事故当时机制的诊断**，不是待接线清单 | **P1-13** 报的是它**之后的新形状**：实测两处裁剪调用今天都不存在 ⇒ 分歧被"从不裁剪"消解、`MAX_VECTOR_CLOCK_SIZE=100` 与 ADR §3 承诺的"唯一出口信号" `console.warn` 一起进了死代码。**这不是 ADR 没执行，是 ADR 执行之后出现了一个它没描述的状态** —— 要改的是 ADR 的适用范围声明，不是回滚它 |
| 🔴 **（新）`packages/sync-core/src/encryption.ts:263-269` 的那条注释本身** | 它把"不要用 `Promise.all` 并发 Argon2id"写成了**明文理由**（64 MB/次、单线程、移动端 OOM），并在解密侧照此改成了串行 | **P0-11 不是"落在规则之外"，而是"规则写在注释里、只实现在了一半代码上"**。⇒ 这条的可迁移教训：**只在注释里的纪律，保质期等于下一个没读那段注释的人**。要做成门禁形态（§8 第 3 步那条断言）而不是再写一遍注释 |

---

## 7. 未闭合（写清楚差什么，不含糊）

**扫描线状态（20:10 更新）**：三条重派**已全部收齐并折入本文** —— `/tmp/heyta-perf-scan/1-sync-kernel.md`（53,095 B）、`2-storage.md`（52,053 B）、`4-web-render.md`（19,278 B）。折入前先对三份跑了 §1.1 那条引用自检，读数是**「行号越界 0、存在但未入库 0」**（三份合计 347 条唯一引用）—— 这与 §5 第 1 条那趟整份编造的报告是不同的物种，可以按引用存在性入门。折入结果：**P0 +4（P0-8/9/10/11）、P1 +7、P0-1 更正一处、§5 撤回 1 条 + 否证 3 条**。
🔴 其中**一条被当场降级**（存储线的 P0-2 → 见 §5 第 4 条），另有一批子 Agent 的数字本文**没有采纳**（gzip 573,448、"500 条任务秒级卡顿"、"3 次 stringify"），原因逐条写在对应条目里。

需要一手取证才能定级的：

1. **移动端 P0-3 / P1-4 / P1-5 的全部毫秒数** —— 需要真机 Hermes profiler。本文一律没写数字，因为写不出来。
2. **P0-4 的每批耗时** —— 需要真 PostgreSQL 上的 EXPLAIN 与计时（`server/tests/integration/` 有真库设施可借）。
3. **P0-5 的产物侧模块计数** —— 需要一份 `--dev false --minify false` 的可读 bundle。
4. **P1-4 与 §4 的计数** —— ⚠️ 待复核，本文标了。
5. 🔴 **本条五个子项：四个已复核完（5-a/5-b/5-c/5-d），一个需要新载体（5-e）**。本条**不算闭合** —— §7 台账自检把它记在未闭合里是对的，因为 5-e 还差夹具。原句是：「**子 Agent 报过、我没复核的一批**：`i18n` 的 `t()` 实现、`domain/preference-resolver` 是否每次从 op-log 全量重算（注意 [ADR-0014](../adr/0014-memory-switch-and-corrections.md) **有意**规定"推断结果不持久化、每次重算"，所以频率才是问题、不是形状）、`ai-tool-selection` 每输入是否全工具遍历、`export-dump` 的内存峰值。」逐子项处置：

   - **5-a `i18n` 的 `t()` —— ✅ 已复核，子 Agent 的怀疑不成立。** 本体是 `packages/i18n/src/catalog.ts:44` `translateIn()`（入口 `translate()` 在 `packages/i18n/src/translate.ts:26`，只做一次 `CATALOGS[locale]` 查表再转调）：**O(1) 字典取串**，只有传了 `vars` 才多一次 `template.replace(PLACEHOLDER, …)`。**没有**每次重建表、**没有**扫描。🔵 顺带排掉一个经典坑：`PLACEHOLDER` 是模块级 `/g` 正则，但走的是 `String.replace` —— `replace` 会把 `lastIndex` 归零，所以不存在 `.test()` + `/g` 那种跨调用状态泄漏（这条**不是**问题）。⇒ i18n 真正的代价从来不在 `t()`，在**两份表都进 bundle**（那是 P0-9 的 781,062 B）。
   - **5-b `domain/preference-resolver` —— 🔴 这个名字是我写错的：全仓没有这个文件。** 现量：`find packages apps server -name '*preference-resolver*' -not -path '*/node_modules/*'` 输出 **0 行**；`packages/domain/src/` 下真实存在的前缀同族文件是 `preferences.ts`、`preference-evidence.ts`、`preference-hints.ts`、`preference-corrections.ts` —— **里面没有 `preference-resolver.ts`**。真符号是 **`inferPreferences`**（`packages/domain/src/preferences.ts:726`）。⚠️ **这正是本文 §1.1 第三把尺子点名的那类错 —— 我自己在本文里犯了一次**：点名一个不存在的载体，和点名一个不存在的函数是同一件事。之所以没被尺子 1 抓到：**"文件不存在"这一维它只检查带行号的 `file:line` 引用，而这里写的是包名+驼峰词（`domain/preference-resolver`），不成形状。** ⇒ 尺子 1 应当加一维"把正文里的 `xxx/yyy-zzz` 式路径词也拿去 `test -e`"，这条登记在 §8 **第 17 步**。
   - **5-c 频率问题（原句里"所以频率才是问题"那句）—— ✅ 复核完，而且比"频率"更糟：它关着也在付。** ⇒ 已单独成条 **P1-18**（`apps/web/src/App.tsx:629-640` 的四处 `Object.values` 实参在隐私闸门**之前**求值，而 `store.entities` 每条 op 换身份 ⇒ 依赖数组 `:658` 每条 op 失效一次；默认 `memoryEnabled: false` 在 `aiStore.ts:118`）。**本条是本批唯一从"待复核"里长出来的新 P1**，P1 计数因此 17 → 18。
   - **5-d `ai-tool-selection` 每输入全工具遍历 —— ✅ 形状属实，等级判掉：不是热路径。** `resolveToolSelection`（`packages/app-host/src/ai-tool-selection.ts:167`）确实 `for (const rule of rules)` × `findCatalogTool()`，而后者是 `LOCAL_API_TOOLS.find(...)` 的线性扫（`:220-221`）⇒ **O(R×K)**。现量：**R=4 条规则**、**K=6 个工具**（`packages/local-api/src/tools.ts:94-145`，逐个点名 `list_tasks/get_task/list_projects/create_task/update_task/complete_task`；计数带两条阳性对照，第一版正则不认这个元素的缩进形状、报出过 K=0，所以这个 6 是重数过的）。⇒ 最坏 **24 次字符串比较 + 4 个正则**，**每次 AI 输入一次**（两个生产调用点：`packages/app-host/src/ai-tool-call.ts:209`、`apps/web/src/features/ai/AiToolRun.tsx:168`）。同一次请求紧接着要么走一次模型往返、要么被规则直接本机跑完 —— **24 次比较在这个分母上是噪声**。⚠️ 注意 K 是**分分支**的：倒数纪念日那条线给目录加了 4 条 `EVENT` 工具，但**这条工作树的 `tools.ts` 是干净的、K=6**；不要把 22 之类的数搬进来当系数。
   - **5-e `export-dump` 的内存峰值 —— ⚠️ 未闭合，需要新载体（本文造不出来）。** 要量的是"一次导出的峰值堆内存"，载体必须是**一份有真实 op 数的库 + 一次真导出**：node-host（真 SQLite 文件）跑 `export-dump` 并用 `--max-old-space-size` 逼出峰值 + `process.memoryUsage().heapUsed` 采样点。这件事和 P0-8 的微基准同批做最省（同一个夹具）。**没做，所以这里不写任何数字** —— 只登记"它和 P0-8 共用一次夹具"这个降成本的事实。
6. **一条要产品侧知道的顺序约束**：P1-9 ⇒ 给 web 接自动同步之前，必须先有在途保护与 memo/selector，否则会把一次写入放大成 3 次全列表重建 × 无互斥重入。
7. **两个应当变成常驻门禁、但目前只活在 `/tmp` 的探针**（本轮没把它们收进 `scripts/`，因为那属于源码改动、超出"只读审计 + 落文档"的边界）：
   - **引用完整性自检 = 尺子 1**（`/tmp/heyta-perf-scan/cite-audit5r.cjs`。⚠️ 这里原来写的是 `cite-audit4.mjs`，而那份与 v5 都已随 `/tmp` 消失 —— **点名一个已不存在的载体，和点名一个不存在的函数是同一件事**）—— 任何带 `file:line` 的调研文档都能扫；它抓到 4 处歧义引用与 3 组落在未入库文件上的引用，但 **22:03 之后它不再是收益最高的一把**，见 §1.1「第二把尺子」与本节第 16 条。
   - **checkpoint 写成本基线**（§8 第 4 步的 `measure-checkpoint.mjs`）。
   要闭合：把它们写进 `scripts/` 并挂进 `pnpm check`，每条都要按 AGENTS.md §8 第 3 条做一次"注入违规会红"的反证。
8. 🔴 **本文的行号有近半落在"活文件"上，开工前必须按符号重新定位 —— 这一条已从"风险"变成"实测发生过"。** 22:32 普查（命令见 §1.1「第三把尺子」）：**被引 62 个文件形状里 29 个正在被动**（` M` 26 + `??` 3）。其中 §1.1 那 3 条未入库引用所在的日历文件（W6 的落点 `packages/ui/src/calendar/*`）是风险最高的一类 —— **在干净检出上它们不存在**；而 `apps/mobile/src/App.tsx`、`server/src/sync/sync.routes.ts` 两处**在本文写作的一小时内就各漂了 3 行**（118→121、163→166），是同一天内两把尺子都报绿的引用。⇒ §8 任何一步开工前**不许照本文行号直接改**，要用 §1.1 抽查块那种 `grep -n "<符号>" <文件>` 的形状重定位；要判断"这个引用还活着吗"，跑 §1.1 那块普查命令，不要跑尺子 1/2（它们的盲区正是这件事）。
   🔴 **00:2x 复量：这个比例本身在 60 分钟内从 47% 掉到 4%。** 同一条普查命令现在给出：**被引 72 个（我新增了 10 个）· 正在被动 3 个（`M ` 1 + ` M` 2）· `??` 0**（三个是 `packages/app-host/src/host.ts`、`server/src/sync/services/operation-upload.service.ts`、`server/src/sync/sync.service.ts`）。⇒ 两件事同时成立，别读成一件好事：**①** "近半在动"是**那一刻的状态**，不是本文的永久属性 —— 拿它当"本文件特别危险"的证据是错的；**② 危险度一点没降**：那些文件变成"干净"的原因不是"没人改了"，而是**改动进了 HEAD**，而 HEAD 一变，本文所有以工作树为准的行号就同时集体过期（P1-14 就是当场例子：`state.ts` 现在干净，但它的内容与我 22:5x 读的那份已经不是同一份）。📌 所以这条纪律的正确形式是**"每次开工前按符号重量一遍"，而不是"脏的时候才重量"** —— 干净不等于没变。
9. **新折入的四条 P0 只有形状与阶是实测的，毫秒全未实测。** 要闭合各自的载体不同，不能笼统说"等 profiler"：
   - **P0-8（整桶复制）** —— 一次 Node 微基准就能定级（不需要真机）：固定 op 数只变桶内实体数，看 `dispatch` 中位耗时。子 Agent 报的读数是「200 实体 0.043 ms → 4000 实体 0.992 ms；固定 N 只变 T 时重放 6.9 → 217 ms」，**我没有复现它**，所以本文只写阶、不写这些数。它的基准脚本在 `/tmp/heyta-perf-scan/`。
   - **P0-9（首屏 1.94 MB）** —— 一次构建 + 一份可读的 chunk 归因（`rollup-plugin-visualizer` 或 `--minify false`）就能把"哪个包占多少"钉死。字节数已实测，缺的是**归因**。
   - **P0-10（O(N³)）** 与 **P0-11（Argon2id 首批）** —— 需要真机：前者要列表渲染的 profile，后者要**首次同步**那一刻的峰值内存与耗时。⚠️ P0-11 的取证还有个特殊点：**它只在会话首批付**，所以要冷启动测，不能拿"第二次同步很快"当反证。
10. 🟡 **P1-14 这条"闭合"只维持了 40 分钟 —— 记成"半闭合"，别当已结。** 22:5x 我按当时的 HEAD 逐条取证，得到「HEAD 里没有 per-field 版本前沿 ⇒ 放大倍数 = 1」，并据此把标题里那句"嵌在 O(k²) 循环里"判成不成立。**00:2x 重量：那条依据的载体本身换了**（`git rev-parse --short HEAD` 现为 `d27bccde`，00:10 一笔提交）：同一组命令现在给出 `selectVersion` **3**、`FIELD_VERSIONS` **6**、`shouldAcceptWrite` **0**、文件 **599** 行。⇒ **原句那半句"确实嵌在 per-field 循环里"现在是对的，我用来推翻它的整个前提没了。** 真正站得住的是另一半、也是更有用的那一半：`addUnique` 只留极大元 ⇒ **平方项随并发度不随编辑史长度**（`checkpoint-recovery.spec.ts` 用 601 条单调 op 直接断了 `toHaveLength(1)`，该夹具现也已入库）。逐条读数、两个 SHA 与"为什么会误判"都在 **P1-14 节正文**。🔴 **这条留下的缺口**：一个以 `git show HEAD:` 为证据的断言**必须写锚定的 SHA 并配一条"当前 HEAD 是否等于锚"的复现命令**，否则它会在下一次合流时静默变成假话 —— 本条自己就缺这个锚，登记在 §8 **第 17 步**。教训与 §5.2 同族：**"嵌套未读通"的正确出路是去读，而不是先把 O(k²) 写进标题；而读通之后的结论如果锚在一次 `git show` 上，它和标题一样会过期。**
11. ✅ **P1-16 已闭合，第三遍找到了，但它不是"第三遍"而是"某一档宿主的第三遍"**（同样不需要新载体）：原句是「≥2 遍 stringify+hash 是读到的，第三遍（落盘那次序列化）未逐行确认，所以本文不写"3 次写 + 2 次读"」。现量结论：**web（IndexedDB）2 遍、SQLite 档（node-host / 移动端）3 遍**，第③遍是 `packages/storage/src/sqlite/sqlite-adapter.ts:698`（`put:` `:501` → `insertRow` `:511`），且**这一遍是三条证据里唯一已入库的**。⚠️ 这半句在 10-04 00:5x 过期：HEAD 走到 `f6478fad` 之后三遍**全部**已入库（现量：`git cat-file -e HEAD:packages/storage/src/checkpoint.ts` 通过、`git show HEAD:packages/storage/src/sqlite/sqlite-adapter.ts | grep -n 'JSON.stringify(record)'` → **698**、`git show HEAD:packages/op-log/src/engine.ts | grep -c checkpointChecksum` → **2**）。📌 原文留着是因为它记的是 23:5x 那一刻的状态 —— 那一时刻它是真的；**"已入库"和 §7 第 10 条讲的"未入库"一样，是一个时刻的快照而不是属性**，所以这类句子必须带 SHA 或时间，否则下一次合流就变成假话（这条缺口登记在 §8 **第 17 步**）。三个适配器逐个穷举：`indexeddb-adapter.ts` 里 `JSON.stringify` 命中 **0**（结构化克隆），`memory-adapter.ts` 只有 `:90 JSON.stringify(key)` —— 哈希的是主键不是记录。⇒ 顺带**部分推翻 §7 开头那句"没有采纳子 Agent 的『3 次 stringify』"**：那个数在它自己的宿主上是对的，错的是把它写成一个不分档的标量。表格与 7 条复现命令见 **P1-16 节正文**（本趟逐条跑过，期望=实读）。
12. 🔴 **P1-13 查清了它为什么不算"ADR 没写完"**（本条已闭合，结论不是缺口）：[ADR-0047](../adr/0047-checkpointed-incremental-hydration.md) §4 写了 `archiveUpTo()` 的**语义与守卫**（"没有覆盖 cutoff 的有效 checkpoint 时拒绝归档"），§6 把"归档后的完整回退"列进了契约测试 —— 也就是说这份 ADR **假设有东西会调它**，但**没有登记触发者**。⇒ 这不是取证缺口，**是一条需要产品侧拍板的触发条件**（低频后台？启动时？仅在 checkpoint 落后 N 条时？），本文 §8 把它排在需要决策的那一步。
13. 🟡 **`docs-link-check`：本文这一格 10-04 00:4x 起**字面**达成 exit 0，但记成 🟡 不记成 ✅ —— durable 的那一半还不归本文。** 原始状态是 🔴「本文**没有**跑到 exit 0，而且这一步不该由本文凑绿 —— 必须写清，否则下一轮会误以为门禁绿」；下面整条按时间顺序保留了它曾经不绿的全部读数，**别只读第一句就当它一直绿**。🔴 **10-04 00:19 现量已把下面这整段变成历史**：现在跑是 **`EXIT=1`、只剩 2 处红，且都不在本文**（`grep -c performance-hotpaths-audit` 在这份输出上 = **0**）。那 31/45 处"本机存在但 git 未跟踪"的红项**已经自己消失了** —— 原因是并行会话在 23:58 前后把 `docs/adr/0046-0048`、`docs/plans/trash-and-archive*` 等目标**提交了**（`git log -1 -- apps/mobile/src/db/open-host.ts` 现量给出 `b3397cda 10-03 23:58`）。⇒ **本条原来那句"这一步不该由本文凑绿"以另一种方式兑现了：把它凑绿的人不是我，是把它写进库的人。** 现在这 2 处红的逐条归属：

    | 红项 | 位置 | 事实 | 为什么不代改 |
    |---|---|---|---|
    | 指向 `countdown-w7-device-export.md`（目录 `docs/plans/`）的第 2 节 | `docs/plans/countdown-anniversary.md:1091` | 该文件**本检出没有**（`ls docs/plans/ \| grep countdown` 只有 `countdown-anniversary.md` 与 `countdown-batch2-handoff.md`），而 AGENTS.md 明写 W7 跑在**独立 worktree `feat/countdown-w7`** 里 | 🔴 这**极可能是前向引用**（那份产物在另一个 worktree，合流时就到）。从本检出"修"它 —— 要么删掉一条正当的引用，要么改成一条此刻不存在的路径的另一种写法 —— 两种都是替别人决定意图 |
    | `docs/adr/README.md` 里的第 1 节章节号不存在 | `docs/plans/countdown-anniversary.md:1295` | 目标文件**在**（`ls` 有），缺的是里面没有那个节号 | 那是别人已提交的台账；正确修法取决于那份 README 该有第 1 节、还是那条引用该指别的节 —— 一次跨两个所有者的判断，不归本批 |

    两条都在**倒数纪念日那条线**的文件里（该文件本趟 `git status` 干净 ⇒ 已提交）。⇒ 本条对 ⑥ 的诚实结论从"结构不可达，因为 45 处未跟踪"**改写成**"结构不可达，因为 2 处**跨条目的意图判断**"；本文自己是 **0 红**。要闭合 ⑥ 只需要：那条线自己修掉两处（或 `docs/adr/README.md` 补出 §1）。**没有一条出路需要本文改自己的链接。**

🔴 **10-04 00:5x 复量：那 2 处原封不动，但门禁又多了 4 处新的 —— 而且新的这 4 处来自第三条线。** 现量（`node research/tools/docs-link-check.mjs` ⇒ `EXIT=1`）：**失效的章节引用 2 处**（还是 `countdown-anniversary.md` 的 1091 与 1295 两行，逐行对得上 00:19 那份归属表 —— 第 1091 行指的那个文件在本检出依然不存在，第 1295 行指的那节依然没有）+ **本机有、仓库里没有 4 处**（新增，全在 `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md` 的 94/95/96/99 行，指向 `apps/web/evidence/vault-panel/` 里四张 `pg-*.png`）。那 4 张的归属现量：`git ls-files apps/web/evidence/vault-panel | wc -l` = **7**（已跟踪）而 `git ls-files -o --exclude-standard` 同目录 = **14**（未跟踪）⇒ 那条线的产物目录**一半在库外**，而且 ADR 本体自己是**已跟踪**的（`git ls-files docs/adr/0050-….md` = 1），所以这不是"整条线还没入库"，是"文件写进去了、图没写进去"。
⇒ **本文贡献仍然是 0**（`grep -c performance-hotpaths` 在这份输出上 = **0**），但**⑥ 的闭合条件从"一处跨条目判断"变成"两处、分属两条线"**：倒数纪念日那 2 处 + 密钥迁移那条线的 4 张图。本文一条都不代改的理由和上面那张表一样，而且对那 4 张图多一条：**截图可能带用户数据，"该不该入库"必须由那条线判断**（AGENTS.md 只说 evidence 目录要入库，没替任何人决定哪张图能进）。📌 这一格又一次证明本条开头那句话：**红项集合是活树瞬时读数，不是提交的属性** —— 它在 00:19 与 00:5x 之间换了来源，而没有任何人动过门禁。

✅ **10-04 00:4x 复跑：门禁绿了 —— `EXIT=0`，连跑三次都是 0，而本文一行链接都没改。** 这正是本条最后那句预测在两小时内兑现：那 6 处红被**各自的所有者**关掉了，归属逐条现量（**别把这条读成"本批做完了 ⑥"，它读出来的是"⑥ 由别人在飞的工作满足的"**）：

| 谁关的 | 怎么关的 | 现量取证 |
|---|---|---|
| 密钥迁移那条线 | 把 `apps/web/evidence/vault-panel/` 里被引用的 PNG **`git add` 进了索引**（5 个暂存路径，含被点名的 4 张） | `git diff --cached --name-only \| grep vault-panel \| wc -l` = **5**，同目录 `git ls-files -o` 从 14 降到 **9** |
| 倒数纪念日那条线 | 把那两行**改写成不可被解析的形状**：1091 行从"`file.md` + 节号"改成"…`file.md` 第二节"；1295 行从指一个不存在的节号改成指 `../adr/README.md` 的一个真锚点 | `git status --porcelain -- docs/plans/countdown-anniversary.md` = **` M`（未暂存）**；那两行在工作树里已改写、在 HEAD 里还是旧形状 |

🔴 **但这枚绿是"只在混合工作树成立的绿"** —— 与本条前面讲的第三种红灯正好是一枚硬币的两面，而且可以不打 worktree 就证伪：
```bash
git ls-tree HEAD apps/web/evidence/vault-panel/ --name-only | wc -l                          # 7 ⇒ 那 4 张不在 HEAD 里，只是被暂存了
git cat-file -e HEAD:apps/web/evidence/vault-panel/pg-legacy-new-device.png 2>&1 | head -1   # "exists on disk, but not in 'HEAD'"
git show HEAD:docs/plans/countdown-anniversary.md | sed -n '1091p'                           # 旧的"路径紧跟节号"形状还在
```
⇒ **在 `f6478fad` 的干净检出上这道门禁仍然是 6 处红**；它只有在①那 5 个暂存路径被真的 commit、②倒计时那两行的改写被 commit 之后才 durable。⚠️ 所以本条对 ⑥ 的结论要分两格写，不许合并：**"收尾命令现量 exit 0"= 达成**；**"仓库在 CI 形态下绿"= 未达成，且不归本批改**（本批不 commit、不 push，也绝不替别人把那 5 个暂存路径一起提交 —— 那 5 张图里可能带界面截图，"能不能进库"是那条线的判断）。

    ⚠️ **本表第一版自己造了 2 处新红（00:2x 实测：门禁从 2 处变 4 处，其中两处来源就是这张表）。** 机制：门禁把**行内代码**里的"路径 + 节号"也当一次真引用解析，所以"如实转述一条死链"= 新增一条死链。✅ 修法不是少写，是**打断邻接**：把节号写成"第 2 节"而不是紧跟在路径后面的 `§2`；改完重跑 = 2 处红、本文贡献 **0** 处（现量命令：`node research/tools/docs-link-check.mjs | grep -c performance-hotpaths` ⇒ 0）。📌 与 §5.1 那条"抄门禁原文进被扫描的台账=造新违规"同族 —— 这条是它的**转述版**：**任何会被机器解析的形状（路径、节号、前缀），在描述它的时候都必须先破坏自己的可解析性。**

    ⚠️ 下面 20:18–22:2x 的四趟读数与那份 9 文件清单**原样保留**，因为它们记录的是"红项曾长什么样"这个事实，而且它现在是**否证性证据**：同一道门禁在四小时内从 31 处红变成 2 处，中间没有任何人动过门禁 —— 这一句本身就是"门禁红不等于你的代码红"这条纪律的最好例证。


    ```
    docs/adr/0046-lossless-vector-clock-frontiers.md          docs/plans/trash-and-archive.md
    docs/adr/0047-checkpointed-incremental-hydration.md       docs/plans/trash-and-archive-execution-brief.md
    docs/adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md
    docs/research/trash-and-archive-best-practice.md          docs/plans/calendar-year-time-and-mobile-profile.md
    docs/research/aed-implementation-evidence.md              apps/web/evidence/calendar-day/README.md
    ```

    现量命令（两条就够，别只看红项数）：

    ```bash
    node research/tools/docs-link-check.mjs > /tmp/lc.txt 2>&1; echo "EXIT=$?"     # 10-03 写这句时 EXIT=1；10-04 00:4x 起现量 0（见上面那格）。⚠️ 别把它改成 `|| true` —— 那会把一条会红的命令变成不会红的
    grep -oE '解析到 [^，]+' /tmp/lc.txt | sed 's/解析到 //' | sort -u              # 红项涉及的目标
    git status --porcelain docs/adr/0008-vector-clock-limit.md                       # 报"引用了 0046"的那个文件正被人 M 着改
    git show HEAD:docs/adr/0008-vector-clock-limit.md | grep -c '0046'; echo "rc=$?" # 0 ⇒ HEAD 态根本没有这条引用
    ```
    ⚠️ **最后一条会打印 `rc=1`，那不是命令坏了**：`grep -c` 在**零命中**时打印 `0` 并以 **1** 退出 —— 这里要读的正是那个 `0`。（同族：`git grep -nE "\.archiveUpTo\(|limitVectorClockSize\(" … | grep -v …` 命中 0 时同样 rc=1，见 P1-13 的复现命令。）**这类判据只认打印值，不认退出码。** 21:53 整块复跑实测：目标 15 个、`0008` 是 ` M`、HEAD 侧命中 **0** 而工作树命中 **1** ⇒ "只在混合工作树成立"这句仍然成立。

    🔴 **判定：这是"只在混合工作树成立"的第三种红灯**（#178 同族但不是同一件事）—— 回收站/归档那条线正在写 ADR-0046/0047/0048 与三份 trash-and-archive，日历线在写 `calendar-year-time`，它们都还没进索引。三条出路我一条都不走，理由逐条写清：① `git add` 那些目标 = **替别人提交在飞工作**；② 把引用改成纯文字 = 让本文失去对 [ADR-0047](../adr/0047-checkpointed-incremental-hydration.md) 的可点链接（P0-2 与 P1-13 全都挂在那份 ADR 上），**这才是真正的"为门禁绿放宽判据"**；③ 登记进 `UNTRACKED_LINK_OK` = 改 `research/tools/` 源码（超出只读边界），且等于把别人的在飞状态伪装成"刻意只活在本机"。
    ⚠️ **一条随之而来的跨会话依赖**：本文 §2/§6/§7 多处引用 `ADR-0047` 与 `trash-and-archive-best-practice.md`，**它们目前只在磁盘上**。本文的链接正确性以"那批文件会随其所有者入库"为前提 —— 交付时要点名这一格，别让它变成"看起来引用了不存在的 ADR"。
    ✅ **什么时候这条会自己变绿**：那些目标全部被各自所有者 `git add` 之后，无需本文做任何改动。目标数是一条**活读数**（20:18 是 9 个、21:47 现量 15 个、**22:22 复量仍是 15 个**，但红行从 44 处涨到 **45 处**，来源文件 13 个）。⚠️ **单位**：15 是**按文件名 basename 去重**，按链接原文去重是 **24** 个字符串 —— 差在同一个文件被写成 `../adr/0047-….md` 与 `adr/0047-….md` 两种相对形状。**报数必须带单位**，否则 15 与 24 看起来像两次互相否证的读数，所以这里不给"几个"只给判据（可直接跑）：`git ls-files 'docs/adr/004[6-8]*.md' | wc -l` 应为 **3**（**22:23 实测仍为 0**；`docs/adr/` 下有 **6 个**未跟踪 ADR：0046/0047/0048/0049/0050/0051。现量命令 `git ls-files -o --exclude-standard docs/adr | wc -l`）。

   🔴 **同时给出"本文自己那部分有没有死链"的证据**（不然下一轮会误以为这些红项里有本文的锅）：本文全部链接目标（20:18 是 4 个、21:53 现量 6 个、**22:23 复跑仍 6 个 · 磁盘缺 0**）**在磁盘上 100% 存在**，**真死链 0**。⇒ 本文之所以出现在红项列表里，只是因为**有人引用了它**（`docs/README.md` 的索引行）以及**它引用了别人尚未入库的 ADR**，两种都不是链接写错。复现：

   ```bash
   node -e 'const fs=require("fs"),path=require("path");const p="docs/research/performance-hotpaths-audit.md";
   const t=fs.readFileSync(p,"utf8"),dir=path.dirname(p);
   const u=[...new Set([...t.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map(m=>m[1]).filter(x=>!/^https?:/.test(x)))];
   const miss=u.filter(x=>!fs.existsSync(path.resolve(dir,x)));
   console.log("链接 "+u.length+" · 磁盘缺 "+miss.length+(miss.length?": "+miss.join():""));'   # 20:18 现量：链接 4 · 磁盘缺 0；21:47 复跑：链接 6 · 磁盘缺 0
   ```

   🔴 **21:47 复跑：这一格的读数全部被别人的并行工作推进了，本文一条没变。** 同一趟实测：
   - "本机有、仓库里没有"从 **33 处 → 44 处**；涉及目标从 **9 个 → 15 个**（新增 `adr/0050`、`adr/0051`、`plans/calendar-profile-handoff`、`plans/calendar-profile-reflection`、`research/e2ee-key-lifecycle-threat-model`、`research/op-log-e1-semantic-spec`）。
   - **出现了第二类红**，以前没有：「**失效的章节引用**」—— 链接是活的、指向的那个**章节号不存在**。21:47 那趟报 **1 处**，属倒数纪念日那条线（`docs/plans/countdown-anniversary.md` 第 1280 行去引 `docs/adr/README.md` 的第 1 节）。
     🔴 **21:49 复跑变成 2 处，第二条是本文自己造的**：我为了描述上面那条红，把它的形状**原样照抄**进了本行（一个"路径 + 空格 + 章节号"的写法），检查器就把它当成一条真引用抓了出来。
     ✅ 处置与 §1.1 表里那条"举例身份"、§5.2-c 那次自我指涉**完全同一族**：**改写引文**（现在写成"第 1 节"而不是那个可被解析的形状），**不给判据加豁免**。
     🔴 **21:51 用同一把尺子复量，那条红消失了**：`发现 1 处**失效的章节引用**`（回到只有倒计时那条）、本文作为源的行数 **8 → 8**、其中"本机存在但未跟踪"类 **8 / 8**（⇒ 本文仍然没有一行坏链）。这一趟同时是**这条判据能失败的实证** —— 它先因为我的一句描述变红、再因为我改写描述变回 1，说明它真的在看正文，而不是一开始就注定报倒计时那条。
     🔴 **22:26 再复量：这一类从 1 处变回 2 处，两条都不是本文。** 新增的那条是 `docs/plans/trash-and-archive.md` 第 928 行去引 `docs/adr/README.md` 的第 1 节 —— 与倒计时那条同一形状、来自回收站/归档那条线。同时「本机有、仓库里没有」= **45 处 / 本文仍 8 行**、跨文档章节引用总数 **476 → 477**（本文新加的 §7 第 16 条自己贡献一次，属"本文在长"那一族）。⇒ **本文对这一格的贡献仍然是 0**，而且这一格从 21:51 起就在**只随别人的文档变**：下一次看到它不是 1，先数哪几条是别人的。
     📌 这一格的可迁移结论比它本身值得记：**一份"记录别人的红"的文档，自己就成了红的来源** —— 凡是把判据的输出形状抄进正文，都要假设它会被同一把尺子再量一遍。
   - 本文自身：链接目标 **6 个、真死链 0**；`link-check` 输出里本文出现 8 行（21:47 趟），**逐行读过，8 行全是"本机存在但 git 未跟踪"这一类，且目标只有两个**（`adr/0047` ×6、`research/trash-and-archive-best-practice.md` ×2），**没有一行是本文的链接坏了**。
   📌 这条更新的价值在于形状：**门禁红的项数是一条活读数，它随别人的提交进度单调变动**，所以任何"红 N 项"写进文档都必须带时间戳与归属，否则下一轮会把它当成"这批遗留下来的"。⇒ `LINK_CHECK_EXIT` 仍为 **1**，本文第 ⑥ 项仍未达成，闭合判据不变（`git ls-files 'docs/adr/004[6-8]*.md' | wc -l` 应为 3，外加那 6 个新目标各自入库）。

✅ **10-04 00:4x：这一格给出的两条闭合判据都已满足，而且门禁当场变绿。** 现量（就是上面那两条命令，原样复跑）：`git ls-files 'docs/adr/004[6-8]*.md' | wc -l` = **3**（22:23 那趟是 0）、`git ls-files -o --exclude-standard docs/adr | wc -l` = **0**（当时是 6）⇒ **回收站/归档那条线把它的 6 份 ADR 全部入库了**；同一趟 `node research/tools/docs-link-check.mjs` 的 `EXIT` = **0**（连跑三次都是 0）。⇒ 这一格从 20:18 起挂着的那条"⑥ 未达成"**字面闭合**，而闭合方式正是本条从第一天就写下的那一种：**不是本文改自己的链接，是目标被各自所有者入库**。⚠️ 但 durable 的那一半换了新判据、还没满足 —— 见上一格那张表（那 5 个 `vault-panel` PNG 只在**索引**里、倒计时那两行的改写只在**工作树**里，`f6478fad` 的干净检出上这 6 处红会原样复现）。所以本条记 🟡 不记 ✅。

14. 🔴 **三条扫描线共 46 项的逐条处置账**（不写这条，下一轮就会把这 46 项读成"本批漏做"）。
    现量（20:47 重取，不凭记忆）：`1-sync-kernel.md` 53,095 B / **19 项**（P0 2 · P1 7 · P2 10）；`2-storage.md` 56,415 B / **14 项**（P0 2 · P1 6 · P2 6）；`4-web-render.md` 32,286 B / **13 项**（P0 3 · P1 6 · P2 4）。合计 **46**。
    处置合计：**折入/吸收 22 · 当场否证 2 · 未折 22**（22 + 2 + 22 = 46）。

    ⚠️ 这三份是**本趟产物、放在 `/tmp` 下**。🔴 **它们已经消失了**：20:47 与 21:1x 两趟都还在（逐条 grep 过标题、量过字节数），21:41 现量 `ls -la /tmp/heyta-perf-scan/` 只剩本回合自己写的两个文件（目录 mtime 21:40）。**删除者未查明** —— 我唯一能证的是"不是本回合删的"，而这条线里"归因给并发/环境前先低负载复跑"是既有纪律，所以这里只写时间窗，不写成因。
    后果要说清楚：**下面的"报告行号"列现在不可再复现**，它只对本趟有效；**唯一还能用的是"落点符号"列** —— 它指向仓库里的函数名，任何时候都能 `git grep` 重新取证。⇒ 未折项若要在下一轮继续，**从符号重新走一遍**，不要去追报告。
    ```bash
    for f in /tmp/heyta-perf-scan/1-sync-kernel.md /tmp/heyta-perf-scan/2-storage.md /tmp/heyta-perf-scan/4-web-render.md; do
      if [ -f "$f" ]; then printf "%s  %s B  条目 %s\n" "$f" "$(wc -c <$f|tr -d ' ')" "$(grep -cE '^### ' $f)"; else echo "$f  已不在"; fi
    done
    # 21:41 现量：三行全部打印「已不在」⇒ 这份处置账现在是这 46 项的唯一记录
    ```

    **A. 已折入/吸收（22 项）**：内核线 8 → P0-8、P0-11、P1-14、P1-13（`trimClock` 与 `archiveUpTo` 两项并进同一条并升级为 P1）、P1-15、P1-16、P0-1、以及 §5.2-d 的口径教训（"一大批原语无生产调用点"那条方法论）；存储线 5 → P1-12（`archive` 那条**由 P0 降级**进这里）、P1-11、P1-10、P1-12 的下推条件表（`iterate` 那条本回合复核后折入）、P1-16；Web 线 9 → P0-9（首屏两条：单文件 + Worker 后置）、P0-10、P1-17、P0-1（"整店订阅少列 5 处"）、P1-5、P0-6（`HabitsView` + `CategoryBreakdown`）、§1 实测计数（零虚拟化）。

    **B. 当场否证（2 项，原句在 §5，不要重报）**：① 存储线「桌面壳每次启动全表读进页侧内存」—— `apps/web/src/lib/oplog.ts:310` 的守卫早退，且 `:317` 读的是 legacy OPFS source，不是壳的 target；② Web 线「搜索 memo 在浮层关着时仍全库扫」—— `apps/web/src/App.tsx:1128` 空查询早退。

    **C. 未折（22 项），按"为什么不折"分四组**：

    **C-1 未复核（19 项）**：形状有、但我**没读函数体**。按 Goal ② 的"未复核一律不得进 P0"，它们不进正文。每条的闭合动作是同一件事：读那个函数 + 跑一条 `git grep` 定调用点。

| # | 报告 | 报告行号 | 落点符号（仓库里可重新 grep） | 该条主张 |
|---|---|---|---|---|
| 1 | 1 | `:156` | `legacyFieldVersions` | 每条 op 深拷贝整个字段版本表 |
| 2 | 1 | `:184` | `recoverLocked` | 无有效 checkpoint 时日志扫两遍，第二遍每 op 再合并（复制）一次全量时钟 |
| 3 | 1 | `:238` | `observeRemoteClock` | 每条远程 op 合并一次全量聚合时钟，per-op 循环里两次对象展开 |
| 4 | 1 | `:298` | `getOpById` | 为取一条 op 读全量日志再 `.find()` |
| 5 | 1 | `:319` | `maybeCheckpoint` | 每次写 checkpoint 前先读一次 `pendingApply` 全表 |
| 6 | 1 | `:362` | `failed.find(f => ops.some(…))` | 解不开的那批 op 判定最坏 O(页长²)，每轮同步重付 |
| 7 | 1 | `:389` | `resolveConflicts` | per-conflict 循环里一次串行 DB 读；500 条被拒 = 500 次串行往返 |
| 8 | 1 | `:424` | checkpoint 被"半路失败的远程批次"冻结 | 🔴 未折项里这条**优先级最高**：一次失败批次冻结整个会话的 checkpoint，此后每次冷启动全量重放尾部 —— **正确性 × 性能双关** |
| 9 | 1 | `:567` | AES-GCM `importKey` / 随机 IV | 逐 op 调用，密钥字节没有持久成 `CryptoKey` |
| 10 | 1 | `:598` | 移动端纯 JS Argon2id | 每次启动付一次；包内已备好的两个出口没人接（与 P0-11 同族但**不是同一条路径**） |
| 11 | 2 | `:269` | 上传/应用状态落库：逐条 3 语句 + 整行重写 | **本地侧** N+1（与本文服务端 P0-4 同形状、不同侧，别混成一条） |
| 12 | 2 | `:404` | 批内去重的那次 `ARCHIVE` 索引查 | 每条 op 一次索引查 + 全行解析 |
| 13 | 2 | `:431` | `clearFullStateOpsExcept` | 单个写事务里全表扫 `ops` + `archive` 并逐行删除 |
| 14 | 2 | `:468` | prepared statement 复用缺失 | 两个驱动都不复用，适配器还每次重新拼 SQL 字符串 |
| 15 | 2 | `:500` | 原生宿主边界 | 每条 SQL 一次参数序列化 + 一次行反序列化，**外加**每行 payload 被 `JSON.parse` 第二次 |
| 16 | 2 | `:585` | Worker / 宿主桥 | 整个结果集原样过边界，没有投影 |
| 17 | 2 | `:613` | `appendBatch` | 每条 op 付 3 条额外语句来自增计数器 |
| 18 | 2 | `:735` | 壳为空时**再开一个**存储 Worker | 整条旧 OPFS 日志跨两条边界各搬一遍 |
| 19 | 4 | `:193` | `apps/web/src/App.tsx:608-695` 记忆层 | 每个 op 重读事件流 + 重算全量推断。ADR-0014 的"派生不持久化"是**有意的**，但它没登记这个代价 |

    **C-2 报告自己标注"不在产品热路径"，按自述不折（1 项）**：`1-sync-kernel.md` 的 `compression.ts` base64 路径 —— 它的标题里就写着「**当前不在产品热路径**」。要复活它，先得证明有调用者。

    **C-3 判定与性能无因果，不折（1 项）**：`4-web-render.md` 的「`eslint-disable` 三处逐条判定」—— 那是那份报告用来证明"我不靠注释下结论"的**自我约束证据**，不是一条性能发现。

    **C-4 是既有条目的限定，不是独立发现（1 项）**：「SW 不缓存应用资源 ⇒ 二屏也不省那 1.94 MB」—— 它是 **P0-9 的一个限定**。⚠️ 我**未复核**它（要读 `apps/web/src/pwa/*` 的缓存策略 + 一次真浏览器二屏加载时序），所以 P0-9 正文没有写"二屏也一样"。
    🔴 闭合它的载体与 P0-9 已登记的那条**可以合并成同一趟**：一次真浏览器 network 时序，同时回答「worker/wasm 那 1,303,216 B 是否在首次绘制的关键路径上」与「二屏加载是否仍付 1.94 MB」。

15. 🔴 **本条线掉出的可迁移教训要入 [环境陷阱](../reference/environment-traps.md)，但台账一直被并行会话写 —— 按 Goal ④：不 append，只把正文与取号备齐。**
    **现量跑过两次，两次结论都是"不能写"，而第二次的现量顺手把我预留的号占掉了** —— 这正是"编号按工作树取、不按 HEAD"这条纪律的用途：
    | 取号时刻 | 最大号 | 行数 | 最后写入 | worktree / index / HEAD | 空位 |
    |---|---|---|---|---|---|
    | 21:15 | `187.` | 4,670 | 20:46:27 | 341,644 / 325,716 / 325,716 | #188 |
    | 21:53 | `188.` | 4,681 | 21:21:16 | 342,623 / 325,716 / 325,716 | **#189** |
    | **22:28** | **`189.`** | **4,695** | **22:20:05** | **344,129 / 325,716 / 325,716** | 🔴 **#190** |
    ⇒ **#188 已被"原生提醒 C 续验"那条线占用**（内容是"用当前状态是否匹配在 reducer 里丢弃提醒回执会破坏乱序收敛"，契约 ADR-0051）；**预留的 #189 也在 22:20 被同一条线用掉了**（`189.` 现文是「取消通知的负向断言需要仍然活动的正向对照，启动命令也需要读回」）。⇒ **同一趟工作里被抢两次**，而两次之间我一次都没写过这个台账。同一批工作还往 AGENTS.md §8 加了第 12、13 条）。⇒ 本条待入项**从 #188 改号为 #189**，写入守卫同步改成 `maxBefore !== 188 → 不写盘`。
    📌 这一格本身就是要登记的教训的**实证**：**预留号是一种会过期的资源**。文档里写"下一条空位是 #N"必须同时写清取号时刻与复取命令，否则下一轮拿着旧号 append 就是撞车。
    现量（现取，别引用上表）：
    ```bash
    T=docs/reference/environment-traps.md
    grep -oE '^[0-9]+\. ' $T | tail -1     # 22:28 实测 189.（下一条空位 = #190）
    wc -l < $T                             # 22:28 实测 4,695
    stat -f %Sm $T                          # 22:28 实测 Oct  3 22:20:05
    printf "worktree %s | index %s | HEAD %s\n" "$(wc -c <$T|tr -d ' ')" "$(git show :$T|wc -c|tr -d ' ')" "$(git show HEAD:$T|wc -c|tr -d ' ')"
    # 22:28 实测 → worktree 344129 | index 325716 | HEAD 325716（索引 == HEAD ⇒ 谁都没暂存）
    ```
    **为什么不 append**（22:28 第三次判，理由比前两趟更硬）：`stat` 的写入时刻距取号只有 **8 分钟**（前两趟分别距写入 **29** 与 **32** 分钟 —— 三趟都不满足"没人正在改"），且 #187/#188/#189 三条**全部**来自提醒那条线、其中 #187 自己写着「修复及真机复验**仍在进行**」⇒ 所有者正在活跃地写这本台账。共享工作树里往一个正被写的文件尾部插行，被对方整文件 `git add` 抹回去的事故我这条线已经吃过一次，所以宁可留登记。

    **待入 #190 的正文（已写好；号在两小时里被抢过两次：#188 → #189 → 现预留 #190。落到空位即可直接用，但**动笔前必须重新取号**）**：
    > 🔴 **「零调用点」和「零命中」是两个不同的断言。**（2026-10-03，性能热路径审计；入口：[performance-hotpaths-audit.md](../research/performance-hotpaths-audit.md) §5.2-d 与 P1-13）
    > 症状：一条写着「`archiveUpTo` / `limitVectorClockSize` 命中只在 `dist` 与 tests」的现量，换 `git grep` 复跑后在 src 侧各命中 **3** 与 **5** 处。**结论（调用点为 0）没变，但证据全错，而且错的方向是让这条发现显得比实际轻** —— 真相不是"没有归档/裁剪功能"，是"通道全部铺好、开关从没人按"。
    > 三个叠加成因：① `grep -rn … packages apps server` 会遍历 `node_modules`：同一条 `encryptBatch` 查询在 `grep -rn`（排 dist）下 43 行、`git grep`（排 dist）下 68 行，**两个都不是答案**；② 我把"排除 dist 之后没看到 src 命中"当成了"src 没有命中"，实际是被我的目录参数范围漏掉；③ 最本质的一条：数"有没有人用某函数"时，**import / re-export / 接口声明 / worker 转发 / 注释里的提及一律不构成调用点**，判据必须是带括号的调用形状（`fn(` / `.fn(`）。
    > 规则：这类断言一律 `git grep`（只扫跟踪文件、口径可控），并**逐枚给命中归类**；写"零调用点"就要同时写出声明/实现/转发分别在哪。
    > 同族附赠一条：`packages/storage/src/sqlite/sqlite-adapter.ts:739` 与 `:745` 的 `limit` 下推是**有条件**的（`pushDown = 主键单列 && range 存在`；而 `iterate` 路径在 `:598`/`:601` 根本不把 limit 传下去，`:605` 在 JS 里截断，`DEFAULT_ITERATE_LIMIT = 10_000` 限的是**访问次数**不是**取回行数**）⇒ "limit 会下推"与"limit 不下推"两句**各对一半入口**。结论前先问"哪个函数"。
    > **闭合这条 append 的判据**（三条同时成立才动笔，**22:28 第三次按现量重定号**）：`grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tail -1` 仍为 `189.`；`stat -f %Sm` 距现在 > 30 分钟；**最大号那三条**（现为 #187、#188、#189）都不再写着"仍在进行"。写入必须带 `maxBefore !== 189 → 不写盘` 守卫（这个守卫形状在 #185/#186 那次实测有效）。⚠️ **本条已经证明"预留号"这个概念在这本台账上不成立**：21:15 预留 #188 → 21:21 被占；21:53 预留 #189 → 22:20 被占。**同一趟工作、两小时、两次** ⇒ 正确的读法是"到 append 那一步再取号"，而不是"这次取到的号能用多久"。
> ⚠️ 这三条是**时刻性**判据，不是资格：动笔前重新跑一遍，别引用本节任何数字。

16. 🔴 **本文那两把引用尺子只住在 `/tmp`，所以它们不是门禁。闭合成"仓库里一条会红的检查"缺的不是算力，是一次授权。**
    - **本节第 7 条早就登记过这件事的雏形**，当时点名的载体是 `cite-audit4.mjs`（已消失）、判据只有四格。第 7 条与本条**不是两笔债**：第 7 条回答「该不该收进 `scripts/`」（答：该，但超出本次边界），本条补「收进去时要满足哪两条硬要求」。
    - **现状**：尺子 1（越界 / 歧义 / 未入库 / 非路径四格）与尺子 2（行内容 + 标识符邻近两步，见 §1.1）各是一个一次性脚本。`/tmp` 这条路本轮**坏过两次**：21:4x 那趟的 v5 探针连同三条扫描线报告一起消失（§7 第 14 条记了时间窗），22:14 的两个读数同样只有"这台机器 + 这段时间"能复现。
    - **落成什么**：`research/tools/cite-self-check.mjs`（与既有的 `license-inventory.mjs`、`docs-link-check.mjs` 同目录同形态），并挂进 `pnpm check`。**要授权的两点**：① 本次 Goal 的边界明写"只改文档、不新增源码"；② 共享工作树里新增未跟踪文件会被别人的整文件 `git add` 一起带走（本项目已实测过"我 plumbing 提进台账的段落被并行会话整文件 add 抹回去"这个形状）。
    - **落地时的两条硬要求**（否则它就是一个永远绿的装饰，AGENTS.md §8 第 3 条）：
      a) **必须带阳性对照** —— 先注入一条已知错的引用（随便把一个行号 +1），确认尺子 2 报红，再改回来；
      b) **默认窗口 = ±0**（标识符必须在被引那一行），把 ±10 降级成可选宽松档。理由就是本节刚付过的学费：**±10 放过了"差 8 行"的 `HabitBoard.tsx` 637 行**，而"引用函数体内某行、用函数名做归属"这种合法写法应该由文档改写成函数定义行（`state.ts:498` 而不是 `:545`），不靠尺子放宽。
    - 在落成之前，本文 Goal ② 那条"每个 `file:line` 都能用一条命令证实符号存在"**目前的真实达成方式是"人工 adjudicate + 一次性脚本"** —— 别把它读成"仓库里有条自动检查在守这件事"。
    - ✅ **10-04 00:4x 本条部分转正，但转正的不是尺子**：四臂变异装置已经从 `/tmp` 落进仓库（`research/tools/audit-self-check-mutation.mjs`，未跟踪、未提交、未挂 `pnpm check`）。它落进来的直接收益是**下一轮不必重造装置**，而它落进来时当场付的学费写进 §5.2 h：**旧装置的期望是写死数字的，台账一变它就两臂 FAIL**（一臂响亮、一臂靠 `a1 === orig` 那个守卫才没装成"四臂全对"）。⚠️ 尺子 1 与尺子 2 **仍然只住在 `/tmp`**，本条的主张没有变。


---

## 8. 一条一条的落地顺序（本文只排顺序，不在这份 research 里下结论）

按"改动面小 → 判据先立"排。**每条的判据都要先立成会红的，再改代码**——AGENTS.md §8 第 3 条。

| 序 | 动作 | 为什么这个位置 |
|---|---|---|
| 1 | 修 **P1-8** 那个恒 0 的 `state:'settled'` | 一行，正确性 bug，且是全仓唯一**现在就在对用户说假话**的界面读数 |
| 2 | 修 **P1-1** 的 `pause()` 加 `stopTicking()` | 一行，移动端已有正确参照 |
| 3 | 🔴 **P0-11**：`packages/sync-client/src/client.ts:912` 的 `Promise.all` 换串行，或改走已有 `encryptBatch` | 新折入条目里位置最高的一条：**一处调用形状改动、密文结果不变**（所以零行为风险），且**同一个包的解密侧已经这样改过并写了理由**（`encryption.ts:263-269`）⇒ 不是新决策，是补齐漏掉的另一半。判据：断言一次 upload 期间 `deriveKeyFromPassword` 调用数 = 1 |
| 4 | 🔴 **P0-9 的第一刀**：i18n 让 zh 与 en 两份表**不落到同一个 chunk** | 不需要"要不要懒加载"这种产品决定就能拿掉 **781,062 B**（入口的 40%）。判据可机械写：产物里"两种语言的词条表同时出现"= 红 |
| 5 | **P0-6** 的 web 侧：`GrowthView.tsx:290-299` 五个选择器收进 `useMemo` | 一个文件、四处包裹，且**移动端 `GrowthScreen.tsx:173/194/198/211` 就是现成写法**；先止住"每分钟白算一轮"，再谈 `habit-streak` 的算法 |
| 6 | 🔴 **P1-10**：给 `OpLogStore` 加计数/存在性方法，三个消费者改过去 | 加一个方法、删三处全表物化（待上传条数 / 队列非空 / 迁移守卫）。它是**根因型**改动，做在前面能让第 7、11 步的判据更容易写 |
| 7 | 加 `scripts/measure-checkpoint.mjs` 常驻门禁（**先让它红**） | P0-2 与它的新系数 P1-16 都是 O(N²) 族，今天**完全无观测**，没有基线就没法改 |
| 8 | 🔴 **P0-10**：`validateParentChange` 改成接受**预建索引**（`byId`/`parentOf` 由调用方传） | 改动局限在 `packages/domain/src/subtasks.ts` + `SubtaskPicker.tsx` 两个文件，却把列表从 O(N³) 拉回 O(N)。⚠️ 前置：`canSetParent` 是环防护的**唯一实现**（注释明写"土办法会漏掉后代这一整类"），所以必须有一条"改前改后候选集逐任务相等"的等价判据 |
| 9 | `TaskRow` 加 `React.memo` + `listSections`/三个回调收进 `useMemo`/`useCallback` + `useMobileSync` 加 selector | P0-1 的三个乘数，一次改完收益最大；也是 **P1-3 / P1-9 的前置**。🔴 清单以 §P0-1 现量为准：**18 处无参整店订阅 / 11 个文件**，不是"9 个面" —— 按旧数开会漏掉 `CalendarHeaderToolbar.tsx` 与 `TaskOrganizer.tsx` |
| 10 | **P0-7** 提醒改成一次 `Object.values` + 按 `taskId` 归组 | 单函数改动，但 ⚠️ **前置**：先读 [回收站与归档调研](trash-and-archive-best-practice.md) 的 D1 —— `aliveOfTask` 里那道"任务活着"的滤会被挪位置 |
| 11 | 给 `Screen` 一个跑长列表的 `scroll={false}` 形态，让 `TaskList` 拿到确定高度；**web 侧另立一步**（`@tanstack/react-virtual` 从未被声明） | P0-1 的虚拟化那一半。⚠️ 移动端是"有 FlatList 被外层击穿"，web 是"根本没有虚拟化" ⇒ **两端的修法不同，别当成一步** |
| 12 | `DatePicker` 的 `weeks` 收进 `useMemo([month])` | P1-2，改动局限在一个文件 |
| 13 | `check-mobile-bundle` 加体积与模块两条判据 | P0-5；先有判据再动图标方案 |
| 14 | **P0-6** 的算法侧：`habit-streak` 改成按记录数走 | 放在门禁之后 —— 它改的是**用户能看到的连续天数**，需要一条"改前改后连续天数逐习惯相等"的等价判据垫底 |
| 15 | 🔴 **P0-8**：物化层换数据结构（持久化字典树 / 浅结构共享），别再整桶展开 | 全表**最后**做，不是因为不重要，而是它**威胁两条既有不变量**：reducer 的纯性是 checkpoint 确定性 checksum 的前提（P0-2 那套），而就地 mutate 会让 ADR-0047 的回退判定失效。必须先有第 7 步的基线与"state 序列化字节序列改前改后相等"的等价判据 |
| 16 | 上传批次按形状上界数发数 | P0-4，服务端属不可逆层，必须先有观测再动 |
| 17 | 🔴 **本条线自己掉出的两条门禁缺口**（不是代码改动，是"下一轮别再付同样的学费"）：**a)** 凡以 `git show HEAD:` 为证据的断言，必须**同时写出锚定的那个 SHA**，并配一条比对当前 HEAD 与锚的复现命令；**b)** 尺子 1 要加"路径词存在性"一维 —— 把句中出现的路径 token 逐个 `test -e` | **a)** 是 P1-14 / P1-16 与 §7 第 10、11 条这一轮**当场过期两次**的形状：`git show HEAD:` 的读数在下一次合流之后就变成假话，而它打印出来的样子和真话完全一样（本文 23:5x 与 00:2x 两趟读数的差异就是它）。**b)** 来自 §7 第 5-b 条 —— 我点名过一个全仓根本不存在的 `domain/preference-resolver`：尺子 1 只把"路径 + 行号"这种形状当引用解析，**纯路径词根本不进检查**，所以那是一条盲区而不是漏检。⚠️ 两条都要授权才能落成自动检查（新增 `research/tools/` 或 `scripts/` 里的检查并挂进 `pnpm check`），本次 Goal 的边界只允许改文档 —— 所以本文只做**登记**，不声称有东西在守 |

📌 **第 3、4、6 三步是收齐三条扫描线之后才排进来的**，它们的共同点是"改动面小 + 零产品决策 + 有现成参照"。原来那张表里没有它们，是因为当时只复核到渲染侧与取数侧。

⚠️ **本文不主张任何一条已经"决定要改"**——research 层给证据，改与不改、以及优先级，走 `docs/plans/` 与 ADR。
