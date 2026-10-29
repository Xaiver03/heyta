#!/usr/bin/env node
/**
 * 工作树例外归属尺：把"只剩明确登记的例外，并写清为什么"这句话变成能失败的东西。
 * =================================================================
 *
 * ## 它拦哪一种事故
 *
 * 共享检出上长期有一批**不属于本会话**的未提交改动（别的会话正在写）。台账对此的写法是
 * "登记过的例外"，但那句是散文：脏集的成员**每分钟在换**（实测：一张逐枚归属表写成 4 分钟后
 * 就被现实改了两次），于是下一位只能重新人肉分一遍，而"人肉分一遍"这件事从来没有判据。
 * 这枚尺把分类本身钉下来：每一枚未提交的路径必须命中一条**带理由**的登记规则，
 * 命不中就是"没登记过的例外" —— 那才是本仓真正想拦的东西。
 *
 * ## 第二判：跨线依赖（归属表看不出来的那一类）
 *
 * 按路径归属会把一条线切成几堆，但**提交是按堆提的，import 是按文件解析的**。
 * 2026-10-28 实测到的形状：一枚已跟踪、已改动的界面文件 import 了一枚**还没进仓库**的新模块，
 * 而那枚新模块按路径归在**另一条线**的堆里 —— 于是"每一枚都登记了"这句完全成立，
 * 单独提交日历那一堆照样把 HEAD 提成半棵树（下一位拿到的是"代码引用一个仓库里没有的模块"）。
 * 所以除了归属，还须逐枚问：它引用的东西在 HEAD 里有没有？
 *
 * ## 为什么默认不红
 *
 * 它读的是**工作树状态**，不是仓库内容：干净检出上工作树必然为空，硬把它塞进 `check` 链
 * 只会得到一枚恒绿的门（比没有门更糟）。所以它是一条**给人跑的读数**，`--strict` 才把
 * "未登记"变成非零退出。
 *
 * ## 用法
 *
 *   node scripts/check-worktree-exceptions.mjs           # 逐条归属 + 点名未登记的 + 点名跨线依赖
 *   node scripts/check-worktree-exceptions.mjs --strict  # 有未登记**或**有跨线依赖 ⇒ exit 1
 *   node scripts/check-worktree-exceptions.mjs --self-test
 *   node scripts/check-worktree-exceptions.mjs --head --range b55e98807  # 第三判：那一笔以来落进 HEAD 的改动，自己是不是半棵树（只读对象库）
 *
 * 规则表住在脚本里，登记正文（每一行为什么不归本线）在 `BLOCKED.md` 那张「归谁 / 为什么不由我代提交」的表里。
 * 🔴 这里**不写 B 号，也不写撞号枚数**：2026-10-28 发现 BLOCKED.md 里有同号开出两节的（其中一枚正是 B232），
 *   按号引用等于指错地方 —— 我自己就错过一次（原先这两行写「见 B238 那一节」，而那一号讲的是 macOS 窗口门）。
 *   定位只用形状：`grep -n '^| 归谁 |' BLOCKED.md`；撞号现量另有探针
 *   `node research/tools/audit-blocked-number-collisions.mjs`（分母与视力臂自己打印）。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALLOWED_FLAGS = ['--strict', '--self-test', '--head', '--range <ref>'];

/**
 * 每条规则 = 一行归属 + 它凭什么这么归。
 * 前缀规则以 `/` 结尾表示**目录**；不带 `/` 的必须是完整路径（防"路径清单里混进目录"那一类坏条目）。
 */
