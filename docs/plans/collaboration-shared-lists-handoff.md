# 协作共享线 · 会话交接书（2026-10-24，M6 移动端接入 源码级完成后）

**状态**：🔄 **M6 源码级已入库；设备腿一次没跑 ⇒ 本批不构成交付凭据**。下一步顺序在 §2，正在生效的外部风险在 §4。
复量：`git log --oneline -1 -- docs/adr/0071-share-notification-content-boundary.md` 与 §1.3 那行 mobile 单测命令。

> 体裁：**交接书**。状态只在本文，`docs/plans/README.md` 那一行只给指针（那条纪律的出处见该文件 §一 的注）。
> 读法：§1 是"做到哪了"，§2 是"下一位按顺序做什么"，§3 是"别再踩的坑"。
> 🔴 本文里每一枚读数都是 2026-10-24 这一趟**亲自串行跑出来**的，逐条附复现命令；标了「代理读数」的我没复跑。

---

## 1. 现在到底做到哪了

**产品定义**（负责人 2026-10-23 原话）：共享清单在手机上和 web 一样真的能用——能建清单、能收邀请并加入、
任务/便签/评论三族与另一台设备双向同步、写出的 op 带成员签名、收得到实时信号并按本机偏好打扰用户。

**一句话现状**：`docs/plans/collaboration-shared-lists.md` §9.4 那六段缺段**已全部接上，但只到源码级**——
移动端的共享屏**一次都没在设备或模拟器上画出来过**。所以这一批**不构成** M6 交付凭据，缺的就是 §9.3 那行
M6 的判据本身（真跑 + 真看截图）。

### 1.1 已入库

| 笔 | 内容 |
|---|---|
| `f2bdfa111` | M5 收尾：成员面信号 `share_roster_changed`（[ADR-0070](../adr/0070-share-roster-changed-signal-replaces-polling.md)），撤掉面板与入群对话框两枚 3s 轮询 |
| `7ee207dda` | M6 移动端接入（源码级）+ M5-2 通知内容口径（[ADR-0071](../adr/0071-share-notification-content-boundary.md)） |

取现量：`git log --oneline -2 -- docs/adr/0070-share-roster-changed-signal-replaces-polling.md docs/adr/0071-share-notification-content-boundary.md`

### 1.2 `7ee207dda` 里有什么（按 §9.4 那六段逐格对）

1. **入口与路由** → `apps/mobile/src/nav/feature-entries.ts` 的 `MOBILE_SHARE_ENTRIES`（并入 `MOBILE_PROFILE_ENTRIES`，
   穷尽 switch 在 `apps/mobile/src/screens/ProfileScreen.tsx` 的 `featureScreen()`：加一项不接屏，编译期站不住）。
   ⚠️ `share` **不在** `@heyta/domain` 的 `FEATURE_MODULE_KEYS` 词表里，所以它是另立的一张表，不是第四枚功能域。
2. **`setProjectShareId` 调用点** → `apps/mobile/src/share/project-share.ts` 的 `bindProjectShare()`（全壳唯一入口，判据本体在 `packages/app-host/src/project-actions.ts`）。
3. **share 密钥落盘** → 判定本体搬进新文件 `packages/app-host/src/share-key-store.ts`（异步 `ShareKeyStoragePort{get,set,remove}` + 纯 JS base64 + `collectPriorKeys` 三条纪律）；
   `apps/web/src/features/share/share-key-store.ts` 退化成薄适配器（**对外 12 个名字/签名/返回形状零变化**，消费者未改），
   盘上 JSON 形状逐字节兼容（老 web 设备升级不丢钥，这条有用例钉）；移动端落原生安全存储 `apps/mobile/src/lib/share-key-store.ts`。
4. **vault → `SyncPayloadCipher`** → `apps/mobile/src/share/share-session.ts`（单例四枚 + depKey 判等 + 先摘后建），凭据取 `readSyncConfig()`、`clientId` 取 `AppHost.clientId`、载荷密钥取 `host.getVaultSession() → session.getPayloadCipher()`。
5. **传输与凭据** → `apps/mobile/src/share/comment-actions.ts`（`createMobileShareComments`，与 web 同参数形状）+ `share-ports.ts`（把密钥端口 / share 日志 / `consentFetch` 三件收成一处注入）。
   本地落盘（日志 / 同意态 / 通知偏好）在 `apps/mobile/src/lib/share-local-store.ts`，盘上键名与 web 逐字同名。
