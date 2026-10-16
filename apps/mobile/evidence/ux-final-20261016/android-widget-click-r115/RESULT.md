# r115 · 装机态「用手指点组件卡片」的回写腿（活着 / 被杀两种杀法）

补的是 `../android-widget-data-r114/RESULT.md` 不证清单里那一条：
**卡上那个 `○` 点下去，到底会不会真的写一条完成状态**。r114 那一趟只往卡上"看"，没往卡上"点"。

## 出处（读数离开这一段就不许引用）

- **被测物**：装在 `emulator-5554` 上的那枚 APK —— `versionName=1.0`、
  `lastUpdateTime=2026-10-15 13:39:08`（逐趟首行现量，见 `run3.txt` / `run4.txt` / `run9-cleanup.txt`）。
  🔴 所以这一趟证的是**装机态那枚包的行为**，不是"当前源码的行为" —— 本轮 HEAD 之后的 widget 源码改动没进这枚包。
- **哪棵树**：装置在跑的那一刻读 `git rev-parse --short HEAD`，逐趟首行不同
  （run3=`8feec99d`、run4=`f6419c05`、run9=`d2dd3dc6`）⇒ 主检出这一小时里被别的线动过三次，
  **这三枚都不是"只含 HEAD 的隔离载体"**，读数只能归给上面那枚 APK，不能归给任何一棵树。
- **装置**：本目录 `widget-data-leg.py`（相位 `seed` / `click` / `killed` / `cleanup`，前缀 `LEG_PREFIX=L115`）、
  `killed-control-arm.py`（对照臂）、`queue-arm.py`（`am kill` 那一档）。
- **数据**：`L115UrgentImportant`、`L115Urgent` 两条（今天视图里正好占两行）。跑完已删净，见下面"收尾"。

## 读数一：进程活着 —— 点一下约 3s 卡上出现 `✓`，而且是持久的

`run3.txt`（相位 `click`，① 那一半）：

```
[今天的任务] 绑住 落点=(540,700) 新表行=[7] host widgets.size=1 provider=['com.heytamobile.widget.TodayWidgetProvider']
[点卡片] 未点：['○ L115UrgentImportant', '○ L115Urgent']
  点之前 com.heyta 进程在不在：True
  点了 (371,533) ← 行 '○ L115UrgentImportant' bounds=(346, 500, 981, 566)
  [click-alive] 约 3s 时出现 ✓：['✓ L115UrgentImportant', '○ L115Urgent']
```

- 点的是那一行**最左边 25px**（`○` 那枚符号位），不是标题 —— 标题走的是另一条意图（打开应用）。
- **只改了点的那一行**：同一屏另一行仍是 `○`，所以两行各自的 `PendingIntent` 没串台
  （`WidgetClicks` 类注释里"只放 extras 会被判成同一枚 PendingIntent"那条红线，这一趟是一枚正面读数）。
- 图：`click-alive-after.png`（打开看过 —— 表头 `2026-10-16 · 1/2`，第一行带勾、第二行空心）。
- 第二次独立样本在 `run4.txt` 的 ③：点 `○ L115Urgent` → 约 3s 出现 `✓`。

## 读数二：`am force-stop` 之后 —— 组件不再渲染那一行，所以"已杀状态点 ○"这一问量不到

`run4.txt`（相位 `killed`）+ `state-killed-now.png`：

```
[已杀腿] 起点：host widgets.size=1 provider=['com.heytamobile.widget.TodayWidgetProvider'] 实例 id=['23']
  杀之前读到的行：[]（进程在不在：False）
  14:49:23 force-stop 之后（进程在=False，实例仍在=1）组件读到 0 行：[]
  原地空点 (371,599) ← 杀之前那一行 '○ L115Urgent'
  空点 6s 后读到 2 行：['✓ L115UrgentImportant', '○ L115Urgent']
  应用起来之后 14:49:48：等了约 3s，组件恢复成 2 行
  b) 那一次空点的结果：未生效（恢复时那一行仍是 ○）
```

- **实例还在**（`dumpsys appwidget` 的 `Widgets:` 段 `id=23`、`widgets.size=1`、`zombie=false`），
  但桌面上那格渲染成**一张只有居中一枚 `h` 图标的空白卡**（`state-killed-now.png`；
  无障碍树里那一块 0 个文本节点，35 个节点全是日期/图标/ dock）。
- 空白**不是闪一下**：14:43 杀 → 14:49 起点仍读到 0 行，中间没有任何交互 ⇒ 至少持续 6 分钟。
- 空白期间点它 ⇒ 约 6-8s 后组件带着**持久化后的读数**回来、进程被带起来，
  但**那一次点没有打卡**（那一行仍是 `○`）：卡片整体那枚意图是"打开应用"，行级的 toggle 意图随着行一起没了。
