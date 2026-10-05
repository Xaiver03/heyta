#!/usr/bin/env node
// 棘轮的**另一半**：`check:l4` 与 `check:row-single-source` 守的是"实测不许超过基线"，
// 而"不许把基线本身抬高"这一半此前**只有散文在守**（工单 §8.82 做过 A/B：把常数 +1 之后
// 两道门禁都退 0，而且把它们自己那句打印成"已降 1 处"= 一次改进）。
// 这道门禁钉的就是那一半：基线相对**锚点提交**只许 ≤。
//
// 锚点为什么取 `git merge-base main HEAD`，不是 `main`：
// 取 `main` 会惩罚"落后于 main" —— 别的线把基线降了而这条分支还没合，就会被判成"你抬高了"，
// 那是错归因（AGENTS §7 元规则 1 的反面用法：探针拿错了参照，读数就会指控错人）。
// merge-base 是这条分支**出发时**的值，所以：分支内抬高 ⇒ 红；分支减了债 ⇒ 绿；
// 合并之后 merge-base == main，比的正是 main 的当前值，语义仍然对。
//
// 🔴 拿不到锚点（浅克隆 / 没有 main / 产物树里没有 git）一律 **exit 2 响亮失败**，
//    绝不当成"通过"。一条取不到参照就闭嘴的门禁 = 一条永不开的门（工单 §8.82 (B) 那条代价，
//    以及环境陷阱里"静默跳过等于装饰"）。
// 跑法：node scripts/check-ratchet-ceilings.mjs            # 正常
//      HEYTA_RATCHET_REF=<ref> node scripts/check-ratchet-ceilings.mjs   # 换锚点（臂用）
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 🔴 stderr 必须收进管道，不许直通终端：这道门禁的**正常路径**里就有预期失败的 git 探测
// （merge-base 在浅克隆 / 产物树里必然失败，然后被 catch 走退化分支）。让它直通就会在
// 一份"未判、拒绝报绿"的输出上面多印一行 `fatal:`，读的人无法判断那是**故障**还是**分支**。
// 错误原文仍在 catch 到的 error 里，没丢。
const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// 三档用同一条通用规则：找到 label 那一行，取它之后**第一条** `baseline: N`；
// 或找到 `const NAME = N;`。
const SPECS = [
  { name: 'mobile_l4', file: 'scripts/check-l4-no-style.mjs', kind: 'scope-label', key: 'apps/mobile/src/screens（L4 视图）' },
  { name: 'web_l4', file: 'scripts/check-l4-no-style.mjs', kind: 'scope-label', key: 'apps/web/src/features（L4 视图）' },
  { name: 'ht_family', file: 'scripts/check-row-single-source.mjs', kind: 'named-const', key: 'HT_FAMILY_BASELINE' },
];

