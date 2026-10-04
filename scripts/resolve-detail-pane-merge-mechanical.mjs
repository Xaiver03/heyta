#!/usr/bin/env node
/**
 * 详情面合流里**四步纯机械处置**的执行器（工单 §8.47 第 3a / 3b / 第 4 步，以及 §8.108 的 #34 那一行）。
 *
 * 为什么要有它：那三步的"规则"已经写在工单里并被 14:0x 那一趟执行验真过（§8.50 / §8.52），
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
 *  ① 它**只**动 §3a / §3b / 第 4 步那三处，且每处都有"形状前提"（单 hunk、两侧只追加、
 *     未登记行全部落在 §8.36 预审过的名单里）。前提一变就整枚跳过并报错 —— 不是"降级处理"。
 *  ② 它**不碰任何分支、不做 merge、不 commit**。改的是 `git archive` 铺出来的临时目录。
 *  ③ `main-area.css` 那一枚（第 3c 步）**不在射程里** —— 那是要人拍的（页头许不许被压窄）。
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

// —— 验真：写完必须回读。"我改了"不是读数，"回读出来 marker 归零、语法过、门禁绿"才是。
// ⚠️ 只数 `<<<<<<<` / `>>>>>>>` 两串：`=======` 会撞上门禁脚本自己写的那条正则（`/^={7}$/`），
//    那是一处假报警，而假报警的代价是别人开始忽略这一栏。
const verify = [];
let verifyBad = 0;
if (apply) {
  for (const rel of [IMPSRC, SPECSRC, GATE]) {
    const p = join(product, rel);
    if (!existsSync(p)) {
      verifyBad += 1;
      verify.push(`🔴 ${rel}：产物里没有这个文件`);
      continue;
    }
    const text = readFileSync(p, 'utf8');
    const markers = countOf(text, /^(?:<{7}|>{7})\s/m);
    const errs = rel.endsWith('.mjs') ? [] : parseErrors(text, rel);
    if (markers || errs.length) verifyBad += 1;
    verify.push(`${markers || errs.length ? '🔴' : '✅'} ${rel}：marker ${markers} 处 / 语法诊断 ${errs.length} 条`);
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

