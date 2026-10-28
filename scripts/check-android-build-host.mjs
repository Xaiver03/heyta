#!/usr/bin/env node
/**
 * `check:android-build-host` —— 新规里**另一半**的静态门禁
 * ==============================================================================
 *
 * 规则本体（产品负责人 2026-10-04 拍板）：
 *
 *     之后 Android 任务一律 ssh windows-pc，**不要再在 Mac 起新的 Gradle 构建或模拟器**。
 *
 * 这句话里有**两个**被禁的东西。`scripts/check-android-gradle-remote.mjs`（同批落的
 * 另一枚门禁）钉的是第一个 —— gradle 只能从 `scripts/run-gradle.mjs` 那一枚收口点出去
 * （G1–G6，并**明确把 `.md` 与 `.ps1` 排除在扫描面之外**，见其文件头 G1 那一行）。
 * 本文件钉的是它够不着的那半边，四条判据互不重叠：
 *
 *   H1 **模拟器侧**：可执行文件里不得出现"起 Android 模拟器 / 建 AVD"的新入口。
 *      这一维 `check:android-gradle-remote` 一条都不覆盖（它只匹配 `gradlew`），
 *      而规则原话里"或模拟器"那三个字和"Gradle 构建"是并列的 —— Mac 上被打爆的
 *      内存与 CPU 恰恰来自模拟器（3.6G 常驻 / 90% CPU），不是 gradle。
 *   H2 **文档侧**：操作手册（`docs/runbooks/*.md`）的**代码块**里不得出现新的
 *      gradle / 模拟器命令。对侧那枚刻意不扫 `.md`，所以这条不重复它，而是补它：
 *      runbook 是"照着你写的命令跑"的地方，一条 fence 里的 `./gradlew` 就是新入口。
 *      ⚠️ 只判 fence 内的行，不判散文与表格 —— "不要写 `./gradlew`"这句禁令本身
 *      必须能出现在手册里；按字面全文匹配会把**禁令**当成**入口**（AGENTS §7 元规则 2
 *      的反面：一条会把正确写法判红的门禁，很快就会被绕过而不是被遵守）。
 *      `docs/plans/*` 与 `docs/reference/*` **不在面内**：按计划/陷阱层的定位，
 *      它们是**记录**（"当时是这样跑的"），不是**指令**。把它们算成入口，
 *      等于要求历史台账改写历史。
 *   H3 **手册死链**：`scripts/run-gradle.mjs` 与 `scripts/lib/sync-build-sources.sh`
 *      引用的那份 runbook 必须**真的在位**。本批开工时那两处链接指向一个不存在的文件
 *      —— `.mjs`/`.sh` 不在 `check:docs`（docs-link-check）的扫描面里，所以那对死链
 *      **一道门禁都不会红**，全靠人读出来。这条判据把"链接有目标"变成机器判据。
 *   H4 **载体对账**：这条规则的两枚门禁都必须**有 npm 脚本定义**，并且每一枚都
 *      要么在 `pnpm check` 的链里、要么在 `check-gate-wiring.mjs` 的允许表里有名有姓。
 *      定义在、没人跑 = 这道门禁只是装饰（`check:gate-wiring` 自己修过的形状）。
 *
 * ## 用法
 *
 * ```sh
 * pnpm check:android-build-host                             # 真树
 * node scripts/check-android-build-host.mjs --root <dir>    # 临时夹具（注入验证，不动工作树）
 * node scripts/check-android-build-host.mjs --self-test     # 六臂：证明每条判据都会红
 * ```
 *
 * ## 它**没有**覆盖什么（别读多）
 *
 * - 它不证明远程构建真的能出货。手册 §三 那三条真机判据（apksigner / 装机截图主蓝 /
 *   两轮"改源码→重打→装机"）**一条都还没跑过**，而那要一台可达的 windows-pc
 *   加一个空载窗口 —— 静态门禁的绿不等于它们。
 * - 它判的是**字面形状**，不是语义。新的启动写法（例如换个二进制路径、用 Android
 *   Studio 的 GUI）不在匹配面里；出现那种形状时要往 `EMULATOR_PATTERNS` 加一条，
 *   **加的成本是刻意的** —— 逼人确认这条规则还剩多少覆盖。
 * - `.ps1` 不在面内（与对侧同一理由：PowerShell 只会跑在 Windows 上，那里本机执行
 *   就是规则要求的那一侧）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes('--self-test');
let root = DEFAULT_ROOT;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--root') {
    root = resolve(argv[i + 1] ?? '');
    i += 1;
  }
}

/** 与对侧同一套"会执行东西的文件类型"。`.md` 由 H2 单独按 fence 判，`.ps1` 刻意不在。 */
const SCANNED_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.mjs', '.cjs', '.js', '.ts', '.tsx', '.py', '.json']);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.gradle',
  '.cxx',
  '.pnpm-store',
  '.qoder',
  '.worktrees',
  '.svelte-kit',
  'coverage',
  'test-results',
  'tmp',
  '.next',
  'Pods',
  // 上游克隆与抓取的原始报告：不是本仓的入口（AGENTS §2 仓库地图把 `research/`
  // 归为**归档性质**）。但 `research/tools/` 里的一次性脚本**在**扫描面内 —— 它们
  // 会被 `bash` 跑，只是这里的命中由基线登记（见 EMULATOR_BASELINE）。
  'upstream',
]);

