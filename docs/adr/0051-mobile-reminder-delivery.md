# ADR-0051：移动端提醒投递与错过提醒语义

状态：已接受（2026-10-03）

## 决定

移动端使用系统本地通知作为提醒投递器。Android 由 `AlarmManager` + `BroadcastReceiver`
投递，iOS 由 `UNUserNotificationCenter` 投递；不引入第三方通知 SDK。JS 侧只负责把已
物化的提醒排入系统，并在启动/回到前台时回收系统已展示的通知。

`firedAt` 仍是同步事实，只有原生确认通知已经展示（或系统已经交付到通知中心）后，
JS 才通过 `markReminderFired` 写一条普通 `UPD` op。原生层不构造 op，也不直接改 SQLite。
因此同一提醒在多台设备上最终由同步后的 `firedAt` 幂等去重。

启动时先读取系统已展示的提醒，成功写入 `firedAt` op 后再确认删除回执；如果进程在两步之间崩溃，
回执会在下次启动重试。原生排程的标识是稳定的 occurrence ID（`reminderId|effectiveTriggerAt`），
而不是只用提醒实体 ID；这样同一实体的一次补算可以和旧回执、陈旧系统请求区分开。每次
reconcile 都会把不在当前计划中的系统请求取消，再为所有未删除、未 dismissed、未 fired 的提醒重新排程。
已经错过的提醒不静默丢弃：它会以立即投递的本地通知补发，并在原生确认后写入
`firedAt`。任务已删除或 `reminderIsFired()` 判定当前 occurrence 已投递的记录不会排程。旧回执不阻止新 trigger。

`peekDelivered` 是非破坏性读取；只有 `firedAt` op 成功落库后，JS 才以 occurrence ID
调用 `acknowledgeDelivered`。iOS 另外持久化已排程 occurrence ledger：用户若先在通知中心
删除通知，系统 delivered 列表会失去证据，此时 ledger 只能说明“曾排程、投递结果不确定”，
不能把它当作可靠的“用户已看到”回执。iOS 系统最多保留约 64 个待投递请求，因此 iOS
只排最早的 64 个；其余提醒仍保持未 fired，在下一次启动或回前台时继续补排。这个上限
是投递能力限制，不改变同步事实。

通知正文只在端上生成；服务端永远只看加密 op。用户拒绝通知权限时保留提醒为 `due`，
下次授权或启动仍可重试，不能把未展示的提醒标成 `firedAt`。

## 能力矩阵

| 能力 | Android | iOS | 鸿蒙/未知平台 |
| --- | --- | --- | --- |
| 定时投递 | `setExactAndAllowWhileIdle`，无 exact 权限时降级 `setAndAllowWhileIdle` | `UNTimeIntervalNotificationTrigger` | 不宣称支持 |
| 权限 | `POST_NOTIFICATIONS`（API 33+运行时申请） | `UNUserNotificationCenter`授权 | 不宣称支持 |
| 后台回收 | receiver 写入本机 delivered 队列 | 通知中心 delivered 队列 | 不宣称支持 |
| 内容 | 端上解密后的任务标题 | 端上解密后的任务标题 | 无 |

Android 的 `force-stop` 是系统明确的用户阻断操作，会取消/阻止该应用的后台 receiver；产品验收使用
普通进程终止或应用退后台来证明系统投递，不能把 force-stop 后投递作为产品承诺。

降级只影响准点性，不改变数据语义：权限失败或原生模块缺失时提醒保持未 fired，
面板仍能显示 `due`。


## 实施经验与验收边界（2026-10-03 续验）

- **回执是数据，不是依赖到达顺序的 reducer 条件。** 曾尝试在 reducer 中比较当前 trigger，
  不匹配就丢弃 fired op；这种实现会把先于 CREATE 到达的回执永久丢掉。现改为可选
  `firedForTriggerAt` 与 `firedAt` 同写，由领域层按当前 occurrence 判断，保留普通字段版本裁决。
  六种 CREATE/fired/snooze 到达顺序必须收敛；旧数据没有 marker 时保留原义，显式改期时惰性绑定旧 trigger。
- **排程窗口与可见通知分开保留。** `cancelStale(visibleKeepIds, pendingKeepIds)` 的第二组只包含
  当前最早 64 个待排程 occurrence，第一组还保留已 fired 但用户未移除的通知；否则要么回收
  回执后立刻把通知撤掉，要么让窗口外旧请求挤掉更早的请求。
- **权限未决定也不能当成允许。** 共享层只在 granted 时排程；Android 同时检查全应用通知开关
  与频道 importance，完整 occurrence 作为 PendingIntent URI 和 notification tag，不能靠 hashCode 唯一性。
  权限请求完成必须显式再次 reconcile：首次提醒可能先落库、dataRevision 先于授权结果到达，
  Android 权限弹窗关闭也不保证产生 AppState 变化。提醒写入与权限请求并行，拒绝授权不撤销本地意图。
  `apps/mobile/tests/native-reminder-authorization.spec.ts` 分别验证先写后授权、先授权后写、拒绝三种时序。
- **离线写入也必须直接唤醒投递。** `dataRevision` 是同步完成信号，不能替代 `onLocalWrite`；
  本地通知同时订阅“op 成功落库”，否则已有授权时先完成的权限请求与尚未提交的提醒会错过彼此，
  snooze/删除也可能等联网同步才生效。测试在没有同步和 AppState 事件时发本地写信号验证排程。
- **iOS 的不确定结果必须保留为不确定。** 原生原子文件保存 scheduled/posted/receipt；前台展示、
  点击/关闭回调和启动时通知中心读取都能补证据，业务 op 成功后才 ack。已被系统接受、到期后
  却既不在 pending 也不在 delivered 的请求，可能已被用户划走：保留未确认事实、抑制同 occurrence
  自动重复发布，不伪造 fired。用户可通过显式改期创建新 occurrence。
  `peekUncertain` 把本机证据缺失作为共享 ReminderList 的额外说明展示；它按完整 occurrence 匹配，
  不覆盖同步 phase、不写 op，远端 fired/dismissed 或本机 snooze 后旧说明自然失效。
- **平台调用与本地文件没有共同事务。** Android `notify` 与持久 receipt 之间仍有进程终止窗口；
  同步离线设备也无法全局 exactly-once。本实现不承诺用户必然看到、不承诺跨端只响一次。

已验证：Android Kotlin 与 iOS workspace Debug 编译通过；共享层回执失败不 ack、权限未决定
不排程、可见/待排程容量区分与 dirty rerun 均有行为测试；乱序收敛在 op-log 语义测试中覆盖。
`apps/mobile/tests/native-reminder-plan.spec.ts` 还固定了 iOS 容量算法的 65→64 边界：
传入 65 个按时间排序的 occurrence 时，只保留最早 64 个，窗口外 occurrence 不会挤掉更早的
提醒。该测试只证明共享规划器的截断规则，不替代 iOS 系统通知中心的真实 65 条排程验收。
`node scripts/mutate-reminder-delivery.mjs` 已实跑四条臂：删除离线写入唤醒、删除授权完成唤醒、落库失败仍 ack、
按提醒 id 而非完整 occurrence 显示不确定说明，均由对应行为断言抓到；测试初始化失败不算 caught。
该脚本临时改源码，必须与构建独占，逐条 finally 对字节还原，不能与原生打包并发。
**尚未完成**：iOS 权限拒绝/设备重启后的实测、实体设备投递复验、四端重装、全仓最终门禁、
不确定回执说明的真实界面截图验收，以及跨设备 fired 去重和新 occurrence 的原生系统投递复验、
iOS 最早 64 条排程窗口。两台独立 SQLite 宿主经真实 HTTP/PostgreSQL 的回执传播与新 occurrence 调度决策已通过下述集成测试；通知 port 为受控观察器，不能替代 OS 证据。iOS 模拟器已经证明授权、排程、到期前终止进程、启动 reconcile 和
`firedAt` 回执闭环，通知中心对应任务标题也已人工核看；未来提醒取消续验 21/21，目标实体 `DEL` 与 ledger 清理成立，删除后同一详情页截图已人工检查。旧取消失败已定位为验收脚本日期标签不匹配，详见下方续验记录。上述结果不能替代剩余边界；旧失败轮截图不作为成功证据。

