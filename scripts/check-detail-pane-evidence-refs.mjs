#!/usr/bin/env node
// 本线文档里「截图路径」这一栏的可解析性判据（工单 §4「界面类必须截图且人看图」+
// 目标第 4 条「§8 读数含截图路径」的机器消费者）。
//
// 为什么需要它（不是"顺手加一条"）：常驻死链门禁 research/tools/docs-link-check.mjs
// 在抽链接前把行内代码整段抹成空格（该文件 :170-171），而本线所有证据引用**一律写成
// `apps/web/evidence/...`** —— 也就是说那半条门禁对本线证据的射程是 0。
//
// 🔴 抽取形状不许只认「完整路径 + 单文件名」：本线证据的主体写法是**花括号分组**
// （`…/keyboard-cursor/{k1-…,k7-…}.png`，11 组）。按 `[A-Za-z0-9./-]+\.png` 抽
// 会得到 9 条，而真实展开后是几十条 —— 那种探针的"没报缺失"证明不了任何事，
// 因为分组成员根本没进过集合。所以本脚本对**含图片后缀却没有 `{}` 配对形状**的
// token 也照样入账，并把解析不到的显式列成红。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DEFAULT_DOCS = [
  'docs/plans/detail-pane-alignment.md',
  'docs/research/detail-pane-alignment-and-spaced-review.md',
];
const docs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = (docs.length ? docs : DEFAULT_DOCS).map((d) => (d.startsWith('/') ? d : join(root, d)));

