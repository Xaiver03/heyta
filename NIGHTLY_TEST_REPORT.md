# 夜间补测报告 — heyta 仓库（2026-11-23 凌晨）

- 工作区：隔离 git worktree `.worktrees/nightly-qa`
- 隔离分支：`test/nightly-qa-20261123`（从 `7826539f` 切出；**未推送、未合并、未部署**）
- 本仓为高度活跃的多 Agent 并发仓库：开工期间观测到主工作树 `feat/app-auto-update` 上另一会话连续提交（`877efc31 batch4` 等在本次会话期间落地），因此全程在**独立 worktree** 内作业，未触碰主检出。
- 新增：**5 个测试文件、85 个测试、+813 行**，全部位于各包 `tests/*.spec.ts`。
- 回归：改动涉及的四包**全量测试全绿**（local-api 334 / inbound-core 62 / shared-schema 210 / app-host 2432，合计 3038 全通过）。

---

## 1. 实际新增测试清单

> 每个测试一行：目标 · 风险信号（A变更/B历史失败/C复杂度/D覆盖缺口/E隐含契约）· 意在捕获的故障类型。
> 所有列出的断言都做过**变异自查**：把被测实现改坏后该条会红（证据见各节末「变异验证」）。

### 1.1 `packages/local-api/tests/shared-validators.spec.ts` — 26 tests
目标：`tools/shared.ts` 的解析/校验器（**扇入全部 65 个工具**，且被最新 batch4 的 `habit-log.ts` 消费）。信号：D（此前 0 个测试文件直接引用）+ A（shared.ts 近 10 天改 6 次）+ C + E。

| 测试 | 捕获的故障 |
|---|---|
| clampListLimit 普通正整数/0 量纲不变 | 合法 limit 被错误改写 |
| clampListLimit 超过 500 收到 500 | 删掉上界 → 一次读走无上界条数（上下文/出境量爆炸） |
| clampListLimit 小数向下取整 | 删掉 floor → 非整数 limit 下发 |
| clampListLimit 负数/NaN/Infinity/非数字回退默认 | 放宽 typeof/isFinite → 脏 limit 进入出境 |
| clampListLimit 回退值可被第二参覆盖 | fallback 透传丢失 |
| parseCalendarDay 规范形→三字段 | 基础解析 |
| parseCalendarDay 越界月/日拒（13 月、4-31、2-30）| 删回读校验 → Date.UTC 自动进位、静默筛错一天 |
| parseCalendarDay 闰年边界（2026 无 2-29 / 2024 有）| 把校验降级成"看格式" |
| parseCalendarDay 必须补零 | 放宽正则接受 `2026-1-5` |
| parseCalendarDay 非字符串/空串→undefined | 删 typeof 守卫 |
| calendarDaysBetween 正/负/零、跨月、闰年 | 日序数算错/本地时区污染 |
| readListTasksDueArgs 三键都不给→不筛 | 把"不筛"误当错误 |
| readListTasksDueArgs 只给 dueOn→按天筛 | — |
| readListTasksDueArgs 跨度含两端 14 过/15 拒 | 删 forward+1 或改 `>`→`>=` → 越界范围放行（ADR-0045 出境上界） |
| readListTasksDueArgs 只给一端→拒 | 把半开区间当开区间（无上界） |
| readListTasksDueArgs dueOn 与区间互斥 | 组合规则失效 |
| readListTasksDueArgs dueFrom 晚于 dueTo→拒 | 顺序校验丢失 |
| readListTasksDueArgs 非法的一天→拒且点名键+原串 | 静默忽略非法日期→返回全量前 N 条 |
| readListTasksDueArgs 非字符串只报类型 | 把对象内部结构带进错误消息 |
| parseTimeOfDay 规范 HH:MM→时/分 | — |
| parseTimeOfDay 首尾空白 trim | — |
| parseTimeOfDay 必须两位补零（9:5/9:05/09:5 拒）| 工具收下宿主算不出的时刻 |
| parseTimeOfDay 越界 24:00/23:60 拒 | 删 >23/>59 判断 |
| parseTimeOfDay 非字符串/多余字符→undefined | — |
| maxToolsPerEntity 已登记实体取覆盖值 | 预算表漂移 |
| maxToolsPerEntity 未登记实体回落默认 | 删 `??` → 返回 undefined → NaN 比较 |

