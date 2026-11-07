# 看板重建在 `TaskRow` 上（2026-11，B274 的收口）

> 立案文书：[`BLOCKED.md` 的 B274](../../BLOCKED.md)（这一单不是新债，是那三条旧债的**同根一次性收口**）。
> 参照实现：[`apps/web/src/features/quadrant/QuadrantBoard.tsx`](../../apps/web/src/features/quadrant/QuadrantBoard.tsx)
> （它复用共享行，所以天生没有这四笔债）。
> 本文件只写**判断与判据**；四笔债的形状不在这里复述（复述必漂）。

---

## 1. 一句话

`apps/web/src/features/kanban/KanbanView.tsx` 手写了一张卡（只有一个 `<span>{task.title}</span>`），
于是同时欠了四笔：`check:l4` 的 4 处内联样式、`ht-kanban*` 是**惰性钩子**（有类名没规则）、
看板没有"在看哪一条"的立场、键盘光标那一族（`kanban-card-*`）不在共享行的 `task-item-*` 里。
这一单把这四笔**一起**收掉：**看板列里的行 = 共享 `TaskList` 渲染的行**。

判据方向与四象限**逐条同构**（`apps/web/tests/quadrant-row-parity.spec.tsx` 是它的模板）：
新增 `apps/web/tests/kanban-row-parity.spec.tsx`，用同一组 props、同一档位分别渲染
`TaskList` 与新的看板容器，断言两边那颗 `task-item-<id>` 的 `outerHTML` **逐字节相同**。

---

## 2. 四笔债 × 每一条判据**怎么才会红**（先写清红，再动手）

| # | 判据 | 现量（动手前） | 这条判据**怎么才会红** | 修法为什么能让它绿 |
|---|---|---|---|---|
| 1 | `pnpm check:l4` 断言 C | `apps/web/src/features` 内联样式 **78 > 基线 74**（多 4 处，全在 `KanbanView.tsx`：`:38` 卡片 / `:61` 列容器 / `:63` 列标题 / `:100` 根容器） | 在 `features/**` 里**新写一处** `style={{`，或把已有的那 4 处留着不减 | 4 处内联**全部消失** ⇒ 78 → 74，**回到基线而不是抬基线**。列的几何/底色/标题样式搬进 `packages/ui`（共享包不在 `check:l4` 的扫描面里） |
| 2 | `pnpm check:row-single-source` 断言 B | `ht-*` 前缀族 **33**（恰在基线） | 在 `apps/web/src/styles/app*` 或 `apps/web/src/features/**/*.css` 里新写一条 `^\.ht-[a-z]+` ⇒ 34 ⇒ 红 | 不新开族：`ht-kanban` / `ht-kanban__column` **两个惰性钩子直接删掉**，列样式住进共享包的 RN 样式表（没有 CSS 文件 ⇒ 没有族） |
| 3 | `pnpm check:selection-single-source` 断言 I | `kanban` 登记为 `row-actions-only`（`because` 里写着"这不是设计，是缺"） | 名册里那一格保持 `row-actions-only`，而 `KanbanView.tsx` 里出现 `useSelected('task')` ⇒ **过期登记**红；或登记成 `selects` 却不报类别 / 报的类别不在词表 ⇒ 红 | 看板**真的**接共享选中：`useSelected('task')` → 行的 `active` 高亮，点行 → `selection.select('task', id)`。⇒ 立场升 `selects`、`kinds: ['task']`，`because` 重写（不再是"这不是设计，是缺"） |
| 4 | 键盘光标那一族 | 卡的 testid 是 `kanban-card-<id>`（`task-item-*` 一个都不存在） | 新 spec 里断言列内的行**必须带** `task-item-<id>` / `task-toggle-<id>` ⇒ 红 | 行由共享 `TaskList` 渲染 ⇒ `task-item-*` / `task-toggle-*` / `task-title-*` **自动**出现。`kanban-card-<id>` 这个锚点**不删**，挂到行外面那层包装上（改名不是放宽，见 §6） |

---

## 3. 修法：为什么不新开一族，也不往 `apps/web` 的 CSS 里塞

三条出路，只有第三条不用抬基线也不用偷跑判据：

1. ❌ **把 4 处内联搬进 `apps/web/src/styles/app/kanban.css` 的 `.ht-kanban*`** ⇒ 族 33 → 34 ⇒
   `check:row-single-source` 红。要绿就得抬那个基线 —— 而基线是**判据口径**，不是顺手能改的数。
