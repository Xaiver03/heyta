# 向量库候选验证报告（原始事实材料）

验证日期：2026-09-26 UTC。所有数字来自真实工具输出。
数据源：`api.github.com`（部分）、`ungh.cc`（GitHub 数据代理，API 限流时使用）、`registry.npmjs.org`、npm tarball 实际解包、`raw.githubusercontent.com`、官方文档页。

---

## ⚠️ 前提修正（必须先读）

任务前提写的是「**Hermes does not support WebAssembly**」。**这一点在 2026-02 已经不成立**，有权威一手来源：

- Tzvetan Mikov（Hermes 负责人 / Meta）2026-02-17 博客《WebAssembly Comes to Hermes》：
  > "Hermes can now compile and run WebAssembly modules. A standard `.wasm` binary - the same one that runs in a browser or Node.js - can be loaded into Hermes at runtime, or compiled ahead of time into Hermes bytecode (`.hbc`) for zero startup cost."

  但同一篇的 **Current Status** 明确写：
  > "This is an early preview. We are focusing on correctness first, not performance. **Wasm support is not yet ready for production use.**"
  > What's not yet supported: "SIMD", "Threads and shared memory", "Performance optimizations", "Native `i64` representation"

- 该文的运行示例全部带内部测试开关：`hermes -Xhermes-internal-test-methods ...`
- 官方 React Native 0.84 发布博客（2026-02-11，`reactnative.dev/blog/2026/02/11/react-native-0.84`）**完全没有提到 WebAssembly**（我对该页 HTML 全文 grep `wasm`/`WebAssembly`，0 命中）。

**结论（事实层面）**：Hermes 引擎本身已有 WASM 支持，但官方自述是 early preview、非生产可用、且示例需内部测试 flag。RN 0.84 官方发布说明未声明启用。因此「WASM → 出局」这条判据应改为**降级警告**，而不是硬性否决。是否在 RN 生产环境可用，**未查到**官方明确声明。

---

## 汇总表

| # | 候选 | SPDX 许可证（GitHub / npm） | Stars | pushed_at | archived | JS/TS 包（npm 精确名） | 最新版本 | JS 绑定方 | **JS 绑定是否 WASM** | 浏览器支持 | **React Native / Hermes** | 运行时体积 | 进程模型 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sqlite-vec | GitHub `Apache-2.0`；仓库实为**双许可** `LICENSE-MIT` + `LICENSE-APACHE`；npm `"MIT OR Apache"` | 8137 | 2026-05-18T06:50:45Z | false | `sqlite-vec`、`sqlite-vec-wasm-demo`、`sqlite-vec-{darwin,linux,windows}-{x64,arm64}` | 0.1.9 | 第一方 | **Node 绑定 = 原生**（.dylib/.so/.dll，非 WASM）；**浏览器 = 单独 WASM 包** | 是（WASM，静态编译进 SQLite WASM 构建） | **是 —— 原生扩展路径，不需要 WASM**（Expo `withSQLiteVecExtension`；op-sqlite `sqliteVec`；官方 GitHub Releases 提供 Android/iOS 预编译库） | `sqlite-vec` 4004 B / 5 files；平台二进制 162252 B / 3 files；`sqlite-vec-wasm-demo` 5193841 B / 4 files（含 `sqlite3.wasm`） | 嵌入式 in-process |
| 2 | LanceDB | `Apache-2.0` / npm `Apache-2.0` | 11533 | 2026-09-26T00:43:21Z | false | `@lancedb/lancedb`（现行）、`vectordb`（旧） | 0.39.0 | 第一方 | **否** —— NAPI-RS 原生 `.node`；包内 0 个 `.wasm` | **否** —— 浏览器 WASM PR #3247 已 **Closed**，`@lancedb/lancedb-web` npm **404** | **否** —— 未查到任何 RN 支持 | 1435751 B / 62 files（不含平台二进制）；`vectordb` 546649 B / 81 files | 嵌入式 in-process |
| 3 | ChromaDB | `Apache-2.0` / npm `Apache-2.0` | 29381 | 2026-09-25T21:15:36Z | false | `chromadb`（JS 客户端）、`chromadb-js-bindings-*`（原生）、`@chroma-core/default-embed` | 3.5.0 | 第一方 | **JS 客户端不含 WASM**（0 个 `.wasm`）；原生 Rust 绑定仅 CLI 使用。默认 embedding function 走 ONNX Runtime **WASM** | 是（仅 HTTP 客户端；默认 EF 需 WASM） | **否** —— JS 客户端必须连服务器；官方明说「To connect with the JS/TS client, you must connect to a Chroma server」 | `chromadb` 1719030 B / 49 files；原生绑定 darwin-arm64 **46430170 B** / 3 files；`chromadb-default-embed` 46182904 B / 59 files | **需独立服务器**（`npx chroma run`，或 Docker，或 Cloud） |
| 4 | usearch | `Apache-2.0` / npm `"Apache 2.0"` | 4320 | 2026-08-31T22:47:21Z | false | `usearch` | 2.26.2 | 第一方 | **npm 包 = 原生 NAPI**（0 个 `.wasm`，544 files）；**WASM 是 GitHub Release 附件**（WASI/Wasmer，非浏览器 JS） | **无第一方浏览器 JS 包** —— 官方 WASM 产物是 WASI 模块（`wasmer.toml` → `build/wasm/index.wasm`） | **是 —— 但靠社区 JSI 包装**（`expo-vector-search` 56★ MIT；`react-native-edge-vector-store` MIT），非官方 | `usearch` **25226850 B / 544 files**；`usearch_wasm_2.26.2.zip` 52 KB（内含 wasm 模块 + 头文件） | 嵌入式 in-process |
| 5 | hnswlib | GitHub `nmslib/hnswlib` `LICENSE` = Apache-2.0；npm 两个包均 `Apache-2.0` | 5334（hnswlib 本体） | 2026-09-15T11:56:10Z | 未 archived（HTML 检查） | `hnswlib-node`（原生）、`hnswlib-wasm`（WASM） | 3.0.0 / 0.8.2 | 均**社区第三方**（yoshoku / ShravanSunder），非 nmslib 官方 | `hnswlib-node` = 原生 NAPI；`hnswlib-wasm` = **Emscripten WASM** | `hnswlib-wasm` 是（Emscripten）；`hnswlib-node` 否 | **未查到**任何 RN 包装 | `hnswlib-node` 195898 B / 16 files；`hnswlib-wasm` 3049318 B / 21 files | 嵌入式 in-process |
| 6 | DuckDB VSS | `duckdb/duckdb` `LICENSE` = **MIT** 正文（Stichting DuckDB Foundation）；`duckdb/duckdb-vss` = MIT 正文；npm 均 `MIT` | 41713（duckdb） | 2026-09-25T19:09:44Z | 未 archived（HTML 检查） | `@duckdb/node-api`（现行）、`duckdb`（**已弃用**）、`@duckdb/duckdb-wasm` | 1.5.5-r.5 / 1.4.4 / 1.33.1-dev57.0 | 第一方 | `@duckdb/node-api` = 原生；`@duckdb/duckdb-wasm` = **3 个 `.wasm`**（`duckdb-coi.wasm` / `duckdb-eh.wasm` / `duckdb-mvp.wasm`） | 是（WASM） | **未查到**任何 RN 路径 | `@duckdb/node-api` 651541 B / 365 files；`@duckdb/duckdb-wasm` **149377663 B / 85 files**；`duckdb`（弃用）61204393 B / 4416 files | 嵌入式 in-process（native 与 wasm 均是） |

