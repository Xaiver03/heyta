# 交接：滴答对齐（排印 + 行操作 + 详情面 + 侧栏）

> 状态：**交接记录**（只记当前停在哪、下一步怎么接）。决策与理由在
> [ADR](../adr/)，实现状态与判据在
> [dida-alignment-typography-and-features.md](dida-alignment-typography-and-features.md)，
> 事故的可复用形状在 [环境陷阱](../reference/environment-traps.md)（本文只给号）。
> 写于 2026-11-05 00:4x。⚠️ 本文**不写会漂的数**：凡"几条/几个/多少秒"都给现量命令。

---

## 〇、这四问先答完（给零上下文的下一位）

### Q1 · 产品意义上做到了哪些？

滴答清单上那套"在任务行上右键/长按就能做完高频操作"的形状，web 已经成立：

- 行菜单里有**优先级四档（旗帜图标）、移动到、标签（含就地新建）、添加子任务、置顶**；
  键盘与鼠标两条路都点得动（原文档写过"只在鼠标上成立"那一格是真缺陷，已修）。
- 详情面底部有一行工具条：**移动到 / 备注 / 更多**。第三枚「更多」补的是可达性 ——
  面单里的动作区此前只有右键与 `Shift+F10` 两个隐形把手，界面上一个可见入口都没有。
- 逾期那一格在**真浏览器里比过色**（亮暗两套各读一次 `--ht-color-danger`）。
- 回收站从 rail 底段搬进**侧栏底部**，与「已完成」并列；清单/标签分组头下各有一句说明。
- 上面这些不只 web：跨端那份顺序所有者（领域层 `sortTasks`）修好之后，
  **真 iOS 模拟器**上"长按 → 置顶 → 那条跑到最前"已经量到，**真 Electron 窗口**也画得出任务行。

### Q2 · 现在停在哪？

- 阶段 2–4（这份任务书的范围）**做完并入库**，九条验收都有本轮现量。
- 这份计划的**阶段 1（排印密度）已于 2026-11-05 入库** —— 一笔 16 枚文件：四枚值 + 六份生成件 +
  `typography.spec.ts` 那格改签的期望值 + `mockup.css` 四处镜像 + 五处被这次改动否证的旧口径。
  当年"与别线 token 工作同片地"那一格是靠**逐 hunk 核归属**收的，办法与读数写在 `BLOCKED.md` B262。
- 这份计划的**阶段 5（三个大功能）没做**：C1 富文本、D1 自定义筛选器；C3 评论已被另一条线
  以 W4 落地（不是这份计划做的）。
- "和滴答全面对齐"这件事**不成立**，分母见 §四。
- 所有提交都在本地，**没有 push**。

### Q3 · 下一步做什么？

按 §五 的顺序。第一条不是写代码，是先跑 §三 那组现量。

### Q4 · 做的这些对产品有什么意义？

滴答的护城河不在功能数量，在"高频动作的手感"。这一轮把 heyta 最常被点的
三个面（行操作、详情面、侧栏导航）从"能用但要点好几层"提到"一次手势到位"，
并且顺手修掉一个**只在键盘上成立**的缺陷（鼠标能用、键盘开不了子菜单）——
那类缺陷不会出现在任何功能清单里，却决定键盘用户能不能把活干完。

---

## 一、原始目标（别重新定位、别缩范围）

`docs/plans/dida-alignment-typography-and-features.md` 的阶段 2–4：

| 项 | 内容 |
|---|---|
| B1 | 优先级四档，旗帜图标，行菜单子菜单 |
| B2 | 添加子任务 |
| B3 | 标签子菜单：已有标签 + 就地新建 |
| B4 | 移动到（清单） |
| B5 | 置顶切换 |
| C2 | 详情面底部工具条 |
| C4 | 逾期红色 |
| D2 | 回收站搬进侧栏底部 |
| D3 | 侧栏分组头下说明文字 |

约束：不改 schema（置顶用现成的 `pinnedAt`，未新增字段）；不引入新依赖；亮暗两套都适配。

---

## 二、本轮已交（一格一句话，出处指向事实源）

| 格 | 落点 |
|---|---|
| B1–B5 行菜单四组动作 | `apps/web/src/features/tasks/TaskRowMenu.tsx`；判据 `apps/web/tests/task-row-menu.spec.tsx` |
| 🔴 键盘 Enter 打不开子菜单（真缺陷） | `role` 从包裹 div 移到真按钮；判据「键盘 Enter 能展开子菜单」+ `pnpm check:menu-keyboard` |
| 🔴 零标签时没有「标签」那一行（真缺陷） | 同上文件；判据在浏览器腿 ⑧ |
| 🔴 草稿 Esc 死键 / 打字被抢焦点（真缺陷） | 聚焦 effect 只认布尔 + 滚动关闭放过面板内部滚动；判据 ⑧⑨ |
| 🔴 置顶在 web 上不生效（真缺陷） | `packages/domain/src/task-order.ts`（唯一那份展示顺序所有者）；判据 `packages/domain/tests/task-order.spec.ts`，做过变异验证 |
| C2 工具条三枚 | `apps/web/src/features/tasks/TaskDetailCard.tsx` + `App.tsx` 两处落点接线 |
| C4 逾期红色 | 渲染点是共享 `packages/ui/src/task-list/TaskBadges.tsx`（**不是**原文写的 `DueBadge.tsx`，那一格在 web 没有渲染点）；裁决记录在计划文档 C4 那一格 |
| D2 回收站搬侧栏 | `view-tabs.ts`（常量更名 `SIDEBAR_TOOL_TABS`）、`App.tsx`、`sidebar.css`、`RailNavigation.tsx`（rail 工具段整段删）。🔴 展厅那一手（`apps/landing/` 五枚：`app-shell-shape.ts` 拆 `SHELL_SIDEBAR_TOOLS`、`AppWindow.tsx` 侧栏底部那一组、`mockup.css` 的 `.mk-sidebar__tools`、两枚 landing spec）当时**没跟着那一笔**，2026-11-05 23:2x 另起一笔入库，判据与证据见 `BLOCKED.md` B265 |
| D3 分组说明 | `ProjectsPanel.tsx` + `sidebar.css`；空态那格让位给空态文案 |
| 浏览器腿 9 条 | `e2e/tests/dida-alignment-detail-sidebar.spec.ts`（8 张图逐张看过） |
| 设备腿 iOS | `scripts/verify-mobile-pin-order.sh`（`pnpm verify:mobile-pin-order`），9/9，两张图入库 |
| 设备腿桌面壳 | `HEYTA_SMOKE_SHOT=<绝对路径> pnpm --filter @heyta/desktop smoke -- --window` |

---

## 三、当前状态（接手先跑这一组现量，别信本文任何一句）

```bash
date                                  # 本仓所有"绿"都只对那一秒成立
git log --oneline -12                 # 本线那几笔的号在这里取，别抄文档
git status --short                    # 共享工作树：先看有几条线在飞
pnpm check:design && pnpm check:design-token-refs
pnpm --filter @heyta/web build
cd apps/web && pnpm exec vitest run tests/task-row-menu.spec.tsx \
  tests/task-detail-card.spec.tsx tests/projects-panel.spec.tsx
cd e2e && pnpm exec playwright test tests/dida-alignment-detail-sidebar.spec.ts \
  tests/sidebar-trash-anchor.spec.ts --reporter=line
node -e "console.log(require('./package.json').scripts.check.split(' && ').length)"   # 链步数是活数
```

