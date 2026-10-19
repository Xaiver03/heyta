# r141 · iOS 任务详情里的提醒块（装机态 · 深浅两档）

装置：`scripts/qa/reminder-block-ios.py`（本轮由 r132 落在取证目录里的一次性探针转正而来）
设备：模拟器 `heyta-iphone-17pro` · UDID `FE195661-B021-4A71-AAD1-1F2F7AE3A102` · iOS 27.0
被测件：载体 `/Users/rocalight/heyta-carriers/head-r128` @ `997a1935`，装机 bundle
`…/Bundle/Application/D8CEE77A-…/Heyta.app`，`Info.plist` mtime `2026-10-19 11:23:59`，`CFBundleShortVersionString 1.0 / CFBundleVersion 2`
（与 r139 / r140 同一枚件 —— 载体里那三行 `git status` 脏项是 `pod install` 重写 plist 的产物，见 #489，不是源码漂移）
屏：1206×2622 px = 402×874 pt

---

## 一、两格读数（每格一趟完整旅程：空态 → 加一条 → 删回空态 → 删掉自己建的那条任务）

| 档 | rc | 时长 | 语态 | 底部 tab 栏顶边（列表面现量） | 下界 | 起跳时在场的系统弹窗 |
|---|---|---|---|---|---|---|
| `light/` | 0 | 38.7 s | zh-CN | 776 pt | 772 pt | 1 枚（按掉「允许」） |
| `dark/` | 0 | 51.1 s | zh-CN | 776 pt | 772 pt | 0 枚 |

逐枚 frame（pt）——**两档逐枚相同**，这是这一格的控制配对读数：

| 元素 | 空态 frame | 加完 frame | 两档是否一致 |
|---|---|---|---|
| 「提醒」节标题 | `[16,295,370,23]` | 同 | ✅ |
| 「还没有提醒」 | `[16,330,370,18]` | 消失 | ✅ |
| 「1 小时后提醒」快捷按钮 | `[16,360,111,44]` | 同（仍在） | ✅ |
| 「这个任务没有截止时间，只能按绝对时刻提醒」 | `[16,416,370,18]` | 同 | ✅ |
| 「待触发」状态徽标 | 不存在 | `[24,361,33,14]` | ✅ |
| 推迟（a11y 整句） | 不存在 | `[132,332,82,44]` | ✅ |
| 关闭（a11y 整句） | 不存在 | `[218,332,82,44]` | ✅ |
| 删除（a11y 整句） | 不存在 | `[304,332,82,44]` | ✅ |

加完那三枚**命中的整句可及名称**（不是屏上那三个字）：

* light：`把 10-19 18:25 的提醒推迟 10 分钟` / `关闭 10-19 18:25 的提醒` / `删除 10-19 18:25 的提醒`
* dark：同形，时刻 `18:26`

删完：`待触发` present=false、`还没有提醒` present=true、`removedBackToEmpty=true`。
收工：两档各自删掉本次建的那条（`Rem1411792401893` / `Rem1411792401977`，`gone: true`），
设备现量任务列表为空（`rows left: []`）。

## 二、深浅那一把尺（判据是图，不是命令回读 —— #471）

`node scripts/screenshots/png-stats.mjs` 的 `modalLuminance`，逐张现量：

| 目录 | 01 | 02 | 03 |
|---|---|---|---|
| `light/` | 252 | 252 | 252 |
| `dark/` | 28 | 28 | 28 |
| `arm-before-fix-noop-tap/` | 252 | 252 | 252 |

设深走的是 #471 那条能到达当前件的顺序：`shutdown` → `boot` → `bootstatus -b` → `simctl ui … appearance dark`。
`simctl ui … appearance` 的回读（`dark`）**没有**被当判据用。

## 三、这一趟真正修掉的是探针，不是产品 —— 两支反臂

| 支 | 装置状态 | 现量 | rc | 结论 |
|---|---|---|---|---|
| ① `arm-before-fix-noop-tap/` | 只把守卫换成 `AIF.viewport_bottom()`，未夹 tab 栏、未判停稳 | 下界 **866**（面板开着时树里没有 tab 栏 ⇒ 退到屏高−8），那一下打在 `(71,796)` = tab 栏身上；`afterAdd` 四枚全 `present:false`；**却 rc=0 交回"取到读数"** | 0 | 旧探针的"看得见"射程不含底部 tab 栏；打空只留一条读数不算红 ⇒ 这条判据当时**不能失败** |
| ② `/tmp/r141-light.log` + `prompt-first-run/` | 夹了 tab 栏（下界 772）、判了停稳，但还没处理系统弹窗 | 那一下打在 `(71,382)`（settled frame 正中）→ **红**：`adding a reminder changed nothing on screen` | 1 | 这一支红得**假**：提醒其实加上了，是 iOS 系统弹窗整片顶掉了 app 的 AX 树（见第四节） |
| ③ 加完两支都修 | 夹下界 + 判停稳 + 起跳先按掉在场弹窗 + 加完/删完写成硬断言 | light / dark 各一趟 rc=0，逐枚 frame 如上 | 0 | 判据现在两头都能红，绿的时候才有内容 |

## 四、新量到的一条环境事实（已登记为 #493）

