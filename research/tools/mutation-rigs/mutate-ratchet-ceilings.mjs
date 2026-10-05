#!/usr/bin/env node
// `scripts/check-ratchet-ceilings.mjs` 的**拒绝臂**（工单 §8.118）。
//
// 为什么这道门禁非配臂不可：它守的那一半**原本就没有判据**（§8.82 的 A/B 实测：把两道门禁的
// 常数 +1，两道都退 0，还把自己那句打印成"已降 1 处"= 一次改进）。新写的门禁如果也不能红，
// 那这半句"不许调高基线"就还是散文 —— 一条永远不会红的门禁比没有门禁更糟（AGENTS §7 元规则 2）。
//
// 四条臂，各挡一种不同的失效：
//   R1 调高 `mobile_l4` 的基线        ⇒ 必须 RED 且**点名 mobile_l4**（不许只报个总数）
//   R2 调高 `ht_family` 的基线        ⇒ 必须 RED 且点名 ht_family（另一枚脚本、另一种解析形状）
//   R3 **删掉** web 那一档的 baseline 行 ⇒ 必须 PROBE_BROKEN / rc=2，
//      🔴 这一条是"读错位"臂：解析器如果写成"从 label 往后找第一条 baseline"，
//      删掉之后它会滑进**邻居**读出 90，于是报出"降了 14"这种有凭有据的假读数。
//      真正的门禁在这种输入下必须闭嘴并承认自己读不到，而不是给一个更好的答案。
//   R4 锚点给一个不存在的 ref          ⇒ 必须 rc=2 / NOT_JUDGED，绝不静默绿
// 外加一条**未变异对照**（基线必须 rc=0），以及"臂没红就退出 1"。
//
// 🔴 前置独占：两枚被变异的脚本都是**共享门禁脚本**，开工前必须逐枚确认它们相对 HEAD 干净。
//    别人在里面有未提交改动时，我这轮的"还原"会把他的实现整片打回 HEAD —— 那不是回归，是丢工作。
//    还原用进程序读入的内存副本，绝不用 `git checkout`（同一个理由）。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE = join(ROOT, 'scripts', 'check-ratchet-ceilings.mjs');
const L4 = join(ROOT, 'scripts', 'check-l4-no-style.mjs');
const ROW = join(ROOT, 'scripts', 'check-row-single-source.mjs');

// 🔴 自锚必须**当场证明**，不许只在"读不到文件"时才发现：这枚臂的每一条读数都来自
// `spawnSync(process.execPath, [GATE])`，而 ROOT 差一层时那个文件根本不存在 ——
// 得到的 rc 会被读成"门禁坏了"，而真正坏的是臂自己的寻径（本枚第一次跑就是这一形状：
// 负载门报 `No such file or directory`，看起来像环境问题）。
if (!existsSync(GATE) || !existsSync(L4) || !existsSync(ROW)) {
  console.log(`🔴 自锚指错了地方：ROOT=${ROOT} 里找不到 ${[GATE, L4, ROW].filter((f) => !existsSync(f)).join(' / ')}`);
  console.log('RIG_RESULT=PROBE_MISANCHORED（没动过任何源码）');
  process.exit(2);
}
console.log(`ROOT=${ROOT}`);

const rel = (p) => p.slice(ROOT.length + 1);
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const md5 = (s) => createHash('md5').update(s).digest('hex');

// ── 前置 1：宿主机负载门（复用共享那一把，不自己写第二把）。
//    位置在任何写盘之前 —— 判据晚了，一轮无效的运行照样已经把别人的源码改过一遍。
//    🔴 这一档在这里**不只是"机器忙"**：负载高说明有并行会话正在跑门禁，而那些门禁读的就是
//    我接下来要改的两枚脚本。所以等窗口 = 等"没有别人正在读这些文件"，不是等 CPU。
const gate = spawnSync('. scripts/lib/wait-for-quiet-host.sh && wait_for_quiet_host', {
  cwd: ROOT,
  shell: '/bin/bash',
  encoding: 'utf8',
});
const gateOut = `${gate.stdout || ''}${gate.stderr || ''}`.trim();
if (gate.status !== 0) {
  // 🔴 拒绝开工必须把**它的理由**一起打印：只报"环境无效"而不报负载/阈值，
  //    读的人无法分辨"等一会儿再来"和"这台机器永远跑不了"。
  console.log(`负载门理由：\n${gateOut.split('\n').map((l) => `   ${l}`).join('\n')}`);
  console.log('RIG_RESULT=ENV_INVALID（环境无效 ≠ 产品失败，也没动过任何源码）');
  process.exit(3);
}
console.log(`负载门：${gateOut.split('\n').pop()}`);

