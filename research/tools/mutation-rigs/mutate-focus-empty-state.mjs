#!/usr/bin/env node
/**
 * 专注详情面空态那一处的变异臂（`scripts/check-empty-state.mjs` + jsdom + e2e 三层）。
 *
 * 它守的是 W7 那一格：空态收进共享 `EmptyState` 之后，**为什么不能改回手写骨架**、
 * **为什么 `testID` 与 `<HeytaUiProvider>` 是承重的**。这三条各有自己的失效形状，
 * 所以是三臂而不是一臂：
 *
 *   E1 把空态改回手写 `<p>` 骨架      → 只有 `check:empty-state` 红（且要点名文件）；jsdom 仍绿
 *   E2 摘掉 `testID="…-empty"` 那一行 → jsdom 红；`--e2e` 时 e2e 也红；门禁仍绿（它不看 testID）
 *   E3 摘掉 `<HeytaUiProvider>` 包装  → 只有**跑到**才红：jsdom 抛「useHeytaUiTheme 必须在
 *                                       <HeytaUiProvider> 内使用」，而类型检查与门禁都不会红
 *
 * 判定**按每臂的预期**走（不是"数红了几条"）：三臂全 OK 且 `FINAL_SAME=true` 才 exit 0。
 * 这条台子会真改 `apps/web` 的宿主源码，**没有还原证明的绿不算跑过**。
 *
 * 跑法（仓库根；linked worktree 里不要用 `pnpm run`，它先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-focus-empty-state.mjs
 *   node research/tools/mutation-rigs/mutate-focus-empty-state.mjs --e2e   # 补 E2 的浏览器腿
 *
 * ⚠️ 载体纪律：e2e 判据读的是 `apps/web/dist` ⇒ `--e2e` 会在每次变异后**重打**产物，
 *    跑完再用复原态重打一次。不带 `--e2e` 时那一腿打印 `NOT_JUDGED`，**不计入绿**
 *    （"没跑成的检查被读成绿"是本项目最贵的一类错）。
 * ⚠️ `--e2e` 会原地重写 `apps/web/evidence/focus-detail-pane/*.png`（提交态证据）⇒
 *    结束时打印 `EVIDENCE_DIRTY=<n>`；那不是这一臂的判据，要不要留由人决定。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const VIEW = 'apps/web/src/features/focus/FocusDetailPane.tsx';
const GATE = 'scripts/check-empty-state.mjs';
// 🔴 两层各有自己的同名文件，扩展名不同：jsdom 那份是 `.spec.tsx`（在 apps/web/tests/），
// e2e 那份是 `.spec.ts`（在 e2e/tests/）。第一版我把它们当成一个常量，于是浏览器腿
// 拿到一个不存在的文件过滤器 —— Playwright 回 `rc=1 / 0 passed / 0 failed`，
// 长得像"红了"而其实**一条都没跑**。所以现在分两个常量，并且那条腿先断言分母。
const SPEC_JSDOM = 'tests/focus-detail-pane.spec.tsx';
const SPEC_E2E = 'tests/focus-detail-pane.spec.ts';
const WITH_E2E = process.argv.includes('--e2e');

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const VIEW_PATH = path.join(ROOT, VIEW);
const ORIG = readFileSync(VIEW_PATH, 'utf8');
const ORIG_SHA = sha(VIEW_PATH);
console.log(`ROOT=${ROOT}`);
console.log(`CLEAN_SHA=${ORIG_SHA.slice(0, 16)} e2e_leg=${WITH_E2E ? 'JUDGED' : 'NOT_JUDGED'}`);

function restore() {
  writeFileSync(VIEW_PATH, ORIG, 'utf8');
  const now = sha(VIEW_PATH);
  if (now !== ORIG_SHA) {
    console.log(`RESTORE sha=${now.slice(0, 16)} MATCH=false`);
    process.exit(2);
  }
}

/** 变异只走"唯一命中"这一条路：命中 0 或 >1 都当场中止，不猜。 */
function mutate(needle, replacement, label) {
  const hits = ORIG.split(needle).length - 1;
  if (hits !== 1) {
    console.log(`ARM=${label} ABORT anchor_hits=${hits} expect=1`);
    restore();
    process.exit(2);
  }
  writeFileSync(VIEW_PATH, ORIG.replace(needle, replacement), 'utf8');
}

const ENV = { ...process.env, NO_COLOR: '1' };