变异验证：`raw<0→<-1`、`span>14→>=14`、去掉 `>23||>59` 三处分别精确杀死对应条；还原后 `git diff` 为空、26 绿。

### 1.2 `packages/inbound-core/tests/entitlement-contract.spec.ts` — 15 tests
目标：`entitlement-contract.ts`（签发侧/消费侧共用的**权限票据**契约；两个判定函数此前 0 直测）。信号：E（权限边界）+ D。

| 测试 | 捕获的故障 |
|---|---|
| rule 档：带 ruleId 不带 eventId→相符 | — |
| rule 档：缺 ruleId→RULE_SCOPE_MISSING | 越权放行 |
| rule 档：同时带 eventId 也不算相符 | 放宽成"带了就行" |
| event 档：带 eventId 不带 ruleId→相符 | — |
| event 档：缺 eventId→EVENT_SCOPE_MISSING | 越权放行 |
| event 档：同时带 ruleId 也不算相符 | — |
| none 档：两者都不带→相符 | — |
| none 档：带任一→SCOPE_NOT_ALLOWED | 把 none 当"随便" |
| 三个等待码（LINK_NOT_BOUND/ISSUER_NOT_CONFIGURED/NOT_ON_THIS_INSTANCE）→true | 该停的重试无限打 |
| 缺陷码（SCOPE_MISMATCH/ACTIVATION_INVALID/MANIFEST_INVALID/ACTION_UNKNOWN）→false | 用户对着真 bug 一直等 |
| 未知/空串→false | 判据写成"以 AUTOMATION_ 开头" |
| 每个动作都登记作用域且无多余项 | 词表漂移（客户端以为有权、服务端判无权） |
| 作用域只取 none/rule/event | 越界作用域 |
| session 必须 none 且不在取票通道 | 一次登录换一张通用通行证 |
| 等待族每个码都在 issuer denials 里 | 打字错一个字母 |

变异验证：去 rule 档 `eventId===undefined`、等待族改 `startsWith('AUTOMATION_')`、取票通道不去掉 session，三处各精确杀死对应条；还原干净、15 绿。

### 1.3 `packages/app-host/tests/ai-settings-store.spec.ts` — 16 tests
目标：`ai-settings-store.ts`（AI 设置的持久化语义——**四道闸是否关得上**；`parseAiSettingsState`/`createAiSettingsStore` 此前 0 直测）。信号：E（fail-closed 隐私/配置安全）+ A + D。

| 测试 | 捕获的故障 |
|---|---|
| parse undefined→出厂默认（四道闸全关） | — |
| parse 坏 JSON→默认值不抛 | 存储坏了变成应用起不来 |
| parse 顶层非对象（123/null/"x"）→默认 | — |
| 布尔闸真值非 true（"true"/1/"yes"）一律算关 | `===true` 改成真值判断 → 闸静默没关上 |
| 逐字 true 才真的打开（阳性对照） | 防"永远返回关"的假绿 |
| bindAddress=0.0.0.0 被无视、回落回环 | 读存储 bindAddress → 把本机服务暴露到局域网 |
| 端口必须整数（小数/字符串→回落） | 删 isInteger |
| token 空串丢弃/非空保留 | — |
| 端点缺字段/非对象被丢弃 | 保留脏端点 → "AI 时好时坏" |
| 路由只认词表内功能键、空链丢弃 | 词表外路由占位成"有效记录" |
| mode 保留（managed 原样 / off→own） | 2026-11-21 回归：丢 mode 让托管账号没路由 |
| 健康快照坏值不抛、版本回落 | — |
| store.load 读通道并同规则清洗 | — |
| store.save 落盘前再清洗（脏 state 写出去也干净） | 删二次清洗 → 磁盘出现脏值/两端权限不一致 |
| store.save 如实返回：write false→false；write 抛→false 不冒泡 | 静默假装存成功 |
| store.reset 写回出厂默认 | — |

