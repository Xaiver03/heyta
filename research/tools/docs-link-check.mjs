#!/usr/bin/env node
/**
 * 检查仓库内 Markdown 文档的相对链接是否有死链。
 *
 * 为什么需要它：文档一旦开始按目录分层，相对路径就会随文件移动而失效，
 * 而且失效是**静默**的 —— 没人点进去就不会发现。这个工具把它变成可验证的。
 *
 * 用法：
 *   node research/tools/docs-link-check.mjs           # 检查，死链则退出码 1
 *   node research/tools/docs-link-check.mjs --verbose  # 列出所有检查过的链接
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 不扫描的目录。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.pnpm-store', 'dist', 'build', 'coverage',
  // CocoaPods 装下来的第三方源码。里面的 README 是**上游的**，
  // 它的死链我们既不该修也修不了 —— 实测 `ios/Pods/RCT-Folly/README.md`
  // 就有 2 个指向 folly/docs 的死链，而这个检查器会把它算成我们的问题。
  'Pods',
  // Android / Gradle 的原生产物目录。
  '.gradle', '.cxx',
  // 并行模块的 worktree（`.worktrees/<模块>`）。
  //
  // 🔴 它们是**同一份仓库的另外几个工作副本**，不是本检出的内容。
  // 本检查器从仓库根递归，会走进去 —— 实测：在 `.worktrees/ai-m1` 里放一个
  // 死链，主检出的 `check:docs` 立刻变红（exit 1）。那意味着"另一个模块的
  // 半成品文档"能把主检出卡住，而这正是并行开工要消除的相互等待。
  // 修在扫描面这一侧（而不是靠每个人"注意别留半成品"），因为前者是机器保证的。
  '.worktrees',
]);

/** 上游克隆与第三方资料不归我们维护，检查它们的死链没有意义。 */
const SKIP_PATHS = ['research/upstream', 'research/standalone', 'research/parts'];

const verbose = process.argv.includes('--verbose');

/** 递归收集 .md 文件。 */
function collect(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

// [text](target) 或 [text](<target>)；不含图片与引用式链接。
const LINK_RE = /\[[^\]]*\]\(\s*<?([^)>\s]+)>?\s*\)/g;

/**
 * 把围栏代码块与行内代码整体挖空（替换成同长度的空格，以保住行号）。
 *
 * 为什么必须这样做：文档里经常**故意展示**链接写法作为示例 ——
 * 比如「❌ 不要写 [架构](docs/reference/architecture.md)」或 ADR 模板里的
 * [ADR-0002](0002-xxx.md)。这些不是真链接，把它们报成死链是误报，
 * 而误报会让人开始忽略这个检查 —— 那比没有检查更糟。
 */
function blankOutCode(line) {
  let out = line;
  // 行内代码：先处理双反引号（可包含单个反引号），再处理单反引号
  out = out.replace(/``[\s\S]*?``/g, (m) => ' '.repeat(m.length));
  out = out.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
  return out;
}

/** 外部链接、锚点、非文件协议一律跳过。 */
const isExternal = (t) =>
  /^(https?:|mailto:|tel:|data:|ftp:)/i.test(t) || t.startsWith('#');

const files = collect(ROOT);

/**
 * 「basename -> 全部同名文件」索引，用来解析**唯一 basename** 写法。
 *
 * 文档里常写「见 `deployment.md` §3.7.1」而不是全路径 —— 这是人话，
 * 不该因为门禁只认路径就被**静默跳过**（旧实现正是如此：解析不到就 `continue`，
 * 于是这些引用里的章节号从来没被检查过，而门禁是绿的）。
 * 唯一时认它；**有歧义就当作解析失败报出来**，不猜。
 */
const filesByBasename = new Map();
for (const f of files) {
  const base = basename(f);
  const list = filesByBasename.get(base);
  if (list === undefined) filesByBasename.set(base, [f]);
  else list.push(f);
}
const broken = [];
let checked = 0;
let skipped = 0;

