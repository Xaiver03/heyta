# r117 · 装机态「清理数据 / 清凭据」× 系统小组件是否继续展示旧任务

## 出处（每次现读，别抄这里）

```bash
adb -s emulator-5554 shell dumpsys package com.heyta | grep -E 'versionName|lastUpdateTime'
git -C . rev-parse --short HEAD          # 读数当时那枚
ls apps/mobile/evidence/ux-final-20261017/android-widget-erase-r117/*.sh
```

- 被测包：`versionName=1.0`、`lastUpdateTime=2026-10-16 17:08:39`（**装机包，不是 debug 壳**）。
- 读数当时的 HEAD：`f89d7e38`（同一趟里 HEAD 从 `5205328c` 一路被别的会话推走；**被测物没有跟着重打**，
  所以这一页所有读数都属于 10-16 17:08 那一枚包，不属于任何后来的 HEAD）。
- 载体：`emulator-5554`（共享模拟器）。服务端：本机隔离栈 `PORT=4520`、库 `heyta_uxr117`、
  账号 `mobile-e2e-…@example.com`（TEST_MODE 造的，只为本趟）。
- 数据：本趟自己种的 3 条（`L117Urgent` / `L117UrgentImportant` / `L117Plain`），组件实例
  `appwidget id 26`（`TodayWidgetProvider`，四枚里只挂了这一枚）。
- 主证据文件：`erase-leg2.sh`+`erase4.txt`、`closure-leg.sh`+`closure.txt`、
  `wipe-reachable-leg.sh`+`wipe-reachable.txt`、`card-*.png` / `card-*.json`。

## 台账那一格问的是什么

> 清理数据后系统小组件不继续展示旧任务；验证原生拒绝/刷新失败有真实失败结果。

这一句里"清理数据"在产品上有**两条不同的路径**，本趟把两条都量了，而且它们的结果不一样：

| 路径 | 界面上是哪一枚 | 它清什么 |
|---|---|---|
| 清凭据 | 「清除本机保存的凭据」 | 内存凭据 + **组件快照与设备密钥**（决策 D6） |
| 清数据 | 「注销账号」 | 云端账号 + `eraseLocalData()` 本机明文 + 同上 |

## 读数

### 1. D6 那条契约本身：在**可达态**成立 ✅

`wipe-reachable-leg.sh`（本次会话里刚配完凭据 ⇒ 表单那两格有值 ⇒ 那一枚是 enabled 的）：

| 计数器 | 点之前 | 点之后 |
|---|---|---|
| 那一枚自己的节点 | `class=Button enabled=true clickable=true bounds=[42,1043][1038,1159]` | `class=Button enabled=false`（`form.clear()` 之后回到灰态） |
| 组件存储文件 | `10:16:51`、**1275 B**、键 `[snapshot_v1]` | `10:24:43`、**65 B**、键 `[（空）]`（全文就是 `<map />`） |
| 界面有没有「小组件还没有清除」 | — | 没有 |
| 组件卡 | `['2026-10-17 · 0/2','○ L117UrgentImportant','○ L117Urgent']` | `['打开 Heyta 以显示内容']`（`card-reachable.png` 人眼复核：白卡上只有这一行占位，没有任何任务） |

⇒ `clearWidgetState()` 的 `WidgetDeviceKeyStore.delete()` + `store.clearAll()` + `pushAll()` 这条链
在装机包上**真的走通了**，旧任务从卡上消失，且没有把失败静默掉。

### 2. 但那一枚在**冷启动后必然不可达** —— 这是一条要报的缺陷 🔴

`erase-leg2.sh` 第 3 步（force-stop → 冷启动 → 走到安全组 → 点那一枚 → 等 8s + 18s）：

```text
[T0 点之前] 按钮 enabled=false clickable=true bounds=[42,1043][1038,1159]
[S1 点之前（启动器发布之后）] 09:51:00 | 1279 B  键=[snapshot_v1]
[S2 点之后]                    09:51:00 | 1279 B  键=[snapshot_v1]     ← 一个字节都没动
[S3 点之后 +18s]               09:51:00 | 1279 B  键=[snapshot_v1]
界面上没有「小组件还没有清除」
[读卡 wipe2] 卡上文字=['2026-10-17 · 0/2','○ L117UrgentImportant','○ L117Urgent']
```

