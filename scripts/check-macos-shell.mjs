/**
 * 门禁：**macOS 原生壳的跨语言那一层**。
 *
 * 与 `check-windows-shell.mjs` 同构：打包 TS 门面 → 跑那个平台上的无头冒烟。
 * 两个壳加载的是**同一个** bundle，所以这里顺带证明了"一份产物、多个原生壳"。
 *
 * ⚠️ 如实标注的三条边界：
 *   · 不是 macOS、或没有 `swift` → **显式报告"已跳过"**，不是假装通过；
 *   · 它**不验**窗口（窗口要图形会话；那条路由 `HEYTA_SELF_CAPTURE` 单独验）；
 *   · macOS 侧目前只有 14 条冒烟，**还没有**把 Windows 那条 50 条的
 *     原样契约在 JavaScriptCore 上重放。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'apps/desktop-macos');
const BUNDLE_SCRIPT = join(ROOT, 'packages/app-host/scripts/build-native-bridge.mjs');
const BUNDLE = join(ROOT, 'packages/app-host/bridge-bundle/native-bridge.js');

const has = (command, args = ['--version']) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

if (process.platform !== 'darwin') {
  console.log(`⚠️  当前平台是 ${process.platform} —— macOS 原生壳的冒烟**已跳过**。`);
  console.log('    （Package.swift 声明的是 macOS 14+；其它平台本来就构建不了。）');
  process.exit(0);
}

if (!has('swift')) {
  console.log('⚠️  未找到 `swift` —— macOS 原生壳的冒烟**已跳过**。');
  console.log('    ⇒ Swift ↔ TS 那一层这一轮**没有被验过**，不要当成"壳已经能跑"。');
  process.exit(0);
}

// ① 打包门面（与 Windows 门禁共用同一个脚本与产物）
const bundled = spawnSync(process.execPath, [BUNDLE_SCRIPT], { stdio: 'inherit', cwd: ROOT });
if (bundled.error || bundled.status !== 0) {
  console.error('❌ 打包 TS 门面失败');
  process.exit(bundled.status ?? 1);
}
if (!existsSync(BUNDLE)) {
  console.error(`❌ 打包脚本跑完了但产物不存在：${BUNDLE}`);
  process.exit(1);
}

// ② 无头冒烟。**继承 stdio**，让每条断言直接出现在门禁输出里。
const smoke = spawnSync('swift', ['run', 'heyta-smoke'], {
  stdio: 'inherit',
  cwd: PACKAGE_DIR,
  env: { ...process.env, HEYTA_BRIDGE_BUNDLE: BUNDLE },
});
if (smoke.error) {
  console.error(`❌ 冒烟没能启动：${smoke.error.message}`);
  process.exit(1);
}
process.exit(smoke.status ?? 1);
