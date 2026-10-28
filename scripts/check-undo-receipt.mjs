#!/usr/bin/env node
/**
 * 撤销回执门禁（全局 UX 线 P3）
 * ==============================
 *
 * 判的是两格，它们都是"能失败"的形状，不是"看着像"的形状：
 *
 * **R1 撤销回执的计时器只许有一份。**
 *   一条**带撤销动作**的回执，如果它的时长是自己 `setTimeout(…, 5000)` 写出来的，
 *   那么"窗口多长、手放上去停不停、失败留不留"这三格就散在各页 —— 而这三格正是
 *   P3 立项时量出来的全部缺陷（四处 5000ms、两处没暂停、两处失败写进会飘走的 `role="status"`）。
 *   判据：某个 `useState` 槽的名字带 undo，而有一条数字常量的 `setTimeout`
 *   **在同一条语句里调它的 setter** ⇒ 违规。
 *   正解是 `<UndoReceipt>`（Web）或读 `receiptTimingOf()` 的时长（移动端）。
 *
 * **R2 进回收站的那四类删除，删完必须给一条回执。**
 *   任务／便签／清单／习惯是 ADR-0048 里 `deletedAt` 那一态 —— 撤销**真的可执行**，
 *   而立项现量是四条单条删除里**三条一个字的回执都不给**（用户只能自己去回收站捞）。
 *   判据：调用了这四家的 `deleteTask`/`removeNote`/`deleteProject`/`deleteHabit` 的文件，
 *   必须消费 `UndoReceipt` 或宿主侧的 `undoReceiptFor` 守卫。
 *
 * 🔴 两条都**按结果判，不按手段判**：宿主可以用自己的排布、自己的文案键、自己的落点，
 * 唯一不许的是"没有回执"与"回执的计时归各页管"。
 *
 * ⚠️ R2 的故意窄处：**批量**删除不在这里另数一遍（与单条走同一套动作层，数两遍就是
 * 第二份命题）；`ShareFeature` 那格"退出共享"删的是**本地那行**、不进回收站 ⇒
 * 它归 `undoReceiptFor()` 判。标签同理：`isUndoableDeletion('tag')` 恒假（§7.1 P-1
 * 标签不进回收站），所以它**不该**长出撤销出口 —— 判据 e 靠的是那一枚函数，不是这张账。
 *
 * ⚠️ R1 的**范围**只数 `apps/*`：`packages/ui/src` 里的共享原语本来就该按
 * "查表拿时长"的形状写，让它进这张账会判到实现细节上去（P4 那枚控件门禁管这个）。
 *
 * 账本制与另外三枚门禁同源：**账外出现 ⇒ 红；账内读数涨了 ⇒ 红；读数掉了也红**
 * （要求同步把账本那一行改小）。第三臂不是"应该放过"，它是唯一能证明自己在缩的读数。
 *
 * 用法：`node scripts/check-undo-receipt.mjs [--self-test]`
 * 🔴 未知旗标一律拒（§7 第 605 条：一把静默吞掉旗标的尺会照常打绿，而它判的是另一棵树）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const ALLOWED_FLAGS = ['--self-test'];
const unknownFlags = process.argv.slice(2).filter((arg) => arg.startsWith('-') && !ALLOWED_FLAGS.includes(arg));
if (unknownFlags.length > 0) {
  console.error(`❌ 未知旗标：${unknownFlags.join(' ')} —— 这枚尺不认它，会照常判默认那两份（§7 第 605 条）。`);
  process.exit(1);
}
const WANT_SELFTEST = process.argv.includes('--self-test');

/** R1/R2 扫这两棵壳树（回执只可能住在界面层）。 */
const SHELL_SCOPES = ['apps/web/src', 'apps/mobile/src'];
/**
 * R2 只数 **Web 的接线层**。两格收窄各有理由，不是"先放过"：
 *  · `store.ts` / `*-actions*` 里那些 `.deleteTask(` 是**动作层的定义**，
 *    不是用户按下去的那一格 —— 在定义处数"没给回执"会把每个 store 都判红，
 *    一把第一天就红三十格的尺等于没有尺（同 §5b 里 R3 被拒的理由）。
 *  · 移动端的回执 UI 不在 P3 的范围（计划那句是"移动端同**语义**计时"，
 *    计时这一格本期已改读共享表；给移动端画回执归 P4 的共享控件层落地之后）。
 */
const R2_SCOPES = ['apps/web/src'];
const R2_SKIP_RE = /(^|\/)(store|actions)\.ts$|\/actions?-|\.spec\./;
/** 棘轮多扫共享层：那边是回执的实现所在。 */
const WIRE_SCOPES = ['apps/web/src', 'apps/mobile/src', 'packages/ui/src'];

