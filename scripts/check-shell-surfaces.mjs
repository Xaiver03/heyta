#!/usr/bin/env node
/**
 * 壳级「这一面到不到得了每一端」门禁 —— W8（三端接线与门禁）
 * ==========================================================
 *
 * 判据出处：`docs/plans/countdown-anniversary.md` 的 `#### ⏹ W8 · 三端接线与门禁`
 * 与交接 `docs/plans/countdown-batch2-handoff.md` §0.5 的 W8 行 ——
 * 那一行写明 W8 缺的正是这里补的东西：
 *
 *   > 🔴 "三端"里**原生壳那半 + 壳级门禁**没有产物
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 为什么现有门禁一条都拦不到"倒数日在某个端上不存在"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   · `check:reachability`（C-8）判的是**实体**层：`EVENT` 有 action、有宿主调用点 ⇒ 绿。
 *     它自己文件头就写着「**哪个字段/能力**粒度不查」，而"这一面在这一端可达"比实体更细。
 *   · `check:layering` 判的是"外壳不许自己拼 op" ⇒ `CountdownScreen` 一条 op 都没拼，绿。
 *   · `apps/mobile/tests/feature-entries.spec.ts` 判的是**移动端自己的**接线与词表 ⇒ 它看不见桌面。
 *   · `e2e/tests/countdown.spec.ts` 跑在 **vite dev 的 web** 上 ⇒ 它天然验不到"打进 .app 的那份产物"。
 *   · `check:macos-shell` / `check:windows-shell` / `check:linux-shell` 判的是**壳起不起来**，
 *     不判**壳里有没有这一面** —— 而 §7 第 82 条那起事故（装出来的是"找不到共享 UI"错误屏、
 *     四轮截图统计全绿）正是这个空档里长出来的。
 *
 * ⇒ **"实体可达 + 壳能起 + web 有这一面"三条合起来，仍然推不出"桌面包里有点得开的那一屏"。**
 *   本门禁钉的就是这条缝：**每一端各自的投递通道**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 🔴 判据的**形状**：台账 ⇄ 锚点 双向对账
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 每个（面 × 端）组合必须在 `LEDGER` 里**恰好一条**声明，二选一：
 *
 *   · `reachable` —— 该端**真的有**这一面，且下面那四条通道判据全过；
 *   · `gap(id, reason)` —— 该端**没有**，且写了编号与理由。
 *
 * 两个方向都会红：
 *
 *   1. **声明 reachable 而锚点没了** ⇒ 红（"界面在说谎"那一族）。
 *   2. **声明 gap 而代码里那条通道其实已经有了** ⇒ 红（**声明过期**）。
 *      这一半不是锦上添花：Linux 那一格今天是"没有 web-dist 通道"，
 *      将来有人把通道补上而忘了把台账翻过来，就会留下一句**对外说假话**的
 *      "Linux 不支持"。反向核对把它变成编译期级别的负担。
 *
 * 缺一端（哪怕整行没写）⇒ 红。**不许有"没登记 = 自动跳过"这一档** ——
 * 那正是 `check-reachability.mjs` 文件头为 ACTION_FAMILIES 写下的同一条纪律。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 逐端判据
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **web**（四条 + 一条产物）
 *   W1 `SHELL_MODULES` 里有这个 key，且 `defaultOn` 是**显式字面量**
 *      （默认值是产品判断，见 §3 W8；没有显式值 = 判断没落纸）。
 *   W2 rail 的 tab **来自常量** `MODULE_VIEW_TABS`，不是 JSX 里硬编码的按钮 ——
 *      `view-tabs.ts:236-243` 记着实测：硬编码的按钮 landing 的对账**看不见**，
 *      "rail 上多了一个 tab 而门禁照样绿"。
 *   W3 `App.tsx` 里有这一面的渲染分支，**并且** rail 的可见集合过 `enabledModules.has(`
 *      —— 这是"关掉的模块**不进 DOM**"（不是 `display:none`）那条承诺的**唯一**机制。
 *      ⚠️ 这条承诺承重：`e2e/tests/motivation.spec.ts` 与 `smoke.spec.ts:29` 的 tab
 *      计数断言都建立在它上面。写成 `display:none` 会让默认关闭的面**仍然被数进去**，
 *      而那两处计数会红 —— 那是实现错了，不是断言错了（W8 工单原话）。
 *   W4 这一面的 `labelKey` **只**出现在 `view-tabs.ts` 一处（防"第二颗按钮"）。
 *   W5 **产物**：`apps/web/dist` 的 JS 里搜得到这一面的 `data-testid`。
 *      判的是"发出去的那份字节里有它"，不是"源码里有它"。
 *      附带**新鲜度**核对（见文件末「为什么查新鲜度」）。
 *
 * **mobile**（台账锚点存在性，**不重写 spec 的判定逻辑**）
 *   M1 `MOBILE_FEATURE_ENTRIES` 里有这个 key；
 *   M2 它登记的那张屏文件存在且**不是占位**（含 `openTaskHost()` 与 `onBack`）；
 *   M3 这一面的 key **没有**长成第 6 个底部 tab（ADR-0015 §4 / P10：
 *      真机验收脚本的坐标都建立在"5 个 tab"上）。
 *   ⚠️ 这三条与 `apps/mobile/tests/feature-entries.spec.ts` **刻意有重叠**：
 *      spec 判的是"接线对不对、词表共不共享"（会红很多次的那种深判据），
 *      本处只判"**台账说这一端覆盖了，而那个锚点此刻还在不在**"。
 *      同一判断不写第三遍 —— 判定逻辑仍以 spec 为唯一去处。
 *
 * **desktop-macos / desktop-windows**（判的是**通道**，不是原生重写）
 *   D1 打包脚本把 `apps/web/dist` 带进包里（mac：`Contents/Resources/web-dist`；
 *      win：exe 旁边的 `web-dist` + `RESULT=WEB_DIST_MISSING` 断言）；
 *   D2 壳**认**那个位置（mac：`Bundle.main.resourceURL/web-dist`；
 *      win：`Directory.Exists(...web-dist)` 决定 `app` 模式 + `SetVirtualHostNameToFolderMapping`）；
 *   D3 装机/打包脚本自己有一条"payload 里有 web-dist"的断言
 *      （`PAYLOAD_WEBDIST=` / `[ -f "$APP/.../web-dist/index.html" ]`）；
 *   D4（**只有本机跑得到**）已经打出来的包里，那份 web-dist 的字节里搜得到这一面的 testID。
 *      非本机 / 没打过包 ⇒ **响亮跳过**并印出该跑哪条命令，**不计为通过**。
 *
 *   🔴 为什么桌面只判通道、不判"原生有没有这一屏"：
 *   `docs/plans/multi-end-unified-strategy.md` §4.3 定案 **M2**（原生壳 + 壳内 WebView
 *   加载 `react-native-web` 产物），§6.3-T3 第 1 条把三端手写的业务 UI 列为**要删的对象**。
 *   ⇒ 新界面进桌面 = **进 web 产物**，在原生壳里再手写一份倒数日反而是**违反既定决策**。
 *   所以桌面这三端的 reachable 判据**必须**落在"web-dist 通道是否真的把共享 UI 带进包里"。
 *
 * **desktop-linux**
 *   L1 台账里是 `gap`，编号与理由齐全；
 *   L2 反向核对：`apps/desktop-linux/` 下**确实仍然没有** `web-dist` 通道
 *      （有 ⇒ 台账过期，红）。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 刻意不判什么（诚实的不完备 > 假的完备）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   · **不跑任何一端的壳。** 真跑起来 + 截图 + 人看是 `check:macos-window` /
 *     `verify:windows-auth` / `pnpm reinstall:all` 的职责（AGENTS §6.1.1、§6.2）。
 *     静态通道判据**不能**替代它们 —— 所以本门禁的 D4 一栏在没打过包时会**明写未取证**。
 *   · **不判鸿蒙。** `apps/mobile` 下没有鸿蒙工程（AGENTS §2 表格里那行 ⚠️），
 *     台账里连"gap"都不写 —— 写了就是把"构建链打通"误读成"有这一端"。
 *   · **不判这一面好不好看。** 设计 token / 文字层级归 `check:design`。
 *   · **不判词条中英同步。** 归 `check:ui-language`。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 故障注入（必须实测能红；跑在 `HEYTA_CHECK_ROOT` 的副本上，不动工作区）
 *
 *   G1 web：`modules.ts` 的 `key: 'countdown'` 那项整条删掉            → W1 红
 *   G2 web：`defaultOn` 那行删掉（隐式默认）                           → W1 红
 *   G3 web：`enabledModules.has(` 从 `App.tsx` 的过滤里拿掉            → W3 红
 *   G4 web：把 `web.shell.views.countdown` 再抄一份到别的组件里        → W4 红
 *   G5 web：`apps/web/dist` 里那个 testID 改掉 / dist 不存在           → W5 红
 *   G6 mobile：`feature-entries.ts` 里 `countdown` 拼成 `count-down`   → M1 红
 *   G7 mobile：`CountdownScreen.tsx` 里的 `openTaskHost()` 注释掉      → M2 红
 *   G8 桌面：`package-app.sh` 那条 `cp -R "$WEB_DIST" ...` 删掉        → D1 红
 *   G9 桌面：`MainWindow.xaml.cs` 的 `web-dist` 探测改成常量 `true`    → D2 红
 *   G10 台账：删掉 Linux 那一行                                        → 覆盖完整性红
 *   G11 台账：Linux 保持 gap，但在 `apps/desktop-linux/` 里加一处
 *       `web-dist` 引用（假装有了）                                    → L2 红（声明过期）
 *   G12 台账：把 Linux 那行改成 `reachable` 而通道并没补               → L1/D1 红
 *   G13 严格模式：`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 且本机没有
 *       "确实是本轮打的"那份包                                        → 产物那两栏红
 *       🔴 这一臂是**补出来的**：第一版这个开关只写在"包不存在"那一个分支里，
 *          于是本机存在**别人的**包时严格模式照样 rc=0（实测 rc=0，期望 1）。
 *   G14 断言 A 的锚点分类（2026-10-05）：`dist/windows/install-capture.txt` 是**未跟踪的
 *       取证产物**，不是源码锚点 —— 缺席只该由 D4 念"未取证"，不该把整条门禁红成"判据失效"
 *       （旧形状下每一枚干净检出都必红，而打印出来的修法教人去改锚点）。
 *       牙没有丢：改成**两侧名字对账**。四臂台架
 *       `node research/tools/mutation-rigs/mutate-shell-surfaces-anchor.mjs`
 *       （A0 原样绿 / A1 ps1 改名红 / A2 scp 行改名红 / A3 删真源码锚点仍红 /
 *        A4a 产物缺席不再红 + A4b 严格模式照样红；臂数以它自己打印的为准）。
 *
 *   （以上 13 臂的**实测读数**逐条记在
 *    `docs/plans/countdown-w8-shell-gate.md` §5 —— 那里是过去式 + 数字，本列表是配方。）
 *
 * 用法：
 *   node scripts/check-shell-surfaces.mjs              # 全部门禁
 *   node scripts/check-shell-surfaces.mjs --face=countdown
 *   HEYTA_REQUIRE_PACKAGED_ARTIFACT=1 …                # 收紧 D4：没打过包 = 红
 *   非零退出 = 有违规，或有判据失效。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

/** D4 是否收紧：CI / 发版前置跑的时候打开，本机没打包不该挡人。 */
const REQUIRE_ARTIFACT = process.env.HEYTA_REQUIRE_PACKAGED_ARTIFACT !== undefined;

