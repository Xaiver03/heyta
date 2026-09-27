#!/usr/bin/env node
/**
 * 模块写入租约门禁
 * ==================
 *
 * ## 这个脚本解决的是一个**流程**问题，不是代码问题
 *
 * 三个 AI 模块（引擎 / 旅程 / 记忆）此前被写成"合并顺序 1 → 2 → 3"，
 * 于是必须**等前一个全部做完**才能唤醒下一个。真正把它们绑死的只有两类东西：
 *
 *   1. **同一份写入租约的重叠**（两个模块都允许改 `App.tsx`、两份词条表、
 *      `features/settings/**` 交叉）；
 *   2. **共用同一个检出目录**（谁没提交，谁就挡住别人的合并 —— 仓库里
 *      `docs/plans/motivation-and-progression.md` 已经实测过一次：
 *      主检出的未提交改动与本分支改动交集 7 个文件，git 直接拒绝合并）。
 *
 * 第 2 类只能靠 `git worktree`（一个模块一个目录）。第 1 类可以**变成门禁**：
 * 租约写在下面的 `LEASES` 里，任何模块都能在自己那条分支上跑一次，
 * 自证"我只动了我的文件" —— 不需要等任何人，也不需要人去肉眼比对。
 *
 * ## 用法
 *
 * ```bash
 * # 我在本分支上改的东西，是否都在模块 2 的租约内？
 * node scripts/check-module-boundaries.mjs --module 2 --rev origin/main
 *
 * # 三个模块一起看（谁越界了）
 * node scripts/check-module-boundaries.mjs --all --rev origin/main
 *
 * # 落地前体检：主检出脏文件 × 本分支改动文件，交集非空就别合并
 * node scripts/check-module-boundaries.mjs --premerge --rev origin/main
 * ```
 *
 * `--rev <rev>` 用 `<rev>...HEAD` 的三点差异（即"本分支相对分叉点改了什么"）。
 * 不传 `--rev` 时看**工作区未提交**的改动（`git status --porcelain`）。
 *
 * 退出码：0 = 全部在租约内；1 = 有越界（逐条列出）；2 = 用法错误。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * 每个模块的写入租约。
 *
 * - `allow`：glob 列表（`**` 跨目录、`*` 不跨 `/`）。
 * - `deny`：在 `allow` 命中之后**再排除**的东西。存在的唯一理由：
 *   `apps/web/src/features/settings/**` 与 `apps/web/tests/**` 是两个模块
 *   真实交叉的地方，与其在任务书里用一句话约定，不如在这里写成可执行的排除。
 * - `shared`：**多写者、只许追加**的文件。它们不冲突的前提是：
 *   谁都不许移动 / 重排 / 重命名已有键，且改动只发生在文件**各自的追加区**
 *   （git 对位置不同的纯追加会自动合并）。任务书里的实例：两份词条表。
 */
const LEASES = {
  1: {
    name: '引擎层（packages/ai · local-api · app-host）',
    allow: [
      'packages/ai/src/**',
      'packages/ai/tests/**',
      'packages/local-api/src/**',
      'packages/local-api/tests/**',
      'packages/app-host/src/**',
      'packages/app-host/tests/**',
    ],
    deny: [],
    shared: [],
  },
  2: {
    name: '旅程层（apps/web 的 AI 面板与设置）',
    allow: [
      'apps/web/src/features/ai/**',
      'apps/web/src/features/settings/**',
      'apps/web/src/App.tsx',
      'apps/web/tests/**',
      'e2e/tests/ai-*.spec.ts',
      'e2e/tests/helpers.ts',
      'packages/i18n/src/locales/zh-CN.ts',
      'packages/i18n/src/locales/en.ts',
    ],
    // 模块 3 的租约里有这两处 —— 交集必须为空，所以在这里排掉。
    deny: [
      'apps/web/src/features/settings/MemoryPanel.tsx',
      'apps/web/src/features/settings/preference-copy.ts',
      'apps/web/tests/memory-panel.spec.tsx',
    ],
    shared: ['packages/i18n/src/locales/zh-CN.ts', 'packages/i18n/src/locales/en.ts'],
  },
  3: {
    name: '记忆护城河（packages/domain · MemoryPanel）',
    allow: [
      'packages/domain/src/memory.ts',
      'packages/domain/src/preference-hints.ts',
      'packages/domain/tests/memory.spec.ts',
      'apps/web/src/features/settings/MemoryPanel.tsx',
      'apps/web/src/features/settings/preference-copy.ts',
      'apps/web/src/lib/oplog.ts',
      'apps/web/tests/memory-panel.spec.tsx',
      'packages/i18n/src/locales/zh-CN.ts',
      'packages/i18n/src/locales/en.ts',
    ],
    deny: [],
    shared: ['packages/i18n/src/locales/zh-CN.ts', 'packages/i18n/src/locales/en.ts'],
  },
};

/**
 * `App.tsx` 的处理方式（本轮定死，写在这里免得又被"一句话约定"绑住）：
 *
 * 🔴 它的**唯一 owner 是模块 2**（模块 3 的租约里已经不含它）。
 * 模块 3 需要它配合时**不许自己改**，只有三条路：
 *   1. 用**已经存在**的 prop / context 接进去（`MemoryPanel` 已经有 `memorySlot`）；
 *   2. 在自己的组件里自己订阅 store（`MemoryPanel` 本来就能读）；
 *   3. 需要新 prop 时，在**开工前**由模块 2 一行预埋（pre-land），
 *      预埋提交落在分叉点之前 —— 那样三个模块依然是纯并行。
 *
 * 第 3 条是"接口先行"：把一个共享文件的改动**提前到分叉点之前**，
 * 它就不再是共享冲突，而是一份契约。这比"合并顺序"便宜得多。
 */