export const OWNER_RULES = [
  {
    line: '全局 UX 分层整改线',
    why: '计划自写"状态：进行中"、尺还是未跟踪件、`package.json` 那两行要和它的脚本同一笔才不自相矛盾；' +
      '01:1x 又并进一批 P2 的（危险确认档位、`apps/web/src/lib/dialog/`）—— 那批文件的头注释自己写着「2026-10-27，全局 UX 整改 P2」，归属是指了名的，不是我猜的',
    prefixes: [
      'apps/web/src/styles/app/',
      'packages/design-system/generated/',
      'packages/design-system/src/generated/',
      'packages/design-system/src/tokens.css',
      'packages/design-system/src/tokens.ts',
      'packages/ui/src/overlay/',
      'apps/web/src/lib/form/',
      'packages/i18n/src/locales/',
      'apps/web/evidence/focus-visible-matrix/',
      'docs/agents/ux-principles.md',
      'docs/plans/global-ux-system-remediation.md',
      'docs/plans/README.md',
      'e2e/tests/focus-visible-matrix.spec.ts',
      'e2e/tests/rail-geometry.spec.ts',
      'e2e/tests/rail-roving.spec.ts',
      'e2e/tests/dirty-form-guard.spec.ts',
      'packages/ui/tests/overlay-dirty-popover.spec.ts',
      'scripts/check-focus-single-source.mjs',
      'scripts/check-dirty-form-policy.mjs',
      'docs/agents/overlay-feedback.md',
      'apps/web/evidence/dirty-form-guard/',
      'apps/web/src/features/categories/CategoryCreateDialog.tsx',
      'apps/web/src/features/habits/HabitsView.tsx',
      'apps/web/src/lib/dialog/',
      'apps/web/src/features/trash/TrashView.tsx',
      'apps/web/src/features/trash/purgeDanger.ts',
      'apps/web/tests/trash-purge-danger-tier.spec.ts',
      'e2e/tests/danger-confirm-trash.spec.ts',
      'scripts/check-danger-confirm.mjs',
      // 01:3x 这一批：撤销设备那一格（文件头自己写「2026-10-27，全局 UX 整改 P2 第二格」，
      // 并被 VaultSettingsPanel 引、被 app.css 带进 danger-confirm.css —— 归属有原文，不是我猜的）
      'apps/web/src/features/sync/deviceRevocationDanger.ts',
      'apps/web/src/features/sync/VaultSettingsPanel.tsx',
      'apps/web/src/styles/app.css',
      'e2e/tests/vault-settings.spec.ts',
      'apps/web/evidence/danger-confirm/',
      // 04:1x 这一批（撤销回执那一族）。归属同样有原文，三条各自独立：
      //   · `scripts/check-undo-receipt.mjs` 头注释第一行写「撤销回执门禁（全局 UX 线 P3）」，
      //     `packages/ui/src/feedback/receipt-timing.ts` 与 `packages/ui/src/index.ts` 新增段都写「2026-10-28，全局 UX 线 P3」；
      //   · `e2e/tests/quadrant-move-ux.spec.ts` 自己写「🔴 2026-10-28（全局 UX 线 P3）：那一枚撤销按钮现在住在共享的 `UndoReceipt` 里」；
      //   · 四枚界面文件（HabitDetailCard / NotesView / ProjectsPanel / QuadrantBoard）没写日期，
      //     但**本尺第二判的跨线依赖那一格**报出它们 import 了未入库的 `apps/web/src/lib/feedback/UndoReceipt.tsx` ⇒ 同一族；
      //     `TasksScreen.tsx` 由 `packages/ui/src/index.ts` 那段点名"移动端渲染归这一行"。
      'apps/web/src/lib/feedback/',
      'packages/ui/src/feedback/',
      'apps/web/tests/undo-receipt.spec.tsx',
      'packages/ui/tests/feedback-receipt-timing.spec.ts',
      'scripts/check-undo-receipt.mjs',
      'packages/ui/src/index.ts',
      'scripts/check-overlay.mjs',
      'e2e/tests/habit-create-options.spec.ts',
      'e2e/tests/quadrant-move-ux.spec.ts',
      'apps/mobile/src/screens/TasksScreen.tsx',
      'apps/web/src/features/habits/HabitDetailCard.tsx',
      'apps/web/src/features/notes/NotesView.tsx',
      'apps/web/src/features/projects/ProjectsPanel.tsx',
      'apps/web/src/features/quadrant/QuadrantBoard.tsx',
      'apps/web/evidence/undo-receipt/',
      // 10-28 10:0x 又一族（P4 交互控件状态）：`packages/ui/tests/control-states.spec.ts` 头一行写
      // 「`control/states.ts` 的契约 —— 全局 UX 线 P4」，`packages/ui/src/control/states.ts` 的 mtime 距当时 47 秒（正在写）。
      // 🔴 顺带记一条**别动手**的现场事实：那一分钟里该目录还躺着一枚 `states.ts.mut-bak`，几分钟后自己消失了 ——
      //   那是他们变异台架的还原备份（本仓纪律：还原只从 `.mut-bak` 取，不从 git 取），**不是残渣**。
      //   按"清理未跟踪文件"的直觉把它删掉，就会在别人下一次还原时把人家的母本删了 ⇒ 这一族里任何 `*.mut-bak` / `*.teeth-bak` 都不许碰。
      'packages/ui/src/control/',
      'packages/ui/tests/control-states.spec.ts',
      // 10-29 12:0x 这一族（P2 剩的那格「未判定」被判掉了）：`resetAiDanger.ts` 文件头自己写
      // 「2026-10-29，把 P2 登记的那格『未判定』判掉」，`AiSettings.tsx` 是接它的那一枚（`grep -c resetAiDanger apps/web/src/features/settings/AiSettings.tsx` 现量 2 处）
      'apps/web/src/features/settings/resetAiDanger.ts',
      'apps/web/src/features/settings/AiSettings.tsx',
      // 12:2x 这枚跟着上面那一族：新增的 describe 头自己写「§P2 那格未判定的裁决，2026-10-29」，
      // 断言的对象就是 `resetAiDanger` 画的那层（`data-testid="reset-ai-confirm"`），不是本线一行
      'apps/web/tests/ai-settings.spec.tsx',
      // 10-29 10:3x 这一族（P6 关闭策略表的最后一格）：两枚文件的注释各写
      // 「这一档是为『隐私单独同意 / 条款再确认』这两层新加的（全局 UX 线 P6 的最后一格）」与
      // 「『关掉不等于同意』的可判红版本（全局 UX 线 P6 最后一格的产品口径）」
      'packages/ui/tests/overlay-dismissal-model.spec.ts',
      'e2e/tests/consent-defer.spec.ts',
      'package.json',
    ],
  },
  {
    line: '各线共用的取证账本（BLOCKED.md）',
    why: '它归所有人，不归任何一个人：2026-10-28 现量是"我编辑的那一分钟里它被别的会话加了 79 行"。' +
      '我只用 plumbing 提我写的那几行，所以工作树那一版**必然**长期含别人没提交的内容 ⇒ 未提交不是漏归，是这本账的用法。' +
      '反过来说：把它登记成"某条线的改动"才是错的——那等于替别人认领。',
    prefixes: ['BLOCKED.md'],
  },
  {
    line: '自动收集（inbound）线',
    why:
      '这条线的代码自己指名 ADR-0077 与托管抽取那一档；10-28 00:5x 现量：`inbound.routes.ts` 与那份 integration spec 正在改，' +
      '而 §6.101 那四格待拍板（同意继承、reasonCode 落库、词表校验分叉）全落在这一层 —— 代提交 = 替别人把未定的口径落仓',
    prefixes: [
      'packages/inbound-core/',
      'server/src/automation/',
      'server/src/ai/managed-completion.ts',
      'server/tests/integration/inbound-dual-host-fault-windows.integration.spec.ts',
      // 10-28 10:0x 现量这一枚正在改：新加的注释自己点名「变异臂 A16」「托管档那两张表该一次都不被写」，
      // 那是这条线自己的判据与自己的台架，不是别人顺手改的测试。
      'server/tests/inbound-hosted-extraction.spec.ts',
      'docs/plans/inbound-automation.md',
      'docs/adr/0077-inbound-hosted-extraction-at-ingest.md',
    ],
  },
  {
    line: '各线共用的环境陷阱正文',
    why: '编号只增不改、谁踩坑谁追加：这一枚文件在脏集里只说明"某一行的正文还没入库"，作者随时在补；代提交 = 把别人未定稿的正文按我的名义落仓',
    prefixes: ['docs/reference/environment-traps.md'],
  },
  {
    line: '日历/详情面线',
    why:
      '壳里那一支、工具栏新引的图标、spec 里新的 testid 连成一条还没接完的线；提两枚留一枚 = 用例引用一个界面里不存在的控件。' +
      '🔴 2026-10-28 现量还多一条硬前提：`CalendarCapturePopover.tsx`（已跟踪）import 的 `apps/web/src/lib/form/useDirtyDismissGuard.tsx` **没入库**，' +
      '而那枚 hook 按路径归在 UX 线那一堆 —— 本组单独入库必然留下"代码引用仓库里没有的模块"（第二判会点名它）',
    prefixes: ['apps/web/src/App.tsx', 'apps/web/src/features/calendar/', 'e2e/tests/calendar-cells.spec.ts'],
  },
  {
    line: '不是任何人的改动：已入库截图被门禁重写',
    why: '谁在这棵树上跑截图类门禁，已入库的那批 PNG 就被重写一次（traps #602）；代提交 = 把别人那一趟运行的产物按我的名义落仓。' +
      '🔴 这条**只吃已跟踪件的修改**（`skipUntracked`）：`apps/web/evidence/` 下新出现的文件是作者准备入库的真证据，' +
      '必须留在"没登记过"那一栏被点名 —— 按机制登记和按目录穷举的分别是：前者不随跑门禁的次数漂' +
      '。⚠️ 2026-10-29 补一刀，因为它改变"该怎么收"：这批脏 PNG 的 mtime 全落在 10-28 18:2x–20:0x，' +
      '而 10-28 20:19 / 20:38 / 20:45 与 10-29 11:40 又有四笔**会改像素**的 UI 提交落库' +
      '（`git log --since=<拍照时刻> --oneline -- apps/web/src packages/ui/src packages/design-system`）' +
      '⇒ 未提交那一版与 HEAD 那一版**都比当前产品旧**，谁替谁收都等于把过期证据再钉一次。' +
      '正解是改 UI 的那条线重跑矩阵再随自己那笔提交；本尺不判这层"证据 vs 产品"的新鲜度（现量只到 mtime 比对，见台账 §6.116）',
    prefixes: ['apps/web/evidence/'],
    skipUntracked: true,
  },
  {
    line: '协作/同意面线',
    why: '同意面的四行条款与 ⓘ 触发件正在改（它自己写在这次未提交的 diff 里：那枚 `Pressable` 正则从文件第一枚起手 ⇒ 一枚永远绿的判据，正配着 `press-channel-gone-mobile` 那发变异臂在修）；这条线上还有三端共用的 i18n 同意面词条',
    prefixes: [
      'apps/mobile/tests/share-ui-assembly.spec.ts',
      'apps/mobile/src/screens/ShareSpaceScreen.tsx',
      'apps/mobile/src/screens/JoinShareScreen.tsx',
      'apps/web/src/features/share/',
      'packages/ui/src/sync/',
      'apps/web/tests/share-consent-modal-theme.spec.tsx',
      'e2e/tests/collab-journey.spec.ts',
      'scripts/verify-collab-journey.mjs',
      'scripts/verify-mobile-collab-ios.sh',
    ],
  },
  {
    line: '自托管分发 / Windows 打包那一条线在飞的这一族',
    why: '三枚改动都指向同一个新落点：`research/tools/selfhost-windows-sync-arms.mjs`、`scripts/reinstall-all.sh`、' +
      '`scripts/verify-windows-shell-journey.mjs` 的加行都在接 `scripts/lib/sync-build-sources.sh`（那枚 lib 已在 HEAD，现量 ' +
      '`git cat-file -e HEAD:scripts/lib/sync-build-sources.sh`），是同一次重构的三条腿，提一条红两条。' +
      '仓根那批 `.run-arms-*.txt` 是他们跑批的临时日志（现量形状见文件第一行"载具闸门 …不是零脏"），' +
      '既不是产物也不该入库 —— 登记它只为让"未登记栏"读得出真例外，删与不删归作者（不是本会话创建的对象，不动）',
    prefixes: ['research/tools/selfhost-windows-sync-arms.mjs', 'scripts/reinstall-all.sh', 'scripts/verify-windows-shell-journey.mjs', '.run-arms-*.txt'],
  },
  {
    line: '别线的变异台架（research/tools/mutation-rigs/）',
    why: '台架改的是它自己的判据臂，作者正在按读数调臂；这类文件的"对不对"只有那条线能判',
    prefixes: ['research/tools/mutation-rigs/'],
  },
  {
    line: '本线（注册登录标准套件线）在飞的这一笔',
    why:
      '这枚尺和它配套的台账正文，写它的那一刻必然在脏集里 —— 登记它不是"我的改动不用入库"，' +
      '是让"没登记过的例外"那一栏只报真正没人认领的路径（收口后本行应读 0 枚）。' +
      '`BLOCKED.md` **故意不进来**：它是几条线共用的取证账本，登记成"我的"会把别人没提交的那行一起洗掉',
    prefixes: ['scripts/check-worktree-exceptions.mjs', 'docs/plans/account-standard-suite.md', 'scripts/live-web-freshness.mjs'],
  },
];

