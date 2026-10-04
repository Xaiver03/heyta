#!/usr/bin/env node
/**
 * `scripts/check-detail-pane-slot.mjs` 的变异装置（工单 §8.74）。
 *
 * 判据守的是工单 §6 第 1/2/3 行（不许 emoji 当图标 / 不许空态插画 / 不许空态引导卡），
 * 射程是**从代码解析出来的**（槽区域 + 槽里每个内容生产者文件）。
 * 所以本装置最值钱的一条不是"塞个坏东西会红"，而是 A5：
 *   **新加一枚生产者 ⇒ 判据不用改就把它算进射程，并且真的抓到它身上的装饰。**
 * 没有 A5，"射程自动扩"就只是判据文件头里的一段话；N2 是它的另一半 ——
 * 新挂一枚**干净**的生产者必须放过，否则 A5 的红只证明"槽里多了一枚组件"，不证明"抓到装饰"。
 *
 * 每臂都断两件事：**红落在我点名的那条腿上**，而且**别的腿是 0**
 * （四条腿一起红等于四条腿都没有 —— 那多半是共享的解析层坏了，§8.39 同族）。
 *
 * 跑法（linked worktree 里别用 `pnpm run`）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-slot.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// 🔴 必须用 `fileURLToPath`：本仓库路径里有空格，`new URL(import.meta.url).pathname` 会把它们
// percent-encode 成 `All%20in%20one%20Data`。那个假路径当 cwd 传给 spawn，症状是
// `spawnSync git ENOENT` —— 读起来像"git 没了"，其实是装置自己造了一个不存在的目录。
// （本装置第一趟就是这么挂的，而 ENOENT 完全没有指向真正的原因。）
const HERE = dirname(fileURLToPath(import.meta.url));
// 仓库根直接从本文件的位置推（`research/tools/mutation-rigs` 往上三层）。
// 不用 `git rev-parse` 是因为装置要在临时树之间跳，而"哪棵树是载体"这件事必须由**装置自己的位置**回答，
// 不能让 spawn 的 cwd / PATH 决定 —— 那一趟就是这么挂的：spawnSync git 报 ENOENT，读起来像"git 没了"。
const repoRoot = resolve(HERE, '../../..');
if (!existsSync(join(repoRoot, 'scripts/check-detail-pane-slot.mjs'))) {
  console.error(`🔴 从装置位置推出来的仓库根里没有那道判据：${repoRoot} —— 装置被挪了地方，拒绝猜。`);
  process.exit(2);
}
const GATE = join(repoRoot, 'scripts/check-detail-pane-slot.mjs');
const APP_REL = 'apps/web/src/App.tsx';
const OCC_REL = 'apps/web/src/features/focus/FocusDetailPane.tsx';
/** 判据现在唯一认得的槽内容那一行；每一臂都从这里改靶。 */
const SLOT_LINE = `{contentView === 'focus' ? <FocusDetailPane /> : null}`;

const notes = [];
const bad = [];
const check = (arm, cond, detail) => (cond ? notes : bad).push(`  ${cond ? '✅' : '🔴'} ${arm}${detail ? ` —— ${detail}` : ''}`);

const scratch = mkdtempSync(join(tmpdir(), 'dp-slot-'));
const layDown = (name) => {
  const tree = join(scratch, name);
  for (const rel of [APP_REL, OCC_REL]) {
    const dest = join(tree, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(repoRoot, rel), 'utf8'), 'utf8');
  }
  return tree;
};

const mutateSlot = (tree, inner) => {
  const p = join(tree, APP_REL);
  const src = readFileSync(p, 'utf8');
  if (!src.includes(SLOT_LINE)) throw new Error('槽里那行条件渲染的字面形状变了，装置不知道怎么换靶 —— 拒绝猜。');
  writeFileSync(p, src.replace(SLOT_LINE, inner), 'utf8');
};
/** 往生产者文件末尾追加一段**真会被算进射程**的代码（不是注释）。 */
const mutateOccupant = (tree, code) => {
  const p = join(tree, OCC_REL);
  writeFileSync(p, `${readFileSync(p, 'utf8')}\n${code}\n`, 'utf8');
};
/** 在 App.tsx 里补一条相对路径 import（判据靠它把组件解析成文件）。 */
const addImport = (tree, name, rel) => {
  const p = join(tree, APP_REL);
  writeFileSync(p, `import ${name} from '${rel}';\n${readFileSync(p, 'utf8')}`, 'utf8');
};