function parseValue(text, spec) {
  if (spec.kind === 'named-const') {
    const m = new RegExp(`^const ${spec.key}\\s*=\\s*(\\d+)`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  }
  const idx = text.indexOf(`label: '${spec.key}'`);
  if (idx < 0) return null;
  // 🔴 取值范围必须**截在这条 scope 自己的对象里**：那一档的 `baseline` 行被删掉时，
  // "往后找第一条 baseline" 会滑进邻居（或文件后半段随便一个对象）里读出**别人的数字**——
  // 那不是"读不到"，是"读到了错的那一条"，比空值危险：两档恰好换位就会得到一次
  // 看起来很有道理的指控。做法是从 label 往前找到它所在对象的 `{`，再按花括号配平取到闭合处。
  let open = text.lastIndexOf('{', idx);
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;
  const m = /baseline:\s*(\d+)/.exec(text.slice(open, close));
  return m ? Number(m[1]) : null;
}

let anchor = process.env.HEYTA_RATCHET_REF || '';
let anchorHow = anchor ? 'HEYTA_RATCHET_REF' : '';
if (!anchor) {
  let mb = '';
  try {
    mb = git(['merge-base', 'main', 'HEAD']);
    anchorHow = 'merge-base main HEAD';
  } catch {
    try {
      mb = git(['merge-base', 'origin/main', 'HEAD']);
      anchorHow = 'merge-base origin/main HEAD';
    } catch {
      mb = '';
    }
  }
  if (!mb) {
    for (const ref of ['main', 'origin/main']) {
      try {
        git(['rev-parse', '--verify', ref]);
        mb = ref;
        anchorHow = `ref ${ref}（没有共同祖先，退化成"与它的当前值比"）`;
        break;
      } catch {}
    }
  }
  anchor = mb;
}
if (!anchor) {
  console.log('🔴 取不到锚点（没有 main / origin/main，也不是有历史的检出）—— 这一档**未判**，拒绝报绿。');
  console.log('RATCHET_RESULT=NOT_JUDGED');
  process.exit(2);
}
// 🔴 显式给进来的锚点必须先证明它**存在**。否则它会被当成一个字符串一路带到
// `git show <ref>:file`，失败后报成"在锚点里解析不到基线"—— 那是**误导**：
// 真实原因是 ref 不存在（臂就是打这一条，所以文案必须能分辨）。
if (process.env.HEYTA_RATCHET_REF) {
  try {
    git(['rev-parse', '--verify', `${anchor}^{commit}`]);
  } catch {
    console.log(`🔴 HEYTA_RATCHET_REF=${anchor} 解析不到提交 —— 没有可比对象，拒绝报绿。`);
    console.log('RATCHET_RESULT=NOT_JUDGED');
    process.exit(2);
  }
}

const rows = [];
let bad = 0;
let broken = 0;
const cache = new Map();
const fileAt = (rel, ref) => {
  const k = `${ref}|${rel}`;
  if (cache.has(k)) return cache.get(k);
  let v = null;
  try {
    v = ref ? git(['show', `${ref}:${rel}`]) : readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    v = null;
  }
  cache.set(k, v);
  return v;
};

for (const spec of SPECS) {
  const now = fileAt(spec.file, '');
  const was = fileAt(spec.file, anchor);
  if (now === null) {
    console.log(`🔴 ${spec.name}：读不到工作树里的 ${spec.file} ⇒ 探针错，不判`);
    broken += 1;
    continue;
  }
  const vNow = parseValue(now, spec);
  const vWas = was === null ? null : parseValue(was, spec);
  if (vNow === null) {
    console.log(`🔴 ${spec.name}：在 ${spec.file} 里解析不到基线（形状变了）⇒ 探针错，不判`);
    broken += 1;
    continue;
  }
  if (vWas === null) {
    console.log(`🔴 ${spec.name}：在锚点 ${anchor} 的 ${spec.file} 里解析不到基线 ⇒ 没有可比对象，不判`);
    broken += 1;
    continue;
  }
  const raised = vNow > vWas;
  if (raised) bad += 1;
  rows.push({ name: spec.name, vNow, vWas, raised });
  console.log(
    `${raised ? '🔴' : '✅'} ${spec.name.padEnd(11)} 基线 ${String(vNow).padStart(4)} vs 锚点 ${String(vWas).padStart(4)} ` +
      (raised ? `⇒ 调高了 ${vNow - vWas}（§1 闸门第 2 条：不许调高基线）` : vNow < vWas ? `⇒ 降了 ${vWas - vNow}（允许，且应顺手把锚点带下来）` : '⇒ 未动'),
  );
}
console.log(`ANCHOR=${anchor}（${anchorHow}）`);
console.log(`ROWS=${rows.length}/${SPECS.length}`);
if (broken) {
  console.log('RATCHET_RESULT=PROBE_BROKEN');
  process.exit(2);
}
console.log(bad ? 'RATCHET_RESULT=RED' : 'RATCHET_RESULT=OK');
process.exit(bad ? 1 : 0);