for (const file of files) {
  const dir = dirname(file);
  const content = readFileSync(file, 'utf8');
  // 逐行扫，以便报行号
  let inFence = false;
  content.split('\n').forEach((rawLine, i) => {
    // 围栏代码块：进入/退出都要判断；块内整行跳过
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const line = blankOutCode(rawLine);
    for (const m of line.matchAll(LINK_RE)) {
      const raw = m[1];
      if (isExternal(raw)) continue;
      // 去掉 #anchor 与 ?query
      const target = raw.split('#')[0].split('?')[0];
      if (!target) continue; // 纯锚点
      // 跳过模板/占位
      if (target.includes('<') || target.includes('{{') || target.includes('xxx')) continue;

      checked++;
      const resolved = resolve(dir, decodeURIComponent(target));
      if (existsSync(resolved)) {
        if (verbose) console.log(`  ok   ${relative(ROOT, file)}:${i + 1} -> ${raw}`);
      } else {
        broken.push({ file: relative(ROOT, file), line: i + 1, target: raw });
      }
    }
  });
}


// ── 章节号引用检查 ──────────────────────────────────────────────
//
// 为什么需要它：`CLAUDE.md` 里写着「跑测试 → AGENTS.md §5」，而实际是 §6 ——
// **整体错位了一格**（AGENTS.md 中途插入了 §5 设计系统）。死链检查抓不到它，
// 因为链接本身是活的、文件存在、只有 **§ 后面的数字**错了。
// 而 CLAUDE.md 自己就写着「漂移的规则比没有规则更危险」。
//
// 只检查**指名了目标文件**的引用（`AGENTS.md §5`）。裸 `§5` 不做跨文件推断，
// 因为那只能靠猜 —— 猜错就是误报，而误报会让人开始忽略这个检查。

/**
 * `[`AGENTS.md` §5](...)` / `见 AGENTS.md §3.1–3.2` 这类引用。
 *
 * 🔴 编号必须是 `\d+(?:\.\d+)*`（**任意层级**），不能是 `\d+(?:\.\d+)?`（只两级）。
 * 后者把 `§3.3.1` 截成 `§3.3`，剩下的 `.1。改完必须…` 会被下面当成"引用者声称的标题"，
 * 于是报一条**假**的"标题对不上"。实测过：`AGENTS.md` 里写
 * `` `docs/runbooks/deployment.md` §3.3.1。改完必须 `nginx -t` `` 就被误报成
 * 「§3.3 的标题是『反向代理（宿主机 nginx）』，但引用写的是『.1。改完必须…』」——
 * 编号和标题**两个都是对的**，是解析器错了。
 */
const SECTION_REF_RE = /([A-Za-z0-9_./-]+\.md)`?\s*§\s*(\d+(?:\.\d+)*)/g;

/**
 * 引用后面跟的文本，是"引用者**声称的**章节标题"吗？是就返回它，否则返回 `null`。
 *
 * 为什么需要这个判断：`§7` 后面**紧跟正文**是最常见的写法 ——
 * 「见 AGENTS.md §7 第 74 条」「§3.3.1。改完必须 nginx -t」
 * 「§3.2 的「逐项登记」要求」——而 `§2 仓库地图` 后面才是真标题。
 * 旧实现把任何长度 ≥2 的后随文本都当标题比对，于是这些**散文**全被误报成
 * "标题对不上"。检查一旦开始喊狼来了，人就会把它关掉。
 *
 * 🔴 判据："**标题是短的、且不含句子标点**"。真标题几乎不会带
 * `。，、；：（）「」|#` 这类东西，也不会是「第 74 条」这种指代。
 * 冒号尤其要算：`§7 陷阱 #26（…` 与 `§3.2 的白名单内）。` 都含它。
 *
 * ⚠️ 这是**刻意保守**的：宁可漏查一个真标题，也不误报一条散文。
 * 漏查只是少一层保护；误报会让人不再相信门禁 —— 那比没有门禁更糟。
 */
