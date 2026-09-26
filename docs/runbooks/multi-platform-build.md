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

### 1.5 签名（发布前必做）

当前 release 变体用 **debug keystore**，**不能上架**。发布前：

1. 生成正式 keystore；
2. 口令放环境变量或 `~/.gradle/gradle.properties`，**绝不入库**；
3. 把 `signingConfigs.release` 接到 release 变体；
4. `apksigner verify --print-certs` 确认签名者。

---

## 2. iOS

### 2.1 构建（仅 macOS）

```bash
pnpm -r build
pnpm --filter @heyta/mobile run pods    # 原生依赖变了才需要；本机需先处理"路径含空格"
pnpm build:ios
```

产物：

```
apps/mobile/ios/build/Build/Products/Release-iphonesimulator/HeytaMobile.app
```

### 2.2 `pod install` 的路径空格问题

本机仓库路径含空格（`…/All in one Data/…`），RN 的 CocoaPods helper 用
`URI::File.build`，遇到空格**直接抛异常**。绕法是强制从源码构建 RN core：

```bash
cd apps/mobile/ios
# 见 AGENTS.md §7 第 29 条；代价是首次构建慢很多
bundle exec pod install
```

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

## 4. HarmonyOS（未完成）

**当前状态：依赖链已通，从未构建出 HAP。** 见
[`../reference/build-matrix.md`](../reference/build-matrix.md) §6。

下一步是**验证，不是开发**：先让一个最小 RN 壳在鸿蒙上真跑起来。
若这步失败，"跨平台"结论需要重估，可能改变 [ADR-0004](../adr/0004-ui-stack.md)。

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

这是 **Prisma Client 没生成**，不是代码错。`server/package.json` 里
`prisma generate` 只挂在 `pretest` 上，**没挂 `build`**；开发机上是很久以前手动生成过一次，
所以一直没事。一台全新机器跑 `pnpm -r build` 必然倒在这一步。
修法：`server` 的 `build` 改成 `prisma generate && tsc`。

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

