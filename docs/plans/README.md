# 计划层索引 —— **当前状态只有一个入口**

> 🔴 **本文件是 `docs/plans/` 的唯一入口。** 想知道"现在做到哪了、下一步做什么"，**只看本文件指向的那一份**，不要在本目录里翻。
>
> 建立于 2026-09-28。建立原因：本目录曾有 **30 份 / 25,117 行**计划，其中"多端/桌面"一片就有 6 份 / 13,735 行，**同一个问题在不同文件里各有一个版本的答案** —— 这正是"看到很多功能却不知道做到哪了"的直接原因。

---

## 一、权威入口（按优先级）

| 我想知道 | 看这一份 | 说明 |
|---|---|---|
| **当前状态 / 下一步做什么** | [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) | 🔴 **唯一权威主计划**。它同时取代了 roadmap §5 与 4 份多端计划的路线部分 |
| **本轮 goal：设置的 IA（移动端优先 + 电脑端验证）** | [`goal-settings-ia.md`](goal-settings-ia.md) | ✅ 已完成。§7.1e 的执行 goal。主战场排序由产品负责人拍板：**移动端 + 电脑端，web 不是**；apps/web 的改动算电脑端的（macOS 壳加载共享 UI，`HeytaMacApp.swift:270`） |
| **本轮 goal：逐页排版对齐设计系统** | [`goal-layout-audit.md`](goal-layout-audit.md) | 🔴 进行中（2026-09-29 产品负责人重启）。四象限改 2×2 十字坐标系、AI 工具行重叠、macOS 标题条融入壳；逐页立**布局判据**（此前门禁只管"值从哪来"，不管"排版怎么排"） |
| **本轮 goal：时间线重做（P1 诚实 UI → P2 排期面）** | [`goal-timeline-rework.md`](goal-timeline-rework.md) | ✅ **已完成（P1 + P2，2026-10-02）**。P1：一根共轴、行=任务、条/点/未排期泳道三态降级（零 schema 改动，判据 8 条 + 变异三种）；P2：[ADR-0043](../adr/0043-timeline-p2-task-start-date-duration.md) 的字段 / `setSchedule` / 三态生产者 / 拖拽手势全落地，op 形状判据 + 绕过 dispatch 变异 + 真实拖拽 E2E `RESULT=OK`。证据：R-doc §5.4/§5.5 与 goal §8/§9。调研在 [`../research/timeline-view-deep-dive.md`](../research/timeline-view-deep-dive.md)。P3（打磨）登记进 roadmap |
| **本轮 goal：多端入口覆盖 · P0+P1 补齐** | [`goal-multi-end-coverage.md`](goal-multi-end-coverage.md) | 🔴 **进行中（批一、二、四 ✅；批三合法停批 2026-10-02）**。依据[多端入口覆盖审计](../research/multi-end-entry-coverage-audit.md)实施 3 条 P0 + 2 条 P1。批一：web 侧 due 事后编辑。批二：移动端通知中心 + 邀请活动（真机双账号真通知）。批四：移动端账号安全包（改密令牌轮换变异靶 **12绿1红** 精确命中 + passkey 管理空态；注册因移动端无 WebAuthn 桥登记排除）。批三停批：四个本地通知候选无一过门禁（goal §7 有解锁条件）。待做：批五备份还原（document-picker 依赖裁决先行）→ 收尾批（pnpm check + reinstall:all） |
| **看图看出的六条（勾选框缺半 / 没铺满 / 默认中文 / 时间线没有线 / 排序面板被裁 / 进度卡删）** | [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) | 🟡 进行中（2026-10-01 立，是上一行的续集）。**每条都要求先调研再动手**：R1 已定位到 `-(44-22)/2` 那行负外边距、且发现"44 触控区"从未实现；R2 已排除 Provider 多一层、收窄到 board 没有 `flex: 1`；R3 查清 `B-mac-*` 是 macOS 取证残留而非 fixture；R5 有实测 bounds（三个档位两个点不到）；**R6 已删**做事视图那张 `0/0` 进度卡（宿主接线整删、共享组件留给移动端成长页；e2e/单测翻成能失败的否定判据 + 注入反向对照），"数字放回滴答三个位置"并进 #10：侧栏两节计数已齐（per-tag 取数补进共享层，三层判据 + 变异），回收站计数判定为**不做**（参照图那列没有这一行），剩下的缺口是**清单归属只在 web 的行上**，见 §6.6。做序 R5→R1→R2→R3→R4 与理由在 §7 |
| **本轮 goal：帮助中心扩成 SSOS 式文档中心** | [`help-center-docs-expansion.md`](help-center-docs-expansion.md) | 🔴 进行中（2026-09-30）。**规格真身**：SSOS 八项结构对照（四项已有、四项缺口）、五个分类的内容配额、§4 正面能力（逐条带代码证据）与 §5 **25 条公开文案负面清单**、截图方式（复用 `scripts/screenshots/`，不新造流水线）＋图号与注入器约定、双语沿用现有 i18n 机制、门禁与共享工作树碰撞面 |
| **用户旅程与注册/登录放哪、每端怎么落** |  [`user-journey-and-auth.md`](user-journey-and-auth.md) | 🔴 **各端认证与旅程的唯一事实源**。含"前置"的定义与**为什么不做硬登录墙**、认证的 8 条真实形状（A1–A8，服务端语义与直觉不同）、逐端实施顺序 W0–W8、判据 J1–J7、以及 §10 **认证 UI 共享化的必做收口** |
| **邮箱 + 密码登录（第 3 条认证方法）** | [`email-password-auth.md`](email-password-auth.md) | 🟡 规划中（2026-10-01 立）。**是上一行的下游工单，不取代它** —— A1–A8 语义、宿主形态、J1–J7 仍以 `user-journey-and-auth.md` 为准。本篇只加"密码"这一条：5 条架构裁决（登录密码与 E2EE 口令**解耦**、Argon2id+pepper、令牌只存哈希、爆破禁用的是"密码认证器"而非账号、`tokenVersion` 全设备撤销）、线协议表、UI/UX 规范（含 **passkey 大按钮降级**）、W0 五个探针、本轮会撞红的 8 处既有断言。需新增 **ADR-0040** |
| **备案前要补哪些协议、文本住在哪、还缺什么** | [`legal-compliance-before-filing.md`](legal-compliance-before-filing.md) | 🔴 进行中（2026-10-01 立）。**一句话结论：工信部 APP 备案一个文本字段都不缺，缺文本卡的是备案之后的两道门**（隐私政策 URL 不是备案表单字段，要求它的是 PIPL + 四部门《认定方法》+ Apple 中国区提审）。九份对外文本的唯一事实源是 `packages/legal`（🔴 不在 i18n 里，理由见其 `src/types.ts`）；四条接线 / 缺口登记 G-01–G-20 在本文件 |
| **桌面 UI 走哪条机制、为什么** | 同上 §3.2 / §3.3 / §4.3 / §10-Q1 | 🔴 **2026-09-28 修订过**：由"原生壳 + 内嵌 WebView"改为 **RN 全端（`react-native-windows` 立即 + `react-native-macos` 等 0.84）**。依据是 [`../research/multi-platform-best-practice.md`](../research/multi-platform-best-practice.md)（补上了仓库此前缺失的联网检索） |
| 阶段总览（P0/P1/P2/P3 与 AI / 激励两条并行轨） | [`roadmap.md`](roadmap.md) | 保留为历史阶段账；**§5「下一步」以主计划为准** |
| 某个具体决策的**理由**（不可变） | [`../adr/`](../adr/README.md) | ADR 只增不改。⚠️ **ADR-0034 需重开**（其论证前提已被证伪，见主计划 §6.4-T4） |
| 某件事的**调研证据** | [`../research/`](../research/) | 证据在调研层，结论在 ADR / 主计划 |

