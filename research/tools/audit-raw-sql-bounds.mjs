#!/usr/bin/env node
/**
 * ③ 那一维最后一格"没量"的：裸 SQL 的读有没有界。
 * =================================================================
 *
 * ## 为什么要有它
 *
 * `audit-unbounded-read-paths.mjs` 数的是 Prisma 那层的列表读（有没有顶层 `take/skip/cursor`）。
 * 它的射程里明写着一句：**raw SQL 的 `WHERE` 有没有界没量**。
 * 而本仓 `server/src` 里 `$queryRaw` 一片（枚数由本尺打印在分母那行），
 * 那一面恰好是最容易漏的地方 —— Prisma 的尺看不见它，索引覆盖那把尺看的是 `where` 谓词也不是它。
 * 所以这一格从今天起不再是"没装置"。
 *
 * ## 判什么（四档，互斥且必须穷尽 ⇒ 有对账臂）
 *
 *   · **有界** —— 带 `LIMIT`；或外层投影**每条都含聚合**且不写 `GROUP BY`（Postgres 里这种查询只出一行，
 *      `COALESCE(SUM(…))`、`WITH … SELECT MAX(…)` 这些包装形状都算，代价见"不判什么"①b）；
 *      或根本没有表源（`SELECT clock_timestamp()` 那一族）；
 *   · 🟠 **无界的行列表读**（候选）—— `SELECT`/`WITH` 打头、既不 `LIMIT` 也不是"投影全是聚合"的单行查询（含 `GROUP BY` 那种会回多行的）；
 *   · ⚪ **写与 DDL** —— `INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE`：这一档**不判有没有界**
 *      （`UPDATE ... WHERE user_id = ?` 无 `LIMIT` 在 Postgres 里是正常形状，按"读没界"报它是假红；
 *       有界清理那类另由 `--mutate` 的臂钉住不被混进候选）；
 *   · 🔴 **判不了** —— tag 后面不是字面量（`$queryRawUnsafe(sql)`、变量拼接、模板里全是 `${}`），
 *     逐枚带 `file:line` ⇒ "判不了"是一张可以去开码的待办，不是一个数字。
 *
 * ## **不**判什么
 *
 * ① 不看 `WHERE` 的**选择性**：`WHERE user_id = ?` 逻辑上一行，静态读不出来，所以它仍落"候选"一档；
 *    ⇒ 候选必须逐枚开码才成判词（本尺的产出是"该看一眼的清单"，不是判词）。
 * ①b 聚合规则只在"投影**每条**都含聚合"时才敢判单行：混一个常量进去（`SELECT MAX(a), 1 FROM …`）
 *    就退回候选。方向是**多报**，代价由人来判；反向（带裸列的多行读被判成一行）是事故，臂 R20 钉住它。
 * ② 不做参数求值：`${limit}` 这种带变量的 `LIMIT` 也算"写了 LIMIT"（代价：变量被改成很大时读不出来）。
 * ③ 只看 `server/src`（运行时代码面）。`server/scripts`、`server/tests`、迁移 SQL 不进分母 ——
 *    它们是运维/取证面，无界读在那一面常常是**故意的**（全表体检、迁移计划），混进来只会淹掉该看的那几枚。
 * ④ 只认**挂在属性访问上**的 tag（`prisma.$queryRaw…`）。把 tag 解构出来再裸调
 *    （`const { $queryRaw } = prisma; queryRaw\`…\``）读不到；本仓现量只在该面读到 interface 的**成员声明**
 *    那一形（`--non-call` 把它连同注释/类型位里"说到的"一起逐枚列出，分母那行给对账）。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-raw-sql-bounds.mjs                # 诊断，恒退 0
 *   node research/tools/audit-raw-sql-bounds.mjs --strict        # 🟠 候选非空 ⇒ 退 1
 *   node research/tools/audit-raw-sql-bounds.mjs --non-call      # 打印没算进分母的 tag 位置与各自的理由
 *   node research/tools/audit-raw-sql-bounds.mjs --self-test     # 臂全绿 ⇒ 0
 *   node research/tools/audit-raw-sql-bounds.mjs --mutate        # 阳性对照（两向：有/无 LIMIT、投影全聚合/混裸列）
 *   分母为空 / 对账不成立 ⇒ 退 2（"我没干活"，不许读成"没有无界读"）
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { maskText, lineOf } from "./lib/text-mask.mjs";

const IS_ENTRY =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const argv = IS_ENTRY ? process.argv.slice(2) : [];
const TOP = (() => {
  const i = argv.indexOf("--top");
  return i >= 0 && /^\d+$/.test(argv[i + 1] ?? "") ? Number(argv[i + 1]) : 40;
})();

const SCOPE = "server/src/";
// 🔴 tag 形状有两种，**别按一种写**：`$queryRaw`/`$executeRaw` 是**标签模板**（后面直接跟反引号，可以夹一段泛型），
//    而 `$queryRawUnsafe`/`$executeRawUnsafe` 是**函数调用**（跟括号）。
//    第一版只写了带括号那一形 ⇒ 7 枚里只数到 1 枚（少报，比假红更坏）；是臂 R8 那句对账一把抓住的。
const TAG_NAME_RE = /\$(queryRawUnsafe|executeRawUnsafe|queryRaw|executeRaw)/g;

/**
 * tag 之后到**参数起点**（反引号／括号／引号）之间可能夹一段泛型。
 * 🔴 别按"第一个 `>`"切：实扫那批"判不了"里这一形是
 *    `tx.$queryRaw<\n  Array<{ id: number; password_hash: string | null }>\n>\`SELECT … FOR UPDATE\``
 *    —— 泛型**跨行且嵌套**，第一个 `>` 是 `Array<…>` 自己的闭括号，切在那儿就落在外层 `>` 上，
 *    于是把明明读得到字面量的调用报成"判不了"。盲区是这张尺唯一交得出去的待办，灌水它＝藏起真待办。
 *    规则：往后逐字符走，撞上参数起点就停；撞上语句边界（`;` `}`）⇒ 判不了。
 *    🔴 且**没看见 `<` 就不许换行**（臂 R17 钉这一条）：`pick(tx.$queryRaw)` 这种把 tag 当值用的写法，
 *    若不收紧就会一路走到**下一条语句**的反引号，把别人的 SQL 记到它头上。
 */