6. **`ShareFeature` 那层的 web-only 假设重写** → `apps/mobile/src/screens/ShareSpaceScreen.tsx` + `JoinShareScreen.tsx`，
   复用 `packages/ui/src/sync/` 那四枚 RN 组件（`SharePanel` / `CommentThread` / `ShareConsentModal` / `NotificationPrefsPanel`），**没有重画第二份**；
   零定时器轮询；信号面在 `apps/mobile/src/share/share-signals.ts`，实时入口在 `apps/mobile/src/sync/realtime.ts`（接 `onNewShareOps` / `onShareRosterChanged`）。

### 1.3 读数（2026-10-24 13:4x，一次一条，串行）

| 尺 | 读数 | 复现 |
|---|---|---|
| app-host build | rc=0 | `pnpm --filter @heyta/app-host build` |
| ui build | rc=0 | `pnpm --filter @heyta/ui build` |
| **mobile typecheck** | **rc=2，9 条错，本线文件 0 条** | `pnpm --filter @heyta/mobile typecheck`；9 条全在 `src/lib/reminder-delivery-display.ts`(2) 与 `src/screens/ReminderDeliverySection.tsx`(7)——**别线的未跟踪文件，其依赖在别线的 stash 里**（§4） |
| app-host 单测 | 38 passed（`share-key-store` 20 / `share-signals` 10 / `share-roster-signals` 8） | `cd packages/app-host && npx vitest run tests/share-key-store.spec.ts tests/share-signals.spec.ts tests/share-roster-signals.spec.ts` |
| ui 单测 | 19 passed（`notification-content-boundary` 8 / `share-consent-model` 6 / `notification-prefs-gate` 5） | `cd packages/ui && npx vitest run tests/notification-content-boundary.spec.ts tests/share-consent-model.spec.ts tests/notification-prefs-gate.spec.ts` |
| web 单测 | 47 passed（`share-key-store` 15 / `share-activity-notify` 10 / `share-roster-signal` 9 / `share-notification-content` 7 / `share-activity-signal` 6） | `cd apps/web && npx vitest run tests/share-key-store.spec.ts tests/share-activity-notify.spec.ts tests/share-roster-signal.spec.tsx tests/share-notification-content.spec.tsx tests/share-activity-signal.spec.tsx` |
| **mobile 单测** | **77 passed / 8 个文件全绿**（`share-session` 13、`share-ui-assembly` 13、`share-routing` 12、`feature-entries` 10、`share-signals` 9、`share-key-store` 9、`share-realtime-wiring` 6、`share-routing-assembly` 5） | `cd apps/mobile && npx vitest run tests/share-session.spec.ts tests/share-ui-assembly.spec.ts tests/share-routing.spec.ts tests/feature-entries.spec.ts tests/share-signals.spec.ts tests/share-key-store.spec.ts tests/share-realtime-wiring.spec.ts tests/share-routing-assembly.spec.ts` |
| 变异装置（M5-2 那批） | `ARMS=pass (4/4)` —— **代理读数，我没复跑**（跑装置会临时改文件，别会话正在提交时不能跑） | `node research/tools/mutation-rigs/mutate-collab-notif-content.mjs` |
| 四把尺全量（`-r typecheck` / `-r test` / `-r build` / `check` / `verify:collab-suite`） | **本批没跑** | 见 §2 第 2 条 |

⚠️ 这句**会漂，别照它施工**：`pnpm --filter @heyta/mobile typecheck` 曾在 2026-10-25 读到 rc=2（两枚别线未跟踪件），
2026-10-26 现量已经是 rc=0。它当时刻意登记，是因为**本线的判据要能独立判定** —— 读到非 0 先分清是谁的件，
别把别线的红算进本线，也别顺手改别人的目录（§4）。

---