/** 撤销槽：`const [undoDrop, setUndoDrop] = …`，方括号里**第一个**名字必须带 undo。 */
const SLOT_RE = /const\s+\[\s*([A-Za-z0-9_]*[Uu]ndo[A-Za-z0-9_]*)\s*,\s*(set[A-Za-z0-9_]+)\s*\]/g;
const DELETION_RE = /\.(deleteTask|removeNote|deleteProject|deleteHabit)\s*\(/g;
const RECEIPT_USE_RE = /<UndoReceipt[\s/]/;
/** 宿主侧守卫也算"给了回执"：判据是结果（用户能不能撤销），不是手段（谁画的）。 */
const UNDO_GUARD_RE = /undoReceiptFor\s*\(/;

/**
 * 账本：`file` → 该文件里**已核实**的违规读数。
 *
 * 每一行都要带**可证伪的翻案条件**，否则它就是一张免死金牌。
 *
 * 现量 **0 条**（2026-10-28 立项时是 1 条：`apps/mobile/src/screens/TasksScreen.tsx`
 * 那两枚 5000ms，已经在本期改读 `receiptTimingOf()` 清掉了）。
 * 这张账**空着才是目的** —— 任何一条新读数都必须带着"为什么允许"和"什么条件下删掉它"
 * 才能进来，而它进来的那一刻就是下一位要核对的债。
 */
const LEDGER = [
  {
    file: 'apps/web/src/features/share/ShareFeature.tsx',
    r1: 0,
    r2: 1,
    why: '「退出共享」调了 `deleteProject`，但它是**复合动作**：同一发里先 `leaveShare(shareId)` ' +
      '（服务端那侧的成员关系已经改掉了）、再抹本机的密钥/日志/游标/会话。' +
      '给一条"撤销"就是对外做假陈述 —— 回执点回来只能把本地那一行捞回来，' +
      '共享那边回不来。判据正文：Skill `destructive-actions.md` §4「动作对外可见 ⇒ 撤销只能当补充」，' +
      '本仓的实现是 `isUndoIneffective` 的 `externallyVisible` 那一支。',
    reversal: '若「退出共享」被拆成"只做本地删除"与"退出共享"两格，前那一格就该接 ' +
      '`<UndoReceipt>` 并把本行一起删掉 —— 留着这一行而不拆，就是拿豁免当永久通行证。',
  },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { yield* walk(full); continue; }
    if (!/\.(tsx|ts)$/.test(name) || /\.(spec|test)\./.test(name)) continue;
    yield full;
  }
}

/**
 * 这一格里有没有**自己写的数字时长**。
 *
 * 🔴 判的是"这一枚计时器在给这一格计时"，不是"这个文件碰巧提过 undo"：
 * 第一版的谓词是"文件里既有 undo 字样又有数字 `setTimeout`"，于是 `App.tsx` 里
 * 那枚与撤销无关的计时器被判成违规 —— **假红会让人去修一个不存在的问题**，
 * 而这种红最容易的处置是把判据改宽，判据就没了。数字必须真的挂在 `set<槽>` 那一条语句里。
 */
function undoTimerCount(text) {
  let count = 0;
  for (const slot of text.matchAll(SLOT_RE)) {
    const setter = slot[2];
    // 🔴 前缀用 `[^;]*?` 不用 `[^)]*`：真实形状是 `setTimeout(() => setUndoDrop(null), 5000)`，
    //    里头**先有一个 `)`** 才轮到 setter。第一版写的是 `[^)]*`，它停在第一个 `)` 上，
    //    于是这一枚**恒读 0** —— 一把"永远不红"的判据比没有判据更糟（§5 元规则二），
    //    而它当时看起来完全正常：臂 ④ 就是专门用来撞这一子的。
    const bound = new RegExp('setTimeout\\([^;]*?\\b' + setter + '\\b[^;]*?,\\s*\\d+\\s*\\)', 'g');
    count += [...text.matchAll(bound)].length;
  }
  return count;
}

/**
 * 数**代码行**里的删除调用。
 *
 * 🔴 必须先剔注释行：`TaskActionError.tsx` 里那一句 `.deleteTask(` 出现在文件头的
 * 说明里（它讲的就是"删除失败要怎么说"），按整份源码数会把一枚讲道理的注释
 * 判成一处该接回执的落点。注释命中不是形状问题，是**每一道源码门禁都会撞的**
 * 那面墙（同 §5b 里 JSX 内联箭头函数的 `>` 提前收尾那一课）。
 */
function deletionCallCount(text) {
  let count = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    count += [...line.matchAll(DELETION_RE)].length;
  }
  return count;
}

