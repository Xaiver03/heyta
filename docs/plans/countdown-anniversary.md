# 倒数纪念日（含农历、节日、纪念卡片）实施计划

> 状态：🔄 **批次一已落地**（2026-10-03，`a29881e9` 已合进 main）：W1 历法层 / W3「每年」预设 / W4 节假日随包数据 + bundle 体积闸门，落地记录与本批欠账见 **§3.5**。
> 🔴 **批次二进行中**（~~全部在本地分支，未 push 未 merge~~ 🔴 **04 04:2x 现量把括号里这句就地作废，并且它和"别人的在飞状态"是同一种病**：`origin/main`（tip `95ac4662`）里**已经有** `b05fbc50`（W4b 客户端半）、`67fef701`（W4b 判据①的界面）、`3b143953`（W7 成品图的 web 半）—— 核验命令 `git merge-base --is-ancestor <sha> origin/main; echo $?` 三笔全回 `0`。本分支独有的只剩 **8 笔**（W6 `e2def90f`、两套 e2e 载体、W7 设备出图装置、这一批文档读数），main 领先本分支 **228 笔**（别的条线）。⇒ "分支状态"这类句子一样有保质期，引用时必须带**在哪测的**与**测于何时**）：W0 / W2 / W5 / W10 已闭合，W9 落了 web 半，**原生投递那一半 20:1x 现量确认由另一条会话在主检出实现中（未提交，见 W9 节末）** —— 我 19:3x 那条"确认停批"只有四十分钟寿命；**L' 的判定表已出、命中那条已修，剩下的前置闸门已立成常驻门禁 `check:legal-permissions`（13 臂变异 13/13，见 §8.2 L' 第 1 条）**，~~W4b / W7 / W8 在并行工区里跑，**唯一一条完全没开工的是 W6**（撞车面的实测读数见 §8.2 开头；它的载体已确认与 W4b 的 `dayMarker` 是同一条缝）~~ **04 04:3x 这一整截也过期了**：W4b / W7 / W8 三个工区的成果已**全部合进本分支**（`509a06cd` / `43e94b32` / `f2d09974`，`git merge-base --is-ancestor` 对 `origin/main` **三笔全回 `0`**），W6 已于 04 02:5x 落地（`e2def90f`，四个档位 + 侧栏都认得 `EVENT`）—— 当初"唯一没开工的那条"恰恰是**唯一一条被现量否证了排后理由**的（撞车判据是同一文件的未提交 diff，不是"日历线在忙"的印象，见 §8.2 开头）。逐项读数在 **§8.2 / §8.4**，本节这行原先写"⏸ 批次二未开工"，那是一句比正文更早写下、落地后没 sweep 的话 —— 同一份文档里这种"状态行跑在正文后面"的漂移已经出现过一次（见下面第 4 行那条 ADR 的教训）。⚠️ **这行本身现在又多了一条同族样本，而且形状不同**：19:3x 那次的状态行**不是**写早了，是**写对了再过期** —— 并行会话在半小时内把"停批"变成了"在实现"。⇒ 只要一条读数描述的是别人的在飞状态，它就必须在被引用时**重取**，不能被引用为"已确认"。
> 决策：[ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)（实体 / 农历依赖 / 数据分发 / 图片双档四则）
> 证据基础：[`countdown-anniversary-data-and-images.md`](../research/countdown-anniversary-data-and-images.md)（2026-10-02 调研，本文只引用它的结论，不重复取证）
> 决策：✅ 已立 = [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)（2026-10-03 接受；本行原先写"🔴 待立 ADR"，那是同一份文档里比正文更早写下的一句，落地后忘了 sweep —— 按 `docs/README.md` §一，调研给证据、ADR 下结论、计划管落地）。本文不代替 ADR。

---

## 0. 解决什么 / 明确不解决什么

**解决**：用户能建一条"倒数纪念日"——它有名字、有一个可农历的日期、可每年重复、可提前提醒、可钉住、可归档，并以卡片形式出现在自己的网格里，还能作为第二个数据源出现在日历与今天。

**不解决**（都登记在 §5，不要在这里顺手做）：

- ❌ 素材图片背景（要走端到端加密的对象存储通道 → 归 P2-9；**档位已定＝双档**，ADR-0044 §2.6）
- ⏳ 法定节假日**调休/补班**：**做**，但走 W4b 的运营录入通道，且它**不是倒数纪念日的前提**（卡片与农历生日不依赖它）
- ❌ 世界其他国家节日（`date-holidays` 的数据许可未过门）
- ❌ 移动端/桌面壳的提醒投递（停批项，见 §5）
- ❌ 共享/协作倒数日（E2EE 下"只与自己的过去比"的同族约束）

---

## 1. 四条决策（**已定**，2026-10-03）

🔴 **本表不复制理由，只给指针** —— 裁决与论证的唯一真源是 [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)；这份计划只负责它怎么落地。（同一件事在两份文档里各写一遍，是"抄件一定会漂"的标准形状。）

| # | 决策 | 落点 |
|---|---|---|
| **D1** | 新增 `EVENT` 实体，不复用 `TASK` | ADR-0044 §2.1 → 工单 **W2** |
| **D2** | 农历生日**归一化到同名正月**（逢闰过正），闰月那年可选再过一次 | ADR-0044 §2.5 → 工单 **W3** |
| **D3** | 农历走 `lunar-typescript`（MIT，2026-08 仍提交），**体积实测是前置闸门** | ADR-0044 §2.3 → 工单 **W1** |
| **D4** | 素材图片**双档**：默认客户端加密，自托管可显式开明文，我们的实例永不启用 | ADR-0044 §2.6 → 工单 **L1–L5** + §6 |

### 1.1 拍板前的选项空间（历史记录，裁决以 ADR-0044 为准）

| # | 要拍什么 | 选项 | 我的倾向与理由 |
|---|---|---|---|
| **D1** | 建不建新实体 | (a) 新 `EVENT` 实体 (b) 复用 `TASK` + payload marker | **(a)**。倒数日**不是待办**：它不能被"勾选完成"，混进 TASK 会污染今日视图与四象限的计数（那些是 TASK 的派生）。先例是 `REMINDER`/`NOTE` —— 独立实体、可加性变更、不 bump `CURRENT_SCHEMA_VERSION`。**代价见 §2.1 的部署顺序硬约束** |
| **D2** | 闰月生日怎么过 | 过第一个 / 过最后一个 / 两年过一次 / 让用户选 | **让用户选，默认"过第一个"**。这是产品语义不是技术债（调研 §6.4 标为未证实）。⚠️ 定错会"用户明确设置的日期每年差一个月"，且**已落库的数据改不动**（§3.3 的教训） |
| **D3** | 农历走依赖还是自研 | (a) `lunar-typescript`（MIT，2026-08 仍在提交）(b) 自研月表 | **先 (a)，但 W1 的第一件事是实测 bundle 体积**（调研 §6.1 未证实）。它是"全量黄历+八字"大集合，我们只用农历换算；体积不可接受就退到 (b) |
| **D4** | 素材图片走哪一档 | (a) 只加密档 (b) 加密 + 部署方可显式开明文（**双档**）(c) 明文 + 单独同意 | **(b)**。调研 §4.5 已用 Apple ADP 与 Ente 证伪"要图片就得服务端能读"；(c) 要补一份我们现在**根本不存在**的文件（PIA，调研 §4.6 第 3 条），且会把表 E 六行的结构性依据换掉。**注意 (b) 与 (a) 的差只是"要不要给自托管者一个逃生门"**，实现量相同 ⇒ 真正的分歧只在默认值与隐私政策表述 |

---

## 2. 已定的裁决（写下来是为了不让实现阶段重新发明）

### 2.1 部署顺序是硬的：服务端先于客户端

`packages/shared-schema/src/entity-types.ts` 文件头写明**服务端会拒绝未知实体类型**。所以 `EVENT` 必须**先上服务端、再上客户端**，反过来老服务端会把新客户端的写入整条拒掉——而按 §7 第 34/41 条的历史，一条被硬拒的 op 曾经让设备**永久同步不了**。

⚠️ 自托管部署者会天然落后于我们的服务端 ⇒ 这条要落成一条**可判的兼容性检查**（W2 的判据之一），不能只写在文档里。

### 2.2 节假日数据不进 op-log、不进用户库、不加密

它是公共事实，不是用户数据（调研 §3 的三条架构事实）。走 op-log 会让每次同步都带上它，并把它伪装成用户写入，违反 AGENTS §3.4。

### 2.3 成品图与素材图是两件事

**导出纪念卡片 = 在用户设备上渲染出的成品图**，零上传、零新通道、零法务变更。
**背景照片 = 素材图**，需要客户端加密后才能出设备（调研 §4，依据是我们自己表 E 的结构性理由）。
⇒ 卡片功能**不等**图片通道。

### 2.4 pin 与"排在最前"必须是同一个字段

先例与理由都在 `packages/domain/src/notes.ts` 的文件头："'钉到今天'就等于置顶是同一个字段，不是两套排序规则。做成两个字段必然在一次编辑里漂移。"
排序纪律照抄 `sortNotesForDisplay` 的三段（钉选 → 时间 → **id 字典序兜底**）；少了第三段，同一毫秒更新的两条在两端会换位置。

### 2.5 归档 ≠ 删除，且归档态是新的一态

回收站的既有纪律：彻底删除打 `purgedAt` **标记**而**不清 `deletedAt`**，因为清了会让离线对端把已删数据**复活**。归档同理——它必须是一个独立标记字段，不能靠"改 `deletedAt` 再改回来"实现。

### 2.6 App 不替用户决定含义

内置图标（旅行/演唱会/发工资…）**给图标、不给含义**，与"颜色由用户自己赋义、App 永不判断某个活动健康／不健康"同构。滴答那套预置分类里"信用卡还款/保险缴费"隐含了价值判断，不抄。

### 2.7 不出现判负表达

"已经 N 天"只与自己的过去比（红线）。逾期**不飘红**、不弹"你忘了"、不出现"错过/剩余不足"。倒数日有两副面孔（还有 N 天 / 已经 N 天），后者对"戒烟/离职"类语义天然带审判感 ⇒ 措辞与配色是红线级约束，不是文案细节。

### 2.8 图片必须客户端加密后才出设备（默认档）

依据不是"隐私优先于功能"，而是调研 §4.5 的实测：**Apple 高级数据保护把照片纳入端到端加密，用户侧功能一项没少，放弃的全是运营方能力**（服务端索引/搜图/网页端直读/代客恢复），Ente 是整站在架先例。⇒ "要图片"与"服务端能读图片"是两件事，这里没有取舍。

三条代价要如实接受，不许略过：① **忘记密码 = 素材图不可恢复**（除非已有恢复联系人/恢复密钥那套）；② **服务端不能生成缩略图** ⇒ 客户端生成；③ **校验和与时间戳仍泄露元数据** ⇒ 政策写"我们留什么"，不写"我们什么都看不到"。

明文档（D4 的 (b) 里那个逃生门）**只能由部署方显式开启**，我们的托管实例永不启用。

---

## 3. 工单分解

> 每单一个提交。🔴 **W0 与 W1 可并行，W2 之前必须先拍 D1/D2。**

### W0 · 把锚点弹层提到共享层（前置，且不只服务本功能）

`apps/web/src/features/shell/AccountMenu.tsx` 里那套 `fixed` + 实测锚点 + 哪边空间大往哪边弹（2026-09-30 为"面板被 rail 裁掉 16px"建的，带 e2e 注入验证）今天**只在 web**。全仓 `onContextMenu`/`onLongPress` **零命中** ⇒ 没有任何实体有二级操作面。

- 做：弹层定位逻辑上提到 `packages/ui`，`AccountMenu` 改为消费者。
- 判据：注入验证复用既有的那条（把面板改回 `absolute` ⇒ "面板右边必须可见"转红）。
- 🔴 **不做**：不在这一单里发明倒数日的菜单内容。

### W1 · 历法层（A 类）

- 先量：`lunar-typescript` 进 bundle 的字节数（D3）。
- 做：农历↔公历换算 + 闰月 + 节气，落在 `packages/domain`（纯函数，照 `date.ts` 的形状）。
- 🔴 **判据（本轮最有价值的一条，两个独立来源互相反证）**：**用农历算法算出的"正月初一/八月十五/五月初五"，必须落在 `holiday-cn` 对应年份公告给出的该节日放假日期集合内**，逐年对账，不一致即红。这条不需要我们懂农历就能自检。
  - ⚠️ 阈值待实测：近年公告的春节假期常从**除夕**起算，所以断言形状是"∈ 集合"而不是"== 首日"。
- 变异验证：把月表里某年的一格改错 ⇒ 该年对账红。

### W2 · 实体与写入（依赖 D1）

- 做：`EVENT` 进 `ENTITY_TYPES` + `EntityModelMap` + 服务端校验白名单；`packages/app-host/src/event-actions.ts` 构造 op（**每个手势一个 op**，AGENTS §3.4）。
- 🔴 新字段一律可选 + 运行时默认（AGENTS §3.3：给持久化模型加必填字段会在 hydration 时炸，TS 只保护新数据、构建会绿、**炸在运行时**）。
- 判据：①老数据（无 `EVENT` 的库）回放不炸；②§2.1 的部署顺序——**老服务端 + 新客户端**这条组合必须**响亮失败**而不是静默丢数据；③op payload 里**不得出现节假日数据**（钉住 §2.2，变异 = 塞一年数据进去 ⇒ 红）。

### W3 · 每年重复与"下一次"计算

`Recurrence.yearly()` 已存在但 **UI 没有"每年"这一档**（`packages/app-host/src/repeat-presets.ts` 的 `RepeatPresetId` 只有 daily/weekly/weekdays/monthly）。

- 做：加 `'yearly'` 预设 + 农历锚点的 next-occurrence（含 D2 的闰月规则）。
- ⚠️ 预设 id 是数据、文字是展示（那个文件头自己写的）⇒ 新 id 一旦发布不可改名。
- 判据：农历生日跨年推进正确；**现有 `verify:mobile-repeat` 全程只测 WEEKLY** ⇒ 本单必须补 yearly 的真机/真服务端断言，否则这条路径零证据。

### W4 · 节假日数据集（B 类，(a) 随包内置）

- 做：年度 JSON 随包 + 生成物 + `--check` 门禁，照 `server/src/*.generated.ts` 那套先例。**保留 `papers` 的 gov.cn 原文链接**（可举证）。
- 判据：①门禁能因"生成物与源不一致"而红；②**年份降级**——数据只到 2026 时，2027 的界面必须"显示节、不显示休/班"，且断言它不空白、不报错；③`isOffDay: false`（补班）不得被当成节日显示。

### W4b · 调休/补班：运营录入通道（C 类，产品负责人 2026-10-02 指定）

管理后台加一类结构化数据：**公告原文链接 + 一份 `days[]` JSON**，落库前逐条校验；客户端**拉取 + 本地缓存**，自托管部署拿不到就安静降级。**不做成"管理员手打 365 天"。**

- 🔴 这是 heyta **第一条服务端→客户端的内容通道**（今天下行只有密文 op-log 与计费元数据）。ADR 必须给它定性：**公共事实由部署方下发，不违反 AGENTS §1"云端不是事实源"**——那句话约束的是用户数据。不写清这条，实现者会照字面卡住（调研 §3.1）。
- ⚠️ 必须**回写 [ADR-0038](../adr/0038-admin-console-scope.md) 的范围表**：后台从"用户/订阅/订单/优惠码/邀请"多出一类资源。不登记就是边界漂移。
- 判据：①缺数据时**不报错、不留空块**（自托管形态跑一次真界面）；②`papers` 链接随数据入库且能在后台回显（举证入口）；③校验层能因"日期非法 / `isOffDay` 不是布尔"而拒绝录入。

### W5 · 卡片网格与二级操作

- 做：网格 + 类型筛选（纪念日/倒数日/生日/节日，**不含"节假日"这一档**，见 §0）+ pin + `⋯` 菜单（编辑/样式/备注/归档/删除）+ 归档视图。
- 样式第一版**只有预置模板**（§2.3）。
- 判据：pin 变异 = 加第二个排序字段 ⇒ 红（钉 §2.4）；归档变异 = 归档实现成"改 `deletedAt`" ⇒ 红（钉 §2.5）。

### W6 · 第二个数据源

`CalendarBoard` 的事件源今天**只有** `task.dueDate`。本单把 `EVENT` 接成第二个源，并接进今天/收集箱。
判据：一条没有截止日的倒数日**能上日历**（这正是它区别于 TASK 的可观测证据）。

### W7 · 纪念卡片导出（成品图）

判据：**导出全程零网络请求**（Playwright 里数 request，按方法+路径比，别只看数量）。~~移动端渲染通道未取证 ⇒ 本单开工前先验~~ ✅ **已验，并在当前提交上取到读数**（04 13:20 链 U：`RC_ANDROID=0`、通过 11 项，成品图 `BYTES=34360 SHA=2ac31233b2ed` 人已看；iOS 那一半在链 X→Z 队列里） `react-native-svg` 能否出图，不能就把移动端登记为已知缺口而不是静默降级。

### W8 · 三端接线与门禁

i18n **中英同步**（唯一文案事实源，`check:ui-language` 拦）；`SHELL_MODULES` 注册（🔴 默认值本身是产品判断——倒数日是"额外玩法"还是"任务类"要拍，我倾向**默认关**）；移动端 `nav/TabBar.tsx` 硬编码 5 tab，**不共用** web 的开关表 ⇒ 这里会有一次真实的重复，先想清楚再写；钉 tab 顺序的 e2e 要同步更新。

### W9 · 提醒（后置）

`REMINDER` 的档位今天只到"提前 1 天"（`packages/domain/src/reminders.ts` 的 `REMINDER_OFFSET_PRESETS_MS`），任意 `offsetMs` 只有 API 路径。投递**只有 web 有**且证据只是 jsdom。⇒ 倒数日的"提前 3 天"必须等这条补齐，否则四个端里只有一个会响。

### W10 · EVENT 必须同时进 AI 工具目录（否则内置 AI 与 MCP 都够不着它）

新实体如果只进 UI，**AI 侧就是瞎的**：工具目录、授权判定、执行器在 `packages/app-host`（`ai-tool-selection.ts` 自然语言→工具、`ai-tool-run.ts` 读即执行/写只产出提案）与 `packages/local-api` 之间**共用一份**（ADR-0035，AGENTS §3.5 明写"不要另建一份"）。

- 做：读工具（列倒数日 / 取某条的下一次发生日）+ 写工具（产出**提案**）。
- 🔴 硬约束：AI **类型上产生不了 op**（ADR-0005「AI 是输入法不是业务规则」）⇒ 写路径只能到 `toWriteIntent` → 用户确认 → `submit`。**不得**为倒数日开第二条写入通道。
- 出境：任何"把生日/纪念内容发给云端模型"都受 ADR-0010 三道闸 + ADR-0013 的 `retention-undecided` 挡；本单**不开**托管档。
- 判据：①新实体的工具**逐工具默认关**（ADR-0011）；②加密条目**可列举、不可读**；③变异 = 让写工具直接构造 op ⇒ 红。
- 🔴 **这条没有门禁兜底，所以最容易整块漏掉。** 实测两道 AI 门禁的驱动源都不是实体清单：
  `scripts/check-ai-tools.mjs` 钉的是"确认之前一个 op 都不能落地"那五条不变量；
  `scripts/check-ai-coverage.mjs` **由 `AiFeature` 联合类型驱动**（"联合类型是规格，这条门禁是执行"）——
  加一个 `EVENT` 实体不会让任何一处变红。
  ⇒ 症状正是 `check-ai-coverage.mjs` 文件头写的那类失效（"能力实现了、单测全绿、**零个生产调用点**"，仓库里已出现 12 次以上）。
  **根治做法**：把工具目录改成由 `ENTITY_TYPES` 驱动，让"新实体没接 AI"变成一次红。这条要单独确认，不要默认它已经存在。
- ⏸ **排期决定（产品负责人 2026-10-03）**：**不在本批立这条门禁，后面再说。** 理由不是"不做"，是它一上就会让**现有 10 个实体里那些没接 AI 的当场全红**（`check:ai-coverage` 文件头自陈这类失效已出现 12 次以上）——那是真话，但不该由倒数日这一批来引爆。
  ⚠️ **所以 W2 落 `EVENT` 时，AI 侧不会有任何东西提醒我们**：这条必须靠人工核对（W2 的判据里显式列一项"EVENT 的工具是否已进目录"），并在批次二结束时把它当成**已知欠账**登记，而不是等门禁红。

---

## 3.5 批次一落地记录（2026-10-03，分支 `feat/countdown-anniversary`）

在隔离 worktree `heyta-wt-countdown` 里完成，主检出与并行会话未被触碰。

### 落了什么

| 工单 | 产物 | 判据与变异验证 |
|---|---|---|
| **W1 历法层** | `packages/domain/src/lunar.ts`（查表 + 算术，无天文算法）、`src/generated/lunar-year.generated.ts`、`solar-term.generated.ts`、生成器 `scripts/gen-calendar-tables.mjs`（含一份自带 Meeus 实现作反证） | 单测 65 条（含 1901-01-01 → 2100-12-31 全量往返）；**变异 19 例全部转红**（含"翻一格 bit""取消逢闰过正""取消月末 clamp""把负数闰月直接 `&0xf`""清空分歧豁免清单""公告别名写错一个字"） |
| **W3 每年重复** | `repeat-presets.ts` 新增 `'yearly'` 一档；农历锚点的逐年推进在 W1 的 `nextLunarOccurrence` | 判据断言的是**行为**（`occursOn` / `nextOccurrence`）而不是规则串；**变异 5 例全部转红**（月日参数写反、去掉 try/catch、错接成每月、改 2/29 口径、锚点改取"今天"） |
| **W4 节假日数据** | `scripts/vendor/holiday-cn/`（20 份公告 JSON + LICENSE + 唯一读取入口 `load.mjs`）、`scripts/gen-holiday-table.mjs`、`src/generated/holiday-cn.generated.ts`、查询层 `src/holidays.ts` | 单测逐日对账生成物 == 公告、`papers` 逐字等于源、补班不进节日集合、词表封闭；**变异 7 例全部转红**（删一条放假日、覆盖上界虚报成 2027、把补班混进放假、查询层读反、papers 少一年、跳过集合被清空） |
| **体积闸门（D3 的常驻版）** | `gen-calendar-tables.mjs --bundle` | import 扫描 / 依赖声明对账 / 随包数据体积比三条臂；**变异 7 例全部转红**（产品源码 import 库、副作用式 import、挪进 `dependencies`、根依赖里删掉、子包自己声明、往产物塞 200 KB、删产物） |

门禁接线：`pnpm check:calendar`（`--check` + `--bundle` + `--verify`）与 `pnpm check:holiday`（`--check`）已插入 `pnpm check` 链（在 `check:tokens` 之后）。
`pnpm -r build`、`pnpm -r typecheck`、domain / app-host / i18n / web 四包测试全绿。

🔴 **表里不写分母数字**（公告条数、扫描文件数、入口字节数）—— 那些由 `pnpm check:calendar` 每次现场打印；写进文档就是抄件，抄件一定会漂。变异例数是本次交付的稳定事实，所以只有它进表。

⚠️ **但"变异例数"也不许再加总**。收口时实测到两处自造的合计：`docs/README.md` 与 `docs/plans/README.md` 各写过"26 例"（那是 W1+W4 的中间数，写完 W3 与 bundle 闸门后就没更新），本会话对用户的口头汇报又说过"31 例"（把表里第三列误当两个数相加）。表里四行的 **19 / 5 / 7 / 7 是唯一一份账**，谁要合计自己加 —— 已从两处索引里撤掉总数，改为指针。

### 明确没做（逐条给理由，不是漏掉）

1. ~~**W3 的"真机/真服务端 yearly 断言"**（本工单原本要求补的那条）~~ ⇒ ✅ **2026-10-03 14:57:41 已跑绿**
   （`通过 50 项，失败 0 项`、`STEP C_RC=0`；过程账与逐趟红集在下面「固定收尾」一节第 13–15 条）。
   **下面这一整段留原位**，因为它记录的正是"这一条为什么拖到第四天才跑、以及哪些读数是判新旧的依据"，
   那些形状下次还会遇到 —— 但读的时候要带着"标题已经闭合"这个前提，别把它当成待办。
   脚本落点：`scripts/verify-mobile-repeat.sh` 的第 15 步（跨年那一档）+ 第 7 步的六个预设清单，但它**还没在设备上跑过**，所以这条不能记成"已交付"：
   - 写了什么：第 7 步的选项清单从五个补成六个（含「每年」）；第 15 步点「每年」→ 断言**恰好一条** op、规则 == `FREQ=YEARLY;BYMONTH=…;BYMONTHDAY=…`、锚点 == **手机当前截止日**、面板显示「当前：每年 …」，再同步到笔记本读同一条规则。
   - 🔴 期望值**从手机当前 `dueDate` 现场推**，不抄脚本开头的 `DUE_DATE`：`TaskDetailSheet` 的锚点是 `repeatAnchor = dueLocal ?? todayLocal`，而第 11/14 步已经把截止日顺延过两次 —— 拿旧日期算期望会把这条正确的实现判成红。"锚点跟着当前截止日走"本身也一起被钉住了。
   - 离线做到哪一步：`bash -n` 0；把 `dueDate` 的 ms 喂进脚本里那段 python，拼出的规则串与 `packages/domain/dist` 的 `Recurrence.yearly(10,17)` **逐字相同**。⚠️ 这只算半个验证 —— 它证明不了第六枚 chip 在真机上点得到（chips 是一行横排的）。
   - 为什么没跑：2026-10-03 02:05（本地）实测 **1 分钟负载 328–353**、107 个 node/java 级进程、并行会话正在连续提交；02:09 复量还是 **48–55**（5 分钟均值 117–125），九分钟内四次读数没有一次落到 18 以下。脚本默认的 `emulator-5554` 没起，唯一在线的 `emulator-5556` 与 :3000 / :3100 两个服务端都捏在别人手里。这一刻起四端重装会把别人**有时限**的设备判据压成超时假红（同一台机器上曾实测把 load 顶到 250–537）。
     ⚠️ **10:37–10:38 复量**：负载已降到 13–38，但**设备、两个端口、compose 栈三条仍在这个会话之外**（`verify-mobile-repeat.sh:241` 是 `pm clear`，跑它 = 清掉别人在那台共用 AVD 上的登录态）。四条最新读数与复跑命令写在下面「固定收尾」一节第 3 条，**以那一节为准**。
   - 下次跑之前必须按顺序做完（缺一条就是在验旧二进制）：`pnpm -r build` → `pnpm reinstall:mobile` → `HEYTA_E2E_SERIAL=<现取的在线机> PORT=<自己的端口> pnpm verify:mobile-repeat`；跑前重新现量四条现场判据：`pgrep -f 'verify-mobile-'`、`sysctl -n vm.loadavg`、`xcrun simctl list devices booted`、`adb devices -l`。
     🔴 **原来这一条写的是 `ps Axo command | grep -F 'verify-mobil[e]'`，那句话是坏的，两个方向都坏**（2026-10-03 11:20 用活的对照组量出来的）：
     `grep -F` 把 `[e]` 当**字面量**，所以它**匹配不到任何一次真运行**（真跑的脚本 argv 是 `bash scripts/verify-mobile-repeat.sh`，里面没有方括号）；
     而它唯一能匹配到的，是**执行这条检查的那个 shell 自己**（它的命令行里原样带着那串带括号的文本）——
     实测：起一个 argv 含 `verify-mobile-repeat-fixture` 的活进程 ⇒ 老探针报 **0**（漏），空机器上老探针报 **2**（把观察者数成在跑）。
     `pgrep -f 'verify-mobile-'` 两条都对得上（同一对照组里命中那个 pid、清理后回 0，且**不把观察者算进去**）。
     ✅ 这一条换掉之后，本节第 3 条那四条设备侧读数**不受影响**（它们是 `adb`/`lsof`/`docker ps` 的读数，本来就没用这条探针）。
     ⚠️ 另两条"下一次"要带的现场事实：**`verify-mobile-repeat.sh` 没有负载门**（全仓只有 `verify-mobile-restore.sh` 里有 `wait_for_quiet_host`，`grep -rln wait_for_quiet_host scripts/` 现量），
     所以负载**没人替你等**，要自己判；以及本机**只有一个 AVD**（`~/.android/avd` 里只有 `SSOS-Parity-A36`，它就是被占的 `emulator-5556`）⇒
     "换一台自己的模拟器"这条路要先 `avdmanager create avd`（系统镜像只有 `android-36`，在 `/opt/homebrew/share/android-commandlinetools`），不是再起一台现成的。
     ✅ **上面那半句"repeat 没有负载门"已过期**（同日 11:34，提交 `1d085a92`）：门抽成单一所有者
     `scripts/lib/wait-for-quiet-host.sh`，`verify-mobile-repeat.sh` 现在在 `heyta_e2e_ensure_account` **之前**判它
     （等不到 ⇒ `exit 3` = 环境无效，不是产品失败），`verify-mobile-restore.sh` 那份私有定义删掉了。
     现量：`grep -rln wait_for_quiet_host scripts/ | grep -v '\.snap\.'` ⇒ lib（定义）+ restore + repeat 三个文件。
     旋钮随之改名 `HEYTA_RESTORE_LOAD_WAIT` → `HEYTA_LOAD_GATE_WAIT`（`BLOCKED.md` 里那个旧名是历史读数，没动它）。
     🔴 **但下一次仍然要看设备那一半**：这次只消掉了"负载没人替你等"，**没有**消掉"本机只有一个 AVD、
     而跑第 15 步会 `pm clear` 掉别人在上面的登录态"；而且脚本等满 900s 是 `exit 3`，
     **别把 `exit 3` 记成产品红**。
     ⚠️ **这条的前半截已满足**（2026-10-03 10:02 / 10:05）：android 与 ios 由并行会话在隔离检出 `267ac912` 重装过，本会话又**按内容**复核过设备上那份包里确有本批的 `每年` / `FREQ=YEARLY`（读数见下面第 2 条）⇒ 下次跑第 15 步**不必先重装**，但"现取在线机 + 自己的端口"那两条照旧。
     🔴 **11:52 复量之后，上面这句"不必先重装"要收窄成两半，否则会被人当成"随便什么时候直接跑"**：
     - ✅ **对第 15 步这条判据仍然成立**：`267ac912..HEAD` 里能进移动包的只有 `packages/i18n` 两份词表
       （`git diff --name-only 267ac912..HEAD -- apps packages | grep -vE 'evidence/'` ⇒ 5 个文件，
       其中 mac / landing 各占其位），而那 11 行词条改动**碰到 `recurrence` / `repeat` / `每年` 的行数 = 0**
       （现量：`git diff 267ac912..HEAD -- packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/en.ts | grep -E '^[-+][^-+]' | grep -icE 'recurrence|repeat|每年|weekly'` ⇒ **0**）。
     - 🔴 **对"本轮交付的固定收尾"不成立**：§6.1.1 的判据是"装的是**当前**产物"，而词表变了 ⇒ 设备上那份
       已经不是当前产物（差的正是 729f4bd4 / 1e092733 / bf271a1e 那三笔公开文案）。所以拿它跑第 15 步可以，
       拿它当"这一轮收尾已跑绿"的证据不行 —— 要么先 `pnpm reinstall:mobile`，要么别写这一格。
     - 🔴 **另一条硬前置（新量出来的）**：主检出的
       `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` mtime 是 **10-03 03:21**，
       而 HEAD 里 **09:47 还有一笔动过 `apps/mobile` 的提交**（`c444d827`，且它是 `267ac912` 的祖先）⇒
       **这份盘上的 APK 不可能含它**（判据：`stat -f %Sm -t '%m-%d %H:%M' <apk>` 与
       `git log -1 --format='%h %ad' --date=format:'%m-%d %H:%M' -- apps/mobile`）。
       谁要从主检出重装，必须先 `pnpm -r build && pnpm build:android`，不能拿这份旧 APK 装上去验。
       ⚠️ 顺带记一条**别照抄的读数**：这份旧 APK 的 bundle 里 `每年`=1 / `FREQ=YEARLY`=1（UTF-16LE / ASCII 各按 §7 #171 的口径），
       看起来"含本批代码"——那是真的但**只到 03:21 为止**；`yearly` 枚数在这里是 3、在设备上那份是 5。
       **枚数差不能用来判新旧**（Hermes 按字符串内容选 latin1/UTF-16 存储，ASCII 与 CJK 计数不同形），
       判新旧只有 mtime↔提交时间这一条可靠。
2. **`'yearly'` 加了 id 但没人能测到"忘了加进 `REPEAT_PRESET_IDS`"** —— 这一档的表现是"界面上没有每年"，属于**按定义不可观测**，不为此扭曲设计；类型系统已能抓到"switch 少一档"与"标签少一档"（`Record<RepeatPresetId, MessageKey>` 是穷举的）。
3. **2/29 的"平年过 2 月最后一天"口径**：需要 `BYMONTHDAY=-1`，而域层 `describeRecurrence` 与移动端 `recurrence-display` 都会把它渲染成「每年 2 月 -1 日」。现状按 RFC + 主流日历实现（只在闰年重复），并**把这条边界钉在测试里**而不是留成暗坑。真正的产品问题在倒数日（"在一起多少天"那天算不算 2/29），随 W5 一起定。
4. **W4 判据②的界面半段**（"数据只到 2026 时 2027 显示节、不显示休/班"）：本批不做 UI，所以落的是**数据层**那半 —— 2027 有节无休、不抛错、非法日期响亮失败，都有单测与变异。界面上那条随 W5。
   🔴 **"随 W5"这句挂错了**（W5 收尾时现量否证，见 §8.2 W5 勾里那条 **W4-UI**）：倒数日卡片面不画休/班，
   而 `adjustmentOn` / `festivalsOn` 当时在全仓**零界面消费者** —— 改挂 W6 / W8。
5. **W0 / W2 / W5 / W6 / W7 / W8 / W9 / W10、W4b、L 系列**：按排期未开工。W2 未动 = `shared-schema`、服务端、迁移一个字节都没改（批次二的部署顺序风险留在那里处理）。

   ⚠️ **这句到 2026-10-03 晚已经过期**（留原文是为了看清它是"批次一收口时写的欠账清单"，不是现状）：
   W0 / W2 / W5 / W10 已闭合、W9 落了 web 半、W4b / W7 / W8 在并行工区里跑，
   **只有 W6 与 L 系列仍未开工**。现量读数一律看 §8.4 那张表，不要看这一条。

   🔴 **04 05:0x 二更：连这句更正本身又过期了**，而且这次过期在**第二天早上**——它写"只有 W6 与 L 系列仍未开工"时，
   W6 已经落地（`e2def90f`），L' 命中的那条也已经**并进 main**（取证：`git show origin/main:packages/legal/src/documents/ai-and-transfer.ts`
   里中英两张表都有 `list_events`/`get_event`/`create_event`/`update_event` 四行，第 305 行还有一条变更记录写明
   "第六节那张本机接口工具表加了四条倒数日工具"；本分支那份只到 `1.1`，main 那份已是 `1.2` ⇒ **是 main 走在前面，不是本批没做**）。
   而此刻踩响 `check:legal-permissions` 的那条红**也不属于 L'**：它指的是 `third-parties.ts` 推送 SDK 的英文否表行
   仍写「The mobile app requests no notification permission」，而 `AndroidManifest.xml` 已声明 `POST_NOTIFICATIONS`、
   `Info.plist` 已声明 `NSUserNotificationsUsageDescription` —— 那是 **W9 原生投递那条线**的对外条款联动。
   这条更正留在这里的意义只剩一个：**欠账清单类句子的保质期以"小时"计，凡是要引用的都必须现量重取**；
   而这份文档里唯一不会过期的入口是 §8.4 那张表，它每一格都带"在哪测的 + 测于何时"。

### 合入时必须做的事 —— 2026-10-03 上午收口结果（逐条带读数）

原条目**保留原文**，一是让后来者看清"合入前必须先做什么"这件事的形状，二是其中两条的**理由被实测否证了**，更正必须写在原句旁边。

0. ✅ **已由并行会话执行**：主检出 09:39:20 起在跑 `git merge feat/countdown-anniversary`，MERGE_MSG 里写明"合并前按该分支 §3.5 的指示移除了主检出的三份旧版文档"，合并提交 = `a29881e9`，冲突四处（`docs/README.md`、`docs/plans/goal-layout-audit.md`、`docs/reference/environment-traps.md`、`package.json`）全部由对方解决。本会话在 `.git/MERGE_HEAD` 存在期间**没有碰**主检出的 index 与工作树（当时 `.git/index` 每几十秒被写一次、load 76）。
1. ✅ **许可证清单已全量重渲染**（`135beb2c`，在主检出跑的；本会话用 `node research/tools/render-license-inventory.mjs --check` 独立复核 = ✅ 一致）。
   ⚠️ **本条原来给的机制不准确**。原文说"在隔离 worktree 里跑会把**并行会话工作树才装着的包**判成不存在"——实测那 14 条差异分属两个原因：
   - `@floating-ui/*` 五条 + `react-activity-calendar` + `tabbable`：**真被删掉的依赖**。合并后的 `pnpm-lock.yaml` 里 grep 计数 0，`packages/*`、`apps/*` 里也没有任何 package.json 声明它们；清单记着它们只是因为那份产物的生成日期（2026-09-27）早于移除。
   - `playwright` 三条：**工作树差异**。`e2e/` 刻意不在根 pnpm 工作区内（它自带一份 lockfile，AGENTS §6），所以只有跑过 `cd e2e && pnpm install` 的那棵树才看得见它。实测同一份渲染器在隔离 worktree 出 **958** 条、在主检出出 **1093** 条。
   ⇒ 结论不变、理由换掉：**这份产物只能在装了全部 workspace 的主检出渲染**，在隔离检出渲染会**静默少一整条 workspace 的依赖**。
   🔴 顺带照出一个真缺口：`check:licenses` 判的是**准入**（有没有不合格许可），**没有任何门禁判这份产物新不新鲜**，所以它能在依赖树变化后安静过期六天。**不能**直接把 `render-license-inventory.mjs --check` 挂进 `pnpm check`：它读磁盘上的 node_modules，在没装 e2e 那份 workspace 的干净检出 / CI 上**必然假红**。要挂，得先让渲染器改从 lockfile + workspace 配置推导（不在本批，登记为 **CDG-1**）。
   ⚠️ **这个短号一开始就起错了**：我原先写作 `G-1`，而 `docs/research/legal-pipl-baseline.md` 有
   一整套**它自有的** `G-1…G-20`「核实缺口」编号，并且那里明写「两处重名会让人在跨文档跟进度时认错行」。
   我没先查命名空间归属就用了同一个号（正是自己记过的那条教训）。现在改成 **CDG-1**（countdown 批次缺口 1）。
   现量：`grep -n 'G-1' docs/research/legal-pipl-baseline.md | head -3` 与 `grep -rn 'CDG-1' docs/`。
   ⚠️ **上面那句"改从 lockfile 推导"是我提错的机制，已实测撤回；**CDG-1** 已按另一条路关掉（提交 `47897912`）**：
   - `grep -c license pnpm-lock.yaml` ⇒ **0**。许可证字符串只住在**已安装包**的 `package.json` 里
     （`license-inventory.mjs` 扫的是 `node_modules/.pnpm` 与 `e2e/node_modules/.pnpm` 两座虚拟 store），
     lockfile 里**没有这个字段** ⇒ "从 lockfile 推导出整份清单"在数据模型上不成立，除非联网查 registry 或先装。
   - 内容级 `--check` 挂不进 CI 的理由，**渲染器自己的文件头就写着**（依赖树天生平台相关，
     `@esbuild/darwin-arm64` 与 `@esbuild/win32-x64` 二选一）—— 我写 CDG-1（当时写的 G-1）时没去读它，
     于是把"缺 e2e workspace"当成唯一障碍，而实际有两个。
   - ✅ 关掉它的判据只比**一件纯文件的事**：产物是在哪一把 lockfile 下渲染的。渲染时在表头写
     `lockfile 指纹：<sha256 前 16 位>`，`--check-stamp` 只读那份 md 与 `pnpm-lock.yaml`
     （**不进取数据那一步**）⇒ 没有 node_modules 也能判，所以它上得了 CI，内容级比较上不了。
     四例判据在临时"无 node_modules 检出"里跑真函数：相符 ⇒ 0 / 改一位指纹 ⇒ 1 / 删掉整行 ⇒ 1 /
     **只换 lockfile 不动清单 ⇒ 1 报"已过期"**（最后一例就是那次六天事故的形状）。
     现量：`node research/tools/render-license-inventory.mjs --check-stamp; echo RC=$?`。
   ⚠️ **还欠一行接线，且欠的原因不是贵，是别人正占着那个文件**：把
   `"check:license-stamp": "node research/tools/render-license-inventory.mjs --check-stamp"`
   加进 `package.json` 的 `check` 链（放在 `pnpm check:licenses` 后面）。
   ✅ **这一行已于同日 11:46 落地** —— 等的就是 `package.json` 变干净，且落地前先确认了
   他们那笔是**脚本与接线同一笔提交**（不是把一条指向不存在文件的门禁推进 HEAD）：
   `git status --porcelain -- package.json` ⇒ 空、
   `git ls-tree -r --name-only HEAD | grep -c scripts/check-mobile-first-run-gate.mjs` ⇒ **1**、
   `git show HEAD:package.json | grep -c 'check:mobile-first-run-gate'` ⇒ **2**（定义 + 链上引用）。
   实际取的名字是 **`check:licenses:stamp`**（跟 `check:licenses` / `check:licenses:nuget` 同族，
   而不是我草稿里那个孤立的名字），插在 `check:licenses` 之后。
   现量：`pnpm -s check:licenses:stamp; echo RC=$?` ⇒ ✅ 对得上当前 lockfile，**RC 0**。
   ✅ **而且真的在干净检出上验过一遍**（不是只验"我这台装了东西的树"）：
   `git worktree add --detach /tmp/heyta-wt-cleanstamp HEAD` 之后那棵树里 `node_modules` **不存在**，
   在它里面跑 `node research/tools/render-license-inventory.mjs --check-stamp` ⇒
   ✅ `对得上当前 lockfile（111cc2d1d04d3763）`，**RC=0**；跑完 `git worktree remove --force` + `prune` 收掉。
   这才是"能进 `pnpm check`"这句话的证据 —— temp 目录里手搓的那一份只能证明文件比较逻辑，
   证明不了 HEAD 这棵树的产物与 lockfile 是对得上的。
   ⚠️ **04 05:1x 补一句：上面那两次 RC=0 都是**当时那把 lockfile（`111cc2d1d04d3763`）**的读数，而它已经变了**——
   `2f735392`（10-03 23:58"并行批次的总接线"）把本分支的 lockfile 换成了 `0f3c1bf6d9e21526`，清单没跟着走，
   于是这一格在 04:45 那趟 sweep 里红了。这条红**是本分支的**（main 那份清单早已重渲染到 `0f3c…`），
   修法是取 main 那份（与本地 `diff` 只差戳行 + 生成日期两行，正文 1128 行逐字节相同）⇒ 现量 `--check-stamp` **rc=0**。
   📌 这条门禁"不需要装任何东西"的优点反过来看就是它的**暴露面**：戳对不上时它不需要任何东西就能红，
   所以**任何一笔动了 lockfile 的提交都会立刻把它踩响**，包括那些只是把别人的接线合过来的提交。
   📌 它能进 `pnpm check` 而内容级的 `--check` 不能，全部差别在一件事上：**它不需要装任何东西**。
   ⚠️ 等的时候照出来一条**归他们**的风险 —— "`package.json` 里已经引了
   `check:mobile-first-run-gate`，而它指向的脚本还是未跟踪状态" ⇒ 那时任何一笔从 HEAD
   起的干净检出跑 `pnpm check` 都会红在 `MODULE_NOT_FOUND` 上。**这条现在自己关掉了**：
   他们那一笔把脚本与接线放进了同一笔提交（上面那三条读数是它现在的状态），
   所以我没有代改，也没动他们的行。留这段是为了记一条形状：
   **门禁的"引用"与"被引用的那个文件"必须在同一笔提交里落地**，否则 HEAD 是不可跑的状态。
2. ✅ **撞号已按原指示处理，而且比预告的严重**：预告只说"主检出工作树里已有一条写到 136"，实测合并时 main 的台账已经编到 **160**，本批四条占的 137–140 是**真撞号**（`sed -n '/^137\./,/^137\./p'` 取到的是别人的条目）。合并方把它们重编为 **161–164**，内容一字未改。收口复核：台账 1–164 无重号（`grep -oE '^[0-9]+\. ' | sort -n | uniq -d` 只剩 `1,2,3,4,38,93,94,95` —— 全是条目正文里的有序列表，不是条目号）。
3. ✅ **AGENTS.md §7 索引表**补了 161–164 那一行（用户 2026-10-03 指示"把落下的东西全部收口"就是 §8 要求的那次明确授权）。同批把 §7 开头写死的"83 条实测踩过"换成现量命令 —— 它本身就是本条要说的那种抄件，已经漂了。
4. ✅ **lockfile 复解析过了：零 churn**。在合并态的隔离检出（`a29881e9` + 一次全新 `pnpm install`）跑完 `git status --porcelain` 输出 **0 行** ⇒ 合并后的 lockfile 与全部 manifest 自洽。
   ⚠️ 本条原文那句"`(supports-color@5.5.0)` 从 **60** 处涨到 **76** 处"是**我抄错的数**，实测是 base **58** → 分支 **74**（+16），并且**只改 key 的 peer 后缀拼写、零个版本变化**。数字不再抄进文档，只留现量命令：
   `git diff <base>..<tip> -- pnpm-lock.yaml | grep -cE '^[+-] +version:'`。

**收口时新照出来的一条（不属于本批，已归还原主线）**：合并态 `pnpm -r typecheck` 红在两处 —— `packages/app-host/tests/hosted-account-profile.spec.ts:138,156`（`null` 与 `string | undefined` 的覆写类型），来自 `7e299118`「feat(account): 账号资料三端贯通」（09:38 提交）。归属证据：`git diff --name-only 2ed84122..57078ddb` 里 `hosted|account` 命中 **0 处** ⇒ 本批不可能造成它。对方已在 `8fdcab6a` 修掉，本会话在 `8fdcab6a` 上独立复跑 `pnpm --filter @heyta/app-host typecheck` = **RC 0**。

**合并态实测**（在 `a29881e9` 的隔离检出里，一条命令一段日志、每段自己那次的真实退出码）：`pnpm -r build` **0**、`pnpm check:calendar` **0**、`pnpm check:holiday` **0**、`pnpm check:licenses` **0**、`pnpm -r --filter '!@heyta/sync-server' test` **0**；`pnpm -r typecheck` 在 `a29881e9` 上 **2**（就是上面那条别人的债），在 `8fdcab6a` 上 **0**。

**收口这一轮新加的判据，牙齿收进一条可复跑命令**：`bash scripts/mutate-closeout-gates.sh`
（照 `scripts/mutate-*.mjs` 那一族的先例：manual 跑、不进 `pnpm check`，但**在仓库里**，
所以它描述的那次变异下次任何人都能重放 —— 之前我把这类 harness 留在仓外的临时目录里，
文档里那些"5/5、9/9"的读数就成了**只有这台机器这一次运行**能看见的东西）。
11 例：G1–G4 许可证指纹判据（含"只换 lockfile、清单不动"这一例，就是 CDG-1 的形状；
跑在没有 node_modules 的临时检出里，顺带证明它上得了 CI）、L1–L4 负载门（恒超标必红 / 低负载必放行 /
边界是 ≤ / 等待序列按旋钮走）、P1–P2 设备占用探针（活的对照组揭穿 `grep -F` 那条盲探针）、
S1 负载门的单一所有者（定义 1 处 + source 恰好 2 处）。2026-10-03 11:42 实测 **11 绿 0 红**。
📌 写这个 harness 的当天就两次踩到自己：① S1 的 `grep 'wait_for_quiet_host()'` 把**本文件自己那行
grep 命令**数成第二处定义（判据必须锚"行首的定义形状"，不锚一个词）；② P1/P2 的提示串里用反引号包命令，
双引号内被当命令替换执行掉，打印出来是**两个空格**（消息里没有命令，等于把被验证的那条命令弄丢了）。

### 固定收尾（AGENTS §6.1.1）：mac 段我自己跑绿了，另外三端按内容独立复核

> 🔴 **本节的适用载体是 2026-10-03（`940af1c0` / 并行那趟 `267ac912`）**，不是"现在的机器状态"。
> 04 14:28 现量：`/Applications/Heyta.app` 里那份 `web-dist/index.html` 的 sha256 前 16 位仍是 `217cae2a252d8948`、
> mtime 仍是 `10-03 23:05:40`，而本地 `apps/web/dist` 是 `517c6ba76d00fb25`；那之后落在会进 mac 包的源码路径上是 **81 个文件**
> （含本批的 `CountdownView.tsx` / `card-export.ts`）⇒ **"mac 跑绿过"不能读成"mac 装的是当前产物"**，
> 那一格要重装才算闭合（链 W 取产物栏、装步属共享位置持有者）。逐条读数见本节末尾 ㊺。

1. ✅ **mac 段 = 本会话自己跑的**（隔离检出，10:29–10:33）。读数：
   `窗口 1092x723、heyta-reinstall-mac-installed.png.webview.png 内容占比 73.0%、主蓝命中 1269 —— 是共享 UI`。
   🔴 **15:5x 现量更正：那枚图没有常驻**，而仓里最像它的那枚**不是它** ——
   `apps/desktop-macos/evidence/reinstall-20261002-1852-mac-installed.webview.png` 的自述是
   `WINDOW_SIZE=1082x716 / PNG_BYTES=144615`，与本行报的 **1092x723** 不是同一次运行（差一天、差一档窗口尺寸）。
   我差一点就把"名字像、也是 mac 安装自截屏"当成同一件事写进台账 —— **值对得上不等于它就是那个角色**，
   这里救我的是那份 `.txt` 自己写了尺寸。
   ⇒ 这一格按 **W5-G1 同族的第 4 例**登记（"人已看过"的证据只活在 /tmp）：本轮**不补**，
      补它要重装 mac（属 #23 那格，共享位置持有者）。今天这一趟（链 W）的两张图已常驻，
      所以 Goal ⑤-3 不依赖这一格。
   ⚠️ 也别把本行的 1269 与链 W 那趟的 1269 当成"两次独立读数互相印证"——
      其中一趟的图已不在盘上，无从核对它们是不是同一枚。
   第一趟（10:19）**判红过**，而红的是判据不是产品：窗口截图 13 KB / 内容 0.0% ⇒ 🔴 疑似空白，
   同一秒的 WebView 快照是完整真界面（人已看过）。修法与变异读数写在提交 `90140793`，
   以及下面表里的 #170。
2. ✅ **android / ios / windows 三段没有重复跑** —— 并行会话 09:51 起在隔离检出 `267ac912`
   跑过一趟完整的，`/tmp/heyta-g7-reinstall.log` 汇总三行 ✅（10:05）。
   我占设备重装的代价是清掉别人的现场，所以改成**按内容**证明"装的就是当前产物"，四条现量：
   - `git merge-base --is-ancestor a29881e9 267ac912` ⇒ 真（本批合入是那趟的祖先）
   - `git diff --name-only 267ac912..HEAD -- apps packages | wc -l` ⇒ **8**，且 8 个全在
     `apps/web/evidence/**`（png + 一个 txt）—— 那 14 笔里**没有一行会进包的源码**
   - 已装的 APK 从设备拉回来再探：`adb -s emulator-5556 pull "$(adb -s emulator-5556 shell pm path com.heyta | sed 's/^package://')" …`
     → `unzip -p … assets/index.android.bundle` → `每年`=1（UTF-16LE）/ `yearly`=5 / `FREQ=YEARLY`=1，
     同趟阳性对照 `收集箱`=10
   - iOS 已装容器的 `main.jsbundle`（mtime 10:05）同一趟同读数；mac 的
     `/Applications/Heyta.app/Contents/Resources/web-dist/assets/*.js`：`FREQ=YEARLY`=1 / `yearly`=22 / `收集箱`=16
   - 🔴 **Windows 那一端顺手量出一个真洞，并已修**：远端 `C:\src\heyta\apps\web\dist\assets`
     实测躺着 **26 个 `index-*.js`**（本地 7 个，mtime 跨 9/27 → 10/3 六次构建），
     因为同步是"覆盖式解包、不删远端目录"，而 vite 的 chunk 名带内容哈希**只增不减** ⇒
     `package-msix.ps1` 把整份 `web-dist` 搬进包，装出来的包带着 ~19 枚没人引用的旧产物。
     今天行为没坏（入口按哈希取），坏的是"清旧包"只到 `.appx` 层、没到同步源层。
     修法两处：解包前先 `Remove-Item` 远端 `apps/web/dist`，再加一条**按枚数**的对账
     （数不到也算红）。判据：桩 `ssh` 跑**活函数** 5/5，含"探针被调到 3 次"那条阳性对照 ——
     第一版正是它揭穿了"两条 PASS 其实压根没走到被测判据"。正文见台账 **#175 / #176**。
   🔴 **这条结论差点被一个坏探针推翻**：Hermes 字节码里中文是 **UTF-16LE**，
   所以 `grep 每年` 和"按 utf8 文本读整份文件"都**恒 0**。我第一趟据此写下"装的包里没有本批代码" ——
   那是探针坏，不是产品坏，而且**同趟的 `收集箱`=0 就是它自己的反证**，只是我没先看对照。
   正文进台账 #171。
3. 🔴 ~~仍欠的一件：W3「每年」的真机那一趟~~ ⇒ ✅ **2026-10-03 14:57:41 跑完：`通过 50 项，失败 0 项`、
   `STEP C_RC=0`**，读数与逐趟红集收敛在下面第 13–15 条，这一节留原位是为了让人看清
   "窗口没开"的判断前后反转了几次（脚本第 15 步已落地并离线验过：`bash -n` 0、
   期望规则串与 `Recurrence.yearly(10,17)` 逐字节相同、`check:script-snapshot` 仍 ✅ 28 个脚本）。
   2026-10-03 10:37–10:38 现量的现场 —— 四条都说明**现在跑它就是在动别人的现场**：
   - `adb devices` ⇒ 只有 `emulator-5556`；`adb -s emulator-5556 emu avd name` ⇒ **SSOS-Parity-A36**
     （与另一个项目共用的 AVD），`dumpsys window` 前台 = `com.heyta/com.heytamobile.MainActivity`
   - `scripts/verify-mobile-repeat.sh:241` ⇒ `adb shell pm clear $PKG` —— 跑它会把别人在那台设备上的
     登录态和数据**清掉**（这条在脚本里是第 241 行，不是可选项）
   - `lsof -nP -iTCP:3000 -sTCP:LISTEN` / `:3100` ⇒ 各有一个 `node dist/src/index.js` 在听
     （pid 87593 已 15h41m、58679 已 9h02m）
   - `docker ps` ⇒ `supersync-server` / `supersync-postgres` **Up About a minute**：并行会话正在起**同一套 compose**，
     换个 `PORT` 也还是会撞同一个 project
   - `uptime` ⇒ 1 分钟负载 38.86，而本仓自己的等待阈值 = 核数 × 3/4 = **12**

   ⚠️ **11:16–11:24 复量：窗口没有开，反而更堵** —— `sysctl -n vm.loadavg` ⇒ **50.64 / 31.44 / 27.96**；
   `adb devices` ⇒ 仍只有 `emulator-5556`，而 `ls ~/.android/avd` ⇒ 这台机器上**只有 `SSOS-Parity-A36` 一个 AVD**
   （`pgrep -f qemu-system` 那台就是它）⇒ "另起一台自己的模拟器"不是"再起一台"，要先 `avdmanager create avd`
   （系统镜像只有 `android-36`，在 `/opt/homebrew/share/android-commandlinetools`）；
   `lsof` ⇒ :3000 仍 pid 87593、:3100 仍 pid 58679；`pgrep -f 'verify-mobile-'` ⇒ **0**
   （这条今天刚从一条**盲探针**换成能匹配的，见上面第 1 条的 🔴 —— 换之前它两个方向都不可信）。
   负载 50 上再起一台模拟器会把别人**有时限**的设备判据压成超时假红，所以**没跑**。
   📌 **谁手里**：设备与 compose 栈在并行会话手里；两条收尾等窗口：① 本节第 15 步那一趟
   （✅ **已闭合**：2026-10-03 14:57:41 第六趟 `通过 50 项，失败 0 项`、`STEP C_RC=0`，见下面第 13–15 条）；
   ② 台账 #181（取号以当时现量为准，见下）从我这里搬进 `docs/reference/environment-traps.md`（台账此刻 `M`，见下面一节）。
   ⚠️ **② 到本批收口时仍未闭合**，把"在哪一步、在谁手里"写成现量而不是叙述：
   - 挡着的只有"台账文件正被并行会话写脏"这一件事，不是内容问题：
     `git status --porcelain -- docs/reference/environment-traps.md` ⇒ ` M`，
     `awk -F. '/^[0-9]+\. /{if($1>m)m=$1} END{print m}' docs/reference/environment-traps.md` ⇒ 工作树 **180**、
     `git show HEAD:docs/reference/environment-traps.md | awk -F. '/^[0-9]+\. /{if($1>m)m=$1} END{print m}'` ⇒ HEAD **177**
     ⇒ #178–#180 是他们三笔**尚未提交**的，编号要按工作树取，正文落进去之前我先不落笔。
   - 我的正文停在下面「待入 §7 的一条」那节，搬运 = 追加 + 把 #168 末尾的待办改成过去式，
     两条都不需要别人做任何事，只差一次干净的写入窗口。
   - 另一条**不属于本批、但同一把尺子量出来的**红：`node research/tools/docs-link-check.mjs` ⇒ **exit 1、8 处死链**，
     报出来的文件是 `docs/README.md`、`docs/plans/README.md`、`docs/plans/ui-review-fill-zh-timeline.md`
     （指向 ADR-0046/0047、trash-and-archive、calendar-year-time-and-mobile-profile 等**他们本机有、仓库里没跟踪**的文档）
     —— 本批那两份文件（这份计划 + AGENTS 那一行）不在清单里，我没有替他们 `git add` 别人的文档。
   📌 **另一条不属于本批、但同一把尺子量出来的缺口**：`AGENTS.md` §7 索引行现在覆盖到 **176**，
   而工作树台账末号是 **179** —— #177–#179 是并行会话那三笔，索引行归他们补。现量：
   `awk -F. '/^[0-9]+\. /{if($1>m)m=$1} END{print m}' docs/reference/environment-traps.md` 与
   `grep -oE '^\| *[0-9]+–[0-9]+' AGENTS.md | grep -oE '[0-9]+$' | sort -n | tail -1`。

   ⚠️ **11:49–11:53 再复量：窗口的形状变了，但还不是我的** —— `sysctl -n vm.loadavg` ⇒ **22.50 / 31.28 / 44.51**
   （1 分钟从 148 掉到 22，在落，但阈值是 12）；`pgrep -f qemu-system` ⇒ **0**（那台共用模拟器已经关了），
   `adb devices` ⇒ 无设备，:3000 / :3100 ⇒ 两个端口**都空了**，`docker ps` ⇒ 空。
   看起来像开了，可是：`xcrun simctl list devices booted` ⇒ **3 台 iOS 模拟器还起着**、
   `ps Axo command | grep -cE '[x]codebuild|[g]radle'` ⇒ **2 个在跑**、`git log --since='3 minutes ago'` ⇒
   他们最后一笔 **11:47**。⇒ 那是一条正在做设备/构建收尾的会话，**gradle 跑完就要装包**；
   这一刻我起第二台模拟器或抢那台 AVD，压的就是它的时间判据（同一形状见上面 11:24 那段）。
   **另记一条**：`~/.android/avd` 里仍然只有 `SSOS-Parity-A36`，但"起一台自己的"这次量清了成本 ——
   `avdmanager` 与 `emulator` 可执行、系统镜像 `android-36/google_apis` 在位 ⇒ **技术上今天就能建**；
   拦着的不是工具链，是"再来一台模拟器的负载"和"这台机器上有人在跑设备判据"这两件事。

   ⚠️ **11:56 复量，上面那条"在落"当场被否证**：`sysctl -n vm.loadavg` ⇒ **128.28 / 218.09 / 137.06**
   （11:49 是 22.50 / 31.28 / 44.51 ⇒ 7 分钟内 1 分钟负载从 22 涨回 128）。
   📌 一般规律：**1 分钟负载是一次瞬时读数，不构成趋势** —— 判"窗口开了没"要连读两次且看间隔；
   单次读数写成"在落"就已经是过度解读（这次它错了）。
   设备侧四条读数仍然全部指向"不是我的"：`adb devices` 无设备 / `pgrep -f qemu-system` = 0 /
   :3000 与 :3100 都空 / `xcrun simctl list devices booted` = **3 台起着** / `gradle|xcodebuild` = **2 个在跑**。
   📌 **push 这件事的现量（我没有推任何东西，也没有 merge）**：
   `git rev-list --count origin/main..main` ⇒ **37 笔未推**（其中含本批收口那 16 笔），
   `git merge-base --is-ancestor a29881e9 origin/main` ⇒ **真**（批次一的合入本身已在远端，
   是 09:56 那一笔 `d0aa20ff` 带上去的），`git ls-remote --heads origin feat/countdown-anniversary` ⇒ **0**
   （分支从没推过，也已被合入，留着还是删由产品负责人定：`git branch -d feat/countdown-anniversary` 我没有执行）。

   设备与服务端都归自己时的复跑命令：
   ```bash
   HEYTA_E2E_SERIAL=<自己的模拟器> PORT=<空端口> bash scripts/verify-mobile-repeat.sh
   ```
   🔴 **12:01 起这一趟真的在跑了**，形状是"三层都不共享"（这条写在这里是为了：**会话死了不会留下没人知道的现场**）：
   检出 = `../heyta-wt-closeout`（`git checkout --detach 592ea170`，跑前 `git status --porcelain` 为 0 行）；
   设备 = **新建的私有 AVD `heyta-w3-yearly`**（`system-images;android-36;google_apis;arm64-v8a`，
   headless `-no-window -no-snapshot-save`，不碰 `SSOS-Parity-A36`）；
   服务端 = `PORT=3200` + `HEYTA_E2E_DB=heyta_w3_yearly_20261003`（不复用 `heyta_mobile_smoke` 那个默认库名）。
   跑之前主检出的状态是：`adb` 无设备、`pgrep -f qemu-system`=0、:3000/:3100 全空、
   `pgrep -f 'verify-mobile-'`=0、`gradle|xcodebuild`=0（11:58 复量），只有 3 台 iOS 模拟器起着且负载 40 在落。
   编排脚本与各步退出码：`../heyta-wt-logs/w3-run.sh` / `w3-run.log`（每步 `STEPn_RC=`；
   `STEP3_RC` = 当前产物 APK，`STEP7_RC` = 第 15 步那一趟，**3 = 负载等满 = 环境无效不是产品失败**）。
   判据在第 15 步：点「每年」⇒ 规则 = `FREQ=YEARLY;BYMONTH=<当前截止月>;BYMONTHDAY=<日>`、
   op 数**恰好 +1**、界面出现「当前：每年」、笔记本读到同一条规则。
   ⚠️ 期望值取自**手机此刻的 dueDate**（`repeatAnchor = dueLocal ?? todayLocal`），
   不是脚本开头写死的那个日期 —— 这一点本身是第 15 步存在的理由。

   **12:04–12:27 这一趟的实测（每一条都是磁盘上的读数，不是计划）**：

   1. ✅ **当前产物的 APK 里 yearly 真的在**：`app-release.apk` 67,140,908 字节（12:04 打），
      解开 `assets/index.android.bundle` 按字节数 needle ⇒ `每年`(UTF-16LE)=**1**、
      `FREQ=YEARLY`(ascii)=**1**、阳性对照 `收集箱`=**10**、阴性对照 `年同比不存在串`=**0**。
      有对照是因为 #171 那个坑：**中文在 Hermes 字节码里是 UTF-16LE，`grep` 恒 0** ——
      没有那 10 次 `收集箱`，这个 0 和"没做"长得一模一样。
   2. 🔴 **12:09 那一趟 exit 1 是我的探针坏了，不是产品也不是环境**：编排脚本用
      `adb -s <d> emu avd name` 的第一行去**逐字相等**比 AVD 名，而 `adb emu` 的应答是 **CRLF** ——
      `od -c` 实测 `h e y t a - w 3 - y e a r l y \r \n` ⇒ `[ "$nm" = "$AVD" ]` **恒假**，
      60 轮全空转。设备其实 12:05 就 `Boot completed in 25012 ms`。
      同一个脚本里 `getprop sys.boot_completed` 那行做了 `tr -d '\r'`，**这行漏了** ——
      典型的"同一份输出格式在一条链上被两种方式对待"。补上 `tr -d '\r'` 后第一次轮询就命中。
      📌 待入台账（取号以当时现量为准，别照抄本行）：**`adb emu` 系（console）应答带 `\r`，
      `getprop`/`shell` 系也带 —— 任何"逐字相等"的 adb 读数判据必须先 `tr -d '\r'`，
      而它坏掉的形状是"永远等不到"，不是"报错"**。
   3. 🔴 **12:16 那一趟 exit 1 是隔离检出的固有代价，不是配置错**：`git worktree add` **不带
      `server/.env`**（它被 gitignore），而服务端有两把必填钥匙：`JWT_SECRET`
      （`server/src/auth.ts:34` 直接抛）与 `PASSWORD_PEPPER`
      （`server/src/index.ts:59` 的 `assertPasswordBackend` 在**绑端口之前**自检，缺了就拒绝启动）——
      症状是"服务端 60 秒内没有就绪"，真因在 `/tmp/heyta-e2e-server.log` 的第一行。
      我这趟的做法：给自己的栈**新生成一把**（不复用主检出那把）写进 `w3-stack.env`（权限 600、
      值不打印、复跑复用同一把 —— 中途换值会让已注册账号的口令散列永远验不过）。
      📌 待入台账：**"隔离检出"不等于"能跑的检出"** —— 凡是 gitignore 的配置（`server/.env`）
      都要在隔离现场显式补，且它的失败形状是**下游超时**（栈没起来）而不是"缺文件"。
   4. ✅ **私有库这条路线本来就有配方**：`docs/runbooks/local-server-verification.md` §步骤 1-2
      （`createdb` + `sh scripts/migrate-deploy.sh`，macOS 要 `research/tools/macos-sed-shim` 在 PATH 上）。
      现量：`heyta_w3_yearly_20261003` 已应用迁移 **42** 条，与共享库 `heyta_mobile_smoke` 的 **42** 条
      **逐条等量**（这就是"我的库不是半成品"的证据；直接 `prisma migrate deploy` 会在 9 个
      CONCURRENTLY 迁移上 P3018）。
   5. ✅ **归属四条都成立**：`:3200` 监听者 pid = **33262**，而共享 pidfile
      `/tmp/heyta-e2e-server.pid` 里的数**就是 33262**（跑前那个 pidfile 是**死人**：42398 已不存在）；
      账号是 `mobile-e2e-1791001057@example.com`（本轮新建，client 数 0 < 20）。
      ⚠️ **顺带照出的一条敞口（归他们那条线，不是本批能改的）**：`PIDFILE`/`LOGFILE`/账号凭据
      都是**固定 `/tmp` 路径**（`mobile-e2e-up.sh:46-47`、`mobile-e2e-down.sh:16`、
      `down` 里 purge 掉的三个 `heyta_mobile_*.txt`），而"幂等复用"的判据是**端口**
      （`mobile-e2e-up.sh:82` 只要求 `/health` 有**任意非空**响应）⇒ 两个会话用不同 `PORT`
      时**共用同一份 pidfile 与同一份凭据**：后写的覆盖前写的，而 `mobile-e2e-down.sh` 会杀掉
      "最后那个写 pidfile 的人"的服务端。所以**我这趟收尾不跑 `mobile-e2e-down.sh`**，
      改用 `../heyta-wt-logs/w3-teardown.sh`：只杀"命令行里带 3200 的占有者"、
      只 `adb emu kill` 名为 `heyta-w3-yearly` 的设备（先读 `emu avd name` 再动手）。
   6. 🔄 **负载门第一次在真实场景下工作**（不是变异夹具）：12:17:37 开始读数
      **469 / 495 / 509 / 486 / 459 / 431 / 444 / 411 / 396 / 296 / 196 / 136 / 115 / 90 / 66 / 51 / 35 / 28 / 20 / 13**
      —— 全部 `> 12` 就一律不放行，每 30s 一次、上限 900s，等满就 `exit 3`。
      📌 这里把上一轮那条一般规律**量成了现场**：那 469 不是别人在跑设备（`pgrep -f 'verify-mobile-'`=0、
      `xcodebuild`=0），是**同机多个 agent 会话的构建/测试并发** —— 所以"负载高"在这台机器上
      **不构成"有人在抢设备"的证据**，两件事要各自量。
   7. 🔴 **这一趟照出三条真 bug，各自当场修完**（都是"多个会话共用一套验收台架"这一类的，
      每条默认值与被替换的字面量**逐字相同** ⇒ 单会话行为一字不变，每条都有改前/改后 A/B）：

      | 提交 | 缺陷 | A/B 读数 |
      |---|---|---|
      | `87ba108f` | `lib/mobile-e2e-fresh-account.sh` 的默认地址**不跟 `PORT`**。六个设备脚本（auth / autosync / calendar / conflict / focus / repeat）都在 `lib/mobile-e2e.sh` **之前** source 它 ⇒ 那一刻 `SERVER` 必为空、写死的 `:3000` 赢。换端口的效果是"设备侧连 3200、**建号打在 3000**" | 改前 `PORT=3200` 仍得 `http://127.0.0.1:3000`；改后得 `:3200`；显式给 `SERVER` 时行为不变（`verify-mobile-ios.sh` 在 `mobile-e2e.sh` **之后**才 source，它拿到的仍是推导过的 `SERVER`） |
      | `5ca275e1` | 凭据三个路径**写者参数化了、读者写死**：`mobile-e2e-fresh-account.sh:49-51` 收 `HEYTA_E2E_*_FILE`，而 `mobile-e2e.sh:80-82` 硬 `cat /tmp/heyta_mobile_*.txt` ⇒ 设了变量只是把号建到私有文件、验收**继续读别人那一轮的令牌**。症状不是报错，是"用错了身份"：`pm clear`、op 数、跨设备断言全落在别人的账号上 | 旧件 + 私有路径 ⇒ 读到 `/tmp` 那份；新件 + 私有路径 ⇒ 读到私有的；不给变量 ⇒ 与原字面量相同 |
      | `3603db71` | `verify-mobile-repeat.sh` 开局 `rm -f` 两个**写死路径**的本地 sqlite ⇒ 第二个会话起这一轮，会把**第一个会话正在用的那轮**的笔记本库删掉；之后那批断言全在读一台空笔记本，看着像"手机写了、笔记本收不到"（与 traps #169 同形状，对象从设备换成文件） | 旧件设变量仍指 `/tmp/heyta-repeat-laptop.sqlite`；新件设了才换、不设相同 |

   8. 🔴 **第四条不是脚本 bug，是我这次隔离设计漏的一层**：`emulator-5554` 是**全仓所有设备脚本的
      默认串口**（`HEYTA_E2E_SERIAL` 缺省值），所以"私有 AVD"起在 5554 等于**把别人的默认设备
      换成了我的**。实测撞上来的形状：12:33 另一个会话建号写了共享凭据（`/tmp/heyta_mobile_email.txt`
      的 mtime），12:35 我的模拟器收到一句"等 20 秒优雅退出"就没了（`w3-emu.log:100`），
      而我的下一趟 20 轮×3s 全报"没有名为 `heyta-w3-yearly` 的设备"。
      ⇒ 现在这趟改成 **`-port 5556`**（串口 = `emulator-5556`），私有凭据目录 `/tmp/heyta-w3-yearly`，
      私有 sqlite 两份。📌 一般规律：**"名字私有"不等于"命名空间私有"** —— AVD 名是我的，
      串口号却是公共的。
   9. ⚠️ **登记为缺口、本批不修的那一条**：`/tmp/ui.xml`（`uiautomator dump` 的宿主落点）仍是固定名，
      并行两轮会互相覆盖 —— 闭合代价是**现量**的而不是估的：
      `grep -rc '/tmp/ui.xml' scripts/lib/mobile-e2e.sh scripts/verify-mobile-*.sh | awk -F: '{s+=$2} END{print s}'` ⇒ **36 处**，
      分布在 1 个 lib + 12 个验收脚本（`grep -rl 'ui\.xml' scripts/verify-mobile-*.sh | wc -l` ⇒ 12）。
      这不是"顺手加个默认值"的量级，所以留在这里而不是塞进本批。
   10. 📌 **我自己这一趟犯的两次探针读法错误，记下来给后来者**：
       ① `cmp -s A B && echo "✅ 同步"` 那行**没打印**，我把紧随其后的**门禁自己的** ✅ 行（"自快照 bootstrap 全部在位"）
          当成了它的输出，差点把"检出已同步"写进文档 —— 判据行必须与它所属的命令**在同一行可核对**，
          或用 md5 这种带值的读数（最后就是 `md5 -q` 两边相等才认）。
       ② 一条 A/B 探针把 `/tmp/heyta_mobile_token.txt` **原文打印了出来**（一枚本地 TEST_MODE 账号的 JWT，
          未进任何文件/提交）。以后比较凭据只比**长度或哈希前缀**，不 `cat`。
   11. 🔴 **12:45–12:51 那一趟整片"找不到 X"不是产品缺陷，是一台几何不对的设备**（已提交判据 `1ebbf800`）：
       `verify-mobile-repeat.sh:101-103` 的标签栏坐标是**写死像素**
       （`TAB_TASKS=108`、`TAB_PROFILE=972`、`TAB_Y=2253`），只在 **1080x2400@420** 这一档成立，
       而**没有任何一条判据核对过这个前提**。我这台是 `avdmanager create avd` 不带 `--device` 时
       默认给的 **320x640@160**（对照：那台共用的 `SSOS-Parity-A36` 是 1080x2400@420 ——
       `grep hw.lcd. ~/.android/avd/<avd>/config.ini` 现量），于是 `input tap 972 2253`
       **落在屏幕之外：不报错、也不生效**。表现正是"从第 2 步起每条断言都『找不到 X』"。
       否证过程留三条读数是重点：
       ① 我先假设"**灭屏/锁屏**"——`dumpsys power` ⇒ `mWakefulness=Awake`、
          `settings get system screen_off_timeout` ⇒ **2147483647**、无 keyguard ⇒ **假设被否证**，
          没有把它写进任何结论；
       ② 再假设"**应用崩了**"——`dumpsys dropbox` ⇒ `data_app_crash`/`data_app_anr` **0 条** ⇒ 否证；
       ③ 决定性的是**当时那份 dump 的内容**：6 个 text 节点、20 个 id 全是
          `com.google.android.apps.nexuslauncher`（`Sat, Oct 3` / `Phone` / `heyta` / `Chrome`）——
          **前台是桌面**，而我手动 `am start` 之后同一台设备 dump 出 **34,579 字节、包名全是
          `com.heyta`、17 个中文 text**（任务/日历/专注/分类/我的 + 列表/四象限/时间线/日期/**倒计时**）
          ⇒ 应用一直活着，坏的是"我点在屏幕外"。
       📌 一般规律：**"每条断言都找不到 X"这个形状，先问"屏幕上是谁"，再问"X 做没做"** ——
       一叠缺失断言在输出上和"应用在前台但功能坏了"长得一模一样（§7 元规则 1 的第五次现身）。
       修法分两层，都要：①我这台改成 1080x2400@420（`config.ini` 改前三处数值、备份
       `config.ini.bak-320x640`），编排脚本里加一条开局 `wm size`/`wm density` 对账；
       ②脚本本体加**前提判据**（不符 ⇒ `exit 3` = 环境无效，与负载门同一约定），
       而不是留一屏假红等人来猜。
   12. 📌 顺带一条**没修、登记**的小口子：`verify-mobile-repeat.sh:243` 那行抬头把库名**写死印成
       `heyta_mobile_smoke`，而真正用的库由 `HEYTA_E2E_DB` 决定 —— 我这趟是
       `heyta_w3_yearly_20261003`，日志里那行是错的。现量：
       `grep -n '库: heyta_mobile_smoke' scripts/verify-mobile-repeat.sh` ⇒ 1 行。
       它不改行为，但它把"这一轮跑在哪个库上"这条取证信息印错了，属于本仓库最不该有的那类抄件。
   13. ✅ **14:29 之后第 15 步真的在真机上跑完了**，而 W3 的产品判据**一条没红**（读数出自第四、五趟，
       两趟这几行逐字相同）：
       ```
       ✅ 锚点前提成立：手机当前截止日就是顺延后的 2026-10-17
       ✅ 换一次预设只产生了 1 条 op（1 → 2）
       ✅ 「每年」落库的规则正确：FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=17
       ✅ 锚点跟着当前截止日走：2026-10-17
       ✅ 面板显示「当前：每年 …」（describeRecurrence 认得这条规则）
       ✅ 笔记本读到同一条「每年」规则：FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=17
       ```
       期望值取自**手机此刻的截止日**（顺延两次到 10-17）而不是脚本开头写死的 10-03 ——
       这正是第 15 步存在的理由，本轮第一次在真机上兑现。
       红集逐趟收敛（每一趟的条数都是从日志里数出来的，汇总行 `通过 N 项，失败 M 项`）：

       | 趟 | STEP C 起—止 | 通过/失败 | 当时剩下的红 |
       |---|---|---|---|
       | 1 | 13:49:35–13:58:21 | 35 / 6 | 「立即同步」×3、第 7 步两条、第 15 步"点不到任务行" |
       | 2 | 14:00:14–14:06:07 | 35 / 6 | 与第 1 趟**逐条相同**（可复现 ⇒ 不是负载抖动） |
       | 3 | 14:11:20–14:26:15 | 20 / 16 | 不作数：整趟被另一条会话重装 APK 打断（上面第 8 条） |
       | 4 | 14:29:59–14:36:52 | 45 / 3 | 第 7 步两条、第 15 步"找不到立即同步" |
       | 5 | 14:40:03–14:49:11 | 48 / 1 | 第 15 步"找不到立即同步" |

       第 1、2 趟那 6 条里 4 条由 `a371a658`（界面断言改"见到为止"+ 补回第 15 步漏掉的那次 dump）消掉；
       第 7 步两条由 `cc974fbd` 消掉 —— 它**不是产品没接上**：面板是 ScrollView，「重复」区块整体在
       首屏之外，而第 7 步只在刚打开那一次 dump 上 grep。同一趟里紧接着的第 8 步用会滚动的
       `tap_label` 点「每周」全绿、第 9 步读「当前：每周六」全绿，而**第 9 步早就为这件事写了
       "裁掉就滚一下"**，第 7 步没有 —— 一份脚本里同一个坑的两种待遇。第五趟修好后打印
       `向下滚过 3 屏才收齐`，并且**按滚下去的次数滚回顶部**（`scroll_to_*` 只会往前滚，
       停在底部会让第 8 步永远找不到「每周」，那是自己弄坏下一步的前提）——
       第 8 步在第五趟仍然绿，就是这条守卫的对照。
       夹具在 `scripts/mutate-closeout-gates.sh` 的 **V 组**：抽出脚本本体（不是另抄一份逻辑）接到
       虚拟滚动上，V1 首屏之外必须算收齐、V2 真缺「每年」必须报缺（W3 担心的正是产物里没这一档）、
       V3 整块不存在两条都必须红。现量：`bash scripts/mutate-closeout-gates.sh` ⇒ **17 绿 0 红**，exit 0。
   14. 🔴 **我为了"这轮算不算数"写的那条设备指纹探针，自己假阳性了一次**（第五趟 14:49:11 报
       "设备被别人动过"）：结束值 `lastUpdateTime=14:41:33` 落在起跑后 90 秒内，而验收脚本的
       **第 1 步本来就是 `adb install` 当前产物** —— 自己装的包被自己的探针读成了别人动过。
       修法不是放宽判据，而是**把基线挪到会引起误判的那个动作之后**：编排脚本 `w3-iso.sh` 现在边跑
       边盯日志，见到 `应用已启动` 才取基线；取不到基线就**明确不做比对**（拿起跑值去比就是这次假阳性），
       读数两行都打印出来（`开局设备指纹（起跑值）` + `基线指纹（第 1 步装包之后）`）。
       📌 一般规律：**判"这轮有没有被外力打断"的探针，要先问它读的那个量里有没有我自己的一步** ——
       装包/清数据/改设置这类"验收自己的动作"和"别人动过"在 `dumpsys package` 里是同一个字段。
       第 3 趟那次**是真的**（`firstInstallTime == lastUpdateTime == 14:19:33`，而起跑是 14:11:20），
       所以这条探针不是没用，是原来取样点错了。
   15. ✅ **第六趟 14:50:36–14:57:41 ⇒ `通过 50 项，失败 0 项`、`STEP C_RC=0`**，
       第 15 步那格红消掉了，而**我给它的第一个解释是错的**，这条要写在结论前面：
       假设是"详情面板盖住底栏 ⇒ 那一下落在面板上"，第五趟补上关闭之后**仍然红**，
       而 `✅ 面板已关` 那条是绿的 —— 假设被自己的那一趟否证。
       决定性的是跑完之后在那台设备上现取的一份现场：`mCurrentFocus` =
       `com.heyta/com.heytamobile.MainActivity`、界面**停在任务列表**，
       底栏「我的」的 `bounds=[864,2169][1080,2337]`，脚本点的 `972 2253` **明明落在里面**
       ⇒ 不是坐标错、不是面板挡，是那一下**被 Modal 的关闭动画吃掉了**（点了、没生效、也没人再点）。
       所以判据不是"我猜对了原因"，而是**把前提变成看得见的两行**：
       ```
       ✅ 面板已关（走的是第 10 步那个有名字的出口：980 340）
       ✅ 列表回来了（点底栏的前提成立）
       ```
       第五、六两趟之间只差 `settle_for "$TASK_TITLE"` 这一句 ⇒ 红→绿是同一条判据的 A/B。
       设备侧另有一条独立佐证：列表里那一行实时写着
       `打开任务：repeat-e2e-144133，重复：每年 10 月 17 日`（无障碍标签里带着规则结论）。
       📌 一般规律：**`input tap` 落在正确坐标上不保证被消费** —— 界面正在换场时它是**静默失败**的，
       而"点了没反应"和"那个按钮不存在"在 dump 上长得一模一样（§7 元规则 1 的又一次现身）。
       复跑（隔离检出 + 私有 AVD/端口/库/凭据/sqlite，全套编排在树外）：
       ```bash
       cd "/Users/rocalight/Desktop/All in one Data/01-PROJECTS/heyta-wt-logs"
       bash w3-iso.sh            # STEP C_RC=0 = 这一趟算数；3 = 负载等满 = 环境无效
       ```
       📌 **W3 这条到此闭合**：脚本第 7 步六个预设（含「每年」）与第 15 步的跨年档位
       都已在真机上跑绿，`verify:mobile-repeat` 覆盖的不再只有 WEEKLY。
   16. 🔴 **收现场时我自己把那一趟又起来了一次**，原因蠢到必须写进来：收尾脚本里那行
       `echo "… 复跑命令写着 \`bash w3-iso.sh\` …"` —— **反引号在双引号里是命令替换**，
       于是 15:01:47 那条"清理"命令真的执行了 `bash w3-iso.sh`：起了模拟器（pid 60101）、
       起了 :3200 服务端（pid 60644）、走到验收脚本的负载门。发现的方式也不是"知道自己在干嘛"，
       而是脚本**卡住超过 120 秒** ⇒ `ps -o pid,ppid,lstart` 才看到 `w3-teardown.sh` 底下挂着
       一个 `bash w3-iso.sh`。处理：按 pid 逐个 kill（只 kill 认得出 `PORT=3200` 的那个进程），
       `adb emu kill` 收掉我的 AVD，误跑那趟的日志单独归档成 `w3-repeat3-run7-误跑.log`。
       改完之后现场复跑过一遍收尾脚本并以读数确认它不再起任何东西：
       `bash w3-teardown.sh; pgrep -f 'bash w3-iso.sh'` ⇒ 空，`adb devices` ⇒ 空，`qemu=0`，:3200 ⇒ 空。
       全目录同类形状自查（现量，别靠记）—— 找"双引号里出现反引号"的行：
       ```bash
       grep -n '"[`]' *.sh        # 命中 0 才算干净；当时只有那一行命中，现在 0
       ```
       📌 这条我**已经有过一次教训**（"双引号里的 pattern 含反引号会被命令替换 ⇒ 报『没有残留』其实 grep 没跑"），
       这次的症状更贵：不是漏测，是**在共享机器上多起了一台模拟器和一个服务端**，压的是别人那条时间判据。
       所以规则要落成**写盘时的 grep**，不是"记得别这么写"。
       ⚠️ 另一条同类敞口当场查到并登记（**没改**，因为那是并行会话在读的文件）：
       `settle_for`/`dump` 系列脚本里 `/tmp/ui.xml` 仍是固定名（上面第 9 条，36 处）。
   17. 📌 **收现场后留下的东西**（都是有意保留，为了那条复跑命令真的能复跑）：
       私有 AVD `heyta-w3-yearly`（1080x2400@420，原 320x640 的配置备份在 `config.ini.bak-320x640`）、
       私有库 `heyta_w3_yearly_20261003`、私有栈 env `w3-stack.env`（600 权限，只服务这台一次性库）、
       隔离检出 `../heyta-wt-closeout`（detached `592ea170` + 三个文件按 main 镜像，md5 逐字节相同）。
       三条撤销命令都在 `w3-teardown.sh` 的打印里（AVD / 库 / worktree），**都不自动执行**。
4. 📌 **本会话留下的隔离检出**：`../heyta-wt-closeout`（detached，`43a6cf60`）。
   它的**两个脚本**（`scripts/reinstall-all.sh`、`apps/desktop-macos/scripts/package-app.sh`）
   与 main 逐字节相同（`cmp` 过）；**文档以 main 为准** —— 检出里那份落后于把台账条目
   正式落成 #168–#171 的那一笔。留着它的唯一用途是它已经 `pnpm install` + `pnpm -r build`
   完，等负载 ≤12 且设备归自己时可以直接在那儿跑第 15 步。
   不需要了就 `git worktree remove --force ../heyta-wt-closeout && git worktree prune`。

### 待入 §7 的四条已落进台账（本节的抄件按"抄件一定会漂"撤掉，只留指针）

四条正文于 2026-10-03 10:54 落进 `docs/reference/environment-traps.md`，编号 **168–171**；
`git diff --numstat` 的读数是 `63\t0` —— **只插入、零删除**（追加台账时"删了别人一行"
是最贵的一种事故，所以这条必须量，不能靠眼看）。

| 本批的发现 | 台账号 |
|---|---|
| 等负载的 `vm.loadavg` 解析自己坏了 15 轮 / 守卫也是探针 / `wait_for_quiet_host` 该抽进 `scripts/lib/` | #168 |
| `reinstall-all.sh` 的 ios 段盲选模拟器 —— 卸载类脚本选目标不许靠默认值或 `head -1` | #169 |
| 窗口截图当"画没画"的载体 ⇒ **同时**假红和假绿；该换载体而不是换阈值 | #170 |
| Hermes 字节码里的中文是 UTF-16LE，`grep` 恒 0 长得和"没做"一模一样 | #171 |

现量命令（**下次要引用编号前先跑它，别照抄本表** —— 这张表本身就是会漂的那一份）：

```bash
grep -nE '^1(6[5-9]|7[0-9])\. ' docs/reference/environment-traps.md | cut -c1-70
```

🔴 台账里没落的一条待办，写在 **#168 末尾**：把 `wait_for_quiet_host` 从
`scripts/verify-mobile-restore.sh` 抽进 `scripts/lib/` —— 它现在是某一个脚本的私有函数，
第二个想用的时候就又是一份抄件（同族教训见 `mobile-e2e.sh` 文件头）。
✅ **这条已于同日 11:34 落地**（`scripts/lib/wait-for-quiet-host.sh` + restore/repeat 两处引用，提交 `1d085a92`）。
📌 因此台账干净时除了搬 **#181**，还要把 #168 末尾那两句待办改成一句过去式指针
（**不要删** —— 那条"手写等待循环把坑踩三遍"的机制正文是判据本身，被删掉的往往是它）。

### 待入 §7 的两条（**正文写好了，先落在这里**：台账此刻被并行会话写脏）

为什么不当场追加：`git status --porcelain -- docs/reference/environment-traps.md` 现在输出 `M`，
工作树末号 **15:0x 复量 = 180**（`awk -F. '/^[0-9]+\. /{if($1>m)m=$1} END{print m}' docs/reference/environment-traps.md`；
HEAD 侧仍是 177 ⇒ #178–#180 是他们尚未提交的那三笔）。在一棵正被别人改的共享树上
用 `commit --only <该路径>` 追加，会**把别人未提交的那几段一起写进我的提交**（`--only` 提交的是
那个路径的**工作树内容**，不是我的 diff）。所以这条按规则停在单写者文档里，等台账干净时原样搬进去，
届时编号以**当时工作树现量**为准。
⚠️ **这条预见在 35 分钟后就兑现了一次**：11:20 那一刻工作树末号是 179 ⇒ 我写的是 180；
11:55 复量工作树末号已经是 **180**（并行会话新落了 #178 四端重装判据只答"装上了"不答"装的是不是本批产物"、
#179 `tee` 吃掉退出码、#180 共享板一个 tick 里连调宿主两个 setter），三条主题与我这条都不重合 ⇒
**我这条现在要取 #181**。这正是本条正文自己讲的教训的另一种面目：编号也是"当时那一次"的读数，
它不像内容那样会报错，只会和别人的条目**并成同一个号**（§3.5 第 2 条那次 137–140 撞号就是这么来的）。
现量（搬之前必跑，别照抄本节任何一处号）：
```bash
awk -F. '/^[0-9]+\. /{if($1>m)m=$1} END{print m}' docs/reference/environment-traps.md   # 工作树末号
git show HEAD:docs/reference/environment-traps.md | awk -F. '/^[0-9]+\. /{if($1>m)m=$1} END{print m}'   # HEAD 末号
```

🔴 **04 07:0x 重取号 + 覆盖复核（这一批五段正文的处置在此定下来，搬运时别再重新推）**：
现量 —— 主检出工作树末号已到 **218**（行首编号 **227** 行）、`git show HEAD:` 末号 **214** ⇒
**本节预留的 #181/#182 与下面那节的 #216/#217/#218 五个号全部被别人占了**（内容与本批五段无一重合）。
覆盖复核（⚠️ 第一次我用 `grep -c '\\[e\\]'` 读到"2 处"——**那是假的**：正则在临时转义层里被吞了，
换成 `grep -F` 之后两个 needle 都是 **0 命中**，这正好是本批新条 A 的同类事故，所以当场重测）：

| 待搬正文 | 台账既有覆盖 | 处置 |
|---|---|---|
| 本节第一条（`grep -F` 把 `[e]` 括号防护当字面量 ⇒ 占用探针两个方向同时错） | `grep -F 'grep -F'` **0**、`grep -F '[e]'` **0**，但既有 **#201**（已提交，HEAD 里 `grep -cE '^(201\|202)\. '` = 2）讲的就是"数别人的测试/构建是不是正在跑"的探针三种坏法，其坏法① 与这条同因 | **并入 #201 作面目④，不另立新号**（AGENTS §8 第 8 条：同类事故扩充原条） |
| 本节第二条（收尾脚本一句 `echo` 里的反引号把**正要清掉的那一趟又跑了一遍**） | `grep -n 反引号` 命中的是 **#92**，那是 JS **模板字符串**宿主、机制是定界符截断 ⇒ 宿主与机制都不同 | **保留为新条** |
| 下面那节的新条 A（组件注释里"jsdom 不触发 `toggle`"） | `grep -cE 'jsdom.*toggle\|宏任务'` = **0** | **保留为新条** |
| 下面那节的新条 B（`aspect-ratio` + `1fr` 自动最小 ⇒ 内容变高变列变宽） | `grep -cE 'aspect-ratio\|minmax\(0\|自动最小'` = **0 / 0 / 0** | **保留为新条** |
| 下面那节原"待入 #218"（占用探针自匹配） | 同上 **#201** 坏法① | **并入 #201**，增量见下面那节 |

⇒ 净结果：**五段正文里三段立新条、两段并成 #201 的追加面目**。
可复跑的复核命令（**载体：主检出工作树** `/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta`；搬运前再跑一次，号以那一刻为准）：
```bash
grep -Fn 'grep -F' docs/reference/environment-traps.md          # 04 07:0x：无输出、rc=1
grep -Fn '[e]' docs/reference/environment-traps.md              # 同上：无输出、rc=1
grep -cE 'aspect-ratio|minmax\(0|自动最小' …environment-traps.md # 0
grep -cE 'jsdom.*toggle|宏任务' …environment-traps.md            # 0
grep -cE 'pgrep|负载' …environment-traps.md                      # 12 ← 阳性对照，没有它上面四个 0 不算读数
```
（📌 这四条都带"必须有对照组"的性质：`grep -F` 对纯字面量、`grep -cE` 要先喂一个必然命中的 needle，
否则 0 分不清"没覆盖"和"探针没跑"——本节第一次读数就是这么假的。）


正文（可直接粘贴）：

> **181（取号见上面的现量命令）. 🔴 `grep -F` 会把手写的 `[e]` 自匹配防护当**字面量** —— 于是这条"有人在跑吗"的探针
> 匹配不到任何一次真运行，只匹配到**执行它的 shell 自己**。**
>
> `ps Axo command | grep -F 'verify-mobil[e]'` 是从正则世界的 `[e]` 技巧抄过来的，但 `-F` 是固定串：
> 模式变成字面量 `verify-mobil[e]`。真跑的脚本 argv 是 `bash scripts/verify-mobile-repeat.sh`，
> 里面没有方括号 ⇒ **永远 0**；而执行这条检查的那个 shell，命令行里原样带着带括号的文本 ⇒
> **空机器上稳定报 2**（它自己 + 那个 grep）。两个方向都错，且错的方式恰好是设备验收最要的两种方式：
> 把"别人在跑"读成"没人跑"（于是敢去 `pm clear` 共用 AVD），和把"没人在跑"读成"有人在跑"。
> ✅ 量法（2026-10-03 11:20，活的对照组）：起一个 argv 含 `verify-mobile-repeat-fixture` 的进程 ⇒
> 老探针 **0**、`pgrep -f 'verify-mobile-'` **命中该 pid**、清理后回 **0** 且**不含观察者**。
> 📌 一般规律：**括号自匹配防护只在正则模式里成立**；`-F`／`--fixed-strings` 下它把探针变成字面量匹配，
> 而任何"模式串写在命令行里"的探针都会数到自己 —— 要么换 `pgrep`（macOS 无 `-c`），
> 要么运行时拼模式（`p=$(printf 'verify-mobil%s' e)`）再 `grep -v grep`。**判这类探针之前，
> 先起一个 argv 里真的带着那串东西的活进程当对照组**；没有对照组的占用探针不算判据。

正文（可直接粘贴）· 第二条：

> **182（取号以搬运那一刻的现量为准，别照抄这里的号）. 🔴 收尾脚本里一句 echo 把**正要清掉的那一趟又跑了一遍** —— 反引号写在双引号里是命令替换：注释里不算，echo 里算。**
>
> 2026-10-03 15:01 实测：一条"把设备现场收干净"的命令执行到第 3 段那行 echo，
> `ps -o pid,ppid,lstart` 里出现 `bash w3-teardown.sh`(父) → `bash w3-iso.sh`(子, 15:01:47) → `qemu-system-aarch64 -avd …`，
> :3200 上同时多了一个 env 里带 `PORT=3200` 的 node 进程。
> 发现它**不是因为知道自己写了什么**，而是因为一条本该只打印几行说明的脚本**超过 120 秒没返回** ——
> 收尾脚本卡住本身就是"它做了没打算做的事"的信号。代价按这台机器的实际单位算：
> 多起一台模拟器 + 一个服务端，压的是别人那条**带时间判据**的设备验收（不是"浪费点电"）。
> ✅ 边界与修法：`#` 注释里的反引号不展开（注释不是可执行文本），**双引号里的会**；
> echo/字符串里要指代命令就裸写或用「」。写盘之后当场自查并证明它不再起任何东西：
> ```bash
> grep -n '"[`]' *.sh                                   # 零命中（exit 1）才算收干净
> bash w3-teardown.sh; pgrep -f 'bash w3-iso.sh'        # 空
> adb devices; lsof -nP -iTCP:3200 -sTCP:LISTEN -t      # 都空
> ```
> 📌 一般规律：**文档里的写法与 shell 里的写法共用同一套定界符，而两套语义完全不同** ——
> 台账里 JS 模板串那一条（注释里的反引号把模板截断）是同一族、宿主不同。
> bash 世界里同形还有 `$(…)`：写进双引号字符串前先问一句"这串会不会被执行"。
> ⚠️ 这条**不是新道理**，本仓库早就记过"双引号里的 pattern 含反引号会被命令替换 ⇒ 报『没有残留』其实 grep 没跑"；
> 这次不同的只有爆炸半径（从"漏测"变成"在共享机上多起一台模拟器"）。
> ⇒ **记在脑子里的规矩不算规矩，落在一条 grep 里的才算。**


---

## 4. L 系列 · 法务与落地页联动（**与功能同期做，不是事后补**）

产品负责人 2026-10-02 明确要求：**融入现有条款，不许孤立撰写**。实测这个要求由 `packages/legal` 的结构本身保证——条款之间是类型化的 `docRef`，`docId` 不在注册表里**测试直接判红**。所以 L 系列的形态是**改这六处既有位置**，每处**中英双份**：

| # | 改哪份现成文件的哪一节 | 为什么是"改"不是"加" |
|---|---|---|
| **L1** | `packages/legal/src/documents/permissions.ts` §逐项清单 | 🔴 那里现在写着「heyta **不申请**位置、通讯录、通话记录、短信、**照片**、麦克风、相机、健康、日历读写权限」。**能选照片的构建一出厂，这句就是假话** ⇒ L1 是 W7/D4 的**前置闸门**，不是收尾动作 |
| **L2** | `documents/third-parties.ts` §「我们没有接入的东西（逐项列出为否）」+ §「由 heyta 服务器发出的对外请求」 | 对象存储若启用，是从"否"**翻成"是"并挪到另一张表**，且该行形状要求带**依据**（如"命中 0"这种取证措辞）。定性照现成口径：存储商是**受托方**（不需单独同意但必须披露 + 合同附件） |
| **L3** | `documents/privacy.ts` §「数据到底存在哪、谁能看到」+ §「我们不做什么」 | 那里已有**三分口径**（本机明文／官方服务器内容密文＋元数据明文／自架服务器）⇒ 图片**嵌进这张表**即可，**不新写一段**。同时核 §我们不做什么 有没有与"上传内容"冲突的现成句子 |
| **L4** | `documents/personal-info-list.ts` 表 A / 表 C / 表 D / **表 E** | 一条图片要**同时动四张表**：A 加一类主动输入、C 加对象元数据（大小/时间/**校验和**）、D 或 C 视是否同步、E 重述那六行的依据并加限定③。**只改 E 就是孤立撰写** |
| **L5** | `documents/minors.ts` §「关于年龄核验」+ §「未成年人的数据在 heyta 里实际是什么样」 | 纪念照里有孩子是**主用例**；这份文件已经存在且被 `privacy`/`ai-and-transfer` 用 `docRef` 指过去 |
| **L6** | `documents/terms.ts` 的服务描述与变更历史表 | 该文件已有"版本 + 日期 + 改了什么"的历史表格式（英文列那条），新条款**必须登记进去**，否则等于偷偷改 |
| **L7** | 生成物 | 🔴 落地页文案是 `packages/legal` 的**生成物**（`check:legal-copy` = `gen-site-copy.mjs --check`）。**不许去落地页手改文案** —— 改真源、重跑生成、门禁保证不漂移。产品负责人说的"落地页还没准备好"，正确处置在这里 |
| **L8** | PIA（PIPL 第 55 条） | 全仓 `packages/legal` 搜「影响评估」**零命中** ⇒ 一份现在不存在的文件。**单独立项**，不塞进倒数日（见 §6） |

**时序（这是"同时做"的可执行版本）**：

- `L1 + L4 + L5` 必须在**第一个能选照片的构建之前**完成 —— 政策说谎的窗口就是"功能可用"与"条款更新"之间那段时间，而这段窗口是**产品负责人上一轮点名要消灭的东西**。
- `L2` 在对象存储后端选定之后、对外开放注册之前。
- `L3 + L6 + L7` 与 D4 同批，且 `L7` 是这三者唯一的"完成"判据（门禁红 = 没做完）。
- 倒数日**纯文字版（第一版）不触发 L1/L2/L4/L5**：它不申请任何权限、不上传任何内容 ⇒ 这条边界要写清，否则会把法务工作量错误地压到第一版的关键路径上。

**判据**：①`pnpm check:legal-copy` 与 `docRef` 测试能红（变异：把 `docId: 'minors'` 改成不存在的 id）；②双语成对——只改中文不改英文必须判红（若现有测试未覆盖这一条，**登记为缺口**而不是假设它存在）；③`permissions.ts` 那句否与 iOS `Info.plist` / Android manifest 的**实际权限项**对账——⚠️ **未证实是否已有这样的门禁**，`scripts/check-legal-host.mjs` 查的是什么要先读，没有就立一条。

---

## 5. 收尾（不可省略）

1. `pnpm -r typecheck && pnpm -r test`，然后**完整 `pnpm check`**。
   🔴 动过 `packages/legal` 就必须含 `pnpm check:legal-copy`（落地页文案是法务的生成物，见 L7）——它已在 `pnpm check` 里，但**改完法务不重跑生成就会红**。
2. `node research/tools/docs-link-check.mjs`。
3. 界面结论**必须有截图且人真的看过**（AGENTS §6.2 规定一）；验收**不抢前台**（规定二）。
4. `pnpm reinstall:all` —— 四端装上当前产物。🔴 门禁绿 + 打得出包 ≠ 装上了当前产物（AGENTS §6.1.1）。

---

## 6. 已知边界与后置

| 项 | 状态 |
|---|---|
| 素材图片背景（需客户端加密 + 可插拔存储后端） | 归 P2-9；**档位已定＝双档**（ADR-0044 §2.6），但**加密 blob 通道本身仍要单独设计** |
| 调休/补班 | ✅ 已纳入 **W4b**（运营录入 + 客户端拉取；自托管不提供该档） |
| **PIA（个人信息保护影响评估）** | 🔴 **全仓不存在**（`packages/legal` 搜「影响评估」零命中）。明文图片会把它变成必须；即便走加密档，委托处理腾讯云那一条也可能已经触发（PIPL 第 55 条第 3 项）。**这是独立于本功能的既存法务缺口，应单独立项，不要塞进倒数日** |
| 移动端与桌面壳的提醒投递 | 停批项，非本计划能解 |
| 世界节日 | `date-holidays` 数据许可 CC-BY-3.0，未过 §3.2 |
| 农历生日的确切民俗口径 | ✅ 已定（ADR-0044 §2.5：归一化到同名正月，闰月那年可选再过一次） |

---

## 7. 交给审计者的问题清单（**请逐条判"这条判据能不能红"**）

1. §2.1 的部署顺序，我的判据是"老服务端 + 新客户端必须响亮失败"——**这条会不会因为 §7 第 34 条修过的那套幂等逻辑而永远不触发**？
2. W1 的双源对账判据，如果 `holiday-cn` 某年缺数据，它是**红**还是**静默跳过**？静默跳过就是"一条永远通过的判据"（§7 元规则 2）。
3. W5 的 pin 变异能不能真的让排序测试变红，还是排序层被 UI 自己又实现了一遍？
4. W7 的"零网络请求"判据，Playwright 的请求计数有没有把 Service Worker 拦掉的那部分算进来（`project-e2e-probe-traps` 里那条 SW 接管后 `page.route` 收不到 `/api/*` 的同族坑）？
5. W8 我承认移动端 tab 会重复一次——**这个重复该不该被 `check:layering` 拦**，还是它本来就是合法的平台差异（AGENTS §3.5 那条"只允许一处平台差异"）？
6. D1 选 (a) 之后，`EVENT` 与 `TASK` 的**提醒**共用 `REMINDER` 实体（其 id 是 `taskId:triggerAt`）——这个 id 形状要不要改？改了会不会撞上 §3.3 的持久化字段纪律？
7. W4b 那条"服务端下发公共事实"，我给定性口径是「AGENTS §1 那句约束的是用户数据」——**这个口径会不会被后面的人拿去给别的东西开门**？如果是，判据该长什么样（比如门禁只允许 `days[]` 这一种形状走这条通道）？
8. §2.8 我断言"用户侧功能一项没少"，依据是 Apple ADP 的官方放弃清单。**请核**：heyta 有没有哪个**已经承诺过**的能力（落地页/隐私政策/帮助文档里）恰好落在那份清单里（服务端搜索、网页端直读、代客恢复）？如果有，加密档就不是"无取舍"，§2.8 要改。

---

## 8. 批次二落地计划（2026-10-03 15:41 起，逐项打勾）

> 📄 **交接（给全新会话的状态快照）**：[`countdown-batch2-handoff.md`](countdown-batch2-handoff.md) ——
> Goal 的完整范畴与逐项状态在其 §0.5，三条并行线的未提交清单在其 §2，合流时必须兑现的两条义务在其 §3。
> 本节（§8.2/§8.4）仍是**权威的范围与判据定义**；交接文档只记"停在哪"，不替代这里。

> **口径**：一项 = 一个提交 = 一条可复跑判据 + 一次变异验证（不能失败的检查没有价值，AGENTS §8.3）。
> 状态：⏹ 未开始 / ⏳ 进行中 / ✅ 已完成（完成时把该行改写成过去式并附**实际读数**，不写"已做"）。
> **调研基线**：`HEAD = 5bbca12d`，2026-10-03 15:38 由五个只读调研员分别核对 EVENT 实体面、界面与三端面、提醒面、
> AI 工具目录面、法务与调休通道面。下面每条结论都带 `file:line`，动手前逐条可复核。

### 8.0 先撤两条过期断言（这本身就是本仓库最贵的一类事故）

1. 🔴 **"全仓一个 `new Notification(` 都没有"是假的**，而且它同时活在三个地方：`AGENTS.md` §9 的 P2 行、
   `apps/web/src/App.tsx:998` 的注释、`apps/web/src/features/reminders/notify.ts:11` 的注释 ——
   而 `notify.ts:141` 就是那句注释所否证的代码本身（`new ctor!(labels.title, {...})`）。
   链路已在：`reminder-actions.ts:319 due()` → `apps/web/src/features/reminders/store.ts:154` →
   `use-reminder-notifications.ts:39,51-60` → `notify.ts:122-154` → `App.tsx:1000`；权限入口 `ReminderNotifyPanel.tsx:60-63`。
   ⇒ **W9 的起点比 §3 写的低**：web 投递不是零，缺的是"到点自醒 + 档位扩展 + DST 正确"。
   📌 一般规律：**注释里的"全仓没有 X"是断言，不是事实**，而它会比它描述的那个时代活得更久。
2. ⚠️ 我起草批次二目标时把 **W0 写成了"批次一遗留缺口"** —— 本文 §3 的 W0 是「把锚点弹层提到共享层」。
   遗留缺口（`/tmp/ui.xml` 固定名、`verify-mobile-repeat.sh` 硬印库名、待入台账两条）另立 **W0b**，不与 W0 混提交。

### 8.1 依赖顺序（反着做会白干）

```
W0 ────────────────┐
                   ├─> W5 ─> W7
W2 ─> W6 ──────────┤
 └──> W10          └─> W8（三端接线随 W5/W6 一起做，单独收尾）
W9（web 半，可与 W2 并行）
W4b ─> 新 ADR + 回写 ADR-0038 范围表
L'  ─> 随最后一个改变"对外承诺"的工单一起做
W0b ─> 随时可做（台账那半要等文件干净）
```

- 🔴 **W10 必须排在 W2 之后**：`scripts/gen-ai-capability-manifest.mjs:77-79,222-224` 在"实体未进 `EntityModelMap`
  而工具已登记"时会**当场红**（这是好事，说明它有牙齿）。
- 🔴 **W6/W5 必须排在 W2 之后**：`EVENT` 进 `packages/shared-schema/src/entity-types.ts:22` 之前，
  "一条没有截止日的倒数日能上日历"这件事**结构上不可能**。

### 8.2 逐项：范围 / 落点 / 判据 / 变异 / 勾

> 🔴 **执行顺序与工单编号不一致，这是决定的，不是漂移**（2026-10-03 18:2x 记）：
> 实际走的顺序是 W0 → W0b → W2 → W5（代码半 17:0x，e2e 半 18:5x）→ W10 → W9(web 半) → ‖W4b ‖W7 ‖W8 → **W6 / L 排最后**。
> ⚠️ 这一行 18:2x 初版写的是"W5(代码半)…→ **W6 / W8 / L 排最后**"，把 W8 一起排后了 —— **那条推断当场被否证**
> （详见 §8.4 的 W8 行）：撞车的判据是**同一文件的未提交 diff**，不是"某条线在忙"的印象。
> 理由是一条实测的**撞车面**，不是难度排序：开工前 `git status` 现量到主检出里
> ① 日历线正在整片重写（`packages/ui/src/calendar/model.ts`、`CalendarBoard.tsx`、新的 Day/Year 板、
> `apps/mobile/src/screens/CalendarScreen.tsx`），而 **W6 的落点就是这四件**；
> ② `packages/legal` 有 3 个文件正脏着，而 **L 系列只准改那六处现成位置**；
> ⚠️ **这条到 19:1x 被现量改写了**（不是推翻"要现量"，是这条记录自己过期了）：脏的是 **6 个**
> `privacy / minors / personal-info-list / data-rights / third-parties + tests/structure.spec.ts（+248 行）`，
> 但普查判定表**命中的那一份 `ai-and-transfer.ts` 恰好不在里面** ⇒ L' 不需要等那一片落地，已先做完
> （见下面 §8.2 的 L' 勾）。剩下的三份要改的对象经判定**都不必改**，所以"脏"这件事对 L' 的实际约束是零。
> ③ `docs/reference/environment-traps.md` 正脏着 ⇒ W0b 的第 ③ 条搬运转投单写者文档并登记"待入 traps #N"。
> 撞车的判据是**同一文件的未提交 diff**，不是"有人在忙"这种印象。
> 三条都留到那两片落地之后再做，且**做之前重新现量**（这条记录本身会过期）。

#### ✅ W0 · 锚点弹层的定位算术已提到共享层（2026-10-03 15:51，`7966857a`）

- **形状（已落地）**：纯函数 `placeAnchoredPanel(trigger, panel, viewport, {gap, edge}) → {top,left,placement}`
  在 `packages/ui/src/overlay/model.ts`；**测量与重算时机留在宿主** —— 因为
  `packages/ui/src/index.ts` 文件头明写这一层进不来任何 DOM 标签，而
  `AccountMenu.tsx:176-202` 那段的承重件恰恰是 DOM（`getBoundingClientRect` 与
  **捕获阶段 scroll**，`:199-202` 是修"面板停在原地"的那件）。
  CSS `apps/web/src/styles/app/rail.css`（`position:fixed` + `--ht-z-popover`）留在 web —— 属宿主。
  🔴 `gap`/`edge` **没有默认值**：默认值就是裸 px，而间距的唯一来源是 `tokens.css`。
- **读数**：
  - 新纯函数单测 **6 条**（`packages/ui/tests/overlay-place.spec.ts`），`@heyta/ui` 全量 **448 passed / 25 files**。
  - 变异：`roomAbove > roomBelow` 改成 `>=` ⇒ **恰好 1 条红**（"两侧相等留下方"）。
  - 注入验证（比原计划的"改回 absolute"更贴本次改动）：把翻转判据强制成"永远向下" ⇒
    e2e `account-menu.spec.ts` 的塌缩态用例红在 `面板应当在头像**上方**`
    （`bottom 557.25 > 419`）；还原后 **3 passed**。⇒ 证明真浏览器那条判据确实走的是共享算术。
  - 截图已看：`e2e/test-results/account-menu-{signed-out,signed-in,narrow}.png`
    （宽屏面板在头像下方、右边完整；窄屏向上弹、不盖住底部导航）。
  - `check:design` / `check:l4` / `check:layering` 各 **rc=0**。
  - `AccountMenu.tsx` 定位本体 **+11 / −16**（净减 5 行；15 行算术换成 8 行调用）。
- [x] W0 完成

#### 🟡 W0b · 批次一遗留的三条登记缺口（①② 已做：16 文件路径/库名旋钮，harness 22 绿 0 红；③ 转投单写者文档、待入 traps）

1. `/tmp/ui.xml` 固定名 ⇒ 并行两轮互相覆盖。闭合代价**每次现量**：
   `grep -rc '/tmp/ui.xml' scripts/lib/mobile-e2e.sh scripts/verify-mobile-*.sh | awk -F: '{s+=$2} END{print s}'`（2026-10-03 曾为 36）。
   方案：lib 里 `UI_XML="${HEYTA_E2E_UI_XML:-/tmp/ui.xml}"`，全部读写点走该变量；**默认值不变** ⇒ 单轮运行零行为变化。
2. `verify-mobile-repeat.sh` 抬头把库名硬印成 `heyta_mobile_smoke` ⇒ 改成打印真实 `HEYTA_E2E_DB`。
3. 「待入 §7 的两条」正文搬进 `docs/reference/environment-traps.md` + 把 #168 末尾待办改过去式。
   🔴 前置：`git status --porcelain -- docs/reference/environment-traps.md` 必须为空；取号以搬运那一刻的现量为准。
- **判据**：①`bash scripts/mutate-closeout-gates.sh` 全绿且夹具不碰真 `/tmp/ui.xml`；②跑一趟 repeat，抬头打印的库名与 `HEYTA_E2E_DB` 逐字相同；
  ③台账那一笔的 `git diff --numstat` 必须是"只插入、零删除"。
- [x] W0b ①② 完成（2026-10-03 18:13，`6598703b` @ 分支 `feat/countdown-batch2`）
  ① `UI_XML="${HEYTA_E2E_UI_XML:-/tmp/ui.xml}"` 与 `XY_PY="${HEYTA_E2E_XY_PY:-/tmp/_xy.py}"` 在
  `scripts/lib/mobile-e2e.sh` 定义并 `export`，lib 内 14 个可执行位点 + 9 个脚本各自的可执行位点全部走变量
  （shell 的 `grep` 与 python 的 `os.environ` **两边都改** —— 只改一半就是"半套现场"）。
  🔴 `_xy.py` 比快照更要命：它是 lib 每轮**重写再执行**的代码，两轮并发会执行到对方写了一半的那份。
  ② 6 个脚本横幅的库名改印 `$E2E_DB`；顺带查出 `verify-multi-end-sync.sh` 里 **4 条真 `psql`**
  用着 `-U rocalight -d heyta_mobile_smoke`（那不只是取证说谎，是换机器直接连不上），
  连同 lists/tags/conflict/task-edit/focus 的 7 条一起收进 `$E2E_DB` / `$E2E_DB_USER`。
  库名默认值有第二处住处（`mobile-e2e-up.sh:41`）⇒ 在 source 的那一刻**当场比对**，不一致 `exit 1` 并打出两个值。
  **读数**：`bash scripts/mutate-closeout-gates.sh` ⇒ **22 绿 / 0 红，rc=0**（新增 W 组四臂：
  W1 默认值逐字不变 / W2 旋钮生效 / W3 lib 非注释行零第三处字面量 / W4a-b 漂移守卫"一致放行 + 漂移拦下"两条腿，
  W3 带阳性对照）；`pnpm check:script-snapshot` ⇒ ✅ 28 个脚本 rc=0；`pnpm check:journey-coverage` ⇒ rc=0；
  16 个改动脚本 `bash -n` 全过。判据方法也升级了：U/V 两组以前把抽出的函数体 `sed` 成临时路径（**测的是副本**），
  现在经环境变量注入、函数体原样执行。
  **没闭合的三条（编号登记，不假装收口）**：
  ③ 台账那半仍未动 —— `docs/reference/environment-traps.md` 此刻仍被别的会话写脏，按前置条件不追加，
  待入 traps 号按搬运那一刻现量取；
  ④ `scripts/lib/mobile-e2e-fresh-account.sh:115` 仍有 `-U rocalight` —— 它是**建号/建库那一头**
  （被 `mobile-e2e-up.sh` source，而 up.sh 在 41 行才定库名），改它要先定"谁是库名所有者"，另立一条；
  ⑤ 两个在飞脚本（`verify-mobile-notes.sh` / `verify-mobile-aed.sh`，别的会话未提交）仍写死 `/tmp/ui.xml`，
  默认值没变所以不受影响，但要享受隔离得等它们自己走变量。
  **判据②那一趟真机 run 归入收尾**（用户指令：真机放到最后）。

#### ✅ W2 · `EVENT` 实体已落地（D1/D2 已拍；20/7/17/41/30 passed，存储三套适配与线协议零改动、未 bump schema）

- **省掉一整片工作的事实**：线协议**不枚举实体**（`shared-schema/src/supersync-http-contract.ts:145`
  是 `entityType: z.string().max(255)`）、服务端白名单**自动跟随**（`server/src/sync/services/validation.service.ts:25`
  `new Set(ENTITY_TYPES)`）、Prisma 的 `Operation.entityType` 是裸 String + 索引（`schema.prisma:159,182`）
  ⇒ **EVENT 不需要任何数据库迁移**；存储三套也不用改（`packages/storage/src/stores.ts:11`、
  `db-op-log-store.ts:299` 按 `[entityType,entityId]` 查、`sqlite-adapter.ts:272` 通用建表）。
- **落点**：`shared-schema/src/entity-types.ts:22`；`domain/src/entities.ts`（接口 + `EntityModelMap:459` +
  `MODELED_ENTITY_TYPES:486`）；**新建** `domain/src/events.ts`（排序/归档/下一次，照 `notes.ts:79` 三段排序）；
  `op-log/src/state.ts:63,67,82,353,380`；**新建** `app-host/src/event-actions.ts` + `index.ts` 导出；
  `packages/ui/src/sync/model.ts:489 ENTITY_LABEL_KEYS`；i18n 两张表各加 `common.entity.EVENT`（改完必 build，§7 #79）。
- **字段**（§3.3：一律可选 + 运行时默认）：`title`、`date: LocalDate`、`isLunar?`、`leapMonthPolicy?: 'first'|'last'|'both'`
  （D2 默认 `first`）、`recurrence?`、`pinnedAt?`（🔴 与"排在最前"**同一字段**，§2.4）、`archivedAt?`（🔴 独立标记，不碰 `deletedAt`，§2.5）、
  `icon?`、`color?`、`notes?`。
- **四条判据**：①老库回放不炸 —— 关键路径 `op-log/src/state.ts:313-315 deserializeMaterializedState`：
  **少一个桶就整体 `return undefined`** ⇒ 老库首次启动全量重放（`checkpoint.ts:30` 的 `formatVersion` 不 bump），这条要写成断言；
  ②🔴 §2.1 部署顺序落成可判检查：今天"老服务端 + 新客户端"的行为是 `INVALID_ENTITY_TYPE`（`validation.service.ts:111`）→
  `packages/sync-client/src/client.ts:59` **永久拒绝名单** → `:1053-1057 markRejected` → 出队**永不重传**，只剩 `console.warn`（`:794`）
  ⇒ 即"静默丢上云"。要响亮失败就得把"词表不认识"从"这条 op 本身坏"里分出来并上报成用户可见状态（`sync-wiring.ts:119`）。
  `schema-version.ts:44` 只管版本号 ⇒ **零现成挂点，必须新写**；
  ③op payload 里不得出现节假日数据（§2.2），变异 = 塞一年数据 ⇒ 红；
  ④`scripts/check-reachability.mjs:266 ACTION_FAMILIES` 加行，漏登记即红。
- **会红的门禁**：`domain/tests/entity-coverage.spec.ts:27,82`、`conflict-keys.spec.ts:60`、`ui/tests/sync-model.spec.ts:262`、
  `i18n/tests/catalog.spec.ts:19`、`check:reachability`、`check:layering`（`check-layering.mjs:131` 禁止 apps 里出现 `entityType: 'EVENT'`）。
- 🔴 **静默不管（必须人工勾）**：`check-materialized-reads.mjs:44 READ_PATTERNS` 硬编码 `.listTasks/.listProjects` ⇒
  新 `listEvents()` 的屏不订阅 `dataRevision` 也不红；`check-ai-coverage.mjs:27` 由 `AiFeature` 驱动；
  `check:op-log-semantics` 只锚 clientId 一行；`check:journey-coverage` 按端登记。
  ⇒ 本单顺手做一件把静默变成会红的事：**把 `listEvents` 加进 `READ_PATTERNS`**（并注入验证它能红）。
- **待决（写在提交信息里）**：`REMINDER` 的 id 是 `taskId:triggerAt`（`reminder-actions.ts:128`），倒数日共用它时 owner 键怎么算
  （本文 §7 第 6 条）。倾向：`REMINDER` 加可选 `eventId`、owner 取 `taskId ?? eventId`、**id 形状不变** ⇒ 纯可加、不动已发布数据。
- [x] W2 完成（2026-10-03 16:28 → 补一条 18:2x，`bb6c1203` + `05794dc5` @ 分支 `feat/countdown-batch2`，隔离 worktree `heyta-wt-batch2`）

  **实际落点与工单原文的差异（逐条，不是"照单做完"）**：
  - 加法链走的是 `ENTITY_TYPES` 加一项 ⇒ **存储三套适配一行没改**，线协议那侧也**没有改**：
    `entityType` 本来就是 `z.string().max(255)`，服务端白名单是 `new Set(ENTITY_TYPES)`。
    工单标题写的"存储三套适配 + 线协议契约"在这条路径上是**空集**，不是漏做 ——
    真实改动是 `op-log/src/state.ts` 的 `events` 桶 + `BUCKET_BY_ENTITY`（+9 行）。
  - 判据①（老库回放不炸）：`event-additive.spec.ts` **7 passed** 钉住"少一个桶就整体 `return undefined`"那条路径。
  - 判据②（部署顺序可判）：`client.ts:769-788` 把 `INVALID_ENTITY_TYPE` / `INVALID_SCHEMA_VERSION`
    从"这条 op 本身坏"里**按 errorCode 分出**，并给出唯一可行动的那句话（升级服务端 + 数据仍在本机），
    走的是既有的 `reason: 'upload-rejected'` 状态面（`client.ts:361,800`）。
    ⚠️ **没有**改"永久拒绝 → 出队永不重传"本身 —— 升级服务端之后要用户再点一次同步。这是刻意的边界。
  - 判据③（op 里不得有节假日数据）：本单的 op 形状里根本没有节假日字段，变异 = 塞一年数据的用例**不成立**，
    这条判据归到 W4b 的注入接缝上量。
  - 判据④（`check:reachability` 加行）：加了，且本提交**故意留红**（要求生产宿主调用点，那由 W5 提供）；
    W5 的 `apps/web/src/features/countdown/store.ts` 落地后 rc=0。
  - "顺手把静默变成会红"那件：`check-materialized-reads.mjs` 的 `READ_PATTERNS` 加了 `/\.listEvents\s*\(/`，
    三腿变异同趟跑完即还原：无订阅探针 → **rc=1 且回显命中的正是这条新模式**；
    同一屏补上 `dataRevision` → rc=0（25 个屏，**新行不是恒红**）；删探针 → rc=0（24 个屏 = 改前读数）。
  - 未 bump `CURRENT_SCHEMA_VERSION`；`CountdownEvent` 新字段全部可选 + 运行时默认（§3.3）。
  - ADR-0044「闰月生日逢闰过正」在 `domain/src/events.ts#lunarOccurrencesInYear` 实现并有单测钉住；
    `081b9c75` 给"both 档两个发生日"补了"下一次确实存在"的前提断言。

  **复跑读数**（2026-10-03 18:20，`heyta-wt-batch2`）：
  `domain/tests/events.spec.ts` **20 passed**、`op-log/tests/event-additive.spec.ts` **7 passed**、
  `app-host/tests/event-actions.spec.ts` **17 passed**、`sync-client/tests/sync.spec.ts` **41 passed**、
  `ai/tests/capability-manifest.spec.ts` **30 passed**。

#### ✅ W6 · `EVENT` 已成为日历的第二个事件源（`e2def90f` @ 本分支，04 02:5x；关闭判据现量归零后才落地）

> 🔴 **Goal 第④条的复核（04 14:3x 现量，两个检出各取一遍）**：当年那条「等六个日历路径的未提交 diff
> 归零后再落地」的关闭判据，逐条重取 ——
> ① **判据①（落地没有被 revert）载体必须写清**：在隔离检出（`feat/countdown-batch2` @ `9e98b69a`）
> `git merge-base --is-ancestor e2def90f HEAD` ⇒ **真**；在主检出（`main` @ `73b6df97`）⇒ **假**。
> 后者**不是缺陷**，是任务书第 2 条「不 merge 进 main」的直接后果 —— 我第一版把这条写成"主检出的读数"，
> 现量才发现两处的答案相反，所以这格的载体只能是本批分支。
> ② **判据②（当年挡路的那六个路径）现在两处都归零**：
> `git status --porcelain -- packages/ui/src/calendar apps/web/src/features/calendar apps/mobile/src/screens/CalendarScreen.tsx`
> 在隔离检出与主检出**各 0 行**（含未跟踪）。原句记的是「14 脏 + 4 个未跟踪」，那是 04 02:5x 的瞬时读数 ——
> 它当时的作用是"别在此刻造三方冲突"，不是"永远不许落地"；现在这条独立复量到 0，说明**落地时机已成立**。
> ③ 判据本体的读数由链 Y 那趟完整 `pnpm check`（含 `pnpm -r test`）代取 —— 在它取到之前，
> 这一格只主张「已落地 + 祖先关系在本批分支成立 + 六个路径归零」，**不主张**「当前 HEAD 上测试绿」。

- **事实**：唯一的按日聚合是 `packages/ui/src/calendar/model.ts#groupTasksByDueDate`，它
  `if (task.dueDate === undefined) continue;` —— 🔴 **没有截止时间的任务不上日历**，且注释自己承认这一点
  （所以宿主必须显示 `labels.footnote`）。消费者两处：`apps/web/src/features/calendar/CalendarView.tsx`
  与 `apps/mobile/src/screens/CalendarScreen.tsx`。
  ⚠️ **2026-10-03 20:2x 更正本条的坐标**：原文写的是 `model.ts:310,321,504-512` 与
  `CalendarView.tsx:39,164` / `CalendarScreen.tsx:44,337` —— 那组行号取自**当时脏着的工作树**，
  HEAD 的 `model.ts` 只有 **261 行**（`groupTasksByDueDate` 在 252–255），根本没有 310/504 这些行。
  ⇒ 从这一行起本单**按符号锚定，不按行号锚定**（同一文件的工作树版本此刻是 518 行，见下）。
  HEAD 里 `grep -c 'EVENT|CountdownEvent' model.ts` = **0**，他们工作树版本也还是 **0**
  ⇒ 这条线在忙的不是 EVENT，W6 没有被别人做掉。
- **判据**：一条**没有截止日**的倒数日能上日历（这就是它区别于 TASK 的可观测证据）；
  变异 = 把 EVENT 源接成"必须有 dueDate" ⇒ 红。另接进"今天"与收集箱（`App.tsx:723` 的 `refreshNow()` 是现成的"今天"重估点）。
- [x] W6 完成 —— ✅ **2026-10-04 02:5x 落地，提交 `e2def90f`（分支 `feat/countdown-batch2`，未 push 未 merge）**
  ⚠️ ~~**04 05:3x 这个勾上挂一条已知红（读这个勾的人先看这行）**~~
  ✅ **04 06:1x 那条红已经关闭**（机制见下面 R-1 那段，修法的读数在下面第 ⑨ 条末尾）：
  W6 给**侧栏**迷你月历的格子补了「休 / 班」那颗点
  （`apps/web/src/features/calendar/CalendarSidebar.tsx:177`），而 `e2e/tests/calendar-sidebar.spec.ts:111`
  那条"七列真的对齐"的几何判据量出**第 1 列列头与格子中心差 5.3px**（`--retries` 那次同值 ⇒ 不是抖动）。
  机制**还没定**（那颗点只有一个 2xs 的字，按宽度算撑不开 `repeat(7, 1fr)` 的 1/7；两副各自分配列宽的 grid
  要错位需要某一列被撑开），所以我照猜测改的一版 `minmax(0, 1fr)` **在没有浏览器可量时撤回了**。
  编号 **R-1**，取证与下一步在 §8.4 第 ⑨ 条。**这不推翻 W6 的功能闭环**（四个档位 + 侧栏都认得 `EVENT` 那五张图都看了），
  但它意味着"侧栏那一半"目前带一条未定的几何红 —— 别把这个勾读成"侧栏没有任何已知红"。
  ~~（这一句的状态到 04 05:5x 为止；红已按上面的机制修掉，读数见本节末尾与 §8.4 第 ⑨ 条。）~~
  🔴 **04 05:3x 把"那颗点撑开 grid track"这条猜测就地否证**（三条都是现量/可复算的算术，不是印象）：
  `--ht-font-size-2xs` = **11px**（`packages/design-system/src/tokens.css:220`），
  那颗点的文本就是 `common.calendar.dayMarker.off/work` 那两格、**各一个 CJK 字**（`packages/i18n/src/locales/zh-CN.ts:3812-3813`），
  所以它的最小宽 ≈ 11px；而失败那张截图里侧栏月历跨 ~184px ⇒ **一轨 ≈ 26px**，11px 撑不开 26px 的 track。
  活下来的两条候选：**① 一个"整行统一的位移"** —— 那条 spec 是 `forEach` + `expect`，**在第一列就抛**，
  所以"第 1 列差 5.3px"这句话**不能**读成"只有第 1 列差"；两副 grid 只要容器左右内边距/边框差一个常量，
  七列会同时偏同一个数。**② 字体后到** —— 那条 spec 没有等 fonts ready，并发下 webfont 到位更晚，
  数字用的是 `tabular-nums`，字形一到位整列宽度就重算。
  ⇒ 下一步的测量口径因此变了：安静复跑时要**把七列的位移全打出来**（统一 vs 局部一分就能排除①），
  而不是只拿第一个红。⚠️ 这件事要在**别人的 spec 外面**做（那条 spec 是日历线的，不改它）。
  🔴 **04 05:5x 机制已定，上面两条候选一起被同一趟探针否证**（一次性载体 `e2e/tests/r1-grid-probe.spec.ts`，
  真 Chromium + 真 vite dev，跑完即删；三腿 A/B：原样 / 隐藏那颗点 / 再隐藏那颗点本体）：

  | 腿 | 行网格算出来的轨道 | 容器 vs 内容宽 | 七列位移（列头 − 格子） |
  |---|---|---|---|
  | A 原样 | **`37.5px ×7`** | `clientWidth 189` / `scrollWidth 263` | `−5.25, −15.75, −26.25, −36.75, −47.25, −57.75, −68.25` |
  | B 只隐藏「休/班」 | `27px ×7` | `189 / 189` | **七列全 0** |
  | C 再隐藏那颗点 | `27px ×7` | `189 / 189` | 七列全 0 |

  - **不是①"统一位移"**：位移是**逐列放大**的（5.25→68.25），这正是"两副 grid 各自算轨宽、
    行那副的轨道更宽"的形状；而两副容器的 `left`/`padding` 实测**逐字相同**（都 89 / 0）。
  - **不是②"字体后到"**：这趟在安静窗口里跑（锁是我自己的，无并发），一次成像；且 B 腿只把那颗点
    `display:none` 就归零 —— 字体没变过。
  - **真机制是高度绕到宽度**：`.ht-sidebar__day` 有 `aspect-ratio: 1`（出自 `2989c717` 那次 CSS 拆分，
    不是本批写的），它让格子的**宽度跟着高度走**；W6 给格子加了第三行 ⇒ 内容高 37.5px ⇒
    格子的最小宽也变成 37.5px ⇒ 而 grid 项的默认 `min-width: auto` **允许轨道被内容撑开** ⇒
    行那副算出 `37.5px ×7 = 263px`，容器只有 189px。
    ⇒ 我 05:3x 那条"11px 撑不开 26px 的 track"**否证否错了对象**：撑开轨道的不是那颗点的**宽度**，
    是它的**高度**经 `aspect-ratio` 换算出来的宽度。这条算术当时看着无懈可击，因为它算的是错的那一维。
  - **缺陷比判据说的更大**：不只是列头对不齐，是**整张迷你月历横向溢出侧栏一列**（263 > 189，
    右边约两列画在列外）。那条 spec 的判据③（"格子都在侧栏那一列的宽度内"）本来量的是同一件事，
    只是 `forEach` 在①就先抛了。
  - **修法**（三处，都在本单自己的落点里，没动日历线那条 spec）：
    ① `sidebar.css:308` 两副 grid 都改 `repeat(7, minmax(0, 1fr))` —— 轨道只由容器宽决定，与内容无关，
    这才是"列头与格子必须对齐"想要的形状；② `.ht-sidebar__day` **删 `aspect-ratio: 1`**
    （留着它，`minmax(0,1fr)` 只会把溢出从横向翻成纵向：宽 27 而内容高 37.5）；
    ③ 那颗「休/班」从"另起一行"改成与状态点**共用同一行**（`CalendarSidebar.tsx` 的
    `.ht-sidebar__day-dots` 容器内），并把该容器的 `block-size` 放宽成 `min-block-size` ——
    这一槽每天都存在，让"有没有那颗点"决定不了格子高度，六周才不会因为有的周有班、有的周没班而长短不齐。
    宽度算术在**最窄档**也成立：`--ht-layout-sidebar-min-width` = 192px ⇒ 一轨 27px，
    而 `点 8 + gap 4 + 休 11 = 23px`。
  - **移动壳没有同一形状**（省得下一个人去找）：`grep -rn "aspectRatio" apps/mobile/src` 命中 **0**，
    而 `apps/mobile/src/screens/CalendarScreen.tsx` 里 `grep -rn "mini\|MiniMonth\|sidebar"` 也命中 **0**
    —— 移动侧走的是共享 `CalendarBoard`（它的格子没有"宽跟高走"的耦合），web 侧这条侧栏迷你月历是**独一份**。
  - **代价**：W6 判据①"侧栏那颗点"的**版面变了**（同而不是在下），那批截图作为证据已过期 ⇒
    重拍重看，读数见 §8.4 第 ⑨ 条。
  - ✅ **修法读数（04 06:0x–06:1x，载体 = 本分支工作树，锁是我自己原子拿的、拿锁后确认无别的 playwright）**：    `pnpm --filter @heyta/web typecheck` **`RC_TYPECHECK_WEB=0`**；
    `check:design` / `check:l4` / `check:ui-language` 三道**各自 rc=0**（后者现量：扫 317 文件、418 处文案、词条 zh/en 各 3023）；
    真浏览器那条**报过红的同一判据** `e2e/tests/calendar-sidebar.spec.ts:111` **`RC_E2E_SIDEBAR=0`、`2 passed (6.9s)`**
    —— 这就是它的 A/B：同一台机器、同一份 spec，05:47 那趟 `✘ 1 … 差 5.3px`，修完这趟两条全过，
    **判据的牙不需要另外证**（它刚刚自己红过一次）；
    jsdom 侧 `apps/web/tests/{calendar-sidebar,due-date-edit}.spec.tsx` **`RC_JSDOM=0` / `Test Files 2 passed`**。
    两张图**人已打开看过**（`e2e/test-results/calendar-sidebar-mini.png` 与 `…-sidebar.png`；
    🔴 04 14:5x 起这两枚已搬进版本库 `apps/web/evidence/countdown-calendar/`，md5 与"哪一趟"记在同目录
    `README.md` 末尾那节 —— 原来那个位置是临时目录，任何一趟 e2e 都会重写它）：
    七列在列头下面逐列对齐、没有一列画到侧栏外；`休`（绿）在 1–4 与 5–7、`班`（橙）在 10；
    今天那一格是"一颗蓝点 + 休"**同一行**；主区月历那一侧的标记与周号（40 周…45 周）没被动过。
    ⚠️ 图里侧栏左缘压着一小块灰色"日历 12"提示框 —— 那是 rail 图标的 hover 提示被同一趟截图抓进去的，
    不是布局缺陷（判据没量它，我也不把它读成问题）。
  主检出里本单落点的未提交 diff（`git diff --numstat`）：
  `packages/ui/src/calendar/model.ts` **+264/−7**（261 → 518 行，其中一处插入是 `@@ -162,3 +181,169 @@`
  = 一次 166 行的插入，正压在 W6 要改的那段聚合逻辑的下游）、`CalendarBoard.tsx` +107/−33、
  `date-text.ts` +74/−1、`CalendarToolbar.tsx` +56/−9、`CalendarScreen.tsx` +153/−3、
  `apps/web/src/features/calendar/{CalendarView 26/0, store 33/16, CalendarHeaderToolbar 17/7, useCalendarLabels 24/2}`。
  ⇒ 现在在 batch2 里做 W6 = 在一个**即将整片重写**的文件上造第二份改动，合流时没人能干净三方合并；
  而 W4b 已经确认"休/班"的自然落点是共享 `CalendarBoard` 的 `DayCell` 上的一个
  **默认值等于原值的可选 prop（`dayMarker?`）** ⇒ **W6 落地时必须复用那条缝，不要另开一个注入点**。
  **关闭判据（何时可以动）**：`git status --porcelain -- packages/ui/src/calendar apps/web/src/features/calendar apps/mobile/src/screens/CalendarScreen.tsx` 输出为空
  （他们的 +264 那批已提交并进了我要基于的那条线）—— 每次引用本条都要重跑这一行，别信这段文字。

  > ⚠️ **上面那两段"仍是撞车面"的读数已经过期，是被合流关掉的，不是被等掉的。**
  > 2026-10-04 01:5x 把 `main` 合进批次二（`608fa5b1`，16 处冲突全按并集解）之后，
  > 日/年视图与拖拽那批**进了我基于的那条线**，关闭判据当场成立 ⇒ 02:2x 起在合并基上落地。
  > 留原文是为了让后来者看清"撞车的判据是同一文件的未提交 diff，不是某条线在忙的印象"这句怎么兑现的。

  **落了什么（过去式读数，载体 = `feat/countdown-batch2` @ `e2def90f`）**：

  · **判断的归属**：哪些天真的发生 = `@heyta/domain` 新增 `eventOccurrencesInRange`
    （一次性 / 重复规则 / 农历含闰月三档；非法规则与越界日期**返回空而不是抛**，
    与 `occurrencesInRange` 同一条纪律）；摆进哪一格、超出 3 条怎么折成 `+N`、
    那一行怎么写 = `@heyta/ui` 的 `groupEventsByOccurrence` / `calendarEventBarTitle` /
    `calendarCellBars`；宿主只交数据（web `CalendarView`、mobile `CalendarScreen` 各一处），
    **两端都没有一行日期算术**。
  · 🔴 **四个档位逐个接上**（不只是月格）：月/周格子里那条、点进去"选中那天的清单"那行、
    日档「全天」带那一行、年档 12 张卡里那颗点，外加**侧栏那份迷你月历**那颗点。
    后四处是本轮当场抓出来并补掉的同形状缺陷 —— 只接月档的症状是"切个档那条日子就凭空消失"，
    而共享层的测试仍然全绿（它测的是那块板**支持**，不是这一屏**画了**）。
  · **三层判据**：`packages/ui/tests/calendar-event-source.spec.ts` **14 passed**（node，含年区间两端
    与"别的月份也看得见"那两条）、`apps/web/tests/calendar-event-source.spec.tsx` **8 passed**
    （jsdom 挂真 `App`、写真 op、看 DOM）、`apps/mobile/tests/calendar-event-source.spec.ts` **13 passed**
    （真 harness：真 op-log + `:memory:` SQLite + 真 app-host）、
    `packages/domain/tests/event-occurrences-in-range.spec.ts` **8 passed**、
    `e2e/tests/countdown-calendar.spec.ts` **3 passed**（真浏览器，五张图人逐张看过，
    读数在 `apps/web/evidence/countdown-calendar/README.md`）。
  · **门禁仍然在基线**：`check:design` / `check:l4` / `check:row-single-source` /
    `check:ui-language` / `check:layering` / `check:empty-state` / `check:rn-aria` /
    `check:calendar` / `check:tokens` / `check:materialized-reads` / `check:reachability` **十一条全 rc=0**；
    `pnpm --filter @heyta/{ui,web} typecheck` rc=0。
  · **变异臂 5 条，逐臂报红且只红自己那条**：日档不接 ⇒ 1 红 / 年档不接 ⇒ 1 红 /
    当天清单不画 ⇒ 1 红 / 侧栏不认 ⇒ 1 红（它的反向腿"隔壁那天不许有"仍然绿，正是要的样子）/
    年区间缩成一个月 ⇒ 2 红。注入→跑→逐字节还原，三个被改文件 sha256 回到基线。
  · **截图这条差点是空的**：第一趟 `year-dot.png` 拍的是整屏，而 11 月那张卡在视口外 ——
    图里一个点都没有、DOM 断言全绿。已改成截图前滚进视口并**量**它真在视口里
    （`boundingBox().y ∈ [0, 视口高]`）。与 §7 第 82 条同族：**图里有那个东西**才是证据。
  · ⏹ **W6-G1（登记，不是漏做）**：判据原文还有一句"另接进『今天』与收集箱"。**没做，理由是量出来的**：
    那两个面吃的是共享 `TaskList`，而它的一行自带**勾选完成 / 点开详情**两个语义
    （`onToggleTask` / `onOpenTask`）。`CountdownEvent` 既没有 `completedAt` 也不该有 ——
    塞进去要么伪造一个任务字段（那条 op 会写进任务通道，违反 §3.4"一个用户意图 = 一个 op"），
    要么在共享层为一种实体发明第三种行形状（所有列表消费者一起承担）。
    真要接，前置是"`TaskList` 支持不可交互行"这条**契约变更**，它不属于倒数日这一批。
    界面上的替代已经成立：倒数日在日历四个档位 + 侧栏都看得见，动作在「我的 → 倒数纪念日」面板里做。

#### ✅ W5 · 卡片网格 + 类型筛选 + pin + `⋯` 二级操作 + 归档视图

- **事实**：最接近的现成品 `packages/ui/src/notes/NotesBoard.tsx:71-110`（pin/unpin）、
  `packages/ui/src/trash/TrashBoard.tsx:48,63`（归档视图）、`packages/ui/src/material/material-surface.ts:38 materialTier`；
  全仓 `onContextMenu`/`onLongPress` **零命中** ⇒ 二级操作面从 0 建，且依赖 W0 的弹层。
  类型档位：纪念日 / 倒数日 / 生日 / 节日 —— 🔴 **不含"节假日"**（§0）。
- **样式第一版只有预置模板**（§2.3）；图标给图标不给含义（§2.6）；"已经 N 天"不飘红不审判（§2.7）。
- **判据**：①pin 变异 = 加第二个排序字段 ⇒ 红（§2.4）；②归档变异 = 实现成改 `deletedAt` ⇒ 红（§2.5）；
  ③排序三段（钉选 → 时间 → **id 字典序兜底**），缺第三段就注入"同一毫秒两条"用例；
  ④门禁：`check:design`、`check:l4`（内联只减不增）、`check:row-single-source`（🔴 `HT_FAMILY_BASELINE = 28`，
  新增 `ht-countdown__*` 一族必须同时消掉一族才能净增为零）、`check:text-color`、`check:ui-language`；
  ⑤界面结论有截图且人真的看过，主蓝数得出（§7 #82/#83）。
- [x] W5 完成（2026-10-03 17:0x 代码半 `a9529a59` → 18:5x e2e 半 `94760c82` + `c07df677` @ 分支 `feat/countdown-batch2`）

  **做了什么**：`packages/ui/src/countdown/{model.ts,EventBoard.tsx}`（卡片形状、两副面孔的措辞档位、
  筛选档位、**按行切**的网格 `toEventRows`、`⋯` 卡内展开式二级操作）+ `packages/app-host` 的 `patchEvent`
  （一次保存 = **一条** op；"每年"→RRULE 的翻译住在 app-host 而不是界面）+ `apps/web/src/features/countdown/`
  （store 是 web 端唯一一处 `createEventActions(...)` ⇒ 顺带关掉 W2 故意留的 reachability 红）。
  顺序**一次都不在视图里 sort**，全部取自 `@heyta/domain#sortEventsForDisplay`。

  **三条与工单原文不同的取舍（登记，不是漏做）**：
  1. `⋯` 用**卡内展开**而不是 W0 的锚点浮层 —— `packages/ui` 进不来 DOM 标签，浮层的测量/层级/点外部关闭/
     焦点陷阱四端各写一套的代价 `AccountMenu` 那条线已付过一次。
  2. **图标这一版不画**：`CountdownEvent.icon` 字段已在（可写可同步），但词表与字形映射住在 habits 那侧，
     抄一份必漂 ⇒ 编号 **W5-a** 登记为缺口。
  3. 空态走共享 `EmptyState`，宿主侧构造文案落进 `check:empty-state` 登记表并写明来历（真 +1，不是搬家）。
  4. 模块 `defaultOn: false` —— "关掉的模块不进 DOM" ⇒ 现有 tab 计数判据不受影响。

  **判据读数**：`apps/web/tests/countdown-board.spec.tsx` **12 passed / 0 failed**（e2e 那半照出缺陷后
  新增 ②b，从 11 条变 12 条）；
  12 例变异复现 **0 条未证伪**；`check:design` / `l4` / `layering` / `ui-language` / `reachability` /
  `row-single-source` / `text-color` / `empty-state` / `ui-provider` 全部 rc=0；
  摘掉 `check:empty-state` 那行登记 → rc=1 并点名本文件（**这条登记是承重的**）。
  判据①②③（pin 单一字段 / 归档不碰 `deletedAt` / 排序三段带 id 兜底）都在那 12 例变异里。

- [x] W5 判据⑤（真浏览器 + 截图 + 人真的看）闭合（2026-10-03 18:5x，`c07df677`）

  **读数**：`cd e2e && npx playwright test tests/countdown.spec.ts` → **6 passed / 0 failed**；
  与被它改动的共享断言一起跑 `countdown + motivation + smoke` → **15 passed / 0 failed**（rc=0）。
  三张图**都打开看了**（§6.2 规定一第 4 条）：`test-results/countdown-empty.png`（空态两块文案）、
  `countdown-board.png`（1280px 两列 + 一张未来一张逾期）、`countdown-archived.png`（归档视图没有输入行、
  二级操作里确实没有"编辑/归档"）。

  🔴 **04 14:5x 补：那三张当时只躺在 `e2e/test-results/`（临时目录，任何一趟 e2e 都会重写）⇒ 已搬进
  [`apps/web/evidence/countdown-cards/`](../../apps/web/evidence/countdown-cards/README.md)**（带 md5 与"哪一趟"）。
  搬的时候逐张复核，其中 `countdown-board.png` 人**又打开看了一遍**：两张卡真的并排、
  左「甲日子 · 还有 28 天 · 11月1日 星期日」右「乙日子 · 已经 32 天 · 9月2日 星期三」——
  与上面那句"一张未来一张逾期"逐字对得上（跑的那天是 10-04）。
  ⚠️ 同一趟查出**一条会自己吃掉证据的用例形状，登记为 W5-G1**：`countdown.spec.ts` 的 `:102`
  （点出一条之后，屏上**一张**卡）与 `:191`（1280px **两列**）**写同一个文件名**
  `test-results/countdown-board.png` ⇒ 后跑的覆盖先跑的，盘上永远只剩两列那张。
  也就是说"点出一条之后长什么样"那张**从来没有常驻过**，而台账里"三张图"这句一直把它算在内。
  本批不改（改判据文件与链 Y 那趟完整 `pnpm check` 抢同一批用例，见 §6.2 与"串行跑重验证"那条纪律），
  修法方向写在证据 README：**两条用例各写自己的文件名**，不是给路径加时间戳。

  🔴 **看图照出一个真缺陷，而 15 条断言全绿**：逾期那张卡**整行日期没画**。根因在共享层 ——
  一次性且已过去的倒数日没有"下一次"（`EventCard.nextDate` 是 `undefined`），卡片原来写的是
  `nextDate !== undefined ? <Text>…</Text> : null`，于是界面上只剩「已经 31 天」，
  用户**没法核对这张卡记的到底是哪天** —— 而那一天是它唯一的事实。修成落回锚点
  （`card.nextDate ?? card.anchorDate`），钉在 `94760c82`。
  ⚠️ 这条与 §7 第 82 条是**同族但不是同一件事**：82 是"非空白挡不住错误屏"，这里是
  **"断言只验界面写了什么，不验界面少了什么"** —— 12 条 jsdom 断言 + 6 条 e2e 断言里没有一条
  想到要问"逾期那张的日期行呢"，所以它只能被**看图**照出来。可迁移的做法：给"每一张卡都有的那一行"
  写一条**存在性**判据，而不是只给"我以为会有的那几行"写内容判据。

  **新判据能不能失败（变异复现，两腿各一次）**：把 `EventBoard.tsx` 的渲染退回修复前那个三元形状 ⇒
  ① jsdom `1 failed | 11 passed`，红的正是 `②b 🔴 过期那张仍然说得出"是哪一天"`；
  ② e2e `rc=1`，红在 `countdown.spec.ts:170 › 1280px 下两列` —— 形态是
  `waiting for locator('[data-testid^="event-card-"]').nth(1).locator('[data-testid^="event-date-"]')`
  等满 60s 超时，**retry #1 同样红**（不是负载型 flake）。还原后源文件**字节相同**、复绿 12 passed。
  ⚠️ e2e 那条红的形态是超时而不是我写的那句中文消息（`locator.textContent()` 会自己等元素），
  读数能用、定位够用，但下次要更响的话先 `toHaveCount(1)` 再读文本。

  **现场隔离（这是本轮唯一一次撞到别人的进程）**：4318/4319 当时被另一个会话的 `check:ai-e2e`
  占着，`reuseExistingServer: false` 撞上就是 `already used`。没有杀别人的进程，而是临时复制一份
  配置把端口换成 4418/4419（假端点还要额外传 `env: { STUB_PORT: '4419' }`，否则它自己 EADDRINUSE），
  跑完删掉。**不留这个副本**：整份配置抄第二份必漂。复跑配方就那两行差异，需要时现搭。

  🔴 **有一条"挂到 W5"的账没在这里平掉，登记成 W4-UI**：§3.5 第 4 条把 W4 判据② 的界面半段
  （"数据只到 2026 时，2027 显示节、不显示休/班"）写成"随 W5"。这句在 W5 收尾时**现量否证过一次**：
  `packages/domain/src/holidays.ts:108 adjustmentOn` 与 `festivalsOn` 在**任何界面里都没有消费者**
  （全仓 grep 只命中 `domain` 自己 + 它的测试 ⇒ 日历面根本没读这两个函数）。
  ⚠️ **23:0x 起这句只剩一半成立**（原文留着，因为它记录了"当初挂错工单"这件事本身）：
  `adjustmentOn` 现在**有真消费者了** —— web 日历经 `CalendarBoard` 的 `dayMarker?` 读它并画出「休 / 班」
  （`67fef701`，判据①三档 e2e 已跑过）。**`festivalsOn` 仍然零消费者** ⇒ "2027 显示节"那一半
  照旧挂在 W6 / W8，等日历那片文件不再被并行会话整片重写时随同一条缝补齐。
  倒数日卡片面本来就不画休/班（那是日历那一屏的事），所以这条**不是 W5 漏做，是当初挂错了工单**，
  改挂 **W6 / W8**（日历第二源 + 三端接线）—— 而那两个落点正是并行会话在整片重写的
  `packages/ui/src/calendar/*`，所以它现在**做不了**，不是不想做。

#### 🟡 W7 · 纪念卡片导出为成品图（**web 半 + Android 设备出图到最终态；iOS 设备读数在排队**）

- **事实**：`react-native-svg@15.15.5` **已在依赖树**（`apps/mobile/package.json:38`、`packages/ui/package.json:28,37`、
  `apps/mobile/ios/Podfile.lock:2628,3026` 已 pod 已链接、`packages/ui/src/icon/Icon.tsx:47,85` 真在用）
  ⇒ **不需要新过 §3.1/§3.2 两道门**。~~缺的是**栅格化**（全仓无 `toDataURL`/`toBlob`/`react-native-view-shot`/Skia）~~
  现成"渲染成图"的产品通道只有 `apps/web/src/features/settings/avatar-encode.ts`（canvas→data URL，
  文件头明写"画布属平台能力、三端各不同"）与 macOS `WKWebView.takeSnapshot`（`HeytaMacApp.swift:181,210`，目前只在验收里用）。
  > ⚠️ **上面划掉那半句在 2026-10-03 23:1x 被现量否证，留着是为了让人看清错在哪。**
  > "全仓没有一处 `toDataURL` 调用"是真的，从它推不出"缺栅格化"：
  > **已装的 `react-native-svg@15.15.5` 自带三端栅格化出口**，我自己复核过原生那份（不是只对着 `elements.web.js` 下的结论）——
  > `node_modules/.pnpm/react-native-svg@15.15.5_*/node_modules/react-native-svg/lib/commonjs/elements/Svg.js` 里 `toDataURL` 在。
  > **真正缺的是"把字节交出去"那一环**：移动端全部原生方法只有 6 条，其中唯一的文件操作是
  > `LocalFsModule.kt:40 readTextUri` —— **只有一个"读"，没有任何"写"**；RN 核心 0.84 也没有 `FileSystem`/`CameraRoll`；
  > `Share` 的 `url` 分支要**真实文件 URI**，`message` 分支只能传文本 ⇒ base64 无路可去。
  > 两端还有一个**尺寸口径不一致**的真坑：Android `SvgView.java:365` 用**像素**建 bitmap（⇒ 逐字等于契约），
  > iOS `UIGraphicsImageRenderer -initWithSize:` 的默认 scale **是屏幕 scale**、`bounds.size` 是 **point**（⇒ 3× 真机导出 3240×4320）。
  > 完整取证（含可复跑命令 [F6]/[F5]/[C]）在 `feat/countdown-w7` 分支的 `docs/plans/countdown-w7-device-export.md` 第二节 ——
  > 那份**住在 `feat/countdown-w7` 上、尚未进 main**，所以这里只点名不给链接（给了就是死链）。
- **判据**：导出全程**零网络请求** —— 复用 `e2e/tests/privacy-consent-zero-egress.spec.ts:79-95`
  （`page.on('request')` 分类器 + `page.on('websocket')`；`:16-30` 那条"零必须有非零正向对照"是承重的）
  与 `e2e/tests/inbox.spec.ts:231-234`（按 method+url 数）。
  ⚠️ 本文 §7 第 4 条要在这一单回答：Service Worker 拦掉的那部分算不算零 ⇒ 判据按"浏览器真发出去的"算，不按页面 `fetch` 调用数算。
- 🔴 移动端渲染通道**未取证**：开工前先验 RN 能不能出图；不能就把移动端登记成**已知缺口（带编号）**，不静默降级。
  - ✅ **04 03:1x 现量：取证已完成，"未取证"这句就地过期。** 移动端出图不是缺口：
    `pnpm --filter @heyta/mobile exec vitest run tests/card-export.spec.ts` ⇒ **21 passed / `MOBILE_RC=0`**；
    真浏览器那一趟 `cd e2e && pnpm exec playwright test tests/countdown-export.spec.ts` ⇒ **5 passed / `EXPORT_E2E_RC=0`**
    （五条腿分别钉：尺子自检 / 闸门放行后两支计数器各 +1 的正向对照 / 导出这一趟零出站且**字节尺寸逐字等于契约** /
    暗色 token 跟着走 / 导不出来必须上屏且"也没发出任何请求"由计数器核）。
    成品图实测 **1080×1440**，与 `EXPORT_CARD_EDGE_PX × EXPORT_CARD_HEIGHT_PX` 一致，
    而契约是**从 `packages/shared-schema/dist` 读回来的**，不在测试里重推导那条公式。
  - ✅ **"零法务变更"这条现在量得了，而且它是承重的**：
    `node scripts/check-legal-permissions.mjs` 的读数行写着 Android 声明面 =
    `[INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM]`、`NS…UsageDescription` 1 条 ——
    **一条照片/存储权限都没有**。W7 往 manifest 加的是 `<provider android:name="androidx.core.content.FileProvider">`
    （`git diff 43e94b32^1 43e94b32 -- apps/mobile/android/app/src/main/AndroidManifest.xml` 里
    **零个 `<uses-permission>`**），落盘走 `reactApplicationContext.cacheDir` + `FileProvider` 临时授权，
    iOS 侧写沙盒、**刻意不走 `PHPhotoLibrary`**（两处源码注释各自点名了那句对外承诺）。
    ⇒ `packages/legal/src/documents/permissions.ts` 那句"heyta 不申请 … **照片** … 权限"**逐字仍为真**。
    ⚠️ 同一条门禁**整体是 rc=1**，但红的是 W9 那半的**通知**那六句，与照片无关、与本单无关
    （逐条取证与归属见上面 W9 节那条 04 03:0x 的更正）。
  - ✅ **"零法务变更"重取现量（04 06:3x @ 载体 `895ad07c`，Goal 范畴②点名要的这一条）**——这次不走门禁的
    读数行单独证一遍，因为那条门禁整体 `rc=1`，"它没报照片"容易被读成"它没看"：
    ①`AndroidManifest.xml` 全文 `<uses-permission>` 现量 **3 条**
    （`INTERNET` / `POST_NOTIFICATIONS` / `SCHEDULE_EXACT_ALARM`），`grep -icE "READ_MEDIA|WRITE_EXTERNAL|READ_EXTERNAL"` = **0**；
    ②W7 那一笔对 manifest 的 `+` 行里**只有 `<provider>` 与 `<meta-data>`，零个 `<uses-permission>`**
    （`git diff 43e94b32^1 43e94b32 -- …/AndroidManifest.xml`）；
    ③iOS `Info.plist` 的 `NSPhotoLibrary*` 命中 **0**，出图写 `FileManager.default.temporaryDirectory`
    （`HeytaCardExportModule.swift:67`），全仓 iOS 侧对 `PHPhotoLibrary` 的引用只出现在**注释里那句"刻意不走"**；
    ④同一条门禁自己的读数行此刻打印 `Android 声明 3 条 [INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM]、
    NS…UsageDescription 1 条` ⇒ **①②③④ 四路同向**。
    ⇒ `permissions.ts:37` 那句"heyta 不申请位置、通讯录、通话记录、短信、**照片**、麦克风、相机、健康、
    日历读写权限"**逐字仍为真**；那 7 条红逐条读过来，**没有一条提到照片**（全是通知那六句 + 一条
    `SCHEDULE_EXACT_ALARM` 未进登记表，都属 W9 那半）。**本批不改 `packages/legal`**（§8.2 L' 第 1 条的归属裁决不变）。
  - 📌 顺带修掉一条**证据存放**的缺陷：这条 e2e 原来把成品图写进 `/tmp/heyta-card-export-results/`，
    而 Goal 要求"界面结论截图且人真的看过"——落在 `/tmp` 的图下一趟就没人能复查了。
    现在写进版本库 `apps/web/evidence/countdown-export/`（含 `README.md` 逐张写"看见了什么"）。
    ⚠️ 那条"不要落 `test-results/`，它每趟被 Playwright 清空"的理由**仍然成立**，换目录换的是"版本库"不是"test-results"。
  - 📌 看图看出的两件事（断言一条都没报）：① 两张成品图里那条竖条**不是主蓝**，这是设计而不是缺陷 ——
    `packages/ui/src/countdown/EventBoard.tsx:641` 在 `card.template === undefined` 时故意用 `color.surface-sunken`；
    但这也意味着**本批的出图证据里没有一张是"选了模板"的卡**（分类色那条路径只有 `category-model.spec.ts` 钉着，没有出图级证据）。
    ② 「还有 28 天」与「11月1日」互相自洽（今天 10-04）——这是"数字与日期是不是同一次算出来的"的免费交叉验证。
  - ✅ **04 04:2x–04:3x 两臂变异跑完**，装置已落版本库 `research/tools/mutate-w7-card-export-arms.mjs`
    （原先只活在 `/tmp/w7-mutate.mjs`；A1 那臂在 apply/revert 两侧都**强制**跟一次
    `pnpm --filter @heyta/ui build` —— 判据读的是产物，不重打 dist 的臂"存活"是假的）：
    | 臂 | 改动 | 读数 | 红落在哪 |
    |---|---|---|---|
    | A1 | 画布宽 = `(契约 − 8)` | `RC_A1=1` / **2 failed, 3 passed** | `:268`「导出的图是 **1072×1440**，契约要的是 1080×1440」+ `:312`「暗色那一张的尺寸不是一档规格数」 |
    | A3 | 宿主不再把失败文案传下去（`exportFailed={undefined}`） | `RC_A3=1` / **1 failed, 4 passed** | `:360`「拿不到画布时界面必须说话（失败静默吞掉是便签那条高危）」 |
    
    🔴 **A1 红两条不算越界，但这句话要说清**：`:268` 与 `:312` 是**同一把尺子**（契约尺寸）的两处使用
    —— 亮色那张与暗色那张各自比一次。"一臂只红一条"的正确写法是**只红它所代表的那条不变量**，
    而不是"只红一行"；反过来 A3 只红一行，因为它动的就是那一条承诺。
    revert 后 `card-export-layout.ts` 的 sha 回到链条开头的基线 `42708dc95156`。
  - ⏹ **W7 剩下的那条不是判据，是证据**：设备真机出图读数（`pnpm verify:mobile-card-export`）
    排在收尾第 4 项那一趟里，见 `docs/plans/countdown-w7-device-export.md` §7 第 2 条。
  - 🔴 ~~**W7-G3（04 05:2x 编号登记）：那条装置只覆盖 Android，iOS 那一半没有设备读数**~~
    ⇒ ✅ **04 17:13:17 关闭**（链 S `RC_PROBE=0`，通过 17 项 / 失败 0 项）：装置 `scripts/verify-mobile-card-export-ios.sh` 已落库并跑通，
    iOS 设备出图 `W=1080 H=1440 BYTES=64619` 逐字等于契约，成品图入库 `apps/mobile/evidence/card-export/ios-latest-card.png` 且人打开看过
    （并与 Android 那张并排比过：四处结构同构、只差平台字体）。逐条读数在第 ㊝ 条。
    现量：`scripts/verify-mobile-card-export.sh` 305 行里 `adb`/`$PKG`/`keyevent` 是唯一的驱动通道，
    而 `grep -icE "ios|simctl|swift"` 在它全文里命中 **0**（连注释都没提 iOS）——
    iOS 侧停在"代码 + node 侧单测"这一档 ——
    `HeytaCardExportModule.swift:67` 写 `temporaryDirectory/card-export/`、`card-export.tsx:173` 在
    `Share.share` **之前**就拿到 URI，所以落盘这件事本身是可证的，缺的只是没人去按它。
    ⚠️ ~~**别把这条读成"顺手就能补"**：iOS 那套 harness 不共享 —— `verify-mobile-ios.sh` 1813 行自带全部
    AX 助手（`ax` / `press_until` / `settle_for` / `dismiss_overlays`），`scripts/lib/` 里没有可复用的 iOS lib，
    所以补它 = 现写一份 ~250 行探针，而**没有设备窗口时探针无法迭代**（每一趟都要重装 + 起模拟器）。~~
    🔴 **04 07:3x 这句"闭合代价"被现量否证，改价写在下面**（登记成债之前先实测贵不贵）：
    ① `ax()` **不是** 1813 行里的一段 —— 它是 `verify-mobile-ios.sh:172` 那 **3 行包装**，真身是仓内文件
    **`scripts/tools/ios-ax-shim.py`（959 行）**，CLI 契约现成（`--udid --idb --companion [--pressable|--field|--exact|--role|--wait|--list|--press|--set|--keyboard|--scroll-into-view|--dismiss-keyboard|--type-text|--tap X Y|--json] [label]`，`--help` 实测可打）；
    ② `resolve_idb()` **就在共享 lib 里**（`scripts/lib/mobile-e2e.sh:970`）—— 我那句"`scripts/lib/` 里没有可复用的 iOS lib"是**没打开 lib 就下的结论**；
    ③ 真正只住在 `verify-mobile-ios.sh` 里的只有两个小流程助手：`press_until`（`:283`，**48 行**）与
    `dismiss_overlays`（`:371`，**32 行**）。
    ⇒ 实际形状是"复用 shim CLI + lib 里的 `resolve_idb` + 抄两个小助手"，不是"现写 250 行"。
    窗口这一条仍然成立但已不阻塞（07:3x 现量：三台已启动模拟器都在、`get_app_container` 三台全 rc=0）。
    已转成任务 **#21**（`scripts/verify-mobile-card-export-ios.sh` + 根入口 `verify:mobile-card-export:ios`，
    退出码沿用 0/1/3 三档不混，且**只对自己造的那台模拟器动手**）。
    可关闭它的最小口径已经想清楚，写在下面：
    iOS 的读数通道其实比 Android **更便宜** —— `xcrun simctl get_app_container <UDID> <BID> data`/`tmp/card-export/`
    是**宿主机直接可读的目录**，不需要 `adb root` 那一档（Android 侧的 release 包不可 `run-as`，见上面第 4 步那段），
    所以 IHDR 那条判据只差 UI 驱动。判据①（读数器自检）与判据③（字节等于契约）可原样复用
    ✅ **04 06:4x：那句"通道更便宜"从推断变成现量**（纯只读，没有动任何一台模拟器）——
    三台已启动模拟器（`heyta-iphone-17pro` FE195661… / `heyta-ios-isolated` 1EDCFA59… /
    `iPhone Duo heyta` 742A8651…）上 `com.heyta` **都装着**，
    `xcrun simctl get_app_container <UDID> com.heyta data` 三台都解析出宿主机可读的容器路径
    （`…/Data/Containers/Data/Application/<UUID>`），`ls <容器>/tmp` 直接可读；
    而 `tmp/card-export/` **三台都不存在** ⇒ 缺的确实只剩"在 iOS 上把导出那一下按出来"，
    **不是**"读不到"。⚠️ 这三台此刻都在另一条会话手里（`heyta-ios-isolated` 那台是别人为隔离造的），
    所以本批只证通道、不去按那一下（§8.9 + §7 第 82 条那族"别动别人的设备"）。
    `verify-mobile-card-export-read.mjs`；判据②（点了才出现）需要把 `featureScreen()` 那层
    在 AX 树上的形状先摸清楚 —— 而那一屏**从来没有在设备上被打开过**（见 W8 节那条 `profile-entry-` 的现量）。
- [x] W7 web 半完成（04 04:3x：五腿 e2e 全绿 + A1/A3 两臂各自转红 + 六张图人已看。
      ⚠️ ~~`check:card-export` 的 `rc=0` 是 **03:1x** 的读数，而 A1 那一臂把 `packages/ui` 的 dist
      **打过又还原重打过** ⇒ 那条读数描述的不是现在这份产物，收尾那趟必须重取~~
      ✅ **04 06:17–06:27 那趟完整 68 段 sweep 里已重取：`pnpm check:card-export` **`rc=0`**（载体 `c4332f86`，
      同趟 `pnpm build` 是第一段 ⇒ 它量的就是刚打出来的产物）**；装包之后还要再取一次（§8.4 第 ⑬ 条那条链的末步），
      因为那两栏 `… · 产物` 判的是**包里的字节**）
      ／ [x] ✅ **W7 移动端出图（Android）已跑到最终态**（04 07:41，载体 `7c63411b`，
      `pnpm verify:mobile-card-export` ⇒ **`RC=0`**，逐条读数在 §8.4 第 ㉓ 条；
      设备写进沙盒、再拉回本机入库的那张成品图在
      [`apps/mobile/evidence/card-export/latest-card.png`](../../apps/mobile/evidence/card-export/latest-card.png)，
      **人打开看过**，看见了什么与四条机器判据写在同目录的 `README.md`）。
      ✅ **04 09:18 在同一台设备上复跑过第二趟，仍然 `RC_ANDROID=0`（通过 11 项 / 失败 0 项，载体 `7806f6ae`）**
      —— 这一趟补的是抽取之后欠着的"零行为变化"读数：拉回来的字节 `shasum` 前 12 位
      `d6d2a88788d1`，与 07:41 那趟记下的**同一枚 SHA 逐字相同**（两趟之间隔着取值层抽取与三条判据修复）。
      读数与两次看图的差别写在 `apps/mobile/evidence/card-export/README.md`
      ／ ✅ [x] **iOS 那一半的设备读数取到了**（编号 **W7-G3**，任务 #21；原写"仍未取设备读数"，
      04 17:13:17 由链 S 关闭：`RC_PROBE=0`／通过 17 项 0 失败，读数在 §8.4 第 ㊝ 条）——
      探针曾从"step 2 就拒跑"
      推进到 step 4，链 K/L/M/N 四趟各照出一处探针缺陷（就绪判据、BACK 归一化、屏外 press、
      `--pressable` 过滤把输入框读成"消失"），逐条读数与修法见 §8.4 第 ㉘/㉚/㉜/㉞ 条
      🔴 **04 10:0x 更正：上面那三行的"五趟都红在探针上"已经过期到链 P 为止。** 链 P（载体 `198603f5`）
      第一次跑到 `RC_IOS_PROBE=1`（9 通过 / 1 失败），失败的是判据②"点了导出，沙盒里没有新文件"——
      三层只读取证排掉"没点到"（相邻菜单钮一按就收、系统日志两次 `send gesture actions`）与
      "原生没编进去"（`nm` 在读到 `+[HeytaCardExportModule(RCTExternModule) moduleName]`）之后，
      用一次**只换 bundle、不重打 app**的实验把根因钉在**我们自己那条桥交给 JS 的名字**上：
      `RCT_EXTERN_MODULE` 展开时 JS 名是空的 ⇒ `NativeModules.HeytaCardExport` 为 `undefined`。
      已改 `RCT_EXTERN_REMAP_MODULE(HeytaCardExport, HeytaCardExportModule, NSObject)`，并把那条
      标题写"三处逐字相同"、body 却比"`.m` 第一个参数 == ObjC 类名"（坏形状恰好满足）的判据修好，
      三臂变异各红一次。设备读数等重打 app 后取；全部读数见 §8.4 第 ㊱ 条。
      —— 同一格里还挂着那条更硬的：**iOS 原生模块曾经根本编不过**（§8.4 第 ㉔ 条，`import React` 已修，
      而"修完能不能建"由 07:51 那一次 Release 构建 + 本趟新鲜度门 `bundle 1791071463 > 源码 1791069065` 证到）。
      ⚠️ ~~04 06:3x 现量：这一趟还开不了工~~ —— **09:17 那趟原地作废**：`verify-mobile-window-gate` 之外
      本探针自己那两道门（设备独占 + 负载 11 ≤ 12）都开了，链 N 就是在那一刻跑完 Android 段的；
      当时那句"`adb devices` 在线 0 台"与"notarytool 已 3h21m 不会自己结束"里，**只有后半句仍然成立**
      （09:1x 现量：同一条 `queue-reinstall-all.sh` 的 `notarytool --wait` 已挂 **6h04m**，见 §8.4 第 ㉙ 条）。
  - ~~✅ 后半（设备出图）到最终态待变异读数~~ —— 🔴 **04 06:3x 这句原地更正：它和上一行自相矛盾**
    （上一行刚写"真机那一趟读数未取"）。这一格在 `verify:mobile-card-export` 跑绿之前**不能**写成"到最终态"，
    已完成的只有：版面收共享层 + RN 栅格化 + 原生落盘 + `check:card-export` 门禁 + A1/A3 两臂各自转红 +
    **"零法务变更"四路现量（§W7 节那条 04 06:3x 的复核）**。
  - 📎 完整取证现在**有链接可给了**：[`countdown-w7-device-export.md`](countdown-w7-device-export.md)
    —— 原文那句"那份住在 `feat/countdown-w7` 上、尚未进 main，所以这里只点名不给链接（给了就是死链）"
    已过期：它**现在是 `origin/main` 的祖先**（`git show origin/main:docs/plans/countdown-w7-device-export.md` 可复跑）。

#### 🟡 W8 · 三端接线与门禁（**壳级门禁 5 绿 0 红；未取证从 2 栏降到 1 栏**）

- **事实**：web 开关表 `apps/web/src/features/shell/modules.ts:51-58,76-120,141-162`（7 个 key，无 countdown）；
  移动端**没有开关表**，`apps/mobile/src/nav/TabBar.tsx:51-59` 硬编码 5 tab（`:45-49` 记着第 6 个 quadrant tab 已撤销）；
  桌面原生壳**不含业务 UI** —— macOS `HeytaMacApp.swift:29 ShellView()` + `:399-462` WKWebView + `:361` 自定义 scheme 服务 `web-dist`；
  Windows `MainWindow.xaml.cs:67-71`（有 `web-dist` 就是 `app` 模式）+ `:161,170-171 SetVirtualHostNameToFolderMapping("heyta.local")`；
  **Linux 壳没有 web-dist 通道**。⇒ 新界面进桌面 = 进 web 产物，不是原生重写。
- **会打到既有断言的地方**（先列出来，别撞了再改）：`e2e/tests/motivation.spec.ts:57,132-141,178,309-322`、
  `e2e/tests/smoke.spec.ts:27`（`toHaveCount(10)`）、`apps/web/tests/app-mount.spec.tsx:835,851`、
  `apps/landing/tests/mockup-shell-shape.spec.tsx:147-165,398-429`（它**读 `view-tabs.ts` 源码文本对账**）、
  `apps/mobile/tests/projects-sections.spec.ts:81`、同步清单 `e2e/tests/helpers.ts:353-368`。
- **判据**：倒数日入口进 `SHELL_MODULES`（🔴 **默认值是产品判断**，§3 W8 的倾向是"默认关"⇒ 关掉的模块**不进 DOM**，
  既有 tab 计数断言不受影响）；移动端那一处重复按本文 §7 第 5 条给出裁决并登记；钉 tab 顺序的 e2e 同步更新且**仍能红**。
- 🟡 **04 03:1x 现量（载体 `feat/countdown-batch2`）**：上面三条"事实"里只有**桌面壳不含业务 UI**那条还成立，
  另两条已被本单自己改掉，逐条给读数：
  - `apps/web/src/features/shell/modules.ts:119-128` 现在**有** `key: 'countdown'` 且 `defaultOn: false`，
    注释里写明"默认关是产品负责人拍的"与"关掉的模块不进 DOM（不是 `display:none`）"
    ⇒ 判据第一条的"默认值"这一档**按预期落了**，既有的 tab 计数断言因此不需要动。
  - 🔴 **§7 第 5 条那个"要不要重复一个 tab"的问题被消解，不是被回答**：移动端**没有加第 6 个 tab**
    （`apps/mobile/src/nav/TabBar.tsx:51` 的 `TABS` 里 `grep -c countdown` = **0**），
    入口改挂在"我的"页的一条共享清单 `apps/mobile/src/nav/feature-entries.ts:93-96`
    （`key: 'countdown'` / `testID: 'profile-entry-countdown'`）。
    所以当初担心的"两端各一份 tab 表会漂"没有发生 —— 两端各有一份**入口表**，
    而它们的一致性由 `check:shell-surfaces` 钉，不是由"只有一张表"钉。
  - 🔴 **04 03:2x 现量：这条门禁现在 rc=1，5 格里 4 绿 / 1 红**（`node scripts/check-shell-surfaces.mjs > /tmp/x.txt 2>&1; echo $?`）。
    红的那格是 `[web] W5`，而它报的是**产物过期不是代码缺失**：
    `dist 2026-10-03T18:53:06Z < src 2026-10-03T19:40:25Z` —— 差的正是我方 `e2def90f`（W6）与后台面板那两笔改动之后
    **没有重打 `apps/web/dist`**。它前面一次全绿（03:0x，见 §8.4 那行）也是真的 ⇒
    **同一行命令二十分钟内两种答案**，差别在**我这边的提交**，不在判据。修法是它点名那句
    `pnpm --filter @heyta/web build`（🔴 不是手改 dist —— 门禁的"不要用下列手法修绿"清单里就有这条）。
  - ⚠️ 另两栏**未取证**（`desktop-macos / countdown · 产物`、`desktop-windows / countdown · 产物`），
    macOS 那栏现在连"包在"都还不上：包里 `index.html` sha256 `5ab36a445c57` ≠ 本地 `18865497ee11`（同一原因 —— 本地 dist 落后于源码，而包里那份又落后于本地）。
    门禁文件头那句话是判据本体："这份绿说的是**通道在**，**不是**装出来的包里有这一屏"。
  - 📌 **我自己在这条读数上刚踩了 §7 第 45 条**：第一次跑写的是 `... | tail -22; echo "RC=$?"`，
    拿到 **RC=0** 并差点照抄成"rc=0，5 格全绿"。管道后的 `$?` 是 `tail` 的，
    而这份输出的**最后几行**恰好是"不要用下列手法修绿"的科普文字（不带退出码信息）——
    两个假绿凑在一起了。上面那条带重定向的命令才是取 RC 的写法。
  - 🔴 **04 04:4x 收尾第 1 趟顺带查出：`check:ui-provider` 整条是红的，四条里有一条点的是 W8 的 `CountdownScreen.tsx:174`——但它是探针的局限，不是崩溃**。
      门禁报的是"共享 UI 的消费者落在 `HeytaUiProvider` 的 JSX 子树**之外**"，四条：
      `CountdownScreen.tsx:174`（`useTheme()`）、`GrowthScreen.tsx:298`（`<GrowthBoard>`）、
      `HabitsScreen.tsx:365`（`<HabitBoard>`）、`ui/habit-goal-slot.tsx:37`（`useTokens()`）。
      运行时取证：`apps/mobile/src/App.tsx:283` 的 `<ThemeProvider>` 包住整个 `Root()`，
      而 `theme.tsx:33` 就是 `HeytaUiProvider as ThemeProvider`；那三张屏由
      `ProfileScreen.tsx:748` 的 `return featureScreen(openFeature, …)` 交出去 ——
      **元素是函数的返回值，不是 Provider 的 JSX 字面子节点**，所以按 JSX 树走的探针看不见它。
      旁证**没有**（我差点写一条假的）：`grep -rn "profile-entry-\(growth\|habits\|countdown\)" scripts/`
      只命中 `check-shell-surfaces.mjs:194` 那一行台账 ⇒ **没有任何设备脚本开过这三张第二层屏**，
      "习惯页真机跑过所以不崩"这句话我拿不出来。运行时证据只有上面那条读码。
      🔴 反过来这也说明：**下一趟 `pnpm verify:mobile-card-export` 是移动端倒数日这张屏第一次在真机/模拟器上被打开**
      —— 它同时也是这条 Provider 判断的现场检验（如果它抛「必须在 `<HeytaUiProvider>` 内使用」，
      那一趟会以"屏上找不到卡片标题"红掉，而不是以崩溃红掉，所以看日志时要记得这个岔路）。
      🔴 **归属**：四条点名的文件在 `origin/main` 与 HEAD **逐字节相同**
      （`git show origin/main:apps/mobile/src/screens/CountdownScreen.tsx | shasum -a 256` = `aabd4c2db0de` = HEAD 那份），
      也就是说**这条红是 main 的已提交状态，本批一笔都没动过它** ⇒ 不吸收、不代改，
      登记为"要改的是探针的遍历（要能穿过 `return helper(...)` 这一层），不是界面"。
      ⚠️ 但这条登记有个前提要说清：`featureScreen()` 那层是**穷尽 switch 且没有 default**（见上面 M 组注释），
      所以"新屏忘挂 Provider"这件事它本来就拦不住 —— 拦不住不等于拦错了。
  - ⚠️ **因此这张表不能打勾**：红的要靠重打产物消，未取证的两栏**只由 §5 第 4 条 `pnpm reinstall:all` 关闭**
    （四端装上当前产物），代码与静态门禁再绿都不算。补齐后在这里改 ✅ 并写装出来的包里"这一屏真在"的取证方式。
  - ✅ **04 04:5x 前半句已经做到并消掉了**：`pnpm --filter @heyta/web build`（`RC_WEB_BUILD=0`）后单跑
    `pnpm check:shell-surfaces` ⇒ **`RC_SURFACES=0` / 判定 5 格：5 绿 0 红 / 未取证 2 栏**，
    与 04 03:0x 那次读数重新对齐。🔴 顺手否证了我自己写在 §8.4 那行里的一句前瞻：完整 `pnpm check`
    **不可能**在这一格响，因为 `package.json:58` 那条串的第一段就是 `pnpm build` ——
    "必须先重打产物否则必红"只在**单跑门禁**时成立。这张表仍不打勾：剩下的是那 2 栏，只有装包能关。
- [x] W8 完成 —— ✅ **04 10:4x / 15:1x 两栏都关掉了**（原文照录在下面，因为它那个"开不了工"的形状会复现）。
      `check:shell-surfaces` 现在的读数是 **判定 5 格：5 绿 / 0 红 / 未取证 0 栏**：
      · **windows 栏**（链 S，载体 `6105ba3b`）：`RC_SYNC=0` + `RC_PACKAGE=0` + 七条取证齐
      （`PAYLOAD_INDEX_SHA=517C6BA76D00…` 与本工作树 `apps/web/dist/index.html` 逐字相同、
      `PAYLOAD_CHUNK_PRESENT/TOTAL=2/2`）⇒ 关闭 **W8-GAP-W1**；四臂各量一次（改 `PAYLOAD_WEBDIST`⇒红、
      改 `PAYLOAD_CHUNK_PRESENT`⇒红、sha 首位改⇒**转回未取证**、删那三行⇒**未取证**）——
      后两臂是那条"不许拿别人的字节给自己这一轮作证"的判据本体。
      · **mac 栏**（链 W，`RC_CHAINW=0`，载体 `117386a1`）：`HEYTA_SKIP_NOTARIZE=1` 打进**自己的** OUT_DIR
      （`package-app.sh:28` 的第一位置参数）→ `RC_MAC_PACKAGE=0` → 包内 `index.html` sha 与本机 dist 逐字相同
      → assets 集合对账 **9/9、差异行 0** → `HEYTA_MACOS_WEB_DIST=<包内那份>` 跑门禁 ⇒ 5 绿 / 未取证 0 栏。
      👁 内容载体 `packaged-first-run.png.webview.png` 人已打开看过（收集箱 + 首启同意卡 + 主蓝实心钮）。
      ⚠️ **两栏都留一条边界**：windows 的取证文件落在 `dist/windows/`（被 gitignore）⇒ 它是本机这一趟的读数，
      干净检出上那一栏仍会报未取证；mac 主张的是"**包里有这一屏**"（sha 逐字相同证的），
      **不主张"屏幕上那个窗口真有内容"**（同名窗口图是空的，而 `package-app.sh:232-242` 早写明不据此判红）。
      🔴 "装进 `/Applications`"那一格**不在本条**，属收尾第 4 项（链 MAC 在跑，见 §8.4 ㊞ 之后的读数）。
      ⏳ 原文（04 06:3x 现量，留著认形状）：`verify-mobile-window-gate.sh --target b` ⇒ `RC_WINGATE_B=3`
      （负载 18 > 阈值 12；`adb devices` 在线 **0 台**；工作树与 `reinstall-all.sh` 两条 ✅），
      外加别人那条装包链挂在 `notarytool submit --wait` 上 3h21m 且**它自己不会结束**。
      取证与不并发的理由在 **§8.4 第 ⑬ 条**；等满按任务书第 8 条记 **exit 3 = 环境无效，不是产品失败**。

#### 🟡 W9 · 提醒的 web 半已落地（42/28/40 passed，变异 9 臂 9/9 红）；原生投递那一单**不归本批**，由另一条会话持有（ADR-0051）

- **事实（比 §3 写的乐观）**：web 投递已在（8.0 第 1 条）。缺三件：
  ①档位上限是"提前 1 天"（`packages/domain/src/reminders.ts:54-61` = `[0,5m,15m,30m,1h,1d]`），而任意 `offsetMs`
  **已接受非负数**、闸门 `MAX_REMINDER_LEAD_MS = 365d` 已在（`:70`）、API 路径已在（`reminder-actions.ts:213-222`）
  ⇒ 扩档位是**纯可加**、不动 schema；
  ②到点自醒：web 唯一周期 tick 是 `App.tsx:723` 的 `refreshNow()`，**不重算 `due`** ⇒ 挂一个只读 `due` 的定时，
  不新建第二份判据（`use-reminder-notifications.ts:12-21` 已论证过"唯一判据"）；
  ③🔴 **DST 敞口**：`reminders.ts:178 reminderTriggerFromOffset` 是纯 epoch 减法，"提前 3 天"= 硬减 72 小时，跨夏令时漂 1 小时，
  而 `date.ts:252 startOfDay / :262 daysBetween / :211 addDays` **带现成 DST 判据却没被提醒链用上**（`check:*` 与
  `verify:mobile-focus` 对提醒链的 DST **零断言**）。
- **不做（有据）**：Android/iOS/mac/windows/linux 的通知投递。`docs/plans/goal-multi-end-coverage.md:104` 记着一条
  **依赖裁决：没有任何一个 RN 本地通知库同时过 §3.1 维护性与 §3.2 许可证并具备本地调度**；`POST_NOTIFICATIONS` 不在 manifest
  （`docs/research/legal-dataflow-client.md:163`）、iOS `Info.plist` 零 UsageDescription、`scripts/verify-mobile-reminder-ring.sh`
  是"判据先行"（commit `ac682d96`）；§0 与 §6 本就把原生投递列为**停批项**。
  ⇒ 这一半不是本批能解的，不假装做完；`docs/research/multi-end-entry-coverage-audit.md:34` 那行"web ✅ / 移动 ⛔永不响"保持原样并加日期。
  - 🔴 **上面那句"`POST_NOTIFICATIONS` 不在 manifest / iOS 零 UsageDescription"在 2026-10-04 03:0x 被现量否证，就地更正**：
    `b0ba4a35`（"W9 提醒的原生投递（ADR-0051）"）**已在 `origin/main` 上**，Android manifest 现在声明
    3 条 `[INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM]`，`apps/mobile/ios/Heyta/Info.plist` 现在有
    1 条 `NS…UsageDescription`。现量命令：
    `node scripts/check-legal-permissions.mjs` ⇒ **rc=1**，两条红都落在 `third-parties.ts` 的推送 SDK 否表行（zh + en），
    即"移动端不申请通知权限"那六句**还没跟着翻**。
    - **这条红不是批次二造成的，本批也不代它翻**（判定依据，逐条可复跑）：
      ①门禁脚本与它在 `pnpm check` 里的挂钩**都在 `origin/main` 上**
      （`git show origin/main:scripts/check-legal-permissions.mjs` 存在、`git show origin/main:package.json` 的 `check` 含该段）；
      ②矛盾的**两端都已提交在 main**：`git show origin/main:apps/mobile/android/app/src/main/AndroidManifest.xml | grep -c POST_NOTIFICATIONS`
      = 1，`git show origin/main:packages/legal/src/documents/third-parties.ts | grep -c 不申请通知权限` = 1。
      ⇒ 干净 main 检出跑 `pnpm check` 在这一段就是红的，与我合并 main（`608fa5b1`）无关。
      ③**所有者正在改它**：主检出 `git status --porcelain -- packages/legal` 现在列出 5 个 `M`
      （含 `third-parties.ts`），且那六个字面位置在其工作树里已经不见了 ⇒ 翻面在他们的未提交改动里。
      六句必须**一起翻**并重跑 `check:legal-copy` 重生成落地页文案（AGENTS §4 L 系列那条纪律），我这边只改一两处
      会造出他们那份的三方冲突，也会让 `check:legal-copy` 与生成物不一致。
    - **关闭判据（每次引用本条要重跑，别信这段文字）**：
      `node scripts/check-legal-permissions.mjs` 输出 `LEGAL_PERM_RC=0`。
    - ⚠️ 与本条**同族但不是同一件事**：批次一在这里写"判据③ 未证实是否已有这样的门禁"，
      L' 那单已经把门禁建出来了（13 臂变异全红），所以**这句"未证实"已经过期** ——
      而且正因为门禁存在，那六句的假话现在**每次 `pnpm check` 都会响**。
      教训：**门禁接进 `check` 之前，先跑一遍它会不会在既有 main 上响**；会响就当场记"谁欠翻转"，
      而不是等下一批的人以为是自己改坏了。
- **判据**：①新档位词条中英成对（`reminders-display.ts:84-105` 与 `ReminderPanel.tsx:60-65` 三处同序映射，
  `offsetMessageKey` 的 `default: throw`（`:99`）就是漂移兜底）；②"提前 3 天跨夏令时仍是同一个本地时刻"写成真判据
  （喂两个具体日期，一个跨 DST 边界）；③到点自醒：注入一条 `due` 已过期的提醒，tick 后 `notify` **恰好一次**
  （变异 = 去掉去重 ⇒ 两次红）。
- [x] W9 完成（web 半 + DST）（2026-10-03 17:58，`a8f5a9a6` @ 分支 `feat/countdown-w9`，另一条隔离 worktree）
  **做了什么**：① 日级以上长档位 `REMINDER_LONG_OFFSET_PRESETS_MS`（2/3/7/30 天）走**另一个数组**、
  由 web 自己渲染那一排 —— 没有并进共享 `ReminderList` 那 6 档的下标契约（移动端没这几档词条，
  而它 `offsetMessageKey` 的 `default` 会抛，硬并会让移动端一开提醒面板就崩）；
  `reminder-tiers.ts` 由**数字映射出文案**，不按下标配两个数组（长度一旦不同就静默错位成"写着提前 3 天、建的是提前 1 周"）。
  ② 提前量改成**日历算术**：`reminderTriggerFromOffset` 对整天以上走 `localDayBefore`，零头才按瞬时减；
  🔴 顺延路径 `nextTriggerAfterRepeat` 复用**同一个函数**（只修建、不修顺延 ⇒ 第一次对、第二次起漂一小时，界面看不出来）。
  DST 判据自己钉 `TZ=America/New_York` 并**先断言夹具前提成立**（写在 Asia/Shanghai 里这条恒真）。
  ③ 到点自醒 `use-reminder-wake.ts`：只读、只调一次 `store.recheck()`，而 `recheck` 里**零判断** ——
  到点与否仍由动作层 `due()` 裁决；分段睡上限 `MAX_WAKE_SLEEP_MS=6h` 从 setTimeout 的 2³¹−1 溢出点**推**出来。
  **读数**：domain `reminders.spec`+`reminders-dst.spec` **42 passed**、app-host `reminder-actions.spec` **28 passed**、
  web `tiers 10 + wake 9 + panel 6 + notify 15` 各自跑；
  `check:design` / `l4`(98=98) / `row-single-source`(28=28) / `ui-language`（词条 zh 2837 = en 2837）/ `text-color` **全 rc=0**。
  **变异 9 臂 9/9 转红、0 臂未证、8 个文件逐字节还原**（`/tmp/w9-mutation-log.txt`）：
  A 提前量退裸减法 ⇒ domain 7 红 **+ app-host 真实写路径 2 红**（改了 `packages/*` 源码必须先 build，判据读 dist）；
  B 顺延退裸减法 ⇒ domain 2 红 + app-host 1 红；C 拿掉投递去重 ⇒ notify 1 红 + wake 2 红；
  D `default` 不再抛 ⇒ tiers 1 红；E 不挂自醒定时器 ⇒ wake 5 红（含真 `<App />` + 真时钟那条）；
  F 长档位整组不渲染 ⇒ tiers 2 红；G 拿掉 en 一条 key ⇒ i18n 键集对等 1 红 + web 层 2 红；
  H 睡上限抬到 2³¹ ⇒ wake 1 红；I 时钟改成早绑定（`{ now: Date.now }`）⇒ wake 4 红（台账 #176 那一族）。
  **三条如实登记**：G 臂意外发现"漏翻译会让 `@heyta/i18n` 的 **dts 构建直接失败**"（编译期就有闸，比测试红更早）；
  C 臂改的 `shown` 去重是**既有代码**，那一臂证的是判据有牙、不是本轮新增；
  F 臂里 `reminders-panel.spec` 仍 6 passed —— 那个套件不覆盖长档位，覆盖在 tiers 套件。
  **边界**：本单**没有动移动端**（长档位词条与那一排目前只有 web 有）⇒ 登记为缺口，W8 三端接线时补。
  🔴 合流冲突预告：主检出此刻有另一会话未提交的提醒改动（D1 墓碑任务过滤 + D14 `markDelivered` 写 `firedAt`），
  与本批在 `store.ts` / `use-reminder-notifications.ts` / `reminder-actions.spec.ts` 三个文件**同函数不同行**，
  语义互补 ⇒ 必须真三方合并、禁止整文件覆盖；他们的 `due()` 加了"任务还活着"那道门，合进来正好让 `recheck()` 一并受益。
- [x] 🔴 **原生投递：19:3x 那条"确认停批"已于 20:1x 被现量作废 —— 另一条会话正在实现它**
  20:1x 现量（主检出，**未提交**）：`AndroidManifest.xml:4-5` 声明 `POST_NOTIFICATIONS` + `SCHEDULE_EXACT_ALARM`；
  `apps/mobile/ios/Heyta/Info.plist:37` 新增 `NSUserNotificationsUsageDescription`；新增未跟踪
  `HeytaReminderModule.swift` + `HeytaReminderModuleBridge.m`；`Heyta.xcodeproj/project.pbxproj` 脏；
  决策文档落在 `docs/adr/0051-mobile-reminder-delivery.md`（**未跟踪**，尚未进 git ⇒ 本表不代它主张已落地）。
  ⚠️ 那条会话写进 AGENTS §9 的行引用的是 `docs/adr/0050-mobile-reminder-delivery.md`，而盘上的文件是
  **0051**（`0050` 是 `e2ee-key-lifecycle-and-recovery.md`）—— 编号撞了一次，`docs-link-check` 覆盖不到 AGENTS.md。
  ⇒ 这条线留下的可迁移教训不是"我量错了"，而是**"某句对外条款的依据"这类记录本身有保质期**：
  它必须由门禁守着，而不是由文档守着 —— 那正是本轮把 L1 那条闸门立成 `check:legal-permissions` 的理由（见下面 §8.2 L'）。
  **下面那四条 19:3x 读数留作 provenance**（它们在当时是真的，四十分钟后全变了）：
  `grep -rn "new Notification(" apps/mobile/src packages/ui/src packages/app-host/src` = **0 命中**（同一条在 `apps/web/src` = **4 命中**）；
  `apps/mobile/android/app/src/main/AndroidManifest.xml` 里 `POST_NOTIFICATIONS` **0 处**；
  `apps/mobile/ios/Heyta/Info.plist` 与 `HeytaWidgetExtension/Info.plist` 的 `UsageDescription` 各 **0 处**；
  判据脚本 `scripts/verify-mobile-reminder-ring.sh` 仍在位（判据先行，重开时直接用）。
  依赖裁决原文在 `docs/plans/goal-multi-end-coverage.md` 批三那一行（四个候选逐一实测：notifee 已归档、
  RN 官方 push 停在 2021、wix 5.2.2 过了两道门但 v5 **没有本地调度 API**、expo-notifications 被 pnpm monorepo 布局卡死），
  解锁条件 a/b/c 也写在那一行。对外口径 `docs/research/multi-end-entry-coverage-audit.md:34`
  （"web ✅ / 移动 ⛔永不响 + 批三停批 2026-10-02 + 裁决去向"）**已带日期，本轮不改写** ——
  这条线的结论要变，得先有一条新的过门禁候选，不是靠重写措辞。
  🔴 AGENTS §9 里它标成"**未闭合、有依赖裁决**"，不许出现在"本批已完成"的清单里。

#### ✅ W10 · `EVENT` 已进 AI 工具目录与 local-api 契约（目录 4 条：读 2 写 2，写路径只到提案；MCP 与内置 AI 共用同一份目录）

- **事实**：目录唯一真源 `packages/local-api/src/tools.ts:94 LOCAL_API_TOOLS`（6 条：读 `list_tasks:96/get_task:105/list_projects:114`，
  写 `create_task:121/update_task:131/complete_task:138`，每条带 `egressFields` + `defaultEnabled:false:82`）；
  app-host **import** local-api（`ai-tool-selection.ts:48`、`ai-tool-run.ts:52-61`），`runReadTool`/`toWriteIntent` 在
  `server.ts:314/386`，MCP `executeTool`（`server.ts:444`）调同两件 ⇒ **一份目录两个前端，不许另建**。
  授权 `tools.ts:713 isToolGranted` 是 `grants?.[name] === true`，**未列出即关**；
  投影 `projectForTool:402 / projectListForTool:439 / readItemForTool:467` 就是"可列举不可读"的实现体。
- **要动的 8 处**（🔴 = 漏了会红，⚠️ = 静默）：①目录条目 ②`mcp.ts:77 INPUT_SCHEMAS`（⚠️ `mcp.ts:198` 空 properties 静默回退，
  生成器只标 `schemaRecorded:false`）③`server.ts` 的 `runReadTool`/`toWriteIntent` 分支 + `LocalApiHost` 新方法（`:95`；
  未登记分支报 not-a-read-tool 🔴）④`local-api-host.ts` 实现 +（写）调 `event-actions.ts`，`submitIntent` 翻译在 `:227`
  ⑤`ai-tool-selection.ts:95` 选择规则（⚠️ 缺了不红）⑥🔴 重跑 `node scripts/gen-ai-capability-manifest.mjs`
  （漏 ⇒ `check:ai-tools` 规则 7 红，`check-ai-tools.mjs:286-303`）⑦i18n `web.ai.tools.intent*`（⚠️ 中英不齐 ⇒ `check:ui-language` 红）
  ⑧测试 `tool-egress-fields.spec.ts`（⚠️ **非目录驱动**：新读工具"声明 == 真实投影"没人替你写）与 `ai-tool-*.spec`。
- **最小可行范围**：读 2（`list_events`、`get_event`；正文 `notes` 只在 `get_event` 且 `isReadable` 为真时出现，照 `get_task` 形状）、
  写提案 2（`create_event`、`update_event`；`LocalApiWriteIntent` 加 2 个**封闭变体** ⇒ UI 确认词表同步）。
  出境：逐工具 `egressFields` 声明；前置披露走现成 `planAssistantEgress`（`ai-assistant.ts:159`，并集 `:131-139`，集合外就停 `:590-603`）——
  当年抓现行的那条落点在 `tool-egress-fields.spec.ts:14-17,107`（`list_tasks` 把 `body` 带进列表）。
  `ai-tool-run.ts` 与 `confirmAiToolProposal`（`:191-196`）**零改动**，`AiSettings.tsx:1126-1149` 自动长出新开关。
- 🔴 **不做**：不开托管档（ADR-0013 `retention-undecided` 继续挡）、不立 `ENTITY_TYPES` 驱动的门禁（§3 W10 末的排期决定）。
- **现量命令**（先证明敞口真实存在，做完后差集归零）：
  ```bash
  node -e "const d=require('./packages/domain/dist/index.js'),l=require('./packages/local-api/dist/index.js');
  console.log('无工具的实体数 =', d.MODELED_ENTITY_TYPES.filter(e=>!l.LOCAL_API_TOOLS.some(t=>t.name.includes(e.toLowerCase()))).length)"
  node scripts/gen-ai-capability-manifest.mjs --check; echo "GEN_RC=$?"
  ```
- [x] W10 完成（2026-10-03 16:5x–17:3x，`8a595493` + `e2aeedc4` + 合并 `a402fa88` @ 分支 `feat/countdown-batch2`）

  **工单的两条硬要求都落地了，且没有第二份实现**：`EVENT` 同时进了
  ① 工具目录 `packages/local-api/src/tools.ts`（读 2 写 2：`list_events` / `get_event` /
  `create_event` / `update_event`）与 ② MCP 契约 `mcp.ts` 的 `INPUT_SCHEMAS`；
  内置 AI 那侧靠 `ai-tool-selection.ts` 的规则接上，`ai-tool-run.ts` 与 `confirmAiToolProposal`
  **一行没改** —— 写路径只到提案，op 的构造仍然只在 `event-actions.ts` 一处（本提交零 `dispatch`、零 op 字面量）。
  `ENTITY_TYPES` 驱动的排期决定**没动**，用的是现成口径（能力清单覆盖面 2/9 → **3/9**）。

  **现量命令复跑**（18:2x，同一趟）：
  第一条的"无工具的实体数 = **8**"（`TAG,NOTE,HABIT,HABIT_LOG,FOCUS_SESSION,AI_FEEDBACK,PREFERENCE_CORRECTION,REMINDER`）
  与门禁打印的"**无工具实体：TAG, NOTE, HABIT, HABIT_LOG, FOCUS_SESSION, REMINDER**"分母不同是**既有口径**
  （ADR-0045 §2.7 剔除 2 个落库载体），不是这次的漂移；两本账里**都没有 `EVENT`** ⇒ 这一单的差集判据是"归零"，成立。
  `node scripts/gen-ai-capability-manifest.mjs --check` → **GEN_RC=0**。

  **变异：这件事值得记的是第一趟的成绩单，不是第二趟的。**
  - 第一趟（`/tmp/w10-mutation-log.txt`）：打印出 5 条判定 —— **3 条 ❌「判据无牙」**
    （① 写工具默认打开、④ 列表投影不再剥正文、⑥ 改名让清单推不出实体归属），2 条 ✅，
    臂 ⑤ 那一趟**没有打印判定行**，而它自己的汇总写的是"未能证伪的变异 **4** 条"。
  - 补了三条判据（目录驱动的 `defaultEnabled:false` 全覆盖、`egressFields` 与真实投影逐字段对账、
    `INPUT_SCHEMAS` 与目录的**双向**对账含孤儿抄件方向）后第二趟（`/tmp/w10-mutation-log2.txt`）：
    6 臂 6 判定 **全部 ✅ 转红**、"仍未证伪 **0** 条"、6/6 还原字节相同。
  - 臂 ⑥ 的第二形状（四个 EVENT 工具名全部改掉）红在**生成器**上并点名了孤儿抄件 ——
    这一条是第一趟那个"改名"臂本来该拦住而没拦住的。

  **测试读数**：`packages/local-api` **130 passed**、`packages/ai` **223 passed**、
  `packages/app-host` **1019 passed**（`/tmp/w10-test-full.log`）。
  `event-tool-host.spec.ts` 走**真实引擎 + 真实 SQLite**（368 行新增），不是 mock 宿主。

  ⚠️ **一处不在文件白名单里的改动，按规则登记**：`packages/app-host/tests/ai-assistant.spec.ts`
  的两条手抄计数（`toBe(3)` / 6 个名字）被本次目录扩容**合法推动** —— 不改它们会因为"没缺陷"而红。
  改法是"由目录推导 + 一条下界（`>= 10` / `>= 3`）"，与该文件自己的用例标题"由目录推导，不是一份手写的名单"对齐。

  三处有意的取舍（都写进了代码注释）：`LocalApiHost.listEvents/getEvent` 做成**可选**，
  但"没接"必须响亮 —— `runReadTool` 回 `ok:false` 而**不是**空列表（空列表会把"壳没这个能力"
  伪装成"你一个倒数日都没有"）；隐私钩子不另立第二个（`isReadable` 参数放宽成 `Task | CountdownEvent`）；
  `kind` 词表用 `Record<CountdownEventKind, true>` 而不是数组抄件（领域层加一档这里就编译不过）。

#### ✅ W4b · 调休/补班的运营录入与客户端拉取都已落地（判据①真界面三档 3 passed 三图人已看、判据②后台 papers 回显有用例 + 两图；25 臂变异逐臂报红）

- **可照的现成形状**：源 `scripts/vendor/holiday-cn/{2007..2026}.json` + `LICENSE` + 唯一读取入口 `load.mjs`
  （校验点：`days[]` 非空 `:44`、`papers` 非空缺出处即 throw、`DATE_RE :30`、**`isOffDay` 必须 boolean `:63`**、
  重复日 / 同一天既休又补班 throw），生成物 `packages/domain/src/generated/holiday-cn.generated.ts`，
  门禁 `scripts/gen-holiday-table.mjs --check`（已进 `pnpm check`），查询层 `packages/domain/src/holidays.ts:75/108/121/161`。
- 🔴 **真正的接缝**：`holidays.ts:108 adjustmentOn()` 是**纯同步、直接 import 生成物**的函数 ——
  后台录入/校验/回显全做完、全绿，客户端读的仍是随包表，判据①"缺数据不报错不留空块"**根本没有载体**。这一步既不在后台落点里、也不在法务清单里。
- **服务端现状**：路由注册表 `server/src/server.ts:494-586`；今天**唯一一条公开只读、非密文**下行是
  `GET /api/push/vapid-public-key`（`push.routes.ts:152`）⇒ "公共事实"挂这一类。
  全 `server/src` **零** `ETag`/`Cache-Control`/`Last-Modified`；可借的版本号形状只有 `PriceVersion`（`schema.prisma:388`）。
  ⚠️ 这句是 **HEAD 读数**（20:4x 复跑：`git grep -icE 'etag|cache-control|last-modified' HEAD -- server/src` 合计 **1**，
  而那 1 处是 `sync/conflict.ts:381` 注释里的 `updateTag`，不是响应头）。
  **W4b 那条分支已经给公共事实这一条加上了 ETag / `cache-control` / 304**（`holiday-adjustment.routes.ts:111-123`，
  见 ADR-0052 §7）⇒ 别把上面这句读成"仓库里今天还没有条件请求"。
- **要迁移吗**：**要，2 张表 1 条迁移**。理由不是"想要范式干净"：判据③（非法日期 / `isOffDay` 不是布尔）在 `Json` 列上
  **库层拦不住** ⇒ 除"年度录入"表（存 `papers`）外要一张逐日表 `day DATE + isOffDay BOOLEAN`。
  🔴 遵守 §4 迁移纪律：一个文件一条语句、`CONCURRENTLY` 走可恢复形状、需要 `ACCESS EXCLUSIVE` 的 DDL 自带
  `SET LOCAL lock_timeout`、部署只走 `sh scripts/migrate-deploy.sh`、提交前 `node scripts/check-migrations.mjs`。
  客户端数据 schema 不动（`CURRENT_SCHEMA_VERSION` 不 bump）。
- **后台落点**（先例 = 优惠码/邀请）：`admin.routes.ts` 端点表（头注释 `:12-18`）+ `/coupons:614`/`/invites:670` 形状 +
  `/overview:152-196` 聚合 + 白名单投影 `:98-102`；闸门 `admin.middleware.ts:34`（插件级 hook ⇒ 新路由自动受保）；
  `admin-client.ts:190/205/244/359/368`；`AdminPanel.tsx:37-42 TABS` + `store.ts:60 AdminTab`；i18n `web.admin.*` 中英各一份；
  测试 `server/tests/admin-routes.spec.ts`（**遍历全部路由的 401/403** + 白名单投影两型）、`admin-migration.pglite.spec.ts`、
  `apps/web/tests/admin-panel.spec.tsx`。`check:journey-coverage` 不会因新资源红（`:50/245` 按端登记）⇒ 人工登记。
- **客户端拉取 + 缓存**：**从零**（最接近的先例只有 `apps/web/src/pwa/push-subscribe.ts:202,367` 现拉不缓存；
  ~~`packages/app-host` 今天**没有任何 `fetch(`** —— 公共事实要不要破这条边界，必须写进新 ADR~~
  🔴 **2026-10-03 20:4x 本条被现量否证，而且否证的方式本身就值得记**：那句是拿 `git grep -c 'fetch('` 量的，
  在 HEAD 上确实恒 0 —— 而 app-host 的出站调用**从来就不长那个形状**：
  `const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)` 然后 `await fetchImpl(url, …)`
  （`admin-client.ts:254,260`、`entitlement.ts:84`、`inbox.ts:161`、`privacy-consent.ts`；
  另有 `host.ts:110`、`hosted-auth.ts:630` 直接绑 `globalThis.fetch`）。
  现量命令与读数：`git grep -c "fetchImpl(" HEAD -- packages/app-host/src` ⇒ **4 个模块 / 5 个调用点**；
  含 `globalThis.fetch` 的文件另有 2 个。⇒ **边界早就过了**，"要不要破 AGENTS §3.5"这个问句本身是错的，
  真问题被 W4b 的实测改成了「**照抄哪一份现成形状**（`baseUrl` + `getToken` + `fetchImpl` + `joinEndpointUrl` +
  失败落成 reason 词表）+ 公共事实这一条**不要 token**」。
  ⚠️ 可迁移的规律：**断言"没有 X"时，先读被调方本体再定 needle** —— 按字面 token 量的"零命中"，
  和"这件事没有先例"之间隔着一层调用形状。原文留着划线，是因为它当时就是这样把一个人带偏的）。
- **判据**：①自托管拿不到数据时**不报错、不留空块**，且要在**真界面**跑一次（截图 + 人看）；②`papers` 链接随数据入库并在后台回显；
  ③校验层能因"日期非法 / `isOffDay` 不是布尔"拒绝录入（变异验证）；④🔴 **注入接缝本身要有判据**：`adjustmentOn` 加了
  "部署方下发的覆盖表"入口后，必须能分别测出"有覆盖用覆盖 / 无覆盖退回随包 / 覆盖里日期非法就整年拒绝"三条分支。
- **文档**：新写一份 ADR 给这条通道定性（§8 工作流：不改已接受 ADR 的结论，要变更另写一份）；
  并**回写 `docs/adr/0038-admin-console-scope.md` 范围表 `:75-79`**。
- [x] 文档这两条已做完（2026-10-03 20:4x，`c28e5f1a` @ main 本地提交）
  - ✅ 新 ADR = **`docs/adr/0052-public-facts-are-deployer-supplied.md`**。定性的那句话：
    **对公共事实而言部署方是事实源，对用户数据而言设备才是** —— AGENTS §1 那句"云端不是事实源"成立的原因是
    服务端读不到也无法裁决用户明文，而"2026-10-10 上班"既不是任何人的数据、服务端也完全读得写得出。
    🔴 因此本文唯一可判的边界写在 §2.1：**公开读面不许出现身份维度**（`:id` / `?userId=` / 按人分流）——
    一旦"按用户下发不同的公共事实"成为可能，定性当场作废。被否决的选项（每年发版随包 / 客户端自己抓 gov.cn）按 README 要求列全。
  - ✅ ADR-0038 的回写**没有动它正文一个字**（[ADR 勘误规则](../adr/README.md#1a-勘误段是被允许的但边界是硬的2026-09-28-补写)第 1 条），而是在文末追加
    `## 5. 勘误（2026-10-03）`：① §2 第三条那个"三"是**当时的决定、不是当前清单**；
    ② 第四个写动作与前三个差在**作用域**（单账号 vs 该部署方全体用户 ⇒ 录错一年所有人跟着错），
    这正是 ADR-0052 给写面钉"权限最高 + 只能整年替换 + 出处必填"三道的理由；
    ③ §4.2 第 4 条"三个写动作没有审计表"的覆盖对象同步过时；
    ④ §4.3 三条不变量**逐条核过没破**（不返回密钥类字段 / 不走 `account_notifications` ⇒ 没有新 kind / 不碰计费），
    §2 第二条单级 `isAdmin` 未变（新三端点共用同一个 `addHook('preHandler', requireAdmin)`）。
  - ⚠️ **ADR 编号撞车已登记在 ADR-0052 §7**：并行工区的契约文件头写着「定性见 ADR-0050
    `0050-public-facts-are-deployer-supplied.md`」，而 `0050` 已被 E2EE 密钥生命周期占用、`0051` 被移动端提醒占用
    ⇒ 合流时**那个指针必须改指 0052**；如果并行那条线自己也写了同号文件，保留一份、把增量并进 §2/§4 后删重复件。
    复跑：`ls docs/adr | grep -oE '^0[0-9]{3}' | sort -n | tail -3`（20:4x 读数 = 0050 / 0051 / 0052）。
  - ⚠️ **上面这句 20:4x 的读数已过期，23:0x 起两条判据都有了载体**（原文留着让人看清它当时是对的）：
    ① 的载体是 `e2e/tests/public-facts.spec.ts` 三档（没配服务端 / 那条通道 404 / 部署方只下发一天），
    **3 passed、三张图人已打开看**；④ 的三条分支在领域层（`packages/domain/tests/holiday-adjustment-override.spec.ts`）
    与 app-host 那 10 条里各测了一腿。`scripts/check-public-facts.mjs` **已存在并接进 `pnpm check`**（`3f327dc2`）。
    同一条 grep 在 `feat/countdown-batch2` 载体上现量 **命中 6 个文件**（`app-host/src/public-facts.ts`、
    `ui/src/calendar/{model.ts,CalendarBoard.tsx}`、`apps/web/src/features/calendar/{CalendarView.tsx,store.ts}` 等）。
- [x] ✅ **W4b 到最终态（04 04:4x）** —— 这一格原本写的是"🟡 代码链已闭合，只剩一条"（23:0x，`feat/countdown-batch2` 上 `6735cc39` + `b05fbc50` + `67fef701`）：
    服务端两张表 + 1 条迁移 + 线协议契约 + 后台三条端点 + ADR-0052 定性 + `check:public-facts`
    + **客户端匿名拉取 / `STORES.META` 缓存 / 装进领域层覆盖表 / web 日历的「休 / 班」/ i18n 中英**全部落地，
    判据①有真界面截图。**没做的那一条**：判据②写的是"`papers` 随数据入库并**在后台回显**"——
    入库与 API 回显有（`admin.routes.ts` 的 GET 带 `papers`），**后台界面没有**
    （`apps/web/src/features/admin/` 里没有调休面板、`admin-client.ts` 里也没有对应方法）
    ⇒ 运营者现在只能靠 curl 录入，这条通道对她还没真正可用。补齐并跑过判据之后这张表才打勾。

    - ✅ **04 03:2x 现量：那句"后台界面没有"过期了** —— `HolidayPanel` 在
      `apps/web/src/features/admin/AdminPanel.tsx:640+`（Tab `调休/补班` 按需拉取，
      `papers` 渲染成 `<a href>` + `rel="noreferrer noopener"`，并把服务端算的 `dayCount`
      回显成"存进去的 == 显示出来的"核对）。真浏览器那条腿在
      `e2e/tests/admin-console.spec.ts`「调休/补班那一页把出处回显成可点链接」，
      整套 `ADMIN_RERUN_RC=0`（**6 passed**），图在 `apps/web/evidence/admin-holiday/`。
    - 🔴 **这一趟最值钱的产出不是"跑绿了"，是看图看出一条断言抓不到的缺陷**：
      第一趟截图里那一行的**年份显示成「2026…」** —— 两条 60+ 字符的 gov.cn 出处徽标不可收缩，
      把同一行 `flex: 1` 的主体挤到被省略号裁切。**全套文本断言当时是绿的**，
      因为 DOM 里文字是完整的，裁切只发生在渲染上（与 §8.4 里 W5 那条"断言只验写了什么、
      不验少了什么"同族，这次少的是**看得见的部分**）。
      修法两层：CSS 让徽标可收缩可换行（`admin.css`），判据改成**几何的**
      （`scrollWidth - clientWidth <= 1`）并且**自带正向对照**
      （先断 `clientWidth > 100` —— 一条"元素没参与布局"的 `0 - 0 = 0` 读数会让判据永远通过，
      这个坑是它自己的第一趟假绿照出来的：那一趟 Playwright 在 03:21:33 就加载了 spec，
      而判据是 03:22:11 才写进去的，所以"6 passed"里**根本没有这条判据**）。
    - ⚠️ **本批欠 e2e 载体一笔，是这一趟撞出来的**：W4b 的 `startPublicFacts()` 挂在
      `apps/web/src/main.tsx:152` ⇒ **每个** e2e 套件一开机都发 `GET /api/holiday-adjustments`，
      而假端点只实现 `/v1/chat/completions` ⇒ `admin-console.spec.ts` 一次红五条、
      报错逐字相同、其中四条与后台无关。补了 `e2e/tests/helpers.ts:stubPublicFacts`
      （与既有 `stubLegalRecheck` 同形同因，应答体按服务端 `holidayVersionToken()` 算出来是 `0.0.0`）。
      🔴 **同一条理由预测会打红 `inbox.spec.ts`**（它既塞凭据又有同一句守卫，且没有 `**` 兜底路由）——
      ✅ **04 04:3x 量到了，预测成立**：`cd e2e && pnpm exec playwright test tests/inbox.spec.ts`
      ⇒ `RC_INBOX_PRE=1` / **2 failed, 1 passed**，报错逐字
      `除已登记缺失外不该有非 2xx：["/api/holiday-adjustments"]`（`helpers.ts:200` 的 `assertNoProblems`）。
      🔴 **红的是两条塞了凭据的用例，第三条不红** —— 与上面穷举的两个凭据点（`:103` / `:311`）**逐一对上**，
      这就是那套静态交集算式的现量校验：它多算一个文件就会在这里露出来。
      补 `stubPublicFacts(page, SERVER)` 两处之后的复测读数见下一条。
      - 📌 **04 03:5x 先把"还有谁会被打红"穷举掉，别等收尾时打地鼠**。敞口不是"所有 e2e 用例"，
        而是三个条件的**交集**，逐条现量：
        ① 会发这条请求 ⇒ 必须**开机前**就有 `baseUrl`（`startPublicFacts()` 只在
        `apps/web/src/main.tsx:152` 调一次，运行中配好的端点不会补发；且它 G-12 闸门未同意时零请求）
        ⇒ `grep -rln "heyta.sync.credentials" e2e/tests/*.ts` = **8 个文件命中，但真写凭据的只有 7 个**
        —— 多出来那个是 `helpers.ts`，命中在**它自己的注释里**（第 239 行那句"凡是往…塞了 baseUrl+token 的用例"）。
        7 个真写点：`public-facts`(本单主题) / `admin-console`(已修) / `account-menu` / `vault-settings` /
        `legal-reconfirm-gate` / `inbox` / `profile-avatar-e2ee`；
        ② 会把 404 变成红的断言 ⇒ `grep -rln "assertNoProblems\|status() >= 400" e2e/tests/*.ts` = **3 个文件**
        （`admin-console` / `inbox` / `motivation`）；
        ③ 数请求条数的断言（`stubLog` / `expectNoStubCall` / `expectStubCount` / `waitForStubCalls`）= **6 个 `ai-*.spec.ts`**
        （另有 `ai-row-layout` 不用它们），而这六个 `grep -c heyta.sync.credentials` **逐个 = 0**
        （`openApp()` 不写凭据，只 `enableAllModules` + 同意面板）⇒ **不在交集里**。
        `motivation` 同样落在 ② 却不在 ①（它没有开机凭据）⇒ 也不进交集。
        交集 ⇒ **只剩 `inbox.spec.ts` 一个文件、三处 `assertNoProblems`**（`:304 :361 :392`，
        凭据点在 `:103` 与 `:311`）—— 上面那条预测的**范围**已由静态穷举钉住，
        但**它到底红不红仍待那一趟实跑**（穷举证明的是"没有第四个文件要修"，不是"inbox 已修"）。
    - ✅ **04 04:1x–04:2x 判据②的三臂变异跑完（一臂一条自己的红）**，装置已落版本库
      `research/tools/mutate-w4b-papers-arms.mjs`（原先住在 `/tmp/w4b-mutate.mjs` —— 一次性读数配一次性装置，
      下一轮就只能重新猜）。
      每处替换都先断言**命中数恰好 1** 再落盘（"改了个不存在的串然后宣布判据有牙"是这条线专门防的），
      每臂跑完整套 `tests/admin-console.spec.ts`：
      | 臂 | 改动 | 读数 | 红落在哪条断言 |
      |---|---|---|---|
      | B1 | `href={paper}` → `href={undefined}` | `RC_B1=1` / **1 failed, 5 passed** | `:887` 「`href` 逐字等于那条 URL」 |
      | B2 | `rel="noreferrer noopener"` → `rel=""` | `RC_B2=1` / **1 failed, 5 passed** | `:889` 「新窗口不许把后台这一页的 `window` 交出去」 |
      | B3 | `flex: 1 1 0` → `flex: 0 1 auto`（修复前的默认值） | `RC_B3=1` / **1 failed, 5 passed** | `:909` 「这一格根本没参与布局（`clientWidth=48`），"没被裁切"是空测」 |
      
      🔴 **B3 这条红的形状值得留**：它红在**正向对照**那一句而不是"被裁掉 N px"那一句（`:911` 没走到）——
      也就是拿掉修复后这一格退回 48px，正是 03:3x 那次"第一版修复什么都没改"被照出来的同一读数。
      三臂的 `revert` 都回显 sha 且**与链条开头的基线逐字节相同**（面板 `76d2959fdde6`、CSS `fc7f6a0e27f6`）——
      这一步不是仪式：变异台只保证"替换命中一次"，**还原是否回到原点**必须由 sha 说话。
    - ✅ **04 04:3x 三处还原后整套复绿（链条第 [7] 步）**：`RC_RESTORE_ADMIN=0` ⇒ admin-console **6 passed (1.5m)**、
      `RC_RESTORE_EXPORT=0` ⇒ countdown-export **5 passed (13.6s)**。
      还原到位是有凭据的，不是"看起来没红"：四个被改动过的文件跑完后 `shasum -a 256` **逐字等于链条开头**
      打的那份基线（`admin.css fc7f6a0e27f6` / `AdminPanel.tsx 76d2959fdde6` /
      `card-export-layout.ts 42708dc95156` / `CountdownView.tsx a877b7c83173`）。
      修复那两笔已单独入库（`87109e9e`），提交时刻在链条把变异全部还原**之后** ——
      半途提交会把带 `href={undefined}` 的那份源码交出去。
    - ✅ **04 04:4x `inbox.spec.ts` 那条也量完了（先红后绿）**：`RC_INBOX_PRE=1`（**2 failed / 1 passed**）
      → 补两处 `stubPublicFacts(page, SERVER)`（`3b24f5b4`）→ `RC_INBOX_POST=0`（**3 passed / 6.5s**）。
      🔴 **这一对本身就是这条修复的 apply/revert 两臂**，不需要再造第三个变异：
      "没有这条登记"就是违规态，而它已经在同一台机器、同一套界面上量出过逐字相同的红。
      上面那套静态穷举因此是**双向校验成立**的 —— 它说"只剩一个文件"，实跑就只红那一个文件的**两个凭据点**
      （第三条用例不塞凭据，它不红；这恰好是"①会发这条请求"那一栏的对照组）。
    - 🔴 **第一版修复是无效的，而照出它的正是那条正向对照**（04 03:38 现量）。
      第一版给共用的 `.ht-settings__admin-badges` 加了 `min-inline-size: 0` + `flex-wrap: wrap`，
      理由写的是"徽标不可收缩"。带正向对照重跑 ⇒ `GEOM_OK_RC=1`，报错原文
      **「这一格根本没参与布局（clientWidth=48）」** —— 元素被排版了（不是 0），但只有 48px，
      也就是**裁切依旧**，第一版什么都没改。
      真正的机制是 **flex-basis**：徽标容器的 basis 默认是它的 `max-content`（两条 URL 排一行 ≈ 1140px），
      而 `rowMain` 是 `flex: 1`（= `1 1 0%`，只长不占）⇒ 整行没有多余空间时**先占得多的一方赢**。
      `min-inline-size: 0` 改变的是"肯不肯收缩"，不是"先占多少"。
      正解：`flex: 1 1 0` 给出处那一格一个 0 basis 并让它参与生长，URL 在徽标内部折行
      （`overflow-wrap: anywhere` 是它 min-content 能小于一整条 URL 的前提）。
      🔴 **且刻意只挂在 `--papers` 修饰符上**：用户列表那排徽标共用 `.ht-settings__admin-badges`，
      那里 `rowMain` 装的是邮箱 —— 分一半宽度给徽标是回归不是修复。
      📌 一般形状：**"允许收缩"与"先占多少"是两个旋钮**，只拧第一个的修复会在自己的判据下原地失败；
      而没有正向对照时，那条判据会把"完全没修"读成"修好了"。

#### 🟡 L' · 法务联动（范围按 §4 的时序条款**收窄**，不是"把六处都改一遍"）—— 判定表已出、命中已修；剩下的那条闸门已于 20:1x **立成常驻门禁 `check:legal-permissions`**，而踩响它的是 W9 不是 W7

- 🔴 §4 自己的话：「倒数日**纯文字版（第一版）不触发 L1/L2/L4/L5**：它不申请任何权限、不上传任何内容」。
  批次二交付的正是纯文字版（素材图片背景归 P2-9，见 §0 与 §6）⇒ **照"六处全改"施工就是按过期假设做工**。
- 本批真正要做的是一件**可判**的事：逐条问"哪句对外承诺会因为倒数日 / 提醒到点 / 公共事实下发而变成假话"，命中才改。
  普查命令：`grep -rnE '不申请|不上传|不会|从不|没有任何' packages/legal/src/documents/*.ts | head -80`。
  初判候选：
  - `permissions.ts:37 / :164`「不申请位置、通讯录、通话记录、照片、相机…」（中英两行）—— 倒数日不申请新权限 ⇒ **预计不改**，
    但若 W9 改到 web 通知的授权文案，要看那句是否进了法务口径；
  - `third-parties.ts:230-241`「heyta 服务器发出的对外请求」/「我们没有接入的东西（逐项列为否）」——
    **W4b 新增一条服务端→客户端内容通道**，且这张表的行形状要求带依据 ⇒ 我倾向**要加行**（它改变了"服务器会主动下发什么"）；
  - `privacy.ts:127-150` 三分表里"官方服务器存密文 + 元数据明文"那格 —— 公共事实是**明文的非用户数据**，
    不改会被读成"云端一切都是密文" ⇒ 待判，且必须与新 ADR 的口径逐字一致；
  - `terms.ts:379-391 / :745` 的服务描述与 **s12 变更历史表**（形状 `['1.1','2026-10-02 …']`）⇒ 新能力上线加一行版本记录。
- **判据**：①`pnpm check:legal-copy` 与 `docRef` 测试能红（变异：把 `docId: 'minors'` 改成不存在的 id）；②双语成对（只改一边必须红）；
  ③改真源后重跑 `pnpm --filter @heyta/legal build` → `node packages/legal/scripts/gen-site-copy.mjs`，🔴 **不许手改落地页文案**；
  动到 `OPERATOR` 再跑 `check:legal-host`；④每条判定（改 / 不改）都要带"依据哪一句现文"。
- **不做**：PIA（PIPL 第 55 条）全仓仍不存在（`packages/legal` 搜「影响评估」零命中；定性在
  `docs/research/countdown-anniversary-data-and-images.md:174`，落点建议在 `docs/research/legal-pipl-baseline.md:967-996,1043`）
  ⇒ 按 §6 口径**单独立项**，不塞进倒数日。
- [x] L' 判定表已出，命中的一条已修完（2026-10-03 19:1x，`2d53ea94` + `8996de9d` @ 分支 `feat/countdown-batch2`）

  **普查**（命令：`grep -rnE '不申请|不上传|不会|从不|没有任何|不下发|不存储' packages/legal/src/documents/*.ts`）
  ⇒ **82 行**候选，分布在 5 份文件（`ai-and-transfer` / `permissions` / `personal-info-list` / `privacy` / `third-parties`）。
  逐条问"这句会不会因为**倒数日 / 提醒到点 / 公共事实下发**变成假话"，判定如下（每条带现文位置）：

  | 位置 | 判定 | 依据（就是这句现文） |
  |---|---|---|
  | `ai-and-transfer.ts:175-183`（中文工具表）+ `:431-444`（英文）+ `:197` / `:446`（那句"不要以为加密条目读不出来"）| 🔴 **改了** | 表后紧跟「**未列出的工具视为未授权**」⇒ 这张表就是授权面。W10 给目录加了 4 条 EVENT 工具，条款里**一条都没有** ⇒ 对着用户少说 4 项"打开之后能读到什么"。这是本次普查**唯一**的真命中 |
  | `permissions.ts:37 / :164`（中英）「不申请位置、通讯录、…照片、相机、健康、日历读写权限」| **不改** | 倒数日纯文字版**不新增任何 manifest 权限项**（W5 只用系统键盘 + 本地存储），那句逐字仍然真。⚠️ 但它是 **W7 的前置闸门**：成品图一旦要写相册/分享，这行当场变假话 —— 见下面"仍开着的" |
  | `third-parties.ts:99-103`「下表是**全部**…第 2–5 行是对服务端代码做全量出网穷举后得到的**四类**对外请求」| **不改**，并且**推翻我自己先前写的倾向** | §8.2 初版这里写的是"我倾向**要加行**（W4b 改变了服务器会主动下发什么）"。读那句原文才定得了范围：它管的是**出网**（server → 第三方），而 W4b 是 server → **用户自己的设备**，中间没有任何第三方 ⇒ 四类集合不变。**这条现在划掉** |
  | `privacy.ts:127`「heyta 的加密只覆盖同步通道…不等于"你的数据全是加密的"」+ 三分表 | **不改** | 主语是"**一条改动**在离开你的设备之前就被加密"。公共事实既不是用户改动也不是用户数据（它是国务院公告），落不进这张表的任何一格 |
  | `privacy.ts:157 / :678`（中英）`entityType` 那格「任务、清单、标签、习惯、配置 **……**」| **不改** | 它是**举例带省略号**，不是穷举 ⇒ 多一类实体不会让它变假。（如果它当初写成"一共九类"，这一条就必须改 —— 同一句里的"11 项"那格**是**穷举，所以它才是承重的） |
  | `terms.ts:379-391 / :745`（s12 变更历史）| **不改**，但**这条纪律我用在了别处** | s12 只在 **terms 自己的文字**变时加行；本批的披露变更住在 `ai-and-transfer`。该文件**没有**历史表，只有 `version` + `updatedDate` ⇒ 我把 bump 落在它身上（`1.0 → 1.1`，`LEGAL_SET_VERSION` 由生成器带出来），因为版本号进同意指纹（`packages/legal/src/index.ts:125`） |
  | L1 / L2 / L4 / L5（照片相关的四张表、对象存储、未成年人照片）| **不触发** | §4 时序条款原文：「倒数日**纯文字版（第一版）不触发 L1/L2/L4/L5**：它不申请任何权限、不上传任何内容」。批次二交付的正是纯文字版 |

  **判据能不能失败**：新门禁 `check:legal-tools` 做过四臂变异，**四臂全红、0 臂未证**
  （A 删中文 4 行 / B 删英文 4 行 / C 中文表两行整行互换 / D 写一个目录里不存在的 `list_birthdays`）；
  还原后字节相同、复绿 rc=0。读数与红集原文在提交 `8996de9d` 的信息里。

  **读数**：`@heyta/legal` build 0 → `gen-site-copy` 与 `gen-server-legal` 重跑 0 →
  `check:legal-copy` / `check:server-legal` / `check:legal-host` / `check:legal-tools` **全 rc=0**；
  legal **59 passed**、`apps/web/tests/admin-panel.spec.tsx` **13 passed**
  （那枚 `ai-and-transfer@1.0` **刻意没跟着改** —— 它注释写明是 2026-10-02 生产真实落库的历史指纹，
  改成 1.1 等于假装用户同意过新版本）。落地页生成物**零字节变化**：生成器只搬标题与摘要，这次没动那两格。

  🔴 **仍开着的两条（不是这次漏做，是它们的前提还没到）**：
  1. ✅ **L1 那条前置闸门已经立成常驻门禁**（2026-10-03 20:1x，`1d71e75f` + `017adc3e` @ `feat/countdown-batch2`，
     脚本 `scripts/check-legal-permissions.mjs`，已挂进 `pnpm check` 的 `check:legal-tools` 与 `check:legal-host` 之间）。
     它做的是**三方**对账：真实申请面（`AndroidManifest.xml` 的 `uses-permission` + 两个 `Info.plist` 的
     `NS*UsageDescription` + `.entitlements`）⇄ `permissions.ts` 那句九项"不申请" ⇄ `third-parties.ts` 的通知否表行。
     **判据方向**（第一版写反了，文件头留着这段记录）：不是"声明了 ⇒ 句子必须提到"，而是
     **"声明了 ⇒ 句子不许再声称不申请"** —— 第一版在 `CAMERA` 进 manifest 时反而退出 0，变异臂 A1 当场照出来。
     `REVIEWED_REQUESTED` 今天必须是空表，加一条的成本是刻意的（同 §3.2 许可证白名单）；
     它不是"永远不许申请隐私权限"的墙 —— 臂 A9 证明"登记 + 中英两句同时改掉"会**复绿**。
     **变异 13 臂 13/13**（0 臂未证伪、0 臂夹具失效、被改文件逐字节还原=是）：
     A1 CAMERA 未登记 / A2 中文漏一项 / A3 句子冒出没登记的"运动" / A4 plist 冒 `NSPhotoLibraryUsageDescription` /
     A5 manifest 声明 `POST_NOTIFICATIONS` / A6 那两句措辞改掉 ⇒ **解析前提响亮失败**（`exit 1`，不把"读不到"当"没申请"）/
     A7 通知那句被删而申请面没声明（悄悄删承诺）/ A8 登记了但句子仍说不申请（说谎臂）/ A9 合法翻面复绿 /
     A10 plist 冒通知键 ⇒ **走通知族那一臂**而不是"未登记的键"（带反向判据）/
     A11 **只翻 `third-parties.ts`、漏了 `permissions.ts`** ⇒ 逐位置判必须还红（这条是"翻面翻一半"的形状）/
     A12 申请面声明 + 六个位置**一起**翻 ⇒ 复绿 / A13 `SCHEDULE_EXACT_ALARM` ⇒ 红，**故意的**：
     它不属于那九项，合流的人必须显式判它是不是隐私权限并写理由，不能让它顺手通过。
     通知族那六个字面位置（= 合流时必须一起翻的清单，中英各三处）：
     `permissions.ts` Android 行依据 zh「移动端代码目前不产生任何系统通知」/ en
     "the mobile code currently raises no system notification at all"、`permissions.ts` iOS 行依据 zh
     「也不申请通知授权」/ en "notification authorisation is not requested either"、`third-parties.ts`
     推送否表行 zh「移动端不申请通知权限」/ en "The mobile app requests no notification permission"。
     另外 `permissions.ts` 文件头 ①② 两行注释是同一件事的依据，也要一起 sweep（它不对外，门禁不判）。
     **现量读数（主检出 20:1x，只读取别人的未提交状态）：rc=1，7 条红** ——
     `HEYTA_CHECK_ROOT="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta" node <batch2>/scripts/check-legal-permissions.mjs`
     ⇒ 6 条是上面那六个位置各自"仍写着不申请，而申请面已声明通知授权"，第 7 条是 `SCHEDULE_EXACT_ALARM` 未登记。
     ⇒ **这就是那条闸门该做的事**：条款的翻转必须由 W9 那条会话（或合流的人）在**同一批**里做完 +
     重跑 `pnpm check:legal-copy` 重生成落地页文案；不在我这批改，因为 `permissions.ts` / `third-parties.ts`
     / 两个 plist 此刻**都在主检出里脏着**（撞车判据 = 同一文件的未提交 diff），我不代改别人的在飞文件。
  1b. 🔴 **04 03:5x 把这条红的"载体"钉死：它是 main 已提交状态的属性，不是谁的工作树造成的**。
     上面 20:1x 那条读数是喂**主检出的未提交工作树**量出来的，所以它有一个没被排除的解释：
     "红只在混合工作树成立"。这次用门禁自己那条旋钮 `HEYTA_CHECK_ROOT` 换一个**只放已提交内容**的根：

     ```bash
     R=/tmp/legal-root-main; rm -rf $R; mkdir -p $R/scripts
     cp scripts/check-legal-permissions.mjs $R/scripts/
     grep -oE "'[A-Za-z0-9_./-]+\.[a-zA-Z]+'" scripts/check-legal-permissions.mjs \
       | tr -d "'" | sort -u > /tmp/lr.txt            # 7 个输入（含两个 .entitlements，第一次漏了它）
     while read -r p; do mkdir -p "$R/$(dirname "$p")"; git show origin/main:"$p" > "$R/$p"; done < /tmp/lr.txt
     HEYTA_CHECK_ROOT=$R node $R/scripts/check-legal-permissions.mjs > /tmp/out.txt 2>&1; echo rc=$?
     grep -c '^❌' /tmp/out.txt
     ```

     读数：**`origin/main` 的输入 ⇒ rc=1 / 7 条红**；**同一探针喂 `HEAD` 的输入 ⇒ rc=1 / 7 条红**，
     两侧末行"读数：…"逐字相同。⇒ 归属结论从"别人的在飞工作树"升级为
     **"W9 那笔 `b0ba4a35` 已提交在 main 上的矛盾"**（六句没翻 + `SCHEDULE_EXACT_ALARM` 没登记），
     合流前不修就一直红，与谁的未提交改动无关。**不由本批代改**（判据同上：那是 W9 的产品/法务判断，
     而且 A13 那条臂本来就是**故意**要它响亮失败）。
     📌 顺手记一条探针纪律：第一版探针只按 `.ts/.xml/.plist/.json` 收集输入，**漏了 `.entitlements`**，
     于是两边都短路在第 1 条"读不到 ⇒ 必须响亮失败"上、报出"1 条红"——**一个坏探针差点把"7 条红"读成"1 条"**，
     而它看起来完全像在工作（脚本确实读了东西）。缺一个输入时它不静默、而是响亮失败，这条设计救了我一次。
  2. ~~**`third-parties.ts:230-241` 否表里那一行的"依据"是条件真的**…⇒ 这条应当挂成 **W9 移动半的前置闸门**，与 L1 同形。~~
     ✅ **这条闸门已于 2026-10-03 19:3x 当场结掉，且结论是"不改现文、只换依据的措辞来源"**：
     W9 移动半经复量确认是**停批**（不是"还没开工"）—— 移动端 `new Notification(` **0 命中**、
     `AndroidManifest.xml` 里 `POST_NOTIFICATIONS` **0 处**、`apps/mobile/ios/Heyta/Info.plist` 与
     `HeytaWidgetExtension/Info.plist` 的 `UsageDescription` 各 **0 处**、判据脚本
     `scripts/verify-mobile-reminder-ring.sh` 在位（裁决原文与解锁条件 a/b/c 在
     `goal-multi-end-coverage.md` 批三那行）。⇒ 「移动端不申请通知权限，提醒只在应用内」**是当前产品事实**，
     那句话不必动；要记的是它的依据从"还没做"换成了"**有依赖裁决**"——
     一句真话的依据换了，比那句话本身更容易在半年后失守，所以 AGENTS §9 的 W9 那行现在直接把四条读数印在旁边。
     🔴 **20:1x 更正（同一批现量，见上面 W9 那一节）**：上面这段"不必动现文"的结论**当场过期**了 ——
     那条会话把那半实现了，`POST_NOTIFICATIONS` 与 `NSUserNotificationsUsageDescription` 进了申请面，
     于是「移动端不申请通知权限」这句**从真话变成假话**。⇒ 结掉的不是这句话的真假，而是它的**判法**：
     现在由 `check:legal-permissions` 的通知臂逐位置守着（六个位置、两侧对称），文档不再负责记住它。
  3. 同一种"封闭句式没有对账门禁"的形状**还有一处没被处理**：`third-parties.ts:103`
     「下表是**全部**…第 2–5 行是对服务端代码做全量出网穷举后得到的**四类**对外请求」。
     这次判定它**不必改**（W4b 不出网），但那个"全部"以后任何一次新增出网调用都会让它变假，
     而目前没有任何一层比过"服务端 fetch 落点"与这四行。**没有现在立门禁**：它要的是
     一份出网枚举的生成器（比上面两条都重），且没有本次事故把它照出来 —— 登记，不假装已覆盖。

### 8.3 收尾（§5 的四条，一项都不能省）

1. `pnpm -r typecheck && pnpm -r test`，然后**完整 `pnpm check`**（动过 `packages/legal` 必含 `check:legal-copy`）。
   ⚠️ 当前 HEAD 上 `check:docs` 已红，而且**数量在长**：20:4x 现量
   `node research/tools/docs-link-check.mjs` ⇒ **33 处**"本机有、仓库没跟踪"的死链
   （这一行原先写"8 处"，那是更早一趟的读数 —— 死链数是别人未跟踪文档的函数，不是常量，引用它必须带日期）。
   全部落在并行会话的未跟踪文档上（`docs/README.md` → `adr/0046`/`0047`/`0048`、`plans/trash-and-archive*`、
   `research/aed-implementation-evidence.md`、`docs/plans/README.md` → `calendar-year-time-and-mobile-profile.md` 等）。
   ⇒ 收尾时这条红**不吸收、不代改**（别人未跟踪的文件不该由我 `git add`），写成"缺口在哪一段、在谁手里"的现量。
   ✅ 本批自己引入的死链：**0** —— 复核命令 `node research/tools/docs-link-check.mjs | grep -E 'adr/0038|adr/0052|countdown'`，
   20:4x 读数无命中（`0038 → 0052` 那条曾在清单里，是因为 0052 当时未跟踪；`c28e5f1a` 提交后消失）。
   - 🔴 **上面"33 处"那句的载体要写明，否则会读成"批次二欠 33 条死链"**：那是**主检出**（有别人未跟踪文档的工作树）的读数。
     2026-10-04 02:5x 在 `heyta-wt-batch2` 隔离检出里现量：`node research/tools/docs-link-check.mjs` ⇒ **rc=0，死链 0 处**。
     同一份文档、两个检出、两个读数 —— 差的就是那批未跟踪文件。
     ⇒ **死链数不是仓库属性，是"仓库 + 本机未跟踪文件"的属性**；引用它必须带"在哪个检出跑的"。
     本批引入的死链仍按上面那条 grep 判：**0**。
2. `node research/tools/docs-link-check.mjs` 带读数复核。
3. 界面结论必须有截图且人真的看过；验收不抢前台。
4. `pnpm reinstall:all` 四端装上当前产物（AGENTS §6.1.1）；真机验收排在最后，用私有现场。

### 8.4 进度勾选总表

| 工单 | 状态 | 依赖 | 判据数 | 完成读数（2026-10-03，分支见 §8.2 各勾） |
|---|---|---|---|---|
| W0 弹层上提 | ✅ | — | 3 | ui 448 passed + 变异 1 红 + e2e 注入红在"面板应在头像上方" + 3 张图已看 |
| W0b 遗留缺口 | 🟡 ①② | 台账需干净 | 3 | 16 文件路径/库名旋钮；harness 22 绿 0 红；③ 转投单写者文档待入 traps |
| W2 `EVENT` 实体 | ✅ | D1/D2 ✅ | 4 + 静默门禁人工勾 | 20/7/17/41/30 passed；`listEvents` 已进 READ_PATTERNS 且三腿验过能红 |
| W6 日历第二源 | ✅ **已闭合**（`e2def90f`，04 02:5x） | W2 | 2 | 判据本体（"没有截止日的倒数日能上日历"）+ 四个档位 + 侧栏那颗点各有真 DOM 判据；三层 14/8/13 passed + e2e 3 passed 五张图人看过；变异 5 臂逐臂只红自己那条。**原判"排后：落点被整片重写"这句由 `608fa5b1` 合流关闭**（详见 §8.2 那条 W6 节）。剩 **W6-G1**：接进「今天」/收集箱要先给 `TaskList` 一条"不可交互行"的契约变更，不属于这一批 |
| W5 卡片网格 | ✅ | W2、W0 | 5 | 12 passed + 12 例变异 0 未证 + 9 道门禁 rc=0；e2e **6 passed**（整族 15 passed）、三张图已看、看图照出"逾期卡没有日期行"并修成 `94760c82`，两腿变异各红一次 |
| W7 成品图导出 | ✅ ~~🟡 ~~**web 半到最终态**（A1/A3 两臂已跑）／**移动端出图的真机读数未取**~~ 🔴 ~~**04 14:2x 现量更正**：web 半 + **Android 设备出图已在当前提交上取到**（链 U 13:18 重装 → 13:20 `RC_ANDROID=0`、11 项全过、成品图人已看），**只剩 iOS 那一半**（链 X 被负载门拒到累计 2160s，链 Z 排在后面用 7200s 窗口重跑）~~ —— 🔴 **04 18:2x 这一行整体重画，两半现在互换了的不是同一件事**：**iOS 那一半已闭**（17:13:17 链 S `RC_PROBE=0`，17 项通过 / 0 失败，IHDR `1080×1440` 逐字等于契约，成品图入库且人打开看过、与 Android 那张并排比过四处同构；第一次真跑红在 `rasterize-timeout`，根因是我们自己的调用时机 ⇒ 修 = `afterNextFrame` 让一帧，`c313914f`，见 §8.4 ㊜/㊝）。⚠️ **代价按 W7-G6 自己立的规矩结算**：那次改的 `card-export-units.ts` 也是 **Android 那趟的 bundle 输入** ⇒ 13:20 的 `RC_ANDROID=0` **当场过期**，"只剩 iOS"那句作废。现在 Android 这一格分两件事：**装上了当前产物 = ✅**（`RC_REINSTALL_ANDROID=0`，17:57:21）、**设备出图读数 = 🔴 未取到**（`RC_ANDROID=3`，18:12:23 等满**默认 900s**，宿主机负载 164 ⇒ 按边界第 8 条记环境无效不是产品失败；补跑在链 T2，显式 `HEYTA_LOAD_GATE_WAIT=3600` 且先重装，缘由见 §8.4 ㊢/㊣）。这一行在补跑取到读数前**保持 🟡，不代它打勾** —— 🔴 **04 19:0x 补跑到账 ⇒ 转 ✅**：链 T2b `RC_REINSTALL_T2=0`（18:46:47）→ `RC_ANDROID_T2=0`（19:00:50，`通过 11 项 / 失败 0 项`、IHDR `1080×1440` 逐字等于契约、`BYTES=35286 SHA=2821b4820f8f`、`TRANSPARENT=false`、全程零授权页、成品图我打开看过）。**两端读数现在都在当前提交上**，逐条账在 §8.4 ㊧ | W5 | 2（含 RN 出图取证） | 载体已从 `heyta-wt-w7` 换到 `feat/countdown-batch2`（合入 `43e94b32`，**现在已是 main 的祖先**）。**04 03:1x 现量**：mobile `card-export.spec.ts` **21 passed / `MOBILE_RC=0`**、真浏览器 `countdown-export.spec.ts` **5 passed / `EXPORT_E2E_RC=0`**、~~门禁 `check:card-export` rc=0~~ ⚠️ **这条 03:1x 读数已作废**：A1 那一臂把 `packages/ui` 的 dist 打过又还原重打过，它描述的不是现在这份产物，收尾那趟必须重取。成品图实测 **1080×1440 逐字等于契约**（契约从 `shared-schema/dist` 读回来，不在测试里重推公式）、六张图**人已看**且已进版本库（`apps/web/evidence/countdown-export/` + README）。**04 04:3x 两臂变异**（装置已落库 `research/tools/mutate-w7-card-export-arms.mjs`，A1 臂 apply/revert 两侧强制 `pnpm --filter @heyta/ui build`，因为判据读的是产物）：A1 画布宽改「契约 − 8」⇒ **2 failed / 3 passed**，红落在 `:268`「1072×1440，契约要 1080×1440」+ `:312`「暗色那张不是一档规格数」＝**同一把尺子的两处使用**，不算越界；A3 宿主不传失败文案 ⇒ **1 failed / 4 passed**，红落在 `:360`「拿不到画布时界面必须说话」；revert 后 `card-export-layout.ts` 的 sha 回到链条开头的基线 `42708dc95156`。🔴 **还剩的一条不是判据，是证据**：设备真机出图（`pnpm verify:mobile-card-export`，装置已落库并做过探针自检）排在收尾第 4 项那一趟 —— 在它跑绿之前，"三端出图已落地并取证"这句话的**移动端那一半只能算代码在、读数无**。**"零法务变更"仍是可复跑的**：W7 往 manifest 加的只有 `<provider>`，`git diff 43e94b32^1 43e94b32` 里**零个 `<uses-permission>` |
| W8 三端接线 | 🟡 **三端代码 + 壳级门禁已在 batch2**，那格门禁 04 03:2x 自己变红、**04 04:5x 重打 web 产物后 `RC_SURFACES=0`（5 绿 0 红）**；~~只剩 2 栏"装出来的包里有这一屏"待收尾④~~ 🔴 **04 14:2x 现量只剩 1 栏**：windows 那栏已由链 S 转成真实读数（四臂有牙，㊲），mac 那栏的 `HEYTA_MACOS_WEB_DIST` 通道一直在（㊹ 否证了"结构上关不掉"那句），链 W 打自己目录的包去取 | W5/W6 | 3 | 🔴 原先这行写"排后：同 W6，日历线未落地前不动 `CalendarScreen`"—— **那是按整条线推断出来的，现量否证过**：W8 的落点在 main 里逐个文件都干净，且 web 半已随 W5 落地。载体已从 `heyta-wt-w8` 换到 `feat/countdown-batch2`（合入 `f2d09974`）。**读数取两次，因为答案在二十分钟内变了**：04 03:0x ⇒ rc=0，5 格 = 5 绿 / 0 红；**04 03:2x ⇒ rc=1，4 绿 / 1 红**，红的格是 `[web] W5 产物比源码旧`（`dist 18:53 < src 19:40`）—— 差的正是我方 `e2def90f`（W6）+ 后台面板那两笔之后没重打 `apps/web/dist`，**不是新缺陷，是自家提交把这条判据甩下了**，修法是它点名的 `pnpm --filter @heyta/web build`（门禁的"不要用它修绿"清单里明确排除了手改 dist）。未取证仍是 2 栏（`desktop-macos / countdown · 产物`、`desktop-windows / countdown · 产物`，macOS 那栏现在连 sha256 都对不上：包里 `5ab36a445c57` vs 本地 `18865497ee11`），门禁自己那句话是承重判据："这份绿说的是**通道在**，**不是**装出来的包里有这一屏" ⇒ 两栏只由 §5 第 4 条 `pnpm reinstall:all` 关闭；~~🔴 **而它同时给这条线加了一条新前置：收尾那趟 `pnpm check` 之前必须先重打 web 产物，否则这一格必红**~~ **04 04:5x 两处现量把这句前瞻否证了，原地作废**：① 跑一次 `pnpm --filter @heyta/web build`（`RC_WEB_BUILD=0`）再单跑门禁 ⇒ **`RC_SURFACES=0` / 判定 5 格：5 绿 0 红 / 未取证 2 栏**，那格红**只是产物落后**，不是缺陷；② 更关键的是 `pnpm check` 的**第一段就是 `pnpm build`**（`package.json:58`），所以完整收尾那趟**结构上不可能**在这一格响 —— 我那条"必红"前瞻是把"单跑门禁"的条件错写成了"跑 check"的条件。**本批自己造的红，不登记给别人**，但它同样不能被登记成别人拆不掉的墙 |
| W9 提醒（web 半 + DST） | ✅ web 半 | 可与 W2 并行 | 3 | 42/28/40 passed；变异 9 臂 9/9 红、0 未证；移动端那半**没动** |
| W10 AI 工具目录 | ✅ | **W2 之后** | 3 + 差集归零 | 130/223/1019 passed；变异**第一趟 3 臂无牙**→补判据→第二趟 6/6 红 |
| W4b 调休通道 + ADR | ✅ **到最终态（04 04:4x）**：判据①②真界面读数 + 三臂变异各红自己那条 + 载体敞口~~已清零~~**没清零**（04 06:1x 现量：安静窗口复跑照出 `profile-avatar-e2ee` / `vault-settings` 两条夹具仍没登记那条开机拉取 ⇒ 已按同一条纪律补齐，修后 `RC_FIXTURE_E2E=0`；"敞口清零"这句当时只数了报过红的两条，没数**带封闭登记的夹具全集**——现量是 4 条会记 `unexpected` 的 spec（`admin-console` / `inbox` / `profile-avatar-e2ee` / `vault-settings`，第 5 条 `motivation` 里那个变量量的是"非 2xx"、不是封闭登记，实测不受这条拉取影响），当时补了 2 条、漏 2 条，现在 4/4） | 独立（1 条迁移） | 4 | 全链已进 main（`6735cc39`/`b05fbc50`/`67fef701` + 服务端那 4 笔 + `check:public-facts` 八臂 8 红）。**04 03:2x**：判据②的后台面板落了（`AdminPanel.tsx` 的 `HolidayPanel`），`e2e/tests/admin-console.spec.ts` 整套 **6 passed / `ADMIN_RERUN_RC=0`**，图在 `apps/web/evidence/admin-holiday/`。🔴 这一趟最值钱的是**看图照出整格被挤成「2026…」**（04 04:2x 更正：这一句原先写"年份被挤成"，把缺陷说小了 —— 省略号截掉的是「2 天安排 · 国务院办公厅通知」整段，只有打开那张图看得出来）⇒ 修 CSS + 判据改几何（`scrollWidth-clientWidth<=1`）**并自带正向对照**（先断 `clientWidth>100`，否则"没参与布局"的 `0-0=0` 让判据永远通过——这个坑由它自己的第一趟假绿照出来：Playwright 03:21:33 就加载了 spec，判据 03:22:11 才写进去，那趟"6 passed"里根本没有它）。另补 `e2e/tests/helpers.ts:stubPublicFacts`：本批的开机拉取会把任何带"不该有非 2xx"守卫的套件无关地拖红（实测一次红五条）。**04 04:1x 第二版修复的读数**：同一套件 `6 passed / RC_W4B_OK=0`；**04 04:1x–04:4x 收口**：三臂 `RC_B1/B2/B3` 全 =1 且各红自己那条（`:887` / `:889` / `:909` 正向对照），还原后 `RC_RESTORE_ADMIN=0`（6 passed）、四个被改文件的 `shasum` 逐字等于链条开头的基线，`inbox.spec.ts` 先 `RC_INBOX_PRE=1`（2 failed）后 `RC_INBOX_POST=0`（3 passed），修复两笔入库 `87109e9e`（CSS/面板）+ `3b24f5b4`（e2e 载体），装置落版本库 `research/tools/mutate-w4b-papers-arms.mjs`（含一臂 **B4 未跑**，登记在装置文件头）。逐项读数与"第一版修复其实无效"那段在本节 W4b 的表里。 改前/改后两张图 md5 **不同**（`8970c732…` / `f14afbc0…`，早先它们逐字节相同过，那等于什么都没证）， 看图后的两条例外都写进 [`../apps/web/evidence/admin-holiday/README.md`](../../apps/web/evidence/admin-holiday/README.md) |
| 收尾四项（§5） | ✅ ~~🟡 **三条已量（第 1 条三趟，末趟一趟跑完 68 段 = 66 绿 / 2 红），第 4 条待跑**~~ 🔴 **04 14:2x 逐条现量**：第 1 条 13:26 那一趟停在 `check:ui-provider`（真根因是探针把 `return <X/>` 当泛型，四臂已修，㊶），完整读数排在链 Y；第 2 条 14:04 `rc=0`；第 3 条本批各面的图**均人已看**（android 成品图 13:2x、windows 打包图 10:4x、web 三张与后台两张 23:0x–03:1x）—— ⚠️ 但其中 W5 三态与侧栏迷你月历那**四枚只活在 `e2e/test-results/`**（Playwright 每轮清空），14:28 现量 mtime 06:21–06:22 且未入库 ⇒ "看过"是真的、"证据常驻"不是，登记任务 #27 排在链 Y 之后搬进入库并重看（㊺）；第 4 条 ~~**android ✅（当前提交）/ windows ✅（13:20 sha 复核仍逐字相同）/ iOS ⏳（链 X→Z）/ mac ⏳（链 W 取产物栏，`/Applications` 那一格属共享位置的持有者）**~~ 🔴 **04 18:2x 逐端重画**：**ios ✅**（链 S 17:13 `RC_PROBE=0` 是在装着当前字节的那枚 app 上取的，"⏳ 链 X→Z"那截已被后面的实测取代）、**windows ✅**（10:39 装包，`apps/web/dist/index.html` 的 sha256 前缀 `517c6ba76d00fb25` 在 13:20 与 18:1x 两次复核都逐字相同 ⇒ 本批后面的提交全是 docs/mobile 面，远端那格不必重打）、**android ✅ 两件事都到齐**（装包 `RC_REINSTALL_T2=0` 18:46:47 ／设备出图 `RC_ANDROID_T2=0` 19:00:50：11 项全过、IHDR `1080×1440` = 契约、图我打开看过。18:12:23 那次 `RC_ANDROID=3` 保留在这里，是为了让人认出"调用行没写 `HEYTA_LOAD_GATE_WAIT` ⇒ 继承被调方默认 900s ⇒ 等满就是环境无效"这个形状）、**mac ✅**（链 MAC `RC_MAC=0` 18:45:48，`HEYTA_SKIP_NOTARIZE=1 bash scripts/reinstall-all.sh --only mac`；9 chunk 集合对账 + 包内 `index.html` sha 与本机逐字相同 + 装进 `/Applications` 那一枚自截屏人已看，主蓝 1266 全来自暗色板，见 §8.4 ㊦/㊧）；⚠️ ~~"`/Applications` 那一格属共享位置的持有者"这句现在要打折读~~ —— 18:20 现量：那枚常驻实例 **pid 772 零打开文件、0.0% CPU、已闲置 20h47m**，而它盘上那份包内 `web-dist/index.html` 是 `217cae2a252d8948` ≠ 当前 `517c6ba76d00fb25` ⇒ **这一格该由本批关掉**，不再挂在别人手里；起跑前的共享现场处置（把别人 03:13 的证据目录改名保住而不是让 `rm -rf` 落上去）与三条依据在 §8.4 ㊣。第 1 条的新读数排在链 FULL（68 段逐段），第 2 条 18:16 在本树复取仍 `rc=0`。 | 全部 | 4 | ✅ 第 2 条：`node research/tools/docs-link-check.mjs` 在本检出 ⇒ **rc=0 / 死链 0 处**（⚠️ 那句"33 处"是**主检出**的读数，死链数是"仓库+本机未跟踪文件"的属性，引用必须带在哪跑的）。✅ 第 3 条：W6 五张、W7 六张、W4b 一张**都打开看过**，各自 README 写了"看见了什么"，并且**看图一共照出三处断言抓不到的东西**（W5 少一行日期 / W7 竖条不是主蓝 / W4b 年份被挤没）。✅ 第 1 条完整 `pnpm check`：**第三趟一趟跑完 68 段 = 66 绿 / 2 红**（04 06:17:07–06:27:21 @ 载体 `c4332f86`，其中 `check:ai-e2e` 352s **`rc=0`**；两条红逐条对账见下面第 ⑩ 条、整趟读数见第 ⑪ 条）；此前**分两趟逐段量过 66/68 段**（装置 `research/tools/check-segments.mjs`，段的来源是 `package.json:58` 那条真串而不是抄的名单，`--skip` 的选择器会报分母）。第一趟 04:45–04:49 @ `7d1b85b3`：**67 段 / 60 绿 / 7 红**；四笔提交把其中 4 条按各自真因修掉（`816dea4c` theme / server-legal / shell-unicode，`2924b15d` 取回 main 已落的 6 份测试修复）；第二趟 05:0x–05:12 @ `e25377f7`：**66 段 / 63 绿 / 3 红**；那三条红随后逐条对账，**其中一条当场被现量否证并修掉**（`check:licenses:stamp` —— main 早就重渲染过那份清单，取回即可，见下面第 ⑦ 条），剩下 **2 条是本批之外的已提交状态** —— `check:ui-provider`（探针穿不过 `return featureScreen(...)` 那层，四条点名文件在 `origin/main` 与 HEAD **逐字节相同**）、`check:legal-permissions`（红在 `third-parties.ts` 推送 SDK 的英文否表行 vs `POST_NOTIFICATIONS`/`NSUserNotificationsUsageDescription`，属 **W9 原生投递那条线**，不是 L'）。`pnpm -r test` **全量已在 04 05:2x 量到**（19/19 个有 `test` 脚本的包，**10760 passed / 1 failed / 14 skipped**，逐条见下面第 ⑧ 条）；第 1 条当时只剩 `check:ai-e2e` 的**一趟安静复跑** —— ✅ 04 06:17 那趟跑到且 `rc=0`（第 ⑪ 条）（04 05:24 那趟已经跑过：**142 passed / 3 failed / 2 skipped**，但它与另一条会话的 e2e 并发 ⇒ 那三条红还不能当判据读数，逐条见下面第 ⑨ 条），排在 `/tmp/batch2-closeout2.sh` 的 [A2] 步。⚠️ 这里换了编排，也换了一个**当天现量出来的理由**：另一条会话的 `reinstall:all`（载体 `d0a81927`，不是本批）此刻卡在 macOS 公证的 `notarytool submit … --wait` 上**已经两个多小时**（`/tmp/heyta-reinstall-mac.log` 自 03:13 起没再写），而 `pnpm -r test` 与 `check:ai-e2e` **一台设备都不碰** —— 把它们押在"等对方整串跑完"上是白等，所以链条改成"先量不碰设备的两段，再排设备窗口"；等对方链退出这件事只对**设备那几段**保留（§8.9）。⏹ 第 4 条 `pnpm reinstall:all` 四端 + 私有现场设备验收（排在最后；⚠️ 现场核对 **05:0x 现量**：Android 模拟器 `emulator-5554` 在线、iOS 起了 **两台**（`heyta-iphone-17pro` + 别人的 `heyta-ios-isolated`）、`windows-pc` SSH 可达，而**这三样此刻全在另一条会话的重装链手里** ⇒ 本批这一趟已改成**串行排队**（等对方链退出 + 负载门 ncpu*3/4 + 工作树必须干净 + 4318/4319 与测试锁空才跑 `check:ai-e2e`，等满记 exit 3 = 环境无效而非产品失败） |

🔴 **04 04:45–04:49 收尾第 1 条的第一趟已量**（载体 `7d1b85b3`，命令 `HEYTA_REPO_ROOT=$PWD node research/tools/check-segments.mjs --skip check:ai-e2e`，起点 load 11.97）：**67 段 = 60 绿 / 7 红**，前面还先跑了 `RC_WEB_BUILD=0`（那条红的 W5 产物格因此转绿）。七条红逐条给归属，不打包成"仓库还红着"：

- ① `check:theme` —— **本批的**（W7 两个测试直接拿 L0 原始表）⇒ 已修 `816dea4c`，改走 `tokensForTheme()`，两套件复跑 **16 + 21 全绿**；
- ② `check:server-legal` —— **本分支的生成物落后真源一格**（`privacy@1.1→1.2`，`ai-and-transfer` 两边都已经是 1.1）⇒ 重生成，门禁 rc=0；
- ③ `check:shell-unicode` —— 21 处（我的设备脚本 15 + 合流带进来的 `mutate-closeout-gates.sh` 6）⇒ 用仓库自带的 `fix-shell-unicode-vars.py --write` 修，rc=0；
- ④ `pnpm -r test` —— **本分支落后 main**：先是 op-log 的 EVENT 夹具 `opId` 不唯一 ⇒ 同一实体第二条 op 被 ADR-0009 幂等去重静默吞掉（main `94a0bb13` 已修）；取过来之后 `pnpm -r` 往下走，又在 server 段露出 **6 文件 / 61 条红**，逐条查下来**没有一条是本批造的**：`setup.ts` 的 `$executeRaw` 要回 **1** 才表示"行锁拿到了"，那是 `5d0b27b9`（vault 那条线）改的，本分支停在 merge-base 的 **0** ⇒ `Unmocked raw query in tx: SELECT id FROM users … FOR UPDATE` 把四份 spec 连坐（第五份 `duplicate-operation-precheck.spec.ts` 与 main **逐字节相同**，红只来自 setup）；第六条 `admin-log-pii` 的"正向对照"读 `git show HEAD:` —— **修复一旦提交，HEAD 就是修好的版本，命中数变 0**，也就是这条判据只在"修复还没提交"那个窗口里有牙，main 已改成沿 `git log --all` 找"最后一份还带违规的源"。六份都取回 ⇒ `2924b15d`，server 段 **119 files / 2196 passed / 1 skipped / rc=0**；
- ⑤ `check:ui-provider` —— **不是本批的**，但"四条点名的文件与 `origin/main` 逐字节相同"这句**是错的，现量更正**：
  门禁点名的四处是 `CountdownScreen.tsx:174`（`useTheme()`）、`GrowthScreen.tsx:298`（`<GrowthBoard>`）、
  `HabitsScreen.tsx:365`（`<HabitBoard>`）、`ui/habit-goal-slot.tsx:37`（`useTokens()`）。
  逐字节比对（`git show origin/main:<路径> | shasum -a 256` ↔ `shasum -a 256 < <路径>`）的结果是 **3 同 1 不同**：
  `aabd4c2db0de` / `c3393b0a0034` / `b166bfe4f0f8` 三处相同，
  而 `HabitsScreen.tsx` 差 **41 行**（main=`106567f4d22e`、本分支=`926e4ab20d3a`）——
  但那 41 行全部是**选中态**那条线（`useSelected` / `pruneSelectionAgainst` / `lib/selection` 的注释），
  `diff | grep -icE "provider|HabitBoard"` = **0**，也就是"谁挂在 Provider 之内"这件事两边逐字一样；
  而 Provider 的挂载处 `apps/mobile/src/App.tsx` 两边逐字节相同（`0912d523aaba`）。
  ⇒ 结论：**这一格在 main 上同样红，但它是一条推断而不是读数** —— 我没有真在 main 的检出上跑过那条门禁
  （跑一次要再开一个 worktree，而这一格的红不阻塞本批的任何交付物）。要把它变成读数的人：
  `git worktree add --detach <目录> origin/main && HEYTA_REPO_ROOT=<目录> node scripts/check-ui-provider.mjs`。
- ⑥ `check:legal-permissions` —— **main 的已提交状态，这条现在是量出来的不是推的**：
  红句指的是 `packages/legal/src/documents/third-parties.ts` 推送 SDK 的英文否表行仍写
  「The mobile app requests no notification permission」，而申请面已经声明通知授权
  （`AndroidManifest.xml:POST_NOTIFICATIONS` + `ios/Heyta/Info.plist:NSUserNotificationsUsageDescription`）。
  现量三件：`git show origin/main:apps/mobile/android/app/src/main/AndroidManifest.xml | grep -c POST_NOTIFICATIONS` = **1**、
  `git show origin/main:packages/legal/src/documents/third-parties.ts | grep -c "requests no notification permission"` = **1**，
  而且那份 legal 文档两边 **sha 相同**（`816138f7d6e1c5`）；带进 `POST_NOTIFICATIONS` 的提交是
  **`b0ba4a35`（10-03 23:58 "W9 提醒的原生投递（ADR-0051）"）**，它在 main 与本分支上同一枚 sha。
  ⇒ 这句话对本批的意义：**门禁红在 W9 那条线的法务联动上，不在 L' 上**（L' 命中的那条早已在 main 里，见上面 §批次一欠账清单那条二更），
  而改它要动的是别人的条款文本与版本指纹（进同意指纹），**不属于"顺手修掉"**。
- ⑦ ~~`check:licenses:stamp` —— **载体不够**：本工作树重渲染会**少 132 个包**（961 vs 清单里的 1093，`@expo/*`/`@babel/*` 那一整片都不在），也就是门禁给的修法在这棵树上会产出一个**更差**的产物 ⇒ 已回滚，登记给装齐全部 workspace 的检出~~
  🔴 **04 05:1x 就地否证并撤回**：那句"登记给装齐全部 workspace 的检出"把范围说成了**别人**，而现量是**main 早就重渲染过了**。三条命令：
  `git show origin/main:pnpm-lock.yaml | shasum -a 256` = `0f3c1bf6d9e21526` = **本分支那份 lockfile 的指纹**（逐字节相同），
  而 `git show origin/main:research/licenses-inventory.generated.md` 的戳也已经是 `0f3c1bf6d9e21526` ⇒ **main 在这一格是绿的，红的只是我这条分支**；
  两份 generated 文件 `diff` 只差 **4 行**（戳行 + `生成时间：2026-10-03→10-04`），依赖清单正文 1128 行 / 43951 字节**逐字节相同** ——
  这正是"lockfile 相同 ⇒ 依赖图相同 ⇒ 那份产物对本分支同样成立"的证明，不需要在本机装任何东西。
  取回 main 那份 ⇒ `check:licenses:stamp` **rc=0**、`check:licenses` **rc=0**（同一批"取回 main 已落的修复"，与 ④ 同形）。
  真因是 `2f735392`（10-03 23:58 那笔"并行批次的总接线"把 lockfile 换成了 `0f3c…`）**进了本分支，但它带来的清单重渲染没跟着进来**。

- ⑧ `pnpm -r test` **全量重取（04 05:2x）**：`RC_RTEST=1`，但这次**跑到了最后一个包** ——
  有 `test` 脚本的包共 **19 个**（`packages/*/package.json` + `apps/*/package.json` 里数出来的，不是抄的名单），
  汇总行也是 19 个 ⇒ 与上面第 ④ 条那次"第 14 个包就停"不同，这一趟是**完整覆盖**。
  合计 **10760 passed / 1 failed / 14 skipped**（含 server 的 119 files / 2196 passed / 1 skipped）。
  🔴 唯一那条红是 `apps/web/tests/due-date-edit.spec.tsx`：
  「批一判据 ①：选截止日 → 恰好一条只带 dueDate 的 UPD op > 点月历日子格」——
  `AssertionError: 月历里应有 10月18日 这格（无障碍名 = 完整日期）: expected null not to be null`（`:191`）。
  先排除了两件事：**(a) 不是本批改出来的** —— 选择器走的共享 `DatePicker`（`packages/ui/src/date-picker/DatePicker.tsx:276`
  `accessibilityLabel={labels.dayLabel(monthOfCell, day)}`），本分支相对 `origin/main` 在这条路上**没有改动**
  （`git diff --name-only origin/main...HEAD` 不含该文件），而最后一次动它的是 `5e23b7bf`，
  `git merge-base --is-ancestor 5e23b7bf origin/main` 回 **0**（= main 上同一枚）；
  **(b) 测试文件本身两边逐字节相同**（`4326a5910afb`）。
  所以两种可能：main 上这条用例本来就红，**或**它红在这趟跑的时候正被并发挤（同一时刻另一条会话拿走了
  `/tmp/tfa-test.lock` 在跑 e2e，本仓的内存闸门后来拒绝我并发起 vitest，理由就是"并发测试会把进程推到 1.8–26GB"）。
  ⇒ **不猜**：已排一条单独复跑探针（`/tmp/rerun-due-date.sh`：等测试锁空 → 同一条用例连跑两趟），
  两趟同红 = 确定性红（那就要按 main 的账登记），一趟红一趟绿 = 并发单发不稳。
  ~~✅ **04 05:2x 读数回来了：安静窗口里同一份 spec 连跑两趟，`15 passed (15)` / `rc=0` 两趟都一样**
  ⇒ 那条红是**并发单发不稳**，不是产品缺陷，也不是 main 的账。全量那条"1 failed"到此关闭。~~
  🔴 **04 05:5x 这句归因就地作废**（它把"没查到共享状态"读成了"没有缺陷"）：真因是**探针自己赌时长**，
  与并发无关 —— `DueEditor` 的面板有**两副身体**（`details` 内的在流卡 / Portal 到 `body` 的 fixed 卡），
  换身体由 `toggle` + 一帧 `requestAnimationFrame` 置位的 `anchor` 决定。探针实测（`/tmp/jsdom-toggle-probe.js`
  与 `/tmp/raf-leg.js`，都带同刻正向对照）：**jsdom 27 会**在**一个宏任务**里派发 `toggle`
  （源码 `HTMLDetailsElement-impl.js:27` 就是 `setTimeout(…, 0)`），`rAF` 在第 **17ms** 回调
  ⇒ 用例里那句 `await engine.getOpsForEntity(...)` 一旦跨过 17ms，格子就已经不在 `container` 那棵树里了，
  而它找的是 `container.querySelector('[aria-label="10月18日"]')` ⇒ **机器空时等得短就绿、负载 31 时等得长就红**。
  同文件 R14 那几条早就改成从 `document` 找了（文件里就写着这条理由），那两条腿是漏改的。
  ✅ 修法 = 三处定位一律从 `document` 取（`buttonByText` + 新增 `buttonByAriaLabel`），
  并把 `DueEditor.tsx:118`/`:265` 那句"jsdom 不触发 `toggle`"改成实测结论（那句是**假话**，
  它会诱导下一个人再写一次 container 作用域的查找）。
  🔴 可迁移的一条：**"跑之前查一下锁"不构成独占**。探针在 05:23 查锁是空的，另一条会话 05:24 起才拿锁，
  于是整趟 `pnpm -r test` / `check:ai-e2e` 是在并发下跑的，而症状长得和真缺陷一模一样
  （几何判据差 5.3px、无障碍名取不到格子）。要独占就得**自己原子地拿锁**
  （`set -o noclobber` + `> /tmp/tfa-test.lock`，存在即失败，退出 `trap` 删自己那把），
  而不是看一眼它在不在 —— 这条已经写进探针。
- ⑨ `check:ai-e2e`（04 05:24–05:28，载体 `af6fb28e`→`d4255e10` 这段只有文档提交）：
  **142 passed / 3 failed / 2 skipped（6.0m）**。三条红逐条写清"是什么形状 + 归谁 + 还差什么"：
  · `tests/calendar-sidebar.spec.ts:111`「迷你月历：七列真的对齐…」—— 几何判据量出
  **第 1 列的列头与格子中心差 5.3px**，`retry #1` **同一个数**（所以不是抖动）。
  本批的嫌疑面：`e2def90f`（W6）给侧栏格子加了「休 / 班」那颗点（`CalendarSidebar.tsx:177`），
  而列头与格子是**两副各自分配列宽的 grid**（`sidebar.css:308` 两处共用 `repeat(7, 1fr)`）——
  两副 grid 只在"没有任何一列被内容撑开"时才会对齐。
  🔴 **但这句话到机制为止，不能当结论**：那颗点只有一个 2xs 的字，按宽度算撑不开 1/7 那一格，
  而 5.25px 的位移要成立需要某几列各被撑开 ~1px。我照这个猜测改了一版 `minmax(0, 1fr)`，
  **在没有浏览器可量的时候又把它撤了**（`git checkout -- apps/web/src/styles/app/sidebar.css`）——
  交付一个"看起来像修好了"的改动，比留一条没定的红更贵。要定它只需一次带测量的跑：
  打印那 7 个 track 的实际宽度，看被撑开的是哪几列、撑开多少。
  · `tests/profile-avatar-e2ee.spec.ts:213`（头像 + 口令那条线）与 `tests/vault-settings.spec.ts:138`（vault 那条线）
  —— ~~两条都不在本批的改动面上（本批没碰头像/vault 的任何文件）。~~
  🔴 **04 05:5x 这句作废：两条红都是本批造成的**，报错原文就是证据 ——
  `假服务端收到了没登记过的调用：GET /api/holiday-adjustments` / `unexpected fixture requests: GET /api/holiday-adjustments`。
  机制：W4b 让应用**一开机**就拉公共事实（`apps/web/src/main.tsx` 的 `startPublicFacts()`），
  而这两条夹具的守卫是**封闭登记**（catch-all 把任何没预料到的路径计入 `unexpected`，末尾断言它是空集）
  ⇒ 与头像/vault 主题无关的一条合法读取，被算成了那两个面的缺陷。这与 `inbox.spec.ts` / `admin-console.spec.ts`
  早先是**同一个洞的另外两张**（那两张已经用 `stubPublicFacts` 登记掉了，这两张漏了）。
  ✅ 修法照同一条纪律：这两条 spec 各加一行 `await stubPublicFacts(page, SERVER)`；
  同时把我那份 `stubPublicFacts` 的**方法守卫**补上（非 GET 一律 `fallback()` 交回 catch-all ——
  原来那份连写请求一起 fulfill，等于替产品开了后门；这一形是并行那条线在主检出里教的）。
  🔴 **合流义务（同名不同人的夹具会撞）**：主检出此刻正被另一条会话改着同一批文件，
  它把同一条登记命名成 `stubEmptyHolidayAdjustments`，命中 `helpers.ts` + `inbox` + `vault-settings` +
  `profile-avatar-e2ee` + `admin-console` 五处（现量：`git -C heyta diff HEAD --stat -- e2e/tests/...`
  = helpers +12 / profile-avatar +2 / vault-settings +3−1，且 `git show origin/main:e2e/tests/helpers.ts`
  里**两个名字都没有** ⇒ 他们那版还没提交）。~~合流时**只留一份**，留带方法守卫的那份，
  另一个名字的调用点全换过去；这一步不做就会出现两个并存的同义夹具。~~
  🔴 **04 06:4x 这句里"留带方法守卫的那份"是个假选择，已现量否证并改成可执行裁决**：
  把两棵树里的函数体各自抽出来、只把函数名归一化后取 sha256 ⇒ **两边都是 `82fa6148363b`**
  （`stubPublicFacts` 体 403 字节 / `stubEmptyHolidayAdjustments` 体 415 字节，差的那 12 字节
  **恰好等于两个名字的长度差** ⇒ 除名字外**逐字节相同**，方法守卫两边都有，因为那份守卫就是照他们那版补回来的）。
  ⇒ 合流要做的不是"选强的那份"，是**改名**这一件事。裁决：**留 `stubEmptyHolidayAdjustments`**，
  理由不是"谁先提交"，是这个名字说的是**载荷**（空表），而 `stubPublicFacts` 说的是通道 ——
  后者会让下一个人误以为它给的是"真的公共事实"，而这条通道将来确实可能要有非空夹具的版本。
  现量：主检出工作树 `grep -c stubPublicFacts e2e/tests/helpers.ts` = **0**、
  `grep -c stubEmptyHolidayAdjustments` = **1**（定义），调用点两边都是**同一批 4 条 spec / 5 处**
  （`inbox` ×2、`vault-settings`、`profile-avatar-e2ee`、`admin-console`）。
  ✅ **可复跑的收口判据**（谁合流谁跑，两条都要成立）：
  `grep -rn stubPublicFacts e2e/tests/ | wc -l` ⇒ **0**，
  且 `grep -rn "stubEmptyHolidayAdjustments(page" e2e/tests/ | wc -l` ⇒ **≥ 5**。
  ⚠️ **合流面此刻比先前更广**（04 06:43 现量，主检出脏 155 个文件，与本批落点交集 **16 个**）：
  除上面那 7 个 e2e 文件外，还包含**本批 W7 的那条 e2e 载体 `e2e/tests/countdown-export.spec.ts` 本身**，
  以及 `packages/legal/src/documents/` 下 **9 份文档 + `packages/legal/tests/structure.spec.ts`**
  —— 也就是 §8.2 L' 那六处条款的位置**全部**在别人手里。⇒ 合流前必须重跑这一条交集命令，
  它每一轮都在变（同一句"3 个文件脏"六天变成"6 个"的先例已经记在上面）。
  ✅ **修后读数（04 06:15，同一把锁、同一台机器、`--retries=0`）**：这两条 spec 单跑
  **`RC_FIXTURE_E2E=0` / `2 passed (8.7s)`**（`profile-avatar-e2ee.spec.ts:218` 与
  `vault-settings.spec.ts:141` 各一条）。⚠️ 这一趟之后又被重写掉 **10 个已跟踪 evidence png**，
  照第 ⑨ 条末尾那条流程纪律原地 `git checkout -- apps/web/evidence` 还原（10 → 0）。
  ~~⚠️ 这一趟不能算"判据读数"：它与另一条会话的 e2e 并发……三条红都要等一趟安静的复跑才算数，已排探针。~~
  ✅ **04 05:47 安静复跑的读数回来了**（探针自己原子拿到 `/tmp/tfa-test.lock`、`--retries=0`、
  拿锁后先确认没有别的 playwright 在跑）：**`3 failed / 1 passed (14.6s)`，三条红一条不落全部复现**
  ⇒ 三条都是**确定性红**，不是并发假象。上一句"不能算读数"到此关闭，本节其余段落用的都是这一趟的原文。
  🔴 顺带把这条探针的形状记下来，它是本轮唯一一次**没有靠负载门、而是靠锁**拿到安静窗口的：
  `noclobber` 抢锁 + 活着才等 + 只删自己那把（05:34 起等 13 分钟到 05:47 接手，全程没并发）。
  🔴 顺一条对**流程**有影响的现量：`check:ai-e2e` 跑完会**重写 41 个已跟踪的 evidence png**
  （`apps/web/evidence/**`，里面大部分是别的条线的：`assistant/`、`vault-panel/`、`calendar-year/`、
  `profile-panel/r15b-*`、`quadrant-fill/`…），而 `pnpm reinstall:all` 的不变量正是"工作树没有未提交的已跟踪改动"
  （它要把整棵树同步到远端打包机）⇒ 任何"先跑 e2e 再装包"的链条都会在中间被这 41 个文件挡下。
  本批的处置是 `git checkout -- apps/web/evidence`（**41 → 0**），理由写清楚：
  那些图的"人已看"结论在各目录 README 里，而 README 钉的是**版本库那一份**的 md5 —— 留着新字节反而让那条 md5 判据失效。
📌 三条一般形状：① ~~**"清单已过期"的修法不是"重渲染"，是"在装齐的树上重渲染"**~~ —— 这句被 ⑦ 自己否证了，正确顺序是**先问"main 有没有已经渲染好的那份"**，再用 `diff` 证明它对本分支同样成立（lockfile 逐字节相同 ⇒ 清单正文相同 ⇒ 只差戳与日期 = 免费的正确性证明）；"在装齐的树上重渲染"是**没有那份可取时**的次选，而不是第一选择。② **linked worktree 的 `pnpm install` 会少一整片 workspace**（这里 961 vs 1093），症状与"清单过期"长得一样（数字变小）、方向相反（越修越瞎）—— 所以"在这棵树上跑生成器"之前要先跑 `diff`。③ **`pnpm -r test` 在第一个失败包就停**，所以"某段 rc=1"完全可能只量到了 21 个包里的第 14 个 —— 报"全量绿"之前要数**跑到了第几个包**，不是数红了几条。

- ⑩ **剩下两条红的归属已经量成"读数"而不是"推断"**（04 06:2x，两条都是**直接跑门禁**拿的原文，不再靠工作树状态去猜）：
  - `check:ui-provider` **`RC_UIP=1`** —— 本分支 `apps/mobile/src` 有 **4 处**共享 UI 消费者落在
    `HeytaUiProvider` 子树**之外**（`CountdownScreen.tsx:174`、`GrowthScreen.tsx:298`、
    `HabitsScreen.tsx:365`、`ui/habit-goal-slot.tsx:37`）。🔴 **这条不是本批欠的**：
    同一份门禁在**干净 main 检出**（`/tmp/heyta-main-clean`，HEAD `de537bd4`）跑也是 **`RC_UIP_MAIN=1`、同样 4 处**
    （逐行比对只有 `HabitsScreen` 的行号漂移 394↔365，那是 main 后来自己改过那个文件），
    而其中 `CountdownScreen:174` 那一条出自 `79e116cf`（W7 移动半）—— **它已经在 main 上**（`git merge-base --is-ancestor` 回 0）。
    四条里三条出自 9-28 / 9-30 / 10-01，都比本批早。⇒ 修法（把 Provider 提到同时包住这些视图的那一层）
    是移动壳那条线的活，本批不代做、也不为了凑绿去动别人那三条的挂载形状。
    现量命令：`node scripts/check-ui-provider.mjs`（本树）与
    `cd /tmp/heyta-main-clean && node scripts/check-ui-provider.mjs`（main 对照）。
  - `check:legal-permissions` **`RC_LEGAL_PERM=1`** —— 七条红：`SCHEDULE_EXACT_ALARM` 没进登记表，
    加**六个**对外条款位置（`permissions.ts` Android/iOS 行 × 中英 + `third-parties.ts` 推送否表行 × 中英）
    仍写着"不申请通知权限 / 不产生系统通知"，而申请面已经声明了（W9 原生投递 `b0ba4a35`）。
    🔴 **这正是 §8.2 L' 第 1 条预言的那一步，但它此刻在别人手里**：主检出的工作树里
    `packages/legal/src/documents/{permissions,third-parties}.ts` **正被另一条会话改着**（`git status` 现量 ` M`），
    而且**已经翻完了** —— 那两句旧话在主检出的工作树里各命中 **0** 次。
    ⚠️ 顺带一条探针形状：在主检出直接跑那条门禁会回 **✅**，那是**量到别人未提交的工作树**，
    不是 main 的提交状态 —— 按提交量：`git show origin/main:packages/legal/src/documents/permissions.ts | grep -c '移动端代码目前不产生任何系统通知'` = **1**、
    `.../third-parties.ts | grep -c '移动端不申请通知权限'` = **1**、`origin/main` 的 manifest `POST_NOTIFICATIONS` = **1**
    ⇒ **main HEAD 同红**，本批不重复翻那六处（翻了就是在同一批未提交的文件上造第二份改动）。
    合流时取他们那版，并记得 `pnpm check:legal-copy` 要重跑（落地页文案是法务的生成物）。
- ⑪ **收尾第 1 条的完整读数（04 06:17:07–06:27:21，一趟跑完，载体 `c4332f86`）**：
  `research/tools/check-segments.mjs` 的 68 段 = **66 绿 / 2 红**（汇总码 `RC_SWEEP3=1`）。
  ⚠️ 那个 1 是"**存在红段**"的汇总码，不是"整条 check 停在第几段" —— 68 段全部**跑到了**，
  含四段重的：`pnpm build` 18s、`pnpm typecheck` 12s、`pnpm -r test` 44s、**`check:ai-e2e` 352s**，
  两条红就是上面第 ⑩ 条逐条对过账的 `check:ui-provider` 与 `check:legal-permissions`（各 0s，纯静态门禁）。
  🔴 **`check:ai-e2e` 这趟 `rc=0` 是本批第一次在安静载体上拿到整条 e2e 零红**：
  04 05:24 那趟的三条红（`calendar-sidebar.spec.ts:111` 的七列几何、`profile-avatar-e2ee.spec.ts:213` 与
  `vault-settings.spec.ts:138` 的封闭注册表被开机拉取撞）在 `9241caeb`（R-1 的 grid 修法）与
  `5b3af82a`（两条夹具各加一行 `stubPublicFacts`，并给那份 stub 补上"非 GET 一律 `fallback()`"的方法守卫）之后不再出现。
  ⚠️ 读数口径要说清楚：**passed 计数没被留住** —— `check-segments.tsv` 每段只存**末尾几行**，
  这段留的是两条 node 警告与一行 `Failed to load resource: … 404`，所以这行的证据是 **rc=0 / 352s**，
  "零红"是由退出码给的（`check:ai-e2e` = `node scripts/check-ai-e2e-preflight.mjs && pnpm --dir e2e run test`，
  后者逐字是 `playwright test`，中间没有吞红的包装），**不是数出来的**。
  那句 404 是**末尾输出行**、不是断言（真被某条断言抓住的话整段会红）⇒ 合流时值得问一句
  "离线夹具里谁在要一个没登记的东西"。
  前置闸门都是现量：负载门 `vm.loadavg` 1min = **10.1 ≤ 12** ⇒ 放行；测试锁**原子拿到**（持有者 pid 66418，
  结束自己删），同趟"别的 playwright 数 = **0**" —— 这正是上面第 ⑧ 条那句"查锁≠独占"的正面执行。
  收尾副作用与处置：这趟把 `apps/web/evidence` 重写 **41 个文件** ⇒ 链条末尾 `git checkout -- apps/web/evidence`
  （`EVIDENCE_DIRTY=41` → 还原后 0），理由同第 ⑨ 条（各 README 的"人已看"结论钉的是版本库那一份的 md5）。
- ⑫ **收尾第 2 条（死链）在本批这棵树上的现量**（04 06:2x，载体 `60459afc`）：
  `node research/tools/docs-link-check.mjs` ⇒ **`rc=0`，✅ 无死链、无"本机有仓库里没有"的链接、无失效章节引用、无失效锚点**（输出 19 行）。
  ⚠️ 取码方式记一下，因为它差点报错读数：第一次是 `… | tail -8; echo $?`，那个 `$?` 是 **`tail` 的**（§7 第 45 条同族），
  第二次改成先重定向再取码才拿到真正的 `RC=0`。✅ 那句"33 处死链"仍然只是**主检出**的属性，留在第 1 条原句旁不动。
  ⚠️ **同一条复核顺手量出 `check:md-tables` 的一个覆盖缺口**（不是本批造成的，但只有现量能说明）：
  它报"列数、断行与是不是表都一致"（`rc=0`），而**同一趟**我用 `re.findall(r'(?<!\\)\|')` 逐行数未转义竖线，
  发现那张交接表的"收尾"行有 **6 条未转义 `|`**（分隔行是 5）—— 其中多出来的那条是**代码段里的 `| tail`**，
  把这一行在渲染时切成五格。⇒ **这道门禁不看代码段里的竖线**，所以"md-tables 绿"**不能**被读成
  "表格列数对"。我自己那一处已改成 `` `\| tail` `` 转义；核对命令（谁都要能重跑）：
  `python3 -c "import re,io;[print(i+1,len(re.findall(r'(?<!\\\\)\\|',l))) for i,l in enumerate(io.open('docs/plans/countdown-batch2-handoff.md',encoding='utf-8').read().split('\n')) if l.startswith('| 收尾')]"`
  —— 判据是**行首那格的竖线数与分隔行逐字相等**。这条属于别人那条线（门禁本身）的账，本批只登记不代改。

- ⑬ **收尾第 4 条（四端重装）此刻没开窗，开没开用仓里现成的闸门量**（04 06:3x 现量，载体 `895ad07c`）：
  `bash scripts/verify-mobile-window-gate.sh --target b` ⇒ **`RC_WINGATE_B=3`**，四条前置 **3 ✅ / 1 ❌**：
  ✅ `packages/ apps/ server/` 无未提交修改 · ✅ `scripts/reinstall-all.sh` 干净 ·
  ✅ iOS 有已启动模拟器（**三台**：`heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta`）·
  ❌ **1 分钟负载 18 > 阈值 12（16 核，阈值 = `hw.ncpu × 3/4`）**。
  ⚠️ 同趟 `adb devices` 在线设备 = **0 台**（本机 AVD 两个：`SSOS-Parity-A36` / `heyta-w3-yearly`，都没起）
  ⇒ Android 那一端此刻连"可达"都不成立（`scripts/reinstall-all.sh:299` 会打印
  "🔴 模拟器 emulator-5554 不可达——先起模拟器"并以该段的红收尾）。
  🔴 **另一件事不是"在跑"，是"挂死"**：别人那条装包链的 `.reinstall-all.sh.snap.93817` 从 03:1x 起跑，
  它的子进程 `notarytool submit … --wait`（pid 98934）**06:3x 现量已 3 小时 21 分**，
  `/tmp/heyta-reinstall-mac.log` 自 **03:13** 起**零字节增量**、末行停在 `=== ⑥ 公证 ===`。
  它与本批的不变量**不相容**：`/Applications/Heyta.app`、`/tmp/heyta-macos-dist`、`windows-pc` 的
  `C:\src\heyta` 与随后的模拟器都是**同一批共享目标**（AGENTS §8.9）⇒ 不并发挤进去，
  等满按任务书第 8 条记 **exit 3 = 环境无效，不是产品失败**。
  ⚠️ 它的载体 `d0a81927` **不含**本批 HEAD（`git merge-base --is-ancestor 895ad07c d0a81927` ⇒ rc=1），
  所以"它已经装过一遍了"**不能**被读成"四端已经是当前产物"——那一趟装的是别人的源码。
  🔴 顺带查出打包脚本**两条属于别人面上的形状**（现量自 `apps/desktop-macos/scripts/package-app.sh:278-284`，
  **本批没改它** —— 它在主检出是 `MM`，正被另一条会话改着）：
  ① 那次公证提交**没有任何超时** ⇒ 一次挂死的 Apple 提交会把整条固定收尾无限期挂住，
  而 mac 段排在第一段 ⇒ 后面 windows / android / ios 三段**一条都不会跑**；
  ② `if xcrun notarytool submit … 2>&1 | tail -8 | awk '{print …}'; then` 判的是**管道最后一个命令**（`awk`）
  的退出码，而 `awk` 恒 0 ⇒ 那个 `🔴 公证失败` 分支**结构上不可达**，失败也会先打印"✅ 公证通过"，
  随后 `stapler staple` / `validate` 的失败同样只打印不判红。这是 §7 元规则二（一条永远通过的判据比没有更糟）
  在安装包这条线上的实例，与 §7 第 82 条**同族但不是同一件事**（82 讲"非空白挡不住错误屏"，这里讲**管道吃掉退出码**，
  即 §7 第 45 条那一族的又一面目）。
  📌 本机 Gatekeeper 现量（04 06:3x 重取）：`spctl --status` ⇒ **`assessments disabled`**（rc=1）
  ⇒ "这台机器上装出来的包打不打得开"**不能用本机 `spctl` 回答**，它的 `accepted` 只反映总开关被关。
  这条直接影响 Goal ⑤ 的读法：`reinstall:all` 的 mac 判据是"安装副本启动自截屏非空白 + **主蓝命中**"，
  **不是**"公证通过"，所以公证挂死卡住的是**打包链**，不是那条判据的含义。
- ⑭ **我自己犯的一条探针形状，记下来是因为它差点让本批白等 180 分钟**：
  上一版等待链（`/tmp/device-closeout-D.sh` 第 2 步）用
  `pgrep -f "queue-reinstall-all.sh|heyta-reinstall|notarytool submit"` 判"别人正在装包"，
  而**创建这份脚本的后台包装 shell（pid 78920）的 argv 里带着整份 heredoc 正文**，正文里就有这些字符串
  ⇒ 探针**永远命中自己**，窗口永远"没空"。同形状在 main 上 06:21 刚被记过一次
  （`dc63cbff`："③ 连退 23 轮的『别的移动端验收在跑』是闸门自拒绝——每次点名不同 pid 就是它的形状"）。
  ✅ 两条动作：**① 占用类探针必须豁免自己这一棵**（`grep -vE 'window-wait|device-closeout'`，
  并把"同一个 needle 在自己那棵上跑应为空"当自检），**② 别手搓负载/现场探针，用仓里现成的闸门**
  `scripts/verify-mobile-window-gate.sh --target <b|c>` —— 负载阈值、工作树未提交源码、iOS 设备名现取
  都在它里面，重写一遍就是再造一份会漂的抄件。新的等待链 `/tmp/window-wait-E.sh` 按这两条改过，
  起跑前把它自己的探针空跑了一遍：输出的 6 行**全是别人那条链**（81007 / 93771 / 93772 / 93817 / 95477 / 98934），
  没有一行是我自己的 —— 这就是"豁免成立"的现量证据。

- ⑯ **"人已看"那批图的 md5 锚点做了一次全仓自检**（04 06:4x，载体 `6cf31090`，纯只读）：
  `apps/web/evidence/**/README.md` 里成对写的「文件名 + 32 位 md5」共 **15 处**，
  与**版本库那份字节**逐一 `md5 -q` 比 ⇒ **12 对 / 3 错**。
  ✅ 12 对里本批的 8 处全在（`countdown-export/` 六张 + `admin-holiday/` 两张）；
  另外 `profile-panel/` 四处也匹配（那不是本批的）。
  🔴 **3 处全在 `apps/web/evidence/calendar-day/`，属日历线**（`git log -1` 那批图与 README 都出自 `5e23b7bf`，
  2026-10-03 23:58 "日历长出日视图与年视图"）：`day-en-full` / `day-en-no-timed` / `day-en-empty`。
  ⚠️ **而且这不是"pin 过期"，是这三枚锚点按构造就不可能稳定**：同一枚 `day-en-full.png` 在
  **三个载体上给出三组不同字节** —— README 里 pin 的是 `46d2e2fb…`、本分支跟踪的是 `66d071be…`、
  `origin/main` 上的是 `99d268cd…`；而他们自己的 README 写着那张图的页头是
  `Calendar / Sat, 10/3 / Back to today` —— **页头印的是"今天"** ⇒ 任何一天重跑那张图字节必然变。
  ⇒ 结论要写成一条纪律（谁的地盘谁改，本批不代改别人的 pin，因为改 pin 等于替他们重新"看过"那张图）：
  **md5 锚点只适合钉在"时钟被夹具冻住"的截图上**；含当前日期的截图要么冻 `setSystemTime`，
  要么钉**结构判据**（哪些格子存在、第几列在第几像素），不能钉字节。
  📌 这条自检顺带说明了本批先前那句"跑完 `git checkout -- apps/web/evidence` 还原 41 张"的**代价**：
  还原保住的是"pin 与跟踪字节一致"，代价是**丢掉了那一趟新渲染的读数** ——
  两者只能选一个，除非那个 spec 先把时钟冻住。⚠️ 本批没有把这一点写进还原那一步的理由里，现在补上。
  复核命令（只读，谁都能重跑）：**`node research/tools/check-evidence-pins.mjs`**（本批落库的装置，
  它**不挂进 `pnpm check`** —— 理由写在文件头：代改别人的 pin 等于替他们重新"看过"那张图，
  挂进门禁等于让别人那批红挡住这条线的绿）。判据 = **不匹配的 pin 数应为 0**，
  它自己还带一条**能失败**的自检：`node research/tools/check-evidence-pins.mjs --selftest`
  ⇒ `SELFTEST=ok 阳性样本=apps/web/evidence/admin-holiday/admin-holiday-papers-before-fix.png
  篡改末位后被判为不匹配（判据有牙）`，而 `apps/mobile/evidence` 那一趟报
  **`pin 0 处 ⇒ 这本身就该红`**（"数到 0"不算通过）。

- ⑰ **W8 那两栏"未取证"不是仪式——把门禁用的那枚锚点直接数到三枚产物上**（04 06:4x 现量，载体 `0c2c308a`；
  锚点 `countdown-view` 取自 `scripts/check-shell-surfaces.mjs:190` 那个 `webTestID`（同文件 `:644` 就是拿它去搜产物的那一行），
  **不是词条、不是文件名**，所以它在不在 = 那一屏有没有被真的编进产物）：

  | 产物 | `countdown-view` 命中 | `index.html` sha256 前 16 位 | 它是谁 |
  |---|---|---|---|
  | 本批 `apps/web/dist`（06:17 那趟 `pnpm build` 打的） | **1** | `517c6ba76d00fb25` | 本批当前源码的产物 |
  | `/tmp/heyta-macos-dist/Heyta.app/…/web-dist`（03:12） | **1** | `5ab36a445c57d290` | 别人那条链正在公证的那枚（载体 `d0a81927`，**不含本批 HEAD**） |
  | **`/Applications/Heyta.app/…/web-dist`（10-03 23:05）** | **0** | `217cae2a252d8948` | **此刻真正装在这台机器上的那枚** |

  🔴 第三行就是 Goal ⑤ 第 4 项存在的理由：**装在这台机器上的那份产物里没有倒数日那一屏**，
  而 `check:shell-surfaces` 那 5 格全绿（"通道在"）对此一无所知 —— 这正是 §7 第 27 / 82 条那族
  "测试全绿 ≠ 这是当前产物"的第四种面目，也是 W8 那两栏只能由 `reinstall:all` 关闭的原因。
  ✅ **把这一格改写成一条装前/装后配对的判据**（预登记在这里，装完直接量，不改门禁）：
  ①`grep -rc countdown-view /Applications/Heyta.app/Contents/Resources/web-dist/assets` 必须从 **0 变 ≥ 1**；
  ②那份 `web-dist/index.html` 的 sha256 必须**逐字等于打包那一刻 `apps/web/dist/index.html` 的 sha256**
  （口径与 §7 第 82 条同源：对账对象是"这次打包用的那份"，不是"上一轮记下的那个数"——
  现在记下的 `517c6ba76d00fb25` 只是**装前基线**，装完要重新现取两边再比）；
  ③原有那两条（自截屏非空白 + 主蓝命中）不动。
  ⚠️ 反面也要写清：**第二行的那枚包含这一屏，但它的载体不含本批 HEAD** ⇒ 它既不能算"装上了当前产物"，
  也不能拿来代替第一行 —— 这正是本批不并发挤进别人那条装包链、以及"对方装过了"这句话不算数的同一件事。

- ⑱ **收尾第 4 项的执行链已经写好并试过它会不会拒绝执行**（04 06:50，载体 `daa7e21a`）：
  `/tmp/device-closeout-F.sh` 的顺序是 **窗口复量 → 工作树必须干净 → 装前基线 → （需要时）headless 起
  `heyta-w3-yearly` 并等 `sys.boot_completed` → `pnpm reinstall:all` → §8.4 第 ⑰ 条那三条配对判据
  → `pnpm verify:mobile-card-export` → 重取 `check-shell-surfaces` / `check:card-export` → 还原 evidence**。
  🔴 **它的第一道判据已经被证明确实会拦**：现在就跑它 ⇒ `RC_F_GUARD=3`、日志
  `❌ 别人装包链还在 ⇒ 不并发（环境无效）`，在做任何安装动作**之前**就退出。
  ⚠️ 探针形状沿用的是第 ⑭ 条那两条（豁免自己这一棵 + 优先用仓里现成的闸门），不是重写一份占用判据。
  ⚠️ 这条脚本此刻在 `/tmp`（重启就没了）。**它不该落库成第二条链**：占用/负载/新鲜度这三件事
  `scripts/verify-mobile-window-gate.sh` 已经是唯一所有者，落库的正确动作是**给它加一个 `--target b --confirm`
  的执行分支**（它文件头本来就写了"加 `--confirm` 才真的执行"）—— 那是那条线（性能热路径/日历线共用它）的活，
  本批只把"这一趟要执行什么"逐行写在这里，等窗口一开由我按这份清单跑。
  ✅ **开工前的三处预检已经量掉**（04 06:5x，都是只读）：
  ①`emulator` 那条起设备的命令行**四个旋钮都存在**（`emulator --help` 的 `-no-audio` / `-no-boot-anim`
  / `-no-window`，`-no-snapshot-save` 在 `-help` 第 30 行；版本 37.1.11.0）—— 选 `-no-snapshot-save`
  是为了**退出时不覆盖别人那台 AVD 的快照**；
  ②`verify:mobile-card-export` 那条新鲜度门的 `HEYTA_REPO_ROOT` 解析自 `scripts/lib/mobile-e2e.sh:87`
  那个 `BASH_SOURCE` 的 `../..` ⇒ **在这条链的工作树里跑就是本批这棵树**，不会漂到主检出
  （漂了的话它比的是别人未提交的源码 mtime，那是一条会假绿的判据）；
  ③那条门的输入现量：`apps/mobile/src` + `packages/ui/src/countdown` 里最新一枚 `.ts(x)` 的 mtime =
  **10-04 04:30（epoch 1791059422）** ⇒ 窗口一开装出来的 APK（`lastUpdateTime` 必然晚于此刻）过得了这道门，
  **不需要**那个 `HEYTA_CARD_EXPORT_ALLOW_STALE=1` 旋钮（用了本轮读数就不代表当前源码）。

- ⑲ **W7 那条设备判据里"不需要设备的那半"提前量掉了**（04 06:5x，载体 `11916335`，全程只读 + 不碰任何设备）：
  ⓪`bash scripts/verify-mobile-card-export.sh` 在**没有设备**的现在跑 ⇒ **`RC=3`**、末行
  `❌ 设备 emulator-5554 不在线 —— 本轮无效（不是产品失败）`。⚠️ 这条读数差点又被我自己的管道吃掉：
  第一趟是 `… | head -30`，`head` 关管道把脚本**SIGPIPE 打死**，于是 `${PIPESTATUS[0]}` 空（这台机器的
  工具 shell 是 zsh，那个变量本来就是空的 —— §7 第 45 条那一族），而且在 `scripts/` 里留下一个
  `.verify-mobile-card-export.sh.snap.64269` 快照（它自己的 `trap … EXIT` 没机会跑）。
  残留已 `rm` 掉、工作树复量 0 脏，第二趟不带管道才拿到真的 `RC=3`。
  ①**判据①的两条腿**（读数器对两枚已知图，正是"现成图必须等于契约 / 对照必须不等"那一对）：

  ```
  card-light.png  ⇒ W=1080 H=1440 BYTES=66130 TRANSPARENT=false BLANK=false SMEARED=false   rc=0
  probe-3x2.png   ⇒ W=3    H=2    BYTES=94     TRANSPARENT=false BLANK=true  SMEARED=false   rc=0
  契约（从 shared-schema 产物读回）：EXPORT_CARD_EDGE_PX=1080  EXPORT_CARD_HEIGHT_PX=1440
  ```

  ⇒ 读数器**分得出 1080×1440 与 3×2**，`BLANK` 那位也一真一假 —— 也就是"设备出图 = 契约尺寸"
  这条判据**不是恒真断言**（§7 元规则二要求的阳性+阴性对照，这一半今天就能证，不必等窗口）。
  ⚠️ 仍然**只能等窗口**的是另外两件事：判据②（点导出前缓存里没有、点之后必须有）与判据③
  （设备落盘那枚字节的 IHDR 逐字等于契约）—— 它们要在真机/模拟器上按那一下。
  📌 这里也解释了一个先前的措辞为什么不够准：文档之前写"装置已落库并做过探针自检"，
  那句说的是**跑过**；本轮补的是**在不依赖设备的条件下把它再量一遍并记下每条读数**。

🔴 **待入 traps 三条（04 07:0x 重取号后改成「两条新条 + 一条并入既有 #201」；原句曾写"最大号 = **215**、行首编号命中 224 行"并预留 **#216/#217/#218** —— ⚠️ 那三个号此刻已被另一条会话的正文占用，现量：主检出工作树最大号 **218**、行首编号 **227** 行、`git show HEAD:docs/reference/environment-traps.md` 的最大号 **214**，而 216/217/218 三条的首句分别是"验收脚本在断言失败的那条路径上根本不写产物"/"落地页的生成物 HTML 里根本没有正文"/"`pnpm exec` 在 `node_modules` 是软链的检出里会先跑依赖状态校验"，与下面三条正文主题无关。📌 **"预留号"这件事本身就是错的**：台账是并行会话正在写的活文件，号只在搬运那一刻有效 —— 原句虽然已经写了"搬运那一刻再现量重取号"，但它没防住**我照抄自己写下的号**）**：

- **待入新条 A（原登记号"待入 #216"作废）—— 组件注释里那句"测试环境不会触发 X"是一条会被上游推翻的断言，而它会诱导下一个人再写一次错的定位。**
  `DueEditor.tsx` 写着"jsdom 不触发 `toggle` ⇒ 面板回落在水流布局"，据此用例从 `container` 里找格子里的东西；
  实测 **jsdom 27 会在一个宏任务里派发 `toggle`**（`HTMLDetailsElement-impl.js:27` 就是 `setTimeout(…, 0)`），
  而 `requestAnimationFrame` 在第 17ms 回调 ⇒ 用例里那句 `await`（真 IndexedDB 往返）一旦跨过 17ms，
  面板已经整块搬到 `document.body` 的 Portal，`container.querySelector` 得到 `null`。
  症状是"某个元素 expected null"，机器空时绿、负载高时红，看起来像产品坏了。
  三条动作：**面板有两副身体的组件，面板内的东西一律从 `document` 取**（连没报红的那条腿一起改）；
  **注释里的环境断言要当成断言去证**，不当事实继承；**探针自己带同刻正向对照**
  （先手动 `dispatchEvent` 证明监听器接得上，否则"0 次"分不清"没触发"和"够不着"）。
- **待入新条 B（原登记号"待入 #217"作废）—— `aspect-ratio` + `grid` 的 `1fr` 自动最小，会把"内容变高"变成"列变宽"，整块溢出容器。**
  `repeat(7, 1fr)` 的轨道最小值是 `auto` = 内容最小尺寸；grid 项又带 `aspect-ratio: 1`，
  于是它的**最小宽由自己的高度反推**。给格子加第三行内容（一个 11px 的字）之后：
  内容高 37.5px ⇒ 轨道 37.5px ⇒ `37.5×7 = 263px` 而容器 189px（`scrollWidth > clientWidth`）
  ⇒ 同一个月份里两副 grid 逐列错位 −5.25…−68.25px，右边约两列画在侧栏外。
  两条可迁移的：**① 等宽多列要钉住就得写 `minmax(0, 1fr)`**，`1fr` 只是"平均分"不是"不许被撑开"；
  **② 反证一条几何猜测时先确认你算的那一维就是缺陷所在的那一维** ——
  我那条"11px 的字撑不开 26px 的轨道"算术全程正确，但它算的是**宽度**，
  而缺陷从**高度**绕道进来，于是它把真缺陷判成了"不可能"。
- ~~待入 #218~~ → **并入既有 #201，不另立新号**（04 07:0x 现量：`grep -cE '^(201|202)\. '` 对 `git show HEAD:docs/reference/environment-traps.md` = **2** ⇒ #201 早已提交，而我把它登记成了一条新条）。#201 的坏法① 正是"粗 `grep -E` 把**观察者自己**那条命令行也算进去"，与我这条同因；按 AGENTS §8 第 8 条"同类事故扩充原条"，只带**两点增量**过去：
  - **增量一（反向面目）：排除式过滤会把自己的每一行都滤掉** —— 我为了排掉 `ps -eo pid,etime,command` 的首列写了 `grep -vE '^ *[0-9]+ '`，而**每一行**都以数字开头 ⇒ 集合恒空 ⇒ "没人占用"永远为真。#201 讲的是"命中自己 ⇒ 恒红"，这一条是"**滤掉全部 ⇒ 恒绿**"，是同族的第四种面目，而且方向相反、更难被察觉（它永远不报任何东西）。
  - **增量二（"安静地一直等待"的指纹）**：自匹配那一型**不会报错**，只会永远判"窗口没空"，而**每次点名都是不同 pid 正是"命中自己"的指纹**（对方在换进程是另一种形状：同一 pid 的 etime 在长）—— 这两件事必须在输出里区分开，否则下一个 agent 会去追一个不存在的占用者。
  - **增量三（动作，原文三条保留）：① 探针排除自己**按自己脚本名的字面量 `grep -v`（不是按行首列），并配一条**阳性对照**（同一模式对未过滤集合应命中 ≥1），"同一 needle 在自己那棵上跑应为空"写成自检项；**② 现场判据优先用仓里现成的闸门**，负载阈值 / 工作树未提交源码 / 设备名现取一旦被手搓第二遍就是第二份会漂的抄件；**③ 长等待要带终局**（有界轮数 + 到点 `exit 3` = 环境无效 —— 无限等的链条在输出上与"正在正常推进"完全一样）。

- ⑳ **设备收尾链 G 的读数：android 端这一腿闭合，但 G 自己写的那道"工作树脏"守卫把我自己的后续两段饿死了**（04 06:59:32–07:08:24，载体 `3ccece63`，日志 `/tmp/device-closeout-G.log`）：

  | 那一格 | 读数 | 归因 |
  |---|---|---|
  | `RC_ANDROID` | **0** | 清旧包 → 重打（64M release APK）→ 模拟器全新安装 → `mCurrentFocus=Window{com.heyta/…MainActivity}` → 窗口 1080×2400、内容占比 **58.3%**、**主蓝命中 4001**。**图我打开了看过**：首装弹的是「在使用联网功能之前」授权卡（中英词条、两个按钮、「服务条款/隐私政策」两条链接都在），也就是"装进去的是当前源码的界面"这条判据成立，但它**不是**倒数日屏 —— 倒数日那一屏在设备上的证据只能由下面那格给 |
  | `RC_CARDEXPORT_DEV` | **3** | **真外部占用**：那一刻另一条会话的 `heyta-wt-reinstall/scripts/.verify-mobile-notes.sh.snap.91783` 占着同一台设备 ⇒ 现场门按 §8.9 拒绝起跑。环境无效，不是产品失败 |
  | `RC_WINDOWS` / `RC_IOS` | **skip（工作树脏 1）** | 🔴 **这一格是我自己造成的**：G 的守卫写的是全树 `git status --porcelain \| wc -l`，而它要防的是"装上的是不是当前**源码**"（§7 第 82 条）；同一分钟我正在编辑本单文档 ⇒ 两段被我自己挡在门外。**症状与外部阻塞长得一模一样**，日志里只留一个数字、不留那几行路径，所以第一眼读成了"又被别人占了" |
  | `RC_MAC` | 未跑（这一档有别人在写） | `package-app.sh` + `notarytool submit` 此刻已跑 **4 小时 0 分**（07:0x 现量），且 07:0x 还多出一枚 `queue-reinstall-all.sh` ×2 ⇒ 本轮 macOS 端**没装**，按边界记环境无效 |
  | `RC_SURFACES_AFTER` | **0**（5 绿 0 红，未取证仍是 2 栏：`desktop-macos` / `desktop-windows` · 产物） | 与 04 04:5x 那次一致；那两栏只由 mac 段（被外部挡住）关闭 |
  | `RC_CARDEXPORT_GATE` | **0** | 这一条把 §8.4 第 ⑬ 条登记的"那臂打过 dist 又还原 ⇒ 收尾必须重取"**收掉了** |
  | 配对判据 | `PAIR_NEEDLE=0->0`、`PAIR_SHA_APP=217cae2a252d8948->217cae2a252d8948`、`SHA_EQUAL=no` | **与"本轮没装 mac"自洽**（装前 needle 就是 0，装后仍 0 ⇒ 不是"装坏了"，是"没装"）。这条判据的价值在于它**不许**我把 0→0 读成"验证通过" |

  ✅ 修法（链 H，`/tmp/device-closeout-H.sh`）：脏判据口径改成与仓内现成闸门一致（`git status --porcelain -- packages apps server scripts e2e`），并且**收窄判据的同一趟就证明它还有牙** —— 往 `packages/ui/src/countdown/card-export-layout.ts` 追加一行注释 ⇒ 计数 **0 → 1**，`git checkout --` 还原 ⇒ **回到 0**（只测"改后=1"不测"还原后=0"是半个判据）。守卫打印的也从"一个数字"改成**具体那几行路径**。
  📌 一般规律：**"我是不是把别人挡住了"和"别人是不是把我挡住了"必须用同一把尺子量**，而尺子的口径要等于它要防的那件事 —— 用"全树脏"去防"源码不是当前"，就会把文档编辑、e2e 重写过的 evidence 全都算成阻塞者。

- ㉑ **本单两张表各有一行是坏的，而常驻门禁 `check:md-tables` 两处都没抓到**（04 07:1x 现量，全 docs 扫描）：
  ① 本文件 §8.2 一览表的 **W4b 那一行**（原 `:1878`）被两个换行断成三段 —— 行尾**少了收口的 `|`**，
  于是"改前/改后两张图 md5 不同…"和"看图后的两条例外…"变成了表外的散文，**紧跟其后的 `L'` 与"收尾"两行成了没有表头的续表**。
  ② `countdown-batch2-handoff.md:97` 的 **W7 那一行**未转义竖线 **7** 而该表分隔行是 **5** ——
  多出来的两个来自 `` `grep -icE "ios|simctl|swift"` ``：**代码片段里的 `|` 在表单元格里仍然是分隔符**
  （GFM 先按原始行切单元格，再解析行内标记），所以它不是"样式问题"而是那一行的后两格整体错位。
  ✅ 两处都已就地修（① 合并回一行、1665 字符、未转义竖线 **6** = 分隔行；② 那两个改成 `\|`）。
  复扫结果：本单两份文档坏行 **0**。
  ⚠️ **但这两处本来就该由门禁响** —— `check:md-tables` 现在 rc=0 而两处缺陷都在它声称覆盖的范围内
  （它自己打印"列数、断行与'是不是表'都一致"）。~~它漏的正是这两型：**行尾少 `|`**、**代码片段内的 `|`**。~~
  🔴 **04 08:1x 现量否证了这句**（详见第 ㉕ 条）：三种形状喂进**同一把**现脚本 ⇒ 行尾少 `|` 报
  `列数 1（表头 2）`、代码段裸 `|` 报 `列数 3（表头 2）`，**两型都抓得到**。真正放走它的是
  **两型互相抵消**的那一行（少一格 + 多一格 ⇒ 计数恰好等于表头）。我登记的是"当时看到的相关性"，不是机制。
  🔴 加强它之前要先量基线：**全 `docs/**/*.md` 用同一把尺扫出 51 处列数不符**（`docs/README.md:212`、
  `docs/plans/goal-multi-end-coverage.md:106/109` 等，都不是本批的文件）⇒ 新判据必须**带基线**
  （只拦"净增"，像 `check:l4` 那条"内联只减不增"一样），否则一落地就红在别人的旧账上，
  而按纪律那些旧账不由本批代改。号 **DOCS-GATE-G1**（自造短号。⚠️ 命名空间归属**第一次量错了**：
  我当时跑的是 `grep -rn "DOCS-GATE" docs scripts \| wc -l` ⇒ **2**，而那两命中就是我自己刚写下的这两行 ——
  编号自锚检查必须**排除自己**。排除后的真读数：本仓 `grep -rn "DOCS-GATE" docs scripts \| grep -vc countdown` = **0**，
  主检出同一把尺 = **0** ⇒ 命名空间确实是空的），
  实施要动 `scripts/`，排在设备窗口之后。

- ㉒ **链 H 的三格读数 + 新鲜度门在真设备上第一次执行就照出探针自己的形状错**（04 07:11:09–07:15:34，载体 `93a5ea61`→`fb3fddfb`，日志 `/tmp/device-closeout-H.log`）：

  ① **`RC_WINDOWS=0`：windows 端装上当前产物了**，而且它带回来一条比门禁更硬的读数 ——
  `远端新鲜度对账通过（web-dist/index.html=517c6ba76d00fb25… bridge=2623f10eb2e1e12e… assets/*.js=7 枚一致）`，
  而 `517c6ba76d00fb25` 与本链起点行独立打印的**本工作树 `apps/web/dist/index.html` 的 sha 前缀逐字相同**
  （起点：`装前基线：… 本批 dist sha=517c6ba76d00fb25`）⇒ "远端字节 == 本地当前工作树"这条 §7 第 82 条的判据成立。
  🔴 **但门禁那一栏仍然报"未取证"**，而这**不是取证不存在**：`check-shell-surfaces.mjs:778` 给 desktop-windows 通道写死
  `artifactWebDist: null`，而 `:821` 那个分支在 `:831` 读 `HEYTA_WINDOWS_WEB_DIST` **之前就短路** ——
  也就是说本台账那句"那两栏只由 `pnpm reinstall:all` 关闭"对 **windows 这一栏结构上不成立**。
  已登记 **W8-GAP-W1**（任务 #20：把远端已经算出的那几个值 + 装好的包里 `countdown-view` 的命中数落成机器可读取证文件，
  门禁 D4 对 `null` 通道改成读它，配对判据原样保留；三臂变异）。原句不删，就地标注它被哪条现量否证。
  ② **`RC_IOS=1`：两个缺陷叠在一起，而只有一个是我的。** 我的：`MYSIM_UDID=$(xcrun simctl create …)` 把
  **错误文本当成了 UDID**（`simctl create` 失败时把话写到 stdout），于是链里出现"我自己造的模拟器 Unable to create a device…"
  这种读起来像成功的行。不是我的：`reinstall-all` 的 ios 段**行为正确** —— 它看到"有 3 台已启动模拟器且没有一台叫
  `heyta-batch2-closeout`"就拒跑并打印"不猜（这一段会 `simctl uninstall`）"，正是 §8.9 要的（那三台是别人的）。
  根因是 `iPhone-17-Pro @ iOS-27-1` 这一对不被接受（runtime 与机型都在列表里，但组合不行）。链 I 改成
  **只认 36 位 UDID 形状 + 单独收 stderr + 按候选对逐个试**。
  ③ **`RC_CARDEXPORT_DEV=3` 连着两次，两次的原因不同**：第一次（07:11:10）报"读不到 `com.heyta` 的安装时间（应用没装？）"
  —— 现量 `dumpsys package com.heyta` 里明明白白有 `lastUpdateTime=2026-10-04 07:05:07`，**是探针读不出格式**：
  那句 `sed 's/.*=//;s/ .*//'` 对格式化日期剥出 `2026-10-04`，过不了整数判定。这条判据从没在真设备上执行过
  （前几趟都停在第 0 步的现场门），所以它一执行就红在**探针**身上。已修 `644130c7`（两种形状都吃 +
  "epoch 不早于 2020-01-01"的前提断言），并且**负向臂量过**：把 `apps/mobile/src/screens/CalendarScreen.tsx`
  的 mtime 推到此刻 ⇒ `RC=3`、打印 `装的是旧产物：移动端源码最新 1791069554 > 包 1791068707`，随后按原值
  `202610040206.47` 还原。第二次（07:19:xx）报的**就是这条负向读数本身**——因为 `git checkout --` 还原探针文件时
  把 `card-export-layout.ts` 的 mtime 推到了 07:11:05，比 07:05:07 装的那个包新 358 秒。
  ✅ 处置是**重装**（门要的就是这个），不是把 mtime 抹回去骗过它 —— 后者正是 §7 元规则二禁的那种"让判据闭嘴"。
  ④ `RC_MAC` 仍未跑：`package-app.sh` + `notarytool submit` 此刻 **4 小时 03 分**（07:15:33 现量），
  且 07:0x 起还多出两枚 `queue-reinstall-all.sh`。链 I 每次开工前重查这一档。

- ㉓ **链 I：android 端第二次装上当前产物，随后设备出图那一趟卡在探针上**（04 07:22:00–07:33:36，载体 `ab4c706b`→`b3ede439`，日志 `/tmp/device-closeout-I.log`）：
  `RC_ANDROID=0`（窗口 1080×2400、内容占比 58.3%、主蓝命中 4001）、`RC_SURFACES_AFTER=0`（5 绿 / 0 红，未取证仍 2 栏）、
  `RC_CARDEXPORT_GATE=0`、`RC_IOS=1`（见第 ㉔ 条）、`RC_MAC` 未跑（这一档仍被占，07:33:35 现量 4h21m）。
  新鲜度门这回**放行**：`lastUpdateTime=2026-10-04 07:22:38 ⇒ epoch 1791069758` ≥ 源码最新；
  判据①两腿也照旧绿（正向 `1080×1440 SHA=221f0d78811c` / 反向 `3×2 BLANK=true`）。
  🔴 然后第 2 步红在**探针**：`❌ 底部找不到「我的」这一格` —— 而它自己打印的界面文本清单里**最后一行就是「我的」**。
  根因量清了（同一台设备、同一份 dump、bash 里跑，zsh 那次读数无效）：
  `scroll_to_text` / `scroll_to_desc` 走的是 `*-sane` 模式，带一条 `cy < 2100` 守卫
  （防"ScrollView 折叠线以下的节点照样在无障碍树里、按它的'中心点'点下去会跳到别的标签页"，
  理由写在 `scripts/lib/mobile-e2e.sh:1259` 那段注释里）。**底栏自己的中心天然就在 2100 以下**：
  「我的」那颗可点 View 是 `bounds=[864,2169][1080,2337]` ⇒ 中心 **2253** ⇒ 被守卫滤掉 ⇒ **恒空**。
  三种取法同时量：`xy_desc`=**972 2253**、`scroll_to_desc`=**空**、`scroll_to_text`=**空**。
  ✅ 修 `80f7be46`：底栏目标改走 `xy_desc`（不写死 `945 2253` 那种字面坐标 —— 兄弟脚本里那种硬码是旧账）。
  ⚠️ 顺带一条方法论：**我第一版这个诊断是在 zsh 里 `source` 那个 lib 做的，三个读数全空，
  看起来"证实"了守卫没问题而界面有问题** —— 真因是 lib 里 `ADB="adb -s …"` 这种"变量装命令"的写法
  在 zsh 下不做词分割（`command not found: adb -s emulator-5554`）。**换 shell 复跑之前那些读数一律作废**。

- ㉔ 🔴 **W7 的 iOS 原生模块从来没编过译**：`reinstall-all --only ios` 第一次真跑到 `xcodebuild`
  ⇒ **`BUILD FAILED`，22 条 error 全在 `apps/mobile/ios/Heyta/HeytaCardExportModule.swift`**，
  首条是 `:52:42 error: cannot find type 'RCTPromiseResolveBlock' in scope`（连带 `'@escaping' only applies to function types` 与
  `RCTPromiseRejectBlock` 同一条）。根因只有一行：那份文件只写了 `import Foundation`，
  而同仓兄弟模块 `HeytaReminderModule.swift:3` / `HeytaVaultSecureStorage.swift:3` 都写着 **`import React`**
  （那两个 typedef 是 React 的 ObjC 类型）。✅ 已修 `7c63411b`。
  ⚠️ **为什么门禁全绿而它还是坏了**：`check:card-export` 数的是 **pbxproj 里有没有这两个文件**
  （它自己的文件头就写着这条用途），TS 侧 `card-export.spec.ts` 21 passed 量的是 JS 折算逻辑 ——
  **没有任何一层跑过 Swift 编译器**。这正是 AGENTS §6.1.1 那句"门禁绿 ≠ 能打包"的第四次现形
  （前三次：#27 旧 bundle、#28、#31）。
  🔴 所以台账里"W7 iOS 侧代码链闭合"这句**当时就不成立**，正确说法是"代码写完了、注册进 target 了、**没编过**"。
  ⚠️ 修完之后**仍未验**（要 `xcodebuild` 再跑一趟，而它顺带把 `Podfile.lock` 的 `hermes-engine` 哈希改了
  一行、把 `project.pbxproj` 重排了 5 行 —— 两处都是工具噪声，已 `git checkout --` 还原，
  但每次跑 ios 段都会再脏一次，这是这台机器的既有条件，不是本轮引入的）。
  ✅ **后半句已验掉**（04 07:4x，链 J）：`--only ios` 真跑到 `xcodebuild` 并装进我那台新模拟器 ⇒
  `RC_IOS=0`，`构建日志里 error: 命中` 从 **22 条降到 2 条**，剩下 2 条逐行读是**噪声不是缺陷**：
  它们是某条**警告引用的 C++ 代码片段本身**（`/tmp/heyta-reinstall-ios-build.log:33575` 与 `:33833` 都是
  `324 |         " execution error: " + std::string(errorMessage));` —— needle 命中的是那串**字符串字面量**，
  不是一条编译错误）。我原先按 `grep -c 'error:'` 报数，那是**探针的形状错** —— 判构建好坏只认
  `RC` + `✅ 构建成功` + 装上了 + 截图非空白且主蓝命中（§7 第 82 条那把尺）。

- ㉕ **W7-G3 的 iOS 探针落地；顺带把"取值层"抽成两端单一所有者**（04 07:5x–08:0x，无设备参与）
  新文件 `scripts/verify-mobile-card-export-ios.sh` + `scripts/lib/card-export-probe.sh`，
  入口 `pnpm verify:mobile-card-export:ios`。**跑之前**读数器就抓出我自己三处假设：
  第一版写的 `web.consent.title` / `mobile.consent.localOnly` / `mobile.welcome.offlineFirst`
  **三个全部非零退出**（`node scripts/verify-mobile-card-export-read.mjs zh <key>` 逐个量），
  真源是 `common.privacy.consent.title` / `common.privacy.consent.localOnly` / `mobile.welcome.offline`。
  🔴 第二条更值得记：导航判据原本用 `web.shell.views.countdown`，而它的 zh 值与「我的」页那个入口
  **是同一个串**（两个都读成「倒数纪念日」）⇒ "点了入口却没开屏"时树上仍有那个串，**这条永远为真**
  （§7 元规则二）。换成只有倒数日屏才产出的输入框占位符 / 空态句，判据才有牙。
  同一条纪律顺手用到树上：树就绪那条 `exit 3` 的门原先写着字面量「我的」，那是 i18n 抄件。
  ✅ 抽取按 §3.5 的收尾动作做了两半：Android 那条**删掉**本地那四份助手（`READER`/`zh`/`contract`/
  `read_png`/`field`）改为 source 共享层，判据①的正/反两腿自检也收进同一函数。
  ⚠️ **"零行为变化"的复跑读数还没取**：那一趟要占 `emulator-5554`，而 08:0x 现量另一条线
  （self-host 那条的 `queue-reinstall-all.sh`，pid 93817）正卡在 macOS 打包段 **4h51m**、
  android/ios 段还没轮到 ⇒ 现在上去就是互相制造假红。负载 14.36 也高于本机门槛 12（ncpu×3/4）。
  设备读数排在窗口之后，取到之前 W7-G3 不打勾。

- ㉖ **W8-GAP-W1 落地：那一栏不是"没取证"，是取证进不来**（04 08:2x，载体 `d5795246`→本次提交，无设备参与）
  交接 §0.5 的 W8 行上一轮已经把"那两栏只由 `reinstall:all` 关闭"改判成"windows 那栏**结构上**关不掉"，
  这一轮把那条结构缺陷补掉：`check-shell-surfaces.mjs:778` 给 desktop-windows 写死 `artifactWebDist: null`，
  而 `:821` 的 `=== null` 短路发生在 `:831` 读 `HEYTA_WINDOWS_WEB_DIST` **之前** ⇒ 本机有什么、env 给什么都判不到。
  ✅ 而事实文件其实**一直存在**：`package-msix.sh:78` 每次打包都把远端 `install-capture.txt`
  scp 回 `dist/windows/`（`reinstall-all.sh:265` 也在读它）—— 只是门禁没吃。
  ⇒ 补的是**消费侧**：windows 走一条自己的 D4（`artifactFacts` + `HEYTA_WINDOWS_FACTS` 覆盖），
  判三行新事实 + 与本地 dist 的 sha 对账；生产侧 `install-and-capture.ps1` 补发
  `PAYLOAD_INDEX_SHA` / `PAYLOAD_CHUNK_TOTAL` / `PAYLOAD_CHUNK_PRESENT`（脚本仍**纯 ASCII**，
  实测两个 ps1 非 ASCII 字节各 0、无 BOM —— §7 #83 那条）。
  📌 为什么需要 chunk 那两行而不止 sha：`PAYLOAD_WEBDIST=True` 只证明**一个文件在**，
  而"入口 HTML 进了包、chunk 没进去"的形状恰好是**窗口能开而内容空白**（§7 第 82 条同一族）。
  vite 把内容哈希后的 chunk 名写进 `index.html` ⇒ HTML 逐字相同才允许把"本地这一面在"
  **迁移**成"装进包里的字节里有"；迁移的前提是那张资源图真的齐。

  现量（本地那份旧事实文件缺三行 ⇒ 默认判**未取证**、严格模式判红，两档都如实）：
  `node scripts/check-shell-surfaces.mjs` ⇒ **rc=0，5 绿 / 0 红，未取证 2 栏**（mac + windows）；
  加 `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` ⇒ **rc=1**，两栏都折成红。
  同趟顺带量到本机那份 `/tmp/heyta-macos-dist` 的包 `index.html` sha 是 `5ab36a44…` 而本工作树
  是 `517c6ba7…` ⇒ **那是别的树打的包**，mac 的 D4 没被骗（这条对账早就有牙，本轮只是第一次看到它拦住）。
  本地 dist 的读数：`index.html` sha256 `517C6BA76D00…`，引用的 assets **2** 条。

  七臂台架（`/tmp/w8-rig.sh`，全合成取证文件、不碰打包机也不碰设备）：
  W1 值全对 ⇒ **rc=0** 且打印 `sha256 逐字相同（517C6BA76D00）… chunk 2/2 齐`；
  W2 `PAYLOAD_WEBDIST=False` ⇒ **rc=1**；W3 `present 1 / total 2` ⇒ **rc=1**（就是那个空白窗口形状）；
  W4 sha 不符 ⇒ **未取证，不算通过**（rc=0 但列进未取证清单）；W4b 同一份加严格模式 ⇒ **rc=1**；
  W5 **sha 对得上而那份 dist 里没有 `countdown-view`** ⇒ **rc=1** —— 这一臂是 marker grep 的牙，
  没有它整条 D4 就退化成"两边一致就行"；W6 事实文件在但缺那三行 ⇒ **未取证** + 指名生产方怎么补。
  ⚠️ **一条不能多读的边界**：那三行**还没在 Windows 上真跑过**。ps1 只在远端交互式会话里执行，
  本轮没有跑打包（打包机也归另一条线在用）。所以"这一栏能关了"的准确说法是
  **消费侧与判据已就位、且离线证明它有牙；生产侧待下一趟真实打包来发那三行**。
  在那之前 windows 的产物栏仍是未取证 —— 本轮**不**代它宣布关闭。

- ㉗ **W7 的「零法务变更」用门禁重取了一遍；同时量出 main 自己就红的那条不由本批吸收**（04 08:4x，载体 `8e4b5097`，无设备参与）
  ✅ 声明面三处现量：iOS `Info.plist` 里 `Photo|Camera` 命中 **0**；`HeytaCardExportModule.swift:73`
  写的是 `FileManager.default.temporaryDirectory`；Android `CardExportModule.kt:73` 写的是
  `File(reactApplicationContext.cacheDir, DIR_NAME)` + `:81` `FileProvider.getUriForFile`，
  **没有** `MediaStore`/相册写入，manifest 的 `<uses-permission>` 只有
  `INTERNET / POST_NOTIFICATIONS / SCHEDULE_EXACT_ALARM`。
  ⇒ "不申请照片"那句对外条款**逐字仍为真**，而且这轮不是我看代码下的结论，是
  `check:legal-permissions` 自己数出来的（它打印的登记表就是这个集合）。
  ⚠️ 顺手更正一处**我自己的探针错**：第一次查 Android 时我用 `find … | head -1` 取文件，
  命中的是 `CardExportPackage.kt`（注册壳），于是 `grep cacheDir` **0 命中** —— 那读起来像
  "模块没写缓存目录"。0 命中先问"我打的是不是那个对象"，这里换成读模块本体后 `:73` 就在那里。

  🔴 同一趟量到：`node scripts/check-legal-permissions.mjs` 在本树 **rc=1 / 7 条红**，
  但**七条全部与照片无关**，它们红的是"通知/精确闹钟已声明而条款还写着不申请"。归属逐条查过：
  `POST_NOTIFICATIONS` 由 `b0ba4a35`（W9 提醒原生投递，ADR-0051）带进来，而这把尺在
  **`origin/main` 上是同一份文件**（`git diff --stat origin/main HEAD -- scripts/check-legal-permissions.mjs` 为空），
  `git show origin/main:` 里 manifest 有那行（1）、`third-parties.ts` 里那句"不申请通知"有 2 处
  ⇒ **`origin/main` 自己就构成红**，不是本批带来的。
  🔴 而且**修法正在别人手里**：主检出 `packages/legal/src/documents/…` 一片是 ` M`（未提交），
  在主检出上直接跑这把尺 ⇒ **0 红** —— 也就是那六句正被并行会话翻。
  ~~五个文件是 ` M`~~ —— **这个枚数在 09:1x 已经过期，原地改成本轮现量**：
  `git -C <主检出> status --porcelain -- packages/legal | wc -l` = **10**，其中
  `documents/` 下具名九份（`ai-and-transfer data-rights minors permissions personal-info-list
  privacy subscription-refund terms third-parties`）。
  📌 枚数是**活树读数**不是属性（AGENTS §9 那段早在写同一件事：那句"3 个"六天内就变成"6 个"，
  现在轮到我自己把"5 个"写成"10 个"）—— 所以这一行往后只准写"现量命令 + 那一刻的数"。
  ⇒ 本批**不代改**（代改就是造一次三方冲突，且 §0.5 的 L 系列行早写过"六句必须一起翻并重跑 `check:legal-copy`"）。
  这条债的关闭判据：`node scripts/check-legal-permissions.mjs` rc=0，由 W9/legal 那条线取。
  ⚠️ 它同时是收尾第 1 项 `pnpm check` 的一处**已归因红灯**：那趟读数会把这一门报红，
  归因写在这里，不由本批用"翻条款"凑绿。

  探针侧的两条现场（都不算产品结论）：
  ① **只读前置三验全过**（04 08:3x）：按 `BID=com.heyta` 在那台模拟器上解析到
  `…/Bundle/Application/497FCD6D-…/Heyta.app`（rc=0）、data 容器下 `tmp/` 存在、
  新鲜度 `main.jsbundle mtime 1791071463 > 最新源码 1791069065`（差 2398 秒）⇒ 探针的
  step 0/0b 三个会 exit 3 的门口都不会白拒。
  ② `verify-mobile-window-gate.sh --target c` 现在**恒报"有移动端验收在跑"**，而报的 pid 每次都不在
  它自己留下的 `/tmp/_heyta_mobile_e2e_ps.txt` 快照里 —— 用一根改过文件名的副本跑同一段代码 ⇒
  报"没有别人"。差的就是原件自己的文件名被 `verify-mobile-[a-z-]+\.sh` 那根 needle 命中，
  而排除只排"自己 + 直接子进程"，命令替换里那个**孙进程**没被排掉。
  这条也在别人手里（`scripts/lib/mobile-e2e-runner-probe.sh` 的未提交 diff 正在加 window-gate 排除
  与夹具第 7 行），本批不代改。
  📌 我自己在这条链上**重新踩了一次 traps #168**：第一版手写
  `sysctl -n vm.loadavg | tr -d '{} '` ⇒ 三个值粘成 `15.1715.5822`，比较抛
  `integer expression expected`（日志留着那行）。而仓里那条规范实现的**文件头就写着这个坑**。
  改成 source `lib/wait-for-quiet-host.sh` 调 `wait_for_quiet_host` 之后才正常等窗口。
  ⇒ 链 K（`/tmp/device-closeout-K.sh` → `/tmp/device-closeout-K.log`）08:39:46 起跑，
  08:40:46 `RC_TREE=0` + 设备独占 + `负载 16 > 12` → `负载 11 ≤ 12` 开窗。
  ~~窗口开了才落 `RC_ANDROID` / `RC_IOS_PROBE` 两行，等满按 exit 3 记**本轮无效**~~
  —— 04 08:5x 两行都落了，读数与根因在下面的 ㉘（**两趟都是 exit 3：探针缺陷，不是产品失败**）。

- ㉘ **链 K 的两条 exit 3 各自照出探针的一个"恒真/错判"分支，两条都已就地改成正向判据**（04 08:5x，载体 `8e4b5097`）

  | 趟 | 读数 | 表面症状 | 现量根因 |
  |---|---|---|---|
  | Android（`/tmp/device-K-android.txt`） | `RC_ANDROID=3` | step 3 打印「屏上已有卡片，本轮不新增」，step 4 报 `❌ 从 a11y 名里剥不出卡片标题 —— 探针未到位` | step 3 那个分支判的是**「空态句不在树里」**，而它把"卡片菜单名读不出"也当成"有卡片"。只读取证（`adb shell uiautomator dump` + `mCurrentFocus=com.heyta/com.heytamobile.MainActivity`）证明屏上**确实**有一张卡 `w7e2e-073853`，但同时留着上一趟（07:41）没关的卡片菜单与 composer（`导出成品图 / 编辑 / 删除 / 置顶 / 给这一天起个名字 / 添加`）—— 那种状态下**菜单钮的 `content-desc` 整块不在树里**，所以下一节没有输入 |
  | iOS（`/tmp/device-K-ios.txt`） | `RC_IOS_PROBE=3`（step 2） | `❌ AX 树里读不到「我的」—— 树是空的还是没渲染？` | 树**不是空的**：只读 `describe-all` 数出 **11 个 label**，全是隐私同意面板的（`在使用联网功能之前 / 同意并联网 / 只用本机 / 服务条款 …`）。RN 的 modal 会把底部标签栏整个摘出 AX 树，而"归一化掉同意面板"那段代码住在**就绪判据之后** —— 于是就绪判据要求一个"浮层存在时必然不在"的标签。§7 #63 那种卡死形态的区别是 **label 数 0**，不是"某个标签缺失" |

  两处改法同一条口径（**判据要正向**，AGENTS §7 元规则 2）：
  ① Android step 3 现在**读卡片自己的菜单 a11y 名**作为"有一张点得到的卡"的证据，
  ~~读不到就按一次返回收浮层再读（最多 3 次），并且每次收完都验「屏还在倒数日屏」——
  带离现场就 `exit 3` 而不是继续~~ —— **这一半在链 L 上被现量否证**（BACK 把应用退到桌面，
  见 ㉚），归一化改成 step 2 之前 `am force-stop` 冷启动；
  两条正向出口都不成立时**响亮地** `exit 3`
  （旧版这里是静默走进下一节，才把红拖成看不懂的那条）。step 4 那段"拿空标题再去 XML 里剥"
  的兜底随之删掉（它正是被恒真分支喂空的地方）。
  ② iOS step 2 的就绪判据改成 `label 数 ≥ 2` **且** 三个顶层屏候选（主屏标签 / 同意面板标题 /
  欢迎页标签，值全部走读数器）任一在树里；step 3 之前新增"等标签真回到树上"的正向轮询
  （`press` 对不在树上的标签是**静默空操作**）；step 4 之前新增"composer 占位符必须在树里"
  —— 否则 `--field --set` 打的是"树上第一个输入域"，会把标题写进别的字段，
  再拿「添加」的 `enabled` 当成功读数（那是假绿，比红贵）。

  这两条新判据**有牙的证据**（同一趟，零设备）：拿 08:42 那份残留现场 `/tmp/ui.xml` 喂读数器
  ⇒ `READER_FAIL uiautomator 快照里没有带菜单 a11y 名的卡片` **rc=2**（新 step 3 不会 break，
  会走收浮层/空态/响亮 exit 三条路之一）；同一份文件注入一枚 `content-desc=「{title}」的操作`
  形式的节点（副本 `/tmp/ui-pos.xml`，用完即删）⇒ **rc=0 且回读标题** `probe-positive-card`。
  ⚠️ 另一处写法坑（同一趟学到，值得入档）：这两个脚本只 `set -u`、**没有 pipefail**，
  所以 `CARD_TITLE=$(node … 2>/dev/null | tr -d '\r\n') && break` 里的退出码是 `tr` 的 **0** ——
  用退出码判"取到了没有"会**每次都 break**，等于把新判据原样阉掉。已改成 `[ -n "$CARD_TITLE" ] && break`
  并在代码里写明为什么不用退出码。

  🔴 这两条 exit 3 **不**记成产品失败，也**不**算 W7-G3 的关闭：链 L（改后复跑）取到
  `RC_ANDROID=0` 与 `RC_IOS_PROBE=0`、并且 iOS 那张 `apps/mobile/evidence/card-export/ios-latest-card.png`
  被人打开看过之前，W7-G3 这一格不打勾。链 K 顺带证到的仍然有效：共享 lib 抽取后的
  判据①自检在**两端的载体上都跑绿**（正向 `1080×1440 SHA=221f0d78811c` / 反向 `3×2 BLANK=true`），
  也就是 §8.4 ㉕ 那句"零行为变化的复跑读数还没取"**只欠 step 3 之后的那几节**。

- ㉙ **收尾第 4 项（`pnpm reinstall:all` 四端装上当前产物）里 mac 这一腿，04 08:5x 现量被并行那条线的同一条流程占着 —— 本批不并发、不代它宣布关闭**

  只读 `ps` 取证（08:58）：

  ```
  81007 05:48:59 sh /tmp/queue-reinstall-all.sh
  93817 05:45:52 bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817
  95477 05:45:32 bash apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist
  98934 05:44:55 …/usr/bin/notarytool submit /tmp/heyta-macos-dist/Heyta-1.0.0.dmg … --wait
  ```

  · 归属查过（不是猜的）：那条链的隔离检出 `/tmp/heyta-reinstall` 在 **`main` 的 `d0a81927`
  （self-host 那条线的载体）**，而 `/tmp/reinstall-all-out.txt` 的最后一行停在
  `═══ 1. macOS：清旧包 → 打包 → 卸旧 → 装新 ═══` —— 也就是说它从 **03:13** 起就把
  `/tmp/heyta-macos-dist` 与 `/Applications/Heyta.app` 握在 `notarytool … --wait` 里，
  到 08:58 已经 **5 小时 45 分**（§8.4 第 ⑰ 条记的"公证无超时"那个形状，正是它）。
  · 为什么这一腿**不能**由本批并发跑：它写的是同两个目录（`/tmp/heyta-macos-dist` 与
  `/Applications/Heyta.app`），并且共用同一次公证档 —— 并发就是 §8.9 明令禁止的"抢不得"。
  · 🔴 **也不可以把他们那趟读数当本批的读数用**，但**理由不是"里面没有本批的东西"** ——
  ~~他们打的是 `main` 的产物、里面没有本批三笔~~ 这句**09:2x 逐笔现量后被否证，原地改掉**：
  `git merge-base --is-ancestor <本批提交> d0a81927` 逐条跑，结果是
  **`c28e5f1a` / `6735cc39` / `b05fbc50` / `67fef701` 四笔（W4b 的 ADR 定性与客户端拉取三笔）在他们的载体里**，
  而 **`a0d342df`（W7 iOS 探针）、`87109e9e`（W4b 判据②修复）、`8e4b5097`（W8-GAP-W1 取证通道）、
  `58cff57f`（本轮 iOS 探针修复）四笔不在**。
  ⇒ 正确的说法是：**他们的包里可能有 W4b 那一面，但没有 W7/W8 这几笔**；
  而"装上了当前产物"这句要求的是**当前提交**的产物，所以那一趟仍然不能替本批关闭任何一格。
  📌 这条更正的形状与 §9 那段"载体不含本批"是同一个：**判"某批在不在某个载体里"只能逐笔
  `--is-ancestor`，不能按分支名或按"它是 main"推**。
  · 唯一已经量到的差别：`/Applications/Heyta.app/Contents/Resources/web-dist/index.html`
  的时间戳停在 **10-03 23:05:40**（现量 `stat`），比本批任何一笔都旧 ⇒ "mac 装上了当前产物"
  这一句此刻**为假**，不写进任何打勾里。
  · 本批这一腿的关闭判据（等窗口开放后原样跑）：在**只含 `feat/countdown-batch2` 的隔离检出**里
  `bash scripts/reinstall-all.sh --only mac`，读它自己打印的 mac 段判据
  （安装副本启动自截屏：非空白 **且** 主蓝命中），并配对重跑 `check:shell-surfaces`。
  windows 那一腿同上（本机 `windows-pc` 可达已由他们那趟的 `WIN_OK` 顺带证到），
  但它要等同一台打包机空出来。

- ㉚ **链 L（修完 ㉘ 之后复跑）两条仍然 exit 3，但各自往下走了一层，并照出两个新缺陷：BACK 会把应用退到桌面、`--press` 对屏外节点是静默空操作**（04 09:0x，载体 `2987cfdb`）

  | 趟 | 读数 | 走到哪一步 | 现量根因 |
  |---|---|---|---|
  | Android `/tmp/device-L-android.txt` | `RC_ANDROID=3` | step 2 ✅（「倒数日屏开到前台」）→ step 3 第 1 次读不到菜单名 → **按 BACK 归一化** → `❌ 按返回之后连倒数日屏都没了` | 两件事叠在一起：① `ensure_app_foreground` **不 force-stop**，`lib/mobile-e2e.sh:653` 那句注释写着"调用方要冷启动时自己先 force-stop（现有脚本都这样做）"—— 本趟没做，于是上一趟留下的卡片菜单跟着**热启动**活了下来；② 我 ㉘ 那条"收浮层"选的手段是 `keyevent 4`，而在这台设备/这个屏上 **BACK 直接把应用退到桌面**（`screen_txt` 打出来的是 `Gmail / Photos / YouTube / Phone / Messages / Chrome / heyta` 这些启动器图标） |
  | iOS `/tmp/device-L-ios.txt` | `RC_IOS_PROBE=3` | step 0/0b/① ✅、step 2 **✅（label 数 11 + 同意面板收掉 + 离开欢迎页 —— ㉘ 那条就绪判据修对了）**、step 3 找到入口并"按"了 → 屏没开 → step 4 新加的正向门拒跑 | 只读 `describe-all` 量到：应用**仍停在「我的」页**（底栏 `我的` 带 `Selected`），而入口那颗按钮是 `AXFrame {{16, 926}, {370, 44}}` ⇒ 中心 y=**948**，屏高 **874** —— 它在滚动区里、**在屏幕外**。`--press` 对屏外坐标是**静默空操作**（ios-ax-shim.py 文件头第 2 条自己记着这条实测，`type_text` 里那句"先滚进可见区"就是为它写的），而 `--press` 只问 idb 退没退 0，照样回 `result: success` |

  两处修法（都不动共享工具，改在本探针里）：
  ① Android step 2 之前加 `$ADB shell am force-stop "$PKG"`（**冷启动负责残留状态**），
  step 3 里那个 BACK 归一化循环**整段撤掉** —— 归一化不能交给一个会把应用退干净的动作；
  判"有没有卡"仍然只看**菜单 a11y 名**这一个正向证据，读不到就走空态/响亮 exit 3。
  ② iOS 探针把 `press()` 重写成**先 `--scroll-into-view`、`visible=True` 才点**，
  并且"滚不进去"是**返回值**（关键导航点收 rc，不成立即 exit 3）；底部标签栏那颗走
  `press_raw` —— 因为 shim 的"可见"定义是 `中心 y < 屏高-120`（给标签栏让位），
  而 `我的` 那颗中心 y=808 > 754，按那条定义**永远不可见**、又不在滚动容器里滚不动。
  📌 一般形状：**"元素在树上"和"元素能被按到"是两个事实**，中间隔着一个视口；
  而一个把 tap 发出去就算成功的驱动层，会让"按过了"读起来和"按到了"完全一样。

  链 L 仍然有效地产出的读数（不因 exit 3 作废）：判据①的**共享自检在两端载体上都绿**
  （正向 `1080×1440 SHA=221f0d78811c` / 反向 `3×2 BLANK=true SHA=bf42e074e33c`），
  所以 §8.4 ㉕ 那句"取值层抽取零行为变化"现在**两端各自复跑过一次**；
  iOS 的 step 0/0b/①/② 也第一次跑通（`label 数 11` 那行就是 ㉘ 修好的那条判据）。

- ㉛ **W8-GAP-W1 那条通道第一次在真实现场读到"三态里的中间那一态"**（04 09:0x，载体 `20845edd`，现量命令 `node scripts/check-shell-surfaces.mjs` ⇒ `RC_SS=0`）

  之前 ㉖ 那七臂是**合成夹具**证的（"sha 对上而字节里没这一面"那一腿靠造出来的输入）。这一趟不用造：
  本机就同时躺着两种**真实**的"没取证"，而门禁把两者分开说了话 ——

  ```
  ⚠️ [desktop-windows] countdown · 产物 —— 未取证，不计为通过
     ⚠️ 取证文件在 …/dist/windows/install-capture.txt，但缺判据行 PAYLOAD_INDEX_SHA / …
        ⇒ 那一趟打包用的还是**没测这些事实的旧生产方**，本栏不计为通过。
  ⚠️ [desktop-macos] countdown · 产物 —— 未取证，不计为通过
     ⚠️ 包在 /tmp/heyta-macos-dist/…，但它那份 index.html 与本工作树的 apps/web/dist **sha256 不符**：
           包里 5ab36a445c57 / 本地 517c6ba76d00
           ⇒ 那是**别的检出／别的会话打的包，或旧产物**，不能当本轮的取证。
  ```

  · windows 那栏：文件确实在（`cat` 出 `PAYLOAD_WEBDIST=True` / `M2D=OK` / `RESULT=OK`，
  生产时间是 07:15），缺的正是㉖ 那三行 —— 因为生产方脚本的改动落在 **08:0x 的 `8e4b5097`**，
  晚于那趟打包。⇒ 这条通道现在报的是"**缺事实**"而不是"事实不对"，也**没有**因为
  `PAYLOAD_WEBDIST=True` 就顺推成通过。**关闭它只差一趟真跑 Windows 打包**（任务 #20，
  打包机现被 ㉙ 那条线占着）。
  · macOS 那栏：sha **不符**，而它不符的原因恰好就是 ㉙ 那个占用 —— 那枚包是并行那条线
  从**他们的载体**（`main` 的 `d0a81927`）打的。门禁把"别人的包"判成未取证而不是取证，
  正是 §7 第 82 条要挡的那件事（"绿了但装的是旧产物"）换了个方向：**绿了但量的是别人的产物**。
  · 同一趟另外两格也复取到了（`check:card-export` **RC_CE=0**，含"尺子自检：同一条正则喂已知
  命中的样本数得出 3 条"那条阳性对照；`check:md-tables` 与 `docs-link-check` 均 **rc=0**）。
  `check:shell-surfaces` 的整张表是 **5 格 / 5 绿 / 0 红 + 2 栏未取证**，五格分别是
  `web / mobile / desktop-macos / desktop-windows / desktop-linux` ⇒ Goal 第 ③ 项那句
  "壳级门禁三端齐"在**通道这一层**是现量成立的；不齐的只有"包里字节"那一层，缺的是取证不是代码。

- ㉜ **链 M 把两条红从"探针没到位"推进到"探针在判错事"，而设备侧现量证明 Android 的图早就画出来了**（04 09:1x，载体 `20845edd`）

  `RC_ANDROID=1`（不是 3 —— 环境门全过、走进了产品判据），`通过 5 项，失败 2 项`：

  | 那两条红 | 设备侧/源码侧的现量 | 判据到底错在哪 |
  |---|---|---|
  | `❌ 点了导出、缓存目录 10×3 秒内没有新文件` | `adb root` 后现量目录：`heyta-w7e2e-073853-10月11日 星期日.png  36493 B  mtime 2026-10-04 09:07` —— 文件**是这一趟写的**（设备时钟 09:11，运行区间 09:06–09:08） | 文件名由共享层 `cardExportFileName(标题, 锚日)` 决定、**不带时刻**，所以复用同一张卡再导 = **覆盖同名文件**；"目录里出现新文件名"这一判据在复用路径下**结构上不可能成立**（它不是"没牙"，是"永远说不"） |
  | `❌ 前台不是 com.heyta（…intentresolver/.ChooserActivityLauncher）` | `apps/mobile/src/lib/card-export.tsx:173` 就是 `Share.share({ title, url })` | 这条判据量的是"没有权限页"，写的却是"前台必须是我们的包"—— 而分享面板是这条通道**设计上的终点**。（顺带它成了出图成功的旁证：拿不到可解析的 uri，面板不会开） |

  两处改法（都不动产品）：① 判据②改成**由设备自己的时钟裁决**——"名字里带这张卡标题、
  且 mtime ≥ 本次点击时刻"，覆盖与新增两态都算，取不到设备时钟就 `exit 3`（判据没输入不硬判）；
  ② 第 6 节按不变量原形分四档：我们的窗口 / 分享面板（**预期**并打旁证）/ 权限·安装·崩溃页（红）/
  其它说不清的窗口（红）。新判据的牙在**零设备**的情况下先量过三臂（拿真快照喂 awk，
  多行程序原样跑）：真标题 + `t0=mtime-600` 命中；真标题 + `t0=mtime+60` **为空**；
  假标题 + `t0=mtime-600` **为空** —— 三条臂都按预期。（⚠️ 我第一版把这段 awk 压成一行喂进去，
  系统 awk 报 `syntax error` 让三臂全成空 —— 那是**夹具**错、不是判据错；照脚本里那份多行原样喂才对。）

  iOS 那条 `RC_IOS_PROBE=3` 同批修：㉘/㉚ 之后 step 3 已经**跑通**（倒数日屏开到前台），
  红落在 step 4 的"「添加」始终没启用"。读源码才知道这条判据在产品规则下**永远为假** ——
  `packages/ui/src/countdown/EventBoard.tsx:367` 是
  `canSubmit = draftTitle.trim() !== '' && draftDate !== undefined`，而 `:358` 的 `draftDate` 初值就是
  `undefined`：**没选日期之前「添加」必然不可点**，而旧版是在打字之后、选日期之前读的 enabled。
  顺带那趟现场还把 `set-value` 那条已知性质照得很干净：连按三次 set 之后字段回读是
  **双份**（`w7ios-090810w7ios-090810`）—— 原生被写了字、JS 态不知道，受控 TextInput 再把键入那份接上。
  现在按产品的顺序走：**键入（只走 `--type-text`，不再先 set）→ 选日期 → 这时候才读 enabled**，
  它成立意味着"标题与日期都进了应用的态"（条件正是 `canSubmit` 那一条，比原来强）；
  任一步滚不进可见区都 `exit 3` 并打印回读，不再靠下一节的连锁失败反推。
  ⏳ 链 N（`/tmp/device-closeout-N.log`）取到 `RC_ANDROID=0` + `RC_IOS_PROBE=0` 之前，
  W7-G3 与"Android 设备出图"这两格都还不打勾 —— ㉜ 说的只是**判据被修对**，不是**读数取到**。

- ㉝ **两条过期读数原地改正 + 一处"我自己的门禁第二次抓到我自己"**（04 09:1x）

  · ㉗ 里那句"主检出的 `packages/legal` **五个文件**是 ` M`"已过期：本轮现量
  `git status --porcelain -- packages/legal | wc -l` = **10**（`documents/` 下具名九份 + index 形状一枚）。
  划线留原句旁边，并把"枚数是活树读数不是属性"写进那一行 —— 同一条错在 AGENTS §9 那段
  已经发生过一次（"3 个"六天后变"6 个"），我自己在同一批里又犯了第三次。**从这次起，
  引用别人的脏文件数只准写现量命令 + 那一刻的数。**
  · §0.5 的「同步」行补了合流义务的**现量受阻**：主检出脏 **240** 枚，而 `AGENTS.md`、
  `package.json`、`e2e/tests/helpers.ts`、`e2e/tests/admin-console.spec.ts`、
  `scripts/lib/mobile-e2e-runner-probe.sh` **逐个都是 ` M`** ⇒ 三件事同时做不了
  （AGENTS §9 补写 / #18 那两份开机拉取夹具收敛 / window-gate 自匹配修复），
  全部登记为"在别人提交之后才有一步可做"，不代改、也不把"欠着"包装成"已排期"。
  · 🔴 而这次**我自己写这两处文档时又 broke 了一次表**：第一次是格子里写了裸 `|`
  （`git status --porcelain | wc -l`）⇒ 报"第 4/5 格"；第二次是转义之后我**把行尾的闭合 `|`
  删掉了没带回**（python 里 `line[:-1].rstrip() + add`，`add` 结尾没有竖线）⇒ 报"列数 3（本表表头是 4）"。
  两次都是 DOCS-GATE-G1（§8.4 第 ⑲ 条那把尺）在**提交之前**拦下来的，也是它这一批里
  第二次抓到作者本人 —— 这条记在这里是为了让下一个改这张表的人知道：
  **改完就 `node scripts/check-md-table-rows.mjs`，别靠眼睛。**

- ㉞ **链 N：Android 设备出图跑到最终态（`RC_ANDROID=0`，11 项全过），iOS 又往下露出一处探针缺陷**（04 09:1x–09:2x，载体 `7806f6ae`）

  · `RC_ANDROID=0`，`通过 11 项，失败 0 项`。三条判据的读数：
  ① 读数器双对照（正向 `1080×1440 SHA=221f0d78811c` / 反向 `3×2 BLANK=true`）；
  ② **复用屏上已有卡** `w7e2e-073853`（正向证据 = 它的菜单 a11y 名在树里），点导出后
  `heyta-w7e2e-073853-10月11日 星期日.png` 的 mtime 晚于本次点击（设备时钟）；
  ③ 拉回本机数 IHDR：`W=1080 H=1440 BYTES=36493 TRANSPARENT=false BLANK=false SMEARED=false SHA=d6d2a88788d1`
  = 契约那一对数；末了前台仍是 `com.heyta`（分享面板已收），全程零权限页。
  🔴 **这同时把 ㉕ 欠的那句"零行为变化的复跑读数"补上了**：07:41 与 09:18 两趟之间隔着
  取值层抽取 + 三条判据修复，而**产物字节的 SHA 逐字相同** —— 这比"测试仍然绿"强，
  因为比的是字节不是断言。
  · 第二次人看图时做了一件第一次没做的事：把设备那张与 web 那张
  （`apps/web/evidence/countdown-export/card-light.png`）**并排比版面**，逐项对得上 ⇒
  "中间那一大片空白"是共享版面的设计，不是设备栅格化画歪了。这句话只看单张图说不出来，
  已写进 `apps/mobile/evidence/card-export/README.md`。
  · `RC_IOS_PROBE=3`：step 2/3 这次**全过**（屏开到倒数日屏），红在 step 4 第一行
  `↳ 「给这一天起个名字」滚不进可见区（False/element-left-tree）`。根因是探针自己的：
  ㉚ 那版 `press()` 带着 `--pressable` 这层过滤，而 shim 的 `is_pressable` 只认 Button 那一类
  —— **`AXTextField` 不算 pressable**，于是"定位"返回 found=False，`scroll_into_view`
  把它报成"元素从树上离开"。屏上明明有输入框（09:0x 那趟的 `describe-all` 里它是
  `{{17,192},{200.7,42}}` 的 `AXTextField`），探针却说它消失了 —— 这是**探针够不着**，
  不是产品没有输入框。修法：输入框走 `--field` 那一侧（新增 `focus_field()`：
  `--field --scroll-into-view` 再 `--field --press`），按按钮仍走 `--pressable`。
  ⏳ W7-G3 仍然不打勾，直到链 O 取到 `RC_IOS_PROBE=0` 且那张 iOS 成品图被打开看过。

- ㉟ **链 O：打字这一档过了，下一档又露出"iOS 的 AX 树只给 accessibilityLabel、不给子文本"**（04 09:2x，载体 `abd14e6e`）

  `RC_IOS_PROBE=3`，但两处前进是实的：`type-text` 回读 `{"found":"True","typedRc":"0","detail":"w7ios-092535"}`
  —— **单份、干净**（㉞ 那个 `--field` 修法生效，双份字符串那个症状没了）；就绪判据也读到 `label 数 21`。
  红在下一行：`↳ 「选日期」滚不进可见区（False/element-left-tree）`。根因还是探针：
  `EventBoard.tsx:443` 那颗按钮的 `accessibilityLabel` 是 `labels.fieldDate`（键
  `web.countdown.field.date` = 「日期」），而「选日期」是它**里面的 Text 子节点**（`:456`）。
  RN-Android 的 uiautomator 会把子文本一起序列化（所以 Android 那趟按「选日期」是对的），
  iOS 的 AX 树只暴露 `accessibilityLabel` —— 09:0x 的 `describe-all` 里那颗按钮就是
  `'日期' | {{226.7,191},{85.3,44}} | AXButton`，树上根本没有「选日期」三个字。
  ⇒ 探针改按 `web.countdown.field.date` 走，并在开日期面板前先收键盘（面板与键盘在同一侧，
  不收会整片按不到）。**四个键名在碰设备之前先过读数器**（`zh` 模式逐条 rc=0）——
  这是同一把尺第三次在开工前抓住探针自己的假设（前两次：㉘ 的三个假键、㉞ 的 pressable 过滤）。
  ⏳ 仍然不打勾，等链 P 的 `RC_IOS_PROBE=0` + 那张图被打开看过。

- ㊱ **链 P：iOS 探针第一次走到产品判据，判红判在真缺陷上 —— 根因是我们自己那条桥的 JS 名字，而那条"三处名字对齐"的判据钉的是错的对象**（04 09:3x，载体 `198603f5`）
  `RC_IOS_PROBE=1`（通过 9 项 / 失败 1 项）。前五趟都死在 `exit 3`（"本轮无效"），这一趟第一次把
  判据②跑起来并判红：`点了导出，沙盒 …/tmp/card-export 里没有出现新文件`。
  🔴 **这一条红不是探针够不着**，三条读数各自排掉一层：
  ① 不是"没点到"——同一时刻按相邻那颗「收起…」菜单钮，菜单**真的收了**（`编辑` 从树上消失），
  且系统日志里两次触摸都留着 `send gesture actions`；`导出成品图` 这一格在树上的读数是
  `{{43, 414}, {96, 44}} | AXButton | enabled:true`，`--press` 回 `success`。
  ② 不是"原生文件没进 target"——`nm` 在 07:51 那枚**装着的**二进制里读到
  `+[HeytaCardExportModule(RCTExternModule) moduleName]` 与 `writePngBase64…` 的符号。
  ③ 分叉只剩"RNSVG 的 `toDataURL` 不回调"与"我们自己的桥从 JS 够不着"两档。
  ⇒ 用一次**只换 bundle、不重打 app**的实验分开它俩：在 `useCardExporter` 的挂载 effect 里
  直接调 `writeCardPng('dbg-M-ios.txt', …)`（不经过点击、不经过 react-native-svg），
  30 秒后沙盒仍是空的；同一趟把界面标题临时改成 `倒数纪念日·DIAG` 当正向对照 ——
  AX 树里真的读到 `'倒数纪念日·DIAG'` ⇒ **换进去的 bundle 确实在跑**。
  ⇒ 落不了盘的原因在桥的**名字**上，不在 RNSVG（RNSVG 那一档仍未量到，见下面"下一趟"）。
  机制是读宏读出来的，不是猜的：`RCT_EXTERN_MODULE(a, b)` 展开成
  `RCT_EXTERN_REMAP_MODULE(, a, b)` —— **第一个参数（JS 名）是空的**，
  `RCT_EXPORT_MODULE_NO_LOAD` 里那句 `+moduleName { return @#js_name; }` 因此给不出名字，
  而 Swift 自己那个 `moduleName()` 被这条分类方法盖掉（ObjC 分类优先）。
  修法一行：`.m` 改 `RCT_EXTERN_REMAP_MODULE(HeytaCardExport, HeytaCardExportModule, NSObject)`。
  🔴 **判据侧的同一条更要紧**：`apps/mobile/tests/card-export.spec.ts` 里那条标题写着
  "模块名三处逐字相同"的断言，body 比的是「`.m` 的第一个参数 == **ObjC 类名**」——
  而那恰好是**坏形状也能满足**的不变量（它把类名当 JS 名钉）。所以设备上是死的，套件一路绿。
  现在改成：要求显式 REMAP，且第一个参数逐字等于 `CARD_EXPORT_MODULE_NAME`、第二个等于
  Swift 的 `@objc(…)` 名。**三臂变异读数**：退回裸 `RCT_EXTERN_MODULE` ⇒ `1 failed | 20 passed`；
  REMAP 两参互换 ⇒ `1 failed | 20 passed`；把 JS 名改错一位 ⇒ `1 failed | 20 passed`；
  复原 ⇒ `21 passed`（RC=0）。
  ⚠️ 同族登记 ~~**W7-G5**~~ **W7-G8**（**本批不改，各有所有者**；🔴 15:4x 改号：这条当初写的是 W7-G5，
  而 `countdown-w7-device-export.md` 的缺口表里 **W7-G5 已经是"RN 没有等宽数位通道"** ——
  同一个号在两篇文档里指两件不同的事，下一个按号查的人会把两条结论互相套错。
  查号后 G6/G8 都空着，G6 留给 `RASTERIZE_SETTLE_MS`（任务 #24），这条桥名错位的改占 **G8**）：
  `HeytaWidget`（JS 名）/ `HeytaWidgetModule`（类名）、
  `HeytaReminder` / `HeytaReminderModule` 是同一个形状，四座 iOS 桥里只有
  `HeytaVaultSecureStorage` 因为"JS 名 == 类名"侥幸对得上 —— 也就是说小组件那格
  早就记过的"看起来不支持，其实接线错了"，在 iOS 侧的第二种面目就是这一条。
  ⏳ 待入 `docs/reference/environment-traps.md`（那张台账正被并行会话写，按 §7 的号段规则不在这里插行）。
  ⚠️ 09:36 现量：宿主负载 **75**（别人那条 `queue-reinstall-all.sh` 从 03:09 起在跑），
  所以我没有再抢设备窗口 —— 上面三层归因全是只读取证 + 一次只换 bundle 的实验。
  下一趟（重打 app 之后）要量的两件事：`dbg-M-ios.txt` 该出现（桥通了），
  以及 `dbg-c<len>` 是否出现（`toDataURL` 到不到得了回调 —— 那一档还没证过）。
  ✅ **链 Q（10:12–10:14，同一台模拟器，载体 = 上面那笔修复 + `pod install` 同步后的 Pods）**
  一次跑完就把两档都答了，读数全在沙盒的文件名里（探针把每一步编码成 `dbg-*`）：
  `dbg-M-ios.txt`（**不经过点击、不经过 RNSVG**，只证明我们自己的桥从 JS 够得着）⇒ 桥修好了；
  `dbg-X1.txt`（onPress 走到 `exportCard`）、`dbg-a.txt`（effect 跑了）、
  `dbg-tO1034.txt`（`findNodeHandle` 拿到真 tag 1034，不是 null）、
  `dbg-m360x480.txt`（`measure` 回的是版面那对数 ⇒ 视图真的布局过）、
  **`dbg-c88264.txt`（`toDataURL` 回了 88264 个字符的 base64）**，
  以及 `heyta-w7ios-093005-10月11日 星期日.png` 落在 `tmp/card-export/` 里。
  ⇒ **RNSVG 那一档是好的**：上面用"界面上既没有图也没有那一句失败"去排除分支，
  这个前提现在要打折 —— 链 P 那枚 app 用的 Pods 沙盒与 `Podfile.lock` **不一致**
  （`hermes-engine` 校验和 `d25a17a7…` vs `208b0dcd…`，`cmp` 现量差在第 2952 行，
  10:12 那次 `pod install` 才同步），所以"链 P 里 `toDataURL` 到底回没回、
  为什么没渲染那句失败"**未定**，本节不把它写成已证。它不影响结论：
  让落盘不可能的原因是那条桥的 JS 名，这一点由 `dbg-M-ios.txt` 的有无单独钉住。
  ⚠️ 同趟顺带修掉一条更普遍的形状：**`toDataURL` 的回调可以永远不来，而界面可以永远不说**
  —— 新增 `settleRasterize()`（纯函数，node 里可测）把"等不到"折成一个值，
  界面上出 `rasterize-timeout` 那一句。判据 5 条 + 两臂变异各红一次
  （删掉超时支路 ⇒ 只有"回调永远不来"那条红；生产路径绕开兜底 ⇒ 只有接线那条红）。
  ⏳ W7-G3 仍然不打勾：链 Q 是**诊断趟**（带着临时探针），正式的 `RC_IOS_PROBE` 读数
  要等摘掉探针重打的那一趟（链 R）。
  ⚠️ **顺带量到一条不属于本批的漂移**（登记，不改）：`pod install` 在本机把
  `apps/mobile/ios/Podfile.lock` 的 `hermes-engine` 校验和从提交态的 `208b0dcd96fe…`
  改写成 `d25a17a7bfcc…`（`git diff` 现量只这 1 行），也就是**提交态的 lock 在这台机器上不可复现**；
  而 `check:native-deps` 只比 pod 名与版本、**不看 `SPEC CHECKSUMS`**，所以没有任何一层会报这件事
  （traps #150 那句"提交态可复现"的现量口径因此要加一条限定）。
  本批**没有把这两处 pod-install 产物提交**（`Podfile.lock` 与 `project.pbxproj` 的引用重排
  都已 `git checkout` 回 HEAD）—— 把本机值钉进提交态只是把漂移挪到另一台机器上。
  链 R 用的是已经装好的那枚 app，不再需要构建，所以这个不一致不影响它的读数。

- ㊲ **链 S：windows 那一栏从"未取证"转成真实读数 —— 走的是 `reinstall-all.sh` 的 windows 那一腿的两条命令，不是整条 `reinstall:all`**（04 10:36–10:41，载体 `6105ba3b`，无设备参与）
  - **为什么只跑一腿**（归属读数写在跑之前，不是事后解释）：另一条会话的 `queue-reinstall-all.sh` 从 03:13 起卡在 macOS 公证，
    `notarytool submit --wait`（pid 98934）到 10:36 已 **7 小时 22 分**，而 `lsof -p 98934` 现量 27 个 fd 里**零个网络 fd**（只有 REG/PIPE/DIR/CHR）
    ⇒ 它并没有在跟苹果的服务说话；同一分钟 `/Applications/Heyta.app/Contents/Resources/web-dist/index.html` 的 mtime 仍停在 10-03 23:05。
    整条 `reinstall:all` 会撞它的 `/tmp/heyta-macos-dist` 与 `/Applications/Heyta.app` ⇒ **不并发**（AGENTS §8.9）。
  - **远端归属读数**：`C:\src\heyta` 上次写入 = 10-04 **07:11:57**（我自己那一趟），`Get-Process` 里**没有** dotnet / msbuild，
    唯一的 powershell 是这次 ssh 自己 ⇒ 打包机空闲，这一腿的所有者是我。
  - **读数**：`RC_SYNC=0`（`web-dist/index.html=517c6ba76d00fb25…` 本地/远端逐字相同 + `bridge=2623f10e…` + `assets/*.js` 7 枚一致）、
    `RC_PACKAGE=0`、`MISSING_FACTS=（无，七条齐）`：
    `ADD_APPX=OK` / `RESULT=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` /
    `PAYLOAD_INDEX_SHA=517C6BA76D00FB257817B808701C2093F367CFEA7D09A186C56205AE731E0F3C` / `PAYLOAD_CHUNK_TOTAL=2` / `PAYLOAD_CHUNK_PRESENT=2`。
  - ✅ 门禁那一栏因此从**未取证**转成真实读数：`check:shell-surfaces` **`RC_SURFACES=0`、5 绿 0 红、未取证从 2 栏降到 1 栏**，
    D4 那一行打印的是「装进包的字节与本工作树 dist **sha256 逐字相同**（`517C6BA76D00`），且那份里有 `"countdown-view"`（chunk 2/2 齐）」。
    剩下那一栏是 `desktop-macos / countdown · 产物`，报的是"包里那份 `index.html` 与本工作树 sha256 不符"——
    那是**上面那条 hung 链的包**，门禁没有把它顺推成绿。
  - 🔴 **这条 D4 有牙，四臂各量一次**（拿**真**取证文件改一个值，经 `HEYTA_WINDOWS_FACTS` 注入，真文件跑完 `cmp -s` 复量未动）：
    `PAYLOAD_WEBDIST=False` ⇒ **rc=1**「装出来的包里**没有** web-dist/index.html」；
    `PAYLOAD_CHUNK_PRESENT=1`（total 2）⇒ **rc=1**「index.html 引用的资源文件没全部落在包里」；
    sha 首位 `517C→0000` ⇒ **rc=0 但那一栏转回未取证**「那是别的检出／别的会话打的包，不能当本轮的取证」；
    删掉那三行 ⇒ **rc=0 未取证**「取证文件在，但缺判据行 ⇒ 生产方没测这些事实」。
    后两臂**故意不是红**：取证文件是"上一趟打包"的属性，判据比现场新时不能折成产品缺陷（§7 第 50 条那一族）——
    但它**不许**被读成通过，这正是这一栏此前一直空着的原因。
  - 👁 **人打开过 `dist/windows/packaged-first-run.png`**（1152×587、75 289 字节）：窗口标题 `heyta`；左侧 rail 的头像菜单是**开着**的，
    第一项是高亮的「→ 登录 / 注册」、下面「设置」，**没有**「退出登录」（＝ `M2D=OK` 那条判据的界面形状）；
    主区是「收集箱」页头 + 排序方式「默认（按截止时间）」+「未同步」chip；弹层是首装那张「在使用联网功能之前」授权卡
    （两条 bullet + 服务条款/隐私政策两个链接 + 右上 X）；左下能看到「已完成」与「四象限」两组（红/蓝各一颗点）；中文零豆腐块、蓝白一套。
    ⚠️ 与 Android 那一格**同一条边界**：这张图证的是"装上的是当前源码的界面"，
    而"倒数日这一屏在装出来的包里"是由上面那条 **sha 逐字相同 + 那份字节里搜得到 `countdown-view`** 证的，**不是**由这张图证的。
  - 📌 关闭 **W8-GAP-W1 / 任务 #20**：08:2x 那次是"通道就位 + 七臂离线台架"，这一趟是**第一次在真打包机上跑到那三行**。
    ⚠️ 一条限制写在这里：这份取证文件落在 `dist/windows/`（**被 gitignore**）⇒ 它是"本机这一趟"的读数，不是仓库里的常驻证据；
    下一次干净检出上这一栏仍会报未取证，除非再打一趟。这不是缺陷（macOS 那一栏同理），但别把它读成"永久关上了"。

- ㊳ **链 R / 链 R2：iOS 的正式读数仍未取到，两次都挡在环境上（不是产品、也不是探针）**（04 10:25–11:2x，载体 `6105ba3b` → `ce4bf082`）
  - 链 R 10:25 起跑：`RC_TREE=0`、`RC_FIX=0`（那道守卫读的是"HEAD 里有没有 `6105ba3b` 这一笔"，不是印象）、设备独占 ✅；
    然后**负载门**从 10:25 等到 10:50（23→18→22→17→17→25→…→12），10:50:51 开了一格 ⇒ 当场进探针。
  - 探针自己的现场门在**同一秒**又把它拒了：`RC_IOS_PROBE=3`，挡住的是主检出里刚起来的 `verify-mobile-ios-reminder.sh`
    （pid 65663，跑在 `heyta-ios-isolated` 上）。**不是产品失败，也不是我这侧的探针坏** ——
    这一格的价值恰恰在于它**没有**因为"两台模拟器不同"就放行（§8.9）。
  - 链 R2（`/tmp/device-closeout-R2.sh`）只做一件事：**重试那一扇门**，直到 `RC_IOS_PROBE != 3`（0=通过 / 1=判据红 / 其他=探针坏），
    每次拒跑都把"当时挡住的是谁"写进日志。第 1–3 次（10:51 / 10:54 / 10:56）被别人的 `verify-mobile-*` 挡下；
    第 4 次（10:59–11:12）别人的 runner 门开了，**卡在探针自己的负载门等满 900s**（`负载 16 > 12`）。
  - 🔴 11:18 现量 `vm.loadavg = 47.72 27.88 22.48`（16 核），第 5 次尝试里读到 31→54 —— 这台机器此刻有别人的构建在跑。
    **阈值 12 是设备验收的既有约定，不为本批下调**（任务书第 8 条：等满 = 环境无效，不是产品失败）。
  - 📌 顺带一条**归属读数**（写下来，下一个人不必重新猜）：此刻 booted 四台模拟器 ——
    `heyta-batch2-closeout`（本批链 R2 的目标，挂着 idb companion）、
    `heyta-ios-isolated`（另一条会话的，8 小时前起的 `simctl io … enumerate --poll` 还在）、
    `heyta-iphone-17pro` 与 `iPhone Duo heyta` 各自只剩自己的 `launchd_bootstrapper`（11.5–12.5 小时前起，**无外部驱动附着**）。
    后两台**不归本批** ⇒ 本批不关别人的模拟器来给自己腾负载。
  - ⏳ **W7-G3 仍然不打勾**：链 Q 那张 PNG 是**诊断趟**（带临时探针），链 R/R2 才是正式读数；没取到就是没取到。
  - 队列（三条链各自带前置，互不并发）：
    链 R2（iOS 出图）→ **链 U**（`reinstall:all --only android` + `verify:mobile-card-export` 在当前产物上复跑 + 两扇门禁重取；
    里面 4b 那一步是**自愈**：第 3 步的 `pnpm -r build` 若改了 `apps/web/dist/index.html` 的 sha，就当场重打 windows 那一腿，
    免得我把 ㊲ 那格读数弄回未取证）→ **链 V**（完整 `pnpm check` + `docs-link-check`；
    跑之前先量 4318/4319 空着，否则不跑 —— `scripts/check-ai-e2e-preflight.mjs:79-83` 会对那两个端口的监听者发 **SIGKILL**，
    本批不替别人决定要不要杀他的 dev server，traps #87 同一族）。
  - 🔴 **macOS 那一腿的关闭条件**（任务 #23）不是"等一等"，而是**现量到三条硬的**（04 14:4x 补到三条；原先只写了"两条"，
    而其中一条已被否证 —— 见下）。这一格的"装步"不能由本批自己动：
    ① `reinstall-all.sh:192` 的 `MAC_OUT=/tmp/heyta-macos-dist` 是写死的，而 `package-app.sh:36` 对 OUT_DIR 是**盲删**，
       那一枚目录正被另一条会话**正在公证**（pid 98934 → 父 95477 `package-app.sh /tmp/heyta-macos-dist`）；
       ⚠️ 这半条**有绕法**：OUT_DIR 是位置参数（`package-app.sh:28`）⇒ 链 W 打自己的 `/tmp/heyta-macos-dist-b2`。
    ② 🔴 **新量到的、没有绕法的一条**：`reinstall-all.sh:193` 的 `INSTALLED_APP=/Applications/Heyta.app` 也是写死的，
       而 04 14:4x 现量 **pid 772 就是从那枚包里跑起来的 `HeytaMac`**（`etime 17:06:54`，起于 10-03 21:33）⇒
       它的 `:198 rm -rf "$INSTALLED_APP"` 会**拆掉一个正在运行的别人的实例**。这不是"目录被占"，是"进程脚下的包被删"。
    ③ 同段 `:228` 还要 `rm -rf ~/Library/WebKit/cloud.finlaw.heyta.desktop` —— 容器**按 bundle id 分**，
       与那枚实例是同一个，清它就是在替别人的会话重置首屏状态（§7 第 83 条：探针会改变被测对象的状态）。
    ④ ~~`check-shell-surfaces.mjs:263` 的 mac 那一栏读的是**写死的**这个路径、没有 env 覆盖~~
       —— 🔴 **04 14:19 被现量否证，见 ㊹**：`:944` 一直有 `HEYTA_MACOS_WEB_DIST` 这个 env 覆盖，`:263` 只是默认值；
       这半句当时把一栏本来能自己关的事登记成了"只能等别人"。它 957 行那段注释就是上一轮"把别人的包读成自己的"之后加的。
    ⇒ 所以本批**自己关得掉的**是"打包 + 产物栏 + 打包副本自截屏"（链 W），**关不掉的**只有"装进 /Applications"那一格；
    那一格等 ②③ 释放之后由它的持有者跑 `pnpm reinstall:desktop`（或 `bash scripts/reinstall-all.sh --only mac`）。

- ㊴ **重试预算写成"次数"是错的：秒回型拒跑会把 26 次在 11 分钟内烧光（链 R2 → 链 R3），以及 11:0x–13:1x 的现场读数**（04 11:00–13:10，载体 `ce4bf082` → `f03c1df1`）
  - 🔴 **本批评自己的一条设计缺陷**：链 R2 的 `MAX_TRIES=26` 是按"每次尝试都要在负载门里等满 900s"设计的，
    而 12:56 之后挡住探针的**不再是负载，是别人的 `verify-mobile-*` 在跑** —— 那种拒跑是**秒回**的，
    于是 26 次在 **11 分钟**内烧完（13:07 现量 `TRY=21`），**一次真窗口都没等到**。
    ⇒ 换链 R3：**按时间截止**（`date +%s` 与 5 小时 deadline），并按拒跑类型给不同退避
    （"别人在写"型 45s、"等满负载门"型 150s —— 后者自己已经耗了 900s）。
    可迁移的形状：**重试预算的单位应该是"墙钟时间"，不是"次数"，因为不同拒跑原因的单次成本差两个数量级。**
  - 📌 **链 U / 链 V 第一轮都是 `rc=3`，而且是被自己的前置挡的**（读数只有这一份，日志被重启时截断过 —— 所以抄在这里）：
    `11:59:20 [0] 🔴 等满 60 分钟链 R2 还没结束 ⇒ 不并发，本链不跑 / RC_WAIT_R2=3`；
    `12:30:24 ❌ 等满 90 分钟链 U 没结束 ⇒ 不并发 / RC_WAIT_U=3`。
    ⇒ 两链已按更长的等待重启（U 等 R2 的终哨 180 分钟、V 等 U 的终哨 240 分钟），
    三条链现在都活着：`R3=21982` / `U=45470` / `V=45122`。
    ⚠️ **我在这一步弄丢了一份取证**：链 U 的脚本开头是 `: > "$LOG"`，重启时把上面那两行 `rc=3` 读数**截掉了**
    —— 后台链的日志如果被复用，收尾读数必须**先抄进台账再重启**（处置见本节末尾那条「修法登记但当场不改」）。
  - **现场负载读数**（同一台 16 核机器，`vm.loadavg` 一分钟列）：`11:18 = 47.72` → `12:07 = 10.35`（**开过一格**，但那一格被别人的 runner 挡）
    → `12:36 = 15` → `12:54 = 55（等满 900s 时是 49）` → `13:07 = 57.59`。
    🔴 **峰值 174** 出现在 12:10 那一趟的探针日志里（`负载 174 > 12`）—— 这台机器此刻由多条并行会话共同打满，
    阈值 12 不为本批下调（任务书第 8 条）。
  - **另一条会话的 `notarytool submit --wait` 到 12:34 已 9 小时 21 分**（pid 98934，`/tmp/heyta-macos-dist` 目录 mtime 仍停在 03:13:03，
    `/Applications/Heyta.app/…/web-dist/index.html` 仍停在 10-03 23:05）⇒ ~~macOS 那一腿整轮都关不掉~~
    （任务 #23 的两条硬理由仍然成立 —— 🔴 **14:4x 就地改窄**："整轮关不掉"说过头了：关不掉的只有**装进 /Applications
    那一格**，而"打包 + 产物栏 + 打包副本自截屏"三件是本批自己做得到的（链 W，pid 62956，带
    `HEYTA_SKIP_NOTARIZE=1` 与 `HEYTA_MACOS_WEB_DIST`）；同一趟把"两条"补成了**三条**，逐条带 pid/行号在本节 ㊳ 的
    "macOS 那一腿的关闭条件"段 —— 新增那两条没有绕法：`:193 INSTALLED_APP` 写死而 **pid 772 正从那枚包里跑着**，
    `:198` 是 `rm -rf`，`:228` 清的 WebKit 容器按 bundle id 分、与它是同一个）。
  - ⏳ **W7-G3 仍然不打勾**；Goal 第⑤条第 1 项（完整 `pnpm check` 在当前 HEAD 上的读数）与第 4 项（android 那一腿在当前产物上复跑）
    都排在链 U / 链 V 后面，等的是同一件事：**一个安静的窗口**。
  - ⚠️ **修法登记但当场不改**：链 U / V 开头那句 `: > "$LOG"` 要换成"把旧日志 `mv` 成 `.prev`"
    （截断 = 毁掉上一轮 `rc=3` 的唯一取证；而直接改成追加又会让终哨 `grep` 读到旧趟的"终点"行 ⇒ 提前放行）。
    **不当场改的理由是 traps #110/#113 那一族**：两条链正在跑，bash 按字节偏移增量读脚本，
    运行中编辑会让它从错位字节开始解析、炸出假语法错误 —— 改脚本要等它跑完或停掉。

- ㊵ **链 U 把 Android 那一腿在当前产物上关掉了；链 V 量到 `check:ui-provider` 那一格红（含本批新增的一行，且有设备反证）**（04 13:15–13:26，载体 `b995597a`）
  - ✅ **链 U 全部读数**（`/tmp/device-closeout-U.log`，13:15 开窗 → 13:20:22 终点）：
    `[3] RC_REINSTALL_ANDROID=0`（`reinstall-all.sh --only android`：清旧包 → 重打 → 模拟器卸旧装新 → 判据）、
    `[4] 设备现取 serial=emulator-5554` + **`RC_ANDROID=0`**（`verify:mobile-card-export` 在**当前提交**的产物上复跑成功）、
    `[4b] 本地 dist sha=517C6BA76D00FB25 包内 sha=517C6BA76D00FB25 ⇒ RC_WINDOWS_LEG=skip`（那一步的自愈逻辑判对了：
    `pnpm -r build` 没改动 `apps/web/dist` 的字节，所以 ㊲ 那份 windows 取证对本轮仍然成立，不必重打远端）、
    `[5] RC_SURFACES=0（5 绿 0 红 / 未取证 1 栏）`、`RC_CARD_EXPORT=0`。
    🔴 **为什么这一腿必须重跑**：09:18 那趟之后 `apps/mobile/src/lib/card-export.tsx` 改了（`settleRasterize`），
    模拟器里那枚 APK 的 JS bundle 已经不代表当前提交 —— 这正是 §6.1.1 与 §7 第 27/82 条要防的形状，
    而这一腿现在是在**当前提交**上取的了。
  - 📌 **一次差点误判的归属**：跑完后工作树里 `apps/mobile/evidence/card-export/latest-card.png` 变成 ` M`，
    而 `packages/op-log/src/{state,engine}.ts` 与 `packages/sync-core/src/causal-clock.ts` 的 mtime 跳到 13:26:38–45，
    第一反应是"有别人在写我的隔离检出"。现量之后两件事都归到自己头上：
    png 是**链 U 那一趟探针自己拉回来的读数**（`md5` 与 HEAD 那份不同、时间戳 13:20:19 与 `RC_ANDROID=0` 同一秒）；
    三枚源码文件是**链 V 的 `pnpm check` 第一步 `pnpm build` 重写了一遍内容未变的文件**（`git status` 对它们全空、
    与主检出那份的 inode/大小都不同 ⇒ 不是同一枚文件）。⇒ 报"别人在写"之前先把自己的链时刻对上。
  - 🔴 **链 V：完整 `pnpm check` 在当前 HEAD 上 `RC_CHECK=1`，红在 `check:ui-provider`，45 秒就停（串联门禁红即停）**（13:26:02–13:26:47，`RC_LINKS=0` 同趟）：
    它列 4 条"消费者在 `<HeytaUiProvider>` 子树之外"，其中 **`CountdownScreen.tsx:174` 是本批的行**
    （`git blame` 现量 = `79e116cf`「W7 成品图导出的移动半」），另外三条（`GrowthScreen:298` / `HabitsScreen:365` /
    `ui/habit-goal-slot.tsx:37`）不是本批的。
    对这一条我有**两层反证**：① `:68` 是 `import { useTheme } from '../theme'`，而 `apps/mobile/src/theme.tsx:33`
    写的是 `HeytaUiProvider as ThemeProvider` —— 门禁自己在 `scripts/check-ui-provider.mjs:801` 就注明了
    "按**词法位置**判会把这类消费者误判成子树之外（false positive）"；② **设备反证**：同一台模拟器同一屏，
    13:20 那一趟真打开过倒数日屏、真点了导出、真拉回了 `1080×1440` 的 png —— 真在 Provider 之外会当场抛
    「useHeytaUiTheme 必须在 `<HeytaUiProvider>` 内使用」，跑不到落盘那一步。
    ⚠️ **处置：不把判据改绿、也不当没看见** —— 登记 **W7-G7 / 任务 #25**：`check:ui-provider` 的可达性要跟着
    `theme.tsx` 那类别名走（修法方向是给探针加"本地再导出/别名"这一跳，而不是把判据退回"出现过 Provider"）。
    因此 Goal 第⑤条第 1 项"完整 check 的读数"现在的真话是：**串联到 `check:ui-provider` 停住**，
    本批自己的门禁全部单独重取过（`check:card-export` / `check:shell-surfaces` / `check-md-table-rows` / `docs-link-check` 各自 rc=0）。
    ⚠️ **这条里「门禁自己在 :801 注明别名误判」的判读在 ㊶ 被否证** —— 别名一直跟得上，
    真根因是 `renderedTags()` 把 `return <X />` 当成 TS 泛型吃了；W7-G7 已在 ㊶ 当场修完并带四条变异臂读数。
  - 🔴 **iOS 新鲜度门：两条"更聪明"的替代判据都被实测否证，所以链 X 走最贵但唯一诚实的那条 —— 先重装再测**
    （这段推理写在链 X 的文件头，摘在这里是因为它是本批第 N 次撞"测试绿 ≠ 当前产物"）：
    ① 用"最近一次改 bundle 输入的**提交时间**"代替文件 mtime ⇒ 现量 `10:21:53 > bundle 10:19:34`，
       而那是因为我**先打包、后提交**（提交时间不是内容变更时间）⇒ 照样假红；
    ② 用"现场重打一份 bundle 逐字节比" ⇒ metro 本身确定性成立（连打两次 `md5 11a0b9e1…`、6 041 554 字节），
       但 Xcode build phase 装进 `.app` 的那枚是 **7 277 184 字节**，命令不同 ⇒ 字节不可比。
    ⇒ 链 X：`IOS_DEVICE_NAME=heyta-batch2-closeout bash scripts/reinstall-all.sh --only ios`（重装本身也是 Goal 第⑤条第 4 项要的）
       → 再跑探针取 `RC_IOS_PROBE`。

- ㊶ **W7-G7 当场修完了，但根因不是我 ㊵ 里判读的那条 —— 是探针把 `return <X />` 当成 TS 泛型吃了**（04 14:00–14:02，载体 `f5ff4bce`）
  - 🔴 **㊵ 里那句"门禁自己在 `check-ui-provider.mjs:801` 注明了按词法位置判会误判别名消费者"的判读是错的**，划线留原文不删（下面这条否证它）：
    `resolveName`/`resolveExported` **本来就跟着别名走**（`theme.tsx:33` 的 `HeytaUiProvider as ThemeProvider` 被正确解析成 Provider，
    `providers=1` 就是从 `App.tsx` 里数出来的）。真正坏的是 `renderedTags()` 的前置字符启发式：
    它为了排除 `useState<Foo>` 写成"**跳过空白**后看前一个非空字符不能是标识符字符"，
    于是 `return <GrowthScreen />` 里 `return` 的 `n` 被当成紧邻字符 ⇒ **"直接返回一个组件"整类边不进可达集**。
    它自己的文档例子（`useState<Foo>`）本来就是无空格写法 —— 跳过空白超出了它自己要防的东西。
  - 🔴 **这 4 条红是我自己那笔 W8 改动照出来的**（不是别人的存量债）：`b8f39cae`「W8 移动端倒数日接线与特性开关」
    把两段 `if (xxxOpen)` 换成穷尽 switch 的模块级 `featureScreen()`，屏幕从 `{cond ? <X/> : null}`（判据认识）
    挪到 `case …: return <X />`（判据不认识）。现量：`git show b8f39cae^:apps/mobile/src/screens/ProfileScreen.tsx | grep -E 'return <(Growth|Habits)Screen'` 命中 **0**
    ⇒ 改动前这条边不存在于该形态，门禁是绿的。第 4 条 `ui/habit-goal-slot.tsx:37` 是**传递性**红：它只从 `HabitsScreen` 可达。
  - ✅ **修法（一行判据，不是放宽判据）**：`renderedTags` 改成看**紧邻**那一个字符、不跳空白。
    修后 `pnpm check:ui-provider` **rc=0**，可达集 `apps/mobile/src` 32→**36**（恰好那 4 个文件）、`apps/web/src` 65→**66**，**零新增红**。
  - ✅ **四条变异臂**（全部在 `/tmp` 的一次性副本上跑，真实树全程未动 —— 那一刻链 X 正在 Metro 打包 `apps/mobile/src`，
    加/碰任何 `.ts/.tsx` 都会翻掉 iOS 新鲜度门；三处替换各自断言 `split(from).length-1===1` 并回显替换体）：
    | 臂 | 改动 | 读数 |
    |---|---|---|
    | CONTROL | 未变异副本 | `RC=0 / RED_LINES=0` |
    | ARM1 | tokenizer 退回"跳空白"版 | `RC=1 / RED_LINES=4`（逐字是那 4 条 ⇒ 绿只来自这一行） |
    | ARM2 | 摘掉 mobile 宿主的 Provider 节点 | `RC=1 / NO_PROVIDER_LINES=1`（这个宿主真在被判，不是静默跳过） |
    | ARM3 | 冻结可达性 BFS | `RC=1 / RED_LINES=93`（"子树之内"这条有牙，不是只查"文件里出现过 Provider"） |
  - 📌 **运行时反证与判据读数彼此自洽**：13:20 那一趟在**同一台模拟器**真打开过倒数日屏、真点导出、真拉回 `1080×1440` 的 png；
    真落在 Provider 之外会当场抛「useHeytaUiTheme 必须在 `<HeytaUiProvider>` 内使用」，跑不到落盘那一步。
  - ✅ **于是 Goal 第⑤条第 1 项解锁**：完整 `pnpm check` 在 `f5ff4bce` 之后可以再取一次读数（链 V 那一趟 45 秒就停在这里）。
    排在链 X 之后跑 —— 它第一步是 `pnpm -r build`，会抢 Metro 的 CPU 并改 `apps/web/dist` 的 mtime。

- ㊷ **链 X 到 14:10 仍被负载门连续拒绝，已把"换窗口重跑"排成链 Z（而不是拿回合去轮询）**（04 13:42–14:10，载体 `b995597a` → `de48f5a8`）
  - 链 X（pid 18000）13:42 起跑：先等到 13:46:38 才判到"没有别人的 iOS 验收/构建在跑"，之后 `wait_for_quiet_host` 连续拒绝
    —— 现量记录：`83 / 41 / 31 / 27 / 19 / 16 / 26 …（累计 0→360s）`，14:10 再看已是 **累计 1440s**、`24 → 30`，
    宿主机 `vm.loadavg` 同一刻现量 `{ 30.17 32.90 46.62 }`。它的 cap 是 `HEYTA_LOAD_GATE_WAIT=3600` ⇒ **约 14:46 以 exit 3 收口**。
    按任务书第 8 条：**exit 3 = 这一轮在环境上不成立**，与 1（有断言失败）是两件事；阈值 12 不为本批下调。
  - ✅ **排好的队列（三条链各自带前置，互不并发；都写自己的 `RC_*` 行，读数只从那些行取）**：
    | 链 | pid | 干什么 | 前置 |
    |---|---|---|---|
    | X | 18000 | `reinstall-all --only ios` → iOS 出图探针 | 负载门（现正拒） |
    | Y | 4157 | 完整 `pnpm check`（第⑤条第 1 项）+ 顺带用 `index.html` 的 sha 判 windows 取证是否仍成立 | 等 **链 X 终点**；跑前现量 4318/4319，被占就 `RC_CHECK=skip` 并写明原因（`check-ai-e2e-preflight.mjs:78-83` 会对那两个端口发 SIGKILL，本批不替别人决定要不要杀他的 dev server，traps #87） |
    | Z | 37214 | iOS 那一腿的**第二次尝试**（负载门 cap 提到 7200s） | 等 **链 X 与链 Y 都收口**；若 X 已 `RC_IOS_PROBE=0` 就直接 `RC_Z=not-needed` 退出 |
  - 📌 **为什么当场写脚本而不是拿回合轮询**：Goal 续跑消息几乎秒级来一次，"等一个窗口"这件事本身要烧掉好几个回合；
    把等待写进一条带**时间截止**的后台链（不是次数预算 —— ㊴ 那条教训：秒回型拒跑会把 26 次在 11 分钟内烧光），
    等待回合就全部换成零 CPU 的读证工作。本轮那些回合做的是：交接首页过期读数原地更正（`de48f5a8`）、
    W4b 判据②**独立复核**（`admin-panel.spec.tsx:604` 有用例 + `apps/web/evidence/admin-holiday/` 两张图带 md5 与"人打开看过"一节，
    不是凭 §0.5 的勾）、iOS 落点确认（探针 `:360` 写 `apps/mobile/evidence/card-export/ios-latest-card.png`）、任务 #26（AGENTS §9 三处过期）。
  - ⚠️ **三条链的脚本都在 `/tmp`**（`device-closeout-{X,Y,Z}.sh`，日志同名 `.log`）⇒ 它们是**本机这一趟的现场**，不是仓库里的常驻证据；
    会话若中断，后来者要按本表重排，别假设它们还在跑（现量：`ps -p 18000,4157,37214` + `tail -1` 各自日志）。

- ㊸ **Goal 范畴②的"零法务变更"现量补上 iOS 那一路（此前 ㉗ 的四路都在 Android/条款侧），并且当场抓住一条会产假读数的 zsh glob 坑**（04 14:13，载体 `d7963bb4`，纯只读、无设备参与）
  - 五条读数，逐条可重跑：
    | # | 问的是哪一层 | 现量 |
    |---|---|---|
    | ① | 原生写盘去向 | `HeytaCardExportModule.swift:73` = `FileManager.default.temporaryDirectory` + `:77` `data.write(…, options: .atomic)` ⇒ 只落**自己沙盒的 tmp**；该文件头第 21 行自己就引了 `packages/legal/src/documents/permissions.ts` 那句"不申请照片权限" |
    | ② | JS 侧出图后的通道 | `apps/mobile/src/lib/card-export.tsx:183` 是 `Share.share({ title, url })`（分享面板，不是写相册）；对 `apps/mobile/src/lib/card-export.tsx` + `packages/ui/src/countdown/*` 扫 `requestPermission\|CameraRoll\|Photos\|writeToPhotos\|saveToCameraRoll` 命中 **0** |
    | ③ | Info.plist 有没有申请相册用途 | `apps/mobile/ios/Heyta/Info.plist` 里 `<key>` 共 **28** 个（阳性对照，证明扫描接上了），`photo\|library` 命中 **0** ⇒ 没有 `NSPhotoLibraryAddUsageDescription` |
    | ④ | entitlements 有没有相册能力 | `Heyta/Heyta.entitlements` 只有两把键：`com.apple.security.application-groups`、`keychain-access-groups` |
    | ⑤ | 这两枚文件被谁改过 | `git log --oneline -- apps/mobile/ios/Heyta/Heyta.entitlements apps/mobile/ios/Heyta/Info.plist` = **2 条**（`b0ba4a35` W9 提醒投递 / `3c35b65a` 工程改名），其中标题提到卡片/导出的 **0 条**；W7 iOS 那笔 `d4d154b4` 的 `--stat` 六个文件里也没有它们 |

    ⇒ 合起来是：**iOS 这一路同样是"零新通道、零新权限"**，所以 `permissions.ts` 那句"不申请照片"对外条款在 W7 落地之后**逐字仍为真**（与 ㉗ 的 Android 侧同向，也与 07:41/13:20 两趟"全程没出现系统权限页"的设备读数同向）。
  - 🔴 **当场抓住的探针坑**：我第一条命令写的是
    `grep -rniE 'photo\|library' …/Info.plist apps/mobile/ios/*.entitlements` —— 这台机器的默认 shell 是 zsh，
    **glob 无匹配时它直接报错并中止整条命令**，于是第一个文件（Info.plist）的 grep **根本没跑**，
    输出里只有一行 `no matches found: …entitlements`。若照那次的空输出宣布"没有照片键"，
    拿到的是**没有跑过的判据**而不是零命中（§7 元规则第一条"先怀疑探针"的第 N 次现形）。
    改法：文件枚举用 `find -name`，并且给零命中那条配**阳性对照**（这里是"键总数 28"）。
  - ⚠️ 本条**不关闭 W7-G3**：法务侧现量补全是范畴②的另一半，iOS **设备出图读数**仍在链 X / 链 Z 手里（14:10 现量负载 30.17）。

- ㊹ **我自己那条"mac 那栏没有 env 覆盖 ⇒ 结构上关不掉"被现量否证 —— 通道一直在，缺的是把包打在自己目录里**（04 14:19–14:20，载体 `c170e4bd`，全程静态、零设备）
  - 🔴 **否证的句子**：㊳ 里"② `check-shell-surfaces.mjs:263` 的 mac 那一栏读的是**写死的**这个路径、没有 env 覆盖"。
    现量：`:944` 一直是 `const envKey = HEYTA_ + hostLabel.toUpperCase() + _WEB_DIST`，mac 那格的 hostLabel 是 macOS（`:767`）
    ⇒ 键名 **`HEYTA_MACOS_WEB_DIST`**，默认值才是 `:263` 那枚 `/tmp/heyta-macos-dist/…` 写死路径。
    我上一轮把"默认路径写死"读成了"没有覆盖通道"，于是把一栏本来能自己关的事登记成了"只能等别人"。
  - ✅ **三条通道对照臂**（各跑一次门禁，全部本地目录、零设备）：
    | 注入 | 读数 |
    |---|---|
    | `HEYTA_MACOS_WEB_DIST=apps/web/dist` | `判定 5 格：5 绿 / 0 红；**未取证 0 栏**`（通道接得上） |
    | `=no/such/dir` | `⚠️ 未取证，不计为通过` + 打印要跑哪条命令 ⇒ 缺包是**响亮**的，不静默绿 |
    | `=apps/landing/dist` | `包里 d62456524aa0 / 本地 517c6ba76d00 不符 ⇒ 未取证` ⇒ "拿别人的字节给自己这一轮作证"这条路门禁自己堵着（与 windows 那臂同形） |
  - ✅ **另一条硬理由仍然成立，但有绕法**：`package-app.sh:36` 对 `OUT_DIR` 是盲删（`rm -rf`），默认 `OUT_DIR` 正是那条 hung 链正在公证的 `/tmp/heyta-macos-dist`
    （14:19 现量：pid 98934 仍在 `notarytool submit … --wait`，已 10 小时）。而 `:28` 写的是 `OUT_DIR="${1:-/tmp/heyta-macos-dist}"` —— **OUT_DIR 是第一个位置参数**，
    传自己的目录就不碰别人的那一枚。
  - ✅ **于是排了链 W**（pid 87699）：等 X/Y/Z 三条收口 ⇒ `bash apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist-b2`
    → 打印包内 `index.html` 与本地 `apps/web/dist` 的 sha256 对照 → `HEYTA_MACOS_WEB_DIST=<那枚包>/Contents/Resources/web-dist` 跑门禁取那一栏读数
    → 记下 `packaged-first-run.png`（那张要**人打开看**，是 Goal ⑤-3 里 mac 那一格）。
    ⚠️ **它关的是 Goal ③ 的壳级门禁 mac 产物栏，不代 Goal ⑤-4 的"装进 `/Applications`"**：后者要 `reinstall-all` 的装步（清 `/Applications/Heyta.app`），
    那是别人在飞的共享位置，按任务书第 6 条"共享资源先定所有者"我不替它覆盖；等它释放由持有者跑 `pnpm reinstall:desktop`。
  - 📌 一般规律（本仓第 N 次）：**"这事结构上不可能"这种句子，也要现量**——它比"这事没做"更容易被下一个人照抄，
    而这次的真相只是我少读了一个 `envKey` 变量。凡是写成"只能等 X"的关闭条件，先问一遍"我是不是没找到那个旋钮"。

- ㊺ **收尾第 3、4 项各查出一种"账面绿、证据不常驻"**（04 14:28–14:29，载体 `da5d7582`，全程只读）
  - 🔴 **⑤-3 的账要按文件名对，不是按「这张图」对**：把本批四个证据目录逐个枚举（`ls *.png` 对 `grep README`），
    19 枚图里 **18 枚在自己目录的 README 里被点到**；唯一漏的是 `apps/mobile/evidence/card-export/latest-card.png` ——
    那个 README 通篇讲的就是它，但用的是「这张图 / 本文件」这种指代，所以 `grep latest-card.png` 数出 **0**。
    这不是"没人看过"（13:2x 我打开并逐元素描述过，见 ㊵），而是**那本账查不出来**；
    已把两个产物文件名（`latest-card.png` / `ios-latest-card.png`）写进该 README 抬头，并写明"盘点要按文件名对"。
  - 🔴 **⑤-3 真正的缺口是 4 枚图只活在 `e2e/test-results/`**（W5 与侧栏迷你月历那一组）：
    `countdown-board.png` / `countdown-empty.png` / `countdown-archived.png` / `calendar-sidebar-mini.png`
    现量 mtime `10-04 06:21–06:22`、大小 44 158 / 45 264 / 34 020 / 17 896 B —— 它们**没有入库**，
    而 Playwright 每轮开始会清空这个目录（本仓 09-30 实测过：中途去读上一轮截图直接 `File does not exist`），
    另一条会话跑 e2e 也会把它们重写（#17 那条 md5 事故的同一族）。
    ⇒ 登记**任务 #27**：链 Y 那一趟（含 `check:ai-e2e`）跑完后，把这四枚复制进 `apps/web/evidence/` 带 README 与 md5，
    再按 §6.2 规定一**重新打开看一遍**才写"人已看" —— 不在链 X 期间做，是因为那要再跑一趟 Playwright，会抢它等的窗口。
  - 🔴 **⑤-4 的 mac 那一格：本文件「固定收尾」一节里"mac 段 = 本会话自己跑绿了"是 10-03 的读数，对本轮不成立**。
    现量对账两条：`/Applications/Heyta.app/Contents/Resources/web-dist/index.html` 的 sha256 前 16 位 = **`217cae2a252d8948`**、
    mtime **10-03 23:05:40**，而本地 `apps/web/dist/index.html` = **`517c6ba76d00fb25`** ⇒ 装着的不是当前产物；
    再看那之后动过多少会进 mac 包的源码：`git log --since='2026-10-03 23:05' --name-only -- apps/web packages`
    去掉 evidence / tests / spec 之后，落在 `apps/web/src` 与 `packages/{ui,design-system,i18n,app-host,shared-schema}/src` 的是 **81 个文件**
    （含 `apps/web/src/features/countdown/CountdownView.tsx` 与 `card-export.ts` —— 正是本批那两面）。
    ⚠️ 那一节的四条"按内容证明"（`is-ancestor`、`diff --name-only 267ac912..HEAD` = 8 且全在 evidence、APK/iOS/mac 三处串扫）
    在它自己那一趟是真的，但它的分母是 `267ac912..HEAD@10-03`；**引用运行要带哪一趟**，否则 81 个文件的变化会被那句"绿过了"盖掉。
  - ✅ **android / windows 两格不受这条影响**：android 是 13:20 在**当前提交**重取的（`RC_ANDROID=0`），
    windows 是 13:20 现场复核「包内 sha == 本地 sha == `517C6BA76D00FB25`」；
    另外同一条"since 10:33 之后有没有进过包的源码提交"现量是 **0 个文件** ⇒ 今天 13:5x 之后的几笔（docs / scripts）不改产物字节。

- ㊻ **Goal 第④条（复核 W6 的关闭判据）：两条读数在两个检出里答案是反的 —— 所以我第一版把载体写错了**（04 14:3x，隔离检出 `9e98b69a` / 主检出 `main` `73b6df97`）
  - 当年那条判据是"等六个日历路径的未提交 diff 归零后再落地"。今天逐条重取：
    ① `git merge-base --is-ancestor e2def90f HEAD` ⇒ 隔离检出 **真**、主检出 **假**；
    ② `git status --porcelain -- packages/ui/src/calendar apps/web/src/features/calendar apps/mobile/src/screens/CalendarScreen.tsx` ⇒ **两个检出各 0 行**（含未跟踪）。
  - 🔴 **① 的"假"不是缺陷**，是任务书第 2 条「不 merge 进 main」的直接后果。我第一版把这条写成"主检出的读数"，
    是因为我只在**一个**地方取了就以为它无所谓在哪儿取 —— 现量第二遍才发现两处的答案相反。
    ⇒ **"祖先关系成立"这类句子必须带在哪个分支上成立**，否则它要么是真话但被读成别的意思，要么是假话但看起来像证据。
    已把正文（W6 节标题下那条引用块）改成两个检出分别写清。
  - ② 的"0 行"是**独立复量**，不是复述 04 02:5x 那次（那次记的是「14 脏 + 4 个未跟踪」）。它的意义是：
    当初那条判据的作用是"别在此刻造三方冲突"而不是"永远不许落地"，现在它自己归零 ⇒ **落地时机成立**，
    这一格才敢写 ✅。判据本体（`e2def90f` 带的那四份：`packages/domain/tests/event-occurrences-in-range.spec.ts`、
    `packages/ui/tests/calendar-event-source.spec.ts`、`apps/web/tests/calendar-event-source.spec.tsx`、
    `apps/mobile/tests/calendar-event-source.spec.ts`，另加 `e2e/tests/countdown-calendar.spec.ts`）的读数由链 Y
    那趟完整 `pnpm check`（含 `pnpm -r test`）代取，在它取到之前不主张"当前 HEAD 上测试绿"。
  - 📌 **顺带把链 Y 的读数能否代表当前 HEAD 这件事先证了**（不花 CPU，只读提交元数据）：
    `git log --name-only 15e777e7..HEAD` 的落点集合 = `docs/plans/countdown-anniversary.md`、
    `docs/plans/countdown-batch2-handoff.md`、`apps/mobile/evidence/card-export/README.md` ⇒ **全是文档/证据说明，零代码、零生成物**。
    链 Y 的起点标的是 `15e777e7`（那条 tokenizer 修复），而它跑的时候读的是**工作树**，
    所以它的 `RC_CHECK` 对当前 HEAD 仍然成立 —— 唯一的例外是 `check:docs` 与 `check:md-table-rows` 这两段会把我随后写的文档一起判，
    这两段我已单独跑到 rc=0（本条这次提交前又各跑一遍）。

- ㊼ **mac 那一腿从"等别人"改成"本批自取"：先否证"公证在判据里"，再量到装步有两条没有绕法的占用**（04 14:4x–14:45，载体 `3178a097`）
  - 🔴 **起点是一条我自己写的、说过头的话**：㊳ 里那句"macOS 那一腿**整轮**都关不掉"。14:4x 逐段读 `package-app.sh` 才把它拆成两半 ——
    关不掉的只有**装步**，"打包 + 产物栏 + 打包副本自截屏"三件是本批自己做得到的。拆开的钥匙是一个事实：
    **公证从来不在退出码里**。`package-app.sh:278` 写的是 `if xcrun notarytool … | tail -8 | awk; then` ——
    判的是 `awk` 的码（§7 第 179 条那个形状），失败分支（`:282-284`）只打印一句"🔴 公证失败"就继续走到 `=== 产物 ===`。
    而 `.app`/`.dmg`/`packaged-first-run.png` 在第 ③④⑤ 步就产完了。**被卡住的是等待，不是判据** ⇒ 去掉它不可能把红跳成绿。
  - ✅ 于是加了一条**默认行为逐字不变**的旋钮：`HEYTA_SKIP_NOTARIZE=1` 只跳过第 ⑥ 步（`3178a097`，
    脚本文件头 + `docs/runbooks/multi-platform-build.md` §6 各登记一次，跳过时脚本自己把那行"本趟不主张已通过公证"打进输出）。
    **三臂实测**（零 CPU 的分支对照，不靠真打包）：不设 ⇒ `BRANCH=SUBMIT`、`=0` ⇒ `SUBMIT`、`=1` ⇒ `SKIP`。
    `bash -n` SYNTAX_OK。为什么这不是"为了让它过"：它改变的是**上界**（`--wait` 无超时，同一档实测已 11h25m 不返回），
    不是任何一条断言。
  - 🔴 **装步那半量到了三条硬的，其中两条没有绕法**（原句只有两条，且其中一条已被 ㊹ 否证）：
    ① `reinstall-all.sh:192 MAC_OUT=/tmp/heyta-macos-dist` 写死 + `package-app.sh:36` 对 OUT_DIR 盲删 —— **有绕法**（OUT_DIR 是位置参数）；
    ② `:193 INSTALLED_APP=/Applications/Heyta.app` 写死，而 14:4x 现量 **pid 772 就是从那枚包里跑起来的 `HeytaMac`**
      （`etime 17:06:54`，起于 10-03 21:33），而 `:198` 是 `rm -rf "$INSTALLED_APP"`
      ⇒ 这不是"目录被别人占"，是**把别人进程脚下的包删掉**。**没有绕法**（那两行没有 env 旋钮）；
    ③ `:228` 清的是 `~/Library/WebKit/cloud.finlaw.heyta.desktop` —— 容器**按 bundle id 分**，与那枚实例同一个，
      清它=替别人的会话重置首屏状态（§7 第 83 条：探针会改变被测对象的状态）。**没有绕法**。
    ⚠️ 我没为此给 `reinstall-all.sh` 加"私有安装位置"旋钮：加了**这一轮也取不到读数**（②③ 挡的是共享位置本身，不是路径字符串），
    装一个没人能按的旋钮就是死代码。它属于"要让 mac 装步能在并发环境里自取"那一单，登记在这里而不是做成半成品。
  - 🔴 **顺带修强了链 W 自己的对账**（这条是本批的老毛病，§7 第 174 条）：它原来只比 `index.html` 一枚 sha ——
    那证明的就是 `index.html` 一个文件。现在补了 [3b]：**与 `reinstall-all.sh:217` 同一条判据**搬到打包副本上，
    比 `web-dist/assets/` 的**文件名集合**（Vite 文件名是内容寻址哈希 ⇒ 集合相等 = 两次构建相等）。
    三臂离线对照（不打包就能验这条算式有牙）：同一目录 ⇒ `DIFFN=0`（会报"同一次构建"）、
    `apps/landing/dist` vs `apps/web/dist/assets` ⇒ `DIFFN=26`（会报"不是同一次构建"）、目录缺 ⇒ 由 `-d` 守卫**响亮报没有分母**。
  - ⚠️ **一次我自己的探针形状错，别记成产品红**：`pnpm --filter @heyta/desktop check:macos-shell` 回 rc=1 ——
    `check:macos-shell` 是**根包**的脚本（`package.json:28`），不在 `apps/desktop-macos` 里，那条命令根本没跑到判据。
    读数一律以 `pnpm check` 那趟（链 Y）为准。
  - 📌 **链 X 的 cap 现量**：`14:4x 累计 3420s / 3600s` ⇒ 两分钟内 `exit 3`。它不是失败，是**环境无效**（任务书第 8 条），
    阈值 12 不为 本批下调（任务书第 8 条）；接力的是链 Z（cap 7200s）。

- ㊽ **等链的释放信号必须写在每一条出口上：链 X 的 exit 3 分支不写终点哨，Y/Z/W 三条会静默等到自己的上限**（04 14:46–14:54，载体 `e1b94b67`）
  - 🔴 **现象是"什么都没发生"**：链 X 14:46:39 打印 `RC_WINDOW=3`（负载门等满 3600s，负载仍 34 ⇒ 环境无效，任务书第 8 条），
    然后进程退出。链 Y 的等待条件是 `grep -aq '=== 链 X 终点'`，而那一句在 X 的脚本里是**第 48 行** ——
    两条 `exit 3` 分支（`:31` 别人的 iOS 构建没退、`:36` 负载门等满）都在它**之前**退出。
    ⇒ X 越"正确地失败"，Y 越不可能收到放行信号；Y 会一直等到自己的 3 小时上限（17:06）然后也报"没跑"，
    Z 等 X+Y、W 等 X+Y+Z，**整条队列被一个缺失的打印句锁死**。这不是产品失败，也不是环境失败，是**编排自身的缺陷**，
    而且它的症状与"还在正常排队"逐字相同。
  - ✅ **处置**：14:53:59 由我**补写**那行终点哨进 `/tmp/device-closeout-X.log`，补写内容自己说明了三件事
    （谁补的、为什么补、X 的真实终态是上一行 `RC_WINDOW=3`）—— 补的只是**队列信号**，没有改任何读数、没有伪造 `RC_IOS_PROBE`。
    链 Y 30 秒内收到并开始跑。**修法登记**（下一批做，本批不动运行中的链）：
    后台链的终点哨要么放 `trap '…; say "=== 链 终点 ==="' EXIT`，要么每条 `exit` 前各写一遍；
    判据是**给每条链配一条"上游已退出但哨未落"的看门狗**（`kill -0` 上游 pid + 哨未出现 ⇒ 响亮报"队列锁死"），
    否则下一次它仍然只会表现为"没人动"。
  - 📌 **同趟顺手量到的**：链 Y 的 `pnpm check` 是在 **`loadavg 22.99 / 25.68 / 28.31`** 下开跑的（14:54 现量），
    它的前置只挡 4318/4319 端口占用、不挡负载。所以这一趟的读数**必须带这个负载上下文**：
    全绿 ⇒ 那是比"安静窗口全绿"更强的一格；有红 ⇒ 先按负载归因、在安静窗口复跑那一段，不直接算产品账（§7 第 163/168 条同族）。
  - ✅ **另一件在本条里一起收掉的事：证据常驻审计**。写了一个只读脚本
    （``research/tools/audit-evidence-screenshots-tracked.mjs`（已入库，可复跑：`node research/tools/audit-evidence-screenshots-tracked.mjs docs/plans/countdown-anniversary.md …`）`：扫计划与证据 README 里每个 `.png`，逐个对 `git ls-files`）——
    🔴 **它第一版自己有假阳性**：文档里 `../../apps/mobile/evidence/card-export/latest-card.png` 这种相对写法被判成 MISSING，
    而那枚文件**是在库里的**。按"自写判据先喂已知会命中的样本"这条纪律喂了它一次才发现，
    补了归一化 + 裸文件名两遍扫描（第二遍是必要的：文档里大量写的是 `card-light.png` 这种不带路径的）。
    修强后的读数：**TRACKED 4 / by-name 15 / 临时目录 2 / MISSING 若干**，其中真正的问题是 5 枚
    只活在 `e2e/test-results/` 的截图（W5 三张 + W6 侧栏两张）—— 台账里"三张图人已看""两张图人已看"
    那两句的证据**在干净检出上不存在**。已搬进 `apps/web/evidence/countdown-cards/`（新）与
    `countdown-calendar/`（补），带 md5 与"哪一趟"，`e1b94b67`。
  - 🔴 **搬的时候照出一条会自己吃掉证据的用例形状（W5-G1 / 任务 #28）**：`countdown.spec.ts` 的 `:102`
    与 `:191` 写**同一个** `test-results/countdown-board.png` ⇒ 后跑覆盖先跑。盘上那张经人复核是"两列"那张
    （`countdown-board.png` 1280×900，左「甲日子 · 还有 28 天 · 11月1日」右「乙日子 · 已经 32 天 · 9月2日」），
    所以"点出一条之后屏上长什么样"那张**从来没有常驻过**，而"三张图"这句一直把它算在内。
    本批不改 spec：链 Y 正在跑完整 `pnpm check`（含 `check:ai-e2e`），改它抢的是同一批用例。

- ㊾ **链 Y 的完整 `pnpm check` 读数到手：23 段先过、停在 `check:legal-permissions`（7 条红，逐条归因到 W9 那半）；链 Z 的 iOS 重装倒在 `pod install`，而它不是环境坏了**（04 14:54–15:05，载体 `e1b94b67`）
  - ✅ **Goal ⑤ 第 1 项的读数**（`/tmp/device-closeout-Y.log`，14:54:5x 开跑 → 14:55 收口，`RC_CHECK=1`）：
    按 `package.json:58` 那条 `check` 串的**段序**数，**前 23 段全过**（第 1 段到第 23 段 =
    `pnpm build` → `check:entries` → `typecheck` → `claims` → `reachability` →
    `op-log-semantics` → **`shell-surfaces`** → `migrations` → `token-hashing` → **`layering`** →
    **`ui-provider`** → `theme` → `row-single-source` → `l4` → `empty-state` → `widgets` → `arkts-widgets` →
    `adaptive-cards` → `pwa` → `ui-language` → `docs-voice` → `legal-copy` → `legal-tools`），
    **第 24 段 `check:legal-permissions` rc=1** 把串联停住。
    ⚠️ 单位钉死：这里的"段"是 `&&` 切出来的**一条命令**，不是日志里 `$ ` 开头的行数（那个现量 27 行，
    因为嵌套的 `pnpm -r build` 之类自己也打 `$`）—— 两种数法会差 4，别拿其中一个去对另一个。
    可复跑：`node -e 'const s=require("./package.json").scripts.check.split("&&");const i=s.findIndex(x=>x.includes("check:legal-permissions"));console.log(s.length,i+1,i)'`
    ⇒ `68 24 23`（总 68 段、停在第 24 段、前面过了 23 段、链 S 要取的是剩下的 **44 段**）。
    🔴 **本批那三格现在是被串联代取的，不是我单独跑的**：`ui-provider`（㊶ 修的那一行）在完整链里绿，
    `shell-surfaces` 在完整链里绿，`layering` 也绿 —— 这比"我单独跑一次 rc=0"强一档。
  - **那 7 条红逐条**（原文在 `/tmp/device-Y-check.txt` 尾部）：6 条是 `permissions.ts` / `third-parties.ts` 里
    「移动端不申请通知权限 / 不产生任何系统通知」那六句（zh+en 各三条）撞上了**已经声明的**
    `AndroidManifest:POST_NOTIFICATIONS` + `Info.plist:NSUserNotificationsUsageDescription`；
    第 7 条是 `SCHEDULE_EXACT_ALARM` 既不在 `PRIVACY_ITEMS` 也不在 `NON_PRIVACY_ANDROID_PERMISSIONS`。
    🔴 **归因是现量的，不是印象**：`git blame -L '/SCHEDULE_EXACT_ALARM/,+1' apps/mobile/android/app/src/main/AndroidManifest.xml`
    ⇒ `b0ba4a35`（2026-10-03，W9 原生投递那半）。⇒ 这七句属于 §0.5 的 **L 系列那一行**，
    裁决早就写过：六句必须**一起翻**并重跑 `check:legal-copy`，本批代改会造一次三方冲突、还会把别人的裁决算成自己的。
    **所以我不把它改绿**，Goal ⑤-1 的真话是"串联到第 24 段停住 + 它之后每一段各自的读数由链 S 取"
    （S 的段清单**不手抄**：从 `package.json` 的 `check` 串现解析 `legal-permissions` 之后的全部，别人加一段下一轮自动带上）。
  - 🔴 **一条我自己的探针形状错，别让它留在读数里**：Y 打印的"停在/过：`check:legal-copy`"是**假的**——
    那条 `grep -oE 'check:[a-z0-9-]+' | tail -1` 取到的是**报错正文里那句"翻完重跑 `pnpm check:legal-copy`"**，
    不是段名。真停点是 `check:legal-permissions`（`grep '^\$ node scripts/'` 才看得见段序）。
    ⇒ 从日志里"取最后一个像名字的东西"当进度指针，会被日志正文里出现的同一个词骗走（§7 第 45 条那一族的新面目）。
  - ✅ **`RC_WINDOWS_LEG=skip`（同趟 [4] 步）**：Y 的 `pnpm build` 跑完之后 `apps/web/dist/index.html`
    sha 仍是 `517C6BA76D00FB25`，与 10:39 打进 windows 包的那枚**逐字相同** ⇒ ㊲ 那份 windows 取证对本轮仍然成立，
    不必重打远端。这条自愈判据第二次真的起作用了（第一次是链 U）。
  - ✅ **同趟顺手证了 Android 那格也不用重跑**（不花 CPU，只读提交元数据）：
    `git diff --name-only b995597a..HEAD` = **15 个文件**，其中
    `grep -cE '^(apps/mobile/(src|android)/|packages/[^/]+/src/)'` = **0** ——
    13:18 重装、13:20 取到 `RC_ANDROID=0` 的那枚 APK 的 bundle 输入，从那时到现在**一个字节没动**。
    ⚠️ 它证明到的是"bundle 输入未变"，不证明"`pnpm -r build` 重打后 `packages/*/dist` 逐字节相同"——
    那一句由 `check:mobile-bundle` / `check:native-deps` 在链 S 里取。
  - 🔴 **链 Z 的 iOS 那一腿换了个失败姿势**：`RC_REINSTALL_IOS_Z=1`，`✅ 全仓构建完成` 之后
    **`pod install` 失败** ⇒ `reinstall-all.sh` 自己判定"沙盒未同步 ⇒ 这一轮没有跑 xcodebuild"（这是它该有的行为：
    不拿旧沙盒继续装）。报错原文 `ArgumentError - path name contains null byte`，
    栈顶 `cocoapods-1.17.0/lib/cocoapods/project.rb:452 realdirpath`（`add_file_reference` 阶段）。
    **已排除的三种"环境坏了"**（都是现量，不是猜）：
    ① 工具链没动 —— `/opt/homebrew/Cellar/{ruby,cocoapods}/*` 目录时间戳都在 **Sep 2026**；
    ② 机器上 CocoaPods 是好的 —— **主检出**的 `apps/mobile/ios/Pods` mtime = **10-04 13:45:48**（别人那趟 pod 成功过）；
    ③ 不是非 ASCII 文件名 —— `find apps/mobile/ios -maxdepth 3 -name '*[! -~]*'` **零命中**
       ⚠️ 顺带一条命令坑：我第一版在同一行加了 `-o -name '*\n*'`，`find` 把它当**转义后的字面 n**，
       于是 `HeytaWidgetExtension` 这种纯 ASCII 名"命中"了 —— 差点把"有非 ASCII 文件"当成结论写出去。
    本机 `LANG`/`LC_ALL`/`LC_CTYPE` **全未设置**（这是唯一还站得住的候选，与上游 issue #12798/#12866 那批形状同源），
    但**尚未证**——要证它得重跑一次 `pod install`，而链 Z 此刻正拿着那枚（旧）已装 app 跑探针，
    同一时刻动 `ios/` 就是抢它正在读的树。⇒ 排到 Z 收口之后，与链 S 串行。
    ⚠️ **04 16:1x 已被否证**（四臂，见下面 ㊙）：locale 缺失只会造成**另一种**错（`installation_root`），
    它不是 `null byte` 的成因；这一句留原文是为了让后来者看到"唯一候选"这种判断是怎么倒的。
  - ⚠️ **Z 现在这趟探针的读数是"装在设备上的那枚 app"的**，不是当前提交的 —— 它自己的新鲜度判据
    （`verify-mobile-card-export-ios.sh` 开头那条"装的 app 不比源码旧"）会替我说这句话，
    我不替它宣布结论。**W7-G3 仍然不打勾。**

- ㊿ **一道常驻门禁当场照出本批自己的 35 处 shell 变量陷阱；iOS 那三种"环境坏了"再排两种；Goal ③ 的"三端齐"现在有一条可核对的形状**（04 15:1x，载体 `117386a1`）
  - 🔴 **`check:shell-unicode` 现量 rc=1，点名两处全在本批自己的 W7 设备探针里**：
    `scripts/verify-mobile-card-export-ios.sh` **32 处** + `scripts/verify-mobile-card-export.sh` **3 处**
    （`git blame` 现量：`7806f6ae5` / `2987cfdbd`，都是 10-04 本批的提交）。
    形状是 `$VAR` 紧跟全角字符 ⇒ 变量名被吞（C locale 下 `set -u` 直接 `unbound variable`），
    **退出码不受影响、打印出来的证据是乱码** —— 正是 §7 第 64 条那一族，而仓里早就有这道门禁
    （`5599141c` 全仓扫过 172 处、`2f735392` 把它注册进 `pnpm check`）。
    ⚠️ **这条对本批的读数有直接影响，而且我差点把它写过头**：13:20 那趟 Android 打印的
    `ok "这张卡的导出文件落盘了：$FOUND（mtime 晚于点击时刻）"` 就在违规清单里。
    我第一版想写"现量：那句打印是完整无乱码的"—— **那句不成立**：链 U 的日志只留了尾部摘要，
    `grep '落盘了' /tmp/*.log` 现在只在那道门禁自己的报告里命中，**那趟的原始 echo 没有留下**。
    现在能主张的只有两件：① 判据用的是 `[ -z "$FOUND" ]` 而不是那句 echo ⇒ 判定不经过这条通道；
    ② 证据 README 的 ②′ 行记的是**从设备拉回来的那枚文件在盘上的名字**
    （`heyta-w7e2e-131811-10月11日 星期日.png`），那是另一个通道，不受 `$VAR` 吞名影响。
    🔴 可迁移的那条：**"打印即证据"以后不能再用** —— 凡是只有 echo 一份读数的判据，
    要么把原始日志整趟留存，要么把读数写进产物（这次两处都靠后者救回来了）。登记为任务 **#30**，
    修法用仓里的自动修（`fix-shell-unicode-vars.py --write`，一次 35 处），
    🔴 **时序硬约束**：链 Z 正在跑那枚 iOS 探针，bash 对运行中的脚本是**增量读取**，跑完之前改它 = 制造一次没人能复现的错乱。
  - ✅ **pod install 的"环境坏了"再排除两种**（都是现量，不靠猜）：
    ③ `apps/mobile/node_modules` 里 **35 枚软链、断链 0** ⇒ "dangling symlink 让 `realdirpath` 拿到垃圾字符串"这一支不成立；
    ④ `check:script-snapshot` **rc=0**（36 个脚本的自快照 bootstrap 全在位）⇒ 探针脚本没被半写坏。
    剩下唯一候选仍是 **locale 未设**（与本条上面那个 `$VAR` 陷阱同源的环境条件 —— 这不是证明，是"同一把嫌疑现在解释两件事"），
    验证办法与双臂对照写在任务 **#29**。
  - 📌 **Goal ③「壳级门禁三端齐」现在有一条能对账的形状**（读 `scripts/check-shell-surfaces.mjs` 本体，不是读台账措辞）：
    三端各自的**判据种类不同**，不能拿一个的绿去推另一个 ——
    `desktop-windows` = 正向取证通道（`artifactFacts` + `HEYTA_WINDOWS_FACTS` 读远端回传的 `PAYLOAD_*` 四件套，链 S 已量过四臂）；
    `desktop-macos` = 正向产物栏（`HEYTA_MACOS_WEB_DIST` 指包内 `web-dist`，链 W 在取）；
    `desktop-linux` = **登记缺口 `W8-GAP-L1` + 反向判据 L2**（`:1035`：`apps/desktop-linux` 下一旦出现 `web-dist` 引用就红，
    即"这句缺口现在是真的"是被**量**出来的，不是被声明的；G11 那一臂第一次还没红 —— 因为 `walkSources` 按扩展名过滤，
    假引用塞进 `Makefile` 不命中，后来换成 `walkAll` 才有牙，见 `:357` 那段）。
    ⇒ 所以"三端齐"这句的真话是：**windows 有读数、mac 有读数在路上、linux 有一条会红的反向判据**，
    而不是"三端都拍出了这一屏"。链 S 会把 `check:linux-shell` / `check:windows-shell` / `check:macos-shell`
    三段各自的 rc 取回来（它们在串联第 24 段之后，Y 没跑到）。

- ㊑ **链 Z 收口：iOS 那一腿的探针**自己**拒跑了，而且拒得对**（04 15:16，载体 `117386a1`，`RC_CHAINZ=3`）
  - 读数（`/tmp/device-closeout-Z.log` + `/tmp/device-Z-ios.txt`）：
    `RC_REINSTALL_IOS_Z=1`（`pod install` 挂在 `path name contains null byte`，`reinstall-all` 自己判定"沙盒未同步 ⇒ 不跑 xcodebuild"）
    → 探针那一步在**第 0b 步**就停：
    `❌ 按 BID=com.heyta 在这台上解析不到已安装的 app —— 没装上，或装的是别的 bundle id ⇒ 本轮无效`，退出 **3**。
  - ✅ **这条是那道新鲜度门第一次在"重装失败之后"这条路径上起作用**：`reinstall-all.sh` 的 ios 段是
    **先 `simctl uninstall` 再打包**，所以打包失败会把那台模拟器**留在空的**状态。
    探针没有拿"上一枚旧 app"继续跑（那正是 §7 第 27/82 条要防的形状），而是把"没装上"如实判成**本轮无效**。
    ⚠️ 副作用登记：私有模拟器 `heyta-batch2-closeout` 上此刻**没有** `com.heyta`（它是我这轮的私有现场，不涉及别人的设备）。
  - 🔴 **为什么这条链跑完我没有立刻去试 locale**：链 S 正在逐段跑那 44 段，其中
    `check:native-deps`（比 `package.json` ↔ `Podfile.lock`）、`check:card-export`（数 pbxproj 里那两个文件）、
    `check:mobile-bundle` 都**要读 ios 那棵树**，而 `pod install` 会重写 `Pods/` 与工程引用 ——
    在那中间动它，取回来的既不是"提交态的红"也不是"修完的红"，是第三种没人能复现的东西（§7 那一族"只在混合工作树成立"的红）。
    同理**也不在这中间改那两枚探针脚本**（任务 #30 的 35 处 `$var` 紧跟中文），
    尽管 `check:shell-unicode` 排在第 **62** 段、时间上赶得上 —— 它赶得上，但 #52/#54/#55/#65/#66 都可能在它之前读这些文件。
    ⇒ 顺序定死：**S 的 44 段读数先取完（那是一份对载体诚实的读数，含 `shell-unicode` 那格本批自己的红）**
    → 再修 #30 → 只复跑受影响的那几段 + 那道门禁本身。
  - ⏳ **W7-G3 仍未打勾**；Goal ② 的 iOS 那一半现在卡在**一件具体的事**上：`pod install` 在这台机器上跑不通
    （三种"环境坏了"已排除，见 ㊿；locale 是唯一候选、未证 = 任务 #29）。
    这不是"再等等"，是要一次有裁决力的实验：**双臂对照**（带 `LC_ALL=en_US.UTF-8` 一次、不带一次），
    而且要在 S 收口之后做。
    ✅ **04 16:1x 这趟实验做了，答案是否定的**（四臂，见 ㊙）：`LC_ALL` 有无都成功；
    两个 locale 都不给是**另一种**错；`null byte` 在同一 env 形状下 3 趟 2 成 1 崩 ⇒ 逐趟非确定性。
    上面那句"locale 是唯一候选、未证"随之作废，处置改成了 `reinstall-all.sh` 的**有界重试**。

- ㊒ **链 S 的 44 段读数到手 + 链 W 把 mac 那三格取回来 + 那两张图我打开了**（04 15:1x–15:2x）
  - **链 S**（`/tmp/device-closeout-S.log`，载体 `117386a1`）：`RC_SEGMENTS=绿38/红6`，
    `REDS= check:journey-coverage check:ai-e2e:skip check:privacy-consent-e2e check:landing-e2e check:shell-unicode -r test`。
    这 6 格按"谁的"分开了，**没有一格是本批的产品红**：
    · `check:shell-unicode` = **本批自己的红**（就是 ㊿ 那 35 处），现已修掉，见下；
    · 其余 5 格 = **并发拒跑**：`/tmp/tfa-test.lock` 当时被 pid 21302 占着，4318/4319 上有别人的 vite
      （`check:ai-e2e` 的 preflight 会朝那两个端口发 SIGKILL），`journey-coverage` 单跑一次是 **rc=0**；
    · ⚠️ **链 S 自己有个缺陷要登记**：44 段全写进同一个 `/tmp/device-S-seg.txt`，于是只有**最后一段**的明细活下来
      —— 上面那 5 格"为什么红"我是靠单跑复现才知道的，不是靠链日志。链 V 改成每段一个明细文件。
  - **链 W**（`/tmp/device-closeout-W.log`，载体 `117386a1`，`RC_CHAINW=0`）：mac 那三格取回来了 ——
    `RC_MAC_PACKAGE=0`（`HEYTA_SKIP_NOTARIZE=1` 那一趟）；包内 `web-dist/index.html` sha `517c6ba76d00`
    与本机 `apps/web/dist` **逐字相同**；`[3b]` assets 集合对账 **包内 9 / 本机 9 / 差异行 0** ⇒ 装进 .app 的就是这一批打出来的产物；
    `RC_SURFACES_W=0`，`check-shell-surfaces` 经 `HEYTA_MACOS_WEB_DIST` 指到**包内**那份后打出
    「判定 5 格（面 × 端）：**5 绿 / 0 红；未取证 0 栏**」。
    ⚠️ 这一趟**不主张**"这个包已通过公证"（那条要等不带 `HEYTA_SKIP_NOTARIZE` 的一趟，理由与三臂实测在 `3178a097`）。
  - ✅ **Goal ⑤-3 的"人看过"这一格：15:2x 我把两张图都打开了**（`/tmp/heyta-macos-dist-b2/`；
    🔴 15:5x 已把两张都复制进版本库 `apps/desktop-macos/evidence/package-20261004-1511-mac-app.{png,webview.png,txt}`
    —— 理由与 W5-G1 完全同族：**"人已看过"的证据如果只活在 `/tmp`，下一次会话就没有任何东西可对账**；
    md5 分别 `ae28c2f6…` / `d674c887…`，配好的 `.txt` 里写明"证明到哪一步为止"）：
    · `packaged-first-run.png.webview.png`（155 563 B）= **真界面**：左 rail 九项（头像/任务/收件箱/日历/习惯/四象限/统计/搜索/回收站 + 底部铃铛与帮助）、
      主区标题「收集箱」+ 顶栏「未同步 / 刷新 / 设置 / 中文·English / 深色」，中间浮着**首启那张同意弹窗**
      「在使用联网功能之前」，正文三点 + 「服务条款 / 隐私政策」两个链接 + **同意并联网**（主蓝实心）与「只用本机」两颗钮；
      弹窗背后可见「AI 工具调用」卡、「四象限」四行各带一颗色点、「清单」「标签」两处空态。
      ⇒ 这一屏同时证到两件事：**共享 UI 打进包里且渲染出来了**，以及 **L' 那批的同意面在原生壳里第一屏就在**。
    · `packaged-first-run.png`（13 013 B）= **只有三颗交通灯的空窗口**。这不是新缺陷：`package-app.sh:232-242`
      已经把"内容判据的载体"压在 WebView 快照上，并在 `:242` 显式打出「窗口截图本身是空的 —— 本机常态：
      WebView 内容没合成进窗口，不据此判红」（2026-10-03 实测的结论，反向那一例是窗口图内容 ~100% 却主蓝 0）。
      🔴 但要把边界写清：**窗口图为空 ⇒ "屏幕上那个窗口真有内容"这一件没有被这张图证到**，
      我主张的只是"包里的 .app 起得来、WebView 里渲染的是共享 UI"。前者要人眼看真窗口，属于 #23 那一格（共享位置持有者）。
  - ✅ **#30 已修并提交 `344d2812`**：`research/tools/fix-shell-unicode-vars.py --write` 改了两枚探针 35 处。
    零语义变化的证法（第一次那条证法是错的，见下）：把 `${X}` 归一化回 `$X` 后与 `git show HEAD:` 那份 `diff`
    ⇒ **两份文件都 0 行**；`bash -n` 两份 SYNTAX_OK；`check:shell-unicode` 从"这两份 35 处"变 **RC=0**（现扫 81 个 .sh）。
    ⚠️ 登记我自己的一个错法：上一趟我拿 `git diff` 的 `+`/`-` 行去比"归一化后是否相同"，
    而 diff 行**自带前缀字符** ⇒ 那个比较永远不可能成立。**"改了什么"要拿 HEAD 版与工作树版各自归一化再比，不能拿 diff 的输出当输入。**
  - ⏭ **链 V 已起**（`/tmp/device-closeout-V.log`）：把上面那 5 格并发拒跑的段复跑取数，
    起笔现量 `vm.loadavg` 1 分钟 = **31.18 ≥ 12** ⇒ 正在等窗口（不是卡住），上限 5 小时，等满以 `RC_LOAD=3` 收口 = 环境无效。

- ㊓ **链 V 六格全跳过（0 读数）＋ pod 那条"locale 假设"被我量否证**（04 15:3x–15:37）
  - **链 V 的结果是"一格读数都没取到"**：负载门开了，但每段起跑前数到 2 条"别人的 runner" ⇒ 六段全 `skip`
    （`汇总：RC_journey-coverage=skip RC_shell-unicode=skip RC_ai-e2e=skip RC_privacy-consent-e2e=skip RC_landing-e2e=skip RC_r-test=skip`）。
    那两条是 `heyta-wt-hierarchy`（**第三个 worktree**）的 vitest worker 与另一会话的语义变异 rig ——
    🔴 **两者都不碰我的 `e2e/test-results/`，也不占 4318/4319**。
    ⇒ **教训：「有没有别人在跑」要按冲突面定义，不是「存在任何别的进程」。过宽的自我拒跑不是保守，是把判据的产出清零**，
    而且它打印的是"响亮跳过"，看上去尽职，实际零读数——比静默失败更难发现。
  - 🔴 **重写那一版时探针自检又照出第二条**：macOS 的 `pgrep` **没有 `-a`**，传上去只打 pid ⇒
    后面那句 `grep -F 'heyta-wt-batch2'` 是在 pid 串里找路径 ⇒ **永远 0 命中，那条守卫是恒绿的空判据**。
    全部换成 `ps -Ao pid,command | grep`，并按 §7 元规则二给它做**阳性对照**：
    起一枚 argv 里同时带 `vitest-runner` 与本工作树路径的哑进程 ⇒ 守卫命中 **1**；杀掉 ⇒ 命中 **0**。
    （第一次哑进程写成 `sleep 25 vitest_dummy …`，`sleep` 把后面两个参数当 interval 报错 ⇒ 对照自己坏了，
    命中 0 被我读成"守卫没活"——**对照也要能失败**。）
  - 链 V2（`/tmp/device-closeout-V2.log`）按冲突域分三段跑：静态两段不设门、`-r test` 只看本工作树、
    e2e 三段等"别的会话的 playwright/vite 收口 + 4318/4319 空"（现量到 pid 27069 那条整链 `check` 正在跑，它会走到 ai-e2e）。
  - ✅ **Goal ② 的 iOS 阻塞项（#29 的 locale 假设）量完并否证**，四条实测：
    · `Pathname.new("/a\u0000b").realdirpath` ⇒ **正是** `ArgumentError: path name contains null byte`
      ⇒ 报错要求字符串里**真有** NUL；
    · 但把探针指向 CocoaPods 报的那个调用形状（`project.rb:452` 就是 `base_path.realdirpath`），
      对 `apps/mobile/node_modules/react-native` 全量 5594 条 glob 结果逐条跑 ⇒ **同一份输入连跑六趟，
      命中数分别 3 / 2 / 5 / 4 / 3 / 2，且每趟命中的是不同文件**（第一趟 `AppleEventBeat.cpp` 等三枚，
      第二趟换成 `DefaultReactHost.kt` / `RCTHost.mm`）；
    · 对命中的那串**在同一进程里再调一次** `realdirpath` ⇒ **成功**，且那串 `bytes` 里 **NUL 数 = 0**、
      `valid_encoding? = true`、`ascii_only? = true`；
    · ⇒ **这不是任何一条路径的属性**：locale 未设确实让 Ruby 拒绝**解析**含中文的脚本
      （我自己那条 `ruby -e` 就报了 `invalid multibyte character 0xE7`，与 `check:shell-unicode` 同族，
      是这台机器一条真实的坑），**但它不是 null byte 的来源**。
    ⚠️ **诚实边界**：我复现的是"glob 惰性迭代 + realdirpath"这一层的抖动，CocoaPods 那侧先把 glob 结果
    `uniq`/`flat_map` 物化了，所以我**不主张**这就是它失败的那一步；我主张的只有三句：
    ①locale 不是判别量；②失败是**非确定性**的 ⇒ 重试有意义；③Ruby 4.0.7（2026-09-15 发布）+ macOS 27.2 是这套组合第一次进这台机器。
  - 顺带量清一条**为什么每次都要重跑 pod** 的事实：`Pods/Manifest.lock` 与 `Podfile.lock` 只差**一行**
    （`hermes-engine: d25a17a7…` vs `208b0dcd…`，`cmp` 指到 char 74008 / line 2952），
    而工作树里那份 `208b0dcd…` 是 **HEAD 的内容**，最后一次改它的是 `b055efc0`（10-03 09:37，不是本批）
    ⇒ 沙盒是**在那笔之前**装的，`reinstall-all` 判定"不一致 ⇒ 跑 pod"是对的，不是探针误判。
  - ⏭ 下一步（不等别人）：安静窗口里**重试** `pod install`（非确定性 ⇒ 重试是合法手段，不是碰运气，
    且失败仍会由 `reinstall-all` 的沙盒判据拦住），成了就 `--only ios` 重装 + `verify-mobile-card-export-ios.sh` 取 W7-G3。

- ㊔ **Goal ⑤-4 的四端账：每一格的"装的是当前产物"都按该端的输入集对账到 HEAD**（04 15:4x，纯只读）
  - 载体一直在动（15:07 之后又落了 4 笔），所以"13:20 装过 android / 10:4x 装过 windows / 15:11 打过 mac"
    这三句不能只报载体 SHA 就完事 —— 要逐端量**那一端的打包输入**自它的读数以来改没改。现量：
    | 端 | 读数 | 读数时载体 | 该端输入集自那以后改了几枚 | 结论 |
    |---|---|---|---|---|
    | android | 链 U 13:20 `RC_ANDROID=0`（11 项全过） | `b995597a`（13:10） | `apps/mobile packages apps/web/src` = **2 枚，全在 `apps/mobile/evidence/`**（成品图 + README） ⇒ 产品输入 **0** | 读数对 HEAD 仍成立，不必重跑 |
    | windows | 链 S 10:4x `RC_SYNC=0`+`RC_PACKAGE=0`+七条取证 | `6105ba3b` | `apps/desktop-windows apps/web scripts/windows` = 7 枚，**非取证 0 枚**（逐条都是我这轮入库的 `apps/web/evidence/**`） | 同上 |
    | macOS（打包/产物栏） | 链 W 15:11 `RC_MAC_PACKAGE=0` | `117386a1` | `apps/desktop-macos apps/web` = **0 枚** | 同上 |
    | iOS | 未取 | — | — | 链 P 排队中（㊓ 末） |
  - ⚠️ 这条对账**只**回答"装上的还是不是当前提交的产物"，不回答"装没装"。后一句 mac 仍差
    "装进 `/Applications`"那一格（#23，常驻实例 pid 772 + 写死路径 + 共享 WebKit 容器，三条硬的），
    iOS 那格现在差的是 `pod install`（链 P 的有界重试）。
  - 📌 顺手把 Goal ② 点名的"零法务变更"再量了一次，与 ㉗（Android 侧）/ ㊸（iOS 侧）同向且更省事（不用读 diff）：
    `apps/mobile/ios/Heyta/Info.plist` 里 `NS*UsageDescription` **只有一枚** = `NSUserNotificationsUsageDescription`（那是 W9 的），
    `AndroidManifest.xml` 的 `<uses-permission>` 只有 `INTERNET / POST_NOTIFICATIONS / SCHEDULE_EXACT_ALARM` ⇒
    **卡片导出没给任何一端添权限**，`permissions.ts` 那句"不申请照片"逐字仍为真。

- ㊕ **链 V2 的三格读数到手，其中 `RC_r-test=1` 不是产品红 —— 它把"内存闸门会排队"这句我上一轮的假设否证了**（04 15:4x）
  - ✅ `RC_journey-coverage=0`：打出「✅ web 旅程验收跑通」+「✅ 每一端要么有旅程验收、要么有**显式登记**的缺口（含理由与到期条件）」；
  - ✅ `RC_shell-unicode=0`：「没有『变量名被非 ASCII 吞掉』的写法（扫了 81 个 .sh）」—— 这是 ㊒ 那笔 `344d2812` 的**复跑确认**，不是我看门禁输出下的结论；
  - 🔴 `RC_r-test=1`，但明细里那一条红的真身是（`/tmp/device-V2-r-test.txt:42`）：
    `packages/sync-core test: 内存闸门拒绝启动：已有测试在跑（pid=97013，锁 /tmp/tfa-test.lock；它是：…/scratch-owner-transfer/rbac-ai-queue/test-gated.te）`
    ⇒ **挡住整条 `-r test` 的是别人一个跟本仓无关的 scratch 测试**，而同趟其余包是绿的
    （`local-api 130 passed`、`i18n 22 passed`、`design-system 489 passed`，`shared-schema` 只有一条 vite 配置警告）。
  - ⚠️ **我上一轮写链 V2 时的那句假设当场被否证**：注释里写着"`-r test` 的内存冲突由 `~/.tfa-shield/bin/pnpm` 自己排队（那是它的设计）"——
    实测它**不排队，是拒绝启动并退 1**。⇒ 重试链起跑前必须**先等 `/tmp/tfa-test.lock` 空**，
    否则取回来的永远是同一个环境红（这正是 §7 元规则一"探针够不着"与"事情没发生"在输出上长得一样的又一例）。
  - ⏭ 链 P 已停（它只写了一行起点、**零读数**，停它是为了把 `-r test` 排进同一序列而不是并发）；
    改由**链 Q**（`/tmp/device-closeout-Q.log`）按序取：等 V2 收口 → 等锁空 → `pnpm -r test` → `pod install` 有界重试（4 趟，逐趟落 `RC_POD_i`）
    → `reinstall-all --only ios`（`IOS_DEVICE_NAME=heyta-batch2-closeout`，现量 6 台 booted，脚本对多台是"不猜"）
    → `verify-mobile-card-export-ios.sh`（`IOS_UDID=919C5F50-…` 直接给，不让探针再猜名字）。
  - 📊 **Goal ⑤-1 现在的完整形状**（这份就是"读数"，不是"差不多跑完了"）：
    68 段里 **前 23 段全过**；第 24 段 `check:legal-permissions` 红（7 条，`git blame` 归 `b0ba4a35` = W9 那半，不代改）；
    其后 44 段 = **38 绿**（㊒）+ 本轮再取回 2 绿（`journey-coverage` / `shell-unicode`）+
    **5 段各有明确的未取原因且都排好了重试**：`-r test`（闸门拒跑 → 链 Q 等锁空重跑）、
    `check:ai-e2e` / `privacy-consent-e2e` / `landing-e2e`（另一会话的整链 `check` 正在跑、会同抢 4318/4319 → 链 V2 带 3 小时等待上限）。

- ㊖ **链 V2 的 e2e 三段陆续回来：一格真绿、一格又是闸门拒跑；同时认出我自己"改了一处没改全集"**（04 15:4x）
  - ✅ `RC_privacy-consent-e2e=0` —— 真浏览器那条「链 5 · 同意之前一个请求都不发」（`tests/privacy-consent-zero-egress.spec.ts:235`）过；
  - 🔴 `RC_ai-e2e=1`，而明细里**只有一条** `内存闸门拒绝启动` ⇒ 与 ㊕ 的 `-r test` 是**同一个环境红**，不是产品红；
  - ⏳ `RC_landing-e2e` 在跑（`[61] landing-e2e 起跑（e2e 域空 负载=24.12）`）。
  - 🔴 **这条要留着的是我自己的一个错法**：㊕ 查出"闸门是拒绝启动不是排队"之后，我只给链 Q 的 `-r test` 加了"先等锁空"，
    **没有回头给同一条链 V2 的三段 e2e 也加** —— 它们走的是同一个 `~/.tfa-shield/bin/pnpm` 包装。
    也就是说我修了根因的**一个实例**就以为修了这类问题。⇒ 补链 V3（`/tmp/device-closeout-V3.log`）：
    等 Q 收口 → **锁空 且 负载 < 12 两个条件同时成立**才跑 `check:ai-e2e`，并把"闸门拒跑行数"打进读数里（0 才算真红）。
    ⚠️ 顺带一条边界：V2 的 e2e 等待循环只挡"别的 playwright/vite"，**不挡负载**，所以 `[60]`/`[61]` 是在负载 24–25 上跑的
    ⇒ 那两格若出红，第一归因是负载（按任务书第 8 条记环境，不算产品账），绿则比安静窗口的绿更强。
  - ⏭ 链序现在是 **V2 → Q（`-r test` → pod 有界重试 → iOS 重装 → iOS 出图探针）→ V3（`ai-e2e`）**，三条都带看门狗与终点哨。

- ㊗ **`pnpm -r test` 的读数到手（10778 passed / 518 个文件 / 20 包汇总行，rc=0）＋ 链 V2 六格终读 ＋ mac 那两张图进了版本库**（04 15:5x）
  - **链 V2 终读**：`RC_journey-coverage=0 RC_shell-unicode=0 RC_r-test=1 RC_ai-e2e=1 RC_privacy-consent-e2e=0 RC_landing-e2e=0`
    —— 六格里 **四格真绿**（`landing-e2e` 打出 17 条用例逐条过，含「五个分类每个都有 ≥2 篇有正文的文章：十四篇 × 中英两版逐个在浏览器里数」；
      `privacy-consent-e2e` 是那条「链 5 · 同意之前一个请求都不发」真浏览器判据），
      两格（`-r test` / `ai-e2e`）是 ㊕/㊖ 说的**同一个闸门拒跑**，不是产品红。
  - ✅ **链 Q 的 `[1b] RC_RTEST=0 闸门拒跑行=0`** —— 加了"先等 `/tmp/tfa-test.lock` 空"之后，全量单元测试**跑完了**：
    **10778 个用例 passed / 518 个 Test Files / 20 条逐包汇总行**，载体 `5e1bc1a8`。
    ⚠️ 两个数都是**洗过 ANSI 才数得出的**：第一趟我直接 `grep -oE 'Tests +N passed'` 报 **0 条**
    （vitest 的汇总行里数字与标签之间夹着转义序列）—— 与 §7 那条"数失败用例必须先 `NO_COLOR=1`"同族，
    这次是同一坑的读取侧版本。清洗命令：`sed -e 's/\x1b\[[0-9;]*m//g'`。
  - ⚠️ 同趟日志里有 **25 行含 "failed"**，但它们**不是失败的用例**：是 `server` 那套里**故意注入**的失败路径
    （`Cleanup [old-ops]: drain failed for user 1 …`、`Snapshot pre-gate reconcile failed: db down`），
    用例本身是绿的 ⇒ 判绿只认退出码与 summary 行（§7 那条纪律的又一次现形）。
  - 📌 顺带一条对账：`AGENTS.md §6` 写着"当前 2592 个通过"，现量是 **10778** —— 差 4 倍多。
    **仍然没有代改**（任务 #26）：主检出的 `AGENTS.md` 此刻照旧是 ` M`（15:4x 现量 `git status --porcelain -- AGENTS.md` = ` M`）。
  - ✅ **Goal ⑤-3 的证据常驻化**（`686142af`）：mac 打包那两张图已复制进
    `apps/desktop-macos/evidence/package-20261004-1511-mac-app.{png,webview.png,txt}`（md5 `ae28c2f6…` / `d674c887…`），
    `.txt` 里逐条写明"这对图证明到哪一步为止"。同趟用 `research/tools/audit-evidence-screenshots-tracked.mjs`
    重扫三份计划文档：**MISSING = 7 项 / 20 处**。🔴 我上一句凭印象写的是"降到 4 项"——**没量过就写进正文了，这句按实测改掉**：
    数目不降反升，因为 ㊒/㊗ 自己新写的正文又添了几处引用。逐项分完类，**没有一项是"证据丢了"**：
    · **3 项是审计脚本自己的解析噪声**：`星期日.png`（文件名里有空格被切，前文 `073853-10月11日 `）、
      `-sidebar.png`（文档写的是省略号 `…-sidebar.png`）、`webview.png`（花括号展开 `{png,webview.png}`）。
      ⇒ 给脚本加了一行**"前文"输出**专门对付这类，而**没有**写自动改判的启发式 ——
      "匹配前面是个空格"这个形状与"句子里正常提到某张图"逐字相同，拿它改判会把**真欠账**一起藏掉，
      那比多三行噪声贵得多；只把上下文打出来，让人一眼分完；
    · **2 项是 `ios-latest-card.png`**：文档里的引用全是**条件句**（"在它被打开看过之前 W7-G3 不打勾"），不是主张它存在 ⇒ 等链 Q；
    · **2 项是 /tmp 里那次的文件名**：`packaged-first-run.png.webview.png`（本趟，已另名常驻，见上）与
      `heyta-reinstall-mac-installed.png.webview.png`（10-03 那一趟，**图已不在、仓里没有它的常驻版** ——
      仓里最像的那枚 `reinstall-20261002-1852-mac-installed.webview.png` 自述是 1082x716，而那一格报的是 1092x723，
      **不是同一次运行**。这条"名字像但不是"的排查过程写在上面第 359 行那条里，别再看错一遍）。
  - ⏳ **Goal ⑤-1 现在只剩一格**：`check:ai-e2e`（链 V3 排队，判据＝锁空 且 负载 < 12 且 把"闸门拒跑行数"打进读数）。
    链 Q 走到 `[2]` 时现量负载 **110.23**（别的会话起了重活）⇒ 它在等窗口，不是卡住；pod 重试与 iOS 那三格排在它后面。
    ✅ **这一格已于 04 16:0x 由链 V3 取到**：`RC_AI_E2E_V3=0 闸门拒跑行=0 起跑负载=11.53`，读数 **145 passed (5.9m)**。
    ⚠️ **代价是我这一趟把别人三行的证据图覆盖了**：`check:ai-e2e` 按固定文件名写 `e2e/test-results/`，
    而**其中 37 枚是入库跟踪的**（别的线把截图当证据提交进了 `*/evidence/`），跑一次就重写一次。
    当场 `git checkout -- <那 37 个跟踪路径>` 复原；📌 **一般规律：跑 e2e 族门禁前先 `git ls-files` 数一遍
    它的输出目录里有多少枚已入库**，那些不是临时产物而是别人的证据。（这条与 §7 里"共用 test-results 会删掉唯一证据"同族，
    面目不同：那次是**删**，这次是**重写**，重写不会让 `git status` 之外的任何东西报警。）

- ㊙ **我自己那条"缺 `LC_ALL`"的诊断被四臂否证了；`null byte` 既不是 locale 也不是那棵树 —— 是逐趟非确定性**（04 16:1x）
  - 🔴 **先记我错在哪**：15:5x 我从"裸 `pod install` 崩 `Unicode Normalization`"那一次直接推出"`LC_ALL` 是缺的那一项"，
    还把它写进了 `reinstall-all.sh` 的注释并准备提交。**四臂一跑它就倒了**（同一棵长活树、同一分钟，
    `/tmp/pod-arms-{A-no-lcall,B-with-lcall,C-no-locale,D-restore}.txt`）：

    | 臂 | env | `default_external` | 结果 |
    |---|---|---|---|
    | A | `LANG` 有、**显式 `-u LC_ALL`**、两个 `RCT_*` | UTF-8 | ✅ RC=0（10 s）`Pod installation complete!` 84 deps / 83 pods |
    | B | `LANG`+`LC_ALL`+`RCT_*` | UTF-8 | ✅ RC=0（9 s）同上 |
    | C | 两个 locale **都不给** | US-ASCII | ❌ RC=1（1 s）`config.rb:167 installation_root` `Unicode Normalization not appropriate for ASCII-8BIT` |
    | D | 与 B **逐字相同** | UTF-8 | ❌ RC=1（4 s）**`ArgumentError - path name contains null byte`** |

    ⇒ 承重的是"**至少一个 locale 变量**"（C），`LC_ALL` 本身不承重（A）；
    而 `null byte`（D）在 A/B 成功后 5 秒、同一 env 形状下出现 ⇒ **与 locale 无关、与树无关，是逐趟非确定性**
    （上游 CocoaPods #12798 / #12866 都 open，后者标题写着 "sometimes"）。
  - 🔴 **这同时否证了 traps #154 的结论**"变量是这棵长活的树本身"。它当时的 A/B（新克隆两次都 exit 0）依然成立，
    只是**解释力更弱**：换树不构成"这次不会崩"的证明。已**原地划线更正**写进 #154（保留原句），
    并在 #30 那条"可用的 `pod install` 命令"下面补了"这串现在由门禁钉住"。
  - ✅ **落地的两件事**（都不靠"我记得正确值"）：
    1. `check:native-deps` 加了**第三条规则**：`POD_ENV` 常量是本文件打印的"修法"与
       `scripts/reinstall-all.sh` 里那条真实调用的**唯一事实源**（shell 那条注释"改一处要改两处"以前只是注释）。
       比对前先把续行折回一行、把引号里的字符串挖空 —— 否则 `echo "…pod install 失败…"` 那四行**文案**会被当成四条调用，
       第一版就是这么错的（4 条假阳性，而假阳性教人忽略红色）。
       **三臂都是拿真门禁原地跑的**（改真文件 → 跑 → `cp` 回来 → `md5` 逐字节相同）：
       未变异 ⇒ 绿（5 个 pod 全命中，rc=0）；把 shell 那条调用里的 `LANG=` 写成 `LAng=`（= 那个 token 不在）
       ⇒ **rc=1** 且精确报"带缺的 env：`LANG=en_US.UTF-8`"；把 `pod install` 整个词换掉
       ⇒ **rc=1** 且报"**里没有一条 `pod install` 调用（这条对账失去对象）**"，
       所以调用被人删掉的那天这条门禁不会安静地不执行（§7 里 #191 那个形状）。
       两趟变异后都 `RC_AFTER_RESTORE=0`、`md5=SAME`。
    2. `reinstall-all.sh` 的 pod 步改成**有界重试**（≤3 趟，逐趟 `/tmp/heyta-reinstall-pod-<n>.log`，
       每趟把首条错误打进输出）。判据**没有放松**：仍然要求 `Manifest.lock == Podfile.lock`，三趟全崩照旧判红。
       这是对着"崩不崩是逐趟的事"设计的，不是对着 env 设计的。
  - 📌 **顺带量到但没动的东西**：这一趟 `pod install` 把 `Podfile.lock` 改动了 **2 行 diff（=1 行）**，
    只有 `hermes-engine` 的校验和（HEAD `208b0dcd…` → 现量 `d25a17a7…`），`project.pbxproj` 改 5 行。
    **没有提交**：它不是本批的产品改动，而且"提交态是否可复现"归 `check:native-deps` / #150 那条主张管 ——
    我打算 iOS 腿跑完后**还原成 HEAD 再原地复跑一次 pod**，看它回到哪一枚哈希，再决定这是"提交态不可复现"
    （要更正 #150）还是"我这棵树的 `node_modules` 与提交态不同"（那是本机状态）。⚠️ 现在两种都不能主张。
  - 🔴 **第一趟 iOS 腿 26 秒就判红，根因是"半写沙盒满足了哈希一致判据"**（16:18，`/tmp/ios-leg-1st-fail.log`
    + `/tmp/heyta-reinstall-ios-build.log` 16901 行）：`Manifest.lock == Podfile.lock`（都是 `461f4ffa…`）
    让脚本**跳过**了 pod install，但上面那趟崩掉的 D 臂把 `Pods/Headers/Public/RCTSwiftUI/` 整层留空 ⇒
    xcodebuild 报 `fatal error: module map file '…/RCTSwiftUI.modulemap' not found`，4 个 target 全挂。
    ⚠️ 这次失败是**响亮**的（不是假绿），但它把"缺构建输入"伪装成"产品构建不过"——
    正是 `reinstall-all.sh:396` 那行注释自己描述过的形状，只不过换了个入口。
    ⇒ 改成**哈希相等也照跑**（幂等 ~10 s），"沙盒完整"交给生成器而不是交给一个哈希；
    修好后 `RCTSwiftUI.modulemap` / `-umbrella.h` 两枚软链回来了（`RC_REPAIR=0`），第二趟腿 16:22 起跑。
    ⚠️ 这条"半途崩掉的生成器会留下满足哈希判据的**不完整**产物"值得单立一条 traps，
    但**没有当场插号**：16:2x 现量主检出 `docs/reference/environment-traps.md` 最大号 **247** 且该文件正 ` M`
    （别人在写）⇒ 取号是并行会话的公共面，这里登记为**待入 traps**，内容就是上面三句
    （判据是什么 / 它为什么被半写沙盒满足 / 改成了什么）。
  - 📌 **本批的门禁当天也照出了我自己的新代码**：写重试段时又落下 `（日志 $POD_LOG）` 这一处
    `$var` 紧跟全角括号，`check:shell-unicode` 报 **rc=1** 精确指到 439 行 ⇒ 改 `${POD_LOG}` 后 rc=0（扫 81 个 .sh）。
    这与 ㊒ 那批 35 处是同一个坑的第 36 处，**门禁比我先想起来**。
  - ⏳ **iOS 腿**：第一趟 pid 63682（16:18）**判红**，根因见上一条；第二趟 pid 85248（16:22）起跑，
    `IOS_DEVICE_NAME=heyta-batch2-closeout` 钉我自己的模拟器
    （防 #169 那条"盲选卸载目标"），随后 `IOS_UDID=919C5F50-…` 跑 `verify-mobile-card-export-ios.sh` 取 W7-G3。
    起跑归属现量：另有一条 `queue-reinstall-all.sh`（pid 93817）**跑了 13 小时**、0.0% CPU，
    卡在 **mac 段** `package-app.sh /tmp/heyta-macos-dist` —— 与本腿不同相位，且它是别人那条线明确登记过"不杀"的孤儿链，
    所以我按相位并行跑，不代它收尾、也不等它。

- ㊚ **iOS 那一格的"装包"半取到了（16:27 `RC_REINSTALL=0`），探针那一半第一趟被负载门挡回（16:42 `rc=3`）**（04 16:4x）
  - ✅ `IOS_DEVICE_NAME=heyta-batch2-closeout bash scripts/reinstall-all.sh --only ios` 逐行读数
    （`/tmp/ios-leg-reinstall.txt`）：**「Pods 哈希本已一致，仍重跑 pod install」**⇒ ㊙ 那条改动真的在跑，
    不是写在注释里的意图；`✅ 沙盒已同步` → `** BUILD SUCCEEDED **`（`/tmp/heyta-reinstall-ios-build.log`）
    → `✅ 已安装进模拟器（全新安装）` → **`✅ 已装的包比源码新 —— 这一轮装的是当前产物`**（那条新鲜度判据是
    `verify-mobile-ios.sh` 那次事故的产物，这里正好把它用在交付格上）→
    **窗口 1206x2622、`heyta-reinstall-ios.png` 内容占比 61.5%、主蓝命中 4136 —— 是共享 UI**。
    ⚠️ 这张图**还没有人打开看过**，所以它只够填"装上了当前产物且起得来"这一格，**不够**填 Goal ⑤-3 那类界面结论。
  - 🔴 **探针第一趟 `RC_PROBE=3`**：`等满 900s 负载仍是 13`（`/tmp/ios-leg-probe.txt` 里从 32 一路降到 13，
    全程没进过阈值 12）。按硬边界第 8 条这**不记成产品失败**，也**不算 W7-G3 关闭**。
    ✅ 处置是**不动阈值、只把等待上限提到闸门自带的旋钮上**：`HEYTA_LOAD_GATE_WAIT=3600`
    （阈值仍是 `核数×3/4 = 12`，`scripts/lib/wait-for-quiet-host.sh:37`），第二趟 16:43 起跑（pid 69374）。
  - 📌 这一趟顺带证到的三件（都各有一句取证行）：探针的**驱动通道前置四条全过**
    （`idb` 找得到、companion 起得来、AX shim 在位、模拟器 Booted —— 它是走到第 150 行的负载门才退的，
    那四条都在 146–149 行）；`--only ios` 的汇总段**如实列出没装的三端**（"这端**没有**验证当前产物"）；
    以及 ㊙ 说的"D 臂崩过一次"的沙盒**不需要人工识别**——新的"每次都跑"把它自己修回来了。

- ㊛ **L 系列那条"要等 W7 的 manifest 才知 `不申请照片` 会不会变假"的前置闸门，今天量完了：不变假**（04 16:4x）
  - 采样口径写全，因为"0 命中"这种结论只有带分母才算证据：
    **3 份清单**（`apps/mobile/ios/Heyta/Info.plist`、`HeytaWidgetExtension/Info.plist`、
    `apps/mobile/android/app/src/main/AndroidManifest.xml`）× **4 个 needle**
    （`PhotoLibrary` / `PHAsset` / `READ_MEDIA_IMAGES` / `ACCESS_MEDIA_LOCATION`）= **12 次计数全 0**；
    同一趟的**阳性对照**：`CFBundleDisplayName` 与 `UIRequiredDeviceCapabilities` 在 iOS 清单里各命中 **1**
    ⇒ 证明 grep 读的是对的文件形状，不是"扫了个空文件"。
  - **读的是被调方本体，不是关键字**：`HeytaCardExportModule.swift:77` 是 `data.write(to: file, options: .atomic)`
    （ app 容器内），`:22` 的注释明写"这条路刻意**不**走相册（`PHPhotoLibrary`）—— 那要加权限"；
    Android 侧 `CardExportModule.kt:73-81` 是 `cacheDir` + `FileProvider.getUriForFile` + `Share`，
    `:25` 同样写明"写相册要么申请 `ACCESS_MEDIA_LOCATION` / 走 `MediaStore` 插入"。
    全仓 JS/native 里 `CameraRoll|saveToCameraRoll|PHPhotoLibrary|MediaStore.Images` **只命中 2 行，两行都是注释**。
  - 🔴 **同一道门上真正变红的是别的承诺，而且不归本批**：`check:legal-permissions` 现在 **rc=1 / 7 条红**，
    逐条读过去全部指向**通知与闹钟**（`POST_NOTIFICATIONS` 命中 7 次、`SCHEDULE_EXACT_ALARM` 2 次、
    `照片/photos` **0 次**），红句写的是"Android 行的依据仍写着「移动端代码目前不产生任何系统通知」"这类 ——
    那是 **W9 原生投递那一半**欠的条款更新（另有一条会话持有），**不是** W7 的。
    按硬边界"不吸收别人的债凑绿"，这里只登记归属，不动 `packages/legal`。
  - ⇒ **Goal ② 那句"零法务变更现量复核"到此有读数了**：W7 两端都是**零新权限**，
    `permissions.ts:37 / :164`（中英）那句"不申请…照片…"**逐字仍为真**，而且这次不是我读代码下的结论，
    是上面那 12+2 个计数与两段本体。

- ㊜ **iOS 设备出图那一红抓到真根因了：不是 15 秒不够，是 effect 跑在原生挂载之前**（04 16:4x–16:5x）
  - 探针第二趟拿到窗口跑了：**通过 11 项 / 失败 1 项**（`/tmp/ios-probe-2-run.txt`，`RC_PROBE=1`）。
    红的那条是判据②：`tmp/card-export/` 里没有出现属于「w7ios-164319」的 png。
    🔍 **现场取证三件**：① 容器 `tmp/` 是**空的**（连 `card-export/` 目录都没建，`find` 全容器今天零 png）；
    ② 设备日志里有一条 `E Heyta[…] [com.facebook.react.log:native] Invalid svg returned from registry,
    expecting RNSVGSvgView, got: (null)`（16:44:31，就在点击那一刻）；
    ③ 我打开看了那张界面截图（原在 `/tmp/ios-after-fail.png`，**17:3x 已常驻为
    `apps/mobile/evidence/card-export/ios-rasterize-timeout-message.png`**，两枚 `shasum` 逐字相同
    `53d6024a…`；同目录 README 里写明它证明到哪一步为止）——卡片菜单开着、「导出成品图」在屏上、
    顶部一条红框错误：**「系统没能把卡片画成图。倒数日没有丢，也没有发出任何请求。（rasterize-timeout）」**
    ⇒ 兜底那条**按设计工作了**（把"永远不回来"折成一句人话），所以这不是探针坏，也不是假红。
  - 🔴 **这同时把 W7-G6 的框架改写了**：那一格写的是"15 s 这个上限没有实测依据，负载高的模拟器上可能不够 ⇒
    只会造成假红"。今天量到的不是"不够"——**是回调永远不会来**，超时只是把它变成可见的错误。
    根因在 `RNSVGSvgViewModule.mm:31` 那条 `viewForReactTag:` 拿到 nil、而那条分支 `RCTLogError + return` 不回调；
    JS 侧 `Svg.tsx:84-92` 走的是 `findNodeHandle(this.root)`，**effect 跑在 commit 之后、原生挂载事务刷到主队列之前**，
    那一刻 tag 查不到。（Android 同一串代码出得来图 ⇒ 两端在这一点上不对称。）
  - ✅ **修复 = 让出一帧再问原生要图**，不是再拍一个更长的毫秒数：
    `card-export-units.ts` 新增 `afterNextFrame(nextFrame)`（调度器**注入**，因为这个文件要在 node 里判定），
    `card-export.tsx` 的 effect 改成 `afterNextFrame((run) => requestAnimationFrame(run)).then(...)`，
    并在帧里**重新读一次 ref** —— 视图可能在这一帧里被卸载，那一支 resolve 成
    `rasterize-empty / svg-unmounted-in-frame`，不许静默。
    判据三条（`apps/mobile/tests/card-export.spec.ts` 末尾）：注入的调度器没跑 ⇒ 不结算；
    源码里 `.toDataURL(` 的调用点必须排在 `afterNextFrame(` **之后**（用本文件既有的 `codeOf` 剥注释后比下标，
    "我记得加了"不算）；`svg-unmounted-in-frame` 那一支必须在源码里存在。
  - ⏳ **读数排在链 S**（`/tmp/chain-S.log`，pid 24852）：等内存闸门空 + 负载 ≤ 10 → 跑判据 →
    `--only ios` 重装 → 探针。⚠️ 这一趟的负载门**没动阈值**（仍是核数 ×3/4 = 12），
    只是把等待上限换成闸门自带的 `HEYTA_LOAD_GATE_WAIT`；第一趟 `rc=3` 是等满 900 s，按硬边界第 8 条
    记环境无效。**如果让帧之后还是 `(null)`**，那就不是时机而是上游 Fabric 查表的缺口，
    届时登记成 **W7-G9**（带这条日志原文），不把"iOS 设备出图"这格打勾。
- ㊝ **让帧之后 iOS 出图了：W7-G3 关闭（04 17:13:17，`RC_PROBE=0`，通过 17 项 / 失败 0 项）**
  - 链 S 三格全绿（`/tmp/chain-S.log`，读数只从日志的 `RC_*` 行取，§7 #164）：
    `RC_SPEC=0`（17:00:20，`apps/mobile` 那份 `card-export.spec.ts` **29 passed**，含新加的三条让帧判据）→
    `RC_REINSTALL=0`（17:04:57，`--only ios`，新鲜度门 `bundle 1791104679 > 源码 1791104211`）→
    `RC_PROBE=0`（17:13:17）。⚠️ 探针**先被负载门挡了 420 s**（167→12，阈值仍是核数 ×3/4 = 12 没动，
    只把等待上限换成 `HEYTA_LOAD_GATE_WAIT=1800`）—— 这一段是环境账，不是产品账。
  - 🔴 **上一趟那枚 `(null)` 没有再出现**：设备日志里零条 `Invalid svg returned from registry`，
    沙盒里写下的是 `heyta-w7ios-170457-10月11日 星期日.png`。所以 ㊜ 那条根因判定
    （effect 跑在原生挂载之前）**是被这一趟证实的，不是被"再试一次碰巧绿"蒙过去的** ——
    两次运行之间唯一变化的就是那一次 `afterNextFrame`（同一台设备、同一个签名态、同一份探针）。
  - 三条硬判据的读数：① 读数器**会区分**（正向 web 那张 1080×1440 / 反向 3×2 读出 `BLANK=true`）；
    ② 点导出**前**沙盒没那个文件名、点之后出现且 mtime 落在起跑时刻之后；
    ③ IHDR `W=1080 H=1440 BYTES=64619 TRANSPARENT=false BLANK=false SMEARED=false SHA=13e10d6cde3b`
    = 契约尺寸，与 web / Android 同口径。第 7 格：整趟 AX 树里**零条系统权限页文案**（与 ㊛ 那条
    "不申请照片"的现量同向）。
  - ✅ **人打开看过**（§6.2 规定一）：`apps/mobile/evidence/card-export/ios-latest-card.png`
    （md5 `d3b0f62f…`，64619 B）。看见的是：浅底上一张白卡、左侧一条竖向主色条、顶部标题
    `w7ios-170457`、中部大字「还有 7 天」、底部「10月11日 星期日」；**中文没有豆腐块**。
    并且**与 Android 那张并排比过**（`latest-card.png`，标题 `w7e2e-131811`）：色条/标题位/大数字位/
    底部日期四处逐位同构，差别只有平台字体（iOS 走 SF、Android 走 Roboto 的数字与拉丁字形）
    ⇒ 共享版面在两端画出的是同一套结构，**没有"iOS 少画一行"那种 W5 式缺口**。
  - ⚠️ **这一趟把 Android 那格的读数变成了欠账**（W7-G6b 自己写明的代价）：`card-export-units.ts`
    改了 ⇒ 04 09:18 那趟 `RC_ANDROID=0` 验的是**改动前**的 bundle。**iOS 绿不构成 Android 的证据**
    （两端本来就在这条路上不对称，㊜ 已量到）。排在探针之后重取。
- ㊞ **`Podfile.lock` 里 hermes 那枚 checksum 与提交态不互复现 —— 机制量到了，登记待入 traps**（04 17:1x）
  - 现量：`git diff` 只有一行 `hermes-engine: 208b0dcd… → d25a17a7…`，而**版本没变**
    （两边都是 `- hermes-engine (250829098.0.9)`）。
  - 🔴 **机制（一条命令就能自己复验）**：`shasum "apps/mobile/ios/Pods/Local Podspecs/hermes-engine.podspec.json"`
    = `d25a17a7bfcc1d16cd383e90d3438144511b5a8b`，**逐字等于**新生成的那枚 ⇒
    本地路径 pod 的 `SPEC CHECKSUMS` 就是**渲染后那份 podspec JSON 的 SHA1**，不是源文件的哈希
    （源文件 `shasum` 是 `4a4c61b1…`，两个都不是）。
  - 而渲染结果里写进了 `source.http` 那枚 **Maven tarball URL**（本机这次是 `…-hermes-ios-debug.tar.gz`），
    `hermes-utils.rb:44 hermes_source_type()` 的分支由**四个 env 变量**决定
    （override dir / `HERMES_ENGINE_TARBALL_PATH` / commit / force-build-from-tag），
    podspec 第 100–101 行自己还写着 `PRODUCTION` 标记会影响下载哪一版
    ⇒ **同一版本可以渲染出两份不同的 spec，checksum 随之不同**。
  - ⚠️ **只到"不互复现"为止，没有取第二臂**：我没有在另一档 env 下重跑 `pod install` 去复现
    `208b0dcd`（那要再花一趟几分钟，而且会在探针之后动沙盒）。所以这条**不写成**
    "HEAD 那枚是 `PRODUCTION=1` 跑出来的"，只写成：**提交态的 lock 不是钉住的那条命令的产物**，
    而钉住的命令每次都会把它改回来 ⇒ 干净检出的工作树在 iOS 段永远不干净。
  - 处置：把新生成的 `Podfile.lock` 与 `project.pbxproj`（后者是 `pod install` 把 W7 那 4 枚
    CardExport 引用排进它自己的排序位（含一枚 JavaScriptCore 引用的位置），内容零变化）一起提交，
    并把上面那条 `shasum` 复验命令留在本条里。**待入 traps**（编号按主检出工作树取，不在本分支插号）。
- ㊟ **-3 的复跑照出探针自己的一个分母洞：不传文件时它扫 0 份、六类全打 0 并退 0**（04 17:3x）
  - 我先按"无参数"跑了 `research/tools/audit-evidence-screenshots-tracked.mjs` ⇒
    `RC=0` 且 **六个类别全部 `0 个不同路径 / 0 处引用`**，包括 `TRACKED`。
    🔴 **"没有欠账"和"什么都没扫"在这份输出上逐字同形** —— 这正是 §7 元规则第 2 条那种
    "永远通过的判据"，而它是我自己上一批写的（当时它带的是"传三个文档、报 7 项 / 20 处"的读数，
    所以这个洞从来没被走到过：`const files = process.argv.slice(2)` 空数组 ⇒ 循环零次 ⇒ 全 0）。
  - ✅ 修了两处：① `files.length === 0` 直接 `exit 1` 并打用法；② 汇总前先打
    **`扫描 N 份文档 / 命中 M 处图片引用`**（分母进输出，不进口头汇报）。
    两臂各量：无参数 ⇒ `RC_NOARGS=1` 且打的是那句拒绝；带三份文档 ⇒ `RC=0`、
    `扫描 3 份文档 / 命中 86 处图片引用`。⚠️ **那个 86 是双趟计数**（`:36` 按路径形状、`:37` 按裸文件名），
    同一处提及会进两趟 ⇒ 引用数不能当"多少个界面主张"读。
  - ✅ **顺手把 ⑤-3 唯一一枚真欠账常驻了**：㊜ 里"我打开看了那张界面截图"那句的图只在 `/tmp`
    ⇒ 原样复制成 `apps/mobile/evidence/card-export/ios-rasterize-timeout-message.png`
    （两枚 `shasum` 逐字相同 `53d6024a…`，1206×2622），同目录 README 新增一节写明
    **它证明的是"那句人话渲染出来了 + 菜单开着"，不证明出图成功、也不当内容判据用**（它是窗口截图，§7 #170/#208 那一族）。
  - 🔴 **MISSING 数没降（7 项 / 23 处，与 16:2x 同）**，逐条分完类没有一项是"证据丢了"：
    · **16 处是脚本的切分噪声**（文件名里有空格 ⇒ `…10月11日 星期日.png` 被切、花括号 `{png,webview.png}`、
      省略号 `…-sidebar.png`）；
    · **4 处是"名字换了"而不是"图没了"**：`ios-after-fail.png`（本条已常驻成新名）与
      `packaged-first-run.png.webview.png`（㊚ 那批常驻为 `package-20261004-1511-mac-app.webview.png`）
      —— by-name 那一趟只认文件名，正文里保留旧名是有历史意义的（"当时看到的是这张"），
      ⇒ **不为降数改散文**；
    · **2 处是 10-03 那一趟的 `/tmp` 名字**（图确实不在盘上，㊚ 已写明"仓里最像的那枚不是同一次运行"）；
    · **1 处 `heyta-reinstall-ios.png`** 是窗口截图，从未打算常驻（内容判据在探针那三条机器读数里）。
- ㊠ **① 那句"i18n 中英"从"门禁绿"换成了一条直接读数，而第一版探针是我自己写坏的**（04 17:4x）
  - 之前这条只由 `check:ui-language` 间接保证（它在 68 段那一趟里 rc=0）。现在直接量 W4b 那一片：
    `packages/i18n/src/locales/{zh-CN,en}.ts` 里键名含 `holiday` 或 `dayMarker` 的 **22 条**，
    **两侧都在 = 22 / 缺英译 = 0**；值层三条：**逐字相同对 = 0**（挡"英文那侧照抄中文"）、
    **英文值含 CJK = 0**、**中文值零 CJK = 0**；整表键数 **3023 / 3023，双向差集 0**。
  - 🔴 **第一版那两个数（"英文值含 CJK=3"与"中文值含 CJK=2"）是探针坏了，不是词条坏了**：
    我把 CJK 类写成 `[㐀-]`（一个只含"㐀"和连字符的字符集），既漏了常用汉字又误命中。
    认出它的信号是**反方向那条不可能成立**（`{count} 天安排` 这种值不可能"不含中文"）——
    又一次印证 §7 元规则第 1 条：**先怀疑探针**。修完补了一条**阳性对照**
    （`'休'` 命中 / `'Off'` 不命中）才认这份读数。
- ㊡ **链 T 重排 + 链 FINAL 折进链 FULL：宿主负载这一小时里在 10 与 407 之间反复开合**（04 17:5x–18:0x）
  - 现量：17:20 `102` → 17:47 `21` → 17:49 `154` → 17:56 **`10.88`（开了一格）** → 18:00 探针自己的门又连续拒
    （`14 → 19 → 74 → 154 → 231 → 398 → 407`）。阈值一律没动（16 核 ×3/4 = 12）。
  - ✅ **Android 那一格里"装上了当前产物"这半已经取到读数**：`RC_REINSTALL_ANDROID=0`（17:57:21，
    载体是当前 HEAD + 让帧修复），汇总大字把没装的三端逐端列出（mac/windows/ios `不在 --only 范围`）。
    🔴 这一格与"设备出图"是**两件事**：重装绿了只证明装的是当前产物，出图那半由探针判，探针此刻在负载门里。
  - 🔴 **把我自己的排队顺序改了**：原链 T 把三条变异臂排在第 [1] 步、设备读数在第 [4] 步，
    结果是**Goal 被挡的那一腿排在边界取证后面**。重排成"设备读数 → 三条臂"
    （链在纯等待状态、工作树 0 枚未提交时才动的手，不是在变异中途）。
  - ✅ **撤掉一层依赖**：链 FINAL（11 段点名复取）是链 FULL（68 段逐段）的**真子集** ⇒ 折进 FULL，
    否则 FULL 会去等一条不再存在的哨兵直到超时。
  - ⚠️ 链 FULL 的段清单**从 `package.json` 现解析**，两个独立读者对数（`split().length` vs while-read 灌出的数组长度）。
    自测当场照出 bash 3.2 的 `while read` **丢掉没有结尾换行的最后一行**：67 vs 68，
    少的正是末段 `pnpm -r test` —— 少一段就少一格读数，所以这条断言是承重的而不是仪式。
    判据**不写死 68**（那是把上游当前状态抄进断言，段数一变两头都错）。

- ㊢ **Android 出图探针以 `exit 3` 收口（18:12:23），而它只等了 900s —— 因为那个 900 是被调方的默认值，不是我的决定**（04 18:1x）
  - 读数：`RC_REINSTALL_ANDROID=0`（17:57:21）→ 探针门连续拒
    （`74 → 164 → 201 → 211 → 252 → 284 → 90 → 72 → 82 → 164`，18:12:23 那一行原文
    `❌ 等满 900s 负载仍是 164 —— 本轮不跑（环境无效，不是产品失败）`）→ `RC_ANDROID=3`。
    宿主机同一时刻 `uptime` = `141.56 140.92 130.78`，别的会话在跑 `.venv-test/bin/python`、Xcode `clang`/`SWBBuildService`、
    `chrome-headless-shell`、`npx vitest run tests/security/oppDdlOwnership.test.ts`（18:14 现量 4 枚进程）。
  - 🔴 **这条是探针的收口，不是产品的收口**：边界第 8 条明确 `exit 3 = 环境无效`。它**不**推翻 13:20 那趟 Android 读数，
    只让那一格继续挂着"当前提交上未重取"；`RC_REINSTALL_ANDROID=0` 证到的仍是"装上了当前产物"这半。
  - ⚠️ **我自己的编排脚本在这里犯了一个具体的错**：链 T 第 [1] 步直接 `bash scripts/verify-mobile-card-export.sh`，
    **没传 `HEYTA_LOAD_GATE_WAIT`** ⇒ 这一腿实际用的是 `scripts/lib/wait-for-quiet-host.sh:31` 的**默认 900s**，
    而不是我以为的"排到队里就给它足够的时间"。阈值 12 一分没动（那是对的），但**等待上限交给别人的默认值**这件事，
    症状与"窗口真的开过却还是没等够"完全一样。⇒ 待入 traps（本分支台账止于 #190，编号按主检出取，不在此写死）：
    **编排脚本调用带旋钮的共享库时，凡"这一腿值等多久"影响结论是否成立的，旋钮必须显式出现在命令行里，
    不能靠被调方默认值 —— 默认值是被调方给"典型用途"定的，不是给这一腿定的。**
  - ✅ **换载体而不是续等**：链 T 剩下三条变异臂各自 `wait_free 1800`（阈值 ≤10）⇒ 在最坏情况会把
    `SENTINEL_T_DONE` 推到 90 min 之后，而链 MAC / 链 FULL / 链 T2 全盯这一句 ⇒ 整串被三条**边界取证**钉住。
    换到 `/tmp/chain-T3.sh`：**单次共享窗口 + 三条臂连着跑**，等满只记一次 `RC_MUT_*=3`。
    动手现场：链在 `wait_free` 的 `sleep 30` 里、工作树 `git status --porcelain` 为空、
    没有 vitest / adb 子进程（18:14:17 现量），**不是在变异中途动的手**。
  - ⚠️ **T3 的窗口档位是 ≤40，这里要把理由和边界写清楚，因为它看起来像"放宽负载门"**：
    负载门防的是**探针**不是 CPU —— `wait-for-quiet-host.sh` 的 ≤12 是为 `uiautomator dump` / 截图 / AX 点击定的
    （traps #168：负载高时探针抓不到界面，会把一次环境失效打印成一堆产品缺陷）。
    这三条臂只跑 node vitest：**不碰设备、不碰窗口、不碰端口 4318/4319**，且方向是**不对称**的 ——
    争抢能让一条臂**多红**（超时、别的用例也红），**不能让它少红**；"变异了却仍然全绿"这个失败模式与负载无关。
    所以臂的读数除了 needle 命中数还打 `Test Files / Tests` 汇总：**红集若宽于我点名的那三条 ⇒ 该臂读数无效重跑**，
    不许当成"判据有牙"。**设备那两腿（链 T 的 [1]、链 T2）仍用原 ≤12，一点没动。**
  - ✅ 下游契约没断：`/tmp/relay-T3.sh` 等 T3 收口后把同一句 `SENTINEL_T_DONE` 补进 `chain-T.log`
    （链 MAC 盯的是精确串，链 FULL / T2 盯的是 `SENTINEL_.*_DONE` 正则），接力行里写清"换过载体"，
    **不新造读数** —— `RC_ANDROID=3` 留在 18:12:23 原位。
  - 复现命令：`grep -aE 'RC_REINSTALL_ANDROID=|RC_ANDROID=' /tmp/chain-T.log`、
    `tail -3 /tmp/chain-T-android-probe.txt`、`sed -n '28,60p' scripts/lib/wait-for-quiet-host.sh`、
    `cat /tmp/chain-T3.log`、`uptime`。

- ㊣ **链 MAC 起跑前的现场核对：`reinstall-all` 的 mac 段第一刀就落在别人的证据目录上**（04 18:2x）
  - 现量：`scripts/reinstall-all.sh:192` 把 `MAC_OUT=/tmp/heyta-macos-dist` **写死**，`:196` 是开局 `rm -rf "$MAC_OUT"`（"清掉旧安装包"）。
    而 18:20 那一刻该目录里躺的是**另一条会话 03:13 那趟的产物**：`Heyta-1.0.0.dmg`（2 296 476 B）、`Heyta.app`、
    `entitlements.plist`、`packaged-first-run.png{,.txt,.webview.png}`，并且那枚 dmg **正被 pid 98171（`diskimage` helper）持有一个 FD**
    （`lsof +D /tmp/heyta-macos-dist` 现量一行 `diskimage 98171 ... 5u REG ... Heyta-1.0.0.dmg`）。
    ⇒ "清旧包"的原意是清**自己**那一份，写死成共享路径后它清掉的是**此刻放在那里的任何人的产物**。
  - ✅ **本轮的处置是非破坏性的**：`mv /tmp/heyta-macos-dist /tmp/heyta-macos-dist-0313-held`（改名而不是删除；
    持有者的 FD 仍指向同一 inode，`lsof -p 98171 | grep -c heyta-macos-dist` 复量 **1** ⇒ 没把别人的挂载搅黄），
    随后链 MAC 会自建同名目录。**没有**改脚本、**没有**动那条链的命令。
  - 🔴 结构性修法登记成**任务 #32**（`MAC_OUT` 改带默认值的旋钮 + 段首打印实际目录 + 默认值逐字不变的判据），
    本批不在此刻改 `scripts/reinstall-all.sh` —— 理由是**这条链正在队列里等窗口**，改它会在读数中途换载体。
  - 另一枚共享对象：`/Applications/Heyta.app` 上那个常驻实例 **pid 772**（`HeytaMac`，etime 20h47m，
    18:20 现量 `%cpu 0.0` / `state S`、`lsof +D /Applications/Heyta.app` **零行** ⇒ 没有任何打开的文件，
    是闲置的 leftovers 而不是"谁正在用它"）。它盘上那份包**不是当前产物**：
    包内 `web-dist/index.html` 的 sha256 前缀 `217cae2a252d8948` vs 本工作树 `517c6ba76d00fb25`。
    所以"装进 /Applications"这一格该由链 MAC 关掉；装完之后 772 会变成**跑着已被删掉的二进制**的僵尸
    （§7 第 81 条第三种：僵尸实例污染窗口清单，后来的窗口门禁会拿它当新实例比），
    处置顺序 = 先看 `RC_MAC`，绿了再对 772 发**一次** `kill`（TERM，不是 -9），并记下它当时已经无打开文件、
    其 bundle 已被替换 —— 这三条就是"可以收"的现量依据，不是"我看着像没人用"。
    🔴 **这条"收掉 772"的计划在 18:2x 撤回**，理由是**动共享对象前先读别人的取证台账**（`BLOCKED.md` 是并行会话的账本）：
    那里第 3419 行已经把"21:33 那个旧实例挡着"**判过否证**（原文带 22:52 现量 `pid 772 lstart=Sat Oct 3 21:33:00`），
    而装包链的判据用的是 `HEYTA_SELF_CAPTURE`（应用自己写截图，§8.4 ㊣上面那段），**不是**按窗口名选目标的取证 ——
    也就是说它挡不到这一腿，杀它没有 Goal 要求的收益，却是一次影响别人的动作。⇒ **不动它**，
    §7 第 81 那种"僵尸实例污染窗口清单"的风险只在后来的 `check:macos-window` 那类门禁上，**登记不代改**。
  - 🔴 **同一条台账还证了我改名那一步的必要性**：`BLOCKED.md:4375` 那行把他们自己的阻塞写成
    "它与我抢同一处固定路径 `/tmp/heyta-macos-dist` + `/Applications/Heyta.app`，同时跑会拆掉它正在产的产物" ——
    那是**他们的链还活着时**的读数。18:20 现量 `pgrep -fl 'notarytool|reinstall-all|package-app'` **零命中**
    ⇒ 那条链已经不跑了，但**它产的物证还在原地**（dmg 被 pid 98171 持有）。
    所以"不并发"这条现在只剩**半个**理由：没有对手了，可 `rm -rf` 照样会落在别人的产物上 ——
    我按后半处理（改名保住），没有因为前半消失就直接开删。

- ㊤ **三条让帧判据的变异臂全部转红（各红自己那一条、28 passed 不动），而它们第一次起跑时三条臂一起 `PATCH_FAIL` —— 是我传的路径少了前缀**（04 18:3x）
  - ✅ **臂的读数**（`/tmp/chain-T4.log`，负载 18 那一格）：
    `RC_MUT_A=1` / `RC_MUT_B=1` / `RC_MUT_C=1`，每条都是
    **`Test Files 1 failed (1)` + `Tests 1 failed | 28 passed (29)`** ——
    红集**恰好**是我点名的那一条（needle 命中 A=2 行 / B=2 行 / C=3 行），多出来的一条都没有；
    每条后面跟一行 `已复原（git status 该路径为空）`，收尾对账 `apps/mobile/src/lib/card-export-units.ts` 与 `…/card-export.tsx` **两枚都干净**。
    ⇒ **边界第 7 条（判据必须证明能失败）对"让出一帧"这三条新判据成立**：
    A 抓"注入的调度器没跑 ⇒ 不许结算"、B 抓"`toDataURL` 的调用点必须在让帧之后"、C 抓"帧间卸载那一支必须 resolve 出一个说法"。
  - ⚠️ **形状上值得留一条**：负载高**只能让臂多红**（超时、别的用例也红），**不可能让一条变异臂少红** ——
    "改了还全绿"这个失败模式与争抢无关。所以臂的读数除了 needle 命中数还打 `Test Files / Tests` 全量汇总：
    **红集宽于点名的那条 ⇒ 该臂读数无效重跑**，不许当成"判据有牙"。这次三条都是 `1 failed | 28 passed`，没有越界。
    🔴 顺带量到一件与我先前的默认假设相反的事：三条臂**各只跑了几秒钟**（`18:32:30` → `18:32:34` 全走完），
    node 判据对宿主机负载根本不敏感 ⇒ 我给它们排的窗口是**过度保守**的。
    但**这不是"下次别等"的理由**，因为同一把门在设备那两腿上仍然必须按 ≤12 走，而这次也确实被它挡了 16 分钟；
    记下来的是**读数**（秒级），不是**规矩**（规矩不动）。
  - 🔴 **第一次起跑（链 T3，18:31:01）三条臂全部 `PATCH_FAIL`**，原文是
    `FileNotFoundError ... '/Users/.../heyta-wt-batch2/src/lib/card-export-units.ts'` ——
    真因：**我传的相对路径少了 `apps/mobile/` 这一层**（写成 `arm A src/lib/...`，而工作树根下没有 `src/`）。
    ⚠️ 这个错**不是 T3 引入的**，它原样躺在链 T 的脚本里（那三条 `arm` 调用同样写 `src/lib/...`），
    而链 T 的三条臂**从未走到过 apply 那一步**（全被负载门挡在 `wait_free` 里）⇒
    **"一条从没被执行到的臂，它的路径对不对本身就没有读数"** ——
    这是"不能失败的检查没有价值"的另一个方向：**没跑过的取证代码本身也是未验证代码**。
    ✅ 这条错是**响亮失败且不动文件**的（`HITS != 1` 与异常都走 `PATCH_FAIL` 分支、收尾 `git status` 为空），
    所以它没有污染任何读数；改前/改后各跑一次，改后三条全部转红。
  - ✅ **顺带把与设备无关的读数先垫上**（18:30–18:31 @ 载体 `de93cd2a`，每条带退出码）：
    `check:native-deps` / `check:card-export` / `check:layering` / `check:legal-tools` / `check:md-tables` /
    `check:public-facts` / `check:shell-unicode` / `check:design` / `check:ui-language` **九条全 rc=0**，
    `pnpm --filter @heyta/mobile test` **`47 files / 717 passed`**，`docs-link-check` rc=0，
    `check:shell-surfaces` 裸跑 rc=0（5 绿 0 红 / 未取证 1 栏，见 ㊣）。
    ⚠️ **这些不构成 ⑤-1 的"完整读数"** —— 完整那趟是链 FULL 的 68 段逐段，`pnpm -r test` 与 `check:ai-e2e` 都在里面；
    这一批只是**把负载无关的那几段先钉住**，万一 FULL 等不到窗口，账面也不是一片空白。
    复跑：`cat /tmp/chain-T4.log`、`grep -aE 'MUT_|RC_MUT_|PATCH_FAIL' /tmp/chain-T3.log`
    （那三条失败臂的原文留着别删 —— 它就是这条教训的证据）。
  - 🔴 **同批自己犯的一条，形状要记**：我把 `check:md-tables` 与 `git commit` **串进了同一条命令**
    （`node …check-md-table-rows.mjs; echo RC_MD=$?; …; git commit --only …`）⇒ 门禁确实先跑了并打出 `RC_MD=1`，
    但**那条命令里的提交不等我读那个 1 就执行了** —— 结果带红入库（`c0709ff0`，原因是表格单元格内 code span 里的裸 `|`，
    本表表头 4 格被读成 5 格）。✅ 已向前修复 `9fc637fb`（改 `\|`，复取 `RC_MD=0`、工作树干净）。
    ⚠️ **可迁移的规矩**：**"跑门禁"和"据此提交"必须是两条命令、两个回合**，串成一条 = 把判据变成装饰品
    （这与"别把等待闸门与生产发布串进同一条后台命令"是同族，但更常见：门禁在前、提交在后、中间没有我的判断）。
    入库不变量是"**这一笔带得走的文件里不许有红**"，而不是"门禁跑过了"。

- ㊥ **`check:legal-permissions` 在合并后的载体上重量 = rc=1 / 7 条红，全部归 W9；而我把这一档量出来的时候先用 zsh 量出一个假"0 条"**（04 18:38）
  - 现量：`pnpm run check:legal-permissions` ⇒ **rc=1**，原文末行打印
    `Android 声明 3 条 [INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM]、NS…UsageDescription 1 条、句子项数 zh=9 en=9、登记表 9 项、REVIEWED_REQUESTED 0 项、通知授权 已声明（六个承诺位置命中 6/6）`，
    七条红 = 六句「移动端不申请通知权限」（`permissions.ts` 的 Android/iOS × 中英 + `third-parties.ts` 推送 SDK 否表行 × 中英）+ `SCHEDULE_EXACT_ALARM` 未登记。
    `git log --oneline -- …AndroidManifest.xml` 现量：**后两条声明由 `b0ba4a35`（W9 提醒的原生投递，ADR-0051）带来，经 `608fa5b1` 那次"main 进批次二"进入本分支**。
    ⇒ **本批不代改、不吸收凑绿**（那是 W9 那条线欠的"六个位置一起翻"）；⑤-1 那趟 68 段跑到这一段的结构就是"红在别人已提交的状态上"，
    报数的时候必须写"第 24 段红、7 条、归属 `b0ba4a35`"，不能写成"本批门禁没过"。
  - ✅ **W7 的"零法务变更"没有被推翻，但它的正确读法被这次重量钉住了**：逐 revision 比
    `git show 79e116cf^:…` 与 `git show 79e116cf:…` 各数出 **1 条 [INTERNET]**（本单只加 `<provider>` 与注释），
    而**同一条命令读 `HEAD` 是 3 条** ⇒ 这一格证的永远是"**本单那一笔**没往申请面加权限"，不是"分支现在声明了几条"。
    表已补进 `countdown-w7-device-export.md` §5 末尾。
  - 🔴 **我这次自己踩的探针坑（要入 traps，取号按工作树现量，别照本文件写死的号抄）**：
    在 **zsh** 里写 `git show $r:apps/mobile/…` —— **`$r:a` 被当成 zsh 的历史/参数修饰符（`:a` = 转绝对路径）**，
    `git` 收到的是拼出来的 `<cwd>/79e116cfpps/mobile/…`，报 `fatal: ambiguous argument`；
    而我把输出管进 `grep -c`，**空输入照样回 0** ⇒ 三个 revision 一起打印"0 条"。
    症状比"读不到"更糟：**它是一个看起来完全自洽的假读数**（0 条 = 声明面没权限？）。
    抓住它的是**被验对象自己打印的那行**（门禁明说 3 条）⇒ 规律：**任何"数出来是 0"的取证，先确认被测命令没报错，
    并让同一趟里有一个必然非 0 的对照**（这次是门禁自己的读数行）。修法就一个字符集：`"${r}:${P}"` 加花括号。
  - ✅ 顺带把两条负载无关的读数垫上（18:37 @ `de93cd2a`）：`pnpm --filter @heyta/mobile typecheck` **rc=0**（`tsc --noEmit` 全过，含 `afterNextFrame` 那条注入调度器的签名），
    `pnpm run check:legal-permissions` 的这条 rc=1/7 红也一并 dated。
  - 🔧 **18:41 又把队列重排了一次，方向和 ㊢ 那次相反**：原队列是 `MAC → FULL（68 段）→ T2（Android 出图补跑）`，
    等于**把 Goal ② 那一格排在一个要占整段长窗口的活后面**。现在是 `MAC → T2b（Android 补跑）→ FULL2（68 段）`。
    动手现场记下来，因为"改跑着的队列"必须是纯等待状态：旧 `chain-FULL.sh`（pid 79857）与旧 `chain-T2.sh`（pid 453）
    都停在"等 MAC 哨兵"的 `sleep 30` 循环里，`pgrep -fl 'reinstall-all|verify-mobile'` 零命中、工作树 `git status` 为空 ⇒ 才动的手。
    ⚠️ 重排**没有**改任何判据或阈值：新脚本是从原脚本改出来的，`diff /tmp/chain-FULL.sh /tmp/chain-FULL2.sh` 现量只有 3 处
    （`LOG` 路径、等的哨兵清单、那句标签），`diff /tmp/chain-T2.sh /tmp/chain-T2b.sh` 只有 4 处（多一行理由注释、`LOG`、
    哨兵清单、`RC_T2` 改名 `RC_T2b`）；**68 段自校验、`timeout 1500`、负载门档、`HEYTA_LOAD_GATE_WAIT=3600` 一行都没动**。

- ㊦ **mac 那一腿绿了（18:45:48 `RC_MAC=0`），而且它顺手把 ③ 那格的读数升级成了"裸路径可复现"**（04 18:4x–18:5x）
  - 装包读数（`/tmp/chain-MAC-run.txt`，起跑 18:44:44 负载 `10.60`）：
    `pnpm -r build` 先过 → 打包（.app + .dmg，`.dmg 也已签名`）→ `rm -rf /Applications/Heyta.app` → 拷进去 →
    **安装对账：`.app` 里的 `web-dist` 与本机 `apps/web/dist` 是同一次构建（9 个 chunk）** →
    安装副本自截屏：**窗口 1092×723、`…installed.png.webview.png` 内容占比 100.0%、主蓝采样命中 1266 ⇒ 判据"是共享 UI"成立**。
    汇总大字照实列出没装的三端（`windows / android / ios 不在 --only 范围`）。
    ⚠️ 边界：带的是 `HEYTA_SKIP_NOTARIZE=1`（去掉的是**没有上界的等待**，不是判据 —— 同一档实测 11h25m 不返回，见 ㉗/㊒ 那两条三臂实测）。
  - ✅ **③ 那格的读数从此不需要 env 覆盖**：18:48 裸跑 `node scripts/check-shell-surfaces.mjs` ⇒
    **`rc=0` / 判定 5 格 **5 绿 0 红；未取证 **0 栏****。原因是它默认读的那条路径
    `/tmp/heyta-macos-dist/Heyta.app/Contents/Resources/web-dist` 被这一腿重新打上了当前产物 ——
    18:48 现量三处 sha256 前缀**逐字相同**：`/tmp/heyta-macos-dist/…index.html` = `/Applications/Heyta.app/…index.html`
    = 本机 `apps/web/dist/index.html` = `517c6ba76d00fb25`。
    ⇒ ㊣ 那条"引用 0 栏必须带用了哪个覆盖"的告诫现在可以降级成：**裸路径成立，但覆盖仍然有效**（`HEYTA_MACOS_WEB_DIST`）。
  - 👁 **⑤-3 的"人看过"这一格补上了 mac 那张**（我打开的是 `/tmp/heyta-reinstall-mac-installed.png.webview.png`）：
    看到的是**暗色外观下的共享 UI**（这台机器的系统外观是暗色 —— §5 那条"暗色不是亮色的反相，必须实际切换查看"在这里是被动满足的，
    不是我们主动切的，写清楚以免被读成"暗色已验收"）：左侧 rail 收集箱/今天/最近 7 天/已完成 + 四象限四条 + 清单/标签，
    主区页标题「收集箱」+「未同步」chip +「AI 工具调用」一节，中央浮层是首启那张
    「在使用联网功能之前」（中英双份、`服务条款`/`隐私政策` 两个链接、`同意并联网` 是主蓝实心钮、`只用本机` 是次级钮），
    中文零豆腐块。**没有**看到倒数日那一屏 —— 这张图证的是"装进 /Applications 的是当前源码的界面"，
    倒数日那一屏在包里由上面那条 sha 逐字相同 + 9 chunk 集合对账来证（与 Android/windows 那两格同一条边界，不混着说）。
  - ✅ **证据已常驻入库**（不再只躺在 `/tmp`，那是 W5-G1 与任务 #27 同一种病）：
    `apps/desktop-macos/evidence/installed-20261004-1845-mac-app.png`、
    `apps/desktop-macos/evidence/installed-20261004-1845-mac-app.webview.png` 与配好的
    `apps/desktop-macos/evidence/installed-20261004-1845-mac-app.txt` 三枚 +
    `apps/desktop-macos/evidence/README.md` 加了一行。⚠️ 配好的 `.txt` 里那条**复现命令是现跑验证过的形状**：
    `png-stats.mjs` 是**模块不是 CLI**（直接 `node scripts/screenshots/png-stats.mjs <file>` 静默无输出，
    我第一版就把这条写错了），要 `node --input-type=module -e "import('./scripts/screenshots/png-stats.mjs')…"`；
    🔴 而且那 **1266 全部来自暗色板** —— 同一枚图 `countColor(p, HEYTA_BLUE)` = **0**、`countColor(p, HEYTA_BLUE_DARK)` = **1266**，
    判据用的是两档相加的 `countBrandBlue`（`png-stats.mjs:399-401`）。
    ⇒ 后来人单拿亮色那一档去复现必然得到 0 并误判"这张图是假的"，这条已经写在 `.txt` 里挡着。
  - 📌 一条与 ㊣ 同一族的现场更新：**pid 772 还在跑**（18:49 现量 `etime 21:16:21 / %cpu 0.0 / state S`），
    而它的 bundle 已经在 18:44 被 `rm -rf` + 覆盖 ⇒ 它现在执行的是**已从盘上摘掉的那份二进制**。
    按 ㊣ 那条撤回报案处理：**不动它**（并行台账 `BLOCKED.md:3419` 早把"旧实例挡路"判过否证，本批的判据也不按窗口名选目标），
    但**后来的窗口类门禁要先 `ps` 排僵尸**（§7 第 81 条第三种面目，这条不因为本批没杀它就失效）。


  - 🔴 **改名这一刀有代价，而且代价量出来了**：`check-shell-surfaces.mjs` 的 macOS "产物"栏默认读的就是
    **同一个路径** `/tmp/heyta-macos-dist/Heyta.app/Contents/Resources/web-dist`。18:22 裸跑现量
    `RC_SURFACES_BARE=0` / 判定 5 格 **5 绿 0 红**，但 **未取证 1 栏**（原文 `产物判据未跑：…不存在（这台机器上没打过 macOS 包）`）。
    ⇒ 两条结论：**① 这一栏不会把 `pnpm check` 弄红**（未取证不计为通过也不计为失败，链 FULL 那一段照旧 rc=0）；
    **② ③ 那一格先前记的"未取证 **0** 栏"是靠 `HEYTA_MACOS_WEB_DIST=<那枚包>/Contents/Resources/web-dist` 覆盖取到的**，
    裸路径上要回到 0 栏，必须由链 MAC 把当前产物重新打进 `/tmp/heyta-macos-dist` —— 这正好就是 Goal ⑤-4 的 mac 那一腿，
    所以这里不是"我弄坏了一栏"，是**那一栏的取证本来就和装包是同一步**。
    引用"5 绿 0 红 / 0 栏"时必须带**用了哪个 env 覆盖**，否则下一个人在裸路径上量到 1 栏会以为读数漂了。

- ㊧ **链 T2b：Android 那一腿在当前提交上补到读数（19:00:50 `RC_ANDROID_T2=0`）⇒ Goal ② 的两端到此都取到了**（04 19:0x）
  - 现量：`RC_REINSTALL_T2=0`（18:46:47，先重装再探针 —— 上一趟臂收尾的 `git checkout` 会把源码 mtime 推到 bundle 之前，
    不重装就直接撞 iOS 那类新鲜度门）→ 探针 `通过 11 项 / 失败 0 项` →
    **`W=1080 H=1440 BYTES=35286 TRANSPARENT=false BLANK=false SMEARED=false SHA=2821b4820f8f`**；
    卡面标题 `w7e2e-184647`、设备侧原名 `heyta-w7e2e-184647-10月11日 星期日.png`、
    判据②"点之前那个文件名不存在 / 点之后必须出现"成立、收尾 `mCurrentFocus` 仍是 `com.heyta`（全程零授权页）。
  - ✅ **图我打开了看过**（§6.2 规定一，不是可选步骤）：白卡 + 左侧竖条 + 顶部标题 + 居中「还有 7 天」+
    底部「10月11日 星期日」，3:4 竖版；与 iOS 17:13 那张**四处同构**（标题位/天数行/日期行/竖条），
    所以这一趟补的不是"另一套画法能出图"，而是**同一套共享版面在另一端的当前产物上出得来图**。
  - 🔴 **为什么这一腿非补不可**（W7-G6 自己立的规矩）：`card-export-units.ts` 在 09:18 之后被改过（`settleRasterize` +
    iOS 让帧修复），它是 **Android 那趟的 bundle 输入** ⇒ 13:20 的 `RC_ANDROID=0` 当场过期；
    而**两端不对称时一端的绿不构成另一端的证据** —— iOS 17:13 那条读数替 Android 说不了话。
  - 📌 **上一趟 `RC_ANDROID=3` 的账**（18:12:23）：等满的是**被调方默认的 900s**，因为我那条调用行没写
    `HEYTA_LOAD_GATE_WAIT`。这一趟把它**显式写成 3600**。阈值 `核数 ×3/4 = 12` 一个字没动。
    ⇒ 一般规律：**影响"结论能不能成立"的旋钮必须出现在调用行上**，藏在被调方默认值里的旋钮等于没写。
  - 🔴 **一条载体自己会吃证据的形状**：`apps/mobile/evidence/card-export/latest-card.png` 是**已跟踪**路径，
    这一趟把它覆盖成新读数（13:18 那趟是 `BYTES=34360 SHA=2ac31233b2ed`；字节差来自卡片标题进了卡面与文件名，不是行为变了）。
    而链 FULL2 收尾有一条 `git checkout -- .`（本意是复原 `check:ai-e2e` 族按固定文件名重写的已跟踪图），
    **它同样会把这枚刚拉回来的设备证据回滚** ⇒ 顺序必须是"证据先落地（提交）、链后收尾"，
    这不是规避那条守卫，而是它按名字复原时无法区分"e2e 重写的"和"设备拉回来的"。
  - ⚠️ **这一格证到哪一步为止**：它证的是"设备真能把共享版面画成契约尺寸的那张图"。
    它**不**证倒数日那一屏在 mac/windows 的包里（那一格由 ㊦/㊥ 的 sha 对账给），
    也**不**证分享面板之后的行为（探针第 6 步只验"没弹授权页"，分享面板是收掉后的读数）。

- ㊨ **任务 #32 收口：`reinstall-all` 的 mac 段不再写死输出目录（04 19:1x，两臂离线实测）**
  - 改的是 `scripts/reinstall-all.sh:197` 那一行：`MAC_OUT="${HEYTA_MACOS_DIST_DIR:-/tmp/heyta-macos-dist}"`，
    外加 `rm -rf` **之前**把"删的是哪个目录 / 里面有几项 / 前八项叫什么"打进日志。
    默认值**逐字不变**（静态现量：全文件只剩这一处 `MAC_OUT=`），所以不带 env 的行为与 18:45 那趟一致。
  - ✅ **两臂读数**（离线复刻 mac 段那 18 行，不碰 `/Applications`、不碰真实默认目录）：
    带 `HEYTA_MACOS_DIST_DIR=/tmp/heyta-knob-new-target` ⇒ 临时目录被清、日志印出
    `清空前里面有 1 项：someone-elses-evidence.txt`、真实 `/tmp/heyta-macos-dist/Heyta.app` **前后都在**（对照组）；
    变异臂 = 拿 `git show HEAD:` 那份改动前的 4 行（把写死路径换成哨兵目录）跑同一个 env ⇒
    **env 被无视、哨兵目录被删** ⇒ 这条旋钮是有牙的，不是装饰。
  - 🔴 **为什么"手动改名保住"不算修好**（这条是本单真正的产出）：㊣ 那一格记的是我起跑前想起来先 `mv`，
    可"想起来"这件事没有载体，下一次换一个人跑就会把别人的证据目录 `rm -rf` 掉。
    而原来的失败模式还是**安静** —— 日志里连"那里原来有东西"都读不出来，事后无法归因。
  - ⚠️ **配对的那条**：`check:shell-surfaces` 的 macOS"产物"栏默认读同一个写死路径，覆盖旋钮是**另一个名字**
    （`HEYTA_MACOS_WEB_DIST`）。⇒ 用私有目录跑重装时必须两个都指，否则产物栏回到"未取证 1 栏"
    （不是红，所以它不会被任何链条拦下来 —— 只是那一格又没人取过证）。这条写在
    `docs/runbooks/multi-platform-build.md` 那段旋钮说明的末尾。

- ㊩ **链 FULL2：完整 `pnpm check` 的 68 段逐段读数（04 19:07:31–19:17:07）= 65 绿 / 3 红，三条红逐条归因**
  - 现量：`SUMMARY 绿=65 红=3 段数=68`；红段清单 `24:check:legal-permissions`、`62:check:shell-unicode`、`68:pnpm -r test`；
    跑完工作树未提交 **42 枚**（e2e 族按固定文件名重写已跟踪图），链收尾 `git checkout -- .` 后 **0 枚**。
  - 🔴 **载体要分三段说，这是这一趟最容易被读错的地方**：起跑 19:01:18 时 HEAD 是 `1ad0962c`，
    跑到第 62 段前后我落了 `3e51b02e` / `a52c7ace`（只动 `docs/` 与 `apps/*/evidence/`，不是任何段的构建输入）
    与 `c282467b`（动 `scripts/reinstall-all.sh` —— **没有任何一个 check 段读它**，但它正是第 62 段那条红的来源）。
    ⇒ 65 绿对当前 HEAD 仍然成立，但"62 段当时是红的、随后被我改掉"这件事必须写在读数旁边，不能追认成"当时就绿"。
  - 🔴 **红 1（第 62 段）是我自己 12 分钟前带进来的，而且踩的正是任务 #30 刚修完的那一型**：
    `echo "  macOS 输出目录 = $MAC_OUT（覆盖旋钮 …）"` —— `$MAC_OUT` 紧跟全角括号，变量名被吞。
    修法就是门禁自己给的那一句（`${var}`）；改后 `node scripts/check-shell-unicode-vars.mjs` **rc=0**（"扫了 81 个 .sh"），提交 `c2d572ba`。
    📌 留这条的理由：我刚写完"共享目录别再写死"的守卫，**同一笔提交里就写了一句会被门禁拦的字符串**。
    抓住它的不是我记得查，而是链条里那一跑 —— 这就是 §7 那条"能失败的判据才有价值"的又一次结账。
  - 🔴 **红 2（第 24 段 `check:legal-permissions`）不是本批的**：18:40 已在合并载体上单独重量过，
    `rc=1 / 7 条红`全部归 W9 那条线的 `b0ba4a35`（英文否表行 vs `POST_NOTIFICATIONS`）⇒ 不吸收别人的债凑绿。
  - 🔴 **红 3（第 68 段 `pnpm -r test`）这一趟连"全量"都没跑到，按边界第 8 条记环境无效**：
    `packages/sync-core test: 内存闸门拒绝启动：已有测试在跑（pid=80826，锁 /tmp/tfa-test.lock；它是 npm run verify:routing）`
    ⇒ 外部那条 `verify:routing` 握着 tfa 内存闸，`pnpm -r` 停在**第 5 个包**（`Scope: 20 of 21 workspace projects`）。
    ⚠️ 顺带一条**分母漂了**：05:2x 那趟数出来是 **19** 个有 `test` 脚本的包，这一趟 pnpm 自己打的是 **20 of 21**
    ⇒ 以后引用"全量"必须带 pnpm 那一行 `Scope:`，不能再引用我数的那个数字。
  - ⚠️ **19:18 我趁锁空复跑（`/tmp/chain-RTEST.log`）：跑到 16 个包、`RC_RTEST=1`，但红的内容不是断言**：
    `apps/mobile` 打的是 `Test Files 47 passed (47) / Tests 717 passed (717)`，退出码 1 的原因是 vitest 把
    **5 条 unhandled rejection** 判成致命 —— `RolldownError: Parse failure: Flow is not supported`
    指向 `node_modules/.pnpm/react-native@0.84.1…/react-native/index.js:1`，五条**全部** `originated in "tests/auth-flow.spec.ts"`。
    - 隔离复跑两条读数：**单跑那个 spec** ⇒ `RC=0 / 14 passed`，无 unhandled；
      **单跑整个 mobile 套件** ⇒ `RC=0 / 47 files / 717 passed`，无 unhandled。
    - 05:30 之后动过 `apps/mobile/src` 的只有 `d4d154b4`（10:21）与 `c313914f`（17:20），
      两条都只碰 `card-export{,-units}.tsx?` 与它的 spec，**没有一条被 `auth-flow.spec.ts` 引到** ⇒ 机制未定。
    - ⏳ **判"并发造成"还是"仓库里有一条间歇性红"的复跑在链 RTEST2**（等 `loadavg <= 12` 再跑同一条 `pnpm -r test`，
      阈值没动、等满记 `RC_RTEST2=3` = 环境无效）。读数没回来之前 ⑤-1 这一格**不打勾**。
      ⚠️ **也不要拿 05:2x 那趟的"19/19 覆盖"替它**：那一趟的汇总记在下面第 ⑧ 条，而它跑的时候
      `apps/mobile/src` 还没有 `d4d154b4` / `c313914f` 这两笔 —— 覆盖判定要连代码面一起对，
      只数包数会把"当时那份树绿"读成"现在这份树绿"。
      （顺带一条我这次才量准、㊪ 又量准了一半的事实：`pnpm -r test` 这一趟是**停在第一个失败包**的
      —— `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`，16 个 `Done` 之后不再往下发；
      所以"跑到了第几个包"必须和"哪个包让它停的"一起报，只报前者会读成"后面那些都验过"。）

- ㊪ **`pnpm -r test` 的全量读数取到了（04 19:33:48 `RC_RTEST3=0`），而中间那两趟红全部是负载签名**
  - 四趟的账（同一条命令、同一棵树，只差宿主负载与外部占用）：

    | 趟 | 时间 | 负载 | 结果 | 停在哪 |
    |---|---|---|---|---|
    | 链 FULL2 第 68 段 | 19:17 | 高 | `rc=1`，第 5 个包 | 外部 `verify:routing` 握着 `/tmp/tfa-test.lock`，`sync-core` 拒绝启动 |
    | 链 RTEST | 19:18–19:19 | 高 | `rc=1`，16 个 `Done` | `apps/mobile`：47 files / **717 passed**，但 5 条 unhandled rejection 被 vitest 判致命 |
    | 链 RTEST2 | 19:24–19:25 | 起跑 `12` | `rc=1`，18 个 `Done` | `server` 一条 `Test timed out in 15000ms` + `apps/web` 13 条 `×`（中途宿主负载冲到 **235**，web 连汇总都没打完） |
    | 链 RTEST3 | 19:31 / 19:33 | `12` / `11` | **`RC_WEB=0` 与 `RC_RTEST3=0`** | 没停：`Done 包数=21`、`unhandled=0` |

  - ✅ **两条隔离读数把"是不是仓库里的红"判掉了**：
    ① `apps/mobile` 单跑那个 spec ⇒ `RC=0 / 14 passed`；单跑整个 mobile 套件 ⇒ `RC=0 / 47 files / 717 passed`、无 unhandled；
    ② `apps/web` 单跑（19:31，负载 12）⇒ `RC_WEB=0`、`Test Files 120 passed | 2 skipped`、`1639 passed | 13 skipped`、**`×计数=0`**。
    ⇒ RTEST2 那 13 条 `×` 与 mobile 那 5 条 rejection **都不是断言失败**，是并发 + 负载把 jsdom 用例拖过时限的形状。
    🔴 但这句只在"同一趟隔离复跑绿"的意义上成立 —— 我没有、也不声称证明了"负载永远不会让它红"。
    所以这一档的正确读法是**当前提交在安静窗口全量绿**，不是"这条判据对负载免疫"。
  - 📌 **上一条里那句"`pnpm -r test` 停在第一个失败包"只对了一半，这里量准**：
    RTEST2 里 `server` 失败时 `apps/web` 仍在打点 —— pnpm 是**并发跑多个包、只停止再发新包**。
    ⇒ 报"跑到第几个包"要同时报"哪个包让它停的"与"有没有包整条没跑"（本趟 `Done=21 / Scope 20 of 21` 才是全量的凭据）。
  - ✅ **顺带把 windows / mac 那两格的配对判据第四次复核**：链 FULL2 第 1 段 `pnpm build` 在 19:15 重打了
    `apps/web/dist`，而 `shasum -a 256 apps/web/dist/index.html` 前缀仍是 **`517c6ba76d00fb25`**，
    与 18:45 装进 `/Applications/Heyta.app` 那份里的 `Contents/Resources/web-dist/index.html` **逐字相同**
    ⇒ 10:39 装的 windows 产物与本轮构建仍同一档，那一格不必重打远端。
  - 🔴 **⑤-1 剩下的那一格此刻在链 FULL3 里**：FULL2 的 65 绿 / 3 红里有一条是我的（第 62 段，`c2d572ba` 已修），
    修完之后重跑一趟才能把"完整 `pnpm check`"写成 **67 绿 / 1 红（唯一那条归 W9 的 `b0ba4a35`）**。
    `wait_free` 的阈值与上限沿用原链（负载 >10 或锁在就等，等满 5400s ⇒ `RC_FULL3=3` = 环境无效，不是产品失败）。

- ㊫ **⑤-3 的"证据常驻"复核重取（04 20:00，`audit-evidence-screenshots-tracked.mjs` 在 `c035a79e` 上）**
  - 现量：`扫描 7 份文档 / 命中 162 处图片引用`、`TRACKED 9 路径 / 21 处`、`TRACKED-by-name 22 路径 / 84 处`、
    **`ON-DISK-untracked 0 路径 / 0 处`**、`TEMP 6 / 8`、`IGNORED-artifact 1 / 1`、`MISSING 12 / 48`，`RC=0`。
  - 🔴 **这一格里唯一承重的是 `ON-DISK-untracked = 0`** —— 它才是"人已看但证据只在临时目录"那一型（W5-G1 / 任务 #27 的病）。
    `MISSING 12` **不是 12 个缺陷**，逐条读过全是三类拆分假阳性：① 设备侧原名带空格
    （`heyta-w7e2e-…-10月11日 星期日.png` 被切成 `星期日.png`，16 处）；② 花括号形式（`x.png{,.txt}` 拆出
    `.webview.png` / `webview.png` 等）；③ **散文里作为"下一批的修法方向"出现的建议文件名**
    （`apps/web/evidence/countdown-cards/README.md:38` 那两个 `countdown-board-one.png` / `-two-cols.png` ——
    它们是提案不是引用，盘上本来就没有，也不该有）。⇒ 引用这份审计时**别把 MISSING 当债报**，
    要报就报"哪一类拆分造成的"，或者把三类例外登记进脚本（那是另一单的活）。
  - ✅ **顺带证到那条分母断言有牙**：我第一次调用**忘了传文档**，脚本打
    `🔴 没有输入文件 ⇒ 拒绝以"全 0"收尾` 并 `RC=1` —— 这正是 `08373af0` 那次修的形状
    （不传文件时它扫 0 份、六类全打 0 还退 0，是最误导人的那种"绿"）。

- ㊬ **⑤-1 收口：链 FULL3 一趟跑完 68 段 = 67 绿 / 1 红（04 20:01:55–20:12:25），唯一那条红归 W9**
  - 现量：`SUMMARY 绿=67 红=1 段数=68`、`红段清单: 24:pnpm check:legal-permissions`；
    起跑负载 `10.06`（1 分钟均值，阈值 `核数×3/4=12` 没动、`wait_free` 原样继承链 FULL2），
    载体 `4f3a6536`；跑完工作树未提交 40 枚（e2e 族重写的已跟踪图），链收尾 `git checkout -- .` 后 **0 枚**。
    ⚠️ 跑到中途我落了 `52e2feca`（只动 `docs/plans/countdown-anniversary.md`）⇒ 不是任何段的构建输入。
  - 🔴 **第 24 段那 7 条红逐条读过，一条都不属于本批**：`AndroidManifest.xml` 的 `SCHEDULE_EXACT_ALARM` 未登记 1 条 +
    `permissions.ts` Android/iOS 依据中英 4 条 + `third-parties.ts` 推送 SDK 否表行中英 2 条，
    全部由 W9 原生投递那半的 `b0ba4a35` 带来（18:40 在合并载体上单独量过同一份 7 条）。
    ⇒ 本批**不代改、不吸收凑绿**（任务书硬边界 + AGENTS §8）。这一条也是 L' 那条前置闸门**按设计该红**的样子：
    未登记的新权限必须显式判一次，而不是被顺推成绿。
  - ✅ **第 68 段 `pnpm -r test` 在这一趟里是绿的**（`apps/web 120 files / 1639 passed | 13 skipped`、
    `apps/desktop 12 passed`，整段 rc=0）⇒ ㊪ 那条"安静窗口全量绿"不再是独立复跑的单点，
    它现在**在完整 `pnpm check` 的那一趟里**成立。
  - ✅ **配对判据第五次复核**：FULL3 第 1 段 `pnpm build` 在 20:10 重打了 `apps/web/dist`，
    `index.html` 的 sha256 前缀仍是 **`517c6ba76d00fb25`**，与 18:45 装进 `/Applications/Heyta.app` 那份里的副本逐字相同
    ⇒ windows（10:39）与 mac（18:45）两格装的产物与当前构建仍同一档。
  - 📌 **收尾四项到此全部有读数**：第 1 条 = 本条（67/1，红归 W9）；第 2 条 `docs-link-check` `rc=0`（19:01 与 20:00 各一次）；
    第 3 条 = ㊫（`ON-DISK-untracked 0`，四端图都打开看过）；第 4 条 = ㊧/㊪（四端 `RC_*` 全 0）。

- ㊭ **边界 1/2 的现量读数（04 20:16）：本批这一轮没 push、没 merge，但"分支全在本地"这句在本文件里是假的**
  - 现量：`origin/feat/countdown-batch2` 的 tip 是 **`c36b1d89`**（10-03 23:50，作者 邓湘雷，
    标题「feat(admin,app-host): 后台补上「调休 / 补班」录入面」），而 `merge-base --is-ancestor` 判它**是本地 HEAD 的祖先**、
    `HEAD..远端 = 0` / `远端..HEAD = 211` ⇒ 远端那份是**这条分支的旧 tip，被并行会话在 10-03 夜里推过**，
    与本地是**可快进关系、不是分叉**。本轮（10-04 17:0x 之后）我一次 `push` 都没发过。
  - 🔴 **所以要更正的是账本里那句话**：本文与交接文档多处写过"批次二全在本地分支、未 push"。
    准确的写法是：**"本批这一轮没有 push；但 `feat/countdown-batch2` 这个分支名在 origin 上有一个 10-03 23:50 的旧 tip，
    它是本地的祖先"** —— 差别很实在：下一个人若照"未 push"判断，会以为远端没有这条线，
    而 `git push` 一旦发出就是把 211 笔（**别人的在飞状态 + 本批**混在一起）推上去，那不在本批边界内。
  - ✅ 其余边界同趟复核：`git diff --name-only origin/main...HEAD -- packages/shared-schema/src/version.ts` **0 个文件**
    （没 bump `CURRENT_SCHEMA_VERSION`）；`HEAD..origin/main = 502` / `origin/main..HEAD = 135` ⇒ **没有 merge 进 main**；
    工作树未提交 **0 枚**。
  - 📌 **同一句假话还在 `AGENTS.md` §9 的表头**（「进行中，全在本地分支，未 push 未 merge」）—— 改法就是上面那两句，
    但 `AGENTS.md` 此刻正被并行会话未提交（任务 #26 已登记），**合流时一起改、不代改**。





---

### 8.5 收口：代码质量审计 + 大规模合并（2026-10-04 20:4x – 21:1x，载体 `feat/countdown-batch2`）

产品负责人本轮指令：审计自己的代码 → 所有更改（含并行会话的）按逻辑分组提交并 push →
做一次大规模合并，冲突按**产品经理视角**裁决。圈号在这一节**用完了一次**：
`㊀…㊿` 这一段（含并行那条线用掉的 `㊾ ㊿`）到 `㊿`(U+32BF) 就是码位尽头，
所以本节改用小节号 + 阿拉伯数字，不再自造字形 —— 自造会造出"看得到但没人能复述"的编号。

1. **主检出那 166 枚未提交改动的归属与分组**（并行会话留下的，全部是稳定态才收）。
   现场：porcelain 167 行 = 27 枚未跟踪 + 140 枚已跟踪修改；
   其中 **7 枚 mtime 落在 12 分钟以内**（`AGENTS.md`、`docs/adr/0051-mobile-reminder-delivery.md`、
   `docs/plans/trash-and-archive.md`、`docs/reference/environment-traps.md`、
   `scripts/verify-mobile-ios-reminder.sh` + 两张 `ios-reminder-restart-recovery-*.png`）
   ⇒ 正被另一条会话写，**不代提交**（AGENTS §8 第 9 条：共享资源先定所有者与运行窗口）；
   另有 2 枚（`research/tools/r14c-channel-arms.sh`、`scripts/verify-mobile-due-time.sh`）
   `git diff --quiet` 判为**内容逐字相同的 stat-only 脏**（脚本自快照机制碰了 mtime），也不算改动。
   剩下 **158 枚**按逻辑簇分成 13 笔（点名路径 + `git commit --only`）：
   设备撤销共享层 / 手机侧 / web 侧 / node-host + op-log 引擎边界 / vault 旅程与证据图 /
   抹除设备脚本与三处新门禁 / iOS 提醒投递 / 门禁装置 + `package.json` 接线 /
   法务六份 + 中英词条 + 服务端生成物 / 回收站锚点 / 帮助中心与研究文档 / 一批 web 证据图 /
   卡片导出桥补 `import React` + iOS 验收的 TCP companion。
   `package.json` 是共享文件，只由"门禁接线"那一笔带走一次，提交信息里写明了它同时挂上
   了别的簇的新入口 —— 免得下一个人以为那些入口是接线那笔自己加的。
   push：`origin/main` `9070e18d → c343b923`（快进，领先 80 / 落后 0），
   `origin/feat/countdown-batch2` `c36b1d89 → c9f4e2aa`。**没有 force、没有删分支、没有改写已公开历史。**
   提交前对 102 枚非图片文件做了凭据扫描（JWT / PEM / 身份证 / 赋值形状），
   138 次命中**逐行看过真值形态**后全部判为合成夹具：
   `TOKEN="eyJ….000…0.sub-not-real"`、`PASSWORD="ErasePass123"` 配 `@test.local` 的一次性账号、
   `'Auth-test-only-928!'`、集成测试自带的 `reminder-http-isolated-integration-secret-32…`；
   `.env` 那几处全是**路径引用**而不是内容。**命中数不是违规，逐行看才是。**

2. **代码质量审计（三路只读 agent 并回，共 7 条 🔴）**：修法都按产品不变量，没有一条是靠放宽判据变绿的。
   - **W4b ①**「撤回不落地」（`packages/app-host/src/public-facts.ts:234` 一族）：覆盖表原来只 `set`，
     运营 DELETE 掉某一年之后那一年永远留在覆盖里，`adjustmentOn()` 继续替部署方说已被收回的话
     —— 而 ADR-0052 §2.2 承诺的正是"下一次拉取退回随包表"，这条承诺当时**没有任何一层在守**。
     改成整批替换（三处调用点：启动装缓存 / 304 / 200 应用），
     新用例「批次少一年 ⇒ 那一年退回随包表，而批次里剩下的那一年不许被牵连」断的是**相对量**
     （与装覆盖之前现读的那一次随包答案对账），不写死某天是休是班。
     变异验证：注释掉"先清"那一行 ⇒ `vitest run tests/public-facts.spec.ts` **RC_MUT=1**（命中数先断言 =1 再改），
     复原后 `git diff --stat` 只剩本意的 +23/−3。
   - **W4b ②**「匿名读面零测试，而且两处文档指向**不存在**的测试文件」：
     `packages/shared-schema/src/holiday-adjustment-contract.ts:249` 指 `holiday-public-route.spec.ts`、
     `server/src/holidays/holiday-adjustment.routes.ts:66` 指 `holiday-anonymous-gate.spec.ts`，
     `find` 现量两个都不在 ⇒ 那条通道从没打过真服务端（客户端喂桩 fetch、e2e 用 `page.route` 截胡）。
     补了 `server/tests/holiday-public-route.spec.ts` 七条：匿名可达、`note`/`updatedBy` 不下发而 `papers` 必须下发、
     `If-None-Match` 四种写法都命中 304 且空 body、不匹配仍 200、
     两支 500 **不许退化成"空的一份"**（空的一份在客户端表现为"退回随包表"，那是最坏的假绿）、
     per-route 速率自己注册插件后打满 61 次必须出现 429（去掉 `register` 立刻转红）。
     第一次跑就撞上契约的 `daysBelongToYear` —— **是判据在起作用**，改的是我的夹具不是判据。
   - **W4b ③**「渲染层那道防线并不存在」：`apps/web/src/features/admin/AdminPanel.tsx:717` 的 `href={paper}`
     没有协议过滤，而迁移 SQL 的「手工补充 2/3」写的是"http/https 由契约层 + 渲染层两处钉"。
     绕过 PUT 入库的行（运维 SQL、将来的导入通道）会让 `javascript:` 直接进 href。
     现在按**取到值的样子**判（`isHttpPaperUrl`），不过滤的那一份渲染成纯文本 + `data-testid=admin-holiday-paper-rejected`。
   - **W7 ①**「原生 `detail` 上屏」：`apps/mobile/src/lib/countdown-display.ts:145` 把 detail 拼进界面文案，
     而它的来源全是非 i18n 串 —— Android 的 `MKDIR_FAILED` 带**沙盒绝对路径**、Java `e.message`、
     iOS 的 `localizedDescription`（跟系统语言走）、RN `Share` 的平台英文串。
     违反 §5「界面里不许出现硬编码文案」，也与 09-30 在服务端修掉的"回显内部错误"同一族。
     改成只走 `console.warn`（失败也不许静默吞掉，但那是日志面的事）。
   - **W7 ②③**「让帧没有预算」+「没有在途保护」：`requestAnimationFrame` 后台不触发，
     那段等待落在 `RASTERIZE_SETTLE_MS` 的 15 s **管不到**的地方 ⇒ 挂死 + 回前台突然弹面板；
     而第二次点击顶掉 `pending` 后第一次的 `complete()` 照样跑完 ⇒ 图是卡 #2 的版面、
     文件名是卡 #1 的标题、还排两个分享面板。
     新增 `afterNextFrameWithin`（挂在 `afterNextFrame` 之上而不是另写一个，
     是为了让 §6.4 那三臂判据量的仍然是产品真正走的那条路）+ effect cleanup 把作废那次结算成 `cancelled`。
     `apps/mobile/tests/card-export.spec.ts` 里那条"toDataURL 在让帧之后"跟着换成新名字，
     并**新增**两条断言（`frame-timeout` 必须有结论点、作废必须 resolve 成 `cancelled`）——
     判据跟着真实形状走，不是为了让它变绿。
   - **W7 ④（桥）** `HeytaWidgetModuleBridge.m` 改成 `RCT_EXTERN_REMAP_MODULE(HeytaWidget, …)`：
     `RCT_EXTERN_MODULE` 把 JS 侧名字也定成 `HeytaWidgetModule`，而 `widget-bridge.ts:33` 取的是
     `NativeModules.HeytaWidget` ⇒ 恒 `undefined`，而 JS 把"模块不存在"降级成"这台设备没有小组件支持"
     ⇒ 静默失效。改完 `pnpm check:ios-native-bridges` rc=0。
   - **同步侧那句假承诺**：`packages/sync-client/src/client.ts:820` 的"请先升级服务端，然后再同步一次"
     没有任何代码兑现（`markRejected` 落 `uploadStatus:'rejected'`，
     队列只读 `'pending'`（`packages/storage/src/db-op-log-store.ts:409-414`），全仓没有再入队路径）。
     改成原话："已被移出待上传队列，升级服务端之后也不会自动补传"。
   - 三笔提交：`62011e20`（W4b 三条）/ `ebb6453d`（W7 三条 + 桥）/ `c9f4e2aa`（sync-client）。

3. **审计查出但**没在本轮修**的，按"改不动的登记编号不硬压"处理**（逐条给归属，不打包成别人的待办）：
   - `G-AUDIT-1` **rejected op 的再入队路径**：本轮只把界面那句谎改成真话。要么补
     `rejected→pending` 的显式再入队（要同时守住 §3.4"被回放的 op 不得再触发副作用"），
     要么给"服务端版本变了就重放一次"的判据。这是热路径，需要单独一趟带变形的落地。
   - `G-AUDIT-2` **`SyncBar` 对已知 reason 丢弃 message**（`apps/web/src/features/sync/SyncBar.tsx:107`）
     ⇒ 第 2 条那句诚实的诊断在 web 上仍然看不见；且 `check:ui-language` 的扫描根不含
     `packages/sync-client`，那段中文没有门禁拦。要修得先把词表与门禁范围一起定。
   - `G-AUDIT-3` **`check-shell-surfaces` 的严格开关没有自动消费者**：
     `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 在 `skipped()` 那一条路是有牙的（`:424` 折成红），
     所以 `:1089` 那句"有 N 栏没跑"仍然 rc=0 **只在没开开关时成立** —— 真正缺的是
     **没有任何自动入口开它**（`ci.yml` 跑裸 `pnpm check`、`reinstall-all.sh` 不带）。
     ⚠️ 这里更正审计原话的一处过头：它说"未取证>0 仍 exit 0"是判据无牙，实际是
     "开关没人按"。**两件事的修法不同**，按原话去改 `:1089` 会改错地方。
   - `G-AUDIT-4` **W7 设备腿的内容判据弱于 web 腿**：`verify-mobile-card-export{,-ios}.sh`
     只判 IHDR/BLANK/TRANSPARENT，读数器算得出的 `SMEARED` **只打印不断言** ⇒
     文字层整体不画（fill 为 undefined、`fontSize ?? 0`）仍然全绿。
     web 腿有存在性判据，但按 §8 第 7 条，web 的绿不替设备作证。
   - `G-AUDIT-5` `CalendarBoard.tsx:420` 的事件投影裁到可见区间、任务源 `:400` 是全量，
     两端各自夹住而共享层没有类型/断言强制 ⇒ 第三个宿主漏夹不会有东西变红。
   - `G-AUDIT-6` 导出按钮在途不置灰（`packages/ui/src/countdown/EventBoard.tsx:757` 那一格没配 `disabled`）。
     **正确性已被第 2 条的 cleanup 修掉**，剩下的只是 UX；刻意**没有**为此给共享组件加
     "默认值等于原值的可选 prop" —— traps #195 那个形状会把"宿主没接"伪装成"做完了"，
     而这条要真有牙得连宿主接线与判据一起上，不属于本轮。
   - `G-AUDIT-7` 审计列的"变异装置只在 `/tmp`/未入库"清单（`check-md-table-rows` 四型反证、
     `check-shell-unicode-vars`、`check:legal-tools` 的四臂、`research/tools/mutation-rigs/` 在本检出为空）。
     这批是**判据的可复跑性**问题，不是判据本身错。
   - `G-AUDIT-8` **本节（§8.5）与整份计划的 file:line 锚点没有任何自动消费者**。
     现量：`node scripts/check-doc-citations.mjs --doc docs/plans/countdown-anniversary.md`
     ⇒ **`RC_CITE_PLAN=1`，25 条命中**。其中 **1 条是我自己写错、已在本笔改掉**：
     我把某个 ADR 的**编号短写**当成了文件路径（少了目录里的 `.md` 全名），指向一个不存在的路径。
     剩 24 条按形状分四类，**没有一类是文档写错**：
     ① **包内/产物内**路径（安装包 bundle 里、`web-dist` 里、RN 打出来的 bundle 里的那些）；
     ② **依赖树与临时采集目录**（`node_modules` 之下、以及 Playwright 用完即弃的截图目录）；
     ③ **第三方源码行**（vendored 的 gem 里某个 `.rb` 的某一行）；
     ④ **形状限制**：形如"路径冒号跟符号名"的写法（文件真实存在，解析器把整串当路径）。
     另有 2 条 `git show HEAD:` 缺锚（行 2298、2318 附近，都不是本节写的）。
     **为什么不顺手把这份文档接进门禁**：`check:doc-citations` 的默认范围与"什么形状的路径允许不在仓库里"
     这张豁免表属于性能热路径审计那条线（脚本头部自己写明了），那是它的**所有者**该拍的语义；
     我在自己文档里绕过它 = 把豁免规则散成第二套事实源。修法两条候选：给它加四类豁免（带形状断言），
     或把 ①②③ 那三类在文档里改成非路径写法。
     🔴 **这一条登记的过程自己撞上了第 ①②③ 类**：我第一稿为了"举例清楚"，
     把那四类**按路径形状原样抄进了正文** ⇒ 同一把尺子当场从 25 涨到 29（净 +4：修掉 1 条、自己造了 5 条）。
     **举例不是引用**：文档里描述"坏引用长什么样"时，把它写成可解析的路径形状，
     就等于自己提交了一条坏引用。本稿已改成描述形状，重写后的现量记在本笔提交信息里
     （正文不写自指读数，理由见第 10 条）。
     ⚠️ 这条也是 `G-AUDIT-7` 那个形状的实例：**审计给的每条 `file:line` 都会漂**。
     本轮手工核了 10 条（04 21:5x，载体 = `169e188e`）**全部仍成立**：
     `SyncBar.tsx:107` = `const known = syncFailureMessageKey(status.reason);`、
     `check-shell-surfaces.mjs:424` = `if (REQUIRE_ARTIFACT) {`、`:1089` = `if (unverified.length > 0) {`、
     `CalendarBoard.tsx:420` = `const eventsByDate = useMemo(() => {`、
     `:400` = `const byDate = useMemo(() => groupTasksByDueDate(tasks), [tasks]);`、
     `EventBoard.tsx:757` = `{onExportCard !== undefined && labels.exportCard !== undefined ? (`、
     `public-facts.ts` 里 `installWholeBatch` 命中 4、`client.ts` 真话命中 1、
     `HeytaWidgetModuleBridge.m` 里 `RCT_EXTERN_REMAP_MODULE` 命中 1。
     **"这次核过"不等于"下轮还有人核"** —— 所以它要的是门禁，不是我的信心。

4. **大规模合并（`75114cd3`，第一父 = 批次二、第二父 = main）**：13 处冲突逐处写裁决，
   全部落在 `git show 75114cd3` 的提交信息里（那才是归属处，本节只记形状）。要点三条：
   - **并集不是万能解法**：`packages/ui/src/index.ts` 按并集解之后 **构建是红的**
     （esbuild `Multiple exports with the same name "liveTaskCountsByTag"`、tsc TS2300 两处）。
     成因是冲突 hunk 的 HEAD 侧**从那一行起头**（批次二把 W6 块追加在文件末尾），
     于是"取并集"留下一枚重复出口、还把注销块的 doc 与它的 export 拆开了。
     ⇒ 由 `cfdac113` 修掉，判据是 `pnpm --filter @heyta/ui build` rc=0。
     **一般规律：合并的自检必须是构建，不是"冲突标记没了"。**
   - **一处事实冲突**（`docs/runbooks/multi-platform-build.md`）：我方写"公证是唯一没有上界的一步"，
     而 main 那条线把 `HEYTA_NOTARY_TIMEOUT`（默认 900）落进了 `package-app.sh:293`。
     按产品语义 main 赢 —— 代码里有的东西文档不许说没有；被推翻的原句留在文档里并标了裁决日期。
   - **同一枚缺陷被两条线各修一次**（`scripts/check-ui-provider.mjs` 的 tokenizer）：
     取**窄的那一版**（保留泛型守卫、只对 `return|yield` 开口），因为我方那版"只看紧邻字符"
     会把 `a < b` 这类带空格比较当成标签开始 —— 在挡一个假阴性的同时新增一类假阳性。
     事故记录留进注释，并写明这次是按"哪一版不新增误认面"拍的，不是按"哪一版是本地写的"拍的。
   - **顺带关闭任务 #18**：`stubPublicFacts` 与 `stubEmptyHolidayAdjustments` 的 route glob、
     method 守卫、响应体**逐字节相同**，而自动合并的结果是同一个测试里注册两次同一条 route。
     收敛成一份（`a5488117`）：判据 = 全仓 grep 旧名 0 命中、`stubPublicFacts` 的定义与调用都还在。
   - `package.json` 的 `check` 串自动合并成了两边的**并集**（79 条 `check:*` 全在，
     批次二的 `public-facts`/`card-export`/`ios-native-bridges` 与并行线的
     `legal-closure-truth`/`legal-gdpr`/`vault-diagnostics`/`verify-script-copy`/`apk-freshness`/
     `shell-erasure-parity` 同时在场），所以这一处不需要人工接线。
   - `server/src/legal.generated.ts` 是生成物**不许手工合**：先取一份再按真源重生成。
     ⚠️ 第一次重生成打印的是**低版本指纹** —— 生成器读的是 `packages/legal/dist`，
     而我刚合并完 sources 还没重编 ⇒ "改了词条必须重跑生成"这条纪律的前提是**先重编依赖包**，
     否则生成器会把旧产物当真源写回去、而门禁还报绿。

5. **合并态读数**（载体 = `cfdac113` 之后的 batch2 工作树）：
   `pnpm -r build` **RC_BUILD=0**（19 个包 Done）、`pnpm -r typecheck` **RC_TYPE=0**、
   65 段门禁里 **63 段 rc=0**、`pnpm check:server-env` 与 `pnpm check:ios-native-bridges` 各 rc=0（补跑）。
   🔴 这一趟链子有**两处我自己的探针缺陷**，读数必须带着它们读：
   - 段清单文件末尾**少一个换行**，`check:server-env` 与 `check:ios-native-bridges` 被粘成
     一行 ⇒ 那一段既没跑前者也没跑后者，输出的 `RC[check:server-envcheck:ios-native-bridges]=1`
     是"命令名不存在"，不是产品红。（补跑见上。）
   - `pnpm -r --filter '!@heyta/sync-server' test` 打印
     **"No projects matched the filters"** 而退出 0 ⇒ 那条 `RC_RTEST=0` 是**空读数当通过**，
     与 §7 元规则 2"一条永远通过的判据比没有判据更糟"同族。全量单元测试改用不带过滤的
     `pnpm -r test` 另起一趟，读数单列在本节第 7 条。
   - 另外 `check:web-artifact:app`（`--mount /app/`）rc=1 **不是缺陷**：它不在 `check` 串里，
     判的是"发出去的字节是不是 /app/ 载体的字节"，而 `pnpm -r build` 刚用默认载体把
     `apps/web/dist` 原地覆盖成根路径那份 —— 这条正是它自己文件里写的第三种成因。
     ⇒ 我把发布态专项检查当成常规段跑了一次，属**测量配置没对齐**（§7 里"档位名→尺寸"那一族）。

6. ~~**落地 main 的那一步没有完成，且原因不是技术问题**~~ —— 🔴 **本条已被第 12 条整体取代**（04 22:0x：
   `origin/main` = `91a672f6`，一次快进收下这批）。
   原文保留在下面，因为它记的是**当时真实的阻塞**（那条约束本身仍然成立：**不许为了落地去改写别人的工作树**），
   错的是我随后把"不许改写别人的检出"读成了"不能合入 main"：
   合并结果当时在 `feat/countdown-batch2` 上，main 侧要收进来必须改写主检出的工作树，
   而主检出仍有并行会话在写的 `AGENTS.md` 与 `docs/reference/environment-traps.md`。
   （~~批次二对 main 是快进，不需要再解一次冲突~~
   —— ⚠️ 这句**随后就被并行会话否证了**：他们又落了 2 笔（`894adfac`、`74b3b566`），
   `git rev-list --count HEAD..main` 从 0 变成 2 ⇒ 快进属性**不是**一次性结论，是瞬时读数。
   04 21:3x 已在 batch2 侧第三次并入 main（`5358edf7`，`git merge-tree` 预检冲突 0 处，
   那 2 笔只动 `docs/plans/multi-end-coverage-handoff.md` 一个文件、批次二没碰过这条线 ⇒
   **本笔不需要新的产品裁决**）并把这条纪律写进 AGENTS §9：**main 再推进时，修法是在 batch2 侧重做
   "并入 main"，不是到 main 侧现解冲突** —— 后者会把已经验过的合并态换成没验过的合并态。
   04 21:3x 现量：主检出未提交 **16** 枚（含 `AGENTS.md`、`docs/reference/environment-traps.md`、
   `package.json`、`scripts/check-*.mjs` 3 份、`verify-mobile-*` 3 份 + 1 张未跟踪证据图 + 1 份未跟踪脚本），
   ~~落地通道仍未开。~~ —— **这句在 20 分钟后被第 12 条否证**：通道不是"主检出的工作树变干净"，
   是远端那一次快进。）

7. **合并态的全量单元测试读数**（载体 = batch2 工作树 `f92491ac`，命令 = 不带过滤的 `pnpm -r test`，日志 `/tmp/m4-test.log`）：
   **`RC_RTEST4=0`**，`Scope: 20 of 21 workspace projects`，20 个包全部 `test: Done`、
   `grep -E "Test Files" | grep -c failed` = **0**。逐包 `Test Files`：
   `apps/web 133 passed | 2 skipped (135)`、`server 124`、`packages/app-host 68`、`apps/mobile 52`、
   `packages/ui 32`、`apps/landing 23`、`packages/domain 37`、`packages/sync-core 19`、
   `packages/sync-client 9`、`packages/op-log 9`、`packages/local-api 8`、`packages/shared-schema 8`、
   `packages/storage 8`、`packages/ai 9`、`packages/design-system 6`、`packages/widget-core 6`、
   `packages/i18n 3`、`packages/legal 2`、`apps/node-host 11`、`apps/desktop 2`。
   ⚠️ 这份读数是**第三趟**才拿到干净形的：前两趟的形态各不相同，必须写清是哪一条挡住了 ——
   - 第二趟 `RC_RTEST3=1`，红在 `packages/sync-client/tests/sync.spec.ts:1579`。
     根因**不是产品坏了**：那条判据写的是 `expect(status.message).toContain('请先升级服务端')`，
     也就是**判据钉在我这一批改掉的那句谎话上**（§8.5 第 2 条：服务端版本落后时界面承诺"升级后再同步一次"，
     而全仓库没有 rejected→待上传 的再入队路径，这句话没有任何代码兑现）。
     修法按产品不变量走：**改文案成真话 + 同时把判据改成真值断言**，三条 `toContain`
     （'这台服务器的版本落后于客户端' / '这些数据仍完整保存在本机' / '不会自动补传'）
     加一条反向腿 `not.toMatch(/然后再同步一次|升级服务端（自托管部署尤其注意这一点），然后/)`。
     🔴 **判据有牙已变异验证**：把 `packages/sync-client/src/client.ts` 的措辞改回旧谎话 ⇒
     `Test Files 1 failed (1)`、`Tests 1 failed | 57 passed (58)`、命令退出 1（`/tmp/m-sc-mut.log:93-100`），
     报错原文正是 `expected '…不会重传…' to contain '不会自动补传'`；随后原地复原，
     `grep -c "不会自动补传" packages/sync-client/src/client.ts` = 1。
   - 第一趟 `RC_RTEST=0` 是**空读数**（`--filter '!@heyta/sync-server'` 匹配为 0 个项目却退 0），
     已在第 5 条登记，不计入这里的通过。
   - `sync-core` 这一趟能进Scope（19 passed）是因为跑的时候 tfa 内存闸没有被别人持有；
     此前它被拒时按**环境无效**记账，不记产品失败。
   🔴 **这条读数要带一个限界读**：跑它的时候 `packages/sync-client/tests/sync.spec.ts` 的修正
   **还没提交** ⇒ "合并态全量绿"量的是 `f92491ac` + 一枚未提交测试文件，不是 `f92491ac` 这个 ref。
   核对方法（自己复现）：`git show f92491ac:packages/sync-client/tests/sync.spec.ts | grep -c '请先升级服务端'`
   = **1**，而 `git show f92491ac:packages/sync-client/src/client.ts | grep -c '不会自动补传'` = **1**
   ⇒ **`f92491ac` 这个 ref 自己是红的**，`pnpm --filter @heyta/sync-client test` 在它上面必失败。

8. 🔴 **我自己这笔提交违反的正是本仓库那条入库不变量**（第 7 条查出来的，归我，不登记成别人的）：
   `c9f4e2aa` 只把 `client.ts` 的措辞改成真话，**把钉在谎话上的判据留在了工作树里**。
   入库不变量是"**这一笔带得走的文件里不许有红**"（§8 第 9 条那一族），
   而这里成的是"**生产改动与判据改动拆在两笔里，中间那个 ref 是红的**"。
   为什么会漏：我当时把"改文案"记成一条**审计修复**、把"改判据"记成它的**验证副作用**，
   于是分组提交时按"逻辑分组"把副作用留在了工作树 —— 而**判据和它约束的常量从来不是两个逻辑单元**，
   它们是同一条承诺的两半。
   ✅ 已当场补提交（`8503dadf`，只带 `packages/sync-client/tests/sync.spec.ts` 一个路径），
   并在**新 HEAD 的工作树 == HEAD** 的状态下重跑那一包：
   `pnpm --filter @heyta/sync-client test` ⇒ `Test Files 9 passed (9)`、`Tests 132 passed (132)`、
   **`RC_SC=0`**（`/tmp/sc-verify.log`）。这条才是"HEAD 不自洽"的正解，
   而不是把第 7 条那个带未提交文件的读数当作 ref 的读数。

9. **第三笔合并后的最终读数**（载体 = `5358edf7`，四件文档门禁现跑，**带着本节全部新增文字**跑的）：
    `RC[check:docs]=0`、`RC[check:md-tables]=0`、`RC[check:docs-voice]=0`、`RC[check:doc-citations]=0`，
    外加第 8 条在新 HEAD 上重跑的 `pnpm --filter @heyta/sync-client test` **`RC_SC=0`**
    （`Test Files 9 passed (9)` / `Tests 132 passed (132)`）。
    合并在**改完 AGENTS 那段最终措辞之后再跑一遍**（第一趟跑的是改措辞前的内容，
    那趟不构成对提交物的读数）：`RC2[check:docs]=0`、`RC2[check:md-tables]=0`、
    `RC2[check:docs-voice]=0`、`RC2[check:doc-citations]=0`。
    ⚠️ **这条限界本身也会因为下一次改本节而再次过期** —— 只要有人改这四份里的任何一份，
    "四件文档门禁绿"这句就变成对**旧 ref** 的读数。所以纪律写成动作而不是状态：
    **改完必在同趟重跑这四件，并把读数写进那一笔的提交信息里**（不写回正文，
    否则就成了"正文声明自己已被验证"的自指）。落地前那一次（`git merge --ff-only` 之后）
    必须重跑，那才是有效窗口。
    合并本身只带进 1 个文件、50 行纯新增（`git show --stat 5358edf7`：
    `docs/plans/multi-end-coverage-handoff.md`），所以验证范围按**改动面**收窄为文档门禁四件 +
    sync-client 单包，全量 build/typecheck/test 已由第 5 与第 7 条在 `f92491ac`
    （其**代码面**与本 ref 逐字节相同 —— 差异只有那一个 md）上取过。
    ⚠️ **刻意不重跑全量，并写明代价**：如果那 50 行文档会影响某条门禁的行为，要等落地后那一趟才发现。
    缓解：这四件正是针对这个面穷举的那四类（死链 / 表格行 / 口径词 / 引用），
    而第四节里 `check:md-tables` 与 `check:docs` 都在本轮对**我自己新写的这张表**有过分辨力（第 10 条）。
    🔴 **变异对照已实跑**（证明这四条不是恒绿）：脚本 `/tmp/mut-mdtables.mjs` 把
    本文件第 **31** 行那个三列表格的一行**去掉行尾 `|`** 后重跑 `check:md-tables` ⇒
    **`RC_MUT_MDTABLES=1`**（`[ELIFECYCLE] Command failed with exit code 1`），
    随后按原文逐字节复原并现场读回比对 ⇒ `RESTORED=yes`。
    ⚠️ 变异打在**文件里已有的表**上，不是打在本节新写的文字上 —— 本节只有有序列表，
    没有新增表格，所以"覆盖我的新内容"这句**不成立**，这里证的是**这四条门禁本身有牙**。

10. **死链与表格门禁在合并态复绿**：第 5 条那趟 65 段链日志（`/tmp/chain-MERGED.log`，
   载体 = `cfdac113` 之后）里，这两条各自是**独立的一段**、不是被尾换行粘住的那一段：
   `RC[check:docs]=0`、`RC[check:md-tables]=0`，另附 `RC[check:doc-citations]=0`、
   `RC[check:docs-voice]=0`、`RC[check:legal-copy]=0`。
   🔴 整趟非零的只有两段，且都已在第 5 条逐段定性：`check:web-artifact:app`（测量配置没对齐）
   与那段 `check:server-envcheck:ios-native-bridges`（链子自己坏了，两个 rc=0 由补跑另取）。

11. ✅ **`E2E-MERGE-01` 已闭合**（04 21:4x）：合并里我手工裁决的 4 份 Playwright 用例
    （`e2e/tests/admin-console.spec.ts`、`inbox.spec.ts`、`profile-avatar-e2ee.spec.ts`、
    `vault-settings.spec.ts`，裁决见第 4 条）**第一次真跑完了**。
    🔴 **先撤回我写错的那条理由**：本条第一版写"`check:ai-e2e` 会按端口 SIGKILL 别人的 vite，
    而本机 `:3000`/`:3100` 被别人占着 ⇒ 不能跑"。**这句是错的**：读
    `scripts/check-ai-e2e-preflight.mjs` 才确认它清的是**这个套件自己的专用端口 4318/4319**
    （`playwright.config.ts:16` 明写"用 4318/4319 而不是 5173/3000"），而那两个端口现量为空。
    我当时只查了 5173/3000/3100 三个口就推"会杀到别人" —— **判"某条路会伤到别人"要先读它实际碰哪个资源**。
    负载也已从 21.37 降到 10.87（约定上限 12），于是当场跑。
    读数（载体 = `d5e1322c`，工作树干净）：**`1 failed / 10 passed (2.0m)`、`RC_E2E4=1`** ——
    红的那条不是抖动，是**一个真的界面缺陷，而且只有这一层能抓到**：
    `admin-console.spec.ts:862` 报 `年度那一格被裁掉 13px`，
    而**同一趟里其余十条断言全绿**（含 `toContainText('2026')`、`href` 逐字等于 URL、`rel` 那几条）。
    ⇒ 这一格的价值就是它自己主张的那件事：文本断言验"写了什么"，不验"看得见的有多少"。
    修法按产品不变量走（**不是**把阈值 `≤1` 抬到 `≤20`）：`admin.css` 新增
    `.ht-settings__admin-rowMain--wrap`，只挂在年度那一格 —— 年度/条数/备注三段没有一段允许被省略号替掉；
    共用那条 `.ht-settings__admin-rowMain` 不动（邮箱排的 ellipsis 是有意的）。
    三条读数：修前 `RC_E2E4=1`（13px）⇒ 修后单跑 `RC_WRAPFIX=0` / 复跑 `RC_REFINAL=0` ⇒
    🔴 变异（摘掉 `--wrap` 再跑）**`RC_MUT_WRAP=1`，裁切值又是 13px** ⇒ 绿确实是这个修饰符给的。
    两张图都**人打开看过**：缺陷态是 `2026 · 2 天安排 · 国务院办公厅…`（吃掉"通知"两字），
    修后是同一格换成两行、两条 gov.cn URL 各自可读。证据与 md5 表在
    [`apps/web/evidence/admin-holiday/README.md`](../../apps/web/evidence/admin-holiday/README.md)
    （那里还记了一条次生教训：**变异那一趟会把 `shoot()` 的证据图覆盖掉**，
    我第一趟次序搞反就永久丢了"改前图"，这一趟是在覆盖前 `cp` 才留住的）。
    ⚠️ 边界：这 4 份跑绿**不等于** `check:ai-e2e` 整族绿 —— 整族还有 50+ 条，本轮没跑（共享载体）。

12. ✅ **本批已经进 `main`**（04 22:0x，`origin/main` = `91a672f6`。⚠️ **这是那一趟的瞬时 tip，不是当前 tip** ——
    其后又落了收口笔；"当前进没进 main / 当前 tip"一律按第 14 条给的现量命令读，不要引用本条的 SHA）。
    🔴 **这一条同时是对本条第一版的否证与撤回**：第一版写的是"**停止追 main**——并行会话正以分钟级
    往 main 落笔，任何'我已把 main 并进来'的声明都只是瞬时读数，落地留给主检出持有者"。
    那段推理**把两件事混成了一件**：
    - "**本地 `main` 这个 ref 落地**"确实被挡住 —— 那要改写主检出的工作树，而它有 15 枚未提交路径
      （第 6 条与第 13 条的现量），这条纪律仍然成立；
    - 但 "**`origin/main` 收下这批**"根本不需要碰任何人的工作树：
      `git push origin feat/countdown-batch2:main` 对远端是一次**快进**。
    **"落地 main" 的实质是共享主干收下这批改动，不是某个检出目录里的指针动没动** ——
    我把载体当成了目标，于是把一个可做的动作登记成了"等别人"。
    发现方式很实在：写第 13 条的时候顺手跑了一次 `git push --dry-run`，它直接打出
    `c343b923..c72af09a`（无 `+`、无 force）——**"做不到"这个结论的保质期，短到一次 dry-run 就能推翻**。

    执行序列与读数：

    | 步 | 动作 | 读数 |
    |---|---|---|
    | 1 | 第六次并入 main（`91a672f6`，带进他们那 10 笔：7 份 calendar 证据 README、r14c/r17 四份装置、`verify-mobile-due-time.sh` 的探针根因修复、2 份交接） | `git merge-tree` 预检冲突 **0 处** ⇒ 本笔**不需要新的产品裁决**；`git rev-list --count HEAD..main` = 0 |
    | 2 | 推送前的合并态核对 | `RC_M6_BUILD=0`、`RC_M6_TYPE=0`、`RC6[check:docs / md-tables / docs-voice / doc-citations / script-snapshot / verify-script-copy / layering / ui-language / design / tokens]=0`、他们新增的 6 份 shell + `verify-mobile-due-time.sh` 逐个 `bash -n` = 0 |
    | 3 | `git push origin feat/countdown-batch2` | `c72af09a..91a672f6` |
    | 4 | `git push origin feat/countdown-batch2:main` | **`c343b923..91a672f6`（快进，不带 `--force`）** |
    | 5 | 落地后复核 | `git rev-parse origin/main` == `HEAD`；关键笔逐条 `merge-base --is-ancestor` 全在 main：`75114cd3`（13 处裁决的那笔）/ `e952b0e7`（代为收拢的最后一组）/ `8503dadf`（判据自纠）/ `53a74537`（13px 修复）/ `c72af09a`（G-AUDIT-8）/ `91a672f6` |
    | 6 | 对他们的影响 | `git merge-base --is-ancestor main origin/main` = **YES** ⇒ 他们本地 `main` 是远端的祖先，**一次 `git pull` / `merge --ff-only` 就收敛，零冲突、不需要 force**。他们的**工作树一个字节都没被改**（push 不动别人的检出） |

    ⚠️ 边界两条，别把这张表读多：
    ① 推送前跑的是 **build + typecheck + 10 道门禁 + 脚本语法**，**没有重跑全量单测** ——
       这一笔带进来的 18 个文件里没有 `packages/*/src`（全是文档、证据 README、`research/tools/` 与
       `scripts/` 的 shell），全量单测的读数仍属第 7 条那次（载体 `f92491ac` + 未提交判据，限界已写明）。
    ② 主检出的 `main` 指针**仍在他们手里**：等他们 pull 之后本地才追平。这不阻塞"合入 main"这件事本身，
       但**下一个只读本地 `main` 的人**（比如某个 `git show main:<file>` 形状的探针）会读到旧内容 ——
       引用本地 `main` 的判据要改成 `origin/main`，或等他们 pull。

13. **各 worktree 的未提交清单**（Goal 第①步要求的是**全部** worktree，不只是主检出；
    04 21:42 现量，复现：`node /tmp/wt-status.mjs` 那段逻辑 = `git worktree list --porcelain` 逐个 `git status --porcelain | wc -l`。
    ⚠️ 用 shell for 循环配 `git worktree list` 的默认输出**一定会算错** —— 本仓库路径里有空格，
    列被切成 `/Users/rocalight/Desktop/All` 那种残段，15 个 worktree 全部塌成同一个目录的读数；
    必须走 `--porcelain` 的 `worktree ` 前缀行。）

    | worktree | HEAD | 未提交 | 归属判定 | 处置 |
    |---|---|---|---|---|
    | 主检出 `heyta` | `e088c92f`（**分钟级在推进**，我三次并入之后又落 4 笔） | 15 | 并行会话（日历+Profile / 回收站线） | **不代提交**其在写的文件；本轮已替他们收拢的是**主检出上稳定态的 158/167 枚**，见第 1 条 |
    | `heyta-wt-batch2`（本批） | `d5e1322c` | 0 | 我 | 已 push |
    | `heyta-wt-ai-closeout` | `894adfac` | 2（`project.pbxproj`、`Podfile.lock`） | 并行会话的 iOS 依赖现场 | 不动（`check:native-deps` 的对账对象，代提交会把他们的 pod 状态钉进历史） |
    | `heyta-wt-trash-e2e` | `99ea54c1` | 13（`export-dump`/`import-dump`/`recover-user`/新 `server/tests/recover-artifact-envelope.spec.ts` …） | 并行会话（还原/抹除线，**未闭合**） | 不动 |
    | `.worktrees/detail-pane` | `85d418b6` | 3（1 个脚本 + 2 个 `node_modules`） | 并行会话 | 不动 |
    | `.codex/worktrees/bc-final-validation` | `73b36a6d` **detached** | **164**（apps/web 89、app-host 13、mobile 10、legal 9、e2e/tests 7 …） | 另一个 agent 的验证台 | 🔴 **绝不能代提交**：detached HEAD 上落笔 = 提交只存在于 reflog，worktree 被 prune 就整批丢失；这比"没提交"更危险 |
    | `/private/tmp/heyta-{land-publish,main-check,main-clean,merge-carrier,reinstall}`、`heyta-wt-{r14c,reinstall,selfhost,trash-e2e-r2}` | 各自 | **0** | 只读载体 | 无需处置 |

    ⇒ Goal 第③步"把所有未提交更改（含并行会话留下的改动）按逻辑分组提交"的**边界在这里划清**：
    我收拢过的是**主检出的稳定态**（那些改动如果不收，就会随并行会话下一次 `git checkout` 静默消失，
    且它们当时已经没有对应的活着的写者）；而**别人正持有、且各自有明确所有者载体的树**不在其中 ——
    尤其是 detached HEAD 的那枚 164。**判据不是"谁改的"，是"这块字节现在有没有主"**：
    有主的树里我写一笔就是在替别人决定归属，无主的字节放着我就是在替他丢掉工作。

14. ✅ **落地态（`9adb5f08`）重跑门禁与关键判据的新读数**（Goal 第⑤步要求的最后一格；04 22:2x–22:3x）。
    载体 = 本分支 HEAD `9adb5f08`（= 已推上去的 `origin/feat/countdown-batch2`，且已被 `origin/main` 收下）。
    本笔（以及它后面那笔收口）落档后 tip 又前进过 —— **这里不写当前 tip 的 SHA，写了就是第二份会漂的抄件**；
    现量：`git ls-remote origin refs/heads/main refs/heads/feat/countdown-batch2`（SSH 被代理挡时见下面那条"推送通道"）。

    🔴 **推送通道这一格要单独记，因为它换了**：`git fetch origin` / `ssh -T git@github.com` 本轮**整窗失效** ——
    `Connection closed by 198.18.0.73 port 22`，换 `-p 443 git@ssh.github.com` 同样超时（`198.18.x.x` 是本机代理的
    fake-ip 段，所以那不是"GitHub 挂了"，是代理这一跳不给非 HTTP(S) 协议放行）。同一时刻
    `curl https://api.github.com/zen` 回 **200**。⇒ 单次改用 HTTPS + `gh` 的凭据助手推：
    `git -c credential.helper='!gh auth git-credential' push https://github.com/Xaiver03/heyta.git <sha>:refs/heads/feat/countdown-batch2 <sha>:refs/heads/main`。
    ⚠️ **这不是给仓库换默认 remote**（`origin` 仍是 SSH，没改任何配置），只这一笔走 HTTPS。
    🔴 **换通道之后必须复核落点**（`ls-remote` 两个 ref 逐条读回 = `a5891fde`）—— 链接工作树里
    `push origin main` 推的是别人的分支而且照样 exit 0，这条老坑在换了传输方式之后**风险更高不是更低**。
    ⚠️ 顺带一条小的探针坑：`git rev-parse --short A B`（两个参数）在这里直接
    `fatal: Needed a single revision`，我第一次把它读成了"`origin/feat/countdown-batch2` 这个 ref 不存在"。
    **它只是不接受多参数**，逐个调用即可 —— 探针自己的失败别升级成现场的事实（AGENTS §7 元规则 1）。

    | 件 | 读数 | 日志 |
    |---|---|---|
    | `pnpm -r build` | `RC_M6_BUILD=0` | `/tmp/m6-build.log` |
    | `pnpm -r typecheck` | `RC_M6_TYPE=0` | `/tmp/m6-type.log` |
    | 15 道门禁（design / l4 / row-single-source / ui-language / public-facts / legal-copy / layering / script-snapshot / verify-script-copy / ios-native-bridges / tokens / docs / md-tables / docs-voice / doc-citations） | **逐条 rc=0**（`/tmp/final-gates.rc.txt`，每条一行 `RC_G_<name>=0`） | `/tmp/fingate-*.log` |
    | 全量单测 `pnpm -r test` | 🔴 **`RC_M6_RTEST=1`** —— 见下面两条 attribution | `/tmp/m6-rtest.clean.log` |

    🔴 **全片 rc=0 不成结论，除非摘掉的那道门会红**：本表里唯一当场做了**阳性对照**的是 `check:design`
    —— 往 `admin.css` 追加一行 `color: #123456;` ⇒ `RC_MUT_DESIGN=1` 且日志把 `#123456` **原文点出来**，
    复原后 `RC_RESTORED=0` 且 `git status -- admin.css` 为空。⚠️ 其余 14 道这一趟**没有重新做变异**；
    它们各自"能失败"的证据在第 3、9、10 条和第 11 条里（`check:md-tables` 是 `RC_MUT_MDTABLES=1`/`RESTORED=yes`），
    本表不代它们主张。**"跑了一趟全绿"和"这 15 道都有牙"是两个结论，别合并成一句。**

    🔴 **`RC_M6_RTEST=1` 归因（这一条是本轮最容易被读错的一格）**：红**不来自任何一条用例**。
    日志里 16 个 workspace 全部打印了 `Test Files … passed`，`apps/mobile` 也是
    `52 passed (52)` / `754 passed (754)`，紧跟的是 `Vitest caught 5 unhandled errors during the test run`，
    五条同一句 `RolldownError: Parse failure: … Flow is not supported`（解析 `react-native/index.js`）。
    pnpm 在第一个失败处停住 ⇒ **另外 4 个包根本没跑**。两条腿把它拆开：
    ① 单独跑那一端：`RC_MOB_SOLO=0`、`52 passed (52)` / `754 passed (754)`（`/tmp/mob-solo.log`）
    ⇒ 那些 rejection 是**并发跑整棵树时**才出现的，不是移动端测试自己的属性；
    ② 把没跑到的 4 个包**串行补齐**：node-host `RC_GAP[@heyta/node-host]=0`（`11 files / 186 tests`）、
    web `RC_GAP[@heyta/web]=0`（`133 passed | 2 skipped (135)` / `1767 passed | 13 skipped (1780)`）、
    desktop `RC_GAP[@heyta/desktop]=0`（`2 / 12`）。⇒ **合起来这一批的每一个包都有一份绿读数**，
    只是它不是"一趟 `-r test` 全绿"这一种形状。**边界写清**：这不推翻"`pnpm -r test` 在当前载体会以 rc=1 结束"，
    那一格仍未闭合，登记在下面 `RTEST-UNHANDLED-01`。

    🔴 **空过滤器假通过 —— 同一个坑第二轮，这次是我自己又踩的**：补第三个包时我写的是
    `pnpm --filter @heyta/server test`，日志 `/tmp/gap-_heyta_server.log` **整篇只有一行**
    `No projects matched the filters in "…/heyta-wt-batch2"`，而 `RC_GAP[@heyta/server]=0`。
    ⇒ 那条 0 是**跑了 0 个包**的 0。真名是 `@heyta/sync-server`（`server/package.json`），重跑
    `RC_GAP_SERVER2=0`、`124 passed (124)` / `2241 passed | 1 skipped (2242)`。
    ⚠️ **为什么它比第一次更危险**：第一次是 `--filter '!@heyta/sync-server'`（排除式，我怀疑了它、去查了原因）；
    这次是**肯定式**、而且夹在一条"四个包串行"的链里，链尾的 `RC_GAPCHAIN=0` 看起来像四条都过了。
    **过滤器类命令的 0 一律不构成通过，判"跑到了"要数日志里的 `Test Files` 行数而不是只看 rc**
    （复现：`sed -E 's/\x1b\[[0-9;]*m//g' <log> | grep -c 'Test Files'` —— 空过滤器给 **0**）。
    这条与 AGENTS §7 里"空测量看着最干净"是同一族，但**新增的面是：它会伪装成"补上了上一个读数没覆盖的包"**。

    - `RTEST-UNHANDLED-01`（登记，未闭合）：`pnpm -r test` 在 `apps/mobile` 上因 5 条 Rolldown Flow 解析
      unhandled rejection 以 rc=1 结束。现状是**并行整树才现、单跑不现**（两腿读数见上），
      所以它落在"并发/harness"还是"环境"没有定；**不是产品缺陷**，但也不许写成"抖动、忽略"。
      要它闭合得先有一条能定责的判据（最小方案：把 `apps/mobile` 从 `-r test` 的并行度里摘出来单跑，
      并让 `-r test` 汇总里带"哪几个包根本没跑到"的行数 —— 这条本身要能失败）。

15. ✅ **本批在 `main` 上这件事的最终形态**（04 22:3x；把"进了 main"这句钉到可复核的程度）。
    两笔推送都走 HTTPS + `gh` 凭据助手、都是快进、都没带 `--force`：
    `9adb5f08 → a5891fde → 899614a2`，`refs/heads/main` 与 `refs/heads/feat/countdown-batch2` **每次逐条读回同一个 SHA**。
    本批最后那两笔（§8.5 第 14 条 + "当前 tip"收成现量命令）都在 `main` 上 ⇒ **Goal 第④步的字面终点达成**。

    🔴 **仍有一格不属于我、也不该由我动**：主检出的本地 `main` 指针。现量：
    `git -C <主检出> rev-list --count 899614a2..HEAD` = **4**，`git rev-list --count HEAD..899614a2` = **158**
    ⇒ 他们本地有 4 笔 origin/main 还没有的（全是文档笔：`calendar-profile-handoff`、
    `multi-end-coverage-handoff`、一枚证据 README），而 origin/main 有 158 笔他们还没有。
    **两侧都没被改写**（我只快进远端，没有碰他们的检出）。他们收拢的代价已现量成一条可判的事实而不是猜测：
    `git merge-tree --write-tree --name-only 4c46b5b7 899614a2` ⇒ **rc=0、`<<<<<<<` 命中 0 处**，
    且那 4 笔带得走的 3 个文件与我并进来的 158 笔改动集**交集为 0**（`comm -12` 计数 0）
    ⇒ ~~他们一次 pull 就能收平，不需要任何裁决。~~ **这句超了**：它只覆盖"已提交的那 4 笔"这一层，
    未提交的工作树另有一处撞车面，见下面那条 🔴。
    ⚠️ 这条读数是**瞬时属性**（他们每分钟在落笔），下一个只读本地 `main` 的探针仍然会读到旧内容 ——
    引用 `main` 内容的判据一律用 `origin/main`。
    🔴 **但他们 pull 时会有一处冲突，且只有一处**：主检出 04 22:3x 现量 19 枚未提交路径里
    `AGENTS.md` 是 `M`（`git status --porcelain -- AGENTS.md` 命中），而本批这几笔正在改同一份的 §9。
    ⇒ 按 §8.5 第 4 条的既有做法处置：**台账类按行并列取并集，不改写他们的编号与措辞**，不 force、不重写历史。
    ⚠️ 上面那句"merge-tree 0 处冲突"**不含这一处** —— 它比的是**已提交的 4 笔**，而 `AGENTS.md` 的撞车面在
    **未提交的工作树**里。判"合流会不会冲突"要分这两层，只查已提交那一层会漏（这与本批第 1 条的
    "撞车判据 = 同一文件的未提交 diff"是同一条，只是反过来：它也会**反向**漏报"看着不冲突的那份其实脏着"）。
    ⚠️ **不代推他们那 4 笔**：把别人尚未公开的提交推上共享 `main`，会让他们的任何一次
    `amend`/rebase 变成只能 force push —— 那是硬边界（同 §8.5 早先那段的理由，未被推翻）。
