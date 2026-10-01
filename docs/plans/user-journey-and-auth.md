# 用户旅程与认证：统一规范（**单一事实源**）

> 状态：**已定案并开始实施**（2026-09-28）
> 上位文件：[`multi-end-unified-strategy.md`](multi-end-unified-strategy.md)（唯一权威主计划）
> 本文件回答：**各端的用户旅程长什么样、注册/登录放在哪、每一步谁来保证。**
> 🔴 **任何端不得自行发明第二套旅程** —— 差异只能体现在"宿主形态"（窗口/tab/菜单）上，不能体现在**步骤与顺序**上。

---

## 0. 产品负责人钉死的要求与原话

> 「让所有的端，他们的**用户旅程都是统一的、完整的**」
> 「各端的 UI 各端的用户旅程都完整起来，然后呢，**注册登录一定要前置**」

**本规范对"前置"的落地解释（这是一条需要说明的取舍，不是回避）**：

> **「前置」= 在冷启动旅程的第一屏就可发现、且一步可达，并且首次启动有明确引导。**
> **不是**"把本地功能锁在登录后面"。

**为什么不做硬登录墙**（三条理由，都是仓库已有的硬事实）：

| # | 理由 | 证据 |
|---|---|---|
| 1 | **本地优先是已接受的架构承诺** | `packages/app-host/src/host.ts:91` 明写"离线只读/只写时可以省略 `serverUrl`"；不传 = **纯本地模式**，建任务/打卡/专注/op-log 全部照常，只有同步明确报 `not-configured`（`host.ts:270, 305-309`） |
| 2 | **现有 e2e 明确断言"未登录也能看到首屏"** | `e2e/tests/helpers.ts:117-121` 的 `openApp` 冷启动后断言「添加任务」输入框可见；`e2e/tests/*.spec.ts` 全部 10 条 spec 都从这里出发且全程不登录。**加硬登录墙会让它们立刻全红** |
| 3 | **加墙 = 离线不可用**，是产品倒退 | 与 [ADR-0003](../adr/0003-multi-platform-strategy.md) 的多端策略、以及"自建永久免费"的定位直接冲突 |

⇒ **结论**：登录是**旅程上被前置的一步**，不是**进入应用的门槛**。两端都要有：首屏**一眼看到**「注册 / 登录」，以及一个明确的「先离线使用」出口。

---

## 1. 各端现状（2026-09-28 只读侦察实测）

| 端 | 注册/登录 UI | 位置 | 是否前置 | 未登录可用 | 证据 |
|---|---|---|---|---|---|
| `apps/web` | ✅ 有（magic-link 登录/注册 + passkey 登录/注册 + 恢复 + 粘贴令牌） | 顶栏齿轮 →「同步设置」弹窗 → 按钮 → `AuthPanel` 模态 | ❌ **藏在设置弹窗第 3 层** | ✅ 完全可用 | `SyncBar.tsx:270-277, 330-341`；`AuthPanel.tsx` 六个动作 |
| `apps/mobile` | ❌ **零认证 UI** | 「我的」只有手填 服务器地址/令牌/口令 | — | ✅ 完全可用 | `ProfileScreen.tsx:540-552`；全库 grep 认证关键词**只命中注释**；`hosted-auth` 导入 **0 处** |
| `apps/desktop-macos` | ❌ 无 | — | — | ✅ 可用 | `AppApi.swift` 仅 5 个方法 |
| `apps/desktop-windows` | ❌ 无 | — | — | ✅ 可用 | `AppApi.cs` 仅 5 个方法 |
| `apps/desktop`（Electron） | ❌ 无 | — | — | ✅ 可用 | `renderer/main.tsx` 只调 3 个方法；`ipc-contract.ts` 有 `sync` 但渲染层从不调用 |
| `apps/desktop-linux` | ❌ 无 | — | — | ✅ 可用 | `heyta_api.c` 仅 6 个函数 |

**⇒ 一句话：认证只存在于 web，且在设置里；其余五端为零。**

---

## 2. 认证的真实形状（**必须按这个来，不能想当然**）

🔴 这是本规范最容易被做错的一节 —— 服务端的语义与直觉不同：

| # | 事实 | 证据 | 对 UI 的硬要求 |
|---|---|---|---|
| **A1** | **注册端点不发令牌** —— `/register/*`、`/verify-email`、`/recover/*/complete` 都只回 `{message}` | `server/src/api.ts:908, 377, 616, 215` | 规范写死三步：**注册 → 验证邮箱 → 登录**。**登录是唯一发令牌的落点**（`verifyMagicLink:493`、`completePasskeyLogin:619`） |
| **A2** | **注册可能是"假成功"**（反枚举）：邮箱已属已验证账号时，返回成功文案但**不写凭据** | `passkey.ts:272-274`、`auth.ts:406-408` | 界面**不得**把"注册成功"渲染成"账号已建"；文案必须中性（"如果该邮箱可用，我们会发送…"） |
| **A3** | **已登录"再加一条凭据"走另一组端点**（要 Bearer） | `hosted-auth.ts:844-856`、`server/src/api.ts:817, 851` | 已登录用户加凭据**必须**用 `/api/passkeys/registration/*`；复用公开 `/register/passkey/*` 会**静默空操作** |
| **A4** | **`termsAccepted` 是 `z.literal(true)`** | server 校验 | 注册 UI 必须带**用户自己勾**的同意项；**不得替用户预勾或发明同意** |
| **A5** | **无 cookie，令牌在响应体** | `pages.ts` + `magic-login-confirm.js:36` | 客户端**必须自己持久化令牌**（见 §4） |
| **A6** | ~~**邮件链接的 SPA 回跳是断的**~~ **✅ 已修**（W1，`pending-login.ts`）。⚠️ 但**投递方式后来还错过一次**：服务端页面写 `sessionStorage` 跨不过 agent cluster ⇒ 已改成 **URL fragment**（`/app/#sessionToken=…`）。根因、2×2 证据与"别再改回去"的理由见 [`ADR-0039`](../adr/0039-email-first-auth-and-desktop-reverse-authorization.md) §4 第 5 轮 | `grep -rn loginToken` 现在只命中旧 `server/public/app.js` | 已兑现：web 能解析回跳令牌 ⇒"点邮件链接即完成登录"在 web 端成立 |
| **A7** | **`serverUrl` 不传 ≠ 报错**，而是纯本地 + 同步 `not-configured` | `host.ts:91, 270, 305-309` | **不得**把"没配服务器"渲染成阻塞性错误（会破坏本地优先，也会让 e2e `openApp` 变红） |
| **A8** | **移动端 5 个 tab 是硬约束** | `TabBar.tsx:51-59` + [ADR-0015](../adr/0015-four-quadrant-as-derived-view.md) §4 / P10 | **不得**把"登录"加成第 6 个 tab |