## 2. 下一步按顺序做什么

1. ✅ **M6-4 设备腿：iOS 那一侧已经全绿过两趟**（2026-10-25 第 31 跑 L1–L6；2026-10-26 第 35 跑把**所有者那一侧**也接上 —— L7 手机自己建清单 → 设为共享 → 签发邀请 → 服务端认 `role=owner` → 撤销，`50 通过 / 0 失败`。逐格读数与逐张看过的截图指针在 §9.14 那两张表）。
   ✅ **同日第九批补上产品定义里最后那半句**（「按本机偏好打扰用户」的消费面）：通知中心第三档「共享动态」+「我的」入口徽标相加 + 设备腿 **L8 两半相反**（默认全关 ⇒ 那一档是空的；翻开『新增内容』⇒ 那句带本机清单名的话），第 38 跑 `55 通过 / 0 失败`，读数与变异臂在 **§9.15**。同日第 39 跑再补上 **L9**（便签那一族的**下行**：owner 写进那份共享清单的便签出现在手机便签板上、全程没点同步）⇒ `56 通过 / 0 失败`，**三族的下行在设备上就此都有读数**（上行仍只有评论那一族，见下面 ④⑤ 两格）。
   **下一位要做的不是"再跑一次看它绿不绿"**，而是 §9.14 末那张表里还开着的三格：
   ① 第 28 跑那一发崩溃（未判定，要的是**可重复复现**，第 29/30/31/32/33/35 六趟没复现不等于修好）；
   ② ~~看图抓到的两枚新候选~~ **本批已各自回源码定性并修完**（一枚两壳真实产品缺陷：`packages/ui/src/sync/CommentThread.tsx` 的报错时机，6 枚判据 + 变异臂恰好红 2；一枚装置自造：`collab-owner-step.mjs` 把 owner 的作者字段兜成 memberId，已加常驻形状尺。教训在 #577/#579）；
   ③ Android 的界面腿（**载体不存在**，两半的现量命令与归属都在那张表里）。
   ④ 便签的**上行**那一格（手机把一条便签归进那份共享清单）：**界面上到不了**，不是没测 ——
   `setNoteProject` 在两壳零调用点（现量 `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'` ⇒ 只剩接口声明与实现两处；⚠️ 别扫整个 `apps`，那里会命中 `apps/web/dist` 的打包产物、读出来不是零），缺的是入口本身，
   归**要新界面**那一档（入口放便签板还是放共享空间屏）⇒ 产品负责人拍，别当判据缺口去补断言。
   ⑤ 任务的**上行**那一格（手机把一条任务写进那份共享清单）：**同样界面上到不了，而且这一格不是共享特有的** ——
   手机端建任务只有两处调用点、两处都不交 `projectId`（分母现量 `git grep -n "actions.create(" -- apps/mobile/src`），
   共享那块添加面板没有"选清单"的控件（现量 `grep -n projectId packages/ui/src/capture/CaptureComposer.tsx` ⇒ 无输出），
   手机上能改的归属只有象限 ⇒ 新任务一律落收集箱。动作层是通的（`create(title,{projectId})` + M6-2 的写侧分流），
   缺的只是那一枚控件。**这条直接压在产品定义那句"三族双向"上**：今天手机上三族里只有评论真双向 ⇒ 归产品负责人拍。
   🔴 还有一条给下一位的**装置纪律**（#579）：这个载体以后每次打 `env_bail`（退 3）之前，先问那句前提
   是不是产品定义里"用户能做 X"的某一格本身 —— 是就得补成判据，不是才允许退 3。
   载体早就在册 —— `scripts/verify-mobile-collab-ios.sh`
   （根 `package.json` 的 `verify:mobile-collab:ios`）、`scripts/lib/mobile-e2e.sh`、`scripts/tools/ios-ax-shim.py`、
   `scripts/tools/ios-collab-anchor.py`、判定 `scripts/tools/png-stats.mjs`（非空白 + 主蓝≥20 + 内容占比≥0.05），
   旅程也已登记进 `scripts/check-journey-coverage.mjs` 的 `journeySpecs`（那把尺两样都查，缺一样直接红）。
   **现量只看两处**：`pnpm verify:mobile-collab:ios` 的退出码（`0` 全绿 / `1` 产品判据红 / `3` 环境前提不成立，不判产品）
   与计划 §9.14 / §9.15 那两张跑次归因表。AGENTS §6.2 那三条硬性规定照旧：必须真跑、必须**肉眼看图**、不许抢前台。
   Android 一律 `ssh windows-pc`，**不在 Mac 起 Gradle 或模拟器**（负责人 2026-10-23 的长期令）。
   红了先分「壳的接线缺陷」与「RN 组件在移动端的键盘/滚动/暗色缺陷」——后者在本仓陷阱账里有一整族
   （`docs/agents/` 与环境陷阱的 iOS 设备腿那几条，以及 #571–#575 这一族**装置自己会造红/造绿**的）。
