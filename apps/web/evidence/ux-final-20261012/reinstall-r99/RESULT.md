# 四端重装 r99（2026-10-13 00:22–00:44）逐端读数

一趟 `scripts/reinstall-all.sh`（清旧包 → 从源码重打 → 四端重装），**跑在只含 `HEAD` 的隔离检出上**。
四端全 ✅，本趟日志里 `❌` 计数 = 0（现量 `grep -c '❌' reinstall-all-r99.txt`）。

## 为什么要再跑一趟（不是"再跑一遍看着安心"）

r98 的载体是 `a4430f58`。现量：`git rev-list a4430f58..HEAD` 里**只有一个提交动过产品源码** ——
`1a386d76`（`packages/ai/src/capability-manifest.generated.ts`，AI 能力清单的生成物，它会进包）。
⇒ r98 那页逐端读数对这一枚生成物**不成立**。r99 把这一段补上。

另一个前提：**主检出此刻打不出 web 产物**（别线 staged 的在飞内容里有一段中文散文落在注释块外，
`pnpm --filter @heyta/web build` rc=1、`check:journey-coverage` rc=1，HEAD 那一版可解析）。
⇒ 第四趟**只能**跑在隔离载体上，这不是选择而是被挡出来的。红因与归属登记在台账 00:1x 那格。

## 载体与装置（每条当场现量）

| 项 | 值 | 怎么重取 |
|---|---|---|
| 命令 | `cd ../heyta-wt-r99 && HEYTA_MACOS_DIST_DIR=~/heyta-macos-dist-r99 HEYTA_REINSTALL_TMP_DIR=~/heyta-r99-tmp IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh` | 整趟 stdout = `reinstall-all-r99.txt` |
| 载体 | 隔离检出 `../heyta-wt-r99`，`HEAD=34f7742d4…`（`git worktree add --detach`，**跑前 0 枚脏**） | `cat carrier.txt` |
| ⚠️ 第一次尝试的形状 | 00:21 被装置自己的守卫挡下：`HEYTA_REINSTALL_TMP_DIR 不能含空格` → **RC=4**（本仓路径含 "All in one Data"）⇒ 落点必须放**无空格**路径（`~/…`），这正是 r98 "只设了一半旋钮"的真实原因 | 见 `carrier.txt` 起壳时刻那行 |
| 两个旋钮 | 这次**一起设**了（包 = `~/heyta-macos-dist-r99`，日志/截图 = `~/heyta-r99-tmp`）⇒ 没有覆盖任何共享 `/tmp` 现场，r98 那条教训闭合 | `ls ~/heyta-r99-tmp` |
| 判据形状 | 本趟用 `nohup` 起 ⇒ 包装层退出码没记录。读的是**日志内**四条端级 ✅ 与 `❌=0`，不是 RC | `tail -6 reinstall-all-r99.txt` |

## 逐端判据

| 端 | "装的是当前产物且起得来"的判据 | 读数 |
|---|---|---|
| macOS | 打包 + 装到 `/Applications/Heyta.app` + `.app` 内 web-dist 与本机 `apps/web/dist` 同一次构建 + 窗口/内容两张分读 | ✅ 9 个 chunk 对账通过；窗口 2318x1508；**webview 那张**内容占比 100.0%、主蓝命中 997 |
| Windows | 远端收到同一包（tar sha256 逐字相同）→ 远端新鲜度对账 → 打包 + 安装 + 启动截图 + 取证判据 | ✅ `tar sha256=27fe1ef24a5c6d74…`；`index.html=94aea57e706ec92e…`、`bridge=42f8e4cc3f13c6d3…`、`assets/*.js=7 枚一致`；`PAYLOAD_INDEX_SHA=94AEA57E…`（与对账值同一枚）；5 条取证判据齐 |
| Android | 清旧包 → release APK → 模拟器卸旧装新 → 前台确认 → 内容判据 | ✅ 全新安装成功；`mCurrentFocus=Window{… com.heyta/com.heytamobile.MainActivity}`；窗口 1080x2400、内容占比 56.1%、主蓝命中 4042 |
| iOS | 模拟器卸旧 → Release 重打 → 装新 → 新鲜度判据 → 内容判据 | ✅ 构建成功、全新安装、"已装的包比源码新"；窗口 1206x2622、内容占比 58.8%、主蓝命中 4091 |

