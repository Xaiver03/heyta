# iPad 适配交接（2026-11-16）

## 一、先回答问题：现在该不该开工

**建议不要现在开工，但可以先做设计。**

理由不是"还没做完"，而是**日历的输入层正在改**，改完会重排 iPad 上最需要重新设计的部分：

| 正在改的 | 会动到什么 | 状态 |
|---|---|---|
| 日历「标题即视图切换器」 | 顶栏结构、视图切换入口 | 已提交 `59ac40af`，真机可见 |
| 日历标题内嵌计数 | 顶栏文案 | 已提交 `3979aa02`，真机可见 |
| **象限/清单成为时间轴上的维度** | 日历的颜色与筛选语义 | 进行中 |
| **捏合连续缩放**（年↔月↔周↔日） | 日历的手势层、滚动位置映射 | 未开始 |

后两项会改掉日历的**输入层**（现在还是"点标题选档"）。iPad 有触摸 + 指针 + 键盘三种输入，
如果按现在的点选形态先适配，等捏合上去就要重做一遍。

**可以现在就做、而且不受影响的**：iPad 的**版面骨架**（分栏、详情面板、Stage Manager 尺寸档）。
那部分依赖的是下面第二节的稳定契约，与日历输入层无关。

---

## 二、稳定层：可以直接复用的契约

这一层已经定稿并有门禁，iPad 端**照用，不要重写**。

### 2.1 形态档（决定排几列）

出处 [`packages/ui/src/layout/form-factor.ts`](../../packages/ui/src/layout/form-factor.ts)。

| 档 | 可放列数 | 典型设备 |
|---|---|---|
| `compact` | 1 | 手机竖屏 |
| `regular` | 2 | 手机横屏、**iPad 竖屏**、窄窗口 |
| `expanded` | ≥3 | **iPad 横屏**、Mac/Windows 大窗口 |

- 基准列宽 `COLUMN_BASE_WIDTH = 360`（dp）
- **报可用宽度，不猜设备**：用 `onLayout` 的 `nativeEvent.layout.width`，
  **不要用 `Dimensions.get('window').width`** —— 在桌面上永远 ≥ 断点，
  "响应式"就成了摆设（这条在 `QuadrantBoard` 的 props 注释里记过实测）
- 判据：`packages/ui/tests/form-factor.spec.ts`

### 2.2 屏幕外壳三档

出处 [`docs/agents/screen-chrome.md`](../agents/screen-chrome.md)。

| 档 | 边距 | 顶栏 | 低频动作 |
|---|---|---|---|
| `page`（默认） | 16dp gutter | 1–3 枚高频 | 进「更多」菜单 |
| `board` | 0（内容铺满） | 标题 + ⋯ | 进「更多」菜单 |
| `immersive` | 0 | 默认不画 | 返回退出（**尚未实现**） |

判据一句话：**这枚动作在这屏出现的每一次都可能用吗？** 否 ⇒ 进「更多」。
门禁：`pnpm check:nav-chrome`（按档校验顶栏动作数）。

顶栏随滚动收起已实现（`Screen.barCollapsed` 受控 / 内部状态两档），
iPad 上是否需要收起要重新判断 —— 大屏一屏能装更多，收起反而可能多余。

### 2.3 组件密度

出处 [`packages/ui/src/task-list/density.ts`](../../packages/ui/src/task-list/density.ts)。

| 档 | 用在哪 | 行高 / 内间距 |
|---|---|---|
| `comfortable`（默认） | 列表 | `size.row-min-height` / `space.3` |
| `compact` | 象限卡、**手机列表** | `touch-target.min` / `space.1` |
| `minimal` | 日历格 | 无下限 / `space.1`，不画元信息与行尾 |
| `detail` | 任务详情 | 同 comfortable，标题换 `detail-title` |

🔴 **勾选框几何刻意不进密度**：`size.checkbox` / `touch-target.min` / `radius.sm`
是三端一致的可访问性契约，按容器缩它是回归。

iPad 上建议：列表用 `comfortable`（比手机更松一档），象限仍 `compact`。

### 2.4 已实测的形状（照抄这些，别再重新发明）

| 形状 | 结论 | 出处 |
|---|---|---|
| 四象限 | **四张独立圆角白卡 + `space.3` 间隙**，无轴标签、无十字线、格标题一行 | `QuadrantBoard.tsx` |
| 任务行 | 白卡包裹（`TaskList.listCard`），卡片模式 `listGap` 必须归零（否则底色从缝里漏出来） | `TaskList.tsx` |
| 任务行左滑 | **[今天, 删除]**，破坏性动作不进第一格 | `TasksScreen.tsx` |
| 四象限拖拽 | `onStartShouldSetPanResponderCapture` 抢手势，点/拖在握把上分工 | `QuadrantScreen.tsx` |
| 日历筛选 | 整屏面板 `✕/标题/✓`，勾选**暂存**、✓ 才生效 | `CalendarScopeSheet.tsx` |
| 日历视图切换 | 顶栏标题=当前范围，点它弹 4 档菜单（当前档打勾） | `CalendarViewMenu.tsx` |
| 日历标题 | 带范围计数（`2026年11月 · 1 项`），为 0 时不显示 | `CalendarScreen.tsx` |

---

## 三、iPad 需要自己决策的五件事

这五件**没有现成答案**，是 iPad 端要拍的板：

1. **分栏**：iPad 横屏（`expanded`）要不要"列表 + 详情"并排？现在详情是**全屏 Modal**。
   分栏会改掉 `TaskDetailSheet` 的宿主形态 —— 那是 `apps/mobile` 独有的形状，
   共享层不认识它。