2. ❌ **把 4 处内联提成常量对象（`STYLE={…}` 再 `style={STYLE}`）** ⇒ `check:l4` 只数 `style={{`
   这一种写法，它看不见 ⇒ **读数不动而债还在**。这是 traps #671 记的已知漏洞，本单**明令不用**。
3. ✅ **看板容器住进 `packages/ui/src/task-list/TaskBoard.tsx`**（本单新增）：
   列是什么形状（横排、等宽、表面色、列标题的语义样式）由**共享层**回答，
   宿主（`apps/web/src/features/kanban/**`）只回答"数据从哪来、拖放怎么接"。

> ⚠️ `packages/ui` 是 RN 包，**没有 CSS 载体**（`find packages/ui -name '*.css'` = 0）——
> 所以"把样式写进共享包"在这里的落地形态是**RN 样式表 + 共享组件**，
> 不是 `.css` 文件。web 侧由 `react-native-web` 把它编译成原子 class，与四象限同一机制。
> 换句话说：**`task-board` 这个"族"存在于共享层，不存在于 `apps/web` 的 CSS 里** ——
> 而 `check:row-single-source` 的判据本来就是"web 顶层族只减不增"，它不该管共享包。

### 3.1 新增的共享组件长什么样（接口面）

`TaskBoard`（`packages/ui/src/task-list/TaskBoard.tsx`）**只做四件事**：

| 它负责 | 宿主负责（经插槽） |
|---|---|
| 横排等宽的列、列的表面色/圆角/内边距、列标题的语义文字样式、列内计数 | 列**内容**（`tasks`）、行尾动作（`renderTrailing`）、元信息（`renderMeta`）、投放层（`renderColumnOverlay`）、行的外层包装（`renderRowWrapper`，拖放要真实 DOM 节点） |
| 每列直接渲染**共享 `TaskList`** ⇒ 行就是 `TaskRow`（勾选框 + 标题 + 触达区 + 无障碍） | 列名文案、列的无障碍整句（`labels`） |

与 `QuadrantBoard` 的分工**逐字相同**（那是本仓已拍过的形状，不新发明一套）。

---

## 4. 落地步骤（每一步都写"这条判据怎么才会红"）

| 步 | 做什么 | 这一步的判据 | 怎么才会红 |
|---|---|---|---|
| 1 | 新增 `packages/ui/src/task-list/TaskBoard.tsx` + `src/index.ts` 加一行导出 | 新 spec 的 A/A2（逐字节相同 / 档位不是装饰） | 把列内的 `TaskList` 换成手写的一行、或把 `density` 删掉 ⇒ A/A2 红 |
| 2 | 重建 `KanbanView`：`DndContext` 保留（`pointerWithin` + `verticalListSortingStrategy`），列 = `TaskBoard` 的列，行尾握把 = `useSortable` 的 activator | 拖放仍是"跨列 = 改 `projectId`" | 把 `onMoveTask` 的调用删掉、或把 `over` 的列解析改错 ⇒ 新 spec 的行为判据红（见下） |
| 3 | 接共享选中：`useSelected('task')` → `activeTaskId`；点行 → `selection.select('task', id)` | 断言 I（立场 `selects`）+ 新 spec 的"选中底色只落在一条上" | 把 `activeTaskId` 的转发断掉 ⇒ 高亮判据红；把 `because` 留着 `row-actions-only` ⇒ 门禁的**过期腿**红 |
| 4 | 删 `ht-kanban` / `ht-kanban__column` 两个惰性钩子；`data-testid` 三个锚点保留 | `check:l4`（78 → 74）、`check:row-single-source`（33） | 新写一处 `style={{` ⇒ l4 红；新写一条 `.ht-kanban` 规则 ⇒ 族 34 红 |
| 5 | 改 `scripts/check-selection-single-source.mjs` 的 **kanban 那一条登记**（立场 + 类别 + needle + `because`） | 断言 I | needle 从 `KanbanView.tsx` 里消失（比如把 `useSelected('task')` 那行删了）⇒ 过期登记红 |
| 6 | 新增 `apps/web/tests/kanban-row-parity.spec.tsx` | 见 §5 | 任一条断言的产品侧前提被破坏即红 |

---

## 5. 新判据（`apps/web/tests/kanban-row-parity.spec.tsx`）四条

