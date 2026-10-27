#!/usr/bin/env node
/**
 * 工作树例外归属尺：把"只剩明确登记的例外，并写清为什么"这句话变成能失败的东西。
 * =================================================================
 *
 * ## 它拦哪一种事故
 *
 * 共享检出上长期有一批**不属于本会话**的未提交改动（别的会话正在写）。台账对此的写法是
 * "登记过的例外"，但那句是散文：脏集的成员**每分钟在换**（实测：一张逐枚归属表写成 4 分钟后
 * 就被现实改了两次），于是下一位只能重新人肉分一遍，而"人肉分一遍"这件事从来没有判据。
 * 这枚尺把分类本身钉下来：每一枚未提交的路径必须命中一条**带理由**的登记规则，
 * 命不中就是"没登记过的例外" —— 那才是本仓真正想拦的东西。
 *
 * ## 第二判：跨线依赖（归属表看不出来的那一类）
 *
 * 按路径归属会把一条线切成几堆，但**提交是按堆提的，import 是按文件解析的**。
 * 2026-10-28 实测到的形状：一枚已跟踪、已改动的界面文件 import 了一枚**还没进仓库**的新模块，
 * 而那枚新模块按路径归在**另一条线**的堆里 —— 于是"每一枚都登记了"这句完全成立，
 * 单独提交日历那一堆照样把 HEAD 提成半棵树（下一位拿到的是"代码引用一个仓库里没有的模块"）。
 * 所以除了归属，还须逐枚问：它引用的东西在 HEAD 里有没有？
 *
 * ## 为什么默认不红
 *
 * 它读的是**工作树状态**，不是仓库内容：干净检出上工作树必然为空，硬把它塞进 `check` 链
 * 只会得到一枚恒绿的门（比没有门更糟）。所以它是一条**给人跑的读数**，`--strict` 才把
 * "未登记"变成非零退出。
 *
 * ## 用法
 *
 *   node scripts/check-worktree-exceptions.mjs           # 逐条归属 + 点名未登记的 + 点名跨线依赖
 *   node scripts/check-worktree-exceptions.mjs --strict  # 有未登记**或**有跨线依赖 ⇒ exit 1
 *   node scripts/check-worktree-exceptions.mjs --self-test
 *
 * 规则表住在脚本里，登记正文（每一行为什么不归本线）在 `BLOCKED.md` 的 B238 那一节。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALLOWED_FLAGS = ['--strict', '--self-test'];

/**
 * 每条规则 = 一行归属 + 它凭什么这么归。
 * 前缀规则以 `/` 结尾表示**目录**；不带 `/` 的必须是完整路径（防"路径清单里混进目录"那一类坏条目）。
 */