当前 C 阶段的边界台账如下；每一项都必须由对应平台/设备的真实证据关闭，不能由 Android 单机结果外推：

| 边界 | 当前状态 | 关闭判据 |
|---|---|---|
| Android 主链、权限恢复、启动补算、未来 pending 取消 | ✅ 已验 | 当前 Release 真 UI、SQLite occurrence 回执与系统 pending/通知证据一致 |
| iOS 模拟器授权、排程、启动 reconcile、未来提醒取消 | ✅ 已验 | 当前 Release 模拟器真实 UI；目标 occurrence 的 `DEL`、AX 行消失、ledger 清理和未伪造 `firedAt` 均成立 |
| 跨设备 fired 去重 | HTTP/PG 与独立 SQLite 已验；原生 OS 待验 | 设备 A 写入某 occurrence 的 fired receipt 后，设备 B 真实下载该 op，并证明不会再次排程/投递同一 occurrence |
| 重复提醒与新 occurrence | 改期、贪睡、每日重复的 HTTP/PG 已验；原生 OS 待验 | 改期、snooze 或下一次重复触发产生新的 occurrence ID；旧 occurrence 的 fired receipt 不阻止新 occurrence 投递 |
| iOS 权限拒绝/重启补算 | 待验证 | 拒绝权限跨过 trigger 不写 fired；重新授权并启动后补发；普通终止/重启后的 iOS 证据分别保留 |
| iOS 系统通知中心与“用户已看到”边界 | 标题截图已验；不确定回执界面待验 | 截图中人工辨认本轮提醒标题；通知被清除或系统证据丢失时只显示不确定说明，不伪造 fired |
| iOS 64 条排程窗口 | 待验证 | 创建至少 65 个 occurrence，证明只排最早 64 条，窗口滚动后下一条进入且不丢失 |

2026-10-04 13:01，`server/tests/integration/reminder-delivery-http.integration.spec.ts` 在真实 PostgreSQL 上 **2/2 通过、零跳过**（1.90 秒）。每例独立账号、两台独立 SQLite 宿主与真实加密 HTTP 同步：先证明 B 确实排程，再由 A 写入 occurrence 回执，B 下载、解密并取消 pending；重开 SQLite 仍不重排。改期、贪睡和每日重复完成经同一真实链路传播，旧回执不会挡住新 occurrence，重复 reconcile 不追加 op。通知 port 是受控观察器，以上证明同步与调度决策，不证明 Android/iOS 系统实际投递。测试已登记在 `server/package.json` 的 PostgreSQL 集成入口中。 `DATABASE_URL=… node scripts/mutate-reminder-delivery.mjs --http` 在隔离副本完成三条反向臂：忽略 fired 重排、取消 pending 接线移除、snooze occurrence 错用原 trigger；三者都命中具名行为断言（AssertionError），不是构建/初始化失败。每臂 finally 逐字还原源码并重建 dist。初轮共用账号使上一例未上传的新回执污染下一例，已改为逐例创建/删除账号；不能靠过滤额外提醒放宽断言。

Android 真链路以设备时钟和时区创建三分钟内到期的提醒，等待 OS 定时投递。创建规则拒绝
早于过去一分钟的触发时刻，因此“给昨天任务点截止时”不会产生提醒 op，不能用来冒充补发验收。
错过提醒应由“先合法创建、之后离线或进程终止跨过触发时刻”的路径单独验证。

2026-10-03 Android 当前 Release 在 `emulator-5554` 的首次系统投递实测成功：真实 UI 创建
`ring-e2e-223047`，触发时刻 22:34，未授精确闹钟时走 inexact fallback，约晚一分钟交付。
回前台后 SQLite 中实际存在 `firedAt` 与匹配的 `firedForTriggerAt` op，原生 receipt 已 ack，
通知仍保留在通知栏。已打开查看 [通知截图](../../apps/mobile/evidence/android-reminder-inexact-20261003.png)。
同轮取消/贪睡脚本因假设回前台必然关闭详情 Modal 而失败，故这轮只证明投递与回执，
不计作完整 C 验收。准点性续验显式授精确闹钟，fallback 的延迟不能伪装成精确投递。

同日 22:40–22:55 的续验使用当前 Release APK 全新安装，在同一无窗口模拟器完成
`verify-mobile-reminder-ring.sh` **11 项通过、0 失败**：真实 UI 创建 `ring-e2e-224036`，
22:44 后台投递；从启动器回应用时通知仍活动，删除提醒后通知撤回；独立提醒贪睡十分钟，
HOME 后用 SIGKILL 终止普通进程，系统 alarm 保留，22:55 仍交付通知；点击通知后应用回前台。
[首次通知截图](../../apps/mobile/evidence/android-reminder-ring.png) 与
[进程终止后的通知截图](../../apps/mobile/evidence/android-reminder-dead.png) 均已打开人工查看，
可见 heyta 与对应任务标题。该轮显式授予精确闹钟和通知权限，不替代拒绝权限、force-stop
或整机重启后的补算判据，也不是 iOS/四端验收通过记录。

随后执行同一安装产物层级的反向验证：临时把 `reconcileNativeReminders` 接成空调度器，
重建 Release 并全新安装；真实 UI 仍成功写入任务与提醒 CREATE，但到期后系统通知判据
明确失败（3 项通过、1 项失败，退出 1）。已查看
[变异通知栏截图](../../apps/mobile/evidence/android-reminder-mutation-disabled.png)，无 heyta 通知；
[变异记录](../../apps/mobile/evidence/android-reminder-mutation.txt) 保留判据与还原说明。
构建结束即逐字恢复源码，再次构建正常 Release；成功轮截图与变异截图分开保存。
因此原计划的“拿掉调度器调用，判据 1 必须转红”已在 OS 层实测，而不只是单元测试。

异常路径复用同一个脚本的真实 UI 建立前置：
`HEYTA_REMINDER_TEST_MODE=permission-recovery` 验证撤销通知权限跨过到期时刻后仍无 fired，
恢复权限并启动后补发；`restart-recovery` 验证 force-stop 与整机重启跨过到期时刻、
明确再次启动后的补发。两种模式均只读检查真实 SQLite 中的 occurrence 回执，不能用
直接插入提醒或调整模拟器时间替代自然到期；实测结果须另行回填，不因有脚本就算完成。

23:29 的 `permission-recovery` 实测 **5 项通过、0 失败**：`ring-e2e-232516` 在
撤销通知权限后自然到期，系统活动通知列表为空、真实 SQLite 中没有 fired op；重新授予
权限并启动后立即补发，回前台后写入与原 trigger 匹配的 `firedForTriggerAt`。
[拒绝权限时](../../apps/mobile/evidence/android-reminder-permission-recovery-before.png) 与
[恢复后](../../apps/mobile/evidence/android-reminder-permission-recovery-after.png) 两张截图均已人工查看。

23:33 的 `restart-recovery` 实测 **5 项通过、0 失败**：`ring-e2e-232936` 在合法创建后
经历 force-stop 与整机重启，自然跨过到期时刻仍无通知、无 fired；明确再次启动应用后补发，
回前台持久化匹配 occurrence 的回执。[启动前](../../apps/mobile/evidence/android-reminder-restart-recovery-before.png)
与 [补发后](../../apps/mobile/evidence/android-reminder-restart-recovery-after.png) 截图均已人工查看。
这个判据证明“再次启动后的补算”，不承诺 force-stop 期间后台投递。

