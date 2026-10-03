# 交接：倒数纪念日 批次二 —— 哪些真闭合了、三条并行线怎么收、合流时有两条义务必须兑现

> 状态：**批次二 10 张工单里 6 张闭合**（W0 / W0b①② / W2 / W5 / W9 web 半 / W10 / L'）。
> 🔴 **22:0x 增量（本段全部做完并验证过，接手者不必重做）**：W4b 服务端半那 4 笔**已挑进**
> `feat/countdown-batch2`（合流义务 §3.2 的 ADR 指针**已逐处核完**，现量是 12 处不是 1 处）；
> 三条并行线合进来的内容**第一次跑了验证** —— `pnpm -r build` rc=0、`pnpm -r typecheck` 从 2 枚红修到 rc=0、
> shared-schema / domain / ui / mobile / local-api / ai / app-host / **服务端全套**都跑过（读数见 §2.2）；
> `check:public-facts` **已立并接进 `pnpm check`**（八臂 8 红 0 存活），`CalendarBoard` 的 `dayMarker` 缝**已开**
> （ADR-0052 §2.6 要的那条默认值等于原值的可选 prop）。
> 🔴 **23:0x 增量**：W4b **客户端拉取那半已落地**（3 笔：storage 的 META 通用读写 / app-host 的
> `public-facts.ts` / web 接线 + i18n 中英），**判据①第一次有了真界面载体**（e2e 三档、3 passed、
> 三张图人已看）；25 臂变异逐臂报红。⇒ W4b 只剩一条：**papers 的后台界面回显**目前只到 API 层。
> 🔴 **仍未做**：
> W7 设备出图那半、W8 原生壳那半与壳级门禁、W9 原生投递（另一条会话）；W6 停放（23:0x 复量仍 14 脏，
> 且撞车面**新增 4 个未跟踪文件** —— 日/年视图与拖拽，见 §5）；
> **收尾四项（§8.3）除第 1 条的两半之外没启动**。
> 🔴 **所有成果都在本地分支，没有 push、没有 merge 进 `main`**。
> 交接日期：**2026-10-03**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测读数。
>
> 🔴 本文只记**当前停在哪**。决策与理由不重复 —— 权威在
> [`countdown-anniversary.md`](countdown-anniversary.md)（工单定义 §3、批次二逐项范围/落点/判据 §8.2、进度总表 §8.4、收尾清单 §8.3）、
> [`../adr/0052-public-facts-are-deployer-supplied.md`](../adr/0052-public-facts-are-deployer-supplied.md)（W4b 那条通道定性）、
> [`../adr/0038-admin-console-scope.md`](../adr/0038-admin-console-scope.md) §5（后台范围的勘误）、
> `AGENTS.md` §9（摘要表）。**本文不替代那些**，只记"接手要用的状态 + 下一步命令"。
>
> ### 🔴 接手先读这五节（其余按需）
> | 要做什么 | 读哪节 |
> |---|---|
> | **知道 Goal 要求做完的全部范畴**（离开聊天也能接着跑） | §0.5 —— 🔴 它是任务书原文，逐项标了当前状态 |
> | **收三条并行线**（W7/W8/W4b → batch2） | §2 —— ✅ **22:0x 已全部收完**；验证读数在 **§2.2**（新） |
> | **合流时的两条硬义务**（法务六位置翻转 / ADR 编号指针） | §3 —— 🔴 这两条**没有门禁兜底**，漏了就变成对外说假话 |
> | **接着写 W4b 剩余半** | §4（有现成形状，附 file:line 与实测的"不要另建一套"的读数） |
> | **跑收尾** | §6（四条，含 `check:docs` 那 33 处红的正确处置） |

---

## 0. 一句话现状

批次二的**代码半基本落地**，卡点不在代码而在**合流**：三条并行线（W7/W8/W4b）的成果还躺在各自
worktree 的未提交改动里，而 `feat/countdown-batch2` 落后 `main` **24 笔**（`main` 是多人协作的活树，
不是我的基线）。**下一段最贵的工作是把三条线收进 batch2 并兑现 §3 那两条义务，不是再写新功能。**

本轮新增了一条**常驻门禁**：`pnpm check:legal-permissions`（`1d71e75f` + 加固 `017adc3e`，在 batch2 分支），
它把"移动端不申请任何权限"这类**对外承诺**与 manifest / Info.plist / entitlements 的**真实声明面**对账。
13 臂变异全红、0 臂未证。

---

## 0.5 当前 Goal 的完整范畴（任务书原文照录 + 逐项状态）

> Goal `1791011766720-0444bf`，**turn 预算 100**（20:5x 现量：`Progress: 1/100 turns used` —— 每轮注入的
> 计数会被上下文压缩重置，别把它当"只用了 1 轮"的事实来推断；预算用尽时 Goal 自动暂停，**只有用户能
> `/goal resume`**）。目标**尚未完成 ⇒ 不要调用 `update_goal complete`**。

**任务书原文（范畴定义，逐字）**：

> 先对代码现状做一次深度调研，然后在调研结论之上把「倒数纪念日」**批次二全部工单实现完成**（不是只做计划），
> 每完成一项就按计划文档打勾并同步 AGENTS §9。

🔴 **"全部工单实现完成"的判据是"每一项都落到当前产物并通过各自判据"，不是"每一项都动过代码"。**
按这个口径逐项对账：

