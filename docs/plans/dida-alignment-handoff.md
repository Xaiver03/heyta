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
| D2 回收站搬侧栏 | `view-tabs.ts`（常量更名 `SIDEBAR_TOOL_TABS`）、`App.tsx`、`sidebar.css`、`RailNavigation.tsx`（rail 工具段整段删） |
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

### 4.4 跨树一致性（一格，等别人落库）

本线那次常量更名（`TOOL_VIEW_TABS` → `SIDEBAR_TOOL_TABS`）让
`apps/landing/tests/mockup-shell-shape.spec.tsx` 那枚**按源码文本对账**的判据在 HEAD 上锚点失效；
修法在 landing 线未提交的那手里。归属与闭合条件写在 `BLOCKED.md` 的 B258（号只增，现量
`grep -oE '^🔴 \*\*B[0-9]+' BLOCKED.md | tail -3` 取末号）。**别线在飞的件不代改**，
但它落库之前，`pnpm typecheck` 全绿不代表那枚 spec 能跑。

🔴 **2026-11-05 20:37 把这格从"声称"改成现量**（此前它只是继承 B258 的说法）：

- HEAD 版那枚 spec 第 **160** 行仍是 `const tools = pairsOf('const TOOL_VIEW_TABS')`；
- HEAD 版 `apps/web/src/features/shell/view-tabs.ts` 只有第 **272** 行的
  `export const SIDEBAR_TOOL_TABS`（`TOOL_VIEW_TABS` 这个名在 HEAD 上不存在）；
- 失败形状查过了，是**红不是假绿**：`pairsOf`（HEAD 版第 135 行）走 `arrayBlock`，
  而 `arrayBlock` 第 **103** 行 `if (start < 0) throw new Error('源码里找不到 … —— 判据锚点已失效')`。
- 他们工作树那一版**已经把锚换成新名**（`SIDEBAR_TOOL_TABS`，第 190/430 行），实测
  `pnpm exec vitest run tests/mockup-shell-shape.spec.tsx` ⇒ **22/22 过**——⚠️ 但那枚文件是 `M`
  （未提交），所以**这 22/22 不能拿来判 HEAD**；判 HEAD 只能读 HEAD 的两个 blob。
  ⇒ 这一格仍未闭合，但差的就是他们一笔提交；本线依旧不代改。

---

## 五、下一步（按顺序，每步都带动手前的前置）

1. **先跑 §三 那组现量**，确认树没被别人改动过、九条仍然成立。
2. ✅ **把阶段 1 那两枚排印改动入库**（2026-11-05 16:5x 做完，下一位从第 3 步接）。
   前置：`git diff -- packages/design-system/src/task-row-shape.ts` 逐行确认是本线的手，
   生成件（`generated/*`、`typography.*`）里哪些属于别线未提交的工作 —— 分不清就只提交源文件。
   ⚠️ 实际做法比这条前置多走了一步：`packages/design-system/**` 整片**都是**本线的手（逐 hunk 核过），
   真正同片地的是 `apps/landing/src/mockup/mockup.css` —— 那里 5 枚 hunk 有 4 枚是阶段 1 的镜像
   （被两枚按源码文本对账的 landing spec 钉住，不提会让 HEAD 红），第 5 枚 `.mk-sidebar__tools`
   与 landing 在飞的 `AppWindow.tsx` + `mockup-shell-shape.spec.tsx` 成套 ⇒ 用
   `git apply --cached` 只取四处，暂存与提交压进同一条命令。
3. **打「完成后顺延」**（`nextAfterCompletion` 接进生产路径）。
   前置：先读 [ADR](../adr/) 里重复语义那一格与 `packages/domain/src/recurrence.ts` 的注释；
   这一格是"数据 + 调用点"，不依赖选型，成本最低、用户可感知。