/** 产物目录（不是源码）：跳过，与 `check-reachability.mjs` 同一条纪律。 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-types',
  'build',
  'coverage',
  '.expo',
  '.turbo',
  '.git',
  'release',
  'Pods',
  'DerivedData',
]);

/* ========================================================================
 * 面 × 端 的声明
 * ====================================================================== */

/**
 * 被这张门禁管的**面**（feature face）。
 *
 * 🔴 为什么这里只有 `countdown` 一项：本单（W8）的判据原文就是"倒数日这一面在四端
 * 各自 reachable"。其余 7 个功能域**没有逐项测过**，把它们顺手抄进台账就等于
 * 造出一张"看起来全覆盖、实际一行没验"的表 —— 那是假的完备。
 * 新增一行的成本是刻意的：**每一格都要有人去把上面那套通道判据跑一遍**。
 *
 * ⚠️ `key` 必须是 `packages/domain/src/feature-modules.ts` 的 `FEATURE_MODULE_KEYS`
 * 里的成员 —— 见判据 A3。
 */
const FACES = [
  {
    key: 'countdown',
    label: '倒数纪念日',
    /** web 产物里的锚点：`data-testid`（真渲染才有的那个，不是词条）。 */
    webTestID: 'countdown-view',
    /** 移动端那张屏的组件名 = `apps/mobile/src/screens/<screen>.tsx`。 */
    mobileScreen: 'CountdownScreen',
    /** 移动端入口行的 testID（设备验收脚本指的就是它）。 */
    mobileTestID: 'profile-entry-countdown',
  },
];

/** 全部参与对账的端。**缺一行 = 红**（不许"没登记就跳过"）。 */
const ENDS = ['web', 'mobile', 'desktop-macos', 'desktop-windows', 'desktop-linux'];

/**
 * 台账：每个 (face, end) **恰好一条**。
 * `basis` 是给人看的"凭什么"，**不参与判定** —— 判定只看下面那些锚点。
 */
const LEDGER = [
  {
    face: 'countdown',
    end: 'web',
    status: 'reachable',
    basis: 'SHELL_MODULES + MODULE_VIEW_TABS + App.tsx 渲染分支（W5 落地，W8 收进共享词表）',
  },
  {
    face: 'countdown',
    end: 'mobile',
    status: 'reachable',
    basis: 'MOBILE_FEATURE_ENTRIES → ProfileScreen 第二层入口 → CountdownScreen（W8 移动半）',
  },
  {
    face: 'countdown',
    end: 'desktop-macos',
    status: 'reachable',
    basis: 'M2 路线：package-app.sh 把 apps/web/dist 打进 Contents/Resources/web-dist',
  },
  {
    face: 'countdown',
    end: 'desktop-windows',
    status: 'reachable',
    basis: 'M2 路线：package-msix.ps1 把 apps/web/dist 装成 exe 旁边 web-dist + 有断言',
  },
  {
    face: 'countdown',
    end: 'desktop-linux',
    status: 'gap',
    gapId: 'W8-GAP-L1',
    reason:
      'Linux 壳没有 web-dist 通道（它是 JSC + 手写 GTK UI，没有 WebView），' +
      '共享 UI 进不了包 ⇒ 这一面在 Linux 上不可达。' +
      '补法不是"给 Linux 手写一屏"（multi-end-unified-strategy §4.3 定案 M2、' +
      '§6.3-T3 第 1 条把手写业务 UI 列为要删的对象），而是先给它一条 web-dist 通道。',
  },
];

