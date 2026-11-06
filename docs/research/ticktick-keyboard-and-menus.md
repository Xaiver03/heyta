# 滴答清单的菜单、快捷键与键盘可达性

> **这是「滴答清单逆向取证」的 P5 支线**：只回答「它把哪些入口放进菜单栏 / 快捷键 / 托盘，
> heyta 今天有没有对应入口」。上层总览在
> [`ticktick-desktop-teardown-2026-11.md`](ticktick-desktop-teardown-2026-11.md)（§3.1 是同一份
> 菜单证据的粗读，本篇是逐项深读 + 跨平台对照 + 冲突检测）。
>
> 实测对象：macOS **8.2.03**（`/Applications/TickTick.app`，`Base.lproj/MainMenu.nib`）、
> Windows **8.2.5.0**（`/tmp/rea-lab/win/app/TickTick.exe`）。实测日 **2026-11-06**。
>
> 🔴 **本篇的硬边界（写在最前，免得后面读到一半以为越界）**
>
> 1. 它的菜单文案**全文只引 2 处**（各出现一次：§2.1 第 2 项、§2.5 的那个标题模板，
>    各有各的用处）。其余一律用**「第 N 项」+ 功能描述**指代，
>    描述用的是 heyta 的词汇，**不是**它的文案原文。要原文就用 §1 的命令自己取 `menu.json`。
> 2. **selector 名不是功能**。§1.3 专门写了这一条为什么在这份文档里是硬约束。
> 3. 每个结论后面都有可复现命令。**没有命令的数字，都是别人给的数字，不是这里的读数。**

---

## 0. 六句话结论

1. **它的 macOS 菜单里 29 个业务动作（File 3 / Task 11 / List 13 / Help 2）一个快捷键都没配**；
   55 个叶子项里带键的 13 个，全部落在「应用菜单 / Edit / Window」这三组由 AppKit 或首响应者
   提供的标准项上（§3.1）。这比「它给了什么键」信息量大得多。
2. **它的顶层视图是菜单项**（13 个「打开某个视图」，标题由视图名模板生成，§2.5），
   而 heyta 的 12 个视图住在 rail + 「更多」弹出层里（`apps/web/src/features/shell/view-tabs.ts:193-303`）。
3. **两个平台的「第一类入口」不是同一种东西**：macOS 靠菜单栏（**0 个业务键也全键盘可达**），
   Windows 靠托盘 + `NHotkey.Wpf.dll` 注册的 7 个全局热键 + 一个可配置的快捷键设置页（§4）。
4. **heyta 今天只有 1 个组合键**：`⌘,` / `Ctrl+,` 开设置
   （`apps/desktop/src/settings-shortcut.ts:20`，唯一调用点
   `apps/desktop/src/main.ts:320`）。它**没有**原生应用菜单、没有托盘、没有全局热键 ——
   全仓 `grep -rn "setApplicationMenu\|Menu.buildFromTemplate\|Tray("` = **0 命中**。
5. **没有冲突，只有空缺**：它那 13 个键里，1 个（`⌘,`）与 heyta 语义相同且已被占用，
   其余 12 个 heyta 全部未绑定（§3.3）。所以「照抄」不会撞键，真正的问题是 heyta 缺的那一半。
6. **纯键盘可达性的差距不在「能不能」，在「几步」**：heyta 的视图切换是可达的
   （rail 是 `role="tablist"` + 漫游焦点 + Home/End，`apps/web/src/lib/tab-roving.ts:36`），
   但「完成 / 设日期 / 设优先级」这类原子动作要先进行、再开菜单（§4.3 的表逐格数了步数）。

---

## 1. 证据面：原料、一次独立复核、三个口径、一条纪律

### 1.1 原料在哪

| 原料 | 路径 | 怎么来的 |
|---|---|---|
| macOS 菜单树（含键等价） | `/tmp/rea-lab/out/menu.json` | 从 `MainMenu.nib` 解出，`{"<菜单标题>": [{title,key,mods,disabled}]}` |
| macOS IB 连接（327 个 selector） | `/tmp/rea-lab/out/digest-nib.json` 的 `actions` | `rea decode-interface-builder` 的摘要 |
| macOS 实测 app | `/Applications/TickTick.app`（8.2.03） | 436 个 nib，`Base.lproj/MainMenu.nib` 是入口 |
| Windows 托管字符串 | `/tmp/rea-lab/win/app/TickTick.exe`（8.2.5.0） | UTF-16LE 扫 `#US` 堆（**不是** `strings`，macOS 的 `strings` 不支持 `-el`） |
| Windows 全局热键证据 | `/tmp/rea-lab/win/app/NHotkey.dll`、`NHotkey.Wpf.dll` | 装出来的两个 DLL 就在 `app/` 下 |
| Windows 多语言资源 | `/tmp/rea-lab/win/ui/*.baml`（639 个） | 托盘 / 快捷键页的文案在这里 |

复跑 macOS 那份（REA 在 `/tmp/rea-lab/cli/node_modules/.bin`，单次上限 64 个文档）：

```bash
/tmp/rea-lab/cli/node_modules/.bin/rea decode-interface-builder /Applications/TickTick.app \
  --max-documents 64 --format json > /tmp/rea-lab/out/nib-mainmenu.json
# ⚠️ `--format json` 不能省：默认输出是 toon（`evidence_id: …` 那种），不是 JSON。
```

复跑数字（本文所有计数都是这条命令现量的，不是抄的）：

```bash
python3 - <<'EOF'
import json
d = json.load(open('/tmp/rea-lab/out/menu.json'))
leaf = [(k, i, m) for k, v in d.items() if k != '_NSMainMenu|Main Menu' for i, m in enumerate(v, 1)]
print('keys:', len(d), 'leaf:', len(leaf), 'with-key:', sum(1 for _, _, m in leaf if m['key']))
EOF
# → keys: 9 leaf: 55 with-key: 13
```

