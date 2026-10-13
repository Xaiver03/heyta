# r108：第五趟四端重装（从当前 HEAD 重打并四端重装）

**跑的时间**：2026-10-13 13:31–15:16（本机时区）。判决取日志里的 `DESKTOP_RC=` / `MOBILE_RC=` / `IOS_RC=` 三行，不取包装任务的退出码。

| 腿 | 退出 | 载体（哪一棵树 + 那一枚提交） | 当场印出来的判据 |
|---|---|---|---|
| mac | `DESKTOP_RC=0` | `/Users/rocalight/heyta-carriers/r108-head` @ `769e6258`（`git worktree add --detach`，起跑前 `dirty=0`） | `✅ 已安装到 /Applications/Heyta.app`、`✅ 安装对账：.app 里的 web-dist 与本机 apps/web/dist 是同一次构建（9 个 chunk）`、`✅ 窗口 2318x1508、heyta-reinstall-mac-installed.png.webview.png 内容占比 74.6%、主蓝命中 997 —— 是共享 UI` |
| windows | `DESKTOP_RC=0` | 同一棵 `r108-head` @ `769e6258` | `✅ 远端收到的是这一包（tar sha256=682caf467184ded2… 逐字相同）`、`✅ 远端新鲜度对账通过（web-dist/index.html=1f165d01f677aed1… bridge=4dfc0d2f46524aa7… assets/*.js=7 枚一致）`、五条判据 `ADD_APPX=OK / PAYLOAD_WEBDIST=True / M2D=OK / RESULT=OK / SHORTCUT_OK=True` |
| android | `MOBILE_RC=0` | 同一棵 `r108-head` @ `769e6258`（release APK 走远端打包机重打） | `✅ 模拟器 emulator-5554 全新安装成功`、`✅ 前台窗口确认：mCurrentFocus=Window{… com.heyta/com.heytamobile.MainActivity}`、`✅ 窗口 1080x2400、内容占比 55.9%、主蓝命中 4042 —— 是共享 UI` |
| ios | `IOS_RC=0` | 🔴 **主检出** @ `769e6258`（偏离见下面第二段） | `✅ 沙盒已同步（Manifest.lock == Podfile.lock）`、`✅ 构建成功`、`✅ 已安装进模拟器（全新安装）`、`✅ 已装的包比源码新 —— 这一轮装的是当前产物`、`✅ 窗口 1206x2622、内容占比 58.8%、主蓝命中 4091` |

三枚钉住"跑的是哪一版装置"的现量（同一枚 blob 覆盖三腿，所以三腿的判据是同一套）：
`RUNNER_BLOB=46167227685128b0474224daf10c4eb7f66e88a9`、`LOCKFILE_BLOB=8359a3ee62455e1b2ca94a5126cec4550e8beea9`、
`CARRIER_HEAD=MAIN_HEAD=769e6258e10efc080c412fa94e6fb80964dea42d`。

## 🔴 一处偏离，写明而不是抹掉：iOS 腿换了树

新载体的 iOS 腿第一步是 `pod install`，而它撞上一条 **567 B/s** 的 `repo1.maven.org` 通道：
22.3 MB 的 hermes 包 75 分钟走了 10%（`Left Speed` 那列印着 ETA ≈ 11 小时）。
成因不是网络玄学，是**缓存按树住**：hermes 的 tarball 落在各自那棵树的
`apps/mobile/ios/Pods/hermes-engine-artifacts/` 里。现量 —— 主检出那目录**两枚都在**
（`hermes-ios-250829098.0.9-debug.tar.gz` 与 `-release.tar.gz`），而新载体那目录只有一枚
`hermes-ios.download`（半写的下载中文件）+ debug ⇒ 它必须现场去 maven 拉，而那条通道当时只有 567 B/s。
处置：停掉我自己那条链（`chain-r108.sh` 及其子进程，全部按 pid + cwd 认过人），
把 iOS 腿改跑在**主检出**上 —— 那里 `apps/mobile/ios/Pods` 已在册且 `Podfile.lock` 与
`Pods/Manifest.lock` 逐字相同（`shasum` 同为 `2e53924f4ebbf4a05a7d031f61d6027767976ef4`），
同一枚装置脚本 5 分钟跑完并给出上面那五行判据（它的 pod 日志里连"Fetching podspec for hermes-engine"
那行下载都没有，直接进 `Setting USE_HERMES build settings`）。

