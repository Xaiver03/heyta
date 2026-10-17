# r119 · 已同意联网 + 已同步的态下走「注销账号」——`eraseLocalData()` 那一半的装机读数

**结论：这一半成立了。** 注销走完之后，组件存储被清空、卡面退回占位、本机明文库整枚消失、
服务端账号变成 tombstone，而且**十秒之后没有被重新发布**。
台账 973 那格「不证 #1」（r117 页）到此有读数了。

## 出处（每次现读，别抄这里）

```bash
adb -s emulator-5554 shell dumpsys package com.heyta | grep -E 'versionName|lastUpdateTime'
git -C . rev-parse HEAD          # 读数当时那枚，见下面两张 card-*.json 的 device.head
ls apps/mobile/evidence/ux-final-20261017/android-widget-closure-r119/leg*.sh
```

- 被测包：`versionName=1.0`、`lastUpdateTime=2026-10-17 13:26:21` ⇒ **r118 那趟四端重装装进模拟器的当前产物**，
  不是 10-16 那枚旧包（r117 的读数属于旧包，这一页的属于当前产物）。
- 读数当时的载体 HEAD：`96baa43a`（读卡 before）→ `7ccbea8c`（读卡 after）—— 中间别的会话推走过几笔，
  **被测包没有跟着重打**，所以这一页所有读数都属于 13:26:21 那一枚包。
- 载体：共享模拟器 `emulator-5554`。服务端：本机隔离栈 `PORT=4520` + 库 `heyta_uxr119` +
  TEST_MODE 账号 `mobile-e2e-1792221162@example.com`（只为本趟造，收尾已 `dropdb`）。
- 数据：本趟自己种的 4 条（`L119UrgentImportant` / `L119Urgent` / `L119Important` / `L119Plain`），
  组件实例 `appWidgetId=27`（`TodayWidgetProvider`，四枚里只挂这一枚）。
- 主证据：`leg1.txt`、`leg1b.txt`、`leg2.txt`、`leg3.txt` + `card-before.png` / `card-after.png`（两张都人眼看过）。

## 起点态是**四枚独立计数器**，不是界面回读

| 那一样 | 怎么证的 | 读数 |
|---|---|---|
| 设备已同意联网 | `sqlite3 …/heyta-device-prefs.sqlite 'select value from device_pref where key="privacy.consent"'` | `{"decision":"accepted","decidedAt":"2026-10-17T07:14:54.910Z"}` |
| 会话是真的、**数据真的推上去了** | `psql -d heyta_uxr119 -c 'select count(*) from operations'` | `0` → **`9`**（`user_sync_state` 同步 `0`→`1`） |
| 卡上有真任务 | `card-before.png` 人眼 + `card-before.json` 的 `card_texts` | `2026-10-17 · 0/2` / `○ L119UrgentImportant` / `○ L119Urgent` |
| 组件存储非空 | `stat` + `grep -o` 在设备现读 | `15:40:36 \| 1269 B \| [snapshot_v1]` |

## 注销走完之后（`leg2.txt` 第 4 段，同一套尺再量一次）

| 尺 | 注销前 | 注销后 | 十秒后再读 |
|---|---|---|---|
| 组件存储 `heyta_widget.xml` | `15:40:36 \| 1269 B \| [snapshot_v1]` | **`15:42:58 \| 65 B \| 键=（空）`** | 仍是 `65 B /（空）` ⇒ **没有被重新发布** |
| 本机明文库 `heyta.sqlite` | `mtime=15:41:18 \| 81920 B` | **文件不存在** | 仍不存在 |
| 服务端 | `operations=9 sync_state=1 users=1 tombstones=0` | **`operations=0 sync_state=0 users=0 tombstones=1`** | 同 |
| 卡面 | 两条 L119 任务 | **「打开 Heyta 以显示内容」** | 同（`card-after.png`） |
| 界面回的那句 | — | 「账号已注销，这台设备上的本地副本也已清除」（`DONE_BRANCH=1`） | — |

⇒ 注销这条路上，`eraseLocalData()` 与组件清理**在装机包上是连在一起发生的**，
而且清完之后卡不会自己长回来 —— 因为本机已经没有东西可发布了。
这正好接上 r117 第 3 节那条"每次冷启动只要本机还有任务就重发布"：把本机数据清掉，那条重发布就没有输入了。

## 三条附带读数（都是量出来的，不是推的）

1. 🔴 **注销不会撤回设备级的隐私决定。** 走完全套擦除之后 `device_pref` 里那两行**原样还在**
   （`privacy.consent = accepted`、`decidedAt` 还是点下去那一刻的 `07:14:54Z`）。
   这是不是缺陷属产品口径（"这台设备能不能对外通信"与"这个账号的数据"是两件事，留着说得通），
   本线只登记形状、不代拍。
2. ⚠️ **「我的」那一行在已同步的态下仍写「还没登录」**：同一时刻 `operations=9`、状态那行已经是「已是最新」。
   看着像"自托管会话不算 heyta 账号登录"的有意区分（那一行讲的是官方账号），
   但**本趟没去证它**，只登记成待查：要判它得读 `ProfileScreen` 那一行的条件，不在设备读数里。
