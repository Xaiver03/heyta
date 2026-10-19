# r153 装机态 iOS：首屏隐私卡那枚「以后再说」现在**屏幕上有没有那句话**

r150 在这枚控件上量到的形状是：可及名称一直是「以后再说」/ `Decide later`，屏幕上却只有一枚 ✕
（`closeNode` frame `[322, 232, 44, 44]` —— 一枚图标按钮的方块）。
本趟是改掉之后的复验，跑在**自建的一次性模拟器**上（全新安装态才有那张卡）。

## 一、这一格量到什么

| # | 量什么 | 改前（r150） | 改后（本趟） |
|---|---|---|---|
| 1 | 卡上带着那几个字的节点 | 1 枚，frame `[322, 232, 44, 44]`，`pressable=true` | 1 枚，frame **`[294, 232, 72, 44]`**，`pressable=true` |
| 2 | 那句话看得见吗 | 屏幕上只有一个叉 | **`以后再说` 四个字在卡右上角**（`01-first-launch.png` 逐张看过），与标题同一基线、muted 色，标题没被挤下行 |
| 3 | 点掉之后 | 卡消失、落到欢迎页 | 同：`sheetStillPresent=[]`（`02-after-tap-close.png`）⇒ **行为没被这次改动碰坏** |
| 4 | 杀掉再开 | 卡回来 | 同：`sheetBack=['同意并联网','只用本机']`（`03-after-relaunch.png`） |
| 5 | 三趟之间 `device_pref` 被写了几行 | 0 / 0 / 0 | **0 / 0 / 0** ⇒ "没做决定"仍然没有被偷偷记成任何一种决定 |

装置自己的判据是第 1 件那个数：`visibleLabel = visible-text（触控区宽 72 pt > 图标方块 44 pt）`。
🔴 它**不按 role 过滤**（`scripts/tools/ios-ax-shim.py:163` 那条：AX 的 role 不稳定，按它过滤的症状是"找不到按钮"），
量的是"带着那句话的节点有几枚、各自 frame 多宽"—— 改回 icon-only 时那枚会退回 44 宽，装置判 `icon-only`。

## 二、被测件与载体身份（现量，别抄这里）

```
载体   heyta-r153-privacy-label —— 本线自建的一次性模拟器（iPhone 17 Pro / iOS 27.0），
       跑完 `shutdown` + `delete`，现量 `xcrun simctl list devices | grep -c heyta-r153` = **0**。
被测件 apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
       main.jsbundle sha256 前 16 = ca3a09257bdfba19（10-20 01:02 从当前工作树重打，含本枚改动）
       同一枚件已 `simctl install`（升级、不清数据）进共享那台 `heyta-iphone-17pro` ⇒ 共享载体没落后
装置   probe.py（本目录，逐条读数写进 probe.json）
语态   中文（判据是 AX 树里回读到的标签，不是系统域 —— 陷阱 #488）
```

## 三、改的是什么（两壳同源那一族，不是只改 iOS）

同一枚"稍后再说"在**两处**都是 icon-only，所以两处一起改：

* `apps/mobile/src/screens/PrivacyConsentSheet.tsx`：`IconButton icon="action.close"` ⇒ 一枚 `Pressable`
  里摆 `<Text variant="caption" tone="muted">`，文字与可及名称走**同一个 key**（`common.privacy.consent.close`），
  **没有新增词条**。触控区 `minHeight = touch-target.min`（44），按下反馈 `color.hover`，全部走 token。
* `apps/web/src/features/privacy/PrivacyConsentSheet.tsx`：`<button>` 里的 `<X>` 换成同一句可见文字，
  `aria-label` 与 `data-testid` 原样留着（既有 5 处脚本/用例按 testid 定位，不扩射程）。

永久判据两条，各带变异臂（臂 = 把源码文件换成改前那一笔 `git show bd10a50c:<那个文件>`）：

| 判据 | 改前件 | 改后 |
|---|---|---|
| `apps/mobile/tests/privacy-consent-gate.spec.ts` ›「以后再说」这条出口屏幕上写的就是它那三个字 | **× 红**（1 failed / 37 passed） | 38 passed |
| `apps/web/tests/privacy-consent-sheet.spec.tsx` › 点「以后再说」关掉：…那句话在屏幕上看得见 | **× 红**（1 failed / 17 passed） | 18 passed |

web 那条的形状是 `textContent === aria-label` —— 不写死中文串，所以换语种、换措辞都不会误红，
而"只剩一枚图标"必然红（那时无文字节点，`textContent` 是空串）。

## 四、这一格不证的四件事

1. **不证英文档**（`Decide later` 那一格）：这台一次性载体第一次起来界面就是中文，本趟没切语言。
2. **不证 Android**：Android 那腿照旧欠着（`grep -rn "以后再说\|Decide later" scripts/qa/` 现量仍为空），
   而且 Android 出包仍堵在打包机不可达（10-20 01:0x 现量 `ssh -o ConnectTimeout=6 -o BatchMode=yes windows-pc true` ⇒ **rc=255 / Host is down**，
   `adb devices` 空）。⚠️ 本枚改的是 `apps/mobile/src` ⇒ **Android 产物会因此落后一枚**。
3. **不证暗档**：这台一次性载体是默认浅档。
4. **不证"按 ✕ 之后一个请求都不发"**：本趟没有请求计数器（同 r150 第 4 节口径）。

## 五、下一位怎么重跑

```bash
U=$(xcrun simctl create heyta-r153-privacy-label com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro \
      com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl boot $U
pnpm build:ios && xcrun simctl install $U apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
python3 probe.py --udid $U --out .
xcrun simctl shutdown $U && xcrun simctl delete $U      # 一次性载体用完就删，别留
```

取"改前红"：把 `apps/mobile/src/screens/PrivacyConsentSheet.tsx` 换成 `git show HEAD~1:` 那一份（✕ 版）重打重装，
本目录 `probe.py` 会判 `icon-only`；node 腿见第三节那张表。