2. **顶栏收起**：大屏一屏装得下，滚动收起可能反而让用户找不到入口。建议**不启用**。
3. **指针与悬停**：iPadOS 有 trackpad 悬停态。`Pressable` 没有悬停事件，
   要新增一层（共享组件里现在**没有** hover 支持）。
4. **键盘**：iPad 常接键盘。仓里已有快捷键表（`docs/agents/entry-layers.md` 那条线），
   但移动端一个都没接。
5. **Stage Manager / 分屏**：窗口宽度可拖到 320–1366dp。
   形态档已经能处理（报可用宽度即可），但**分屏时两栏同时活**，
   要确认 `Screen` 的 `active` 机制（见 §四）覆盖到这种情况。

---

## 四、iOS 与 Android 的交互差异：本质不大，但有六处会咬人

**结论先说**：两者都是"手指直接操作 + 触摸目标"，心智模型一致；
`packages/ui` 这一层已经把绝大部分差异吸收了（tokens、安全区、密度、外壳档）。
真正需要在 iPad 端重新处理的只有下面六条 —— 而且**大部分是形态差异，不是平台差异**。

| # | 差异 | Android 现状（手机端已处理） | iPad / iOS 要注意 |
|---|---|---|---|
| 1 | **返回** | 硬件返回键，`BackHandler` 逐层消费（浮层 → 多选 → 详情） | 无返回键：要边缘右滑或顶栏返回；浮层要补"下滑关闭" |
| 2 | **长按菜单** | 自绘行菜单（`TopBarMenu` / 上下文菜单） | iOS 系统 context menu 带模糊背景与触觉，**不要混用**：要么全自绘，要么全系统 |
| 3 | **模态形态** | 底部抽屉 / 全屏 Modal | iOS sheet 自带 grabber + 下滑关闭；`Modal` 在 RN 里两端形态不同，**要各自写** |
| 4 | **安全区** | 手势条 + 状态栏 | 刘海 / 灵动岛 + home indicator；`useSafeAreaInsets` 已覆盖，但**横屏左右也有 inset** |
| 5 | **滚动回弹** | 无回弹 | 默认有；`ScrollView` 的 `bounces` 在 iOS 上会露出底色，`board` 档要确认背景色 |
| 6 | **字体渲染** | Roboto / 思源，同字号偏大 | SF，同字号视觉更细；`check:title-collision` 只在 web 跑，移动端要**目视**复核长标题 |

补充一条**不是差异但是坑**：`adb install -r` 会清掉登录态（本机实测 4 次），
iPad 的 `xcrun simctl install` / 真机装同理，验收脚本要预留重新登录的步骤。

---

## 五、验收判据（iPad 端照这套走）

```bash
# 八道门禁（全绿才提）
pnpm check:type-roles && pnpm check:spacing-scale && pnpm check:tap-targets \
  && pnpm check:design && pnpm check:docs && pnpm check:nav-chrome \
  && pnpm check:title-collision && pnpm check:empty-state

# 两端单测
(cd packages/ui && npx vitest run) && (cd apps/mobile && npx vitest run)
```

三条硬规矩（本仓已有，iPad 端照用）：

1. **不许用 bounds 数字代替看图** —— 每次改完必须截图亲眼看整屏。
2. **共享层改动必须先 build**：`pnpm --filter @heyta/ui build` → `pnpm --filter @heyta/i18n build`
   再构建 App。本仓踩过两次"改了没生效，因为 `dist/` 是旧的"。
3. **只改平台差异，不改业务语义**：`apps/*` 里不许出现"业务上该怎么做"的判断（AGENTS §3.5）。

---

## 六、给你的建议顺序

1. **现在**：按 §2 的契约搭 iPad 版面骨架（分栏、尺寸档），日历先按"点标题选档"接上
2. **等我这边日历输入层定稿**（象限维度 + 捏合缩放落地，预计下一步）
3. **再做**：iPad 的日历手势（捏合在 iPad 上更自然，有双指）
4. **最后**：指针悬停、键盘快捷键

第 1 步现在就能干，第 2 步之后再来问我要日历的最新契约。

---

## 七、交付进度（2026-11-16）

- **§六 ① 版面骨架 —— 已落地**。形态档（`compact`/`regular`/`expanded`）驱动尺寸档；`Screen` 的 board 档用响应式 gutter（手机 16 / 平板 24）；内容列按 `CONTENT_MEASURE_MAX` 收窄居中且顶栏标题与内容列对齐；按钮宽度「主操作 `tone=primary` 撑满、其余按内容宽」；任务行底色跟随所在白卡（去掉白卡内的灰行）。**分栏（列表 + 详情并排）已做**：`BottomSheet` 增 `presentation='pinned'`（非模态常驻右栏），`TasksScreen` 用 `onLayout` 宽度 + `formFactorOf`，`expanded` 排「左列表 + 右详情栏」、点左侧任务右栏内切换，`compact`/`regular` 仍走底部面板。任务 / 日历 / 专注 / 统计 / 我的五屏在 iPad 上逐屏截图看过，版面正常。
- **§六 ② 日历手势 —— 输入层已在前序提交**（象限维度 `7f5b7fa2`、捏合缩放 `bf10e7e9` / `b1a4bad5`）。iPad 上横向滑动切周期实测可用（2026 年 11 月 → 12 月）。
- **§六 ③ 指针悬停 / 键盘快捷键 —— 未做**。iOS 原生端没有标准 hover / hardware-keydown 的 JS API（悬停需 UIPointerInteraction、键盘需 GCKeyboard，属原生模块工程），且当前环境无指针 / 硬件键盘可验，留作独立原生项。
