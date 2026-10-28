#!/usr/bin/env node
/**
 * 危险确认语义门禁（2026-10-27，全局 UX 整改 P2）
 * ==============================================
 *
 * 拦的形状有且只有一条：**一个自报危险确认的落点**（对话框里带 `*-confirm-submit`
 * 那枚不可逆主按钮），却装着两件与"危险确认"矛盾的东西：
 *
 * · **R1 图标式 × 出口** —— 关闭策略表里 `danger-confirm` 是
 *   `explicitCloseButton: false`（`packages/ui/src/overlay/dismissal.ts`）。
 *   出口必须是**具名动作**：× 的无障碍名一旦与「取消」撞成同一个词，屏幕上就有两枚
 *   "看起来都是取消"的控件，而其中一枚纯图标 —— 读屏用户无法从名字分辨按下的是哪一枚。
 * · **R2 不可逆主按钮用 `ht-btn--primary`** —— 主按钮的动作是"删掉且恢复不了"，
 *   它的颜色语义必须是 danger。蓝色 primary 在整个界面里都表示"继续"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一版**刻意没有** R3「界面不许比档位字符串」
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 写下这条门禁之前先量了它的假阳面。用
 * `grep -E "=== '(alert|typed-alert|popconfirm|undo)'" apps packages 的 src` 现量，
 * 5 处命中里有 3 处跟档位无关：
 *
 * · `packages/ui/src/settings/Settings.tsx:614` 比的是 **ARIA role** `'alert'`；
 * · `packages/ui/src/habits/HabitMonthBoard.tsx:250` 比的是**动作名** `'undo'`；
 * · `packages/domain/src/danger-tier.ts` 是档位定义与 `requiresModalCommitment` 的**本体**。
 *
 * 剩下两处里，`DangerDialog.tsx:166` 的 `tier === 'typed-alert'` 判的是"这一档要不要
 * 键入名称"，那是**档位内部的形状**，不是"这是不是模态"（后者才必须走
 * `requiresModalCommitment`）—— 那条本来就该这样写。
 *
 * ⇒ 一把逢 ARIA 就红的尺，只能靠例外表活着，而例外表就是它的墓志铭。
 *   "档位由 `resolveDangerTier` 派生"这条判据因此改由**单元测试**钉住导出形状
 *   （`apps/web/tests/trash-danger-tier.spec.ts`）+ e2e 的几何/行为臂，不做源码扫描。
 *
 * 账本：`LEDGER` 为空。落点形状与 `check-dirty-form-policy.mjs` 同规矩 ——
 * 新增违规红、账内条目数掉了也红（要同步删行）、登记的条目在当前树上不再存在红。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'apps/web/src');

/**
 * 🔴 参数按 §7 第 605 条处理：未知旗标直接拒。
 * `argv.includes('--self-test')` 那种写法会把拼错的旗标吞掉，脚本照常判默认那一份、
 * 打一句绿 —— 对自带变异臂的门禁来说，那个读数与"三臂都过了"完全同形。
 */
const ALLOWED_FLAGS = ['--self-test'];
const unknownFlags = process.argv.slice(2).filter((a) => a.startsWith('-') && !ALLOWED_FLAGS.includes(a));
if (unknownFlags.length > 0) {
  console.error(
    `❌ 未知旗标 ${unknownFlags.join(' ')}：本脚本只认 ${ALLOWED_FLAGS.join(' / ')}。` +
      '拼错的旗标若被静默吞掉，脚本会照常判默认那一份并打一句绿（§7 第 605 条）。',
  );
  process.exit(1);
}
const WANT_SELFTEST = process.argv.includes('--self-test');

/** 危险确认落点的形状：对话框里有这一枚主按钮。 */
/**
 * 主按钮的两种 testID 写法都要认。
 *
 * 🔴 2026-10-27 实测：把回收站那一格迁进 `DangerConfirmDialog` 之后，本门禁读数从
 *   "候选 1 格 / 违规 0 条"变成 **"候选 0 格 / 违规 0 条"** —— 因为组件里写的是
 *   ``data-testid={`${testId}-submit`}``（模板字面量），旧正则只认带引号的字面量。
 *   一句"✅ 全部合规"底下是**一格都没看**。这正是 §7 元规则二那条：
 *   没有信号的通过，比红更贵。
 */
