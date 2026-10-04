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
 * 各臂的**预期**（S7 与两条对照是守载体的臂；条数不写在标题里，写在标题里的数字一定会漂）：
 *   S1 抹掉某行的闭合竖线            → 红在「没有闭合竖线」，点名那一枚单，且**只有这一条红**
 *   S2 把某行状态改成「基本完成」     → 红在「状态没命中封闭三档」（目标那句禁词的机器消费者）
 *   S3 复制一行（同一枚单记两次）     → 红在「工单 id 重复」
 *   S4 删掉某行的图片引用但留着「截图」→ 红在「写了截图却没带引用」
 *   S5 在 W1 后面插一行普通文字（= 事故复现）→ 掉出表格的行**逐枚**点名，点名数 = 总行数 − 2
 *   S6 删掉表头                      → 响亮地拒绝报绿（"找不到那张表"），不许按"没有违规"处理
 *   S7 只给 `--root`（产物树模式）    → 必须读树里那份文档；**红了就得点名**（红在哪一档不写死，见下面那段）
 *   S8 表外插一张**带分隔行**的表     → 不许红（这条挡住假红：本文件另一张表也长这样）
 *   S9 同一张表**去掉分隔行**         → 同一枚行必须点名（证明判的是分隔行，不是状态词）
 *   S10 表外一段、其中一行状态不在三档 → 两行都点名（旧写法会漏掉不合规那一枚）
 *   N1 把某行的"变异/臂"换成同义词 → 红在「已开工的行没记变异读数」，只点名那一枚
 *   N2 同一行改成「无变异面：+理由」→ 放过（这条绿是有意义的：换词已先断言过 needle 不在了）
 *   N3 只写光秃秃的「无变异面」不给理由 → 仍然红（挡"空白通行证"）
 *   N4 把某行的「截图」换成"八张图逐张看过"这类同义措辞**并剥掉图路径** → 仍须点名（触发词表有牙）
 *   N5 同一行只换措辞、图路径还在 → 放过（挡扩射程带来的假红）
 *   对照 ×2                          → 未变异 / 复位后都全绿
 *
 * 🔴 19:0x 起多了腿 7（判据条数）与腿 8（臂条数 + 红集），各臂方向**相反**地夹住这两条腿：
 *   J1 剥掉某一格的判据条数（"判据"二字留着）  → 腿 7 点名那一格
 *   J2 同一格换成另一种字序（`N 条判据`）        → 放过（两种词形都在射程里，不许收敛成一种）
 *   J3 把某一格的红集措辞（`⇒ 某层 红`）抹掉      → 腿 8 点名那一格（只剩臂条数不算报过红集）
 *   J4 光秃秃的「无变异面」不给理由               → 腿 8 红、腿 6 **放过**（两档问的不是同一件事：
 *                                                  腿 6 判"提没提到变异"，腿 8 判"有没有读数"）
 *   J5 把"判据"与"N 条"**拆到两个句子**里         → 腿 7 仍须点名（这条钉住"按句取语义"这个决定；
 *                                                  字符窗口版的假绿就是从这一格进来的）
 *   脱牙 摘掉腿 7/8 的命中集合                     → J1/J3/J5 三臂全部失能（有一条仍红 = 它没挂在那条腿上）
 *   S7 的预期被这两条腿改写过：它原来断"提交态那棵树红只能红在孤儿腿"，而 HEAD 的文档还没有本轮
 *   补进 W0/W1c 两格的判据条数 ⇒ 腿 7/8 在那棵树上合法地红。**把期望钉在某一具体档上 = 把"我这轮
 *   还没提交"写成前提**，所以改成只断"退 1 必须有一档点名"。
 *
 * 🔴 19:5x 起多了腿 9（表格单元 code span 里的裸竖线），六条臂 + 一把脱牙：
 *   P1 §8 表某一格的码段里注入裸竖线            → **只有腿 9 红**（那八条全放过 —— 行闭合、状态、读数都没动）
 *   P2 同一处写成 GFM 要求的转义式               → 放过（判的是"裸"竖线；这条挡住"为了绿把竖线删掉"的改法）
 *   P3 靶换到 §8 区间**之外**的另一张表          → 同样点名（钉住"射程=整份文档的表行"；本轮真写坏的三处里两处不在 §8 区间）
 *   P4 同一份变异喂 **还没有腿 9 的那版判据**     → 必须 RC=0（减法现量：这一族此前**零消费者**，
 *                                                  没有这一臂，腿 9 就只是"顺手加严"而不是补实测缺口）。
 *                                                  🔴 那一版**按内容从文件历史里认，不按 HEAD 取**：写臂时 HEAD 是八腿版，
 *                                                  腿 9 一提交它就成九腿版 ⇒ 按 HEAD 取会在"补完的下一笔"上自己变红
 *                                                  （本批 19:5x 写下、20:1x 就红了一次，红的原因是历史前进了不是判据坏了）
 *   P5 码段整体**就是一根**裸竖线（段首无前驱字符）→ 点名。这一形是腿 9 第一版放走过的两处真缺陷，
 *                                                  由 main 那条共享门禁 `check:md-tables` 按**列数**照出来的（工单 §8.87）
 *   P5e 同一形写成转义式                         → 放过（证明 P5 的红不是"码段里不许出现竖线"）
 *   脱牙 摘掉腿 9 的命中集合                     → P1/P3/P5 三臂全部失能
 *
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
  shot: '🔴 读数里声称看过界面图却没带任何图片引用（也没写「无界面格」）',
  orphan: '🔴 表外的孤儿工单行（表格被中途截断的化石 —— 它们渲染成正文，状态等于没人记）',
  mut: '🔴 已开工的行没记变异读数（也没写「无变异面」+理由）',
  judge: '🔴 已开工的行没写**判据条数**（也没写「无判据面」+理由）',
  arm: '🔴 变异那一档没有"臂条数 + 红集"两个读数（光提一句不算，纯文档单走「无变异面」+理由）',
  pipe: '🔴 表格单元的 code span 里有裸竖线（GFM 会在这里切格，行不裂但格子裂 —— 前八条腿一条都不红）',
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
// 🔴 断言"掉出去的**每一行**都点名"，而不是"红就行"：判据曾经写成"前一行不是表格行 ⇒ 孤儿"，
// 于是整段掉出去的行里只点最前面那一枚（2026-10-04 现量：产物树里对面带回来的 13 行旧抄件只报了 1 行）。
// 现在按"这一段有没有分隔行"判，所以 `baseRows - 2` 行必须**逐枚**列出来。
expectRed(
  'S5 表被中途截断（本次事故的形状）',
  s5,
  LEGS.orphan,
  'W1b',
  (n) => n === baseRows - 2 && rowsIn(s5.out) === 2 && s5.out.includes('| W12'),
);
// 上一条的 extra 里同时钉住三件事：表只剩 2 行、孤儿点名数 = 掉出去的行数、**最后那一枚 W12 也在名单里**。

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
// 这一臂只守"参数形状"（`--root` 的实参不能被当成文档吃掉）+ **红了必须点名**，
// 不要求树里那份一定绿：载体是提交态，而修表格这笔可能还没提交。
// ⚠️ 第二档原来写成"红只能报在孤儿行那一档"，19:0x 被自己的新腿否证：那一棵 HEAD 的文档里
// W0/W1c 两格还没有判据条数与红集读数 ⇒ 腿 7/8 在那棵树上合法地红，而孤儿行是 0。
// 把期望钉在"某一具体档"上就是把**本轮尚未提交的编辑**写死成前提（同一形状的错误本项目记过多次）。
// 现在断的是这条臂真正要守的事：**退 1 的时候必须有一档点名，不许安静地红**。
const sumLegs = (out) => Object.values(LEGS).reduce((s, title) => s + legCount(out, title), 0);
check(
  'S7 产物树模式（只给 --root）→ 读的是树里的文档，且红必须带着点名（不许安静地退 1）',
  s7.out.includes(`取样：${DOC}`) && (s7.rc === 0 || sumLegs(s7.out) > 0),
  `RC=${s7.rc}｜连续 ${rowsIn(s7.out)} 枚工单行｜各档点名合计 ${sumLegs(s7.out)}（提交态那棵树可以红在任何一档，只要它点名）`,
);

