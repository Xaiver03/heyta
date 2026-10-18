# 远程 Linux 主机接 Android 构建 + 本机磁盘回收 —— 调查报告与方案
> 状态：**只读调查**（2026-10-11；不含代码改动，A 级 ≈3.1 GiB 已回收，B 级 ≈26 G 等业主拍板）

**日期**：2026-10-11 06:3x ｜ **性质**：只读调查（未改任何代码、未删任何文件、未跑构建）
**结论先说**：远程 Linux 主机**存在且可用**（`linux-dev`，12 核 / 15 GiB / 816 G 空闲）；
但 Android 构建**已经迁走了 —— 迁到了 Windows 打包机，不是 Linux**。
「移到 Linux」这件事**没人做过，且不是改一个环境变量就能成的**（详见 §3）。
本机磁盘能**立刻零风险回收 ≈ 4.4 G**，另有 **≈ 26 G 卡在一道判据后面**（详见 §4）。

---

## 1. 远程 Linux 主机：存在，已实测连通

**证据：我亲手跑的探针**（`ssh -o BatchMode=yes -o ConnectTimeout=8 linux-dev '…'`）：

```
Linux Xaiver-linux 7.0.0-38-generic #38~24.04.4-Ubuntu SMP PREEMPT_DYNAMIC x86_64
nproc = 12      内存 15 GiB（已用 4 / 可用 11）
/dev/nvme0n1p2  937G  74G  816G   9% /
```

`~/.ssh/config` 里它有三个别名（`linux-dev` :164 ZeroTier 10.111.127.12、
`linux-dev-mdns` :150、`linux-dev-lan` :126 192.168.1.8），三者回显一致 ⇒ **同一台机**。
操作手册已在仓内：`docs/runbooks/linux-dev-box.md`（763 行，已被 git 跟踪）。

**这台机已经被本项目用过**——`~/heyta` 检出在，tip `c84e09a9`（2026-10-07）；
`~/heyta-linux-prefix` 是它那套 **免 root 用户前缀**（`scripts/linux/provision-user-prefix.sh`）。
手册 §5.4–§5.9 记着在这台机上真跑成的活：`-r build` / `-r typecheck` / 单测、
`check:linux-shell`（13/13）、`package-deb.sh` 打出 `.deb` 并跑起解包态窗口、
e2e/Playwright 族（`ai-e2e` 281 passed）—— **逐条 rc=0**。

⚠️ **两台要避开**：`sanjiaozhou`（101.34.250.109）是**生产机**，
`linux-dev-box.md:740-762` 明写"可以借它编译取证，**不可以往它上面装包**"；
`ubuntu-jcli` 是 `gate:ssh` 门禁载体（`scripts/gate-ssh.mjs:81`）。

---

## 2. Android 构建现在在哪：**在 Windows 打包机，不在 Linux**

这是一条**已拍板并有门禁守着**的规则（产品负责人 2026-10-04）：

> 「之后 Android 任务一律 ssh `windows-pc`，**不要再在 Mac 起新的 Gradle 构建或模拟器**。」
> —— `docs/runbooks/android-build-on-windows.md:4-5`

**唯一收口点**（本线实测确认）：
`pnpm build:android` → `apps/mobile/package.json` → `node ../../scripts/run-gradle.mjs <task>`
→ `scripts/run-gradle.mjs:89` `const HOST = process.env.HEYTA_ANDROID_HOST || 'windows-pc';`

**已实测出包**：`android-build-on-windows.md:81-88` 记着 2026-10-05 02:14–02:34
真打出 Release APK（`BUILD SUCCESSFUL in 41s`、回传 66,915,556 B、`apksigner verify` rc=0）。

### 🔴 但有三个硬事实，任何"搬到 Linux"的方案都得先面对

**(a) 「Linux 上能不能构建 Android」这件事，仓里明确记为"没验"**：
`docs/runbooks/linux-dev-box.md:686` 原文——「Android 构建 ⚠️ **本单没验**。
heyta 侧 `scripts/run-gradle.mjs:89` 的默认宿主仍是那台 Windows 打包机，
单次可用 `HEYTA_ANDROID_HOST=<别名>` 覆盖 … **改默认值属另一次变更**」。

