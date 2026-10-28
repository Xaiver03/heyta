#!/usr/bin/env node
/**
 * 「浮层与反馈」债务账本门禁
 * ==========================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么必须有它
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 通用判据住在全局 Skill `overlay-feedback-patterns`；本仓的适配层在
 * `docs/reference/overlay-feedback-adaptation.md`，规则在 `docs/agents/overlay-feedback.md`。
 * 但**规则写在文档里而代码里各页自判，等于没有规则** —— 这句是 Skill 自己的话，
 * 也是本仓 `check:design` 文件头记过的同一个教训。
 *
 * 这一道门管两条**只减不增**的债：
 *
 *   R1 **原生对话框**：`window.confirm/alert/prompt`、RN `Alert.alert/prompt`、
 *      以及没有本地绑定的裸 `confirm(...)` / `alert(...)`。
 *      它们的罪状不是丑，是**放不下后果说明、无法本地化、无法测焦点、
 *      无法做"逐字键入名称"确认**（Skill `destructive-actions.md` §5「严禁」第一条）。
 *   R2 **自绘模态层**：`aria-modal` / `role="dialog"` 的落点。
 *      每一处自绘都意味着滚动锁、焦点陷阱、焦点归还、关闭策略**又抄了一份**，
 *      而关闭策略本仓实测 0 处显式约定。新的模态必须走
 *      `@heyta/ui` 的 `OverlayModal` / `DangerDialog`。
 *
 * 两条都是**账本制**：现存条目逐文件登记读数，
 *   · 账本外出现 ⇒ 🔴 红（新增债务）；
 *   · 账内读数涨了 ⇒ 🔴 红；
 *   · 账内读数**掉了** ⇒ 🔴 也是红 —— 要求把账本那一行同步改小。
 *     第三臂常被写成"应该放过"，但那会让门禁失去唯一能证明自己在缩的读数，
 *     而 T1/T5 的验收口径就是这条读数。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据的形状，以及它**故意**留下的一条边界
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 裸 `confirm(` 有三种完全不同的东西，本仓实测全部存在：
 *   ① 浏览器全局：`server/public/app.js` 的 3 处 `const x = confirm(...)` ⇒ 债；
 *   ② 本机的局部函数：`async function confirm()`（`apps/web/src/features/ai/AiToolRun.tsx:24`）、
 *      `const confirm = async (...)`（`TickTickImportPanel.tsx:124`）、
 *      store 的方法签名 `confirm(): Promise<void>;`（`legal-recheck/store.ts`）、
 *      `const confirm = useLegalReconfirmStore((s) => s.confirm)`（`LegalReconfirmSheet.tsx:59`）⇒ **不是债**；
 *   ③ `onConfirm(...)` 这种带前缀的名字 ⇒ 正则从词边界就排除。
 *
 * 所以判据是「**裸调用 + 本文件没有同名绑定**」。绑定按下面 `BINDING_PATTERNS`
 * 四种形状识别（就是 ② 里实测到的那四种）。
 *
 * ⚠️ 未收录的声明形状（例如把 `confirm` 当参数名传进来的新写法）会被当成
 *    **原生框报红** —— 这条门假在**假阳**那一侧，不会漏报。
 *    假阳是可诊断的：报错会点名行号，改个名或往 `BINDING_PATTERNS` 加一条就完。
 *    （反方向才是真危险：一条会漏报的门禁让人以为债已清完。）
 *
 * 注释里的 `aria-modal` **不算** —— 先剥注释再判（`check-rn-aria.mjs:97` 记的
 * "本仓踩过三次"）。实测差别很大：不剥时 `apps/web/src/lib/keyboard-cursor.ts`
 * 这种纯文档文件会带着 3 处"aria-modal"进账本。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 覆盖边界（写明"不管什么"，否则读数会被当成整类）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * · **R2 不含 `apps/landing`**：落地页按适配层 §5 不归本规范管。
 *   ⚠️ 它**确实**有一枚自绘的移动导航面板（`apps/landing/src/site/DocsLayout.tsx`，
 *   现量 aria-modal=1 / role="dialog"=1）—— 这条排除是**显式的**，不是漏扫。
 * · **R2 不含 `server/public/app.js`**：后台无框架，走的是原生框那一条（R1 已登记 3 处）。
 * · 两条都**不判**"同屏几个模态" —— 那要运行时观测，归 e2e 走查。
 *
 * 用法：`node scripts/check-overlay.mjs` · `--show` 打印现量读数 · `--self-test` 用夹具逐臂证明
 *   退出码：0 通过 / 1 有违规 / 2 判据失效（扫描面没了）。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-rn-aria.mjs` 同一个约定，只给故障注入探针用。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

const SHOW = process.argv.includes('--show');

/**
 * R1 的扫描面。**每一个客户端外壳 + 后台都要在列**，缺一条就是静默失效
 * （`design-system/heyta/check-hardcoded.mjs` 的文件头把这件事讲了三遍）。
 */