const SUBMIT_TESTID = /data-testid=\{?["'][\w.-]*confirm-submit["']|data-testid=\{`\$\{\w+\}-submit`\}/;
/** 危险确认原语的使用点：它们不自己画主按钮，但**是**这一档的落点。 */
const DANGER_DIALOG_USE = /<DangerConfirmDialog\b/;
const DIALOG_SHAPE = /role="dialog"|aria-modal="true"/;

/** × 出口的形状：`<button>` 里有 `<X ` 图标，且没有别的文字子节点。 */
const CLOSE_ICON = /<X\b/;
/** 不可逆主按钮的 tone。 */
const DANGER_TONE = 'ht-btn--danger';
const PRIMARY_TONE = 'ht-btn--primary';

/**
 * 候选数下限（**只抬不降的棘轮**）。现量在每次运行的读数里，这个数字不是"现在有几格"的抄件。
 *
 * 它专门拦上面那种失法：形状一漂，候选集静默变空，而"违规 0 条"读起来比谁都绿。
 * 加了新落点就把它抬上去；**掉档时先查判据，别抬数字**（抬数字等于把这次事故登记成合规）。
 */
const CANDIDATE_FLOOR = 2;

const LEDGER = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * 扫出文件里每一段 `<button …>…</button>`（按 token 配深，不按花括号）。
 *
 * ⚠️ 这里**不需要**完整的 JSX 解析：HTML 不许按钮套按钮，所以从 `<button` 起步、
 * 数到配对的那个 `</button>` 就是这一枚按钮的全部。加一个解析器只会多一处会错的地方。
 */
function buttonBlocks(source) {
  const blocks = [];
  const open = /<button\b/g;
  const closeToken = '</button>';
  let match;
  while ((match = open.exec(source)) !== null) {
    const rest = source.slice(match.index + '<button'.length);
    const closeIndex = rest.indexOf(closeToken);
    if (closeIndex === -1) continue;
    const body = rest.slice(0, closeIndex);
    // 只吃"这一枚按钮自己的"那段：若中间还有一枚 `<button`，说明这段是别的容器的尾巴
    // （JSX 里不合法，但扫描器不该假设源码合法 —— 非法的那版本该由 tsc 与 e2e 去红）。
    blocks.push({ text: `<button${body}${closeToken}`, offset: match.index });
  }
  return blocks;
}

/**
 * 找到 `<button …` 那一段开始标签的**结尾下标**（它自己的那个 `>`）。
 *
 * 🔴 不能写 `[^>]*>`：JSX 属性值里有箭头函数
 * （`onClick={() => setConfirmingId(undefined)}`），`=>` 里那个 `>` 会提前收尾。
 * 第一版就是这么错的 —— 于是 R1 在它**专门为那一格写出来**的文件上静默不响，
 * 读数从"两条违规"变成"一条"，而门禁看起来完全正常（尺自己瞎了没人替它说）。
 * ⇒ 按字符走一遍，跳过 `{}` 内与引号内的内容。
 */
function openingTagEnd(text) {
  let depth = 0;
  let quote = null;
  for (let i = '<button'.length; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) {
      if (text[i - 1] === '/') continue; // `/>` 是自闭合图标，不是开始标签的结尾
      return i;
    }
  }
  return -1;
}

/** 这一枚按钮是否**只有图标**（没有可读的文字子节点）—— × 出口的判据。 */
function isIconOnly(blockText) {
  const end = openingTagEnd(blockText);
  if (end === -1) return false;
  const afterGt = blockText.slice(end + 1).replace(/<\/button>$/, '');
  // 去掉自闭合图标（`<X size={…} />`、`<AlertTriangle … />`）与注释后，还剩非空白字符就算有文字。
  const stripped = afterGt
    .replace(/<[A-Z][\w]*\b[\s\S]*?\/>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  return stripped.length === 0;
}

function scanFile(file) {
  const source = readFileSync(file, 'utf8');
  const usesPrimitive = DANGER_DIALOG_USE.test(source);
  if (!usesPrimitive && !(DIALOG_SHAPE.test(source) && SUBMIT_TESTID.test(source))) return null;
  const rel = relative(ROOT, file).split('\\').join('/');
  const blocks = buttonBlocks(source);
  const problems = [];
  const submit = blocks.find((b) => SUBMIT_TESTID.test(b.text));
  // 用原语的宿主没有自己的主按钮（tone 与 × 由组件保证），它算**候选**但不产生命题。
  if (submit === undefined) return usesPrimitive ? { file: rel, problems: [] } : null;
  if (submit.text.includes(PRIMARY_TONE) || !submit.text.includes(DANGER_TONE)) {
    problems.push({
      rule: 'R2',
      file: rel,
      detail: `不可逆主按钮不是 danger tone（className: ${(submit.text.match(/className=\{?["'][^"']*["']/)?.[0] ?? '无').slice(0, 60)})`,
    });
  }
  for (const block of blocks) {
    if (CLOSE_ICON.test(block.text) && isIconOnly(block.text)) {
      problems.push({
        rule: 'R1',
        file: rel,
        detail: '危险确认里有图标式的 × 出口（表里 `danger-confirm.explicitCloseButton` = false）',
      });
    }
  }
  return { file: rel, problems };
}

function scan() {
  const candidates = [];
  for (const file of walk(SRC_DIR)) {
    const found = scanFile(file);
    if (found !== null) candidates.push(found);
  }
  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

function coverageProblems(candidates) {
  if (candidates.length >= CANDIDATE_FLOOR) return [];
  return [
    `危险确认落点只剩 ${candidates.length} 格，低于下限 ${CANDIDATE_FLOOR}：` +
      '要么落点被摘了，要么它的形状漂出了候选集（**判据没跟上**）——' +
      '此时"违规 0 条"是一句"我什么都没看"，不是"都合规"。先查扫描面，不许抬下限。',
  ];
}

function check(candidates, ledger = LEDGER) {
  const problems = [];
  const seen = new Set();
  for (const candidate of candidates) {
    seen.add(candidate.file);
    for (const problem of candidate.problems) {
      if (ledger.some((entry) => entry.file === candidate.file && entry.rule === problem.rule)) continue;
      problems.push(`${problem.rule} · ${problem.file}：${problem.detail}`);
    }
  }
  for (const entry of ledger) {
    if (!existsSync(join(ROOT, entry.file))) {
      problems.push(`账本条目 ${entry.file}（${entry.rule}）在当前树上已经找不到 —— 登记过期。`);
      continue;
    }
    if (!seen.has(entry.file)) {
      problems.push(
        `账本条目 ${entry.file}（${entry.rule}）已不再是危险确认落点 —— 形状变了或已修好，` +
          '删掉这一行（例外表不许变成长尾）。',
      );
    }
  }
  return problems;
}

/**
 * 七枚自证臂。①② 是配对臂（同一棵候选树只差 tone / × 两处形状），
 * 这样"绿"只可能来自"这两件事确实被认下来了"。
 */
function selftest(realCandidates) {
  const badFile = 'apps/web/src/features/x/BadDangerConfirm.tsx';
  const goodFile = 'apps/web/src/features/x/GoodDangerConfirm.tsx';
  const bad = [
    {
      file: badFile,
      problems: [
        { rule: 'R2', file: badFile, detail: '主按钮是 primary' },
        { rule: 'R1', file: badFile, detail: '有 ×' },
      ],
    },
  ];
  const good = [{ file: goodFile, problems: [] }];
  const badRead = check(bad);
  const goodRead = check(good);
  const staleRead = check(good, [
    { file: 'apps/web/src/features/x/DefinitelyNotHere.tsx', rule: 'R1', reason: '探针', reversal: '探针' },
  ]);
  const flagRead = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--self-tset'], { encoding: 'utf8' });
  /**
   * ⑤/⑥ 打的是**扫描器**，不是 `check()`。
   *
   * 前面四臂喂的全是合成 `problems` 数组，所以源码里那一层（`buttonBlocks` /
   * `isIconOnly` / `SUBMIT_TESTID`）一条都没被碰过 —— 而 R1 第一次失手恰恰失在
   * 那一层（`[^>]*>` 撞上 `onClick={() => …}` 的箭头）。
   * ⇒ 只有真喂 JSX 文本、并且**正负成对**（有文字的按钮必须读成 false），
   *   这两臂才不是"跟着一起绿"的装饰。
   */
  const arrowIconOnly =
    '<button\n  type="button"\n  className="ht-btn ht-btn--ghost"\n  aria-label={t(\'web.trash.confirm.cancel\')}\n' +
    '  onClick={() => setConfirmingId(undefined)}\n>\n  <X size={16} aria-hidden="true" />\n</button>';
  const withText =
    '<button type="button" onClick={() => close()}>\n  {t(\'web.trash.confirm.cancel\')}\n</button>';
  const scannerArms = [
    {
      arm: `⑤ 带箭头函数的图标式 × 必须被认成"只有图标"（实际 ${isIconOnly(arrowIconOnly)}）`,
      pass: isIconOnly(arrowIconOnly) === true,
    },
    {
      arm: `⑥ 有文字的按钮不许读成图标（否则 ⑤ 恒真、没有分辨力）（实际 ${isIconOnly(withText)}）`,
      pass: isIconOnly(withText) === false,
    },
  ];
  const arms = [
    {
      arm: `① 违规夹具 ⇒ 两条各红一次（读数 ${badRead.length}）`,
      pass: badRead.length === 2 && badRead.some((l) => l.startsWith('R1')) && badRead.some((l) => l.startsWith('R2')),
    },
    { arm: `② 同一形状但合规 ⇒ 必须绿（读数 ${goodRead.length}）`, pass: goodRead.length === 0 },
    { arm: `③ 过期账本 ⇒ 必须红（读数 ${staleRead.length}）`, pass: staleRead.length === 1 },
    {
      arm: `④ 未知旗标 ⇒ 必须 rc=1（实际 rc=${flagRead.status}）`,
      pass: flagRead.status === 1 && (flagRead.stderr || '').includes('未知旗标'),
    },
    {
      arm: `⑦ 落点数掉到下限以下 ⇒ 红；达到下限 ⇒ 绿（当前树 ${realCandidates.length}）`,
      pass:
        coverageProblems([{ file: 'a', problems: [] }]).length === 1 &&
        coverageProblems(Array.from({ length: CANDIDATE_FLOOR }, (_, i) => ({ file: `f${i}`, problems: [] })))
          .length === 0 &&
        realCandidates.length >= CANDIDATE_FLOOR,
    },
    ...scannerArms,
  ];
  for (const arm of arms) console.log(`${arm.pass ? '✓' : '✗'} 自证臂 ${arm.arm}`);
  if (arms.some((a) => !a.pass)) {
    console.error('❌ 危险确认门禁的判据自己失效了（上面那臂红）—— 这条检查没有价值。');
    process.exit(1);
  }
  console.log(`✅ 七臂都能按预期红/绿。当前树候选 ${realCandidates.length} 格、违规 ${realCandidates.reduce((n, c) => n + c.problems.length, 0)} 条。`);
}

const candidates = scan();
const violationCount = candidates.reduce((n, c) => n + c.problems.length, 0);
console.log(`危险确认门禁：候选 ${candidates.length} 格（对话框 + 不可逆主按钮）、违规 ${violationCount} 条、账本 ${LEDGER.length} 条。`);

if (WANT_SELFTEST) {
  selftest(candidates);
  process.exit(0);
}

const problems = check(candidates).concat(coverageProblems(candidates));
if (problems.length > 0) {
  for (const p of problems) console.error(`❌ ${p}`);
  console.error(
    '\n判据正文：`packages/ui/src/overlay/dismissal.ts` 的 `danger-confirm` + `docs/agents/overlay-feedback.md`。' +
      '\n出路是改实现（danger tone、把 × 换成具名「取消」），不是往 `LEDGER` 里加一行。',
  );
  process.exit(1);
}
console.log('✅ 每一格危险确认都没有图标式 × 出口，且不可逆主按钮都是 danger tone。');
