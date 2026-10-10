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

**代码与判据侧已闭合，四端里三端有真读数；唯一没取到的是 iOS 设备腿那一趟，而它今天被两枚不属于本线的构建红挡着。**
负责人已把这一腿留成 goal 的收口条件（原话：「先不合上，等设备腿」）⇒ **goal 不许自行 complete，必须先请示**。

🔴 **本文件写成的同一趟里量到一条新事实，它推翻了 §6.81 那枚「排除 `apps/node-host` 就能构建」的打算**：
把 node-host 整层退回已提交那版之后，**同一形状的第三处**在 `apps/web` 里立刻顶上来了（详见 §4.1）。
⇒ 那一枚红不是「一处内联 union」，是**一类三处**，而且第三处被第二处**遮着**（修了第二处它才会现形）。

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

## 4. 阻塞与风险（**全部不属于本线**，逐枚带现量）

### 4.1 🔴 B131 是一类三处，不是一处（**本文件写成时新量到**）

生产侧真源（在飞）已把状态加宽成四态：

```
packages/app-host/src/inbound-process.ts:53
  export type InboundAutomationCycleState = 'empty' | 'submitted' | 'needs-confirmation' | 'waiting-entitlement';
```

消费侧**手抄了三态**的地方，全仓枚举结果（命令见下）：

| # | 位置 | 形状 | 现在红不红 |
|---|---|---|---|
| 1 | `apps/node-host/src/host.ts:274` | `processInboundAutomation` 的**内联返回类型** | 🔴 红（= 已登记的 B131） |
| 2 | `apps/web/src/features/settings/inbound-runtime.ts:184` | web 包装函数的**内联返回类型**；报错落在 `:210`（把 `processInboundAutomationEvent(...)` 的结果交给那个签名） | 🔴 **红（今天新量到）** |
| 3 | `apps/web/src/features/settings/InboundAutomationSettings.tsx:56` + `:291` | `useState<'idle'\|'submitted'\|'empty'\|'needs-confirmation'\|'failed'>`，而 `:291` 直接 `setProcessState(result.state)` | ⚪ **现在不红，因为被 #2 遮着** —— `result` 的类型来自 #2 那个三态签名。**把 #2 改成 import 共享类型的那一刻，#3 立刻变红** |

```bash
# 枚举命令（可复现）
cd "<repo>" && grep -rn 'needs-confirmation' --include='*.ts' --include='*.tsx' apps packages server
# 生产侧真源
grep -n 'InboundAutomationCycleState' packages/app-host/src/inbound-process.ts
```

🔴 **还有一条产品行为缺口，不只是类型缺口**：`waiting-entitlement` 在 `apps/` 的**源码里零消费**
（只在 `apps/desktop/dist/*.cjs` 那两份**构建产物**里出现）。
⇒ 即使把三处类型都修通，**web 界面也没有 `waiting-entitlement` 那一档的渲染分支**：
`:291` 会把一个不在本地 union 里的值塞进 `processState`，落到「没有任何分支匹配」。
这需要那一档的产品语义（退避重试？报错？安静等订阅？）—— **不是删一子能修的**。

**不代改**（三条不齐，按既有纪律）：① 修它不是删一子，要决定产品语义；
② 改后的运行时形状无法现量等于改前；③ 这三个文件此刻都在别人手上（` M`）。
⇒ **交回给 owner**，并已登记为 `BLOCKED.md` 的 **B135**（末号现量：
`grep -oE '^## B[0-9]+' BLOCKED.md | tail -1`；写这份时是 B134 ⇒ 下一个空号 B135）。

### 4.2 🔴 HEAD 的 `pnpm-lock.yaml` 与 HEAD 的 manifest 对不上 ⇒ 离线装不了