---

## 二、主计划取代了什么（读旧文件前先看这一列）

| 文件 | 行数 | 状态 | 与主计划的关系 |
|---|---|---|---|
| [`multi-platform-adaptation.md`](multi-platform-adaptation.md) | 3,584 | 规划中 | 🟡 **判据仍有效**（M0/M1 已完成的结论、M3 的 A+B1–B7 判据、门禁 G1–G5）；**M2 的桌面路线被主计划 §3.3 修订**。剩余量数字（"8 个特性 / 11,100 行"）**已过期** |
| [`desktop-native-migration.md`](desktop-native-migration.md) | 398 | 规划中 | 🟡 **W0/W1 的实测结论保留**（跨语言通道、Jint/JSC 陷阱、编组开销）；**"UI 形态"被主计划 §4.3 取代** |
| [`phase-2-multi-platform.md`](phase-2-multi-platform.md) | 3,715 | ⚠️ 无有效状态行 | 🔴 **已被上面两份取代**，只作历史。⚠️ 其状态行是解不开的口令噪音，不是计划状态 |
| [`site-and-parity-alignment.md`](site-and-parity-alignment.md) | 1,739 | 规划中 | 🟡 **A 轨（站点）已交付**；**B 轨（能力 gap）按主计划 §5.5 重排** —— 原排序是 Web 优先的，与"Web 不是主战场"矛盾 |
| [`desktop-packaging-handoff.md`](desktop-packaging-handoff.md) | 307 | 已交付 | ✅ 三端安装包已交付且实测"装完能起来"；剩余空白见其 §4 |
| [`multi-end-unified-strategy-handoff.md`](multi-end-unified-strategy-handoff.md) | 257 | 交接 | 🔴 **主计划 ①–⑩ + G0/G4 全部做完并验证**；**唯一没绿的是 iOS 真机验收（34/9）**，根因已钉死（兜底凭据路径的自动化走不通）＋已排除的假设清单。**接手先读它 §5** |
| [`desktop-storage-host-handoff.md`](desktop-storage-host-handoff.md) | 246 | 交接 | 🟢 **A（macOS 定案 = M2）已完成**；**B 的 Windows 端已验到绿**（页侧 `STORAGE=shell` + 从壳外扫到载荷与 `ops` 表 + **重启之后还在**，证据在 `apps/desktop-windows/evidence/storage-host/`）。**默认开关已翻**；**macOS 的 WKWebView 接线也已完成**（真应用走壳 SQLite + 从壳外读到数据）。⚠️ **D 也已完成**；macOS 窗口门禁那条缺陷**已修**（判据改到 WebView 快照上）。**四件事 A/B/C/D 全部交付**；唯一待定的是**产品选择**（壳里主鉴权机制，不在四件事内）。**接手先读它 §6** |
| [`multi-end-unified-strategy-reflection.md`](multi-end-unified-strategy-reflection.md) | 49 | 复盘 | 🔴 **判断为何失效**：本轮 6 处「判据看起来在工作、其实什么都没判」（其中 4 处是我在修前一处时写出来的）+ 两次「查错对象」得出**反向结论** |
| [`waytofuture-handoff.md`](waytofuture-handoff.md) | 286 | 已交付 | ✅ **产品第一次跑在自己的域名上**（`heyta.waytofuture.cn` + API 专用 `apiheyta.waytofuture.cn`）；管理后台/邮件/凭据页全部中文化并用设计系统。**交还用户 3 件**（ICP 提交、两处预存在的红）见其 §3 |
| [`waytofuture-reflection.md`](waytofuture-reflection.md) | 120 | 复盘 | 🔴 **本轮 4 次判断失败**：打包覆盖生产 `.env`、脚本放 `<head>` 致按钮无反应（用户报障）、脱敏正则漏匹配、发明的阈值两次误报。四者共同点：**验的是"我产出的中间物"，不是"用户走的那条路径"** |
| [`gate-blindspot-handoff.md`](gate-blindspot-handoff.md) | 224 | 交接 | 🟢 **已闭合**（本轮四项交付全部处理完）。`check:docs` 的"CI 上永远红"死角有 **5 条端到端注入证据**（§3），门禁代码已提交推送。**本文件转成历史**：它原先写着"注入验证与提交留给下一会话"，而那句已经过期（§开头有更正说明）；§7 还更正了本文件自己的一条**归档归属错误**（"非空白/主蓝"那条一直只在 `AGENTS.md` 里、从没进过 traps 文件），由此牵出的 **§7 编号歧义死角**已登记在 [`BLOCKED.md`](../../BLOCKED.md) §5 等裁决。只剩两件**要用户本人**的环境动作（屏幕录制权限、Windows 打包机），见它 §4 |
| [`multi-platform-widgets.md`](multi-platform-widgets.md) | 373 | 规划中 | 🟢 **仍是小组件线的入口**（与主计划正交） |
| [`multi-platform-widgets-progress.md`](multi-platform-widgets-progress.md) | 5,463 | 实施中 | 🟢 **是进度日志，不是计划**。体量最大，按需查、不要通读 |

