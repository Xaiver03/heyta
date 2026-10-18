# 第八趟四端重装（r128）· 结果

> 一句话：**macOS 与 iOS 两端从"只含已提交内容的干净载体"重打并重装，各自有"装的是当前产物且起得来"的判据读数；windows 与 android 两腿没跑（打包机不可达），所以这一趟不叫"四端全过"。**

## 一、出处（四件，缺一件这页读数就不属于任何提交）

| 件 | 值 |
|---|---|
| 载体 | `/Users/rocalight/heyta-carriers/head-r128`（`git worktree`，detached，`dirty=0` 起跑与 install 后各量一次） |
| 钉的提交 | `f8d7155eb9e9bd8b62b5c087ac5edaa5f6858a96` |
| 命令 | `NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$HOME/heyta-r128-reinstall" IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh --only mac,ios`，mac 腿另用同一条 `--only mac` 重跑两趟 |
| 全仓构建 | `NO_COLOR=1 pnpm -r --no-bail build` ⇒ `BUILD_RC=0`，起数 20 / 失败 0 / Done 20（两把尺一起取，见 `provenance.txt` 第 2 条） |

## 二、逐端判据与读数

| 端 | 判据（脚本自己打的那句） | 读数 |
|---|---|---|
| macOS | 打包 + 卸旧装新 + **安装对账**（.app 里的 web-dist 与本机 `apps/web/dist` 同一次构建）+ 装机态自截屏"非空白 / 主蓝 ≥ 20 / 内容占比 ≥ 0.05" | ✅ 9 个 chunk 对账通过；`窗口 2318x1508、…webview.png 内容占比 100.0%、主蓝命中 997`；公证 `status: Accepted` + `staple and validate worked`；装机件 `CDHash=18bbf00e…`、`Timestamp=Oct 18, 2026 at 18:17:22`（接手时那枚是别线 11:23 装的 `11677d3e…`） |
| iOS | 卸旧 → Release 重打 → 装新 + **已装的包比源码新** + 装机态自截屏同一把尺 | ✅ `已安装的包比源码新`；`窗口 1206x2622、内容占比 58.8%、主蓝命中 4091`；pod 第 1 趟失败第 2 趟成功（非确定性记录一致），`pod install` 改了 `Podfile.lock` 2 行 ⇒ 这一腿带一枚已登记的偏离 |
| windows | — | 🔴 **没跑**：四枚 ssh 别名逐枚现量全不可达（`provenance.txt` 第 7 条） |
| android | — | 🔴 **没跑**：同一台打包机 |

## 三、深浅两档（本趟真正新增的那格）

| 档 | 图 | 内容占比 | 主蓝命中 | 人眼看过 |
|---|---|---|---|---|
| iOS 装机态 · 浅色 | `ios-installed-light.png` | 58.65% | 4091 | ✅ 联网同意面板：白卡、黑字、主蓝实心按钮、蓝色链接，无截断 |
| iOS 装机态 · 暗色 | `ios-installed-dark.png` | 99.84% | 4093 | ✅ 同一面板换暗卡 + 近黑底，文字/按钮/链接对比都在，无白压白 |
| macOS 装机态 · 暗色 | `heyta-reinstall-mac-installed.png.webview.png` | 100.0% | 997 | ✅ 三栏共享 UI + 同一张同意面板，暗档配色正常 |

🔴 **两条读法边界**：
1. `内容占比` 那枚数**不能跨档比大小** —— 这把尺量的是"偏离主色"的像素比例，暗档整屏近黑、卡片与背景互相偏离 ⇒ 占比自然高；两档都远高于 0.05 下界才是这格的信息量。
2. macOS 那张暗档**不是本线主动配的**：宿主开着"按时间自动切换外观"（现量 `defaults read -g AppleInterfaceStyleSwitchesAutomatically` ⇒ `1`），18:1x 系统自己切到 Dark。⇒ 结论只能是"这一趟落在暗档"，**不是**"同一趟内取了明暗配对"。浅色档的 macOS 装机态读数在 r110 那一趟。iOS 那两档是本线用 `xcrun simctl ui <UDID> appearance` 主动配的控制配对，取完已还原成接手时的浅色基线。

## 四、macOS 腿为什么红了两趟（这条比"重跑一次就绿"有用）

第 1 趟红在 `HeytaMacWidget.appex: A timestamp was expected but was not found.`；第 2 趟同一枚命令红在**另一枚对象** `Heyta-1.0.0.dmg: A timestamp …`（而 `.app` 那半已经绿到"打包后的 .app 能起来"）；第 3 趟全绿。
⇒ 判"瞬时"的证据不是 A/B（A/B 只证"当下能用"），是**失败对象在两趟之间移动而输入零变化**。形状已入环境陷阱。

## 五、这一趟不证什么

1. **不证四端**：windows/android 两腿没跑，脚本汇总段自己会写「不在 `--only` 范围 —— 这端没有验证当前产物」。
2. **不证干净复现的 iOS 腿**：`pod install` 改动的 2 行 `Podfile.lock` 不在载体那棵树的已提交内容里。
3. **不证产物字节**：判据是"装的是当前产物"（源码↔产物时间戳对账 + 装机对账 + 截图），不是"字节等于用 HEAD 重建的字节"。
4. **不证小组件卡片内容换了字**：这一趟没做桌面侧取证。
5. **不证 `origin/main` 之外的一件事**：⚠️ 这枚边界**已过期** —— 本线 10-18 现量 `git rev-list --count origin/main..HEAD` 与反向都是 0（本地与远端同步）。那两枚数是当下读数，会漂，以命令为准；旧台账里所有"不证 `origin/main`（本地未 push）"的限定语都要按这条重取。

## 六、复跑

```bash
# 载体与私有落点（落点必须先存在，否则脚本 RC=4）
git -C /Users/rocalight/heyta-carriers/head-r128 status --porcelain | wc -l   # 要 0
mkdir -p "$HOME/heyta-r128-reinstall"
cd /Users/rocalight/heyta-carriers/head-r128 && \
  NO_COLOR=1 HEYTA_REINSTALL_TMP_DIR="$HOME/heyta-r128-reinstall" \
  IOS_DEVICE_NAME=heyta-iphone-17pro bash scripts/reinstall-all.sh --only mac,ios
# iOS 装机态两档（取完记得还原）
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
for A in dark light; do xcrun simctl ui $U appearance $A; sleep 3; \
  xcrun simctl io $U screenshot /tmp/ios-$A.png; done; xcrun simctl ui $U appearance light
# 配对尺（零依赖，仓内自带）
node -e 'import("./scripts/screenshots/png-stats.mjs").then(m=>{const s=m.inspectPng(process.argv[1]);console.log(JSON.stringify({contentRatio:s.contentRatio,blue:m.countBrandBlue(process.argv[1])}))})' /tmp/ios-dark.png
```

## 七、包内名册

`provenance.txt`（出处 + 七条前置/偏离现量）、`heyta-reinstall-ios.png`（脚本自己那张浅色装机态）、`ios-installed-light.png` / `ios-installed-dark.png`（本线配的两档）、`heyta-reinstall-mac-installed.png`（窗口，本机常态：WebView 未合成进窗口 ⇒ 近黑空窗 + 三个红绿灯点，见台账两轴表）、`heyta-reinstall-mac-installed.png.webview.png`（内容载体，暗档真界面）。