---

## 3. 规范旅程（**唯一一份**）

### 3.1 冷启动首屏（所有端一致）

```
冷启动
  └─ 首次启动（本机从未登录过）→ 【欢迎页 WELCOME】
       · 标题 + 一句话价值主张
       · 主按钮：注册 / 登录          ← 🔴 「前置」的落点，第一屏、一级按钮
       · 次按钮：先离线使用（继续）    ← 本地优先的出口，不许省掉
       · 点「先离线使用」后不再自动弹出；设置里保留入口
  └─ 非首次 → 直接进主界面
```

**各端的宿主形态**（差异只允许在这里）：

| 端 | 欢迎页形态 | 「注册 / 登录」入口常驻位置 |
|---|---|---|
| 移动端 | 全屏 `WelcomeScreen`（**不占 tab**） | 「我的」页顶部卡片 + 首屏；**不是第 6 个 tab** |
| macOS | 独立欢迎 `Window`（或首屏 `Sheet`） | **rail 顶部头像菜单的第一项**（2026-09-30 起，见下） |
| Windows | 独立欢迎页 / 首屏对话框 | **rail 顶部头像菜单的第一项**（与 macOS 逐字一致） |
| Linux | 同上（GTK4 对话框 / 首屏） | 工具栏按钮 |
| Web | 首屏 `Welcome` 覆盖层 | **rail 顶部头像菜单的第一项**（不再是顶栏按钮） |

🔴 **一致性判据（2026-09-30 更新，原话是产品负责人的："应该是点击头像出来注册、登录吧？"）**：

> 冷启动后，**身份入口在首屏可见且唯一**（rail 顶部头像）；
> **点一次**打开身份菜单 → 「登录 / 注册」是菜单**第一项**；
> **再点一次**（合计 2 次）看到表单。
> **未登录时菜单里不出现「退出登录」**（那是已登录才存在的动作）。

**为什么把"1 次点击"放宽到 2 次**（如实登记这次取舍）：

- 原判据（"≤1 次点击看到表单"）的**真实目标是"不能藏在设置深处"**（改动前是
  「齿轮 → 同步设置 → 按钮」三步）。收进头像菜单是**一步**，仍然满足那个目标。
- 反过来，"入口常驻在屏幕上"的代价是**身份入口有两个**（头像 + 一个登录 pill），
  用户要先猜点哪个 —— 2026-09-30 产品负责人实测指出的正是这个。
- 通行做法（UsabilityGeek《The UX Logout Lapse》/ SaaSUI 账号面模式）是
  **身份入口唯一、账号相关动作全部收进它**；heyta 是每天开几十次的应用，
  属于"用户会学会入口在哪"的那一类。
- ⚠️ 判据的**可执行部分没有放宽**：菜单里第一项必须是「登录 / 注册」、
  未登录不得有「退出登录」、入口唯一 —— 这三条都在
  `apps/web/tests/signin-entry.spec.tsx` 里逐条钉住。

### 3.2 注册 / 登录（**步骤与顺序固定，各端相同**）

```
① 输入邮箱
   ②a 用通行密钥（passkey）          ②b 用邮件链接（magic-link）
       · 注册：/register/passkey/*        · 注册：/register/magic-link → 收邮件
       · 登录：/login/passkey/*           · 登录：/login/magic-link → 收邮件
       · 注册成功 ≠ 有令牌（A1）          · 点邮件链接 → /magic-login 页面
       · 必须去【登录】拿令牌              · 🔴 SPA 回跳要能拿到令牌（A6）
③ 【登录】成功 → 拿到 token + user
④ 提示设置 E2EE 口令（同步必需）→ 保存并启用同步
⑤ 回到主界面，顶部显示同步状态
```

**每一步的文案口径**：注册成功一律中性（A2），**不得**出现"账号已创建"这类断言。

### 3.3 主界面（各端能力矩阵 —— 与 `multi-end-unified-strategy.md` §5.5 的补功能顺序一致）

| 能力 | 移动端 | macOS | Windows | Web | 备注 |
|---|---|---|---|---|---|
| 任务 CRUD | ✅ | 🟡 薄切片 | 🟡 薄切片 | ✅ | 桌面壳要长到与移动端对齐 |
| 四象限 | ✅ | ⬜ | ⬜ | ✅ | |
| 习惯 / 打卡 | ✅ | ⬜ | ⬜ | ✅ | |
| 专注 / 番茄钟 | ✅ | ⬜ | ⬜ | ✅ | |
| 分类着色 / 成长 | ✅ | ⬜ | ⬜ | ✅ | |
| 便签 / 回收站 / 导出 | ✅ | ⬜ | ⬜ | ✅ | |
| **注册 / 登录** | ⬜ **本轮做** | ⬜ **本轮做** | ⬜ **本轮做** | 🟡 要**前置** | 🔴 本轮重点 |
| 同步 | ✅ | ⬜ | ⬜ | ✅ | |
| 提醒 / 子任务 / 搜索 | ⬜ | ⬜ | ⬜ | 🟡 | 主计划 §5.5 的功能序 |

