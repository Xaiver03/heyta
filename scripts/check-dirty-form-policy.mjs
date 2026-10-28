#!/usr/bin/env node
/**
 * 脏表单丢弃保护门禁（2026-10-27，全局 UX 整改 P1）
 * ==================================================
 *
 * 拦的形状只有一个：**自己声明成对话框、里面有用户输入、关掉就没了，
 * 却没接丢弃保护**。这正是日历快速捕获那一格的形状（草稿住本地 `useState`，
 * 点外面即丢，且没有撤销出口），而它在本仓不是孤例 —— 立项时点名四格，
 * 这条门禁现量出**第五格**（`CategoryCreateDialog`）。
 *
 * 判据按**结果**下，不按手段下：
 * 接了 `useDirtyDismissGuard` 即算保护（它只查共享那张关闭策略表）；
 * 移动端那一族的关闭是**提交式**的（`TaskDetailSheet` 在关之前先 commit，
 * 不丢内容），所以那一端不需要确认框，本门禁也不管 `apps/mobile`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三种读数，只有第一种是免死金牌
 * ─────────────────────────────────────────────────────────────────────────
 *
 * · `verified-exempt` —— 已核过"关掉不丢用户 authored 的内容"，理由写在条目里；
 * · `owed` —— **承认为待判定**：这一格还没逐格核过它到底丢不丢东西。
 *   它计入分母、计入读数，且**只减不增**（§6 的账本纪律）。
 *   把它写成"豁免"就是把缺陷合法化 —— 本仓有过一次判据替缺陷作证的事故
 *   （`narrow-sweep.spec.ts` 里那条"日历跳过标题断言"）。
 * · 账外新增候选 → 红。
 *
 * 已登记条目必须在当前树仍能命中，否则红（例外表不许变成长尾）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'apps/web/src');

/**
 * 🔴 参数按 §7 第 605 条的形状处理：**未知旗标直接拒**，读参数用等号值而不是 `argv.includes`。
 * 第一版写的是 `process.argv.includes('--selftest')` —— 把 `--self-test` 打成 `--selftes`，
 * 脚本不会说"这枚旗标我不认"，它会照常跑正常扫描、打一句 ✅、退 0。
 * 对一枚自带变异臂的门禁来说，那个形状读起来恰好等于"三臂都过了"。
 */
const ALLOWED_FLAGS = ['--self-test'];
const unknownFlags = process.argv.slice(2).filter((arg) => arg.startsWith('-') && !ALLOWED_FLAGS.includes(arg));
if (unknownFlags.length > 0) {
  console.error(
    `❌ 未知旗标 ${unknownFlags.join(' ')}：本脚本只认 ${ALLOWED_FLAGS.join(' / ')}。` +
      '拼错的旗标若被静默吞掉，脚本会照常判默认那一份并打一句绿（§7 第 605 条）。',
  );
  process.exit(1);
}
const WANT_SELFTEST = process.argv.includes('--self-test');

/** 接保护的唯一入口。 */
const GUARD_CALL = 'useDirtyDismissGuard(';

/** 声明自己是对话框的两条形状。 */
/**
 * "自报对话框"的形状。
 *
 * 🔴 最后一枚 `<WebModalShell` 是 **P6 迁移第一枚时被棘轮逼出来的**（不是顺手加宽）：
 *   `CategoryCreateDialog` 把 `role="dialog"` / `aria-modal` 交给共享壳之后，
 *   这一格从候选集里**消失**了 —— 已接保护读数 5 ⇒ 4，`PROTECTED_FLOOR` 那条立刻红。
 *   那正是这一枚下限存在的理由（见下面注释里预写的失法："形状一变就掉出候选集，
 *   门禁照样绿"）。修的是**扫描器的眼睛**：用壳也算自报对话框，落点一个没少。
 *   ⚠️ 反过来不许把 `PROTECTED_FLOOR` 降到 4 来"解决"这条红 —— 那是拿判据迁就装置。
 */
const DIALOG_PATTERNS = [
  /role="dialog"/,
  /aria-modal="true"/,
  /role='dialog'/,
  /aria-modal='true'/,
  /<WebModalShell\b/,
];

/** 用户可编辑内容的形状。 */
const FIELD_PATTERNS = [/<input\b/, /<textarea\b/, /contentEditable/, /CaptureComposer\b/];

/**
 * 账本。`verified-exempt` 的理由必须是**可证伪的陈述**，不是"这里不需要"。
 */
