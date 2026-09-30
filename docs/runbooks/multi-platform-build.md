# 多端构建操作手册

> 本文件回答**"怎么把某一端打出来"**。
> 各平台的条件、版本、产物路径、当前状态见
> [`../reference/build-matrix.md`](../reference/build-matrix.md) —— 那里是事实源，
> 这里只讲步骤，不重复数值。
>
> 架构上为什么能多端，见 [ADR-0003](../adr/0003-multi-platform-strategy.md)。

---

## 0. 通用前置

### 0.1 先构建 workspace 包，再打包

🔴 **这一步不能省，也不能只跑一次。**

`apps/mobile` 通过 `@heyta/app-host` 等 workspace 包消费 `packages/*`，
而它们的入口是 `dist/index.js`。Metro 不做别名映射，所以：

```
packages/*/dist  →  Metro 打包进 JS bundle  →  进 APK / .app
```

**只改 `packages/` 而不重新 `build`，打出来的包里是旧代码。**
这不是理论风险 —— 仓库真的踩过：注入一个 bug 后 `assembleRelease` 报
BUILD SUCCESSFUL（12 秒，打包任务被跳过），装到模拟器上验收 40/0 全绿，
因为设备跑的是没 bug 的旧代码。

```bash
pnpm -r build      # 第一步，永远先跑这个
```

### 0.2 装机：一台干净机器要装什么

| 目标平台 | 需要装 |
|---|---|
| Android | JDK 21、Android SDK（platform-tools / platforms;android-36 / build-tools;36.0.0 / ndk;27.1.12297006 / cmake;3.22.1）、Node ≥22、pnpm |
| iOS | **macOS + Xcode 27.1 + CocoaPods**（iOS 构建不可能在 Windows/Linux 上做） |
| Windows 桌面 | Windows + VS Build Tools + C++ 工作负载 + Node |
| HarmonyOS | DevEco Studio + ohpm + Node |

Windows 打包机用**一个脚本**搞定（幂等，可反复跑）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\setup-build-host.ps1
# 分步：-Step base | android-studio | vs-buildtools | verify
# 体检：-Step verify      # 只输出一张 ✅/❌ 表，不改任何东西
```

### 0.3 门禁与构建的关系（容易误解）

`pnpm check` 跑的是**类型 + 分层 + 许可证 + 文档 + 原生依赖对账**等门禁，
它**不做平台打包**。本仓库已经三次踩到"门禁全绿但打不出包"：

| 陷阱 | 表现 |
|---|---|
| `.js` 扩展名的相对导入 | 单测全绿，Release 打包红（`AGENTS.md` §7 第 28 条） |
| `IPHONEOS_DEPLOYMENT_TARGET = 12.4` | Android 没事，iOS 构建被拦（第 31 条） |
| 只改 `packages/` | Gradle UP-TO-DATE，打进旧 bundle（第 27 条） |

**结论：门禁绿 ≠ 能打包。构建必须单独跑、单独验。**

---

## 1. Android

### 1.1 本机（macOS）

```bash
pnpm -r build
pnpm build:android            # Release APK
```

产物：

```
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

上架用的 AAB：

```bash
pnpm --filter @heyta/mobile run build:android:bundle
# → app/build/outputs/bundle/release/app-release.aab
```

### 1.2 Windows 打包机

同样的命令，但要在 Windows 的 shell 里跑，且仓库在 `C:\src\heyta`。

```powershell
# 1) 连上（Mac 侧）
ssh windows-pc

# 2) 在 Windows 上
cd C:\src\heyta
pnpm install
pnpm -r build
pnpm build:android
```

> ⚠️ Windows 上的 Gradle wrapper 叫 `gradlew.bat`。**不要**在脚本里写 `./gradlew`：
> 实测在 Windows 上必然失败（`'.' 不是内部或外部命令`）。仓库已改为统一走
> `node scripts/run-gradle.mjs <task>`，由 Node 按平台选 `gradlew.bat` / `./gradlew`，
> 所以上表的命令在两个平台上逐字相同。新增 Gradle 脚本时照这个来。

**仓库怎么落到 Windows 上**（`C:\src\heyta` 不是靠 `git clone` 得来的）：
GitHub 在 Windows 上必须经代理，而 `git clone` 私有仓库还需要凭据
（PAT 或 deploy key），这台机器上**没有配**。当前做法是把 Mac 的工作树打成源码包送过去：

```bash
# Mac 侧：导出当前工作树（含未提交改动），排除 node_modules 与已提交的 npm 缓存
git add -A && git write-tree
git archive <tree> -- . \
  ':(exclude)research/standalone/.npm-cache' \
  ':(exclude)research/standalone/sync-core/.npmcache2' | gzip -1 > /tmp/heyta-src.tar.gz
scp /tmp/heyta-src.tar.gz scripts/windows/bootstrap-repo.ps1 windows-pc:C:/src/
```

```powershell
# Windows 侧
powershell -NoProfile -ExecutionPolicy Bypass -File C:\src\bootstrap-repo.ps1 -Force
```

脚本会解包、`git init -b main`、打一个本地基线 commit，并把 `origin` 指到
`git@github.com:Xaiver03/heyta.git`。**这是一个本地基线，不是上游历史。**
等这台机器配上凭据后，用下面两条回到上游（`bootstrap-repo.ps1` 结尾也会打印）：

```bash
git fetch origin && git reset --hard origin/main
```

### 1.3 验证产物真的对了（三步）

**不要只看 `BUILD SUCCESSFUL`。** 按顺序验：

```bash
# ① 打包任务真的跑了（不是 UP-TO-DATE 跳过）
node scripts/run-gradle.mjs assembleRelease --info | grep -i "createBundle.*JsAndAssets"

# ② Release 包的明文 HTTP 开关真的生效
aapt2 dump xmltree --file AndroidManifest.xml \
  app/build/outputs/apk/release/app-release.apk | grep usesCleartextTraffic
# 期望 =true

# ③ 签名是什么（当前应为 debug keystore —— 只能内部测试，不能上架）
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

Windows 打包机上 ①②③ 有现成脚本（结构 + 明文开关）：

```powershell
# 默认验 debug 包
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\verify-apk.ps1