2. **四把尺串行现量**：`pnpm -r typecheck` → `pnpm -r test` → `pnpm -r build` → `pnpm verify:collab-suite`（含 `verify:collab-journey`）→ `pnpm check`。
   已知非本线的存量：链上两枚别线存量红、`check:docs` 有一枚只在本机存在的 `.workbuddy/memory/MEMORY.md` 红（已登记，别去改别人的目录）。
3. **文档写回**（任务 #55）：§9.13 是上一批（源码级接线），**这一批的读数在 §9.14**（跑次归因表 + 逐格读数 + 还剩什么）；**第九批（M6-10 消费面 + 设备腿 L8）的读数在 §9.15**。
   §9.10 那三格 2026-10-25 已全部改口完毕：面板 3s 轮询那格按"已撤 + 名册信号在册"结案（保留当初"不许撤"的理由，
   那是 ADR-0070 的来由）、通知口径那格由 ADR-0071 立着、谓词那格见下条 4。
   ⚠️ 曾经挂在这里的「移动端与三枚桌面壳今天接不到这条信号」已按现量改成「读者有两枚壳，桌面那几枚仍没接」——
   **别整句删**（那会丢掉"为什么曾经这么写"），也别把它当成还没做：**桌面那三枚不在 M6 的授权范围内**。
   本批已写回的：ADR-0062 实施记录**第 5 条**（那句"决策 7 只写了信号，不足以让新成员看见存量"）、
   ADR-0069 **追记（2026-10-26）**（第 8 步那把"手机写的能不能被另一台验过"的尺第一次有真机读数）、
   `docs/agents/progress-log.md` 那条并行轨道行、`docs/research/feature-matrix.md` 的 6.1 与 6.4。
   第九批另写回四处：ADR-0062 实施记录**第 7 条**（决策 7 那句"按偏好要不要吵"此前只有生产者没有消费者，
   以及系统横幅那一档为什么仍做不到）、ADR-0071 **补记三**（正文在投递那一刻拼好 + 口径一条没动）、
   环境陷阱 **#581–#583**（装配闭包抓不到行为 / 一个数画三处只改两处 / 设备腿的 needle 从界面读回来会自证）、
   变异装置一副 `research/tools/mutation-rigs/mutate-collab-mobile-activity.mjs`（四臂，已登记进同目录 README）。
   ⚠️ ADR-0070（名册信号）本批**没动**：那三条裁决的措辞这一批没有撞上新的差，硬加一节就是造一份会漂的抄件。
   还欠的写回只剩 `docs/plans/launch-blockers.md`（要不要登、登哪几格，按 push 之后的现量判）。
4. ~~**M5-3 那两枚谓词的数据面**~~ —— 🔴 **这一格别再"接上"，它 2026-10-24 已按「撤下」结案**（计划 §9.10 那条 ✅）：
   `shouldNotifyTaskReminder` / `shouldAutoAcceptInvitation` 连同两档偏好整条删掉（`bc20e679a`），理由是**它们没有输入**，
   不是"没写完"。本批按现量重核过这两句理由还成不成立：
   `assigneeUserId` 在 `packages` 只剩实体声明与注释、在 `apps` 与 `server` **零命中**；"已知合作者名单"那一档产品面仍不存在。
   ⇒ 摆着开关而行为恒等于"不响"就是界面在谎称有能力。**钉子**：`packages/ui/tests/notification-model.spec.ts`
   断言默认偏好只有 `activities` 一个键 —— 往那个形状里加一档而不带消费者，它就该红。
   重新开工的条件与理由写在 `packages/ui/src/sync/notification-model.ts` 文件头。
   ⚠️ 交接书此前那句「`JoinShareScreen` 现在存在了，`shouldAutoAcceptInvitation` 可能第一次有了真输入」是**错的**：
   移动端邀请面存在 ≠ 有"谁算已知合作者"这份名单，前者每次都要人当场确认（入群同意闸就是它）。
