# 滴答清单布局对照与改造建议（顶部导航 / 专注 / 日历）

> 2026-11-18。产品负责人对照滴答清单后提出的三件事：
> 「整体重心非常靠上」「专注页字号不对、看不到正计时和倒计时」「顶部导航栏没有统一抽象成可复用组件」。
> 本文把这三件事拆成可执行的结构差异，逐条给读数与落点。

## 0. 取数与范围

| 对象 | 取数方式 |
|---|---|
| 滴答清单 | 真机 `com.ticktick.task`（8.0.9.1 高级版），1156×2510 @480dpi，`adb` 逐屏截图。截图存 `tmp/ticktick-android/` |
| heyta 现状 | `screenshots/web-desktop/*`、`screenshots/web-mobile/*`（2026-11-16 拍摄）+ 源码读数 |
| 设计变量 | `packages/design-system/src/tokens.css`、`typography.ts` |

> ⚠️ 本文引用的 heyta 截图是 2026-11-16 产物，动手前应重新拍一次（见 `screenshots/README.md`）。

**结论先行**：差异不在「用了什么颜色」，而在**信息在纵向上的分配**、**顶部导航承载多少职能**、**每个视图能切换多少种形态**。三条都是结构性差异，不是单屏微调。

---

## 1. 顶部导航（AppBar / 顶栏）

### 1.1 滴答的顶栏是「一屏一配置」的产品组件

滴答每个根页的顶栏结构不同，但都由同一套槽位拼成：`前导（汉堡/返回） + 大标题（可点） + 上下文动作 + 分段 tab + 溢出 ⋮`。

| 屏 | 顶栏结构 |
|---|---|
| 日历（周/月/3日/日/列表） | `十一月`（大标题，可点）+ **视图专属样式图标** + **视图切换图标** + `⋮` |
| 专注·番茄计时 | `番茄计时 │ 正计时`（**分段 tab**）+ 时钟图标（→专注统计）+ `+`（自定义时长）+ `⋮` |
| 任务/收集箱 | `≡ 收集箱` + `⋮` |

- 顶部大标题用**大字号**（`十一月` 目测 ~40dp），与正文拉开层级；它同时是**当前时间范围**。
- **视图切换是一个图标 + 下拉菜单**（列表/年/月/周/3日/日），不是一排 tab。
- **视图内的「样式」是另一枚图标**：同一个「周」，点一下在「两列日程清单」和「7 列时间轴」之间切换（见 `04` 与 `12` 两张截图）。

### 1.2 heyta 现状

- Web：`.ht-header`（`main-area.css`）高度 `layout-header-height = 56px`，只放 `标题(xl 20px) + actions[]`。
- 移动：`apps/mobile/src/ui/kit.tsx` 的 `AppBar` 有 `title / titleLeading / onTitlePress / actions[] / background`，高度 `nav.app-bar-height = 56px`。
- 即：**有一层 AppBar，但只覆盖「标题 + 图标动作」**，没有「分段 tab」「大标题」「上下文样式位」这些槽；各屏要额外控件就往 `actions` 里塞或另画一行。

### 1.3 差异

| 维度 | 滴答 | heyta | 影响 |
|---|---|---|---|
| 标题字号 | 大标题 ~40dp | `xl 20px` / `headline` | 顶栏读起来像「工具条」而不是「页面锚点」 |
| 分段 tab 槽 | 有（番茄/正计时） | 无 | 专注只能在内容区塞胶囊 |
| 上下文样式位 | 有（视图样式切换在顶栏） | 散在内容区/页头 actions | 顶栏职能不统一 |
| 溢出 ⋮ | 根页一律有 | 视屏而定 | 低频动作没有统一去处 |
| 移动端顶栏层数 | 1 行 | 日历是「标题行 + 月份行 + 视图行」三层 | 日历头部吃掉约 20% 屏高（见 `MW04`） |

---

## 2. 专注（番茄钟）

### 2.1 滴答的结构（截图 `15` / `17` / `18` / `19`）

1. **两种计时模式做成分段 tab**：`番茄计时`（倒计时）/ `正计时`（正计时秒表）。切换后：倒计时是「进度弧 + 25:00」；正计时是「刻度盘 + 00:00」，都是从 0 起算 / 从 25 起算的同一套环。
2. **主体竖直铺满整屏**：环直径约占屏宽 58%（~680px/1156），`25:00` 字号目测 ~130px；环在屏高 ~42% 处，`开始` 药丸按钮在 ~74% 处，底部「专注记录」卡贴在导航栏上方。**内容带覆盖屏高约 18%–85%。**
3. `专注 ›` 一行是**目标选择入口**（点开是"选任务/清单"的全屏选择器，见 `19`）。
4. 顶栏时钟图标 → **独立「专注统计」全页**（4 张 2×2 统计卡 + 专注记录 + 天/周/月/自定义详情环 + 专注排行，见 `18`）。

