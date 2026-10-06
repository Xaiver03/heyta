#!/usr/bin/env node
/**
 * 共享时间线那一处"面"的变异臂（工单 §8.42）。
 *
 * 这一枚面有两层判据，**分工不同**，所以每一臂都同时打两个探针：
 *   探针 A = 门禁 `check:selection-single-source` 的断言 F（"这个文件里底色处数 ≤ 通道处数"）
 *   探针 B = `packages/ui/tests/timeline-row-selection-trace.spec.ts`（**逐处按 testID 配对**，
 *            还管通道住不住在可点那颗上、谓词是不是 id 等值）
 * 🔴 两臂的预期里有两条是"一个红、另一个必须绿"（T3 / T5）—— 那两条才是这份台子的产出：
 *   它们证明的是**门禁看不见"位置"和"内容"这两件事**，只能由 B 那一份兜住。
 *   只写"两处都红"的臂，等于把两层判据当成一层，下一轮就会有人删掉 B。
 *
 * 跑法（仓库根；linked worktree 里不要 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-timeline-face.mjs
 *
 * 六臂：
 *   T1 只摘第二处（未排期泳道）的 aria-pressed      → A 红 + B 红
 *   T2 两处 aria-pressed 全摘                       → A 红 + B 红 ≥2
 *   T3 把第二处通道从 Pressable 挪进里层 <Text>      → A **绿** + B 红（门禁只数数量）
 *   T4 两处换成对象形态 accessibilityState           → A 红 + B 红
 *   T5 把第二处谓词换成常量 true                     → A **绿** + B 红（谓词右半边只看有没有一处成立）
 *   T6 阴性对照：只往注释里写 `aria-pressed={rowSelected}` → A 绿 + B 绿（两边都剥注释）
 *
 * 每臂跑完复原；六枚预期全中且 `FINAL_SAME=true` 才 exit 0。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const GATE = 'scripts/check-selection-single-source.mjs';
const SPEC = 'packages/ui/tests/timeline-row-selection-trace.spec.ts';
const SRC = 'packages/ui/src/timeline/TimelineBoard.tsx';
const JSON_OUT = '/tmp/dp_timeline_face.json';
const files = { gate: GATE, spec: SPEC, src: SRC };
const md5 = (p) => createHash('md5').update(readFileSync(`${ROOT}/${p}`)).digest('hex');
const BASE = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, md5(p)]));
const orig = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(`${ROOT}/${p}`, 'utf8')]));

const CHANNEL = 'aria-pressed={rowSelected}';
const LANE_TITLE = 'testID={`timeline-lane-title-${row.taskId}`}';

/** 只替换第 n 次出现（1 起）—— "摘掉一处"和"摘掉全部"必须是两个不同的臂。 */
function replaceNth(text, needle, repl, n) {
  let seen = 0;
  return text.replace(new RegExp(needle.replace(/[{}$^*+?.()|[\]\\]/g, '\\$&'), 'g'), (m) =>
    ++seen === n ? repl : m,
  );
}

