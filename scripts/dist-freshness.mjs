#!/usr/bin/env node
/**
 * 产物新鲜度体检（**诊断，不是门禁**）。
 *
 * ## 为什么要有它
 *
 * 判据读的共享包产物是 `packages/<pkg>/dist/index.js`（`package.json` 的 `main` 就指那里，
 * vite / vitest / node-host 都从那里取），所以「源码改了、dist 没重建」会让**任何**一条
 * 读 dist 的判据对着旧代码打分。AGENTS §7 第 27 条那一族已经为它付过三次学费
 * （APK 里旧 bundle、Windows 装了旧树、.app 没打 web-dist），但那些都是**打包**环节；
 * 本机判据这一侧此前没有一句"你现在读的是哪一份"。
 *
 * 本轮（2026-10-03）它照出的东西最具体：一条 e2e 用例在 20:1x 确定性地红（刷新之后落到
 * 「无法初始化本地存储」的崩溃屏），而 21:0x 同一批 20 条全绿。两趟之间现量到
 * `packages/op-log/dist/index.js` 在 **21:00:41 被重建**。也就是说红的那一趟跑在
 * "新 storage 产物 + 旧 op-log 产物"这种**任何一次提交都不存在的组合**上。
 * 这条命令就是把那个组合变成一眼可读的东西。
 *
 * ## 为什么它不是门禁
 *
 * 21:0x 现量：`app-host` 落后 322 秒、`domain` 落后 2332 秒、`op-log` 落后 155 秒 ——
 * 三条全是因为**并行会话正在改它们的源码**，此刻完全正常。
 * 一条天生红的门禁等于没有门禁（AGENTS §8.3），而把它接进 `pnpm check` 会让别人
 * 每次提交都撞上不是自己造成的红。所以这里默认**永远 exit 0**，只打印矩阵；
 * 要它判定就显式传 `--strict`（那才是"我要为一个具体读数负责"的时刻）。
 *
 * ## 用法
 *
 *   node scripts/dist-freshness.mjs            # 体检：打印每个包读到的 dist 与它落后的秒数
 *   node scripts/dist-freshness.mjs --strict   # 有 dist 落后于 src ⇒ exit 1
 *   node scripts/dist-freshness.mjs --only ui,storage   # 只看我这次判据真正消费的包
 *
 * `--only` 是刻意的：判据的适用范围应当由"谁消费了它"决定，而不是由目录列表决定 ——
 * 后者会把别人正在改的包也算成我的问题。
 *
 * 🔴 `--only` 里认的是 `packages/` 下的**目录名**（`ui`），也认 `package.json` 里的
 *    **规范包名**（`@heyta/ui`）—— 这两种写法指的是同一个包。名字两边都对不上的，
 *    **一律 exit 1**（不受"默认永远 exit 0"那条豁免）：那种情况下体检根本没跑，
 *    而它打印出来长得像"0 个落后 ⇒ 读的都是当前产物"。
 *    实测：2026-10-03 传了 `@heyta/ui` 这类规范包名（旧版本只认目录名）得到
 *    "5 个包 → 0 个包" 与一句假绿结论，而退出码是 0。
 *    一条会因为拼错而**缩小范围**的参数必须响亮失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_EXTS = ['.ts', '.tsx', '.js', '.jsx'];

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const packagesDir = path.join(ROOT, 'packages');

/**
 * `--only` 的解析。目录名（`ui`）与规范包名（`@heyta/ui`）都认；**认不出的 exit 1**。
 *
 * 这里不受"默认永远 exit 0"那条豁免约束：那条豁免是给"落后但此刻正常"的，
 * 而参数没匹配上是**体检根本没跑**。它原来会打印 `0 个包` +
 * `落后于源码的产物：0 个（⇒ 本机判据读的都是当前产物）` 并退 0 ——
 * 一句范围被拼错缩成空的假绿。
 */
function resolveOnly(raw) {
  if (raw === undefined || raw.trim() === '') {
    console.error('✗ `--only` 后面要跟逗号分隔的包名，例如 `--only ui,storage`');
    process.exit(1);
  }
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const resolved = [];
  const unmatched = [];
  for (const token of tokens) {
    const candidate = token.startsWith('@heyta/') ? token.slice('@heyta/'.length) : token;
    if (fs.existsSync(path.join(packagesDir, candidate, 'src'))) {
      resolved.push(candidate);
    } else {
      unmatched.push(token);
    }
  }
  if (unmatched.length > 0) {
    console.error(
      `✗ --only 里有 ${unmatched.length} 个名字没匹配到 packages/ 下带 src 的包：${unmatched.join(', ')}\n` +
        `  可选的目录名：${fs.readdirSync(packagesDir).join(', ')}\n` +
        `  （规范包名 @heyta/<目录名> 也认。）\n` +
        `  🔴 不响亮失败的话这行会打印"0 个包 ⇒ 本机判据读的都是当前产物"并退 0。`,
    );
    process.exit(1);
  }
  return resolved;
}

