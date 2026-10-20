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

1. ~~不证英文档~~ ✅ **10-20 01:1x 已补，见下面第六节** —— 英文档那枚出口同样取到了装机态读数。
2. **不证 Android**：Android 那腿照旧欠着（`grep -rn "以后再说\|Decide later" scripts/qa/` 现量仍为空），
   而且 Android 出包仍堵在打包机不可达（10-20 01:0x 现量 `ssh -o ConnectTimeout=6 -o BatchMode=yes windows-pc true` ⇒ **rc=255 / Host is down**，
   `adb devices` 空）。⚠️ 本枚改的是 `apps/mobile/src` ⇒ **Android 产物会因此落后一枚**。
3. **不证暗档**：两台一次性载体都是默认浅档。
4. **不证"按 ✕ 之后一个请求都不发"**：本趟没有请求计数器（同 r150 第 4 节口径）。

## 六、英文档那一腿（同一枚件，01:1x 补跑）

载体 `heyta-r154-privacy-later-en`（同一枚 `main.jsbundle`，跑完 `shutdown` + `delete`，现量 `xcrun simctl list devices | grep -c heyta-r15` = **0**）。
语言走 `scripts/qa/ios-app-language.py --to en`（应用内开关，11 步全过，读数在 `en-lang/language-switch.json`）⇒ 判据仍是 AX 树里回读到的标签（陷阱 #488）。

| 读数 | 值 |
|---|---|
| 带着那句话的节点 | **1 枚**，label `Decide later`，frame `[271, 192, 95, 44]`，`pressable=true`、`enabled=true` |
| 装置自判 | `visible-text（触控区宽 95 pt > 图标方块 44 pt）`；`en/01-first-launch.png` 逐张看过 —— 那句话在标题同一行，没折行也没被截 |
| 按掉之后 | `sheetStillPresent=[]` ⇒ 卡收（行为与中文档同形） |
| 杀掉再开 | `sheetBack=['Agree and connect','This device only']` ⇒ 卡原样回来 |
| `device_pref` 三趟 | 三趟都只有 `welcome.hasSeen=1`，**`privacy.consent` 一枚都没有** ⇒ "以后再说"仍然什么都不决定 |

🔴 **两枚装置事实，下一位会撞上**：
① **`ios-app-language.py` 走的是「先离线使用」那一枚，而那一枚会记一次决定** ——
   第一次英文跑因此读回空卡（`verdict: close-button-not-found`），现量库里被写下
   `privacy.consent = {"decision":"local-only","decidedAt":"2026-10-19T17:12:45.633Z"}`（那次跑的记录还在 `en/probe.json` 的上一版里，本目录保留的是重跑后的）。
   ⇒ **顺序必须是**：先 `probe.py --dismiss-only`（按「以后再说」，不落盘）→ 再切语言 → 再重启读卡。
   ⚠️ 切语言那一步仍会经过欢迎页并点「先离线使用」，所以本趟在切完之后**只删掉那一行 `privacy.consent`**
   （`sqlite3 <那枚库> "delete from device_pref where key='privacy.consent'"`，设备此刻是 terminate 态）把机器放回"没决定"的状态再重启读卡。
   🔴 这是**装置手法不是产品行为**：它证的只有"英文档那张卡上那句话看得见、按下去不落盘"，
   不证"真机上用户会怎样走到这一步"。写在这是因为不写就会被下一位读成"英文档天然如此"。
② **中文档那次 `--dismiss-only` 的读数在 `zh-dismiss/`**（同一枚件、同一次开机，只为把卡收掉好走设置面）。

## 七、顺带量到的一条**新的候选缺陷**（未裁决）

欢迎页那枚 **「先离线使用」/ `Use offline for now` 按下去会记一次决定**：
库里落 `privacy.consent = {"decision":"local-only", …}`，从此首屏那张卡不再出现（只能去设置面「重新作出选择」才回得来）。
⇒ 措辞里的"先 / for now"读起来是"先看看、待会儿再说"，而它实际做的是**把"这台只用本机"记成已作过的选择**。
这**可能**正是产品想要的（本地优先不是降级，那条路本来就是完整产品），所以本线不判它错；
登记的是**形状 + 两条读数**，与 r153 那枚的区别写清：✕ 什么都不记（已证），这一枚记了但字面读起来像没记。
台账另立一格跟这条。

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
