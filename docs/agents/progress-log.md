<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「当前进度」的完整规则（原文 §9 当前进度）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 9. 当前进度

| 阶段 | 状态 |
|---|---|
| P0 奠基 | ✅ 已完成（协议已跑通，Docker 实测通过） |
| P1 单端闭环 | ✅ **已完成**。**冲突解决闭环已实测跑通**：`pnpm verify:p1` 自带真实服务端跑 11 条零 mock E2E，含"真实点击 `ConflictDialog` → 双端收敛"两条（`keep-local` / `keep-remote` 各一）→ [`详细计划`](../../docs/plans/archive/phase-1-single-client-loop.md) |
| P2 多端补齐 | 🔄 **进行中**（**外壳 IA：rail = 任务/日历/四象限/习惯/时间线/搜索 + 回收站 + 头像（设置/统计/退出登录）+ 帮助** —— 功能模块开关（默认关掉番茄钟/成长/便签，关掉的**不进 DOM**）、共享 `CalendarBoard`（web 此前**一个日历都没有**）、共享 `SearchPanel`（便签此前**没有任何搜索入口**）、提醒的**投递路径**（`due` 早算好了但没人读，全仓一个 `new Notification(` 都没有）、实时同步在 web 的接线（`realtime.ts` 450 行 + 自带测试齐全，而**没有任何宿主 `createRealtimeClient()`**）；13 项幻觉复核 **12 项已修 / 1 项外部阻塞** ✅ / 存储契约 ✅ / SQLite ✅ / token 生成器 ✅ / **RN token 产物（含暗色合并 + 类型安全）** ✅ / **ArkTS 产物真编译器验证** ✅ / **RNOH 依赖链实测打通** ✅ / 非 Web 宿主 ✅ / **移动壳（Android 实机跑通）** ✅ / **移动端任务可编辑 + 冲突解决闭环 + 专注闭环 + 日历 + 重复任务（真模拟器零 mock E2E：`pnpm verify:mobile-edit`、`pnpm verify:mobile-conflict`、`pnpm verify:mobile-focus`、`pnpm verify:mobile-calendar`、`pnpm verify:mobile-repeat`、**`pnpm verify:mobile-autosync`（全程不点任何同步按钮，写入也必须自己出去；变异：拿掉写入信号 ⇒ 3 红）**）** ✅ / ✅ **自动同步（前台 + 本地写入去抖）**：此前同步**只能靠手点** —— 建完任务数据一直躺在本地，而界面全绿。核心/平台两层拆分（纯决策逻辑 16 条单测 + 变异验证），三个并发陷阱逐个处理（代际计数防丢写、失败退避防热循环、`ready()` 必须地址与令牌同时具备）；**§7 第 66/67/68 条**，计划 §3.27 ✅ / ✅ **顺手修掉两条陈旧判据**（是自动同步**当场**把它们照出来的）：① `verify-mobile-focus` 的 **delta 基线取晚了**，把"传得更快"读成"没传" —— A/B：关自动同步 26/26、开 25/26，而**同一次运行**又打印笔记本读到了那条记录（**假红**）；② `verify-mobile-edit` **自 i18n 迁移起就是红的**（脚本找「任务标题」，界面词条是「标题」）＋「优先级」区块在首屏之外被当成"没渲染"。修完 **28/28** ✅ / **移动端四个标签全部为真实屏幕**（占位文件已删除）✅ / **iOS 壳已跑通到交互级**（Release 模拟器构建 → 安装 → 启动 → 真图标 + 真中文 + 真 SQLite 建库；`pnpm verify:mobile-ios` **36 项零 mock**，含"点 FAB → 输中文 → 提交 → op 落库 → 同步到另一台设备"全链路，**并含「零点击自动同步」这一条**（第 6 步；变异：关掉 `startAutoSync()` ⇒ **恰好 2 红**，而同一轮里「点按钮」那条仍然绿）；**从"我的页 + 键盘立着"这个曾经判红的初始状态跑起也能全绿**）✅/ ✅ **P0 已修：一条硬被拒的 op 会让设备同步永久卡死**（§7 第 34 条，**ADR-0009**；线级 + 反证 + 真机界面四层验收）/ ✅ **P0 已修：读侧解不开的 op 会让**别的**设备同步永久卡死**（§7 第 41 条，**ADR-0016**；变异验证 + 真服务端复验；配套修掉 legacy 密文在 Hermes 上无纯 JS 兜底）✅ / **清单（PROJECT）跨设备闭环**（`pnpm verify:mobile-lists` 零 mock：手机建清单 → 任务归入 → 笔记本读到**同一条清单、同一个 `projectId`**；业务逻辑复用 `packages/app-host`，未 bump schema）✅ / ✅ **P0 已修：手机"只能推、不能拉"** —— 上传响应搭车回来的 op 里有一条解不开，整次同步就死在 **upload 阶段**，`download()` **从不执行**（界面只显示"同步失败"，本地库远端 op 数 = 0）。（**ADR-0016 §6**，§7 第 46/47 条；变异验证 + 真机复验 + 判据补强：必须**数出**远端 op ≥ 1）✅ / **标签（TAG）跨设备闭环** —— 在此之前 `tagIds` **全仓库没有一处读写**（零件都在、产品里没有这个功能）。`TaskActions.setTags`（整组覆盖、写入侧校验悬空 id）、清单/标签共用 `OrganizerSection`、`pnpm verify:mobile-tags` 零 mock 四层判据（标签实体 + 任务引用 × 手机 + 笔记本）（399 单测 +2 处变异验证）✅ / **Web 端也接上「清单 + 标签」** —— 同一个空洞的另一半：`moveToProject` 在 `apps/web` **零调用点**，于是侧栏里建出来的清单和标签一个都用不上。新增 `TaskOrganizer`（原生控件、chip 常驻 + `<details>` 编辑），浏览器套件 13/13，判据是**刷新后仍在**（变异可复现：只写本地态 ⇒ 2 红）✅ / **三端同步验收 `pnpm verify:multi-end`**（Web ↔ 服务端 ↔ 笔记本，真浏览器 + 真服务端 + 真 SQLite）—— 补上此前**没人覆盖**的那条接缝（手机脚本没有浏览器、浏览器套件刻意离线）。第 3 相开在**全新 context = 空 IndexedDB**（= 一台刚装好的新设备），18/18。顺带查出三个真问题：**自建栈 CORS 默认只放行上游域名**（症状是「离线」而服务端零请求）、**服务端只存密文所以不能按内容断言**、**两设备共用 clientId 会让双方都同步不了**✅ / **鸿蒙：从 JS 源码到自包含 release HAP 的整条构建链已实测打通**（`verify:harmony-toolchain` 17/17、`verify:harmony-rnoh` 17/17、`verify:harmony-rnoh-js` 13/13：真 codegen + 真 autolinking + `hermes_bundle.hbc`（魔数已验）→ **20 MB release HAP**，含全部原生库，双 ABI。**但没跑起来**：缺模拟器系统镜像 + 签名（产物 unsigned）→ §3.24 / §3.25）→ [`详细计划`](../../docs/plans/archive/phase-2-multi-platform.md) |
| P3 平台特性 | ⏸ |

