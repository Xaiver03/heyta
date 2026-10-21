#!/usr/bin/env node
/**
 * 文档里"跑过某条 pnpm 命令"的声称，必须指向一枚真实存在的脚本键。
 * =================================================================
 *
 * ## 这条尺管的是哪一种事故
 *
 * `docs/plans/collaboration-shared-lists.md` §9.5 第 3 条把那 9 枚"哪一档都没有"的名字
 * 逐条读完了，结论是**那 9 条全是假阳性**（三种形状：写着"新增／提案"的、自己就在讲
 * "这条命令不存在"的、划掉的历史坐标）。**但那一趟是散文** —— 它没有一个能复跑的载体，
 * 所以今天没有任何东西挡得住第 10 枚。这一枚脚本把那次人工结论变成常驻判据。
 *
 * ## 判据为什么不写成"所有 `pnpm x:y` 都必须存在"
 *
 * 那会把**提案**、把**"真键其实是另一个"这类更正句**、把**划掉的历史坐标**一起做红 ——
 * 而那些句子是对的。所以只判一种声称：**这句话把命令陈述成"跑过的现行命令"**。
 * 判形状的办法是把命中所在的那一格/那一行连同左右各一行一起读，出现下列任一样子就**不是**
 * "陈述为已执行"：
 *
 *   · 提案词 —— 新增 / 提案 / 建议 / 待加 / 应立 / 拟 / 计划加 / 要加 / 加一门 / 加一条
 *   · 自曝不存在 —— 不存在 / 没有这 / 真键 / 其实是 / 已删 / 删掉 / 摘出 / 从来 / 压根
 *   · 删除线 —— 整行里有 `~~`（那是作者自己把它作废了）
 *   · 历史戳 —— 同一段里带"当时 / 那一轮 / 旧"，或落在 `docs/plans/archive/`（归档层按
 *     `docs/README.md` 的分层规则是**冻结的历史**，它陈述的是当时的现实，不是现在的）
 *
 * 剩下的才是"当前可用"的声称 ⇒ 名字必须在工作区某档 `package.json` 的 scripts 里。
 *
 * ## 为什么分母是"全部工作区脚本名"而不是只有 root
 *
 * `apps/web` 自己也有 `pnpm --filter` 语境下能敲的键（实测 `pnpm -r test` 那类）。
 * 只比 root 会把合法键判成非法 ⇒ 假红。所以取 root + `packages/*` + `apps/*` + `server`
 * 四档合起来的**键名全集**（脚本名可以各档不同，这里判的是"这个名字存不存在"）。
 *
 * ## 能不能红
 *
 * `--self-test` 在内存里过五类句子（三类该放过、两类该抓），外加一条**分母自检**：
 * 真跑一遍必须至少抓到 1 条"现行声称"—— 若抓到 0，说明扫描面或谓词坏了，而不是文档变干净了。
 * 臂的载体是候选副本（`HEYTA_CHECK_ROOT` + 临时 fixture 目录），**不改工作树里的任何文档**。
 *
 * 跑法：`node scripts/check-doc-command-claims.mjs`（0 = 干净）
 *       `node scripts/check-doc-command-claims.mjs --self-test`
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = process.env.HEYTA_CHECK_ROOT ?? join(HERE, '..', '..');

/** 扫描面：`docs/` 全树 + 三份根规则文件。归档层另有一条独立理由，见 `skipDir`。 */
const ROOT_FILES = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md'];
const SKIP_DIR = /(\/node_modules\/|\/dist\/|\/archive\/)/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p, out);
    } else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 归档层整层不进扫描面 —— 它按 `docs/README.md` 的分层规则是"冻结的历史"。 */
function isArchived(rel) {
  return rel.split('/').includes('archive');
}

function collectFiles() {
  const files = [];
  if (existsSync(join(ROOT, 'docs'))) walk(join(ROOT, 'docs'), files);
  for (const f of ROOT_FILES) {
    const p = join(ROOT, f);
    if (existsSync(p)) files.push(p);
  }
  return files.filter((p) => !SKIP_DIR.test(`/ ${relative(ROOT, p)} `.replace(/\\/g, '/')) && !isArchived(relative(ROOT, p)));
}

/** 工作区脚本名全集：root + packages/* + apps/* + server。 */
function collectScriptNames(rootDir) {
  const names = new Set();
  const dirs = [rootDir];
  for (const bucket of ['packages', 'apps']) {
    const base = join(rootDir, bucket);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const p = join(base, name);
      if (statSync(p).isDirectory()) dirs.push(p);
    }
  }
  if (existsSync(join(rootDir, 'server'))) dirs.push(join(rootDir, 'server'));
  for (const d of dirs) {
    const pkg = join(d, 'package.json');
    if (!existsSync(pkg)) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(pkg, 'utf8'));
    } catch {
      continue;
    }
    for (const key of Object.keys(json.scripts ?? {})) names.add(key);
  }
  return names;
}

