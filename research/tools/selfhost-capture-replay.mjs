#!/usr/bin/env node
/**
 * 冲突族 8（`scripts/screenshots/capture.mjs`）的解法：**取 main 那一份，再把本批的四处改动重放上去**。
 *
 * 为什么不是"两块都留"式的行级并集：这一族的两侧改动**落在同一段代码上**
 * （main 在 10-04 往截图前那一段加了 `dismissOverlays` / `clearHoverAndFocus`，
 * 本批把同一段里的固定 `waitForTimeout(600)` 换成了"等揭示落位"）。
 * 行级并集会把两条等待都留下 —— 那是一种**看起来什么都没丢**的产出，
 * 而实际语义是"先等 600ms 再等揭示"，把刚摘掉的那个形状又装了回去。
 *
 * 所以这里取 main 为底、按**逐字面**重放本批的四处，并且：
 *  - 每一处 `find` 必须**恰好命中一次**（0 次 = main 又改了形状，>1 次 = needle 太宽）
 *    ⇒ 两种都当场判红交人判，绝不"顺手取一侧"。
 *  - 产出与 main 做一次**行级对账**：被删掉的行必须恰好是声明的那几行，
 *    新增的行必须恰好是那四处带来的（从 edits 自己推导，不手抄）。
 *    这一条挡的是"重放时顺手覆盖掉 main 刚加的那一段"。
 *
 * `--selftest` 用合成样本证明这些断言**会失败**（五臂各红一次、control 绿）。
 * 判"一条判据有没有牙"只靠变异回答，不靠读代码。
 */

const L = (...lines) => lines.join('\n');

export const CAPTURE_PATH = 'scripts/screenshots/capture.mjs';

export const CAPTURE_EDITS = [
  {
    desc: '导入 settleForShot（单一所有者在 scripts/screenshots/head-reveal.mjs）',
    find: L("import { inspectPng, looksBlank } from './png-stats.mjs';"),
    repl: L(
      "import { inspectPng, looksBlank } from './png-stats.mjs';",
      "import { settleForShot } from './head-reveal.mjs';",
    ),
  },
  {
    desc: '截图前的固定 600ms 换成"等揭示落位"',
    find: L(
      '    // 动画/字体收敛，避免截到过渡中间态',
      '    await page.waitForTimeout(600);',
    ),
    repl: L(
      '    // 🔴 截图前的收尾等待：**等揭示落位，不等时间**（本文件头部设计约束第 1 条）。',
      '    //    原来这里是固定 `waitForTimeout(600)`，而落地页页头走 `.lp-mask` +',
      '    //    `translateY(112%)→0%` 的错峰揭示 —— 600ms 在快机器上浪费、在慢机器上',
      '    //    **截到一条空白带**（审计文档 §8.110：六张图里四张是这样，而它们被当成',
      '    //    "界面有问题"的证据去查，查的是一个不存在的问题）。',
      '    //    没有 `.lp-h1` 的应用视图仍走那 600ms：那些页面没有可等的揭示，',
      '    //    把它们接进新判据只会让每张图都等一个永远不成立的条件。',
      '    const settled = await settleForShot(page);',
    ),
  },
  {
    desc: '读数里带上这一张等的是哪一种',
    find: L('    written.push({ outPath, stats, blank });'),
    repl: L('    written.push({ outPath, stats, blank, settled });'),
  },
  {
    desc: 'stdout 打 `等待 revealed|fallback`',
    find: L("        `  内容 ${(stats.contentRatio * 100).toFixed(1)}%  色阶 ${stats.colorSpan}`,"),
    repl: L("        `  内容 ${(stats.contentRatio * 100).toFixed(1)}%  色阶 ${stats.colorSpan}  等待 ${settled}`,"),
  },
];

/** main 那一份里**必须原样活着**的东西（本批没碰它们；丢了就是重放覆盖了别人的改动）。 */
const MUST_KEEP_FROM_MAIN = [
  'async function dismissOverlays(page, texts) {',
  'async function clearHoverAndFocus(page) {',
];
/** 重放之后**必须出现**的东西（少了就是某一处没落上）。 */
const MUST_APPEAR_AFTER = ['settleForShot(page)', 'blank, settled', '等待 ${settled}'];

