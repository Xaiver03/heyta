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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

// `--root DIR`：把"仓库"换成一棵**物化出来的树**（合流预检用 `git archive` 把候选树/基线树解到 /tmp，
// 那种目录没有索引，`git ls-files` 在那里读出来的是空集 ⇒ 会被当成"所有引用都没入库"整片假红）。
// 产物树里"存在"就等于"在那棵树里被跟踪"（archive 只放树内文件），所以集合改成目录遍历，
// 并把档位**打在输出里**，不假装还在 git 模式。
const rootArgIdx = process.argv.indexOf('--root');
const rootArg = rootArgIdx === -1 ? undefined : process.argv[rootArgIdx + 1];
const TREE_MODE = rootArg !== undefined;
const root = TREE_MODE ? rootArg : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const IMG_EXT = /\.(?:png|jpg|jpeg|webp)$/;
const PRUNE = new Set(['node_modules', '.git', 'dist', 'test-results']);
const walk = (dir, acc) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || PRUNE.has(e.name)) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(abs, acc);
    else if (IMG_EXT.test(e.name)) acc.push(relative(root, abs));
  }
  return acc;
};

const DEFAULT_DOCS = [
  'docs/plans/detail-pane-alignment.md',
  'docs/research/detail-pane-alignment-and-spaced-review.md',
];
const positional = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === '--root') {
    i += 1; // 它的实参不是文档
    continue;
  }
  if (!a.startsWith('--')) positional.push(a);
}
const targets = (positional.length ? positional : DEFAULT_DOCS).map((d) => (d.startsWith('/') ? d : join(root, d)));

let tracked;
/**
 * 声明在这里、**求值在 `tracked` 填好之后**（它是一个惰性 getter，不是常量）：
 * 定义处若直接算，`tracked` 还是 `undefined` ⇒ 崩在守卫上而不是查到红。
 * ⚠️ 这正是本文件反复记的那类形状："工具能力/求值时机要实测，别按习惯猜"。
 */
