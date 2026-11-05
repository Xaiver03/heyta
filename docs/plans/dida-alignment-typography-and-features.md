# 滴答清单对齐：排印 + 功能 + 侧栏

> **目标**：让 heyta 的 Web 端在日常使用中达到滴答清单的观感与功能完整度。
> **参照物**：滴答清单 macOS 客户端（2026-11 截图取证）。
> **约束**：不改 schema、不引入新第三方依赖（富文本编辑器除外，需单独过门禁）。

---

## A. 排印与密度

**问题**：上一轮对齐的是字号刻度（补 13px 档），但行高、行间距、padding 没动。暗色主题下 56px 行高 + 1.5 行高 + 8px padding 让界面"喘不过气"。

### A1. 任务行行高

| 参数 | 现在 | 目标 | 落点 |
|---|---|---|---|
| `--ht-size-row-min-height` | 56px | 60px | `tokens.css` |
| `row-title` leading | `line-height.normal` (1.5) | `line-height.relaxed` (1.75) 或中间值 1.625 | `typography.ts` |

**理由**：1.5 × 16px = 24px，中文换行时行距 < 字高，汉字会粘。1.75 × 16px = 28px，接近滴答的观感。

### A2. 行内间距

| 参数 | 现在 | 目标 | 落点 |
|---|---|---|---|
| `TASK_ROW_SHAPE.bodyPaddingBlock` | `space.2` (8px) | `space.3` (12px) | `task-row-shape.ts` |
| `TASK_ROW_SHAPE.listGap` | `space.1` (4px) | `space.2` (8px) | `task-row-shape.ts` |

**理由**：文字不再贴行边，行与行之间不再糊。

### A3. 侧栏密度

| 参数 | 现在 | 目标 | 落点 |
|---|---|---|---|
| `.ht-nav__item` padding | `0 var(--ht-space-3)` (0 12px) | `0 var(--ht-space-4)` (0 16px) | `sidebar.css` |
| `.ht-sidebar` gap | `var(--ht-space-2)` (8px) | `var(--ht-space-3)` (12px) | `sidebar.css` |

### A4. 验证

- [x] `pnpm check:design` 全绿（token 引用合法）—— 2026-11-05 复量退 0
- [x] `pnpm check:design-token-refs` 全绿 —— 同日退 0（臂：拼错的 token 会红）
- [x] Web 构建通过 —— 同日 `pnpm --filter @heyta/web build` 退 0
- [ ] 截图对比：任务行、侧栏、详情面板 —— **只签了一半**：任务行 + 侧栏 + 设备面两张本趟看过，
      **详情面板那张（腿 ② 的 `dida-detail-toolbar.png`）本趟没重看**；"和滴答并排比观感"那一半
      始终没做，别把这三格读成"密度已对齐"。判据与范围写在「执行状态」阶段 1 那一节 A4 那条。

---

## B. 右键菜单扩充

**现状**：heyta 的右键菜单只有 2 项（打开详情 / 删除），设计决策是"重操作去详情面"。滴答的右键菜单有 15+ 项。

**策略**：在"加速器"定位不变的前提下，加入 4-5 个高频操作，减少"必须进详情面才能改"的摩擦。

### B1. 优先级（旗帜）

- **schema**：已有 `priority: 0|1|2|3`
- **UI**：详情面有 `priority-display.ts`，但右键菜单没入口
- **改动**：右键菜单加"优先级"子菜单，四档（无/高/中/低），用旗帜图标
- **落点**：`TaskRowMenu.tsx` + `task-row-menu.css`

### B2. 子任务

- **schema**：已有父子关系（`buildTaskTree`）
- **UI**：详情面有 `SubtaskPicker`，但右键菜单没入口
- **改动**：右键菜单加"添加子任务"，点击后在行内展开子任务输入框
- **落点**：`TaskRowMenu.tsx` + `SubtaskPicker.tsx`

### B3. 标签

- **schema**：已有 `tagIds`
- **UI**：详情面有 `TaskOrganizer` 的标签部分
- **改动**：右键菜单加"标签"子菜单 —— 已有标签那半**已落**（勾选是覆盖式整组提交，
  已勾的那条带 `aria-pressed`，勾上再点就是把它从组里去掉）
- ✅ **"新建"那一半也已落**：子菜单末尾一行「新建标签」，点开就地长出一行草稿（不弹第二层，
  这一格本身已经在 `document.body` 的浮层里）。提交之后是**两步一次做完**——建出来 + 勾上，
  因为用户要的是"这条任务带上它"，不是"世界上多一条标签"。
  · 重名不当错误：归一口径与侧栏创建对话框同一条（`trim` + `toLocaleLowerCase`），
    命中已有标签就返回那条的 id 并勾上，不弹"已存在"；
  · 空名两处都挡（按钮 `disabled` + `submit` 里再挡一次，因为 Enter 绕得过 `disabled`）；
  · ⚠️ **草稿展开时把整把键盘让给它**（共享层为"菜单里再开一层"准备的那一格 `nestedOpen`），
    否则打字会被当成类型查找、方向键会把焦点从输入框里抢走。代价写在这：草稿里的 Esc
    不关菜单（共享层把 Esc 也让出去了），要退出就点外面。**没有**为此在宿主里另写一份按键判断。
  · 🔴 界面**不发明名字长度上限** —— 共享创建路径没有这个上限，所以输入框上也没有 `maxLength`。
- **落点**：`TaskRowMenu.tsx`

### B4. 移动到（清单）

- **schema**：已有 `projectId`
- **UI**：详情面有 `TaskOrganizer` 的清单部分
- **改动**：右键菜单加"移动到"子菜单，显示已有清单
- **落点**：`TaskRowMenu.tsx`

### B5. 置顶

- **schema**：❌ 不需要新字段 —— `Task.pinnedAt` 与 `TaskActions.setPinned` 早就在
  （ADR-0083 §3.2），缺的只是 Web 上那一枚菜单项。逐条去向写在下面的「执行状态」
- **改动**：右键菜单加"置顶"切换项
- **落点**：`TaskRowMenu.tsx` + `features/tasks/store.ts`（转发动作）。
  ⚠️ 原文这里写"排序仍在 app-host"，**只对了一半**：app-host 那份 `byPinnedFirst` 是
  **出口顺序**（移动端读它），而 Web 的行序走的是领域的 `sortTasks` ——
  那一档当时不看 `pinnedAt`，所以补在 `packages/domain/src/task-order.ts`（唯一那份）。
  细节与判据在「执行状态」的 B5 那一条

### B6. 验证

- [x] 右键菜单在任务行上正常弹出 —— 浏览器腿 ⑥（鼠标右键：优先级 / 标签 / 子任务 / 置顶四项点得动）
- [x] 每项操作后任务状态正确更新 —— `task-row-menu.spec.tsx`「B1-B4 菜单项把意图发出去（不是只画出来）」那一组 + 腿 ⑥ 的"行上读得出来"
- [x] 键盘导航（上下箭头 + Enter）可用 —— 腿 ④ 全程键盘 + 同文件「🔴 键盘 Enter 能展开子菜单」+ `pnpm check:menu-keyboard`
- [x] 触屏长按弹出菜单（如已实现）—— iOS 真模拟器设备腿（`scripts/verify-mobile-pin-order`）长按开菜单那一格；⚠️ **Android 那一端没量**（构建与模拟器在 linux-dev，远端装置还没接）

---

## C. 详情面板增强