# 验 release 包：同时断言 JS bundle 存在 + 明文开关为 true
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\verify-apk.ps1 `
  -Apk C:\src\heyta\apps\mobile\android\app\build\outputs\apk\release\app-release.apk `
  -ExpectCleartext
```

> ⚠️ **debug 包里没有 `assets/index.android.bundle` 是对的。**
> RN 的 Gradle 配置默认 `debuggableVariants = ["debug", "debugOptimized"]`，
> 这两个变体跳过 bundle，JS 由 Metro 运行时提供。只有 release 变体才打 bundle。
> 拿 debug 包去验 bundle 只会得到假警报 —— 脚本已经按这个规则区分：
> 路径里带 `\release\` 才强制要求 bundle。

### 1.4 两个高频坑

**坑 1：改了 `packages/` 但 APK 没变。**
已修 —— `app/build.gradle` 把 `packages` 声明成打包任务输入。
副作用：即使 `packages` 没改，打包任务也常重跑，构建从 ~12 秒变 ~30 秒。
**这是刻意的安全取舍，不要删那条声明。**

**坑 2：`usesCleartextTraffic` 改了不生效。**
RN 的 `@react-native/gradle-plugin` 在 `finalizeDsl` 里把它设成 `false`，
晚于 `android { }` 块的求值。所以真正的开关在文件末尾的
`androidComponents.finalizeDsl` 里。**构建成功不等于配置生效，必须用 aapt2 验产物。**

### 1.5 发布签名

`app/build.gradle` 里的 `signingConfigs.release` **从 Gradle 属性或环境变量读**，
keystore 绝不入库。四个键（**任一缺失即视为"没配"**）：

| 键 | 含义 |
|---|---|
| `HEYTA_RELEASE_STORE_FILE` | keystore 的**绝对路径** |
| `HEYTA_RELEASE_STORE_PASSWORD` | 仓库口令 |
| `HEYTA_RELEASE_KEY_ALIAS` | key 别名 |
| `HEYTA_RELEASE_KEY_PASSWORD` | key 口令 |

推荐写进 `~/.gradle/gradle.properties`（**不在仓库里**），四条都是 `HEYTA_RELEASE_*`：

```properties
HEYTA_RELEASE_STORE_FILE=/绝对路径/heyta-upload.keystore
HEYTA_RELEASE_STORE_PASSWORD=…
HEYTA_RELEASE_KEY_ALIAS=heyta
HEYTA_RELEASE_KEY_PASSWORD=…
```

生成 keystore（**生成后立刻备份，丢了就再也发不了更新**）：

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore heyta-upload.keystore -alias heyta \
  -keyalg RSA -keysize 2048 -validity 10000
```

#### 🔴 没配的时候会发生什么 —— 这是本节的重点

**不会失败，会用 debug keystore 签名，并打一大段警告。** 为什么不直接 `throw`：
现在还要用它出内测 AAB，卡死会把这条路也断掉。

但**警告必须显眼**，因为 debug keystore 是**公开**的
（口令就写在 `build.gradle` 的 `signingConfigs.debug` 里，全世界的 RN 项目共用同一把）。
一个用公开密钥签名的 release 包，**任何人都能签出"同一应用"的更新包** ——
这不是"不够正式"，是能给恶意更新用同一个身份。

配好之后，构建日志开头会变成：

```
[heyta] 发布签名：已配置（keystore = /…/heyta-upload.keystore）
```

#### 验签名（**不要只看构建成功**）

```bash
# AAB 用的是 jarsigner 体系，不是 apksigner
jarsigner -verify -verbose -certs app/build/outputs/bundle/release/app-release.aab | head -20

# 更直接：看签名者是不是你的 alias
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab | grep -i "owner\|alias"
```

⚠️ **`bundleRelease` 成功 ≠ 签名对了。** 未配发布签名时它一样成功，
只是签名者是 `CN=Android Debug`。所以每次发布前都要**看签名者**，
这正是本仓反复那条："构建成功不等于配置生效，必须验产物"。

#### 1.5.1 ✅ 正式发布签名（2026-09-28 已切换）

生成脚本：`apps/mobile/android/scripts/generate-release-keystore.sh`

| 项 | 值 |
|---|---|
| keystore | `~/.heyta-signing/heyta-release.keystore`（**仓库外**，权限 600） |
| 算法 / 有效期 | RSA-4096 / SHA256withRSA / 10000 天 |
| 主体 | `C=CN, ST=Zhejiang, L=Hangzhou, O=Xiaoli Creativity Culture Industry, OU=Mobile, CN=heyta` |
| 四个键 | 写在 `~/.gradle/gradle.properties`（**仓库外**，权限 600） |

**证书指纹（备案用）**：

```
MD5    22:87:08:96:6F:FD:3F:96:A9:2D:5C:87:9F:E7:B2:A9
SHA1   54:B7:0E:92:13:CE:92:39:7A:6F:F0:EE:FE:39:5F:2B:AA:0B:9A:3A
SHA256 C4:6D:03:86:17:9C:3C:EF:12:58:2D:13:47:ED:2F:87:1E:B0:3A:64:AA:A2:BF:F9:65:11:C1:CB:76:06:25:56
```

🔴 **`keystore 丢了就再也发不了更新`** —— 请连同 `~/.gradle/gradle.properties` 一起离线备份。

验证签名（**别用 `unzip -l` 找 `META-INF/*.RSA` 去判断 APK** —— 那只对 AAB/JAR 签名成立）：

```bash
# AAB（JAR 签名）：签名块在 META-INF
unzip -l app/build/outputs/bundle/release/app-release.aab | grep 'META-INF/.*\.RSA'

# APK：现代 APK 用 v2/v3 签名块，**META-INF 里什么都没有**
python3 -c "
d=open('app/build/outputs/apk/release/app-release.apk','rb').read()
print('v2/v3 签名块:', d.rfind(b'APK Sig Block 42') >= 0)"
```

⚠️ 本轮就在这上面判错过一次：APK 的 `META-INF` 里 0 个签名文件被我读成"没签名"，
实际是 v2/v3 签名块（8184 字节）—— **同一份产物，两套签名机制，判据不能混用。**

---

## 2. iOS

### 2.1 构建（仅 macOS）

```bash
pnpm -r build
pnpm --filter @heyta/mobile run pods    # 原生依赖变了才需要；本机需先处理"路径含空格"（见 §2.2）
                                          # ⚠️ 该脚本不含 §2.2 那三个环境变量，locale 非 UTF-8 时会失败
pnpm build:ios
```

