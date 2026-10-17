# r124：`tasks-ux-ios.py` 的 42 组单语候选补成中英同义，并取到这条旅程**第一份英文设备读数**

台账那格（`docs/plans/product-ux-optimization.md` 里"披露出来的三条单语定位欠项"）写的是：
三条里两条已关（AI 那枚、`tasks-ux-android.py` r123），只剩 `tasks-ux-ios.py` 的
**3 条单语标签 + 42 组单语候选**，而且"要先按 00:5x 那格分诊（断言位的单语是判据不是欠项）"。
这一趟做的就是那一格。

- 载体：**本线新建**的模拟器 `heyta-r124-ios-en`（`iPhone 17 Pro` / iOS 27.0，udid `468CFAD2-74F2-4CBB-8183-E21C1A6C0C84`），
  语言写 `AppleLanguages = (en, zh-Hans-CN)`（全局域 `-g` 与应用域 `com.heyta` 各一遍）。
  ⚠️ 第一遍只写应用域不够，`defaults write AppleLanguages -array …`（不带 `-g`）直接报
  `Unexpected argument zh-Hans-CN; leaving defaults unchanged` —— 那是探针自己写错，不是载体不支持。
- 被测包：从共享载体 `heyta-multiend-reinstall` 的**已装 bundle 原路径**装过来
  （`…/Bundle/Application/C064A4E3-…/Heyta.app`，`1.0 / build 2`，50 M），即第七趟四端重装那枚产物，**不重新构建**。
  ⚠️ 自那枚包之后 `packages/i18n/src/locales/{en,zh-CN}.ts` 各变了 17 行，但**变动的键逐枚量过**：
  `common.share.comment.*`、`web.ai.*`、`web.categories.note` —— 没有一枚是本旅程用得到的键。
  所以"英文那一侧对得上屏"这件事在本趟没有被那批增量打掉，但**它是一条边界，不是一句"没问题"**。
- 装置版本：工作树里改后的 `scripts/qa/tasks-ux-ios.py`（未入库状态跑的设备腿，入库的就是同一份）。
- 每臂跑前都 `uninstall` + `install` 一次（全新安装态），否则首屏那两道闸根本不出现。

## 1. 分诊：42 组里哪几处是欠项

门的第二维自己写了三种失效方式（定位位点不到／`then`+`absent` 断言位是刻意／分支条件位走错岔路）。
本枚脚本逐条读完的实际分布：

| 位型 | 本枚脚本里的形状 | 处理 |
|---|---|---|
| 定位位 | `tap(...)`、`node(...)`、`wait_labels(...)` 里那 42 组候选 | **补双语**（这就是欠项本体） |
| 分支条件位 | `ensure_on_tasks` 里 `AX.find(state, "新建任务", …)`、`tap_node` 里 `AX.find(nodes, "关闭视图选项", …)` | **补双语**（走错岔路比超时坏，00:5x 那格点名的形状） |
| `absent` 位 | `wait_absent(("任务详情",))` 这类"应当消失"的断言 | **补双语** —— 🔴 单语在 `absent` 位**不是保护而是假通过**：界面是英文时"中文标签不在场"永远成立，那一条判据当场失效。00:5x 的"断言位单语是刻意"讲的是 `then`/`assert_visible`（要求某枚中文标签在场，语言不对就响亮超时），套不到 `absent` 上 |
| `then` / `assert_visible` 位 | 本枚脚本没有"分组 IA 断言"这种槽（它每条 `wait_labels` 同时是下一步能点的前提） | 与定位位同处理 |

⇒ 42 组 + 3 条**全部补完**，没有一处按"判据口径"留下。留一处不补的是**别的两枚脚本**：
`profile-settings-ios.py` 的 5 组（那是 00:5x 分诊出来的断言位，本线不动）与
`profile-settings-android.py` / `ai-assistant-atomic-android.py` 各 1 条 —— 现量见下面第 5 节。

## 2. 门的读数

| | 改前 | 改后 |
|---|---|---|
| `check-locator-labels.py scripts/qa/tasks-ux-ios.py` | 79 组（含中文 42、`T()` 0 处）＋ ⚠️3 条单语 ＋ ⚠️42 组单语候选 | 148 组（含中文 67、`T()` 67 处）＋ **两行 ⚠️ 都没有** |
| 退出码 | 0（这一维本来就只披露） | 0 |
| `CJK_GROUP_FLOOR["tasks-ux-ios.py"]` | 42 | **67** |

**基线有牙**（`mutation-arm-ios.log` / `control-arm-ios.log`）：把一组 `T("任务详情","Task details")` 改成
只留英文 ⇒ 组数 67→66 ⇒ `MUT_RC=1`，红话是"量具读到的含中文定位标签组数从基线 67 掉到 66"；
还原后 `CTRL_RC=0`。**变异还原走 `.mut-bak`，不走 git**（这份文件带着未入库的整笔改动，`git checkout --` 会连改动一起吞掉）。