---

## 4. 凭据持久化（**今天在任何端都不成立，必须补**）

侦察实测：**所有端都不持久化凭据**（mobile `sync/config.ts` 只放内存并明说；web 只在内存/sessionStorage；桌面壳根本不传）。

⇒ **「登录后重开还要重新登录」是当前的普遍状态。** 这是一条**旅程完整性缺陷**，本轮要修。

| 端 | 应使用的持久化机制 | 不许用 |
|---|---|---|
| 移动端 | iOS Keychain / Android Keystore（`react-native-keychain` 或自写 TurboModule）；**E2EE 口令绝不明文落盘** | AsyncStorage 明文 |
| macOS | Keychain（`SecItemAdd`，壳已有钥匙串能力位） | UserDefaults 明文 |
| Windows | Credential Manager（`CredWrite`）或 DPAPI 加密后落文件 | 明文文件 |
| Linux | libsecret / 文件 + 明确风险声明 | 明文 |
| Web | 令牌可 `localStorage`；**E2EE 口令仍只在内存**（已有承诺，不改） | 把口令写 localStorage |

⚠️ **本轮的取舍**：持久化是**独立一刀**，若某端缺原生依赖（例如移动端没有 keychain 库），**先落"明确的未持久化 + 每次提示"**，并如实登记，**不许假装已持久化**。

---

## 5. 实施顺序（与主计划 §11 的序列对齐）

| # | 工作 | 为什么排这里 | 验收 |
|---|---|---|---|
| **W0** | **本规范**（本文件） | 没有它，各端会各做一套 | ✅ **已完成** |
| **W1** | **修邮件链接 SPA 回跳**（A6） | 它让"点链接即登录"在**所有端**都是假的；是**所有端共用**的路径，先修收益最大 | ✅ **已完成**（见 §9） |
| **W2** | **Web：把入口从齿轮提到顶栏**（前置） | web 已有全部逻辑，**只差位置**；成本最低、立刻可见 | ✅ **已完成**（见 §9） |
| **W3** | **移动端：认证 UI**（零 → 有） | 移动端是主战场，且**应用内完全没有产生令牌的路径** | `verify:mobile-auth`：冷启动 → 欢迎页 → 注册/登录 → 拿到令牌 → 同步 → 另一设备可见 |
| **W4** | **凭据持久化**（§4） | 没有它，"旅程完整"是假的（每次重开都要重登） | 🟡 **Web 已完成**；移动/桌面待做 |
| **W5** | **桌面三壳：认证 UI + 同步接线** | 依赖跨语言门面扩展（见主计划 §4.4-G4） | `check:{macos,windows,linux}-shell` + 各自冒烟 |
| **W6** | **统一验收：每端都要有旅程验收** | ✅ **已完成**（`check:journey-coverage`）—— 见 §11 |
| **W7** | 主计划 §5.5 的功能序（提醒 → 子任务 → 搜索 → …） | 旅程通了才谈补功能 | 各自判据 |

---

## 6. 验收判据（**每条都必须能因注入故障转红**）

| 判据 | 形式 | 反假通过（必须做） |
|---|---|---|
| **J1 前置性** | 每端 e2e：冷启动 → **≤1 次点击**见到注册/登录表单 | 把入口移回设置深处 → 必须转红 |
| **J2 可达性** | 每端 e2e：走完注册 → 验证 → 登录 → **拿到 token** | 把某一步做成空操作 → 必须转红 |
| **J3 中性文案** | 断言注册成功文案**不含**"账号已创建"这类断言（A2） | 换成断言性文案 → 必须转红 |
| **J4 未登录可用** | 保留并**加强**现有 `openApp` 断言：未登录也能建任务 | 加硬登录墙 → 必须转红（这是**反向保护**） |
| **J5 凭据持久化** | 每端：登录 → 重启 → 仍登录 | 不写入 → 必须转红 |
| **J6 本地优先不被破坏** | 没配服务器时，同步报 `not-configured` 而**不是**阻塞错误（A7） | 渲染成阻塞 → 必须转红 |
| **J7 术语与词条** | 新词条 zh 含中文 / en 不含中文 / key 集合一致（`check:ui-language`） | —— |

---

## 7. 明确不做（免得下次重新讨论）

1. **不做硬登录墙**（理由见 §0）。
2. **不把"登录"加成移动端第 6 个 tab**（A8）。
3. **不替用户预勾同意项**（A4）。
4. **不把 E2EE 口令落盘**（web 已有承诺，其余端沿用）。
5. **不在注册成功时断言"账号已创建"**（A2）。
6. **不为各端发明不同的认证步骤** —— 差异只在宿主形态。

---

## 8. 未核实项

1. 生产部署时 `/` 服务的是 `apps/web` 产物还是 `server/public` 旧 app —— **直接决定 A6 的回跳断点在生产是否可见**（`server.ts:446` static prefix `/`）。
2. 鸿蒙端（`verify-harmony-*.sh`）是否有认证入口 —— 本轮未纳入。
3. 移动端可用的 keychain 方案及其许可证/维护度 —— 需按本仓 §3.1–3.2 两道门核实后才能引入。
4. 各桌面壳钥匙串/凭据管理器的具体 API 与签名要求 —— 未逐端核实。
5. 本轮侦察为**只读**，"是否覆盖未登录冷启动"的结论来自读源码与脚本前置，**未实跑验证**。

---

*本规范是各端认证与旅程的**唯一事实源**。任何端要偏离，必须先改本文件并写明理由。*

