#!/usr/bin/env node
/**
 * 「空态只有一个」门禁 —— 手写空态**只减不增**，共享实现只有一处。
 * ===================================================================
 *
 * 判据出处：`docs/research/dida-view-unification.md`
 *   · §1.6 「空态：居中一句「没有任务」—— **一个组件一句话**」（滴答的实测形状）
 *   · §3 判据 3「空态没有定义 → 空态只有**一个**实现 + `web.empty.*` 一套词条」
 *   · §5 门禁表「空态只有一个：`web.empty.*` 之外的"空"文案不许出现在视图里」
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 先给调查结果：现状**不是**"一个实现"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 判据说"`web.empty.*` 一套词条"。**实测：这一族今天根本不存在。**
 * 空态文案散在 20+ 个 key 前缀里（清单见下），共享层 `packages/ui`
 * 只有一个 `TaskList.emptyMessage?: string` —— **装不下** title + hint + icon。
 * 也就是说：§3 判据 3 描述的目标形状**还没有落地**。
 *
 * 于是本门禁**不**断言那个尚不存在的共享组件（那会让它一出生就红，
 * 而任务书明确说"'造那个组件'是后续项"）。它断言的是**能立刻做到的那一半**：
 *
 *   **新的空态不许在视图里手写。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 调查清单（2026-09-28 实测；行号是当时的）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **共享实现（3 个：1 个权威 + 2 个待转发）**
 *
 *   · `packages/ui/src/empty-state/EmptyState.tsx` —— 🔴 **唯一权威定义**
 *     （2026-09-28 新增）。四个槽位 `icon` / `title` / `hint` / `detail`，
 *     纯逻辑在 `empty-state/model.ts`，颜色/字号/间距全走 token，
 *     文案由宿主注入（**不 import `@heyta/i18n`**）。
 *     断言 A 的锚点 + 断言 C 的权威判定都钉在它上。
 *   · `apps/web/src/App.tsx:1044` `function EmptyState({ filter })` ——
 *     渲染 `ht-empty` / `ht-empty__icon` / `__title` / `__hint`（`:1074-1077`）。
 *     文案按 filter 从 `web.shell.empty.{all,today,completed,quadrant}.{title,hint}` 取（`:1055-1069`）。
 *     ⚠️ **待转发**：收编后应变成"从 `@heyta/ui` 导入 `EmptyState` + 传文案"。
 *   · `apps/mobile/src/ui/kit.tsx:701` `export function EmptyState({icon,title,hint,detail})` ——
 *     ⚠️ **待转发**：同上。
 *   · `packages/ui/src/task-list/TaskList.tsx:100` `emptyMessage?: string` —— 只有**一句**，
 *     没有标题 / 提示 / 图标三个槽位。它**不是**空态组件，是列表的内联单句；
 *     保留它是因为"整行一个字符串"与"空态块"是两个不同的槽位，不是重复。
 *
 * **手写空态站点（web，`apps/web/src/`）**
 *
 *   | 文件 | 行 | 形态 | 词条 |
 *   |---|---|---|---|
 *   | `features/trash/TrashView.tsx` | 87-90 | 手抄 `ht-empty` 三件套 + `Trash2` 图标 | `web.trash.empty.{title,hint}` |
 *   | `features/auth/AuthPanel.tsx` | 225-229 | `<strong>+<span>` 自成一格 | `web.auth.empty.{title,body}` |
 *   | `features/habits/HabitsView.tsx` | 127-128 | 单句 `<p>` | `web.habits.empty` |
 *   | `features/categories/CategoryBreakdown.tsx` | 67-68 | `ht-categories__empty` | `web.categories.empty` |
 *   | `features/motivation/GrowthView.tsx` | 78-79 | `ht-growth__empty` | `web.growth.week.empty` |
 *   | `features/motivation/IdentityTagList.tsx` | 71-72 / 111 | `ht-tags__empty` ×2 | `web.growth.tags.empty` |
 *   | `features/timeline/TimelineView.tsx` | 151-160 | `data-testid="timeline-view-empty"` | `web.timeline.(aria.)empty` |
 *   | `features/timeline/GanttChart.tsx` | 387-394 | `data-testid="gantt-empty"` | `web.gantt.empty` |
 *   | `features/ai/AiToolRun.tsx` | 388 | `ht-ai__note` 单句 | `web.ai.tools.empty` |
 *   | `features/settings/AiSettings.tsx` | 641 / 911 | 两处（`ht-settings__hint`） | `web.ai.settings.{endpoints,features}.empty` |
 *   | `features/settings/MemoryPanel.tsx` | 197 / 250-251 | 两处 + `data-testid="memory-gap-empty"` | `web.memory.{known,gap}.empty` |
 *   | `features/settings/PasskeyPanel.tsx` | 278-279 | `data-testid="passkeys-empty"` | `web.passkeys.empty` |
 *   | `features/settings/ImportPanel.tsx` | 123-124 | `data-testid="import-empty-only"` | `web.import.emptyOnly` |
 *   | `dev/universal-slice.tsx` | 75 | 传 `emptyMessage="暂无任务"`（**硬编码**） | — |
 *
 * **名字里有 `empty`、但实测**不是**空态的两处（判据已显式排除，理由见下）**
 *
 *   · `features/sync/ConflictDialog.tsx:70` —— `web.conflict.payload.empty`（「（空）」占位符）
 *   · `features/settings/export-copy.ts:36` —— `web.export.markdown.empty`（导出文件里的标签）
 *
 * **手写空态站点（mobile，`apps/mobile/src/screens/`）**
 *
 *   | 文件 | 行 | 形态 | 词条 |
 *   |---|---|---|---|
 *   | `TasksScreen.tsx` | 648 / 824 / 834-835 | 一处 `<EmptyState>` + 两处裸 `<Text>` | `mobile.tasks.{summary,quadrant}.empty`、`mobile.tasks.empty.*` |
 *   | `TrashScreen.tsx` | 136-137 | `<EmptyState>` | `mobile.trash.empty.*` |
 *   | `GrowthScreen.tsx` | 231 / 276 / 531 | 三处裸 `<Text>` | `mobile.growth.{week,streak,tags}.empty` |
 *   | `CategoriesScreen.tsx` | 145 | 裸 `<Text>` | `mobile.categories.empty` |
 *   | `TaskDetailSheet.tsx` | 462 | 裸 `<Text>` | `mobile.detail.tags.empty` |
 *   | `ListsSection.tsx` | 126-127 | `emptyText` / `emptyHint` prop | `mobile.lists.empty(.hint)` |
 *   | `TagsSection.tsx` | 112-113 | `emptyText` / `emptyHint` prop | `mobile.tags.empty(.hint)` |
 *
 * ⚠️ 观察（**不是本门禁的判据**，但顺手记下来）：`dev/universal-slice.tsx:75`
 * 的 `emptyMessage="暂无任务"` 是**硬编码中文**，而 `check:ui-language` 的候选
 * 属性表里没有 `emptyMessage`（只有 `message`，且大小写不同），所以它今天没被
 * 任何门禁看到。要不要收编属于 i18n 那条线，不属于"空态只有一个"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么判据选"站点登记（只减不增）"而不是"文案 key 只许来自某一族"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * §5 给的判据是"`web.empty.*` 之外的'空'文案不许出现在视图里"。**照字面执行 =
 * 立刻全红**：那一族不存在，而现有 49 个 `*.empty*` 词条散在 20 多个前缀下。
 * 改 key 名是**业务改动**（任务书明说不要动业务代码），而且改 key 并不减少
 * 任何一处手写空态 —— 它只是把同一个问题换了个名字。
 *
 * 所以本门禁钉住的是**实现**这一侧（`§3 判据 3` 真正说的那件事）：
 *
 *   · **断言 A**：三个"实现"锚点必须真的被扫到（两端 + **共享权威定义**）。
 *   · **断言 B**：手写空态**站点**冻结在登记表上 —— 新增一处 → 红；
 *     收编一处（站点消失）→ 提示从登记表删掉。登记表是一份**债务账**，不是白名单。
 *   · **断言 C**：全仓 `EmptyState` 的**定义**只许有一处**权威**定义 ——
 *     即共享层的 `packages/ui/src/empty-state/EmptyState.tsx`；两端的两个定义
 *     被登记为**待转发的债**（PENDING_THIN_FORWARD）。除这三处之外的任何定义
 *     → 红。
 *
 * 三者合起来就是"**新的空态不许在视图里手写**"的可执行形式。
 * `packages/ui` 的共享 `EmptyState` 已经落地（2026-09-28），所以断言 C 的
 * 目标形状从"钉住 2 处不许再多"升级成"**共享层必须有定义，两端的定义
 * 只许作为待转发存在**"。
 *
 * ⚠️ **断言 C 为什么会因为这条改动而变红，而不是变松**：见 `PENDING_THIN_FORWARD`
 * 上方的长注释。一句话：它的扫描范围**多了一个 `packages/ui/src`**
 * （收编前那里整个不在范围内，可以长出任意多个定义而门禁全绿），
 * 同时对"权威定义"加了三条**新增**的硬要求（必须存在 / 必须导出出去 /
 * 不许 import i18n）。宽的一项（允许两端的定义临时留下）换来的是三条更严的，
 * 而且那两处**在账上**、有明确的下场。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 匹配不到就跳过，是禁止的
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 见 `check-pricing-consistency.mjs` 文件头。这里的落地是**断言 A**：
 * web 壳的 `ht-empty` 骨架、mobile kit 的 `EmptyState`、以及共享层的权威
 * 定义**必须**扫到；扫不到 → 报错，而不是"没有违规"。若只把骨架类改名
 * （`ht-empty` → `ht-blank`），登记表里的站点会集体消失 —— 那时断言 A 会红，
 * 因为壳的那个锚点也没了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 故障注入（已实测，都能红；注入跑在 `HEYTA_CHECK_ROOT` 副本上，不动工作区）
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   E1  把 `App.tsx` 的 `ht-empty` 改名（判据锚点失效）        → 断言 A 红
 *   E2  新建 `features/foo/FooView.tsx` 手写一个 `ht-empty` 块 → 断言 B 红
 *   E3  在 `features` 里再加一个 `function EmptyState(`       → 断言 C 红
 *   E4  删掉 `apps/mobile/src/ui/kit.tsx` 的 `EmptyState`     → 断言 A 红
 *   E5  删掉共享权威定义（`packages/ui/src/empty-state/…`）    → 断言 A + 断言 C 红
 *   E6  把权威定义改成 import `@heyta/i18n`                    → 断言 C 红
 *   E7  把 `packages/ui/src/index.ts` 的导出删掉               → 断言 C 红
 *   E8  在 `packages/ui/src` 再放一份 `EmptyState` 定义       → 断言 C 红
 *      （这一条在收编**之前**是**绿的** —— `packages/ui` 不在扫描范围里。
 *       它证明的是本次改动是**收紧**：范围缺口被补上了。）
 *
 * 用法：node scripts/check-empty-state.mjs
 *   非零退出 = 有违规。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-pricing-consistency.mjs` 同一个约定 ——
 * 只给**故障注入探针**用（把门禁跑在 `/tmp` 的副本上，不动共享工作区）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.expo', '.turbo']);

/**
 * 扫描范围。
 *
 * `web` 含 `dev/`：它是共享切片的手工演示页，**也是**一个真的会渲染空态的地方
 * （`emptyMessage="暂无任务"`）。把它排除会让"范围缺口静默失效"再次发生
 * —— 那是 AGENTS.md M0-4 记过的形状。
 */
