#!/usr/bin/env node
/**
 * `check:android-gradle-remote` —— Android 构建只能从**一枚收口点**出去
 * ==============================================================================
 *
 * ## 判的是哪条规则
 *
 * 产品负责人两道令，后者换载体、不解除前者的形状：
 *   · 2026-10-04：「之后 Android 任务一律 ssh windows-pc，不要再在 Mac 起新的 Gradle
 *     构建或模拟器。」
 *   · 2026-10-28：「安卓我需要在 Linux dev 上做，把整个安卓都迁移到 Linux dev 上。」
 *     ⇒ 载体换成 `linux-dev`，构建与设备侧验收同机。
 * 落地方式是让 `scripts/run-gradle.mjs` 按平台分流（macOS/Linux 远程、Windows 本机），因为所有
 * Android 入口本来就汇成那一枚：
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
 *        `.ps1` 也不在：PowerShell 只会跑在 Windows 上，那里本机执行就是正解；
 *        `evidence/` 下的 `.json` 清单按**数据记录**放行 —— 它们只是记下哪些文件进了包，
 *         那一行不执行任何东西，但同一个 `evidence/` 目录下的 `.sh` 仍在扫描面里。
 *         两条反向腿由 `--self-test` 的臂 13b／13c 钉住，理由见 EVIDENCE_RECORD。）
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
 *      `scripts/lib/sync-build-sources.sh` 的 `sync_windows_sources_for_android`，
 *      而自己**不实现**第二份源码打包（不许出现 `tar -czf`）；同一文件里
 *      `sync_windows_sources`（MSIX 那一腿的入口）与它的两个消费方必须都还在。
 *      —— 这是 AGENTS §3.5「抽出来的收尾动作是删掉旧的那份并加门禁」那一课的直接应用。
 *   G7 **远程前置不许是一条永不开的门**：步骤 1 探的那些 `<远端根>/…/node_modules`，
 *      去掉 `node_modules` 之后必须匹配 `pnpm-workspace.yaml` 的某一条 packages glob。
 *      理由是真事故：第一版探 `apps/mobile/android/node_modules`，而 `apps/mobile/android`
 *      不是工作区包 ⇒ `pnpm install` 永远不会在那儿建目录，远程构建**恒定**红在步骤 1，
 *      而它给出的修法执行完照样红（§7 元规则 2）。期望值靠**推导**工作区清单，
 *      不靠"这路径在不在" —— 后者在干净检出上必假红。
 *   G8 **远端仓库根单源**：路由必须把 `${REMOTE_ROOT}` 传给同步、同步必须把第二枚实参绑回
 *      `HEYTA_BUILD_REPO_ROOT`，且 dry-run 打印的那条要与真跑同形。两个旋钮只移一个就是
 *      "同步解包到 A 树、gradle 在 B 树里构建"（§7 第 82 条的远程形态）。三条腿各一臂。
 *   G9 **步骤 1 的依赖前置要逐包、要先证明探针跑成了**：名单由 `apps/mobile/package.json`
 *      推导、`DEPCHECK`/`DEPMISS` 分两条输出、判定侧有"数不对 ⇒ 判探针故障"的守卫。
 *      理由同样是真事故：2026-10-05 第一次真远程构建红了 18m18s，而步骤 1 当时只
 *      探那枚**目录** ⇒ 远端少两枚已声明的包被伪装成"前置过了"。
 *      与 G7 是同一族（"目录存在"被当成"构建输入齐"），但不是同一件事：G7 拦的是
 *      探错了地方（永不开的门），G9 拦的是探对了地方却只看了目录。
 *   G10 **步骤 5 的 mtime 读回要给 ISO-8601、本地必须 Date.parse、且不许把"读不到"读成 0**：
 *      远端那一行必须是 `date -u -d @… +%Y-%m-%dT%H:%M:%SZ` 的形状（远端只给字符串，
 *      换算留在本地），本地必须 `Date.parse(mtimeRaw)` + 一个下界（`MTIME_FLOOR`）。
 *      理由是真事故两笔：① 旧载体（Windows PowerShell 5.1）上 `[DateTime]` 没有
 *      `ToUnixTimeSeconds()`，那一行抛错后**什么都不输出**，而 `Number('')` 恰好是 `0`
 *      ⇒ `BUILD SUCCESSFUL` 的那一次被报成"产物是 1970 年的"，**归因也是坏的**（它指着
 *      §7 第 27 条说"拿旧产物报绿"，而产物是新的、探针是坏的）；② 换到 bash 之后
 *      `$(stat -c %Y …)` 在文件不存在时展开成**空串**，是同一个坑的新载体版本 ——
 *      所以"远端不许只给 Unix 秒"这条在 POSIX 上继续有效，而不是一句 Windows 专属的历史。
 *      与 G9 同族（探针自己坏了），但方向相反：G9 拦"看漏了却报通过"，
 *      G10 拦"看错了却报失败"—— 两边都要有，否则下一次红会给出一个错误的根因。
 *   G11 **载体默认值只许一处定义，且不许漂回旧载体**：`linux-dev` 这三枚默认值（主机 / SDK 根 /
 *      私有 Gradle 用户目录）的**真源是 `scripts/lib/sync-build-sources.sh` 顶部那三行**，
 *      `run-gradle.mjs` 与设备侧的 `verify-android-{subscription,vault-storage}.sh` 的默认值
 *      必须逐字等于它 —— 两枚 `*_ON_HOST` 与那枚 host 各写各的，就会长成"构建在 A 树、
 *      验收取 B 产物"（又是 §7 第 82 条）。另一半是 `windows-pc` / `C:\src\heyta` 不许出现在
 *      收口点的代码里（`.md` 在册的迁移记录除外）：拍板已经改口，漂回去就是**把构建送回
 *      那台只该管 MSIX 的机器**。两半各有一臂（`--self-test` 的载体臂）。
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
 * 取证目录下的 **`.json` 清单 = 数据记录**，不是构建入口。2026-10-14 加，同样是实测逼出来的：
 * G1 在真树上报了 4 条红，四条全在已提交的 evidence 清单里，内容是把
 * `apps/mobile/android/gradlew(.bat)` 当作**被记录的输入文件**登记了路径与 sha256：
 *   · `apps/mobile/evidence/ux-final-20261008/android-candidate/auth-legal-frozen/source-inputs.json:482,487`
 *   · `apps/web/evidence/ux-final-20261008/source-candidate/source-manifest.json:171,172`
 * 本文件头 G1 自己写的口径是「全仓**可执行文件**里……」，而一行 `"path": "apps/mobile/android/gradlew",`
 * 不执行任何东西 —— 命中它等于让取证**记录**了哪些文件这件事变成违规。
 *
 * 🔴 豁免只给 `.json`，**不给整个 `evidence/` 目录**：跑验收的脚本（`run-leg.sh` 那一类）
 * 确实住在 `evidence/` 下，而它会真的把进程交出去。所以同目录下的 `.sh/.py/.mjs`
 * 仍留在扫描面里 —— 由 `--self-test` 的臂 13c 钉住（臂 13 = 记录不红，13b = 非 evidence 的
 * 同名 `.json` 照红，13c = evidence 里的可执行脚本照红）。
 */