**VSS 在 WASM 构建里可用（已实测下载验证）**：
`https://extensions.duckdb.org/v1.5.0/wasm_mvp/vss.duckdb_extension.wasm` → HTTP 200，360139 bytes，`file` 输出 `WebAssembly (wasm) binary module version 0x1 (MVP)`。

---

## 证据

### 1. sqlite-vec（asg017/sqlite-vec）

**GitHub API**（2026-09-26 抓取）：
```json
{"full_name":"asg017/sqlite-vec","stargazers_count":8137,"pushed_at":"2026-05-18T06:50:45Z",
 "archived":false,"license":{"spdx_id":"Apache-2.0","name":"Apache License 2.0"},
 "description":"A vector search SQLite extension that runs anywhere!","default_branch":"main"}
```

**许可证**：仓库根有**两个** license 文件（`ungh.cc/repos/asg017/sqlite-vec/files/main` 列出 `LICENSE-APACHE`、`LICENSE-MIT`）。
npm `sqlite-vec` 的 `license` 字段 = `"MIT OR Apache"`。→ 双许可 MIT / Apache-2.0，两者皆在白名单。

**README 逐字**（`raw.githubusercontent.com/asg017/sqlite-vec/main/README.md`）：
> "- Written in pure C, no dependencies, runs anywhere SQLite runs
>   (Linux/MacOS/Windows, **in the browser with WASM**, Raspberry Pis, etc.)"

