<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「多端构建与固定收尾流程」的完整规则（原文 §6.1 / §6.1.1）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

### 6.1 多端构建

```bash
pnpm -r build                   # 🔴 打包前**必须**先跑：APK/.app 里打的是 packages/*/dist
pnpm build:android              # Android Release APK（🔴 从 Mac/Linux 调用时会 ssh 载体机 linux-dev，见下方规则）
pnpm build:android:debug        # Android Debug APK
pnpm build:ios                  # iOS Release（仅 macOS）
pnpm --filter @heyta/mobile run build:android:bundle   # 上架用 AAB
```

> 🔴 **Android 载体规则（两道令，后者换载体、不解除前者的形状）**
>
> - 2026-10-04 产品负责人：「之后 Android 任务一律 ssh windows-pc，不要再在 Mac 起新的
>   Gradle 构建或模拟器。」起因不是整洁，是资源：headless 模拟器 3.6G+ 常驻 / 90% CPU，
>   SDK+AVD+Gradle 缓存吃掉 20G+ 磁盘。
> - **2026-10-28 产品负责人**：「安卓我需要在 Linux dev 上做，把整个安卓都迁移到 Linux dev 上。」
>   ⇒ 载体换成 `linux-dev`，**构建与设备侧验收同机**；`windows-pc` 只留 Windows 桌面壳（MSIX）那一腿。
>
> - 落地方式仍然是**只在一枚收口点分流**：`scripts/run-gradle.mjs`。所有 android 入口
>   （根 `package.json` 的 `build:android{,:debug,:bundle}` / `clean:android` → `@heyta/mobile`）
>   本来就汇成那一枚，所以不需要改各端命令，也不需要在 CI 里加条件。
>   Windows 上（任何 Windows 开发机）**逐字不变**地跑本机 gradle；macOS/Linux 走远端并把产物
>   回传到**消费者原本期望的路径**，好让 §7 第 27 条"APK 必须比源码新"继续有效。
> - **不静默降级**：载体不可达就红。`HEYTA_ANDROID_LOCAL_GRADLE=1` 是**显式例外开关**
>   （给"载体机正在重装"这类场景），不是兜底。
> - 载体默认值（主机 / 构建根 / SDK 根 / 私有 Gradle 用户目录）的**真源只有一处**：
>   `scripts/lib/sync-build-sources.sh` 顶部那四行。其余都是抄件，由 G11 逐枚对账 ——
>   两枚旋钮只移一个就是"构建在 A 树、验收取 B 产物"（§7 第 82 条搬到两台机器之间）。
> - 门禁：`pnpm check:android-gradle-remote`（已进 `pnpm check`）。它钉的是**形状**——
>   新开一条 `./gradlew` 入口、白名单比现实宽、回传路径与 `reinstall-all.sh` 的 `$APK`
>   对不上、绕开收口点、远程支里出现 `runLocal(`、第二份源码同步实现、探测不自证、
>   mtime 换算落错边、载体默认值漂移 —— 各自都会红
>   （`--self-test` 逐臂证明，臂 0 是阳性对照 —— **臂数由它自己打印，文档里不许抄**）。
>   对侧那半是 `pnpm check:android-build-host`：它禁的是"**在跑命令的这台机器上**起模拟器"，
>   换载体之后豁免**按"那一行是否在 `ssh <载体> <<HEREDOC` 体内"判**，不按文件名放行。
> - 操作步骤 / 载体前置（一条命令补齐）/ 通道实测 / 设备腿 / 边界，见
>   [`docs/runbooks/android-build-on-linux-dev.md`](../runbooks/android-build-on-linux-dev.md)。
>   旧载体（windows-pc）那一侧的历史实测**不重写**，仍在
>   [`android-build-on-windows.md`](../runbooks/android-build-on-windows.md) §七。
> - ⚠️ 一条**没被这次迁移解除**的边界：四个发布 keystore 键没落到载体机上，release 变体会挂到
>   `signingConfigs.debug` ⇒ 打出来的证书是 `CN=Android Debug`，`scripts/upload-dist.sh` 会拒绝发布它。
>   分流**已**替换本机通道，签名这一格没有。

### 6.1.1 🔴 固定收尾流程：清旧包 → 重打 → **四端重装**（每轮交付必须）