| # | Goal 要求的范畴（原文，不缩减） | 现在到哪一步 | 还差什么 |
|---|---|---|---|
| W0 | 批次一遗留的登记缺口收掉（`/tmp/ui.xml` 固定名 36 处、`verify-mobile-repeat.sh:243` 硬印库名、**待入台账的两条正文搬运**） | 🟡 **①② done**（`6598703b`，harness 22 绿 0 红） | ③ **台账搬运没做**：`environment-traps.md` 正脏 ⇒ 正文停在计划 §3.5（`:675` 起），任务 #14 |
| W2 | 新实体 `EVENT` 落 `shared-schema` + `domain` + `op-log` reducer + 存储三套适配 + 线协议契约；🔴 部署顺序硬约束"服务端先于客户端"；ADR-0044 已定"闰月生日逢闰过正" | ✅ 已闭合（`bb6c1203` + `05794dc5`），**且服务端那一腿本轮补上了**（`30340fa2`：`EVENT` 认领进 `validation.service.spec.ts` 的手写实体清单） | 无。**但"服务端先于客户端"是部署期义务，`reinstall:all` 那一步要按它排序** |
| W5 | 倒数日卡片网格 + 二级操作（界面） | ✅ 已闭合（`a9529a59` + `94760c82` + `c07df677`），e2e 6 passed、三张图人已看 | 无 |
| W6 | 第二个日期数据源 | ⏹ **停放**（撞车面非空，关闭判据见 §5） | 等六个日历路径 `git status --porcelain` 归零后落地，复用 §4 第 3 条的 `dayMarker` 缝 |
| W7 | 纪念卡片导出为**成品图**（设备渲染导出，**零通道、零法务变更**；区别于素材图） | 🟡 **已提交 `581bdb99` 并合进 batch2 `caf9a48c`**：只有线协议契约（99 行）+ ui 侧字段（+42）。🔴 合进来的东西**本轮第一次跑过**：`shared-schema` 117 passed、`pnpm -r build` rc=0（⚠️ 但它是靠 build 才第一次进 dist —— 起手 `grep -c EXPORT_CARD_EDGE_PX dist/index.js` = **0**） | 🔴 **设备出图那半没有**：RN/原生渲染导出、`check:*` 门禁、判据（含"零法务变更"的现量复核）全未做 |
| W8 | 三端（web / mobile / 原生壳）接线与壳级门禁 | 🟡 **已提交 `b8f39cae` 并合进 batch2 `db430cc9`**：移动半（`CountdownScreen` 267 行 + `feature-entries` 109 + `countdown-display` 133）+ 领域层 `feature-modules.ts` 77 + 测试 244 行；web 半已随 W5 落地。✅ **那 244 行本轮真跑了**：`@heyta/mobile` 547 passed、`@heyta/domain` 859 passed（起手 4+15 枚红全部是读旧 dist，见 §2.2 第 1 条） | 🔴 "三端"里**原生壳那半 + 壳级门禁**没有产物 |
| W9 | 提醒（含投递路径 —— 现状是全仓零 `new Notification(`） | 🟡 **web 半 + DST ✅**（`a8f5a9a6`，变异 9/9 红）；**原生投递那半没动** | 投递路径 = Goal 明文要求的**没做完**那半（ADR-0051 另立一单）；合流时连带兑现 §3.1 |
| W10 | `EVENT` 必须**同时**进 AI 工具目录与 local-api 工具契约（实体与 AI 工具一起做；不改 `ENTITY_TYPES` 驱动的排期决定） | ✅ 已闭合（`8a595493` + `e2aeedc4`），目录 4 条 EVENT 工具，MCP 与内置 AI 共用同一份 | 无。⚠️ 副作用已被 L' 抓住并修（`ai-and-transfer.ts` 那张表 = 授权面） |
| W4b | 调休/补班的运营录入通道 + 客户端拉取（heyta **第一条服务端→客户端内容通道**，**ADR 必须定性，且回写 ADR-0038 的后台范围表**） | ✅ **代码链已闭合**（23:0x）：服务端半那 4 笔（`a39f7fa6`/`a2259e5d`/`3708d08c`/`2877dd37`）+ ADR 定性与 0038 回写（`c28e5f1a` @ `main`）+ §3.2 ADR 指针（`1dbe6df6`）+ 门禁 `check:public-facts`（`3f327dc2`，八臂 8 红 0 存活）+ `dayMarker` 缝（`509a06cd`）+ **客户端拉取三笔**（`6735cc39` storage META 通用读写 / `b05fbc50` app-host 模块 / `67fef701` web 接线 + i18n + 真界面判据）。判据①**已在真界面跑过**（三档截图人已看，读数见 §4） | 🔴 **只剩一条**：判据②"papers 在**后台界面**回显"目前只到 API 层（`admin.routes.ts` 的 GET 带 papers，但 `apps/web/src/features/admin/` 没有调休面板、`admin-client.ts` 也没有对应方法）⇒ 面板正在补（见 §4 末），补完并跑过判据才打勾 |
| L 系列 | 法务联动 —— 改 `packages/legal` 那六处现成位置、每处中英双份、落地页文案走生成物不许手改（`check:legal-copy` 已在 `pnpm check`） | 🟡 **判定表已出、唯一真命中已修**（`2d53ea94` + `8996de9d` + `1d71e75f`/`017adc3e`） | 🔴 六处**没有被"全改一遍"是判定结果**（§4 时序条款：纯文字版不触发 L1/L2/L4/L5），但 **§3.1 那六个字面位置随 W9 那半必须翻转** |
| 收尾 | Goal 第 7 条 + 计划 §5/§8.3 | 🟡 **§6 第 1 条的两半已做**（`pnpm -r build` rc=0、`pnpm -r typecheck` rc=0、八个包 + 服务端全套的读数见 §2.2） | `check:docs`（33 处是别人未跟踪文档的函数）、界面截图人看、`pnpm reinstall:all` 四端 —— 全未做 |
| 同步 | 每完成一项 → 计划文档打勾 + **同步 AGENTS §9** | 🟡 计划文档已同步（`cd839ec5`）；**AGENTS §9 欠着** | `AGENTS.md` 脏 ⇒ 不能 `--only` 提交（§7 第二条），等干净后补 |

**硬边界与纪律（任务书原文 7 条，逐条仍在生效）**：

1. 先调研再动手：开工前给出"现状 vs 工单"的差集（带 `file:line` 与可复跑读数），不许凭记忆建计划。
2. **push 与 merge 属共享状态动作，不擅自执行**；本地提交用点名路径。
3. 不干扰主检出与并行会话（他们正在改日历与 AI 线）；`docs/reference/environment-traps.md` 被写脏时不往里追加，
   改投单写者文档并登记"待入 traps #N"（编号按当时工作树现量）。
