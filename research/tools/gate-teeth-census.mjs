#!/usr/bin/env node
/**
 * 门禁的**牙**：链里哪些 `check:*` 证明过"自己会失败"，哪些没有。
 * ================================================================
 *
 * ## 为什么需要它
 *
 * AGENTS §8.3 写着「**测试要能失败；不能失败的检查没有价值**」。而那件事**只能被证明**，
 * 不能被声称 —— 本会话已经吃过两次：`check:payment-entry` 的判据**恒真**（修好之后才红），
 * `check:crosslang-contract` 在没有 `dotnet` 的机器上**跳过也返回 0**。
 * ⇒ 于是要问：**链里那 100 多条门禁，有几条真的证明过自己会红？**
 *
 * ## 它怎么判（三级，且**不假装精确**）
 *
 * | 档 | 依据 |
 * |---|---|
 * | **自检** | 脚本里真的处理 `--self-test`（或有 `SELF_TEST` 分支）—— 那是**可复跑**的证明 |
 * | **注释里的臂** | 脚本里有"变异臂/臂 M1…"这类**文字**，但没有跑它们的入口 —— 证明**做过，不可复跑** |
 * | **无** | 两者都没有 ⇒ 这条门禁**没有被证明过会失败** |
 *
 * ⚠️ 它是**读数，不是判据**：判"这篇注释算不算臂"是**语义判断**，本工具只做粗分类，
 * 好让人知道**从哪几条开始查**。
 *
 * ## 用法
 *
 *   node research/tools/gate-teeth-census.mjs            # 表 + 计数
 *   node research/tools/gate-teeth-census.mjs --no-arm    # 只列"无"那一档
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** 从 `package.json` 的 `check` 链里取出所有 `check:*`。 */
export function chainGates() {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  return scripts.check
    .split('&&')
    .map((x) => x.trim().replace(/^pnpm\s+/, ''))
    .filter((x) => x.startsWith('check:'));
}

/** 一条 `check:*` 的命令行里那个 `.mjs` / `.sh` 的路径。 */
export function scriptPathOf(command) {
  // 🔴 **第一版只认 `scripts/` 前缀**，于是漏掉了一整批（`packages/legal/scripts/…`、
  //    `server/scripts/…`、`research/tools/…`、`design-system/…`）——
  //    其中四条还被当成"读不到"，差点被读成"门禁指向不存在的文件"（实测：文件都在，
  //    是我的正则只截了 `scripts/xxx.mjs` 那一段、拼出来的相对路径不存在）。
  // 再放宽：`check:ios-ax-shim` 是 `.py`、`check:server-copy` 是 `ts-node … .ts` ⇒ 一并认。
  const m = /((?:[\w.-]+\/)+[\w.-]+\.(?:mjs|sh|ts|py))/i.exec(command);
  return m === null ? undefined : m[1];
}

/** 三级分类。 */
export function classifyTeeth(source) {
  if (/--self-test|SELF_TEST\b/.test(source)) return '自检';
  if (/变异臂|变异验证|臂\s*[A-Z]?\d|M\d+\s|arms?\s*=|逐臂/.test(source)) return '注释里的臂';
  return '无';
}


/**
 * **逐条跑 `--self-test`、把臂数读出来**（`--arm-counts`）。
 *
 * 🔴 为什么单列这一档：`gate-teeth-census` 的"自检"那一档只说"**脚本里有那个入口**"，
 * 而**入口不等于有臂** —— 一个 `--self-test` 分支如果打的臂是 0 条，
 * 输出会是"**臂数 0，失败 0**"，读起来像"自检通过"。⇒ 那正是本页反复记的假绿（B14 那一族）。
 *
 * ⚠️ 它**只读臂数**，不判臂的质量（"臂数 7 但全是一侧"的例子见 §8.8.5 —— 那一侧靠**变异**才看得出来）。
 */


/**
 * 从 `--self-test` 的输出里读**臂数**。
 *
 * 🔴 **第一版只认 `臂数 N` / `ARMS=N`** ⇒ 13 条门禁被报成"输出里没有臂数"，
 *    而当日的实情是：**它们全都打臂**，只是用词不同（`--self-test: 6 臂`、
 *    `臂 0（共 6 臂）`、`[OK] …`、`反向腿 …`）。⇒ 那是**我的正则太窄**，不是它们空壳。
 * ⇒ 现在分两级：**① 显式计数**（几种写法）→ **② 退化：数"臂形状"的行**，并**标出用的是哪一级**。
 */
export function armCountOf(out) {
  const explicit = [
    /臂数\s*(\d+)/,
    /ARMS=(\d+)/,
    /共\s*(\d+)\s*臂/,
    /(\d+)\s*臂/,
    /(\d+)\s*arms?\b/i,
  ];
  for (const re of explicit) {
    const m = re.exec(out);
    if (m !== null) return { n: Number(m[1]), how: '显式' };
  }
  // 退化：数"看起来像一条臂"的行（`✅ 臂…` / `臂 N` / `[OK] …` / `OK — …` / `… → ✅`）
  const counted = out
    .split('\n')
    .filter(
      (l) =>
        /^\s*(✅|🔴|❌|\[OK\]|\[FAIL\])/.test(l) ||
        /\b臂\s*\d/.test(l) ||
        /(OK|FAIL)\s*[—-]/.test(l) ||
        /→\s*(✅|🔴)/.test(l),
    ).length;
  return counted > 0 ? { n: counted, how: '数的' } : { n: undefined, how: '读不到' };
}