产物：

```
apps/mobile/ios/build/Build/Products/Release-iphonesimulator/HeytaMobile.app
```

### 2.2 `pod install` 的两个环境前提（都实测踩过）

本机仓库路径含空格（`…/All in one Data/…`），RN 的 CocoaPods helper 用
`URI::File.build`，遇到空格**直接抛异常**。绕法是强制从源码构建 RN core：

```bash
cd apps/mobile/ios
# ⚠️ 下面三个环境变量缺一不可（见 AGENTS.md §7 第 29 条；代价是首次构建慢很多）：
#   LANG/LC_ALL  本机 locale 不是 UTF-8，CocoaPods 会崩在 String#unicode_normalize 上
#   NODE_NO_WARNINGS  Podfile 把 `node -p` 的输出当路径用，Node 的代理警告会混进去
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
NODE_NO_WARNINGS=1 RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 bundle exec pod install
```

> 先自测一下自己的环境：`locale` 输出里 `LANG` 若为空，**不加前两个变量必然失败**，
> 而且报出来的栈是 CocoaPods 生成错误报告时自己又崩出来的假栈（真错误被盖住）。

### 2.3 部署目标冲突

第三方图标库把 `IPHONEOS_DEPLOYMENT_TARGET` 写成 12.4，而 Xcode 27.1 最低支持 15.0。
已在 `Podfile` 的 `post_install` 里对所有 pod target 统一抬高，规则：
**只抬高不降低**，且用 RN 的 `min_ios_version_supported` 常量而非硬编码版本。

验：

```bash
grep -c "IPHONEOS_DEPLOYMENT_TARGET = 1[0-4]" apps/mobile/ios/Pods/Pods.xcodeproj/project.pbxproj
# 期望 0
```

### 2.4 模拟器验收

```bash
pnpm verify:mobile-ios     # 31 项零 mock：点 FAB → 输中文 → 提交 → op 落库 → 同步到另一台设备
pnpm verify:ios-lan-http   # 私有 IP 明文 HTTP 可用性
```

> ⚠️ 需要 Simulator 窗口在**当前 Space**，否则 AX 树读到 `windows=0`。

### 2.5 真机 / TestFlight

当前只验证到**模拟器**。真机需要 Apple Developer 签名 + provisioning profile。
**iOS ATS 对明文 HTTP 的覆盖范围仍未实测** —— 别假设模拟器通过就等于真机通过。

### 2.6 发布签名（2026-09-30 ASC 侧已全面同步，出包链路打通）

团队账号：`V5S2LT9YV8`（Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd.）。

> 2026-09-28 产品定名 **heyta**（不带 `mobile`），工程侧改名：
> Bundle ID `com.heyta.mobile[.WidgetExtension]` → **`com.heyta[.WidgetExtension]`**，
> App Group `group.com.heyta.mobile` → **`group.com.heyta`**
> （改的是 `project.pbxproj` 的 `PRODUCT_BUNDLE_IDENTIFIER`、两份 `.entitlements`、
> `WidgetSharedConstants.swift`、以及 `archive-release.sh` / `export-ipa.sh` 里的常量）。
> 当时的缺口是 **ASC 未同步**；**2026-09-30 已全部补齐** —— 新 App ID ×2、新 App Group、
> 新 profile ×2、新 app 记录，下表是**当前实际存在**的资源。
> 顺带的好消息：**签名证书不随包名变**，证书指纹不用重算，
> APP 备案已经用它们填完了（见 [`docs/operations/icp-app-filing.md`](../operations/icp-app-filing.md)）。

| 资源 | 值 |
|---|---|
| App ID（主 App） | `com.heyta` = `N4UC5QM39L`（**2026-09-30 建**；旧 `com.heyta.mobile` = `Z979YYN9FY` 遗留未删） |
| App ID（小组件） | `com.heyta.WidgetExtension` = `JNYNN25N4C`（**2026-09-30 建**；旧 `com.heyta.mobile.WidgetExtension` = `6BZWPRPJ9Z` 遗留未删） |
| 分发证书 | `Apple Distribution`，cert id `2R8LJZ6Q36`，2027-06-19 到期 |
| App Store profile | `heyta App Store` = `CYNAA45DRC`（**2026-09-30 建**；旧 `9P2RP348X2` 已删） |
| App Store profile（小组件） | `heyta Widget App Store` = `FH2N84MFMX`（**2026-09-30 建**；旧 `QBGYAXY63F` 已删） |
| App Group | `group.com.heyta` = `KQWUZ2VG3X`（**2026-09-30 建**，已挂给两个**新** App ID；旧 `group.com.heyta.mobile` = `6943GXF577` 遗留） |
| ASC app 记录 | `heyta` = **`6817635248`**（`com.heyta`，sku `heyta-ios-2026-r2`，2026-09-30 建）；旧记录（`com.heyta.mobile` = `6816869464`）已改名 **`heyta-mobile-legacy`** 腾出名字。app 记录的 bundleId 不可改，只能新建 |

🔴 **证书指纹（备案用）** —— 取自 **Apple 自己的 provisioning profile**（profile 里嵌了且只嵌了这一张）：

```
SHA-1  79:51:52:08:57:8A:81:0F:82:C8:9E:5A:3D:48:24:37:DC:2D:EF:26
MD5    9D:E3:FE:22:16:8A:8C:FE:1B:FF:97:D4:EB:1E:BB:6D
```

**工程里的签名配置**（`project.pbxproj`，本轮补的 —— 之前**完全没有** `DEVELOPMENT_TEAM`，
所以谁都 Archive 不了）：两个 target 的 Release 配置都设了
`DEVELOPMENT_TEAM` / `CODE_SIGN_STYLE = Manual` / `PROVISIONING_PROFILE_SPECIFIER` / `CODE_SIGN_IDENTITY = "Apple Distribution"`。

复现命令：

