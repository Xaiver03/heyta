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
`node scripts/mutate-reminder-delivery.mjs` 已实跑四条臂：删除离线写入唤醒、删除授权完成唤醒、落库失败仍 ack、
按提醒 id 而非完整 occurrence 显示不确定说明，均由对应行为断言抓到；测试初始化失败不算 caught。
该脚本临时改源码，必须与构建独占，逐条 finally 对字节还原，不能与原生打包并发。
**尚未完成**：iOS OS 级投递、iOS 权限拒绝/设备重启后的实测、四端重装、
全仓最终门禁、不确定回执说明的真实界面截图验收。旧失败轮截图不作为成功证据。

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
是辅助证据，不是系统通知中心截图。当前 `ios-reminder-notification-center.png` 与
`ios-reminder-after-reconcile.png` 仍未取得可观察的通知中心画面（一次是多显示器模拟器默认的全黑副屏，
一次是锁屏壁纸），因此不能挂作成功证据；脚本现显式选择 `primary` display 并用 `png-stats`
拒绝全黑 PNG，但这只修复取证装置，不能把现有失败截图升级为成功证据；
下一轮必须在人工看见包含对应提醒标题的系统通知中心后，才能把 OS 级截图判据改为已验证。

2026-10-04 03:56–04:09 的 `pending-cancel` 续验进一步暴露了一个未闭合路径：真实 Release
包通过 UI 创建未来 occurrence，原生 scheduled ledger 有记录；随后 AX 点击“删除提醒”返回成功，
但等待 4 秒后真 SQLite 仍只有 REMINDER `CRT`、没有对应 `DEL`，重启 reconcile 后 scheduled
ledger 仍保留该 occurrence。`firedAt` 没有被伪造。该结果不能记作取消通过；它说明当前验收装置已经
走到真实删除按钮，但业务写入没有落地，必须先修复或取得可重复的根因证据，再补 OS pending 清空判据。

为避免同类故障重新出现，`pnpm check:ios-native-bridges` 现在逐项核对 Swift 的 `moduleName()`、
Objective-C bridge 的 `RCT_EXTERN(_REMAP)_MODULE` 导出名，以及 JS `NativeModules` 查找名；构建成功
本身不再被视为原生模块接线正确的证据。
