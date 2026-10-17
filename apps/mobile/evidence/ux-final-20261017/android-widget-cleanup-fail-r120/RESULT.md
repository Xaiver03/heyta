# r120：把"组件清理真的失败"注进装机态，量失败横幅与「重试」

台账那一格（`docs/plans/product-ux-optimization.md` 里「清理数据后系统小组件不继续展示旧任务」）
的原话有两半。r117/r119 证的是前半句（成功路径：注销后组件退回空态）。
**后半句「原生拒绝 / 刷新失败有真实失败结果」到 r119 为止只有 vitest + Kotlin/TS 链，
`widget-cleanup-pending` 那一枚锚点从未在装机态被触发过。** 这一趟补的就是那半句。

- 载体：主检出 `HEAD=77383cf4`（`git rev-parse --short HEAD` 现量），
  被测包 `versionName=1.0 lastUpdateTime=2026-10-17 13:26:21`（r118 那一趟装的当前产物，本趟不重装）。
- 设备：`emulator-5554`（Pixel 7 API 34），服务端 = 本机隔离栈 `PORT=4520` / 库 `heyta_uxr120`，
  账号 `mobile-e2e-1792224060@example.com`。
- 三腿：`leg-fail-injection.sh`（注入 + 点清除）→ `leg2-retry.sh`（点重试）→ `leg3-closeout.sh`（恢复原状）。
  日志同名 `.txt`，两屏 dump 是 `ui.before-retry.xml` / `ui.after-retry.xml`。

## 1. 注入点选在设备侧文件权限，零代码改动

`WidgetStore.clearAll()` 里是 `check(store.commit()) { "Widget storage commit failed" }`
（`apps/mobile/android/app/src/main/java/com/heytamobile/widget/WidgetStore.kt:115-119`）。
`SharedPreferences.commit()` 写盘失败返回 false ⇒ 抛 ⇒ 桥接层把失败传出来 ⇒
`wipeCredentialsAndWidgets` 的 `onWidgetError` ⇒ 界面该出横幅 + 「重试」。
所以把 `shared_prefs/` 从 `771` 改成 `555` 就是"原生这一步失败"的物理事件，
不需要改一行产品代码，也不需要 mock。

原始值在跑之前登记进日志第一行（`drwxrwx--x 771 u0_a359:u0_a359`），恢复挂在 `trap … EXIT` 上，
中途红/退出都会改回来 —— 收尾腿第 1 段又独立复量了一次。

## 2. 读数：两头都要，才算那句失败是真的

| 时刻 | 界面 | 组件存储 `heyta_widget.xml` |
|---|---|---|
| T0 注入前 | 按钮 `class=Button enabled=true clickable=true` | `16:02:47 \| 500 B` 键=`[snapshot_v1]` |
| T1 注入态点完 | 锚点 `widget-cleanup-pending` **命中 1**，整句文案在场 | `16:02:47 \| 500 B` 键=`[snapshot_v1]` —— **三个数一个没动** |
| T2 重试之后 | 锚点 **命中 0**、横幅文案消失 | `18:21:04 \| 65 B` 键=`（空）` |

判读：
- **T1 存储没动** ⇒ 那次写盘真的失败了，横幅不是"其实成功了却喊失败"。
  这是本趟唯一一枚能证"失败是真的"的读数，光看横幅不算。
- **T2 存储变 65 B / 键空** ⇒ 撤掉注入后点重试，原生那一步真的重跑并成功了。
  只量 T1 等于只证明"会喊失败"，不证明"重试这条路活着"。
- 界面文案原文（`packages/i18n/src/locales/zh-CN.ts:3556-3558`）：
  失败句 `已退出登录，但这台设备上的小组件还没有清除。请重试。`、
  按钮 `重试清除小组件`、进行中 `正在重试…`。

## 3. 人看图（§6.2 规定一，三张逐张看过）

| 图 | 看到什么 | 判读 |
|---|---|---|
| `settings-banner-injected.png` | 「账号安全」面里，红字整句横幅 + 下面一枚粗体「重试清除小组件」，再下面「清除本机保存的凭据」是灰的 | 失败态渲染正常；灰的那枚是"凭据已没了"的正确后果 |
| `settings-after-retry.png` | 同一屏，红字与重试按钮整块消失，只剩灰的「清除本机保存的凭据」 | 重试成功后界面收回，没有留下半截状态 |
| `home-after-retry.png` | 桌面：**画面里没有任何 heyta 组件** | ⚠️ 这张**不证卡面** —— 桌面那枚实例是 r119 收尾时解绑的（见陷阱 #455），本趟没重绑。卡面的空态读数在 r119 |

看图时看到的一枚候选界面毛病（**只登记，不改**，那枚文件是别线在飞的 `SettingsScreen.tsx`）：
失败横幅渲染在**「加密数据钥匙」那张卡内部**（`SettingsScreen.tsx:711-723` 挂在密钥卡之后），
而它说的是"账号注销后组件没清干净"这件事 —— 读者要滚到与它无关的那张卡里才看得见。
外观上红字 + 粗体按钮能认出来，所以不算阻断，但它和触发它的那两枚动作（注销 / 清除凭据）不在同一张卡里。

