# P4 移动端设备腿：三处外观变化的看图判据（2026-10-28）

## 这一格原来欠什么

计划 §8 的 P4 行写着：🔴 **未跑的那一条腿** = 移动端模拟器截图，三处**只有看图才能判**的外观变化 ——

1. `danger` 默认档从实底变行内；
2. `secondary` 换填充；
3. 顶栏图标静止态转 `foreground-muted`。

代码与语义测早在 A3 就落了（`apps/mobile/src/ui/kit.tsx` 的 `Button`/`IconButton` 已经是读
`packages/ui/src/control/states.ts` 那张表的薄壳），欠的一直是**设备上的读数**：
配方对不对，源码两边可以互相抄得整整齐齐，而真机画出来的可能是第三个值。

## 产物是哪一枚（防"测试全绿但不是当前产物"）

| 项 | 读数 |
|---|---|
| APK | `linux-dev:/home/xaiver/heyta-android-build/apps/mobile/android/app/build/outputs/apk/release/app-release.apk` |
| sha256（前 16） | `54b7f6983ab0a35e` |
| 字节 | 69,827,016 |
| 构建时刻 (UTC) | 2026-10-28T13:06:05.000Z（`assembleRelease` BUILD SUCCESSFUL in 51s） |
| 装机设备 | `emulator-5556`（载体 `linux-dev` 上 `heyta_carrier_api36`；**5554 是协作线在用，没碰**） |
| 装机语言 | `adb -s emulator-5556 shell cmd locale set-app-locales com.heyta --locales zh-CN` |
| 屏幕 | 1080×2340，`wm density` = 440 ⇒ 1dp = 2.75px |

设备侧 adb 走 `bash scripts/android-carrier-device.sh tunnel` 的转发，本机只需
`export ADB_SERVER_SOCKET=tcp:127.0.0.1:15038`。

## 复现这一屏（装置 = 本目录 `ui.py`）

```bash
export ADB_SERVER_SOCKET=tcp:127.0.0.1:15038
D=apps/mobile/evidence/global-ux-control-tiers-20261028
python3 $D/ui.py tap 只用本机            # 首启两道闸：先用本机 → 再选先离线使用
python3 $D/ui.py tap 先离线使用
python3 $D/ui.py tap 新建任务 && python3 $D/ui.py tap 新任务标题
adb -s emulator-5556 shell input text "tiers"
python3 $D/ui.py tap 添加 && python3 $D/ui.py tap "打开任务：tiers" --sub
for i in 1 2 3; do adb -s emulator-5556 shell input swipe 540 1750 540 600 400; done
python3 $D/ui.py shot $D/detail-light-actions.png
adb -s emulator-5556 shell cmd uimode night yes   # 暗色档
```

按下态用 `input motionevent DOWN/UP`（不是 `tap`，`tap` 拿不到"按住时"那一帧）：

```bash
adb -s emulator-5556 shell input motionevent DOWN 286 2126
python3 $D/ui.py shot $D/detail-dark-secondary-pressed.png
adb -s emulator-5556 shell input motionevent UP 286 2126
```

## 逐张看图后的判定（四张都人眼看过）

| 件 | 判的是什么 | 读数 |
|---|---|---|
| `tasks-light.png` / `tasks-dark.png` | 顶栏图标静止色（变化 3） | 标题 `任务` 是前景色，右侧搜索/同步两枚图标明显低一档 = `foreground-muted`；亮暗两档都是这个关系 ⇒ 变化 3 落地 |
| `tasks-light-with-row.png` | 行内删除图标的静止色 | 同上，走同一档 |
| `detail-light-actions.png` | 变化 1 + 2（亮） | `标记为完成` = `#f1f5f9` 填充 + `#0f172a` 字（= `--ht-slate-100` / `--ht-slate-900`，与 Web `.ht-btn--secondary` 的 `color.surface-sunken` 同一档）；`删除` = **无填充**、`#dc2626` 字与图标（= `--ht-red-600`）⇒ 行内档成立 |
| `detail-dark-actions.png` | 变化 1 + 2（暗） | 面板底 `#131e33`（`surface-raised`），`标记为完成` 填充 `#080e1a`（`surface-sunken`）+ `#f1f5f9` 字；`删除` 无填充、`#f87171`（`--ht-color-danger` 暗色档）⇒ 同一张表在暗色档也只有一个答案 |
| `detail-dark-secondary-pressed.png` / `detail-dark-danger-pressed.png` | 按下档 | 填充/字色**不变**（`#080e1a` / `#f87171` 逐像素同静止帧），只有缩放：次档药丸 485×121px → 469×117px，两轴同比例 0.967 ⇒ 触屏那一档确实是 `motion.press-scale`，不是"各端各发明一种机制" |