const MAX_ARG_LOOKAHEAD = 4096;
function argStart(text, from) {
  let sawGeneric = false;
  let depth = 0;
  let j = from;
  const stop = Math.min(text.length, from + MAX_ARG_LOOKAHEAD);
  while (j < stop) {
    const c = text[j];
    if (c === "`" || c === '"' || c === "'") return j;
    if (c === "<") sawGeneric = true;
    else if (c === "(") {
      if (depth === 0) return j;
      depth += 1;
    } else if (c === "{") depth += 1;
    else if (c === "}" || c === ")") {
      if (depth === 0) return -1;
      depth -= 1;
    }
    // 🔴 `;` 在对象类型里是**分隔符**（`Array<{ id: number; email: string }>` 一枚 `;` 都不代表语句结束），
    //    所以只在深度归零时才算语句边界；深度没归零就撞上 `;`，说明还在泛型里面。
    else if (c === ";") {
      if (depth === 0) return -1;
    } else if (c === "\n" && !sawGeneric) return -1;
    j += 1;
  }
  return -1;
}

/** 从 tag 后面的位置取一段模板字面量（或一个非字面量表达式），返回 SQL 文本或 null。 */
function readArg(text, at) {
  const c = text[at];
  if (c === '"' || c === "'") {
    const close = text.indexOf(c, at + 1);
    if (close < 0) return null;
    return { sql: text.slice(at + 1, close), interpolated: 0 };
  }
  if (c === "`") {
    let i = at + 1;
    let out = "";
    let interpolated = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === "`") return { sql: out, interpolated };
      if (ch === "$" && text[i + 1] === "{") {
        interpolated += 1;
        let depth = 1;
        i += 2;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
          i += 1;
        }
        out += "?"; // 插值位留一个占位，别把它整个抹掉：`WHERE id = ` 读起来像漏了条件
        continue;
      }
      out += ch;
      i += 1;
    }
    return null; // 模板没配上 ⇒ 判不了
  }
  return null; // 不是字面量（变量／拼接）⇒ 判不了
}

