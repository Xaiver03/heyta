#!/usr/bin/env node
// `scripts/verify-detail-pane-gate-sweep.mjs` 自己的两条臂 —— 证明它**会红**，而不是只会打印清单。
//
// 为什么需要它（工单 §4"判据必须配变异臂"）：那件扫描器是一台读数机器，它的价值全在
// "命中了会不会响亮地失败"。旧版 `/tmp/dp_gates_sweep.py` 正是反面教材 —— 无条件 `sys.exit(0)`，
// 于是"扫出 7 道红"和"全绿"在退出码上完全一样。本臂钉三条：
//  · A1：往根 `check` 组合里塞一道必然红的门禁 ⇒ 必须落进 RED= 且整体退 1；
//  · A2：塞一道 `pnpm --filter <包> <不存在的脚本>` ⇒ 必须落 UNRESOLVED（不降级成 SKIP ——
//        "解不开就跳过"正是让漏跑变得不可见的那台机制）；
//  · A3：`--only` 传一道不在组合里的名字 ⇒ 扫描器必须拒绝执行（PROBE_BROKEN / 退 2），
//        否则"注入根本没进分母"会被读成"注入的那道没红"。
// 另加一趟 CTRL：**未变异**的全量跑，两条注入症状都必须不在。
//
// ⚠️ 只改 `package.json` 的 scripts（check 组合 + 一条新脚本键），每臂跑完按 md5 逐字节还原，
// 还原证明打进输出；CTRL 那趟同时就是全组合的现量读数。
// ⚠️ 这台会**串行重跑门禁**，不要与别的验 dist/写产物的装置并行（AGENTS §8 第 9 条）。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PKG = join(ROOT, 'package.json');
const SWEEP = join(ROOT, 'scripts/verify-detail-pane-gate-sweep.mjs');
const RED_GATE = 'check:zz-rig-probe-red';
const UNRES_GATE = 'check:zz-rig-probe-unresolved';

const runSweep = (args = []) => {
  // 🔴 不要拼成 `node ${SWEEP} …` 丢给 shell：这个仓库的路径里**有空格**
  // （`…/All in one Data/…`），拼串会让 node 去执行 `/Users/…/All` 然后以
  // `Cannot find module` 崩掉 —— 症状是四臂同时 COMPOSED=NaN，看起来像扫描器坏了，
  // 实际是臂自己把路径拆断了（traps 里"管道后 $? 是 tail 的"同族：探针坏，读数全废）。
  // 用 process.execPath + argv 数组，既不经过 shell 也保证和被验方同一个 node。
  const r = spawnSync(process.execPath, [SWEEP, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const list = (re) => (re.exec(out)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    rc: r.status ?? -1,
    red: list(/^RED=(.*)$/m),
    unres: list(/^UNRESOLVED=(.*)$/m),
    composed: Number(/^COMPOSED=(\d+)/m.exec(out)?.[1] ?? NaN),
    filtered: /FILTERED=/.test(out),
    probeBroken: /SWEEP_RESULT=PROBE_BROKEN/.test(out),
    tail: out.split('\n').slice(-3).join(' ⏎ '),
  };
};

const base = readFileSync(PKG, 'utf8');
const BASE_MD5 = createHash('md5').update(base).digest('hex');
const restore = () => writeFileSync(PKG, base);

// 注入 = 追加一条脚本键 + 把它的名字挂进 check 组合末尾。
// 🔴 挂完必须**当场回读**确认它真在组合里：替换类注入不设这一步，就会出现
// "needle 没命中 ⇒ 组合里根本没有那道门 ⇒ 扫描器'没报红'被读成臂失败"这种反向假红。
const inject = (name, cmd) => {
  const obj = JSON.parse(base);
  obj.scripts[name] = cmd;
  obj.scripts.check = `${obj.scripts.check} && pnpm ${name}`;
  const text = JSON.stringify(obj, null, 2) + (base.endsWith('\n') ? '\n' : '');
  const back = JSON.parse(text);
  const inComposition = (back.scripts.check.match(/check:[a-z0-9-]+/g) || []).includes(name);
  if (!inComposition || back.scripts[name] !== cmd) {
    console.log(`🔴 注入未落到组合里（${name}）：inComposition=${inComposition} —— 拒绝跑这趟臂`);
    process.exit(2);
  }
  writeFileSync(PKG, text);
};

const checks = [];

inject(RED_GATE, 'node -e "process.exit(1)"');
{
  const s = runSweep(["--only", RED_GATE]);
  checks.push({
    id: 'A1',
    ok: s.rc === 1 && s.red.includes(RED_GATE) && !s.probeBroken && s.composed === 1,
    note: `rc=${s.rc} 落RED=${s.red.includes(RED_GATE)} COMPOSED=${s.composed} 收窄标记=${s.filtered}`,
  });
}
restore();

inject(UNRES_GATE, 'pnpm --filter @heyta/web zz-does-not-exist');
{
  const s = runSweep(["--only", UNRES_GATE]);
  checks.push({
    id: 'A2',
    ok: s.rc === 1 && s.unres.includes(UNRES_GATE) && !s.red.includes(UNRES_GATE),
    note: `rc=${s.rc} 落UNRESOLVED=${s.unres.includes(UNRES_GATE)} 未误落RED=${!s.red.includes(UNRES_GATE)}`,
  });
}
restore();

{
  const s = runSweep(['--only', 'check:zz-not-in-composition']);
  checks.push({
    id: 'A3',
    ok: s.rc === 2 && s.probeBroken,
    note: `rc=${s.rc} 拒绝执行=${s.probeBroken}（分母外的名字不许被读成"没红"）`,
  });
}

{
  const s = runSweep();
  const md5Now = createHash('md5').update(readFileSync(PKG, 'utf8')).digest('hex');
  checks.push({
    id: 'CTRL',
    ok:
      md5Now === BASE_MD5 &&
      !s.red.includes(RED_GATE) &&
      !s.unres.includes(UNRES_GATE) &&
      !s.filtered &&
      !s.probeBroken &&
      Number.isFinite(s.composed) &&
      s.composed > 20,
    note: `md5复原=${md5Now === BASE_MD5} 注入症状不在=${!s.red.includes(RED_GATE) && !s.unres.includes(UNRES_GATE)} COMPOSED=${s.composed} rc=${s.rc} ${s.tail}`,
  });
}

for (const c of checks) console.log(`[${c.id}] ${c.ok ? '✅' : '🔴'} ${c.note}`);
const bad = checks.filter((c) => !c.ok).map((c) => c.id);
console.log('BAD=' + (bad.join(',') || '无'));
console.log(`RIG_RESULT=${bad.length ? 'FAIL' : `臂 3/3 红 + 对照干净`}`);
process.exit(bad.length ? 1 : 0);
