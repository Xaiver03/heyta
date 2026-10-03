// §7 台账自检装置的四臂变异验证。
//
// 为什么存在：`docs/research/performance-hotpaths-audit.md` §4 那段 awk 自检是一条门禁。
// 门禁能不能失败只有变异能回答。
//
// 🔴 期望值一律从**未变异的基线读数**推导，不写死数字。
// 上一版把"已闭合 3 条(第 10 11 12 条)"抄进装置里，台账闭合进度一变，
// 臂 0/臂 1 就双双 FAIL —— 那是"装置过期"，不是"门禁坏了"。
//
// 用法：node research/tools/audit-self-check-mutation.mjs [文档路径]
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import path from "node:path";

const DOC = process.argv[2] || "docs/research/performance-hotpaths-audit.md";
const orig = fs.readFileSync(DOC, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heyta-s7-mut-"));
const progFile = path.join(tmp, "s7prog.awk");
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
process.on("exit", cleanup);

// --- 从文档里现抽 awk 程序（不抄第二份；抄一份就是"同一个判断写两遍"） ---
const lines = orig.split("\n");
const anchor = lines.findIndex((l) => l.includes("§7 台账自检"));
if (anchor < 0) { console.log("抽不出 awk 段：没找到 `§7 台账自检` 锚点，装置失效"); process.exit(9); }
const start = lines.findIndex((l, i) => i > anchor && /^awk '$/.test(l.trim()));
const endRel = lines.findIndex((l, i) => i > start && l.startsWith("}' $D"));
if (start < 0 || endRel < 0) { console.log("抽不出 awk 段：起止形状变了，装置失效"); process.exit(9); }
const prog = lines.slice(start + 1, endRel).join("\n");
fs.writeFileSync(progFile, prog.endsWith("}") ? prog + "\n" : prog + "\n}\n");

function run(text) {
  const f = path.join(tmp, "arm.md");
  fs.writeFileSync(f, text);
  const r = cp.spawnSync("awk", ["-f", progFile, f], { encoding: "utf8" });
  return { rc: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

// --- 基线：解析读数并检查它自己是否自洽 ---
const READ = /^§7 登记 (\d+) 条 \/ 最大号 (\d+) \/ 缺号 \[([^\]]*)\] \/ 已闭合 (\d+) 条(?:\(第 ([^)]*) 条\) \/ 未闭合 (\d+))?/;
function parse(out) {
  const m = READ.exec(out);
  if (!m) return null;
  // ⚠️ awk 把"没有缺号"打印成 `缺号 [无]`（`(miss==""?"无":miss)`），不是空串。
  const missRaw = m[3].trim();
  return {
    k: +m[1], max: +m[2], miss: missRaw === "无" ? "" : missRaw, missRaw,
    closed: m[5] ? m[5].trim().split(/\s+/).map(Number) : [],
    u: m[6] === undefined ? null : +m[6], raw: out,
  };
}

const base = run(orig);
const b = parse(base.out);
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `\n     ${detail}` : ""}`);
}

if (base.rc !== 0 || !b) {
  check("臂0 基线可解析", false, `rc=${base.rc} 出=[${base.out}] stderr=[${base.err.split("\n")[0]}]`);
  console.log("\n基线就没跑通 —— 后面的臂全部作废，先修自检或装置");
  process.exit(1);
}
check(
  `臂0 基线自洽（登记 ${b.k} = 闭合 ${b.closed.length} + 未闭合 ${b.u}；最大号 ${b.max}；缺号 [${b.miss || "无"}]）`,
  b.k > 0 && b.max === b.k && b.miss === "" && b.u === b.k - b.closed.length &&
    b.closed.every((n) => n >= 1 && n <= b.max) && new Set(b.closed).size === b.closed.length,
  base.out
);

// §7 正文区间（变异只在区间内做，别误伤文档里别的编号列表）
const s7 = lines.findIndex((l) => /^## 7\./.test(l));
const s8 = lines.findIndex((l) => /^## 8\./.test(l));
const inSection = (i) => i > s7 && i < s8;

// --- 臂1：抹掉"某一个已闭合项"的标记 ⇒ 闭合数必须少 1，且不点名它 ---
if (b.closed.length === 0) {
  check("臂1 抹标记", false, "台账 0 条闭合 ⇒ 本臂没有靶子，装置当前对『闭合判定』这一维没有牙");
} else {
  const target = b.closed[b.closed.length - 1];
  const idx = lines.findIndex((l, i) => inSection(i) && new RegExp(`^${target}\\. `).test(l));
  if (idx < 0) {
    check(`臂1 抹掉第 ${target} 条的标记`, false, "找不到那条编号行");
  } else {
    const mutated = lines[idx]
      .replace("✅", "")
      .replace("已闭合", "闭合");
    const copy = lines.slice();
    copy[idx] = mutated;
    if (mutated === lines[idx]) {
      check(`臂1 抹掉第 ${target} 条的标记`, false, "该条既没有 `✅` 也没有 `已闭合` 字面 ⇒ 它当初是靠别的形状被算成闭合的，基线可疑");
    } else {
      const r = run(copy.join("\n"));
      const p = parse(r.out);
      const expectClosed = b.closed.filter((n) => n !== target);
      check(
        `臂1 抹掉第 ${target} 条的标记 ⇒ 闭合应少 1（第 ${expectClosed.join(" ") || "无"} 条）`,
        r.rc === 0 && !!p && p.closed.length === b.closed.length - 1 &&
          p.closed.join(" ") === expectClosed.join(" ") && p.u === b.u + 1,
        r.out || r.err.split("\n")[0]
      );
    }
  }
}

// --- 臂2：把"最大号减 1"那条的编号改成 `Nx` ⇒ 缺号必须点名 N，登记数少 1 ---
// 🔴 不能删最大号自己：awk 的 `max` 是从现存编号现取的，把最大项摘掉 max 会跟着降，
//    于是"缺号"这一维反而**报无缺号** —— 那是装置的期望错，不是门禁没牙（实测过）。
//    基线既然报"缺号 [无]"，1..max 每一项都在，取 max-1 必然存在且删掉必留洞。
const hole = b.max - 1;
const maxLine = hole >= 1
  ? lines.findIndex((l, i) => inSection(i) && new RegExp(`^${hole}\\. `).test(l))
  : -1;
if (maxLine < 0) {
  check(`臂2 造缺号（改第 ${hole} 条编号）`, false, "找不到那一行（或号段只有一项，本臂无靶子）");
} else {
  const copy = lines.slice();
  copy[maxLine] = copy[maxLine].replace(new RegExp(`^${hole}\\. `), `${hole}x. `);
  const r = run(copy.join("\n"));
  const p = parse(r.out);
  check(
    `臂2 造缺号 ⇒ 登记 ${b.k - 1} 条 / 最大号仍 ${b.max} / 缺号点名 [${hole}]`,
    r.rc === 0 && !!p && p.k === b.k - 1 && p.max === b.max && p.miss === String(hole),
    r.out || r.err.split("\n")[0]
  );
}

// --- 臂3：把 §7 标题锚点改名 ⇒ 新守卫必须 rc=1 并且说话（不能静默报 0 条） ---
const a3 = orig.replace(/^## 7\./m, "## 七、");
if (a3 === orig) {
  check("臂3 锚点改名", false, "没命中 `^## 7.`，装置与自检的锚点已经不一致");
} else {
  const r = run(a3);
  check(
    "臂3 锚点改名 ⇒ rc=1 且打印『§7 自检失效』",
    r.rc === 1 && r.out.includes("自检失效"),
    `rc=${r.rc} 出=[${r.out}]`
  );
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length} 臂：${results.length - failed.length} 对 / ${failed.length} 不对${failed.length ? " ❌" : " ✅"}`);
process.exit(failed.length ? 1 : 0);
