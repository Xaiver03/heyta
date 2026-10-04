#!/usr/bin/env node
/**
 * `check:android-gradle-remote` —— Android 构建只能从**一枚收口点**出去
 * ==============================================================================
 *
 * ## 判的是哪条规则
 *
 * 产品负责人 2026-10-04 拍板：**之后 Android 任务一律 ssh windows-pc，不要再在 Mac
 * 起新的 Gradle 构建或模拟器。** 落地方式是让 `scripts/run-gradle.mjs` 按平台分流
 * （macOS/Linux 远程、Windows 本机），因为所有 Android 入口本来就汇成那一枚：
 *
 *     根 package.json build:android{,:debug,:bundle} / clean:android
 *       → pnpm --filter @heyta/mobile run …
 *         → apps/mobile/package.json 里逐字 `node ../../scripts/run-gradle.mjs <task>`
 *
 * 这条规则**最容易悄悄烂掉的方式**不是有人删路由，而是有人新开一个入口：
 * 复制一段 `cd android && ./gradlew assembleDebug` 进新脚本 —— 它会成功、会出 APK、
 * 会在 Mac 上把内存和磁盘重新吃掉，而没有任何一层会红。所以本文件钉的是**形状**：
 *
 *   G1 全仓**可执行文件**里，"非注释行提到 gradlew"的落点只允许出现在一枚白名单文件里。
 *      （文档 `.md` 不在扫描面：runbook 要如实写出远端那条 `gradlew.bat` 命令；
 *        `.ps1` 也不在：PowerShell 只会跑在 Windows 上，那里本机执行就是正解。）
 *   G2 白名单**不许比现实宽**：每条登记的落点必须在现量扫描里仍然存在。
 *      拿掉那一行而白名单还留着 ⇒ 红。（不这么写的话，白名单就是一张会越攒越长的通行证，
 *      正是 `check:licenses` 与 `check:gate-wiring` 各自修过的形状。）
 *   G3 **跨文件对账**：`run-gradle.mjs` 远程模式回传的产物路径（由 `deriveArtifacts`
 *      现算）必须逐字等于 `scripts/reinstall-all.sh` 的 android 段里 `$APK` 读的那个路径。
 *      两边不一致 ⇒ 换路径会**打空**"APK 必须比源码新"那条判据（§7 第 27 条的常驻防线）。
 *   G4 **收口点没被绕开**：`apps/mobile/package.json` 的 android 脚本必须逐字是
 *      `node ../../scripts/run-gradle.mjs <task>`；根 `package.json` 的 `build:android*`
 *      必须仍然转发到 `@heyta/mobile`。
 *   G5 **远程模式不会在 Windows 上递归**：`isWindows` 那一支必须还在分流处先判，
 *      且 `runRemote()` 的函数体里**不许**出现 `runLocal(` —— 那就是"静默降级"的写法。
 *   G6 **同步机制只有一枚**：`run-gradle.mjs` 必须调
 *      `scripts/lib/sync-windows-sources.sh` 的 `sync_windows_sources_for_android`，
 *      而自己**不实现**第二份源码打包（不许出现 `tar -czf`）；同一文件里
 *      `sync_windows_sources`（MSIX 那一腿的入口）与它的两个消费方必须都还在。
 *      —— 这是 AGENTS §3.5「抽出来的收尾动作是删掉旧的那份并加门禁」那一课的直接应用。
 *   G7 **远程前置不许是一条永不开的门**：步骤 1 探的那些 `<远端根>\…\node_modules`，
 *      去掉 `node_modules` 之后必须匹配 `pnpm-workspace.yaml` 的某一条 packages glob。
 *      理由是真事故：第一版探 `apps\mobile\android\node_modules`，而 `apps/mobile/android`
 *      不是工作区包 ⇒ `pnpm install` 永远不会在那儿建目录，远程构建**恒定**红在步骤 1，
 *      而它给出的修法执行完照样红（§7 元规则 2）。期望值靠**推导**工作区清单，
 *      不靠"这路径在不在" —— 后者在干净检出上必假红。
 *
 * ## 怎么跑
 *
 * ```sh
 * node scripts/check-android-gradle-remote.mjs              # 真树
 * node scripts/check-android-gradle-remote.mjs --root <dir> # 临时夹具（注入验证用，不动工作树）
 * node scripts/check-android-gradle-remote.mjs --self-test  # 逐臂证明每条判据都会红（臂数现量：看它自己打印的那行）
 * ```
 *
 * ## 这条判据**没有**覆盖什么（别读多）
 *
 * - 它是**静态**的。真正"远程构建出的 APK 装进模拟器能跑"由手册
 *   docs/runbooks/android-build-on-windows.md §5 那三条人工判据负责（要一台可达的
 *   windows-pc + 一个空载窗口，本批**没跑过**）。
 * - 它不保证远端 `node_modules` 与同步过去的 `package.json` 同批 —— 那条边界写在手册 §6。
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveArtifacts } from './run-gradle.mjs';

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

/** 扫描面：会**执行**东西的文件类型。`.md` 与 `.ps1` 刻意不在这里，理由见文件头 G1。 */
const SCANNED_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.mjs', '.cjs', '.js', '.ts', '.tsx', '.py', '.json']);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.gnupg',
  'dist',
  'build',
  'out',
  '.gradle',
  '.pnpm-store',
  '.qoder',
  '.worktrees',
  '.svelte-kit',
  'coverage',
  'test-results',
  'tmp',
  '.next',
]);