23:39 的 `pending-cancel` 实测 **5 项通过、0 失败**：真实 UI 为 `ring-e2e-233729` 创建
23:41 到期的提醒，`dumpsys alarm` 先确认应用持有唯一 pending alarm，再点击删除提醒；
系统 pending alarm 消失且 SQLite 中没有 fired。[删除前](../../apps/mobile/evidence/android-reminder-pending-cancel-before.png)
与 [删除后](../../apps/mobile/evidence/android-reminder-pending-cancel-after.png) 截图均已人工查看，
分别显示“待触发”的提醒与“还没有提醒”。这是独立于“删除已展示通知”的未来排程取消判据。

本轮把 iOS 真实验收入口固定为 [`scripts/verify-mobile-ios-reminder.sh`](../../scripts/verify-mobile-ios-reminder.sh)。
它会重新构建并安装当前 Release 包，使用 RN 无障碍树创建任务和提醒，终止进程后等待
`UNUserNotificationCenter` 投递，启动时回读 `firedAt`/`firedForTriggerAt`，并在每个关键
断言前保存 `apps/mobile/evidence/ios-reminder-delivery.png`。脚本不能把原生
`schedule` 的返回值当投递证据，也不能直接写 SQLite 或注入 REMINDER op；权限弹窗、
系统通知中心和截图必须以设备真实状态为准。脚本首次真实运行完成后，应把本段的“尚未完成”
逐项改成带日期、设备、Release 产物路径和截图人工观察结果的“已验证”，不能用脚本退出 0
代替人工查看截图。

2026-10-03 的 iOS 验收续验已排除上述夹具误因。`xcodebuild` Release 成功，产物为
`/tmp/heyta-ios-reminder-release/Build/Products/Release-iphonesimulator/Heyta.app`，并完成卸载旧包、安装
当前包、RN UI 建任务和 DatePicker 选日。当前 Xcode 27.1 / iOS 27 runtime 下，Unix-domain companion
确实会报 `GRPCCore.RuntimeError error 1`；同一二进制改用 `--grpc-port 10982` 可用，shim 也支持
`host:port`。这条 TCP fallback 已在真实 AX 树上读到首启联网页、任务 Composer、详情日期网格和提醒按钮。

续验还钉住了三条脚本规则：`idb ui set-value` 后不能先按键盘“完成”再回读，任务 Composer 的
`onSubmitEditing` 会把收键盘误当成提交；详情页必须先 `--scroll-into-view` 再 `set-value`；日期网格的
44px 按钮不能被识别成底部 Tab 的滚动禁区。对应修复已写入
[`ios-ax-shim.py`](../../scripts/tools/ios-ax-shim.py) 和验收脚本，并由 `check-script-snapshot` 登记
[`verify-mobile-ios-reminder.sh`](../../scripts/verify-mobile-ios-reminder.sh)。

2026-10-04 早先的 iOS 真实续验仍**失败，不能宣称 OS 级投递已通过**。当前 Release
`/tmp/heyta-ios-reminder-release/Build/Products/Release-iphonesimulator/Heyta.app` 已卸载旧包后重装，
真实 RN Composer 创建 `ios-reminder-delivery-004726`，详情页通过「今天」和截止时刻输入框写入
`00:50`，再通过「截止时」写入 REMINDER CREATE；SQLite 只读回读到
`triggerAt=1791046200000`，重启 reconcile 后没有 `firedAt`/`firedForTriggerAt`，原生
`Application Support/heyta-reminder-receipts.json` 也没有生成。因此这轮的 17 项前置/边界判据
不能替代缺失的 OS 投递判据。

投递断言前保存的 `apps/mobile/evidence/ios-reminder-delivery.png` 已人工打开；画面是应用自己的
「在使用联网功能之前」隐私选择覆盖层，不是通知中心，也看不到 heyta 通知，故该截图明确记为失败
证据，不能挂成成功截图。下一轮必须先取得真实 `UNUserNotificationCenter` 授权状态/系统权限交互
证据，再重复“到期 → 普通进程终止 → 通知中心 → 启动 reconcile → SQLite receipt”；不能把
`schedule()` 返回值、任务 CREATE 或脚本截图存在当作投递成功。

本轮还固化了两条验收规则：iOS HID `idb ui text` 不能稳定注入中文连接词或带斜杠的整段捕获文本，
会让 Composer 关闭或把文字落进搜索框；日期和时刻验收必须通过真实详情页 DatePicker/截止时刻输入框
设置。Xcode 27.1 / iOS 27 下 Unix companion 可能创建 socket 后返回 `GRPCCore.RuntimeError`，
默认改用同一 `idb_companion` 的 TCP `127.0.0.1:10982`，脚本必须确认键盘确实收起、Composer
字段的占位值确实出现、以及目标按钮 press 后状态真的改变，不能只看 idb 命令退出码。

同日修复并验证了一个真正阻断投递的桥接错误：`HeytaReminderModuleBridge.m` 原先用
`RCT_EXTERN_MODULE(HeytaReminderModule, NSObject)`，实际向 JS 导出的是
`NativeModules.HeytaReminderModule`，而移动端唯一调用方读取 `NativeModules.HeytaReminder`；
因此原生授权与排程方法根本没有被调用。桥接现改为
`RCT_EXTERN_REMAP_MODULE(HeytaReminder, HeytaReminderModule, NSObject)`。修复期间曾用构建日志和系统日志
确认授权与排程调用，生产代码不保留提醒标识或时间日志。修复后的 Release 构建 `/tmp/heyta-ios-reminder-release/Build/Products/Release-iphonesimulator/Heyta.app`
在模拟器 `1EDCFA59-6A9C-428D-8FE2-160B11318648` 上真实复验：日志记录
`requestAuthorization completion granted=true`、`authorizationStatus=2` 和
`schedule completion ... error=none`；`Application Support/heyta-reminder-receipts.json`
出现对应 `posted`/`receipts`，启动 reconcile 后真 SQLite 中出现 1 条同时含
`firedAt` 与 `firedForTriggerAt` 的 REMINDER op。隐私覆盖层也先由真实 AX 点击关闭并复核消失。
这轮证明的是模拟器 OS 投递与回收闭环；实体设备通知权限仍需独立验收，Keychain 也不由这条证据代替。
`apps/mobile/evidence/ios-reminder-delivery-success.png` 只记录回到应用后的任务详情和业务回执，
是辅助证据，不是系统通知中心截图。当时的 `ios-reminder-notification-center.png` 与
`ios-reminder-after-reconcile.png` 未取得可观察的通知中心画面（一次是多显示器模拟器默认的全黑副屏，
一次是锁屏壁纸），因此不能挂作成功证据；脚本现显式选择 `primary` display 并用 `png-stats`
拒绝全黑 PNG，但这只修复取证装置，不能把现有失败截图升级为成功证据；
后续 11:42 的同设备续验已人工看到对应标题，当前截图和裁决见下方 full 模式记录；此前截图不作为成功证据。

2026-10-04 03:56–10:23 的 `pending-cancel` 续验先暴露并修复了验收脚本自身的标签格式错误：宿主
输入使用 `10/4`，而 RN 的实际无障碍标签使用零填充 `10-04`。旧脚本用输入格式寻找删除按钮，
导致 AX 目标缺失；一次 plain press 的 success 不能作为业务写入证据。脚本改为从 ISO 日期生成实际
`MM-DD` 标签，并在点击后回读 AX、SQLite 与原生 ledger。当前 Release 真 UI 续验 **21/21 通过**：
SQLite 先回读目标 occurrence 的 `entityId` 与 `triggerAt`；删除前 scheduled ledger 有 future occurrence；
通过提醒面板 UI 删除后行从 AX 消失，SQLite 对同一 `entityId` 有 `REMINDER DEL` op，且有删除后、
重启前的同一详情页截图（[删除前](../../apps/mobile/evidence/ios-reminder-pending-before.png)、
[删除后](../../apps/mobile/evidence/ios-reminder-pending-after-delete.png)）；重启 reconcile 清空
OS pending 对应 ledger，且没有伪造 `firedAt`。重启后的回应用截图另存为
[pending-after](../../apps/mobile/evidence/ios-reminder-pending-after.png)。

