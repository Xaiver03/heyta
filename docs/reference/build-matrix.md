# 多端构建矩阵

> 本文件是**各平台构建条件的唯一事实源**：谁来构建、在哪台机器上、工具链是什么、
> 产物落在哪、当前状态如何。
>
> 配套操作步骤见 [`../runbooks/multi-platform-build.md`](../runbooks/multi-platform-build.md)。
> 为什么多端只写"壳"见 [ADR-0003](../adr/0003-multi-platform-strategy.md)。

## 0. 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | **实测通过**，有可复现的命令与证据 |
| ⚠️ | 有条件可用 / 部分完成 |
| ❌ | 未实现 |
| 🔲 | 已规划，未验证 |

"实测"指**真的跑过并拿到产物**，不是"应该可以"。本仓库已多次踩到
"测试通过 ≠ 能打包"（`AGENTS.md` §7 第 27、28 条），所以这里只认产物。

---

## 1. 构建环境总表

| 环境 | SSH 别名 | 地址 | 用户 | 密钥 | 能力 |
|---|---|---|---|---|---|
| **本地 Mac**（当前开发机） | — | 本机 | `rocalight` | — | iOS 构建、Android 构建、鸿蒙出包（HAP）验证 |
| **Windows 打包机** | `windows-pc` | `10.111.127.237`（ZeroTier）<br>`192.168.1.3`（局域网） | `41478` | `~/.ssh/id_ed25519` | Android ✅（debug + release 均实测，见 §2.5）、Windows 桌面构建（选型未定）、**通用构建/测试外包**（见 §1.1.1） |
| **第二台 Windows**（笔记本） | `windows-codex`<br>`laptop-5ueuu7ps` | `10.111.127.151`（ZeroTier） | `rayne` | `~/.ssh/id_ed25519` | ⚪ **未纳入构建矩阵**。2026-09-27 实测**离线**（重试 3 次后由 timeout 变 `Host is down`）。此处只固化身份，**不代表可用** |
| 另一台开发 Mac | `chatgpt-other-mac` | `10.111.127.23`（ZeroTier） | `rocalight` | `~/.ssh/id_ed25519` | 备用 |

### 1.1 Windows 打包机身份（固化）

这台机器此前**只存在于个人 `~/.ssh/config` 的注释里**，不在版本控制内、不随仓库走、
agent 读不到。这里把它固化进仓库。

| 项 | 值 |
|---|---|
| SSH 别名 | `windows-pc` |
| 主机名 | `邓湘雷-win` |
| 系统 | Windows 11 build `10.0.26200.9457`（实测 `ver`） |
| 架构 | `AMD64` |
| ZeroTier 虚拟 IP | `10.111.127.237`（节点 `7578ffc5b6`） |
| 局域网 IP | `192.168.1.3` |
| SSH 用户 | `41478` |
| SSH 密钥 | `~/.ssh/id_ed25519`（Ed25519，公钥认证） |
| 仓库路径 | `C:\src\heyta` |
| ZeroTier 网络 ID | `166359304e354777` |

### 1.1.1 实测容量与工具链（2026-09-27）

下面是**当天当场测到的**（命令见本节末），目的是回答"这台机器能不能替我干重活"：

| 项 | 实测值 |
|---|---|
| 逻辑 CPU | **12 核**（`Win32_ComputerSystem.NumberOfLogicalProcessors`） |
| 内存 | **15.8 GB 总量 / 6.0 GB 空闲**（`TotalPhysicalMemory` / `FreePhysicalMemory`） |
| 磁盘可用 | `C:` **151.9 GB**，`D:` **97.4 GB** |
| `node` | `v24.19.0` |
| `pnpm` | **`11.8.0`** —— 在 `C:\src\heyta` 目录内解析所得（corepack 依据 `packageManager` 切换） |
| `git` | `2.55.0.windows.3` |
| `corepack` | `0.35.0` |