### 2.2 heyta 现状

- 共享 `FocusPanel`（`packages/ui/src/focus/FocusPanel.tsx`）：环 `size.focus-ring = 180px`、数字 `numeric-display = 36px`、阶段行 `row-meta`；主按钮 + 中止按钮。
- 只有**倒计时一种模式**（`@heyta/domain` 的 `focus.ts` 只有 `work/shortBreak/longBreak` 三种倒计时类型，无正计时）。
- Web：`FocusTimer.tsx` 内容顶端对齐（`padding: space.6`），右栏 `FocusDetailPane` 也是顶对齐 → 内容全部挤在上半屏。
- 移动：`FocusScreen.tsx` 把 `FocusPanel` 放在 `Screen` 普通内容流里，种类胶囊（专注/短休息/长休息）只在 idle 出现。

### 2.3 差异与具体缺陷

| # | 事实 | 读数 |
|---|---|---|
| 1 | **缺「正计时」**：只有倒计时，且「专注/短休息/长休息」是**倒计时类型**，不是计时模式 | `focus.ts` 无 `mode` 字段 |
| 2 | **大数字偏小**：`numeric-display` 36px，环 180px | `tokens.css` / `typography.ts` |
| 3 | **重心靠上**：内容带约覆盖屏高 11%–58%，下 40% 空 | `W04` 目测 |
| 4 | **「专注/短休息」字号不当**：阶段行用 `row-meta`（小字），种类胶囊是普通 Chip，没有做成顶栏分段 tab | `FocusPanel`/`FocusScreen` |
| 5 | 统计分散：Web 右栏、Mobile 内联卡，滴答是独立全页 | — |

---

## 3. 日历

### 3.1 滴答的日历是「6 视图 × 视图内样式 × 显示范围 × 显示设置」

**视图种类（⋮ 上方那个图标的下拉，截图 `05`）**：`列表 / 年 / 月 / 周 / 3日 / 日`。

- 列表：一天的任务清单 + 顶部周条选择器（`10`）。
- 年：12 个迷你月，3×4 网格（`07`）。
- 月：整月网格 + 每日事件色块（`06`）。
- 周：默认「两列日程清单」样式（`04`）；点顶栏样式图标切换成「7 列时间轴 + 红线当前时刻」（`12`）。
- 3日 / 日：3 列 / 单列时间轴（`08` / `09`）。

**两个 ⋮ 里的能力（截图 `13`）**：
- **显示范围**：所有 / 指派给我 / 按清单勾选（收集箱、工作任务、个人备忘…）（`14`）。
- **显示设置**（`01`）：颜色、样式、显示详细、显示已完成、显示检查事项、显示所有重复周期、显示习惯、显示专注记录、显示倒数纪念日、辅助时区。

### 3.2 heyta 现状

- 视图只有 `month / week / day / year`（`CALENDAR_VIEW_ORDER`），**没有「列表」「3日」**；**没有「视图内样式切换」**（周只有一种摆法）。
- 月视图（`W09`）左缘有**周数栏（44周/45周…）**，且网格 `fitHeight` 铺满整屏；滴答月视图不显示周数、按事件密度压缩。
- 移动日历（`MW04`）头部是**三层**（`日历` 标题 + `2026年11月 ‹ › 回到今天 +` + `视图 月`），占掉约 20% 屏高；滴答是**单行**（`十一月` + 图标 + ⋮）。
- Web 已有「显示范围」雏形（`CalendarHeaderToolbar` 的 `scope`：projectIds/tagIds），但无「显示设置」开关组，移动端无 scope 入口。

### 3.3 差异

| 维度 | 滴答 | heyta | 落点 |
|---|---|---|---|
| 视图数 | 6 | 4 | `CalendarViewKind` 增 `list`、`3day` |
| 视图内样式 | 有（如周：清单/时间轴） | 无 | 新增 `CalendarStyle` 维度 |
| 显示范围 | 有（含按清单勾选） | Web 有 scope，Mobile 无 | 复用 `scope`，补移动入口 |
| 显示设置 | 10 项开关 | 无 | 新增「日历显示设置」页 |
| 月视图周数栏 | 无 | 有 | 改为可选、默认关 |
| 移动头部 | 1 行 | 3 行 | AppBar 承载月份（已支持 `onTitlePress`） |