// ─────────────────────────────────────────────────────────────────────────
// glob → RegExp（只支持本文件需要的两种记法：`**` 与 `*`）
// ─────────────────────────────────────────────────────────────────────────

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withDoubleStar = escaped.replace(/\*\*/g, '\u0000');
  const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*');
  return new RegExp(`^${withSingleStar.split('\u0000').join('.*')}$`);
}

function matchesAny(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

// ─────────────────────────────────────────────────────────────────────────
// 取改动文件
// ─────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **只去尾部换行，不要 `trim()`。**
 *
 * `git status --porcelain` 的第一行用**前导空格**表示"未暂存的修改"
 * （` M AGENTS.md`）。`trim()` 会把这个空格吃掉，于是 `slice(3)`
 * 从第 4 个字符开始切，文件名第一个字母被砍掉（实测：`AGENTS.md` → `GENTS.md`）。
 */
function git(args, { trim = true } = {}) {
  const out = execFileSync('git', args, { encoding: 'utf8' });
  return trim ? out.trim() : out.replace(/\n+$/, '');
}

function changedInWorktree() {
  const out = git(['status', '--porcelain'], { trim: false });
  if (out === '') return [];
  return out
    .split('\n')
    .map((line) => {
      const rest = line.slice(3);
      // 重命名/拷贝是 `old -> new`：两边都算改动。
      const arrow = rest.indexOf(' -> ');
      return arrow === -1 ? [rest] : [rest.slice(0, arrow), rest.slice(arrow + 4)];
    })
    .flat()
    .map((path) => path.replace(/^"|"$/g, ''))
    .filter((path) => path !== '');
}

function changedVsRev(rev) {
  const out = git(['diff', '--name-only', `${rev}...HEAD`]);
  return out === '' ? [] : out.split('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { module: undefined, all: false, premerge: false, rev: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--module') args.module = Number(argv[++i]);
    else if (arg === '--all') args.all = true;
    else if (arg === '--premerge') args.premerge = true;
    else if (arg === '--rev') args.rev = argv[++i];
    else return { error: `无法识别的参数：${arg}` };
  }
  if (!args.all && !args.premerge && ![1, 2, 3].includes(args.module)) {
    return { error: '需要 --module <1|2|3> 或 --all 或 --premerge' };
  }
  return args;
}

function checkModule(moduleNumber, files) {
  const lease = LEASES[moduleNumber];
  const violations = files.filter(
    (file) => !matchesAny(file, lease.allow) || matchesAny(file, lease.deny),
  );
  const touchedShared = files.filter((file) => lease.shared.includes(file));

  console.log(`模块 ${String(moduleNumber)}：${lease.name}`);
  console.log(`  改动 ${String(files.length)} 个文件`);

  if (touchedShared.length > 0) {
    console.log(
      `  ℹ️  其中 ${String(touchedShared.length)} 个是**共享追加**文件（多写者）：${touchedShared.join('、')}`,
    );
    console.log('     约束：只许追加，不许移动/重排/重命名已有键。');
  }

  if (violations.length === 0) {
    console.log('  ✅ 全部在租约内');
    return 0;
  }
  console.log(`  ❌ 越界 ${String(violations.length)} 个：`);
  for (const file of violations) {
    console.log(`     - ${file}`);
  }
  console.log('     （要么改到租约内，要么在任务书里把租约改对 —— 不要两头都做）');
  return 1;
}

function premerge(files) {
  const mainDirty = changedInWorktree();
  const overlap = files.filter((file) => mainDirty.includes(file));
  console.log(`本分支改动 ${String(files.length)} 个文件；主检出未提交 ${String(mainDirty.length)} 个。`);
  if (overlap.length === 0) {
    console.log('✅ 交集为空 —— 可以落地。');
    return 0;
  }
  console.log(`❌ 交集 ${String(overlap.length)} 个文件（主检出脏 + 本分支也要改）：`);
  for (const file of overlap) console.log(`   - ${file}`);
  console.log('   主检出脏的时候连快进都会被拒。处置见 runbook 的「落地」一节。');
  return 1;
}

const args = parseArgs(process.argv.slice(2));
if (args.error !== undefined) {
  console.error(`用法错误：${args.error}`);
  console.error('用法：node scripts/check-module-boundaries.mjs --module <1|2|3> [--rev <rev>]');
  console.error('      node scripts/check-module-boundaries.mjs --all [--rev <rev>]');
  console.error('      node scripts/check-module-boundaries.mjs --premerge [--rev <rev>]');
  process.exit(2);
}

if (!existsSync('.git')) {
  console.error('请在仓库根目录运行（找不到 .git）。');
  process.exit(2);
}

const files = args.rev === undefined ? changedInWorktree() : changedVsRev(args.rev);
console.log(
  args.rev === undefined
    ? '比较基准：工作区未提交改动\n'
    : `比较基准：${args.rev}...HEAD\n`,
);

if (args.premerge) {
  process.exit(premerge(files));
}

if (args.all) {
  let code = 0;
  for (const moduleNumber of [1, 2, 3]) {
    code = Math.max(code, checkModule(moduleNumber, files));
    console.log('');
  }
  process.exit(code);
}

process.exit(checkModule(args.module, files));
