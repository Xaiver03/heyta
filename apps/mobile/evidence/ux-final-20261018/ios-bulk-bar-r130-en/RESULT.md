# r130 · iOS 批量操作条：英文档（亮档）+ 应用内语言开关这条正路；**暗档在下一趟取到了**（见 `ios-bulk-bar-r130-en-dark/`）

> 一句话：**英文档的结论仍是「可滚」，但英文下第三枚按钮只剩 15% 在屏内（中文下是 92%）—— 这条残留观察在英文档不该沿用"降级成美观问题"那句口径。**
> 本节原来写的"暗档这一趟没取到，成因未定"已被 19:31 那一趟作废：那一档取到了，而且读数与本档逐帧相同；
> 本趟失败的原因量到了可复现的那一步 —— **改外观要模拟器重启一次才到达这枚包**（细则在 `ios-bulk-bar-r130-en-dark/RESULT.md` 第四节与环境陷阱 **#471**）。

## 一、出处

| 件 | 值 |
|---|---|
| 被测包 | 第八趟四端重装（r128）装进模拟器的那枚：载体 `/Users/rocalight/heyta-carriers/head-r128` @ `f8d7155e` |
| 设备 | `heyta-iphone-17pro` = `FE195661-B021-4A71-AAD1-1F2F7AE3A102`，402×874 逻辑点 |
| 判据 | 与 r127/r129 同一枚行为判据（在被裁那一行自己的 y 上左滑，再读同一批 frame） |
| 语言切换 | `switch-lang-inapp.py` —— 走**应用内**开关（我的 → 设置 → 常规 里内联的「中文 / English」两行），不走系统 defaults |
| 有效落点 | `ios-bulk-bar-r130-en/`（英文×**亮**，两张图都人眼看过） |
| 不作数的落点 | `ios-bulk-bar-r130-en-dark/NOT-DARK-*`（见第五节） |

## 二、英文×亮读数（`ios-bulk-bar-r130-en/probe5-bulk-bar.json`）

| 按钮（en） | 静止 frame `[x,y,w,h]` | 屏内可见宽度 | 滑后 `x` | `dx` |
|---|---|---|---|---|
| Complete selected | `[24, 186, 195, 44]` | 195（100%） | -145 | **-169** |
| Move to list | `[227, 186, 140, 44]` | 140（100%） | 57 | **-170** |
| Delete selected | `[376, 186, 171, 44]` | **26（15%）** | 206 | **-170** |

`swipeY = 208`（行「Delete selected」；锚点「2 selected」在 145 —— 不同行，#465 那条要点）；
`clippedBefore=["Delete selected"]`、`clippedAfter=[]`；`uiLocale=en`；`verdict = 可滚`。
两张图都打开看过：滑前那枚红色按钮在右边缘**只剩一条红边**（看图会被读成"一条红线"而不是按钮）；
滑后它整枚进屏，`Complete selected` 反过来只剩一个 `d` 出左沿。

## 三、这一格真正新增的那句：中文档的"降级成美观问题"**不该搬到英文档**

r127/r129 登记残留观察时沿用了窄屏设置导航那一格的口径（"主症状已消、可见的还能滚提示没做 ⇒ 美观问题"）。
**同一把尺量英文档，被裁的程度不是一个量级**：

| 档 | 第三枚按钮静止时屏内可见宽度 | 占自身宽度 |
|---|---|---|
| 中文（r127 亮 / r129 暗） | `402-293 = 109px` | **92%** |
| 英文（r130 亮） | `402-376 = 26px` | **15%** |

⇒ 中文那档"按钮基本看得见、只是右边切一点"；英文这档**静止态看上去是一条红边，不是一个按钮**，
而这一横条 `showsHorizontalScrollIndicator={false}` 没有任何"还能滚"提示。
所以本线把它写成**按语态分开的两格**，不替界面那一线把英文档也判成"美观问题"。
**改不改、怎么改（缩略文案 / 换图标按钮 / 露出滚动指示）属界面那一线的设计取向**，本线只把量级钉在这里。

## 四、应用内语言开关这条正路（顺带把 #469 那条死路关掉）

