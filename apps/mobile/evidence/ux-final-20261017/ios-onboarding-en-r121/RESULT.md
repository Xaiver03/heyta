# r121：iOS 英文首屏下，那两枚分支条件到底走不走 —— 两臂都取到读数

台账那格（`docs/plans/product-ux-optimization.md:2281`）登记的是本线自己脚本里的一处**假通过形状**：
首屏那两下的分支条件当年只写中文，英文设备上"没命中"会被记成 `passed`。
10-10 那两笔追认把**分支条件**补成了中英同义（`ee630a20`），并写下闭合步骤②③，
但都标着"要设备腿放开才能做"。这一趟做的就是那两步。

- 载体：**本线新建的模拟器** `heyta-r121-ios-en`（`iPhone 17 Pro` / iOS 27.0，
  udid `2E39F4CE-6141-4053-AD75-E721F7BF78C1`）。不动共享那台 `heyta-multiend-reinstall`
  （它装着 r118 那趟的现场，克隆它要先把人家关机 ⇒ 直接新建一枚，装的是同一包）。
- 被测包：从 `heyta-multiend-reinstall` 的**已装 bundle 原路径**装过来
  （`…/Bundle/Application/C064A4E3-…/Heyta.app`，`CFBundleShortVersionString=1.0 CFBundleVersion=2`，50 M），
  也就是 r118 第七趟四端重装产出的那枚 iOS 产物，**不重新构建**。
- 语言：`AppleLanguages = (en, zh-Hans-CN)`，全局域与应用域各写一遍。
- 装置版本：`HEAD=7822c9a7` 上的 `scripts/qa/profile-settings-ios.py`（`git status --porcelain` 现量干净）。
- 🔴 **全新安装态**：两臂跑之前都 `simctl uninstall` + `install` 一次，
  否则容器里留着上一次的同意决定，首屏那一支根本不会出现（第一臂就是无意中先跑了一次才拿到欢迎屏）。

## 1. 正对照臂（当前脚本，未改）

`00-first-run.png` 是人眼确认过的首屏：英文隐私同意卡，标题
「Before any network feature runs」，两枚出口「Agree and connect」与「This device only」。

脚本跑完退在：

```
timed out waiting for ('先离线使用',); pressable=False;
visible labels=['heyta', 'Plan your day', …, 'Use offline for now', …]
```

读数判进：**分支条件确实生效了** —— 它命中了英文的「This device only」、真的点下去、
并且走到了英文欢迎页（`Use offline for now` 在场）。
它随后红，是因为 `tap("choose local-only privacy", T(中,英), ("先离线使用",))` 的**第三个实参**
（点完之后要读到什么的那一枚）仍是**单语中文**。
⇒ 台账 ② 那句"预期从 `passed` 变成'点了那两下并读到随后的首屏'"**前半句成立、后半句不成立**，
而不成立的原因不是产品，是本线脚本自己那枚单语断言位。

## 2. 变异臂（摘掉分支条件里的英文）

`mutated-drop-english.py` 是本线名下的副本（住在证据目录里，只改 3 处 `present(...)` 条件，
`wait_for_any_label` 的英文**保留** —— 否则拿不到 AX 树，红的是"超时"而不是这一格）。
同一枚设备、同一包、同样先重置成全新安装态，跑出来的是：

```json
{"name": "onboarding already complete", "status": "home-labels-absent",
 "labels": ["heyta", "Before any network feature runs", "Decide later", …,
            "Agree and connect", "This device only"]}
```
并抛 `JourneyError`（`mutation/settings-ia-journey.json`）。

⇒ **台账 ③ 闭合**：摘掉英文之后，那一格不再记 `passed`，而是记 `home-labels-absent` 并响亮失败 ——
这正是 10-10 02:0x 那笔追认改过的预期形状（原文那句"退回 `branch=no-match` 记 `passed`"已作废）。
`01-mutation-first-run.png` 逐张看过：屏幕上明明有一枚可点的「This device only」，
探针却因为条件被摘成中文而看不见它 —— **这条判据抓的是语言，不是运气**，两臂合起来才算证完。

## 3. 顺手照出来的一类事（不是推测，是同一形状的全部实例）

同一枚脚本里**断言位仍单语中文**的一共三处（现量取法：
`grep -nE '^\s*(probe\.tap\(.*)?\("[^"]*"\),?\s*$|absent=\("[^"]*",\)\)' scripts/qa/profile-settings-ios.py`
或直接看 `254` / `320` / `350` 这三行的实参）：

