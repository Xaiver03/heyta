# B（桌面端真应用存储 → 壳的 SQLite）：macOS 壳侧证据

> 采集时间：**2026-09-30**（CST）· 本机 macOS · 引擎 **JavaScriptCore** + **libsqlite3**
> 上位文档：[`docs/plans/desktop-storage-host-handoff.md`](../../../../docs/plans/desktop-storage-host-handoff.md) ·
> Windows 侧同一条判据：[`apps/desktop-windows/evidence/storage-host/`](../../../desktop-windows/evidence/storage-host/README.md)

## 这份产物证明什么

`smoke-full.txt` 是 `heyta-smoke` 的**完整输出**（24 项 ✅、exit 0）。它证明
**B 的壳侧在两个桌面端都成立**：macOS 壳用**同一个** `bridge-bundle/native-bridge.js`、
**同一份** `DbOpLogStore`（`packages/storage`），跑在 **libsqlite3** 上，
经宿主边界服务页侧的 op-log 请求。

其中新增的 7 条（与 Windows 的 `Program.cs` 第 8 节**逐条同构**）：

| 断言 | 结果 |
|---|---|
| `openOpLog` 拿到**库里给出的** clientId | ✅ |
| `oplog-hello` ⇒ 壳回且只回一条消息 | ✅ |
| 那条消息是 `ready` 交握 | ✅ |
| `ready` 里的 clientId 与库里那个**逐字相同** | ✅ |
| 空库经宿主边界 `getAllOps` ⇒ ok 且 0 条 | ✅ |
| `appendLocal` 经宿主边界 ⇒ 返回 seq `[1]`（实测响应 `{"id":2,"ok":true,"value":[1]}`） | ✅ |
| 再经宿主边界 `getAllOps` ⇒ 正是刚写的那条 | ✅ |
| 🔴 **Swift 独立读壳的 `.sqlite`** ⇒ `ops` 表里有 1 行（**不经过 TS 栈**） | ✅ |

最后一条是判据本体：**"数据落在壳的 SQLite"只能靠从壳外读那个文件来证明**。

## 怎么复现

```bash
cd <repo>
node packages/app-host/scripts/build-native-bridge.mjs      # 先产出 bundle
cd apps/desktop-macos
swift build --product heyta-smoke --disable-sandbox \
  --cache-path .swiftpm-cache --config-path .swiftpm-config \
  --security-path .swiftpm-security --scratch-path .build
cd ../..
HEYTA_BRIDGE_BUNDLE="$PWD/packages/app-host/bridge-bundle/native-bridge.js" \
  apps/desktop-macos/.build/debug/heyta-smoke
```

### 🔴 那两个 flag 不是可选的（本机实测）

裸 `swift build` 在受沙箱约束的环境里**编不动**，两个独立原因：

1. **SwiftPM 要写 `~/Library/...` 的缓存**（`org.swift.swiftpm` / `Caches/org.swift.swiftpm`），
   而在工作区外没有写权限 ⇒ 先把 `--cache-path` / `--config-path` / `--security-path`
   指到**工作区内**（这里用 `.swiftpm-*`）。
2. **SwiftPM 自己会调 `sandbox-exec`**，在已有沙箱里会 `sandbox_apply: Operation not permitted`
   ⇒ `--disable-sandbox`。

⇒ 报错信息（`Invalid manifest` + `sandbox_apply`）看起来像"清单写坏了"，
**实际是环境**。与 Windows 那侧的 PS 5.1 编码坑同一类：症状指向的地方不是原因。

## WKWebView 接线已做（B 的最后一格）

`HeytaMacApp.swift` + `ShellStorageHost.swift`：`WKUserScript`（`atDocumentStart`）注入端口 shim、
`WKScriptMessageHandler`（`heytaStorage`）收消息转 `AppApi.handleHostMessage`、
返回的每一串用 `window.postMessage(JSON.parse(...), '*')` 回推。形状与 Windows 那份**逐字同构**。

### 判据（两步，缺一不可）

