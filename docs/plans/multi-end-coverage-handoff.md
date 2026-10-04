# 交接：多端补齐（重点移动端）Goal —— 当前停在哪

> 状态行：**🔄 未完成**。条件 1 的 6 行里 **3 行 ✅ / 3 行 🟡**；条件 2 **未达成**（`pnpm check` 上一次现量是
> **57/62 段可过** —— ⚠️ 那是旧载体上的读数。段数是活数，**别抄它，要现量**：`node -e 'console.log(require("./package.json").scripts.check.split(" && ").length)'`（10-04 14:2x 在 HEAD `0a0b63f6` 上是 **81**，本文件上一版写的 63 也已过期）。
> 本线**真实跑过**的那趟是 **74 段 / 载体 `f08b26e7`（10-04 02:35–02:41）**：整条 `pnpm check` 报 `CHECK_EXIT=1`，断在第 8 段 `check:op-log-semantics` 的**本机内存闸门**（环境门，不是产品红）；逐段总账（64×`rc=0` / 9×`rc=1` / 1×`rc=134`）与十条非绿的逐条归属都在 §7.30 的 ② 槽 —— **条件 2 那句"exit 0"仍未达成，且缺的九条都不在本条线的落点上（本线不吸收别人的债凑绿）**，
> 所以"57"描述的是**那一趟**，不是当前仓库；四端重装本轮没跑）。**这条 Goal 没有被标记完成，也不要照本文件当成已完成接手。**
> 唯一权威过程账在 [`goal-multi-end-coverage.md`](goal-multi-end-coverage.md) §7（§7.27 字形定论、§7.28 完成条件逐条现量），
> 阻塞与归属账在仓库根 [`../../BLOCKED.md`](../../BLOCKED.md)（B33/B41/B42/B43/B45/B47/B50/B51/B52），
> 逐程流水在 [`../../PROGRESS.md`](../../PROGRESS.md)。本文件**不重复决策与归因**，只写"现在在哪、下一步按什么顺序做"。

---

## 0. 载体（接手前先核，别信本文件里的号）

| 项 | 值（**02:0x 现量**，上一版是 00:5x） | 复跑核对 |
|---|---|---|
| `main` HEAD | `ee8b17fe`（02:3x 现量）。距 02:0x 那一版 `bcfee6fb` **276 笔**，但**这不等于"25 分钟里写了 276 笔"**：区间里 **38 笔是 merge**，`--no-merges` 是 238 笔 —— 绝大多数是并行会话把长期分支（closeout / 自托管 / detail-pane）并进 main 时**带进来的既有历史** | `git rev-parse --short HEAD`；区间构成 `git rev-list --count --merges <旧>..HEAD` + `--no-merges`（**只报"多少笔"会把一次合并读成一次大改**） |
| 🔴 归属**不能**靠 `--author` 判 | 这台机器上所有并行会话共用同一个 git 用户（`邓湘雷`），`git log --author=…` 分不出哪条线 | 能用的只有两种：标题前缀（`docs(handoff)` vs `feat(...)`）与**内容 needle**（`git log -S '<只有我写的那一行>' -- <文件>`，见 §6） |
| 本条线的父子层级分支 | ✅ **已落 main，不再是一笔待做的合并**（02:3x 现量推翻了本行旧版）：`git merge-base --is-ancestor 776fc23c HEAD` 退 **0**、`origin/main` 也含它、本地分支 `feat/list-parent` 已删（02:3x `git worktree list` 里也**没有** `heyta-wt-hierarchy` 了）；**是谁、经哪条分支把它合进去的没有现量**，本行只登记能证的两件事：那笔在 main 的祖先里，且分支与 worktree 都不在了 ⇒ §5 第 4 步剩下的只有**界面取证**（细则以 §5 第 4 步现量为准，旧版那句"要落的是一笔合并提交"划线作废） | `git branch -a --contains 776fc23c`（应含 `main` 与 `origin/main`）；`git branch --list feat/list-parent` 应为**空** |
| 本条线层级判据（合并态现量） | 领域 **15** / 动作层 **10** / 共享层形状 **8** / web DOM 用例（那份 spec 合并态 **38** 条，含我这 6 条），全部 0 skipped；整包：i18n 22 / domain 881 / app-host 1081 / ui 493 / mobile 666 | `pnpm --filter @heyta/domain exec vitest run tests/project-hierarchy.spec.ts` 等；归属核对用"标记命中数合并前后逐处相同"（见 §3.3） |
| 已知 **HEAD 级**红（不是本条线的，别代改） | ~~`@heyta/ui` `projects-model.spec.ts:96`：`toOrganizerTree` 多一个 `archived` 键~~ ⇒ ✅ **已被并行批次关掉**（把 `d27bccde` 合进本条线分支后 `@heyta/ui` **488 passed / 0 failed**）。登记留着是为了让下一个人在自己又看到它时知道这是同一件事的第几趟 | `pnpm --filter @heyta/ui test` |
| 🔴 **HEAD 级门禁红（本条线不吸收）** | `check:l4`：`apps/web/src/features` 内联样式 **112 > 基线 104（+8）**，由并行批次那笔「总接线」`d27bccde` 带进来；红名单 19 个文件逐个不是本条线碰过的（本条线在 web 的落点 `ProjectsPanel.tsx` 内联样式 **0 处**） | `node scripts/check-l4-no-style.mjs` |
| l4 棘轮 | 见 §0.5（阈值 ≤104/90，别名是 `check:l4` 不是 `check:l4-no-style`，见 §6） | `node scripts/check-l4-no-style.mjs` |

⚠️ **接手第一件事**：`git status --porcelain` 02:3x 现量 **45 条**（源码面 `packages/ apps/ server/ scripts/` **36 条**）。
同一格的历史读数：**约 270 → 13 → 35（七分钟内涨）→ 19 → 45**
—— 这个数**两个方向都会动**，不是单调涨，所以它只能在动手那一刻重量。它决定三件事：
闸门那条"别人未提交的源码"、④ 那笔合并的落点交集、以及 `reinstall:all` 会把谁的半成品装上四端。
本仓库是**共享工作树**，`git commit`（裸）提交的是整个索引 ⇒ 永远点名路径提交。

---

## 0.5 Goal 全部范畴逐项对账（2026-10-03 22:1x 现量，`node /tmp/reconcile.mjs` 的那套读数）

> 这一节存在的理由：**交接最容易漏的不是没做完的事，是整层要求没核**。
> 下面逐条把任务书里的每一项落到"做掉 / 未闭合 / 不归本批（挂编号）"三选一，全部带复跑读数。

| Goal 里那条要求 | 现在 | 复跑与读数 |
|---|---|---|
| 任务 0：`check` 段数 = 62 | ⚠️ **别抄任何一版这个数**（00:5x 现量 63 → 10-04 14:2x 现量 **81**） | `node -e 'console.log(require("./package.json").scripts.check.split(" && ").length)'`。当时多出来的两段是 `check:md-tables` 与 `check:op-log-semantics`（定源：`git diff e5f91c3f..HEAD -- package.json` 的新增段名；各提交时的段数曲线 60→61→61→61→62→**63**）。⇒ **报"可过 N 段"必须带总数与载体**，别沿用 62 |
| 任务 0：l4 baseline 104 / 90 | ✅ 对上 | `scripts/check-l4-no-style.mjs` `:155 baseline: 104`、`:162 baseline: 90`（现量读数 98/90，**未动阈值**） |
| 任务 0：`apps/mobile/tests/*.spec.ts` = 35 | ⚠️ **已漂到 44**（01:4x 复量：工作树 **44** / HEAD **44**，这一格暂时稳） | `ls apps/mobile/tests/*.spec.ts \| wc -l`。本条线新增 3 份，其余是并行条线加的 ⇒ **接手别拿 35 当基线** |
| 任务 0：中英词条各 2881 | ⚠️ 口径不同，而且**我这条判据比仓里已有的弱** | 01:4x 现量（同一形状重数）：**HEAD 两侧各 2981**（单引号 2945 + 双引号/反引号 36）/ **工作树两侧各 2983**（别人正在这两张表里加 2 个键，两侧同步加所以仍相等）。🔴 我原先写的"稳的判据 = 两侧键数相等"是个**数数**判据，而仓里早就有一条**集合**判据：`packages/i18n/tests/catalog.spec.ts:18`「中英两表的 key 集合完全一致（双向）」—— 它同时挡漏翻译与键名错位，键数相等挡不住后者。**以后这类"两份抄件"的对账先找仓内现成装置再接**（`:24` 与 `:67` 那两条还各自挡"中文里塞英文占位"与"英文复制中文交差"） |
| 任务 0：开工回执 ≤10 行写进 PROGRESS | ✅ | `PROGRESS.md` 首节 |
| 任务 1：6 个脚本补 `verify:` 别名 | ✅ | 现量 `verify-*.sh` 共 **31** 个、**无别名 = 0** |
| 任务 1：account 与 reminder-ring 进 MANIFEST + 改掉过期注释 | ✅ | `scripts/check-script-snapshot.mjs` 含 `verify-mobile-account` / `-reminder-ring` / `-notes` / `-restore` 均 true |
| 任务 1：lists/tags/restore/quadrant-fill 等进 journey mobile 册 | ✅ | `grep -cE "'scripts/verify-" scripts/check-journey-coverage.mjs` → **28** 条（`:103–126` 那段就是册子） |
| 任务 1：`verify-mobile-lists.sh:377` 的 psql 改 env 可覆盖 + 读不到要响亮失败 | ✅ | 现量 `:387 PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"`、`:390 psql -U "$PG_USER"`、`:393` 打印"读不到服务端的 PROJECT/CRT op 计数…原始输…" 并失败。⚠️ 文件里仍有两处 `\\|\\| true`（`:250 open_sheet`、`:273 close_sheet`）——**那是 UI 交互容错，不是被禁的"掩盖计数读取"** |
| 任务 1 验收：两个门禁 exit 0 + 反向验证（删 MANIFEST 一条 ⇒ 红） | ✅ | `check:script-snapshot` / `check:journey-coverage` 现量 exit 0；反向验证的红输出记在 goal §7 任务 1 那节 |
| 任务 2：移动端便签详情/编辑屏 + 传 `onEdit` + web 同批补传 + `SearchScreen` 传 `onOpenNote` | ✅ | `apps/mobile/tests/note-edit.spec.ts` **15 passed**、`reminders-notes-display.spec.ts` **17 passed**（含 `:261` 翻向那条） |
| 任务 2 验收：`check:ui-language` 绿 | ✅ | 现量 exit 0 |
| 任务 2：`scripts/verify-mobile-notes.sh` 新建并补别名 + 进 MANIFEST + 进 journey 册 | ✅ | 三处都在（上表三条的读数覆盖到它） |
| 任务 2：真机截图入库并说清看到什么 | 🟡 **部分** | 两张已入库并逐张写明钉到脚本第几步；**第 8 步之后三腿未闭合**（第 8 步第三张截图、第 6/7 步 op 判据、第 9–11 步跨设备）⇒ 见 §5 第 3 步 |
| 任务 2：反向验证"拿掉 onEdit ⇒ 用例必红" | ✅ | 红→绿两段输出记在 goal §7 任务 2 那节 |
| 任务 3：清单/标签改名、归档入口、习惯改名与删除 | ✅ | `organizer-rename.spec.ts` **26 passed**；`renameTag` 与习惯改名是本轮新建的 action（一个意图一个 op，未 fan-out） |
| 任务 3 验收：两端各一组用例 + `check:reachability` 绿 | ✅ | reachability 现量 exit 0 |
| **Goal 第④步：父子层级选择器**（`setParent` + 一层/环/自指守卫 + 两端界面与词条） | ✅ **做完，且分支侧已把 main 合进来** | `feat/list-parent` @ `c983a7cf`（零冲突、并集与归属核对齐，见 §3.3）。**跨端形态是代拍**（依据 + 回退写在 §5 第 4 步）。⚠️ 这一行旧账写"合流被七个 `M` 挡住"—— 只剩**两张词条表**（检出层）。🔴 01:3x 现量：main 又前进 7 笔 ⇒ **不再是快进**，要落的是一笔合并提交；零冲突已改用免检出的 `git merge-tree` 现量证过（全部更正见 §5 第 4 步）。🔴 19:3x 再更正一处**身份**：`feat/list-parent` 已删 （`git branch --list feat/list-parent` 现量为空）、五项内容以 HEAD 为准（逐条 file:line 见 §3 第 127 行下面那段）， 本行的 `c983a7cf` 只作为 00:5x 那一刻的图关系读数保留 |
| Goal 第④步的"守卫不许漂移" | ✅ 有常驻判据 | 领域那条"候选集 = `validateProjectParentChange` 的展开（唯一差别 = 归档不进候选）"逐对断言，两端都走同一个 `folderTargetsFor`；web 6 条 DOM 级判据 + 8 臂变异（`aria-disabled` 那种"说了但没禁用"的漂法也被"点它什么都不该发生"那条抓住） |
| 任务 4：移动端传 `share`（周小结） | ✅ | `growth-share-summary.spec.ts` **13 passed** + 变异两臂 |
| 任务 4：词条 `{{count}}` 与 `{count}` 字形统一 | ✅ | **定论是"本来就只有一种"**：`{{`/`}}` 各 2 行且**全是注释**，真值 `web.growth.year.heatmap` 两端都是单层 `{count}`；交付物 = 三条测量 + 一条常驻判据 + 一次变异（goal §7.27） |
| 任务 4：移动端传 `activityDays`（年度热力图） | 🟡 **不归本批** | 被冻结判据 `apps/mobile/tests/growth-display.spec.ts:365` 钉成空串 ⇒ **B41** |
| 任务 4：移动端传 `onRepair`（补打卡） | 🟡 **不归本批** | `HabitStreakList.tsx:269` 是 **或**条件 + `:302` 钉 `repairAction` 必须 `undefined` ⇒ **接了也不渲染、不报错** ⇒ **B42** |
| 任务 4：`onFreshStart` 不许顺手加 | ✅ 按书执行 | 无对应动作 ⇒ 写进 **B43**，一行代码都没加 |
| 任务 4：「我的」加权益/到期可见 | 🟡 **半** | 权益卡已挂（消费 `app-host#fetchHostedEntitlementReading`）；**"到 X 日到期"拿不到** —— ⚠️ 旧账写"那次 GET 一个响应字段都不消费"，**这句是错的**（`packages/domain/src/subscription.ts:189-230` 确实消费 `status`/`errorCode`/`reason`/`currentPeriodEnd`）；真缺口是**服务端 402 body 只有 `{error, errorCode, reason}`**（`server/src/entitlement.ts:376-380`），那个可选槽位永远 undefined ⇒ 要动服务端面 ⇒ **B45**（详见 §5 第 3 步那条纠正记录） |
| 任务 4 验收：`check:payment-entry`、pricing 一致 | ✅ | `check:payment-entry` exit 0；**权威名是 `check:pricing`**（任务书里写的 `check:pricing-consistency` 是**文件名**不是 pnpm 别名，我照名字跑得到 "command not found" 的假红 —— 第三次踩 B50，已在 B50 追加）|
| 拍板 1：移动端提醒不做，禁令前提要拍 | ✅ 已拍并回写 | 前提被**第三个自研原生模块**否证（B33）；并行条线已实施原生投递，本行**不代其主张验收读数** |
| 拍板 2：AI 功能不做，但 `check:ai-coverage` 改成按端枚举 | ✅ | 提交 `05293b7d`；门禁现在逐端打印 `mobile 0/5`，接一半会红（变异：塞两条探针 ⇒ 精确点名缺的 3 条）|
| 拍板 3：模块开关 / 鸿蒙 不排 | ✅ 按书执行 | 一条代码都没动，理由写在 goal §6 排除项与审计矩阵 |
| 拍板 4：只动客户端与共享层，不碰 `server/`、计费、管理后台 | ✅ 有对账 | 本条线全部 12 笔提交涉及 **51 个文件**，落在 `server/`、`packages/ai/`、`apps/web/src/features/admin` 的 = **0**（复跑：`for s in …; do git show --name-only --format= $s; done \\| sort -u`）|
| 界限：判卷冻结（`apps/mobile/tests/**`、`e2e/**`、其余 `scripts/check-*.mjs`） | ✅ 自审干净 | 复跑：`for s in 76cbee51 … d6ea2dc9; do git show --name-only --format= $s \\| grep -E '^(e2e/\\|apps/mobile/tests/\\|scripts/check-.*\.mjs$)'; done` ⇒ **只有 `scripts/check-ai-coverage.mjs` 一条**，它的授权来自任务书"拍板 2"那一行（点名让我改它），不是越界 |
| 界限：白名单外只读 | 🟡 两处越界候选，如实记 | ① 根 `package.json` 被改 —— **任务 1 要求"补 verify: 别名"必然要动它**，属隐含授权；② `BLOCKED.md` / `PROGRESS.md` 是任务书自己指定的记录文件。其余零越界 |
| 规矩：不新增依赖 | ✅ | 51 个文件里无 lockfile、无 `package.json` 依赖段变更 |
| 规矩：skipped 必须 0 | ✅ | 本批四份判据文件现量 **71 passed / 0 skipped** |
| 收尾：`pnpm check` 全量 exit 0 | 🔴 **未达成**（上一趟 **57/62**；⚠️ 该读数属于**那一趟的载体**，段数总数是活数：10-04 14:2x 现量 **81**，本线真实跑过的那趟是 **74 段 @ 载体 `f08b26e7`**） | 5 段红的逐条归属在 goal §7.28 与 **B51**，74 段那趟的逐段总账在 §7.30 的 ② 槽；下一次现量起点应写 **≤56/现量总数**（§3.1），**别把"可过段数"和"总数"当同一把尺** |
| 收尾：四端重装 `INNER_EXIT=0` + 四张截图 | 🔴 **本轮没跑** | 环境不在窗口（§4）；**别拿上次跑绿的载体顶替** |
| 规矩：提交用点名路径、不 push | ✅ 且已升级 | 本轮起改用 plumbing + "blob = HEAD + 我的文本"（**B53**），并补了一步：`96f3293d` 曾把并行会话的整节替他们提交 |


## 1. 目标与范围（原文口径，不要扩）

移动端「零件都在、没人接线」的那批功能接完，每条带能失败的判据，最后四端装上当前源码。
让步顺序：**判据真实 > 功能做完 > 做得快**。

允许改的地界（其余只读）：`apps/mobile/src/**`、`apps/web/src/features/{notes,motivation,search,projects,habits,subscription}/**`、
`packages/{ui,app-host,i18n}/src/**`、`scripts/verify-mobile-*.sh`、`check-script-snapshot.mjs` 的 MANIFEST、
`check-journey-coverage.mjs` 的 mobile 登记、两份台账（审计 §3/§4 与 goal §7）。
判卷冻结：`apps/mobile/tests/**`、`e2e/**`、其余 `scripts/check-*.mjs` 不许改
（唯一例外 `reminders-notes-display.spec.ts:261` 那条已翻成 `toContain('onEdit=')`，不许删）。

---

## 2. 已经做完并落盘的（别重做）

| 面 | 状态 | 判据（可复跑） |
|---|---|---|
| 清单/标签 改名与归档（两端） | ✅ | `cd apps/mobile && npx vitest run tests/organizer-rename.spec.ts` → 26 passed |
| 习惯 改名与删除 | ✅ | 同上文件里那条习惯 describe |
| 便签 编辑（移动端二级全屏屏 + 搜索里点开便签） | ✅ 接线与判据齐 | `npx vitest run tests/note-edit.spec.ts` → 15 passed；`tests/reminders-notes-display.spec.ts` → 17 passed（含翻向断言） |
| 周小结分享块 + 「我的」权益卡 + 占位符字形对账 | ✅ | `npx vitest run tests/growth-share-summary.spec.ts` → 13 passed |
| 导入（自家 JSON 还原）移动端 | ✅ | `node scripts/check-pricing-consistency.mjs` → exit 0 之外，设备判据 `scripts/verify-mobile-restore.sh` |
| `check:ai-coverage` 按端枚举（移动端 0/5 显式红） | ✅ | 变异：塞两条探针 import ⇒ 精确点名缺的 3 条 |
| **共享设备占用探针修好**（旧写法跨不过仓库路径里的空格，对 `.snap.<pid>` 形态的运行者**永久隐形**） | ✅ `ad9dce8e` + `eb03420a` | `bash scripts/lib/mobile-e2e-runner-probe.sh --self-check` → 7 绿 0 红；变异：把逐段拼接改回 `[^ ]*` ⇒ 恰好 `.snap` 那一臂红、退 1；在体：`--target c` 的 dry-run 当场报「有移动端验收在跑（pid 11584）」而旧抄件报"粗筛没有"。**别再往这两处抄 `bash [^ ]*verify-mobile-…`** |

## 3. 当前状态：还差的（逐项带现量）