let onDiskOnly = new Set();
if (TREE_MODE) {
  tracked = walk(root, []);
} else {
  const git = (args) =>
    // 🔴 `execFileSync` 的默认 `maxBuffer` 是 1MB（本仓全量输出超它，会被**静默截断**）；
    // 🔴 更要命的是 git 默认 `core.quotePath=true`：含非 ASCII 的路径被输出成 `"apps/web/evidence/中文.png"`
    // 这种带引号的转义形状 ⇒ 既不匹配 `.png$`，也永远匹配不上文档里的引用。
    // 16:2x 实测：同一棵树，全量解析只拿到 222 枚图片，而目录遍历/`git archive` 里是 **250** 枚 ——
    // 少的正是那 28 枚非 ASCII 名字的证据文件。集合漏收不会报错，它只会让"歧义判定"和"没入库判定"双双失灵。
    // ⇒ 一律用 `-z`（NUL 分隔、原始字节、不转义），并显式抬高 maxBuffer。
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  let trackedRaw;
  try {
    trackedRaw = git(['ls-files', '-z']).replace(/\0$/, '');
  } catch (error) {
    console.log(
      '🔴 拿不到 `git ls-files` —— 「本机有、仓库里没有」这一半判据无法执行，拒绝给出"通过"的结论。\n' +
        `   git 报的是：${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const listed = trackedRaw.split('\0').filter(Boolean);
  // 两种模式的集合都必须是**同一个宇宙**（只有图片），否则简写的歧义判定会随模式漂移。
  tracked = listed.filter((p) => IMG_EXT.test(p));
  /**
   * 🔴 **2026-11-10：证据不再入库之后的载体变更**（F-11）。
   *
   * `e760da75`（2026-11-09）把 824 MB / 6678 个验收截图**取消跟踪**
   *（理由：gitee 1024 MB 上限被撑爆、每轮重拍产生看不懂的二进制 diff）。
   * 那笔提交自己写了代价：「**门禁若依赖这些目录，在干净克隆上会读不到**」——
   * 本脚本正是那条门禁，于是它从那天起恒红：**116 条引用「成立 0 个」**。
   *
   * `.gitignore` 把处置方式也写死了（那几个 glob 上面那句）：
   * 「真出现那种红，**改的是那条判据的载体**，不是把它加回本文件的例外。」
   *
   * ⇒ 按那句话改**载体**，判据本身一条没放宽：
   *
   *   1. `tracked`（git 索引）仍是判据的主集合 —— 一字不动；
   *   2. 另外把**盘上存在、但未被跟踪**的图片收进 `onDiskOnly`。
   *      对"落位"这一问，它算成立；但**逐条打印**出来（`本机有、未入库`），
   *      不许悄悄混进"通过"；
   *   3. **不声称更强的东西**：这些引用在**干净克隆上依然不成立**（集合里没有它们），
   *      所以脚本按"是否存在 onDiskOnly"给出**分档结论**，而不是笼统的绿 ——
   *      结论里明写"要在干净检出上判它们，得先把证据放到别处承载
   *      （单独仓 / CI artifact）"，那是另一件事，不是本条判据能解决的。
   *
   * 为什么不是"未入库就放过"：那等于删掉"本机有、仓库没"这一整类判据 ——
   * 而那一类正是原作者刻意加的（见文件头与下面 `tracked.length === 0` 那条守卫）。
   */
  // 完整性守卫（16:2x 那两个假读数——2827 条"图片"、222 枚集合——都是没有这道守卫时才活得下去的）：
  // ⚠️ 第一版这里写的是 `git ls-files --count`，**本机 git 没有这个选项**（直接 unknown option 退 129），
  // 症状是判据崩在守卫上而不是查到红。工具能力要实测，别按别的 CLI 的习惯猜。
  // 改成对本判据真正依赖的那一片做独立计数：证据族目录。
  const scoped = git(['ls-files', '-z', '--', 'apps/web/evidence']).replace(/\0$/, '');
  const scopedCount = scoped.split('\0').filter(Boolean).length;
  const parsedScoped = listed.filter((p) => p.startsWith('apps/web/evidence/')).length;
  if (scopedCount !== parsedScoped) {
    console.log(
      `🔴 集合不完整：单独问 apps/web/evidence/ 得到 ${scopedCount} 条，全量解析后只剩 ${parsedScoped} 条` +
        ` ⇒ 全量那份集合漏收（历史上两种成因都出现过：maxBuffer 截断、非 ASCII 路径被引号转义）。` +
        '本次读数无效（拒绝报绿）。',
    );
    process.exit(1);
  }
}
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
// 🔴 字符类不能列 ASCII 白名单：本仓有 **28 枚**证据文件名带中文（`apps/web/evidence/row-tail-fold/01-通道-hover-展开态.png` 那一族），
// 早先那版 `[A-Za-z0-9_.…/-]` 把它们整条看不见 ⇒ 引用它们时判据读成"引用 0 条"（A7 臂就是为这个而留的）。
// 改成"排除空白 / 反引号 / 竖线 / 花括号 / 逗号"的反向字符类：非 ASCII 自动进集合，逗号仍只在组内允许。
const TOKEN = /[^\s`|{},]*\{?[^\s`|{}]*\}?[^\s`|{},]*\.(?:png|jpg|jpeg|webp)/g;
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

/**
 * 「盘上在、但未入库」的证据（惰性求值，见上面 `let onDiskOnly` 的说明）。
 * 只认**证据目录**下的：别的地方"未入库"仍然该红（那是真的没提交）。
 */
onDiskOnly = new Set(
  walk(root, []).filter(
    (p) => IMG_EXT.test(p) && !tracked.includes(p) && /(?:^|\/)evidence\//.test(p),
  ),
);

const rows = [];
/**
 * 「盘上在、但未入库」的命中（2026-11-10，见文件头「证据不再入库之后的载体变更」）。
 * 单独收一份是为了**逐条打印**：它们算落位成立，但**在干净克隆上不成立** ——
 * 不许它们悄悄混进"通过"。
 */
const onDiskOnlyHits = [];
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
          const isTracked = trackedSet.has(ref);
          /**
           * `bad` 的口径：**落位**由"盘上在"决定，"入库"由 `isTracked` 决定。
           * 未入库但盘上在 ⇒ **不算 bad**，但会进 `onDiskOnlyHits` 逐条打印
           *（见文件头「2026-11-10：证据不再入库之后的载体变更」）。
           */
          const isOnDiskOnly = onDisk && !isTracked && onDiskOnly.has(ref);
          if (isOnDiskOnly) onDiskOnlyHits.push({ doc: relDoc, line: lineNo, ref });
          rows.push({
            doc: relDoc,
            line: lineNo,
            ref,
            kind: 'full',
            onDisk,
            isTracked,
            bad: !onDisk || (!isTracked && !isOnDiskOnly),
          });
        } else {
          const base = ref.split('/').pop();
          // 🔴 先按「族/文件名」这种带目录的简写配，配不到才退到纯文件名：顺序反过来，
          // 一个简写会被解析到**另一族的同名文件**上 —— 那比悬空引用更坏，它看起来是绿的。
          // ⚠️ 2026-11-10：候选池 = 入库的 ∪ 盘上未入库的证据（见文件头那段）。
          const pool = [...tracked, ...onDiskOnly];
          const byPath = pool.filter((p) => p === ref || p.endsWith(`/${ref}`));
          const byBase = byPath.length === 0 ? pool.filter((p) => p.split('/').pop() === base) : [];
          const cands = byPath.length > 0 ? byPath : byBase;
          const only = cands.length === 1 ? cands[0] : undefined;
          const resolvedTracked = only !== undefined && trackedSet.has(only);
          if (only !== undefined && !resolvedTracked) {
            onDiskOnlyHits.push({ doc: relDoc, line: lineNo, ref, resolved: only });
          }
          rows.push({
            doc: relDoc,
            line: lineNo,
            ref,
            kind: 'short',
            onDisk: only !== undefined && existsSync(join(root, only)),
            // ⚠️ 2026-11-10：`isTracked` 此前等于"解析到了"（`only !== undefined`），
            // 那是**两个不同的问**被写成了一个。现在它真的问"它在不在 git 索引里"。
            isTracked: resolvedTracked,
            resolved: only,
            // 0 个 = 悬空引用；>1 个 = 简写撞在同名文件上，读的人不知道是哪一张。
            // 解析到但**未入库**不算 bad（逐条打印，见文件头），解析不到才算。
            bad: only === undefined,
            candidates: cands,
          });
        }
      }
    }
  }
}