/* ========================================================================
 * 锚点文件
 * ====================================================================== */

const FILES = {
  featureModules: 'packages/domain/src/feature-modules.ts',
  webModules: 'apps/web/src/features/shell/modules.ts',
  webViewTabs: 'apps/web/src/features/shell/view-tabs.ts',
  webApp: 'apps/web/src/App.tsx',
  webDist: 'apps/web/dist',
  webSrc: 'apps/web/src',
  mobileEntries: 'apps/mobile/src/nav/feature-entries.ts',
  mobileTabBar: 'apps/mobile/src/nav/TabBar.tsx',
  macPackage: 'apps/desktop-macos/scripts/package-app.sh',
  macShell: 'apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift',
  winPackage: 'apps/desktop-windows/scripts/package-msix.ps1',
  winCapture: 'apps/desktop-windows/scripts/install-and-capture.ps1',
  winShell: 'apps/desktop-windows/HeytaWindows/MainWindow.xaml.cs',
  linuxDir: 'apps/desktop-linux',
  /** 本机打包产物（`package-app.sh` 的默认 OUT_DIR；没有就是"没打过包"）。 */
  macAppDist: '/tmp/heyta-macos-dist/Heyta.app/Contents/Resources/web-dist',
  /**
   * Windows 那一端的**取证文件**（W8-GAP-W1，04 08:2x）。包在打包机上，本机拿不到
   * 那份字节 —— 但 `package-msix.sh:78` 一直会把远端 `install-capture.txt` scp 回
   * `$OUT_DIR`（`dist/windows/`）。原先这一格写死 `artifactWebDist: null`，于是在
   * `:821` **读 env 覆盖之前**就短路成"未取证"，那条通道结构性关不掉。
   * 现在判的是那份事实文件里的机读行。
   */
  winFacts: 'dist/windows/install-capture.txt',
};

/* ========================================================================
 * 工具
 * ====================================================================== */

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readSource(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  return stripComments(readFileSync(abs, 'utf8'));
}

/** 文件内容的 sha256（D4 的"这份包是不是我这棵树打的"就靠它）。 */
function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function* walkSources(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.(tsx?|jsx?|mjs|cjs|ps1|sh|swift|c|h)$/.test(target)) yield target;
    return;
  }
  let entries;
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walkSources(join(target, name));
  }
}

/**
 * 取 `const NAME ... = [ … ]` 那一整块的内容（剥注释后的源码）。
 *
 * ⚠️ 终止符取**第一个顶格的 `]`**（本仓库 prettier 会把数组闭合放在第 0 列），
 * 刻意**不**要求它后面跟 `];` —— 那些注册表的尾巴各不相同：
 * `FEATURE_MODULE_KEYS` 是 `] as const;`、`MOBILE_FEATURE_ENTRIES` 是
 * `] as const satisfies readonly MobileFeatureEntry[];`。写死 `];` 的话
 * 症状不是报错而是**解析不到块 ⇒ 该项被判成不存在**，最难归因的那种假红。
 */
function arrayBlock(src, name) {
  const m = new RegExp(`const\\s+${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\]`).exec(src);
  return m === null ? null : m[1];
}

let newestMtimeCache = new Map();
/** 目录树里最新的 mtime（跳过产物目录）。 */
function newestMtime(relDir) {
  const cached = newestMtimeCache.get(relDir);
  if (cached !== undefined) return cached;
  const abs = join(ROOT, relDir);
  let newest = 0;
  if (existsSync(abs)) {
    for (const f of walkSources(abs)) {
      try {
        const st = statSync(f);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch {
        /*  racing：拿不到就当没它 */
      }
    }
  }
  newestMtimeCache.set(relDir, newest);
  return newest;
}

/**
 * **不按扩展名过滤**的遍历（`Makefile` / `*.desktop` / `control` 这些没有后缀的
 * 打包相关文件也在内）。
 *
 * 🔴 为什么 L2 必须用它：arm D 第一次实测**没红** —— 我把假的 `web-dist` 引用
 * 追加进了 `apps/desktop-linux/Makefile`，而 `walkSources` 按扩展名过滤，
 * 没有后缀的文件被跳掉 ⇒ "反向核对"漏掉了**恰好最可能藏通道改动的那个文件**。
 * 一条判据扫不到 ≠ 这件事没发生（§7 元规则 1：先怀疑探针）。
 */
function* walkAll(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return;
  }
  if (st.isFile()) {
    yield target;
    return;
  }
  let entries;
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walkAll(join(target, name));
  }
}

/* ========================================================================
 * 输出
 * ====================================================================== */

let failed = false;
const gaps = [];
const unverified = [];
const results = [];

function record(end, face, ok, lines, kind = 'judge') {
  results.push({ end, face, ok, kind });
  // 🔴 跳过**不许印成 ✅** —— 那样在终端上一扫就是"五端全绿"，
  // 而这一栏根本没跑（元规则 2：一条永远通过的判据比没有判据更糟）。
  if (kind === 'skip') console.log(`   ⚠️ [${end}] ${face} —— 未取证，不计为通过`);
  else if (ok) console.log(`   ✅ [${end}] ${face}`);
  else {
    failed = true;
    console.log(`   🔴 [${end}] ${face}`);
  }
  for (const l of lines) console.log(`      ${l}`);
}

function pass(end, face, lines) {
  record(end, face, true, lines);
}

function fail(end, face, lines) {
  record(end, face, false, lines);
}

/**
 * 响亮跳过：印出来、算进"未取证"，**不计为通过也不计为红**。
 *
 * 🔴 但 `HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 时**必须**折成红 —— 而且这一条要覆盖
 * **所有**未取证的路径（没这个包 / 有包但不是本轮的 / 这台机器上根本没有这一端）。
 * 实测踩过：这个开关第一版只写在"包不存在"那一个分支里，于是本机存在
 * **别人的**包时严格模式照样 rc=0 —— 一句写在文档里的假逃生门比没有逃生门更糟。
 */
function skipped(end, face, lines) {
  if (REQUIRE_ARTIFACT) {
    record(end, face, false, [
      '🔴 HEYTA_REQUIRE_PACKAGED_ARTIFACT=1 ⇒ "未取证"按红处理',
      ...lines,
    ]);
    return;
  }
  record(end, face, true, lines, 'skip');
  unverified.push(`${end} / ${face}`);
}

/* ========================================================================
 * 判据 A：锚点自检（扫不到 = 判据失效，不是通过）
 * ====================================================================== */

