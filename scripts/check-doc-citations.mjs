#!/usr/bin/env node
/**
 * 文档引用的两把尺子（性能热路径审计 §8 第 17 步 a/b 落成的自动检查）
 * ==================================================================
 *
 * ## 为什么要机器化，而不是写在文档注释里
 *
 * 这两条都是本轮**当场过期过**的形状：
 *
 * - **a) `git show HEAD:` 必须带锚**。这种取证只在那一刻为真；下一次合流之后它
 *   讲的是另一个提交的事，而**打印出来的样子和真话完全一样**。本文有 19 行用它，
 *   其中两处（P1-14 / P1-16 与 §7 第 10、11 条）在四小时内过期两次，都靠人重读才发现。
 * - **b) 纯路径词也要验存在性**。原来的尺子只把"`path.ts:123`"这种**可解析形状**
 *   当引用，所以点名过一个全仓根本不存在的 `domain/preference-resolver` 而一条不红
 *   —— 那是盲区，不是漏检。
 *
 * ## 它凭什么能失败
 *
 * 每次运行先跑**内置阳性对照**：一段人造探针（一个不存在的路径 + 一句没有锚的
 * `git show HEAD:` + 一个假 SHA）喂给同一对分类器，三维各自必须抓到。
 * 对照不过就 `exit 2`，**且不输出任何"引用干净"的结论** ——
 * 一条没人能弄红的检查没有价值（AGENTS §7 元规则 2）。
 *
 * 退出码：`0` 无问题 · `1` 有引用问题 · `2` 装置自检失败/用法错误。
 *
 * ## 只报不判的那一维
 *
 * 锚 SHA **不等于当前 HEAD** 会打印但不判红：文档里的锚本来就允许落后于 HEAD
 * （那正是"记下是哪一趟"的意义）。做成失败条件会让这道门禁每次合流后都红，
 * 而红得不对的门禁与没有门禁一样糟。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/check-doc-citations.mjs                   # 默认查那一份审计
 * node scripts/check-doc-citations.mjs --doc docs/x.md    # 指定文档（可重复）
 * node scripts/check-doc-citations.mjs --root <dir>       # 注入验证时指向临时树，不动工作树
 * ```
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
let root = resolve(HERE, '..');
const docs = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--root' || a === '--doc') {
    const next = argv[i + 1];
    if (typeof next !== 'string') {
      console.error(`用法：${a} 后面要跟一个参数`);
      process.exit(2);
    }
    if (a === '--root') root = resolve(next);
    else docs.push(next);
    i += 1;
  } else {
    console.error(`不认识参数：${String(a)}`);
    process.exit(2);
  }
}
if (docs.length === 0) docs.push('docs/research/performance-hotpaths-audit.md');

/**
 * 路径词豁免表。**逐条写清为什么可以不存在** —— 加一条的成本是刻意的，
 * 它逼人为这个词做一次真判断，而不是让它悄悄混进"全部通过"。
 * （同一手法见 `research/tools/license-inventory.mjs` 的 `REVIEWED_OTHER`。）
 */
const PATH_ALLOWLIST = new Map([
  [
    'research/tools/cite-self-check.mjs',
    '本文 §2「尺子」一节里**提议**的下一步装置名，通篇以"要做而未做"的口吻出现；改名成 real 路径会把那条提议抹掉',
  ],
  [
    'scripts/measure-checkpoint.mjs',
    '同上：P0-2 那节列的是"需要有的观测脚本"，不是现有文件',
  ],
  [
    'packages/shared-schema/src/line.ts',
    '本文 §5.1 第 1 条与 §1.1 那格**故意引用的那条编造路径**（子 Agent 报的 P0 整份作废）。'
    + '撤回记录的价值就在于原句留在原地（AGENTS §5「原句留在这里，不要删」）——'
    + '把它改成真路径等于把"我们曾经收下一条不存在的路径"这条教训抹掉。'
    + '已逐行读过命中处：文档 68 行、837 行两处上下文都明写"编造/不存在"',
  ],
  [
    'shared-schema/src/line.ts',
    '同上，只是 §5.1 那张表里省掉了 packages/ 前缀的写法（文档 918 行，同句"均不存在"）',
  ],
  [
    'docs/adr/0046-0048',
    'ADR **编号区间**的写法，不是文件路径（它旁边那格是 glob `docs/plans/trash-and-archive*`，'
    + '同一句在讲"哪些文档被带上提交"）。已读文档 1144 行原文确认',
  ],
]);