**`menu.json` 是制品，不是命令的产物** —— 生成它的那支脚本已经不在 `/tmp` 里了（被后续步骤覆盖）。
所以它的 `key` 字段本文没有原样复跑，而是**独立复核**了一遍：直接数 `MainMenu.nib` 值段里的
**单字符字符串记录**（`0x81` = "长度为 1 的字符串"记录头），看出现的字符集是否等于 `menu.json` 里那 12 个不同的键：

```bash
python3 - <<'EOF'
data = open('/Applications/TickTick.app/Contents/Resources/Base.lproj/MainMenu.nib','rb').read()
body = data[3415:]            # 值段起点（键表 54 个键名占 2596..3414）
cnt = {}
for i in range(len(body)-1):
    if body[i] == 0x81 and 0x20 <= body[i+1] < 0x7f:
        cnt[chr(body[i+1])] = cnt.get(chr(body[i+1]), 0) + 1
print(len(cnt), sorted(cnt.items(), key=lambda kv: -kv[1]))
EOF
# → 12 [(',', 1), ('h', 1), ('q', 1), ('Z', 1), ('w', 1), ('f', 1), ('m', 1),
#       ('a', 1), ('z', 1), ('v', 1), ('x', 1), ('c', 1)]
```

**结论**：整个 nib 里恰好 12 种单字符记录，字符集与 `menu.json` 的 12 个不同键**一一对上、不多不少**。
（`h` 在菜单里出现两次而记录只有 1 条 —— 相同字符串被驻留了，第二次是引用而不是新记录；
这一条同时解释了「记录条数 12」为什么 ≠ 「有键的菜单项数 13」。）

⇒ `menu.json` 的 `key` 字段有独立旁证；**`mods` 字段没有**（§6 未核实项 1）。
顺带一条：REA 那份图输出**不带键等价字段**（`nib-mainmenu.json` 上 `grep -c keyEquivalent` = 0），
所以「键等价」只能从 nib 字节或运行时拿 —— 这也是上面这段复核非做不可的原因。

### 1.2 三个数字的口径（62 / 55 / 13 各是什么）

总览文档写的是「9 个菜单、62 个非分隔菜单项」，这两个数字都对，但它们的口径不同 ——
**62 里含最顶层那一行菜单栏自身的 7 个条目**（应用名、File、Edit、List、Task、Window、Help）。
本篇统一用 **55**（叶子项）来说事，因为「菜单栏自己那一行有几个条目」不是一个可以被
「heyta 有没有等价入口」的东西：

```
9 个 key    = 8 个菜单桶（应用 / File / Edit / Task / List / Window / Speech / Help）+ 1 个 Main Menu
62 行       = 7（Main Menu 那一行本身）+ 55（叶子项）
55 叶子项   = TickTick 8 + File 3 + Edit 10 + Task 11 + List 13 + Window 6 + Speech 2 + Help 2
              ⚠️ Edit 第 10 项是 Speech 子菜单的父项，它的 2 个子项单独计了行（所以 55 不是 54）
13 带键     = 应用菜单 4（⌘, / ⌘H / ⌥⌘H / ⌘Q）+ Edit 6 + Window 3
```

按「谁提供的」再切一刀，这一刀是 §3 的全部论点所在：

| 组 | 项数 | 带键 | 谁提供 |
|---|---|---|---|
| 应用菜单（关于/偏好/更新/服务/隐藏/退出） | 8 | 4 | 应用 + AppKit |
| Edit（拼写三项 / 撤销重做 / 全选 / 剪切复制粘贴 / 语音） | 10 | 6 | AppKit 首响应者 |
| Window | 6 | 3 | AppKit |
| Speech 子菜单 | 2 | 0 | AppKit |
| **File（加任务 / 搜索 / 同步）** | **3** | **0** | 它自己的业务 |
| **Task（完成 / 优先级 ×4 / 日期 ×5 / 打印）** | **11** | **0** | 它自己的业务 |
| **List（13 个顶层视图）** | **13** | **0** | 它自己的业务 |
| **Help（帮助 / 官网）** | **2** | **0** | 它自己的业务 |

> **29 个业务项 = File 3 + Task 11 + List 13 + Help 2，带键 0 个。** 这就是 §3 的那句话。

### 1.3 一条纪律：selector 名 ≠ 已实现的功能

`digest-nib.json` 的 `actions` 里 327 个 selector，名字看起来很像功能：

```bash
python3 - <<'EOF'
import json, re
a = json.load(open('/tmp/rea-lab/out/digest-nib.json'))['actions']
pat = re.compile(r'moveTo|priority|complete|date|print|sync|search|addTask|delete', re.I)
hits = [k for k in a if pat.search(k)]
print('total:', len(a), 'menu-ish:', len(hits))
EOF
# → total: 327 menu-ish: 20
```

那 20 个里 `moveToTodayClicked:` / `priorityButtonClicked:` / `deleteTaskButtonClicked:` 之类，
**只证明「某个 nib 里有一枚按钮连到了这个方法」**。它证明不了三件事：

- 菜单里有没有这一项（那只能看 `menu.json`）；
- 这个方法体里做了什么（IB 只记连接，不记实现）；
- 这个名字是不是历史残留（改名后连接可能还挂着）。

本篇因此**只用 `menu.json` 判「有没有菜单项」**，`digest-nib.json` 只在 §5 需要说
「它的动作是按钮驱动的」时引用一次，且明确标注是「连接」而不是「功能」。

---

## 2. 菜单结构对照：55 项逐项

下表每一行的「heyta 等价入口」都指到一个 `文件:行号`。
**「无」是结论，不是没查** —— 「无」的那几行下面都给了「怎么确认无」的命令。

### 2.1 应用菜单（8 项）

