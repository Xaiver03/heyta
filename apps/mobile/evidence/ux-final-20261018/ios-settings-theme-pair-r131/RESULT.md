# r131 · iOS **设置面**装机态深浅控制配对（5 屏 × 两档 = 10 张，全部人眼看过）

> 一句话：**设置面这一族在装机态第一次有了"同一枚包、两档、逐屏配对"的读数** —— 两档旅程都 `passed`，
> 15 步 `targetFrame` 两档对齐（唯一差 1pt 的是滚动落点，不是主题），10 张图无白压白、无截断；
> 看图照出两枚**只登记不裁决**的外观观察（见第四节）。

## 一、出处

| 件 | 值 |
|---|---|
| 被测包 | 第八趟四端重装（r128）装进模拟器的那枚：载体 `/Users/rocalight/heyta-carriers/head-r128` @ `f8d7155e` |
| 设备 | `heyta-iphone-17pro` = `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，402×874 逻辑点 |
| 语态 | **中文**（应用内开关，19:32:13 换回；本趟没动系统语言 —— 那条路不通，环境陷阱 **#469**） |
| 装置 | `scripts/qa/profile-settings-ios.py`（现成旅程，未改一行）+ `--evidence-dir` 分档落点 |
| 外观 | 亮档 = 接手态直接跑；暗档 = `shutdown`+`boot` 之后 `simctl ui … dark` + `defaults write -g AppleInterfaceStyle Dark`（**这条"要重启"是 #471**） |
| 落点 | `light/`（19:49）与 `dark/`（19:50–19:51）两个子目录 —— **落点带状态档**，这是 #472 那枚事故的直接改法 |
| 第二把尺 | `scripts/screenshots/png-stats.mjs` 的 `modalLuminance`（现量命令见第六节），不只靠"看图觉得暗" |

## 二、读数：逐屏两档配对

| 屏（截图名） | 亮档 `modalLum` / `contentRatio` | 暗档 `modalLum` / `contentRatio` |
|---|---|---|
| `my`（我的） | 252 / 0.0785 | 28 / 0.9985 |
| `settings-directory`（设置目录） | 252 / 0.0124 | 12 / 0.9985 |
| `general`（常规） | 252 / 0.0533 | 28 / 0.9985 |
| `sync`（同步与隐私） | 252 / 0.0541 | 12 / 0.9984 |
| `growth`（我的成长） | 252 / 0.0672 | 12 / 0.9984 |

⚠️ `contentRatio` **不许跨档比大小**（它量偏离主色的像素比例，暗档整屏近黑 ⇒ 占比自然高）；
这一表里有信息量的是**两档各 5 屏都远高于 0.05 那条下界**、以及 `modalLum` 252↔12/28 的分明。

两趟旅程各 `{"status": "passed"}`（`light/settings-ia-journey.json`、`dark/settings-ia-journey.json`），
**15 步**都带 `targetFrame`。逐枚对齐：**14 枚完全相同**，唯一一枚差 1pt ——
`open lists` 的 `[32, 525, 338, 44]`（亮）↔ `[32, 524, 338, 44]`（暗）。
⇒ 本线把它读成**滚动停位的一格抖动**，不读成主题效应：同一屏其余 14 枚（含同一屏的其它步骤）都逐位相同。

## 三、这一格真正补上的那句

台账先前那句"iOS 装机态深浅已有控制配对"，射程只有**一屏**（联网同意面板，r128 那趟）+ 任务面批量条（r129/r130）。
本趟把它扩到**设置面这一族五屏**（我的 / 设置目录 / 常规 / 同步与隐私 / 我的成长），
并且这五屏是**同一枚旅程装置**取的 —— 下一位要再扩面，直接换 `--evidence-dir` 落点跑同一份脚本就行。

## 四、看图照出的两枚观察（**只登记，本线不裁决**）

1. **「我的成长」空态那张插画在暗档仍是"纸白"卡片**（两档同一张图：白纸日历 + 蓝点 + 叶子）。
   暗档下它是那一屏里最亮的块。是不是缺陷属界面那一线（有人就要一张 `values-night` 那一类的暗档变体，
   有人就说"纸"本来就该是纸）⇒ 本线只把两档同一张图这件事钉在这里，对比的两张是
   `light/growth.png` 与 `dark/growth.png`。
2. **「常规」里「如何添加」那四条列表的分隔线在暗档几乎看不见**（亮档清晰）。
   ⚠️ 这条**没有对比度数值** —— 本判据不看颜色对比度，只是看图照出来的形状。要判它得另开一把尺
   （取分隔线像素与卡片底色算比值），本线不替那一趟预填结论。

## 五、这一趟不证什么

1. **不证 windows / android 装机态两档** —— 与打包机同一前提（四枚 ssh 别名逐枚现量全不可达）。
2. **不证真机**、**不证其它机型/字号/语态**（这台 402 宽、默认字号、中文）。
3. **不证对比度达标**（WCAG 那把尺没上；第四节第 2 条只是看图形状）。
4. **不证"暗档下所有面都对"** —— 这五屏是这一族旅程走到的屏；提醒面 / AI 面 / 帮助面本趟没进这一档。
5. ⚠️ 两档截图里「隐私同意」都写 `决定于 2026-10-18 10:30 (UTC)`（= 本地 18:3x）
   ⇒ 这台验收机上那一枚设备级同意决定**是今天傍晚那趟之后重做过一次的**，不是接手时的原始态。
   本线不据此判任何行为，只登记这一台机的状态来历，免得下一位把它当"接手态"。

## 六、收尾与复跑

✅ 设备已还原发现态：`appearance light` + `defaults delete -g AppleInterfaceStyle`（`read` 回 `Could not find key`）
+ **再重启一次**（#471 那条对还原同样成立）→ 收尾截图 `modalLum` 回 **252**；语言「中文」；**没收任何 companion**。

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
E=apps/mobile/evidence/ux-final-20261018/ios-settings-theme-pair-r131
# 亮档（接手态即是）
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir "$E/light"
# 暗档：必须先重启模拟器，再设深
xcrun simctl shutdown $U && xcrun simctl boot $U && xcrun simctl bootstatus $U -b
xcrun simctl ui $U appearance dark && xcrun simctl spawn $U defaults write -g AppleInterfaceStyle -string Dark
xcrun simctl launch $U com.heyta; sleep 12
python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir "$E/dark"
# 两把尺：档的数 + 人看图
node --input-type=module -e "import {inspectPng} from './scripts/screenshots/png-stats.mjs';
  for(const d of ['light','dark']) for(const n of ['my','settings-directory','general','sync','growth'])
    console.log(d,n,inspectPng('$E/'+d+'/'+n+'.png').modalLuminance);"
```