const AGG_CALL_RE =
  /\b(COUNT|SUM|MIN|MAX|AVG|BOOL_AND|BOOL_OR|EVERY|ARRAY_AGG|STRING_AGG|JSON_AGG)\s*\(/;

/**
 * 「最外层投影的每一个条目都含聚合函数」⇒ 这条查询**恰好出一行**，所以它有界。
 *
 * 🔴 为什么这个前提在 Postgres 里是安全的：聚合查询不写 `GROUP BY` 就只能返回一行；
 *    想在不进 `GROUP BY` 的情况下往投影里放一个裸列，Postgres 会**直接报错**
 *    （"column must appear in the GROUP BY clause"）⇒ 合法 SQL 里"每条都含聚合"等价于"一行"。
 *    所以只要有任何一个条目不含聚合（哪怕只有一个），本函数就**不判有界** ——
 *    代价是那种查询留在候选里由人来判（多报的方向是安全的；反过来把真·多行读判成"有界"才是事故）。
 * 为什么不写"整串里出现 `COUNT(` 就算"：`SELECT a, (SELECT COUNT(*) FROM x) FROM t` 有聚合、无 GROUP BY，
 *    却随 `t` 出多行 —— 那种写法会把无界读藏起来（臂 R20 的第二向钉的就是这一条）。
 *
 * 可见范围：从**深度 0** 的第一枚 `SELECT`（`WITH … ( SELECT … ) SELECT MAX(…)` 得挑外层那一枚）
 * 到它后面第一枚深度 0 的 `FROM`；单引号字面量先换成占位（`IN ('a', 'b')` 里那个逗号不该切条目）。
 */
function projectionIsAllAggregates(up) {
  const clean = up.replace(/'[^']*'/g, "'#'");
  let depth = 0;
  let start = -1;
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (
      depth === 0 &&
      c === "S" &&
      clean.startsWith("SELECT", i) &&
      !/[\w$]/.test(clean[i - 1] ?? " ") &&
      !/[\w$]/.test(clean[i + 6] ?? " ")
    ) {
      start = i + 6;
      break;
    }
  }
  if (start < 0) return false;
  depth = 0;
  const items = [""];
  // 🔴 括号**只用来配深度，不许被吃掉**：第一版把它们当分支消耗掉了，`COUNT(*)` 进了条目就成了 `COUNT`，
  //    而 `AGG_CALL_RE` 判的是"`COUNT(` 这种带括号的形状" ⇒ 每一条都不匹配 ⇒ 整枚函数恒假，
  //    实读比改之前还差（有界 6→4、候选 8→10）。是 R18/R19 两枚臂把这条恒假当场抓出来的。
  for (let i = start; i < clean.length; i += 1) {
    const c = clean[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (depth === 0 && c === ",") {
      items.push("");
      continue;
    } else if (
      depth === 0 &&
      c === "F" &&
      clean.startsWith("FROM", i) &&
      !/[\w$]/.test(clean[i - 1] ?? " ") &&
      !/[\w$]/.test(clean[i + 4] ?? " ")
    )
      break;
    items[items.length - 1] += c;
  }
  const list = items.map((s) => s.trim()).filter((s) => s !== "");
  return list.length > 0 && list.every((s) => AGG_CALL_RE.test(s));
}

/** 纯函数：给一段 SQL 文本定档。 */
export function classify(raw) {
  // 🔴 先剥注释再判形状：`--` 起头的 SQL 会被读成"既不是读也不是写"（臂 R7 第一发就是这么红的，
  //    而那发红得对 —— 它抓到的是分类器的洞，不是夹具的洞）。
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
  const flat = stripped.replace(/\s+/g, " ").trim();
  if (flat === "") return "unreadable";
  const up = flat.toUpperCase();
  const isWrite =
    /^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|COMMENT|GRANT|REVOKE|SET|BEGIN|COMMIT|ROLLBACK|LOCK)\b/.test(
      up,
    );
  if (isWrite) return "write";
  if (!/^(SELECT|WITH)\b/.test(up)) return "unreadable";
  // `SELECT ... FOR UPDATE` 那一族是**行锁**：它锁的是 WHERE 挑中的那几行，不是一趟扫描；
  // 单立一档而不是混进"有界"，因为它的界**来自 WHERE 的选择性**，那一点静态读不出来。
  if (/\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/.test(up))
    return "row-lock";
  if (/\bGROUP\s+BY\b/.test(up)) return "unbounded-read";
  if (/\bLIMIT\b/.test(up)) return "bounded";
  // 单行聚合：外层投影每条都含聚合（`WITH … SELECT MAX(…)`、`SELECT COALESCE(SUM(…),0), COUNT(*)` 都在这一形里），
  // 或 `SELECT EXISTS(…)`。第一版只认"`SELECT` 紧跟 `COUNT|SUM|MIN|MAX|AVG` 字首"，
  // 于是实扫 8 枚候选里 5 枚其实是单行聚合 ⇒ 让人反复去判一把尺自己判得了的东西。
  if (
    projectionIsAllAggregates(up) ||
    /^\(?\s*SELECT\s+EXISTS\s*\(/i.test(flat)
  )
    return "bounded";
  // 没有 FROM 的就是单行表达式（`SELECT clock_timestamp()` 那一族）。
  // 🔴 但 `extract(epoch FROM x)` 里那个 `FROM` **不是表源** —— 第一版就是被它骗了一枚
  //    （实扫候选里那条 `SELECT floor(extract(epoch from clock_timestamp())…)` 明明是单行表达式）。
  const tableSource = /\bFROM\b(?!\s+\w+\s*\))/i.test(
    up.replace(/EXTRACT\s*\([^)]*\)/gi, " EXTRACT_SOURCE "),
  );
  if (!tableSource) return "bounded";
  return "unbounded-read";
}

