#!/usr/bin/env node
/**
 * 薄封装。**实现只有一份**，在 Skill 里：
 *   .agents/skills/tencent-cloud-icp-app-filing/scripts/icp-app-filing-values.mjs
 *
 * 这里之所以不复制一份：备案值一旦出现两份实现就会漂移，
 * 而漂移的那一份会给出"看起来很可信"的错值 —— 这正是本仓库踩过的坑
 * （见 docs/operations/icp-app-filing.md）。所以保留一个方便的项目内入口即可。
 *
 *   node scripts/icp-app-filing-values.mjs
 *   node scripts/icp-app-filing-values.mjs --json
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const impl = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.agents/skills/tencent-cloud-icp-app-filing/scripts/icp-app-filing-values.mjs',
);

const result = spawnSync(process.execPath, [impl, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error(`🔴 找不到 Skill 里的实现：${impl}\n    ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