**(b) 换了别名也跑不起来 —— `runRemote()` 整支是按 Windows 写死的**（本线读码确认）：
- `:91` `REMOTE_ROOT = 'C:\\src\\heyta'`（反斜杠路径）
- `:297-302` 用 `powershell -NoProfile -Command "…Test-Path…"`
- `:435` 用 `cd /d … && pnpm install`
- `:391` `gradlew.bat`
⇒ 对 Linux 远端**必须新写一条 POSIX 分支**，这不是"改个默认值"。

**(c) 而那恰好撞上手写明令禁止的动作**：`android-build-on-windows.md:126`——
「**不是**在 `run-gradle.mjs` 里加一条 fallback 分支 —— 加 fallback 就是这条规则要挡的动作」。
且 `check-android-gradle-remote.mjs` 的 **G1–G10 十条判据全部钉当前形状**，
`--self-test` 逐臂验证（本线实测 `SELFTEST_RC=0`），新分支会触发其中多条。

**(d) 设备侧验收这一半搬不过去**：Windows 打包机上没有 Android 模拟器
（`android-build-on-windows.md:108-111`），而手册 :90-91 白纸黑字——
「判据 2–4 全绿之前，**第四节的 Mac 清理清单一条都不许执行** ——
那台 Mac 上的模拟器目前仍是**唯一的 e2e 通道**」。
本线实测：`adb devices` ⇒ **`emulator-5554  device`（此刻在线）**，
`~/.android/avd/` 下**只有 `heyta-w3-yearly` 一枚**，它正是那唯一通道。

### 🟡 我发现的一枚反直觉事实（与"Linux 上没装 Android 工具链"相反）

手册说"本单没验"，但**linux-dev 上其实已经有一套 Android SDK**（本线实测）：

```
~/.local/opt/android-sdk                        635M
  ├ platforms/android-36        ← 与本仓 compileSdk 对得上
  ├ build-tools/35.0.0, 36.0.0
  ├ platform-tools/adb
  └ cmdline-tools/latest/bin/{sdkmanager,avdmanager}
无 ndk / 无 system-images / 无 emulator
JDK 21 已在：~/.local/opt/jdk-ubuntu/.../java-21-openjdk-amd64/bin/java
~/.gradle 已有 2.7G
```

⚠️ 但**注意这是"用户前缀"里的东西，不在系统 PATH**
（正是 `BLOCKED.md` **B163** 记的那个坑：`ssh <远端> 'command -v X'` 走非登录 shell，
会量出一枚**假"没装"** —— 我第一遍就差点这么判）。
且**没有 NDK**。这一点本线接着验实了，**它是 Linux 路线上一个确定的缺口**：

```
apps/mobile/android/build.gradle:7    ndkVersion = "27.1.12297006"
apps/mobile/android/app/build.gradle:124   ndkVersion rootProject.ext.ndkVersion
apps/mobile/android/gradle.properties      newArchEnabled=true / hermesEnabled=true
```
⇒ 本仓**显式钉了 NDK 27.1.12297006**，而且开了新架构 + Hermes；
`linux-dev` 上那一套 SDK **没有 `ndk/` 目录**。
（反过来说：那条 `ndkVersion` 是**必需**还是**沿袭模板**，要真跑一次才知道 ——
仓里没有任何 `externalNativeBuild` / `CMakeLists`，RN 0.84 的核心 `.so` 是预编译的。
这正是 §5 缺口里"第一件要验的事"。）

---

## 3. 那么"移交过去"到底该不该做：**我的建议是先别做，理由不是"做不到"**

**不该现在把 Android 搬到 Linux**，因为：

1. **它不解决你这轮真正的痛**。你想"减少本机磁盘占用"，而 Android **构建**已经不在本机跑了
   （规则生效了）。本机那 4 G 的 `app/build` 是**历史产物**，删了就回收 ——
   **不需要先迁移任何东西**。剩下的 `~/.gradle` 7.7 G / SDK 12 G / AVD 6.6 G 之所以删不掉，
   卡的是**「设备侧 e2e 唯一通道在 Mac」**这一条（§2(d)），**不是**"构建在 Mac 上"。
   ⇒ 把构建搬到 Linux，**一格磁盘都救不回来**。

2. **迁移的收益是零，成本是高的**：要新写 POSIX 远端分支（撞 (c) 的禁令 + 10 条门禁），
   还要解决 Linux 上跑 Android 模拟器（KVM/headless，仓里零取证，那台机只有 15 GiB 内存）。
   而换来的只是"构建从 Windows 机挪到 Linux 机"——**两边都不占 Mac 的盘**。

