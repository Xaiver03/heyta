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
 *   —— 腿 6（未核实台账 B6/C2 逐条必须带「补法 / 不可补 / 结案取证」）21:3x 起加：
 *   M17 摘掉某条台账项的补法行         → **只**红腿 6，点名那一条（其余五腿读数仍为 0）
 *   M18 标签换成词表外的「以后再看：」  → 点名（认的是封闭词表，不是"这一行有内容"）
 *   M19 / M19b 换成另外两档            → 都放过（三档逐项有臂，挡"只有补法才算"那种把口径写窄）
 *   M20 只留「补法」二字、不跟冒号      → 点名（钉住"紧跟冒号"那一半口径）
 *   M21 摘掉一条**划线条目**的补法行    → 仍然点名 —— 划线不结案（被推翻的原句常带活的尾巴）
 *   M22 台账小节改名                   → 拒绝报绿并写明"分母为空"
 *   M23 承重(腿6) 那行自身可解析，且"已结案 + 缺 == 总条数"
 *   M24 同一份变异喂「还没有腿 6 的那版」→ RC=0（减法现量；旧版按内容认，不按 HEAD）
 *   脱牙 摘掉腿 6 的命中集合           → M17/M18/M21 三份全部失能
 *   —— 腿 7（一条 Markdown 表格行 = 一个物理行）2026-10-05 起加（工单 §8.139）：
 *   M25 把 C1 表某一行从中间拆成两半    → 点名 2 处（起而不收 + 收而不起）且 RC=1
 *   M25b 同一形状放进围栏代码块里       → 放过（反方向臂：挡"把代码块里的示例表格当断行"）
 *   脱牙 摘掉腿 7 的命中集合           → 同一份断行文档**整条判据回到 RC=0**。
 *                          🔴 这一档是"有腿"的唯一证明：其余六腿取行用的是 `^\|\s*N\s*\|`，
 *                          断开的两半各被认成"一行"，"有节/有推荐/有外部锚"照样全成立，
 *                          而它在渲染里根本不是表格 —— 2026-10-05 实测 C1 表 #14 就是这个形状。
 *   对照 未变异的副本 / 复位后           → 全绿 RC=0
 *   ⚠️ 同一轮把 M8 的文档来源从 `git archive HEAD` 改成**工作树拷贝**：原版把"我这轮还没提交"
 *      写成了前提 —— 台账补结案档那一批还没提交时，HEAD 那份缺结案档，这条守 `--root` 的臂
 *      就自己变红，而红的对象根本不是它守的东西（同一族教训见工单 §8.87 第 3 节）。
 *   M8b 往树里放一份**缺结案档**的副本  → 红落在树里那一份（仓库那份是干净的）——
 *      没有这条，M8 在"两边字节相同"的新取材方式下只证明"没崩"，证明不了"读的是那棵树"。
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
// 🔴 注入的行号**从文档现取**（= 现有最大号 + 1），不写死：写死成 `#14` 的那版，在
//    C1 #14 真的被补上对照节之后自己变成了 RC=0（"新行"不再是新行），红的对象换成了历史。
const nextFreeRow = (t) => {
  const nums = [...t.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  if (!nums.length) throw new Error('C1 表里一行都没解析出来 —— 注入没有对象');
  return Math.max(...nums) + 1;
};
const m1n = nextFreeRow(ORIGINAL);
const m1 = withDoc((t) => {
  const { lines, idx } = lastRowIdx(t);
  lines.splice(idx + 1, 0, `| ${String(m1n)} | 装置注入的一格：既没写例外也没对照节 | A | 占位 |`);
  return lines.join('\n');
});
const m1out = m1.out;
check(
  `M1 表里加一行既无对照节也不写例外 → 红且点名那枚新号（号从文档现取，本轮 = #${String(m1n)}）`,
  m1.rc === 1 && legCount(m1out, UNCOV) === 1 && m1out.includes(`#${String(m1n)}`) && m1out.includes('🔴 1 处不成立'),
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
// 🔴 树里的文档取**工作树那一份**，不取 `git archive HEAD` —— 原版取 HEAD 把"我这轮还没提交"
//   写成了前提：21:3x 给台账补结案档那一批还没提交时，HEAD 那份缺结案档，这条守 `--root` 的臂
//   就自己变红了，红的对象还不是它在守的东西。（同一族在 §8 表 P4 与工单 §8.87 第 3 节各踩过一次。）
const treeRoot = join(scratch, 'tree');
execFileSync('sh', ['-c', `mkdir -p "$0/$(dirname "$2")" && cp "$1" "$0/$2"`, treeRoot, join(repoRoot, DOC), DOC]);
const m8 = run(['--root', treeRoot]);
check(
  'M8 产物树模式（只给 --root）→ 绿且读的是树里的文档',
  m8.rc === 0 && counts(m8.out) !== null && m8.out.includes(`取样：${DOC}`),
  `RC=${m8.rc}｜${JSON.stringify(counts(m8.out))}`,
);
// M8b 见下面腿 6 那一节（要用到那里的 cutCloser / legCountHas，声明顺序上不来）


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

// —— 腿 6（未核实台账逐条必须带「补法 / 不可补 / 结案取证」）21:3x 起加。
// 这一族与腿 1–5 的对象不同：那五腿判的是 C1b **对照节**，这一腿判的是 B6/C2 **台账**。
// 🔴 六条臂里有两条方向相反（M18/M19 与 M20），钉的是同一个口径决定：
//   认的是**词表 + 紧跟冒号**，不是"这一行提到了补法"。少了反方向那条，
//   下一轮把口径写窄成"必须有 URL 级证据"或放宽成"含『补法』二字即算"都不会有东西失败。
// 🔴 数红条数的方式与前面几条臂**不同**：这里不抄判据那句完整标题（那是一份会漂的抄件），
//   而是"以 🔴 开头 + 含这一小段独有心话 + 以「（N 条）：」结尾"三件齐。
const legCountHas = (out, needle) => {
  const line = out.split('\n').find((l) => l.startsWith('🔴') && l.includes(needle) && /（\d+ 条）：$/.test(l));
  const m = line && line.match(/（(\d+) 条）：$/);
  return m ? Number(m[1]) : 0;
};
const LEDGER6 = '未核实台账里这条没写';
const CLOSER_RE = /(?:^|[\s。；，])\*{0,2}(?:补法|不可补|结案取证)\*{0,2}\s*[：:]/;
const ledgerItem = (text, tag, n) => {
  const lines = text.split('\n');
  const headRe = tag === 'B6' ? /^## B6[.．]/ : /^## C2[.．]/;
  const s = lines.findIndex((l) => headRe.test(l.trim()));
  if (s === -1) throw new Error(`装置找不到台账 ${tag} —— 原文形状变了，腿 6 那批臂要跟着改`);
  let e = s + 1;
  while (e < lines.length && !/^## /.test(lines[e])) e += 1;
  const start = lines.findIndex((l, i) => i > s && i < e && new RegExp(`^${n}\\.\\s`).test(l));
  if (start === -1) throw new Error(`装置找不到 ${tag} #${n}`);
  let stop = start + 1;
  while (stop < e && !/^\d+\.\s/.test(lines[stop])) stop += 1;
  const idx = lines.findIndex((l, i) => i >= start && i < stop && CLOSER_RE.test(l));
  if (idx === -1) throw new Error(`${tag} #${n} 没有结案档那一行 —— 这台装置没有靶（判据此刻本就报红，臂的期望无从谈起）`);
  return { lines, idx };
};
const editCloser = (t, tag, n, fn) => {
  const { lines, idx } = ledgerItem(t, tag, n);
  const before = lines[idx];
  lines[idx] = fn(before);
  if (lines[idx] === before) throw new Error(`${tag} #${n} 的结案档行没被改动 —— 替换形状对不上原文`);
  return lines.join('\n');
};
const cutCloser = (t, tag, n) => {
  const { lines, idx } = ledgerItem(t, tag, n);
  return [...lines.slice(0, idx), ...lines.slice(idx + 1)].join('\n');
};

// M17：摘掉某一条的补法行 → **只**红腿 6，且点名那一条（其余五腿读数仍为 0）
const m17 = withDoc((t) => cutCloser(t, 'B6', 3));
check(
  'M17 摘掉台账里一条的「补法」行 → 只红腿 6 并点名那一条（别处零红）',
  m17.rc === 1 &&
    legCountHas(m17.out, LEDGER6) === 1 &&
    m17.out.includes('B6 #3') &&
    legCount(m17.out, WEAK) === 0 &&
    legCount(m17.out, NOREC) === 0 &&
    legCount(m17.out, NOEXT) === 0,
  `RC=${m17.rc}｜缺结案档 ${legCountHas(m17.out, LEDGER6)}`,
);
// M18：标签换成词表外的词（"以后再看："）→ 仍点名。挡的是"有一条续行就算有交代"
const m18 = withDoc((t) => editCloser(t, 'C2', 13, (l) => l.replace('补法：', '以后再看：')));
check(
  'M18 把标签改成词表外的「以后再看：」→ 点名（认的是封闭词表，不是"这一行有内容"）',
  m18.rc === 1 && legCountHas(m18.out, LEDGER6) === 1 && m18.out.includes('C2 #13'),
  `RC=${m18.rc}｜点名 C2 #13=${m18.out.includes('C2 #13')}`,
);
// M20：留"补法"二字但不跟冒号 → 点名。与 M18 反向，钉"必须紧跟冒号"那一半口径
const m20 = withDoc((t) => editCloser(t, 'C2', 5, (l) => l.replace('补法：', '补法 以后另定')));
check(
  'M20 只留「补法」二字、不跟冒号 → 点名（挡"这条的补法以后再想"那种凑字）',
  m20.rc === 1 && legCountHas(m20.out, LEDGER6) === 1 && m20.out.includes('C2 #5'),
  `RC=${m20.rc}｜点名 C2 #5=${m20.out.includes('C2 #5')}`,
);
// M19 / M19b：三档词表**都**认 —— 换成「不可补：」「结案取证：」都必须放过。
// 缺这两条的话，判据会被下一轮读成"只有补法才算"，而"不可补"正是台账里最需要留档的那一档。
const m19 = withDoc((t) => editCloser(t, 'B6', 5, (l) => l.replace('不可补：', '补法：')));
const m19b = withDoc((t) => editCloser(t, 'C2', 12, (l) => l.replace('不可补：', '结案取证：')));
check(
  'M19/M19b 换成另外两档（补法 / 结案取证）→ 都放过（三档词表逐项有臂）',
  m19.rc === 0 && m19b.rc === 0,
  `补法 RC=${m19.rc}｜结案取证 RC=${m19b.rc}`,
);
// M21 🔴 划线不算结案：C2 #1 整条带 ~~，摘掉它的补法行必须仍点名。
// 这一条挡的是最省力的绕过写法 —— 把不想管的敞口划上线，台账"看起来"就全结案了。
const m21 = withDoc((t) => cutCloser(t, 'C2', 1));
check(
  'M21 摘掉一条**划线条目**的补法行 → 仍然点名（划线不结案：被推翻的原句常带活的尾巴）',
  m21.rc === 1 && legCountHas(m21.out, LEDGER6) === 1 && m21.out.includes('C2 #1'),
  `RC=${m21.rc}｜点名 C2 #1=${m21.out.includes('C2 #1')}`,
);
// M22 分母自检：台账小节被改名 → 判据必须响亮失败，而不是"少一段照样全绿"
const m22 = withDoc((t) => t.replace(/^## C2[.．]/m, '## C2x. '));
check(
  'M22 把台账小节 C2 改名 → 拒绝报绿并写明"分母为空"（空集合上的"全部已交代"是永真）',
  m22.rc === 1 && /分母为空|拒绝报绿/.test(m22.out),
  `RC=${m22.rc}`,
);
// M23 披露行自身可解析：已结案档 + 缺 == 两条台账的总条数
const l6 = base.out.match(/承重\(腿6\)：B6 (\d+) 条｜C2 (\d+) 条｜已结案档 (\d+)｜缺 (\d+)/);
check(
  'M23 承重(腿6) 那行自身成立：已结案 + 缺 == 台账总条数，且基线缺 0',
  !!l6 && Number(l6[1]) + Number(l6[2]) === Number(l6[3]) + Number(l6[4]) && Number(l6[4]) === 0,
  l6 ? `B6 ${l6[1]}｜C2 ${l6[2]}｜已结案 ${l6[3]}｜缺 ${l6[4]}` : '读数行没解析出来',
);

// —— 腿 7（一条 Markdown 表格行必须是一个物理行）。2026-10-05 加。
// 🔴 来路不是整洁癖：§8.135 在 §8 工单表上实测过一次（一枚被写成 8 个物理行的工单行活了
//   **12 趟门禁**没人看见），本线当天往 C1 表 #14 行里插更正时**又**写出同一形状。
//   前面那些腿取行用的是 `/^\|\s*(\d+)\s*\|(.*)$/`，断行照样匹配、照样计数 ⇒
//   "这一行有对照节 / 有推荐 / 有外部锚"全部成立，而它在渲染里根本不是表格。
//   所以这一腿只判**形状**，且必须和"取行"那些腿并存 —— 它们判的是不同的事。
const ROW7 = '这一行不是完整的表格行';
const splitRow = (text, n, at) => {
  const L = text.split('\n');
  const k = L.findIndex((l) => new RegExp(`^\\|\\s*${n}\\s*\\|`).test(l));
  if (k === -1) throw new Error(`装置找不到 C1 表的第 ${n} 行 —— 表的形状变了，腿 7 的臂要跟着改`);
  if (L[k].length < at + 10) throw new Error(`C1 第 ${n} 行短于拆点 ${at} —— 夹具没有靶`);
  L.splice(k, 1, L[k].slice(0, at), L[k].slice(at));
  return L.join('\n');
};
// M25 把 C1 表第 8 行从中间拆成两个物理行 → 点名两处（起而不收 + 收而不起）
const m24 = withDoc((t) => splitRow(t, 8, 200));
check(
  'M25 把 C1 表一行拆成两个物理行 → 腿 7 点名 2 处（断行的两半各算一处，且 RC=1）',
  m24.rc === 1 && legCountHas(m24.out, ROW7) === 2,
  `RC=${m24.rc}｜腿7 点名 ${legCountHas(m24.out, ROW7)} 处`,
);
// M25b 反向臂：同样的形状放进**围栏代码块**里 → 不许报。
// 没有这条，下一轮把围栏判定摘掉（或把代码块里的示例表格当成断行）都不会有东西失败。
const m24b = withDoc((t) => `${t.replace(/\n+$/, '')}\n\n\`\`\`md\n| 这行在代码块里，起而不收，但它不是表格行\n\`\`\`\n`);
check(
  'M25b 围栏代码块里"起而不收"的竖线行 → 不报（形状判只认正文，反方向有臂）',
  m24b.rc === 0 && legCountHas(m24b.out, ROW7) === 0,
  `RC=${m24b.rc}｜腿7 点名 ${legCountHas(m24b.out, ROW7)} 处`,
);
// 脱牙（腿 7）：摘掉命中集合后，M25 那份文档不再报那一句，而基线仍绿 ⇒ 这一腿是承重的
const neuter7Decl = 'if (starts !== ends) brokenRows.push(';
if (!readFileSync(GATE, 'utf8').includes(neuter7Decl)) {
  console.log('🔴 装置找不到腿 7 的命中行 —— 脱牙臂会假装成功，拒绝继续。');
  process.exit(2);
}
const neuter7Gate = join(scratch, 'gate-no-leg7.mjs');
writeFileSync(neuter7Gate, readFileSync(GATE, 'utf8').replace(neuter7Decl, 'if (false) brokenRows.push('), 'utf8');
{
  const doc7 = join(scratch, 'doc-split-row.md'); writeFileSync(doc7, splitRow(ORIGINAL, 8, 200), 'utf8');
  const r = spawnSync(process.execPath, [neuter7Gate, doc7], { encoding: 'utf8' });
  const clean = spawnSync(process.execPath, [neuter7Gate, join(repoRoot, DOC)], { encoding: 'utf8' });
  check(
    '脱牙对照 摘掉腿 7 → M25 那份文档**整条判据回到 RC=0**（断行的两半仍被 `/^\\|\\s*N\\s*\\|/` 各认一行、各算"有节/有推荐"）—— 这一腿是唯一的消费者，仓库那份也仍绿',
    r.status === 0 && !`${r.stdout}${r.stderr}`.includes(ROW7) && clean.status === 0,
    `断行文档 RC=${r.status} 且不含腿 7 那句=${!`${r.stdout}${r.stderr}`.includes(ROW7)}｜干净文档 RC=${clean.status}`,
  );
}

// M8b 🔴 M8 换取材方式之后**分辨力会掉**：树里那份与仓库那份字节相同 ⇒ "读错了对象"也照样绿。
//   补一条反向臂：往树里放一份**缺结案档**的副本 ⇒ 必须红、点名那一条，
//   而仓库里那份是干净的（红只能来自树里那一份）。没有这条，M8 只证明"没崩"。
const treeDoc2 = join(scratch, 'tree2');
execFileSync('sh', ['-c', `mkdir -p "$0/$(dirname "$2")" && cp "$1" "$0/$2"`, treeDoc2, join(repoRoot, DOC), DOC]);
writeFileSync(join(treeDoc2, DOC), cutCloser(readFileSync(join(repoRoot, DOC), 'utf8'), 'B6', 3), 'utf8');
const m8b = run(['--root', treeDoc2]);
check(
  'M8b 树里那份缺一条结案档 → 红落在树里那一份（仓库那份干净，红不可能来自它）—— 补 M8 换取材后掉的分辨力',
  m8b.rc === 1 && legCountHas(m8b.out, LEDGER6) === 1 && m8b.out.includes('B6 #3') && m8b.out.includes(`取样：${DOC}`),
  `RC=${m8b.rc}｜缺结案档 ${legCountHas(m8b.out, LEDGER6)}`,
);

// 脱牙（腿 6）：摘掉命中集合后，M17/M18/M21 三份文档都不再报那一句，而基线仍绿
const neuter6Decl = 'const openLedger = ledgerItems.filter((it) => !it.body.some((l) => CLOSER_LABEL.test(l)));';
if (!readFileSync(GATE, 'utf8').includes(neuter6Decl)) {
  console.log('🔴 装置找不到腿 6 的声明行 —— 脱牙臂会假装成功，拒绝继续。');
  process.exit(2);
}
const neuter6Gate = join(scratch, 'gate-no-leg6.mjs');
writeFileSync(neuter6Gate, readFileSync(GATE, 'utf8').replace(neuter6Decl, 'const openLedger = [];'), 'utf8');
const neutered = [cutCloser(ORIGINAL, 'B6', 3), editCloser(ORIGINAL, 'C2', 13, (l) => l.replace('补法：', '以后再看：')), cutCloser(ORIGINAL, 'C2', 1)].map((t) => {
  writeFileSync(doc, t, 'utf8');
  const r = spawnSync(process.execPath, [neuter6Gate, doc], { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
});
check(
  '脱牙对照 摘掉腿 6 → M17/M18/M21 三份都不再报那一句（三臂全部挂在腿 6 上，且没顺手摘掉整条判据）',
  neutered.every((r) => r.rc === 0 && !r.out.includes('未核实台账里这条')),
  neutered.map((r, i) => `臂${i + 1} RC=${r.rc}`).join('｜'),
);

// 减法现量：把 M17 那份文档喂「还没有腿 6 的那版判据」⇒ 必须 RC=0
// 🔴 旧版按**内容**从文件历史认，不按 HEAD（腿 6 一提交，按 HEAD 取的下一笔就会自己变红）。
{
  const hist = execFileSync('git', ['-C', repoRoot, 'log', '--format=%H', '--', 'scripts/check-detail-pane-c1-coverage.mjs'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 14);
  let found = '';
  let oldSrc = '';
  for (const sha of hist) {
    const src = execFileSync('git', ['-C', repoRoot, 'show', `${sha}:scripts/check-detail-pane-c1-coverage.mjs`], { encoding: 'utf8' });
    if (!src.includes('CLOSER_LABEL') && src.includes('const noExt =')) {
      found = sha;
      oldSrc = src;
      break;
    }
  }
  if (!found) throw new Error(`前 ${hist.length} 版里找不到"还没有腿 6"的那版判据 —— 窗口要放宽，但绝不许拿当前版冒充旧版。`);
  const oldGate = join(scratch, 'gate-before-leg6.mjs');
  writeFileSync(oldGate, oldSrc, 'utf8');
  writeFileSync(doc, cutCloser(ORIGINAL, 'B6', 3), 'utf8');
  const r = spawnSync(process.execPath, [oldGate, doc], { encoding: 'utf8' });
  check(
    'M24 同一份变异喂「还没有腿 6 的那版判据」→ RC=0（补的是实测存在的缺口，不是顺手加严）',
    r.status === 0,
    `RC=${r.status}｜取的是 ${found.slice(0, 8)}（按内容认）`,
  );
}
writeFileSync(doc, ORIGINAL, 'utf8');

// —— N1/N1b/N2（腿 5 的第二次加固：裸文件名引用要先跟 `git ls-files` 对一次再定自家/第三方）
// 21:5x 现量的洞：本批自己在 C1b-Q14 里把自家文件写成 `ListsSection.tsx:174`，
// 腿 5 第一版按"有没有本仓顶层目录前缀"反向认 ⇒ 这枚**自家**行号被数成"第三方源码引用"，
// 那一节于是白拿 `外部锚=有` —— 而"自家行号不许冒充外部证据"正是腿 5 存在的唯一理由（§8.88）。
const bareOwn = swapDocUrls(ORIGINAL, /C1b-Q1/, 'HabitsView.tsx:181');
const n1 = withDoc(() => bareOwn);
check(
  'N1 把某一节的 URL 全换成**裸名自家文件**的行号 → 红腿 5（这一档在加固前会放过，那就是洞）',
  n1.rc === 1 && legCount(n1.out, NOEXT) === 1 && legCount(n1.out, WEAK) === 0 && n1.out.includes('C1b-Q1'),
  `RC=${n1.rc}｜缺外部锚 ${legCount(n1.out, NOEXT)}｜weak ${legCount(n1.out, WEAK)}`,
);
// N1b：同一形写法但换成**在册没有的**裸名（真第三方源码）⇒ 必须放过。缺这条，加固就成了"裸名一律不算"。
const n1b = swapUrls(/C1b-Q1/, 'StreakList.kt:133');
check(
  'N1b 同一节只留一个**在册查不到**的裸名行号 → 放过（证明认的是"是不是我们的文件"，不是"有没有斜杠"）',
  n1b.rc === 0 && legCount(n1b.out, NOEXT) === 0,
  `RC=${n1b.rc}｜缺外部锚 ${legCount(n1b.out, NOEXT)}`,
);
// N2：`git` 不可用（产物树模式）⇒ 这一档判不了，必须**如实声明且不改变判决**
const tree3 = join(scratch, 'tree3');
execFileSync('sh', ['-c', `mkdir -p "$0/$(dirname "$2")" && cp "$1" "$0/$2"`, tree3, join(repoRoot, DOC), DOC]);
writeFileSync(join(tree3, DOC), bareOwn, 'utf8');
const n2 = run(['--root', tree3]);
check(
  'N2 产物树里没有 git → 承重(腿5) 写明"判不了、一律按第三方算"，且**不因此报红**（缺信息时不判别人）',
  n2.rc === 0 && /判不了/.test(n2.out),
  `RC=${n2.rc}`,
);
// N3 减法现量：N1 那份文档喂「还没有裸名归属判定的那版判据」⇒ 必须 RC=0（按内容认，不按 HEAD）
{
  const hist = execFileSync('git', ['-C', repoRoot, 'log', '--format=%H', '--', 'scripts/check-detail-pane-c1-coverage.mjs'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 14);
  let found = '';
  for (const sha of hist) {
    const src = execFileSync('git', ['-C', repoRoot, 'show', `${sha}:scripts/check-detail-pane-c1-coverage.mjs`], { encoding: 'utf8' });
    if (!src.includes('OWN_BY_BASENAME') && src.includes('const noExt =')) {
      found = sha;
      writeFileSync(join(scratch, 'gate-before-basename.mjs'), src, 'utf8');
      break;
    }
  }
  if (!found) throw new Error(`前 ${hist.length} 版里找不到"还没有裸名归属判定"的那版 —— 窗口要放宽，不许拿当前版冒充`);
  const r = spawnSync(process.execPath, [join(scratch, 'gate-before-basename.mjs'), join(tree3, DOC)], { encoding: 'utf8' });
  check(
    'N3 同一份变异喂「还没有裸名归属判定的那版判据」→ RC=0（补的是实测存在的洞，不是顺手加严）',
    r.status === 0,
    `RC=${r.status}｜取的是 ${found.slice(0, 8)}（按内容认）`,
  );
}
writeFileSync(doc, ORIGINAL, 'utf8');

// 对照：恢复干净后全绿
const control = withDoc(null);
check('对照 恢复干净后全绿', control.rc === 0, `RC=${control.rc}`);

rmSync(scratch, { recursive: true, force: true });

console.log(`\n读数：判据 ${GATE.split('/').pop()}｜C1 ${bc.rows} 行（有节 ${bc.covered} / 例外 ${bc.excused} / 未覆盖 ${bc.unexcused}）｜C1b ${bc.sections} 节（推荐 ${baseRec?.withRec} / 标题例外 ${baseRec?.excused}）｜台账 ${l6 ? `B6 ${l6[1]} + C2 ${l6[2]}：已结案档 ${l6[3]} / 缺 ${l6[4]}` : '承重(腿6) 读数行没解析出来'}`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log(`\n结论：${notes.length}/${notes.length + fail.length} 臂符合预期（臂的分解见文件头，不在这里写死条数）✅`);