// S8 / S9 / S10：表外那一段"算不算表"的判别依据是**分隔行**（`|---|---|`），不是状态词。
// 三条臂把它夹在中间：有分隔行 ⇒ 不许红（挡假红，本文件后面那张「单 → 落到哪一步」表就靠这一条活着）；
// 没分隔行 ⇒ 点名；而"没分隔行 + 状态措辞不在三档里"那一枚也必须点名 —— 旧写法（按状态词筛）漏的正是它，
// 现量在产物树里 `| W10 | ⏸ 不在本篇开工（…` 那一行：腿 2 只扫表区间看不见它，腿 5 按状态词又筛不到它，
// 两处各自合理、合起来让一枚不合规的状态**完全没有消费者**。
const regionEnd = (() => {
  const m = base.out.match(/表区间：第 (\d+) 行起，连续 (\d+) 枚/);
  if (!m) throw new Error('读不到「表区间：第 N 行起，连续 M 枚」这行 —— 判据的输出格式变了，这几条臂没有靶');
  return Number(m[1]) + 1 + Number(m[2]);
})();
const insertAfterRegion = (block) =>
  mutate((t) => {
    const lines = t.split('\n');
    lines.splice(regionEnd, 0, block);
    return lines.join('\n');
  });

// S8：插一张**带分隔行**的合法小表，行里写一枚不在三档里的状态 ⇒ 整份文档必须仍然绿
const s8 = insertAfterRegion(
  '\n下面这张表与本判据无关，只用来确认"带分隔行的表不会被当成孤儿"：\n\n| 编号 | 处置 |\n|---|---|\n| W13 | ⏸ 暂缓 | x |\n',
);
check(
  'S8 带分隔行的表（状态措辞在三档之外）→ 不算孤儿，整份仍绿',
  s8.rc === 0 && legCount(s8.out, LEGS.orphan) === 0,
  `RC=${s8.rc}｜孤儿腿 ${legCount(s8.out, LEGS.orphan)} 条`,
);