function main() {
  const gates = chainGates();
  const rows = [];
  for (const gate of gates) {
    const command = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts[gate];
    const path = scriptPathOf(command ?? '');
    if (path === undefined) {
      // `pnpm --filter <pkg> check:x` 这类：门禁住在**包内**，本工具够不着 ⇒ 明说，别装判过。
      rows.push({ gate, kind: /--filter/.test(command ?? '') ? '(包内脚本)' : '(不是脚本)' });
      continue;
    }
    let source = '';
    try {
      source = readFileSync(join(ROOT, path), 'utf8');
    } catch {
      rows.push({ gate, kind: '(读不到)' });
      continue;
    }
    rows.push({ gate, kind: classifyTeeth(source), path });
  }

  const counts = { 自检: 0, '注释里的臂': 0, 无: 0 };
  for (const row of rows) if (row.kind in counts) counts[row.kind] += 1;

  if (process.argv.includes('--arm-counts')) {
    const withSelfTest = rows.filter((r) => r.kind === '自检');
    console.log(`跑 ${withSelfTest.length} 条带自检的门禁的 --self-test，读臂数：\n`);
    let zero = 0;
    let totalArms = 0;
    let nonNode = 0;
    let broken = 0;
    let noCount = 0;
    const redSelftests = [];
    for (const row of withSelfTest) {
      // 🔴 **三种"读不到"要分开**（第一版混成一个"读不到"，等于把三件事读成一件）：
      //    ① 不是 node 脚本（`.py` / `.sh`）—— 本模式不跑它；
      //    ② 跑不起来（node 语法错）；
      //    ③ 跑起来了但**输出里没有臂数**（很多自检不打这个数）。
      if (!/\.(mjs|js|cjs)$/.test(row.path)) {
        nonNode += 1;
        console.log(`  ⚪ ${row.gate.padEnd(34)} 非 node 脚本（${row.path.split('.').pop()}）—— 本模式不跑`);
        continue;
      }
      let out = '';
      let errored = false;
      try {
        out = execFileSync('node', [row.path, '--self-test'], {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 120_000,
        });
      } catch (error) {
        out = String(error?.stdout ?? '') + String(error?.stderr ?? '');
        errored = true;
      }
      // 🔴 **还要读退出码与 FAIL 数**（2026-10-16 加）："有自检"**不等于**"自检通过" ——
      //    当日实测 `check:mobile-ai-anchors` 的 `--self-test` 报 **ARMS=162 FAIL=4 且 rc=1**，
      //    而它在 `pnpm check` 链里**是绿的**（链跑的是不带 `--self-test` 的那条路）。
      const failM = /FAIL=(\d+)/.exec(out);
      const fails = failM === null ? undefined : Number(failM[1]);
      const { n, how } = armCountOf(out);
      if (n === undefined) {
        if (errored) broken += 1;
        else noCount += 1;
        console.log(
          `  ${errored ? '🔴' : '🟡'} ${row.gate.padEnd(34)} ${errored ? '跑不起来' : '连臂形状的行都数不到'}`,
        );
        continue;
      }
      if (n === 0) zero += 1;
      totalArms += n;
      const red = fails !== undefined && fails > 0;
      if (red) redSelftests.push(`${row.gate}（FAIL=${fails}）`);
      console.log(
        `  ${n === 0 ? '🔴' : red ? '🔴' : '✅'} ${row.gate.padEnd(34)} 臂数 ${String(n).padStart(3)}` +
          `${how === '数的' ? '（数的）' : ''}${fails === undefined ? '' : `  FAIL=${fails}`}` +
          `${red ? '  ← **自检自己是红的**' : ''}`,
      );
    }
    console.log(
      `\n合计 **${totalArms}** 臂；🔴 **臂数为 0 的 ${zero} 条**（那几条的"自检通过"是假绿）；` +
        `⚪ 非 node 脚本 ${nonNode} 条；🔴 跑不起来 ${broken} 条；🟡 **输出里没有臂数 ${noCount} 条**` +
        `（那几条**连臂形状的行都数不到** —— **不等于没有臂**，要人去看）。\n` +
        `🔴 **自检自己是红的 ${redSelftests.length} 条**：${redSelftests.join(' · ') || '（无）'}` +
        ` —— 这些门禁在链里可能是绿的（链跑的是不带 \`--self-test\` 的那条路）。`,
    );
    console.log('⚠️ 只读臂数，不判质量：**"臂数 7 但全是一侧"要变异才看得出来**（见对账件 §8.8.5）。');
    return;
  }

  if (process.argv.includes('--no-arm')) {
    for (const row of rows.filter((r) => r.kind === '无')) console.log(`  ${row.gate}`);
  } else {
    console.log('| 门禁 | 牙 | 脚本 |');
    console.log('|---|---|---|');
    for (const row of rows) console.log(`| \`${row.gate}\` | ${row.kind} | ${row.path ?? '—'} |`);
  }

  const judged = rows.length - rows.filter((r) => r.kind.startsWith('(')).length;
  console.log(
    `\n链里 \`check:*\` 共 **${rows.length}** 条；可判的 **${judged}** 条：` +
      `**自检 ${counts['自检']}** · **注释里的臂 ${counts['注释里的臂']}** · 🔴 **无 ${counts['无']}**`,
  );
  console.log(
    '⚠️ 这是**粗分类**：判"注释算不算臂"是语义判断。⚠️ 而且"自检"这一档说的是' +
      '**脚本里有那个入口**，不等于"每个臂都跑过" —— 要真知道，得跑它。',
  );
}

if (process.argv[1]?.endsWith('gate-teeth-census.mjs')) main();