**现状**：heyta 的详情面板有基本信息、备注（Markdown 文本框）、时间（日历 + 快捷按钮）。滴答的详情面板有富文本编辑器、底部工具条、评论。

### C1. 富文本编辑器（大功能，需单独排期）

- **选型**：TipTap / Lexical / 其他（需过许可证门禁）
- **功能**：标题、粗体、斜体、下划线、删除线、高亮、列表、复选框、链接、对齐
- **落点**：`NoteEditorCard.tsx` 或新建组件
- **依赖**：编辑器库选型 + 许可证审查 + 样式对齐

### C2. 底部工具条

- **滴答有**：收集箱（移动清单）、A（文本格式）、评论、更多
- **改动**：详情面板底部加一行工具条
- **落点**：`TaskDetailCard.tsx`

### C3. 评论（大功能，需单独排期）

- **schema**：需要新增评论实体
- **同步**：需要 op-log 支持
- **UI**：评论区 + 输入框
- **依赖**：schema 变更 + 同步协议 + UI 实现

### C4. 日期显示优化

- **现状**：有日期但样式与滴答不同
- **改动**：逾期日期用红色显示，带日历图标
- **落点**：`DueBadge.tsx` / `TaskDetailCard.tsx`

### C5. 验证

- [ ] 富文本编辑器基本功能可用（C1 完成后）—— **C1 没做**：选型 + 许可证两道门（AGENTS §3.1/§3.2）还没过，按 §五.4 的顺序先调研再动界面
- [x] 底部工具条按钮响应正确（C2 完成后）—— `task-detail-card.spec.tsx`「底部工具条（滴答对齐 C2）：按钮说的事必须真做得到」+ 浏览器腿 ②
- [ ] 评论可添加/显示/删除（C3 完成后）—— 评论由**协作线以 W4 落地**（详情面协作区），不是这份计划做的，本线**没有为它量过任何判据**，所以这一格不由本线勾
- [x] 逾期日期红色显示（C4 完成后）—— 浏览器腿 ①（计算色 = `--ht-color-danger` 且带图标）与 ⑤（暗色同一格还在原位）

---

## D. 侧栏优化

**现状**：heyta 侧栏有今天、最近 7 天、已完成、四象限、清单、标签。滴答侧栏有今天、最近 7 天、收集箱、清单、过滤器、标签、已完成、垃圾桶。

### D1. 过滤器（新产品功能，需单独排期）

- **功能**：按清单、时间、优先级、标签等过滤任务
- **UI**：过滤器面板 + 过滤条件选择
- **落点**：新建 `FilterPanel.tsx` + 侧栏入口
- **依赖**：产品边界定义 + UI 实现

### D2. 垃圾桶位置

- **改动**：回收站从 rail 底段搬进**侧栏底部**那一组（与「已完成」同一族导航行的形状）；
  rail 侧的工具 `role="tablist"` 容器一并删掉 —— 同一目的地不留两个控件
- **代价**（拍板时读过的）：侧栏只在**任务视图**渲染，所以习惯 / 便签 / 番茄 等视图里
  回收站没有导航行；剩下两条路是先回任务视图点这一行，或在搜索的「快速跳转」里打「回收站」。
  窄档还多一层抽屉。逐条去向与判据见下面的「执行状态」
- **落点**：`view-tabs.ts`（常量改名 `SIDEBAR_TOOL_TABS`）+ `App.tsx`（渲染在 `.ht-sidebar__body` 末尾）
  + `sidebar.css`（贴底）+ `inbox.css` / `narrow.css`（rail 那一段的贴底规则回到铃铛）

### D3. 侧栏分组说明

- **滴答有**：清单分组下有说明文字"用清单来分类收集、组织和管理你的任务和笔记"
- **改动**：侧栏分组头下加说明文字（**列表为空时不画** —— 空态那两句已经讲了同一件事；
  "可配置"没做，理由：为两句静态说明新开一个设置项，成本是一个设置项 + 一条持久化 + 一条
  跨端一致性判据，收益是少一行字）
- **落点**：`sidebar.css` + `ProjectsPanel.tsx`

### D4. 验证

- [ ] 过滤器面板可打开/关闭（D1 完成后）—— **D1 没做**：`TaskFilter` 仍是封闭联合，用户自建查询没有落点，先要产品边界（§五.5）
- [ ] 过滤条件生效（D1 完成后）—— 同上，前置没解
- [x] 垃圾桶在侧栏底部可见（D2 完成后）—— `e2e/tests/sidebar-trash-anchor.spec.ts` 两枚（宽屏那一行在侧栏最下方且 rail 上没有第二枚；窄屏抽屉里点得到且真的切视图）
- [x] 侧栏分组说明显示正确（D3 完成后）—— `projects-panel.spec.tsx`「D3 分组说明：标题下面那句"这一格装的是什么"」+ 空态那格「零清单零标签时，两块各给一句标题 + 一句说明」+ 浏览器腿 ③

---

## 实施阶段

### 阶段 1：排印密度（A）

**目标**：改 4-5 处 token/CSS，让界面"喘气"。
**预计工时**：1-2 小时
**验收**：截图对比 + `pnpm check:design` 全绿

### 阶段 2：右键菜单扩充（B）

**目标**：加 4-5 个高频操作到右键菜单。
**预计工时**：3-4 小时
**验收**：右键菜单功能正常 + 键盘导航可用

### 阶段 3：详情面板小改动（C2 + C4）

**目标**：底部工具条 + 逾期日期红色显示。
**预计工时**：2-3 小时
**验收**：工具条按钮响应 + 逾期日期样式正确

### 阶段 4：侧栏优化（D2 + D3）

**目标**：垃圾桶位置调整 + 侧栏分组说明。
**预计工时**：1-2 小时
**验收**：侧栏布局与滴答一致

### 阶段 5：大功能（C1 + C3 + D1）

**目标**：富文本编辑器 + 评论 + 过滤器。
**预计工时**：各 2-3 天，需单独排期
**依赖**：选型、许可证审查、产品边界定义

🔴 **2026-11-05 这一节的口径更新**（原文保留，别按旧清单开工）：

| 项 | 今天 | 动手前的硬前置 |
|---|---|---|
| **C3 评论** | **已由协作那条线以 W4 落地** —— 任务详情面的「协作区：评论」（`TaskDetailCard.tsx` 那一块 + `ShareCommentsSection`），实体 `COMMENT` 早在 `shared-schema` 里。⇒ 这一格**不再是待办**；仍开着的口径只有一条：非共享清单要不要也给评论区（归产品） | 先读 [ADR-0062/0067 一族](../adr/) 与协作线交接，别新起一份评论实现 |
| **C1 富文本** | 未做。连带详情面底部工具条那枚「文本格式」一直**按裁决不画**（纯文本框上画格式按钮 = 给用户一个按下去什么都不变的控件） | 先过 AGENTS §3.1（2021 年后仍在维护）+ §3.2（许可证白名单）两道门，**过了才谈落点** |
| **D1 过滤器** | 未做。`TaskFilter` 至今是**封闭联合**（`packages/domain/src/task-filter.ts` 那几行），用户自建查询没有落点 | 先定产品边界：能存哪些条件、跨不跨端、**E2EE 下服务端看不到明文 ⇒ "云端智能清单"这一类做法直接不成立** |

