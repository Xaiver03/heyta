#!/usr/bin/env node
/**
 * `scripts/check-detail-pane-c1-coverage.mjs` 的变异臂（工单 §8.59 / §8.64）。
 *
 * 那条判据把目标第 1 条「每个待拍值都要有外部调研，带日期 + 出处，把结论**与推荐**写回」从散文承诺
 * 变成能失败的属性：C1 每行要么有 C1b 对照节、要么写明封闭例外类别；
 * 每个对照节都要有日期与出处（URL 或 `file:line`），并且要有**推荐那一档**（或标题写明不需要拍）。
 * §8.59 那趟 M1–M6 是手敲的一次性命令，之后判据加了 `--root`（合流预检要在**产物树**里跑）——
 * 参数形状一变，"文档路径"和"`--root` 的实参"就会互相吃掉，所以把手敲的臂固化成装置，
 * 并补两条守 `--root` 的臂（M7/M8）。腿 4（推荐那一档）是 2026-10-04 补的，M9–M13 + 两条脱牙在它身上。
 *
 * 跑法（linked worktree 里别用 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-c1-coverage.mjs
 *
 * 各臂的**预期**（M7/M8 与对照/脱牙是守载体的臂；条数不写在标题里，写在标题里的数字一定会漂）：
 *   M1 表里加一行既无对照节也不写例外   → 红在「没有 C1b 对照节…」，且点名 `#14`
 *   M2 把例外的理由改成词表外的一句话   → 同一腿红，且**例外数从 1 掉到 0**（证明类别是封闭的）
 *   M3 加一节回指表里不存在的行号       → 红在「回指了表里不存在的行号」
 *   M4 抹掉某节的日期                   → 红在「缺日期或缺出处」，读数里 `日期=false`
 *   M5 抹掉某节的 URL 与 file:line      → 同一条腿，`URL=false file:line=false`
 *   M6 把整张表删掉                     → 红在「C1 表解析出 0 行」（拒绝在空集合上报绿）
 *   M7 指一篇不存在的文档               → 红并把**传入的原样路径**打出来（守绝对路径被 `join` 拼坏）
 *   M8 只给 `--root` 不给文档           → 必须**绿**且读的是那棵树里的文档（守 `--root` 实参被当成文档吃掉）
 *   M9a 腿 4 的披露行自身可解析         → `有推荐 + 例外 == 节数` 且缺推荐为 0
 *   M9 摘掉某节的推荐段                 → 红**只**落在腿 4，点名那一节（其余三腿读数仍为 0）
 *   M10「推荐」换成「建议」             → 放过（钉住两个词形都认，挡假红）
 *   M11 摘掉推荐段、正文里留「推荐」二字 → 仍然点名（挡"把 Apple 的话当成我们的推荐"这种凑数）
 *   M12 抹掉 C1b-Q7 标题里的例外声明     → 腿 4 点名 Q7（证明例外档承重、且读的是标题）
 *   M13 摘掉 C1b-Q1 推荐段              → 点名 Q1，**尽管**正文里有一句"不需要拍板"（例外只从标题认）
 *   —— 腿 5（外部锚：URL 或第三方源码行号；只有自家路径不算）20:2x 起加：
 *   M14 把某节 URL 全换成自家 `packages/…:12` → **只红腿 5**，腿 3（有出处即算）仍绿 —— 两档分工的机器证明
 *   M15 同一节零 URL 但引第三方行号（裸文件名形状）→ 放过（挡住"必须 URL"那种把口径写窄的改法）
 *   M16 把 M14 那份文档喂「还没有腿 5 的那版判据」→ RC=0（减法现量）。
 *                          🔴 旧版按内容从文件历史认，**不按 HEAD** —— 按 HEAD 取会在腿 5 提交后自己变红
 *   脱牙 ×3 摘掉腿 4 / 腿 5              → 同一份文档不再报出那一句；喂缺日期的文档仍红在腿 3
 *   对照 未变异的副本 / 复位后           → 全绿 RC=0
 *
 * 全程只改 /tmp 副本；仓库工作树与别人的产物不动。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE = process.argv[2] ?? join(repoRoot, 'scripts/check-detail-pane-c1-coverage.mjs');
const DOC = 'docs/research/detail-pane-alignment-and-spaced-review.md';
const ORIGINAL = readFileSync(join(repoRoot, DOC), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'dp-c1-'));
const doc = join(scratch, 'doc.md');
writeFileSync(doc, ORIGINAL, 'utf8');

const fail = [];
const notes = [];
const check = (arm, cond, detail) => {
  (cond ? notes : fail).push(`  ${cond ? '✅' : '🔴'} ${arm}${detail ? ` —— ${detail}` : ''}`);
};

const run = (args) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
const withDoc = (mutate, args = [doc]) => {
  writeFileSync(doc, ORIGINAL, 'utf8');
  if (mutate) {
    const next = mutate(ORIGINAL);
    // 🔴 变异必须真的改动文档：静默 0 命中的替换会让臂"红"的原因变成别的注入，或干脆永远不红。
    if (next === ORIGINAL) throw new Error('变异没有改动文档（抽取形状对不上原文）—— 臂是装饰，拒绝继续。');
    writeFileSync(doc, next, 'utf8');
  }
  return run(args);
};
const legCount = (out, title) => {
  const seg = out.split(`\n${title}（`)[1];
  if (!seg) return 0;
  const m = seg.match(/^(\d+) 条）/);
  return m ? Number(m[1]) : 0;
};
const counts = (out) => {
  const m = out.match(/C1 行 (\d+) 行 ⇒ 有对照节 (\d+) \/ 例外 (\d+) \/ 未覆盖 (\d+)；C1b 节 (\d+) 个/);
  return m ? { rows: +m[1], covered: +m[2], excused: +m[3], unexcused: +m[4], sections: +m[5] } : null;
};
const UNCOV = '🔴 要拍的值没有 C1b 对照节，也没写清属于哪一类例外';
const ORPHAN = '🔴 C1b 节回指了表里不存在的行号（研究了不存在的题）';
const WEAK = '🔴 C1b 节缺日期或缺出处（URL 或 file:line 择一即可）';
const NOREC = '🔴 C1b 节没有「推荐/建议」那一档，标题也没写明不需要拍（取证齐了但没给答案）';

// 定位辅助：表里最后一行 / 某个节的正文区间
const lastRowIdx = (text) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## C1[.．]/.test(l.trim()));
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  let idx = -1;
  for (let i = start; i < end; i += 1) if (/^\|\s*\d+\s*\|/.test(lines[i])) idx = i;
  return { lines, end, idx };
};

// 定位某一节，返回 [起, 止) 行区间（止＝下一个 `### ` 或 `## `）
const sectionRange = (lines, titleRe) => {
  const s = lines.findIndex((l) => /^### /.test(l) && titleRe.test(l));
  if (s === -1) throw new Error(`装置找不到节标题 ${titleRe}（原文形状变了，臂要跟着改）`);
  let e = s + 1;
  while (e < lines.length && !/^###? /.test(lines[e])) e += 1;
  return { s, e };
};
// 摘掉那一节的推荐段（从行首加粗的推荐标签起，到本节末尾或下一处 `---` 为止）
const cutRec = (text, titleRe, replacement = []) => {
  const lines = text.split('\n');
  const { s, e } = sectionRange(lines, titleRe);
  const rec = lines.findIndex((l, i) => i > s && i < e && /^\*\*[^*\n]{1,40}\*\*[：:]/.test(l) && /推荐|建议/.test(l.match(/^\*\*([^*\n]{1,40})\*\*[：:]/)[1]));
  if (rec === -1) throw new Error('装置找不到该节的推荐行（原文形状变了，臂要跟着改）');
  let stop = rec + 1;
  while (stop < e && !/^---\s*$/.test(lines[stop])) stop += 1;
  return [...lines.slice(0, rec), ...replacement, ...lines.slice(stop)].join('\n');
};

const base = withDoc(null);
const bc = counts(base.out);
check('对照 未变异副本全绿', base.rc === 0 && bc !== null && bc.rows > 0 && bc.sections > 0, `RC=${base.rc}｜${JSON.stringify(bc)}`);
if (base.rc !== 0) {
  console.log(base.out);
  console.log('🔴 基线就是红的，M1/M2 那种"恰好 +1"都失去意义 —— 先修文档或判据。');
  process.exit(1);
}

// M1：加一行既无对照节也无例外
const m1 = withDoc((t) => {
  const { lines, idx } = lastRowIdx(t);
  lines.splice(idx + 1, 0, '| 14 | 装置注入的一格：既没写例外也没对照节 | A | 占位 |');
  return lines.join('\n');
});
const m1out = m1.out;
check(
  'M1 新行无对照节 → 红且点名 #14',
  m1.rc === 1 && legCount(m1out, UNCOV) === 1 && m1out.includes('#14') && m1out.includes('🔴 1 处不成立'),
  `RC=${m1.rc}｜未覆盖 ${counts(m1out)?.unexcused}`,
);

// M2：把例外理由改成词表外的一句话（封闭类别的牙）
// ⚠️ 那一行**同时命中两条词表分支**（`不是"要拍的值"` 和 `没有 C1b 对照节`），只抹掉一条它照样算例外 ——
// 第一版就是这么写的，症状是"臂没红"而不是"文档没被改"。所以两条都得抹，并断言**两次替换都真的落了**。
const m2res = withDoc((t) => {
  const line = t.split('\n').find((l) => /^\|\s*3\s*\|/.test(l));
  const after = line
    .replace(/它不是.要拍的值./, '它已经被处理完')
    .replace(/所以\*\*没有\s*C1b\s*对照节\*\*/, '所以**已经收尾了**');
  if (after === line) throw new Error('M2 的替换没命中（静默空改动 = 臂是装饰）');
  if (/不是.要拍的值.|没有\s*C1b\s*对照节/.test(after)) throw new Error('M2 抹不干净：两条词表分支还剩一条');
  return t.replace(line, after);
});
const m2out = m2res.out;
const m2c = counts(m2out);
check(
  'M2 词表外的理由不算例外',
  m2res.rc === 1 && legCount(m2out, UNCOV) === 1 && m2out.includes('#3') && m2c.excused === bc.excused - 1,
  `RC=${m2res.rc}｜例外 ${bc.excused}→${m2c.excused}，未覆盖 ${bc.unexcused}→${m2c.unexcused}`,
);