1. **条件 2 的第 1 条：`pnpm check` 62 段 exit 0** —— 上一轮现量 **57/62**；⚠️ 本轮**没有**重跑全量（窗口不在），
   但已确证**至少多出一段红**，所以下一次现量的起点应当是 **≤56/63**（总数已从 62 漂到 63，见 §0.5 那条）。
   🔴 **19:3x 又漂了一档：现量 82 段**（数法 = 把 `package.json` 的 `check` 按 `&&` 切开数，段名逐条现取，
   第 68/69/70 段正是本 Goal 点名的 `check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`，
   末段是 `pnpm -r test`）⇒ 本行那两个数都只是当时的快照，
   **下一次报"可过段数"必须带同一趟现取的分母**，不许拿 62 或 63 当分母
   （🔴 同一结论句在 `docs/plans/goal-multi-end-coverage.md` 里另有 **6** 处，`grep -c '62 段'` 现量；
   该文件此刻是 ` M`、比 HEAD 多 **+19/-1**（19:35 现量），所以本线**不往脏台账里 sweep**——
   等落 ①/③ 读数时若它已回 `0 0`，连同分子分母一次换掉；若仍脏，就留在本行当"待 sweep"的账）：
   - 🔴 **新增的一段（2026-10-03 23:5x 现量）：`check:l4`** —— `apps/web/src/features` 内联样式 **112 > 基线 104**。
     成因是并行批次那笔已提交的「总接线」（`d27bccde`）：红名单 19 个文件逐个不是本条线碰过的，
     而本条线在 web 的落点 `ProjectsPanel.tsx` 内联样式 **0 处**。⇒ **不吸收凑绿、不调基线**（脚本自己写着"不要为了变绿把 baseline 调高"）。
     现量命令：`node scripts/check-l4-no-style.mjs`（pnpm 别名是 `check:l4`，见 §6）。
   - 3 段 Playwright（`check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`）：
     需要 `:3000` 空闲且没有别人的 vite；`check:ai-e2e` 会 **SIGKILL 别人的 dev server**（traps #87）。
   - `check:shell-unicode`：**HEAD 上就红**，在别人提交的 `scripts/mutate-closeout-gates.sh`（B36.2，地界外不代改）。
   - `check:docs`（第 34 段）：**HEAD 上就红 3 处**（别人引用进了提交、目标文件漏 `git add`，B51），
     其余 24–30 处只在混合工作树成立，**本条线 0 处**。本轮再量一次是 **2 处失效章节引用**，
     两条都在倒数纪念日那份主计划里（一处指向一张 W7 设备导出工单的第二节，那张文档不存在；
     另一处引用 ADR 索引的第一节，而那个索引里没有编号 1 的小节）⇒ 那条线自己的，**不动**。
     ⚠️ 我为了"说清是哪两处"把它们转述进本文件时，**反而让本文件多出两条同样失效的引用**（现量：
     报错行的文件名从倒数纪念日那份变成了本文件），因为"`<文件名>` §`<节号>`"这个形状
     **即使包在反引号里也会被解析成章节引用** —— 本节最后一条原先写的是"行内代码里的路径不是链接"，
     那句对**纯路径**成立、对**带 § 的章节引用**不成立。已就地改成不含该形状的写法，并把这条记到 §6。
   - ⚠️ 上一轮登记的 **`@heyta/ui projects-model.spec.ts:96`（HEAD 级红）已经不红**（合并 `d27bccde` 后 ui 488 passed / 0 failed），
     所以 `pnpm -r test` 那一段的读数也要重取，别沿用旧的"1 failed"。
2. **条件 2 的第 2 条：四端重装 `INNER_EXIT=0`** —— 🔴 **本轮没跑**。上一次四端跑绿的载体不是本轮交付，不能顶替。
3. **条件 1 的三行 🟡**（不是漏做，是拦路的在本批权限之外）：
   - 清单/标签行的「父子层级选择器」：✅ **本条线做完了，在未合并分支 `feat/list-parent`**（笔数现量：`git log --oneline 0a61c0a6..feat/list-parent | wc -l`）：
     写侧 `ProjectActions.setParent(entityId, parentId?)` + 领域守卫
     `packages/domain/src/project-hierarchy.ts`（自指 / 悬空父 / 环 / 文件夹不进文件夹 / 一级深度，
     判序逐条带变异）；界面是共享 `FolderPicker`，经 `OrganizerList` **已有**的 `renderItemExtra`
     插槽挂在两端 ⇒ 行骨架零改动；词条中英各 11 句（7 句是拒绝原因的人话）。
     ⚠️ **19:3x 现量更正这一行的"在未合并分支"身份**（那句只在 02:3x 之前成立；
     `git branch --list feat/list-parent` 此刻为**空**）⇒ 五项全部改按 **HEAD** 现读为准：写侧
     `ProjectActions.setParent(entityId, parentId?)` = `packages/app-host/src/project-actions.ts:109`（impl `:280`）；
     守卫 = `packages/domain/src/project-hierarchy.ts:66`，判序逐行现读为
     `project_not_found` → `parentId===undefined`（顶级，直接放行）→ `self` → `parent_not_found` →
     `cycle` → `parent_not_top_level` → `has_children`；单测两处
     （`packages/domain/tests/project-hierarchy.spec.ts`、`packages/ui/tests/list-parent-wiring.spec.ts`）；
     两端调用点 `apps/web/src/features/projects/store.ts:130` 与
     `apps/mobile/src/screens/ListsSection.tsx:264`（后者用 `.catch` 接住被拒的 throw ——
     同文件 `:109` 那条注释就是为了这一格）；词条家族 `common.organizer.folder.*` 逐键对账
     **zh 11 / en 11、仅 zh 0、仅 en 0、逐字相同对数 0、英文值含汉字 0**（19:3x，
     比的是键集与值层，不是数词频）。
     🔴 **同一句结论在本文件里落三处**（本行、§3 表第 57 行、§0 表第 19 行），上一轮只改了第 19 行
     —— 这就是记忆里"改一处必 sweep 全仓"那条说的漂移，本轮把第 127 与 57 行补齐。
     判据三层：领域 15 条 / 动作层 10 条（真引擎 + 真 SQLite，含"B 端 applyRemote 后同父同裁决"）/
     界面 6 条 **DOM 级** + 8 条源码级形状；变异 **8 臂全红**、每臂复原后复绿并断言逐字复原。
     🔴 跨端形态是**代拍**（原话要求"两端同时做嵌套"而非"移动端先做"），理由与回退：
     现量依据 = `OrganizerList` 早就渲染一层嵌套（两端同一棵骨架），代拍只是把入口挂到已有插槽上；
     回退**不写 SHA**（写了就漂，本轮已漂过一次）：分支没合进 main ⇒ 回退就是不合流；要逐层退就从尾往头 `git revert` 那几笔（写侧 / 界面 / 行为判据各一笔）。
     写判据时现量出**两条真缺陷**并当场修掉：① "当前位置"那一项原来照点照写 = 一条内容不变的 UPD（违 §3.4）；
     ② 候选含已归档清单，而 `toOrganizerTree` 默认不画归档父 ⇒ 移进去的那条**从侧栏消失**（`model.ts` 自己写成"宁可当孤儿"）。
     → B52 结构上关闭，**只剩合流**（下一条）。
   - ✅ **合流义务：本轮到底了 —— 分支侧已含 main 全部，`git merge feat/list-parent` 现在是快进**（00:5x 现量）。
     ⚠️ ~~现在是快进~~ **01:3x 现量已失效**：main 其后又前进 7 笔（含本条线 4 笔 `docs(handoff)`），
     双向各领先 7 ⇒ 要落的是一笔**合并提交**。"零冲突"那一半仍然成立且换了免检出的探针
     （`git merge-tree --write-tree` rc=0、无冲突文件名）；全部现量与那条一般规律写在 §5 第 4 步。
     过程里有**一句我自己写的预测被十五分钟后的现量否证**，而且**判它的方法本身也是错的**，两条都留下：

     1. **23:5x 那版这里写的是**："还剩的阻塞 = 主检出 3 个落点未提交，它们一旦提交合流应当零冲突
        （依据：把分支补丁在 base/HEAD/活树 三个版本上各跑一次 `git apply --check`，得 0/0/1）"。
        那次三条腿确实是 `base=0 head=0 live=1`，读数没抄错。
     2. **00:4x 重量**：落点交集从 3 变 5（归档线开始改 web 那两个文件），三条腿仍是 0/0/1。
     3. **00:5x 再量 —— 否证发生**：main 前进了 **6 笔**（含两笔 vault 提交，它们改了同一对词条表
        `packages/i18n/src/locales/{en,zh-CN}.ts`），脏文件从 74 掉到 13，落点交集只剩 **2 个**（就是那两张表），
        而三条腿翻成 **`base=0 head=1 live=1`** —— 重叠来自**已提交**的 main，不是来自未提交的活。
        ⇒ "等他们提交就零冲突"这句**不成立**：他们提交了，反而多了重叠。
     4. 🔴 **更要紧的是方法错**：`git apply --check` 比的是**上下文补丁**能不能落，
        `git merge` 走的是**三方**（有共同祖先）。两者不等价，我却拿前者当后者的判据。
        实锤：00:5x 那次 `git merge main` 在 `feat/list-parent` 上**零冲突**通过，
        而同一个时刻同一对文件的 `apply --check` 报 1。**方向反了**（apply 报冲突、merge 干净），
        所以那条"实测"既没预测对也没解释错 —— 它压根不是合并的判据。见 §6 新增那条。

     **实际做的**：在分支侧 `git merge main`（tip `c983a7cf`），**零冲突自动合并**；并集核对
     （合并的判据只能是这一类**语义**核对，不是补丁能不能落）：

     | 核对 | 现量 |
     |---|---|
     | 本条线 22 句 `common.organizer.folder.*` | en **11** / zh **11** 全在 |
     | main 侧 vault 词条（防"我吞他"） | en **66** / zh **66** 全在 |
     | `main 有而本分支缺的键` | 两张表都是 **0** |
     | `packages/ui/src/index.ts` 两侧导出 | `OrganizerList` 与 `FolderPicker` 两组都在 |
     | 反向图关系 | `git merge-base --is-ancestor main feat/list-parent` → 0（**快进可合**）；⚠️ 01:3x 同一命令退 **1**（main 又前进 7 笔），该单元格描述的是 00:5x 那一刻的图 |

     🔴 **但"现在往主检出合"仍然做不到，被同一对文件挡住 —— 这次是检出层不是图层**：
     `packages/i18n/src/locales/{en,zh-CN}.ts` 在主检出里还是 `M`（00:5x 现量），
     而快进恰好要改写这两个文件 ⇒ `git merge --ff-only` 会被 git 拒绝（不会替你 stash 别人的改动）。
     ⇒ 等的是**他们把这两张表落地**，~~届时在 main 上一次 `--ff-only` 就完事~~
     **届时在 main 上落一笔合并提交**（01:3x：快进已不成立，见 §5 第 4 步那条更正；零冲突已由 merge-tree 现量证过）。
     复跑：`git -C <主检出> status --porcelain -- packages/i18n/src/locales/en.ts packages/i18n/src/locales/zh-CN.ts`。
     **合并后分支的目标校验链**（载体 `heyta-wt-hierarchy` @ `c983a7cf`，00:5x 现量；
     九段逐段命令写在下面，**别去翻那个 `/tmp` 日志** —— 它是一次性现场，重启就没了）：
     build 八个依赖包 → i18n **22** → `check:ui-language` + `check:layering`
     + `check:design` → domain **881** → app-host **1081**（合并前 1076，多的 5 条来自 main 的 vault）→
     ui **493**（原 488）→ web 那份 spec **38**（原 31）→ web typecheck 0 错 → mobile **666**（原 657）。
     🔴 **归属核对**（不是"总数涨了就是好"）：本条线 9 个落点的标记命中数合并前后**逐处相同**
     （`web-list-folder` 18、两份词条表各 11、`setParent` 6、`FolderPicker` 5/3/2/2、
     `validateProjectParentChange` 5）⇒ 那 38 条里确实包含我这 6 条 DOM 用例。
     复跑：`git show f41221a8:<文件> | grep -c <标记>` 对 `grep -c <标记> <文件>`。
   - 成长统计行：热力图无障碍名被 `apps/mobile/tests/growth-display.spec.ts:365` 钉成空串
     （现量该行仍是 `expect(labels.heatmap.grid({ total: 42, days: 365 })).toBe('')`）；
     补打卡被 `packages/ui/src/motivation/HabitStreakList.tsx:269` 的
     `onRepair === undefined || labels.repairAction === undefined ? null :` 挡住（**接了也不出现、不报错**）。
     ⚠️ 这一句旧账只写了 basename 没写目录 —— 那个文件在**共享层** `packages/ui`，不在 `apps/mobile`。→ B41 / B42。
   - 权益行：🔴 **本轮把这条登记的"理由"纠正了，结论不变**（00:5x 现量）。
     旧账写"`entitlement.ts` 那次 GET **一个响应字段都不消费**"—— **错的**：
     `packages/domain/src/subscription.ts:189-230` 消费 `status` + `body.errorCode` + `body.reason` +
     `body.currentPeriodEnd`，并在 `toHostedSyncAccess`（`:246-252`）里从它派生 `expired`。
     真正缺的是**服务端不给那个字段**：`server/src/entitlement.ts:376-380` 的 402 响应体逐字是
     `{error, errorCode, reason}` ⇒ 客户端解析器那个 `currentPeriodEnd?` 槽位**永远是 undefined**；
     而 2xx 分支只回 `{kind:'entitled'}`，也**不读**任何到期信息。
     ⇒ 结论仍归 B45（要动服务端面，本批不越权），但**闭环形状现在清楚了**：服务端在两处之一给出
     `currentPeriodEnd`（402 body，或 `/api/sync/status` 的 200 payload），
     客户端**已经能接**（解析器有那个可选槽位、`expired` 也由它派生），剩下只有界面那一行"到 X 日到期"。
     ⚠️ **我在这条上 30 秒内自我否证了一次**：先写下"移动端一个权益消费者都没有"，
     再跑 `grep -rn "toHostedSyncAccess\|SubscriptionNotice\|fetchHostedEntitlementReading" apps/mobile/src`
     → **4 处命中**：`apps/mobile/src/screens/EntitlementSection.tsx` 是有的（它 fetch reading，
     按 `reading.reason === 'PERIOD_ENDED'` 选变体）。**真实缺口不是"移动端没这块"，而是两端都只渲染状态、
     没有任何到期日**（`:89-108` 三个 `Text` 全是标题/正文/本地数据说明）。
     ⇒ 教训同 §6 那条"断言没有 X 要读被断言对象的本体"：**我这条没跑就写进文档了，被自己的下一条命令推翻。**
4. **`verify:mobile-notes` 的剩余腿**：🔴 **本轮现量否证了"判据还没写"这个前提** ——
   真机只走到第 5 步是**执行**状态，不是**编写**状态：脚本里 13 步（0–12）、**55 条 ok/bad 断言**，
   目标原话点名的三条腿**逐条都在文件里**（带行号）：
   - 第 6 步 op 判据 → `:331-361`：`NOTE/UPD` 必须**恰好 1 条**，且载荷键集合必须 `== ['content']` 并比对正文值
     （空读数单独判 rc=3，不当"没问题"）；
   - 第 7 步 → `:363-386`：**没改动就保存** 与 **点取消** 两条各自断言 op 条数不变（它挡的是变异 M2，
     即拿掉 `note-actions.ts` 里那句 `if (next === current.content) return`）；
   - 第 8 步第三张截图 → `:388-433`：从任务页搜索点进便签编辑屏，成功后落
     `apps/mobile/evidence/android-notes-3-from-search.png`（`:426`）；
   - 第 9–11 步跨设备三条腿 → `:435-514`：手机侧**数得出远端 op ≥ 1**（下载真跑通）、
     **Postgres 数得出那条 UPD**（界面说保存好≠服务端收到）、**笔记本 node-host 解密后读到同一条**
     （判 `entityId` 相同，不是"恰好同正文"）；
   - 第 12 步 → 三张 png 存在性（`-s` 非空才算在库）。
   ⇒ 所以本条线**不需要改这个脚本**（它此刻也正好被并行会话的 helper 抽取作业碰过，别去抢），
   要做的是 §5-3 那条：**在窗口里把它跑完并把三张图逐张看**。
   ⚠️ 复跑现量：`grep -cE '^\s*(ok|bad) ' scripts/verify-mobile-notes.sh` → **55**；
   `grep -oE 'android-notes-[0-9][^"]*\.png' scripts/verify-mobile-notes.sh | sort -u` → 三张。

## 4. 环境读数与"窗口开没开"的**权威载体**（00:5x 现量）

🔴 **别再手搭哨兵**：本仓已经有一道开工闸门，它同时查负载（规范阈值）、别人的并行验收、
工作树里有没有别人未提交的源码、iOS 设备名、凭据三件套、服务端就绪、**APK 是否比源码旧**、
以及脚本有没有进自快照 MANIFEST —— 而且**默认 dry-run、退出码 0/1/3 分开**。

```bash
bash scripts/verify-mobile-window-gate.sh --target b   # 四端重装（§5-1）
bash scripts/verify-mobile-window-gate.sh --target c   # 移动端设备验收（§5-3）
```

00:5x 两道的现量（**会过期，跑前重取**）：

| 前置 | target b（00:4x） | target c（00:5x） |
|---|---|---|
| 负载（阈值 **12** = 16 核 × 3/4） | ❌ **144** | ❌ **78** |
| 别人未提交的源码 | ❌ 49 枚 | ❌ 8 枚（**五分钟内从 49 掉到 8** ⇒ 并行会话正在密集提交） |
| 设备独占 | — | ❌ **有移动端验收在跑（pid 11584）** ← 修好的探针当场抓到的那条 `.snap` |
| 模拟器 | ✅ 三台 booted（`heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta`） | ✅ `emulator-5554` 在线 |
| 凭据三件套 | — | ✅ **都在**（不用再跑建号；旧账里"要先 fresh account"这条已过期） |
| 服务端 | — | ⚠️ 闸门报 ✅（`:3000/health` 200），但那**不是够格的判据**：~~同一台 `:3000` 打 `/account/legal-consent` → **404** ⇒ 是旧构建~~ ⇒ §5-3 必须自己起 `:3100`（实测无连接）。详见 §5-3。**22:5x 现量把中间那句否证了**：路由挂在 `/api` 前缀下（`server/src/api.ts:632`），所以不带 `/api` 时 `:3000` 与 `:3100` **都 404**、带 `/api` 时两台**都 401** —— 那条探针对两台机器没有分辨力，它区分的是路径写法不是构建新旧。判"旧服务端"改用工件时刻三元组（进程启动 vs `dist/src/index.js` mtime vs `server/src/**/*.ts` mtime），并已落成复用前的认证门 `certify_server_occupant()`（`14f8bbcd`，见原计划 §7.30 的 ③）。 |
| APK 新鲜度 | — | ❌ **APK 比源码旧**（00:36:59 vs 00:49:01）⇒ 跑它验的是旧 bundle（§7 第 27 条） |
| `reinstall-all.sh` 自身干净 | ✅ | — |

🔴 三条使用注意：

1. **在隔离载体里跑它**，不要只在主检出跑就下结论 —— 它的"别人未提交源码"那条正是
   `reinstall:all` 的不变量，而隔离检出天生满足它；在主检出跑等于把别人的现场算成本轮阻塞。
   （图层上 `git merge-base --is-ancestor main feat/list-parent` = 0，快进可合。⚠️ 括号里这句 00:5x 的读数
   到 01:3x 已退 1 —— main 其后前进 7 笔；合流形态改成落一笔合并提交，见 §5 第 4 步。**这一句留原处是为了让人看清
   "快进可合"的保质期就是一笔文档提交**。）
2. **负载里可能有一截是我自己**（本轮就是：我在跑合并后的九段校验链）。判"窗口开没开"要在
   自己那阵负载过去之后再量，否则会出现"我量到自己的负载、然后判定跑不得"的空转。
3. 闸门 green 只证明**前置**成立，不证明产物是本轮交付 —— §5-1/§5-2/§5-3 各自的判据仍要单独取。
4. 🔴 **设备面那一格：18:5x 起改成"归因"，不再要求实例消失**（改的是我自己搭的看守与启动器，
   权威闸门 `verify-mobile-window-gate.sh` 从头到尾没看过实例）。
   现量成因：`heyta-window-chain25.sh` 的 `android_heyta_busy` 把"com.heyta 立着"直接判成忙，
   而**任何一趟 android 验收/重装收尾都把 App 留在前台** ⇒ 这一格实际永不开 ——
   `/tmp/heyta-chain17.log` 全程 618 轮里 **614 轮**卡在这一格，只有 4 轮走到下一格（那 4 轮又都红在负载）。
   规范判据是另一套：闸门 `:193-199`（3b）与 `:226-234`（C）的设备独占用的是
   `scripts/lib/mobile-e2e-runner-probe.sh` 那**唯一一份**运行者探针。手搭的哨兵比规范判据严，
   严出来的后果不是安全，是 ① 与 ③ 一起饿死 —— 与"永远不成立的判据"那一族是同一件事的另一面。
   新形状（`~/.heyta-window-rigs/heyta-device-occupancy.sh` 三态 + `android_heyta_gate`）：
   读不到设备 ⇒ 拦（不把探针坏当空闲）；有实例**且**探针里有够得着安卓面的运行者 ⇒ 拦、让路（AGENTS §8.9）；
   有实例但宿主侧没有运行者 ⇒ 那是上一趟的**遗留**，放行并把 pid/etime 打进日志。
   iOS 面的运行者不算（跑在模拟器上，不占 `emulator-5554`）。
   判据：`heyta-device-occupancy-fixture.sh` 六臂（空闲／读不到／遗留／有人驱动／只有 iOS 面／换形）
   —— **第一趟就照出一个会让这道门形同虚设的缺陷**：`android_heyta_gate` 声明了 `runners`
   却漏了 `= "$1"`，于是任何"有运行者"的读数都被读成空、A4/A6 两条必拦的臂退 0。
   复跑：`bash ~/.heyta-window-rigs/heyta-device-occupancy-fixture.sh`（期望 `GREEN=六臂都对`）。
   ⚠️ 旧调用方（chain25 / launcher v8）按 `rc != 0 ⇒ 拦` 读这三态 ⇒ 改 lib 那天它们行为不变，
   不存在"动了共享 lib 就悄悄放宽别人那条链"的窗口；本线的看守已换 `heyta-window-chain26.sh`
   （`LOG=/tmp/heyta-chain18.log`），启动器换 v9（durable 与 `/tmp` 两份 md5 相同）。
   📌 待入 traps **#264**（现量：`environment-traps.md` 工作树最大号 263、HEAD 228、该书 +735 行未提交
   ⇒ 按"目标台账正脏着几百行时不往它追加"的规矩改投本文件）：
   **判据比规范判据严，本身就是一种坏判据** —— 它表现为"每次拦、理由听起来都对"，
   代价是这条线永远交付不了；写门之前先问"规范裁判是谁、它看什么"。
   同批照出的第二格（取证形状）：chain25 那句 `printf '%s' "$DEVOUT" | cut -c1-170` 从**头**截，
   而答案在**尾**（拦的那一句 + 被点名的运行者）⇒ 18:5x 现量 `grep -c 有运行者正驱动安卓面 = 0`，
   也就是这条门每次都说"拦"却从没把**为什么**写进日志。v26 改成 `tail -2` + 单独打设备行。
   🔴 **19:14:32 现量更正（原句留在上面不删）**：`#264` 这一枚已被另一条线写走 —— 该书工作树最大号已到 **264**（那条讲的是 `ios-ax-shim.py` / `--companion-path` 混用），本线这一枚应挂 **#265**，而取号仍按搬运那一刻现量。原句写 #264 正是「把瞬时读数当长期身份」的一次现形。

