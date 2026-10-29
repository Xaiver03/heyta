#!/usr/bin/env node
/**
 * 账本里**已入库的行**在工作树里凭空消失 ⇒ 抓出来。
 * ================================================================
 *
 * ## 为什么要有它（2026-10-29 现量踩到的真事）
 *
 * 共享检出里，一个会话整份读入 `BLOCKED.md`、改自己那一段、再整份写回。
 * 如果它在读与写之间，别的会话把新行提交了，它写回的那一版就**不带那些行** ——
 * 于是 `git diff` 出现一种形状：**只有追加、同时有几行被删**。
 * 当天实测：追加 388 行的同一次写回抹掉了 6 行待拍板登记（全是当时最近 6 笔
 * 碰过这枚文件的提交的内容），而**那 6 件事一件都没被解决**：
 * 索引覆盖与导出面的候选照旧、撞号尺 `--strict` 仍退 1、脏截图照旧在树里。
 * 提交那一版 = 把别人的「这事还没人拍」记录静默销毁，而且**没有任何门禁会报**。
 *
 * ## 它比什么、不比什么
 *
 * 比的是**整行文本**（只去掉行尾空白）的多重集差：`ref` 里有、工作树里少的那些行。
 * ⚠️ 有意保守：改缩进、行内加粗、把 A 句拆成 B 句都会读成「消失」。
 * 这一把尺的任务是**别让人把销毁读成没变化**，多报由人逐行判，比漏报便宜。
 * 完全不比：新增的行（那是别人在写）、顺序（搬家不算丢，见臂 L3/L4）。
 * 单独一档不判红：**就地改写**（行首 40 码点仍在别处 ⇒ 按「改口不删旧文」的常态处理，臂 L13/L14 钉这一格）。
 *
 * ## 它**不**做的事
 *
 * 不判定「该行讲的事是否已闭」。已闭的行当然该消失，但那要人写下判断 ——
 * 本仓的规矩是「改口不删旧文」，所以合法的删除本来就该带说明，
 * 而带说明的删除由人在读这份输出时一眼认出，不需要尺来替他认。
 *
 * ## 用法
 *
 *   node research/tools/audit-ledger-row-loss.mjs                       # 诊断，恒退 0
 *   node research/tools/audit-ledger-row-loss.mjs --strict              # 有消失 ⇒ 退 1（提交前当门用）
 *   node research/tools/audit-ledger-row-loss.mjs docs/plans/x.md --ref HEAD~3
 *   node research/tools/audit-ledger-row-loss.mjs --self-test            # 12 枚臂
 *   node research/tools/audit-ledger-row-loss.mjs --mutate               # 真账本上造一次失，必须被抓到
 *
 * 退出码：0 诊断 / 1 `--strict` 且确有消失 / 2 分母为空（瞎尺，不许读成「没有消失的行」）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_FILES = ['BLOCKED.md'];
const MAX_LIST = 20;
const PREVIEW = 120;

const norm = (line) => line.replace(/\s+$/, '');

/** ref 里有、worktree 里少的行；**就地改写不算消失**。
 *
 * 🔴 为什么不"只按整行文本比"就够：本仓的规矩是「改口不删旧文」，而改口最常见的落点就是
 * **往同一格里追加一段追记**——整行文本因此变了，按纯整行比会把它读成"已入库的行消失"。
 * 这不是把尺放宽：判定改成"行首 40 码点还在不在同一枚文件的别处"——
 * 追加追记 ⇒ 前缀还在 ⇒ 记 `revised`（单独报条数与位置，不判红）；
 * 整行换成不相干的内容或删掉 ⇒ 前缀找不到 ⇒ 仍是 `vanished`，`--strict` 照样退 1。
 * 短于 25 码点的行（分隔线、`|---|`）不参与前缀判定，它们本来就靠多重集数。
 */