📌 这一轮（阶段 2–4）之后接手的人，先读
[交接](dida-alignment-handoff.md)（当前状态 + 三层分母 + 死过的手）与
[复盘](dida-alignment-reflection.md)（本轮被证据推翻的八条判断）；
对滴答的整体缺口分母在 [dida365-feature-benchmark.md](../research/dida365-feature-benchmark.md) **§9 勘误**
—— 那份矩阵正文是 2026-09-28 的只读审计，十几行已过期，**先读 §9 再读 §2**。

---

## 风险与边界

1. **富文本编辑器选型**：需过许可证门禁（禁 AGPL/GPL/LGPL 等），TipTap (MIT) 或 Lexical (MIT) 候选
2. **schema 变更**：置顶、评论等可能需要新字段，默认不 bump `CURRENT_SCHEMA_VERSION`，新字段必须可选
3. **同步协议**：评论等新实体需要 op-log 支持，不能破坏现有同步
4. **暗色主题**：所有改动必须同时适配亮色和暗色主题

---

## 参照截图

- 滴答清单 macOS 客户端（2026-11 截图）
- heyta Web 端当前状态（2026-11-04 截图）

---

## 执行状态（阶段 1-4，2026-11-04 起落）

**这一节是现量，不是承诺。** 每条写"改在哪 + 哪条判据钉住它 + 没做到的是什么"；
数字一律给取数命令，不抄读数。

### 阶段 1（排印密度）—— 2026-11-05 入库

| 项 | 状态 | 判据 / 现量 |
|---|---|---|
| A1 `--ht-size-row-min-height` 56→60 | ✅ 已入库 | `check:tokens` 现量"生成产物与 `tokens.css` 一致（8 个文件，225 个 token）"；下游按 `var()` 读，没有文本锚点 |
| A1 `row-title` leading `normal`→`relaxed` | ✅ 已入库 | `packages/design-system/tests/typography.spec.ts` 那格期望值由 24 **改签成 28**（值变更就是这一格的内容，不是为了让测试变绿）；镜像由 `apps/landing/tests/mockup-task-row.spec.tsx` 按源码文本对账 |
| A2 `bodyPaddingBlock` `space.2`→`space.3` / `listGap` `space.1`→`space.2` | ✅ 已入库 | `packages/ui/tests/task-row-density.spec.ts` 逐档读槽位（跟随 token，不钉数）；`mockup-quadrant-shape.spec.tsx:479` 钉 `.mk-quad__list` 的 `gap` == `TASK_ROW_SHAPE.listGap` |
| A3 侧栏密度（`.ht-nav__item` padding、`.ht-sidebar` gap） | ✅ 现量已经是目标值，本笔**没动** | 按**精确选择器块**取（先前那发 `grep -n "ht-nav__item" -A8` 是前缀匹配，会一并命中 `.ht-sidebar__x`，仪器太松）：`sidebar.css:3` 的 `.ht-sidebar {` 块内 `gap: var(--ht-space-3)`（第 6 行），`sidebar.css:254` 的 `.ht-nav__item {` 块内 `padding: 0 var(--ht-space-4)`（第 260 行）。复现：`awk '/^\.ht-sidebar \{/{f=1} f{print} f&&/\}/{exit}' apps/web/src/styles/app/sidebar.css` |
| A4 验证 | 三道门 + 构建 + 两枚浏览器腿都过；图看过，**但没和滴答并排比过** | 见下面最后一条 |

- 🔴 **这一格欠了一整天，欠的不是代码**：改动 11-04 就写完了，但 `packages/design-system/**`
  与别线的 token 工作同片地，落库前分不清哪几行是谁的手。今天逐 hunk 核完（分归办法写在
  `BLOCKED.md` B262 ④），确认这批 diff 里每一处都能追溯到 A1/A2 那四枚值或它们的生成件；
  收集框线在 `3d0d593f4` 的 RK 那笔里也是把它们判成"别线未签字的手"刻意排除的，两边读的是同一批行。
- **别线替本线登记的那格现在才闭合**：`BLOCKED.md` B261 是收集框线量到 `typography.spec.ts`
  红在**本线未提交**的行高改动上，按"判据口径不代改"原样递回来 —— 本线签了（24 → 28，
  测试名里那个数字一起改）。
- ⚠️ **这次改动连带抬高了日历的小时轴**：`CalendarDayBoard` 的行高**就是** `size.row-min-height`
  （那份复用是有意写死的，理由在它文件头），于是 24 行从 1344px 变 1440px；移动端 `FocusScreen`
  与日历格同理跟随。这不是缺陷，但它是"改一枚共享 token 会走到哪"的现量答案。
- ⚠️ **被这次改动否证的那五处旧口径一起改了**（不改就是第二份自相矛盾的抄件）：`typography.ts`
  文件头那句"不改行高"、`density.ts` 规格表的（56）（8）、`CalendarDayBoard.tsx` 的 `24 × 56 = 1344px`、
  `quadrant-row-parity.spec.tsx` 与 `calendar-day-view.spec.tsx` 的注释、`MASTER.md` §13 的 `row-title` 行。
  🔴 **同表 `row-meta` 仍写 `14 / 400 / 21` 而代码是 12px** —— 那是 11-02 字重/字号那一刀的漏改抄件，
  归设计系统线，本线不代改（B262 ②）。
- 🔴 **HEAD 的自洽性在干净检出上量过，不是内容推理**（三臂，2026-11-05 20:15）：
  `git archive <rev> | tar -x -C <空目录>` 出三棵树 —— 当前 HEAD、入库前那笔（`29214d5b7`）、
  以及一枚**混树**（HEAD 的 design-system + 入库前的 `mockup.css`）。判据按两枚 landing spec
  自己的谓词复算（`expectVar` / `ruleBody` 那对正则），10 臂：4 枚目标值 + 2 枚生成件 + 4 枚镜像配对。
  读数：**HEAD 10/10 绿**；**入库前 10/10 红**（所以这把尺不是恒绿的）；
  **混树恰好红在 4 枚镜像配对臂** —— 这就是"分不清就只提交源文件"那条前置会留下的断链形状，
  与 `SIDEBAR_TOOL_TABS` 那次（B258）同一类，只是这回在入库前被量住了。夹具跑完即删；
  重建办法就是上面那三行 `git archive`＋按 spec 谓词复算，别在仓里留第二把尺。
- **A4 能签的一半与不能签的一半**：能签的是"新密度下没画坏"——浏览器腿 11/11（含 ⑦ 390 窄屏 + 暗色），
  2026-11-05 20:0x 在含别线 `e33523e7e`（把判断从壳挪回共享层）的 HEAD 上**复量过一遍**，仍 11/11；
  本趟重跑后**看过 ① 逾期那一格那张**（1440 亮色：任务行、侧栏、分组说明、回收站都在位、没被裁）；
  ⚠️ 其余七张本趟**没逐张重看**，上一趟（11-04 22:4x）那批是逐张看过的，别把这句读成"本趟八张都过了眼"。
  设备侧本趟补了一枪：`scripts/verify-mobile-pin-order.sh` **9/9 退 0**，读数头上打的是
  `git HEAD = 1062146c6`，两张图换上并与上一趟逐张对比过（同形，差别是滚动位置与攒下的行）。
  ⚠️ 装置那行同时写着装着的产物 mtime = 11-04 22:26 —— 它没重打包；这一格仍然算数的理由与本节
  第一条同源：进 bundle 的运行时值就是那四枚 token，它们 11-04 已在那棵工作树里。
  **没签的是**"和滴答并排比观感"那一半：那需要滴答的截图做参照，本轮没做，别把它读成已对齐。

### 阶段 2（右键菜单）