// ── 前置 2：独占门。
const dirty = [L4, ROW].filter((f) => git(['status', '--porcelain', '--', rel(f)]).trim() !== '');
if (dirty.length) {
  console.log(`🔴 这两枚里有别人的未提交改动，本臂拒绝开工（还原会打回他的实现）：\n   ${dirty.map(rel).join('\n   ')}`);
  console.log('RIG_RESULT=REFUSED_NOT_EXCLUSIVE');
  process.exit(3);
}

const TARGETS = [L4, ROW];
const BASE = new Map(TARGETS.map((f) => [f, readFileSync(f, 'utf8')]));
const BASE_MD5 = new Map([...BASE].map(([f, s]) => [f, md5(s)]));
const restoreAll = () => {
  for (const [f, s] of BASE) writeFileSync(f, s);
};
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restoreAll();
    process.exit(130);
  });
}

// ── 命中数断言：needle 命中数不对就整条臂作废（绝不允许"没改到但仍然红/仍然绿"）。
const apply = (file, needle, replacement) => {
  const text = BASE.get(file);
  const hits = text.split(needle).length - 1;
  if (hits !== 1) {
    restoreAll();
    console.log(`GUARD ${rel(file)} 里 needle 命中 ${String(hits)} 次（期望 1）：${JSON.stringify(needle)}`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(needle, replacement));
};

const runGate = (env = {}) => {
  // 🔴 路径里有空格（`All in one Data`），所以必须用 argv 数组而不是 shell 字符串拼 ——
  //    拼字符串会得到一次"命令没跑成"，而它长得像"门禁红了"。
  const r = spawnSync(process.execPath, [GATE], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// 每条臂自带"必须成立的读数"，判据打在**输出**上而不只是退出码：
// 一条只比 rc 的臂，在"因为别的原因红"的时候也会算通过。
// 🔴 字面形状一律从**门禁真实打印的那一行**抄，不凭记忆写（本枚第一次跑就是这条代价：
//    按 `调高 1` 写判据，而门禁打的是 `调高了 1` ⇒ 两道**明明红对了**的臂被判成"存活"）。
//    同时把匹配锁在**同一行**（`[^\n]*`）：跨行匹配会让"另一个名字 + 本行的调高"拼成一次假命中。
const ARMS = [
  {
    id: 'R1',
    why: '把 mobile_l4 的基线 90 调高成 91',
    act: () => apply(L4, '    baseline: 90,', '    baseline: 91,'),
    check: ({ rc, out }) =>
      rc === 1 &&
      out.includes('RATCHET_RESULT=RED') &&
      /🔴\s*mobile_l4[^\n]*调高了 1/.test(out) &&
      !/🔴\s*(web_l4|ht_family)[^\n]*调高了/.test(out),
    expect: 'rc=1 / RED / 点名 mobile_l4 且只有它红',
  },
  {
    id: 'R2',
    why: '把 ht_family 的基线 28 调高成 29（另一枚脚本、named-const 解析形状）',
    act: () => apply(ROW, 'const HT_FAMILY_BASELINE = 28;', 'const HT_FAMILY_BASELINE = 29;'),
    check: ({ rc, out }) =>
      rc === 1 &&
      out.includes('RATCHET_RESULT=RED') &&
      /🔴\s*ht_family[^\n]*调高了 1/.test(out) &&
      !/🔴\s*(mobile_l4|web_l4)[^\n]*调高了/.test(out),
    expect: 'rc=1 / RED / 点名 ht_family 且只有它红',
  },
  {
    id: 'R3',
    why: '删掉 web 那一档的 baseline 行（解析器不许滑进邻居取值）',
    act: () => apply(L4, '    baseline: 104,\n', ''),
    check: ({ rc, out }) =>
      rc === 2 &&
      out.includes('RATCHET_RESULT=PROBE_BROKEN') &&
      /web_l4[^\n]*解析不到基线/.test(out) &&
      !/🔴\s*web_l4[^\n]*调高了/.test(out) &&
      // web 那一档读不到时，**其余两档必须照常给出自己的读数**（守卫压住整道门禁 ≠ 把别人也一起静音）
      /✅\s*mobile_l4\s+基线\s+90 vs 锚点\s+90/.test(out),
    expect: 'rc=2 / PROBE_BROKEN / web_l4 报"解析不到"而不是报一个邻居的数字',
  },
  {
    id: 'R4',
    why: '锚点给一个不存在的 ref（拿不到参照就不能判）',
    act: () => {},
    env: { HEYTA_RATCHET_REF: 'refs/heads/heyta-ratchet-arm-nope' },
    check: ({ rc, out }) =>
      rc === 2 && out.includes('RATCHET_RESULT=NOT_JUDGED') && /解析不到提交/.test(out),
    expect: 'rc=2 / NOT_JUDGED（绝不 rc=0）',
  },
];

const results = [];

// ── 阳性对照：**未变异的基线必须先绿一次**。基线就红的话，臂"变红"不构成任何证据。
const ctrl = runGate();
console.log(
  `[CTRL] 未变异 ⇒ rc=${String(ctrl.rc)} ${ctrl.out.includes('RATCHET_RESULT=OK') ? 'OK' : '非 OK'} ` +
    `ROWS=${/\nROWS=(\S+)/.exec(ctrl.out)?.[1] ?? '?'}`,
);
if (ctrl.rc !== 0 || !ctrl.out.includes('RATCHET_RESULT=OK') || !ctrl.out.includes('ROWS=3/3')) {
  restoreAll();
  console.log('BASELINE 就不是干净的 OK —— 先修基线，变异台拒绝读数');
  console.log(ctrl.out);
  process.exit(1);
}

for (const arm of ARMS) {
  arm.act();
  const r = runGate(arm.env || {});
  const ok = arm.check(r);
  results.push({ id: arm.id, ok, why: arm.why, rc: r.rc, out: r.out });
  console.log(`[${arm.id}] ${arm.why} → rc=${String(r.rc)}（期望 ${arm.expect}）${ok ? '✅ 红得对' : '🔴 没红/红得不对'}`);
  if (!ok) console.log(r.out.split('\n').filter((l) => l.trim()).map((l) => `      ${l}`).join('\n'));
  restoreAll();
}

// ── 还原复验：两枚脚本必须逐字节回到基线。
let restored = true;
for (const f of TARGETS) {
  if (md5(readFileSync(f, 'utf8')) !== BASE_MD5.get(f)) restored = false;
}
console.log(`RESTORE ${restored ? '✅ 两枚脚本与基线 md5 逐字节相同' : '🔴 还原失败'}`);
if (restored) {
  const after = [L4, ROW].filter((f) => git(['status', '--porcelain', '--', rel(f)]).trim() !== '');
  console.log(`BACK_TO_CLEAN=${after.length === 0 ? 'true' : `false(${after.map(rel).join(',')})`}`);
  if (after.length) restored = false;
}
if (!restored) process.exit(1);

// ── 还原后再跑一次对照，证明这台变异台**没有把门禁本身弄坏**。
const ctrl2 = runGate();
console.log(`[CTRL2] 还原后 ⇒ rc=${String(ctrl2.rc)} ${ctrl2.out.includes('RATCHET_RESULT=OK') ? 'OK' : '非 OK'}`);

const survived = results.filter((r) => !r.ok).map((r) => r.id);
console.log('=== 汇总 ===');
for (const r of results) console.log(`${r.id} rc=${String(r.rc)} ${r.ok ? '红得对' : '🔴 存活'}`);
const dead = results.length - survived.length;
console.log(`RIG_RESULT=${survived.length === 0 && ctrl2.rc === 0 ? `臂 ${String(dead)}/${String(results.length)} 红 + 对照双向干净` : `🔴 存活臂=${survived.join(',') || '无'} 对照后效 rc=${String(ctrl2.rc)}`}`);
process.exit(survived.length === 0 && ctrl2.rc === 0 ? 0 : 1);
