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
 *   node scripts/check-worktree-exceptions.mjs --head --range b55e98807  # 第三判：那一笔以来落进 HEAD 的改动，自己是不是半棵树（只读对象库）
 *
 * 规则表住在脚本里，登记正文（每一行为什么不归本线）在 `BLOCKED.md` 的 B238 那一节。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALLOWED_FLAGS = ['--strict', '--self-test', '--head', '--range <ref>'];

/**
 * 每条规则 = 一行归属 + 它凭什么这么归。
 * 前缀规则以 `/` 结尾表示**目录**；不带 `/` 的必须是完整路径（防"路径清单里混进目录"那一类坏条目）。
 */
export const OWNER_RULES = [
  {
    line: '全局 UX 分层整改线',
    why: '计划自写"状态：进行中"、尺还是未跟踪件、`package.json` 那两行要和它的脚本同一笔才不自相矛盾；' +
      '01:1x 又并进一批 P2 的（危险确认档位、`apps/web/src/lib/dialog/`）—— 那批文件的头注释自己写着「2026-10-27，全局 UX 整改 P2」，归属是指了名的，不是我猜的',
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
      'scripts/check-dirty-form-policy.mjs',
      'docs/agents/overlay-feedback.md',
      'apps/web/evidence/dirty-form-guard/',
      'apps/web/src/features/categories/CategoryCreateDialog.tsx',
      'apps/web/src/features/habits/HabitsView.tsx',
      'apps/web/src/lib/dialog/',
      'apps/web/src/features/trash/TrashView.tsx',
      'apps/web/src/features/trash/purgeDanger.ts',
      'apps/web/tests/trash-purge-danger-tier.spec.ts',
      'e2e/tests/danger-confirm-trash.spec.ts',
      'scripts/check-danger-confirm.mjs',
      'package.json',
    ],
  },
  {
    line: '自动收集（inbound）线',
    why:
      '这条线的代码自己指名 ADR-0077 与托管抽取那一档；10-28 00:5x 现量：`inbound.routes.ts` 与那份 integration spec 正在改，' +
      '而 §6.101 那四格待拍板（同意继承、reasonCode 落库、词表校验分叉）全落在这一层 —— 代提交 = 替别人把未定的口径落仓',
    prefixes: [
      'packages/inbound-core/',
      'server/src/automation/',
      'server/src/ai/managed-completion.ts',
      'server/tests/integration/inbound-dual-host-fault-windows.integration.spec.ts',
      'docs/plans/inbound-automation.md',
      'docs/adr/0077-inbound-hosted-extraction-at-ingest.md',
    ],
  },
  {
    line: '各线共用的环境陷阱正文',
    why: '编号只增不改、谁踩坑谁追加：这一枚文件在脏集里只说明"某一行的正文还没入库"，作者随时在补；代提交 = 把别人未定稿的正文按我的名义落仓',
    prefixes: ['docs/reference/environment-traps.md'],
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
    line: '不是任何人的改动：已入库截图被门禁重写',
    why: '谁在这棵树上跑截图类门禁，已入库的那批 PNG 就被重写一次（traps #602）；代提交 = 把别人那一趟运行的产物按我的名义落仓。' +
      '🔴 这条**只吃已跟踪件的修改**（`skipUntracked`）：`apps/web/evidence/` 下新出现的文件是作者准备入库的真证据，' +
      '必须留在"没登记过"那一栏被点名 —— 按机制登记和按目录穷举的分别是：前者不随跑门禁的次数漂',
    prefixes: ['apps/web/evidence/'],
    skipUntracked: true,
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
  const out = { strict: false, selfTest: false, head: false, range: undefined };
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strict') out.strict = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--head') out.head = true;
    else if (a === '--range') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) unknown.push('--range（少了 ref）');
      else {
        out.range = v;
        i += 1;
      }
    } else unknown.push(a);
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
    const hit = rules.find(
      (r) => (r.skipUntracked && e.xy.includes('?') ? false : r.prefixes.some((p) => (p.endsWith('/') ? e.file.startsWith(p) : e.file === p)))
    );
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
 * 逐行抽出**真正的**相对引用语句：`import … from './x';` / `export … from './x';` / `import './x';`。
 * 两头都锚死（行首是关键字、说明符后面到行尾只剩 `;`），注释行先丢 —— 否则散文与断言字符串会灌进读数：
 * `--head` 第一发 381 处里，抽样三处全是这类（`pages.ts:59` 的注释、`theme.tsx:14` 的注释、
 * `note-edit.spec.ts:163` 那句 `expect(...).toContain("import … from './NoteEditScreen';")`）。
 */
export function extractRelativeSpecs(text) {
  const specs = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const m = /^(?:import|export)\b(?:[\s\S]*?\bfrom)?\s*['"](\.[^'"]*)['"]\s*;?\s*(?:\/\/.*)?$/.exec(t);
    if (m) specs.push(m[1]);
  }
  return specs;
}

const SCANNED_EXT = new Set(['.ts', '.tsx', '.mts']);

/**
 * 一条相对说明符在本仓约定下可能的磁盘落点。
 * 🔴 不许用 `extname()` 判扩展名：本仓有一批**带点的文件名**（`account-profile.store.ts`、
 * `websocket-connection.service.ts`），`extname` 会把 `.store` 当扩展名 ⇒ 候选一个都不补 ⇒
 * 已入库的模块被报成"HEAD 里没有"。这里改成"结尾是不是已知模块扩展名"。
 */