| # | 它的项（功能描述） | 键 | heyta 等价入口 | 判据 / 备注 |
|---|---|---|---|---|
| 1 | 关于 | — | 设置页「帮助」区 | `apps/web/src/features/settings/HelpPanel.tsx:12-16`（三条站外入口：文档 / 更新日志 / 定价） |
| 2 | 偏好（`Preferences…`，**引文 1/2**） | ⌘, | 设置窗口 | `apps/desktop/src/settings-shortcut.ts:20` + `apps/desktop/src/main.ts:320`；**这是全仓唯一的组合键** |
| 3 | 检查更新 | — | **无** | `grep -rn "checkForUpdate\|checkUpdate\|updateCheck" --include=*.ts --include=*.tsx apps packages \| grep -v node_modules \| grep -v /dist` = **0 命中**；heyta 是本地优先，没有更新通道 |
| 4 | 服务（Services 子菜单） | — | **无** | 这是 AppKit 的进程间入口，Web/Electron 没有对应物 |
| 5 | 隐藏自己 | ⌘H | **无自定义** | 走 OS/Electron 默认菜单；见 §2.6 的说明 |
| 6 | 隐藏其他 | ⌥⌘H | **无自定义** | 同上 |
| 7 | 全部显示 | — | **无自定义** | 同上 |
| 8 | 退出 | ⌘Q | **无自定义** | `apps/desktop/src/main.ts:351` 有单实例锁，但没有自定义退出项 |

> 关于「无自定义 ≠ 不可用」：`apps/desktop/src/main.ts` 全程**没有**调用
> `Menu.setApplicationMenu`，所以 macOS 上跑的是 Electron 的默认菜单模板（它自带
> Edit 的 role 与 Window 的几项）。这条**未在打包产物里点过**，见 §6 未核实项 4。

### 2.2 File（3 项）

| # | 它的项 | 键 | heyta 等价入口 | 判据 |
|---|---|---|---|---|
| 1 | 加任务 | — | 捕获框 | `apps/web/src/App.tsx:3145`（`<CaptureComposer destination={…} />`）；捕获框的日期面板 `apps/web/src/features/capture/CaptureDuePopover.tsx:1-30` |
| 2 | 搜索 | — | 搜索视图 | `apps/web/src/features/shell/view-tabs.ts:285-289`（`SEARCH_VIEW_TAB`）；视图渲染走 `App.tsx` 的 `view === 'search'` 分支 |
| 3 | 同步 | — | 同步状态条 + 同步设置 | `apps/web/src/features/sync/SyncBar.tsx:106`（`describeSyncStatus`）、`apps/web/src/features/sync/SyncSettingsPanel.tsx:128` |

> 🔴 注意口径差异：它的「同步」是**一个可以单独触发的菜单动作**，heyta 的同步入口分两半：
> **观察**在状态条（`apps/web/src/features/sync/SyncBar.tsx:106`），**触发**在设置面板那颗「保存并同步」按钮上
> （`apps/web/src/features/sync/SyncSettingsPanel.tsx:272` 调 `sync.syncNow()`）。
> ⇒ heyta **有**「立刻同步」这个动作，但它被绑在「保存配置」流程里，不是一个可以单独
> 唤起（菜单/快捷键）的命令。这一格是与它对不上的地方。

### 2.3 Task（11 项）—— 它把「原子动作」放进菜单

这一组是它与 heyta 差得最远的一组：11 项全是**改属性的原子动作**，heyta 的对等物
散在三处（行菜单 / 日期编辑器 / 复选框），没有一处是「可以被菜单栏唤起的命令」。

| # | 它的项 | 键 | heyta 等价入口 | 判据 |
|---|---|---|---|---|
| 1 | 清空日期 | — | 日期面板的「清除」 | `apps/web/src/features/tasks/DueEditor.tsx:164`（`clear: t('web.due.clear')`） |
| 2 | 完成任务 | — | 行的复选框 | `packages/ui/src/task-list/TaskRow.tsx:350`（`accessibilityRole="checkbox"`）、`packages/ui/src/task-list/TaskRow.tsx:360`（`onPress={() => onToggleTask(row.id)}`） |
| 3 | 设高优先级 | — | 行菜单「优先级」子菜单 | `apps/web/src/features/tasks/TaskRowMenu.tsx:374` |
| 4 | 设低优先级 | — | 同上（同一行的 4 档循环） | `apps/web/src/features/tasks/TaskRowMenu.tsx:374` |
| 5 | 设中优先级 | — | 同上 | `apps/web/src/features/tasks/TaskRowMenu.tsx:374` |
| 6 | 设无优先级 | — | 同上（`Priority.None` 是那 4 档之一） | `apps/web/src/features/tasks/TaskRowMenu.tsx:374` |
| 7 | 打印 | — | **无** | `grep -rn "window.print\|print(" apps/web/src packages/ui/src` = 0 命中 |
| 8 | 设日期（开日期选择器） | — | 日期面板的月历 | `apps/web/src/features/tasks/DueEditor.tsx:157`（`<DatePicker …/>`） |
| 9 | 设到下周 | — | 日期面板的快捷项 `next-week` | `apps/web/src/features/tasks/DueEditor.tsx:113`（`'next-week': 'web.due.nextWeek'`）、`:141`（`quickDuePickDates`） |
| 10 | 设到今天 | — | 快捷项 `today` | `apps/web/src/features/tasks/DueEditor.tsx:110` |
| 11 | 设到明天 | — | 快捷项 `tomorrow` | `apps/web/src/features/tasks/DueEditor.tsx:111` |

> 同一张表读第二遍会看到一个形状：**它的 4 个优先级是 4 个独立菜单项**（每一档一次点击），
> 而 heyta 是一个子菜单里的 4 个选项（`apps/web/src/features/tasks/TaskRowMenu.tsx:374` 一次 `map`）。
> 对鼠标用户这是「少一次点击 vs 少一个层级」的取舍；**对键盘用户这不是取舍** ——
> 菜单栏的 11 项可以用「Control+F2 + 首字母」直达，而 heyta 必须先 Tab 到行、Enter 开菜单、
> 再进子菜单（§4.3 数过步数）。