const SCOPES = [
  { label: 'web', roots: ['apps/web/src/features', 'apps/web/src/App.tsx', 'apps/web/src/dev'] },
  { label: 'mobile', roots: ['apps/mobile/src/screens', 'apps/mobile/src/ui/kit.tsx'] },
];

/**
 * 🔴 "实现"锚点（**三处**：共享权威 + 两端待转发的债）。扫不到 = 判据失效，
 * **不是通过**。
 *
 * web 的 `EmptyState` 没有 export（`App.tsx:1044` 是模块内函数），
 * 所以锚点用"函数定义 + 骨架类"两条一起钉；mobile 的 kit 与共享层都是 export 的。
 *
 * ⚠️ 共享层那一条的 `also` 是 `useHeytaTokens(`：它不是"顺手也查一下"，
 * 而是钉住本组件**必须走 token** 这条契约（`check:design` 只拦裸值，
 * 拦不住"用 `StyleSheet` 拼死一个颜色"）。少了这次调用，颜色/间距就会
 * 退回字面量 —— 而那正是共享层最不能犯的错：**一次错四个端**。
 */
const IMPLEMENTATIONS = [
  {
    file: 'packages/ui/src/empty-state/EmptyState.tsx',
    label: '共享层的空态权威实现',
    must: /export\s+function\s+EmptyState\s*\(/,
    also: /useHeytaTokens\s*\(/,
    why:
      '它是全仓**唯一权威**的空态定义（L2，四个端共用）。断言 C 把它的路径 ' +
      '登记为 AUTHORITATIVE_DEFINITION —— 锚点在这里，权威判定也在那里，' +
      '两者不能各写一份路径字面量，否则改一处漏一处且不报错。',
  },
  {
    file: 'apps/web/src/App.tsx',
    label: 'web 壳的空态骨架（待转发）',
    must: /function\s+EmptyState\s*\(/,
    also: /ht-empty/,
    why: '它是收编前 web 上唯一一处空态骨架（L3 外壳）。**登记为待转发** —— 收编后应只剩"从 @heyta/ui 导入 + 传文案"。',
  },
  {
    file: 'apps/mobile/src/ui/kit.tsx',
    label: 'mobile kit 的空态组件（待转发）',
    must: /export\s+function\s+EmptyState\s*\(/,
    why: '它是收编前 mobile 上唯一一处空态组件（L1/L2 kit）。**登记为待转发** —— 同上。',
  },
];

/**
 * 空态站点的**形态分组**。每组是一个 marker；组名会出现在报告里。
 *
 * 这张表与下面的 `EMPTY_SITES` 一起构成**债务账**：新增文件/新形态 → 红。
 * 组名用中文是为了让红的时候能直接说清"你又手写了一个什么形状的空态"。
 *
 * 🔴 `直接渲染空态词条` **不是**"看到 `t('…empty…')` 就算"。
 * 那样会误报 —— 实测有两处 key 名字里有 `empty`、但**不是页面空态**：
 *
 *   · `web.conflict.payload.empty`（`ConflictDialog.tsx:70`）——
 *     冲突载荷预览里的「（空）」占位符；
 *   · `web.export.markdown.empty`（`export-copy.ts:36`）——
 *     导出到 Markdown **文件**里的「（没有任务）」标签，文案根本不在页面上。
 *
 * 误报的代价不是"多两行输出"，是**有人来放宽这条判据**，然后真的空态也拦不住
 * （本仓库反复吃过的形状）。所以这两条**显式排除并写明理由**，
 * 而不是把 marker 收窄到"只在 JSX 里" —— 后者会漏掉 `AiToolRun` 那种
 * 从函数返回值里渲染空态的真站点。
 *
 * ⚠️ 判据是**key 的"段"**：`/(^|\.)empty(\.|$)/i` —— 所以
 * `web.capture.previewEmpty`（预览占位）与 `web.ai.failure.breakdown.emptyTitle`
 * （失败原因）都**不算**空态。这是刻意的：它们不是"这个列表没有内容"。
 */
const EMPTY_KEY_CALL = /\bt\(\s*'([^']+)'/g;
const EMPTY_KEY_SEGMENT = /(^|\.)empty(\.|$)/i;
const NOT_AN_EMPTY_STATE = new Map([
  ['web.conflict.payload.empty', '冲突载荷预览里的「（空）」占位符，不是页面空态'],
  /**
   * M3 第四刀（sync）：移动端的**同一条**占位符。
   *
   * 它本来住在 `apps/mobile/src/sync/conflict-view.ts`（那个目录不在任何
   * SCOPES 里，所以从来没被扫到）；这一刀把冲突面板搬进共享层、宿主改成
   * `apps/mobile/src/screens/ConflictSheet.tsx` —— 词条从"不被扫的文件"
   * 挪进了"被扫的文件"，于是它以**新站点**的身份出现。
   *
   * 🔴 语义上它与上面那条逐字相同：`ConflictResolutionView` 用它渲染
   * "这一侧的载荷是空的"（`{kind:'empty'}`），**不是**"这个列表没有内容"。
   * 也就是说这不是"新增一处空态"，是**同一个占位符换了个位置**。
   * 与 `web.conflict.payload.empty` 成对登记，判据一点没松：
   * 任何*别的* `*.empty*` 词条在屏幕里直接渲染仍然会红（故障注入实测）。
   */
  ['mobile.conflict.payload.empty', '冲突载荷预览里的「（空）」占位符，不是页面空态'],
  ['web.export.markdown.empty', '导出到 Markdown 文件里的「（没有任务）」标签，不在页面上'],
]);

const SITE_MARKERS = [
  { kind: '骨架类', test: (src) => /ht-empty/.test(src) },
  { kind: '空槽位类', test: (src) => /__empty\b/.test(src) },
  { kind: '空态 testid', test: (src) => /data-testid\s*=\s*["'][^"']*empty/.test(src) },
  {
    kind: '直接渲染空态词条',
    test: (src) => {
      for (const m of src.matchAll(EMPTY_KEY_CALL)) {
        if (!EMPTY_KEY_SEGMENT.test(m[1])) continue;
        if (NOT_AN_EMPTY_STATE.has(m[1])) continue;
        return true;
      }
      return false;
    },
  },
  { kind: '空态文案 prop', test: (src) => /\b(?:emptyText|emptyHint|emptyMessage)\s*=/.test(src) },
];

/**
 * 🔴 登记表：**今天的**手写空态站点。只减不增。
 *
 * 每一项都是**债**，不是许可 —— 修法是让视图改用一个共享的 `EmptyState`
 * （`packages/ui` 的那个还不存在，所以 M3 的第一件事是造它）。
 * 用带日期的注释记来历，与 `check-row-single-source.mjs` 的
 * `HT_FAMILY_BASELINE` 同一个形状。
 *
 * 唯一不是债的那一条是 web 壳自己的骨架（`App.tsx`）—— 那是 L3 的合规位置。
 */
const EMPTY_SITES = {
  骨架类: [
    'apps/web/src/App.tsx', // L3 壳层：这就是 web 的"唯一实现"，不是债
    'apps/web/src/features/trash/TrashView.tsx', // 债：手抄了同一套骨架
  ],
  空槽位类: [
    'apps/web/src/features/motivation/GrowthView.tsx',
    'apps/web/src/features/motivation/IdentityTagList.tsx',
  ],
  '空态 testid': [
    'apps/web/src/features/settings/ImportPanel.tsx',
    'apps/web/src/features/settings/MemoryPanel.tsx',
    'apps/web/src/features/settings/PasskeyPanel.tsx',
    'apps/web/src/features/timeline/GanttChart.tsx',
    'apps/web/src/features/timeline/TimelineView.tsx',
    'apps/web/src/features/trash/TrashView.tsx',
  ],
  直接渲染空态词条: [
    'apps/mobile/src/screens/GrowthScreen.tsx',
    'apps/mobile/src/screens/ListsSection.tsx',
    'apps/mobile/src/screens/TagsSection.tsx',
    'apps/mobile/src/screens/TaskDetailSheet.tsx',
    'apps/mobile/src/screens/TasksScreen.tsx',
    'apps/mobile/src/screens/TrashScreen.tsx',
    'apps/web/src/features/ai/AiToolRun.tsx',
    'apps/web/src/features/auth/AuthPanel.tsx',
    /**
     * M3 第三刀（categories）：`CategoryBreakdown.tsx` 那一处**已收编** ——
     * 泳道 / 空态 / 区间 / 未归类全部搬进 `@heyta/ui` 的 `CategoryReportView`
     * （与 mobile 同一份）。但 web 的**文案构造器**留在
     * `features/categories/copy.ts`（共享层不许 import i18n，模板必须在宿主侧），
     * 所以那一条 `t('web.categories.empty')` 落到了这个文件 —— 这是**同一笔债
     * 换了个位置**，不是新增：登记表净减 2 处（本文件 + mobile 的
     * `CategoriesScreen.tsx` 各收编一处；web 的 `CategoryBreakdown.tsx`
     * 从「空槽位类」与「直接渲染空态词条」两栏一起消失）。
     *
     * ⚠️ 为什么不直接用共享 `EmptyState`：分类的空态是**一句话**
     * （"还没有可以归类的时间记录…"）。
     *
     * 🔴 **上面那条"做不到"的理由已经过期（同日修正）**：共享 `EmptyState`
     * 落地的形态是"**只有 `title` 必填**，`icon` / `hint` / `detail` 全部可选" ——
     * 只给一句时它渲染的就是居中一句，**不会**多出空槽位（空/纯空白会被
     * `empty-state/model.ts` 归一成 `undefined` 而不渲染，由
     * `tests/empty-state-model.spec.ts` 钉住）。所以这一处**可以**直接收编，
     * 唯一要做的就是把 `labels.empty` 换成 `<EmptyState title={…}/>`。
     * 它留在账上的理由只剩"谁来做"，不再有"做不到"。
     */
    'apps/web/src/features/categories/copy.ts',
    'apps/web/src/features/habits/HabitsView.tsx',
    'apps/web/src/features/motivation/GrowthView.tsx',
    'apps/web/src/features/motivation/IdentityTagList.tsx',
    'apps/web/src/features/settings/AiSettings.tsx',
    'apps/web/src/features/settings/MemoryPanel.tsx',
    'apps/web/src/features/settings/PasskeyPanel.tsx',
    'apps/web/src/features/timeline/GanttChart.tsx',
    'apps/web/src/features/timeline/TimelineView.tsx',
    'apps/web/src/features/trash/TrashView.tsx',
    /**
     * 便签 / 提醒（C-8 的 NOTE + B1-1 的 REMINDER 接上宿主入口那一刀）。
     *
     * 🔴 **这两条是真真正正的 +2，不是"同一笔债换了个位置"，别把它读成搬家。**
     * 便签与提醒在此之前**没有任何界面**（web 与 mobile 都是零）——
     * 所以这两个"空态文案站点"是随着功能一起新生的，账净增 2。
     * 记清楚这一点，是因为 `categories/copy.ts` 那一条的措辞是"**同一笔债换了
     * 个位置**、登记表净减 2 处"，与本条形状相同而性质相反。
     *
     * **为什么必须落在宿主侧（而不是"收编进共享 EmptyState 就完事"）**：
     * 空态的**渲染**已经收编了 —— `NotesBoard` 与 `ReminderList` 都在
     * `packages/ui` 里、两端共用同一份（web 的行内提醒面板与 mobile 的任务详情页
     * 渲染的是同一个组件）。剩下的这一条 `t('…empty…')` 是**文案**，
     * 而共享层**不许 import `@heyta/i18n`**（会拖进第二份 React，`check:mobile-bundle`
     * 盯着）—— 所以文案的构造只能在宿主侧。这与 `OrganizerList` 的
     * `labels.empty`、`ListsSection` / `TagsSection` 至今留在账上**是同一个理由**。
     *
     * ⚠️ **仍然不满足的地方，如实写在这里**：`NotesBoard` / `ReminderList`
     * 的空态是**自己拼的**（`styles.empty` + `<Text>`），没有走共享
     * `EmptyState` —— 与 `OrganizerList` 同形。但这一处**不能**照
     * `categories/copy.ts` 那条注释说的"直接把 `labels.empty` 换成
     * `<EmptyState title={…}/>`"照做：共享 `EmptyState` 是**页面级**的
     * （居中、带 icon/detail 槽位），而这两个空态是**区块级**的
     * （提醒列表在任务行的 `<details>` 里、便签板在「我的」页的一段里）。
     * 强行换成页面级组件是**视觉回归**，而本仓没有这两个端到端的视觉判据。
     * ⇒ 正确的下一步是**先定"区块级空态"要不要成为共享 `EmptyState` 的一档
     * （例如 `size?: 'page' | 'section'`）**，而不是把页面级组件塞进区块。
     * 这条已登记进 `docs/plans/site-and-parity-alignment.md` 的欠账。
     */
    'apps/web/src/features/notes/NotesView.tsx',
    'apps/web/src/features/reminders/ReminderPanel.tsx',
  ],
  '空态文案 prop': [
    /**
     * ⚠️ `ListsSection.tsx` / `TagsSection.tsx` 曾登记在这里，**已移除**
     * （2026-10-05，按本门禁自己的提示做的对账）。
     *
     * 这不是"放它们一马"：两家的空态在 M3 第九刀（projects）里换装共享
     * `OrganizerList` 之后，**prop 形态变了** —— 从 `emptyMessage=` 变成
     * `labels = { empty: …, emptyHint: … }`。于是 `'空态文案 prop'` 这一条
     * marker（`/\b(?:emptyText|emptyHint|emptyMessage)\s*=/`）不再匹配。
     * 它们**仍然**在 `直接渲染空态词条` 那一栏里、仍在账上 ——
     * 只是换了个 marker 归栏。⇒ 登记表去掉这两行是**把账记准**，
     * 不是把债还了；本门禁跑起来会自己提示这件事。
     */
    'apps/web/src/dev/universal-slice.tsx',
  ],
};

/**
 * 🔴 **唯一权威定义处**（断言 C）。它必须**真的有一处 `EmptyState` 定义**，
 * 必须从 `packages/ui` 的公开入口导出，且不许 import `@heyta/i18n`。
 *
 * 这三条都是**新增**的硬要求 —— 换句话说，这次改动**不是**把"2 处"改成
 * "3 处"了事：那两处宿主定义被换成了"必须有共享权威 + 宿主只许作为
 * 待转发存在"的合取条件。
 *
 * ⚠️ 这个常量同时被断言 A（锚点）与断言 C（权威判定）引用。**不要**在
 * 断言 A 里再写一遍路径字面量：改一处漏一处不会报错，只会让两道断言
 * 指向不同的文件（本仓库反复吃过的形状）。
 */
const AUTHORITATIVE_DEFINITION = 'packages/ui/src/empty-state/EmptyState.tsx';

/** 权威定义必须能从共享包的公开入口取到 —— 导不出去的"权威"等于不存在。 */
const SHARED_ENTRY = 'packages/ui/src/index.ts';
/** 入口里必须出现的那个 re-export 路径（不带扩展名的前缀即可）。 */
const SHARED_EXPORT_ANCHOR = /empty-state\/EmptyState\.js/;

/**
 * 🔴 **不许 import i18n** 是共享层的硬边界（`index.ts` 文件头 + `FocusPanel.tsx`
 * 文件头都写了理由）：i18n 包曾自己带一份 React，让 Android 产物出现两个
 * React 实例，报错位置离根因很远。`check:mobile-bundle` 盯的是打包产物，
 * 这里盯的是**源码**：等打包报错时，错误已经离根因很远了。
 */
const FORBIDDEN_SHARED_IMPORT = /from\s+['"]@heyta\/i18n(?:\/[^'"]*)?['"]/;

/**
 * 🔴 两端的 `EmptyState` 定义 —— **债，不是许可**。登记为"待转发"。
 *
 * 这是本次门禁改动里唯一看起来"变宽"的一项：从"只许 2 处定义"变成
 * "2 处宿主定义 + 1 处共享定义"。**它不是放宽**，理由是三条，每条都可查：
 *
 *   1. **覆盖面只增不减。** 断言 C 的扫描范围新增了 `packages/ui/src`。
 *      收编之前那里**整个不在范围内** —— 可以在共享层写任意多个
 *      `EmptyState` 定义而门禁全绿（注入 E8 实测：改前绿、改后红）。
 *   2. **新增了三条对权威定义的硬要求**：必须存在、必须导出、
 *      必须不 import i18n。这三条在收编前**一条都没有**（那时共享层
 *      根本没有定义，没有任何东西可查）。
 *   3. **围栏没有开口。** 两处宿主定义不是"允许的第三处定义"，而是
 *      **点名登记、有明确下场**的债务项：文件消失 → 红（与旧行为一致），
 *      文件之外多出任何定义 → 红（与旧行为一致），且它们被标注为
 *      `becomesAt`（收编后应变成薄转发）。判断依据仍是**集合相等**，
 *      不是"至少包含"。
 *
 * 换句话说：**把"2 处定义"换成"1 处权威 + 2 处登记在册的待转发"，
 * 同时多扫一个目录、多加三条硬要求。** 净效应是更严，不是更松。
 *
 * ⚠️ **不存在第三种状态**：任何不在下面两个文件里的定义都会被判为
 * "未登记的定义"。想要新增一处，正确的动作是**用共享实现**，
 * 而不是往这张表加一行。
 */
const PENDING_THIN_FORWARD = [
  {
    file: 'apps/web/src/App.tsx',
    host: 'web 壳',
    /** 收编后这一处应当只剩：从 `@heyta/ui` 导入 `EmptyState` + 把 4 个槽位传进去。 */
    becomesAt: '把 `ht-empty` 三件套换成 `<EmptyState …/>`（`web.shell.empty.*` 仍在宿主侧取）',
    why: '它现在是 L3 外壳里的完整实现（含 filter → 文案 key 的映射）。那段映射属于宿主，骨架不属于。',
  },
  {
    file: 'apps/mobile/src/ui/kit.tsx',
    host: 'mobile kit',
    becomesAt: '把函数体换成 `<EmptyState …/>`（或直接 re-export 共享实现）',
    why: '它是 mobile 自己的 kit 组件，四个槽位与共享层已经一一对应 —— 收编成本最低的一处。',
  },
];
const PENDING_THIN_FORWARD_FILES = PENDING_THIN_FORWARD.map((entry) => entry.file);

/* ========================================================================
 * 工具
 * ====================================================================== */

function* walk(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.(tsx?|jsx?)$/.test(target) && !/\.(spec|test)\./.test(target)) yield target;
    return;
  }
  let entries;
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(target, name));
  }
}

const readIfExists = (rel) => {
  const abs = join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

/* ========================================================================
 * 断言 A：唯一实现的锚点
 * ====================================================================== */

let failed = false;
const anchorErrors = [];

console.log('─'.repeat(72));
console.log('断言 A：两端"唯一实现"的锚点必须真的存在');
console.log('─'.repeat(72));

for (const impl of IMPLEMENTATIONS) {
  const src = readIfExists(impl.file);
  if (src === null) {
    anchorErrors.push(`${impl.file} 不存在（${impl.label}）`);
    continue;
  }
  if (!impl.must.test(src)) {
    anchorErrors.push(`${impl.file} 里找不到 ${String(impl.must)}（${impl.label}）`);
    continue;
  }
  if (impl.also !== undefined && !impl.also.test(src)) {
    anchorErrors.push(`${impl.file} 里找不到 ${String(impl.also)}（${impl.label}）`);
    continue;
  }
  console.log(`✅ ${impl.label}：${impl.file}`);
}

/**
 * 🔴 骨架类锚点必须真的落到 `App.tsx` 上。
 *
 * 只查"文件里有 `function EmptyState`" 是不够的：如果有人把 `ht-empty`
 * 改名（判据锚点失效），函数还在，但**所有站点都会集体消失** ——
 * 而"集体消失"如果只是"没有违规"，这道门禁就永远绿了。
 */
{
  const appSrc = readIfExists('apps/web/src/App.tsx') ?? '';
  if (!/ht-empty/.test(appSrc)) {
    anchorErrors.push(
      'apps/web/src/App.tsx 里已经没有 `ht-empty` 骨架类 —— 站点的 marker 失效了',
    );
  }
}

if (anchorErrors.length > 0) {
  failed = true;
  console.error('\n🔴 锚点失效：');
  for (const e of anchorErrors) console.error(`   · ${e}`);
  console.error(
    `\n   ⇒ 这不是"没有违规"，是**这道检查已经不能做事了**（见文件头与\n` +
      `      check-pricing-consistency.mjs 文件头的同一条纪律）。\n` +
      `      修法：确认空态实现仍在原处；若只是改名，同步更新本脚本的\n` +
      `      IMPLEMENTATIONS / SITE_MARKERS / EMPTY_SITES。\n`,
  );
} else {
  console.log(
    `   三个锚点的意义见文件头：共享权威（L2，四个端）+ web 壳（L3）+ mobile kit（L1/L2）。`,
  );
}

/* ========================================================================
 * 断言 B：手写空态站点的登记表
 * ====================================================================== */

const found = new Map(); // kind → Set<rel>
const scannedFiles = [];

for (const scope of SCOPES) {
  for (const root of scope.roots) {
    if (!existsSync(join(ROOT, root))) {
      // 单个根不存在不立刻红（`dev/` 之类可能被清掉），但要报告 ——
      // 范围缺口不会报错，只会静默失效。
      console.error(`⚠️  ${scope.label} 的扫描根不存在，已跳过：${root}`);
      continue;
    }
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file);
      scannedFiles.push(rel);
      const src = readFileSync(file, 'utf8');
      for (const marker of SITE_MARKERS) {
        if (!marker.test(src)) continue;
        if (!found.has(marker.kind)) found.set(marker.kind, new Set());
        found.get(marker.kind).add(rel);
      }
    }
  }
}

