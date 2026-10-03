# 倒数纪念日（含农历、节日、纪念卡片）实施计划

> 状态：🔄 **批次一已落地**（2026-10-03，`a29881e9` 已合进 main）：W1 历法层 / W3「每年」预设 / W4 节假日随包数据 + bundle 体积闸门，落地记录与本批欠账见 **§3.5**。⏸ 批次二未开工：W0 界面、W2 `EVENT` 实体（🔴 有"服务端先于客户端"的部署顺序硬约束，见 §3 W2）、W5–W9、W4b、L 系列。
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

1. **W3 的"真机/真服务端 yearly 断言"**（本工单原本要求补的那条）—— 收口时已**写成 `scripts/verify-mobile-repeat.sh` 的第 15 步**，但它**还没在设备上跑过**，所以这条不能记成"已交付"：
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
5. **W0 / W2 / W5 / W6 / W7 / W8 / W9 / W10、W4b、L 系列**：按排期未开工。W2 未动 = `shared-schema`、服务端、迁移一个字节都没改（批次二的部署顺序风险留在那里处理）。

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
3. 🔴 **仍欠的一件：W3「每年」的真机那一趟**（脚本第 15 步已落地并离线验过：`bash -n` 0、
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
   📌 **谁手里**：设备与 compose 栈在并行会话手里；两条收尾等窗口：① 本节第 15 步那一趟；
   ② 台账 #181（取号以当时现量为准，见下）从我这里搬进 `docs/reference/environment-traps.md`（台账此刻 `M`，见下面一节）。
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

### 待入 §7 的一条（**正文写好了，先落在这里**：台账此刻被并行会话写脏）

为什么不当场追加：`git status --porcelain -- docs/reference/environment-traps.md` 现在输出 `M`，
工作树末号已到 **179**（`grep -nE '^[0-9]+\. ' … | tail -1`）。在一棵正被别人改的共享树上
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