4. 设备/端口/库只用私有现场（隔离检出 + 私有 AVD + 私有 `PORT` + 私有库名），负载门等满以 `exit 3` 结束 = **环境无效不是产品失败**。
5. 不 bump `CURRENT_SCHEMA_VERSION`；给持久化模型的新字段一律可选并给运行时默认值；不改已接受 ADR 的结论（要变更另写一份）。
6. 每步判据必须带可复跑命令与实际读数；**新增门禁必须先证明它能失败**；界面结论必须有截图且人真的看过。
7. 每完成一项：行为改动与结构改动不混提交，并在 `docs/plans/countdown-anniversary.md` 对应 W 节打勾
   （写成过去式 + 读数），同步 `AGENTS.md` §9 的进度行。

---

## 1. 已闭合的（都已提交，可逐条复跑）

载体：`feat/countdown-batch2` @ `db430cc9`（21:0x 现量：W7/W8 已并进来，见 §2），worktree
`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-batch2`（`git status --porcelain` ⇒ **0 行，干净**）。
分支 `19 ahead / 25 behind main`（21:1x 现量；`main` 在动，这个数每轮都要重取）。

| 工单 | SHA | 一条可复跑的读数 |
|---|---|---|
| W0 锚点弹层算术上提共享层 | `7966857a` | `pnpm --filter @heyta/ui test` ⇒ 448 passed；变异 1 臂转红 |
| W0b ①② 设备验收现场隔离 | `6598703b` | `/tmp/ui.xml` / `_xy.py` / 库名改带默认值旋钮（默认值逐字不变）；harness 22 绿 0 红 |
| W2 `EVENT` 实体整链 | `bb6c1203`(+`05794dc5`) | 20/7/17/41/30 passed；`listEvents` 已进 `READ_PATTERNS` 且**三腿验过能红** |
| W5 卡片网格 + 二级操作 | `a9529a59`(+`94760c82`,`c07df677`) | e2e **6 passed**（整族 15 passed）、三张图**人已看**；看图照出"逾期卡整行不画日期"并修掉 |
| W9 提醒（web 半 + DST） | `a8f5a9a6` @ `feat/countdown-w9` | 42/28/40 passed；变异 **9 臂 9/9 红、0 未证**；移动端那半**没动** |
| W10 AI 工具目录 | `8a595493`(+`e2aeedc4`) @ `feat/countdown-w10` | 130/223/1019 passed；变异第一趟 **3 臂存活** → 补判据 → 第二趟 6/6 红 |
| L' 命中项 + 工具表对账门禁 | `2d53ea94` + `8996de9d` | `check:legal-tools` 四臂变异全红；条款补 4 行、`version 1.0→1.1`（进同意指纹） |
| L' 权限承诺对账门禁 | `1d71e75f` + `017adc3e` | 见 §1.1 |
| W4b 文档半（ADR 定性 + 0038 回写） | `c28e5f1a` @ **`main`** | 死链复核 `node research/tools/docs-link-check.mjs \| grep -E 'adr/0038\|adr/0052\|countdown'` ⇒ 无命中 |
| 计划文档三处自证否证 | `cd839ec5` @ **`main`** | 见 §8（那些 dead end 就是这一笔的内容） |

### 1.1 `check:legal-permissions` 的绿读数（复跑即得）

```bash
cd "…/heyta-wt-batch2" && NO_COLOR=1 node scripts/check-legal-permissions.mjs; echo rc=$?
```

```
✅ 权限承诺对账通过：Android 声明 1 条 [INTERNET]、NS…UsageDescription 0 条、句子项数 zh=9 en=9、
登记表 9 项、REVIEWED_REQUESTED 0 项、通知授权 未声明（六个承诺位置命中 6/6）（声明面与"不申请"那九项逐一对得上，
中英同数量，通知族六个位置与申请面同真假）
rc=0
```

它已接进 `pnpm check`（`check:legal-tools` 与 `check:legal-host` 之间）。
变异清单在 `/tmp/mutate-permission-claims.mjs`（**13 臂，未证伪 0，夹具失效 0，逐字节还原=是**）——
⚠️ `/tmp` 会被清，**臂的语义已在门禁本体里**（每臂对应哪条 `fail()` 可直接读源码），不必依赖那个文件。

---

## 2. 三条并行线的现量（22:0x 已全部收进 batch2；下面的逐文件读数是当时取的，引用前重取）

| worktree | 分支 / HEAD | 未提交 | 状态（21:0x 更新） |
|---|---|---|---|
| `heyta-wt-w7` | `feat/countdown-w7` @ `581bdb99` | **0（已提交）** | ✅ **已并入 batch2**（merge `caf9a48c`） |
| `heyta-wt-w8` | `feat/countdown-w8` @ `b8f39cae` | **0（已提交）** | ✅ **已并入 batch2**（merge `db430cc9`） |
| `heyta-wt-w4b` | `feat/countdown-w4b` @ `e442a3bb` | **0（已提交）** | ✅ **那 4 笔代码提交已挑进 batch2**（`a39f7fa6`/`a2259e5d`/`3708d08c`/`2877dd37`，union 解掉唯一相撞面）；`d4fd01a1` 那笔文档单独处置，未并 |

✅ **21:0x 增量（这一段我做完了，接手者不必重做）**：三条并行线原来 100% 躺在未提交改动里，
现已各自按点名路径落成本地提交（worktree 全部 0 脏），且 W7 / W8 已合进 `feat/countdown-batch2`：