/** 明显不该当文件路径看的形状：URL、绝对路径、glob、占位省略号、键值片段。 */
function looksLikePath(token) {
  if (!token.includes('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  if (token.startsWith('/') || token.startsWith('~')) return false;
  // `node_modules/...`：索引里**没有**这些（遍历跳过它们），而本文用它讲的是
  // 装出来的依赖树 —— 不在"仓库里有没有这个名字"这个问题的范围内。
  if (token.startsWith('node_modules/') || token === 'node_modules') return false;
  if (/[*<>{}[\]()$|"'`…]/.test(token)) return false;
  if (token.includes('..') || token.includes('…') || token.includes('=')) return false;
  if (token.endsWith('/') || /\s/.test(token)) return false;
  // 至少一段像文件名（带扩展名），或落在常见源码目录里，才值得验存在性 ——
  // 否则 `zh-CN/en` 这种词表方向写法会被误判。
  return (
    /(^|\/)[^/]+\.[A-Za-z0-9]{1,10}$/.test(token) ||
    /(^|\/)(src|tests|docs|scripts|packages|apps|server)(\/|$)/.test(token)
  );
}

/** `path/x.ts:123-125` / `path/x.ts#L1` ⇒ 去掉行号与锚，留路径本体。 */
function pathFromSpan(span) {
  const first = (span.split(/[\s|,，、]/)[0] ?? span).trim();
  return first.replace(/#.*$/, '').replace(/:[0-9].*$/, '').replace(/[，。；;)）]$/, '');
}

// ── 仓内文件索引（后缀匹配） ──────────────────────────────────
//
// 🔴 为什么按**后缀**而不是从仓根拼：本文大量引用写的是 `features/sync/store.ts`
//   这种"离宿主目录最近"的形状。只按仓根解析时，第一版把 53 条里的绝大多数合法引用
//   报成了不存在 —— 而"红得不对"的门禁与没有门禁一样糟。
//   后缀匹配放过的只是"不同目录下同名"，那正是这里要的语义：
//   要抓的是 §7 第 5-b 条那种**全仓根本没有这个名字**的引用。
let fileIndex = null;
function collect(dir, prefix, sink) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    // 🔴 目录也进索引：本文有一批引用是**目录**形状（`apps/web`、`packages/ui/src`），
    //   只收文件会把它们全报成不存在 —— 那是一条会为一百个真东西报假的红。
    sink.push(rel);
    if (entry.isDirectory()) collect(join(dir, entry.name), rel, sink);
  }
}

/** ⇒ 命中数量（0 = 全仓没有这个路径词）。 */
function pathHits(token) {
  if (fileIndex === null) {
    const sink = [];
    collect(root, '', sink);
    fileIndex = sink;
  }
  const needle = `/${token}`;
  let hits = 0;
  for (const rel of fileIndex) if (rel === token || rel.endsWith(needle)) hits += 1;
  return hits;
}

function findPathProblems(docPath, text) {
  const problems = [];
  const seen = new Set();
  text.split('\n').forEach((line, index) => {
    for (const span of [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])) {
      const candidate = pathFromSpan(span);
      if (!looksLikePath(candidate)) continue;
      if (PATH_ALLOWLIST.has(candidate)) continue;
      if (pathHits(candidate) > 0) continue;
      const key = `${String(index + 1)}|${candidate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push(`${docPath}:${String(index + 1)} 引用了不存在的路径 \`${candidate}\``);
    }
  });
  return problems;
}

// ── git show HEAD: 的锚 ───────────────────────────────────────
const ANCHOR_ALL = /\b[0-9a-f]{7,40}\b/g;

function isCommit(sha) {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-t', `${sha}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 一次**真实取证**的形状：`git show HEAD:` 后面紧跟路径。
 *
 * 🔴 为什么按"后面有没有路径"判：本文 §8 第 17 步那一行讲的是**这条规则本身**
 * （"凡以 `git show HEAD:` 为证据的断言必须带锚"），那里它出现成裸的 `git show HEAD:`。
 * 用"裸形状"当触发条件会让尺子报它自己要立的那条规矩 ——
 * 这就是本文反复记过的「转述形状 = 新增违规」。带路径的调用才是取证。
 */
const INVOCATION = /git show HEAD:[A-Za-z0-9._-]/;

function findShaProblems(docPath, text) {
  const problems = [];
  /**
   * 🔴 围栏代码块里的 `git show HEAD:` **不算断言**。
   *
   * §7 第 17 步那条纪律的原文是"断言必须带锚，**并配一条复现命令**"——
   * 复现命令本身就长在代码块里（`§7 自检命令`那一段就是），它按定义不该带
   * 一个写死的 SHA（带了就成第二条会过期的读数，正是这条纪律要防的东西）。
   * 不加这一维，第一版会把 13 行里 8 行代码块模板一起报成"没锚"，
   * 而那 8 行是对的正确形状。
   */
  let inFence = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (!INVOCATION.test(line)) return;
    /**
     * 🔴 只有**报告了一个读数**的行才算"以 git show HEAD: 为证据的断言"。
     *
     * 不加这一维，第 17 步那一行**规则本身**（"`git show HEAD:` 必须带锚"）会被
     * 自己的尺子报成违规 —— 这就是本文反复记过的「转述形状 = 新增违规」。
     * 读数形状用"= 数字 / 数字 行 / N → M"这类**取值**标记来判定，而不是关键词白名单
     * （白名单会让任何写了"判据"二字的行免检，那等于没有判据）。
     */
    const reportsReading = /= \d|→ \d|\d+ 行|第 \d+|行数?\s*\d|：\s*\d/.test(line);
    if (!reportsReading) return;
    const anchors = line.match(ANCHOR_ALL) ?? [];
    if (anchors.length === 0) {
      problems.push(`${docPath}:${String(index + 1)} 用「git show HEAD:」取证却没写锚定的 SHA`);
      return;
    }
    for (const sha of anchors) {
      if (!isCommit(sha)) {
        problems.push(`${docPath}:${String(index + 1)} 的锚 ${sha} 不是本仓的提交对象`);
      }
    }
  });
  return problems;
}