> ⚠️ **③ 的历史读数只到第 4 步为止是有效的**（19:06 现量回查 `/tmp/notes-run7.log`，07:06 那一趟）：
> 第 0–4 步全绿（含第 4 步"编辑框初值精确相等"），第 5 步起整片红，而**根因不在产品**：
> 失败打印把 `Sun, Oct 4 / Gmail / Photos / … / heyta` 一整串**桌面**内容带了出来 ——
> 那是 `com.google.android.apps.nexuslauncher` 的工作区，也就是说那一趟在中途被顶出了前台。
> 全文 `grep -iE 'crash|FATAL|AndroidRuntime|ANR'` **只有第 0 步那句"crash 缓冲区已清空"**，
> 没有任何崩溃证据。⇒ 判读规则：**第 5 步及以后的红，先按"设备被抢占"归因，不按"便签编辑链坏了"归因**，
> 判据就是失败打印里那串 launcher 内容（脚本自己有重新拉起腿，见同一日志第 13 行 `↻ 前台是…重新拉起`）。
> 这正是窗口门要防的那件事，也是上面把设备面那一格改成归因的原因 ——
> 但注意**归因门管的是起跑前**，起跑中被抢走仍要靠脚本自己的第 0 步之后每步重读前台。
> 🔴 另一条现场事实：`scripts/verify-mobile-notes.sh` 此刻在主检出是 **`M`**（别人正在改它）。
> ⇒ 本线**不动它**（动了就是三方冲突）；链 ③ 的输入门要求"载体那份 == 载体 HEAD 的 blob"，
> 主检出的脏字节进不了载体，所以这不影响起跑，只影响"下一版 needle 会不会变"（四条 needle 19:06 现量
> 在当前 HEAD 分别命中 1/6/1/7 次）。

> 🟠 **19:10:40 现量给闸门属主的一条形状**（不是本线要改的东西，本线只登记）：
> `--target c` 的设备独占**不分平台** —— 此刻唯一在跑的运行者是
> `scripts/.verify-mobile-ios.sh.snap.19156`（跑在 iOS 模拟器上，一次 `adb` 都不发），
> 而闸门 C 分支照样报 `❌ 有移动端验收在跑（pid：19156）`。
> ⇒ 一台 `emulator-5554` 会被整条 iOS 线钉住。这**落在探针自己写明的保守侧**
> （`scripts/lib/mobile-e2e-runner-probe.sh` 文件头：误报只是白等一个窗口，漏报会清掉别人的现场），
> 而且它不会永久死锁（iOS 那趟会结束），所以本线**不放宽、也不改别人的规范判据**。
> 值得属主拍的只有一件事：要不要按 argv 的平台分流（`verify-mobile-ios|simctl` 归 iOS 面，
> 其余归安卓面），以及谁承担这个判断。
> 🔴 顺带一条**本线自己刚踩过的对照**：链的归因门（`android_heyta_gate`）在"只有 iOS 运行者 + 安卓有遗留实例"时
> 是**放行**的，而闸门在这一格是**拦**的 —— 两边都拦得住是因为链把闸门当最终裁判（v18 起 ③ 必须 `--target c` 退 0）。
> 下一位若把归因门当唯一裁判，就会比规范判据**宽**，那是与"比规范判据严"相反方向的同一个错。

> 🔴 **19:12 现量：① 的 windows 腿判据是 5 条，不是 4 条** —— 记账时按代码读，不按文档句子读。
> `scripts/lib/msix-install-facts.sh:17-23` 的 `MSIX_REQUIRED_FACTS` 现在是
> `ADD_APPX=OK` / `RESULT=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / **`SHORTCUT_OK=True`**（第 5 枚是别人加的），
> 消费方 `:41` 逐条找、`:48` 打印"判据齐了：${#MSIX_REQUIRED_FACTS[@]} 条全在位"（条数现取，不写死）；
> 生产者也在位：`apps/desktop-windows/scripts/install-and-capture.ps1:236` 写 `SHORTCUT_OK=`。
> ⇒ **契约两侧齐全，① 不缺东西**。而"四条"这句还留在多处：现量
> `grep -rn 'M2D=OK' --include='*.md' . | grep -v '/.worktrees/' | grep -v SHORTCUT`
> 命中 **21 行**（多数是当时的**历史读数**，那类不需要改，也不该改）。
> 要分清的是**哪一种在替现在的实现说话**：Goal 台账 §7.31.7（`:3017`）那张表把自己的口径写成
> "**现读实现**"，`AGENTS.md:382` 的收尾表和 `PROGRESS.md:958` 的判据列也是规范性表述
> —— 这三处照旧读就会漏掉 `SHORTCUT_OK`。`docs/reference/environment-traps.md:5071` 已经跟着改成五条了，
> 这正是"同一个结论句落在多处 ⇒ 改一处必 sweep 全仓"的一次现量复现。
> 本线只登记不代改：`AGENTS.md` 此刻是 `M`（别人在写），§7.31.7 也在正被另一条线写的文件里。

> ✅ **19:20:44 现量：把"拦路的是活的还是在挂"这件事量出来了** —— 别再照 B67 那一版去等一个已经消失的进程。
> 此刻占设备的是**日历/r14c 那条线**：`heyta-wt-r14c/scripts/.verify-mobile-due-time.sh.snap.77184`
> （规范探针报的是它的子 bash `2434`，年龄 13 秒；驱动者 `77184`），
> 它把日志写在 `/private/tmp/ht-r14c-chain.83401.log`（`lsof -a -p <探针给的 pid> -F fn` 读出来的）。
> **判"活着"的证据不是 CPU 时间**（bash 驱动者在 `adb`/`sleep` 上本来就是 `0:00.2x` 不动），
> 而是**子进程在轮转 + 它的日志在长**：`ps -o etime= -p <探针 pid>` 每次都是新的十几秒，
> `lsof -a -p <pid> -F fn` 里那枚 `.log` 的 mtime 跟着走。
> 两件事都成立 ⇒ 这是**对手在干活**，处置方式只能是等；
> 反之若两者都停（子进程不换、日志 mtime 冻结、累计 CPU 不动），那才是 B67 那种"要人拍板"的挂住。
> 现量命令（每次自己跑，别抄这一行）：
> `. scripts/lib/mobile-e2e-runner-probe.sh; MOBILE_E2E_PROBE_ME=$$ mobile_e2e_runner_lines`，
> 然后对报出来的 pid 跑 `ps -o etime=,time= -p <pid>` 两次隔 20 秒、再 `lsof -a -p <pid> -F fn | grep '\\.log$'`。

## 5. 下一步（有序，一次一个会话做得完的量）

> ✅ **19:04 现量把 ④ 在当前 HEAD 逐项复核过（不重做，只证明它仍然成立）**：
> `ProjectActions.setParent` 在 `packages/app-host/src/project-actions.ts:109`（接口）与 `:280`（实现），
> 守卫走 `validateProjectParentChange` 的**封闭集合 verdict** —— 拒绝时抛
> `改父被拒绝（reason）：entityId → 顶级`，**不静默降级成空操作**；清除写成 `undefined → null`
> （JSON 里键必须存在才表达"清掉"）。两端消费者：web `apps/web/src/features/projects/store.ts`
> 与 `features/tasks/SubtaskPicker.tsx`、mobile `apps/mobile/src/screens/ListsSection.tsx`、
> 共享 `packages/ui/src/projects/FolderPicker.tsx`。词条两侧都在：
> `common.organizer.folder.{title,button,current,none,reject.cycle}` 与 `mobile.detail.field.parent`
> 在 `zh-CN.ts` 与 `en.ts` 各命中 1 次。
> ⚠️ 顺手记一条**探针形状**（它差点产出一句假结论）：i18n 那两个文件名是不对称的
> （`zh-CN.ts` / `en.ts`）。按 `en-US.ts` 去 grep 得到的是 `No such file` + 空计数 ——
> **那是探针坏了，不是"英文词条缺失"**。⇒ 待入 traps（现量工作树最大号 263，该书仍 +735 行未提交，
> 按"正脏着几百行时不往它追加"的规矩先落本文件）。

> 📌 **18:44:56 现量：§7.30 ① 那条"死等门"已经消失** ——
> `pgrep -f 'package-app\.sh'` 空、`pgrep -f notarytool` 空、`pgrep -f 'reinstall-all\.sh'` 当时也空，
> `93817 / 95477 / 98934` 三代（05:1x 起钉住 ① 与 ③ 的那条 `notarytool submit --wait`）**都不在了**。
> ⇒ 后来者不要再照 §7.30 ① 那句"解除条件是 pid 95477 消失"去等它 —— 那一格已成立，
> 现在真正拦着 ①③ 的是**另一形状**：宿主侧有真运行者（18:47 现量 `84443` = batch2 载体里那趟
> `.verify-mobile-card-export.sh.snap.84443`；18:49 现量规范闸门 `--target c` 报 `REDS=load,src,dev,apk`，
> 负载 21、别人未提交源码含 `packages/shared-schema`/`server/*`、APK 15:02 比源码 17:39 旧）。
> 这条更正同时是一次**"读数的保质期"**示范：04:02→08:2x 四次复量都写"形状没变，只是更久"，
> 第五次（18:44）形状整个换了。每次引用"卡在哪条 pid"之前都要重新现量，别抄上一行的时长。

> 编号是对外引用的锚（Goal 与记忆里的"§5-4"指的就是父子层级），**只做不做序**。

1. 等窗口（**判据 = §4 那道闸门 `--target b` 在隔离载体里退 0**，别再自己数负载）
   → 跑 `pnpm reinstall:all`，要 `INNER_EXIT=0` 与四张**逐张写明各自钉到哪一步**的截图（AGENTS §6.2 规定一：人必须打开看图）。
   ⚠️ 载体的建法（本轮踩过一条**危险**的弯路，别再走）：`git worktree add --detach <新路径> main` →
   在**那个载体里** `pnpm install --prefer-offline`（本仓既有形态是每个 worktree 各有一份真 `node_modules`）。
   🔴 **不要软链主检出的 `node_modules` 过去** —— pnpm 会判定它是"外来的 modules 目录"并试图 purge，
   只因没有 TTY 才中止；加了 `CI=true` 就会顺着链接删掉**全部并行会话共用的那棵 4.5 GB 树**（见 §6 第一条）。
   之后：`pnpm reinstall:all` 第 0 段自己会 `pnpm -r build`，iOS 段会自愈 `pod install`。
   **先建载体再做重活**是错的（install/build 会把负载顶上去，反而把窗口关掉），
   顺序应是：闸门报绿 → 装载体 → 一条后台链跑完四段 → 逐段取证。
   ✅ **载体本轮已建好并验可用**（00:5x）：`../heyta-wt-reinstall`，`pnpm install --prefer-offline` 8.6 秒，
   跑 main 里已有的 `packages/domain/tests/activity-categories.spec.ts` → 30 passed；`e2e/` 那份独立依赖也已装。
   🔴 **一条现量收益**：闸门在载体里跑，"**别人未提交的源码**"那 49 枚阻塞**整条消失**，
   只剩负载一条（00:5x 现量 17→14，阈值 12）⇒ 这正是"必须在隔离载体里跑"的量化理由，不是仪式。
   🔴 **必须显式传 `IOS_DEVICE_NAME`**：脚本默认值是 `iPhone 17 Pro`，而这台机器 booted 的是
   `heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta`（名字带空格的也算），
   照默认值走会匹配不上（脚本自己会打印候选并提示加 `--only ios`）。设备名每次现取：
   `/usr/bin/xcrun simctl list devices booted | grep '(Booted)'`。
   启动器：`/tmp/heyta-run-reinstall.sh`（体检模式）→ 加 `--go` 真跑；它会把载体对齐到**当时**的 main HEAD，
   且只在 `pnpm-lock.yaml`/`package.json` 变化时重装。
   🔴 **但"取 booted 列表第一台"这一条是错的，01:4x 现场把它照出来了**：三台 booted 里
   `heyta-ios-isolated` 的 `launchctl list` 有 `UIKitApplication:com.heyta`（**App 正在跑**），
   而那台里装的那枚 mtime = **01:38**（两分钟前）—— 那是别人这一轮的 iOS 现场，
   而 ios 段拿到名字之后第一件事是 `simctl uninstall`。选择规则（已写进启动器）：
   **逐台读设备自己的 launchctl，只挑没跑着 com.heyta 的那台；每台都读空则不跑并退出 3**（外部显式传的
   `IOS_DEVICE_NAME` 优先，但占用表照打）。为什么不用 `ps`：人肉点的、别的工具的会话都不在进程表里留名字
   （§7 那条"读 0 不等于没人用"的第 N 次应验），而设备侧读数不会说谎。
   ⚠️ **这条判据本身差点是坏的**：第一版名字切片写成 `sed 's/ \((.*)\) \(Booted\).*/\1/'`，
   贪心匹配把 UDID 一起粘进名字（打印成 `heyta-iphone-17proFE195661-…`）⇒ 传出去**永远匹配不上**，
   症状看起来像"这台机器没有可用模拟器"。现量两条对照才修对：名字保留空格（`iPhone Duo heyta`）、
   `running_heyta` 三台里恰好 `1 / 0 / 0`。
   🔴 **闸门文件本身没动**：`scripts/verify-mobile-window-gate.sh` 此刻是 `M`（+23/-2，别人正在往里加
   "iOS 目标取不到就停"那一段 —— 与我这条**同一个不变量的另一侧**）。撞车判据是"该文件有别人的未提交 diff"，
   所以缺口落在我自己的启动器里，**登记**给它属主：B 段目前只在 `>1 台 booted` 时打一句 ⚠️，
   没有"目标那台里 App 正在跑"这一条 FAIL。复跑现量：
   `for u in $(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}'); do echo "$u $(xcrun simctl spawn $u launchctl list 2>/dev/null | grep -c UIKitApplication:com.heyta)"; done`。
   🔴 **android 那一侧同一个洞，而且当场就有**：01:4x 现量 `emulator-5554` 上
   `pidof com.heyta` = **13309**、`mCurrentFocus` = `com.heyta/com.heytamobile.MainActivity` —— App 正在前台跑。
   ① 的 android 段会 `adb uninstall` 它、③ 的第 0 步会 `pm clear` 它的库。两条启动器现在都在闸门之后
   **再读一次设备自己**（`/tmp/heyta-device-occupancy.sh`，只读查询，不 tap 不 dump）。
   这条探针自己按 §7 元规则第二条验过**三条臂**（用假 `adb` 做夹具，不碰真设备）：
   可读且没跑 ⇒ **0（空闲）**；可读且在跑 ⇒ **1**；**`get-state` 失败 ⇒ 1 并打印"不能当成空闲"**。
   第三臂是这里唯一有牙的地方 —— `pidof` 返回空串有两种成因（"没跑"与"adb 连不上"），
   把它们合成同一个读数就等于"探针坏了看起来像空闲"。**"空闲"那一臂不能靠真设备验**
   （要它空就得停掉别人的 App），所以用夹具；夹具用完即删。
   🔴 **取证图的"存在"不是取证**：`/tmp/heyta-reinstall-*` 那四张（mac 是**两张**：窗口 + `.webview`）
   与 `apps/mobile/evidence/android-notes-*.png` 三张，上一轮就在（01:4x 现量：mac 23:05:50、android 23:34:50），
   ⇒ 两条启动器现在都在起跑前记 `RUN_START`，并按 mtime 打 `[本轮新生] / [陈旧-早于本轮起跑]`。旧的那条写法还带一个 glob
   `apps/mobile/ios/build/**/*.png` —— bash 默认没开 globstar，它**不递归**，缺图时表现成"这一端没打印"。
   ⚠️ 隔离检出里 `pnpm -r typecheck` 会因 `packages/legal/dist`、`apps/node-host/dist` 缺而报一串
   `TS2307`（那是载体不全不是源码错，见 §6）。