HEAD 的 lockfile 记着 HEAD 的 manifest **没声明**的依赖（`@zxcvbn-ts/core@4.2.0`、
`@zxcvbn-ts/language-common@4.1.3`、`@heyta/legal@workspace:*`）。
后果：`pnpm install --frozen-lockfile` 报 `ERR_PNPM_OUTDATED_LOCKFILE`；
不带 `--frozen-lockfile` 就要去 registry 做协调，而**本机到 registry 不可达**
（症状是 `ECONNRESET` / `error 23` / `[ERR_PNPM_META_FETCH_FAIL]`，长得像「缺依赖」，其实是网络）。

```bash
# 现量（在载体里）
pnpm install --frozen-lockfile --offline 2>&1 | tail -5
# 纯 HEAD 那趟的证据
grep -n 'ERR_PNPM_META_FETCH_FAIL' ~/heyta-carriers/w9-acct-logs/build-pure-head.log
```

✅ **绕法已实测有效**：把在飞的那几枚 manifest 叠进载体之后，
`pnpm install --frozen-lockfile --offline` = `INSTALL_RC=0`、`Already up to date`、**227 ms、零网络**
（读数 `~/heyta-carriers/w9-acct-logs/full-overlay-build.log`，18:35:03–18:35:19）。

🔴 **两条试过但没用的绕法，别再试**：`npm_config_verify_deps_before_run=false`
与在载体里放一份 `.npmrc`（`verify-deps-before-run=false`）—— **两者都拦不住那次协调**。
那份 `.npmrc` 已删（**不要靠静默关掉一道守卫来通过**，要修真的不一致）。
⚠️ 这一条**同时更正了 §6.81 里那句「加 `npm_config_verify_deps_before_run=false` 才是走到真错的那一步」** ——
它在 13:1x 那趟确实管用，在 18:xx 这趟不管用；差别是**当时载体里 lockfile 与 manifest 已一致**。
⇒ 那个环境变量不是「让 pnpm 别自检」的开关，它只在「不一致本来就不存在」时无害。

### 4.3 🔴 HEAD 自己构建不起来：committed barrel 导入了 7 个从未提交的文件

`packages/ui/src/index.ts`（来自 `e6058120`，产品体验线）导入的这 **7 枚**在主检出里是 `file/untracked`
（存在、但从未 `git add`），另有 **5 个导出**只在工作副本里有：

```
packages/ui/src/{ai/AiGeneratedLabel.tsx, ai/AssistantMark.tsx, auth/LegalDocumentSheet.tsx,
                 auth/PasswordStrength.tsx, empty-state/StateIllustration.tsx,
                 habits/HabitArtwork.tsx, habits/HabitMetricIcon.tsx}
```

```bash
# 分类命令（逐枚判 file/untracked）
bash ~/heyta-carriers/w9-acct-logs/missing-ui-mods.sh
# 那趟红的原文
grep -nE 'error TS' ~/heyta-carriers/w9-acct-logs/build-head3.log | head -14
```

⇒ **在一个干净检出上 `pnpm -r build` 今天必红**，而这与本线无关。

### 4.4 🟡 窄叠加会造出**无法归因**的红（`apps/landing`）

只叠 `packages/*` + `server/*` + `apps/mobile/*` 三个前缀时，红在：
```
apps/landing build: src/components/Footer.tsx(148,17): error TS2345:
  Argument of type '"landing.footer.disclaimer"' is not assignable to parameter of type …
```
成因是**混代**：在飞的 i18n 词条 ＋ HEAD 的 landing 源码。这不是任何一条线的缺陷，是叠加口径不一致造出来的。
⇒ **教训**：叠加要么「只叠自己那几枚」，要么「叠整片」，**不能按目录前缀切一半**；
而且选了哪种**必须写进装置头与台账**（`sync-prefixes-to-carrier.sh` / `sync-dirty-to-carrier.sh` 的头注释就是干这个的）。

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
   还是 `apps/web`/`apps/node-host` 的 `waiting-entitlement` ⇒ B135 未收，**不要代改**，回到「等 owner」；
   变成别的包 ⇒ 是新红，重新归因（**别沿用旧结论**）。
2. **B135 未收时的替代路**（要做就得**显式声明这是对 §6.1.1 的偏离**）：
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