| 项 | 状态 | 判据在哪 |
|---|---|---|
| B1 优先级四档 | ✅ 已落（旗帜图标 + 当前档高亮） | `apps/web/tests/task-row-menu.spec.tsx` |
| B2 添加子任务 | ✅ 已落，**但落点与原文不同** | 同上 |
| B3 标签子菜单 | ✅ 已落（已有标签可勾 + 当前勾高亮），**零标签时建不出第一条那一格已修** | 同上 + e2e ⑧ |
| B4 移动到（清单） | ✅ 已落（含「收集箱」那一档） | 同上 |
| B5 置顶 | ✅ 已落 | `task-row-menu.spec.tsx` 的「置顶这一项（B5）」三条 |

- **B2 的落点改了**：原文写"点击后在行内展开子任务输入框"。行内编辑器在
  「撤掉行尾编辑器、字段全收进面单」那一刀之后**已经不存在**，所以这一项做的是
  打开那条任务的**面单**，子任务那一格就在里面。这是同一个意图的现路径，
  ⚠️ 不许把它读成"点了没反应"，也不许为它再造一份行内编辑器（那会把撤掉的编辑器请回来）。
- **B5 不用改 schema** —— 原文那句"需确认是否有 `pinned` 字段"现在有了答案，而且答案是
  🔴 **"零件全在，缺的只是按钮"**：字段 `Task.pinnedAt`（`packages/domain/src/entities.ts`）、
  动作 `TaskActions.setPinned`（`packages/app-host/src/actions.ts`）、排序 `byPinnedFirst`
  （置顶只改同分组内次序，ADR-0083 §3.2）、移动端菜单（`TasksScreen.tsx`）
  以及中英两条词条（`web.rowMenu.pin` / `.unpin`）**早就都在**。
  Web 上此前没有任何调用点 —— 与「已完成」那一行当年一模一样的"最后一米"形状。
  ⚠️ 当前态一律经领域层 `isPinned()` 判，宿主不许自己写 `pinnedAt === undefined`
  （那条禁令就写在 `isPinned` 的文件头）。
- 🔴 **浏览器腿量出一处真缺陷，已修（2026-11-04 晚）**：上面那句"排序早就在"只对了一半 ——
  `byPinnedFirst` 住在 app-host 的**出口**（`listTasks()` 那一路），移动端读的就是那份；
  而 **Web 的行序根本不走出口**，它走领域的 `sortTasks`
  （`packages/ui/src/task-list/model.ts` 每组调一次，档位由界面的排序菜单给）。
  那一档当时**不看 `pinnedAt`**，于是 web 上点「置顶」：字段写了、op 发了、另一台设备也看得到，
  **界面上一行都不动** —— 症状与"点了没反应"完全一样，而类型、构建、单元判据全都不会红
  （单测断的是"回调带着 `pinned=true` 发出去了"，它确实发出去了）。
  修在**唯一那份**：`packages/domain/src/task-order.ts` 的 `compareBySortKey` 里加一档置顶前置
  （写在分支**外面**，与「已完成沉底」同一层：换排序档位不该让钉住的东西沉下去）。
  判据：`packages/domain/tests/task-order.spec.ts` 新增四条（每一档都前置 / `pinnedAt: 0` 也算 /
  两条都置顶时不比时刻 / 已完成仍压在置顶之前），浏览器腿是
  `e2e/tests/dida-alignment-detail-sidebar.spec.ts` ⑥ 那条"置顶后第一条应当是「交房租」"。
  ⚠️ **变异验证做过**：把那三行换成不前置再跑同一批用例 ⇒ 四条里三条当场红（第四条是 LIFO 兜底，
  它测的是另一件事），装回来 16 条全绿。

### 阶段 2 的浏览器腿又抓到三格（同一枚菜单，2026-11-04 深夜）

这三格**全都在 jsdom 里过不去**，也就是说"单测全绿"对它们一律无话可说：

1. 🔴 **一条标签都没有的人，从行菜单里建不出第一条标签**。整行「标签」当时的渲染条件是
   `tags.length > 0` —— 而"还没有标签"恰恰是最需要"新建"的那一刻。原文承诺的是
   "显示已有标签 **+ 新建**"，所以这是**没做到**，不是简化。
   现在按"有得挑，**或**有得建"判（两者都没有才不画 —— 那才是按下去没反应的一行）。
   判据：`task-row-menu.spec.tsx` 两条新用例（空列表 + 接了 `onCreateTag` ⇒ 行在、点开只有新建；
   两样都没有 ⇒ 行不画）+ 浏览器腿 ⑧。
2. 🔴 **草稿框里的 Esc 是死键**。共享层因为 `nestedOpen` 为真把整把键盘让给草稿，
   而草稿自己一个键都不接 ⇒ 用户改主意按 Esc，屏幕上什么都没发生。
   现在 Esc **只退一层**：草稿收掉、回到「新建标签」那一枚、菜单留着。
   判据：`task-row-menu.spec.tsx`「草稿里按 Esc」+ 浏览器腿 ⑧。
   ⚠️ 变异验证做过：把 `setTagDraft(null)` 注释掉 ⇒ 那条用例当场红，装回来 29 条全绿。
3. 🔴 **在草稿里打第一个字，整层菜单自己关掉了** —— 这一条是三条里最脏的，因为它是一条**因果链**：
   草稿的聚焦 effect 依赖的是 `tagDraft`（**值**）而不是"草稿开没开" ⇒ 每按一个键都重新
   `focus()` ⇒ 浏览器把聚焦的元素**滚进视野** ⇒ 撞上那条不分场合的 `scroll`（capture）关闭监听
   ⇒ `onClose()` ⇒ 菜单卸载 + 焦点还给那一行。表现就是"名字根本打不进去"。
   两处一起修：effect 只认布尔那一格；`scroll` 监听**放过面板内部的滚动**（锚点是 `fixed` 钉在
   视口上的，面板内滚一下不改变它和那一行的关系；页面滚才改变）。
   反向那一格由 ⑨ 钉住：**滚页面必须收走菜单**（留在错的地方比关掉更坏）。

⚠️ 归因方法记一句：这三格都是先写浏览器判据、让它红、再用一次性探针 spec 把"到底是哪一层关掉的"
量出来（探针读 `panel/draft/entry` 三枚计数 + `activeElement`），跑完即删 —— 不是猜出来再改的。

### 阶段 3（详情面板）

- **C2 底部工具条：三枚，且每一枚都真的做事。**
  「移动到」→ 聚焦面单里那个清单下拉（`organize-project-select`），
  「备注」→ 聚焦备注框（`task-note-input`），
  「更多」→ 打开**这条任务**的行菜单（`task-row-menu`），锚点取按钮自身的下沿。
  判据：`apps/web/tests/task-detail-card.spec.tsx` 的「底部工具条（滴答对齐 C2）」——
  前两枚量的是**点完之后焦点落在哪个控件上**，第三枚量的是**它接到宿主的菜单锚点上**
  （回调收到 `task.id` + 一组数字坐标）；浏览器腿 ② 再把第三枚推到"做成一件事"：
  点「更多」→ 行菜单可见 → 优先级 → 高 → 菜单收掉 → **行上长出「高优先级」**。
  🔴 第三枚是**本轮后加的**，加它的理由不是"滴答有三枚"，而是可达性：面单里的动作区
  此前只有右键 / `Shift+F10` 两个**隐形把手**，界面上一个可见入口都没有 —— 用户不知道
  这排东西存在，就等于没有。⚠️ 它**复用**行菜单的文案键（`web.rowMenu.label`），没新增词条。
  🔴 「文本格式」仍然不画，这是裁决不是漏掉：富文本是 C1（选型 + 许可证门禁未过），
  现在这块是纯文本框，画一枚格式按钮等于给用户一个按下去什么都不变的控件。
  ⚠️ 定位一律走组件自己的 ref，不走 `document.querySelector`：
  窄档对话框与宽档详情列**同时挂着两棵 `task-pane`**，整篇文档去查会点到另一棵。