---

## 9b. ✅ W6 —— 「每端都有旅程验收」变成门禁（2026-09-29）

**门禁**：`scripts/check-journey-coverage.mjs`（`pnpm check:journey-coverage`，已接进 `pnpm check`）。

**它防的是什么**：产品要求「所有端的旅程统一且完整」，而本仓 16 道 `check:*` **全都在验代码对不对，
没有一道在问用户在这一端能不能走完**。实测现状：web 有完整旅程验收，
三个桌面壳**只有任务 CRUD**（无注册/登录、无同步），旅程是断的，**而所有门禁一路绿灯**。

**判据用登记制**（照 `packages/op-log` 的 `UNMODELED_ENTITY_TYPES`）：

| 端 | 旅程验收 | 状态 |
|---|---|---|
| **web** | 5 个 spec（J1/J2/J5/J6/J7） | ✅ 覆盖 |
| **mobile** | `auth-flow.spec.ts` + `verify:mobile-auth` | ✅ 覆盖 |
| **macOS** | ✅ **`check:macos-window`**（断言壳里的真应用把注册/登录画在第一屏） | 🟡 缺口**已收窄**为「注册/登录**之后**的链路」+ 到期条件（把真应用的存储接到壳的 SQLite）。见 [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md) |
| **Windows** | ✅ **`pnpm verify:windows-auth`**（6 条，真壳的真应用，见 §9c） | ✅ **覆盖**（2026-09-30 从"已登记缺口"转正） |
| **Linux** | 0（只有壳冒烟） | 🟡 已登记缺口 + 同上 |

**两种失效都会变红**：
1. 某端**既没旅程验收、也没登记** ⇒ 有人新增/遗漏了一个端而没人想过它的旅程；
2. **登记已过期**（那端其实已有旅程验收，登记还留着）⇒ 登记表不会一年比一年长。

**🔴 门禁第一版抓出了我自己的模型错误**：它把「壳冒烟」当成了「旅程验收」，
于是"macos 有 2 个入口"与"macos 登记了缺口"直接打架 —— 红是它自己报的。
修法：把 `journeySpecs` 与 `shellSpecs` **分开**，判定只看前者。**壳冒烟不抵旅程验收。**

**验证（实际输出）**：
```
✅ web：有**旅程**验收（5 个）
✅ mobile：有**旅程**验收（2 个）
🟡 macos/windows/linux：**已登记旅程缺口**（壳冒烟 1–2 个，不抵旅程验收）
   —— 抽查：web 的旅程验收真的能跑 ——  Test Files 3 passed   Tests 25 passed
✅ 每一端要么有旅程验收、要么有显式登记的缺口（含理由与到期条件）。   exit=0
```

**反假通过**：把 macOS 那条缺口登记改名（等效于"忘了登记"）⇒
`❌ macos：既没有旅程验收、也没有登记缺口` → **exit=1**；还原后复绿、`diff` 为空。

---

## 9c. ✅ Windows 桌面端：Playwright 附着到真壳里的真应用（2026-09-30）

> 产品负责人 2026-09-30 的指令：**优先在 Windows 上做那个 Playwright 测试**
> （此前顺序是"先从 Mac 端开始"）。本节就是这条指令的落地与证据。

### 被测对象到底是什么（别搞混）

| 项 | 是什么 |
|---|---|
| 被测界面 | `windows-pc` 上**真壳里的真应用**：`apps/desktop-windows`（WinUI 3）的 WebView2 加载 `apps/web/dist` |
| 被测浏览器 | **WebView2**（Edge 内核 `Edg/154.0.4258.37`）—— **不是** Playwright 下载的 chromium |
| Playwright 干什么 | `chromium.connectOverCDP()` **附着**上去驱动，**不启动任何浏览器** |
| 服务端 | 本机（Mac）真服务端 + 真 Postgres，TEST_MODE |
| WebAuthn | 真 `navigator.credentials.create/get`，系统弹窗由 CDP **虚拟认证器**应答（challenge/签名/origin 校验全真） |

### 一条命令

```bash
pnpm verify:windows-auth        # scripts/verify-windows-shell-journey.mjs
```

### 旅程 × 验收矩阵（W1–W6，全部实跑通过）

| # | 旅程 | 判据（能因注入转红的那个） | 证据 |
|---|---|---|---|
| **W1** | 未登录注册 | 界面报"注册申请已提交" **且**虚拟认证器里**真的多了一把凭据**（=1） | `evidence/journey/windows-shell-1-signed-out.png`、`-2-registered.png` |
| **W2** | 登录 | 令牌**落盘**（`baseUrl`/`token`/`email` 在，**口令不在**）；头像菜单出现邮箱、登录入口消失 | `-3-signed-in.png` |
| **W3** | 数据上行 | 登录后建任务 + 补口令同步 → **到服务端数出 op ≥ 1**（不信界面说的"已同步"） | `-4-synced.png` |
| **W4** | 新设备恢复 | **先证伪本机**（重置后断言无凭据、0 条任务行）→ 登录同步后那条任务可见 | `-5-second-device.png` |
| **W5** | 退出登录 | 落盘凭据被清掉 **且**身份菜单翻回"第一项=登录/注册、无退出登录" | `-6-signed-out-again.png` |
| **W6** | 反向：地址错了 | 界面必须**说出失败**且**不得**出现"注册申请已提交" | `-7-failure-visible.png` |

**实跑输出**（`pnpm verify:windows-auth`，2026-09-30）：
```
✓ W1 …(12.1s)  ✓ W2 …(12.0s)  ✓ W3 …(14.8s)
✓ W4 …(13.4s)  ✓ W5 …(13.7s)  ✓ W6 …(14.1s)
6 passed (1.4m)          exit=0
```

### 🔴 这次一共抓到 **3 个真缺陷**（都是"界面在说谎"那一类）

