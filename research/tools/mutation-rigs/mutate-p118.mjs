/**
 * P1-18 的变异装置：三臂，逐臂断言"这一条判据确实会红，而且红在该红的那一腿"。
 *
 * 臂 A：把 App.tsx 的早返回摘掉 ⇒ 关着那条用例必须在 **aiFeedback/preferenceCorrections**
 *        那一腿转红，而开着那条（正向对照）必须仍然绿 —— 否则正向对照没有区分力。
 * 臂 B：把探针的监视表里 `tasks` 摘掉 ⇒ "探针活着"那一腿必须转红（证明它不是装饰）。
 * 臂 C：把早返回的判据改成恒假 ⇒ 同臂 A（换个失效形状再验一次）。
 *
 * 每臂都在原地改文件、跑完立刻还原；脚本 throw 时由 finally 还原。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const APP = 'apps/web/src/App.tsx';
const SPEC = 'apps/web/tests/memory-gate-no-read.spec.tsx';

const appPath = `${ROOT}/${APP}`;
const specPath = `${ROOT}/${SPEC}`;
const appOrig = readFileSync(appPath, 'utf8');
const specOrig = readFileSync(specPath, 'utf8');

const GATE_BLOCK = `    if (aiSettings.memoryEnabled !== true) {
      return {
        preferenceSet: emptyPreferenceSet(false),
        feedbackSet: emptyFeedbackPreferenceSet(false),
        rawPresentIds: [] as string[],
        corrections: [] as { id: string; preferenceId: string; kind: 'suppress'; deletedAt?: number }[],
        focusGaps: null,
      };
    }
`;

let patched = false;
function patch(file, from, to, label) {
  const text = readFileSync(file, 'utf8');
  const hits = text.split(from).length - 1;
  if (hits !== 1) throw new Error(`${label}：变异目标命中 ${hits} 次（期望 1），装置失效`);
  writeFileSync(file, text.replace(from, to));
  patched = true;
}

function parsePassed(out) {
  // 回 -1 而不是 0：**"没跑到任何用例"必须和"跑到了但 0 条通过"长得不一样**。
  // 这一层原来就有这个值，但 `expect()` 从没检查它 ⇒ 对照臂（期望 `failed` 区间 0–0）
  // 在集合期失败那趟会拿到 failed=0、passed=-1 而**判绿** —— 一条假绿的对照。
  const m = out.match(/^\s*Tests\s+(?:\d+ failed \| )?(\d+) passed/m);
  return m ? Number(m[1]) : -1;
}

function run() {
  let out = '';
  try {
    out = execFileSync('npx', ['vitest', 'run', `tests/${SPEC.split('/').pop()}`], {
      cwd: `${ROOT}/apps/web`,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  // ⚠️ vitest 在**全绿**那一趟根本不打印 `failed` 这个词 —— 所以"没匹配到"就是 0，
  //    不是"未知"。（上一版把它记成 -1，于是两条对照臂自己把自己判红了。）
  const failed = out.includes(' failed') ? Number(out.match(/Tests\s+(\d+) failed/)?.[1] ?? 0) : 0;
  return { out, failed, passed: parsePassed(out) };
}

const results = [];
/** `--selftest` 用注入替身的方式验前置，不用 `eval`（ES module 严格模式下改不动函数声明）。 */
let runFn = run;
function expect(label, { minFailed, maxFailed, mustInclude, mustNot }) {
  const { out, failed, passed } = runFn();
  if (passed <= 0) {
    // 🔴 只有**本装置真的改过文件**时才还原。`--selftest` 走的是注入替身、一个字都没改，
    // 而 `appOrig` 是模块加载时读到的**当时的工作树内容**（此刻含并行会话的未提交改动）——
    // 那时候写回去就等于把别人在这几秒内的新改动抹掉。
    const needRestore = patched;
    if (needRestore) {
      writeFileSync(appPath, appOrig);
      writeFileSync(specPath, specOrig);
      patched = false;
    }
    throw new Error(
      `「${label}」这一臂没跑到任何用例（passed=${String(passed)}；${needRestore ? '两个文件已还原' : '本装置没改过文件，无需还原'}）。\n${out.slice(-1500)}`,
    );
  }
  const ok =
    failed >= minFailed &&
    (maxFailed === undefined || failed <= maxFailed) &&
    (mustInclude ?? []).every((s) => out.includes(s)) &&
    (mustNot ?? []).every((s) => !out.includes(s));
  results.push({ label, ok, failed, passed });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ⇒ failed=${failed} passed=${passed}`);
  if (!ok) console.log(out.split('\n').filter((l) => /✓|×|✗|FAIL|AssertionError|→/.test(l)).slice(0, 25).join('\n'));
}

// `--selftest`：只验**读数解析 + 没跑到用例时会不会抛**这一层，不跑 vitest、不碰两个源文件。
// ⇒ 在 `App.tsx` 被并行会话脏着、或内存闸门被占的现在，这台装置仍能交出一部分证据。
if (process.argv.includes('--selftest')) {
  let selfBad = 0;
  const fixtures = [
    ['全绿行（对照臂读的就是它）', '      Tests  2 passed (2)\n', 2],
    ['一红一绿行', '      Tests  1 failed | 1 passed (2)\n', 1],
    ['集合期失败（无 Tests 行）', ' FAIL  tests/x.spec.ts\n SyntaxError\n', -1],
  ];
  for (const [label, text, want] of fixtures) {
    const got = parsePassed(text);
    if (got !== want) selfBad += 1;
    console.log(`${got === want ? 'OK ' : 'BAD'} ${label} ⇒ passed=${String(got)}（期望 ${String(want)}）`);
  }
  // 前置本身：注入一个"集合期失败"的假读数，expect() 必须**抛**，而不是把对照臂判绿
  const realRunFn = runFn;
  runFn = () => ({ out: ' FAIL  SyntaxError\n', failed: 0, passed: -1 });
  let threw = false;
  try {
    expect('前置探针（集合期失败必须抛，不许判绿）', { minFailed: 0, maxFailed: 0 });
  } catch {
    threw = true;
  } finally {
    runFn = realRunFn;
  }
  if (!threw) selfBad += 1;
  console.log(`${threw ? 'OK ' : 'BAD'} 集合期失败时 expect() 抛而不是判绿 = ${String(threw)}`);
  console.log(selfBad === 0 ? 'SELFTEST=PASS（四臂）' : `SELFTEST=FAIL（${String(selfBad)} 项）`);
  process.exit(selfBad === 0 ? 0 : 1);
}

try {
  // 0 对照：未变异必须全绿
  expect('臂 0 对照（未变异）2 条全绿', { minFailed: 0, maxFailed: 0, mustNot: ['failed'] });

  // A 摘掉早返回
  patch(appPath, GATE_BLOCK, '', '臂 A');
  expect('臂 A 摘掉早返回 ⇒ 只有「关着」那条红，且红在 aiFeedback 那一腿', {
    minFailed: 1,
    maxFailed: 1,
    mustInclude: ['关着的时候读了 aiFeedback'],
  });
  writeFileSync(appPath, appOrig);

  // C 恒假判据（锚点必须带整块，`memoryEnabled !== true` 在文件里出现两次）
  patch(appPath, GATE_BLOCK, GATE_BLOCK.replace('aiSettings.memoryEnabled !== true', 'false'), '臂 C');
  expect('臂 C 闸门恒假 ⇒ 同样只有「关着」那条红', {
    minFailed: 1,
    maxFailed: 1,
    mustInclude: ['关着的时候读了 aiFeedback'],
  });
  writeFileSync(appPath, appOrig);

  // B 探针的 tasks 不在监视表里 ⇒ "探针活着"那一腿必须红
  patch(specPath, "const watched: readonly string[] = [...MEMORY_ONLY, ALWAYS_READ];", "const watched: readonly string[] = [...MEMORY_ONLY];", '臂 B');
  expect('臂 B 摘掉探针的活体证据 ⇒ 「探针活着」那一腿红（两条都红）', {
    minFailed: 2,
    maxFailed: 2,
    mustInclude: ['计数器没读到 `tasks`'],
  });
  writeFileSync(specPath, specOrig);

  // 终态：还原后必须回到全绿
  expect('还原后 2 条全绿', { minFailed: 0, maxFailed: 0, mustNot: ['failed'] });
} finally {
  writeFileSync(appPath, appOrig);
  writeFileSync(specPath, specOrig);
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length === 0 ? '\n五臂全对 ✅' : `\n有臂不对 ❌ (${bad.length})`);
process.exit(bad.length === 0 ? 0 : 1);
