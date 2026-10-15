# r110 · 第六趟四端重装（本线第一次带着"会进包的产品改动"跑）

**结论：`REINSTALL_RC=0`，四端各自有"装的是当前产物且起得来"的判据，四张界面图人都打开看过。**

## 出处（跑之前钉死的三件）

| 件 | 值 | 现量命令 |
|---|---|---|
| 载体 | 隔离 worktree `../heyta-wt-r110`（**不是**主检出） | `cat provenance.txt` |
| 那一棵树的提交 | `fd5c2fb17ed001d7ec23f1feeeed1fcdf0874050` | `head -5 provenance.txt` |
| 起跑时脏不脏 | `dirty=0`（含 `node_modules` 由本趟 `pnpm install --frozen-lockfile` 现装，`INSTALL_RC=0`） | `install.txt` |
| 起跑时机器负载 | `load1=42.18`（别的会话 + 模拟器；这一趟**没有**为了让谁过去而调任何阈值） | `provenance.txt` |

跑完之后主检出又前进过几笔（别的线的台账提交）。**这一趟的产物钉在 `fd5c2fb1`**，
它与收尾时 `main` 的差集是 3 个文件（`BLOCKED.md`、`PROGRESS.md`、`docs/plans/inbound-automation.md`），
现量：`git diff --name-only fd5c2fb1..HEAD`。
**这 3 个都不是任何一端的构建输入**（同一把尺的形状照 `scripts/lib/sync-windows-sources.sh` 那条注释：
`grep -rIn --include=… 'BLOCKED|PROGRESS|inbound-automation'` 在 `apps/ packages/ server/` 的构建配置里
只命中 `apps/desktop/vite.config.ts` 的**一句注释**，不是 import）。
⇒ "四端仍等于当前产物"这句在收尾这一刻成立，**但它是这一格的读数，不是常驻状态**。

## 逐端判据（每条都能红；红过的那几趟记在台账里）

| 端 | "装的是当前产物" | "起得来 / 画的是共享 UI" |
|---|---|---|
| mac | `.app` 内 `web-dist` 与本机 `apps/web/dist` **同一次构建**（9 个 chunk 逐字对账）；`.dmg` 公证 `Accepted` + 票据装订 | 窗口 2318x1508；**内容判据数的是壳自己 `takeSnapshot` 那张**：内容 74.6%、色阶 229、主蓝 997 |
| windows | 远端 tar sha256 逐字相同 + 新鲜度对账（`web-dist/index.html` / `bridge` / 7 枚 assets 一致）；`install-capture.txt` 五条判据全在位（`ADD_APPX`/`RESULT=OK`/`SHORTCUT_RESOLVES`/`WINDOW_TITLE=heyta`/`PNG_SAVED`） | 1152x587、内容 55.8%、色阶 245 |
| android | release APK 重打 80M（`heyta-reinstall-apk.log.txt`）→ `emulator-5554` 全新安装 | 前台由 `am start -W` 确认（`mCurrentFocus=…com.heyta/…MainActivity`）；1080x2400、内容 55.9%、主蓝 4042 |
| ios | `✅ 已装的包比源码新 —— 这一轮装的是当前产物` | 1206x2622、内容 58.8%、色阶 255、主蓝 4091 |

⚠️ **android 那一格撞上了本线昨夜刚立的那条形状**：日志里
`⚠️ monkey 之后前台不是 com.heyta，用 am start -W 显式拉起再验一次`
—— 即"`monkey` 拉起 ≠ 在前台"。`reinstall-all.sh` 自带这条兜底并把它打成取证；
**同族还有 15 份腿脚本自己 `monkey … ; sleep 6` 而完全不看前台**（现量
`grep -rln 'shell monkey -p' scripts/verify-mobile-*.sh scripts/reinstall-all.sh | grep -v '\.snap\.'`），
登记在计划文末那一格，本趟没代改（运行时形状不等，不满足"代改别线要三条齐"）。

