# r123 · 任务旅程脚本的中英同义定位（台账 1909 那一格的 Android 半）

一趟做完三件事：把 `scripts/qa/tasks-ux-android.py` 的单语定位补成双语，
在**同一台共享模拟器**上分别用改前那份与改后这份跑英文界面（一头红一头绿），
再用中文界面跑一遍改后那份（证明中文那一侧没被改坏）。

## 现量读数

| 臂 | 载体 | 结果 | 出处 |
|---|---|---|---|
| 改前那份 × 英文界面 | `tasks-ux-android.HEADcopy.py`（`git show HEAD:…` 原样落盘） | **rc=1，0 步**：`timed out waiting for label '任务'; visible=['Tasks', 'Open search', 'Sync', …, 'View options: List'…]` | `arm-head-en.log` / `android-en-HEADcopy/` |
| 改后那份 × 英文界面 | 当前工作树 `scripts/qa/tasks-ux-android.py` | **rc=0，16 步全过**，报告里 `uiLocale: "en"` | `arm-patched-en.log` / `android-en/`（15 张图） |
| 改后那份 × 中文界面 | 同一枚脚本 | **rc=0，16 步全过**，`uiLocale: "zh-CN"` | `android-zh/`（15 张图） |

语言开关走的是**产品自己的那条**（我的 → 设置 → 常规 → 语言 → English），
不是改系统语言：`switch-app-language.py` 每一步 tap 都回读 AX 树，
切完 `force-stop` + 冷启再验渲染（`missing=[]`）。
**收尾已把设备改回中文并冷启复验**（`lang-zh/`、`RESTORE_RC=0`）——
这台是共享载体，产品的语言开关是持久的，不改回去下一趟拿到的就是英文界面。

## 门（`scripts/qa/check-locator-labels.py`）

同一把尺，两份各取一次：

| | 组数 | 含中文组数 | `T()` 同义定位 | 单语标签 | 单语候选组 | rc |
|---|---|---|---|---|---|---|
| 改前（HEAD 那份） | 18 | 2 | 0 | **21** | 2 | 0（只披露不判红） |
| 改后（工作树这份） | 77 | 58 | **58** | **0** | **0** | **0** |

⚠️ 中途出现过一次**真红**并被修掉：第一版把组合标签拆成前后缀写（`T('打开任务：','Open task: ')`），
门当场判红三枚 —— `声称成对的中英定位里，英文那一侧不在 en.ts 的词值上`。
那三枚英文是**模板被切开的一半**，真源里根本没有这个词值 ⇒ 门的这条牙是对的。
改成"英文那一侧一律写整枚 i18n 模板 + `.format()`"之后才绿。

## 代改条件（本线给自己立的三条）

1. **一子可删**：改动只在 `scripts/qa/tasks-ux-android.py` 一枚文件里，
   `git restore -- scripts/qa/tasks-ux-android.py` 整笔回去（改前该文件零脏）。
2. **运行时形状逐字等于改前**：见下面两道，两道都是现跑不是印象。
3. **一条命令可回退**：见 ①。

### 证 ② 的那两道（`prove-chinese-unchanged.py`，rc=0）

- **A 字面量层**：HEAD 34 枚含中文面 / 改后 31 枚。差集 8 去 5 来，
  逐枚都在"组合标签换成 i18n 模板"的清单里；**清单外一枚都不许有**。
  🔴 这一层**当场抓到过一次遗漏**：正则那一枚 `移动「(.+)」到其他象限` 也换了形状，
  第一版没写进清单 ⇒ A 判红。补进清单的理由是 B 层单独证它仍取回同一枚标题。
- **B/C 渲染层**：把那五枚组合标签在 `ENGLISH=False` 下真的求值出来，
  逐字等于 HEAD 里写死的那串（`打开任务：UxTaskA1`、`已选 2 项`、`移动「UxTaskA1」到其他象限`…），
  再在 `ENGLISH=True` 下逐字等于 `packages/i18n` 的 en 列（`Open task: UxTaskA1`、`2 selected`、
  `Move “UxTaskA1” to another quadrant`）。B 层同样抓到过一次**探针自己的错**：
  `view_options_label` 的入参本身就是当前语态的视图名，第一版两种语态都喂 `'List'` ⇒ 中文态判 ≠。

英文那一侧逐枚取自 `packages/i18n/src/locales/en.ts`（`mobile.tasks.viewOptions.open`、
`web.shell.bulk.selected`、`web.quadrant.moveTask`、`web.quadrant.drop.success`、
`mobile.tasks.a11y.open`、`web.shell.sort.*`、`web.quadrant.do|plan|delegate|drop` 等），
没有一枚是我自己翻的。

## 装置事实

- 语言判定加在 `ensure_on_tasks()` 里，走三种首屏面（`This device only` / `Use offline for now` / `Tasks`），
  与同目录 `profile-settings-android.py:231` 的判定同形；判定结果写进 `uiLocale` 并跟着报告落盘。
- 组合标签一律由模板派生（`move_sheet_marker()`、`moved_feedback_marker()`、`move_task_pattern()`
  都是把同一枚 i18n 模板按 `{` 切一刀或把占位符换成捕获组），**不再手抄标点** ——
  英文用的是弯引号 `“ ”`，手抄必错。
- 中文态那三处 `in self.label(...)` 的匹配串比改前**更窄一点**：
  改前是 `'移动「'` / `'任务已移动到'`，现在从模板切出来是 `'移动「'` / `'任务已移动到「'`（多带一枚开括弧）。
  两条都仍匹配渲染出来的那一整串，中文腿 16/16 就是它的读数。

## 这一格不证的事

1. **不证 iOS**：`tasks-ux-ios.py` 的 3 枚单语 + 42 枚单语候选组这一趟没动（现量见下面台账那一格）。
2. **不证英文下的 `absent=` 那一族**：这条旅程里没有"断言某标签消失"的英文反例，
   改后那份的 `wait_no_label` 在英文下走的是同一枚英文串，只有正向读数。
3. **不证"干净检出可跑"**：三臂跑的都是**工作树**那份脚本（改后那枚还没提交时就已经在跑），
   读数带的是"哪一棵树 + 装置版本"，不是 `main`。
4. **设备留了残迹**：Inbox 里多出 4 行 `UxTaskA/B<stamp>`（中文腿 2 行、英文腿 2 行），
   与之前每一趟任务旅程的残迹同形状；这台模拟器上原本就有历史趟留下的同类行，本趟不代删。
5. **不证产品界面在英文下有缺陷或没缺陷**：这一趟的被测对象是**探针**，
   截图只用来证"脚本点的确实英文界面"（`07`、`08` 两张看过：
   `Move “UxTaskA1792251810” to another quadrant` + `Do now/Schedule/Delegate/Drop`，
   其中 `Drop` 是灰的 —— 那是产品自己的禁用态，脚本按 `enabled=true` 过滤，行为正确）。

## 复跑

```sh
E=apps/mobile/evidence/ux-final-20261017/bilingual-locators-r123
python3 $E/prove-chinese-unchanged.py                       # 两道证，rc=0
NO_COLOR=1 python3 scripts/qa/check-locator-labels.py scripts/qa/tasks-ux-android.py
python3 $E/switch-app-language.py en --evidence $E/lang-en  # 产品开关，冷启复验
HEYTA_TASK_UX_ANDROID_EVIDENCE=$E/android-en python3 scripts/qa/tasks-ux-android.py --skip-profile
python3 $E/switch-app-language.py zh --evidence $E/lang-zh  # 🔴 收尾必须改回去
```