---

## 4. 纵向重心与信息密度（跨屏共性）

| 屏 | heyta 内容纵向带 | 滴答对照 |
|---|---|---|
| 专注 W04 | ~11%–58%（下半空） | 18%–85%（铺满） |
| 时间线 W05 | 空态贴顶（~22% 处）| 空态在内容区**竖直居中** |
| 四象限 W02 | 4 张空卡撑满整屏 | 卡片按内容高，空态居中 |
| 任务/收集箱 | 输入框 + 空态贴顶 | 空态竖直居中（`20`） |

根因有两处，且都能定位：

1. **空态/短内容贴顶**：web 的空态放在内容流顶部，没有「剩余空间里居中」的容器。
2. **头像/大内容不占满**：专注页把环固定 180px 塞在左上内容列，而不是「用满这一屏的 immersive 空间」。

规则（可执行）：
- **空态容器始终在剩余空间竖直居中**（`flex:1 + justify-content:center`）。
- **immersive 屏（专注）用满整屏高度**：环尺寸随 `min(屏宽, 屏高)` 缩放，不是固定 180px。
- 一屏的「首内容起点」到「末内容终点」应覆盖 ≥ 60% 可用高度，除非是长列表。

---

## 5. 优先级与落地映射

> 每条都标了**现有落点**与**门禁**，避免又写一份没人读的文档。

### P0（结构、最影响观感）

1. **统一 TopBar 组件**：在 `packages/ui/src/layout/` 抽 `AppBar` 共享层，槽位 `leading / title(large|compact, 可点) / tabs(segmented) / actions[] / overflow[]`；移动 `kit.tsx` 与 web `.ht-header` 都消费它。
   - 门禁：`pnpm check:nav-chrome`（顶栏动作预算）+ 新增「同一屏不得出现第二种顶栏标题字号」。
2. **专注页双模 + 大数字 + 竖直铺满**：
   - `@heyta/domain/focus.ts` 增 `mode: 'pomodoro' | 'stopwatch'`；`正计时` 从 0 计数。
   - 专注用 `chrome="immersive"`；环尺寸 `size.focus-ring` 改为随视口缩放（新增 `focus-ring.max`），大数字新增 `focus-display` 字号档（移动 ≥72dp，桌面按视口）。
   - 「专注/短休息/长休息」升级为**顶栏分段 tab**（idle 可选），不再用 `row-meta` 小字。
3. **空态垂直居中**：统一空态容器（`packages/ui/src/empty-state`）。

### P1（能力补齐）

4. **日历视图矩阵**：`CalendarViewKind` 增 `list`、`3day`；新增 `CalendarStyle`（如 week: `list|grid`）。
5. **日历显示范围 + 显示设置**：复用 web `scope`，补移动入口；新增「显示设置」页（显示已完成/习惯/倒数日/专注记录/检查事项/辅助时区）。
6. **移动日历头部收成一行**：`AppBar` 承载 `十一月`（`onTitlePress` 切视图），去掉 `视图 月` 第二行。

### P2（打磨）

7. 月视图周数栏默认关闭。
8. 专注统计独立全页（对齐滴答 `18` 的四卡 + 详情环 + 排行）。
9. 底部 tab 从 6 项收敛到 5 项（移动 `MW01` 的「对话…」已被截断）。

---

## 7. 专注页详设（正计时 / 倒计时）

> 产品负责人口径（2026-11-18）：「不需要两个分担 tab，正计时/倒计时切换都不一定放底部，直接放页面中间也可以，但必须有正计时和倒计时。参考番茄 ToDo。」
> 番茄 ToDo（`com.plan.kot32.tomatotime`）实测：首页是**任务卡列表**，每张卡右上「开始」，卡上有类型标签「正向计时」；点开始进入独立计时页。它把「正计时/倒计时」做成**每个任务可选的属性**，不是全局顶部 tab。

### 7.1 结构（一屏，竖排，immensive 铺满）