// S9：同一张表**去掉分隔行** ⇒ 同一枚行必须当场变成孤儿（这条臂证明腿 5 读的是分隔行，不是状态词）
const s9 = insertAfterRegion(
  '\n下面这张表与本判据无关，只用来确认"带分隔行的表不会被当成孤儿"：\n\n| 编号 | 处置 |\n| W13 | ⏸ 暂缓 | x |\n',
);
expectRed('S9 同一行、少了分隔行 → 必须点名', s9, LEGS.orphan, 'W13', (n) => n === 1);

// S10：合流时对面那份旧抄件的形状 —— 表外一段两行，一行状态合规、一行**不合规** ⇒ 两行都要点名
const s10 = insertAfterRegion(
  '\n（这一段是对面那棵树里修表之前的旧抄件拼回来的）\n\n| W14 | 🔄 进行中 | y |\n| W15 | ⏸ 不在本篇开工 | z |\n',
);
expectRed(
  'S10 表外一段里，状态不合规的那枚不许漏网',
  s10,
  LEGS.orphan,
  'W15',
  (n) => n === 2 && s10.out.includes('| W14'),
);

// N1 / N2 / N3：腿 6（已开工的行必须记到变异那一层）。靶**现选**：挑第一枚提到变异/臂的行，
// 把那两个词换成同义的"改动/档"——其余字节不动，所以别的腿不会被牵连（expectRed 会把别的腿的数打出来核对）。
let mutId = '';
const stripMut = (t, tail = '') => {
  const lines = t.split('\n');
  const idx = lines.findIndex((l) => /^\|\s*W[0-9]+[a-z]?/.test(l) && /变异|臂/.test(l));
  if (idx === -1) throw new Error('N1 找不到提到变异/臂的行 —— 本表的记法变了，这三条臂没有靶');
  const before = lines[idx];
  const stripped = before.replace(/变异/g, '改动').replace(/臂/g, '档');
  // 🔴 断言写在**接 tail 之前**：豁免词自己就含"变异"两个字，先拼再查的话 N2/N3 那一行会因为
  // 尾巴里的"无变异面"而重新命中 needle —— 于是 N2 绿是绿了，绿的却是"这行提到变异"，
  // 豁免词那一档根本没被量到。（第一版就是这个形状，被这条断言当场拦下。）
  if (/变异|臂/.test(stripped)) throw new Error('N1 的换词没换干净（那一行还留着 needle）');
  // 尾巴要接在**闭合竖线之内**，不能接在行尾之后 —— 后者会把那一行变成"没有闭合竖线"，
  // 于是 N2/N3 的红/绿落在腿 1 上而不是腿 6 上（第一版就踩了：N2 报 RC=1、N3 报 unclosed:1）。
  const withTail = (row, tail) => (tail ? row.replace(/\|\s*$/, `${tail} |`) : row);
  lines[idx] = withTail(stripped, tail);
  mutId = before.match(/^\|\s*(W[0-9]+[a-z]?)/)[1];
  return lines.join('\n');
};
expectRed(
  'N1 把某一行的变异读数抹成同义词 → 必须点名',
  mutate((t) => stripMut(t)),
  LEGS.mut,
  mutId,
  (n) => n === 1,
);
// N2：同一行改成"豁免词 + 理由" ⇒ 必须绿（这条挡住"豁免词形同虚设"的反面：写了理由就该放过）
const n2 = mutate((t) => stripMut(t, ' 无变异面：这一单是纯文档登记，没有可失败的产品判据'));
check('N2 写了「无变异面：+理由」→ 放过', n2.rc === 0, `RC=${n2.rc}`);
// N3：只写光秃秃的豁免词、没理由 ⇒ 不许放过（这条是"空白通行证"的靶）
expectRed(
  'N3 只写「无变异面」不给理由 → 仍然红',
  mutate((t) => stripMut(t, ' 无变异面')),
  LEGS.mut,
  mutId,
  (n) => n === 1,
);