总路线图：[`docs/plans/roadmap.md`](../../docs/plans/roadmap.md)

### 并行轨道：协作与共享清单（🟡 **本地成笔、全链门禁被别线绊线挡着**，2026-10-11）

E2EE 下的**清单共享**基础设施（ADR-0062）已实现并**本地提交**（`git log` 现量，标题以「协作共享清单 W4/W6 接线」起）：
邀请凭证 + 成员角色 + **所有权转让**（两步确认、立即生效、原 owner 降 editor）+ **入群链接**落点（`?shareToken=`，
点开进加入流程、消费后摘参）+ 换钥时身份种子随 listKey 一起落盘。真实旅程 `pnpm verify:collab-journey`
**`RESULT=OK steps=3`**；本线三枚门禁红当场查并修绿 —— `check:layering`（把外壳里那份合成 AAD 的 op 形状构造
提进 `@heyta/app-host`）与 `check:ui-language`（`web.share.invite.emailPlaceholder` 补进门禁白名单，与 i18n
`catalog.spec` 既有同一判断对齐，**不改文案**），以及 **`apps/landing` 复刻对账**（本线 W4 接线 `a923f7fa` 往
`.ht-header__actions` 加了 `share-open-button`，落地页登记处没跟着补 ⇒ 已按既有 `mockedInLanding:false` 约定补登记、
阳性对照按真源码补项，**不放宽判据**；作用域已穷举，其余钉页头的判据停在不进共享按钮的默认视图）。`pnpm -r typecheck` 全仓绿。

🔴 **那一版"仍红四枚 + 未 push"已经过期，按 2026-10-20 现量改写**（红集会被人修掉，所以下面每条都带复量命令，别抄读数）：

