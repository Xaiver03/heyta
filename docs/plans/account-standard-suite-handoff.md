# 交接：注册登录标准套件（换绑 / 忘记密码 / 改密 / 会话管理 / 注销对齐）

> 交接日期：**2026-10-10**（CST，约 18:4x）
> 给**全新会话**用：不从聊天记录继承任何前提。每条断言都带可复现命令或实测读数。
> 过程账（缺口清单 / 判据 / 变异臂逐支读数 / §6.1–§6.81 全部验收趟）在
> [`account-standard-suite.md`](account-standard-suite.md)，
> 本文件**只记「现在停在哪、下一步按什么顺序做」**，不重复它的内容。
> 复盘（为什么当时那样判断）在 [`account-standard-suite-reflection.md`](account-standard-suite-reflection.md)。
> 裁决依据：[ADR-0063](../adr/0063-email-rebinding-and-per-session-revocation.md)（换绑邮箱 + 逐会话撤销）
> ＋ [ADR-0039](../adr/0039-email-first-auth-and-desktop-reverse-authorization.md)（邮箱优先鉴权 + 桌面反向授权）。

---

## 0. 一句话现状

**代码与判据侧已闭合；iOS 设备腿的两堵墙在 19:1x 都由 owner 自己收掉了，全链构建第一次跑绿，那一腿正在跑。**
负责人已把这一腿留成 goal 的收口条件（原话：「先不合上，等设备腿」）⇒ **goal 不许自行 complete，必须先请示**。

> ### 🔴 19:1x 闭合读数（这一段**取代**下面"两堵墙"那张表，也取代 §4.1 / §4.2 的红）
>
> | 格 | 现在 | 现量 |
> |---|---|---|
> | i18n 四行重复键（我登的 **B141**，原取 B138 后与别线撞号让号） | ✅ 已入库 | 那两个语言文件上复核枚举 ⇒ **重复=0** |
> | `waiting-entitlement` 的内联重抄（**B137**） | ✅ **零处剩下** | `apps/node-host/src/host.ts:275` = `Promise<InboundAutomationCycleResult>`（`:56` 已 import）；`inbound-runtime.ts:15/:184` 同；`InboundAutomationSettings.tsx:13/:37/:72` 用 `Partial<Record<InboundAutomationCycleState \| 'failed', …>>` ⇒ 四态都有位置 |
> | 全链构建 | ✅ **绿** | 载体（tip `1a30d3bc` ＋ 32 枚脏路径）`pnpm -r build` ⇒ `BUILD_RC=0`、`error TS` **0 条**、18 个顶层目录被建（`~/heyta-carriers/w9-acct-logs/greencheck.log`） |
>
> ✅ **两格都不是本线修的，也不是本线等的** —— owner 在我写这份交接的同一小时里收掉的。
> 本线一次都没代改别人的文件（那枚"替 owner 打上类型修正"的有界实验，断言
> `assert s.count(old)==1` 当场 `AssertionError: 0` —— **那正是"已经修好了"的证明**，见复盘表第 10 行）。
>
> ▶ **21:10 第一趟读数（77 绿 / 10 红，`LEG_RC=1`）**：换绑（A–G）与撤销（I + J 的库侧）与本地优先（K）
> **在真设备上闭合**；改密那一块没闭合。
> 🔴 **这一趟当时给的卡点（"E2EE 口令没进应用状态 ⇒ 同步被闸住，归因未定，登 B149"）已被后续现量否证** ——
> 真因是腿自己的三枚探针缺陷（详见 §6.85 那张表与 B147/B148 的 10-11 追记）：
> ① `ax_press` 把 `--scroll-into-view` 与 `--press` 合成一次调用 ⇒ **一下都没按**而退出码 0，
> 兜底 `||` 成死代码，且 `>/dev/null` 把 `tap-outside-screen` 吞掉；分组页里「立即同步」实测在 **y=-343**；
> ② 设置面第二层那枚"可点的关闭"是**外层面板的残留 AX 节点**（按了界面不动），
> 顺序必须是先按「返回」退层再按 ✕（新陷阱 **#403**）；
> ③ 两张等待态截图的主蓝臂红在**取景**（那颗 disabled 主按钮在折叠线以下），不在标定。
> 三处都已改完（`8520af72`），**判据一条没放松**（阈值、主蓝要求、"树上再无可点关闭/返回"都原样或更严）。
> 🔴 **goal 的收口条件仍未满足**：改密的设备侧读数要等修完之后那一趟（第 7 趟）取。
> 📌 两代 tip 要一起抄：app 二进制 = `1a30d3bc`＋32 枚，服务端 = `a63aa9e9`＋7 枚；
> 两代之间 `git diff --name-only 1a30d3bc..a63aa9e9 -- apps/mobile packages/app-host` **为空**（现量）。