```bash
# 建/查签名资产
asc bundle-ids list --paginate
asc certificates list --paginate                      # certificateType 是 DISTRIBUTION（不是 IOS_DISTRIBUTION）
asc profiles create --name "heyta App Store" --profile-type IOS_APP_STORE \
    --bundle N4UC5QM39L --certificate 2R8LJZ6Q36      # ⚠️ --bundle 要**资源 id**，不是 identifier
asc profiles download --id CYNAA45DRC --output /tmp/p.mobileprovision
asc profiles local install --path /tmp/p.mobileprovision
# ⚠️ 装完检查 ~/Library/MobileDevice/Provisioning Profiles/：同名旧 profile 若还在（授权的是
#    旧 group），过期时间相同时 preflight 可能取错 —— 按 application-groups 内容删旧留新。

# 出包（**一个命令，带 preflight**）
bash apps/mobile/ios/scripts/archive-release.sh /tmp/heyta.xcarchive
```

`archive-release.sh` 会把五个前提（团队 / 证书 / 两个 profile / 两个 App ID / **App Group**）
前置成一次 preflight，缺哪条就直接说缺哪条、去哪儿补；出包后再从**已签名的 .app** 里
读回签名证书指纹（备案要的权威值）。

#### ✅ App Group：两代解法（2026-09-30 已全面解决）

**现状**：`group.com.heyta` 已建成并挂给两个新 App ID，两个新 profile 的 `application-groups`
里都嵌了它（**权威验证**：profile 内容，不是界面截图）。Archive preflight 通过。

**公开 API 在结构上做不到这件事**，四条独立证据（2026-09-28 实测）：

| # | 证据 |
|---|---|
| 1 | `GET /v1/appGroups` 与 `/v1/appGroupIds` 均 **404**（该资源不存在） |
| 2 | 给 `APP_GROUPS` 能力写 `--settings` 时，服务端回出**允许取值的完整清单**：只有 `ICLOUD_VERSION` / `DATA_PROTECTION_PERMISSION_LEVEL` / `APPLE_ID_AUTH_APP_CONSENT` —— **没有 app group 相关的 key** |
| 3 | `asc web bundle-ids capabilities` 只有 `sync-app-clip` 一个子命令 |
| 4 | `xcodebuild -allowProvisioningUpdates -authenticationKey*`（Apple 文档说它不需要 Apple ID）在本机四种变体全部 `Authentication failed`，而**同一把 key** 自签 JWT 调 `/v1/bundleIds` 返回 200、`xcrun altool --list-apps` 也成功 ⇒ 这条路不通（Xcode 27.1 beta 或 key 角色不足） |

**但"只能人在网页上做"已经是过时的结论。** 2026-09-30 实测出一条**免 UI 的自动化路线**，
比上一代的"Playwright 驱动网页"可靠一个量级（不用和 React 弹窗搏斗）：

1. **登录一次**：独立 profile 的 Chrome 开调试端口
   `--user-data-dir=/tmp/asc-chrome --remote-debugging-port=9223`（⚠️ Chrome ≥ v136 禁止在
   **默认 profile** 上开调试端口），人工登录 ASC（SSO 会顺带登录 developer.apple.com）。
   会话约两天后过期，过期就要重登 —— 这是**唯一**的人工步骤。
2. **在 `developer.apple.com` 页面的执行上下文里直接 `fetch` 门户后端**
   （fastlane spaceship 的老端点，多年稳定）：
   - 列表（兼收获 csrf）：`POST /services-account/QH65B2/account/ios/identifiers/listApplicationGroups.action`，
     表单编码 `{teamId, pageNumber:1, pageSize:500, sort:'name=asc'}`；
     **响应头里的 `csrf` 与 `csrf_ts` 要原样带回**给后续写操作（spaceship 同款机制）。
   - 建：`addApplicationGroup.action` `{name, identifier, teamId}` + csrf 头。
   - 挂：`assignApplicationGroupToAppId.action`
     `{teamId, appIdId, displayId, applicationGroups}` + csrf 头
     （`appIdId` 用 ASC 资源 id；🔴 `displayId` 缺了会 400；`applicationGroups` 数组在表单里就是
     `applicationGroups=<id>`，**不要**加 `[]`）。
   - ⚠️ 写操作**必须带 csrf 头**，否则 **HTTP 421**，错误体还是 null，非常误导。
   - 每步后回读验证；最终用**独立手段**验收（重建 profile 看 `application-groups` 是否非空）。
3. capability 的启停（`APP_GROUPS` 等）照旧走公开 API（`asc bundle-ids capabilities add`），
   这部分本来就 API 可及。

> 上一代网页 UI 自动化的坑（2026-09-28，留作参考）：capability 编辑页保存时会弹
> **「Modify App Capabilities」**确认框，必须点弹窗里的 `Confirm`，只点页面 Save 不报错但
> 刷新后全部丢失；程序化 `el.click()`（isTrusted=false）触发不了 React 菜单，
> 要用 Playwright 的受信任点击。走上面第 2 条路线后这些 UI 坑全部绕开。

---

## 3. Windows 打包机运维

### 3.1 连上

```bash
ssh windows-pc
```

`windows-pc` 的定义在 `~/.ssh/config`，身份的固化副本见
[`../reference/build-matrix.md`](../reference/build-matrix.md) §1.1。

### 3.2 网络前提（中国大陆）

| 目标 | 直连 | 说明 |
|---|---|---|
| `registry.npmjs.org` | ✅ 可达 | 所以 **npm/pnpm 不配代理** |
| `github.com` | ❌ 被 reset | **只给 git 配代理** |
| `dl.google.com` | ✅/经代理 | SDK 下载 |

代理是 Mac 上的 `http://10.111.127.246:7890`，经 ZeroTier 可达。
由装机脚本的 `-Proxy` 写入 git 全局配置（`http.proxy` + `http.noProxy`）。

### 3.3 长任务必须分离进程

SSH 断开时前台进程会被带走。winget / sdkmanager 动辄几十分钟，
**不要在 SSH 前台跑**。两种可行姿势：

```powershell
# 姿势 A：分离进程 + 日志文件
Start-Process powershell -ArgumentList @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\src\setup-build-host.ps1','-Step','android-studio'
) -RedirectStandardOutput C:\src\setup.log -RedirectStandardError C:\src\setup.log.err `
  -PassThru -WindowStyle Hidden
```

> ⚠️ `-RedirectStandardOutput` 的输出**在子进程退出时才落盘**，中途文件大小是 0。
> 想实时看进度，用 `Tee-Object -FilePath` 逐行写，而不是重定向。

```powershell
# 姿势 B：让 Mac 侧的 pnpm/ssh 会话一直挂着（适合 harness 的托管后台任务）
```

### 3.4 体检

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\setup-build-host.ps1 -Step verify
```

