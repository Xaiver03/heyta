# Android 构建与设备腿统一到 `linux-dev` —— 操作手册

> 状态：**载体已跑通一次真构建**（判据逐条见 §五，本行不抄数）。
> 决策来源：**两道令**，后者换载体、不解除前者的形状 ——
> 　· 2026-10-04 产品负责人：「之后 Android 任务一律 ssh windows-pc，不要再在 Mac 起新的 Gradle 构建或模拟器。」
> 　· 2026-10-28 产品负责人：「安卓我需要在 Linux dev 上做，把整个安卓都迁移到 Linux dev 上。」
> 起因不是整洁，是资源：Mac 被 headless 模拟器打爆（3.6G+ 常驻、90% CPU），SDK/AVD/Gradle 缓存吃掉约 20G+ 磁盘。
> 旧载体（windows-pc）那一侧的历史实测**不重写**，仍在
> [`android-build-on-windows.md`](android-build-on-windows.md) §七；`windows-pc` 现在只留
> Windows 桌面壳（MSIX）那一腿，**不再承担 Android**。
>
> **事实源分工**：环境/版本/产物/状态 → [`../reference/build-matrix.md`](../reference/build-matrix.md)；
> 本文件只写"怎么打、怎么验、边界在哪"。规则本体在 [`../agents/multi-end-build.md`](../agents/multi-end-build.md) §6.1。

---

## 一、唯一收口点

所有 Android 构建入口都汇成一枚脚本，没有第二条路：

```
根 package.json  build:android{,:debug,:bundle} / clean:android
  → pnpm --filter @heyta/mobile run …
    → apps/mobile/package.json 里逐字 `node ../../scripts/run-gradle.mjs <task>`
```

`scripts/run-gradle.mjs` 按平台分流：

| 运行平台 | 行为 |
|---|---|
| Windows（`win32`） | **逐字不变**地本机跑 `gradlew.bat` —— 这一支是**承重的**：同一批 pnpm 脚本在 Windows 开发机上仍要能本机执行，否则"远程构建"会在远端再发起一次"远程构建"（递归）|
| macOS / Linux | `ssh linux-dev` 同步工作树 → 远端 `./gradlew <task>` → 产物回传到**消费者原本期望的路径** |
| **在载体机本机上**（`hostname` 等于 `Xaiver-linux`） | **直接本机执行 `./gradlew`，不发 ssh** —— 否则那台机器上的任务会 ssh 到自己：把自己的树打包送给自己的树。判据是**主机名逐字相等**，不是"ssh 失败后改本机"（那是 G5 禁的静默降级）；走到这一支会大字印出来，且与远程分支**同形**（同 `--no-build-cache`、同 `-I` 镜像、同 `GRADLE_USER_HOME`/`ANDROID_HOME`）。由 G12 钉住，四条臂各自能红 |

不静默降级：载体不可达就直接红，**绝不**退回"那我在本机跑一下"。确实要在本机跑（例如载体在重装）
才显式加 `HEYTA_ANDROID_LOCAL_GRADLE=1` —— 那是例外开关，不是兜底。

旋钮（默认值的**真源是 `scripts/lib/sync-build-sources.sh` 顶部那四行**，其余都是抄件，
由 `check:android-gradle-remote` 的 G11 逐枚对账）：

| 旋钮 | 用途 |
|---|---|
| `HEYTA_ANDROID_HOST` | 载体主机，默认 `linux-dev` |
| `HEYTA_ANDROID_REMOTE_ROOT` | 载体上的构建根，默认 `/home/xaiver/heyta-android-build` |
| `HEYTA_ANDROID_SDK_ON_HOST` | 载体上的 Android SDK 根 |
| `HEYTA_ANDROID_GRADLE_HOME_ON_HOST` | 载体上**本仓私有**的 Gradle 用户目录（见 §二 ④）|

> ⚠️ 副作用要说在前面：`pnpm verify:mobile-*` 那一族里的 `pnpm build:android` 现在会 ssh 出去
> 远程构建（脚本本身一个字都不用改）。它们红在 `run-gradle` 的步骤 1 时**那是环境不是产品** ——
> 也别顺手改成"那我在 Mac 上打一份"。

