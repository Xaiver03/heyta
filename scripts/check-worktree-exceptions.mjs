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
 * ## 为什么默认不红
 *
 * 它读的是**工作树状态**，不是仓库内容：干净检出上工作树必然为空，硬把它塞进 `check` 链
 * 只会得到一枚恒绿的门（比没有门更糟）。所以它是一条**给人跑的读数**，`--strict` 才把
 * "未登记"变成非零退出。
 *
 * ## 用法
 *
 *   node scripts/check-worktree-exceptions.mjs           # 逐条归属 + 点名未登记的
 *   node scripts/check-worktree-exceptions.mjs --strict  # 有未登记 ⇒ exit 1
 *   node scripts/check-worktree-exceptions.mjs --self-test
 *
 * 规则表住在脚本里，登记正文（每一行为什么不归本线）在 `BLOCKED.md` 的 B238 那一节。
 */

import { execFileSync } from 'node:child_process';
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
    why: '壳里那一支、工具栏新引的图标、spec 里新的 testid 连成一条还没接完的线；提两枚留一枚 = 用例引用一个界面里不存在的控件',
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
  process.exit(opts.strict && v.unattributed.length > 0 ? 1 : 0);
};

main();