对比度（由截图取色现算，不抄 token 表）：

| 比 | 亮 | 暗 |
|---|---|---|
| 次档字 / 次档底 | 16.30 | 17.62 |
| 危险行内字 / 面板底 | 4.83 | 6.02 |
| 次档底 / 面板底（边界本身） | 1.10 | 1.16 |

第三行是**记录，不是判红**：这一档的边界只承担"这里有一块底"，识别控件靠标签 + 图标，
Web 端 `.ht-btn--secondary` 用的是同一枚 `surface-sunken`，两端同形 ⇒ 不是移动端缺陷。
要改就得连 Web 一起改，那属于取向题，留给 P8 的收口判据说话。

触控目标：静止帧次档药丸高 121px ÷ 2.75 = **44.0dp**，与 `touch-target.min` 逐字相等；
按下帧 42.5dp 是缩放的结果，不是另一档尺寸。

## 补跑：实底档与禁用档（同一趟稍后，2026-10-28）

上面那两格"设备上没拍到"已经补上，路径是**真点出来的**，不是猜的：

* 回收站入口不在 `我的` 那一列里 —— 列表滚到底只有到 `便签` 为止；`回收站` 那一行住在
  **`我的` → `设置` → `数据管理`** 这一节里（`ProfileScreen.tsx:1452` 的 `dataActions` 那一格）。
* 禁用档**零前置**就有：`任务` 页 → `选择任务` ⇒ 批量条上 `批量完成 / 移动到清单 / 批量删除`
  三枚在"没选中任何一条"时就是 `disabled`（`TasksScreen.tsx:1255/1263/1270`，
  无障碍树现量 `enabled=false` ×3）。不必造 `busy`。

| 件 | 判的是什么 | 读数 |
|---|---|---|
| `purge-confirm-light.png` / `purge-confirm-dark.png` | `emphasis="commit"` 实底档 + `color.on-danger` | 亮：`取消` = `#f1f5f9` 底 + `#0f172a` 字，`彻底删除` = **`#dc2626` 实底 + `#ffffff` 字**；暗：`取消` = `#080e1a` 底 + `#f1f5f9` 字，`彻底删除` = **`#f87171` 实底 + `#020617` 字**（= `--ht-slate-950`，正是暗色档 `on-danger` 那一格）⇒ 重量档在设备上也分得出，且暗色档没跟着亮色档写白 |
| `bulk-disabled-light.png` / `bulk-disabled-dark.png` | 禁用档的不透明度 | 由**画出来的像素反解 alpha**（`O = αF + (1-α)C`，C 取同一条上按钮间隙的容器底）：暗色下次档底解出 **α≈0.358**、行内危险字解出 **α≈0.376**，对着 token `state.disabled-opacity = 0.38`（`tokens.css:563`）；若是代码里写死的 `0.5` 会解到 0.5 附近 ⇒ 设备上用的是 token 那一档，不是裸值 |
| `tier-zoom-sheet.png` | 人看图的载体 | 四条按钮带拼在一起看过：两档确认层里"实底那枚才是按下去的"一眼成立；禁用那两条整体淡下去但**没消失**（可读） |

## 这一格没做到的（别读成"全绿"）
* `emulator-5556` 上留着这一枚 `com.heyta`（本地离线态、两条测试任务）。本趟收尾已把
  夜模式调回 `no` 并 `force-stop`；卸载：`adb -s emulator-5556 uninstall com.heyta`。
* **hover 档在触屏上不存在**，这一端只有静止 / 按下 / 禁用三态 —— 计划里"逐态"那句在
  移动端按这三态判，不拿 Web 的 hover 冒充。
