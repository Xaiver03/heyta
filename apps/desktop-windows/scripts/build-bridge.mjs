#!/usr/bin/env node
/**
 * 把 TS 侧的宿主门面打成 C# 侧要加载的那一个 JS 文件。
 *
 *   node apps/desktop-windows/scripts/build-bridge.mjs
 *
 * 🔴 **必须在仓库根跑**（脚本自己会 cd 到根不现实，所以它只解析仓库根路径）。
 *    入口是 `packages/app-host/src/windows-bridge.ts` —— 放在那个包里是有原因的
 *    （见该文件头部：facade 要解析 `@heyta/*`，而 `apps/desktop-windows` 不是
 *     workspace 包，它下面没有 node_modules）。
 *
 * 产物 `assets/app-bridge.js` **不入库**：它是构建产物。
 * C# 工程的 MSBuild target 会在缺它时**明确报错**，而不是等运行时白屏。
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ENTRY = join(ROOT, 'packages/app-host/src/windows-bridge.ts');
const OUT = join(HERE, '..', 'assets', 'app-bridge.js');

const result = spawnSync(
  process.execPath,
  [
    join(ROOT, 'research/tools/bundle-spike.mjs'),
    '--entry', ENTRY,
    '--out', OUT,
    '--global', 'HeytaApp',
  ],
  { stdio: 'inherit', cwd: ROOT },
);

if (result.error) {
  console.error(`❌ 打包失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