**① 真应用自己报告走了壳的存储** —— `window-evidence.txt` / `final-evidence.txt`：

```
STORAGE_HOST=on
STORAGE=shell
JOURNEY_TYPED=Optional(TYPED)
```

**② 🔴 从壳外读那个 `.sqlite`** —— `from-outside-db-read.txt`：

```
TITLE=B-mac-final-1790763473
heyta.sqlite-wal: bytes=123632 title=True
  mtime=2026-09-30 18:17:54   ← 就是那一次运行
```

⇒ 那条标题是**经界面**打进去的（旅程探针：往采集框打字 + 回车），
而它出现在**壳自己的库**里，且**从壳外**读到。两次运行、两个不同标题都成立。

### macOS 上"造出那条数据"用的是哪条路（因为没有 CDP）

WKWebView 不暴露 CDP，Playwright 也没有 WebKit 的附着 API ⇒ Windows 那套
`connectOverCDP` + Playwright 点界面**走不通**。可用的机制是这个壳**本来就在用的**那一种
（`evaluateJavaScript`，它已经在点头像）：`HEYTA_STORAGE_JOURNEY=<标题>` 时跑一段
"往采集框打字 + 派发回车"的脚本。

⚠️ 实测要点：React 受控输入必须走**原型上的 value setter** + 派发 `input`
（直接 `input.value = x` 不会更新 React 的 state，症状是"看起来填了、提交为空"）。

## C 的前置实测：通行密钥在 macOS 壳里**是可用的**

C 的形态压在"自定义 scheme 能不能做 WebAuthn"这一格上（Windows 壳用的是 `https://heyta.local`，
macOS 壳用的是 `heyta-local://app` —— **不一样**）。实测（`capability-evidence.txt` / `auth-state-evidence.txt`）：

```
PAGE_ORIGIN=heyta-local://app
SECURE_CONTEXT=yes
WEBAUTHN=function
```

⇒ WKWebView 把自定义 scheme 当**安全上下文**，`PublicKeyCredential` 存在。**通行密钥没有被 origin 挡住**。
（服务端的 RP ID / origin 都是环境变量：`server/src/passkey.ts:109,115` ⇒
用 `WEBAUTHN_RP_ID=app` + `WEBAUTHN_ORIGIN=heyta-local://app` 就能配上。
⚠️ RP ID 会是 `app`（scheme 的 host）—— 这一点尚未在真机上走通，是本条的下一个未知。）

### 🔴 C 的技术结论（量出来的）：**macOS 壳里通行密钥做不了**

两次实测，都在 `webauthn-probe-evidence.txt` / `webauthn-focused-evidence.txt`：

```
（我为了不抢焦点，按 AGENTS §6.2 用的 HEYTA_NO_FOCUS=1）
WEBAUTHN_PROBE=ERROR name=NotAllowedError message=The document is not focused. uvpaa=false

（带焦点重测，且**不建凭据**）
WEBAUTHN_PROBE=SKIPPED_CREATE uvpaa=false
```

两条独立的事实：

1. 🔴 **`isUserVerifyingPlatformAuthenticatorAvailable() === false`** —— 带焦点也一样。
   即：**WKWebView 认为平台认证器不可用**，所以注册/登录根本走不到 Touch ID 那一步
   （用户看到的正是"没有任何反应 / 已取消或超时"）。
   ⚠️ **不是硬件问题**：这台机器 `bioutil -r` 显示 `Biometrics for unlock: 1`，
   `ioreg` 有 4 个 `AppleBiometricSensor`，机型 Mac16,5。
   最可能的原因：WKWebView 的 WebAuthn 要求 app 与 RP ID 的域名**有关联**
   （`com.apple.developer.associated-domains` 的 `webcredentials:` + 服务端 AASA），
   而 `apps/desktop-macos` 里**没有任何 associated-domains / webcredentials 配置**，
   RP ID 又只有 `app` 一个标签。**这一条是推断，不是实测** —— 已验证的是"不可用"。