> ### 🔴 10-11 01:5x 读数（这一段**取代**上面 21:10 那块里"改密那一块没闭合"的归因）
>
> 第 7 趟（修完上面那三枚探针缺陷之后）：**96 绿 / 8 红**。剩下两块红的**真因**都量到了，
> 而它们**都不是**上面写的那三枚探针缺陷能解释的：
>
> | 格 | 真因 | 状态 |
> |---|---|---|
> | 改密成功句没出现（判据 L 两枚） | **产品缺陷**：`server/src/password/recovery.ts` 两条改口令的路由 `await` 了那封"你的密码被改了"的告知信。服务端 16:57:03.811 已经改完（`token_version` 2→3、其余设备 401、新口令换得到新会话），而 nodemailer 在 SMTP 不可达时 **17:04:00 才**写 `Failed to send … read ETIMEDOUT` —— 响应被一封邮件扣住，iOS `URLSession` 默认 60 s 先断 ⇒ **界面对一次已成功的改密说「连不上服务端」**。 | ✅ 已修（发出但不等：`notifyPasswordChangedSoon`）＋新判据（发信永不 resolve 时改密仍当场返回，预算取自约束方 60 s 的 1/20）＋变异（`await` 加回 ⇒ `MUT_RC=1` 红在"被扣住"那行）＋全文件 21/21、`server` tsc 0 错。见 **B154** / 陷阱 **#405**。同一形状另两枚（`service.ts:249`、`passkey.ts:556`）先查了归属：**也是本线那笔 `703cafc8` 引进的**，已一并收掉，各带一条同型判据与一次变异。 |
> | 「设置面关不上」2 枚 + 第 16 步「退不回根层」3 枚 | **载体机型**：`heyta-ios-isolated` 是 iOS 27.1 SDK 新增的 **iPhone-Duo**，实测顶栏标题 y=18（同一份产物在 iPhone 17 Pro 上 y=80）⇒ 它给的 `insets.top` 是 **0**，顶栏**最右那一格**（中心 (428,28)）坐在系统状态列的挖孔摄像头下面，`ui tap` 回 `success` 而控件收不到。 | ✅ 归因闭合，处置是**换载体不改产品**（`Screen` 本来就写 `paddingTop: insets.top`）：新载体 `heyta-ios-isolated17`（iPhone 17 Pro / iOS 27.0）装同一份当前产物。见 **B155** / 陷阱 **#404**，以及 **#403 的追记**（那条当时把同一枚「关闭」归成"父面板残留节点"，而那个实验分辨不了这两种成因）。 |
>
> 🔴 **上面那块 21:10 的归因里，"②残留 AX 节点"那一半是本文件自己写错的一条**：
> 它按"按了不动"就判成节点残留，而真正的原因是那一格在这档机型上根本收不到点击。
> 操作顺序那半条（先退层再关面板，且以重读树上还有没有可点节点为准）仍然成立。
>
> ▶ **第 8 趟（新载体 iPhone 17 Pro）读数：`通过 101 项 / 失败 0 项`，`LEG_RC=0`** ——
goal 的收口条件「iOS 设备腿取到读数」在这一趟**闭合**，包括之前一直没取到的那一格：
`✅ 界面出「登录密码已修改。」` + `✅ 成功那一句说清了别的设备要重新登录`，
同趟协议侧对上（旧令牌 401 / 新口令换到新会话 200 / 库里 `token_version` 2→3 /
旧口令换不到会话 / **改密后这台仍能同步**（第 4 秒）/ 本机明文库仍在盘上）。
第 7 趟那 8 枚红逐枚的落点表与两处边界（探针毛刺只登记现象、这一趟仍不证的那几样）
在 **§6.87**。

### 🔴 10-11 05:4x 现状（本文件唯一的「现在」；上面 19:1x 与 02:2x 那两块是过程读数，别当现状照）

**一句话**：**代码、判据、法务、设备腿、文档门禁都在 `main` 上了；只剩两格 —— ① 关闭 goal 要负责人点头，② 「门禁全绿」只能说本线落点全绿，整条 `pnpm check` 停在别线那枚红上。**
现量：`git log -1 --format='%h %s'`、`git status --porcelain -- docs/plans/account-standard-suite*.md BLOCKED.md`（最后一命令为空 ⇒ 本线在工作树里没有未提交的东西）。

| 交付标准 | 现在 | 一条现量 |
|---|---|---|
| 每个新流程有自动化证据 | ✅ | 单元 → HTTP inject → pglite → **真库+真 socket** → 真浏览器 → **iOS 设备腿 101/0**；逐趟在 §6 台账（末节号 `grep -oE '^### 6\.[0-9]+' docs/plans/account-standard-suite.md \| tail -1`） |
| 每条 🔴 判据都能红（含变异） | ✅ | 本轮三条「告知信永不 settle」判据各做过变异 `MUT_RC=1`，还原只从 `<file>.mut-bak` |
| 不推翻既有 ADR 结论 | ✅ | 只新写 ADR-0063；`pnpm check:adr-numbering` RC=0 |
| 不 bump `CURRENT_SCHEMA_VERSION` | ✅ | 换绑与会话走既有列 + payload marker |
| 门禁全绿 | ⚠️ | 本线落点逐道 RC=0；整条链停在 `check:reachability`（`COMMENT`），共五道红，逐道归属见 §6.88 与 B159/B161 |
| iOS 设备腿取到读数 | ✅ | 第 8 趟 101/0（§6.87），日志 `~/heyta-carriers/w9-acct-logs/leg-run8.log` |

**本轮（10-11 03:0x–05:4x）落地的三件事**：
1. 🔴 **一类产品缺陷，不是三个**：四条路由把「安全告知信」`await` 在响应里，而 `deliver()` 内部已经 catch
   ⇒ 信**不会抛、只会挂着**（实测 SMTP 不可达时 7 分钟才失败），而客户端 `fetch` 不设超时 ⇒ 走 iOS `URLSession` 默认 60 秒
   ⇒ 口令**已经换完、别的会话已经踢完、新令牌已经铸好**，界面却说「连不上服务端，检查地址与网络后重试」。
   判据口径：**`const x = await send…`（信本身就是产品结果 ⇒ 必须等）／`await notify…` 且结果丢弃（事后告知 ⇒ 不许等）**。
   落点：`server/src/password/recovery.ts` 两处 + `password/service.ts` + `passkey.ts`；读数与归因在 B154、§6.86/§6.87、环境陷阱 #405。
2. **`server/src/legal.generated.ts` 重生成**（`15fca4f7`）：本线 10-10 20:45 把 terms 抬到 1.5 却没重跑 `gen-server-legal`，
   `check:server-legal` 因此在合并态红过一次 —— 是**本线自己**的欠账，已补。