2026-10-04 的 full 模式续验又把 killed-process 边界跑到了真实 SQLite 回执：本轮任务
`task-mut84l15-2-5un25bqh` 的 occurrence 为
`task-mut84l15-2-5un25bqh:1791082380000`；从 SQLite 回读的 `triggerAt=1791082380000`，
App 在 `terminateAt=1791082360426` 被终止，console 会话退出，随后等待到
`1791082380328` 才继续取证；启动 reconcile 后只接受同一 occurrence 且
`firedForTriggerAt=1791082380000` 的 fired op，真实回读通过。该轮的提醒专项 Release 构建日志在
`/tmp/heyta-ios-reminder-build.log`；它是提醒 probe 包，不代表四端重装或全仓 Release 交付。
该轮首次通知中心截图落在 SpringBoard 主屏，不作为成功证据；11:42 的同设备续验修正了
直接 HID/截图命令的 TCP companion 参数，并在系统通知中心人工读到
`heyta / ios-reminder-delivery-105035`。只读 SQLite 对账确认该标题属于上面的
`task-mut84l15-2-5un25bqh`，且回执 `firedAt=1791082383051`、
`firedForTriggerAt=1791082380000`。当前[通知中心截图](../../apps/mobile/evidence/ios-reminder-notification-center.png)
证明该 occurrence 的系统可见性；截图是在 reconcile 后补取，不冒称到期瞬间截图或真实用户已读。
脚本统一了 AX 与直接 idb 调用的 TCP 参数，手势失败判红，截图先清除同名旧文件，避免取证失败仍复用旧图。
系统 AX Button 必须包含本轮标题，详情字段和非空主屏均不能满足这条判据；本轮标题还必须带
进程级唯一后缀，不能只精确到秒，否则快速重跑可能命中通知中心残留的同名旧通知。直接调用脚本中的
helper，在同一系统画面以真实标题正控通过、错误标题负控拒绝。该补强不替代截图人工复核。

为避免同类故障重新出现，`pnpm check:ios-native-bridges` 现在逐项核对 Swift 的 `moduleName()`、
Objective-C bridge 的 `RCT_EXTERN(_REMAP)_MODULE` 导出名，以及 JS `NativeModules` 查找名；构建成功
本身不再被视为原生模块接线正确的证据。

帮助中心的同一轮对账删除了“后台只能靠自建推送”的旧承诺，中英同步说明移动系统本地通知、Android 强停后的补算、iOS 排程窗口和离线多端可能各自提醒。原[提醒文章截图](../../apps/landing/evidence/reminder-capabilities-zh.png)已人工查看；此图证明用户说明已更新，不是 OS 投递证据。 首启隐私面板也须区分服务器推送与本地通知：选择“只用本机”不启动联网能力，但系统授权后的移动端本地提醒仍可用；中英 `common.privacy.consent.localOnlyGuarantee` 已同步移除“任何通知都不投递”的旧暗示。

2026-10-04 专用 iOS 模拟器续验又修正了两类**验收装置**问题，但没有改变产品边界台账：任务详情同时有两张
`DatePicker`，重复的「今天」必须由 AX occurrence 明确选第 0 个（截止日期），并在滚动、重新定位、点击全程保持同一序号；
普通时刻 `TextInput` 改用 `set-value` 后重新拉 AX 值确认，不能把 HID `type-text` 的成功返回当作领域状态已提交。
当前续验受 iOS 27 companion 间歇性 AX 长调用卡住影响，未取得新的 full 通过记录；历史上已通过的
killed-process/通知中心记录仍有效，未完成的权限拒绝、重启补发、不确定回执和 64 条窗口也仍保持待验证。

### 2026-10-04：只读 iOS OS snapshot 探针与 64 条窗口夹具（进行中）

为使后续边界验收能够观察 `UNUserNotificationCenter` 的真实状态，原生层新增了一个专用的
Release 编译条件 `HEYTA_REMINDER_PROBE`。它不是普通 `DEBUG` 路径：探针包仍使用 Release
Hermes bundle，只在专用 xcodebuild 调用中加入
`SWIFT_ACTIVE_COMPILATION_CONDITIONS='RELEASE HEYTA_REMINDER_PROBE'`，并由启动参数
`-HEYTA_REMINDER_PROBE [delayMs]` 触发。探针延迟后只读
`getNotificationSettings`、`getPendingNotificationRequests`、`getDeliveredNotifications`，
以及 `heyta-reminder-receipts.json` 的只读副本，输出授权状态、occurrence ID、trigger 日期和
receipt 摘要；它不调用 `UNUserNotificationCenter.add/remove`，不 ack receipt，不写 op 或 SQLite。
因此它可以在生产 JS reconcile 完成后提供 OS 级观察证据，也不会制造被测事件。

当前已实测：专用 Release 探针包在 iPhone 17 Pro 模拟器
`9DC7F824-00C5-4757-B5E9-2177FAE8CC9A` 编译成功并启动快照，输出
`authorization=granted`、`pending=2`、`delivered=[]`，两个 pending occurrence 的
`triggerDate` 均为 ISO-8601，且与本机 receipt ledger 的两个 `scheduled` occurrence 一致。
这是 OS 观察入口已成立的装置证据，不是 65→64 边界通过证据。

2026-10-04 的 `permission-recovery` 首次真实运行已取得一轮**失败证据**：设备
`9DC7F824-00C5-4757-B5E9-2177FAE8CC9A` 的 Release probe 包真实 UI 创建了
`task-mutn6q7x-2-vhrxw1q7:1791107700000`，首次通知权限弹窗实际点击“不允许”；跨过
trigger 后 probe 快照确认 `authorization=denied`、`pending=[]`、`delivered=[]`，固定的恢复前
截图已保存（画面近黑，仅作失败取证，不能作为 UI 成功证据），
SQLite 没有 fired receipt。该轮最终失败在恢复阶段：脚本的 `App-Prefs` 深链没有把当前
模拟器带到 heyta 的通知设置页，AX 树仍是 Settings 根页，因此无法通过真实 Settings UI
恢复授权；不能把这条失败改写为“恢复成功”。同轮还暴露了 probe 输出的时序问题（启动后
快照文件存在但脚本轮询可能先超时），后续必须用进程/文件双重确认并保留失败截图。

该轮也修复了验收装置的两个真实问题：iOS 27 companion 可读 AX 树且 HID swipe 成功，
但从屏幕折叠线附近开始的 60–90px 短拖不会让 RN ScrollView 滚动；`ios-ax-shim.py`
现在为底部向上滚动保留至少 180px 手势距离。另一个问题是原先按脚本名全局阻塞并发，
会把另一台模拟器的验收误判为当前设备冲突；现在并发门禁按目标 UDID 匹配。

同日 `restart-recovery` 也完成了真实的关机顺序验证：目标 occurrence
`task-mutne7c2-2-amahunx8:1791108000000` 在模拟器关机前已写入 SQLite，设备在 trigger 前
shutdown，跨过 trigger 后再 boot；但该轮 probe 未产出快照，启动后也没有回执，因此仍是失败。
初步假设是 probe 早退后没有维持进程 RunLoop，设备重启后的 `simctl launch` 进程可能立即退出；
该假设尚未被重跑证实。已在 `AppDelegate` 为只读 probe 增加有限时长 RunLoop，必须重新编译并
重跑才能改变台账。该轮固定的
`restart-recovery-before/after` 截图只有载体画面，不能作为成功 UI 证据。

随后使用 `/tmp/heyta-ios-reminder-probe-check4` 重编译并重跑 `restart-recovery`：真实 occurrence
`task-muto7yz3-2-ezsapvj:1791109440000` 在关机状态跨过 trigger 后 boot，顺序判据通过；脚本
仍在 probe 文件写入前结束等待，故没有 recovery receipt，边界继续保持待验证。统一日志随后
确认 probe 最终写出 `authorization=granted`、`pending=[]`、`delivered=[]` 和 scheduled ledger，
说明至少存在 iOS 27 冷启动时序问题；脚本轮询已从 45 秒提高到 120 秒。权限恢复也已从不可靠
`App-Prefs` 深链改为 Settings AX 路径 `App → heyta → 通知、横幅、声音、标记 → 允许通知`。