- **C4 逾期红色：现成就有，本轮零改动 —— 但**渲染点**与原文写的位置不是同一处。**
  真正画那一格的是共享 `TaskBadges`（`packages/ui/src/task-list/TaskBadges.tsx`：
  逾期用 `tokens['color.danger']` + `TriangleAlert` 字形，未逾期用 `CalendarClock`）。
  🔴 原文落点写的 `DueBadge.tsx` / `.ht-due--overdue` 在 `apps/web` 里**今天没有渲染点**
  （行徽标全部走共享那一支）—— 拿它当探针只会量到空气，本轮实测错过一次，
  所以把出处直接写在 `e2e/tests/dida-alignment-detail-sidebar.spec.ts` ① 的断言旁边。
  ⚠️ 判据比的是**计算色 vs `--ht-color-danger`**，不写十六进制：亮暗两套下那个 token 是两个值，
  写死任何一个都会在另一套里假绿或假红。① 量亮色、⑤ 在暗色下**重新读一次 token** 再比。
  颜色只是冗余通道，语义由文字承载 —— 这条纪律写在 `controls.css` 那条规则上面的注释里。

### 阶段 4（侧栏）

- **D2 回收站搬进侧栏底部：已搬，代价如实记账。**
  `view-tabs.ts` 的 `TOOL_VIEW_TABS` → **`SIDEBAR_TOOL_TABS`**，由 `App.tsx` 渲染在
  `.ht-sidebar__body` 末尾（`margin-top: auto` 贴底，行的形状复用 `.ht-nav__item`，
  所以它与「已完成」看着就是一组并列的行）。rail 侧同时**删掉**了那个 `role="tablist"`
  的工具容器 —— 同一目的地两个控件是 2026-10-04 定收集箱那一行时写进
  `PRIMARY_NAV` 文件头的判据，所以这次是**搬**，不是加。
  🔴 **代价（产品负责人 2026-11-04 选定"真的搬"时读过的）**：侧栏只在
  **任务视图**渲染，所以习惯 / 便签 / 番茄 等视图里回收站**没有导航入口**。
  剩下两条路：先回任务视图点这一行；或在搜索的「快速跳转」里打「回收站」
  （`quickActions` 仍从这份常量取）。窄档还多一层 —— 那一列住在抽屉里。
  判据：`e2e/tests/sidebar-trash-anchor.spec.ts`（由 `rail-trash-anchor.spec.ts` 改写，
  宽屏几何 + 真点一次 + 断言 rail 上没有第二枚，外加窄屏抽屉那一支）；
  `apps/web/tests/app-mount.spec.tsx` 的「回收站在侧栏底部那一组」；
  `apps/web/tests/tab-roving.spec.tsx` 那条反向判据（rail 上没有 `rail-view-trash`）。
- **D3 分组说明：已落两句，且只在有数据时出现。**
  词条 `web.projects.headingHint` / `web.tags.headingHint`（中英各一条）。
  🔴 列表为空时**不画** —— 空态那两句已经讲了同一件事，同一屏说两遍是噪音。
  排版复用既有档位（`.ht-type-caption` + `--ht-color-foreground-muted`），
  没有新开设计变量。判据：`apps/web/tests/projects-panel.spec.tsx` 的
  「D3 分组说明」两条（有数据画 / 空数据不画）。
- **展厅（landing mockup）跟着搬**：`SHELL_VIEW_TABS` 去掉回收站、新增
  `SHELL_SIDEBAR_TOOLS`，`AppWindow.tsx` 的侧栏底部画那一行。
  判据在 `apps/landing/tests/mockup-shell-shape.spec.tsx` #5 那一组（rail 对账与
  侧栏工具**分开**算，另加"rail 不许再画它"的反向断言）。

### 门禁与构建的现量

跑这一节列的命令自己取，别信这里写的数：

```
pnpm check:design              # 设计变量裸值
pnpm check:design-token-refs   # token 引用可解析
pnpm check:shell-surfaces      # W5 要求 dist 不比 src 旧 ⇒ 改完 src 要 build
pnpm --filter @heyta/web build
pnpm typecheck
```

`check:shell-surfaces` 现量绿，但要看清它红过一次是**为什么**：它的 W5 那一格比的是
"dist 的时间戳不早于 src"，而这条线上正在并行的那一条**每隔几十秒就碰一次 src** ——
build 完再跑它就是绿，别线再写一笔它就红。这不是谁做错了，是同一棵树上的时序竞态。
⚠️ 所以宣布"绿"必须连着命令一起给（自己跑一遍取现量），写在这里的数只对本文件那一秒成立。

⚠️ **两件与本计划无关但同时存在的事**（写在这里是为了下一个会话不把它们读成本轮的债）：
① 设置浮层那一族由另一条线在改（工作树里 `features/settings/*Panel.tsx` 与
`packages/ui/src/settings/*` 是 `M` 态，`App.tsx` 里多出 `sheetExiting` 那几行不是本计划写的）；
那处改动让浮层等 CSS 动画结束才卸载，于是在 jsdom 里"关掉浮层"这类断言会读到场。
🔴 本线 21:41 戳实测撞上其中一条：`apps/web/tests/app-mount.spec.tsx`「rail 的「搜索」是唯一入口…顶栏那个框不许回来」
红在 `Esc 之后浮层应当关掉`，收到的节点带 `class="ht-sheet ht-sheet--exiting"`（26/27 过）。
判它不归本线的证据有三条，不是凭印象：`sheetExiting` 那一行在 `git diff -- apps/web/src/App.tsx` 里是**未提交的新增**
（本线在那枚文件里只加了 `openRowMenuAt` 与两处 `onShowActions`）；`closeSecondarySurface` 只置旗标，
真正的卸载在 `finishSheetExit`（由动画结束触发，jsdom 不触发）；**这一族已由责任线自己登记在 `BLOCKED.md` B252 ④**。
它留给本计划的那两枚裸 `8px` 与那枚 `.ht-spin` 棘轮**都已由责任线自己收掉**（`BLOCKED.md` B251 → B252）。
② 2026-11-04 21:3x 戳本线门禁合并扫描时 `check:overlay` 红在一枚**未入库**的自绘浮层上
（`apps/web/src/features/capture/CaptureDuePopover.tsx`，工作树里是 `??` 未跟踪 = 捕获那一屏正在写的手）。
它不在本计划的九条里，本线不代改；**归因已由设置页治理那条线登记在 `BLOCKED.md` B253**，
本线只补这一句指针，免得下一个会话把这枚红当成滴答对齐的债。

### 验收对照（本轮那九条）