`switch-lang-inapp.py` 的读数证明：**点「English」后界面立刻全英文，不需要重启**；换回「中文」同样立刻生效
（两份 JSON 的 `afterChoose` 字段逐枚标签为证）。而改系统语言三条通道都不动它 —— 成因与现量在环境陷阱 **#469**。
两处装置事实写在该脚本注释里：底部 tab 过不了 `scripts/tools/ios-ax-shim.py` 那条 `vis_limit = h - 120` 的可见守卫
（按设计如此），所以那一枚按节点自己的 frame 中心直接 `idb ui tap`。
⚠️ **本目录那六件开关产物（`after-choose-*` / `language-*` / `switch-*.json`）钉的是 19:03:38 与 19:08:30 那两趟**：
19:26/19:32 又跑过同一份脚本，而那两趟设备是深色，固定文件名 ⇒ **就地覆盖过本目录的浅色原件**，
已由下一趟搬去 `ios-bulk-bar-r130-en-dark/langswitch-*-DARK.*` 并从 HEAD 取回本档原件
（复量 `png-stats.mjs` 的 `modalLuminance` 回 **252** 为证）。形状进环境陷阱 **#472**。

## 五、英文×暗：本趟**没取到**（两趟独立设深都失败）—— 19:31 由 `ios-bulk-bar-r130-en-dark/` 补上，成因量到的是"要重启"

| 设法 | 命令 | 装置自报 | 截图实际 |
|---|---|---|---|
| ① | `xcrun simctl ui <U> appearance dark` | 回读 `dark` | **浅色**（19:07 那张） |
| ② | `xcrun simctl spawn <U> defaults write -g AppleInterfaceStyle -string Dark` + 已验证的冷启动（`terminate_rc=0`、`launchctl list \| grep -c heyta` 回 `0`、新 pid） | `defaults read -g AppleInterfaceStyle` ⇒ `Dark` | **浅色**（19:14 那张） |

而**同一台机、同一枚包，18:30 那一趟（r129）用①同样的设法量到的是真深色**（那张图本趟重新打开确认过：深蓝底、深色卡片）。
⇒ 这不是"设深方法一直无效"，是**它在 18:30 之后不再有效**，而本线没有量出为什么。
`apps/mobile/src/App.tsx:293` 那句"没有任何主题偏好/持久化，`useColorScheme()` 是唯一来源"与这个读数放一起，
有两种都没被排除的解释（模拟器侧的 trait 没再下发 / 这枚包在运行期把 style 钉住了）—— **本线不挑一个写进结论**。

已做的处置：那三件产物改名 `NOT-DARK-*` 留档不作数；设备已还原（`AppleInterfaceStyle` 键 `delete` 后
`defaults read` 回 `Could not find key`、`simctl ui … appearance` 回 `light`、语言回「中文」、**没收任何 companion**）。
本节写完后同一趟留下的那把现量尺，19:31 那一趟照它跑了一遍并把它往前推了一步 —— **重启模拟器再设深，界面真的变暗了**，
英文×暗那一档已取到（`ios-bulk-bar-r130-en-dark/RESULT.md`）。所以"18:30 之后不再有效"这句现在有了可复现的下一步：
**改外观之后必须 `shutdown`+`boot` 一次**；至于运行中为什么不接 trait 变更，仍未证，别当已证用。

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
xcrun simctl ui $U appearance dark; xcrun simctl terminate $U com.heyta; xcrun simctl launch $U com.heyta; sleep 8
xcrun simctl io $U screenshot /tmp/ap.png
# 判据是图，不是命令回读：看 /tmp/ap.png 的底色（或人眼打开一次）
```

## 六、这一趟不证什么

1. **本趟不证英文×暗**（那一档由 `ios-bulk-bar-r130-en-dark/` 取到，不在本目录的读数里）；**不证 Android 档**（与打包机同一前提）。
2. **不证"英文档这样是对的"** —— 只证"可滚"与"静止态可见 15%"这两个读数。
3. **不证真机**、**不证其它机型/字号**（这台 402 宽、默认字号一档）。
4. 设备上多了 `BulkA/BulkB<三枚时间戳>` 若干行测试任务（与 r127/r129 同形状的验收机残留族）。

## 七、复跑（英文×亮那一档）

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
E=apps/mobile/evidence/ux-final-20261018/ios-bulk-bar-r130-en
python3 $E/switch-lang-inapp.py --udid $U --to English
python3 $E/probe5-bulk-bar-scroll.py --udid $U
python3 $E/switch-lang-inapp.py --udid $U --to 中文      # 收尾还原
```
