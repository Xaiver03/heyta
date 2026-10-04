/**
 * 载体合并里**文本类**冲突族的通用解法（第十族 `docs/runbooks/deployment.md`、
 * 第十一族 `e2e/live-site/live-domain.spec.ts`），以及它自己的自检臂。
 *
 * ## 为什么单独一个文件
 * 与第九族同理（§8.141）：解法本体要能在**没有 worktree、没有 docker、不碰哨兵那枚热载体**
 * 的条件下被打红。放进 `selfhost-merge-carrier.mjs` 就只能"真跑一次合并"才知道它有没有牙，
 * 而真跑一次会占住载体的"空闲"判据（哨兵 gate 4）。
 *
 * ## 两种形状，两种解法（选错的代价不对称）
 *  - `unionMerge`：**两侧都在同一处纯追加**（base 段为空）。取并集是无损的，而"无损"这件事
 *    可以逐行证明（两侧每一行都必须出现在产出里 + 段数算术相等）。base 段非空 ⇒ 拒
 *    （`refuse`），因为那时"两边都保留"会造出重复声明 —— 那不是保守，是把语法改坏。
 *  - `oursMerge`：**两侧各写了同一件事的两种实现**（base 段非空、同一区段两边都改）。
 *    这里不能并集（真实反例就是第十一族那份 spec），也不许静默取一侧 —— 所以产出取 main 侧，
 *    同时把**本分支侧被丢掉的独有行逐行打进读数**，并跑一条调用方给的结构断言。
 *
 * 🔴 两种解法都**不判断语义孰优**。`ours` 选 main 侧的理由写在调用点的注释里（那一侧带更新一次
 *    的线上实测读数）；丢掉的行由读数交给这条线的所有人自己回补。
 *
 * 用法：node research/tools/selfhost-text-merge.mjs        # 跑自检臂（0 = 全按预期）
 *       其余模块以函数形式 import 它。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });

/** 让 git 自己出 diff3 形状（不自己实现三方合并）。 */
function diff3(oursTxt, baseTxt, theirsTxt) {
  const paths = [['o', oursTxt], ['b', baseTxt], ['t', theirsTxt]].map(([n, t]) => {
    const p = `/tmp/ht-text-merge-${n}`;
    writeFileSync(p, t);
    return p;
  });
  let raw = '';
  try {
    raw = execFileSync('git', ['merge-file', '-p', '--diff3', ...paths], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (err) {
    raw = String(err.stdout ?? '');
  }
  return { raw, gitBlocks: (raw.match(/^<{7}/gm) ?? []).length };
}

/** 把 diff3 文本拆成"块外行"与"块"两种段，顺序保留。 */
function segments(raw) {
  const lines = raw.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('<<<<<<<')) {
      out.push({ kind: 'plain', line: lines[i] });
      continue;
    }
    const blk = { o: [], b: [], t: [] };
    let mode = 'o';
    i += 1;
    for (; i < lines.length; i += 1) {
      const x = lines[i];
      if (x.startsWith('|||||||')) { mode = 'b'; continue; }
      if (x.startsWith('=======')) { mode = 't'; continue; }
      if (x.startsWith('>>>>>>>')) break;
      blk[mode].push(x);
    }
    out.push({ kind: 'block', ...blk });
  }
  return out;
}

/**
 * 无损证明（**块级**，不是文件级）。🔴 文件级"两侧每一行都要在产出里"是错的判据：
 * 块外的增删是 git 三方合并自己的事，一侧删掉的另一侧的行本来就不该出现在产出里
 * —— 那样写会让这条判据在真实落地上恒红（2026-10-05 第一次跑就红在 main 改掉的三行散文上）。
 * 这一族真正要证的是：**每个冲突块里两侧写的行，一行都不能少**，外加段数算术与标记残留。
 */
