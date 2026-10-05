#!/usr/bin/env node
/**
 * 详情面合流里**六步纯机械处置**的执行器（工单 §8.47 第 3a / 3b / 第 4 步、§8.108 的 #34 那一行，
 * 以及 §8.117 把原来"要人"的 §3c / §3f 两枚转成的第 6 / 第 7 步）。
 *
 * 为什么要有它：那几步的"规则"已经写在工单里并被 14:0x 那一趟执行验真过（§8.50 / §8.52），
 * 但规则是散文 —— 合流那一刻要靠人重新读散文再手工改文件，而改动本身是可判定的
 * （marker 归零、语法过、用例数对得上）。这里把"判定"和"改法"绑在一个脚本里，
 * **前提不成立就拒绝改**，而不是替人猜。
 *
 * 跑法：
 *   node scripts/resolve-detail-pane-merge-mechanical.mjs                  # 只报会怎么改（零写盘）
 *   node scripts/resolve-detail-pane-merge-mechanical.mjs --apply          # 改在它自己铺的临时产物上（仍不碰分支）
 *   node scripts/resolve-detail-pane-merge-mechanical.mjs --product <dir> --apply
 *         # 改在 §8.52 那趟 `--keep` 留下的载体上（人已经手工处置过别的文件时用它）
 *
 * 🔴 三条硬边界：
 *  ① 它**只**动点名的那六处，且每处都有"形状前提"（单 hunk、两侧只追加、
 *     未登记行全部落在 §8.36 预审过的名单里、CSS 两侧逐条比过只有拍下那几个键）。
 *     前提一变就整枚跳过并报错 —— 不是"降级处理"。
 *  ② 它**不碰任何分支、不做 merge、不 commit**。改的是 `git archive` 铺出来的临时目录。
 *  ③ 第 6 / 第 7 步改的是**产品形态**（页头许不许被压窄、同一格里 AI 面与专注概览怎么共处）。
 *     那两条 2026-10-05 起已由本线按下来的拍板驱动（工单 §8.117 写了裁决、代价与可推翻方式）——
 *     所以这一枚**不是"脚本自己决定"**：裁决变了要回来改这里那几个 EXPECT 常量，
 *     脚本会在取值漂移时拒绝，而不是跟着新形状走。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const apply = process.argv.includes('--apply');
const productArg = process.argv.includes('--product') ? process.argv[process.argv.indexOf('--product') + 1] : '';

const IMPSRC = 'packages/app-host/src/habit-actions.ts';
const SPECSRC = 'packages/app-host/tests/habit-actions.spec.ts';
const GATE = 'scripts/check-selection-single-source.mjs';
const CSSSRC = 'apps/web/src/styles/app/main-area.css';
const APPSRC = 'apps/web/src/App.tsx';
/** §8.36 / §8.47 第 4 步**预审过**的豁免（"先跑、红了才加"里那句"红了"的白名单）。 */
const PREAUDITED = [
  ['apps/web/src/features/trash/TrashView.tsx', 'busyId', 'in-flight'],
  ['apps/mobile/src/screens/TrashScreen.tsx', 'busyId', 'in-flight'],
];
/** main 侧块顶部那行叙述残留（不是 marker）。🔴 实测它的字面形状是 `// ── 追加到 <路径> ───…`，
 *  带着注释符 —— 按"行首就是 `──`"去匹配会得到 0 命中，于是这行**悄悄留在产物里**（第一版就踩了）。
 *  所以删用它（两种形状都认），事后核验用一个**更宽**的串：删的范围窄、查的范围宽，才挡得住匹配器写窄。 */
const RESIDUE_REMOVE = /^\s*(?:\/\/\s*)?──\s*追加到\s/;
const RESIDUE_PROBE = /──\s*追加到\s/;

let ts = null;
for (const c of [
  join(ROOT, 'node_modules/typescript'),
  join(ROOT, 'apps/web/node_modules/typescript'),
  join(ROOT, 'packages/app-host/node_modules/typescript'),
]) {
  if (!existsSync(c)) continue;
  try {
    ts = createRequire(join(ROOT, 'package.json'))(c);
    break;
  } catch {
    /* 换下一个候选 */
  }
}
if (!ts) {
  console.error('🔴 这一侧拿不到 typescript —— 语法判据跑不了，本脚本拒绝改动（没跑成的检查不算通过）。');
  process.exit(2);
}
const parseErrors = (text, file) => {
  const out = ts.transpileModule(text, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  return (out.diagnostics || [])
    .filter((d) => d && d.messageText)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
};

/** 剥掉注释与字符串，返回同长度的"只剩代码"文本（下标对齐，便于按块算括号）。 */
const codeOnly = (s) => {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const two = s.slice(i, i + 2);
    if (two === '//') {
      const nl = s.indexOf('\n', i);
      const end = nl === -1 ? s.length : nl;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (two === '/*') {
      const close = s.indexOf('*/', i + 2);
      const end = close === -1 ? s.length : close + 2;
      out += s.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '\\') {
          j += 2;
          continue;
        }
        if (s[j] === c) break;
        j += 1;
      }
      out += ' '.repeat(Math.min(j + 1, s.length) - i);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
};
const braceDelta = (text) => {
  const code = codeOnly(text);
  let d = 0;
  for (const ch of code) {
    if (ch === '{') d += 1;
    else if (ch === '}') d -= 1;
  }
  return d;
};
/**
 * ⚠️ 强制带 `g`：`String.match` 在**没有** `g` 时只回第一个匹配，`(match||[]).length` 就永远是 0 或 1 ——
 * 那会把"补几条闭合"的唯一解搜索变成"好几条都算过"，而这一档的判据正是那个唯一解。
 */
const countOf = (text, re) =>
  (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) || []).length;

