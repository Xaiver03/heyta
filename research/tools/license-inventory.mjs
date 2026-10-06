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

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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

const ROOT = process.env.HEYTA_LICENSE_ROOT
  ? join(process.env.HEYTA_LICENSE_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '../..');

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
// 🔴 **少一条 store 也要响亮失败**，不能"扫到几条算几条"。
//   上面那一档只挡"一条都没有"：`e2e/node_modules` 不在时它照样出数，
//   而汇总数字看起来完好无损 —— 文件头那句"忘了登记会表现为数字没变"担心的正是这个形状，
//   而**装了又被删 / 没装**这一档当时根本没被挡住。
if (presentStores.length !== STORES.length) {
  const missing = STORES.filter((s) => !existsSync(s.path)).map((s) => `  ${s.label}: ${s.path}`);
  console.error(
    `🔴 已登记的 store 里有 ${missing.length} 条不在场 ⇒ 清点结果**必然少算**，不出数：\n` +
      `${missing.join('\n')}\n` +
      '请先运行 pnpm install（根目录；e2e 需要单独 `cd e2e && pnpm install`）。',
  );
  process.exit(1);
}

// ── 渲染输入集对账：装在 store 里的每一枚都得在当前 lockfile 里查得到 ──────
//
// 这条判据回答"**清点跑在哪一批字节上**"，而 `--check-stamp` 回答"清单比 lockfile 旧不旧"。
// 两问互不蕴含：一次 `pnpm install` 之后 store 可以**再也不被碰**，于是渲染读到的是
// 一棵陈旧的树，而指纹对账（它只读 lockfile 文件本身）完全看不出来。
// 2026-10-06 现量：主检出的 store 比当前 lockfile 多 **132** 枚（expo 整棵子树，
// 当前 lockfile 里 `expo` 命中 0），在它上面渲染出的清单印成 1093 枚，
// 而同一把锁（sha256 逐字相同）在全新安装的检出上只有 961 枚 —— 两个数字都能过 `--check-stamp`。
//
// 判据写成**包含测试**而不是解析 lockfile：v9 的 `snapshots:` 键带 peer 后缀
// （`'@expo/cli@57.0.27(…)'`），手写解析器一旦漏分支就会把**真依赖**报成陈旧，
// 那比没有判据更坏。`name@version` 在 lockfile 里必然以子串形式出现，
// 所以"查无此枚"是充分信号（会漏报，不会误报）。
const LOCKFILES = ['pnpm-lock.yaml', 'e2e/pnpm-lock.yaml'];

function lockText(root) {
  let text = '';
  for (const rel of LOCKFILES) {
    const p = join(root, rel);
    if (!existsSync(p)) {
      console.error(`🔴 清点没有输入：${root} 下没有 ${rel} ⇒ 无法判断"装的是不是这一把锁的"。`);
      process.exit(1);
    }
    text += readFileSync(p, 'utf8');
  }
  return text;
}

/** <root> <entries> -> { scanned, stale }：`stale` = 装在 store 里而 lockfile 查无此枚。 */
function reconcileInputSet(root, entries) {
  const text = lockText(root);
  const stale = entries
    .filter((p) => !text.includes(`${p.name}@${p.version}`))
    .map((p) => `${p.name}@${p.version}`);
  return { scanned: entries.length, stale };
}