const runGate = (tree, script = GATE) => {
  try {
    return { rc: 0, out: execFileSync(process.execPath, [script, '--root', tree], { cwd: repoRoot, encoding: 'utf8' }) };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};
const legs = (out) => {
  const m = out.match(/命中 A=(\d+) B=(\d+) C=(\d+) D=(\d+)/);
  if (!m) throw new Error(`判据没打"命中 A=… B=… C=… D=…"那行（输出形状变了），装置拒绝猜读数：\n${out.slice(0, 300)}`);
  return { A: +m[1], B: +m[2], C: +m[3], D: +m[4], all: +m[1] + +m[2] + +m[3] + +m[4] };
};
const producersOf = (out) => Number((out.match(/内容生产者 (\d+) 枚/) || [])[1] ?? -1);

// —— 基线：干净的两份文件必须全绿，否则后面每一臂都没有对照组
const base = runGate(layDown('base'));
const bl = legs(base.out);
check('对照 0 未变异的干净树 → RC=0 且四条腿都 0', base.rc === 0 && bl.all === 0, `RC=${base.rc} 生产者=${producersOf(base.out)} 枚`);

// A1 槽里直接手写一枚 <img>（滴答那种空态插画的形状）⇒ 腿 A + 腿 B
const t1 = layDown('a1');
mutateSlot(t1, `{contentView === 'focus' ? <FocusDetailPane /> : <img src="/empty.png" alt="" />}`);
const r1 = runGate(t1);
const l1 = legs(r1.out);
check('A1 槽里手写 <img> → 腿 A（手写标记）与腿 B（装饰图形）各自红，C/D 不许被牵连',
  r1.rc === 1 && l1.A >= 1 && l1.B >= 1 && l1.C === 0 && l1.D === 0, `A=${l1.A} B=${l1.B} C=${l1.C} D=${l1.D}`);

// A2 生产者里出现会被渲染的 emoji ⇒ 只有腿 C
const t2 = layDown('a2');
mutateOccupant(t2, 'export const DECOR_TEXT = "已完成 ✔";');
const r2 = runGate(t2);
const l2 = legs(r2.out);
check('A2 生产者里加一处渲染用 emoji → 只有腿 C 红',
  r2.rc === 1 && l2.C >= 1 && l2.A === 0 && l2.B === 0 && l2.D === 0, `C=${l2.C}（A=${l2.A} B=${l2.B} D=${l2.D}）`);

// A3 生产者里出现「新手引导」字样 ⇒ 只有腿 D
const t3 = layDown('a3');
mutateOccupant(t3, 'export const GUIDE_LABEL = "跟着新手引导走一遍";');
const r3 = runGate(t3);
const l3 = legs(r3.out);
check('A3 生产者里加「新手引导」→ 只有腿 D 红',
  r3.rc === 1 && l3.D >= 1 && l3.A === 0 && l3.B === 0 && l3.C === 0, `D=${l3.D}（A=${l3.A} B=${l3.B} C=${l3.C}）`);

// A4 把槽的定位锚改掉 ⇒ 判据必须**响亮地拒绝跑**，不许安静地"没有对象"
const t4 = layDown('a4');
{
  const p = join(t4, APP_REL);
  writeFileSync(p, readFileSync(p, 'utf8').replace('data-testid="detail-column"', 'data-testid="detail-column-x"'), 'utf8');
}
const r4 = runGate(t4);
check('A4 槽的 data-testid 被改走 → 响亮报"找不到那枚 aside / 配对失败"，不是安静通过',
  r4.rc === 1 && /找不到带|配对解析不出来/.test(r4.out) && !/都成立/.test(r4.out), `RC=${r4.rc}`);

// A5 🔴 新挂一枚**带装饰**的生产者 ⇒ 射程必须不用改判据就含它，并抓到里面的 <img>
const t5 = layDown('a5');
{
  const rel = 'apps/web/src/features/focus/NewDetailBlock.tsx';
  const dest = join(t5, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, 'export function NewDetailBlock() {\n  return <p><img src="/hero.png" /></p>;\n}\n', 'utf8');
  addImport(t5, '{ NewDetailBlock }', './features/focus/NewDetailBlock.js');
  mutateSlot(t5, `{contentView === 'focus' ? <FocusDetailPane /> : <NewDetailBlock />}`);
}
const r5 = runGate(t5);
const l5 = legs(r5.out);
check('A5 槽里新挂一枚生产者 → 射程自动含它（判据一字未改），且抓到它里面的 <img>',
  r5.rc === 1 && producersOf(r5.out) === 2 && l5.B >= 1 && /NewDetailBlock/.test(r5.out),
  `生产者=${producersOf(r5.out)} 枚 B=${l5.B} 点名新组件=${/NewDetailBlock/.test(r5.out)}`);
check('A5 的红只落在腿 B（别的腿 0 ⇒ 四条腿各判各的，A5 不是"整体坏了"）', l5.A === 0 && l5.C === 0 && l5.D === 0, `A=${l5.A} C=${l5.C} D=${l5.D}`);

// N1 只在**注释里**出现 emoji ⇒ 必须放过（挡"把 43 条状态记号当违规"那种假红）
const t6 = layDown('n1');
mutateOccupant(t6, '// 这里写过 ✔ 和 🔴，只是状态记号，不渲染');
const r6 = runGate(t6);
check('N1 注释里的 emoji → 放过（腿 C 只看会被渲染的部分）', r6.rc === 0 && legs(r6.out).all === 0, `RC=${r6.rc} 合计=${legs(r6.out).all}`);

// N2 新挂一枚**干净的**生产者 ⇒ 放过，且计数涨到 2（A5 的红因此只能来自装饰）
const t7 = layDown('n2');
{
  const dest = join(t7, 'apps/web/src/features/focus/CleanBlock.tsx');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, 'export function CleanBlock() {\n  return null;\n}\n', 'utf8');
  addImport(t7, '{ CleanBlock }', './features/focus/CleanBlock.js');
  mutateSlot(t7, `{contentView === 'focus' ? <FocusDetailPane /> : <CleanBlock />}`);
}
const r7 = runGate(t7);
check('N2 槽里新挂一枚无装饰的生产者 → 放过，且生产者计数=2', r7.rc === 0 && producersOf(r7.out) === 2, `RC=${r7.rc} 生产者=${producersOf(r7.out)} 枚`);