> 2026-09-30 产品负责人拍板，**纳入固定流程**：heyta 是多端应用，"完成一轮"的定义
> 是"**四个端都装上了当前源码的产物**"，不是"测试绿了"。
> 依据：§7 第 27 条（packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿）与
> `verify-mobile-ios.sh` 文件头（脚本只验不装，36 项结论全是旧二进制）——
> **"测试全绿 ≠ 这是当前产物"**。

```bash
pnpm reinstall:all              # 四端全跑：mac / windows / android / ios（默认）
pnpm reinstall:desktop          # 只 mac + windows
pnpm reinstall:mobile           # 只 android + ios
```

实现：`scripts/reinstall-all.sh`。**每一段都是：清掉现有安装包 → 从当前源码重新打包 →
卸旧装新 → 一个"装上的是当前产物且能起来"的判据**：

| 端 | 同步 | 清 | 打包 | 装 | 判据 |
|----|------|----|------|----|------|
| mac | 不需要（本机） | `/tmp/heyta-macos-dist` + `/Applications/Heyta.app` | `package-app.sh`（.app+.dmg+web-dist 进包+自截屏） | 拷进 /Applications（并清壳的 WebKit 存储） | **安装副本**启动自截屏：非空白 **且主蓝命中**（错误屏“非空白”，见 §7 第 82 条） |
| windows | 🔴 **本机工作树 → `C:\src\heyta`，且 sha256 对账** | `dist/windows` | `package-msix.sh`（远端 `windows-pc`，含 Remove+Add Appx） | 远端交互会话 | `ADD_APPX=OK` + `RESULT=OK` + `PAYLOAD_WEBDIST=True` + `M2D=OK`（壳自己的身份菜单判据） |
| android | 不需要（本机） | 旧 APK + `adb uninstall` | `pnpm build:android` | 模拟器全新安装 | install 输出 `Success` + 启动截图非空白且主蓝命中 |
| ios | 不需要（本机） | `simctl uninstall` + 旧 DerivedData | `xcodebuild Release` | `simctl install` | **新鲜度**（已装 main.jsbundle 比源码新）+ 截图非空白且主蓝命中 |

规则：

- **任一端失败 ⇒ 整体退出 1。没有静默跳过** —— `--skip`/`--only` 是显式逃生门，
  且汇总里把没装的端**大字列出**（"这轮没装 Windows"必须一眼可见）。
- 🔴 **"远端的字节 = 本地当前工作树"要有判据**（§7 第 82 条）：Windows 段的
  `sync_windows_sources()` 送的是 `git ls-files` + 未跟踪非忽略 + `apps/web/dist`，
  并用 `apps/web/dist/index.html` 的 sha256 本地/远端对账；**对不上就拒绝打包**。
  这条不是仪式 —— 2026-09-30 实测正是这里装了 Sep 28 的旧树而判据全绿。
- 主机不可达、模拟器没起这类**环境**原因，脚本会如实报因并判红 —— 不硬装、不降级。
- 截图判据复用零依赖的 `png-stats`（非空白/无透明 + mac 端还要**数得出 heyta 主蓝**）；
  iOS 新鲜度判据沿用 `verify-mobile-ios.sh` 那次事故的产物（main.jsbundle mtime ≥ 源码 mtime）。
- 打包脚本自己会做的事（签名/公证/远端 schtasks 安装）**不在本脚本里重写** ——
  它只编排；改打包行为去改各端的 package 脚本。
- 🔴 **轮次工作目录有保留策略**（2026-10-24 实测：`$HOME` 下堆了约 29 GB 的同名 `.app`）。
  脚本**开跑前**（在写任何产物之前）扫 `dirname "$RT"` 里**同族**的旧轮次目录
  （`heyta-r<数字>-{tmp,reinstall,mac-tmp,android-tmp}`、`heyta-macos-dist-r<数字>`，
  只认这个精确形状），**保留最近 2 轮**（`HEYTA_KEEP_ROUNDS`，必须是 ≥1 的整数，非法就停；
  **当前这一轮按 realpath 比、永远不删**），其余 `rm -rf` 并逐条打印「体积 + 路径」，
  末尾一行释放汇总；一个都没删时也会打印「无旧轮次可清」（"跑了但没活干"必须与"根本没跑到"分得开）。
  `HEYTA_PRUNE_ROUNDS=0` 关闭（关闭时会打印一行说明）。
  收尾（含失败路径）若 `HEYTA_KEEP_DIST` 未设为 1，删掉本轮 `$MAC_OUT` 里的 `Heyta.app`
  与 `*.dmg` —— 装好的那份在 `/Applications`，产物留着只会被 Spotlight 再索引一遍；
  **打包/安装自检的截图与日志不删**，那是证据。`HEYTA_PRUNE_ONLY=1` 只清场不打包（自检用）。