const countOf = (rows, tier) => rows.filter((r) => r.tier === tier).length;

export function scanFiles(files, read = (f) => readFileSync(f, "utf8")) {
  const rows = [];
  const dropped = [];
  let tagTotal = 0;
  let rawTotal = 0;
  for (const f of files) {
    let text = "";
    try {
      text = read(f);
    } catch {
      continue;
    }
    // 🔴 tag 只在**遮蔽后**的文本里找：文档注释里提到 `$queryRaw`、`Pick<Client, '$executeRaw'>` 这种
    //    类型位上列出的字符串字面量，都不是调用点。第一版吃原文 ⇒ 实扫把 12 枚"说到的"数进了分母，
    //    而且它们正好全落进 🔴 判不了那一档 —— 盲区被自己的探针灌水，比漏报更坏（臂 R15 钉住这一条）。
    //    那 12 枚逐枚开码看过，全是注释或类型位，没有一枚是真调用点。
    //    遮蔽等长、换行不动 ⇒ 偏移与行号与原文逐字对齐，所以下面切片仍切 `text`（SQL 字面量要原文）。
    const masked = maskText(text);
    const callAt = new Set();
    const reM = new RegExp(TAG_NAME_RE.source, "g");
    let mm;
    while ((mm = reM.exec(masked)) !== null) callAt.add(mm.index);
    // 🔴 两条形过滤各留一条尾巴（`--non-call` 逐枚打印）：**没算进分母的位置**也必须能现量，
    //    否则"分母 72"这句话就只有一枚数、没有出处 —— 那正是本仓 ② 维点名的形状。
    const re = new RegExp(TAG_NAME_RE.source, "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      rawTotal += 1;
      if (!callAt.has(m.index)) {
        dropped.push({
          file: f,
          line: lineOf(text, m.index),
          reason: "注释或字符串/类型位里说到的",
          at: m[0],
        });
        continue;
      }
      // 🔴 只有**挂在属性访问上**（`prisma.$queryRaw…`）才算调用点：
      //    `interface PrismaTransactionClient { $queryRawUnsafe<T>(sql): Promise<T> }` 那种是**成员声明**，
      //    不是查询。算进分母＝让"判不了"那张待办里坐着两条根本不是查询的声明行（臂 R22 钉这一条）。
      //    代价见头部"不判什么"④：把 tag 解构出来再单独调用、或裸调的写法读不到。
      if (text[m.index - 1] !== ".") {
        dropped.push({
          file: f,
          line: lineOf(text, m.index),
          reason: "声明位或使用位（前面没有 `.`，不是属性访问）",
          at: m[0],
        });
        continue;
      }
      tagTotal += 1;
      const start = argStart(text, m.index + m[0].length);
      const got = start < 0 ? null : readArg(text, start);
      const tier =
        got === null
          ? "unreadable"
          : got.sql.replace(/\s+/g, " ").trim() === ""
            ? "unreadable"
            : classify(got.sql);
      rows.push({
        file: f,
        line: lineOf(text, m.index),
        tag: m[1],
        tier,
        head: (got?.sql ?? "").replace(/\s+/g, " ").trim().slice(0, 72),
        interpolated: got?.interpolated ?? -1,
      });
    }
  }
  return { rows, tagTotal, dropped, rawTotal };
}