> 🔴 **两个实测到的坑，新增脚本时必须绕开：**
>
> **① pnpm 有两个版本，取决于在哪个目录跑。**
> 机器全局 pnpm 是 **`12.6.0`**；只有在 `C:\src\heyta` 内才被 corepack 降到仓库锁定的
> **`11.8.0`**。在**仓库外**跑 `pnpm install` 会用 12.x —— 而 `pnpm-workspace.yaml`
> 顶部那段注释专门讲过"同一份 lockfile 被不同 pnpm 拒绝"的坑。**任何 pnpm 命令都要在仓库目录内跑。**
>
> **② PowerShell 默认执行策略会挡住 `pnpm.ps1` / `npm.ps1`。**
> 实测报错 `无法加载文件 C:\Program Files\nodejs\pnpm.ps1，因为在此系统上禁止运行脚本`。
> 绕法：用 **`.cmd` 垫片**（`pnpm.cmd`）或在调用时显式 `-ExecutionPolicy Bypass`。
> ⚠️ 后者会让**报错静默变成错误结果** —— 我第一次探测时 `pnpm --version` 就因此
> 回显了 node 的版本号而不是报错。**脚本里读版本要断言，不要只打印。**

<details>
<summary>复现上面这张表的命令</summary>

```powershell
# 容量
$cs = Get-CimInstance Win32_ComputerSystem; $os = Get-CimInstance Win32_OperatingSystem
$cs.NumberOfLogicalProcessors
[math]::Round($cs.TotalPhysicalMemory/1GB,1); [math]::Round($os.FreePhysicalMemory/1MB,1)
Get-PSDrive -PSProvider FileSystem | ForEach-Object { "$($_.Name): $([math]::Round($_.Free/1GB,1))GB" }
# 工具链（注意：在 C:\src\heyta 内跑）
Set-Location C:\src\heyta; node --version; pnpm.cmd --version; git --version; corepack --version
```

经 SSH 调用时，多行脚本要 **base64 + `-EncodedCommand`**：
`powershell -Command -` 是**逐行**读取的，多行 `foreach` 块会被拆断而**静默失败**。
</details>

**换网络 / 换地点后不需要改任何配置**，只要：① 机器上 ZeroTier One 在跑；
② 本机 Mac 上 ZeroTier One 在跑；③ 在
<https://my.zerotier.com/network/166359304e354777> 保持该节点已授权。

> ⚠️ 历史值已失效，**不要再用**：旧 IP `10.111.127.156`、旧节点 `ed4d554295`。
> 2026-09 系统重装后换成上表的新身份。

> ⚠️ **这台机器会休眠。** 休眠时 SSH 直接报 `No route to host`，ZeroTier ping 100% 丢包。
> 实测不是掉线：上一次唤醒等了约 105 秒就恢复了。所以脚本里遇到这个错误，
> **先重试，不要急着改 IP 或重新授权节点**。

### 1.2 网络前提：GitHub 在 Windows 上需要代理

中国大陆直连 `github.com` 会被 reset（实测 `Recv failure: Connection was reset`），
而 `registry.npmjs.org` **直连可达**。因此：

- **只给 git 配代理**，npm/pnpm 保持直连；
- 代理地址是 Mac 上的 `http://10.111.127.246:7890`，经 ZeroTier 可从 Windows 访问
  （实测 TCP 可达）；
- 该配置由 `scripts/windows/setup-build-host.ps1 -Proxy` 写入，**不进仓库**（机器本地状态）。

