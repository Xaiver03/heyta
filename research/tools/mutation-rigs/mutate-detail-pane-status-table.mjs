#!/usr/bin/env node
/**
 * `scripts/check-detail-pane-status-table.mjs` 的变异臂（工单 §8.67）。
 *
 * 那条判据钉的是目标第 4 条："每完成一单回填 §8 落地记录（读数含判据条数/变异臂红集/截图路径），
 * 状态只允许未开工/进行中/已完成"。它存在的理由是 16:5x 那次现量：W1 那一格把 19 行 prose 写进了
 * 表格单元，GFM 的表格遇第一行非表格文本就结束 ⇒ 整张表截断在 W1，后面 15 枚工单行渲染成正文，
 * 而**没有任何东西会失败**。臂 S5 复现的就是那一次。
 *
 * 跑法（linked worktree 里别用 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-status-table.mjs
 *
 * 八臂的**预期**（S7 与两条对照是守载体的臂）：
 *   S1 抹掉某行的闭合竖线            → 红在「没有闭合竖线」，点名那一枚单，且**只有这一条红**
 *   S2 把某行状态改成「基本完成」     → 红在「状态没命中封闭三档」（目标那句禁词的机器消费者）
 *   S3 复制一行（同一枚单记两次）     → 红在「工单 id 重复」
 *   S4 删掉某行的图片引用但留着「截图」→ 红在「写了截图却没带引用」
 *   S5 在 W1 后面插一行普通文字（= 事故复现）→ 红在「表外的孤儿工单行」，且表格读数只剩 2 枚
 *   S6 删掉表头                      → 响亮地拒绝报绿（"找不到那张表"），不许按"没有违规"处理
 *   S7 只给 `--root` 不给文档         → 必须**绿**（守 `--root` 的实参不被当成文档路径吃掉）
 *   对照 ×2                          → 未变异 / 复位后都全绿
 *
 * 🔴 每臂除了退出码，还断言**红落在点名的那条腿**、且别的腿没有跟着红 ——
 * 只看 RC 的臂会把"判据自己崩了"读成"变异成功"。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE = process.argv[2] ?? join(repoRoot, 'scripts/check-detail-pane-status-table.mjs');
const DOC = 'docs/plans/detail-pane-alignment.md';
const ORIGINAL = readFileSync(join(repoRoot, DOC), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'dp-status-'));
const doc = join(scratch, 'doc.md');
writeFileSync(doc, ORIGINAL, 'utf8');

const notes = [];
const fail = [];
const check = (arm, cond, detail) => (cond ? notes : fail).push(`  ${cond ? '✅' : '🔴'} ${arm}${detail ? ` —— ${detail}` : ''}`);

const run = (args = []) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
const legCount = (out, title) => {
  const seg = out.split(`\n${title}（`)[1];
  if (!seg) return 0;
  const m = seg.match(/^(\d+) 条）/);
  return m ? Number(m[1]) : 0;
};
const LEGS = {
  unclosed: '🔴 数据行没有闭合竖线（多半是一行被写成多行 / 表格正在往外漏）',
  status: '🔴 状态没命中封闭三档（已完成/进行中/未开工 —— "基本完成"这类落在这里）',
  dup: '🔴 工单 id 重复',
  shot: '🔴 读数里写了「截图」却没带任何图片引用（也没写「无界面格」）',
  orphan: '🔴 表外的孤儿工单行（表格被中途截断的化石 —— 它们渲染成正文，状态等于没人记）',
};
const rowsIn = (out) => Number(out.match(/连续 (\d+) 枚工单行/)?.[1] ?? 0);

const mutate = (fn, args = [doc]) => {
  const next = fn(ORIGINAL);
  if (next === ORIGINAL) throw new Error('变异没有改动文档（抽取形状对不上原文）—— 臂是装饰，拒绝继续。');
  writeFileSync(doc, next, 'utf8');
  const res = run(args);
  writeFileSync(doc, ORIGINAL, 'utf8');
  return res;
};
/** 期望：点名那条腿恰好 +1（或至少 1，对 S5 那种成片的），别的腿为 0，RC=1。 */
const expectRed = (arm, res, leg, needle, extra = () => true) => {
  if (res.rc === 0) return check(arm, false, `RC=0（判据没红）｜${res.out.split('\n').pop().slice(0, 50)}`);
  const n = legCount(res.out, leg);
  const others = Object.entries(LEGS)
    .filter(([k]) => LEGS[k] !== leg)
    .map(([k, v]) => `${k}:${legCount(res.out, v)}`)
    .join(' ');
  const ok = n >= 1 && res.out.includes(needle) && extra(n) && res.out.includes('🔴');
  if (!ok) return check(arm, false, `命中 ${n} 条｜needle「${needle}」=${res.out.includes(needle)}｜别的腿 ${others}`);
  notes.push(`  ✅ ${arm} —— 命中 ${n} 条（别的腿 ${others}）`);
  return true;
};