成因写在代码里，两处一拼就是它：

- `apps/mobile/src/sync/config.ts` 文件头那条取舍：**凭据刻意只放内存、不落盘**
  ⇒ 冷启动后 `readSyncConfig()` 必然是 `undefined`，表单初值必然是空。
- `apps/mobile/src/screens/SettingsScreen.tsx:707` 那一枚的闸门是
  `disabled={form.token === '' && form.password === ''}` —— **判的是"表单草稿里有没有字"**，
  不是"这台设备上有没有东西要清"。

于是：组件快照（`heyta_widget.xml`）、设备密钥（AndroidKeyStore）、本机任务（`heyta.sqlite`）
**三样都跨进程活着**，而唯一一条承诺清掉它们的入口在冷启动后是灰的。
`credential-wipe.ts` 文件头写的那句后果 ——「主屏和锁屏上会**继续显示上一个账号的任务**，
而且没有任何报错」—— 正是这一格读到的形状。

⚠️ 这一格**不在本线代改**：`SettingsScreen.tsx` 现在有别的会话在飞
（`git status --porcelain` = `M`，52 增 19 删，且那枚 diff 没碰这一行），
按边界「不代改别线在飞文件」只登记不代改。

### 3. 冷启动会**重新发布**一次快照（第 2 条的一半成因）

存储文件的 mtime 序列（每一枚都是一次 `launch_app` 之后）：
`09:29:48` → `09:51:00` → `09:59:33` → `10:01:29` → `10:02:56` → `10:12:52` → `10:16:51`。
其中 `09:51:00` 与 `10:11` 那两次应用是**没有凭据**的（10:11 的「我的」页原文：
「账号 | 还没登录 | 不登录也能使用任务、专注和本地回顾。」）。

⇒ 发布那条链只看 `materializedState(host)`（本机数据），不看有没有账号。
所以即便第 1 条清成功了，**下一次冷启动只要本机还有任务，卡又会填上** ——
"清一次就再也不显示旧任务"这句不能从本趟读数里推出来。
（这是本地优先的有意行为还是漏判，属产品口径，本线不代拍。）

### 4. 「注销账号」那一趟：被隐私同意闸门挡住，**没走到擦除**

`closure-leg.sh` 走完了整条流程（注销屏开了 → 勾选项勾上 → 提交 → 第二层确认点了第 1 枚），
界面上回的是这一句（`closure.txt` 原文）：

> 你还没有同意这台设备的隐私规则，所以一个请求都没发 —— 账号还在，本机数据也没动。

存储文件当时 `10:12:58 | 1275 B | [snapshot_v1]`，卡上仍是那两条 L117 任务。

⇒ **正面**：未同意时它一个请求都不发、不动本机数据，而且把这件事说在明面上（不是静默失败）。
⇒ **未证**：`eraseLocalData()` 之后组件到底清不清 —— 本趟没走到那一步（要把这台设备的隐私同意
从"没问过"翻成同意联网；那是对外合规口径的一格，**本趟那几条腿没翻**）。
⚠️ 这句"没翻"只覆盖上面那几条腿：本线当天晚些时候那枚复验探针**替我翻了**，因为它调了共享导航里
默认点「同意并联网」的那一支。逐字见下面第 5 节与 [`consent-side-effect.txt`](consent-side-effect.txt)。

### 5. 在**当前产物**上复验那一枚按钮（r118 重装之后，`probe-on-current-build.sh`）

上面第 2/3 节的读数是在 10-16 17:08 那枚包上取的。第七趟四端重装（`25f544bd` 载体，`REINSTALL_RC=0`，
见 `apps/web/evidence/ux-final-20261017/reinstall-r118/`）把 Android 换成了当前产物，这枚探针专门去复验一句话：
**"冷启动后这一枚是 disabled"是不是旧包的读数。**