export function parseArgs(argv) {
  const out = { strict: false, selfTest: false, head: false, range: undefined };
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strict') out.strict = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--head') out.head = true;
    else if (a === '--range') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) unknown.push('--range（少了 ref）');
      else {
        out.range = v;
        i += 1;
      }
    } else unknown.push(a);
  }
  return { ...out, unknown };
}

/**
 * 一条规则前缀怎么吃下一枚路径。
 * 🔴 带 `*` 的写法只许用在**一个路径段内**：`*` 展开成 `[^/]*`，所以 `.run-arms-*.txt`
 *   命中仓根那批跑批日志，但**不会**跨目录去命中 `docs/run-arms-x.txt`（跨段匹配等于把别的线的
 *   同名文件也认领走，那正是这张表最不能犯的错）。逐枚列 19 条路径则是一份会漂的抄件 ——
 *   作者每跑一轮就会多一枚或少一枚日志。
 */
export function matchPrefix(file, p) {
  if (p.endsWith('/')) return file.startsWith(p);
  if (!p.includes('*')) return file === p;
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
  return re.test(file);
}

/** 规则表自检：目录前缀必须带斜杠、每条必须带理由。坏规则会让整把尺假绿，所以先判尺。 */
export function auditRules(rules) {
  const bad = [];
  for (const r of rules) {
    if (!r.why || String(r.why).trim().length < 12) bad.push(`${r.line}：理由缺失或过短`);
    for (const p of r.prefixes) {
      if (p.endsWith('/') && !path.posix.extname(p.slice(0, -1))) continue; // 目录规则
      if (p.includes('*')) {
        // 通配规则必须落在某个具体段里，且不能整段就是一个 `*`（那等于"什么都认领"）。
        if (/^\*/.test(p) || /\*$/.test(p) || p.split('/').some((seg) => seg === '*')) bad.push(`${r.line}：通配前缀 ${p} 形状不合（首尾裸星号或整段星号＝会跨段认领）`);
        continue;
      }
      if (path.posix.extname(p) === '') bad.push(`${r.line}：前缀 ${p} 既不是目录（缺尾斜杠）也不是带扩展名的文件`);
    }
  }
  return bad;
}

export function parsePorcelain(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => ({ xy: l.slice(0, 2), file: l.slice(3).split(' -> ').pop() }));
}

export function classify(entries, rules, worktreeDirty = null) {
  const rows = [];
  for (const e of entries) {
    // 🔴 索引旧内容 ≠ 未提交的改动。并行会话在 t0 `git add` 了一枚文件、我在 t1 把它改进并入库之后，
    // `git status` 会给这枚文件打 `MM` —— 而**工作树对 HEAD 是干净的**，脏的只是索引那一格。
    // 把它算进"没登记过的例外"会造出一枚假例外（2026-10-28 现量：`scripts/check-gate-wiring.mjs` 就这么进了未登记栏）。
    // 判据是机制而不是路径名：`git diff HEAD --name-only` 里有没有这枚路径。
    const indexOnly = worktreeDirty !== null && !e.xy.includes('?') && !worktreeDirty.has(e.file);
    const hit = indexOnly
      ? null
      : rules.find(
          (r) =>
            r.skipUntracked && e.xy.includes('?') ? false : r.prefixes.some((p) => matchPrefix(e.file, p)),
        );
    rows.push({ ...e, line: hit ? hit.line : null, indexOnly });
  }
  const indexOnlyRows = rows.filter((r) => r.indexOnly);
  return {
    rows,
    unattributed: rows.filter((r) => !r.line && !r.indexOnly),
    indexOnly: indexOnlyRows,
    byLine: rules.map((r) => ({ line: r.line, n: rows.filter((x) => x.line === r.line).length })),
    checked: rows.length,
  };
}

/** `git ls-files -s -z` ⇒ Map(路径 → 索引那一格的 blob)。行形状 `<mode> <sha> <stage>\t<路径>`。 */
export function parseLsFilesStage(text) {
  const out = new Map();
  for (const rec of text.split('\0')) {
    if (rec === '') continue;
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(' ');
    if (meta.length < 3) continue;
    if (meta[2] !== '0') continue; // 合并中的条目（stage 1/2/3）不在这一栏的射程里
    out.set(rec.slice(tab + 1), meta[1]);
  }
  return out;
}

/** `git ls-tree -r -z <ref>` ⇒ Map(路径 → 那一版的 blob)。行形状 `<mode> blob <sha>\t<路径>`。 */
export function parseLsTree(text) {
  const out = new Map();
  for (const rec of text.split('\0')) {
    if (rec === '') continue;
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).split(' ');
    if (meta.length < 3) continue;
    out.set(rec.slice(tab + 1), meta[2]);
  }
  return out;
}