4. **C1 富文本**：先做选型 + 许可证两道门的调研，**不要先写界面**。
   前置：AGENTS §3.1（2021 年后仍在维护）、§3.2（许可证白名单），过了才谈落点。
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
| 相信 AX 框就是能点的区域 | RN 列表被下沿裁切的行，AX 读数完整、短按同一点毫无反应。见 #655：按下 → 回读 → 滚一段再来 |
| 拿"先建的在上面"当移动端顺序前置 | 移动端默认档是 `addedAt`（新的在上），web 走 `display`。判据要读**相对变化** |
| 在共享工作树里"先 staged 再隔几条命令才 commit" | 本线的 C2 三枚 hunk 就这样被别线一笔裸 `git commit` 顺走，内容没丢但归属记错。暂存与提交压进同一条命令，纯本线文件用 pathspec 形式 `git commit -m … -- <路径>`（另一侧的记录见 `BLOCKED.md` B257） |
| 把"分不清就只提交源文件"当安全默认 | 那正好会留下 **HEAD 断链**：`mockup-quadrant-shape.spec.tsx` 与 `mockup-task-row.spec.tsx` 是拿 token 名去 `mockup.css` 里找 `var()` 的，只提 token 不提四处镜像 ⇒ 干净检出上那两枚 spec 必红（与 `SIDEBAR_TOOL_TABS` 那次 B258 同一类）。这次先在**干净检出**上量了三臂再决定：HEAD 10/10 绿 / 入库前 10/10 红 / 混树（新 token + 旧镜像）恰好红在 4 枚配对臂。⚠️ "必红"这句的出处是那两枚 spec **自己的谓词**，不是本线复算的那把尺：`expectVar` 是 `expect(value).toBe('var(--ht-…)')` 逐字符比 var 名，`ruleBody` 找不到规则就 `throw`（现量位置 `apps/landing/tests/mockup-quadrant-shape.spec.tsx:193` 与 `mockup-task-row.spec.tsx:82`）。办法写在计划「阶段 1」那一节 |
| 看到红在别人的文件里就说是"别人写到一半" | 本线读到过两次：一次真是半写，一次是 `packages/ui/dist` 的陈旧 `.d.ts` —— 后者一条 `pnpm --filter @heyta/ui build` 就回绿，不需要等谁 |
| 改一个被**按源码文本对账**的常量名，只看 typecheck | typecheck/build 全绿仍会留断链（§4.4）。改名要 `grep` 文本锚点的消费者 |
| 跑整棵 `e2e/` 或 `pnpm test -- <文件>` | 会重写别线未入库的取证图；单文件过滤要用 `pnpm exec playwright test <文件>`，别拿 `--` 当过滤器 |

---

## 七、验证状态（哪些读数在哪棵树上）

