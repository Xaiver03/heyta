/**
 * spike 的打包助手 —— 用 esbuild 的 **JS API**，而不是它的 CLI。
 *
 * 🔴 为什么不能调 esbuild CLI（这一条是被干净检出抓出来的）：
 *
 *   脚本原先写死了 `packages/domain/node_modules/.bin/esbuild`。**主仓库里那个链接是
 *   历史遗留的陈旧状态** —— `packages/domain/package.json` 从来没声明过 esbuild
 *   （它是 `tsup` 的依赖）。于是全新 `pnpm install` 出来的树里
 *   **那个路径根本不存在**，脚本报 "找不到 esbuild" 并 exit 1。
 *
 *   后果有多严重：`check:crosslang-contract` 已接进 `pnpm check`，
 *   所以**门禁在 CI 上必红**，而本机一直绿 —— 正是本仓库反复记录的那类坑。
 *   抓出它的是"在干净检出的 git worktree 里跑一遍完整 pnpm check"。
 *
 * 解法：从**声明了 esbuild 的那个包**（tsup）去解析它，走 JS API 直接 build，
 * 于是既不需要 `.bin` 链接、也不需要猜 pnpm 的目录布局。
 *
 * 用法：
 *   node research/tools/bundle-spike.mjs --entry <file> --out <file> --global <name> \
 *        [--alias <pkg>=<path>]...
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 解析 esbuild 的**包目录**，返回它导出的模块。
 *
 * 🔴 实测（两棵树都查过）：`esbuild` **不是任何 package.json 的直接依赖**，
 *    也不在 `packages/domain/node_modules/` 下，**连从 tsup 的 package.json 都解析不到**
 *    （`createRequire(tsup/package.json).resolve('esbuild')` → MODULE_NOT_FOUND）。
 *    它实际只存在于两处：
 *      · `node_modules/.pnpm/node_modules/esbuild`（pnpm 的 hoist 目录）
 *      · `node_modules/.pnpm/esbuild@<版本>/node_modules/esbuild`（虚拟仓里的真身）
 *
 *    主仓库里那个 `packages/domain/node_modules/.bin/esbuild` 是**陈旧链接** ——
 *    它骗过了第一版脚本，也让"本机绿、干净检出红"这件事一直没被发现。
 */
const loadEsbuild = () => {
  const tried = [];
  const candidates = [];

  // ① 最正常的一条路：根 package.json 能解析到（现在解析不到，但保留以备将来声明它）
  try {
    candidates.push(createRequire(join(ROOT, 'package.json')).resolve('esbuild'));
  } catch (error) {
    tried.push(`根 package.json 解析 → ${error.code ?? error.message}`);
  }

  // ② pnpm 的 hoist 目录
  candidates.push(join(ROOT, 'node_modules/.pnpm/node_modules/esbuild'));

  // ③ pnpm 虚拟仓里按版本号找 —— 这一条最稳，不依赖 hoist 配置
  try {
    for (const entry of readdirSync(join(ROOT, 'node_modules/.pnpm'))) {
      if (entry.startsWith('esbuild@')) {
        candidates.push(join(ROOT, 'node_modules/.pnpm', entry, 'node_modules/esbuild'));
      }
    }
  } catch (error) {
    tried.push(`读 node_modules/.pnpm → ${error.code ?? error.message}`);
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      tried.push(`${candidate}（不存在）`);
      continue;
    }
    try {
      return createRequire(join(ROOT, 'package.json'))(candidate);
    } catch (error) {
      tried.push(`${candidate} → ${String(error.message).split('\n')[0]}`);
    }
  }

  throw new Error(
    `解析不到 esbuild。试过：\n  ${tried.join('\n  ')}\n` +
      '先在仓库根跑一次：pnpm install --store-dir .pnpm-store',
  );
};

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const valuesOf = (flag) =>
  args.reduce((found, arg, index) => (arg === flag ? [...found, args[index + 1]] : found), []);

const entry = valueOf('--entry');
const out = valueOf('--out');
const globalName = valueOf('--global');
if (!entry || !out || !globalName) {
  throw new Error('用法：node bundle-spike.mjs --entry <file> --out <file> --global <name> [--alias pkg=path]...');
}

const alias = Object.fromEntries(
  valuesOf('--alias').map((pair) => {
    const at = pair.indexOf('=');
    if (at < 0) throw new Error(`--alias 要写成 pkg=path，收到：${pair}`);
    return [pair.slice(0, at), resolve(pair.slice(at + 1))];
  }),
);

const esbuild = loadEsbuild();

await esbuild.build({
  entryPoints: [resolve(entry)],
  outfile: resolve(out),
  bundle: true,
  format: 'iife',
  globalName,
  // 🔴 `neutral` 是关键：esbuild 不会替我们补 process/Buffer 之类的垫片，
  //    于是"bundle 需要宿主能力"这件事在**构建期**就暴露，而不是留到引擎里才炸。
  platform: 'neutral',
  // 🔴 **`neutral` 平台默认 `mainFields: []` —— 也就是完全不理 `main`。**
  //    实测代价：`sync-core` 依赖 `hash-wasm`，而后者**只有 `main`**
  //    （`"main": "dist/index.umd.js"`，没有 `module` / `exports`），
  //    于是构建报 `Could not resolve "hash-wasm"`。
  //    那个报错看着像"缺依赖"，其实是"解析规则没配" —— 能跑在 Node 里的包
  //    在这个 bundle 里就是进不来。必须显式给 mainFields / conditions。
  mainFields: ['module', 'main'],
  conditions: ['import', 'module', 'default'],
  target: 'es2020',
  ...(Object.keys(alias).length > 0 ? { alias } : {}),
  logLevel: 'warning',
});

console.log(`  esbuild：${entry} → ${out}${Object.keys(alias).length > 0 ? `（alias ${Object.keys(alias).join(', ')}）` : ''}`);
