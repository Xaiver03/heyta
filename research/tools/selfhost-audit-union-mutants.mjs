// 一次性阳性对照（**从仓库根跑**：`node research/tools/selfhost-audit-union-mutants.mjs`）：
// 把判据本体逐条改坏，看 `selfhost-audit-union.mjs --selftest` 的臂是否**各自**转红。
// 它答的是二阶问题："自检那 12 条臂真绑在各自那条断言上了吗"，而不是一阶的"并集有没有吞人"（那是 --selftest 自己）。
// 改了 union 模块里任何一条断言，就要重跑这里 —— 否则臂可能悄悄由别的断言代抓（M5 第一版就是这样活的）。
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SRC = "research/tools/selfhost-audit-union.mjs";
const COPY = "research/tools/tmp-mut-audit-union.mjs";
const orig = readFileSync(SRC, "utf8");

const muts = [
  ["M1 并集退化成「取本分支侧」（丢掉追加那块）",
   "(first.stats.mainOnly ? `\\n\\n${banner}\\n` + first.mainOnlyList.join('\\n') + '\\n' : '')",
   "''"],
  ["M2 吞掉 main 独有行这条检测被摘",
   "const lostMain = mainOnlyList.filter((l) => l.trim() !== '' && !mSet.has(l));",
   "const lostMain = [];"],
  ["M3 吞掉本批自己的行这条检测被摘",
   "const lostSrc = nonEmpty(src).filter((l) => !mSet.has(l));",
   "const lostSrc = [];"],
  ["M4 混入两侧都没有的行这条检测被摘",
   "const invented = lines(text).filter((l) => !mainSet.has(l) && !srcSet.has(l) && l !== b);",
   "const invented = [];"],
  ["M5 冲突标记这条检测被摘",
   "const markers = /^<{7}/m.test(text) || /^>{7}/m.test(text) || /^\\|{7}/m.test(text);",
   "const markers = false;"],
  ["M6 告示牌缺失这条检测被摘",
   "const missingBanner = mainOnlySet.size > 0 && !lines(text).includes(b);",
   "const missingBanner = false;"],
];

let bad = 0;
try { for (const [name, needle, repl] of muts) {
  if (!orig.includes(needle)) {
    console.log(`BAD ${name} ⇒ 变异点没匹配上（判据换了写法，这条对照自己失效了）`);
    bad += 1;
    continue;
  }
  // 🔴 必须自己挂入口：本体用 realpath 比"我是不是入口"，副本换了文件名 ⇒ 不加这行
  //    自检一条臂都不跑，输出空、rc 0，长得和"变异没被抓到"一模一样。
  writeFileSync(COPY, orig.replace(needle, repl) + "\nif (process.argv.includes('--selftest')) runSelftest();\n");
  let out = "", rc = 0;
  try {
    out = execFileSync("node", [COPY, "--selftest"], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const reds = out.split("\n").filter((l) => l.startsWith("BAD"));
  const ok = rc !== 0 && reds.length > 0;
  if (!ok) bad += 1;
  console.log(`${ok ? "OK " : "BAD"} ${name} ⇒ rc=${rc} 红臂 ${reds.length} 条${reds.length ? `：${reds[0].slice(0, 70)}…` : ""}`);
}
} finally { rmSync(COPY, { force: true }); }

console.log(`对照臂数 ${muts.length} · 未转红 ${bad}`);
process.exit(bad === 0 ? 0 : 1);
