#!/usr/bin/env node
/**
 * `scripts/check-detail-pane-evidence-refs.mjs` 的变异臂（工单 §8.58 / §8.64）。
 *
 * 那条判据把「§8 读数含截图路径」从散文义务变成机器消费者：本线两份文档里每一处图片引用
 * 必须落到一枚**被仓库跟踪**的文件上。§4 要求它配变异臂 —— 第一趟 A1–A5 是手敲的一次性命令，
 * 下一轮没人能原样重放，所以固化成这个装置。
 *
 * 🔴 载体不能是本检出：臂 A2 要让「盘上有、仓库没跟踪」成立，最省事的做法是往
 * `apps/web/evidence/` 里拷一枚临时 png —— 而那正是 §7 里 Windows 打包段会收的东西
 * （`git ls-files -co --exclude-standard` 把未跟踪非忽略文件一起送出去）。
 * ⇒ 本装置全程在 `mkdtemp` 的一次性副本里跑：`git archive` 物化「全部跟踪图片 + 本线两份文档」，
 *   `git init` + `git add` 造出一份**独立索引**，然后所有注入都只改副本。
 *   仓库工作树、索引、别人在飞的产物都不碰。
 *
 * 跑法（linked worktree 里别用 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-evidence-refs.mjs
 *
 * 九臂的**预期**（A7/对照是两条阴性臂，它们的"不红"就是合格本身）：
 *   A1 全路径指向库里不存在的成员    → 红在「全路径引用在盘上不存在」，且只有这一条红
 *   A2 摘掉索引里一枚真被引用的 png → 红在「盘上有、仓库没跟踪」（这条腿只有独立索引能测）
 *   A3 只写裸文件名（库里有 2 族同名）→ 红在「简写引用无法唯一落到一个入库文件」，候选数逐条打出
 *   A4 分组里塞一枚不存在的成员      → 展开后仍走 A1 那条腿（证明展开不是装饰）
 *   A5 一篇不含图片引用的文档        → 红在「展开后引用 0 条」（拒绝在空读数上报绿）
 *   A6 花括号没闭合                  → 红在「token 形状本身解析不了」
 *   A7 引用一枚**中文文件名**的 png   → 必须**不红**且引用数 +1（守 `core.quotePath` + 字符类两次修复）
 *   A8 把判据自己的 `ls-files -z` 摘掉 → 红在「集合不完整… 拒绝报绿」（守 maxBuffer/引号转义两类漏收）
 *   对照 未变异的副本                → 全绿 RC=0
 *
 * 每臂除退出码外还断言**红落在点名那条腿**、并断言其余腿的红数不变 ——
 * 只看 RC 的臂会把"判据崩在别处"读成"变异成功"（本仓为同样的病修过一轮）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
// 第 3 个位置参数可换判据载体 —— 只给装置自身的**防呆对照**用（把判据阉割一份传进来，
// 若本装置仍报 11/11，说明这些臂是装饰而不是牙）。默认走仓库里那枚真判据。
const GATE = process.argv[2] ?? join(repoRoot, 'scripts/check-detail-pane-evidence-refs.mjs');
const DOCS = [
  'docs/plans/detail-pane-alignment.md',
  'docs/research/detail-pane-alignment-and-spaced-review.md',
];
const IMG = /\.(?:png|jpg|jpeg|webp)$/;

const universe = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0')
  .filter(Boolean)
  .filter((p) => IMG.test(p));
const nonAscii = universe.filter((p) => /[^\x00-\x7F]/.test(p));
if (universe.length === 0 || nonAscii.length === 0) {
  console.log('🔴 装置前置不成立：图片宇宙为空或没有非 ASCII 样本，A2/A7 两臂会退化成永真 —— 直接拒绝跑。');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'dp-refs-'));
const fail = [];
const notes = [];

// ── 载体：git archive 物化 + 独立索引 ──────────────────────────────────
const tar = spawnSync('tar', ['-x', '-C', scratch], {
  input: execFileSync('git', ['archive', 'HEAD', ...universe, ...DOCS], { maxBuffer: 1 << 28 }),
});
if (tar.status !== 0) {
  console.log(`🔴 副本解包失败：${tar.stderr}`);
  process.exit(1);
}
const g = (args) => execFileSync('git', ['-C', scratch, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
g(['init', '-q']);
g(['add', '-A']);

const run = (args = []) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: scratch, encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
const num = (out, label) => Number(out.match(new RegExp(`${label} (\\d+) 条`))?.[1] ?? NaN);
const redCount = (out, title) => {
  // printList 打的是 `\n<标题>（N 条）：` —— 分隔符已含 `（`，所以 seg 开头是数字。
  const seg = out.split(`\n${title}（`)[1];
  if (!seg) return 0;
  return Number(seg.match(/^(\d+) 条）/)?.[1] ?? 0);
};
const LEGS = [
  '🔴 全路径引用在盘上不存在',
  '🔴 盘上有、仓库没跟踪（干净检出上不存在）',
  '🔴 简写引用无法唯一落到一个入库文件（0 个或歧义）',
  '🔴 token 形状本身解析不了',
];

const check = (arm, cond, detail) => {
  if (cond) {
    notes.push(`  ✅ ${arm}${detail ? ` —— ${detail}` : ''}`);
    return true;
  }
  fail.push(`  🔴 ${arm}${detail ? ` —— ${detail}` : ''}`);
  return false;
};

/** 期望：点名那条腿恰好 +1 条红，其余腿维持基线，RC=1。 */
const expectRedOn = (arm, out, leg, baseline) => {
  if (out.includes('拒绝给出"通过"的结论') || out.includes('集合不完整')) {
    return check(arm, false, '判据本身崩了（不是注入命中）');
  }
  const now = Object.fromEntries(LEGS.map((l) => [l, redCount(out, l)]));
  const hitLegs = LEGS.filter((l) => now[l] > baseline[l]);
  const ok =
    now[leg] === baseline[leg] + 1 && hitLegs.length === 1 && out.includes('🔴') && !out.includes('✅');
  return check(
    arm,
    ok,
    `命中腿 ${hitLegs.join('|') || '无'}｜${leg} ${baseline[leg]}→${now[leg]}｜其余腿 ${LEGS.filter((l) => l !== leg)
      .map((l) => `${l.replace(/^🔴 /, '').slice(0, 6)}:${baseline[l]}→${now[l]}`)
      .join(' ')}`,
  );
};