---

## 二、载体前置：一条命令，缺什么补什么

```bash
ssh linux-dev 'bash -s' < scripts/linux-dev/setup-android-carrier.sh            # 补齐（幂等）
ssh linux-dev 'bash -s' < scripts/linux-dev/setup-android-carrier.sh --show     # 只报告，一个字节都不写
```

它管四件事。**每一件都是 2026-10-28 首趟构建当场撞出来的**，不是预防性写的：

| 件 | 缺了会怎样（实测） |
|---|---|
| ① JDK 17 | RN 0.84 的 gradle-plugin 里有 `kotlin { jvmToolchain(17) }`。机器上只有 JDK 21 时 Gradle 9 去问它自己钉的 `foojay-resolver-convention:0.5.0`，而那枚插件引用的 `JvmVendorSpec.IBM_SEMERU` 在 Gradle 8.10 已被移除 ⇒ 实测 `BUILD FAILED in 39s`，**只报那一句**。⚠️ 命令行 `-D` 给不进去，必须落 `gradle.properties` |
| ② NDK 27.1.12297006 | `apps/mobile/android/build.gradle` 把 `ndkVersion` 写死，而 AGP **不会**自己下 NDK。`op-sqlite` 那一族还要 CMake（首趟实测 AGP 会自己经镜像装 CMake，所以这里只检查不拦）|
| ③ Gradle 9.0.0 发行包 | `services.gradle.org` 直连实测 **~46 KB/s**（130 MB ⇒ 45 分钟）；腾讯云镜像 3.6 MB/s ⇒ 预置进载体私有的 wrapper 缓存，sha256 对回官方 `.sha256` |
| ④ 载体私有的 `GRADLE_USER_HOME` | 那台机器上原本躺着**别的项目**的 `~/.gradle/init.d/tfa-mirror.gradle` —— heyta 首趟实际是靠它才解析到 Maven 的。那种依赖不在任何清单里，别人删掉我们就莫名其妙红 ⇒ 镜像规则改由 `run-gradle.mjs` 用 `-I scripts/linux-dev/gradle-host/heyta-cn-mirror.init.gradle` **显式传**，缓存写进私有目录 |

🔴 **下载件一律对账**，不"能解开就算"：

- NDK 对 `repository2-3.xml` 里**该枚包自己那一段**的 size + sha1。取法要看清：`<archives>` 里
  linux / macosx / windows 三枚挨着排，按"文件名之后 400 字符"抓会抓到**邻居**包的值
  —— 2026-10-28 实测错过一次（r27b-linux 的真实值是 `size=663976775 / sha1=6fc476b2e57d7c01ac0c95817746b927035b9749`，
  而 `836151734 / c70c9791…` 是 **darwin** 那一枚）。
- gradle 发行包对官方 `.sha256`（现量 `8fad3d78296ca518113f3d29016617c7f9367dc005f932bd9d93bf45ba46072b`，
  与镜像给的字节逐字相同 ⇒ 镜像只是同一批字节的另一个出口）。

回退（逐项点名，**不动**那台机器的 `~/.gradle` 与 `~/.bashrc`）：
`rm -rf ~/.local/opt/jdk17-heyta ~/.heyta-android-gradle ~/.local/opt/android-sdk/ndk/27.1.12297006`

---

## 三、怎么打

```bash
# 0. 前置：APK 里打的是 packages/*/dist（AGENTS §6.1；§7 第 27 条那笔学费）
pnpm -r build

# 1. 先看计划，一个字节都不写（八步全打出来，含将执行的 ssh / rsync / scp 原样命令）
node scripts/run-gradle.mjs assembleRelease --dry-run

# 2. 真打（Mac 上这条命令 = 远程构建 + 回传）
pnpm build:android                                   # Release APK
pnpm build:android:debug                             # Debug APK
pnpm --filter @heyta/mobile run build:android:bundle # 上架用 AAB
```

---