const runGate = () => {
  try {
    return {
      rc: 0,
      out: execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

const SPEC_ARG = 'tests/timeline-row-selection-trace.spec.ts';
const runSpec = () => {
  let stderr = '';
  try {
    execFileSync('./node_modules/.bin/vitest', ['run', SPEC_ARG, '--reporter=json', `--outputFile=${JSON_OUT}`], {
      cwd: `${ROOT}/packages/ui`,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    /* 红是预期结果之一，读数从 json 里取；但启动失败要能区分出来 */
    stderr = `${e.stdout || ''}${e.stderr || ''}`.slice(-400);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    // 🔴 分母读空**不许**当成"零条红 = 绿"：那是本仓那一族"永远通过的判据"的形状。
    return { rc: -1, failed: -1, total: -1, names: [`JSON_READ_FAILED ${stderr}`] };
  }
  const results = report.testResults ?? [];
  const assertions = results.flatMap((r) => r.assertionResults ?? []);
  return {
    rc: assertions.length === 0 ? -1 : 0,
    total: assertions.length,
    failed: assertions.filter((a) => a.status === 'failed').length,
    // 用 `title` 不用 `fullName`：fullName 带 describe 前缀，截断后每条都长一样，
    // 而这一张表要读的正是"红在哪一条"。
    names: assertions.filter((a) => a.status === 'failed').map((a) => a.title),
  };
};

const restore = () => {
  for (const [k, p] of Object.entries(files)) writeFileSync(`${ROOT}/${p}`, orig[k]);
};

const ARMS = [
  {
    name: 'T1 只摘第二处（未排期泳道）的 aria-pressed',
    expect: { gate: 'red', spec: 'red' },
    mutate: (s) => replaceNth(s, CHANNEL, '', 2),
  },
  {
    name: 'T2 两处 aria-pressed 全摘',
    expect: { gate: 'red', spec: 'red', minSpecRed: 2 },
    mutate: (s) => s.split(CHANNEL).join(''),
  },
  {
    name: 'T3 第二处通道从 Pressable 挪进里层 <Text>',
    // 🔴 门禁必须**绿**：它数的是"文件里通道出现几次"，挪位置不改次数。
    expect: { gate: 'green', spec: 'red' },
    mutate: (s) => {
      const removed = replaceNth(s, CHANNEL, '@@MOVED@@', 2);
      const withChild = removed.replace(LANE_TITLE, `${LANE_TITLE}\n              ${CHANNEL}`);
      return withChild.replace('@@MOVED@@', '');
    },
  },
  {
    name: 'T4 两处换成对象形态 accessibilityState',
    expect: { gate: 'red', spec: 'red', minSpecRed: 2 },
    mutate: (s) => s.split(CHANNEL).join('accessibilityState={{ pressed: rowSelected }}'),
  },
  {
    name: 'T5 第二处谓词换成常量 true',
    // 🔴 门禁必须**绿**：`driverComesFromSelection` 扫到**任意一处**右半边含等值即算通过。
    expect: { gate: 'green', spec: 'red' },
    mutate: (s) => replaceNth(s, 'const rowSelected = activeTaskId === row.taskId;', 'const rowSelected = true;', 2),
  },
  {
    name: 'T6 阴性对照：把通道字样只写进注释',
    expect: { gate: 'green', spec: 'green' },
    mutate: (s) => s.replace(CHANNEL, `// ${CHANNEL} 只是注释里的一句话\n              ${CHANNEL}`),
  },
];

const c1 = runGate();
const c2 = runSpec();
if (c1.rc !== 0 || c2.failed !== 0 || c2.total !== 7) {
  console.log(`CONTROL_NOT_GREEN gate=${c1.rc} spec=${c2.failed}/${c2.total} —— 台子自己是红的，后面读数都不作数`);
  console.log(c1.out);
  restore();
  process.exit(2);
}
console.log(`CONTROL rc=0（未变异：门禁绿 / 共享层 7 条全绿，分母现量 total=${c2.total}）`);

const verdict = [];
for (const arm of ARMS) {
  restore();
  const mutated = arm.mutate(orig.src);
  if (mutated === orig.src) {
    verdict.push([arm.name, 'MUTATE-NO-OP', 'FAIL']);
    continue;
  }
  writeFileSync(`${ROOT}/${files.src}`, mutated);
  const g = runGate();
  const s = runSpec();
  const gateF = g.out.split('\n').filter((l) => l.includes('断言 F')).length;
  const gateRed = g.rc !== 0 && gateF > 0;
  const specRed = s.failed >= (arm.expect.minSpecRed ?? 1);
  const okGate = arm.expect.gate === 'red' ? gateRed : !gateRed;
  const okSpec = arm.expect.spec === 'red' ? specRed : s.failed === 0;
  verdict.push([
    `${arm.name} [A=${arm.expect.gate} B=${arm.expect.spec}${arm.expect.minSpecRed ? `≥${arm.expect.minSpecRed}` : ''}]`,
    `A: rc=${g.rc} 断言F行数=${gateF} | B: 红 ${s.failed}/${s.total} ${s.names.join(' ｜ ')}`,
    okGate && okSpec ? 'OK' : 'FAIL',
  ]);
}
restore();
const same = Object.keys(BASE).every((k) => md5(files[k]) === BASE[k]);
for (const [n, d, v] of verdict) console.log(`${v.padEnd(5)} ${n}\n      ${d}`);
const g2 = runGate();
const s2 = runSpec();
console.log(
  `ARMS=${ARMS.length} AS_EXPECTED=${verdict.filter(([, , v]) => v === 'OK').length} FAIL=${verdict.filter(([, , v]) => v === 'FAIL').length} FINAL_SAME=${same}`,
);
console.log(`POST_RESTORE gate rc=${g2.rc} spec 红=${s2.failed}/${s2.total}`);
process.exit(verdict.every(([, , v]) => v === 'OK') && same && g2.rc === 0 && s2.failed === 0 ? 0 : 1);