console.log('');
console.log('─'.repeat(72));
console.log('断言 B：手写空态站点只减不增（登记表 = 债务账）');
console.log('─'.repeat(72));

if (scannedFiles.length === 0) {
  failed = true;
  console.error('🔴 一个视图源文件都没扫到 —— 范围缺口不会报错，只会静默失效。');
}

const newSites = [];
const goneSites = [];

for (const [kind, files] of Object.entries(EMPTY_SITES)) {
  const registered = new Set(files);
  const actual = found.get(kind) ?? new Set();
  for (const rel of actual) {
    if (!registered.has(rel)) newSites.push({ kind, rel });
  }
  for (const rel of registered) {
    if (!actual.has(rel)) goneSites.push({ kind, rel });
  }
}
// 登记表里没有的**形态**也是新增（新 marker）。
for (const [kind, actual] of found.entries()) {
  if (EMPTY_SITES[kind] === undefined) {
    for (const rel of actual) newSites.push({ kind: `${kind}（未登记的新形态）`, rel });
  }
}

if (newSites.length > 0) {
  failed = true;
  console.error(`🔴 有 ${String(newSites.length)} 处**新的**手写空态：\n`);
  for (const s of newSites) {
    console.error(`   ${s.rel}`);
    console.error(`      形态：${s.kind}`);
  }
  console.error(
    `\n   ⇒ "空态只有一个"（dida-view-unification.md §1.6 / §3 判据 3 / §5）。\n` +
      `      新的空态**不许在视图里手写骨架/文案** —— 用共享的 \`EmptyState\`：\n` +
      `        · mobile：\`apps/mobile/src/ui/kit.tsx\` 的 \`EmptyState\`；\n` +
      `        · web：目前**没有**可复用的空态组件（壳里那个没 export，\n` +
      `          共享层 packages/ui 只有 \`TaskList.emptyMessage\`，装不下 title+hint+icon）。\n` +
      `      ⚠️ 如果这一处确实需要新的空态，正确的动作是**先造共享组件**，\n` +
      `        而不是把本脚本的 EMPTY_SITES 加一行 —— 加一行 = 把这笔债合法化。\n` +
      `        确实必须登记时，在 EMPTY_SITES 里写清"为什么不能用共享实现"。\n`,
  );
} else {
  console.log(
    `✅ 没有新的手写空态（扫 ${String(scannedFiles.length)} 个文件，` +
      `${String([...found.values()].reduce((n, s) => n + s.size, 0))} 个登记站点）。`,
  );
}

