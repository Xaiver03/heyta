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

// 🔴 许可证政策（白名单 / 限制清单 / REVIEWED_OTHER 登记表 / 归类函数）的
//    **唯一真源**是 `license-policy.mjs` —— npm 侧与 NuGet 侧共用同一份。
//    两边各维护一份白名单一定会漂移，而漂移的规则比没有规则更危险：
//    agent 会照着过期的那份执行，而且没人知道哪份是对的。
import {
  PERMISSIVE,
  RESTRICTED,
  REVIEWED_OTHER,
  normalizeLicense as normalize,
  classifyLicense as classify,
} from './license-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

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
const reviewedOther = byKind.other
  .filter((p) => Object.hasOwn(REVIEWED_OTHER, p.license))
  // 把登记理由**随数据一起带出去**。渲染器要的是理由原文，
  // 而不是一个"请你自己去另一个文件里找"的指针 —— 指针会漂，原文不会。
  .map((p) => ({ ...p, reason: REVIEWED_OTHER[p.license] }));
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
  // 🔴 这里**不能**用 `process.exit()`。stdout 是**管道**时写入是异步的，
  // 而上面那坨 JSON 有 400KB+ —— `exit()` 会在 flush 之前把进程杀掉，
  // 于是调用方拿到的是**被截断的 JSON**，截断点还常常落在多字节字符中间。
  //
  // 实测（2026-09-27）：`node license-inventory.mjs --json | python3 -m json.tool`
  // 必然失败（`Unterminated string ... position 63395`），而
  // `node license-inventory.mjs --json > /tmp/x.json` 却完全正常 ——
  // 差别正是"管道异步 / 文件同步"。这个 bug 极难归因：看起来只是消费方解析错了。
  //
  // 改成设 `exitCode` 让进程自然结束，Node 会先把 stdout 排空。
  // 退出码语义不变（门禁 `check:licenses` 依赖它）。
  process.exitCode = failing ? 1 : 0;
}

// ── 面向人的汇总 ────────────────────────────────────────────────
//
// 整块用 `!jsonOut` 把关：`--json` 时**一个字符都不能多打**，
// 否则管道里会混进非 JSON 文本，消费方又要靠"从第几行开始才是 JSON"来猜。
if (!jsonOut) {
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
      console.log(`       理由：${p.reason}`);
    }
  }

  if (flaggedOnly) {
    console.log('\n（--flagged：只列需人判断的项；退出码仍反映是否存在不合格依赖）');
  } else {
    console.log(
      `\n结论：${failing ? '存在需要处理的项 —— 见上 ❌' : '全部依赖均为宽松许可（含已登记的例外）✅'}\n`,
    );
  }

  process.exitCode = failing ? 1 : 0;
}