⚠️ Android 那一趟出现一条**已被装置自己兜住**的形状：`monkey` 拉起之后前台不是 `com.heyta`，
装置改用 `am start -W` 显式拉起再验一次才拿到焦点读数 —— 只信 monkey 的那一版会把"没起来"读成"起来了"。

## 人看图（五张逐张打开看过）

`heyta-reinstall-mac-installed.png.webview.png`（暗档：四象限栏 + 收集箱 + 联网同意卡 + 清单/标签空态）、
`windows/packaged-first-run.png`（亮档：rail + 身份子菜单 登录账号/个人中心/应用设置 + 同意卡）、
`heyta-reinstall-android.png`、`heyta-reinstall-ios.png`（两档移动端的同意卡排版正常，无溢出）。

**macOS 的"整窗"那张仍是均匀暗底 + 三个红绿灯点**（本趟采样 9 种颜色，webview 那张 385 种；
r98 同位图 4 / 390 —— 两轮同形）。⇒ 这**不是**本轮回归，也不新开缺陷：台账 10-10 22:4x 那格已经把成因
裁到"抓窗口时 WKWebView 没被合成进去"（"首帧真没画"那一支被同实例两张图否证），判据也早已改成两张分读。
本趟的读数是它对第三、第四次的**复现确认**。

## 本趟带出的两条新读数

1. 🔴 **r98 那句"在只含 `HEAD` 的树上跑 iOS 腿，必然留下三枚被跟踪文件的漂移"被我自己的下一趟否证。**
   现量：r99 跑完之后 `git -C ../heyta-wt-r99 status --porcelain | grep -v '^?? '` 只有 **1 枚**
   （`apps/mobile/ios/Podfile.lock`，与 HEAD 差 2 行，装置自己也印了这条 ⚠️），
   而 r98 那三枚里的两枚 plist（r98 全文里是 `apps/mobile/ios/Heyta/Info.plist` 与
   `apps/mobile/ios/HeytaWidgetExtension/Info.plist`，路径按 `apps/web/evidence/ux-final-20261012/reinstall-r98/ios-build-drift.diff`
   的 `diff --git` 行现量取，不凭记忆）这次**一个字节都没动**：`git status --porcelain` 对这两枚返回空，
   且 `grep -c RCTNewArchEnabled` 在工作树与 `git show HEAD:<同一枚>` 里都是 0。
   ⇒ 准确说法是「**pod install 会不会重写那两枚 plist 不是确定的**，一次观测不能写成"必然"」；
   台账 r98 那格已就地改成两轮对照的现量写法。给后人的操作性结论不变：**别 `git add -A`，跑完先 `status` 再看**。
2. 📌 **`HEYTA_REINSTALL_TMP_DIR` 有"不能含空格"的硬守卫（RC=4）**，而本仓绝对路径天然含空格
   ⇒ 想按 r98 那条教训"把日志也隔离"，落点必须放在**无空格**路径下（`~/heyta-…` 就行）。
   这一条解释了 r98 当时"只设了一半旋钮"的真实原因：不是忘了，是含空格的路径根本进不去。

## 本趟没做的事

- 没有 push，没有动共享索引里别线的 staged 文件（本线提交走 plumbing + CAS，见环境陷阱 #415/#416）。
- 没有在真机上跑任何交互判据 —— 本趟证的是"装上了当前产物且画面对"，与 r98 同一射程。
- 隔离载体 `../heyta-wt-r99` 与 `~/heyta-r99-tmp`、`~/heyta-macos-dist-r99` 保留原样，供复看与复跑。