const base = run();
const baseRows = rowsIn(base.out);
check('对照 未变异副本全绿', base.rc === 0 && baseRows >= 14, `RC=${base.rc}｜连续 ${baseRows} 枚工单行`);

// S1：抹掉 W3 那一行结尾的竖线
expectRed(
  'S1 未闭合的行',
  mutate((t) => t.replace(/^(\| W3 \|.*[^\s])\s*\|\s*$/m, '$1')),
  LEGS.unclosed,
  'W3',
  (n) => n === 1,
);

// S2：状态改成禁词那档
expectRed(
  'S2「基本完成」不在封闭词表里',
  mutate((t) => t.replace('| W5 | 🔄 **进行中**', '| W5 | 🔄 **基本完成**')),
  LEGS.status,
  'W5',
  (n) => n === 1,
);

// S3：复制一行（同一枚单记两次）
const s3 = mutate((t) => {
  const line = t.split('\n').find((l) => /^\|\s*W9\b/.test(l));
  return t.replace(line, `${line}\n${line}`);
});
expectRed('S3 工单 id 重复', s3, LEGS.dup, 'W9', (n) => n === 1);

let s4Id = '';
// S4：删掉某行的图片引用、留着「截图」二字。靶**现选**（不写死单号）：
// 挑第一枚"既写了截图、又带着图片引用"的行 —— 写死单号的话，文档一改就静默变成空变异臂。
const s4 = mutate((t) => {
  const lines = t.split('\n');
  const idx = lines.findIndex(
    (l) => /^\|\s*W[0-9]+[a-z]?\b/.test(l) && /截图/.test(l) && /\.(?:png|jpg|jpeg|webp)/.test(l),
  );
  if (idx === -1) throw new Error('S4 找不到"既写截图又带引用"的行 —— 本线的落地记录形态变了');
  const line = lines[idx];
  const id = line.match(/^\|\s*(W[0-9]+[a-z]?)\b/)[1];
  const stripped = line.replace(/[^\s`|{}]*\.(?:png|jpg|jpeg|webp)/g, '一张入库截图');
  if (stripped === line) throw new Error('S4 的替换没命中（静默空改动 = 臂是装饰）');
  lines[idx] = stripped;
  s4Id = id;
  return lines.join('\n');
});
expectRed('S4 说看过截图却没给路径', s4, LEGS.shot, s4Id);

// S5：事故复现 —— 在 W1 之后插一行普通文字，表格当场结束，后面的行全部掉出表格
const s5 = mutate((t) => t.replace(/^(\| W1 \|.*\|\s*)$/m, '$1\n这里是一段插进来的普通说明文字。\n'));
expectRed('S5 表被中途截断（本次事故的形状）', s5, LEGS.orphan, 'W1b', () => rowsIn(s5.out) === 2);
// ⚠️ 判据只报**边界那一枚**（掉出去的行彼此仍相邻，前一行还是 `|` 开头），这是设计不是漏报：
// 要的是"表在这里断了"这个信号，行号给了就能数。所以臂断言"红 + 表格只剩 2 行"，不要求红 15 条。

// S6：删掉表头 ⇒ 必须响亮失败，不许"没有违规"
const s6 = mutate((t) => t.replace(/^\|\s*单\s*\|\s*状态\s*\|\s*读数.*$/m, '<表头被装置删掉了>'));
check(
  'S6 表头没了 → 拒绝报绿',
  s6.rc === 1 && s6.out.includes('找不到 `| 单 | 状态 | 读数` 那张表'),
  `RC=${s6.rc}`,
);

// S7：只给 `--root`（产物树模式），实参不许被当成文档
const treeRoot = join(scratch, 'tree');
execFileSync('sh', ['-c', `mkdir -p "$0/tree" && git -C "$1" archive HEAD -- "$2" | tar -x -C "$0/tree"`, scratch, repoRoot, DOC]);
const s7 = run(['--root', treeRoot]);
// 这一臂只守"参数形状"（`--root` 的实参不能被当成文档吃掉），**不**要求树里那份一定绿：
// 载体是提交态，而修表格这笔可能还没提交 —— 那种情况下它必须**报出原因**（孤儿行），不许静默绿。
check(
  'S7 产物树模式（只给 --root）→ 读的是树里的文档',
  s7.out.includes(`取样：${DOC}`) && (s7.rc === 0 || legCount(s7.out, LEGS.orphan) > 0),
  `RC=${s7.rc}｜连续 ${rowsIn(s7.out)} 枚工单行（提交态那棵树可能仍是旧表，红必须报在孤儿行那一档）`,
);

const control = run();
check('对照 恢复干净后全绿', control.rc === 0, `RC=${control.rc}`);

rmSync(scratch, { recursive: true, force: true });
console.log(`\n读数：判据 ${GATE.split('/').pop()}｜基线连续 ${baseRows} 枚工单行`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log(`\n结论：${notes.length}/${notes.length + fail.length} 臂符合预期（5 变异 + 1 响亮失败 + 1 守载体 + 2 对照）✅`);