2. 同一窗口内补跑那 3 段 Playwright，然后跑满 `pnpm check`，把**可过段数 + 载体 sha** 一起记账。
   🔴 **记账落点这条 02:1x 改了**：旧决定是"落本文件、不落 Goal 台账"，理由是那本台账正挂着别人未提交改动
   （往脏着的共享台账追加，别人一次整文件 `git add` 就把我那段抹回去）。
   **02:1x 现量四本共享台账的未提交行数全是 0**（`goal-multi-end-coverage.md` / `environment-traps.md` /
   `PROGRESS.md` / `BLOCKED.md`）⇒ 原由不成立，读数以**目标原话点名的 `goal-multi-end-coverage.md` §7.30** 为准。
   ⚠️ 但这条决定本身也是瞬时读数：**动笔那一刻先重量一次**
   `git status --porcelain -- docs/plans/goal-multi-end-coverage.md`，非空就退回本文件并标"待入 §7.30"。
   ✅ **02:1x 已把槽建好**（重量后该文件对 git 干净、暂存为空 ⇒ 纯追加一节提交）：那本台账末尾现在有
   **§7.30「§5 四段的记账槽」**，四段各一条"待填 + 现量命令"，**零读数**（建槽时四段都没起跑）。
   后续填的是**自己那一节里的行**，不再往文件末尾的追加区抢编号。
   （上一段那句"不 plumbing 进 Goal 台账"的完整理由与反向事故见 §6；本文件同时保留**同一份读数的第二住处**，
   因为"一段文档的存活期取决于还有谁持有它的旧副本"。）
   ⚠️ **本轮把这条的前置全部做实了**（开窗即执行，启动器 `/tmp/heyta-run-checks.sh`，体检模式已过）：
   三段名经 `package.json` 的 `scripts` 键核过（`check:ai-e2e` / `check:privacy-consent-e2e` /
   `check:landing-e2e` 都在），段数**在脚本里现取**（02:3x 载体 `f08b26e7` 现取 = **74**，
   本文件早先写的 62 / 63 都是**上一批 main 的读数**，这一小时并进三条长期分支后栅栏变多了，见 §0.5）；
   载体里 `e2e/` 那份独立依赖已 `pnpm install`（269 ms，Playwright 1.63 → `chromium-1243` 缓存已在）；
   ✅ **02:35–02:41 这一趟真跑了**（载体 `f08b26e7`；窗口 02:35:26 开：闸门 `--target b` 退 0、负载现量 12 = 阈值 12）：
   整条 `pnpm check` `CHECK_EXIT=1`，**断因是环境**（第 8 段被本机内存闸门拒，持锁 pid 34659 = 另一条会话的
   `verify:handoff:prod -- --mobile-only`）；逐段表 **74 段 = 64 `rc=0` / 9 `rc=1` / 1 `rc=134`**，
   十条非绿**逐条读过原文**才归因：九条属别线（`ui-provider` / `theme` / `selection-single-source` /
   `ui-language` / `legal-permissions` / `image-license` / `crosslang-contract`(134) / `shell-unicode` /
   `-r test` 里倒数日与调休那两枚），第十条是**我的**那份未提交 spec 里一个反引号写成了单引号。
   完整读数记在 Goal 台账 §7.30 的 ② 那一条，这里留作**第二住处**（一段文档的存活期取决于还有谁持有旧副本）。
   🔴 **这一趟之后启动器 `/tmp/heyta-run-checks.sh` 补了四道门**（每一条都是被现量照出来的，不是预防性加戏）：
   - **1b 内存锁门**：`/tmp/tfa-test.lock` 是**本机内存闸门的 pid 文件**，读 pid → `ps -p` 活着即 `exit 3`，
     并把**它的命令行**一起打印 —— 拒绝语里带着持锁者的命令，等于免费拿到一条归因读数（上一条 §5-2 那次
     `CHECK_EXIT=1` 就是靠它认出 pid 34659 是另一条会话的 `verify:handoff:prod`）。逃生门 `HEYTA_TFA_OK=1`。
   - **2a dist 门**：三段 e2e 的 webServer 是 vite，而 vite 解析 `@heyta/ui` 读的是 `packages/*/dist` ——
     隔离载体默认没构建 ⇒ 症状是 `Failed to resolve entry for package "@heyta/ui"`，
     读起来像产品坏了，实际是**载体不全**。现在缺 dist 就先 `timeout 900 pnpm -r build`，补不上 `exit 3`。
     ⚠️ **这条谓词第一次写出来永远不触发**，被一正一反两枚夹具抓出两个缺陷：① `require(相对路径)` 被 Node
     当**模块名**解析（改成 `readFileSync` + `JSON.parse`，且不再 `2>/dev/null` 吞掉报错）；
     ② 判据写的是 `/build/.test(...)`，任何含 `build` 子串的脚本名都会命中。真实载体读数：有 build 脚本的包 **14** 个、MISS 为空。
   - **第 3 步前的端口复量**：端口门在 1b/2a 之前过一次，而 2a 那次构建可能跑上十几分钟 ——
     两道门之间别人把 4318/4319/4320 占了，就会拿一条带 SIGKILL 前置的链去踩（traps #87）。
     现在**起跑前再量一次**，busy 就整段不起（`CHECK_EXIT=skip` + `SEG … rc=SKIP-PORTS`），
     且**不打印上一趟的日志尾部**（那会让人把旧读数当本轮的）。两臂对照做过：占住 4399 ⇒ `DECISION=SKIP`，全空 ⇒ `DECISION=RUN`。
   - **三处 `curl` 全加 `--noproxy '*'`**：这台机器的代理会把对回环端口的探测变成另一种东西
     （§7 里 fake-ip 那一族的同源问题），去掉代理之后"空闲/被占"才是端口自己的读数。
   🔴 **起跑前必须 `4318/4319/4320` 三个端口空闲**，因为 `check:ai-e2e` 的前置会对它们发 SIGKILL（traps #87）
   —— 启动器把这一步做成硬门：只要有一个是 busy 就 **exit 3 不跑**，绝不为凑自己的读数杀掉别人的 dev server。
   00:5x 现量：三个端口 + `:3000` **全部空闲**（`:3000` 上那台旧构建已经退场）。
   ⚠️ **同一条读数在 01:3x 已翻面**（现量 `lsof -ti tcp:<p> -sTCP:LISTEN`）：`4318`=pid 92385、`4319`=pid 92369、
   `3000`=pid 70256 都**被占**，`3100/4320/4322` 仍空 ⇒ ② 此刻起跑会按设计 exit 3。**端口空闲是趟间瞬时读数，
   不许把上一趟的"全空闲"带到下一趟**（这正是启动器每次都重量的原因）。
   ⚠️ **十分钟内它又翻回来自**（01:5x `curl` 法现量：4318/4319/4320 + 3100 全 free，而同一刻负载 185）
   ⇒ 端口与负载是**两条独立的门**：端口空了不等于窗口开了，取的是全部成立的那个交集。
   🔴 **02:0x 把"可过段数"这条交付物的取法定下来**（原话要的正是这个数，而它**不能**从一次全量运行里读出来）：
   `pnpm check` 是一条 `&&` 串，断段之后**各段一次都没执行**，且日志里**不带段名**（整条链只回显一次，
   这是 §7 里记过的取证陷阱）⇒ 断了以后那些段既不能算绿也不能算红，只能标"没有读数"。
   所以启动器现在给**两条分开报的读数**，不许互相冒充：
   ① **整条 `pnpm check` 的 exit code**（回答"链绿不绿"）；
   ② 断了才跑的**逐段表** `/tmp/check-seg-by-seg.log`（回答"每一段在自己的读数下过不过"），
   段名/段序从 `package.json` 的 `scripts.check` 现取（**02:0x 那次现取 = 63；02:3x 现取 = 74**，抄数字一定漂）。
   逐段表里三条 e2e 段**起跑前重查一次端口**，busy 就记 `rc=SKIP-PORTS` 并**跳过** ——
   既不冒充"过"，也不冒充"红"（为了凑自己的段数去杀别人的 dev server 是 traps #87 那个动作，不做）。
   记账闭合判据（02:0x 用假命令离线验过，不执行真段）：`PASS + FAIL + SKIP == 总数 63`，
   实测 `60 / 0 / 3` ⇒ 三条 e2e 段被 case 认出的那一步本身也有牙。
3. **把 `verify:mobile-notes` 整段跑完**（🔴 判据**不需要写** —— 第 6/7 步的 op 判据、第 8 步第三张截图、
   第 9–11 步跨设备三条腿**已经在脚本里**，带行号的现量见 §3 第 4 条）。
   🔴 **两个前置在本轮被现量改了**：① 凭据三件套**已经在**（`--target c` 报 ✅），不需要再建号；
   ② 端口那条旧账**被印证了**，而新闸门那句"`:3000` 就绪"**不够格当判据**（00:5x 定点实测）：
   `:3000/health` → **200**，但 `:3000/account/legal-consent` → **404**
   ⇒ `:3000` 上跑的是**旧构建**（没有那条路由），照旧必须**自己起 `:3100`**
   （`bash scripts/mobile-e2e-up.sh` 是仓内现成的起服务端 + 建号入口；`:3100` 此刻实测无连接 = 空闲）。
   闸门只 `curl /health | grep '"status":"ok"'` ⇒ 它**分不出新旧构建**，这条判据要加就得加在它属主那边
   （改法：同一条 curl 之后对 `:3100` 与 `:3000` 各打一次 `/account/legal-consent`，404 与 200/401 的差就是新旧）。
   ⚠️ 还有一条硬前置：**APK 比源码旧**（闸门 00:5x 现量）⇒
   必须先 `pnpm --filter @heyta/ui build && pnpm build:android` 再装，否则验的是旧 bundle（§7 第 27 条）。
   📌 本轮顺带踩到一条探针教训：我用 `lsof -nP -iTCP:3000 -sTCP:LISTEN` 得到"没有监听"，而 `curl` 拿到 200 ——
   **那是探针够不着**（监听进程不在我这个用户可见范围），不是"服务不存在"。§7 元规则第一条又应验一次。
   ✅ **01:3x 补三条只读前置（开窗即执行，不用现场再判断）**：
   ① **便签整条链已在 HEAD 里，不依赖任何未提交改动** —— `git cat-file -e HEAD:<f>` 对
   `apps/mobile/src/screens/NoteEditScreen.tsx` / `packages/ui/src/notes/NoteEditor.tsx` /
   `packages/app-host/src/note-actions.ts` 三处全 yes，且 `git status --porcelain | grep -i note` **0 条**
   ⇒ ③ 可以**完全在 HEAD 载体里跑**，不必回主检出（此前没验过这一点）。
   ② 设备侧 adb 可见的只有 `emulator-5554`（`com.heyta` versionName=1.0）；`:3100` 空着 ⇒ ③ 那条"必须自己起服务端"仍然成立。
   ③ 现场有一条**别人正在跑的 `react-native bundle --platform android`**（pid 90249）—— 这正是窗口判据里
   "别人的打包进程"那一档，所以此刻**不启动**我这边的重打 APK（它同时是 ③ 的硬前置与最重的一步）。
   🔴 **01:3x 一个决定：③ 的载体换成隔离检出**，依据是同一脚本在同一对端口上的 A/B 现量
   （`HEYTA_LOAD_GATE_WAIT=0 PORT=3100 bash scripts/verify-mobile-window-gate.sh --target c`）：
   | 同一道 C 闸门 | 主检出 | 载体 `../heyta-wt-reinstall` |
   |---|---|---|
   | 未提交源码 | ❌ **67 枚**（00:5x 那次是 49 枚 —— 这本身就是会漂的数） | ✅ `packages/ apps/ server/` 里没有未提交的修改 |
   | APK | ❌ 比源码旧（APK 00:55:22 / 源码 01:26:50） | ❌ **不存在**（那条产物路径在载体里从来没打过） |
   | 其余各条 | 两边一致：❌ 负载 48>12、❌ 有移动端验收在跑、✅ `emulator-5554` 在线、✅ 凭据三件套齐、❌ 服务端没在 `:3100` | 同 |
   ⇒ 主检出那 67 枚会被打进产物而判据看不出来（闸门自己的话），而便签链全在 HEAD ⇒ **在载体里跑才是"验当前提交"**；
   代价写清楚：**开窗后 ③ 的第一件事是重打 APK**（`pnpm -r build` → `pnpm build:android` → `adb install -r`），
   且三张取证图会落在**载体**的 `apps/mobile/evidence/` 下，收尾要点名提交它们（§7 里那条"验收会重写检出里的 evidence png"）。
   🟢 **一条省事的顺序依赖**：① 的 android 段本来就是"清旧包 → 从当前源码重打 → 卸旧装新"，
   而它也在**同一个载体**里跑 ⇒ **按 §5 的顺序 ①→②→③ 走，③ 的 APK 前置由 ① 顺带做完**；
   只有 ① 的 android 段红了或想跳过 ① 先做 ③ 时，才需要上面那三条命令自己来一遍。
   🔴 **01:5x 现量把这条从"省事"升级成"硬前置"**：载体里 `apps/node-host/dist`、`packages/app-host/dist`、
   `packages/ui/dist`、`packages/sync-core/dist` **四个全缺**（主检出四个全在 —— 同一支脚本两棵树各跑一次，
   载体 rc=3 / 主检出 rc=0，所以这不是探针坏）。③ 的第 11 步要 `apps/node-host/dist/cli.js` 起笔记本那台设备，
   而本验收第 0 步就会 `pm clear` 手机库 —— 探测必须排在破坏性步骤**之前**，否则代价是"设备已清空、跨设备那条腿没做成"。
   启动器已加这道门（缺就打印该按的顺序并退 3）。⇒ **③ 之前必须有 `pnpm -r build`**，
   而 ① 的第 0 段正是它 —— 顺序 ①→②→③ 不是偏好，是被这两个缺件逼出来的。
   ✅ **19:22 现量把"四个全缺"这一格翻过来了**：载体里 `apps/node-host/dist`、`packages/app-host/dist`、
   `packages/ui/dist`、`packages/sync-core/dist` **四枚全在**，`apps/node-host/dist/cli.js` 也在
   ⇒ ③ 不会被启动器那道"缺件退 3"的门拦下，窗口里也不必为它专门排一次 `pnpm -r build`
   （链会不会重建是另一件事：它按"构建输入跨了 51 笔"自己判）。
   ⚠️ 上面那两行描述的是 **01:5x 那一刻**的载体状态，别当现状读 —— 瞬时读数写成持久身份是同一族老毛病。
   ✅ **两条启动器的"会拒跑"这道门本轮已被现量验证有牙**（不是装饰）：
   `bash /tmp/heyta-run-checks.sh`（不带 `--go`）退 **3**，打印 `:4318 = busy / :4319 = busy`；
   `bash /tmp/heyta-run-notes.sh`（已改指向载体，不带 `--go`）退 **3**，打印 `GATE_EXIT=3 / VERDICT=NOT-RUNNING`。
   两者都是**闸门判"现场不成立"**那一支（`verify-mobile-window-gate.sh` 自己的退出码约定是
   0=窗口开 / 3=现场不成立 / 1=用法错，见该文件 `:17-20`），而启动器退 3 之前都先打印了具体哪几条 ❌
   （`/tmp/heyta-notes-preflight.log` 现量 **4 条 ❌**）—— 不是脚本静默失败被当成环境红。
4. ✅ **父子层级选择器：做完（2026-10-03 深夜），在未合并分支 `feat/list-parent`** ——
   细节与判据在 §3.3 第一条。**跨端形态是代拍**（原话把这条列为"要产品负责人拍"）：
   现量依据 = `OrganizerList` 早就渲染一层嵌套、两端同一棵骨架，所以入口挂到它**已有**的插槽上
   就能两端同批，而不是"移动端先做"。
   **回退不写 SHA**（写了就会漂，我自己刚漂过一次）：这条线**没合进 main**，所以"回退"就是不合流；
   真要逐层退，在分支上现量 `git log --oneline 0a61c0a6..feat/list-parent`（写侧 / 界面 / 行为判据 / 注释各一笔），
   从尾往头 `git revert`。
   🔴 **19:48 现量：上面两句是死话，"一条命令回退"到此刻仍未闭合**，逐条写清为什么：
   ① 分支已不存在（`git branch --list feat/list-parent` 空）⇒ `0a61c0a6..feat/list-parent` 这条现量命令跑不出来；
   ② 改成"按层逐笔 revert"也**不成立** —— 在一次性 detached 检出（HEAD=`f3805908`，用完已回收）实测：
      `git revert --no-commit 06c0bfd9` ⇒ **rc=1**，`packages/domain/src/project-hierarchy.ts` 留 `UU`
      （`f41221a8` 那笔重构与 `00b5065c` 回收站批次重写过同一文件），其后 `f9032878` / `776fc23c`
      直接 **rc=128 `unmerged`** ⇒ "历史形状已不允许整体回退"是读数，不是推测；
      （同趟顺手量的一条对照：回退到一半时 `node scripts/check-layering.mjs` 仍 rc=0 ——
      它管的是 `apps/*` 不许重新长出业务/接线，**管不到**这层撤得干不干净，别拿它的绿当这条腿的证据。）
   ③ 所以**够得着的回退是"撤范围"而不是"撤历史"**，位置现取到行：
      删 `apps/mobile/src/screens/ListsSection.tsx` 的 **`:237`–`:272`**
      （`:237` 是那段块注释的 `/*`，`:245` 是 `renderItemExtra={(item) => (`，`:272` 是它的 `)}`；
      下一行 `:273` 是 `onRename=…`，边界不在它里面）。
      共享层与写侧一行不动 ⇒ web 那半不受影响，`OrganizerList` 行骨架本来就没改（两端不传时渲染逐字不变）。
      ⚠️ **残留辅助量这件事有读数额外支持，但最后一步仍未跑**：
      全仓 `**/tsconfig*.json` 里 `noUnusedLocals` / `noUnusedParameters` **零枚命中**
      （阳性对照是同一条 Grep 换 needle `"strict"` ⇒ 命中 5 枚，所以那个 0 是"确实没开"不是"探针没吃到"）
      ⇒ 删掉那 36 行后，只在里面用的 `folderTargets` / `parentOf` / `setFolderError` **不会**让
      `@heyta/mobile` 的 `tsc --noEmit` 转红；而 19:34 现取的 82 段 `check` 清单里**没有 eslint 段**
      ⇒ 也没有别的常驻门禁会因为"留下未用的辅助量"判红。
      🔴 所以真正的代价是**回退要连那几枚辅助量一起摘干净**，而不是"回退会被门禁拦"。
      ✅ **终验已跑完（19:50，临时 detached 检出 `@744114f2`，用完 `git worktree remove` 回收，
      共享主检出零写入）**：`sed '237,272d'` 之后新 `:237` 逐字变成原 `:273` 的 `onRename={(item, next) => {`
      （边界复核过），两趟 `tsc --noEmit -p apps/mobile/tsconfig.json` 的**错误码集合逐字相同**
      （`{error TS2345}` 对 `{error TS2345}`，差集为空）⇒ 摘掉那段**不新增**任何类型错误。
      🔴 必须同时记下那枚基线红的归属：临时检出里报的 `ExportScreen.tsx(218,25) TS2345`
      在**主检出同一条命令下 rc=0、零错误** ⇒ 它是**我这枚临时检出的装置产物**
      （软链过去的 `apps/mobile/node_modules` 里 `@heyta/*` 指回主检出，`dist` 与临时那版源码不同步），
      不是仓里的红。**结论仍然站得住**：判断用的是 A/B 差集，同一装置在两臂里对等地带着那枚假红。
      ⇒ ④ 的登记状态收口为：**功能五项全在 HEAD（19:3x 逐条 file:line 核过），
      "一条命令回退"这一腿已验** —— 形式是 `sed -i '' '237,272d' apps/mobile/src/screens/ListsSection.tsx`
      那一形的摘除（撤的是"代拍"的范围，不是历史），typecheck 无新增错误、
      共享层与写侧一行不动、web 那半不受影响；要撤干净还需连 `folderTargets` / `parentOf` /
      `FolderPicker` 这些只服务于那段的辅助量一起摘（它们不会让门禁红，理由见上面那两条现额）。
   🔴 唯一没做的是**在 main 上落那一笔**：图层上已经**快进可合**
   （`git merge-base --is-ancestor main feat/list-parent` → 0，且合并零冲突、并集已核对，见 §3.3），
   但主检出里那两张词条表还是 `M` ⇒ `--ff-only` 会被 git 拒（它不替你 stash 别人的改动）。
   这一版原先写的是"七个落点正被归档线改着"，那是把**落点清单**当成了**脏清单** —— 交集要现量。
   🔴 **01:3x 现量把上面那句"已经快进可合"否证了，就地更正**：`merge-base --is-ancestor main feat/list-parent`
   现在退 **1**，因为 main 自我那次核对后又前进 **7 笔**（其中 4 笔是本条线自己的 `docs(handoff)`），
   分支侧也领先 7 笔 ⇒ 双向分叉，`--ff-only` 结构上已经不可能，要落的是一笔**合并提交**
   （或先把 main 合进分支再 FF，但那只是把同一件事挪个地方做）。
   ✅ **而"零冲突"这一半仍然成立，并且换了个更合适的探针**（它不需要检出，因此不会撞进别人正在跑的验收）：
   `git merge-tree --write-tree --name-only main feat/list-parent` → **rc=0、只打印一棵树 oid、没有列出任何冲突文件**。
   ⇒ **可迁移的那条**：**"能快进"不是一个稳的合流判据** —— 它的保质期就是下一笔落进 main 的提交，
   连我自己的文档提交都会把它弄失效。稳的两半是：① 合并**干净**（merge-tree 现量，免检出、只读）
   ② 落点**没被人占着**（那两张 `M` 的词条表 —— 这是检出层，git 不会替我 stash 别人的改动）。
   ✅ **01:53:39 那两张表落地了**（看守脚本现量：释放那一刻 `main=5d0b27b9`、`merge-tree rc=0` ⇒
   `VERDICT=CLEAN-MERGE-READY`），第②半的阻塞**解除**。但这一笔**没有当场落**，理由不是技术而是并发：
   合并会**重写主检出工作树里的 14 个文件**，而此刻主检出里有别的会话的 node/esbuild 持有句柄
   （`lsof +D <主检出>` 现量：java 8083 / node 45484 / node 70256 / esbuild 45494 / 三个 bash）。
   这正是记过的那条"**套件跑着时 checkout/merge 会重写工作树 ⇒ 给别人造假红**"。
   ⇒ **落点定在开窗后的第一步**（在 ① 之前），因为紧接着的 ② 全量 `pnpm check` 就是这笔合并的复验；
   交付成参数化脚本 `/tmp/heyta-land-parent-merge.sh`（默认只体检三条门，`--apply` 才动 ref）。
   三条门 01:57 现量全过：`merge-tree rc=0`、`被碰 14 ∩ 未提交 = 0`、**`STAGED_ENTRIES=0`**
   （第三门是新的：`git merge` 落的那笔取的是**索引**内容，索引里有别人 staged 的条目 = 替他们提交半成品，
   与"永不裸 commit"是同一条纪律的另一面）。
   ⚠️ 本来还要加**第四道门**"这棵树上没有别人的测试/构建在跑"，**实测后撤回成诊断打印** ——
   argv 判不出"谁在跑"（同一件事三种写法读数 34/35/1，而真相是有套件在跑），做成门要么恒红要么恒绿；
   理由与那条尾斜杠边界一起记在 **§6 最后一条**。
   🔴 **落之前又补了两条免检出的预检**（都做了双向对照）：
   - **并集闭合**（`/tmp/heyta-merge-i18n-audit.js`）：合并树的键集合 == `main ∪ 分支`。
     现量 zh/en 各 **2994**（main 2983、分支 2992、并集 2994、丢 **0**、凭空多 **0**），我这 **11** 个键两张表都在。
     反证臂：拿 `main^{tree}` 冒充合并结果 ⇒ rc=**1** 并逐条报出丢的那 11 个键。
     这条存在的理由：键集合"两侧自相对等"挡不住"**把 main 那侧的键悄悄丢了**"——密集 key 表上最坏的漂法。
   - **图层自洽**（`/tmp/heyta-tree-import-check.js`，只读 git 对象）：14 个被碰文件的 **135 条**引用在合并树里
     全部解析得到、具名导出都有声明点。🔴 **这条探针第一版是坏的**：它报"49 条解析不到"，
     而真正的成因是我的候选扩展名列表里**没带 `.tsx`**（本仓源码里 `./task-list/TaskList.js` 这种
     带 `.js` 后缀的导入实际落在 `.tsx` 上）—— 差点把"我的探针瞎"写成"合并结果坏了"。
     补上 `.tsx`/`index.tsx` 两种候选后同一棵树 **0 条**解析不到。
     ⇒ 同族教训：**扩展名交替要把长的放前面**，而"解析不到 N 条"这种读数必须先怀疑候选表而不是仓库。
   🔴 **02:3x 现量把上面这一整块的前提否证了：那一笔不需要我落，别线已经落了。**
   `git merge-base --is-ancestor 776fc23c HEAD` → **0**（`776fc23c` 就是写侧那笔），`git branch -a --contains` 里
   `origin/main` 也在，而本地分支 `feat/list-parent` **已被那条 closeout 线合掉并删除** ⇒
   `heyta-land-parent-merge.sh` 里那个 `$BR` 解析不出来，脚本却把它打印成 `VERDICT=有冲突，不合` ——
   **一次假红，而且红的是"已经做完的事"**（下一读它的人会去找那 14 个文件的冲突，而冲突不存在）。
   链因此换 v2：段 1 不再"默认合并"，改成**先验 `776fc23c` 在不在 HEAD 的祖先里**，
   在 ⇒ 只打印接线现量；不在 ⇒ 才回去走那三条门。**换的是判据，不是提示语。**
   HEAD 侧 02:3x 现量：`setParent` 声明 **6** 处、领域层拒因枚举行 **8** 行、`FolderPicker` web/mobile 各 **2** 处、
   `common.organizer.folder.*` 词条 zh/en 各 **11** 条命中。
   ⚠️ 取数本身的探针坑（同一批里踩的）：`git grep -c <rev> -- <path>` 打印的是 `HEAD:路径:条数`，
   我先用 `cut -d: -f2` 取了一轮 ⇒ 拿到的是**文件路径**，打印出来看着完全像个读数。取数只能取**末段**。
   ⇒ **④ 剩下的只有界面取证**：spec 草稿在 `/tmp/list-folder.spec.ts`，
   🔴 **它一次都没跑过**（02:2x 想 `--list` 收集，被本机那道内存闸门以"已有测试在跑"拒绝），
   跑通之前**不进 `e2e/tests/`、不进提交**；取证腿挂在 `heyta-run-checks.sh` 的 **2b 段** ——
   那里直接 `playwright test <那一条 spec>`，**不走** `check:ai-e2e`（它的前置会对 4318/4319/4320 发 SIGKILL）。

