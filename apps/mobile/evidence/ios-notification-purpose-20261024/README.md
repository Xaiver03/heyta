# iOS 通知授权弹窗正文：同一份 plist，实测出现过**两种**渲染形态

交付项 4 要回答的问题：**系统会不会读 `NSUserNotificationsUsageDescription`**。
装置：`apps/mobile/probe/ios-notification-purpose/`（把那枚键的值设成每轮新生成的暗号，
卸载打回 `notDetermined`，起探针后截图）。

## 读数（同一台模拟器 `heyta-permwake-oct24`，iOS 27.0，同一枚二进制）

| 形态 | 图 | 那一轮 | 弹窗正文 |
|---|---|---|---|
| **读了** | `alert-custom-text-2038.png` | 20:38，注入串 `HEYTA-PURPOSE-1792845370-18531` | **逐字就是那一串** |
| **没读** | `alert-stock-text-2102.png`（`-plus8s` 同一帧） | 21:02，注入串 `HEYTA-PURPOSE-1792846917-26489` | 系统自带那句「通知可能包括提醒、声音和图标标记。可在"设置"中配置相关功能。」 |

两轮都满足同一套前置：`marker.txt` == 从**设备容器里那份 plist** 现读的
`installed-marker.txt`（21:02 那一轮的两个文件仍在），且容器读数
`PROBE_STATUS_BEFORE=0`（= 这台设备上这次申请前从没问过）。
20:38 那一轮的 `marker.txt`/`installed-marker.txt` 被 21:02 那轮覆盖，
所以那一轮留的是**当时终端回显的转录**（`round-2038-readout.txt` + `round-2038-note.txt`）。

## 结论（按能站住的那句话说）

**这枚键不是可靠的展示通道。** 系统在同一种状态下会把我们的串当正文，在另一种状态下
用自带句式，而这两种状态之间**没有找到能判别的读数**（试过并否证的归因：
"冷重启后才回落到自带句式" —— 21:02 那一轮设备已温、无重启，仍是自带句式）。

⇒ 对本产品的三条落地：
1. **键保留**（`apps/mobile/ios/Heyta/Info.plist:39`）。它至少在某些状态下会被渲染，
   删掉只会让那一状态下的用户什么目的说明都看不到。
2. **对外不许写"iOS 会显示 heyta 的目的说明"**。`packages/legal` 里"通知授权"那一行
   的口径是"由系统显示通知授权弹窗"——这句在两种形态下都真，不改成更强的说法。
3. 想让用户**一定**看到 heyta 的理由，只能靠应用内那一行（提醒面的降级状态），
   这条已经在交付项 1 里落地。

## 还欠什么才算关掉

真机 + 出厂未申请过通知的设备上跑一次（模拟器上 usernoted/SpringBoard 的状态机
不是产品运行环境），或 Apple 侧有明文说明这枚键在通知授权弹窗里的角色。
现量命令：`awk '/^#### 没关掉的边界/,0' docs/adr/0051-mobile-reminder-delivery.md | grep -cE '^[0-9]+\. \*\*'`

## 复现

```sh
xcrun simctl list devices booted          # 挑一枚，别抓别人正在用的屏
HEYTA_IOS_UDID=<UDID> bash apps/mobile/probe/ios-notification-purpose/run-probe.sh
```

构建产物住 `apps/mobile/probe/ios-notification-purpose/build/`，**不进证据目录**
（`pnpm check:evidence-hygiene` 的口径）。装置踩到的坑与否证掉的归因登记在
[`docs/reference/environment-traps.md`](../../../../docs/reference/environment-traps.md) §7 #547、#548。