const MODULE_EXT_RE = /\.(ts|tsx|mts|js|mjs|json|css|scss)\b/;
const JS_LIKE_RE = /\.(js|mjs)$/;

export function candidateTargets(importer, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec));
  const out = [base];
  if (JS_LIKE_RE.test(base)) {
    const stem = base.replace(JS_LIKE_RE, '');
    out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  } else if (!MODULE_EXT_RE.test(base)) {
    out.push(`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`);
  }
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
    for (const spec of extractRelativeSpecs(text)) {
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

/** `git diff --name-only` 的输出 ⇒ 路径清单（空行丢掉；带引号的路径不去，本仓没有非 ASCII 路径的改名）。  */
export function parseNameList(text) {
  return text.split('\n').filter((l) => l.trim() !== '');
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
    '⑱ 带点的文件名要解析得到（`account-profile.store` 这族，extname 会把 `.store` 当扩展名）',
    crossLineImports(
      [{ xy: ' M', file: 'server/src/api.ts' }],
      {
        read: () => "import { withAccountProfile } from './account/account-profile.store';\n",
        isTracked: (f) => f === 'server/src/account/account-profile.store.ts',
        exists: () => false,
      }
    ),
    [],
  );
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
  push(
    '⑮ 路径清单解析要丢空行；--range 少了 ref 必须被拒（不许把 --head 读成"扫整棵树"）',
    [parseNameList('a/b.ts\n\nc/d.tsx\n'), parseArgs(['--head', '--range']).unknown, parseArgs(['--head', '--range', 'HEAD~5']).range],
    [['a/b.ts', 'c/d.tsx'], ['--range（少了 ref）'], 'HEAD~5'],
  );
  push(
    '⑯ 注释行与"断言里的 import 文本"都不许算引用（这就是 --head 第一发 381 处噪声的来源）',
    extractRelativeSpecs(
      [
        "// import x from './commented-out';",
        " * `import { VALUE } from './doc-text.js'` 不行。",
        `    expect(section).toContain("import { NoteEditScreen } from './NoteEditScreen';");`,
        "import { NoteEditScreen } from './NoteEditScreen';",
        "import { trailing } from './with-comment'; // 行尾注释不许把它读成'不是引用'",
        "import './side.css';",
      ].join('\n')
    ),
    ['./NoteEditScreen', './with-comment', './side.css'],
  );
  push(
    '⑰ `export … from` 那种再转发行也要吃到（锚死行尾不能把转发漏掉）',
    extractRelativeSpecs("export { createFoo } from './factory.js';\nexport * from './re-export-all';\n"),
    ['./factory.js', './re-export-all']
  );
  push(
    '⑲ 按机制登记的那条只吃已跟踪件的修改：新加的取证文件必须仍被点名（skipUntracked 的牙）',
    classify(
      [
        { xy: ' M', file: 'apps/web/evidence/whatever/old-shot.png' },
        { xy: '??', file: 'apps/web/evidence/whatever/new-shot.png' },
      ],
      OWNER_RULES
    ).unattributed.map((r) => r.file),
    ['apps/web/evidence/whatever/new-shot.png'],
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
  if (opts.head) {
    if (opts.range === undefined) {
      console.error('🔴 --head 必须带 --range <ref>：它只读对象库，分母就是 "git diff --name-only <ref>..HEAD"。');
      console.error('   整棵 HEAD 那一档我今天试过后撤掉了 —— 分母 1721 枚、286 处判不中，噪声两类（指向 `packages/*/dist/*` 这种构建产物、');
      console.error('   以及非语句式的 import 写法）都要真正的解析器才分得清。留一枚天生红的尺比不留更糟。');
      process.exit(1);
    }
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim() !== '');
    const headSet = new Set(names);
    const changed = parseNameList(
      execFileSync('git', ['diff', '--name-only', `${opts.range}..HEAD`, '--', '*.ts', '*.tsx', '*.mts'], { cwd: ROOT, encoding: 'utf8' })
    ).filter((f) => headSet.has(f)); // 范围里被删掉的文件不在 HEAD 里，扫它们没有意义
    const bad = crossLineImports(
      changed.map((file) => ({ xy: ' M', file })),
      {
        read: (f) => execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }),
        isTracked: (f) => headSet.has(f),
        exists: () => false,
      }
    );
    console.log(`HEAD 自洽 ｜ 范围 ${opts.range}..HEAD ｜ 这批里已入库的源文件 ${changed.length} 枚（HEAD 共 ${names.length} 枚）｜ 引用不到 HEAD 落点的 ${bad.length} 处`);
    for (const b of bad) console.log(`   ${b.importer}\n      → ${b.target}（HEAD 里没有这个落点）`);
    process.exit(opts.strict && bad.length > 0 ? 1 : 0);
  }
  const rulesBad = auditRules(OWNER_RULES);
  if (rulesBad.length > 0) {
    console.error('🔴 规则表自己不合格，这枚尺今天不许报"干净"：');
    for (const b of rulesBad) console.error(`   ${b}`);
    process.exit(1);
  }
  // 🔴 `core.quotepath=off`：默认写法会把非 ASCII 路径转义成 "view-\344\271\240…"，
  // 那种字符串跟任何前缀都拼不上 ⇒ 中文名的证据件会整批读成"没登记过"（2026-10-28 实测到过）。
  const entries = parsePorcelain(
    execFileSync('git', ['-c', 'core.quotepath=off', 'status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  );
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