5. 若要做热力图/补打卡：那是**翻冻结判据**的权限问题，不是接线问题 —— 需要判卷文件的属主批准改 `growth-display.spec.ts:365`/`:302`。

> 🔴 1/2/3 全都卡在同一个"窗口"上，而窗口由**别人**的负载决定；4 是唯一一件本条线能自己推到底的事，
> 所以它先做完了 —— 这**不**意味着 1/2/3 可以拿它当交付。

## 6. 死胡同警告（这些坑已被现量踩过，别再走一遍）

- 🔴 **`pnpm check:<名字>` 打错名字会得到"非零退出 + 零输出"** —— 我把它读成"门禁红了"，还据此
  定位了一处"我自己引入的形状问题"。**本节早就写着"门禁名的唯一权威来源是 `package.json` 的 `scripts` 键"，
  我还是踩了**，成因比"没读文档"具体：我把**脚本文件名**当成了别名 ——
  文件叫 `scripts/check-l4-no-style.mjs`，而 `scripts` 里的键是 **`check:l4`**，
  于是照文件名拼出来的 `pnpm check:l4-no-style` 根本没有这个脚本。
  判据：跑任何门禁前先列一遍键（`node -e 'console.log(Object.keys(require("./package.json").scripts).filter(k=>k.startsWith("check:")).join("\n"))'`），
  **别名与文件名同名的那条规律不存在**，别靠推。
- 🔴 **隔离工作树里 `pnpm -r typecheck` 红，可能是载体不全而不是源码错**：`@heyta/legal` 与
  `@heyta/node-host` 没 build 时，`apps/landing` / `apps/desktop` 会报一串 `TS2307 Cannot find module`，
  而**改源码怎么改都不会好**。判据：先看那个包有没有 `dist/`。
- 🔴 jsdom 里 `data-testid` 映射成 `dataset.testid`（全小写），**`dataset.testID` 恒 `undefined`** ——
  我在探针里写了一次，得到的是 `TypeError: Cannot read properties of undefined (reading 'slice')`，
  症状长得像"候选集坏了"，坏的是判据自己。用 `getAttribute('data-testid')`。
- **"非零退出的空输出"与"待入 traps"的这两条**（门禁名臆造、载体不全型 TS2307）尚未进
  `docs/reference/environment-traps.md` —— 那个文件此刻在主检出里是 `M`（并行会话在追加），
  按 §3.3 同一条纪律**不往正脏着的共享台账里追加**，先记在这里。
- 🔴 **"一次开窗把 §5 四段全跑完"结构上不成立 —— 等门必须从窗口级下沉到段级**（03:00:47 现量）。
  链 v2 的做法是：等大闸门 `--target b` 退 0，然后顺序跑四段。它真的等开了一次窗（第 10 轮），
  而**四段里有三段被各自的、互不相干的前置挡住**：
  段 ① android 那台设备上 `com.heyta` 正跑着（`pidof`=20246、`mCurrentFocus` 指向它）；
  段 ② `4318`/`4319` 被别人的 vite 占着（正是那道 SIGKILL 门该挡的）；
  段 ③ 另一条移动端验收在跑（pid 47448）+ `:3100` 没服务端 + 载体里没有 release APK。
  ⇒ **负载达标、工作树干净、端口空闲、设备空闲是四件事**，它们不会在同一刻同时成立；
  把"等"做成一次全局事件，等于每开一次窗只成交一段（其余三段白过）。
  修法是链 v3：每段一个等待圈，**只用启动器自己的退出码判"要不要再等"** ——
  三个启动器共同的约定是 `3 = 环境不成立`（可重试），`0 = 真跑过`、`1 = 跑了但红`，
  后两者一律不重试（红了要人看，不是再等一轮）。
  `wait_seg` 本身按元规则第二条做过四臂夹具：前两次 3 第三次 0 ⇒ 返回 **0** 且打两条等待行；
  永远 3 ⇒ 等满 cap 返回 **3**（不许冒充 0）；第一次就 0 ⇒ 不重试；第一次就 1 ⇒ **不重试**、原样返回 1。
  📌 一般规律：**共享资源上的"窗口"是逐段的瞬时读数，不是一个可以被捕获一次的事件**；
  编排里凡是"等条件成立后连着做 N 件事"，都要问一句"这 N 件事的门是同一扇门吗"。
  ⚠️ 顺序仍是 ①→②→③，因为段 ③ 的"载体里有 release APK"这一条前置**由段 ① 产出** ——
  那是真依赖，不是门太严（链头注释里写着，免得后来者把它当成又一处过严）。
- 🔴 **界面取证的 spec 草稿，两条缺陷都是"读起来像产品坏了"的那种**（03:0x 对着 HEAD 源码逐条核）：
  ① 「新建清单」那颗按钮是**开关**（`setAddingProject(!addingProject)`，`ProjectsPanel.tsx:222-232`），
     而建完表单**不收起**（连建几条是常态）⇒ 草稿里"每次 addList 都点一下那颗按钮"在**第二次**
     会把表单关掉，症状是 `input 不可见`，看着像界面坏了，坏的是判据。改成先看 `aria-expanded`。
  ② `getByText('（当前位置）')` 命中的是组件里 `<Text>{name} {current}</Text>` 那两个子节点，
     RN-web 会把它们渲成嵌套 span ⇒ strict-mode 报"匹配到多个"，又是一次假红。
     改成对**整行**断 `toContainText(...)`（存在性不变，参照物换成行本身）。
  📌 可迁移的判据：**写界面判据前先读被断言元素自己那几行源码**（这里就是 `FolderPicker.tsx` 的
     `testID` 拼法、`aria-disabled` 落在哪个节点、文本是不是两个子节点拼的）。
     窗口外的静态核对不是省事的替代 —— 内存闸门连 `playwright test --list` 都拒，
     所以开窗前**只剩**这一种自检，而它确实抓出了两条会各烧一次开窗的缺陷。
- 🔴 **`echo "…\`命令\`…"` 会真的执行那条命令** —— 我在自己的验收启动器里写"这一段的说明"时用反引号包命令名，
  扫出来两枚，两枚的**症状都不是读数错，而是没人要求却发生了事**：
  ① 端口门之后"整条 check 被跳过时打印说明"的那一行会**偷偷跑一次全量 `pnpm check`**，
     而那条链的第 63 段带着对 4318/4319/4320 发 SIGKILL 的前置 —— 我自己写的"绝不为凑读数杀别人 dev server"
     那道门，被一行**说明文字**绕过了；
  ② 另一行会**偷偷跑 `mobile-e2e-up.sh`**（起服务端 + 建号）。
  两枚都因为更前面的闸门先退 3 而**一次都没被执行过** —— 这恰是最危险的性质：日志里永远看不见它，
  只有"环境全绿的那一次"才会发作。修法：说明文字里提命令名一律用「」；并且把这件事做成复扫而不是自觉 ——
  `grep -n '\(echo\|printf\).*`' <我的启动器>` 命中数必须为 0（本轮 5 份里 2 份命中，修完 0）。
  📌 **评估这类缺陷不能看"它有没有被执行过"**，要看它所在的那条分支在环境全绿时会不会走到。
- 🔴 **④ 那条界面取证腿从 check 启动器里搬出来，成了独立一段**（`/tmp/heyta-run-folderspec.sh` 是它的
  单一所有者，check 的 2b 改成**委托**）。理由不是整洁：全量 `pnpm check` 是 74 段、要跑几十分钟，
  而这条 spec 只要 2 分钟，挂在一起等于"要么等一次几十分钟的车，要么这一轮根本没读数" ——
  上一节那个教训在**段内**又成立了一次。退出码约定与另三段一致（3=环境不成立可重试 / 0 / 1），
  且**不并进本段**（否则一条端口空闲的窗会被整段 check 的重跑吃掉）。
- 🔴 **另一条会话也排了 `reinstall:all`**（03:09 现量：pid 81007 `/tmp/queue-reinstall-all.sh`，
  它自己的注释写着"重装会 uninstall/reinstall，抢不得"），但它的前置**只查设备与打包机可达性，
  不查有没有别人正在重装**。对称的互斥不成立时，能证的那半条由我守：我的重装启动器起跑前加一条
  `pgrep -f 'queue-reinstall-all\.sh|scripts/reinstall-all\.sh'`，命中就退 3 并打印对方 pid 与命令行
  （两臂对照：现场正臂命中 `81007`、反臂 pattern 为空 —— 这条门有牙）。
  ⚠️ **"它缺那道门"这条事实交还给那条会话**，不是我去改别人的脚本；AGENTS §8.9 在这里的含义是
  "谁都能先守，但别以为对方也守了"。
- 🔴 **"读工作树里的门禁脚本"会读到一个还没发生的未来**（03:1x 实测，我差点按它写出一条错的决定）：
  主检出里 `scripts/verify-mobile-window-gate.sh` 写着"服务端不计入前置"，我据此以为 ③ 的
  `:3100 有健康服务端` 只是说明行。现量是：**那版还没提交** —— 该文件 `git status` 是 ` M`，
  而 HEAD 那枚 blob（`cb8889fc`，也就是**载体实际跑的那一版**）里连 `GATE_SVC_PORT` 都不存在，
  它无条件探 `PORT`，而且它的 `warn()` 自己就 `FAIL+1`（名字叫 warn，作用是把窗口判关）。
  ⇒ 后果不是措辞问题：③ 的启动器第 1 步要求 `:3100` 有服务端、第 3 步才去起那个服务端 ——
  **一条永远满足不了的门**，03:00:47 那次负载门开着也照样一路退 3。
  修法不是把门改掉（那是别人的地界、也不该为我的读数放宽），而是把"只有这一条 ❌ 不成立"
  **精确认出来**（`NFAIL==1 && 命中『服务端没在 :3100』`），起完栈**再跑一遍闸门**；
  其余任何一条 ❌ 都照常拦。这条分支拿三枚闸门输出夹具验过：只欠服务端 ⇒ 起栈；
  欠服务端 + APK ⇒ 不起；只欠"别的移动端验收在跑" ⇒ 不起。
  📌 **可迁移**：判断"门禁现在会拦什么"只能读**被运行的那一版**（`git show HEAD:<file>` 或干净检出），
  读活树文件等于读别人的未提交意图 —— 与 §7 里"活树红不是提交属性"是同一条，只是方向反过来。
  ✅ **19:2x 现量把这条"还没发生的未来"结了账**（它是**被运行的那一版**了）：
  `git log -S'不计入前置' -- scripts/verify-mobile-window-gate.sh` 现量 = 这句由 **`35dbffe9`（10:12）** 引入，
  而载体 HEAD `1341d71b`（15:06）那枚闸门 blob `ce388c56` 的 `:255` 就是
  `GATE_SVC_PORT="${HEYTA_GATE_SERVER_PORT:-}"`、`:266` 就是 `ℹ️ 服务端不计入前置`
  ⇒ 03:1x 那句"还没提交"当时是真的，但它有保质期 —— 这条 📌 的反面同样成立：**提交态会追上来**。
  🔴 后果要说清：**本线那条精认分支（`NFAIL==1 && 命中『服务端没在 :3100』⇒ 起栈`）现在是死支** ——
  不设 `HEYTA_GATE_SERVER_PORT` 时闸门不再打印那句 ❌，它不可能再命中。死支只是不触发，没有害，
  但**不许再把它当"③ 有服务端保障"**；真正兜住 ③ 的是链 `:170-173` 那格
  `curl :${NOTES_PORT}/health`，而那一格靠的是**别人起的进程**（见 §6 末尾那条）。
- 🔴 **段级等待还会饿死后面的段 —— 要轮转，不要队列**（v3 只跑了 6 分钟就被现量否证）：
  v3 的形状是"段 2 一个 45 轮的等待圈，等完才轮到 2b/3/4"。03:15:15 现量：那一刻 `4318` 已经空出来
  （链的等待行自己打出来的 `4318=000`），而链正卡在段 2 的等待圈里 ——
  **④ 那条 2 分钟的取证腿排不上，而它等的正是那几十秒的空窗**。
  v4 因此把四段做成**每一轮各试一次**（rc=3 就下一轮再试，0/1 就摘出轮转），
  并且顺序仍按 §5 的 ①→④→②→③ 排在一轮之内（① 优先，不抢别人的窗）。
  轮转器本身拿四枚假段做过夹具：永远 3 ⇒ `WAITED-OUT` 且**不越 cap**；第 2 次给 0 ⇒ `DONE-OK` 后不再碰；
  第 1 次给 1 ⇒ `DONE-RED` **不重试**；第 3 次才 0 而 cap=2 ⇒ 那次不许发生（真的没发生）。
  夹具还当场抓到一处我自己写的错：`还在等：…` 那行是在**跑每段之前**拼的，
  于是刚变成 `DONE-RED` 的段也被列进"还在等" —— 列清单必须在整轮跑完后按状态重算。
- 🔴 **① 的重装启动器原来**恒返回 0**（03:3x 读到 ④ 的图时发现）**：脚本跑到最后一行才结束，
  退出码是最后那条 `echo` 的 0，而 `INNER_EXIT=1` 只被打印、没有被带出去 ⇒ **链会把一次红重装记成
  `DONE-OK`**。修：显式 `exit 1`（红）/ `exit 3`（图没凑齐）/ `exit 0`。
  📌 一般规律：**给"轮转/等待器"用的启动器，退出码是它唯一的输出接口** —— 结尾没有显式 `exit`
  就等于把"上一条命令的成败"当成契约，而上一条通常是一句打印。
- 🔴 **"截图拍得到"不是"断言通过"的同义词**（03:33 现量，④ 那一趟）：`list-folder-2-menu-open.png`
  里**看不见菜单** —— 入口挂在侧栏清单区的**最后一行**，而 `FolderPicker` 是**行内展开**（把行撑高），
  展开后菜单落在折线以下。`toBeVisible()` 全过、`1 passed`、图也截了，但"人看过"这一环静默失效；
  而 `fullPage: true` **救不了**（侧栏自己是滚动容器 —— 那条本文件早写过，这次是它和"截图当证据"叠出来的新形状）。
  修：三处涉及展开菜单的截图前先 `scrollIntoViewIfNeeded()`。
- 🔴 **启动器里"目标文件不存在才复制草稿"会让验证台反复跑旧版本**（同一次抓到）：④ 的启动器原来写
  `[ ! -f "$SPEC" ] && cp 草稿 目标` —— 第一次跑之后目标就存在了，**之后我对草稿的修改永远进不了检出**，
  链每轮跑那份旧 spec 并把它的 `1 passed` 当最新读数。这是最省力的假绿：不需要任何东西坏掉，
  只需要时间往前走。修：两边 `git hash-object` 各算一次，**不一致就覆盖并打印两枚 sha**。
- 🔴 **plumbing 提交**新增路径**之后不刷共享索引，别人一次裸 `git commit` 就会把我刚提交的文件删掉**
  （03:45 实测，`80af76f0` 之后当场现量）：`git diff --cached --name-only` 把 `e2e/tests/list-folder.spec.ts`
  与五枚 `apps/web/evidence/list-folder/*.png` 全列了出来，`git status` 给的是 **`D `（已暂存的删除）**，
  而我一条 `git add` 都没执行过。机制：别人的索引是在**旧 HEAD** 上 `read-tree` 出来的，里面没有我这批新路径；
  HEAD 一前进，"索引缺这条"就变成了"暂存了一笔删除"。裸 commit 提交的是整个索引 ⇒ 删的是**我刚提的那批**。
  （traps **#146** 记的是同一条纪律的另一半：刷索引**会**覆盖别人已暂存的条目，所以"别人已暂存的路径不刷"。
  两半合起来才是完整动作：**先 `git ls-files -s -- <路径>` 看有没有别人的暂存，没有才刷**。）
  ✅ 两个提交助手都已补上这一步（`INDEX_REFRESHED` / `INDEX_REFRESH_SKIPPED` / `INDEX_REFRESH_FAIL` 三种打印）。
  **守卫的判据换过一次**，两次都记下来，因为第二版是被现量逼出来的：
  ① 第一版写"索引 sha ≠ HEAD sha 就不刷"，三腿夹具验过（索引没有→刷 / 与 HEAD 一致→刷 / 不同→不刷）——
  然后它**当场把自己的陈旧误判成别人的暂存**：我 03:5x 连提两笔（goal + handoff），提完 goal 那枚的索引
  停在"两笔之前"的 blob，而 `idx==HEAD^` 这种"只往前看一笔"的写法认不出它 ⇒ 一路卡在 `MM`。
  ② 终版判据换成**看工作树**：`工作树 == 新 HEAD` ⇒ 索引里那枚不同的只可能是陈旧（我自己上一笔留下的，
  或别人暂存的内容已被原样提交），刷；`工作树 ≠ HEAD` 且索引 sha ≠ HEAD ⇒ 那才可能是别人**未提交**的
  暂存意图，不刷。理由：**"别人已暂存"这件事的证据是工作树里那份内容，不是索引里那枚 sha**。
  ⚠️ 实现时还踩到一处自己的解析错：`ls-files -s` 一行是 `<mode> <sha> <stage>\t<path>`，
  **sha 在第 2 列**，我第一版取了第 3 列（stage 号），拿它去和 sha 比 ⇒ 永远"别人已暂存"。
- 🔴 **判"界面少画了什么"要先找该形态自己的开关，不要拿像素带当证据**（03:5x，看图时先误判后撤回）：
  我盯着 `list-folder-3-after-move.png` 写下"web 侧栏不画缩进"，几乎要据此登记一条产品缺口。
  两条现量把它否证：① 代码里 `ProjectsPanel.tsx:301-303` 明写着 `renderLeading` 对 `context.isChild`
  返回 `null` ⇒ **"子行有没有那颗文件夹图标"本身就是"它是否进了 16px 嵌套容器"的开关**，而第 4 张里子行
  确实既无图标又已缩进；② 第 3 张拍在点击之后、列表重绘之前 —— 是**时序**不是缺陷。
  中间我还为"精确"写了两轮 PIL 量带，同一行在两版脚本里量出 93/108/100 三个互斥的数（带的 y 区间各抓住了
  图标行/文字行/分隔线），**而每一对数字看起来都像结论**。
  📌 可迁移：**形态开关（代码里已经写着的那个分叉）> 像素统计**；而"登记一条缺口"的门槛不是我看了一眼，
  是能指出证它的那一张图。误判要原地撤回并留下撤回记录（已写进 goal §7.30 的 ④）。
- 🔴 **③ 的启动器里同时躺着另外两枚同族缺陷，都是在它**第一次真跑之前**修掉的**（04:0x）：
  ① **结尾没有显式 `exit`** —— 这一段以 `for … done` 收尾 ⇒ 整个启动器的退出码是最后那条打印的 0，
     `NOTES_EXIT=1`（真红）会被轮转器记成 `DONE-OK`。**这是上一条在 ① 的启动器里那个缺陷的第二种面目**，
     不是新缺陷，是"我修了一处、没修同一族的另外三处"。
  ② **三张取证图没有抄进私有目录** —— 载体的 `apps/mobile/evidence/` 与主检出同名同路径，
     别的会话的设备验收会往同一批文件写（④ 那条腿 03:18 就是这么丢证据的）。
     现在跑完立刻 `cp -p` 到 `/tmp/heyta-notes-evidence-<sha>/`，且**退出码落在张数上**（≠3 ⇒ 退 3 再等一轮）。
  ③ **读数提取的 needle 对齐的是源码形状而不是打印形状**：我第一版写 `sed -n '/step "6\./,/step "8\./p'`，
     而 `step "6. …"` 落到日志里是 `════ 6. … ════`（`scripts/lib/mobile-e2e.sh:151`）⇒ **恒 0 命中**，
     表现是"这一段安静地没输出"，而不是报错 —— 空测量看着最干净那条的第 N 次应验。
     两腿夹具验过（`/tmp/notes-needle-fixture.sh`）：新 needle 段1=3/段2=2/汇总=2，旧 needle=0 ⇒ 这条修正是承重的。
     ⚠️ 夹具**自己也错了两回**（多打了一个 `/` 让 BSD sed 报 `invalid command code`；把"两行判决"写成"≥3 行"），
     两次都是夹具错而不是 needle 错 —— **夹具 FAIL 时先读夹具**，不然会去改一条本来对的判据。