- **那四枚绊线全部闭合，且都不是本线修的**：`packages/ai`（分母那格改成从 `MODELED_ENTITY_TYPES` 派生）、`check:reachability`（评论有了写路径与宿主调用点）、`packages/shared-schema` 的口令路径封闭词表补齐、`packages/domain` 权益拒绝理由契约由自动收集线拆回自己那张表。复量：`cd packages/{ai,shared-schema,domain} && npx vitest run` 各 rc=0 ＋ `pnpm check:reachability` rc=0。
- **`capability-manifest.generated.ts` 已入库**（`git status --porcelain -- packages/ai/src/capability-manifest.generated.ts` 现量 = 空），"跨线混物留工作树待协调"那一格从此不再有对象；它当初被推迟的理由（重生成会同时带别线的 4 枚 TASK 工具）由别线自己把它们提交掉而消解。
- **push 已发生**：`git rev-list --left-right --count refs/remotes/origin/main...main` 现量 `0 0`。所以"本线不代推、押在跨线协调"这句不再成立；下一位要推的是**别人新落的笔**，那条边界照旧有效（判据就是上面这条命令）。
- **W4 残余从三件变两件，但产品定性变坏了**：评论**已挂载并有写路径**（`apps/web/src/features/tasks/TaskDetailCard.tsx` 里 `ShareCommentsSection` 的 import 与渲染两处命中），不再是"已建模不可达"；指派与动态照旧（`Task.assigneeUserId` 全仓零写点、只有通知过滤在读；动态流仍只有通知偏好开关）。
  🔴 **取而代之的那一格更要紧：共享的"数据面"根本没通** —— `ShareApiClient.downloadOps` 在 `apps/*` 与 `packages/*/src` 里**零消费者**（复量：`grep -rn downloadOps --include=*.ts --include=*.tsx apps packages | grep -v spec`），客户端回放只吃本机 localStorage 那份 share log（`packages/app-host/src/share-comments.ts` 两处 `replayShareOps(..., [log.ops])`），服务端发出的 `new_share_ops` 实时信号客户端也不接；且**任务与清单的写路径仍进个人 op-log**（`packages/app-host/src/project-actions.ts` 里唯一的 share 相关方法是 `setProjectShareId`，没有任何 share 分流）。⇒ 成员之间互相看不到任务改动、也看不到对方的评论：**现在可用的只有"邀请/成员/角色/转让"这条元数据面，内容面是断的**。逐条见本线计划里 2026-10-20 那一节。

状态与逐项读数见 [`docs/plans/goal-collaboration-shared-lists.md`](../../docs/plans/goal-collaboration-shared-lists.md) **文末那几节**（末节号现量：`grep -n '^## ' docs/plans/goal-collaboration-shared-lists.md | tail -2`，本行不写节名因为它会长）；PIPL 同意面的视觉层级（旧停止点 ①）已按最佳实践落地并配判据（`apps/web/tests/share-consent-modal-theme.spec.tsx`）；**所有权转让语义（旧停止点 ②）已由产品负责人把判定权交下来、本轮按产品判断定案保留现语义**（两步确认 → 立即生效 → 原 owner 降 editor，服务端单事务原子），翻案条件写在计划那一节。



分支 `feat/motivation-system`（worktree `.worktrees/motivation`）。L1 即时反馈 / L2 连续性 /
L3 叙事三层**已实现**，**并已落到 `main`**（merge commit `84cc7f5`，2026-09-27，
75 文件 / +11008 行）。分支与 worktree **已删除**（相关提交仍是 `main` 的祖先，随时可达）。

📄 落地程序、验证矩阵与回退点在
[`激励与成长体系设计`](../../docs/plans/archive/motivation-and-progression.md) **§12**。

同批落地的还有**活动分类与分类着色** —— 成长视图里的分类泳道图 + 周堆叠条，
入口是清单与习惯编辑处的色槽取色器（1–8，**调色板由我们给、含义由用户赋**）。
🔴 核心裁决：**颜色由用户自己赋义，App 永不判断某个活动"健康／不健康"、也永不自动上色**。
分层清单见 [`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §1.2。

> ⚠️ 下面这段是**历史记录，不是现状** —— 分支当初确实被挡过，挡它的两件事都已消失：
> 主检出的 200+ 未提交改动由各自的所有者提交并推送；`main` 自己 build / typecheck / test
> 的那批红灯（消费者已提交、生产者在路上）也随同一批提交补齐。**留在这里是为了让后来者
> 认出"分几笔落地"这个形状**，而不是照它行动。

设计红线：**不发行任何货币**（没有金币/积分/商店，也不卖"后悔"）、
**只与自己的过去比**（排行榜/联赛/自习室/组队打 Boss 在 E2EE 下结构上不可能）、
**从不制造愧疚**。关键裁决见下面 ADR-0022 与
[`docs/plans/roadmap.md`](../../docs/plans/roadmap.md) §1.2。
