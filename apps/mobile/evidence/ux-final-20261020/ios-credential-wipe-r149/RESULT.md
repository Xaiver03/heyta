# r149 装机态 iOS：冷启动后「清除本机保存的凭据」这枚入口够不够得到

## 一、这一格量到什么

同一枚模拟器、同一份装置、同一趟旅程，只换被测件：

| 被测件 | `enabled` | frame | 本步状态 |
|---|---|---|---|
| `before-light/` —— 改前件（r147 那枚，没含本轮闸门改动） | **False** | `[16, 434, 370, 44]` | 红：`'清除本机保存的凭据' is rendered disabled` |
| `after-light/` —— 改后件（本趟从当前源码重打重装） | **True** | `[16, 434, 370, 44]` | 绿：整趟 28 步全过 |

frame 两趟逐位相同 ⇒ 这是**同一枚控件**的两种状态，不是"改前根本画不出来、改后画出来了"那种假对照。

这就是台账那一格（`docs/plans/product-ux-optimization.md` 的「清理数据后系统小组件不继续展示旧任务」）
里那条缺陷的 iOS 腿：那枚按钮的闸门原先写的是 `disabled={form.token === '' && form.password === ''}`，
而凭据**按设计只放内存、不落盘**（`apps/mobile/src/sync/config.ts` 文件头那条取舍）
⇒ 冷启动之后它必然灰着，可小组件快照、设备密钥、本机任务三样都跨进程活着
⇒ 想"把手机给别人前把屏幕上的数据清掉"的人在这台设备上没有任何入口。
Android 侧同形读数在 `../../ux-final-20261017/android-widget-erase-r117/RESULT.md` 第 5 节（当前产物上仍 `enabled=false`）。

## 二、被测件身份（现量，别抄这里）

```
UDID          FE195661-B021-4A71-AAD1-1F2F7AE3A102（heyta-iphone-17pro，iOS 27.0，本趟唯一在跑的模拟器）
装机件（改前）main.jsbundle sha256 前 16 = 60c7968c5bcd32da，mtime Oct 19 23:45   ← r147 那趟装的件
装机件（改后）main.jsbundle sha256 前 16 = 3a5e127a22ddbc75，mtime Oct 20 00:27
              与 apps/mobile/ios/build/.../Release-iphonesimulator/Heyta.app/main.jsbundle 同哈希（装的就是这一枚）
装置            scripts/qa/profile-settings-ios.py sha256 前 12 = fdc2d6bdabe1 —— 两趟同一份（本趟先加判据、再跑改前臂）
源码            载体 = 5412a046 + 本趟未提交的三处改动（闸门 / 装置 / 这条判据）
设备档位        appearance=light（`xcrun simctl spawn $U defaults read -g AppleInterfaceStyle` 回空 → 浅），
                应用内语态=zh（判据是旅程里"整组五枚分组标题在场"那一步，不看系统域 —— 陷阱 #488）
```

## 三、这一枚判据的射程

`Probe.assert_enabled(name, candidates)` 读的是 AX 节点的 **`enabled`** 键，不是 `pressable`：
iOS 上 RN 那枚 disabled 的 Button 在 AX 里照样算 pressable（与 Android uiautomator 里它照样回
`clickable="true"` 是同一件事，r117 装置事实 1 就是被这点骗过一次，把灰掉的按钮报成"可点"）。
所以"这一枚够得到"这句话只能由 `enabled` 来说。

它**只判入口够不够得到**：旅程到这一步为止一次都没有按下那枚按钮
（本脚本文件头写明它不签入、不改设置、不删东西），所以：

## 四、这一格仍不证的四件事

1. **不证按下之后 iOS 的组件真的退回空态**。那一半的装机态读数在 Android 上（r117：清凭据 ⇒ 组件存储
   `1275 B / [snapshot_v1]` → `65 B / <map />`；r120：原生拒绝 ⇒ `widget-cleanup-pending` 在场且存储三个数不动）。
   iOS 侧要另起一趟"把组件摆上桌面 + 读 App Group 容器"的腿，本趟没走。
2. **不证 Android 上这枚闸门改后也翻成 `enabled=true`**：Android 的包要打包机出，
   本趟现量 `ssh windows-pc` 回 `Host is down`、`adb devices` 空 ⇒ 这一半只能等设备腿重开（待办 #96 同一条）。
   ⚠️ 别用 `HEYTA_ANDROID_LOCAL_GRADLE=1` 绕，那是换载体不是补读数。
3. **不证暗档**。两趟都是浅档（`require_appearance` 按末级目录名与设备当前档配对，不符就拒写）。
   这枚按钮的颜色在两档下都属既有外观档矩阵，不是这一格的判据。
4. **不证"清凭据会把本机任务一起清掉"** —— 它不会，也不该：那枚动作的范围是凭据 + 组件快照 + 设备密钥。
   要让本机数据消失是「注销账号」那一枚（r119 已量到 `heyta.sqlite` 整枚消失、组件退回占位且十秒没长回来）。
   冷启动后组件仍会从本机库重新发布一次快照，这是本地优先 + 「只用本机」那条路径的**设计行为**，
   不是这条缺陷的一部分（把它当缺陷会顺手废掉离线模式）。

## 五、下一位怎么重跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
EV=apps/mobile/evidence/ux-final-20261020/ios-credential-wipe-r149/<新末级名>-light
pnpm -C packages/ui build            # @heyta/ui 是按 dist 被壳消费的
pnpm build:ios && xcrun simctl install $U apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app
mkdir -p "$EV" && python3 scripts/qa/profile-settings-ios.py --udid $U --evidence-dir "$EV"
```

取"改前红"：把 `apps/mobile/src/screens/SettingsScreen.tsx` 里那枚 Button 的
`disabled={form.token === '' && form.password === ''}` 加回去、重打重装，同一份装置会红在
`credential wipe entry enabled on a cold start`（本目录 `before-light/` 就是这一臂的真实读数，不是构造的）。
node 腿同一条判据的变异臂：`NO_COLOR=1 pnpm -C apps/mobile test tests/device-revocation-behavior.spec.ts`
⇒ 加回闸门时红在 `expected '<Button …' not to match /disabled=/u`，去掉闸门时 5 项全绿。