3. 🔴 **`configure_sync_credentials` 那句「✅ 界面认为已配置」是假绿。** 本趟第一跑
   （`leg1.txt`）里它和「❌ 访问令牌 没填进去」同时出现，而服务端 `operations=0` ——
   也就是说那枚 green 判的是表单态，不是"有没有真的同步上"。
   第二跑（`leg1b.txt`）三枚字段都填上了，它照样在 `operations` 还是 0 的时候报绿。
   ⇒ 这一腿从此把"登录成没成"的闸门换成**服务端收到东西没有**（`leg1b` 第 2 段就是那枚判据，它当场红过一次）。

## 这一页**不证**的事

1. **不证「清除本机保存的凭据」那一枚在冷启动态够得着** —— 那是 r117 量到的另一条缺陷，
   本趟没碰它（改点在别的会话在飞的那份文件里）。
2. **不证「原生拒绝 / 刷新失败有真实失败结果」** —— `widget-cleanup-pending` 那一枚本趟又没被触发，
   它的证据仍只有 vitest + Kotlin/TS 源码链，不是设备读数。
3. **不证另外三枚 provider**（清单 / 习惯 / 专注）在注销后同样退回空态 —— 本趟只挂了 `TodayWidgetProvider` 一枚。
4. **不证 iOS / macOS / Windows 三端**的对应行为。
5. **不证冷启动之后**卡会不会再被填上：注销之后应用被 `force-stop` 过（收尾第 3 段），
   起回来时本机已无数据，所以"没长回来"这一条只覆盖到"注销后立刻"那一档。

## 装置事实（下一趟别再踩）

1. 🔴 **端到端口令只放内存**（界面上那行原话：「只存在内存里，应用重启后需要重新输入」）。
   ⇒ 造"已同步"态的那几腿**一律不许 `force-stop` / `pm clear`**，杀进程等于把被测前提抹掉，
   症状是同步状态那行变成「还没设置端到端加密口令，同步已停止」而三个输入框看着都满的。
2. ⚠️ **同步不是填完立刻发生的**：`leg1b` 那 60 秒窗口内 `operations` 一直是 0，
   窗口过后才涨到 9。判"有没有登录上"要么把窗口放到分钟级，要么主动触发一次同步再看。
3. ⚠️ **口令那格是 `secureTextEntry`，dump 里只有 `•••••`** —— 能证明"字段里有内容"，
   证明不了"内容对"。真正判它对不对的只有服务端收不收得到东西。
4. ⚠️ **桌面 favorites 不在 `launcher.db` 里**：`sqlite3 …/launcher.db '…favorites…'` 报 `no such table`，
   在册的 `widget-data-leg.py` 走的是 content provider（`content://com.google.android.apps.nexuslauncher.settings/favorites`）。
   本趟收尾也走那枚 provider：`content delete --where "_id=7 AND appWidgetId=27"` → 现量命中 0。

## 收尾（`leg3.txt`，逐条都有读数）

- 本趟绑的桌面实例收掉了：`_id=7 / appWidgetId=27` 删 → `force-stop` 桌面 → 再查命中 **0**；
  删之前现量"组件行 1（共 7 行，其余是 `appWidgetId=-1` 的系统图标）"，那 6 行没动。
- 设备级隐私同意恢复到"全新安装后没点过任何一边"：删两行 → `device_pref` 行数 **0** →
  重起应用现读同意卡又立起来了（`在使用联网功能之前` 命中 1）。
- 本趟造的数不需要逐条删 —— 注销那一步把本机库整枚清了（`heyta.sqlite` 文件不存在）。
- 栈已停（`✅ 服务端已停止 pid 96371`）、`4520` 无监听、库 `heyta_uxr119` 已 `dropdb`（`psql -lqt | grep -c uxr` = **0**）、
  应用 `force-stop`（`pidof` 空）。

## 复跑

```sh
cd <仓库根>
createdb heyta_uxr119 && (cd server && DATABASE_URL="postgresql://$USER@127.0.0.1:5432/heyta_uxr119" sh scripts/migrate-deploy.sh)
mkdir -p ~/heyta-r119-leg && PORT=4520 HEYTA_E2E_DB=heyta_uxr119 \
  HEYTA_E2E_TOKEN_FILE=~/heyta-r119-leg/token.txt HEYTA_E2E_EMAIL_FILE=~/heyta-r119-leg/email.txt \
  HEYTA_E2E_E2EE_FILE=~/heyta-r119-leg/e2ee.txt bash scripts/mobile-e2e-up.sh
cd apps/mobile/evidence/ux-final-20261017/android-widget-closure-r119
bash leg1-login-consent-seed.sh && bash leg1b-relogin-server-gate.sh && bash leg2-closure-consented.sh && bash leg3-closeout.sh
```

⚠️ `mobile-e2e-up.sh` **不会**建库也不会迁移 —— 库不存在它直接红（这一趟第一次就是这么红的）。
⚠️ 脚本里的落点写的是本机绝对路径（`/Users/rocalight/heyta-r119-leg`），换机器要改三处。