### 3.5 🔴 脚本必须纯 ASCII

Windows PowerShell 5.1 把**无 BOM 的 UTF-8 当 ANSI** 读。`.ps1` 里出现中文会破坏解析，
报 `UnexpectedToken` 且行号指向注释中间（实测）。所以：

- `scripts/windows/*.ps1` **一律纯 ASCII**，中文注释写在本文档；
- 别用 PowerShell 7 的语法（`??`、三元 `? :`）—— 系统自带的是 5.1。

---

## 4. HarmonyOS

### 4.0 现在的真实状态（2026-09-28 实测）

| 步骤 | 状态 | 证据 |
|---|---|---|
| 工具链在不在 | ✅ | `Emulator -version` → `HarmonyOS Emulator :6.1.1.350`；SDK = HarmonyOS 6.1.1 / API 24 |
| 能不能出 HAP | ✅ | `assembleHap` → `BUILD SUCCESSFUL`，`entry-default-unsigned.hap` **352,587 字节** |
| 有没有模拟器 | ✅ | 镜像 2.37 GB 已下、实例 `heyta_test` 已建、**已启动**，hdc 认到 `127.0.0.1:5557` |
| 能不能装上去 | ✅ | `hdc install -r <**未签名**>.hap` **成功**，`bm dump -a` 列出 `com.heyta.mobile` |
| 应用跑起来 | ⚠️ **能启动，但白屏** | `aa start -a EntryAbility -b com.heyta.mobile` → `start ability successfully`，截图**纯白** |
| RN 应用跑起来 | ❌ | 上面装的是**模板工程**的 HAP，不是 RN 的；RN HAP 由 `verify:harmony-rnoh-js` 产在 `/tmp` |

🔴 **本节 2026-09-28 之前写着"卡点是缺模拟器系统镜像（本机没有 `~/.Huawei`）"。那句话是错的**，错在两处：

1. **`~/.Huawei` 根本不是镜像的落盘位置。** 镜像落在
   `~/Library/Huawei/Sdk/system-image/HarmonyOS-6.1.1/<device>_all_arm/`
   （本机实测该目录 **4.4 GB**，而 `~/.Huawei` 自始至终是 **0 字节**）。
   拿 `~/.Huawei` 是否为空来判断"有没有镜像"，判的是一个**永远为空**的路径。
2. **镜像不需要 GUI、不需要华为账号**，模拟器自带完整 CLI（见 4.1）。

**白屏的根因也已经定位**（不是"运行未通"这种含糊说法）：

```jsonc
// apps/mobile/harmony/entry/src/main/resources/base/profile/main_pages.json
{ "src": ["generated/Index"] }
```

应用首页被指向了 **`generated/Index`** —— 那是 **DevEco 预览器的报错占位页**
（内容是「预览失败 / Preview failed / 无法启动预览器…」），
是 IDE 生成物，**从来就不该是应用入口**。所以"能启动、白屏"是**真缺陷**，
不是环境问题：截图里连那四行报错文字都没渲染出来，说明这一页本身就没加载成功。

### 4.1 模拟器：全 CLI，不需要 GUI / 不需要华为账号

🔴 **以前没做这一步，是因为以为必须点 Device Manager 并登录华为账号。不是的。**

```bash
E=/Applications/DevEco-Studio.app/Contents/tools/emulator/Emulator

# ① 看能力（这一步就知道有没有 -install）
"$E" -help
#   关键子命令：-license / -imageList / -install / -create / -start / -stop / -list / -delete

# ② 接受许可（一次性）
"$E" -license accept          # → All licenses have been automatically accepted.

# ③ 看有哪些镜像可下（国内必须走代理，见下）
"$E" -imageList -http_proxy http://127.0.0.1:7890
#   phone / foldable / triplefold / widefold / tv，都是 HarmonyOS 6.1.1(24) Release

# ④ 下 phone 镜像（2,368,067,717 字节）
"$E" -install -deviceType phone -osVersion "HarmonyOS 6.1.1(24)" \
     -http_proxy http://127.0.0.1:7890
#   ⚠️ 输出是一长串 \r 进度，**必须重定向到文件**，否则刷屏且看不出结果
#   ⚠️ 没有 -http_proxy 会**卡住不动**（不报错），这是最费时间的一个坑

# ⑤ 建实例 —— 🔴 名字不能带连字符
"$E" -create heyta_test -deviceType phone -osVersion "HarmonyOS 6.1.1(24)"
#   带连字符（如 heyta-test）会报：
#     The virtual device name can only contain letters, spaces, numbers, underscores (_) and plus sign(+)
#   但 **exit code 仍是 0** —— 只看退出码会以为建成功了

# ⑥ 启动（长驻进程，放后台）
"$E" -start heyta_test > /tmp/emulator-start.log 2>&1 &

# ⑦ 等 hdc 认到它（约 30 秒）
HDC=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
"$HDC" list targets              # → 127.0.0.1:5557

# ⑧ 确认真的起来了
"$HDC" -t 127.0.0.1:5557 shell "param get const.product.os.dist.name"   # HarmonyOS
"$HDC" -t 127.0.0.1:5557 shell "param get const.product.model"          # emulator
"$HDC" -t 127.0.0.1:5557 shell "param get const.ohos.apiversion"        # 24
```

**截图 —— 后缀必须是 `.jpeg`**：

```bash
# 🔴 .png 会被直接拒绝：error: fileName ... invalid, suffix must be .jpeg
"$HDC" -t 127.0.0.1:5557 shell "snapshot_display -f /data/local/tmp/x.jpeg"
"$HDC" -t 127.0.0.1:5557 file recv /data/local/tmp/x.jpeg /tmp/harmony.jpeg
# → success: snapshot display 0 ... width: 1256, height: 2760
```

⚠️ `snapshot_display` 的成功信息走 **stdout**，而"后缀不对"是 `[Fail]` 走在别处 ——
**别把"命令没报错"当成"图存下来了"**，一定回去 `ls` 那个文件。

### 4.2 出包与装机