3. **`ADR-0058` 同号改号收回**（`14e1e322`）：撞号由本线 `9fa53ab9` 引入，按那枚门禁文件头的修法把**后到的那枚**改成 **0064**
   （`docs/adr/0064-inbound-automation-commit-and-task-batch.md`），六处引用逐处改、**改名与引用同一笔落地**；
   复验 `check:adr-numbering` / `check:docs` / `check:doc-citations` / `check:md-table-rows` / `check:docs-voice` **全 RC=0**（§6.88 / B160）。

**共享检出此刻在写什么**（照行动前先 `git status --porcelain` 现量，别照本段推断）：
协作线在整片改 `apps/web/src/features/share/*`、`packages/ui/src/sync/*`、`packages/sync-client/src/share-api-client.ts`；
入站线**刚刚**把 `BLOCKED.md` 里他们自己的 B156/B157/B158 **又插了一遍**（工作树里成对出现，未提交）。
⇒ 这两摊本线都不代做：不改别人正在写的文件，不替别人决定他们的账本要不要去重。

**合并态上红的五道，下一手别替它们动手**（逐道理由在 §6.88 那张表、归属在 B161）：
`check:reachability`（`COMMENT` 已建模零写路径）· `check:layering`（`SHARE_KEY` 在外壳拼 op）·
`check:ui-language`（`web.share.invite.emailPlaceholder` 里没汉字）· `check:verify-script-copy`（两枚 needle 追不上被改词的词条）·
`check:integration-coverage`（一枚真库用例从建立起没被脚本点名）。
🔴 其中**三道来自同一枚别线提交 `e6058120`**（10-09 14:35）—— 撞见第一道就该 `git show --stat` 那枚，
看它还动过哪些**收口面**（词条表、实体登记面、外壳 op 构造面），而不是每道重新查一次归属。

**下一步（有序，别跳）**：
1. **请示负责人关闭 goal**（原话「先不合上，等设备腿」＋ goal 收口条件「关闭 goal 前必须先请示负责人」）。
   设备腿已闭合 ⇒ 这一条**现在才**变成可问的；在拿到答复前**不许**自行 `UpdateGoal complete`。
   问的时候要一并交代「门禁全绿」那一格的真实形状（整条链仍红在五道别线落点上），别只报好消息。
2. **本线自己声明仍然不证的四格**（§6.87 末尾那条原文为准）：
   ① 邮件里那两条链接由**人/设备**点开的完整旅程（腿是 `curl` 直打服务端，点链接的人手上没有会话）；
   ② 通行密钥那一块；③ Android 那两腿本轮没复跑；④ 真机（本轮全是模拟器）。
   这四格**不是缺陷**，是射程边界；要收哪一格先确认它不在别人的写者窗口里。
3. **集成层三格从没走过**（`grep -n '❌' docs/plans/account-standard-suite.md` 在 §6.7x 那张表上现量）：
   legacy 魔法登录 `/login/magic-link/verify`、`/auth/passkey/verify`（要真 WebAuthn 断言）、注册验证码激活。
   补它们要在 `server/tests/integration/` 里做，并且**同批**把文件名点进 `test:integration:postgres`
   —— 否则就长成 B161 里那种「盘上有、没人跑」的形状（那把尺是 `check:integration-coverage`）。
4. **`pnpm reinstall:all` 那一档本轮没跑**（AGENTS §6.1.1 的固定收尾）：本轮落的是服务端与文档，
   客户端产物里不含服务端的语义，但**共享层的界面文案在包里** ⇒ 若下一手接着改客户端，
   收尾必须走"清旧包 → 重打 → 四端重装 → 每端一条『装的是当前产物』的判据"，不能拿测试绿代替。

**防重复死路（本线真撞过的，别再来一遍）**：
· 那枚可达性门禁的文件头自己写了三种**不许用**的修绿手法（删实体 / 只补 `ACTION_FAMILIES` / 拿测试当调用点）—— 本线一种没用，别代它用。
· plumbing 提交（只 `update-ref`）之后**必须**在同一条命令链里把共享索引对本笔路径对齐到新 HEAD，
  否则下一枚裸 `git commit` 会**静默回退**本笔（这一族刚在并行线上真发生过；本线那次补救踩到
  `git restore --staged -- <路径…>` 是**原子**的：清单里有一枚不在索引就整条什么都不做）。
· 取 ADR 号 / BLOCKED 号之前先**现量空号**：ADR 用 `ls docs/adr`，账本用 `grep -oE '^## B[0-9]+' BLOCKED.md | sed 's/## B//' | sort -n | tail -1`。
  同号在 ADR 层有尺会红；BLOCKED 的编号**没有尺**，只会悄悄长成两种读法（本轮 B156 撞过一次，改登 B159）。
· 「探针回 success」不等于「控件收到了」：iOS AX 点击之后必须回读界面或库状态（环境陷阱 #209 / #404）。
· 设备腿的载体用 **`heyta-ios-isolated17`**（iPhone 17 Pro / iOS 27.0，`insets.top = 62`）；
  旧载体 `heyta-ios-isolated` 是 iPhone-Duo，顶栏最右那一格坐在挖孔摄像头下面收不到点击，**别再当产品缺陷查**（B155 / #404）。
· 验证串行跑、不抢前台（`HEYTA_NO_FOCUS=1`）；数失败用例要 `NO_COLOR=1`；管道后的 `$?` 不是被测命令的（#184）。
· 🔴 **本线自己造成过一次破坏（B162，必须读）**：一笔 plumbing 提交把共享账本 `BLOCKED.md` 从 9035 行截成 8240 行，
  原因是脚本从一个**复用了名字的 `/tmp` 陈文件**读输入，而守卫那一步的失败没把非零码传给提交。
  已前向恢复（工作树从没坏过，没人丢内容）。**以后本线每一笔 plumbing 提交收尾必须跑**：
  `git show "$COMMIT":<被写路径> | wc -l` **>=** `git show "$BEFORE":<被写路径> | wc -l`（账本只许变长），
  并且 grep 两枚本线自己的锚点必须命中 —— 这条判据已拿 `49e7149e` 跑过：`9035 -> 8240 变长=False 缺锚 4 枚`、`CONTROL_RC=1` —— 它能红，所以才算一条判据。


