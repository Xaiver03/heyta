#!/usr/bin/env node
/**
 * 设置界面**禁止内联说明文字**的门禁（2026-10-24，产品负责人下的禁令）
 * ==================================================================
 *
 * 原话（两次，第二次已经很生气）：
 *
 * > 「严禁说明文字出现，严禁说明文字直接写进去。只允许用那种"一个圈里面一个问号"
 * >   的，hover 上去有。把这种东西写成严格的代码禁令……彻底禁止！」
 *
 * 所以这道门不算"建议"，它是**禁令**：设置界面里**不许**出现解释性段落。
 * 解释只有一种合法载体 —— 一个圈里的问号（`SettingsInfoTip`，web）/ `InfoTip`（mobile），
 * 悬停或聚焦才展开。标题旁边、开关旁边、输入框旁边放一圈问号，是唯一形状。
 *
 * ## 为什么是一道账本门禁而不是一次性清理
 *
 * 现存量很大（见账本 `scripts/settings-prose-ledger.json`）。一次改完 95+ 处，
 * 会把"删除说明文字"和"重写每个控件"混成一次几百行的改动 —— 那种改动的判据
 * 只有"跑起来了"，而这条禁令要的是**逐屏可读**。
 *
 * 所以账本制，三条判据（与 `check:overlay` 同一条纪律）：
 *
 *   ① 账本**外**出现 ⇒ 🔴 红。新写的说明文字一天都进不来。
 *   ② 账本里某文件读数**涨了** ⇒ 🔴 红。
 *   ③ 账本里读数**掉了却没改账本** ⇒ 🔴 红。这一条看着像找茬，但它是
 *      "这道门真的在缩"的唯一读数 —— 没有它，账本会永远停在第一天。
 *
 * ## 什么算"说明文字"（判据的边界，写清楚才好反驳）
 *
 * 算：
 *   · `ht-settings__hint` / `ht-settings__note` / `ht-settings__lead` 三种容器；
 *   · `@heyta/ui` 的 `SettingsSection note=`（那就是一整句说明）；
 *   · 移动端行模型里的 `hint:` 字段。
 *
 * 不算（**反馈**，不是解释）：
 *   · 失败 / 成功 / 进行中的状态句（`role="alert"`、`aria-live`、`__danger`、
 *     testid 里带 failure/error/status/notice/warn 的那些）——
 *     把"这一单没下成"塞进问号气泡里是另一种错误：用户得点一下才知道出了什么事。
 *   · 计费/额度的**读数**（`ai-managed-usage` 那种 300 次）—— 那是数据，不是解释。
 *
 * 用法：
 *   node scripts/check-settings-no-prose.mjs             # 判定
 *   node scripts/check-settings-no-prose.mjs --update    # 按当前读数重写账本（只许变小）
 *   node scripts/check-settings-no-prose.mjs --json      # 机器可读
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const LEDGER = join(ROOT, 'scripts/settings-prose-ledger.json');

/**
 * 被禁的容器：`ht-settings__` 后面**任何**含 hint / note / lead 的段落名。
 *
 * 🔴 2026-10-24 晚改宽了一次：原来列的是四个确切的类名，于是
 * `ht-settings__data-card-lead`（数据管理那两张卡的副句）从缝里漏了过去 ——
 * 用户第二次发火时截的正是那一屏。按"名字里带这三个词就算"来判，
 * 新长的 `__xxx-note` 就漏不掉了。
 *
 * ⚠️ `SettingsNotice` **不**在这条判据里：它曾经是最大的那一面墙
 * （`⚠️ 需要一台空设备` 下面跟一整句），但 2026-10-24 起**组件自己**把正文放进了 `?`
 * （`SettingsNotice.tsx` 的 `detailInTip`）—— 判据落在组件里，调用点就合法了。
 * 只有 `live` / `danger` / `success` 三种才直接显示正文，那是反馈。
 */
const BANNED_CLASS = /ht-settings__[a-z0-9-]*(hint|note|lead)[a-z0-9-]*/u;

/**
 * ⚠️ 移动端行模型的 `hint:` **现在合法**（2026-10-24 晚）：`@heyta/ui` 的
 * `SettingsRow` 已经把 `hint` 交给 `SettingsInfoTip` 渲染（点一下才展开），
 * 也就是"一行一句说明"那面墙在**组件里**被拆掉了。判据跟着落在组件上，
 * 调用点再判一次只会逼人把它挪进本地 state。
 */

/** 产品/法务要求**必须直接可见**的披露（ADR-0054 §7 的出境披露在这里）。 */
const DISCLOSURE_MARKER = 'data-settings-disclosure';

/** 反馈允许标记：出现任意一个，这一处就是"状态"而不是"说明"。 */
const FEEDBACK_MARKERS = [
  'role="alert"',
  "role='alert'",
  'aria-live',
  'ht-settings__danger',
  'ht-settings__status',
  'ht-settings__sub-status',
  'data-testid="renew-failure"',
  'failure',
  'error',
  'notice',
  'warn',
  'status',
  'pending',
  'busy',
];

/** 设置壳（App.tsx 里那一节的开头说明也算"说明文字"）。 */
const SCAN_FILES = ['apps/web/src/App.tsx'];

const SCAN_ROOTS = [
  'apps/web/src/features/settings',
  'apps/web/src/features/subscription',
  'apps/web/src/features/sync',
  'apps/web/src/features/privacy',
  'apps/mobile/src/screens',
  'packages/ui/src/settings',
];

/** 文件清单走 git（被跟踪 + 未跟踪的新文件都要算，否则新文件可以绕过账本）。 */
function listFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((p) => /\.(tsx|ts)$/u.test(p))
    .filter(
      (p) => SCAN_FILES.includes(p) || SCAN_ROOTS.some((root) => p.startsWith(`${root}/`)),
    );
}