⇒ 这一腿的"当前产物"仍然是可主张的，但它的限定要一起读：
**载体不是"只含已提交的隔离检出"那一档**，而是主检出。
差集现量（起跑前）：`git status --porcelain -- apps/mobile apps/web/src packages/ apps/desktop-macos apps/desktop-windows server/src`
只有 1 枚，且是 `?? apps/mobile/evidence/profile-center/android-r99-fixed/`（一枚外来证据目录，不是打包输入）。
收尾：`r108-ios-dirty-baseline.txt` 与 `r108-ios-dirty-after.txt` **都是空文件** ⇒ 这一腿没有把任何受跟踪文件写脏
（本线以前记过 `Podfile.lock` / 两枚 `Info.plist` 会被改写的形状，这一次没发生）。

## 人看过图（AGENTS §6.2 规定一）

四张逐张打开看过：`mac-webview.png`（亮色收集箱 + 「在使用联网功能之前」同意卡 + 右侧对话助手）、
`android.png` 与 `ios.png`（同一张同意卡在全新安装的首屏，标题/两条要点/两个链接/两枚按钮全部完整、无截断、无叠字）、
`windows-first-run.png`（同意卡 + 头像菜单展开着「登录账号 / 个人中心 / 应用设置」）。
⚠️ `windows-first-run.png` 左上角有一小块**不属于本应用**的窗口文字（远端交互会话里叠在后面的部署脚本控制台），
它不是产品缺陷，但也不许被读成"界面画错了"；`mac-window.png` 按在册口径**不能**当 UI 证据（抓窗口时 WKWebView 不进合成），
判据读的是 `mac-webview.png` 那一枚。

## 这一包不证明的三件事

1. **不证 `origin/main`** —— 本线全部提交只在本地 `main`，没 push。
2. **不证深浅两档都装过** —— 四张图取的是各端首屏默认档（本轮 mac 落在亮色，r102 那趟落在暗色），
   主题切换的读数在台账「深浅主题」那几格，不在这里。
3. **不证小组件卡片在系统里换了字** —— 那需要桌面级读数，台账 02:1x 那一格把它留在待办里。

## 没入库的每步日志（一条 ignore 规则 + 一枚体积，都给出可复跑的位置）

`.gitignore:49` 写着 `*.log` ⇒ 装置每步落的那些日志**默认进不了仓**（`heyta-reinstall-{build,apk,pod,pod-1,mac,win,ios-build}.log` 全在这一档）。
本包的处置是把**三腿 runner 的汇总**改名成 `.txt` 入库（`runner-desktop.txt` / `runner-mobile.txt` / `runner-ios.txt`），
其余每步日志留在私有落点，路径如下（本机路径，重启即失）：

- iOS `xcodebuild` 全量日志（17 MB，即使不被 ignore 也不入库）：`/Users/rocalight/heyta-r108-tmp/ios-main/heyta-reinstall-ios-build.log`
- 远端 APK 构建日志：`/Users/rocalight/heyta-r108-tmp/mobile/heyta-reinstall-apk.log`
- mac 打包/公证日志：`/Users/rocalight/heyta-r108-tmp/desktop/heyta-reinstall-mac.log`；远端 windows：`…/desktop/heyta-reinstall-win.log`
- 那条撞在 567 B/s 上的载体 pod 日志（本格的成因证据）：`/Users/rocalight/heyta-r108-tmp/mobile/heyta-reinstall-pod-1.log`

## 复跑

```
git worktree add --detach /Users/rocalight/heyta-carriers/r108-head <HEAD>
cd /Users/rocalight/heyta-carriers/r108-head && pnpm install --frozen-lockfile
mkdir -p /Users/rocalight/heyta-r108-tmp/{desktop,mobile,ios-main}
HEYTA_REINSTALL_TMP_DIR=/Users/rocalight/heyta-r108-tmp/desktop bash scripts/reinstall-all.sh --only mac,windows
HEYTA_REINSTALL_TMP_DIR=/Users/rocalight/heyta-r108-tmp/mobile IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh --only android
HEYTA_REINSTALL_TMP_DIR=/Users/rocalight/heyta-r108-tmp/ios-main IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh --only ios   # iOS 走主检出，见上
```