```bash
# 出包（在 apps/mobile/harmony 下）
export DEVECO_HOME=/Applications/DevEco-Studio.app/Contents
export DEVECO_SDK_HOME="$DEVECO_HOME/sdk"     # 🔴 不设会报 00303217 Configuration Error
export PATH="$DEVECO_HOME/tools/ohpm/bin:$DEVECO_HOME/tools/hvigor/bin:$DEVECO_HOME/tools/node/bin:$PATH"
ohpm install
hvigorw assembleHap --no-daemon
# → entry/build/default/outputs/default/entry-default-unsigned.hap

# 装到模拟器 —— 未签名也能装
"$HDC" -t 127.0.0.1:5557 install -r <路径>/entry-default-unsigned.hap
"$HDC" -t 127.0.0.1:5557 shell "bm dump -a | grep -i heyta"   # → com.heyta.mobile

# 起来看
"$HDC" -t 127.0.0.1:5557 shell "aa start -a EntryAbility -b com.heyta.mobile"
```

**签名**：`build-profile.json5` 里 `signingConfigs` 为空，hvigor 会打一行
`WARN: Will skip sign 'hos_hap'`。**模拟器不吃签名这套，所以未签名 HAP 直接能装**；
真机才需要签名（见 [`../reference/build-matrix.md`](../reference/build-matrix.md) §6）。

### 4.3 RN 侧的出包验证（不在真机上）

```bash
pnpm verify:harmony-toolchain    # 工具链 → 最小 ArkTS 工程 HAP（验"机器能不能出包"）
pnpm verify:harmony-rnoh         # RNOH 原生侧 → 37 MB debug HAP（真跑 BuildNativeWithNinja）
pnpm verify:harmony-rnoh-js      # 真 codegen + autolinking + Hermes bundle → 20 MB release HAP
```

⚠️ 三条脚本都把工程建在 `/tmp/heyta-harmony-*` 下，**产物不在仓库里**；
要复核状态就重跑它们，别去 `ls` 找 `.hap`。

🔴 **仍然没通的是"RN 应用在鸿蒙的设备上跑起来"。** 现在有了模拟器，这一步**不再是外部阻塞**，
而是**待做工作**。在此之前，**不要**把"能出 HAP"读成"RN 应用在鸿蒙上能跑"。

若最终这步失败，"跨平台"结论需要重估，可能改变 [ADR-0004](../adr/0004-ui-stack.md)。

---

## 5. 新增一个平台时要做的事

[ADR-0003 §2.3](../adr/0003-multi-platform-strategy.md) 要求跨语言加密互操作可验证。
所以新增平台时：

1. **扩展** `research/tools/crypto-interop/`（不是重造一套）；
2. 存储层用 `SqliteAdapter`，并跑**同一份** `DbAdapter` 契约测试；
3. 设计变量由 `tokens.css` **生成**，不许各端手写色值；
4. 在本手册与 [`../reference/build-matrix.md`](../reference/build-matrix.md) 里补一行；
5. 构建产物**真的验一遍**（不是只看"构建成功"）。

### 5.1 🔴 新机器第一步：先做"机器无关性"体检

**在一台干净机器上第一次构建，暴露的往往不是新平台的坑，而是本机一直存在的坑。**

实例（2026-09 实测）：Windows 打包机上第一次 `pnpm -r build`，
`packages/design-system` 的 DTS 步骤挂掉：

```
src/generate-cli.ts(22,56): error TS2307: Cannot find module 'node:fs'
src/generate-cli.ts(36,19): error TS2580: Cannot find name 'process'.
```

原因不在平台：`src/generate-cli.ts` 用了 `node:fs` / `node:path` / `node:url` / `process`，
但 `packages/design-system/package.json` **没有声明 `@types/node`**。
它在开发 Mac 上一直能构建，是因为 TypeScript 会自动向上层的
`node_modules/@types` 查找，而 `~/node_modules/@types/node`（某个无关全局安装留下的
244 个包）恰好躺在祖先目录里，被误当成了依赖。

修法是补声明，不是改代码：把 `"@types/node": "^20.0.0"` 加进该包的 `devDependencies`。
`pnpm -r build` 是一路往下走的，所以**一次只暴露一个包**；本次逐个补完的是这三个：

| 包 | 用了什么 | 症状 |
|---|---|---|
| `packages/design-system` | `node:fs` / `node:path` / `node:url` / `process` | DTS 步骤 `TS2307` / `TS2580` |
| `apps/node-host` | `node:fs` / `process` | 同上，`src/cli.ts` |
| `packages/storage` | `node:sqlite` | 编译恰好过了（本地有 `node-sqlite.d.ts` 兜底），但**类型面不完整** |

> `packages/storage/src/sqlite/node-sqlite.d.ts` 的注释里写着"本仓库锁定的 `@types/node`
> 是 20.x"——**但当时没有任何包真的声明过它**，全靠开发机上那个野生目录。
> 注释描述的是意图，不是事实；这类"文档说有、依赖里没有"的缺口值得专门查一遍。

验证解析真的落在包内：

```bash
cd packages/design-system
./node_modules/.bin/tsc -p tsconfig.build.json --traceResolution 2>&1 | grep 'types/node'
# 期望：Found 'package.json' at '.../packages/design-system/node_modules/@types/node/package.json'
```

**通用做法**：任何"只在我机器上能构建"的包，先怀疑它偷用了祖先 `node_modules`。
每个包用到的类型/运行时依赖都必须自己声明。

**第二个实例，同一台机器同一次构建**：`server` 的 `tsc` 报了一屏

```
src/sync/sync.types.ts(32,29): error TS2694: Namespace '".../.prisma/client/default".Prisma'
                               has no exported member 'OperationWhereInput'
```

这是 **Prisma Client 没生成**，不是代码错。开发机上很久以前手动生成过一次，所以一直没事；
一台全新机器跑 `pnpm -r build` 就必然倒在这一步。

> ⚠️ **这条的因果一开始记错了，值得专门记一笔。**
> 当时写的是"`prisma generate` 只挂在 `pretest` 上，没挂 `build`"，
> 但仓库里其实一直有 `"prebuild": "prisma generate"`，**而且 pnpm 会执行它** ——
> 在 HEAD 上实测 `pnpm run build`，输出里能看到 `$ prisma generate` 带着 `prebuild` 的标签跑起来。
> 真正出问题的是当时发到 Windows 的那棵树：它的 `build` 是裸 `tsc`，且没有 `prebuild`。
> 证据在构建日志里 —— `server build$ tsc`，全程**没有** `prebuild` 行。
>
> 教训：报"某个脚本没挂上"之前，先去看**当时跑的那棵树**里那个文件长什么样，
> 别拿"现在仓库里是什么样"去回推当时的因果。