⚠️ **"树被别人改动过没有"这一问，别用提交计数回答**（2026-11-05 实测：`git log <revs> -- <路径>`
会**往回走整条历史**，打出老提交，读到的不是它声称的东西）。要判"我量过的那批文件现在还在不在
同一版"，用 blob 差额这一把：

```bash
git diff --name-only <我测完那一笔> HEAD -- \
  packages/design-system packages/ui/src apps/web/src/features/tasks apps/web/tests \
  apps/landing/src apps/landing/tests e2e/tests design-system/heyta
# 空 = 九条验收的消费者文件与当前 HEAD 逐字节同一 ⇒ 那批读数仍指当前产物，不必重跑

# 🔴 先跑分母守卫（陷阱 #658）：上面任何一条若不被版本库跟踪，那条 diff 就恒读 0 = 空转的尺
for p in packages/design-system packages/ui/src apps/web/src/features/tasks apps/web/tests \
         apps/landing/src apps/landing/tests e2e/tests design-system/heyta; do
  [ "$(git ls-files "$p" | wc -l)" -gt 0 ] || echo "🔴 空尺: $p"
done
```

2026-11-05 23:4x 现量这八条的分母：**37 / 118 / 16 / 233 / 74 / 27 / 146 / 3**（被跟踪枚数，合计 654）⇒ 无空尺，
这条命令读 0 才真的是"没变"。

2026-11-05 21:37 现量：以 `592ca4ed9`（20:1x 那趟复量之后那笔）为起点，差额**为空**；
其间落地的 `30166c7ca` / `a3590d851` / `8ecf8a726` 三笔分别是 capture 的装置脚本、
证据目录回收与 capture 文档，都不在这批路径里。

🔴 **这把尺的牙验过**（一条永远为空的检查比没有检查更坏）：同一命令把起点换成阶段 1
入库前那笔 `29214d5b7` ⇒ 列出 **18 枚**文件（本线那 16 枚，加 capture 的
`packages/ui/src/capture/model.ts`、`packages/ui/src/index.ts`）。
⚠️ 读"空"的时候记住：这批路径**包含别线的文件**，所以空 = **谁都没动**，
不是"只有本线没动"；要单独判本线那批，把路径表换成 `20358bc6c` 那笔的文件清单
（现量 `git show --stat 20358bc6c`）。

设备腿（有已启动的模拟器才跑；先 `xcrun simctl list devices | grep Booted` 取 UDID）：

```bash
IOS_UDID=<现量取的那个> HEYTA_IOS_DERIVED=/tmp/heyta-ios-release-dida \
  bash scripts/verify-mobile-pin-order.sh
```

### 九条验收逐条对上今天的读数（2026-11-05 20:0x，HEAD 已含别线 `e33523e7e`）

用例名是从文件里读出来的，不是复述的。⚠️ 两枚浏览器腿 11/11 与三枚单测 123/123 是 20:0x **同一趟**
（HEAD 已含别线 `e33523e7e`）；iOS 设备腿 9/9 是 17:0x 那一趟，戳在 `HEAD=1062146c6`，
比这棵树早两笔 —— 别把三行读成同一次测量。

| 格 | 判据（用例名 + 位置） | 本趟 |
|---|---|---|
| B1 优先级四档 | `apps/web/tests/task-row-menu.spec.tsx`「B1 优先级：展开四档，点「高」发的是 onSetPriority(taskId, High) 并收走菜单」+ 浏览器腿 ⑥ | ✅ |
| B2 添加子任务 | 同文件「B2 添加子任务：点它把父任务的 id 交给宿主，并收走菜单」 | ✅ |
| B3 标签（含就地新建） | 同文件「B3 标签：点一条发的是**整组**」「🔴 B3 取消：已经在组里的那一条再点一次…」「🔴 一条标签都没有、但宿主接了 `onCreateTag` ⇒ 「标签」这一行仍在」「🔴 草稿里按 Esc：退回「新建标签」那一枚，菜单**不被一起关掉**」+ 浏览器腿 ⑧ | ✅ |
| B4 移动到 | 同文件「B4 移动到：给的是「收集箱」+ 每条清单，点清单发的是那个 id」+ 浏览器腿 ④（`Shift+F10` → 走到「移动到」→ Enter 换归属） | ✅ |
| B5 置顶 | 同文件「置顶这一项（B5…）」三条（含「🔴 已置顶的那条给「取消置顶」—— 是开关不是单向按钮」）+ `packages/domain/tests/task-order.spec.ts`（做过变异验证）+ 浏览器腿 ⑥ + iOS 设备腿 9/9 | ✅ |
| 🔴 键盘 Enter 打不开子菜单（真缺陷） | 同文件「🔴 键盘 Enter 能展开子菜单（触发器必须是真菜单项，不是包一层的 div）」+ `pnpm check:menu-keyboard` | ✅（门今天退 0） |
| C2 工具条三枚 | `apps/web/tests/task-detail-card.spec.tsx`「底部工具条（滴答对齐 C2）：按钮说的事必须真做得到」+ 浏览器腿 ② | ✅ |
| C4 逾期红色 | 浏览器腿 ①（计算色 = `--ht-color-danger` 且带日历/计时图标）与 ⑤（暗色同一格还在原位） | ✅ |
| D2 回收站搬侧栏 | `e2e/tests/sidebar-trash-anchor.spec.ts` 两枚（宽屏：那一行在侧栏最下方且 rail 上没有第二枚；窄屏：抽屉里点得到且真的切视图）+ 腿 ⑤⑦ | ✅ |
| D3 分组头下说明 | `apps/web/tests/projects-panel.spec.tsx`「D3 分组说明：标题下面那句"这一格装的是什么"」+ 空态那格「零清单零标签时，两块各给一句标题 + 一句说明」+ 浏览器腿 ③ | ✅ |

⚠️ 这张表只回答"九条今天还成立吗"。它**不**等于"和滴答对齐了"——分母在
[dida365-feature-benchmark.md](../research/dida365-feature-benchmark.md) **§9.2**（只读那一节），
2026-11-05 现量五条仍缺：无看板、`TaskFilter` 是封闭联合、`nextAfterCompletion` 零生产调用点、
`Task.order` 无写入路径、C1 富文本没做。

---

## 四、还欠什么、卡在谁

### 4.1 这份计划内部（阶段 1 与阶段 5）