- 🔴 **把一份未跟踪的草稿提交进 HEAD 的那一刻，所有还持有同名未跟踪副本的检出，下一次对齐 HEAD 都会 `checkout` 失败**
  （04:16:56 现量，① 自己撞的）：`80af76f0` 提了 `e2e/tests/list-folder.spec.ts`，而载体里那份还是未跟踪的草稿
  ⇒ `git checkout --detach <新 HEAD>` 报 `The following untracked working tree files would be overwritten`
  并整段红，**设备一个都没碰**。这不是别人的债：**是我提交草稿那一笔制造的**，而我在写那笔的时候没有想到载体。
  ✅ 修法（已进启动器）：对齐之前把 `git ls-files --others --exclude-standard` 与新 HEAD 求交，
  逐枚 `cmp` —— 相同就直接让位（checkout 会写回同样的字节），**不同就先 `cp -p` 搬到
  `/tmp/heyta-carrier-untracked-<时间>/` 再让位**（绝不静默删）。
  📌 一般规律：**"提交未跟踪件"是一个跨检出的动作**，它的落点不止 `git add` 那一枚文件，
  还包括所有持有该路径副本的工作树。
- 🔴 **我那道"别人的重装在跑"的互斥门，pattern 漏掉了真正的运行形态**（同一轮现量）：
  写的是 `scripts/reinstall-all\.sh`，而现场那一跑是 `bash /tmp/heyta-reinstall/scripts/**.reinstall-all.sh.snap.93817**`
  —— 快照脚本带前导点与 `.snap.<pid>` 后缀 ⇒ 旧 pattern 只抓到排队的那两枚（81007/93771），**抓不到正在跑的 93817**。
  两腿对照现量：旧 `81007 93771` / 新 `81007 93771 93817`。这次没造成事故纯属侥幸 ——
  ① 在**对齐 HEAD 那一步**就红了，根本没走到装机。
  📌 **互斥类 pattern 必须拿现场真实命令行做"必须命中"那一腿**，不能只验"pattern 不为空"。
- ⚠️ **链 v5：把已成交的段摘出轮转，不是清理，是让窗**（04:20）。② 的逐段表一段要 35 分钟，
  而 ①/③ 缺的正是这 35 分钟的 CPU —— 拿**已落账的读数**去抢**未成交**的窗，是 §8.9 那条"共享资源独占"的反面。
  🔴 顺带一条形状教训：**"红了就摘出轮转"这条规则本身没错，但红的原因如果是启动器自己的缺陷，
  修完必须手动重新入轮** —— v4 把 ① 记成 `DONE-RED` 之后就不会再碰它，而那一红是上面这两枚缺陷造成的，
  不是产品红。链 v5 因此只轮转 ①/③，且头部注释写明了为什么不带 ②/④（读数的 sha 都在 goal §7.30）。
- 🔴 **`reinstall:all` 的 mac 段可以在一个外部调用上永久挂住，而挂住的那一方同时钉死了所有并行会话**
  （05:04 现量）：`apps/desktop-macos/scripts/package-app.sh:278` 的
  `xcrun notarytool submit … --wait` **没有任何上限**。现场那一跑已经卡在这一行 **1h52m**、CPU 时间 0:00.04：
  ```
  95477 bash apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist
  98934   /Applications/Xcode-27.1.0-Beta.app/…/notarytool submit /tmp/hey…   ← 0.0% CPU，1h51m
  ```
  后果不止它自己：它同时是"有别人在重装"那道互斥门的持有者 ⇒ **我的 ① 与所有并行会话的固定收尾一起被钉住**。
  ✅ 该加的修法（**已写好但刻意还没有落到文件上**，原因见下一条）：给这一段加显式上限
  `HEYTA_NOTARY_TIMEOUT`（默认 900s，`0` = 保留旧的"不设限"），输出先落临时文件再打印以便区分
  `rc=124`（Apple 没回话）与真实拒绝；两种都不许走"✅ 公证通过"、都不装订票据。
  ⚠️ 顺带**否证我自己的一条假设**：我一度以为同一行的 `notarytool … | tail -8 | awk` 是 traps #45
  那一族（管道后 `$?` 是 `tail` 的），读了脚本第 23 行才看到 **`set -euo pipefail` 是开着的** ——
  有 `pipefail` 时这条管道的退出码确实是 `notarytool` 的。**"看着像同一个已知缺陷"不构成证据，要先读被调方的头部。**
- 🔴 **不能在 `bash` 正在执行一个脚本时改那个脚本**（这条决定了上面那笔修法什么时候落）：
  bash 是**按字节偏移增量读脚本文件**的，运行中的那份会从我改后的文件中间继续读 ⇒ 轻则报语法错、
  重则把后半段解释成别的命令。现场 `pid 95477` 正是 `bash …/package-app.sh`，
  所以修法必须等它退出之后再落盘。**落盘前的现量判据**：`pgrep -f 'package-app\.sh'` 为空。
  📌 一般规律：**"这个文件现在干不干净"不只看 `git status`，还要看有没有进程正踩着它执行。**

- 🔴 **别用 `git commit --only <文件>` 提本条线的两份台账** —— 里面此刻混着并行会话的 hunk
  （`goal-multi-end-coverage.md:104` 是他们改的 W9 状态句）。正确做法见 `96f3293d` 的提交信息：
  用 plumbing 造「HEAD + 只含我的行」的 blob，提交后**按路径刷共享索引**（`git update-index --cacheinfo`），
  否则别人一次裸 `git commit` 会把我这几百行倒回去。
- `check:docs` 的**总数是活的**（一小时内 27→32→33→34），别把它当提交属性引用；判归属要用**链接整串**，
  不能用文件名 basename（`README.md` 会假命中），也不能用解析后的绝对路径（文档里写的是相对串）。
- 行内代码（反引号）里的**纯路径**不是链接，`check:docs` 看不见它 —— 别把"没被报"读成"是好的"。
  🔴 但**"文件名 § 节号"这个形状即使在反引号里也会被当章节引用解析**（2026-10-03 实测：我为了转述别人那两处
  失效引用，把 `` `<文件>` §2 `` 写进本文件，`check:docs` 立刻把报错行的文件名换成了本文件 ——
  等于我自己新造了两条死链）。**转述死链时不要带 § 与文件名相邻的写法**，用中文说清是哪一张哪一节。
- 门禁名的唯一权威来源是 `package.json` 的 `scripts` 键（`check:docs` = `node research/tools/docs-link-check.mjs`，
  没有 `scripts/check-docs-link.mjs` 这个文件）。
- 🔴 **提交共享台账（`BLOCKED.md` / `PROGRESS.md`）时，提交内容 = `git show HEAD:<文件>` + 你自己那段文本**，不要拿工作树文件当提交源：追加区是所有会话共用的尾部，"单 hunk + 删除 0 行"只证明形状是追加，**不证明作者是你**（`96f3293d` 就把并行会话的整节替他们提交了，详见 B53）。
- 脚本里开了 `set -o pipefail` 时，**别写 `if ! diff -u A B | grep -q …`**：`diff` 在有差异时退 1，
  整条管道状态就是 1，匹配成功也会被读成失败（本轮在此空转四趟）。改成直接 `grep 文件`。
