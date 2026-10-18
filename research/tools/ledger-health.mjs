#!/usr/bin/env node
/**
 * 对账件的**健康度**：一条命令打出 §9 那张表。
 * ================================================================
 *
 * ## 为什么要有它
 *
 * `docs/plans/launch-blockers.md` 的 §9 写着"这一页有多可信"，而那张表是**手抄**的 ——
 * 也就是说"对账件健康度"这个事实**自己住了两处**（文档一处、工具一处），
 * 而**同一事实住两处**正是这一整轮在查的东西。
 * ⇒ 本工具把那张表变成**一条命令的输出**；§9 只留它的一段样例输出（标明是样例）。
 *
 * ## 它**不**重复实现任何判断
 *
 * 全部计数都**从 `blocker-evidence-audit.mjs` 导入**（`parseRows` / `classify` /
 * `parseDecisions` / `decisionProblems` / `zeroClaims` / `statesProbe`）——
 * 抄一份判定等于再开一个会漂的事实源（本会话已经吃过好几次那个亏）。
 *
 * ## 用法
 *
 *   node research/tools/ledger-health.mjs                 # 表 + 计数（快，不跑外部命令）
 *   node research/tools/ledger-health.mjs --with-commands  # 外加"引用的命令"那一格的 rc（约 15 秒）
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classify,
  decisionProblems,
  parseDecisions,
  parseRows,
  statesProbe,
  zeroClaims,
} from './blocker-evidence-audit.mjs';
import { extractCommands } from './ledger-evidence-rerun.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LEDGER = join(ROOT, 'docs/plans/launch-blockers.md');


/**
 * **跨节引用一致性**（`--crossrefs`）。
 *
 * 为什么要有：**对账件的引用面此前没人核过** —— 2026-10-16 我人工核了一遍，
 * 发现 §7 内部引用是干净的，但 §5 漏掉了当时四条红里的两条（见 §9.2）。
 * ⇒ 那一遍**该是机械动作**，不该靠人想起来做。
 *
 * 两条判据（都能失败）：
 *  1. §7 决定行里的编号（`A1` / `B11` / `§4.2`）**必须解析得到**：前两类要在 §1/§2 有行，
 *     `§4.x` 要有对应小节。
 *  2. §7 最后一栏引用的"可跑物"**必须存在**：`pnpm check:*` / `verify:*` 要是 npm 脚本，
 *     `scripts/*.mjs` / `packages/**` 等路径要真实存在。
 *
 * ⚠️ **它不判 rc**（红线本来就该红），只判"**引用指得着吗**"。
 */
export function crossReferenceProblems(markdown, root, scripts) {
  const problems = [];
  const lines = markdown.split('\n');
  const claimsEnd = lines.findIndex((l) => l.startsWith('## 5.'));
  const claimIds = new Set(
    lines.slice(0, claimsEnd === -1 ? lines.length : claimsEnd)
      .map((l) => /^\| \*\*([AB]\d+)\*\*/.exec(l)?.[1])
      .filter(Boolean),
  );
  const sectionIds = new Set(
    [...markdown.matchAll(/^### (4\.\d+)/gm)].map((m) => `§${m[1]}`),
  );

  const s71 = lines.findIndex((l) => l.startsWith('### 7.1'));
  const s74 = lines.findIndex((l) => l.startsWith('### 7.4'));
  if (s71 === -1 || s74 === -1) return { problems: ['读不到 §7.1/§7.4 —— §7 换了形状，本判据空转'], checked: 0 };

  let checked = 0;
  for (const line of lines.slice(s71, s74)) {
    const head = /^\| \*\*([^|]+?)\*\*/.exec(line);
    if (head === null) continue;
    // 判据 1：编号解析
    for (const id of head[1].match(/[AB]\d+|§4\.\d/g) ?? []) {
      checked += 1;
      if (id.startsWith('§')) {
        if (!sectionIds.has(id)) problems.push(`${id}：§7 引用了它，但正文里没有这个小节`);
      } else if (!claimIds.has(id)) {
        problems.push(`${id}：§7 引用了它，但 §1/§2 里没有这一行`);
      }
    }
    // 判据 2：最后一栏的可跑物存在
    const last = line.trimEnd().replace(/\|$/, '').split('|').pop().trim();
    // ⚠️ 最后一栏里出现的 `§4.x` **也要解析**（第一版只核了第一栏 ⇒ 2026-10-16 自检的臂抓到）。
    for (const sec of last.match(/§4\.\d/g) ?? []) {
      checked += 1;
      if (!sectionIds.has(sec)) problems.push(`${sec}：§7 最后一栏引用了它，但正文里没有这个小节`);
    }
    for (const probe of last.match(/`[^`]+`/g) ?? []) {
      const raw = probe.slice(1, -1).trim();
      checked += 1;
      // 🔴 **2026-10-16 修假报**：`pnpm --filter X exec …` / `pnpm exec …` / `pnpm -r …` 都**不是脚本名**。
      //    第一版把它们当脚本去 `package.json` 里查 ⇒ 一句 `pnpm --filter …` 会被拆成两个假报。
      const pnpmSub = /^(--?[a-z]|-r\b|exec\b|dlx\b|run\b)/.test(raw.slice(5).trim());
      if (raw.startsWith('pnpm ') && !pnpmSub) {
        const name = raw.slice(5).trim();
        if (!(name in scripts)) problems.push(`§7 引用了 \`${name}\`，但 package.json 里没有这个脚本`);
      } else if (/^(scripts|apps|packages|server|docs)\//.test(raw)) {
        if (!existsSync(join(root, raw))) problems.push(`§7 引用了 \`${raw}\`，但该路径不存在`);
      }
    }
  }
  return { problems, checked };
}