### 2.4 List（13 项）—— 它的顶层视图就是菜单项

| # | 它的项（视图） | 键 | heyta 等价入口 | 判据 |
|---|---|---|---|---|
| 1 | 番茄/专注 | — | `focus` 视图 | `apps/web/src/features/shell/view-tabs.ts:240` |
| 2 | 全部 | — | `tasks` 视图 + `{kind:'all'}` 筛选 | `apps/web/src/features/shell/view-tabs.ts:193`、`packages/domain/src/task-filter.ts:52` |
| 3 | 指派（按人筛选） | — | **无** | `packages/ui/src/sync/notification-model.ts:125` 自己记着：`Task.assigneeUserId` **全仓零写点** |
| 4 | 日历 | — | `calendar` 视图 | `apps/web/src/features/shell/view-tabs.ts:221` |
| 5 | 已完成 | — | 侧栏「已完成」行 | `apps/web/src/features/shell/view-tabs.ts:116`（`{ filter: { kind: 'completed' } }`） |
| 6 | 习惯 | — | `habits` 视图 | `apps/web/src/features/shell/view-tabs.ts:238` |
| 7 | 收集箱 | — | `{kind:'all'}`（**没有独立入口**） | `apps/web/src/features/shell/view-tabs.ts:78-88` 的注释写明「这里没有收集箱那一行」是产品裁决；入口搬到 rail 的「任务」 |
| 8 | 四象限 | — | `quadrant` 视图 | `apps/web/src/features/shell/view-tabs.ts:237` |
| 9 | 今天 | — | 侧栏「今天」行 | `apps/web/src/features/shell/view-tabs.ts:88` |
| 10 | 明天 | — | **无** | `packages/domain/src/task-filter.ts:51-58` 的 7 个 `kind` 里没有 tomorrow |
| 11 | 最近 7 天 | — | 侧栏「最近 7 天」行 | `apps/web/src/features/shell/view-tabs.ts:101` |
| 12 | 统计汇总 | — | **近似**：`growth` 视图 | `apps/web/src/features/shell/view-tabs.ts:241`；heyta 的「成长」是动机/连续打卡面，**不是**它的统计面 —— 这一格是分叉点，不是等价 |
| 13 | 回收站 | — | 侧栏底部「回收站」 | `apps/web/src/features/shell/view-tabs.ts:273`（`SIDEBAR_TOOL_TABS`） |

> 13 项里 heyta **有 10 个可对应**（其中第 7、12 格是"同一目的地的另一种拆法"），
> **3 个没有**：指派、明天、以及统计那个真正的"汇总"面。

### 2.5 List 菜单的标题是一个模板（引文 2/2）

13 个标题全部长成 `Open "<视图名>"` 的形状。这条不是文案洁癖，它是**结构证据**：

- 如果标题是手写死的，13 条会各有各的写法（"打开…" / "前往…" / "…视图"）；
- 它 13 条**同一个模板**，说明菜单是**从一份视图登记表生成的** ——
  这份表既是侧栏的数据源，也是菜单的数据源。

heyta 已经有同一形状的底座：`apps/web/src/features/shell/view-tabs.ts` 是「导航/视图登记的
**唯一一份**定义」（该文件第 1-6 行自述），`splitRailTabs` 就是在这份表上做纯函数裁决。
⇒ **heyta 离「视图 = 菜单项」只差一个消费者，不缺登记表。** 这条是 §5 第 1 条的根据。

### 2.6 Edit / Window / Speech / Help（其余 20 项）

| 组 | 项数 | heyta 情况 | 判据 |
|---|---|---|---|
| Edit：拼写三项（自动纠正 / 语法 / 边打边查） | 3 | **无** | Web 端没有拼写检查开关：全仓唯一一处是**关掉**它（`packages/ui/src/overlay/DangerDialog.tsx:239` 的 `spellCheck={false}`），没有任何地方开启或配置 |
| Edit：撤销 / 重做 | 2 | **无全局撤销** | heyta 的撤销是**回执级**（5 秒 toast），不是可回滚的历史（`scripts/check-undo-receipt.mjs:1-30`）；生产代码里没有历史栈 —— `grep -rn "undoStack\|redoStack" --include=*.ts --include=*.tsx apps packages \| grep -v node_modules \| grep -v /dist` 只命中 3 行，**全在 `apps/web/tests/local-data-destruction.spec.ts` 这个测试文件里** |
| Edit：全选 / 剪切 / 复制 / 粘贴 | 4 | **无自定义** | 走浏览器/OS 默认；heyta 只在多选态有自己的选择模型（`check:selection-single-source`） |
| Edit：语音（Speech 子菜单的两个子项；父项已在 Edit 那 10 项里） | 2 | **无** | 系统朗读服务，Web 端无对应物 |
| Window：主窗口 / 关闭 / 全屏 / 最小化 / 缩放 / 全部置前 | 6 | **无自定义** | 见 §2.1 末尾那条：Electron 默认菜单负责，未在产物上核实 |
| Help：帮助中心 | 1 | 设置页「帮助」区 | `apps/web/src/features/settings/HelpPanel.tsx:13`（`/docs`） |
| Help：访问官网 | 1 | **近似**：更新日志 / 定价 | `apps/web/src/features/settings/HelpPanel.tsx:14-15`（`/changelog`、`/pricing`）；没有"回官网首页"这一条 |

> Edit 那 2 项（撤销 / 重做）值得单独记一笔：在**「OS 本来会代劳」那一批**里，它是唯一一个
> **heyta 底下没有对应结构**的 —— 剪切/复制/粘贴/全选在 heyta 里都指哪打哪有东西可操作，
> 而撤销需要一条历史栈，heyta 没有（只有 5 秒回执）。
> ⇒ **照抄 `⌘Z` 不会得到任何东西。** 这是本篇里唯一一个"抄了也没用"的键。
>
> 补充口径（免得「唯一」被读大）：整份对照里「它有能力、heyta 连近似都没有」的**不止一处** ——
> 检查更新、服务、语音朗读、**打印**、**指派视图**、**明天视图**、**统计汇总面**、**全局撤销**
> 都属于这一类。上面那句「唯一」限定的范围是**Edit 那 4 个 OS 代劳项之内**。

