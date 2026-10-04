# macOS 壳的截图证据

> 采集时间见各文件自述的 `*.txt`（每份图都配一份"它是怎么来的"）。

| 文件 | 它是什么 |
|---|---|
| `window-first-run.png` / `.txt` | 壳窗口的截图 + 取图自述 |
| `settings-sheet-in-shell.png` / `.txt` | 设置面板在壳里的截图 |
| `window-gate-accepted-2026-09-30.png` / `.txt` | 🔴 **门禁"通过"那一次它接受并据以判"画出来了"的图** —— 见下 |
| `consent-gate-first-screen-2026-10-02.png` / `.webview.png` / `.txt` | **安装包冷启动的第一屏**：共享 UI 已渲染（侧栏/收集箱/清单/标签都在），但**列表区被隐私联网同意浮层挡着**。是台账 G4(a) 那一轮的现场（`docs/plans/ui-review-fill-zh-timeline.md` §4.5），窗口 1082x716、主蓝命中 1298 |
| `reinstall-20261002-1852-mac-installed.{png,webview.png,txt}` | 🔴 **从"只有已提交内容"的隔离检出跑 `reinstall-all.sh --only mac` 之后，安装副本的自截屏**（暗色系统外观 + 首次运行同意浮层；窗口 1082x716、内容 100.0%、主蓝命中 **1306**）。同一轮装的产物里 `minWidth:"30%"` 命中 —— 台账 G5 段"mac 端已跑通"那一块的证据 |
| `package-20261004-1511-mac-app.{png,webview.png,txt}` | 🔴 **同一趟里两张图分工不同，别只留一张**：`.png`（13 KB）是**空的窗口图**（只有三颗交通灯），`.webview.png`（155 KB）才是内容判据的载体（主蓝命中 **1269**，人已打开看过：收集箱 + 首启「在使用联网功能之前」同意卡 + 主蓝实心钮）。来自 `HEYTA_SKIP_NOTARIZE=1` 那一趟打包（载体 `117386a1`，`RC_MAC_PACKAGE=0`，包内 `index.html` sha 与本机 dist 逐字相同）⇒ **它证"包里有这一屏"，不证"屏幕上那个窗口有内容"，也不证"已公证"**。逐条边界写在配好的 `.txt` 里；台账在 `docs/plans/countdown-anniversary.md` §8.4 ㊒ |
| `installed-20261004-1845-mac-app.png` + `installed-20261004-1845-mac-app.webview.png` + `installed-20261004-1845-mac-app.txt` | ✅ **Goal ⑤-4 的 macOS 那一格**：`RC_MAC=0`（18:45:48，链 MAC，`HEYTA_SKIP_NOTARIZE=1 bash scripts/reinstall-all.sh --only mac`）。装进 `/Applications/Heyta.app` 的那一枚自截屏：窗口 1092x723、内容占比 100.0%、**主蓝命中 1266**（🔴 全部来自**暗色板** —— 这台机器是暗色外观，单拿 `HEYTA_BLUE` 复现会得到 0，判据用的是两档相加的 `countBrandBlue`）。同一趟安装对账：包内 `index.html` sha 与本机 `apps/web/dist` 逐字相同（`517c6ba76d00fb25`）、assets **9 chunk**。人已打开看过：暗色下的收集箱 + 首启同意卡 + 主蓝实心钮。它**顺带把 ③ 那格升级**：裸跑 `check-shell-surfaces.mjs` 现在打「5 绿 / 0 红；未取证 **0 栏**」（18:48 现量）。边界写在配好的 `.txt` 里；台账在 `docs/plans/countdown-anniversary.md` §8.4 ㊦ |
| `storage-host/` | B/C 那条线的证据（另有自己的 README） |

## 🔴 `window-first-run.png` 是**过期的**，别拿它当"窗口画出来了"的证据

它是**dist 坏掉那段时期**抓的：画面是壳的**回退屏**（「找不到共享 UI 产物」）。
`PNG_BYTES=71057`、内容比例 9.3% 那一版。