// N4 / N5：腿 4 的**触发词表**。旧版只认"截图"，而 §4 的原话是"必须截图且人看图"，
// 表里的合法写法有"八张图逐张看过""人已看图"好几种 —— 换措辞就等于把那格移出射程。
// 靶现选：挑第一枚"既写截图、又带图路径、还另有指图措辞（逐张/张图/看图）"的行。
let claimId = '';
const reword = (t, stripPaths) => {
  const lines = t.split('\n');
  const idx = lines.findIndex(
    (l) => /^\|\s*W[0-9]+[a-z]?/.test(l) && l.includes('截图') && /\.(?:png|jpg|jpeg|webp)/.test(l) && /逐张|张图|看图/.test(l),
  );
  if (idx === -1) throw new Error('N4 找不到"截图 + 图路径 + 另一种指图措辞"三件齐的行 —— 本表记法变了，这两条臂没有靶');
  let row = lines[idx].replace(/截图/g, '界面取证图');
  if (stripPaths) row = row.replace(/[^\s`|{},]*\.(?:png|jpg|jpeg|webp)/g, '一批界面图');
  if (row.includes('截图')) throw new Error('N4 的换词没换干净（那一行还留着"截图"）');
  if (!/逐张|张图|看图/.test(row)) throw new Error('N4 换词后那一行不再有任何指图措辞 —— 这一臂量不到触发词表');
  claimId = lines[idx].match(/^\|\s*(W[0-9]+[a-z]?)/)[1];
  lines[idx] = row;
  return lines.join('\n');
};
expectRed(
  'N4 换成"八张图逐张看过"却不给路径 → 仍须点名（触发词不许只认「截图」）',
  mutate((t) => reword(t, true)),
  LEGS.shot,
  claimId,
  (n) => n === 1,
);
// N5：同一行只是换了措辞、路径还在 ⇒ 必须绿（挡住"把射程扩到全部看图字样"造成的假红）
const n5 = mutate((t) => reword(t, false));
check('N5 换了措辞但带着图路径 → 放过', n5.rc === 0 && legCount(n5.out, LEGS.shot) === 0, `RC=${n5.rc}`);

// —— 腿 7（判据条数）与腿 8（臂条数 + 红集）的臂：J1…J5 + 一把脱牙。
// 这两条腿守的是目标第 4 点点名的两样读数，而它们各自的**失败形状相反**：
//   腿 7 会被"窗口放宽"退回**假绿**（W4 那格"三条恢复路径、持久化、判据"曾被当成有读数），
//   腿 8 会被"结果词收窄"退回**假红**（W3/W5/W8a 三格分别用「各红」「⇒ `ui` 红」「→红」三种措辞，
//   只收"全红"时三格全被误报成没记）。所以 J5 与 J3 一个是防松、一个是防紧，缺一条另一条就会漂回去。
const editRow = (t, id, fn) => {
  const ls = t.split('\n');
  const i = ls.findIndex((l) => l.startsWith(`| ${id} `));
  if (i === -1) throw new Error(`找不到「| ${id} 」那一行 —— 表被改过形状，本臂没有靶，拒绝猜。`);
  const next = fn(ls[i]);
  if (next === ls[i]) throw new Error(`对 ${id} 那行的变异没有生效（needle 与原文不同形）—— 臂是装饰，拒绝继续。`);
  ls[i] = next;
  return ls.join('\n');
};

const j1 = mutate((t) => editRow(t, 'W3', (l) => l.replace('**判据 2 条**', '**判据见下**')));
expectRed(
  'J1 剥掉某行的判据条数（保留"判据"二字）→ 腿 7 点名那一行',
  j1,
  LEGS.judge,
  'W3',
);

const j2 = mutate((t) => editRow(t, 'W6', (l) => l.replace('**判据 47 条，分六层**', '**分六层的 47 条判据**')));
check(
  'J2 把 `判据 N 条` 换成 `N 条判据`（另一种字序）→ 仍放过（两种词形都在射程里）',
  j2.rc === 0 && legCount(j2.out, LEGS.judge) === 0,
  `RC=${j2.rc} 腿7=${legCount(j2.out, LEGS.judge)}`,
);

const j3 = mutate((t) => editRow(t, 'W5', (l) => l.replace(/ 红/g, ' 失败')));
expectRed(
  'J3 把某一行的"⇒ 某层 红"全换成"⇒ 某层 失败"（臂条数还在）→ 腿 8 点名那一行（光有臂数不算红集）',
  j3,
  LEGS.arm,
  'W5',
);

const j4 = mutate((t) => editRow(t, 'W0', (l) => l.replace('`无变异面：没有自动判据可供变异`', '`无变异面`')));
check(
  'J4 豁免词写光秃秃的一个（不给理由）→ 腿 8 必须仍然红，而腿 6 放过（两档问的不是同一件事）',
  j4.rc === 1 && legCount(j4.out, LEGS.arm) >= 1 && legCount(j4.out, LEGS.mut) === 0,
  `RC=${j4.rc} 腿8=${legCount(j4.out, LEGS.arm)} 腿6=${legCount(j4.out, LEGS.mut)}｜` +
    '腿 6 判"这一格提没提到变异"，那一格提了；腿 8 判"有没有臂条数 + 红集"，光秃秃的豁免词给不出读数 ⇒ 只有腿 8 红才是对的。' +
    '第一版我把期望写成"两档都红"，那是**我自己猜的**，跑一趟才知道两档分工不同 —— 期望值写错与判据写错一样会误导下一位。',
);

const j5 = mutate((t) =>
  editRow(t, 'W3', (l) => l.replace('**判据 2 条**', '**判据**（口径见下） 。这一层另有 2 条别的账')),
);
check(
  'J5 把"判据"与"2 条"**拆到两个句子**里 → 腿 7 仍须点名 W3（这条钉的是"按句取语义"这个决定；写成字符窗口版就在这里假绿）',
  j5.rc === 1 && legCount(j5.out, LEGS.judge) >= 1 && j5.out.includes('W3'),
  `RC=${j5.rc} 腿7=${legCount(j5.out, LEGS.judge)}`,
);

// —— 腿 9（码段里的裸竖线）的臂：P1…P5e + 一把脱牙。
// 这一族的特殊之处是**旧判据一条都不会红**：行仍闭合、仍在表区间、状态与读数都没动，
// 只是 GFM 在渲染时把一格劈成两格。所以 P4 专门拿"还没有腿 9 的那版判据"跑同一份变异文档，
// 断它 **RC=0** —— 这条不是形式主义，它把"补这条腿"从"顺手加严"钉成"补一个实测存在的缺口"（减法现量）。
let pTarget = { line: 0, id: '' };
const injectPipe = (scope, escaped = false) =>
  mutate((t) => {
    const ls = t.split('\n');
    const headIdx = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
    // §8 区间：表头 + 分隔行往下连续以 `|` 开头的行
    const region = new Set();
    for (let i = headIdx + 2; i < ls.length; i += 1) {
      if (!ls[i].startsWith('|')) break;
      region.add(i);
    }
    const idx = ls.findIndex(
      (l, i) => /^\|.*\|\s*$/.test(l) && /`[^`]+`/.test(l) && (scope === 'out' ? !region.has(i) : i >= headIdx),
    );
    if (idx === -1) throw new Error(`P（${scope}）找不到带 code span 的表格行 —— 本文件的表形态变了，这两条臂没有靶`);
    const row = ls[idx];
    const span = row.match(/`[^`]+`/)[0];
    pTarget = { line: idx + 1, id: row.match(/^\|\s*(W[0-9]+[a-z]?)/)?.[1] ?? '' };
    ls[idx] = row.replace(span, `${span.slice(0, -1)}${escaped ? '\\|' : '|'}a\``);
    if (ls[idx] === row) throw new Error('注入没有生效（码段形状对不上原文）—— 臂是装饰，拒绝继续。');
    return ls.join('\n');
  });