| 格 | 状态 | 卡在谁 |
|---|---|---|
| 阶段 1 排印密度（`TASK_ROW_SHAPE.bodyPaddingBlock` / `listGap` + 生成的 token 件） | ✅ **已入库**（2026-11-05 16:5x 一笔 16 枚文件） | 本线。逐 hunk 核过 `packages/design-system/**` 每一处都能追溯到 A1/A2 那四枚值或它们的生成件；`mockup.css` 只取本线那四处镜像，`.mk-sidebar__tools` 那枚留在 landing 手里。分归办法与读数在 `BLOCKED.md` B262 |
| 阶段 1 的**值判据**（不是实现） | 🔴 **缺口，已登记** | 设计系统线 / 产品。四枚值里只有 `row-title` leading 被 `typography.spec.ts` 钉住；行最小高 60 与 A2 那两枚槽位**没有任何断言钉值** ⇒ "token + 四处镜像"协同回退全仓不会红。现量与出路（钉不变量而不是钉值，先例是 `typography.spec.ts:39/76` 那两枚关系断言）写在 `BLOCKED.md` B264；本线不替别人拍判据口径 |
| C1 富文本编辑器 | 未做 | 先过两道门：编辑器选型 + 许可证（AGENTS §3.1/§3.2）。连带详情面「文本格式」那枚按钮一直不画 |
| D1 自定义筛选器 / 智能清单 | 未做 | 产品边界先定义（`TaskFilter` 现在是封闭联合，用户自建查询没有落点） |
| C3 评论 | 已由协作线以 W4 落地（详情面协作区） | 不欠；但"非共享清单要不要评论"这条口径归产品 |

### 4.2 对滴答的真实缺口（2026-11-05 现量，逐条带命令）

分母在 [dida365-feature-benchmark.md](../research/dida365-feature-benchmark.md) **§9 勘误** ——
那份矩阵的正文是 2026-09-28 的只读审计，十几行已经过期，**先读 §9 再读 §2**。
今天仍成立的是：

| 缺口 | 现量 |
|---|---|
| 看板视图 | `ls apps/web/src/features/`（没有这一族；命中的"看板"只是注释里列举覆盖面） |
| 自定义筛选器 | `sed -n '51,60p' packages/domain/src/task-filter.ts`（封闭联合） |
| 重复的「完成后顺延」 | `grep -rn "nextAfterCompletion(" --include='*.ts' packages/*/src apps/*/src \| grep -v "export function"`（零生产调用点 ⇒ 实际是固定排期） |
| 手动拖拽排序 | `grep -rn "order:" packages/app-host/src/actions.ts`（空 ⇒ `Task.order` 是死字段） |
| 富文本备注 | 见 4.1 的 C1 |

### 4.3 验收面欠的（不是功能，是证据）

| 格 | 状态 |
|---|---|
| Android 设备腿 | **没跑**。构建与模拟器在 linux-dev（不在本机），需要先写/接一枚远端装置；参照收集框那条线的做法，别在本机起 Gradle |
| 四端重装 | **没跑**（要在隔离检出里跑，见 [multi-end-build](../agents/multi-end-build.md)） |
| 整棵 `e2e/` | **刻意没跑**：它会重写别线未入库的取证图 |
| iOS 屏幕图 | 已取到（两张入库，17:0x 那一趟换上并逐张与上一趟对比过）。⚠️ 每跑一趟装置会在模拟器本地库里留 3 条 op（置顶是持久状态），目标行会逐趟下漂——本趟现量 `ops 31 → 34`、侧栏角标 `22 → 24`；脚本注释里写明并给了应对（读数前先 `--scroll-into-view`，判据读相对 y） |
| 暗色 | 只在 web 验过（e2e ⑤⑦）；移动端/桌面壳的暗色没有设备读数 |

### 4.4 跨树一致性（✅ 2026-11-05 23:2x 闭合，过程见 B265）

本线那次常量更名（`TOOL_VIEW_TABS` → `SIDEBAR_TOOL_TABS`）让
`apps/landing/tests/mockup-shell-shape.spec.tsx` 那枚**按源码文本对账**的判据在 HEAD 上锚点失效；
失败形状是**红不是假绿**：`pairsOf` 走 `arrayBlock`，而 `arrayBlock` 找不到锚就
`throw new Error('源码里找不到 … —— 判据锚点已失效')`。⇒ `pnpm typecheck` 全绿不代表那枚 spec 能跑，
这条纪律保留。

🔴 **这一格原本登记成"等 landing 线落库"，那个归属判错了**：修法是**本线 D2 的展厅侧那五枚文件**
（`app-shell-shape.ts` / `AppWindow.tsx` / `mockup.css` / 两枚 landing spec），11-04 12:46–12:51 写完后
一直躺在工作树里，而计划本文另一格早就把它登记在本线名下 —— 两份说法自相矛盾就是该重判的信号。
三条重判证据、判据只增不减的核对、以及"别把红押到别人身上"的规矩都在 `BLOCKED.md` **B265**（本线 B 号最高就是它）。
取末号要用**标题形状**那把尺：`grep -oE '^## B[0-9]+' BLOCKED.md | tail -1` ⇒ `B265`。
⚠️ 本节先前写的 `grep -oE '^🔴 \*\*B[0-9]+' … | tail -3` 会**停在 B260** —— 那个形状匹配的是正文里的
内联标记（48 处），不是分节标题（228 处），后面的条目压根不在它的写法里；照它读就会以为台账落后三格。
与陷阱 #657 同族：**尺扫不到的那种写法 ≠ 不存在**。

入库后的现量（本笔之后重读，别抄这行）：
`git show HEAD:apps/landing/tests/mockup-shell-shape.spec.tsx | grep -c "pairsOf('const TOOL_VIEW_TABS')"` ⇒ 0，
同一份里 `const SIDEBAR_TOOL_TABS` ⇒ 1，`git status --short apps/landing` ⇒ 空。

---

## 五、下一步（按顺序，每步都带动手前的前置）

1. **先跑 §三 那组现量**，确认树没被别人改动过、九条仍然成立。
2. ✅ **把阶段 1 那两枚排印改动入库**（2026-11-05 16:5x 做完，下一位从第 3 步接）。
   前置：`git diff -- packages/design-system/src/task-row-shape.ts` 逐行确认是本线的手，
   生成件（`generated/*`、`typography.*`）里哪些属于别线未提交的工作 —— 分不清就只提交源文件。
   ⚠️ 实际做法比这条前置多走了一步：`packages/design-system/**` 整片**都是**本线的手（逐 hunk 核过），
   真正同片地的是 `apps/landing/src/mockup/mockup.css` —— 那里 5 枚 hunk 有 4 枚是阶段 1 的镜像
   （被两枚按源码文本对账的 landing spec 钉住，不提会让 HEAD 红），第 5 枚 `.mk-sidebar__tools`
   与 D2 展厅那一手成套 ⇒ 用 `git apply --cached` 只取四处，暂存与提交压进同一条命令。
   🔴 当时把成套那一手写成"与 landing **在飞**的那一手成套"，**归属判错了**：那一手是本线 D2 自己的，
   写完 34.5 小时零写入。成套所以不拆走是对的，误判归属所以白等了一天 —— 判据、证据与规矩见 `BLOCKED.md` B265 与 §4.4。
