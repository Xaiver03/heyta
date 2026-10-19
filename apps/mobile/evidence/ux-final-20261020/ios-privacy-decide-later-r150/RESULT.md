# r150 装机态 iOS：首屏隐私卡右上角那枚 ✕（「以后再说」/ `Decide later`）走的是哪条路

## 一、这一格量到什么

台账那一格（`docs/plans/product-ux-optimization.md` 里 r121 那档"顺带照出两条新的"第 ② 条）登记的是：
**这枚 ✕ 在两端任何脚本的候选里都没有** ⇒ "先不决定"这条路从来没有设备腿读数。
本趟把它跑通了，四件读数：

| # | 量什么 | 读数 |
|---|---|---|
| 1 | 那枚 ✕ 在场吗、叫什么 | 在。AX 名 **「以后再说」**（这台模拟器界面是中文），frame `[322, 232, 44, 44]`，`pressable=true`、`enabled=true`。词条 `common.privacy.consent.close`（zh「以后再说」/ en `Decide later`） |
| 2 | 点掉之后屏幕上剩什么 | 卡消失（`sheetStillPresent=[]`、`closeStillPresent=[]`），落到**欢迎页**：「开始安排今天」+「注册 / 登录」+「先离线使用」+ 那行「不登录也能建任务、打卡、专注…」⇒ **不是一堵墙，也不是空白**，离线那条路当场可走 |
| 3 | 杀掉再开，卡回不回 | **回**（`sheetBack=['同意并联网','只用本机']`，`03-after-relaunch.png` 与 `01-first-launch.png` 字节数同为 551100）⇒ "没做决定"没有被偷偷记成任何一种决定 |
| 4 | 这三趟之间 `device_pref` 里有没有被写行 | **三趟都是 0 行**（`rows=[]`，库现读 `…/Library/heyta-device-prefs.sqlite`）⇒ 按 ✕ 不写同意、也不写"不同意" |

合起来是一句正面结论：**「以后再说」= 真的什么都没决定，下次开机再问一次**，而不是"沉默地选了某一支"。

## 二、被测件与载体身份（现量，别抄这里）

```
载体   heyta-r150-privacy-later —— **本线自建的一次性模拟器**（iPhone 17 Pro / iOS 27.0），
       跑完 `shutdown` + `delete`，现量 `xcrun simctl list devices | grep -c heyta-r150` = **0**。
       🔴 共享那台 `heyta-iphone-17pro` 全程没被碰 —— 全新安装态只能在自建载体上造，
       在共享载体上 `uninstall` 造这个态会毁掉别线的装机现场。
被测件 apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
       main.jsbundle sha256 前 16 = 3a5e127a22ddbc75 —— 与 r149 那趟装进共享载体的**同一枚**件（含本轮闸门改动）
装置   probe.py（本目录，逐条读数写进 probe.json）
语态   中文（判据是 AX 树里回读到的标签，不是系统域 —— 陷阱 #488）
```

## 三、顺带照出一条候选界面缺陷（未裁决）

那枚 ✕ **屏幕上只有一个叉，没有任何可见文字**（`01-first-launch.png` 逐张看过），
而它的可及名称是「以后再说」/ `Decide later`。
⇒ 看得见的人要点它之前只能猜它是"关掉这张卡"还是"退出应用"；看不见的人反而拿到的是"以后再说"这句准确的话。
两枚真正的决定（同意并联网 / 只用本机）都有可见文字，只有第三条没有。
**本线不替别人裁决这算不算要改**：它是措辞/外观取向题，改法（给 ✕ 配一行可见小字，或把 ✕ 换成文字按钮）
要设计口径先定。登记形状与两条读数（frame、AX 名）都在本页第一节。

## 四、这一格不证的四件事

1. **不证英文档**：这台自建载体第一次起来界面就是中文，本趟没有切语言（切语言要 `ios-app-language.py` 那一趟，
   而它读的是应用内开关，本探针没接）。词条 `Decide later` 那一档照旧没有设备腿读数。
2. **不证"按 ✕ 之后一个请求都不发"**。这一维本趟没有计数器（本机没有起隔离服务端，也就没有可数的请求）。
   最接近的现成读数在 Android 侧：未同意时**一个请求都不发、不动本机数据**（`../../ux-final-20261017/android-widget-erase-r117/RESULT.md` 第 4 节）。
3. **不证 Android 上同一枚 ✕ 的形状**（`grep -rn "以后再说\|Decide later" scripts/qa/` 现量仍为空 ⇒ Android 那腿照旧欠着）。
4. **不证暗档**：这台一次性载体是默认浅档。

## 五、下一位怎么重跑

```bash
U=$(xcrun simctl create heyta-r150-privacy-later com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro \
      com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl boot $U
xcrun simctl install $U apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
python3 probe.py --udid $U --out .
xcrun simctl shutdown $U && xcrun simctl delete $U      # 一次性载体用完就删，别留
```

⚠️ 一枚装置事实（本趟第一版撞上的）：**iOS 的 `device_pref` 库住在 `…/Library/heyta-device-prefs.sqlite`，
不是 Android 那个 `…/databases/`**。只按 Android 形状找会回 `db=not-found`，
而 `not-found` **不等于**"没有那一行" —— 那一版差点把"读不到"写成"没写"。`probe.py` 现在两种形状都找。