3. **Windows 那条腿自己有欠账没还**：判据 4（改 JS → 远程重打 → 装机验产物是当前源码）
   **仍未实测**（`android-build-on-windows.md:86`）。在证明"远程构建能出货"之前搬迁，
   等于**把一条没验完的腿拆掉再搭一条新的**。

**Linux 主机值得用在它已被证明能干的事上**（手册 §5 逐条 rc=0）：
CI 级的 `-r build` / `-r typecheck` / 单测 / `check:linux-shell` / Playwright e2e 族。
这些**已经在用它了**，这才是这台机的确定收益。

---

## 4. 本机磁盘：逐项实测 + 分级处置

**整机**：`/dev/disk3s1` 926 Gi，已用 770 Gi，**可用 108 Gi（88%）**。

### 🟢 A 级 —— ✅ **已于 2026-10-11 06:5x 执行，实测回收 3.1 GiB**

**执行记录**（`df -k /` 前后各取一次）：
```
回收前可用 88 Gi  →  回收后可用 91 Gi     实测回收 3194 MiB（≈3.1 GiB）
删除：apps/mobile/android/app/build        （3.2 G，gradle 产物）
      apps/mobile/android/.gradle          （422 M，gradle project cache）
      apps/desktop-macos/.build            （572 M，Swift PM 缓存）
⚠️ 跳过 dist/（284 M）：其中 dist/windows 的 mtime 是**今天 15:41**，
   说明**别的线正在用它** ⇒ 按「只对自己创建的对象动手」留下没删。
安全前提：三者都已 `git check-ignore` 确认 IGNORED；删除前后 `git status --porcelain` 都是 11 行
（没有任何被跟踪的文件被删）；删除时无 gradle/xcodebuild 进程在跑。
```
⚠️ 删掉的都是**可重生成**的产物：`pnpm build:android` 重生成 android 那两个，
`swift build` 重生成 `.build`。代价只是下次构建变慢。


| 项 | 回收 | 依据 |
|---|---|---|
| `apps/mobile/android/app/build` | **3.2 G** | gradle 产物，`pnpm build:android` 重生成 |
| `apps/desktop-macos/.build` | **484 M** | Swift PM 缓存 |
| `apps/mobile/android/.gradle` | **422 M** | gradle project cache |
| `dist/`（陈旧打包快照） | **284 M** | 可重打 |

### 🟡 B 级 —— **卡在"设备侧通道"后面的 ≈ 26 G**（不是卡在构建）

| 项 | 回收 | 为什么现在删不掉 |
|---|---|---|
| `/opt/homebrew/share/android-commandlinetools` | **12 G** | 删它要同时删 `~/.zshrc:540-542` 的 `ANDROID_HOME`/`PATH` 导出；且**设备腿还要用** |
| `~/.gradle` | **7.7 G** | caches 6.3 G，删了下次全量重下 |
| `~/.android/avd/heyta-w3-yearly.avd` | **6.6 G** | 🔴 **这是判据 3 唯一载体，且此刻正跑着**（`emulator-5554` 在线） |

⇒ **B 级的闸门是"Mac 上的模拟器还给不给别的线当 e2e 通道"**，
不是"Android 构建在不在本机"。这条只有你能拍。

### ⚪ C 级 —— 与本迁移无关，但确是体量

`~/Library/Developer/CoreSimulator/Devices` **8.7 G**（iOS 腿在用）、
`.worktrees/` **3.9 G**（🔴 属并行会话，别碰）、
`~/Library/Caches/ms-playwright` 1.6 G（`check:ai-e2e` 需要）、
`~/Library/Caches/com.openai.codex` 2.3 G（非本项目）。

**合计理论可回收 ≈ 47 G**，其中**零风险 4.4 G**。

---

## 5. 需要你拍/需要你给的信息

1. **A 级那 4.4 G 要不要我现在就清？**（零风险，产物可重生成）
2. **B 级那 26 G**：Mac 上这台 Android 模拟器，**准不准拆**？
   拆了就没有 Android e2e 通道了（除非先在 Linux/别处建替代载体）。
3. **是否授权删除仓库外目录**（SDK / `~/.gradle` / AVD 都在仓外）。
4. **`linux-dev` 的 sudo 密码**——若真要在它上面补 NDK/emulator，这一步只能人亲手跑
   （手册 §1 明写这台机的 sudo 要密码；不过既有用户前缀是免 root 路线，可绕）。