| 处 | 实参 | 后果 |
|---|---|---|
| `:254` | `("先离线使用",)` | 英文设备上整条旅程走不完（本趟实测） |
| `:320` | `("隐私同意",)` | 英文下点进「同步与隐私」之后同样会超时（**未跑**，走不到） |
| `:350` | `absent=("整理与记录",)` | 英文下这枚"不该在场"的判据恒真（读不到中文 ⇒ 永远"不在场"） |

⚠️ **和姊妹脚本不同形**：Android 那支的同一位置是双语的 ——
`tap(T('只用本机','This device only'), T('先离线使用','Use offline for now'), …)`
（现量 `grep -n "consent-sheet-not-on-first-screen" -B1 scripts/qa/profile-settings-android.py`）。
⇒ 同一件事（首屏那两下）在两端脚本里一个能走完、一个走不完，差别只在断言位写没写英文。

**本线不改这三处**：10-10 04:1x 那笔追认写明"断言位照旧单语中文，因为那是防'语言不对冒充 IA 通过'的判据"，
那是判据口径，归行主定。本线交过去的是一句可以两边都成立的话：
**要么把断言位也做成"按 `uiLocale` 选语态"（Android 的形状），要么接受 iOS 这条旅程只在中文下可跑** ——
但现在的形状是"分支条件双语、断言位单语"，它既不满足前者，也没在台账里写明后者。

## 4. 人看图（两张，逐张看过）

| 图 | 看到什么 |
|---|---|
| `00-first-run.png` | 英文隐私同意卡：标题、两条要点、`Terms of Service` / `Privacy Policy` 两枚链接、蓝底主按钮「Agree and connect」与右侧文字按钮「This device only」。排版无截断、无中英混排 |
| `01-mutation-first-run.png` | 同一张卡在变异臂跑之前（全新安装态）。⚠️ 卡右上角那枚 ✕ 在 AX 树里的名字是 `Decide later` —— 它**不在**脚本任何一枚候选里，所以"稍后再说"这条路两端脚本都没验过 |

## 5. 这一趟不证什么

1. 不证 iOS 英文下整条 Profile/Settings 旅程可跑 —— 它走不完，原因见第 1 节与第 3 节。
2. 不证英文欢迎页之后任何一屏的 IA（`:320` / `:350` 那两处按当前脚本在英文下**够不到**）。
3. 不证中文设备上的行为 —— 中文那一支的形状是 10-10 之前那几趟读的，本趟没重跑中文。
4. 不证「Decide later」那一枚出口（见第 4 节 ⚠️）。
5. 不证 iOS 组件、通知、实体 iPhone —— 与这格无关。
6. 包身份只到"与共享那台模拟器上装的是同一枚 bundle"（按 bundle 路径 + 版本号读），
   **没有**逐字节对过 r118 那趟的 sha256（本趟不重新构建，也不改包）。

## 6. 复跑

```bash
U=$(xcrun simctl create heyta-r121-ios-en "iPhone 17 Pro" "iOS 27.0" com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl boot "$U"; xcrun simctl bootstatus "$U" -b
xcrun simctl spawn "$U" defaults write NSGlobalDomain AppleLanguages -array en zh-Hans-CN
xcrun simctl spawn "$U" defaults write com.heyta AppleLanguages -array en
xcrun simctl install "$U" "<Heyta.app 的路径>"      # 本趟用的是共享载体里那枚 bundle
EV=apps/mobile/evidence/ux-final-20261017/ios-onboarding-en-r121
# 每一臂之前都要重置成全新安装态，否则首屏那一支根本不出现
xcrun simctl uninstall "$U" com.heyta && xcrun simctl install "$U" "<Heyta.app>" && xcrun simctl launch "$U" com.heyta
python3 scripts/qa/profile-settings-ios.py --udid "$U" --evidence-dir "$EV"            # 正对照
python3 "$EV/mutated-drop-english.py" --udid "$U" --evidence-dir "$EV/mutation"        # 变异臂
```

收尾：本线自建的这台模拟器跑完 `xcrun simctl shutdown` + `delete`，
本线起的 `idb_companion` 按 pid 收掉；共享那台 `heyta-multiend-reinstall` 全程没被碰（现量见 `closeout.txt`）。