2. 🔴 **`HEYTA_NO_FOCUS=1` 会让任何 WebAuthn 调用失败**（`The document is not focused`）。
   这是本仓取证/截屏脚本的既定约定（`AGENTS §6.2` 规定二：不得抢用户焦点），
   而它与 WebAuthn 的"要求文档在前台"**直接冲突**。⇒ **跑通行密钥相关的验收时不能带它。**

⇒ 所以 C **不能**只是"补一条登录后的断言"：macOS 壳当前的鉴权路**走不通**，
要先决定换哪条路（见 handoff §6 的选项）。

### C 的判据机制（已落地）：登录前后**各有恰好一种**合法 IA

`AUTH_STATE=signed-out` / `AUTH_STATE=signed-in` 写进证据，判定在 `menuProbe` 之后：

| 状态 | 必须成立 | 实测 |
|---|---|---|
| 未登录 | 第一项 = `sync-signin-entry`、有设置项、**没有**退出登录 | ✅ `AUTH_STATE=signed-out`（回归通过） |
| 已登录 | **有**退出登录、且**没有**登录入口 | ⏳ 需要人按一次 Touch ID |
| 其它 | 两者都在 / 都不在 ⇒ **红** | 判据没有放松，只是把"登录之后"也纳入可判定状态 |

⚠️ **通行密钥那一步必须有人**（系统 Touch ID 弹窗）。壳能做的是：
把所有**可自动**的部分跑到弹窗之前，并让"人做完之后"的那一态**可被断言** ——
不把人的那一步伪装成自动通过。

## C（macOS「注册/登录之后」）：机制已落地，**绿了**；红（注入）**还没拿到**

`pnpm verify:web-auth` 那条跑在 Chromium 里；macOS 壳里没有 CDP，所以这里用的是**壳内探针**
（`evaluateJavaScript` / `callAsyncJavaScript`）——这与本目录上半部分验存储时用的是同一条机制。

### 走的是哪条路（以及为什么只能是它）

两条硬约束（都已实测）：

| 路 | 状态 |
|---|---|
| 通行密钥 | 🔴 壳里**不可用**（`uvpaa=false`，见本文件上半部分） |
| magic-link 回跳 | 🔴 需要深链 `heyta://auth#token=…`，而 macOS 壳**没有**深链处理（no `CFBundleURLTypes` / no `application(_:open)`） |
| ✅ **面板里粘贴链接 / 令牌** | 产品**已有**的功能（`web.auth.paste.label`：「或者粘贴登录链接 / 令牌」）——正是为"拿不到深链"准备的 |

所以 C 的机制 = **两半，都走界面**：

1. `HEYTA_AUTH_JOURNEY=register-link|send-link` + `HEYTA_AUTH_EMAIL=<邮箱>`：
   头像 → 登录/注册 → 填服务端地址 + 邮箱 → 点「注册新账号」/「发送登录链接」。
2. `HEYTA_AUTH_JOURNEY=paste-token` + `HEYTA_AUTH_TOKEN=<令牌>`：
   打开面板 → 把令牌粘进那个输入框 → 点「完成登录」。

⚠️ **令牌由测试侧从库里读**（`users.login_token`，服务端本来就明文存；
管理接口刻意不吐它）—— 这是 TEST_MODE 语境下的"打开邮件"，不是产品后门。

### 绿的那一次（`auth-journey-2-paste.txt`）

```
AUTH_JOURNEY=PASTED signedIn=true
STORAGE=shell
AUTH_STATE=signed-in
```

`AUTH_STATE` 是**独立于探针**的那条断言：登录之后重新点开头像、
菜单里**有退出登录、没有登录入口** ⇒ 才给 `signed-in`。

### ✅ 红也拿到了 —— 同一判据、相反结论

