# 交接：多端补齐（重点移动端）Goal —— 当前停在哪

> 状态行：**🔄 未完成**。条件 1 的 6 行里 **3 行 ✅ / 3 行 🟡**；条件 2 **未达成**（`pnpm check` 57/62 段可过、
> 四端重装本轮没跑）。**这条 Goal 没有被标记完成，也不要照本文件当成已完成接手。**
> 唯一权威过程账在 [`goal-multi-end-coverage.md`](goal-multi-end-coverage.md) §7（§7.27 字形定论、§7.28 完成条件逐条现量），
> 阻塞与归属账在仓库根 [`../../BLOCKED.md`](../../BLOCKED.md)（B33/B41/B42/B43/B45/B47/B50/B51/B52），
> 逐程流水在 [`../../PROGRESS.md`](../../PROGRESS.md)。本文件**不重复决策与归因**，只写"现在在哪、下一步按什么顺序做"。

---

## 0. 载体（接手前先核，别信本文件里的号）

| 项 | 值（2026-10-03 21:1x） | 复跑核对 |
|---|---|---|
| 本分支 HEAD | `96f3293d` | `git rev-parse --short HEAD` |
| 本条线今日提交 | `05293b7d` `a633183c` `8519de39` `96f3293d`（中间被并行条线的提交穿插） | `git log --oneline -14` |
| 判据基线（本轮现量） | 四份 spec **71 passed、0 skipped** | 见 §3 第一条 |
| l4 棘轮 | **98 / 90**（上限 ≤104/90） | `node scripts/check-l4-no-style.mjs` |

⚠️ **接手第一件事**：`git status --porcelain` 现在约 **270 条**未提交，其中绝大多数不属于本条线。
本仓库是**共享工作树**，`git commit`（裸）提交的是整个索引 ⇒ 永远点名路径提交。

---

## 0.5 Goal 全部范畴逐项对账（2026-10-03 22:1x 现量，`node /tmp/reconcile.mjs` 的那套读数）

> 这一节存在的理由：**交接最容易漏的不是没做完的事，是整层要求没核**。
> 下面逐条把任务书里的每一项落到"做掉 / 未闭合 / 不归本批（挂编号）"三选一，全部带复跑读数。