const EVIDENCE_RECORD = /(^|\/)evidence\/.*\.json$/;

/**
 * G2 的基线：**规则生效之前**就存在的直接 gradlew 入口。每条都要写清"为什么还留着"，
 * 而且必须仍然在现量扫描里命中，否则红。
 *
 * 🔴 这两条都不是"合法的新入口"，是**待迁的存量**：
 *   · `verify-mobile-aed.sh` 用 `-I hermes-aed-probe.init.gradle` 注入 init 脚本，
 *     且产物是"探针 + APK"两件事，本批没做真机构建 ⇒ 不能盲改它的路由；
 *   · `verify-android-vault-storage.sh` 已迁移到 `run-gradle.mjs`，其
 *     `assembleDebugAndroidTest` 是路由器中唯一登记的 instrumentation APK 例外。
 * 迁移存量时必须同步删除基线；**当前只剩 AED 这一条，任何第三条都不许加进来** ——
 * 基线的价值就在于它会因为"现实变了"而红。
 */
const BASELINE = [
  {
    file: 'scripts/verify-mobile-aed.sh',
    needle: './gradlew --no-daemon --console=plain',
    reason: '存量：Hermes AED 探针用 -I init 脚本，且需要探针与 APK 两件事一起迁；本批未做真机构建，不盲改路由。',
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
  const records = [];
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
      // 取证目录下的 `.json` 是**被记录的文件清单**，不是会执行的东西（理由见 EVIDENCE_RECORD）。
      if (EVIDENCE_RECORD.test(relFile)) {
        const linesRec = text.split('\n');
        for (let i = 0; i < linesRec.length; i += 1) {
          if (!linesRec[i].includes('gradlew')) continue;
          if (isCommentLine(linesRec[i])) continue;
          records.push(`${relFile}:${i + 1}`);
        }
        continue;
      }
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
  return { sites, exempted, records };
}

/* ── 判据 ─────────────────────────────────────────────────────────────── */

const failures = [];
const readings = [];

/** G1 + G2：现量扫描 vs 白名单 + 基线。 */
function checkGradlewSites(baseRoot) {
  const { sites, exempted, records } = findGradlewSites(baseRoot);
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
  if (records.length > 0) {
    readings.push(
      `G1 取证记录豁免 ${records.length} 处（只放行 evidence/ 下的 **.json 清单**：它们把 gradlew 当作被记录的输入文件` +
        `登记路径或 sha256，那一行不执行任何东西；同一目录下的 .sh/.py/.mjs 仍在扫描面里 —— ` +
        `由 --self-test 臂 13／13b／13c 三条腿钉住）：${records.slice(0, 8).join(', ')}${records.length > 8 ? ' …' : ''}`,
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
  const lib = readFileSync(join(baseRoot, 'scripts/lib/sync-build-sources.sh'), 'utf8');

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
  if (!/sync_android_sources /.test(router)) {
    out.push('G6 run-gradle.mjs 不再调用 sync_android_sources —— 同步机制可能被复制成了第二份。');
  }
  if (/tar -czf/.test(router)) {
    out.push('G6 run-gradle.mjs 自己实现了 tar —— 源码同步出现了第二份实现（AGENTS §3.5：抽出来之后要删掉旧的那份）。');
  }
  if (!/^sync_windows_sources\(\) \{/m.test(lib)) {
    out.push('G6 sync-build-sources.sh 里 MSIX 那一腿的入口 sync_windows_sources() 没了（两个既有消费方会一起断）。');
  }
  if (!/^sync_android_sources\(\) \{/m.test(lib)) {
    out.push('G6 sync-build-sources.sh 里 Android 那一腿的入口 sync_android_sources() 没了。');
  }
  for (const consumer of ['scripts/reinstall-all.sh', 'scripts/verify-windows-shell-journey.mjs']) {
    const p = join(baseRoot, consumer);
    if (!existsSync(p)) continue; // 消费方被删是另一条判据的事（本文件不判"文件在不在"）
    if (!readFileSync(p, 'utf8').includes('sync_windows_sources ')) {
      out.push(`G6 ${consumer} 不再调用 sync_windows_sources —— 同步那半可能被另建了一份。`);
    }
  }
  readings.push('G6 同步机制一枚（两条载体腿共用 _heyta_sync_make_tar）');
  // 🔴 G8：**远端仓库根只有一个事实源**。路由侧读 `HEYTA_ANDROID_REMOTE_ROOT`，
  //    同步侧读 `HEYTA_WINDOWS_REPO_ROOT`，两个默认值逐字相同 ⇒ 平时看不出来，
  //    **只移一个**就变成"同步解包到 A、gradle 在 B 里构建"——§7 第 82 条搬到远程路径上。
  //    所以：调用侧必须把手里那枚根**传进**同步入口，同步入口必须把它绑回局部变量。
  const CALL_SHAPE = /sync_android_sources \$\{HOST\} '\$\{REMOTE_ROOT\}'/;
  // 🔴 判的是**真跑那一支**：同一串在 dry-run 的打印里也出现一次，整文件计数会把
  //    "只改了打印、真调用没传"那种情况读成绿（臂 10 第一趟就是这么存活过去的 —— 摘掉实参
  //    仍然 0 条红，因为剩下那条命中在 `console.log` 里）。所以先用 runCapture 的块圈定范围。
  const callBlock = /runCapture\('bash', \[[\s\S]*?\]\);/.exec(router);
  if (!callBlock) {
    out.push('G8 读不到 `runCapture(\'bash\', […])` 那一块 —— 调用侧这条判据无从求值，不要当它成立。');
  } else if (!CALL_SHAPE.test(callBlock[0])) {
    out.push(
      'G8 run-gradle.mjs 调 `sync_windows_sources_for_android` 时没把自己那枚 `${REMOTE_ROOT}` 传过去 —— ' +
        '远端仓库根又变成两个旋钮（`HEYTA_ANDROID_REMOTE_ROOT` 与 `HEYTA_ANDROID_BUILD_ROOT`），' +
        '只移一个就是"同步解包到 A、gradle 在 B 里构建"（§7 第 82 条的远程形态）。',
    );
  }
  // 第二条腿：打印出来的计划必须与真跑那一条同形，否则 dry-run 是在骗人。
  const occ = (router.match(new RegExp(CALL_SHAPE.source, 'g')) || []).length;
  if (callBlock && CALL_SHAPE.test(callBlock[0]) && occ !== 2) {
    out.push(
      `G8 dry-run 打印的同步命令与真跑那一条**不同形**（现量命中 ${occ}，要求 2 = 真调用 + 计划打印）—— ` +
        `按计划跑的人会漏掉远端根那一枚实参。`,
    );
  }
  if (!/local HEYTA_ANDROID_BUILD_ROOT="\$\{_android_remote_root:-\$HEYTA_ANDROID_BUILD_ROOT\}"/.test(lib)) {
    out.push(
      'G8 sync-build-sources.sh 的 `sync_android_sources` 不再绑定第二枚实参到 ' +
        '`HEYTA_ANDROID_BUILD_ROOT` —— 传进来的远端根会被静默丢弃，两个旋钮又分开了。',
    );
  }
  if (callBlock && CALL_SHAPE.test(callBlock[0]) && occ === 2 && /local HEYTA_ANDROID_BUILD_ROOT="\$\{_android_remote_root:-\$HEYTA_ANDROID_BUILD_ROOT\}"/.test(lib)) {
    readings.push('G8 远端仓库根单源（路由把 REMOTE_ROOT 传进同步，同步绑回局部）');
  }

  /* G9：步骤 1 的远端依赖前置必须是**逐包**判定，而且**先证明探针跑成了再说"缺 0 个"**。
   * 这条判据是被 2026-10-05 那次 18m18s 的失败照出来的（runbook §7.1）：当时 preCmd 只
   * `Test-Path apps\mobile\node_modules`（目录级），远端少两枚**已声明**的包而它报 ✅，
   * 真红要等 Metro 在 18 分钟后打那句 `Unable to resolve module`。
   * 三个形状缺任何一个都会退回那个状态，所以三条各自一条红腿：
   *   1. 名单由 `apps/mobile/package.json` 的 dependencies **推导**（写死一份名单会自己漂）；
   *   2. `DEPCHECK` 与 `DEPMISS` **分两条 Write-Output** —— 同一行会被 `marker()` 的
   *      `[^\r\n]*` 贪婪读成 `19 DEPMISS=2`，`Number()` 得 NaN，于是守卫把一次**正常探测**
   *      误判成探针故障。这不是风格问题，是形状（第 3 条守卫建立在第 2 条之上）；
   *   3. 判定侧有"读不到 / 数不对 ⇒ 判探针故障"的守卫，否则"没数过"会被放行成"缺 0 个"。 */
  const DERIVE = /Object\.keys\(mobilePkg\.dependencies/;
  // 🔴 判的是"两条标记各占一条输出"这个**形状**，不是某一方言的写法：换到 bash 之后
  //    它是两条 `echo`（旧载体上是两条 `Write-Output`）。挤回同一行照样红 ——
  //    因为 `marker()` 用 `[^\r\n]*` 取值，同一行会把 `DEPMISS=2` 一起吞进 DEPCHECK 的读数里。
  const SPLIT_MARKERS = /echo "DEPCHECK=\$CHECKED"[\s\S]{0,60}echo "DEPMISS=\$MISS"/;
  const PROBE_GUARD = /Number\.isFinite\(depChecked\) \|\| depChecked !== declaredDeps\.length/;
  if (!DERIVE.test(router)) {
    out.push(
      'G9 步骤 1 的依赖名单不是从 apps/mobile/package.json 推导的 —— 逐包前置要么被摘掉了，' +
        '要么换成了一份会自己漂的写死名单。那次 18m18s 的失败就是"目录级判据伪装成前置过了"。',
    );
  }
  if (!SPLIT_MARKERS.test(router)) {
    out.push(
      'G9 DEPCHECK / DEPMISS 不是两条独立输出 —— 同一行会让 marker() 的 [^\\r\\n]* 贪婪读到整串，' +
        'Number() 得 NaN，于是探针故障守卫把一次**正常探测**判成故障（或者反过来把故障读成正常）。',
    );
  }
  if (!PROBE_GUARD.test(router)) {
    out.push(
      'G9 判定侧缺"DEPCHECK 读不到 / 数不等于名单长度 ⇒ 判探针故障"那条守卫 —— ' +
        '没有它，"没数过"与"缺 0 个"在输出上长得一样，而放行读的是后者。',
    );
  }
  if (DERIVE.test(router) && SPLIT_MARKERS.test(router) && PROBE_GUARD.test(router)) {
    readings.push('G9 步骤 1 逐包前置（名单由 package.json 推导 ／ 两标记分行 ／ 探针故障守卫在位）');
  }

  /* G10：步骤 5 的 mtime 读回（四条腿，与 G9 一样各自只动一处 ⇒ 每臂恰好 1 条红）。
   *  1. 远端不许把 `stat -c %Y` 的**裸 Unix 秒**直接落进 MTIME（换算必须留在本地）；
   *  2. 远端必须给 ISO-8601（`date -u -d @… +%Y-%m-%dT%H:%M:%SZ`）；
   *  3. 本地必须 `Date.parse(mtimeRaw)`（不许 `Number()` —— 空串读成 0 且 0 是有限数）；
   *  4. 判定侧必须有下界，否则"读不到"会以"产物是 1970 年的"这个**错误归因**红出去。
   *  这条判据跨载体有效：旧载体上是 PowerShell 5.1 缺 `ToUnixTimeSeconds()` 造成空输出，
   *  新载体上 `$(stat -c %Y …)` 在文件不存在时同样展开成空串 —— 同一个坑，换个方言。 */
  const RAW_EPOCH_MTIME = /::MTIME=\$\(stat -c %Y/;
  const ISO_MTIME = /date -u -d @\$\(stat -c %Y/;
  const PARSE_ISO = /Date\.parse\(mtimeRaw\)/;
  const FLOOR_GUARD = /mtime < MTIME_FLOOR/;
  if (RAW_EPOCH_MTIME.test(router)) {
    out.push(
      'G10 步骤 5 的远端 MTIME 直接落 `stat -c %Y` 的裸 Unix 秒 —— 文件不存在时那一串展开成**空串**，' +
        "而 Number('') 恰好是 0，于是成功的构建被报成\"产物是 1970 年的\"，" +
        '归因还指着 §7 第 27 条（产物明明是新的、坏的是探针）。远端只给 ISO-8601，换算留在本地。',
    );
  }
  if (!ISO_MTIME.test(router)) {
    out.push(
      'G10 步骤 5 的远端 mtime 不再输出 ISO-8601（`date -u -d @… +%Y-%m-%dT%H:%M:%SZ`）—— ' +
        '换算一旦挪到远端，"读不到"就没有稳定的形状可判了。',
    );
  }
  if (!PARSE_ISO.test(router)) {
    out.push(
      'G10 步骤 5 不再用 Date.parse(mtimeRaw) 换算时间 —— 换成 Number(...) 时空串会读成 0，' +
        '而 0 是有限数，于是"探针没读到"会以"产物是 1970 年的"这个错误归因红出去。',
    );
  }
  if (!FLOOR_GUARD.test(router)) {
    out.push(
      'G10 判定侧缺 mtime 下界 —— 没有它，"探针没读到"会以"产物比构建起点旧"的形式红出去，' +
        '把一次成功的构建归因成 §7 第 27 条那个形状。',
    );
  }
  if (
    !RAW_EPOCH_MTIME.test(router) &&
    ISO_MTIME.test(router) &&
    PARSE_ISO.test(router) &&
    FLOOR_GUARD.test(router)
  ) {
    readings.push('G10 步骤 5 mtime 读回（远端给 ISO ／ 本地 Date.parse ／ 下界守卫在位）');
  }
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

  // 远端根只有一处定义：探测脚本开头那行 `R='<远端根>'`。
  const rootAssign = /`R='\$\{REMOTE_ROOT\}'`/.test(router);
  if (!rootAssign) {
    out.push(
      'G7 步骤 1 的探测脚本里没有 `R=\'${REMOTE_ROOT}\'` 那一行 —— 远端根又变成逐条拼接，' +
        '换落点时"探测 A、构建 B"没人拦（§7 第 82 条的远程形态）。',
    );
  }
  // 扫探测项：`[ -d "$R/<rel>/node_modules…" ]` 里的每一条 `<rel>`。
  const found = [...router.matchAll(/\[ -d "\$R\/([^"]*?)node_modules/g)];
  if (found.length === 0) {
    out.push('G7 远程前置探测里读不到任何 `$R/…/node_modules` 形状 —— 依赖前置那一档可能被整段摘掉了。');
    return out;
  }
  for (const f of found) {
    const rel = f[1].replace(/\/+$/, '');
    if (rel === '') continue; // `$R/node_modules` 量的是工作区根本身，恒成立
    if (!matchers.some((re) => re.test(rel))) {
      out.push(
        `G7 远程前置探的 $R/${rel}/node_modules **不是工作区包目录**（pnpm-workspace 的 packages = ${patterns.join(', ')}）—— ` +
          `pnpm install 永远不会在那儿建 node_modules ⇒ 这是一条永不开的门：远程构建会恒定红在步骤 1，` +
          `而它给的修法执行完也还是红。本机反证：Mac 上没有该目录而 APK 打得出来。`,
      );
    } else {
      readings.push(`G7 远程前置路径 $R/${rel}/node_modules 由工作区包 ${rel} 推导成立`);
    }
  }
  return out;
}

/* ── G11：载体默认值单源 + 不许漂回旧载体 ────────────────────────────────
 * 载体那四枚默认值（主机 / 构建根 / SDK 根 / 私有 Gradle 用户目录）的**真源**是
 * `scripts/lib/sync-build-sources.sh` 顶部那四行；`run-gradle.mjs` 与设备侧那两枚
 * `*_ON_HOST` 只是抄件。抄件漂了不会自己报错——它会安静地"构建在 A 树、验收取 B 产物"
 * （§7 第 82 条）。另一半是 `windows-pc` 不许出现在收口点的**代码行**里：拍板已改口，
 * 漂回去等于把 Android 构建送回那台只该管 MSIX 的机器。
 * ⚠️ 只判非注释行（与 H2 同一纪律）：手册与本文件的迁移记录**必须**能写出旧载体名。 */
function checkCarrierDefaults(baseRoot) {
  const out = [];
  let lib = '';
  let router = '';
  try {
    lib = readFileSync(join(baseRoot, 'scripts/lib/sync-build-sources.sh'), 'utf8');
    router = readFileSync(join(baseRoot, 'scripts/run-gradle.mjs'), 'utf8');
  } catch {
    return ['G11 读不到 lib 或收口点 —— 载体默认值这条判据无法求值，不要当它成立。'];
  }
  const KEYS = {
    HOST: ['HEYTA_ANDROID_HOST', 'ANDROID_HOST'],
    BUILD_ROOT: [],
    SDK_ON_HOST: ['ANDROID_SDK_ON_HOST'],
    GRADLE_HOME: [],
  };
  const defs = {};
  for (const m of lib.matchAll(/^HEYTA_ANDROID_(HOST|BUILD_ROOT|SDK_ON_HOST|GRADLE_HOME)="\$\{HEYTA_ANDROID_[A-Z_]+:-(.+?)\}"/gm)) {
    defs[m[1]] = m[2];
  }
  const missing = Object.keys(KEYS).filter((k) => !(k in defs));
  if (missing.length > 0) {
    return [`G11 lib 顶部缺这几枚载体默认值的定义：${missing.join(', ')} —— 真源没了，抄件无从对账。`];
  }
  for (const [k, v] of Object.entries(defs)) {
    if (v.trim() === '') out.push(`G11 载体默认值 HEYTA_ANDROID_${k} 是空串 —— 空默认值会让远端路径拼成相对形状，比写错更晚暴露。`);
  }
  // 抄件逐枚对账
  const copies = [
    ['run-gradle 的 HOST', /const HOST = process\.env\.HEYTA_ANDROID_HOST \|\| '([^']+)';/.exec(router), defs.HOST],
    ['run-gradle 的 REMOTE_ROOT', /const REMOTE_ROOT = process\.env\.HEYTA_ANDROID_REMOTE_ROOT \|\| '([^']+)';/.exec(router), defs.BUILD_ROOT],
    ['run-gradle 的 SDK_ON_HOST', /const SDK_ON_HOST = process\.env\.HEYTA_ANDROID_SDK_ON_HOST \|\| '([^']+)';/.exec(router), defs.SDK_ON_HOST],
    ['run-gradle 的 GRADLE_HOME', /const GRADLE_HOME_ON_HOST = process\.env\.HEYTA_ANDROID_GRADLE_HOME_ON_HOST \|\| '([^']+)';/.exec(router), defs.GRADLE_HOME],
  ];
  for (const [name, m, want] of copies) {
    if (!m) {
      out.push(`G11 ${name} 那一行读不到（形状变了）—— 载体默认值失去对账对象，不算成立。`);
    } else if (m[1] !== want) {
      out.push(`G11 ${name} = '${m[1]}' 与 lib 真源 '${want}' 不一致 —— 两枚旋钮只移一个就是"同步解包到 A、gradle 在 B 里构建"。`);
    }
  }
  // 设备侧那两枚（同一台载体机，构建与验收必须落在同一处）
  for (const f of [
    'scripts/verify-android-subscription.sh',
    'scripts/verify-android-vault-storage.sh',
    // 这枚是别线的装置，但它**自己**读同一组 `HEYTA_ANDROID_*` 旋钮去探构建主机 ——
    // 默认值留在旧载体上，探的就是那台只管 MSIX 的机器（2026-10-28 实测就是这样漏的）。
    'research/tools/mutation-rigs/w6-note-restore-device-arm.sh',
  ]) {
    let txt = '';
    try {
      txt = readFileSync(join(baseRoot, f), 'utf8');
    } catch {
      continue; // 脚本被删是另一条判据的事，这里不判"文件在不在"
    }
    const h = /HOST="\$\{(?:ANDROID_HOST|HEYTA_ANDROID_HOST):-([^}]+)\}"/.exec(txt);
    const s = /SDK="\$\{ANDROID_SDK_ON_HOST:-([^}]+)\}"/.exec(txt);
    // 设备侧那两枚写的是 `$HOME/…` 形状（在远端展开），与真源的绝对路径是同一条路径的
    //    两种写法 ⇒ 先把 `$HOME` 按真源自己的家目录展开再逐字比，不比"看起来像不像"。
    const home = `/${defs.BUILD_ROOT.split('/').filter(Boolean).slice(0, 2).join('/')}`;
    const norm = (v) => (v.startsWith('$HOME/') ? `${v.replace('$HOME', home)}` : v);
    if (h && h[1] !== defs.HOST) out.push(`G11 ${f} 的构建主机默认 '${h[1]}' ≠ 载体真源 '${defs.HOST}' —— 构建与验收会落在两台机器上。`);
    if (s && norm(s[1]) !== defs.SDK_ON_HOST) out.push(`G11 ${f} 的 ANDROID_SDK_ON_HOST 默认 '${s[1]}'（展开=${norm(s[1])}）≠ 载体真源 '${defs.SDK_ON_HOST}'。`);
  }
  // 旧载体不许漂回收口点的代码行
  for (const line of router.split('\n')) {
    if (isCommentLine(line)) continue;
    if (/\bwindows-pc\b|C:\\+src\\+heyta/.test(line)) {
      out.push(
        'G11 收口点的**代码行**里还留着旧载体（windows-pc / C:\\src\\heyta）：' +
          JSON.stringify(line.trim().slice(0, 90)) +
          '\n      2026-10-28 起 Android 载体是 linux-dev；旧载体只归 Windows 桌面壳（MSIX）那条腿。',
      );
      break;
    }
  }
  if (out.length === 0) {
    readings.push(`G11 载体默认值单源（host=${defs.HOST}，root=${defs.BUILD_ROOT}，SDK/GradleHome 抄件逐枚相同；代码行无旧载体残留）`);
  }
  return out;
}

/* ── G12：载体机自己跑时的本机分支 —— 在位、窄、与远程同形 ─────────────────
 * 2026-10-28 换载体之后新出现的一格：载体是 Linux，而"macOS/Linux ⇒ ssh 远端"这条分流
 * 会让 `linux-dev` 上的一条任务 ssh 到**它自己**。Windows 那一支当初挡的就是这个形状，
 * 只是换机器之后它够不着了。三条腿各钉一件事：
 *   1. 分支在位，且判据是**主机名逐字相等**（不是"远程失败后改本机"——那是 G5 禁的静默降级）；
 *   2. 走到这一支时**大声印出来**（"这个包是载体本机打的"必须能从输出里读出来）；
 *   3. 与远程分支**同形**：同一枚 `--no-build-cache`、同一份镜像 init、同一套 env。
 *      少了第 3 条，两条路会打出不同的 APK，而"产物来自哪条路"重新变成猜的。 */
function checkCarrierLocalBranch(baseRoot) {
  const out = [];
  let router = '';
  try {
    router = readFileSync(join(baseRoot, 'scripts/run-gradle.mjs'), 'utf8');
  } catch {
    return ['G12 读不到 scripts/run-gradle.mjs —— 载体本机分支这条判据无法求值。'];
  }
  const BRANCH = /const onCarrier = !isWindows && hostname\(\) === CARRIER_HOSTNAME/;
  const BANNER = /本机就是 Android 载体/;
  const SAME_SHAPE = /\['--no-build-cache', `-I\$\{CARRIER_MIRROR_INIT\}`/;
  const SAME_ENV = /ANDROID_HOME: SDK_ON_HOST, ANDROID_SDK_ROOT: SDK_ON_HOST, GRADLE_USER_HOME: GRADLE_HOME_ON_HOST/;
  if (!BRANCH.test(router)) {
    out.push(
      'G12 载体本机分支没了或**变宽**了（要求 `hostname() === CARRIER_HOSTNAME` 这一形）—— ' +
        '变宽等于"任何 Linux 都本机执行"，那台 Mac 之外的机器会静默绕开载体，' +
        '而"远程失败就本机"正是 §6.1 要挡的形状。',
    );
  }
  if (!BANNER.test(router)) {
    out.push('G12 走到载体本机分支时不再大声印出来 —— 读输出的人无法区分"载体打的"与"远程打的"。');
  }
  if (!SAME_SHAPE.test(router)) {
    out.push(
      'G12 载体本机分支不再带 `--no-build-cache` 与 `-I <镜像 init>` —— 与远程分支不同形，' +
        '两条路会打出不同的产物（新鲜度证明与 Maven 出口都跟着变）。',
    );
  }
  if (!SAME_ENV.test(router)) {
    out.push(
      'G12 载体本机分支不再注入 ANDROID_HOME / ANDROID_SDK_ROOT / GRADLE_USER_HOME —— ' +
        '`local.properties` 不入库，缺这三枚时载体会去读一个不存在或不属于它的 SDK 与缓存。',
    );
  }
  if (BRANCH.test(router) && BANNER.test(router) && SAME_SHAPE.test(router) && SAME_ENV.test(router)) {
    readings.push('G12 载体本机分支在位（按主机名匹配 ／ 大声标注 ／ 与远程同形同 env）');
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
    const lib = readFileSync(join(DEFAULT_ROOT, 'scripts/lib/sync-build-sources.sh'), 'utf8');
    const reinstall = readFileSync(join(DEFAULT_ROOT, 'scripts/reinstall-all.sh'), 'utf8');
    const mobilePkg = readFileSync(join(DEFAULT_ROOT, 'apps/mobile/package.json'), 'utf8');
    const rootPkg = readFileSync(join(DEFAULT_ROOT, 'package.json'), 'utf8');
    const baselineA = readFileSync(join(DEFAULT_ROOT, 'scripts/verify-mobile-aed.sh'), 'utf8');
    const wsYaml = readFileSync(join(DEFAULT_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    const deviceA = readFileSync(join(DEFAULT_ROOT, 'scripts/verify-android-subscription.sh'), 'utf8');
    const deviceB = readFileSync(join(DEFAULT_ROOT, 'scripts/verify-android-vault-storage.sh'), 'utf8');
    // 步骤 5 那一行的**当前真实形状**（两臂都以它为起点做单点变异）
    const ISO_MTIME_LINE = '  echo "A$1::MTIME=$(date -u -d @$(stat -c %Y "$2") +%Y-%m-%dT%H:%M:%SZ)";';

    const seed = (tweaks = {}) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      write('scripts/run-gradle.mjs', tweaks.router ?? router);
      write('scripts/lib/sync-build-sources.sh', tweaks.lib ?? lib);
      write('scripts/reinstall-all.sh', tweaks.reinstall ?? reinstall);
      write('scripts/verify-mobile-aed.sh', tweaks.baselineA ?? baselineA);
      write('apps/mobile/package.json', tweaks.mobilePkg ?? mobilePkg);
      write('package.json', tweaks.rootPkg ?? rootPkg);
      write('pnpm-workspace.yaml', tweaks.wsYaml ?? wsYaml);
      // G11 的夹具：载体真源（lib 顶部那四行）与设备侧那两枚抄件都要在位，
      // 否则"读不到文件"会被读成"没有漂"（一条不能失败的判据比没有判据更糟）。
      write('scripts/verify-android-subscription.sh', tweaks.deviceA ?? deviceA);
      write('scripts/verify-android-vault-storage.sh', tweaks.deviceB ?? deviceB);
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
      '[ -d "$R/apps/mobile/node_modules" ]',
      '[ -d "$R/apps/mobile/android/node_modules" ]',
    );
    if (badRouter === router) {
      console.log('   🔴 臂 9 没施上：run-gradle.mjs 里读不到 `[ -d "$R/apps/mobile/node_modules" ]` 那一串 —— 前置形状变了，G7 无从求值');
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
    /* 臂 10 / 10b：G8 的两条腿各摘一边 —— 远端仓库根是**两个旋钮**，
     * 只移一个就变成"同步解包到 A、gradle 在 B 里构建"（§7 第 82 条的远程形态）。
     * 所以调用侧与同步侧各有一臂：摘任一边都必须恰好 1 条红。 */
    seed();
    const noArgRouter = router.replace(
      "sync_android_sources ${HOST} '${REMOTE_ROOT}'",
      'sync_android_sources ${HOST}',
    );
    if (noArgRouter === router) {
      console.log('   🔴 臂 10 没施上：run-gradle.mjs 里找不到"把 REMOTE_ROOT 传给同步"那一串 —— G8 的调用侧无从求值');
      fail = 1;
    } else {
      write('scripts/run-gradle.mjs', noArgRouter);
      msgs = checkRouterInvariants(dir);
      if (countRed(msgs, 'G8 ') === 1) console.log('   ✅ 臂 10 转红：调用侧不传远端根，被 G8 抓到（恰好 1 条）');
      else {
        console.log(`   🔴 臂 10 存活：摘掉传参后 G8 报了 ${countRed(msgs, 'G8 ')} 条（应当恰好 1）`);
        fail = 1;
      }
    }

    /* 臂 10c：只动 dry-run 的**打印**那一支 ⇒ 真调用仍然正确，但计划与实跑不同形。
     * 这条腿的存在理由：dry-run 是本手册推荐的第一动作，它骗人比真跑错还难发现。 */
    seed();
    const badPrint = router.replace(
      "\\n      bash -c 'source scripts/lib/sync-build-sources.sh && sync_android_sources ${HOST} '${REMOTE_ROOT}''",
      "\\n      bash -c 'source scripts/lib/sync-build-sources.sh && sync_android_sources ${HOST}'",
    );
    if (badPrint === router) {
      console.log('   🔴 臂 10c 没施上：读不到 dry-run 打印那一串 —— 这条腿无从求值');
      fail = 1;
    } else {
      write('scripts/run-gradle.mjs', badPrint);
      msgs = checkRouterInvariants(dir);
      if (countRed(msgs, 'G8 ') === 1) console.log('   ✅ 臂 10c 转红：dry-run 打印与真跑不同形，被 G8 抓到（恰好 1 条）');
      else {
        console.log(`   🔴 臂 10c 存活：只改打印后 G8 报了 ${countRed(msgs, 'G8 ')} 条（应当恰好 1）`);
        fail = 1;
      }
    }

    seed();
    const noBindLib = lib.replace(
      'local HEYTA_ANDROID_BUILD_ROOT="${_android_remote_root:-$HEYTA_ANDROID_BUILD_ROOT}"',
      '  # 变异臂 10b：绑定点被摘掉，传进来的根会被静默丢弃',
    );
    if (noBindLib === lib) {
      console.log('   🔴 臂 10b 没施上：同步入口里找不到那行绑定 —— G8 的同步侧无从求值');
      fail = 1;
    } else {
      write('scripts/lib/sync-build-sources.sh', noBindLib);
      msgs = checkRouterInvariants(dir);
      if (countRed(msgs, 'G8 ') === 1) console.log('   ✅ 臂 10b 转红：同步侧不绑定第二枚实参，被 G8 抓到（恰好 1 条）');
      else {
        console.log(`   🔴 臂 10b 存活：摘掉绑定后 G8 报了 ${countRed(msgs, 'G8 ')} 条（应当恰好 1）`);
        fail = 1;
      }
    }
    /* 臂 11 / 11b / 11c：G9 的三条腿，各自摘一边 ⇒ 必须恰好 1 条红。
     * 这三条不是假想的病灶，就是 2026-10-05 那次 18m18s 失败当时的形状（臂 11 = 目录级前置
     * 没有逐包名单；臂 11b = 两个标记挤同一行，marker() 贪婪读坏；臂 11c = 缺"先证明探针跑成了"
     * 的守卫，于是"没数过"被放行成"缺 0 个"）。每条都只动自己那一处，所以期望恰好 1。 */
    const g9Arms = [
      {
        name: '11（名单不是从 package.json 推导）',
        from: 'Object.keys(mobilePkg.dependencies ?? {})',
        to: '["react","react-native"]',
      },
      {
        name: '11b（DEPCHECK/DEPMISS 挤在同一行输出）',
        from: '`echo "DEPCHECK=$CHECKED"`,\n    `echo "DEPMISS=$MISS"`',
        to: '`echo "DEPCHECK=$CHECKED DEPMISS=$MISS"`',
      },
      {
        name: '11c（缺"数不等于名单长度 ⇒ 判探针故障"那一半守卫）',
        from: '!Number.isFinite(depChecked) || depChecked !== declaredDeps.length',
        to: '!Number.isFinite(depChecked)',
      },
    ];
    for (const arm of g9Arms) {
      seed();
      const mutated = router.split(arm.from).join(arm.to);
      if (mutated === router) {
        console.log(`   🔴 臂 ${arm.name} 没施上：run-gradle.mjs 里读不到那一串 —— G9 的这条腿无从求值`);
        fail = 1;
        continue;
      }
      write('scripts/run-gradle.mjs', mutated);
      msgs = checkRouterInvariants(dir);
      if (countRed(msgs, 'G9 ') === 1) console.log(`   ✅ 臂 ${arm.name} 转红：G9 抓到（恰好 1 条）`);
      else {
        console.log(`   🔴 臂 ${arm.name} 存活：G9 报了 ${countRed(msgs, 'G9 ')} 条（应当恰好 1）`);
        fail = 1;
      }
    }

    /* 臂 12 / 12b / 12c / 12d：G10 的四条腿。12 就是 2026-10-05 01:4x 那次真远程构建
     * 当时的形状（BUILD SUCCESSFUL 被报成"产物是 1970 年的"），另外三条是它的三个守卫。 */
    const g10Arms = [
      {
        // 这一个改动**同时**违反两条腿（用了 5.1 没有的方法 + 不再给 ISO-8601），
        // 所以期望是 2 而不是 1 —— 写在这里是为了让下一位不把"两条红"当成判据过严。
        name: '12（远端改回 ToUnixTimeSeconds）',
        from: ISO_MTIME_LINE,
        to: '  echo "A$1::MTIME=$(stat -c %Y "$2")";',
        expect: 2,
      },
      {
        name: '12b（远端不再给 ISO-8601）',
        // ⚠️ 必须是**双引号**字符串：这段 needle 里有 `${i}` / `${p}`，
        //    放进模板字符串会被当插值求值（ReferenceError: i is not defined —— 第一次跑就死在这）。
        from: ISO_MTIME_LINE,
        to: '  echo "A$1::MTIME=$(date -u)";',
      },
      {
        name: '12c（本地不再 Date.parse 那一串）',
        from: 'const mtimeParsed = Date.parse(mtimeRaw);',
        to: "const mtimeParsed = mtimeRaw === '' ? 0 : Number(mtimeRaw);",
      },
      {
        name: '12d（摘掉 mtime 下界守卫）',
        from: '      !Number.isFinite(mtime) ||\n      mtime < MTIME_FLOOR',
        to: '      !Number.isFinite(mtime)',
      },
    ];
    for (const arm of g10Arms) {
      seed();
      const mutated = router.split(arm.from).join(arm.to);
      if (mutated === router) {
        console.log(`   🔴 臂 ${arm.name} 没施上：run-gradle.mjs 里读不到那一串 —— G10 的这条腿无从求值`);
        fail = 1;
        continue;
      }
      write('scripts/run-gradle.mjs', mutated);
      msgs = checkRouterInvariants(dir);
      const want = arm.expect ?? 1;
      if (countRed(msgs, 'G10 ') === want) console.log(`   ✅ 臂 ${arm.name} 转红：G10 抓到（恰好 ${want} 条）`);
      else {
        console.log(`   🔴 臂 ${arm.name} 存活：G10 报了 ${countRed(msgs, 'G10 ')} 条（应当恰好 ${want}）`);
        fail = 1;
      }
    }

    /* 臂 13 / 13b / 13c：G1 的「取证记录豁免」三条腿（一条正照、两条反向）。
     * 施加理由是真树现状，不是假想：G1 曾把 4 行**已提交的 evidence 清单**——它们只是把
     * `apps/mobile/android/gradlew` 当条目登记了路径与 sha256——报成"直接调用 gradlew"，
     * 于是这扇门恒红且给出的修法（删掉取证记录）根本不该做。
     *   13 = 记录不红；
     *   13b = 同一行在非 evidence 的 `.json` 里照红 ⇒ 豁免不是"整个 .json 放行"
     *          （`apps/mobile/package.json` 的 android 脚本正是靠 `.json` 进扫描面的，臂 4）；
     *   13c = 同一行放进 evidence/ 下的 `.sh` 里照红 ⇒ 豁免不是"整个目录放行"
     *          （跑设备验收的腿脚本住的正是 evidence/，它真的会把进程交出去）。 */
    const recordLine = '{\n  "path": "apps/mobile/android/gradlew",\n  "sha256": "3238afb2"\n}\n';
    seed();
    write('apps/mobile/evidence/ux-final-20261008/android-candidate/source-inputs.json', recordLine);
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G1 ') === 0) console.log('   ✅ 臂 13 正照：evidence 清单里的 gradlew 记录不判红（记录 ≠ 入口）');
    else {
      console.log(`   🔴 臂 13 坏了：取证记录被判成红（${countRed(msgs, 'G1 ')} 条）—— 记录豁免没生效`);
      fail = 1;
    }

    seed();
    write('apps/desktop/evidence-x/manifest.json', recordLine);
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G1 ') === 1) console.log('   ✅ 臂 13b 转红：同一行落在非 evidence 的 .json 里照红（恰好 1 条）');
    else {
      console.log(`   🔴 臂 13b 存活：非 evidence 的 .json 只报了 ${countRed(msgs, 'G1 ')} 条（应当恰好 1）—— 豁免宽到了整个 .json`);
      fail = 1;
    }

    seed();
    write('apps/mobile/evidence/ux-final-20261008/run-leg.sh', '#!/bin/bash\ncd apps/mobile/android && ./gradlew assembleRelease\n');
    msgs = checkGradlewSites(dir);
    if (countRed(msgs, 'G1 ') === 1) console.log('   ✅ 臂 13c 转红：evidence 目录下的可执行脚本照红（恰好 1 条，不吞整个目录）');
    else {
      console.log(`   🔴 臂 13c 存活：evidence 下真跑 gradlew 的 .sh 只报了 ${countRed(msgs, 'G1 ')} 条（应当恰好 1）—— 豁免按目录放行了`);
      fail = 1;
    }

    /* 臂 15 / 15b / 15c / 15d：G11（载体默认值单源 + 不许漂回旧载体）的四条腿。
     * 施加理由不是假想：换载体这一次本身就同时动了**五处**默认值（lib 真源、收口点四枚
     * 抄件、设备侧两枚 `*_ON_HOST`）。少动一处不会报错，只会安静地"构建在 A 树、验收取 B 产物"
     * —— 那正是 §7 第 82 条的形状，只是搬到了两台机器之间。 */
    const g11Arms = [
      {
        name: '15（lib 真源漂回旧载体）',
        file: 'scripts/lib/sync-build-sources.sh',
        src: () => lib,
        from: 'HEYTA_ANDROID_HOST="${HEYTA_ANDROID_HOST:-linux-dev}"',
        to: 'HEYTA_ANDROID_HOST="${HEYTA_ANDROID_HOST:-windows-pc}"',
        // 一条红给"收口点的抄件与真源不一致"，另一条给"设备侧的 ANDROID_HOST 与真源不一致"
        // —— 动真源就是会同时打中两枚抄件，这是**两条独立判据**，不是同一条报两遍。
        expect: 2,
      },
      {
        name: '15b（收口点的构建根漂了，真源没漂）',
        file: 'scripts/run-gradle.mjs',
        src: () => router,
        from: "const REMOTE_ROOT = process.env.HEYTA_ANDROID_REMOTE_ROOT || '/home/xaiver/heyta-android-build';",
        to: "const REMOTE_ROOT = process.env.HEYTA_ANDROID_REMOTE_ROOT || '/home/xaiver/heyta-carrier';",
      },
      {
        name: '15c（设备侧的 ANDROID_HOST 与载体脱钩）',
        file: 'scripts/verify-android-subscription.sh',
        src: () => deviceA,
        from: 'HOST="${ANDROID_HOST:-linux-dev}"',
        to: 'HOST="${ANDROID_HOST:-windows-pc}"',
      },
      {
        name: '15d（收口点代码行里出现旧载体）',
        file: 'scripts/run-gradle.mjs',
        src: () => router,
        from: "const ARTIFACTS = deriveArtifacts(gradleArgs);",
        to: "const ARTIFACTS = deriveArtifacts(gradleArgs);\nconst legacyHost = 'windows-pc';",
      },
    ];
    for (const arm of g11Arms) {
      seed();
      const base = arm.src();
      const mutated = base.replace(arm.from, arm.to);
      if (mutated === base) {
        console.log(`   🔴 臂 ${arm.name} 没施上：${arm.file} 里读不到那一串 —— G11 的这条腿无从求值`);
        fail = 1;
        continue;
      }
      write(arm.file, mutated);
      msgs = checkCarrierDefaults(dir);
      const want = arm.expect ?? 1;
      if (countRed(msgs, 'G11 ') === want) console.log(`   ✅ 臂 ${arm.name} 转红：G11 抓到（恰好 ${want} 条）`);
      else {
        console.log(`   🔴 臂 ${arm.name} 存活：G11 报了 ${countRed(msgs, 'G11 ')} 条（应当恰好 ${want}）\n      ${msgs.join(' | ').slice(0, 220)}`);
        fail = 1;
      }
    }

/* 臂 16 / 16b / 16c / 16d：G12 的四条腿（每条只动一处 ⇒ 恰好 1 条红）。
     * 16 是**最坏的那一种**：把主机名判据改成恒真，等于任何 Linux 都本机执行。 */
    const g12Arms = [
      { name: '16（主机名判据改成恒真）', from: 'const onCarrier = !isWindows && hostname() === CARRIER_HOSTNAME;', to: 'const onCarrier = !isWindows;' },
      { name: '16b（摘掉本机分支的大声标注）', from: "'║ 本机就是 Android 载体 —— 直接在本机构建，不发 ssh。',", to: "'║',", },
      { name: '16c（本机分支不再带 --no-build-cache 与 -I）', from: "const localArgs = carrier ? ['--no-build-cache', `-I${CARRIER_MIRROR_INIT}`, ...gradleArgs] : gradleArgs;", to: 'const localArgs = gradleArgs;' },
      { name: '16d（本机分支不再注入 SDK 与私有 Gradle 目录）', from: '      env: carrier\n      ? { ...process.env, ANDROID_HOME: SDK_ON_HOST, ANDROID_SDK_ROOT: SDK_ON_HOST, GRADLE_USER_HOME: GRADLE_HOME_ON_HOST }\n      : process.env,', to: '' },
    ];
    for (const arm of g12Arms) {
      seed();
      const mutated = router.split(arm.from).join(arm.to);
      if (mutated === router) {
        console.log(`   🔴 臂 ${arm.name} 没施上：run-gradle.mjs 里读不到那一串 —— G12 的这条腿无从求值`);
        fail = 1;
        continue;
      }
      write('scripts/run-gradle.mjs', mutated);
      msgs = checkCarrierLocalBranch(dir);
      if (countRed(msgs, 'G12 ') === 1) console.log(`   ✅ 臂 ${arm.name} 转红：G12 抓到（恰好 1 条）`);
      else {
        console.log(`   🔴 臂 ${arm.name} 存活：G12 报了 ${countRed(msgs, 'G12 ')} 条（应当恰好 1）\n      ${msgs.join(' | ').slice(0, 200)}`);
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
  ...checkCarrierDefaults(root),
  ...checkCarrierLocalBranch(root),
]) {
  failures.push(f);
}

console.log('Android 构建入口对账（静态，不联网、不构建）：');
for (const r of readings) console.log(`   · ${r}`);

if (failures.length > 0) {
  for (const f of failures) console.error(`🔴 ${f}`);
  console.error(`\n共 ${failures.length} 处。规则本体：Android 任务一律走远程构建载体（2026-10-28 起 = linux-dev）。`);
  console.error('手册：docs/runbooks/android-build-on-linux-dev.md');
  process.exit(1);
}
console.log('✅ Android 构建只从 run-gradle.mjs 那一枚收口点出去（含存量基线逐条仍在、路径对账成立）');