console.log('─'.repeat(78));
console.log('壳级「这一面到不到得了每一端」门禁（W8）');
console.log(
  `   ROOT = ${relative(process.cwd(), ROOT) || '.'}` +
    (process.env.HEYTA_CHECK_ROOT === undefined ? '' : '（HEYTA_CHECK_ROOT 副本）'),
);
console.log(`   端 = ${ENDS.join(' / ')}`);
console.log('─'.repeat(78));

const argv = process.argv.slice(2);
const faceArg = argv.find((a) => a.startsWith('--face='));
const ONLY_FACE = faceArg === undefined ? null : faceArg.slice('--face='.length);
if (ONLY_FACE !== null) console.log(`   ⚠️ --face=${ONLY_FACE}：只跑一个面`);

console.log('\n【断言 A】判据的锚点必须真的扫得到（扫不到 = 判据失效）\n');

const anchorErrors = [];
const sources = new Map();
/**
 * 🔴 **取证产物不是源码锚点** —— 这一格曾经把整条门禁红成"判据失效"，而它量到的
 * 只是"这棵树上没打过 Windows 包"：`winFacts` 是 `package-msix.sh` 从打包机 scp 回来的
 * **未跟踪产物**（`dist/` 整个被 gitignore），任何一枚干净检出上它都不存在
 * ⇒ `pnpm check` 在 CI / 新克隆上**结构性必红**，而它打印的修法是"把锚点同步回本脚本"，
 * 那是把人往错的方向推（同一个仓库刚为另一条门禁修过这一族：`fe3e9e7d` 浅克隆 27 枚全红）。
 * 这个文件"在不在本地"由 **D4 那一栏**判，判得比这里对：缺 ⇒ 响亮未取证、
 * 在而缺判据行 ⇒ 未取证并点名生产方、行在而值错 ⇒ 红，`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1`
 * 再把"未取证"折成红（G13 那一臂）。
 *
 * 但断言 A 原本想挡的那件事**不能跟着丢**：生产方把文件改名 ⇒ 门禁读一个不存在的旧名，
 * D4 从此永远念"未取证"而没人发现。所以这里换成**两侧名字对账**（读的是源码，
 * 在任何树上都成立）：门禁锚点的 basename 必须出现在写它的那两行生产方代码里。
 */
const ARTIFACT_ANCHORS = new Set(['winFacts']);
for (const [name, rel] of Object.entries(FILES)) {
  if (rel.startsWith('/') || !/\.\w+$/.test(rel)) continue; // 产物目录 / 绝对路径不是源文件
  if (ARTIFACT_ANCHORS.has(name)) continue;
  const code = readSource(rel);
  if (code === null) {
    anchorErrors.push(`   · ${name} 扫不到：${rel}`);
    continue;
  }
  sources.set(name, code);
}
{
  const factsBase = basename(FILES.winFacts);
  const producers = [
    ['apps/desktop-windows/scripts/package-msix.sh', new RegExp(`scp[^\\n]*${factsBase}`)],
    ['apps/desktop-windows/scripts/install-and-capture.ps1', new RegExp(`\\$factsFile[^\\n]*${factsBase}`)],
  ];
  for (const [file, re] of producers) {
    const raw = readSource(file);
    if (raw === null) {
      anchorErrors.push(`   · 取证事实的生产方读不到：${file}（对账做不了，判红不判跳过）`);
    } else if (!re.test(raw)) {
      anchorErrors.push(
        `   · 锚点漂移：门禁读 ${FILES.winFacts}（basename ${factsBase}），` +
          `而 ${file} 里已经不再写/取这个名字 ⇒ D4 会永远念"未取证"而没人发现`,
      );
    }
  }
}


/** A1：共享词表必须解析得出成员。 */
const vocabSrc = sources.get('featureModules');
let vocab = null;
if (vocabSrc === undefined) {
  anchorErrors.push('   · packages/domain/src/feature-modules.ts 读不到（词表的唯一去处）');
} else {
  const block = arrayBlock(vocabSrc, 'FEATURE_MODULE_KEYS');
  if (block === null) {
    anchorErrors.push('   · 找不到 `const FEATURE_MODULE_KEYS = [...]` —— 词表改名了，本门禁已经不能做事');
  } else {
    vocab = [...block.matchAll(/'([a-zA-Z-]+)'/g)].map((m) => m[1]);
    if (vocab.length === 0) anchorErrors.push('   · FEATURE_MODULE_KEYS 解析出 0 项');
  }}
if (vocab !== null && vocab.length > 0) {
  console.log(`   ✅ 共享词表 FEATURE_MODULE_KEYS：${String(vocab.length)} 项（${vocab.join(', ')}）`);
}

/** A2：web 开关表 / 移动端注册表 / rail 常量三个块都要解析得出东西。 */
/**
 * 按**出现顺序**配对：`key:` 开一项，后面的 `defaultOn` / `labelKey` 归它。
 *
 * ⚠️ 不用"每项一个正则块"的写法：那种写法对最后一项的闭合形状极敏感，
 * 而它坏了的症状是**少解析一项**（于是 W1 对着不存在的项报红，或更糟：对着
 * 不存在的项报"没有 defaultOn"）。顺序配对只依赖 `key:` 这一种形状。
 * ⚠️ `key` 前面要排除字母：`labelKey:` 里也含 `key:`。
 */