## 四、通道：这台机器现在离你多远（2026-10-28 现量，md5/sha 逐字核过）

| 量 | 读数 | 后果 |
|---|---|---|
| Mac → 载体 推 | 4 MiB / 29.8 s ≈ **141 KB/s**；另一次 8 MiB / 106 s ≈ 79 KB/s（ZeroTier `10.111.127.12`，RTT 65 ms，0 丢包）| 源码包 47,410,393 B ≈ **5–10 分钟一趟** |
| 载体 → Mac 拉 | 8 MiB / 44 s ≈ **190 KB/s** | Release APK（~114 MB）回传 ≈ 10 分钟 |
| 同网段别名 `linux-dev-lan` | 4 MiB / 95 s ≈ **44 KB/s** 且 **33% 丢包**（人不在那张局域网里时它更差）| 别默认走它；`linux-dev` 那枚才是当前最快通道 |
| 链路稳定性 | `ssh 'cat >'` 两次在几十秒处被对端关闭；`rsync --partial` 第 3 趟续传完成 | 同步那半**必须**用可续传通道 |
| 载体自己的公网出口 | 腾讯云 gradle 镜像 3.6 MB/s；`maven.google.com` 25 s 超时；`dl.google.com/dl/android/maven2` 0.45s；`maven.aliyun.com/repository/google` 0.68s | Maven 必须走镜像（§二 ④）|

三条形状，写给下一位也写给别线的脚本：

1. **别按局域网速度排整趟验收。** 一次全量同步 5–10 分钟起步，构建 ≈ 8–25 分钟，再加产物回传。
   要连着跑多条腿（四端重装那一类）就在**载体机上开一棵隔离检出**，让构建输入从 GitHub 自己取
   （`/home/xaiver/heyta` 那一棵是别的线的，194 个脏文件，**别动它**）。
2. **`scp` 没有超时**：2026-10-14 那趟 486 MB 的包就在 99.3% 僵死（5 分钟 10 次采样一字节没长）。
   所以源码那半用 `rsync --partial`（断线**续传**），产物那半用 `scp` 但配
   `ServerAliveInterval/CountMax` + 有限重试；`rsync` 与 `tar` 在载体机上实测在位。
3. **`stat -c %s` 读 0 不能读成"产物是 0 字节"**：`--partial` 留下的半包尺寸是**真**的。
   新鲜度判据靠 sha256 + mtime，不靠尺寸非零。

---

## 五、验收判据（本批现量，逐项可复核）

| # | 判据 | 读数 |
|---|---|---|
| 1 | 载体机上真打出 APK | `assembleDebug` → `BUILD SUCCESSFUL in 7m 46s`，233 个任务全执行；产物 `size=129,953,529 B`、`sha256=3510dcbf066ad50a…`、远端完成时刻 `2026-10-28T05:45:00Z` |
| 2 | 四条对账（工作树 tar sha256 ／ 远端旧产物已清 ／ 产物 mtime ≥ 本次构建起点（远端时钟）／ 回传后本地 sha256 逐字相同且 mtime 回写）| 由 `run-gradle` 自己打印，本文件不抄条数 |
| 3 | APK 能进界面（不是白屏，肉眼看图）| 载体 AVD 上 `topResumedActivity = com.heyta/com.heytamobile.MainActivity`、`mCurrentFocus` 同窗口；截图 256,750 B / 1080×2340，画面是首跑同意面（「在使用联网功能之前」＋服务条款／隐私政策＋「同意并联网」／「只用本机」），中文渲染正常 |
| 4 | 门禁能红：G1–G11 逐臂 + `--show` 不写盘 | `pnpm check:android-gradle-remote`（臂数由它自己打印）；`pnpm check:android-build-host`；`ssh linux-dev 'bash -s' < scripts/linux-dev/setup-android-carrier.sh --show` 后逐字节比对它没有新建任何文件 |

---

## 六、门禁

