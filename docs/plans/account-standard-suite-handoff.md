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
> ▶ **正在进行**：`IOS_DEVICE_NAME="heyta-ios-isolated" HEYTA_NO_FOCUS=1 bash scripts/reinstall-all.sh --only ios`
> 在载体里跑（**走脚本原路，零偏离**）。第 0 步 `pnpm -r build` 已是 `✅ 全仓构建完成` ——
> 这是本线开工以来**第一次**过了那道没有逃生门的闸门。当前卡在段内 `pod install`
> （最多 6 趟有界重试，`ArgumentError - path name contains null byte` 是逐趟非确定性的上游缺陷，
> 不是产品坏了），随后 `xcodebuild Release`。日志 `~/heyta-carriers/w9-acct-logs/reinstall-ios-leg.log`。
> 装完之后跑 `bash ~/heyta-carriers/w9-acct-logs/run-ios-account-leg.sh <UDID>`，读数写进过程账 **§6.83**。
> 🔴 若这一腿仍未闭合，**goal 就还是 open**，别把"构建绿了"读成"设备腿取到数了"。

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
| **iOS 设备腿** | 🔴 **未取** | 最后一趟停在 §6.16 第 11 趟（1–9 绿、5 处探针错） |
| 变异验证（每条 🔴 判据能红） | ✅ | 任务 #7 completed；逐支读数在过程账 |
| 门禁全绿 | ⚠️ **本线相关的那几道绿**；`pnpm -r build` 在**任何**今天的树上都红（§4.2–§4.4），**不归本线** | — |

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
