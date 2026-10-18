# r132 · iOS 任务详情里的提醒块：装机态浅/深两档配对

**一句话**：iOS 这一侧第一次有提醒的设备腿。两档各走一遍「空态 → 加一条 → 删回空态」，
逐枚 frame 与两档截图都取到；**12 个数（尺寸 + 相对位移）两档全等**，只有整块内容的绝对 y 差一个常数 8pt（滚动停靠差，不是布局差）。
顺带把两枚装置坑钉进环境陷阱（#473 假 absent、#474 假可点/假裁切、#475 系统弹窗没法按档复位）。

## 一、出处（读数离开这一节就不成立）

| 项 | 值 |
|---|---|
| 载体 | 第八趟四端重装的隔离检出 `head-r128`（HEAD `f8d7155e`），本机 iOS 模拟器 UDID `FE195661-B021-4A71-AAD1-1F2F7AE3A102` |
| 装机件 | 该载体重打出来的 `heyta` iOS 模拟器包（**不是**主检出的旧包） |
| 装置 | 本目录 `probe-reminder-block.py`（复用 `scripts/qa/tasks-ux-ios.py` 的 `Probe` / `AX` shim，零改动共享装置） |
| 屏 | `screen=[402, 874]`，tab 栏顶 `y=776`（从树里现量） |
| 浅档 | `light/reminder-block.json`，`startedAt=1792326499`，任务 `Rem1321792326499`，`uiLocale=zh-CN`，`appearance=light` |
| 深档 | `dark/reminder-block.json`，`startedAt=1792326698`，任务 `Rem1321792326697`，`uiLocale=zh-CN`，`appearance=dark` |
| 外观怎么落上去的 | 见 #471：`simctl ui … appearance dark` **之后要 `shutdown`+`boot` 一次**才到达这枚包。两档各重启一次，判据是图（见第五节那把尺） |
| 探针缺陷趟的存档 | `light/STALE-exact-match-reminder-block.json`（精确匹配那版）、`light/STALE2-absent-actions-reminder-block.json`（子串那版）—— 两枚都是**假 absent**，见第三节 |

## 二、这一格在判什么

目标点名"提醒状态"，而 iOS 侧此前**一条提醒的设备腿都没有**：
`grep -l 提醒 scripts/qa/*.py` 在本仓只回 web 那几条（现量：`scripts/qa/` 下 iOS 命名的脚本里无一命中「提醒」）。
所以这一趟不判行为对错，只把三件事落成数：

1. 空态 → 加一条 → 删回空态，各留一张图（**加完必删**：那条 `+1h` 的提醒到点会真发本地通知）；
2. 徽标与三枚动作按钮的 frame 逐枚抄下来 —— 与批量条那一格（r130）同一形状的行为判据，两档对比看数，不靠"看图觉得一样"；
3. 两档落点分目录（`light/` 与 `dark/`），**不在同一目录里覆盖** —— 那是 #472 的直接对策。

## 三、装置这一趟修掉的三件事（都不是放宽判据）

* **「添加」有两个形状**：任务**没有**截止时间时，`ReminderList` 不渲染 `reminder.add`「添加提醒」，只剩 `reminder.absolute.1h`「1 小时后提醒」+ 一行解释。
  第一版探针按「添加提醒」点 ⇒ 超时。错误里回读的 `visible` 列出现实标签，才看清是形状问题。**这一趟建的任务全部无截止时间**，所以两档照到的都是绝对时刻那一支；
  「添加提醒」那一支**本趟没照到**（见第六节）。
* **`probe.node()` 不会返回 `None`** —— 它包的是 `wait()`，找不到就抛 `ProbeError`。所以"找不到就滚一下"的写法在第一版里根本没走到滚动那支。
  改成自己 `scroll_into_view`（滚到**中心点落进视口**为止）+ 自己按 frame 中心（`raw_tap`）。
  共享装置那条 `vis_limit = h - 120` 的可见守卫滑不动这层长滚动面板（提醒块未滚时落在 `y≈1846`），与 #469 底部 tab 同一族。
* **三枚动作按钮"没有 AX 标签"是假的**（#473）：精确串扫 ⇒ 三枚全 `present=false`；退到子串「删除提醒」**还是** absent ——
  真标签是 `reminder.a11y.*` 那三条**整句、带时刻**的串：「把 10-18 21:29 的提醒推迟 10 分钟」/「关闭 …」/「删除 …」。
  发现它靠的是**先打开截图、再手工 dump 一次树**对了一遍，否则这条会被登记成一条不存在的无障碍缺陷。
  匹配器改成"动词 + 提到同一对象"两把一起，并把真正命中的整句记进 `matchedLabel`。

## 四、两档逐枚配对

`light` / `dark` 各自的 frame（单位 pt）。**深档整块内容比浅档低 8pt**，但那是滚动停靠差 ——
把每一枚减去本档「提醒」标题的 y，两档**完全相同**（最后一列）。

| 元素 | 浅档 frame | 深档 frame | 相对本档标题的 Δy（浅 / 深） |
|---|---|---|---|
| 「提醒」标题 | `[16, 295, 370, 23]` | `[16, 303, 370, 23]` | 0 / 0 |
| 空态「还没有提醒」 | `[16, 330, 370, 18]` | `[16, 338, 370, 18]` | +35 / +35 |
| 「1 小时后提醒」按钮 | `[16, 360, 111, 44]` | `[16, 368, 111, 44]` | +65 / +65 |
| 无截止时间解释行 | `[16, 416, 370, 18]` | `[16, 424, 370, 18]` | +121 / +121 |
| 「待触发」徽标 | `[24, 361, 33, 14]` | `[24, 369, 33, 14]` | +66 / +66 |
| 「稍后提醒」 | `[132, 332, 82, 44]` | `[132, 340, 82, 44]` | +37 / +37 |
| 「关闭提醒」 | `[218, 332, 82, 44]` | `[218, 340, 82, 44]` | +37 / +37 |
| 「删除提醒」 | `[304, 332, 82, 44]` | `[304, 340, 82, 44]` | +37 / +37 |