const LEDGER = [
  {
    file: 'apps/web/src/features/auth/AuthPanel.tsx',
    status: 'verified-exempt',
    reason: '登录/注册/验证码那几格填的是**凭据**，不是用户 authored 的内容：'
      + '凭据按设计不落任何持久层，关掉后重打才是正确行为（给它加"放弃修改？"'
      + '等于把一次重打说成一次损失）。翻案条件：任何一格开始把非凭据的用户输入'
      + '（如昵称、工作区名）放进同一个关闭出口。',
  },
  {
    file: 'apps/web/src/App.tsx',
    status: 'owed',
    reason: '壳文件，里面既有自绘对话框也有输入；要逐格分清"关掉丢不丢 authored 内容"'
      + '才能定档。P1 未逐格核 ⇒ 记欠账，不许读成豁免。',
  },
  {
    file: 'apps/web/src/features/ai/AiCapture.tsx',
    status: 'owed',
    reason: '它内嵌 `CaptureComposer`（草稿在共享组件本地 state）⇒ 形状与日历快速捕获同源；'
      + '要确认这一面的关闭出口是否真的会卸载那个 composer 才能定档。',
  },
  {
    file: 'apps/web/src/features/ai/AssistantPanel.tsx',
    status: 'owed',
    reason: '对话输入框的草稿是否跨开关留存，取决于它住在组件 state 还是会话 store —— 未核。',
  },
  {
    file: 'apps/web/src/features/ai/AiBreakdown.tsx',
    status: 'owed',
    reason: '面板里的输入是一次性参数还是用户 authored 的内容，未逐格核。',
  },
  {
    file: 'apps/web/src/features/ai/AiDuration.tsx',
    status: 'owed',
    reason: '同上：时长参数那一格有输入框，关掉是否算丢内容未核。',
  },
  {
    file: 'apps/web/src/features/ai/AiPrioritize.tsx',
    status: 'owed',
    reason: '同上：输入框存在，关闭出口与内容归属未核。',
  },
  {
    file: 'apps/web/src/features/ai/AiToolRun.tsx',
    status: 'owed',
    reason: '同上：工具入参那一格有输入，关掉是否可恢复未核。',
  },
];

/**
 * 已接保护的下限（**只抬不降的棘轮**，不是"现在有几格"的抄件 —— 现量在每次运行的读数里）。
 *
 * 为什么需要它：账本那 8 格消失会被"过期账本"那一条逮住，而**接了保护的那几格不在任何表上**。
 * 它们只要形状一变（`role="dialog"` 改成别的写法、或输入框搬进子组件），就掉出候选集，
 * 门禁照样绿 ——  coverage 悄悄没了。这一条把那种失法变成一个红。
 */
const PROTECTED_FLOOR = 5;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function matches(source, patterns) {
  return patterns.some((pattern) => pattern.test(source));
}

/** 现量：这一棵树里有哪些"自报对话框 + 有输入"的落点。 */
function scan() {
  const candidates = [];
  for (const full of walk(SRC_DIR)) {
    const source = readFileSync(full, 'utf8');
    if (!matches(source, DIALOG_PATTERNS) || !matches(source, FIELD_PATTERNS)) continue;
    candidates.push({
      file: relative(ROOT, full).split('\\').join('/'),
      wired: source.includes(GUARD_CALL),
    });
  }
  return candidates.sort((a, b) => a.file.localeCompare(b.file));
}

function check(candidates) {
  const problems = [];
  const seen = new Set();
  for (const candidate of candidates) {
    seen.add(candidate.file);
    if (candidate.wired) continue;
    const entry = LEDGER.find((item) => item.file === candidate.file);
    if (entry === undefined) {
      problems.push(
        `${candidate.file}：自报对话框、里面有用户输入，却没接 \`useDirtyDismissGuard\`，`
        + '也不在账本里。要么接上保护，要么写一条**可证伪**的条目（不许把没核过的写成豁免）。',
      );
    }
  }
  for (const entry of LEDGER) {
    if (!existsSync(join(ROOT, entry.file))) {
      problems.push(`账本条目 ${entry.file} 在当前树上已经找不到 —— 登记过期，删掉它或把文件补回来。`);
      continue;
    }
    if (!seen.has(entry.file)) {
      problems.push(
        `账本条目 ${entry.file} 不再是候选（形状变了？）：它现在既没有自报对话框、`
        + '也没有输入控件。条目要么删掉，要么判据本身失效了。',
      );
    }
  }
  return problems;
}

