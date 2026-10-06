/**
 * P1-2（DatePicker 月历）+ P0-6（GrowthView 六次投影）的变异装置。
 *
 * P1-2 改的是 `packages/ui` 源码，而 apps/web 读的是 **dist** ⇒ 每一臂都要重打包，
 * 否则跑的是旧产物（本仓库为这件事记过 §7 第 27 条）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ROOT 从**本文件自己的位置**推导，不写死某台机器的检出路径 ——
// 这些装置现在住在仓库里（`research/tools/mutation-rigs/`），
// 台账引用的证据必须对下一台机器也成立。（路径里有空格，所以要 decodeURIComponent。）
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const DP = `${ROOT}/packages/ui/src/date-picker/DatePicker.tsx`;
const GV = `${ROOT}/apps/web/src/features/motivation/GrowthView.tsx`;

const dpOrig = readFileSync(DP, 'utf8');
const gvOrig = readFileSync(GV, 'utf8');

function patch(file, from, to, label) {
  const text = readFileSync(file, 'utf8');
  const hits = text.split(from).length - 1;
  if (hits !== 1) throw new Error(`${label}：锚点命中 ${hits} 次（期望 1），装置失效`);
  writeFileSync(file, text.replace(from, to));
}

function buildUi() {
  execFileSync('pnpm', ['--filter', '@heyta/ui', 'build'], { cwd: ROOT, stdio: 'ignore' });
}

function runOne(spec) {
  let out = '';
  try {
    out = execFileSync('npx', ['vitest', 'run', `tests/${spec}`], {
      cwd: `${ROOT}/apps/web`,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  return out;
}

/**
 * 🔴 被宿主级测试闸门挡下时**不能当成一次读数**。
 *
 * 本机有个 `~/.tfa-shield` 的 node shim：别的测试在跑（持有 `/tmp/tfa-test.lock`）时，
 * 它打印一句"内存闸门拒绝启动"就退出 —— 输出里根本没有 `Tests` summary。
 * 上一版装置把这种空返回读成 `failed=0`，于是**三条臂一起假报**（两条假绿一条假红）。
 * 现在：识别这个形状 ⇒ 无条件等 30 秒 ⇒ 重试，最多 12 次；等满就响亮地失败。
 */
function run(spec) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const out = runOne(spec);
    if (!out.includes('拒绝启动') && !out.includes('tfa-test.lock')) {
      const line = out.match(/^\s+Tests\s+(.*)$/m)?.[1] ?? '';
      const ran = Number(line.match(/\((\d+)\)/)?.[1] ?? -1);
      const failed = Number(line.match(/(\d+) failed/)?.[1] ?? 0);
      return { out, failed, ran };
    }
    console.log(`     [被测试闸门挡住，第 ${attempt} 次，等 30 秒]`);
    execFileSync('sleep', ['30']);
  }
  throw new Error('等满 6 分钟仍被测试闸门挡住 —— 装置没有读数，不许当成绿');
}

const results = [];
function arm(label, spec, expectFailed, needles, expectRan = 2) {
  const { out, failed, ran } = run(spec);
  const ok =
    ran === expectRan &&
    failed === expectFailed &&
    needles.every((n) => out.includes(n));
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ⇒ ran=${ran}（期望 ${expectRan}）failed=${failed}（期望 ${expectFailed}）`);
  if (!ok) console.log(out.split('\n').filter((l) => /✓|×|→|FAIL|Error/.test(l)).slice(0, 18).join('\n') || '     [输出为空 —— 探针没跑到，不是被测对象绿]');
}

const DP_SPEC = 'date-picker-months-memoized.spec.tsx';
const GV_SPEC = 'growth-view-derived-memoized.spec.tsx';

const MEMO_WEEKS = 'const weeks = useMemo(() => monthGrid(month), [month]);';
const RAW_WEEKS = 'const weeks = monthGrid(month);';

const GV_PAIRS = [
  ['const todayProgress = useMemo(() => selectTodayProgress(entities, now), [entities, now]);', 'const todayProgress = selectTodayProgress(entities, now);'],
  ['const review = useMemo(() => selectWeeklyReview(entities, now), [entities, now]);', 'const review = selectWeeklyReview(entities, now);'],
  ['const totals = useMemo(() => selectTotals(entities), [entities]);', 'const totals = selectTotals(entities);'],
  ['const milestones = useMemo(() => selectMilestones(entities), [entities]);', 'const milestones = selectMilestones(entities);'],
  ['const tags = useMemo(() => selectIdentityTags(entities, now), [entities, now]);', 'const tags = selectIdentityTags(entities, now);'],
];
const GV_HEAT_FROM = `const activityDays = useMemo(
    () => dailyActivityCountsFromState(entities, now, 365),
    [entities, now],
  );`;
const GV_HEAT_TO = 'const activityDays = dailyActivityCountsFromState(entities, now, 365);';

try {
  // ── P1-2 ────────────────────────────────────────────────────
  arm('P1-2 臂 0 对照', DP_SPEC, 0, []);
  patch(DP, MEMO_WEEKS, RAW_WEEKS, 'P1-2 臂 A');
  buildUi();
  arm('P1-2 臂 A 摘掉 useMemo ⇒ 红在"同参数重渲染"那一腿', DP_SPEC, 1, ['同参数重渲染 3 次就重建 3 次月历']);
  writeFileSync(DP, dpOrig);
  patch(DP, MEMO_WEEKS, 'const weeks = useMemo(() => monthGrid(month), []);', 'P1-2 臂 B');
  buildUi();
  arm('P1-2 臂 B 依赖写空 ⇒ 红在"换月必须重算"那一腿', DP_SPEC, 1, ['换月后没重算月历']);
  writeFileSync(DP, dpOrig);
  buildUi();

  // ── P0-6 ────────────────────────────────────────────────────
  arm('P0-6 臂 0 对照', GV_SPEC, 0, []);
  for (const [from, to] of GV_PAIRS) patch(GV, from, to, 'P0-6 臂 C');
  patch(GV, GV_HEAT_FROM, GV_HEAT_TO, 'P0-6 臂 C');
  // 摘掉六个 useMemo 之后，**两条**用例都要红：第一条是"输入没变却重跑"，
  // 第二条是新加的那腿 —— 不吃 `now` 的两个投影也被那一跳拖着重算。
  // （期望原先写的是 1，那是我把"第二条腿不会有读数"当成了当然 —— 现量是 2。）
  arm('P0-6 臂 C 摘掉六个 useMemo ⇒ 两腿全红', GV_SPEC, 2, [
    '输入没变却重跑了',
    '的输入里没有 `now`，却跟着 60 秒那一跳重算了',
  ]);
  writeFileSync(GV, gvOrig);

  patch(GV, GV_PAIRS[0][0], 'const todayProgress = useMemo(() => selectTodayProgress(entities, now), [entities]);', 'P0-6 臂 D');
  arm('P0-6 臂 D 把 `now` 漏出依赖 ⇒ 红在"推进 60 秒却没重算"', GV_SPEC, 1, ['推进 60 秒却没重算']);
  writeFileSync(GV, gvOrig);

  arm('P0-6 还原后全绿', GV_SPEC, 0, []);
  arm('P1-2 还原后全绿', DP_SPEC, 0, []);
} finally {
  writeFileSync(DP, dpOrig);
  writeFileSync(GV, gvOrig);
  buildUi();
}

const bad = results.filter((r) => !r).length;
console.log(bad === 0 ? '\n八臂全对 ✅' : `\n有臂不对 ❌ (${bad})`);
process.exit(bad === 0 ? 0 : 1);
