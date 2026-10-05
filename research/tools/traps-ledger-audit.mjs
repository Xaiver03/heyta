#!/usr/bin/env node
// 环境陷阱台账的结构自检：重复号 / 缺号 / 中段插行 / 「文档里那条统计命令吃了多少行」。
//
// 为什么要单独一台装置而不是 `grep -cE '^[0-9]+\. '`：台账的规则是「编号只增不改」，
// 而并行会话各自在工作树现量取号时会撞号（2026-10-05 实测：`#38`、`#77`–`#82`、
// `#93`–`#95`、`#269` 各两枚，`#120` 根本不存在）。撞号的两枚在 `grep` 的计数里
// 只是「多一条」，谁都看不出来；更要命的是有一批条目行首带一个空格，
// `^[0-9]+\. ` 连数都数不到它们 —— 也就是说**台账自带的统计命令既漏计又无法查重**。
//
// 判"这行是条目"而不是"条目里的列表项"靠的是标记（🔴/⚠️/✅/📌/`**`），不是编号大小：
// 台账正文里合法地存在 `1.` `2.` `3.` 形状的嵌套列表项，且它们**缩进为零**（见自检臂 C）。
//
// 🔴 装置的局限，写在这里而不是藏在实现里：标记规则两边都会错。
//   · 台账开头 `#1`–`#3` 三条条目**没写标记**，所以它们不进"条目"集合 ——
//     缺号因此按"全部带编号的行"算，否则会把它们报成丢失（自检臂 G 钉住这条）。
//   · 反过来，若某条目正文里出现一枚带标记的零缩进列表项，它会被当成条目，
//     从而可能造出一个假重号。所以重号清单**要人过一遍**，装置只负责把它照出来。
//   · 装置不读 git，无法判断重号是"谁在什么时候撞的"；那要用 `git blame -L` 另查。
//
// 默认只报告、退出 0；`--strict` 有缺陷就退 1。**不接进 `pnpm check`** ——
// HEAD 上就已经躺着 12 对重号 + 1 枚缺号，接进去等于给全仓造一条恒红门
// （同 `check:doc-citations` 不放宽默认射程的判断，见计划 §10.109）。
//
// 用法：
//   node research/tools/traps-ledger-audit.mjs [path/to/traps.md]
//   node research/tools/traps-ledger-audit.mjs --strict
//   node research/tools/traps-ledger-audit.mjs --self-test
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_LEDGER = "docs/reference/environment-traps.md";
const ENTRY_MARKER = /^(🔴|⚠️|✅|📌|\*\*)/;

/** 把 markdown 行分成「条目 / 列表项 / 非条目」；代码围栏里的内容一律不算条目。 */
export function parseLedger(text) {
  const entries = [];
  const listItems = [];
  let inFence = false;
  text.split("\n").forEach((line, idx) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = line.match(/^( {0,1})(\d+)\. (.*)$/);
    if (!m) return;
    const record = { n: Number(m[2]), line: idx + 1, indent: m[1].length, rest: m[3] };
    if (ENTRY_MARKER.test(record.rest)) entries.push(record);
    else listItems.push(record);
  });
  return { entries, listItems };
}

/**
 * 台账的结构性缺陷：重号、缺号、比前文最大值小的「中段插行」。
 *
 * 🔴 两档口径不同，因为"这行是不是条目"这件事装置判不干净（见文件头的局限说明）：
 *  · 重号/插行只在**带标记的条目**里找 —— 否则条目正文里那些零缩进的 `1.` 列表项
 *    会造出一堆假重号（真树上就有 12 行这种）。
 *  · 缺号在**全部带编号的行**里找 —— 台账开头 `#1`–`#3` 恰好没写标记，
 *    只按标记集算缺号会把它们报成"丢失"。
 */