变异验证：`enabled===true→Boolean(enabled)`、bindAddress 改读存储、save 去二次清洗，各精确杀死对应条（bindAddress 那处同时杀两条）；还原干净、16 绿。

### 1.4 `packages/app-host/tests/ai-route-target.spec.ts` — 9 tests
目标：`ai-route-target.ts`（`pickNoCandidateReason` / `resolveAiRoute`，此前 0 直测；正例用**真实 `resolveRoute`** 驱动，不 mock 被测单元）。信号：E（披露与实际一致）+ C + D。

| 测试 | 捕获的故障 |
|---|---|
| unconfigured 优先于任何排除原因 | — |
| remote-not-allowed 排最前 | 优先级重排 → 用户去改一条根本没被检查的配置 |
| 其余优先级：capability-missing>endpoint-disabled>endpoint-url-rejected>circuit-open>endpoint-missing | 优先级链任何重排 |
| 既没配也没排除记录→unknown | 编造原因 |
| 没配路由→target 无、unconfigured | — |
| 唯一候选→字段齐全、isLocal=true、destination=none、无回退 | 目标字段算错 |
| 两个候选→target 是第 0 个、第二个进 fallbacks | 取错候选（披露说 A 实际发 B）/ 丢回退链 |
| 远端端点+allowRemote:false→remote-not-allowed | 远程闸失效 |
| 候选指向不存在端点→endpoint-missing | — |

变异验证：优先级重排（remote-not-allowed 挪后）、取末个候选、去掉回退链，各精确杀死对应条；还原干净、9 绿。
（过程发现：`http://` 远程端点会先被 URL 校验判 `endpoint-url-rejected`，改用 `https://` 才走到 `remote-not-allowed`——已按真实行为修正用例。）

### 1.5 `packages/shared-schema/tests/account-profile-contract.spec.ts` — 19 tests
目标：`account-profile-contract.ts` 的**服务端裁决 schema**（`account-avatar-plan.spec.ts` 只覆盖了客户端那半；这半 0 直测）。信号：E（输入校验/上传安全）+ D。

| 测试 | 捕获的故障 |
|---|---|
| 昵称返回 trim 后值 | — |
| 昵称全空白/空串拒 | 漏 trim 或 min(1) |
| 昵称上限按码点：20 emoji 通过（.length 为 40） | 用 `.length` → emoji 昵称凭空少一半额度 |
| 昵称 32 码点过/33 拒 | 阈值 off-by-one |
| displayName: null→通过且为 null（清除） | — |
| displayName: ""/空白→拒 | 把空串当"清除"→删光字母点保存也成功 |
| 缺 displayName 键→拒 | nullable 误当 optional（"不传"与"清除"混为一谈） |
| 合法昵称通过 | — |
| parseAvatarPayload 坏 JSON→null 不抛 | 界面抛 Unexpected token |
| parseAvatarPayload 数组/null→null | — |
| parseAvatarPayload 白名单外类型→null | — |
| parseAvatarPayload 缺/空 dataBase64→null | — |
| parseAvatarPayload 合法→对象 | — |
| avatarUpdateSchema 合法小图通过 | — |
| avatarUpdateSchema 非标准 base64 拒 | 删 regex → 解码静默丢字符、字节数与落库不一致 |
| avatarUpdateSchema 长度非 4 倍数拒 | 删 %4 校验 |
| avatarUpdateSchema 解码超原图上限（512KiB）拒 | 删 source 上限 → 超大图入库 |
| avatarUpdateSchema 超上传体上限拒 | 超大上传体 |
| avatarUpdateSchema contentType 非白名单拒 | — |

变异验证：码点计数改 `.length`、去 trim、去 base64 正则、去 source 上限，各精确杀死对应条；还原干净、19 绿。

---

## 2. 拒绝 / 未执行的目标（评估后放弃，及原因）

均因**已有充分测试覆盖**而放弃（"覆盖缺口"信号单独不足以入选，需要与 A/B/C/E 叠加；这些目标已被专测钉死，重复补测属于装饰品）：

