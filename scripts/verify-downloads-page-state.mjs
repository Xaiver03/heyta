#!/usr/bin/env node
/**
 * `verify:downloads-page-state` —— **两份清单各自会渲染成什么样**（A3 的单一读数）。
 * ==================================================================================
 *
 * ## 它回答的问题
 *
 * `/download` 那一页是**清单驱动**的（`release-manifest.json` → `downloads.ts` → 页面）。
 * 而同一个事实有**两份清单**：
 *
 * | 清单 | 谁在用 |
 * |---|---|
 * | 仓库快照 `apps/landing/src/site/release-manifest.json` | **站点构建时**读它 ⇒ **访客看到的就是它** |
 * | 桶里的 `latest/heyta/latest.json` | `gen-downloads.mjs` 从它抄出上面那份 ⇒ 它是上游 |
 *
 * 2026-10-16 实测：**这两份会渲染成相反的页面** —— 快照四端 `file-ready`（有按钮），
 * 桶那份四端 `pending`（没有按钮，因为它是 `-test` 批次、且四端的
 * `files.<端>.version` 一个都没有 ⇒ 回退到批次号 ⇒ `isStableChannel()` 判 false）。
 *
 * ⇒ 所以 A3 要拍的不是"哪个是 bug"，而是"**哪一份算数**"。本脚本把两份的**渲染结果**
 *    并排打出来，让那个决定有**唯一读数**。
 *
 * ## 🔴 它**不**因为"两份不同"就判红
 *
 * "两份不同"是 A3 的**待拍板状态**，不是缺陷 —— 红了就是在替业主拍板（见 B11/B15 的教训）。
 * 它只在**算不出来**时判红：读不到清单、找不到打包器、`resolveRows` 抛异常。
 * ⇒ "证明不了"不是"通过"（与 B14 那条"跳过 = 退出 0"反着写）。
 *
 * ## 为什么要把 `resolveRows` 真的跑一遍
 *
 * 那是**唯一的**真相源：页面状态由它决定，而它有几条容易写错的规则（回退、
 * `STABLE_VERSION` 三段式、`via` 分流）。在这里**重写一遍**那些规则，
 * 就等于**再开一个会漂的事实源** —— 本会话已经吃过好几次那个亏。
 * 所以本脚本用 esbuild 把 `downloads.ts` **即时打包**再跑（它自己会解析那份 JSON import）。
 *
 * ## 用法
 *
 *   node scripts/verify-downloads-page-state.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
const SNAPSHOT = join(ROOT, 'apps/landing/src/site/release-manifest.json');
const BUCKET_MANIFEST =
  'https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/latest.json';

/**
 * 找 esbuild 的**平台原生二进制**。
 *
 * ⚠️ 不要用 `node_modules/.pnpm/node_modules/.bin/esbuild` —— 那是个 **JS shim**，
 * 直接 `execFileSync` 它会得到 `SyntaxError: Invalid or unexpected token`
 * （2026-10-16 实测：它内部 require 的是原生二进制，node 却去编译了那个二进制）。
 * ⇒ 直接 glob 平台包。
 */
export function findEsbuild(nodeModules = join(ROOT, 'node_modules/.pnpm')) {
  if (!existsSync(nodeModules)) return undefined;
  const pkgs = readdirSync(nodeModules).filter((n) => n.startsWith('@esbuild+'));
  for (const pkg of pkgs) {
    const base = join(nodeModules, pkg, 'node_modules/@esbuild');
    if (!existsSync(base)) continue;
    for (const plat of readdirSync(base)) {
      const bin = join(base, plat, 'bin/esbuild');
      if (existsSync(bin)) return bin;
    }
  }
  return undefined;
}

/** 把一份清单算成 `{ 行: 状态 }`；抛异常由调用方处理。 */
export function resolveStates(esbuild, manifestPath, workdir) {
  const entry = join(workdir, 'entry.ts');
  const out = join(workdir, 'entry.mjs');
  writeFileSync(
    entry,
    `import { resolveRows } from ${JSON.stringify(join(ROOT, 'apps/landing/src/site/downloads.ts'))};\n` +
      `import { readFileSync } from 'node:fs';\n` +
      `const m = JSON.parse(readFileSync(${JSON.stringify(manifestPath)}, 'utf8'));\n` +
      `console.log(JSON.stringify(resolveRows(m).map((r) => [r.row.id, r.state])));\n`,
  );
  execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=error'], {
    encoding: 'utf8',
  });
  const raw = execFileSync(process.execPath, [out], { encoding: 'utf8' }).trim();
  return Object.fromEntries(JSON.parse(raw));
}