**WASM 官方证据**（`site/using/wasm.md`，逐字）：
> "# `sqlite-vec` in the Browser with WebAssembly
>
> `sqlite-vec` can be statically compiled into [official SQLite WASM](https://sqlite.org/wasm/doc/trunk/index.md) builds."

> "It's not possibly to dynamically load a SQLite extension into a WASM build of SQLite. So `sqlite-vec` must be statically compiled into custom WASM builds."

> "## The `sqlite-vec-wasm-demo` NPM package
> A **demonstration** of `sqlite-vec` in WASM is provided with the `sqlite-vec-wasm-demo` NPM package."

**Node 绑定 = 原生（非 WASM）**：`sqlite-vec@0.1.9` tarball 只有 5 个文件：
```
package/README.md
package/package.json
package/index.mjs
package/index.cjs
package/index.d.ts
```
`index.mjs` 逐字：
> "function extensionSuffix(platform) { if (platform === "win32") return "dll"; if (platform === "darwin") return "dylib"; return "so"; }"
> "function load(db) { db.loadExtension(getLoadablePath()); }"

即 Node 侧靠 `db.loadExtension()` 加载平台原生 `.dylib/.so/.dll`。`optionalDependencies` = `sqlite-vec-linux-x64`、`sqlite-vec-darwin-x64`、`sqlite-vec-linux-arm64`、`sqlite-vec-windows-x64`、`sqlite-vec-darwin-arm64`（各 `0.1.9`）。
`sqlite-vec-darwin-arm64@0.1.9`：license `"MIT OR Apache"`，`unpackedSize` 162252，`fileCount` 3。

**WASM 包实测**：`sqlite-vec-wasm-demo@0.1.9` tarball 文件列表：
```
package/README.md
package/package.json
package/sqlite3.mjs
package/sqlite3.wasm        <-- 真实 .wasm 文件
```
`unpackedSize` 5193841，`fileCount` 4，license `"MIT OR Apache"`。

**React Native / Hermes —— 官方支持（原生路径，不需要 WASM）**：
官方文档 `alexgarcia.xyz/sqlite-vec/android-ios.html` 逐字：
> "sqlite-vec on Android and iOS devices
> sqlite-vec can run on mobile devices like Android and iOS. As of v0.1.2, We publish pre-compiled loadable library for both platforms to our Github Releases. You can drop those files into your Android Studio or XCode projects as needed. We eventually will also include .aar file support and .xvframework support in future releases. If you have any feedback or ideas on how we can better support Android/iOS projects, please file an issue.
> **Also consider op-sqlite for React Native, which has builtin support for sqlite-vec.**"

Expo 官方文档（`docs.expo.dev/versions/latest/sdk/sqlite/`）配置项逐字：
> "withSQLiteVecExtension | false | Include the sqlite-vec extension to bundledExtensions."

同页 API 示例逐字：
> "// Load `sqlite-vec` from `bundledExtensions`. You need to enable `withSQLiteVecExtension` to include `sqlite-vec`.
> const extension = SQLite.bundledExtensions['sqlite-vec'];
> await db.loadExtensionAsync(extension.libPath, extension.entryPoint);"

注意 Expo 同页的 **web** 说明（说明 web 与 native 走不同路径）逐字：
> "To use expo-sqlite on web, you need to configure Metro bundler to support wasm files and add HTTP headers to allow SharedArrayBuffer usage."

op-sqlite 文档（`op-engineering.github.io/op-sqlite/docs/installation/`）逐字：
> "sqliteVec enables sqlite-vec, an extension for RAG embeddings"

**体积**：见上表。`sqlite-vec` 主包仅 4004 B（5 文件）——它本身不含二进制，靠 optionalDependencies 拉平台包。

**进程模型**：嵌入式 in-process（SQLite 扩展）。

---

### 2. LanceDB（lancedb/lancedb）

**GitHub API**（2026-09-26 抓取）：
```json
{"full_name":"lancedb/lancedb","stargazers_count":11533,"pushed_at":"2026-09-26T00:43:21Z",
 "archived":false,"license":{"spdx_id":"Apache-2.0"},"default_branch":"main",
 "description":"Developer-friendly OSS embedded retrieval library for multimodal AI. Search More; Manage Less."}
```

**npm `@lancedb/lancedb@0.39.0`**：`license` `Apache-2.0`，`engines` `{"node":">= 22"}`，
`dependencies` = `reflect-metadata ^0.2.2`、`@opentelemetry/api ^1.9.0`，
`optionalDependencies` = `openai 4.29.2`、`@huggingface/transformers 3.0.2` + 7 个平台包：
`@lancedb/lancedb-darwin-arm64`、`-linux-x64-gnu`、`-linux-x64-musl`、`-win32-x64-msvc`、`-linux-arm64-gnu`、`-linux-arm64-musl`、`-win32-arm64-msvc`（均 `0.39.0`）。
`unpackedSize` 1435751，`fileCount` 62。

**包内 0 个 `.wasm`**：62 个文件的完整列表里 grep `\.wasm` → 无命中。

**原生绑定证据** —— `package/dist/native.js` 逐字：
> "/* auto-generated by NAPI-RS */"
> "function requireNative() { if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) { ... return require('./lancedb.android-arm64.node'); } ... const binding = require('@lancedb/lancedb-android-arm64'); ..."

即 NAPI-RS 生成的平台原生 `.node` 加载器。（注意：`native.js` 里引用了 android-arm64 / android-arm-eabi，但 `@lancedb/lancedb-android-arm64` 在 npm 上 **404 Not found**，`optionalDependencies` 里也没有 android —— 说明 Android 分支存在但未发布。）

`@lancedb/lancedb-darwin-x64` 在 npm 上的 latest 只有 **0.22.3**（主包已 0.39.0），版本严重滞后。

**浏览器 / WASM：官方不支持**：
- Issue #230《Use in-browser ?》（2023-06-27 开，状态 **Open**）：提问 "since it's an npm module, if it (at least the vector search) could also be used in-browser?" —— 抓取到的正文与 Activity 中**没有官方答复**。
- Discussion #3329《Show and tell: browser/WebAssembly search for published LanceDB tables》（2026-04-28，**0 comments**），作者 justsml 逐字：
  > "I opened PR #3247 to add a first-party browser/WebAssembly path for searching published LanceDB tables directly from HTTP/S3/CDN-hosted artifacts.
  > The short version: this makes it possible to publish a read-only Lance table and open it from the browser with `@lancedb/lancedb-web`, without standing up a separate search service for that snapshot."
- PR #3247 正文逐字提到新增文件：`rust/lancedb-wasm/src/lib.rs`、`browser.rs`、`browser_expr.rs`、`fetch_object_store.rs`，"### 2. New `lancedb-wasm` runtime"。
- **PR #3247 状态 = Closed**（对 `github.com/lancedb/lancedb/pull/3247` HTML grep，命中 `Closed</span>` ×2；未命中 `Merged`）。
- **`@lancedb/lancedb-web` npm → `{"error":"Not found"}`；`@lancedb/lancedb-wasm` npm → `{"error":"Not found"}`。**

**React Native**：对 `ungh.cc/repos/lancedb/lancedb/files/main` 全仓 781 个文件 grep `react`/`wasm`/`browser`，**唯一命中**是 `nodejs/__test__/fixtures/oauth_browser.cmd`。README 只写：
> "- **Seamless Integration**: Python, Node.js, Rust, and REST APIs for easy integration. Native Python and Javascript/Typescript support."

→ 无 RN 支持。

**旧包 `vectordb@0.21.2`**：`Apache-2.0`，`dependencies` = `axios ^1.4.0`、`@neon-rs/load ^0.0.74`，`optionalDependencies` = 5 个 `@lancedb/vectordb-*` 平台包，`unpackedSize` 546649，`fileCount` 81，`modified` 2025-07-25。仍是原生（`@neon-rs/load`）。

**进程模型**：嵌入式 in-process（native）。

---

### 3. ChromaDB（chroma-core/chroma）

**GitHub API**（2026-09-26 抓取）：
```json
{"full_name":"chroma-core/chroma","stargazers_count":29381,"pushed_at":"2026-09-25T21:15:36Z",
 "archived":false,"license":{"spdx_id":"Apache-2.0"},"default_branch":"main",
 "description":"Search infrastructure for AI"}
```

**npm `chromadb@3.5.0`**：`license` `Apache-2.0`，`engines` `{"node":">=20"}`，`dependencies` = `semver ^7.7.1`，
`optionalDependencies` = `chromadb-js-bindings-darwin-x64`、`-darwin-arm64`、`-linux-x64-gnu`、`-win32-x64-msvc`、`-linux-arm64-gnu`（均 `^1.3.4`）。
`unpackedSize` 1719030，`fileCount` 49。**包内 0 个 `.wasm`。**

**JS 客户端 = 纯 HTTP/REST** —— README 逐字：
> "This package gives you a JS/TS interface to talk to a backend Chroma DB over REST."

官方文档 `docs.trychroma.com/docs/run-chroma/clients` 逐字（关键）：
> "To connect with the JS/TS client, you must connect to a Chroma server. To run a Chroma server locally that will persist your data, install Chroma from npm using any npm compatible client.
> `npm install chromadb`
> And run the server using our CLI:
> `npx chroma run --path ./getting-started`"

同页对 **In-Memory Client** 明确只给 Python：
> "In Python, you can run a Chroma server in-memory and connect to it with the ephemeral client:
> `import chromadb; client = chromadb.Client()`
> The `Client()` method starts a Chroma server in-memory and also returns a client with which you can connect to it."

→ JS/TS **没有** embedded/in-memory/persistent 路径。

**Chroma 1.0+ Rust：原生绑定只被 CLI 使用（不是嵌入式 JS API）**：
`package/src/bindings.ts` 逐字（按平台 `require` 原生包）：
> "binding = require(\"chromadb-js-bindings-darwin-arm64\");" … "binding = require(\"chromadb-js-bindings-linux-x64-gnu\");" …
> "throw new Error(`Unsupported platform: ${platform}`);"

全 `src/` grep `bindings`，**唯一 import 点是 CLI**：
```
ch/package/src/bindings.ts:12:  binding = require("chromadb-js-bindings-darwin-arm64");
ch/package/src/cli.ts:3:import binding from "./bindings";
```
`package/src/cli.ts` 逐字（末尾）：
> "binding.cli([\"chroma\", ...args]);"

→ `npx chroma run` 通过原生 Rust 绑定启动**一个服务器进程**（localhost HTTP），不是 JS 进程内嵌入式。

**原生绑定包体积**：`chromadb-js-bindings-darwin-arm64@1.3.4`，license `MIT`，`unpackedSize` **46430170**，`fileCount` 3，description：
> "This is the **aarch64-apple-darwin** binary for `chromadb-js-bindings`"

**默认 embedding function = ONNX（WASM）**：
`package/src/embedding-function.ts` 逐字：
> "onnx_mini_lm_l6_v2: \"default-embed\","
> "default: \"default-embed\","
> "const { DefaultEmbeddingFunction } = await import(\"@chroma-core/default-embed\");"
> "Cannot instantiate a collection with the DefaultEmbeddingFunction. Please install @chroma-core/default-embed, or provide a different embedding function"

即默认 EF 是**独立可选包**（动态 import，不是硬依赖）。两条谱系都走 ONNX Runtime：
- `@chroma-core/default-embed@0.1.9`：npm `license` 字段 = **null**；`dependencies` = `@huggingface/transformers ^3.5.1`、`@chroma-core/ai-embeddings-common ^0.1.9`；`unpackedSize` 30508，`fileCount` 11，`modified` 2025-11-12。
  - `@huggingface/transformers@4.3.0`：`license` `Apache-2.0`，`dependencies` 含 `onnxruntime-web 1.31.0-dev.20260914-8d85527a0`、`onnxruntime-node 1.30.0`，`unpackedSize` 9884823。
- 旧 `chromadb-default-embed@2.14.0`：`license` `Apache-2.0`，`dependencies` = `onnxruntime-web 1.14.0`、`sharp ^0.32.0`、`@huggingface/jinja ^0.1.0`，`unpackedSize` **46182904**，`fileCount` 59。
  - 其 GitHub `chroma-core/chromadb-default-embed`：27★，pushed 2025-03-03，description "chroma's fork of @xenova/transformers"。

**React Native**：对 `chromadb` 包 `src/` 与 README grep `react-native|reactnative` → **0 命中**。

**进程模型**：**需要独立服务器**（`npx chroma run` / Docker `chromadb/chroma` / Chroma Cloud）。

---

### 4. usearch（unum-cloud/USearch）

**GitHub API**（2026-09-26 抓取）：
```json
{"full_name":"unum-cloud/USearch","stargazers_count":4320,"pushed_at":"2026-08-31T22:47:21Z",
 "archived":false,"license":{"spdx_id":"Apache-2.0"},"default_branch":"main"}
```

**npm `usearch@2.26.2`**：`license` = `"Apache 2.0"`（npm 字段原文，非标准 SPDX 串，实际即 Apache-2.0），`engines` `{"node":">=22"}`，
`dependencies` = `bindings ^1.5.0`、`node-addon-api ^8.5.0`、`node-gyp-build ^4.8.4`；
`scripts.install` = `"node-gyp-build"`；`main` = `javascript/dist/cjs/usearch.js`。
`unpackedSize` **25226850**，`fileCount` **544**。**包内 0 个 `.wasm`。**

**npm 包 = 原生 NAPI** —— 包内 `prebuilds/` 逐字：
```
package/prebuilds/darwin-arm64+x64/usearch.node
package/prebuilds/linux-arm64/usearch.node
package/prebuilds/linux-x64/usearch.node
package/prebuilds/win32-x64/usearch.node
package/binding.gyp
package/javascript/lib.cpp
```
`package/javascript/usearch.ts` 逐字：
> "require(__dirname + \"/../../../prebuilds/darwin-arm64+x64/usearch.node\");"
> "require(__dirname + \"/../../../prebuilds/linux-x64/usearch.node\");"
> "require(__dirname + \"/../../../build/Release/usearch.node\");"

**JS README（`package/javascript/README.md`）逐字**：
> "USearch is a high-performance library for building and querying vector search indexes, optimized for Node.js and WASM environments."
> "## Installation
> For Node.js environments, install USearch using `npm`:
> `npm install usearch`"

→ 只给了 Node.js 安装方式，**没有浏览器安装方式**。

**WASM = 官方 GitHub Release 附件，但是 WASI/Wasmer 模块（非浏览器 JS 绑定）**：
仓库根 README banner 逐字：
> "Linux • macOS • Windows • iOS • Android • **WebAssembly** •"

仓库根 `wasmer.toml` 逐字：
> "name = \"unum/usearch\""
> "[[module]]
>  name = \"index\"
>  source = \"build/wasm/index.wasm\""

Release v2.26.2 资产列表（`github.com/unum-cloud/USearch/releases/expanded_assets/v2.26.2`）包含：
```
usearch_wasm_2.26.2.tar.gz
usearch_wasm_2.26.2.zip
usearch_android_arm32_2.26.2.zip
usearch_android_arm64_2.26.2.zip
usearch_linux_amd64_2.26.2.so
usearch_macos_arm64_2.26.2.zip
usearch_sqlite_linux_amd64_2.26.2.so
...
```
实测下载 `usearch_wasm_2.26.2.zip`（52 KB）解包内容：
```
libusearch_c.so     243420 B
usearch.h            25648 B
```
`file libusearch_c.so` 输出：
> "usearch_wasm_x/libusearch_c.so: WebAssembly (wasm) binary module version 0x1 (MVP)"

→ 确实是 wasm 模块（只是文件名叫 `.so`），但它是 **WASI 目标**（配 `wasmer.toml`，发布在 wasmer.io），**不是浏览器可直接 `<script>` 用的 JS 绑定**。
仓库 `wasm/` 目录只有 4 个文件：`wasm/CMakeLists.txt`、`wasm/README.md`、`wasm/lib.cpp`、`wasmer.toml`；`wasm/README.md` 全文是**空壳**：
> "# USearch for WebAssembly
> ## Installation
> ```txt
> https://github.com/unum-cloud/USearch
> ```
> ## Quickstart
> ```wolfram
> ```"

**React Native —— 靠社区 JSI 包装（非官方）**：
- `expo-vector-search`（mensonones）：npm latest **0.5.2**，license `MIT`，`unpackedSize` 1170725，`fileCount` 47，`modified` 2026-02-15。
  GitHub `ungh.cc/repos/mensonones/expo-vector-search`：56★，pushed 2026-07-26，description 逐字：
  > "High-performance on-device vector search engine for Expo & React Native. Powered by C++ JSI and USearch (HNSW) for sub-millisecond similarity matching."
  README 逐字：
  > "├── modules/
  > │   └── expo-vector-search/ # Core Engine (Native Module)
  > │       ├── ios/            # Swift & C++ bindings for iOS
  > │       ├── android/        # Kotlin & C++ (JNI) for Android"
  > "**Blazing Fast On-Device Search**: Sub-millisecond similarity search over 10,000+ vectors using the HNSW algorithm."
- `react-native-edge-vector-store`：npm latest **0.1.0**，license `MIT`，`unpackedSize` 1119531，`fileCount` 83，`modified` 2026-03-12，description 逐字：
  > "Unified on-device vector store for React Native — USearch ANN + SQLite metadata + .evs pack format"
  repo = `github.com/subham11/edge-vector-store`

→ 这两个都是**第三方**，且是 **JSI 原生模块**（不是 npm `usearch` 包直接可用）。

**进程模型**：嵌入式 in-process。

---

### 5. hnswlib（nmslib/hnswlib + 两个社区绑定）

**GitHub 元数据**：`api.github.com/repos/nmslib/hnswlib` 在抓取时**命中限流**（`API rate limit exceeded`）。
改用 `ungh.cc/repos/nmslib/hnswlib`（GitHub 数据代理）：
```json
{"repo":{"id":96431386,"name":"hnswlib","repo":"nmslib/hnswlib",
 "description":"Header-only C++/python library for fast approximate nearest neighbors",
 "createdAt":"2017-07-06T13:08:46Z","updatedAt":"2026-09-25T10:27:19Z",
 "pushedAt":"2026-09-15T11:56:10Z","stars":5334,"watchers":69,"forks":845,"defaultBranch":"master"}}
```
**archived**：对 `github.com/nmslib/hnswlib` HTML grep `Public archive|This repository has been archived` → **0 命中**（即未归档）。
**许可证**：`raw.githubusercontent.com/nmslib/hnswlib/master/LICENSE` 首行逐字：
> "                                 Apache License
>                            Version 2.0, January 2004
>                         http://www.apache.org/licenses/"

**`hnswlib-node@3.0.0`（原生 NAPI）**：`license` `Apache-2.0`，`dependencies` = `bindings ^1.5.0`、`node-addon-api ^8.0.0`，`unpackedSize` 195898，`fileCount` 16，`modified` **2024-03-11**。
tarball 实际内容（16 文件）逐字：
```
package/src/addon.cc
package/binding.gyp
package/src/hnswlib/hnswalg.h
package/lib/index.js
package/LICENSE.txt
```
→ `binding.gyp` + `addon.cc` = 需要本地编译的原生 Node addon（无 prebuilds，无 `.wasm`）。
GitHub `yoshoku/hnswlib-node`（ungh）：138★，pushed **2026-09-25**，description "hnswlib-node provides Node.js bindings for Hnswlib"。
→ **社区第三方**（作者 yoshoku），非 nmslib 官方。

**`hnswlib-wasm@0.8.2`（Emscripten WASM）**：`license` `Apache-2.0`，`dependencies` = null，`unpackedSize` 3049318，`fileCount` 21，`modified` **2023-07-08**。
README 逐字：
> "This is a WebAssembly (Wasm) version of the [hnswlib](https://github.com/nmslib/hnswlib) index library written in C++. This Wasm port was created by @ShravanSunder using the emcc Wasm compiler"

> "> Note: This library is still in its early days! It is being built for a use case that requires running hnswlib in the browser."

> "`hnswlib-wasm` provides wasm bindings for [Hnswlib](https://github.com/nmslib/hnswlib) that implements approximate nearest-neighbor search based on hierarchical navigable small world graphs. **It works in browsers and is compiled with Emscripten.**"

> "The major differences are in loading and saving the index. **It supports `indexedDB` (in browser)** and uses FS from Emscripten to save and load the index via the virtual file system and IDBFS."

> "Since hnswlib-wasm is running in the browser, you should consider the available memory and performance limitations."

`package.json` 的 `keywords` 逐字：`"wasm"`, `"emscripten"`；`devDependencies` 含 `"vite-plugin-wasm": "^3.2.2"`、`"@types/emscripten": "^1.39.6"`。

**实测 WebAssembly API 调用**（对 tarball 内 `package/dist/hnswlib-317962d7.js` grep）：
```
   2 hw/package/dist/hnswlib-317962d7.js:WebAssembly.instantiateStreaming
   1 hw/package/dist/hnswlib-317962d7.js:WebAssembly.instantiate
   1 hw/package/dist/hnswlib-317962d7.js:WebAssembly.Module
   2 hw/package/dist/hnswlib-317962d7.js:WebAssembly.RuntimeError
   2 hw/package/dist/hnswlib-317962d7.js:WebAssembly.Exception
```
注意：**该 npm 包内没有 `.wasm` 文件**（21 个文件里 grep `\.wasm` → 0 命中），wasm 二进制由消费方构建/从 CDN 取。
GitHub `ShravanSunder/hnswlib-wasm`（ungh）：64★，pushed **2023-07-21**（**约 3 年未更新**），description "hnswlib-wasm attempts to create a browser friendly version of hnswlib"。
→ **社区第三方**（作者 ShravanSunder）。

**React Native**：README 只提 browser + IndexedDB + Emscripten FS；对两个包的 README grep `react native` → **0 命中**。**未查到**任何 RN 包装或支持声明。

**进程模型**：嵌入式 in-process。

---

### 6. DuckDB VSS（duckdb/duckdb + duckdb/duckdb-vss）

**GitHub 元数据**：`api.github.com/repos/duckdb/duckdb` 抓取时**命中限流**。
改用 `ungh.cc/repos/duckdb/duckdb`：
```json
{"repo":{"id":138754790,"name":"duckdb","repo":"duckdb/duckdb",
 "description":"DuckDB is an analytical in-process SQL database management system",
 "createdAt":"2018-06-26T15:04:45Z","updatedAt":"2026-09-26T04:28:50Z",
 "pushedAt":"2026-09-25T19:09:44Z","stars":41713,"watchers":279,"forks":3826,
 "defaultBranch":"v2.0-cyanoptera"}}
```
**archived**：对 `github.com/duckdb/duckdb` HTML grep `Public archive|This repository has been archived` → **0 命中**（未归档）。
**许可证**：`raw.githubusercontent.com/duckdb/duckdb/main/LICENSE` 首行逐字：
> "Copyright 2018-2026 Stichting DuckDB Foundation
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, ..."

→ MIT 正文。npm `duckdb` / `@duckdb/node-api` / `@duckdb/duckdb-wasm` 的 `license` 字段均为 `"MIT"`。

`duckdb/duckdb-vss`（ungh）：267★，pushed **2026-09-25**；`LICENSE` 首行逐字 "Copyright 2018-2025 Stichting DuckDB Foundation" + 同一 MIT 正文。

**npm 包**：
| 包 | latest | license | 关键依赖 | unpackedSize | fileCount | modified |
|---|---|---|---|---|---|---|
| `duckdb`（**已弃用**） | 1.4.4 | MIT | `@mapbox/node-pre-gyp ^2.0.0`, `node-addon-api ^7.0.0`, `node-gyp ^9.4.1` | 61204393 | 4416 | 2026-01-30 |
| `@duckdb/node-api` | 1.5.5-r.5 | MIT | `@duckdb/node-bindings 1.5.5-r.5` | 651541 | 365 | 2026-09-13 |
| `@duckdb/duckdb-wasm` | 1.33.1-dev57.0 | MIT | `qs ^6.14.1`, `apache-arrow ^17.0.0` | **149377663** | 85 | 2026-07-28 |

`duckdb` 包 README 逐字（弃用警告）：
> "> [!WARNING]
> > The original DuckDB <> Node.js bindings in this package are deprecated in favor of the new and shiny `@duckdb/node-api` package. Currently, the plan is to release this package `duckdb-node` for the last time for the DuckDB 1.4.x (~Fall 2025) series but *not* for the DuckDB 1.5.x series (~Early 2026) any more."

**WASM 实测**：`@duckdb/duckdb-wasm@1.33.1-dev57.0` tarball（31 MB）实际文件列表：
```
package/dist/duckdb-coi.wasm
package/dist/duckdb-eh.wasm
package/dist/duckdb-mvp.wasm
package/dist/duckdb-browser-coi.pthread.worker.js
package/dist/duckdb-browser-coi.worker.js
package/dist/duckdb-browser-eh.worker.js
package/dist/duckdb-browser-mvp.worker.js
```
→ 3 个真实 `.wasm` + 4 个 browser worker JS。`@duckdb/node-api` 包内 **0 个 `.wasm`**（365 文件）。

**VSS 在 WASM 构建里可用 —— 实测 HTTP 下载验证**：
```
v1.5.0/wasm_mvp/vss.duckdb_extension.wasm     -> 200 360139
v1.4.0/wasm_mvp/vss.duckdb_extension.wasm     -> 200 356942
v1.3.0/wasm_mvp/vss.duckdb_extension.wasm     -> 200 354638
v1.5.0/wasm_eh/vss.duckdb_extension.wasm      -> 200 403004
v1.4.0/wasm_eh/vss.duckdb_extension.wasm      -> 200 398402
v1.3.0/wasm_eh/vss.duckdb_extension.wasm      -> 200 394336
v1.5.0/wasm_threads/vss.duckdb_extension.wasm -> 200 359726
v1.4.0/wasm_threads/vss.duckdb_extension.wasm -> 200 356581
v1.3.0/wasm_threads/vss.duckdb_extension.wasm -> 200 354244
```
下载 `v1.5.0/wasm_mvp/vss.duckdb_extension.wasm` 后 `file` 输出：
> "vss.wasm: WebAssembly (wasm) binary module version 0x1 (MVP)"
（大小 360139 B）

**官方文档逐字**（`duckdb.org/docs/current/clients/wasm/extensions.html`）：
> "A growing subset of extensions is supported for DuckDB-Wasm, spanning core extensions, community extensions, and external extensions. Most are fetched on the fly when they are autoloaded or explicitly loaded, rather than being bundled into the DuckDB-Wasm binary."

同页 "The core extensions commonly used with DuckDB-Wasm include:" 的表格列出：`autocomplete`、`excel`、`fts`、`icu`、`inet`、`json`、`parquet`、`spatial`、`sqlite`、`tpcds`、`tpch` —— **`vss` 不在这份「常用」列表里**（但可下载到 wasm 构建，见上）。

同页关于扩展加载机制逐字：
> "An extension in DuckDB-Wasm is a regular Wasm binary with a cryptographical signature appended to the Wasm file as a WebAssembly custom section called `duckdb_signature`."
> "The `LOAD` operation will fetch (and decompress on the fly), perform signature checks and dynamically load via the Emscripten implementation of `dlopen`."

**官方博客逐字**（`duckdb.org/2024/05/03/vector-similarity-search-vss.html`，2024-05-03）：
> "The extension can currently be installed on DuckDB v0.10.2 on all supported platforms (**including Wasm!**) by running `INSTALL vss; LOAD vss`."

同文 Implementation 段逐字（VSS 的实现基础）：
> "The `vss` extension is based on the [`usearch`](https://github.com/unum-cloud/usearch) library, which provides a flexible C++ implementation of the HNSW index data structure boasting very impressive performance benchmarks."

同文 Limitations 段逐字：
> "The big limitation as of now is that the `HNSW` index can only be created in in-memory databases, unless the `SET hnsw_enable_experimental_persistence=bool` configuration parameter is set to `true`."
> "In particular, WAL recovery is not yet properly implemented for custom indexes, meaning that if a crash occurs or the database is shut down unexpectedly while there are uncommitted changes to a `HNSW`-indexed table, you can end up with data loss or corruption of the index."
> "At runtime however, much like the `ART` the `HNSW` index must be able to fit into RAM in its entirety, and the memory allocated by the `HNSW` at runtime is allocated \"outside\" of the DuckDB memory management system, meaning that it won't respect DuckDB's `memory_limit` configuration parameter."

**React Native**：**未查到**任何 RN 路径（无 RN 绑定包，官方文档无 RN 章节）。

**进程模型**：嵌入式 in-process（native 与 wasm 均是；DuckDB 自述 "analytical in-process SQL database management system"）。

---

## 未查到

1. **hnswlib 与 duckdb 的 `api.github.com` 权威字段**：抓取时 GitHub API 未认证限流（`{"message":"API rate limit exceeded for 146.70.117.114."}`，core limit 60、remaining 0、reset 1790402515）。二者 stars / pushed_at 来自 `ungh.cc`（GitHub 数据代理），`archived` 来自 GitHub HTML 页面 grep，`license.spdx_id` 来自仓库 LICENSE 原文与 npm 字段，**未取到 GitHub API 的 `license.spdx_id` 原始 JSON**。
2. **hnswlib-wasm 在 React Native 上能否运行**：未查到任何 RN 包装、issue 或官方声明。该库依赖 browser IndexedDB/IDBFS，RN 无 IndexedDB。
3. **hnswlib-node 在 React Native 上能否运行**：未查到任何 RN 包装或 issue。
4. **LanceDB 是否有任何 React Native 支持**：未查到官方文档、issue 或包；全仓 781 文件 grep 无 RN 相关文件。
5. **LanceDB 浏览器 WASM 的最终状态**：PR #3247 实测为 **Closed**（HTML grep `Closed</span>`，未命中 `Merged`），但**未查到官方对关闭原因的说明**；`@lancedb/lancedb-web` npm 404。因此「LanceDB 浏览器支持 = 无」是当前事实，但官方未来路线未查到。
6. **Chroma `@chroma-core/default-embed` 的 SPDX 许可证**：npm `license` 字段为 **null**；其上游 `chromadb-default-embed` 为 Apache-2.0，`@huggingface/transformers` 为 Apache-2.0，但该包自身**未查到**明确 SPDX 声明。
7. **Hermes WASM 是否在 React Native 0.84 的 Hermes V1 中默认可用**：官方 RN 0.84 发布博客全文未提 WebAssembly；tmikov 博客的运行示例全部使用内部测试开关 `-Xhermes-internal-test-methods`，并自述 "not yet ready for production use"。**未查到** Meta 官方声明「RN 中的 Hermes 已默认启用 WebAssembly」。
8. **`usearch` npm 包是否有官方浏览器 JS 入口**：JS README 只给 Node.js 安装方式；官方 WASM 产物是 Wasmer/WASI 模块（GitHub Release 附件），**未查到**第一方浏览器 `<script>`/bundler 可用的 JS 包或 npm 包名。
9. **sqlite-vec 在 Expo Web（Metro + WASM）与原生（bundledExtensions）两条路径的具体差异**：Expo 文档确认 web 需要 Metro 支持 wasm 文件，native 走 `bundledExtensions` 原生库；**未查到** Expo 对两者能力差异的完整说明。
10. **各候选在 Hermes 上的实测运行结果**：本次验证为文档/包内容层面的静态取证，**未在任何 Hermes 运行时上实际执行**。

---

## 关键判据小结（仅陈述可验证事实，不含推荐）

- **唯一同时满足「浏览器 + React Native/Hermes 原生 + Node」且不依赖 WASM 的候选：`sqlite-vec`** —— 有官方 Android/iOS 预编译库、官方文档点名 op-sqlite、Expo 官方 `withSQLiteVecExtension` 配置项。浏览器侧才需要 WASM（独立包 `sqlite-vec-wasm-demo`）。
- **`usearch`**：Node 侧原生 NAPI；RN 侧只有社区 JSI 包装（`expo-vector-search` 56★ / `react-native-edge-vector-store`）；官方 WASM 是 WASI/Wasmer 模块，不是浏览器 JS 绑定。
- **`ChromaDB`**：JS 客户端是纯 HTTP，必须跑独立服务器（`npx chroma run`）；JS 无 embedded 路径；默认 embedding function 走 ONNX Runtime WASM。
- **`LanceDB`**：只有 NAPI-RS 原生绑定；浏览器 WASM PR 已 Closed；无 RN 支持。
- **`hnswlib`**：`hnswlib-node` 原生（社区，需本地编译，无 prebuilds）、`hnswlib-wasm` Emscripten WASM（社区，2023-07 后未更新，依赖 IndexedDB）；无 RN 包装。
- **`DuckDB VSS`**：WASM 构建里 VSS 扩展可下载且实测是合法 wasm 模块（360139 B）；但 `@duckdb/duckdb-wasm` 包体积 **149377663 B**；`duckdb` npm 包已弃用；无 RN 路径。
