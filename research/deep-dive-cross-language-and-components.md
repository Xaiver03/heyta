# 跨语言复用 TS 同步栈 + 可复用开源组件盘点

- **调研日期**：2026-09-25（本报告内所有 star / 提交时间 / 发布版本均为当日实测）
- **目标项目**：heyta —— 本地优先（local-first）任务管理应用，滴答清单（TickTick）替代品，目标平台 iOS / Android / Windows / macOS / Linux / Web
- **核心问题**：
  1. 如果直接复用 Super Productivity（MIT）的 `@sp/sync-core` / `@sp/shared-schema` / `@sp/sync-providers` 作为同步底座，而客户端 UI 用 Flutter / KMP / React Native 写，有哪些可行路径？
  2. 各类周边组件（RRULE、NLP 日期、CalDAV、ICS、推送、streak、本地数据库、跨端框架）里，哪些能合法闭源商用？

---

## 0. 取证方法与证据分级（重要）

本次调研的**所有数字均来自实际检索**，不使用记忆。取证通道：

| 用途 | 通道 | 说明 |
|---|---|---|
| GitHub 元数据（star / fork / archived / 默认分支 / 最近提交 / 最新 release / 主语言） | `research/tools/ghinfo.py` | 抓 github.com 公开 HTML + `commits.atom` / `releases.atom`。**不走 api.github.com**（该 IP 未认证配额已耗尽） |
| License 精确判定 | `curl` 抓 `raw.githubusercontent.com` 的 `LICENSE` / `LICENSE.md` / `LICENSE.txt` / `COPYING` 原文 | 逐文件回退；必要时补读子包 `package.json` / `Cargo.toml` / `pyproject.toml` / `pubspec.yaml` |
| 包注册表事实（版本 / 许可标签 / 发布时间 / 下载量） | pub.dev API、npm registry、crates.io API、PyPI JSON API | 注册表声明与仓库原文冲突时**以注册表为准并注明** |
| 平台官方文档 | `curl` 抓官方文档原文 | bellard.org（QuickJS）、docs.deno.com、bun.sh、nodejs.org、kotlinlang.org、jetbrains.com、v2.tauri.app、docs.syncthing.net、developer.apple.com |
| 本地上游源码 | `research/upstream/super-productivity/`（已克隆，HEAD `aa9690ca` @ 2026-09-24） | Part 1 的量化结论全部基于本地源码实测，非推测 |

**证据分级标注**：
- `[原文]` = 直接读到 LICENSE / 官方文档原文
- `[注册表]` = 包注册表 API 返回的声明
- `[元数据]` = GitHub 页面字段（已与原文交叉验证时并列标注）
- `[搜索摘要]` = 搜索索引摘要，未读原文
- `[未核实]` = 拿不到证据，**明确留空，不猜**

**环境限制（影响本次取证完整性）**：本机 `web_search` 工具全程返回 `Tavily API error (HTTP 432)`，`web_fetch` 对多数非 GitHub 域名报 `non-public IP`。因此改用 `curl` + 系统代理 `http://127.0.0.1:7890` 直连官方文档与注册表 API，并辅以 Bing / DuckDuckGo-Lite HTML（后者触发验证码，未采用）。**本报告中凡依赖搜索引擎才能得到、又无法用上述通道复核的结论，均已标注 `[未核实]`。**

---

## 1. 一句话结论（TL;DR）

| 问题 | 结论 |
|---|---|
| 能否把 TS 同步栈搬到非 JS 客户端？ | **技术上可行，但"直接跑 TS"这条路在本项目上被上游自身的依赖堵死了** —— `sync-core` 依赖 WebAssembly（Argon2id）、WebCrypto、`CompressionStream`、`TextEncoder`，而 QuickJS 官方文档对这五项的提及次数均为 **0** |
| 最省事的路径是什么？ | **客户端留在 JS/TS 生态**（Web + Capacitor 移动 + Electron/Tauri 桌面）。Super Productivity 本身就是 Angular + Capacitor + Electron 跑满 6 平台，复用度接近 100% |
| 如果 UI 必须是 Flutter/KMP？ | 必须**移植**，且工作量被严重低估：可复用包只有 **13,128 行** src，但其宿主耦合面（app-side op-log）是 **51,708 行**，整个应用 **243,391 行** |
| 移植有没有成功先例？ | **有，而且是上游自己做的**：Super Productivity 已把加密层手工移植到 Kotlin（`Argon2.kt` 371 + `Blake2b.kt` 124 + `OpPayloadDecryptor.kt` 138 = **633 行**），并配有 CI 级互操作固件 |
| 加密契约跨语言可靠吗？ | **可靠，已实测**：TS 加密 → Python 独立实现（`argon2-cffi` + `cryptography`）解密，中文+emoji 载荷往返成功 |
| 移动端能否用 sidecar？ | **不能**。Apple 官方文档中 Foundation `Process`（子进程 API）平台列表**只有 macOS 10.0 与 Mac Catalyst 13.0，没有 iOS** |
| 服务端权威架构？ | 与"本地优先"定位**直接冲突**；Super Productivity 在 ADR #10 中明确否决了服务端实体版本化，理由是"那会让服务端成为真相源，而不只是裁判" |
| 组件层最大的法律风险？ | 🟥 `@nextcloud/cdav-library` 确认 **AGPL-3.0-or-later**，必须替换（推荐 `tsdav`，MIT）；🟥 Radicale / Baikal 是 **GPL-3.0**（只能独立自托管，不能嵌入） |

---

# 第一部分：跨语言复用 TS 同步栈

## 2. 先量清楚"到底要复用什么"

不量化复用面，任何方案比较都是空谈。以下全部基于本地源码实测（`research/upstream/super-productivity/`）。

### 2.1 包的规模

