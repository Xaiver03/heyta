# r130-en-dark · iOS 批量操作条：**英文×暗这一档取到了**，读数与英文×亮逐帧相同

> 一句话：**这一格的布局不参与外观档** —— 三枚按钮在暗档的 frame 与亮档逐枚一致（`Delete selected` 静止 `[376,186,171,44]`、屏内 26px=15%、滑后整枚进屏），所以第三节的按语态分档结论不必为暗档再开一格。
> 顺带把上一趟"设深无效"那件事量到了可复现的边界：**改外观要模拟器重启一次才会到达这枚包**（环境陷阱 **#471**）。

## 一、出处

| 件 | 值 |
|---|---|
| 被测包 | 第八趟四端重装（r128）装进模拟器的那枚：载体 `/Users/rocalight/heyta-carriers/head-r128` @ `f8d7155e` |
| 设备 | `heyta-iphone-17pro` = `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，`screen=[402, 874]` |
| 判据 | 与 r127/r129/r130-en 同一枚行为判据（在被裁那一行自己的 y 上左滑，再读同一批 frame），装置 `probe5-bulk-bar-scroll.py`（与 r130-en 目录那份逐字节同） |
| 语言 | 应用内开关 `ios-bulk-bar-r130-en/switch-lang-inapp.py --to English`（19:32:13 换回中文的那份 JSON 为反向证据） |
| 外观 | `simctl ui … appearance dark` + `defaults write -g AppleInterfaceStyle -string Dark` **之后 `shutdown`+`boot` 一次** |
| 时间戳 | `startedAt=1792323043.38` → `finishedAt=1792323098.31`（19:30:43–19:31:38） |
| 人眼层 | `01-before-swipe.png`／`02-after-swipe.png` 两张都打开看过：深蓝底、深色卡片、英文标签、右沿一条红边 ⇒ **确实是暗档**，不是上一趟那种"回读 dark、图上浅色" |
| 第二把尺 | 同仓现成装置 `scripts/screenshots/png-stats.mjs` 的 `modalLuminance`：本目录两枚 `01/02` 与四枚 `langswitch-*-DARK.png` **全为 28**，而 `ios-bulk-bar-r130-en/`（亮档）那六枚 **全为 252** ⇒ 深浅两档各有一个数，不用靠"看图觉得暗" |
| 语言开关的暗档凭据 | `langswitch-*-DARK.png` 六件（19:26 换 English、19:32 换回中文那两趟）—— 它们**本来落在了 `ios-bulk-bar-r130-en/` 里并把那里的浅色原件就地覆盖**，本趟搬进本目录并改名，浅色原件已从 HEAD 取回（见第五节） |

## 二、读数（`probe5-bulk-bar.json`）

| 按钮（en） | 静止 frame `[x,y,w,h]` | 屏内可见宽度 | 滑后 `x` | `dx` |
|---|---|---|---|---|
| Complete selected | `[24, 186, 195, 44]` | 195（100%） | -145 | **-169** |
| Move to list | `[227, 186, 140, 44]` | 140（100%） | 57 | **-170** |
| Delete selected | `[376, 186, 171, 44]` | **26（15%）** | 206 | **-170** |

`swipeY = 208`（行「Delete selected」；锚点「2 selected」在 145 —— 不同行，#465 那条要点）；
`clippedBefore=["Delete selected"]`、`clippedAfter=[]`；`uiLocale=en`；`verdict = 可滚`。

## 三、这一格新增的那句：外观档不参与这一格

把两档的 JSON 逐枚对齐（`before`/`after` 各三枚按钮共 12 个 frame）：**全部相同，一位不差**。
⇒ "第三枚按钮静止时只剩 15% 在屏内"这条观察**不随外观档变**，它是语态×宽度这一维的量。
所以台账里那一格维持**按语态分两格**（中文 92% / 英文 15%），**不因为补了暗档再拆成四格** ——
暗档在这里只提供一个"没参与"的否证，不提供新读数。

⚠️ 这一句的射程只有这一横条的**布局**。它不证"深浅两档在别的面也逐帧相同"（文字颜色、卡片底色、
对比度那些维度本判据不看）。

## 四、设深这条：上一趟的"成因未定"现在有了可复现的那一步

上一趟（`ios-bulk-bar-r130-en/RESULT.md` 第五节）两次独立设深都没让界面变暗，两种解释都没被排除。
本趟按那节留下的那把尺现量，判据是图：

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
xcrun simctl shutdown $U && xcrun simctl boot $U; sleep 3
xcrun simctl ui $U appearance dark
xcrun simctl spawn $U defaults write -g AppleInterfaceStyle -string Dark
xcrun simctl launch $U com.heyta; sleep 10
xcrun simctl io $U screenshot /Users/rocalight/heyta-reboot-dark.png   # ← 这张是深色的
```