const onlyFlagIndex = args.indexOf('--only');
const only = onlyFlagIndex === -1 ? null : resolveOnly(args[onlyFlagIndex + 1]);

/**
 * 取这个包**实际被消费的那个运行时入口文件**。
 *
 * 🔴 只看 `main` 会瞎：`@heyta/ui` 的 package.json **没有** `main`，只有
 * `exports['.'] = { types, import, require }`（21:0x 现量），而它恰好是本轮判据消费最多的包。
 * `types` 也不能当入口 —— 那是 `.d.ts`，运行时不读它，它新不代表 `dist/index.js` 新。
 */
function runtimeEntry(pkg) {
  const exp = pkg.exports?.['.'];
  if (typeof exp === 'string') return exp.replace(/^\.\//u, '');
  if (exp && typeof exp === 'object') {
    for (const condition of ['import', 'require', 'default']) {
      const value = exp[condition];
      if (typeof value === 'string') return value.replace(/^\.\//u, '');
    }
  }
  for (const field of ['module', 'main']) {
    if (typeof pkg[field] === 'string') return pkg[field].replace(/^\.\//u, '');
  }
  return undefined;
}

/** 取 `dir` 下最新那个源文件的 mtime（递归；跳过 `node_modules` 与 `dist`）。 */
function newestSource(dir) {
  let mtime = 0;
  let file = '';
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SRC_EXTS.some((ext) => entry.name.endsWith(ext))) {
        const t = fs.statSync(full).mtimeMs;
        if (t > mtime) {
          mtime = t;
          file = full;
        }
      }
    }
  };
  if (!fs.existsSync(dir)) return null;
  walk(dir);
  return file === '' ? null : { mtime, file };
}

const names = (
  only ??
  fs.readdirSync(packagesDir).filter((name) => fs.existsSync(path.join(packagesDir, name, 'src')))
).map((name) => path.join(packagesDir, name));

const rows = [];
for (const full of names) {
  const name = path.basename(full);
  const src = newestSource(path.join(full, 'src'));
  if (src === null) {
    rows.push({ name, verdict: 'no-src' });
    continue;
  }
  const entry = (() => {
    try {
      return runtimeEntry(JSON.parse(fs.readFileSync(path.join(full, 'package.json'), 'utf8')));
    } catch {
      return undefined;
    }
  })();
  if (typeof entry !== 'string') {
    rows.push({ name, verdict: 'no-runtime-entry' });
    continue;
  }
  const distIndex = path.join(full, entry);
  if (!fs.existsSync(distIndex)) {
    // 🔴 运行时入口指向的产物不存在 ⇒ 消费者会直接报错，这不是"落后"，是"缺"。
    rows.push({ name, verdict: 'dist-missing', distPath: entry });
    continue;
  }
  const distMtime = fs.statSync(distIndex).mtimeMs;
  const lagSeconds = Math.round((src.mtime - distMtime) / 1000);
  rows.push({
    name,
    verdict: lagSeconds > 0 ? 'stale' : 'ok',
    lagSeconds: Math.abs(lagSeconds),
    behind: lagSeconds > 0,
    newestSrc: path.relative(ROOT, src.file),
    distPath: entry,
  });
}

const stale = rows.filter((r) => r.verdict === 'stale');
const missing = rows.filter((r) => r.verdict === 'dist-missing');

console.log(
  `dist 新鲜度体检（${new Date().toISOString()}，${rows.length} 个包` +
    (only === null
      ? '：packages/ 下全部带 src 的包'
      : `：--only 请求 ${only.length} 个，命中 ${rows.length} 个`) +
    '）',
);
for (const row of rows) {
  if (row.verdict === 'stale') {
    console.log(
      `  🔴 ${row.name.padEnd(14)} 产物比源码旧 ${row.lagSeconds}s  —— src ${row.newestSrc} / dist ${row.distPath}`,
    );
  } else if (row.verdict === 'ok') {
    console.log(
      `  ✅ ${row.name.padEnd(14)} 产物比源码新 ${row.lagSeconds}s —— dist ${row.distPath}`,
    );
  } else if (row.verdict === 'dist-missing') {
    console.log(`  🔴 ${row.name.padEnd(14)} package.json 的 main 指向 ${row.distPath}，但那个文件不存在`);
  } else {
    console.log(`  ⚪ ${row.name.padEnd(14)} ${row.verdict}`);
  }
}

console.log('');
console.log(`落后于源码的产物：${stale.length} 个${stale.length === 0 ? '（⇒ 本机判据读的都是当前产物）' : ''}`);
console.log(`缺产物：${missing.length} 个`);
console.log(
  '⚠️ 并行会话正在改源码时"落后"是正常状态。本命令的意义是：在你为一条读 dist 的判据' +
    '负责之前，先确认它读的是哪一份 —— 要判定就传 --strict。',
);

if (strict && (stale.length > 0 || missing.length > 0)) {
  console.error('✗ --strict：有产物落后于源码，或有包的 main 指向的产物不存在');
  process.exit(1);
}
