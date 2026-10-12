# 四端重装 r98（2026-10-12 18:17–18:36）逐端读数

一趟 `scripts/reinstall-all.sh`（清旧包 → 从源码重打 → 四端重装），**跑在只含已提交内容的隔离检出上**。
每条读数的出处都在这一页，不复述日志；原始文件同目录。

## 口径：这一页证什么、不证什么

- ✅ 证：**从 `HEAD` 那一份源码**打出的四端产物都装上了、都起得来、画的都是共享 UI（每端一条判据 + 一张人看过的图）。
  这一格补的是台账里那句「r93 跑在主检出的工作树上 ⇒ 它不证'干净检出可复现'」——**r98 证的是那一半**。
- ✅ 证：本轮那两笔产品代码**在装进设备的字节里**：载体 `a4430f58` 含 `54fb170a`（归档确认）与 `7958c18c`（回收站彻底删除那句后果），
  现量 `git merge-base --is-ancestor <两枚> a4430f58` 双双为真，且 `git show a4430f58:packages/ui/src/projects/OrganizerList.tsx | grep -c pendingArchive` = 6。
- 🔴 **不证**任何交互结论：本包只到"装上了当前产物且画面对"。三处新确认框（清单删除 / 回收站彻底删除 / 归档有子的文件夹）
  在真壳上"会先问"仍**没有读数** —— 那一格还欠着，见下面「本趟没做的事」。
- ⚠️ **iOS 那一端不是逐字 `HEAD`**：跑完之后隔离树里有**三枚被改动的跟踪文件**（现量 `git -C <载体> status --porcelain | grep -v '^?? '`），
  全部出自那一步 `pod install`：
  `apps/mobile/ios/Podfile.lock`（`hermes-engine` 校验和 `208b0dcd96fe…` → `c97c5f882ded…`）、
  `Heyta/Info.plist` 与 `HeytaWidgetExtension/Info.plist`（键按字母序重排、补 `<key>RCTNewArchEnabled</key><true/>`、
  并**丢掉两行 XML 注释**，其中一行是"不要把 `NSAllowsArbitraryLoads` 改成 true"那句提醒）。
  三处漂移全文 = `ios-build-drift.diff`（41 行 `+/-`）。
  ⇒ 准确说法是「`HEAD` 的源码 + CocoaPods 当场重新解析出的那一枚 hermes 二进制 + 它顺手规范化的两枚 plist」。
  这一格不是我把别的文件抄了进去：整棵载体是 `git worktree add --detach` 出来的，**跑前**未跟踪与已改动都是零，
  上面那三枚的 mtime 是 `18:29:12 / 18:29:12 / 18:29:13`，与那一步 `pod install` 结束同一秒（现量：
  `stat -f "%Sm %N" -t "%F %T" <三枚>`）。
- ⚠️ macOS 那一段仍带 `HEYTA_SKIP_NOTARIZE` 一类去等待的旋钮吗？**没有** —— 本趟没设任何跳过旋钮，
  读数来自 `reinstall-all-20261012-r98.txt` 原文。

## 载体与装置（每条当场现量）

| 项 | 值 | 怎么重取 |
|---|---|---|
| 命令 | `cd /tmp/heyta-ux-r98 && HEYTA_MACOS_DIST_DIR=/tmp/heyta-macos-dist-r98 IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh` | 整趟 stdout 已存 `reinstall-all-20261012-r98.txt`；载体指纹见 `carrier.txt` |
| 载体 | 隔离检出 `/tmp/heyta-ux-r98`，`HEAD=a4430f5844d71c0834a59f4750fced05c6877a2a`（`git worktree add --detach`，跑前工作树干净） | `cat carrier.txt` |
| 装置版本 | `scripts/reinstall-all.sh` @ `63f93a90`（2026-10-11 那版，带 `HEYTA_REINSTALL_TMP_DIR` 旋钮） | `git log -1 --format='%h %ad %s' --date=short -- scripts/reinstall-all.sh` |
| 页侧产物 | 隔离树 `apps/web/dist/index.html` sha256 前缀 `0df17c907fa67fc0` | `shasum -a 256 /tmp/heyta-ux-r98/apps/web/dist/index.html` |
| 总退出码 | `RC=0`（读的是 `echo "RC=$?"` 写进本目录那一份，不是包装命令的 `$?`） | `cat rc.txt` |
| 落点 | ⚠️ **各段日志/截图仍住共享 `/tmp`**（`HEYTA_MACOS_DIST_DIR` 只挪了包，没挪 `RT`）⇒ 见下面「本趟带出的读数」第 3 条 | `ls -l /tmp/heyta-reinstall-*` |
| 段日志副本 | 六份已按 `.txt` 存在本目录（`heyta-reinstall-{build,web,mac,win,apk,pod-1}.txt`）—— 🔴 **必须叫 `.txt`**：仓库 `.gitignore:49` 是 `*.log`，落成 `.log` 会被静默挡在仓库外，本目录里那些行就没人能复看（r93 那一趟也是这么摆的） | `git check-ignore -v <任一 .log 名>` |

## 逐端判据