窗口夹具的 Node 端已使用真实 `@heyta/app-host`、真实 SQLite、真实 HTTP/PostgreSQL、账号
`205` 和 authenticated Vault 参数分两批创建并同步 63 个任务与 63 个提醒；两批 sync 均为
`synced`，上传队列为 0。此前一次单批 126 ops 被服务端 100 ops 上限以 HTTP 413 拒绝，随后按
批次重跑成功。这一结果只证明共享 host 和服务端能供给窗口夹具，不能替代 iOS 下载、生产 JS
reconcile 和 OS pending 列表的 64 条证据。当前 iOS 专用包尚未完成该账号的 UI 登录/同步，故
`iOS 64 条排程窗口`、权限拒绝恢复、重启补算和不确定 receipt 仍保持待验证；不得把本节的
`pending=2` 或共享层 65→64 单测登记为窗口通过。

验收脚本现在把四条边界固定成显式模式：

```bash
HEYTA_IOS_REMINDER_MODE=permission-recovery scripts/verify-mobile-ios-reminder.sh
HEYTA_IOS_REMINDER_MODE=restart-recovery   scripts/verify-mobile-ios-reminder.sh
HEYTA_IOS_REMINDER_MODE=uncertain          scripts/verify-mobile-ios-reminder.sh
HEYTA_IOS_REMINDER_MODE=window \
  HEYTA_IOS_WINDOW_PRESERVE_DATA=1 \
  scripts/verify-mobile-ios-reminder.sh
```

这些边界模式不会把普通 Release 的 JS 启动结果当成系统证据：脚本会为边界模式构建带
`HEYTA_REMINDER_PROBE` 的 Release 包，并通过 `-HEYTA_REMINDER_PROBE` 启动一个不挂载
React Native 的只读进程。这样探针不会在“恢复前”偷偷触发 startup reconcile；它只读
`UNUserNotificationCenter` 的授权、pending、delivered 列表和本地 receipt ledger。权限恢复
必须经过真实系统权限弹窗与 Settings 页面，重启模式必须经过真实 simulator shutdown/boot，
不确定模式必须在通知中心清除本轮通知后仍没有 fired op；任一系统按钮或快照不可见时判红。
`window` 模式要求至少 65 条提醒先经真实同步进入设备 SQLite，并对照 OS pending 集合是按
`triggerAt` 排序的最早 64 条；没有同步夹具时脚本直接失败，不能靠直写 SQLite 凑数。

这些模式已经成为验收入口，但截至本记录时间尚未取得四条新的 iOS OS 级通过证据；运行
模式本身、探针 `pending=2` 和共享层 65→64 测试都不改变上面的边界台账。取得通过证据后，
必须在本节补设备 UDID、Release 产物、截图人工复核结果和 SQLite occurrence 对账，才能把
对应行从“待验证”改为“已验”。

2026-10-04 的 `restart-recovery` 还校准了探针等待边界：真实模拟器完成关机、启动并跨过
`triggerAt` 后，旧的 120 秒 `run_probe` 上限先报“无法读取 OS 快照”，但统一日志随后显示
同一个只读进程写出了本轮 JSON。这个迟到文件不能回填为原轮成功，也不能被解释成通知系统
已失败。脚本现以 `HEYTA_IOS_PROBE_WAIT_SECONDS` 控制等待，默认 240 秒；每次先删除旧文件、
重新启动带 `-HEYTA_REMINDER_PROBE` 的进程，并只接受该次新进程写出的文件，超过上限仍判红。
在拿到新的 OS 级通过证据前，本节四条边界继续保持“待验证”。

同轮第二次对账发现探针写入的真实路径是
`<Data container>/Library/Application Support/heyta-reminder-probe.json`；旧脚本遗漏了
`Library`，因此日志中的成功写入仍无法被 shell 轮询读到。`probe_path()` 已修正为从
`simctl get_app_container ... data` 的 Data 根拼接该路径。以后新增原生探针必须同时核对
Data 根、生产 SQLite 的 `Library` 位置和当前进程写入的文件，并保留旧文件清理；统一日志
只能诊断迟到/路径问题，不能代替本轮 JSON 文件证据。

重启补算还要求把两个异步阶段分开：首次启动可能已经将错过 occurrence 重新排成“立即投递”，
但系统 delivered 仍晚于第一张 probe 快照。脚本现轮询本轮 occurrence 的 delivered，出现后
重新启动生产 RN 进程执行正常 reconcile，最后等待真 SQLite 中对应的
`firedAt + firedForTriggerAt`。probe 的 pending/delivered 和原生 ledger 的 posted/receipts
都不能单独升级为同步事实；这四层必须绑定同一个 occurrence ID。

只读 probe 为了让延迟回调有时间写文件会暂时保持同一 bundle 进程存活。因此 delivered 快照
之后必须先终止 probe，再显式启动生产 RN；否则 iOS 可能复用 probe 进程，表面上启动成功但
没有挂载 JS，也就不会执行 startup reconcile。该终止/启动顺序已经固化在 `restart-recovery`
脚本，SQLite 回执仍是最后判据。

2026-10-04 16:50–16:58 的专用模拟器续验再次固定了一条验收边界：当前源码 Release 包在
`9DC7F824-00C5-4757-B5E9-2177FAE8CC9A` 上安装成功，bundle hash 新鲜度、首启选择、RN
Composer 建任务和真实 SQLite `TASK CRT` 均通过；随后在任务详情用 AX `scroll_into_view("今天")`
时，`idb swipe` 长调用分别在 TCP companion `10988` 和强制 Unix companion 上未返回。两轮都在
取得通知授权/创建 REMINDER 前中止，没有产生新的 OS 投递证据，旧截图也没有被提升为成功证据。
今后的规则是：AX swipe/companion 超时只能记为验收载体失败，必须保留本轮 Release、设备、
传输方式和失败日志；不能把 `schedule()` 返回、任务 SQLite 写入或旧截图当作通知中心证据。
本轮脱敏取证见 [AX companion 载体失败记录](../../apps/mobile/evidence/ios-reminder-ax-companion-20261004.txt)。

同轮还修正了脚本自愈路径中的一个真实载体缺陷：TCP 模式把 `IDB_COMPANION` 替换为
`HOST:PORT` 后，AX 空树分支原先仍调用只支持 Unix socket 的 `ensure_idb_companion`，
重启后会把地址当作二进制路径，导致 companion 根本没有恢复。脚本现在单独保存
`IDB_COMPANION_BIN`，在 shutdown/boot 后按同一端口重新启动 companion，并用
`idb --companion HOST:PORT` 复核连接；Unix 模式仍走原有 `--companion-path`。这条修复已由
`bash -n scripts/verify-mobile-ios.sh` 和一次真实 TCP companion 日志对账确认；它只修正验收
载体，不改变 C 的 OS 级边界台账。后续若重启后的 TCP 连接或 AX 树仍失败，必须记录为载体失败，
不能把它写成提醒投递或 Vault 产品失败。

随后对照发现，单修 shim 仍不足以证明整条验收通道：共享 `scripts/lib/mobile-e2e.sh` 的
`idb_ui` 与 AX 计数 helper 也曾固定使用 `--companion-path`，会把已经恢复的 TCP 地址再次
读成空树。现已让共享入口与 shim 使用同一 `HOST:PORT`/Unix 判别；同一目标 UDID 的 TCP
`11005` 只读对照得到 `AX_LABELS=11` 与合法 JSON。今后 transport 变更必须同时覆盖 shim、
共享 helper、重启分支和只读 AX 对照，不能只验证一个调用点。

### 2026-10-24：桌面四端接上系统通知 + 移动端把"拒绝"说到明处（本轮）

