# r141 · iOS 任务详情里的提醒块（装机态 · 深浅两档 · 五步旅程）

装置：`scripts/qa/reminder-block-ios.py`（本轮由 r132 落在取证目录里的一次性探针转正而来）
设备：模拟器 `heyta-iphone-17pro` · UDID `FE195661-B021-4A71-AAD1-1F2F7AE3A102` · iOS 27.0
被测件：载体 `/Users/rocalight/heyta-carriers/head-r128` @ `997a1935`，装机 bundle
`…/Bundle/Application/D8CEE77A-…/Heyta.app`，`Info.plist` mtime `2026-10-19 11:23:59`，`CFBundleShortVersionString 1.0 / CFBundleVersion 2`
（与 r139 / r140 同一枚件 —— 载体里那三行 `git status` 脏项是 `pod install` 重写 plist 的产物，见 #489，不是源码漂移）
屏：1206×2622 px = 402×874 pt

> ⚠️ **目录名里的 `r141` 是"探针转正"那一趟；本页 §一/§二 的读数是它之后那次扩程（r142）重跑的**：
> 旅程从「空态 → 加一条 → 删回空态」三步扩成**五步**（中间多了**按「推迟」**与**按「关闭」**两枚动作），
> 所以每档五张图。旧三步留下的 `03-reminder-removed.png` 已从两档目录里删掉（同一件事现在叫 `05-`），
> 免得两枚 `03-` 并排被读成同一次。扩程照出来**一枚真产品缺陷**，在第四节。

---

## 一、两格读数（每格一趟完整旅程：空态 → 加一条 → **推迟** → **关闭** → 删回空态 → 删掉自己建的那条任务）

| 档 | rc | 时长 | 语态 | 底部 tab 栏顶边（列表面现量） | 下界 | 起跳时在场的系统弹窗 |
|---|---|---|---|---|---|---|
| `light/` | 0 | 34.6 s | zh-CN | 776 pt | 772 pt | 0 枚 |
| `dark/` | 0 | 35.7 s | zh-CN | 776 pt | 772 pt | 0 枚 |

逐枚 frame（pt）——**两档逐枚相同**，这是这一格的控制配对读数：

| 元素 | 空态 frame | 加完 | 推迟后 | 关闭后 | 两档是否一致 |
|---|---|---|---|---|---|
| 「提醒」节标题 | `[16,295,370,23]` | 同 | 同 | 同 | ✅ |
| 「还没有提醒」 | `[16,330,370,18]` | 消失 | — | — | ✅ |
| 「1 小时后提醒」快捷按钮 | `[16,360,111,44]` | 同（仍在） | 同 | 同 | ✅ |
| 「这个任务没有截止时间，只能按绝对时刻提醒」 | `[16,416,370,18]` | 同 | 同 | 同 | ✅ |
| 「待触发」状态徽标 | 不存在 | `[24,361,33,14]` | 消失 | 不存在 | ✅ |
| 「已推迟」状态徽标 | 不存在 | 不存在 | `[24,361,33,14]` | 不存在 | ✅ |
| 「已关闭」状态徽标 | 不存在 | 不存在 | 不存在 | `[114,345,33,14]` | ✅ |
| 推迟（a11y 整句） | 不存在 | `[132,332,82,44]` | `[132,332,82,44]` | 消失 | ✅ |
| 关闭（a11y 整句） | 不存在 | `[218,332,82,44]` | `[218,332,82,44]` | 消失 | ✅ |
| 删除（a11y 整句） | 不存在 | `[304,332,82,44]` | `[304,332,82,44]` | `[304,330,82,44]` | ✅ |

⚠️ 一枚**不是缺陷**的外观读数，写给下一个看图的人：徽标那一枚**换行**了 —— 推迟档三枚动作都在，
「已推迟」被挤到时间下面（`y=361`）；关闭档只剩一枚「删除提醒」，「已关闭」回到与时间同行（`x=114, y=345`）。
两档同形，是 flex 自然换行，不是裁切。删除那枚 `y` 从 332 变 330 同因（那一行少了一枚按钮）。

命中的**整句可及名称**（不是屏上那三个字，见 #473）与它照出的缺陷，直接看第五节。

删完：`待触发` present=false、`还没有提醒` present=true、`removedBackToEmpty=true`。
收工：两档各自删掉本次建的那条（`Rem1411792403048` / `Rem1411792403246`，`gone: true`），设备现量任务列表为空。

## 二、深浅那一把尺（判据是图，不是命令回读 —— #471）

`node scripts/screenshots/png-stats.mjs` 的 `modalLuminance`，逐张现量：