3. ✅ **打「完成后顺延」**（`nextAfterCompletion` 接进生产路径）—— **2026-11-06 00:5x 已落地**（用户授权本线拍板执行）。
   字段 `Task.repeatAfterCompletion`（可选，缺省即固定排期）+ 动作 `setRepeatAfterCompletion` +
   `completeTask` 分两档取基准；web 复选框 / 移动端 chip 两个落点各一条判据，行为四臂在
   `packages/app-host/tests/repeat-actions.spec.ts`（摘掉分支实测会红）。取舍与复跑口径见 benchmark **§9.5**。
   下一位从第 4 步接。
   原先写的前置（"先读 ADR 里重复语义那一格"）执行结果如实记：**`docs/adr/` 里没有关于重复语义的 ADR**
   （现量 `grep -rln 'nextAfterCompletion\|完成后顺延' docs/adr/` ⇒ 空），真正约束这次改动的是
   `packages/domain/src/recurrence.ts` 与 `TaskActions.completeTask` 那两段注释——"锚点钉一次不动"这条**没被破坏**，
   两档只换基准。原先那句"这一格是数据 + 调用点，不依赖选型，成本最低、用户可感知"也兑现了。
4. ✅ **C1 富文本**：先做选型 + 许可证两道门的调研，**不要先写界面**。
   前置：AGENTS §3.1（2021 年后仍在维护）、§3.2（许可证白名单），过了才谈落点。
   —— **2026-11-06 10:4x 这一步的"该做的那一半"做完了**（用户授权本线拍板）：逐家 `npm view` 现量过两道门，
   过门的是 TipTap / Lexical / Slate / ProseMirror / Editor.js / markdown-it，被许可拦下 CKEditor 5（GPL）与
   TinyMCE（LGPL），被维护性拦下 Quill（2024-11 起）、Draft 那条（2022-07）与 `tiptap-markdown`（2025-09）。
   裁决与理由写在 [dida-alignment-typography-and-features.md](dida-alignment-typography-and-features.md) 的 **C1** 那节，
   读数表在 [dida365-feature-benchmark.md](../research/dida365-feature-benchmark.md) **§9.6**。
   🔴 **界面一行没写**（这一步的原话就是"不要先写界面"），下一位从第 5 步接；真要开工按 C1 那节那四刀切。
   ⚠️ 这一格拦路的三件事也都量过了：备注源格式要拍（拍成 Markdown ⇒ `Task.notes?: string` 零字段变更）、
   移动端四家候选都没有 RN 渲染器（只能拍"web 可编辑 / 移动端只读"）、
   以及 **AI 拆解会把备注逐字发出去**（`ai-breakdown.ts` 那句「已有备注：」+ 披露字段 `note`）。
5. **D1 自定义筛选器**：先要产品边界（用户能存什么查询、跨不跨端、E2EE 下服务端能不能筛）。
   前置：本地优先 + E2EE 意味着服务端看不到明文，"云端智能清单"这类做法直接不成立。
6. **补 Android 设备腿**（在 linux-dev 上），并把 iOS 那枚装置的读数纳入四端重装那一趟。
7. 每做完一步：跑对应门禁 + 把状态写回
   [dida-alignment-typography-and-features.md](dida-alignment-typography-and-features.md) 的「执行状态」，
   别只改本文。

---

## 六、死过的手（本轮实测，别再试一遍）

| 别这么做 | 为什么 / 该怎么做 |
|---|---|
| `xcrun simctl io <udid> screenshot out.png` 直接截 | 默认端口是宿主的 captureservice，会给一张合法但全黑的 PNG。**仓里 #208 早写明要 `--display=primary`** —— 我这次没先查账本就撞回去了。取完必须用 `scripts/screenshots/png-stats.mjs` 判空白，再看图 |
| 用 `looksBlank()` 判"全黑" | 它的另一半 `contentRatio < 0.01` 会把**白底界面**误判成空白（桌面壳那张 contentRatio=0.007 / colorSpan=255）。判全黑只按 `colorSpan`。见 #655 旁边的说明 |
| 清理/归一化步骤里不带 `--exact` 的 press | 子串退化会撞上「取消置顶」，代价是**往真库写一条 op**。见 #653（#109 的新形状） |
| 把解释性注释写进 `node -e "…"` 的双引号串里 | 注释里的反引号会被 shell 当命令替换执行，判据照样绿、shell 在报错。见 #654 |
| 拿"循环跑完没报东西＝逐枚都真跑过"当证据 | 同一晚犯两次，两次都造**假绿**：① `for` 循环喂一个 shell 变量 —— zsh 默认不对它做词分割，git 整批报错但我那句"无输出＝通过"照样打印；② 改用逐行读文件，临时路径多打一个右花括号 ⇒ 那枚文件从没存在过，循环零次迭代，echo 仍写着"逐枚真跑过"。三道守卫：循环前先数分母、读到 0 直接非零退出；循环内自增并把"实际处理 = N 枚"打进读数；临时路径写死、退出码单独取（别用管道尾巴）。见 #657 —— §七 那条 `App.tsx` 归因已经换到一把不依赖临时文件也不依赖词分割的尺上 |
| 相信 AX 框就是能点的区域 | RN 列表被下沿裁切的行，AX 读数完整、短按同一点毫无反应。见 #655：按下 → 回读 → 滚一段再来 |
| 拿"先建的在上面"当移动端顺序前置 | 移动端默认档是 `addedAt`（新的在上），web 走 `display`。判据要读**相对变化** |
| 在共享工作树里"先 staged 再隔几条命令才 commit" | 本线的 C2 三枚 hunk 就这样被别线一笔裸 `git commit` 顺走，内容没丢但归属记错。暂存与提交压进同一条命令，纯本线文件用 pathspec 形式 `git commit -m … -- <路径>`（另一侧的记录见 `BLOCKED.md` B257） |
| 把"分不清就只提交源文件"当安全默认 | 那正好会留下 **HEAD 断链**：`mockup-quadrant-shape.spec.tsx` 与 `mockup-task-row.spec.tsx` 是拿 token 名去 `mockup.css` 里找 `var()` 的，只提 token 不提四处镜像 ⇒ 干净检出上那两枚 spec 必红（与 `SIDEBAR_TOOL_TABS` 那次 B258 同一类）。这次先在**干净检出**上量了三臂再决定：HEAD 10/10 绿 / 入库前 10/10 红 / 混树（新 token + 旧镜像）恰好红在 4 枚配对臂。⚠️ "必红"这句的出处是那两枚 spec **自己的谓词**，不是本线复算的那把尺：`expectVar` 是 `expect(value).toBe('var(--ht-…)')` 逐字符比 var 名，`ruleBody` 找不到规则就 `throw`（现量位置 `apps/landing/tests/mockup-quadrant-shape.spec.tsx:193` 与 `mockup-task-row.spec.tsx:82`）。办法写在计划「阶段 1」那一节 |
| 看到红在别人的文件里就说是"别人写到一半" | 本线读到过两次：一次真是半写，一次是 `packages/ui/dist` 的陈旧 `.d.ts` —— 后者一条 `pnpm --filter @heyta/ui build` 就回绿，不需要等谁 |
| 凭"我记得有条 landing 线"把一处红登记成"等别人落库" | B258 ② 就这么白等了一次都没复量，而 HEAD 那格红从本线 D2 那笔（现量 `git log -1 --format=%ad --date=iso 8cbedf563`）一直开到 2026-11-05 23:2x，且它就在 `pnpm -r test` 的路上。登记前先量两样：**那几枚文件的 mtime 窗口离现在多久**（11-04 12:46–12:51 之后一整天零写入，那不是"在飞"）；**计划里那一格的归属写的是谁**（本文「展厅（landing mockup）跟着搬」那一格早就把它记在本线名下）。两份说法自相矛盾时，**矛盾本身就是该重判的信号**，不必等新证据。证据与规矩见 `BLOCKED.md` B265 |
| 改一个被**按源码文本对账**的常量名，只看 typecheck | typecheck/build 全绿仍会留断链（§4.4）。改名要 `grep` 文本锚点的消费者 |
| 跑整棵 `e2e/` 或 `pnpm test -- <文件>` | 会重写别线未入库的取证图；单文件过滤要用 `pnpm exec playwright test <文件>`，别拿 `--` 当过滤器 |