export const OWNER_RULES = [
  {
    line: '全局 UX 分层整改线',
    why: '计划自写"状态：进行中"、尺还是未跟踪件、`package.json` 那两行要和它的脚本同一笔才不自相矛盾',
    prefixes: [
      'apps/web/src/styles/app/',
      'packages/design-system/generated/',
      'packages/design-system/src/generated/',
      'packages/design-system/src/tokens.css',
      'packages/design-system/src/tokens.ts',
      'packages/ui/src/overlay/',
      'apps/web/src/lib/form/',
      'packages/i18n/src/locales/',
      'apps/web/evidence/focus-visible-matrix/',
      'docs/agents/ux-principles.md',
      'docs/plans/global-ux-system-remediation.md',
      'docs/plans/README.md',
      'e2e/tests/focus-visible-matrix.spec.ts',
      'e2e/tests/rail-geometry.spec.ts',
      'e2e/tests/rail-roving.spec.ts',
      'e2e/tests/dirty-form-guard.spec.ts',
      'packages/ui/tests/overlay-dirty-popover.spec.ts',
      'scripts/check-focus-single-source.mjs',
      'package.json',
    ],
  },
  {
    line: '日历/详情面线',
    why:
      '壳里那一支、工具栏新引的图标、spec 里新的 testid 连成一条还没接完的线；提两枚留一枚 = 用例引用一个界面里不存在的控件。' +
      '🔴 2026-10-28 现量还多一条硬前提：`CalendarCapturePopover.tsx`（已跟踪）import 的 `apps/web/src/lib/form/useDirtyDismissGuard.tsx` **没入库**，' +
      '而那枚 hook 按路径归在 UX 线那一堆 —— 本组单独入库必然留下"代码引用仓库里没有的模块"（第二判会点名它）',
    prefixes: ['apps/web/src/App.tsx', 'apps/web/src/features/calendar/', 'e2e/tests/calendar-cells.spec.ts'],
  },
  {
    line: '不是任何人的改动：门禁自己的产物回执',
    why: '谁在这棵树上跑 `check:ai-e2e`，那批截图就被重写一次（traps #602）；代提交 = 把别人那一趟运行的产物按我的名义落仓',
    prefixes: ['apps/web/evidence/reminder-permission-final/'],
  },
  {
    line: '协作/同意面线',
    why: '同意面的四行条款与 ⓘ 触发件正在改（它自己写在这次未提交的 diff 里：那枚 `Pressable` 正则从文件第一枚起手 ⇒ 一枚永远绿的判据，正配着 `press-channel-gone-mobile` 那发变异臂在修）；这条线上还有三端共用的 i18n 同意面词条',
    prefixes: [
      'apps/mobile/tests/share-ui-assembly.spec.ts',
      'apps/mobile/src/screens/ShareSpaceScreen.tsx',
      'apps/mobile/src/screens/JoinShareScreen.tsx',
      'apps/web/src/features/share/',
      'packages/ui/src/sync/',
      'apps/web/tests/share-consent-modal-theme.spec.tsx',
      'e2e/tests/collab-journey.spec.ts',
      'scripts/verify-collab-journey.mjs',
      'scripts/verify-mobile-collab-ios.sh',
    ],
  },
  {
    line: '别线的变异台架（research/tools/mutation-rigs/）',
    why: '台架改的是它自己的判据臂，作者正在按读数调臂；这类文件的"对不对"只有那条线能判',
    prefixes: ['research/tools/mutation-rigs/'],
  },
  {
    line: '本线（注册登录标准套件线）在飞的这一笔',
    why:
      '这枚尺和它配套的台账正文，写它的那一刻必然在脏集里 —— 登记它不是"我的改动不用入库"，' +
      '是让"没登记过的例外"那一栏只报真正没人认领的路径（收口后本行应读 0 枚）。' +
      '`BLOCKED.md` **故意不进来**：它是几条线共用的取证账本，登记成"我的"会把别人没提交的那行一起洗掉',
    prefixes: ['scripts/check-worktree-exceptions.mjs', 'docs/plans/account-standard-suite.md', 'scripts/live-web-freshness.mjs'],
  },
];

export function parseArgs(argv) {
  const out = { strict: false, selfTest: false };
  const unknown = [];
  for (const a of argv) {
    if (a === '--strict') out.strict = true;
    else if (a === '--self-test') out.selfTest = true;
    else unknown.push(a);
  }
  return { ...out, unknown };
}

/** 规则表自检：目录前缀必须带斜杠、每条必须带理由。坏规则会让整把尺假绿，所以先判尺。 */
export function auditRules(rules) {
  const bad = [];
  for (const r of rules) {
    if (!r.why || String(r.why).trim().length < 12) bad.push(`${r.line}：理由缺失或过短`);
    for (const p of r.prefixes) {
      if (p.endsWith('/') && !path.posix.extname(p.slice(0, -1))) continue; // 目录规则
      if (path.posix.extname(p) === '') bad.push(`${r.line}：前缀 ${p} 既不是目录（缺尾斜杠）也不是带扩展名的文件`);
    }
  }
  return bad;
}

export function parsePorcelain(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => ({ xy: l.slice(0, 2), file: l.slice(3).split(' -> ').pop() }));
}

export function classify(entries, rules) {
  const rows = [];
  for (const e of entries) {
    const hit = rules.find((r) => r.prefixes.some((p) => (p.endsWith('/') ? e.file.startsWith(p) : e.file === p)));
    rows.push({ ...e, line: hit ? hit.line : null });
  }
  return {
    rows,
    unattributed: rows.filter((r) => !r.line),
    byLine: rules.map((r) => ({ line: r.line, n: rows.filter((x) => x.line === r.line).length })),
    checked: rows.length,
  };
}

/**
 * 只认相对说明符：`from './x'` 与副作用式 `import './x'`。
 * 裸包名（`react`）不在射程里 —— 它由 `check:layering` 与 lockfile 管，这枚尺只盯"仓库内的落点"。
 */
const RELATIVE_SPEC_RE = /(?:\bfrom|\bimport)\s*['"](\.[^'"]+)['"]/g;

const SCANNED_EXT = new Set(['.ts', '.tsx', '.mts']);