const NATIVE_SCAN_ROOTS = [
  'apps/web/src',
  'apps/mobile/src',
  'apps/desktop',
  'apps/landing/src',
  'packages/ui/src',
  'server/public',
];

/** R2 的扫描面：模态语义只可能出现在 JSX 里。 */
const MODAL_SCAN_ROOTS = ['apps/web/src', 'apps/mobile/src', 'apps/desktop', 'packages/ui/src'];

const SCAN_EXT = /\.(?:tsx|jsx|js|mjs)$/;
/** R2 只认 JSX —— `.ts` 里的 `role="dialog"` 只会是注释或字符串说明。 */
const MODAL_EXT = /\.tsx?$/;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-types', 'build', 'coverage', '.next',
  'android', 'ios', 'test-results', 'generated', 'vendor', 'Pods', 'DerivedData',
]);

/** 明确的原生全局调用（不需要判绑定）。 */
const NATIVE_EXPLICIT = /\bwindow\.(?:confirm|alert|prompt)\s*\(|\bAlert\.(?:alert|prompt)\s*\(/g;
/** 裸 `confirm(` / `alert(` / `prompt(` —— 词边界排除 `onConfirm(` / `_confirm(`。 */
const NATIVE_BARE = /(?<![.\w$])(?:confirm|alert|prompt)\s*\(/g;
const BARE_NAME = /(?<![.\w$])(confirm|alert|prompt)\s*\(/;
/** 实测到的四种"本文件有同名绑定"的形状。 */
const BINDING_PATTERNS = [
  (name) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`),
  (name) => new RegExp(`\\bfunction\\s+${name}\\s*[<(]`),
  (name) => new RegExp(`^\\s*(?:async\\s+)?${name}\\s*(?:\\([^)]*\\))?\\s*[:{]`, 'm'),
  (name) => new RegExp(`[{}][^{}]*\\b${name}\\b[^{}]*[}]\\s*=`),
];

const MODAL_MARKERS = [
  { key: 'ariaModal', label: 'aria-modal', pattern: /aria-modal\s*[={"]/g },
  { key: 'dialogRole', label: 'role="dialog"', pattern: /role\s*=\s*["']dialog["']|role\s*=\s*\{\s*["']dialog["']/g },
];

/**
 * 🔴 R1 账本（现量 2026-10-23）。**只许改小，不许改大，也不许加行。**
 * 清完一处就把那一行删掉 —— 门禁会因为"读数掉了"而提醒你。
 */
const NATIVE_LEDGER = {
  // 2026-10-27（全局 UX 整改 P2）摘掉一行：`VaultSettingsPanel` 那枚
  // `window.confirm('…确定继续吗？')` 换成了页内危险确认
  // （`apps/web/src/lib/dialog/DangerConfirmDialog.tsx` + `e2e/tests/vault-settings.spec.ts`）。
  // 那是 **Web 侧最后一枚**原生框 —— 这一族此后只剩移动端 4 处与后台 3 处。
  'apps/mobile/src/screens/SecurityScreen.tsx': 1,
  'apps/mobile/src/screens/SessionsSection.tsx': 2,
  'apps/mobile/src/screens/VaultSettingsSection.tsx': 1,
  // 管理后台没有框架，三处全是浏览器原生框，且文案是硬编码英文（同时违反 i18n 唯一真源）。
  'server/public/app.js': 3,
};

/**
 * 🔴 R2 账本（现量 2026-10-23）。新的模态必须走 `OverlayModal` / `DangerDialog`，
 * 所以这里**加一行 = 红**。迁移一格就删一行（适配层 §4 T5）。
 */
const MODAL_LEDGER = {
  'apps/web/src/App.tsx': { ariaModal: 3, dialogRole: 2 },
  'apps/web/src/features/ai/AiBreakdown.tsx': { ariaModal: 0, dialogRole: 3 },
  'apps/web/src/features/ai/AiCapture.tsx': { ariaModal: 0, dialogRole: 3 },
  'apps/web/src/features/ai/AiDuration.tsx': { ariaModal: 0, dialogRole: 3 },
  'apps/web/src/features/ai/AiPrioritize.tsx': { ariaModal: 0, dialogRole: 3 },
  'apps/web/src/features/ai/AiToolRun.tsx': { ariaModal: 0, dialogRole: 3 },
  'apps/web/src/features/ai/AssistantPanel.tsx': { ariaModal: 0, dialogRole: 1 },
  'apps/web/src/features/auth/AuthPanel.tsx': { ariaModal: 1, dialogRole: 1 },
  'apps/web/src/features/calendar/CalendarCapturePopover.tsx': { ariaModal: 0, dialogRole: 1 },
  'apps/web/src/features/inbox/InboxBell.tsx': { ariaModal: 0, dialogRole: 1 },
  'apps/web/src/features/legal-recheck/LegalReconfirmSheet.tsx': { ariaModal: 1, dialogRole: 1 },
  'apps/web/src/features/privacy/PrivacyConsentSheet.tsx': { ariaModal: 1, dialogRole: 1 },
  'apps/web/src/features/shell/CompactRailNavigation.tsx': { ariaModal: 0, dialogRole: 1 },
  /*
   * 🔴 2026-10-28（P6 第二批）：这四行**跟着删**，不是放宽判据 ——
   * `HabitsView` 的新建习惯、`ShareFeature` 的分享面板、`JoinSharedListDialog` 的入群、
   * `ConflictDialog` 的冲突解决都改吃 `WebModalShell`，`role="dialog"`/`aria-modal`
   * 那两枚标记现在只住在壳那一个文件里（每迁一枚，这张表就少一行；
   * 判据的候选下限那一臂会在"迁完之后扫描器自己瞎了"时红，不会因为表变短而松）。
   */
  /*
   * 2026-10-27（P2）：`TrashView` 自己那一层搬进了 `DangerConfirmDialog`，
   * 所以它不再被扫到 —— 这一行**跟着删**，不是放宽判据：落点一处没少，
   * 只是从"每页各画一族"收敛成"共享那一族"（见下面 `lib/dialog` 那两行）。
   */
  /*
   * 🔴 这两行是**带翻案条件的登记**，不是"这里允许自绘"。
   *
   * 判据本来要它们用 `OverlayModal` / `DangerDialog`，而那两个的外壳是 react-native-web 的
   * `Modal` —— 它在 Web 真实浏览器里**那一层根本不挂载**：零 console、零 pageerror，
   * 同一棵树上 jsdom 契约测试还全绿。逐条读数、已排除的假设与那句能定死成因的断言，
   * 都在 `docs/reference/environment-traps.md` §7 第 606 条。
   *
   * 两枚的共同点：关闭策略**仍然只问那张表**（`closePolicyOf` / `dismissActionFor`），
   * 自绘的只有渲染那一半 —— 也就是"判断共享、渲染分端"。
   *
   * ⚠️ 翻案条件（任一成立就把这两行删掉、改回共享原语）：
   *   ① §7 第 606 条那句断言量出"挂载了但没激活"，并修好 role/焦点陷阱；
   *   ② 计划 §P6 给出 Web 侧可用的共享外壳（同一张表、原生 portal）。
   *
   * 🔴 **② 于 2026-10-28 成立**（P6）：那枚外壳就是
   * `apps/web/src/lib/dialog/WebModalShell.tsx`。所以这一格按**它自己写的出路**走：
   * 危险确认那枚不再自带模态语义，它**消费**共享壳 ⇒ 它那一行**删**，
   * 换成共享壳自己的一行（`aria-modal` 与 `role="dialog"` 各 1，总数不变）。
   * 这不是放宽判据：自绘层的**枚数**从"每枚壳一行"收敛成"一枚壳一行"，
   * 而后面每迁一枚界面，账本只会**少**一行、不会多。
   * ⚠️ ②里"原生 portal"那半句被 §7 第 607 条否证了：共享壳是**就地画在宿主的
   *    堆叠上下文里**（portal + 全局 z 阶梯会让确认层被锚定层压住 ⇒ 画得出来点不动）。
   */
  'apps/web/src/lib/dialog/WebModalShell.tsx': { ariaModal: 1, dialogRole: 1 },
  'apps/web/src/lib/form/useDirtyDismissGuard.tsx': { ariaModal: 1, dialogRole: 1 },
};

/** 剥掉块注释与行注释（注释里的 `aria-modal` 不是落点）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function* walk(dir, acc = []) {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return acc;
  }
  if (st.isFile()) {
    if (SCAN_EXT.test(dir)) yield dir;
    return acc;
  }
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(dir, name), acc);
  }
}

/** 一个文件里的裸 `confirm/alert/prompt` 是不是**真**的原生全局。 */
function bareNativeCalls(code) {
  const hits = [];
  for (const match of code.matchAll(NATIVE_BARE)) {
    const name = BARE_NAME.exec(match[0])?.[1] ?? 'confirm';
    const declaredLocally = BINDING_PATTERNS.some((build) => build(name).test(code));
    if (!declaredLocally) hits.push({ index: match.index, name });
  }
  return hits;
}

/**
 * 纯判据：喂一份 `相对路径 → 源码` 的表，返回违规清单。
 * 拆成纯函数是为了让 `--self-test` 能在内存里造失，不动真实工作区。
 *
 * `isModalScope` 是**分母**：R1 与 R2 的射程不同（落地页只有一个静态站，
 * 适配层 §5 明写本规范不适用于它 —— 但它确实有一枚自绘的移动导航面板，
 * 所以这条排除是**显式的**，不是漏扫）。默认"所有 ts/tsx"给自测用。
 */
function evaluate(files, { nativeLedger, modalLedger, isModalScope = () => true }) {
  const nativeFindings = new Map();
  const modalFindings = new Map();

  for (const [path, source] of files) {
    const code = stripComments(source);
    const explicit = (code.match(NATIVE_EXPLICIT) ?? []).length;
    const bare = bareNativeCalls(code).length;
    const total = explicit + bare;
    if (total > 0) nativeFindings.set(path, total);

    if (/\.tsx?$/.test(path) && isModalScope(path)) {
      const counts = {};
      let any = 0;
      for (const marker of MODAL_MARKERS) {
        const n = (code.match(marker.pattern) ?? []).length;
        counts[marker.key] = n;
        any += n;
      }
      if (any > 0) modalFindings.set(path, counts);
    }
  }

  const violations = [];

  for (const [path, count] of [...nativeFindings].sort()) {
    const allowed = nativeLedger[path];
    if (allowed === undefined) {
      violations.push(
        `R1 新增原生对话框：${path} 有 ${String(count)} 处 —— 账本里没有这一行。\n`
        + '     危险动作不许弹系统框：它放不下后果说明、不能本地化、测不到焦点、\n'
        + '     也做不了"逐字键入名称"。用 `@heyta/ui` 的 `DangerDialog`（档位由\n'
        + '     `@heyta/domain` 的 `resolveDangerTier` 判），只读提示用 `OverlayModal`。',
      );
    } else if (count > allowed) {
      violations.push(
        `R1 原生对话框变多：${path} 现量 ${String(count)} > 账本 ${String(allowed)}。\n`
        + '     这一档的债只许往下走。',
      );
    } else if (count < allowed) {
      violations.push(
        `R1 账本落后：${path} 现量 ${String(count)} < 账本 ${String(allowed)}。\n`
        + `     这是好消息，但要把 scripts/check-overlay.mjs 里这一行改成 ${String(count)}\n`
        + '     （或删掉）—— 门禁的读数就是 T1 的验收口径，落后等于没有证据。',
      );
    }
  }
  for (const [path, allowed] of Object.entries(nativeLedger)) {
    if (allowed > 0 && !nativeFindings.has(path)) {
      violations.push(
        `R1 账本里的文件不再被扫到：${path}（登记 ${String(allowed)} 处）。\n`
        + '     要么它被删了（那就删掉这一行），要么**扫描面缩了** —— 后者是静默失效。',
      );
    }
  }

  for (const [path, counts] of [...modalFindings].sort()) {
    const allowed = modalLedger[path];
    if (allowed === undefined) {
      violations.push(
        `R2 新增自绘模态层：${path} 标了模态语义\n`
        + `     （aria-modal=${String(counts.ariaModal)}, role="dialog"=${String(counts.dialogRole)}），而账本里没有这一行。\n`
        + '     自绘一处，滚动锁 / 焦点陷阱 / 焦点归还 / 关闭策略就再抄一份。\n'
        + '     用 `@heyta/ui` 的 `OverlayModal`（普通模态）或 `DangerDialog`（危险确认）——\n'
        + '     关闭策略从 `packages/ui/src/overlay/dismissal.ts` 那张表取，不在页面里判。',
      );
    } else {
      for (const marker of MODAL_MARKERS) {
        const now = counts[marker.key] ?? 0;
        const was = allowed[marker.key] ?? 0;
        if (now > was) {
          violations.push(`R2 自绘模态变多：${path} 的 ${marker.label} 现量 ${String(now)} > 账本 ${String(was)}。`);
        } else if (now < was) {
          violations.push(
            `R2 账本落后：${path} 的 ${marker.label} 现量 ${String(now)} < 账本 ${String(was)}。\n`
            + '     迁走了一层是进展 —— 把账本这一格改成现量，T5 的验收靠这个数。',
          );
        }
      }
    }
  }
  for (const [path, allowed] of Object.entries(modalLedger)) {
    const seen = modalFindings.get(path);
    const expected = (allowed.ariaModal ?? 0) + (allowed.dialogRole ?? 0);
    if (expected > 0 && (seen === undefined || (seen.ariaModal + seen.dialogRole) === 0)) {
      violations.push(
        `R2 账本里的文件不再被扫到：${path}（登记 aria-modal=${String(allowed.ariaModal)}, role="dialog"=${String(allowed.dialogRole)}）。\n`
        + '     要么已迁走（删掉这一行），要么扫描面/写法变了 —— 后者是静默失效。',
      );
    }
  }

  return { violations, nativeFindings, modalFindings };
}

function readFiles(roots, extTest) {
  const files = new Map();
  for (const root of roots) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs)) {
      if (!extTest.test(f)) continue;
      files.set(relative(ROOT, f).split(/[\\/]/).join('/'), readFileSync(f, 'utf8'));
    }
  }
  return files;
}

// ── 自测 ───────────────────────────────────────────────────────────────────
// 🔴 每条臂**自带一份与它夹具同宇宙的小账本**。
// 拿全量账本去比三份文件的夹具，"账本里的文件不再被扫到"会在每一条臂上都响 ——
// 那样自测证明的是自测自己写错了，不是门禁有牙。
if (process.argv.includes('--self-test')) {
  const PANEL = 'apps/web/src/features/sync/VaultSettingsPanel.tsx';

  const arms = [
    {
      name: '臂 A 账本外的原生框 ⇒ 红',
      files: [['apps/web/src/features/x/NewPanel.tsx', 'if (window.confirm("删?")) del();\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: true,
      want: 'R1 新增原生对话框',
    },
    {
      name: '臂 B 账内读数变多 ⇒ 红',
      files: [[PANEL, 'window.confirm("a"); window.confirm("b");\n']],
      nativeLedger: { [PANEL]: 1 },
      modalLedger: {},
      wantRed: true,
      want: 'R1 原生对话框变多',
    },
    {
      name: '臂 C 读数掉了但账本没跟着改 ⇒ 也红（T1 的证据就靠这条读数）',
      files: [[PANEL, '// 已经迁到 DangerDialog 了\n']],
      nativeLedger: { [PANEL]: 1 },
      modalLedger: {},
      wantRed: true,
      want: 'R1 账本里的文件不再被扫到',
    },
    {
      name: '臂 D 本机声明的同名函数 ⇒ **不红**（AiToolRun.tsx:24 那种）',
      files: [['apps/web/src/features/y/Foo.tsx', 'async function confirm(): Promise<void> {}\nvoid confirm();\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: false,
    },
    {
      name: '臂 E 从 store 注入的同名绑定 ⇒ **不红**（LegalReconfirmSheet.tsx:59 那种）',
      files: [['apps/web/src/features/y/Bar.tsx', 'const confirm = useStore((s) => s.confirm);\nvoid confirm();\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: false,
    },
    {
      name: '臂 F 接口里的方法签名 ⇒ **不红**（legal-recheck/store.ts 那种）',
      files: [['apps/web/src/features/y/Store.ts', 'interface S {\n  confirm(): Promise<void>;\n}\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: false,
    },
    {
      name: '臂 G `onConfirm` 这种带前缀的名字 ⇒ **不红**',
      files: [['apps/web/src/features/y/Baz.tsx', '<X onConfirm={() => run()} />\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: false,
    },
    {
      name: '臂 H 注释里写着 aria-modal ⇒ **不进账本**（不剥注释就会假阳）',
      files: [['apps/web/src/lib/notes.tsx', '/** 这里说 aria-modal 与 role="dialog" 各 3 处 */\nexport const x = 1;\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: false,
    },
    {
      name: '臂 I 新增自绘模态 ⇒ 红',
      files: [['apps/web/src/features/z/New.tsx', '<div role="dialog" aria-modal="true" />\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: true,
      want: 'R2 新增自绘模态层',
    },
    {
      name: '臂 J 账本与现量完全一致 ⇒ 不红（这一臂挡住"永远红"的门禁）',
      files: [['apps/web/src/App.tsx', '<div role="dialog" aria-modal="true" />\n'.repeat(2)]],
      nativeLedger: {},
      modalLedger: { 'apps/web/src/App.tsx': { ariaModal: 2, dialogRole: 2 } },
      wantRed: false,
    },
    {
      name: '臂 K R2 读数涨了 ⇒ 红',
      files: [['apps/web/src/App.tsx', '<div role="dialog" aria-modal="true" />\n'.repeat(3)]],
      nativeLedger: {},
      modalLedger: { 'apps/web/src/App.tsx': { ariaModal: 2, dialogRole: 2 } },
      wantRed: true,
      want: 'R2 自绘模态变多',
    },
    {
      name: '臂 L R2 那一层迁走了但账本没改 ⇒ 红',
      files: [['apps/web/src/App.tsx', '<div />\n']],
      nativeLedger: {},
      modalLedger: { 'apps/web/src/App.tsx': { ariaModal: 1, dialogRole: 1 } },
      wantRed: true,
      want: 'R2 账本里的文件不再被扫到',
    },
    {
      name: '臂 M RN 的 Alert.alert ⇒ 红（原生端的同一种病）',
      files: [['apps/mobile/src/screens/NewScreen.tsx', 'Alert.alert("确定要删除吗？");\n']],
      nativeLedger: {},
      modalLedger: {},
      wantRed: true,
      want: 'R1 新增原生对话框',
    },
  ];

  let failed = 0;
  for (const arm of arms) {
    const { violations } = evaluate(new Map(arm.files), {
      nativeLedger: arm.nativeLedger,
      modalLedger: arm.modalLedger,
    });
    const red = violations.length > 0;
    const reasonHit = arm.want === undefined || violations.some((v) => v.includes(arm.want));
    const ok = red === arm.wantRed && (!arm.wantRed || reasonHit);
    console.log(`${ok ? '✅' : '🔴'} ${arm.name} —— ${red ? `红 ${String(violations.length)} 条` : '绿'}`);
    if (!ok) {
      failed += 1;
      for (const v of violations) console.log(`     ${v.split('\n')[0]}`);
    }
  }
  console.log(`\n自测 ${String(arms.length - failed)}/${String(arms.length)} 臂通过。`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── 真实运行 ───────────────────────────────────────────────────────────────
console.log('─'.repeat(78));
console.log('浮层与反馈债务账本：原生对话框（R1）+ 自绘模态层（R2）');
console.log(`   ROOT = ${relative(process.cwd(), ROOT) || '.'}${process.env.HEYTA_CHECK_ROOT === undefined ? '' : '（HEYTA_CHECK_ROOT 副本）'}`);
console.log(`   R1 范围 = ${NATIVE_SCAN_ROOTS.join(' + ')}`);
console.log(`   R2 范围 = ${MODAL_SCAN_ROOTS.join(' + ')}（只 .tsx）`);
console.log('─'.repeat(78));

const nativeFiles = readFiles(NATIVE_SCAN_ROOTS, SCAN_EXT);
const modalFiles = readFiles(MODAL_SCAN_ROOTS, MODAL_EXT);

if (nativeFiles.size === 0 || modalFiles.size === 0) {
  console.error(
    `🔴 判据失效：扫描面读不到源文件（R1 ${String(nativeFiles.size)} 个 / R2 ${String(modalFiles.size)} 个）。\n`
    + '   范围缺口不报错只会静默失效 —— 这里必须响。',
  );
  process.exit(2);
}

// 🔴 锚点自检：账本里的条目必须**真在扫描面上**。整张账本一条都对不上，
// 说明目录改名或扩展名变了，而不是"债已清完"。
const ledgerPaths = new Set([...Object.keys(NATIVE_LEDGER), ...Object.keys(MODAL_LEDGER)]);
const scanned = new Set([...nativeFiles.keys(), ...modalFiles.keys()]);
const ledgerPresent = [...ledgerPaths].filter((p) => scanned.has(p)).length;
if (ledgerPresent === 0) {
  console.error(
    `🔴 判据失效：账本 ${String(ledgerPaths.size)} 个文件，扫描面 ${String(scanned.size)} 个文件，**交集为空**。\n`
    + '   债不可能一夜清完 —— 是扫描面或路径写法变了。',
  );
  process.exit(2);
}

const { violations, nativeFindings, modalFindings } = evaluate(
  new Map([...nativeFiles, ...modalFiles]),
  {
    nativeLedger: NATIVE_LEDGER,
    modalLedger: MODAL_LEDGER,
    isModalScope: (p) => MODAL_SCAN_ROOTS.some((root) => p.startsWith(`${root}/`)),
  },
);

const nativeTotal = [...nativeFindings.values()].reduce((a, b) => a + b, 0);
const modalTotal = [...modalFindings.values()].reduce((a, c) => a + c.ariaModal + c.dialogRole, 0);
console.log(`   现量：原生框 ${String(nativeTotal)} 处 / ${String(nativeFindings.size)} 文件；`
  + `自绘模态标记 ${String(modalTotal)} 处 / ${String(modalFindings.size)} 文件`);

if (SHOW) {
  console.log('\n── R1 原生对话框 ──');
  for (const [p, n] of [...nativeFindings].sort()) {
    console.log(`   ${p}  现量=${String(n)}  账本=${String(NATIVE_LEDGER[p] ?? 0)}`);
  }
  console.log('\n── R2 自绘模态层 ──');
  for (const [p, c] of [...modalFindings].sort()) {
    const a = MODAL_LEDGER[p] ?? { ariaModal: 0, dialogRole: 0 };
    console.log(`   ${p}  aria-modal 现量=${String(c.ariaModal)}/账本=${String(a.ariaModal)}  role="dialog" 现量=${String(c.dialogRole)}/账本=${String(a.dialogRole)}`);
  }
  console.log('\n（--show 只打印读数，不改动任何东西。）');
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`\n🔴 ${String(violations.length)} 条不通过：`);
  for (const v of violations) console.error(`\n   · ${v}`);
  process.exit(1);
}

console.log('\n✅ 浮层与反馈债务账本：没有新增，读数与账本一致。');
console.log('   判据的正文在全局 Skill `overlay-feedback-patterns`；本仓规则在 docs/agents/overlay-feedback.md。');
console.log('');