/** H1 的匹配面：起模拟器 / 建 AVD。H2 复用它，再额外加 gradle 那一条。 */
const EMULATOR_PATTERNS = [/\bemulator\s+-avd\b/, /\bemulator\s+@[\w.-]/, /\bavdmanager\s+create\s+avd\b/];
const GRADLE_PATTERNS = [/\bgradlew\b/];

/**
 * 本文件按夹具豁免（与对侧的 SELF_FILE 同一处置）：它的基线 needle 与输出文本
 * 里**必须**出现这些字面量，把它自己塞进扫描面就是让门禁命中自己的夹具。
 * 🔴 不靠把字符串拆开（`'emul' + 'ator'`）来躲 —— 拆开之后基线 needle 就不再是
 * 它要匹配的真实形状，判据跟着一起烂掉。代价：本文件的形状由 `--self-test` 守。
 */
const SELF_FILE = 'scripts/check-android-build-host.mjs';

/**
 * 载体侧豁免（2026-10-28 换载体时加）。规则的原意从来不是"不许有人起模拟器"，
 * 而是"**不许在跑命令的这台 Mac 上**起模拟器"。现在模拟器就该起在载体机 `linux-dev` 上，
 * 所以 H1 必须能区分这两件事，否则它会把它自己要的东西判红 —— 而一条会把正确写法判红的
 * 门禁，很快就会被绕过而不是被遵守（§7 元规则 2 的反面，本文件 H2 的文件头写的就是这条）。
 *
 * 🔴 豁免**不是**"文件在白名单里就放行"。判据落在**那一行所处的位置**上：它必须在一枚
 *   `ssh <在册载体> … <<HEREDOC` 的 heredoc **体内**。少了这条，把同一枚脚本改成
 *   本机起模拟器，白名单照样替它背书 —— 那才是通行证。
 */
const REMOTE_CARRIER_SCRIPTS = new Set(['scripts/android-carrier-device.sh']);
const CARRIER_HOSTS = /\blinux-dev\b|\$\{?HOST\b/;
const HEREDOC_START = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/;
/**
 * 这一行是不是在 `ssh <在册载体> … <<DELIM … DELIM` 的**体内**？
 *
 * 🔴 不能用"往上找最近一枚 `<<`"那种粗匹配：`<<< 'no'` 这种 here-string 会被当成
 *    heredoc 起始（实测就栽在这里 —— `avdmanager create avd … <<< 'no'` 那一行让
 *    豁免判 false，把一台**本来就在载体上跑**的模拟器报成本机入口）。
 *    所以这里按索引扫 `<<`（前后都不能再是 `<`），取分隔符，再往下找**独占一行**的
 *    终止符配对，得到一段精确的区间。
 */
function carrierHeredocSpans(lines) {
  const spans = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    // 🔴 注释行里出现的 `<<XXX` 不是 heredoc 起始（实测栽过一次：文件头那句
    //    "这一行是否在 ssh <载体> <<HEREDOC 体内"里的 `<<HEREDOC` 被当成起始，
    //    而它没有终止符 ⇒ 区间一路吃到文件末，把后面**真的**那段远端 heredoc 盖掉）。
    if (isCommentLine(l)) continue;
    for (let j = l.indexOf('<<'); j >= 0; j = l.indexOf('<<', j + 2)) {
      if (l[j - 1] === '<' || l[j + 2] === '<') continue; // here-string / 移位
      let k = j + 2;
      if (l[k] === '-' || l[k] === '~') k += 1;
      while (l[k] === ' ' || l[k] === '\t') k += 1;
      let quote = '';
      if (l[k] === "'" || l[k] === '"' || l[k] === '`') {
        quote = l[k];
        k += 1;
      }
      let name = '';
      while (k < l.length && /[A-Za-z0-9_]/.test(l[k])) {
        name += l[k];
        k += 1;
      }
      if (name === '') continue;
      if (quote && l[k] === quote) k += 1;
      // 真 heredoc 的分隔符后面到行尾只能是空白与重定向，不该再接标识符
      const rest = l.slice(k);
      if (/^\s*[>&|]/.test(rest) && !/^[>&]{1,2}\s*\S+[A-Za-z_]/.test(rest)) continue;
      let end = -1;
      for (let m = i + 1; m < lines.length; m += 1) {
        if (lines[m].trim() === name) {
          end = m;
          break;
        }
      }
      // 找不到终止符 = 这枚"起始"是误读（或脚本本身坏了）。**保守**处理：
      // 不给它远端身份 —— 拿一个读不出边界的东西去放行本机模拟器，就是把它判反。
      if (end < 0) continue;
      spans.push({ from: i + 1, to: end, remote: /\bssh\b/.test(l) && CARRIER_HOSTS.test(l) });
      break;
    }
  }
  return spans;
}
function runsOnCarrier(lines, idx) {
  const hit = idx + 1;
  const span = carrierHeredocSpans(lines).find((s) => hit > s.from && hit <= s.to);
  return span ? span.remote : false;
}