| 动作 | SHA / 读数 |
|---|---|
| W7 提交（3 文件 +158） | `581bdb99`，`card-export-contract.ts` 99 行新 + `ui/src/countdown/model.ts` +42 + `shared-schema/src/index.ts` +17 |
| W8 提交（11 文件） | `b8f39cae`，含 `feature-modules.ts` 77 / `CountdownScreen.tsx` 267 / `feature-entries.spec.ts` 244（新） |
| W4b 服务端半提交（8 文件） | `e442a3bb`；🔴 迁移**确实存在**（`a2313c9a` 带 `server/prisma/migrations/20261009000000_add_holiday_adjustments/migration.sql` 139 行 + `schema.prisma` +78，两张模型 `HolidayAdjustmentYear:996` / `HolidayAdjustmentDay:1024`） |
| merge W7 → batch2 | `caf9a48c`，**合后 tree 与预演 tree `db0d9205…` 逐字相同** |
| merge W8 → batch2 | `db430cc9`，合后 tree 与预演 `b5f3cd2c…` 的差集**恰好是 W7 那三枚文件**（因为基线已含 W7）⇒ 自动合并没有产生第三种形状 |
| batch2 现态 | HEAD `db430cc9`，`git status --porcelain` = 0 脏，`main..HEAD` = **19 笔**（原 15 + 3 笔合并链 + …），**未验证**（见 §6） |

🔴 **这三笔合进去的是"半成品"，不是"验证过的成品"**：W7 只有契约、**没有设备出图那半**；
W8 有移动半与测试但**一行都没跑过**；壳级门禁没做。合流的语义只是"别丢工作"，不改变 §0.5 里两行的状态。

### 2.1 W4b 的并入配方（下一次照着做，别重新推）

- **决策已定：只挑 W4b 那 5 笔，不整支合并。** 那条分支相对 batch2 有 10 笔独有提交，其中 5 笔**不属于本批**：
  `192a516d`（organizer/habits 两端改名删除）、`437e7c1a`（ledgers 文档）、`76cbee51` + `c506953b`（真机脚本别名/自快照登记）、
  `6570e52d`（W0 打勾文档）。那是**别人在 main 线上的工作**，我吸收进本批就等于替他们决定落地时机。
- 要挑的顺序：`981eee43` → `7049bfed` → `a2313c9a` → `e442a3bb`（4 笔代码），`d4fd01a1`（W4b 开工实测的文档笔）**单独处置**——
  它改的 `countdown-anniversary.md` 在 main 上已经走到 `cd839ec5`/`33eea3e5`，直接 cherry-pick 必撞。
- 🔴 **卡点与解法（已复现一次）**：`git cherry-pick -x 981eee43` 在 `packages/shared-schema/src/index.ts` 撞 `UU`——
  HEAD 那侧是我刚合进来的 **W7 导出块**（`EXPORT_CARD_EDGE_PX` 等，带"边长/比例/格式是产品规格所以住契约层"那段注释），
  另一侧是 **holiday-adjustment 的导出块**。两者是**不同文件的各自新增** ⇒ 正确解是 **union（两段都留）**，不是择一。
  我按用户"到此为止"的指令已 `git cherry-pick --abort` 退回 `db430cc9`（脏 0，源提交 `e442a3bb` 仍在，零丢失）。
- 挑完之后：`server/tests/holiday-admin-routes.spec.ts`（351 行新）与 `admin-routes.spec.ts`（+56）**第一次跑**要在 batch2 上，
  并把契约文件头那句不存在的 `ADR-0050` 指针改成 **ADR-0052**（§3.2）。


**冲突来源已定位（省掉下一轮重新推）**：整支合并时唯一真冲突 `scripts/verify-mobile-lists.sh` 来自
`c506953b`（真机脚本别名那笔，**不属于本批**）⇒ 只挑 §2.1 那 4 笔代码提交就**根本碰不到它**。
四笔的落点已逐笔量过：

| 提交 | 文件与尺寸 |
|---|---|
| `981eee43` | `holiday-adjustment-contract.ts` 241 新 / `shared-schema/src/index.ts` +29 / 契约测试 279 新 |
| `7049bfed` | `packages/domain/src/holidays.ts` +224 / `holiday-adjustment-override.spec.ts` 242 新（判据④那三条分支） |
| `a2313c9a` | 迁移 `20261009000000_add_holiday_adjustments/migration.sql` 139 / `schema.prisma` +78 / pglite 迁移测试 363 新 |
| `e442a3bb` | 契约 +177/−43、`server/src/holidays/{day-column,store,routes}`（34/353/126）、`admin.routes.ts` +108、`server.ts` +14、两个测试 |

⇒ 唯一的相撞面是 `packages/shared-schema/src/index.ts`（W7 的导出块 × W4b 的导出块），解法 union。

复跑命令：

```bash
cd "…/heyta" && git merge-tree --write-tree --name-only feat/countdown-batch2 feat/countdown-w4b | head -40
```

---

### 2.2 首次验证读数（22:0x，载体 = `feat/countdown-batch2` @ `509a06cd`）

合进来的东西**第一次真跑**。逐条可复跑：

| 跑的是什么 | 命令 | 读数 |
|---|---|---|
| 全量构建 | `pnpm -r build` | **rc=0**，含 `server build$ prisma generate && tsc` |
| 全量类型 | `pnpm -r typecheck` | 起手 **2 枚红** → 修完 **rc=0**（19 个包；server 没有 typecheck 脚本，它的类型由 `tsc` 在 build 里查） |
| W4b 契约 | `pnpm --filter @heyta/shared-schema test` | **117 passed** |
| W4b 判据④三条分支 | `pnpm --filter @heyta/domain test` | **859 passed**（起手 15 枚红，见下面第 2 条） |
| W7 消费面 | `pnpm --filter @heyta/ui test` | **452 passed**（448 + 新开的 dayMarker 缝 4 条） |
| W8 移动半 | `pnpm --filter @heyta/mobile test` | **547 passed**（起手 4 枚红，同一原因） |
| W10 的两处类型红 | `pnpm --filter @heyta/local-api test` / `@heyta/ai test` | **130 / 223 passed** |
| 服务端全套（**第一次**） | `pnpm --filter @heyta/sync-server test` | 起手 **1 failed**（下面第 3 条）→ 修完那条 spec 单独复跑 **62 passed** |
| 共享组件回归 | `pnpm --filter @heyta/web test` | **1512 passed / 12 skipped** |
| 新门禁 | `pnpm check:public-facts` | rc=0；`GET 路由 20 条，匿名 3 条` |
| 样式与文案 | `check:design` / `check:ui-language` | ✅ 无硬编码 / ✅ 299 文件 379 处文案 |

