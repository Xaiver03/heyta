/**
 * 桌面端打包（M2-4）
 * ==================
 *
 * 产出三平台**可分发的应用包**，输出到 `release/`：
 *
 *   darwin-arm64  →  heyta-darwin-arm64/heyta.app
 *   win32-x64     →  heyta-win32-x64/heyta.exe
 *   linux-x64     →  heyta-linux-x64/heyta
 *
 * 用法：
 *   node scripts/package-desktop.mjs                # 三平台全打
 *   node scripts/package-desktop.mjs darwin         # 只打 macOS（迭代时用）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么用 `@electron/packager` 而不是 `electron-builder`
 * ─────────────────────────────────────────────────────────────
 * 两者都在维护、许可证都宽松（packager：BSD-2-Clause；builder：MIT）。
 * 选 packager 的理由是**它做的是"应用包"这件核心的事**：
 * 一条命令交叉产出三平台可运行的应用，且**在 macOS 上就能全部跑完**，
 * 于是"三平台产包"这句话是**当场可验证**的（`--verify` 会真的启动 macOS 包）。
 *
 * 而 `electron-builder` 额外提供的是**安装器**（dmg/nsis/AppImage）、
 * **签名/公证**、自动更新 —— 这些当前**一个都做不了**，因为仓库没有
 * Apple Developer ID 与 Windows 代码签名证书。引入一个用不上其核心能力的
 * 重依赖，只会让 `pnpm check` 变慢、让依赖面变大。
 *
 * 🔴 因此本脚本**明确不覆盖**：签名、公证、安装器、自动更新。
 * 那一步的形状已经定好（见 `docs/runbooks/desktop.md`），等证书到位再做 ——
 * 而不是现在假装做了。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么打包这么简单：产物是**自包含**的
 * ─────────────────────────────────────────────────────────────
 * `tsup.config.ts` 里 `noExternal: [/^@heyta\//]` 把工作区依赖全打进了
 * `main.cjs`，所以打包**不需要带 `node_modules`**。
 *
 * ⚠️ 这不是"顺手做的小优化"，而是**绕开了 pnpm + Electron 打包的经典死结**：
 * pnpm 用符号链接 + 嵌套 `node_modules`，打包器复制过去的是一堆断链的
 * symlink，运行时 `MODULE_NOT_FOUND`。通行解法只有两个 ——
 * 打成自包含，或者改用 `node-linker=hoisted`（会把整个仓库的依赖布局改掉，
 * 影响所有人）。这里选前者。
 */

import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DESKTOP = join(ROOT, 'apps', 'desktop');
const OUT = join(ROOT, 'release');

/**
 * 🔴 从 `apps/desktop` 出发解析 `@electron/packager`，不能用普通的 `import`。
 *
 * 它是 `apps/desktop` 的 devDependency，而 pnpm **不做幽灵依赖提升**：
 * 包只出现在 `apps/desktop/node_modules/` 下。本文件住在根 `scripts/`，
 * 按常理解析会落到根 `node_modules`（那里没有它），报
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@electron/packager'` ——
 * 而那个报错看起来像"没装"，实际是"解析起点不对"。
 */
const require = createRequire(join(DESKTOP, 'package.json'));
const { packager } = require('@electron/packager');

/** 应用名。会变成 `heyta.app` / `heyta.exe` / `heyta`。 */
const APP_NAME = 'heyta';

/**
 * 三平台目标。
 *
 * ⚠️ `arch` 是**显式写死**的，不写 `'all'`：
 * `'all'` 会把 ia32/armv7l 之类的老架构一起拉下来（每个 ~100MB 且没人用），
 * 让打包时间与磁盘占用翻好几倍。
 */
const TARGETS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
];

/**
 * 打包时**不复制**的东西。
 *
 * 🔴 必须显式忽略，不能靠"打包器会自己判断"：
 * `renderer/` 是 TSX **源码**（Chromium 不认识），带进去除了让包变大没别的作用；
 * `node_modules/` 更关键 —— 产物自包含，带上它等于把 pnpm 的符号链接
 * 原样搬过去（正是上面要绕开的死结）。
 *
 * ⚠️ `/^\/renderer\//` 结尾有斜杠，所以**不会**误伤 `renderer-dist/`。
 */