修法是把 `prisma generate` 直接写进 `build`：

```json
"build": "prisma generate && tsc"
```

这样构建不再依赖 pnpm 的 `pre`/`post` 脚本是否执行。这一条对本仓库尤其值得做：
`pnpm-workspace.yaml` 里已经记着"构建结果取决于跑的是哪个 pnpm"的教训，
而 pre/post 脚本开关正是随 pnpm 版本与配置变的那种东西。

**第三个实例，同一台机器再往后一步**：`pnpm -r build` 全绿之后，
`pnpm build:android:debug` 立刻失败：

```
$ cd android && ./gradlew assembleDebug
'.' 不是内部或外部命令，也不是可运行的程序或批处理文件。
```

不是 Gradle 的问题，是**脚本写法本身不可移植**。cmd 里没有 `./gradlew`
（只有 `gradlew.bat`），而 pnpm 在 Windows 上就是用 cmd 跑 script 的。
三种写法各挂一边，没有一种能同时满足两边：

| 写法 | POSIX | Windows cmd |
|---|---|---|
| `./gradlew` | ✅ | ❌ |
| `gradlew` | ❌（当前目录不在 PATH） | ✅（PATHEXT 找到 `.bat`） |
| `sh gradlew` | ✅ | ❌（没有 sh） |

修法：`scripts/run-gradle.mjs`，由 Node 判断平台选 wrapper 并原样透传退出码。
`apps/mobile` 的四个 Gradle 脚本全部改成 `node ../../scripts/run-gradle.mjs <task>`。

**第四个实例：Gradle 起来了，但倒在工具链上。**

```
FAILURE: Build failed with an exception.
* What went wrong:
Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
```

堆栈指向 `org.gradle.toolchains.foojay.DistributionsKt.<clinit>`。
来源不是本仓库的脚本，而是 RN 自带的 gradle-plugin：

```
node_modules/@react-native/gradle-plugin/settings.gradle.kts
  plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0") }
```

它被 `settings.gradle` 的 `includeBuild` 拉进来，而它自己的
`settings-plugin/`、`shared/` 两个模块写着 `kotlin { jvmToolchain(17) }`。
`IBM_SEMERU` 在 **Gradle 8.10** 就被删掉了，所以 0.5.0 在 Gradle 9.0.0 上必崩 ——
这是上游的版本不匹配，我们改不动。

**能改的是"让它不被调用"**：Gradle 只有在**本机找不到**所需工具链时才会去问下载解析器。
所以机器上必须有 **JDK 17**。Gradle 跑在哪个 JDK 上无所谓（本机是 JBR 25），
但 `jvmToolchain(17)` 要的是 17。

两个坑叠在一起：

1. 这台机器只有 JBR 25.0.3 与 Microsoft OpenJDK 21.0.12，**没有 17**；
2. 光把 JDK 17 放好还不够 —— 实测 Gradle 的自动探测**没认出**它，
   要显式登记，而且 `gradle.properties` 是 **Java properties 文件，反斜杠是转义符**：

   ```properties
   # 错：反斜杠被吃掉，Gradle 报 C:Program FilesEclipse Adoptiumjdk-17...
   org.gradle.java.installations.paths=C:\Program Files\Eclipse Adoptium\jdk-17.0.20.1+1
   # 对：用正斜杠（JVM 在 Windows 上接受）
   org.gradle.java.installations.paths=C:/Program Files/Eclipse Adoptium/jdk-17.0.20.1+1
   ```

`setup-build-host.ps1` 的 `Ensure-Jdk17` 现在两件事都做了：找不到就装
`EclipseAdoptium.Temurin.17.JDK`，找到就把路径（正斜杠形式）登记进
`~/.gradle/gradle.properties`。`-Step verify` 里也多了一行 `JDK 17 toolchain`。

**第五个实例：JDK 17 装好了，还是同一个报错 —— 这次是守护进程跑错了 JDK。**

装完 JDK 17 之后重跑，`IBM_SEMERU` 不再出现，构建推进到 117 个任务，
然后倒在 `op-sqlite` 的 CMake 配置：

```
Execution failed for task ':op-engineering_op-sqlite:configureCMakeDebug[arm64-v8a]'.
> WARNING: A restricted method in java.lang.System has been called
```

报错文本本身很怪 —— 那是句**警告**，却被当成了失败原因。`--stacktrace` 揭穿：

```
Caused by: java.lang.IllegalStateException: WARNING: A restricted method in java.lang.System has been called
	at com.android.build.gradle.tasks.GeneratePrefabPackagesKt$reportErrors$1$1.invoke(GeneratePrefabPackages.kt:304)
	at kotlin.io.TextStreamsKt.forEachLine(ReadWrite.kt:160)
```

也就是说：**AGP 的 `GeneratePrefabPackages` 把 prefab 子进程 stderr 的每一行都当成错误**，
而 JBR 25 恰好往 stderr 打了这么一行。构建失败与 op-sqlite 的 C++ 代码无关。

真正的根因是守护进程的 JDK。`--info` 日志里那一行是决定性的：

```
Command: C:\Program Files\Android\Android Studio\jbr\bin\java.exe ...
```

**Gradle 用了 `JAVA_HOME`，而 User 级 `JAVA_HOME` 是 JBR。**
这台机器上 Machine 级 `JAVA_HOME` 已经是 Microsoft OpenJDK 21，
但 **User 级覆盖 Machine 级**，所以守护进程一直跑在 25 上。

```powershell
[Environment]::GetEnvironmentVariable('JAVA_HOME','User')     # 曾是 ...\Android Studio\jbr
[Environment]::GetEnvironmentVariable('JAVA_HOME','Machine')  # 已是 ...\Microsoft\jdk-21...
```

修法两条一起做：

1. `Get-JavaHome` 改成**优先 JDK 21，JBR 只作兜底**（以前是反的）；
2. 把 User 级 `JAVA_HOME` 也指到 JDK 21 —— 改完 `gradlew --stop` 杀掉在 25 上起的旧守护进程。