export function blockLossChecks(mergedLines, blocks) {
  const bad = [];
  const missT = [];
  const missO = [];
  for (const b of blocks) {
    for (const l of b.t) if (!mergedLines.includes(l)) missT.push(l);
    for (const l of b.o) if (!mergedLines.includes(l)) missO.push(l);
  }
  if (missO.length) bad.push(`丢了 main 块内的 ${missO.length} 行（首例：${missO[0].slice(0, 60)}）`);
  if (missT.length) bad.push(`丢了本批块内的 ${missT.length} 行（首例：${missT[0].slice(0, 60)}）`);
  const plain = mergedLines.length - blocks.reduce((n, b) => n + b.o.length + b.t.length, 0);
  if (plain < 0) bad.push(`产出 ${mergedLines.length} 段 < 各块两侧行数之和 ${mergedLines.length - plain} ⇒ 段数算术不成立`);
  if (mergedLines.some((x) => /^(<{7}|>{7}|\|{7})/.test(x))) bad.push('残留冲突标记');
  return bad;
}

/**
 * 两侧都在同一处纯追加 ⇒ 并集。任何一块的 base 段非空就**拒绝**（调用方必须 die，
 * 不许降级成 `oursMerge` —— 那是把"判不了"伪装成"有解法"）。
 */
export function unionMerge(oursTxt, baseTxt, theirsTxt) {
  const { raw, gitBlocks } = diff3(oursTxt, baseTxt, theirsTxt);
  const segs = segments(raw);
  const blocks = segs.filter((s) => s.kind === 'block');
  if (blocks.length !== gitBlocks) {
    return { ok: false, refuse: `解析到 ${blocks.length} 个冲突块，git 报 ${gitBlocks} 个 —— 解析器与 git 不一致，产出不可信` };
  }
  const i = blocks.findIndex((x) => x.b.length !== 0);
  if (i >= 0) {
    return {
      ok: false,
      refuse: `第 ${i + 1} 块的 base 段非空（${blocks[i].b.length} 行）⇒ 同一处被两边改过，并集会造出重复内容，不自动决定：${blocks[i].b.slice(0, 2).join(' / ').slice(0, 160)}`,
    };
  }
  const merged = segs.map((s) => (s.kind === 'plain' ? [s.line] : [...s.o, ...s.t])).flat();
  const bad = blockLossChecks(merged, blocks);
  if (bad.length) return { ok: false, refuse: bad.join(' · ') };
  return { ok: true, text: merged.join('\n'), parsed: blocks.length, refuse: '' };
}

/**
 * 两侧各写了同一件事的两种实现 ⇒ 取 main 侧的块，块外两侧的共同内容原样保留。
 * `shape` 收到产出行数组，返回"不成立的说明"数组（空数组 = 通过）。
 * `dropped` = 本批侧那些**不在 base 里**的行（= 这一发真的丢掉了什么，逐行可查）。
 */
export function oursMerge(oursTxt, baseTxt, theirsTxt, shape = () => []) {
  const { raw, gitBlocks } = diff3(oursTxt, baseTxt, theirsTxt);
  const segs = segments(raw);
  const blocks = segs.filter((s) => s.kind === 'block');
  if (blocks.length !== gitBlocks) {
    return { ok: false, refuse: `解析到 ${blocks.length} 个块，git 报 ${gitBlocks} 个 ⇒ 产出不可信` };
  }
  const merged = segs.map((s) => (s.kind === 'plain' ? [s.line] : s.o)).flat();
  const dropped = blocks.flatMap((x) => {
    const b = new Set(x.b);
    return x.t.filter((l) => !b.has(l));
  });
  const bad = [];
  if (merged.some((x) => /^(<{7}|>{7}|\|{7})/.test(x))) bad.push('残留冲突标记');
  bad.push(...shape(merged));
  if (bad.length) return { ok: false, refuse: bad.join(' · ') };
  return { ok: true, text: merged.join('\n'), dropped, parsed: blocks.length, refuse: '' };
}

/**
 * 结构断言工厂：产出的 needle 命中数必须**等于 main 那一份的命中数**。
 * 🔴 期望值从 main 现量导出，不写死"恰好一枚" —— 写死的数字下一次主线多用一处就是假红，
 *    而它本该拦的是"并集把这行复制成两枚"。
 */
export function sameCountAs(needle, oursTxt) {
  const want = oursTxt.split('\n').filter((l) => l.includes(needle)).length;
  return (merged) => {
    const got = merged.filter((l) => l.includes(needle)).length;
    return got === want ? '' : `「${needle}」命中 ${got} 次 ≠ main 那份的 ${want} 次（并集用在这种形状上就是这个下场）`;
  };
}