| # | 缺陷 | 根因 | 修法 |
|---|---|---|---|
| 1 | **登录后打开"同步设置"点保存，会把服务端地址清掉**（同步当场变"还没配置"） | `SyncBar` 的 `baseUrl`/`token`/`password` 是局部 state，初值只在**挂载**时取一次；而登录发生在挂载之后 ⇒ 保存时提交了空地址 | 对话框**打开时**从 store 播种三个输入框；钉在 `apps/web/tests/sync-settings-prefill.spec.tsx`（去掉播种 ⇒ 3 条用例转红，已验证） |
| 2 | **第二条登录用例必红**：`Response counter value 2 was lower than expected 2` → `Invalid credentials` | 每条用例都把 W1 的**旧快照**重新注入干净的认证器 ⇒ 签名计数器从同一起点重数，而服务端要求**严格递增** | 每次登录后把**已推进过**的凭据快照读回来供下一台设备用（真实同步通行密钥也是这个行为） |
| 3 | **退出登录后断言"未登录形态"等不到元素** | 退出登录会把头像菜单**收起来**，而断言直接去查菜单面板 | 先再点一次头像把菜单打开（这正是用户真实要做的动作） |

⚠️ 缺陷 2、3 在 **web 那条套件（`e2e/auth-journey/`）里是同一份代码**，同样成立 ——
web 套件目前仍被 macOS 的 WebAuthn RP-ID 问题挡着没跑通，所以**那两处还没在 web 上修**。
缺陷 1 的修法是共享的（在 `SyncBar` 里），web 一并受益。

### 🔴 反假通过（判据真的能转红，三条都实测过）

| 判据 | 注入 | 结果 |
|---|---|---|
| **CDP 身份门**（`assertCdpIsOurShell`） | 把端点指向**本机 Chrome** 的 `127.0.0.1:9223`（那上面真有一个） | **1ms 内失败**：`CDP 端点…上跑的是 Chrome/154…，不是 Edge/WebView2` |
| **产物自洽** | 产物用 `--base=/app/` 打（引 `/app/assets/…` 而文件在根下） | 转红并点名 5 个缺失引用 |
| **同步设置预填** | 注释掉 `SyncBar` 里那个播种 `useEffect` | `sync-settings-prefill.spec.tsx` **3 条全红** |

> 📌 身份门不是形式主义：**2026-09-30 实测真的踩过** —— 探针选了 9223，
> 而本机 Chrome 正好监听在那里（用户自己的浏览器，24 个标签页），
> `connectOverCDP` 连上去、拿到页面列表、一切"正常"。同形事故见
> [`docs/runbooks/desktop.md`](../runbooks/desktop.md) §5.5（那台 Windows 上 9222 被一个无关的 Tauri 应用占着）。

> 📌 还有一条**一致性判据挡不住**的教训：`sync_windows_sources` 的 sha256 对账比的是
> **本地 vs 远端**，而当时两边是**同一份错的产物**（`/app/` 前缀那份），所以对账"通过"。
> ⇒ 所以运行器加了**产物自洽**判据，并且**每次从源码重打** `apps/web/dist`。

### ⚠️ 它**不**声称什么（边界，别读多）

1. 🔴 **壳里真应用的数据落在 WebView2 自己的 IndexedDB，不是壳的 SQLite。**
   两者是两份 —— M2-D 的已知边界（`docs/research/spikes/m2-webview-shell/README.md` §4d）。
   "把真应用的存储接到壳的 SQLite"**仍未做**。
2. **不是 MSIX 打包态**：为了让 CDP 与 `HEYTA_WEB_ROOT`/`HEYTA_WEB_MODE` 生效，
   这条路径跑的是 `dotnet publish` 出来的**自包含 exe**（打包态是 app 模型启动，
   环境变量传不进去）。MSIX 的"装上能跑"由 `pnpm reinstall:all` 的 Windows 段负责，两者互补。
3. **GPU 加速路径未验**：结论只到"这套 UI / 旅程在壳里成立"，不含渲染性能。
4. **web 套件（`pnpm verify:web-auth`）在 macOS 上仍被**
   **Chromium 拒收 IP 字面量做 WebAuthn RP ID** 挡着 —— 那是另一条路，本次没动。

### 怎么跑、坑在哪

10 个步骤与三条硬约束（身份门 / 反向隧道为什么必须 / 端口为什么要先体检）写在
`scripts/verify-windows-shell-journey.mjs` 的文件头与各行注释里。

---

## 10. 🔴 认证 / 欢迎 UI 的共享化（W8）—— 🟡 **纯逻辑部分已完成，组件部分待做**

### ✅ 10.0 已完成：**失败原因 → 词条 key** 收成一份（2026-09-29）

| 文件 | 动作 |
|---|---|
| `packages/ui/src/auth/model.ts` | **新建**。`authFailureMessageKey`（唯一映射）、`AuthFailureMessageKey`（本地字面量联合，**不 import i18n** —— 那会拖进第二份 React）、`AuthJourneyStep` / `STEPS_WITHOUT_TOKEN` / `hasTokenAfter`（把"注册/验证邮箱拿不到令牌"变成**有类型**的事实）、`AUTH_TERMS_REQUIRED_KEY` |
| `packages/ui/src/index.ts` | **末尾追加**导出（该文件是多写者共享、只许追加） |
| `apps/web/src/features/auth/AuthPanel.tsx` | 删掉本地 `authFailureKey`（1438 字节），改用共享那份 |
| `apps/mobile/src/auth/failure-key.ts` | 🔴 **整个删除**（80 行重复，连函数名都叫 `authFailureMessageKey`）；`AuthScreen.tsx` 改从 `@heyta/ui` 取 |
| `packages/i18n` | `web.auth.error.*`(14) + `mobile.auth.error.*`(16) → **统一为 `common.auth.error.*`(15)**；两端共删 30 条、加 15 条，zh/en 各 **1785** 条且集合一致 |
| `packages/ui/tests/auth-model.spec.ts` | **新建**，11 条断言，含**源码级的"只有一份"断言** |