---

## 3. 快捷键清单与冲突检测

### 3.1 它给了什么：13 / 55，而且全部落在标准项上

`menu.json` 里带键的 13 项（`key` 字段是**字符**，`mods` 字段**全部是 `null`** —— 见 §6 未核实项 1）：

| 组 | 项 | 键 | 归属 |
|---|---|---|---|
| 应用菜单 | 偏好（同 §2.1 第 2 项） | ⌘, | 应用 |
| 应用菜单 | 隐藏自己 / 隐藏其他 | ⌘H / ⌥⌘H | AppKit |
| 应用菜单 | 退出 | ⌘Q | AppKit |
| Edit | 撤销 | ⌘Z | 首响应者 |
| Edit | 重做 | ⇧⌘Z | 首响应者（`key` 是**大写 `Z`**，在 Cocoa 里大写本身即带 Shift） |
| Edit | 全选 / 剪切 / 复制 / 粘贴 | ⌘A / ⌘X / ⌘C / ⌘V | 首响应者 |
| Window | 关闭 / 全屏 / 最小化 | ⌘W / ⌃⌘F / ⌘M | AppKit |

三件事值得单独指出：

1. **`mods` 全为 `null`。** ⌘ 这个修饰符是**推断**（Apple 惯例 + 这些 selector 的标准绑定），
   不是这份数据给的。数据里唯一能证修饰键的是**大小写**：`Z` 大写 ⇒ 带 Shift。
   ⇒ 「⇧⌘Z」是数据内证据；「⌃⌘F」是惯例推断。两者的可信度不同，别混着引用。
2. **13 个键里有 3 个是"重复占用"**：`h` 出现两次（隐藏自己 ⌘H / 隐藏其他 ⌥⌘H），
   区分它们的修饰键在这份数据里看不见。
3. **没有一个键是它自己的业务动作。** 唯一的例外是 `⌘,`，而那是 AppKit 的偏好面板惯例。

### 3.2 它没给什么 —— 这比给了什么更有信息量

**29 个业务动作，0 个键**（§1.2 的表）。具体到「用户一天点几十次」的那几格：

| 高频动作 | 它有键吗 | 它在哪 | heyta 有键吗 |
|---|---|---|---|
| 加任务 | ❌ | File 第 1 项 | ❌ |
| 搜索 | ❌ | File 第 2 项 | ❌ |
| 同步 | ❌ | File 第 3 项 | ❌ |
| 完成任务 | ❌ | Task 第 2 项 | ❌（Space 只作用于**已聚焦的**复选框，`packages/ui/src/task-list/TaskRow.tsx:350`） |
| 切视图 ×13 | ❌ | List 13 项 | ❌ |
| 设优先级 ×4 | ❌ | Task 第 3-6 项 | ❌ |
| 设日期 ×5 | ❌ | Task 第 1、8-11 项 | ❌（行内日期编辑器，无键） |
| 打印 | ❌ | Task 第 7 项 | 无此功能 |

所以「它的 macOS 端键盘可用性」是这样成立的：**菜单栏本身就是键盘可达的**
（Control+F2 进菜单栏 → 方向键/首字母 → Return），所以它**不需要**给这 29 项配键也能被
纯键盘用。这不是疏忽，是一个有代价的选择：代价是**每个动作至少 3 次按键 + 一次菜单导航**，
收益是**0 个键位冲突、0 份需要维护的键位表**。

对比 Windows 端（§4.2）：同一家公司、同一批功能，那边做了一个**专门的快捷键设置页**
（所以键位是「可配的」，不是硬编码的）+ **7 个全局热键槽位**。⇒ **两个平台的键盘策略不是"同一套做了一半"，是两套不同的答案。**

### 3.3 与 heyta 现有键的冲突检测

heyta 今天的键，全量在这里（这就是「全部」，不是抽样）：

| 键 | 作用域 | 出处 |
|---|---|---|
| `⌘,` / `Ctrl+,` | 全局（Electron 主进程，仅 `keyDown`） | `apps/desktop/src/settings-shortcut.ts:20`、`apps/desktop/src/main.ts:320` |
| `↑` `↓` | 列表光标 | `apps/web/src/lib/keyboard-cursor.ts:244` |
| `Enter` | 打开当前格（焦点交给详情） | `apps/web/src/lib/keyboard-cursor.ts:246`、`apps/web/src/lib/keyboard-cursor.ts:213-224` |
| `Space` | 复选框 / 菜单项激活 | `apps/web/src/lib/keyboard-cursor.ts:245`、`packages/ui/src/control/menu.ts:137` |
| `Esc` | 关浮层 / 菜单 / 对话框 | 全仓 14 处（`apps/web/src/App.tsx` 内 2 处 + 各浮层组件），判断层在 `packages/ui/src/control/menu.ts:131` |
| `Tab` / `⇧Tab` | 离开即收起菜单 | `packages/ui/src/control/menu.ts:134` |
| `Home` / `End` | 菜单 / tablist 两端 | `packages/ui/src/control/menu.ts:139-142`、`apps/web/src/lib/tab-roving.ts:62-63` |
| `←` `→` | tablist 漫游（含 heatmap 的二维） | `apps/web/src/lib/tab-roving.ts:53-54`、`packages/ui/src/motivation/ActivityHeatmap.tsx:254` |
| `ContextMenu` / `⇧F10` | 开行菜单 | `apps/web/src/App.tsx:1834` |

复跑（这条命令的输出就是上表的来源）：

