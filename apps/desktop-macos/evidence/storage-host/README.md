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

## 如实记边界（别读多）

1. **只验了"壳侧托管"这一半**：`AppApi.openOpLog` / `handleHostMessage` + `heyta-smoke`。
   **还没做**的是 **WKWebView 的接线**（`WKUserScript` 注入 shim + `WKScriptMessageHandler`
   转发 + `app` 模式跳过 `open()` + 证据里的 `STORAGE=`）——
   而它又受一条硬约束：**WKWebView 没有 CDP**，所以"页侧真的选了 shell 后端"这件事
   不能照搬 Windows 的 Playwright 附着来验（见 handoff §5/§6）。
2. **`appendLocal` 的 `args` 是位置参数表**，要套两层（`[[op]]`）。少一层会把单个 op
   当数组用，症状是 `is not iterable` —— 第一版就是这么错的，而这条断言当场抓住了它。
3. **`markUploaded` 的 `ReadonlyMap` 过不了裸 JSON**，必须有线码；那一格由
   `packages/storage/tests/contract.spec.ts` 的「宿主边界」契约项担保（252/252），
   这里不重复造断言。
4. 没有截图：这一格是**无头**冒烟（不开窗），所以它证明的是"跨语言 + 真落盘"，
   不证明"界面画出来了"。窗口那一格由 `check:macos-window` 负责。