**iOS 系统弹窗在场时，`idb describe-all` 只回弹层那一棵树（现量 5 枚节点），app 自己的标签整片读不到。**
⇒ 任何"按下去之后画面没变"的判定，在这一刻读到的都是**假 absent**。
现量证据：`prompt-first-run/tree-during-prompt.json`（含每枚节点的 pid 与 frame）与
`prompt-first-run/01-system-prompt-covers-block.png`（弹窗压在提醒块上，提醒块已经加好）。
那棵树的 pid 是 `11428`，而当时前台 app 是 `40365` ⇒ 它不属于 app 进程，
**活得过 `simctl terminate` + `launch`**（实测：不先按掉，下一趟死在 `ensure_on_tasks()`，报 `workspace did not open after onboarding`）。
装置因此的做法：起跳时把在场的弹窗逐枚按掉并**记进读数**（`systemPromptsAtStart`），不按掉就红。

产品侧这一格顺带量到：**加第一条提醒会拉起系统通知授权弹窗**，且**提醒先建好、弹窗后到**
（截图里 `10-19 18:15` 那一行已经在块里）。授权一旦决定就不再弹，而本机
`simctl privacy reset notifications` 回 rc=1（#475）⇒ **这一支只能取一次，复现不出来**。

## 五、装置改了什么（下一位要能接着改）

1. 从 `apps/mobile/evidence/…/ios-reminder-block-r132/probe-reminder-block.py` 转正到 `scripts/qa/reminder-block-ios.py`。
2. 可见守卫：`0 < cy < 屏高−40` → **列表面现量的 tab 栏顶边 − 4** 与 `viewport_bottom` 取小（`tabBarTopOnListScreen` / `viewportBottomClamp` 都进读数）。
3. 停稳判据：借 `ai-face-ios.settle_in_viewport` 那一半形状 —— 隔 1.2 s 连读两遍、frame 容差 12 pt 才交回（旧探针读到 720、截图里在 553，中间画面自己又滚了 167 pt）。
4. 三枚动作按钮改按**词条模板**匹配（`reminder.a11y.snooze|dismiss|remove`，把 `{when}` 通配），不再在探针里自拼动词表 —— 后者让英文那一侧成为没人守的抄件（`check:locator-labels` 判据四把它红了：`'reminder'`、`'Close task detail'`、`'Open task: '`、`noDueDate` 的英文整句都不在 `en.ts`）。真实英文是 `Close task details`（`mobile.detail.close`）与 `…so only an absolute time can be set`。
5. 标签一律**函数内求值**：`JU.ENGLISH` 是探针读到第一帧树之后才翻的旗，模块顶层常量会把英文态永远锁成中文。
6. 起跳自己造：`terminate` + `launch` + 按掉在场弹窗（同 #492 那一族）。
7. 加完/删完从"记一条读数"改成**硬断言**（打空就红，红之前先 `02-add-did-not-land` 留图）。
8. 收工删掉本次建的那条任务（旧探针建完不管 ⇒ r132 之后要另跑手工清理）。
9. 登记进门禁：`package.json` 的 `check:locator-labels` 文件清单 + `CJK_GROUP_FLOOR["reminder-block-ios.py"]`。
   现量：`python3 scripts/qa/check-locator-labels.py scripts/qa/reminder-block-ios.py` →
   `✅ 读到 50 组（含中文 14、T() 同义定位 1 处）`。

## 六、人看图

七张里逐张看过五张：`light/01`、`light/02`、`dark/01`、`dark/02`、`dark/03` 与弹窗那张 `prompt-first-run/01`。
看到的内容：两档的三种状态（空态 / 一条已排程 / 删回空态）逐枚对应，深色档没有残留浅色底；
「待触发」徽标在两档都是同一枚胶囊底 + 反色文字；三枚动作按钮在 402 pt 宽下**没有**被右边缘截（最后一枚 frame 右边界 386 pt，屏宽 402）。
没看的两张：`light/03`、`arm-before-fix-noop-tap/02`/`03`（前者与 `dark/03` 同形、后者是反臂的"什么都没发生"图，其内容已由 JSON 读数与第三节表格承担）。

## 七、这一格不证什么

1. **不证提醒真的会发出去**：本机无法把通知权限回到未决态（#475），弹窗那一支只取到一次；
   也不证到点触发（那要等一小时）。这一格证的是**块内三态的界面与可及名称**。
2. **不证英文语态**：两档都在 zh-CN 下跑（`uiLocale` 逐趟记进 JSON）。装置现在双语可定位
   （第 4、5 条改的就是这个），但英文那一档**没有本趟读数**，别按形状推定它过。
3. **不证有截止时间的任务**：那条路径上块里会出现「添加提醒」与相对偏移预设，本趟建的任务没有截止时间，
   所以 `添加提醒 present=false` 是**这一格的形状**，不是缺陷。
4. **不证推迟 / 关闭两枚动作按下去的效果**：旅程只做到"加一条 → 删回空态"。
   那两枚的可及名称与 frame 已取到，动作本身没按（按了就要重新排程，收工更麻烦）。
5. 反臂那三张 `arm-before-fix-noop-tap/*.png` 是**红趟留下的**，不是通过态的图。

## 八、复跑

```bash
# 亮档（当前外观就是 light 时直接跑）
python3 scripts/qa/reminder-block-ios.py \
  --udid FE195661-B021-4A71-AAD1-1F2F7AE3A102 \
  --evidence-dir apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r141/light

# 暗档：必须先按 #471 那一条顺序重启模拟器，再设深
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
xcrun simctl shutdown $U && xcrun simctl boot $U && xcrun simctl bootstatus $U -b
xcrun simctl ui $U appearance dark
python3 scripts/qa/reminder-block-ios.py --udid $U \
  --evidence-dir apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r141/dark
xcrun simctl ui $U appearance light        # 收尾还原
```

设备收尾状态（现量）：外观 `light`、`com.heyta` 已 terminate、任务列表为空、
通知权限 = 已允许（本趟按掉的那枚弹窗决定的，**不可回退**，见 #475）。