/**
 * H1 的基线：规则生效**之前**就存在的命中，每条写清"为什么它不算入口"。
 * 反向判据（H1b）要求每条都还在现量扫描里命中，否则红 —— 基线不许比现实宽。
 */
const EMULATOR_BASELINE = [
  {
    file: 'research/tools/r14c-window-retry.sh',
    needle: "pgrep -f 'emulator -avd'",
    reason:
      '它**不启动**模拟器：那一行是 `pgrep`，判"有没有别人已经在起"以免叠加。' +
      '（一次性窗口重试探针，归档线；真起模拟器的那条路本仓不存在。）',
  },
];

/**
 * H2 的基线：runbook fence 里**合法存在**的历史命令。
 * 与 H1b 一样有反向判据：那一行没了，登记也得跟着没。
 */
const RUNBOOK_FENCE_BASELINE = [
  {
    file: 'docs/runbooks/multi-platform-build.md',
    needle: 'cd android && ./gradlew assembleDebug',
    reason: '§Android"第三个实例"那一节是**报错复现**（cmd 里 `.` 不是命令），不是叫读者跑它。',
  },
];

/** H3：谁引用了那份 runbook。这两处是本批开工时**实测存在的死链**。 */
const RUNBOOK_REFERRERS = ['scripts/run-gradle.mjs', 'scripts/lib/sync-build-sources.sh'];
const RUNBOOK_PATH = 'docs/runbooks/android-build-on-linux-dev.md';
/** 旧载体的手册**不重写**（§七 那张表是历史读数），但它仍然是在位的文件 —— 夹具要带上它，
 *  否则引用它的脚本在夹具里会被 H3 判成死链，而那是夹具缺件、不是真的断链。 */
const LEGACY_RUNBOOK = 'docs/runbooks/android-build-on-windows.md';

/** H4：这条规则的两枚门禁与它们各自的定义名。 */
const RULE_GATES = [
  { script: 'check:android-gradle-remote', file: 'scripts/check-android-gradle-remote.mjs' },
  { script: 'check:android-build-host', file: 'scripts/check-android-build-host.mjs' },
];

/** 一行的"注释形状"判定：注释里的命令不是入口（与对侧同一套，两边必须一致，否则同一行两边判得不一样）。 */
function isCommentLine(line) {
  const t = line.trimStart();
  if (t.startsWith('#')) return true; // sh / py / yaml
  if (t.startsWith('//')) return true; // js / ts
  if (t.startsWith('/*') || t.startsWith('*') || t.startsWith(' *')) return true; // block comment 续行
  return false;
}

function matchesAny(line, patterns) {
  return patterns.some((re) => re.test(line));
}

function relTo(baseRoot, abs) {
  return relative(baseRoot, abs).split(/[\\/]/).join('/');
}

/* ── H1：可执行文件里的模拟器 / AVD 入口 ─────────────────────────────────── */

function findEmulatorSites(baseRoot) {
  const sites = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
        continue;
      }
      const abs = join(dir, e.name);
      const ext = e.name.includes('.') ? `.${e.name.split('.').pop()}` : '';
      if (!SCANNED_EXTENSIONS.has(ext)) continue;
      let text;
      try {
        text = readFileSync(abs, 'utf8');
      } catch {
        continue; // 二进制/读不了：不在判据面里
      }
      if (!/emulator|avdmanager/.test(text)) continue;
      const relFile = relTo(baseRoot, abs);
      if (relFile === SELF_FILE) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!matchesAny(line, EMULATOR_PATTERNS)) continue;
        if (isCommentLine(line)) continue;
        sites.push({ file: relFile, line: i + 1, text: line.trim() });
      }
    }
  };
  walk(baseRoot);
  return sites;
}