⚠️ **ios 那一腿有一处偏离，不藏**：`pod install` 把 `apps/mobile/ios/Podfile.lock` 改了一行
（`hermes-engine` 的提交哈希），逐字见 `podfile-lock-delta.txt`；跑完之后那棵载体树的
`git status --porcelain` 就是这一枚文件（`carrier-state.txt`）。⇒ 这一腿装出来的东西
**不完全等于 `fd5c2fb1` 那一份 lock**，它是"CocoaPods 按当前 `Podfile` 解析出来的那一版"。

## 人看图（四张，逐张说过看到什么）

| 图 | 看到什么 |
|---|---|
| `heyta-reinstall-mac-installed.png.webview.png` | **浅色**外观的收集箱首屏：左 rail 九个入口、四象限五个带色点、清单/标签两张空态（"点右侧 + 新建清单"）、右栏「对话助手」+ 三条快捷卡、页头「今天 / 最近 7 天 / 已完成」；正中盖着联网同意卡「在使用联网功能之前」，主蓝「同意并联网」+ 次级「只用本机」 |
| `heyta-reinstall-mac-installed.png`（窗口那张） | 均匀暗底 + 三个红绿灯点，**里面没有应用** —— 这一张不参与判定（判据数的是上面那张快照）。同一实例同一瞬间两张分读，是"窗口截图不能当 UI 证据"这条的第三次现量 |
| `heyta-reinstall-android.png` | 全新安装后的首屏同意卡（浅色）：标题带盾牌图标、两段要点、"服务条款 / 隐私政策"两个链接、底部两枚按钮完整可见，无遮挡无截断 |
| `heyta-reinstall-ios.png` | 同一张同意卡在 iPhone 上（浅色），行距与两端一致；顶部状态栏 13:45 |
| `packaged-first-run.png`（windows） | 收集箱三栏 + **头像菜单是开着的**（取证探针点开的：登录账号 / 个人中心 / 应用设置）+ 同意卡。⚠️ 这一张里右栏标题「对话助手」的末字贴着窗口右边缘，看着像被截 —— **本趟不裁决**，要判它得在同一宽度（1152×587）上量一次那栏的 `scrollWidth/clientWidth`，登记成待查 |

## 这一趟**不证**的事（写给下一个读这页的人）

1. **不证 `origin/main`** —— 全程只本地提交，没 push。
2. **不证深浅两档都装过** —— 壳跟随宿主系统外观，这一趟四端跑出来**都是浅色**；暗色那档仍只有浏览器与设备腿的读数。
3. **不证小组件卡片在桌面里换了字** —— 那是原生桌面小组件，重装只保证壳与包，不碰宿主桌面。
4. **不证 Android 那三条腿（calendar / repeat / restore）在新代码下能跑绿** —— 它们只把代码收拢到同一实现，设备读数仍是旧的。
5. **ios 那一腿不是"只含已提交内容的隔离检出"那一档**（上面那枚 `Podfile.lock` 偏离）。
6. **不证干净检出可复现这一趟** —— 载体是 `dirty=0` 起步，但 `pod install` 在中途把它写脏了；那一档另有 r102–r105 的读数，不在本页。

## 复跑（一条命令，落点写死）

```sh
RT=~/heyta-r111-reinstall && mkdir -p "$RT" && \
NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$RT" IOS_DEVICE_NAME=heyta-iphone-17pro \
  bash scripts/reinstall-all.sh > "$RT/reinstall.txt" 2>&1
```

⚠️ `HEYTA_REINSTALL_TMP_DIR` **必须先 `mkdir`**（不给目录它会 `RC=4`），且路径**不许含空格**。
载体那一棵是本次用完的 `../heyta-wt-r110`（`git worktree list` 现量），要新开一棵照台账那几格的步骤。

