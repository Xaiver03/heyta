# 倒数纪念日（含农历、节日、纪念卡片）实施计划

> 状态：🔄 **批次一已落地**（2026-10-03，`a29881e9` 已合进 main）：W1 历法层 / W3「每年」预设 / W4 节假日随包数据 + bundle 体积闸门，落地记录与本批欠账见 **§3.5**。
> 🔴 **批次二进行中**（全部在本地分支，未 push 未 merge）：W0 / W2 / W5 / W10 已闭合，W9 落了 web 半，**原生投递那一半 20:1x 现量确认由另一条会话在主检出实现中（未提交，见 W9 节末）** —— 我 19:3x 那条"确认停批"只有四十分钟寿命；**L' 的判定表已出、命中那条已修，剩下的前置闸门已立成常驻门禁 `check:legal-permissions`（13 臂变异 13/13，见 §8.2 L' 第 1 条）**，W4b / W7 / W8 在并行工区里跑，**唯一一条完全没开工的是 W6**（撞车面的实测读数见 §8.2 开头；它的载体已确认与 W4b 的 `dayMarker` 是同一条缝）。逐项读数在 **§8.2 / §8.4**，本节这行原先写"⏸ 批次二未开工"，那是一句比正文更早写下、落地后没 sweep 的话 —— 同一份文档里这种"状态行跑在正文后面"的漂移已经出现过一次（见下面第 4 行那条 ADR 的教训）。⚠️ **这行本身现在又多了一条同族样本，而且形状不同**：19:3x 那次的状态行**不是**写早了，是**写对了再过期** —— 并行会话在半小时内把"停批"变成了"在实现"。⇒ 只要一条读数描述的是别人的在飞状态，它就必须在被引用时**重取**，不能被引用为"已确认"。
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

判据：**导出全程零网络请求**（Playwright 里数 request，按方法+路径比，别只看数量）。移动端渲染通道未取证 ⇒ 本单开工前先验 `react-native-svg` 能否出图，不能就把移动端登记为已知缺口而不是静默降级。

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

1. ✅ **mac 段 = 本会话自己跑的**（隔离检出，10:29–10:33）。读数：
   `窗口 1092x723、heyta-reinstall-mac-installed.png.webview.png 内容占比 73.0%、主蓝命中 1269 —— 是共享 UI`。
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

#### ⏹ W0b · 批次一遗留的三条登记缺口

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

#### ⏹ W2 · `EVENT` 实体（D1/D2 已拍）

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

#### ⏹ W6 · `EVENT` 成为日历的第二个事件源

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
- [ ] W6 完成 —— 🔴 **20:2x 逐文件现量：仍是撞车面，且这次量得出代价**
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

#### ⏹ W7 · 纪念卡片导出为成品图

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
  > 完整取证（含可复跑命令 [F6]/[F5]/[C]）在 `docs/plans/countdown-w7-device-export.md` §2 ——
  > 那份**住在 `feat/countdown-w7` 上、尚未进 main**，所以这里只点名不给链接（给了就是死链）。
- **判据**：导出全程**零网络请求** —— 复用 `e2e/tests/privacy-consent-zero-egress.spec.ts:79-95`
  （`page.on('request')` 分类器 + `page.on('websocket')`；`:16-30` 那条"零必须有非零正向对照"是承重的）
  与 `e2e/tests/inbox.spec.ts:231-234`（按 method+url 数）。
  ⚠️ 本文 §7 第 4 条要在这一单回答：Service Worker 拦掉的那部分算不算零 ⇒ 判据按"浏览器真发出去的"算，不按页面 `fetch` 调用数算。
- 🔴 移动端渲染通道**未取证**：开工前先验 RN 能不能出图；不能就把移动端登记成**已知缺口（带编号）**，不静默降级。
- [ ] W7 web 半完成 ／ [ ] W7 移动端出图或登记缺口

#### ⏹ W8 · 三端接线与门禁

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
- [ ] W8 完成

#### ⏹ W9 · 提醒：本批做"能响的那半截"，原生投递另立一单

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

#### ⏹ W10 · `EVENT` 进 AI 工具目录与 local-api 契约

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