**命名空间的选择是有依据的**：仓库**已经为"同步失败"做过一次一模一样的收编** ——
`packages/ui/src/sync/model.ts` 的 `SyncFailureMessageKey` 就是 `common.sync.error.*`，
它的注释写着「此前在两个壳里各写了一份……现在收在这里一份」。认证照它的形状做。

**验证（实际输出）**：
```
packages/ui      tests/auth-model.spec.ts        11 passed
apps/web         认证 5 个 spec                  49 passed
apps/mobile      全量                            394 passed (24 files)
apps/web         typecheck                       exit 0
apps/mobile      typecheck                       exit 0
```

**反假通过**：`auth-model.spec.ts` 的源码断言在**收编之前是红的** ——
它要求 `apps/**` 里不再出现 `'web.auth.error.` / `'mobile.auth.error.` / `function authFailureKey`。
实测：移动端那份 `failure-key.ts` 存在时**该文件命中、断言失败**（`expected … not to match`），
删掉后复绿。这就是"两份同一职责的实现"唯一的机器保证 ——
**它在任何行为测试里都露不出来**（两边各自都对），只能查源码。

### 10.1 现状：组件部分**仍未共享**（这是剩下的一半）

### 10.1 问题是实测出来的，不是我推测的

| 实现 | 位置 | 行数 |
|---|---|---|
| Web | `apps/web/src/features/auth/AuthPanel.tsx` | **484** |
| 移动端 | `apps/mobile/src/screens/AuthScreen.tsx` | **403** |
| **合计** | —— | **887 行，两遍** |

而且**连失败原因到文案的映射都写了两份**：
`apps/web/src/features/auth/AuthPanel.tsx:70` 的 `authFailureKey` 与
`apps/mobile/src/auth/failure-key.ts` —— 后者自己的注释就写着
「与 `apps/web/.../AuthPanel.tsx` 的 `authFailureKey` **同一职责**」。

`packages/ui/src/` 下**没有 `auth` 目录**（也还没有 `welcome`）。

### 10.2 为什么这是硬约束问题，不是"以后再收"的技术债

产品负责人的原话是「**UI 组件是一定要复用的**」，而 [ADR-0036](../adr/0036-main-battlefield-and-rn-single-source-ui.md)
把"UI 单源"定成已接受的架构决策。**887 行两遍 = 直接违反。**
而且认证是**最不该漂移**的那一块：两端对同一个 `HostedAuthFailureReason` 给出不同句子、
或对"注册成功"给出不同承诺（见 §2-A2 的中性文案要求），都是**用户可见的行为不一致**。

### 10.3 目标形状（照 `packages/ui` 既有惯例）

`packages/ui` 的既有边界（`src/index.ts` 的注释）：**进得来的**是 RN 原语写成的展示组件
与其依赖的**纯逻辑**（各目录的 `model.ts`）；**进不来的**是任何 `apps/*` 的东西、
任何 i18n（会拖进第二份 React）、任何 DOM 标签、任何裸样式值。

照这个形状：

```
packages/ui/src/auth/
  model.ts        ← 纯逻辑：步骤状态机、字段校验、reason→MessageKey 映射的唯一一份
  AuthPanel.tsx   ← RN 原语写的表单（mobile 直接渲染；web 经 react-native-web）
packages/ui/src/welcome/
  model.ts        ← 纯逻辑：首次启动判据、两个出口的语义
  WelcomeScreen.tsx
```

**关键的纪律（否则收完还是会漂）**：
1. **`reason → MessageKey` 的映射只能有一份**，且放在 `model.ts`（纯逻辑，可 node 环境测）。
2. **文案不搬进 `packages/ui`** —— 走既有的 `labels` / 词条 key 透传模式
   （`TaskListLabels` 就是这么做的）。原因是 `packages/ui` 不许 import i18n：
   那会把**第二份 React** 拖进来，本仓为此崩过一次。
3. **两端各自只保留"宿主绑定"**：web 的 `AuthPanel` 退化为薄包装
   （传 `baseUrl` / `onSignedIn` / 打开方式），移动端的 `AuthScreen` 同理。
4. **收口后必须能用门禁证明"只有一份"** —— 新增断言：`authFailureKey` 这类映射
   在 `apps/*` 里**零命中**，只在 `packages/ui` 里有一份（照
   `check:row-single-source` 的做法）。

### 10.4 为什么现在没做（如实登记，不是遗忘）

`apps/mobile` 的认证实现**正在并行收尾**（真机验收待独占模拟器）。
在那份代码落定之前动 `packages/ui/src/auth/` 会与在途改动直接冲突，
而"移动端先落地、再做共享化"的顺序本身也更安全（先证明形状可用，再抽公共层）。

**⇒ 触发条件**：移动端 W3 的验收完成（或明确登记为"环境争用未取得干净证据"）之后，
**立刻**做 W8。在此之前，本文件 §10 是它的任务书。


---

## 9. 执行进度（逐条带证据，**不许写"基本完成"**）

### ✅ W1 —— 修邮件链接 SPA 回跳（A6）

**改动**：
| 文件 | 动作 |
|---|---|
| `apps/web/src/features/auth/pending-login.ts` | **新建**。`takePendingLogin()` 读出并**立即清除**；`consumePendingLogin()` **复用既有的** `useAuthStore.verify()`（不新写登录路径） |
| `apps/web/src/main.tsx` | 在 `initOpLog()` **之后**、**不 `await`** 地调 `consumePendingLogin()`（本地优先：不为登录推迟首屏） |
| `server/public/magic-login-confirm.js` | 除了 `loginToken` 再写 `loginBaseUrl`（**令牌不够** —— 应用还要知道去哪校验；不写死 `/`，因为应用与服务端可能不同域） |
| `apps/web/tests/pending-login.spec.ts` | **新建**，11 条断言 |