function checkEmulatorSites(baseRoot) {
  const out2 = [];
  const sites = findEmulatorSites(baseRoot);
  const hits = new Map();
  const offenders = [];
  const remoteHits = new Set();
  for (const s of sites) {
    const hit = EMULATOR_BASELINE.find((b) => b.file === s.file && s.text.includes(b.needle));
    if (hit) {
      hits.set(hit.file, (hits.get(hit.file) ?? 0) + 1);
      continue;
    }
    if (REMOTE_CARRIER_SCRIPTS.has(s.file)) {
      let body = [];
      try {
        body = readFileSync(join(baseRoot, s.file), 'utf8').split('\n');
      } catch {
        body = [];
      }
      if (runsOnCarrier(body, s.line - 1)) {
        remoteHits.add(s.file);
        continue;
      }
      offenders.push({ ...s, carrier: 'registered-but-local' });
      continue;
    }
    offenders.push(s);
  }
  // 反向腿：登记了却没在位 = 这张豁免表比现实宽（与 EMULATOR_BASELINE 同一条纪律）
  for (const f of REMOTE_CARRIER_SCRIPTS) {
    if (remoteHits.has(f)) continue;
    if (!existsSync(join(baseRoot, f))) continue; // 脚本被删是 H4/别的事，这里不判"文件在不在"
    out2.push(
      `H1 载体豁免比现实宽：${f} 登记在 REMOTE_CARRIER_SCRIPTS 里，但现量扫描中它**没有一处**` +
        '在 `ssh <在册载体> <<HEREDOC` 体内起模拟器 —— 那一档没了就把登记删掉，留着就是通行证。',
    );
  }
  const out = out2;
  for (const o of offenders) {
    out.push(
      `H1 ${o.file}:${o.line} 在**跑命令的这台机器上**起 Android 模拟器 / 建 AVD —— 规则要求模拟器起在载体机上。` +
        (o.carrier === 'registered-but-local'
          ? `\n      ${o.file} 在豁免表里，但**这一行不在 ` + '`ssh <载体> <<HEREDOC`' + ` 体内** ⇒ 它是本机执行，豁免不覆盖它。`
          : '') +
        `\n      那一行是：${o.text.slice(0, 160)}` +
        `\n      模拟器本体与 system-images 都在载体机上（见 ${RUNBOOK_PATH} §七），` +
        '所以新开一个**本机**模拟器入口不是"换台机器跑"，是把 Mac 重新拖回 3.6G 常驻 + 90% CPU 那个状态。' +
        '\n      要留成例外就写进 EMULATOR_BASELINE 并附"为什么它不算入口"；要走载体就在 `ssh <载体> <<HEREDOC` 体内跑并登记进 REMOTE_CARRIER_SCRIPTS。',
    );
  }
  for (const b of EMULATOR_BASELINE) {
    if (!hits.has(b.file)) {
      out.push(
        `H1 基线比现实宽：${b.file} 里已经没有 \`${b.needle}\` 了，但登记还在（理由：${b.reason}）。` +
          '\n      那一行没了 ⇒ 把这条基线删掉；改名了 ⇒ 更新 needle。登记只会越攒越长通行证，`check:licenses` 与 `check:gate-wiring` 各修过一次这个形状。',
      );
    }
  }
  return { failures: out, reading: `H1 扫到模拟器/AVD 形状 ${sites.length} 处（基线命中 ${hits.size} ／ 载体远端豁免 ${remoteHits.size} ／ 违规 ${offenders.length}）` };
}

/* ── H2：runbook 代码块里的新入口 ───────────────────────────────────────── */

/** 抽出 `docs/runbooks/*.md` 里**代码块内**的行。散文与表格里提到命令不算入口。 */
function findRunbookFenceSites(baseRoot) {
  const dir = join(baseRoot, 'docs', 'runbooks');
  if (!existsSync(dir)) return [{ file: 'docs/runbooks（目录缺失）', line: 0, text: '' }];
  const sites = [];
  const PATTERNS = [...EMULATOR_PATTERNS, ...GRADLE_PATTERNS];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const abs = join(dir, name);
    const rel = `docs/runbooks/${name}`;
    const lines = readFileSync(abs, 'utf8').split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*(?:```|~~~)/.test(lines[i])) {
        inFence = !inFence;
        continue;
      }
      if (!inFence) continue;
      if (!matchesAny(lines[i], PATTERNS)) continue;
      sites.push({ file: rel, line: i + 1, text: lines[i].trim() });
    }
  }
  return sites;
}

function checkRunbookFences(baseRoot) {
  const sites = findRunbookFenceSites(baseRoot);
  const hits = new Map();
  const offenders = [];
  for (const s of sites) {
    const hit = RUNBOOK_FENCE_BASELINE.find((b) => b.file === s.file && s.text.includes(b.needle));
    if (hit) hits.set(hit.file, (hits.get(hit.file) ?? 0) + 1);
    else offenders.push(s);
  }
  const out = [];
  for (const o of offenders) {
    out.push(
      `H2 ${o.file}:${o.line} 操作手册的**代码块**里出现了一条直接在 Mac/Linux 跑的 gradle / 模拟器命令 ——` +
        `\n      ${o.text.slice(0, 160)}` +
        `\n      手册是"照着跑"的地方，fence 里的一条命令就是一个新入口（规则本体见 ${RUNBOOK_PATH}）。` +
        '\n      要写禁令就写在**散文**里（"不要写 `./gradlew`"），别写成可复制的命令块；' +
        '确实要留历史命令 ⇒ 进 RUNBOOK_FENCE_BASELINE 并写清它为什么不是入口。',
    );
  }
  for (const b of RUNBOOK_FENCE_BASELINE) {
    if (!hits.has(b.file)) {
      out.push(
        `H2 基线比现实宽：${b.file} 的代码块里已经没有 \`${b.needle}\` 了，但登记还在（理由：${b.reason}）。` +
          '\n      那一节被删/改写 ⇒ 把这条基线一起删掉。',
      );
    }
  }
  return { failures: out, reading: `H2 runbook 代码块里扫到 gradle/模拟器命令 ${sites.length} 条（基线命中 ${hits.size} ／ 违规 ${offenders.length}）` };
}