| Goal 里那条要求 | 现在 | 复跑与读数 |
|---|---|---|
| 任务 0：`check` 段数 = 62 | ✅ 对上 | `node -e 'console.log(require("./package.json").scripts.check.split(" && ").length)'` → **62** |
| 任务 0：l4 baseline 104 / 90 | ✅ 对上 | `scripts/check-l4-no-style.mjs` `:155 baseline: 104`、`:162 baseline: 90`（现量读数 98/90，**未动阈值**） |
| 任务 0：`apps/mobile/tests/*.spec.ts` = 35 | ⚠️ **已漂到 44** | `ls apps/mobile/tests/*.spec.ts \\| wc -l` → 44。本条线新增 3 份，其余是并行条线加的 ⇒ **接手别拿 35 当基线** |
| 任务 0：中英词条各 2881 | ⚠️ 口径不同 | 我的解析形状量到 **zh 2911 / en 2911**（单引号键 2875 + 双引号/反引号键 36）。任务书那个数是写书人的另一套数法 ⇒ **稳的判据是"两侧键数相等"**，不是绝对值 |
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
| 任务 4：移动端传 `share`（周小结） | ✅ | `growth-share-summary.spec.ts` **13 passed** + 变异两臂 |
| 任务 4：词条 `{{count}}` 与 `{count}` 字形统一 | ✅ | **定论是"本来就只有一种"**：`{{`/`}}` 各 2 行且**全是注释**，真值 `web.growth.year.heatmap` 两端都是单层 `{count}`；交付物 = 三条测量 + 一条常驻判据 + 一次变异（goal §7.27） |
| 任务 4：移动端传 `activityDays`（年度热力图） | 🟡 **不归本批** | 被冻结判据 `apps/mobile/tests/growth-display.spec.ts:365` 钉成空串 ⇒ **B41** |
| 任务 4：移动端传 `onRepair`（补打卡） | 🟡 **不归本批** | `HabitStreakList.tsx:269` 是 **或**条件 + `:302` 钉 `repairAction` 必须 `undefined` ⇒ **接了也不渲染、不报错** ⇒ **B42** |
| 任务 4：`onFreshStart` 不许顺手加 | ✅ 按书执行 | 无对应动作 ⇒ 写进 **B43**，一行代码都没加 |
| 任务 4：「我的」加权益/到期可见 | 🟡 **半** | 权益卡已挂（消费 `app-host#fetchHostedEntitlementReading`）；**"到 X 日到期"拿不到** —— 那次 GET 一个响应字段都不消费、web 侧同样只有两个布尔 ⇒ 要动服务端面 ⇒ **B45** |
| 任务 4 验收：`check:payment-entry`、pricing 一致 | ✅ | `check:payment-entry` exit 0；**权威名是 `check:pricing`**（任务书里写的 `check:pricing-consistency` 是**文件名**不是 pnpm 别名，我照名字跑得到 "command not found" 的假红 —— 第三次踩 B50，已在 B50 追加）|
| 拍板 1：移动端提醒不做，禁令前提要拍 | ✅ 已拍并回写 | 前提被**第三个自研原生模块**否证（B33）；并行条线已实施原生投递，本行**不代其主张验收读数** |
| 拍板 2：AI 功能不做，但 `check:ai-coverage` 改成按端枚举 | ✅ | 提交 `05293b7d`；门禁现在逐端打印 `mobile 0/5`，接一半会红（变异：塞两条探针 ⇒ 精确点名缺的 3 条）|
| 拍板 3：模块开关 / 鸿蒙 不排 | ✅ 按书执行 | 一条代码都没动，理由写在 goal §6 排除项与审计矩阵 |
| 拍板 4：只动客户端与共享层，不碰 `server/`、计费、管理后台 | ✅ 有对账 | 本条线全部 12 笔提交涉及 **51 个文件**，落在 `server/`、`packages/ai/`、`apps/web/src/features/admin` 的 = **0**（复跑：`for s in …; do git show --name-only --format= $s; done \\| sort -u`）|
| 界限：判卷冻结（`apps/mobile/tests/**`、`e2e/**`、其余 `scripts/check-*.mjs`） | ✅ 自审干净 | 复跑：`for s in 76cbee51 … d6ea2dc9; do git show --name-only --format= $s \\| grep -E '^(e2e/\\|apps/mobile/tests/\\|scripts/check-.*\.mjs$)'; done` ⇒ **只有 `scripts/check-ai-coverage.mjs` 一条**，它的授权来自任务书"拍板 2"那一行（点名让我改它），不是越界 |
| 界限：白名单外只读 | 🟡 两处越界候选，如实记 | ① 根 `package.json` 被改 —— **任务 1 要求"补 verify: 别名"必然要动它**，属隐含授权；② `BLOCKED.md` / `PROGRESS.md` 是任务书自己指定的记录文件。其余零越界 |
| 规矩：不新增依赖 | ✅ | 51 个文件里无 lockfile、无 `package.json` 依赖段变更 |
| 规矩：skipped 必须 0 | ✅ | 本批四份判据文件现量 **71 passed / 0 skipped** |
| 收尾：`pnpm check` 全量 exit 0 | 🔴 **未达成 57/62** | 5 段红的逐条归属在 goal §7.28 与 **B51** |
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

## 3. 当前状态：还差的（逐项带现量）

1. **条件 2 的第 1 条：`pnpm check` 62 段 exit 0** —— 现量 **57/62**。5 段红各自的位置：
   - 3 段 Playwright（`check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`）：
     需要 `:3000` 空闲且没有别人的 vite；`check:ai-e2e` 会 **SIGKILL 别人的 dev server**（traps #87）。
   - `check:shell-unicode`：**HEAD 上就红**，在别人提交的 `scripts/mutate-closeout-gates.sh`（B36.2，地界外不代改）。
   - `check:docs`（第 34 段）：**HEAD 上就红 3 处**（别人引用进了提交、目标文件漏 `git add`，B51），
     其余 24–30 处只在混合工作树成立，**本条线 0 处**。