被测物身份（探针日志第一段，现量）：
```
versionName=1.0   lastUpdateTime=2026-10-17 13:26:21   HEAD=25f544bd
组件存储：2026-10-17 13:26:30.895032696 +0800|501
```
读数（同一枚 `button_state()`，走的是本线维护的 `scripts/lib/mobile-e2e.sh` 导航）：
```
[当前包 / 冷启动 / 未登录] class=Button enabled=false clickable=true
[当前包 / 冷启动 / 未登录] class=TextView enabled=true clickable=false
这一屏的身份锚（有「注销账号」这一行才说明真到了安全组）：1
```
⇒ **不是旧包读数**：当前产物上同样 `enabled=false`，而锚点证明真走到了安全组那一屏。
⇒ 台账那一格"可达态成立、入口够不到"这半句，在 r118 的包上照样成立。
⇒ 顺带一条：全新安装之后组件存储**又有了 501 B**（`13:26:30`，装机那一刻），
与第 3 节那条"每次冷启动只要本机有任务就重发布"是同一个方向。

⚠️ 这一趟的**副作用**（我原先没料到，所以本页第 4 节那句话当时写窄了）：探针调了
`dismiss_welcome_if_present`，而它**默认点「同意并联网」**（`scripts/lib/mobile-e2e.sh:945`，
上面 929-942 行把这条默认值的理由与覆盖方式写清楚了 —— 不是 bug，是我这枚探针该点名没点名）。
于是这台共享模拟器被写进了一条设备级隐私决定。改前/改后读数、恢复命令与正面验证在
[`consent-side-effect.txt`](consent-side-effect.txt)；恢复之后已量到 `device_pref` 行数 **0**、
重新起应用**同意卡又立起来了**（与刚装完那一刻同形）。

## 收尾（共享载体与本机都回到原状）

- 本趟造的数逐条删掉：`LEG_PREFIX=L117 … cleanup` → **整族删掉 4 行**、习惯也删了、专注未在跑
  （`{'tasks': 4, 'habit': True, 'focus': 'not-running'}`）。
- 本趟绑的那枚桌面实例收掉了：删 launcher favorites `_id=7`（`appWidgetId=26` 那枚，
  逐行现量确认其余 6 行都是 `appWidgetId=-1` 的系统图标，没动）→ `force-stop` 桌面 →
  再查 `appWidgetId=26` 命中 **0**。
- 应用语言读回中文：`heyta_widget_preferences.xml` 里 `locale=zh-CN`。
- 本机隔离栈已停（`mobile-e2e-down.sh` 用本趟自己的 pidfile，`✅ 服务端已停止 pid 91219`）、
  端口 `4520` 现在无监听、本趟那枚库 `heyta_uxr117` 已 `dropdb`（`psql -lqt | grep -c uxr117` = 0）、
  `/tmp/heyta-r117-*` 与本趟 pidfile 已删、应用 `force-stop`。
- 中途那枚抢焦点的 Google 相机权限弹窗点了「不允许」—— 那是**别的应用**的弹窗，
  本趟没有为 heyta 申请或改动任何权限。
- ⚠️ 更正一条：上面那句"没有改动任何权限/决定"**不覆盖设备级隐私同意**。第 5 节那枚复验探针
  经共享导航的默认值把 `privacy.consent` 写成了 `accepted`，已在 14:57 删行恢复
  （`device_pref` 现读 0 行、重起应用同意卡再立），逐字见 `consent-side-effect.txt`。

## 这一格现在还不证的四件事

1. **不证**「清理数据后组件不展示旧任务」这条整体：可达态只证了**清凭据**那一半，
   注销/擦库那一半被同意闸门挡住（第 4 节）。
2. **不证**冷启动重发布之后组件会不会显示**另一个人**的任务：本趟全程同一个账号、同一批数据。
3. **不证** iOS / macOS / Windows 三端组件的对应行为（Android 四枚 provider 里也只挂了 Today 这一枚）。
4. **不证**「原生拒绝 / 刷新失败有真实失败结果」那一半的**装机态**形状：
   `widget-cleanup-pending` 那一条在本趟没有出现，也就没被装机态触发过；
   它现有的证据仍是 23 条 vitest + Kotlin/TS 源码链，不是设备读数。

## 装置事实（下一趟别再踩）