**验证（实际输出）**：
```
✓ tests/pending-login.spec.ts (11 tests)
Test Files  1 passed (1)     Tests  11 passed (11)      exit=0
```

**反假通过（必须做，已做）**：删掉 `apps/web/src/features/auth/store.ts:150` 的
`useSyncStore.getState().applyAuthToken(...)` →
```
AssertionError: expected undefined to be 'JWT-OK'
Test Files  1 failed (1)     Tests  1 failed | 10 passed (11)
```
→ 还原后 `11 passed`，且 `diff` 为空。

### ✅ W2 —— Web 认证入口前置到顶栏

**改动**：
| 文件 | 动作 |
|---|---|
| `apps/web/src/features/sync/SyncBar.tsx` | 顶栏加**一级入口** `data-testid="sync-signin-entry"`（**未登录时**才显示，用 `sync.token === undefined` 判定）；`AuthPanel` 的 `baseUrl` 按**从哪进来**取值（对话框用其输入框、顶栏用已保存的 `sync.baseUrl`），**始终只有一个地址来源** |
| `apps/web/src/features/auth/AuthPanel.tsx` | 加**仅在 `baseUrl` 为空时出现**的服务端地址输入 ⇒ 顶栏一次点击即可到达可用表单；已配置时不渲染该输入（面板与改动前一致）。复用既有词条 `web.sync.serverUrl.label`，**未新增 i18n**（避免与移动端并行改动争 `packages/i18n`） |
| `apps/web/tests/signin-entry.spec.tsx` | **新建**，5 条断言（J1 判据） |

> 🔴 **投递方式的更正（第四版，2026-09-30）—— 本条上面的描述是历史记录，读的时候必须带上这段。**
> W1 第一~三版把会话写进 `sessionStorage`（键 `loginToken` → 会话 JWT → 会话 JWT + 三个键）。
> **前三版都跨不过那一跳**：确认页由同步服务端渲染，带 `@fastify/helmet` 默认的
> `Cross-Origin-Opener-Policy: same-origin` + `Origin-Agent-Cluster: ?1`，而应用（静态产物）两个都没有
> ⇒ 跳过去**切换 browsing instance**，`sessionStorage` 不跟回来（实测读数：确认页 `pagehide` 时键还在、
> 应用启动时已空，且**没有任何 `removeItem`**）。**现在走 URL `fragment`**，应用读完立刻
> `history.replaceState` 抹掉。完整 2×2 证据与"为什么不是 localStorage"见
> [`ADR-0039`](../adr/0039-email-first-auth-and-desktop-reverse-authorization.md) §4 第 5 轮
> 与 `apps/web/evidence/email-chain/README.md`。

> ⚠️ **后续变动（保持本条为历史记录，不改写）**：入口此后搬过两次 ——
> 2026-09-29 从顶栏搬到 **rail 顶部账号区**（`AccountMenu`）；
> 2026-09-30 从"头像旁的 pill"收进**头像菜单第一项**（身份入口唯一化）。
> 当前形态与判据以本文件 §3.1 为准，代码在
> `apps/web/src/features/shell/AccountMenu.tsx`（文件头有完整理由与外部依据）。

**验证（实际输出）**：
```
✓ tests/signin-entry.spec.tsx (5 tests)
✓ tests/auth-panel.spec.tsx (12)  ✓ tests/auth-passkey.spec.tsx (12)  ✓ tests/auth-recovery.spec.tsx (9)
Test Files  4 passed (4)     Tests  44 passed (44)      exit=0
pnpm exec tsc --noEmit -p tsconfig.spec.json → exit=0
```

**反假通过（已做）**：把入口的 `onClick` 从 `setAuthOpen(true)` 改回 `sync.openSettings()`
（= 改动前的"藏在设置里"）→
```
AssertionError: expected '同步设置' to be '登录 / 注册'
Test Files  1 failed (1)     Tests  2 failed | 3 passed (5)
```
→ 还原后 `28 passed`（三个 spec 一起跑），`diff` 为空。

### ✅ W4（web 部分）—— 凭据持久化

侦察实测：**所有端都不持久化凭据**（令牌只在内存/sessionStorage）⇒ 刷新一次就要重登一次，
**"登录后重开还在"在任何端都不成立**。

| 文件 | 动作 |
|---|---|
| `apps/web/src/features/sync/credential-storage.ts` | **新建**。`load/save/clearStoredCredentials`，**注入 storage**（可测隐私模式与写失败） |
| `apps/web/src/features/sync/store.ts` | 冷启动 `hydrate`；`configure` / `applyAuthToken` 落盘；`clearCredentials` **同时清落盘那份** |
| `apps/web/tests/credential-storage.spec.ts` | **新建**，9 条断言（含"口令绝不落盘"） |

🔴 **落盘边界（写死在文件头）**：`baseUrl` ✅ / `token` ✅ / **`password` ❌ 绝不落盘**
—— 口令是**解密密钥**，落盘等于取消端到端加密。令牌可以落盘是因为它只能存取
**服务端已有的密文**（载荷本体在口令那边），丢了只等价于"需要重新登录"。

**验证（实际输出）**：
```
✓ tests/credential-storage.spec.ts (9 tests)
完整 web 套件：Test Files 60 passed | 2 skipped (62)   Tests 868 passed | 12 skipped (880)   exit=0
```