2. **条件 2 的第 2 条：四端重装 `INNER_EXIT=0`** —— 🔴 **本轮没跑**。上一次四端跑绿的载体不是本轮交付，不能顶替。
3. **条件 1 的三行 🟡**（不是漏做，是拦路的在本批权限之外）：
   - 清单/标签行的「父子层级选择器」：**写侧只差 `ProjectActions` 上一个 `setParent` 包装**
     （通用派发器 `project-actions.ts:165` 的 payload 是开放的，rename/setColor/archive 都是它的一行包装），
     **真缺的是两端的选择器界面 + 跨端形态裁决**（web 也没有嵌套）。设计已被 `packages/domain/src/entities.ts:270-277`
     钉死：只允许一层文件夹。→ B52。
   - 成长统计行：热力图无障碍名被 `apps/mobile/tests/growth-display.spec.ts:365` 钉成空串；
     补打卡被 `HabitStreakList.tsx:269` 的 `||` 渲染条件挡住（**接了也不出现、不报错**）。→ B41 / B42。
   - 权益行：`entitlement.ts` 那次 GET **一个响应字段都不消费**，web 侧到期条同样只有两个布尔
     ⇒「到 X 日到期」要动服务端面。→ B45。
4. **`verify:mobile-notes` 剩余腿**：真机只走到第 5 步；第 8 步之后三腿缺（第 8 步第三张截图、第 6/7 步 op 判据、第 9–11 步跨设备）。

## 4. 环境读数（2026-10-03 21:1x，设备/浏览器类验收的前置）

`sysctl -n vm.loadavg` 1min = **91**（16 核）；`:3000` 被 **PID 80257** 占；有人在 `/tmp/heyta-reminder-ios4` 编 iOS。
⇒ 设备类与 Playwright 类验收**现在跑不得**。跑之前重新现量这三条，别看本文件。

## 5. 下一步（有序，一次一个会话做得完的量）

1. 等窗口（负载落下来 + `:3000` 空闲 + 没有别人的 vite）→ 跑 `pnpm reinstall:all`，要 `INNER_EXIT=0` 与四张**逐张写明各自钉到哪一步**的截图（AGENTS §6.2 规定一：人必须打开看图）。
2. 同一窗口内补跑那 3 段 Playwright，然后跑满 `pnpm check` 并把**可过段数与载体 sha** 一起写进 goal §7.29。
3. `verify:mobile-notes` 从第 6 步接着做（第 6/7 步的 op 判据 → 第 8 步第三张截图 → 第 9–11 步跨设备）。⚠️ 它要 `PORT=3100`（`:3000` 是别人的旧进程）。
4. **父子层级选择器**：先在 `ProjectActions` 上补 `setParent(entityId, parentId?)`（照 `archiveProject` 的形状，一个意图 = 一个 op）+ 一层深度/环/自指守卫，再决定两端界面形态。**跨端形态要产品负责人拍**：两端同时做嵌套，还是移动端先做。
5. 若要做热力图/补打卡：那是**翻冻结判据**的权限问题，不是接线问题 —— 需要判卷文件的属主批准改 `growth-display.spec.ts:365`/`:302`。

## 6. 死胡同警告（这些坑已被现量踩过，别再走一遍）

- 🔴 **别用 `git commit --only <文件>` 提本条线的两份台账** —— 里面此刻混着并行会话的 hunk
  （`goal-multi-end-coverage.md:104` 是他们改的 W9 状态句）。正确做法见 `96f3293d` 的提交信息：
  用 plumbing 造「HEAD + 只含我的行」的 blob，提交后**按路径刷共享索引**（`git update-index --cacheinfo`），
  否则别人一次裸 `git commit` 会把我这几百行倒回去。
- `check:docs` 的**总数是活的**（一小时内 27→32→33→34），别把它当提交属性引用；判归属要用**链接整串**，
  不能用文件名 basename（`README.md` 会假命中），也不能用解析后的绝对路径（文档里写的是相对串）。
- 行内代码（反引号）里的路径**不是链接**，`check:docs` 看不见它 —— 别把"没被报"读成"是好的"。
- 门禁名的唯一权威来源是 `package.json` 的 `scripts` 键（`check:docs` = `node research/tools/docs-link-check.mjs`，
  没有 `scripts/check-docs-link.mjs` 这个文件）。
- 🔴 **提交共享台账（`BLOCKED.md` / `PROGRESS.md`）时，提交内容 = `git show HEAD:<文件>` + 你自己那段文本**，不要拿工作树文件当提交源：追加区是所有会话共用的尾部，"单 hunk + 删除 0 行"只证明形状是追加，**不证明作者是你**（`96f3293d` 就把并行会话的整节替他们提交了，详见 B53）。
- 脚本里开了 `set -o pipefail` 时，**别写 `if ! diff -u A B | grep -q …`**：`diff` 在有差异时退 1，
  整条管道状态就是 1，匹配成功也会被读成失败（本轮在此空转四趟）。改成直接 `grep 文件`。
