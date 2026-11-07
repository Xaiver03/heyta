#!/usr/bin/env node
/**
 * 「空态档位」账本门禁（R11 第 6 步）
 * ====================================
 *
 * 判据出处：`docs/plans/r11-state-tiers-gate-2026-11.md`（四条判据与账本形状）。
 * 上游盘点：`docs/plans/r11-states-audit-2026-11.md` —— 32 个容器里 **27 行「无判据」**，
 * 因为 `check-empty-state.mjs` 只判「这一处是不是手写」，**不判「哪一档」**：
 * 把某处的 `size` 从 `page` 换成 `card`、或 `section` 换成 `page`，rc 照样 0。
 *
 * 这里补的就是那一格：**账本制**（与 `check:settings-prose` 同一纪律）。
 *
 * | 判据 | 怎么才会红 |
 * |---|---|
 * | A | 账本里每一处的 `size` 必须与源码一致 | 改某处档位不改账本 ⇒ 红 |
 * | B | 源码里的每个 `EmptyState` 站点都必须在账本里 | 新加一处空态 ⇒ 红 |
 * | C | 账本里的每一行都必须还在源码里 | 删掉某处空态 ⇒ 红（防"账比现实长"） |
 * | D | `--self-test`：A/B/C 各注一次，断言该红的那条真红了 | 臂写错 ⇒ 红 |
 *
 * ⚠️ **射程**：只扫 `apps/**` 与 `packages/ui/src`（共享层也要扫 —— 盘点 §2.3 记着
 * `check-empty-state.mjs` 的 SCOPES 不含 `packages/ui/src`，那是另一个洞）。
 * 只认**显式 `size="…"`**：不写 size 的按默认 `page` 记账（本仓的默认值就写在
 * `empty-state/model.ts`，这里不抄第二份判断，只抄一个"没写就是 page"的**事实**）。
 *
 * 用法：
 *   node scripts/check-state-tiers.mjs               # 检查
 *   node scripts/check-state-tiers.mjs --self-test   # 四条臂
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const LEDGER = 'docs/plans/r11-state-tiers-ledger.md';

const SCAN_ROOTS = ['apps', 'packages/ui/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'Pods', '.git', '.worktrees', 'evidence']);

/**
 * 账本：`文件:锚点 | 档 | 容器 | 理由`。
 *
 * 🔴 「锚点」不是行号 —— 行号会漂（本仓为此写过两遍重定位脚本）。
 *    锚点是一段**能唯一确定这一处**的文本：要么是它的 `testID`，要么是它紧邻的那个
 *    函数的 `t('…key')`。判据按"文件里出现锚点"定位，不按行。
 */
/*
 * 账本：`文件 → 该文件**按出现顺序**排列的站点档位`。
 *
 * 🔴 不登记"锚点文本"，只登记"第几个站点是第几档"：
 *    - 锚点（`testID` / 词条 key）会随实现改写法而漂，而**档位**才是判据要钉的东西；
 *    - 顺序是稳定的 —— 往一个文件里**加**站点会立刻让数量对不上（判据 B），
 *      而那正是我们想让人回来看一眼的时刻。
 *
 * 「为什么是这一档」写在 `docs/plans/r11-state-tiers-ledger.md` 的表里（给人读的那份），
 * 脚本只认这里的档位数组。两份的关系：**脚本是判据，文档是理由**。
 */
const TIERS = new Map([
  // ── 页面档（居中、占页面高度）：内容区整块空掉的地方
  ['apps/web/src/App.tsx', ['page']],
  ['apps/web/src/features/inbox/InboxBell.tsx', ['page', 'page']],
  ['apps/web/src/features/inbox/InviteActivityCard.tsx', ['page']],
  ['apps/web/src/features/admin/AdminPanel.tsx', ['page']],
  // ── 卡片档（居中但紧凑、无插画）：面板 / 格子 / 卡片内的子列表
  ['packages/ui/src/calendar/CalendarBoard.tsx', ['page']],
  ['packages/ui/src/calendar/CalendarDayBoard.tsx', ['page']],
  ['packages/ui/src/timeline/GanttChart.tsx', ['page']],
  ['packages/ui/src/search/SearchPanel.tsx', ['page']],
  ['packages/ui/src/trash/TrashBoard.tsx', ['page']],
  ['packages/ui/src/timeline/TimelineBoard.tsx', ['page']],
  ['packages/ui/src/countdown/EventBoard.tsx', ['page']],
  ['packages/ui/src/notes/NotesBoard.tsx', ['page']],
  // ── 区块档（左对齐、不占页面高度）
  ['packages/ui/src/categories/CategoryReport.tsx', ['section']],
  ['apps/web/src/features/tags/TagsManager.tsx', ['section']],
  ['apps/web/src/features/habits/HabitsView.tsx', ['page']],
  ['apps/web/src/features/focus/FocusDetailPane.tsx', ['section']],
  ['apps/mobile/src/screens/SessionsSection.tsx', ['section']],
  ['apps/mobile/src/screens/SecurityScreen.tsx', ['section']],
  // ── 一行档（辅助信息，住在分组标签 / 设置行下面）
  ['apps/web/src/features/settings/InboundAutomationSettings.tsx', ['line', 'line']],
  ['apps/web/src/features/settings/SessionsPanel.tsx', ['page']],
  ['apps/web/src/features/tasks/TaskDetailCard.tsx', ['line']],
  ['apps/web/src/features/ai/AssistantPanel.tsx', ['line']],
  // ── 移动端（这一轮先如实登记现状，档位是否合适在账本文档里逐条标）
  ['apps/mobile/src/screens/TasksScreen.tsx', ['page', 'page', 'page']],
  ['apps/mobile/src/screens/HabitsScreen.tsx', ['page', 'page']],
  ['apps/mobile/src/screens/CountdownScreen.tsx', ['page', 'page']],
  ['apps/mobile/src/screens/ShareSpaceScreen.tsx', ['page', 'page', 'page']],
  ['apps/mobile/src/screens/NotificationsScreen.tsx', ['page', 'page', 'page']],
  ['apps/mobile/src/screens/AbandonedScreen.tsx', ['page']],
  ['apps/mobile/src/screens/GrowthScreen.tsx', ['page']],
  ['apps/mobile/src/ai/AssistantScreen.tsx', ['page']],
]);

