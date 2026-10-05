#!/usr/bin/env node
/**
 * 习惯面「回落规则跨视图统一」（工单 §8.131）的变异臂台。
 *
 * 钉的东西：习惯面"哪一条是选中的"只许由共享选中态回答。
 * 这一处曾经是 `rows.find(…) ?? rows[0]` —— 宿主猜第一条。猜的后果不是难看，是
 * **同一屏上两句互相矛盾的话**：列表把 `aria-current` 挂在猜来的那一行，
 * 而共享选中态是 null（详情列按后者维持 AI）。W1 要"各处同一套状态与回落规则"，
 * 便签面（K8）与任务面都是零行，习惯面是 web 上最后一处例外。
 *
 * ⚠️ **§8.133 搬家后本台的落点文件变了**（面单从 `HabitsView.tsx` 搬进 `HabitDetailCard.tsx`）：
 * A1/A2/A5 现在打的是卡片那三份新文件里的**同一根线**，A3 仍打视图（左列痕迹的输入住在装配处）。
 * 载体也仍是 `habits-list-pane.spec.tsx` —— 它挂的是 `paneInColumn={false}` 那一支，
 * 所以卡片的行为改动能从视图上读出来。这一台与 `mutate-habit-detail-card.mjs` **不是重复**：
 * 那边打的是"落点/inset/两条空态"，这边打的是"谁被选中"，两边各挂各的用例集合。
 * 判据那侧配套的放宽（`rows[0]` → 任何下标 0）记在 `habits-list-pane.spec.tsx` 的 G 组。
 *
 * ⚠️ 与 `mutate-note-editor-placement.mjs` 不同的一点：那一台的每臂预期是"恰好 1 红"，
 * 这一台**不是** —— 一条"猜位置"的回落同时被三条判据看着（零痕迹那条、删除后的结局那条、
 * 源码形状那条）。所以每臂自带 `expectFailed` 与 needle 集合，红集逐条点名。
 * **把预期写成 1 会把"多红了"读成"臂没牙"** —— 那正是 §7 元规则 2 的反面。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habits-selection-fallback.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const F = {
  view: 'apps/web/src/features/habits/HabitsView.tsx',
  card: 'apps/web/src/features/habits/HabitDetailCard.tsx',
  list: 'apps/web/src/features/habits/HabitsList.tsx',
};
const SPEC = 'tests/habits-list-pane.spec.tsx';

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
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim();
  return {
    rc: r.status ?? 1,
    out,
    line,
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? 0),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? 0),
    // 红集的**标题**：vitest 的 FAIL 行形如
    // `FAIL  tests/x.spec.tsx > 组名 > 用例名`。解析不出来要单独打印 ——
    // 不然 reporter 改了标记会被读成"臂没牙"（同一族事故见 mutate-detail-pane-note-editor-e2e.mjs）。
    titles: [...out.matchAll(/FAIL\s+\S+\.spec\.tsx\s+>\s+([^\n]+?)\s*$/gm)].map((m) => m[1].trim()),
  };
};

const ARMS = [
  {
    // §8.133 之前这一臂打在视图里那行 `rows.find(…)`；同一根线现在住在卡片。
    name: 'A1 把"猜第一条"的回落装回去（`?? store.habits[0]`）',
    apply: () =>
      sub(
        F.card,
        'const selected = store.habits.find((habit) => habit.id === selectedId);',
        'const selected = store.habits.find((habit) => habit.id === selectedId) ?? store.habits[0];',
        1,
      ),
    expectFailed: 3,
    needles: ['没人点过时**零行**带 aria-current', '回到**未选中**', '不许再有"猜第一条"的回落'],
  },
  {
    // 这一臂打的是**措辞**那一半：回落撤掉之后窗格必须说"选一条"，而不是共享层那句"还没有习惯"。
    name: 'A2 空态不分状态（恒用共享层那句「还没有习惯」）',
    apply: () => sub(F.card, '      empty: paneEmptyText(t, store.habits.length > 0),\n', '', 1),
    expectFailed: 2,
    needles: ['没人点过时**零行**带 aria-current', '回到**未选中**'],
  },
  {
    // A3 与 A1 打的是**不同的链接**：A1 改卡片那一侧"展开哪一条"，这一臂改**左列痕迹的输入**。
    // 装配处那一行才是界面说话的那一侧。
    name: 'A3 未选中时左列痕迹猜第一条（模型说没选中、界面说第 0 行）',
    apply: () =>
      sub(
        F.view,
        'selectedId={selectedId}',
        'selectedId={selectedId ?? rows[0]?.progress.habit.id ?? null}',
        1,
      ),
    /* ⚠️ 第一版这里写的是 `rows[0]?.id` —— 行对象上没有 `id`（是 `{progress, week}`），
       那个 undefined 让"猜位置"退化成了"没猜"，于是 C2/C5 照样绿，只有源码级那两条红。
       **臂打空了不会自己说**：预期红集是按"这一臂改的是哪根线"写的，不是按它实际打到了什么。

       🔴 第二版（2026-10-05 实测）写的是**无条件** `rows[0]?... ?? selectedId`，红集**每趟不一样**
       （三趟：5 / 10 / 6 红）—— 因为"痕迹永远钉第 0 行"与"用例点的那一行"是否重合取决于随机
       UUID 排出来的顺序，于是 D/E 那几条顺带红或不红。这正是本文件 A5 注释里记着的同一族坑，
       我这次是自己又踩了一遍。改成只在"没选中"那一档猜（= §8.131 撤掉的那个真实形状）之后
       红集与顺序无关，所以本文件末尾加了 `PASSES=2` 的复跑对账，红集漂就判臂不合格。

       🔴 C5「选中项被删掉时回到未选中」**不在**这一臂的半径里，而且这不是判据漏了：
       删除之后 `selectedId` 是那条**已删的 id**而不是 `null`（实测：基线与变异态里 `markedRows()`
       都是 0，因为没有行的 id 等于它），`selectedId ?? rows[0]` 因此短路、不会去猜。
       "删完自动选下一条"那一档由 A1（卡片那一侧的 `?? store.habits[0]`）覆盖 —— 它确实红 C5。
       把这行写下来是因为**"这条判据没红"和"这条判据守的不是这件事"是两件不同的事**，
       前者要改判据，后者只要求臂别说谎。 */
    expectFailed: 3,
    needles: [
      '没人点过时**零行**带 aria-current',
      '左列的痕迹接的是共享选中态本身',
      '不许再有"猜第一条"的回落',
    ],
  },
  {
    name: 'A4 把 `selectedId` 的空值降级成 `undefined`（两种空互相冒充）',
    apply: () => sub(F.list, 'selectedId: string | null;', 'selectedId: string | undefined;', 1),
    expectFailed: 1,
    needles: ['空值是 `null`'],
  },
  {
    // 这一臂不是改"选没选中"，而是让**窗格画的那条**与**列表标记的那条**分叉。
    // 有 A1/A3 挡不住它：那两臂改的是判据输入的另一侧，而这里两边各自都"自洽"，
    // 只有"痕迹说的是谁 == 窗格画的是谁"这一条能抓住。
    name: 'A5 窗格永远画**另一条**（痕迹与内容分叉）',
    /* ⚠️ 第一版注入的是"永远画 rows[0]"，红集**随列表顺序漂**（同一臂两趟：6 红 / 4 红）——
       因为 rows[0] 有时恰好就是用例选中的那一条，C2/C4 就漏掉了。
       现在改成"永远画**另一条**"，与顺序无关：凡是"窗格画的人 == 痕迹指的人"这类判据必红。
       记下来：一臂的预期红集必须**只由判据决定**，不许由夹具的偶然顺序决定。 */
    apply: () =>
      sub(
        F.card,
        'habits={selected === undefined ? [] : [selected]}',
        'habits={selected === undefined ? [] : [store.habits.find((h) => h.id !== selected.id) ?? selected]}',
        1,
      ),
    expectFailed: 3,
    needles: ['窗格与 aria-current 说的是同一条', '点另一行后窗格换人', '只给选中那一条渲染打卡按钮'],
  },
];

