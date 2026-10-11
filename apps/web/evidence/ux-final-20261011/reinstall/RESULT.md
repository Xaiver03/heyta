# 四端重装 r93（2026-10-11 15:34–15:57）逐端读数

一趟 `pnpm reinstall:all`（清旧包 → 从当前源码重打 → 四端重装），产物与判据都在这一页，
每条读数的**出处**在下面，不复述日志。

## 口径：这一页证什么、不证什么

- ✅ 证：**当前工作树**打出的四端产物都装上了、都起得来、画的都是共享 UI（每端一条判据 + 一张人看过的图）。
- 🔴 **不证**"已提交的 `main` 装出来是这样"：载体是**主检出的工作树**，跑的时候 `HEAD=f7a0ea3f` 之上有
  10 枚未提交路径（含别线的 `packages/ai`、`server/src`、`packages/legal` 与 `BLOCKED.md`）。
  ⇒ 这批读数**不能**被读成"干净检出可复现"；那一格另说（见台账「从最终源码四端构建重装」）。
- 🔴 **不证**任何交互结论：本包只到"装上了当前产物且画面对"，各端交互矩阵的证据在各自的趟号里。
- ⚠️ macOS 那一段用 `HEYTA_SKIP_NOTARIZE=1`（去掉的是没有上界的公证等待，不是判据）。

## 载体与装置（每条都是当场现量，不抄上一批）

| 项 | 值 | 怎么重取 |
|---|---|---|
| 命令 | `HEYTA_REINSTALL_TMP_DIR=$HOME/heyta-carriers/tmp-ux-r93-10111534 IOS_DEVICE_NAME=heyta-iphone-17pro HEYTA_SKIP_NOTARIZE=1 pnpm reinstall:all` | — |
| 装置版本 | `scripts/reinstall-all.sh` @ `63f93a90`（带 `HEYTA_REINSTALL_TMP_DIR` 旋钮那一版） | `git log -1 --format=%h -- scripts/reinstall-all.sh` |
| 落点 | 私有目录（**不再住共享 `/tmp`** ⇒ 任务 #41 那枚"两趟互相覆盖现场"在本趟不成立） | `ls ~/heyta-carriers/` |
| 树 | `HEAD=f7a0ea3f951b64d8b307e119cc1d7857f74f73ed`，工作树未提交 10 枚 | `git rev-parse HEAD`；枚数用 `git status --porcelain` 的行数（别把带管道的写法抄进表里） |
| 页侧产物 | `apps/web/dist/index.html` sha256 前缀 `3c4764eaae2f7cbd` | `shasum -a 256 apps/web/dist/index.html` |
| 总退出码 | `REINSTALL_RC=0`（**从那一趟的日志里读的那一行**，不是包装命令的 `$?`） | `grep REINSTALL_RC reinstall-all-20261011-r93.txt` |

## 逐端判据

| 端 | "装的是当前产物"那一半 | "起得来且画的是共享 UI"那一半 | 图 |
|---|---|---|---|
| macOS | `安装对账：.app 里的 web-dist 与本机 apps/web/dist 是同一次构建（9 个 chunk）` | 窗口 2318x1508、WebView 那张内容占比 74.6%、主蓝命中 **997** | `mac/heyta-reinstall-mac-installed.png`（窗口）+ `.webview.png` + `.txt` |
| Windows | 远端新鲜度对账 `web-dist/index.html=3c4764eaae2f7cbd…`，且包内 `PAYLOAD_INDEX_SHA=3C4764EAAE2F7CBD…` **逐字等于本机那份** | 远端 `ADD_APPX=OK` + `M2D=OK` + `RESULT=OK`；装完窗口 1152x587、内容 57.4%、主蓝 **1178** | `windows/packaged-first-run.png` + `windows/install-capture.txt` |
| Android | 远端打包回传 `size=69,445,576 B / sha256=9aacfdcd41c8f04e…`，本地拉回后**与远端逐字相同**、mtime 回写为远端完成时刻 | `emulator-5554` 全新安装 `Success`；前台窗口确认 `mCurrentFocus=…com.heyta/com.heytamobile.MainActivity`；截图 1080x2400、内容 55.9%、主蓝 **4042** | `heyta-reinstall-android.png` |
| iOS | `已装的包比源码新 —— 这一轮装的是当前产物`（`simctl uninstall` → Release 重打 → 全新安装） | 截图 1206x2622、内容 58.8%、主蓝 **4091** | `heyta-reinstall-ios.png` |

四张图**都人打开看过**（§6.2 规定一）：同一张首启联网同意卡「在使用联网功能之前」，
两条要点（只用本机 / 同意并联网）、服务条款与隐私政策两条链接在位、主蓝实心按钮 ——
不是 §7 第 82 条那种"有标题有正文的错误屏"。Windows 那张里头像菜单是开着的（壳自己的 M2 探针留下的状态），
"登录账号"是菜单第一项。

## 🔴 本趟带出一条新读数：macOS 窗口那张**这次不是空窗**

- r77（10-10 19:16）：同一枚装置、同一台机器，**窗口**那张主蓝 **0**、`looksBlank=false`、`contentRatio=1`
  —— 人打开是一幅均匀暗底 + 三个红绿灯点（任务 #27 登记的那枚载体缺陷）。
- r93（本趟）：**窗口**那张主蓝 **994**、`hasAlpha=false`，人打开看到的是完整共享 UI（含同意卡与侧栏）。
- ⇒ 结论只能是：**#27 是间歇的，不是恒发的**。上一批把它裁成"抓窗口时 WKWebView 没被合成进去"这一支，
  本趟**没有推翻那一支**（它证的是"合成得上的时候抓得到"），但也**不能写成已修**：
  判据本身没动（`package-app.sh` 的窗口判据只数 WebView 那张，所以两种情况下它都绿）。
  取现量：`node --input-type=module -e "import {countBrandBlue} from './scripts/screenshots/png-stats.mjs'; console.log(countBrandBlue('apps/web/evidence/ux-final-20261011/reinstall/mac/heyta-reinstall-mac-installed.png'))"`

## 字节对账（私有落点 ↔ 本库）

四张 png 从落点当场拷进本目录后两侧 `shasum -a 256` 逐字相同：

```
8556cb2e…  mac/heyta-reinstall-mac-installed.png
86dcd67d…  mac/heyta-reinstall-mac-installed.png.webview.png
f8bdd4ce…  heyta-reinstall-android.png
847925c2…  heyta-reinstall-ios.png
```

`reinstall-all-20261011-r93.txt` 是那一趟的原样日志（含四段判据行与 `REINSTALL_RC=0`）。