---

**（下面是 18:4x 那版现状，保留是为了让下一手认出"墙是怎么塌的"；照行动前先看上面那块。）**


**代码与判据侧已闭合，四端里三端有真读数；唯一没取到的是 iOS 设备腿那一趟，而它现在卡在别人那 5 行代码上。**
负责人已把这一腿留成 goal 的收口条件（原话：「先不合上，等设备腿」）⇒ **goal 不许自行 complete，必须先请示**。

🔴 **本文件写成之后主检出又被别线连续提交（`7c30ca62` → `0243762a` → `8bbc50b1`，18:47–18:53），
拦路的红整个换了一批。** 本节下面这些结论**全部是对 tip `8bbc50b1` 现量的**，
照它行动前请先 `git rev-parse --short HEAD` 对一次（**这份仓里任何"X 会红在 Y"的结论都是瞬时属性**）。

现在拦在设备腿前面的只有两件事，**顺序是 ①→②**：

| ① 第一堵墙 | 已提交的 i18n 里 `site.platforms.{android,desktop}.body` **各写了两遍**（en 两枚 + zh 两枚，共 4 行）。
`packages/i18n` 以 `TS1117` 拒绝 ⇒ `pnpm -r build` 停在**第一枚包**，后面每枚包都没被编译过。登记为 **B141**（原取 B138，与别线那枚撞号后让号）。 |
|---|---|
| ② 第二堵墙 | `apps/node-host/src/host.ts:274` 那个**内联三态**返回类型（= 原 B131/B137）。摘掉 ① 之后，**全链只剩这一处 TS 红**（现量：`BUILD_RC=1`、`error TS` 计数 **= 1**）。 |

✅ **原先登记的三处内联 union，另外两处已被那条线自己修掉了**，而且修法比"补 union"好：
`inbound-runtime.ts:15/:184` 改成 import 共享类型，`InboundAutomationSettings.tsx:13/:37/:72` 用
`Partial<Record<InboundAutomationCycleState | 'failed', …>>` ⇒ 四态都有位置。逐条读数在 `BLOCKED.md` **B137 的 19:0x 更正块**。

✅ **原先 §4.2 / §4.3 那两堵"HEAD 装不了 / HEAD 的 barrel 导入未提交文件"的墙，被这批提交一并拆了**：
那 7 枚 `packages/ui` 组件与三枚在飞 manifest 现在都在 HEAD 里，
`pnpm install --frozen-lockfile --offline` 在载体上 `INSTALL_RC=0`（`Already up to date`、231 ms、**零网络**）。


---

## 1. goal 与范围（不许缩水）

补齐 heyta 的注册登录标准套件：
① 深度调研注册/登录/账号资料全部流程（服务端、共享层、各端界面、法务与对外说明、既有 ADR）→ 缺口清单；
② 据缺口制定落地计划（换绑邮箱、忘记密码/重置、修改密码、会话管理与逐个登出、账号注销对齐，及各自判据与法务联动）；
③ 实施 —— 服务端路由与迁移、`packages/app-host` 共享编排、Web/移动端界面、i18n 中英同步、法务条文与帮助中心同步更新，
**每条判据都要能红（含变异验证）**，门禁全绿。

交付标准：每个新流程有自动化证据；不推翻既有 ADR 结论；**不 bump `CURRENT_SCHEMA_VERSION`** 除非有不可替代理由。

阶段 ①② 已交付（缺口清单与计划都在过程账里）；阶段 ③ 的代码/判据/门禁侧已交付，**剩 §3 那三格**。

---

## 2. 已完成并且**已入库**（别重做）

入库口径：下面每一笔都在 `main`（当前 tip 现量 `git rev-parse --short HEAD`）。

| 面 | 落到哪 | 代表提交 |
|---|---|---|
| 服务端路由 + 迁移 | `access_sessions`（`jti` 会话行）/ `email_change_requests`（换绑双侧确认）；撤销=删行；410 `ACCOUNT_CLOSED` | 见 `git log --oneline --grep='账号标准套件'` |
| 共享编排 | `packages/app-host` 的 `revokeAllDeviceSessions()` / `closeForUser` / `closeForSession`(4003) | 同上 |
| 判据：单元 → HTTP inject → pglite SQL → 真库+真 socket | 三层撤销路径各有真 socket 读数；换绑生效那一路已补齐（§6.75） | `6ef3958a` / `008f67a9` / `3cefc2a8` / `830fe45d` |
| 对外邮件清单对账门 | 「法务点名的那几封 ↔ 服务端真会发的那些封」 | `6c05fd7f` |
| 会话表命名判据 | 「设备名与 UA 都缺 ⇒ 那一行不编名字」 | `d34d2276` |
| 对外句子白名单 + 静态尺 | 「既被抛出又被当兜底句」那句进白名单 | `9267836e` |
| 台账 §6.74–§6.81 | 全部读数与撤回记录 | `c28bfa76` / `731cc2e2` / `56216ae2` |
| Web 端三块面板挂载 | 换绑 / 会话 / 登出 | 任务 #16 已 completed |
| 移动端会话撤销 + 退出登录 | `SecurityScreen` + `ProfileScreen`（最小 hunk 整片落地） | 任务 #18 已 completed |

🔴 **一条归属警告（写给下一个会话，别踩）**：本线 `BLOCKED.md` 的 `## B131` 那段文字
**已被自动化线那笔 `0eea4c0f` 一起收进 HEAD**（我当时用的是宽 `git add`）。
⇒ 那一段现在**不能再 amend**（已公开），要改就新写一笔；
 attribution 用唯一标记串查：`git log -S'B131' --oneline -- BLOCKED.md`。

