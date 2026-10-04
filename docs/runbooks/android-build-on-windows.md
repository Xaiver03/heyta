# Android 构建统一到 windows-pc —— 操作手册

> 状态：**进行中**（分流已落进唯一收口点并有门禁；**远程真构建尚未跑过一次**）
> 决策来源：产品负责人 2026-10-04 拍板 ——
> 「之后 Android 任务一律 ssh windows-pc，不要再在 Mac 起新的 Gradle 构建或模拟器。」
> 起因不是整洁，是资源：Mac 被 headless 模拟器打爆（3.6G+ 常驻、90% CPU），
> SDK/AVD/Gradle 缓存吃掉约 20G+ 磁盘。
>
> **事实源分工**：环境/版本/产物/状态 → [`../reference/build-matrix.md`](../reference/build-matrix.md)；
> 本文件只写"怎么打、怎么验、边界在哪"。AGENTS 的规则本体在 §6.1。

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
| Windows（就是打包机本身） | **逐字不变**地在本机跑 `gradlew` —— 远端那条命令也是 `pnpm build:android`，两条路必须等价 |
| macOS / Linux | `ssh windows-pc` 同步源码 → 远端 `gradlew.bat <task>` → 回传产物到**消费者原本期望的路径** |

不静默降级：远程不可达就直接红，不会退回"那我在本机跑一下"。
确实要在本机跑（例如远程主机在重装）才显式加 `HEYTA_ANDROID_LOCAL_GRADLE=1` —— 那是**例外开关，不是兜底**。

远端仓库根：`C:\src\heyta`（MSIX 打包流程一直在用那台机器和那个树）。

## 二、怎么打

```bash
# 1. 先看计划，一个字节都不写（八步全打出来，含将执行的 ssh / scp 原样命令）
node scripts/run-gradle.mjs assembleRelease --dry-run

# 2. 真打（Mac 上这条命令 = 远程构建 + 回传）
pnpm build:android              # Release APK
pnpm build:android:debug        # Debug APK
pnpm --filter @heyta/mobile run build:android:bundle   # 上架用 AAB
```

前置：`pnpm -r build` 必须先跑过 —— 步骤 0 会检查 10 个 workspace 依赖的 `packages/*/dist`
在不在（清单从 `apps/mobile/package.json` 现推导，不写死）。这就是 AGENTS §6.1 那句
"打包前必须先 `pnpm -r build`"，APK 里打的是 `dist`。

源码同步走 `scripts/lib/sync-windows-sources.sh` 的 `sync_windows_sources_for_android`，
与 MSIX 那条腿共用同一个内部实现（`_heyta_windows_sync_push`：清单 → tar → scp →
**远端收到的那一整包的 sha256 与本地逐字相同**才解包 → 远端先清后解）——
对不上就拒绝构建（§7 第 82 条的常驻防线）。

> ⚠️ 两条腿的**对账锚点不一样**，这是刻意的：MSIX 那一腿除了 tar 之外还要
> `apps/web/dist/index.html` 与桥的 bundle 两条按文件的哈希对账 + chunk 计数
> （因为那两个"构建产物"本身是壳的构建输入）；Android 那一腿构建输入是
> `packages/*/dist`，`index.html` 对 APK **什么都不证明**，所以只用 tar 的 sha256。
> 同一枚同步、两种锚点 —— 不要为了"看起来统一"把它们并成一套。

产物回传后本地 mtime 回写成**远端构建完成时刻**：这样
"APK 必须比源码新"那条新鲜度判据（§7 第 27 条）在远程构建下仍然有效。
路径对账由 `check:android-gradle-remote` 的 G3 钉住：`run-gradle.mjs` 回传落点必须
逐字等于 `scripts/reinstall-all.sh` android 段里 `$APK` 读的那个路径。

## 三、验收判据

**这一节只有第一条是实测过的。** 其余写在下面，是为了下一轮打远程构建时照着收读数，
不是"已经满足"。

| # | 判据 | 状态 |
|---|---|---|
| 1 | 门禁：`node scripts/check-android-gradle-remote.mjs --self-test` 七臂按预期转红/转绿 | ✅ 实测 2026-10-04 23:5x（臂 0 = 阳性对照，臂 1–6 各抓一条 G1–G6） |
| 2 | 远程真打出 Release APK，`apksigner verify` 通过 | 🔴 **未实测** —— 分流落地后还没有跑过一次真构建 |
| 3 | APK 拉回本机装进模拟器，启动截图**非空白且主蓝命中**（§6.1.1 判据） | 🔴 未实测 |
| 4 | 连续两轮「改 JS 源码 → 远程重打 → 装机」验产物是当前源码（防 §7 第 27 条旧 bundle） | 🔴 未实测 |