| 验收项 | 现在的答案 | 由谁给的证据 |
|---|---|---|
| 右键菜单所有新项功能正常 | ✅ 单元层一族「点了真的发出那个意图」（B1 四档、B2 交父 id、B3 整组覆盖 + 取消 + **新建两步一次做完**、B4 清单/收集箱、B5 开关双向）**+ 浏览器鼠标腿 ⑥**（右键开菜单 → 选「高」行上长出「高优先级」→ 勾标签行上长出 chip 且再开时 `aria-pressed=true` → 「添加子任务」打开的是那条任务的面单 → 置顶后它排到第一行、再开菜单那一项自己说「取消置顶」） | `apps/web/tests/task-row-menu.spec.tsx`；`e2e/tests/dida-alignment-detail-sidebar.spec.ts` ⑥⑧（图 `test-results/dida-row-menu-browser.png` / `dida-new-tag-inline.png`，已看过） |
| 键盘导航可用 | ✅ 含这一轮修掉的那格：子菜单触发器的 `role` 原本挂在包裹 div 上 ⇒ Enter 打不开子菜单（鼠标能用、键盘不能用）。现在 Enter 真能展开；浏览器腿 ④ 走的是**整条**：Shift+F10 开菜单 → 方向键走到「移动到」→ Enter 展开 → ↓ Enter 换归属 | `task-row-menu.spec.tsx`「键盘 Enter 能展开子菜单」+ `pnpm check:menu-keyboard` + e2e ④ |
| 详情面板工具条按钮响应正确 | ✅ **三枚**：前两枚各断言**点完之后焦点落在哪个控件**，第三枚「更多」断言**它能把行菜单里的一件事真的做成**（点它 → 菜单可见 → 优先级 → 高 → 菜单收掉 → 行上出现「高优先级」）。浏览器腿 ② 同一条口径，另加"整屏只有三枚"。「文本格式」仍按裁决不画（等 C1） | `apps/web/tests/task-detail-card.spec.tsx` + e2e ②（图 `dida-detail-toolbar.png`，三枚与行上的「高优先级」都在画面里） |
| 逾期日期红色显示 | ✅ 早就在（本轮零改动），**浏览器里比过色**：① 亮色、⑤ 暗色各读一次 `--ht-color-danger` 与那一格的计算色比，且要求徽标区有 svg（颜色不是唯一通道）。⚠️ **与原文那半句有差**：原文写"带日历图标"，实际逾期那一格用的是**警告三角**（日历图标只在未逾期时出现）—— 这不是漏做：`TaskBadges` 是四端共用的一份，把三角换成日历会让"逾期"只剩颜色 + 文字这一条非色通道，色觉障碍与暗色下更弱。裁决留在 C4 那一格 | e2e ①⑤（图 `dida-overdue-badge.png` / `dida-dark.png`）|
| 垃圾桶在侧栏底部可见 | ✅ 单元层 + 展厅 + **浏览器腿**（贴底几何、rail 上没有第二枚、真点一次进回收站、窄屏抽屉那一支、暗色下那一行仍在） | `e2e/tests/sidebar-trash-anchor.spec.ts`（2/2）、e2e ⑤、`app-mount.spec.tsx`、`mockup-shell-shape.spec.tsx` #5 |
| 侧栏分组说明显示正确 | ✅ 单元层（有数据画 / 空数据不画）+ 浏览器腿 ③（有清单时标签那格只有空态文案、建完标签后两句都在）+ ⑤ 暗色下两句仍在原位 | `projects-panel.spec.tsx` 的「D3」、e2e ③⑤（图 `dida-sidebar-hints.png`）|
| `pnpm check:design` | ✅ **现量绿**（`pnpm check:design` 退 0）。过程记在这里免得下一个会话重做归因：本轮曾红在两枚**已提交**的裸 `8px`（那条线的 `2a4bc0e20`），本线按"三条不齐"只登记不代改 → 登记进 `BLOCKED.md` B251 → **责任线随后自己收掉了**（走的是候选补丁之外的 `0.5em`，理由见 B252）。同族的另一枚 `check:row-single-source`（`.ht-spin` 那格 29 > 基线 28）在 2026-11-04 21:35 戳**复量已回到退 0**（那枚族被责任线收编进 `.ht-settings` 族，基线与现量同为 28）—— ⚠️ 这两个数只在那一秒成立，要现量自己跑 `pnpm check:design` 与 `pnpm check:row-single-source` | 自己跑 `pnpm check:design` 与 `pnpm check:row-single-source` |
| `pnpm check:design-token-refs` | ✅ 绿 | 同上 |
| Web 构建通过 | ✅ 绿（`pnpm --filter @heyta/web build` 退 0，2026-11-04 22:40 戳）。⚠️ 中间读到过**两次**红，两种成因都记下来免得下次误归因：① 别线把 `SessionsPanel.tsx` 写成半截（`TS17008` 未闭合），几分钟后他们写完自己好了；② 22:39 那次红在 `CaptureComposer.tsx(154) TS2739 少 previewLead/previewEmpty`，**不是半写** —— 现量：那两枚键在 HEAD 与工作树**都是 0 命中**，要求来自 `packages/ui/dist` 的陈旧 `.d.ts`，一条 `pnpm --filter @heyta/ui build` 就回绿。⇒ 红在别人的件里时，先分清"源码半写"还是"产物陈旧"，后者不需要等谁 | 同上，另加 `pnpm typecheck`（2026-11-04 21:34 戳整仓退 0） |

- ✅ **设备腿（这九条之外，22:34–22:40 戳补的）**：`pnpm verify:mobile-pin-order` 在真 iOS 模拟器 7/7、
  `pnpm --filter @heyta/desktop smoke -- --window` 在真 Electron 窗口 `rows=1 / colorBuckets=66`（图入库并看过）。
  细节与"为什么必须在设备上量"（两端默认档位不同向）写在下面「还没被验证的」那一节。
  iOS 的屏幕图后来也取到了（`--display=primary`，两张已入库并看过），
  那一节里同时更正了我先前对黑帧的错误归因。

- 🔴 顺带抓到并修掉一个**只在键盘上成立**的缺陷：三个子菜单的触发器把 `role="menuitem"`
  挂在包裹用的 `div` 上，而共享层 Enter 做的是 `items[i].click()` —— 点一个 div 什么都
  不发生。症状是"鼠标能开、键盘开不了"，而 `check:menu-keyboard` 只看结构，看不见这一格。
  现在 `role` 落在真按钮上，判据是那条「键盘 Enter 能展开子菜单」。

### 入库（本轮按主题拆的那几笔）

⚠️ 这里**不写 SHA**（同一棵树上别线每隔几十秒提交一次，写死的号下一分钟就指错东西）。现量：
`git log --oneline -12 --grep='置顶在 web\|行菜单四组\|面单底部工具条\|垃圾桶搬进侧栏\|阶段 2-4 的浏览器腿\|B258'`。

| 主题 | 落库情况 |
|---|---|
| domain 置顶顺序（B5 的真缺陷） | 一笔，只含 `packages/domain/{src/task-order.ts,tests/task-order.spec.ts}` |
| 行菜单四组动作 + 三处缺陷（B1–B5、键盘 Enter、零标签、草稿 Esc/焦点） | 一笔，含 `TaskRowMenu.tsx`、`task-row-menu.css`、`store.ts`、`task-row-menu.spec.tsx`，以及 `App.tsx` 里**只属于这一格的两枚 hunk**（`isPinned` 那枚 import + 行菜单的 props 接线）与 `zh-CN.ts` 的 `web.rowMenu.*` |
| 面单工具条第三枚（C2） | 🔴 **内容入库了，但记在别线名下**：本线 staged 之后、`git commit` 之前那 8 秒，设置页治理那条线落了一笔裸 `git commit`，把 `TaskDetailCard.tsx`、`task-detail-card.spec.tsx` 与 `App.tsx` 那三枚 hunk 一起带走了。过程与教训写在 `BLOCKED.md` B258 ④（与 B257 是同一件事的两个面）|
| 侧栏 D2/D3 | 一笔，含 shell 三枚、`view-tabs.ts`、`ProjectsPanel.tsx`、三枚 CSS、`{app-mount,language-switcher,tab-roving,projects-panel}.spec.tsx`、`e2e/tests/helpers.ts` 与跟着改口的四枚 e2e spec，`App.tsx` 只取五枚 D2 hunk（**没碰**别线那枚 `ht-sheet`）|
| e2e 九条 + 本计划文档 | 一笔 |