---

## 3. 当前停在哪（三格，按可动手顺序）

### 3.1 🔴 #15 iOS 设备腿 —— **goal 的收口条件，今天取不了数**

- **要取什么**：换绑邮箱 + 会话撤销 + 改登录密码三块，在**真 iOS 模拟器**上的那一趟。
  脚本已写好并且**不依赖 node-host**：`scripts/verify-mobile-ios-account-email-sessions.sh`
  （16 步 / 判据 A–O / exit 0=通过、1=失败、**3=前提不成立**）。
- **已有读数停在哪**：设备腿最后一趟是过程账 **§6.16 第 11 趟**（步骤 1–9 全绿、5 处探针错）。
  要取的是「探针修完之后」那一趟。
- **为什么今天取不了**：见 §4 —— 载体构建红，而 `scripts/reinstall-all.sh` 第 0 步就是 `pnpm -r build`
  且 **`exit 1` 没有逃生门**（`--only` / `--skip` 都照跑那一步）。
- **跑法（构建绿之后照抄，别重新推）**：
  ```bash
  # ① 装包那一层
  IOS_DEVICE_NAME="heyta-ios-isolated" HEYTA_NO_FOCUS=1 bash scripts/reinstall-all.sh --only ios
  # ② 那一腿（槽端口选空位 → mobile-e2e-up.sh → 验收 → 只停本趟 pidfile 里那一枚）
  bash ~/heyta-carriers/w9-acct-logs/run-ios-account-leg.sh <IOS_UDID>
  ```
  目标模拟器：`heyta-ios-isolated`，UDID `1EDCFA59-6A9C-428D-8FE2-160B11318648`（**跑前现量**：
  `xcrun simctl list devices | grep -i heyta`；它可能已被别人删或改名）。
  ⚠️ 那一腿要 **Ethereal 兜底**（让日志里出现 `Preview URL:`，本机没有真 SMTP），
  且 `IOS_UDID` 必须是**已 boot 且已装 heyta** 的模拟器 —— 这些前提脚本**不会替你创建**。

### 3.2 🟡 #22 法务欠账按 HEAD 落（**本线自己的欠账，不是别人的**）

四件：① 对外邮件「五封 → 九封」（新增四封）；② 「邮箱不可更换」→「双侧确认换绑」；
③ 两张新级联表（`access_sessions` / `email_change_requests`）进注销那句与 `CATEGORY_NAMES`；
④ 换绑两枚时长（TTL **+24 小时**、其他设备失效那句）。中英同步、版本号 bump、重生成两份产物、补臂。

**三个 codemod 已写好但没跑**（住在本机、不在仓内）：
`~/heyta-carriers/w9-acct-logs/legal-head-{email9,closure,rebind}.mjs`。
🔴 它们**没跑过**，所以「已备好」只等于「文件在」，不等于「能用」—— 跑之前先各自 dry-run 读一遍改哪几行。
被什么挡着：法务那半要重生成产物 ⇒ 要能构建 ⇒ 撞 §4 那两堵墙。

### 3.3 🟡 #5 / #17 / #19 —— 三格都卡在「等别人的文件落地」

| 格 | 内容 | 卡在哪 | 现量命令 |
|---|---|---|---|
| #5 | 法务联动那笔**联合提交** | 三条线的文本要一次收拢 | `git status --porcelain -- packages/legal` |
| #17 | 法务「十封」那两行 | 等**未跟踪**的 `registration-otp.ts` 随它那笔落地 | `git status --porcelain -- '*registration-otp*'` |
| #19 | 帮助中心两条问答那两行 | 内容**已核对为真**，只欠挂载（`content.ts` 被别人改写中） | `git status --porcelain -- '*help*content.ts'` |

⚠️ 「等别人提交」是**瞬时事件不是状态** —— 每次动手前重新现量，别照这张表推断。

---

## 4. 阻塞与风险（**除 §4.5 外全部不属于本线**，逐枚带现量）

### 4.0 🔴 先读这一句：**本节每一条都是"对某个 tip"的读数，不是状态**

写这份交接时是 `7c30ca62`；18:47–18:53 别线连续提交把它推到 `0243762a` 再到 `8bbc50b1`，
**§4.3 与 §4.4 那两堵墙当场消失**（它们依赖的"未提交文件"被提交了）。
⇒ 接手第一件事是 `git rev-parse --short HEAD` + 跑 §6 第 1 步那条命令，**别照本节任何一行推断"现在还红"**。

### 4.1 🔴 第一堵墙（新）：已提交的 i18n 有 **4 行重复键** ⇒ 全仓构建停在第一枚包 → **B141**（原取 B138，与别线撞号后让号）

```
packages/i18n/src/locales/en.ts      site.platforms.android.body  行 3789 与 3791
packages/i18n/src/locales/en.ts      site.platforms.desktop.body  行 3795 与 3797
packages/i18n/src/locales/zh-CN.ts   site.platforms.android.body  行 4024 与 4026
packages/i18n/src/locales/zh-CN.ts   site.platforms.desktop.body  行 4030 与 4032
```

`error TS1117: An object literal cannot have multiple properties with the same name`（`tsup` 的 dts 阶段）。
两代落地页平台文案被一次合并**都留下了**，没有二选一。中英各两枚、同名同位置 ⇒
**不是**中英不同步（`check:ui-language` 那侧是对称的），是同一侧写了两个值。

🔴 **修法其实零行为变更**：JS 对象字面量**后者覆盖前者** ⇒ 任何已经构建出来的产物，界面上一直是后一版。
所以"删前留后"改的不是对外承诺的内容，只是把**没生效的那半行**注释掉。
（反证形状：把留/删反过来，界面文案会变 —— 那才是一次真实的对外陈述修改。）

