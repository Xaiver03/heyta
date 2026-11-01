# 凭据与签名资产：**在这儿找，不要问人**

本目录与这份清单存在的唯一理由：**凭据不该只活在某个人的家目录里，更不该靠记忆**。
下一个 agent（或半年后的我）应当能在仓库里查到"这张证书在哪、签的是哪个包、什么时候过期"。

🔴 **规则**：签名**私钥**不进 git；但**指纹、路径、过期时间、用哪个包**必须进 git。
凭证本体放本机固定位置，位置写在这里 —— 这就是"固化"。

---

## 一、macOS（Developer ID）

| 项 | 值 |
|---|---|
| 文件 | [`credentials/macos/developer-id.provisionprofile`](macos/developer-id.provisionprofile)（**在仓库里**） |
| 名称 | heyta macOS Developer ID |
| Team | `V5S2LT9YV8` |
| App ID | `V5S2LT9YV8.cloud.finlaw.heyta.desktop` |
| 平台 / 类型 | `OSX` · `ProvisionsAllDevices`（Developer ID，非设备绑定） |
| 过期 | **2044-10-03** |
| 证书 | `Developer ID Application: Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd. (V5S2LT9YV8)`（在登录钥匙串里） |

查找顺序写死在 [`apps/desktop-macos/scripts/find-signing-profile.py`](../apps/desktop-macos/scripts/find-signing-profile.py)：
**仓库 `credentials/macos/` → `~/Library/MobileDevice/Provisioning Profiles` → `~/Library/Developer/Xcode/UserData/Provisioning Profiles`**。

⚠️ 那枚脚本解码 profile 时**不能只信 `security cms -D`**：它要碰钥匙串，在沙箱/CI 里会报
`cert import failed: UNIX[Operation not permitted]`，**而退出码仍是 0**。只信它的版本会把每一枚
profile 读成空 ⇒ 静默跳过 ⇒ 报"缺 profile"。2026-11-01 真的这样误判过一次（profile 一直在
`tmp/desktop-dist/Heyta.app` 里、有效期到 2044）。现在它第二跳走 `openssl cms -verify -noverify`。

## 二、Android（release keystore）

| 项 | 值 |
|---|---|
| keystore | `~/.heyta-signing/heyta-release.keystore`（**不进 git**，`0600`） |
| 别名 | `heyta` |
| 四个键在哪 | `~/.gradle/gradle.properties` 的 `HEYTA_RELEASE_STORE_FILE` / `HEYTA_RELEASE_STORE_PASSWORD` / `HEYTA_RELEASE_KEY_ALIAS` / `HEYTA_RELEASE_KEY_PASSWORD` |
| 期望证书 | 见 `scripts/verify-android-signing-identity.mjs` 的期望指纹（与 keystore 同源） |

`apps/mobile/android/app/build.gradle` 依次读 **gradle 属性 → 环境变量**；四键齐了才用
`signingConfigs.release`，缺一个就**静默退回 `signingConfigs.debug`** —— 症状是 APK 装得上、
但证书是 `CN=Android Debug`（供应链那一格，见 `docs/plans/launch-blockers.md` B5）。

## 三、iOS

签名走 Xcode 自动管理（Team 同 `V5S2LT9YV8`）。本机钥匙串里已有对应证书，
但 **2026-11-01 的构建被 agent 执行沙箱拦在 `~/Library/Caches` 与 `DerivedData`**，
不是缺凭据 —— 换到可写缓存的环境即可。

## 四、Windows（MSIX 自签）

| 项 | 值 |
|---|---|
| 证书 | `dist/windows/heyta-selfsigned.cer`（公钥在仓库里，够装机用） |
| 私钥 | 在签名机的证书存储里，不进 git |
| 注意 | 自签包只在开发机可信；装机截图必须**当次**产出（旧图不算证据） |

## 五、加新凭据时

1. 私钥放本机固定路径（`~/.heyta-signing/` 这一类），`chmod 600`；
2. 把**路径、用途、指纹、过期**写进本文件；
3. 让工具**按固定顺序去找它**，不要让人记；
4. 跑一遍对应的 `verify:*` 判据，确认**拿得到**（拿不到要红，不许静默跳过）。