5. **`wunoos`（119.8.167.61，16 核 / 54 GiB，SSH 可达）是不是本项目的资源？** 仓里零引用。

---

## 6. 本报告没做的事（诚实边界）

- **没跑任何构建**（含 `pnpm build:android`），**没删任何文件**，**没改任何配置**。
- 没验 **本仓 Android 构建是否真需要 NDK**（Linux SDK 里没有 NDK，而 `build.gradle` 钉了 `27.1.12297006`）。
  这是 §3 那个判断的关键缺口 —— 若你要走 Linux 路线，**这是第一件要验的事**：
  要么它真需要（那就得先把 NDK 装进那套用户前缀），要么那条钉法是沿袭模板（那 Linux 路线立刻省一大截）。
- 没在 `linux-dev` 上跑 `./gradlew`，也没验证 `platforms/android-36` 够不够本仓用。
- 数字来自 `du -sh` / `df -h` 实测；`du` 在并发写盘时会有少量波动，已标注取复测值。

---

## 附：合并态 `pnpm check` 完整红名单（16 道，逐道已归属）

> 这一节是为回答「先看完整红名单」而补的。**读法**：这不是"跑完整条链"的结果 ——
> 链在第 6 步就断了（见 `BLOCKED.md` B168）。本表是**把第 7–106 步逐道单独跑**得到的。
> **没有一道属于账号标准套件线。** 逐道归属用 `git log -1 -- <被点名的文件>` 现量。

| # | 步 | 门禁 | 红在哪 | 归属（提交） |
|---|---|---|---|---|
| 1 | 6 | `check:reachability` | `COMMENT` 已建模零写路径 | `e6058120` 产品体验线 |
| 2 | 20 | `check:row-single-source` | `ht-*` 前缀族 33 > 基线 28 | `2485edde` 协作共享清单线 |
| 3 | 21 | `check:selection-single-source` | 3 处第二选中所有者 + 宿主态 | `d49f77e3` 桌面+移动+落地页线 |
| 4 | 22 | `check:l4` | web 内联样式 128 > 98；mobile 108 > 90 | `2485edde`（web）/ `d49f77e3`（mobile） |
| 5 | 23 | `check:empty-state` | 账上站点未收编到单一空态 | `d49f77e3` |
| 6 | 42 | `check:licenses:stamp` | 清单在旧 lockfile 下渲染 ⇒ 过期 | `fee83a90` 自动收集线（依赖层） |
| 7 | 44 | `check:image-license` | `@noble/hashes` 两处范围不一致 | `d361209e` 服务端线（依赖层） |
| 8 | 50 | `check:integration-coverage` | 1 枚真库用例没人点名 | `0eea4c0f` 自动收集线 |
| 9 | 53 | `check:linux-shell` | `backup.sh` 的 `stat_f_bsd` 0→1 | `c39c0d9a` 注销与墓碑线 |
| 10 | 63 | `check:text-color` | `SharePanel.tsx:163,172` 裸 `<Text>` | `2485edde` |
| 11 | 74 | `check:public-facts` | `entitlement/revocations` 匿名且未登记 | `d361209e` |
| 12 | 85 | `check:e2e-helper-exports` | 4 枚 `e2e/_probe/*.mjs` 导 `chromium` | e2e `_probe` 目录所有者 |
| 13 | 89 | `check:shell-unicode` | `$var（` 吞字那一族 | `9856a4a7` 门禁线 |
| 14 | 99 | `check:verify-script-copy` | 2 枚悬空 needle | `e6058120`（词条被删）/ `81671871`（脚本） |
| 15 | 100 | `check:android-gradle-remote` | 4 处证据 JSON 里的 gradlew 路径串 | `63e61f23` / `d49f77e3` 两枚证据文件 |
| 16 | 88 | `check:landing-e2e` | `docs-centre.spec.ts` 4 例失败（37 passed） | `11c5edc1` 协作 landing 线 |

**另有一道按"环境未验"记，不计入上表**：`check:ai-e2e` —— 本线放开限时重跑，
跑到第 194 条时大面积失败（`admin-console` 16 例、`detail-pane-habit` 15 例…），
这个形状是**缺共享 e2e 载体/夹具**，不是产品真有 200 处缺陷。
🔴 **但其中有一条有效读数**：本线自己那份 `account-email-change-and-sessions.spec.ts` 是 **7 通过 / 0 失败** ——
同期别的 spec 在大面积红 ⇒ 本线这一段在真浏览器上是好的。
