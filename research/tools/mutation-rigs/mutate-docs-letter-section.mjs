#!/usr/bin/env node
/**
 * `check:docs` 章节引用解析器"字母后缀那一档"的变异臂（`research/tools/docs-link-check.mjs`）。
 *
 * 来历：2026-10-04 合流现场取证时，本仓库唯一的 `check:docs` 章节引用红是
 * `docs/plans/countdown-anniversary.md:1280 -> docs/adr/README.md §1  该章节号不存在`，
 * 而**那条引用本来就是对的** —— 原文写的是 `§1a`，目标文件里有 `### 1a. 「勘误段」…`（第 31 行），
 * 而 `## 1. 背景与约束` 只在"模板"那个代码块里出现（被 fence 排除）。
 * 也就是说红的是解析器，不是文档。
 *
 * 🔴 同一个截断在另一个方向上是**假绿**，而且更贵：
 * `docs/plans/user-journey-and-auth.md:334` 与 `BLOCKED.md:245` 都引用 `§4d`，
 * 而目标 `docs/research/spikes/m2-webview-shell/README.md` **同时**有 `## 4.`（第 80 行）
 * 和 `## 4d.`（第 198 行）—— 截成 `4` 之后照样"存在"，于是那条引用检查的是**错的那一节**：
 * 把 `## 4d.` 改名或整节删掉，`check:docs` 一路绿灯。
 * 一个缺陷的两个方向，症状相反（一个吵、一个不吵），这正是本文件自己记的那对
 * "互相掩护"缺陷的同形第三例。
 *
 * 跑法（仓库根；linked worktree 里不要 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-docs-letter-section.mjs
 *
 * 五臂**按报错文案点名**判定（只数 rc 不够：本载体基线 rc=1 来自另一枚
 * `PROGRESS.md:1362` 的死链，它的目标只存在于 main / 合并候选树里，与本单无关）：
 *   L1 只回退解析侧（引用正则摘掉字母档）   → 自检那两条解析臂必须红
 *   L2 只回退索引侧（标题正则摘掉字母档）   → 自检那三条索引臂必须红
 *   L3 两侧一起回退（= 修之前的原状）       → 🔴 **仍然要红**：原状对自检是隐形的，
 *      这一臂证明新增那五条臂真的承重，而不是"修完之后顺便加装饰"
 *   L5 定向假绿：索引把字母档归一化进数字父节（`## 4d.` 造出一个 `4`）
 *      → 「4d 那节不许替 4 占位」+「字母后缀标题要进索引」必须红
 *   L4 阴性对照：`§1a` / `### 1a.` 只写进目标文件的块注释 → 必须不红（判据读的是正则本身，不是字样）
 *
 * 每臂跑完复原；五臂全按预期且 `FINAL_SAME=true` 才 exit 0。
 * ⚠️ 不挂进 `pnpm check`（与 `mutation-rigs/` 其他臂同一口径：装置是取证，不是门禁）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const TARGET = 'research/tools/docs-link-check.mjs';
const md5 = () => createHash('md5').update(readFileSync(`${ROOT}/${TARGET}`)).digest('hex');
const BASE_MD5 = md5();
const ORIG = readFileSync(`${ROOT}/${TARGET}`, 'utf8');

// 判据读的是**文案**，不是 rc：本载体 rc=1 是常态（那枚死链只在落后载体里成立）。
const NEEDLE = {
  // 解析器把 §1a 截成 §1 时，才会出现这一行"该章节号不存在"的章节引用红。
  FALSE_RED: 'docs/adr/README.md §1',
  // 自检臂的标签（assertSelfTest 里 eq 的第一参数原样打印在 problems 里）。
  PARSE_ARMS: ['§1a 要整体解析（不能截成 1）', '§4d 要整体解析（不能截成 4）'],
  // L2/L3 会打红这两条（索引里根本没有字母键）。
  INDEX_ARMS: ['字母后缀标题要进索引', '4 与 4d 是两个键，不能并成一个'],
  // 这一条**只有 L5 能打红**（把标题键的字母摘掉，`## 4d.` 才会在索引里造出 `4`）——
  // 记下来是为了不让人把"L2 没打红它"读成"这条臂没牙"：它钉的是另一个方向的回归。
  FAKE_GREEN_ARM: ['4d 那节不许替 4 占位'],
};

const sub1 = (src, oldStr, newStr, label) => {
  const hits = src.split(oldStr).length - 1;
  if (hits !== 1) throw new Error(`锚点「${label}」命中 ${hits} 次，期望 1 次 —— 先修臂再跑`);
  return src.replace(oldStr, newStr);
};

const REF_RE_OLD = 'const SECTION_REF_RE = /([A-Za-z0-9_./-]+\\.md)`?\\s*§\\s*(\\d+[a-z]?(?:\\.\\d+)*)/g;';
const REF_RE_MUTATED = 'const SECTION_REF_RE = /([A-Za-z0-9_./-]+\\.md)`?\\s*§\\s*(\\d+(?:\\.\\d+)*)/g;';
const HEAD_RE_OLD = 'const m = /^#{2,6}\\s+(\\d+[a-z]?(?:\\.\\d+)*)[.、\\s]+(.*)$/.exec(rawLine);';
const HEAD_RE_MUTATED = 'const m = /^#{2,6}\\s+(\\d+(?:\\.\\d+)*)[.、\\s]+(.*)$/.exec(rawLine);';

const runCheck = () => {
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', [TARGET], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  return { rc, out };
};

const arms = [
  {
    name: 'L1 只回退解析侧',
    apply: (s) => sub1(s, REF_RE_OLD, REF_RE_MUTATED, 'L1 引用正则'),
    expect: { any: NEEDLE.PARSE_ARMS, none: [] },
  },
  {
    name: 'L2 只回退索引侧',
    apply: (s) => sub1(s, HEAD_RE_OLD, HEAD_RE_MUTATED, 'L2 标题正则'),
    expect: { any: NEEDLE.INDEX_ARMS, none: [] },
  },
  {
    name: 'L3 两侧一起回退（= 修之前的原状）',
    // 🔴 原状是"两侧一致地错"，所以文档层看不出问题（假红吵、假绿不吵，但自检两条都不红）——
    // 这一臂就是"新臂有牙"的正证：原状必须被自检抓住。
    apply: (s) => sub1(sub1(s, REF_RE_OLD, REF_RE_MUTATED, 'L3a'), HEAD_RE_OLD, HEAD_RE_MUTATED, 'L3b'),
    expect: { any: [...NEEDLE.PARSE_ARMS, ...NEEDLE.INDEX_ARMS], none: [] },
    // L3 = 修之前的原状：两侧一致地错。原状对**文档层**只暴露那条假红，
    // 而自检把它和解析侧一起打红 —— 这就是"新臂有牙"的正证。
  },
  {
    name: 'L5 索引把字母档归一化进数字父节（假绿那面的定向变异）',
    // 这一臂是"4d 不许替 4 占位"那条的**正证**：只有把标题键的字母摘掉，
    // `## 4d.` 才会在索引里造出一个 `4` —— 而那正是原状靠截断造成的同一后果。
    apply: (s) => sub1(s, 'map.set(m[1], m[2]', 'map.set(m[1].replace(/[a-z]/g, \'\'), m[2]', 'L5 键归一化'),
    expect: { any: ['4d 那节不许替 4 占位', '字母后缀标题要进索引'], none: [] },
  },
  {
    name: 'L4 阴性对照：字样只写进注释',
    apply: (s) =>
      sub1(
        s,
        'function sectionNumbers(markdown) {',
        '// 阴性对照：`docs/adr/README.md` §1a 与 `### 1a. 勘误段` 只作为注释出现，不该改变判定。\nfunction sectionNumbers(markdown) {',
        'L4 注释',
      ),
    expect: { any: [], none: [...NEEDLE.PARSE_ARMS, ...NEEDLE.INDEX_ARMS, NEEDLE.FALSE_RED] },
  },
];

let fail = 0;
let asExpected = 0;
for (const arm of arms) {
  writeFileSync(`${ROOT}/${TARGET}`, arm.apply(ORIG), 'utf8');
  const { rc, out } = runCheck();
  writeFileSync(`${ROOT}/${TARGET}`, ORIG, 'utf8');
  const hit = arm.expect.any.filter((n) => out.includes(n));
  const missing = arm.expect.any.filter((n) => !out.includes(n));
  const forbidden = arm.expect.none.filter((n) => out.includes(n));
  const ok = missing.length === 0 && forbidden.length === 0;
  // L4 还要确认它**没有把判定改掉**：输出的红必须只剩那一枚与本单无关的死链。
  const onlyUnrelated = !out.includes('失效的章节引用');
  const passed = ok && (arm.name.startsWith('L4') ? onlyUnrelated : true);
  if (passed) asExpected += 1;
  else fail += 1;
  console.log(
    `${passed ? '✅' : '🔴'} ${arm.name} rc=${rc} 命中=${hit.length}/${arm.expect.any.length}` +
      (missing.length ? ` 缺=${missing.join(' | ')}` : '') +
      (forbidden.length ? ` 不该出现=${forbidden.join(' | ')}` : ''),
  );
}

const FINAL_SAME = md5() === BASE_MD5;
console.log(`ARMS=${arms.length} AS_EXPECTED=${asExpected} FAIL=${fail} FINAL_SAME=${FINAL_SAME}`);
if (!FINAL_SAME) {
  console.error('🔴 目标文件没复原到基线 md5 —— 这次运行本身就是污染，别把上面的结论当读数。');
  process.exit(1);
}
process.exit(fail === 0 && asExpected === arms.length ? 0 : 1);