function gateRun() {
  const r = spawnSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', env: ENV });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function jsdomRun() {
  const r = spawnSync('./node_modules/.bin/vitest', ['run', SPEC_JSDOM], {
    // 🔴 必须 cwd 到 apps/web：`--root` 不改 `process.cwd()`，而这一族里有四份 spec
    //    用 `process.cwd()` 读源码，会报成四个 ENOENT（长得像四个真缺陷）。
    cwd: path.join(ROOT, 'apps/web'),
    encoding: 'utf8',
    env: ENV,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function buildWeb() {
  const r = spawnSync('./node_modules/.bin/vite', ['build'], {
    cwd: path.join(ROOT, 'apps/web'),
    encoding: 'utf8',
    env: ENV,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function e2eRun() {
  const r = spawnSync('./node_modules/.bin/playwright', ['test', '-c', 'playwright.detail-pane.config.ts', SPEC_E2E], {
    cwd: path.join(ROOT, 'e2e'),
    encoding: 'utf8',
    env: ENV,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // 🔴 list reporter 的行首形状是 `  ✓  3 [chromium] › …` —— **标记在前、序号在后**。
  // 第一版我写成 `^\s*\d+\s+✓`（照抄了汇总行 `  6 passed` 的方向），于是两条计数恒 0，
  // 而恒 0 的计数长得像"没红"。分母改用汇总行那个数，逐条计数只做补充。
  const failed = (out.match(/^\s*✘\s+\d+/gm) || []).length;
  const passed = (out.match(/^\s*✓\s+\d+/gm) || []).length;
  const summary = (out.match(/^\s*\d+\s+(?:passed|failed|skipped)/gm) || []).join(' / ');
  const ran = /\d+\s+passed|\d+\s+failed/.test(out);
  return { rc: r.status ?? 1, out, ran, verdict: `FAILED=${failed} PASSED=${passed} 汇总[${summary}] 跑到=${ran}` };
}

const results = [];

// ── 对照趟：干净态两层都要绿（否则后面任何"红"都不是变异造成的）
{
  const g = gateRun();
  const j = jsdomRun();
  const ok = g.rc === 0 && j.rc === 0;
  console.log(`ARM=CLEAN gate=${g.rc} jsdom=${j.rc} VERDICT=${ok ? 'OK' : 'CONTROL_RED'}`);
  results.push(ok);
  if (!ok) {
    console.log('RIG_RESULT=CONTROL_RED（对照趟不绿，后面不判）');
    process.exit(2);
  }
}

// ── E1：手写骨架 ⇒ 只有门禁红，且必须点名文件
{
  const old = `        <HeytaUiProvider>
          <EmptyState
            size="section"
            title={t('web.focus.detail.recordsEmpty')}
            testID="focus-records-empty"
          />
        </HeytaUiProvider>`;
  const neu = `        <p className="ht-app__detail-empty ht-type-row-meta" data-testid="focus-records-empty">
          {t('web.focus.detail.recordsEmpty')}
        </p>`;
  mutate(old, neu, 'E1');
  const g = gateRun();
  const j = jsdomRun();
  const namesFile = g.out.includes(VIEW);
  const ok = g.rc !== 0 && namesFile && j.rc === 0;
  console.log(`ARM=E1 gate=${g.rc} 点名文件=${namesFile} jsdom=${j.rc} VERDICT=${ok ? 'OK' : 'NOT_AS_EXPECTED'}`);
  results.push(ok);
  restore();
}

// ── E2：摘掉 testID ⇒ jsdom 红；门禁不看 testID 所以仍绿；浏览器腿要重打产物才判
{
  mutate('            testID="focus-records-empty"\n', '', 'E2');
  const j = jsdomRun();
  const g = gateRun();
  let line = `ARM=E2 jsdom=${j.rc} gate=${g.rc}`;
  let ok = j.rc !== 0 && g.rc === 0;
  if (WITH_E2E) {
    const b = buildWeb();
    if (b.rc !== 0) {
      console.log(`ARM=E2 BUILD_FAILED rc=${b.rc}`);
      ok = false;
    } else {
      const e = e2eRun();
      const reached = e.out.includes('focus-records-empty');
      line += ` e2e_rc=${e.rc} ${e.verdict} 走到定位=${reached}`;
      // `ran` 在前：一条都没跑成的"红"不算红（那是载体没跑起来）。
      ok = ok && e.ran && e.rc !== 0 && reached;
    }
  } else {
    line += ' e2e=NOT_JUDGED';
  }
  console.log(`${line} VERDICT=${ok ? 'OK' : 'NOT_AS_EXPECTED'}`);
  results.push(ok);
  restore();
  if (WITH_E2E) buildWeb(); // 复原态再重打一次，别让 dist 停在变异体上
}

// ── E3：摘掉 provider ⇒ 只有跑到才红（类型检查与门禁都不会红）
{
  const before = readFileSync(VIEW_PATH, 'utf8');
  const openHits = before.split('        <HeytaUiProvider>\n').length - 1;
  const closeHits = before.split('        </HeytaUiProvider>\n').length - 1;
  if (openHits !== 1 || closeHits !== 1) {
    console.log(`ARM=E3 ABORT open=${openHits} close=${closeHits} expect=1/1`);
    restore();
    process.exit(2);
  }
  writeFileSync(
    VIEW_PATH,
    before.replace('        <HeytaUiProvider>\n', '').replace('        </HeytaUiProvider>\n', ''),
    'utf8',
  );
  const j = jsdomRun();
  const g = gateRun();
  const threw = j.out.includes('useHeytaUiTheme');
  const ok = j.rc !== 0 && threw && g.rc === 0;
  console.log(`ARM=E3 jsdom=${j.rc} Provider抛错=${threw} gate=${g.rc} VERDICT=${ok ? 'OK' : 'NOT_AS_EXPECTED'}`);
  results.push(ok);
  restore();
}

const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps/web/evidence'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean).length;
console.log(`EVIDENCE_DIRTY=${dirty}（--e2e 会重写提交态截图；不带 --e2e 时这一枚必须是 0）`);

const finalSame = sha(VIEW_PATH) === ORIG_SHA;
const passed = results.filter(Boolean).length;
console.log(`RIG_RESULT=${passed}/${results.length} FINAL_SAME=${finalSame}`);
process.exit(passed === results.length && finalSame ? 0 : 1);
