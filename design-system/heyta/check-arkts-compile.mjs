#!/usr/bin/env node
/**
 * ArkTS 产物**编译器**门禁
 * ========================
 *
 * 编译 `packages/design-system/generated/HeytaTokens.ets`，用**真正的 ArkTS 编译器**
 * （`es2abc` / es2panda，随 DevEco Studio 分发）。
 *
 * 🔴 为什么需要独立门禁，而不是靠已有的两道
 *
 * 1. `generate:check`（check:tokens）只比对**文件与生成器是否一致**。
 *    生成器稳定产出非法代码时，两者依然一致 → 它退出 0。**原理上查不到这类 bug。**
 * 2. `tests/generated.spec.ts` 里的 TypeScript 解析器兜底只证明**语法**能被 TS 解析。
 *    ArkTS 是 TS 的**方言**，TS 解析器不等于 ArkTS 编译器。
 *
 * 这道门禁做的是前两者都做不到的事：拿**目标平台的编译器**去编译。
 *
 * 已实测（2026-09-25，DevEco Studio 6.1.1.300 / SDK API 24）：
 *   - 合法产物 → exit 0，产出 9596 字节、`PANDA` magic 开头的 .abc 字节码
 *   - `export const X string = ...`（缺冒号）→ exit 1 `SyntaxError: Missing initializer`
 *   - `export const X: string = const;`         → exit 1 `SyntaxError: Primary expression expected`
 *
 * ⚠️ **诚实说明它能证明什么**：它验证的是**语法/编译**，不是 ArkTS 语义合规，
 * 也没有解析 `@ohos` 导入或 `Color` 资源类型 —— 当前产物只声明常量。
 * 鸿蒙端真正落地时，必须在真工程里编译整个应用。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SOURCE = join(REPO, 'packages/design-system/generated/HeytaTokens.ets');

/** es2abc 的候选位置。DevEco 的安装路径不固定，所以给出环境变量 + 常见位置。 */
const CANDIDATES = [
  process.env.HEYTA_ES2ABC,
  process.env.DEVECO_HOME &&
    join(
      process.env.DEVECO_HOME,
      'sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build-mac/bin/es2abc',
    ),
  '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build-mac/bin/es2abc',
  '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build-linux/bin/es2abc',
  '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build-win/bin/es2abc.exe',
].filter(Boolean);

const es2abc = CANDIDATES.find((p) => existsSync(p));

if (!es2abc) {
  // 刻意选择「响亮地跳过」而不是失败：CI 上没有 DevEco Studio，
  // 但**绝不能**让它看起来像验证过了 —— 所以必须明确说出没验证什么。
  console.log('\n⚠️  跳过 ArkTS 编译验证：找不到 es2abc（ArkTS 编译器）。');
  console.log('   这意味着 **HeytaTokens.ets 的语法未被编译器验证**。');
  console.log('   装了 DevEco Studio 的机器上会自动启用；也可用 HEYTA_ES2ABC 指定路径。');
  console.log('   候选位置：');
  for (const c of CANDIDATES) console.log(`      ${c}`);
  console.log('');
  process.exit(0);
}

if (!existsSync(SOURCE)) {
  console.log(`\n🔴 找不到 ArkTS 产物：${SOURCE}`);
  console.log('   先跑 `pnpm check:tokens` 的生成步骤。\n');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'heyta-arkts-'));
// es2abc 的 --extension 只接受 js/ts/as/abc，不接受 ets。
// 当前产物只含常量声明（无 @ohos 装饰器），因此按 ts 编译是等价的。
// 🔴 产物一旦开始使用 ArkTS 特有语法（装饰器、struct），这条路就不再等价，
//    必须改用 hvigor 在真工程里编译 —— 那时这里要一并修改。
const staged = join(work, 'HeytaTokens.ts');
copyFileSync(SOURCE, staged);

try {
  execFileSync(es2abc, ['--module', '--extension=ts', `--output=${join(work, 'out.abc')}`, staged], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
} catch (err) {
  console.log('\n🔴 ArkTS 编译器拒绝了生成的产物：\n');
  const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  for (const line of detail.split('\n').slice(0, 12)) console.log(`   ${line}`);
  console.log(`\n   编译器：${es2abc}`);
  console.log(`   源文件：${SOURCE}`);
  console.log('   这不只是测试红了 —— 鸿蒙端会**编译不过**。修生成器，不要修检查。\n');
  process.exit(1);
}

console.log(`\n✅ ArkTS 产物通过真实编译器（${es2abc.includes('build-mac') ? 'macOS' : 'lib'} es2abc）。\n`);