| 端 | "装的是当前产物"那一半 | "起得来且画的是共享 UI"那一半 | 图 |
|---|---|---|---|
| macOS | `安装对账：.app 里的 web-dist 与本机 apps/web/dist 是同一次构建（9 个 chunk）`；包在 `/tmp/heyta-macos-dist-r98/`（`Heyta.app` + `Heyta-1.0.0.dmg` 3.9 MB），已装到 `/Applications/Heyta.app` | 窗口 2318x1508、WebView 那张内容占比 **74.6%**、主蓝命中 **997** | `mac/heyta-reinstall-mac-installed.png`（窗口）+ `.webview.png` + `.txt` |
| Windows | 远端新鲜度对账 `web-dist/index.html=0df17c907fa67fc0…`（逐字等于隔离树那份），包内 `PAYLOAD_INDEX_SHA=0DF17C907FA67FC0…` 与 `PAYLOAD_CHUNK_PRESENT=2 / TOTAL=2` | 远端 `ADD_APPX=OK` + `M2D=OK` + `RESULT=OK`；窗口 1152x587 | `windows/packaged-first-run.png` + `windows/install-capture.txt` |
| Android | `release APK 已重打（80M）` → `模拟器 emulator-5554 全新安装成功` | 前台窗口确认 `mCurrentFocus=Window{… com.heyta/com.heytamobile.MainActivity}`；截图 1080x2400、内容 **55.9%**、主蓝 **4042** | `heyta-reinstall-android.png` |
| iOS | `已装的包比源码新 —— 这一轮装的是当前产物`（模拟器 `FE195661…` = `heyta-iphone-17pro`，卸旧 → Release 重打 → 全新安装） | 截图 1206x2622、内容 **58.8%**、主蓝 **4091** | `heyta-reinstall-ios.png` |

四张图**都人打开看过**（§6.2 规定一）：四端都是同一张首启联网同意卡「在使用联网功能之前」，
两条要点（选「只用本机」功能照常 / 选「同意并联网」才跨设备同步）、服务条款与隐私政策两条链接在位、
主蓝实心按钮 + 一条文字按钮 —— 不是 §7 第 82 条那种"有标题有正文的错误屏"。
macOS 那张背后是完整共享版面（rail 六枚 + 四象限五档 + 清单/标签两节 + 右侧对话助手）；
Windows 那张里头像菜单是开着的（壳自己的 M2 探针留下的状态），"登录账号"是菜单第一项。

## 本趟带出的三条读数

1. 🔴 **干净检出可复现这一腿：四端全绿。** 从 `HEAD` 一份源码（无未跟踪文件、无别线在飞改动）出发，
   `pnpm -r build` → `@heyta/web build` → macOS 打包并装 → Windows 同步源码包（432M / 清单 7937 条）远端打包并装 →
   Android release APK 并装 → iOS Release 并装，**整条链 `RC=0`**。台账里那句"那一半仍开着"从本趟起可以按这一页收口。
2. ⚠️ **iOS 段的 `pod install` 会改动三枚被跟踪文件**（`Podfile.lock` + 两枚 `Info.plist`，逐条见上面那条口径）。
   这不是"载体脏了"，而是**在只含 `HEAD` 的树上跑 iOS 腿就必然带这一格漂移** —— 下一个要在干净检出上证 iOS 的人
   要先知道它，别把它读成"有人往载体里塞了未提交改动"；也别在跑完后顺手 `git add -A`（那会把 CocoaPods 的
   规范化与一行提醒注释的丢失一起提交掉）。
3. 🔴 **我自己的一个漏**：装置早就有 `HEYTA_REINSTALL_TMP_DIR` 旋钮（`63f93a90` 那版就是为它写的，任务 #41），
   本趟只设了 `HEYTA_MACOS_DIST_DIR`，各段日志与截图因此仍写到共享 `/tmp/heyta-reinstall-*`，
   把此前一趟（08:50 那批 `-ios-build.log` / `-ios.png`）的现场覆盖掉了。
   ⇒ 正确用法是**两个旋钮一起设**（r93 那一趟就是这么做的，见 `../../ux-final-20261011/reinstall/RESULT.md` 那张载体表）。
   这一条不是新缺陷登记，是**同一条已知缺陷在本趟被我重新踩了一次**；下一次跑法写在上面的命令行里之前，先补 `HEYTA_REINSTALL_TMP_DIR`。

## 本趟没做的事（别把这页读成"设备验收完了"）

- **三处确认框在真壳上没有任何读数**：清单删除要先问、回收站彻底删除要说那句不可逆的后果、归档有子的文件夹要先问 ——
  四端装好了不等于点过那三下。
- **Windows 那一份主检出的取证文件没刷新**：`windows/install-capture.txt` 在本目录里是**隔离树那份**（`0DF17C90…`），
  主检出 `dist/windows/install-capture.txt` 仍是 10-11 的 `3C4764EA…`。
  ⇒ 此刻在主检出跑 `pnpm check:shell-surfaces`，Windows 那格会拿"两个本地文件互相对得上"报绿，
  而打包机上真装着的已经是 `0DF17C90…`。这一格的机制与后果记在台账 18:3x 那一节（#35 那一格）。