/** 提案 / 自曝不存在 / 作废 / 历史 / 例子 —— 命中任一形状就**不算**"现行声称"。 */
const NON_ASSERT_PATTERNS = [
  ['新增', /新增|提案|建议|待加|应立|拟|计划加|要加|加一门|加一条|扩成/],
  ['自曝不存在', /不存在|没有这|没有那|真键|其实是|压根|从来|已经删|已删|删掉|摘出|不在链上|没有一扇/],
  ['删除线', /~~[^~]+~~/],
  ['历史戳', /当时|那一轮|那一趟|旧名|历史上|曾经|此前|先前|20\d\d-\d\d-\d\d 之前/],
  // `pnpm check:x` 这类句子讲的是**形状**（"这种键"），不是某枚具体命令 —— 例子句。
  ['例子句', /这类|之类|例如|举例|示意|占位|这样的|此种/],
];

function classify(sentence) {
  for (const [tag, re] of NON_ASSERT_PATTERNS) if (re.test(sentence)) return { asserted: false, tag };
  return { asserted: true, tag: '' };
}

/**
 * 取"句子"：以命中行为中心，往前后各扩到**最近的中文句号/换行/表格单元边界**为止。
 * 为什么左右都要扩：真句子里"新增"常常在命令**之后**半句（`跑 pnpm check:x —— 这一枚是新增的`），
 * 只取前半句会把提案判成声称 ⇒ 假红。
 */
function sentenceOf(lines, idx, col) {
  const line = lines[idx];
  const before = line.slice(Math.max(0, col - 120), col);
  const after = line.slice(col, col + 120);
  const prevLine = idx > 0 ? lines[idx - 1] : '';
  const nextLine = idx < lines.length - 1 ? lines[idx + 1] : '';
  return [prevLine, before, after, nextLine].join('\n');
}

const NAME_RE = /pnpm\s+(?:-r\s+|--filter\s+\S+\s+)?([a-z][a-z0-9-]*(?::[a-zA-Z0-9_*-]+)+)/g;

/**
 * 名字 → 在不在。两种形状差别很大：
 *  · **精确键** ⇒ 必须逐字命中某档 `package.json` 的 scripts。
 *  · **族名**（带 `*`，或以 `-` 收尾，如 `pnpm verify:mobile-*`）⇒ 只要**至少有一枚成员**就算在。
 * 🔴 这不是豁免通道：族里一枚都没有（`pnpm verify:ghost-*`）照样红 —— 臂里钉着这一条。
 */
function resolveName(name, known) {
  if (!name.includes('*') && !name.endsWith('-')) return { exists: known.has(name), kind: 'exact' };
  const prefix = name.replace(/\*+$/, '');
  return { exists: [...known].some((k) => k.startsWith(prefix)), kind: 'family' };
}

/** 代码围栏**不**跳过：围栏里的命令同样是给人复制执行的声称，它也一样必须存在。 */
function hitRows(text, known, fileLabel) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, idx) => {
    NAME_RE.lastIndex = 0;
    let m;
    while ((m = NAME_RE.exec(line)) !== null) {
      const name = m[1];
      if (name.includes('&&') || name.includes('install')) continue;
      const r = resolveName(name, known);
      const cls = classify(sentenceOf(lines, idx, m.index));
      out.push({
        file: fileLabel,
        n: idx + 1,
        name,
        kind: r.kind,
        exists: r.exists,
        asserted: cls.asserted,
        tag: cls.tag,
      });
    }
  });
  return out;
}

function scan(mdFile, known) {
  const rel = relative(ROOT, mdFile).replace(/\\/g, '/');
  return hitRows(readFileSync(mdFile, 'utf8'), known, rel);
}

/** 已知为"更正句／提案句"的名字：它们**不是**现行声称，逐条写理由。 */
const EXEMPT = new Map([
  ['check:windows-dotnet', 'desktop-native-migration 那一格明写「（新增）」—— 提案句，不是"跑过"'],
  ['verify:mobile-widget', 'research/native-widgets.md 那句是方案句（"要不要立这么一扇门"）'],
  ['check:l4-no-style', 'multi-end-coverage-handoff 那句自己就在讲"真键是 check:l4"，它是更正句'],
  ['check:evidence-md5', 'calendar-profile-handoff 那段讲的是"按这枚针脚把它从链里删掉"的改写'],
  ['check:macos-removal', 'trash-and-archive 那一格的证据文件名已被删除线否掉'],
  ['check:pricing-consistency', '在 BLOCKED.md（并行线的账本，禁碰）：上下文是提案与追记'],
  ['check:inbound-lane', '在 BLOCKED.md（同上）：提案与追记，不是"跑过"'],
]);