**三条只能在本轮拿到的事实**（都是"上一轮写成主张、这一轮跑出来"那种）：

1. 🔴 **那 19 枚红没有一枚是产品缺陷，全部是判据读了旧 `dist`。** 起手 `packages/shared-schema/dist/index.js`
   的时间戳是 **17:05**，而 `grep -c EXPORT_CARD_EDGE_PX dist/index.js` = **0** —— 也就是说 W7 的契约
   **从来没被构建过**。`pnpm --filter @heyta/shared-schema build` + `@heyta/domain build` 之后
   15+4 枚一起消失。⇒ AGENTS §7 第 27 条那一族的又一副面孔：**共享包源码变了，任何读 dist 的判据
   都还在测上一个版本**，而它报出来的错长得像真缺陷。
2. 🔴 **交接 §6 那句"沙箱里跑不了 `@heyta/sync-server`（`prisma generate` EPERM）"被现量否证。**
   本轮 `prisma generate` 正常出来（`Generated Prisma Client (v5.22.0) … in 147ms`），服务端 91 个测试文件
   跑起来了。**别把环境主张当常量抄下去** —— 它多半取决于当时谁的进程占着什么。
3. ✅ **服务端那一枚红是真的，而且是 W2 欠的一步**：`validation.service.spec.ts` 的
   `ALLOWED_ENTITY_TYPES` "精确数量"断言红 —— 它对照的 `HEYTA_ENTITY_TYPES` 是一份**手写清单**，
   而清单自己的注释写着"加实体必须是有意识的决定，不能被顺手带过去"。W2 加了 `EVENT` 却没在服务端这侧认领，
   因为当时只跑了 `packages/*`。⇒ 修的是**认领**（`30340fa2`），不是数量断言。
   这条同时说明：**W2 那个 ✅ 原本缺了服务端这一腿**。

**载体事实**：本轮 21:13→21:39 之间这台 Mac **重启过一次**（`uptime` 从 `up 7 days` 变成 `up 8 mins`），
负载随之从 375 掉到 15-25；并行会话的重活被打断过，接手时它们的现场要重新现量。

---


## 3. 🔴 合流时必须兑现的两条义务（没有门禁兜底，漏了就对外说假话）

### 3.1 L' 通知族：六个字面位置要跟着 W9 翻转

`feat/countdown-w9` 那条线把"移动端不产生系统通知"变成了历史。六个承诺位置（权威清单在
`scripts/check-legal-permissions.mjs` 的 `NOTIFICATION_CLAIM_SLOTS`，别在本文里抄第二份 —— 抄件一定漂）：

- `packages/legal/src/documents/permissions.ts` —— Android 行依据（zh + en）、iOS 行依据（zh + en）
- `packages/legal/src/documents/third-parties.ts` —— 推送 SDK 否表行（zh + en）

门禁是**两侧对称**的：`声明了 & 条款仍说不申请` ⇒ 红，`没声明 & 条款已说不申请` ⇒ 也红。
所以**改的顺序只能是"依赖与条款同一笔提交"**，不能先加依赖后改条款。

同时必须做的第二件：W9 会往 Android manifest 加 `SCHEDULE_EXACT_ALARM` 之类的权限 ⇒
**显式登记进 `NON_PRIVACY_ANDROID_PERMISSIONS` 并写理由**（那是"非隐私权限"白名单，
不登记就会红；为把它变绿而放宽判断 = 摘掉门禁）。

复跑：`node scripts/check-legal-permissions.mjs`（改完）+ `pnpm check:legal-copy` +
`pnpm --filter @heyta/legal build`（**条款正文改过必须升 `version`，它进同意指纹**：`packages/legal/src/index.ts:125`）。

### 3.2 ADR 编号撞车：`0050` → `0052` 的指针要改

`packages/shared-schema/src/holiday-adjustment-contract.ts` 文件头引用了**不存在的 ADR-0050**
（0050 已被 E2EE 那条占用、0051 是移动端提醒投递）。本决定实际落在
**ADR-0052**（`c28e5f1a` @ `main`）。⇒ 合流时把那处指针改成 0052。
`AGENTS.md` 里并行会话也写过一行 `0050→0051` 的错引，**不代改**（他们的文件正脏）。

✅ **本义务已于 `1dbe6df6` 兑现**，但现量比这里写的**大一个数量级**：不是"那处"，是 **12 处 / 9 个文件**。
逐处对着 ADR-0052 的正文核过，机械换号会留下三类错：① 章节号错（`§3/§6` 在 0052 里是 §2.1/§2.2，
0052 的 §3 是"为什么不选另外两条路"）；② **两处引用了 0052 里根本没有的话**（"§5 的体积账"、
"§4 明写它不是内容寻址"）—— 已改成引用真实立场（§4 第 4 条"缓存不是正确性来源"），
"体积账"归给契约常量自己推导；③ `holiday-adjustment-contract.ts` 那条链接**少一层 `../`**，
换了号也仍是死的。📌 **`docs-link-check` 只走 `.md`**（实测 `collectMarkdown` 只收 `.md`）⇒
代码注释里的链接**没有任何门禁在看**，所以它能编号和深度同时错而全绿。

---

## 4. W4b 剩下的半（客户端侧，全部从零）

> 🔴 **22:0x 更新**：下面第 1 件（后台录入）随 §2.1 那 4 笔**已经落地**（`admin.routes.ts` 的 GET/PUT/DELETE
> 三端点 + `server/tests/holiday-admin-routes.spec.ts` 351 行）；第 3 件（`dayMarker?`）**缝已开**
> （`509a06cd`，判断在 `calendar/model.ts` 的 `calendarDayMarkerView`，4 条判据 + 三臂变异全红），
> 宿主接线还没人传它。⇒ **本节只剩第 2 件是从零**，加上判据①要在真界面上跑一次。