| 断言 | 钉住什么 | 怎么才会红 |
|---|---|---|
| A | 同档位（`compact`）下，看板列里的行与 `TaskList` 的行 **`outerHTML` 逐字节相同** | 列内的行换成手写的一份；或看板把 `density` 退回默认档 |
| B | 列里的行**带** `task-toggle-<id>`（勾选框）—— 迁移前那张卡没有 | 行不是共享 `TaskList` 渲染的 |
| C | `data-testid` 三个旧锚点（`kanban-view` / `kanban-col-<id>` / `kanban-card-<id>`）**仍然在** | 换组件时把锚点丢了（"锚点改名"= 判据失效，不是重命名） |
| D | 选中：宿主递 `activeTaskId` ⇒ **只有那一条**行带底色；点行 ⇒ 宿主收到那一条的 id | 宿主把 `activeTaskId` / `onOpenTask` 声明了却没往共享层传（断言 E 的同形状事故） |

外加一条**源码级**判据（C 组，与四象限同一写法）：`KanbanView.tsx` 里
**不许**出现 `accessibilityRole="checkbox"` / `task-toggle-` / `TASK_ROW_SHAPE` ——
它一旦自己画行，上面四条会在"两处一起改"时仍然绿。

---

## 6. 三个 `data-testid` 的去向（**改名不是放宽**）

| 旧锚点 | 现在挂在哪 | 为什么不能删 |
|---|---|---|
| `kanban-view` | 共享 `TaskBoard` 的根（`testID` prop） | 它是"这一面是不是看板"的唯一锚点 |
| `kanban-col-<id>` | 共享 `TaskBoard` 的列容器（`columnTestID` prop） | 列是拖放的投放目标 |
| `kanban-card-<id>` | 宿主 `renderRowWrapper` 注入的**行外层包装**（`<div>`，与 `ManualSortDnd` 的 `task-sortable-<id>` 同形状） | ① 它是既有 e2e/截图里"一张卡"的名字；② 拖放的 transform 需要一个真实 DOM 节点（共享行是 RN `View`，拿不到 ref） |

⇒ 这不是把判据改松，是**同一批锚点换了挂点**：值是同一个，位置从"手写卡片的 div"
移到"共享行的外层包装"。新 spec 的 C 组逐条断言它们还在。

---

## 7. 用户能看到什么变化（可核对）

1. **每张卡不再是裸标题**：列里的行有 **勾选框**（点一下完成，带 44 触控区与
   `aria-checked`）、**标题**（语义文字样式、已完成加删除线）、**行尾的拖拽握把**（`kanban-drag-<id>`）。
   —— 与列表/四象限**同一份行**，不是照着画的第二份。
2. **列有了形状**：每列是共享层渲染的表面（表面色 + 圆角 + 内边距 + 列标题 + 列内计数），
   不再是四条没有规则的 `className`。
3. **选中跨视图一致**：在列表里选中的那条，切到看板仍带高亮（`color.primary-subtle` 底色 +
   `aria-current`）；在看板里点一条，选中也跟着换（同一枚 `useSelected('task')`）。
4. **拖放真的能用了**：改之前 `useSortable` 的 `listeners` / `attributes` **一个都没挂**
   （所以跨列拖拽从来没被触发过，只有代码）。现在行尾握把是 activator，
   拖到另一列（含空列，空列有整列的投放层）⇒ 写一条"改归属"的 op。
5. **键盘**：行的勾选框是 `role="checkbox"` + `tabindex="0"`，Tab 能走到；行体是 `<button>`
   （Enter = 选中）；行尾握把也是 `<button>`。
   🔴 **但 ↑/↓ 光标与 Space 勾选都不在看板这一面生效** —— 那段补丁住在
   `apps/web/src/lib/keyboard-cursor.ts`，而它按视图登记（`CURSOR_VIEWS` 里没有 `kanban`）。
   Space 不生效的机制值得写下来：`react-native-web@0.21.3` 的 `isValidKeyPress` 只对
   `<button>` / `role="button"` 认 Space（实测源码 `PressResponder.js:66`），勾选框是
   `role="checkbox"` 的 `<div>` ⇒ **浏览器与 RNW 都不激活它**，这正是 `keyboard-cursor.ts`
   里那段 Space 补丁存在的理由，而看板不在它的绑定范围里。见 §8 第 4 条。

---

## 8. 我知道但没做的（逐条写清，不留"以为做了"）

1. **同列内排序**。这一轮明确不做：跨列 = 改 `projectId` 是既有语义，同列排序要新增
   `order` 字段的写入路径（`planManualReorder` 那套已经存在，但"看板列内顺序"与
   "列表手动档顺序"是不是同一个 `order` 是一个产品判断）。`verticalListSortingStrategy`
   仍然按原样保留（不扩）。