const SIZE_RE = /<EmptyState\b[\s\S]{0,2000}?\/?>/gu;
const SIZE_ATTR_RE = /\bsize=\{?['"]([a-z]+)['"]\}?/u;

function collect() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (['.tsx'].includes(extname(name))) {
        const rel = relative(ROOT, full);
        // 测试里的 `<EmptyState>` 是夹具，不是站点（与 check-empty-state 同一射程口径）。
        if (!/(^|\/)tests?\//u.test(rel) && !/\.spec\.tsx$/u.test(rel)) out.push(rel);
      }
    }
  };
  for (const root of SCAN_ROOTS) walk(join(ROOT, root));
  return out;
}

/**
 * 把每个 `<EmptyState …>` 摊成 {file, size, text}。
 *
 * `text` 是该标签 + 后面 600 字符（锚点常写在 `title=` 或 `testID=` 上，
 * 也可能在紧邻的注释里；账本靠"文件里出现锚点"定位，不靠这里的切片）。
 */
export function sitesIn(file, source) {
  const out = [];
  // 抹注释：注释里提到 `<EmptyState size="line">` 不算站点（本文件头就有这样一句）。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, ' '));
  for (const match of code.matchAll(SIZE_RE)) {
    const size = SIZE_ATTR_RE.exec(match[0])?.[1] ?? 'page';
    out.push({ file, size, text: match[0] });
  }
  return out;
}

function scan() {
  const files = collect();
  const byFile = new Map();
  for (const rel of files) {
    const sites = sitesIn(rel, readFileSync(join(ROOT, rel), 'utf8'));
    if (sites.length > 0) byFile.set(rel, sites);
  }
  return byFile;
}

/**
 * 走账本：每个文件的站点数必须与账本数组等长，且逐位档位一致。
 *
 * 判据 A：档位不一致（改档不改账本）
 * 判据 B：账本外的文件 / 数量对不上（新增站点）
 * 判据 C：账本里的文件消失
 */
export function check(byFile) {
  const problems = [];
  for (const [file, expected] of TIERS) {
    const sites = byFile.get(file);
    if (sites === undefined) {
      problems.push({ rule: 'C', file, detail: '账本里的文件已经没有 EmptyState 站点了' });
      continue;
    }
    if (sites.length !== expected.length) {
      problems.push({
        rule: 'B',
        file,
        detail: `站点 ${sites.length} 个 vs 账本 ${expected.length} 个 —— 新增或删除了站点`,
      });
      continue;
    }
    sites.forEach((site, index) => {
      if (site.size !== expected[index]) {
        problems.push({ rule: 'A', file, detail: `第 ${index + 1} 个站点账本写 ${expected[index]}，源码是 ${site.size}` });
      }
    });
  }
  for (const [file, sites] of byFile) {
    if (!TIERS.has(file) && sites.length > 0) {
      problems.push({ rule: 'B', file, detail: `有 ${sites.length} 个 EmptyState 站点，但账本里没有这个文件` });
    }
  }
  return problems;
}

function selfTest() {
  const arms = [];
  const file = [...TIERS.keys()].find((f) => TIERS.get(f).length === 2);
  const expected = TIERS.get(file);

  const armA = new Map([[file, [{ file, size: 'page', text: '' }, { file, size: expected[1], text: '' }]]]);
  const armB = new Map([[file, expected.map((size) => ({ file, size, text: '' }))], ['apps/zz-nonexistent.tsx', [{ file: 'x', size: 'page', text: '' }]]]);
  const armC = new Map([[file, expected.map((size) => ({ file, size, text: '' }))]]);
  const truth = new Map([...TIERS].map(([f, tiers]) => [f, tiers.map((size) => ({ file: f, size, text: '' }))]));

  const cases = [
    ['真源（账本自己）', truth, 0],
    ['臂 A（改档不改账本）', armA, 1],
    ['臂 B（账本外的新站点）', armB, 1],
    ['臂 C（账本比现实长）', armC, 1],
  ];
  let ok = true;
  for (const [name, data, expectedProblems] of cases) {
    const got = check(data).length;
    const pass = expectedProblems === 0 ? got === 0 : got >= expectedProblems;
    arms.push(`${pass ? '✅' : '❌'} ${name} → ${got} 处`);
    if (!pass) ok = false;
  }
  console.log(arms.join('\n'));
  return ok;
}

const IS_ENTRY = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (IS_ENTRY) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
  const problems = check(scan());
  if (problems.length === 0) {
    console.log(`✅ 空态档位与账本一致（${TIERS.size} 行账本）。账本：${LEDGER}`);
    process.exit(0);
  }
  console.error(`🔴 空态档位账本不通过（${problems.length} 处）：`);
  for (const p of problems) console.error(`   [${p.rule}] ${p.file}：${p.detail}`);
  console.error(`\n账本：${LEDGER}（改档先改理由那一列）`);
  process.exit(1);
}
