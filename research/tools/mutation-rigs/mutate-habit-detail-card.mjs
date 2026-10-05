#!/usr/bin/env node
/**
 * 习惯面单落点（工单 §8.133）的**jsdom 层**变异臂。
 *
 * 钉的东西与便签那一套（`mutate-note-editor-placement.mjs`）同族但**不是同一份实现**：
 * 那边是 `NoteEditorCard`，这边是 `HabitDetailCard` —— 两块面单各自有一个必填布尔、
 * 各自有一层 inset 壳、各自的空态。所以臂也各打各的落点文件，谁也不替谁作证。
 *
 * 🔴 每一臂都改**判据的输入**（源码形状或组件行为），红集必须**恰好**落在点名那几条上。
 * 只有一条臂（B7）期望 4 红：把"猜第一条"那档回落放回来，会同时违反"面单跟着选中"
 * "未选中说选一条习惯""未选中不许有无障碍名""未选中不许有头行" —— 四条都在守同一件事，
 * 这是**加强**不是含糊。
 *
 * ⚠️ 这一台只覆盖 jsdom 够得着的部分。"那一栏被 CSS 藏掉时面单回不回得来""轨道留没留空白"
 *    "热力图压在 22rem 里溢不溢出"这三件是**只有浏览器能看见**的坏，臂在
 *    `mutate-detail-pane-habit-e2e.mjs`（它同时回答"e2e 那 5 条是不是这 11 条的重复"）。
 *    查询串与 `narrow.css` 同源那一档也不在这里重复 —— 那一支的臂是 note-editor 那台的 A5，
 *    打的是同一个共享文件 `detail-pane-visible.ts`。
 *
 * 🔴 B11–B13 是 §8.134（头行）补的三臂。它们打的是**结构**（工具挂在哪一行、未选中时
 *    这一行存不存在）；"工具与标题在不在同一行""工具与卡片隔没隔出一整段空白"是几何，
 *    jsdom 量不到，那两档的臂是同一台 e2e 上的 E3/E4。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-detail-card.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const F = {
  app: 'apps/web/src/App.tsx',
  view: 'apps/web/src/features/habits/HabitsView.tsx',
  card: 'apps/web/src/features/habits/HabitDetailCard.tsx',
  css: 'apps/web/src/styles/app/habits.css',
};
const SPEC = 'tests/habits-detail-card.spec.tsx';

const files = Object.values(F);
const orig = Object.fromEntries(files.map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')]));
const origMd5 = Object.fromEntries(
  files.map((rel) => [rel, createHash('md5').update(orig[rel]).digest('hex')]),
);

const sub = (rel, from, to, expectHits) => {
  const hits = orig[rel].split(from).length - 1;
  if (hits !== expectHits) {
    throw new Error(`${rel} 里 ${JSON.stringify(from).slice(0, 46)} 命中 ${hits} 次（要 ${expectHits} 次）`);
  }
  writeFileSync(path.join(ROOT, rel), orig[rel].replaceAll(from, to));
};

/**
 * 一次注入、多处改动（B12 用）。
 *
 * 🔴 逐处 `sub` 不行：它每次都从 `orig` 重写整个文件，第二处会把第一处的注入覆盖掉，
 *    于是"两处的臂"实际只注入了一处 —— 而**这种臂打空不会自己说**（它照样能红，
 *    只是红在另一条上）。所以这里把配对改动当成**一次**写入，并逐处校验命中数。
 */
const subAll = (rel, pairs) => {
  let text = orig[rel];
  for (const [from, to, expectHits] of pairs) {
    const hits = text.split(from).length - 1;
    if (hits !== expectHits) {
      throw new Error(`${rel} 里 ${JSON.stringify(from).slice(0, 46)} 命中 ${hits} 次（要 ${expectHits} 次）`);
    }
    text = text.replaceAll(from, to);
  }
  writeFileSync(path.join(ROOT, rel), text);
};

const restore = () => {
  for (const rel of files) writeFileSync(path.join(ROOT, rel), orig[rel]);
};

const run = () => {
  const r = spawnSync('./node_modules/.bin/vitest', ['run', SPEC], {
    cwd: path.join(ROOT, 'apps/web'),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // 汇总行两个坑（缩进 + 词序随结果变）见 mutate-habit-rate-label.mjs 的注释，这里同一套读法。
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  return {
    rc: r.status ?? 1,
    out,
    line: line.trim(),
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? 0),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? 0),
    // 红集标题（vitest 的 FAIL 行形如 `FAIL tests/x.spec.tsx > 组名 > 用例名`）。
    // 读不出标题时下面会**单独打出来**，不混进"红集不含点名的那一条"那一档 ——
    // 否则 reporter 换了标记会被读成"臂没牙"。
    titles: [...out.matchAll(/FAIL\s+\S+\.spec\.tsx\s+>\s+([^\n]+?)\s*$/gm)].map((m) => m[1].trim()),
  };
};

