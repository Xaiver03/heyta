# 四端重装 r104 + r105（2026-10-11 19:22–19:58）：跑在**只含已提交内容**的那棵隔离载体上

一趟 `pnpm reinstall:all`（mac / windows / android 三段）+ 一趟 `--only ios`（iOS 段），
四端各自"清旧包 → 从当前源码重打 → 卸旧装新 → 一条装上了当前产物且起得来的判据"。
**这一包与 [`../ux-final-20261011/reinstall/RESULT.md`](../ux-final-20261011/reinstall/RESULT.md) 的差别只有一件事，但那是承重的那件**：
r93 跑在**主检出工作树**上，本包跑在**一棵 `dirty=0` 的隔离检出**上 ⇒ 它证的是"已提交的源码装得出四端产物"，
而不是"我这台机器此刻的源码装得出"。

## 载体与装置（每条都是当场现量，不抄上一批）

| 项 | 值 | 怎么重取 |
|---|---|---|
| 载体 | `/Users/rocalight/heyta-carriers/heyta-uxhead-1009`（**复用** 10-09 那棵隔离 worktree，不是新建） | `git worktree list` |
| 树 | `HEAD=3e34ce98`、tree `2257f915`、起跑前 `git status --porcelain \| wc -l` = **0** | 该目录内 `git rev-parse HEAD HEAD^{tree}` |
| 为什么复用 | 根卷 **90% 满 / 剩 88 Gi**（`df -h .`），而这棵已有一份**真装**的 `node_modules`；⚠️ `cp -al node_modules` 那种"省地方"的建法已被本页否证（同 inode，装一次会顺着改到主树） | `df -h .`；`ls -d 载体/node_modules` |
| 锁对账 | 根 `pnpm-lock.yaml` sha256 前缀 `a7570a479cf64c7f`、`e2e/pnpm-lock.yaml` 前缀 `021a9df4add85253`（后者与 10-09 那格记录**逐字相同**） | `shasum -a 256 pnpm-lock.yaml e2e/pnpm-lock.yaml` |
| 命令（三端） | `pnpm reinstall:all`（`HEYTA_SKIP_NOTARIZE=1`） | `r104-reinstall-mac-windows-android.txt` |
| 命令（iOS 段） | `HEYTA_REINSTALL_TMP_DIR=$HOME/heyta-carriers/tmp-r105-<趟号> IOS_DEVICE_NAME=heyta-iphone-17pro HEYTA_SKIP_NOTARIZE=1 bash scripts/reinstall-all.sh --only ios` | `r105-reinstall-ios.txt` |
| 前置（同载体） | `pnpm install --frozen-lockfile` rc=0；`NO_COLOR=1 pnpm -r --no-bail build` ⇒ `Failed` 行数 0、起数与分母同值（台账「r102」那一格逐条记） | 见台账 |

## 逐端读数

| 端 | 结果 | 判据（脚本自己打的那一条） | 图 |
|---|---|---|---|
| macOS | ✅ | 包内 `web-dist` 与本机 `apps/web/dist` 同一次构建（9 枚 chunk）；安装副本自截屏 窗口 **2318×1508**、内容占比 **100.0%**、主蓝命中 **997** | `mac-window.png`（整窗）+ `mac-webview.png`（内容区） |
| Windows | ✅ | 源码包 432M / 清单 7888 条 → 远端 tar **sha256 逐字相同** → 远端新鲜度对账（`web-dist/index.html` + `native-bridge` + 7 枚 `assets/*.js`）→ `Add-AppxPackage` + 启动，判据 **5 条全在位** | `windows.png` |
| Android | ✅ | release APK 80M 重打 → `emulator-5554` 全新安装 `Success` → 前台窗口回读 `com.heyta/…MainActivity` → 窗口 **1080×2400**、内容占比 **56.0%**、主蓝命中 **4042** | `android.png` |
| iOS | ✅（第二趟补跑） | Pods 沙盒与 `Podfile.lock` 同步 → Release 构建成功 → 全新安装 → **已装的包比源码新** → 窗口 **1206×2622**、内容占比 **58.8%**、主蓝命中 **4091** | `ios.png` |

**人打开看过（AGENTS §6.2 规定一）**：四张逐张看过。**四张画的都是共享 UI**，但看得见多少不一样，这里按张说：
`mac-window.png` / `mac-webview.png` 与 `windows.png` 里弹窗背后就是任务面（收集箱标题、四象限分组那一列、对话助手面板、中文词条、主蓝控件）；
`android.png` / `ios.png` 里背景被弹窗的 scrim 整个压成灰底，能直接看到的只有弹窗本身（盾牌图标 + 标题 + 两段说明 + 两条法务链接 + 主蓝「同意并联网」与「只用本机」）。
四张**都停在首启「在使用联网功能之前」那张同意弹窗上** —— 这是全新安装 + 清存储之后设计里的第一屏，不是探针留下的状态。
⚠️ 所以这批图证的是"装上了当前产物、渲染的是我们的界面"，**不证**任何交互结论；各端交互矩阵的证据在各自的趟号里。
`windows.png` 左缘有一条**应用窗外的桌面内容**（取景比窗口宽）—— 这是"窗口截图当内容载体"那一族（本页 #170 记过它会同时假红和假绿），本趟的判据按窗口内算，成立。

## 这一包不证明的三件事

1. **不证明 `origin/main`**：`3e34ce98` 是**本地** main 的一枚（本线未 push）。远端那一棵要另取一趟。
2. **不证明干净检出上"整族 e2e 绿"**：本包只到构建与安装。e2e 那一档在同一棵载体上有读数，
   但那是**八枚**（20 条），不是 `check:ai-e2e` 的整族 —— 见台账「r103」那一格与它末尾的边界。
3. **不证明 iOS 段可以在无人核对下自动跑**：第一趟（r104）的 iOS 段是**被守卫拦下的**——
   两台已启动模拟器、默认设备名一台都不匹配 ⇒ 它没有盲选目标（那一段下一个动作就是 `simctl uninstall`），
   而是列出候选 + 给出准确命令后以 rc=1 收尾。补跑那趟显式传了 `IOS_DEVICE_NAME`，
   并且**必须**带 `HEYTA_REINSTALL_TMP_DIR`：不带的话截图落 `/tmp/heyta-reinstall-ios.png`，
   而那个名字下躺着**昨天另一趟**的同名文件（本线收图时先取到了那张，靠 `stat -f %Sm` 与 sha256 才发现）。
