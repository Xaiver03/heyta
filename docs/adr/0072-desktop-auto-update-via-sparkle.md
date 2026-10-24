# ADR-0072：桌面自动更新走 Sparkle（macOS 首发），appcast 自托管

- **状态**：已接受（2026-10-24）
- **日期**：2026-10-24
- **编号说明**：本 ADR 与**同日并行线**那一份「共享清单的系统通知，正文只许出现清单名 + 活动种类」
  （`docs/adr/` 下的 `0071-share-notification-content-boundary`；此处刻意**不加链接** —— 那份此刻
  尚未 `git add`，而 `check:docs` 会把"本机有、git 里没有"的目标判成死链）
  **同一天各自写出**，编号曾一度冲突。**本单让号到 0072** —— 0071 那一份已在
  其正文里被另一条线引用，改它的代价比改这份大。⇒ 读到"ADR-0071"时要看标题，不要只看号。
- **相关**：[ADR-0024](0024-desktop-shell-and-ui-convergence.md)（桌面壳选型；其 §尾部自述「签名、公证、自动更新成本本次**完全未调研**」—— 本单就是补那一格）、
  [ADR-0037](0037-desktop-ui-falls-back-to-webview.md)（桌面 UI 退 M2，壳与 UI 的职责分工）、
  [ADR-0057](0057-native-system-library-linking.md)（原生依赖要进登记册并双向对账）、
  [AGENTS.md](../../AGENTS.md) §3.1（可维护性门槛）与 §3.2（许可证白名单）

> 📌 **本 ADR 只决定"用什么、按什么契约"**。它**不**等于"heyta 已经能自动更新" ——
> app 侧把 Sparkle 链进 `apps/desktop-macos` 之前，自动更新仍然是**未做**。
> 判据见 §五第 6 条。

---

## 一、要解决的问题

桌面端一旦发出去就**停在发出去的那一版**：用户装了 1.0.0，之后每一次修复都要他
自己去下载站再下一遍、再拖一次 Applications。对一个"本地优先、可以自托管"的产品，
这格外说不过去 —— 服务端是用户自己的，客户端却是冻结的。

**🔴 先纠正一句流传中的理由**：`docs/runbooks/desktop.md` 曾写"签名 / 公证 / 安装器 /
自动更新这四项都要等**证书**到位"。这一句**已经过期**，本单实测过：

| 项 | 实测（2026-10-24，`security find-identity -v -p codesigning`） |
|---|---|
| Developer ID Application | ✅ `Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd. (V5S2LT9YV8)` |
| Apple Distribution | ✅ 同一主体 |
| ASC API key（公证用） | ✅ `~/Library/Private/AppStoreConnect/AuthKey_T2H876K8MJ.p8` |

⇒ 签名与公证**不是**阻塞项（`apps/desktop-macos/scripts/package-app.sh` 第 ③⑥ 步已实现并跑过）。
**剩下的只有"更新器"这一格**，本 ADR 决定它。

## 二、三个选项与结论

| 选项 | 内容 | 判定 |
|---|---|---|
| 甲 | 链 **Sparkle 2**（SwiftPM），appcast 自托管，ed25519 签名 | ✅ **采用** |
| 乙 | 自写更新器（自己拉 feed、下载、验签、挂载、换包、重启） | ❌ 否。**安全更新是"错一次就失守"的那类代码**：验签时序、TOCTOU（验完到安装之间产物被换）、降级攻击（feed 里塞旧版本号）、挂载点冲突、失败回滚，每一条都要自己想全。Sparkle 把这些踩了 15 年（2009 年至今）。省一个依赖换来一块我们自己审不动的代码，不划算 |
| 丙 | 不做，让用户手动下载 | ❌ 否。缺陷修复到不了用户机器 = 修复等于没修。这是分发能力，不是锦上添花 |

**为什么甲是"接近必需"而不是"可选项"**：走 App Store 之外的分发（本产品的自托管定位决定的），
macOS 上没有系统级替代品，Sparkle 就是这个生态的事实标准。

## 三、依赖准入：两道门逐条实测（不靠印象）

`AGENTS.md` §3.1 / §3.2 要求先过门再引入，此处记下取数方式：

