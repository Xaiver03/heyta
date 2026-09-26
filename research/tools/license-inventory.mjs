#!/usr/bin/env node
/**
 * 从**实际安装的依赖树**清点许可证。
 *
 * 为什么不能只读 lockfile：lockfile 记录的是声明范围与解析结果，
 * 而许可证字段在包的 package.json 里。要"逐项登记"就必须以**真实装了什么**为准。
 *
 * 扫描**仓库里所有 pnpm 工作区**的虚拟 store（`node_modules/.pnpm`），去重后产出清单。
 * 目前有两个：根工作区、以及 `e2e/`（独立工作区，见那里的 `pnpm-workspace.yaml`）。
 * **加新工作区时必须在下面的 `STORES` 里登记** —— 否则那个工作区的依赖
 * 会悄悄不被清点，而汇总数字看起来完好无损。
 *
 * 用法：
 *   node research/tools/license-inventory.mjs            # 汇总
 *   node research/tools/license-inventory.mjs --json     # 机器可读
 *   node research/tools/license-inventory.mjs --flagged  # 只看需要人判断的
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** 宽松许可：允许闭源商用。 */
const PERMISSIVE = [
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
  '0BSD', 'Unlicense', 'CC0-1.0', 'Python-2.0', 'BlueOak-1.0.0',
  'MIT-0', 'Apache-2.0 WITH LLVM-exception', 'Zlib',
  // MPL-2.0 是**文件级** copyleft：改动过的文件要开源，但可以与闭源代码链接、
  // 一起分发。heyta 的政策明确允许（见 docs/02-licensing-and-compliance.md）。
  // 漏了它会把 lightningcss 误报成"待判断"。
  'MPL-2.0',
];

/** 需要人判断或明确禁止。 */
const RESTRICTED = [
  'AGPL', 'GPL', 'LGPL', 'SSPL', 'BUSL', 'BSL', 'FSL', 'Elastic',
  'CC-BY-NC', 'CC-BY-SA', 'EUPL', 'OSL', 'CPAL', 'Commons Clause',
];

/**
 * 白名单**之外**、但已逐个复核并接受的许可证。
 * ==============================================
 *
 * 🔴 存在的理由：这个脚本以前把"需归类"（`other`）**只打印、不判定** ——
 * 退出码里完全不含 `other`，于是它打印完 `❔ 其他（需归类）: 1`
 * 之后接着报 `结论：全部依赖均为宽松许可 ✅` 并退出 **0**。
 *
 * 那等于**这一档永远不会失败**：白名单是显式枚举的，所以任何不在表里的许可
 * 都会落进 `other` 并被静默放行 —— 正好是白名单想拦的那一类。
 * `THIRD_PARTY_LICENSES.md` 早就把这个弱点写在纸上了，
 * 但**写在纸上的弱点拦不住任何一次引入**。
 *
 * 现在的语义：`other` **默认失败**，只有在这里逐项登记（并写明为什么可以接受）
 * 才放行。加一条的成本是刻意的 —— 它逼人为这个许可做一次真正的判断，
 * 而不是让它悄悄混进"全部宽松"里。
 *
 * 键是许可证标识，值是**接受它的理由**（会被打印出来，所以必须说清楚）。
 */
const REVIEWED_OTHER = {
  'CC-BY-4.0':
    'caniuse-lite@1.0.30001812：browserslist 的**构建期数据包**，不进入运行时产物；' +
    'CC-BY 是署名许可（不是禁用的 CC-BY-NC），归属已在 THIRD_PARTY_LICENSES.md §2 登记。',
};

const normalize = (raw) => {
  if (raw == null) return 'UNKNOWN';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    if (typeof raw.type === 'string') return raw.type;
    if (Array.isArray(raw)) return raw.map(normalize).join(' OR ');
  }
  if (Array.isArray(raw)) return raw.map(normalize).join(' OR ');
  return 'UNKNOWN';
};

const classify = (lic) => {
  const up = lic.toUpperCase();
  if (lic === 'UNKNOWN') return 'unknown';
  // 先判限制类：'MIT OR GPL-3.0' 这种双许可要人看
  if (RESTRICTED.some((k) => up.includes(k.toUpperCase()))) return 'restricted';
  if (PERMISSIVE.some((k) => up.includes(k.toUpperCase()))) return 'permissive';
  return 'other';
};

/**
 * 要扫的 pnpm store 列表。
 *
 * 🔴 **为什么不止一个。**
 *
 * `e2e/` 是一个**独立的 pnpm 工作区**（它有自己的 `pnpm-workspace.yaml`，
 * 原因见那个文件：根 lockfile 当时被一个并发开发中的新应用占着，不能动）。
 * 独立工作区就有自己的一份 store —— 只扫根 store 的话，
 * Playwright 及其依赖会**完全不可见**：`check:licenses` 绿着，
 * 而它根本没看过那个包。
 *
 * 这正是本仓库反复吃亏的那类失效：**门禁绿 ≠ 登记全**。
 * 之前 `licenses-inventory.generated.md` 漏掉整棵 React Native 子树
 * （315 → 908）也是同一个形状。所以这里把"要扫哪些 store"写成一份**显式清单**，
 * 将来再加工作区时，忘了登记会表现为"数字没变"，而不是"悄悄漏了"。
 */