> 🔴 **23:0x 增量 —— 第 2 件（客户端拉取）与判据①都做完了，读数如下**：
>
> | 落点 | 提交 | 判据与变异 |
> |---|---|---|
> | `OpLogStore` 开出一对 META 通用读写 | `6735cc39` | 契约一条判据覆盖四件事（缺键 `undefined` / 值型不变 / 覆盖生效 / 不碰游标），在 **6 个适配变体**上各跑一次；三臂变异 **6 红 / 6 红 / 2 红** |
> | app-host `public-facts.ts`（匿名拉取 + 缓存 + 装进领域层） | `b05fbc50` | 10 条判据；**8 臂变异逐臂精确报红**（去 `credentials:omit` / 塞 `authorization` / 路径改回手写 / 丢 `papers` / 未配置也发请求 / 坏形状覆盖缓存 / 不发条件请求头 / 无缓存时抛错） |
> | web 接线 + `publicFactsEpoch` + i18n 中英 + 真界面判据 | `67fef701` | 宿主层 7 条判据；**7 臂变异逐臂报红**（其中 W1/W6/W7 各命中 2 条，因为订阅与幂等共用一个守卫） |
>
> 🔴 **判据①第一次有了真界面载体**（`e2e/tests/public-facts.spec.ts`，3 passed，三张图入库
> `e2e/test-results/public-facts-{local-only,self-hosted-404,deployer-supplied}.png`，**人已打开看过**）：
> A 没配服务端 / B 那条通道 404 ⇒ 42 格齐全、随包表的「休」（10-01…10-07）与「班」（10-10）照画、
> 控制台零 error；C 部署方只下发 10-17 ⇒ 那一格出「班」，**而 10-01 的「休」整年替换掉**（这是
> ADR-0052 §2.2 的语义，若实现做成"合并"在界面上完全看不出来，所以两条腿都断言）。
>
> ⚠️ 两条**当场发现、当场没修**的：
> ① 左侧**迷你月历不跟着画标记** —— 它是 `CalendarSidebar` 自己那份网格，不在共享板上，
>    而它正被日历线整片重写（§5）⇒ 由 **W6 复用同一条 `dayMarker` 缝补齐**，不在这里长第二份；
> ② 判据②"papers 在**后台界面**回显"只做到 API 层 —— 后台没有调休面板，`admin-client.ts` 也没有
>    对应方法 ⇒ 已开工补面板（`apps/web/src/features/admin/` + `admin-client` + i18n + 判据），
>    **面板落地并跑过判据之前 W4b 不打勾**。

已落（服务端半，未提交）：两张表 + 1 条迁移（年度录入存 `papers` / 逐日 `day DATE + isOffDay BOOLEAN`）、
线协议契约在 `shared-schema`（**唯一一份**）、`holidays.ts:108 adjustmentOn()` 接上"部署方下发的覆盖表"入口、
`ETag` / `Cache-Control` / 304。

待做四件，按依赖顺序：

1. **后台录入**（照 `/coupons:614` `/invites:670` 的形状，闸门 `admin.middleware.ts:34` 自动覆盖新路由）。
2. **客户端拉取 + 缓存**。🔴 **不要为它论证破边界** —— 我原先写"app-host 没有任何 `fetch(`"是错的，
   实测它有 **5 处 `fetchImpl`**（`admin-client` 1 / `entitlement` 1 / `inbox` 1 / `privacy-consent` 2；
   `host.ts:110`、`hosted-auth.ts:630` 绑 `globalThis.fetch`）⇒ **照 `fetchImpl` 现成形状接，公共事实不许带 token**。
   ✅ **22:2x 补两条现成的落点**（省掉下一轮重新摸）：
   · META 里**放字符串早有先例** —— `host.ts:205-215` 的 `resolveClientId()` 就是
     `adapter.get<{key:string;value:string}>(STORES.META, META_KEYS.CLIENT_ID)` + `adapter.put(...)`，
     而 `DbAdapter` 本体是 `put(store, value: unknown, key?)` / `get<T>(store, key)`（`db.types.ts:164`），
     三套适配都吃得下 ⇒ **不需要为公共事实扩存储 API**，加 `META_KEYS` 两项即可。
   · 🔴 **拉取必须带外做**：`packages/domain/src/holidays.ts` 文件头把"让 `adjustmentOn()` 变 async"
     明确列为**已否证**的方案（理由写在那里："不确定"在日历上就是空白块 = 判据①要防的东西）。
     所以形状只能是 启动/回前台 fetch → 写 META → `installHolidayAdjustmentOverrides()` → 界面重算。
3. **`CalendarBoard` 的 `dayMarker?` 可选 prop**（默认值等于原值 ⇒ 消费者零改动）。
   ⚠️ **W6 落地时复用这条缝，不要另开注入点。**
4. **新门禁 `scripts/check-public-facts.mjs`** 并接进 `pnpm check`，判据四条：
   ①自托管拿不到数据时**不报错、不留空块**，且要在**真界面**跑一次（截图 + 人看）；
   ②`papers` 链接随数据入库并在后台回显；③非法日期 / `isOffDay` 非布尔 ⇒ 录入被拒（变异）；
   ④**接缝本身有判据**：有覆盖用覆盖 / 无覆盖退回随包 / 覆盖里日期非法 ⇒ **整年拒绝**，三条分支分别测。

缓存位置按 ADR-0052 §2.5：`STORES.META` / `META_KEYS`，**不进 op-log、不 bump `CURRENT_SCHEMA_VERSION`**。
迁移纪律（AGENTS §4）：一个文件一条语句、`CONCURRENTLY` 走可恢复形状、需 `ACCESS EXCLUSIVE` 的 DDL 自带
`SET LOCAL lock_timeout`、部署只走 `sh scripts/migrate-deploy.sh`、提交前 `node scripts/check-migrations.mjs`。

---

## 5. W6 保持停放（关闭判据是**可判的**，不是"等日历线忙完"这种印象）

```bash
cd "…/heyta" && git status --porcelain -- packages/ui/src/calendar apps/web/src/features/calendar \
  apps/mobile/src/screens/CalendarScreen.tsx | wc -l      # 现在 = 非 0 ⇒ 继续停
```