/** 去掉注释：注释里写"这里不许有说明文字"是在描述纪律，不该被判红。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => m.replace(/[^\n]/gu, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/gu, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 找一处违规：容器类名或移动端 `hint:`，且窗口里没有反馈标记。 */
function findViolations(text) {
  const lines = stripComments(text).split('\n');
  const hits = [];
  const isMobileRowHint = (line) => /^\s*hint:\s*/u.test(line);

  lines.forEach((line, index) => {
    const banned = BANNED_CLASS.exec(line)?.[0];
    const mobileHint = false;
    if (banned === undefined && !mobileHint) return;

    // 反馈标记：这一行前后 6 行里任意一个 —— JSX 的属性常写在上一行。
    const windowText = lines.slice(Math.max(0, index - 6), index + 7).join('\n');
    const isFeedback = FEEDBACK_MARKERS.some((marker) => windowText.includes(marker));
    if (isFeedback) return;
    // 披露：ADR-0054 §7 要求"对话之前就看得到"，藏进问号气泡就不再是披露。
    if (windowText.includes(DISCLOSURE_MARKER)) return;

    // 移动端的 `hint:` 只在**行模型字面量**里算违规；`hint` 作为类型字段名不算。
    if (mobileHint && !/row=\{\{|readonly hint|SettingsRowModel/u.test(windowText)) {
      // 允许 `hint:` 出现在类型定义/接口里（那是形状，不是文案）。
      if (/interface |readonly |: string;/u.test(line)) return;
    }

    hits.push({ line: index + 1, text: line.trim().slice(0, 120), kind: banned ?? 'hint' });
  });
  return hits;
}

const files = listFiles();
const counts = {};
const details = [];
for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const hits = findViolations(text);
  if (hits.length > 0) {
    counts[file] = hits.length;
    details.push({ file, hits });
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, 'utf8'))
  : { total: 0, files: {} };
const ledgerTotal = Object.values(ledger.files).reduce((a, b) => a + b, 0);

const wantsUpdate = process.argv.includes('--update');
const wantsJson = process.argv.includes('--json');

if (wantsUpdate) {
  // 首次建账：账本还不存在时从 0 起。
  const firstLedger = !existsSync(LEDGER);
  /*
   * 允许**判据变严**带来的重算，但必须写明理由：
   *   `--update --rebaseline "把 data-card-lead 那一族也纳进来"`
   * 没有理由就涨不了 —— 否则"账本只许变小"会变成一句空话
   * （改一下正则就能让 12 处欠账凭空消失，反向也一样）。
   */
  const rebaselineIndex = process.argv.indexOf('--rebaseline');
  const reason = rebaselineIndex === -1 ? undefined : process.argv[rebaselineIndex + 1];
  const next = { total, files: counts, ...(reason === undefined ? {} : { rebaseline: reason }) };
  if (!firstLedger && total > ledgerTotal && reason === undefined) {
    console.error(
      `🔴 账本只许变小：现值 ${total} ＞ 账本 ${ledgerTotal}。` +
        '\n   先把新写的说明文字换成问号气泡（`SettingsInfoTip` / `InfoTip`），再回来改账本。' +
        '\n   如果涨是因为**判据变严**，加 `--rebaseline "理由"` 重算。',
    );
    process.exit(1);
  }
  writeFileSync(LEDGER, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✅ 账本已更新：${ledgerTotal} → ${total}（${Object.keys(counts).length} 个文件）`);
  process.exit(0);
}

if (wantsJson) {
  console.log(JSON.stringify({ total, ledgerTotal, counts, details }, null, 2));
  process.exit(0);
}

const problems = [];
for (const [file, count] of Object.entries(counts)) {
  const recorded = ledger.files[file];
  if (recorded === undefined) {
    problems.push(`  🔴 账本外的新说明文字：${file}（${count} 处）`);
  } else if (count > recorded) {
    problems.push(`  🔴 ${file}：${recorded} → ${count}（涨了）`);
  } else if (count < recorded) {
    problems.push(`  🔴 ${file}：${recorded} → ${count}（掉了却没改账本，跑 --update）`);
  }
}
for (const [file, recorded] of Object.entries(ledger.files)) {
  if (counts[file] === undefined) {
    problems.push(`  🔴 ${file}：账本记着 ${recorded} 处，现在一处都没有了（改账本）`);
  }
}

if (problems.length > 0) {
  console.error('🔴 设置界面禁止内联说明文字：账本对不上。\n');
  console.error(problems.join('\n'));
  console.error(
    '\n改法（二选一）：\n' +
      '  · 把它换成问号气泡：web 用 `SettingsInfoTip`（`ht-settings__tip`），移动端用 `InfoTip`；\n' +
      '  · 若它其实是**反馈**（失败/成功/进行中），给它 `role="alert"` 或 `aria-live`，\n' +
      '    并在 testid 里带上 failure/error/status —— 反馈不是说明，允许直接写。',
  );
  process.exit(1);
}

if (total === 0) {
  console.log(
    '✅ 设置界面里一句内联说明文字都没有：全部走「?」（2026-10-24 禁令已清到 0）。' +
      `\n   账本 ${relative(ROOT, LEDGER)} 记着 0 处；再写回来就是红的。`,
  );
} else {
  console.log(
    `✅ 设置界面没有新增内联说明文字：${total} 处（账本 ${ledgerTotal}，${Object.keys(counts).length} 个文件）。` +
      `\n   这 ${total} 处是待清理的存量 —— 数字只许变小（${relative(ROOT, LEDGER)}）。`,
  );
}