```bash
grep -rn "key === '" --include=*.ts --include=*.tsx apps/web/src packages/ui/src apps/desktop/src \
  | grep -o "key === '[^']*'" | sort | uniq -c | sort -rn
# 输出里 `'tasks'` / `'search'` / `'settings'` / `'calendar'` / `'failedOff'` 是筛选键、
# 不是键盘键 —— 判据是它们出现在 `===` 比较里但那个变量不是 `event.key`。
# `'Escape'` 那 14 处按文件数：apps/web/src 下 12 个组件各 1 处 + App.tsx 2 处。
```

**冲突检测结论：**

| 它的键 | heyta | 结论 |
|---|---|---|
| ⌘, | 已占用，**同义**（开设置） | ✅ 一致，无需改 |
| ⌘Z / ⇧⌘Z | 未绑定 | ⚠️ **不与现有键冲突，但 heyta 底下没有历史栈** ⇒ 绑上去是空操作（§2.6） |
| ⌘A / ⌘C / ⌘V / ⌘X | 未绑定（浏览器默认） | ✅ 无冲突；若将来自建应用菜单要按 role 补齐 |
| ⌘W / ⌘M / ⌃⌘F | 未绑定 | ✅ 无冲突（Electron 默认菜单已在管，未核实） |
| ⌘H / ⌥⌘H / ⌘Q | 未绑定 | ✅ 无冲突（AppKit/OS） |

⇒ **0 个真实冲突**。今天从滴答照抄任何一个键都不会撞上 heyta 已有的键。
但注意 heyta 的键**绝大多数是"裸键"**（方向键/Enter/Esc/Space），而它给的全是**组合键** ——
两类键的冲突面本来就不重叠。真正的风险在 heyta 自己往后加组合键时（那时才会撞）。

**它没有配、heyta 也没有配的（= 共同的空地，按 Windows 端的做法最该先填）：**
`⌘N`（加任务）、`⌘F` / `⌘K`（搜索）、`⌘1..9`（切视图）、全局「显示/隐藏」。
（`⌘,` 不在这个列表里 —— 那是唯一一个两边都有且语义相同的键。）

---

## 4. 两种平台的第一类入口差异

### 4.1 macOS：菜单栏是「第一类入口」

`MainMenu.nib` 的 9 个菜单桶里有 4 个是它自己长的（File / Task / List / Help），
其中 List 13 项直接把**全部顶层视图**摊在菜单栏上。这一层的性质：

- **不需要窗口焦点就能被列出来**（菜单栏属于应用，不属于某个窗口）；
- **不需要预先知道键位**（Control+F2 进菜单，方向键走）；
- **不需要为每一项维护一个键**（0 个业务键仍然全可达）。

代价：它只在 macOS 成立。同一个应用在 Windows 上没有菜单栏可放。

### 4.2 Windows：托盘 + `NHotkey` 全局热键 + 一张快捷键设置页

| 证据 | 读数 | 怎么取的 |
|---|---|---|
| 全局热键库 | `NHotkey.dll` + `NHotkey.Wpf.dll` 在 `app/` 下（这是 WPF 的 `RegisterHotKey` 封装） | `ls /tmp/rea-lab/win/app \| grep -i nhotkey` |
| 热键槽位（7 个） | `Ic.HotKey.GlobalAdd` / `ShowHideApp` / `Completed` / `Matrix` / `Habit` / `Focus` / `Anniversary` | UTF-16LE 扫 `#US` 堆 |
| 快捷键设置页 | `/TickTick;component/views/config/shortcutsconfig.xaml`、`…/hotkeycontrol.xaml` | 同上（XAML 的 BAML 路径就是页面登记） |
| 一张快捷键示意图 | `shortcut_45.png`（**资源名里的 "45" 不等于 45 个键位** —— 那只是文件名，键位数没核） | 同上 |
| 系统托盘 | 文案「请在系统托盘右键 TickTick 图标以添加桌面小部件」（用户可见的引导语） | `ui/resource_stringresource_stringresource.zh-cn.baml` |
| 开机进托盘 | 文案「开机启动至系统托盘」+「最小化到系统托盘时锁定」 | 同上 |
| 默认组合（**字面量，非绑定关系**） | `Alt+Shift+A`、`Ctrl+Shift+E`、`Ctrl+Shift+L`、`Ctrl+Alt+P`、`Ctrl+K`、`Ctrl+1,2...` | UTF-16LE 扫 `#US` 堆 |

复跑：

```bash
python3 - <<'EOF'
import re
data = open('/tmp/rea-lab/win/app/TickTick.exe','rb').read()
runs = [(m.start(), m.group().decode('utf-16le'))
        for m in re.finditer(rb'(?:[\x20-\x7e]\x00){3,}', data)]
for o, s in runs:
    if 'Ic.HotKey.' in s or 'hotkeycontrol' in s or 'shortcutsconfig' in s:
        print(o, s)
EOF
```

🔴 **这一段的证据强度必须说清**：`Ic.HotKey.*` 的**存在**是硬证据（它是字符串常量，
被 XAML/配置读写）；而「`Alt+Shift+A` 就是 `GlobalAdd` 的默认值」是**相邻推断** ——
那两个字符串在 `#US` 堆里挨着，不等于代码里是这么配的（见 §6 未核实项 3）。
所以本篇只用它来支持一个弱结论：**那边确实有一批可配置的默认组合键**，
不用它来断言「按 Alt+Shift+A 一定全局加任务」。

### 4.3 纯键盘可达性表：不给鼠标，能用多少

口径：从「应用在前台、焦点在某处」出发，到「动作发生」。三档符号：
✅ = 可达且路径短（菜单/热键直达）；⚠️ = **可达但要先走一段 Tab 或有嵌套层**；❌ = 不可达；
`—` = 该平台没有这个东西。**三档都不是猜的**：macOS 那一列的依据是 §2 的菜单项存在性
（菜单项存在 ⇒ Control+F2 可达），Windows 那一列的依据是 §4.2 的槽位与字面量，
heyta 那一列逐格给了 `文件:行号`。

