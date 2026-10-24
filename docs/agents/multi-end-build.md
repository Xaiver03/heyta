<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「多端构建与固定收尾流程」的完整规则（原文 §6.1 / §6.1.1）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

### 6.1 多端构建

```bash
pnpm -r build                   # 🔴 打包前**必须**先跑：APK/.app 里打的是 packages/*/dist
pnpm build:android              # Android Release APK（🔴 从 Mac/Linux 调用时会 ssh windows-pc，见下方新规）
pnpm build:android:debug        # Android Debug APK
pnpm build:ios                  # iOS Release（仅 macOS）
pnpm --filter @heyta/mobile run build:android:bundle   # 上架用 AAB
```

> 🔴 **2026-10-04 新规（产品负责人拍板）**：Android 任务一律 `ssh windows-pc`，
> **不要再在这台 Mac 上起新的 Gradle 构建或模拟器**。原因不是整洁，是资源：
> headless 模拟器 3.6G+ 常驻 / 90% CPU，SDK+AVD+Gradle 缓存吃掉 20G+ 磁盘。
>
> - 落地方式是**只在一枚收口点分流**：`scripts/run-gradle.mjs`。所有 android 入口
>   （根 `package.json` 的 `build:android{,:debug,:bundle}` / `clean:android` → `@heyta/mobile`）
>   本来就汇成那一枚，所以不需要改各端命令，也不需要在 CI 里加条件。
>   Windows 上（就是打包机本身）**逐字不变**地跑本机 gradle；macOS/Linux 走远端并把产物
>   回传到**消费者原本期望的路径**，好让 §7 第 27 条"APK 必须比源码新"继续有效。
> - **不静默降级**：远端不可达就红。`HEYTA_ANDROID_LOCAL_GRADLE=1` 是**显式例外开关**
>   （给"远程主机正在重装"这类场景），不是兜底。
> - 门禁：`pnpm check:android-gradle-remote`（已进 `pnpm check`）。它钉的是**形状**——
>   新开一条 `./gradlew` 入口、白名单比现实宽、回传路径与 `reinstall-all.sh` 的 `$APK`
>   对不上、绕开收口点、远程支里出现 `runLocal(`、第二份源码同步实现 —— 各自都会红
>   （`--self-test` 逐臂证明，臂 0 是阳性对照 —— **臂数由它自己打印，文档里不许抄**）。
> - 操作步骤 / 验收判据 / Mac 释放清单 / 边界（**Windows 侧没有 Android 模拟器**，
>   所以设备侧验收目前仍在 Mac）见
>   [`docs/runbooks/android-build-on-windows.md`](../../docs/runbooks/android-build-on-windows.md)。
>   ✅ 那条"远程真打出 APK"的判据**已实测通过**（2026-10-05 02:14–02:34：`BUILD SUCCESSFUL in 41s`、
>   回传 `size=66,915,556 B` 且 sha256 与远端逐字相同、本地 mtime 回写为远端完成时刻、
>   `apksigner verify` rc=0 —— 逐项读数在 [`docs/runbooks/android-build-on-windows.md`](../../docs/runbooks/android-build-on-windows.md) §7 那张表的第 2 格）。
>   ⚠️ 它证到的是"远程打出的是一份**合法签名**的 APK"，**不是**"可以上架的发布签名"：
>   四个发布 keystore 键任一缺失时 `build.gradle` 把 release 变体挂到 `signingConfigs.debug`，
>   所以那趟的证书 `CN=Android Debug`。分流**已**替换本机通道，签名这一格没有。

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