if (goneSites.length > 0) {
  console.log(`\n⬇️  有 ${String(goneSites.length)} 个登记站点已消失（多半是被收编了 —— 这是好事）：`);
  for (const s of goneSites) console.log(`      [${s.kind}] ${s.rel}`);
  console.log('   建议：把它们从 EMPTY_SITES 里删掉，登记表才会继续是一份真账。');
}

/* ========================================================================
 * 断言 C：EmptyState 只有一个**权威**定义（共享层），两端只许作为待转发存在
 * ====================================================================== */

const DEFINITION_RE = /(?:^|\n)\s*(?:export\s+)?(?:function|const)\s+EmptyState\b/;

/**
 * 🔴 断言 C 的范围**比断言 B 宽一格**：它必须把 `packages/ui/src` 也扫进来。
 *
 * 断言 B 管的是"宿主视图里有没有手写空态"，`apps/**` 就够；断言 C 管的是
 * "组件**定义**在哪"，而共享层正是它该在的地方。收编之前这里是个**真的
 * 范围缺口**：`packages/ui` 整个不在任何 SCOPES 里，所以那里可以长出任意
 * 多个 `EmptyState` 定义而本门禁全绿（故障注入 E8）。补上它就是本次改动的
 * **收紧**部分 —— 缺口不会报错，只会静默失效。
 */