- 🔴 **每轮开工先清旧的、可回收的构建产物**（第 0a 步）：`scripts/clean-artifacts.sh --apply`。
  它只删可重建的 dist / `.build` / ios build / android build / Playwright 结果与部署暂存 tar，
  保留 `node_modules` / `Pods` / `.pnpm-store` / `.worktrees` / `evidence`；清理失败只警告、
  不阻断重建。`HEYTA_SKIP_ARTIFACT_CLEAN=1` 跳过这一步。超预算由 `pnpm check:disk-budget`
  判红（默认 2048 MB，`HEYTA_ARTIFACT_BUDGET_MB` 可调）。
- 🔴 **别再每轮手写一个新的 `HEYTA_REINSTALL_TMP_DIR`。** 那正是上面那 29 GB 的成因：
  每轮一个 `~/heyta-r<NNN>-tmp`，而脚本此前没有保留策略也没有收尾删除 ⇒ 每轮留下约
  430 MB 的 `.app` + `.dmg`，Spotlight 又索引**任意位置**的 `.app`。要隔离就把轮次号交给
  脚本、或**复用同一个父目录**（让保留策略有东西可清）；别用 `rm -rf ~/heyta-*` 一把梭 ——
  那个父目录里还有并行 lane 的工作区（`heyta-carriers/` 这类），删了等于毁掉在途工作。

- **事实源（环境 / 版本 / 产物 / 状态）**：[`docs/reference/build-matrix.md`](../../docs/reference/build-matrix.md)
- **操作步骤（怎么打、怎么验、坑）**：[`docs/runbooks/multi-platform-build.md`](../../docs/runbooks/multi-platform-build.md)
- 🔴 **门禁绿 ≠ 能打包。** `pnpm check` 不做平台打包；本仓库已三次踩到"测试全绿但打不出包"
  （§7 第 27、28、31 条）。构建要单独跑、产物要单独验。
- 🔴 **门禁绿 + 打得出包 ≠ 装上了当前产物。** 每轮交付的固定收尾是 §6.1.1 的
  `pnpm reinstall:all`（清旧包 → 重打 → 四端重装，每端有判据）。
- Windows 打包机装机脚本：`scripts/windows/setup-build-host.ps1`（幂等；`-Step verify` 只体检）。
  🔴 该脚本**必须保持纯 ASCII** —— PS 5.1 把无 BOM UTF-8 当 ANSI 读，中文会破坏解析。

**提交前至少跑**：`pnpm -r typecheck && pnpm -r test`。

### 6.1.2 carrier 目录：用完即弃

**定义**：carrier（载体）= 为了让**别的机器 / 别的 lane** 跑一次构建（或一次验收），把工作树
**搬过去**的那个目录。判据三条，缺一条就不是 carrier：

- **不是 git 仓库**（或者只是 `rsync`/`tar` 出来的树，`.git` 只是个指针文件）；
- **不是事实源** —— 事实源永远是主仓库，carrier 里的源码是**某一次搬过去的快照**；
- **一次性**：它的用途在那一趟跑完就结束了。

命名约定：`$HOME/heyta-carriers/<lane>-<用途>`（例：`$HOME/heyta-carriers/head-r128`、
`collab-m6-ios`）。🔴 **不要**在 `$HOME` 直接铺 `heyta-r<NN>-tmp` 那种**轮次目录** ——
那是 `reinstall-all.sh` 的轮次目录，归 §6.1.1 的保留策略管（`HEYTA_KEEP_ROUNDS`，默认留 2 轮
+ 收尾删本轮 `.app`/`.dmg`）。两者别混：轮次目录由**脚本自己**开、自己收；
carrier 由**人**开、**人**收（`scripts/clean-carriers.sh`）。

#### 三条纪律

1. **搬完就跑、跑完就清**。收尾动作是 `bash scripts/clean-carriers.sh --apply`
   （默认干跑，只列"会删什么 + 能释放多少"）。不要把它留着当"第二份工作树"——
   留着的结果就是下面那张表：11 GB，而且没有任何一层会来清。