/** @returns {{ file: string, r1: number, r2: number }[]} */
function scan(rootDir) {
  const found = [];
  for (const scope of SHELL_SCOPES) {
    for (const file of walk(join(rootDir, scope))) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(rootDir, file).replace(/\\/g, '/');
      const r1 = undoTimerCount(text);
      const inR2Scope = R2_SCOPES.some((s) => rel.startsWith(s)) && !R2_SKIP_RE.test(rel);
      const deletions = inR2Scope ? deletionCallCount(text) : 0;
      const covered = RECEIPT_USE_RE.test(text) || UNDO_GUARD_RE.test(text);
      const r2 = deletions > 0 && !covered ? 1 : 0;
      if (r1 === 0 && r2 === 0) continue;
      found.push({ file: rel, r1, r2 });
    }
  }
  return found;
}

function countWired(rootDir) {
  let wired = 0;
  for (const scope of WIRE_SCOPES) {
    for (const file of walk(join(rootDir, scope))) {
      if (RECEIPT_USE_RE.test(readFileSync(file, 'utf8'))) wired += 1;
    }
  }
  return wired;
}

/**
 * 棘轮数的是**全树里消费 `<UndoReceipt>` 的文件数**。
 * 第一版从"违规候选"那份列表里数，于是全树五格只数出一格 ⇒ 这条**恒红**；
 * 而恒红的尺和永不红的尺一样没有价值（§5 元规则二）。
 */
function coverageProblems(rootDir, floor) {
  const wired = countWired(rootDir);
  if (wired >= floor) return [];
  return ['已经接上共享回执 `<UndoReceipt>` 的落点只剩 ' + wired + ' 格，低于下限 ' + floor +
    ' —— 要么落点被摘了，要么它的形状漂出了候选集（**判据没跟上**）。'];
}

/** 下限：只减不增的棘轮。现量在每次运行里打出来，这个数字不是"现在有几格"的抄件。 */
const WIRED_FLOOR = 4;

function problemsFor(entry, ledgerRow) {
  const problems = [];
  const allowedR1 = ledgerRow?.r1 ?? 0;
  const allowedR2 = ledgerRow?.r2 ?? 0;
  if (entry.r1 > allowedR1) {
    problems.push(entry.file + '：' + entry.r1 + ' 处撤销回执自己写 `setTimeout(…, 数字)`' +
      '（账本只认 ' + allowedR1 + ' 处）—— 时长、暂停、失败留不留必须查 `@heyta/ui` 的 ' +
      '`receiptTimingOf()`，Web 用 `<UndoReceipt>` 画。');
  }
  if (entry.r2 > allowedR2) {
    problems.push(entry.file + '：调了回收站那四类的删除动作，却没有一条 `<UndoReceipt>` 回执' +
      '（账本只认 ' + allowedR2 + ' 处）。撤销真的可执行而不给出口，' +
      '等于把"捞回来"的门槛从一次点击抬成了"知道回收站在哪儿"。');
  }
  return problems;
}

function check(rootDir) {
  const entries = scan(rootDir);
  const byFile = new Map(entries.map((e) => [e.file, e]));
  const problems = [];
  for (const entry of entries) {
    problems.push(...problemsFor(entry, LEDGER.find((r) => r.file === entry.file)));
  }
  // 账本里那一行已经不成立（读数掉了）也要红：否则账本会变成一份没人核对的历史。
  for (const row of LEDGER) {
    const entry = byFile.get(row.file);
    if (entry === undefined) {
      problems.push('账本里 ' + row.file + ' 这一行已经不再是候选（读数掉了）—— 把那一行删掉，' +
        '并确认：' + row.reversal);
      continue;
    }
    if (entry.r1 < row.r1 || entry.r2 < row.r2) {
      problems.push('账本里 ' + row.file + ' 记的是 r1=' + row.r1 + ' / r2=' + row.r2 +
        '，现量只有 r1=' + entry.r1 + ' / r2=' + entry.r2 +
        ' —— 读数掉了就把账本那一行改小，否则这条门禁失去唯一能证明自己在缩的读数。');
    }
  }
  problems.push(...coverageProblems(rootDir, WIRED_FLOOR));
  return { entries, problems };
}

