#!/usr/bin/env node
/**
 * 对账件自检：**每一条断言，背后有没有一个可复跑的判据**。
 * ========================================================
 *
 * ## 它回答的问题
 *
 * [`docs/plans/launch-blockers.md`](../../docs/plans/launch-blockers.md) 的立件承诺是
 * 「**每条都带当日现量命令** —— 抄数无效」。但那句承诺**它自己没人守**：
 * 一条断言可以只有一句散文（"实测 403"）而没有命令，读的人无从复跑。
 *
 * 本工具把 §1 / §2 的每一行按**它引用了什么**分类，并**打印**那张表：
 *
 * | 类 | 判据 |
 * |---|---|
 * | `判据` | 行里点了一个**可跑的东西** —— `pnpm <check:\*\|verify:\*>`、`node scripts/…`、`scripts/…\.sh` |
 * | `外部` | 行里自己说明卡在**外部条件/某人**上（律师、业主、实体机、管局…） |
 * | `散文` | **两者都不是** —— 只有读数、没有出口。这一档就是要盯的 |
 *
 * ⚠️ **它是读数，不是门禁**：`散文` 不必然是错的（一条断言的证据可以在**别的行**里，
 * 或者它本来就是一条决定）。所以它**不进 `pnpm check` 链**，只在你审这一页时跑一次，
 * 防止"这一页越来越长、可复跑的那部分越来越稀"这件事**没人发现**。
 *
 * ## 用法
 *
 *   node research/tools/blocker-evidence-audit.mjs          # 打印表格 + 计数
 *   node research/tools/blocker-evidence-audit.mjs --brief   # 只打印计数与"散文"那一档
 *   node research/tools/blocker-evidence-audit.mjs --decisions # 改查 §7：每条决定有没有写"选项/后果"
 *   node research/tools/blocker-evidence-audit.mjs --zero-claims # 清点所有"零命中"类断言
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { checkInsert } from '../../scripts/safe-table-row.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LEDGER = join(ROOT, 'docs/plans/launch-blockers.md');

/** 行里出现这些形状之一 ⇒ 这一条有**可复跑**的出口。 */
const RUNNABLE = [
  // 🔴 第一版只认 `pnpm check:*` / `pnpm verify:*`，于是把 A1 那样的行误判成"散文" ——
  //    而那一行里明明写着 `verify:downloads-servable`，只是**没带 `pnpm` 前缀**。
  //    实测那句错判把 13 条打成"散文"（真数远小于此）。**先核探测、再下结论。**
  /`pnpm\s+(check|verify):[a-z0-9:-]+`/,
  /`(check|verify):[a-z0-9:-]+`/, // 裸门禁名（`check:payment-entry`、`verify:i18n-failures`）
  // 🔴 **2026-10-16 放宽**：原式要求反引号**紧跟在 `.mjs` 后** ⇒
  //    `node research/tools/blocker-evidence-audit.mjs --bullet-structure` 这种**带参数的**认不出来，
  //    于是 B53 被判成"散文"（而它明明有命令）。**带 flag 的命令当然也是可跑的。**
  /`node\s+[a-z0-9/._-]+\.mjs(\s+--?[a-z-]+)*`/,
  /`npx?\s+vitest[^`]*`/,
  /`scripts\/[a-z0-9.-]+\.(sh|mjs)`/,
  /`[a-z0-9/-]*scripts\/[a-z0-9.-]+\.mjs`/,
  /`research\/tools\/[a-z0-9.-]+\.mjs`/,
  // 🔴 第三次放宽：**不带路径的脚本名也算**（`upload-dist.sh`、`gen-downloads.mjs --check`）
  //    —— 它们都是有出处的可跑物，只是行文里省了目录。
  /`[a-z0-9][a-z0-9.-]*\.(mjs|sh)(\s+--?[a-z-]+)*`/,
  /`pnpm\s+[a-z0-9:-]+`/, // 整条链 `pnpm check` 也算一个出口
  /`pnpm\s+--filter\s+\S+\s+test`/, // 跑某个包的测试套件
  // 🔴 **第四次放宽**（2026-10-16）：**测试文件本身也是一个可跑出口**。
  //    漏掉它会把 B20 那种"判据是一条用例"的行误判成"散文" —— 而那条用例
  //    恰恰就是这一族里唯一能失败的东西。照旧：先核探测，再下结论。
  /`[a-z0-9/._-]*tests?\/[a-z0-9._-]+\.spec\.tsx?`/,
  // 🔴 **2026-10-16 加 `grep`**：B62 那轮写出的自检就是三条 `grep`，而当时它们**不算出口** ⇒ 整行被判成「散文」。
  //    但 `grep` 是**真可复跑**的（它验的是「这东西在不在」）⇒ 不算它，等于说「用 grep 的自检不是判据」。
  /`grep\s+-?[a-zA-Z]*\s*["']?[^`]+`/,
  /`lipo -archs`/, /`hdiutil`/, /`aapt2 dump`/, /`dpkg -l`/, /`git status`/,
];

/** 行里自己说明卡在外部 ⇒ 这一条今天**不可能**有本地判据，但那要说出来。 */
const EXTERNAL = [
  /外部条件/, /外部依赖/, /业主本人/, /执业律师/, /管局/, /实体 ?iPhone/, /真机/,
  /需要.{0,6}(一台|相应).{0,6}(机器|设备)/, /花钱/, /Apple/,
];

/**
 * **自报**的两档。⚠️ 它们靠写的人**诚实**，不靠机器 —— 写一句话就能进这两档，
 * 所以这个工具度量的是"**有没有人停下来想过**"，不是"是不是真的判不了"。
 * （写在这里，免得后来者把它读成一条能自动判的规则。）
 */
const MERGED = /【\d{4}-\d{2}-\d{2} 归并】|【\d{4}-\d{2}-\d{2} 撤回】/;
const HUMAN = /今天(并)?没有可跑判据|只能由人(工)?(读|判)/;

/** §1/§2 的行：`| **A1** ... |`。⚠️ §7 的决定表用的是同形编号，所以只扫 §5 之前。 */
export function parseRows(markdown) {
  const lines = markdown.split('\n');
  const stop = lines.findIndex((line) => line.startsWith('## 5.'));
  const scope = stop === -1 ? lines : lines.slice(0, stop);
  const rows = [];
  for (const line of scope) {
    const hit = /^\| \*\*([AB]\d+)\*\*[^\n]*/.exec(line);
    if (hit === null) continue;
    rows.push({ id: hit[1], text: line });
  }
  return rows;
}

export function classify(text) {
  // ⚠️ **顺序是被一次实测逼出来的**：
  //    第一版把 RUNNABLE 放在 HUMAN 前面，于是 B9 被归成"判据" —— 因为它里面引了一句
  //    `check:pricing`，而那门禁比的是**金额**、**不覆盖**那一行（那一行自己写着"今天没有可跑判据"）。
  //    ⇒ 一条**明确说自己没有判据**的行，比"引了一个不覆盖它的门禁"更可信；
  //      所以 HUMAN 排在 RUNNABLE 前面。代价是"写一句自报就能进这一档"，见上面的 MERGED/HUMAN 注释。
  if (MERGED.test(text)) return '归并';
  if (HUMAN.test(text)) return '人工';
  if (RUNNABLE.some((re) => re.test(text))) return '判据';
  if (EXTERNAL.some((re) => re.test(text))) return '外部';
  return '散文';
}

/**
 * §7.1 / §7.2 的决定表：`| **编号** | 要决定什么 | 选项 | 不决定的后果 |`。
 *
 * ⚠️ 编号那一格可能是 `**A1** × **A2**`（一条决定盖两行），所以**不能**假设
 * 第一格只有一个编号 —— 第一版正则就是这样漏掉了 A1×A2（15/16）。
 */
export function parseDecisions(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('### 7.1'));
  const stop = lines.findIndex((line) => line.startsWith('### 7.4'));
  if (start === -1 || stop === -1) return [];
  const rows = [];
  for (const line of lines.slice(start, stop)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // ['', 编号, 要决定什么, 选项, 后果, ''] —— 首尾各一个空串
    if (cells.length < 6) continue;
    const id = cells[1].replace(/\*\*/g, '');
    if (!/^(§4\.\d|[AB]\d+)/.test(id)) continue;
    rows.push({ id, options: cells[3], consequence: cells[4] });
  }
  return rows;
}

/**
 * 纯判据：一条决定的"选项"与"不决定的后果"都要**有实质内容** ——
 * 一个写着 `—` 的选项等于"没有选项"，读的人只能自己去想，
 * 而那一行仍然占着"已登记"的样子。
 */
export function decisionProblems(rows) {
  const problems = [];
  for (const row of rows) {
    const bare = (t) => t.replace(/[*\s]/g, '');
    if (bare(row.options).length < 6 || /^[—-]+$/.test(row.options)) {
      problems.push(`${row.id}：**选项**那一格是空的或占位`);
    }
    if (bare(row.consequence).length < 10) {
      problems.push(`${row.id}：**不决定的后果**那一格太短`);
    }
  }
  return problems;
}


/**
 * **"零命中"类断言的全量清点**（`--zero-claims`）。
 *
 * 🔴 为什么单列这一档：本会话已经出现**两次**"零命中"其实是**探针选错了名字** ——
 * `managed/chat`（URL 是函数拼的）与 `share-api-client`（真正的用法是 import 那个**类名**）。
 * 两次都是"**没命中**"被读成了"**不存在**"。
 * ⇒ 这一档要求每条零命中断言**写明它 grep 的是什么名字**，好让人一眼能复核。
 */
const ZERO_PATTERNS = [
  /零调用点/g,
  /零命中/g,
  /零消费者/g,
  /零生产调用/g,
  /一个调用点都没有/g,
  /零处(?!理)/g,
  /零引用/g,
  /没有(任何)?调用点/g,
  /零调用方/g,
];

/** 抽出一行里所有"零命中"类的说法。 */
export function zeroClaims(text) {
  const hits = [];
  for (const re of ZERO_PATTERNS) {
    const m = text.match(re);
    if (m !== null) hits.push(...m);
  }
  return hits;
}

/** 这一行有没有**写明探针**（反引号里的名字/正则/命令）。 */
export function statesProbe(text) {
  // 🔴 **第一版太窄**：只认 `grep|node|check:|verify:` 这类**命令词**，于是
  //    `shareId`、`uploadOps`、`createCommentActions` 这些**已经写明的探针名**都不算数
  //    ⇒ 把"写明了的行"报成"没写明"（实测：8 行里至少 3 行属于这种误报）。
  //    放宽成"**任何像标识符 / 路径 / 命令的反引号片段**"：含 `/`、`.`（带扩展名）、
  //    camelCase、snake_case，或本身是命令词。
  return /`[^`]*(grep|rg|find|npx|node |pnpm |check:|verify:|\/|[A-Z][a-z]+[A-Z]|[a-z]+\.[a-z]+|[a-z]+_[a-z]+)[^`]*`/.test(text);
}


/** 逐臂证明本工具的四类判断**真的会动**。返回失败臂数。 */

/**
 * **因果/分组断言要有出处，或者是明确标注的推断**（`--causal`）。
 *
 * 🔴 为什么要有：2026-10-16 连续三轮（B30/B31/B32）查出**我替业主排的"次序/同一形状"是我的推理**，
 * 而**没有指向那条链路自己的规则或文档** —— 三处都改了。
 * ⇒ 这条判据把"**没写出处的因果**"变成会红的东西：每一行**要么**有出处，**要么**写明"🟡【推断】"。
 *
 * ⚠️ 出处判定刻意**宽**（第一版太窄，把已经引用了 `B31`/`ADR-0053`/反引号命令的行报成"无出处"）：
 * markdown 链接 · 反引号里有 `.`/`:` 的（文件/命令）· `ADR-\d+` · `B\d+` / `§\d`（指回行或小节）都算。
 */