/** 给臂与调用方用的只读取块（不判形状）。 */
export function conflictBlocks(oursTxt, baseTxt, theirsTxt) {
  const { raw, gitBlocks } = diff3(oursTxt, baseTxt, theirsTxt);
  const blocks = segments(raw).filter((s) => s.kind === 'block');
  return { blocks, gitBlocks };
}

/* ── 自检臂 ─────────────────────────────────────────────────────────── */
function blobs(mainRef, srcRef, path) {
  const base = git(['merge-base', mainRef, srcRef]).trim();
  return {
    base: git(['show', `${base}:${path}`]),
    ours: git(['show', `${mainRef}:${path}`]),
    theirs: git(['show', `${srcRef}:${path}`]),
  };
}

function runSelftest() {
  const MAIN = process.env.HEYTA_MAIN_REF || 'main';
  const SRC = process.env.HEYTA_SOURCE_REF || 'feat/self-host-distribution';
  const arms = [];
  const push = (id, expect, got) => arms.push({ id, expect, got });

  // 第十族：真实 deployment.md
  const dep = blobs(MAIN, SRC, 'docs/runbooks/deployment.md');
  const u = unionMerge(dep.ours, dep.base, dep.theirs);
  push('U0 真实 deployment.md 走 union ⇒ 成功', true, u.ok === true);
  push('U1 产出同时含两侧各自那段独有的句子', true,
    u.ok && u.text.includes('7b9089b2') && u.text.includes('publish-public-sites.mjs'));
  push('U2 base 段非空时 union 必须拒绝（不许降级成 ours）', false,
    unionMerge('a\nX\nb\n', 'a\nQ\nb\n', 'a\nY\nb\n').ok);
  push('U3 从 union 产出里偷摘 main 块内的一行 ⇒ 块级无损检查必须响', true,
    blockLossChecks(
      u.text.split('\n').filter((l) => !l.includes('7b9089b2')),
      conflictBlocks(dep.ours, dep.base, dep.theirs).blocks,
    ).length > 0);
  // U4 挡的是"把判据写宽成文件级"那一类假红：同一处两侧各追加（真冲突块），
  //    而 main 在**块外**删掉了一行 —— 块级判据必须仍然通过（那一行本来就该没）。
  push('U4 一侧的块外删除不造成假红（块级判据，不是文件级）', true,
    (() => {
      const r = unionMerge('a\nX\nb\n', 'a\nb\nc\n', 'a\nY\nb\nc\n');
      const L = r.ok ? r.text.split('\n') : [];
      return r.ok === true && L.includes('X') && L.includes('Y') && !L.includes('c');
    })());

  // 第十一族：真实 live-domain.spec.ts
  const spec = blobs(MAIN, SRC, 'e2e/live-site/live-domain.spec.ts');
  const shape = (merged) => [
    sameCountAs('const probe = await page.evaluate', spec.ours)(merged),
    sameCountAs('privacy-consent-accept', spec.ours)(merged),
  ].filter(Boolean);
  const o = oursMerge(spec.ours, spec.base, spec.theirs, shape);
  push('O0 真实 live-domain.spec.ts 走 ours ⇒ 成功', true, o.ok === true);
  push('O1 被丢掉的本批独有行有账可查（不是静默丢）', true, o.ok && o.dropped.length > 0);
  push('O2 结构断言有牙：手动把 probe 声明复制成两枚 ⇒ 必须报不成立', true,
    shape([...spec.ours.split('\n'), '  const probe = await page.evaluate(async () => {});']).length > 0);
  push('O3 这种形状上不许走 union（要么拒、要么被结构断言抓住）', true,
    (() => {
      const bad = unionMerge(spec.ours, spec.base, spec.theirs);
      if (!bad.ok) return bad.refuse.includes('base 段非空');
      return shape(bad.text.split('\n')).length > 0;
    })());

  let bad = 0;
  for (const a of arms) {
    const hit = a.got === a.expect;
    if (!hit) bad += 1;
    console.log(`${hit ? 'OK ' : 'BAD'} ${a.id}（期望 ${JSON.stringify(a.expect)} 实得 ${JSON.stringify(a.got)}）`);
  }
  console.log(`臂数 ${arms.length} · 不符 ${bad} · 取的本批独有行 ${o.ok ? o.dropped.length : 'n/a'} 条`);
  process.exit(bad === 0 ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) runSelftest();
