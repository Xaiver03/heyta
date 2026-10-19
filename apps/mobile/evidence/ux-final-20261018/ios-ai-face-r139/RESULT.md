# r139 · iOS AI 面 + 帮助面装机态读数（当前源码产物）

这一格不是修 bug 的复验（r138 没动 AI 面），它答的是另一句：**换了当前源码那枚新包之后，
AI 面与帮助面这条只读旅程还走不走得通，深浅两档还各自在不在。**
旧件上的对应读数在 `../ios-ai-face-r137/RESULT.md`（含那趟量到的可及名称缺陷）。

## 1. 出处

| 项 | 值 |
|---|---|
| 被测物 | 隔离载体 `/Users/rocalight/heyta-carriers/head-r128` @ `997a1935…`（= r138 那笔，当前 main `fec02f23` 的祖先），第九趟四端重装 iOS 腿，**全新安装** |
| 装进设备的包 | mtime `2026-10-19 11:24:10`（旧件 10-18 18:11:07） |
| 装置 | `scripts/qa/ai-face-ios.py`（r138 补了 `startedAt`/`finishedAt` 之后的版本） |
| 设备 | 模拟器 `heyta-iphone-17pro` / `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，截图 1206×2622 |
| 四格 | `current-source/`（中文×浅）· `dark/`（中文×暗）· `english/`（英文×浅）· `english-dark/`（英文×暗）⇒ **深浅×中英四格齐** |

## 2. 读数

| 格 | 步数 | 结果 | `startedAt`→`finishedAt` | 语言由什么立住（AX 树回读） |
|---|---|---|---|---|
| `current-source/` | 20 | passed | 1792380835.98 → 1792380911.61 | 「打开搜索 / 同步 / 任务 / 10月19日 星期一」、「今天想先完成什么？」= true 而英文那枚 false |
| `dark/` | 20 | passed | 1792381028.66 → 1792381070.17 | 同上（中文） |
| `english/` | 20 | passed | 1792380683.43 → 1792380728.11 | "Open search" / "What would you like to finish today?" = true 而中文各枚 false |
| `english-dark/` | 20 | passed | 1792382892.69 → 1792382928.24 | 同英文（AX 树回 "Open search / Sync / Tasks / Mon, 10/19"，中文各枚 false） |

四格都走完「我的 → AI 助手 → 助手内跳 AI 设置（关闭）→ 设置目录 → 常规组 → 帮助与反馈 → AI 与集成组 → 回」这条只读链，
`startedAt`/`finishedAt` 四格都在（r138 那处装置时间字段修复第一次被这枚脚本跑到）。

## 3. 深浅两档各自立的尺

`current-source/`、`english/` 与 `english-dark/` 三格的末级目录名不是 `light`/`dark`，`require_appearance` 在那三格**不咬**，
所以档由像素那把独立尺立：

| 格 | 五张图的 `modalLuminance` |
|---|---|
| `current-source/` | 252 / 252 / 252 / 252 / 252 |
| `english/` | 252 / 252 / 252 / 252 / 252 |
| `dark/` | 28 / 28 / **12**（`assistant.png`）/ 28 / 28 |
| `english-dark/` | 28 / 28 / **12**（`assistant.png`）/ 28 / 28 |

`dark/` 那格目录名是 `dark`，`require_appearance` 有牙（不符就拒写），加上五张全在深色区间 ⇒ 两把尺同向。
设深走 #471 那条（`shutdown`→`boot` 之后才 `simctl ui … appearance dark`），收尾已还原 `light`。

## 4. 🔴 这一格添的一条否证：`english/` 那趟一开始被标成了"中文档"

本趟第一趟 AI 跑落在 `current-source/`，跑完读 AX 树才发现**界面全英文** —— 而我起手拿
`xcrun simctl spawn $U defaults read -g AppleLanguages` 量到的是 `zh-Hans-CN`，据此判"这台在中文档"。
两件事都是真的，但**系统域那把尺量的不是这枚包的界面语言**：#469 早就写明
`resolveNativeLocale()` 第一优先级是应用内开关持久化的 `HeytaWidget.preferredLocale`，
上一趟 `ios-app-language.py --to en` 留下的状态是持久的，全新安装才把它清掉（所以 11:24 那趟账号面是中文）。

处置：把那趟落点**改名** `current-source/` → `english/`（它本来就是英文×浅的有效读数，不作废），
再跑 `ios-app-language.py --to zh`（8 步 `rc=0`，`language after (zh)` 回读通过）之后重跑，才拿到 `current-source/` 这一格。
⇒ **判语言档只许看 AX 树里的标签，不许看系统域**；`--evidence-dir` 末级名不做语言维的校验，
它只对 `light`/`dark` 两个名字有牙。这条进环境陷阱 **#488**（就是 #469 那条的续文）。

## 5. 人看图（20 张里看 4 张，其余按像素）

| 图 | 看到什么 |
|---|---|
| `current-source/assistant.png` | 浅底 AI 助手：段头「AI 助手」+「配置 AI」、三枚 tab（历史/只读/执行，执行高亮）、四枚快捷 chip、底部输入框与「AI 可能出错，请核对重要信息。」 |
| `dark/assistant.png` | 同一屏真深蓝底，文字层级清楚，「执行」tab 蓝色高亮；这张 `modalLuminance=12` 是三档里最深的一屏（纯底占比最高） |
| `english-dark/help-feedback.png` | 深蓝底 + 英文：How to add 四步、**Language 那一栏（English 高亮）**、Help and feedback「Complaints and reports」 |
| `english/help-feedback.png` | 常规组内 General 面板：小组件安装步骤、**Language 那一栏（「中文 / English」两枚 chip，English 高亮）**、Help and feedback +「Complaints and reports」 |

其余 16 张（各格的 `profile.png` / `ai-settings-via-assistant.png` / `ai-settings-group.png` / `help-feedback.png` 等）
本趟只做了像素尺与 AX 回读，**没有逐张人眼看**；同一批界面在 r133/r137 已逐张看过，本趟的增量主张只是"新包上仍走得通、档没串"。

## 6. 不证

1. **`english-dark/` 那一格只有像素与 AX 两把尺，没有 `require_appearance` 的牙**（末级名不是 `dark`）；
   四格本身在当前源码件上都跑过了，旧件上的对应档在 r137。
2. 帮助面「投诉与反馈」那一行**只到界面在场**，没有真的唤起邮件客户端（那是写操作，属另一条判据）。
3. AI 设置面里那几枚开关（启用 AI 功能 / 允许远程端点 / 让 AI 记住我的偏好）**全程没被点过** —— 这枚脚本是只读旅程。
4. r133 那枚候选缺陷（暗档下次要文字对比度）本趟没有重新量化，状态不变、仍挂界面那一线。
5. 只 iOS 模拟器。同一枚载体随后补跑了 mac 腿（绿，读数在计划台账 r139 续那一格）；
   windows / android 两端仍堵在 `windows-pc` 不可达，真机未验。

## 7. 复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
D=apps/mobile/evidence/ux-final-20261018/ios-ai-face-r139
mkdir -p $D/current-source && python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $D/current-source
# 英文档：切应用内开关（不是系统域！），跑完必须切回
python3 scripts/qa/ios-app-language.py --udid $U --to en && mkdir -p $D/english && python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $D/english
python3 scripts/qa/ios-app-language.py --udid $U --to zh
# 暗档：#471 的顺序
xcrun simctl shutdown $U && xcrun simctl boot $U && sleep 6 && xcrun simctl ui $U appearance dark
mkdir -p $D/dark && python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $D/dark
# 英文×暗：语言留在 en、档留在 dark 时直接跑
mkdir -p $D/english-dark && python3 scripts/qa/ai-face-ios.py --udid $U --evidence-dir $D/english-dark
xcrun simctl ui $U appearance light
```

设备收工状态：`appearance = light`、应用内语言 = 中文、**没收任何 companion**。