改完：`BUILD SUCCESSFUL in 4m 14s`（debug）、`in 9m 13s`（release）。

> 🔴 **`JAVA_HOME` 有两个作用域，`GetEnvironmentVariable` 要显式写 `'User'`/`'Machine'`。**
> 只改一个就会得到"脚本里明明设对了、构建却还用旧 JDK"这种最难查的错。
> 同理，`bash`/`ssh` 这种新会话读的是 User 级。

> 第五个实例的共同点：**`pnpm -r build` 与 `pnpm build:*` 是"干净机器第一次构建"的
> 唯一入口，而它们此前从没在一台干净机器上跑过。**
> 以后每次新增构建环境，第一件事就是把这两条跑一遍。

**快速自检清单**（新机器上跑完 `pnpm install` 后）：

```bash
pnpm -r build          # 有任何一条不通，先修它，别急着打包
pnpm -r typecheck      # 门禁里也有这一步，同样要能过
pnpm build:android:debug
```

症状对照：

| 症状 | 根因 |
|---|---|
| 某包 `node:fs` / `process` 未定义 | 该包缺 `@types/node` 声明 |
| `server` 报 `.prisma` 类型缺失 | Prisma Client 未生成 |
| `'.' 不是内部或外部命令` | 脚本里写了 `./gradlew` |
| `NoSuchFieldError ... IBM_SEMERU` | 机器上没有 JDK 17，Gradle 去问了 foojay 0.5.0 |
| `WARNING: A restricted method in java.lang.System` 却被报成 task 失败 | 守护进程跑在 JDK 24+（本机是 JBR 25），AGP 把 prefab 的 stderr 逐行当错误 |


---

## 6. 桌面原生壳安装包（macOS / Linux / Windows）

三条命令各自独立，都在**本机**发起，产物落到 `dist/<端>/`（`dist/` 不入库）：

```bash
# macOS：构建 → 组装 .app → Developer ID 签名 → 启动验证 → .dmg → 公证 → 装订
bash apps/desktop-macos/scripts/package-app.sh
# → /tmp/heyta-macos-dist/Heyta-1.0.0.dmg

# Linux：rsync 到 sanjiaozhou → -Werror 构建 → 组装 .deb → dpkg -i → Xvfb 启动验证
bash apps/desktop-linux/scripts/package-deb.sh sanjiaozhou
# → dist/linux/heyta_1.0.0_amd64.deb

# Windows：publish → manifest → logos → makeappx → 自签名 → 信任证书
#          → 交互式会话里安装 + 启动 + 截图 → 取回产物
bash apps/desktop-windows/scripts/package-msix.sh
# → dist/windows/{heyta.msix,packaged-first-run.png,install-capture.txt}
```

前置：macOS 需要 `swift`；Linux 走 SSH 到 `sanjiaozhou`（Ubuntu 24.04，有 gtk4/jsc/dpkg-deb）；
Windows 走 SSH 到 `windows-pc`（Win11，Windows SDK x64 + dotnet 10 + 管理员）。

### 6.1 🔴 Windows：`Add-AppxPackage` 必须在**非提权**的交互式会话里跑

AppX 部署是**按用户**的。SSHD 给的是**提权**会话，在那里跑就会得到：

```
Add-AppxPackage : 部署失败，HRESULT: 0x80070005, 拒绝访问。
目标卷 C: 执行的 添加 操作失败，错误为 0x80070005
```

**同一段代码、同一个包**，换成非提权的交互式桌面会话就成功。所以
`package-msix.ps1` 只把「信任证书」留在提权会话（那一步真的需要管理员），
把「安装 + 启动 + 截图」整段交给 `install-and-capture.ps1`，用
`schtasks /ru <用户> /it` 投进去：

```powershell
schtasks /create /tn heyta-msix-install /tr C:\src\heyta-msix\install-and-capture.cmd `
  /sc once /st 00:00 /ru $env:USERNAME /it /f
schtasks /run /tn heyta-msix-install
```

被投进去的脚本第一行就打印 `CONTEXT IsAdmin=` —— **这是判据**：
`IsAdmin=True` 说明投递姿势错了，`False` 才是对的那个会话。

🔴 **不要用「再用管理员跑一次」来试。** 那是**反方向**：提权正是失败的那个上下文。
`Add-AppxProvisionedPackage -Online`（面向全机、必须提权）是**另一条语义不同的路**，
不是这条路的加强版。

### 6.2 🔴 `dotnet publish` 会丢掉应用**自己的** XAML 资源

WinUI 3 壳的 `dotnet publish` 产物里**没有** `App.xbf` / `MainWindow.xbf` / `<工程名>.pri`，
而 `dotnet build` 产物里**三个都有**。用它打出来的 MSIX 会：

1. **装得上**（`Add-AppxPackage` 返回成功、`Get-AppxPackage` 有）；
2. **起得来**（`shell:appsFolder\...` 真的拉起了进程）；
3. 然后在 `Microsoft.UI.Xaml.dll` 里崩掉，事件日志形态是
   `异常代码 0xc000027b`（stowed exception）+ `combase.dll` `80004005`（E_FAIL）

—— 因为 `InitializeComponent()` 加载不到 `ms-appx:///App.xaml`。

`package-msix.ps1` 第 1 步因此会把这几个文件从 build 产物补回 publish 目录并**断言存在**；
第 7 步的 `install-and-capture.ps1` 再断言一次包内确实有
`PAYLOAD_PRI=True` / `PAYLOAD_XBF=2`。

> **「装上了」不等于「跑得起来」。** 这条纪律在本仓被代价教育过多次 ——
> 本轮又教育了一次：安装成功、进程启动、然后窗口从来没出现。

### 6.3 取件路径

Windows 的中间产物在 **`C:\src\heyta-msix\`**（不是 `C:\heyta-msix\`）。
路径写错时的表现是「取不到 heyta.msix」，看起来像打包失败，其实只是取件地址错了。

### 6.4 采集方式

`dist/windows/packaged-first-run.png` 与
`apps/desktop-windows/evidence/packaged-first-run.png` 是同一张图
（**打包产物**的窗口，不是 build 产物的），采集方式
`winui-schtasks-copyfromscreen`，已登记进 `scripts/screenshots/targets.mjs` 的 `SHELL_EVIDENCE`。