/**
 * G1 的唯一允许落点。理由：它是**路由本体**，win32 那一支必须能直接起
 * `gradlew.bat`（否则 windows-pc 上跑同一批 pnpm 脚本时会递归回远程模式）。
 */
const ALLOWED_FILE = 'scripts/run-gradle.mjs';

/**
 * 扫描器自己的豁免。**这是实测抓出来的，不是预防性写的**：首跑时本文件报了 11 条 G1，
 * 因为它自己就登记着基线的 needle、还要打印"gradlew"这个词。
 *
 * 🔴 正确处置是**点名豁免 + 说清为什么**，而不是把 needle 字符串拆成
 * `'grad' + 'lew'` 来躲开匹配 —— 拆开之后基线 needle 就不再是它要匹配的那个真实形状，
 * 判据会跟着一起烂掉（本仓那条"门禁会命中它自己的夹具"的教训走的是同一个道理：
 * 承认它是夹具，然后按夹具处理）。
 *
 * 代价说清楚：本文件里可以出现 gradlew 这个字面量而不被判红。所以本文件的形状由
 * `--self-test` 的豁免两腿（臂 7 正向 / 臂 8 反向）守着，而不是由扫描面守着。
 */
const SELF_FILE = 'scripts/check-android-gradle-remote.mjs';

/**
 * 门禁同类文件（`scripts/check-*.mjs`）的**形状豁免**，2026-10-05 加，而且是**实测逼出来的**：
 * 并行会话新增的 `scripts/check-android-build-host.mjs`（钉"不许在 Mac 起模拟器"那半边）
 * 里登记着自己的 needle 与匹配模式（`/\bgradlew\b/`、`cd android && ./gradlew assembleDebug`），
 * 本门禁当场报 4 条红 —— 而那四行**一行都不会执行构建**，它们是扫描器的描述文本。
 *
 * 🔴 但"看起来是扫描器"不等于豁免。所以这一档不是按文件名放行，而是**带一条反向判据**：
 * 同一行里出现**真的把进程交出去的形状**（`spawnSync(` / `execSync(` / `execFile(` /
 * `fork(` / `child_process`）就**照红**，豁免立刻失效。也就是说：
 *   · 描述一条命令 ⇒ 豁免；
 *   · 在门禁文件里**执行**一条 gradlew ⇒ 仍然被 G1 抓住。
 * 这条反向判据由 `--self-test` 的臂 7（正照：needle 不红）与臂 8（变异：门禁里真 spawn ⇒ 红）
 * 各自钉住 —— 不是写在注释里的承诺。
 */