| 目录 | 01 | 02 | 03 | 04 | 05 |
|---|---|---|---|---|---|
| `light/` | 252 | 252 | 252 | 252 | 252 |
| `dark/` | 28 | 28 | 28 | 28 | 28 |
| `arm-before-fix-noop-tap/` | 252 | 252 | 252 | — | — |

设深走的是 #471 那条能到达当前件的顺序：`shutdown` → `boot` → `bootstatus -b` → `simctl ui … appearance dark`。
`simctl ui … appearance` 的回读（`dark`）**没有**被当判据用。

## 三、这一趟真正修掉的是探针，不是产品 —— 反臂

| 支 | 装置状态 | 现量 | rc | 结论 |
|---|---|---|---|---|
| ① `arm-before-fix-noop-tap/` | 只把守卫换成 `AIF.viewport_bottom()`，未夹 tab 栏、未判停稳 | 下界 **866**（面板开着时树里没有 tab 栏 ⇒ 退到屏高−8），那一下打在 `(71,796)` = tab 栏身上；`afterAdd` 四枚全 `present:false`；**却 rc=0 交回"取到读数"** | 0 | 旧探针的"看得见"射程不含底部 tab 栏；打空只留一条读数不算红 ⇒ 这条判据当时**不能失败** |
| ② `prompt-first-run/` | 夹了 tab 栏（下界 772）、判了停稳，但还没处理系统弹窗 | 那一下打在 `(71,382)`（settled frame 正中）→ **红**：`adding a reminder changed nothing on screen` | 1 | 这一支红得**假**：提醒其实加上了，是 iOS 系统弹窗整片顶掉了 app 的 AX 树（见第四节） |
| ③ ①②都修之后 | 夹下界 + 判停稳 + 起跳先按掉在场弹窗 + 加完/推迟/关闭/删完写成硬断言 | light / dark 各一趟 rc=0，逐枚 frame 如上 | 0 | 判据现在两头都能红，绿的时候才有内容 |
| ④ `arm-light-claim-refused.txt` | `ai-face-ios.require_appearance` 把"声称"从末级名恰好等于 `light`/`dark` 扩到 `*-dark` **与 `*-light`**（r140 只补了 `-dark` 那一侧） | 设备现量 `dark`，落点末级名 `arm-claims-light` ⇒ **`refusing to write: evidence dir says 'light' but the device is 'dark'`**，且**目录没被创建**（`ls` 回 `No such file or directory`） | 1 | 对称补齐后有牙；相符态的正对照就是同名的 `dark/` 那趟（`*-dark` 侧 r140 已量过一次） |

🔴 ** 前面两支臂是我自己命名的坑，写下来给下一个写臂的人**：那两趟落点末级名分别叫
`arm-claim-light-while-dark/` 与 `arm-claim-light-while-dark-r2/` —— 第一枚**以 `-dark` 结尾** ⇒ 守卫读成"声称暗档"，与设备相符，放行；
第二枚以 `-r2` 结尾 ⇒ **根本不声称任何档**，也放行。两趟都 `rc=0` 跑成完整暗档旅程，读数里 `appearance` 一直诚实写着 `dark`。
⇒ 这枚守卫读的是**末级名的后缀**，不是名字里有没有 `light` 这个词。臂名要让它**恰好以要声称的那一档结尾**，
否则臂不红而旅程照绿。那两枚目录（内容与 `dark/` 那趟同形）已删，留下的可复现证据是上面这一支。

## 四、这一趟量到的一枚**真产品缺陷**：按「推迟 10 分钟」把一条**未来**提醒**提前**了

读数（同一趟内，逐字取自 `light/reminder-block.json` 与 `dark/reminder-block.json` 的 `taps` 与各态 `rows`）：

| 档 | 屏幕时钟 | 按之前那枚按钮念的是 | 按之后这一行剩下的动作念的是 | 净效果 |
|---|---|---|---|---|
| `light/` | 17:44 | `把 10-19 **18:44** 的提醒推迟 10 分钟` | `关闭 10-19 **17:54** 的提醒` / `删除 10-19 **17:54** 的提醒` | **提前 50 分钟** |
| `dark/` | 17:47 | `把 10-19 **18:47** 的提醒推迟 10 分钟` | `关闭 10-19 **17:57** 的提醒` / `删除 10-19 **17:57** 的提醒` | **提前 50 分钟** |

两档的 `03-reminder-snoozed.png` 上那行时间就写着 `10-19 17:54` / `10-19 17:57`（状态徽标「已推迟」）——
**屏幕上就印着这条提醒被挪到了过去方向**，不是可及名称的问题。

成因链（现量，逐枚行号可点开）：