/**
 * 「索引里躺着一版谁都不在看的东西」⇒ 不带 pathspec 的 `git commit` 会把它直接写进历史。
 * 判据是**三版之间的关系**，不是 `git status` 那两个字符，也不是路径名：
 *
 *     索引 ≠ HEAD 且（工作树已没这枚文件 或 索引 ≠ 工作树） ⇒ 命中
 *
 * 两种失法都得报出来（2026-10-28 各量到真实一枚）：
 *   · 工作树对 HEAD 干净（`MM`）⇒ 把**已入库**的内容退回旧版。今天实测三枚，全是 plumbing 提交留下的：
 *     私有索引 + `update-ref` CAS 这条路**天生不写共享索引**，所以提交后那一格还停在提交前的旧 blob。
 *     其中一枚是 `package.json:208` —— 索引那版的 `check:gate-wiring` 不带 `--self-test`，
 *     谁不带 pathspec 提一次，我这格接线就静默消失（build/typecheck/单测都不会告诉你）。
 *   · 工作树对 HEAD 也脏（`AM`、双脏）⇒ 丢掉写的人**最新那一段**（今天量到 `docs/plans/global-ux-system-remediation.md`）。
 *
 * 🔴 反过来必须**不命中**：只 stage（索引==工作树）、只改工作树（索引==HEAD）、三版相同。
 *   把这三种报出来就是假红；假红的代价是这一栏再也没人看。
 * ⚠️ 这一栏**不进 `--strict` 的退出码**：能拆的雷只有"这格是谁留下的"才知道答案，
 *   别人的索引条目我不替人改（见台账 §6.108 的归属纪律），所以它是读数不是判决。
 */
export function thirdVersionRows(indexSha, headSha, worktreeSha) {
  const rows = [];
  for (const [file, idx] of indexSha) {
    const head = headSha.has(file) ? headSha.get(file) : null;
    const wt = worktreeSha.has(file) ? worktreeSha.get(file) : null;
    if (idx !== head && (wt === null || idx !== wt)) rows.push({ file, idx, head, wt });
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * HEAD 里 shell 的 `source` / `.` 指向一枚**不在 HEAD** 的文件 ⇒ 干净检出上那条入口一启动就炸。
 * ================================================================================
 * 立项不是推测，是 2026-10-29 现量抓到并已修的一枚：`scripts/lib/sync-windows-sources.sh` 被改名成
 * `sync-build-sources.sh`，而 HEAD 里 4 行还指着旧名（`git grep -n sync-windows-sources HEAD -- scripts research`），
 * 后果是干净检出上 `pnpm reinstall:all` 直接失败 —— **链上没有任何一道门禁扫 shell 的 source**，
 * 本尺原先那一判只读工作树文本、且只认 `.ts/.tsx/.mts`（后来补了 `.js/.mjs/.cjs`），两样都拦不住它。
 *
 * 解析方式是**取锚点后缀**，不是求值变量：本仓所有 `source` 的变量前缀按约定都是仓库根
 * （`$ROOT`、`$REPO`、`$DIR` 派生自 `dirname`），所以把 token 里从已知顶层目录
 * （`scripts|packages|apps|server|docs|research|e2e`）起的那一段取出来查 HEAD 即可。
 * 🔴 取不到锚点的（`source ./x.sh`、`source "$V/x"`）一律计入「未判定」并**报出条数** ——
 *   静默跳过就等于把"没看到"记成"没有"，那是本仓最贵的一类错。
 * 注释行（`#` 起头）与散文里的 "source" 不算（第一发就栽在把注释行读成引用）。
 */
const SHELL_ANCHORS = ['scripts', 'packages', 'apps', 'server', 'docs', 'research', 'e2e'];

export function extractShellSources(text) {
  const found = [];
  const skipped = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:source|\.)[ \t]+(["']?)([^\s"']+)\1/.exec(line);
    if (!m) continue;
    const token = m[2];
    if (!token.includes('.sh') && !token.includes('.bash')) {
      // `source` 也能带无扩展名的脚本，但本仓 77 条全带扩展名；不带就归到未判定，不猜。
      skipped.push(token);
      continue;
    }
    const seg = token.split('/');
    const ai = seg.findIndex((s) => SHELL_ANCHORS.includes(s));
    if (ai < 0) {
      skipped.push(token);
      continue;
    }
    found.push({ path: seg.slice(ai).join('/') });
  }
  return { found, skipped };
}

/** 在 HEAD 的那份文本里查 shell 悬空 source。`headFiles` 是 HEAD 全树路径集合。 */
export function headDanglingSources(grepText, headFiles) {
  const bad = [];
  let unresolved = 0;
  for (const line of grepText.split('\n')) {
    if (line.trim() === '') continue;
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const file = m[1];
    const { found, skipped } = extractShellSources(m[3]);
    unresolved += skipped.length;
    for (const f of found) if (!headFiles.has(f.path)) bad.push({ file, line: Number(m[2]), target: f.path });
  }
  return { bad, unresolved };
}

/**
 * 逐行抽出**真正的**相对引用语句：`import … from './x';` / `export … from './x';` / `import './x';`。
 * 两头都锚死（行首是关键字、说明符后面到行尾只剩 `;`），注释行先丢 —— 否则散文与断言字符串会灌进读数：
 * `--head` 第一发 381 处里，抽样三处全是这类（`pages.ts:59` 的注释、`theme.tsx:14` 的注释、
 * `note-edit.spec.ts:163` 那句 `expect(...).toContain("import … from './NoteEditScreen';")`）。
 */
export function extractRelativeSpecs(text) {
  const specs = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const m = /^(?:import|export)\b(?:[\s\S]*?\bfrom)?\s*['"](\.[^'"]*)['"]\s*;?\s*(?:\/\/.*)?$/.exec(t);
    if (m) specs.push(m[1]);
  }
  return specs;
}

// 2026-10-29 补 `.mjs/.cjs/.js`：原先只扫 ts 族，而本仓有一批**脚本侧的 `.mjs` importer**
// （现量一枚就是 `scripts/verify-windows-shell-journey.mjs`，它 relative-import 自己的 lib）——
// 那种 importer 引用未入库模块时，"单独提一组 = 半棵树"这一判据完全看不见。
// ⚠️ 仍未覆盖的形状：shell 的 `source` / `.`（路径常带 `$ROOT` 这类变量，展开它要引另一个解析器），
//    这一格登记在台账 §6.113 里当"已知边界"，不当"已覆盖"。
const SCANNED_EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs']);

/**
 * 一条相对说明符在本仓约定下可能的磁盘落点。
 * 🔴 不许用 `extname()` 判扩展名：本仓有一批**带点的文件名**（`account-profile.store.ts`、
 * `websocket-connection.service.ts`），`extname` 会把 `.store` 当扩展名 ⇒ 候选一个都不补 ⇒
 * 已入库的模块被报成"HEAD 里没有"。这里改成"结尾是不是已知模块扩展名"。
 */
const MODULE_EXT_RE = /\.(ts|tsx|mts|js|mjs|json|css|scss)\b/;
const JS_LIKE_RE = /\.(js|mjs)$/;

export function candidateTargets(importer, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec));
  const out = [base];
  if (JS_LIKE_RE.test(base)) {
    const stem = base.replace(JS_LIKE_RE, '');
    out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  } else if (!MODULE_EXT_RE.test(base)) {
    out.push(`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`);
  }
  return out;
}