> 🔄 **2026-09-27 复测：前提仍然成立，但代理换位置了。**
>
> **代理现在是那台 Windows 机器本机的 `127.0.0.1:7890`**，不再是 Mac 的
> `10.111.127.246:7890`。实测：
>
> ```powershell
> netsh winhttp show proxy        # → Direct access (no proxy server)
> Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
>   Select-Object ProxyEnable, ProxyServer   # → ProxyEnable=1, ProxyServer=127.0.0.1:7890
> [Environment]::GetEnvironmentVariable('HTTPS_PROXY')   # → (未设置)
> ```
>
> 因此那台机器上 `git config http.proxy` 里写的 `http://10.111.127.246:7890`
> **已经指向死地址**（本机 Mac 的 7890 当时没有进程在监听）。git 若要继续走代理，
> 应改成 `http://127.0.0.1:7890`；或者按上面的 `netsh` 结果确认直连是否可用。
>
> 🔴 **这是一处极易误判的地方，务必记住这个陷阱：**
>
> | 工具 | 是否走系统（WinINET）代理 |
> |---|---|
> | PowerShell `Invoke-WebRequest` | ✅ **走** |
> | Windows 自带 `curl` / `git`（未配 proxy 时） | ❌ 不走 |
> | **Node 的 `fetch`（含 `@electron/get`）** | ❌ **不走**，除非显式设 `HTTPS_PROXY` |
>
> 于是会出现这种**自相矛盾的表象**：
> `Invoke-WebRequest https://api.github.com/rate_limit` 返回 **HTTP 200**（看起来"直连可用"），
> 而同一台机器上 Node 去下 Electron 二进制却报 **`TypeError: fetch failed`**。
> 两者都没错 —— 前者借了系统代理，后者直连。
>
> **结论：给 Node 系工具（`@electron/get`、`pnpm`、`corepack` 等）下 GitHub 产物时，
> 必须显式给环境变量**，不能靠"PowerShell 能打开网页"来判断：
>
> ```powershell
> $env:HTTP_PROXY = 'http://127.0.0.1:7890'
> $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
> ```
>
> ⚠️ 网络与代理都会变（这是在中国大陆访问 GitHub 的常态）。本节只记录**当时怎么测的**，
> 不要当成永久结论 —— 换网络/换地点后**重新测一次**，再决定配哪个代理。

### 1.3 两个脚本

| 脚本 | 作用 |
|---|---|
| `scripts/windows/setup-build-host.ps1` | 装工具链（git / node / pnpm / JDK 21 / Android SDK / 可选 VS C++），幂等 |
| `scripts/windows/bootstrap-repo.ps1` | 把 Mac 工作树的源码快照铺到 `C:\src\heyta` 并初始化本地 git 仓库 |

```powershell
# 在 Windows 上（管理员 PowerShell）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\setup-build-host.ps1
```

`setup-build-host.ps1` 分步：`-Step base | android-studio | vs-buildtools | verify`。
`-Step verify` 是纯体检，输出一张 ✅/❌ 表。

**为什么不用 `git clone`**：`github.com` 在这台机器上必须走代理，而且私有仓库的
`clone` 还需要凭据（PAT / deploy key）——**目前没配**，实测失败在
`could not read Username for 'https://github.com'`。
所以走"源码快照"路径：Mac 导出工作树 → `scp` → `bootstrap-repo.ps1` 落地并 `git init`。
拿到凭据后 `git fetch origin && git reset --hard origin/main` 即可回到上游。
具体命令见 [`../runbooks/multi-platform-build.md`](../runbooks/multi-platform-build.md) §1.2。

> 🔴 **两个脚本都必须保持纯 ASCII。** Windows PowerShell 5.1 把无 BOM 的 UTF-8 当 ANSI 读，
> 中文字符会破坏解析（实测报 `UnexpectedToken` 且行号指向注释中间）。
> 中文说明放在本文件与 runbook 里，不放进 `.ps1`。

---

## 2. Android