## 3. "中文那一侧逐字没动"两层对账（`prove.log`，rc=0）

`prove-chinese-unchanged-ios.py`（与 Android 那把尺同一形状，标的与表换成 iOS）：

- **A 层**：含中文字面量 HEAD 36 枚去重 / 改后 34 枚。差集 8 丢 6 得，**逐枚**都在允许清单里
  （`打开任务：`、`选择：`、`视图选项：`、`移动「`、`」到其他象限`、`已选 1 项`、`已选 2 项`、
  `时间线：共 2 条任务` ⇒ 换成对应的 i18n 模板）。多一枚就判红，实测没有多。
- **B/C 层**：把 7 枚组合标签在 `ENGLISH=False/True` 下各求值一次 ⇒ 中文态逐字等于 HEAD 原来写死的那串，
  英文态逐字等于 `packages/i18n` 的 `en.ts` 词值（含 `Move “…” to another quadrant` 那对弯引号）。

## 4. 设备腿：四臂读数，含一枚否证

| 臂 | 装置 | 语言 | 结果 |
|---|---|---|---|
| `arm-head-en` | `HEAD` 那份（`tasks-ux-ios.HEAD.py` 复制到 `scripts/qa/` 同深度跑，跑完即删） | 英文 | **红**：`workspace did not open after onboarding`，报告里**没有** `uiLocale` 字段（旧版不写），`steps: []` |
| `arm-patched-en` | 改后第一版 | 英文 | **红**：同一句 `workspace did not open after onboarding`，`uiLocale zh-CN` ⇒ 见下面第 6 节，这是**本笔自己带进来的探针缺陷** |
| `arm-patched-en2` | 改后＋判定改每轮重算 | 英文 | **12/13 步过**，`uiLocale en`，`01`…`11` 全绿（含四象限移动＋撤销、视图选项排序/日期、时间线行开详情、展开/收起排期）；红在第 13 枚 `12-detail-keyboard-visible-and-unobstructed` |
| `arm-patched-zh` / `arm-fresh-zh-ab` | 改后（同一枚英文载体切回中文、全新安装态） | 中文 | 同样**12 步过、红在同一枚键盘步**，`uiLocale zh-CN` |
| `arm-patched-zh-legacy` | 改后 | 中文，**旧载体 `FE195661`**（出过那两枚 `passed` 读数、`keyboardTop=545` 的那台） | 同样红在键盘那一步 |

⇒ **英文那一侧第一次有了设备读数**，而且与负对照同载体同状态：`HEAD` 那份连首屏都过不去，
改后那份 12 步全过。这一对是本笔"补双语补对了"的强证据。

## 4.5 人看图那一半（AGENTS §6.2 规定一）

两枚臂的逐步截图各拼成一张对照页看过：
`contact-arm-patched-en2.png`（英文 12 枚 + failure）与 `contact-arm-patched-zh.png`（中文同 13 枚）。
逐格读到的（不是推测，是图上的字）：

- 英文那一侧整条旅程都在渲染英文，且**每一枚本笔补的定位符都对得上屏**：
  `Sun, 10/18` / `2 to do, 0 done` / `Search tasks` / `List` / `Select tasks` /
  `1 selected` → `2 selected` / `Exit selection` / `Complete selected` / `Move to list` /
  `Timeline` / `Unscheduled (2)` / `Delegate — Urgent, not important` / `Drop — Not important, not urgent` /
  `Nothing here yet` / 移动回执 `Task moved to “Do now”; due time adjusted` + `Undo move` + `Dismiss`。
- 中文那一侧同 13 格逐格对得上（`10月18日 星期日`、`已选 1 项`→`已选 2 项`、`退出选择`、`批量完成`、
  `移动到清单`、`时间线`、`未排期（2）`、`交给别人 — 紧急不重要`、`先不做 — 不重要不紧急`、
  `这里还没有任务`、`任务已移动到「马上做」，截止时间已调整` + `撤销移动` + `知道了`）
  ⇒ 中英两列**同一屏同一状态**，这正是 B/C 层运行时求值之外要人眼补的那一维。
- 第 13 枚（`failure.png`）：英文那格是**时间线列表**（详情面已被关掉），中文那格是**详情面在场、无键盘**
  —— 两语态在这一格形状不同，但红在同一枚等待上（见第 5 节②）。