/* ── H3：那两处引用的手册必须在位 ───────────────────────────────────────── */

function checkRunbookLinks(baseRoot) {
  const out = [];
  let checked = 0;
  for (const relFile of RUNBOOK_REFERRERS) {
    const abs = join(baseRoot, relFile);
    if (!existsSync(abs)) {
      out.push(`H3 ${relFile} 读不到 —— 引用对账没法做（这条规则的路由本体或同步 lib 被挪走了？）。`);
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    // 引用形状：markdown 链接的目标（`[docs/runbooks/x.md](../docs/runbooks/x.md)`）。
    // 抓**链接**而不是抓散文里的路径：本批开工时那两处就是链接指向了不存在的文件，
    // 而 `.mjs`/`.sh` 不在 `check:docs` 的扫描面里 ⇒ 死链不会红，只有人会看出来。
    const targets = [...text.matchAll(/\]\(([^)]*runbooks\/[^)\s]+\.md)\)/g)].map((m) => m[1]);
    if (targets.length === 0) {
      out.push(
        `H3 ${relFile} 里读不到任何指向 \`docs/runbooks/*.md\` 的链接 ——` +
          `\n      规则本体与手册的互链断了（它要么不该再引，要么引用被误删）。` +
          `\n      判据从"链接的目标存在"变成"引用还在"，因为**删掉引用会让这条规则重新变成只写在代码注释里**。`,
      );
      continue;
    }
    for (const t of targets) {
      checked += 1;
      // 链接是**相对该文件**的：scripts/ 里写 `../docs/runbooks/x.md`，scripts/lib/ 里写 `../../docs/...`。
      const abs2 = resolve(dirname(abs), t);
      if (!existsSync(abs2)) {
        out.push(
          `H3 死链：${relFile} 链接到 ${t} → 解析为 ${relTo(baseRoot, abs2)}，而那个文件不存在。` +
            `\n      本批开工时实测就是这个形状（两处悬空引用指向一份还没写的手册），` +
            '而它**一道门禁都不会红** —— `.mjs`/`.sh` 不在 `check:docs` 的扫描面里。',
        );
      }
    }
  }
  if (!existsSync(join(baseRoot, RUNBOOK_PATH))) {
    out.push(`H3 手册本体不在位：${RUNBOOK_PATH} 不存在 —— 那条规则现在只活在代码注释里。`);
  }
  return { failures: out, reading: `H3 核对了 ${checked} 处指向 runbook 的链接（对侧文件：${RUNBOOK_REFERRERS.join('、')}）` };
}

/* ── H4：两枚门禁都要有定义，且要么进链、要么在允许表里有名有姓 ─────────── */

function checkGateCarriers(baseRoot) {
  const out = [];
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(baseRoot, 'package.json'), 'utf8'));
  } catch {
    return [`H4 读不到 ${baseRoot}/package.json —— 载体对账没法做。`];
  }
  const chain = String(pkg.scripts?.check ?? '');
  let wiringText = '';
  try {
    wiringText = readFileSync(join(baseRoot, 'scripts/check-gate-wiring.mjs'), 'utf8');
  } catch {
    return ['H4 读不到 scripts/check-gate-wiring.mjs —— "链外门禁必须有可验消费方"那半条判据无法求值。'];
  }
  const readings = [];
  for (const g of RULE_GATES) {
    if (!existsSync(join(baseRoot, g.file))) {
      out.push(`H4 门禁脚本本身不在位：${g.file} —— 定义 ${g.script} 指向一个不存在的文件。`);
      continue;
    }
    const defined = typeof pkg.scripts?.[g.script] === 'string';
    if (!defined) {
      out.push(
        `H4 ${g.file} 存在，但 package.json 里没有 \`${g.script}\` 定义 ⇒ 没人能从命令面跑它。` +
          '\n      一条规则的门禁如果只能靠人记得路径，它就等于没有（AGENTS §7 元规则 2）。',
      );
      continue;
    }
    const inChain = chain.includes(`pnpm ${g.script}`);
    const inAllowList = wiringText.includes(`'${g.script}'`) || wiringText.includes(`"${g.script}"`);
    if (!inChain && !inAllowList) {
      out.push(
        `H4 \`${g.script}\` 既不在 \`pnpm check\` 的链里，也不在 check-gate-wiring.mjs 的允许表里 ——` +
          '\n      它就是"定义在、没人跑"那一档。要么进链，要么进允许表并**点名消费方**（手册里那条以行首出现的命令）。',
      );
      continue;
    }
    readings.push(`H4 ${g.script} 有载体（${inChain ? '在 check 链里' : `链外：允许表登记，消费方见 ${RUNBOOK_PATH}`}）`);
  }
  return { failures: out, reading: readings.join(' ｜ ') };
}