const DEFINITION_SCOPES = [
  ...SCOPES,
  { label: 'shared', roots: ['packages/ui/src'] },
];

const definitions = [];
for (const scope of DEFINITION_SCOPES) {
  for (const root of scope.roots) {
    if (!existsSync(join(ROOT, root))) continue;
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file);
      if (DEFINITION_RE.test(readFileSync(file, 'utf8'))) definitions.push(rel);
    }
  }
}

console.log('');
console.log('─'.repeat(72));
console.log('断言 C：EmptyState 只有一个权威定义（共享层），两端只许作为待转发存在');
console.log('─'.repeat(72));

const assertionCErrors = [];

/**
 * C-1：共享层必须有**唯一的**权威定义。
 * 这是新增要求 —— 收编前共享层根本没有定义，这一条无从谈起。
 *
 * ⚠️ 用 `AUTHORITATIVE_DEFINITION` 而不是重写一遍路径字面量：断言 A 用的是
 * 同一个常量，改一处漏一处不会报错。
 */
const sharedSrc = readIfExists(AUTHORITATIVE_DEFINITION);
if (sharedSrc === null) {
  assertionCErrors.push(
    `共享权威定义不存在：${AUTHORITATIVE_DEFINITION}\n` +
      `       它必须存在 —— 否则"空态只有一个"没有任何实现可指向。`,
  );
} else {
  if (!DEFINITION_RE.test(sharedSrc)) {
    assertionCErrors.push(
      `${AUTHORITATIVE_DEFINITION} 里没有 \`EmptyState\` 定义（文件在，但没有组件）。`,
    );
  }
  // C-2：权威定义必须能从共享包的公开入口取到。导不出去 = 没人能用它收编。
  const entrySrc = readIfExists(SHARED_ENTRY);
  if (entrySrc === null) {
    assertionCErrors.push(`共享包入口不存在：${SHARED_ENTRY}`);
  } else if (!SHARED_EXPORT_ANCHOR.test(entrySrc)) {
    assertionCErrors.push(
      `${SHARED_ENTRY} 没有导出 \`empty-state/EmptyState.js\` ——\n` +
        `       一个取不到的"权威定义"等于不存在：四个端只能各写一份（就是今天的问题）。`,
    );
  }
  // C-3：共享层不许 import i18n（会拖进第二份 React，见 FORBIDDEN_SHARED_IMPORT）。
  if (FORBIDDEN_SHARED_IMPORT.test(sharedSrc)) {
    assertionCErrors.push(
      `${AUTHORITATIVE_DEFINITION} import 了 \`@heyta/i18n\` ——\n` +
        `       共享层一旦拖进第二份 React，**四个端会同时中招**，而且症状\n` +
        `       （hooks 报 Invalid hook call）离根因很远。文案一律由宿主注入。`,
    );
  }
}