| 输入 | `AUTH_JOURNEY` | 权威判据 |
|---|---|---|
| **有效令牌**（`auth-journey-2-paste.txt`） | `panelClosed=true panel=<应用正常界面>` | **`AUTH_STATE=signed-in`** |
| **坏令牌**（`auth-journey-INJECTION.txt`） | `panel=<「链接无效或已过期，请重新发送一封。」>` | 🔴 **`AUTH_STATE=signed-out`** |

⇒ 判据在"令牌有效 / 无效"两种输入下给出相反结论 —— 这是它能承重的证据。
（坏令牌那次红得也有信息量：面板**自己说出了**失败原因。）

⚠️ **探针里那个 `panelClosed` 不是判据**：面板在成功与失败两种情况下**都会关掉**，
所以"`sync-signin-entry` 不见了"是**假阳性**（注入那次它就说成了"成功"）。
**权威判据只有 `AUTH_STATE`** —— 它由 M2 那条链在事后重新点数菜单 IA 得出。

### 🔴 拿到这条红之前，撞上并修掉了一起**真事故**：dist 在浏览器里根本跑不起来

第一次跑注入时应用**整个不挂载**（`identity:0 / capture:0`），而且**对照实验（不带任何鉴权旅程）
也一样** —— 说明与鉴权无关。加了 `HEYTA_BOOT_DIAG=1`（把 `error` /
`unhandledrejection` 记进证据）之后，原因立刻有名有姓：

```
bootErrors: "ReferenceError: Can't find variable: exports"
```

链子是这样的：

1. `packages/i18n/src/locales/` 下躺着两份**游离的 CommonJS 文件** `en.js` / `zh-CN.js`
   （`"use strict"; Object.defineProperty(exports, …)`）—— 是 `tsc` 落下的**残渣**；
2. 它们**未被 git 跟踪、且被 `.gitignore` 明确忽略**（`packages/i18n/src/locales/*.js`）
   ⇒ `git status` **看不见它们**，但打包器解析 `./locales/en` 时**选中了 `.js`**
   （产物注释写着 `// src/locales/en.js`）；
3. `@heyta/i18n` 的包产物 `dist/index.js` 因此是**混合形态**（开头 ESM、里面内联了 CJS），
   而 web 打出来的浏览器包里就带着**裸的 `exports`** ⇒ 浏览器里第一跳就抛。

**修法**：删掉那两份残渣 + 重打 `@heyta/i18n` + 重打 `apps/web/dist`。
验证：裸 `Object.defineProperty(exports` 归 **0**，应用**恢复挂载**。

⚠️ **影响面**：这条打的是**产物**，所以它同时废掉**两个桌面壳**与任何打包产物 ——
而 `vite dev`（`pnpm verify:web-auth` 用那条）**看不出来**。这也解释了为什么 D 是绿的而壳全挂。
⚠️ 这是"**被 gitignore 藏起来的构建残渣**"这一类：它不显示在任何 diff 里，却能让产物报废。

### 顺带量到的两件事（都不是缺陷，但会误导人）

1. **TEST_MODE 下注册会自动验证**：`POST /api/register/magic-link` 之后
   `users.is_verified=1` 且 `verification_token` 已被清 —— 所以"点邮件里的验证链接"这一步
   在验收里**不需要**（也不要以为它漏了）。
2. **对不存在的邮箱，"登录链接"是故意静默的**（防枚举）：界面照样说"如果这个邮箱有账号，
   登录链接已经发出"，而库里**不会有令牌**。第一版探针就是被这条坑到的 ——
   必须先注册，登录链接才有对象。

## 壳侧反向授权（ADR-0039 §2.3，2026-09-30 第 2 轮）：**逻辑验通了，端到端卡在一个壳缺陷**

### 做了什么

- `Sources/HeytaShellCore/ShellAuth.swift`：**纯逻辑** —— 生成 `state`、拼授权起点、
  **解析并校验回调**（四种拒绝：scheme 不对 / 令牌在 query 里 / 没有令牌 / **state 不一致**）。
- `Sources/HeytaMac/ShellAuthSession.swift`：`ASWebAuthenticationSession` 的封装
  （系统浏览器那一步**由人完成**）。