🔴 **这笔 rename 留了一格本线引起的红**（`BLOCKED.md` B258 ②）：`TOOL_VIEW_TABS` → `SIDEBAR_TOOL_TABS`
之后，`apps/landing/tests/mockup-shell-shape.spec.tsx` 那枚**按源码文本对账**的 spec 在 HEAD 上
找不到锚会 `throw`。修法（把锚改成新名）此刻在 landing 线未提交的那手里 —— 三条判据不齐，本线不代改，
闭合条件与兜底都写在 B258。⚠️ 这条纪律值得留下：**改一个被文本对账引用的常量名，消费者不只在 TS 图里**，
`pnpm typecheck` 全绿不代表没有断链。

**刻意没入库的**：`packages/design-system/**`（阶段 1 排印密度那两枚 `TASK_ROW_SHAPE` 与四份生成的 token 件）——
它们与本线的 D2/D3 不在同一格，且此刻和别线的 token 工作同片地；等那一族归口清楚再单独一笔。

✅ **那一笔已于 2026-11-05 落下**（上面「阶段 1」那一格）：逐 hunk 核过这批 diff 的每一处都能追溯到
A1/A2 那四枚值或它们的生成件，连 `mockup.css` 的四处镜像一起走（`git apply --cached` 只取本线那四处，
`.mk-sidebar__tools` 那枚与 landing 在飞的那一手成套、留在工作树未动）。分归办法与读数在 `BLOCKED.md` B262。

### 别线的一处红（登记，不代改）

🔴 **同一棵树上有人在写**（形状，不是状态）：本轮读到过 `apps/web/src/features/settings/SessionsPanel.tsx`
的 mtime 就在构建前十几秒，那一趟红在 `TS17008: JSX element 'div' has no corresponding closing tag`
（半写状态），而 `packages/ui/src/settings/Settings.tsx` 同时引用了一个还不存在的 `TrailingLine`
（`TS2304`）。几分钟后他们写完，构建与 `check:shell-surfaces` 都回到绿 —— **这两枚文件都不是本计划的落点**，
那是 G-4 那一格写到一半的样子，本线不代改、也不把它读成自己的债。
要复核就自己跑，别拿这里的话当现量：

```
pnpm --filter @heyta/web build 2>&1 | tail -5
pnpm check:shell-surfaces 2>&1 | grep -E "W5|✅ 壳级" | head
```

⚠️ `check:shell-surfaces` 的 W5 那一格比的是"dist 不早于 src"⇒ 只要别线还在写 src，
build 完再跑它就可能又红。这是同一棵树上的时序竞态，不是谁的缺陷。

`pnpm check:control-semantics` 现在红，但**红的不是产品**：它的自检第 ⑥ 臂要求
"账本里的幻影类没有使用点 ⇒ 必须红"，而 `PHANTOM_LEDGER` 在提交态上已经是 `[]`
（账本清空之后那一臂再也不可能满足前提）—— 也就是**一条现在恒不会红的判据被留下了**，
它反过来把整道门禁判死。真树那一趟跑 `node scripts/check-control-semantics.mjs` 是绿的
（读数「幻影 0 / 外观 2」）。`scripts/` 在工作树里是干净态 ⇒ 这一格属于设置页治理那条线，
本计划不代改判据口径。

`pnpm typecheck`（全仓）与 web 单测的现量：**本计划改到的文件全绿**，红都在别线在飞的改动里。
取现量（数字会随那一条线每几十秒一次提交漂，别信这里写的数）：

```
pnpm --filter @heyta/web test        # 看它报的 Failed Tests 落在哪几个文件
pnpm typecheck 2>&1 | grep "error TS"
```

本轮**某一秒**读到的形状（是瞬时读数，不是状态；复核自己跑上面那两条）：红集中在三族，
没有一条落在本计划改到的面上 ——
① 浮层"该关却没关"（搜索 scrim / 设置 sheet 的 Esc、⌘K、点背景三条出口，别线新加的
`sheetExiting` 要等 CSS 动画结束才卸载）；② `AiSettings.tsx` 的能力勾选；
③ 设置行的日期格式与 `packages/ui/src/settings/Settings.tsx` 那一格写到一半时的
`TS2304`（**这一族后来自己好了**：同一晚再跑 `pnpm typecheck` 已退 0 —— 别把这一条读成"本线留了个坏构建"）。

🔴 **归因不是"看着像"，是 A/B 量出来的**：本线这一轮改了领域的排序（`sortTasks` 加置顶那一档），
它会影响**每一端**的行序，所以必须自证没把别人的用例排红。做法是把那三行临时摘掉、
同一批文件重跑一遍，再装回来重跑一遍 —— 两次读数**逐字相同**（16 红 / 173 绿），
所以那 16 条与本线的排序改动无关。⚠️ 别拿"整仓跑出来的 23"和"单跑 8 个文件跑出来的 16"互相减：
那两趟的**运行方式**不同（并发与超时窗口不一样），要减必须同命令同文件表。

### 还没被验证的（不是待办，是证据的边界）

- **浏览器腿跑到了哪一格**：跑的是本线那两枚 spec（单跑，不碰整棵 `e2e/`）——
  `sidebar-trash-anchor.spec.ts` 2/2、`dida-alignment-detail-sidebar.spec.ts` **9/9**（现量
  `cd e2e && pnpm exec playwright test tests/dida-alignment-detail-sidebar.spec.ts tests/sidebar-trash-anchor.spec.ts --reporter=line`），
  八张图逐张看过（`dida-overdue-badge` / `dida-detail-toolbar` / `dida-sidebar-hints` /
  `dida-keyboard-move` / `dida-dark` / `dida-row-menu-browser` / `dida-narrow-dark` / `dida-new-tag-inline`）。
  ⚠️ 2026-11-04 21:40 戳这条腿**整批重跑过一次**（11/11 退 0，含 C2 第三枚「更多」那一格的新断言：
  点它 → 行菜单可见 → 选「高」→ 菜单收掉 → 行上出现「高优先级」），`dida-detail-toolbar.png` 也重新看过一张。
  ⚠️ **这套里出现过两次"flaky"，都不是产品**：报错原文是
  `browserContext.close: ENOENT … test-results/.playwright-artifacts-0/traces/…-recordingN.network`
  —— Playwright 写 trace 产物的 IO 竞争（同一棵 `test-results/` 被多趟跑与重试同时动），
  重试即过、断言一条没红。别把它读成"这条判据不稳"。
  🔴 中途两次"红"都是**探针跟着筛选跑**，不是产品坏：换归属或建标签之后侧栏的范围会切到
  那一格，未打标 / 已移走的那一行自然不在列表里 —— 用例现在先回收集箱再读，
  理由写在那两条注释旁边。还有一格是**取证拍到过渡帧**：菜单刚点开就截图，那一片是半透明的
  入场动画；现在先 `waitForOverlaySettled` 再拍。