// M3：一节回指不存在的行号
const m3 = withDoc((t) =>
  `${t}\n### C1b-Q99（= C1 #99：装置注入的孤儿节）\n\n2026-10-04 取证：` + '`packages/domain/src/task.ts:1`' + `\n`,
);
const m3out = m3.out;
check(
  'M3 孤儿节 → 红并报缺的行号',
  m3.rc === 1 && legCount(m3out, ORPHAN) === 1 && m3out.includes('缺行号 99'),
  `RC=${m3.rc}｜节数 ${bc.sections}→${counts(m3out)?.sections}`,
);

// M4：抹掉某节的日期
const m4 = withDoc((t) => {
  const i = t.indexOf('### C1b-Q1（');
  if (i === -1) throw new Error('M4 找不到被改的节标题（原文形状变了，臂要跟着改）');
  const j = t.indexOf('\n### ', i + 5);
  return `${t.slice(0, i)}${t.slice(i, j).replace(/20\d\d-\d\d-\d\d/g, '（日期被装置抹掉）')}${t.slice(j)}`;
});
const m4out = m4.out;
check(
  'M4 缺日期 → 红且读数 日期=false',
  m4.rc === 1 && legCount(m4out, WEAK) === 1 && m4out.includes('日期=false'),
  `RC=${m4.rc}｜弱节 ${legCount(m4out, WEAK)} 条`,
);