️ **看图顺手照出来一条候选界面缺陷（未裁决，与本笔无关）**：批量操作条第三枚按钮在这一档宽度下**被右边缘切掉**——
中文那两格看得见 `批量删` 半截（`已选 1 项` 与 `已选 2 项` 两格都在），英文那一格同一位置只剩一条红边残片。
两语态同形 ⇒ 不是翻译宽度问题。本笔不动它，登记成待裁决。

## 5. 顺手照出来的两件事

**① 本笔自己带进来的探针缺陷（已修）**：语言判定原先**只读一次快照**。首启那两屏是分几次 native
render 到的，而 companion 的 axbridge 会间歇返回空树（`ios-ax-shim.py` 里 `dump_nodes` 那条重试注释
就是这件事）—— 一次读空就把英文设备判成 `zh-CN`，之后每一枚 `T(中,英)` 都取中文那一列，
英文界面上一枚也点不中，红在"workspace did not open after onboarding"。
⇒ 改成**每轮重判、判成英文就粘住**。这是 §7 元规则"先怀疑探针"的第 N 次命中。

**② 一条与语言无关的在案红（未修，本线名下）**：第 13 枚 `12-detail-keyboard-visible-and-unobstructed`
在**两种语态、两台载体、全新安装态**下都红，而最后两枚 `passed` 读数属于旧包旧载体。已排掉的与剩下的边界：

- 不是载体不弹键盘：`probe-keyboard.py` 在 composer 上读到 `keyboard_top=545`（与旧载体那两枚 passed 同值）。
- 不是英文渲染：中文臂同一步同形红。
- 不是本笔双语改动：`arm-fresh-zh-ab` 走的是中文那一列。
- 不是"详情面标题字段点不动"：`probe-detail-title-focus.py` 直接定位同一枚字段（树里两枚叫 `标题`，
  非字段那枚 frame=`(16,159,370,21)`、字段那枚 `(16,184,370,44)`）并**单次点**它 ⇒
  `keyboard_top=519`、详情仍在场、1.5/3/5 秒三次读数一致。
- 试过并**否证**的一种解释：怀疑 `tap_node` 先跑的通用 `scroll_into_view`（那是**用滑动找元素**）把详情面拖走。
  把这一步换成"按 `recover_detail_title` 已经确认在视口内的那枚中心直接点"再跑 ⇒ **仍然红**
  （`arm-fresh-zh-ab`）。⇒ 该改动**已整笔还原**，不留未证的东西。
- 剩下的差别只有两处未分开：旅程这一步前面还做了**展开排期→收起排期**（探针没复现这一步，
  因为收起那枚控件在折叠后落在折线以下、要先滚才看得见 —— `probe-step12-split.py` 量到），
  以及详情是从**时间线行**开的（探针从列表行开）。归因到这两处之一需要再一枚探针，本线把它登记成欠项。

## 6. 收尾现量

见 `closeout.txt`：本线自建那台已 `shutdown` + `delete`（在册 0）；本线那枚 `idb_companion`
按 `--udid` 认人取到 pid 68711 后收掉，整机在跑的 companion 数回到进本趟前的 **3**，别人那三枚一枚没动；
共享 `heyta-multiend-reinstall` 仍 Booted、其 heyta 容器 mtime 未变；旧载体 `FE195661` 恢复成接手时的
`Shutdown`。英文那台的语言是本线自己写的，随设备一起删掉了。

## 7. 复现命令

```bash
U=$(xcrun simctl create heyta-r124-ios-en "iPhone 17 Pro" com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl boot "$U"
xcrun simctl spawn "$U" defaults write -g AppleLanguages -array en zh-Hans-CN
xcrun simctl spawn "$U" defaults write com.heyta AppleLanguages -array en zh-Hans-CN
xcrun simctl install "$U" "$SRC/Heyta.app"          # $SRC 见上，共享载体里那枚已装 bundle
python3 apps/mobile/evidence/ux-final-20261017/bilingual-locators-r123/apply-bilingual-locators-ios.py --dry
python3 apps/mobile/evidence/ux-final-20261017/bilingual-locators-r123/apply-bilingual-locators-ios.py
python3 apps/mobile/evidence/ux-final-20261017/bilingual-locators-r123/prove-chinese-unchanged-ios.py
NO_COLOR=1 python3 scripts/qa/check-locator-labels.py scripts/qa/tasks-ux-ios.py
python3 scripts/qa/tasks-ux-ios.py --udid "$U" --skip-profile --evidence-dir <本目录>/arm-patched-en2
xcrun simctl shutdown "$U" && xcrun simctl delete "$U"
```

⚠️ 设备腿一律带 `--skip-profile`：它会链 `profile-settings-ios.py`，而那枚脚本英文半开是台账
2326 那一格已经登记过的**别人名下**状态（分支条件双语、断言位单语），拿它当本笔的红灯会把两件事混成一团。
