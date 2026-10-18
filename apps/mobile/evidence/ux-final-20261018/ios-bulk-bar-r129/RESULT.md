# r129 · iOS 批量操作条：暗档复验（成功）+ 英文档的一条死路（已定位成因）

> 一句话：**同一枚判据在暗档复现出 r127 的「可滚」结论，帧读数逐枚相同 ⇒ 裁切与主题无关；英文档没取到，但成因已经落到代码那一行，下一位不必再走系统语言那条路。**

## 一、出处

| 件 | 值 |
|---|---|
| 被测包 | 第八趟四端重装（r128）装进模拟器的那枚：载体 `/Users/rocalight/heyta-carriers/head-r128` @ `f8d7155e`、`dirty=0`、`IOS_RC=0` |
| 设备 | `heyta-iphone-17pro` = `FE195661-B021-4A71-AAD1-1F2F7AE3A102`（402×874 逻辑点） |
| 判据 | 行为判据（不是像素）：在**被裁那一行自己的 y** 上做一次向左滑动，再读同一批按钮的 frame —— 有位移 ⇒ 可滚；零位移且仍在视口外 ⇒ 真溢出 |
| 装置 | `probe5-bulk-bar-scroll.py`（与 r127 同一枚脚本，含 #465 那次修好的作用点选择） |
| 对照 | r127 浅色趟：`apps/mobile/evidence/ux-final-20261017/ios-bulk-bar-r127/` |

## 二、暗档读数（`probe5-bulk-bar.json`）

滑动作用点 `y=208`（行「批量删除」），锚点「已选 2 项」在 `y=145` —— 两者不同行，这正是 #465 那枚缺陷的要点。

| 按钮 | 滑前 frame `[x,y,w,h]` | 滑后 `x` | `dx` | 滑前在视口内 |
|---|---|---|---|---|
| 批量完成 | `[24, 186, 119, 44]` | -10 | **-34** | ✅ |
| 移动到清单 | `[151, 186, 134, 44]` | 116 | **-35** | ✅ |
| 批量删除 | `[293, 186, 119, 44]` | 258 | **-35** | ❌（`right=412 > 402`） |

`verdict = 可滚（滑动后 x 位移，图上位置只是滚到当前项）`，`clippedAfter = []`。
🔴 **与 r127 浅色趟逐枚相同**（同一台机、同一枚判据、只换外观档）⇒ 这一格的结论与主题无关，r127 那句裁决在暗档成立。
两张图 `01-before-swipe.png` / `02-after-swipe.png` 都人眼看过（暗档：卡片深蓝底、主蓝按钮文字为深色、无白压白）。

## 三、英文档：三条系统语言路都不改变这枚包的界面语言（成因已定位）

试过的三条，每条之后都 `terminate` + `launch` 冷启动：

| 试的东西 | 命令形状 | 结果 |
|---|---|---|
| 全局语言列表 | `simctl spawn <U> defaults write -g AppleLanguages -array en "zh-Hans-CN"` | 界面仍中文 |
| app 域语言列表 | `simctl spawn <U> defaults write com.heyta AppleLanguages -array en` | 界面仍中文 |
| 全局地区 | `simctl spawn <U> defaults write -g AppleLocale -string en_US` | 界面仍中文 |

**成因不在缓存，在代码的优先级里**：`apps/mobile/src/i18n/locale.ts` 的 `resolveNativeLocale()` 第一眼看的是
原生模块 `HeytaWidget.preferredLocale`（注释原话「**已选设备偏好优先于系统语言**」），
只有它为空/不识别才退到 `deviceLocale`，再往下才是 `SettingsManager.settings.AppleLocale` → `AppleLanguages[0]`。
⇒ 这台模拟器上那枚开关已经持久化成中文（与「语言开关实测是持久的」那条一致），**系统语言整条路被它挡在门外**。

🔴 **正路只有一条**：走应用内开关 —— 设置 → 常规 → 语言（`scripts/qa/profile-settings-ios.py:312` 那一步就是走到这一屏）。
本趟试到那一屏之前停了：`tap(("我的","Profile"))` 报
`open profile tab is not in the tappable viewport: {'found': True, 'x': 321, 'y': 776, 'visible': False, 'scrollRc': '', 'swipes': 10}`，
而同一次 `dump_nodes` 只回 **29 枚节点**、底部 tab 栏整条不在树里（截图上明明画着五枚 tab）
⇒ 这是 companion 返回**部分树**那一族（#462 的邻居），不是产品缺陷；本趟没有把它当缺陷登记。
`lang-probe.py` 留在那个目录里，下一位可以直接改造成"走应用内开关"的那一趟。

失败趟的图与读数**不作数**，已改名留在 `../ios-bulk-bar-r129-EN-ATTEMPT-LOCALE-NOT-SWITCHED/NOT-EN-*`：
它的 `uiLocale` 字段自己写着 `zh-CN`，是一份**中文×暗档的重复样本**，不是英文档。

## 四、这一趟不证什么

1. **不证英文档的批量操作条** —— 那一格仍开，且已写明正路（应用内开关）与挡路的原因（`preferredLocale` 优先级 + 部分树）。
2. **不证 Android** —— 本趟只在 iOS 模拟器上。
3. **不证"静止态有可见的还能滚提示"** —— 恰恰相反，`showsHorizontalScrollIndicator={false}` 这条残留观察照旧（属界面那一线的设计取向，本线只登记不改）。
4. **不证真机** —— 全部读数在模拟器。

## 五、设备已还原（接手态逐件）

`AppleLanguages = ("zh-Hans-CN")`、`AppleLocale = zh_CN`、`com.heyta` 域那枚 `AppleLanguages` 已 `delete`
（现量：`Could not find key` ⇒ 已无）、外观 `light`。⚠️ **没有**收掉任何 `idb_companion`（#462 那条规矩）。
本机残留：设备里多了 `BulkA/BulkB<两枚时间戳>` 四行测试任务（与 r127 同形状，属这台验收机的既有残留族）。

## 六、复跑

```bash
U=FE195661-B021-4A71-AAD1-1F2F7AE3A102
xcrun simctl ui $U appearance dark && sleep 2
python3 apps/mobile/evidence/ux-final-20261018/ios-bulk-bar-r129/probe5-bulk-bar-scroll.py --udid $U
xcrun simctl ui $U appearance light      # 取完还原
```
