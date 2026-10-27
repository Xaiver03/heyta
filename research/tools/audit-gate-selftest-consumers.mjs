#!/usr/bin/env node
/**
 * 读数（不是门禁）：**哪些尺写了自检臂，却没有任何定义真的跑那些臂**。
 *
 * 为什么需要现量而不是散文：本仓的惯例是「尺自带 `--self-test`」，而链上只有部分定义写成
 * `node scripts/x.mjs --self-test && node scripts/x.mjs`。臂不跑不等于臂没用 —— 它等于**臂会烂**：
 * 判据改了、夹具没跟着改，没有任何东西会红。这正是 `check-gate-wiring` 管的"接缝"，
 * 只是那一枚判的是"实现有没有被引用"，这一枚问的是"实现里的**自检**有没有被引用"。
 *
 * 它**不因"有人没跑臂"退非零**：这是一张债表，不是一道门。今天跑出来的名单跨很多条线，
 * 把它们一次性判红等于替别人决定优先级。要收成门禁得先给每一枚写理由，那是拍板后的事
 * （见 BLOCKED.md 的待拍板表）。
 * ⚠️ 但**视力臂不成立时退 2**（rc=2 = "我没干活/这把尺今天瞎了"，与 rc=1 那档"判了且不合格"分开）。
 *
 *   node research/tools/audit-gate-selftest-consumers.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const defs = Object.entries(pkg.scripts).filter(([, v]) => typeof v === 'string');
const chain = pkg.scripts?.check ?? '';

/**
 * 🔴 什么算"这枚脚本接受 `--self-test`"：**代码里有一枚引号包住的这个字面量**（单/双引号都算）。
 * 反引号不算 —— 散文与 JSDoc 里写 `--self-test` 是叙述，不是分支。
 * 这面判据是 2026-10-27 现量修出来的：第一版只匹配双引号，于是**总数 0**、rc=0，
 * 而同一趟里另一发读数说链上有二十多枚定义带 `--self-test` ⇒ 那不是"没有臂"，那是尺子瞎。
 */
const ACCEPTS_SELF_TEST = /['"]--self-test['"]/u;
const withArms = [];
for (const f of readdirSync(join(ROOT, 'scripts')).filter((x) => /^check-.*\.mjs$/.test(x))) {
  if (!ACCEPTS_SELF_TEST.test(readFileSync(join(ROOT, 'scripts', f), 'utf8'))) continue;
  const touching = defs.filter(([, v]) => v.includes(`scripts/${f}`));
  const runsArms = touching.some(([, v]) => v.includes('--self-test'));
  withArms.push({
    file: f,
    hasDef: touching.length > 0,
    runsArms,
    inChain: chain.includes(`scripts/${f}`) || touching.some(([k]) => chain.includes(`pnpm ${k}`)),
  });
}

const runned = withArms.filter((r) => r.runsArms);
const noDef = withArms.filter((r) => !r.hasDef);
const notRunned = withArms.filter((r) => r.hasDef && !r.runsArms);

// ── 视力臂：分母要自己证明它含物 ────────────────────────────────────────
// 已知在场的一臂（2026-10-27 现量：它的定义就是 `… --self-test && …` 那个形状）。
// 它读不到的时候，本枚探针**不许**报任何"没有/0"，只能报"我瞎了"。
const CONTROL = 'check-scripts-parse.mjs';
const blind = !withArms.some((r) => r.file === CONTROL) || !runned.some((r) => r.file === CONTROL);
if (blind) {
  console.error(`🔴 视力臂不成立：${CONTROL} 应当既"有臂"又"被定义跑着"，现量 有臂=${withArms.some((r) => r.file === CONTROL)} 跑臂=${runned.some((r) => r.file === CONTROL)}`);
  console.error(`   ⇒ 下面那些计数一概不可信（这把尺的射程没覆盖到它本该覆盖的对象），先修尺再看表。`);
  process.exit(2);
}

console.log(`自带自检臂的 scripts/check-*.mjs ｜ 总数 ${withArms.length}`);
console.log(`   定义里真的跑臂（同一枚定义串里带 --self-test）：${runned.length}`);
console.log(`   有定义但没人跑臂：${notRunned.length}`);
console.log(`   连 package.json 定义都没有：${noDef.length}` + `（这类是否已进 ALLOWED_UNREFERENCED_IMPL 由 pnpm check:gate-wiring 判，这里不重复判）`);
console.log(`   视力臂 ✅ ${CONTROL} 两面都在`);
for (const r of notRunned) console.log(`      · ${r.file}${r.inChain ? '' : '（整枚不在链上）'}`);
for (const r of noDef) console.log(`      · ${r.file} ← 无定义（臂 0 次执行，除非有人在别处点它）`);
