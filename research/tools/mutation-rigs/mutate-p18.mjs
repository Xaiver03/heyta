// 变异验证：把 P1-8 的病根写回去，两条判据必须都红；然后恢复并确认复绿。
// try/finally 保证无论 vitest 怎么退都恢复原文件。
import fs from "node:fs";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const FILE = `${ROOT}/server/src/admin/admin.routes.ts`;
const GOOD = "prisma.couponRedemption.count({ where: { settledAt: { not: null } } }),";
const BAD = "prisma.couponRedemption.count({ where: { state: 'settled' } }),";

const orig = fs.readFileSync(FILE, "utf8");
if (!orig.includes(GOOD)) { console.log("前提不成立：找不到修好的那一行，放弃变异"); process.exit(9); }

function run() {
  const r = cp.spawnSync("npx", ["vitest", "run", "tests/admin-routes.spec.ts"], {
    cwd: `${ROOT}/server`,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 300000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = /Tests\s+(?:(\d+) failed(?:.*?(\d+) passed)?|(\d+) passed)/.exec(out);
  const failed = m ? Number(m[1] ?? 0) : -1;
  const passed = m ? Number(m[2] ?? m[3] ?? -1) : -1;
  const names = [...new Set([...out.matchAll(/^\s*[×✕]\s+(.+?)$/gm)].map((x) => x[1].trim()))];
  return { failed, passed, names, rc: r.status, out };
}

const verdict = {};
let TOTAL = -1;
try {
  // 🔴 先跑一次**未变异对照**拿住这套件的总数，恢复后的那条判据要和它比，
  // 而不是和写死的 15 比 —— 上一版写死 `b.passed === 15`，而这份 spec 现在是 18 条，
  // 于是**变异确实杀死了判据（两条红都点名）**，装置却整体报"判据没牙或有副作用"。
  // 这就是"阈值要从被约束的常量推导"那条纪律的第三种踩法。
  console.log("【未变异对照】");
  const c = run();
  console.log(`  失败=${c.failed} 通过=${c.passed} rc=${c.rc}`);
  TOTAL = c.passed;  verdict["对照可信（跑到 >=15 条且全绿）"] = c.failed === 0 && TOTAL >= 15;
  verdict["对照退出码 0"] = c.rc === 0;

  fs.writeFileSync(FILE, orig.replace(GOOD, BAD));
  console.log("【变异：把 state:'settled' 写回去】");
  const a = run();
  console.log(`  失败=${a.failed} 通过=${a.passed} rc=${a.rc}`);
  for (const n of a.names) console.log("    红：" + n);
  verdict["两条都红"] = a.failed === 2;
  verdict["点名行为判据"] = a.names.some((n) => n.includes("settledAt"));
  verdict["点名词表判据"] = a.names.some((n) => n.includes("词表"));
} finally {
  fs.writeFileSync(FILE, orig);
  console.log("【恢复原文件后复跑】");
  const b = run();
  console.log(`  失败=${b.failed} 通过=${b.passed} rc=${b.rc}`);
  verdict["恢复后全绿"] = b.failed === 0 && b.rc === 0 && b.passed === TOTAL;
  verdict["文件确实已还原"] = fs.readFileSync(FILE, "utf8").includes(GOOD);
}
const ok = Object.values(verdict).every(Boolean);
for (const [k, v] of Object.entries(verdict)) console.log(`  ${v ? "✅" : "❌"} ${k}`);
console.log(ok ? "⇒ 这两条判据有牙" : "⇒ 判据没牙或有副作用，别收这一格");
process.exit(ok ? 0 : 1);