三枚动作按钮 `x` 逐枚等值（132 / 218 / 304），宽度 82、右边缘 214 / 300 / **386**（屏宽 402 ⇒ 最右一枚距右边缘 16pt）
⇒ **这一行没有 r130 批量条那种右边缘裁切**（那一格第三枚被切掉，是另一条待裁决的候选缺陷 #83）。

两档都走完 `added → removedBackToEmpty: true`（删掉后回到「还没有提醒」），`close detail` 两档都成功（`关闭任务详情 [342, 103, 44, 43]`）。

## 五、第二把尺：图确实是两档

`scripts/screenshots/png-stats.mjs` 的 `modalLuminance`（CLI 不吐 JSON，要 `node --input-type=module -e "import {inspectPng} …"`）：

```
light/01-reminder-empty.png   252      dark/01-reminder-empty.png   28
light/02-reminder-added.png   252      dark/02-reminder-added.png   28
light/03-reminder-removed.png 252      dark/03-reminder-removed.png 28
```

`looksBlank` 六枚全 `undefined`（= 不空）。六张图**逐张看过**（规定一），深档那张看清了：
时刻行「10-18 21:32」+「待触发」徽标 + 三枚动作（删除那枚图标与文字是红的）+ 蓝底「+ 1 小时后提醒」+ 解释行，无重叠、无截断。

## 六、这一趟不证

1. **不证有截止时间那一支**（「添加提醒」那个形状、以及相对/绝对提醒的选择器）—— 本趟建的任务一律无截止时间。
2. **不证英文档**：两档都在 `zh-CN`。英文侧的标签串（`Remind me in 1 hour` / `Delete the reminder …`）来自 `packages/i18n` 的键，
   **没有**在装机态照过。
3. **不证系统通知授权弹窗能按档各照一次**（#475）：`simctl privacy … reset notifications com.heyta` 在这台模拟器回
   `rc=1 / NSPOSIXError 1`，弹窗是一次性的、复位不了 ⇒ 两档 JSON 里的 `notifyPrompt.present=false`
   **不是**"这一档不弹"的证据，而是"授权已经在更早一趟被点到『不允许』，所以不再弹"。
4. **不证提醒真的会触发**：本趟只证"加得进去、删得回来、徽标写『待触发』"。触发/回执那条在 web 与 Android 腿上有读数，iOS 没有。
5. **不证稍后/关闭两枚动作的行为**：只量了它们的 frame，没点。

## 七、收尾（发现态还原，逐件现量）

* **通知授权**：⚠️ 这台机现在停在**「不允许」**，而接手时是**未决定**（第一次加提醒时弹过框）。
  这是本趟对共享设备做的**唯一一处状态改动**，`simctl privacy reset` 修不回去（#475）。要还回未决定需 `simctl uninstall`（会连带吃掉登录态与本地库）。
* **任务列表**：本会话在这台机上留下的 **17 条测试任务**（`Rem132*` 7 条 + r130 的 `BulkA/B*` 10 条）已逐条删除，
  删前用 `_cleanup/clean-own-tasks.py` 的白名单核对过「树里 `打开任务：*` 全集 ⊆ 白名单」，外来任务 0 条；
  删后 `_cleanup/cleanup-pass4.json` 记 `remainingAfter: []`，`_cleanup/cleanup-pass4-after.png` 人眼看过：
  「还没有任务 / 今天还没有安排」空态、中文、浅色。
* **语言**：`uiLocale=zh-CN`（两档 JSON 各自记的），未动过开关。
* **外观**：回浅色，`modalLuminance=252`（`_cleanup/cleanup-pass4-after.png` 实测）。
* **没收任何 companion**（pid 31182 全程在册）。
* 中途为验证"最后一行是不是被裁"临时建过一条 `Clip1331792334431`，已删除（见第八节）。

## 八、一枚候选缺陷的**否证**（#474 ⑶）

两档的 `01/02` 图里，详情面板最后一行（「标记为完成」+ 红色「删除」）都被面板下沿**横向切掉一半**，
深档那张甚至看着像一个没有字的红块 —— 形似一条裁切缺陷。
量了一遍再登记：临时建一条任务、打开面板、向面板内连推六下，那行的 AX frame 从 `y=1903` 回到 `y=677`（≤ tab 栏顶 776），
`_cleanup/clip-1-after-6-swipes.png` 里两枚标签完整可读 ⇒ **是"没滚到底"，不是裁切**。
所以这里**不登记缺陷**，只把这条判据钉进 #474：报"被切"之前先做一次有界滚动并复量 frame。

## 九、复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
D=apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r132
xcrun simctl ui $U appearance light && xcrun simctl shutdown $U && xcrun simctl boot $U   # 见 #471
python3 $D/probe-reminder-block.py --udid $U --out $D/light
xcrun simctl ui $U appearance dark  && xcrun simctl shutdown $U && xcrun simctl boot $U
python3 $D/probe-reminder-block.py --udid $U --out $D/dark
# 两档落点必须分开目录，否则后一趟静默吃掉前一档证据（#472）
```