- **没跑的**：整棵 `e2e/`（它会重写别的线未提交的入库截图，本线刻意不碰）；四端重装。
  取现量：`pnpm --filter @heyta/mobile test`、`pnpm --filter @heyta/ui test`、
  `pnpm --filter @heyta/domain test`。
- ✅ **设备腿已经补上了（2026-11-04 22:34 戳）**：`pnpm verify:mobile-pin-order`
  （新脚本 `scripts/verify-mobile-pin-order.sh`）在真 iOS 模拟器上跑通 7/7 ——
  装的那个包由本线现建（`xcodebuild Release` 成功、归属章已写、"已安装的包比源码新"由装置自己判）。
  🔴 **这一格必须在设备上量，不是因为"多一端更保险"**：`sortTasks` 是跨端的一份
  （`packages/ui/src/task-list/model.ts` 调它，移动端任务列表也走那个共享 model），
  而**两端的默认档位不是同一个方向** —— 移动端默认档 `addedAt`（新的在上，与搬共享层之前那句
  `reverse()` 逐条等价，见 `apps/mobile/src/screens/TasksScreen.tsx` 那条注释），web 走 `display`。
  上一版脚本把"先建的那条在上面"当前置，于是一跑就红 —— 那是**探针的假设**，不是产品缺陷；
  现在判据读的是**相对变化**（长按此刻在下面那条 → 它跑到上面去），并配三条一起才算：
  ① 顺序按无障碍树里的 **y 坐标**读（"在树里"证明不了"在前"，ScrollView 折叠线以下的节点仍在树里）；
  ② 置顶之后再开一次菜单，那一项自己要说「取消置顶」（写进去的是状态，不是一帧视觉）；
  ③ 手机里真 `ops` 表恰好 +3（两条建 + 一条置顶），且最新那条带 `pinnedAt`。
  🔴 **图那一格原来报"取不到"，归因报错了，现在更正**：黑帧的原因**不是**"Simulator 没开窗口"，
  而是 `simctl io … screenshot` 不带旗标时挑的是 `enumerate` 里那个
  `com.apple.display.captureservice` 端口（**宿主的**显示捕获服务）。显式
  `--display=primary`（真设备那一屏住在 `DisplayAdapter` 的 `Device Name: primary`）
  就取到 1398×2034、色阶差 255 的真帧，两张已入库并逐张看过：
  `apps/mobile/evidence/dida-pin-order-20261105/row-menu.png`（菜单里那枚「置顶」）与
  `after-pin.png`（刚钉的甲条落在第一行）。⚠️ 顺带一条会误杀的尺：仓库现成的
  `looksBlank()` 另一半是 `contentRatio < 0.01`，而**白底界面本来就 99% 是白的** ——
  判"全黑"只按 `colorSpan`（黑帧亮度全同 ⇒ 0），脚本里就是这么改的。
  🔴 补图这一趟还揪出**本装置自己的两处缺陷**（都不是产品）：
  ① 归一化那一步用子串匹配按「取消」，撞上了「取消置顶」，于是**装置自己写了一条
  `UPD_TASK {"pinnedAt":null}`**（现量：手机 ops 表 rowid 16）—— 现在所有 press 都带
  `--exact`，且菜单没有「取消」那枚按钮（`"取消" --exact` found=False），关它走点遮罩；
  ② 目标行的无障碍框报 y=455、高 74，看着整行都在，但**短按同一点什么都不打开**
  （长按上一行立刻开）——真命中区比 AX 框低一档。所以长按改成"按下 → 回读菜单在不在 →
  不在就滚一段再来"，与 journey 脚本对「添加」键那条纪律同形状。
- ✅ **桌面壳那一腿也补了，而且图是真取到的**：`HEYTA_SMOKE_SHOT=<绝对路径> pnpm --filter
  @heyta/desktop smoke -- --window` 起真 Electron 44 窗口，读数 `{"ok":true,"rows":1,
  "bridge":true,"hiddenBlank":false,"colorBuckets":66}`，图已入库
  `apps/web/evidence/dida-desktop-shell-20261104/desktop-window.png`（2200×1376，已看过：
  共享 `TaskList` 画出的一行仍在）。桌面壳渲染的就是那份共享 model ⇒ 这是对 `sortTasks`
  改动在第二端的"没画坏"证据，不是"多一端更保险"。
  🔴 顺带量到一把尺的边界，记下来免得下次误杀：`png-stats.mjs` 的 `looksBlank()` 是
  `contentRatio < 0.01` **或** `colorSpan < 16`，而**白底界面本来就 99% 是白的** ——
  这张桌面图的 `contentRatio=0.007`（会被判空白）但 `colorSpan=255`、色桶 66（真有内容）。
  ⇒ 判"全黑帧"只能按 `colorSpan`（黑帧是亮度全同 ⇒ 0）；设备脚本里已经改成这一半，
  理由就写在那段注释旁边。
- **窄屏 + 暗色那一档已补量**（⑦，390×844）：抽屉拉开后那两句说明各自**一行放得下**，
  判据取的是"不被裁（`scrollWidth ≤ clientWidth`）、不超过两行、整句落在这一列的横向范围里"，
  外加回收站那一行在抽屉里点得到（图 `dida-narrow-dark.png`，已看过）。
  ⚠️ 刻意**没有**把"必须换行"写成判据 —— 那是把正确外观预设为缺陷。
- **九条验收现在都有现量读数**（`check:design` 那一格的过程写在上面那张表最后一行）：
  本轮它曾红在**别人已提交**的两枚裸 `8px`，本线按"资产归属 / 不在飞 / 不碰别人口径"三条不齐
  只登记不代改（`BLOCKED.md` B251），责任线随后自己收掉（B252）。
  ⚠️ **同族还有一枚红没被收**：`check:row-single-source` 断言 B（`.ht-spin` 让 `ht-*` 前缀族
  从基线 28 涨到 29，同样是 `2a4bc0e20` 落进来的，HEAD 上就红）。它**不在这轮九条里**，
  归因证据与两条出路写在 B251 ⑥b —— 下一个会话别再重做一遍归因。
  ⚠️ **同一笔提交还落下第二枚门禁红**（本轮扫链撞见，一并登记在 B251 ⑥b）：
  `check:row-single-source` 的断言 B 红在"`ht-*` 前缀族 29 > 基线 28"，多出来的那一族是
  `.ht-spin`，由 `2a4bc0e20` 引入（HEAD 上就红，与本线无关 —— 本线动过的三个样式文件
  族集合与 HEAD 逐字相同）。这一条**不在本轮那九条验收里**，登记是为了下一个会话不重做归因。
  🔴 **2026-11-05 更正这一格的归因**：`.ht-spin` 那族已由设置页治理线自己收编进 `.ht-settings__busy`
  （`7d3521391`，族数回到 28），但**今天这道门还是红的** —— 多出来那一族换成了 `.ht-capture`，
  由 `3d0d593f4`（收集框 S1–S5）带回。归因可复现，别再重做一遍：HEAD 与工作树的族清单逐行相同
  （两边都 29），沿 `git log -20 --format=%H -- apps/web/src/styles` 逐笔放量，只有那一跳是 28→29。
  证据与两条出路写在 `BLOCKED.md` B263（登记不代改：基线常量是 M3 视图统一那条线的判据口径）。
- 阶段 5（C1 富文本 / C3 评论 / D1 过滤器）本轮明确**未动**，仍按原文需要单独排期。

---

**创建时间**：2026-11-04
**最后更新**：2026-11-05