| 能做的事 | macOS 滴答（8.2.03） | Windows 滴答（8.2.5.0） | heyta（今天） |
|---|---|---|---|
| 切到任一顶层视图 | ✅ Control+F2 → List → 方向键/首字母（13/13 项都在） | ✅ 有 `Ctrl+1,2...` 与 5 个**视图级热键槽位**（按槽位名推断：完成/矩阵/习惯/专注/纪念日） | ⚠️ 可达：Tab 到 rail（`role="tablist"`）→ 方向键/Home/End（`apps/web/src/lib/tab-roving.ts:36`）；但**默认编排下 12 个视图里 8 个在「更多」里**，还要再开一层（`apps/web/src/features/shell/view-tabs.ts:326` 的 `splitRailTabs`，主段固定 4 个） |
| 切到未在台面的视图 | ✅ 同上（菜单里一项不落） | ✅ 同上 | ⚠️ 多一层：进「更多」菜单 → 方向键 → Enter（`packages/ui/src/control/menu.ts:131-148`） |
| 加任务 | ✅ Control+F2 → File → 第 1 项 | ✅ **全局热键**（后台也响应） | ⚠️ 捕获框在某视图内；无全局键，无 `⌘N` |
| 搜索 | ✅ Control+F2 → File → 第 2 项 | ✅ `Ctrl+K`（指令菜单）/ 页内搜索 | ⚠️ 切到搜索视图（同上，可能两层） |
| 完成任务 | ✅ Control+F2 → Task → 第 2 项 | ✅ `Ctrl+Shift+D`（字面量） | ✅ Tab 到行 → 行内复选框 → Space（`packages/ui/src/task-list/TaskRow.tsx:350`） |
| 设优先级 | ✅ Control+F2 → Task → 第 3-6 项 | ✅（快捷键页里有该组） | ⚠️ Tab 到行 → `⇧F10`/`ContextMenu`（`apps/web/src/App.tsx:1834`）→ 方向键进子菜单 → Enter（`apps/web/src/features/tasks/TaskRowMenu.tsx:374`） |
| 设日期（今/明/下周） | ✅ Control+F2 → Task → 第 9-11 项 | ✅（快捷键页里有该组） | ⚠️ 开日期编辑器 → 方向键到快捷项 → Enter（`apps/web/src/features/tasks/DueEditor.tsx:110-113`） |
| 撤销 | ✅ 菜单 / ⌘Z（有历史栈） | ✅ `Ctrl+Z` | ❌ **无全局撤销**：只有 5 秒回执（`scripts/check-undo-receipt.mjs:1-30`） |
| 后台唤起自己 | —（应用级，无全局热键） | ✅ `ShowHideApp` 全局热键 | ❌ 无托盘、无全局热键 |
| 窗口/应用级（关窗、最小化、退出） | ✅ 菜单 | ✅ 托盘 + 系统菜单 | ⚠️ Electron 默认菜单（未核实） |

**读这张表得到的三个事实：**

1. **macOS 的「0 个业务键」不亏**：菜单栏把所有业务动作都做成了可达，
   代价只是按键数多。**「有没有键」和「纯键盘能不能用」是两个问题**，
   滴答的 macOS 端是这两件事分离得最干净的样本。
2. **Windows 的覆盖面最宽**，但它的覆盖面依赖一个 heyta 完全没有的东西：
   全局热键（进程不在前台也能响应）。heyta 的键**全部要求窗口在前台且焦点在某个区域**。
3. **heyta 唯一真正的「不可达」是撤销**（不是"少几枚键"，是底下没有栈）；
   其余是「多几步」。§5 的三条据此排优先级。

---

## 5. 可借鉴三条

### 5.1 把「视图」做成菜单项：登记表已经有了，缺的是第二个消费者

- **它怎么做**：List 13 项 = 13 个顶层视图，13 个标题同一个模板（§2.5）⇒
  新增一个视图 = 登记表加一行 = 菜单自动多一项。
- **证据**：`menu.json` 的 List 桶 13 项、13/13 同前缀（§1.1 命令）。
- **heyta 现状**：`apps/web/src/features/shell/view-tabs.ts:1-7` 自述是「唯一一份定义」，
  `splitRailTabs`（`apps/web/src/features/shell/view-tabs.ts:326`）在它上面做纯函数裁决；`ViewKey` 有 12 个值（`apps/web/src/features/shell/view-tabs.ts:127-139`）。
- **该学什么**：**不要新增一份视图表**。给这份表加一个「可被命令唤起」的消费者
  （命令面板 / 未来的应用菜单），让每个 `ViewKey` 自动获得一个入口与一个稳定 id。
  判据可以做成：`view-tabs.ts` 里每新增一个 `key`，命令登记表**必须**跟着多一条，
  否则门禁红 —— 这正是本仓 `check:menu-keyboard` 那类「按源码对账」的做法
  （`scripts/check-menu-keyboard.mjs:1-40` 的 M1/M3）。

### 5.2 键位要给「原子动作」，不给「视图」—— 而且要有一处总表

- **它怎么做**：macOS 端**不给**视图配键（13 个视图 0 个键），Windows 端反过来，
  给了一个**可配置的快捷键设置页** + 视图级热键槽位（5 个）+ 7 个 `Ic.HotKey.*` 槽位。
- **证据**：§1.2 的 13/55 计数器 + §4.2 的 `shortcutsconfig.xaml` / `hotkeycontrol.xaml` /
  `Ic.HotKey.*` 七个槽位。
- **heyta 现状**：键判断散在三处，且各有各的口径 ——
  `apps/web/src/lib/keyboard-cursor.ts`（列表光标）、`packages/ui/src/control/menu.ts`
  （`role="menu"`）、`apps/web/src/lib/tab-roving.ts`（`role="tablist"`），
  外加 Electron 主进程那一枚 `⌘,`（`settings-shortcut.ts`）。**四份，四个物理位置。**