async function main() {
  const esbuild = findEsbuild();
  if (esbuild === undefined) {
    console.error(
      '🔴 找不到 esbuild 的平台原生二进制 —— 算不出页面状态。\n' +
        '   ⇒ **证明不了不是通过**：这条判据拒绝在"跑不动"的状态下报绿。',
    );
    process.exit(1);
  }

  const workdir = mkdtempSync(join(tmpdir(), 'heyta-page-state-'));
  try {
    const snapshotStates = resolveStates(esbuild, SNAPSHOT, workdir);

    let bucketStates;
    try {
      const res = await fetch(BUCKET_MANIFEST, { headers: { 'Cache-Control': 'no-cache' } });
      const bucketPath = join(workdir, 'bucket.json');
      writeFileSync(bucketPath, await res.text());
      bucketStates = resolveStates(esbuild, bucketPath, workdir);
    } catch (error) {
      console.error(`🔴 拉不到或算不出桶那份清单的页面状态：${String(error)}`);
      process.exit(1);
    }

    const ids = [...new Set([...Object.keys(snapshotStates), ...Object.keys(bucketStates)])];
    const label = { 'file-ready': '有按钮', pending: '没按钮（pending）', open: '打开即用', guide: '引导', none: '无', store: '商店' };

    console.log('| 行 | 仓库快照（**访客看到的就是它**） | 桶 `latest.json` |');
    console.log('|---|---|---|');
    for (const id of ids) {
      const a = snapshotStates[id] ?? '(缺)';
      const b = bucketStates[id] ?? '(缺)';
      const flag = a === b ? '' : ' ⚠️';
      console.log(`| ${id} | ${a}（${label[a] ?? '?'}）${flag} | ${b}（${label[b] ?? '?'}）${flag} |`);
    }
    const differing = ids.filter((id) => (snapshotStates[id] ?? '(缺)') !== (bucketStates[id] ?? '(缺)'));
    console.log('');
    console.log(
      differing.length === 0
        ? '✅ 两份清单渲染出**相同**的页面状态。'
        : `🔎 两份清单在 **${differing.length} 行**上给出不同状态：${differing.join(' / ')}。`,
    );
    console.log(
      '\n⚠️ 本判据**不**因为"两份不同"判红 —— 那是 A3 的**待拍板状态**，不是缺陷；' +
        '红了就等于替业主拍板。它只在**算不出来**时红。\n' +
        '   ⇒ A3 要拍的是：**哪一份算数**（(a) 往 `latest/` 重发 stable 批；(b) 页面按端解析"最新 stable"；' +
        '(c) 接受预发布占据 `latest/`）。',
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/* ── 自检：三臂 ─────────────────────────────────────────────────────── */

function selfTest() {
  const arms = [];

  // A 定位得到打包器（阳性对照：找不到它就什么都验不了）
  const found = findEsbuild();
  arms.push(['A 找得到 esbuild 的平台原生二进制', found !== undefined && existsSync(found)]);

  // B 🔴 找不到时必须**返回 undefined**（而不是抛出去被当成别的错）——
  //    `main()` 靠这个分支报"证明不了不是通过"。
  arms.push(['B 在不存在的目录里找不到 ⇒ 返回 undefined', findEsbuild('/nonexistent-pnpm-dir') === undefined]);

  // C 🔴 清单坏了必须**抛**（而不是静默返回空状态）—— 空状态会被读成"这一行没问题"。
  let threw = false;
  const work = mkdtempSync(join(tmpdir(), 'heyta-page-state-selftest-'));
  try {
    const bad = join(work, 'bad.json');
    writeFileSync(bad, 'not json');
    resolveStates(found, bad, work);
  } catch {
    threw = true;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  arms.push(['C 清单不是 JSON ⇒ 抛（空状态不许被读成"通过"）', threw]);

  let failures = 0;
  for (const [label, ok] of arms) {
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    if (!ok) failures += 1;
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else await main();
