#!/usr/bin/env node
/**
 * 鸿蒙小组件 · **ArkTS 编译器**门禁
 * =================================
 *
 * 用 DevEco 随附的**真编译器**（`es2abc` / es2panda）编译
 * `apps/mobile/harmony/entry/src/main/ets/widget/*.ts`。
 *
 * ## 🔴 为什么必须有这一道，而不是靠已有的测试
 *
 * `apps/mobile/tests/harmony-widget.spec.ts` 是拿 **Node/V8** 跑这些文件的
 * （34 条用例，全部对黄金夹具断言）。它证明的是**行为**，
 * 但它和"鸿蒙的 ArkTS 编译器收不收这份代码"**没有任何关系** ——
 * Node 能跑不等于 es2abc 能编（ArkTS 是 TS 的**方言**，不是超集）。
 *
 * 而这道门禁**反过来**也不覆盖行为：编译通过不等于解析结果对。
 * 两者都需要，谁也代替不了谁。
 *
 * ## ⚠️ 诚实边界（这道门禁**不**证明什么）
 *
 * | 不证明 | 为什么 |
 * |---|---|
 * | 卡片（`.ets`）能编译 | `es2abc` 的 `--extension` **只接受 `js/ts/as/abc`，不接受 `ets`**。卡片必须靠真工程里的 `hvigorw assembleHap`（见下） |
 * | 代码能在设备上跑 | 本机**没有 `ark_js_vm`**（实测遍 DevEco 全目录没有任何 ark runtime），`.abc` 编出来也跑不起来 |
 * | ArkTS **语义**合规 | 这些文件是 `.ts`，es2abc 按 ts 模式编译，不会施加 ArkTS 的全部限制规则 |
 *
 * ## 卡片的编译验证在哪
 *
 * `apps/mobile/harmony/` 是一个**真的 HarmonyOS 工程**（从 DevEco 官方模板
 * `previewProjectTemplate` 生成，不是手写脚手架）。
 * `cd apps/mobile/harmony && ohpm install && ./hvigorw assembleHap`
 * 会真的用 ArkTS 编译器编译全部 `.ets`（含四张卡片）并产出 HAP。
 * 本机已实测通过（HarmonyOS 6.1.1 / API 24，见
 * `scripts/verify-harmony-toolchain.sh`）。
 * 那一步慢且需要 DevEco，所以**不放进 `pnpm check`**，作为独立验收存在。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const WIDGET_DIR = join(REPO, 'apps/mobile/harmony/entry/src/main/ets/widget');

/**
 * `es2abc` 的候选位置。DevEco 的安装路径不固定 —— 与
 * `design-system/heyta/check-arkts-compile.mjs` 用同一套候选，
 * 这样"装没装 DevEco"在两处得到同一个答案。
 */
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
  // 🔴 **响亮地跳过，绝不假装通过。** CI 上没有 DevEco Studio，
  //    但"跳过"必须说得比"通过"更响 —— 否则这条门禁会变成
  //    "一个永远绿、什么也没查"的摆设（AGENTS.md §5）。
  console.log('\n⚠️  跳过 ArkTS 编译验证：找不到 es2abc（ArkTS 编译器）。');
  console.log('   这意味着 **鸿蒙端的小组件解析层没有被编译器验证过**。');
  console.log('   它们仍然会被 vitest 按 Node 跑（行为已验证），但"ArkTS 编译器收不收"未验。');
  console.log('   装了 DevEco Studio 的机器上会自动启用；也可用 HEYTA_ES2ABC 指定路径。');
  console.log('   候选位置：');
  for (const c of CANDIDATES) console.log(`      ${c}`);
  console.log('');
  process.exit(0);
}

if (!existsSync(WIDGET_DIR)) {
  console.log(`\n🔴 找不到鸿蒙小组件目录：${WIDGET_DIR}\n`);
  process.exit(1);
}

const sources = readdirSync(WIDGET_DIR)
  .filter((name) => name.endsWith('.ts'))
  .sort();

if (sources.length === 0) {
  // 目录在但一个源文件都没有 —— 这不是"通过"，这是有人把文件搬走了。
  console.log(`\n🔴 ${WIDGET_DIR} 里没有任何 .ts 源文件。\n`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'heyta-arkts-widgets-'));
let failed = 0;

for (const name of sources) {
  const source = join(WIDGET_DIR, name);
  const out = join(work, `${name}.abc`);
  try {
    execFileSync(es2abc, ['--module', '--extension=ts', `--output=${out}`, source], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    failed += 1;
    console.log(`\n🔴 ArkTS 编译器拒绝了 ${name}：\n`);
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    for (const line of detail.split('\n').slice(0, 12)) console.log(`   ${line}`);
    console.log('');
    continue;
  }

  // 🔴 **验证产物本身**：退出码不携带"产物长什么样"的信息。
  //    一个空的 / 截断的 .abc 也会 exit 0，而它到设备上什么都不会有。
  if (!existsSync(out)) {
    failed += 1;
    console.log(`   ❌ ${name}: 退出码 0 但**没有产出** ${out}`);
    continue;
  }
  const bytes = readFileSync(out);
  // ⚠️ magic 是 **5 个字节** `PANDA`（后面跟一个 `\0` 与版本/校验字节）。
  //    我第一版写成 `subarray(0, 4)` 拿来比 `"PANDA"`，于是**永远不相等** ——
  //    门禁对**正确的代码**也报红。这正是 AGENTS.md §5 说的那类东西：
  //    "一个不会失败的检查毫无价值"，而**一个永远失败的检查更坏**：
  //    它会让人学会忽略它。所以下面那句 `magic 期望` 里写明了字节数。
  const magic = bytes.subarray(0, 5).toString('latin1');
  if (bytes.length < 64 || magic !== 'PANDA') {
    failed += 1;
    console.log(
      `   ❌ ${name}: 产物不像 ArkTS 字节码（${bytes.length} 字节，前 5 字节=${JSON.stringify(magic)}，期望 "PANDA"）`,
    );
    continue;
  }
  console.log(`   ✅ ${name} → ${bytes.length} 字节 PANDA 字节码`);
}

console.log('');
if (failed > 0) {
  console.log(`🔴 ${failed} / ${sources.length} 份鸿蒙源文件编译失败 —— 鸿蒙端会**编译不过**。`);
  console.log('   修代码，不要修这道门禁。\n');
  process.exit(1);
}

console.log(
  `✅ 鸿蒙小组件解析层通过真实 ArkTS 编译器（${sources.length} 份源文件，${es2abc.includes('build-mac') ? 'macOS' : 'lib'} es2abc）。`,
);
console.log('   ⚠️ 卡片（.ets）不在这里验 —— 它们在 apps/mobile/harmony 里由 hvigorw 编译。\n');