20:2x 现量的撞车代价：`calendar/model.ts` **+264/−7**（261→518 行，含一处 166 行整块插入）、
`CalendarBoard.tsx` +107、`CalendarScreen.tsx` +153。HEAD 与他们的版本里 `grep -c 'EVENT'` **都是 0**
⇒ 这条**没被别人顺带做掉**，等它归零后由我方落地（复用 §4 第 3 条的 `dayMarker` 缝）。

🔴 **23:0x 复量：没有归零，而且撞车面变宽了** —— 同一命令现量仍是 **14**，但里面**新增了 4 个未跟踪文件**：
`packages/ui/src/calendar/{CalendarDayBoard,CalendarViewTabs,CalendarYearBoard}.tsx` 与
`apps/web/src/features/calendar/{drag-day,useDragDayNav}.*` ⇒ 日历线正在做**日视图 / 年视图 / 拖拽**，
不是收尾中的余波。停放的判定继续成立。

⚠️ **给合流的人的一条硬提醒（新）**：我方 `509a06cd` 与 `67fef701` 改的
`packages/ui/src/calendar/{model.ts,CalendarBoard.tsx}` 和 `apps/web/src/features/calendar/{CalendarView.tsx,store.ts}`
**逐个都在上面那 14 个里** ⇒ batch2 合回 main 时这四个文件必冲突。冲突解法不是二选一：
`model.ts` 里我方新增的是 `CalendarDayMarker` / `CalendarDayMarkerView` / `calendarDayMarkerView`，
`CalendarBoard.tsx` 里是 `dayMarker?` / `dayMarkerLabels?` 两个**可选** prop 与 DayCell 那一处渲染，
`store.ts` 里是 `publicFactsEpoch` + `bumpPublicFactsEpoch` —— **全部保住**，他们的新板子（日/年视图）
一旦也要标"休/班"，用的就是同一条缝（这正是 §4 第 3 条当初把它做成默认值等于原值的可选 prop 的理由）。

---

## 6. 收尾四项（计划 §8.3）—— 第 1 条的两半已在 22:0x 做完，读数在 §2.2

1. `pnpm -r typecheck && pnpm -r test` → **完整 `pnpm check`**。
   🔴 **`check:docs` 现在必然红：33 处**"本机有、仓库没跟踪"的死链，**全部落在并行会话的未跟踪文档上**
   （`docs/README.md` → `adr/0046`/`0047`/`0048`、`plans/trash-and-archive*`、`research/aed-implementation-evidence.md` 等）。
   **不吸收、不代改**（别人未跟踪的文件不该由我 `git add`）—— 正确处置是写成
   "缺口在哪一段、在谁手里"的现量。本批自己引入的死链：**0**（复核命令见 §8.3 第 1 条）。
   ⚠️ 死链数是别人未跟踪文档的**函数**，不是常量 —— 引用它必须带日期，我曾把"8 处"写成事实。
2. `node research/tools/docs-link-check.mjs` 带读数复核。
3. 界面结论必须截图且**人真的打开看过**；验收不抢前台（`HEYTA_NO_FOCUS=1` / `HEYTA_DESKTOP_NO_FOCUS=1`）。
4. `pnpm reinstall:all` 四端装上当前产物（AGENTS §6.1.1）；真机验收排最后，只用私有现场
   （隔离检出 + 私有 AVD + 私有 `PORT` + 私有库名）。**负载门等满 exit 3 = 环境无效，不是产品失败。**

⚠️ 沙箱里 `pnpm -r test` 跑不了 `@heyta/sync-server`（`prisma generate` EPERM）⇒
用 `pnpm -r --filter '!@heyta/sync-server' test` 复现那 2592 条，两者可比。

---

## 7. 工作区现场（20:5x 现量，接手前先重取）

- **主检出 `280` 个未提交条目**（`git status --porcelain | wc -l`）。正被并行会话整片重写的区域：
  `packages/ui/src/calendar/*`、`apps/web/src/features/calendar/*`、`apps/mobile/src/screens/CalendarScreen.tsx`、
  `server/src/*`（17 脏 + `causal-frontier` 未跟踪）、`packages/reminders/{notify,store,use-reminder-notifications}.ts`、
  `apps/mobile` 的 `AndroidManifest.xml` 与两个 `.plist`、`packages/legal/src/documents/third-parties.ts`、
  **`AGENTS.md`**、**`docs/reference/environment-traps.md`**、**`docs/README.md`**（+12/−1，6 个 hunk）。
- 🔴 **`AGENTS.md` 脏着 ⇒ §9 的同步欠着**（Goal 第 7 条要求每完成一项同步 §9）。
  不要在它脏的时候改它：`git commit --only AGENTS.md` 会把**别人未提交的 12 处**一起吸进我这笔提交。
- 🔴 **`docs/README.md` 脏着 ⇒ 本文的索引行没加**。要加的那一行原文如下，等它干净时补进
  handoff 那一组（`desktop-storage-host-handoff.md` 那行之后）：
  ```
  | [countdown-batch2-handoff.md](plans/countdown-batch2-handoff.md) | **交接：倒数纪念日批次二** —— 6 张闭合、3 条并行线未提交、合流时两条法务/ADR 义务 |
  ```
- 台账 `docs/reference/environment-traps.md`：工作树现量 `grep -cE '^[0-9]+\. '` ⇒ **197** 条（22:0x 重取；
  写过一次"196"几天后就漂了 —— **这类计数每次引用都要重取**）。
  计划 §3.5 里"待入 §7 的两条"正文已写好（`docs/plans/countdown-anniversary.md:675` 起），**编号按执行当时的现量取**，别按 HEAD。
  任务 #14：搬运 + 把 #168 改过去式（等该文件干净）。
- 其他在飞分支（**不属于本批，别并**）：`feat/detail-pane`、`feat/self-host-distribution`、
  `integrate/2026-10-03-closeout`、`feat/ai-entity-coverage`、`feat/assistant-history-local-persistence`、
  `fix/language-switcher`（顶部语言组件那条线，5 笔提交在 `heyta-wt-lang` @ `87b18975`，**未 merge**）。

---

## 8. 防重复踩：本轮被**现量否证**的六条我自己写下的断言

这些不是别人的错，是我先前写进文档/结论里的话。留原文形状是为了让下一轮认出同类错误：