const RELATION = /依赖|次序|同一形状|应当一致|应当给|必须先|取决于|前置|同一组|同一格|一起拍/;
const PROVENANCE = /\]\(|`[^`]*[.:][^`]*`|ADR-\d+|\bB\d+\b|§\d|[①-⑳]|【推断】/;

/** @returns {{line: number, text: string}[]} 没有出处、也没标推断的关系行。 */
export function causalProblems(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### 7.5'));
  const stop = lines.findIndex((l) => l.startsWith('## 8.'));
  if (start === -1 || stop === -1) return [];
  const problems = [];
  for (let i = start; i < stop; i += 1) {
    const line = lines[i];
    if (!line.startsWith('|') || !RELATION.test(line)) continue;
    // 🔴 **表头与分隔行不是断言**（第一版把 `| 组 | 一起拍的 | 为什么是同一件事 |` 报成了"无出处的因果"）。
    const first = line.split('|')[1]?.trim() ?? '';
    if (/^(组|序号|#|编号|件|-+)$/.test(first) || /^-+$/.test(line.replace(/[|\s-]/g, ''))) continue;
    // 🔴 **只看编号之后的内容**：行自己的 id（`**①**` / `**A1**`）**不是**它断言的出处 ——
    //    第一版拿整行去测，于是「**①** … 取决于那一件」被自己的编号"证明"了 ⇒ 臂（正确地）红了。
    const body = line.split('|').slice(2).join('|');
    if (PROVENANCE.test(body)) continue;
    problems.push({ line: i + 1, text: line.slice(0, 80) });
  }
  return problems;
}


/**
 * **每条决定的"选项"栏里有没有体量或前提**（`--decision-cost`）。
 *
 * 🔴 为什么要有：2026-10-16 我把「业主按**体量**选，而不是按感觉选」当成这一页的卖点，
 * 而当日的**收口审查**发现：**16 行里有 5 行没有体量**（A6 / A5 / B11 / B9 / B14）——
 * 而**我碰过的那几行都有**。⇒ "按体量选"这句话当时只对**一部分行**成立。
 *
 * ⚠️ 词表是**启发式**（它只保证"**没有默默无闻的体量**"，不保证体量**说得对**）。
 * ⚠️ 而词表本身栽过两次：第一次漏了「秒」（于是 B13 的「实测 +141 秒」被判成没体量）。
 */
const COST_MARKERS =
  /体量|小改|前提|外部|一段|两处|四处|六|层|工作日|天|小时|分钟|秒|ADR|须|要动|重发|重做|不等|已满足|零依赖|实测|固定|补|收掉|切掉|按|新写/;

/** @returns {{id: string, options: string}[]} 选项栏里找不到体量/前提的决定。 */

/**
 * **"零命中"类说法的缺口**（`--zero-claims` 与 `--all` 共用 —— 一处实现，两处调用）。
 *
 * 🔴 **为什么抽成函数**：2026-10-16 我在 `--all` 里**照抄了一遍**过滤条件（只写了 `statesProbe`），
 * 于是它报 **51 行缺**，而 `--zero-claims` 报 **13 行 / 0 缺** —— 同一条事实**两处实现**，
 * 数值差了 4 倍。⇒ 这正是本仓反复记的那族（**同一事实住多处**），只是这次住在**我自己的工具里**。
 *
 * **三道排除**（都是踩出来的）：
 *   ① **§8/§9 自检节** —— 那两节本身在讨论"零命中"，算进来会**自指膨胀**；
 *   ② **围栏代码块** —— 那里是**引用命令输出**，不是对账件自己的断言；
 *   ③ **写着「原写/原文/已撤回」的行** —— 那是在**引**已被撤回的话，不是在主张什么。
 */
export function zeroClaimGaps(markdown) {
  const lines = markdown.split('\n');
  let inFence = false;
  const blanked = lines.map((l) => {
    if (l.trimStart().startsWith('```')) { inFence = !inFence; return ''; }
    return inFence ? '' : l;
  });
  const metaStart = blanked.findIndex((l) => l.startsWith('## 8.'));
  const scope = metaStart === -1 ? blanked : blanked.map((l, i) => (i < metaStart ? l : ''));
  const gaps = [];
  for (const [i, line] of scope.entries()) {
    if (/原写|原文|已撤回|撤回】/.test(line)) continue;
    if (zeroClaims(line).length === 0) continue;
    if (statesProbe(line)) continue;
    gaps.push({ line: i + 1, text: line.slice(0, 60) });
  }
  return gaps;
}

export function decisionCostProblems(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### 7.1'));
  const stop = lines.findIndex((l) => l.startsWith('### 7.4'));
  if (start === -1 || stop === -1) return [];
  const problems = [];
  for (let i = start; i < stop; i += 1) {
    const cells = lines[i].split('|');
    if (cells.length < 6 || !lines[i].startsWith('| **')) continue;
    const id = cells[1].replace(/\*/g, '').trim();
    if (!/^(§4\.\d|[AB]\d+)/.test(id)) continue;
    if (!COST_MARKERS.test(cells[3])) problems.push({ id, options: cells[3].trim().slice(0, 60) });
  }
  return problems;
}

/**
 * **§7.3 那几项"只有本人能做的动作"有没有体量与后果**（同一个模式里查）。
 *
 * 🔴 为什么单列：§7.3 是**唯一只能由人做**的四项，而在 2026-10-16 之前它们**只有"谁做"**、
 * 没有"做一次要多久"与"做错会怎样" —— 而**做错的后果恰恰是这几项最贵的部分**
 * （例：备案提交之后 24h 内要接短信核验，**错过要重来**）。
 *
 * ⚠️ §7.3 是**有序列表**（`1.` `2.` …）而不是表格，所以解析方式不同。
 */
export function ownerActionProblems(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### 7.3'));
  const stop = lines.findIndex((l) => l.startsWith('### 7.4'));
  if (start === -1 || stop === -1) return [];
  const problems = [];
  // 每一项 = 一个 `1.` 开头的行 + 它后面的续行（到下一个编号或空行为止）
  let cur = null;
  const flush = () => {
    if (cur === null) return;
    if (!/体量/.test(cur.body)) problems.push({ n: cur.n, why: '没有"体量"' });
    if (!/做错会怎样/.test(cur.body)) problems.push({ n: cur.n, why: '没有"做错会怎样"' });
    cur = null;
  };
  for (let i = start; i < stop; i += 1) {
    const m = /^(\d+)\.\s/.exec(lines[i]);
    if (m) {
      flush();
      cur = { n: Number(m[1]), body: lines[i] };
      continue;
    }
    if (cur !== null && lines[i].trim() !== '') cur.body += `\n${lines[i]}`;
  }
  flush();
  return problems;
}



/**
 * **"我建了它，但没人知道它存在"** 检查（`--gate-mentions`）。
 *
 * 🔴 为什么要有：2026-10-16 连续两轮查出**我新建的门禁/入口从没回灌到对账件**
 * （B49 的 `check:windows-signing-posture`、B48 的 §0.1）。⇒ 这一格把"**对账件有没有提到它**"
 * 变成机械判据：**凡是 `package.json` 里跑的 `scripts/check-*.mjs` / `verify-*.mjs`，
 * 对账件里必须出现它的 npm 名或它的文件 basename 之一**。
 *
 * ⚠️ **两种情况都算"提到了"**（这是第一版栽的地方）：我第一版只按 **npm 名**搜，
 * 于是 `check:pricing-consistency`（真名是 `check:pricing`）被报成"没提到"；
 * 换成只按 **文件名**搜，又把 `check:retention-window-parity` 报成"没提到"。
 * ⇒ **两个名字都要试**，任一命中即算。
 */
export function gateMentionProblems(markdown, scripts) {
  const problems = [];
  const names = new Set();
  for (const [npm, cmd] of Object.entries(scripts)) {
    const m = /(scripts\/[\w.-]+\.(?:mjs|sh))/.exec(cmd);
    if (m === null) continue;
    const file = m[1];
    const base = file.replace(/^scripts\//, '').replace(/\.(mjs|sh)$/, '');
    names.add(JSON.stringify({ npm, file, base }));
  }
  for (const json of names) {
    const { npm, file, base } = JSON.parse(json);
    // 只关心 `check:*` / `verify:*` 那两族
    if (!/^(check|verify):/.test(npm)) continue;
    const hit = markdown.includes(npm) || markdown.includes(base) || markdown.includes(file);
    if (!hit) problems.push({ npm, base });
  }
  return problems;
}


/**
 * **列表项的续行必须缩进**（`--bullet-structure`）。
 *
 * 🔴 为什么要有：2026-10-16 我给 §0 插入一块内容时，**把 `- **商业面（B）**` 那条劈成了两段**
 * （前半在 (C) 之前、后半在 (C) 之后）—— 而 `check:md-tables` **只看表格、不看列表**，
 * 所以**没有任何门禁会报它**，是我**人眼看出来的**（B53）。
 *
 * ⚠️ **它是本仓的约定，不是 Markdown 的强制**：Markdown 允许"懒续行"（不缩进也算同一段），
 * 所以"不缩进"**不一定**是错 —— 但在本文件里，**`- ` 之后的续行一律缩进**，于是"不缩进"是一个
 * **强烈的坏味道**。⇒ 它**判**，但判的是**本仓约定**。
 */
export function bulletStructureProblems(markdown) {
  const lines = markdown.split('\n');
  const problems = [];
  for (let k = 0; k < lines.length; k += 1) {
    if (!/^- /.test(lines[k])) continue;
    let j = k + 1;
    while (j < lines.length && lines[j].trim() !== '' && !/^(- |#|\|)/.test(lines[j])) {
      if (!lines[j].startsWith('  ')) problems.push({ line: j + 1, text: lines[j].slice(0, 64), owner: k + 1 });
      j += 1;
    }
  }
  return problems;
}


/**
 * **每一条待拍板的事，是否都被"最短路径"覆盖**（`--path-coverage`）。
 *
 * 🔴 为什么要有：2026-10-16 我核 §7.6 时**怀疑漏了两条**（§7.2 有 9 条、路径里只列了 7 条）——
 * **手算**之后发现没漏（`B8`/`B9` 就是 ⑦ 那一格本身）。⇒ 这件事**不该靠手算**：
 * 两个表的编号一比对就知道，而手算会漏、也会误报（我这次就是误报）。
 *
 * **射程**：只比"**编号有没有出现**"，**不判**它在路径里排得对不对、也不判依赖是否成立。
 * ⚠️ 若某条决定**故意不排进路径**（例如"已撤回"），那就得在本函数里**显式开例外**，别靠不写。
 */
export function pathCoverageProblems(markdown) {
  const lines = markdown.split('\n');
  const slice = (head) => {
    const start = lines.findIndex((l) => l.startsWith(head));
    if (start === -1) return [];
    let stop = lines.length;
    for (let k = start + 1; k < lines.length; k += 1) {
      if (lines[k].startsWith('### ') || lines[k].startsWith('## ')) { stop = k; break; }
    }
    return lines.slice(start, stop);
  };
  const ids = [];
  for (const head of ['### 7.1', '### 7.2']) {
    for (const l of slice(head)) {
      const m = /^\| \*\*([^*]+)\*\*/.exec(l);
      if (m !== null && /^(§4\.\d|[AB]\d+)$/.test(m[1].trim())) ids.push(m[1].trim());
    }
  }
  const pathText = [...slice('### 7.6'), ...slice('### 7.7')].join('\n');
  const mentioned = new Set([
    ...pathText.matchAll(/`(§?[AB]\d+|§4\.\d)`/g),
    ...pathText.matchAll(/\b([AB]\d+)\b/g),
  ].map((m) => m[1].replace(/^§/, (x) => x)));
  // §4.x 在正文里可能不带反引号；两种写法都认。
  return ids.filter((id) => {
    if (mentioned.has(id)) return false;
    if (id.startsWith('§4.') && pathText.includes(id)) return false;
    return true;
  });
}


/**
 * **§7 的每个小节，是否都在 §7 抬头的"导航"里**（`--path-coverage` 的第二层）。
 *
 * 🔴 为什么要有：2026-10-16 查出一件挺讽刺的事 —— **§0.1 说"最该先读 §7.3"**，
 * 而 **§7 自己的抬头根本没提 §7.3**（那句散文只点了 §7.5/§7.6/§7.7/§7.8）。
 * ⇒ 两层指路**互相打架**，而**上层被更新过、下层没有**（与 B49 同族）。
 *
 * ⚠️ 它只查"**小节号有没有出现在抬头那块**"，**不查**导航写得对不对。
 */
export function sectionNavProblems(markdown, top = '7') {
  const lines = markdown.split('\n');
  const head = lines.findIndex((l) => l.startsWith(`## ${top}.`));
  const first = lines.findIndex((l) => l.startsWith(`### ${top}.1`));
  if (head === -1 || first === -1) return [];
  const intro = lines.slice(head, first).join('\n');
  const subs = lines
    .map((l) => new RegExp(`^### (${top}\\.\\d+)`).exec(l))
    .filter((m) => m !== null)
    .map((m) => m[1]);
  // 🔴 **必须用词边界，不能用 includes**：2026-10-16 的变异测试把 `§7.3` 改成 `§7.3X`，
  //    而 `includes('§7.3')` **仍然为真** ⇒ 假阴性（判据**不会红**）。改成「后面不许接字母数字」。
  return subs.filter((s) => !new RegExp(`§${s.replace('.', '\\.')}(?![0-9A-Za-z])`).test(intro));
}


/**
 * **表格的列数一致**（`--table-cells`）。
 *
 * 🔴 为什么要有：2026-10-16 查出 §2 的表 **表头 4 列、数据行 5 列**，而 `check:md-tables` **一路绿**
 * （它只查分隔行**语法**）。多余的那一格会被渲染器**丢掉** ⇒ 最右列（影响 / 归属）**静默消失**。
 *
 * ⚠️ **写这个函数时我自己错过两次**（都记在这里）：
 *   ① 第一版按"上一张表的表头"推列数 ⇒ 报 **102 行**不一致（全是假报）；
 *   ② 第二版把表头当普通行 ⇒ 报 **80 行**（仍假报）。
 *   ⇒ 真正的判法是：**以每张表的「分隔行」为准**（`|---|---|`），其余各行都该与它相同。
 *
 * ⚠️ **必须先把 `\|` 遮掉再数** —— 表格里的 `\|` 是**合法转义**（渲染成一个字面竖线），
 *    不遮它会把一格数成两格（B8 那行就是这么被我误判成 9 格的）。
 */
export function tableCellProblems(markdown) {
  const lines = markdown.split('\n');
  const pipes = (l) => l.replace(/\\\|/g, '\u0001').split('|').length - 1;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('|')) { i += 1; continue; }
    const start = i;
    while (i < lines.length && lines[i].startsWith('|')) i += 1;
    const block = lines.slice(start, i);
    const sep = block.findIndex((l) => /^\|[\s|:-]*-{3,}[\s|:-]*\|?\s*$/.test(l));
    if (sep === -1) continue;                       // 不是真表格（没有分隔行）
    const want = pipes(block[sep]);
    for (let k = 0; k < block.length; k += 1) {
      if (k === sep) continue;
      const got = pipes(block[k]);
      if (got !== want) {
        out.push({ line: start + k + 1, want: want - 1, got: got - 1, head: block[sep - 1]?.slice(0, 40) ?? '' });
      }
    }
  }
  return out;
}


/**
 * **§0 里那些"几行 / 几个 / 几件"的计数，与它引的那张表对不对得上**（`--scope-counts`）。
 *
 * 🔴 为什么要有：2026-10-16 交付前的**五处口径校准**（§9.5）抓出 §0 一句"**六条**"，而它引的表是**七行**
 * （`B76`）。⇒ 而 `--causal` 只管 §7 的因果、`ledger-health` 只管 §7 的引用、`--zero-claims` 只管"零命中"表述
 * ⇒ **§0 的计数此前没有任何判据**。
 *
 * **只查两处**（都写得进散文、也都容易漂）：
 *   ① §0 若写「§7.9 … N 个」⇒ 必须等于 **§7.9 的数据行数**；
 *   ② §0.2 若写「N 件事」⇒ 必须等于 §0.2 里 `①②③…` 那几条的**条数**；
 *
 * ⚠️ **刻意不查**：历史引用里那些数字（"当年写的是八条/3 格/四个工具"）—— 它们**引的是旧话**，
 *    对不上是**对的**。⇒ 本函数只认**上面那三个具体说法**。
 */
export function scopeCountProblems(markdown) {
  const lines = markdown.split('\n');
  const sec0 = (() => {
    const a = lines.findIndex((l) => l.startsWith('## 0.'));
    if (a === -1) return '';
    // 🔴 **不能只认 `## 1.`**：样本（以及将来被裁剪的文档）可能没有它 ⇒ 退到 `## 8.` 或文末。
    //    第一次写时只认 `## 1.`，于是合成样本里本函数**静默返回空**、臂**红不了**（臂当场抓到了）。
    const b1 = lines.findIndex((l, i) => i > a && l.startsWith('## 1.'));
    const b8 = lines.findIndex((l, i) => i > a && l.startsWith('## 8.'));
    const b = [b1, b8].filter((x) => x !== -1).sort((x, y) => x - y)[0] ?? lines.length;
    return lines.slice(a, b).join('\n');
  })();
  if (sec0 === '') return [];
  const problems = [];
  const num = (re) => {
    const m = re.exec(sec0);
    return m === null ? null : Number(m[1]);
  };
  // ① §7.9 的行数
  const want79 = (() => {
    const a = lines.findIndex((l) => l.startsWith('### 7.9'));
    const b = lines.findIndex((l) => l.startsWith('## 8.'));
    return a === -1 || b === -1 ? null : lines.slice(a, b).filter((l) => l.startsWith('| **')).length;
  })();
  const said79 = num(/§7\.9[^。\n]{0,20}?(\d+)\s*个/);
  if (want79 !== null && said79 !== null && said79 !== want79) {
    problems.push({ where: '§0 → §7.9', said: said79, actual: want79 });
  }
  // ② §0.2 的条数
  const said02 = num(/（?有\s*\*\*(\d+)\s*件事\*\*/);
  const want02 = (() => {
    const a = lines.findIndex((l) => l.startsWith('### 0.2'));
    const b = lines.findIndex((l) => l.startsWith('## 1.'));
    return a === -1 || b === -1 ? null : lines.slice(a, b).filter((l) => /^\*\*[①②③④⑤⑥]/.test(l)).length;
  })();
  if (want02 !== null && said02 !== null && said02 !== want02) {
    problems.push({ where: '§0.2 的条数', said: said02, actual: want02 });
  }
  return problems;
}


/**
 * **关键读数的"日期"过期了吗**（`--stale`）。
 *
 * 🔴 为什么要有：2026-10-16 那一页的**四道外部闸门**与**判据读数**都盖着"2026-10-16"，
 * 而 §9.6 原来写的是"必须**当天**复跑过"。⇒ **一过午夜，"当天"就自动不成立了**，
 * 而**没有任何东西会告诉你**。⇒ 本函数把"**多久没复跑**"变成一个会说话的读数。
 *
 * **取哪几个日期**（都是"跑过一次"的印记）：
 *   ① §0 那句「这四道今天都复跑过（YYYY-MM-DD…）」—— 四道外部闸门的复跑日；
 *   ② §9.1 抬头的"当日读数"所在的**代码块注释**里的日期（若写了）。
 * ⚠️ **它只报"多久"，不判"该不该重跑"** —— 阈值（默认 7 天）是**约定**，写在参数里。
 */
export function staleProblems(markdown, today, maxDays = 7) {
  const lines = markdown.split('\n');
  const stamps = [];
  for (let i = 0; i < lines.length; i += 1) {
    // ⚠️ **必须同时含「复跑过」**：否则讨论这些闸门成因的行（B79/B80）也会被当成复跑日。
    // ⚠️ **只认 §0 那种引用块里的印记**（以 `>` 开头）：B 行会**引用**同一句话，
    //    不排掉就会重复计数（实测 `:203` 被算了三次）。
    if (!lines[i].startsWith('>') || !lines[i].includes('这四道') || !lines[i].includes('复跑过')) continue;
    // ⚠️ **一行里可能有好几个复跑日**（"10-16 与 10-17 各一次"）⇒ 必须**全取**。
    //    第一版用 exec() 只取第一个 ⇒ 写在最前的老日期会盖住新日期，`--stale` 就永远报"1 天前"。
    for (const m of lines[i].matchAll(/(\d{4}-\d{2}-\d{2})/g)) {
      stamps.push({ line: i + 1, what: '四道外部闸门的复跑日', date: m[1] });
    }
  }
  // ② **全页 as-of 锚**（2026-10-17 加，**放在循环外** —— 第一版放在循环里，同一行被收集几百次）
  const m2 = /本页所有读数截至\s*`?(\d{4}-\d{2}-\d{2})`?/.exec(markdown);
  if (m2 !== null) stamps.push({ line: markdown.slice(0, m2.index).split('\n').length, what: '全页 as-of 锚', date: m2[1] });
  const day = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const out = [];
  for (const st of stamps) {
    const age = Math.round((day(today) - day(st.date)) / 86400000);
    out.push({ ...st, age, stale: age > maxDays });
  }
  return out;
}


/**
 * **列出现在还"不能自动更新"的那些行**（`--unrunnable`）。
 *
 * 🔴 为什么要有：`--brief` 会把每条断言分成"判据 / 外部 / 人工 / 归并"四档，而**后两档是唯一不能靠跑命令更新的**。
 * 2026-10-17 的分档（`B82`）把这件事说清了，但**没有把那些行列出来** —— 于是"27 条只能等人"是一句**没有名单的话**。
 *
 * ⚠️ **它只列 id + 分类 + 行首**，**不猜"等谁"** —— 那是每行**自己的文字**里的事（`§0.2` 只覆盖其中四道闸门）。
 */
export function unrunnableRows(markdown) {
  const out = [];
  for (const row of parseRows(markdown)) {
    const cls = classify(row.text);
    if (cls !== '外部' && cls !== '人工') continue;
    // 去掉开头那个 `| **A4** |` 前缀（否则名单里每行都重复一次 id）
    const head = row.text.replace(/^\|[^|]*\|/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 52);
    out.push({ id: row.id, cls, head });
  }
  return out;
}


/**
 * **按节数红与绿**（`--distribution`），以及**无标记行**的判据。
 *
 * 🔴 为什么要有：2026-10-17 的 §9.8 是一张**手写**的表（96 行的红绿分布）—— 而**手写的数字会漂**。
 * 当日还把"**8 行没有红/绿标记**"靠**肉眼**找出来（其中 6 行本该是 🔴）。
 * ⇒ 这个函数把两件事都做成机械的：
 *   ① **分布**：`§1`（A 面那几行）与 `§2`（其余）各多少行、各多少 🔴 / ✅ / 无标记；
 *   ② **无标记行必须是"合法的无标记"**（归并指针 / 已撤回）—— 其余一律报红。
 *
 * ⚠️ 它**只数标题格**（第二个单元格）里的 🔴 / ✅；正文里的标记**不算**这一行的状态。
 */
export function distributionStats(markdown) {
  const lines = markdown.split('\n');
  const stop = lines.findIndex((l) => l.startsWith('## 5.'));
  const scope = stop === -1 ? lines : lines.slice(0, stop);
  const stat = {
    '§1': { total: 0, redOnly: 0, redFixed: 0, orange: 0, ok: 0, unmarked: 0 },
    '§2': { total: 0, redOnly: 0, redFixed: 0, orange: 0, ok: 0, unmarked: 0 },
  };
  const unmarked = [];
  for (const line of scope) {
    if (!/^\| \*\*[AB]\d+\*\*/.test(line)) continue;
    const cells = line.replace(/\\\|/g, '\u0001').split('|');
    const id = cells[1].replace(/\*/g, '').trim();
    const title = cells[2] ?? '';
    const key = id.startsWith('A') ? '§1' : '§2';
    stat[key].total += 1;
    // 🔴 **三种状态，不能二分**（2026-10-17 更正）：`🔴` 的语义是"**这一条曾是缺陷**"，
    //    而 `✅` 是"**已修/已闭合**" ⇒ **两个都有** = "**曾红已修**"，**不是**"还红着"。
    //    第一版写 `if (🔴) red++` ⇒ 把 34 行"曾红已修"也算成"还红着"，§9.8 那个数因此**错了 2.6 倍**。
    const r = /🔴/.test(title);
    const o = /✅/.test(title);
    // 🟠 **第三态**（2026-10-17 加）：**已复核、仍未通** —— 例如 `A4`（iOS 从未提审）：
    //    它带 ✅ 是因为"复核过"，而它**从未通过**。第一版只有 🔴/✅ 两态 ⇒ 它被读成"没事了"，
    //    于是**挡住了上线却没进 §9.9 那张表**（`B101`）。
    const orange = /🟠/.test(title);
    if (orange) stat[key].orange += 1;
    else if (r && o) stat[key].redFixed += 1;
    else if (r) stat[key].redOnly += 1;
    else if (o) stat[key].ok += 1;
    else { stat[key].unmarked += 1; unmarked.push(id); }
  }
  // 允许"无标记"的只有两类：归并指针、已撤回
  const allowed = new Set();
  for (const line of scope) {
    if (!/^\| \*\*[AB]\d+\*\*/.test(line)) continue;
    const cells = line.replace(/\\\|/g, '\u0001').split('|');
    const id = cells[1].replace(/\*/g, '').trim();
    const title = cells[2] ?? '';
    if (/【\d{4}-\d{2}-\d{2} (归并|撤回)】/.test(title)) allowed.add(id);
  }
  const badUnmarked = unmarked.filter((id) => !allowed.has(id));
  return { stat, unmarked, allowed: [...allowed], badUnmarked };
}


/**
 * **每一行"仍红"的都必须被分到一档**（`--triage`）。
 *
 * 🔴 为什么要有：2026-10-17 的 §9.9 把 19 行"仍红"分成**挡上线 / 发得对 / 文档治理** —— 而那张表是**手写**的。
 * 之后每加一行红，**没有人会记得回去分档** ⇒ 那张表会**慢慢变成一份过时的名单**（`B48` 那族）。
 *
 * 判据：**仍红的行**（标题含 🔴 但不含 ✅）**必须恰好出现在 §9.9 三档中的一档里**：
 *   · 漏了 ⇒ 这一行没人分档；
 *   · 出现在两档 ⇒ 自相矛盾。
 */
export function triageProblems(markdown) {
  const lines = markdown.split('\n');
  const stop = lines.findIndex((l) => l.startsWith('## 5.'));
  const redOnly = [];
  for (const line of stop === -1 ? [] : lines.slice(0, stop)) {
    if (!/^\| \*\*[AB]\d+\*\*/.test(line)) continue;
    const cells = line.replace(/\\\|/g, '\u0001').split('|');
    const title = cells[2] ?? '';
    // **"还没通"** = 🔴（裸红）**或** 🟠（已复核仍未通）；`🔴+✅` 是"曾红已修"，**不算**。
    const stillOpen = /🟠/.test(title) || (/🔴/.test(title) && !/✅/.test(title));
    if (stillOpen) redOnly.push(cells[1].replace(/\*/g, '').trim());
  }
  // §9.9 的三档：只认那三行表格里 `\`ID\`` 形状的反引号
  const s99 = lines.findIndex((l) => l.startsWith('### 9.9'));
  const e99 = s99 === -1 ? -1 : (() => { let j = s99 + 1; while (j < lines.length && !/^#{2,3} /.test(lines[j])) j += 1; return j; })();
  const buckets = new Map();
  if (s99 !== -1) {
    const want = ['挡上线', '不挡上架', '发得对', '文档治理'];
    for (const line of lines.slice(s99, e99)) {
      const hit = want.find((w) => line.includes(`**${w}`) || line.includes(`**${w}**`));
      if (hit === undefined) continue;
      // 🔴 **只取第一个单元格**（那一格的 id 名单）：理由列里也会提到 id，
      //    第一版扫整行 ⇒ `A2` 被算成"落在两档"（挡上线+挡上线），5 个全是假报。
      const idCell = line.split('|')[2] ?? '';
      for (const m of idCell.matchAll(/`([AB]\d+)`/g)) {
        buckets.set(m[1], [...(buckets.get(m[1]) ?? []), hit]);
      }
    }
  }
  const missing = redOnly.filter((id) => !buckets.has(id));
  const duplicated = [...buckets.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}∈{${v.join('+')}}`);
  const stale = [...buckets.keys()].filter((id) => !redOnly.includes(id));
  // ④ **档与正文打架**（2026-10-17 加）：分到"挡上线"的行，正文里若写着"不急 / 不阻塞 / 不挡"，
  //    就说明**它自己不同意这个档** ⇒ 报出来让人二选一（改档 / 说明为什么仍挡）。
  //    ⚠️ 这一条**只对"挡上线"档**做：另两档里出现这些词是**正常**的。
  const softWords = /不急|不阻塞|不挡|不必|不该阻塞|不构成阻断/;
  const conflicts = [];
  for (const [id, arr] of buckets.entries()) {
    if (!arr.includes('挡上线')) continue;
    const row = (stop === -1 ? [] : lines.slice(0, stop)).find((l) => l.startsWith(`| **${id}**`));
    if (row === undefined) continue;
    const m = softWords.exec(row);
    if (m !== null) conflicts.push(`${id}（写"${m[0]}"）`);
  }

  return { redOnly, buckets, missing, duplicated, stale, conflicts };
}


/**
 * **第一屏与 §9.9 的"挡上线"是不是同一组**（`--top-agrees`）。
 *
 * 🔴 为什么要有：2026-10-17 在文件最前面加了「30 秒版」，它**手抄**了 §9.9 那格里的 id
 * （`A5`/`A4`/`A6`/`B8`/`A2`）。⇒ **手抄的东西一定会漂**，而这一处**漂了最贵** ——
 * 因为它是**业主唯一必读的一屏**（`B108`）。
 *
 * 判据：**两处 id 集合必须相等**；不等就报出来（多/少各说清）。
 */
export function topAgreementProblems(markdown) {
  const lines = markdown.split('\n');
  const topStart = lines.findIndex((l) => l.includes('30 秒版'));
  const topEnd = lines.findIndex((l) => l.startsWith('## 0. '));
  const top = new Set();
  if (topStart !== -1 && topEnd !== -1) {
    for (const line of lines.slice(topStart, topEnd)) {
      const cell = line.split('|')[1] ?? '';
      for (const m of cell.matchAll(/`([AB]\d+)`/g)) top.add(m[1]);
    }
  }
  const s99 = lines.findIndex((l) => l.startsWith('### 9.9'));
  const e99 = s99 === -1 ? -1 : (() => { let j = s99 + 1; while (j < lines.length && !/^#{2,3} /.test(lines[j])) j += 1; return j; })();
  const bucket = new Set();
  if (s99 !== -1) {
    for (const line of lines.slice(s99, e99)) {
      if (!line.includes('**挡上线**')) continue;
      const cell = line.split('|')[2] ?? '';
      for (const m of cell.matchAll(/`([AB]\d+)`/g)) bucket.add(m[1]);
    }
  }
  const onlyTop = [...top].filter((id) => !bucket.has(id));
  const onlyBucket = [...bucket].filter((id) => !top.has(id));
  return { top: [...top], bucket: [...bucket], onlyTop, onlyBucket };
}


/**
 * **五个数，一条命令**（`--five-readings`）。
 *
 * 🔴 为什么要有：2026-10-17 的 §9.6「业主版」列了**五个读数**（`null` · `9` · `2` · `links` · `3`），
 * 而它们**分散在五条不同的命令里**（两个 grep、一个 `pnpm exec`、一个 `ls`、一个 `git status`）。
 * ⇒ 业主**不可能**跑五条。⇒ 本模式把它们**合成一条**。
 *
 * ⚠️ **它只读、不写**；`A6` 那一项若 `packages/legal/dist` 不在，就**报"pending"**而不是假装算出来。
 */
export async function fiveReadings(root) {
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const { execSync } = await import('node:child_process');
  const out = [];
  // ① A5 备案号
  try {
    const src = readFileSync(`${root}/packages/legal/src/index.ts`, 'utf8');
    out.push({ k: 'A5 备案号', v: /appFilingNumber:\s*null/.test(src) ? 'null' : '有编号（去看它是什么）' });
  } catch { out.push({ k: 'A5 备案号', v: '（读不到 packages/legal/src/index.ts）' }); }
  // ② A6 法务 draft 份数
  try {
    const mod = await import(`${root}/packages/legal/dist/index.js`);
    out.push({ k: 'A6 法务 draft', v: String(mod.draftDocumentIds().length) });
  } catch { out.push({ k: 'A6 法务 draft', v: 'pending（需要先 pnpm --filter @heyta/legal build）' }); }
  // ③ B8 支付适配器
  try {
    const n = readdirSync(`${root}/server/src/billing`).filter((f) => f.includes('adapter')).length;
    out.push({ k: 'B8 支付适配器', v: String(n) });
  } catch { out.push({ k: 'B8 支付适配器', v: '（读不到 server/src/billing）' }); }
  // ④ A4 提审
  try {
    // 🔴 **2026-10-18 换口径**：旧式子是 grep `"betaAppReviewSubmission":{"[a-z]*"` 再判 `includes('data')` ——
    //    而**原始响应里的 `links` 关系字段**也会命中那个形状 ⇒ "有留档"与"没留档"读出来一样。改读**审核状态本身**：
    //    值域是 Apple 的枚举（`WAITING_FOR_REVIEW` / `IN_BETA_REVIEW` / `BETA_APPROVED`…）；没有留档就没有值 ⇒
    //    当场验过它会失败：对没有该字段的目录跑同一条 grep ⇒ 无命中 ⇒ 落回 `links（= 0 次提交）` 分支。
    const g = execSync('grep -rho \'"betaReviewState" *: *"[A-Z_]*"\' apps/web/evidence/ 2>/dev/null | sort -u', { cwd: root, encoding: 'utf8' }).trim();
    const m = /"betaReviewState" *: *"([A-Z_]+)"/.exec(g);
    out.push({ k: 'A4 iOS 提审', v: m ? `${m[1]}（有留档）` : 'links（= 0 次提交）' });
  } catch { out.push({ k: 'A4 iOS 提审', v: '（grep 失败）' }); }
  // ⑤ A2 /download 还差几个文件
  try {
    // 🔴 **2026-10-17 更正口径**：`A2` 的门槛**不是"`apps/landing` 干净"**，而是
    //    **发布脚本的 `INPUT_PATHS` 全干净**（`apps/landing` · `apps/web` · `packages` ·
    //    `server/public` · `pnpm-lock.yaml` · `package.json` · `e2e`）—— 见 `B195`：
    //    当日实测**只数 `apps/landing` 是 3，而全量是 275**，工具直接拒绝。
    const INPUTS = ['apps/landing', 'apps/web', 'packages', 'server/public', 'pnpm-lock.yaml', 'package.json', 'e2e'];
    const only = execSync('git status --porcelain apps/landing', { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
    const all = execSync(`git status --porcelain -- ${INPUTS.join(' ')}`, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
    out.push({ k: 'A2 /download 还差', v: all === only ? String(all) : `${all}（其中 apps/landing **${only}**）` });
  } catch { out.push({ k: 'A2 /download 还差', v: '（git 失败）' }); }
  return out;
}


/**
 * **`--after <id>`：这一条通了之后，哪个数会变**。
 *
 * 🔴 为什么要有：§9.10 那张表已经写了"**催完读数怎么变**"，但那只有**打开文档**才看得到。
 * ⇒ 做成一条命令，业主（或我）**做完一件事就能自己验一次**，不必回来问。
 *
 * ⚠️ 它**不复制**那张表的内容 —— 是**从文档里读**的（所以表一改，它就跟着改）。
 */
export function afterReading(markdown, id) {
  const lines = markdown.split('\n');
  const s = lines.findIndex((l) => l.startsWith('### 9.10'));
  if (s === -1) return null;
  let e = s + 1;
  while (e < lines.length && !/^#{2,3} /.test(lines[e])) e += 1;
  for (const line of lines.slice(s, e)) {
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/\\\|/g, '\u0001').split('|').map((c) => c.trim().replace(/\u0001/g, '|'));
    if (cells.length < 5) continue;
    if (!cells[1].includes(`\`${id}\``)) continue;
    return { id, who: cells[2], what: cells[3], how: cells[4] };
  }
  return null;
}


/**
 * **工具的每个模式，都得在 §9.1 的命令表里出现过**（`--modes-agrees`）。
 *
 * 🔴 为什么要有：2026-10-17 §9.1 **漏过 3 个模式**（`--table-cells`/`--triage`/`--unrunnable`，见 `B111`），
 * 而当时的补救只是**一条 `grep` 让人自己比**。⇒ 有了这条，**漏一个就红**。
 *
 * ⚠️ **方向是单向的**：`工具的模式 ⊆ §9.1 列出的` —— 因为 §9.1 **也列别的工具的 flag**（如 `--coverage`），
 * 所以"§9.1 多出来"是**正常**的，**不算错**。
 */
export function modesAgreeProblems(markdown, toolSource) {
  // 🔴 **只扫 `function selfTest` 之前的部分**：自检的**样本字符串里也有** `process.argv.includes('--x')`
  //    （如臂里的 `--alpha`/`--beta`）⇒ 扫全文件会把它们当成**真模式**，报出"漏了 3 个"这种假红。
  // ⚠️ **从 `function main` 开始扫**（不是"到 selfTest 为止"）：`main()` 在 `selfTest` **之后**，
  //    而自检样本里的 `--alpha` 在 `selfTest` 里 ⇒ 从 `main` 开始正好**只覆盖分派**。
  // 🔴 **必须匹配行首**：`indexOf('function main')` 会命中**注释里**先出现的那一处（偏移 31664），
  //    于是扫描范围**没排除 selfTest** ⇒ 臂样本里的 `--alpha` 又被当成真模式。
  const from = toolSource.indexOf('\nfunction main(');
  const scope = from === -1 ? toolSource : toolSource.slice(from);
  const toolFlags = new Set(
    [...scope.matchAll(/process\.argv\.includes\('(--[a-z-]+)'\)/g)].map((m) => m[1]),
  );
  const lines = markdown.split('\n');
  const s = lines.findIndex((l) => l.startsWith('### 9.1'));
  const e = s === -1 ? -1 : (() => { let j = s + 1; while (j < lines.length && !/^#{2,3} /.test(lines[j])) j += 1; return j; })();
  const docFlags = new Set(s === -1 ? [] : [...lines.slice(s, e).join('\n').matchAll(/--[a-z][a-z-]+/g)].map((m) => m[0]));
  const missing = [...toolFlags].filter((f) => !docFlags.has(f));
  return { toolFlags: [...toolFlags].sort(), docFlags: [...docFlags].sort(), missing: missing.sort() };
}


/**
 * **抬头里写的 N，要等于这一节的表格数据行数**（`--heading-counts`）。
 *
 * 🔴 为什么要有：2026-10-17 撞过两次（`§9.3` 写"四格"实际 2 行、`§5.1` 写"十条"实际 12 行，见 `B106`）。
 * 当时只是**手工改掉**，没有判据 ⇒ 会再长。
 *
 * **只查一种形状**：`### X.Y …（**N 行/格/件/个**）…` 或 `### X.Y … **N 行/件/个** …`
 * ⇒ **N 必须等于本节表格的数据行数**（不含表头与分隔行）。
 *
 * ⚠️ **其余形状不查**（"一条命令""一处降级"这种是**修辞**，不是计数）——
 *    并有一张**白名单**记下"**知道它不等、但它对**"的（如 `8.4` 说的 16 条在 §7 里）。
 */
export function headingCountProblems(markdown) {
  const lines = markdown.split('\n');
  const NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  // 已知"抬头里的 N 与本节表格行数无关"的（键是抬头前缀）
  const WHITELIST = new Map([
    ['### 8.4', '这里的 16 条是 §7 的决定，不在本节'],
    ['### 3.1', '三件指交付段的三件事，本节表格是别的'],
    ['### 9.1', '「一条命令」是修辞'],
    ['### 8.3', '「一条自动规则」是修辞'],
    ['## 8.', '「每一条断言」是修辞'],
    ['### 7.5', '「同一件事」是修辞'],
    ['### 7.4', '「一个非公开的号码」是修辞'],
  ]);
  const out = [];
  let s = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^#{2,3} /.test(lines[i])) continue;
    if (s !== -1) {
      // 🔴 **星号必须可选**：抬头里常见「那 10 行」这种**不加粗**的写法。
      //    第一版要求数字两边有 `**` ⇒ 变异测试（10 → 99）**没被抓到** ⇒ 等于永远绿。
      const m = /(\d+|[一二三四五六七八九十])\s*(行|格|件|个)(?![0-9A-Za-z])/.exec(lines[s]);
      const head = lines[s];
      // 🔴 **必须用边界，不能用 `startsWith`**：白名单里的 `### 9.1` 会**前缀匹配**到 `### 9.10` ⇒
      //    于是 `§9.10` 被**误白名单**，而变异测试（10 → 99）**没被抓到**。
      //    （这与 `sectionNavProblems` 当初那个 bug **同一族**。）
      const wl = [...WHITELIST.keys()].find((p) => {
        if (!head.startsWith(p)) return false;
        const next = head.charAt(p.length);
        return !/[0-9]/.test(next);
      });
      if (m !== null && wl === undefined) {
        const n = Number.isNaN(Number(m[1])) ? NUM[m[1]] : Number(m[1]);
        // 🔴 **只数分隔行之后的行** —— 第一版把**表头**也算进去了（表头在分隔行**之前**），
        //    于是 `§7.9`（7 个是非题）被数成 **8 行** ⇒ 一次**假红**。
        // ⚠️ **只数第一张表**：`§9.10` 现在有**三张表**（催谁 10 + 多久 7 + 先催哪个 5 = 22），
        //    而抬头说的"10 行"指的是**第一张**。⇒ 数全节会**误红**。
        const body = lines.slice(s + 1, i);
        let afterSep = false;
        let seenSep = false;
        let rows = 0;
        for (const l of body) {
          const isSep = /^\|[\s:|-]+\|$/.test(l.trim());
          if (isSep) {
            if (seenSep) break;          // 第二张表开始 ⇒ 停
            seenSep = true; afterSep = true; continue;
          }
          if (!l.startsWith('| ')) { afterSep = false; continue; }
          if (afterSep) rows += 1;
        }
        if (rows > 0 && rows !== n) out.push({ line: s + 1, head: head.slice(0, 40), said: n, rows });
      }
    }
    s = i;
  }
  return out;
}


/**
 * **清单的 id 是否连续、有序、无重号**，以及**缺号有没有被声明**（`--id-order`）。
 *
 * 🔴 为什么要有：2026-10-17 量 §2 时发现 **138 行、id 到 B139**，而 **B59 缺号** ——
 * 且**全篇 0 次提及**。⇒ 读者找 `B59` 会**什么都找不到**，而**没有任何东西告诉他那是缺号**。
 * （`B48` 那族的最新一例：**id 也是"目录类内容"**。）
 *
 * 判据：① **不重复**；② **严格递增**；③ **每个缺号都必须在文档里被写出来**（形如「缺号：B59」）。
 */
export function idOrderProblems(markdown) {
  const lines = markdown.split('\n');
  // 🔴 **只扫 §1 与 §2**：§7.1/§7.2 的**决定行**也是 `| **A6** | …` 这个形状 ⇒
  //    扫全篇会把它们当成"重号"（第一版报了 21 处假红）。
  const stop = lines.findIndex((l) => l.startsWith('## 3.'));
  const scope = stop === -1 ? lines : lines.slice(0, stop);
  const ids = [];
  for (const l of scope) {
    const m = /^\| \*\*([AB])(\d+)\*\*/.exec(l);
    if (m !== null) ids.push({ pre: m[1], n: Number(m[2]) });
  }
  const out = [];
  const seen = new Set();
  for (const { pre, n } of ids) {
    const key = `${pre}${n}`;
    if (seen.has(key)) out.push(`重号 ${key}`);
    seen.add(key);
  }
  // 分前缀检查递增与缺号
  for (const pre of new Set(ids.map((x) => x.pre))) {
    const nums = ids.filter((x) => x.pre === pre).map((x) => x.n);
    for (let i = 1; i < nums.length; i += 1) {
      if (nums[i] <= nums[i - 1]) out.push(`${pre}${nums[i - 1]} 之后是 ${pre}${nums[i]}（不是递增）`);
    }
    const max = Math.max(...nums);
    for (let n = 1; n <= max; n += 1) {
      if (nums.includes(n)) continue;
      const key = `${pre}${n}`;
      // 缺号必须被声明：文档里出现「缺号：B59」或「缺号 B59」
      const declared = new RegExp(`缺号[：: ]*${key}(?![0-9])`).test(markdown);
      if (!declared) out.push(`缺号 ${key} **没被声明**`);
    }
  }
  return out;
}


/**
 * **结构普查**（`--structure`）：每个 `##` 节有几个 `###` 小节、抬头有没有导航表。
 *
 * 🔴 为什么要有：2026-10-17 连续三轮在判"**这节要不要导航**"（§2 不加 · §8 加八行 · §9 加十行）——
 * 而**每次都是现想**。⇒ 这条把它变成**一眼可查**：**哪些节有小节、其中哪些抬头已经有导航**。
 *
 * ⚠️ **它只报机械事实**（小节数 / 有没有表），**不判"该不该有导航"** —— 那是人的决定，
 *    记在 §9.5 的漂移地图与各节的正文里。
 */
export function structureCensus(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    const h2 = /^## (\d+\.)\s*(.*)$/.exec(lines[i]);
    if (h2 !== null) {
      cur = { top: h2[1], title: h2[2].slice(0, 26), subs: 0, headTable: false, line: i + 1 };
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    const h3 = /^### (\d+\.\d+)/.exec(lines[i]);
    if (h3 !== null) { cur.subs += 1; continue; }
    // 抬头区（到第一个 ### 之前）里有没有表格行
    // 🔴 **也要认 `> |`**：§7 的抬头导航写在**引用块**里（每行以 `> ` 开头）⇒
    //    第一版只认行首的 `| ` ⇒ 把 §7 报成"没有导航表"（假阴性）。
    if (cur.subs === 0 && lines[i].startsWith('| ') || (cur.subs === 0 && lines[i].startsWith('> | '))) cur.headTable = true;
  }
  // ⚠️ **不再过滤 `subs === 0`**：§10（一页剧本）**没有子节**，而它**确实是一节** ⇒
  //    过滤掉它，普查就会说"7 节"而实际有 **8 节**（`B166`）。现在**全部列出**，没有子节的标 `—`。
  return out;
}


/**
 * **第一屏里每个"挡上线"项，都得有"手往哪放"**（`--hands-agrees`）。
 *
 * 🔴 为什么要有：2026-10-17 的 `B123` 发现"5 件里有 3 件说不清手放哪"，当时是**人工**补的。
 * ⇒ 有了这条，**以后加一行挡上线项而忘了写"手放哪"，就红**。
 *
 * 判据：① 第一屏那张表里的每个 id，**都要在"手往哪放"那一段里出现一次**；
 *       ② "手往哪放"里也不该出现**不在表里**的 id（那是给读者多指的）。
 */
export function handsProblems(markdown) {
  const lines = markdown.split('\n');
  const topStart = lines.findIndex((l) => l.includes('30 秒版'));
  const handsStart = lines.findIndex((l) => l.includes('手往哪放'));
  // ⚠️ **到第一个空行就停** —— 这个块是 5 行 `·` 紧跟一个空行。
  //    第一版延伸到了 §0 正文（那里提到 `B144`）⇒ 报"B144 有手往哪放但不在表里"（假红）。
  const judgement = (() => {
    for (let i = handsStart + 1; i < lines.length; i += 1) if (lines[i].trim() === '') return i;
    return -1;
  })();
  if (topStart === -1 || handsStart === -1) return [];
  // 表里的 id（表在 topStart 与 handsStart 之间）
  const tableIds = new Set();
  for (const line of lines.slice(topStart, handsStart)) {
    const cell = line.split('|')[1] ?? '';
    for (const m of cell.matchAll(/`([AB]\d+)`/g)) tableIds.add(m[1]);
  }
  // "手往哪放"那一段（到下一个空行块或"⚠️ **这一页不回答"）
  const end = judgement === -1 ? Math.min(handsStart + 20, lines.length) : judgement;
  const handsIds = new Set();
  for (const line of lines.slice(handsStart, end)) {
    for (const m of line.matchAll(/`([AB]\d+)`/g)) handsIds.add(m[1]);
  }
  const out = [];
  for (const id of tableIds) if (!handsIds.has(id)) out.push(`${id} 在表里、但**没有"手往哪放"**`);
  for (const id of handsIds) if (!tableIds.has(id)) out.push(`${id} 有"手往哪放"、但**不在表里**`);
  return out;
}


/**
 * **"多久"那张表：每一行要么给时间、要么明说"没查到"**（`--durations`）。
 *
 * 🔴 为什么要有：`B130` 定的纪律是「**能查到写清、查不到的明说**」。而"明说"这件事
 * **没有判据** —— 一串 `待定 / TBD / 空` 会悄悄回来。
 *
 * 判据：第二格（要多久）**必须**含其一：① 时间量词（工作日/日/天/小时/h/分钟/秒/周/月）
 *     ② 「没查到」或「未核实」。
 * ⚠️ **它不判时间对不对** —— 只判"有没有说"。
 */
export function durationProblems(markdown) {
  const lines = markdown.split('\n');
  const head = lines.findIndex((l) => l.includes('多久：能查到时间的写清'));
  if (head === -1) return [];
  const out = [];
  const TIME = /工作日|日内|日|天|小时|h|分钟|秒|周|月/;
  const ADMIT = /没查到|未核实|待核/;
  let seenSep = false;
  for (let i = head; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^[^|]/.test(l) && l.trim() !== '' && i > head + 2) break;   // 表格结束
    if (/^\|[\s:|-]+\|$/.test(l.trim())) { seenSep = true; continue; }
    if (!seenSep || !l.startsWith('| ')) continue;
    const cells = l.replace(/\\\|/g, '\u0001').split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const who = cells[1].replace(/\*/g, '').slice(0, 22);
    const dur = cells[2];
    if (!TIME.test(dur) && !ADMIT.test(dur)) out.push(`${who} —— 既没时间、也没说"没查到"`);
  }
  return out;
}


/**
 * **"先催哪个"里的 id，必须都在"催谁"表里**（`--order-agrees`）。
 *
 * 🔴 为什么要有：§9.10 有三张表（**催谁** / **多久** / **先催哪个**）。前两张已有判据
 * （`--hands-agrees` 守 id、`--durations` 守"有没有说"），而**第三张没有** ——
 * 于是排序表里可能**催一个"催谁"表里没有的 id**。
 *
 * ⚠️ **只做子集关系**（排序 ⊆ 催谁）：**不判"先催哪个对不对"** —— 那是**判断**（`B121` 论证 `A5` 是总闸），不该写死。
 */
export function orderAgreesProblems(markdown) {
  const lines = markdown.split('\n');
  // "催谁"表：§9.10 里第一个表
  const s = lines.findIndex((l) => l.startsWith('### 9.10'));
  if (s === -1) return [];
  const whoIds = new Set();
  let seenSep = false;
  for (let i = s; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^\|[\s:|-]+\|$/.test(l.trim())) { seenSep = true; continue; }
    if (!seenSep) continue;
    if (!l.startsWith('| ')) break;               // 第一个表结束
    for (const m of l.split('|')[1].matchAll(/`([AB]\d+)`/g)) whoIds.add(m[1]);
  }
  // "先催哪个"表
  // 🔴 **必须只在 §9.10 之后找**：`先催哪个` 这几个字**先出现在 `B121` 那行**（第 293 行）⇒
  //    第一版从文档头开始找 ⇒ 锚到了 B121 所在的表格 ⇒ 抽出 0 个 id ⇒ **判据变成永远绿**
  //    （变异测试塞了 `B99` 却没红，才发现的）。
  let o = -1;
  for (let i = s; i < lines.length; i += 1) if (lines[i].includes('先催哪个')) { o = i; break; }
  if (o === -1) return [];
  const orderIds = new Set();
  let sep2 = false;
  for (let i = o; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^\|[\s:|-]+\|$/.test(l.trim())) { sep2 = true; continue; }
    if (!sep2) continue;
    if (!l.startsWith('| ')) break;
    for (const m of l.split('|').slice(1, 3).join('|').matchAll(/`([AB]\d+)`/g)) orderIds.add(m[1]);
  }
  return [...orderIds].filter((id) => !whoIds.has(id)).map((id) => `${id} 在"先催哪个"里，但**不在"催谁"表里**`);
}


/**
 * **判据台账结论句里的两个数字，必须等于表里实际的数**（`--ledger-agrees`）。
 *
 * 🔴 为什么要有：2026-10-17 我用正则改那句里的一个数字，**改坏了整句**
 * （变成「**21 条里 1718，其余 **6 条**」），而 **`--all` 一路绿** ——
 * 因为**那句话里的数字没有任何判据**。
 */
export function ledgerAgreesProblems(markdown) {
  const lines = markdown.split('\n');
  const s = lines.findIndex((l) => l.startsWith('**⚖️ 判据台账'));
  if (s === -1) return ['找不到台账标题'];
  let e = s + 1;
  while (e < lines.length && !lines[e].startsWith('**🗺 漂移地图')) e += 1;
  const rows = lines.slice(s, e).filter((l) => l.startsWith('| ') && !l.startsWith('|---') && !l.startsWith('| 判据 '));
  const summary = lines.slice(s, e).find((l) => l.startsWith('📌 **一句话**')) ?? '';
  const m = /(\d+) 行里 (\d+) 条/.exec(summary);
  if (m === null) return ['结论句里找不到「N 行里 M 条」'];
  const out = [];
  if (Number(m[1]) !== rows.length) out.push(`结论句说 **${m[1]} 行**，实际 **${rows.length}** 行`);
  // ⚠️ **行以 `|` 结尾** ⇒ `split('|').pop()` 是空串；取**倒数第二段**才是最后一列。
  const withMut = rows.filter((r) => {
    const parts = r.split('|');
    return (parts[parts.length - 2] ?? '').trim().startsWith('✅');
  }).length;
  if (Number(m[2]) !== withMut) out.push(`结论句说 **${m[2]} 条有变异**，实际 **${withMut}** 条`);
  return out;
}


/**
 * **两个中文数字必须等于实数**（`--numeral-agrees`）。
 *
 * 🔴 为什么要有：`B159` 教过「散文数字只有两种活法」—— 而这两个**能给它判据**：
 *   ① 「**16 条决定**」（9 处）必须等于 §7.1–§7.4 的决策行数；
 *   ② 「**九个网址**」（8 处）必须等于 `A6` 那行里**列出的网址个数**。
 *
 * ⚠️ **只守这两个** —— 不是所有中文数字。没进这张清单的数，**该换成现量命令**（`B159`）。
 */
export function numeralAgreesProblems(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  // ① 决策行：第一格是 `**X**` 或 `**A1** × **A2**`
  const s = lines.findIndex((l) => l.startsWith('### 7.1'));
  const e = lines.findIndex((l) => l.startsWith('### 7.5'));
  let decisions = 0;
  if (s !== -1 && e !== -1) {
    for (let i = s; i < e; i += 1) {
      if (!lines[i].startsWith('| **')) continue;
      if (/^\|\s*-+/.test(lines[i])) continue;
      decisions += 1;
    }
  }
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const m1 = /(\d+|[一二三四五六七八九十])\s*条决定/.exec(markdown);
  if (m1 !== null) {
    const said = Number.isNaN(Number(m1[1])) ? CN[m1[1]] : Number(m1[1]);
    if (said !== decisions) out.push(`「${m1[0]}」说 ${said}，实际 §7 有 **${decisions}** 条决策行`);
  }
  // ② A6 那行列出的网址个数
  // 🔴 **逐处检查**：`九个网址` 出现 8 处，而**只有列出了网址的那几处**能数。
  //    第一版用 `lines.find(...)` 只看了**第一处**（第一屏那句，没有网址列表）⇒ 变异**没被抓到**。
  let checked = 0;
  for (const l of lines) {
    if (!l.includes('九个网址')) continue;
    // ⚠️ **跳过断言行**（`| **B12x** | …`）：那是**过程记录**，里面会引到"九个网址"与某个网址
    //    ⇒ 第一版没跳，于是 `B161` 自己的叙述被当成"那一行只列了 1 个"（假红）。
    if (/^\| \*\*B\d+\*\*/.test(l)) continue;
    const urls = (l.match(/`\/(?:[a-z-]+)`/g) ?? []).length;
    if (urls === 0) continue;
    checked += 1;
    if (urls !== 9) out.push(`「九个网址」说 9，那一行实际列了 **${urls}** 个`);
  }
  if (checked === 0) out.push('「九个网址」出现多次，但**没有一处真的列出了网址** ⇒ 无法核');

  // ③ 「只差 N 个文件」多处出现 ⇒ **彼此必须一致**。
  //    ⚠️ 这**不是**活读数（活读数在 §9.6 第 8 行，`git status`）；它守的是「**改了 A 没回灌 B**」
  //    —— `B160` 那次就是同一个事实在几处，只改了一处。
  const ns = new Set();
  for (const l of lines) {
    if (/^\| \*\*B\d+\*\*/.test(l)) continue;
    for (const m of l.matchAll(/只差\s*(\d+)\s*个文件/g)) ns.add(Number(m[1]));
  }
  if (ns.size > 1) out.push(`「只差 N 个文件」出现 **${[...ns].sort().join(' / ')}** **${ns.size} 种**说法，它们该是同一个数`);
  return out;
}


/**
 * **编号前缀的约定**（`--id-prefix`）：`A*` 只许住 §1，`B*` 只许住 §2。
 *
 * 🔴 为什么要有：`A` = "**挡上线**"、`B` = "**不阻塞**" —— 这是**这一页最基础的分类**，
 * 而它**只靠人记**。一旦某条 `B` 写进 §1（或反过来），**读者会按前缀理解它，而它住在另一节**。
 *
 * ⚠️ **只查 §1/§2**：§7 的 `§4.2`/`§4.3` 是**决定 id**，与 `A/B` 前缀无关。
 */
export function idPrefixProblems(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let sec = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^## (\d+)\./.exec(lines[i]);
    if (m !== null) { sec = m[1]; continue; }
    if (sec !== '1' && sec !== '2') continue;
    const mm = /^\| \*\*([AB])(\d+)\*\*/.exec(lines[i]);
    if (mm === null) continue;
    const want = mm[1] === 'A' ? '1' : '2';
    if (sec !== want) out.push(`\`${mm[1]}${mm[2]}\`（第 ${i + 1} 行）住在 §${sec}，而 \`${mm[1]}*\` 约定在 §${want}`);
  }
  return out;
}


/**
 * **两个数必须相等**（`--counts-agree`）：`--distribution` 的「🔴 + 🟠」 == `--triage` 报的「仍红」行数。
 *
 * 🔴 为什么要有：`B165` 里我自己算错过一次（把 §2 的 🟠 也加了一遍）——
 * 而"20"这个数在同一份文件里出现在 **§9.9 的四档（20）**、**`--triage`（20）**、
 * **`--distribution` 的 🔴+🟠（20）** 三处。**三处相等**是**可以机械验的**。
 */

export function countsAgreeProblems(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  // 🔴 **逐处检查**：`只有 20 行` 在这一页有 **两处**（🔴"至今仍红"那句 + 📌"真实的仍红"那句）。
  //    第一版用 `find(...)` **只看了其中一处** ⇒ 变异改到**另一处**时**没被抓到**。
  let checked = 0;
  let first = null;
  for (const l of lines) {
    // ⚠️ **跳过表格行**：断言行（`| **B19x** | …`）里会**引到历史上的**「只有 19 行 / 18 行」⇒
    //    第一版没跳，报出 5 处「不符」，其中 3 处是**引文**（假红）。
    if (l.startsWith('|')) continue;
    if (!l.includes('仍红')) continue;
    const m = /只有 (\d+) 行/.exec(l);
    if (m === null) continue;
    const said = Number(m[1]);
    const ids = [...l.matchAll(/`([AB]\d+)`/g)].map((x) => x[1]);
    // ⚠️ **只核「清单行」（列了 >= 5 个 id）**：正文里还有「当时只有 18 行（`B34`）」这类
    //    **历史对比句**，它们**只带一两个 id** ⇒ 第一版没设门槛，把它们也报了（假红）。
    if (ids.length < 5) continue;
    checked += 1;
    if (first === null) first = said;
    if (said !== ids.length) out.push(`一处写「只有 **${said}** 行」，而那一行列了 **${ids.length}** 个 id`);
    if (said !== first) out.push(`两处「只有 N 行」说不同的数（**${first}** 与 **${said}**）`);
  }
  // ⚠️ **第二半（对着 §9.9 的「共 N 条」核）已删**：那句话**不在文档里**
  //    （`4 档、共 20 条` 是 `--triage` 的**输出**，不是文档里的字）⇒ 对着一个**不存在的短语**核，
  //    等于**永远绿**。⇒ 只留第一半（"清单 id 数 == 它自己说的 N"），那是**文档里真的有的两处**。
  if (checked === 0) out.push('找不到「仍红…只有 N 行」并列出 id 的句子 ⇒ 无法核');
  return out;
}


/**
 * **§10 剧本里出现的每个 id，都必须是"已知的挡上线项"**（`--playbook-agrees`）。
 *
 * 🔴 为什么要有：§10 是**写给业主照着做的**。它一旦引用一个**不在 §9.9/§9.10 里的 id**，
 * 业主就会**去找一件这一页没写过的事**。
 * ⚠️ 它**只核 id 的存在性**，不核"这一步该不该排在这儿"（那是判断）。
 */
export function playbookAgreesProblems(markdown) {
  const lines = markdown.split('\n');
  const s = lines.findIndex((l) => l.startsWith('## 10.'));
  if (s === -1) return [];
  // §10 到文末（或下一个 ## ）
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i += 1) if (lines[i].startsWith('## ')) { e = i; break; }
  const ids = new Set();
  for (const l of lines.slice(s, e)) {
    if (!l.startsWith('| ')) continue;
    for (const m of l.matchAll(/`([AB]\d+)`/g)) ids.add(m[1]);
  }
  // 已知集合：§9.9 那段 + §9.10 的三张表（到文末或下一个 ##）
  const s9 = lines.findIndex((l) => l.startsWith('### 9.9'));
  const known = new Set();
  // 🔴 **上界必须是 §10 的开始（`s`），不是 §10 的结尾（`e`）** —— 第一版用了 `e`，
  //    于是「已知集合」**包含 §10 自己** ⇒ 塞一个 `B99` 进去，它立刻变成"已知" ⇒ **自证**、永远绿。
  for (const l of lines.slice(s9, s)) for (const m of l.matchAll(/`([AB]\d+)`/g)) known.add(m[1]);
  return [...ids].filter((id) => !known.has(id)).map((id) => `\`${id}\` 在 §10 里，但**不在 §9.9/§9.10**`);
}


/**
 * **§10 那个"最快 / 最坏"必须能从它上面三行推出来**（`--range-agrees`）。
 *
 * 🔴 为什么要有：`B169` 里我自己就把「管局审核」的**最快**写成了「≤20 工作日」——
 * 于是**结论（最快 2 天）和表里的数字（最快 22 工作日）打架**，而**没人看得出来**。
 *
 * 判据：把「提交→短信 / 腾讯云 / 管局」三行的**最快**与**最坏**各取第一个数（「当天」= 0），
 * 求和，再与**合计那行**的说法比 —— **最快按"天"**、**最坏按"周"**（5 工作日/周），**允许 ±1**。
 */
export function rangeAgreesProblems(markdown) {
  const lines = markdown.split('\n');
  const h = lines.findIndex((l) => l.includes('这五步合起来要多久'));
  if (h === -1) return [];
  const rows = [];
  for (let i = h; i < Math.min(h + 14, lines.length); i += 1) {
    if (!lines[i].startsWith('| ')) continue;
    if (/^\|[\s:|-]+\|$/.test(lines[i].trim())) continue;
    const c = lines[i].split('|').map((x) => x.trim());
    if (c.length < 5) continue;
    rows.push({ name: c[1], fast: c[2], slow: c[3] });
  }
  const total = rows.find((r) => (r.name ?? '').includes('⇒'));
  if (total === undefined) return ['找不到「⇒ 到拿到备案号」那一行'];
  const num = (s) => {
    if (s.includes('当天')) return 0;
    const m = /(\d+)/.exec(s);
    return m === null ? null : Number(m[1]);
  };
  const parts = rows.filter((r) => r !== total);
  const sumFast = parts.reduce((a, r) => a + (num(r.fast) ?? 0), 0);
  const sumSlow = parts.reduce((a, r) => a + (num(r.slow) ?? 0), 0);
  const out = [];
  const claimFast = num(total.fast);
  const claimSlow = num(total.slow);
  if (claimFast !== null && Math.abs(claimFast - sumFast) > 1) {
    out.push(`合计说「最快 ${total.fast}」，而三行相加是 **${sumFast}** 天`);
  }
  if (claimSlow !== null && total.slow.includes('周')) {
    const weeks = sumSlow / 5;
    if (Math.abs(claimSlow - weeks) > 1) {
      out.push(`合计说「最坏 ${total.slow}」，而三行相加是 **${sumSlow}** 工作日 ≈ **${weeks.toFixed(1)} 周**`);
    }
  }
  return out;
}


/**
 * **§9.1 表里的每个 flag，是否真的在某个工具里**（`--modes-agrees` 的反方向）。
 *
 * 🔴 为什么要有：正方向（`--modes-agrees`）只守"**工具的每个模式都在表里**" ——
 * 而**反方向没人守**：某条命令**被删了**，表里还留着它 ⇒ 读者照着跑会**报 unknown flag**。
 *
 * ⚠️ **扫全部** `research/tools/*.mjs` 与 `scripts/*.mjs`（因为 §9.1 也列别的工具）。
 */
export function deadFlagProblems(markdown, sources) {
  const lines = markdown.split('\n');
  const s = lines.findIndex((l) => l.startsWith('### 9.1'));
  const e = s === -1 ? -1 : (() => { let j = s + 1; while (j < lines.length && !/^#{2,3} /.test(lines[j])) j += 1; return j; })();
  if (s === -1) return [];
  const docFlags = new Set();
  for (const l of lines.slice(s, e)) for (const m of l.matchAll(/--[a-z][a-z-]+/g)) docFlags.add(m[0]);
  const known = new Set();
  for (const src of sources) for (const m of src.matchAll(/'--[a-z][a-z-]+'/g)) known.add(m[0].slice(1, -1));
  return [...docFlags].filter((f) => !known.has(f)).sort();
}

function selfTest() {
  const arms = [];
  const arm = (name, ok, detail) => arms.push({ name, ok, detail });

  // 臂 1：**判据 / 散文 的分类必须真的分得开**（"散文 0"这个读数的前提）
  const rows = parseRows('| **A1** | x | `pnpm check:docs` |\n| **A2** | x | 这事得业主拍 |\n');
  arm('有可跑出口的算判据', classify(rows[0].text) === '判据', classify(rows[0].text));
  arm('没有出口的算散文（不是默认算判据）', classify(rows[1].text) === '散文', classify(rows[1].text));

  // 臂 2：**决定的"选项"缺失必须被抓到**（§7 那张表的判据）
  //    ⚠️ 输入必须**同时有 `### 7.1` 与 `### 7.4`** —— `parseDecisions` 靠这两行界定射程，
  //    缺任一行它会返回 `[]`（第一版我漏了 `### 7.4` ⇒ 臂假红）。
  const decMd = (opt) =>
    `### 7.1 x\n\n| # | 决定 | 选项 | 后果 |\n|---|---|---|---|\n| **A1** | 要不要 | ${opt} | 不决定就发不出去，而且没有任何一层会拦 |\n\n### 7.4 x\n`;
  arm('决定缺"选项"会被算成问题', decisionProblems(parseDecisions(decMd(''))).length >= 1,
    `问题数 ${decisionProblems(parseDecisions(decMd(''))).length}`);
  arm('正面对照：写全了就不报', decisionProblems(parseDecisions(decMd('(a) 补 / (b) 切'))).length === 0,
    `问题数 ${decisionProblems(parseDecisions(decMd('(a) 补 / (b) 切'))).length}`);
  // 臂 2b：**射程读不到时必须能被认出**（否则 `--decisions` 会"空转却报绿"）
  arm('缺 `### 7.4` 时射程为空（上层必须据此报错，不许报绿）',
    parseDecisions('### 7.1 x\n\n| **A1** | 要不要 |  |  |\n').length === 0, '0 行');

  // 臂 2d：**选项里没有体量要被抓到**（本轮那次收口审查）
  const dHead = '### 7.1 x\n\n';
  const dFoot = '\n\n### 7.4 x\n';
  // ⚠️ 样本里**不能出现词表里的任何字**（第一版写了「收掉 / 不收」，而 `收掉` **就在词表里** ⇒ 臂假红）。
  const noCost = `${dHead}| **A1** | x | 甲方案 / 乙方案 | 后果够长的后果够长的 | 验 |${dFoot}`;
  arm('选项里没体量 ⇒ 被抓到', decisionCostProblems(noCost).length === 1,
    `${decisionCostProblems(noCost).length} 条`);
  const withCost = `${dHead}| **A1** | x | 收掉（小改） | 后果够长的后果够长的 | 验 |${dFoot}`;
  arm('正面对照：带体量 ⇒ 放行', decisionCostProblems(withCost).length === 0, '0 条');

  // 臂 2c：**因果断言没出处要被抓到**（B30/B31/B32 那一族）
  const causalHead = '### 7.5 x\n\n';
  const causalFoot = '\n\n## 8. x\n';
    //    ⚠️ 输入里**必须真的含关系词**（第一版写"先 A 再 B"，而正则里是"必须先" ⇒ 臂假红）。
  const noSrc = `${causalHead}| **①** | x | 这件事取决于那一件 | 后果 |\n${causalFoot}`;
  arm('无出处的因果被抓到', causalProblems(noSrc).length === 1, `${causalProblems(noSrc).length} 条`);
  arm('标了【推断】就放行', causalProblems(`${causalHead}| **①** | x | 这件事取决于那一件 🟡【推断】 | 后果 |\n${causalFoot}`).length === 0, '0 条');
  arm('有出处（行号）就放行', causalProblems(`${causalHead}| **①** | x | 这件事取决于那一件（见 B31）| 后果 |\n${causalFoot}`).length === 0, '0 条');

  // 臂 2e：**§7.3 的动作缺体量/后果要被抓到**（本轮那次重写）
  const oHead = '### 7.3 要本人做的\n\n';
  const oFoot = '\n\n### 7.4 x\n';
  arm('动作缺体量 ⇒ 被抓到',
    ownerActionProblems(`${oHead}1. 点一下\n2. 发一下\n${oFoot}`).length === 4,
    `${ownerActionProblems(`${oHead}1. 点一下\n2. 发一下\n${oFoot}`).length} 处`);
  arm('正面对照：写了体量与后果 ⇒ 放行',
    ownerActionProblems(`${oHead}1. 点一下\n   · **体量**：一个框\n   · 🔴 **做错会怎样**：要重来\n${oFoot}`).length === 0,
    '0 处');

  // 臂 2r：**工具的每个模式都得在 §9.1 里**（2026-10-17：§9.1 漏过 3 个，当时只是人工比）
  const mdOk = ['### 9.1 x', '', '| a | `--alpha` · `--beta` |', ''].join('\n');
  arm('模式全在 §9.1 ⇒ 放行',
    modesAgreeProblems(mdOk, "process.argv.includes('--alpha')".concat("process.argv.includes('--beta')")).missing.length === 0, '0');
  arm('§9.1 漏一个模式 ⇒ 被抓到',
    modesAgreeProblems(mdOk, "process.argv.includes('--alpha')".concat("process.argv.includes('--gamma')")).missing.join(',') === '--gamma',
    modesAgreeProblems(mdOk, "process.argv.includes('--alpha')".concat("process.argv.includes('--gamma')")).missing.join(','));

  // 臂 2q：**两套"表格列数"实现必须一致**（2026-10-17）
  //   `tableCellProblems`（本文件，块扫描）与 `scripts/safe-table-row.mjs`（写前闸门，向上找）
  //   **算法不同**——所以它们**彼此独立**，而**独立的两套应当在同一份样本上给同一个答案**。
  {
    const broken = ['| a | b |', '|---|---|', '| x | y | z |'].join('\n');
    const viaAudit = tableCellProblems(broken).length > 0;
    const viaSafe = checkInsert(broken, '| x | y | z |', '| p | q |').ok === false;
    arm('两套表格检查在同一份坏样本上都报红', viaAudit && viaSafe, `${viaAudit}/${viaSafe}`);
  }

  // 臂 2p：**第一屏与 §9.9 不同组**要被抓到（2026-10-17：30 秒版手抄了那 5 个 id）
  const topMd = ['## 🕐 30 秒版 x', '', '| 挡上线的 5 件 | 一句话 |', '|---|---|', '| **`A1`** | 甲 |', '', '## 0. 一句话', '', '### 9.9 x', '', '| 🔴 **挡上线** | `A1` · `A2` | 理由 |', ''].join('\n');
  arm('第一屏少了 id ⇒ 被抓到', topAgreementProblems(topMd).onlyBucket.join(',') === 'A2', topAgreementProblems(topMd).onlyBucket.join(','));
  arm('正面对照：同一组 ⇒ 放行',
    topAgreementProblems(topMd.replace('`A1` · `A2`', '`A1`')).onlyBucket.length === 0, '0');

  // 臂 2o：**🟠（已复核仍未通）必须算"没通"**（2026-10-17：A4/A6 曾被 ✅ 读成"没事了"）
  const orgMd = ['## 1. x', '', '| **A1** | 🟠 **已复核、仍未通** 坏的 | r | o |', '', '### 9.9 x', '', '| 🔴 **挡上线** | `A1` | 理由 |', '', '## 5. y'].join('\n');
  arm('🟠 算"没通" ⇒ 必须分档', triageProblems(orgMd).redOnly.join(',') === 'A1', triageProblems(orgMd).redOnly.join(','));
  arm('🟠 在分布里单独一列', distributionStats(orgMd).stat['§1'].orange === 1, String(distributionStats(orgMd).stat['§1'].orange));

  // 臂 2n：**档与正文打架**要被抓到（2026-10-17：B33 写在"挡上线"档里，正文却说"不阻塞上架"）
  const cMd = ['## 1. x', '', '| **A1** | 🔴 坏的，但它不急 | r | o |', '', '### 9.9 x', '', '| 🔴 **挡上线** | `A1` | 理由 |', '', '## 5. y'].join('\n');
  arm('档与正文打架 ⇒ 被抓到', triageProblems(cMd).conflicts.length === 1, String(triageProblems(cMd).conflicts.length));
  arm('正面对照：不写"不急" ⇒ 放行',
    triageProblems(cMd.replace('但它不急', '')).conflicts.length === 0, '0');

  // 臂 2m：**仍红的行没分档**要被抓到（2026-10-17 的 §9.9 是手写表）
  const triMd = ['## 1. x', '', '| **A1** | 🔴 坏的 | r | o |', '| **B1** | 🔴 也坏 | r | o |', '', '### 9.9 x', '', '| 🔴 **挡上线** | `A1` | 理由 |', '', '## 5. y'].join('\n');
  arm('仍红的行没分档 ⇒ 被抓到', triageProblems(triMd).missing.join(',') === 'B1', triageProblems(triMd).missing.join(','));
  arm('正面对照：都分了 ⇒ 放行', triageProblems(triMd.replace('| **B1** | 🔴 也坏 | r | o |', '| **B1** | ✅ 修好 | r | o |')).missing.length === 0, '0');

  // 臂 2l：**无标记行只能是归并/撤回**（2026-10-17 靠肉眼找出的 6 行本该是 🔴）
  const distMd = ['## 1. x', '', '| **A1** | 标题 | 读数 | 出口 |', '| **B1** | 🔴 坏的 | 读数 | 出口 |', '| **B2** | 【2026-10-17 撤回】 | x | y |', '', '## 5. y'].join('\n');
  arm('无标记行不是归并/撤回 ⇒ 被抓到', distributionStats(distMd).badUnmarked.join(',') === 'A1',
    distributionStats(distMd).badUnmarked.join(','));
  arm('正面对照：归并/撤回无标记 ⇒ 放行',
    distributionStats(['## 1. x', '', '| **B2** | 【2026-10-17 撤回】 | x | y |', '', '## 5. y'].join('\n')).badUnmarked.length === 0, '0');

  // 臂 2k：**读数过期要被抓到**（2026-10-17：§9.6 原写「当天复跑过」，过午夜就自动不成立）
  const staleMd = '> 这四道今天都复跑过（2026-10-01，四条读数各一行）';
  arm('过期读数 ⇒ 被抓到', staleProblems(staleMd, '2026-10-17').some((r) => r.stale),
    String(staleProblems(staleMd, '2026-10-17')[0]?.age));
  arm('正面对照：1 天前 ⇒ 不算过期', staleProblems(staleMd, '2026-10-02').every((r) => !r.stale), 'ok');

  // 臂 2j：**§0 的计数与表对不上**要被抓到（B76 那次是手算发现的）
  const scBad = '## 0. x\n\n§7.9 有 9 个问题。\n\n### 7.9 x\n\n| **a** | b | c | d | e |\n\n## 8. x\n';
  arm('§0 计数对不上 ⇒ 被抓到', scopeCountProblems(scBad).length === 1,
    `${scopeCountProblems(scBad).length} 处`);
  const scOk = '## 0. x\n\n§7.9 有 1 个问题。\n\n### 7.9 x\n\n| **a** | b | c | d | e |\n\n## 8. x\n';
  arm('正面对照：对得上 ⇒ 放行', scopeCountProblems(scOk).length === 0, '0 处');

  // 臂 2i：**小节没进抬头导航**要被抓到（B57 那次是两层指路打架）
  const navHead = '## 7. 待拍板\n\n只指 §7.1。\n\n### 7.1 x\n\n### 7.2 y\n';
  arm('小节没进导航 ⇒ 被抓到', sectionNavProblems(navHead).join(',') === '7.2',
    sectionNavProblems(navHead).join(','));
  arm('正面对照：都进了 ⇒ 放行', sectionNavProblems('## 7. x\n\n§7.1 · §7.2\n\n### 7.1 a\n\n### 7.2 b\n').length === 0, '0');

  // 臂 2h：**决定没被路径覆盖**要被抓到（B55 那次我是手算的）
  const pcHead = '### 7.1 x\n\n| **A1** | x | o | c | e |\n| **B2** | x | o | c | e |\n\n';
  const pcPath = '### 7.6 x\n\n先做 `A1`。\n\n### 7.7 x\n\n';
  arm('决定没进路径 ⇒ 被抓到', pathCoverageProblems(pcHead + pcPath).join(',') === 'B2',
    pathCoverageProblems(pcHead + pcPath).join(','));
  arm('正面对照：都进了路径 ⇒ 放行', pathCoverageProblems(pcHead + pcPath + '再做 `B2`。\n').length === 0, '0');

  // 臂 2g：**带参数的 node 命令也算可跑**（B53 那次被误判成散文）
  arm('带 flag 的 node 命令 ⇒ 认得出',
    classify('| **X1** | 标题 | 读数 | 出口 | 📌 `node research/tools/t.mjs --some-flag` | 1 |') !== '散文',
    'ok');

  // 臂 2f：**被劈开的 bullet 要被抓到**（B53 那次是我人眼看出来的）
  arm('劈开的 bullet ⇒ 被抓到',
    bulletStructureProblems('- **甲**：开头\n  缩进续行\n没缩进的续行\n- **乙**：下一项\n').length === 1,
    `${bulletStructureProblems('- **甲**：开头\n  缩进续行\n没缩进的续行\n- **乙**：下一项\n').length} 处`);
  arm('正面对照：全部缩进 ⇒ 放行',
    bulletStructureProblems('- **甲**：开头\n  缩进续行\n  另一行\n- **乙**：下一项\n').length === 0, '0 处');

  // 臂 3：**零命中断言要认得出来**
  arm('零调用点被认出', zeroClaims('这里零调用点').length === 1, `${zeroClaims('这里零调用点').length} 处`);
  arm('正面对照：普通句子不算零命中', zeroClaims('这里有两个调用点').length === 0, '0 处');

  // 臂 4：**有没有写明探针要分得开**
  arm('写明了探针（反引号里有名字）', statesProbe('见 `ShareApiClient` 的用法') === true, 'true');
  arm('没写探针', statesProbe('全仓一个都没有') === false, 'false');

  let failed = 0;
  for (const a of arms) {
    if (!a.ok) failed += 1;
    console.log(`  ${a.ok ? '✅' : '🔴'} ${a.name} —— ${a.detail}`);
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failed}`);
  return failed;
}

function main() {
  // 🔴 **`--five-readings` 要在最前面处理并立刻 `return`** —— 它**不是 async**，
  //    所以第一版用 `.then()` 时，`main()` 会**继续往下跑**，把整张表也打出来。
  if (process.argv.includes('--five-readings')) {
    fiveReadings(process.cwd()).then((rows) => {
      console.log('业主只看这五个数（变了就是有进展）：');
      for (const r of rows) console.log(`  · ${r.k} = **${r.v}**`);
    });
    return;
  }

  // 🔴 **必须放在最前**：第一版没有这个分支，于是 `--self-test` 被**静默忽略**、
  //    照默认模式跑完并 rc=0 —— 看起来像"自检通过"，其实一条臂都没跑（2026-10-16 发现）。
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const markdown = readFileSync(LEDGER, 'utf8');


/**
 * **"臂数"只能有一个值**（`--arms-agrees`）。
 *
 * 🔴 为什么要有（`B218`）：2026-10-17 我给 `scripts/safe-table-row.mjs` 加了 4 条 `--line` 臂（11 → 15），
 * 而"11 臂"当时住在**两处**（§9.11 的"附"行 与 §9.5 判据台账）—— **没有判据守它** ⇒ 我靠 `grep` 手动找，
 * 而 **grep 找不全会让它继续漂**。
 * ⇒ 这条判据**真去跑** `safe-table-row --self-test`，把打印的臂数**和这一页里每一处 `N 臂` 比** ——
 *    ⚠️ **只比"活着的"那些**：B 行（`**B…**`）里的是**历史记录**，本来就该留旧值。
 */
/**
 * **§9.11 那张体检单"多老了"**（`--stamp-agrees`）。
 *
 * 🔴 为什么要有（`B221`）：2026-10-17 我逐格真跑 §9.11，**9 格里 2 格过期** —— 而
 * 它**只隔了 6 轮**。`--all-count-agrees` 只守第 1 行那一个数，**第 2–8 行没有任何判据**。
 * ⇒ 每格内容**判不了**（要真跑 8 条命令，还得比中文），但**"这张快照多老了"判得了** ✅。
 * ⇒ 所以：**抬头里那个日期，距今不得超过 1 天** —— 过一天就红，逼人重跑。
 * ⚠️ **我选 1 天而不是 0 天**：同一天里重跑几次不该红；而"隔了一夜还没重跑"就该红 ✅。
 */
/**
 * **§9.11 那几格读数，能不能自动对**（`--readings-agrees`）。
 *
 * 🔴 为什么要有（`B221`）：2026-10-17 逐格真跑，**9 格里 2 格过期** —— 而 `--all-count-agrees`
 * 只守第 1 行那一个数。⇒ 当日先试"抽得出来吗"：**四条都抽得出来**（`B223`）。
 * ⇒ 所以把"真跑命令 + 从输出里抽数 + 和格子里写的比"机械化。
 *
 * ⚠️ **只收"抽得出来且稳定"的**：
 *   · 第 2 行 `--triage` → `仍红的行 **N**`
 *   · 第 3 行 `--top-agrees` → `30 秒版：N 个 id`
 *   · 第 6 行 `--unrunnable` → `**N** 条`（⚠️ **它会随我加行而涨** —— 那正是该红的时候）
 *   · 第 7 行 `--self-test` → `臂数 N`
 *   · **第 5 行**也收（五个数，取首词逐位比 —— `B224`）
 *   · **第 8 行**也收（四条门禁）⚠️ **我原先写太慢，量过才发现那是借口**：四条合计 **2.8 秒**（`B225`）。
 *   · **第 4 行不收**：`--stale` 是**日期敏感**的（一过夜就变）⇒ 收了只会天天红 ✅。
 */
function readingsAgreesProblems(markdown) {
  const out = [];
  const lines = markdown.split('\n');
  const s = lines.findIndex((l) => l.startsWith('### 9.11'));
  if (s === -1) return [':找不到 §9.11'];
  const cell = (n) => {
    for (let k = s; k < s + 24; k += 1) {
      if (lines[k].startsWith(`| **${n}** |`)) {
        const parts = lines[k].split('|');
        return parts[3] ?? '';
      }
    }
    return '';
  };
  const run = (args) => {
    try { return execSync(`node research/tools/blocker-evidence-audit.mjs ${args}`, { cwd: process.cwd(), encoding: 'utf8' }); }
    catch (e) { return String(e.stdout ?? ''); }
  };
  const cases = [
    [2, '--triage', /仍红的行 \*\*(\d+)\*\*/, /\*\*(\d+) 行/],
    [3, '--top-agrees', /30 秒版：(\d+) 个 id/, /第一屏 (\d+) =/],
    [6, '--unrunnable', /\*\*(\d+)\*\* 条/, /\*\*(\d+) 条\*\*/],
    [7, '--self-test', /臂数 (\d+)/, /\*\*(\d+) 臂/],
  ];
  // 第 8 行（四条门禁）—— B225：我原先以太慢为由不收，量过才发现 2.8 秒。
  {
    const text8 = cell(8).replace(/`/g, '').replace(/\*\*/g, '');
    const m8 = /(\d) \u00b7 (\d) \u00b7 (\d) \u00b7 (\d)/.exec(text8);
    if (m8 === null) out.push(':§9.11 第 8 行解不出四个数字');
    else {
      const gates = ['check:docs', 'check:md-tables', 'check:doc-citations', 'check:gate-wiring'];
      const got8 = gates.map((g) => {
        try { execSync(`pnpm --silent ${g}`, { cwd: process.cwd(), stdio: 'ignore' }); return 0; }
        catch { return 1; }
      });
      const want8 = [Number(m8[1]), Number(m8[2]), Number(m8[3]), Number(m8[4])];
      for (let i = 0; i < 4; i += 1) {
        if (want8[i] !== got8[i]) out.push(`:§9.11 第 8 行第 ${i + 1} 个门禁写着 ${want8[i]}，而真跑是 ${got8[i]}`);
      }
    }
  }
  // 第 4 行（--stale）—— B226：它每天变，所以格子里只写"条数"，天数以输出为准。
  {
    const text4 = cell(4).replace(/`/g, '').replace(/\*\*/g, '');
    const m4 = /\*\*(\d+) 条\*\*|(\d+) 条/.exec(text4);
    const want4 = Number(m4?.[1] ?? m4?.[2]);
    let got4 = -1;
    try {
      const out4 = execSync('node research/tools/blocker-evidence-audit.mjs --stale', { cwd: process.cwd(), encoding: 'utf8' });
      got4 = out4.split('\n').filter((l) => l.startsWith('✅') || l.startsWith('🔴')).length;
    } catch (e) {
      got4 = String(e.stdout ?? '').split('\n').filter((l) => l.startsWith('✅') || l.startsWith('🔴')).length;
    }
    if (Number.isNaN(want4)) out.push(':§9.11 第 4 行解不出条数');
    else if (want4 !== got4) out.push(`:§9.11 第 4 行写着 ${want4} 条，而 --stale 真打的是 ${got4} 条`);
  }
  // 🔴 **第 5 行（五个数）也抽得出来** —— `B224` 承认上一轮说它"形状复杂"是**图省事**：
  //    输出是**固定五行**，每行 `· 名字 = **值**`；格子里是 `**\`null\` · \`9\` · \`2\` · \`links\` · \`275\`**（其中 …）`。
  //    ⇒ **两边都取"首词"**（`links（= 0 次提交）` → `links`、`275（其中 …）` → `275`），逐位比。
  {
    const text = cell(5).replace(/`/g, '').replace(/\*\*/g, '');
    const want = text.split('·').map((x) => x.trim().split('（')[0].trim()).filter((x) => x !== '');
    let got = [];
    try {
      const out = execSync('node research/tools/blocker-evidence-audit.mjs --five-readings', { cwd: process.cwd(), encoding: 'utf8' });
      got = out.split('\n').filter((l) => l.trim().startsWith('·')).map((l) => l.slice(l.indexOf('= ') + 2).replace(/\*/g, '').split('（')[0].trim());
    } catch (e) {
      got = String(e.stdout ?? '').split('\n').filter((l) => l.trim().startsWith('·')).map((l) => l.slice(l.indexOf('= ') + 2).replace(/\*/g, '').split('（')[0].trim());
    }
    if (want.length !== 5) out.push(`:§9.11 第 5 行解不出五个数（解出 ${want.length} 个）`);
    else if (got.length !== 5) out.push(`:§9.11 第 5 行：--five-readings 的输出不是五行（${got.length} 行）`);
    else for (let i = 0; i < 5; i += 1) if (want[i] !== got[i]) out.push(`:§9.11 第 5 行第 ${i + 1} 个数写着 ${want[i]}，而真打的是 ${got[i]}`);
  }
  for (const [n, args, reOut, reCell] of cases) {
    const text = cell(n);
    const mc = reCell.exec(text);
    if (mc === null) { out.push(`:§9.11 第 ${n} 行抽不出数（格子：${text.slice(0, 40)}）`); continue; }
    const mo = reOut.exec(run(args));
    if (mo === null) { out.push(`:§9.11 第 ${n} 行：\`${args}\` 的输出抽不出数`); continue; }
    if (mc[1] !== mo[1]) out.push(`:§9.11 第 ${n} 行写着 ${mc[1]}，而 \`${args}\` 真打的是 ${mo[1]}`);
  }
  return out;
}


function stampAgreesProblems(markdown, today) {
  const out = [];
  const lines = markdown.split('\n');
  const at = lines.findIndex((l) => l.startsWith('### 9.11'));
  if (at === -1) return [':找不到 §9.11'];
  const m = /（(\d{4}-\d{2}-\d{2})/.exec(lines[at]);
  if (m === null) return [':§9.11 抬头里没有日期'];
  const stamp = m[1];
  const a = Date.parse(`${stamp}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a)) return [`:§9.11 抬头的日期解析不了：${stamp}`];
  const days = Math.round((b - a) / 86400000);
  if (days > 1) out.push(`:§9.11 的体检单是 ${stamp} 的（${days} 天前）⇒ 隔夜没重跑，它可能已经过期`);
  return out;
}


function armsAgreesProblems(markdown) {
  const out = [];
  let real;
  try {
    const txt = execSync('node scripts/safe-table-row.mjs --self-test', { cwd: process.cwd(), encoding: 'utf8' });
    const m = /臂数\s*(\d+)/.exec(txt);
    if (m === null) return [':（safe-table-row --self-test 没打印"臂数 N"）'];
    real = Number(m[1]);
  } catch (e) {
    return [`:（safe-table-row --self-test 跑不起来：${String(e.message).slice(0, 120)}）`];
  }
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // B 行 / 历史记录不算
    if (/^\| \*\*B\d+\*\*/.test(line)) continue;
    // 🔴 只查关于 safe-table-row 的臂数：这一页里还有别的工具的自检臂数
    //    （verify:artifact-facts 3 臂、check:payment-entry 4 臂），那些不归这条判据管（B218）。
    if (!line.includes('safe-table-row')) continue;
    for (const m of line.matchAll(/(\d+)\s*臂/g)) {
      const n = Number(m[1]);
      if (n !== real) out.push(`:${i + 1} 写着 ${n} 臂，而工具真打的是 ${real} 臂`);
    }
  }
  return out;
}


  if (process.argv.includes('--all')) {
    // 🔴 **一条命令复核这一页**：把散着跑的八个模式收成一次。
    //    ⚠️ `--gate-mentions` 是**探照灯**（不判缺陷）⇒ 这里只作**信息**，不参与退出码。
    const blocks2 = bulletStructureProblems(markdown);
    const owner2 = ownerActionProblems(markdown);
    const cost2 = decisionCostProblems(markdown);
    const path2 = pathCoverageProblems(markdown);
    const nav2 = [
      ...sectionNavProblems(markdown, '3'),
      ...sectionNavProblems(markdown, '4'),
      ...sectionNavProblems(markdown, '7'),
      ...sectionNavProblems(markdown, '8'),
      ...sectionNavProblems(markdown, '9'),
    ];
    const dist2 = distributionStats(markdown);
    const tri2 = triageProblems(markdown);
    const hc2 = headingCountProblems(markdown);
    const io2 = idOrderProblems(markdown);
    const hands2 = handsProblems(markdown);
    const dur2 = durationProblems(markdown);
    const ord2 = orderAgreesProblems(markdown);
    const lg2 = ledgerAgreesProblems(markdown);
    const nm2 = numeralAgreesProblems(markdown);
    const px2 = idPrefixProblems(markdown);
    const ca2 = countsAgreeProblems(markdown);
    const pb2 = playbookAgreesProblems(markdown);
    const rg2 = rangeAgreesProblems(markdown);
    const aa2 = armsAgreesProblems(markdown);
    const st2 = stampAgreesProblems(markdown, new Date().toISOString().slice(0, 10));
    const rd2 = readingsAgreesProblems(markdown);
    const top2 = topAgreementProblems(markdown);
    const cells2 = tableCellProblems(markdown);
    const scope2 = scopeCountProblems(markdown);
    const stale2 = staleProblems(markdown, new Date().toISOString().slice(0, 10));
    const rows2 = parseRows(markdown);
    const counts = { 判据: 0, 外部: 0, 人工: 0, 散文: 0, 归并: 0 };
    for (const r of rows2) counts[classify(r.text)] += 1;
    const dec2 = decisionProblems(parseDecisions(markdown));
    const zc2 = zeroClaimGaps(markdown);
    const causal2 = causalProblems(markdown);
    const lines2 = [
      ['§9.11 那七格读数与命令输出一致', rd2.length === 0, rd2.length === 0 ? '七格都对' : rd2.join(' · ')],
      ['§9.11 体检单不过夜（隔天就该重跑）', st2.length === 0, st2.length === 0 ? '是今天的' : st2.join(' · ')],
      ['臂数一致（safe-table-row 真跑一次）', aa2.length === 0, aa2.length === 0 ? '每一处都等于工具真打的数' : aa2.join(' · ')],
      ['分类计数', counts['散文'] === 0, `判据 ${counts['判据']} · 外部 ${counts['外部']} · 人工 ${counts['人工']} · 散文 ${counts['散文']}`],
      ['§7 决定写实（选项 + 后果）', dec2.length === 0, dec2.length === 0 ? '16 条齐' : `${dec2.length} 条缺`],
      ['零命中写明探针', zc2.length === 0, zc2.length === 0 ? '0 行缺' : `${zc2.length} 行缺`],
      ['§7 因果/分组有出处', causal2.length === 0, causal2.length === 0 ? '全有' : `${causal2.length} 处无出处`],
      ['§7.3 动作的体量与后果', owner2.length === 0, owner2.length === 0 ? '4 项齐' : `${owner2.length} 处缺`],
      ['§7 选项的体量或前提', cost2.length === 0, cost2.length === 0 ? '16 条齐' : `${cost2.length} 条缺`],
      ['bullet 结构（续行缩进）', blocks2.length === 0, blocks2.length === 0 ? '无被劈开的' : `${blocks2.length} 处`],
      ['最短路径覆盖', path2.length === 0, path2.length === 0 ? '全部覆盖' : `${path2.length} 条没进路径`],
      ['§3 / §4 / §7 / §8 / §9 的小节都进了抬头导航', nav2.length === 0, nav2.length === 0 ? `${markdown.split('\n').filter((l) => /^### (3|4|7|8|9)\.\d/.test(l)).length} 个全在（§3 + §4 + §7 + §8 + §9）` : `${nav2.length} 个没进`],
      ['表格列数一致', cells2.length === 0, cells2.length === 0 ? '全一致' : `${cells2.length} 行不一致（多出的格会被丢弃）`],
      ['§0/§0.2 计数与表一致', scope2.length === 0, scope2.length === 0 ? '一致' : `${scope2.length} 处对不上`],
      ['无标记行只有归并/撤回', dist2.badUnmarked.length === 0, dist2.badUnmarked.length === 0 ? `${dist2.allowed.join('/')}` : `${dist2.badUnmarked.join('·')} 缺标记`],
      ['仍红的行都分了档', tri2.missing.length + tri2.duplicated.length + tri2.stale.length === 0, tri2.missing.length + tri2.duplicated.length + tri2.stale.length === 0 ? `${tri2.redOnly.length} 行` : `缺 ${tri2.missing.length} · 重 ${tri2.duplicated.length} · 旧 ${tri2.stale.length}`],
      ['抬头里的数字等于本节行数', hc2.length === 0, hc2.length === 0 ? '一致' : `${hc2.length} 处不符`],
      ['id 不重复、递增、缺号已声明', io2.length === 0, io2.length === 0 ? '一致' : `${io2.length} 处`],
      ['挡上线项都有"手往哪放"', hands2.length === 0, hands2.length === 0 ? '一致' : `${hands2.length} 处`],
      ['"多久"表每行都有时间或明说没查到', dur2.length === 0, dur2.length === 0 ? '一致' : `${dur2.length} 行`],
      ['"先催哪个"的 id 都在"催谁"表里', ord2.length === 0, ord2.length === 0 ? '一致' : `${ord2.length} 处`],
      ['台账结论句的数字等于表里实数', lg2.length === 0, lg2.length === 0 ? '一致' : `${lg2.length} 处`],
      ['两个中文数字等于实数', nm2.length === 0, nm2.length === 0 ? '一致' : `${nm2.length} 处`],
      ['编号前缀不越界（A* 在 §1、B* 在 §2）', px2.length === 0, px2.length === 0 ? '一致' : `${px2.length} 处`],
      ['§9.8 的「只有 N 行」等于所列 id 数', ca2.length === 0, ca2.length === 0 ? '一致' : `${ca2.length} 处`],
      ['§10 的 id 都是已知挡上线项', pb2.length === 0, pb2.length === 0 ? '一致' : `${pb2.length} 处`],
      ['§10 的"最快/最坏"能从三行推出来', rg2.length === 0, rg2.length === 0 ? '一致' : `${rg2.length} 处`],
      ['第一屏与 §9.9 同组', top2.onlyTop.length + top2.onlyBucket.length === 0, top2.onlyTop.length + top2.onlyBucket.length === 0 ? `${top2.top.length} 个` : `多 ${top2.onlyTop.join('')} 少 ${top2.onlyBucket.join('')}`],
      ['读数没过期', stale2.every((r) => !r.stale), stale2.length === 0 ? '无复跑日印记' : stale2.map((r) => `${r.age} 天前`).join(' · ')],
    ];
    let bad = 0;
    for (const [name, ok, detail] of lines2) {
      if (!ok) bad += 1;
      console.log(`${ok ? '✅' : '🔴'} ${name} —— ${detail}`);
    }
    console.log('📌 `--gate-mentions` 是**探照灯**（对账件只收上线阻断项，所以"没提到"多半正常），不参与退出码。');
    console.log(bad === 0 ? '⇒ 一条命令复核完毕：**全绿**。' : `⇒ 有 ${bad} 项红。`);
    process.exit(bad === 0 ? 0 : 1);
  }

  // ⚠️ 必须放在 `const markdown = ...` **之后** —— 第一版放在最前面，报 `Cannot access 'markdown' before initialization`。
  if (process.argv.includes('--after')) {
    const id = process.argv[process.argv.indexOf('--after') + 1];
    const r = afterReading(markdown, id);
    if (r === null) { console.log(`🔴 §9.10 里没有 \`${id}\` 这一行`); process.exit(1); }
    console.log(`**${r.id}**`);
    console.log(`  催谁：${r.who}`);
    console.log(`  催什么：${r.what}`);
    console.log(`  做完怎么验：${r.how}`);
    process.exit(0);
  }

  if (process.argv.includes('--range-agrees')) {
    const rg = rangeAgreesProblems(markdown);
    if (rg.length === 0) console.log('✅ §10 的"最快/最坏"能从上面三行推出来。');
    else { console.log(`🔴 ${rg.length} 处不符：`); for (const x of rg) console.log(`   · ${x}`); }
    console.log('⚠️ 允许 ±1（工作日与自然日的换算不是精确的）。');
    process.exit(rg.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--playbook-agrees')) {
    const pb = playbookAgreesProblems(markdown);
    if (pb.length === 0) console.log('✅ §10 里每个 id 都在 §9.9/§9.10 出现过（都是已知的挡上线项）。');
    else { console.log(`🔴 ${pb.length} 处：`); for (const x of pb) console.log(`   · ${x}`); }
    console.log('⚠️ 只核 id 存在性，不核"这一步该不该排在这儿"。');
    process.exit(pb.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--counts-agree')) {
    const c = countsAgreeProblems(markdown);
    if (c.length === 0) console.log('✅ §9.8 那几句「只有 N 行」，都等于它们各自列的 id 数。');
    else { console.log(`🔴 ${c.length} 处不符：`); for (const x of c) console.log(`   · ${x}`); }
    process.exit(c.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--id-prefix')) {
    const px = idPrefixProblems(markdown);
    if (px.length === 0) console.log('✅ `A*` 全在 §1、`B*` 全在 §2。');
    else { console.log(`🔴 ${px.length} 处越界：`); for (const x of px) console.log(`   · ${x}`); }
    process.exit(px.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--all-count-agrees')) {
    // 🔴 **为什么这是"独立模式"而不是 `--all` 里的一项**（`B220`）：
    //    它验的数**就是 `--all` 的项数** ⇒ 若它自己也是 `--all` 的一项，
    //    **加进来就会让被验的数 +1**（自指）⇒ 永远差一。
    //    ⇒ 所以它只能在**外面**跑：**`--all` 作为子进程**，数它打印的 ✅ 行。
    const md = markdown;
    const m = /^\| \*\*1\*\* \|[^|]*\|\s*\*\*(\d+) 项全绿\*\*/m.exec(md);
    if (m === null) { console.log('🔴 §9.11 第 1 行没写"**N 项全绿**"'); process.exit(1); }
    const written = Number(m[1]);
    let printed = 0;
    try {
      const out = execSync('node research/tools/blocker-evidence-audit.mjs --all', { cwd: process.cwd(), encoding: 'utf8' });
      printed = out.split('\n').filter((l) => l.startsWith('✅')).length;
    } catch (e) {
      const out = String(e.stdout ?? '');
      printed = out.split('\n').filter((l) => l.startsWith('✅')).length;
    }
    if (printed !== written) {
      console.log(`🔴 §9.11 写着 **${written} 项全绿**，而 --all 真打印 **${printed}** 行 ✅`);
      process.exit(1);
    }
    console.log(`✅ §9.11 的 **${written} 项**与 --all 真打印的一致`);
    process.exit(0);
  }

  if (process.argv.includes('--numeral-agrees')) {
    const n = numeralAgreesProblems(markdown);
    if (n.length === 0) console.log('✅ 三条都成立：「16 条决定」= §7 行数 · 「九个网址」= 9 · 「只差 N 个文件」各处同数。');
    else { console.log(`🔴 ${n.length} 处不符：`); for (const x of n) console.log(`   · ${x}`); }
    console.log('⚠️ 只守这三条；其它中文数字该换成现量命令（B159）。');
    process.exit(n.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--ledger-agrees')) {
    const lg = ledgerAgreesProblems(markdown);
    if (lg.length === 0) console.log('✅ 台账结论句里的两个数字，等于表里实际的数。');
    else { console.log(`🔴 ${lg.length} 处不符：`); for (const x of lg) console.log(`   · ${x}`); }
    process.exit(lg.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--order-agrees')) {
    const o = orderAgreesProblems(markdown);
    if (o.length === 0) console.log('✅ "先催哪个"里的 id，全部都在"催谁"表里。');
    else { console.log(`🔴 ${o.length} 处：`); for (const x of o) console.log(`   · ${x}`); }
    console.log('⚠️ 只做**子集关系**：不判"先催哪个对不对"（那是判断，不该写死）。');
    process.exit(o.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--durations')) {
    const d = durationProblems(markdown);
    if (d.length === 0) console.log('✅ "多久"表每一行要么给了时间、要么明说"没查到"。');
    else { console.log(`🔴 ${d.length} 行既没时间、也没说"没查到"：`); for (const x of d) console.log(`   · ${x}`); }
    console.log('⚠️ 只判"有没有说"，**不判时间对不对**。');
    process.exit(d.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--hands-agrees')) {
    const h = handsProblems(markdown);
    if (h.length === 0) console.log('✅ 第一屏里每个挡上线项都有"手往哪放"，且没有多指的。');
    else { console.log(`🔴 ${h.length} 处不一致：`); for (const x of h) console.log(`   · ${x}`); }
    console.log('⚠️ 只比 **id 集合**：不比"手放哪"那句话写得好不好。');
    process.exit(h.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--structure')) {
    const rows = structureCensus(markdown);
    console.log('| 节 | 小节数 | 抬头有导航表 |');
    console.log('|---|---|---|');
    for (const r of rows) console.log(`| **${r.top}** ${r.title} | ${r.subs} | ${r.headTable ? '✅' : '—'} |`);
    console.log('');
    console.log('⚠️ 只报机械事实（小节数 / 有没有表），**不判"该不该有导航"** —— 那是人的决定。');
    process.exit(0);
  }

  if (process.argv.includes('--id-order')) {
    const io = idOrderProblems(markdown);
    if (io.length === 0) console.log('✅ id 不重复、递增，且每个缺号都已声明。');
    else { console.log(`🔴 ${io.length} 处 id 问题：`); for (const x of io) console.log(`   · ${x}`); }
    console.log('⚠️ 缺号的"声名"用「缺号：B59」这种写法（本节之外任意位置都算）。');
    process.exit(io.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--heading-counts')) {
    const hc = headingCountProblems(markdown);
    if (hc.length === 0) console.log('✅ 抬头里写的 N，都等于它那一节的表格数据行数（或已在白名单里）。');
    else {
      console.log(`🔴 ${hc.length} 处抬头与本节表格行数不符：`);
      for (const h of hc) console.log(`   :${h.line} ${h.head} —— 说 ${h.said}、实际 ${h.rows} 行`);
    }
    console.log('⚠️ 只查 `**N 行/格/件/个**` 这一种形状；修辞性的数字不查（见白名单）。');
    process.exit(hc.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--modes-agrees')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const r = modesAgreeProblems(markdown, src);
    // 反方向：§9.1 里的 flag 是否都还在某个工具里
    const srcs = [];
    for (const dir of ['research/tools', 'scripts']) {
      for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.mjs'))) {
        try { srcs.push(readFileSync(join(ROOT, dir, f), 'utf8')); } catch { /* 读不到就跳过 */ }
      }
    }
    const dead = deadFlagProblems(markdown, srcs);
    if (r.missing.length === 0) {
      console.log(`✅ 工具的 ${r.toolFlags.length} 个模式**全部**在 §9.1 里出现过。`);
    } else {
      console.log(`🔴 §9.1 **漏了 ${r.missing.length} 个模式**：${r.missing.join(' · ')}`);
    }
    if (dead.length === 0) console.log('✅ 反过来也成立：§9.1 里的每个 flag 都还在某个工具里。');
    else console.log(`🔴 §9.1 里有 **${dead.length}** 个 flag **已经不在任何工具里**：${dead.join(' · ')}`);
    console.log('⚠️ 现在是**双向**：工具的都在表里 · 表里的都还在某个工具里（扫 `research/tools/*.mjs` 与 `scripts/*.mjs`）。');
    process.exit(r.missing.length === 0 && dead.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--top-agrees')) {
    const ta = topAgreementProblems(markdown);
    const bad = ta.onlyTop.length + ta.onlyBucket.length;
    console.log(`30 秒版：${ta.top.length} 个 id；§9.9 挡上线：${ta.bucket.length} 个。`);
    if (ta.onlyTop.length > 0) console.log(`🔴 **只在第一屏、不在 §9.9**：${ta.onlyTop.join(' · ')}`);
    if (ta.onlyBucket.length > 0) console.log(`🔴 **只在 §9.9、不在第一屏**：${ta.onlyBucket.join(' · ')}`);
    if (bad === 0) console.log('✅ 两处**同一组**。');
    console.log('⚠️ 它只比**集合**，不比顺序、也不比每行的说明。');
    process.exit(bad === 0 ? 0 : 1);
  }

  if (process.argv.includes('--triage')) {
    const t = triageProblems(markdown);
    const bad = t.missing.length + t.duplicated.length + t.stale.length;
    console.log(`仍红的行 **${t.redOnly.length}** 条；§9.9 分档：${new Set([...t.buckets.values()].map((v) => v[0])).size} 档、共 ${t.buckets.size} 条。`);
    if (t.missing.length > 0) console.log(`🔴 **没分档**：${t.missing.join(' · ')}`);
    if (t.duplicated.length > 0) console.log(`🔴 **落在两档**：${t.duplicated.join(' · ')}`);
    if (t.stale.length > 0) console.log(`🔴 **分档里有、但它已经不再红**：${t.stale.join(' · ')}（档表过时了）`);
    if (t.conflicts.length > 0) {
      console.log(`🔴 **"挡上线"档里这 ${t.conflicts.length} 行的正文自己说"不急"**：${t.conflicts.join(' · ')}`);
      console.log('   ⇒ 二选一：**改档**，或**说明为什么它仍然挡**。');
    }
    if (bad === 0 && t.conflicts.length === 0) console.log('✅ 每一行"仍红"都**恰好**落在一档里，且**档与正文不打架**。');
    console.log('⚠️ 它只查"分没分档"与"档与正文是否打架"，**不判分得对不对** —— 那要看每行自己的文字。');
    process.exit(bad + t.conflicts.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--distribution')) {
    const d = distributionStats(markdown);
    console.log('| 节 | 共几行 | 🔴 **至今仍红** | 🟠 **已复核仍未通** | 🔴+✅ 曾红已修 | ✅ 已闭合 | 无标记 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const [k, v] of Object.entries(d.stat)) {
      console.log(`| **${k}** | ${v.total} | **${v.redOnly}** | **${v.orange}** | ${v.redFixed} | ${v.ok} | **${v.unmarked}** |`);
    }
    console.log('');
    if (d.badUnmarked.length === 0) {
      console.log(`✅ 无标记的行只有 ${d.allowed.join(' / ')}（归并指针 / 已撤回 —— **本来就该无标记**）。`);
    } else {
      console.log(`🔴 这 ${d.badUnmarked.length} 行没有红/绿标记，而它们**不是**归并或撤回：`);
      console.log(`   ${d.badUnmarked.join(' · ')}`);
      console.log('   ⇒ 读者读这些行时**不知道它是什么状态**。');
    }
    console.log('⚠️ 只数**标题格**里的标记；正文里的 🔴 不算这一行的状态。');
    process.exit(d.badUnmarked.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--unrunnable')) {
    const ur = unrunnableRows(markdown);
    console.log(`**${ur.length}** 条现在**不能靠跑命令更新**（分"外部"与"人工"两档）：`);
    console.log('');
    for (const r of ur) console.log(`· \`${r.id}\`【${r.cls}】${r.head}`);
    console.log('');
  // ③ **自洽**：§0.2 那四件必须都出现在上面的名单里（否则"我闭合不了的"与"不能自动更新的"两套说法打架）
  // ③ **自洽（只比那四件）**：§0.2 的「①②③④」四条必须都在名单里 ——
  //    ⚠️ **不能拿 §0.2 全文的 id 来比**：它还列着「这一页**还能继续推**的」，那些**本来就该是可跑的**。
  //    第一版拿全文比 ⇒ 误报 12 个（A1/A2/A3/B66/…）。
  const sec02 = markdown.slice(markdown.indexOf('### 0.2'), markdown.indexOf('## 1.'));
  const four = [...sec02.matchAll(/^\*\*[①②③④][^\n]*/gm)].join('\n');
  const want = new Set([...String(four).matchAll(/`([AB]\d+)`/g)].map((m) => m[1]));
  const have = new Set(ur.map((r) => r.id));
  const missing = [...want].filter((id) => !have.has(id));
  if (missing.length > 0) {
    console.log('');
    console.log(`🔴 **§0.2 里有 ${missing.length} 个 id 不在上面的名单里**：${missing.join(' · ')}`);
    console.log('   ⇒ "我闭合不了的"与"不能自动更新的"两套说法打架 —— 要么改 §0.2，要么改那一行的分类。');
  } else {
    console.log('');
    console.log('✅ §0.2 引的每个 id 都在名单里（两套说法一致）。');
  }

  // ④ **§9.10 的"该找谁"必须是名单的子集**（2026-10-17 加）：
  //    §9.10 写的是"只能等人"的那几行 —— 而"只能等人"= 本模式列出的那些。
  //    ⇒ 若 §9.10 提到一个**不在名单里**的 id，说明它要么能自动更新（那就不该在 §9.10），
  //      要么这个 id 根本不存在（写错了）。
  const s910 = markdown.indexOf('### 9.10');
  if (s910 !== -1) {
    const askIds = new Set();
    for (const m of markdown.slice(s910).matchAll(/^\| \*\*`([AB]\d+)`\*\* \|/gm)) askIds.add(m[1]);
    const have = new Set(ur.map((r) => r.id));
    const stray = [...askIds].filter((id) => !have.has(id));
    if (stray.length > 0) {
      console.log('');
      console.log(`🔴 **§9.10 提到的这 ${stray.length} 个 id 不在名单里**：${stray.join(' · ')}`);
      console.log('   ⇒ 要么它是"能自动更新"的（那就不该在 §9.10），要么 id 写错了。');
    } else {
      console.log('');
      console.log(`✅ §9.10 的 ${askIds.size} 个 id 全在名单里（子集关系成立）。`);
    }
  }

    console.log('⚠️ 本模式**只列名单**，**不猜"等谁"** —— 那在每行自己的文字里（§0.2 只覆盖其中四道闸门）。');
    process.exit(0);
  }

  if (process.argv.includes('--stale')) {
    const today = new Date().toISOString().slice(0, 10);
    const st2 = staleProblems(markdown, today);
    if (st2.length === 0) {
      console.log('⚠️ 没找到任何"复跑日"印记 —— 那意味着**这一页没说它什么时候跑过**。');
      process.exit(0);
    }
    console.log(`（今天是 ${today}）`);
    for (const r of st2) {
      console.log(`${r.stale ? '🔴' : '✅'} ${r.what}：${r.date}（**${r.age} 天前**）—— :${r.line}`);
    }
    console.log('⚠️ 尺子是这个：**只报"多久没跑"，不判"该不该重跑"**（阈值 7 天是约定）。');
    process.exit(st2.some((r) => r.stale) ? 1 : 0);
  }

  if (process.argv.includes('--scope-counts')) {
    const sc = scopeCountProblems(markdown);
    if (sc.length === 0) {
      console.log('✅ §0/§0.2 里那几处计数与它们引的表一致。');
    } else {
      console.log(`🔴 ${sc.length} 处计数与表对不上：`);
      for (const p2 of sc) console.log(`   ${p2.where} —— 说 ${p2.said}、实际 ${p2.actual}`);
    }
    console.log('⚠️ 只查**两处**（§7.9 的行数 / §0.2 的条数），**不查历史引用里的数字**（那些引的是旧话）。');
    process.exit(sc.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--table-cells')) {
    const tc = tableCellProblems(markdown);
    if (tc.length === 0) {
      console.log('✅ 每张表的数据行与它的分隔行列数一致。');
    } else {
      console.log(`🔴 ${tc.length} 行的列数与所在表的分隔行不一致（多出的格会被渲染器丢掉）：`);
      for (const t of tc) console.log(`   :${t.line} 应为 ${t.want} 列、实为 ${t.got} 列`);
    }
    console.log('⚠️ 以**分隔行**为准；`\\|` 是合法转义、已遮掉再数。');
    process.exit(tc.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--path-coverage')) {
    const pc = pathCoverageProblems(markdown);
    const nav = sectionNavProblems(markdown);
    if (nav.length > 0) {
      console.log(`🔴 §7 有 ${nav.length} 个小节没有被抬头导航提到：`);
      for (const s2 of nav) console.log(`   §${s2}`);
    }
    if (pc.length === 0 && nav.length === 0) {
      console.log('✅ 两层都过：§7.1/§7.2 的每条决定都在 §7.6/§7.7 的路径里，且 §7 的每个小节都在抬头导航里。');
    } else if (pc.length > 0) {
      console.log(`🔴 ${pc.length} 条决定没有被"最短路径"覆盖：`);
      for (const id of pc) console.log(`   ${id}`);
    }
    console.log('⚠️ 只比"编号有没有出现"，不判它排得对不对、也不判依赖是否成立。');
    process.exit(pc.length === 0 && nav.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--bullet-structure')) {
    const bs = bulletStructureProblems(markdown);
    if (bs.length === 0) {
      console.log('✅ 列表项的续行全部缩进（没有被劈开的 bullet）。');
    } else {
      console.log(`🔴 ${bs.length} 处列表续行没有缩进（很可能是被劈开的 bullet）：`);
      for (const b of bs) console.log(`   :${b.line}（所属 bullet :${b.owner}）  ${b.text}`);
    }
    console.log(
      '⚠️ Markdown 允许"懒续行"，所以这判的是**本仓约定**（`- ` 之后一律缩进），不是语法错误。',
    );
    process.exit(bs.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--gate-mentions')) {
    const scripts2 = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
    const miss = gateMentionProblems(markdown, scripts2);
    if (miss.length === 0) {
      console.log('✅ `package.json` 里跑的每一道 `check:*` / `verify:*`，对账件都提到了（npm 名或文件名）。');
    } else {
      console.log('🔴 ' + miss.length + ' 道门禁在 package.json 里跑、但对账件里**一次都没提到**：');
      for (const m2 of miss) console.log(`   ${m2.npm}  （${m2.base}）`);
    }
    console.log(
      '⚠️ 它只查"**提没提到**"，不查"**提得对不对**"。⚠️ npm 名与文件名**任一命中即算** —— ' +
        '第一版只按一种搜，把两道门禁报成了"没提到"（见函数头的注释）。',
    );
    // ⚠️ **不退出非零**：对账件**本来只收上线阻断项**，不是门禁清单 ⇒ "没提到"多半是**正常**的。
    //    这里列出来只是**探照灯**：唯一该警惕的是"**我新建的却不在里面**"（B48/B49 那族）。
    console.log(
      '📌 **这不是缺陷清单**：对账件只收**上线阻断项**，所以上面那些"没提到"多半正常。' +
        '真正该警惕的是"**我新建的、却不在里面**"—— 那说明**别人不知道它存在**。',
    );
    process.exit(0);
  }

  if (process.argv.includes('--decision-cost')) {
    const rows3 = decisionCostProblems(markdown);
    const owner3 = ownerActionProblems(markdown);
    if (owner3.length > 0) {
      console.log(`🔴 §7.3 有 ${owner3.length} 处缺口：`);
      for (const p3 of owner3) console.log(`   第 ${p3.n} 项 —— ${p3.why}`);
    }
    if (rows3.length === 0) {
      console.log('✅ §7.1/§7.2 每一条决定的"选项"栏里都有体量或前提的痕迹。');
    } else {
      console.log(`🔴 ${rows3.length} 条决定的"选项"栏里找不到体量/前提：`);
      for (const r of rows3) console.log(`   ${r.id}  —— ${r.options}`);
    }
    console.log(
      '⚠️ 词表是**启发式**：它只保证"**没有默默无闻的体量**"，不保证体量**说得对**。' +
        '⚠️ 词表自己栽过（第一版漏了「秒」⇒ B13 的「实测 +141 秒」被判成没体量）。',
    );
    process.exit(rows3.length === 0 && owner3.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--causal')) {
    const rows2 = causalProblems(markdown);
    if (rows2.length === 0) {
      console.log('✅ §7.5–§7.7 里每一条"因果/分组"要么有出处、要么写明了 🟡【推断】。');
    } else {
      console.log(`🔴 ${rows2.length} 条"因果/分组"既没有出处、也没标明是推断：`);
      for (const r of rows2) console.log(`   :${r.line}  ${r.text}`);
    }
    console.log(
      '⚠️ 出处的判定刻意**宽**（链接 / 反引号里的文件或命令 / ADR 号 / 行号 / 小节号都算）。' +
        '本判据只保证"**没有默默无闻的因果**"，不保证出处**说得对**。',
    );
    process.exit(rows2.length === 0 ? 0 : 1);
  }

  if (process.argv.includes('--zero-claims')) {
    const allLines = markdown.split('\n');
    // 🔴 **排除自检章节（§8/§9）**：那两节**本身就在讨论"零命中"**（例如 §8.7 与 §9.3），
    //    把它们算进来会让计数**自指膨胀**（实测：14 → 21 → 24，一路上涨而实际情况没变）。
    //    ⇒ 这个数字只有"**对账件的断言**"才该计入。
    // 🔴 **围栏代码块里的内容要跳过**：那里是**引用命令输出**（例如 §4.3 引 `check:reachability`
    //    的报错原文），不是对账件自己的断言。第一版把它算进来 ⇒ 多出一行假报
    //    （实测：`:281` 那行就是引用的门禁输出）。
    let inFence = false;
    const allLines2 = allLines.map((l) => {
      if (l.trimStart().startsWith('```')) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : l;
    });
    const metaStart = allLines2.findIndex((l) => l.startsWith('## 8.'));
    const lines = metaStart === -1 ? allLines2 : allLines2.map((l, i) => (i < metaStart ? l : ''));
    let total = 0;
    let noProbe = 0;
    console.log('| 位置 | 零命中说法 | 写明探针了？ | 那一行 |');
    console.log('|---|---|---|---|');
    for (const [i, line] of lines.entries()) {
      // 🔴 **标明是"引用旧话/已撤回"的行不算断言**：例如 §4.2 那条更正里写的是
      //    「本行上方那张表**原写**「…零消费者」」 —— 它**引**的是已被撤回的那句，
      //    不是在主张什么。第一版把它算进来 ⇒ 多一行假报。
      if (/原写|原文|已撤回|撤回】/.test(line)) continue;
      const hits = zeroClaims(line);
      if (hits.length === 0) continue;
      total += 1;
      const probe = statesProbe(line);
      if (!probe) noProbe += 1;
      const head = line.replace(/^\|\s*\*\*([^|]+)\*\*[^|]*\|\s*/, '$1：').slice(0, 60);
      console.log(`| :${i + 1} | ${[...new Set(hits)].join(' / ')} | ${probe ? '✅' : '🔴 没有'} | ${head}… |`);
    }
    console.log('');
    console.log(`共 **${total}** 行含"零命中"类说法；其中 **${noProbe}** 行**没写明探针**。`);
    console.log(
      '🔴 "没命中"**不能**直接读成"不存在"：本会话**三次**栽在这里 —— `managed/chat`（URL 是**函数拼的**）、' +
        '`share-api-client`（用法是 import **类名**）、`AiSupplyMode`（用法是**经 `routing.ts` 类型再导出**）。' +
        '⇒ 每一行都该写明**grep 的是什么名字**，好让人复核。',
    );
    console.log(
      '⚠️ **这个计数会自指膨胀**：对账件里一旦写进"我们修了哪些零命中断言"（比如 §8.7 与 B24），' +
        '那些行**自己**也含"零命中"字样 ⇒ 计数会跟着涨。⇒ **别把两次运行的数字直接相减**，' +
        '要看的是"**没写明探针**"那一栏里**新出现的行**。',
    );
    return;
  }

  if (process.argv.includes('--decisions')) {
    const decisions = parseDecisions(markdown);
    if (decisions.length === 0) {
      console.error('🔴 一条决定都没解析到 —— §7 换了形状，这个模式正在空转。');
      process.exit(1);
    }
    const problems = decisionProblems(decisions);
    for (const row of decisions) {
      const w = (t) => String(t.replace(/[*\s]/g, '').length).padStart(3);
      console.log(`  ${row.id.padEnd(7)} 选项 ${w(row.options)} 字 · 后果 ${w(row.consequence)} 字`);
    }
    console.log('');
    if (problems.length > 0) {
      console.error(`🔴 ${problems.length} 条决定的表格内容不实：`);
      for (const p of problems) console.error(`   · ${p}`);
      process.exit(1);
    }
    console.log(`✅ ${decisions.length} 条决定都写了"选项"与"不决定的后果"。`);
    return;
  }

  const rows = parseRows(markdown);
  if (rows.length === 0) {
    console.error('🔴 一条都没解析到 —— 对账件换了形状，本工具正在变成空转。');
    process.exit(1);
  }
  const classified = rows.map((row) => ({ ...row, kind: classify(row.text) }));
  const brief = process.argv.includes('--brief');
  const counts = { 判据: 0, 外部: 0, 人工: 0, 归并: 0, 散文: 0 };
  for (const row of classified) counts[row.kind] += 1;

  if (!brief) {
    console.log('| 条 | 类 | 那一行的开头 |');
    console.log('|---|---|---|');
    for (const row of classified) {
      const head = row.text.replace(/^\| \*\*[AB]\d+\*\*[^|]*\|\s*/, '').slice(0, 54);
      console.log(`| **${row.id}** | ${row.kind} | ${head}… |`);
    }
    console.log('');
  }

  const independent = rows.length - counts['归并'];
  console.log(
    `共 ${rows.length} 条（其中 **归并/撤回 ${counts['归并']}** 条不是独立断言，不算进分母）` +
      `⇒ 独立 ${independent} 条：**判据 ${counts['判据']}** · **外部 ${counts['外部']}** · ` +
      `**人工 ${counts['人工']}** · **散文 ${counts['散文']}**`,
  );
  const prose = classified.filter((row) => row.kind === '散文');
  if (prose.length > 0) {
    console.log('\n⚠️ "散文"那一档（只有读数、没有可跑出口）：');
    for (const row of prose) console.log(`   · **${row.id}**`);
    console.log(
      '   ⇒ 逐条问一句：**它今天的证据是什么、明天谁还能复跑？** 要么给它一个命令，' +
        '要么在行里写明它为什么不可能有（那是"外部"那一档）。',
    );
  }
}

if (process.argv[1]?.endsWith('blocker-evidence-audit.mjs')) main();