// ── 自检：这条判据能不能红 ────────────────────────────────────────
//
// 为什么必须有它：`--check-stamp` 那条判据当年就是"生下来没被证明会红"，
// 于是它把一次陈旧渲染放过去还报绿（§7 元规则二：不能失败的检查没有价值）。
// 夹具走 `HEYTA_LICENSE_ROOT` 注入，**不碰真实工作树**。
function pkgDir(root, storeRel, name, version) {
  const dir = join(root, storeRel, `${name.replace('/', '+')}@${version}`, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
}

function selfTest() {
  const SELF = fileURLToPath(import.meta.url);
  const run = (root) =>
    spawnSync(process.execPath, [SELF, '--json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      env: root ? { ...process.env, HEYTA_LICENSE_ROOT: root } : (() => { const e = { ...process.env }; delete e.HEYTA_LICENSE_ROOT; return e; })(),
    });
  const parse = (out) => {
    try {
      return JSON.parse(out);
    } catch {
      return null;
    }
  };
  let fail = 0;

  // 臂 1：真实树 ⇒ 陈旧数必须为 0（阳性对照，挡"这条判据恒红"）。
  const real = run(null);
  const realData = parse(real.stdout);
  if (realData && realData.inputSet && realData.inputSet.stale.length === 0) {
    console.log(`   ✅ 臂 1 真实树：${realData.inputSet.scanned} 枚逐枚都在当前 lockfile 里（不是恒红）`);
  } else {
    console.log(
      `   🔴 臂 1 坏了：真实树读出 ${realData ? `${realData.inputSet?.stale?.length} 枚陈旧` : '（没有 JSON 读数）'}` +
        ` —— 要么这条判据在误报，要么这台检出真的陈旧（那就先 pnpm install 再跑自检）`,
    );
    fail = 1;
  }

  // 夹具：两枚 store 包，一枚在 lockfile 里、一枚不在。
  const fx = join(tmpdir(), `heyta-lic-${process.pid}`);
  const clean = () => rmSync(fx, { recursive: true, force: true });
  clean();
  mkdirSync(join(fx, 'e2e'), { recursive: true });
  writeFileSync(join(fx, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nsnapshots:\n  goodpkg@1.0.0:\n");
  writeFileSync(join(fx, 'e2e/pnpm-lock.yaml'), "lockfileVersion: '9.0'\nsnapshots:\n  e2egood@2.0.0:\n");
  pkgDir(fx, 'node_modules/.pnpm', 'goodpkg', '1.0.0');
  pkgDir(fx, 'node_modules/.pnpm', 'stalepkg', '9.9.9');
  pkgDir(fx, 'e2e/node_modules/.pnpm', 'e2egood', '2.0.0');

  // 臂 2：夹具里那一枚 lockfile 查不到的包 -> 必须**恰好**被点名，且 rc=1。
  const a2 = run(fx);
  const d2 = parse(a2.stdout);
  if (d2 && a2.status === 1 && d2.inputSet.stale.length === 1 && d2.inputSet.stale[0] === 'stalepkg@9.9.9') {
    console.log('   ✅ 臂 2 陈旧的那一枚被单独点名（rc=1），同批其余两枚没被误伤');
  } else {
    console.log(
      `   🔴 臂 2 存活：夹具读成 rc=${a2.status} stale=${JSON.stringify(d2?.inputSet?.stale ?? '（无 JSON）')}` +
        `（期望恰好 ['stalepkg@9.9.9']）`,
    );
    fail = 1;
  }

  // 臂 3：把那一枚陈旧的拿掉 ⇒ 同一把夹具必须 rc=0（与臂 2 **配对**：
  //   没有它，"臂 2 红"也可能来自"夹具永远红"，而那是判据坏了不是树坏了）。
  rmSync(join(fx, 'node_modules/.pnpm/stalepkg@9.9.9'), { recursive: true, force: true });
  const a3 = run(fx);
  const d3 = parse(a3.stdout);
  if (a3.status === 0 && d3 && d3.inputSet.stale.length === 0 && d3.inputSet.scanned === 2) {
    console.log('   ✅ 臂 3 去掉陈旧那枚后同一夹具放行（scanned=2 说明两条 store 都扫到了）');
  } else {
    console.log(`   🔴 臂 3 坏了：去掉陈旧那枚仍读成 rc=${a3.status} scanned=${d3?.inputSet?.scanned ?? '（无 JSON）'}`);
    fail = 1;
  }

  // 臂 4：e2e 那条 store **不在场** ⇒ 必须响亮失败，而不是安静少扫一条 workspace。
  //   这一臂挡的是文件头那条担心的另一半：以前只有"一条都没有"才拦。
  rmSync(join(fx, 'e2e/node_modules'), { recursive: true, force: true });
  const a4 = run(fx);
  if (a4.status === 1 && /不在场/.test(`${a4.stderr}${a4.stdout}`)) {
    console.log('   ✅ 臂 4 少一条已登记的 store 时拒绝出数（不是"扫到几条算几条"）');
  } else {
    console.log(`   🔴 臂 4 存活：e2e store 不在场时读成 rc=${a4.status} —— 它会安静少算一整条 workspace`);
    fail = 1;
  }

  // 臂 5：lockfile 缺失 ⇒ "清点没有输入"，不能按"lockfile 里什么都没有"处理
  //   （那会把**所有**包报成陈旧 —— 一个方向相反、同样危险的读数）。
  pkgDir(fx, 'e2e/node_modules/.pnpm', 'e2egood', '2.0.0');
  rmSync(join(fx, 'e2e/pnpm-lock.yaml'), { force: true });
  const a5 = run(fx);
  if (a5.status === 1 && /清点没有输入/.test(`${a5.stderr}${a5.stdout}`)) {
    console.log('   ✅ 臂 5 缺 lockfile 时按"没有输入"拒绝（不按"全都陈旧"处理）');
  } else {
    console.log(`   🔴 臂 5 存活：缺 e2e/pnpm-lock.yaml 时读成 rc=${a5.status}`);
    fail = 1;
  }
  clean();

  // 臂 6（接线）：渲染器必须真的消费这条判据 —— 抽进尺而不确认调用方在调，
  //   等于新写一份没人执行的更漂亮版本（AGENTS §3.5 那条教训的形状）。
  const renderer = readFileSync(join(dirname(SELF), 'render-license-inventory.mjs'), 'utf8');
  if (/inputSet[\s\S]{0,80}stale/.test(renderer) && /拒绝渲染/.test(renderer)) {
    console.log('   ✅ 臂 6 渲染器确有这一格拒绝（陈旧输入集渲染不出产物）');
  } else {
    console.log('   🔴 臂 6 断了：render-license-inventory.mjs 没消费 inputSet.stale ⇒ 这条判据只在门禁侧响');
    fail = 1;
  }

  const total = 6;
  if (fail) {
    console.log(`自检有臂存活（${total} 臂）`);
    process.exit(1);
  }
  console.log(`自检 ${total} 臂全过`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

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

// 🔴 清点**跑在哪一批字节上**：与 `failing` 分开算，因为它拒的是"这一轮的输入集不可信"，
//   而不是"某个依赖许可不合格"。两者都会让门禁红，但报给下一位读者的话完全不同 ——
//   合成一个数字就会重演"一条判据里藏两个缺陷"（§7 #86）。
const inputSet = reconcileInputSet(ROOT, all);

const jsonOut = process.argv.includes('--json');
const flaggedOnly = process.argv.includes('--flagged');

if (jsonOut) {
  console.log(
    JSON.stringify(
      { total: all.length, byKind, reviewedOther, unreviewedOther, failing, inputSet, all },
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
  process.exitCode = failing || inputSet.stale.length ? 1 : 0;
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

  if (inputSet.stale.length) {
    console.log(`\n  🔴 清点输入集：store 里有 ${inputSet.stale.length} 枚在当前 lockfile 里查不到`);
    for (const k of inputSet.stale.slice(0, 12)) console.log(`     ${k}`);
    if (inputSet.stale.length > 12) console.log(`     …（其余 ${inputSet.stale.length - 12} 枚从略）`);
    console.log(
      '     ↳ 这一档**会失败**：这一轮清点的是**一棵陈旧的已安装树**（多半是 lockfile 变了\n' +
        '       而这里没再跑过 install）。在它上面渲染许可证清单会把不再存在的包印成"已登记"，\n' +
        '       而 `--check-stamp` 只看 lockfile 指纹，挡不住这种胖。修法：\n' +
        '       pnpm install --frozen-lockfile（e2e 另需 `cd e2e && pnpm install`）后重跑。',
    );
  } else {
    console.log(`\n  ☑️  清点输入集：store 去重后 ${inputSet.scanned} 枚，逐枚都能在当前 lockfile 里查到`);
  }

  if (flaggedOnly) {
    console.log('\n（--flagged：只列需人判断的项；退出码仍反映是否存在不合格依赖）');
  } else {
    const bad = failing + inputSet.stale.length;
    console.log(
      `\n结论：${bad ? '存在需要处理的项 —— 见上 ❌' : '全部依赖均为宽松许可（含已登记的例外），且清点输入集对得上当前 lockfile ✅'}\n`,
    );
  }

  process.exitCode = failing || inputSet.stale.length ? 1 : 0;
}
