#!/usr/bin/env node
/**
 * 移动端产物门禁：`react` 必须**只有一份**（android + ios 两端都查）。
 * ==================================================================
 *
 * 为什么需要这个门禁 —— 这是本仓库**第一个"门禁全绿、应用却根本打不开"的缺陷**。
 *
 * 2026-09-26 实测：`pnpm check` 退出码 0、十二道门禁全过、58 项领域测试全过，
 * 而装进模拟器的 release APK **一启动就崩**：
 *
 *     TypeError: Cannot read property 'useContext' of null
 *       at TasksScreen
 *
 * 根因不在任何一行业务代码，而在**依赖图里有两份 React**：
 *
 *     apps/mobile/node_modules/react    -> 19.2.3  （app 的依赖）
 *     packages/i18n/node_modules/react  -> 19.3.0  （i18n 的 devDependencies）
 *
 * `packages/i18n/dist/index.js` 位于**仓库根**下，Metro 从它出发逐级向上查找时
 * 命中 `packages/i18n/node_modules/react`，而**不是** `nodeModulesPaths` 里那两份
 * （`nodeModulesPaths` 是"找不到时才去的地方"）。于是 i18n 的 `useContext`
 * 来自 19.3.0、`TasksScreen` 的 hook 来自 19.2.3 —— 两个 React 各有各的 dispatcher，
 * i18n 那一侧就是 `null`。
 *
 * 🔴 **这一道门禁为什么必须看产物、不能看声明。**
 * 静态地查"某个包有没有自己的 react 目录"是查不出问题的 —— 那是 pnpm 的**正常**
 * 布局，每个 RN monorepo 都长这样，而真正决定行为的是**打包器最后装进去几份**。
 * 所以这里不查 `package.json`、不查符号链接，直接**打一份 bundle 数份数**。
 *
 * 🔴 **为什么两端都要查。** 修法在 `metro.config.js`，那是**共享**配置 ——
 * 但这不等于"改一处两端都对"：Metro 的解析图是**按平台**构建的（platform-specific
 * 文件、`.ios.js`/`.android.js`、以及各自的 `haste` 名），两端走进的模块集合并不相同。
 * 只查 android 的话，一个只在 ios 解析路径上出现的重复实例会**整个溜过去** ——
 * 而"只在 iOS 上崩"是移动端最难查的一类缺陷。实测两端目前都是 1 份。
 *
 * ⚠️ 刻意**不用** Hermes 字节码：字节码里搜不到这些字符串，门禁会变成永远通过。
 *    所以 `--dev false --minify false`，拿可读 JS（`--minify` 只影响可读性，不影响计数）。
 *
 * 判据来自实测：修复前 **2** 份，修复后 **1** 份；把修法临时改成直通则**又回到 2 份**。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'apps/mobile');

/** 必须逐端检查的平台。 */
const PLATFORMS = ['android', 'ios'];

/** 必须是单实例的说明符，以及它们在 RN 产物里的实现文件名。 */
const SINGLETONS = [
  { specifier: 'react', marker: 'react.production.js' },
  { specifier: 'react/jsx-runtime', marker: 'react-jsx-runtime.production.js' },
];

/** 列出 `packages/` 下的所有 workspace 包目录。 */
function listPackages() {
  const dir = path.join(ROOT, 'packages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'package.json')))
    .map((d) => path.join('packages', d.name));
}

/** 找出某个说明符在仓库里所有**可被解析到**的副本（用于报出根因）。 */
function findCopies(specifier) {
  const copies = [];
  for (const dir of ['apps/mobile', ...listPackages()]) {
    const rel = path.join(dir, 'node_modules', ...specifier.split('/'));
    const manifest = path.join(ROOT, rel, 'package.json');
    if (!existsSync(manifest)) continue;
    let version = '(版本读不出来)';
    try {
      version = JSON.parse(readFileSync(manifest, 'utf8')).version;
    } catch {
      /* 读不出来就保留占位符，不要因为一个次要信息让门禁自己崩掉 */
    }
    copies.push(`        ${rel} -> ${version}`);
  }
  return copies;
}

/** 打一份某个平台的可读 bundle，返回内容。失败时抛错。 */
function buildBundle(platform) {
  const out = path.join(tmpdir(), `heyta-bundle-${platform}-${process.pid}.js`);
  try {
    execFileSync(
      'npx',
      [
        'react-native',
        'bundle',
        '--platform',
        platform,
        '--dev',
        'false',
        '--minify',
        'false',
        '--entry-file',
        'index.js',
        '--bundle-output',
        out,
      ],
      { cwd: MOBILE, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (e) {
    const stderr = String(e.stderr ?? '');
    throw new Error(
      `打包失败（${platform}）—— 门禁**没能运行**，这不是通过。\n` +
        stderr.split('\n').slice(-20).map((l) => `   ${l}`).join('\n'),
    );
  }

  if (!existsSync(out)) {
    throw new Error(`打包命令（${platform}）退出码为 0，但产物文件不存在 —— 「成功」是假的。`);
  }

  const text = readFileSync(out, 'utf8');
  const sizeMb = (statSync(out).size / 1024 / 1024).toFixed(1);
  rmSync(out, { force: true });
  return { text, sizeMb };
}

// ── 前置检查：门禁无法运行时必须**报错**，不能静默跳过 ───────────────────────────
if (!existsSync(path.join(MOBILE, 'node_modules'))) {
  console.error('⛔ apps/mobile/node_modules 不存在 —— 先 `pnpm install`。');
  console.error('   （门禁无法运行 ≠ 门禁通过。这里刻意报错而不是跳过。）');
  process.exit(1);
}

/** @type {{ platform: string, specifier: string, count: number }[]} */
const problems = [];

for (const platform of PLATFORMS) {
  console.log(`   正在打包 ${platform} bundle（用来数 React 份数，约 1–2 分钟）…`);

  let built;
  try {
    built = buildBundle(platform);
  } catch (e) {
    console.error(`⛔ ${e.message}`);
    process.exit(1);
  }

  for (const { specifier, marker } of SINGLETONS) {
    // 用 split 计数：marker 里含 `.`，走正则要转义，split 更不容易写错。
    const count = built.text.split(marker).length - 1;
    if (count === 1) {
      console.log(`   ✅ [${platform}] ${specifier} 只有 1 份`);
      continue;
    }
    problems.push({ platform, specifier, count });
  }

  console.log(`   ℹ️  [${platform}] 产物 ${built.sizeMb} MB（已清理）`);
}

if (problems.length > 0) {
  console.error('');
  console.error('🔴 移动端产物里有多份 React —— **应用会一启动就崩**：');
  console.error('');
  for (const { platform, specifier, count } of problems) {
    console.error(`   ❌ [${platform}] ${specifier} 出现了 **${count}** 份（必须是 1 份）`);
    const copies = findCopies(specifier);
    if (copies.length > 0) {
      console.error('      候选来源：');
      for (const line of copies) console.error(line);
    }
  }
  console.error('');
  console.error("   症状（实测）：`TypeError: Cannot read property 'useContext' of null`");
  console.error('   修法：`apps/mobile/metro.config.js` 的 `resolveRequest` 把');
  console.error('         react / react/jsx-runtime / react/jsx-dev-runtime 钉成单实例。');
  console.error('   ⚠️ `extraNodeModules` **修不了** —— 它只是解析失败时的兜底，');
  console.error('      而包自己那份**存在**，正常解析会成功，兜底根本不触发。');
  console.error('');
  process.exit(1);
}

console.log(`   ✅ 移动端 bundle 单实例检查通过（已检查 ${PLATFORMS.join(' + ')}）`);