⚠️ 判据 2–4 全绿之前，**第四节的 Mac 清理清单一条都不许执行** —— 那台 Mac 上的模拟器
目前仍是唯一的 e2e 通道，而远程通道还没被证明能出货。

## 四、迁移验收通过后的 Mac 释放清单（尚未执行）

| 释放项 | 大小 | 动作 |
|---|---|---|
| Homebrew Android SDK | 12G | 删 `/opt/homebrew/share/android-commandlinetools` |
| `heyta-w3-yearly` AVD | 3.6G | 删 `~/.android/avd/heyta-w3-yearly.*` |
| Gradle 缓存 | 6.4G | 删 `~/.gradle` |
| `~/.zshrc` 里 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `PATH` 导出 | — | 删那两段 |
| 常驻 headless 模拟器 | 3.6G 内存 | `adb emu kill` |

这些都在**仓库之外**（用户主目录 / Homebrew），本仓库的门禁管不到它们，
删除是要人点名授权的动作 —— 尤其 `adb emu kill`：它就是判据 3 现在唯一的载体。

## 五、边界（别读多）

- **Windows 侧没有 Android 模拟器**：无 emulator 本体、无 system-images。
  所以 Android 的**设备侧验收**目前仍然只能在 Mac 的模拟器上跑
  （`verify-mobile-*` 那一族）。把模拟器搬上 windows-pc 需要先开 BIOS 虚拟化 +
  Windows 的 Hyper-V / 虚拟机平台，那是管理员 + 重启级的人工动作，**未做**。
- **e2e 端口类验收与此无关**：`check:ai-e2e` 那三段跑的是 Playwright + web 构建，
  不碰 gradle，因此不受这条规则约束（AGENTS §6.1 的规则量的是"起 Android 构建或模拟器"）。
- 🔴 **从哪棵树调用它会决定远端装的是谁的源码**：同步清单是 `git ls-files -co --exclude-standard`
  （工作树，含**别人未提交的半成品**），而 `C:\src\heyta` 是**共享**的构建宿主 —— MSIX 那条腿也在用它。
  所以第一次真远程构建应当在**干净的隔离载体**里发起，不是在共享主检出里顺手跑。
  这与 AGENTS §8.9"共享资源独占验收"是同一件事，只是宿主换成了远端那台。
- **备用机** `windows-codex`（未探测）不在本手册的路径里；换宿主是改旋钮
  `HEYTA_ANDROID_HOST`（远端仓库根另有 `HEYTA_ANDROID_REMOTE_ROOT`），
  **不是**在 `run-gradle.mjs` 里加一条 fallback 分支 —— 加 fallback 就是这条规则要挡的动作。

## 六、门禁与它的现量读数

`scripts/check-android-gradle-remote.mjs` —— 纯静态（不联网、不构建），钉的是**形状**：
新开一条 `./gradlew` 入口 / 白名单比现实宽 / 回传路径与 `reinstall-all.sh` 的 `$APK`
对不上 / 绕开收口点 / 远程支里出现 `runLocal(` / 长出第二份源码同步实现，各自都会红。

```bash
pnpm check:android-gradle-remote
node scripts/check-android-gradle-remote.mjs --self-test
node scripts/check-android-gradle-remote.mjs --root <候选树>   # 注入验证用，不动工作树
```

2026-10-04 现量（本机、真树）：

| 读数 | 值 |
|---|---|
| 真树 | `rc=0`，`G1/G2 扫描到 gradlew 落点 5 处（白名单 3 ／ 基线命中 2 ／ 违规 0）` |
| `--self-test` | `rc=0`，七臂：臂 0 阳性对照 0 红，臂 1–6 **各恰好 1 条**红 |
| 喂旧内容 | `git show HEAD:scripts/run-gradle.mjs`（分流之前那份）放进候选树 ⇒ `rc=1`、🔴 4 条 |
| 存量基线 | `scripts/verify-mobile-aed.sh`、`scripts/verify-android-vault-storage.sh` 两条**待迁**，各自登记了"为什么还留着"；迁走而基线不撤 ⇒ G2 红 |
| 扫描面 | 不含 `.md` 与 `.ps1`，且扫描器自身按夹具豁免（它的形状由七臂守）——理由写在脚本文件头 |

⚠️ G1 抓到过一次**它自己的形状**：首跑报了 12 条，全部来自本文件里那些 needle 与打印文本。
处置是**点名豁免 + 写明理由**，而不是把 `'gradlew'` 拆成两段字符串来躲匹配 ——
拆开之后基线 needle 就不再是它要匹配的真实形状，判据会跟着一起烂。
