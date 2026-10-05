#!/usr/bin/env node
/**
 * 习惯面「回落规则跨视图统一」（工单 §8.131）的变异臂台。
 *
 * 钉的东西：`HabitsView` 里"哪一条是选中的"只许由共享选中态回答。
 * 这一处曾经是 `rows.find(…) ?? rows[0]` —— 宿主猜第一条。猜的后果不是难看，是
 * **同一屏上两句互相矛盾的话**：列表把 `aria-current` 挂在猜来的那一行，
 * 而共享选中态是 null（详情列按后者维持 AI）。W1 要"各处同一套状态与回落规则"，
 * 便签面（K8）与任务面都是零行，习惯面是 web 上最后一处例外。
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
    name: 'A1 把"猜第一条"的回落装回去（`?? rows[0]`）',
    apply: () =>
      sub(F.view, 'const selected = rows.find((r) => r.progress.habit.id === selectedId);', 'const selected = rows.find((r) => r.progress.habit.id === selectedId) ?? rows[0];', 1),
    expectFailed: 3,
    needles: ['没人点过时**零行**带 aria-current', '回到**未选中**', '不许再有"猜第一条"的回落'],
  },
  {
    // 这一臂打的是**措辞**那一半：回落撤掉之后窗格必须说"选一条"，而不是共享层那句"还没有习惯"。
    name: 'A2 空态不分状态（恒用共享层那句「还没有习惯」）',
    apply: () => sub(F.view, "empty: rows.length === 0 ? t('web.habits.empty') : t('web.habits.pane.pickOne'),", "empty: t('web.habits.empty'),", 1),
    expectFailed: 2,
    needles: ['没人点过时**零行**带 aria-current', '回到**未选中**'],
  },
  {
    // A3 与 A1 打的是**不同的链接**：A1 改派生值本身，这一臂保持派生值不动、
    // 只把列表痕迹的输入换成"派生值 + 再猜一次"。装配处那一行才是界面说话的那一侧。
    name: 'A3 左列痕迹改回读派生值并猜第一条（模型说没选中、界面说第 0 行）',
    apply: () => sub(F.view, 'selectedId={selectedId}', 'selectedId={selected?.progress.habit.id ?? rows[0]?.progress.habit.id ?? null}', 1),
    // ⚠️ 第一版这里写的是 `rows[0]?.id` —— 行对象上没有 `id`（是 `{progress, week}`），
    // 那个 undefined 让"猜位置"退化成了"没猜"，于是 C1/C5 照样绿，只有源码级那两条红。
    // **臂打空了不会自己说**：预期红集是按"这一臂改的是哪根线"写的，不是按它实际打到了什么。
    expectFailed: 4,
    needles: ['没人点过时**零行**带 aria-current', '回到**未选中**', '左列的痕迹接的是共享选中态本身', '不许再有"猜第一条"的回落'],
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
        F.view,
        'habits={selected === undefined ? [] : [selected.progress.habit]}',
        'habits={selected === undefined ? [] : [rows.find((r) => r.progress.habit.id !== selected.progress.habit.id) ?? selected.progress.habit]}',
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

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  try {
    arm.apply();
  } catch (e) {
    console.log(`🔴 ${arm.name} → 注入失败：${e.message}`);
    bad.push(arm.name);
    restore();
    continue;
  }
  const t = run();
  restore();
  const residue = files.filter((rel) => {
    const now = createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    return now !== origMd5[rel];
  });
  const missing = arm.needles.filter((n) => !t.titles.some((title) => title.includes(n)));
  const hit =
    t.rc !== 0 && t.failed === arm.expectFailed && missing.length === 0 && residue.length === 0;
  console.log(
    `${hit ? '✅' : '🔴'} ${arm.name} → ${t.line || '(读不到汇总行)'}｜预期红 ${arm.expectFailed} 条` +
      `${missing.length ? `｜没点到的红：${missing.join(' / ')}` : ''}` +
      `${t.titles.length === 0 && t.failed > 0 ? '｜⚠️ 解析不出 FAIL 标题（reporter 换标记了？）' : ''}` +
      `${residue.length ? `｜残留=${residue.join(',')}` : ''}`,
  );
  if (t.failed > 0) console.log(`   红集：${t.titles.join(' ‖ ') || '(空)'}`);
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