/**
 * 第二判：已跟踪、已改动的源码 import 了一枚没在 HEAD 里的模块。
 * `untracked` = 文件在这棵树上但没入库（同一趟提交里带上它才自洽）；
 * `dangling` = 磁盘上根本没有这个落点（比未跟踪更硬：谁都跑不动）。
 * 未跟踪的 importer 不扫 —— 它自己还没进仓库，和它的 target 同一笔提交就自洽。
 */
export function crossLineImports(entries, { read, isTracked, exists }) {
  const found = [];
  const seen = new Set();
  for (const e of entries) {
    if (e.xy.includes('?')) continue;
    if (!SCANNED_EXT.has(path.posix.extname(e.file))) continue;
    if (e.file.endsWith('.d.ts')) continue;
    let text;
    try {
      text = read(e.file);
    } catch {
      continue; // 读不到就跳过这枚，但**不**把它读成"没有跨线依赖"
    }
    for (const spec of extractRelativeSpecs(text)) {
      const cands = candidateTargets(e.file, spec);
      if (cands.some((c) => isTracked(c))) continue;
      const onDisk = cands.find((c) => exists(c));
      const target = onDisk ?? cands[0];
      const key = `${e.file} ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ importer: e.file, target, kind: onDisk ? 'untracked' : 'dangling' });
    }
  }
  return found;
}

/** `git diff --name-only` 的输出 ⇒ 路径清单（空行丢掉；带引号的路径不去，本仓没有非 ASCII 路径的改名）。  */
export function parseNameList(text) {
  return text.split('\n').filter((l) => l.trim() !== '');
}

/**
 * 把 `git hash-object --stdin-paths` 的回执（一行一枚，**顺序即输入顺序**）与输入路径配对。
 * 🔴 长度不等必须炸而不是静默截掉：`hash-object` 遇到读不到的路径会整发失败，
 * 那种"少了几条"的回执如果配对着往下走，就会把没算到的路径当成"工作树里没有" ⇒ 第三版那一栏会假绿。
 */
export function zip(paths, shas) {
  if (paths.length !== shas.length) {
    throw new Error(`zip：路径 ${paths.length} 枚 vs 哈希 ${shas.length} 枚 ⇒ 顺序对不上，不配拿来配对`);
  }
  return paths.map((p, i) => [p, shas[i]]);
}

const SELF_TEST_ARMS = () => {
  const arms = [];
  const push = (name, got, want) => arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const E = (f) => ({ xy: ' M', file: f });

  push(
    '① 全命中 ⇒ 未登记 0 枚',
    classify([E('apps/web/src/App.tsx'), E('apps/web/src/styles/app/base.css')], OWNER_RULES).unattributed.length,
    0,
  );
  push(
    '② 有一枚没人登记 ⇒ 必须点名它（这才叫有牙）',
    classify([E('apps/web/src/App.tsx'), E('server/src/api.ts')], OWNER_RULES).unattributed.map((r) => r.file),
    ['server/src/api.ts'],
  );
  push('③ 空清单 ⇒ 判"干净"，不许判成"有例外"', classify([], OWNER_RULES), {
    rows: [],
    unattributed: [],
    indexOnly: [],
    byLine: OWNER_RULES.map((r) => ({ line: r.line, n: 0 })),
    checked: 0,
  });
  push(
    '⑳ 索引旧内容不算"未登记的例外"：工作树对 HEAD 干净、只有索引脏 ⇒ 单独一档，未登记栏读 0',
    classify([{ xy: 'MM', file: 'server/src/api.ts' }], OWNER_RULES, new Set()).unattributed.length,
    0,
  );
  push(
    '⑳b 同一枚路径若工作树也确实改了 ⇒ 仍回到未登记栏（这一档不许变成洗白口）',
    classify([{ xy: 'MM', file: 'server/src/api.ts' }], OWNER_RULES, new Set(['server/src/api.ts'])).unattributed.map((r) => r.file),
    ['server/src/api.ts'],
  );
  push(
    '⑳c 未跟踪件不许被这一档吃掉（`??` 不在 diff HEAD 里是常态，它确实是没入库的东西）',
    classify([{ xy: '??', file: 'server/src/new.ts' }], OWNER_RULES, new Set()).unattributed.map((r) => r.file),
    ['server/src/new.ts'],
  );
  // 「第三版」那一栏的九枚臂。形状全部取自 2026-10-28 真实量到的枚子，不是编的：
  // ㉑ 就是 `package.json`、㉒ 就是 `scripts/check-gate-wiring.mjs`、㉕ 就是那份 UX 计划。
  const V = (xs) => new Map(xs);
  push(
    '㉑ 三版各不同（`package.json` 真实形状：索引那版的 check:gate-wiring 不带 --self-test）⇒ 必须命中',
    thirdVersionRows(V([['package.json', 'IDX']]), V([['package.json', 'HEAD']]), V([['package.json', 'WT']])),
    [{ file: 'package.json', idx: 'IDX', head: 'HEAD', wt: 'WT' }],
  );
  push(
    '㉒ 工作树对 HEAD 干净、只有索引旧（`MM`，我今天拆的第一枚雷）⇒ 必须命中',
    thirdVersionRows(V([['a.ts', 'IDX']]), V([['a.ts', 'HEAD']]), V([['a.ts', 'HEAD']])),
    [{ file: 'a.ts', idx: 'IDX', head: 'HEAD', wt: 'HEAD' }],
  );
  push(
    '㉓ 只 stage 了（索引==工作树）⇒ 不许命中：那是正常暂存，报出来就是假红',
    thirdVersionRows(V([['a.ts', 'S']]), V([['a.ts', 'H']]), V([['a.ts', 'S']])),
    [],
  );
  push(
    '㉔ 只改了工作树（索引==HEAD）⇒ 不许命中：这一格里没有"谁都不在看"的东西',
    thirdVersionRows(V([['a.ts', 'H']]), V([['a.ts', 'H']]), V([['a.ts', 'W']])),
    [],
  );
  push(
    '㉕ 新增件 stage 之后又改（`AM`，HEAD 里根本没这枚）⇒ 必须命中，head 给 null',
    thirdVersionRows(V([['n.ts', 'S']]), new Map(), V([['n.ts', 'W']])),
    [{ file: 'n.ts', idx: 'S', head: null, wt: 'W' }],
  );
  push(
    '㉖ 工作树里已经删掉、索引还留着（`AD`）⇒ 必须命中，wt 给 null',
    thirdVersionRows(V([['d.ts', 'S']]), V([['d.ts', 'H']]), new Map()),
    [{ file: 'd.ts', idx: 'S', head: 'H', wt: null }],
  );
  push('㉗ 三版相同 ⇒ 空（不许把干净的东西报成雷）', thirdVersionRows(V([['x.ts', 'S']]), V([['x.ts', 'S']]), V([['x.ts', 'S']])), []);
  push(
    '㉘ 索引行解析器：meta 三段 + TAB，带空格与中文的路径要原样还原，stage≠0 的合并条目必须剔掉（解析器一坏分母就空、空就假绿）',
    [...parseLsFilesStage('100644 aaa 0\tpackage.json\u0000100644 bbb 0\tapps/web/evidence/x 中文.png\u0000100644 ccc 1\tconflict.ts\u0000')],
    [['package.json', 'aaa'], ['apps/web/evidence/x 中文.png', 'bbb']],
  );
  push(
    '㉙ HEAD 行解析器：meta 是 `mode blob sha`，取第三段（取错整栏失明）',
    [...parseLsTree('100644 blob ddd\tsrc/a.ts\u0000100644 blob eee\tsrc/b 中文.ts\u0000')],
    [['src/a.ts', 'ddd'], ['src/b 中文.ts', 'eee']],
  );
  push(
    '㉚ 配对器：两列不等长必须炸（静默截掉就会把没算到的路径当成"工作树里没有"⇒ 第三版栏假绿）',
    (() => {
      try {
        zip(['a.ts', 'b.ts'], ['aaa']);
        return '没炸';
      } catch (e) {
        return String(e.message).startsWith('zip：路径 2 枚 vs 哈希 1 枚');
      }
    })(),
    true,
  );
  push(
    '㉛ 折叠的那一栏不许把路径吞掉：classify 判为「索引旧内容」的每一枚，必须同时被「第三版」那一栏点名（真子集关系）',
    (() => {
      const c = classify([{ xy: 'MM', file: 'server/src/api.ts' }], OWNER_RULES, new Set());
      const t = thirdVersionRows(V([['server/src/api.ts', 'IDX']]), V([['server/src/api.ts', 'HEAD']]), V([['server/src/api.ts', 'HEAD']]));
      return [c.indexOnly.map((r) => r.file).sort(), t.map((r) => r.file).sort()];
    })(),
    [['server/src/api.ts'], ['server/src/api.ts']],
  );
  push(
    '㉝ 通配前缀只吃一段：`.run-arms-*.txt` 命中仓根那批日志，但不许跨目录去吃 docs/ 里的同名件',
    [matchPrefix('.run-arms-guard.txt', '.run-arms-*.txt'), matchPrefix('docs/run-arms-x.txt', '.run-arms-*.txt')],
    [true, false],
  );
  push('㉞ 坏形状的通配必须被规则表自检拒（首尾裸星号 / 整段一个星号＝会跨段认领）', auditRules([{ line: 'X', why: '这条夹具的理由要够十二字以上才被认', prefixes: ['*', 'a*', '*.txt'] }]).length, 3);
  push('㉟ 普通与目录前缀的旧语义不许被这次改动带跑（回归臂）', [matchPrefix('a/b.ts', 'a/'), matchPrefix('a/b.ts', 'a/c.ts'), matchPrefix('a/c.ts', 'a/c.ts')], [true, false, true]);
  push(
    '㊱ `.mjs` 的 importer 也要扫（2026-10-29 补的那一格：原先只扫 ts 族，脚本侧的 .mjs 引用未入库模块时这条判据完全看不见）',
    crossLineImports(
      [{ xy: ' M', file: 'scripts/verify-windows-shell-journey.mjs' }],
      {
        read: () => "import { syncSources } from './lib/sync-build-sources.mjs';\n",
        isTracked: () => false,
        exists: () => true,
      },
    ),
    [{ importer: 'scripts/verify-windows-shell-journey.mjs', target: 'scripts/lib/sync-build-sources.mjs', kind: 'untracked' }],
  );
  push(
    '㊲ 诚实记下没覆盖的那一格：shell 的 `source "$ROOT/…"` 扫不出来（展开变量要第二个解析器），这一臂断言的是"确实不点名"，不许有人把它读成"shell 也管到了"',
    crossLineImports(
      [{ xy: ' M', file: 'scripts/reinstall-all.sh' }],
      { read: () => 'source "$ROOT/scripts/lib/sync-build-sources.sh"\n', isTracked: () => false, exists: () => true },
    ),
    [],
  );
  push(
    '㊳ shell 悬空 source 必须命中（就是 2026-10-29 那枚真事：`$ROOT/scripts/lib/sync-windows-sources.sh` 已改名，HEAD 里还指着旧名）',
    headDanglingSources('scripts/reinstall-all.sh:388:source "$ROOT/scripts/lib/gone.sh"', new Set(['scripts/lib/ok.sh'])),
    { bad: [{ file: 'scripts/reinstall-all.sh', line: 388, target: 'scripts/lib/gone.sh' }], unresolved: 0 },
  );
  push('㊔ 同一形状但目标在 HEAD ⇒ 不许命中（防假红）', headDanglingSources('a.sh:1:. "$ROOT/scripts/lib/ok.sh"', new Set(['scripts/lib/ok.sh'])), { bad: [], unresolved: 0 });
  push('㊕ 取不到锚点的要落成「未判定」计数，不许静默当没有（`source ./local.sh` 这一类）', headDanglingSources('a.sh:1:source ./local.sh', new Set()), { bad: [], unresolved: 1 });
  push('㊖ 注释行里的 source 不算引用（第一发就把注释读成命中的那个坑）', headDanglingSources('a.sh:1:# source "$ROOT/scripts/lib/gone.sh"', new Set()), { bad: [], unresolved: 0 });
  push('㊗ `.`（dot-source）与 `source` 同权：`$REPO` 前缀也要能取到锚点', headDanglingSources('apps/desktop-windows/scripts/package-msix.sh:84:. "$REPO/scripts/lib/nope.sh"', new Set()), { bad: [{ file: 'apps/desktop-windows/scripts/package-msix.sh', line: 84, target: 'scripts/lib/nope.sh' }], unresolved: 0 });
  push('④ 目录规则要按前缀吃下整棵子树', classify([E('e2e/tests/dirty-form-guard.spec.ts')], OWNER_RULES).rows[0].line, '全局 UX 分层整改线');
  push('⑤ 规则表自己必须干净（现在这份必须无违规）', auditRules(OWNER_RULES), []);
  push(
    '⑥ 坏规则必须被拒：目录前缀缺尾斜杠 / 理由空',
    auditRules([{ line: 'X', why: '', prefixes: ['apps/foo'] }]).length,
    2,
  );
  push(
    '⑦ 完整路径规则不许把同名前缀的另一枚吃掉',
    classify([E('apps/web/src/App.tsx'), E('apps/web/src/App.tsx.bak')], OWNER_RULES).unattributed.map((r) => r.file),
    ['apps/web/src/App.tsx.bak'],
  );
  push('⑧ 未知旗标必须被拒', parseArgs(['--strict', '--bogus']).unknown, ['--bogus']);
  push('⑨ 行解析吃 XY 两列 + 路径，重命名取箭头后那头', parsePorcelain(' M a/b.ts\nR  old.ts -> new.ts'), [
    { xy: ' M', file: 'a/b.ts' },
    { xy: 'R ', file: 'new.ts' },
  ]);

  // 第二判的四臂：形状取自 2026-10-28 真实量到的那一枚（已跟踪的界面文件 import 一枚未入库的 hook）
  const IMP = 'apps/web/src/features/calendar/CalendarCapturePopover.tsx';
  const HOOK = 'apps/web/src/lib/form/useDirtyDismissGuard.tsx';
  const TXT = "import { useDirtyDismissGuard } from '../../lib/form/useDirtyDismissGuard.js';\nexport const X = 1;\n";
  const readMap = (m) => (f) => {
    if (m[f] === undefined) throw new Error('no such file');
    return m[f];
  };
  const mk = (tracked, onDisk) => ({
    read: readMap({ [IMP]: TXT }),
    isTracked: (f) => tracked.includes(f),
    exists: (f) => onDisk.includes(f),
  });
  const one = (xy) => [{ xy, file: IMP }];
  push(
    '⑩ 已跟踪代码 import 一枚未入库、但在树上的模块 ⇒ 必须点名（这正是"单独提一组=半棵树"）',
    crossLineImports(one(' M'), mk([], [HOOK])),
    [{ importer: IMP, target: HOOK, kind: 'untracked' }],
  );
  push('⑪ 同一枚 import 的 target 已经入库 ⇒ 不许点名（别线的模块进仓库了就不是例外）', crossLineImports(one(' M'), mk([HOOK], [HOOK])), []);
  push(
    '⑫ target 既不入库也不在树上 ⇒ 判 dangling，不许读成"没问题"',
    crossLineImports(one(' M'), mk([], [])).map((r) => r.kind),
    ['dangling'],
  );
  push('⑬ 未跟踪的 importer 自己不扫（它和 target 同一笔提交就自洽）', crossLineImports(one('??'), mk([], [HOOK])), []);
  push(
    '⑱ 带点的文件名要解析得到（`account-profile.store` 这族，extname 会把 `.store` 当扩展名）',
    crossLineImports(
      [{ xy: ' M', file: 'server/src/api.ts' }],
      {
        read: () => "import { withAccountProfile } from './account/account-profile.store';\n",
        isTracked: (f) => f === 'server/src/account/account-profile.store.ts',
        exists: () => false,
      }
    ),
    [],
  );
  push(
    '⑭ 无扩展名写法要解析到 .ts —— 别线的 spec 全用这种写法，解析不到就是一整批假红',
    crossLineImports(
      [{ xy: ' M', file: 'e2e/tests/rail-roving.spec.ts' }],
      {
        read: () => "import { openApp } from './helpers';\n",
        isTracked: (f) => f === 'e2e/tests/helpers.ts',
        exists: () => false,
      }
    ),
    [],
  );
  push(
    '⑮ 路径清单解析要丢空行；--range 少了 ref 必须被拒（不许把 --head 读成"扫整棵树"）',
    [parseNameList('a/b.ts\n\nc/d.tsx\n'), parseArgs(['--head', '--range']).unknown, parseArgs(['--head', '--range', 'HEAD~5']).range],
    [['a/b.ts', 'c/d.tsx'], ['--range（少了 ref）'], 'HEAD~5'],
  );
  push(
    '⑯ 注释行与"断言里的 import 文本"都不许算引用（这就是 --head 第一发 381 处噪声的来源）',
    extractRelativeSpecs(
      [
        "// import x from './commented-out';",
        " * `import { VALUE } from './doc-text.js'` 不行。",
        `    expect(section).toContain("import { NoteEditScreen } from './NoteEditScreen';");`,
        "import { NoteEditScreen } from './NoteEditScreen';",
        "import { trailing } from './with-comment'; // 行尾注释不许把它读成'不是引用'",
        "import './side.css';",
      ].join('\n')
    ),
    ['./NoteEditScreen', './with-comment', './side.css'],
  );
  push(
    '⑰ `export … from` 那种再转发行也要吃到（锚死行尾不能把转发漏掉）',
    extractRelativeSpecs("export { createFoo } from './factory.js';\nexport * from './re-export-all';\n"),
    ['./factory.js', './re-export-all']
  );
  push(
    '⑲ 按机制登记的那条只吃已跟踪件的修改：新加的取证文件必须仍被点名（skipUntracked 的牙）',
    classify(
      [
        { xy: ' M', file: 'apps/web/evidence/whatever/old-shot.png' },
        { xy: '??', file: 'apps/web/evidence/whatever/new-shot.png' },
      ],
      OWNER_RULES
    ).unattributed.map((r) => r.file),
    ['apps/web/evidence/whatever/new-shot.png'],
  );
  return arms;
};

const main = () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.unknown.length > 0) {
    console.error(`🔴 未知旗标：${opts.unknown.join(' ')} ｜ 这枚尺只认 ${ALLOWED_FLAGS.join(' / ')}`);
    process.exit(1);
  }
  if (opts.selfTest) {
    const arms = SELF_TEST_ARMS();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) {
      console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    }
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  if (opts.head) {
    if (opts.range === undefined) {
      console.error('🔴 --head 必须带 --range <ref>：它只读对象库，分母就是 "git diff --name-only <ref>..HEAD"。');
      console.error('   整棵 HEAD 那一档我今天试过后撤掉了 —— 分母 1721 枚、286 处判不中，噪声两类（指向 `packages/*/dist/*` 这种构建产物、');
      console.error('   以及非语句式的 import 写法）都要真正的解析器才分得清。留一枚天生红的尺比不留更糟。');
      process.exit(1);
    }
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim() !== '');
    const headSet = new Set(names);
    const changed = parseNameList(
      execFileSync('git', ['diff', '--name-only', `${opts.range}..HEAD`, '--', '*.ts', '*.tsx', '*.mts'], { cwd: ROOT, encoding: 'utf8' })
    ).filter((f) => headSet.has(f)); // 范围里被删掉的文件不在 HEAD 里，扫它们没有意义
    const bad = crossLineImports(
      changed.map((file) => ({ xy: ' M', file })),
      {
        read: (f) => execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }),
        isTracked: (f) => headSet.has(f),
        exists: () => false,
      }
    );
    console.log(`HEAD 自洽 ｜ 范围 ${opts.range}..HEAD ｜ 这批里已入库的源文件 ${changed.length} 枚（HEAD 共 ${names.length} 枚）｜ 引用不到 HEAD 落点的 ${bad.length} 处`);
    for (const b of bad) console.log(`   ${b.importer}\n      → ${b.target}（HEAD 里没有这个落点）`);
    process.exit(opts.strict && bad.length > 0 ? 1 : 0);
  }
  const rulesBad = auditRules(OWNER_RULES);
  if (rulesBad.length > 0) {
    console.error('🔴 规则表自己不合格，这枚尺今天不许报"干净"：');
    for (const b of rulesBad) console.error(`   ${b}`);
    process.exit(1);
  }
  // 🔴 `core.quotepath=off`：默认写法会把非 ASCII 路径转义成 "view-\344\271\240…"，
  // 那种字符串跟任何前缀都拼不上 ⇒ 中文名的证据件会整批读成"没登记过"（2026-10-28 实测到过）。
  const entries = parsePorcelain(
    execFileSync('git', ['-c', 'core.quotepath=off', 'status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  );
  // 工作树相对 HEAD 真改了哪些路径（NUL 分隔：路径里有空格与中文都不该被引号骗掉）
  const worktreeDirty = new Set(
    execFileSync('git', ['-c', 'core.quotepath=off', 'diff', 'HEAD', '--name-only', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((s) => s !== '')
  );
  const v = classify(entries, OWNER_RULES, worktreeDirty);
  if (v.checked === 0) {
    console.log('工作树干净：未提交 0 枚 ⇒ 没有例外需要登记。');
    process.exit(0);
  }
  console.log(`工作树例外归属 ｜ 未提交 ${v.checked} 枚 ｜ 规则 ${OWNER_RULES.length} 行`);
  for (const b of v.byLine) if (b.n > 0) console.log(`   ${String(b.n).padStart(3)} 枚 ← ${b.line}`);
  // 🔴 「索引旧内容」那一档**不单独打印**了：它是下面「第三版」那一栏的真子集
  //   （工作树==HEAD 且 索引≠HEAD ⇒ 索引既不等于 HEAD 也不等于工作树 ⇒ 必然命中），
  //   两栏并排印同一批路径就是重复实现，而重复输出的代价是下一位不知道哪一栏是权威。
  //   包含性由臂 ㉛ 钉住（classify 的 indexOnly 必须被第三版那一栏逐枚覆盖）；
  //   这一档仍然参与**归属**（索引旧内容不是"没登记的例外"），所以 `v.indexOnly` 照常算，只是不再单独印。
  // 「第三版」这一栏：机制判据，不看 `git status` 那两个字符。
  // 分母只取"脏过"的路径（未跟踪件索引里本来就没有格子），三条 git 各一发批量取，不逐枚 spawn。
  const dirtyTracked = entries.filter((e) => !e.xy.includes('?')).map((e) => e.file);
  if (dirtyTracked.length > 0) {
    const indexSha = parseLsFilesStage(
      execFileSync('git', ['ls-files', '-s', '-z', '--', ...dirtyTracked], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }),
    );
    if (indexSha.size === 0) {
      console.error(`🔴 ${dirtyTracked.length} 枚已跟踪的脏件，` + '`git ls-files -s` 却回 0 条 ⇒ 探针坏了，这一栏今天没干活（不配说"没有雷"）');
      process.exit(2);
    }
    const headSha = parseLsTree(
      execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', '--', ...dirtyTracked], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }),
    );
    const present = dirtyTracked.filter((f) => existsSync(path.join(ROOT, f)));
    let worktreeSha;
    try {
      worktreeSha = new Map(
        zip(present, execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: ROOT, encoding: 'utf8', input: present.join('\n') + '\n' }).split('\n').filter((s) => s !== '')),
      );
    } catch (e) {
      // 🔴 这里曾经是"取完再比长度"的守卫 —— 那种写法**永远轮不到执行**：路径读不到时 `hash-object`
      //   整发失败、`zip` 先抛，长度不等这一步提前在异常里发生了。守卫要包在真正会失败的那一步外面才算数
      //   （台账 §6.111 第 ④ 维那条：写了但打不到的错误处理，等于没有错误处理）。
      console.error(`🔴 工作树哈希这一发没取成 ⇒ 这一栏今天不许报"没有雷"：${String(e.message ?? e).split('\n')[0]}`);
      process.exit(2);
    }
    const third = thirdVersionRows(indexSha, headSha, worktreeSha);
    if (third.length > 0) {
      console.log(`   ⚠️ 索引里躺着一版谁都不在看的东西 ${third.length} 枚（不带 pathspec 的 \`git commit\` 会把**索引那一版**写进历史）：`);
      for (const r of third) {
        if (r.wt === r.head && r.head !== null) {
          console.log(`      ${r.file} ← 索引 ≠ HEAD，工作树 == HEAD ⇒ 提交它等于把已入库的内容退回旧版（旧版单独打印的那档「索引旧内容」就是这一种，正文见台账 §6.108）`);
          console.log(`         正解（只动这一格，不碰别人的暂存）：git update-index --cacheinfo 100644,${r.head},"${r.file}"`);
        } else if (r.head === null) {
          console.log(`      ${r.file} ← HEAD 里没有（新增件），索引那一版 ≠ 工作树最新那一段 ⇒ 提交它丢掉写的人最新的改动`);
          console.log(`         正解由**写的人**定：要么 \`git add "${r.file}"\`（以工作树为准），要么 \`git restore --staged -- "${r.file}"\``);
        } else if (r.wt === null) {
          console.log(`      ${r.file} ← 工作树里已经删掉、索引还留着一版 ⇒ 提交它会把删掉的内容又写回去`);
          console.log(`         正解：\`git rm --cached -- "${r.file}"\` 或按写的人的意思重删`);
        } else {
          console.log(`      ${r.file} ← 三版各不同（HEAD/索引/工作树互不相等）`);
          console.log(`         正解先问这格是谁 stage 的；我不替别的会话改索引（台账 §6.108 的归属纪律）`);
        }
      }
    }
  }
  if (v.unattributed.length > 0) {
    console.log(`🔴 没登记过的例外 ${v.unattributed.length} 枚（这些才是"谁都可能顺手提交掉"的那批）：`);
    for (const u of v.unattributed.slice(0, 20)) console.log(`   ${u.xy} ${u.file}`);
    if (v.unattributed.length > 20) console.log(`   …另 ${v.unattributed.length - 20} 枚`);
  } else {
    console.log("   ⇒ 每一枚都归到某条已登记的理由；正文在 BLOCKED.md 那张「归谁 / 为什么不由我代提交」表，取它的位置：grep -n '^| 归谁 |' BLOCKED.md");
  }
  // 🔴 HEAD 自身的完整性：shell 的 `source` 指向不在 HEAD 的文件 ⇒ 干净检出上那条入口一启动就炸。
  //    这一判与前面两判不同：它读的是 **HEAD 的文本**（不是工作树），所以别人没提交的重命名拦不住它 —— 这正是 2026-10-29 那一枚的成因。
  //    默认就进退出码：HEAD 此刻 0 处 ⇒ 不是天生红的尺。
  const headGrep = execFileSync('git', ['grep', '-n', '-E', "^[[:space:]]*(source|\\.)[[:space:]]+[\"']?[^[:space:]\"']+", 'HEAD', '--', '*.sh', '*.bash'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter((l) => l.startsWith('HEAD:'))
    .map((l) => l.slice('HEAD:'.length))
    .join('\n');
  const headFiles = new Set(
    execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n')
      .filter((l) => l.trim() !== ''),
  );
  const dangling = headDanglingSources(headGrep, headFiles);
  if (headGrep.trim() !== '' && headFiles.size === 0) {
    console.error('🔴 HEAD 全树清单读回空 ⇒ 探针不合，这一判今天不许报"没有悬空"');
    process.exit(2);
  }
  if (dangling.bad.length > 0) {
    console.log(`🔴 HEAD 里有 ${dangling.bad.length} 处 shell 的 source 指向不在 HEAD 的文件 ⇒ 干净检出上那条入口一跑就炸：`);
    for (const d of dangling.bad) console.log(`   ${d.file}:${d.line} → ${d.target}（HEAD 里没有）`);
  }
  console.log(`   · HEAD shell source 对账：扫 ${headGrep.split('\n').filter((l) => l.trim() !== '').length} 行 ｜ 悬空 ${dangling.bad.length} ｜ 无锚点未判定 ${dangling.unresolved}`);
  const trackedSet = new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim() !== '')
  );
  const cross = crossLineImports(entries, {
    read: (f) => readFileSync(path.join(ROOT, f), 'utf8'),
    isTracked: (f) => trackedSet.has(f),
    exists: (f) => existsSync(path.join(ROOT, f)),
  });
  if (cross.length > 0) {
    console.log(`🔴 跨线依赖 ${cross.length} 处：已跟踪的代码 import 了没在 HEAD 里的模块 ⇒ **单独提交 importer 那一组，HEAD 就是半棵树**`);
    for (const c of cross.slice(0, 20)) console.log(`   ${c.importer}\n      → ${c.target}（${c.kind === 'untracked' ? '在这棵树上，但没入库' : '落点上根本没有这枚文件'}）`);
    if (cross.length > 20) console.log(`   …另 ${cross.length - 20} 处`);
    console.log('   ⇒ 归属表按路径分堆，看不出这一类：两堆各自登记齐了，按堆提交照样红。');
  }
  process.exit(dangling.bad.length > 0 || (opts.strict && v.unattributed.length + cross.length > 0) ? 1 : 0);
};

main();