* `apps/mobile/src/lib/reminders.ts:171` —— 按「稍后提醒」时传的是 `snoozeTargetAt(Date.now())`；
* `apps/mobile/src/lib/reminders-display.ts:67` —— `snoozeTargetAt(now)` 就是 `snoozeDeadline(now, SNOOZE_MINUTES)`；
* `packages/domain/src/reminders.ts:336` —— `snoozeDeadline(at, minutes = 10) => at + min(minutes*60s, MAX_SNOOZE_MS)`；
  ⇒ 新时刻 = **现在 + 10 分钟**，与那条提醒原本排在几点**无关**。原本在 18:44（一小时后）就被改成 17:54（十分钟后）。
* 同一形状在 **web 端也在**：`apps/web/src/features/reminders/store.ts:135` `snoozeReminder(entityId, snoozeDeadline(Date.now(), 10))`
  ⇒ 这不是 iOS 独有的，是一枚跨端的行为口径。
* 按钮上那句可及名称由 `packages/ui/src/reminders/ReminderList.tsx:345` 用 `row.when`（**当前**时刻）生成，
  所以"念的是 18:44、做的是 17:54"这一对矛盾在树里同时在场。

**为什么浏览器那五态覆盖看不见它**：`apps/mobile/tests/reminders-notes-display.spec.ts:133-134` 把这条契约钉成了
`snoozeTargetAt(NOW) === NOW + 10 * MINUTE` —— 单测断言的正是"从现在起算"，所以它只会把实现钉牢，不会去比"相对原时刻"。
设备腿之所以照得出来：它读的是**按钮自己念出的那个时刻**，而那个时刻来自界面上那一条已存在的提醒。

**本线不代改**（这是行为口径，不是笔误）：改法有两个方向 —— ① 按「推迟」= 相对**原时刻**推 10 分钟；
② 保持"从现在起算"但把文案改成「10 分钟后提醒」。①②都要动 `packages/domain` 那条收口函数与两端调用点，
并要重取那五态覆盖的读数 ⇒ 归提醒那一线裁决。**登记在台账 r142 那一格**，本页是它的原始读数出处。

## 五、新量到的一条环境事实（已登记为 #493）

**iOS 系统弹窗在场时，`idb describe-all` 只回弹层那一棵树（现量 5 枚节点），app 自己的标签整片读不到。**
⇒ 任何"按下去之后画面没变"的判定，在这一刻读到的都是**假 absent**。
现量证据：`prompt-first-run/tree-during-prompt.json`（含每枚节点的 pid 与 frame）与
`prompt-first-run/01-system-prompt-covers-block.png`（弹窗压在提醒块上，提醒块已经加好）。
那棵树的 pid 是 `11428`，而当时前台 app 是 `40365` ⇒ 它不属于 app 进程，
**活得过 `simctl terminate` + `launch`**（实测：不先按掉，下一趟死在 `ensure_on_tasks()`，报 `workspace did not open after onboarding`）。
装置因此的做法：起跳时把在场的弹窗逐枚按掉并**记进读数**（`systemPromptsAtStart`），不按掉就红。

产品侧这一格顺带量到：**加第一条提醒会拉起系统通知授权弹窗**，且**提醒先建好、弹窗后到**
（截图里那一行已经在块里）。授权一旦决定就不再弹，而本机
`simctl privacy reset notifications` 回 rc=1（#475）⇒ **这一支只能取一次，复现不出来**。
本页 §一 那两趟的 `systemPromptsAtStart` 都是 `[]`（0 枚）—— 因为授权已在 r141 第一趟里被按成「允许」。

## 六、装置改了什么（下一位要能接着改）

1. 从 `apps/mobile/evidence/…/ios-reminder-block-r132/probe-reminder-block.py` 转正到 `scripts/qa/reminder-block-ios.py`。
2. 可见守卫：`0 < cy < 屏高−40` → **列表面现量的 tab 栏顶边 − 4** 与 `viewport_bottom` 取小（`tabBarTopOnListScreen` / `viewportBottomClamp` 都进读数）。
3. 停稳判据：借 `ai-face-ios.settle_in_viewport` 那一半形状 —— 隔 1.2 s 连读两遍、frame 容差 12 pt 才交回（旧探针读到 720、截图里在 553，中间画面自己又滚了 167 pt）。
4. 三枚动作按钮改按**词条模板**匹配（`reminder.a11y.snooze|dismiss|remove`，把 `{when}` 通配），不再在探针里自拼动词表 —— 后者让英文那一侧成为没人守的抄件（`check:locator-labels` 判据四把它红了：`'reminder'`、`'Close task detail'`、`'Open task: '`、`noDueDate` 的英文整句都不在 `en.ts`）。真实英文是 `Close task details`（`mobile.detail.close`）与 `…so only an absolute time can be set`。
5. 标签一律**函数内求值**：`JU.ENGLISH` 是探针读到第一帧树之后才翻的旗，模块顶层常量会把英文态永远锁成中文。
6. 起跳自己造：`terminate` + `launch` + 按掉在场弹窗（同 #492 那一族）。
7. 加完/推迟/关闭/删完从"记一条读数"改成**硬断言**：任一态没到达就先留图（`<shot>-not-reached`）再红 —— "看得见就按、看不见就跳"那种写法会把"设备上这一态长什么样"永远留成没读数。
8. 收工删掉本次建的那条任务（旧探针建完不管 ⇒ r132 之后要另跑手工清理）。
9. 登记进门禁：`package.json` 的 `check:locator-labels` 文件清单 + `CJK_GROUP_FLOOR["reminder-block-ios.py"]`。
   现量：`python3 scripts/qa/check-locator-labels.py scripts/qa/reminder-block-ios.py` →
   扩程后 `读到 59 组（含中文 16、T() 同义定位 1 处）`，基线登记值 14（**下界不是配额**，它只防"把含中文的组删空"）。