const p1 = injectPipe('in');
expectRed(
  'P1 §8 表里某一格的 code span 注入裸竖线 → 只有腿 9 红（行闭合/状态/读数那八条全放过）',
  p1,
  LEGS.pipe,
  pTarget.id || `:${pTarget.line}`,
  (n) => n === 1,
);

// P2：同一处把竖线写成 GFM 要求的转义式 → 必须放过（这条挡住"为了绿而删竖线"的修法）
const p2 = injectPipe('in', true);
check(
  'P2 同一格写成转义式 `\\|` → 放过（判的是裸竖线，不是"码段里不许有竖线"）',
  p2.rc === 0 && legCount(p2.out, LEGS.pipe) === 0,
  `RC=${p2.rc} 腿9=${legCount(p2.out, LEGS.pipe)}｜靶 ${pTarget.id}@${pTarget.line}`,
);

// P3：靶换到 §8 **区间之外**的另一张表 → 同样必须点名（这条钉住"射程=整份文档的表行"这个决定；
// 只扫 §8 区间的话，本轮实际写坏的两处里有一处正好落在射程外）
const p3 = injectPipe('out');
expectRed(
  'P3 表外另一张表的码段注入裸竖线 → 也要点名（腿 9 射程覆盖整份文档的表格行）',
  p3,
  LEGS.pipe,
  `(非§8表) 码段`,
  (n) => n === 1 && !p3.out.includes(`:${pTarget.line} W`),
);