为什么它会一直留着：**门禁并不写这个路径** ——
`check-macos-window.mjs` 把图写到 `tmpdir()/heyta-macos-window-gate-<pid>.png`，
而 `window-first-run.png` 只在**手工**跑 `scripts/capture-window.sh` 时产生。
⇒ 门禁绿了、这张图却可以是旧的。

**它该由一次可靠的抓图取代**，而"可靠"目前还没做到 —— 见下一条。

## ✅ 门禁的"画出来了"现在挡得住"截到一张没有应用的窗口"（2026-09-30 修）

**先说清问题**（`window-gate-accepted-2026-09-30.*` 是它当时的现场）：
门禁曾 **exit 0**、四条断言全过（非空 / 不透明 / `CAPTURE_METHOD=screencapturekit` /
交叉验证尺寸一致），**而它接受的那张图**（人已看过）是**暗窗口 + 底部一行诊断文字**，
里面**没有应用界面**。成因：那一刻 **WebView 的内容没有被合成进窗口**
（AppKit 部分画出来了、WebContent 的没有）—— 而这在**窗口不前台**时是这台机器上的**常态**。

### 修法：换一份**可靠**的产物来判"应用画出来了"

自截屏时**另写一份 `WKWebView.takeSnapshot`**（`<png>.webview.png`）——
它直接问 WebKit 要渲染结果，**不走窗口服务器、不需要录屏权限**，所以稳定。
两份产物各证一件事，谁也不替谁背书：

| 产物 | 它证明 |
|---|---|
| 窗口截图 `OUT` | 一个真的 macOS 窗口：标题 / 尺寸 / 非空 / 取图方式 / 尺寸交叉验证 |
| **WebView 快照 `OUT.webview.png`** | 🔴 **壳里那份共享 UI 真的渲染出来了** |

### 判据：`contentOnModalRatio ≥ 0.02`（比值、与主题无关）

为什么**不是主蓝**：壳跟随系统外观，**暗色主题下主蓝几乎不出现** ——
同一张真应用快照只有 **46** 个主蓝像素，拿它判会把**真应用**判死。
为什么是它：三张已知图分得很开（同一天实测）：

| 图 | contentOnModalRatio |
|---|---|
| **真应用（暗）** | **0.057** |
| 暗窗口·无应用（没合成） | 0.006 |
| 过期的「找不到共享 UI 产物」回退屏 | 0.004 |

⚠️ `edgePairs` **不能**用：三张图都是 ~20034（归一的固定分母），完全不分。

### 红/绿一对（注入验证）

| 输入 | 快照 contentOnModalRatio | 门禁 |
|---|---|---|
| 真应用 | **0.057** | ✅ 通过 |
| **注入：把首屏换成一张空白页**（WebView 仍在、内容为空） | **0.000** | 🔴 红 |

完整输出见 `webview-snapshot-2026-09-30.txt`；真应用那张快照是
`webview-snapshot-real-app-2026-09-30.png`（人已看过：暗色主题的完整界面）。

### 仍需注意

- **窗口截图仍然可能是"没有应用"的那张**（暗窗口）。这是**预期**的：
  它现在只负责"窗口存在"那一组断言，"应用画出来了"由快照负责。
- `window-first-run.png` 仍是**过期的回退屏**（见上），
  **应用渲染的证据请看 `webview-snapshot-real-app-2026-09-30.png`**。
- ✅ `ScreenCaptureKit` 偶发 `-3811 无法开始流播放` —— **已修**（2026-09-30）：
  取证脚本对这条瞬时错误**重试一次**；仍失败则以 **exit 4** 自述"取图基础设施不可用"，
  门禁据此**响亮跳过**（"这一条没有被验过"），不再误判成产品故障。
  三条分支都注入验证过（注入 `-3811` ⇒ exit 4；换进门禁 ⇒ 跳过；真脚本 ⇒ 绿）。