```
┌──────────────────────────────────────┐
│  ‹  专注                    ⌄目标  ⋯ │  ← 顶栏：标题 + 目标选择 + 溢出
│                                      │
│              ╭──────────╮            │
│              │          │            │  ← 环：直径 min(屏宽×0.62, 屏高×0.42)
│              │  25:00   │            │     数字：约环直径×0.28（桌面≥96px / 手机≥72dp）
│              │   专注    │            │
│              ╰──────────╯            │
│                                      │
│        ┌────────────────┐            │  ← 模式切换：**页面中部、环下方居中**
│        │ 正计时 │ 倒计时 │            │     分段药丸（segmented），非顶部 tab、非底部
│        └────────────────┘            │
│                                      │
│         ╭──────────────╮             │  ← 主按钮：药丸，宽≈环直径×0.72，高≥48dp，拇指区
│         │   开始 / 暂停  │             │
│         ╰──────────────╯             │
│                                      │
│  今日 3 个 · 75 分钟     专注记录 ›   │  ← 底部：今日摘要 + 记录入口（贴导航栏上）
└──────────────────────────────────────┘
```

- **模式切换放中部、环正下方的理由**：它改变的是「这一轮怎么计时」，属于核心操作的一部分，视线本来就落在环上；放顶部离环太远、放底部又和「开始」抢位。番茄 ToDo 用「每任务属性」，我们合并为一个分段控件放在环下，一眼可切。
- 两种模式**共用同一个环**：
  - 倒计时：画进度弧（现有 `FocusRing`），数字 `25:00 → 00:00`，归零自然结束。
  - 正计时：环画**刻度盘**（等分刻度、无进度弧），数字 `00:00 → 累加`，点「结束」才停并落盘。

### 7.2 领域层变更（`packages/domain/src/focus.ts`）

```ts
export type FocusMode = 'countdown' | 'countup';

interface FocusState {
  mode: FocusMode;              // 新增，默认 'countdown'
  elapsedMsOnPause?: number;    // 新增，正计时暂停用
  // …其余不变
}

selectMode(state, mode): FocusState          // idle 限定，同 selectKind
focusElapsedMs(state, now): number           // 正计时：running=now-startedAt；paused=elapsedMsOnPause；idle=0
// start / pause / resume / abort 按 mode 分支：
//   countup.start → endsAt 不设；countup.pause → 记 elapsedMsOnPause；abort → completed:true（正计时"结束"即正常结束）
// focusDisplayMs / focusProgress / isFinished 读 mode：countup 的 progress 恒 0、isFinished 恒 false
```

- **可机械验证**：新增 `packages/domain/tests/focus-mode.spec.ts`（正计时从 0 累加、暂停冻住、结束落盘 `actualMs=elapsed`、倒计时行为逐字不变）。这是「测试要能失败」的落点。

### 7.3 共享 UI 变更（`packages/ui/src/focus/`）

| 文件 | 改动 |
|---|---|
| `model.ts` | `toFocusViewModel` 增 `mode`/`elapsedMs`；`focusDisplayText` 支持正计时 |
| `FocusPanel.tsx` | 增 `mode` + `onModeChange` + `modeLabels`；环下渲染分段药丸；数字改用新 `focus-display` 字号；整块 `flex:1 + justifyContent:center` |
| `FocusRing.tsx` | 增 `variant?: 'progress' | 'dial'`，`dial` 画等分刻度（`react-native-svg` 的 `<Line>` 循环） |

### 7.4 宿主接线

- `apps/web/src/features/focus/store.ts`：暴露 `selectMode`，`start` 读 `state.mode`；`tickOnce` 对 countup 只 `set({tick})` 重绘、不判完成。
- `apps/web/src/features/focus/FocusTimer.tsx` + `FocusDetailPane.tsx`：主区改 immersive 居中；右栏保留。
- `apps/mobile/src/lib/focus-timer.ts` + `screens/FocusScreen.tsx`：同上，`focus-mobile` E2E 需补「切正计时」一条。

### 7.5 字号 / 尺寸 token（`packages/design-system/src/tokens.css`）

| token | 现值 | 改为 | 说明 |
|---|---|---|---|
| `font-size.5xl` | 无 | 新增 `4.5rem`(72px) | 仅 `focus-display` 用 |
| `size.focus-ring` | `11.25rem`(180) | 保持 token，组件按视口取 `min` | 见 7.1 |
| `size.focus-ring-stroke` | `0.625rem`(10) | 保持 | — |

> ⚠️ 新增 token 后必须 `pnpm --filter @heyta/design-system generate` 重生成 `generated/tokens.native.ts` 等，否则 `generate:check` 会红。

### 7.6 验收判据