const base = run();
console.log(`基线：${base.line}`);
if (base.rc !== 0 || base.failed !== 0 || base.passed === 0) {
  console.log('VERDICT=PROBE_BROKEN 基线不干净，臂台没有资格判红');
  console.log(base.out.slice(-1200));
  process.exit(2);
}

/* 🔴 每臂**跑两趟**，且要求两趟的红集**逐字相同**。
   这一条不是装饰：A3 的第二版就是靠它现形的 —— 无条件钉第 0 行时三趟红集是 5/10/6，
   而单趟运行只要"恰好包含点名那几条"就会报绿，把"判据的半径取决于随机 UUID 排序"
   这件事藏在自己手里（A5 的注释记着同一族事故，这次是我自己又踩了一遍）。
   复跑不稳定 = 臂没有资格宣称它钉住了什么。 */
const PASSES = 2;

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  const passes = [];
  let injectError = '';
  for (let i = 0; i < PASSES; i += 1) {
    try {
      arm.apply();
    } catch (e) {
      injectError = e.message;
      restore();
      break;
    }
    passes.push(run());
    restore();
  }
  if (injectError) {
    console.log(`🔴 ${arm.name} → 注入失败：${injectError}`);
    bad.push(arm.name);
    continue;
  }
  const residue = files.filter((rel) => {
    const now = createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    return now !== origMd5[rel];
  });
  const sets = passes.map((t) => [...t.titles].sort().join(' ‖ '));
  const stable = sets.every((s) => s === sets[0]);
  const missing = arm.needles.filter((n) => !passes[0].titles.some((title) => title.includes(n)));
  const hit =
    passes.every((t) => t.rc !== 0 && t.failed === arm.expectFailed) &&
    missing.length === 0 &&
    stable &&
    residue.length === 0;
  console.log(
    `${hit ? '✅' : '🔴'} ${arm.name} → 两趟：${passes.map((t) => t.line || '(读不到汇总行)').join(' ｜ ')}` +
      `｜预期红 ${arm.expectFailed} 条` +
      `${missing.length ? `｜没点到的红：${missing.join(' / ')}` : ''}` +
      `${stable ? '' : '｜🔴 红集随复跑漂（判据半径取决于夹具顺序，不是取决于判据）'}` +
      `${passes[0].titles.length === 0 && passes[0].failed > 0 ? '｜⚠️ 解析不出 FAIL 标题（reporter 换标记了？）' : ''}` +
      `${residue.length ? `｜残留=${residue.join(',')}` : ''}`,
  );
  if (passes[0].failed > 0) console.log(`   红集：${passes[0].titles.join(' ‖ ') || '(空)'}`);
  if (hit) ok += 1;
  else bad.push(arm.name);
}

if (md5Clean()) {
  console.log(`复原：BACK_TO_CLEAN=true 复跑=${run().line}`);
} else {
  console.log('🔴 复原失败：文件与基线 md5 不同，必须手工核对');
  process.exit(1);
}

function md5Clean() {
  return files.every((rel) => {
    const now = createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    return now === origMd5[rel];
  });
}

console.log(`ARMS=${ARMS.length} AS_EXPECTED=${ok} FAIL=${bad.length}`);
if (bad.length) {
  console.log(`未如预期：\n- ${bad.join('\n- ')}`);
  console.log('RIG_RESULT=' + `${ok}/${ARMS.length}`);
  process.exit(1);
}
console.log(`RIG_RESULT=${ok}/${ARMS.length}`);