/**
 * coverage 那一条单独成函数，而不是塞进 `check()`：
 * `check()` 的自证臂要喂只有 1~2 格的合成树，那一棵树当然够不到下限 —— 把两件事
 * 混在一个返回值里，臂 ② 会红在"合成树太小"上（这就是第一版踩的那个坑）。
 */
function coverageProblems(candidates) {
  const wiredNow = candidates.filter((candidate) => candidate.wired).length;
  if (wiredNow >= PROTECTED_FLOOR) return [];
  return [
    `已接脏表单保护的落点只剩 ${wiredNow} 格，低于下限 ${PROTECTED_FLOOR}：`
    + '要么保护被摘了，要么那一格的形状掉出了候选集（判据没跟上）。两种都得查，不许抬下限。',
  ];
}

/**
 * 变异自证：四臂。少了它们，这条门禁可能"永远绿"却什么都没测。
 *  ① 未接保护且账外 ⇒ 红；② 同一棵树只翻 `wired` 位 ⇒ 绿；③ 空树 ⇒ 过期账本必须红；
 *  ④ 保护格数掉到下限以下 ⇒ 红，且达到下限时必须绿（配对）。
 *
 * ①/② 是**配对臂**：候选集完全相同，只差那一枚 `wired` 布尔。
 * 第一版把 ② 写成了"只塞一个已接保护的假文件"，于是账本里那 8 格在这棵假树上
 * 全部读成"不再是候选"，臂 ② 红 —— 红的是夹具不是判据，而这两件事在只有一条
 * ✓/✗ 的读数里长得一模一样。配对之后，②的绿只能来自"wired 位被认下来了"。
 */
function selftest() {
  // 基座 = 账本里的每一格（都不算已接保护），让第二遍循环在两种情形下都无话可说，
  // 把唯一的变量留给下面那一格假文件。
  const base = LEDGER.map((entry) => ({ file: entry.file, wired: false }));
  const fixture = 'apps/web/src/features/x/DirtyFormDialog.tsx';
  const unwired = check([...base, { file: fixture, wired: false }]);
  const wired = check([...base, { file: fixture, wired: true }]);
  const armed = unwired.length === 1 && unwired[0].includes(fixture);
  const clean = wired.length === 0;
  const stale = check([]).filter((line) => line.includes('不再是候选') || line.includes('已经找不到'));
  const fakeWired = (n) => Array.from({ length: n }, (_, i) => ({ file: `apps/web/src/features/x/F${i}.tsx`, wired: true }));
  const below = coverageProblems(fakeWired(PROTECTED_FLOOR - 1)).length === 1;
  const atFloor = coverageProblems(fakeWired(PROTECTED_FLOOR)).length === 0;
  const realWired = candidates.filter((candidate) => candidate.wired).length;
  const results = [
    { arm: `① 未接保护且账外 ⇒ 只红这一格（读数 ${unwired.length}）`, pass: armed },
    { arm: `② 同一棵树只翻 wired 位 ⇒ 必须绿（读数 ${wired.length}）`, pass: clean },
    { arm: `③ 空树 ⇒ 过期账本必须红（${stale.length}/${LEDGER.length} 格）`, pass: stale.length === LEDGER.length },
    { arm: `④ 保护棘轮：${PROTECTED_FLOOR - 1} 格红 / ${PROTECTED_FLOOR} 格绿（当前树 ${realWired}）`, pass: below && atFloor && realWired >= PROTECTED_FLOOR },
  ];
  for (const result of results) {
    console.log(`${result.pass ? '✓' : '✗'} 自证臂 ${result.arm}`);
  }
  if (results.some((result) => !result.pass)) {
    console.error('❌ 脏表单门禁的判据自己失效了（上面那臂红）—— 这条检查没有价值。');
    process.exit(1);
  }
  console.log(`✅ 四臂都能按预期红/绿。`);
}

const candidates = scan();
const wiredCount = candidates.filter((candidate) => candidate.wired).length;
const exempt = LEDGER.filter((entry) => entry.status === 'verified-exempt').length;
const owed = LEDGER.filter((entry) => entry.status === 'owed').length;
console.log(
  `脏表单门禁：候选 ${candidates.length} 格（已接保护 ${wiredCount}、`
  + `账内已核实豁免 ${exempt}、**账内欠判定 ${owed}**）。`,
);

if (WANT_SELFTEST) {
  selftest();
  process.exit(0);
}

const problems = check(candidates).concat(coverageProblems(candidates));
if (problems.length > 0) {
  for (const problem of problems) console.error(`❌ ${problem}`);
  process.exit(1);
}
console.log('✅ 每一格自报对话框 + 有输入的落点，要么接了保护，要么在账上。');
