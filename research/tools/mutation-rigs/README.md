# 变异装置（`docs/research/performance-hotpaths-audit.md` §8.1 的证据）

这些不是门禁，也不是产品代码 —— 它们是**"这条判据到底能不能失败"的回答**：
每台装置都做三件事：① 先跑一次未变异对照（拿到"这套件一共几条、现在全绿"这个基线），
② 把被测对象改回病灶形状、跑同一份 spec、要求**红在该红的那一腿**（按断言名字点名，
不接受"红了就行"），③ 立刻还原并复跑，最后逐字节比对确认回到原样。
🔴 前七台改的是**工作树里的源码**（所以每台都带还原与逐字节比对）；
`verify-gate-wiring-candidate.mjs` 改的是**候选副本**（`--pkg`），工作树零改动 ——
用哪种取决于那个文件归谁，见下面第 4 条。

| 装置 | 钉的工单 | 臂 |
|---|---|---|
| `mutate-p18.mjs` | P1-8（管理后台 `state:'settled'` 恒 0） | 对照 / 写回病根 / 还原复跑 |
| `mutate-p11.mjs` | P1-1（番茄钟 `pause()` 不停表） | 对照 / 摘掉停表 / **"只在 resume 里补停表"这种假修** / 还原 |
| `mutate-p12-p06.mjs` | P1-2 + P0-6（月历与成长视图的记忆化） | 每臂**先重打包 `@heyta/ui`**（`apps/web` 读 dist，不重打包跑的是旧产物） |
| `mutate-p011.mjs` | P0-11（上传把 per-op `encrypt()` 放进 `Promise.all`） | 并行 ⇒ 派生数红 / 复用同一密文 ⇒ 密文互不相同红 / 对照 |
| `mutate-p110.mjs` | P1-10（计数取代全表物化） | 删桥转发 / `countAllOps` 丢归档 / 引擎闸门退回物化 / 对照 |
| `mutate-p07b.mjs` | P0-7（提醒读侧一次遍历归组） | 退回 O(任务×提醒) / 不滤墓碑 / 丢 id 序 / 对照 |
| `mutate-p118.mjs` | P1-18（记忆层关着也付） | ⚠️ 它原地改 `apps/web/src/App.tsx`，**只能在那个文件干净时跑** |
| `verify-gate-wiring-candidate.mjs` | §8 第 17 步那道新门禁的**接线补丁** | C0 现状 / C1 进链 / C2 只加定义 / C3 插出 `&&&` —— 🔴 **它不改工作树**：改的是 `/tmp` 下的候选副本（见下面第 4 条） |
| `mutate-shell-surfaces-anchor.mjs` | `check:shell-surfaces` 断言 A 的**锚点分类**（2026-10-05 把"未跟踪的取证产物"从源码锚点里摘出来那次修法） | A0 原样副本绿 / A1 ps1 改取证文件名红 / A2 sh 的 scp 行改名红 / A3 删一枚**真**源码锚点仍红 / **A4 两半**：产物缺席不再红 + `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 照样红。🔴 每台里最值钱的是 A4 那两半——少了 a 就是没修，少了 b 就是借修名的放宽。它同样**只改副本**（`rsync --link-dest` 硬链接 + 先 `rm` 再写，绝不就地 truncate） |

⚠️ 下面这几台**不属于本表那条线**（它们钉的是回收站/批次 E 的工单，见 `docs/plans/trash-and-archive.md`，
或协作/共享清单线的工单，见 `docs/plans/collaboration-shared-lists.md` §9.3 M7；
这一族有几台不写死在这里 —— 数一下就行：`ls research/tools/mutation-rigs/*.sh research/tools/mutation-rigs/*.mjs | wc -l`），
放在这里只是因为它们是同一族形状：**不改工作树、只回答"这条判据能不能失败"**。

| 装置 | 钉的工单 | 臂 |
|---|---|---|
| `e2-destroy-reopen-probe.mjs` | #87（`destroy()` 之后一次普通读把空壳建回来，§10.147） | 默认臂 ⇒ `PROBE=REOPENED` rc=**1**（当前 HEAD 就是这个形状）/ `PROBE_SKIP_READ=1` ⇒ `PROBE=clean` rc=**0**，**只用来证明这台装置能报绿**，跳过那一发读等于没问那个问题 |
| `android-passive-branch-selftest.sh` | #77（`ERASURE_TRIGGER=external` 那档，§10.146） | 五条腿：默认档不发 `DELETE` / external 三前提全成立 / 探针不通即中止 / 回 401 不去驱动设备 / 界面没那句 ⇒ C 判红。`PASSIVE=pass` 才是绿 |
| `ios-erase-arm-b76.sh` | #76 的**臂本体**（iOS 判据 B「一次 401 不许清库」自己能不能红，§10.155） | 🔴 **它不属于上面那句"不改工作树"**：这枚会落变异（`packages/sync-client/src/client.ts`）→ 重打 → **重装进它自己的模拟器**，`trap restore EXIT` 复原两侧，源与产物两侧都打 md5。要占设备窗口，跑前先 `PREFLIGHT=1`。13:0x 从 gitignored 的 `tmp/` 转正进来；它调用的判据驱动 `tmp/e2-ios-erasure.sh` **没有**转正 ⇒ 干净检出上它 `ARM=ENV rig-driver-missing` 以 **3** 退出（响亮，不是假绿） |
| `ios-erase-verdict-arms.sh` | #76（上面那枚臂的**结论分岔**，§10.155 / traps #288 · #291） | 七条腿全用环境变量注入**六条计数**（不注入 `LEG_TOTAL` —— 求和也在它眼下跑），一台设备都不碰：L1/L2 `rc=3`/`rc=0` 而腿全 0 ⇒ `NO-RUN`｜L3 跑过而 B 全绿 + 完整臂趟 ⇒ `DEAD` 且允许说"关于产品的结论"｜L4 同形状但 `RECOUNT` ⇒ 同一句 `DEAD` **不许**主张装载过｜L5 12:51 现场（B 计数全 0 而 `PREM`/`C` 有读数、summary 报失败）⇒ `NEEDLE-MISMATCH`/3｜L6 只数据腿红 ⇒ `OK` 并写明"文件腿这一枚问不到"｜L7 只文件腿红 ⇒ 也 `OK`（`OK` 不绑死在某一条腿上）。绿读数 `ARMS=pass (7/7)`；**两条变异读数**（都在 13:0x 现量）：① 摘 `NO-RUN` 那一档（6 行）⇒ 只红 L1/L2；② 摘 `NEEDLE-MISMATCH` 那 7 行 ⇒ **只红 L5**，且那一腿的输出逐字复现历史上那句假结论「判据 B 在 iOS 上没有牙」。抽的是臂本体的结论段 ⇒ 载具路径打进输出，两处都没有时报 `ARMS=NO-CARRIER` |
| `ios-erase-b-fileleg-probe.sh` | #90（iOS 判据 B **文件腿**到底能不能失败） | 五条腿全在临时目录里造盘上形状，**一台设备都不碰**：L1 库在⇒绿｜L2 库被 `unlink`⇒🔴红（承重腿：它区分"坏探针恒绿"与"好探针问不到"）｜L3 只剩 `-wal`/`-shm`⇒红｜L4 同目录只有 `heyta-device-prefs.sqlite`⇒红（证它认整串库名，§10.68.6 那个词干假红的反向）｜L5 有内容的库 vs 销毁后重开的空壳 **两格都绿**而 ops 差一行 ⇒ 当场打印"这一枚问不到，牙齿在数据腿"。绿读数 `FILELEG=RIGID`；**变异读数**：把谓词逐字换成"只数目录在不在"（恒真形状）⇒ `FILELEG=FAIL` rc=1，恰好 L2/L3/L4 三条被抓、L1/L5 不受影响。判据块与谓词都从真身 `scripts/verify-mobile-ios-account-erasure.sh` awk 抽，抽到 >12 行或缺绿/红 needles 即 `EXTRACT=*` 退 1（上一版锚点写成 `(else)?` ⇒ 抽出 188 行 ⇒ 载具里混进 `$UDID`，`set -u` 让**每条腿的 rc 都变成崩溃码 1**，本该绿的 L1 也红） |
| `rig-step-verbatim-recheck.sh` | #77 的那句断言「HEAD 的 step 5 本体逐字存活」（§10.146，10-05 12:3x 复量） | 按 `step "5`→`step "6` 取块、逐行去缩进成集合，报 `MISSING`（HEAD 有而工作树没有＝被改写的原句）。三档结论：`survives` / `title-only`（只有标题那行改了）/ `rewritten`。自带阳性对照：从工作树块删 1 行公共行 ⇒ `MISSING` 必须恰好 +1，否则整条判 `UNFAIABLE` 不作数。⚠️ **这台自己的第一版是恒真的**（收了输出路径参数却没用，比的是两个不存在的文件）⇒ 修法与教训在 traps **#289** |
| `mutate-collab-pull-cursor.mjs` | 协作线（ADR-0062）**M1 下行那四条游标判据能不能红** | 三臂各注一枚真实会犯的病灶：A 游标不落盘（每次都从 0 全量重拉，界面上永远"看起来是绿的"，代价是每进一次评论区重下一遍日志）B 把服务端报的头当已消费位置（🔴 这是第一版真存在的 bug：页里给 1、2 而头在 3 ⇒ 游标推到 3 ⇒ 第 3 条**永远不再被拉**，静默丢 op）C 游标在解密/落日志之前推上去（中途抛 ⇒ 日志没落、游标已过 ⇒ 那批永久取不回）。判据是**红集精确匹配**：条数等于预期、预期的每条都红、且不许多红一条（多红 = 病灶比预想的宽，这一臂就不再是"这一处写错"的证据）。⚠️ 第一趟跑出来 A/B 各"多红"一条 `分页收敛`，逐条读后确认它断言的就是 `pullShareOps` **返回的** `cursor`，属真依赖 ⇒ 并进预期集并把条数钉成 4/2/1（不是放宽，是收紧：合并后仍允许多零红）。载具是 vitest 单文件，不碰服务端也不开浏览器 |
| `mutate-collab-rekey.mjs` | 协作线（ADR-0062）**M3 换钥那四条编排纪律能不能红**（计划 §9.9） | 四臂各注一枚这一趟真犯过或差点犯的病灶：`same-key-resealed` 本地存旧钥而信封发新钥（世代号换了、屋里没换 = §9.1 那句坏法的反面）/ `skip-self-envelope` 收件人漏掉 owner 自己（他那把钥只存在于别人的信封里）/ `adopt-ignores-epoch` 收钥不验那一行的世代（把上一代信封当新钥存 ⇒ 全员锁在门外）/ `key-not-stored` 新钥只发不落环。判据同样是**红集精确匹配**（条数 + 缺席 + 多红三条都过）。⚠️ 第一趟两臂"多红"各一条，逐条读**源码**后才并集：A 多红的那条断言的就是"发出去的 = 自己盘上那把"同一个不变量；B 多红那条是真密码学 —— 名册只剩 owner 一人时漏掉自己 ⇒ 收件人为空 ⇒ `planShareRekey` 抛「requires at least one remaining member」（这一支在 `packages/sync-core/dist` 现量试过）⇒ 那一轮换钥根本没做成，旧钥仍解得开。载具是 vitest 单文件，不碰服务端也不开浏览器；目标文件归本线，脏就 `ARMS=ENV dirty-worktree` 退 **3** |
| `mutate-collab-journey-autoseal.mjs` | 协作线（ADR-0062）`verify:collab-journey` 的 **bob 入群那一腿能不能红**（计划 §9.3 M7-d） | ① 原样对照必须先绿（不绿就 `ARMS=ABORT reason=baseline-not-green` 响亮退出，不静默记成"问不到"）② 摘掉 owner 面板里 `autoSeal` 那一发调用 ⇒ 要求输出里**同时**出现 `RESULT=FAIL` 与 `share-join-done`（只"红了"不算 —— 编译错也会红）③ 还原 + md5 逐字节比对。🔴 它**原地改工作树**（目标文件归本线），所以动手前先验该文件相对 HEAD 干净，脏就 `ARMS=ENV dirty-worktree` 退 **3**：本仓多会话共用一个检出，不能拿别人未提交的改动当实验台。`--rerun-green` 才跑第三趟复绿（默认不跑：① 已证"这份内容会绿"，③ 已证"文件就是这份内容"） |
| `mutate-collab-transfer-gate.mjs` | 协作线（ADR-0062）**§6 B-10 转让接收方资格门那四条验收臂能不能红**（计划 §6 B-10） | 这道门是**两半**拼的（信封非空 + 世代对齐），所以四臂里最值钱的是一对**互不覆盖**的：`unsealed-ignored` 服务端只比世代 ⇒ 只红「世代对齐但手里没有信封」（新成员默认态那一格）；`epoch-ignored` 服务端只看看没信封 ⇒ 只红「有信封但世代落后」。A 挡不住 B、B 挡不住 A ⇒ 少任何一臂都不知道另一半有没有牙。另两臂管界面那层：`predicate-drops-envelope` 把 `memberCanHoldOwnership` 塌成只比世代（判据与服务端不同形 ⇒ 给按钮但服务端 409）/ `panel-always-eligible` 面板整个不看资格（回到修复前）。载具跨三枚包：`cd server`、`cd packages/ui`、`cd apps/web` 各跑一份 spec，🔴 改 `packages/ui` 源码那两臂**每臂变异后与还原后各重打一次 `pnpm --filter @heyta/ui build`**（`apps/web` 读 dist，不重打跑的是旧产物 —— 同 `mutate-p12-p06.mjs`）。三枚目标文件都归本线，任一脏就 `ARMS=ENV dirty-worktree` 退 **3**；红集同样按**精确匹配**（条数 + 缺席 + 多红三条都过） |
| `mutate-collab-causal-clock.mjs` | 协作线（ADR-0067 裁决二）**M2 因果时钟那五枚判据能不能红** | 这一格的病灶在行为上是**隐形**的：`vectorClock` 写死 `{我:1}` 时同步照跑、评论照互见、e2e 照全绿（那时还没有任何一条链靠因果边定序），所以"测试通过"证明不了这条链存在，只有"摘掉它必须红"才行。五臂：`dead-value` 写回死值（M2 之前工作树里真是这一行）⇒ 红 5（①②③④＋纯构造规则那枚）/ `ignore-share-id` 基准抓死一份 ⇒ 只红②/ `local-dims-only` 远端的钟不回流 ⇒ 只红③（这一枚最阴：本地自增看着是对的）/ `cache-only` 基准读内存缓存 ⇒ 只红④（重启一次因果边整条丢，界面无痕迹）/ `clock-before-auth` 未登录闸门挪到读基准之后 ⇒ 只红⑤。两枚目标文件（`share-client.ts`、`share-comments.ts`）都归本线，任一脏就 `ARMS=ENV dirty-worktree` 退 **3**；红集按**精确匹配**（条数＋缺席＋多红三条都过）。2026-10-23 首跑 `ARMS=pass (5/5)`、`RIG_RC=0`、还原后 `git status --porcelain -- packages/app-host/src` 空读数 |
| `mutate-collab-share-routing.mjs` | 协作线（ADR-0067 裁决一 + 补一/补二/补三）**M2 写路径路由那 34 枚判据能不能红** | 六臂各注一枚真实会犯的病灶：`no-declared-fallback` 新建那一形不回退问载荷（= 补三落地**之前**工作树里真是那几行）⇒ 红 4 / `fallback-for-all` 什么阻塞都回退问载荷 ⇒ 载荷塞一个共享 `projectId` 就能绕过裁决一，只红那一枚新判据 / `no-live-source` 把「状态里没有」当成「从没有 shareId 的地方搬过来」⇒ 新建被读成跨边界移动并拒绝，红 3 / `silent-personal` 通道没装上时悄悄退回个人 log（M2 之前那一格的形状）⇒ 红 3 / `silent-personal-cas` 同一枚病灶只漏在 CAS 派发器上（估时/追加清单那两枚动作走这一条路）⇒ 只红 1（**这一臂存在的理由**：两条派发器各有自己的 `channel === undefined`，只钉一条就是留一条静默死路）/ `move-never-rejected` 跨边界不拒绝 ⇒ 红 5。⚠️ 第一趟 `no-live-source` 预测 4 红、实测 3 红：多算的那条（在**个人**清单里新建）逐条读后确认**不该红**（源与目的地两边都解析不出 shareId ⇒ 不构成移动），已把预期改成现量并把理由写进臂注释，而不是放宽判据。载具是 vitest 单文件，不碰服务端也不开浏览器；目标文件归本线，脏就 `ARMS=ENV dirty-worktree` 退 **3**。2026-10-23 首跑 `ARMS=pass (6/6)`、`RECHECK RC=0 Tests=34 passed`、还原后 `git status --porcelain -- packages/app-host/src` 空读数 |
| `mutate-collab-signal-known-share.mjs` | 协作线（ADR-0062 决策 7 / M5 信号闸门）**「这台设备认不认得这份 share」那两条判据能不能红** | 闸门是**一个布尔的两半**，两半各挡一种坏法而界面症状一模一样（「对面写了东西，我这台不动」），所以两臂互不覆盖：`index-only` 只认「这份日志在本机落过盘」⇒ 只红「刚入群那台设备一次都没拉过 ⇒ 照样拉」那一枚（🔴 这一枚病灶不是设想，是 M2-d 界面腿**实测抓到**的真 bug：判据自锁 —— 不拉就不进索引，进了索引才允许拉，症状是新成员永远看不见任何改动）/ `always-pull` 闸门整条拿掉 ⇒ 只红「本机既不认得也没落盘 ⇒ 零请求」。红集按**精确匹配**（条数 + 缺席 + 多红三条都过）。载具是 vitest 单文件；目标文件归本线，脏就退 **3**。2026-10-23 首跑 `ARMS=pass (2/2)`、`BASELINE/RECHECK RC=0 Tests=10 passed` |
| `mutate-collab-journey-visible.mjs` | 协作线（ADR-0067 裁决一 + 界面腿）**`verify:collab-journey` 的「两台真浏览器互见」那一格能不能红** | 与 `mutate-collab-journey-autoseal.mjs` 同一副形状，但两点不同：① 它改的是 `packages/app-host/src/share-signals.ts`，而浏览器吃的是 **dist** ⇒ 🔴 **变异后与还原后各重打一次 `pnpm --filter @heyta/app-host build`**（不重打跑的是旧产物，同 `mutate-collab-transfer-gate.mjs` 改 `packages/ui` 那两臂的口径）② 判据要求输出里**同时**出现 `RESULT=FAIL` 与 `B 那台看不见 A 写的`（只「红了」不算 —— 编译错也会红）。病灶就是上面那一枚 `index-only`：这一副臂钉的是**用户可见**那一层，`mutate-collab-signal-known-share.mjs` 钉的是判据本体，两枚不互相替代。2026-10-23 首跑 `ARMS=pass (2/2)`（对照 `RESULT=OK` → 变异臂红且点名互见那一格 → 还原 md5 逐字节一致）|
| `mutate-collab-move-affordance.mjs` | 协作线（ADR-0067 补二）**界面那一半的三枚判据能不能红** | 两臂**对着拉**，因为这一格的两种坏法方向相反：`guard-always-open` 装配那一行退成"什么都不挡"（= 补二界面那半句**没做**时的原样，动作摆出来、点了撞墙，而报错文案还是那句假的"可以重试"）⇒ 红 3 / `guard-always-blocked` 反过来什么都挡 ⇒ 红 2（🔴 这一臂的存在理由：只钉"共享的那条灰掉"的话，"整枚下拉永远灰掉"这种一眼看上去能过的实现照样绿）。载具 `cd apps/web && npx vitest run tests/share-move-affordance.spec.tsx`；目标文件归本线，脏就退 **3**。2026-10-23 首跑 `ARMS=pass (2/2)`、`BASELINE/RECHECK RC=0 Tests=3 passed` |
| `mutate-collab-read-verify.mjs` | 协作线（ADR-0069 裁决四/五）**M4 读侧那七格判据能不能红**（计划 §9.3 M4） | 七臂分三层：`cursor-over-forgery` 游标推过被拒那条 ⇒ 红 2（那一条永不再被拉到、报警第二轮就消失）/ `always-accept` 验不过照样物化 ⇒ 红 5（服务端塞的伪造件被画成"同事写的"）/ `legacy-as-forgery` 存量行当伪造 ⇒ 红 2（老清单全量报成事故）/ `roster-silent` 拿不到名单就当验过 ⇒ 红 2（"没验证"与"验证通过"在界面上同一个样子）/ `emit-removed` 与 `emit-on-added` 把壳里那行通知摘掉、或挂回 `added > 0` ⇒ 红 1 与红 2（🔴 被拒那条**本来就没落盘**，`added` 恰好是 0 —— 旧条件正好漏掉这一族）/ `notice-always-renders` 没拒也渲染 ⇒ 红 2（报警立刻失去意义）。⚠️ 预测红集 vs 实测红集有两处对账，两处都改的是**预测**、没放宽判据：`always-accept` 预测 4、实测 **5**，多出来那枚「换一份 share 去验同一条」走的正是同一个"拒"分支；`emit-removed` 预测 2、实测 **1**，少的那枚是界面用例自己直接敲信号、它验的是**订阅**而不是**接线**（两件事各有归属是刻意的，反向证据就是 `emit-on-added` 红 2）。载具跨两枚包（`cd packages/app-host`、`cd apps/web` 各跑一份 spec），四枚目标文件都归本线，任一脏就 `ARMS=ENV dirty-worktree` 退 **3**。2026-10-23 首跑 `ARMS=pass (7/7)`、基线 11 passed / 9 passed、复跑 RC=0、还原后那四枚文件相对 HEAD 空读数 |
| `mutate-collab-upload-gate.mjs` | 协作线（ADR-0069 裁决四/五/六）**M4 上传边界那四格判定各自有没有牙**（计划 §9.3 M4） | 四臂各钉一格且互不覆盖：`accept-unsigned` 闸门放开"没签的那一条" ⇒ 必须红在 `13.2`（无签通道重开＝裁决六作废）/ `accept-tampered` 放开"验不过的那一条" ⇒ 红在 `13.3`（改了字节还落库＝完整性是假的）/ `author-column-dropped` 落库不记作者 ⇒ 红在 `13.1`（读侧把署名行当存量放过，"谁写的"从协议上消失而界面一句不说）/ `roster-active-only` 名册只回现役成员 ⇒ 红在 `13.5`（把人移出去那一刻起，他写过的连同其后所有人的改动一起读不出来——🔴 这一形不是设想，是 M4-5 建第 13 步时**实测撞到**的真缺陷，修法见 `GET /shares/:id/signing-keys`）。载具是**真服务端 + 十三步**（`node scripts/verify-collab-sync.mjs`，一臂一趟 ~35s），所以病灶打在 `server/dist/src/shares/share.routes.js`（跑起来的那一份）而不是源码 ⇒ 🔴 动手前先比 mtime，产物落后于源码就退 **3** 并要操作者先 `cd server && pnpm build`（本仓"测试全绿 ≠ 这是当前产物"那一族的正面执行）。⚠️ 预测红集 vs 实测红集两处对账，两处都改的是**预测**、没放宽判据：① `author-*` 第一版病灶取的是最直觉那一形"作者从载荷自称取"（`raw.signerMemberId`），实测**不是一臂是一枚崩溃**——落库那步在 `accepted.map(...)` 里、`raw` 不在作用域 ⇒ 服务端 500、第 5 步就红，红的是"脚本写坏了"而不是"这一格没牙"，遂换成本臂那一形；② `roster-active-only` 预测红在 `13.5`，实测红在**第 10 步**（同一格、更早的那一腿：owner 第二台设备第一次拉取就撞上），判据因此钉成**闭合两形**（`step=10 + 那句读数` 或 `step=13 + 13.5`），不是放宽成"任意红"。2026-10-23 首跑 `ARMS=pass (4/4)`、`BASELINE RC=0 RESULT=OK steps=13`、`RECHECK` 照绿、还原后产物 md5 逐字节相同、无 `.mut-bak` 残留 |

跑法（本机有测试内存闸门，别的套件在跑时会拒绝启动）：

```bash
sh research/tools/mutation-rigs/wait-and-run.sh /tmp/mut.log 1200 \
  node research/tools/mutation-rigs/mutate-p11.mjs
```

## 四条从这些装置里长出来的判据纪律

1. **`ran` 必须落在读数里。** P0-7 的 B 臂第一趟报"判据存活"，实际是装置把
   `aliveReminders(` 剥掉后留下多余右括号 ⇒ 变异体语法错 ⇒ vitest 走集合期失败 ⇒
   `Tests` 行里没有 `N failed` ⇒ 装置读到 `failed=0`。**一条没跑起来的臂，
   长得和一条没牙的判据一模一样。** 防护有两种形态，两种都算数：
   `ran <= 0` 直接抛（现量：`grep -l 'ran <= 0' research/tools/mutation-rigs/*.mjs`），
   以及**期望 `ran`/`passed` 从对照推导**（后者天然不可能在 `ran=-1` 时判绿 ——
   `mutate-p011` 的 `C 跑到 3 条`、`mutate-p12-p06` 的 `ran === expectRan`、`mutate-p18` 的
   `passed === TOTAL` 都是这一型）。**判据是"这一臂能不能在没跑起来时被判绿"，不是"有没有那行 `if`"。**
2. **期望值要从对照推导，不能写死。** `mutate-p18.mjs` 曾经断言"恢复后 `passed === 15`"，
   而那份 spec 已长到 18 条 —— 于是**判据明明有牙，装置整体报红**。
3. **归组类改动要"多面一起断"。** 只断"读了几遍表"没有区分力（改成什么都不返回，读数也是 1）；
   必须同时钉活体对照、逐条等价、墓碑过滤、空桶边界。
4. **"要改别人手里的文件"不等于"这条验证做不了"——先找被验对象有没有候选输入旋钮。**
   前七台都是原地改源码再还原，那只适用于**文件归本批**的情况。`package.json` 正被并行会话
   改着，而 `scripts/check-gate-wiring.mjs` 本来就为了注入验证带了 `--pkg <候选>`：
   把候选写到 `/tmp` 指给它，四臂（现状 / 进链 / 只加定义 / 插出 `&&&`）当场就有读数，
   工作树零改动。**同一个道理适用于任何有 `--root` / `--dist` / fixture 旋钮的门禁 ——
   先读它自己的 `--help` 和文件头，再决定"这条得等别人"。**
   📌 那一臂 C3 是我第一次拼候选时的手误（`&&&` 把下一段顶出了链），而门禁点名的是
   **被顶掉的 `check:md-tables`**、不是新加那道 ⇒ 顺手证了两件事：检测面覆盖任意一道，
   以及"定义还在、链里没有"这个形状确实抓得住（这正是这道门禁存在的理由）。

`gate-run.sh` 是被 `wait-and-run.sh` 取代的早期版本（它只认日志里的拒绝字样，
而装置会吞掉内层输出 ⇒ "没跑到用例"在它眼里长得像"跑完了"）。留着是为了让人认得出这个形状。