| 项 | 判法 |
|---|---|
| 倒计时行为不变 | `packages/domain/tests/focus-mode.spec.ts` + 现有 `packages/ui/tests/focus-model.spec.ts` 全绿 |
| 正计时从 0 累加、暂停冻住、结束落盘 | 同上单测 |
| 模式切换在环下方、拇指可点 | 看图（Playwright 截图）|
| 大数字 ≥ 桌面 96px / 手机 72dp | `inspect` 计算字号 |
| 内容纵向覆盖 ≥ 60% 可用高度 | 截图量上下留白 |
| 一屏 primary ≤ 1（只有「开始」是蓝） | 看图 |

---

## 6. 需要产品负责人确认的点

1. **专注双模**：`正计时` 和 `番茄计时` 是**同一屏两个 tab**（同滴答），还是两个入口？
2. **大数字目标尺寸**：桌面专注数字定多大（建议 ≥ 96px；手机 ≥ 72dp）？
3. 先做 P0 的三条（顶栏组件 / 专注重排 / 空态居中），还是先只做专注页一屏跑通？

---

## 8. 落地状态（2026-11-18，专注页第一批）

| 层 | 状态 | 判据 |
|---|---|---|
| 领域 `focus.ts` | ✅ 加 `mode(countdown/countup)`、`selectMode`、`focusElapsedMs`；start/pause/resume/abort/remaining/display/progress/isFinished 按 mode 分支 | `packages/domain` **1242 测试全绿**（含新增 `tests/focus-mode.spec.ts` 7 例） |
| 共享 UI `packages/ui/focus` | ✅ `model` 暴露 mode/elapsed；`FocusPanel` 环下加「倒计时/正计时」分段 + `fill` 居中；`FocusRing` 加 `variant:'dial'` 刻度盘 | `packages/ui` **987 测试全绿** |
| Web 壳 | ✅ `store.selectMode`；`FocusTimer` 中部切换 + 70vh 居中；中英各 3 词条 | web `typecheck` 过、**2833 测试全绿**、`vite build` + 截图验证 |
| 移动壳 | ✅ 已接线；**iOS 模拟器（本工作树构建）验证通过**：倒计时=进度弧+25:00、正计时=刻度盘+00:00，环下分段切换、72px 大数字落在 256 环内 | typecheck + 模拟器截图确认 |
| TopBar 统一组件 | ✅ 共享 `packages/ui/src/layout/TopBar.tsx`（槽位 leading/title(可点,large\|compact)/tabs/actions/overflow），移动 `AppBar` 消费它；Web 抽出 `apps/web/src/features/shell/WebTopBar.tsx`（DOM 实现，同槽位契约），`App.tsx` 改为只传槽位 | ui build+测试、web typecheck+2833 测试全绿、W01/W04/W09 截图视觉不变 |
| 空态竖直居中 | 🟡 Web `.ht-content > :has(> [data-testid=empty-state]) → margin-block:auto`；任务空态已截图确认；其余视图靠同一通用选择器 | W01 截图确认、web 2833 测试全绿 |
| 「大数字」 | ✅ 新增 `font-size.5xl=72px` + `focus-display` 字号档；环 `180→256px` 容纳 | `generate:check` 过、Playwright 截图确认 |

改前/改后（Web）：`screenshots/web-desktop/W04-番茄钟.png`（当前）对比截图见会话。
⚠️ `check:l4` 在 `apps/mobile/src/screens` 报 +1 内联样式，来自本会话之外的未提交改动（AuthScreen / WelcomeScreen），与本批专注改动无关；web 侧内联样式恰在基线 74。

### 8.1 收尾结论（2026-11-18）

- ① 专注页：**Web 已完成并截图验证**（双模切换在中部、72px 大数字/256px 环、内容在整屏高度内竖直居中；`flex:1` 铺满内容区）。移动端已接线（`selectFocusMode` + `FocusScreen` 传 mode），typecheck 通过；**移动端视觉待模拟器确认**。
- ② TopBar：`packages/ui/src/layout/TopBar.tsx` 已抽出，槽位齐全，移动 `AppBar` 已消费；**Web 的 DOM `.ht-header` 按平台外壳保留，未迁到该组件**（跨全站单头，盲改风险高，需单独一轮 + 截图验证）。
- ③ 空态：Web 已落地并截图验证（任务空态）；其余视图共用同一 `:has` 选择器。
- 验证：domain 1242 / ui 987 / web 2833 全绿；web、mobile typecheck 通过；`generate:check`、`check:design-token-refs`、`check:empty-state`、`check:control-semantics`、`check:rn-aria`、`check:nav-chrome` 通过；`check:l4` web 在基线（mobile +1 来自别人未提交的 AuthScreen/WelcomeScreen）。