2. **里面只允许长期留下不可重建的东西**：TestFlight 的 `.xcarchive` / `.ipa`、签名产物、
   以及你**要引用**的构建日志。其余（`node_modules` / `Pods` / `DerivedData` / `.build` /
   `test-results` / `dist` / `dist-types` / `.gradle` / `heyta-ios-release` /
   `heyta-macos-dist` / `tmp-*` / `*.tgz` / `*.dmg`）全部**可重建**，用完即删。
   工具侧的依据：这些名字在 `clean-carriers.sh` 的黑名单里，而
   `ios-tf-artifacts` / `*.xcarchive` / `*.ipa` / `*.dSYM` / `.git` 在白名单里 ——
   **白名单优先于黑名单**，所以 `ios-tf-artifacts/node_modules` 永远不会被删。
3. **别把主仓库的 `apps/*/evidence` 再拷一份进去**。主仓库已经有同一份，而它是**取证**
   （§6.2 规定一：界面验收必须真跑 + 真看截图）。重复拷贝进去的那 1.3 GB 既不是证据
   （它是副本）、又和证据同名 —— 误删代价最高，所以 `evidence` 在工具里单列一个开关
   `--include-evidence`，**默认不动**。

#### 反例：今天的读数（11 GB → 675 MB）

2026-10-24 实测 `~/heyta-carriers` 长到 **11 GB**：**三份**完整的搬运工作副本，每份都自带
一整套依赖与产物。逐项拆开看，"能不能重建"一栏全是 ✅ —— 也就是说这 11 GB 里有
**10.3 GB 是纯粹的重建余料**：

| 内容 | 体积 | 可重建？ |
|---|---|---|
| `collab-m6-ios/DerivedData`（Xcode 中间产物 + 模拟器产物） | 5.3 GB | ✅ 重跑构建就长回来 |
| `heyta-wt-collab-m5/node_modules`、`head-r128/node_modules` | 1.1 GB × 2 | ✅ `pnpm install` |
| `e2e/test-results`（Playwright 每跑一次都往这儿落） | 430 MB | ✅ 下一次跑 |
| `apps/desktop-macos/.build`（SwiftPM 产物 ×2） | 323 MB + 147 MB | ✅ `swift build` |
| `apps/mobile/ios/Pods`（CocoaPods 依赖 ×2） | 166 MB × 2 | ✅ `pod install` |
| 重复的 `apps/*/evidence` 截图归档（**主仓库已有同一份**） | 1.3 GB | ✅ 副本，不是证据 |
| 旧打包 `heyta-f97013de.tgz` + 几个 `tmp-*` | 138 MB | ✅ |
| `ios-tf-artifacts` 里那份 TestFlight `.xcarchive` | 154 MB | 🔴 **不可重建** ⇒ 保留 |
| 构建日志（要引用的那几份） | 16 MB | 🔴 不可重建 ⇒ 保留 |
| 源码树（carrier 本体，不是产物） | 478 MB | 保留 |

清完留下 **675 MB**。为什么会长到 11 GB：① 每份副本都自带 `node_modules`/`Pods`/
`DerivedData`（搬一次 = 复制一遍依赖）；② `e2e/test-results` 与 `DerivedData` 是**每跑一次
就多一份**的落点；③ **没有任何规则说"这些是可删的"** —— 手工清完只解决了这一次，
所以这条规则必须落在工具 + 本文件 + [`environment-traps.md`](../reference/environment-traps.md)
（#546）三处。

#### 工具

```bash
bash scripts/clean-carriers.sh                     # 干跑：逐条 体积 + 路径，末尾"可释放 X"
bash scripts/clean-carriers.sh --apply             # 真删
bash scripts/clean-carriers.sh --include-evidence  # 连 evidence 一起（默认不动）
bash scripts/clean-carriers.sh --keep my-vendor    # 追加白名单（可重复）
bash scripts/clean-carriers.sh --json              # 只往 stdout 吐 JSON（给后续脚本用）
```

- 根目录 `$HEYTA_CARRIERS_ROOT`，默认 `$HOME/heyta-carriers`；**根不存在 / 解析后是 `/`、
  `$HOME`、仓库根或其祖先 ⇒ `exit 4`**，一个字节都不动（`rm -rf` 的形状判据，
  同族写法见 `apps/desktop-macos/scripts/package-app.sh` 的 `OUT_DIR`）。
- 可删名单**只认精确目录名**（`tmp-*` 与扩展名是仅有的通配族），不认模糊 glob：
  `dist-esm` 是产物、`distribution-notes.md` 是文档、`node_modules.bak` 可能是别人正在救的现场。
- 删除失败只 warn、继续，最后用 `exit 1` 报"有 N 项没删掉"。