**为什么不代改**：这两段是**落地页对外陈述**（"有签名测试包 / 不在应用商店 / 三端都在公开桶 / SmartScreen 拦一次 /
`dpkg -i` 未实测"），选哪半行是**对外口径**，按既有边界要先说一声；而且文件不在本线手里。
⇒ 已登 **B141**，含只读枚举命令与两版措辞逐字对照。

**本线只做了一次有界诊断**（在隔离载体里、**做完逐字还原**）：摘掉那 4 行后 `pnpm -r build` 从
"停在 i18n" 变成"停在 node-host"，且**全链 `error TS` 计数 = 1**。
还原证明：`git hash-object <file>` == `git rev-parse HEAD:<file>`，`git status --porcelain -- packages/i18n/` 为空。
**主检出一个字都没动。**

### 4.2 🔴 第二堵墙（旧 B131，现在**只剩一处**）：`apps/node-host/src/host.ts:274` 的内联三态 → **B137**

生产侧真源仍是四态：`packages/app-host/src/inbound-process.ts:53`
（`'empty' | 'submitted' | 'needs-confirmation' | 'waiting-entitlement'`）。
**18:5x 现量**：原先枚出的三处内联重抄，另外两处**已被那条线在 18:47–18:53 那批提交里修掉了** ——

| # | 位置 | 现在 |
|---|---|---|
| 1 | `apps/node-host/src/host.ts:274` | 🔴 **仍是内联三态** ⇒ 唯一剩下的红（`src/host.ts(422,5): error TS2322`） |
| 2 | `apps/web/src/features/settings/inbound-runtime.ts` | ✅ `:15` `import type { InboundAutomationCycleResult }`、`:184` 用它 |
| 3 | `apps/web/src/features/settings/InboundAutomationSettings.tsx` | ✅ `:13` import 共享类型、`:72` `useState<'idle' \| 'failed' \| InboundAutomationCycleState>`、`:37` `PROCESS_COPY: Partial<Record<InboundAutomationCycleState \| 'failed', MessageKey>>` ⇒ 四态都有位置 |

**"只剩一处"是怎么证明的**（下一手的人可以直接信这两条，也可以重跑）：
- `pnpm -r build` ⇒ `BUILD_RC=1`，`grep -cE 'error TS'` = **1**，就是 `host.ts(422,5)`。
- `pnpm -r --filter '!@heyta/node-host' build` ⇒ **`BUILD_RC=0`**、`error TS` 0 条，
  并且**排除了"过滤器打空"那种假绿**：`No projects matched` 命中 0、17 个顶层目录被建、
  `apps/web build: ✓ built in 3.71s / Done`、`apps/node-host` 提及 0 行。
  日志 `~/heyta-carriers/w9-acct-logs/build-after-dupfix3.log` 与 `/tmp/nh.log`。

**为什么本会话仍不代改**：换成共享类型之后，`host.ts` 的实现必须处理第四态，
而"CLI 在 `waiting-entitlement` 那一档做什么"（退避重试 / 报错 / 安静等订阅）是**产品语义**，不是删一子；
改后运行时形状无法现量等于改前；该文件此刻在别线手里。三条不齐 ⇒ 只登记。

### 4.3 ✅ 曾经过的第一条墙：HEAD 的 `pnpm-lock.yaml` 与 manifest 对不上 ⇒ **已被那批提交拆掉**

18:3x 那趟的现量是：HEAD 的 lockfile 记着 HEAD 的 manifest **没声明**的依赖
（`@zxcvbn-ts/core@4.2.0`、`@zxcvbn-ts/language-common@4.1.3`、`@heyta/legal@workspace:*`），
于是 `pnpm install --frozen-lockfile` 报 `ERR_PNPM_OUTDATED_LOCKFILE`，
不带 `--frozen-lockfile` 就要去 registry 协调，而**本机到 registry 不可达**
（症状是 `ECONNRESET` / `error 23` / `[ERR_PNPM_META_FETCH_FAIL]`，长得像「缺依赖」，其实是网络 —— 见 `build-pure-head.log`）。

✅ **19:0x 现量：这一格已经好了。** 那批在飞 manifest 现在就在 HEAD 里，
载体（tip `8bbc50b1` + 24 枚脏路径）上 `pnpm install --frozen-lockfile --offline` =
`INSTALL_RC=0`、`Already up to date`、**231 ms、零网络**（`rebuild-at-newtip.log` / `dupdiag3.log` 所在那趟）。

🔴 **但那两条试过的绕法仍然无效，别再试**：`npm_config_verify_deps_before_run=false`
与在载体里放一份 `.npmrc`（`verify-deps-before-run=false`）—— **两者都拦不住那次协调**。
那份 `.npmrc` 已删（**不要靠静默关掉一道守卫来通过**，要修真的不一致）。
⚠️ 这一条**同时更正了过程账 §6.81 里那句「加 `npm_config_verify_deps_before_run=false` 才是走到真错的那一步」**：
它在 13:1x 那趟"看起来"管用，18:xx 这趟不管用；差别是那会儿载体的 lockfile 与 manifest **本来就一致**。
⇒ 那个环境变量不是「让 pnpm 别自检」的开关。**写进文档的因果句要先跑一次"去掉这一步"的对照**（复盘表第 2 行）。

### 4.4 ✅ 曾经过的第二条墙：HEAD 的 `packages/ui` barrel 导入 7 个从未提交的文件 ⇒ **已被那批提交拆掉**

16:4x 那趟现量：committed 的 `packages/ui/src/index.ts`（来自 `e6058120`）导入 7 枚 `file/untracked` 的组件
（`ai/AiGeneratedLabel.tsx`、`ai/AssistantMark.tsx`、`auth/LegalDocumentSheet.tsx`、`auth/PasswordStrength.tsx`、
`empty-state/StateIllustration.tsx`、`habits/HabitArtwork.tsx`、`habits/HabitMetricIcon.tsx`）
＋ 5 个只在**工作副本**里存在的导出 ⇒ 干净检出上 `pnpm -r build` 必红（12 条 TS2305/2307）。
分类装置：`~/heyta-carriers/w9-acct-logs/missing-ui-mods.sh`；原文 `build-head3.log`。