2. **列头拖拽**（拖动整列换顺序）。需要一条"清单顺序"的写入口，今天清单顺序不在本单白名单里。
3. **per-view 排序**（看板自己一套排序口径）。这要 ADR：`sortTasks` 的口径今天是**每屏一个**，
   再长出一份"看板自己的顺序"就是第二份比较规则。**明确不做。**
4. **看板不在键盘光标表里**（`apps/web/src/lib/keyboard-cursor.ts` 的 `CURSOR_VIEWS`）——
   那个文件的注释里写着一个**没拍板的产品问题**：看板是二维的，↓ 是"列内往下"还是"跨列按 DOM 序往下"。
   本单不改它（也不在文件白名单里），**但它的那段注释现在有一句是过期的**：
   那里写着"四象限能登记是因为它复用任务行、天然一维；**看板不复用**"—— 看板现在复用了。
   ⇒ 三件连带的事都记在这里，**一件都没做**：
   ① 那段注释放进下一单改；
   ② 拍板"↓ 的语义"之后把 `kanban` 登记进 `CURSOR_VIEWS`；
   ③ 在那之前，看板里 **Space 勾不了任务、↑↓ 走不了行**（机制见 §7 第 5 条），
   而 Enter 能勾（`isValidKeyPress` 对任何节点都认 Enter）—— 这是今天**可用但残缺**的键盘路径。
   ④ 🔴 顺带说明**拖放也吃不到键盘**：本单没有装 `KeyboardSensor` —— 二维板跨列拖拽需要
   自定义的 `coordinateGetter`（↓ 在哪一列上算"到下一列"），而那就是上面那个没拍板的问题。
   装了 sensor 反而会让"按空格起拖、方向键没反应"变成新的坏状态。
5. **列多时没有横向滚动**。迁移前写着一个 `overflowX: 'auto'`，但列是 `flex: '1 1 0'`
   （等宽、可收缩）⇒ 那个声明**从来没有被触发过**。现在按同一语义（等宽列一起变窄）落地，
   不保留一个永不生效的声明 —— 而"列多到要横向滚动"是一个尺寸策略问题
   （列的最小可读宽度取哪个 token），不是本单顺手能定的。
6. **元的元信息行（截止/优先级/归属徽章）没接进看板卡**。接它要读"截止显示方式"这枚
   **设备本地偏好**，而它的唯一读点在 `App.tsx:1312`（`useState(loadDueDisplay)`）。
   在看板里再读一次 = 同一个偏好两份读者，改设置时两边不同步。正确修法是把那枚状态
   提到一个共享出口 —— `App.tsx` 不在本单白名单（另一条线在改）。
7. **`TaskBoard` 尚未登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**。
   仓库规矩是"加新共享组件就要登记"（那份清单文件头写着这是出现过三次的同一个缺口）。
   本单**没登记**，因为那支脚本不在白名单（另一条线在同一张表上加 attachments 的符号）。
   缺口用新 spec 的那条行为判据兜着：**只挂 `KanbanView`（不套外壳 Provider）也必须渲染出共享行** ——
   少了 `HeytaUiProvider` 这一条会当场抛错。补登记是**一行**：`'TaskBoard',`。
8. **空列有投放层，但"拖到列标题上"不算投放**（投放层的命中区是列内容区）。够用，不扩。

---

## 9. 验收（8 条，逐条贴 rc 与现量）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `pnpm typecheck` | rc=0 |
| 2 | `pnpm check:l4` | rc=0，且它自己打印的 `apps/web/src/features` 现量 ≤ 74 |
| 3 | `pnpm check:row-single-source` | rc=0，且打印 `ht-* 前缀族 33` |
| 4 | `pnpm check:selection-single-source` | rc=0，且断言 I 那一行里 `selects 8` |
| 5 | `pnpm check:design` / `check:text-color` / `check:ui-language` / `check:layering` | 逐条 rc=0 |
| 6 | `cd apps/web && npx vitest run` | 全绿（passed/failed 由脚本自己打印） |
| 7 | `pnpm check:e2e-specs-parse` | rc=0 |
| 8 | 人工看眼 | 每列的行有勾选/标题/行动作，与列表同一套行 |

> ⚠️ 判据 6 之前必须 `pnpm --filter @heyta/ui build`：`apps/web` 的单测走 `@heyta/ui` 的
> **`dist/`**（package exports），不重建就量的是上一次构建产物（`quadrant-row-parity.spec.tsx`
> 文件头记着这条，本单同样适用）。