const listTracked = () =>
  execFileSync(
    "git",
    ["-c", "core.quotepath=off", "ls-files", "--", `${SCOPE}**/*.ts`],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  )
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.endsWith(".d.ts"));

/* ---------------- 臂 ---------------- */

const F = {
  "server/src/a.ts": [
    "const all = await prisma.$queryRaw`SELECT id, payload FROM operations WHERE user_id = ${u}`;\n",
    "const n = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM operations`;\n",
    "const page = await prisma.$queryRaw`SELECT id FROM operations ORDER BY id LIMIT 100`;\n",
    "const touch = await prisma.$executeRaw`UPDATE devices SET seen = now() WHERE id = ${d}`;\n",
    "const grouped = await prisma.$queryRaw`SELECT user_id, COUNT(*) FROM operations GROUP BY user_id`;\n",
    "const dyn = await prisma.$queryRawUnsafe(sqlString);\n",
    "const multi = await prisma.$queryRaw`\n",
    "  -- 注释与换行都不该改变判定\n",
    "  SELECT * FROM snapshots\n",
    "`;\n",
    "const lock = await prisma.$queryRaw`SELECT id FROM users WHERE id = ${u} FOR UPDATE`;\n",
    "const stamp = await prisma.$queryRaw`SELECT floor(extract(epoch from clock_timestamp())::numeric * 1000)::bigint AS ms`;\n",
    "// 这条给人读的说明里提到 prisma.$queryRaw，它**不是**调用点\n",
    'export type TagKind = "$queryRaw" | "$executeRaw";\n',
    "const after = await prisma.$queryRaw`SELECT id FROM credentials WHERE token = ${t} LIMIT 1`;\n",
    "const nested = await tx.$queryRaw<\n",
    "  Array<{ id: number; email: string; password_hash: string | null }>\n",
    ">`SELECT id, password_hash FROM users WHERE id = ${u} FOR UPDATE`;\n",
    "const asValue = await pick(tx.$queryRaw);\n",
    "interface TxPort {\n",
    "  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;\n",
    "  $executeRaw(sql: string): Promise<number>;\n",
    "}\n",
  ].join(""),
};
const FIXTURES = Object.keys(F);
const reader = (map) => (f) => map[f] ?? "";