/** 把正文切成"断言段"（`## 5.` 之前）与"自检段"（`## 8.` 之后）。 */
function sections(markdown) {
  const lines = markdown.split('\n');
  const claimsEnd = lines.findIndex((l) => l.startsWith('## 5.'));
  const metaStart = lines.findIndex((l) => l.startsWith('## 8.'));
  return {
    claims: claimsEnd === -1 ? lines : lines.slice(0, claimsEnd),
    meta: metaStart === -1 ? [] : lines.slice(metaStart),
  };
}

/** "零命中"那一格：排除自检段、围栏代码块、以及标明"引用旧话"的行。 */
function zeroClaimCensus(lines) {
  // 🔴 **自己排掉 §8 之后**（第一版靠调用方先切段，直接调用它会多算 —— 自检的臂抓到）。
  const metaAt = lines.findIndex((l) => l.startsWith('## 8.'));
  if (metaAt !== -1) lines = lines.slice(0, metaAt);
  let inFence = false;
  let total = 0;
  let noProbe = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/原写|原文|已撤回|撤回】/.test(line)) continue;
    if (zeroClaims(line).length === 0) continue;
    total += 1;
    if (!statesProbe(line)) noProbe += 1;
  }
  return { total, noProbe };
}


/** 逐臂证明本工具的四类计数**真的会动**。返回失败臂数。 */
function selfTest() {
  const arms = [];
  const arm = (name, ok, detail) => arms.push({ name, ok, detail });
  const scripts = { 'check:exists': 'node scripts/x.mjs' };
  const head = '## 1. 档一\n\n| # | 行 |\n|---|---|\n| **A1** | 有的 |\n\n## 5. 判据\n\n## 7. 待拍板\n\n### 7.1 压在发布路径上\n\n';

  // 臂 1：**引用了不存在的 npm 脚本 ⇒ 必须报**（判据的牙）
  const bad = head + '| **A1** | x | y | `pnpm check:nope` |\n\n### 7.4\n';
  const r1 = crossReferenceProblems(bad, ROOT, scripts);
  arm('引用不存在的脚本被抓到', r1.problems.length === 1 && r1.problems[0].includes('check:nope'),
    JSON.stringify(r1.problems));

  // 臂 2：**正面对照** —— 存在的脚本不许报
  const good = head + '| **A1** | x | y | `pnpm check:exists` |\n\n### 7.4\n';
  const r2 = crossReferenceProblems(good, ROOT, scripts);
  arm('正面对照：存在的脚本不报', r2.problems.length === 0, JSON.stringify(r2.problems));

  // 臂 3：**引用了不存在的清单编号 ⇒ 必须报**
  const badId = head + '| **B9** | x | y | `pnpm check:exists` |\n\n### 7.4\n';
  const r3 = crossReferenceProblems(badId, ROOT, scripts);
  arm('引用不存在的清单编号被抓到', r3.problems.some((p) => p.startsWith('B9')),
    JSON.stringify(r3.problems));

  // 臂 4：**引用了不存在的小节 ⇒ 必须报**
  const badSec = head + '| **A1** | x | y | 见 §4.9 |\n\n### 7.4\n';
  const r4 = crossReferenceProblems(badSec, ROOT, scripts);
  arm('引用不存在的小节被抓到', r4.problems.some((p) => p.includes('§4.9')),
    JSON.stringify(r4.problems));

  // 臂 5：**"零命中"计数要排除 meta/围栏/引用旧话**（否则会自指膨胀）
  const meta = '## 1. 档一\n\n| **A1** | 零调用点 |\n\n## 8. 自检\n\n| x | 零调用点 |\n';
  arm('零命中计数排除 §8 之后的自检段', zeroClaimCensus(meta.split('\n')).total === 1,
    JSON.stringify(zeroClaimCensus(meta.split('\n'))));

  // 臂 6：**U+FFFD 计数真的会动**（散文里的编码陷阱）
  arm('散文里的 U+FFFD 数得到', (('\uFFFD\uFFFD').match(/\uFFFD/g) ?? []).length === 2, '2');

  let failed = 0;
  for (const a of arms) {
    if (!a.ok) failed += 1;
    console.log(`  ${a.ok ? '✅' : '🔴'} ${a.name} —— ${a.detail}`);
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failed}`);
  return failed;
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const markdown = readFileSync(LEDGER, 'utf8');
  const { claims, meta } = sections(markdown);
  const rows = parseRows(markdown);
  const counts = { 判据: 0, 外部: 0, 人工: 0, 归并: 0, 散文: 0 };
  for (const row of rows) counts[classify(row.text)] += 1;
  const independent = rows.length - counts['归并'];

  const decisions = parseDecisions(markdown);
  const decisionIssues = decisionProblems(decisions).length;

  const zero = zeroClaimCensus(claims);

  // 散文里的**替换字符**：脚本有 `check:shell-unicode` 管，**散文没有** ——
  // 而我自己 2026-10-16 就在这里写出过三个 U+FFFD（见 §9.3）。
  const mojibake = (markdown.match(/\uFFFD/g) ?? []).length;

  // 链的形状：`check` 是 `&&` 串联，遇到第一处红就停。
  const chain = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.check
    .split('&&')
    .map((x) => x.trim().replace(/^pnpm\s+/, ''));

  console.log('| 维度 | 读数 |');
  console.log('|---|---|');
  console.log(`| 清单行 | **${rows.length}** 行（其中 **${counts['归并']}** 行是归并/撤回，不算独立断言）|`);
  console.log(
    `| 断言 × 出口 | 独立 **${independent}** 条：**判据 ${counts['判据']}** · **外部 ${counts['外部']}** · **人工 ${counts['人工']}** · **散文 ${counts['散文']}** |`,
  );
  console.log(
    `| 决定 × 内容 | **${decisions.length}** 条，写成表格但内容不实的 **${decisionIssues}** 条 |`,
  );
  console.log(
    `| "零命中"类断言（只算**断言段**）| **${zero.total}** 行，其中**没写明探针**的 **${zero.noProbe}** 行 |`,
  );
  console.log(`| 引用的命令（去重）| **${extractCommands(markdown).length}** 条 |`);
  console.log(`| \`pnpm check\` 链 | **${chain.length}** 步（\`&&\` 串联，遇到第一处红就停）|`);
  console.log(`| 散文里的替换字符（U+FFFD）| **${mojibake}** 个 |`);
  console.log(`| 自检段（§8/§9）行数 | ${meta.length} 行 |`);

  if (process.argv.includes('--with-commands')) {
    console.log('\n（`--with-commands`：下面这一格约 15 秒）');
    let green = 0;
    let red = 0;
    for (const command of extractCommands(markdown)) {
      const [bin, ...args] = command.split(' ');
      try {
        execFileSync(bin, args, { cwd: ROOT, stdio: 'ignore', timeout: 900_000 });
        green += 1;
      } catch {
        red += 1;
      }
      void red;
    }
    console.log(`| 引用命令的 rc | 绿 **${green}** · 红 **${red}**（红的是否"本来就该红"要逐条回行里看）|`);
  }

  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  const { problems: xref, checked } = crossReferenceProblems(markdown, ROOT, scripts);
  console.log(
    `\n| 跨节引用 | 查了 **${checked}** 处：${
      xref.length === 0 ? '**全部解析得到** ✅' : `🔴 **${xref.length} 处指不着**`
    } |`,
  );
  for (const p2 of xref) console.log(`   · ${p2}`);

  console.log(
    '\n⚠️ 每一格都要**对着它自己的工具**复核一遍（`--brief` / `--decisions` / `--zero-claims` / ' +
      '`--with-commands` / `--blocks`）—— 本工具只是把它们的读数收在一处，**不新增判断**。',
  );
}

main();