const CHECKER_FILE = /^scripts\/check-[^/]+\.mjs$/;
const EXECUTION_SHAPE = /spawnSync\(|execSync\(|execFile\(|fork\(|child_process/;

/**
 * G2 的基线：**规则生效之前**就存在的直接 gradlew 入口。每条都要写清"为什么还留着"，
 * 而且必须仍然在现量扫描里命中，否则红。
 *
 * 🔴 这两条都不是"合法的新入口"，是**待迁的存量**：
 *   · `verify-mobile-aed.sh` 用 `-I hermes-aed-probe.init.gradle` 注入 init 脚本，
 *     且产物是"探针 + APK"两件事，本批没做真机构建 ⇒ 不能盲改它的路由；
 *   · `verify-android-vault-storage.sh` 要 `assembleDebugAndroidTest`（instrumentation APK），
 *     形状不在推导规则里（见 run-gradle.mjs 的例外那条），改路由要先验一次装机链路。
 * 迁移它们是下一批的活；**这两条从基线里消失之前，任何第三条都不许加进来** ——
 * 基线的价值就在于它会因为"现实变了"而红。
 */
const BASELINE = [
  {
    file: 'scripts/verify-mobile-aed.sh',
    needle: './gradlew --no-daemon --console=plain',
    reason: '存量：Hermes AED 探针用 -I init 脚本，且需要探针与 APK 两件事一起迁；本批未做真机构建，不盲改路由。',
  },
  {
    file: 'scripts/verify-android-vault-storage.sh',
    needle: './gradlew :app:assembleDebug :app:assembleDebugAndroidTest',
    reason: '存量：instrumentation APK 的形状不在产物推导规则里，迁路由前要先验一次装机链路。',
  },
];

/** 一行的"注释形状"判定：注释里的命令不是入口，但**文档里**的命令会被抄，所以扫的是脚本。 */
function isCommentLine(line) {
  const t = line.trimStart();
  if (t.startsWith('#')) return true; // sh / py / yaml
  if (t.startsWith('//')) return true; // js / ts
  if (t.startsWith('/*') || t.startsWith('*') || t.startsWith(' *')) return true; // block comment 续行
  return false;
}

/** G1：列出 `root` 下所有"非注释行提到 gradlew"的可执行文件落点（+ 被形状豁免的那些）。 */
export function findGradlewSites(baseRoot) {
  const sites = [];
  const exempted = [];
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
      if (!text.includes('gradlew')) continue;
      const relFile = relative(baseRoot, abs).split(/[\\/]/).join('/');
      if (relFile === SELF_FILE) continue; // 扫描器自己的 needle 与输出文本，理由见 SELF_FILE
      // 门禁同类文件：只**描述**命令的行豁免；同一行有执行形状则**不豁免**（反向判据）。
      if (CHECKER_FILE.test(relFile)) {
        const linesPre = text.split('\n');
        for (let i = 0; i < linesPre.length; i += 1) {
          if (!linesPre[i].includes('gradlew')) continue;
          if (isCommentLine(linesPre[i])) continue;
          if (!EXECUTION_SHAPE.test(linesPre[i])) {
            exempted.push(`${relFile}:${i + 1}`);
            continue;
          }
          sites.push({ file: relFile, line: i + 1, text: linesPre[i].trim() });
        }
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes('gradlew')) continue;
        if (isCommentLine(lines[i])) continue;
        sites.push({ file: relFile, line: i + 1, text: lines[i].trim() });
      }
    }
  };
  walk(baseRoot);
  return { sites, exempted };
}

/* ── 判据 ─────────────────────────────────────────────────────────────── */

const failures = [];
const readings = [];

/** G1 + G2：现量扫描 vs 白名单 + 基线。 */
function checkGradlewSites(baseRoot) {
  const { sites, exempted } = findGradlewSites(baseRoot);
  const allowed = sites.filter((s) => s.file === ALLOWED_FILE);
  const baselineHits = new Map();
  const offenders = [];
  for (const s of sites) {
    if (s.file === ALLOWED_FILE) continue;
    // ⚠️ 这里是 `includes` 而不是 `startsWith`，且**只对已经是"执行形状"的那一行**求值：
    //    命中项来自 sites（已经过注释过滤），不是从整篇文件里抓的 —— 所以不存在
    //    "散文里提到了也算"的那种假绿（那是 check:gate-wiring 面对的场景，不是这里）。
    const hit = BASELINE.find((b) => b.file === s.file && s.text.includes(b.needle));
    if (hit) baselineHits.set(hit.file, (baselineHits.get(hit.file) ?? 0) + 1);
    else offenders.push(s);
  }
  const out = [];
  for (const o of offenders) {
    out.push(
      `G1 ${o.file}:${o.line} 直接调用 gradlew —— Android 构建只能经 ${ALLOWED_FILE} 那一枚收口点。` +
        `\n      那一行是：${o.text.slice(0, 160)}\n` +
        '      规则：之后 Android 任务一律走远程构建主机（AGENTS §6.1 / 手册 android-build-on-windows.md）。' +
        '\n      要留成例外就写进 BASELINE 并附"为什么"，但**基线里已经有的两条是待迁存量，不是模板**。',
    );
  }
  if (allowed.length === 0) {
    out.push(
      `G1 反向判据：白名单文件 ${ALLOWED_FILE} 里**读不到任何** gradlew 调用 —— ` +
        '要么路由被删了（那 Windows 上没人能构建），要么这棵树不是 heyta 的树。',
    );
  }
  for (const b of BASELINE) {
    if (!baselineHits.has(b.file)) {
      out.push(
        `G2 基线比现实宽：${b.file} 里已经没有那一行了，但基线还登记着它（理由：${b.reason}）。` +
          '\n      要么那一行迁走了 ⇒ 把这条基线删掉，要么它被改名了 ⇒ 更新 needle。',
      );
    }
  }
  readings.push(`G1/G2 扫描到 gradlew 落点 ${sites.length} 处（白名单 ${allowed.length} ／ 基线命中 ${baselineHits.size} ／ 违规 ${offenders.length}）`);
  // ⚠️ 豁免不是"数一下就放过"：每一处都点名到 file:line，读数里看得见。
  if (exempted.length > 0) {
    readings.push(
      `G1 形状豁免 ${exempted.length} 处（都是 scripts/check-*.mjs 里**只描述不执行**的 needle 行；` +
        `同一行出现 spawnSync/execSync/execFile/fork/child_process 就照红）：${exempted.join(', ')}`,
    );
  }
  readings.push(`G1 扫描器自身（${SELF_FILE}）按夹具豁免 —— 它的形状由 --self-test 的豁免两腿守，不在扫描面里`);
  return out;
}

/** G3：远程回传路径 == reinstall-all.sh 的 $APK。 */
function checkArtifactPathReconcile(baseRoot) {
  const out = [];
  let reinstallText = '';
  try {
    reinstallText = readFileSync(join(baseRoot, 'scripts/reinstall-all.sh'), 'utf8');
  } catch {
    return [`G3 读不到 scripts/reinstall-all.sh —— 那条 $APK 对账没法做。`];
  }
  // 从被约束的那一方**推导**期望值，而不是把今天的字符串抄进这里（§7 第 165 条那族）。
  // ⚠️ `^\s*` 不是可有可无：那一行在 android 段里是缩进两格的（首跑就是因为少了 `\s*`
  //    而报"找不到那一行"—— 一条读不到现实的判据，报的是自己的错，不是别人的）。
  const m = /^\s*APK="([^"]*app\/build\/outputs\/apk\/release\/app-release\.apk)"/m.exec(reinstallText);
  if (!m) {
    out.push(
      'G3 在 scripts/reinstall-all.sh 里找不到 `APK="…/outputs/apk/release/app-release.apk"` 那一行 ——\n' +
        '      android 段的产物落点改了形状，而远程模式的回传路径没人对账过。',
    );
    return out;
  }
  const expected = m[1].replace(/^\$ROOT\//, '');
  const derived = deriveArtifacts(['assembleRelease']);
  if (derived.length !== 1) {
    out.push(`G3 deriveArtifacts(['assembleRelease']) 应当恰好 1 枚，实际 ${derived.length} 枚：${derived.join(', ')}`);
    return out;
  }
  if (derived[0] !== expected) {
    out.push(
      `G3 回传路径与消费者期望不一致：run-gradle 落到\n      ${derived[0]}\n` +
        `      而 reinstall-all.sh 的 $APK 读的是\n      ${expected}\n` +
        '      ⇒ "APK 必须比源码新"那条判据会被打空（§7 第 27 条）。',
    );
  } else {
    readings.push(`G3 回传路径与 $APK 逐字相同：${expected}`);
  }
  return out;
}