function parseModuleEntries(code, varName) {
  const block = arrayBlock(code, varName);
  if (block === null) return null;
  const out = [];
  let cur = null;
  const re = /(?:^|[^A-Za-z])key:\s*'([^']+)'|defaultOn:\s*(true|false)|labelKey:\s*'([^']+)'/g;
  for (const m of block.matchAll(re)) {
    if (m[1] !== undefined) {
      cur = { key: m[1], defaultOn: null, labelKey: null };
      out.push(cur);
    } else if (m[2] !== undefined && cur !== null) {
      cur.defaultOn = m[2] === 'true';
    } else if (m[3] !== undefined && cur !== null && cur.labelKey === null) {
      cur.labelKey = m[3];
    }
  }
  return out;
}

const webModules = parseModuleEntries(sources.get('webModules') ?? '', 'SHELL_MODULES');
if (webModules === null || webModules.length === 0) {
  anchorErrors.push(
    '   · web 的 `SHELL_MODULES` 解析不出任何一项 —— 形状变了，W1 的判定已经失效（**不当作通过**）',
  );
} else {
  console.log(`   ✅ web SHELL_MODULES：${String(webModules.length)} 项`);
}

const viewTabs = parseModuleEntries(sources.get('webViewTabs') ?? '', 'MODULE_VIEW_TABS');
const viewTabKeys = viewTabs?.map((t) => t.key) ?? null;
if (viewTabKeys === null || viewTabKeys.length === 0) {
  anchorErrors.push('   · `MODULE_VIEW_TABS` 解析不出任何一项 —— W2 已经失效');
} else {
  console.log(`   ✅ web MODULE_VIEW_TABS：${String(viewTabKeys.length)} 个 rail tab`);
}

const mobileBlock = arrayBlock(sources.get('mobileEntries') ?? '', 'MOBILE_FEATURE_ENTRIES');
const mobileKeys =
  mobileBlock === null ? null : [...mobileBlock.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
if (mobileKeys === null || mobileKeys.length === 0) {
  anchorErrors.push('   · `MOBILE_FEATURE_ENTRIES` 解析不出任何一项 —— M1 已经失效');
} else {
  console.log(`   ✅ mobile MOBILE_FEATURE_ENTRIES：${String(mobileKeys.length)} 项（${mobileKeys.join(', ')}）`);
}

/** A3：台账与词表的形状。 */
const faceKeys = FACES.map((f) => f.key);
for (const k of faceKeys) {
  if (vocab !== null && !vocab.includes(k)) {
    anchorErrors.push(`   · 台账里的面 "${k}" 不在共享词表 FEATURE_MODULE_KEYS 里 —— 抄件已经分叉`);
  }
}
for (const end of ENDS) {
  for (const k of faceKeys) {
    const rows = LEDGER.filter((r) => r.face === k && r.end === end);
    if (rows.length === 0) {
      anchorErrors.push(`   · 台账缺 (面=${k}, 端=${end}) 这一格 —— **不许用"没登记"当自动跳过**`);
    } else if (rows.length > 1) {
      anchorErrors.push(`   · 台账有 ${String(rows.length)} 条 (面=${k}, 端=${end}) —— 判定会挑其中一份执行`);
    } else if (rows[0].status === 'gap' && (rows[0].gapId === undefined || rows[0].reason === undefined)) {
      anchorErrors.push(`   · (面=${k}, 端=${end}) 声明 gap 但没写编号或理由`);
    } else if (rows[0].status !== 'gap' && rows[0].status !== 'reachable') {
      anchorErrors.push(`   · (面=${k}, 端=${end}) 的 status="${String(rows[0].status)}" 不是 reachable/gap 之一`);
    }
  }
}

if (anchorErrors.length > 0) {
  failed = true;
  console.log('\n   🔴 断言 A 不通过（判据失效，不是"没有违规"）：');
  for (const l of anchorErrors) console.log(l);
  console.log(
    '\n      ⇒ 修法：把锚点同步回本脚本，**不要**把判据放宽成"扫不到就通过"。\n' +
      '      ⚠️ 这一条红**只**关于"门禁读的源码锚点与生产方对不上"。' +
      '"这棵树上没打过包"不是这一条 —— 那走 D4 那一栏（响亮未取证，' +
      '`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 才折成红），别为了它去改这里的锚点。',
  );
} else {
  console.log('\n   ✅ 断言 A 通过：词表 / 两张注册表 / rail 常量 / 台账形状都对得上。');
}

/* ========================================================================
 * web
 * ====================================================================== */

console.log('\n【web】开关表 + rail 常量 + 渲染分支 + 不进 DOM 的机制 + **产物**\n');

for (const face of FACES) {
  if (ONLY_FACE !== null && face.key !== ONLY_FACE) continue;
  const entry = webModules?.find((m) => m.key === face.key);
  const detail = [];
  let ok = true;

  // W1
  if (entry === undefined) {
    ok = false;
    detail.push(`🔴 W1 \`SHELL_MODULES\` 里没有 "${face.key}" 这一项 ⇒ 设置页根本关不了它`);
  } else if (entry.defaultOn === null) {
    ok = false;
    detail.push(`🔴 W1 "${face.key}" 没有**显式**的 defaultOn ⇒ 默认值是产品判断，必须落纸`);
  } else {
    detail.push(`W1 在开关表里，defaultOn = ${String(entry.defaultOn)}（显式）`);
  }

  // W2
  if (viewTabKeys === null || !viewTabKeys.includes(face.key)) {
    ok = false;
    detail.push(`🔴 W2 rail 常量 MODULE_VIEW_TABS 里没有 "${face.key}" ⇒ 开关开了也没有按钮`);
  } else {
    detail.push('W2 rail 的 tab 来自 MODULE_VIEW_TABS（不是硬编码按钮）');
  }

  // W3
  const appCode = sources.get('webApp') ?? '';
  const routed = new RegExp(`contentView\\s*===\\s*'${face.key}'`).test(appCode);
  const gated = /enabledModules\.has\(/.test(appCode);
  if (!routed || !gated) {
    ok = false;
    if (!routed) detail.push(`🔴 W3 App.tsx 没有 contentView === '${face.key}' 的渲染分支`);
    if (!gated) {
      detail.push(
        '🔴 W3 可见集合不再过 `enabledModules.has(` ⇒ "关掉的模块不进 DOM"这条承诺没人守了，' +
          'tab 计数断言会红（那是实现错了，不要去改断言）',
      );
    }
  } else {
    detail.push('W3 有渲染分支，且可见集合过 enabledModules.has(（关掉 = 不进 DOM）');
  }

  // W4 —— 🔴 用的是 **rail 那颗按钮的词条**（`MODULE_VIEW_TABS` 的 labelKey），
  // 不是开关表里那条模块说明（`SHELL_MODULES` 的 labelKey 住在 modules.ts，
  // 拿错了会永远判红 —— 本门禁第一次跑就是这样红的）。
  const railLabel = viewTabs?.find((t) => t.key === face.key)?.labelKey ?? null;
  if (railLabel === null) {
    ok = false;
    detail.push('🔴 W4 取不到这一面在 MODULE_VIEW_TABS 里的 labelKey（W2 已红）');
  } else {
    const holders = [];
    for (const f of walkSources(join(ROOT, 'apps/web/src'))) {
      const raw = readFileSync(f, 'utf8');
      if (!raw.includes(`'${railLabel}'`)) continue;
      // 注释里出现不算（同一文件被引用两次也只算一处）
      if (stripComments(raw).includes(`'${railLabel}'`)) holders.push(relative(ROOT, f));
    }
    if (holders.length !== 1 || holders[0] !== FILES.webViewTabs) {
      ok = false;
      detail.push(
        `🔴 W4 "${railLabel}" 出现在 ${String(holders.length)} 个文件里：${holders.join(', ') || '（一处都没有）'}` +
          ` —— 期望恰好 view-tabs.ts 一处。第二处就是那颗"对账看不见的按钮"`,
      );
    } else {
      detail.push(`W4 rail 词条 ${railLabel} 只在 view-tabs.ts 一处消费（没有第二颗硬编码按钮）`);
    }
  }

  // W5 产物
  const distDir = join(ROOT, FILES.webDist);
  if (!existsSync(distDir)) {
    ok = false;
    detail.push(`🔴 W5 产物不存在：${FILES.webDist} ⇒ 先跑 pnpm --filter @heyta/web build`);
  } else {
    const hits = [];
    for (const f of walkSources(distDir)) {
      if (!/\.(js|html)$/.test(f)) continue;
      if (readFileSync(f, 'utf8').includes(face.webTestID)) hits.push(relative(ROOT, f));
    }
    if (hits.length === 0) {
      ok = false;
      detail.push(`🔴 W5 已构建产物里搜不到 testID "${face.webTestID}" ⇒ 这一面**没进要发出去的字节**`);
    } else {
      // 新鲜度：产物必须不早于 web 源码（§2.2 第 1 条：19 枚红全是读了旧 dist）
      const srcNewest = newestMtime(FILES.webSrc);
      const distNewest = newestMtime(FILES.webDist);
      if (distNewest < srcNewest) {
        ok = false;
        detail.push(
          `🔴 W5 产物比源码旧（dist ${new Date(distNewest).toISOString()} < src ` +
            `${new Date(srcNewest).toISOString()}）⇒ 查的是上一个版本。跑 pnpm --filter @heyta/web build`,
        );
      } else {
        detail.push(
          `W5 产物里有 "${face.webTestID}"（${hits.length} 个文件），且 dist 不早于 apps/web/src`,
        );
      }
    }
  }

  if (ok) pass('web', face.key, detail);
  else fail('web', face.key, detail);
}

/* ========================================================================
 * mobile
 * ====================================================================== */

console.log('\n【mobile】台账锚点：入口在注册表里、那张屏不是占位、没长成第 6 个 tab\n');

const tabBarBlock = (() => {
  const code = sources.get('mobileTabBar') ?? '';
  const m = /export\s+const\s+TABS\s*=\s*\[([\s\S]*?)\n\]/.exec(code);
  return m === null ? null : [...m[1].matchAll(/key:\s*'([^']+)'/g)].map((x) => x[1]);
})();
if (tabBarBlock === null) {
  failed = true;
  console.log('   🔴 断言 A 补：TabBar 的 TABS 解析不出项 ⇒ M3 已经失效（**不当作通过**）');
} else {
  console.log(`   （锚点）底部 tab = ${String(tabBarBlock.length)} 个：${tabBarBlock.join(', ')}`);
}

for (const face of FACES) {
  if (ONLY_FACE !== null && face.key !== ONLY_FACE) continue;
  const detail = [];
  let ok = true;

  if (mobileKeys === null || !mobileKeys.includes(face.key)) {
    ok = false;
    detail.push(`🔴 M1 MOBILE_FEATURE_ENTRIES 里没有 "${face.key}"`);
  } else {
    detail.push(`M1 入口在注册表里（「我的」页那 ${String(mobileKeys.length)} 行之一）`);
  }

  const screenFile = join(ROOT, 'apps/mobile/src/screens', `${face.mobileScreen}.tsx`);
  if (!existsSync(screenFile)) {
    ok = false;
    detail.push(`🔴 M2 那张屏不存在：apps/mobile/src/screens/${face.mobileScreen}.tsx`);
  } else {
    const code = stripComments(readFileSync(screenFile, 'utf8'));
    const reads = code.includes('openTaskHost()');
    const back = /\bonBack\b/.test(code);
    const testID = code.includes(face.mobileTestID) || code.includes('Countdown');
    if (!reads || !back) {
      ok = false;
      if (!reads) detail.push(`🔴 M2 ${face.mobileScreen} 没打开宿主 ⇒ 那一屏读到的是空的（占位）`);
      if (!back) detail.push(`🔴 M2 ${face.mobileScreen} 没有 onBack ⇒ 进去了出不来`);
    } else {
      detail.push(`M2 ${face.mobileScreen} 读物化状态（openTaskHost）且有 onBack${testID ? '' : '（无 testID 提示）'}`);
    }
  }

  if (tabBarBlock !== null && tabBarBlock.includes(face.key)) {
    ok = false;
    detail.push(
      `🔴 M3 "${face.key}" 变成了底部 tab —— ADR-0015 §4 / P10 的连带：` +
        '真机验收脚本点的是"5 个 tab"的坐标，都要重算',
    );
  } else {
    detail.push(`M3 没占底部 tab（底部仍是 ${String(tabBarBlock?.length ?? 0)} 个）`);
  }

  if (ok) pass('mobile', face.key, detail);
  else fail('mobile', face.key, detail);
}

/* ========================================================================
 * 桌面三端：通道
 * ====================================================================== */

/**
 * 一条通道的形状：{ 打包脚本, 壳解析, 装机/打包自断言 } —— 三处都要有，
 * 少任何一处都能造出"装了但里面没有产品"那一格（§7 第 82 条）。
 */
const DESKTOP_CHANNELS = {
  'desktop-macos': {
    package: {
      file: FILES.macPackage,
      label: '把 apps/web/dist 拷进 Contents/Resources/web-dist',
      re: /cp\s+-R\s+"\$WEB_DIST"\s+"\$APP\/Contents\/Resources\/web-dist"/,
    },
    resolve: {
      file: FILES.macShell,
      label: '壳从 Bundle.main.resourceURL 找 web-dist',
      re: /resourceURL\?\.appendingPathComponent\("web-dist"\)/,
    },
    assert: {
      file: FILES.macPackage,
      label: '打包脚本对 index.html 有断言',
      re: /\[\s*-f\s*"\$APP\/Contents\/Resources\/web-dist\/index\.html"/,
    },
    artifactWebDist: FILES.macAppDist,
    hostLabel: 'macOS',
    produceCmd: 'bash apps/desktop-macos/scripts/package-app.sh  或  pnpm reinstall:desktop',
  },
  'desktop-windows': {
    package: {
      file: FILES.winPackage,
      label: '把 apps\\web\\dist 拷成 exe 旁边的 web-dist',
      re: /Copy-Item\s+\$webSrc\s+\$webTarget/,
    },
    resolve: {
      file: FILES.winShell,
      label: '壳按"有没有 web-dist"决定 app 模式',
      re: /Directory\.Exists\(Path\.Combine\(AppContext\.BaseDirectory,\s*"web-dist"\)\)/,
    },
    assert: {
      file: FILES.winPackage,
      label: '打包脚本对 web-dist 有失败断言（WEB_DIST_MISSING）',
      re: /RESULT=WEB_DIST_MISSING/,
    },
    artifactWebDist: null, // Windows 没有本机可见的包字节 ⇒ 走下面那份**事实文件**通道
    artifactFacts: FILES.winFacts,
    hostLabel: 'Windows',
    produceCmd: 'pnpm reinstall:desktop（走 windows-pc）／ pnpm verify:windows-auth',
  },
};

/** 读远端取回的事实文件：只认 `KEY=VALUE` 行，注释与空行跳过。 */
function parseFactLines(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(t);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const WIN_FACT_KEYS = [
  'PAYLOAD_WEBDIST',
  'PAYLOAD_INDEX_SHA',
  'PAYLOAD_CHUNK_TOTAL',
  'PAYLOAD_CHUNK_PRESENT',
];

console.log('\n【桌面三端】判的是 **web-dist 通道**，不是"原生有没有手写这一屏"\n');
console.log(
  '   （依据：multi-end-unified-strategy §4.3 定案 M2 + §6.3-T3 第 1 条把手写业务 UI 列为要删的对象，',
);
console.log('     所以"这一面进桌面"= "它进了 apps/web/dist，而 dist 被打进了包"。）\n');

for (const end of ['desktop-macos', 'desktop-windows']) {
  const channel = DESKTOP_CHANNELS[end];
  for (const face of FACES) {
    if (ONLY_FACE !== null && face.key !== ONLY_FACE) continue;
    const detail = [];
    let ok = true;
    for (const [step, spec] of [
      ['D1 打包', channel.package],
      ['D2 壳认这个位置', channel.resolve],
      ['D3 自断言', channel.assert],
    ]) {
      const abs = join(ROOT, spec.file);
      if (!existsSync(abs)) {
        ok = false;
        detail.push(`🔴 ${step}：文件读不到 ${spec.file}`);
        continue;
      }
      // 打包脚本是 shell / powershell：判的是"脚本里有没有这条命令"，
      // 所以读**原文**（剥掉注释反而会把 `set -` 之类的行弄坏）。
      // ⚠️ 代价：有人把这条 `cp` **注释掉**冒充存在 —— 那一档由 D4（包里字节）兜，
      //    而 D4 在本机没打包时会**响亮地报未取证**，不会静默算过。
      const raw = readFileSync(abs, 'utf8');
      if (!spec.re.test(raw)) {
        ok = false;
        detail.push(`🔴 ${step}：${spec.label} —— 这条通道在 ${spec.file} 里**没了**`);
      } else {
        detail.push(`${step}：${spec.label} ✅`);
      }
    }

    // D4：包里那份 web-dist 的字节里到底有没有这一面（只有本机打过包才跑得到）
    //
    // 🔴 Windows 走的是**另一条 D4**（W8-GAP-W1）：包在打包机上，本机拿不到那份字节，
    //    但 `package-msix.sh:78` 一直会把远端的 `install-capture.txt` scp 回来。
    //    判据因此建在"远端测出来的事实 + 与本地构建的 sha 对账"上，而不是"本机存在某目录"。
    //    原先这一格写死 `artifactWebDist: null`，于是它在**读 env 覆盖之前**就短路了
    //    （`:821` 在 `:831` 之前），那条通道结构性关不掉 —— 不是没取证，是取证进不来。
    if (channel.artifactFacts) {
      const envKey = `HEYTA_${channel.hostLabel.toUpperCase()}_FACTS`;
      const factsPath = process.env[envKey] ?? join(ROOT, channel.artifactFacts);
      if (!existsSync(factsPath)) {
        skipped(end, `${face.key} · 产物`, [
          `⚠️ 产物判据未跑：读不到远端取证文件 ${factsPath}（这台机器上没打过 ${channel.hostLabel} 包），`,
          `      要取证：${channel.produceCmd}`,
        ]);
      } else {
        const facts = parseFactLines(readFileSync(factsPath, 'utf8'));
        const missing = WIN_FACT_KEYS.filter((k) => !(k in facts));
        if (missing.length > 0) {
          // 🔴 "生产方没测这些事实" = **未取证**，不是产品红 —— 本门禁的既有规矩是
          //    未取证响亮跳过、`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 才折成红（G13 那一臂）。
          //    理由不是客气：`dist/windows/install-capture.txt` 是**上一趟打包**留下的，
          //    那时 ps1 还不发这几行 ⇒ 判红就是把"我的判据比现场新"当成产品缺陷
          //    （§7 第 50 条那一族：状态对，但那条承诺没生效在被打测的那一趟上）。
          //    牙齿不丢：行**在而值错**（下面三条）仍然是红，严格模式下"行不在"也是红。
          skipped(end, `${face.key} · 产物`, [
            `⚠️ 取证文件在 ${factsPath}，但缺判据行 ${missing.join(' / ')}`,
            '      ⇒ 那一趟打包用的还是**没测这些事实的旧生产方**，本栏不计为通过。',
            `      补上生产方：apps/desktop-windows/scripts/install-and-capture.ps1，再跑 ${channel.produceCmd}`,
          ]);
        } else if (facts.PAYLOAD_WEBDIST !== 'True') {
          ok = false;
          detail.push(
            `🔴 D4：装出来的包里**没有** web-dist/index.html（PAYLOAD_WEBDIST=${facts.PAYLOAD_WEBDIST}）` +
              ` ⇒ 壳会退回 spike 页，屏幕上不是共享 UI（§7 第 82 条那一族）`,
          );
        } else if (
          !/^\d+$/.test(facts.PAYLOAD_CHUNK_TOTAL) ||
          Number(facts.PAYLOAD_CHUNK_TOTAL) < 1 ||
          facts.PAYLOAD_CHUNK_PRESENT !== facts.PAYLOAD_CHUNK_TOTAL
        ) {
          ok = false;
          detail.push(
            `🔴 D4：index.html 引用的资源文件没全部落在包里（present ${facts.PAYLOAD_CHUNK_PRESENT} / total ${facts.PAYLOAD_CHUNK_TOTAL}）` +
              ` ⇒ 窗口能开而内容是空白，正是"入口 HTML 进去了、chunk 没进去"那个形状`,
          );
        } else {
          // 对账：远端那份 index.html 的 sha 必须等于**本工作树刚构建出来的**那份。
          // vite 把内容哈希后的 chunk 名写进 index.html ⇒ HTML 逐字相同 = 整张资源图相同，
          // 于是"本地这份 dist 里有这一面"才能**迁移**到"装进包里的字节里有这一面"。
          // 对不上就明说未取证 —— 拿别人的字节给自己这一轮作证是 §7 第 82 条。
          const localDist =
            process.env.HEYTA_WEB_DIST_DIR ?? join(ROOT, FILES.webDist);
          const localIndex = join(localDist, 'index.html');
          const mine = existsSync(localIndex) ? sha256File(localIndex).toUpperCase() : null;
          if (mine === null) {
            skipped(end, `${face.key} · 产物`, [
              `⚠️ 产物判据未跑：本地 ${localDist}/index.html 不存在（没构建 ⇒ 没有可对照的那份字节）`,
            ]);
          } else if (mine !== facts.PAYLOAD_INDEX_SHA) {
            skipped(end, `${face.key} · 产物`, [
              `⚠️ 包在打包机上，但它那份 index.html 与本工作树的 dist **sha256 不符**：`,
              `      包里 ${facts.PAYLOAD_INDEX_SHA.slice(0, 12)} / 本地 ${mine.slice(0, 12)}`,
              `      ⇒ 那是**别的检出／别的会话打的包，或旧产物**，不能当本轮的取证。要取证：${channel.produceCmd}`,
            ]);
          } else {
            let found = false;
            for (const f of walkAll(localDist)) {
              if (!/\.(js|html)$/.test(f)) continue;
              if (readFileSync(f, 'utf8').includes(face.webTestID)) { found = true; break; }
            }
            if (!found) {
              ok = false;
              detail.push(
                `🔴 D4 装进包的那份 dist（sha256 已逐字对上 ${mine.slice(0, 12)}）里搜不到 "${face.webTestID}"` +
                  ` ⇒ 通道在、**字节里没有这一面**`,
              );
            } else {
              detail.push(
                `D4 装进包的字节与本工作树 dist **sha256 逐字相同**（${mine.slice(0, 12)}），` +
                  `且那份里有 "${face.webTestID}"（chunk ${facts.PAYLOAD_CHUNK_PRESENT}/${facts.PAYLOAD_CHUNK_TOTAL} 齐）`,
              );
            }
          }
        }
      }
    } else if (channel.artifactWebDist === null) {
      skipped(
        end,
        `${face.key} · 产物`,
        [
          `⚠️ 产物判据未跑：${channel.hostLabel} 的包在打包机上（见 verify:windows-auth / reinstall:desktop），`,
          '      本机没有那份字节 ⇒ 本栏**不计为通过**（D1–D3 的通道判据已跑）。',
        ],
      );
    } else {
      const envKey = `HEYTA_${channel.hostLabel.toUpperCase()}_WEB_DIST`;
      const abs =
        process.env[envKey] ??
        (channel.artifactWebDist.startsWith('/')
          ? channel.artifactWebDist
          : join(ROOT, channel.artifactWebDist));
      if (!existsSync(abs)) {
        skipped(end, `${face.key} · 产物`, [
          `⚠️ 产物判据未跑：${abs} 不存在（这台机器上没打过 ${channel.hostLabel} 包），`,
          `      要取证：${channel.produceCmd}`,
        ]);
      } else {
        // 🔴 **先对账"这份包是不是我这棵树打的"，再谈里面有没有这一面。**
        //    `package-app.sh` 的默认 OUT_DIR 是 `/tmp/heyta-macos-dist` —— 那是
        //    **同一台 Mac 上的共享位置**：别的检出、别的会话跑一次打包就会覆盖它。
        //    本门禁第一轮就踩过：它把**别人那次**的包读成"我这轮的产物"并判红。
        //    对账用 `index.html` 的 sha256 —— vite 的入口 HTML 里带的是**内容哈希后**
        //    的 chunk 文件名，所以 HTML 逐字相同 ⇒ 整张资源图相同 ⇒ 才敢拿它当证据。
        //    对不上就**明说未取证**：拿别人的字节给自己这一轮作证，正是 §7 第 82 条，
        //    而共享安装目录要按 §8.9 先协调所有者 —— 门禁不许替别人圆场。
        const mineIndex = join(ROOT, FILES.webDist, 'index.html');
        const theirsIndex = join(abs, 'index.html');
        const mine = existsSync(mineIndex) ? sha256File(mineIndex) : null;
        const theirs = existsSync(theirsIndex) ? sha256File(theirsIndex) : null;
        if (mine === null || theirs === null || mine !== theirs) {
          skipped(end, `${face.key} · 产物`, [
            `⚠️ 包在 ${abs}，但它那份 index.html 与本工作树的 apps/web/dist **sha256 不符**：`,
            `      包里 ${theirs === null ? '（没有 index.html）' : theirs.slice(0, 12)} / 本地 ${mine === null ? '（没构建）' : mine.slice(0, 12)}`,
            `      ⇒ 那是**别的检出／别的会话打的包，或旧产物**，不能当本轮的取证。要取证：${channel.produceCmd}`,
          ]);
        } else {
          let found = false;
          for (const f of walkAll(abs)) {
            if (!/\.(js|html)$/.test(f)) continue;
            if (readFileSync(f, 'utf8').includes(face.webTestID)) {
              found = true;
              break;
            }
          }
          if (!found) {
            ok = false;
            detail.push(
              `🔴 D4 包里的 web-dist 搜不到 "${face.webTestID}"（sha256 已对上，确实是这份）` +
                ` ⇒ 通道在、**字节里没有这一面**（§7 第 82 条那一族）`,
            );
          } else {
            detail.push(
              `D4 包里的 web-dist 有 "${face.webTestID}"，且 index.html sha256 == 本地 apps/web/dist`,
            );
          }
        }
      }
    }

    if (ok) pass(end, face.key, detail);
    else fail(end, face.key, detail);
  }
}

/* ---- Linux：登记成缺口，并反向核对这句缺口还是不是真的 ---- */

const linuxCode = (() => {
  const hits = [];
  for (const f of walkAll(join(ROOT, FILES.linuxDir))) {
    let raw;
    try {
      raw = readFileSync(f, 'utf8');
    } catch {
      continue; // 二进制读不出就跳过（本目录里没有二进制，真出现时 L1 那条仍挡着）
    }
    if (raw.includes('web-dist') || raw.includes('WEB_DIST')) hits.push(relative(ROOT, f));
  }
  return hits;
})();

for (const face of FACES) {
  if (ONLY_FACE !== null && face.key !== ONLY_FACE) continue;
  const row = LEDGER.find((r) => r.face === face.key && r.end === 'desktop-linux');
  const detail = [];
  let ok = true;

  if (row === undefined || row.status !== 'gap') {
    ok = false;
    detail.push(
      `🔴 L1 台账里 Linux 这一格不是 gap（${row === undefined ? '没有这一格' : `status=${row.status}`}），` +
        '而下面那四项通道判据对它**一条都不成立** —— 不许假装覆盖',
    );
  } else {
    detail.push(`L1 登记为缺口 ${row.gapId}：${row.reason}`);
  }

  if (linuxCode.length > 0) {
    ok = false;
    detail.push(
      `🔴 L2 反向核对失败：apps/desktop-linux 下出现了 web-dist 引用（${linuxCode.join(', ')}）` +
        ` ⇒ 通道可能已经补上，而台账仍写着 ${row?.gapId ?? 'gap'}。**声明过期**，要么翻台账要么删掉那处引用`,
    );
  } else {
    detail.push('L2 反向核对：apps/desktop-linux 下一个 web-dist 引用都没有 ⇒ 这句缺口现在是**真的**');
  }

  if (ok) pass('desktop-linux', face.key, detail);
  else fail('desktop-linux', face.key, detail);
}

/* ========================================================================
 * 为什么查新鲜度（写在结论前面，因为它就是本门禁的一条判据）
 * ─────────────────────────────────────────────────────────────────────
 * `countdown-batch2-handoff.md` §2.2 第 1 条：那批 19 枚红**没有一枚是产品缺陷**，
 * 全部是判据读了上一个版本的 `dist`。桌面三端**只吃 `apps/web/dist`**，
 * 所以"源码里有这一面"在这里推不出"包里那一屏有它" —— 必须查一次字节。
 * 这是 AGENTS §7 元规则 3（"测试全绿 ≠ 这是当前产物"）在壳级门禁上的落地。
 * ====================================================================== */

/* ========================================================================
 * 结论
 * ====================================================================== */

console.log('');
console.log('─'.repeat(78));
const judged = results.filter((r) => r.kind === 'judge');
const red = judged.filter((r) => !r.ok);
console.log(
  `   判定 ${String(judged.length)} 格（面 × 端）：${String(judged.length - red.length)} 绿 / ${String(red.length)} 红` +
    `；未取证 ${String(unverified.length)} 栏`,
);
for (const g of gaps) console.log(`   🟡 ${g}`);
for (const u of unverified) console.log(`   ⚠️ 未取证：${u}`);

if (failed) {
  console.error('');
  console.error('🔴 壳级可达性门禁未通过。');
  console.error('');
  console.error('   ⚠️ **不要**用下列任一手法修绿（都会被下一个人复制）：');
  console.error('     · 把不可达的那一格从 LEDGER 里删掉（缺格 = 红，见断言 A）；');
  console.error('     · 把 gap 改成 reachable 而不补通道（D1–D4 会红）；');
  console.error('     · 把 `defaultOn` 改成 true 让 tab 计数"对上"（那是产品默认值，不是判据）；');
  console.error('     · 为了过 W5 去手改 apps/web/dist（产物要 build 出来，不是编辑出来）；');
  console.error('     · 给 Linux 手写一屏原生倒数日（§4.3 定案 M2，手写业务 UI 是要删的对象）。');
  console.error('');
  process.exit(1);
}

console.log('');
console.log('✅ 台账里每一格的声明都和代码里的锚点对得上。');
if (unverified.length > 0) {
  console.log(
    `   ⚠️ 但有 ${String(unverified.length)} 栏**没跑**（上面逐条列出）。` +
      '这份绿说的是"通道在"，**不是**"装出来的包里有这一屏"。',
  );
}
console.log('');