const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
let trackedRaw;
try {
  trackedRaw = git(['ls-files']);
} catch (error) {
  console.log(
    '🔴 拿不到 `git ls-files` —— 「本机有、仓库里没有」这一半判据无法执行，拒绝给出"通过"的结论。\n' +
      `   git 报的是：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
const tracked = trackedRaw.split('\n').filter(Boolean);
const trackedSet = new Set(tracked);

// 一个 token = 任意层目录前缀 + 可选 `{a,b}` 分组 + 图片扩展名。
// 🔴 前缀那段必须能吃 `/`：只写 `[A-Za-z0-9_.-]*\{?…` 的话，正则从最后一个斜杠后开始匹配，
// `…/keyboard-cursor/{k1-…,k7-…}.png` 的 `keyboard-cursor/` 会整段丢掉 ⇒ 每条分组引用都被
// 降级成"裸文件名"，而"全路径必须落盘且入库"那一半判据就永远轮不到它们（假绿）。
// 🔴 也必须能吃 `* ? [ ]`：本线文档里有 7 处**通配模式**（`evidence/**/*.png`、`md5 …/*.png`）。
// 不让它们进 token，正 just 会把 `*.png` 前面那截截掉、只剩一个 `.png` 的 token 落进"解析不了"
// 那一档 —— 第一趟就是这么得到 7 条假红的。认成完整 token 之后再按"含星号"分到模式档，
// 既不判它落位、也不静默跳过。
// ⚠️ 逗号**只在花括号内**允许：放进前缀字符类会让 `a.png,b.png` 被贪心吃成一个 token。
// ⚠️ 省略号也要进字符类：人写缩略引用（`{k1-…,k7-…}.png`）时，若正则吃不到 `…`，
// token 会在省略号处断掉、只剩 `}.png` —— 那会被当成"形状解析不了"报红，
// 而它其实是腿 5 那一档（缩略提及）。让它完整进 token，分类才有得可分。
const TOKEN =
  /[A-Za-z0-9_.\-*?[\]/…]*\{?[A-Za-z0-9_.\-,…]*\}?\.(?:png|jpg|jpeg|webp)/g;
const GLOBY = /[*?[\]]/;

function expand(token) {
  const open = token.indexOf('{');
  if (open === -1) {
    if (token.includes('}')) return { refs: [], bad: '闭合花括号没有对应的开头' };
    return { refs: [token], bad: null };
  }
  const close = token.indexOf('}', open);
  if (close === -1) return { refs: [], bad: '花括号没闭合' };
  const group = token.slice(open + 1, close);
  const parts = group.split(',');
  if (parts.length < 2 || parts.some((p) => p === '' || p.includes('{') || p.includes('}'))) {
    return { refs: [], bad: `分组里不足两项或有空项：{${group}}` };
  }
  if (token.slice(close + 1).includes('{')) return { refs: [], bad: '不支持一个 token 里两组花括号（要分开写）' };
  const head = token.slice(0, open);
  const tail = token.slice(close + 1);
  return { refs: parts.map((p) => `${head}${p}${tail}`), bad: null };
}

const TOP_DIRS = ['apps/', 'packages/', 'server/', 'docs/', 'scripts/', 'e2e/', 'research/', 'screenshots/'];

const rows = [];
const malformed = [];
// 🔴 形如 `apps/web/evidence/**/*.png`、`evidence/ios-reminder-*.png` 的是**模式**，不是一条引用：
// 把它们当引用会得 7 条假红（本脚本第一趟就是这样），把它们**静默跳过**则等于给探针开了一个
// "写成星号就不用落位"的旁路。所以单列一类：打印计数 + 逐条列出，明确"看见过、刻意不判"。
const patterns = [];
// 绝对路径（`/tmp/…` 这类）说的是**库外**的东西，不在"仓库跟踪"这件事的射程里 —— 同上一条，
// 单列、打印、不判，而不是悄悄不算。
const external = [];
// 两类"提到 `.png` 但不是引用"的形状，各配一条独立归档（打印、不判、不静默跳过）：
//   · 纯扩展名提及：`.png` 前面没有文件名字符 —— 它谈的是后缀本身（"拿 `.png` 的 basename 去 stat"）；
//   · 缩略提及：组里写省略号（`{k1-…,k7-…}.png`）—— 形状上就不可能落位，是人在说话不是在指文件。
// ⚠️ 这两档同时也是**旁路**：把引用写成省略号就躲过这条判据。和通配模式一样，处置是"让它出现在打印里"，
// 而不是假装不存在 —— 所以本节的读数把这几档逐条列出，任何一轮想核对覆盖面可以直接数。
const mentions = [];
let tokens = 0;
let expanded = 0;

for (const file of targets) {
  // 库外文档（变异臂的夹具都在 /tmp）：`slice(root.length+1)` 会读成空串，
  // 于是报告里"取样文档"和每条红行的出处**双双变成空** —— 红是红了，但没人看得出是哪一份。
  const relDoc = file.startsWith(root + '/') ? file.slice(root.length + 1) : file;
  if (!existsSync(file)) {
    malformed.push({ doc: relDoc, token: '(整个文件)', why: '文件不存在' });
    continue;
  }
  const text = readFileSync(file, 'utf8');
  let lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo += 1;
    for (const token of line.match(TOKEN) || []) {
      tokens += 1;
      if (GLOBY.test(token) || token.includes('…')) {
        (GLOBY.test(token) ? patterns : mentions).push(`${relDoc}:${lineNo} ${token}`);
        continue;
      }
      const { refs, bad } = expand(token);
      if (bad) {
        malformed.push({ doc: relDoc, token: `${relDoc}:${lineNo} ${token}`, why: bad });
        continue;
      }
      for (const ref of refs) {
        if (ref.startsWith('.')) {
          mentions.push(`${relDoc}:${lineNo} ${ref} —— 纯扩展名提及，没有文件名片段`);
          continue;
        }
        if (ref.startsWith('/')) {
          external.push(`${relDoc}:${lineNo} ${ref}`);
          continue;
        }
        expanded += 1;
        const full = TOP_DIRS.some((t) => ref.startsWith(t));
        if (full) {
          const onDisk = existsSync(join(root, ref));
          rows.push({
            doc: relDoc,
            line: lineNo,
            ref,
            kind: 'full',
            onDisk,
            isTracked: trackedSet.has(ref),
            bad: !onDisk || !trackedSet.has(ref),
          });
        } else {
          const base = ref.split('/').pop();
          // 🔴 先按「族/文件名」这种带目录的简写配，配不到才退到纯文件名：顺序反过来，
          // 一个简写会被解析到**另一族的同名文件**上 —— 那比悬空引用更坏，它看起来是绿的。
          const byPath = tracked.filter((p) => p === ref || p.endsWith(`/${ref}`));
          const byBase = byPath.length === 0 ? tracked.filter((p) => p.split('/').pop() === base) : [];
          const cands = byPath.length > 0 ? byPath : byBase;
          const only = cands.length === 1 ? cands[0] : undefined;
          rows.push({
            doc: relDoc,
            line: lineNo,
            ref,
            kind: 'short',
            onDisk: only !== undefined && existsSync(join(root, only)),
            isTracked: only !== undefined,
            resolved: only,
            // 0 个 = 悬空引用；>1 个 = 简写撞在同名文件上，读的人不知道是哪一张
            bad: only === undefined,
            candidates: cands,
          });
        }
      }
    }
  }
}

const missing = rows.filter((r) => r.kind === 'full' && !r.onDisk);
const untracked = rows.filter((r) => r.kind === 'full' && r.onDisk && !r.isTracked);
const unresolved = rows.filter((r) => r.kind === 'short' && r.bad);

const rel = (f) => (f.startsWith(root + '/') ? f.slice(root.length + 1) : f);
console.log(`取样文档：${targets.length} 份（${targets.map(rel).join(', ')}）`);
console.log(
  `图片 token ${tokens} 个（其中 ${patterns.length} 个是通配模式，见下）⇒ 花括号展开后引用 ${expanded} 条（全路径 ${rows.filter((r) => r.kind === 'full').length} / 简写 ${rows.filter((r) => r.kind === 'short').length}）`,
);
const okRows = rows.filter((r) => !r.bad);
const uniqFiles = new Set(
  okRows.map((r) => (r.kind === 'full' ? r.ref : r.resolved)),
);
console.log(
  `计数单位：引用（按出现次数）${expanded} 条 → 去重后指向 ${new Set(rows.map((r) => (r.kind === 'full' ? r.ref : r.resolved ?? r.ref))).size} 个位置，其中成立 ${uniqFiles.size} 个`,
);
if (expanded === 0) {
  console.log('🔴 展开后引用 0 条 —— 抽取形状本身坏了，这条判据此刻证明不了任何事（拒绝报绿）。');
}
if (patterns.length) {
  console.log(`\n· 通配模式 ${patterns.length} 个（看见过，按定义不判落位）：`);
  for (const p of patterns) console.log(`  ${p}`);
}
if (external.length) {
  console.log(`\n· 绝对路径 ${external.length} 个（库外，不在"仓库跟踪"的射程内）：`);
  for (const e of external) console.log(`  ${e}`);
}
if (mentions.length) {
  console.log(`\n· 提到「.png 这个后缀」但不是引用 ${mentions.length} 处（纯扩展名 / 组里带省略号 —— 打印出来是为了让覆盖面可数）：`);
  for (const m of mentions) console.log(`  ${m}`);
}

const printList = (title, list, line) => {
  if (!list.length) return;
  console.log(`\n${title}（${list.length} 条）：`);
  for (const r of list) console.log(line(r));
};
printList('🔴 全路径引用在盘上不存在', missing, (r) => `  ${r.doc}:${r.line}  ${r.ref}`);
printList('🔴 盘上有、仓库没跟踪（干净检出上不存在）', untracked, (r) => `  ${r.doc}:${r.line}  ${r.ref}`);
printList(
  '🔴 简写引用无法唯一落到一个入库文件（0 个或歧义）',
  unresolved,
  (r) => `  ${r.doc}:${r.line}  ${r.ref} —— 候选 ${r.candidates.length} 个：${r.candidates.slice(0, 3).join(' | ') || '无'}`,
);
printList('🔴 token 形状本身解析不了', malformed, (r) => `  ${r.token} —— ${r.why}`);

const shortAmbiguous = rows.filter((r) => r.kind === 'short' && !r.bad);
if (shortAmbiguous.length) {
  console.log(`\n· 简写但能唯一落位的 ${shortAmbiguous.length} 条（不算红，建议下一轮补全前缀）：`);
  for (const r of shortAmbiguous.slice(0, 12)) console.log(`  ${r.doc}:${r.line}  ${r.ref} → ${r.resolved}`);
}

const bad = missing.length + untracked.length + unresolved.length + malformed.length + (expanded === 0 ? 1 : 0);
console.log(`\n结论：${bad === 0 ? '本线文档每条截图引用都落在一枚被仓库跟踪的文件上 ✅' : `🔴 ${bad} 处不成立`}`);
process.exit(bad === 0 ? 0 : 1);