1. **"W8 排后：同 W6，日历线未落地前不动 `CalendarScreen`"** —— 按"整条线在忙"推断。**否证**：W8 的落点
   （`shell/modules.ts`、`nav/TabBar.tsx`、四条 tab 计数测试）在 main 里逐个干净，web 半早已随 W5 落地。
   ⇒ **撞车的判据是同一文件的未提交 diff，不是"那条线很热"的印象。**
2. **"`packages/legal` 有 3 个文件脏 ⇒ 只登记不动"** —— 现量 **6 个**，而命中的那份
   (`documents/ai-and-transfer.ts`) **恰好不在脏集合里** ⇒ 改它零撞车。⇒ **脏清单每次都要重取。**
3. **"全仓 `server/src` 零 `ETag`/`Cache-Control`"** —— 是 **HEAD 读数**，且 W4b 分支已经加上了。
   ⇒ 写"某面全仓没有 X"要标明取的是 HEAD 还是活树。
4. **"`packages/app-host` 没有任何 `fetch(`"** —— 否证：5 处 `fetchImpl`（见 §4 第 2 条）。
   后果比"写错"更贵：它会让 W4b 去为一条**并不存在的边界**写 ADR 论证。
5. **"W9 已于 19:3x 完成"** 那个勾 —— 四十分钟后被另一会话的原生半重写，勾被就地作废（provenance 四条已留）。
6. **计划文档里我写的行号**（`holidays.ts:75/108/121/161` 一类）—— 取自**脏工作树**，HEAD 只有 261 行。
   ⇒ 锚点改按**符号**写，不按行号；行号必须带"哪一棵树"。

元规律：**"写对了再过期"是这类多人活树的常态**。凡是描述别人在飞状态的读数，
要么每次引用重取，要么把它**立成门禁**（本轮的产物就是 `check:legal-permissions` ——
L1 那条"前置闸门"从文档记忆变成常驻检查，踩响它的是 W9，不是 W7）。

---

## 9. 边界（任务书那 7 条在 §0.5；这里只记任务书之外的东西）

任务书那 7 条硬边界的**唯一事实源是本文 §0.5**（不在这里抄第二份 —— 抄件会漂，本仓库已经为此立过门禁）。
下面只记**任务书之外**、来自用户本人在对话里说过的长期指令与一条操作性推论：

- 用户长期指令仍然生效：**「真机收尾放到最后再做，先把代码工作全部做完」**、
  **「我们尽可能不要影响到现在的工作」**、**「不要再向我发任何的需求表单了，你直接做就行了」**
  （⇒ 长时段内一条问句都不要发）。汇报一律中文。「并行用 Agent 去解决」—— 能拆的独立块拆给子 Agent，
  但**共享资源（同一模拟器/同一构建目录/同一台账文件）必须先定所有者与运行窗口**（AGENTS §8 第 9 条）。
- 🔴 **`git commit --only 路径` 提交的是该路径的工作树内容**，会把别人在同一文件里未提交的行一起吸进我这笔提交。
  所以脏文件一律避让，改投单写者文档（本轮实例：根目录的 AGENTS 规则文件、`docs` 文档索引、
  环境陷阱台账 —— 三处的完整路径见 §7，都因此欠着）。
  复跑核对：`git diff --numstat -- 某个文件` 非 0 ⇒ 别 `--only` 它。
- Goal 未完成 ⇒ **不要 `update_goal complete`**；100 轮用尽会自动暂停，只有用户能 `/goal resume`。

---

## 10. 下一条会话的开场（可直接粘贴）

> 接着跑 Goal `1791011766720-0444bf`（倒数纪念日批次二**全部工单实现完成**）。
> 范畴、逐项状态与 7 条硬边界的**唯一入口**是 `docs/plans/countdown-batch2-handoff.md` §0.5 —— 先读它，
> 不要凭这份开场白施工。
>
> 接着跑 Goal `1791011766720-0444bf`（倒数纪念日批次二**全部工单实现完成**）。
> 范畴、逐项状态与 7 条硬边界的**唯一入口**是 `docs/plans/countdown-batch2-handoff.md` §0.5 —— 先读它，
> 不要凭这份开场白施工。
>
> 当前（22:0x，载体 = `feat/countdown-batch2` @ `509a06cd`）：§2.1 的挑配**已做完**（W4b 那 4 笔 =
> `a39f7fa6`→`2877dd37`，唯一相撞面按 union 解、两侧逐字保留）；合进来的东西**第一次跑了验证**，
> 读数与三条只能在本轮拿到的事实在 **§2.2**（那 19 枚红全是"判据读旧 dist"；服务端跑得起来，
> 原先那句"沙箱跑不了 sync-server"被否证；服务端照出一枚真红 = W2 欠的 `EVENT` 认领，已修）；
> §3.2 的 ADR 指针义务**已兑现**（现量 12 处不是 1 处，含两处引用了 ADR 里根本没有的话）；
> `check:public-facts` **已立并接进 `pnpm check`**（八臂 8 红 0 存活）；`CalendarBoard` 的 `dayMarker`
> **缝已开**（默认值等于原值，4 条判据 + 三臂变异全红）。
>
> 还差的，按依赖顺序：**(1) W4b 客户端拉取那半**（§4 第 2 件：照 `fetchImpl` 现成形状、公共事实**不带 token**、
> 落 `STORES.META`；⚠️ `packages/domain` 文件头把"让 `adjustmentOn` 变 async"列为**已否证**的方案 ⇒ 拉取必须带外做）
> → **(2) 宿主接线**（web 的接点 `apps/web/src/features/calendar/CalendarView.tsx:147`；主检出那一带仍 14 个脏文件）
> → **(3) 判据①在真界面跑一次**（截图 + 人真的看过）→ **(4) W7 设备出图那半** → **(5) W8 原生壳那半 + 壳级门禁**
> → **(6) 兑现 §3.1**（挂在 W9 原生投递上，另一条会话在做）→ **(7) §5 看 W6 归零没有** → **(8) §6 收尾**。
>
> **不 push、不 merge 进 main、不发问，直接做。**