5. **一格仍未判定**（§9.11 那条截图读数：owner 面板里 bob 显示「等待所有者授权」而他手里其实有钥）：断言已写在 §9.11 那格末尾，
   但轮询撤了之后那句"等 ≥ 一个轮询周期"要改成"等 roster 信号那一趟落回"。判据本身还没进旅程。
6. **push**：先 `git log --oneline -1 origin/main` 取现量再 `git push origin main`。负责人对本线有长期授权（"你来替他们 commit 并且 push"）；
   `gitee` 那一腿仍会被配额拒（在册，别当成回归，也别动历史）。
7. **不得自行把本 Goal 标 complete**：做完 1–6 带四把尺读数 + 移动端截图逐条向产品负责人汇报请示。

---

## 3. 别再踩（都是这一批实测换来的）

- 🔴 **评论区"再拉一次"永远拿到 `fetched = 0`**：下行游标是**这份 share 全局一份**，而重放结果按**实例**缓存。正确动作是订阅 `subscribeShareRepaint` 之后**从盘上重放**，不是第二次下载。
- 🔴 **闸门只认清单行绑定会自锁**：刚入群那台设备还没有绑定 ⇒ 信封下发那一条信号会丢给它的唯一收件人。判据必须是「清单行绑定 ∪ 界面登记的 target」，且入群等待态**先 `registerShareRosterTarget` 再等信封**（同一形状本线踩过三次）。
- 🔴 **`armMobileShareSession()` 不带端口 = 静默全盘失效**：共享路由退回个人 log、信号全丢，**一条判据都不红**。钉它的是 `apps/mobile/tests/share-session.spec.ts` 里「入口带真实端口」那一枚——别把它"简化"掉。
- **`cd apps/mobile && npx vitest run`（全量）在 HEAD 就 rc=1**：`RTEST-UNHANDLED-01`，Rolldown 解析不了 `react-native/index.js` 的 Flow。单文件跑；**别去改测试配置让它变绿**。
- **改了 `app-host` / `ui` / `i18n` 不 build 就 typecheck 消费者** ⇒ 陈旧 `dist` 造出莫名的 TS2724/TS2353，症状指向被测件之外。
- **移动端凭据只在内存**（E2EE 口令落盘会作废那条承诺），所以冷启动 `readSyncConfig()` 必是 `undefined`、实时通道要等填完凭据才起——**这不是缺陷**。
- **本壳没有 RN 组件测试栈**：移动端判据是两半式（值导入 + 去注释源码文本，夹具 `apps/mobile/tests/source-reading.ts`），所以**源码级绿 ≠ 界面向**；界面风险只有设备腿量得到。
- 变异装置（`research/tools/mutation-rigs/`）会临时改被测文件；**别会话在提交时不要跑**。还原只从 `.mut-bak`，并核 md5/sha256。

---

## 4. 一条正在生效的外部风险：别会话的裸 `git stash`

`stash@{0}: On main: heyta-publish-window3` 是**另一条会话**为它的发布窗口执行的 `git stash`（无 `-u`），
一次卷走 **63 枚已跟踪文件**——其中 **20 枚是本线的 M5-2 / M6 已跟踪改动**（`apps/mobile/src/{App,db/open-host,nav/feature-entries,screens/ProfileScreen,sync/realtime,ui/kit}.ts(x)`、
`apps/web/src/features/share/{ShareFeature,share-activity-notify,share-key-store,use-share-activity-signal}.ts(x)`、两枚 web spec、
`packages/{app-host,ui}/src/index.ts`、`packages/ui/src/{node,sync/notification-model}.ts`、`docs/plans/collaboration-shared-lists.md`、两枚 rig 文件）。
本线的**未跟踪新文件**（两张屏、`apps/mobile/src/share/` 全部、`packages/app-host/src/share-key-store.ts`、ADR-0071、三份新 spec）没被卷走，所以留在树里——
这就是为什么 2026-10-24 13:3x 那一刻工作树读起来像"M6 的已跟踪半边凭空消失"。