**这一轮补的是"最后一公里"的另一半。** 2026-09-29 那条记录说的是"算得出 `due` 却没人读"；
这一轮的症状是**移动与桌面两套形状的投递路径各自缺不同的东西**：移动端拿到了授权结果
却不告诉用户"到点不会响"，桌面四端则压根没有通往系统通知中心的腿。

#### 定下来的形状（有一条是新的，写清楚）

🔴 **桌面端的投递住在页侧，不住在壳侧。** 理由是实测出来的：桌面三壳（macOS / Windows /
Linux）跑的是**存储宿主**模式 —— 页面自己持有 `OpLogEngine`，壳只调 `openOpLog()`，
所以壳侧那一份 `HeytaApp.deliverReminders()` **必然**抛"应用宿主还没打开"。
于是：

```
页面（apps/web/src/features/reminders/notify.ts + shell-reminder-center.ts）
   │  判哪条到点、弹过没有、写 firedAt —— 全部业务语义（AGENTS §3.5 的那一侧）
   ▼
一条消息通道 {requestId, method: permission|request|openSettings|show, args}
   ▼
壳（只回答"这台机器能不能弹 / 怎么弹"）
```

两种**回法**按平台形状分工，页侧同一份代码兼容：
① macOS 的 `WKScriptMessageHandlerWithReply` ⇒ `postMessage` 直接回 Promise；
② Windows WebView2 / Linux WebKitGTK 的管道是**单向**的 ⇒ 壳执行
`window.__heytaReminderAck(requestId, 值)`。5 秒等不到回执**按"没投出去"算**。
这条不对称是整个设计的承重处：`true` 会写 `firedAt`，而"没投出去却记成已投"
= 用户的那条提醒永久消失；反过来（回执丢了、下一轮再试一次）只是晚一点。

⚠️ **`openOpLog()` 里刻意不挂前台提醒循环。** 一条永远投不出去的循环比没有循环更糟 ——
它把"这一端没接通知"读成"接了"。循环只在引擎模式（`open()`）里挂：
macOS 的 `ScriptHost.startReminderLoop()`、Linux 的 `heyta_api_arm_reminders()`（M1 回退屏）、
Electron 的 `NodeHost.startForegroundReminders()`（主进程持库，页面拿不到宿主）。
Electron 因此是唯一走"主进程投递"的桌面端，另三壳走页侧 —— 差别来自**谁持有宿主**，
不是风格。

#### 三处判据补强（都是"原来那臂会空转"）

`scripts/check-legal-permissions.mjs` 新增/改了三臂，每一臂都做了变异验证
（造失→必须红→还原），基线绿：

1. **合并产物 ⇄ 源清单**：条款说的是装上机的那份清单，而装配工会把第三方库的 manifest
   合进来（RN 的 debug manifest 就往里塞 `SYSTEM_ALERT_WINDOW`）。只判源文件看不见这层。
   产物在就判，不在就在读数里写"未判" —— 不许把"本机没构建过"读成绿。
2. **iOS 通知臂改判代码面**：本地通知的申请是 `requestAuthorization(options:)` 那一次调用，
   plist 里一个键都不必出现，所以只判 plist 的那一臂**永远不会因为真申请而红**。
   现在两处都读，并加反向一臂：调用撤了而目的串还留着 ⇒ 红（清单里挂一句系统读不到的承诺）。
