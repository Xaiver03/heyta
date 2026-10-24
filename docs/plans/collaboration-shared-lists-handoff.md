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

⚠️ 一句别读错的：`pnpm --filter @heyta/mobile typecheck` 现在 rc=2 **不是本线的红**，但它也**不是能忽略的**——
本线的判据要能独立判定，所以下一位跑全量前先把那两枚别线未跟踪件的处理方式问清（§4）。

---

## 2. 下一步按顺序做什么

1. 🔴 **M6-4 设备腿（这一批唯一真正的缺口）**：与 web 同一条旅程在 iOS 模拟器上**真跑 + 真看截图**（AGENTS §6.2 那两条硬性规定：必须真跑、必须肉眼看图、不许抢前台）。
   载体：`scripts/lib/mobile-e2e.sh`（adb/uiautomator）、`scripts/tools/ios-ax-shim.py`（idb AX）、判定 `scripts/tools/png-stats.mjs`（非空白 + 主蓝≥20 + 内容占比≥0.05）。
   旅程要在 `scripts/check-journey-coverage.mjs` 的 `journeySpecs` 里登记，并给根 `package.json` 加 `verify:*` 别名（那把尺两样都查）。
   Android 一律 `ssh windows-pc`，**不在 Mac 起 Gradle 或模拟器**（负责人 2026-10-23 的长期令）。
   预期它会红：两屏从未渲染过。红了先分「壳的接线缺陷」与「RN 组件在移动端的键盘/滚动/暗色缺陷」——后者在本仓陷阱账里有一整族（`docs/agents/` 与环境陷阱的 iOS 设备腿那几条）。
2. **四把尺串行现量**：`pnpm -r typecheck` → `pnpm -r test` → `pnpm -r build` → `pnpm verify:collab-suite`（含 `verify:collab-journey`）→ `pnpm check`。
   已知非本线的存量：链上两枚别线存量红、`check:docs` 有一枚只在本机存在的 `.workbuddy/memory/MEMORY.md` 红（已登记，别去改别人的目录）。
3. **文档写回**（任务 #55）：计划新增 §9.13 放这一批的读数；§9.10 那三格改口（面板轮询已撤、通知口径已由 ADR-0071 立、剩下那格见下条 4）；
   ADR-0062 / 0069 / 0070 文末「实施记录」补口径；`docs/agents/progress-log.md`；`docs/research/feature-matrix.md`；`docs/plans/launch-blockers.md`。
   ⚠️ §9.10 倒数第二条那句「**移动端与三枚桌面壳今天接不到这条信号**」是**文档抄件错**：桌面两枚壳早就是消费者，移动端本批接上（源码级），
   真正缺的是**系统投递面**——按现量改口，别整句删（那会丢掉"为什么曾经这么写"）。
4. **M5-3 那两枚谓词的数据面**：`shouldNotifyTaskReminder` / `shouldAutoAcceptInvitation` 已从 `@heyta/ui/node` 露出（本批入库），
   现量看谁在调：`grep -rn "shouldAutoAcceptInvitation\|shouldNotifyTaskReminder" apps packages --include='*.ts' --include='*.tsx'`。
   🔴 别给它们造假输入点亮判据（那是量夹具不是量产品）——移动端 `JoinShareScreen` 现在存在了，`shouldAutoAcceptInvitation` 可能第一次有了真输入。
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
