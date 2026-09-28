/**
 * 门禁：**Windows 原生壳的跨语言那一层**。
 *
 * 壳里最容易错的不是 XAML，而是 C# ↔ TS 之间那一层：同步 SqliteDriver、
 * `?` → `$pN` 翻译、Jint 的微任务泵、JSON 编组、以及"和 facade 的契约对不对得上"。
 * 这些**一点 Windows API 都不需要** —— 所以它们能在这里被验，而不必等一台 Windows。
 * 这是把 `Heyta.Windows.Core` 拆成 `net10.0` 的全部理由（见 apps/desktop-windows/README.md §1）。
 *
 * 它做两件事：
 *   1. 打包 TS 门面（`packages/app-host/src/native-bridge.ts` → `bridge-bundle/native-bridge.js`）
 *      —— 顺带证明那份门面**打得出来**（`--platform=neutral` 下很多包会解析失败，
 *      实测 `hash-wasm` 就是：它只有 `main`，而 neutral 默认不理 `main`）。
 *   2. 跑无头冒烟（开库 / 建任务 / 排序 / 完成态 / 错误过边界 / **重开仍落盘** / 软删除）。
 *
 * ⚠️ 两条如实标注的边界：
 *   · 机器上没有 `dotnet` 时**显式报告"已跳过"**，不是假装通过
 *     （`ci-and-runner.md` §8.1「看着在跑，其实什么都没验」那一类坑）。
 *   · 它**不验**窗口、不验 XAML、不验打包与签名 —— 那些需要真 Windows 桌面会话。
 *     别把"绿"读成"壳能用"。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_SCRIPT = join(ROOT, 'packages/app-host/scripts/build-native-bridge.mjs');
const BUNDLE = join(ROOT, 'packages/app-host/bridge-bundle/native-bridge.js');
const SMOKE_PROJECT = join(ROOT, 'apps/desktop-windows/smoke/Smoke.csproj');

const hasDotnet = () => {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

if (!hasDotnet()) {
  console.log('⚠️  未找到 `dotnet` —— Windows 原生壳的跨语言冒烟**已跳过**。');
  console.log('    ⇒ C# ↔ TS 那一层这一轮**没有被验过**，不要当成"壳已经能跑"。');
  process.exit(0);
}

process.env.DOTNET_CLI_TELEMETRY_OPTOUT ??= '1';
process.env.DOTNET_NOLOGO ??= '1';
process.env.HEYTA_BRIDGE_BUNDLE ??= BUNDLE;

// ① 打包门面
const bundled = spawnSync(process.execPath, [BUNDLE_SCRIPT], { stdio: 'inherit', cwd: ROOT });
if (bundled.error || bundled.status !== 0) {
  console.error('❌ 打包 TS 门面失败');
  process.exit(bundled.status ?? 1);
}
if (!existsSync(BUNDLE)) {
  console.error(`❌ 打包脚本跑完了但产物不存在：${BUNDLE}`);
  process.exit(1);
}

// ② 无头冒烟。**继承 stdio**，让每条断言直接出现在门禁输出里 ——
//    捕获再打印的话，失败时人只看到 exit 1，看不到是哪一条、期望什么、实得什么。
const smoke = spawnSync('dotnet', ['run', '-c', 'Release', '--project', SMOKE_PROJECT], {
  stdio: 'inherit',
  cwd: ROOT,
});
if (smoke.error) {
  console.error(`❌ 冒烟没能启动：${smoke.error.message}`);
  process.exit(1);
}
process.exit(smoke.status ?? 1);