function claimedTitle(rest) {
  const trimmed = rest.trim();
  if (trimmed === '') return null;

  // 指代写法（`§7 第 74 条`、`§7 #26`）是散文，不是标题。
  if (/^第\s*\d+\s*[条节章]/.test(trimmed)) return null;

  // 先去掉 markdown 的强调/删除线再判断：`**仓库地图**~~ →` 里的 `*`/`~` 是格式，
  // 不是标题内容。实测 `docs/plans/ai-capability-branches.md:1082` 就长这样，
  // 而它引用的 `§2 仓库地图` **本来是对的** —— 不该因为多了一对星号被报成错。
  const plain = trimmed.replace(/[*~]/g, '').trim();

  // 含句子标点 / 引用符号 = 散文。区间写法（`§3.1–3.2`）由调用方另行排除。
  // `→` 也算：`§2 仓库地图 → 搬走了` 是在记一次改动，不是在报标题。
  // `§` 也算：`§3.2`/`§3.6` 这种并列连写，后一个是另一个引用，不是前者的标题。
  // `—` 也算：`§6 —— 一次性支付的授予语义 +` 是行文，不是在报标题。
  if (/[。，、；：！？（）()「」『』【】《》|#→§—]/.test(plain)) return null;

  // 真标题是短的。`rest` 本身已被限到 24 字符，这里再收紧。
  const claimed = plain.replace(/^[\s，,、:：是]+/, '').replace(/[`\]]+$/, '').trim();
  if (claimed.length === 0 || claimed.length > 16) return null;
  return claimed;
}

/**
 * 把引用里写的目标解析成真实路径。
 *
 * 🔴 必须**两个基准都试**：先按引用文件所在目录（相对链接的常规语义），
 * 再按**仓库根**。旧实现只试前者，于是 `docs/plans/roadmap.md` 里写
 * `docs/runbooks/deployment.md` 会解析成 `docs/plans/docs/runbooks/deployment.md`
 * —— 不存在，然后 `continue` **静默跳过**。那条引用里的 `§3.3.1` 从来没被检查过，
 * 而它看起来"检查通过"了。**静默跳过比报错更糟：它给出的是虚假的安心。**
 *
 * 所以这里返回三态：解析到的路径，或 `null`（**确实找不到**）——
 * 后者要让调用方**报出来**，不能吞掉。
 */
function resolveTarget(fromDir, targetName) {
  for (const base of [fromDir, ROOT]) {
    const candidate = resolve(base, targetName);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // 唯一 basename 简写（`deployment.md`）也认 —— 文档里这么写是人话。
  // 但**只有唯一时才认**：重名就返回 null，让调用方如实报"解析不到"，
  // 而不是随便挑一个来查 —— 那会得出一个"看起来验过了"的假结论。
  if (!targetName.includes('/')) {
    const hits = filesByBasename.get(basename(targetName));
    if (hits !== undefined && hits.length === 1) return hits[0];
  }

  // 路径**后缀**唯一时也认：`docs/plans/multi-platform-adaptation.md` 里写
  // `` [`runbooks/desktop.md` §4.3](../runbooks/desktop.md) `` —— 链接 URL 是对的
  // （`../runbooks/` 相对本文件），但链接**文字**是从 `docs/` 起算的。
  // 两处都不是仓库根相对，旧实现直接静默跳过。后缀唯一 ⇒ 解析，歧义 ⇒ 返回 null。
  const suffix = `/${targetName}`;
  const suffixHits = files.filter((f) => f.endsWith(suffix));
  if (suffixHits.length === 1) return suffixHits[0];

  return null;
}

/**
 * 从一个 Markdown 文本里抽出「编号 -> 标题」的映射（## 1. / ### 2.3 / #### 3.1.2）。
 *
 * 标题也要，因为**「§5 存在」不代表「§5 是对的那一节」**：
 * 我们真的踩过这个坑 —— CLAUDE.md 把「跑测试」指向了 §5，而 §5 是设计系统，
 * 正确的 §6 只是被整体挤后了一格。只查编号是否存在**抓不到这种错**，
 * 编号是对的、只是意思是错的。带上标题才查得动。
 */
function sectionNumbers(markdown) {
  const map = new Map();
  let inFence = false;
  for (const rawLine of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{2,6}\s+(\d+(?:\.\d+)*)[.、\s]+(.*)$/.exec(rawLine);
    if (m) {
      map.set(m[1], m[2].replace(/[*`]/g, '').trim());
      continue;
    }

    // 🔴 有些文档用**表格行号**当编号。实测 `docs/research/feature-matrix.md` 是
    // 需求矩阵：`| 1.2 | 子任务（树形，可折叠） | P0 |` —— 那里**没有** `## 1.2` 标题。
    // 别人引用它当然会写 `§1.2`（他指的是那一行）。只认标题的旧实现会把它判成
    // "章节号不存在"，而这条引用**本来就是对的** —— 误报。
    // 表格行的"标题"取第 2 列，正好是那一行的名字。
    const row = /^\|\s*(\d+(?:\.\d+)*)\s*\|\s*([^|]*)\|/.exec(rawLine);
    if (row && !map.has(row[1])) {
      map.set(row[1], row[2].replace(/[*`]/g, '').trim());
    }
  }
  return map;
}

// ── 自检：这个检查器自己的解析逻辑 ──────────────────────────────
//
// 🔴 门禁自己也得能被验证。这一节是有来历的：本文件曾经**同时**带着两个缺陷 ——
// `SECTION_REF_RE` 只认两级章节号，以及目标路径只按"引用文件所在目录"解析。
// 它们**互相掩护**：后者把前者会误报的那些引用全部**静默跳过**，
// 于是 `check:docs` 一路绿灯，而实际只检查了 54 处引用
// （修好之后是 244 处 —— 也就是说 **78% 的章节引用从来没被检查过**）。
// 只修其中任何一个，另一个都会立刻把门禁变成一片误报。
// 没有自检，这两个缺陷可以共存到天荒地老，而且**永远不会有测试变红**。
//
// 所以下面每条断言都钉一个**真的踩过**的形状，来源写在注释里。
// 自检失败 ⇒ 直接 exit 1：门禁坏了就不该给出"通过"的结论。
function assertSelfTest() {
  const problems = [];
  const eq = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) problems.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
  };
  const refNumOf = (line) => [...line.matchAll(SECTION_REF_RE)][0]?.[2];

  // (1) 三级章节号必须**整体**解析。
  //     来源：`AGENTS.md` 里 `` `docs/runbooks/deployment.md` §3.3.1。改完必须 `nginx -t` ``。
  //     旧正则吃成 `§3.3`，尾巴 `.1。改完必须…` 再被当成"声称的标题" → 误报。
  eq('§3.3.1 必须整体解析', refNumOf('见 `x.md` §3.3.1。改完必须 nginx -t'), '3.3.1');
  eq('§3.3 仍然正常', refNumOf('见 `x.md` §3.3 反向代理'), '3.3');

  // (2) 后随文本的"散文 / 标题"判别。全都是实测报过错误报的形状。
  eq('【散文】句号续写不当标题', claimedTitle('。改完必须 nginx -t'), null);
  eq('【散文】`第 74 条` 是指代', claimedTitle(' 第 74 条。'), null);
  eq('【散文】markdown 删除线不是标题', claimedTitle(' 仓库地图**~~ →'), null);
  eq('【散文】并列引用 `§3.2`/`§3.6`', claimedTitle('/§3.6'), null);
  eq('【标题】`§2 仓库地图` 要认出来', claimedTitle(' 仓库地图'), '仓库地图');
  eq('【标题】带括号补充的标题', claimedTitle(' 硬性约束'), '硬性约束');

  // (3) 目标路径必须**仓库根**也能解析。
  //     来源：`docs/plans/roadmap.md` 里写 `docs/runbooks/deployment.md` ——
  //     旧实现解析成 `docs/plans/docs/...`，不存在，然后静默 `continue`。
  const plansDir = join(ROOT, 'docs', 'plans');
  eq(
    '仓库根相对路径要能解析',
    resolveTarget(plansDir, 'docs/runbooks/deployment.md'),
    join(ROOT, 'docs', 'runbooks', 'deployment.md'),
  );
  //     唯一 basename 简写（`deployment.md §3.7.1`）也要认 —— 文档里就这么写。
  //
  //     ⚠️ 下面两条**依赖仓库里没有同名文件**：新增第二个 `deployment.md`
  //     （或第二个 `runbooks/desktop.md`）会让解析**真的变得有歧义**，
  //     于是这两条转红。那不是自检坏了，是解析行为变了 ——
  //     口径是"有歧义就不猜"，所以宁可报出来。先看括号里的提示再动代码。
  eq(
    '唯一 basename 简写要能解析（新增同名文件会合法地让这条红）',
    resolveTarget(plansDir, 'deployment.md'),
    join(ROOT, 'docs', 'runbooks', 'deployment.md'),
  );
  //     路径后缀唯一时也要认：`[`runbooks/desktop.md` §4.3](../runbooks/desktop.md)`。
  eq(
    '唯一路径后缀要能解析（新增同名文件会合法地让这条红）',
    resolveTarget(plansDir, 'runbooks/desktop.md'),
    join(ROOT, 'docs', 'runbooks', 'desktop.md'),
  );
  // (4) **解析不到必须返回 null**，调用方据此报错。
  //     旧实现把"解析不到"和"检查通过"变成同一件事 —— 这正是缺陷 (b) 的本质。
  eq('解析不到要返回 null（不能装作通过）', resolveTarget(plansDir, 'no-such-file-xyz.md'), null);

  // (5) 表格行号也算章节号。
  //     来源：`docs/research/feature-matrix.md` 是需求矩阵 `| 1.2 | 子任务（树形，可折叠） | P0 |`，
  //     那里**没有** `## 1.2` 标题，而 `§1.2` 这个引用是**对的**。
  const tbl = sectionNumbers('| 1.2 | 子任务（树形，可折叠） | P0 |\n');
  eq('表格行号要算章节号', tbl.get('1.2'), '子任务（树形，可折叠）');
  eq('标题仍然优先于表格行', sectionNumbers('## 1.2 真标题\n| 1.2 | 表里的 |\n').get('1.2'), '真标题');

  return problems;
}

const selfTestProblems = assertSelfTest();
if (selfTestProblems.length > 0) {
  console.log(`\n🔴 检查器**自检失败**（${String(selfTestProblems.length)} 条）—— 门禁本身坏了，先修它：\n`);
  for (const p of selfTestProblems) console.log(`   • ${p}`);
  console.log('');
  process.exit(1);
}

const badRefs = [];
let checkedRefs = 0;

for (const file of files) {
  const dir = dirname(file);
  const content = readFileSync(file, 'utf8');
  let inFence = false;
  content.split('\n').forEach((rawLine, i) => {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // 注意：这里用**原始行**，不能用 blankOutCode —— 反引号里的文件名
    // （`AGENTS.md` §5）会被挖成空格，文件名随之消失，于是什么都查不到。
    // 这个正则要求"文件名 + § + 数字"，足够具体，围栏代码块已在上面排除。
    // 🔴 后随文本要按「本匹配结束 → **下一个匹配开始**」切片，不能让正则自己
    // 贪心抓 24 个字符。旧写法 `([^\]\n]{0,24})` 会把**下一个引用**的开头一起吞掉，
    // 于是 `matchAll` 从半路继续，把 `` `docs/plans/roadmap.md` §3 `` 匹配成
    // `ns/roadmap.md` —— 目标文件都认错了，检查结果自然也是错的。
    const refs = [...rawLine.matchAll(SECTION_REF_RE)];
    for (let k = 0; k < refs.length; k++) {
      const m = refs[k];
      const targetName = m[1];
      const refNum = m[2];
      const tailStart = (m.index ?? 0) + m[0].length;
      const tailEnd = k + 1 < refs.length ? (refs[k + 1].index ?? rawLine.length) : rawLine.length;
      const restRaw = rawLine.slice(tailStart, Math.min(tailEnd, tailStart + 24));

      const targetPath = resolveTarget(dir, targetName);
      if (targetPath === null) {
        // 🔴 解析不到就**报出来**。旧实现在这里 `continue`，于是
        // `docs/plans/roadmap.md` 里那条仓库根相对路径**从来没被检查过**，
        // 而门禁是绿的 —— 那是虚假的安心。死链检查抓不到它，因为这类引用
        // 是散文里的 `AGENTS.md §5`，不是 Markdown 链接语法。
        badRefs.push({
          file: relative(ROOT, file),
          line: i + 1,
          target: targetName,
          ref: refNum,
          reason:
            '解析不到目标文件（既不在引用文件所在目录，也不在仓库根）—— ' +
            '路径写错了，或该用相对引用文件位置的路径',
        });
        continue;
      }

      const sections = sectionNumbers(readFileSync(targetPath, 'utf8'));
      checkedRefs++;

      let realTitle = sections.get(refNum);

      // `§3.1–3.2` 只抓到 3.1；只要 3.1 存在就算数（区间写法不展开）
      if (realTitle === undefined) {
        // 🔴 允许引用**父节**。实测：`research/local-first-e2ee-ai-2026-09.md` 的标题
        // 是 `## 2.1` / `## 2.2` / `## 2.3`，没有裸的 `## 2` —— 而别人写
        // 「见该文 §2」完全是人话。按"字面标题不存在"报错会制造一批误报。
        // 判据：有任何一个 `2.x` 存在 ⇒ `§2` 成立（此时没有真标题可比，跳过标题比对）。
        const hasChild = [...sections.keys()].some((key) => key.startsWith(`${refNum}.`));
        if (hasChild) continue;

        badRefs.push({
          file: relative(ROOT, file),
          line: i + 1,
          target: targetName,
          ref: refNum,
          reason: '该章节号不存在',
          available: [...sections.keys()].join(', '),
        });
        continue;
      }

      // 引用后面若跟了标题（`§2 仓库地图`），标题必须与真实标题对得上。
      // 只比较**前缀**：真实标题常带括号补充（`硬性约束（违反即打回）`），
      // 引用只写主干是合理的，不该报错。
      // 区间写法（`§3.1–3.2`、`§1-2`）不是标题，不参与比较，否则是误报。
      const rest = restRaw.trim();
      if (/^[–—~〜-]\s*\d/.test(rest)) continue;
      // 后随文本若是散文（标题不会长成那样）就不参与比对 —— 见 `claimedTitle`。
      const claimed = claimedTitle(rest);
      if (claimed === null || claimed.length < 2) continue;
      // 本节标题的前缀 ⇒ 引用是对的（真实标题常带括号补充）。
      if (realTitle.startsWith(claimed)) continue;

      // 🔴 只在「这段话**确实是目标文档里另一个章节的标题**」时才报错。
      //
      // 为什么必须卡得这么窄：`§N` 后面跟一截文字，既可能是**声称的标题**
      // （`§2 仓库地图`），也可能**只是正文**（`§7 第 74 条`、`§6.1 更新入口`、
      // `§1.2 把"子任务"列为 P0`）。这两者用标点、长度**都分不干净**。
      // 实测：把"看起来像标题"的一律拿去比对，在整个仓库里报出**一屏误报，
      // 而其中没有一条是真的** —— 误报会让人直接关掉门禁，比没有门禁更糟。
      //
      // 反过来，"这段文字是**别的**章节的标题"是个**强信号**，而且正是这个检查
      // 存在的理由：CLAUDE.md 曾把「跑测试」指向 §5，而 §5 是设计系统 ——
      // 编号存在、链接活着，只有"意思"错了。这种张冠李戴才报。
      const owner = [...sections.entries()].find(
        ([num, title]) => num !== refNum && title.startsWith(claimed),
      );
      if (owner !== undefined) {
        badRefs.push({
          file: relative(ROOT, file),
          line: i + 1,
          target: targetName,
          ref: refNum,
          reason:
            `章节号是 §${refNum}「${realTitle}」，但引用写的是「${claimed}」` +
            `—— 后者是 §${owner[0]}「${owner[1]}」的标题`,
        });
      }
    }
  });
}

// ── 页内锚点检查 ────────────────────────────────────────────────
//
// 为什么需要它（2026-09-27 实测发现的缺口）：上面两条都抓不到 `](#xxx)`。
// 死链检查把 `#` 之后的部分 `split` 掉了，`isExternal` 又把 `#` 开头的链接
// 整个跳过 —— 于是**页内锚点从来没被校验过**。
//
// 实测证据：故意把 finlaw-cleanup-candidates.md 的一个锚点改成
// `#14-这个锚点故意写错`，`check:docs` 依旧 `exit 0` 并报「无死链」。
// 而补上这个检查后一跑，真的找出 **11 处**解析不到的锚点（全是手写的）。
//
// 锚点算法必须与 GitHub 一致（文档主要在那里读）—— GitHub 用 github-slugger：
//   小写 → 删掉所有标点与符号（保留字母/数字/空格/`-`/`_`）→ 每个空格变 `-`
//
// 🔴 两个最容易手写错的地方：
//   1. **空格不合并**：`store —— 211` 里 `——` 被删掉后剩**两个**空格，
//      于是 slug 是 `store--211`，不是 `store-211`；
//   2. **`.` 和 `/` 是被删掉、不是变 `-`**：`~/heyta/.pnpm-store` →
//      `heytapnpm-store`（不是 `heyta-pnpm-store`）。
//   这两条正是上面那 11 处里绝大多数写错的原因。
function ghSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s\-_]/gu, '')
    .replace(/ /g, '-');
}

/** 一个文件里所有标题的锚点集合（含 GitHub 对同名标题加的 -1 / -2 后缀）。 */
function headingSlugs(markdown) {
  const out = new Set();
  const seen = new Map();
  let inFence = false;
  for (const rawLine of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(rawLine);
    if (!m) continue;
    const base = ghSlug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    // GitHub 里第二个同名标题的锚点是 `base-1`，第三个是 `base-2`……
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

const slugCache = new Map();
function slugsOf(path) {
  let s = slugCache.get(path);
  if (s === undefined) {
    s = headingSlugs(readFileSync(path, 'utf8'));
    slugCache.set(path, s);
  }
  return s;
}

const badAnchors = [];
let checkedAnchors = 0;

for (const file of files) {
  const dir = dirname(file);
  const content = readFileSync(file, 'utf8');
  let inFence = false;
  content.split('\n').forEach((rawLine, i) => {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // 与死链检查一样，先挖空行内代码 —— 文档里会**故意展示**锚点写法当例子。
    for (const m of blankOutCode(rawLine).matchAll(LINK_RE)) {
      const raw = m[1];
      const hashAt = raw.indexOf('#');
      if (hashAt === -1) continue;
      // 外链里的锚点由对方站点决定，这里管不着。
      if (/^(https?:|mailto:|tel:|data:|ftp:)/i.test(raw)) continue;

      const frag = decodeURIComponent(raw.slice(hashAt + 1));
      if (!frag) continue;
      // `#L12` 是行号锚点约定，不指向标题。
      if (/^L\d+/.test(frag)) continue;

      const rawPath = raw.slice(0, hashAt).split('?')[0];
      const targetFile =
        rawPath === '' ? file : resolve(dir, decodeURIComponent(rawPath));
      // 文件不存在由死链检查报；非 Markdown 的锚点是别的格式，不归这里管。
      if (!existsSync(targetFile) || !targetFile.endsWith('.md')) continue;

      checkedAnchors++;
      const slugs = slugsOf(targetFile);
      if (!slugs.has(frag)) {
        badAnchors.push({
          file: relative(ROOT, file),
          line: i + 1,
          target: rawPath === '' ? '(本文件)' : rawPath,
          frag,
          hint: [...slugs].find((s) => s.startsWith(frag.slice(0, 5))) ?? null,
        });
      }
    }
  });
}

console.log(`检查 ${checkedRefs} 处跨文档章节引用。`);
console.log(`检查 ${checkedAnchors} 处页内锚点。`);

const hasProblems = badRefs.length > 0 || badAnchors.length > 0 || broken.length > 0;

if (badRefs.length > 0) {
  console.log(`\n🔴 发现 ${badRefs.length} 处**失效的章节引用**（值是错的，但链接是活的）：\n`);
  for (const b of badRefs) {
    console.log(`   ${b.file}:${b.line}  ->  ${b.target} §${b.ref}`);
    console.log(`      ${b.reason}`);
    if (b.available) console.log(`      ${b.target} 实际有：§${b.available}`);
  }
  console.log('');
}

if (badAnchors.length > 0) {
  console.log(`\n🔴 发现 ${badAnchors.length} 处**解析不到的页内锚点**：\n`);
  for (const b of badAnchors) {
    console.log(`   ${b.file}:${b.line}  ->  ${b.target} #${b.frag}`);
    if (b.hint) console.log(`      你是不是想写：#${b.hint}`);
  }
  console.log(
    '\n   ⚠️ 锚点规则记牢两条：空格不合并（`a —— b` → `a--b`）、' +
      '`.`/`/` 是被删掉而不是变 `-`。\n',
  );
}

if (broken.length > 0) {
  console.log(`\n🔴 发现 ${broken.length} 个死链：\n`);
  for (const b of broken) {
    console.log(`   ${b.file}:${b.line}`);
    console.log(`      -> ${b.target}`);
  }
  console.log('');
}

if (hasProblems) process.exit(1);

console.log(`\n扫描 ${files.length} 个 Markdown 文件，检查 ${checked} 个相对链接。`);
console.log('\n✅ 无死链、无失效章节引用、无失效锚点。\n');
process.exit(0);