export function findVanished(refText, wtText) {
  const refLines = refText.split('\n');
  const wtLines = wtText.split('\n');
  const wt = new Map();
  for (const raw of wtLines) {
    const l = norm(raw);
    if (l === '') continue;
    wt.set(l, (wt.get(l) ?? 0) + 1);
  }
  // 前缀索引：worktree 里每一行的前 40 码点 → 出现次数（用来认"就地改写"）
  const wtPrefix = new Map();
  for (const raw of wtLines) {
    const l = norm(raw);
    if (l.length < 25) continue;
    const pre = l.slice(0, 40);
    wtPrefix.set(pre, (wtPrefix.get(pre) ?? 0) + 1);
  }
  const seen = new Map();
  const prefixSeen = new Map();
  const vanished = [];
  const revised = [];
  refLines.forEach((raw, idx) => {
    const l = norm(raw);
    if (l === '') return;
    const nth = (seen.get(l) ?? 0) + 1;
    seen.set(l, nth);
    if (nth <= (wt.get(l) ?? 0)) return; // 这一枚还在（可能只是搬了家）
    if (l.length >= 25) {
      const pre = l.slice(0, 40);
      const pth = (prefixSeen.get(pre) ?? 0) + 1;
      prefixSeen.set(pre, pth);
      if (pth <= (wtPrefix.get(pre) ?? 0)) {
        const at = wtLines.findIndex((w, i) => norm(w).slice(0, 40) === pre && norm(w).length >= 25);
        revised.push({ refLine: idx + 1, wtLine: at + 1, text: l });
        return;
      }
    }
    vanished.push({ line: idx + 1, text: l, kind: kindOf(l) });
  });
  return { vanished, revised, refNonBlank: countNonBlank(refLines), wtNonBlank: countNonBlank(wtLines) };
}

const kindOf = (l) =>
  /^\|/.test(l) ? 'table-row' : /^#{1,6}\s/.test(l) ? 'heading' : /^\s*[-*]\s/.test(l) ? 'bullet' : 'prose';

const countNonBlank = (lines) => lines.filter((l) => norm(l) !== '').length;