1. 🔴 **一枚 disabled 的 RN Button 在 uiautomator 里仍然是 `clickable="true"`**。
   本线那套 `texts()` 打印的 `⟨可点⟩` 标记就是按 `clickable="true"` 判的 ——
   于是它把一枚灰掉的按钮报成"可点"，我据此在台账里作废过一次"这一枚够不到"的正确怀疑。
   读数要么打**这一枚 Button 自己的 `enabled`**（`button_state()` 那两段），
   要么别看 `⟨可点⟩`。内层 `TextView` 更误导：它永远 `enabled=true / clickable=false`。
2. 🔴 **共享模拟器上会冒出别的应用的系统弹窗抢焦点**。这趟是
   `com.google.android.permissioncontroller/…GrantPermissionsActivity`（Google 要相机权限），
   它一在场，`uiautomator dump` 回的就是**那个窗口**的树（189 枚节点、整棵树里没有「设置」），
   于是"设置入口不见了"看着像产品缺陷。判据：读卡/读树之前先看 `mCurrentFocus` 那一行
   （`widget-data-leg.py` 的 `focus_owner()` 已经是这个形状），别拿"树里没有"当结论。
3. ⚠️ **`scroll_to_rid` 只滑 5 下**（`scripts/lib/mobile-e2e.sh`）。本趟把预算放到 12 下之后
   **第 1 下就命中** —— 所以"5 下不够"这个假设被本趟自己的读数否证了，真因是第 2 条。
4. 🔴 **设备级隐私同意不在 `shared_prefs` 里，在三计数器判据看不见的地方**：
   它是 `/data/data/com.heyta/databases/heyta-device-prefs.sqlite` 的 `device_pref` 表里
   那枚 `privacy.consent` 行（值是一段 JSON，键名来自 `packages/app-host/src/privacy-consent.ts`
   的 `PRIVACY_CONSENT_KEY`）。本趟那套"存储文件 mtime/大小/键"三计数器只盯 `heyta_widget.xml`，
   所以**它写没被写过，本趟的判据一个都读不到** —— 这条要在任何"我没动过设备状态"的自述之前先量一次
   `select key,value from device_pref`。
5. 🔴 **共享导航 `dismiss_welcome_if_present` 默认点「同意并联网」**（`scripts/lib/mobile-e2e.sh:945`
   的 `${CONSENT_GATE_PREFERRED:-同意并联网}`）。被测**本地**行为的腿要在调用它之前
   `export CONSENT_GATE_PREFERRED=只用本机`（`reminder-ring` / `schedule` / `timeline` 三处已经这么点名了）。
   本趟第 5 节那枚探针没点名，于是替这台共享设备做了一次隐私决定，事后按 `consent-side-effect.txt` 恢复。
   登记这条是为了别让下一趟照抄我这次的错误归因。
4. ⚠️ `configure_sync_credentials` 第一行是按**写死坐标** `945 2253` 点「我的」，
   既不 `dismiss_welcome_if_present` 也不回读切过去没有。冷启动落在同意层/任务页时那一下打在别处，
   随后报「找不到 profile-entry-settings」。本线在册的第 21 处写死坐标（待办 #68）还没清掉它。
   本趟的绕法写在 `login-leg.sh` 第 1 步那段注释里（先 `launch_app` + 关面板 + 切 tab 再交给它）。
5. ⚠️ 组件卡"点一下没反应"这件事**不能只靠卡上文字判**：本趟用存储文件那三个数
   （mtime / 字节数 / 键在不在）当第一计数器，因为它绕过了启动器那层 RemoteViews 缓存。
6. ⚠️ **`logcat` 在这一枚 release 包上不是可用的计数器**：`erase-leg2.sh` 那趟整程抓了
   9859 行，`grep -iE "widget|credential|HeytaWidget|ReactNativeJS"` 只回系统噪音
   （`AppWidgetServiceImpl` / `AconfigPackage` / 输入法），**`[widgets] 清除凭据时没能清掉小组件状态`
   那行 JS 警告一条都没有** ⇒ 装机包的 `console.warn` 没被送到 logcat。
   下一趟别把它当"跑了但失败了"的证据；能用的计数器是上面那三个数 + 界面上那一句提示。
   （本趟那份 `logcat.txt` 因此没有入库，只留了这个结论。）