## 七、人看图

**这一趟新扩出来的四张逐张看过**：`light/03-reminder-snoozed`、`light/04-reminder-dismissed`、
`dark/03-reminder-snoozed`、`dark/04-reminder-dismissed`。看到的内容：
两档的「已推迟」都是浅底胶囊 + 反色文字，「已关闭」同形；推迟档三枚动作（稍后提醒 / 关闭提醒 / 删除提醒）齐在场，
关闭档只剩「删除提醒」一枚 —— 与 §一 那三行 frame 逐枚对上；深色档两态都没有残留浅色底；
「删除提醒」那枚的红色图标在两档都是同一枚语义红。
第四节那枚缺陷**在人眼层就看得见**：图上那行时间比按下去之前按钮上念的时间早 50 分钟。
其余图（`01`/`02`/`05` 两档六张）与 r141 第一趟同形，按像素尺与 JSON 读数承担。

## 八、这一格不证什么

1. **不证提醒真的会发出去**：本机无法把通知权限回到未决态（#475），弹窗那一支只取到一次；
   也不证到点触发（那要等一小时）。这一格证的是**块内三态的界面、可及名称与两枚动作的效果**。
2. **不证英文语态**：两档都在 zh-CN 下跑（`uiLocale` 逐趟记进 JSON）。装置现在双语可定位
   （第 4、5 条改的就是这个），但英文那一档**没有读数**，别按形状推定它过。
3. **不证有截止时间的任务**：那条路径上块里会出现「添加提醒」与相对偏移预设，本趟建的任务没有截止时间，
   所以 `添加提醒 present=false` 是**这一格的形状**，不是缺陷。
4. **不证「推迟」的分钟数可配**：文案写死 10 分钟，本趟没测别的档位。
5. 反臂那三张 `arm-before-fix-noop-tap/*.png` 是**红趟留下的**，不是通过态的图。
6. 第四节的缺陷读数只到"界面上这一行挪到了过去"；**没证**它会不会真的按新时刻发通知（那要等），
   也没证服务端/其它端同步回来后这一行的表现。

## 九、复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
EV=apps/mobile/evidence/ux-final-20261018/ios-reminder-block-r141

# 亮档（当前外观就是 light 时直接跑）
python3 scripts/qa/reminder-block-ios.py --udid $U --evidence-dir $EV/light

# 暗档：必须先按 #471 那一条顺序重启模拟器，再设深
xcrun simctl shutdown $U && xcrun simctl boot $U && xcrun simctl bootstatus $U -b
xcrun simctl ui $U appearance dark
python3 scripts/qa/reminder-block-ios.py --udid $U --evidence-dir $EV/dark

# 反臂④（设备在 dark 时声称 light ⇒ 必须拒写、且目录不创建）
python3 scripts/qa/reminder-block-ios.py --udid $U --evidence-dir $EV/arm-claims-light; echo "REFUSE_RC=$?"
xcrun simctl ui $U appearance light        # 收尾还原（见下一段：还原要重启一次）
```

设备收尾状态（现量，18:1x）：外观 `light`（`simctl ui` 回读 + **装机面一张 `modalLuminance` = 252`** 双确）、
`com.heyta` 已 terminate、任务列表为空、通知权限 = 已允许（r141 第一趟按掉的那枚弹窗决定的，**不可回退**，见 #475）、
**没收任何 companion**（`idb_companion` 一律不动）。
⚠️ 上一格（r141 第一趟）写的"收笔 light"当时已被现量否证：本趟起跳前 `simctl ui … appearance` 回的是 `dark`
—— 是那两枚命名错的臂留下的。还原顺序照 #471：`appearance light` → `shutdown` → `boot` → `bootstatus -b`。