- 对照臂 `run6-control-arm.txt`（这格必须有，否则上面那句只是"一次相关"）：

  ```
  14:52:25 杀完：进程在=False 读到=[]
  14:52:37 不点、只等第 1 次（+10s）：进程在=False 读到=[]
  14:52:49 不点、只等第 2 次（+20s）：进程在=False 读到=[]
  14:52:49 点了 (371, 599)
  14:52:57 点完 +6s：进程在=True 读到=['✓ L115Urgent', '✓ L115UrgentImportant']
  ```

  ⇒ "不点只等 20s"不会自己回来，"点一下"才回来 —— 这一条有对照。

## 读数三：`am kill`（只杀进程、不设 stopped 标记）—— 点击不丢，约 5s 回写，且全程没打开应用

`run8-queue-arm.txt`。这一档才是 `WidgetIntentQueue` 那条腿在装机态上的正面读数：

```
14:59:26 起点：pid=15740 读到=[('✓ L115UrgentImportant', …), ('✓ L115Urgent', …)]
14:59:26   点 （先取消）✓ L115UrgentImportant 的符号位 (371,533)
14:59:34   取消之后：[('○ L115UrgentImportant', …), ('✓ L115Urgent', …)]
14:59:38 am kill 之后：pid=None 组件读到=[('○ L115UrgentImportant', …), ('✓ L115Urgent', …)]
14:59:40   点 ○ L115UrgentImportant 的符号位 (371,533)
14:59:45   点完约 3s：pid=16164 读到=[('✓ L115UrgentImportant', …), ('✓ L115Urgent', …)]
```

- 🔴 **和读数二对照着看**：`am kill` 之后组件**照常渲染、照常可点**；`am force-stop` 之后退化成空白占位卡。
  两种"杀"在装机态组件上不是同一件事 ⇒ 谁再说"进程死了组件如何如何"，要先说清是哪一种杀法。
- 进程死了点下去：约 5s 卡上出现 `✓`，pid 从 `None` 变成 `16164`（广播把进程带起来），
  而 `mCurrentFocus` 始终是 `NexusLauncherActivity` ⇒ **应用界面从头到尾没打开过**。
- 图：`q-before-wake.png`（打开看过：表头已经从 `1/2` 变 **`2/2`**，两行都带勾）。
- 顺带一枚正面读数：**目标状态是幂等的翻转** —— 点 `✓` 会回到 `○`（上面那步"先取消"就是它）。

## 收尾（设备是共享的）

`run9-cleanup.txt`：`整族删掉 4 行；清单顶部「N 项待办」2 → None`、`{'tasks': 4, 'habit': True, 'focus': 'not-running'}`。
本趟那枚实例已按启动器自己那张表收掉（`content delete --where _id=7` + `am force-stop` launcher），
现量 `widgets.size=0`、`itemType=4` 的行 0 枚；15:1x 今天视图读数是「还没有任务」。

## 这一趟不证

- **force-stop 那一档"点击进不进队列"**：量不到，因为那一屏根本没有渲染的行。
  （"stopped 包收不到广播"是平台规则 + `WidgetClicks` 类注释里 `android:exported="false"` 那段，**不是我测出来的**。）
- **空白卡会不会被下一次 `updatePeriodMillis`（1 800 000 ms = 30 分钟）自己救回来**：最长只观测到 6 分钟，没等那么久。
- 意图队列的**形状**（50 条上限、同 `taskId` last-wins、折叠先于截断、drain 失败写回）在 Kotlin/TS 单测里，不在这一趟。
- **iOS / macOS / Windows 的组件点击回写**不在这条腿上 ⇒ 台账「完整四端系统小组件交互矩阵」那一格照旧开着。
- 点击之后**同步到别的端**、以及服务端那一侧的 op 落库：这一趟只看桌面那张卡，没查下游。

## 装置事实（给下一趟，别再踩）

1. `tap_row()` 找不到行就 `SystemExit`，会把**后面三条读数一起带走**（`run3.txt` 就是这么死在 ② 的）。
   已加 `soft=True`：那一屏没有行本身就是读数，不是错误。
2. 本目录**新写的两枚探针各有一处静默失法**，都是把"读不到"变成"没有"：
   ① `subprocess.run(["adb","-s",SERIAL] + args)` 忘了 `shell` ⇒ adb 报 `unknown command`，
   里面既没有 `ERROR` 也没有 `<node`，于是每一格读成 `None`（`run5-control-arm.txt` 整趟作废）；
   ② `bounds` 的字面形状是 `[346,454][981,500]` —— **逗号后没有空格**，按 `[x, y]` 写正则就读成 `[]`，
   看起来完全像"组件空了"（`run7-queue-arm.txt` 那句"这一趟没有对象"就是它；`diag-now.png` 里两行明明都在）。
   ⇒ 新装置第一趟必须先跟一枚**已知状态**对账（这里是对 `state-killed-now.png` 那张图），别直接信它。
3. 空白卡上点一下走的是**卡片整体意图**（把应用叫起来），不是那一行的 toggle —— 行没渲染，行级意图就不存在。
4. `dump("…")` 里 `ERROR: could not get idle state.` 而 rc=0 那一枚（陷阱 **#439**）这一趟又撞到一次：
   专注环在转的时候整屏读不到，靠"换 tag + 认 ERROR"那两条才没读到陈旧同名文件。