- 🔴 **别给 linked worktree 软链 `node_modules`（我第一次这么干就差点删掉共享依赖树）**：pnpm 11 在
  `pnpm --filter … exec …` 之前会做 deps 状态校验，发现 `node_modules` 是"外来的"就**试图 purge 整个目录**，
  报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY / Aborted removal of modules directory due to no TTY` ——
  它只因**没有 TTY** 才停手。我的软链指向主检出那棵 4.5 GB / 1185 包的树，加一个 `CI=true` 或
  `confirmModulesPurge=false` 就会顺着链接把它删掉（那是**全部并行会话共用**的）。
  ✅ 本仓既有形态是**每个 worktree 各有一份真 node_modules**（现量：`heyta` 1185 / `-hierarchy` 977 /
  `-batch2` `-w9` `-closeout` 各 974 包），载体准备动作就是在载体里 `pnpm install --prefer-offline`。
  复跑现量：`for d in …; do ls -d "$d/node_modules/.pnpm" | wc -l; done`。
  📌 同轮另一次「先怀疑探针」：我在 `…/All in one Data` 下用相对路径 `heyta/node_modules` 量六个载体，
  得到六个"❌ 无 node_modules"，差点当成自己闯的祸写进文档 —— 真仓库在 `…/All in one Data/01_PROJECTS/heyta`。
  **跨目录量东西一律用绝对路径**，且"全部一样地坏"优先怀疑测量本身（§7 元规则 1）。
- 🔴 **凡是"从 `ps` 的 argv 里正则匹配一个路径"的探针，先问"这个路径里有空格吗"**（00:4x 实测，就是本轮那个
  设备占用门）：本仓路径含空格（`All in one Data`），而 `[^ ]*` 停在第一个空格 ⇒ 整条判据**恒不命中**，
  输出永远"干净"。这类假读数比空值危险：它长得像"没人占着"。写这类探针要么按 argv **字段**判
  （`$3 == "bash"` + 参数逐段拼接），要么先 `printf '%s\n' "<真实 argv>" | <探针>` 喂一次看它中不中。
- 🔴 **`git apply --check` 不是"合并会不会冲突"的判据**（00:5x 实测，我用它推了一条错结论并写进了文档）：
  它比的是**上下文补丁**能不能落，`git merge` 走的是**三方**（有共同祖先）。本轮同一对文件同一时刻
  `apply --check = 1` 而 `git merge = 零冲突` —— **方向反了**，所以那条"三条腿实测"既没预测对也解释不了错。
  判合并只有一条真判据：**在分支侧真合一次**，然后做**语义并集核对**（两侧各自的键/导出/用例逐个数量对齐）。
- 🔴 **任何"我改了但还没点名字提交"的文件都会被并行会话的一次宽 `git add` 吞进他们的提交**
  （00:4–00:5x 实测**两例**，一种新文件、一种改过的跟踪文件）：
  ① 我写的 `scripts/lib/mobile-e2e-runner-probe.sh` 出现在别人的 `f6f2a337`（vault 主题）里；
  ② 我对 `mobile-e2e.sh` 的接线（source 那一行 + 新函数体）**`git log -S` 定源落在别人的 `102d064f`**，
  而我自己那笔 `ad9dce8e` 只剩注释残差 —— 症状是"我提交信息里写的改动，`git show` 里没有"。
  ⇒ 后果不止归属难查：下一个人按我的提交信息去 `git show` 找那几行会找不到，然后以为没做。
  ⇒ 做法：**每个文件保存完就立刻点名字提交**（多文件改动别攒成一笔），并在文档里给**内容级**定源命令：
  `git log --oneline -S '<一行只有我写的代码>' -- <文件>`（别拿 `git log --oneline -- <文件>` 当归属，
  它只告诉你谁最后碰过这个文件）。
  ⚠️ 反过来也别误伤：我按"未跟踪 ⇒ 不归我改"退回过一次对 `verify-mobile-window-gate.sh` 的编辑，
  而它随后被别人提交成已跟踪 —— 那次退回恰好是对的（HEAD 里就是原文），但**理由是错的**：
  未跟踪不等于不能改，"有别人的未提交 diff"才是不能改的判据。
- 两条**本轮自己踩到的命令坑**（都表现为"读数错得很像真相"）：
  ① zsh 下 `${PIPESTATUS[0]}` 是**空值** ⇒ 我打印了一个空退出码，差点当成 0 记进文档；
  ② `bash <lib.sh> <args>` **不会执行**里面定义的函数（脚本只是 source 时才定义），
  于是我那条"NEW 探针读数为空"是**调用形状坏了**，不是探针坏了 —— 判据前先确认函数真的被调到了。
- 🔴 **"有没有别人的套件正在这棵树上跑"用 `ps` 的 argv 判不出来**（01:5x 实测，为了决定能不能落 ④ 那笔合并）：
  同一件事连量三种写法，读数是 **34 / 35 / 1**，而真相是"有一趟 vitest 正在主检出里跑"。
  三种写法各自的坏法不一样：
  ① `grep -E '(vitest|playwright|vite|esbuild)'` 把**观察者自己**那条命令行也数进去
  （本会话那条含 `esbuild` 的探针就在结果里）—— 与 `verify-mobile` 探针的自匹配是同一种坏法；
  ② 改 `[v]itest` 括号防自匹配**只挡正则那一侧**，同一条命令别处还写着明文 `esbuild`，照旧命中；
  ③ 收紧成"必须是 node 可执行 + 路径含 vitest"之后**开始漏**：真 fork worker 的 argv 是
  `…/vitest/dist/workers/forks.js`（`vitest` 后面不是空格），于是"有人正在跑"被读成 **1**，
  而那一个是活了 3 小时 32 分的常驻 esbuild service，跟有没有跑套件无关。
  ⇒ **做成硬门要么恒红要么恒绿，两种都比没有更糟**，所以落 ④ 的第四道门**撤回成诊断打印**。
  能决断的三条留下：合并干净（merge-tree）、`被碰文件 ∩ 未提交 = 0`、`STAGED_ENTRIES=0`；
  "这棵树此刻安不安全"仍然由**负载闸门（窗口）**回答 —— 它是现场读数，不是 argv 猜测。
  顺带一条通用的：路径匹配要带**尾斜杠** `01_PROJECTS/heyta/`，否则 `heyta-wt-reinstall` 里的进程
  会被算进"主检出里有人在跑"（前缀相同、边界不同）。
- 🔴 **本轮我自己犯的一次，写下来而不是抹掉**（02:03）：为了停掉**我自己**那条等窗口的哨兵，
  直接跑了 `pkill -f "verify-mobile-window-gate"`，**没有先 `pgrep` 列出会被打到谁**。
  那条命令按名字匹配所有会话的闸门进程 —— 并行会话如果那一刻正好在自己起跑前跑这道预检，
  就被我掐掉了（症状在他们那边是"闸门莫名中断"，而不会指向这里）。
  这条仓库里已经记过同族的两次（`check:ai-e2e` 的 SIGKILL 前置、`pm clear` 前不探测），
  我这次是**在"停自己的东西"这个由头下做了全网广播式的 kill**。
  ⇒ 正确做法（下次照做，不需要再想）：① 先 `pgrep -f <模式>` 列出 pid 与**它们的父链/工作目录**；
  ② 只 `kill <我自己那个 pid>`（我这条哨兵是 `nohup bash -c '…'`，pid 在启动时就打印过，本来就该直接用它）；
  ③ 只有确认某条模式只属于我这一棵树时才允许按模式杀，且要在命令里带上 `-u $UID` 与逐项排除。
  ⚠️ 这次**无法回滚**（别人那一轮预检的读数已经没了），所以按仓库惯例如实登记，不写成"应该没影响到别人"。

- 🔴 **`check:docs` 现在的红不属于本条线、也不属于仓库**（02:3x 现量 1 处，02:4x 复跑涨到 **6 处**，
  全在**同一份 ADR 的同一节**里 ⇒ 那是那条会话正在写的段落，不是在烂）：
  `docs/adr/0050-e2ee-key-lifecycle-and-recovery.md:122` 链向 `../../scripts/verify-ios-vault-keychain.sh`，
  而后者是**未跟踪**文件（`git ls-files` 命中 **0**）。两条现量把它钉成"别人在飞的段落"而不是仓库债：
  ① `git show HEAD:<那条 ADR>` 的第 122 行是**代码围栏收尾**，那一整节只在主检出的工作树里
  （该 ADR 状态为 `M`）；② 那条链接的成因是同一会话新写了脚本却没 `git add`。
  ⇒ 修法在他们手里是一行（把脚本点名 `git add`），**我不去改那个文件**，也**不放宽判据**。
  ⚠️ 对 §5-2 的影响：② 是在**隔离载体**（detached HEAD）里跑的，那里既没有那节未提交文字也没有那个未跟踪脚本
  ⇒ `check:docs` 在载体里**不会复现这条红**。所以"全量 check 的段数"与"主检出 `pnpm check`"这两个读数
  **不可互换**，报数时必须带载体（与 §7 那条"级联读数要带载体"同族）。
  🔴 顺带自报一条我自己的操作错：这一笔的提交前我先跑了 `check:docs`、拿到 **rc=1**，
  却只 `tail -1` 看一眼就继续提交 —— 判据的红要看**内容**才能归因，退出码不能当闸门用。
  这一条恰好就是它自己把我抓住的例子（那条红与我这一笔无关，但我当时并不知道）。
- 🔴 **"分支不在了"有两种成因，探针必须分得开**（02:3x 现量）：`git merge-tree --write-tree main feat/list-parent`
  报 `not something we can merge` 时，我的脚本直接打印 `VERDICT=有冲突，不合`。真相是**别线已经把它合进 main
  并删了本地分支**（`git merge-base --is-ancestor 776fc23c HEAD` 退 **0**，`origin/main` 也含它）。
  这两种"合不上"在屏幕上长得一模一样，但一个是"去解冲突"，另一个是"活已经干完了、别再去解一场不存在的冲突"。
  ⇒ **凡引用具名 ref 的探针，都要先回答"这个 ref 为什么不在了"**：先查它最后那笔提交在不在 HEAD 的祖先里，
  再谈冲突。`--is-ancestor` 在这里比 `merge-tree` 更便宜，而且它顺带把"我是不是该做这件事"也回答了。

> ✅ **本节那几条"待入 traps"已落权威位置**（02:1x 现量 `environment-traps.md` 未提交行数 = 0 之后才动的笔）：
> **#200** 合流判据不许写"能快进"、**#201** `ps` 的 argv 数不出"谁在跑套件"、**#202** 按名广播 `pkill` 的自报、
> **#203** "分支不在了"被印成"有冲突，不合"（三种成因要分开；`--is-ancestor` 排在 `merge-tree` 前面）。
> 这四条在本节里**继续留着**（本节是这条线的一手过程账，权威文件是通用规则），不是重复登记而是两个层次；
> 下一次接手要引通用编号时引 #200–#203，要复原"当时怎么踩到的"再回来看这里。

- 🔴 **`notarytool submit --wait` 没有上限 ⇒ 一条 `reinstall:all` 可以永久挂住，而挂住的那一方
  同时是"有别人在重装"那道互斥门的持有者**（05:1x 现量，修法已落 `694c05e3`）。
  另一条会话的 mac 段卡在这一行 **1h57m**：`ps -o pid,etime,time,stat` 累计 CPU **0:00.03**，
  `lsof -nP -p <pid> -i` **零条 TCP 连接** ⇒ 它连"正在重试"都不是，不会自己结束。
  它的日志停在 `═══ 1. macOS ═══`，后三段永远不开始；我这边的直接后果是**① 与 ③ 一起被钉住**
  （窗口门要求 `reinstall-all.sh` 不在跑）。
  📌 分"慢"与"死等"就靠这两条 —— 只看 `ELAPSED` 两者长得一样。
  ✅ 修法：`HEYTA_NOTARY_TIMEOUT`（默认 900s，`0` = 显式旧行为）；**超时不等于通过**，
  不装订票据，且 rc=124 与 Apple 真实拒绝分开报（输出因此从管道改临时文件：`set -o pipefail`
  下管道能保住退出码，但会把两种情形压成同一个非零）。裸 macOS 不带 `timeout`（GNU coreutils），
  所以"没有 timeout"是打包机的**默认**情况 ⇒ 另加一条纯 bash 看门狗。
  五臂夹具逐臂量过：`ok`→staple 1 次 / `hang`→"3s 内没有返回"+staple 0 次 / `reject`→rc=1 分支 /
  **无 timeout 二进制的 `hang`**→看门狗仍返回 124 / `TIMEOUT=0`→走"显式不设限"提示但仍判通过。
- 🔴 **"有进程名字匹配 X"不是"X 正在被执行"**（同一条 05:1x，我给自己的补丁落盘工具写的守卫被它挡了一路）。
  守卫原先写 `pgrep -f 'package-app\.sh'` 为空，于是永远红：现场三条命中各读**各的那份**
  —— `/private/tmp/heyta-reinstall/…`（别人的隔离载体）、`.reinstall-all.sh.snap.<pid>`（快照副本），
  而主检出那份**零个 fd**。不变量本体是"我要重写的这个 inode 是否正被某个 bash 读着"，
  实测 bash 运行中一直持有脚本的 fd `255r` ⇒ 守卫改成 `lsof -nP -t -- "$ABS"`，并把每个命中 pid
  各自读的是哪枚**打印出来**（放行这件事本身要可核）。三腿夹具：目标正被执行→退 3；
  另一份副本在执行、目标没人读→放行并打印三份路径；`lsof -t` 单独喂目标→含该 pid（证 lsof 那步不是摆设）。
  📌 这条线上一晚第三次撞同一个代理失真（互斥门那条模式也得从 `reinstall-all\.sh` 扩到
  `queue-reinstall-all\.sh`）：**要判"这个东西在被用"，判据就指到对象（文件/inode/端口/设备序列号），别指到名字。**
- ⚠️ **这两条本该直接落 `environment-traps.md`，但没有**：05:1x 现量那枚文件正被并行会话脏着
  （**40 行未提交，且他们那条已占了 212 号**），而按名提交用的是工作树整枚内容 ⇒
  提交它会把**他们未提交的条目吸进我的那一笔**。我先追加进去的两条（41 行）已**原样撤出**
  （撤出后 diff 回到 40/0、他们那条 212 命中 1 次）。
  ⇒ **指号到 05:3x 重取一次**（别照我写的时候抄）：
  · 第一条（公证挂死 + "慢 vs 死等"的取证姿势）**已进台账 = #214**，由那条线自己落的，
    措辞是他们的（"进程在场 ≠ 在干活"）；
  · 第二条（**判占用要指到对象本体而不是名字**：`lsof` 指到那枚文件、逐个 pid 取 cwd）
    **仍然待入，现量台账最大号 = 214 ⇒ 下一个空号是 #215**。这条是他们 #214 里没有的那半条
    （逐条 `grep -nE 'lsof|pgrep|255'` 在那一整条目里**零命中**），别以为已经覆盖了。
  · 台账里 `208` 号曾在 HEAD 中重复（`5075`/`5125` 两枚），**那位已自行改号为 #213 并修好**
    （`87f62b39`），HEAD 现状：`grep -oE '^[0-9]+\. ' | sort -n | uniq -d` 在 2xx 段无重复。
- 🔴 **同一条台账被同一支工具写坏过一次，而它自己不知道**（05:3x 现量，已由所有者修复 `87f62b39`）：
  `bfdeea31` 之后 HEAD 里 `docs/reference/environment-traps.md` = **18 字节 / 0 行**，正文就是字面量
  `/tmp/traps-blob.md` —— 把**路径**当内容写进了 blob。它的提交信息同时写着"删除恰好 1 行改号"
  和"工作树一个字节没动"（两句都真：工作树确实没动），而 `numstat` 是 **1/5142**。
  📌 两句各自成立、合起来读不出"整本没了"——**提纲要改两处、落盘把整本删了，只有比 blob 尺寸才看得见**。
  ⇒ 我以后每次向共享台账提交之后，除了"树差异只含我这枚路径"，还要加一条**尺寸不缩**：
  `git show HEAD:<路径> | wc -c` 与提交前同列对比（我准备的恢复脚本正是拿这条挡住了我自己 ——
  我按 05:33 那次"HEAD=18 字节"的读数去恢复，而 05:35 现量 HEAD 已经是 385139 字节：那位已经修好了，
  再写就会把他们新落的 #214 抹掉。**基于过期读数的"修复"是二次破坏**）。

- 🔴 **比较类判据必须先判"操作数是不是读数"**（05:4x 同一条脚本里第二处假绿，`022edfcf`）。
  `verify-mobile-notes.sh` 第 7 步比 `"$AFTER" != "$BEFORE"`，而 `note_op_count` 读不到库时返回**空串** ——
  拉库一失败就退化成 `"" != ""`（恒假），两条 ✅ 照常打印。
  同一条纪律（函数注释自己写着"由调用方判'不是数字'并 `bad()`"）**在同一份脚本里只落了一半**：
  第 6 步判了，第 7 步没判。⇒ 审一条判据不能只审"有没有断言"，要**逐个操作数问：它读不到时装什么**。
  📌 本轮对同一份脚本静态审出的两处，都不是"没写判据"，而是"判据在探针失败时**替产品说好话**"
  （第一处：第 12 步只判 `-s`，旧图非空 ⇒ "证据在库"；第二处：这里）。
  ⚠️ 夹具也要被验一次：`note_op_count` 在 `$(…)` **子壳**里自增的计数器不回传父壳，
  三档全取第 1 档 ⇒ "只让中段读不到"那两条腿压根没执行，而**结果是绿的**。
  计数器落文件后六腿才各归各位（`被调用 N 次` 那一列就是它的自检位，写进输出比写进脑里可靠）。

- 🔴 **"判某进程有没有持有某文件"时，相对路径会量到另一枚 inode，于是探针把"活着"报成"没了"**
  （2026-10-04 05:5x 实测，我自己写进 goal §7.30 ① 的那条就绪命令就是这么坏的）：
  `lsof -nP -t -- apps/desktop-macos/scripts/package-app.sh` 从**主检出**跑 ⇒ 解析到 inode
  `242438055`（19444 字节，已修好的那份），而 pid 95477 打开的是**它自己载体**那枚
  `248625874`（17066 字节，`/tmp/heyta-reinstall/…`）⇒ 返回空、进程却在。
  正解：`pgrep -f 'package-app\.sh'` + 逐 pid `lsof -a -p PID -d cwd -Fn` 解出对方那棵树再比 inode。
  与"名字匹配 vs 对象本体"是**同一课的两面**：按名字会把他判成己，按（解析错树的）路径会把己判成没来
  —— 先确定对象在哪棵树，再选探针。完整现场与交还动作在
  `docs/research/self-host-distribution-audit.md` §9。
- 🔴 **`lsof -p PID -i` 不带 `-a` 是并集**（打印全系统的网络文件，不是这个进程的）。
  我第一次读成"它有 324 条连接"，带 `-a` 复测是 **0 条** —— 一条到 Apple 的连接都没有的
  `notarytool --wait` 不是"在慢等"，是**永不返回**。同一个 pid 两种读法给出相反结论，
  这条要写成命令纪律而不靠记性。
- 🔴 **低占空比不等于"不会再来"**：为判"别的移动端验收是周期性还是一次性"跑了 48 次 × 5s 的只读采样，
  **命中 0**，我就此写下"一次性" ⇒ 12 分钟内被两枚新 runner（06:05 pid 33905、06:08 pid 42181，
  各在 1–2 分钟内消失）否证。正确的写法是**"短命且反复出现"**，并且：
  采样窗口的长度只能给占空比上限，给不出"没有"；这是 AGENTS §7 元规则 1 在我自己探针上的复发。
  对本线不算坏消息——闸门是粗筛，权威判据在验收脚本第 0 步（`pm clear` 之前那一刻再问一次），
  撞上就是本轮 exit 3、白等一轮，不会清掉对方现场；链每 ~90s 重查，低占空比意味着能在两次之间成交。
- 🔴 **"排除自己"只排 `$$` 与直接子进程，会把自己第二代起的全部当成别人**（2026-10-04 06:1x 实测，
  ③ 因此连退 23 轮）：`lib/mobile-e2e-runner-probe.sh` 提交态那版是
  `$1 == me { next } $2 == me { next }` —— 而 `OTHERS=$(mobile_e2e_runner_lines | awk …)` 这种写法
  会先 fork 一个子壳、再为管道 fork 第二代，第二代的 ppid 是子壳不是 `$$` ⇒ 闸门把**自己**报成
  "有移动端验收在跑"，且**每轮点名不同 pid**（4949 / 33905 / 42181 / 54094 / 65067 全是它自己的进程）。
  取证方法值得抄：让闸门命中后**把它自己那趟的 ps 快照留下**（`/tmp/heyta-gate-ps-hit.txt`），
  再把同一份快照分别喂两份探针 —— 载体（提交态）命中 `65049`＝闸门本体，
  带豁免的那版命中空。**同一份输入、两份实现、结论相反**，比任何推断都硬。
  ⇒ 正解不是再加一条 name 豁免（那只是补今天这一枚），是把排除集做成**闭包**：
  自己 ∪ 全部祖先 ∪ 全部后代（从同一份 ps 快照的 ppid 图走两步即可）。
  要补的回归夹具（现在文件是 `M`，等它落定再加，别插行）：
  在现有 7 行夹具后加第 8 组三行
  （`77777 73231 bash scripts/verify-mobile-notes.sh` / `88888 77777 …` / `99999 88888 …`，`me=77777`），
  期望**三行都不许命中**。🔴 06:33 实测：**两份实现都命中 `99999`**
  （主检出带 window-gate 豁免那版 = 命中 99999；载体提交态那版 = 命中 99999）
  ⇒ **那条 name 豁免没有把洞关掉，它只是把今天这一枚闸门摘掉了**。
  机制说清（这才是可复用的那条）：**代际是调用方形状决定的，不是探针内容决定的** ——
  `lib/mobile-e2e.sh` 的 `another_mobile_e2e_running()` 是裸调用
  （`mobile_e2e_runner_lines`，无管道）⇒ 只有"直接子壳"这一代，`$2 == me` 正好挡住，
  所以验收脚本自己不会自拒绝（06:18 那趟实测放行）；
  而闸门写的是 `OTHERS=$(mobile_e2e_runner_lines | awk '{print $1}')` ⇒ 管道再 fork 一代，
  那一代的 argv 与脚本本体逐字相同而 ppid 是子壳 ⇒ 恒被当成别人。
  ⇒ 两种修法：① 把调用方的管道去掉（`OUT=$(mobile_e2e_runner_lines); pid=${OUT%% *}`，最小、且不改共享探针）；
  ② 把排除集做成闭包（自己 ∪ 全部祖先 ∪ 全部后代，从同一份快照的 ppid 图走两步）。
  ① 治今天这一枚，② 才是"任何带管道的调用方都不会再自拒绝"。
- ⚠️ **带数值的读数里不许留模板占位符就提交**（本轮真实缺陷，已改）：goal §7.30 ③ 那条
  `app-release.apk = **%s 字节**、md5 前 12 位 %s、mtime %s` 是我上一笔提交留下的——
  它长得像已核实的事实，下一位照抄拿到三个空值；六腿夹具那句的三个 needle 同样是空的。
  ⇒ 收尾加一条自锚检查：提交前 `git diff -U0 -- <文件> | grep '^+' | grep -c '%s\|``'`，
  新增行里出现模板占位符或**空反引号对**（针对于 needle 引用）就当场补齐现量再提。
  ⚠️ 这条粗筛**会在自己的正文上误报**（本条那两行命中就是"引用缺陷原句"和"pattern 本体"）
  ⇒ 命中即要求逐行 attest，别拿计数当结论（同一课见 goal §7.30 里"标记粗筛降级"那条）。
- 🔴 **③ 那一格"服务端就绪"兜底的是别人的进程**（19:24–19:25 现量，逐条带时刻）：`:3100` 的监听者 =
  pid **26407**（`node dist/src/index.js`，进程启动时刻 `Sun Oct 4 06:02:44`，即已跑 13 小时），
  `curl :3100/health` → `{"status":"ok","db":"connected","wsConnections":0}`，
  它的 `DATABASE_URL` **只取库名**（凭据不进任何输出）= `heyta_mobile_smoke`
  ⇒ 与 `verify-mobile-notes.sh` 第 10 步直查 Postgres 的默认目标**同库**
  （`PG_DB=${HEYTA_E2E_DB:-heyta_mobile_smoke}` @ `127.0.0.1:5432`）。由此两条：
  ① ③ 可以直接用它，但**读数里必须带上这三元组**（pid / 启动时刻 / 库名），否则"跨设备三条腿"
  证的可能是别人那台机器的账；② **同库是双刃的** —— 别人设备的 op 也落进同一张表，
  所以第 6/7 步"恰 1 条 NOTE/UPD"这类**计数**判据在设备面被占时会被别人的写入污染，
  这正是闸门把 `dev` 记成红的那一格**不能放宽**的具体理由（19:25 现量占设备的是主检出
  `scripts/.verify-mobile-ios.sh.snap.95519`，且它在**推进**不是楔住：
  `/private/tmp/heyta-b-ios-live6.json` 与 `heyta-idb-ios-1EDCFA59-…-tcp.log` 在 120 秒内有新写入）。
  ⚠️ **饿死形状登记**：若窗口开时那台服务端已不在，链会停在 `:173`（打印"`NOTES_PORT` 上没有可用服务端"）
  而**永远不起跑 ③** —— 那是环境，不是产品红。修法照闸门自己 `:266` 那句（链在**空闲端口**起栈、
  把同一个 `PORT` 同时传给起栈与验收；`scripts/verify-mobile-window-gate.sh:251-252` 写明
  `r14c-carrier-chain.sh` 已是这个形状）。**本线不改闸门**，只在链里补这条起栈腿。
- 🔴 **等待期载体不会自己追平 main —— 窗口比"③ 那 25 分钟"大得多**（19:27 现量）：
  载体 `1341d71b`（15:06）落后 main（`e95feb5a`，19:21）**51 笔**，而 `/tmp/heyta-chain18.log` 里
  `grep -c 载体` = **0**、`grep -c PREP` = **0** —— 链的循环体顺序是现读的
  （`:157` 设备门 → `:161` 负载门 → `:203` `git checkout` 对齐 → `:219` `pnpm -r build` →
  `:251` APK 前置 → 闸门 → ③），**对齐与构建都排在两道门之后**，所以等待期它们一件也不会发生。
  ⇒ 三条推论：① 窗口的实际占用是「checkout 51 笔 → 全量构建 → 重打 APK → ③(≤1500s) → ① 四端」；
  ② 这几段会把负载顶过 12（链的注释自己写了"属于本轮自己制造的外部长"），**中途别拿闸门读数判"窗口又关了"**
  —— 那一轮的判据早已取过，读数只说明"下一轮进不去"；
  ③ 🔴 **别在等待期替链预跑 `pnpm -r build` 来"省窗口的时间"**：那等于自己把负载门抬起来，
  而链随后还会把工作树再往前推，预跑的产物大概率对不上要对齐的那一笔 —— 白烧。
  APK 那一格同理：载体现量 `app-release.apk` mtime **05:36:40** / 最新源码 **14:49:16**
  ⇒ `REDS=load,dev,apk` 里的 `apk` 只能由 `:251` 那次前置清掉，而它今天**从未跑过**（`PREP` 命中 0）。
- ⚠️ **我自己今天第二次踩的那枚探针自错**：`GATE_EXIT=${PIPESTATUS[0]}` 在 zsh 下是**空值**，
  我据此打印出 `GATE_EXIT=`，差点把它记成"闸门退 0"（记忆里这条早就有，落在这里是因为它出现在
  **闸门读数**上——判据的退码读不到时，唯一诚实的写法是"没拿到"，不是补一个猜测值）。
  ⇒ 取被管命令的退码：要么不接管道，要么 `bash -c 'set -o pipefail; …'`。

### 19:3x 开窗前的最后一次静态预检（全部现取，不含任何推断）

- ✅ **对齐那 51 笔不会改动 ①/③ 的任何判据脚本**（逐 blob 现比，路径先 `git ls-tree -r --name-only HEAD`
  现取，见下面第二条自错）：`scripts/verify-mobile-notes.sh` `df46f473`（main 与载体**同**，673 行）、
  `scripts/reinstall-all.sh` `036ce09a`（同）、`scripts/lib/msix-install-facts.sh` `f1c2dec1`（同，
  `MSIX_REQUIRED_FACTS` 现读仍 **5 条**：`ADD_APPX=OK` / `RESULT=OK` / `PAYLOAD_WEBDIST=True` /
  `M2D=OK` / `SHORTCUT_OK=True`）、`scripts/screenshots/png-stats.mjs` `6cee9282`（同）。
  ⇒ 窗口内那三段重活（`git checkout` 对齐 → `pnpm -r build` → 重打 APK）**只换源码，不换判据**，
  所以 ① 的"五张图 × 每条判据"与 ③ 的四个 needle 都不必重推。
- ✅ ③ 的四个输入 needle 在 main 那版里逐条命中（`step "8b`=1、`shot_evidence`=6、
  `# >>> step10-scoped begin`=1、`blame_crash`=7），第三张截图 `android-notes-3-from-search` 命中 **2**
  （截图点 + 判据点），`pm clear` 命中 4；凭据的三个 `*_FILE` 旋钮在 `scripts/lib/mobile-e2e.sh` 各命中 1。
- 🔴 **我自己这一轮造出来的第二种假"同"**：`git rev-parse "HEAD:<不存在的路径>"` **不报错、
  把参数原样回显**（我拿到两行 `main=HEAD:scr 载体=HEAD:scr` 还读出"同"）。
  ⇒ 两次**同样形状**的失败会彼此相等，比空串更危险——空串我还会看一眼，`HEAD:scr` 看着像截断的 sha。
  规矩（写下来才拦得住下一次）：**比 blob 之前先 `git ls-tree -r --name-only <ref>` 现取路径，
  再断言取到的 sha 是 40 位十六进制**；sha 长度不够就当场判"探针坏"，不许把等号写出来。
  ⚠️ **待入 traps #266**（按工作树取号：`grep -oE '^[0-9]+\. '` 现量最大 **265**、HEAD 最大 **228**、
  该文件此刻是 ` M` 且工作树比 HEAD 多 **750 行** ⇒ 这正是记忆里"目标台账正脏着几百行时不要往它追加，
  改投单写者文档并登记待入号"那一档，本条只是**登记**，不是已入档）。

- ✅ **① 的"五张图"与实现对得上**（逐条现读，不是我数出来的五）：
  `scripts/reinstall-all.sh`（main 与载体同 blob `036ce09a`）里**字面写出的只有四张**
  （`:148 dist/windows/packaged-first-run.png`、`:308 …-android.png`、`:462 …-ios.png`、
  `…-mac-installed.png`），**第五张是壳自己派的**：`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift:197`
  在自截屏后另写 `path + ".webview.png"`（README 同文件 `:36/:43` 写明那张证的是"壳里那份共享 UI
  真的渲染出来了"，窗口那张只证"有个窗口"）⇒ 启动器 `PNGS=(…)` 的 `EXPECTED=5` 不是硬凑的数。
- 🔴 **我这一轮的第二枚"探针够不着 ⇒ 读成缺席"**：第一版正则写成
  `/tmp/heyta-reinstall-[a-z]+\.png`，`mac-installed` 里的**连字符**不在字符类里 ⇒ 那张直接不命中，
  我当时读到的就是"实现里只有 android/ios/windows 三张"。改成 `[A-Za-z0-9._-]+` 后四张齐。
  **同族规矩**：断"实现里没有 X"之前，先把 pattern 喂一枚**必然命中**的样本（这里就是那张我自己
  启动器里写了六天的 `mac-installed.png`）；命中不了先改探针，不许先改结论。
- ✅ **闸门那两条"有能力否决退码却没有 WHY_ 旗标"的无关腿，现量对 C 分支是惰性的**（19:3x 逐条读 main 那版）：
  `:318` 的 MANIFEST 腿 grep 的是 `verify-mobile-due-time.sh`（**不是** ③ 那枚），而它在
  `scripts/check-script-snapshot.mjs` 里命中 1、`verify-mobile-notes.sh` 也命中 1 ⇒ 那条 `warn()` 不会触发；
  "服务端没在 :PORT" 那一支只在 `HEYTA_GATE_SERVER_PORT` 非空时才走（链不设它，走的是 `:266` 的纯 `echo`）。
  ⚠️ 但 `warn() { …; FAIL=$((FAIL + 1)); }` **本身没改** ⇒ 这条"惰性"取决于**现场那两个条件**，
  不是结构保证；链仍然保留那条单独归因（`REDS` 全空却退非 0 ⇒ 记「被无关腿否决」，不混进设备/负载红）。
- ✅ **① 的两个外部依赖现量都在位**：Windows 打包机 `ssh -o ConnectTimeout=6 -o BatchMode=yes windows-pc` 正常连上
  （⚠️ 我那次 `ssh windows-pc "echo HOST_OK; whoami"` 远端**把整串原样打回来** —— 那是 cmd/PowerShell 的
  `echo` 形状，不是"命令没跑成"，也不是读数；**判可达只能看 SSH 本身成没成**，别拿 `echo` 的回显当证据）；
  载体的 mac 段分母也在位 —— `../heyta-wt-reinstall/apps/web/dist/` 6 项、`assets/` **9 项**
  （与主检出 `assets/` 的 9 项同数，`reinstall-all.sh:213-215` 那段比的就是**文件名集合**，
  Vite 的名字是内容寻址的 ⇒ 集合等才是对账）。
  ⚠️ 一条边界要写清：mac 段装的是 `/Applications/Heyta.app` 这个**全机共享位置**，对账比的是
  "刚装出来的那份 vs 载体自己的 `apps/web/dist`" ⇒ 若别人在我装完与对账之间也往那个路径装一次，
  集合会当场不等并打 🔴（**失败是响亮的**，不会把我的读数记成他的）。
- ✅ ③ 的服务端归属已打进链的读数（v27 起）：`:3100` = pid 26407（19:3x 仍活着，`/health` 回 ok），
  库名 `heyta_mobile_smoke` = ③ 第 10 步的默认查询目标；`~/.heyta-window-rigs/heyta-run-notes.sh`
  已从**只住 `/tmp`** 复制到 durable（两枚 md5 现量相同 `8ac4f228…`，原件 mtime 04:05）——
  注意它是**手跑那一趟**用的启动器，链跑 ③ 走的是链里那段（不经它），所以这条只是让
  §5 里那句"不带 `--go` 退 3"的演示在 `/tmp` 被清之后仍然可复现。