| 门禁 | 钉什么 | 在哪跑 |
|---|---|---|
| `check:android-gradle-remote` | gradle 只能从唯一收口点出去 + 载体默认值单源（G11）+ 探测自证 + mtime 跨方言形状 | `pnpm check` 链内 |
| `check:android-build-host` | 不在**跑命令的这台机器**上起模拟器/建 AVD（H1）、runbook fence（H2）、手册引用不断链（H3）、两枚门禁有人跑（H4）| `check-gate-wiring` 允许表内 |

**G11 为什么新增**：`linux-dev` 这四枚默认值只许有一处定义。两枚 `*_ON_HOST` 与那枚 host
各写各的，就会长成"构建在 A 树、验收取 B 产物"（§7 第 82 条的老形状搬到两台机器之间）。
它同时禁 `windows-pc` / `C:\src\heyta` 出现在收口点的**代码行**里（注释与在册迁移记录除外）——
拍板已改口，漂回去就是**把构建送回那台只该管 MSIX 的机器**。

**H1 为什么改了判法**：规则的原意从来不是"不许有人起模拟器"，而是"**不许在跑命令的这台 Mac 上**起"。
载体换到 `linux-dev` 之后，模拟器就该起在那台机器上 —— 所以豁免**不按文件名放行**，
判的是"那一行是否处在 `ssh <在册载体> … <<HEREDOC` 的体内"。把同一枚脚本改回本机起模拟器，
豁免不覆盖它（`--self-test` 有这一臂）。

---

## 七、设备腿

载体上起一台 AVD（KVM 硬加速，实测 25 秒起到可用）：

```bash
bash scripts/android-carrier-device.sh up       # 起（幂等），打印 serial
bash scripts/android-carrier-device.sh tunnel   # 本机→载体的 adb server 隧道
eval "$(bash scripts/android-carrier-device.sh env)"
bash scripts/android-carrier-device.sh status
bash scripts/android-carrier-device.sh down     # 只收本脚本起过的那台
```

⚠️ 三格在册坑，逐条都是实测换来的：

- **装机语言**由**这个包**的 per-app locale 决定（本镜像系统 locale 是 en-US）：
  `adb shell cmd locale set-app-locales com.heyta --locales zh-CN`。漏这一步的症状是
  "界面读回英文"，会被误判成词条没落。
- **服务端地址不能写 `127.0.0.1`**：设备在载体机上，那台机器的回环不是发起方的。
  模拟器里访问宿主机用 `10.0.2.2`。
- **`down` 按 PID 文件与 AVD 名收，不按名字 pkill**：这台机器上还有 litopia / ssos 各一台在册
  模拟器，`pkill -f emulator` 会一起打掉（`只对自己创建的对象动手`）。

---

## 八、边界（还没做到的，别当成已做到）

- 🔴 **发布签名没落到载体机。** 四个 `HEYTA_RELEASE_*` 键在载体机上不存在时，`build.gradle`
  把 release 变体挂到 `signingConfigs.debug` ⇒ 打出来的证书是 `CN=Android Debug`，
  `scripts/upload-dist.sh` 的 `assert_android_release_signature` 会拒绝发布它。
  这一步要的是**把 keystore 放到那台机器**（它现在只在 Mac 的 `~/.heyta-signing/`），
  那是凭据搬迁，需要单独点头，本批没做。
- ⚠️ **既有设备腿的 adb 调用还没接隧道**：`research/tools/mutation-rigs/w6-note-restore-device-arm.sh`
  的构建主机默认已改到 `linux-dev`，但它十几处 `adb` 仍假设设备挂在本机 —— 接
  `scripts/android-carrier-device.sh tunnel` 是下一批；在那之前它红在"adb 没有可用设备"是**预期**。
- ⚠️ **共享清单那条旅程的 Android 装置**仍未写，见
  [`../../docs/plans/collaboration-shared-lists.md`](../../docs/plans/collaboration-shared-lists.md) 末节。
  现成的两台腿：`verify:android-subscription`、`verify:android-vault-storage` 已经在同一台 AVD 上跑。

---

## 九、故障速查