/** G4：收口点还是那一枚。 */
function checkFunnel(baseRoot) {
  const out = [];
  const mobilePkg = JSON.parse(readFileSync(join(baseRoot, 'apps/mobile/package.json'), 'utf8'));
  const androidScripts = Object.entries(mobilePkg.scripts ?? {}).filter(([k]) => k.includes('android'));
  if (androidScripts.length === 0) return ['G4 apps/mobile/package.json 里没有任何 android 脚本 —— 收口点没了。'];
  for (const [name, cmd] of androidScripts) {
    if (!/^node \.\.\/\.\.\/scripts\/run-gradle\.mjs \S+/.test(cmd)) {
      out.push(
        `G4 apps/mobile/package.json 的 ${name} 不再经收口点：\n      ${cmd}\n` +
          '      期望形状是 `node ../../scripts/run-gradle.mjs <task>`（远程路由就在这一枚里）。',
      );
    }
  }
  const rootPkg = JSON.parse(readFileSync(join(baseRoot, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(rootPkg.scripts ?? {})) {
    if (!/^build:android/.test(name)) continue;
    if (typeof cmd === 'string' && cmd.includes('@heyta/mobile') === false && cmd.includes('run-gradle') === false) {
      out.push(`G4 根 package.json 的 ${name} 既不转发到 @heyta/mobile 也不经收口点：\n      ${cmd}`);
    }
  }
  readings.push(`G4 android 脚本 ${androidScripts.length} 条全部经 run-gradle.mjs`);
  return out;
}

/** G5 + G6：路由本体的不变量。 */
function checkRouterInvariants(baseRoot) {
  const out = [];
  const router = readFileSync(join(baseRoot, 'scripts/run-gradle.mjs'), 'utf8');
  const lib = readFileSync(join(baseRoot, 'scripts/lib/sync-windows-sources.sh'), 'utf8');

  if (!/if \(isWindows\) \{/.test(router)) {
    out.push('G5 run-gradle.mjs 里读不到 `if (isWindows) {` —— Windows 那一支没了，远端会递归回远程模式。');
  }
  const remoteBody = (/function runRemote\(\) \{([\s\S]*?)\n\}/.exec(router) ?? ['', ''])[1];
  if (remoteBody.length === 0) {
    out.push('G5 读不到 runRemote() 的函数体 —— 分流形状变了，这条判据无法求值。');
  } else if (remoteBody.includes('runLocal(')) {
    out.push(
      'G5 runRemote() 里出现 runLocal( ⇒ **静默降级**：远程失败会退回本机 gradle。' +
        '\n      规则要的恰恰是"响亮失败并点名是哪一步"，本机执行只能由 HEYTA_ANDROID_LOCAL_GRADLE=1 显式打开。',
    );
  } else {
    readings.push('G5 远程模式内无 runLocal( 调用（拒绝静默降级）');
  }
  if (!/HEYTA_ANDROID_LOCAL_GRADLE/.test(router)) {
    out.push('G5 逃生门变量 HEYTA_ANDROID_LOCAL_GRADLE 不见了 —— 显式例外也没了，只剩"要么远程要么红"。');
  }
  if (!/sync_windows_sources_for_android/.test(router)) {
    out.push('G6 run-gradle.mjs 不再调用 sync_windows_sources_for_android —— 同步机制可能被复制成了第二份。');
  }
  if (/tar -czf/.test(router)) {
    out.push('G6 run-gradle.mjs 自己实现了 tar —— 源码同步出现了第二份实现（AGENTS §3.5：抽出来之后要删掉旧的那份）。');
  }
  if (!/^sync_windows_sources\(\) \{/m.test(lib)) {
    out.push('G6 sync-windows-sources.sh 里 MSIX 那一腿的入口 sync_windows_sources() 没了（两个既有消费方会一起断）。');
  }
  if (!/^sync_windows_sources_for_android\(\) \{/m.test(lib)) {
    out.push('G6 sync-windows-sources.sh 里 Android 那一腿的入口 sync_windows_sources_for_android() 没了。');
  }
  for (const consumer of ['scripts/reinstall-all.sh', 'scripts/verify-windows-shell-journey.mjs']) {
    const p = join(baseRoot, consumer);
    if (!existsSync(p)) continue; // 消费方被删是另一条判据的事（本文件不判"文件在不在"）
    if (!readFileSync(p, 'utf8').includes('sync_windows_sources ')) {
      out.push(`G6 ${consumer} 不再调用 sync_windows_sources —— 同步那半可能被另建了一份。`);
    }
  }
  readings.push('G6 同步机制一枚（两个入口共用 _heyta_windows_sync_push）');
  return out;
}

/**
 * G7：远程前置探测里那条 `node_modules` 路径，必须是 **pnpm 真会创建的目录**。
 *
 * 这条判据是被一次真跑出来的：第一版步骤 1 探的是 `apps\mobile\android\node_modules`，
 * 而 `pnpm-workspace.yaml` 的 packages 是 `packages/*` / `apps/*` / `server` ⇒
 * `apps/mobile/android` 不是工作区包，`pnpm install` 永远不会在那儿建目录。
 * 后果不是"多一条红"，是**一条永不开的门**：远程构建恒定红在步骤 1，
 * 而它给出的修法（去远端跑 pnpm install）做完了照样红 —— 这类判据比没有判据更糟
 * （AGENTS §7 元规则 2）。本机反证：`apps/mobile/node_modules` 在、
 * `apps/mobile/android/node_modules` 不在，而 Mac 的 APK 打得出来。
 *
 * 判法不靠"这路径存不存在"（CI 上是干净检出，没有 node_modules ⇒ 会假红），
 * 靠**推导**：路径去掉 `node_modules` 之后的那一截，必须匹配工作区 packages 的某条 glob。
 */
function checkRemotePreflightPaths(baseRoot) {
  const out = [];
  let router = '';
  try {
    router = readFileSync(join(baseRoot, 'scripts/run-gradle.mjs'), 'utf8');
  } catch {
    return ['G7 读不到 scripts/run-gradle.mjs —— 远程前置路径这条判据无法求值。'];
  }
  let patterns = [];
  try {
    const ws = readFileSync(join(baseRoot, 'pnpm-workspace.yaml'), 'utf8');
    const block = /packages:\n([\s\S]*?)(\n\S|\n*$)/.exec(ws);
    if (block) {
      patterns = [...block[1].matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)].map((m) => m[1].trim());
    }
  } catch {
    /* 下面按"读不到"处理 */
  }
  if (patterns.length === 0) {
    return ['G7 读不到 pnpm-workspace.yaml 的 packages 清单 —— 这条判据无法求值，不要当它成立。'];
  }
  const toRe = (glob) => new RegExp(`^${glob.split('/').map((seg) => (seg === '*' ? '[^/]+' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
  const matchers = patterns.map(toRe);

  // 解析远端常量：`const REMOTE_ANDROID_WIN = `${REMOTE_ROOT}\\apps\\mobile\\android`;`
  const consts = { REMOTE_ROOT: '' };
  for (const m of router.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*`\$\{REMOTE_ROOT\}([^`]*)`/g)) {
    consts[m[1]] = m[2].replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // 扫 preCmd 里的 Test-Path 实参：只挑以 node_modules 结尾的那几条（其它探测项不归这条判）
  const found = [...router.matchAll(/Test-Path\s+'\$\{([A-Z][A-Z0-9_]*)\}([^']*?)node_modules'/g)];
  if (found.length === 0) {
    out.push('G7 远程前置探测里读不到任何 `${REMOTE_*}\\…\\node_modules` 形状 —— 依赖前置那一档可能被整段摘掉了。');
    return out;
  }
  for (const f of found) {
    const base = consts[f[1]];
    if (base === undefined) {
      out.push(`G7 探测路径用了没解析出来的远端常量 \${${f[1]}} —— 这条判据无法判断它指向哪，不算成立。`);
      continue;
    }
    const rel = `${base}/${f[2].replace(/\\\\/g, '/').replace(/\\/g, '/').replace(/\/+$/, '')}`.replace(/^\/+/, '');
    if (!matchers.some((re) => re.test(rel))) {
      out.push(
        `G7 远程前置探的 ${rel}/node_modules **不是工作区包目录**（pnpm-workspace 的 packages = ${patterns.join(', ')}）—— ` +
          `pnpm install 永远不会在那儿建 node_modules ⇒ 这是一条永不开的门：远程构建会恒定红在步骤 1，` +
          `而它给的修法执行完也还是红。本机反证：Mac 上没有该目录而 APK 打得出来。`,
      );
    } else {
      readings.push(`G7 远程前置路径 ${rel}/node_modules 由工作区包 ${rel} 推导成立`);
    }
  }
  return out;
}

/* ── 自检：逐臂证明每条判据都会红（臂 0 是阳性对照，臂 7/8 是豁免的正反两腿）── */

/**
 * 臂的设计原则（AGENTS §7 元规则 2：不能失败的判据没有价值）：
 *  1. 每一臂都要**改一个真实形状**而不是改期望值；
 *  2. 期望值必须写成"恰好几条红"，不能只写"有红"（否则会靠一条无关的红凑数）；
 *  3. 至少一臂是**阳性对照**（干净夹具 ⇒ 0 红），证明这套判据不是恒红。
 */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-android-gate-'));
  let fail = 0;
  const write = (rel, text) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const countRed = (msgs, needle) => msgs.filter((m) => m.includes(needle)).length;

  try {
    /* 夹具基座：一份"最小但形状正确"的树（阳性对照用） */
    const router = readFileSync(join(DEFAULT_ROOT, 'scripts/run-gradle.mjs'), 'utf8');
    const lib = readFileSync(join(DEFAULT_ROOT, 'scripts/lib/sync-windows-sources.sh'), 'utf8');
    const reinstall = readFileSync(join(DEFAULT_ROOT, 'scripts/reinstall-all.sh'), 'utf8');
    const mobilePkg = readFileSync(join(DEFAULT_ROOT, 'apps/mobile/package.json'), 'utf8');
    const rootPkg = readFileSync(join(DEFAULT_ROOT, 'package.json'), 'utf8');
    const baselineA = readFileSync(join(DEFAULT_ROOT, 'scripts/verify-mobile-aed.sh'), 'utf8');
    const baselineB = readFileSync(join(DEFAULT_ROOT, 'scripts/verify-android-vault-storage.sh'), 'utf8');
    const wsYaml = readFileSync(join(DEFAULT_ROOT, 'pnpm-workspace.yaml'), 'utf8');

    const seed = (tweaks = {}) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      write('scripts/run-gradle.mjs', tweaks.router ?? router);
      write('scripts/lib/sync-windows-sources.sh', tweaks.lib ?? lib);
      write('scripts/reinstall-all.sh', tweaks.reinstall ?? reinstall);
      write('scripts/verify-mobile-aed.sh', tweaks.baselineA ?? baselineA);
      write('scripts/verify-android-vault-storage.sh', tweaks.baselineB ?? baselineB);
      write('apps/mobile/package.json', tweaks.mobilePkg ?? mobilePkg);
      write('package.json', tweaks.rootPkg ?? rootPkg);
      write('pnpm-workspace.yaml', tweaks.wsYaml ?? wsYaml);
    };

    /* 臂 0：阳性对照 —— 干净夹具必须 0 红（否则整套判据是恒红装饰） */
    seed();
    let msgs = [...checkGradlewSites(dir), ...checkArtifactPathReconcile(dir), ...checkFunnel(dir), ...checkRouterInvariants(dir), ...checkRemotePreflightPaths(dir)];
    if (msgs.length === 0) console.log('   ✅ 臂 0 阳性对照：干净夹具 0 红');
    else {
      console.log(`   🔴 臂 0 坏了：干净夹具报了 ${msgs.length} 条\n      ${msgs.join('\n      ').slice(0, 600)}`);
      fail = 1;
    }

    /* 臂 1：新开一个 Mac 直连 gradle 的入口 ⇒ G1 恰好 1 条 */
    write('scripts/verify-new-thing.sh', '#!/bin/bash\ncd apps/mobile/android\n./gradlew assembleRelease\n');
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G1 ') === 1) console.log('   ✅ 臂 1 转红：新入口被 G1 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 1 存活：新写的 ./gradlew 入口只报了 ${countRed(msgs, 'G1 ')} 条 G1`);
      fail = 1;
    }
    rmSync(join(dir, 'scripts/verify-new-thing.sh'));

    /* 臂 2：把一条基线真迁走（改掉那一行）而基线还登记着 ⇒ G2 恰好 1 条 */
    write(
      'scripts/verify-mobile-aed.sh',
      baselineA.replace('./gradlew --no-daemon --console=plain', 'node ../../scripts/run-gradle.mjs --no-daemon --console=plain'),
    );
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G2 ') === 1) console.log('   ✅ 臂 2 转红：基线比现实宽，被 G2 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 2 存活：撤掉那一行后 G2 报了 ${countRed(msgs, 'G2 ')} 条（应当恰好 1）`);
      fail = 1;
    }

    /* 臂 3：换掉 reinstall-all.sh 的 $APK 路径 ⇒ G3 恰好 1 条 */
    seed();
    write('scripts/reinstall-all.sh', reinstall.replace('outputs/apk/release/app-release.apk', 'outputs/apk/release/heyta.apk'));
    msgs = checkArtifactPathReconcile(dir);
    if (countRed(msgs, 'G3') === 1) console.log('   ✅ 臂 3 转红：回传路径与 $APK 对不上，被 G3 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 3 存活：改了 $APK 之后 G3 报了 ${countRed(msgs, 'G3')} 条`);
      fail = 1;
    }

    /* 臂 4：apps/mobile 的脚本绕开收口点 ⇒ G4 恰好 1 条 */
    seed();
    write(
      'apps/mobile/package.json',
      mobilePkg.replace('node ../../scripts/run-gradle.mjs assembleRelease', 'cd android && ./gradlew assembleRelease'),
    );
    msgs = [...checkFunnel(dir), ...checkGradlewSites(dir)];
    const g4 = countRed(msgs, 'G4 ');
    const g1 = countRed(msgs, 'G1 ');
    if (g4 === 1 && g1 === 1) console.log('   ✅ 臂 4 转红：绕开收口点同时被 G4 与 G1 各抓一条');
    else {
      console.log(`   🔴 臂 4 存活：G4 报 ${g4} 条（应 1）、G1 报 ${g1} 条（应 1）`);
      fail = 1;
    }

    /* 臂 5：在 runRemote() **函数体内**塞一条静默降级 ⇒ G5 恰好 1 条
     *（变异必须施在被扫的那一层：塞在分流处（函数体外）是合法的 Windows 分支，不该红）*/
    seed();
    write('scripts/run-gradle.mjs', router.replace('const remoteCmd =', 'runLocal("远程不行就本机"); const remoteCmd ='));
    msgs = checkRouterInvariants(dir);
    if (countRed(msgs, 'G5 ') === 1) console.log('   ✅ 臂 5 转红：远程模式里的静默降级被 G5 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 5 存活：静默降级只报了 ${countRed(msgs, 'G5 ')} 条 G5`);
      fail = 1;
    }

    /* 臂 6：另建一份 tar 同步（复制实现）⇒ G6 恰好 1 条 */
    seed();
    write('scripts/run-gradle.mjs', `${router}\nconst injectedSecondCopy = "tar -czf /tmp/x.tgz";\n`);
    msgs = checkRouterInvariants(dir);
    if (countRed(msgs, 'G6 ') === 1) console.log('   ✅ 臂 6 转红：第二份同步实现被 G6 抓到（恰好 1 条）');
    else {
      console.log(`   🔴 臂 6 存活：复制实现只报了 ${countRed(msgs, 'G6 ')} 条 G6`);
      fail = 1;
    }
    /* 臂 7：门禁同类文件里**只描述**命令 ⇒ 必须不红（正向：豁免不是靠猜，是被量出来的）
     *  这一臂的存在理由：并行会话新增的 scripts/check-android-build-host.mjs 真的
     *  因为自己的 needle 被本门禁报了 4 条红 —— 那是**扫描器的描述文本**，不是构建入口。*/
    seed();
    write('scripts/check-some-other-gate.mjs', "const BASELINE = [{ needle: 'cd android && ./gradlew assembleDebug' }];\n");
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G1 ') === 0) console.log('   ✅ 臂 7 正照：门禁文件里"只描述"的 needle 不判红（豁免生效）');
    else {
      console.log(`   🔴 臂 7 坏了：描述性的 needle 被判成红（${countRed(msgs, 'G1 ')} 条）—— 豁免没生效`);
      fail = 1;
    }

    /* 臂 8：同一类文件里**真的把 gradlew 交给自己 spawn** ⇒ 必须红（豁免不能变成通行证） */
    write('scripts/check-some-other-gate.mjs', "import { spawnSync } from 'node:child_process';\nspawnSync('gradlew.bat', ['assembleRelease']);\n");
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G1 ') === 1) console.log('   ✅ 臂 8 转红：门禁文件里真执行 gradlew 的那一行照红（豁免带反向判据）');
    else {
      console.log(`   🔴 臂 8 存活：门禁文件里的真实 spawn 只报了 ${countRed(msgs, 'G1 ')} 条（应当恰好 1）`);
      fail = 1;
    }

    /* 臂 9：把远程前置路径改回"非工作区包目录"那一枚 ⇒ G7 恰好 1 条。
     * 这一臂就是**真事故的形状**：第一版步骤 1 探的正是 `apps\mobile\android\node_modules`，
     * 而 pnpm-workspace 的 packages 是 packages/* + apps/* + server，里面**没有**它 ⇒
     * `pnpm install` 永远不会在那儿建目录，远程构建会**恒定**红在步骤 1，而它给出的修法
     * 执行完仍然红。这是 AGENTS §7 元规则 2 说的"一条永不开的门比没有判据更糟"。 */
    seed();
    const badRouter = router.replace(
      '${REMOTE_ROOT}\\\\apps\\\\mobile\\\\node_modules',
      '${REMOTE_ROOT}\\\\apps\\\\mobile\\\\android\\\\node_modules',
    );
    if (badRouter === router) {
      console.log('   🔴 臂 9 没施上：run-gradle.mjs 里读不到 `${REMOTE_ROOT}\apps\mobile\node_modules` 那一串 —— 前置形状变了，G7 无从求值');
      fail = 1;
    } else {
      write('scripts/run-gradle.mjs', badRouter);
      msgs = checkRemotePreflightPaths(dir);
      if (countRed(msgs, 'G7 ') === 1) console.log('   ✅ 臂 9 转红：非工作区包的 node_modules 前置被 G7 抓到（恰好 1 条，永不开的门）');
      else {
        console.log(`   🔴 臂 9 存活：前置换成非工作区包目录后 G7 报了 ${countRed(msgs, 'G7 ')} 条（应当恰好 1）`);
        fail = 1;
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    fail === 0
      ? '自检：逐臂（臂 0 = 阳性对照）全部按预期转红/转绿 —— 臂数见上面逐条打印，别抄进文档'
      : '自检有臂存活 —— 那条判据等于没有',
  );
  return fail;
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */

if (SELF_TEST) process.exit(selfTest());

if (!existsSync(join(root, 'scripts/run-gradle.mjs'))) {
  console.error(`🔴 ${root} 不是一棵 heyta 树（读不到 scripts/run-gradle.mjs）—— 判据无法求值，按红处理。`);
  process.exit(1);
}

for (const f of [
  ...checkGradlewSites(root),
  ...checkArtifactPathReconcile(root),
  ...checkFunnel(root),
  ...checkRouterInvariants(root),
  ...checkRemotePreflightPaths(root),
]) {
  failures.push(f);
}

console.log('Android 构建入口对账（静态，不联网、不构建）：');
for (const r of readings) console.log(`   · ${r}`);

if (failures.length > 0) {
  for (const f of failures) console.error(`🔴 ${f}`);
  console.error(`\n共 ${failures.length} 处。规则本体：之后 Android 任务一律走远程构建主机（windows-pc）。`);
  console.error('手册：docs/runbooks/android-build-on-windows.md');
  process.exit(1);
}
console.log('✅ Android 构建只从 run-gradle.mjs 那一枚收口点出去（含存量基线逐条仍在、路径对账成立）');