- `HeytaMacApp.swift`：两个口子（`HEYTA_AUTH_START=1` 起真授权；`HEYTA_AUTH_CALLBACK=<URL>` +
  `HEYTA_AUTH_STATE=<state>` 把回调直接喂进**同一条**处理函数）；
  交付动作 = 往**页面自己 origin** 的 `sessionStorage` 写 `loginToken` + `loginBaseUrl`
  （即 `apps/web/src/features/auth/pending-login.ts` 消费的那条**既有**路径），再由壳重新加载。
- `scripts/package-app.sh`：注册 `CFBundleURLTypes` / scheme `heyta`
  （⚠️ 壳**第一次**对外承诺 URL scheme）。

### 验到什么程度

| 判据 | 结果 |
|---|---|
| 冒烟（`heyta-smoke` 第 10 节，6 条） | ✅ 合法回调接受、**state 不一致拒绝**、令牌在 query 里拒绝、别的 scheme 拒绝、state 是 64 位随机、授权起点形状正确 |
| 🔴 注入：拿掉 `state` 校验 | 冒烟当场红：**「state 不一致竟然被接受了 —— 安全边界失效」** |
| 壳里真喂一个**错 state** 的回调（`shell-auth-badstate.txt`） | ✅ `AUTH_CALLBACK=rejected: state 与本次发起的不一致 —— 拒绝` |
| 壳里喂一个**对 state** 的回调（`shell-auth-goodstate.txt`） | 🟡 `AUTH_CALLBACK=ok`（交付动作发生了），**但之后应用没挂载**（`identity:0`）⇒ 没法断言"登录成立" |

### ✅ 端到端走通了（第 3 轮）—— 而上一轮那条"壳缺陷"是**我搞错的**

```
AUTH_CALLBACK=ok          ← state 校验通过、令牌交给页侧
AUTH_STATE=signed-in      ← 页面重载之后，独立那条菜单 IA 断言确认**登录成立**
STORAGE=shell
```
（错 state 的对照仍拒：`AUTH_CALLBACK=rejected: state 与本次发起的不一致`。）

#### 🔴 一、我上一轮的结论是错的：那不是壳缺陷，是我自己的**无限重载循环**

上一轮我加了两个验证口子（`HEYTA_RELOAD_TEST` / `HEYTA_AUTH_CALLBACK`），都**没有"只跑一次"的开关**。
而它们都会**重新加载**页面 ⇒ 重载之后首屏探针**再次成功** ⇒ **再重载** ⇒ 循环。
症状与"壳加载不了第二次"**一模一样**：`identity:0`、模块在场、`load` 已触发、**没有任何错误**。

加上一次性开关之后，同一实验立刻变成 `✅ 身份入口成立（头像 1 个、采集框 1 个）…`
⇒ **壳完全可以加载第二次**。这条教训值得记：**验证口子自己也要能被判据约束**（
"只跑一次"不是可选项），否则它会把"我没有证据"伪装成"产品有缺陷"。

（顺带：启动探针原来用**冒泡阶段**监听 `error`，而**资源加载失败不冒泡** ⇒
"模块脚本没执行"这件事在证据里是**空的**。已改成捕获阶段并回传失败的 URL。）

#### 🔴 二、真正挖出来的缺陷：**web 的邮件回跳第二腿一直是坏的**（已修）

链路本该是：确认页 → 把**一次性链接令牌**交给应用 → 应用用 `verifyMagicLink()` 去服务端**换**会话。
而确认页存进去的是**它自己 POST 换回来的会话 JWT** ⇒ 应用拿 JWT 再去
`/api/login/magic-link/verify` 换一次 ⇒ **必然 401**（服务端按链接令牌那一列查）。
失败被 `consumePendingLogin` 按设计吞掉 ⇒ 用户看到的是"点了邮件里的链接，回来还是未登录"。

**没有任何测试覆盖它**：J1–J7 走通行密钥，`verify:email-auth` 只验服务端。
修法：确认页存**原始链接令牌**（`sessionStorage['loginToken'] = token`）。