const RE_DESCRIBE = /^\s*describe\(/gim;
const RE_IT = /^\s*(?:it|test)\(/gim;

/** 把带 marker 的文件解析成 { pre, hunks:[{ours,theirs}], post }；只接受 expectedHunks 枚。 */
function splitHunks(lines, expectedHunks) {
  const hunks = [];
  const pre = [];
  let cur = null;
  let mode = 'pre';
  const post = [];
  for (const l of lines) {
    if (/^<{7}\s/.test(l)) {
      if (mode !== 'pre' && mode !== 'post') return null;
      mode = 'ours';
      cur = { ours: [], theirs: [] };
      continue;
    }
    if (/^={7}$/.test(l)) {
      if (mode !== 'ours') return null;
      mode = 'theirs';
      continue;
    }
    if (/^>{7}\s/.test(l)) {
      if (mode !== 'theirs') return null;
      mode = 'post';
      hunks.push(cur);
      cur = null;
      continue;
    }
    if (mode === 'pre') pre.push(l);
    else if (mode === 'post') post.push(l);
    else cur[mode].push(l);
  }
  if (mode !== 'post') return null;
  if (hunks.length !== expectedHunks) return null;
  return { pre, hunks, post };
}

// —— 载体
let tree = '';
try {
  tree = git(['merge-tree', '--write-tree', '--name-only', 'main', 'HEAD']).split('\n')[0].trim();
} catch (e) {
  tree = String(e.stdout || '').split('\n')[0].trim();
}
if (!/^[0-9a-f]{40}$/.test(tree)) {
  console.error('🔴 拿不到候选树 —— 这一趟没有读数。');
  process.exit(2);
}
let product = productArg;
if (!product) {
  product = mkdtempSync(join(tmpdir(), 'dp-resolve-'));
  execFileSync('sh', ['-c', `git archive '${tree}' | tar -x -C '${product}'`], { cwd: ROOT, stdio: 'inherit' });
} else if (!existsSync(join(product, 'scripts'))) {
  console.error(`🔴 --product 指的目录不像一份检出：${product}`);
  process.exit(2);
}

const notes = [];
const failures = [];
const write = (rel, text) => {
  if (apply) writeFileSync(join(product, rel), text);
};
/** 已经没有 marker ⇒ 这一枚被人处置过了。跳过是**正确**读数，不许报成失败。 */
const alreadyResolved = (rel) => {
  const raw = readFileSync(join(product, rel), 'utf8');
  if (/^<{7}\s/m.test(raw)) return false;
  notes.push(`${rel}：产物里已经没有 marker ⇒ 已处置过，这一枚跳过（不重复改）`);
  return true;
};

// —— §3a：import 块取并集
{
  const rel = IMPSRC;
  const p = join(product, rel);
  if (!existsSync(p)) {
    failures.push(`${rel}：产物里没有这个文件`);
  } else {
    const raw = readFileSync(p, 'utf8');
    const parsed = splitHunks(raw.split('\n'), 1);
    if (!parsed) {
      if (alreadyResolved(rel)) {
        /* 已经处置过 —— 跳过，不是失败 */
      } else {
        failures.push(`${rel}：hunk 形状不是"恰好一枚 <<<<<<< / ======= / >>>>>>>" —— 前提变了，本脚本不改它`);
      }
    } else {
      const [{ ours, theirs }] = parsed.hunks;
      const name = (l) => /^\s*([A-Za-z0-9_$]+),?\s*$/.exec(l)?.[1];
      const okShape = [...ours, ...theirs].every((l) => name(l) !== undefined);
      if (!okShape) {
        failures.push(`${rel}：hunk 两侧不只有"标识符 + 逗号"这一种形状 ⇒ 不再是纯 import 并集，交给人`);
      } else {
        const norm = [...ours, ...theirs].map((l) => l.trim());
        const dedup = [...new Set(norm)];
        if (dedup.length !== norm.length) {
          failures.push(`${rel}：两侧有同名导入项 ⇒ 并集不是无损的，交给人`);
        } else {
          const sorted = [...dedup].sort((a, b) => {
            const ka = a.replace(/,/g, '').replace(/^type\s+/, '');
            const kb = b.replace(/,/g, '').replace(/^type\s+/, '');
            return ka.localeCompare(kb);
          });
          const out = [...parsed.pre, ...sorted, ...parsed.post].join('\n');
          const errs = parseErrors(out, rel);
          const stillDup = new Set();
          const seen = new Set();
          for (const l of sorted) {
            const k = l.replace(/,$/, '');
            if (seen.has(k)) stillDup.add(k);
            seen.add(k);
          }
          if (errs.length || stillDup.size) {
            failures.push(`${rel}：并集产物语法不过（${errs[0] || ''}）或仍有重名（${[...stillDup].join('/')}）⇒ 不写盘`);
          } else {
            notes.push(
              `§3a ${rel}：并集 ${ours.length}+${theirs.length} ⇒ ${sorted.length} 行，` +
                `markers=0 语法过 重名=0（新增项 ${[...ours, ...theirs].map((l) => name(l)).join('/')}）`,
            );
            write(rel, out);
          }
        }
      }
    }
  }
}

// —— §3b：spec 两块都留 + 补够闭合 + 删叙述残留行
{
  const rel = SPECSRC;
  const p = join(product, rel);
  if (!existsSync(p)) {
    failures.push(`${rel}：产物里没有这个文件`);
  } else {
    const raw = readFileSync(p, 'utf8');
    const parsed = splitHunks(raw.split('\n'), 1);
    if (!parsed) {
      if (alreadyResolved(rel)) {
        /* 已经处置过 —— 跳过，不是失败 */
      } else {
        failures.push(`${rel}：hunk 形状不是"恰好一枚 <<<<<<< / ======= / >>>>>>>" —— 前提变了，本脚本不改它`);
      }
    } else {
      const [{ ours, theirs }] = parsed.hunks;
      const stripResidue = (arr) => {
        const kept = arr.filter((l) => !RESIDUE_REMOVE.test(l));
        return { kept, removed: arr.length - kept.length };
      };
      const o = stripResidue(ours);
      const t = stripResidue(theirs);
      const describes = (arr) => countOf(arr.join('\n'), RE_DESCRIBE);
      const its = (arr) => countOf(arr.join('\n'), RE_IT);
      // 🔴 期望值必须含**冲突块之外**的那部分（pre + post）—— 这一枚文件的 hunk 之外本来就有
      //    describe / it。把"两侧之和"整个文件的数去比，第一次跑就得到一个假红
      //    （实测：`describe 10≠2 / 用例 48≠16` —— 差的正是 hunk 之外那 6 个 describe 与 32 条用例）。
      const outside = [...parsed.pre, ...parsed.post];
      const wantDescribe = describes(outside) + describes(o.kept) + describes(t.kept);
      const wantIt = its(outside) + its(o.kept) + its(t.kept);
      const oursDelta = braceDelta(o.kept.join('\n'));
      const theirsDelta = braceDelta(t.kept.join('\n'));
      if (parsed.post.length === 0) {
        failures.push(`${rel}：hunk 之后没有共享尾部 ⇒ 补闭合的推理前提不成立`);
      } else {
        const closersFor = (n) => Array.from({ length: n }, () => '});');
        const candidates = [];
        for (let n = 0; n <= Math.max(4, oursDelta); n += 1) {
          const body = [...parsed.pre, ...o.kept, ...closersFor(n), ...t.kept, ...parsed.post].join('\n');
          if (parseErrors(body, rel).length === 0) candidates.push(n);
        }
        if (candidates.length !== 1) {
          failures.push(
            `${rel}：能过语法解析的补闭合条数不是唯一解（候选 ${JSON.stringify(candidates)}）⇒ 不猜，交给人`,
          );
        } else {
          const n = candidates[0];
          const body = [...parsed.pre, ...o.kept, ...closersFor(n), ...t.kept, ...parsed.post].join('\n');
          const dGot = countOf(body, RE_DESCRIBE);
          const iGot = countOf(body, RE_IT);
          const titles = [...body.matchAll(/^\s*(?:it|test)\(\s*'([^']+)'/gm)].map((m) => m[1]);
          const dupTitles = titles.filter((x, k) => titles.indexOf(x) !== k);
          const residueLeft = body.split('\n').filter((l) => RESIDUE_PROBE.test(l)).length;
          if (dGot !== wantDescribe || iGot !== wantIt) {
            failures.push(
              `${rel}：拼接后 describe ${dGot}≠${wantDescribe} 或用例 ${iGot}≠${wantIt} ⇒ 有一侧被吞，不写盘`,
            );
          } else if (dupTitles.length || residueLeft) {
            failures.push(
              `${rel}：还有重名用例（${dupTitles.slice(0, 3).join('/')}）或叙述残留 ${residueLeft} 行 ⇒ 不写盘`,
            );
          } else {
            notes.push(
              `§3b ${rel}：补 ${n} 条 \`});\`（ours 括号差 ${oursDelta} / theirs ${theirsDelta}），` +
                `删叙述残留 ${o.removed + t.removed} 行 ⇒ describe ${dGot} / 用例 ${iGot} / 重名 0 / markers 0 / 语法 0 诊断`,
            );
            write(rel, body);
          }
        }
      }
    }
  }
}

// —— 第 4 步：先跑门禁，红了且红的全在预审名单里才加豁免
{
  const gatePath = join(product, GATE);
  if (!existsSync(gatePath)) {
    failures.push(`${GATE}：产物里没有这枚门禁`);
  } else {
    let out = '';
    let rc = 0;
    try {
      out = execFileSync('node', [GATE], { cwd: product, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout || ''}${e.stderr || ''}`;
      rc = e.status ?? 1;
    }
    if (rc === 0) {
      notes.push(`第 4 步 ${GATE}：产物上已经**是绿的** ⇒ 按"不该红的时候不许写进去"，本脚本不加任何豁免`);
    } else {
      const unreg = [...out.matchAll(/^\s{2}(\S+)  ([A-Za-z0-9_$]+)$/gm)].map((m) => [m[1], m[2]]);
      const seen = out.includes('断言 G');
      if (!seen || unreg.length === 0) {
        failures.push(
          `${GATE}：红了但不是断言 G 的"未登记 …Id"那一档（rc=${rc}，解析到 ${unreg.length} 行点名）⇒ 不猜，交给人`,
        );
      } else {
        const key = (f, n) => `${f}  ${n}`;
        const map = new Map(PREAUDITED.map((r) => [key(r[0], r[1]), r]));
        const unknown = unreg.filter(([f, n]) => !map.has(key(f, n)));
        if (unknown.length) {
          failures.push(
            `${GATE}：未登记的行里有 ${unknown.length} 枚不在 §8.36 预审名单里（${unknown.map(([f, n]) => `${f}:${n}`).join(' / ')}）⇒ 那是新的语义判断，不自动加`,
          );
        } else {
          // 读的是**产物里那一枚**门禁，不是本检出的那份
          const g = readFileSync(gatePath, 'utf8');
          const m = /const ROW_ID_EXEMPT = \[([\s\S]*?)\n\];/.exec(g);
          if (!m) {
            failures.push(`${GATE}：读不到 ROW_ID_EXEMPT 那段数组 ⇒ 不猜形状，交给人`);
          } else {
            const block = m[1];
            const addLines = unreg
              .map(([f, n]) => map.get(key(f, n)))
              .filter(([, , tag]) => tag)
              .map(([f, n, tag]) => `  ['${f}', '${n}', '${tag}'],`);
            const present = new Set([...block.matchAll(/^\s*\['([^']+)', '([^']+)'/gm)].map((x) => `${x[1]}  ${x[2]}`));
            const fresh = addLines.filter((l) => {
              const mm = /^\s*\['([^']+)', '([^']+)'/.exec(l);
              return !present.has(`${mm[1]}  ${mm[2]}`);
            });
            if (!fresh.length) {
              notes.push(`第 4 步 ${GATE}：名单里那两枚已经在登记表里（红来自别处）⇒ 不重复加`);
            } else {
              const head = g.replace(/const ROW_ID_EXEMPT = \[[\s\S]*?\n\];/, (s) =>
                s.replace(/\n\];$/, '\n' + fresh.join('\n') + '\n];'),
              );
              // 注释里那个"15 处"是计数的抄件（§8.52 第 2.3 条）⇒ 改成不带数的指针。
              // 它改了没改成必须被查到：只加行、留下一个会烂的抄件，等于把这次修复做半。
              const commentWasThere = /逐处归类后的 \d+ 处/.test(head);
              const fixed = head.replace(
                /\/\*\* §8\.28 那一趟逐处归类后的 \d+ 处。([\s\S]*?)\*\//,
                '/** §8.28 那一趟逐处归类后的结果（条数以断言 G 打印的为准，别在这里抄数）。$1*/',
              );
              if (commentWasThere && fixed === head) {
                failures.push(`${GATE}：改了登记表但没改掉注释里那个计数抄件 ⇒ 半途而废，不写盘`);
              } else {
                notes.push(
                  `第 4 步 ${GATE}：产物上确实红了，且点名的 ${unreg.length} 枚全在预审名单里 ⇒ 补 ${fresh.length} 行 ` +
                    `(${fresh.map((l) => l.trim().replace(/,\s*$/, '')).join(' + ')})` +
                    (commentWasThere ? '，并把注释里那个计数抄件改成指针' : '（那行计数注释已经不在了，无需改）'),
                );
                write(GATE, fixed);
              }
            }
          }
        }
      }
    }
  }
}

// —— 第 5 步：断言 I 的"新路由没对选中交代立场"那一档。
// main 侧每多一路由，这一档就会在产物上红一次（本趟是 `countdown`，工单 #34）。
// 它**看起来**像要人判断，但"这一面走哪一档"是可以从代码量出来的（三条取证见 §8.108），
// 所以这里放**预审名单**：点名的面若全在名单内就补登记行，出现名单外的名字一律交给人 ——
// 和 §8.36 那两枚 `busyId` 豁免同一套规矩（"登记的语义"是预审过的，不是脚本临场发明的）。
// ⚠️ 这一段 `because` 文案是**唯一真源**；工单 §8.108 里那段是当时的抄件，只作记录不作依据。
const STANCE_ROSTER = {
  countdown: `  {
    view: 'countdown',
    stance: 'row-actions-only',
    entity: 'event',
    locus: 'apps/web/src/features/countdown/CountdownView.tsx',
    needle: '<CountdownBoard',
    because: '倒数日卡片的每个动作都自带 entityId（onPatch/onArchive/onRemove/onExportCard(entityId, …)），' +
      '而 web 这一侧的调用点只传视图/筛选/分列，整个文件读不到 useSelected/selection.select ⇒ 点一张卡不产生"在看哪一条"。' +
      'EVENT 也不在选中词表（task/habit/note）里，接不进共享 store。',
  },
`,
};

{
  const gatePath = join(product, GATE);
  if (existsSync(gatePath)) {
    let out = '';
    let rc = 0;
    try {
      out = execFileSync('node', [GATE], { cwd: product, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout || ''}${e.stderr || ''}`;
      rc = e.status ?? 1;
    }
    if (rc === 0) {
      notes.push(`第 5 步 ${GATE}：产物上已经**是绿的** ⇒ 不补任何立场登记`);
    } else {
      const m = /其中\s+(\d+)\s+个没对"选中"交代过立场：([^\n]+?)。\s*$/m.exec(out);
      if (!m) {
        notes.push(`第 5 步 ${GATE}：这一趟的红不是断言 I 那一档（或解析不到点名清单）⇒ 本步不动，交给人`);
      } else {
        const stated = Number(m[1]);
        const named = m[2].split(/[,，、]\s*/).filter(Boolean);
        // 分母自检：报出的个数与点名的名字必须对得上，对不上就是解析器错了，不是"少一个没关系"。
        if (named.length !== stated) {
          failures.push(
            `${GATE} 第 5 步：门禁说 ${stated} 个，解析到 ${named.length} 个（${named.join('/')}）⇒ 探针错，不写盘`,
          );
        } else {
          const unknown = named.filter((v) => !Object.hasOwn(STANCE_ROSTER, v));
          if (unknown.length) {
            failures.push(
              `${GATE} 第 5 步：点名的面有 ${unknown.length} 个不在预审名单里（${unknown.join(' / ')}）⇒ 那是新的语义判断，不自动登记`,
            );
          } else {
            const g = readFileSync(gatePath, 'utf8');
            const start = g.indexOf('const VIEW_STANCES = [');
            const end = start < 0 ? -1 : g.indexOf('\n];', start);
            if (end < 0) {
              failures.push(`${GATE} 第 5 步：读不到 VIEW_STANCES 那段数组 ⇒ 不猜形状，交给人`);
            } else {
              const fresh = named.filter((v) => !g.includes(`view: '${v}'`));
              if (!fresh.length) {
                notes.push(`第 5 步 ${GATE}：点名的 ${named.length} 个面已经在登记表里（红来自别处）⇒ 不重复加`);
              } else {
                write(GATE, `${g.slice(0, end + 1)}${fresh.map((v) => STANCE_ROSTER[v]).join('')}${g.slice(end + 1)}`);
                notes.push(
                  `第 5 步 ${GATE}：断言 I 点名的 ${named.length} 个面全在预审名单里 ⇒ 补 ${fresh.length} 行立场登记 ` +
                    `(${fresh.join(' / ')})，插在数组闭合 \`];\` 之前`,
                );
              }
            }
          }
        }
      }
    }
  }
}

// —— 第 6 / 7 步共用：按 marker 走 hunk，返回 [{start,end,ours,theirs}]，枚数不对就 null
const HUNK_RE = /^<{7} main\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} HEAD\n/gm;
const walkHunks = (text, n) => {
  const hunks = [...text.matchAll(HUNK_RE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    ours: m[1],
    theirs: m[2],
  }));
  return hunks.length === n ? hunks : null;
};
const linesOf = (s) => {
  const l = s.split('\n');
  if (l.at(-1) === '') l.pop();
  return l;
};
const applyHunks = (text, hunks, out) => {
  let t = text;
  for (let i = hunks.length - 1; i >= 0; i -= 1) t = t.slice(0, hunks[i].start) + out[i] + t.slice(hunks[i].end);
  return t;
};

// —— 第 6 步（§3c）：`main-area.css` 的两枚 hunk —— 这一枚**曾经是要人的那一枚**
//
// 🔴 拍板已下（2026-10-05，本线自决：产品级决策权 2026-10-03 已由产品负责人交下来，
// 见工单 §8.117）：**页头这一条不许被压窄 —— 折行那一套（HEAD）是形态，main 独有的声明一条不丢**。
// 改法绑在"按声明名→值逐条比"的前提上：任何一侧多出一个没预料到的声明、或那几枚取值被人改过
// ⇒ **整枚拒绝、交回人工** —— 这不是"降级取一侧"。
{
  const DECL_RE = /^\s*([a-z-]+)\s*:\s*([^;]+);\s*$/;
  const fp = join(product, CSSSRC);
  if (!existsSync(fp)) {
    failures.push(`${CSSSRC}：产物里没有这个文件`);
  } else {
    const raw = readFileSync(fp, 'utf8');
    const hunks = walkHunks(raw, 2);
    if (!hunks) {
      if (!/^<{7}\s/m.test(raw)) notes.push(`${CSSSRC}：产物里已经没有 marker ⇒ 已处置过，这一枚跳过`);
      else failures.push(`${CSSSRC}：marker 枚数不是恰好 2，或形状不是标准的 "<<<<<<< main / ======= / >>>>>>> HEAD" —— 前提变了，本脚本不改它`);
    } else {
      const toMap = (lines) => {
        const m = new Map();
        for (const l of lines) {
          const g = DECL_RE.exec(l);
          if (!g) continue;
          if (m.has(g[1])) return null; // 同一侧同名两条 ⇒ 不是"一 property 一行"，比不动
          m.set(g[1], g[2].trim());
        }
        return m;
      };
      let cssBroken = 0;
      const SC = (lines) => {
        const r = splitCss(lines);
        if (!r) {
          cssBroken += 1;
          return { code: lines, comment: [] };
        }
        return r;
      };
      const notesOnly = (lines) => SC(lines).comment;
      /** CSS 注释要按**状态**剥，不能按行首形状猜：这一枚 hunk 里那段注释的续行既不以 `*`
       *  也不以 `/*` 开头（`第一版只在 .ht-header 上加了 wrap ⇒ …`），按行首过滤会把它们
       *  当成代码行 ⇒ 误判"HEAD 有独有行为"。第一趟就是这样拒的。
       *  做法：在拼起来的整段文本上走一遍注释状态机，得到每一行"去掉注释后还剩什么"。 */
      function splitCss(lines) {
        const text = lines.join('\n');
        const kept = [];
        let inC = false;
        let out = '';
        for (let i = 0; i < text.length; i += 1) {
          if (inC) {
            // 🔴 注释里的换行必须**原样留着**，否则整段的行数会塌，后面按行号对齐就全错位
            //（症状：HEAD 侧那张声明表解析出来是**空的**，于是"前提不成立"被误报）。
            if (text[i] === '\n') {
              out += '\n';
              continue;
            }
            if (text[i] === '*' && text[i + 1] === '/') {
              inC = false;
              i += 1;
            }
            continue;
          }
          if (text[i] === '/' && text[i + 1] === '*') {
            inC = true;
            i += 1;
            continue;
          }
          out += text[i];
        }
        const stripped = out.split('\n');
        // 分母自检：剥注释是**等行**操作，行数对不上就是状态机错位 —— 宁可拒绝整枚，
        // 也不要拿一张空表去判"前提不成立"（这正是上一趟的假红形状）。
        if (stripped.length !== lines.length) return null;
        for (let i = 0; i < lines.length; i += 1) {
          const codePart = (stripped[i] ?? '').trim();
          if (codePart === '') {
            if (lines[i].trim() !== '' && lines[i] !== stripped[i]) kept.push('comment');
            else kept.push('blank');
          } else kept.push('code');
        }
        return {
          code: lines.filter((_, i) => kept[i] === 'code'),
          comment: lines.filter((_, i) => kept[i] === 'comment'),
          kept,
        };
      }
      const sameKeys = (m, want) => m.size === want.length && want.every((k) => m.has(k)) && [...m.keys()].every((k) => want.includes(k));
      const o1 = toMap(SC(linesOf(hunks[0].ours)).code);
      const t1 = toMap(SC(linesOf(hunks[0].theirs)).code);
      // 🔴 hunk#2 **不能**按"一张属性表"比 —— 那一枚 hunk 跨了**两条规则**
      // （`.ht-header__actions` 的余下声明 + main 侧一整条新规则 `.ht-header__lang`），
      // 平展成一张表必然出现"同名两条"（第一趟就是这样拒的）。
      // 无损改判成**逐行**：HEAD 那一侧每一条非注释行，必须能在 main 侧原样找到。
      const h2Ours = linesOf(hunks[1].ours);
      const h2TheirsNonComment = SC(linesOf(hunks[1].theirs)).code;
      const h2Missing = h2TheirsNonComment.filter((l) => !h2Ours.includes(l));
      const bad = [];
      if (cssBroken) bad.push(`注释状态机的"等行"自检失败 ${cssBroken} 次（剥完注释行数对不上）⇒ 这张表比不动，交回人工`);
      if (!o1 || !t1) bad.push('hunk#1 某一侧出现同名两条声明（"一 property 一行"的前提不成立）');
      const SHARED = { 'flex-wrap': 'wrap', 'align-items': 'center', 'min-block-size': 'var(--ht-layout-header-height)' };
      const MAIN_ONLY = { 'flex-shrink': '0' };
      const DIFFER = {
        gap: { main: 'var(--ht-space-3)', head: 'var(--ht-space-2) var(--ht-space-3)' },
        padding: { main: 'var(--ht-space-2) var(--ht-space-6)', head: '0 var(--ht-space-6)' },
      };
      if (!bad.length) {
        const want1 = [...Object.keys(SHARED), ...Object.keys(MAIN_ONLY), ...Object.keys(DIFFER)];
        if (!sameKeys(o1, want1)) bad.push(`hunk#1 main 侧的声明集合变了：${[...o1.keys()].join(', ')}`);
        if (!sameKeys(t1, [...Object.keys(SHARED), ...Object.keys(DIFFER)])) bad.push(`hunk#1 HEAD 侧的声明集合变了：${[...t1.keys()].join(', ')}`);
        for (const [k, v] of Object.entries({ ...SHARED, ...MAIN_ONLY })) if (o1.get(k) !== v) bad.push(`hunk#1 main 侧 ${k} 不再是拍下那条：${o1.get(k)}`);
        for (const [k, v] of Object.entries(SHARED)) if (t1.get(k) !== v) bad.push(`hunk#1 HEAD 侧 ${k} 与 main 不一致了 —— 那正是"要不要人"重新成立的地方：${t1.get(k)}`);
        for (const [k, v] of Object.entries(DIFFER)) {
          if (o1.get(k) !== v.main) bad.push(`hunk#1 main 侧 ${k} 的取值不是拍下那条：${o1.get(k)}`);
          if (t1.get(k) !== v.head) bad.push(`hunk#1 HEAD 侧 ${k} 的取值不是拍下那条：${t1.get(k)}`);
        }
      }
      if (!bad.length && h2Missing.length) bad.push(`hunk#2 HEAD 侧有 main 侧原样找不到的行：${h2Missing.map((l) => l.trim()).join(' / ')} ⇒ HEAD 有独有行为，本步不再无损`);
      if (bad.length) {
        failures.push(`${CSSSRC}：${bad.join('；')} ⇒ 整枚交回人工重拍`);
      } else {
        const h1 = [
          ...notesOnly(linesOf(hunks[0].theirs)),
          '  flex-wrap: wrap;',
          '  flex-shrink: 0;',
          '  align-items: center;',
          `  gap: ${t1.get('gap')};`,
          `  min-block-size: ${t1.get('min-block-size')};`,
          `  padding: ${o1.get('padding')};`,
        ];
        const h2 = [...notesOnly(linesOf(hunks[1].theirs)), ...linesOf(hunks[1].ours)];
        // 🔴 按**块**查重复，不按 hunk 数组查：hunk#2 跨两条规则，按数组查会把
        // `.ht-header__actions` 与 `.ht-header__lang` 各自合法的 `display` 读成"同名两条"
        // —— 那是一条会自己咬自己的判据（第一趟就是这样）。
        const dupInBlock = (text) => {
          const hits = [];
          for (const b of text.matchAll(/\{([^{}]*)\}/g)) {
            const seen = new Set();
            for (const l of b[1].split('\n')) {
              const g = /^\s*([a-z-]+)\s*:/.exec(l);
              if (!g) continue;
              if (seen.has(g[1])) hits.push(g[1]);
              seen.add(g[1]);
            }
          }
          return hits;
        };
        const text = applyHunks(raw, hunks, [h1.join('\n') + '\n', h2.join('\n') + '\n']);
        const dup = dupInBlock(text);
        if (dup.length) {
          failures.push(
            `${CSSSRC}：合并后的全文里出现块内同名两条声明 ${[...new Set(dup)].join(', ')} —— ` +
              `那正是 §3c 警告的"叠两套规则、后一条赢、掷硬币"形状，拒绝写盘`,
          );
        } else {
          write(CSSSRC, text);
          notes.push(
            `第 6 步 ${CSSSRC}：hunk#1 按已拍下的裁决合成（HEAD 的折行形态 + HEAD 的 gap + main 独有的 \`flex-shrink: 0\` 与 \`padding\` 取值，` +
              `HEAD 那 ${notesOnly(linesOf(hunks[0].theirs)).length} 行解释注释保留）；` +
              `hunk#2 逐行验过 HEAD 独有项 = 0 ⇒ 取 main 侧 ${h2Ours.length} 行 + HEAD 那 ${notesOnly(linesOf(hunks[1].theirs)).length} 行解释注释`,
          );
        }
      }
    }
  }
}

// —— 第 7 步（§3f）：`App.tsx` 那一格（AI 面 vs 专注概览）—— 同样已从"要人"转成机械
//
// 裁决（工单 §8.117）：**同一格先按视图分派，再按宽窄分派位置**，
// 并把 main 已有的那条窄档规则（中间列那个挂载点）扩成同一形式 —— 于是专注概览在窄档
// 也**退回中间列**，与 AI 面共用一条规则，不另开第三处。
// 🔴 \`ref={detailRef}\` 必须一起搬进合并形状：它是 \`detailHasRoom\` 唯一的测量点，
// 留着 HEAD 那支裸 \`<aside>\` ⇒ \`detailRef.current\` 恒 null ⇒ 布尔恒 false ⇒ AI 面**永远**挂中间列。
{
  const fp = join(product, APPSRC);
  if (!existsSync(fp)) {
    failures.push(`${APPSRC}：产物里没有这个文件`);
  } else {
    const raw = readFileSync(fp, 'utf8');
    const hunks = walkHunks(raw, 1);
    if (!hunks) {
      if (!/^<{7}\s/m.test(raw)) notes.push(`${APPSRC}：产物里已经没有 marker ⇒ 已处置过，这一枚跳过`);
      else failures.push(`${APPSRC}：marker 枚数不是恰好 1 —— 这一枚要人的成分比合并形状多，本脚本不改它`);
    } else {
      const ours = linesOf(hunks[0].ours);
      const theirs = linesOf(hunks[0].theirs);
      const cnt = (arr, s) => arr.filter((l) => l.includes(s)).length;
      const MID = '{detailHasRoom ? null : aiPanels}';
      const bad = [];
      if (cnt(ours, 'ref={detailRef}') !== 1) bad.push(`main 侧 ref={detailRef} 命中 ${cnt(ours, 'ref={detailRef}')}（期望 1）`);
      if (cnt(ours, '{detailHasRoom ? aiPanels : null}') !== 1) bad.push('main 侧那一栏的内容表达式不是 `{detailHasRoom ? aiPanels : null}`');
      if (cnt(theirs, "{contentView === 'focus' ? <FocusDetailPane /> : null}") !== 1) bad.push('HEAD 侧那一栏不是专注面分派那一条');
      if (cnt(theirs, 'ref={detailRef}') !== 0) bad.push('HEAD 侧已经带 ref —— 合并形状的前提变了');
      const closeIdx = theirs.findIndex((l) => l.trim() === '*/}');
      if (closeIdx < 0) bad.push('HEAD 侧那半段注释的收尾 `*/}` 找不到 ⇒ 注释并不过来');
      if (cnt(ours, 'AI 面在那一档') !== 1) bad.push(`main 侧那句窄档注释命中 ${cnt(ours, 'AI 面在那一档')}（期望 1）`);
      if (raw.split(MID).length - 1 !== 1) bad.push(`中间列那个窄档挂载点 \`${MID}\` 全文命中 ${raw.split(MID).length - 1} 次（期望 1）—— 裁决的第二半没有落点`);
      if (bad.length) {
        failures.push(`${APPSRC}：${bad.join('；')} ⇒ 交回人工`);
      } else {
        const merged = [
          '       * 这一格的内容（专注概览 / AI 面）在窄档**退回中间列**，不跟着这一栏一起消失（判据见 `detailHasRoom`）。',
          ...theirs.slice(0, closeIdx),
          '       */}',
          '      <aside',
          '        ref={detailRef}',
          '        className="ht-app__detail"',
          '        data-testid="detail-column"',
          '      >',
          "        {detailHasRoom ? (contentView === 'focus' ? <FocusDetailPane /> : aiPanels) : null}",
        ];
        const step1 = applyHunks(raw, hunks, [merged.join('\n') + '\n']);
        const text = step1.replace(MID, "{detailHasRoom ? null : contentView === 'focus' ? <FocusDetailPane /> : aiPanels}");
        if (text === step1) {
          failures.push(`${APPSRC}：中间列那处替换没生效 ⇒ 不写盘`);
        } else {
          write(APPSRC, text);
          notes.push(
            `第 7 步 ${APPSRC}：按已拍下的裁决合成那一格（ref 搬进合并形状 + 视图分派 + 窄档退中间列同一条规则），` +
              `并把 hunk 外的中间列挂载点 1 处扩成同一分派；两侧注释都留下`,
          );
        }
      }
    }
  }
}

// —— 验真：写完必须回读。"我改了"不是读数，"回读出来 marker 归零、语法过、门禁绿"才是。
// ⚠️ 只数 `<<<<<<<` / `>>>>>>>` 两串：`=======` 会撞上门禁脚本自己写的那条正则（`/^={7}$/`），
//    那是一处假报警，而假报警的代价是别人开始忽略这一栏。
const VERIFY_FILES = [IMPSRC, SPECSRC, GATE, CSSSRC, APPSRC];
const verify = [];
const notJudged = [];
let verifyBad = 0;
let judged = 0;
if (apply) {
  for (const rel of VERIFY_FILES) {
    const p = join(product, rel);
    if (!existsSync(p)) {
      verifyBad += 1;
      verify.push(`🔴 ${rel}：产物里没有这个文件`);
      continue;
    }
    const text = readFileSync(p, 'utf8');
    const markers = countOf(text, /^(?:<{7}|>{7})\s/m);
    // CSS 不交给 TS 解析器（那不是它的语言，报错是必然的、也就没有分辨力）。
    // 它这一档用**花括号配平 + 每个块里同名声明不重复**这两条来当"语法过"的等价判据 ——
    // 后者正是 §3c 警告的"叠两套规则 ⇒ 后一条赢，掷硬币"那个形状。
    let cssDup = 0;
    let errs;
    let ruler;
    // 🔴 每一档的读数都必须带上**用的是哪把尺子**。这一族原来打的是"语法诊断 0 条"，
    //    而 `.mjs` 那一支根本没解析、只是 `errs = []` ⇒ 输出把"没看"打印成了"看了、没事"，
    //    和 CSS/TS 两档的真读数**长得一模一样**（AGENTS §3.2 那条"只打印、不判定"的同一个形状，
    //    也和本线 §8.120 给预检补"未判"档的理由同一条）。它的定性其实来自下面那行真跑 RC，
    //    所以措辞改成点名那把尺子，而不是伪造一个 0。
    if (rel.endsWith('.mjs')) errs = null;
    else if (rel.endsWith('.css')) {
      ruler = '结构判据（花括号配平 + 块内声明不重复）';
      errs = [];
      if (braceDelta(text) !== 0) cssDup += 1;
      for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
        const seen = new Set();
        for (const l of block[1].split('\n')) {
          const g = /^\s*([a-z-]+)\s*:/.exec(l);
          if (!g) continue;
          if (seen.has(g[1])) cssDup += 1;
          seen.add(g[1]);
        }
      }
      if (cssDup) errs = [`花括号/重复声明 计数 ${cssDup}`];
    } else {
      ruler = 'TS 解析器';
      errs = parseErrors(text, rel);
    }
    const unjudged = errs === null;
    if (unjudged) notJudged.push(rel);
    else judged += 1;
    // ⚠️ "未静态解析"再分两档，与预检/合流窗口那两个装置同口径（工单 §8.120）：
    //    GATE 有尺子 —— 就是下面那行对它的真跑 RC；别的东西没有尺子 —— 不记过也不记红。
    const why = rel === GATE ? '由下面那行真跑 RC 定性' : '本档无尺子（不记过、也不记红）';
    const bad = markers > 0 || (!unjudged && errs.length > 0);
    if (bad) verifyBad += 1;
    verify.push(
      `${bad ? '🔴' : unjudged ? '⚪' : '✅'} ${rel}：marker ${markers} 处 / 语法=${
        unjudged ? `未静态解析（${why}）` : `${errs.length} 条（${ruler}）`
      }`,
    );
  }
  if (notJudged.length) {
    verify.push(`  分母：静态判过=${judged} 枚／**未静态解析=${notJudged.length} 枚**（${notJudged.join(', ')}）`);
  }
  let rc = 0;
  let out = '';
  try {
    out = execFileSync('node', [GATE], { cwd: product, encoding: 'utf8' });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    rc = e.status ?? 1;
  }
  if (rc !== 0) verifyBad += 1;
  const tailLine = out.trim().split('\n').filter((l) => l.trim()).pop() || '';
  verify.push(
    `${rc === 0 ? '✅' : '🔴'} ${GATE}：复跑 RC=${rc} ⇒ ${tailLine.slice(0, 72)}`,
  );
}

console.log(`TREE=${tree}  载体=${product}${productArg ? '（--product 指进来的，跑完不删）' : ''}`);
for (const n of notes) console.log(`·  ${n}`);
for (const f of failures) console.log(`🔴 ${f}`);
if (verify.length) {
  console.log('\n回读验真（只在 --apply 下才有，因为要真的写进载体）：');
  for (const v of verify) console.log(`  ${v}`);
}
console.log(
  `\n改法 ${notes.length} 条 / 拒绝 ${failures.length} 条 —— ${apply ? '--apply：已写进临时产物' : '试运行（没写盘；上面每条"改法"在这一趟都是**预测**，不是读数）'}` +
    `；**任何分支都没被改动**`,
);
if (apply) {
  console.log(`下一步（把产物整体验一遍）：node scripts/verify-detail-pane-merge-preflight.mjs --product ${product}`);
} else if (notes.length) {
  console.log('（加 --apply 才会写进临时产物；那一步同样不碰分支）');
}
if (!productArg && !apply) rmSync(product, { recursive: true, force: true });
process.exit(failures.length || verifyBad ? 1 : 0);