const missing = rows.filter((r) => r.kind === 'full' && !r.onDisk);
// ⚠️ 2026-11-10：`untracked` 现在要排除"已按新载体认下的证据"，
// 否则同一件事会既进 `onDiskOnlyHits`（新类，算过）又进 `untracked`（红）—— 自相矛盾。
const untracked = rows.filter(
  (r) => r.kind === 'full' && r.onDisk && !r.isTracked && r.bad,
);
const unresolved = rows.filter((r) => r.kind === 'short' && r.bad);

const rel = (f) => (f.startsWith(root + '/') ? f.slice(root.length + 1) : f);
console.log(
  `集合来源：${TREE_MODE ? '目录遍历（`--root` 产物树模式：树里没有 git 索引，"在这棵树里存在"即等价于被跟踪 —— 产物由 git archive 解出，只放树内文件）' : 'git 索引（`ls-files`：能抓住"本机有、库里没"那一半）'}，图片文件 ${tracked.length} 枚`,
);
if (tracked.length === 0) {
  console.log('🔴 图片文件集合为 0 —— 遍历/索引其中一边坏了，"全部落位"在这种集合上是**永真**的，拒绝报绿。');
}
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

// 🔴 空集合必须**计进红**：只在输出里印一句"集合为 0"而不改变退出码，等于又造一条永远通过的判据
// （元规则二那种病——本仓为同样的事修过一轮）。
const bad =
  missing.length +
  untracked.length +
  unresolved.length +
  malformed.length +
  (expanded === 0 ? 1 : 0) +
  (tracked.length === 0 ? 1 : 0);
if (onDiskOnlyHits.length > 0) {
  printList(
    `⚠️ 落位成立、但**未入库**（本机有、干净克隆上没有）—— ${onDiskOnlyHits.length} 条`,
    onDiskOnlyHits,
    (r) => `  ${r.doc}:${r.line}  ${r.ref}${r.resolved === undefined ? '' : ` → ${r.resolved}`}`,
  );
  console.log(
    '\n   📌 这些引用在**干净检出 / CI 上依然不成立**（git 索引里没有它们）。\n' +
      '      2026-11-09 `e760da75` 起 `apps/*/evidence/` 等 10 个目录**不再入库**\n' +
      '（824 MB / 6678 文件撑爆 gitee 配额），本判据因此按 `.gitignore` 写明的处置方式\n' +
      '（「改的是那条判据的载体」）把**盘上也认作落位** —— 但**不声称它们进了库**。\n' +
      '      要它们在干净检出上成立，得先把证据换个地方承载（单独仓 / CI artifact），\n' +
      '      那是另一件事，不是本条判据能解决的。',
  );
}
/**
 * 🔴 结论句必须**说实话**（2026-11-10）。
 * 改版前它是「每条引用都落在一枚**被仓库跟踪的**文件上」——
 * 在上面的 `onDiskOnlyHits` 存在时，那句话**是假的**：那些文件并没有被跟踪。
 * ⇒ 分档措辞：有未入库项时不再说"被仓库跟踪的"。
 */
const allTracked = onDiskOnlyHits.length === 0;
console.log(
  `\n结论：${
    bad === 0
      ? allTracked
        ? `本线文档每条截图引用都落在一枚${TREE_MODE ? '合并产物树里的' : '被仓库跟踪的'}文件上 ✅`
        : `本线文档每条截图引用都**落位**了 ✅（其中 ${onDiskOnlyHits.length} 条只在**本机**，见上：` +
          '它们在干净检出上不成立，因为证据自 2026-11-09 起不再入库）'
      : `🔴 ${bad} 处不成立`
  }`,
);
process.exit(bad === 0 ? 0 : 1);