/* ── 真树跑法 ───────────────────────────────────────────────────────────── */

if (SELF_TEST) process.exit(selfTest());

if (!existsSync(join(root, 'scripts/run-gradle.mjs'))) {
  console.error(`🔴 ${root} 不是一棵 heyta 树（读不到 scripts/run-gradle.mjs）—— 判据无法求值，按红处理。`);
  process.exit(1);
}

const failures = [];
const readings = [];
for (const part of [
  checkEmulatorSites(root),
  checkRunbookFences(root),
  checkRunbookLinks(root),
]) {
  failures.push(...part.failures);
  readings.push(part.reading);
}
const carriers = checkGateCarriers(root);
failures.push(...carriers.failures);
if (carriers.reading) readings.push(carriers.reading);

console.log('Android 构建主机规则的对侧半边（静态：不联网、不起模拟器、不构建）：');
for (const r of readings) console.log(`   · ${r}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`🔴 ${f}`);
  console.error(`\n共 ${failures.length} 处。规则本体：Android 任务一律走远程构建载体（2026-10-28 起 = linux-dev），不要再在 Mac 起新的 Gradle 构建或模拟器。`);
  console.error(`手册：${RUNBOOK_PATH}`);
  process.exit(1);
}
console.log('✅ 模拟器侧与文档侧都没有新入口；两处对手册的引用不是死链；两枚门禁都有载体');

/* ── 自检：六臂（含阳性对照），证明每条判据都会红 ────────────────────────── */

/**
 * 臂的设计原则（与对侧同一套，AGENTS §7 元规则 2）：
 *  1. 每臂改的是**一个真实形状**，不是改期望值；
 *  2. 期望写成"恰好几条红"，不许写"有红"（否则一条无关的红就能凑数）；
 *  3. 臂 0 是**阳性对照**：干净夹具必须 0 红，否则整套判据是恒红装饰。
 * 🔴 变异一律施在**临时夹具**里（`--root` 指过去），不碰工作树 —— 这是一份多人共用的
 *    工作树，往 `scripts/` 里塞一个真文件就是给别人的验收丢雷。
 */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-android-build-host-'));
  let fail = 0;
  const write = (rel, text) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const countRed = (msgs, needle) => msgs.filter((m) => m.includes(needle)).length;
  const read = (rel) => readFileSync(join(DEFAULT_ROOT, rel), 'utf8');

  // 夹具基座：真树的几份文件搬进临时树（阳性对照用）。
  const seedFiles = {
    'scripts/run-gradle.mjs': read('scripts/run-gradle.mjs'),
    'scripts/lib/sync-build-sources.sh': read('scripts/lib/sync-build-sources.sh'),
    'scripts/check-android-build-host.mjs': read('scripts/check-android-build-host.mjs'),
    'scripts/check-android-gradle-remote.mjs': read('scripts/check-android-gradle-remote.mjs'),
    'scripts/check-gate-wiring.mjs': read('scripts/check-gate-wiring.mjs'),
    'scripts/verify-mobile-aed.sh': read('scripts/verify-mobile-aed.sh'),
    'scripts/verify-android-vault-storage.sh': read('scripts/verify-android-vault-storage.sh'),
    // 载体装置必须在夹具里：H1 的豁免带**反向腿**（登记了却没在位 = 红），
    // 少了这份文件，臂 0 那枚阳性对照会因为它而红，读的人就去猜"哪条判据坏了"。
    'scripts/android-carrier-device.sh': read('scripts/android-carrier-device.sh'),
    'scripts/reinstall-all.sh': read('scripts/reinstall-all.sh'),
    'research/tools/r14c-window-retry.sh': read('research/tools/r14c-window-retry.sh'),
    'docs/runbooks/multi-platform-build.md': read('docs/runbooks/multi-platform-build.md'),
    [RUNBOOK_PATH]: read(RUNBOOK_PATH),
    [LEGACY_RUNBOOK]: read(LEGACY_RUNBOOK),
    'package.json': read('package.json'),
  };
  const seed = (tweaks = {}) => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [rel, text] of Object.entries(seedFiles)) write(rel, tweaks[rel] ?? text);
  };
  const all = (r) => [
    ...checkEmulatorSites(r).failures,
    ...checkRunbookFences(r).failures,
    ...checkRunbookLinks(r).failures,
    ...checkGateCarriers(r).failures,
  ];

  try {
    /* 臂 0：阳性对照 —— 干净夹具必须 0 红 */
    seed();
    let msgs = all(dir);
    if (msgs.length === 0) console.log('   ✅ 臂 0 阳性对照：干净夹具 0 红');
    else {
      console.log(`   🔴 臂 0 坏了：干净夹具报了 ${msgs.length} 条\n      ${msgs.join('\n      ').slice(0, 700)}`);
      fail = 1;
    }

    /* 臂 1：新开一个本机模拟器入口 ⇒ H1 恰好 1 条 */
    write('scripts/verify-new-device.sh', '#!/bin/bash\nemulator -avd heyta-w3-yearly &\nadb wait-for-device\n');
    msgs = checkEmulatorSites(dir).failures;
    if (countRed(msgs, 'H1 ') === 1) console.log('   ✅ 臂 1 转红：新起模拟器的脚本被 H1 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 1 存活：新写一条 emulator -avd 入口后只报了 ${countRed(msgs, 'H1 ')} 条 H1`);
      fail = 1;
    }
    rmSync(join(dir, 'scripts/verify-new-device.sh'));

    /* 臂 2：撤掉基线那一行而登记还在 ⇒ H1 反向判据恰好 1 条 */
    seed();
    write('research/tools/r14c-window-retry.sh', read('research/tools/r14c-window-retry.sh').replace("pgrep -f 'emulator -avd'", 'pgrep -f qemu-system'));
    msgs = checkEmulatorSites(dir).failures;
    if (countRed(msgs, 'H1 基线比现实宽') === 1) console.log('   ✅ 臂 2 转红：基线比现实宽，被 H1 的反向判据抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 2 存活：改掉那一行后反向判据报了 ${countRed(msgs, 'H1 基线比现实宽')} 条（应当恰好 1）`);
      fail = 1;
    }

    /* 臂 3：往 runbook 的代码块里加一条 ./gradlew ⇒ H2 恰好 1 条 */
    seed();
    write(
      'docs/runbooks/android-build-on-windows.md',
      `${read(RUNBOOK_PATH)}\n\n\`\`\`bash\ncd apps/mobile/android && ./gradlew assembleDebug\n\`\`\`\n`,
    );
    msgs = checkRunbookFences(dir).failures;
    if (countRed(msgs, 'H2 docs/runbooks/android-build-on-windows.md') === 1) console.log('   ✅ 臂 3 转红：手册代码块里的新命令被 H2 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 3 存活：fence 里塞了一条 gradle 命令后 H2 报了 ${countRed(msgs, 'H2 ')} 条`);
      fail = 1;
    }

    /* 臂 4：手册消失（把 H2 与 H3 一起抓） ⇒ H3 至少 3 条：两处引用的死链 + 手册本体不在位 */
    seed();
    rmSync(join(dir, RUNBOOK_PATH));
    msgs = checkRunbookLinks(dir).failures;
    const h3 = countRed(msgs, 'H3 ');
    if (h3 >= 3) console.log(`   ✅ 臂 4 转红：手册被删后 H3 报了 ${h3} 条（两处引用的死链 + 手册本体不在位）`);
    else {
      console.log(`   🔴 臂 4 存活：删掉手册后 H3 只报了 ${h3} 条（应当 ≥3）`);
      fail = 1;
    }

    /* 臂 5：把本门禁从允许表里摘掉 ⇒ H4 恰好 1 条 */
    seed();
    write(
      'scripts/check-gate-wiring.mjs',
      read('scripts/check-gate-wiring.mjs').replace("'check:android-build-host'", "'check:被摘掉的那道'"),
    );
    msgs = checkGateCarriers(dir).failures;
    if (countRed(msgs, 'H4 `check:android-build-host`') === 1) console.log('   ✅ 臂 5 转红：允许表条目被摘掉后 H4 抓到本门禁没有载体（恰好 1 条）');
    else {
      console.log(`   🔴 臂 5 存活：摘掉登记后 H4 报了 ${countRed(msgs, 'H4 ')} 条（应当恰好 1 条命中本门禁）`);
      fail = 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

    /* 臂 6 / 6b / 6c / 6d：H1 的**载体豁免**四条腿。
     * 施加理由就是这次迁移本身：规则禁的是"在跑命令的这台机器上起模拟器"，而换载体之后
     * 模拟器**就该**起在 `linux-dev` 上 —— 豁免若按文件名放行，同一枚脚本改回本机起模拟器
     * 它照样绿，那是一条会替坏写法背书的判据。所以四条腿各查一边：
     *   6  = 正照（登记 + 在 ssh <载体> heredoc 体内 ⇒ 不红）；
     *   6b = 把同一枚 heredoc 的 ssh 摘掉（变成本机 heredoc）⇒ 体内两枚形状各红一条；
     *   6c = 逐字相同的内容落在**未登记**的文件里 ⇒ 照红（豁免不是"看到 ssh 就放行"）；
     *   6d = 登记还在、远端命中全没了 ⇒ "豁免比现实宽"恰好 1 条。 */
    const carrierFile = 'scripts/android-carrier-device.sh';
    const carrierText = seedFiles[carrierFile];
    const SSH_LINE = 'ssh -o ConnectTimeout=15 "$HOST" "AVD=\'$AVD\' SDK=\'$SDK\' bash -s" <<\'REMOTE\'';

    seed();
    let cmsgs = checkEmulatorSites(dir).failures;
    if (countRed(cmsgs, 'H1 ') === 0) console.log('   ✅ 臂 6 正照：登记 + 在 ssh <载体> heredoc 体内 ⇒ 不判红（豁免真的在工作）');
    else {
      console.log('   🔴 臂 6 坏了：载体装置被判成本机入口（' + countRed(cmsgs, 'H1 ') + ' 条）\n      ' + cmsgs.join(' | ').slice(0, 220));
      fail = 1;
    }

    seed();
    if (!carrierText.includes(SSH_LINE)) {
      console.log('   🔴 臂 6b 没施上：读不到载体装置里那行 ssh heredoc 起始 —— 豁免判据无从求值');
      fail = 1;
    } else {
      seed({ [carrierFile]: carrierText.replace(SSH_LINE, 'bash -s <<\'REMOTE\'') });
      cmsgs = checkEmulatorSites(dir).failures;
      // 恰好 3：体内两行各自红（emulator + avdmanager），外加一条"登记还在、远端命中全没了"
      // —— 后者由臂 6d 单独钉，这里只是同一发变异顺带打中它，所以期望值写成 3 而不是"≥1"。
      if (countRed(cmsgs, 'H1 ') === 3) console.log('   ✅ 臂 6b 转红：同一枚脚本不再经 ssh 到载体 ⇒ 体内两行各红一条，外加登记变宽那条（恰好 3）');
      else {
        console.log('   🔴 臂 6b 存活：摘掉 ssh 后 H1 报了 ' + countRed(cmsgs, 'H1 ') + ' 条（应当恰好 3）\n      ' + cmsgs.join(' | ').slice(0, 220));
        fail = 1;
      }
    }

    seed();
    // 夹具基座只写登记过的文件；这份"另一个文件"要单独落盘，否则臂 6c 是在读一个不存在的夹具
    write('scripts/verify-some-other-device.sh', carrierText);
    cmsgs = checkEmulatorSites(dir).failures;
    if (countRed(cmsgs, 'H1 scripts/verify-some-other-device.sh') === 2) console.log('   ✅ 臂 6c 转红：逐字相同的内容落在**未登记**文件里照红（恰好 2 条）');
    else {
      console.log('   🔴 臂 6c 存活：未登记文件里的形状只报了 ' + countRed(cmsgs, 'H1 scripts/verify-some-other-device.sh') + ' 条（应当恰好 2）');
      fail = 1;
    }

    seed();
    const inert = carrierText
      .replace('nohup emulator -avd "$AVD"', 'nohup heyta-emulator-launch --avd "$AVD"')
      .replace('avdmanager create avd -n "$AVD"', 'heyta-avd-create -n "$AVD"');
    if (inert === carrierText) {
      console.log('   🔴 臂 6d 没施上：读不到那两行形状 —— 反向判据无从求值');
      fail = 1;
    } else {
      seed({ [carrierFile]: inert });
      cmsgs = checkEmulatorSites(dir).failures;
      if (countRed(cmsgs, 'H1 载体豁免比现实宽') === 1) console.log('   ✅ 臂 6d 转红：登记还在、远端命中全没了 ⇒ "豁免比现实宽"恰好 1 条');
      else {
        console.log('   🔴 臂 6d 存活：撤掉两行后反向判据报了 ' + countRed(cmsgs, 'H1 载体豁免比现实宽') + ' 条（应当恰好 1）\n      ' + cmsgs.join(' | ').slice(0, 220));
        fail = 1;
      }
    }

  console.log(fail === 0 ? '自检：逐臂（臂 0 = 阳性对照）全部按预期转红/转绿 —— 臂数见上面逐条打印' : '自检有臂存活 —— 那条判据等于没有');
  return fail;
}