function readRef(file, ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function report(file, refText, wtText, ref, opts) {
  const { vanished, revised, refNonBlank, wtNonBlank } = findVanished(refText, wtText);
  if (refNonBlank === 0) {
    console.log(`⚠️ ${file}@${ref} 的非空行分母是 0 ⇒ 这把尺在这一枚上是瞎的，本行读数不代表「没有消失的行」。`);
    return { blind: true, count: 0 };
  }
  const byKind = {};
  for (const v of vanished) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  console.log(
    `${file}｜ref=${ref}：非空行 ref ${refNonBlank}／worktree ${wtNonBlank}｜消失 ${vanished.length} 枚` +
      (vanished.length ? `（${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join('、')}）` : ''),
  );
  vanished.slice(0, opts.top).forEach((v) => {
    console.log(`   ${file}:${v.line}@${ref} [${v.kind}] ${v.text.slice(0, PREVIEW)}`);
  });
  if (vanished.length > opts.top) console.log(`   …另有 ${vanished.length - opts.top} 枚（加 --top 500 全列）`);
  revised.slice(0, opts.top).forEach((r) => {
    console.log(`   ✎ 就地改写 ref ${file}:${r.refLine} → worktree 第 ${r.wtLine} 行 ｜ ${r.text.slice(0, 60)}`);
  });
  if (vanished.length > 0) {
    console.log(
      `   ↑ 逐行判两件事：① 这一行讲的事真结了吗（本仓规矩「改口不删旧文」，结了也该留字）；` +
        `② 是不是「读旧→写新」的整文件写回把它抹掉了 —— 只看 git diff 的删除行数读不出这两者的区别。`,
    );
  }
  return { blind: false, count: vanished.length };
}

/** 12 枚臂：形状（表格/正文/标题）、多重集、搬家、空白、分母、真账本阳性对照。 */
function selfTest() {
  const L3 = '| A | 甲 | 现量 |\n';
  const fixture = [
    '# 标题\n',
    '\n',
    '| 格 | 为什么 | 现量 |\n',
    '|---|---|---|\n',
    L3,
    '| B | 乙 | `node x.mjs` |\n',
    '| B | 乙 | `node x.mjs` |\n', // 与上一行逐字相同：数的是「枚」不是「种」
    '正文一句。\n',
    '- 项目符号行\n',
  ].join('');
  const results = [];
  // 数组也要能当期望值（L6/L7 比的是「两个数一组的读数」），所以按 JSON 形状比，不按引用比。
  const arm = (name, got, want) =>
    results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  const t = (drop) => findVanished(fixture, drop(fixture));
  arm('L1 两份相同 ⇒ 0 枚消失', t((f) => f).vanished.length, 0);
  arm(
    'L2 删掉中间一枚表格行 ⇒ 恰好点名那一枚（带 ref 行号）',
    (() => {
      const r = t((f) => f.replace(L3, ''));
      return r.vanished.length === 1 && r.vanished[0].line === 5 && r.vanished[0].text === norm(L3) ? 'ok' : 'bad';
    })(),
    'ok',
  );
  arm(
    'L3 同一行搬到文件末尾 ⇒ 搬家不算丢（多重集比的是「有没有」，不是「在哪」）',
    (() => {
      const moved = fixture.replace(L3, '') + L3;
      return findVanished(fixture, moved).vanished.length;
    })(),
    0,
  );
  arm(
    'L4 逐字相同的两枚里少一枚 ⇒ 仍报 1（按枚数，不按去重后的行数）',
    (() => {
      const r = t((f) => f.replace('| B | 乙 | `node x.mjs` |\n', ''));
      return r.vanished.length;
    })(),
    1,
  );
  arm(
    'L5 只多了行尾空白 ⇒ 不许算消失（否则每一趟格式化都会红）',
    (() => {
      const r = t((f) => f.replace('正文一句。\n', '正文一句。   \n'));
      return r.vanished.length;
    })(),
    0,
  );
  arm(
    'L6 空行增减 ⇒ 不许进分母、也不许算消失',
    (() => {
      const r = t((f) => `${f}\n\n\n`);
      return [r.vanished.length, r.refNonBlank === r.wtNonBlank];
    })(),
    [0, true],
  );
  arm(
    'L7 正文与项目符号行被删也要点名（尺不许只认表格行）',
    (() => {
      const r = t((f) => f.replace('正文一句。\n', '').replace('- 项目符号行\n', ''));
      return [r.vanished.length, r.vanished.map((x) => x.kind).sort().join(',')];
    })(),
    [2, 'bullet,prose'],
  );
  arm(
    'L8 改缩进 ⇒ 有意读成消失（保守：宁可多报由人判，也不许把销毁读成没变化）',
    t((f) => f.replace('- 项目符号行\n', '  - 项目符号行\n')).vanished.length,
    1,
  );
  arm(
    'L9 分母为空的 ref ⇒ 标「瞎尺」，不许由这一枚得出「没有消失的行」',
    findVanished('', fixture).refNonBlank,
    0,
  );
  arm('L10 标题行单独被删也点名', t((f) => f.replace('# 标题\n', '')).vanished.map((v) => v.kind).join(','), 'heading');
  // L13/L14 用一枚**足够长**的夹具行：前缀判定有 25 码点的下限（短行如 `- 项目符号行`
  // 走多重集那档，拿它测前缀会测不到东西——这一发第一版就是这么假红了一次）。
  const LONG = '| 🟠 这一格的枚数由尺自己打印，正文里不抄会漂的值，读的人按右栏那条命令自取 |\n';
  const longFixture = `# 标题\n\n${LONG}| 另一格 | 别的现量 |\n`;
  arm(
    'L13 往同一格里追加追记（行首不变、行尾变长）⇒ 记「就地改写」，不许读成消失（「改口不删旧文」的常态落点）',
    (() => {
      const r = findVanished(longFixture, longFixture.replace(LONG.slice(0, -1), `${LONG.slice(0, -1)} ✅ 10-29 本线复跑并追加读数 |`));
      return [r.vanished.length, r.revised.length];
    })(),
    [0, 1],
  );
  arm(
    'L14 整行换成完全不相干的内容 ⇒ 前缀找不到，仍算消失（豁免不许把销毁读成改写）',
    (() => {
      const r = findVanished(longFixture, longFixture.replace(LONG, '| 🟠 今天写了一格与上面毫无关系的新内容，右栏照样给命令 |\n'));
      return [r.vanished.length, r.revised.length];
    })(),
    [1, 0],
  );
  // 阳性对照：真账本拿自己比 ⇒ 必须 0（这一枚否证的是「尺在长文件上会自己造红」）
  const realRef = readRef('BLOCKED.md', 'HEAD');
  if (realRef === null) {
    arm('L11 真账本（HEAD 版 BLOCKED.md）自比 ⇒ 0 枚（拿不到 ref ⇒ 本臂跳过并披露）', 'skipped', 'skipped');
  } else {
    arm('L11 真账本（HEAD 版 BLOCKED.md）自比 ⇒ 0 枚消失', findVanished(realRef, realRef).vanished.length, 0);
    const pick = uniqueIndexes(realRef, /^\|\s*🟠|^\|\s*🔴/);
    const idx = pick.lines.findIndex((_l, i) => pick.ok(i));
    arm(
      'L12 从真账本里剔掉一枚**全文唯一**的行 ⇒ 必须恰好点名这一行（注入的死必须被点名；挑重复行会读成假红）',
      idx < 0 ? 'no-unique-row' : findVanished(realRef, pick.lines.filter((_, i) => i !== idx).join('\n')).vanished.map((v) => v.text).join('|') === norm(pick.lines[idx]) ? 'ok' : 'bad',
      'ok',
    );
  }

  for (const r of results) {
    console.log(`${r.ok ? '✅' : '🔴'} ${r.name}${r.ok ? '' : `  得到=${JSON.stringify(r.got)} 期望=${JSON.stringify(r.want)}`}`);
  }
  const nums = results.map((r) => Number(/^L(\d+)/.exec(r.name)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === results.length && new Set(nums).size === results.length;
  console.log(`${seqOk ? '✅' : '🔴'} L15 臂号连续且不重号（判的是上面 ${results.length} 枚：最大 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  const failed = results.filter((r) => !r.ok).length + (seqOk ? 0 : 1);
  console.log(`臂 ${results.length} 枚，红 ${failed} 枚`);
  return failed === 0 ? 0 : 1;
}

/** 多重集语义下，抹掉一份**逐字重复**的行本来就抓不到（另一份还在）⇒ 变异只能挑全文唯一的行。
 *  这枚坑台账 §6.120 记过一次：拿重复行做注入会读出「本尺不敏感」的假红。 */
function uniqueIndexes(text, re) {
  const lines = text.split('\n');
  const times = new Map();
  for (const l of lines) {
    const n = norm(l);
    if (n !== '') times.set(n, (times.get(n) ?? 0) + 1);
  }
  return { lines, isUnique: (i) => times.get(norm(lines[i])) === 1, ok: (i) => re.test(lines[i]) && times.get(norm(lines[i])) === 1 };
}

/** 在内存里的真账本上造失，要求本尺抓到 ⇒ 证「提交那一版时它会响」。
 *  两形：**单行**被抹与**连续 5 行**被抹（2026-10-29 那次事故的真实形状：一次整文件写回抹掉 5 行相邻登记 + 1 行别处）。 */
function mutate() {
  const refText = readRef('BLOCKED.md', 'HEAD');
  if (refText === null) {
    console.log('🔴 拿不到 HEAD:BLOCKED.md ⇒ 变异臂没东西可改，不判绿。');
    return 1;
  }
  const { lines, ok, isUnique } = uniqueIndexes(refText, /^\|\s*🟠|^\#\s/);
  const before = findVanished(refText, refText).vanished.length;
  const rowIdx = lines.findIndex((_l, i) => ok(i));
  const blockIdx = lines.findIndex(
    (_l, i) => [0, 1, 2, 3, 4].every((d) => /^\|\s/.test(lines[i + d] ?? '')) && [0, 1, 2, 3, 4].every((d) => isUnique(i + d)),
  );
  if (rowIdx < 0 || blockIdx < 0) {
    console.log(`🔴 分母里缺**唯一**且可剔的形状（单行=${rowIdx >= 0}，连续 5 行块=${blockIdx >= 0}）⇒ 变异臂打空，不判绿。`);
    return 1;
  }
  const cases = [
    { name: 'M1 抹掉 1 行', drop: new Set([rowIdx]) },
    { name: 'M2 抹掉连续 5 行（事故形状）', drop: new Set([blockIdx, blockIdx + 1, blockIdx + 2, blockIdx + 3, blockIdx + 4]) },
  ];
  let bad = before !== 0 ? 1 : 0;
  console.log(`baseline（同一份文本自比）=${before}（必须 0）`);
  for (const c of cases) {
    const mutated = lines.filter((_, i) => !c.drop.has(i)).join('\n');
    const after = findVanished(refText, mutated).vanished;
    // 被抹的行按 ref 顺序就是本尺该点名的顺序，两边逐字比一次（只数枚数会把「抓错行」读成过）
    const want = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => c.drop.has(i) && norm(l) !== '')
      .map(({ l }) => norm(l));
    const got = after.map((v) => v.text);
    const hit = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${c.name} ⇒ 抓到 ${after.length} 枚（期望 ${want.length}）｜逐枚对得上被抹的那几行=${hit ? '是' : '否'}`);
    if (!hit) bad += 1;
  }
  if (bad > 0) {
    console.log('🔴 本尺对「已入库的行被抹掉」不敏感 ⇒ 拿它当门是假绿。');
    return 1;
  }
  console.log('✅ 变异臂：注入的消失被按枚抓到，且不多报、基线不报。');
  return 0;
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  if (argv.includes('--mutate')) process.exit(mutate());
  const strict = argv.includes('--strict');
  const refAt = argv.indexOf('--ref');
  const ref = refAt < 0 ? 'HEAD' : argv[refAt + 1];
  const topAt = argv.indexOf('--top');
  const top = topAt < 0 ? MAX_LIST : Number(argv[topAt + 1]);
  const files = argv.filter((a, i) => !a.startsWith('--') && i !== refAt + 1 && i !== topAt + 1);
  const targets = files.length ? files : DEFAULT_FILES;
  let total = 0;
  let blind = 0;
  for (const file of targets) {
    const refText = readRef(file, ref);
    if (refText === null) {
      console.log(`🔴 取不到 ${file}@${ref}（未入库或该 rev 里没有它）⇒ 这一枚没判，别读成「没有消失的行」。`);
      blind += 1;
      continue;
    }
    let wtText;
    try {
      wtText = readFileSync(file, 'utf8');
    } catch {
      console.log(`🔴 工作树里没有 ${file} —— 那是整枚文件被删，本尺按「没这一枚」处理，请人确认是不是有意。`);
      blind += 1;
      continue;
    }
    const r = report(file, refText, wtText, ref, { top });
    total += r.count;
    if (r.blind) blind += 1;
  }
  if (blind > 0 && total === 0) {
    console.log(`⚠️ 有 ${blind} 枚目标没判成（瞎/取不到）⇒ 退 2，不许读成「零消失」。`);
    process.exit(2);
  }
  console.log(`合计消失 ${total} 枚（${targets.length} 枚目标，ref=${ref}）${strict ? '' : '｜诊断尺默认退 0，加 --strict 才判红'}`);
  process.exit(strict && total > 0 ? 1 : 0);
}