| 项 | 值 |
|---|---|
| 构建环境 | 本地 Mac ✅ / Windows 打包机 ✅（debug + release 均实测，见 §2.5） |
| 产物 | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` |
| AAB 产物 | `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` |
| 状态 | ✅ **实机跑通**（`AGENTS.md` §1） |

### 2.1 工具链要求

版本必须与 `apps/mobile/android/build.gradle` 的 `ext` 块一致：

| 组件 | 版本 | 来源 |
|---|---|---|
| `compileSdkVersion` | **36** | `build.gradle` |
| `buildToolsVersion` | **36.0.0** | `build.gradle` |
| `minSdkVersion` | 24 | `build.gradle` |
| `targetSdkVersion` | 36 | `build.gradle` |
| `ndkVersion` | **27.1.12297006** | `build.gradle`（newArch + op-sqlite 需要） |
| CMake | 3.22.1 | NDK 构建需要 |
| Gradle | **9.0.0** | `android/gradle/wrapper/gradle-wrapper.properties` |
| JDK（跑 Gradle） | **21** | Microsoft OpenJDK 21 |
| JDK（工具链） | **17** | RN 的 gradle-plugin 要 `jvmToolchain(17)` |
| Node | **≥ 22.11.0** | `apps/mobile/package.json` 的 `engines` |

🔴 **两个 JDK 都要装，而且不是同一件事。**

- **跑 Gradle 的那个 JDK 必须是 21。** 不要用 Android Studio 自带的 JBR ——
  这台机器上它是 **25.0.3**，而 JDK 24+ 把 native 库加载从"警告"变成了错误，
  `op-sqlite` 的 CMake 配置任务会直接失败：

  ```
  Execution failed for task ':op-engineering_op-sqlite:configureCMakeDebug[arm64-v8a]'
  > WARNING: A restricted method in java.lang.System has been called
  ```

- **另外必须有 JDK 17。** RN 0.84 自带的 `@react-native/gradle-plugin` 在
  `settings.gradle.kts` 里应用了 `foojay-resolver-convention:0.5.0`，而它自己的
  模块写着 `kotlin { jvmToolchain(17) }`。本机找不到 17 时 Gradle 会去问这个下载
  解析器，而 0.5.0 依赖的 `JvmVendorSpec.IBM_SEMERU` 在 Gradle 8.10 就被删了：

  ```
  Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
  'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
  ```

  光把 JDK 17 装上还不够：实测 Gradle 的自动探测没认出它，要显式登记，而且
  `gradle.properties` 是 Java properties 文件，**反斜杠会被吃掉**，必须写正斜杠：

  ```properties
  org.gradle.java.installations.paths=C:/Program Files/Eclipse Adoptium/jdk-17.0.20.1+1
  ```

  `setup-build-host.ps1` 的 `Ensure-Jdk17` 负责这两件事，`-Step verify` 里有对应体检行。

> macOS 本机的 Android SDK 装在 `/opt/homebrew/share/android-commandlinetools`
> （见 `apps/mobile/android/local.properties`）。
> macOS 上 JDK 17 来自 Homebrew 的 `/opt/homebrew/opt/openjdk@17`，
> 这就是同一份代码在 Mac 上没撞上 foojay 的原因。

### 2.2 构建命令

```bash
pnpm -r build                      # 🔴 必须先构建 workspace 包：APK 里打的是 packages/*/dist
pnpm build:android                 # Release APK
pnpm build:android:debug           # Debug APK
pnpm --filter @heyta/mobile run build:android:bundle   # Release AAB（上架用）
```

### 2.3 两个必须知道的坑

1. **只改 `packages/` 时，Gradle 可能打进旧 bundle。**
   已修：`app/build.gradle` 把 `packages` 声明成打包任务输入（`inputs.dir`）。
   修后普通构建会自动重打，代价是 APK 构建从 ~12 秒变 ~30 秒。
   **不要为省时间删掉那条声明** —— 它污染的是所有移动端验收的结论。

2. **Release 包的明文 HTTP 开关在 `finalizeDsl` 里，不在 `android { }` 里。**
   RN 的 Gradle 插件会在 `finalizeDsl` 覆盖 `manifestPlaceholders`，
   写在 `android { }` 里的值**一定是假的**（构建退出码 0，aapt2 读出来仍是 `false`）。
   改完务必验证产物：
   ```bash
   aapt2 dump xmltree --file AndroidManifest.xml app-release.apk | grep usesCleartextTraffic
   # 期望 =true
   ```
   决策记录见 [ADR-0007](../adr/0007-transport-security.md)。

### 2.4 签名（🔴 当前不是发布配置）

`app/build.gradle` 的 **release 变体仍然用 debug keystore 签名**。
这是模板默认值，**不能上架**。真要发布 Android 时：

1. 生成正式 keystore；
2. 用环境变量或 `~/.gradle/gradle.properties` 注入口令（**绝不入库**）；
3. 把 `signingConfigs.release` 接到 release 变体；
4. 验证：`apksigner verify --print-certs app-release.apk`。

> 当前状态：✅ 可用于内部安装测试 / ❌ 不可用于应用商店。

### 2.5 Windows 打包机实测（2026-09）

**debug 与 release 两个变体都已跑通，产物已逐项验过。**

| 步骤 | 命令 | 结果 |
|---|---|---|
| 装依赖 | `corepack pnpm install` | ✅ 909 包，2 分 41 秒 |
| 构建 workspace 包 | `corepack pnpm -r build` | ✅ 16 个工作区项目全过 |
| 打 debug | `corepack pnpm build:android:debug` | ✅ `BUILD SUCCESSFUL in 4m 14s`，200 个任务（93 执行） |
| 打 release | `corepack pnpm build:android` | ✅ `BUILD SUCCESSFUL in 9m 13s`，255 个任务（229 执行） |

产物：

| 变体 | 大小 | sha256 | 时间 |
|---|---|---|---|
| `app-debug.apk` | 129,754,425 B | `5AED620A823637AF2B294FD2AE7A324B3E6F4367FBA2A015476EB0AE2DC951C1` | 2026-09-26 15:56:38 |
| `app-release.apk` | 64,919,787 B | `A461D1942F9EFAC0C0298364DD6EA9D38D679E38AD2803217FA5D8030B539AF5` | 2026-09-26 16:12:20 |

结构校验（`scripts/windows/verify-apk.ps1`，不靠眼看）：

| 检查项 | debug | release |
|---|---|---|
| `AndroidManifest.xml` | ✅ | ✅ |
| `classes.dex` | ✅ 11,592,408 B | ✅ 9,460,240 B |
| `resources.arsc` | ✅ 364,572 B | ✅ 349,276 B |
| `assets/index.android.bundle` | ➖ 按设计不存在 | ✅ **4,013,724 B** |
| `lib/` 四个 ABI | ✅ 各 13 个 `.so` | ✅ 各 13 个 `.so` |
| `usesCleartextTraffic=true` | — | ✅ **实测生效** |

> **debug 包里没有 JS bundle 是对的。** RN 的 Gradle 配置默认
> `debuggableVariants = ["debug", "debugOptimized"]`，这两个变体**跳过 bundle**，
> JS 由 Metro 在运行时提供。只有 release 才打 bundle（本次 4.0 MB）。
> 拿 debug 包去验"bundle 在不在"只会得到假警报 —— 脚本按路径里有没有 `\release\` 区分。

> **release 的 `createBundleReleaseJsAndAssets` 确认执行**（不是 UP-TO-DATE 跳过），
> 所以 4.0 MB 的 bundle 确实是这次构建产出的，不是缓存里的旧货。
> 明文 HTTP 开关也**在打包后的清单里**核实为 `true`（aapt2 dump，不是看源代码）——
> 这一条正是 §2.3 坑 2 要求验的东西。

**这台机器上真正让它跑起来的三件事**（细节见
[`../runbooks/multi-platform-build.md`](../runbooks/multi-platform-build.md) §5.1）：

1. Gradle 守护进程必须跑 **JDK 21**，不能用 Android Studio 的 JBR 25；
2. 机器上必须有 **JDK 17**，否则 RN 的 foojay 解析器在 Gradle 9 上崩；
3. Gradle 下载走代理，实测 `services.gradle.org` 直连 61 KB/s、经代理 7.8 MB/s。

**仍未做**：Windows 上的 AAB（`bundleRelease`）没跑；签名仍是 debug keystore（见 §2.4）。

### 2.6 Android 备案

明确指示：**暂不处理**。不阻塞构建。

---

## 3. iOS

| 项 | 值 |
|---|---|
| 构建环境 | **仅本地 Mac**（iOS 构建必须 macOS + Xcode） |
| 产物 | `apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app` |
| 状态 | ✅ 模拟器构建到交互级 |

### 3.1 工具链要求

| 组件 | 值 |
|---|---|
| Xcode | 27.1（`IPHONEOS_DEPLOYMENT_TARGET` 支持范围 15.0–27.1.x） |
| 部署目标 | 由 `Podfile` 的 `post_install` 统一抬高到 `min_ios_version_supported`（≥15.1） |
| CocoaPods | 经 `bundle exec pod install` |
| Node | ≥ 22.11.0 |

### 3.2 构建命令

```bash
pnpm -r build                      # 同样先构建 workspace 包
pnpm --filter @heyta/mobile run pods   # 原生依赖变了才需要
pnpm build:ios                     # Release, iphonesimulator
```

### 3.3 三个必须知道的坑

1. **仓库路径含空格会让 `pod install` 崩。**
   本机路径是 `…/All in one Data/…`，而 RN 的 CocoaPods helper 用
   `URI::File.build`，遇到空格直接抛异常。
   绕法：强制 RN core 与 dependencies **从源码构建**（见 `AGENTS.md` §7 第 29 条），
   代价是首次 iOS 构建慢很多。
2. **图标库的部署目标会拦住 iOS 构建，而 Android 完全不受影响。**
   已在 `Podfile` 的 `post_install` 里对**所有** pod target 统一抬高，
   规则是"只抬高、不降低"、且用 RN 的 `min_ios_version_supported` 常量而不是写死版本。
3. **`.js` 扩展名的相对导入：单测全绿，Release 打包失败。**
   移动端本地模块一律不带扩展名（`AGENTS.md` §7 第 28 条）。

### 3.4 真机 / 上架

- 当前只验证到**模拟器**。真机需要 Apple Developer 账号签名 + provisioning profile。
- 已有 Apple Developer 账号 ✅（[ADR-0003 §1](../adr/0003-multi-platform-strategy.md)）。
- 🔴 **iOS ATS 覆盖范围未实测**（[ADR-0007](../adr/0007-transport-security.md) 标注）。

---

## 4. Windows 桌面

| 项 | 值 |
|---|---|
| 构建环境 | Windows 打包机（`windows-pc`） |
| 技术路线 | ✅ **WinUI 3 / Windows App SDK（C#）** —— [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) |
| 状态 | 🟡 **编译这一半已通**（2026-09-28：`dotnet build` 0 警告 0 错误）；⬜ 还没真的开出一个窗口 |

🔴 **本节此前写的是"方向未定：Web(PWA/Tauri) 还是 react-native-windows"—— 已经过期。**
2026-09-28 连出两份 ADR 把方向定死了：ADR-0032 选 RNW，随后
[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) **全部取代** ADR-0032，
改判 **WinUI 3**。理由是一条实测事实：RNW 最新稳定版停在 **0.84.0**，
没有 0.85+，而 RN 上游已到 0.87.1 —— 选 RNW 等于把**整个 monorepo**
（含旗舰移动端 `apps/mobile`）冻在一个已经出了上游支持窗口的 RN 版本上。

- 🔴 **不再需要 VS 2022 + C++ 工作负载**：实测命令行编译只要
  `winget install Microsoft.DotNet.SDK.10`（10.0.401）。微软文档写的前置是 VS，
  但那是 IDE 路径 —— 详见 [`../../research/spikes/winui3-toolchain-probe/`](../../research/spikes/winui3-toolchain-probe/)。
  这条省掉一个 10~20 GB 的共享机安装。
- ⚠️ **"能编译" ≠ "能开窗"**：unpackaged 运行还需要机器上装 Windows App SDK 运行时，
  且**要有一个真实桌面会话**（从 SSH 进来的是无会话环境）。
- 分阶段任务与验收见 [`../plans/desktop-native-migration.md`](../plans/desktop-native-migration.md) §2。

---

## 5. macOS 桌面 / Linux 桌面

| 平台 | 方向 | 状态 |
|---|---|---|
| macOS 桌面 | **SwiftUI / AppKit 原生**（推荐方向） | ⏸ **可达，但本轮不启动** —— 它和 Windows 卡在同一个问题上（跨语言调用 `packages/domain`），先做 macOS 就是**把那个问题付两遍**。触发条件见 §3 of the 迁移计划 |
| macOS 桌面（备选） | `react-native-macos` | 🔴 **现在不可行**：最新 0.81.9，官方要求"同一 minor"，而 heyta 在 RN **0.84.1** → 硬冲突 |
| Linux 桌面 | GTK4 / libadwaita（或 Qt） | ⏸ **没有需求证据** —— RN 生态没有 Linux，真原生 = **又一个独立代码库**；而目前没有任何 Linux 桌面用户的证据 |

🔴 **本节此前写的是"未规划（可复用 Web / Tauri）"—— 已过期**：那是"桌面端拿 Web 顶一下"
的思路，而 ADR-0031 已定"每端都交原生应用"、ADR-0034 把 Windows 定为 WinUI 3 原生。
**没有原生壳之前，macOS / Linux 继续用 Electron，并在文档里如实标注为过渡形态**
（不叫"原生"）—— 见 [`../plans/desktop-native-migration.md`](../plans/desktop-native-migration.md) §3/§4。

---

## 6. HarmonyOS

| 项 | 值 |
|---|---|
| 构建环境 | 本地 Mac（DevEco Studio 6.1.1.300，SDK API 24） |
| 产物 | `.hap`（`*-unsigned.hap`，未签名 → 装不进设备） |
| 状态 | ⚠️ **已实测出 HAP**（含 release 自包含包），**但没在任何设备/模拟器上跑起来** |

出包这一步**已实测通过**（2026-09-27，两条各自的判据脚本）：

| 脚本 | 验到什么 |
|---|---|
| `pnpm verify:harmony-toolchain` | 工具链 → 最小 ArkTS 工程 HAP（含真 `ets/modules.abc`） |
| `pnpm verify:harmony-rnoh` | RNOH 原生侧 → 37 MB debug HAP（真跑 `BuildNativeWithNinja`） |
| `pnpm verify:harmony-rnoh-js` | 真 codegen + 真 autolinking + Hermes bundle → **20 MB release HAP**（零桩） |

⚠️ **产物不在仓库里**（脚本把工程建在 `/tmp/heyta-harmony-*` 下），所以这里的状态
**无法靠 `ls` 二次复核** —— 要复核就重跑上面三条命令。过程与证据见
[`../plans/phase-2-multi-platform.md`](../plans/phase-2-multi-platform.md) §3.24、§3.25。

**仍然没做的是"跑起来"**，缺三样且都不是写代码能补的：模拟器系统镜像（本机 `~/.Huawei`
不存在）、签名（产物 `*-unsigned.hap`）、真机/模拟器。所以**不要**把上面读成
"RN 应用在鸿蒙上能跑"。

🔴 官方《环境搭建》文档写"仅支持 RN 0.72.5"**已过时**，实测两侧都已在 `0.84.x`。
照文档选版本会选到三年前的分支。

---

## 7. 一页速查

| 平台 | 环境 | 命令 | 产物 | 状态 |
|---|---|---|---|---|
| Android (Mac) | Mac | `pnpm build:android` | `app-release.apk` | ✅ 实机 |
| Android (Windows) | Windows 打包机 | `pnpm build:android[:debug]` | `app-release.apk` / `app-debug.apk` | ✅ 两个变体实测 |
| iOS | 仅 Mac | `pnpm build:ios` | `Heyta.app` | ✅ 模拟器 |
| Windows 桌面 | Windows | — | — | 🔲 选型未定 |
| macOS 桌面 | Mac | — | — | 🔲 未规划 |
| Linux 桌面 | Linux | — | — | 🔲 未规划 |
| HarmonyOS | Mac | `pnpm verify:harmony-toolchain` 等三条 | `.hap`（release 20 MB / debug 37 MB，**均未签名**） | ⚠️ 有 HAP，未运行 |

**签名现状**：Android release 用 debug keystore（可测试、不可上架）；
iOS 只验到模拟器；**鸿蒙产物是 `*-unsigned.hap`（`signingConfigs: []`，装不进任何设备）**；
桌面端还没有产物。
