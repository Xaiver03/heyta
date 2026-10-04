/**
 * 验证「把 check:doc-citations 挂进 pnpm check」这条改动**现在就能落地**，
 * 而**不碰工作树里的 `package.json`**（该文件正被并行会话改着 —— 谁都不该为跑一条
 * 验证去动别人手里的文件）。靠的是 `check-gate-wiring.mjs` 自带的 `--pkg` 旋钮：
 * 把候选 package.json 指给它，它就在候选上做全套对账。
 *
 * 四臂（期望值不是猜的，是从这条门禁自己的语义推的：定义数 +1、链内段数 +1、链外不变）：
 *  C0 当前工作树 package.json      ⇒ RC=0（前提：现场本来就是干净的）
 *  C1 加定义 **并**插进链          ⇒ RC=0（= 这条改动可以照抄落地）
 *  C2 只加定义、没进链            ⇒ RC≠0，且红必须点名 `check:doc-citations`
 *     —— 这条是 C1 的阳性对照：它证明"进定义表"本身不会被当成"已挂"，
 *        也就是说 owner 只做一半会立刻被拦，不会留下"看起来挂了"的门禁。
 *  C3 往链里插出一个 `&&&`         ⇒ RC≠0，但红点名的**不是**新加那道，而是被
 *     `&&` 拆坏而掉出链的下一段（`check:md-tables`）。这条不是造的假样本：
 *     它是本仓真实存在的失效形状（掉一段出去、链子照样 `exit 0`），
 *     而且它证明检测面覆盖**任意一道**，不是只盯着新名字。
 *
 * 装置只写 `/tmp` 下的候选副本，工作树零改动；`replaceOnce()` 命中数 ≠1 直接抛错 ——
 * 静默 0 命中的替换会交出"候选 = 原文件"，那条读数就是假的。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const OUT = '/tmp/heyta-perf-scan';

const ORIG = readFileSync(`${ROOT}/package.json`, 'utf8');

function replaceOnce(text, from, to, label) {
  const hits = text.split(from).length - 1;
  if (hits !== 1) throw new Error(`${label}: 锚点命中 ${String(hits)} 次（期望 1），候选失效`);
  return text.replace(from, to);
}

const DEF_ANCHOR = '    "check:docs":';
const DEF_ADD = '    "check:doc-citations": "node scripts/check-doc-citations.mjs",\n';
const CHAIN_ANCHOR = ' && pnpm check:docs &&';
const CHAIN_ADD = ' && pnpm check:doc-citations &&';

const candidate1 = replaceOnce(
  replaceOnce(ORIG, DEF_ANCHOR, DEF_ADD + DEF_ANCHOR, 'C1-定义'),
  CHAIN_ANCHOR,
  ' && pnpm check:docs' + CHAIN_ADD,
  'C1-链',
);
const candidate2 = replaceOnce(ORIG, DEF_ANCHOR, DEF_ADD + DEF_ANCHOR, 'C2-定义');
const candidate3 = replaceOnce(
  replaceOnce(ORIG, DEF_ANCHOR, DEF_ADD + DEF_ANCHOR, 'C3-定义'),
  CHAIN_ANCHOR,
  ' && pnpm check:docs' + CHAIN_ADD + '&',
  'C3-链',
);

writeFileSync(`${OUT}/pkg-c1-wired.json`, candidate1);
writeFileSync(`${OUT}/pkg-c2-def-only.json`, candidate2);
writeFileSync(`${OUT}/pkg-c3-malformed.json`, candidate3);

function run(pkg, label, expectNames) {
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', [`${ROOT}/scripts/check-gate-wiring.mjs`, '--pkg', pkg], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    rc = e.status ?? 1;
  }
  const first = out.trim().split('\n')[0] ?? '(空输出)';
  console.log(`${label}: RC=${String(rc)}  ${first}`);
  const reds = [...out.matchAll(/^.*🔴.*$/gm)].map((m) => m[0].trim());
  for (const line of reds) console.log(`     ↳ ${line}`);
  if (rc !== 0 && reds.length === 0) {
    console.log('     ↳ 非零退出但输出里没有 🔴 行 ⇒ 读的是 stderr 还是别的？这一臂不算证据');
  }
  if (expectNames !== undefined) {
    for (const name of expectNames) {
      const hit = reds.some((line) => line.includes(name));
      console.log(`     ${hit ? 'OK ' : 'BAD'} 红集中出现 ${name} = ${String(hit)}`);
      if (!hit) bad += 1;
    }
  }
  return { rc, reds };
}

let bad = 0;
const c1 = run(`${OUT}/pkg-c1-wired.json`, 'C1 定义+进链');
const c2 = run(`${OUT}/pkg-c2-def-only.json`, 'C2 只加定义不进链', ['check:doc-citations']);
const c3 = run(`${OUT}/pkg-c3-malformed.json`, 'C3 链里插出 &&&', ['check:md-tables']);
const c0 = run(`${ROOT}/package.json`, 'C0 当前工作树 package.json');

if (c1.rc !== 0) bad += 1;
if (c2.rc === 0) bad += 1;
if (c3.rc === 0) bad += 1;
if (c0.rc !== 0) bad += 1;
// C3 的红必须**不是**新加那道，否则"检测面覆盖任意一道"这句就没证到
if (c3.reds.some((line) => line.includes('check:doc-citations'))) bad += 1;

console.log(
  bad === 0
    ? 'GATE-WIRING-CANDIDATE=PASS（C1 进链=0 · C2 只做一半≠0 且点名新门禁 · C3 &&&≠0 且点名掉出的旧门禁 · C0 现状=0）'
    : `GATE-WIRING-CANDIDATE=FAIL（${String(bad)} 项：C1=${String(c1.rc)} C2=${String(c2.rc)} C3=${String(c3.rc)} C0=${String(c0.rc)}）`,
);
process.exitCode = bad === 0 ? 0 : 1;