function selfTest() {
  const arms = [];
  const push = (name, got, want) =>
    arms.push({
      name,
      ok: JSON.stringify(got) === JSON.stringify(want),
      got,
      want,
    });
  const r = scanFiles(FIXTURES, reader(F));
  const tierAt = (line) => r.rows.find((x) => x.line === line)?.tier;

  push(
    "R1 WHERE 等值但没 LIMIT 的行列表读 ⇒ 进候选（静态读不出选择性，所以是候选不是判词）",
    tierAt(1),
    "unbounded-read",
  );
  push("R2 单行聚合（COUNT(*)）⇒ 有界，不许进候选", tierAt(2), "bounded");
  push("R3 带 LIMIT ⇒ 有界", tierAt(3), "bounded");
  push(
    'R4 UPDATE/DELETE 归"写"一档，**不判有没有界**（在 Postgres 里无 LIMIT 是正常形状，报它是假红）',
    tierAt(4),
    "write",
  );
  push(
    "R5 GROUP BY 会回多行 ⇒ 即使每行是聚合也算无界读",
    tierAt(5),
    "unbounded-read",
  );
  push(
    "R6 tag 后面不是字面量（$queryRawUnsafe 收变量）⇒ 判不了，且必须带位置",
    tierAt(6),
    "unreadable",
  );
  push("R7 模板里的注释与换行不改变判定", tierAt(7), "unbounded-read");
  push(
    'R12 `SELECT ... FOR UPDATE` 是行锁，另立一档（混进候选就是把那 30 多枚行锁报成"扫全表"）',
    tierAt(11),
    "row-lock",
  );
  push(
    "R13 没有 FROM 的 SELECT 是单行表达式 ⇒ 有界（实扫第一版把它读成候选，就是假红一片）",
    tierAt(12),
    "bounded",
  );
  push(
    "R14 `extract(epoch FROM x)` 里那个 `FROM` 不是表源 ⇒ 单行表达式仍算有界（实扫第一枚假红就是它）",
    classify(
      "SELECT floor(extract(epoch from clock_timestamp())::numeric * 1000)::bigint AS ms",
    ),
    "bounded",
  );
  push(
    "R8 五档互斥且穷尽：分母枚数 == 各档之和",
    [
      r.tagTotal,
      countOf(r.rows, "bounded") +
        countOf(r.rows, "row-lock") +
        countOf(r.rows, "unbounded-read") +
        countOf(r.rows, "write") +
        countOf(r.rows, "unreadable"),
    ],
    [12, 12],
  );
  push(
    'R9 每一枚"判不了"都带 file:line（只报枚数等于把盲区藏起来）',
    r.rows
      .filter((x) => x.tier === "unreadable")
      .every((x) => !!x.file && x.line > 0),
    true,
  );
  push(
    "R10 同一枚 tag 不许被数两次（全局正则带 g，lastIndex 会串味）",
    new Set(r.rows.map((x) => `${x.file}:${x.line}`)).size,
    r.rows.length,
  );
  push(
    'R11 分母为空不许读成"没有无界读"：作用域外一律 0 枚',
    scanFiles([], () => "").tagTotal,
    0,
  );
  push(
    "R15 注释里说到的与字符串字面量里列出的 tag **不是调用点** ⇒ 不进分母；而夹在它们后面的真调用点不许被遮蔽顺手抹掉",
    [r.rows.filter((x) => x.line === 13 || x.line === 14).length, tierAt(15)],
    [0, "bounded"],
  );
  push(
    'R16 泛型**跨行且嵌套**（`$queryRaw<Array<{ a: number; b: string }>>`）⇒ 仍要读到模板：按"第一个 >"切就切在 `Array<…>` 自己的闭括号上，把实扫那一批明明读得到的调用报成判不了',
    [tierAt(16), r.rows.find((x) => x.line === 16)?.head.slice(0, 14)],
    ["row-lock", "SELECT id, pas"],
  );
  push(
    "R17 tag 当**值**用（`pick(tx.$queryRaw)`）⇒ 判不了，而且不许一路走到下一条语句去把别人的 SQL 记到它头上（head 必须空）",
    [tierAt(19), r.rows.find((x) => x.line === 19)?.head],
    ["unreadable", ""],
  );
  push(
    "R18 单行聚合被 COALESCE 包着 / 投影有多条聚合 ⇒ 仍是有界（实扫 8 枚候选里这一形占了大半，报成候选就是让人反复判尺自己判得了的东西）",
    classify(
      "SELECT COALESCE(SUM(payload_bytes), 0) AS exact_bytes, COUNT(*)::bigint AS n FROM operations WHERE user_id = 7",
    ),
    "bounded",
  );
  push(
    "R19 外层聚合写在 CTE 之后（`WITH … ( SELECT … FROM … ) SELECT MAX(…) FROM cand`）⇒ 有界：只认**深度 0** 那枚 SELECT，别把 CTE 里的读成外层",
    classify(
      'WITH cand AS MATERIALIZED ( SELECT user_id, server_seq FROM operations WHERE entity_ids @> ARRAY[$1]::text[] ) SELECT MAX(server_seq)::int AS "maxSeq" FROM cand WHERE user_id = $2',
    ),
    "bounded",
  );
  push(
    'R20 反向两牙（新规则不许把多行读判成"一行"）：投影里有裸列 ⇒ 候选；`GROUP BY` 优先于聚合；有聚合但只是**标量子查询**、外层还有裸列 ⇒ 仍是候选',
    [
      classify("SELECT id FROM operations WHERE user_id = 7"),
      classify("SELECT user_id, COUNT(*) FROM operations GROUP BY user_id"),
      classify("SELECT a, (SELECT COUNT(*) FROM x) AS c FROM t"),
    ],
    ["unbounded-read", "unbounded-read", "unbounded-read"],
  );
  push(
    "R21 `interface` 里的成员**声明**（前面没有 `.`，不是属性访问）不算调用点 ⇒ 不进分母、也不许凭空消失，要落在 --non-call 那张清单里",
    [
      r.rows.filter((x) => x.line === 21 || x.line === 22).length,
      r.dropped.filter((x) => x.line === 21 || x.line === 22).length,
    ],
    [0, 2],
  );
  push(
    'R22 对账：原文命中的 tag 总数 == 算进分母的 + 两条形过滤各自剔掉的（"分母 72"这句要有出处，不许只是一枚数）',
    [r.rawTotal, r.tagTotal + r.dropped.length],
    [17, 17],
  );

  const nums = arms.map((a) => Number(/^R(\d+)/.exec(a.name)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === new Set(nums).size;
  arms.push({
    name: `R${Math.max(...nums) + 1} 臂编号连续且不重号（判的是上面 ${arms.length} 枚）`,
    ok: seqOk,
    got: seqOk,
    want: true,
  });
  return arms;
}

/* ---------------- 阳性对照 ---------------- */

function mutate() {
  const base = scanFiles(FIXTURES, reader(F));
  const before = countOf(base.rows, "unbounded-read");
  const withOne = {
    ...F,
    "server/src/mut.ts":
      "const x = await prisma.$queryRaw`SELECT id FROM credentials WHERE token = ${t}`;\n",
  };
  const after = countOf(
    scanFiles(Object.keys(withOne), reader(withOne)).rows,
    "unbounded-read",
  );
  const withLimit = {
    ...F,
    "server/src/mut.ts":
      "const x = await prisma.$queryRaw`SELECT id FROM credentials WHERE token = ${t} LIMIT 1`;\n",
  };
  const after2 = countOf(
    scanFiles(Object.keys(withLimit), reader(withLimit)).rows,
    "unbounded-read",
  );
  // 🔴 第二条腿判的是**单行聚合**那条规则：同一枚查询，投影从"全是聚合"换成"带一个裸列"就该从有界弹回候选。
  //    只测 LIMIT 那一向，就可能把"聚合规则写错了、把多行读判成一行"这种**漏报**留在尺里没人知道。
  const aggOnly = {
    ...F,
    "server/src/mut2.ts":
      "const x = await prisma.$queryRaw`SELECT COALESCE(SUM(b), 0) AS n FROM operations WHERE user_id = ${u}`;\n",
  };
  const aggWithCol = {
    ...F,
    "server/src/mut2.ts":
      "const x = await prisma.$queryRaw`SELECT id, COALESCE(SUM(b), 0) AS n FROM operations WHERE user_id = ${u}`;\n",
  };
  const aggA = countOf(
    scanFiles(Object.keys(aggOnly), reader(aggOnly)).rows,
    "unbounded-read",
  );
  const aggB = countOf(
    scanFiles(Object.keys(aggWithCol), reader(aggWithCol)).rows,
    "unbounded-read",
  );
  console.log(`基线无界读 ${before} 枚`);
  console.log(
    `腿一：注入一枚等值 WHERE 不带 LIMIT ⇒ ${after}（期望 +1）｜ 同一枚补上 LIMIT ⇒ ${after2}（期望回 ${before}）`,
  );
  console.log(
    `腿二：注入"投影全是聚合"的单行查询 ⇒ ${aggA}（期望回 ${before}）｜ 同一枚加一个裸列 ⇒ ${aggB}（期望 +1，聚合规则不许把多行读判成一行）`,
  );
  const ok =
    after === before + 1 &&
    after2 === before &&
    aggA === before &&
    aggB === before + 1;
  console.log(
    ok
      ? '✅ 变异臂：候选随"有没有 LIMIT"和"投影里是不是全是聚合"两向起落 —— 它不是永远绿的形状。'
      : "🔴 变异臂不成立 ⇒ 这一档没牙。",
  );
  return ok ? 0 : 1;
}

function main() {
  if (argv.includes("--self-test")) {
    const arms = selfTest();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms)
      console.log(
        `${a.ok ? "✅" : "🔴"} ${a.name}${a.ok ? "" : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`,
      );
    console.log(`\n臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  if (argv.includes("--mutate")) process.exit(mutate());

  const files = listTracked();
  if (files.length === 0) {
    console.error(
      `🔴 ${SCOPE} 一枚 .ts 都没枚举到 ⇒ 分母为空，这一趟不算"没有无界读"。`,
    );
    process.exit(2);
  }
  const { rows, tagTotal, dropped, rawTotal } = scanFiles(files);
  if (tagTotal === 0) {
    console.error(
      `🔴 ${SCOPE} 里一枚裸 SQL tag 都没抓到 ⇒ 抽取形状八成变了，这不算"没有无界读"。`,
    );
    process.exit(2);
  }
  if (rawTotal !== tagTotal + dropped.length) {
    console.log(
      "🔴 分母对账不成立：原文命中 ≠ 算进的 + 剔掉的 ⇒ 有形过滤在悄悄吞位置。",
    );
    process.exit(2);
  }
  const parts = [
    "bounded",
    "row-lock",
    "unbounded-read",
    "write",
    "unreadable",
  ].reduce((s, t) => s + countOf(rows, t), 0);
  const cand = rows.filter((x) => x.tier === "unbounded-read");
  const blind = rows.filter((x) => x.tier === "unreadable");
  console.log(
    `作用域 ${SCOPE}（运行时面；scripts/tests/迁移 SQL 不在分母里，见头部③） ｜ 文件 ${files.length} 枚 ｜ 原文命中 tag ${rawTotal} 枚 − 非调用点 ${dropped.length} 枚（--non-call 逐枚打印）= 调用点 ${tagTotal} 枚`,
  );
  console.log(
    `有界（LIMIT 或单行聚合或无 FROM 表达式）${countOf(rows, "bounded")} ｜ 行锁（SELECT ... FOR UPDATE，界来自 WHERE 的选择性）${countOf(rows, "row-lock")} ｜ 🟠 无界的行列表读 ${cand.length} ｜ 写与 DDL（不判界）${countOf(rows, "write")} ｜ 🔴 判不了 ${blind.length}`,
  );
  if (parts !== tagTotal) {
    console.log("🔴 对账不成立 ⇒ 分档漏计，本趟读数不可信。");
    process.exit(2);
  }
  if (argv.includes("--non-call")) {
    console.log(
      `\n没算进分母的 ${dropped.length} 枚位置（两条形过滤各自的出处，逐枚可查）：`,
    );
    for (const d of dropped.slice(0, TOP))
      console.log(`   ${d.file}:${d.line}  ${d.at}  —— ${d.reason}`);
    if (dropped.length > TOP)
      console.log(`   …另有 ${dropped.length - TOP} 枚（加 --top 500 全列）`);
  }
  if (cand.length) {
    console.log(
      "\n🟠 候选（逐枚开码才成判词：等值 WHERE 逻辑上一行，静态读不出来）：",
    );
    for (const c of cand.slice(0, TOP))
      console.log(`   ${c.file}:${c.line}  ${c.tag}  「${c.head}」`);
    if (cand.length > TOP)
      console.log(`   …另有 ${cand.length - TOP} 枚（加 --top 500 全列）`);
  }
  if (blind.length) {
    console.log(
      "\n🔴 判不了那几枚的位置（tag 后面不是字面量，得去读那个变量是谁拼的）：",
    );
    for (const b of blind.slice(0, TOP))
      console.log(`   ${b.file}:${b.line}  ${b.tag}`);
  }
  console.log(
    `\n候选 ${cand.length} 枚 ｜ 诊断尺默认退 0，加 --strict 才因候选判红（两向自证：--self-test / --mutate）`,
  );
  process.exit(argv.includes("--strict") && cand.length > 0 ? 1 : 0);
}

if (IS_ENTRY) main();