const countOf = (hay, needle) => (needle === '' ? 0 : hay.split(needle).length - 1);
const lineCounts = (text) => {
  const m = new Map();
  for (const l of text.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
/**
 * 行级对账的两个方向。🔴 遍历的对象**不一样**：
 * "删了哪些行"只能在**输入**那一份里数（输出里根本没有它），
 * "加了哪些行"只能在**输出**那一份里数。
 * 第一版两个方向都遍历输入 ⇒ 新增恒报 0，control 臂自己红（这正是自检的用途）。
 */
const diffKeys = (before, after, dir) => {
  const a = lineCounts(before);
  const b = lineCounts(after);
  const [src, other] = dir === 'removed' ? [a, b] : [b, a];
  const out = [];
  for (const [line, n] of src) {
    const m = other.get(line) ?? 0;
    // 选完 src 之后两个方向是**同一个比较**：另一侧更少就是"这一侧多"。
    // 第一版在这里写了三元（`removed ? m<n : m>n`）⇒ added 分支恒空，
    // control 臂自己红 —— 那是自检第一次开口就照出实现错。
    if (m < n) out.push(line);
  }
  return out.sort();
};

/** 从 edits 本身推导"应当删掉/应当新增哪些行"，避免第二份抄件。 */
const expectedDelta = () => {
  const removed = [];
  const added = [];
  for (const e of CAPTURE_EDITS) {
    const f = new Set(e.find.split('\n'));
    const r = new Set(e.repl.split('\n'));
    for (const l of f) if (!r.has(l)) removed.push(l);
    for (const l of r) if (!f.has(l)) added.push(l);
  }
  return { removed: removed.sort(), added: added.sort() };
};

/**
 * @param {string} mainTxt stage 2（main = 第一父）那一份
 * @returns {{text: string, hits: Array<{desc: string, hits: number}>, problems: string[]}}
 */
export function replayCapture(mainTxt) {
  const problems = [];
  const hits = [];
  let text = mainTxt;
  for (const e of CAPTURE_EDITS) {
    const n = countOf(text, e.find);
    hits.push({ desc: e.desc, hits: n });
    if (n !== 1) {
      problems.push(`「${e.desc}」的 needle 命中 ${n} 次（必须恰好 1）⇒ 不重放，交人判`);
      continue;
    }
    text = text.replace(e.find, e.repl);
  }
  if (problems.length) return { text, hits, problems };

  if (text.includes('await page.waitForTimeout(600);')) {
    problems.push('产出里仍有固定 `waitForTimeout(600)` ⇒ 那条被摘掉的等待又回来了');
  }
  for (const s of MUST_KEEP_FROM_MAIN) {
    if (!text.includes(s)) problems.push(`丢了 main 侧的东西：${s.slice(0, 46)}…`);
  }
  for (const s of MUST_APPEAR_AFTER) {
    if (!text.includes(s)) problems.push(`本批那处改动没落上：${s}`);
  }
  if (/^<{7}|^>{7}|^\|{7}/m.test(text)) problems.push('残留冲突标记');

  const want = expectedDelta();
  const gotRemoved = diffKeys(mainTxt, text, 'removed');
  const gotAdded = diffKeys(mainTxt, text, 'added');
  const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  if (!same(gotRemoved, want.removed)) {
    problems.push(
      `行级对账：实际删掉 ${gotRemoved.length} 行、应当 ${want.removed.length} 行` +
        ` —— 差集=${gotRemoved.filter((l) => !want.removed.includes(l)).slice(0, 3).join(' ⏎ ') || '（无）'}` +
        ` / 少删=${want.removed.filter((l) => !gotRemoved.includes(l)).slice(0, 3).join(' ⏎ ') || '（无）'}`,
    );
  }
  if (!same(gotAdded, want.added)) {
    problems.push(`行级对账：实际新增 ${gotAdded.length} 行、应当 ${want.added.length} 行`);
  }
  return { text, hits, problems };
}

/** 供载体脚本用：返回 null 表示可以落盘，否则是那句"绝不提交"的理由。 */
export function replayVerdict(r) {
  return r.problems.length ? r.problems.join(' · ') : null;
}

/**
 * `--selftest` 那段输出的**内容**判据 —— 给消费方（载体脚本）用。
 *
 * 🔴 为什么不能只看退出码：把自检里那句"每条臂是否通过"的判定改成恒真之后，脚本仍然 `rc=0`。
 *   （⚠️ 这条注释原先**逐字抄了那行代码**，于是后来拿 `replace(那行, …)` 做变异臂时，
 *   替换落进了注释、代码原封不动 —— 变异"成功"了却什么都没变。
 *   文档注释里不要抄将被当作变异 needle 的字面串，这是 §"replace 只换第一处"那一族的又一副面目。）
 *   也就是说"跑了自检、rc 0"这一条腿对**被摘牙的自检**没有分辨力。
 *   判内容才判得动：control 必须 0 条问题、每一条变异臂必须 ≥1 条、且要有收尾复绿那句。
 *
 * @returns {string|null} null = 这段输出确实证明六臂各按预期
 */
export function selftestOutputVerdict(stdout) {
  const lines = String(stdout).split('\n');
  const numOf = (line) => {
    const m = line.match(/问题 (\d+) 条/);
    return m ? Number(m[1]) : null;
  };
  const ctrl = lines.filter((l) => l.includes('臂 control'));
  if (ctrl.length !== 1) return `control 臂打印了 ${ctrl.length} 行（应当恰好 1）`;
  if (numOf(ctrl[0]) !== 0) return `control 臂的问题数不是 0 —— 判据在合法输入上就红，产出不可信`;
  const arms = lines.filter((l) => /臂 (?!control)/.test(l) && numOf(l) !== null);
  if (arms.length < 5) return `变异臂只数到 ${arms.length} 条（五臂是这套判据的最低配置）`;
  const alive = arms.filter((l) => (numOf(l) ?? 0) >= 1);
  if (alive.length !== arms.length) {
    return `${arms.length - alive.length} 条变异臂的问题数为 0 ⇒ 自检被摘了牙或某一臂不再可达，不能用它证明判据有牙`;
  }
  if (!lines.some((l) => l.includes('收尾复绿') && l.includes('问题 0 条'))) {
    return '缺"收尾复绿"那一行 ⇒ 无法证明变异没留在对象里';
  }
  return null;
}

export function replayReading(r) {
  const want = expectedDelta();
  return `四处重放命中数=[${r.hits.map((h) => h.hits).join(',')}] · 删 ${want.removed.length} 行 · 增 ${want.added.length} 行 · main 侧两个新函数都在 · 产出 ${r.text.split('\n').length} 行`;
}

/* ── 自检：五臂变异各红一次、control 绿（`node research/tools/selfhost-capture-replay.mjs --selftest`）──
 * 判"一条判据有没有牙"只能靠变异回答。这里全部用**合成样本**，
 * 不必为了验一条判据就在真载体里留一次半合状态。 */
if (process.argv[1] && process.argv[1].endsWith('selfhost-capture-replay.mjs') && process.argv.includes('--selftest')) {
  const base = L(
    "import { inspectPng, looksBlank } from './png-stats.mjs';",
    'async function dismissOverlays(page, texts) {',
    '  return null;',
    '}',
    'async function clearHoverAndFocus(page) {',
    '  return null;',
    '}',
    '    // 动画/字体收敛，避免截到过渡中间态',
    '    await page.waitForTimeout(600);',
    '    written.push({ outPath, stats, blank });',
    "        `  内容 ${(stats.contentRatio * 100).toFixed(1)}%  色阶 ${stats.colorSpan}`,",
  );
  const arms = {
    control: { txt: base, wantProblems: 0 },
    // 臂 1：main 把那句等待改名了 ⇒ 某一处 needle 命中 0
    main_moved_the_wait: { txt: base.replace('    await page.waitForTimeout(600);', '    await page.waitForTimeout(700);'), wantProblems: 1 },
    // 臂 2：main 删掉了 dismissOverlays（本批不该有意见，但产出必须响）
    lost_main_function: { txt: base.replace('async function dismissOverlays(page, texts) {', 'async function somethingElse() {'), wantProblems: 1 },
    // 臂 3：import 那一行在文件里出现两次 ⇒ needle 太宽，命中 >1
    ambiguous_needle: { txt: `${base}\n${'import { inspectPng, looksBlank } from \'./png-stats.mjs\';'}`, wantProblems: 1 },
    // 臂 4：**我自己的解法少写了一行**（把 E2 的 repl 末行摘掉）。
    //   ⚠️ 这一族曾经设计错过：原先的臂是"从 main 的样本里删一行"，结果**判据不响** ——
    //   行级对账比的是 replay 的**输入与输出**，main 少一行是两边一起少，看不见。
    //   "main 的行没了"那一层归 `MUST_KEEP_FROM_MAIN` 管（臂 2 就是它），
    //   而行级对账真正的用途是挡"重放本身写坏"（少一行 / 多一行 / 覆盖邻行）。
    own_edit_lost_a_line: { txt: base, wantProblems: 1, sabotage: true },
    // 臂 5：残留冲突标记
    conflict_marker: { txt: `${base}\n>>>>>>> ours`, wantProblems: 1 },
  };
  let bad = 0;
  const SABOTAGE_INDEX = 1;
  for (const [name, arm] of Object.entries(arms)) {
    const saved = CAPTURE_EDITS[SABOTAGE_INDEX].repl;
    if (arm.sabotage) {
      const lines = saved.split('\n');
      CAPTURE_EDITS[SABOTAGE_INDEX].repl = lines.slice(0, lines.length - 1).join('\n');
    }
    let r;
    try {
      r = replayCapture(arm.txt);
    } finally {
      CAPTURE_EDITS[SABOTAGE_INDEX].repl = saved;
    }
    if (arm.sabotage && CAPTURE_EDITS[SABOTAGE_INDEX].repl !== saved) {
      console.log('🔴 臂 sabotage 没能还原 edits —— 自检本身在污染被测对象');
      bad += 1;
      continue;
    }
    const got = r.problems.length;
    const ok = name === 'control' ? got === 0 : got >= arm.wantProblems;
    console.log(`${ok ? '✅' : '🔴'} 臂 ${name}：问题 ${got} 条${got ? ` —— ${r.problems[0].slice(0, 88)}` : ''}`);
    if (!ok) bad += 1;
  }
  // control 再跑一次：证明上一臂的临时变异**没有留下任何东西**
  const after = replayCapture(arms.control.txt);
  console.log(`${after.problems.length === 0 ? '✅' : '🔴'} 收尾复绿：变异后 control 再跑一次，问题 ${after.problems.length} 条`);
  if (after.problems.length) bad += 1;
  console.log(bad ? `🔴 自检失败 ${bad} 臂（判据没牙或产出错了）` : '✅ 自检：control 绿、五臂各红一次');
  process.exit(bad ? 1 : 0);
}