| 门 / 腿 | 最后一次现量 |
|---|---|
| `pnpm check:design` / `check:design-token-refs` / `check:menu-keyboard` / `check:ui-language` / `check:docs` / `check:evidence-hygiene` | 2026-11-05 16:5x 全部退 0（阶段 1 入库前后各一趟） |
| 🔴 `pnpm check:row-single-source` | 2026-11-05 16:53 **退 1**：`ht-*` 前缀族 29 > 基线 28。与本线无关 —— HEAD 与工作树的族清单**逐行相同**（两边都 29），28→29 那一跳在 `3d0d593f4`（收集框 S1–S5），多出来那一族是 `.ht-capture`。归因与两条出路写在 `BLOCKED.md` B263；本文 §4.4 那格说的 `.ht-spin` 已被 `7d3521391` 收掉，是旧的一戳 |
| `pnpm check:tokens` / `check:md-tables` / `check:doc-citations` / `check:windows-xaml` / `check:native-bare` | 2026-11-05 16:5x 退 0（阶段 1 那六份生成件由 `generate:check` 逐字节对账，不是手写） |
| 🔴 `pnpm check:arkts` | 本机 **rc=0，但它是"跳过"**：找不到 `es2abc` 时打一行 ⚠️ 警告后**正常退出**（现量：`pnpm check:arkts; echo $?` ⇒ 0；候选路径逐个 `[ -e ]` 全不存在，`/Applications/DevEco*` 无匹配）。⇒ **"这道门绿了"在本机不等于 `HeytaTokens.ets` 被编译验证过**——它是那种在本机会永远通过的判据，别把它读成通过。本线那笔只改了 `.ets` 里一个数字（56→60），语法风险小，但那是推理不是验证：那一半仍记**未判定**，要判定得在有 DevEco 的机器上跑，或用 `HEYTA_ES2ABC=<路径>` 指定编译器（这一类已登记成环境陷阱 **#656**）。 |
| `pnpm --filter @heyta/web build` | 2026-11-05 16:09 退 0 |
| `pnpm typecheck`（整仓） | 2026-11-05 17:01 退 0（阶段 1 入库之后重跑） |
| web 单测（本线三枚 spec） | 2026-11-05 20:08 在 HEAD=`907bd60e3`（**含收集框那笔把判断挪回共享层的 `e33523e7e`**）重跑 123/123；同日 16:11 那一戳也是 123/123。`packages/design-system` 546、`packages/ui` 894、landing `mockup-task-row` 6 + `mockup-quadrant-shape` 15、web `quadrant-row-parity` + `calendar-day-view` 23 同日全过 |
| 浏览器腿 | 2026-11-05 20:09 同一棵 HEAD 重跑 **11/11**（跑前先补了一次 `@heyta/ui` 产物）。🔴 **这句的机理本线写反过一次，现更正**：第一版写的是"陈旧 `dist` 会造一次**假红**"——不对。现量：`apps/web/vite.config.ts:17` 自己写着"Vite 解析到它的真实路径 `packages/ui/dist/`"，而 e2e 的 webServer 就是 `pnpm --filter @heyta/web exec vite`（`e2e/playwright.config.ts:147`）⇒ **浏览器腿吃的是 `dist`**，所以陈旧 `dist` 的后果是**默默测到旧的共享代码**（假绿 / 测错产物），不是红。`.d.ts` 那一类陈旧会让 **typecheck/构建**红（§六 第 220 行记的就是那一侧），两件事别再混成一句。⚠️ 本线这趟**只写了 `e2e/test-results/`**（现量：那批图 mtime 落在本趟窗口内），`apps/*/evidence` 里别线已入库的图一枚没碰 —— 当时工作树里那批 `M`/`D` 的 capture 证据图 mtime 是 17:06，是收集框线自己跑主链那一趟留下的；**20:59 他们把 `D` 那批自己收走了**（`a3590d851`：`sheet8` 回收，7 枚文件），`M` 那批仍在他们工作树里（现量：`git status --short apps/web/evidence/capture-due-capsule-20261104` 只剩 `M`）。本线一行没碰，这句只留作归因证据，不是本线的债 |
| iOS 设备腿 | 2026-11-05 17:0x 又一趟 **9/9、退 0**，读数头上打的是 `git HEAD = 1062146c6`（阶段 1 入库之后那棵）。⚠️ 装置自己那行"这一读数属于哪一棵树"同时写着**装着的产物 mtime = 11-04 22:26** —— 它没重打包。这一格为什么仍然算数：本笔提交进 bundle 的运行时值就是那四枚 token，而它们 11-04 就在那棵工作树里（B261 现量过同一批 hunk），今天入库的只是提交动作与注释；要"从当前产物现建"那一档，得强制重打包再跑一趟。两张图已换上并**逐张与上一趟对比**：`row-menu.png` 同形（菜单五项 + 两行），`after-pin.png` 的差别是滚动位置与攒下的行（角标 22→24），不是产品变了。⚠️ 新的一趟里被钉住那条落在 **y=-29**（装置按 #655 的纪律"按下→回读→滚一段再来"，于是它跑到了容器上沿之外），所以那一格的判据是**相对 y 读数**，图只是旁证 —— 别拿这张图当"第一行看得见"的证据。 |
| 桌面壳 | 同日 `--window` 一趟：`rows=1 / colorBuckets=66`，图入库并看过 |
| 未跑 | 整棵 `e2e/`、四端重装、Android 设备腿（收集框线此刻正在跑那一枚） |

---

## 八、相关文件

- 实现状态与判据：[dida-alignment-typography-and-features.md](dida-alignment-typography-and-features.md)
- 对标分母（先读 §9 勘误）：[dida365-feature-benchmark.md](../research/dida365-feature-benchmark.md)
- 收集框那条平行线（同一份滴答对齐，不同范围）：[capture-ticktick-alignment-2026-11.md](capture-ticktick-alignment-2026-11.md)
- 详情面/行操作的历史口径：[task-detail-ticktick-parity.md](task-detail-ticktick-parity.md)
- 取证账本（B 号只增）：[../../BLOCKED.md](../../BLOCKED.md)
- 浏览器验收规矩：[../agents/ui-acceptance.md](../agents/ui-acceptance.md)
- 环境陷阱索引：[../agents/environment-traps-index.md](../agents/environment-traps-index.md)