/** 一条相对说明符在本仓约定下可能的磁盘落点（`.js` 实际指向 `.ts`/`.tsx` 是本项目写法）。 */
export function candidateTargets(importer, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec));
  const out = [base];
  const ext = path.posix.extname(base);
  if (ext === '.js' || ext === '.mjs') {
    out.push(base.slice(0, -ext.length) + '.ts', base.slice(0, -ext.length) + '.tsx');
  }
  // 无扩展名的写法（`from './helpers'`）在本仓同样合法：不补这一档，别线的 spec 会整批假红
  //（2026-10-28 第一发就是这么错的：`e2e/tests/helpers.ts` 明明已入库，尺判它"落点上根本没有"）
  if (ext === '') out.push(`${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`);
  return out;
}

/**
 * 第二判：已跟踪、已改动的源码 import 了一枚没在 HEAD 里的模块。
 * `untracked` = 文件在这棵树上但没入库（同一趟提交里带上它才自洽）；
 * `dangling` = 磁盘上根本没有这个落点（比未跟踪更硬：谁都跑不动）。
 * 未跟踪的 importer 不扫 —— 它自己还没进仓库，和它的 target 同一笔提交就自洽。
 */
export function crossLineImports(entries, { read, isTracked, exists }) {
  const found = [];
  const seen = new Set();
  for (const e of entries) {
    if (e.xy.includes('?')) continue;
    if (!SCANNED_EXT.has(path.posix.extname(e.file))) continue;
    if (e.file.endsWith('.d.ts')) continue;
    let text;
    try {
      text = read(e.file);
    } catch {
      continue; // 读不到就跳过这枚，但**不**把它读成"没有跨线依赖"
    }
    for (const [, spec] of [...text.matchAll(RELATIVE_SPEC_RE)]) {
      const cands = candidateTargets(e.file, spec);
      if (cands.some((c) => isTracked(c))) continue;
      const onDisk = cands.find((c) => exists(c));
      const target = onDisk ?? cands[0];
      const key = `${e.file} ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ importer: e.file, target, kind: onDisk ? 'untracked' : 'dangling' });
    }
  }
  return found;
}

const SELF_TEST_ARMS = () => {
  const arms = [];
  const push = (name, got, want) => arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const E = (f) => ({ xy: ' M', file: f });

  push(
    '① 全命中 ⇒ 未登记 0 枚',
    classify([E('apps/web/src/App.tsx'), E('apps/web/src/styles/app/base.css')], OWNER_RULES).unattributed.length,
    0,
  );
  push(
    '② 有一枚没人登记 ⇒ 必须点名它（这才叫有牙）',
    classify([E('apps/web/src/App.tsx'), E('server/src/api.ts')], OWNER_RULES).unattributed.map((r) => r.file),
    ['server/src/api.ts'],
  );
  push('③ 空清单 ⇒ 判"干净"，不许判成"有例外"', classify([], OWNER_RULES), {
    rows: [],
    unattributed: [],
    byLine: OWNER_RULES.map((r) => ({ line: r.line, n: 0 })),
    checked: 0,
  });
  push('④ 目录规则要按前缀吃下整棵子树', classify([E('e2e/tests/dirty-form-guard.spec.ts')], OWNER_RULES).rows[0].line, '全局 UX 分层整改线');
  push('⑤ 规则表自己必须干净（现在这份必须无违规）', auditRules(OWNER_RULES), []);
  push(
    '⑥ 坏规则必须被拒：目录前缀缺尾斜杠 / 理由空',
    auditRules([{ line: 'X', why: '', prefixes: ['apps/foo'] }]).length,
    2,
  );
  push(
    '⑦ 完整路径规则不许把同名前缀的另一枚吃掉',
    classify([E('apps/web/src/App.tsx'), E('apps/web/src/App.tsx.bak')], OWNER_RULES).unattributed.map((r) => r.file),
    ['apps/web/src/App.tsx.bak'],
  );
  push('⑧ 未知旗标必须被拒', parseArgs(['--strict', '--bogus']).unknown, ['--bogus']);
  push('⑨ 行解析吃 XY 两列 + 路径，重命名取箭头后那头', parsePorcelain(' M a/b.ts\nR  old.ts -> new.ts'), [
    { xy: ' M', file: 'a/b.ts' },
    { xy: 'R ', file: 'new.ts' },
  ]);

  // 第二判的四臂：形状取自 2026-10-28 真实量到的那一枚（已跟踪的界面文件 import 一枚未入库的 hook）
  const IMP = 'apps/web/src/features/calendar/CalendarCapturePopover.tsx';
  const HOOK = 'apps/web/src/lib/form/useDirtyDismissGuard.tsx';
  const TXT = "import { useDirtyDismissGuard } from '../../lib/form/useDirtyDismissGuard.js';\nexport const X = 1;\n";
  const readMap = (m) => (f) => {
    if (m[f] === undefined) throw new Error('no such file');
    return m[f];
  };
  const mk = (tracked, onDisk) => ({
    read: readMap({ [IMP]: TXT }),
    isTracked: (f) => tracked.includes(f),
    exists: (f) => onDisk.includes(f),
  });
  const one = (xy) => [{ xy, file: IMP }];
  push(
    '⑩ 已跟踪代码 import 一枚未入库、但在树上的模块 ⇒ 必须点名（这正是"单独提一组=半棵树"）',
    crossLineImports(one(' M'), mk([], [HOOK])),
    [{ importer: IMP, target: HOOK, kind: 'untracked' }],
  );
  push('⑪ 同一枚 import 的 target 已经入库 ⇒ 不许点名（别线的模块进仓库了就不是例外）', crossLineImports(one(' M'), mk([HOOK], [HOOK])), []);
  push(
    '⑫ target 既不入库也不在树上 ⇒ 判 dangling，不许读成"没问题"',
    crossLineImports(one(' M'), mk([], [])).map((r) => r.kind),
    ['dangling'],
  );
  push('⑬ 未跟踪的 importer 自己不扫（它和 target 同一笔提交就自洽）', crossLineImports(one('??'), mk([], [HOOK])), []);
  push(
    '⑭ 无扩展名写法要解析到 .ts —— 别线的 spec 全用这种写法，解析不到就是一整批假红',
    crossLineImports(
      [{ xy: ' M', file: 'e2e/tests/rail-roving.spec.ts' }],
      {
        read: () => "import { openApp } from './helpers';\n",
        isTracked: (f) => f === 'e2e/tests/helpers.ts',
        exists: () => false,
      }
    ),
    [],
  );
  return arms;
};

const main = () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.unknown.length > 0) {
    console.error(`🔴 未知旗标：${opts.unknown.join(' ')} ｜ 这枚尺只认 ${ALLOWED_FLAGS.join(' / ')}`);
    process.exit(1);
  }
  if (opts.selfTest) {
    const arms = SELF_TEST_ARMS();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) {
      console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    }
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  const rulesBad = auditRules(OWNER_RULES);
  if (rulesBad.length > 0) {
    console.error('🔴 规则表自己不合格，这枚尺今天不许报"干净"：');
    for (const b of rulesBad) console.error(`   ${b}`);
    process.exit(1);
  }
  const entries = parsePorcelain(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }));
  const v = classify(entries, OWNER_RULES);
  if (v.checked === 0) {
    console.log('工作树干净：未提交 0 枚 ⇒ 没有例外需要登记。');
    process.exit(0);
  }
  console.log(`工作树例外归属 ｜ 未提交 ${v.checked} 枚 ｜ 规则 ${OWNER_RULES.length} 行`);
  for (const b of v.byLine) if (b.n > 0) console.log(`   ${String(b.n).padStart(3)} 枚 ← ${b.line}`);
  if (v.unattributed.length > 0) {
    console.log(`🔴 没登记过的例外 ${v.unattributed.length} 枚（这些才是"谁都可能顺手提交掉"的那批）：`);
    for (const u of v.unattributed.slice(0, 20)) console.log(`   ${u.xy} ${u.file}`);
    if (v.unattributed.length > 20) console.log(`   …另 ${v.unattributed.length - 20} 枚`);
  } else {
    console.log('   ⇒ 每一枚都归到某条已登记的理由；正文见 BLOCKED.md 的 B238 那一节。');
  }
  const trackedSet = new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim() !== '')
  );
  const cross = crossLineImports(entries, {
    read: (f) => readFileSync(path.join(ROOT, f), 'utf8'),
    isTracked: (f) => trackedSet.has(f),
    exists: (f) => existsSync(path.join(ROOT, f)),
  });
  if (cross.length > 0) {
    console.log(`🔴 跨线依赖 ${cross.length} 处：已跟踪的代码 import 了没在 HEAD 里的模块 ⇒ **单独提交 importer 那一组，HEAD 就是半棵树**`);
    for (const c of cross.slice(0, 20)) console.log(`   ${c.importer}\n      → ${c.target}（${c.kind === 'untracked' ? '在这棵树上，但没入库' : '落点上根本没有这枚文件'}）`);
    if (cross.length > 20) console.log(`   …另 ${cross.length - 20} 处`);
    console.log('   ⇒ 归属表按路径分堆，看不出这一类：两堆各自登记齐了，按堆提交照样红。');
  }
  process.exit(opts.strict && v.unattributed.length + cross.length > 0 ? 1 : 0);
};

main();