// P4：把 P1 同一份变异喂"还没有腿 9 的那版判据" ⇒ 必须 RC=0（减法现量）。
// 🔴 取那一版**不按 HEAD 取**：臂写出来时 HEAD 就是八腿版，而腿 9 一提交，`git show HEAD:` 立刻变成
// 九腿版 ⇒ 这条臂会在"补完的下一笔"上自己变红（19:5x 写下、20:1x 就红了一次，红的原因是历史前进了，
// 不是判据坏了）。改成**按内容找**：沿这个文件的提交往回走，取**最新的一版不含腿 9 标题**的，
// 找不到就响亮地抛 —— 不许退化成"拿当前版当旧版"。
{
  const oldGate = join(scratch, 'gate-before-leg9.mjs');
  const hist = execFileSync('git', ['-C', repoRoot, 'log', '--format=%H', '--', 'scripts/check-detail-pane-status-table.mjs'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 12);
  let found = '';
  for (const sha of hist) {
    const src = execFileSync('git', ['-C', repoRoot, 'show', `${sha}:scripts/check-detail-pane-status-table.mjs`], { encoding: 'utf8' });
    if (!src.includes(LEGS.pipe) && src.includes(LEGS.unclosed)) {
      found = sha;
      writeFileSync(oldGate, src, 'utf8');
      break;
    }
  }
  if (!found) throw new Error(`前 ${hist.length} 版里找不到"还没有腿 9"的那版判据 —— 窗口要放宽，但绝不许拿当前版冒充旧版。`);
  const ls = ORIGINAL.split('\n');
  const headIdx = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
  const idx = ls.findIndex((l, i) => i >= headIdx && /^\|.*\|\s*$/.test(l) && /`[^`]+`/.test(l));
  const span = ls[idx].match(/`[^`]+`/)[0];
  ls[idx] = ls[idx].replace(span, `${span.slice(0, -1)}|a\``);
  writeFileSync(doc, ls.join('\n'), 'utf8');
  const r = spawnSync(process.execPath, [oldGate, doc], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  writeFileSync(doc, ORIGINAL, 'utf8');
  check(
    'P4 同一份变异喂「还没有腿 9 的那版判据」→ RC=0（这条腿补的是实测存在的缺口，不是顺手加严）',
    r.status === 0 && /八项都成立/.test(out),
    `RC=${r.status}｜取的是 ${found.slice(0, 8)}（按内容认，不按 HEAD）`,
  );
}

// 脱牙对照：把两条新腿的命中集合清空，J1/J3/J5 三臂都必须失能（有一条仍红 = 它没挂在那条腿上）
const neuter = join(scratch, 'gate-neutered-78.mjs');
{
  const src = readFileSync(GATE, 'utf8');
  const ANCHOR = 'console.log(`取样：';
  if (!src.includes(ANCHOR)) throw new Error('判据里找不到"console.log(`取样："那一行，脱牙脚本没有插入点，拒绝猜。');
  writeFileSync(neuter, src.replace(ANCHOR, 'judgeMissing.length = 0; armMissing.length = 0;\n' + ANCHOR), 'utf8');
  const survived = [];
  for (const [name, mk] of [
    ['J1', () => editRow(ORIGINAL, 'W3', (l) => l.replace('**判据 2 条**', '**判据见下**'))],
    ['J3', () => editRow(ORIGINAL, 'W5', (l) => l.replace(/ 红/g, ' 失败'))],
    ['J5', () => editRow(ORIGINAL, 'W3', (l) => l.replace('**判据 2 条**', '**判据**（口径见下） 。这一层另有 2 条别的账'))],
  ]) {
    writeFileSync(doc, mk(), 'utf8');
    const r = spawnSync(process.execPath, [neuter, doc], { encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    if (legCount(out, LEGS.judge) > 0 || legCount(out, LEGS.arm) > 0) survived.push(name);
  }
  writeFileSync(doc, ORIGINAL, 'utf8');
  check('脱牙对照 摘掉腿 7/8 的命中集合后，J1/J3/J5 都不得仍然报出那两条腿（三臂全部失能）',
    survived.length === 0, survived.length ? `摘牙后仍红：${survived.join('/')}` : '三臂全部失能');
}

// P5 / P5e：**段首式**码段 —— 码段内容就是一个光秃秃的竖线（`` `|` ``）。
// 🔴 这一形是腿 9 第一版**自己放走过的两处真缺陷**：匹配式写成"竖线前面必须有一个非反斜杠字符"时，
// 段首的竖线没有前驱字符 ⇒ 读不到。是 main 那条共享门禁 `check:md-tables` 按**列数**照出来的
// （它在我这九条腿之外，过程账在工单 §8.87）。所以 P5 钉"能红"，P5e 钉转义式仍放过。
const addBarePipeSpan = (escaped) =>
  mutate((t) => {
    const ls = t.split('\n');
    const headIdx = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
    const idx = ls.findIndex((l, i) => i > headIdx + 1 && /^\|\s*W[0-9]+[a-z]?\b.*\|\s*$/.test(l));
    if (idx === -1) throw new Error('P5 找不到 §8 表的数据行 —— 表形态变了，这条臂没有靶');
    const row = ls[idx];
    ls[idx] = row.replace(/\|\s*$/, ` 这里演示一个码段整体就是一根竖线的写法 ${escaped ? '`\\|`' : '`|`'} |`);
    if (ls[idx] === row) throw new Error('P5 的注入没有生效 —— 臂是装饰，拒绝继续。');
    pTarget = { line: idx + 1, id: row.match(/^\|\s*(W[0-9]+[a-z]?)/)[1] };
    return ls.join('\n');
  });
const p5 = addBarePipeSpan(false);
expectRed(
  'P5 码段整体就是一根裸竖线（段首无前驱字符）→ 腿 9 必须点名（这条钉第一版漏掉的那一形）',
  p5,
  LEGS.pipe,
  pTarget.id,
  (n) => n === 1,
);
const p5e = addBarePipeSpan(true);
check(
  'P5e 同一形写成转义式 → 放过（P5 的红不是因为"码段里有竖线"）',
  p5e.rc === 0 && legCount(p5e.out, LEGS.pipe) === 0,
  `RC=${p5e.rc} 腿9=${legCount(p5e.out, LEGS.pipe)}`,
);

// 脱牙对照（腿 9）：摘掉 pipeRows 的命中集合，P1/P3 两臂都必须失能
{
  const neuter9 = join(scratch, 'gate-neutered-9.mjs');
  const src9 = readFileSync(GATE, 'utf8');
  const ANCHOR9 = 'console.log(`取样：';
  if (!src9.includes(ANCHOR9)) throw new Error('判据里找不到插入点，脱牙脚本拒绝猜。');
  writeFileSync(neuter9, src9.replace(ANCHOR9, 'pipeRows.length = 0;\n' + ANCHOR9), 'utf8');
  const survived = [];
  const mkP5 = () => {
    const ls = ORIGINAL.split('\n');
    const headIdx = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
    const idx = ls.findIndex((l, i) => i > headIdx + 1 && /^\|\s*W[0-9]+[a-z]?\b.*\|\s*$/.test(l));
    ls[idx] = ls[idx].replace(/\|\s*$/, ' 这里演示一个码段整体就是一根竖线的写法 `|` |');
    return ls.join('\n');
  };
  const mkRegion = (kind) => {
    const ls = ORIGINAL.split('\n');
    const headIdx = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
    const region = new Set();
    for (let i = headIdx + 2; i < ls.length; i += 1) {
      if (!ls[i].startsWith('|')) break;
      region.add(i);
    }
    const idx = ls.findIndex(
      (l, i) => /^\|.*\|\s*$/.test(l) && /`[^`]+`/.test(l) && (kind === 'out' ? !region.has(i) : i >= headIdx),
    );
    const span = ls[idx].match(/`[^`]+`/)[0];
    ls[idx] = ls[idx].replace(span, `${span.slice(0, -1)}|a\``);
    return ls.join('\n');
  };
  for (const [kind, mk] of [['in', () => mkRegion('in')], ['out', () => mkRegion('out')], ['p5', mkP5]]) {
    writeFileSync(doc, mk(), 'utf8');
    const r = spawnSync(process.execPath, [neuter9, doc], { encoding: 'utf8' });
    if (legCount(`${r.stdout}${r.stderr}`, LEGS.pipe) > 0) survived.push(kind);
  }
  writeFileSync(doc, ORIGINAL, 'utf8');
  check(
    '脱牙对照 摘掉腿 9 的命中集合后，P1/P3/P5 三臂都不得仍然报出那一档（三臂全部失能）',
    survived.length === 0,
    survived.length ? `摘牙后仍红：${survived.join('/')}` : '三臂全部失能',
  );
}

const control = run();
check('对照 恢复干净后全绿', control.rc === 0, `RC=${control.rc}`);

rmSync(scratch, { recursive: true, force: true });
console.log(`\n读数：判据 ${GATE.split('/').pop()}｜基线连续 ${baseRows} 枚工单行`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log(`\n结论：${notes.length}/${notes.length + fail.length} 臂符合预期（各臂构成见文件头那张表，条数不在这里抄 —— 抄了就一定会漂）✅`);