/**
 * C-4：两处宿主定义是**点名登记的债**。
 * 集合相等，不是"至少包含" —— 消失要红（旧行为），多出来也要红（旧行为）。
 */
for (const entry of PENDING_THIN_FORWARD) {
  if (!definitions.includes(entry.file)) {
    assertionCErrors.push(
      `登记为"待转发"的 ${entry.host} 定义不见了：${entry.file}\n` +
        `       若它已经收编成薄转发，就把这条从 PENDING_THIN_FORWARD 删掉\n` +
        `       （${entry.becomesAt}），登记表才会继续是一份真账。`,
    );
  }
}

/** C-5：除权威定义与两处待转发之外，任何 `EmptyState` 定义都是**又开一份方言**。 */
const unregisteredDefinitions = definitions.filter(
  (d) => d !== AUTHORITATIVE_DEFINITION && !PENDING_THIN_FORWARD_FILES.includes(d),
);

if (unregisteredDefinitions.length > 0) {
  assertionCErrors.push(
    `出现了未登记的 EmptyState 定义（第 ${String(unregisteredDefinitions.length + 1)} 份起）：\n` +
      unregisteredDefinitions.map((d) => `         ${d}`).join('\n') +
      `\n       ⇒ "一个组件一句话"（§1.6）。**加一个组件定义不是收编，是又开了一份方言** ——\n` +
      `         它会立刻与权威实现漂移，而且不会报错。\n` +
      `         修法：用 \`@heyta/ui\` 的 \`EmptyState\`（${AUTHORITATIVE_DEFINITION}）。\n` +
      `         **不要**把新文件加进 PENDING_THIN_FORWARD —— 那张表是待还的债，不是白名单。`,
  );
}