---

## 三、已完成 —— 只作历史，**不要照它再开工**

| 文件 | 完成依据 |
|---|---|
| [`phase-1-single-client-loop.md`](phase-1-single-client-loop.md) | `pnpm verify:p1` 11 条零 mock E2E 通过 |
| [`activity-categories-and-colors.md`](activity-categories-and-colors.md) | 已并入 `main`（`84cc7f5` / `38cf3a5`） |
| [`motivation-and-progression.md`](motivation-and-progression.md) | L1/L2/L3 三层已实现并并入 `main` |
| [`ai-remediation-module-1-engine.md`](ai-remediation-module-1-engine.md) | ✅ 已执行（文件自己写着"不要再照这份任务书做一遍"） |
| [`ai-remediation-module-2-journey.md`](ai-remediation-module-2-journey.md) | 已并入 `main`（`0614475`） |
| [`ai-remediation-module-3-memory-moat.md`](ai-remediation-module-3-memory-moat.md) | 已并入 `main`（`73b13b2`） |
| [`ai-gap-audit-and-remediation.md`](ai-gap-audit-and-remediation.md) | 三个整改模块均已并入 `main` |
| [`ai-open-decisions.md`](ai-open-decisions.md) | 已决策 |
| [`ai-tool-calling.md`](ai-tool-calling.md) | 🟢 P0–P2 已落地（P3–P4 未开工，见该文件） |
| [`ai-remediation-parallel-runbook.md`](ai-remediation-parallel-runbook.md) | 已落地（`scripts/check-module-boundaries.mjs` 是它的可执行版本） |

