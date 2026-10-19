# r145 · 装机态复验「推迟 10 分钟」不再提前（含旧件反臂）

这一包只为一件事：把 r142/r143/r144 在四格读数里量到的那枚缺陷（**按「推迟」把一条还没到点的提醒
往过去挪 50 分钟**）改掉，并在**装进模拟器的产物**上取回反过来的读数。
缺陷的成因链与四格原始读数在 [`../ios-reminder-block-r141/RESULT.md`](../ios-reminder-block-r141/RESULT.md) §四。

## 一、改了什么（一句话 + 落点）

推迟的**基准**从"墙上时钟"换成"这一行此刻的时刻"：`snoozeByMinutes(entityId, minutes)` 落在
[`packages/app-host/src/reminder-actions.ts`](../../../../../packages/app-host/src/reminder-actions.ts)
（基准 = `max(now, reminderEffectiveAt(reminder))`，推迟量仍走领域层 `snoozeDeadline`，非正抛错、上限照旧钳 7 天）。
两端壳只交分钟数：[`apps/mobile/src/lib/reminders.ts`](../../../../../apps/mobile/src/lib/reminders.ts) 与
[`apps/web/src/features/reminders/store.ts`](../../../../../apps/web/src/features/reminders/store.ts) ——
基准不在外壳算（web 那份文件头本来就写着"这一层一个判断都不能写"）。
旧的绝对时刻入口 `snoozeReminder(entityId, untilMs)` 原样留着给底层调用方，两者共用同一份写路径。

为什么这算缺陷而不是取向：**界面文案自己就是借条**。按钮念的是
`把 10-19 18:44 的提醒推迟 10 分钟` / `Snooze the reminder at 10-19 18:44 by 10 minutes` ——
基准写的是**那一行的时刻**，实现却按"现在 + 10 分钟"算，代码与已发布文案矛盾。

## 二、三趟读数（同一台模拟器、同一枚装置，只差装的是哪一件）

| 落点 | 装的是 | rc | 按之前按钮念的 | 按完之后那行念的 | 净效果 |
|---|---|---|---|---|---|
| `arm-old-bundle-light/` | 修复**前**那件（11:23 装上的旧包） | **1** | `把 10-19 20:06 的提醒推迟 10 分钟` | `关闭 10-19 19:16 的提醒` | **提前 50 分钟** ⇒ 新断言在旧件上红 |
| `fixed-light/` | 修复后（本次重打重装） | 0 | `把 10-19 20:44 的提醒推迟 10 分钟` | `关闭 10-19 20:54 的提醒` | **推后 10 分钟** ✅ |
| `fixed-english-light/` | 同一件，`uiLocale=en` | 0 | `Snooze the reminder at 10-19 21:05 by 10 minutes` | `Dismiss the reminder at 10-19 21:15` | **推后 10 分钟** ✅ |

读数逐字取自各目录的 `reminder-block.json`（`taps[].label` 与 `snoozeMove`）：
`snoozeMove` 是这一轮新加的那枚断言写进读数的字段 ——
`{before, after, movedLater}`，`movedLater` 不是 `true` 就抛错，**没有"看不见就跳过"这一支**。

* 出包条件：主检出工作树 clean ⇒ 内容 == HEAD，包里含 `b23b65cb5` 那枚修复；
  之后的 `0636f8cab` 只动 `scripts/qa/`，不进包。
* 两档绿趟的收尾各自回读过：`fixed-light` 建的任务 `Rem141…` 已删（`gone: true`）、
  提醒删回空态；`fixed-english-light` 同。设备语言已还原成中文（`language after (zh): passed`，
  只看 AX 树回读，#488），`com.heyta` 已 terminate。
* 反臂那一趟半途红 ⇒ 当时装置还没学会收尾，把 `Rem1411792407981` 留在了设备上；
  已按**精确标题**用同一枚 `delete_own_task` 删掉（`arm-old-bundle-light/leftover-cleanup.json`，`gone: true`），
  并把"失败支也收自己建的任务"补进装置（`0636f8cab`）。

## 三、离线判据（先红后绿，不是补写的）

`packages/app-host/tests/reminder-actions.spec.ts` 新增 5 条，**实现之前跑过一次是 5 条全红**
（`TypeError: actions.snoozeByMinutes is not a function`，`rc=1`），实现之后整包 1854 条绿。
覆盖的形状：未来提醒往后推 / 已过点的从现在起算 / 连按两次是累加 / 分钟数非正抛错 + 超上限钳 7 天 /
已投递的不写 op 返回 false。
外壳那枚契约针换成"文案念出的就是传进去的那个时刻"
（[`apps/mobile/tests/reminders-notes-display.spec.ts`](../../../../../apps/mobile/tests/reminders-notes-display.spec.ts)）。
门禁现量：`check:layering`、`check:reachability`、`check:locator-labels`、`check:script-snapshot`、
`check:verify-script-copy` 各 `rc=0`；`packages/app-host`、`apps/mobile`、`apps/web` typecheck 各 `rc=0`
（**先重打 app-host 才过** —— 外壳读的是 `dist`，源码改了不等于产物改了）。

## 四、像素尺与人眼层

`fixed-light/` 五张、`fixed-english-light/` 五张、`arm-old-bundle-light/` 三张（半途红，只有到第三步的图）
全部 `modalLuminance = 252`（浅档）。人眼逐张看过的：`fixed-light/03-reminder-snoozed.png`
（屏钟 19:44，行上写 `10-19 20:54` + 徽标「已推迟」）与 `fixed-english-light/03-reminder-snoozed.png`
（屏钟 20:06，行上写 `10-19 21:15` + `Snoozed`）—— **屏幕上那条确实挪到了更晚**。

## 五、这一包不证什么

* **暗档没重跑**：这枚改动是时刻算术，与外观档无关；r144 已经量过 `english-dark` 与 `english-light`
  的 15 枚 frame 逐枚相同 ⇒ 外观维对这块界面的形状没有影响。
* **Android / 桌面端没重跑**：改的是共享动作层，两端壳各只改了调用点；设备腿只有 iOS 这一枚装置。
* **连按两次的累加只在单测里**，装机态这一趟只按了一次。
* 🔴 **r143 那枚「英文徽标被逐字打断」没动**（本包一个字没碰样式）：`fixed-english-light/03` 上
  时刻那一列仍折成 `10-19` / `21:15` 两行 ⇒ 台账 §四 第 38 行仍然开着。

## 六、下一位怎么重跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
pnpm build:ios && xcrun simctl install $U apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
python3 scripts/qa/reminder-block-ios.py --udid $U \
  --evidence-dir apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r145/<新末级名-light>
# 英文档：先 python3 scripts/qa/ios-app-language.py --udid $U --to en，跑完 --to zh 还原（判语言只看 AX 树回读）
```
落点末级名必须恰好以 `-light` / `-dark` 结尾才会被 `require_appearance` 对账（#472、§四 第 37 行上方那段教训）。
反臂不用重造：拿修复**前**的那件装上去跑同一枚装置，就会红在 `moved the reminder EARLIER`。