const ARMS = [
  {
    name: 'B1 视图不再看开关（两支同时渲染 = 拍板 #1 说的"第三处"）',
    apply: () =>
      sub(F.view, '{paneInColumn ? null : <HabitDetailCard inset={false} />}', '{<HabitDetailCard inset={false} />}', 1),
    failed: 1,
    needles: ['视图里那一枚面单'],
  },
  {
    name: 'B2 装配处摘掉"那一栏看得见"这个条件（恒按宽屏往栏里放）',
    apply: () => sub(F.app, "contentView === 'habits' && detailColumnShown ? (", "contentView === 'habits' ? (", 1),
    failed: 1,
    needles: ['详情列那一支带的是'],
  },
  {
    name: 'B3 递给 HabitsView 的布尔写死（宿主不再接共享开关）',
    apply: () => sub(F.app, 'paneInColumn={detailColumnShown}', 'paneInColumn', 1),
    failed: 1,
    needles: ['递给 HabitsView 的是同一个布尔'],
  },
  {
    name: 'B4 把开关降级成"默认值等于原行为"的可选 prop（§7 第 195 条那一档）',
    apply: () => sub(F.view, 'paneInColumn: boolean', 'paneInColumn?: boolean', 1),
    failed: 1,
    needles: ['是必填 prop'],
  },
  {
    name: 'B5 落点开关与 CSS 断线（data-pane 写死成一档）',
    apply: () =>
      sub(F.view, "data-pane={paneInColumn ? 'column' : 'pane'}", 'data-pane="column"', 1),
    failed: 1,
    needles: ["data-pane={paneInColumn ? 'column' : 'pane'}"],
  },
  {
    name: 'B6 删掉那条单列覆盖（面单走了、5fr 轨道留成一整块空白）',
    apply: () =>
      sub(F.css, ".ht-habit[data-pane='column'] {\n  grid-template-columns: minmax(0, 1fr);\n}\n", '', 1),
    failed: 1,
    needles: ['habits.css 里没有那条单列覆盖'],
  },
  {
    name: 'B7 把"猜第一条"那档回落放回来（§8.131 撤掉的那个形状）',
    apply: () =>
      sub(
        F.card,
        'const selected = store.habits.find((habit) => habit.id === selectedId);',
        'const selected = store.habits.find((habit) => habit.id === selectedId) ?? store.habits[0];',
        1,
      ),
    // 🔴 四条一起红是有意的：面单内容、空态措辞、无障碍名**都得**跟着选中，缺一档就还有说谎的余地。
    // 第 4 条（头行）是 §8.134 加进来的，**不是臂漂了**：把"猜第一条"放回来之后，
    // 未选中时那一行会写着列表第一条的名字，而痕迹那栏一条都没标 —— 正是这一臂要抓的形状。
    // （原来这里写 3，B7 复跑报 4 红 ⇒ 改的是**臂的主张**并写下理由，没去动任何一条判据。）
    failed: 4,
    needles: [
      '跟着共享选中态换人',
      '说的是「选一条习惯」',
      '无障碍名跟着选中',
      '未选中时这一行整个不存在',
    ],
  },
  {
    name: 'B8 生产者不再包那一层内边距壳（栏里的板子贴住窗口边被切）',
    apply: () =>
      sub(
        F.card,
        "className={inset ? 'ht-habit__pane ht-app__detail-habit' : 'ht-habit__pane'}",
        "className='ht-habit__pane'",
        1,
      ),
    failed: 1,
    needles: ['inset 只有栏里那一支拿到'],
  },
  {
    name: 'B9 装配处漏递 inset（宿主没接，而 prop 一旦可选就没人报）',
    apply: () => sub(F.app, '<HabitDetailCard inset />', '<HabitDetailCard />', 1),
    failed: 1,
    needles: ['详情列里找不到 HabitDetailCard'],
  },
  {
    name: 'B10 两条空态互相冒充（有习惯没选中却说"还没有习惯"）',
    apply: () => sub(F.card, '      empty: paneEmptyText(t, store.habits.length > 0),\n', '', 1),
    failed: 1,
    needles: ['说的是「选一条习惯」'],
  },
  /* ── B11–B13：头行（工单 §8.134）────────────────────────────────
     这三臂各打 S 组里**一条不同的断言**，所以 needles 里除了用例名还点名了
     断言自己的那句话 —— 两条都红在同一个用例上时，看的是**哪一句**先红。 */
  {
    name: 'B11 头行的标题不跟选中（写死一个字，三颗工具又变成"没归属的一排"）',
    apply: () =>
      sub(
        F.card,
        '<h2 className="ht-habit__pane-title">{selected.name}</h2>',
        '<h2 className="ht-habit__pane-title">{"习惯"}</h2>',
        1,
      ),
    failed: 1,
    needles: ['标题行 = 所选那条的名字', '头行的标题不是所选那条'],
  },
  {
    name: 'B12 三颗工具挪出头行（回到"单独浮在栏顶"那一档，§8.133 看图照出来的形状）',
    apply: () =>
      subAll(F.card, [
        [
          '            <h2 className="ht-habit__pane-title">{selected.name}</h2>\n            <div className="ht-habit__pane-tools">',
          '            <h2 className="ht-habit__pane-title">{selected.name}</h2>\n          </div>\n            <div className="ht-habit__pane-tools">',
          1,
        ],
        [
          '            </div>\n          </div>\n\n          {renamingId === selected.id ? (',
          '            </div>\n\n          {renamingId === selected.id ? (',
          1,
        ],
      ]),
    failed: 1,
    needles: ['标题行 = 所选那条的名字', '三颗工具不在头行里'],
  },
  {
    name: 'B13 未选中时也画头行，且指着列表第一条（"界面在说没选中、这一行却说某一条"）',
    apply: () =>
      sub(
        F.card,
        '      {selected === undefined ? null : (',
        '      {selected === undefined ? (\n        <div className="ht-habit__pane-head">\n          <h2 className="ht-habit__pane-title">{store.habits[0]?.name}</h2>\n        </div>\n      ) : (',
        1,
      ),
    // 两条一起红是有意的：一行"指着某条习惯的头行"同时违反**结构**（未选中不该有这一行）
    // 与**文本**（未选中时界面不许出现某一条的名字）—— 两档各挡一种坏，缺一条就还有说谎的余地。
    failed: 2,
    needles: ['未选中时这一行整个不存在', '未选中时板子照常挂载'],
  },
];