| 症状 | 真实原因 | 怎么办 |
|---|---|---|
| `BUILD FAILED in 39s`，只报 `JvmVendorSpec … IBM_SEMERU` | 载体机没有 JDK 17（**不是**构建的 bug）| 跑 §二 那条命令 |
| 挂在 `Downloading https://services.gradle.org/…` 几十分钟 | 46 KB/s 的直连 | 跑 §二（预置进私有 wrapper 缓存，带 sha256 对账）|
| `NDK not configured` / `No version of NDK matched` | SDK 根里没有 27.1.12297006 | 跑 §二；核对 sha1 时取**该枚包自己那一段** |
| 远端 `pnpm: 未找到命令` | `ssh host 'cmd'` 起的是**非登录** shell | 构建命令已显式 `export PATH="$HOME/.local/bin:$PATH"`，别摘掉 |
| 界面读回英文 | 装机语言由这个包的 per-app locale 决定 | `adb shell cmd locale set-app-locales com.heyta --locales zh-CN` |
| `pgrep -f "emulator -avd heyta"` 读 0 但 `adb devices` 有设备 | 真实 argv 是 `…/qemu-system-x86_64-headless -avd <名>`，串里**没有** "emulator -avd" | 按 argv 里的独有 AVD 名匹配（§7 第 603 条那一族）|
| `pnpm build:android` 红在步骤 1 | 载体不可达 / 前置没补 | 如实报告环境，**不要**改成本机跑 |
| 构建根忽然不见了 | 这台机器上有人按 `heyta-*` 通配清扫过残留（2026-10-28 13:2x–14:4x 实测发生一次）| 见 §十 的在册目录；重建 = 重跑 §三，工具链不用重装 |

---

## 十、在册目录（清扫前请先读这一节）

以下三处**是载体的组成部分**，不是可回收的临时残留：

| 路径（载体机上）| 作用 | 删掉的后果 |
|---|---|---|
| `/home/xaiver/heyta-android-build` | 构建根（收口点解包到这里，步骤 2 的对账以它为靶）| 下一次构建变成一次全量重装：解包 + `pnpm install` + 依赖解析 |
| `/home/xaiver/.heyta-android-gradle` | 载体私有的 Gradle 用户目录（工具链钉子、wrapper 发行包、依赖缓存）| 冷解析重来（分钟级到十几分钟）|
| `~/.android/avd/heyta_*` | Android 设备腿的 AVD | 设备腿红"载体不存在"，与产品无关 |

`scripts/clean-build-tmp.sh` 只管 **Mac 的 `/tmp`**，它**不**管载体机上这三处 —— 反过来说，
任何按 `heyta-*` 通配远端目录的清扫动作都会打掉它们。要回收载体根，请先在 `BLOCKED.md` 记一笔。

---

## 附：本批实测的三条"读 0 不等于没有"

写给下一位，也写给别的线在载体机上跑的脚本 —— 三条都是这趟自己踩的，不是转述：

1. **`stat -c %s` 读 0 不等于产物是 0 字节。** `rsync --partial` 留下的半包尺寸是**真**的，
   而 `--partial` 之外的那次 `cat >` 断在半路时文件也在、尺寸也在 —— 所以"非零"不能当对账用，
   必须比 sha256（本手册 §五 第 2 条那四条对账里就有这一条）。
2. **`pgrep -f "emulator -avd <名>"` 是假阴性。** AVD 起来之后真实 argv 是
   `…/qemu/linux-x86_64/qemu-system-x86_64-headless -avd <名> …`，串里**没有** "emulator -avd"
   这串连续字样（§7 第 603 条那一族，这次是在载体机上复现的）。
   判"我起的那台关了没"要按 argv 里的独有 AVD 名，或直接读 `adb devices`。
3. **`bs=1m` 在 GNU dd 上是非法后缀。** Mac 的 BSD dd 接受，远端 `dd: 无效的数字: '1m'`
   直接失败 —— 我据此把一次"瞬间报错"读成了"8 MiB 3 秒传完"，差点把通道带宽结论写反。
   跨机命令里的单位后缀两边都要现量，别假设同一形状。