3. **日历/提醒的 iOS 键名补齐**：iOS 18 起日历与提醒各有"限范围/全访问"两枚键，
   登记表只写一枚的话，另一枚出现时红在"陌生词"分支上，指向错误的条款句子。
   `RECEIVE_BOOT_COMPLETED` / `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 同时进非隐私集合
   （normal 级、不读个人信息），`permissions.ts` 中英各加一行，版本 `1.2 → 1.3`。

`apps/web/tests/shell-reminder-center.spec.ts` 另加一组**跨语言钉**：三壳注册的通道名、
ack 全局名、分流必须在 op-log 转发**之前**，都按源码逐字比 —— 这类名字错了不会报错，
只会静默退回"网页通知"，而那一档没有任何一层会说破。

#### 实测到哪一步

| 端 | 现量 |
|---|---|
| Linux 壳 | 在载体上 `-Werror` 全编译 + 链接两枚产物；`HEYTA_LINUX_SMOKE=OK 15/15`，其中新增两条提醒端口断言；通道读数 `NOTIFY_CHANNEL=granted`，投递 `NOTIFY_SHOW=ok id=3` —— 服务端是 **GNOME Shell 46**（`GetServerInformation` 现量），按 freedesktop 规范 id≠0 就是收下并归它渲染。证据：`apps/desktop-linux/evidence/reminder-port-2026-10-24/smoke.log` |
| macOS 壳 | `swift build` 绿 + `heyta-smoke` 第十二节绿（端口跨 JSC 边界的读数：`unsupported` / `show()==false` / `containsDelivered("smoke\|1")==false`，无 `.app` 时的诚实降级） |
| Electron | `pnpm --filter @heyta/node-host build` 后 `apps/desktop` **37/37** 通过，含"投不出去绝不回 true"与 IPC 白名单那两条 |
| 移动端 | `apps/mobile` **1094/1094** 通过（含设置页三行、省电落点三句话、`permissions.ts` 与开关名同字） |
| iOS 通知目的串 | 同一台模拟器、同一枚二进制、同一份 plist，**两种渲染形态都取到过**：一轮弹窗正文逐字＝本轮注入的暗号，另一轮是系统自带那句。装置自证三条（注入串 == 设备容器现读 == 截图正文）与逐轮对照见上面边界 3 和 `apps/mobile/evidence/ios-notification-purpose-20261024/README.md`；装置本身踩到的坑与否证掉的归因登记在 §7 #547、#548 |
| 门禁 | `check:legal-permissions` / `legal-copy` / `legal-closure-truth` / `mobile-settings` / `crosslang-contract` / `ios-native-bridges` / `docs` / `i18n-vars` / `ui-language` / `native-bare` 全 rc=0；`apps/web` **2486/2499**（13 skip）、`packages/app-host` **2061/2061** |

一条**如实登记的不绿**：`check:shell-surfaces` 红在桌面三端的**倒数日产物**那几格
（包内 `index.html` 的 sha 与本工作树 `apps/web/dist` 不符 —— 那是别的会话/别的构建的包）。
它与本轮无关，关闭判据是 `pnpm build:linux local` 等重打包，见 §5.9 那节。
`pnpm typecheck` 另有 4 条错在 `apps/web/src/features/settings/AiSettings.tsx` 与
`apps/web/tests/admin-console-route.spec.tsx` —— 两个文件在本工作树**未被修改**（`git status` 干净），
是 AI 设置那条线的既有红，不在本轮里代改。

#### 没关掉的边界（逐条写关闭判据，不写成缺陷也不写成完成）

1. **macOS 真横幅**：装置已经能把页侧 → 壳 → `UNUserNotificationCenter` 整条跑通并把
   系统那侧的 delivered 列表读回来，缺的是**一次人点"允许"** —— 探针 199 次轮询 600 秒，
   `reminderStatus` 恒 `default`，那台机器上那个系统弹窗没人应答。
   关闭判据：打包态 `.app` 里点一次允许，`REMINDER_PROBE` 的 `delivered=true` 且
   `REMINDER_DELIVERED=in-list=yes`，并留一张截图（AGENTS §6.2 规定一）。
2. **Windows C# / Android Kotlin 的编译证据**：本轮两处代码是按契约写的，
   而打包机 `C:\src\heyta` 那枚检出停在别的提交、且有一大片未提交改动
   （别的会话的在飞工作）—— 不在别人的树上做覆盖。
   ⚠️ **"有人在飞"是瞬时读数**，接手前先现量，别照抄上面那句：
   `ssh windows-pc "git -C C:/src/heyta rev-parse --short HEAD & git -C C:/src/heyta status --porcelain | find /c /v \"\""`
   （2026-10-24 21:16 那一读是 `fc608b7` / 2298 行，且比同日 16:5x 那一读的 2247 在涨）。
   🔴 还要注意：Windows 那一腿的同步目标路径**写死在 `C:\src\heyta`**
   （`scripts/lib/sync-windows-sources.sh`），所以"隔离检出"隔离的是**本机这一侧**，
   远端那一侧没有第二个落点 —— 要走这条路，得先拿到那台机器上那份工作的处置。
   关闭判据：按"四端重装在隔离检出里跑"那条约定，在 windows-pc 上开一份只含本轮改动的
   检出，跑 `dotnet build`（HeytaWindows）与 `:app:compileDebugKotlin`。
3. **iOS 通知目的串是否被系统读取**（交付项 4）：**不是可靠的展示通道 —— 同一台模拟器、
   同一枚二进制、同一份 plist，实测出现过两种形态**。装置
   `apps/mobile/probe/ios-notification-purpose/` 把那枚键设成每轮新生成的暗号：
   20:38 那一轮弹窗正文**逐字就是暗号**（`HEYTA-PURPOSE-1792845370-18531`，
   与设备容器里现读的那份 plist 一致，读数 `PROBE_STATUS_BEFORE=0`）；
   21:02 那一轮（注入 `…1792846917-26489`，同样三条一致）正文却是系统自带那句
   「通知可能包括提醒、声音和图标标记…」。
   两种形态之间**没找到能判别的读数** —— 先猜"冷重启后才回落"，被 21:02 那一轮否证
   （那轮没重启、设备已温）。
   证据与逐轮对照：`apps/mobile/evidence/ios-notification-purpose-20261024/README.md`；
   装置踩到的坑与否证掉的归因登记在 §7 #547、#548。
   ⇒ 三条落地：**① 键保留**（某些状态下它确实是正文，删掉只会让那一状态下的用户
   什么说明都看不到）；**② 对外不许写"iOS 会显示 heyta 的目的说明"**，
   `packages/legal` 里那一行的口径停在"由系统显示通知授权弹窗"，两种形态下都真；
   **③ 要让用户一定看到理由，只能靠应用内那一行**（交付项 1 的降级状态行）。
   关闭判据（把"什么时候读"这一格关掉需要）：真机 + 出厂未申请过通知的设备跑一次，
   或 Apple 侧明文说明该键在通知授权弹窗里的角色 —— 模拟器上 usernoted/SpringBoard
   的状态机不是产品运行环境。
   ⚠️ 顺带量到的一条既有缺口（不在本轮修）：iOS 原生 `Info.plist` 的文案**全仓没有本地化**
   （`find` 现量：0 个 `.lproj` / `InfoPlist.strings`），英文装机用户在**会被读的那一态**
   看到的是中文目的串 —— 日历/提醒事项那几枚键同此，属同一件独立工作。
4. **桌面横幅的那一帧截图**：Linux 侧抓不到（载体上没有可用的显示会话给 ssh，
   截图工具也不在 PATH），macOS 侧被第 1 条挡住。日志读数已经能证"系统收下了"，
   但"用户看得见"这一格仍然空着 —— 这一格必须由人或者由带显示环境的构建来关。
5. **移动端"拒绝态"在当前包上的真机一帧**：🟢 **iOS 侧按关闭判据取得**（第十二趟：
   那句降级说明与「去系统设置」入口同屏可见、入口锚点在树里、只读 OS 快照确认 `denied`、
   截图人工看过；逐条读数与"当前产物"这句话的两个口径都在下面「设备腿」那一节）。
   **Android 侧仍然空着**：出包按约定在 windows-pc，而那一侧的编译证据被上面第 2 条挡住。
   关闭判据：当前产物装到任一移动设备后，在**关掉系统通知授权**的状态下截一张提醒面，
   屏上要看得见"未授权、到点不会响"那一行与跳系统设置的入口（AGENTS §6.2 规定一）。

### 2026-10-25：提醒面那一行补上了（交付项 1 的另一半）

上一节写"移动端把拒绝说到明处"时，**只说了设置页那一半**。现量的另一半：

```
grep -rn blockedNotification .        # 命中只有词条表自己（零消费者）
```

`reminder.delivery.blockedNotification` / `.blockedExactAlarm` / `.openSettings` 三句
是全仓唯一写"到点不会响"的界面文案，而**没有任何一处 `t()` 读它们**；
`authorizeNativeReminders()` 也仍然回 `Promise<void>`。任务清单上那一格写着"已完成"。
成因与逐条教训登记在 §7 #551（含一枚**恒绿的源码级判据**被变异穿过去的那次实测）。

#### 定下来的形状

```
原生闸门读数 ──► lib/use-reminder-delivery.ts   （唯一持有者：什么时候重读只有一份）
                     │  readings: 通知授权 / 通知总开关 / 精确闹钟 / 省电豁免
                     ▼
        lib/reminder-delivery-display.ts        （纯函数，可断言）
           deliveryRows()      → 设置页那三行
           reminderFaceNotice()→ 提醒面那一句（哪一句、能不能跳）
           landingCopy()       → 那一跳落到哪儿该说什么
                     ▼
   共享 ReminderList 的 `deliveryBlocked` prop（packages/ui，web 与移动同一份实现）