- **该学什么**：heyta 要走的是 Windows 那一档（本地优先桌面应用、没有 macOS 菜单栏可依赖），
  那么第一件事不是"加键"，而是**把「键 → 命令 id」做成一张表**，
  再让上面四处都从那张表读。否则第 5 枚键会出现第 5 份判断 —— 而这类重复在本仓
  已经有前科：`packages/ui/src/control/menu.ts:1-25` 记着「三枚菜单三种答案」那次现量。

### 5.3 全局唤起（显示/隐藏 + 快速添加）是分水岭，不是锦上添花

- **它怎么做**：Windows 端 `Ic.HotKey.ShowHideApp` 与 `Ic.HotKey.GlobalAdd` 是两个独立槽位，
  文案里明说「应用即使在后台，也能响应的快捷键」。
- **证据**：§4.2 的字符串清单（`GlobalAdd` / `ShowHideApp` 与那句后台说明）。
- **heyta 现状**：`apps/desktop/src/main.ts:320` 的 `before-input-event` 只挂在
  **主窗口的 webContents** 上 —— 窗口不在前台时它一个键都收不到；
  `grep -rn "globalShortcut" apps/` = **0 命中**。
- **该学什么**：**先补「显示/隐藏」与「添加任务」这两个，而不是先补业务键。**
  理由不是"它做了所以我们要做"，而是 §4.3 那张表的结构：heyta 的其他所有键
  **都要求先满足"窗口在前台 + 焦点在某区域"**，而这两个动作是唯一能把用户
  **从别的应用拉回来**的入口。少了它们，「纯键盘可用」只在"用户已经在 heyta 里"时成立。

---

## 6. 未核实项（以及这一篇自己的两次判错）

| # | 未核实的东西 | 为什么没核 | 怎么才能核 |
|---|---|---|---|
| 1 | **修饰键（`mods`）全为 `null`** | `menu.json` 只留了 `key` 字符；`NSKeyEquivModMask` 存在 nib 的键表里（键表 54 个键名，含 `NSKeyEquiv` / `NSKeyEquivModMask`），但值表是 CBOR 风格编码，本篇没解开 | 解析 `MainMenu.nib` 的 NIBArchive 值段；或用 `NSMenu` 运行时打印（需要跑起 app） |
| 2 | **`ibtool` 转不出 xib** | 两次都失败，错误是 `Unable to rename classes, class name parsing failed`（`_TtC8TickTick11AppDelegate` 这类 Swift 类名，ibtool 认不出模块） | 需要 `--module` 一类的参数或 Xcode 环境；现有命令与错误已留在下面 |
| 3 | **Windows 的「键常量 ↔ 默认组合」对应关系** | 只按 `#US` 堆相邻推断（`Ic.HotKey.GlobalAdd` 与 `Alt+Shift+A` 在附近） | 反编译 `shortcutsconfig.xaml` 的 BAML 记录，或读配置默认值 |
| 4 | **Electron 默认菜单是否真的出现在产物里** | 代码里没有 `setApplicationMenu` ⇒ 按 Electron 行为推断是默认模板，但没在打包 `.app` 上点过 | 打开安装好的 heyta，看菜单栏是否有 Edit/Window |
| 5 | **`menu.json` 的生成脚本已丢失** | 它是制品，脚本被后续步骤覆盖；`key` 已由 §1.1 的单字符记录复核，但**原始提取路径不能原样复跑** | 重写一支 NIBArchive 解析器（值段编码与 `IB.objectdata` 还没解开），或改用运行时 `NSMenu` 打印 |
| 6 | **Windows 托盘菜单的确切项序** | 只取到「存在托盘」与「若干候选文案」（开机自启 / 进托盘 / 优雅退出等），没有项序证据 | 在 Windows 上右键托盘图标截图，或用 UI Automation 取 `ContextMenu` 树 |

ibtool 那一次失败的原样复跑：

```bash
ibtool --convert MainMenu.xib --output /tmp/mm2/MainMenu.xib \
  /Applications/TickTick.app/Contents/Resources/Base.lproj/MainMenu.nib
# → com.apple.ibtool.errors: "Unable to rename classes, class name parsing failed."
```

**两次判错 / 差点写错的地方（留在这里，因为它们都是"看起来对"的句子）：**

1. **「13 个 List 项 = 13 个视图，所以 13 个视图都有键」是错的。**
   第一版我在草稿里把「视图是菜单项」和「视图有快捷键」写在了同一句里。
   `menu.json` 现量：List 13 项**带键 0 个**。这两件事在它身上是**故意分开**的（§4.3 第 1 条）。
2. **「它有撤销，heyta 没有」这句要限定范围。**
   heyta **有**撤销 —— 是 5 秒回执那一档（`apps/web/src/App.tsx:570-578` 与
   `scripts/check-undo-receipt.mjs`）。缺的是**可回滚的历史栈**，
   所以 `⌘Z` 绑上去没有东西可撤。把它写成"heyta 没有撤销"会把一个精确的缺口
   说成一个模糊的缺失，而下一个人会照着"补一个撤销按钮"去做。

---

## 7. 一页速查

```
它的菜单：9 桶 / 62 行 / 55 叶子 / 13 带键 / 29 业务项 0 键
它的键：  ⌘, ⌘H ⌥⌘H ⌘Q ⌘Z ⇧⌘Z ⌘A ⌘X ⌘C ⌘V ⌘W ⌃⌘F ⌘M   （mods 全 null，⌘ 是推断）
它没给：  加任务 / 搜索 / 同步 / 完成 / 优先级×4 / 日期×5 / 13 个视图 / 打印
heyta：   1 个组合键（⌘,）+ 一批裸键（↑↓ ←→ Enter Esc Space Tab Home End ⇧F10）
冲突：    0 个；空缺：12 个
两平台：  macOS = 菜单栏（0 业务键也全可达）；Windows = 托盘 + NHotkey（7 全局槽位 + 可配置快捷键页）
先补什么：显示/隐藏、快速添加（唯二能把用户从后台拉回来的），然后是视图命令化，最后才是业务键
```