- 🔴 **① 的启动器从"一趟四端"改成"两趟各过一次门"（v10，19:4x）**，改的是我这枚启动器，仓里脚本一行没碰。
  成因是两条时长读数叠出来的窗口内空档：`scripts/reinstall-all.sh:161` 的端序是
  `mac windows android ios`（**设备面在最后两段**），而 mac 段这轮**真的会走公证** ——
  `package-app.sh:275` 那条"没有 ASC key 就跳过"的 elif 不进（`~/Desktop` 里那枚 `.p8` 在位），
  公证上限 `HEYTA_NOTARY_TIMEOUT` 默认 **900s**，再加 windows 段是远端打包
  ⇒ 从闸门放行到第一次 `adb uninstall` 之间隔着 **15–25 分钟**，那一格够别人把设备用上。
  AGENTS §8.9 的原文要求是"不动别人正在用的设备"，不是"起跑那一刻没人在用"。
  做法用仓里现成的两条命令（不自造参数形状）：`pnpm reinstall:desktop` = `--only mac,windows`，
  `pnpm reinstall:mobile` = `--only android,ios`；两趟之间**再过一次规范闸门**，关上就不动设备面。
  🔴 **随之改变的读数形状，记账时必须两行一起抄**：`INNER_EXIT` 现在是**两趟之和**，
  而第二趟被闸门跳过时它可以等于第一趟的 `0` —— 那种情况下真正说明"① 没做完"的是
  `FRESH/EXPECTED`（图没凑齐 ⇒ 启动器退 3），**不是那个 0**。
  七臂夹具 `~/.heyta-window-rigs/heyta-reinstall-split-fixture.sh` 现量 GREEN，
  其中 A2 是"门关了不许跑设备面"、A7 是变异臂（把第二次 `run_gate` 摘掉 ⇒ A2 立刻变红），
  所以这道门**有牙**；既有两把夹具（relask 八臂、设备占用六臂）复跑仍 GREEN，无回归。
- 🔴 **② 的启动器原来盯漏了一个端口，而漏的那个正是"会杀别人的那一段"用的**（19:4x 现读实现查出来的，
  不是踩出来的）：`heyta-run-checks.sh` 三处端口循环都写死 `4318 4319 4320`，但三条 e2e 各自前置真正
  会发 `process.kill(..., 'SIGKILL')` 的端口是按**传进去的参数**算的 ——
  `check-ai-e2e-preflight.mjs:37` 默认 `[4318,4319]`，而 `package.json` 现读
  `check:privacy-consent-e2e` 传的是 **4322**、`check:landing-e2e` 传 **4320**
  ⇒ 4322 上别人那台服务端会死在我的读数下面，屏幕上不会说是我杀的（traps #87 的第五种面目）。
  改法：端口清单抽成一处、来源逐条挂在旁边（`E2E_PORTS="${HEYTA_E2E_PORTS:-4318 4319 4320 4322}"`），
  表头改成跟着清单打印（原来它印死"4318/4319/4320"，清单一变就是一句假话）。
  **两臂对照现量**：拿一个真忙的端口喂它 `HEYTA_E2E_PORTS=3000` ⇒ 打印 `:3000 = busy` 且
  `VERDICT=NOT-RUNNING`、**退 3**；拿一个空闲端口 `4399` ⇒ `free` 且 `rc=0`（PREFLIGHT-OK）。
  ⚠️ 那个 `HEYTA_E2E_PORTS` 缝**只给夹具做阳性对照用**，不是运营开关；默认值就是实现算出来的那四个。
  19:45 现场四枚读数：4318/4319/4320/4322 **全 free**（这一格从此不再靠运气）。
- 🔴 **落 ①/③ 读数进 goal §7.30 用的那枚"只提交我自己的行"的 plumbing 提交器已建好并验过牙**
  （`~/.heyta-window-rigs/heyta-ledger-commit.sh` + 五臂夹具 `heyta-ledger-commit-fixture.sh`，
  19:47 现量 GREEN，**全程在一次性仓里跑**，因为正向臂会真产生提交）。
  为什么现在就要它：`docs/plans/goal-multi-end-coverage.md` 此刻是 ` M`，而那一格 **+19/-1 不是我的行**
  （19:46 现读：那是 B/E2EE 那条线新写的 `### 7.32 B 的 iOS Release ↔ Node host 取证`，
  引用 `apps/mobile/evidence/ios-node-vault-interop-20261004.txt`，通篇 ADR-0050 的口径）
  ⇒ `git commit --only <该文件>` 提交的是**工作树内容** = HEAD + 他们那 19 行 + 我的新行，
  等于替他们主张归属；裸 `git commit` 更糟（会带走仓库索引里别人的暂存）。
  提交器做的事：从 `git show HEAD:<file>` 那一版出发、只在**锚点恰好一行**的位置插我的段 ⇒ 造 blob ⇒
  用 `GIT_INDEX_FILE` 隔离索引 `read-tree`/`update-index`/`write-tree`/`commit-tree`/`update-ref`，
  **不动仓库索引、不动工作树** ⇒ 他们的未提交字节原地不动（L1 的后半条判据就是查这个）。
  🔴 **第一版在这里没牙，是变异臂照出来的**：反向判据当时写成
  `git diff … | grep -vF -f "$MINE"` —— **"只要我声称这行是我的，检查就自动失明"**；
  把别人那行原样放进 `mine2.txt`，旧判据一声不响就以我的名义提交了它（内容没毁掉别人的工作，归属是假的）。
  现在的规则改成硬判据：**我的插入段里不许出现任何一条与"当前未提交行"逐字相同的文本**，
  撞上即 ABORT（真需要重复就得改成锚点写法，而不是把字节带走）。
  五臂：L1 只带自己的行且别人未提交行仍在工作树、L2 撞行必拦、**L3 阳性对照**（把重复那句换成我自己的
  文本就能提交 ⇒ 证明 L2 的红来自撞行而不是提交器坏了）、L4 锚点命中多行拦、L5 锚点不存在拦。
  ⚠️ 本条线**今天仍没用过它**（①/③ 的读数还没产生，没有东西要落）；建它不是为了好看，
  是因为窗口开的那一刻正是最不该临场发挥 plumbing 的时刻。
- ✅ **一条"看着像饿死形状"的怀疑，现量排掉了**（19:52，记下来是因为它下一次还会被人怀疑）：
  `heyta-prep-apk.sh:24` 那道"载体不许并发写"的 pgrep 里含 `GradleDaemon|gradle`，
  而 gradle daemon 按设计**不会随构建退出** ⇒ 直觉结论是"我第一次打完 APK，后面每一轮都会被
  自己的 daemon 判成 BUSY，③ 就永久饿死"。现量否证：这台机器上此刻三枚 java 进程
  （pid 5263 / 18969 / 19881）的 cwd 分别是 `~/Library/Application Support/kotlin/daemon`、
  `~/.gradle/workers`、`~/.gradle/daemon/9.0.0` —— **daemon 会 chdir 到 `~/.gradle` 下**，
  不落在我这棵载体里 ⇒ 只进 `OTHER`（那句"别的检出在打包，只抢负载"）而不进 `BUSY`。
  加上 `pnpm -r build` 本身不起 gradle（gradle 只在 `build:android` 里）、① 排在 ③ 之后不同趟 ⇒
  这条门不是永不开的那一类。⚠️ 前提写清楚：判据靠的是 **cwd**（`lsof -a -d cwd`），
  哪天有构建把 daemon 的 cwd 留在载体里，这一格会立刻变成真饿死 —— 归因先查 cwd，别先改判据。
- ✅ **同一枚 runner 被两把判据读出不同结论，19:53 现场抓到一个活样本**（这条是用来挡住下一次
  "把我的粗臂改严"的）：占设备的是主检出的 `scripts/.verify-mobile-ios-reminder.sh.snap.27495`（pid 27495，
  W9 那条 iOS 提醒线）。同一趟里两把判据各读一次：
  链 `:157` 的**安卓面**归因臂把它筛掉（`grep -vE 'verify-mobile-ios|HEYTA_IOS|simctl'` ⇒ 筛后为空，
  打印"遗留实例、宿主侧无驱动者 ⇒ 放行"），而规范闸门 `--target c` 同一刻打印
  `❌ 有移动端验收在跑（pid：27495）` 与 **`REDS=load,dev,apk`** ⇒ 链过不去，③ 不起。
  📌 这正是"手搭哨兵不许比规范裁判严"那条的**正面对偶**：粗臂比闸门宽是**安全的**，
  因为最终裁判仍是闸门（`:335` 那次 `--target c`）；把它改严反而会把安卓面上真没人的那些窗口自己关死。
  ⚠️ 别据此去"优化"那条臂 —— 它的用途是给 `com.heyta` 那枚遗留实例一个说法，不是窗口判据。

### 20:0x ① 的取证夹具红了：红的是夹具，但它暴露的隔离失效比那两条 GUARD_FAIL 贵

窗口仍关（20:04 现量：load 58.27–193.72、`:3000` 被 pid 70256 占、设备在主检出那条
`scripts/.verify-mobile-ios-reminder.sh.snap.27495` 手里），这一段做的是**零 CPU 的装置修复**，
没起任何设备/Playwright/重装类验收。

- 🔴 **最贵的一条不是那两个 GUARD_FAIL，是夹具违背了自己的文件头**。它的头写着"不跑 pnpm、
  不碰真 /tmp 那五条共享路径"，而 19:55 那一趟（替换 needle 还停在 v9 的 `pnpm reinstall:all`、
  且没查 python 退出码）**真的执行了产品命令**：`/tmp/reinstall-inner-1.log` 与 `-2.log`
  各 802 B、mtime 19:55，里面是
  `Error: Cannot find module '/tmp/heyta-evid-fixture-Qc08AA/home/.cache/node/corepack/v1/pnpm/12.9.1/bin/pnpm.cjs'`。
  ⇒ 它没走到设备，**纯粹是因为夹具自己把 `HOME` 换成了临时箱、corepack 解析不到 pnpm** ——
  这是事故，不是护栏。"声称隔离"的装置一旦靠巧合才没越界，下一次环境变了就会越界。
- **两个 GUARD_FAIL 的根因都是夹具**（20:00 逐条定位，都用玩具复现过，不是推断）：
  1. 抽段里的桩路径写的是 `$BOX/inner-1.log`，而 `block.sh` 是**子进程** —— `BOX` 没 `export`
     ⇒ 子进程里展开成 `/inner-1.log`（不可写）⇒ `tee` 静默落空、`cat` 失败但 `> "$INNER_LOG"`
     仍把文件建成**空**⇒ E1「inner.log 没抄进证据目录」与 4-stub-red「输出里没有失败面」
     都是这一个空文件的两张脸（"空测量看着最干净"又出现一次）。
     ✅ 复现臂 M3：在**夹具副本**上摘掉 `export BOX` ⇒ 精确复现出 E1 那句。
  2. 抽段调用了 `run_gate`，而这个函数住在启动器的**文件前半**、不在抽段里 ⇒ 子进程报
     `run_gate: command not found`，紧接着 `[ "$GATE" -ne 0 ]` 拿到空串，在 bash 里
     报 `integer expression expected` 并返回**假**（玩具实测打印 `BRANCH=RAN-PHASE2`）
     ⇒ 每一臂都"碰巧"走了「跑第二趟」那一支，**v10 新增的"闸门跳过设备面"这支一次都没被覆盖**，
     而五臂的 rc 全对。✅ 改法：抽段前面垫 prologue，把 `run_gate`/`IOSN` 变成
     `HEYTA_FAKE_GATE`/`IOSN_FIXTURE` 两个显式旋钮 —— 依赖不再靠"恰好继承了环境"。
- **新增三臂 E6/E7/E8**（覆盖"两趟之和"的三种形状）：闸门退 3 ⇒ `PHASE2=SKIPPED-BY-GATE`
  且第二趟日志必须**空**；只第二趟红 ⇒ `INNER_EXIT=1` + 归因段能从第二趟日志里报出
  `失败面：@heyta/mobile`；两趟都红 ⇒ `INNER_EXIT=2` 而启动器退出码是 **1**
  —— 记账时这两个数不是一回事，这条形状以前没有任何东西在守。
- **有牙证明**（`~/.heyta-window-rigs/heyta-evid-mutation.sh`，20:04 现量 GREEN）：
  M1 把 `$(( IX1 + IX2 ))` 摘成 `$IX1` ⇒ `GUARD_FAIL=7-phase2-red rc 不符`（也就是说：
  设备面整条红会被读成 `INNER_EXIT=0` 且启动器退 0 ⇒ ① 会被误记 DONE）；
  M2 让闸门不再拦第二趟 ⇒ `GUARD_FAIL=6-gate-skip 输出里没有「PHASE2=SKIPPED-BY-GATE」`；
  M3 见上。夹具本体八臂 GREEN，真启动器 md5 未被任何变异臂碰过：`b3aadde535fba3c0f99a54a160d0d6ed`。
- 📌 **可迁移的两条**：① **抽段类夹具（把一段代码单抽出来跑）必须自检"这段在真件里依赖的名字是否都在"** ——
  未定义的 helper 在 bash 里不会让脚本停，它只会让**分支悄悄选边**，于是"rc 全对"可以完全不含新行为的覆盖；
  ② **装置声称的隔离要落成"非 0 计数即停"的前提检查**（现在加了 `LEAK_N=0`：抽段非注释行里
  任何 `/tmp/reinstall-inner*` 都不许留），写在注释里的"不碰"不是隔离，只是愿望。
- ⚠️ 顺带记一处**计时旋钮**，不是产品改动：夹具的 `mkpng` 现在给图打 **+3 秒**的 mtime。
  原因是被测段自己用 `RUN_START=$(date +%s)` 判"本轮新生"，那一刻发生在子进程起来之后 ——
  墙钟在 `mkpng` 与它之间跳一秒，这张图就被判陈旧；原五臂能过是运气（没跨秒）。

#### 20:1x 同一批查出的第二枚夹具：`heyta-reinstall-split-fixture.sh` 也在写共享 /tmp，而且两条臂是装饰

它用 `eval`（同一个 shell）而不是子进程跑抽段，所以 **20:0x 那两条根因不作用于它** —— 但它有自己的三条，
全部是 20:06–20:11 现量，不是推断：

- **共享路径覆写**：抽段里 `tee /tmp/reinstall-inner-{1,2}.log` 与 A6 读的 `/tmp/reinstall-inner.log`
  都是**真路径**（现量：注释外命中 **4** 处）⇒ 七臂每跑一次，就把上一趟真 ① 的内层日志覆成桩输出。
  ✅ 改成只重定向日志落点（块结构逐字保留）+ 前提检查"重定向前 ≥1 / 之后残留 0 / 箱内 ≥2"，
  任一不成立就打印 `RED=…这是装置坏了，不是启动器红了` 并退 1。
  **复验不靠"我说改了"**：20:11 跑完 `SPLIT_RC=0` 之后，三枚 `/tmp/reinstall-inner*.log` 的 mtime
  仍是 **19:55:07**（上一趟失效夹具留下的那批），大小 802/802/1604 一字未动 ⇒ 隔离这次真生效。
- **A6（inner.log 必须含两趟）原来没有牙**：它读 /tmp 真文件，而桩输出串与 A1 **完全相同** ⇒
  摘掉 `cat` 的第二个实参它照样绿。✅ 一起补三件事：每臂开头 `rm -f` 箱内三份日志、桩串带本臂独有后缀
  （`-A6`）、再加行内变异腿 **M2**（`cat $BOX/inner-1.log $BOX/inner-2.log` 摘成一个实参）⇒
  必须看不到 `ANDROIDIOS-OUT-A6M`；并断言变异体与原体**逐字不同**（needle 漂了就红）。
- 🔴 **A7 从写进来那天起就不可能失败**，而且是三种坏叠在一起：
  1. `sed '0,/run_gate/s///'` 在 **macOS 的 BSD sed** 上**静默不生效** —— 20:09 现量：喂三行含 `run_gate`
     的输入，输出**逐字未变**且 **rc=0**。不是报错，是"接受这个地址、什么都不改"⇒ 变异体 == 原块，
     等于没做变异；
  2. 桩写成 `run_gate() { :; }`（空函数）+ 外部预置 `GATE` ⇒ "第二趟前面重新量一次闸门"这个 v10 的
     核心动作在夹具里是**惰性的**，摘掉它读数一点不变；
  3. 而那条 GUARD_FAIL 还是"出现 `PHASE2_EXIT=0` 才红"的**反向形状**（摘掉闸门调用后跑第二趟本就是预期后果）。
  ✅ 重写成一差两腿：把 `arms` 拆成 `armsB <块> <第二次闸门读数> <p1> <p2> <调闸门前的 GATE 预置值>` ——
  **A7**（摘掉那一行、预置 `GATE=0`＝第一次闸门留下的"窗还开着"）必须看到 `PHASE2_EXIT=0` 且不许看到 SKIPPED；
  **A7b**（`GATE_READ=3`、预置同样是 0，**只差那一行保留**）必须 SKIPPED。
  两腿的差集恰好就是"那次闸门重测"本身，这才叫变异对照；needle 也改成行锚定
  `^[[:space:]]*run_gate[[:space:]]*$` 并先断言 `MUT != BLK`。
- 📌 **可迁移的第三条**（补在 20:0x 那两条之外）：**BSD sed 接受 `0,/re/` 这个地址却什么都不改、还退 0**
  ⇒ 任何"用 sed 造变异体"的臂都必须先断言**变异体与原体逐字不同**，否则"变异通过"读到的是
  "没变异也通过"。这与 #77（sed 的 C locale）、`server/scripts/migrate-deploy.sh` 的 GNU-only `sed -i`
  同属一个工具族，但是**第三种面目**：前两种会**报错**，这一种**静默空转** —— 所以它最贵。
- ✅ 复跑读数（20:11，都在窗口外、零 CPU）：`heyta-reinstall-split-fixture.sh` **SPLIT_RC=0／七臂全对**、  `heyta-evid-fixture.sh` **八臂全对**、`heyta-evid-mutation.sh` **三条变异全被抓到**；
  真启动器 md5 三次复跑后仍是 `b3aadde535fba3c0f99a54a160d0d6ed`（变异只改临时箱里的副本）。
  窗口现量仍是关：20:11 负载 **76.94**、`:3000` 被 pid 70256 占、设备仍在那条 iOS 提醒线手里
  ⇒ ①②③ 一律没起。
- 📌 **待入 traps（本条线不直接往台账追加）**：`docs/reference/environment-traps.md` 现在正被并行会话
  脏着 **+790/−7**、工作树最大号 **268**（20:12 现量）。按"目标台账正脏着几百行时不要往里追加，
  改投单写者文档并登记待入"这条既有纪律，上面那条 **BSD sed 的 `0,/re/` 静默空转（rc=0 且输出逐字未变）**
  先落在本节，取号 **待入 traps #269+**，由台账的下一次单写者收口带上。⚠️ 登记时请连"它不报错"一起写 ——
  台账里已有的 GNU-only `sed -i` 与 C locale 两条都会**响亮地**失败，正因为如此，后来者才会以为
  "sed 的不兼容总会留痕迹"。

#### 20:15 同族第三刀：四枚夹具把"被测体"钉在了**不会再跑的那条链**上

顺着 20:1x 的 sweep 往下查（零 CPU），发现比"needle 停在旧版本"更静默的一种漂移：

- 现量（20:14）：`heyta-gateleg-fixture.sh` 的 `CHAIN` 默认 **/tmp/heyta-window-chain18.sh**、
  `heyta-chain-rpi-fixture.sh` **/tmp/…chain24.sh**、`heyta-credpin-fixture.sh` **/tmp/…chain25.sh**、
  `heyta-notesdone-fixture.sh` **durable 的 chain24.sh** —— 而 `ps` 里真正在跑、真正会执行 ③① 的是
  **`bash ~/.heyta-window-rigs/heyta-window-chain27.sh`（pid 48362，已 42 分钟）**。
  这三枚还钉在 `/tmp` 副本上：机器重启或谁清一次 /tmp，它们就 `FAIL=读不到链本体` 而**看起来像夹具坏了**；
  更糟的是**不坏的时候**，它们逐字绿，而绿的是历史。
- ✅ 新增单所有者 `~/.heyta-window-rigs/heyta-latest-chain.sh`：**优先"正在跑的那条"**（`ps -eo args` 里
  出现且 `-s` 非空的 `heyta-window-chainNN.sh`），没有运行中的才退到"号最大的那枚"（按号 `sort -n`，
  不是按字典序 —— `chain9 > chain27` 这种排序错会让它永远选中老链）。两条都打印，且当
  "正在跑的 ≠ 号最大的"时往 stderr 喊一声 —— 那正是"换代了但夹具没跟上"的形状。
- ✅ 四枚夹具的默认值都改成走这枚解析器，并**当场打印被测体路径**（读数里能看见 `被测链=…chain27.sh`）。
  复跑读数（20:15，全在窗口外）：`credpin` **CREDPIN_FIXTURE=GREEN arms=6**（含它自己的变异臂 P4）、
  `notesdone` **GREEN**、`gateleg` **GREEN 臂通过=12 臂失败=0**、`chain-rpi` **GREEN arms=7**。
  ⚠️ 这四枚的抽段边界都是 `grep -n` **现取**的（gateleg:17-21 是样本），所以换成 27 之后不是"行号挪了但测错行"
  —— 这一点我是查过才敢写的。
- 📌 **可迁移的第四条**：夹具漂移有三级，越靠后越静默 ——
  ① needle 停在旧版本（**会报错或红**，最便宜）；② 依赖的名字没传进子进程（**不报错，分支悄悄选边**）；
  ③ **被测体指向"曾经跑过的那份"**（**不报错、不选边，逐字绿，只是与今晚要跑的东西无关**）。
  ⇒ 凡是"抽段/复刻/对账"类装置，被测体路径要么来自**运行中的进程**，要么来自**显式旋钮**，
  并且读数里必须打印出它选的是哪一份 —— 只写"我测了链"不构成证据。