export function audit(entries, listItems = []) {
  const byNumber = new Map();
  for (const e of entries) {
    if (!byNumber.has(e.n)) byNumber.set(e.n, []);
    byNumber.get(e.n).push(e);
  }
  const duplicates = [...byNumber.entries()]
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => a[0] - b[0]);
  const max = entries.reduce((m, e) => Math.max(m, e.n), 0);
  const numberSpace = new Set([...entries, ...listItems].map((e) => e.n));
  const missing = [];
  for (let i = 1; i <= max; i += 1) if (!numberSpace.has(i)) missing.push(i);
  const outOfOrder = [];
  let highWater = 0;
  for (const e of entries) {
    if (e.n < highWater) outOfOrder.push({ ...e, highWater });
    highWater = Math.max(highWater, e.n);
  }
  const indented = entries.filter((e) => e.indent > 0);
  return { entries, listItems, byNumber, duplicates, missing, outOfOrder, indented, max };
}

const head = (e) => e.rest.replace(/\s+/g, " ").slice(0, 46);

export function report(result, file, strict) {
  const lines = [];
  const documentedCount = readFileSync(file, "utf8").split("\n").filter((l) => /^\d+\. /.test(l)).length;
  lines.push(`台账：${file}`);
  lines.push(
    `条目 ${result.entries.length} 枚（最大号 ${result.max}）· 嵌套列表项 ${result.listItems.length} 行未计入` +
      `· 文档里的 \`grep -cE '^[0-9]+\\. '\` 读到 ${documentedCount} 行`,
  );
  if (result.indented.length > 0) {
    lines.push(
      `⚠️ ${result.indented.length} 枚条目行首带空格，上面那条统计命令**数不到它们**：` +
        result.indented.map((e) => `#${e.n}@L${e.line}`).join(" "),
    );
  }
  if (result.duplicates.length === 0) lines.push("重号：无");
  else {
    lines.push(`🔴 重号 ${result.duplicates.length} 组：`);
    for (const [n, group] of result.duplicates) {
      lines.push(`   #${n} ×${group.length} —— ` + group.map((e) => `L${e.line}「${head(e)}」`).join("  /  "));
    }
  }
  lines.push(
    `缺号：${result.missing.length === 0 ? "无" : result.missing.join(", ")}` +
      `（口径：1..${result.max} 里没有任何带编号的行占位；条目正文里的列表项也算占位）`,
  );
  if (result.outOfOrder.length === 0) lines.push("中段插行：无");
  else {
    lines.push(`⚠️ ${result.outOfOrder.length} 枚条目的号小于它之前的最大号（「只增」的追加顺序被打断）：`);
    for (const e of result.outOfOrder) {
      lines.push(`   #${e.n}@L${e.line}（此时已见到 #${e.highWater}）「${head(e)}」`);
    }
  }
  const flawed = result.duplicates.length > 0 || result.missing.length > 0;
  lines.push(`STRUCTURE=${flawed ? "defects" : "clean"}${strict && flawed ? " strict=exit1" : ""}`);
  return { text: lines.join("\n"), flawed };
}