| 候选 | 评估结论 |
|---|---|
| `domain/habit-streak.ts`（computeStreak / computeHabitPeriodStats / isScheduledOn）| 被 `domain.spec.ts` + `habit-period-stats.spec.ts` + `habit-amount.spec.ts` + `habit-actions.spec.ts` 大量覆盖（含"今天没打不断连""非每日频率""补卡上限"等边界）。放弃。 |
| `domain/quadrant.ts`（classify/isUrgent/bucket/planQuadrantDrop）| 被 `domain.spec.ts`（四象限×三种截止状态穷举、拖放落点）、`task-fifth-state.spec.ts`、`app-host/actions.spec.ts` 覆盖。放弃。 |
| `domain/calendar-drop.ts` | `calendar-drop.spec.ts` 已覆盖 date-only/time 搬运/no-op/非法落点/跨天不可拖/日档小时档边界。放弃。 |
| `domain/today-progress / weekly-review / milestones / activity totals` | `motivation.spec.ts` 逐条覆盖（含"计划外完成计入""进度封顶""跨零点""老 payload 缺 completed"等）。放弃。 |
| `ai/image-limits.ts`（fitWithinPixels/base64/planImageRequest）| `image-input.spec.ts` 覆盖全部函数。放弃。 |
| `ai/supply.ts`（classifyDestination/requiresEgressConsent/披露）| `egress.spec.ts` / `managed-allowlist.spec.ts` / `disclosure-shape.spec.ts` 覆盖。放弃。 |
| `local-api` 隐私投影 `projectForTool/projectListForTool/readItemForTool` | `tool-egress-fields.spec.ts` 覆盖（含"去掉 projectListForTool 即红"）。放弃。 |
| `local-api tools-risk`（危害分级）| `tools-risk.spec.ts` 覆盖（含破坏性工具清单白名单、禁 irreversible）。放弃。 |
| `domain/feature-modules`（isFeatureModuleKey）| `apps/mobile/tests/feature-entries.spec.ts` 覆盖。放弃。 |
| batch4 新增工具（task/habit-log 等）| 已随 `877efc31` 提交 `task-tools-batch4/habit-tools-batch4/local-api-host-batch4.spec.ts`。放弃。 |
| `account-avatar-plan`（客户端那半：base64DecodedBytes/planAvatarUpload/isAvatarContentType/avatarInitialFromEmail/avatarDataUri）| `account-avatar-plan.spec.ts` 已覆盖；本报告只补服务端裁决那半。 |

**需生产代码改动才能测、按红线未做**：无。未发现需要新增 seam 的目标。

---

## 3. BLOCKED 清单

无硬性 BLOCKED（5 个目标全部写成并通过）。环境性注意（供下次夜间任务参考，非阻塞）：

- **app-host 测试需先构建工作区依赖的 dist**：`ai-settings-store` / `ai-route-target` 规格通过 `@heyta/ai`、`@heyta/local-api` 的包入口导入，而干净 worktree 没有 `dist`。本次用 `pnpm --filter "@heyta/app-host^..." build`（离线、exit 0）解决。若某次无法构建，这两组会报 `Failed to resolve entry for package "@heyta/ai"`——此时的做法是先构建依赖链，**不要**为了绕开去改测试导入内部源码路径。
- **未执行**（非阻塞、按预算取舍）：GUI/Playwright 验收、`pnpm -r test` 全仓跑。本次对改动四包做了全量单测 + 四包 typecheck。
- **typecheck 现状（如实）**：`local-api` / `inbound-core` / `shared-schema` 三包 `tsc --noEmit` **干净**。`app-host` 的 spec typecheck 存在**沿用既有测试文件**的类型错误（`agent-harness.spec.ts` / `ai-routed-model.spec.ts` / `assistant-sessions.spec.ts` / `local-api-host-lifecycle.spec.ts` / `task-activity.spec.ts`：其中 `task-activity.spec.ts` 的 `Cannot find module '@heyta/app-host'` 是 dist 未构建所致）。这些**均不在本次新增的两个 spec 里**（`ai-settings-store.spec.ts` / `ai-route-target.spec.ts` 未出现在错误列表中），属既有债务，非本次引入。

---

## 4. 可疑发现（待人工确认，未自行修复）