/**
 * 内置阳性对照。⚠️ 这段探针**只活在本文件里**，绝不写进被扫描的文档 ——
 * 写进去它会成为那条尺子的一个新违规（本项目把这种事故叫「转述形状 = 新增违规」）。
 */
function selfTest() {
  const probe = [
    '见 `packages/definitely-not-here/fake-file.ts:1` 的那一行。',
    '现量取自 git show HEAD:server/src/x.ts，读数 = 0，这一句没写 SHA。',
    '带锚的那句：git show HEAD:server/src/x.ts 于 deadbeef，行数 12。',
  ].join('\n');

  const pathCaught = findPathProblems('__probe__', probe).some((p) =>
    p.includes('packages/definitely-not-here/fake-file.ts'),
  );
  const shaProblems = findShaProblems('__probe__', probe);
  const noAnchorCaught = shaProblems.some((p) => p.includes('没写锚定的 SHA'));
  const bogusCaught = shaProblems.some((p) => p.includes('不是本仓的提交对象'));

  return {
    ok: pathCaught && noAnchorCaught && bogusCaught,
    detail: `路径维=${pathCaught ? '抓到' : '漏'} · 无锚维=${noAnchorCaught ? '抓到' : '漏'} · 假 SHA 维=${bogusCaught ? '抓到' : '漏'}`,
  };
}

// ── 跑 ───────────────────────────────────────────────────────
const probe = selfTest();
if (!probe.ok) {
  console.error(`SELFTEST=FAIL（${probe.detail}）⇒ 装置本身不可信，不输出任何引用结论`);
  process.exit(2);
}

let head = '(读不到 HEAD)';
try {
  head = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // 保留占位串；这一维只报不判，读不到 HEAD 不该让整条检查失败。
}

const problems = [];
let spans = 0;
let headLines = 0;
const anchoredSha = new Set();
for (const doc of docs) {
  const abs = join(root, doc);
  if (!existsSync(abs)) {
    console.error(`文档不存在：${doc}`);
    process.exit(2);
  }
  const text = readFileSync(abs, 'utf8');
  spans += [...text.matchAll(/`([^`\n]+)`/g)].length;
  for (const line of text.split('\n')) {
    if (!line.includes('git show HEAD:')) continue;
    headLines += 1;
    for (const sha of line.match(ANCHOR_ALL) ?? []) anchoredSha.add(sha);
  }
  problems.push(...findPathProblems(doc, text), ...findShaProblems(doc, text));
}

console.log(
  `SELFTEST=pass（${probe.detail}）· 文档 ${String(docs.length)} 份 · 反引号 span ${String(spans)} · 「git show HEAD:」行 ${String(headLines)} · 锚 ${String(anchoredSha.size)} 枚`,
);
console.log(
  `当前 HEAD ${head}；锚的等值情况（只报不判）：${
    [...anchoredSha].map((sha) => `${sha}${head.startsWith(sha) ? '=HEAD' : '≠HEAD'}`).join(' ') || '（无）'
  }`,
);
console.log(`豁免表 ${String(PATH_ALLOWLIST.size)} 条（逐条带理由）。`);

if (problems.length > 0) {
  console.error(`\n引用问题 ${String(problems.length)} 条：`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log('引用检查：路径存在性 + git-show-HEAD 锚 —— 无问题 ✅');