if (assertionCErrors.length > 0) {
  failed = true;
  console.error('🔴 断言 C 不通过：\n');
  for (const e of assertionCErrors) console.error(`   · ${e}\n`);
} else {
  console.log(`✅ 权威定义唯一：${AUTHORITATIVE_DEFINITION}`);
  console.log(`   ✅ 已从 ${SHARED_ENTRY} 导出；未 import \`@heyta/i18n\`；走 token。`);
  console.log(`   📌 登记在册的待转发（${String(PENDING_THIN_FORWARD.length)} 处，是**债**不是许可）：`);
  for (const entry of PENDING_THIN_FORWARD) {
    console.log(`      [${entry.host}] ${entry.file}`);
  }
  // 按 host 取名，不按下标 —— 表重排时输出不会跟着错位。
  const forwardFile = (host) =>
    PENDING_THIN_FORWARD.find((entry) => entry.host === host)?.file ?? '（未登记）';
  /**
   * ⚠️ 手写站点数**从账上现算**，不写字面量。
   * 上一版这里写死了"33 个"—— 而并行改 `apps/**` 的分支当轮就把账从 33 改成了 31，
   * 于是那句提示当场变成假话。**过期注释比没有注释更危险**（本仓库反复吃过的形状）。
   */
  const debtSites = Object.values(EMPTY_SITES).reduce((n, files) => n + files.length, 0);
  console.log(
    `\n   ⏭️  **下一步（不在本轮范围）**：把上面 ${String(PENDING_THIN_FORWARD.length)} 处收成薄转发，\n` +
      `      并把断言 B 账上的 ${String(debtSites)} 个手写站点逐个换成共享组件。收编的正确顺序：\n` +
      `        1. mobile kit（${forwardFile('mobile kit')}）：四个槽位已一一对应，函数体直接换；\n` +
      `        2. web 壳（${forwardFile('web 壳')}）：保留 filter → 文案 key 的映射（那是宿主语义），\n` +
      `           只把 \`ht-empty\` 三件套换成 <EmptyState/>；\n` +
      `        3. 账上的站点按 EMPTY_SITES 的分组逐个消掉，每消一个就从登记表删一行。\n` +
      `      ⚠️ 每收编一处都**必须**把该站点原有的 \`data-testid\` 传给 \`testID\` ——\n` +
      `         否则 e2e 的定位钩子与断言 B 的登记项会**同时**静默消失。\n` +
      `      ⚠️ 本轮**刻意不动** \`apps/**\`：那会让账上的站点同时需要迁移，\n` +
      `         而且会与并行改 apps 的分支撞车。`,
  );
}

console.log('');
if (failed) {
  console.error('🔴 「空态只有一个」门禁未通过。\n');
  process.exit(1);
}
console.log('✅ 空态：三道断言都通过。\n');