/** 自检：七臂 —— A/C/D/F/G 是"必须报错"的阳性对照，B 是挡恒红的阴性对照，E 管缩进形状。 */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "traps-audit-"));
  const pass = [];
  const fail = [];
  const check = (name, ok, detail) => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ""}`);
  const run = (name, body, expect) => {
    const file = join(dir, `${name}.md`);
    writeFileSync(file, body, "utf8");
    const parsedFile = parseLedger(readFileSync(file, "utf8"));
    const result = audit(parsedFile.entries, parsedFile.listItems);
    const gotDup = result.duplicates.map(([n]) => n).join(",");
    const gotMissing = result.missing.join(",");
    check(name, gotDup === expect.dup && gotMissing === expect.missing,
      `条目${result.entries.length}/列表项${result.listItems.length} 重号[${gotDup}] 缺号[${gotMissing}] ` +
        `期望 重号[${expect.dup}] 缺号[${expect.missing}]`);
  };

  // 臂 A：已知阳性 —— 同一号两枚，必须报重号。
  run("A-dup", "1. 🔴 甲\n\n2. 🔴 乙\n\n2. ⚠️ 乙的撞号者\n", { dup: "2", missing: "" });

  // 臂 B：阴性对照 —— 连续无缺号，必须一条不报（挡"恒红"）。
  run("B-clean", "1. 🔴 甲\n\n2. 🔴 乙\n\n3. 🔴 丙\n", { dup: "", missing: "" });

  // 臂 C：真树上就存在的形状 —— 条目正文里的列表项**缩进为零**，
  // 只能靠标记区分。把它们当条目会立刻造出假重号 [1,2]。
  run("C-nested", "1. 🔴 甲\n\n1. 修法（零缩进的列表项）\n2. 判据（零缩进的列表项）\n\n2. 🔴 乙\n",
    { dup: "", missing: "" });

  // 臂 D：缺号必须报到（挡"号段外整段没核"那种假结论）。
  run("D-gap", "1. 🔴 甲\n\n3. 🔴 丙\n", { dup: "", missing: "2" });

  // 臂 E：行首带空格的条目要能数到 —— 这正是台账自带命令漏掉的那一档。
  const file = join(dir, "E-indent.md");
  writeFileSync(file, "1. 🔴 甲\n\n 2. 🔴 乙（带一个行首空格）\n", "utf8");
  const parsedE = parseLedger(readFileSync(file, "utf8"));
  const auditedE = audit(parsedE.entries, parsedE.listItems);
  const byGrep = readFileSync(file, "utf8").split("\n").filter((l) => /^\d+\. /.test(l)).length;
  check("E-indent", auditedE.entries.length === 2 && auditedE.indented.length === 1 && byGrep === 1,
    `装置读到 ${auditedE.entries.length} 枚（其中行首带空格 ${auditedE.indented.length} 枚）/ ` +
      `台账自带的 grep 形状读到 ${byGrep} 行`);

  // 臂 F：中段插行（号小于此前最大值）要报到 —— 台账里 `#110` 就躺在 `#94`/`#95` 之间。
  const fileF = join(dir, "F-order.md");
  writeFileSync(fileF, "1. 🔴 甲\n\n3. 🔴 丙\n\n2. 🔴 后到的一条\n", "utf8");
  const parsedF = parseLedger(readFileSync(fileF, "utf8"));
  const auditF = audit(parsedF.entries, parsedF.listItems);
  check("F-order", auditF.outOfOrder.length === 1 && auditF.outOfOrder[0].n === 2,
    `插行读到 ${auditF.outOfOrder.map((e) => `#${e.n}@L${e.line}`).join(",") || "无"}`);

  // 臂 G：缺号口径要吃到"没写标记的那条编号行" —— 台账开头 `#1`–`#3` 就是这种形状。
  // 若按"标记条目"算缺号，这里会把 #1 报成丢失（装置真踩过，写在这里挡回潮）。
  const fileG = join(dir, "G-space.md");
  writeFileSync(fileG, "1. 没有标记的第一条（真树上 #1–#3 就是这个形状）\n\n2. 🔴 乙\n\n4. 🔴 丁\n", "utf8");
  const parsedG = parseLedger(readFileSync(fileG, "utf8"));
  const auditG = audit(parsedG.entries, parsedG.listItems);
  const missingIfMarkedOnly = (() => {
    const set = new Set(auditG.entries.map((e) => e.n));
    const out = [];
    for (let i = 1; i <= auditG.max; i += 1) if (!set.has(i)) out.push(i);
    return out.join(",");
  })();
  check("G-missing-space", auditG.missing.join(",") === "3" && missingIfMarkedOnly === "1,3",
    `装置缺号[${auditG.missing.join(",")}]（口径：全部编号行）/ 若只按标记条目算会是[${missingIfMarkedOnly}]`);

  rmSync(dir, { recursive: true, force: true });
  console.log(`SELFTEST=${fail.length === 0 ? "pass" : "FAIL"}`);
  for (const p of pass) console.log(`  ✓ ${p}`);
  for (const f of fail) console.log(`  ✗ ${f}`);
  return fail.length === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) process.exit(selfTest());

const file = argv.find((a) => !a.startsWith("--")) ?? DEFAULT_LEDGER;
const strict = argv.includes("--strict");
const parsed = parseLedger(readFileSync(file, "utf8"));
const result = audit(parsed.entries, parsed.listItems);
const { text, flawed } = report(result, file, strict);
console.log(text);
process.exit(strict && flawed ? 1 : 0);