## 4. 装置事实（下一趟别再踩）

1. 🔴 **`has_text` 是整节点精确匹配，不是子串** —— 本库 `scripts/lib/mobile-e2e.sh:410`，
   而 411-417 行**自己写着这条警告**（"用精确匹配永远查不到，那会让一条已经出现的冲突被记成没出现"），
   子串要用 `has_sub`。第一腿拿碎片「小组件还没有清除」去查整句，于是打出
   `锚点命中 1 ｜ 文案命中 0 ｜ 「重试」命中 0` 这行**自相矛盾**的读数。
   ⇒ 可复用的形状：**锚点与文案两个探针互相打脸时，先怀疑探针，不是产品**（§7 元规则一）。
2. 🔴 按钮实际标签是 `重试清除小组件`（`mobile.widgetCleanup.retry`），不是「重试」。
   第一腿 `xy_text "重试"` 因此永远定位不到。
3. ⚠️ 第一腿那句 `echo "❌ 界面上没有「重试」可点"` 用的是裸 `echo` 而不是 `bad`，
   所以它**没进 FAIL 计数**，末尾照打 `PASS=5 FAIL=0`、脚本退出 0。
   ⇒ 一条打印了 ❌ 却不计红的分支，比没有判据更糟（§7 元规则二）。第二腿全部改走 `ok/bad`。
4. 共享 helper `dismiss_welcome_if_present` 默认点「同意并联网」（陷阱 #455 同族那条），
   本趟第一腿又把设备级 `privacy.consent` 写成了 `accepted`（`decidedAt=2026-10-17T08:02:54Z`）。
   收尾腿第 3 段按 r119 同一档处理：`force-stop` 后删掉 `device_pref` 里
   `privacy.consent` + `welcome.hasSeen` 两行，行数回到 0，冷启动态复现同意卡
   （dump 里「在使用联网功能之前」命中 1）。
5. 注入到点完之间只 `sleep 8`：注销那两步是异步的，8 秒在本机上够（T1 抓到了横幅），
   但**不保证** —— 第二腿接手时横幅还在（放了 20 多分钟没被撤），
   所以"没抓到"要按"可能只是慢"处理，别当场判产品红。

## 5. 这一趟不证什么

1. 不证**卡面**在重试后退回空态 —— 桌面没有绑定实例（见第 3 节那张 ⚠️）。
   存储层已经空了，卡面的空态由 r119 那张 `card-after.png` 证。
2. 不证 `正在重试…` 那一帧：点完 `sleep 9` 才 dump，中间态已经过去了。
   这一枚只有代码与 vitest 层。
3. 不证其它注入形状（原生侧抛异常、桥接层没注册、组件宿主进程被杀）。
   本趟只证"写盘失败"这一种，而它是 `commit()` 返回 false 那条唯一可见路径。
4. 不证 iOS / 桌面 / Web —— 小组件是 Android 独有。
5. 不证"注销账号"那条入口：本趟走的是「清除本机保存的凭据」那一枚，
   两者共用 `wipeCredentialsAndWidgets`，但这条共用是**读代码读出来的**，不是这趟测出来的。
6. 不证修复：台账里那枚"清理数据后小组件仍展示旧任务"的守卫缺陷（r118 在当前产物上复现过）
   归 `SettingsScreen.tsx` 那一线，本趟没碰。

## 6. 复跑

```bash
# 前置：库要先存在且已迁移（`mobile-e2e-up.sh` 不建库也不迁移）
createdb heyta_uxr120
(cd server && DATABASE_URL=postgresql://…/heyta_uxr120 sh scripts/migrate-deploy.sh)
PORT=4520 HEYTA_E2E_DB=heyta_uxr120 \
HEYTA_E2E_TOKEN_FILE=/Users/rocalight/heyta-r120-leg/token.txt \
HEYTA_E2E_EMAIL_FILE=/Users/rocalight/heyta-r120-leg/email.txt \
HEYTA_E2E_E2EE_FILE=/Users/rocalight/heyta-r120-leg/e2ee.txt \
  bash scripts/mobile-e2e-up.sh
cd apps/mobile/evidence/ux-final-20261017/android-widget-cleanup-fail-r120
bash leg-fail-injection.sh   > leg.txt  2>&1   # 注入 + 点清除（第 6 段那条假红见 §4.2）
bash leg2-retry.sh           > leg2.txt 2>&1   # 点重试（这一腿才是 T2 的出处）
bash leg3-closeout.sh        > leg3.txt 2>&1   # 恢复权限/同意/冷启动，停栈删库删凭据
```

跑完设备侧留下的净改动 = 0（`leg3.txt` 五条读数：权限 771、桌面组件行 0、
`device_pref` 行数 0、冷启动会先看到同意卡、`pidof` 空 + 4520 无监听 + 残留 `uxr` 库数 0）。