// M5：抹掉某节的 URL 与 file:line（两种出处都没了才算缺出处）
const m5 = withDoc((t) => {
  const i = t.indexOf('### C1b-Q1（');
  if (i === -1) throw new Error('M5 找不到被改的节标题（原文形状变了，臂要跟着改）');
  const j = t.indexOf('\n### ', i + 5);
  const body = t
    .slice(i, j)
    .replace(/https?:\/\/\S+/g, '（链接被装置抹掉）')
    .replace(/[\w./-]+\.(ts|tsx|js|mjs|json|css|md|swift|kt|ets|java|py|sh):\d+/g, '（行号引用被装置抹掉）');
  return `${t.slice(0, i)}${body}${t.slice(j)}`;
});
const m5out = m5.out;
check(
  'M5 两种出处都没 → 红且读数 URL=false file:line=false',
  m5.rc === 1 && legCount(m5out, WEAK) >= 1 && /URL=false file:line=false/.test(m5out),
  `RC=${m5.rc}｜弱节 ${legCount(m5out, WEAK)} 条`,
);

// M6：整张表删掉（保留 `## C1.` 标题与下一个 `## `）→ 空集合必须拒绿
const m6 = withDoc((t) => {
  const lines = t.split('\n');
  const start = lines.findIndex((l) => /^## C1[.．]/.test(l.trim()));
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return [...lines.slice(0, start + 1), '', ...lines.slice(end)].join('\n');
});
const m6out = m6.out;
check('M6 表为空 → 拒绝报绿', m6.rc === 1 && m6out.includes('C1 表解析出 0 行'), `RC=${m6.rc}｜空集合那一档`);

// M7：不存在的文档 → 必须把**传入的原样路径**打出来（守绝对路径被 `join(root, …)` 拼坏）
const missingPath = join(scratch, 'no-such-doc.md');
const m7 = run([missingPath]);
check(
  'M7 文档不存在 → 红且出处是原样路径',
  m7.rc === 1 && m7.out.includes(`取样文档不存在：${missingPath}`),
  `RC=${m7.rc}`,
);

// M8：只给 `--root` 不给文档 → 实参不许被当成文档路径吃掉
const treeRoot = join(scratch, 'tree');
execFileSync('sh', [
  '-c',
  `mkdir -p "$0/tree" && git -C "$1" archive HEAD -- "$2" | tar -x -C "$0/tree"`,
  scratch,
  repoRoot,
  DOC,
]);
const m8 = run(['--root', treeRoot]);
check(
  'M8 产物树模式（只给 --root）→ 绿且读的是树里的文档',
  m8.rc === 0 && counts(m8.out) !== null && m8.out.includes(`取样：${DOC}`),
  `RC=${m8.rc}｜${JSON.stringify(counts(m8.out))}`,
);

// M9–M13：腿 4「每个对照节必须有推荐那一档」的臂（目标第 1 条那句"结论**与推荐**写回"的机器消费者）
const recCount = (out) => {
  const m = out.match(/C1b 节 (\d+) 个（有推荐 (\d+) \/ 标题写明不需要拍 (\d+) \/ 缺推荐 (\d+)）/);
  return m ? { sections: +m[1], withRec: +m[2], excused: +m[3], missing: +m[4] } : null;
};
const baseRec = recCount(base.out);
check(
  'M9a 读数行自身可解析（腿 4 的承重披露不是装饰）',
  baseRec !== null && baseRec.withRec + baseRec.excused === baseRec.sections && baseRec.missing === 0,
  `${JSON.stringify(baseRec)}`,
);

// M9 会响：摘掉 C1b-Q6 的推荐段 ⇒ 只有腿 4 红，别的腿一律不跟着红
const m9 = withDoc((t) => cutRec(t, /C1b-Q6/));
const m9out = m9.out;
check(
  'M9 摘掉推荐段 → 红只落在腿 4，点名 C1b-Q6',
  m9.rc === 1 &&
    legCount(m9out, NOREC) === 1 &&
    m9out.includes('C1b-Q6 —— 行首加粗标签=') &&
    legCount(m9out, UNCOV) === 0 &&
    legCount(m9out, ORPHAN) === 0 &&
    legCount(m9out, WEAK) === 0 &&
    recCount(m9out)?.missing === 1,
  `RC=${m9.rc}｜缺推荐 ${recCount(m9out)?.missing}｜其余腿 ${legCount(m9out, UNCOV)}/${legCount(m9out, ORPHAN)}/${legCount(m9out, WEAK)}`,
);

// M10 会放过：把「推荐」换成同义词「建议」⇒ 仍须绿
// （§8 表腿 7 的教训：触发词只认一种字面形状，下一轮换措辞判据就静默失去对象 —— 这条钉住"两个词形都认"）
const m10 = withDoc((t) => {
  const next = t.replace('**推荐（不替谁拍）**：把 #6 拆成两问拍', '**建议（不替谁拍）**：把 #6 拆成两问拍');
  if (next === t) throw new Error('M10 的替换没命中（静默空改动 = 臂是装饰）');
  return next;
});
check(
  'M10 换写成「建议」→ 放过（不许因为措辞就假红）',
  m10.rc === 0 && recCount(m10.out)?.missing === 0,
  `RC=${m10.rc}｜${JSON.stringify(recCount(m10.out))}`,
);

// M11 会响：摘掉推荐段、只在正文里留「推荐」二字 ⇒ 仍须点名
// （挡住"把别人的话当成我们的推荐"这条最省力的凑数写法：腿 4 判的是行首加粗标签，不是整节含词）
const m11 = withDoc((t) =>
  cutRec(t, /C1b-Q6/, ['> 装置注入：这一节里仍然留着"推荐"两个字（Apple 原文 we recommend using a tertiary button）。', '']),
);
const m11out = m11.out;
check(
  'M11 正文里留「推荐」二字不算推荐段 → 仍然点名 C1b-Q6',
  m11.rc === 1 && legCount(m11out, NOREC) === 1 && m11out.includes('C1b-Q6') && m11out.includes('推荐'),
  `RC=${m11.rc}`,
);

// M12 会响：把 C1b-Q7 标题里的例外声明抹掉 ⇒ 那一节必须转为红
// （证明例外档是**承重**的，也证明它读的是标题）
const m12 = withDoc((t) => {
  const next = t.replace('### C1b-Q7（= C1 #7：确认"番茄页不许塞进列表模型"继续有效）—— 已核，**不需要拍**', '### C1b-Q7（= C1 #7：确认"番茄页不许塞进列表模型"继续有效）');
  if (next === t) throw new Error('M12 的替换没命中');
  return next;
});
const m12out = m12.out;
check(
  'M12 抹掉标题里的例外声明 → 腿 4 点名 C1b-Q7',
  m12.rc === 1 && legCount(m12out, NOREC) === 1 && m12out.includes('C1b-Q7') && recCount(m12out)?.excused === 0,
  `RC=${m12.rc}｜例外 ${baseRec.excused}→${recCount(m12out)?.excused}`,
);

// M13 会响：C1b-Q1 正文里本来就有一句"不需要拍板"（讲的是**别的事**）——
// 摘掉 Q1 的推荐段后，那句**不许**把它豁免掉（例外只从标题认；这条臂就是那个设计选择的本体）
const m13 = withDoc((t) => {
  const lines = t.split('\n');
  const { s, e } = sectionRange(lines, /C1b-Q1/);
  if (!/不需要拍板/.test(lines.slice(s, e).join('\n'))) throw new Error('M13 的前提不成立：Q1 正文里没有那句"不需要拍板"');
  const next = cutRec(t, /C1b-Q1/);
  // 🔴 前提要在**变异后的文档**上量：这句"不需要拍板"必须还留着（它住在推荐段之前），
  // 否则这一臂就退化成普通的"摘掉推荐段"，什么也没证明。
  const { s: s2, e: e2 } = sectionRange(next.split('\n'), /C1b-Q1/);
  if (!/不需要拍板/.test(next.split('\n').slice(s2, e2).join('\n'))) throw new Error('M13 的前提被自己的变异抹掉了：摘完推荐段后那句"不需要拍板"不在了');
  if (next.split('\n').slice(s2, e2).some((l) => /^\*\*([^*\n]{1,40})\*\*[：:]/.test(l) && /推荐|建议/.test(l.match(/^\*\*([^*\n]{1,40})\*\*[：:]/)[1])))
    throw new Error('M13 没摘干净：Q1 里还留着推荐类的行首加粗标签');
  return next;
});
const m13out = m13.out;
// ⚠️ 断言里**不许**写 `m13out.includes('不需要拍板')`：判据从不回显文档正文，那句是文档里的话，
// 不是判据的输出 —— 第一版就这么写，症状是"臂红而 RC 是对的"（期望值写错与判据写错一样会误导下一位）。
// 这一臂要证的"正文那句没把它豁免掉"，可读形态是**例外数没涨**（Q1 仍落在"缺推荐"那一档）。
const m13rec = recCount(m13out);
check(
  'M13 正文里的"不需要拍板"不构成豁免 → 腿 4 点名 C1b-Q1',
  m13.rc === 1 &&
    legCount(m13out, NOREC) === 1 &&
    m13out.includes('C1b-Q1 —— 行首加粗标签=') &&
    m13rec.missing === 1 &&
    m13rec.excused === baseRec.excused,
  `RC=${m13.rc}｜缺推荐 ${m13rec.missing}｜标题例外 ${baseRec.excused}→${m13rec.excused}`,
);

// 脱牙对照：把腿 4 摘掉后喂 M9 那份文档 ⇒ 必须**不再报出那一句**（证明 M9 的红来自这条腿），
// 且其余腿不受影响（再喂 M4 那份仍红在 WEAK —— 否则"摘一条腿"其实摘了整个判据）。
const neuterDecl = 'const noRec = sections.filter((s) => !hasRec(s) && !SECTION_EXC.test(s.title));';
if (!readFileSync(GATE, 'utf8').includes(neuterDecl)) {
  console.log('🔴 装置找不到腿 4 的声明行 —— 判据那一行的字面形状变了，脱牙臂会假装成功，拒绝继续。');
  process.exit(2);
}
const neuterGate = join(scratch, 'gate-no-leg4.mjs');
writeFileSync(neuterGate, readFileSync(GATE, 'utf8').replace(neuterDecl, 'const noRec = [];'), 'utf8');
writeFileSync(doc, cutRec(ORIGINAL, /C1b-Q6/), 'utf8');
const withLeg = run([doc]);
const n9 = spawnSync(process.execPath, [neuterGate, doc], { encoding: 'utf8' });
const n9out = `${n9.stdout}${n9.stderr}`;
check(
  '脱牙对照 摘掉腿 4 → 同一份文档不再报出那一句（且别处不新增红）',
  withLeg.rc === 1 && n9.status === 0 && !n9out.includes('C1b 节没有「推荐'),
  `带腿 RC=${withLeg.rc}｜脱牙 RC=${n9.status}`,
);
writeFileSync(doc, ORIGINAL.replace(/20\d\d-\d\d-\d\d/g, '（日期被装置抹掉）'), 'utf8');
const n4 = spawnSync(process.execPath, [neuterGate, doc], { encoding: 'utf8' });
const n4out = `${n4.stdout}${n4.stderr}`;
check(
  '脱牙对照 摘腿 4 后其余腿仍在（不是摘了整个判据）',
  n4.status === 1 && legCount(n4out, WEAK) >= 1,
  `RC=${n4.status}｜弱节 ${legCount(n4out, WEAK)} 条`,
);

// M14 / M15：腿 5「外部锚」（目标第 1 条那句"做**外部**调研（别人怎么做的）"的机器消费者）。
// 两臂方向相反，钉的是同一个口径决定：**URL 或第三方源码行号都算外部，只有自家路径不算**。
// M14 还顺带证明腿 5 与 weak 的分工 —— 把 URL 换成自家 `packages/…:12` 之后，
// weak 那一档**必须仍然绿**（它只问"有没有出处"），只有腿 5 红。写成"两档都红"就是错的期望
// （同一族的错在 §8.79 的 J4 上犯过一次：期望值自己猜，跑一趟才发现两档分工不同）。
const NOEXT = '🔴 C1b 节只有自家路径的 file:line 而没有 URL，也没有第三方源码引用（没回答"别人怎么做的"）';
const swapDocUrls = (t, titleRe, replacement) => {
  const ls = t.split('\n');
  const { s, e } = sectionRange(ls, titleRe);
  const body = ls.slice(s, e).join('\n');
  const urls = (body.match(/https?:\/\/\S+/g) || []).length;
  if (!urls) throw new Error(`M14/M15 找不到 ${titleRe} 那一节的 URL —— 那一节的取证形状变了，这两条臂没有靶`);
  const nextBody = body.replace(/https?:\/\/\S+/g, replacement);
  if (/https?:\/\//.test(nextBody)) throw new Error('URL 没抹干净');
  return [...ls.slice(0, s), nextBody, ...ls.slice(e)].join('\n');
};
const swapUrls = (titleRe, replacement) => withDoc((t) => swapDocUrls(t, titleRe, replacement));
const m14 = swapUrls(/C1b-Q1/, 'packages/ui/src/focus/FocusPanel.tsx:12');
const m14out = m14.out;
check(
  'M14 把某一节的 URL 全换成自家路径的行号 → 只有腿 5 红（weak 仍绿：两档问的不是同一件事）',
  m14.rc === 1 &&
    legCount(m14out, NOEXT) === 1 &&
    m14out.includes('C1b-Q1') &&
    legCount(m14out, WEAK) === 0 &&
    legCount(m14out, NOREC) === 0,
  `RC=${m14.rc}｜缺外部锚 ${legCount(m14out, NOEXT)}｜weak ${legCount(m14out, WEAK)}｜缺推荐 ${legCount(m14out, NOREC)}`,
);
// M15：同一节只留**第三方形状**的行号（本档真实的引用形状是裸文件名，见判据注释）⇒ 必须放过
const m15 = swapUrls(/C1b-Q1/, 'StreakList.kt:48');
check(
  'M15 同一节零 URL 但引第三方源码行号 → 放过（这一条挡住"必须有 URL"那种把口径写窄的改法）',
  m15.rc === 0 && legCount(m15.out, NOEXT) === 0,
  `RC=${m15.rc}｜缺外部锚 ${legCount(m15.out, NOEXT)}`,
);

// 脱牙对照（腿 5）：摘掉命中集合后 M14 必须不再报出那一句，而其余腿不受影响
const neuter5Decl = 'const noExt = sections.filter((s) => !hasExternal(s) && !SECTION_EXC.test(s.title));';
if (!readFileSync(GATE, 'utf8').includes(neuter5Decl)) {
  console.log('🔴 装置找不到腿 5 的声明行 —— 判据那一行的字面形状变了，脱牙臂会假装成功，拒绝继续。');
  process.exit(2);
}
const neuter5Gate = join(scratch, 'gate-no-leg5.mjs');
writeFileSync(neuter5Gate, readFileSync(GATE, 'utf8').replace(neuter5Decl, 'const noExt = [];'), 'utf8');
writeFileSync(doc, swapDocUrls(ORIGINAL, /C1b-Q1/, 'packages/ui/src/focus/FocusPanel.tsx:12'), 'utf8');
const n5 = spawnSync(process.execPath, [neuter5Gate, doc], { encoding: 'utf8' });
const n5out = `${n5.stdout}${n5.stderr}`;
check(
  '脱牙对照 摘掉腿 5 → 同一份文档不再报出"缺外部锚"那一句（M14 的红确实挂在这条腿上）',
  n5.status === 0 && !n5out.includes('没有第三方源码引用'),
  `RC=${n5.status}`,
);
writeFileSync(doc, ORIGINAL, 'utf8');

// M16：把 M14 同一份文档喂「还没有腿 5 的那版判据」⇒ 必须 RC=0（减法现量：这一档此前真的没人管）。
// 🔴 旧版**按内容从文件历史里认，不按 HEAD 取** —— 按 HEAD 取的话，腿 5 一提交这条臂就自己变红
//   （同一批在 §8 表的 P4 上实测踩过，教训写在工单 §8.87 第 3 节）。
{
  const hist = execFileSync('git', ['-C', repoRoot, 'log', '--format=%H', '--', 'scripts/check-detail-pane-c1-coverage.mjs'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 12);
  let found = '';
  let oldSrc = '';
  for (const sha of hist) {
    const src = execFileSync('git', ['-C', repoRoot, 'show', `${sha}:scripts/check-detail-pane-c1-coverage.mjs`], { encoding: 'utf8' });
    if (!src.includes(neuter5Decl) && src.includes('const weak =')) {
      found = sha;
      oldSrc = src;
      break;
    }
  }
  if (!found) throw new Error(`前 ${hist.length} 版里找不到"还没有腿 5"的那版判据 —— 窗口要放宽，但绝不许拿当前版冒充旧版。`);
  const oldGate = join(scratch, 'gate-before-leg5.mjs');
  writeFileSync(oldGate, oldSrc, 'utf8');
  writeFileSync(doc, swapDocUrls(ORIGINAL, /C1b-Q1/, 'packages/ui/src/focus/FocusPanel.tsx:12'), 'utf8');
  const r = spawnSync(process.execPath, [oldGate, doc], { encoding: 'utf8' });
  writeFileSync(doc, ORIGINAL, 'utf8');
  check(
    'M16 同一份变异喂「还没有腿 5 的那版判据」→ RC=0（补的是实测存在的缺口，不是顺手加严）',
    r.status === 0,
    `RC=${r.status}｜取的是 ${found.slice(0, 8)}（按内容认）`,
  );
}

// 对照：恢复干净后全绿
const control = withDoc(null);
check('对照 恢复干净后全绿', control.rc === 0, `RC=${control.rc}`);

rmSync(scratch, { recursive: true, force: true });

console.log(`\n读数：判据 ${GATE.split('/').pop()}｜C1 ${bc.rows} 行（有节 ${bc.covered} / 例外 ${bc.excused} / 未覆盖 ${bc.unexcused}）｜C1b ${bc.sections} 节（推荐 ${baseRec?.withRec} / 标题例外 ${baseRec?.excused}）`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log(`\n结论：${notes.length}/${notes.length + fail.length} 臂符合预期（臂的分解见文件头，不在这里写死条数）✅`);