---

## 七、验证状态（哪些读数在哪棵树上）

| 门 / 腿 | 最后一次现量 |
|---|---|
| `pnpm check:design` / `check:design-token-refs` / `check:menu-keyboard` / `check:ui-language` / `check:docs` / `check:evidence-hygiene` | 2026-11-05 16:5x 全部退 0。⚠️ 其中 `check:evidence-hygiene` 那一戳**早于**设备图入库那笔（`907bd60e3`，20:1x），22:57 在提交**之后**复跑过一遍：rc=0，10 个 root / 10289 个文件 / 0 处违规，本线那两张图 358KB 与 392KB（单文件上限 25 MB） |
| ✅ `pnpm check:row-single-source` | 🔴 **2026-11-06 00:3x 闭合**（执行细节见本行末与 `BLOCKED.md` B267）。2026-11-05 23:1x 复跑曾**退 1**：`ht-*` 前缀族 29 > 基线 28。与本线无关 —— HEAD 与工作树的族清单**逐行相同**（两边都 29），28→29 那一跳在 `3d0d593f4`（收集框 S1–S5，`git log -S'.ht-capture-due-popover {' -- apps/web/src/styles/app/material.css` 唯一命中），多出来那一族是 `.ht-capture`。归因与两条出路写在 `BLOCKED.md` B263；本文 §4.4 那格说的 `.ht-spin` 已被 `7d3521391` 收掉，是旧的一戳。<br>🔴 **23:2x 补两维，别让下一个人把这格读重**（全部读数在 `BLOCKED.md` **B266**）：① **射程**——这枚红只在**未推送**那棵上（`git show origin/main:apps/web/src/styles/app/material.css \| grep -c '^\.ht-capture'` ⇒ 0），拉 `origin/main` 的人看不到它，会撞上的只有在这棵共享树上跑整链的人；② **动作无人认领**——本线 B263 写"归收集框线"，他们台账第 2014 行把这道门写成"别线"，互指 ⇒ 它不会自己闭合；收编还是抬基线属 M3 视图统一的判据口径，本线不碰，只能拍给你。⚠️ 还有第三件事别踩：那把门**自己头注释里的复现命令今天读 0**（`app.css` 已无顶层 `.ht-*`，族在 `./app/` 模块里），注释写"当前实测 31"而常量是 28 —— 照注释那条命令复算会得到"0 ≤ 28 ✅"，那是假绿不是空门。<br>✅ **00:3x 闭合，走的是"消掉净增"而不是抬基线**：`pnpm check:row-single-source` ⇒ **rc=0**，红话位现在是 `ht-* 前缀族 28 个，恰在基线 28（未新增）`。那两条类收编进这枚浮层**本来就挂着**的 `.ht-material` 族 —— `.ht-capture-due-popover` → `.ht-material--popover`、`__scroll` → `.ht-material__popover-scroll`，取值一字未动、几何仍由 `place()` 负责；代码层残留 `grep -rn 'ht-capture-due' apps packages e2e scripts` ⇒ 0 处。选它的依据在门自己第 329 行那句"收编回共享层之后，这个常量应当跟着下调"（棘轮要的是单调下降）。上面"只能拍给你 / 本线不碰"那句已被用户 2026-11-06 的授权解掉，同戳 `check:design` / `design-token-refs` / `tokens` / `surface-budget` / `overlay` 各 rc=0 |
| `pnpm check:tokens` / `check:md-tables` / `check:doc-citations` / `check:windows-xaml` / `check:native-bare` | 2026-11-05 16:5x 退 0（阶段 1 那六份生成件由 `generate:check` 逐字节对账，不是手写） |
| 本线补跑的门（**枚过分母，但不写成"全跑完"**） | 2026-11-05 22:5x–23:0x 逐个抓 rc，**退 0** 的 17 枚：`gate-wiring` `claims` `ui-provider` `theme` `text-color` `token-hashing` `token-minting` `docs-voice` `font-size-discipline` `detail-pane-status-table` `detail-pane-c1-coverage` `detail-pane-evidence-refs` `calendar-evidence-rigs` `scripts-parse` `locator-labels` `ux-coverage` `surface-budget` `shell-surfaces`；加上本线早先跑过的 `design` `design-token-refs` `tokens` `md-tables` `docs` `doc-citations` `doc-command-claims` `evidence-hygiene` `menu-keyboard` `ui-language` `crosslang-contract` `native-bare` `windows-xaml`。<br>🔴 **当时退 1 的两枚**：`row-single-source`（`.ht-capture`，B263）与 `detail-pane-slot`（下面那行）。<br>✅ **2026-11-06 00:4x 复量：前者已闭合**（收编执行完，`row-single-source` rc=0，见 B267），同戳 `check:l4-no-style` 也从 75>74 回到 rc=0（那 +1 是本线自己造成的，见 B268）⇒ 到 2026-11-06 00:5x 这两枚**都闭合了**（`row-single-source` 走 B267 收编、`detail-pane-slot` 走 B269 修尺），本线补跑过的静态门里没有一枚仍退 1。⚠️ `arkts` 退 0 但那是**跳过**，不算证据。<br>**没跑的**（主题不覆盖本线落点，或属被禁那一类）：`calendar` `arkts-widgets` `windows-shell` `windows-signing-posture` `server-design` `native-deps` `ios-native-bridges` `legal-email-claims`，以及链里所有会起浏览器/重写别线证据图的步（§六 那条纪律）。<br>分母取法：链 156 步 → 150 道 `check:` 门 → 按主题筛 40 枚候选 → 上表覆盖与本线落点相关的部分，其余**逐条列明原因**。我第一版把这句写成"剩下的都跑了"，那是过头话（当时只跑了 15 枚），已改成这份可对账的枚举。取数命令：`node -e "const s=require('./package.json').scripts.check.split(' && ');console.log(s.length, s.filter(x=>x.startsWith('pnpm check:')).length)"` |
| ✅ `pnpm check:l4-no-style` | 2026-11-06 00:4x **闭合**，rc=0（web 74=基线 74、mobile 52=基线 52）。这格先前在收集框计划里被记成"干净 HEAD 上就红 75 > 74"，方向对、**落点错**：门支持 `HEYTA_CHECK_ROOT`，把候选树拷进临时根按笔复算 ⇒ `df8abb7f5^` 读 74、`df8abb7f5` 读 75、**`origin/main` 也读 75** ⇒ 那 +1 是本线 11-04 那笔行菜单把 `Priority → var(--ht-color-priority-*)` 写进了 JSX 内联 `style`，而且**公开在已推送的那棵上**。修法是脚本自己那句"让总数降回基线以下，不是让基线涨到总数"：颜色收进 `task-row-menu.css` 的四枚修饰类，另补一条能失败的判据把颜色钉到具体档（门只数总数，抓不到是哪一行）——变异臂实测：改回内联即 FAIL，从 `.mut-bak` 逐字节还原后恢复绿。⚠️ 新那条判据第一版红给自己看过：旗标是 SVG，`el.className` 是 `SVGAnimatedString` 不是字符串，得取 `getAttribute('class')`。全程与理由在 `BLOCKED.md` B268 |
| ✅ `pnpm check:detail-pane-slot` | 🔴 **2026-11-06 00:5x 闭合，而且是"尺的问题"不是产品问题**（全程与三枚变异臂在 `BLOCKED.md` B269）。当时 2026-11-05 22:5x 本线补跑**退 1**，报"裸文本 `assistantWorkspace aiPanels contentView 'focus'`"——读实现才知道腿 A 摘 JSX 表达式用的是 `.replace(/\{[^{}]*\}/g, '')`，**只吃一层花括号**，而槽里那句合法的"挑哪一枚生产者"本身带嵌套，剥完剩标识符就被当成裸文本的那几枚标识符落在 `apps/web/src/App.tsx` 的 `const canToggleDetailPane = view !== 'settings' && ( … )` 这条**普通 JS 语句**里（不写行号，那个数会漂；现量 `grep -n 'const canToggleDetailPane' apps/web/src/App.tsx`），**不在 JSX 槽里**（门禁把槽区切片往外围延伸了）；⚠️ **这把门读的是工作树那份文件**，不是 HEAD（现量依据：`scripts/check-detail-pane-slot.mjs:73` 那句 `readFileSync(APP)`）—— 两边那句锚点**行号相同**（HEAD 与工作树各 grep 一次都是同一条 `const canToggleDetailPane` 开头），所以归因不随这份落后而翻。别线在 `App.tsx` 上只有一枚未提交 hunk（`ht-sheet` 的退出动画 class），离那条语句很远、也没碰这几枚标识符 ⇒ 这枚红不是那笔在飞的改动造出来的。那段最后一次被碰是 `fc2881ef8`（2026-11-02，窄屏布局 / 详情面板接线，主壳就是 `App.tsx`），本线这批提交一行没动它。**这条归因的尺本线换过一次**：原先写的是"逐枚循环 `git show --name-only` 比对，处理 23 枚 / 碰过 0 枚"（2026-11-05 23:0x 那趟，加了计数守卫才敢这么说），而那条循环在同一晚**连犯两次自造假绿**——zsh 不对 `$VAR` 做词分割，git 报完错我那句"无输出＝通过"照样打印；改成 `while read` 后临时路径多写一个 `}`，文件从没存在过、循环零次迭代，echo 仍写着"逐枚真跑过"。失败形状与三道守卫登记成环境陷阱 **#657**。现在这句改挂在一条不依赖临时文件、也不依赖 shell 词分割的尺上：未推送整批（含别线）里碰过那枚文件的枚数为 0，现量 `git log --format=%H origin/main..HEAD -- apps/web/src/App.tsx | wc -l`（同戳 `origin/main..HEAD` 总数 39 ⇒ 分母是全集而不是本线那 23 枚，射程比原句更宽）。归属与"是不是误抓"由详情面线判；**本线不另登记 B 号**——它已在收集框线台账里作为"别线"登记（`docs/plans/capture-ticktick-alignment-2026-11.md` §9 那行），再造一份就是第二份真相。<br>✅ **谜底揭晓是误抓**：门改成嵌套 + 引号感知的表达式剥离（`scripts/check-detail-pane-slot.mjs`，产品代码一行没动），真实树 `rc=0`、`命中 A=0 B=0 C=0 D=0`；牙靠三枚臂 + 一枚对照，全走门自己的 `--root` 在副本上跑（真裸文本红、手写 `<p>` 红、`t('a}b')` 不误抓、不注入则绿）。当时那句"由详情面线判"是对的保守——但它等的是别人来发现**那是他们自己不会去修的一把尺**；用户授权后本线直接修了。`BLOCKED.md` 里这条记在 **B269**（B266 ① 那格"仍成立的两格"到这儿只剩 `arkts` 那一半未判定） |
| 🔴 `pnpm check:arkts` | 本机 **rc=0，但它是"跳过"**：找不到 `es2abc` 时打一行 ⚠️ 警告后**正常退出**（现量：`pnpm check:arkts; echo $?` ⇒ 0；候选路径逐个 `[ -e ]` 全不存在，`/Applications/DevEco*` 无匹配）。⇒ **"这道门绿了"在本机不等于 `HeytaTokens.ets` 被编译验证过**——它是那种在本机会永远通过的判据，别把它读成通过。本线那笔只改了 `.ets` 里一个数字（56→60），语法风险小，但那是推理不是验证：那一半仍记**未判定**，要判定得在有 DevEco 的机器上跑，或用 `HEYTA_ES2ABC=<路径>` 指定编译器（这一类已登记成环境陷阱 **#656**）。 |
| `pnpm --filter @heyta/web build` | 2026-11-05 16:09 退 0。🔁 **23:43:43 在 HEAD=`c7ee7c49c` 复跑：rc=0（`✓ built in 3.95s`）** —— 那一栏原本停在 16:09 那戳，而它之后这棵树动了二十多笔，不重取就成了过期读数。附带一条：构建没写脏任何被跟踪文件（`git status --short apps/web` 里除了别线那枚 `M App.tsx` 没有新增项，`dist/` 不在版本库里） |
| `pnpm typecheck`（整仓） | 2026-11-05 17:01 退 0（阶段 1 入库之后重跑） |
| web 单测（本线三枚 spec） | 2026-11-05 20:08 在 HEAD=`907bd60e3`（**含收集框那笔把判断挪回共享层的 `e33523e7e`**）重跑 123/123；同日 16:11 那一戳也是 123/123。`packages/design-system` 546、`packages/ui` 894、landing `mockup-task-row` 6 + `mockup-quadrant-shape` 15、web `quadrant-row-parity` + `calendar-day-view` 23 同日全过。<br>🔎 **23:44 补一条"这读数还指不指得动"**：先前那把零漂移尺的路径清单太窄（只列了 `packages/ui/src/task-list` 与 `calendar`），**覆盖不到这三枚 spec 的真实输入面**，所以不能拿它外推。按输入面重列现量：`git diff --name-only 907bd60e3 HEAD -- packages/ui` / `packages/design-system` / `packages/domain` / `apps/web/tests` 各 **0 枚**，唯一有变的是 `apps/landing` **5 枚** —— 且只来自本线自己 23:20 那一笔（`41852b75c`）。⇒ 那两枚 landing spec 由同戳 `pnpm exec vitest run`（apps/landing 整包 **24 files passed**，23:19 起跑、内容与入库那一份相同）覆盖；其余三枚的输入没动 ⇒ **20:08 那 123/123 仍然算数**，只是现在这条是按对的输入面证的<br>🔁 **2026-11-06 09:4x–10:2x 这批改动之后重跑**：`packages/domain`、`packages/app-host`、`apps/mobile` 三包 vitest 各退 0（app-host `repeat-actions.spec.ts` **25/25**，含「完成后顺延」四臂；把分支钉死成"永远固定排期"只红那一臂，`expected 2026-09-21 to be 2026-10-05`）；`apps/web` 全量见下面那行"主链"；整仓 `pnpm typecheck` 退 0。 |
| landing 腿（D2 展厅那一手入库前后） | 2026-11-05 23:2x。入库**前**：HEAD 那枚 `mockup-shell-shape.spec.tsx` 用旧锚 `pairsOf('const TOOL_VIEW_TABS')`（1 处）而 HEAD 的 `view-tabs.ts` 只有 `SIDEBAR_TOOL_TABS`（旧名 0 处）⇒ `arrayBlock` 必 `throw`，**这一格在 HEAD 上是红的**，从本线 D2 那笔（`8cbedf563`，11-04 22:12）一直开到本笔入库。入库**后**（`41852b75c`）：旧锚 0 / 新锚 1、`git status --short apps/landing` 空；`pnpm exec vitest run`（apps/landing 整包）**24 files passed**、`pnpm --filter @heyta/landing typecheck` rc=0、`check:design` / `design-token-refs` / `tokens` / `font-size-discipline` 各 rc=0（逐个抓，未串尾巴）。`check:row-single-source` 仍 rc=1，红话仍是 `.ht-capture` 那枚（29>28，族清单逐字同 B263 那一戳），本笔没碰 `app.css`。
⚠️ 另一维的分母也现量了：展厅 rail 这一改动**没有被 e2e 腿消费**，所以不必为了判回归去跑那条会起浏览器的腿——
按类名 `grep -rl 'mk-rail__tools' e2e/ | wc -l` ⇒ 0、按常量名 `grep -rl 'SHELL_SIDEBAR_TOOLS' e2e/ | wc -l` ⇒ 0、
按可见文本与词条 key `grep -rlE 'web\.trash\.nav|回收站' e2e/landing/ | wc -l` ⇒ 0（`e2e/landing/` 里 8 处 `trash`
全是帮助文档的**文章名**，不是 rail 断言）。整仓 `pnpm typecheck` 在同戳 rc=0 |
| 浏览器腿 | 2026-11-05 20:09 同一棵 HEAD 重跑 **11/11**（跑前先补了一次 `@heyta/ui` 产物）。🔴 **这句的机理本线写反过一次，现更正**：第一版写的是"陈旧 `dist` 会造一次**假红**"——不对。现量：`apps/web/vite.config.ts:17` 自己写着"Vite 解析到它的真实路径 `packages/ui/dist/`"，而 e2e 的 webServer 就是 `pnpm --filter @heyta/web exec vite`（`e2e/playwright.config.ts:147`）⇒ **浏览器腿吃的是 `dist`**，所以陈旧 `dist` 的后果是**默默测到旧的共享代码**（假绿 / 测错产物），不是红。`.d.ts` 那一类陈旧会让 **typecheck/构建**红（§六 第 220 行记的就是那一侧），两件事别再混成一句。⚠️ 本线这趟**只写了 `e2e/test-results/`**（现量：那批图 mtime 落在本趟窗口内），`apps/*/evidence` 里别线已入库的图一枚没碰 —— 当时工作树里那批 `M`/`D` 的 capture 证据图 mtime 是 17:06，是收集框线自己跑主链那一趟留下的；**20:59 他们把 `D` 那批自己收走了**（`a3590d851`：`sheet8` 回收，7 枚文件），`M` 那批仍在他们工作树里（现量：`git status --short apps/web/evidence/capture-due-capsule-20261104` 只剩 `M`）。本线一行没碰，这句只留作归因证据，不是本线的债。<br>🔎 **23:45 把这腿的"读数还指得动"按它真实的输入面证了一遍**（先前那条零漂移尺的路径清单覆盖不到这里）：`git diff --name-only 907bd60e3 HEAD --` 对 `apps/web/src`、`e2e/tests`（整目录）、`e2e/tests/helpers.ts`、`e2e/playwright.config.ts`、`packages/ui/src`（被跟踪 118 枚）各读 **0 枚** ⇒ 这腿 20:09 那 11/11 仍算数，不需要为它重跑一次会起浏览器的腿。<br>⚠️ 写这条时我先犯过一次**恒读 0 的尺**：我把 `packages/ui/dist` 也放进了那条 `git diff`，但那目录**根本不被版本库跟踪**（现量 `git ls-files packages/ui/dist | wc -l` ⇒ 0）——对不被跟踪的路径做 diff 永远得 0，那是假证不是证据。产物那一维要用 mtime 判：`stat -f '%Sm %N' packages/ui/dist/index.js` ⇒ **11-05 20:08**，就在 20:09 那趟之前建的，而 `packages/ui/src` 自那以后没动过 ⇒ 腿吃的是当时那份产物，两维合起来才闭合 |
| iOS 设备腿 | 2026-11-05 17:0x 又一趟 **9/9、退 0**，读数头上打的是 `git HEAD = 1062146c6`（阶段 1 入库之后那棵）。⚠️ 装置自己那行"这一读数属于哪一棵树"同时写着**装着的产物 mtime = 11-04 22:26** —— 它没重打包。这一格为什么仍然算数：本笔提交进 bundle 的运行时值就是那四枚 token，而它们 11-04 就在那棵工作树里（B261 现量过同一批 hunk），今天入库的只是提交动作与注释；要"从当前产物现建"那一档，得强制重打包再跑一趟。两张图已换上并**逐张与上一趟对比**：`row-menu.png` 同形（菜单五项 + 两行），`after-pin.png` 的差别是滚动位置与攒下的行（角标 22→24），不是产品变了。⚠️ 新的一趟里被钉住那条落在 **y=-29**（装置按 #655 的纪律"按下→回读→滚一段再来"，于是它跑到了容器上沿之外），所以那一格的判据是**相对 y 读数**，图只是旁证 —— 别拿这张图当"第一行看得见"的证据。<br>🔎 **23:3x 复量这两枚图的像素有没有被后来的提交换走**（这类读数不会自己报错）：`git log --format='%h' 907bd60e3..HEAD -- apps/mobile/evidence/dida-pin-order-20261105` ⇒ **空**，`git diff --name-only HEAD -- apps/mobile/evidence/dida-pin-order-20261105 apps/web/evidence/dida-alignment-typography-20261105` ⇒ **空** ⇒ 工作树里那四枚 PNG（本线两枚设备图 + 两枚 1440 帧）与 HEAD 的 blob 逐字节相同；唯一碰过 `dida-alignment-typography-20261105` 的是本线自己那笔 `2b2152318`（23:01，就是把它们落库的那一笔）。<br>✅ **2026-11-06 10:2x 把那一档"从当前产物现建"补上了**（用户授权本线拍板执行）：按在册路线 `simctl uninstall` → `xcodebuild Release -derivedDataPath /tmp/heyta-ios-release-dida` → `simctl install`，构建退 0、归属章已写、新鲜度按 `reinstall-all.sh` 那把尺量过（`main.jsbundle` mtime **晚于**最新源码 mtime，两个数与算法记在 B272 ①）；装置重跑 **9/9、`PIN_ORDER_RC=0`**，读数头上 `git HEAD = 812a2a119`、产物 mtime 10:19:58。两张新图落在 `apps/mobile/evidence/dida-pin-order-20261106/` 并**逐张人眼看过**（`row-menu.png`：菜单五项齐全、置顶前甲在乙下面；`after-pin.png`：甲翻到最前、"2 项待办, 0 项已完成"）。⚠️ 这一趟的代价记在 **B272**：`uninstall` 把装置依赖的**已 onboarding 热状态**一起清掉，连红两趟红在载体不在产品，而配方本来就在 `scripts/verify-mobile-ai.sh:1225–1260` —— 动手前没 grep 它。 |
| 主链 web 全量单测（那 16 枚红的归属） | 🔴 **2026-11-06 闭合，且 B257 ② 那句"16 枚全是 `sheetExiting` 那一手"数错了一半**：修 `closeSecondarySurface()` 的退场收尾（`17e8063e0`）闭合 **11 枚**（`settings-sheet-ia` 3 / `search-overlay-ia` 3 / `language-switcher` 2 / `app-mount` 1 / `shell-more-and-settings` 1 / `search-panel` 1）；剩 **5 枚**在 `apps/web/tests/ai-settings.spec.tsx`，成因是 `2a4bc0e20`（2026-11-04 13:09，settings 线 skill 审计）把能力勾选框的 `aria-label` 从裸枚举值换成本地化标签，而**三份**按旧文案取元素的消费者没跟着改 —— 第三份在 `e2e/tests/helpers.ts`，它的症状是 Playwright 超时而不是断言失败（⚠️ 那一格是**代码读数**：本线没跑整棵 `e2e/`）。两处修复、两枚新臂与牙（把裸值塞回去只红那一臂）记在 **B271**。现状读数：**224 files / 2737 passed / 13 skipped / 0 failed**。为什么没有门抓到：`check:locator-labels` 的射程只有 `scripts/qa/*.py` 那九份，JS 侧"选择器钉界面文案"零判据 —— 这一格留给仓级口径拍，本线没顺手造一把大尺 |
| ✅ `pnpm check:traps-index-coverage` | 2026-11-06 10:3x 新增，**已进 `pnpm check` 链**（`check:gate-wiring` 认它，`docs/agents/commands.md` 已登记）。第一次跑量出正文 644 枚编号里 **33 枚**在索引里没有入口（`#463–#466、#470、#495、#497–#504、#537–#541、#544–#548、#552–#557、#561–#563`，横跨 2026-10-18 – 10-26 四条并行线）；六行登记按条目原文补完后读数 `正文 645 枚 / 索引 88 行，全部可达`。判据是**可达性不是条数**（AGENTS §5 明文不许在索引里写条数）。`--self-test` 三臂当场验过牙：真实=退 0、删一行号段登记=退 1（红集合 `#1–#19`）、区间收窄到不含自己那枚=退 1。造这把尺的过程自己踩的那枚坑入正文 **#659**（按内容里的词筛表格行 ⇒ 33 枚虚报成 214 枚）。全程见 **B273** |
| 桌面壳 | 同日 `--window` 一趟：`rows=1 / colorBuckets=66`，图入库并看过 |
| 输入零漂移复量（23:3x 那一趟） | 上面那双腿的读数指的是 `907bd60e3` 那棵，现在 HEAD 已经不是它 ⇒ 本行专门回答"那批读数还指不指同一件东西"。尺：`git diff --name-only 907bd60e3 HEAD -- apps/web/src/features/tasks packages/domain/src/task-order.ts apps/web/src/features/shell packages/design-system packages/ui/src/task-list packages/ui/src/calendar e2e/tests/dida-alignment-detail-sidebar.spec.ts apps/web/src/features/capture` ⇒ **0 枚**；同一把尺去掉 pathspec 读 **30 枚**（分布在 `apps/mobile` 14、`apps/landing` 5、docs 6、`apps/web` 3…）⇒ **不是 pathspec 坏了，是那 30 枚没有一枚落在验收输入里** ⇒ 九条验收的读数仍指同一棵树，不必重跑。现量另取一发模拟器状态：`xcrun simctl list devices \| grep Booted` ⇒ 这一戳**有一枚 booted**（`iPhone Duo heyta`，早先那趟是没有 booted 才不跑的），但它装着的 `Heyta.app` mtime 仍是 **11-04 22:26**（与 17:0x 那趟装置自己打的"产物没重打包"同一条），所以那一格**未判定的成因是"没重打包"，不是"没有模拟器"** —— 补跑同一条装置只会把两张已入库证据图重写一遍、判据不变。要真收那一格得走隔离检出的重装路线（见 `docs/agents/multi-end-build.md`），那是比本行更大的一步，没在这里顺手做<br>✅ **2026-11-06 10:2x：那一格"未判定的成因是没重打包"已经判掉** —— 现建产物、现跑装置，读数与代价都记在上面那行"iOS 设备腿"与 `BLOCKED.md` B272。 |
| 未跑 | 整棵 `e2e/`、四端重装、Android 设备腿（22:5x 那一戳收集框线正在跑 Android 那一枚；这一格是否仍归他们要现量 `git log --oneline -5 -- apps/mobile` 与 `xcrun simctl list devices \| grep Booted` 之外的 adb 侧，别拿本行当现状）<br>⚠️ 2026-11-06 10:3x 更新：整棵 `e2e/` **仍未跑**（明令禁跑；本线只改了 `e2e/tests/helpers.ts` 里那一枚选择器，那一格按代码读数登记）；iOS 设备腿已从"没重打包"那一档里拿出来；四端重装与 Android 设备腿仍不在本线这趟。 |

---

## 八、相关文件

- 实现状态与判据：[dida-alignment-typography-and-features.md](dida-alignment-typography-and-features.md)
- 对标分母（先读 §9 勘误）：[dida365-feature-benchmark.md](../research/dida365-feature-benchmark.md)
- 收集框那条平行线（同一份滴答对齐，不同范围）：[capture-ticktick-alignment-2026-11.md](capture-ticktick-alignment-2026-11.md)
- 详情面/行操作的历史口径：[task-detail-ticktick-parity.md](task-detail-ticktick-parity.md)
- 取证账本（B 号只增）：[../../BLOCKED.md](../../BLOCKED.md)
- 浏览器验收规矩：[../agents/ui-acceptance.md](../agents/ui-acceptance.md)
- 环境陷阱索引：[../agents/environment-traps-index.md](../agents/environment-traps-index.md)