1. **`accountAvatarUpdateSchema` 的"上传体上限"是一道不可观测的冗余防线。**
   `dataBase64.length <= 1 MiB` 这条 refine，被更严的"原图上限"（解码后 ≤ 512KiB ⇒ base64 长度 ≤ ~699,051）**完全蕴含**：任何能通过原图上限的输入必然也满足上传体上限。变异自查实测：单独把上传体上限 refine 改成 `true`，本组 19 条**仍全绿**——即该分支在生产里永远不会是第一个拒绝点。
   对照 `ai/image-limits.ts` 刻意让"两张合起来超总额"可达（注释明写"有测试打这条"），这里是相反的情形。**这不是缺陷**（保留无害，理论上可防超大串在解码前被早期拦截，但 `base64DecodedBytes` 是 O(1)，没有实际收益）。**待确认**：保留并在注释里说明"冗余/被 source 上限蕴含"，还是删除以免读者误以为有两道独立闸。已如实只写"超上限被拒"的断言，未声称能独立杀死该 refine。

（其余疑点均已排除：例如 `sanitizeLocalApi` 对 `grants` 直接透传，看似可被配置篡改放大授权，但下游 `isToolGranted` 用 `grants?.[name] === true` 严格判定，非布尔真值不会授权——已核实，不构成缺陷。）

---

## 5. 停止原因与预算消耗

- **预算**：约 **85 次工具调用**，墙钟约 **1.5 小时**（00:25 → 01:5x）。
- **停止原因**：完成 5 个高乘积目标并逐一变异验证 + 四包全量回归后，继续在已覆盖的目标上补测属装饰品（违反第 2 节铁律）；同时未触发"同一失败区连续 3 轮"或"想删/放宽测试"的停止信号。按"最小测试覆盖最大真实风险"原则收尾，并如实列出被拒目标。
- 5 个提交均可回滚（见下）；即使进程被截断，已提交测试不丢。

---

## 6. 红线自查

- ✅ **没有删除任何已有测试**：`git diff 7826539f..HEAD` 仅 5 个新增 `*.spec.ts`，无删除、无修改既有测试行。
- ✅ **没有削弱断言**：全部为精确断言（`toBe/toEqual/toBeUndefined/…` 与精确错误码/消息片段），未使用 `toBeTruthy/assertNotNull` 之类兜底。
- ✅ **没有修改生产代码**：5 个提交全部是 `tests/` 下新增文件；变异自查时临时改坏的生产文件均已从 git 还原（`git diff` 为空、复跑全绿）。
- ✅ **没有触碰 golden tests / 契约测试**：既有 `*.spec.ts` 一律未改；`shared-schema` 只新增测试，未改任何 `-contract` 源码。
- ✅ **所有改动在隔离分支**：分支 `test/nightly-qa-20261123`（独立 worktree），未推送、未合并、未部署。

### 提交清单（隔离分支 `test/nightly-qa-20261123`）
```
428ed91b test(shared-schema): account-profile 服务端裁决 schema — 0直测+输入校验/安全(E/D) — 杀 昵称码点改.length、去trim、空串当清除、头像base64去正则/%4/source上限 的 mutant
811bafec test(app-host): ai-route-target 披露一致性 — 0直测+披露/产品优先级(E/C/D) — 杀 排除原因优先级重排、取末个候选、丢回退链 的 mutant
7e93dc57 test(app-host): ai-settings-store 隐私闸 fail-closed — 0直测+隐私/配置安全(E/A/D) — 杀 enabled只认true、bindAddress读存储、端口非整数放行、save去二次清洗、丢mode 的 mutant
64586ffa test(inbound-core): entitlement-contract 权限边界 — 0直测+权限不变量(E/D) — 杀 作用域档放宽(rule/event/none)、等待族误并缺陷码、session 混入逐次取票通道、词表漂移 的 mutant
2faa998d test(local-api): shared.ts 解析/校验器 — 0直测+扇入全工具(D/C/E) — 杀 clamp 上界/负数回退、日期存在性(2-30/闰年)、14天跨度含两端/单端拒绝、HH:MM补零与越界的 mutant
```
