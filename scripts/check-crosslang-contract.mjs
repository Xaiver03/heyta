/**
 * 门禁：**跨语言契约重放**（多端原生构建计划 §6 的那一条）。
 *
 * 它回答的问题：C# 侧（未来的 `apps/desktop-windows`）提供的同步存储驱动，
 * 到底有没有满足 `packages/storage` 的契约？
 *
 * 🔴 为什么不能只在 C# 侧"照着契约另写一套断言"：
 *    契约的全部价值在于"同一套断言跑遍所有实现"。另写一套，测的是**实现者的假设**，
 *    而不是接口本身 —— `packages/storage/tests/contract.spec.ts` 的文件头明令禁止。
 *    所以这里跑的是**原样的** `tests/contract/*.contract.ts`，
 *    靠 `--alias:vitest=<替身>` 送进引擎。
 *
 * ⚠️ 两条如实标注的边界：
 *    · 机器上没有 `dotnet` 时**显式报告"已跳过"**，不是假装通过
 *      （`ci-and-runner.md` §8.1「看着在跑，其实什么都没验」那一类坑）。
 *    · 当前跑的是 `research/spikes/sqlite-driver-csharp/` 这个 spike；
 *      `apps/desktop-windows` 落地后，这个脚本应当改指向那个工程（见脚本内注释）。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(ROOT, 'research/spikes/sqlite-driver-csharp/run.sh');

const hasDotnet = () => {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

if (!hasDotnet()) {
  console.log('⚠️  未找到 `dotnet` —— 跨语言存储契约重放**已跳过**。');
  console.log('    ⇒ C# 侧这一轮**没有被验过**，不要在报告里当成"契约已重放"。');
  process.exit(0);
}

if (!process.env.DOTNET_CLI_TELEMETRY_OPTOUT) {
  process.env.DOTNET_CLI_TELEMETRY_OPTOUT = '1';
}
process.env.DOTNET_NOLOGO = '1';
process.env.SQLITE_SPIKE_OUT ??= mkdtempSync(join(tmpdir(), 'heyta-crosslang-'));

// 🔴 用 spawnSync 而不是 execFileSync：要**继承 stdio**，让断言明细直接出现在门禁输出里。
//    捕获输出再打印的话，失败时人只看到"exit 1"，看不到是哪条断言、
//    期望什么、实得什么 —— 那正是契约最难写、最必须被看见的部分。
const outcome = spawnSync('bash', [RUNNER], { stdio: 'inherit', cwd: ROOT });

if (outcome.error) {
  console.error(`❌ 跨语言契约重放没能启动：${outcome.error.message}`);
  process.exit(1);
}

process.exit(outcome.status ?? 1);