**已经做的处置**：逐枚 `git show 'stash@{0}:<路径>' > <路径>` 取回本线那 22 枚（不是 `stash pop`、没动 stash 本体），核验后提交成 `7ee207dda`（48 枚文件，`git diff --cached --name-only` 里别线关键字零命中）。

**留给下一位的两条硬约束**：
- 🔴 **不要 `git stash pop/apply/drop` 那枚 stash**——里面 45 枚是别人的在飞改动（提醒投递面、桌面三枚壳、legal、server auth）。他们要取回去应该用
  `git checkout stash@{0} -- <他们自己的路径>`；`pop` 现在必然与本批已入库的那 22 枚相撞。
- 那 45 枚**是否全是别线的**，我是按 diff 关键字判的（`reminder|notify|提醒`），**未逐枚读** ⇒ 这是假设不是事实。要谁动它谁确认。

同一条风险也记进了 `BLOCKED.md`（追加一条，编号见该文末节现量：`grep -oE "B[0-9]{3}" BLOCKED.md | sort -n | uniq | tail -1`）。

---

## 5. 下一趟会话怎么开（目标模式）

负责人要求这一条线继续用目标模式跑。把下面这段直接粘进 `/goal`（≤4000 字符）：

```
【协作共享清单 M6 收尾：设备腿 + 文档写回】

先读交接书 docs/plans/collaboration-shared-lists-handoff.md（现状、读数、下一步顺序、坑都在里面），
再读 docs/plans/collaboration-shared-lists.md §9.3/§9.4/§9.13 与 ADR-0070/0071。

产品定义：共享清单在手机上和 web 一样真的能用——这一批源码级已接通（提交 7ee207dda），
缺的是**设备腿与写回**，不是再写一遍装配。

执行序（顺序照交接书 §2）：
1. iOS 模拟器真跑 + 真看截图（AGENTS §6.2：不抢前台）；Android 一律 ssh windows-pc，不在 Mac 起 Gradle/模拟器。
   旅程登记进 scripts/check-journey-coverage.mjs 的 journeySpecs 并给根 verify:* 别名。
2. 四把尺串行现量：pnpm -r typecheck / -r test / -r build / verify:collab-suite / pnpm check。
3. 读数写回：计划新增 §9.13；§9.10 那三格与那句「移动端与三枚桌面壳接不到信号」按现量改口；
   ADR-0062/0069/0070 实施记录、docs/agents/progress-log.md、docs/research/feature-matrix.md、launch-blockers。
4. M5 最后那一格：shouldNotifyTaskReminder / shouldAutoAcceptInvitation 的数据面（先 grep 现量谁在调，
   不许造假输入点亮判据）。
5. 分线提交（显式 pathspec，工作树与别的会话共用）并 push origin。

硬边界：
- 🔴 绝不 git stash pop/apply/drop stash@{0}（那是别会话 45 枚在飞改动）；也不要动他们的文件。
- 不碰别线资产与判据口径（IMAGE_ONLY_PACKAGES 豁免表、收款线 selection 归属、packages/legal/src/documents/third-parties.ts、
  .agents/context/、别人在 BLOCKED.md 的条目）；撞车文件登记不硬改。
- 不 bump CURRENT_SCHEMA_VERSION、不改已应用迁移、不动线协议，除非先立 ADR 并请示。
- 只对自己创建的对象动手；重验证一次一条；变异装置在别会话可能提交时不跑。
- 🔴 全部做完后不得自行把本 Goal 标 complete——先带四把尺读数与移动端截图逐条向产品负责人汇报请示。
```