// —— 脱牙对照：把四条腿的命中集合清空，四臂都要因此失能（有一条仍能红 = 它没挂在那条腿上）
const neuter = join(scratch, 'gate-neutered.mjs');
const gateSrc = readFileSync(GATE, 'utf8');
const ANCHOR = '// —— 读数';
if (!gateSrc.includes(ANCHOR)) throw new Error('判据里找不到"// —— 读数"那行，脱牙脚本没有插入点，拒绝猜。');
writeFileSync(neuter, gateSrc.replace(ANCHOR, 'handWritten.length = 0; strayText.length = 0; decorHits.length = 0; emojiHits.length = 0; guideHits.length = 0;\n' + ANCHOR), 'utf8');
{
  const survived = [];
  for (const [name, tree] of [['A1', t1], ['A2', t2], ['A3', t3], ['A5', t5]]) {
    const n = runGate(tree, neuter);
    if (n.rc === 0) survived.push(name);
  }
  check('脱牙对照 摘掉四条腿的命中集合后，A1/A2/A3/A5 都不得仍然报红（四臂都得失能）',
    survived.length === 0, survived.length ? `摘牙后仍红：${survived.join('/')}` : '四臂全部失能');
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n读数：判据 ${GATE.split('/').pop()}｜基线命中 A=${bl.A} B=${bl.B} C=${bl.C} D=${bl.D}｜基线生产者 ${producersOf(base.out)} 枚`);
console.log(`\n${[...notes, ...bad].join('\n')}`);
if (bad.length) {
  console.log(`\n🔴 ${bad.length}/${notes.length + bad.length} 臂不合格`);
  process.exit(1);
}
console.log('\n结论：槽位判据的每一条腿都有"会响 / 会放过 / 射程会自己扩"三向读数 ✅');