| 包 | src 行数 | 测试行数 | 运行时依赖 | 用途 |
|---|---|---|---|---|
| `@sp/sync-core` | **4,240** | 5,026 | `@noble/ciphers`, `hash-wasm` | op-log 原语、向量时钟、冲突解决、gzip、E2EE |
| `@sp/shared-schema` | **1,254** | 1,613 | `zod` v4 | schema 版本与迁移、SuperSync HTTP 契约 |
| `@sp/sync-providers` | **7,634** | 7,444 | `hash-wasm` | Dropbox / WebDAV / OneDrive / LocalFile / SuperSync / HTTP 提供者、PKCE |
| **三包合计（可复用面）** | **13,128** | 14,083 | — | — |
| `@super-productivity/super-sync-server` | 17,612（src+scripts） | 45,747 | fastify, prisma, @sp/* | 官方同步服务端（Node + Postgres） |

> 注：另有早期估算把 sync-core 记为 "9,285 行"，那是 **src + 测试** 的合计；src-only 为 4,240 行。

### 2.2 宿主依赖矩阵 —— 这是所有跨语言方案的真正约束

`sync-core` / `shared-schema` / `sync-providers` 的源码里**没有任何 `node:` 导入**（无 `fs` / `path` / `process`），这是好消息。但它们是**为 Web/JS 宿主写的**，依赖一批 Web 平台 API：

| 依赖的宿主能力 | 出现位置 | 缺失后果 |
|---|---|---|
| `WebAssembly` | `encryption/argon2.ts` → `hash-wasm` 的 `argon2id()` | **Argon2id 密钥派生直接不可用**。npm 上 `hash-wasm@4.12.0` 自述 "hand-tuned **WebAssembly** binaries (…, Argon2, …)" `[注册表]` |
| `crypto.subtle` / `crypto.getRandomValues` | `encryption/web-crypto.ts` | AES-GCM 有 `@noble/ciphers` 纯 JS 回退，**但 `getRandomBytes()` 强依赖 `crypto.getRandomValues`**，无回退 |
| `CompressionStream` / `DecompressionStream` | `compression.ts` | gzip 压缩不可用（源码按 `globalThis.CompressionStream` 特性探测） |
| `TextEncoder` / `TextDecoder` | `encryption/web-crypto.ts` 第 9–10 行 **模块顶层** `new TextEncoder()` | **导入即抛错**（不是运行时才失败） |
| `DOMParser` | `sync-providers/.../webdav-xml-parser.ts` | WebDAV / Nextcloud 的 XML 解析不可用（测试里用 `@xmldom/xmldom` 垫） |
| `fetch` | `super-sync/super-sync.ts` 等 | 所有 HTTP 型 provider 不可用 |

### 2.3 决定性事实：QuickJS 一个都不提供

我把 QuickJS 官方文档（`https://bellard.org/quickjs/quickjs.html`，2026-06-04 版，全文 776 行）抓下来做了全文计数：

| 关键词 | 全文出现次数 |
|---|---|
| `WebAssembly` | **0** |
| `TextEncoder` / `TextDecoder` | **0** |
| `atob` / `btoa` | **0** |
| `fetch` | **0** |
| `crypto` | **0** |

`[原文]` QuickJS 的 "Main Features" 只声明 "Almost complete **ES2025** support"，而 WebAssembly **不属于 ECMAScript 规范**（它是独立的 W3C 标准），因此不在这份支持清单里。文档的 "not supported yet" 列表也只提到 Tail calls 与 `Atomics.waitAsync`。

**含义**：把 `@sp/sync-core` 原样塞进 QuickJS，**在 `import` 阶段就会因 `new TextEncoder()` 失败**；即便补上垫片，Argon2id 仍会因无 WebAssembly 而失败。这不是调参问题，是能力缺失。

### 2.4 好消息：加密契约已被证明是语言无关的

`sync-core` 的加密线格式是**跨平台公开契约**，README 原文即写明，且上游注释直接要求 Kotlin 侧逐位一致：

```
base64( SALT(16) | IV(12) | AES-256-GCM ciphertext+tag(16) )
key = Argon2id(password, salt, p=1, t=3, m=64 MiB, len=32)
```

**上游自己已经做过一次跨语言移植**（Kotlin，Android 后台提醒 worker）：

| 文件 | 行数 |
|---|---|
| `android/.../crypto/Argon2.kt` | 371 |
| `android/.../crypto/Blake2b.kt` | 124 |
| `android/.../crypto/OpPayloadDecryptor.kt` | 138 |
| **合计** | **633** |

并且有 CI 级互操作验证：`LiveJsEncryptRoundTripTest.kt`（用实时生成的 JS 密文验证 Kotlin 解密）、`tools/generate-android-crypto-fixtures.mjs`（每次 CI 用真实 `sync-core.encrypt()` 产出固件，覆盖非 ASCII 密码与 Unicode 载荷）。

**另有独立实测**（本工作区 `research/deep-dive-cross-language.md`）：用 TS 版 `sync-core` 加密含中文与 emoji 的 JSON，再用 Python 的完全独立实现（`argon2-cffi` + `cryptography`）解密，明文逐位一致，`RESULT: ✅ 跨语言互通成功`。

> ⚠️ **必须精确区分**：上游只移植了加密层的**"读"**。实测 `SuperSyncBackgroundProvider.kt`（438 行）只做"轮询增量 → 解密 → 提取 `remindAt`/`deadlineRemindAt` → 排本地通知"；在整个 `android/app/src/main/java/` 下 grep `vectorClock|VectorClock|conflict` **零命中**。iOS 侧更彻底：`ios/` 只有 7 个 Swift 文件，全是插件，同步完全依赖 Capacitor WebView。**所以"上游移植过"≠"同步算法被移植过"。**

### 2.5 真正的移植面：包只占 5%

| 层次 | src 行数 | 说明 |
|---|---|---|
| 三个可复用包 | 13,128 | 纯算法与 provider |
| **app-side op-log（宿主耦合层）** | **51,708** | action 捕获、reducer、replay、持久化、冲突 UI、快照、验证 |
| 整个应用 src（非测试） | **243,391** | 35 个 reducer、全部实体模型与业务逻辑 |

op-log 是**单客户端同步管线**：持久化 NgRx action → reducer 更新投影 + 捕获为 durable operation → 向量时钟定序 → provider 上传。**把它换成 Dart/Kotlin，等于重写这 51,708 行以及它依赖的全部 reducer**。这是"移植到 Dart"方案最容易被低估的成本。

---

## 3. 七种方案逐一评估

### 方案 1：在 Dart/Flutter 中直接运行 JS/TS（flutter_js / QuickJS 绑定）

**机制**：用 FFI 把 JS 引擎嵌进 Flutter 进程，把编译后的 `sync-core` bundle 喂进去执行，Dart ↔ JS 通过桥接交换 JSON。

**生态实测（pub.dev，2026-09-25）** `[注册表]`：

| 包 | 最新版本 | 发布 | License | likes | 30 日下载 | 评估 |
|---|---|---|---|---|---|---|
| **`flutter_js`** | 0.8.7 | 2026-01-27 | MIT | **360** | **114,284** | 唯一有真实采用的；Android 用 QuickJS、**iOS 用 JavaScriptCore** |
| `quickjs_engine` | 0.1.5 | 2026-08-24 | MIT | 4 | 5,041 | QuickJS-NG 0.14.0，很新 |
| `quickjs_runtime` | 0.3.4 | 2026-09-25 | MIT | 0 | 5,456 | 纯 Dart FFI，当日发布 |
| `jsf` | 1.1.0 | 2026-06-30 | MIT | 16 | 2,848 | — |
| `fjs`（fluttercandies） | 3.3.0 | 2026-07-18 | MIT | 24 | 608 | Rust + QuickJS |
| `flutter_qjs` | 0.3.7 | **2022-05-19** | MIT | 31 | 63 | **停更 4 年** |
| `node_flutter` | 0.0.4 | 2025-04-24 | MIT | 8 | 23 | 几乎无采用 |
| `flutter_jscore` | 1.0.0 | **2021-06-06** | MIT | 41 | 47 | 停更 5 年 |

GitHub 侧：`abner/flutter_js` **542★**、MIT、最近提交 2026-01-27 `[元数据]`。

**可行性判断**：

- ❌ **硬阻塞**：`sync-core` 需要 WebAssembly（Argon2id）。QuickJS 不提供（§2.3）。→ 必须**替换掉 Argon2id 实现**（走 Dart 侧 FFI 或平台原生），此时"直接跑 TS"的复用度已经打折。
- ❌ **模块顶层即失败**：`new TextEncoder()` 在 import 时执行，QuickJS 无此全局对象，需垫片。
- ⚠️ **iOS 走 JavaScriptCore**，而 iOS 第三方 App 的 JSC **没有 JIT 权限**；Argon2id 的默认参数是 64 MiB × 3 轮，`sync-core` 自己注释说原生都要 **500 ms–2 s**，解释执行会慢一个数量级，移动端可能到**数十秒**，产品上不可接受。
- ⚠️ **维护性**：除 `flutter_js` 外全是个位数 likes 的孤岛项目；`flutter_js` 自身 release 停留在 `0.8.3`（2025-05-04）而版本已到 0.8.7，说明发版节奏松散。
- ⚠️ **无 Web 目标**：`flutter_js` 平台标签只有 android/ios/windows/linux/macos，**没有 web**，与"全平台"目标不符。
- ⚠️ 双运行时 = 双份内存 + 双份 GC，包体增大。

**推荐度：⭐⭐（2/5）—— 不推荐作为主路径。**
**一句话结论**：这条路看起来"零移植"，但上游依赖的 WebAssembly 与 Web API 恰好是 QuickJS 全都不提供的，结果是"既要垫片、又要替换加密、还要忍受解释器性能"，**付出的复杂度不比直接移植少，却换来一个更难调试的双运行时**。

---

### 方案 2：移植（port）到 Dart

**机制**：手工把 TS 逻辑重写为 Dart。分两块：加密层（可照规格实现）与同步算法（需重写）。

**工作量评估（基于 §2.5 实测）**：

| 部分 | 规模 | 难度 | 依据 |
|---|---|---|---|
| 加密层（Argon2id + AES-GCM + 线格式） | ~633 行（对标 Kotlin 先例） | 🟢 低 | 上游 Kotlin 移植即此规模，且有 CI 固件模式可照搬 |
| 同步算法（向量时钟、冲突解决、上传/下载规划、replay 协调） | `sync-core` 4,240 行中约 2,400 行 | 🟡 中 | 算法小但**必须逐位一致**，否则静默毁数据 |
| provider 层（WebDAV / Dropbox / OneDrive / SuperSync） | 7,634 行 | 🟡 中 | Dart 侧 WebDAV 有包但很小（见 §5.3） |
| **宿主 op-log 层** | **51,708 行** | 🔴 **高** | 与 UI 框架强耦合，等于重写 |

**社区先例（op-log / CRDT 引擎的 Dart 实现）**：
- Dart 侧**没有**成熟的 CRDT/op-log 引擎可直接抄。同类思路的 Dart 实现均无规模（见 §2.1 与 §5 各表）。
- 反面证据：连**加密层**这种最"照规格即可"的部分，Dart 生态都缺现成件 —— pub.dev 上纯 Dart 的 `argon2` 包停在 **2021-06-18**（4 年未更新），因此推荐走 **libsodium FFI**（`sodium` 包，4.1.1+1 @ 2026-09-24）。
- **正面证据**：`mhabit`（Flutter，**1596★**，Apache-2.0，提交 2026-09-23）是一个覆盖 Android/iOS/Windows/macOS/Linux + WebDAV 同步 + local-first 的真实全平台 Flutter 应用 —— 证明"Flutter 写全平台任务/习惯类 App"本身可行，只是它的同步是自建的。

**优点**：类型安全、无跨语言边界、可完全掌控、与 Flutter 生态一致。
**缺点**：① 必须建立**跨语言一致性测试**（照搬 `generate-android-crypto-fixtures.mjs` 模式）才能防住 KDF 参数漂移；② 上游持续演进（HEAD 就在调研当日有提交），移植版会**永久落后**，且每次上游改 schema 都要手工同步；③ Argon2id 性能必须靠 FFI 解决。

**推荐度：⭐⭐⭐（3/5）—— 可行，但必须分阶段，且不是"复用"而是"重写"。**
**一句话结论**：加密层可以照抄 Kotlin 先例（633 行量级，风险可控），但同步算法与 5.1 万行 op-log 宿主层要自己重写，**真正的成本不在"能不能移植"，而在"移植后如何跟上上游"**。

---

### 方案 3：用 FFI 调本机二进制

这条要拆成两个子问题，结论完全不同。

**3a. 把 TS 编译成原生可执行文件（Bun / Deno compile / Node SEA）**

| 工具 | 交叉编译目标（官方文档原文） | 能否覆盖 iOS/Android |
|---|---|---|
| **Bun** `--compile --target=` | `bun-linux-x64` / `bun-linux-arm64` / `bun-windows-x64` / `bun-windows-arm64` / `bun-darwin-x64` / `bun-darwin-arm64`（+ musl 变体）`[原文]` | ❌ **不能** |
| **Deno** `--target` | `x86_64-pc-windows-msvc` / `aarch64-pc-windows-msvc` / `x86_64-apple-darwin` / `aarch64-apple-darwin` / `x86_64-unknown-linux-gnu` / `aarch64-unknown-linux-gnu` `[原文]`，并声明 "Deno supports cross compiling to all targets regardless of the host platform" | ❌ **不能** |
| **Node SEA** | 无交叉编译；且官方限制：`"useVfs": true` 不能与 `"useSnapshot"`/`"useCodeCache"` 同用，**Native addons（`.node`）无法直接从 VFS 加载**（`process.dlopen()` 需要真实文件）`[原文]` | ❌ 不能，且限制更多 |

**结论**：这三个工具都只能产出**桌面/服务端**可执行文件，**没有移动目标**。它们解决不了本项目的核心平台需求。

> 附带发现：Deno 支持 `--engine quickjs` 来产出更小的二进制，但官方明确警告 QuickJS 后端**实验性、不接收与 V8 同等的安全更新、且是无 JIT 解释器、计算密集代码更慢** `[原文]` —— 这与 §2.3 的判断相互印证。

**3b. 用 Rust/Go 重写核心逻辑，再通过 FFI 调用**

- 这**不是复用**，而是"用另一种语言重写一遍"，工作量与方案 2 同量级（只是目标语言不同）。
- 唯一真正的增益场景：**只重写加密层**（Rust 有成熟的 `argon2` / `aes-gcm` crate），把它做成 FFI 库供 Dart/Kotlin/Swift 共用，而同步算法留在各自语言。
- ⚠️ **iOS 侧约束**：不能依赖运行时 JIT 或动态下载可执行代码（App Store 政策），因此 FFI 必须是**随包分发的静态/动态库**，不能"编译后下发"。

**推荐度：⭐⭐（2/5）**（作为"直接复用 TS"的手段）；若仅用于**替换 Argon2id 的性能瓶颈**，可局部升为 ⭐⭐⭐⭐。
**一句话结论**：把 TS 编译成原生这条路**在移动端根本不存在**（三大工具都没有 iOS/Android 目标），而"重写核心 + FFI"本质是方案 2 的变体，不构成独立的复用捷径。

---

### 方案 4：本地 sidecar 进程（UI 通过 localhost HTTP 通信）

**这是很多本地优先应用的做法吗？—— 在桌面端是，在移动端不是。**

**桌面端真实案例（可核实）**：

| 案例 | 架构事实 | 来源 |
|---|---|---|
| **Syncthing** | 守护进程暴露 REST 接口："Syncthing exposes a REST interface over HTTP on the GUI port… `http://localhost:8384/rest/...`"，需要 API Key `[原文]`。GUI 就是通过它控制 daemon 的 | docs.syncthing.net/dev/rest.html |
| **Joplin** | 桌面端提供 localhost 数据 API 供外部客户端访问（`56480★`，活跃） `[元数据]` | github.com/laurent22/joplin |
| **Super Productivity 自身** | 提供 `packages/super-sync-server`（Fastify + Prisma + Postgres + WebSocket），`docker-compose.supersync.yaml` 可本地起 —— **这正是"sidecar 可选形态"的现成实现** | 本地源码 |

**移动端的致命约束** `[原文]`：

我查了 Apple 官方文档中 Foundation 的 `Process` 类（描述为 "An object that represents a subprocess of the current process"），其**平台列表只有 macOS 10.0 与 Mac Catalyst 13.0 —— 没有 iOS / iPadOS / tvOS / watchOS**。也就是说 **iOS 上不存在受支持的"启动子进程"API**。

因此移动端**不存在真正的 sidecar**；移动端可行的形态是**同进程内嵌**（in-process embedding），而这也正解释了这类项目的存在理由：
- **`nodejs-mobile/nodejs-mobile`** —— "a toolkit for integrating Node.js into mobile applications"，**871★**，MIT（LICENSE 为 Node.js 标准 MIT 文本）`[原文]`，但最近提交 **2025-11-13**、最新 release `v18.20.4` @ **2024-10-07**，**已明显放缓**。

**其他代价**：包体增大（要带一整个 JS/Node 运行时）、双运行时内存、进程/线程生命周期管理（Android Doze、后台被杀）、端口占用与本地端口安全（需 token 鉴权）、桌面端还需处理防火墙提示。

**推荐度：⭐⭐（2/5）—— 桌面可行，移动端不成立，与"全平台"目标冲突。**
**一句话结论**：sidecar 是**桌面端**成熟的工程模式（Syncthing 就是范例），但 iOS 官方根本不提供启动子进程的 API，所以它无法成为覆盖六平台的统一架构；移动端只能退化为"同进程内嵌运行时"，而那又回到了方案 1 的性能与维护问题。

---

### 方案 5：服务端权威架构（客户端只做最薄缓存）

**机制**：所有同步逻辑、冲突解决、排序都放服务端；客户端只负责渲染与本地缓存（读写走 API）。

**取舍分析**：

| 维度 | 影响 |
|---|---|
| "本地优先"特性 | 🔴 **大部分丧失**：离线只能读缓存，无法离线写入并保证收敛；跨设备实时性依赖网络；自托管/无账号模式难以成立 |
| 工程成本 | 🟢 **最低**：无需跨语言，客户端任意语言都能做（纯 REST/WS 客户端） |
| 冲突解决 | 🟢 简单（服务端串行化 + 乐观并发控制） |
| 数据主权 | 🔴 与"隐私优先/本地优先"的产品叙事冲突 |

**上游的权威论证（最值得引用的一段）**：Super Productivity 在 `ARCHITECTURE-DECISIONS.md` **ADR #10「Vector Clocks over Server-Side Entity Versioning」**中，**完整设计过**服务端实体版本化（即"每个集中式 API 都在用的乐观并发控制"），然后**明确决定不建**，理由原文 `[原文]`：

> - **It would make the server the source of truth, not just the referee.** The SuperSync server already detects conflicts… but it does so by comparing clocks the _clients_ authored — the causal history stays client-owned. Entity versioning moves that authority into the server. **File-based providers (WebDAV, Dropbox, local file) have no server to run it, so the vector-clock path must survive regardless, and we would maintain two conflict systems instead of one.**
> - **The migration is the expensive half.** It needs a new server table, a wire protocol change, a backfill for every existing entity, and a mixed-fleet window…

这段话点出了服务端权威方案的**真实代价**：一旦你支持文件型同步（WebDAV / Dropbox / 本地文件），**你仍然需要客户端侧的因果逻辑**，于是你要**同时维护两套冲突系统**。

**行业对照**：滴答清单、Todoist 这类产品本身就是服务端权威的（云端为准 + 本地缓存）。所以方案 5 的准确描述不是"不可行"，而是 **"等于放弃本地优先这个卖点，去做又一个滴答清单"**。

**推荐度：⭐⭐（2/5）**（对"本地优先"产品）；若明确放弃本地优先，则为 **⭐⭐⭐⭐（4/5）**（工程上最省）。
**一句话结论**：这是**工程上最省、产品上最贵**的选择；只要你还想支持 WebDAV/本地文件同步，就仍得在客户端维护因果逻辑，反而变成两套冲突系统 —— 上游 ADR #10 已把这个结论写成文档。

---

### 方案 6：React Native / Electron 路线（客户端本身就在 JS 生态）

**核心事实：如果客户端是 JS 生态，复用成本接近零 —— 而且这条路已被上游自己验证到生产级。**

**Super Productivity 的实测平台策略**（本地源码）：
- `capacitor.config.ts` 存在，`appId: com.super-productivity.app`，`webDir: dist/browser` → **移动端是 Capacitor（WebView 套壳）**
- `android/` 是完整原生工程；`ios/` 存在但只有 7 个 Swift 文件（插件）
- `electron/` + `electron-builder.yaml` → **桌面端是 Electron**
- build 脚本覆盖 `dist:android`、`dist:win`、`dist:linuxAndWin`、`dist:mac:mas`、`buildFrontend:prodWeb` → **六平台全覆盖**

**各框架平台覆盖实测** `[元数据]`：

| 框架 | Star | License | 平台覆盖（实测） |
|---|---|---|---|
| **React Native** | **126,724** | MIT | 一等公民只有 **iOS + Android**；`react-native-windows` **17,347★** MIT（活跃，当日有提交）、`react-native-macos` **4,386★** MIT（活跃但 release `v0.81.9` 落后主干约 7 个小版本） |
| RN 的 **Linux** | — | — | ❌ **没有官方目标**。`github.com/microsoft/react-native-linux` 返回 **HTTP 404**；社区 `lucid-softworks/react-native-linux` 仅 **32★**、无 release |
| **Electron** | — | — | 仅桌面（Win/macOS/Linux），**不含移动/Web** |
| **Tauri** | **111,382** | **Apache-2.0 OR MIT** | 官方原文："Tauri is a framework for building tiny, fast binaries for all major **desktop and mobile** platforms" `[原文]`；v2.0 stable 于 2024-10-02 发布（最新 tag 已是 `v3.0.0-alpha.2`，生产应锁 v2） |
| **Capacitor** | — | — | iOS + Android + Web（上游实践） |

**"零成本复用"是否成立？—— 基本成立**：`sync-core`、`sync-providers`、`shared-schema` 以及那 51,708 行 op-log 全部可直接使用或直接参考，**没有跨语言边界**。这是七个方案里唯一做到这一点的。

**代价（必须诚实说明）**：
- 移动端是 **WebView 套壳**，重列表/复杂手势的性能与原生手感有差距；
- **iOS 后台同步能力受限** —— 上游的做法就是只在 **Android** 写了原生后台 worker（`SuperSyncBackgroundProvider.kt` 438 行），iOS 完全依赖 WebView 生命周期；
- RN 若要走 Windows/macOS，需要 `react-native-windows` / `react-native-macos` 两套 out-of-tree 平台，且 **Linux 无官方方案**；
- Tauri 的移动端较新（v2 起），成熟度低于 Capacitor/Electron。

**推荐度：⭐⭐⭐⭐⭐（5/5）—— 若目标是"最大复用 + 最小重造轮子"，这是唯一满分级答案。**
**一句话结论**：**客户端留在 JS/TS 生态 = 复用度接近 100% 且零跨语言风险**，Super Productivity 已用 Angular + Capacitor + Electron 把这条路跑到六平台生产级；代价是 WebView UI 与 iOS 后台限制，而不是同步栈的正确性风险。

---

### 方案 7：Kotlin Multiplatform（KMP）

**关键问题：KMP 能否消费 TS？—— 只有 Web 目标能，原生端不能。**

我读了两份 Kotlin 官方互操作文档 `[原文]`：

| 目标 | 能否直接用 TS/npm 包 | 机制 |
|---|---|---|
| **Kotlin/JS（Web）** | ✅ 可以 | Kotlin/JS 文档原文提到可通过 Gradle "adding JavaScript dependencies directly from **npm**"；用 `external` 声明描述 JS API |
| **Kotlin/Wasm（Web）** | ✅ 可以 | `wasm-js-interop.html` 原文："Kotlin/Wasm allows you to use both JavaScript code in Kotlin and Kotlin code in JavaScript"。**但该页顶部明确标注 Kotlin/Wasm is Beta："It may be changed at any time. Use it in scenarios before production."** |
| **Kotlin/Native（iOS / Android 原生 / 桌面原生）** | ❌ **不能** | Kotlin/Native 的互操作**只有 C 与 Swift/Objective-C**（经 `cinterop`），官方 native 互操作文档中**没有任何 JavaScript 运行时或 JS interop** |

**结论**：**"KMP 外壳 + TS 同步内核"这个架构只在 Web 端成立，在 iOS/Android 原生端不成立** —— 与 Dart 一样，必须移植。

**KMP 自身的成熟度**（JetBrains 官方稳定性表，`[原文]`）：

| 平台 | 核心 KMP 代码共享 | Compose Multiplatform UI |
|---|---|---|
| Android | **Stable** | **Stable** |
| iOS | **Stable** | **Stable** |
| Desktop (JVM) | **Stable** | **Stable** |
| Server-side (JVM) | **Stable** | — |
| Web based on Kotlin/Wasm | **Beta** | **Beta** |
| Web based on Kotlin/JS | **Stable** | — |
| watchOS / tvOS | Beta | — |

即 **Compose Multiplatform 的 Web 端仍是 Beta**，而"全平台"要求里 Web 是必选项。

**KMP 的真实案例**：`igorescodro/alkaa` —— **1,645★**，Apache-2.0，KMP + Compose Multiplatform 的任务管理 App（Android + iOS），提交 2026-05-25 `[元数据]`。这是 KMP 做 todo 类应用的最佳正面证据（但**不含 Web/桌面**）。
（反例：`msasikanth/twine` 2,414★ 是 KMP + Compose 的数据密集型应用，但 🟥 **GPL-3.0，代码不可用于闭源产品**。）

**KMP 的优势**：SQLDelight（Apache-2.0，6,885★）是 KMP 侧最成熟的数据库方案；Android/iOS/桌面三端 Stable。

**推荐度：⭐⭐（2/5）**（针对"复用 TS 同步栈"这个目标）；若只做 Android+iOS 且愿意移植，可到 ⭐⭐⭐。
**一句话结论**：**KMP 不能消费 TS**（原生端互操作只有 C/ObjC），所以它和 Dart 面临完全相同的"必须移植"命运，却没有换来 Web 端的稳定支持（Compose Web 仍是 Beta）。

---

## 4. 七方案汇总评级与首选建议

| # | 方案 | 复用度 | 跨语言风险 | 全平台覆盖 | 评级 | 一句话结论 |
|---|---|---|---|---|---|---|
| 1 | Dart 里跑 JS/TS（QuickJS） | 中（加密需替换） | 🔴 高 | ⚠️ 无 Web 目标 | ⭐⭐ | QuickJS 恰好不提供上游依赖的 WASM 与 Web API，垫片+替换后复杂度不低于移植 |
| 2 | 移植到 Dart | 低（=重写） | 🟡 中 | ✅ 六端（Flutter Web 有三条官方约束） | ⭐⭐⭐ | 加密层有 Kotlin 蓝本可照抄，但 5.1 万行 op-log 与"跟上上游"是真成本 |
| 3 | FFI 调本机二进制 | 低 | 🟡 中 | ❌ Bun/Deno/Node SEA **均无移动目标** | ⭐⭐ | "把 TS 编译成原生"在移动端不存在；重写+FFI 是方案 2 的变体 |
| 4 | 本地 sidecar | 高（桌面） | 🟢 低 | ❌ **iOS 无子进程 API** | ⭐⭐ | 桌面端成熟（Syncthing 为范例），移动端不成立 |
| 5 | 服务端权威 | 低 | 🟢 低 | ✅ | ⭐⭐（本地优先）/ ⭐⭐⭐⭐（放弃本地优先） | 工程最省、产品最贵；上游 ADR #10 已论证会变成"两套冲突系统" |
| 6 | **JS 生态客户端（RN/Electron/Capacitor/Tauri）** | **~100%** | 🟢 **无** | ✅ | ⭐⭐⭐⭐⭐ | 唯一做到零跨语言边界，上游已用 Capacitor+Electron 跑通六平台 |
| 7 | Kotlin Multiplatform | 低 | 🟡 中 | ⚠️ Compose Web 仍 Beta | ⭐⭐ | 原生端只有 C/ObjC 互操作，**消费不了 TS**，只能移植 |

### 4.1 首选方案（目标：全平台 + 最大复用 + 最小重造轮子）

> **首选：客户端留在 JS/TS 生态 —— Web 一套代码 + Capacitor（iOS/Android）+ Electron 或 Tauri 2（Windows/macOS/Linux）。**

**理由（按权重排序）**：

1. **复用度是唯一接近 100% 的方案**：`sync-core` / `sync-providers` / `shared-schema` 直接可用，51,708 行 op-log 可直接引入或直接参考语义，**完全不存在跨语言一致性风险**。
2. **有生产级先例**：Super Productivity 就是 Angular + Capacitor + Electron 覆盖六平台，本报告的平台结论全部由它的实际配置与构建脚本佐证。
3. **本地优先天然成立**：数据先落 IndexedDB/SQLite，同步是 op-log 增量；WebDAV / Dropbox / 本地文件 / 自建服务端四种 provider 都可直接用。
4. **"最小重造轮子"**：不需要重写 Argon2id、不需要建跨语言固件测试、不需要为每个平台各写一套同步。

**具体落地建议**：

| 平台 | 推荐载体 | 说明 |
|---|---|---|
| Web | 原生 Web 构建 | 上游 `buildFrontend:prodWeb` 即此模式 |
| iOS / Android | **Capacitor**（已被上游验证）或 **Tauri 2** | Capacitor 更成熟；Tauri 2 更现代、体积更小，但移动端较新 |
| Windows / macOS / Linux | **Electron**（上游已验证）或 **Tauri 2** | Electron 包体大但生态最稳；Tauri 2 体积小、许可 Apache-2.0 OR MIT |

**若 UI 必须是 Flutter 或 KMP（即接受放弃最大复用）**，则按以下顺序降级：

1. **先只移植加密层**（633 行量级，有 Kotlin 蓝本 + CI 固件模式），Argon2id 走**平台原生 FFI**（Dart 用 `sodium`/libsodium，KMP 用 JVM/native 原生实现）解决性能。
2. **同步算法分阶段移植**，并为每一步建立**跨语言往返测试**（照搬 `tools/generate-android-crypto-fixtures.mjs`：TS 侧产出固件，目标语言解密/比对，CI 每次跑）。这是唯一能防住 KDF/线格式漂移的手段。
3. **接受"移植版永久落后上游"**这一维护负担，或直接 fork 上游并在 fork 内维护。

---

# 第二部分：可复用开源组件盘点

> **通用免责**：以下 License 结论均来自实际读取 LICENSE 原文或包注册表声明。**"闭源商用"判定只针对许可条款本身，不构成法律意见**；AGPL/GPL 类依赖在"独立自托管服务"与"嵌入分发"两种用法下结论不同，表中已逐项区分。
> **符号约定**：✅ = 允许闭源商用｜⚠️ = 有条件（已注明条件）｜🟥 = **禁止或高风险，需法务介入**

## 5. 逐类组件

### 5.1 RRULE / 重复任务引擎

| 组件 | 仓库 URL | Star（实测） | License（精确 SPDX） | 语言 | 最近提交/发布 | 闭源商用？ | 备注 |
|---|---|---|---|---|---|---|---|
| **rrule.js** | https://github.com/jkbrzt/rrule | **3,744** | **BSD-3-Clause** | TypeScript | 提交 **2023-11-10**；npm `rrule@2.8.1` @ 2023-11-10 | ✅ | npm 与 `package.json` 均声明 BSD-3-Clause；许可文件名是 **`LICENCE`**（英式拼写），故 GitHub 侧栏误显 `Other`。**停滞约 3 年** |
| **python-dateutil**（`rrule` 模块） | https://github.com/dateutil/dateutil | **2,636** | **BSD-3-Clause AND Apache-2.0**（双许可） | Python | 提交 2026-05-19；`2.9.0` @ 2024-03-01 | ✅ | 服务端首选 |
| **rust-rrule** | https://github.com/fmeringdal/rust-rrule | **95** | **MIT OR Apache-2.0** `[注册表]` | Rust | 提交 2025-04-20；crates `rrule@0.14.0` @ 2025-04-20 | ✅ | crates.io 为权威（GitHub 侧栏只显示 Apache-2.0） |
| **Dart `rrule`** | https://github.com/JonasWanke/rrule | **58** | **Apache-2.0** | Dart | 提交 2026-01-06；pub `0.2.18` @ 2026-01-06 | ✅ | **Dart 侧最活跃完整的 RFC 5545 引擎** |
| `teno_rrule` | https://github.com/hnvcam/teno_rrule | 4 | **MIT** | Dart | pub `0.0.10` @ 2026-03-17 | ✅ | 采用度低，0.0.x |
| `rrule_generator` | https://github.com/tkortekaas/rrule_generator | 11 | **ISC** | Dart/Flutter | pub `0.10.1+2` @ 2026-08-04 | ✅ | **仅 UI 生成器**，不做日期计算 |
| `recurrence_picker` | https://github.com/Huluk/flutter_recurrence_picker | 未核实 | **BSD-3-Clause** `[注册表]` | Dart/Flutter | pub `0.3.0` @ 2026-04-21 | ✅ | Flutter RRULE UI 组件 |
| `teambition/rrule-go` | https://github.com/teambition/rrule-go | **382** | **MIT** | Go | 提交 **2023-04-01**；`v1.8.2` @ 2023-01-13 | ✅ | Go 生态唯一有用户的实现，但**已停更**；README 自述基于 **RFC 2445**（已被 5545 取代） |
| 其他 Go 实现 | `stephens2424/rrule`(17★)、`JulienBreux/rrule-go`(26★)、`lingsamuel/go-rrule`(4★)、`Xyedo/rrule`(1★) | 1–26 | BSD-3 / MIT | Go | 2017–2024 | ✅ | **全部接近废弃** |
| 🟥 `python-recurring-ical-events` | https://github.com/niccokunzmann/python-recurring-ical-events | 121 | 🟥 **LGPL-3.0** | Python | 提交 2026-09-23 | 🟥 **禁止作为可分发闭源依赖** | 弱传染，但闭源分发仍有义务 |

**RFC 5545 符合度**：`rrule.js` README 自述"遵从 RFC 5545，**但存在若干重要差异**"；`rust-rrule` 声明遵循 RFC-5545（覆盖 RRULE/RDATE/EXRULE/EXDATE）；`teambition/rrule-go` 是 RFC 2445 部分移植；Dart 侧仅有声明级证据，无逐条符合度矩阵。

**结论**：**以 RFC 5545 RRULE 字符串为唯一真相源**，客户端 Dart 用 `rrule`(Apache-2.0) + `rrule_generator`(ISC)，服务端 Python 用 `dateutil.rrule`(BSD/Apache)，JS 侧用 `rrule.js`(BSD-3)，Rust 用 `rrule`(MIT OR Apache-2.0)。**Go 是短板**（需自建或接受停更库）。⚠️ **没有任何引擎内建中文 RRULE 文本输出**，中文描述（"每周三"）必须自建 i18n 层。

---

### 5.2 自然语言日期解析（含中文支持）

| 组件 | 仓库 URL | Star（实测） | License（精确 SPDX） | 语言 | 最近提交/发布 | 闭源商用？ | 中文支持 |
|---|---|---|---|---|---|---|---|
| **chrono-node** | https://github.com/wanasit/chrono | **5,287** | **MIT** | TypeScript | 提交 2026-09-22；npm `2.10.1` @ 2026-07-20 | ✅ | ✅ **实测存在** `src/locales/zh/hans/` 与 `zh/hant/`，含 7 个中文 parser |
| **dateparser** | https://github.com/scrapinghub/dateparser | **2,862** | **BSD-3-Clause** | Python | 提交 2026-09-23；PyPI `1.4.3` @ 2026-09-03 | ✅ | ✅ **实测存在** `zh.py`/`zh-Hans.py`/`zh-Hant.py`；README 有 `2小时前` 示例 |
| `parsedatetime` | https://github.com/bear/parsedatetime | 711 | **Apache-2.0** | Python | 提交 2024-08-08；`2.6` @ 2020-05-31 | ✅ | 未核实（约 6 年未发版） |
| `chrono-english` | https://github.com/stevedonovan/chrono-english | 60 | **MIT** `[注册表]` | Rust | 提交 2026-08-26 | ✅ | ❌ 英语 |
| `dtparse` | https://github.com/bspeice/dtparse | 52 | **Apache-2.0** `[注册表]` | Rust | 提交 2024-08-18 | ✅ | ❌ |
| `olebedev/when` | https://github.com/olebedev/when | **1,461** | **Apache-2.0** | Go | 提交 2026-08-10 | ✅ | ❌ 无中文 |
| `araddon/dateparse` | https://github.com/araddon/dateparse | **2,142** | **MIT** | Go | 提交 **2021-04-29** | ✅ | ❌ **不是 NL 解析**，是格式嗅探 |
| `facebook/duckling` | https://github.com/facebook/duckling | **4,324** | **BSD-3-Clause** | Haskell | 提交 2026-03-15 | ✅ | ❌ **实测 `Duckling/Time/` 下无 ZH 目录** |
| `chrono_dart` | https://github.com/g-30/chrono_dart | 15 | **MIT** `[注册表]` | Dart | 提交 2024-08-13 | ✅ | ⚠️ chrono-node 的 Dart 移植，**2 年未更新** |
| `universal_date_parser` / `any_date` | https://github.com/pragneshkoli/universal_date_parser / https://github.com/gbassisp/any_date | 0 / 6 | MIT / BSD-3-Clause | Dart | 2026-05 / 2026-03 | ✅ | ❌ 格式嗅探，非 NL |
| **6tail lunar 系列** | [lunar-javascript](https://github.com/6tail/lunar-javascript) **1,686★** / [lunar-java](https://github.com/6tail/lunar-java) **970★** / [lunar-python](https://github.com/6tail/lunar-python) **662★** / [lunar-flutter](https://github.com/6tail/lunar-flutter) **213★** | — | **全部 MIT** | JS/Java/Python/Dart | 2025-11 ~ 2026-01 | ✅ | 农历/干支/节气转换（**非 NL 解析**），Dart 侧农历首选 |
| **cn2an** | https://github.com/Ailln/cn2an | **768** | **MIT** | Python | 提交 2026-04-23 | ✅ | 中文数字↔阿拉伯数字，**中文 NL 解析的关键预处理件** |
| 🟥 `chinese-datetime-parser` | https://github.com/crapthings/chinese-datetime-parser | 0 | 🟥 **无 License 声明** | JS | 提交 2026-09-16 | 🟥 **禁止**（无许可=保留全部权利） | — |
| 🟥 `cntime-nlp` | https://github.com/taccisum/cntime-nlp | 1 | 🟥 **无 License 声明** | Python | 提交 2024-05-08 | 🟥 **禁止** | — |

**中文支持结论**：
- ✅ **相对时间（"明天"/"下周三"/"2小时前"）有两条成熟路径**：Web/服务端用 `chrono-node`(MIT) 或 `dateparser`(BSD-3)。
- ❌ **Dart 端无成熟 NL 方案**（最好的 `chrono_dart` 仅 15★ 且 2 年未更新）→ **建议把 NL 解析放服务端或 JS 层**。
- ❌ **"每月5号"/"月底"属于 RRULE 语义，无现成中文库**，映射层必须自建。

---

### 5.3 CalDAV / WebDAV 客户端 与 CalDAV 服务端

> 🔴 **本类目是法律风险最集中的地方**，且项目当前使用的 `@nextcloud/cdav-library` 已确认必须替换。

**客户端**

| 组件 | 仓库 URL | Star（实测） | License（精确 SPDX） | 语言 | 最近提交/发布 | 闭源商用？ |
|---|---|---|---|---|---|---|
| 🟥 `@nextcloud/cdav-library` | https://github.com/nextcloud/cdav-library | 73 | 🟥 **AGPL-3.0-or-later** | JavaScript | 提交 2026-09-22；`v2.8.0` @ 2026-09-01 | 🟥 **禁止嵌入**（网络条款传染）。**双重确认**：npm `package.json` 字段 + 仓库 LICENSE 全文 |
| ✅ **`tsdav`（推荐替代品）** | https://github.com/natelindev/tsdav | **355** | **MIT** | TypeScript | 提交 2026-09-19；`v2.3.4` @ 2026-09-19 | ✅ **JS 生态最佳替代**。WebDAV + CalDAV + CardDAV，浏览器 + Node/Deno |
| `webdav` | https://github.com/perry-mitchell/webdav-client | **818** | **MIT** | TypeScript | 提交 2026-09-19；`v5.11.0` @ 2026-09-19 | ✅ ⚠️ **仅 WebDAV，不含 CalDAV** |
| `ts-caldav` | https://github.com/KlautNet/ts-caldav | 29 | **MIT** | TypeScript | 提交 2026-08-23；`v0.4.2` | ✅ 社区小；描述含 "calendars, events, and **tasks**" |
| `python-caldav` | https://github.com/python-caldav/caldav | **413** | **Apache-2.0** | Python | 提交 2026-09-21；`v3.3.1` | ✅ 成熟 |
| `vdirsyncer` | https://github.com/pimutils/vdirsyncer | **1,880** | **BSD-3-Clause** | Python | 提交 2026-09-03；`v0.21.0` | ✅ topics 含 `vtodo` |
| `khal` | https://github.com/pimutils/khal | **3,056** | **MIT** | Python | 提交 2026-09-23 | ✅ 是否支持 VTODO **未核实** |
| `dav4jvm` | https://github.com/bitfireAT/dav4jvm | 104 | **MPL-2.0** | Kotlin | 提交 2026-09-24；`4.1.0` | ✅（文件级 copyleft）JVM/Kotlin 首选 |
| 🟥 `davx5-ose` | https://github.com/bitfireAT/davx5-ose | **2,897** | 🟥 **GPL-3.0** | Kotlin | 提交 2026-09-24 | 🟥 **禁止嵌入**（底层库 `dav4jvm` 是 MPL-2.0，可单独用） |
| `go-webdav` | https://github.com/emersion/go-webdav | **498** | **MIT** | Go | 提交 2026-06-28；`0.7.0` | ✅ |
| `libdav` | https://git.sr.ht/~whynothugo/libdav | 未核实（非 GitHub） | **ISC** `[注册表]` | Rust | crates `0.11.0` @ 2026-09-05 | ✅ |
| 🟥 `minicaldav` | https://gitlab.com/floers/minicaldav | 未核实（GitLab） | 🟥 **GPL-3.0-or-later** `[注册表]` | Rust | crates `0.8.0` @ 2023-07-02 | 🟥 **禁止嵌入**，已停更 |
| Dart `caldav` | https://github.com/ssyuk/caldav | **1** | **MIT** `[注册表]` | Dart | pub `1.5.0` @ 2026-06-13 | ✅ ⚠️ 社区极小 |
| Dart `webdav_client` | https://github.com/flymzero/webdav_client | 67 | **BSD-3-Clause** `[注册表]` | Dart | pub `1.2.2` @ **2024-05-12** | ✅ ⚠️ 仅 WebDAV，2024 后无发布 |
| Dart `webdav` | https://github.com/timestee/dart-webdav | 未核实 | **Unlicense** `[注册表]` | Dart | pub `1.0.8-dev` @ **2020-07-06** | ✅ ⚠️ 不建议 |

**服务端**（⚠️ 关键区分：**独立自托管 ≠ 嵌入分发**）

| 组件 | 仓库 URL | Star（实测） | License（精确 SPDX） | 语言 | 闭源商用？ |
|---|---|---|---|---|---|
| ✅ **SabreDAV** | https://github.com/sabre-io/dav | **1,723** | **BSD-3-Clause** | PHP | ✅ **唯一可任意嵌入/打包进闭源产品的成熟 CalDAV 服务端** |
| 🟥 **Radicale** | https://github.com/Kozea/Radicale | **5,044** | 🟥 **GPL-3.0** | Python | ⚠️ **作为独立服务自托管（HTTP 通信）OK；嵌入/再分发其代码 ❌** |
| 🟥 **Baikal** | https://github.com/sabre-io/Baikal | **3,320** | 🟥 **GPL-3.0** | PHP | ⚠️ 同上（App 层 GPL，底层 SabreDAV 库 BSD，**两者许可不同，勿混用**） |
| 🟥 **Stalwart** | https://github.com/stalwartlabs/stalwart | **14,804** | 🟥 **AGPL-3.0-only 或专有 SELv2**（双许可） | Rust | 🟥 禁止嵌入；独立自托管亦受 AGPL 网络条款约束 |
| 🟥 Nextcloud Server | https://github.com/nextcloud/server | **36,910** | 🟥 **AGPL-3.0** | PHP | 🟥 禁止嵌入（与 `cdav-library` 同源） |

**结论**：**替换 `@nextcloud/cdav-library` → `tsdav`（MIT，355★，活跃）**。若需要同时覆盖纯 WebDAV，可搭配 `webdav`（MIT，818★）。服务端若必须可打包分发，**只有 SabreDAV 是安全选择**；Radicale/Baikal 只能以"独立自托管服务"形式使用（不与你的代码形成衍生作品）。

---

### 5.4 iCal / ICS 解析（重点是 VTODO 任务组件支持）

| 组件 | 仓库 URL | Star（实测） | License（精确 SPDX） | 语言 | 最近提交/发布 | 闭源商用？ | VTODO 支持 |
|---|---|---|---|---|---|---|---|
| **ical.js** | https://github.com/kewisch/ical.js | **1,179** | **MPL-2.0** | JavaScript | 提交 2026-09-17；`v2.2.1` @ 2025-08-08 | ✅（**文件级** copyleft） | ⚠️ **通用支持**：`lib/ical/design.js` 定义 `vtodo: icalSet`，但**无专用 `Todo` 类** |
| `node-ical` | https://github.com/jens-maus/node-ical | 170 | **Apache-2.0** | JavaScript | 提交 2026-09-13；`0.27.2` | ✅ | ⚠️ **仅部分**，**VEVENT 为主**，不适合任务 |
| ✅ **`icalendar`（Python，推荐）** | https://github.com/collective/icalendar | **1,174** | **BSD-2-Clause** | Python | 提交 2026-09-23；`v7.3.0` | ✅ | ✅ **VTODO + VALARM 完整**（`cal/todo.py`） |
| ✅ **`golang-ical`（Go，推荐）** | https://github.com/arran4/golang-ical | **415** | **Apache-2.0** | Go | 提交 2026-08-18；`v0.3.6` | ✅ | ✅ **VTODO + VALARM 完整** |
| **ical4j** | https://github.com/ical4j/ical4j | **837** | **BSD-3-Clause** | Java | 提交 2026-09-25；`4.3.0` | ✅ | ✅ **VTODO 完整**（`VToDo.java`） |
| `go-ical` | https://github.com/emersion/go-ical | 72 | **MIT** | Go | 提交 2025-06-09 | ✅ | ⚠️ VTODO **未核实** |
| `icalendar`（Rust） | https://github.com/hoodie/icalendar | 189 | **MIT/Apache-2.0** | Rust | 提交 2026-07-28；`v0.17.13` | ✅ | ⚠️ VTODO **未核实** |
| `pimalaya/ical` | https://github.com/pimalaya/ical | 1 | **MIT OR Apache-2.0** `[注册表]` | Rust | 提交 2026-09-02 | ✅ | ⚠️ **未核实** |
| ⚠️ `Peltoche/ical-rs` | https://github.com/Peltoche/ical-rs | 109 | ⚠️ 仓库页 Apache-2.0，crates 标注 **`non-standard`（冲突）** | Rust | **已归档**；`v0.11.0` @ 2024-03-13 | ⚠️ 不建议 | — |
| Dart `icalendar` | https://gitlab.com/powerbuilding/opensource/mobile/support-libraries/icalendar-dart | 未核实 | **BSD-3-Clause** `[注册表]` | Dart | pub `0.1.3` @ **2023-01-10** | ✅ ⚠️ 停滞 | 未核实 |
| Dart `ical` | https://github.com/dartclub/ical | 未核实 | **BSD-3-Clause** `[注册表]` | Dart | pub `0.2.2` @ **2021-11-23** | ✅ ⚠️ 不建议 | 未核实 |

**MPL-2.0 精确含义（针对 `ical.js`）**：**允许闭源商用**，但它是**文件级** copyleft —— **只有你修改过的 MPL 文件**必须继续以 MPL 发布；未修改的 MPL 文件作为依赖使用不触发开源义务。**不构成对整体闭源产品的传染**（这与 AGPL/GPL 有本质区别）。

**结论**：**任务类应用应选 VTODO+VALARM 完整实现** —— 服务端 Python 用 `collective/icalendar`(BSD-2)，Go 用 `arran4/golang-ical`(Apache-2.0)，JVM 用 `ical4j`(BSD-3)。JS 侧 `ical.js`(MPL-2.0) 可用但需自己补 `Todo` 封装。⚠️ **Dart 侧没有可用的 ICS 库**（两个候选分别停滞于 2023 与 2021）—— 这是 Flutter 路线的又一个缺口。

---

### 5.5 推送通知（自建方案 与 APNs/FCM 成本）

| 组件 | 仓库 URL | Star（实测） | License（精确 SPDX） | 语言 | 最近提交/发布 | 闭源商用？ |
|---|---|---|---|---|---|---|
| **ntfy** | https://github.com/binwiederhier/ntfy | **34,427** | **Apache-2.0 或 GPL-2.0 双许可**（**GPL 非强制，可选 Apache-2.0**） | Go | 提交 2026-09-23；`v2.28.0` @ 2026-08-27 | ✅ **选 Apache-2.0 分支即可**；付费仅针对官方托管 ntfy.sh，**自托管完全开源且可商用** |
| **Gotify server** | https://github.com/gotify/server | **15,975** | **MIT** | Go | 提交 2026-09-24；`v3.1.1` @ 2026-09-15 | ✅（GitHub 侧栏 `NOASSERTION` 是检测问题，LICENSE 原文为 MIT） |
| **Gotify Android** | https://github.com/gotify/android | **1,498** | **MIT** | Java/Kotlin | 提交 2026-07-06 | ✅ |
| **UnifiedPush**（规范/连接器） | [specifications](https://github.com/UnifiedPush/specifications) 110★ / [android-connector](https://github.com/UnifiedPush/android-connector) 37★ / [flutter-connector](https://github.com/UnifiedPush/flutter-connector) 32★ | — | **全部 Apache-2.0** | Kotlin/Dart/Ruby | 2025 | ✅ ⚠️ **GitHub 是 Codeberg 镜像，主仓在 Codeberg** |
| `fcm-distributor` | https://github.com/UnifiedPush/fcm-distributor | 30 | **Apache-2.0** | Kotlin | 2025-07 | ✅ ⚠️ **已归档**，功能已并入新仓 |
| **Apprise** | https://github.com/caronc/apprise | **17,384** | **BSD-2-Clause** | Python | 提交 2026-09-25；`v1.13.1` | ✅ 100+ 通道聚合下发，适合服务端 |

**APNs / FCM 成本（主源）**：

| 项目 | 事实 | 来源 |
|---|---|---|
| **FCM** | **No-cost（免费）** —— 定价表 Cloud Messaging 行标注 `No-cost`，Spark 计划无成本额度包含 FCM，无需绑定付款方式 `[原文]` | https://firebase.google.com/pricing |
| **Apple Developer Program** | **US$99 / 年** —— 页面原文 "Join the Apple Developer Program **$99 annual membership**" `[原文]` | https://developer.apple.com/programs/ |
| **APNs 按量费用** | 无额外按量费用，前提是持有上述会员资格。**"APNs 是否另行收费"的官方独立计费页 = 未核实**（未找到专门定价页） | — |

**结论**：自建推送以 **ntfy（Apache-2.0）** 或 **Gotify（MIT）** 为最优；Android 端若要避免依赖 FCM，可用 **UnifiedPush**（全 Apache-2.0）。iOS 侧**无法绕开 APNs**，必须持有 Apple Developer Program 会员（$99/年）。

---

### 5.6 习惯打卡的 streak 计算

> **结论：不存在任何成熟可复用的 streak 库，必须自研。**

**实测证据**：

| 候选 | 事实 | License | 闭源商用？ |
|---|---|---|---|
| `streak_calculator`（pub.dev 最贴近需求者） | pub `1.0.0` @ 2026-01-02；**likes 17，30 日下载 47** | **MIT** | ✅ |
| `flutter_streak` | pub `1.0.1` @ 2025-09-26；likes 3 | Apache-2.0 | ✅ |
| `streakify` | pub `0.0.2` @ 2024-09-15；likes 7 | MIT | ✅ |
| `streak_plus` | pub `0.0.1` @ 2026-03-26；likes 2 | MIT | ✅ |
| `date-streaks`（npm） | npm `1.2.1` @ **2020-03-17**（6 年未更新） | ISC | ✅ |
| `use-streak`（npm） | npm `1.0.4` @ **2021-11-15** | MIT | ✅ |
| `longest-streak`（npm） | **名不符实**：算的是"字符串中最长重复子串"，与习惯无关 | MIT | ✅ |
| `@molecule/api-streak` | **服务端** streak 跟踪，不是客户端库 | Apache-2.0 | ✅ |
| 🟥 `streak`（npm） | npm 元数据 **`license: None`**；2012 年 CoffeeScript 包，周下载 0 | 🟥 无许可 | 🟥 **禁止使用** |

**决定性反证**：两个主流开源习惯追踪器的依赖清单里**都没有 streak 库** ——
- `FriesI23/mhabit`（**1,596★**，Apache-2.0）的 `pubspec.yaml` 无 streak 依赖；
- `xpavle00/Habo`（**1,511★**，🟥 GPL-3.0）同样无；
- `iSoron/uhabits`（**10,275★**，🟥 GPL-3.0）的 streak 逻辑**内嵌在 `uhabits-core`**，未独立发布。

**→ 推荐自建**：200–400 行纯函数模块。必须处理：
1. IANA 时区 + **本地日期键**（不能用 UTC 日界）
2. **DST** 日历运算
3. schedule（计划）与 occurrence（实际完成）分离
4. 每周配额型目标（"每周 3 次"）
5. freeze / skip 豁免
6. **回溯编辑重算**（改历史记录要重算后续 streak）
7. "当天尚未结束"语义
8. 索引与性能（长历史区间查询）

---

### 5.7 本地数据库（各平台成熟度与许可证）

**Flutter / Dart**

| 组件 | 仓库 URL | Star（实测） | License | 最近提交/发布 | 闭源商用？ |
|---|---|---|---|---|---|
| **Drift** | https://github.com/simolus3/drift | **3,281** | **MIT** | 提交 2026-09-24；`drift-2.35.0` @ 2026-09-09 | ✅ **Flutter 首选**，pub 标签覆盖全 6 平台含 Web/WASM |
| `sqflite` | https://github.com/tekartik/sqflite | **3,020** | **BSD-2-Clause** | 提交 2026-09-20 | ✅ ⚠️ 无 web/win/linux（需 `sqflite_common_ffi`） |
| `sqlite3`（Dart） | https://github.com/simolus3/sqlite3.dart | 299 | **MIT** | 提交 2026-09-16；`3.6.0` | ✅ 标签含 `platform:web` + wasm-ready |
| `sqlite3_flutter_libs` | 同上 monorepo `legacy/` | — | **MIT** | pub `0.6.0+eol` @ 2026-02-15 | ✅ ⚠️ **`+eol` = 已停止维护** |
| `sqlcipher_flutter_libs` | 同上 monorepo `legacy/` | — | **MIT AND BSD-3-Clause-HP AND Pixar** `[注册表]` | pub `0.7.0+eol` @ 2026-02-15 | ✅ ⚠️ **`+eol`** |
| ⚠️ **Isar**（原仓库） | https://github.com/isar/isar | 4,024 | Apache-2.0 | 提交 2025-06-14；`v4.0.0-dev.14` @ 2023-08-21 | ⚠️ **README 原文："⚠️ ISAR V4 IS NOT READY FOR PRODUCTION"** |
| ⚠️ `isar-community/isar` | https://github.com/isar-community/isar | 252 | Apache-2.0 | **archived: true** | ⚠️ 已归档 |
| `isar-community/isar-community`（现役 fork） | https://github.com/isar-community/isar-community | 193 | Apache-2.0 | 提交 2026-09-08；`3.3.2` | ✅ ⚠️ 无 web 标签 |
| PowerSync Dart SDK | https://github.com/powersync-ja/powersync.dart | 251 | **Apache-2.0**（子包 `packages/powersync/LICENSE`；仓库根无 LICENSE） | 提交 2026-09-23 | ✅ 客户端可；⚠️ **服务端是 FSL-1.1-ALv2 🟥** |

**JS / React Native**

| 组件 | 仓库 URL | Star（实测） | License | 最近提交/发布 | 闭源商用？ |
|---|---|---|---|---|---|
| **WatermelonDB** | https://github.com/Nozbe/watermelondb | **11,786** | **MIT** | 提交 **2025-08-11**（**已停约 13.5 个月**）；`v0.28.1-0` @ 2025-07-24 | ✅ ⚠️ 无 Linux，提交停滞 |
| ⚠️ **RxDB（核心）** | https://github.com/pubkey/rxdb | **23,391** | **Apache-2.0**（核心） | 提交 2026-09-18；`17.5.0` | ✅ **核心可商用** |
| 🟥 **RxDB Premium 插件** | https://rxdb.info/premium/ | — | 🟥 **付费专有许可** | — | 🟥 **官方 SQLite/OPFS/Filesystem 存储、Sharding、Memory-Mapped、Server adapters 均需付费**；官方原文 "We do not currently offer a free trial" |
| `op-sqlite` | https://github.com/OP-Engineering/op-sqlite | **1,044** | **MIT** | 提交 2026-09-20；`18.2.5` | ✅ 支持 SQLCipher 编译目标 |
| `expo-sqlite` | https://github.com/expo/expo | 52,422（monorepo） | **MIT** | 提交 2026-09-25 | ✅ config plugin 支持 **`useSQLCipher: true`** |
| `better-sqlite3` | https://github.com/WiseLibs/better-sqlite3 | **7,496** | **MIT** | 提交 2026-08-10 | ✅ ⚠️ **Node 专用，不支持浏览器/RN** |
| `sql.js` | https://github.com/sql-js/sql.js | **13,663** | **MIT**（GitHub 侧栏 `NOASSERTION` 是误报） | 提交 2026-08-14 | ✅ WASM，浏览器 + Node |
| `cr-sqlite` | https://github.com/vlcn-io/cr-sqlite | **3,800** | **MIT** | 提交 2026-08-10；**release `v0.16.3` @ 2024-01-17** | ✅ ⚠️ release 停滞，CRDT 多主复制 |

**KMP / Rust**

| 组件 | 仓库 URL | Star（实测） | License | 最近提交/发布 | 闭源商用？ |
|---|---|---|---|---|---|
| **SQLDelight** | https://github.com/cashapp/sqldelight | **6,885** | **Apache-2.0** | 提交 2026-09-22；`2.4.0` @ 2026-09-18 | ✅ **KMP 首选** |
| ⚠️ **Realm Kotlin** | https://github.com/realm/realm-kotlin | 1,103 | Apache-2.0 | 提交 **2025-01-20**；`v3.0.0` @ 2024-10-03 | ⚠️ **README 红头确认 2024-09 官方弃用 Realm SDK 与 Atlas Device Sync，事实停更** |
| 🟥 **ObjectBox** | https://github.com/objectbox/objectbox-java | **4,624** | 🟥 **源码 Apache-2.0，但运行时二进制另受专有 `ObjectBox Binary License`** | 提交 2026-07-15 | 🟥 **revocable + 禁止"开发竞争性产品"**；Sync 为付费商业品 → **需法务** |
| `rusqlite` | https://github.com/rusqlite/rusqlite | **4,408** | **MIT** `[原文 Cargo.toml]` | 提交 2026-09-21 | ✅ |
| `sqlx` | https://github.com/launchbadge/sqlx | **17,499** | **MIT OR Apache-2.0** `[原文 Cargo.toml]` | 提交 2026-09-14 | ✅ |
| **SQLCipher** | https://github.com/sqlcipher/sqlcipher | **7,285** | **BSD-3-Clause** | 提交 2026-09-06 | ✅ AES-256 加密 fork |

**平台覆盖矩阵**

| 组件 | iOS | Android | Windows | macOS | Linux | Web |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **Drift**（Flutter） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sqflite` | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ❌ |
| `sqlite3`（Dart） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PowerSync Dart SDK | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `isar_community` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| WatermelonDB | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| RxDB（核心） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `op-sqlite`（RN） | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `expo-sqlite` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `better-sqlite3` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| `sql.js` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| SQLDelight（KMP） | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Realm Kotlin | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| ObjectBox Java | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |

**静态加密**：Drift ✅（`encrypted_drift`，覆盖所有原生平台含桌面）｜RxDB ✅（核心免费内建字段级加密，限制：**加密字段不能用于查询算子**）｜op-sqlite ✅（SQLCipher 编译目标）｜expo-sqlite ✅（`useSQLCipher`）｜sqflite ⚠️（需 `sqflite_sqlcipher`）｜SQLDelight ⚠️ 未核实官方封装。

**结论**：**Flutter → Drift（MIT，全 6 平台）**；**KMP → SQLDelight（Apache-2.0）**；**JS/RN → RxDB 核心（Apache-2.0，注意 Premium 陷阱）或 op-sqlite/expo-sqlite**。⚠️ **WatermelonDB 提交已停 13.5 个月且无 Linux**，⚠️ **Isar 生态分裂且 v4 官方自述未达生产可用**，两者均不建议新项目采用。

---

### 5.8 跨端框架：真实案例与取舍

| 框架 | 仓库 URL | Star（实测） | License | 最近提交/发布 | 闭源商用？ | 平台现实 |
|---|---|---|---|---|---|---|
| **Flutter** | https://github.com/flutter/flutter | **179,081** | **BSD-3-Clause** `[元数据]` | 提交 2026-09-25；`3.49.0-0.1.pre` | ✅ | 六端一套 UI |
| **React Native** | https://github.com/facebook/react-native | **126,724** | **MIT** | 提交 2026-09-25；`0.88.0-rc.2` | ✅ | 一等公民仅 iOS+Android |
| `react-native-windows` | https://github.com/microsoft/react-native-windows | **17,347** | **MIT** `[原文]` | 提交 2026-09-24 | ✅ | 活跃健康 |
| `react-native-macos` | https://github.com/microsoft/react-native-macos | **4,386** | **MIT** | 提交 2026-09-01；`v0.81.9` | ✅ | 活跃，但 release 落后主干约 7 个小版本 |
| ⚠️ `react-native-linux`（社区） | https://github.com/lucid-softworks/react-native-linux | **32** | 未核实 | 提交 2026-07-27；**无 release** | 未核实 | ⚠️ **非官方，不可用于生产** |
| **Compose Multiplatform** | https://github.com/JetBrains/compose-multiplatform | **19,386** | **Apache-2.0** | 提交 2026-09-24；`v1.13.0-alpha02` | ✅ | Android/iOS/Desktop Stable，**Web Beta** |
| **Tauri** | https://github.com/tauri-apps/tauri | **111,382** | **Apache-2.0 OR MIT** `[原文 Cargo.toml]` | 提交 2026-09-25；`v3.0.0-alpha.2` | ✅ | 桌面 + 移动（v2 起） |

**真实任务/习惯类应用案例**（可直接阅读源码作参考）

| 应用 | 仓库 URL | Star（实测） | License | 技术栈 | 闭源商用？ |
|---|---|---|---|---|---|
| ✅ **mhabit** | https://github.com/FriesI23/mhabit | **1,596** | **Apache-2.0** | Flutter（Dart 97.6%），Android/iOS/Windows/macOS/Linux + WebDAV 同步 + local-first | ✅ **Flutter 全平台最佳正面案例** |
| ✅ **Zest** | https://github.com/darkmoonight/Zest | 485 | **MIT** | Flutter 任务管理 | ✅ |
| ✅ **Alkaa** | https://github.com/igorescodro/alkaa | **1,645** | **Apache-2.0** | KMP + Compose Multiplatform 任务 App（Android + iOS） | ✅ **KMP 做 todo 最佳案例** |
| ✅ KaMPKit | https://github.com/touchlab/KaMPKit | **2,453** | **Apache-2.0** | KMP 起步模板 | ✅ |
| ⚠️ WhatTodo | https://github.com/burhanrashid52/WhatTodo | 1,265 | Apache-2.0 | Flutter + `sqflite` | ✅ 维护放缓 |
| ⚠️ flutter-todos | https://github.com/asjqkkkk/flutter-todos | 2,120 | MIT | Flutter | ✅ release 停在 2020 |
| ⚠️ Taskist | https://github.com/huextrat/Taskist | 1,057 | MIT | Flutter + Firebase | ✅ **6 年未动** |
| 🟥 AppFlowy | https://github.com/AppFlowy-IO/AppFlowy | **76,917** | 🟥 **AGPL-3.0** | Flutter | 🟥 **禁止闭源商用** |
| 🟥 Habo | https://github.com/xpavle00/Habo | **1,511** | 🟥 **GPL-3.0** | Flutter | 🟥 禁止 |
| 🟥 uhabits | https://github.com/iSoron/uhabits | **10,275** | 🟥 **GPL-3.0** | Kotlin | 🟥 禁止 |
| 🟥 Twine | https://github.com/msasikanth/twine | 2,414 | 🟥 **GPL-3.0** | KMP + Compose | 🟥 禁止 |
| 🟥 Notesnook | https://github.com/streetwriters/notesnook | **14,636** | 🟥 **GPL-3.0** | RN + Electron | 🟥 禁止 |

**Flutter Web 的三条官方硬约束** `[原文]`（对"全平台"目标至关重要）：

| 限制 | 官方原文（节选） | 影响 |
|---|---|---|
| **无 `dart:io` / 无文件系统** | "Can I use dart:io with a web app? **No. The file system is not accessible from the browser.**"；调用 `Platform.isXYZ` 抛 `UnsupportedError` | 数据库必须走 **WASM 或 IndexedDB** |
| **不支持 isolates** | "Dart's concurrency support that uses isolates is **not currently supported in Flutter web**… can work around by using web workers, although such support isn't built in" | 后台批量解析/大查询需自接 Web Worker |
| **不再默认生成 service worker** | "**Flutter no longer generates or manages a caching service worker by default**… you need to configure a service worker yourself" | 离线优先的 Web 端离线能力须自建 |
| （正面）浏览器支持广 | Chrome / Safari / Edge / Firefox（mobile & desktop） | 可用性 OK |
| （负面）不适合文档型内容 / SEO | "Flutter is **not suitable for static websites with text-rich flow-based content**"；"application output **doesn't align with what search engines need to properly index**" | 营销页/帮助文档需另做 DOM 页面 |

**结论**：
- **Flutter**：全平台 UI 复用真实有效（mhabit 为证），但 ① 无法复用 TS 同步内核；② Web 端有上述三条硬约束需单独设计；③ Dart 侧缺 CalDAV 与 ICS 库。
- **React Native**：Windows/macOS 有官方维护（MIT，活跃），但 **Linux 无官方目标**，Web 需 `react-native-web`。**不满足"六平台"要求**。
- **KMP**：Android/iOS/Desktop Stable，**Compose Web 仍 Beta**；且**原生端无法消费 TS**。
- **Tauri 2**：**唯一能让同一套 TS/本地优先同步栈在全部六平台原样复用**的框架（代价是 WebView UI）。

---

## 6. 许可证风险汇总

### 🟥 禁止使用 / 必须替换（AGPL / GPL / BUSL / FSL / 专有 / 无许可）

| 组件 | License | 风险 |
|---|---|---|
| `@nextcloud/cdav-library` | **AGPL-3.0-or-later** | 🟥 网络条款传染。**项目当前依赖，必须替换为 `tsdav`(MIT)** |
| `nextcloud/server` | **AGPL-3.0** | 🟥 禁止嵌入 |
| `stalwartlabs/stalwart` | **AGPL-3.0-only 或专有 SELv2** | 🟥 禁止嵌入；自托管亦受网络条款约束 |
| `Kozea/Radicale` | **GPL-3.0** | 🟥 仅可独立自托管，禁止嵌入/再分发 |
| `sabre-io/Baikal` | **GPL-3.0** | 🟥 同上 |
| `bitfireAT/davx5-ose` | **GPL-3.0** | 🟥 禁止嵌入（其库 `dav4jvm` MPL-2.0 可单独用） |
| `minicaldav`（Rust） | **GPL-3.0-or-later** | 🟥 禁止嵌入，且已停更 |
| `python-recurring-ical-events` | **LGPL-3.0** | 🟥 禁止作为可分发闭源依赖 |
| `powersync-service` | **FSL-1.1-ALv2** | 🟥 禁止 Competing Use（发布满 2 年自动转 Apache-2.0） |
| **ObjectBox** 运行时二进制 | **专有 ObjectBox Binary License** | 🟥 revocable + 禁止竞争性产品 → 需法务 |
| **RxDB Premium** 插件 | **付费专有** | 🟥 官方 SQLite/OPFS/存储/性能插件需付费 |
| `chinese-datetime-parser` / `cntime-nlp` | **无 License** | 🟥 无许可 = 保留全部权利 |
| npm `streak` | **无 license 字段** | 🟥 禁止使用 |
| `Peltoche/ical-rs` | 仓库 Apache-2.0 vs crates `non-standard` **冲突** | 🟥 已归档，不建议 |
| 🟥 参考用 App 代码：AppFlowy / Habo / uhabits / Twine / Notesnook | **AGPL-3.0 / GPL-3.0** | 🟥 **只能阅读研究，不可作为组件** |

### ✅ 可安全闭源商用（推荐清单）

| 用途 | 推荐组件 | License |
|---|---|---|
| 同步底座（若留 JS 生态） | `@sp/sync-core` / `sync-providers` / `shared-schema` / `super-sync-server` | **MIT**（仓库根 `LICENSE` 原文 + 根 `package.json` `"license": "MIT"`）⚠️ 见下方注 |
| CalDAV 客户端 | **`tsdav`** | MIT |
| WebDAV 客户端 | `webdav` | MIT |
| CalDAV 服务端（可嵌入） | **SabreDAV** | BSD-3-Clause |
| ICS（VTODO） | Python `icalendar` / Go `golang-ical` / Java `ical4j` | BSD-2 / Apache-2.0 / BSD-3 |
| ICS（JS） | `ical.js` | MPL-2.0（文件级 copyleft，可用） |
| RRULE | Dart `rrule` / Python `dateutil` / JS `rrule.js` / Rust `rrule` | Apache-2.0 / BSD+Apache / BSD-3 / MIT OR Apache-2.0 |
| NLP 日期 | `chrono-node` / `dateparser` | MIT / BSD-3 |
| 中文日历 | 6tail lunar 系列 / `cn2an` | MIT |
| 推送 | `ntfy`(选 Apache-2.0) / `gotify` / UnifiedPush / `apprise` | Apache-2.0 / MIT / Apache-2.0 / BSD-2 |
| 本地数据库 | **Drift** / **SQLDelight** / RxDB 核心 / op-sqlite / expo-sqlite | MIT / Apache-2.0 / Apache-2.0 / MIT / MIT |
| 加密存储 | SQLCipher | BSD-3-Clause |
| 跨端框架 | **Tauri 2** / Flutter / RN / Compose MP | Apache-2.0 OR MIT / BSD-3 / MIT / Apache-2.0 |
| streak | **自研**（无成熟库） | — |

> ⚠️ **关于 Super Productivity 各子包的许可证精确状态（本机实测）**：仓库根 `package.json` 声明 `"license": "MIT"`，根 `LICENSE` 为逐字标准 MIT 全文（Copyright (c) 2018 Johannes Millan）。但 **四个子包（`sync-core` / `shared-schema` / `sync-providers` / `super-sync-server`）的 `package.json` 均无 `license` 字段，`packages/` 下也没有任何 per-package LICENSE 文件**（逐项实测确认）。按常规理解，仓库级 MIT LICENSE 覆盖全部子目录，因此**整体可闭源商用**；但若要把某个子包**独立抽取发布或再分发**，建议在 fork 中补上 per-package 的 `license` 字段与 LICENSE 副本，以免下游产生歧义（这与 §5.7 中 PowerSync Kotlin SDK「仓库根无 LICENSE」属同类问题，只是此处方向相反：有仓库级许可、缺包级声明）。

---

## 7. 未核实项（明确留空）

| 项 | 原因 |
|---|---|
| APNs 是否另有独立按量计费页 | 未找到官方专门定价页；结论建立在 Apple Developer Program 会员制之上 |
| `recurrence_picker`、部分 Dart 小包的 GitHub Star | 仅查了 pub.dev 注册表与 LICENSE，未逐个跑 ghinfo |
| `streak_calendar` 的精确 SPDX | 仓库 LICENSE 首行为非标准 "Copyright 2013 Deepanshu Chaudhary"，pub.dev 未列 license |
| Dart 端 RRULE 引擎的逐条 RFC 5545 符合度 | 仅有包描述级声明，无符合度矩阵 |
| `hoodie/icalendar`、`pimalaya/ical`、`emersion/go-ical` 的 VTODO 支持 | 未逐行读源码 |
| `khal` 是否支持 VTODO | README 未提 |
| libsodium `crypto_pwhash` 与 hash-wasm `argon2id` 输出是否逐位一致 | **关键待验证项**（libsodium 用 opslimit/memlimit 表达参数，映射需实测） |
| ObjectBox / SQLDelight / better-sqlite3 的静态加密官方封装细节 | 文档站重定向异常或未深入核实 |
| Kotlin/JVM 侧嵌入 JS 引擎消费 TS 的可行性 | 无官方文档支持，属第三方方案 |
| iOS 后台同步的具体时长/触发限制 | 未找到官方量化文档 |

---

## 8. 给决策者的三条硬结论

1. **不要在 Flutter/KMP 里"直接跑 TS"**。上游依赖 WebAssembly（Argon2id）与一批 Web API，而 QuickJS 官方文档对这些的提及次数是 **0** —— 这条路会同时付出"垫片 + 替换加密 + 解释器性能"三重代价，复杂度不低于直接移植。

2. **要最大化复用，就让客户端留在 JS/TS 生态**。这是唯一复用度接近 100%、且已被上游用 Capacitor + Electron 验证到六平台生产级的方案。Tauri 2（Apache-2.0 OR MIT）是更现代的等价载体。

3. **组件层先修掉 `@nextcloud/cdav-library`（AGPL-3.0-or-later）**，换成 `tsdav`（MIT）。同时注意 Radicale / Baikal 是 GPL-3.0（只能独立自托管）、ObjectBox 与 RxDB Premium 是专有/付费、Isar 与 WatermelonDB 已事实停更。**streak 必须自研**，Dart 侧**没有可用的 CalDAV 与 ICS 库**。

---

## 附录：证据来源与可复现性

**本报告的证据分层与原始材料**：

| 文件 | 内容 |
|---|---|
| `research/parts/part2a-rrule-nlp.md` | RRULE + NLP 日期：完整表格 + 原始证据附录（ghinfo 输出、LICENSE 原文、注册表 API 返回） |
| `research/parts/part2b-caldav-ical-push.md` | CalDAV/WebDAV + ICS + 推送：同上 |
| `research/parts/part2c-db-streak-frameworks.md` | streak + 本地数据库 + 跨端框架：含平台覆盖矩阵与官方文档原文摘录 |
| `research/deep-dive-cross-language.md` | 加密契约跨语言往返实测（TS → Python）与四条集成路线初评 |
| `research/deep-dive-sync-core.md` / `deep-dive-schema-providers.md` / `deep-dive-supersync-server.md` | 三个包与官方服务端的逐个深挖 |
| `research/module7-sync-engines.md` | CRDT / 同步引擎授权与商业可用性 |
| `research/upstream/super-productivity/` | 上游源码（HEAD `aa9690ca` @ 2026-09-24），Part 1 所有量化结论的实测对象 |

**可复现命令**：

```bash
cd research
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890

# GitHub 元数据（star / license 字段 / 最近提交 / release）
python3 tools/ghinfo.py <owner/repo> [<owner/repo> ...]

# License 原文
curl -s https://raw.githubusercontent.com/<owner>/<repo>/HEAD/LICENSE | head -20

# 包注册表
curl -s https://pub.dev/api/packages/<name>/score          # license / platform 标签
curl -s https://registry.npmjs.org/<pkg>                   # license 字段
curl -s https://crates.io/api/v1/crates/<name>             # license 字段
curl -s https://pypi.org/pypi/<pkg>/json                   # license / classifiers
```

**Part 1 关键结论的本地验证命令**：

```bash
cd research/upstream/super-productivity

# 三个包的规模
find packages/sync-core/src -name '*.ts' | xargs wc -l | tail -1      # 4240
find packages/shared-schema/src -name '*.ts' | xargs wc -l | tail -1  # 1254
find packages/sync-providers/src -name '*.ts' | xargs wc -l | tail -1 # 7634

# 宿主耦合面（真正的移植成本）
find src/app/op-log -name '*.ts' -not -name '*.spec.ts' | xargs wc -l | tail -1  # 51708

# 无 Node 专属导入
grep -rn "from 'node:\|require('node:" packages/*/src   # 无输出

# 上游 Kotlin 加密移植（633 行）
wc -l android/app/src/main/java/com/superproductivity/superproductivity/crypto/*.kt

# 上游平台策略：Capacitor（移动）+ Electron（桌面）
cat capacitor.config.ts; ls electron/ android/ ios/
```

---

*报告生成时间：2026-09-25。所有 star / 提交 / 发布数据为当日实测，会随时间变化；License 判定以本报告引用的原文快照为准，正式商用前建议由法务复核。*