✅ **19:0x 现量：这 7 枚现在都在 HEAD 里**（逐枚 `test -e` + `git ls-files --error-unmatch` 可核）。
⇒ 这一格和 §4.3 是**同一批提交**一起解决的，本文件留着它们是为了让下一个人认出"未提交文件被 committed barrel 引用"这个形状 ——
**它还会再来**（任何一条线用宽 `git add` 挑一半文件都会再造一次）。

### 4.5 🟡 方法论风险：叠加口径切一半会造出**无法归因**的红（本会话实测两次）

**第一次**：只叠 `packages/*` + `server/*` + `apps/mobile/*` 三个前缀时，红在
```
apps/landing build: src/components/Footer.tsx(148,17): error TS2345:
  Argument of type '"landing.footer.disclaimer"' is not assignable to parameter of type …
```
成因是**混代**：在飞的 i18n 词条 ＋ HEAD 的 landing 源码。**不是任何一条线的缺陷**，是叠加口径切了一半造出来的。

**第二次（更贵的一次）**：只把 `apps/node-host` 退回已提交那版，红**没有消失，只是搬到 `apps/web`**，
让我一度以为"排除一处就够了"。⇒ 见复盘表第 3 行。

🔴 **现在这一档已经不需要了**：主检出把在飞改动都提交完之后，载体只需要
`git checkout -f <主检出 tip>` + 少量脏路径（19:0x 现量 `DIRTY_COUNT=24 / COPIED_VERIFIED=24`）。
⇒ 但**下次主检出又攒了一批未提交改动时，这个选择会重新出现**，所以留两条纪律：
① 叠加要么「只叠自己那几枚」要么「叠整片」，**不许按目录前缀切一半**；
② 选了哪种**必须写进装置头与台账**（`sync-prefixes-to-carrier.sh` / `sync-dirty-to-carrier.sh` 的头注释就是干这个的）。

⚠️ 一条配套的现量教训：`git checkout -f` 之前要确认载体是**自己的**（`.worktrees/iosacct` 由本线创建），
且里面的字节可以从主检出重放出来（`sync-dirty-to-carrier.sh` 一条命令）。
第一次没带 `-f` 时被拒绝了 —— 症状是那批"未跟踪文件"现在被新 tip 跟踪了：
`error: The following untracked working tree files would be overwritten by checkout`（列了几十枚 widget 相关文件）。

---

## 5. 验证状态（分层，逐层写清「有读数 / 没有」）

| 层 | 状态 | 读数在哪 |
|---|---|---|
| 单元 | ✅ | 过程账 §6 各节 |
| HTTP inject | ✅ | 同上 |
| pglite SQL | ✅ | 同上 |
| 真库 + 真 socket（三条撤销路径 + 换绑生效） | ✅ | §6.74 / §6.75 / §6.76；提交 `6ef3958a` `008f67a9` `3cefc2a8` |
| 真浏览器 e2e（改密三块 + 变异） | ✅ | 任务 #14 completed |
| **iOS 设备腿** | ✅ **取到** | 第 8 趟 `通过 101 项 / 失败 0 项`、`LEG_RC=0`（§6.87），含之前一直没取到的改密成功屏；载体换成 `heyta-ios-isolated17`，旧载体的机型坑见 B155 与环境陷阱 #404 |
| 变异验证（每条 🔴 判据能红） | ✅ | 任务 #7 completed；逐支读数在过程账 |
| 门禁全绿 | ⚠️ **本线落点覆盖到的门逐道 RC=0**（含本线自己撞的那枚同号 ADR 已改号收回，§6.88 / B160）；🔴 **整条 `pnpm check` 仍停在 `check:reachability`**，合并态共五道红、逐道归属在 B161 / §6.88，没有一道能由本线修 | — |

---

## 6. 下一步（有序，别跳）

1. **先判 §4 那三堵墙有没有被 owner 收掉**（一条命令，别猜）：
   ```bash
   cd .worktrees/iosacct && git checkout -- . && git checkout -q "$(git -C ../.. rev-parse --short HEAD)" \
     && bash ~/heyta-carriers/w9-acct-logs/sync-dirty-to-carrier.sh \
     && git checkout -- apps/node-host \
     && pnpm install --frozen-lockfile --offline && pnpm -r build; echo "BUILD_RC=$?"
   ```
   `BUILD_RC=0` ⇒ 直接跳第 3 步。仍是 1 ⇒ 读红的**包名**：
   还是 `apps/web`/`apps/node-host` 的 `waiting-entitlement` ⇒ B137 未收，**不要代改**，回到「等 owner」；
   变成别的包 ⇒ 是新红，重新归因（**别沿用旧结论**）。
2. **B137 未收时的替代路**（要做就得**显式声明这是对 §6.1.1 的偏离**）：
   手工跑 ios 段自己那四个动作（清 → 打 → 卸 → 装）并沿用脚本的判据
   （新鲜度 + 截图非空白 + **主蓝 `#2563EB` 命中**），**不**跑 `reinstall-all.sh`。
   ⚠️ 这条路会让「装的是当前产物」那一格失去脚本自带的对账，所以要自己补一条哈希对账。
3. **构建绿之后跑设备腿**（§3.1 那两条命令），读数写进过程账**新一节**（下一个空号现量：
   `grep -oE '^### 6\.[0-9]+' docs/plans/account-standard-suite.md | tail -1`，写这份时是 §6.81 ⇒ 下一节 §6.82）。