#### 🔴 三、壳交付的是**会话**，所以给它一个**独立的键**（已修）

壳从 `heyta://auth#token=…` 拿到的是**会话本身**，不是链接令牌 —— 拿它走 `verify()` 同样是 401。
所以 `pending-login.ts` 现在有**两条明确分开的通道**：

| 键 | 是什么 | 谁来消费 |
|---|---|---|
| `loginToken` | **一次性链接令牌** | 应用拿它去服务端**换**会话（`verify()`） |
| `sessionToken` | **会话本身**（壳交付） | 直接采用（`adoptSession`，内部复用同一个 `applyAuthSession`） |

⚠️ 两个键不用同一个名字是刻意的：一个"要么换要么直接用"的模糊值，
迟早会被某一条路按错的方式解释。回跳 URL 现在也带上 `email=…`（头像要用）。

#### 🔴 四、修的过程中又被测试抓到我一个 bug

`takePendingSession` 第一版**无条件删掉了 `loginBaseUrl`** —— 而那是**两条通道共用**的键，
于是链接那条路取不到 baseUrl ⇒ 整条登录静默变成"没登上"。
`apps/web/tests/pending-login.spec.ts` 的两条断言当场红。已改成**先读会话键、为空就一个键都不动**。

## 如实记边界（别读多）

1. **`-wal` 还没 checkpoint 回主库**：载荷在 `heyta.sqlite-wal` 里（主库只有 73728 字节的旧内容）。
   与 Windows 侧同一条边界、同一个原因（进程是被 `pkill` 掉的，没机会跑关闭时的 checkpoint）。
   `-wal` 是数据库的一部分，结论不受影响；要更强的"主库自带"需要让应用优雅退出后再扫。
2. **🔴 截图这一格这次**没拿到可用的：`HEYTA_SELF_CAPTURE` 那条路产出的是**空白窗口**
   （只有标题栏与底部诊断行），而脚本的外部取图（`screencapture -l`）在这台机器上
   拿不到窗口 id（`swift window-id.swift` 静默返回空）。
   ⇒ **B/macOS 的判据不依赖截图**：它靠的是上面那两步（页侧自述 + 从壳外读库）。
   "窗口画出来了"那一格由仓库既有门禁负责 —— 但见下面第 3 条。
3. **🔴 顺手发现一个真缺陷（不属于本轮改动，但必须记下来）**：
   `pnpm check:macos-window` **报通过**，而它产出的
   `apps/desktop-macos/evidence/window-first-run.png`（与 HEAD **逐字节相同**，`6b0c1c5f…`）
   显示的却是**「找不到共享 UI 产物」的回退屏**。
   也就是说：那条门禁的"窗口画出来了、且壳里的真应用把身份入口做对了"**没有被那张图证明**。
   ⚠️ 根因**尚未隔离**（候选：它启动的那次实例没有 `HEYTA_WEB_ROOT`、而 app 包里也没有
   `web-dist`；或它读到的 M2 说明是**上一轮留下的旧文件**）。
   本轮的两次实跑是**另起实例 + 显式 `HEYTA_WEB_ROOT`**，那两次真应用确实画出来了
   （`final-evidence.txt` 里的 M2 说明需要整条探针链成功才写得出）。
2. **`appendLocal` 的 `args` 是位置参数表**，要套两层（`[[op]]`）。少一层会把单个 op
   当数组用，症状是 `is not iterable` —— 第一版就是这么错的，而这条断言当场抓住了它。
3. **`markUploaded` 的 `ReadonlyMap` 过不了裸 JSON**，必须有线码；那一格由
   `packages/storage/tests/contract.spec.ts` 的「宿主边界」契约项担保（252/252），
   这里不重复造断言。
4. 没有截图：这一格是**无头**冒烟（不开窗），所以它证明的是"跨语言 + 真落盘"，
   不证明"界面画出来了"。窗口那一格由 `check:macos-window` 负责。