function run() {
  const known = collectScriptNames(ROOT);
  const files = collectFiles();
  const hits = [];
  for (const f of files) hits.push(...scan(f, known));

  const violations = hits.filter(
    (h) => h.asserted && !h.exists && !EXEMPT.has(h.name),
  );
  const asserted = hits.filter((h) => h.asserted);

  if (violations.length > 0) {
    console.error(`✖ 文档把不存在的 pnpm 脚本陈述成现行命令 ${violations.length} 处：`);
    for (const v of violations.slice(0, 20)) console.error(`  ${v.file}:${v.n}  ${v.name}`);
    if (violations.length > 20) console.error(`  …另 ${violations.length - 20} 处`);
    console.error('  ⇒ 要么改成真键，要么把这一句写成提案/更正句的形状，要么进 EXEMPT 并**写理由**。');
    return 1;
  }
  console.log(
    `✔ 文档命令声称：扫 ${files.length} 份 md · 抓到 pnpm 脚本名 ${hits.length} 处，其中"现行声称" ${asserted.length} 处，` +
      `不在工作区脚本全集（${known.size} 枚键）里的 0 处。豁免表 ${EXEMPT.size} 条（逐条带理由）`,
  );
  return 0;
}

/* ── --self-test：判据能不能红 ─────────────────────────────────────── */
function selfTest() {
  const cases = [
    { s: '跑 `pnpm check:collab-carrier` 全绿 ⇒ 载具齐。', want: true, why: '现行声称' },
    { s: '这一格标着「（新增）」：`pnpm check:windows-dotnet`', want: false, why: '提案句' },
    { s: '明说真键是 `check:l4`，`pnpm check:l4-no-style` 并不存在', want: false, why: '自曝不存在' },
    { s: '~~`pnpm check:macos-removal`~~ 那格的证据文件名已作废', want: false, why: '删除线' },
    { s: '当时那条是 `pnpm check:pricing-consistency`，后来改名了', want: false, why: '历史戳' },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = classify(c.s).asserted;
    if (got !== c.want) {
      console.error(`🔴 臂不符：${c.why} 期望 asserted=${String(c.want)}，实得 ${String(got)}`);
      bad += 1;
    } else {
      console.log(`✅ ${c.why} → asserted=${String(got)}`);
    }
  }
  // 阳性对照 A：一个不存在的键，写成现行声称 ⇒ 端到端必须红（用临时 fixture，不碰工作树）
  const dir = mkdtempSync(join(tmpdir(), 'heyta-claims-arm-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"verify:mobile-ios":"node a.mjs"}}');
    writeFileSync(join(dir, 'docs.md'), [
      '跑一遍 `pnpm check:ghost` 就绿了。',
      '移动那一腿走 `pnpm verify:mobile-*`。',
      '这一族里一枚都没有的是 `pnpm verify:ghost-*`。',
      '`pnpm check:x` 这类环节自己还会再打印一层命令。',
      '带连字符的全名也算一枚键：`pnpm verify:mobile-ios-account`。',
    ].join('\n'));
    const known = new Set(['verify:mobile-ios']);
    const rows = scanSync(dir, 'docs.md', known);
    const by = (name) => rows.find((r) => r.name === name);
    const arms = [
      ['幽灵精确键被抓', by('check:ghost') !== undefined && by('check:ghost').asserted && !by('check:ghost').exists],
      ['族名有成员 ⇒ 放过', by('verify:mobile-*') !== undefined && by('verify:mobile-*').exists],
      ['族名零成员 ⇒ 仍抓（通配符不是后门）', by('verify:ghost-*') !== undefined && !by('verify:ghost-*').exists],
      ['例子句不算现行声称', by('check:x') !== undefined && !by('check:x').asserted],
      // 🔴 第一版把 `-` 漏进了字符类 ⇒ 名字被从第一个连字符**截断**，全仓假红 486 处。
      //    这条臂钉的就是"取名完整"：截断的话这里取到的是 `verify:mobile`，臂直接红。
      ['取名不被连字符截断', by('verify:mobile-ios-account') !== undefined],
    ];
    for (const [label, ok] of arms) {
      console.log(`${ok ? '✅' : '🔴'} ${label}`);
      if (!ok) bad += 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // 阳性对照 B：分母自检 —— 真树里必须抓到 >0 条现行声称（抓到 0 = 扫描面坏了，不是文档干净）
  const known = collectScriptNames(ROOT);
  const all = [];
  for (const f of collectFiles()) all.push(...scan(f, known));
  const asserted = all.filter((h) => h.asserted).length;
  console.log(`${asserted > 0 ? '✅' : '🔴'} 分母自检：扫描面 ${collectFiles().length} 份 md · 命中 ${all.length} 处 · 现行声称 ${asserted} 处`);
  if (asserted === 0) bad += 1;

  console.log(`SELF=${bad === 0 ? 'OK' : 'FAIL'} arms=${String(cases.length + 6)} failed=${String(bad)}`);
  return bad === 0 ? 0 : 1;
}

/** 给 self-test 的端到端臂用：在指定 root 下扫一枚 md。 */
function scanSync(rootDir, relFile, known) {
  return hitRows(readFileSync(join(rootDir, relFile), 'utf8'), known, relFile);
}

if (process.argv.includes('--self-test')) process.exit(selfTest());
if (process.env.HEYTA_CLAIMS_JSON === '1') {
  const known = collectScriptNames(ROOT);
  const all = [];
  for (const f of collectFiles()) all.push(...scan(f, known));
  console.log(JSON.stringify(all.filter((h) => !h.exists), null, 0));
  process.exit(0);
}
process.exit(run());