/**
 * 七枚自证臂。②③ 与 ④⑤⑥ 是两组**配对臂**：同一份源码只差那一枚形状，
 * 这样红起来才能归因到"就是这一格坏了"，而不是"这棵树长得不对"
 * （P1 那枚门禁的第一版就输在没有配对：喂进去一棵合成树，账本八格全读成过期，
 * 红的是夹具不是判据 —— 见 `docs/agents/overlay-feedback.md` §5a）。
 */
function runSelfTest() {
  const real = check(ROOT);
  const arms = [];
  const ok = (name, pass) => { arms.push([name, pass]); };

  ok('① 当前树没有新增违规（账本内的豁免之外，R1 与 R2 全清）', real.problems.length === 0);

  // ②/③ 配对臂：同一份源码，只差"有没有 <UndoReceipt>"。
  const synthViolation = { file: 'apps/web/src/synthetic/Probe.tsx', r1: 0, r2: 1 };
  const synthClean = { file: 'apps/web/src/synthetic/Probe.tsx', r1: 0, r2: 0 };
  const sourceWithout = 'const [undo, setUndo] = useState(); store.deleteTask(id); return null;';
  const sourceWith = 'const [undo, setUndo] = useState(); store.deleteTask(id); return <UndoReceipt />;';
  ok('② 调了回收站那四类的删除、没有共享回执 ⇒ 必须红（R2）',
    problemsFor(synthViolation, undefined).some((p) => p.includes('没有一条')) &&
    !RECEIPT_USE_RE.test(sourceWithout) && !UNDO_GUARD_RE.test(sourceWithout));
  ok('③ 同一份源码接上 `<UndoReceipt>` ⇒ 必须绿（配对臂，红的是那一枚形状不是这棵树）',
    RECEIPT_USE_RE.test(sourceWith) && problemsFor(synthClean, undefined).length === 0);

  // ④⑤⑥ 三枚一组：只差计时器那一子，外加"无关计时器不许算"。
  const slot = 'const [undoDrop, setUndoDrop] = useState(null);\n';
  const numeric = slot + 'setTimeout(() => setUndoDrop(null), 5000);';
  const tokenSourced = slot + 'setTimeout(() => setUndoDrop(null), timing.durationMs);';
  const unrelated = slot + 'setTimeout(() => setOtherThing(1), 5000);';
  ok('④ 撤销槽的数字常量计时 ⇒ 必须红（R1）', undoTimerCount(numeric) === 1);
  ok('⑤ 时长来自 `receiptTimingOf`（非数字常量）⇒ 不触发 R1，不许把正解判红',
    undoTimerCount(tokenSourced) === 0);
  ok('⑥ 同一文件里**别的**数字计时器不许算成撤销回执的（假红会引来"修"不存在的问题）',
    undoTimerCount(unrelated) === 0);

  // ⑦ 棘轮：按现值绿、把下限抬到"现量 + 1"必须红。
  //    ⚠️ 第一版写的是 `WIRED_FLOOR + 1`，而现量 5 格、下限 4 ⇒ 抬到 5 还是绿 ——
  //    那一臂**没有分辨力**（它测的是"我对下限的猜测"，不是"这条尺能不能红"）。
  const wiredNow = countWired(ROOT);
  ok('⑦ 落点数达到下限 ⇒ 绿；下限抬到现量 + 1 ⇒ 红（现量 ' + wiredNow + ' 格 / 下限 ' + WIRED_FLOOR + '）',
    coverageProblems(ROOT, WIRED_FLOOR).length === 0 && coverageProblems(ROOT, wiredNow + 1).length === 1);

  let failed = 0;
  for (const [name, pass] of arms) {
    console.log((pass ? '✓ 自证臂 ' : '× 自证臂 ') + name);
    if (!pass) failed += 1;
  }
  if (failed > 0) {
    console.error('❌ ' + failed + ' 枚自证臂坏 —— 这枚门禁不能失败，等于没有判据。');
    process.exit(1);
  }
  console.log('✅ 七臂都能按预期红/绿。当前树违规候选 ' + real.entries.length +
    ' 格、读数问题 ' + real.problems.length + ' 条。');
}

if (WANT_SELFTEST) {
  runSelfTest();
  process.exit(0);
}

const { entries, problems } = check(ROOT);
console.log('撤销回执门禁：违规候选 ' + entries.length + ' 格、全树已接共享回执 ' +
  countWired(ROOT) + ' 格（下限 ' + WIRED_FLOOR + '）、账本 ' + LEDGER.length + ' 条。');
if (problems.length > 0) {
  for (const p of problems) console.error('   🔴 ' + p);
  console.error('❌ ' + problems.length + ' 条违规。');
  process.exit(1);
}
console.log('✅ 撤销回执只有一份计时来源，且回收站那四类的删除都给了回执。');