| 门 | 判据 | 实测 |
|---|---|---|
| §3.1 可维护性 | 2021 年之后仍在更新 | ✅ **远超**：GitHub 上 `Package.swift` 随 2.10.0 更新于 **2026-09-13**，最近提交 **2026-10-19**；CocoaPods 上最新 **2.9.4（2026-07）** |
| §3.2 许可证 | 白名单内 | ✅ **MIT**（官网与仓库 LICENSE 一致；CocoaPods 标注 MIT）。MIT 在白名单内 ⇒ 自动通过 |
| 附带 | 与现有壳兼容 | ✅ 支持 **SwiftPM**（`apps/desktop-macos` 正是 SwiftPM 工程）；要求 macOS 12+，而壳的 `LSMinimumSystemVersion` 是 **14.0** ⇒ 无冲突 |

登记义务落在 [`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md)（已登记）。

## 四、裁决（六条）

1. **签名算法 = 对产物字节的纯 ed25519（RFC 8032），结果 base64，写进 `sparkle:edSignature`。**
   🔴 **不是** sha512 摘要的签名（那是 Sparkle 1 的 DSA 时代留下的印象，猜错就是坏更新）。
   两处独立来源核对一致：go-sparkle 的 README 明写「Sparkle 2.x signs updates with plain
   ed25519 (RFC 8032) over the **artifact bytes**」并声明与官方 `sign_update` 逐字节可互换；
   Sparkle 的 `sign_update` 实现是 `Data(contentsOf:)` 整文件读入后 `ed25519_sign`。
2. **`sparkle:version` 是 build 号**（`CFBundleVersion`），不是展示版本号。写成 `"1.0.1"`
   这种展示串会让 Sparkle 的版本比较给出错误的新旧顺序 ⇒ 用户会收到"更新"到旧版。
3. **feed 自托管**，与产品"可自托管"的定位一致；不绑定任何第三方更新托管服务。
   发布侧工具 [`scripts/appcast/sparkle-appcast.mjs`](../../scripts/appcast/sparkle-appcast.mjs)
   负责密钥 / 签名 / 渲染 appcast / 验签，其 `--self-test` 含**负例臂**（产物改一个字节
   必须验签失败 —— 一条永远通过的判据比没有判据更糟）。
4. **私钥只住在本机** `~/.heyta/sparkle-ed25519.key`（0600，仓库外，**不进 git**）；
   打进 app 的只有公钥 `SUPublicEDKey`。
   🔴 **丢了私钥 = 永远发不出下一个版本**（用户端验签不过，只能另起一对并让用户重装）。
5. **只 macOS 首发**。Windows / Linux 两端**本单不决定**：这两个平台没有像 Sparkle 这样的
   单一事实标准（WinSparkle 是另一个项目、Linux 端则发行版打包通常接管更新），
   要等到那两端真的要发原生安装包时另写 ADR。**本 ADR 不构成对那两端的承诺。**
6. 🔴 **不许把"发布侧已备"说成"自动更新已做"**。真正的完成判据是**一条从 app 里发起的
   真更新**：装一个旧版本号的包 → 它能从 feed 发现新版本 → 下载 → 验签 → 装上 → 重启后
   报的是新版本号。**在这条跑通之前，任何文档与对话里都只能写"未做"。**

## 五、代价与已知边界

1. **产物体积**：Sparkle 是一个 framework + XPC 服务，会让 `.app` 变大（量级待实测，
   不在此处写数 —— 本仓纪律是"别抄读数"）。相对 Electron 系的 100 MB+ 仍是一个零头。
2. **壳目前不是沙箱应用**（`entitlements.plist` 里只有 `allow-jit` /
   `allow-unsigned-executable-memory` / application-groups / keychain-access-groups，
   **没有** `com.apple.security.app-sandbox`）。Sparkle 两者都支持，但**若将来开沙箱**，
   要同步补 `com.apple.security.network.client` 与 Sparkle 的 XPC 服务配置 —— 那是新的一次决策。
3. **公证依赖没变**：更新产物同样要走 Developer ID 签名 + 公证，否则 Gatekeeper 会拦新版本。
   ⇒ 发布流程是"打包 → 签名 → 公证 → **再**用 Sparkle 私钥签一遍 → 渲染 appcast"，
   **顺序不能反**（公证会改产物字节吗？不会 —— 票据是外挂的；但保险起见签名必须在
   产物定稿之后）。
4. **降级与回滚**：Sparkle 的 feed 里保留旧 item 是允许的，但**本单不做自动回滚** ——
   回滚由"再发一个新版本"承担。
5. **本 ADR 不解决"用户从哪知道要重启"**：那是 Sparkle 自己的 UI，属于它的既有行为。