```

三条刻意的形状，都会被下一个人顺手改回去，所以写清楚理由：

1. **`deliveryBlocked` 是 `{ text, settings? }` 而不是三个平铺字段。** 这一行唯一危险的
   失败形状是"话说一半"：只给文字，用户读完只知道"不会响"却没有回头路（通知授权被系统
   拒掉后应用**自己再也问不出第二个弹窗**）；只给入口，没人知道为什么点它。文字做成必填，
   漏一半就是类型错误。
2. **`'default'`（系统还没问过）在提醒面一句都不说。** 那一刻系统弹窗正盖在界面上，
   先写"到点不会响"是替用户做一个他还没做的决定。设置页那一节有它自己的第三句
   （"还没问过你"），两处问的不是同一个问句。
3. **答完弹窗要主动通知界面重读**（`authorizeNativeReminders` 回结果 + 一声 listener）。
   iOS/Android 的授权弹窗**不把应用退到后台**，`AppState` 在用户答完那一刻根本不变；
   少了这一声，那一行会一直挂着"还没问过"的旧读数，直到用户自己切出去再切回来。

顺手补的一格真缺陷：Android 上"授权还在、通知总开关被关掉"
（`areNotificationsEnabled()==false`）同样一条都不会响，而旧判据只看授权读数 ⇒ 那种情况下
界面会保持沉默。现在两处任一被拒都说那一句。

#### 判据

* `apps/mobile/tests/reminder-delivery-settings.spec.ts` 新增一组 `reminderFaceNotice`
  （哪一句 / 优先级 / `'default'` 与 `'unsupported'` 各自不说 / 没有待投递提醒时不报警 /
  文案主语是整个提醒面 / 中英两表都在）与一组接线钉（共享组件画出那句与那一跳、
  详情面板真的把判定结果接上、重读时机只有一份）。
* `apps/mobile/tests/native-reminder-authorization.spec.ts` 新增一条：结果要交回调用方，
  且读数变了才通知（读数没变不许反复吵）。
* 六发变异逐条实测过红：拿掉那条订阅 / 让"零条待投递提醒"也报警 / `authorize` 又吞掉结果 /
  硬回一个假读数 / 共享组件只说不给入口（**这一发第一次没红**，把判据从"标识符出现过"
  改成钉守卫本身与位置关系后才红）/ 详情面板漏接 `deliveryBlocked`。
* 现量命令（别抄数）：`pnpm --filter @heyta/mobile test`、`pnpm --filter @heyta/ui test`、
  `pnpm --filter @heyta/web test`，以及 `pnpm check:mobile-settings`、
  `check:i18n-vars`、`check:ui-language`、`check:native-bare`、`check:layering`、
  `check:design`、`check:l4`、`check:theme`、`check:ui-provider`、`check:verify-script-copy`、
  `check:shell-surfaces`、`check:docs`。

#### 设备腿踩到的两枚夹具坑（都不是产品红）

1. **上一轮取证探针留下的那道系统弹窗会挡住整条旅程**，而 `simctl uninstall` 撤不掉它 ——
   只有重启设备才行。白烧一枚 Release 构建。细节与复量命令在 §7 #552。
2. **`deny_notification_permission()` 原本只查一次 AX 树就判"没找到拒绝按钮"**：
   模拟器刚重启过的那一轮里，弹窗由 usernoted 排队呈现，可以晚到几十秒（同一族延迟
   在 §7 #266 量过）。现在改成有界轮询（默认上限 90 秒，`HEYTA_IOS_DENY_WAIT_SECONDS`），
   并把"第几秒出现"打进读数 —— 判红时能立刻分清是夹具没等到、还是产品真没说那句话。

#### 设备腿：当前构建上那一帧（2026-10-25 09:46 那一趟，`permission-recovery`）

载体 `heyta-permwake-oct24`（iOS 27 模拟器）。**这一趟的开机判据里有一条红，先说清它红在哪**：
脚本判"已安装 `main.jsbundle` 不旧于当前源码"不成立 —— 装机包出自 02:47 那次构建，而
另一会话在 09:37/09:38 改了 `packages/app-host/{admin-client,index}.ts`（`find -newermt` 现量）。
本轮那一行涉及的 `packages/ui`、`apps/mobile`、`packages/i18n` 各件都早于那次构建，
**所以"这一行在设备上看得见"这条证据本身是成立的**；但"装的就是当前源码"这句话不成立，
下面所有读数都只到"02:47 那一版产物"为止，要收成交付项 1 的最后一格必须重构建再跑一趟。

逐条读数（原样抄自 `/tmp/heyta-permwake-denied10.log`）：

| 判据 | 读数 |
|---|---|
| 那枚一次性弹窗 | 第 97 秒出现，第 1 发按下后**验过它从 AX 树上消失**才判绿 |
| 降级说明在提醒面上**看得见** | `frame=16 718 348 18`（几何复测过 `visible=True`） |
| 当场给得出跳系统设置的入口 | `frame=16 574 76 44`，可点且可见 |
| 那一枚入口的归属 | 锚点 `id:reminder-delivery-open-settings` 在本轮树里 ⇒ 是共享 `ReminderList` 画的 |
| 系统侧到底是什么状态 | **只读 OS 快照确认通知权限为 `denied`** |
| 截图 | `apps/mobile/evidence/ios-reminder-denied-visible.png`（人工看过：橙色那句 + 下面一行「去系统设置」） |

一条判据在第十趟当场判红，而红的是**夹具的量法**：`入口与那句说明不在同一行带内（144pt）`。
两个 y 取自**两份不同的滚动位置** —— `--scroll-into-view` 每读一次都可能自己滚一下，
而截图上那两样只差约 30pt。判据已改成**后一发读数没有再滚动（shim 报 `swipes=0`）时才允许比 y**，
还在滚就重取一对。**第十一趟没跑到这一格**（它红在首启层：HID 那一发点了而页面不动），
第十二趟把它跑绿了，同趟还补了两处夹具改动（下面第 4 条）：

```
✅ 弹窗在第 0 秒出现，第 1 次按下（按下后验过它从 AX 树上消失才算）
✅ 降级说明在提醒面上看得见        frame=16 579 348 18  swipes=1
✅ 当场给得出跳系统设置的入口        frame=16 605 76 44   swipes=0
✅ 入口与那句说明在同一行带内        纵向相差 26pt ≤ 80，两次读数之间列表未再滚动
✅ 那一跳的锚点在本轮树里            id:reminder-delivery-open-settings
✅ 只读 OS 快照确认通知权限为 denied
✅ 提醒面这一行所需的 8 枚源码全部早于装机包（最晚 11:05:35，包 11:10:37）
```

这一天的设备腿一共教出三处夹具改动（都不是产品红，但都会让下一轮误判）：

1. **步骤 0.6 屏幕归属预检**：上一趟没被按掉的系统弹窗会跨 `uninstall` 留在设备上，
   把这一趟步骤 1 的每一次 tap 吃掉，红成六条连锁。现在开局就判红并印出复位命令（§7 #552）。
2. **有界等待一律改墙钟**：这台机器同时挂着五枚模拟器时一枚 `ax` 往返要 8~10 秒，
   "90 轮"实测是十几分钟 —— 既会把夹具自己拖到吃掉 trigger，又让日志上"第 N 秒"那句失真。
3. **设置页导航改 `settings_press`（精确框中心 + `--api axbridge`）**：iOS 27 的设置页
   **不吃 HID 坐标点**（返回 `found=True` 而页面纹丝不动），而 marker 直点会把 "App"
   命中到「主屏幕与App资源库」。三条都在 §7 #557。
4. **首启同意层的按压加了同一枚回落**（`press_or_axbridge`：HID 那发点完还在，就按精确框
   中心改走 axbridge 重按）—— 第十一趟那六条连锁红的成因就是它：截图上「只用本机」明明在屏上、
   `press` 回了 `found=True`，八轮下来页面不动。第十二趟这一格一次过。

顺带否证掉一个想当然：**想在旅程之前用真设置开关把拒绝态钉住**。实测 `notDetermined`
（应用还没问过 / 问了但没答）时，设置里的 heyta 页只有 Siri / 搜索 / 蜂窝数据三行，
**「通知」那一组根本不挂出来** ⇒ 开关那条路只在"状态已决"时可用（例如上一趟按了「允许」）。
造拒绝态的正路仍然只有那一次弹窗，而它由 usernoted 排队，实测最晚比请求晚了十几分钟。

同一趟的**恢复段**（跨过真实 `triggerAt` 之后）也逐条给了读数，这一串是本线设备腿上第一次全绿：

```
✅ 已在真实 triggerAt 前终止 App，并等待跨过 trigger
✅ 恢复前 OS delivered 为空
✅ 跨过 trigger 前未伪造 firedAt
✅ 通过系统设置真实恢复通知权限          ← 走的是上面那条 axbridge 导航修好后才走得通的路
✅ 恢复后 OS delivered 已出现目标 occurrence
✅ 恢复后只读 OS 快照确认权限 granted
✅ 恢复后真 SQLite 有目标 occurrence 的 firedAt + exact firedForTriggerAt
```

整趟合计 **30 通过 / 2 失败**，两条失败分别是开头那条新鲜度（上面已写明成因与适用范围）
与那条比错了滚动位置的 `swipes` 判据（已改，待下一趟复量）。
**恢复这条边界本身可以按"读数已取得"记账**，但它记的是 02:47 那一版产物 ——
交付项 1 那一格要收口，仍以重构建后的那一趟为准。

**「当前产物」这句话在这台机器上要分两口径说。** 全集判据（装机包不旧于
`apps/mobile/src` 与 `packages/*/src` 里任何一枚 `.ts/.tsx`）在一枚被人并行编辑的共享工作树上
**赢不了赛跑** —— 2026-10-25 现量：09:37 / 10:38 / 10:43 / 11:03 / 11:31 一路都有人在改
`packages/{app-host,ui,i18n,op-log}`，而构建窗口在这台机器上是 2~60 分钟。
所以脚本另加了一条**按本线可达集合收窄**的判据：提醒面这一行所需的 8 枚源码
（`packages/ui/src/reminders/ReminderList.tsx`、`apps/mobile/src/{screens/TaskDetailSheet.tsx,
lib/reminder-delivery-display.ts,lib/use-reminder-delivery.ts,lib/native-reminder-scheduler.ts,
lib/reminder-native.ts}`、`packages/i18n/src/locales/{zh-CN,en}.ts`）是否全部早于装机包。
第十二趟的读数：**8 枚全部早于装机包（最晚 11:05:35，包 11:10:37）**，
而全集那一发同时判红（别人 11:31 的编辑）。两条都留在日志里，各说各的话 ——
**这一帧的证据只由收窄那条承担**，不许拿它去替全集那条说"装的就是当前源码"。
