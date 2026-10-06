#!/usr/bin/env node
/**
 * 便签编辑卡落点（详情列 / 板子上方）的变异臂（工单 §8.130）。
 *
 * 钉的东西：`NoteEditorCard` 这一份实现有两个落点，靠一个布尔选一支。
 * 那个布尔一旦被写死、被绕开、或者与 CSS 的三条隐藏规则失去同源，界面上**不会报错** ——
 * 最坏的形状是"窄屏点便签得到一枚藏在 `display:none` 里的编辑器"：看着没反应，选中态却已进模型。
 * 所以每一臂都改的是**那条判据的输入**，红集必须恰好落在指定那一条上。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-note-editor-placement.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const F = {
  app: 'apps/web/src/App.tsx',
  view: 'apps/web/src/features/notes/NotesView.tsx',
  card: 'apps/web/src/features/notes/NoteEditorCard.tsx',
  vis: 'apps/web/src/features/shell/detail-pane-visible.ts',
};
const SPEC = 'tests/note-editor-placement.spec.tsx';

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
  // 汇总行两个坑（缩进 + 词序随结果变）见 mutate-habit-rate-label.mjs 的注释，这里同一套读法。
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  return {
    rc: r.status ?? 1,
    out,
    line: line.trim(),
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? 0),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? 0),
  };
};

const ARMS = [
  {
    name: 'A1 摘掉"那一栏看得见"这个条件（恒按宽屏放）',
    apply: () => sub(F.app, "contentView === 'notes' && detailColumnShown ? (", "contentView === 'notes' ? (", 1),
    needle: '详情列里那一支带的是**几何 + 收起**两个条件，不是恒真',
  },
  {
    name: 'A2 递给 NotesView 的布尔写死成恒真',
    apply: () => sub(F.app, 'editorInColumn={detailColumnShown}', 'editorInColumn', 1),
    needle: '递给 NotesView 的是同一个布尔',
  },
  {
    name: 'A3 NotesView 不再看开关（两支同时渲染）',
    apply: () => sub(F.view, '{editorInColumn ? null : <NoteEditorCard inset={false} />}', '{<NoteEditorCard inset={false} />}', 1),
    needle: '`editorInColumn=true` ⇒ 板子上方那枚不存在',
  },
  {
    // 🔴 这一臂**不能**改成"把 useSelected 换成常量 id"：那样「没选中 ⇒ 一枚都没有」也会一起红
    // （常量永远有值），红集就不是"恰好那一条"了，而这条判据要钉的是**跟着换**而不是**有没有**。
    // `key={editing.id}` 是承重的那颗螺丝：共享 NoteEditor 用 useState(initialContent) 播种草稿，
    // 没有它，换选中时 React 复用同一个实例 ⇒ 面单还是旧那条。
    name: 'A4 写死编辑器实例的 key（换选中时面单不跟着换）',
    apply: () => sub(F.card, 'key={editing.id}', 'key="note-editor-static"', 1),
    needle: '面单内容跟着选中走',
  },
  {
    name: 'A5 查询串与 CSS 失去同源（改成 900px）',
    apply: () => sub(F.vis, "'(min-width: 1024px) and (min-height: 480px)'", "'(min-width: 900px) and (min-height: 480px)'", 1),
    needle: '查询串与 narrow.css 的三条隐藏规则同源',
  },
  {
    name: 'A6 把开关降级成"默认值等于原行为"的可选 prop',
    apply: () => sub(F.view, 'editorInColumn: boolean', 'editorInColumn?: boolean', 1),
    needle: '是必填 prop',
  },
  {
    // A7/A8 是 inset 那一档的两条腿：**壳在不在**与**宿主有没有递参数**。
    // 它们照的是同一处缺陷的两个不同成因（生产者丢壳 / 装配处漏参数），
    // 合成一臂就会漏掉另一半。
    name: 'A7 生产者不再包那一层内边距壳',
    apply: () =>
      sub(
        F.card,
        'return inset ? <div className="ht-app__detail-note">{face}</div> : face;',
        'return face;',
        1,
      ),
    needle: 'inset 只有栏里那一支拿到',
  },
  {
    name: 'A8 装配处漏递 inset（宿主没接）',
    apply: () => sub(F.app, '<NoteEditorCard inset />', '<NoteEditorCard />', 1),
    needle: '详情列里找不到 NoteEditorCard',
  },
];

const base = run();
console.log(`基线：${base.line}`);
if (base.rc !== 0 || base.failed !== 0 || base.passed === 0) {
  console.log('VERDICT=PROBE_BROKEN 基线不干净，臂台没有资格判红');
  console.log(base.out.slice(-1500));
  process.exit(2);
}
const BASE_PASSED = base.passed;

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  arm.apply();
  const t = run();
  restore();
  const residue = files.filter((rel) => {
    const now = createHash('md5').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    return now !== origMd5[rel];
  });
  const hit = t.rc !== 0 && t.failed === 1 && t.passed === BASE_PASSED - 1 && t.out.includes(arm.needle);
  console.log(`${hit ? '✅' : '🔴'} ${arm.name} → ${t.line || '(读不到汇总行)'}${residue.length ? ` 残留=${residue.join(',')}` : ''}`);
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