const IGNORE = [
  /^\/node_modules$/,
  /^\/src$/,
  /^\/renderer$/,
  /^\/tests$/,
  /^\/release$/,
  /^\/tsconfig.*\.json$/,
  /**
   * ⚠️ 用 `.*\.config\.ts$` 一次盖住 `vite.config.ts` / `tsup.config.ts` /
   * `vitest.config.ts`。第一版只写了 `^\/vite\.config\.ts$`，结果
   * 另外两个**静默进了包**（`asar list` 里看得到）—— 它们不影响运行，
   * 所以没有任何检查会抱怨，只是白白把构建配置发给了用户。
   */
  /\/[^/]*\.config\.ts$/,
  /^\/\.vite/,
  // sourcemap 是给开发调试的，不进分发产物（main.cjs.map 有 3MB）。
  /\.map$/,
];

function assertBuilt() {
  const needed = [
    join(DESKTOP, 'dist', 'main.cjs'),
    join(DESKTOP, 'dist', 'preload.cjs'),
    join(DESKTOP, 'renderer-dist', 'index.html'),
  ];
  const missing = needed.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error('🔴 产物不全，先跑 `pnpm --filter @heyta/desktop run build`：');
    for (const file of missing) console.error(`   · ${file.replace(`${ROOT}/`, '')}`);
    process.exit(1);
  }
}

/** 每个平台产物的**可执行文件**该在哪。 */
function executableOf(platform) {
  const dir = join(OUT, `heyta-${platform}-${platform === 'darwin' ? 'arm64' : 'x64'}`);
  if (platform === 'darwin') return join(dir, 'heyta.app', 'Contents', 'MacOS', 'heyta');
  if (platform === 'win32') return join(dir, 'heyta.exe');
  return join(dir, 'heyta');
}

/**
 * 🔴 打完包**必须逐个确认可执行文件真的存在**。
 *
 * 加这一条是因为**真的漏过一次**：一次三平台打包里 linux 没产出，
 * 而当时我看到的"成功"是假的 —— 退出码来自管道的最后一环（`tail`），
 * 不是 `node`。于是"打包成功"和"少了一个平台"同时成立，**没有任何东西会报错**。
 *
 * ⚠️ 教训分两层：
 * 1. 脚本自己要把产物验掉，不能指望调用者去看目录；
 * 2. **`node … | tail` 的退出码是 `tail` 的** —— 关心成败时别接管道，
 *    或者接 `set -o pipefail`。这一条对任何"看起来像过了"的检查都适用。
 */
function assertArtifacts(targets) {
  const missing = targets.map((t) => executableOf(t.platform)).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error('\n🔴 打包器报了成功，但产物不存在：');
    for (const file of missing) console.error(`   · ${file.replace(`${ROOT}/`, '')}`);
    console.error('   打包器的退出码不为 0 通常说明下载/复制失败 —— 往上翻它的输出。');
    process.exit(1);
  }
}

async function main() {
  const only = process.argv[2];
  const targets = only === undefined ? TARGETS : TARGETS.filter((t) => t.platform === only);

  if (targets.length === 0) {
    console.error(`🔴 未知平台：${only}。可选：${TARGETS.map((t) => t.platform).join(' / ')}`);
    process.exit(1);
  }

  assertBuilt();

  // 清掉上一次的产物：否则"改了代码但包没变"会让人以为改动生效了。
  if (only === undefined) rmSync(OUT, { recursive: true, force: true });

  const built = [];
  for (const { platform, arch } of targets) {
    const label = `${platform}-${arch}`;
    console.log(`📦 打包 ${label} …`);
    const paths = await packager({
      dir: DESKTOP,
      out: OUT,
      name: APP_NAME,
      platform,
      arch,
      overwrite: true,
      asar: true,
      prune: true,
      ignore: IGNORE,
      appVersion: '0.0.0',
      /**
       * ⚠️ 不设 `icon`：仓库里还没有桌面端图标（那是设计系统的活）。
       * 设一个不存在的路径会让打包器直接报错，而不是"用默认图标"。
       */
    });
    built.push(...paths);
  }

  assertArtifacts(targets);

  console.log('\n✅ 打包完成：');
  for (const path of built) console.log(`   ${path.replace(`${ROOT}/`, '')}`);
}

await main();