#### ⏹ W4b · 调休/补班：运营录入 + 客户端拉取（第一条服务端→客户端内容通道）

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
  - ✅ ADR-0038 的回写**没有动它正文一个字**（`docs/adr/README.md` §1a 第 1 条），而是在文末追加
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
- [ ] 🟡 **W4b 代码链已闭合，只剩一条**（23:0x，`feat/countdown-batch2` 上 `6735cc39` + `b05fbc50` + `67fef701`）：
    服务端两张表 + 1 条迁移 + 线协议契约 + 后台三条端点 + ADR-0052 定性 + `check:public-facts`
    + **客户端匿名拉取 / `STORES.META` 缓存 / 装进领域层覆盖表 / web 日历的「休 / 班」/ i18n 中英**全部落地，
    判据①有真界面截图。**没做的那一条**：判据②写的是"`papers` 随数据入库并**在后台回显**"——
    入库与 API 回显有（`admin.routes.ts` 的 GET 带 `papers`），**后台界面没有**
    （`apps/web/src/features/admin/` 里没有调休面板、`admin-client.ts` 里也没有对应方法）
    ⇒ 运营者现在只能靠 curl 录入，这条通道对她还没真正可用。补齐并跑过判据之后这张表才打勾。

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
2. `node research/tools/docs-link-check.mjs` 带读数复核。
3. 界面结论必须有截图且人真的看过；验收不抢前台。
4. `pnpm reinstall:all` 四端装上当前产物（AGENTS §6.1.1）；真机验收排在最后，用私有现场。

### 8.4 进度勾选总表

| 工单 | 状态 | 依赖 | 判据数 | 完成读数（2026-10-03，分支见 §8.2 各勾） |
|---|---|---|---|---|
| W0 弹层上提 | ✅ | — | 3 | ui 448 passed + 变异 1 红 + e2e 注入红在"面板应在头像上方" + 3 张图已看 |
| W0b 遗留缺口 | 🟡 ①② | 台账需干净 | 3 | 16 文件路径/库名旋钮；harness 22 绿 0 红；③ 转投单写者文档待入 traps |
| W2 `EVENT` 实体 | ✅ | D1/D2 ✅ | 4 + 静默门禁人工勾 | 20/7/17/41/30 passed；`listEvents` 已进 READ_PATTERNS 且三腿验过能红 |
| W6 日历第二源 | ⏹ 排后 | W2 | 2 | 落点正被并行会话整片重写，**代价已量出来**（20:2x）：`calendar/model.ts` **+264/−7**（261→518 行，含一处 166 行整块插入）、`CalendarBoard.tsx` +107、`CalendarScreen.tsx` +153；关闭判据 = 那六个路径的 `git status --porcelain` 为空。HEAD 与他们的版本里 `grep -c 'EVENT'` **都是 0** ⇒ 没被别人做掉 |
| W5 卡片网格 | ✅ | W2、W0 | 5 | 12 passed + 12 例变异 0 未证 + 9 道门禁 rc=0；e2e **6 passed**（整族 15 passed）、三张图已看、看图照出"逾期卡没有日期行"并修成 `94760c82`，两腿变异各红一次 |
| W7 成品图导出 | 🔄 并行 | W5 | 2（含 RN 出图取证） | `heyta-wt-w7` 进行中，本表不代它主张读数 |
| W8 三端接线 | 🔄 并行 | W5/W6 | 3 | 🔴 原先这行写"排后：同 W6，日历线未落地前不动 `CalendarScreen`"—— **那是按整条线推断出来的，现量否证过**：W8 的落点在 main 里逐个文件都干净，且 web 半已随 W5 落地。现由 `heyta-wt-w8` 在跑（移动半 + 壳级门禁），读数它自己填，本表不代它主张 |
| W9 提醒（web 半 + DST） | ✅ web 半 | 可与 W2 并行 | 3 | 42/28/40 passed；变异 9 臂 9/9 红、0 未证；移动端那半**没动** |
| W10 AI 工具目录 | ✅ | **W2 之后** | 3 + 差集归零 | 130/223/1019 passed；变异**第一趟 3 臂无牙**→补判据→第二趟 6/6 红 |
| W4b 调休通道 + ADR | 🟡 **代码链闭合，剩后台面板** | 独立（1 条迁移） | 4 | ⚠️ 这行 20:4x 写的是"`heyta-wt-w4b` 已落 3 笔、迁移在写"，**23:0x 起过期**：迁移与两张表已提交（`3708d08c`）、服务端三条端点已并入 batch2（`2877dd37`）、**客户端拉取 + META 缓存 + web 日历「休/班」+ i18n 中英已落地**（`6735cc39`/`b05fbc50`/`67fef701`），判据①有真界面三档截图。剩：判据②的**后台界面**回显（API 层已有）。载体已从 `heyta-wt-w4b` 换到 `feat/countdown-batch2` |
| L' 法务联动 | 🟡 判定表已出 | 随最后一个改承诺的工单 | 4 | 普查 82 行 → **唯一真命中已修**（`2d53ea94` 条款补 4 行 + 版本 bump；`8996de9d` 新门禁四臂全红）。原写"3 文件正脏 ⇒ 现在改会盖掉别人"**被现量改写了**：脏的 6 个文件里恰好不含命中的那一份 |
| 收尾四项（§5） | ⏹ | 全部 | 4 | |