// ── 从文档里挑一条"唯一 basename 的全路径引用"当 A1/A2 的靶 ──────────────
const baseUniverse = new Map();
for (const p of universe) {
  const b = p.split('/').pop();
  baseUniverse.set(b, (baseUniverse.get(b) || 0) + 1);
}
const cited = [];
for (const d of DOCS) {
  const text = readFileSync(join(scratch, d), 'utf8');
  for (const m of text.match(/apps\/[^\s`|{},]*\.(?:png|jpg|jpeg|webp)/g) || []) cited.push(m);
}
const target = cited.find((p) => universe.includes(p) && baseUniverse.get(p.split('/').pop()) === 1);
if (!target) {
  console.log('🔴 没找到"被文档引用且 basename 唯一"的真实全路径 —— A1/A2 的靶取不出来，装置无效。');
  process.exit(1);
}
const AMBIG = 'packaged-first-run.png';
const ambigHits = universe.filter((p) => p.split('/').pop() === AMBIG);
if (ambigHits.length < 2) {
  console.log(`🔴 A3 的前提不成立：${AMBIG} 在库里只有 ${ambigHits.length} 枚，歧义腿测不到。`);
  process.exit(1);
}
const zhTarget = nonAscii.find((p) => !cited.includes(p)) ?? nonAscii[0];

// ── 基线 ────────────────────────────────────────────────────────────
const base = run();
const baseline = Object.fromEntries(LEGS.map((l) => [l, redCount(base.out, l)]));
const baseExpanded = num(base.out, '花括号展开后引用');
check('对照 未变异副本全绿', base.rc === 0 && baseExpanded > 0, `RC=${base.rc}，引用 ${baseExpanded} 条`);
if (base.rc !== 0) {
  console.log(base.out);
  console.log('🔴 基线就是红的，后面每臂的"恰好 +1"都失去意义 —— 先修载体。');
  process.exit(1);
}

/** 往副本里的工单文档追加一行引用、跑一次、再原样收回（只改副本，仓库工作树不动）。 */
const arm = (label, text) => {
  const doc = join(scratch, DOCS[0]);
  const original = readFileSync(doc, 'utf8');
  writeFileSync(doc, `${original}\n<!-- rig ${label} -->\n${text}\n`, 'utf8');
  const res = run();
  writeFileSync(doc, original, 'utf8');
  return res;
};

// A1
const a1 = `${dirname(target)}/a1-not-a-real-shot.png`;
expectRedOn('A1 全路径指向不存在的成员', arm('A1', `\`${a1}\``).out, LEGS[0], baseline);

// A2：把一枚真被引用的 png 从索引里摘掉（盘上还在）→ 只有独立索引能测这半条腿
g(['rm', '--cached', '-q', '--', target]);
const a2 = run();
expectRedOn('A2 盘上有、仓库没跟踪', a2.out, LEGS[1], baseline);
g(['add', '-A', '--', target]);
const a2b = run();
check('A2 复位后回到基线', a2b.rc === 0, `RC=${a2b.rc}`);

// A3
expectRedOn(
  'A3 裸文件名撞同名',
  (() => {
    const res = arm('A3', '`' + AMBIG + '`');
    const want = `候选 ${ambigHits.length} 个`;
    if (!res.out.includes(want)) fail.push(`  🔴 A3 没打出候选数「${want}」`);
    return res.out;
  })(),
  LEGS[2],
  baseline,
);

// A4：分组里一枚真成员 + 一枚假成员 ⇒ 展开后假的那条走 A1 的腿（证明展开不是装饰）
const realBase = target.split('/').pop().replace(/\.(png|jpg|jpeg|webp)$/, '');
const a4Group = `${dirname(target)}/{${realBase},a4-not-a-real-shot}.png`;
const a4 = arm('A4', '`' + a4Group + '`');
expectRedOn('A4 分组里的假成员', a4.out, LEGS[0], baseline);
check(
  'A4 展开确实进集合（引用数 +2）',
  num(a4.out, '花括号展开后引用') === baseExpanded + 2,
  `引用 ${baseExpanded}→${num(a4.out, '花括号展开后引用')}`,
);

// A5：一篇不含图片引用的文档 ⇒ 拒绝在 0 读数上报绿
const emptyDoc = join(scratch, 'rig-no-image-refs.md');
writeFileSync(emptyDoc, '# 只是文字，没有图片引用\n\n什么图都没指。\n', 'utf8');
const a5 = run([emptyDoc]);
check('A5 引用 0 条拒绿', a5.rc === 1 && a5.out.includes('展开后引用 0 条'), `RC=${a5.rc}`);

// A6：花括号没闭合
expectRedOn('A6 token 形状解析不了', arm('A6', '`apps/web/evidence/{a6-no-close.png`').out, LEGS[3], baseline);

// A7（阴性臂 / 阳性样本）：引用一枚**中文文件名**的 png —— 必须不红且引用数 +1
const a7 = arm('A7', '`' + zhTarget + '`');
check(
  'A7 中文文件名可见（不红 + 引用数 +1）',
  a7.rc === 0 && num(a7.out, '花括号展开后引用') === baseExpanded + 1,
  `RC=${a7.rc}，引用 ${baseExpanded}→${num(a7.out, '花括号展开后引用')}，靶 ${zhTarget}`,
);

// A8：把判据自己的 `ls-files -z` 摘掉 ⇒ 非 ASCII 路径被引号转义、集合漏收 ⇒ 守卫必须响亮拒绝
const mutatedGate = join(scratch, 'rig-gate-no-z.mjs');
const gateSrc = readFileSync(GATE, 'utf8');
if (!gateSrc.includes("['ls-files', '-z']")) {
  console.log('🔴 A8 的前提变了：判据里取集合的那句不再是 `ls-files -z`，臂要跟着改。');
  process.exit(1);
}
writeFileSync(mutatedGate, gateSrc.replace("['ls-files', '-z']", "['ls-files']"), 'utf8');
const a8raw = spawnSync(process.execPath, [mutatedGate], { cwd: scratch, encoding: 'utf8' });
const a8out = `${a8raw.stdout}${a8raw.stderr}`;
check(
  'A8 集合守卫拒绿',
  a8raw.status === 1 && a8out.includes('集合不完整'),
  `RC=${a8raw.status}`,
);

// 对照
const control = run();
check('对照 恢复干净后全绿', control.rc === 0, `RC=${control.rc}`);

rmSync(scratch, { recursive: true, force: true });

console.log(`\n读数：集合 ${universe.length} 枚（非 ASCII ${nonAscii.length} 枚）｜基线引用 ${baseExpanded} 条｜歧义靶 ${AMBIG} 有 ${ambigHits.length} 枚同名`);
console.log('\n'.concat(...notes, '\n', ...fail).trimEnd());
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/11 臂不合格`);
  process.exit(1);
}
console.log('\n结论：11/11 臂符合预期（9 变异 + 2 阴性对照）✅');