const STORES = [
  { label: '根工作区', path: join(ROOT, 'node_modules/.pnpm') },
  { label: 'e2e（独立工作区）', path: join(ROOT, 'e2e/node_modules/.pnpm') },
];

const presentStores = STORES.filter((s) => existsSync(s.path));
if (presentStores.length === 0) {
  console.error(
  `找不到任何 pnpm store。已找过：\n${STORES.map((s) => `  ${s.label}: ${s.path}`).join('\n')}\n` +
      '请先运行 pnpm install（根目录；e2e 需要单独装）。',
  );
  process.exit(1);
}

/** key = `${name}@${version}`，天然对同名多版本去重。 */
const found = new Map();

for (const store of presentStores) {
  for (const entry of readdirSync(store.path)) {
    // pnpm 目录名形如 `zod@4.6.5` 或 `@prisma+client@5.22.0_prisma@5.22.0`
    // 直接扫内部 node_modules 更可靠
    const inner = join(store.path, entry, 'node_modules');
    if (!existsSync(inner)) continue;
    for (const name of readdirSync(inner)) {
      const pkgs = name.startsWith('@')
        ? readdirSync(join(inner, name)).map((s) => `${name}/${s}`)
        : [name];
      for (const pkgName of pkgs) {
        const pj = join(inner, pkgName, 'package.json');
        if (!existsSync(pj)) continue;
        try {
          const j = JSON.parse(readFileSync(pj, 'utf8'));
          const lic = normalize(j.license ?? j.licenses);
          const key = `${j.name}@${j.version}`;
          if (!found.has(key)) {
            found.set(key, {
              name: j.name,
              version: j.version,
              license: lic,
              kind: classify(lic),
              store: store.label,
              repo:
                typeof j.repository === 'string'
                  ? j.repository
                  : j.repository?.url ?? '',
            });
          }
        } catch {
          /* 坏 package.json 跳过 */
        }
      }
    }
  }
}

const all = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const byKind = { permissive: [], restricted: [], other: [], unknown: [] };
for (const p of all) byKind[p.kind].push(p);

// `other` 再分两档：已登记的（放行）与未登记的（失败）。
// 分档依据是**许可证标识本身** —— 同一个许可只需人判断一次。
const reviewedOther = byKind.other.filter((p) => Object.hasOwn(REVIEWED_OTHER, p.license));
const unreviewedOther = byKind.other.filter((p) => !Object.hasOwn(REVIEWED_OTHER, p.license));

/**
 * 🔴 唯一的失败判据。**三处出口（--json / --flagged / 汇总）都用它。**
 *
 * 以前这个条件被**抄了三遍**，而且三遍里**都没有 `other`** ——
 * 漂移就是从"同一个判断写三次"开始的。现在只有一个地方能决定失败与否。
 */
const failing = byKind.restricted.length + byKind.unknown.length + unreviewedOther.length;

const jsonOut = process.argv.includes('--json');
const flaggedOnly = process.argv.includes('--flagged');

if (jsonOut) {
  console.log(
    JSON.stringify(
      { total: all.length, byKind, reviewedOther, unreviewedOther, failing, all },
      null,
      2,
    ),
  );
  process.exit(failing ? 1 : 0);
}

console.log(`\n依赖树许可证清点（去重后 ${all.length} 个包）\n`);
console.log(`  宽松许可（可闭源商用） : ${byKind.permissive.length}`);

const licCount = {};
for (const p of all) licCount[p.license] = (licCount[p.license] ?? 0) + 1;
console.log('\n  ── 许可证分布（前 12）──');
for (const [l, n] of Object.entries(licCount).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`     ${String(n).padStart(4)}  ${l}`);
}

if (byKind.restricted.length) {
  console.log(`\n  🔴 需人判断 / 受限 : ${byKind.restricted.length}`);
  for (const p of byKind.restricted) {
    console.log(`     ${p.name}@${p.version}  →  ${p.license}`);
  }
}

if (byKind.unknown.length) {
  console.log(`\n  ⚠️  无许可证字段 : ${byKind.unknown.length}`);
  for (const p of byKind.unknown.slice(0, 20)) {
    console.log(`     ${p.name}@${p.version}`);
  }
}

if (unreviewedOther.length) {
  console.log(`\n  ❔ 白名单外、且未登记 : ${unreviewedOther.length}`);
  for (const p of unreviewedOther) {
    console.log(`     ${p.name}@${p.version}  →  ${p.license}`);
  }
  console.log(
    '     ↳ 这一档**会失败**。要么换成白名单内的许可，要么在\n' +
      '       research/tools/license-inventory.mjs 的 REVIEWED_OTHER 里逐项登记理由。',
  );
}

if (reviewedOther.length) {
  console.log(`\n  ☑️  白名单外、已逐项登记 : ${reviewedOther.length}`);
  for (const p of reviewedOther) {
    console.log(`     ${p.name}@${p.version}  →  ${p.license}`);
    console.log(`       理由：${REVIEWED_OTHER[p.license]}`);
  }
}

if (flaggedOnly) {
  console.log('\n（--flagged：只列需人判断的项；退出码仍反映是否存在不合格依赖）');
  process.exit(failing ? 1 : 0);
}

console.log(
  `\n结论：${failing ? '存在需要处理的项 —— 见上 ❌' : '全部依赖均为宽松许可（含已登记的例外）✅'}\n`,
);
process.exit(failing ? 1 : 0);