---

## 四、AI 线（活跃）

| 文件 | 说明 |
|---|---|
| [`ai-strategy.md`](ai-strategy.md) | 策略入口（被引用最多的一份，13 处）。🔴 **§8 那张"下一步"表已过期**：第 3、4 行（捕获解析、拆解）在 §7.1 里自己标了已完成，只有第 5 行"agent 多步自主 / Pi / 仅桌面"仍有效 |
| [`ai-assistant-closure.md`](ai-assistant-closure.md) | **W1–W4、W7–W9、W12 已落地**（2026-10-03）：AI 能力面补齐的**执行工单**（W1–W14，缺口编号 `AI-G*`）。🔴 它是 `ai-strategy.md` §8 信任阶梯的拆解，**不是第二份策略** —— 冲突时以 `ai-strategy.md` 为准。⚠️ 原文那句"W8+ 挂在三处待决（D-1 / D-1a / D-2）"**已过期**：三处都由产品负责人 2026-10-02–03 拍板（聊天外壳与"末尾一次写提案"放行、授权粒度改成助手侧独立档位、`EVENT` 与 AI 工具同批），逐条状态与**还剩什么**（W5 / W10 / W11 + 四条登记缺口）在它的 §7 与 §7.2。证据在 [`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md) |
| [`ai-event-tool-contract.md`](ai-event-tool-contract.md) | **设计已定，实现待两头合流**（2026-10-03）：倒数日 `EVENT` 的 **AI 工具契约**（D-3 拍板"实体与工具同批"的落点）。定死读 2 / 写 4 个工具、每工具的 `egressFields`、三项刻意不进 AI 的字段及理由、农历的分工（模型不许换算），以及**覆盖面分母的准入判据**（"有用户能填或能按的编辑面"）—— 顺带纠正两处口径：`covered` 从"有任一工具"改成"读写都有"、`FOCUS_SESSION` 移出分母 ⇒ 对外说过的 `2/8` 两个数都是错的，现状是 **1/7**。🔴 编号消歧：本文称覆盖面门禁为 `AI-COV`，因为闭环计划与倒数日计划**各有一个 W10 且是同一件事** |
| [`ai-capability-branches.md`](ai-capability-branches.md) | 能力分支与开发分支策略 |
| [`ai-memory-system.md`](ai-memory-system.md) | 记忆系统 |
| [`ai-tier-pricing-rollout.md`](ai-tier-pricing-rollout.md) | 分档与定价 |
| [`ai-handoff.md`](ai-handoff.md) | 交接（⚠️ 无状态行） |

> 🔴 **两份 AI 审计回答的是两个不同问题，别混**：
> [`ai-feature-completeness-audit.md`](../research/ai-feature-completeness-audit.md)（2026-09-30）问的是
> "**已声明的 AI 功能做完了吗**"（答：本地模式代码层完整）；
> [`dida-ai-assistant-gap-analysis.md`](../research/dida-ai-assistant-gap-analysis.md)（2026-10-02）问的是
> "**用户能使唤 AI 干活吗、和滴答助手差在哪**"（答：今天连不上，且多步被架构锁死）。
> 后者对前者追加了 §8 勘误 —— 包括一条会**把工作量估错方向**的误判（那 3 个需要 `entityId` 的工具
> **已经写好了**，缺的是让它们可达的多步循环，不是再写一遍）。

---

## 五、订阅 / 计费（一簇，**状态只有一处**）

| 文件 | 说明 |
|---|---|
| [`subscription-boundary.md`](subscription-boundary.md) | 产品决定（PM 定稿，待实施） |
| [`subscription-provider-selection.md`](subscription-provider-selection.md) | 选型结论 |
| [`subscription-integration.md`](subscription-integration.md) | 只读调研结论 |
| [`pricing-coupons-handoff.md`](pricing-coupons-handoff.md) | 定价与优惠券 |
| [`subscription-handoff.md`](subscription-handoff.md) / [`subscription-wechat-handoff.md`](subscription-wechat-handoff.md) | 交接 |
| [`notification-and-activity.md`](notification-and-activity.md) | ✅ **已完成**（2026-09-29）：通知中心 + 活动（邀请好友得会员）。🔴 它同时把权益判定从"最新一行"改成"多个来源取并集" —— 那条是邀请奖励能安全上线的前提（否则奖励行会盖掉用户已付的时长，且不报错） |
| [`admin-console.md`](admin-console.md) | ✅ **已完成（首版）**（2026-09-30）：运营管理后台。**抄 SSOS 的模式、不抄它的页面** —— 它那 42 个页面服务的是租户/税务/合规/Mailu，heyta 一个对应模型都没有。范围＝用户/订阅/订单/优惠码/邀请 + 三个不碰钱的支持动作；权限＝单级 `users.is_admin`（默认 false，只能由 CLI 授权）。决策见 [ADR-0038](../adr/0038-admin-console-scope.md) |

> 🔴 **微信支付已按用户指示搁置**（卡点在商户号 KYC，是**外部**流程，不是代码）。
> 状态登记在 [`roadmap.md`](roadmap.md) §5 那一节，**不要在别处再开一份待办**。

---

## 六、其他

| 文件 | 状态 |
|---|---|
| [`i18n-multilingual.md`](i18n-multilingual.md) | 进行中 |
| [`countdown-anniversary.md`](countdown-anniversary.md) | **规划中 → 可开工**（2026-10-03）：倒数纪念日（农历生日 / 传统节日 / 卡片式倒计时 / 钉住与归档 / 纪念卡片导出）。决策已定 = [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md)（`EVENT` 实体 / 农历走 `lunar-typescript` / 节假日三档分发 / 图片双档）。🔴 两道前置闸门：bundle 体积实测、服务端先于客户端的部署顺序。它同时**推翻**了 [`goal-layout-audit.md`](goal-layout-audit.md) §4 里"节日标注无数据源 ⇒ 不做"那条判断的理由（勘误已追加在原处） |

---

## 七、本目录的纪律（新增文件前先读）

1. **不要新建"同一件事的第二份计划"。** 先在本文件里找，找不到再看 `roadmap.md`，仍找不到才新建 —— 并在本文件登记。
2. **状态行是硬要求**（`docs/README.md` §三）。⚠️ **已有 7 份缺状态行或状态行是噪音**（见上表"无状态行"标注）—— 这是遗留债，修的时候顺手清掉。
3. **不写相对时间**（"最后提交 09-27"这类会立刻腐烂；`desktop-native-migration.md` §10.3 自己已写明这一点）。
4. **不引用行号** 作为定位手段 —— 实测：一次编辑就能让全部行号偏移。引用**小节标题**。
5. 新增/移动文件后跑 `node research/tools/docs-link-check.mjs`。
   ⚠️ **物理归档前必须知道**：本目录原有的 30 份文件中 **零引用的有 0 份**，25 份被 ≥3 个文件引用 —— 移动会打断约 150 处跨文档引用。**所以本文件选择"单一入口 + 权威标注"而不是批量移动文件。**

---

*本索引不记录进度数字 —— 那些会腐烂。进度只有一个来源：[`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) 与 [`roadmap.md`](roadmap.md)。*