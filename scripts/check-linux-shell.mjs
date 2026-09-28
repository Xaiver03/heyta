/**
 * 门禁：**Linux 原生壳的跨语言那一层**。
 *
 * 与 `check-windows-shell.mjs` / `check-macos-shell.mjs` 同构：
 * 打包 TS 门面 → 编译 → 跑那个平台上的无头冒烟。
 * **三个壳加载的是同一个 bundle** ⇒ 顺带证明了"一份产物、多个原生壳"。
 *
 * ⚠️ 如实标注的两条边界：
 *   · 非 Linux → **显式报告"已跳过"**（GTK4 / libjavascriptcoregtk 在 macOS/Windows 上装不上）；
 *   · 它**不验**窗口 —— 窗口那条路要 Xvfb，见 apps/desktop-linux/README.md §4。
 *     这一条是刻意分开的：冒烟要在**没有 X 的服务器**上也能跑。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'apps/desktop-linux');
const BUNDLE_SCRIPT = join(ROOT, 'packages/app-host/scripts/build-native-bridge.mjs');
const BUNDLE = join(ROOT, 'packages/app-host/bridge-bundle/native-bridge.js');

if (process.platform !== 'linux') {
  console.log(`⚠️  当前平台是 ${process.platform} —— Linux 原生壳的冒烟**已跳过**。`);
  console.log('    （本壳依赖 GTK4 与 libjavascriptcoregtk-4.1，装不到 macOS/Windows 上。）');
  process.exit(0);
}

const hasPkgConfig = (name) => {
  try {
    execFileSync('pkg-config', ['--exists', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

for (const pkg of ['gtk4', 'javascriptcoregtk-4.1', 'sqlite3']) {
  if (!hasPkgConfig(pkg)) {
    console.log(`⚠️  缺少 \`${pkg}\` 的 pkg-config 条目 —— Linux 原生壳的冒烟**已跳过**。`);
    console.log('    sudo apt-get install -y build-essential pkg-config \\');
    console.log('        libgtk-4-dev libjavascriptcoregtk-4.1-dev libsqlite3-dev');
    console.log('    ⇒ C ↔ TS 那一层这一轮**没有被验过**，不要当成"壳已经能跑"。');
    process.exit(0);
  }
}

// ① 打包门面（三个壳的门禁共用同一个脚本与产物）
const bundled = spawnSync(process.execPath, [BUNDLE_SCRIPT], { stdio: 'inherit', cwd: ROOT });
if (bundled.error || bundled.status !== 0) {
  console.error('❌ 打包 TS 门面失败');
  process.exit(bundled.status ?? 1);
}
if (!existsSync(BUNDLE)) {
  console.error(`❌ 打包脚本跑完了但产物不存在：${BUNDLE}`);
  process.exit(1);
}

// ② 编译（-Werror：警告即失败，与仓库其它端一致）
const build = spawnSync('make', ['heyta-smoke'], { stdio: 'inherit', cwd: PACKAGE_DIR });
if (build.error || build.status !== 0) {
  console.error('❌ 编译 Linux 壳失败');
  process.exit(build.status ?? 1);
}

// ③ 无头冒烟。**继承 stdio**，让每条断言直接出现在门禁输出里。
const smoke = spawnSync(join(PACKAGE_DIR, 'heyta-smoke'), [], {
  stdio: 'inherit',
  cwd: PACKAGE_DIR,
  env: { ...process.env, HEYTA_BRIDGE_BUNDLE: BUNDLE },
});
if (smoke.error) {
  console.error(`❌ 冒烟没能启动：${smoke.error.message}`);
  process.exit(1);
}
process.exit(smoke.status ?? 1);