**反假通过（两处，都已做）**：
- 去掉 `applyAuthToken` 里的 `saveCredentials` → `expected null to deeply equal {…}` 等 **2 条红** → 还原复绿。
- **把口令泄进盘里** → `expected '{"baseUrl":…}' not to contain 'password'` **1 条红** → 还原复绿。
  （这一条专门证明"口令不落盘"那句注释是有断言兜着的，不是口号。）

### ✅ W9 —— 托管优先的注册旅程真的跑通了（2026-10-01）

产品负责人那三条（① 没人贴令牌 ② 生产真的服务这条旅程 ③ 拆掉"先填你自己的域名"）
**三条都有了一等的证据**，且证据是**结果**不是"代码写好了"。

| 条 | 证据 | 在哪 |
|---|---|---|
| ③ 拆墙 | 旅程脚本**一次地址都不填**，并读回地址框的 `value` 断言它等于同源地址 | `apps/web/evidence/email-chain/README.md`「一个地址都不填」 |
| ① 真旅程 | `node scripts/verify-email-web-chain.mjs` **11/11 绿、exit 0**：UI 注册 → 真发一封 → 链接 → 确认页 → **应用真的登录了** | 同上 + `web-chain-run.txt` |
| ① 人看过 | 两张截图（确认页 / 登录后带 Sign out 的账号菜单）**已逐张打开核对**，邮箱串与 `run.txt` 逐字对得上 | `web-chain-{1,2}-*.png` |
| ② 生产 | 线上五条判据：`/health` 200、`POST /api/login/email-password` **401**（不是 404/500）、`POST /api/register/email-password` **201** + 真发信、`magic-login-confirm.js` 里 `sessionToken` **3 次**、启动日志出现 Argon2id KAT 行 | [`deployment.md` §3.8.1](../runbooks/deployment.md) |

🔴 **两条新判据都做过变异实测**（在一次性干净 worktree 里，共享工作树未动）：
预填初值改回空 ⇒ **恰好**"地址框预填"那格红（`value=""`），其余十格全绿；
把 built server 的 `withLocale` 摘掉 ⇒ **恰好**"链接带 `lang=`"那格红，其余全绿。
两次的共同形状是**结果类全绿、结构类红** —— 也就是"用户能用"与"这份实现靠什么成立"
被分开点名，这正是判据分两类的意义。

⚠️ **顺带查出的一条探针事实**（不是产品缺陷，但会造出假证据）：
Playwright 的无头 Chromium **不发 `Accept-Language`**，而 `navigator.language` 是 `en-US`。
⇒ 服务端渲染的页面拿不到语言线索、落到 `zh-CN` 兜底，而 SPA 自己是英文的 ——
"英文界面 + 中文确认页"就是这么来的，而它长得极像本地化坏了。

### 🟡 缺口 G1 —— 「真收件箱里点开那封信」这一腿从未跑过

**缺什么**：旅程脚本读的是 **Ethereal preview URL**（信的内容是真的、链接是从渲染后的正文里取的），
但**没有任何脚本从真实邮箱（163/QQ/Gmail）把信读回来再点**。
**为什么没做**：仓库里**不存在收件箱读路径** —— 无 IMAP 客户端、无测试邮箱凭据
（实测：`scripts/` 与 `e2e/` 里 `imap` 零命中）。这不是"忘了写"，是**缺一把钥匙**。
**为什么不能拿它当已验**：真实邮箱会改写链接（网关预取、`ref` 参数、HTML 实体二次转义），
而"点进来看到的是确认页而不是失效页"恰恰是这条旅程最容易坏的一格。
**闭合条件**：给一个可授权的测试邮箱（IMAP 只读凭据）⇒ 在 `verify-email-web-chain` 里
把"取链接"的来源从 preview 页换成**真收件箱**，其余判据一条不动地复用。
**边界要说准**：真实 SMTP **发得出去**这件事在生产上已实测（自建 SES 通道 +
账号语言→英文邮件落件，见 [`i18n-multilingual.md`](i18n-multilingual.md) §3 的验收记录）；
G1 缺的是**收件侧那一步**，不是发信侧。

### ⬜ 待做

W3（移动端认证，**实现已完成、真机验收待独占模拟器**）· W4（移动/桌面侧）· W5（桌面三壳）· W6（统一验收脚本）· **G1（真收件箱点击腿）**

### 📌 本轮的决定与理由（自行取舍处，如实登记）

| 决定 | 理由 |
|---|---|
| **"前置"= 首屏可发现 + ≤1 次点击可达，不做硬登录墙** | 见 §0 三条理由（本地优先是已接受承诺 / 现有 e2e 断言未登录可用 / 加墙 = 离线不可用） |
| ~~W1 用 `sessionStorage` 而非把令牌放 URL~~ **（已更正，见下）** | 放 **query** 会进历史、`Referer` 与访问日志 —— 这条理由仍然成立；但"`sessionStorage` 随跳转存活"**在跨 agent cluster 时不成立**（实测） |
| ✅ **更正（2026-09-30）：投递改用 URL `fragment`** | `fragment` 同样**不进** `Referer`、**不进**服务端日志，而且是 URL 的一部分 ⇒ **跨 agent cluster 一定跟得过来**，**不依赖服务端与反代的头配置一致**。它严格**小于** localStorage（应用启动失败时随标签页消失，不跨重启留着）。⚠️ **别改回 `sessionStorage`** —— ADR-0039 §4 第 5 轮 |
| W1 **不 `await`** 消费 | 登录是增强路径；为它推迟首屏等于用"能立刻用"换一个可能失败的网络往返 |
| W2 让 `AuthPanel` 自带地址输入（仅未配置时） | 否则顶栏入口在首次使用时无处可填服务端，"前置"变成"前置到一个走不通的表单" |
| W2 **不新增 i18n 词条** | 移动端子代理正在改 `packages/i18n`；复用 `web.sync.serverUrl.label` 既够用又避免冲突 |