4. **设备腿绿了再动 #22**（法务四件），因为要重生成产物。
5. **#5 / #17 / #19** 各自现量后再动（§3.3 那张表）。
6. **收尾**：清理载体、把 §6.81 那两处被今天读数否证的句子改准（§7 第 2 条）、
   **然后请示负责人能不能合 goal** —— 🔴 **不许自行 `UpdateGoal complete`**。

---

## 7. 死胡同警告（**已实测走过，别再走**）

1. **别在载体里跑裸 `pnpm install`** —— 会撞网（§4.2），失败信息长得像缺依赖。
2. **别靠 `npm_config_verify_deps_before_run=false` 或 `.npmrc` 关自检** —— 实测拦不住（§4.2）。
3. **别只叠三个目录前缀** —— 会造出 `apps/landing` 那枚无法归因的红（§4.4）。
4. **别代改 `apps/node-host/src/host.ts` / `inbound-runtime.ts` / `InboundAutomationSettings.tsx`** ——
   三条不齐（§4.1），而且它们此刻都在别人手上。
5. **别把「排除 node-host」当成能让构建变绿** —— 今天已否证，红只是搬到了 `apps/web`（§4.1 #2）。
6. **别用宽 `git add`** —— 本线的 B131 文字就是这样被别人的提交吸走的（§2 归属警告）。
   共享检出里落自己那片 hunk 走 plumbing（`hash-object -w` → 临时索引 → `write-tree` →
   `commit-tree` → CAS `update-ref` → `diff-tree` 证明 → 刷新共享索引项）。
7. **别拿缓冲管道探构建**（`pnpm … build 2>&1 | tail -8`）—— 增量输出为零，看着像卡死。
   用不带缓冲的日志文件 + 轮询。取退出码时注意 `cmd > log 2>&1; echo $?` 接在 `tee` 上会拿到 `tee` 的码（陷阱 #179）。
8. **别用 `git status --porcelain | grep -oE 'B[0-9]+'` 数 BLOCKED 末号** —— 会拿到假的 785。
   用 `grep -oE '^## B[0-9]+'`，且 **HEAD 与工作树各读一份**（两者会互相落后）。

---

## 8. 相关文件与命令

**仓内**：
- 过程账：`docs/plans/account-standard-suite.md`（末节现量 `grep -oE '^### 6\.[0-9]+' … | tail -1`）
- 设备腿脚本：`scripts/verify-mobile-ios-account-email-sessions.sh`（16 步 / 判据 A–O / exit 0·1·**3**）
- 起栈：`scripts/mobile-e2e-up.sh`
- 四端重装：`scripts/reinstall-all.sh`（第 0 步 `pnpm -r build`，**无逃生门**）
- 阻塞账本：`BLOCKED.md`（下一个空号 **B135**）

**本机（不在仓内，重启不清但换机器就没有）**：`~/heyta-carriers/w9-acct-logs/`
- `sync-dirty-to-carrier.sh` —— **整片**在飞叠加装置（头注释写了口径）
- `sync-prefixes-to-carrier.sh` —— **三前缀**叠加装置（已否证，留着当反例）
- `missing-ui-mods.sh` —— 逐枚分类 barrel 导入的模块是 `file/untracked` 还是别的
- `run-ios-account-leg.sh` —— 那一腿的跑法（槽端口 3101–3108 选空位 → 起栈 → 验收 → 只停本趟 pidfile 那一枚）
- 四趟构建日志：`build-pure-head.log`（撞网）/ `build-head3.log`（`packages/ui` 红）/
  `build-overlay.log`（`apps/landing` 红）/ `build-full-overlay.log`（`apps/web` 红，**最新**）
- `full-overlay-build.log` —— 最新那趟的 `INSTALL_RC` / `BUILD_RC` 汇总
- `legal-head-{email9,closure,rebind}.mjs` —— #22 的三个 codemod，**未跑过**

**载体**：`.worktrees/iosacct`
- 写这份时：`CAR_TIP=7c30ca62`（= 主检出 tip，无分叉）、工作树脏 **2666** 枚路径、
  `apps/node-host` 已排除（`git status --porcelain -- apps/node-host` = 0 行）
- 叠加以后的读数：`DIRTY_COUNT=3829` / `COPIED_VERIFIED=3754` / `RESYNC_RC=0`
  （在 `~/heyta-carriers/w9-acct-logs/resync.log`）
- ⚠️ 这些数字**全是瞬时读数**，接手先重跑那条同步命令再信。

---

## 9. 硬约束（照抄，别自己放宽）

不主动 commit（本线分笔已获授权）；共享检出里**禁止裸 `git stash`** 与破坏性 git 操作；
变异还原只从 `<file>.mut-bak`（基线等于 HEAD 时优先 `git checkout -- <path>` + 带 pathspec 的 `git diff --quiet` 复验）；
**只对自己创建的对象动手**（不按名字 kill 别人的进程/端口/浏览器）；
验证**串行**跑、**不抢前台**（`HEYTA_NO_FOCUS=1` / `HEYTA_DESKTOP_NO_FOCUS=1`，默认无头）；
**token / root key / 恢复码 / E2EE 口令不得进入日志、dump、trace、截图或证据文件，脱敏在写盘那一步**；
**绝对禁止改动本机网络/代理配置**；不自造内存阈值、**不许调低宿主内存闸门**
（`TFA_LIGHT_NEED_MB` / `TFA_LIGHT_MAX` / `TFA_ALLOW_CONCURRENT_TEST=1` 一律不用）；
不新增第三方依赖除非先过可维护性 + 许可证两道门并逐项登记；
**不 bump `CURRENT_SCHEMA_VERSION`**；**不改已接受 ADR 的结论**；
**不修改 `AGENTS.md` / `CONTRIBUTING.md` 的规则部分**；界面文案零硬编码、中英必须同步；
汇报一律中文、用大白话；**关闭 goal 必须先请示**。