**那棵载体现在的状态**（写给要收磁盘的人）：`du -sh` 现量 **2.3G**，`git status --porcelain` 只剩
`apps/mobile/ios/Podfile.lock` 那一行 ` M`（`pod install` 造的，见 `carrier-state.txt`），
`dist/windows/` 里还留着本次取回的 `heyta.msix`（≈99 MB）与首跑图。
本机数据卷 `df -h /System/Volumes/Data` 现量 78Gi 可用 ⇒ **本线不删它**（留着复跑与查物）；
要收磁盘的人：`git worktree remove --force "../heyta-wt-r110"` 一条即可，删了不影响本页任何读数。

## 包内名册（每一枚都在这一页里点名，别留"页在、件不在库"的那一格）

> ⚠️ 为什么这些日志叫 `*.log.txt` 而不是 `*.log`：仓库根 `.gitignore` 里 `*.log` 是**测试与构建产物**那一档，
> 落点就在包里的裸 `.log` 会被 ignore 规则吞掉（第一版实测：`git add` 直接报
> "The following paths are ignored by one of your .gitignore files"）。
> 后缀改成 `.log.txt` 是**尊重那条既有约定**，不是绕过它 —— 内容仍是各段的原始日志。

| 文件 | 是什么 |
|---|---|
| `RESULT.md` | 本页 |
| `SHA256.txt` | 包内每枚产物的 `shasum -a 256`（图与日志一起，用于"图与读数同批"那一档对账） |
| `provenance.txt` | 起跑前钉死的载体路径 / `HEAD` / `dirty` / `load1` |
| `run-r110.sh` 的 stdout | 在 `run-r110.log.txt`（两步：`install` 与 `reinstall-all` 的 RC） |
| `install.txt` | `pnpm install --frozen-lockfile` 的输出（`INSTALL_RC=0`） |
| `reinstall.txt` | 四端逐步骤的判据原文（含 `REINSTALL_RC=0` 那行） |
| `heyta-reinstall-build.log.txt` | 前置 `pnpm -r build`（全仓） |
| `heyta-reinstall-web.log.txt` | 前置 `@heyta/web` build（保证 `web-dist` 晚于 workspace dist） |
| `heyta-reinstall-mac.log.txt` | mac 段：打包 → 自截屏 → 公证 → 装订票据 |
| `heyta-reinstall-mac-installed.png` | mac **窗口**那张自截屏（本机常态：没有 WebView 内容，**不参与判定**） |
| `heyta-reinstall-mac-installed.png.webview.png` | mac **壳自己 `takeSnapshot`** 那张 —— 内容判据的载体 |
| `heyta-reinstall-mac-installed.png.txt` | 那张图自己的取证说明（`WINDOW_SIZE` / `WINDOW_TITLE` / `CAPTURE_METHOD=screencapturekit`） |
| `heyta-reinstall-win.log.txt` | windows 段：源码包 sha 对账 → 远端新鲜度 → 装 → 取回产物 |
| `install-capture.txt` | windows 远端那五条判据的原文（`ADD_APPX` / `RESULT=OK` / `SHORTCUT_RESOLVES` / `WINDOW_TITLE` / `PNG_SAVED`） |
| `packaged-first-run.png` | windows 装完之后首跑的窗口图（1152×587） |
| `heyta-reinstall-apk.log.txt` | android 段：远端 gradle release 全日志（含 APK 哈希那一段） |
| `heyta-reinstall-android.png` | android 全新安装后的首屏图 |
| `heyta-reinstall-pod-1.log.txt` | ios 段 `pod install` 的输出（那枚 `Podfile.lock` 偏离的出处） |
| `podfile-lock-delta.txt` | `Podfile.lock` 被改的那一行的 `git diff` 原文 |
| `carrier-state.txt` | 跑完之后那棵载体树的 `HEAD` 与 `git status --porcelain` |
| `heyta-reinstall-ios-build.log` 的尾巴 | 收在 `heyta-reinstall-ios-build.tail.txt`（整份 17 MB，不入库；判据行已在 `reinstall.txt`） |
| `heyta-reinstall-ios.png` | ios 装完之后首屏图 |