const base = run();
console.log(`基线：${base.line}`);
if (base.rc !== 0 || base.failed !== 0 || base.passed === 0) {
  console.log('VERDICT=PROBE_BROKEN 基线不干净，臂台没有资格判红');
  console.log(base.out.slice(-1500));
  process.exit(2);
}

/* 🔴 每臂跑两趟并要求红集**逐字相同**。理由不是谨慎，是这一族实测到的事故：
   同一族另一台（`mutate-habits-selection-fallback.mjs` 的 A3）有一臂的红集是 5/10/6 三趟不同，
   因为"钉第 0 行"与"用例点的那一行"是否重合取决于随机 UUID 的排序 ——
   单趟只查"包含点名的那几条"会把这种臂读成绿。本台的夹具同样是两条随机 id 的习惯，
   所以同一条纪律必须在这里也成立。 */
const PASSES = 2;

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  const passes = [];
  try {
    for (let i = 0; i < PASSES; i += 1) {
      arm.apply();
      passes.push(run());
      restore();
    }
  } catch (e) {
    console.log(`🔴 ${arm.name} → 注入失败：${e.message}`);
    restore();
    bad.push(arm.name);
    continue;
  }
  const residue = files.filter((rel) => {
    const now = createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    return now !== origMd5[rel];
  });
  const sets = passes.map((t) => [...t.titles].sort().join(' ‖ '));
  const stable = sets.every((s) => s === sets[0]);
  const missing = arm.needles.filter((n) => !passes[0].out.includes(n));
  const hit =
    passes.every(
      (t) =>
        t.rc !== 0 &&
        t.failed === arm.failed &&
        t.passed === base.passed - arm.failed &&
        arm.needles.every((n) => t.out.includes(n)),
    ) &&
    stable &&
    missing.length === 0 &&
    residue.length === 0;
  console.log(
    `${hit ? '✅' : '🔴'} ${arm.name} → 两趟：${passes.map((t) => t.line || '(读不到汇总行)').join(' ｜ ')}` +
      ` 点名红集=${arm.needles.join('｜')}` +
      `${missing.length ? ` 【缺:${missing.join('｜')}】` : ''}` +
      `${stable ? '' : ' 【🔴 红集随复跑漂 ⇒ 半径取决于夹具顺序而不是判据】'}` +
      `${residue.length ? ` 残留=${residue.join(',')}` : ''}`,
  );
  if (hit) ok += 1;
  else bad.push(arm.name);
}

const backToClean = files.every(
  (rel) => createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex') === origMd5[rel],
);
const after = run();
console.log(`复原：BACK_TO_CLEAN=${backToClean} 复跑=${after.line}`);
console.log(`ARMS=${ARMS.length} AS_EXPECTED=${ok} FAIL=${bad.length}`);
if (bad.length || !backToClean || after.rc !== 0) {
  console.log(`RIG_RESULT=FAIL ${bad.join(' | ')}`);
  process.exit(1);
}
console.log(`RIG_RESULT=${ok}/${ARMS.length}`);