⇒ **重启一次，外观变更就到达这枚包**（同一条 `simctl ui` 在不重启的会话里量不到）。
本线量到的是"怎么做能成"，**没有量到为什么**：trait 变更为什么没被运行中的这枚包接住，
仍属未证（所以 #471 那条只写成"改完要重启、判据是图"，不写成成因）。

## 五、🔴 一枚本趟自己造出来的证据事故：后一趟把前一档的图就地覆盖了

`switch-lang-inapp.py` 的落点是**固定文件名**（`after-choose-<to>.png` / `language-<to>.png` / `switch-<to>.json`，写在 `HERE` = 脚本所在目录）。
本趟为了切英文又跑了一次它 —— 于是**设备此刻是深色**，两张新图直接盖掉了 `ios-bulk-bar-r130-en/`（那目录声明的是"英文×**亮**"）里
19:03/19:08 那批浅色原件；19:32 换回中文那一趟又盖了一次。`git status` 上它们只是六枚 ` M`，**看不出状态档变了**。

处置（已做完，逐件有读数）：六件按 `langswitch-*-DARK.*` 搬进本目录留作暗档的语言开关凭据；
`git checkout HEAD -- <那六条路径>` 把浅色原件取回原目录，回来再量 ⇒ 四枚 PNG `modalLuminance` 回到 **252**、
两份 JSON 的 `at` 回到 **19:03:38 / 19:08:30**，`ios-bulk-bar-r130-en/` 除 `RESULT.md` 外逐枚 clean。
形状进环境陷阱 **#472**（"复用同一个证据目录 + 固定文件名 ⇒ 后一趟静默覆盖前一档的已提交证据，而 ` M` 不报警"）。

## 六、这一趟不证什么

1. **不证 Android 档**（与打包机同一前提：四枚 ssh 别名全不可达）。
2. **不证"外观变更没到达是产品缺陷"** —— 只证"重启后到达"。运行期不接 trait 变更这件事有两种没被排除的解释（模拟器侧没再下发 / 这枚包运行期钉住了 style），本线不挑一个写进结论。
3. **不证其它机型/字号/语言**（这台 402 宽、默认字号一档、英文）。
4. 同目录 `NOT-DARK-*` 三件是上一趟误标的浅色产物，**留档不作数**（改名保留是为了留住"回读 dark 而图是浅色"这个读数本身）。
5. 设备上多了 `BulkA/BulkB<三枚时间戳>` 若干行测试任务（与 r127/r129/r130-en 同形状的验收机残留族）。

## 七、收尾（发现态还原，逐件现量）

语言回「中文」（`switch-lang-inapp.py --to 中文` 的 `afterChoose` 逐枚中文标签为证）；
外观回浅色：`simctl ui … appearance light` + `defaults delete -g AppleInterfaceStyle` + **再重启一次**，
`simctl ui … appearance` 回 `light`，**判据是图** —— 收尾截图 `heyta-restored-light.png` 人眼核过：白底、中文、五枚 tab 正常。
`AppleInterfaceStyle` 键 `delete` 后 `defaults read` 回 `Could not find key`。
**没收任何 companion**（pid 31182 全程在册）。

## 八、复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
E=apps/mobile/evidence/ux-final-20261018
xcrun simctl shutdown $U && xcrun simctl boot $U && xcrun simctl bootstatus $U -b
xcrun simctl ui $U appearance dark && xcrun simctl spawn $U defaults write -g AppleInterfaceStyle -string Dark
xcrun simctl launch $U com.heyta; sleep 10
python3 $E/ios-bulk-bar-r130-en/switch-lang-inapp.py --udid $U --to English
python3 $E/ios-bulk-bar-r130-en-dark/probe5-bulk-bar-scroll.py --udid $U
# 两张图人眼看过底色，再按第七节还原
```
