#!/usr/bin/env node
/**
 * Android Gradle 的**唯一收口点**：按平台把任务分流到正确的机器上执行
 * ================================================================
 *
 * 为什么需要它（第一层，2026-09 的原由，仍然有效）
 * ------------------------------------------------
 * `apps/mobile` 的 Android 脚本原本写的是
 * `cd android && ./gradlew assembleDebug`。这在 macOS / Linux 上没问题，
 * 在 Windows 上**必然失败**——cmd 里没有 `./gradlew` 这个可执行文件，
 * 只有 `gradlew.bat`（无扩展名的 `gradlew` 是给 sh 用的）。
 * 实测报错：
 *
 *     '.' 不是内部或外部命令，也不是可运行的程序或批处理文件。
 *
 * 而 pnpm 在 Windows 上是用 cmd 执行 script 的，所以这不是"换个写法"能绕过去的：
 *   `./gradlew`  → POSIX 行，cmd 不行
 *   `gradlew`    → cmd 靠 PATHEXT 找到 `gradlew.bat`，POSIX 不行（当前目录不在 PATH）
 *   `sh gradlew` → Windows 没有 sh
 *
 * 三种写法各挂一边，所以只能由 Node 来判断平台。额外好处：Gradle 的退出码
 * 原样透传，`pnpm build:android` 的成败不会再被 shell 吃掉。
 *
 * 为什么需要它（第二层，2026-10-04 的新规则）
 * ------------------------------------------------
 * **Android 构建不再在这台 Mac/Linux 上跑。** 起因是实测：headless Android 模拟器
 * 常驻 3.6G 内存 + 90% CPU，而 SDK/AVD/Gradle 缓存吃掉约 20G 磁盘。产品负责人拍板：
 *
 *     之后 Android 任务一律 ssh windows-pc，不要再在 Mac 起新的 Gradle 构建或模拟器。
 *
 * 落点选在这里，是因为**所有 Android 构建入口本来就汇成一枚收口点**：
 *
 *     根 package.json 的 build:android{,:debug,:bundle} / clean:android
 *       → pnpm --filter @heyta/mobile run …
 *         → apps/mobile/package.json 里逐字都是 `node ../../scripts/run-gradle.mjs <task>`
 *
 * ⇒ 路由只需要改这一个文件，`pnpm build:android` 与各验收脚本的形状**一个字都不用改**。
 * 完整手册：[docs/runbooks/android-build-on-windows.md](../docs/runbooks/android-build-on-windows.md)
 *
 * 现在的分流：
 *
 *   | 平台 | 行为 |
 *   |---|---|
 *   | **Windows**（`win32`） | **逐字不变**：本机 `gradlew.bat <task>`。这一条是**承重的**： |
 *   | | windows-pc 上跑的还是这些 pnpm 脚本，它必须落在本机执行分支， |
 *   | | 否则"远程构建"会在远端再发起一次"远程构建"——**递归** |
 *   | macOS / Linux | 同步当前工作树 → `ssh` 远端跑同一个 gradle 任务 → 把产物 scp 回 |
 *   | | **本地消费者原本期望的那个路径**（见"产物落回原路径"那一节） |
 *
 * 🔴 拒绝静默降级：ssh 不通 / 同步对账不上 / 产物拉不回来 / 产物身份对不上，
 * 一律**响亮失败并点名是哪一步**。**绝对没有"远程不行就本机构建"这条路** ——
 * 那正是这条规则要挡的动作（一台悄悄在 Mac 上构建的机器会让"产物来自哪一批源码"
 * 重新变成猜的）。唯一的逃生门是显式的 `HEYTA_ANDROID_LOCAL_GRADLE=1`，
 * 而且它会把"这是本机执行"大字印进输出，不留一条可以误读的绿。
 *
 * 用法：
 *   node ../../scripts/run-gradle.mjs assembleDebug          # 按平台分流
 *   node ../../scripts/run-gradle.mjs assembleRelease --dry-run  # 只打印计划，一个字节都不写
 *
 * 环境变量（都有默认值，默认值就是规则要求的那套）：
 *   HEYTA_ANDROID_HOST          远程构建主机，默认 `windows-pc`
 *   HEYTA_ANDROID_REMOTE_ROOT   远端仓库根，默认 `C:\src\heyta`
 *   HEYTA_ANDROID_LOCAL_GRADLE  =1 时**显式**在本机跑 gradle（例外，不是兜底）
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const androidDir = join(repoRoot, 'apps', 'mobile', 'android');

const isWindows = process.platform === 'win32';
// Windows 上必须显式走 `gradlew.bat`，且 Node 18+ 出于安全考虑要求
// 用 shell 才能启动 .bat/.cmd。
const command = isWindows ? 'gradlew.bat' : './gradlew';

/* ── 参数解析 ─────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run') || argv.includes('--print-plan');
const gradleArgs = argv.filter((a) => a !== '--dry-run' && a !== '--print-plan');

/* ── 远程模式的旋钮 ───────────────────────────────────────────────────── */

const HOST = process.env.HEYTA_ANDROID_HOST || 'windows-pc';
const REMOTE_ROOT = process.env.HEYTA_ANDROID_REMOTE_ROOT || 'C:\\src\\heyta';
const REMOTE_ANDROID_WIN = `${REMOTE_ROOT}\\apps\\mobile\\android`;
/** scp 走 SFTP，路径用正斜杠；远端 cmd/tar 用反斜杠。两种形状各有归属。 */
const REMOTE_ANDROID_SCP = REMOTE_ANDROID_WIN.replace(/\\/g, '/');

/* ── 产物路径推导（不写死一张表）────────────────────────────────────── */

/**
 * 从 gradle 任务名**推导**要回传的产物，而不是抄一张对照表 ——
 * 表会从第一个新变体开始漂（AGENTS §3.5 那条"同一个判断抄两遍"的教训）。
 *
 *   assemble<Variant> → apps/mobile/android/app/build/outputs/apk/<variant>/app-<variant>.apk
 *   bundle<Variant>   → apps/mobile/android/app/build/outputs/bundle/<variant>/app-<variant>.aab
 *
 * ⚠️ 已知的**一处例外**：`:app:assembleDebugAndroidTest` 的实际形状是
 * `outputs/apk/androidTest/debug/app-debug-androidTest.apk`（目录与文件名都不按
 * 上面那条规则）。这一条例外是**写死的**，因为它由 AGP 决定、不由我们决定；
 * 落到推导之外的情形一律**判红并点名**，不静默少回传。
 *
 * 🔴 导出给 `scripts/check-android-gradle-remote.mjs` 对账用：回传的**默认变体路径**
 * 必须逐字等于 `scripts/reinstall-all.sh` 的 android 段里 `$APK` 读的那个路径 ——
 * 两边不一致的话，"APK 必须比源码新"那条判据（§7 第 27 条的常驻防线）会被打空。
 */
export function deriveArtifacts(tasks) {
  const out = [];
  for (const raw of tasks) {
    const m = /^(?::?[\w.-]+:)*(assemble|bundle)([A-Z]\w*)$/.exec(raw);
    if (!m) continue; // 选项（`-I x`、`--no-daemon`）与它的值都不会命中这个形状
    const kind = m[1];
    const variant = m[2].charAt(0).toLowerCase() + m[2].slice(1);
    if (variant === 'debugAndroidTest') {
      out.push('apps/mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
      continue;
    }
    const dir = kind === 'assemble' ? 'apk' : 'bundle';
    const ext = kind === 'assemble' ? 'apk' : 'aab';
    out.push(`apps/mobile/android/app/build/outputs/${dir}/${variant}/app-${variant}.${ext}`);
  }
  return [...new Set(out)];
}

const ARTIFACTS = deriveArtifacts(gradleArgs);

/** 仓库相对产物路径 → 远端那棵树里的路径（正斜杠，scp 与 PowerShell 都吃这一形状）。 */
/**
 * "这个 mtime 可能是真的吗"的下界。
 *
 * 不是业务判据，是**探针自检**：早于它的值只可能来自"那一行没输出被读成 0"，
 * 因为仓库与工具链都不存在那个年代。
 */
const MTIME_FLOOR = Date.parse('2020-01-01T00:00:00Z') / 1000;

function remotePathOf(rel) {
  return `${REMOTE_ANDROID_SCP}/${rel.replace('apps/mobile/android/', '')}`;
}

/* ── 执行装置：dry-run 下**一个字节都不写** ────────────────────────────── */

function planLine(bin, args) {
  return `      ${bin} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
}

/** 直连终端（gradle 的实时输出要走这里）。 */
function runLogged(bin, args, opts = {}) {
  if (DRY) {
    console.log(`   [dry-run] 将执行（**未执行**）：\n${planLine(bin, args)}`);
    return { status: 0, skipped: true };
  }
  const r = spawnSync(bin, args, {
    cwd: opts.cwd ?? repoRoot,
    stdio: 'inherit',
    shell: opts.shell === true,
  });
  if (r.error) {
    console.error(`   🔴 启动 ${bin} 失败：${r.error.message}`);
    return { status: 1, error: r.error };
  }
  return { status: r.status ?? 1 };
}

/** 要读输出的执行（哈希、大小、标记行）。 */
function runCapture(bin, args, opts = {}) {
  // 🔴 `readOnly` 的探测**在 dry-run 里也照跑**。dry-run 的承诺是"不发网络写操作、不写本地文件"，
  //    而步骤 1 那枚 ssh 探测只读文件系统的存在性，不碰这一条边界。
  //    跟着 DRY 一起跳过的代价是实测出来的（01:33 那趟）：打印出来的是
  //    `RNDEPS=（无） … DEPCHECK=（无）`，也就是说"远端 PowerShell 不接受这条命令"
  //    和"远端缺哪几枚包"这两类**只能等 18 分钟后由 Metro 暴露** —— 预检就白做了。
  if (DRY && !opts.readOnly) {
    console.log(`   [dry-run] 将执行并读取输出（**未执行**）：\n${planLine(bin, args)}`);
    return { status: 0, stdout: '', skipped: true };
  }
  if (DRY) console.log(`   [dry-run] 只读探测**照跑**（它不写任何东西）：\n${planLine(bin, args)}`);
  const r = spawnSync(bin, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: opts.shell === true,
  });
  if (r.error) return { status: 1, stdout: '', error: r.error };
  return { status: r.status ?? 1, stdout: `${r.stdout ?? ''}`, stderr: `${r.stderr ?? ''}` };
}

function die(step, detail, extra) {
  console.error(`\n🔴 run-gradle（远程模式）在**${step}**这一步失败。`);
  if (detail) console.error(`   ${detail}`);
  if (extra) console.error(extra);
  console.error(
    '\n   ⚠️ 这一条**不会**自动退回本机执行 —— 规则要求 Android 构建在远程主机上跑，' +
      '\n      而"远程不行就本机"正是它要挡的形状。' +
      '\n      确实要在本机跑（例如远程主机在重装）才显式加：HEYTA_ANDROID_LOCAL_GRADLE=1',
  );
  process.exit(1);
}

/* ── 本机分支（Windows 常态 / POSIX 的显式例外）────────────────────────── */

function runLocal(why) {
  if (DRY) {
    console.log(`本机执行 gradle（${why}）—— 计划：`);
    console.log(`   [dry-run] 将执行（**未执行**）：\n      ${command} ${gradleArgs.join(' ')}   （cwd=apps/mobile/android）`);
    return 0;
  }
  const result = spawnSync(command, gradleArgs, {
    cwd: androidDir,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (result.error) {
    console.error(`run-gradle: 无法启动 ${command}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

/* ── 远程分支 ─────────────────────────────────────────────────────────── */

function runRemote() {
  console.log(
    [
      '',
      '═══ Android 构建走远程主机（AGENTS §6.1 的规则）════════════════════',
      `   构建主机   = ${HOST}`,
      `   远端仓库根 = ${REMOTE_ROOT}`,
      `   gradle 任务= ${gradleArgs.join(' ')}`,
      `   回传产物   = ${ARTIFACTS.length === 0 ? '（这个任务不产出 APK/AAB，见步骤 5 的判据）' : ARTIFACTS.join('\n                  ')}`,
      DRY ? '   模式       = **dry-run：只打印计划，不发任何网络写操作、不写本地文件**' : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  /* 步骤 0：本机前置 —— 各 workspace 包的 dist 目录必须存在 */
  // Metro 打进 APK 的是**各 workspace 包的 dist**，不是 `packages/*/src`
  // （AGENTS §6.1「打包前必须先跑 `pnpm -r build`」的全部理由；§7 第 27 条那笔学费）。
  // 需要哪些**从 apps/mobile/package.json 的依赖推导**，不抄清单。
  console.log('  步骤 0：本机构建输入前置（packages/*/dist 必须已经生成）');
  const mobilePkg = JSON.parse(readFileSync(join(repoRoot, 'apps', 'mobile', 'package.json'), 'utf8'));
  const workspaceDeps = Object.keys(mobilePkg.dependencies ?? {}).filter((n) => n.startsWith('@heyta/'));
  const missingDist = [];
  for (const dep of workspaceDeps) {
    const dir = join(repoRoot, 'packages', dep.split('/')[1] ?? dep, 'dist');
    if (!existsSync(dir)) missingDist.push(`${dep} → ${dir}`);
  }
  if (missingDist.length > 0) {
    die(
      '步骤 0（本机构建输入）',
      `这些 @heyta/* 包没有 dist：\n      ${missingDist.join('\n      ')}`,
      '   先跑 `pnpm -r build`（AGENTS §6.1：APK 里打的是 packages/*/dist）。',
    );
  }
  console.log(`  ✅ ${workspaceDeps.length} 个 workspace 依赖的 dist 都在（清单从 apps/mobile/package.json 推导）`);

  /* 步骤 1：远端可达性与工具链前置（只读）*/
  console.log('  步骤 1：远端可达性 / 依赖 / local.properties 前置（只读探测）');
  // 🔴 整条 PowerShell 命令**只用一对**外层双引号、里面全是单引号：cmd 会把内层的
  //    `"; "` 形状当成参数边界，实测会把命令拆坏。
  const localProps = `${REMOTE_ANDROID_WIN}\\local.properties`;
  // 🔴 RNDEPS 量的是 `apps/mobile/node_modules`，**不是** `apps/mobile/android/node_modules`。
  //    这不是笔误修正，是一条"永不开的门"：pnpm-workspace.yaml 的 packages 是
  //    `packages/*` / `apps/*` / `server` ⇒ `apps/mobile/android` 不是工作区包，
  //    `pnpm install` **永远不会**在那儿建 node_modules。实测本机：
  //    `apps/mobile/node_modules` 存在、`apps/mobile/android/node_modules` 不存在，
  //    而 Mac 上 APK 打得出来 —— 说明这条路径从来就不是构建输入。
  //    原来按它判 ⇒ 远程构建会**恒定**红在步骤 1，而给出的修法（远端 pnpm install）做完也还是红。
  // 🔴 但"目录在"离"构建输入齐"还差一层，而 2026-10-05 第一次真远程构建就是死在这一层的缺失上：
  //    远端 `apps/mobile/node_modules` 存在（RNDEPS=True），Metro 却在 18 分钟后报
  //    `Unable to resolve module @react-native-documents/picker`（`ProfileScreen.tsx:50`）。
  //    逐包探测现量：`CHECKED=19 APP=17 ROOT=0 MISSING=2` ⇒ 缺
  //    `@react-native-documents/picker` 与 `@heyta/widget-core`，而这两个**本机都装好了**
  //    （`apps/mobile/package.json:31` 声明、本机 `apps/mobile/node_modules` 里有）
  //    ⇒ 这是**环境**（远端那次 install 早于这两笔新增；同步只送源码与 `packages/*/dist`，
  //    永不送 node_modules，因为它被 gitignore）。目录级判据对此**零分辨力**。
  //    ⇒ 现在按**声明面推导**逐包判：名单取自 `apps/mobile/package.json` 的 dependencies，
  //      两个位置（包自己的 / 根的）任一存在即算解析到 —— 后者是防"哪天 hoisting 变了"把这里
  //      变成一条永不开的门（上面那条学费的同族）。
  const declaredDeps = Object.keys(mobilePkg.dependencies ?? {});
  const unsafeNames = declaredDeps.filter((n) => !/^[@A-Za-z0-9._/-]+$/.test(n));
  if (unsafeNames.length > 0) {
    die(
      '步骤 1（依赖名单）',
      `这些依赖名含路径分隔符以外的字符，不放进远端命令：${unsafeNames.join(', ')}`,
      '   这是探针的安全边界，不是构建输入的问题 —— 改这里之前先想清楚为什么要用那种名字。',
    );
  }
  const depArray = declaredDeps.map((n) => `'${n}'`).join(',');
  const preCmd =
    `powershell -NoProfile -Command "Write-Output ('RNDEPS=' + (Test-Path '${REMOTE_ROOT}\\apps\\mobile\\node_modules')); ` +
    `Write-Output ('ROOTDEPS=' + (Test-Path '${REMOTE_ROOT}\\node_modules\\.pnpm')); ` +
    `if (Test-Path '${localProps}') { if ((Get-Content -Raw '${localProps}') -match '/Users/|/opt/homebrew') ` +
    `{ Write-Output 'LOCALPROPS=MAC-PATH' } else { Write-Output 'LOCALPROPS=ok' } } ` +
    `else { Write-Output 'LOCALPROPS=absent' }; ` +
    `$n=@(${depArray}); $m=@(); foreach($x in $n){ $p='${REMOTE_ROOT}\\apps\\mobile\\node_modules\\'+$x.Replace('/','\\'); $q='${REMOTE_ROOT}\\node_modules\\'+$x.Replace('/','\\'); if(Test-Path -LiteralPath $p){} elseif(Test-Path -LiteralPath $q){} else {$m+=$x} }; ` +
    `Write-Output ('DEPCHECK=' + $n.Count); Write-Output ('DEPMISS=' + $m.Count); foreach($x in $m){ Write-Output ('DEPMISS-'+$x) }"`;
  const preflight = runCapture('ssh', ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', HOST, preCmd], {
    readOnly: true,
  });
  const pre = preflight.stdout ?? '';
  const marker = (name) => {
    const m = new RegExp(`${name}=([^\\r\\n]*)`).exec(pre);
    return m ? m[1].trim() : '';
  };
  if (DRY) {
    // 🔴 dry-run 也照实**打印探测读数**（探测本来就是只读的，且它就是给预检用的）。
    //    上一版这里写的是"探测结果读不到"，后果是：那条探测字符串本身坏了 / 远端 PowerShell
    //    语法不接受 —— 这些只能等真构建跑到 18 分钟后由 Metro 暴露。预检的意义就没了。
    console.log(
      `   [dry-run] 探测读数：RNDEPS=${marker('RNDEPS') || '（无）'} ROOTDEPS=${marker('ROOTDEPS') || '（无）'} ` +
        `LOCALPROPS=${marker('LOCALPROPS') || '（无）'} DEPCHECK=${marker('DEPCHECK') || '（无）'} ` +
        `DEPMISS=${marker('DEPMISS') || '（无）'}`,
    );
  } else {
    if (preflight.status !== 0 || pre.trim() === '') {
      die(
        '步骤 1（ssh 可达性）',
        `ssh ${HOST} 探测失败（退出码 ${preflight.status}）。`,
        `   stderr：${(preflight.stderr ?? '').trim() || '（空）'}\n   ⚠️ 主机不可达属于**环境**，如实报告 —— 不要改成本机跑。`,
      );
    }
    const rnDeps = marker('RNDEPS');
    const rootDeps = marker('ROOTDEPS');
    if (rnDeps !== 'True' || rootDeps !== 'True') {
      die(
        '步骤 1（远端依赖）',
        `远端 node_modules 不在位（apps/mobile=${rnDeps || '?'}，根 .pnpm=${rootDeps || '?'}）。`,
        `   修它：ssh ${HOST} "cd /d ${REMOTE_ROOT} && pnpm install"` +
          '\n   （工具链没装则见 scripts/windows/setup-build-host.ps1，手册 §4）',
      );
    }
    // 🔴 逐包判定：**先证明探针自己跑成了**，再证明"缺 0 个"。
    //    缺前一半的话，"DEPMISS 行不在"会被读成"没缺"—— 那正是本次要修的那个形状
    //    （目录在 ⇒ ✅，而真正缺的两枚包从未被问起）。
    const depChecked = Number(marker('DEPCHECK'));
    const depMissCount = Number(marker('DEPMISS'));
    if (!Number.isFinite(depChecked) || depChecked !== declaredDeps.length) {
      die(
        '步骤 1（远端依赖逐包探测没跑成）',
        `探针该数出 ${declaredDeps.length} 个声明依赖，实际读到 DEPCHECK=[${marker('DEPCHECK') || '（无此行）'}]。`,
        '   ⇒ 这是**探针故障**，不是"依赖齐"。不要放行；先看远端 PowerShell 的报错（同一份 stdout 里 RNDEPS 行有没有）。',
      );
    }
    if (!Number.isFinite(depMissCount)) {
      die(
        '步骤 1（远端依赖逐包探测没跑成）',
        `DEPCHECK 有读数（${depChecked}）但 DEPMISS 读不到 ⇒ 探测中途断了。`,
        '   同样按**探针故障**处理，不按"缺 0 个"放行。',
      );
    }
    if (depMissCount > 0) {
      const missList = [...pre.matchAll(/^DEPMISS-(\S+)/gm)].map((x) => x[1]);
      die(
        '步骤 1（远端声明依赖缺失）',
        `远端解析不到 ${depMissCount}/${depChecked} 个 apps/mobile 声明依赖：\n      ${missList.join('\n      ')}`,
        `   这是**环境**，不是产品：本机这两个都装好了，而同步**永不送 node_modules**（被 gitignore）。\n` +
          `   修它：ssh ${HOST} "cd /d ${REMOTE_ROOT} && pnpm install --frozen-lockfile"` +
          '\n   ⚠️ 不要改成本机跑（AGENTS §6.1），也不要因为"目录在"就摘掉这一格 —— 上一次就是那样红了 18 分钟。',
      );
    }
    // local.properties 被 gitignore ⇒ **同步永远不会覆盖它**。
    // 远端若留着一条 Mac 的 sdk.dir，症状是 gradle 报一句和平台无关的 SDK 找不到 ——
    // 先在这里点名，别让它变成一次神秘的构建失败。
    if (marker('LOCALPROPS') === 'MAC-PATH') {
      die(
        '步骤 1（远端 local.properties）',
        `远端 ${REMOTE_ANDROID_WIN}\\local.properties 里是一条 Mac 的 sdk.dir（/Users/… 或 /opt/homebrew/…）。`,
        '   它不入库，所以源码同步不会改掉它。删掉那一行（远端有 ANDROID_HOME，gradle 会用环境变量），' +
          '\n   或把它改成远端真实的 SDK 路径。',
      );
    }
    console.log(
      `  ✅ 远端依赖在位（声明的 ${depChecked} 个逐包解析得到）；local.properties=${marker('LOCALPROPS') || '（探测无读数）'}`,
    );
  }

  /* 步骤 2：同步当前工作树（复用 MSIX 那一腿的同一枚同步机制）*/
  console.log('  步骤 2：同步当前工作树 + packages/*/dist → 远端（tar sha256 对账）');
  // 🔴 复用 `scripts/lib/sync-windows-sources.sh`，不在这里再写一份 tar/scp：
  //    同一个事实抄两遍一定会漂（AGENTS §3.5 与 §7 第 82/174 条都是这笔学费）。
  //    这条同步送的是**当前工作树**（含未提交改动）+ 被 gitignore 的构建输入。
  // 对**瞬时网络**有限重试，对**确定性判断**（对账不上）不重试 ——
  // 后者重试只会把一条明确的红拖成三倍时长，还会让人以为它不稳定。
  let syncOk = false;
  for (let attempt = 1; attempt <= 3 && !syncOk; attempt += 1) {
    const sync = DRY
      ? { status: 0, stdout: '', stderr: '' }
      : runCapture('bash', [
          '-c',
          `source scripts/lib/sync-windows-sources.sh && sync_windows_sources_for_android ${HOST} '${REMOTE_ROOT}'`,
        ]);
    if (DRY) {
      console.log(
        `   [dry-run] 将执行（**未执行**）：\n      bash -c 'source scripts/lib/sync-windows-sources.sh && sync_windows_sources_for_android ${HOST} '${REMOTE_ROOT}''`,
      );
      break;
    }
    const out = `${sync.stdout ?? ''}${sync.stderr ?? ''}`;
    process.stdout.write(out);
    if (sync.status === 0) {
      syncOk = true;
      break;
    }
    if (/对不上|不新鲜|拒绝|不存在/.test(out)) {
      die(
        '步骤 2（源码同步对账）',
        '远端字节与本地工作树**对不上** —— 确定性判断，不重试。',
        '   拒绝在"上一批的树"上构建（§7 第 82 条那次就是这么骗过验收的）。',
      );
    }
    if (attempt < 3) console.log(`  ⚠️ 第 ${attempt} 次同步失败 —— 按**瞬时网络**重试（远端会掉线）`);
  }
  if (!DRY && !syncOk) {
    die('步骤 2（源码同步）', `同步没成功（主机 ${HOST}）。`, '   ⚠️ 不在旧树上构建，也不退回本机 —— 先让远端可达。');
  }

  /* 步骤 3：清远端旧产物，并用**远端自己的时钟**记本次构建的起点 */
  // 🔴 起点必须取**远端时钟**而不是本地 `Date.now()`：跨机器比时间戳会把两台机器的
  //    时钟差算进判据里（远端慢半分钟就是一条假的"产物是旧的"）。
  const begin = DRY
    ? { status: 0, stdout: '' }
    : runCapture('ssh', [
        '-o',
        'ConnectTimeout=10',
        HOST,
        [
          'powershell -NoProfile -Command',
          `"${ARTIFACTS.map((rel) => `Remove-Item -Force -ErrorAction SilentlyContinue '${remotePathOf(rel)}'`).join('; ')}${
            ARTIFACTS.length > 0 ? '; ' : ''
          }Write-Output ('BUILDBEGIN=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"`,
        ].join(' '),
      ]);
  const buildBeginRaw = /BUILDBEGIN=(\d+)/.exec(begin.stdout ?? '')?.[1];
  const buildBeginEpoch = buildBeginRaw ? Number(buildBeginRaw) : null;
  if (DRY) {
    console.log('  步骤 3：清掉远端上一轮的产物，并用**远端时钟**记构建起点（dry-run：不执行）');
    console.log(`      将清除的远端产物：\n      ${ARTIFACTS.map(remotePathOf).join('\n      ') || '（本次任务没有产物）'}`);
  } else {
    console.log('  步骤 3：清掉远端上一轮的产物，并用**远端时钟**记构建起点');
    if (ARTIFACTS.length > 0 && (buildBeginEpoch === null || Number.isNaN(buildBeginEpoch))) {
      die(
        '步骤 3（清远端旧产物）',
        `读不到远端时钟（ssh 退出码 ${begin.status}）。`,
        '   没有构建起点就无法证明"产物是这一次的" —— 宁可不建。',
      );
    }
    if (buildBeginEpoch !== null) {
      console.log(
        `  ✅ ${ARTIFACTS.length} 个产物路径已在远端清除；构建起点（远端 UTC）= ${new Date(buildBeginEpoch * 1000).toISOString()}`,
      );
    }
  }

  /* 步骤 4：远端执行同一个 gradle 任务 */
  console.log('  步骤 4：在远端执行 gradle 任务（输出直通本机终端，退出码原样透传）');
  for (const a of gradleArgs) {
    if (/["'&|;<>\n\r`$]/.test(a)) {
      die(
        '步骤 4（参数形状）',
        `任务参数里有会破坏远端 cmd 命令行的字符：${JSON.stringify(a)}`,
        '   远程模式只接受简单 token（任务名 / `-Pkey=value` / `-I 文件`）。',
      );
    }
  }
  // 🔴 `--no-build-cache` 是步骤 5 那道"产物 mtime ≥ begin"新鲜度证明的**承重前提**，
  // 不是性能开关：Gradle 从 build cache 回填产物时会**保留缓存条目的原始 mtime** ——
  // 2026-10-06 实测踩过：上一轮被断开的 ssh 留下的守护进程把构建写完进了缓存，
  // 下一轮步骤 3 明明删了 APK、gradle 全程 up-to-date，步骤 5 却读到
  // "mtime=15:15:47Z < begin=15:16:07Z" 的假"陈旧产物"（两端时钟逐秒同步已排除偏差）。
  // 关掉缓存后，步骤 3 删除过的产物只能由**本次调用**重新写出 ⇒ mtime 证明重新成立。
  // 代价：远端失去构建缓存（实测 assembleRelease 全程 ~35s，可忽略）。
  const remoteCmd = `cd /d ${REMOTE_ANDROID_WIN} && gradlew.bat --no-build-cache ${gradleArgs.join(' ')}`;
  const build = runLogged('ssh', ['-o', 'ConnectTimeout=10', HOST, remoteCmd]);
  if (build.status !== 0) {
    die(
      '步骤 4（远端 gradle 构建）',
      `远端 gradle 退出码 ${build.status}。命令是：\n      ssh ${HOST} "${remoteCmd}"`,
      '   构建本身失败 —— 不要改成"换本机再试一次"：同一份源码在两边都该失败。',
    );
  }

  /* 步骤 5–7：产物身份回读 → scp 回本地原路径 → 本地哈希对账 + 回写 mtime */
  if (ARTIFACTS.length === 0) {
    console.log(
      '  步骤 5：本次任务不产出 APK/AAB（例如 clean / 自定义任务）⇒ **没有产物回传**',
    );
    console.log(
      '   ⚠️ 取证：本地 apps/mobile/android/app/build/outputs/** 里如果还有东西，那**不是**这一次的输出。',
    );
    console.log(
      DRY
        ? '[dry-run] 计划打印完毕：**0 次网络写操作、0 个本地字节被写**。'
        : '✅ 远程任务完成（无产物回传）。',
    );
    return 0;
  }

  // 🔴 dry-run 到这里为止：步骤 5–7 需要**远端的真实读数**才能判，而"读不到"按规则
  //    必须判红。所以计划打印完就返回，绝不进入那条会正确判红的身份对账。
  if (DRY) {
    console.log('  步骤 5：将回读远端产物身份（SIZE / MTIME / SHA256）—— dry-run：不执行');
    console.log('  步骤 6：将 scp 回本地**消费者原本期望的路径**（与 reinstall-all.sh 的 $APK 同一个）');
    console.log('  步骤 7：将对账本地 sha256 == 远端，并把本地 mtime 回写成远端构建完成时刻');
    for (const rel of ARTIFACTS) console.log(`      预期落点：${rel}（远端 ${remotePathOf(rel)}）`);
    console.log('\n[dry-run] 计划打印完毕：**0 次网络写操作、0 个本地字节被写**。');
    return 0;
  }

  const readback = runCapture('ssh', [
    '-o',
    'ConnectTimeout=10',
    HOST,
    [
      'powershell -NoProfile -Command',
      `"${ARTIFACTS.map((rel, i) => {
        const p = remotePathOf(rel);
        return (
          `Write-Output ('A${i}::SIZE=' + (Get-Item '${p}').Length); ` +
          // 🔴 这里**不能**用 .ToUnixTimeSeconds()：打包机上的 Windows PowerShell 5.1 里
          //    [DateTime] 没有这个方法（实测 MTIME_ERR=「方法调用失败，因为
          //    [System.DateTime] 不包含名为 ToUnixTimeSeconds 的方法」）。它一抛错，
          //    这一行什么都不输出，而下面 Number('') 恰好是 **0** —— 于是
          //    一次**成功的构建**被判成"产物是 1970 年的"（10-05 01:4x 实测）。
          //    跨版本稳的写法：远端只给 ISO-8601（UTC），换算留在本地。
          `Write-Output ('A${i}::MTIME=' + (Get-Item '${p}').LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')); ` +
          `Write-Output ('A${i}::SHA256=' + (Get-FileHash '${p}' -Algorithm SHA256).Hash)`
        );
      }).join('; ')}"`,
    ].join(' '),
  ]);

  const pulled = [];
  for (let i = 0; i < ARTIFACTS.length; i += 1) {
    const rel = ARTIFACTS[i];
    const grab = (name) => {
      const m = new RegExp(`A${i}::${name}=([^\\r\\n]*)`).exec(readback.stdout ?? '');
      return m ? m[1].trim() : '';
    };
    const size = Number(grab('SIZE'));
    // 🔴 空串与坏串**不许**被读成 0：`Number('')` 是 0，而 0 是有限数，
    //    旧的写法因此把"探针没读到"伪装成"产物来自 1970 年"。
    //    现在按 ISO 解析，解析不出来就是 NaN（下面按"读不到"红，而不是按"旧产物"红）。
    const mtimeRaw = grab('MTIME');
    const mtimeParsed = Date.parse(mtimeRaw);
    const mtime = Number.isNaN(mtimeParsed) ? Number.NaN : mtimeParsed / 1000;
    const sha = grab('SHA256').toLowerCase();
    console.log(`  步骤 5：远端产物身份（第 ${i + 1}/${ARTIFACTS.length} 枚）`);
    if (
      !/^[0-9a-f]{64}$/.test(sha) ||
      !Number.isFinite(size) ||
      size <= 0 ||
      // 🔴 还要过一道"这个时刻**可能是真的吗**"：mtime 落在 2020 年之前只有一种常见解释 ——
      //    远端那一行没输出、被某个转换读成了 0。那种情况必须报"探针坏了"，
      //    不能让它走到下面那条"产物比构建起点旧"的判据上去（它会给出一个**错误的归因**，
      //    把一次成功的构建说成拿旧产物报绿）。
      !Number.isFinite(mtime) ||
      mtime < MTIME_FLOOR
    ) {
      die(
        '步骤 5（远端产物身份）',
        `读不到远端产物的 SIZE/MTIME/SHA256：${rel}（MTIME 原样读到 〈${mtimeRaw || '空'}〉）`,
        `   要么 gradle 没产出它（任务名与产物路径对不上，或该任务在 AGP 里的输出形状不在推导规则内），` +
          '\n   要么**这一侧的探针坏了**（远端命令抛错时什么都不输出，而空串会被 Number() 读成 0）。' +
          '\n   ⚠️ 不接受"读不到就当没问题"，也不接受"读不到"被写成"产物是旧的"。',
      );
    }
    if (buildBeginEpoch !== null && mtime < buildBeginEpoch) {
      die(
        '步骤 5（产物是不是这一次的）',
        `远端产物比本次构建起点还旧：mtime=${new Date(mtime * 1000).toISOString()} < begin=${new Date(buildBeginEpoch * 1000).toISOString()}`,
        `   也就是说那枚 ${rel} 是**上一轮留下的**（步骤 3 的清除没生效，或 gradle 把它放去了别处）。` +
          '\n   这正是 §7 第 27 条要挡的形状：拿旧产物报绿。',
      );
    }
    console.log(
      `   远端：size=${size.toLocaleString('en-US')} B  sha256=${sha.slice(0, 16)}…  完成时刻(UTC)=${new Date(mtime * 1000).toISOString()}`,
    );

    const localPath = join(repoRoot, rel);
    mkdirSync(dirname(localPath), { recursive: true });
    const remoteSrc = `${HOST}:${remotePathOf(rel)}`;
    console.log(`  步骤 6：scp 回本地**消费者原本期望的路径** ${rel}`);
    const got = runLogged('scp', ['-q', remoteSrc, localPath]);
    if (got.status !== 0 || !existsSync(localPath)) {
      die(
        '步骤 6（产物拉回）',
        `scp 没把产物落到 ${rel}（退出码 ${got.status}）`,
        '   路径必须落在这里：reinstall-all.sh 的 android 段、$APK、APK 新鲜度判据都读它。',
      );
    }
    console.log('  步骤 7：本地哈希与远端逐字对账 + 把本地 mtime 回写成远端构建完成时刻');
    const localSha = createHash('sha256').update(readFileSync(localPath)).digest('hex');
    if (localSha !== sha) {
      die(
        '步骤 7（传输对账）',
        `本地 sha256 与远端不一致：\n      local =${localSha.slice(0, 16)}…\n      remote=${sha.slice(0, 16)}…`,
        '   传输被截断/被覆盖。拒绝用一个"可能是别人那一份"的产物继续。',
      );
    }
    const localSize = statSync(localPath).size;
    if (localSize !== size) {
      die('步骤 7（传输对账）', `本地字节数 ${localSize} ≠ 远端 ${size}`, '   哈希相同而大小不同不可能 —— 说明读到的不是同一枚文件，停。');
    }
    // 🔴 为什么要把本地 mtime 回写成**远端构建完成时刻**，而不是留成"传输时间"：
    //    `scripts/lib/apk-freshness.sh` 那条防线比的是"APK mtime vs 最新源码 mtime"
    //    （§7 第 27 条的唯一常驻判据）。scp 之后本地 mtime = now ⇒ 这条判据
    //    **结构上不可能再变红**，也就是被远程化顺手做成了一条永远通过的假判据。
    //    回写成真实构建时刻之后，构建期间/之后又改了源码 ⇒ 它照常报"APK 比源码旧"。
    try {
      const st = statSync(localPath);
      utimesSync(localPath, st.atime, new Date(mtime * 1000));
    } catch (e) {
      die('步骤 7（回写 mtime）', `utimes 失败：${e.message}`, '   新鲜度判据依赖这个时间戳，写不进去就不能宣布"产物是当前的"。');
    }
    pulled.push({ rel, size, sha, mtime });
    console.log(
      `   ✅ ${rel}：size=${localSize.toLocaleString('en-US')} B  sha256=${localSha.slice(0, 16)}…（与远端逐字相同）  本地 mtime=${new Date(mtime * 1000).toISOString()}`,
    );
  }

  console.log('\n✅ 远程 Android 构建完成');
  console.log(`   构建主机 = ${HOST}（规则要求的默认）`);
  for (const p of pulled) {
    console.log(`   产物     = ${p.rel}`);
    console.log(`   身份     = size=${p.size.toLocaleString('en-US')} B / sha256=${p.sha.slice(0, 16)}… / 远端完成(UTC)=${new Date(p.mtime * 1000).toISOString()}`);
  }
  console.log(
    '   四条判据 = ① 工作树 tar sha256 对账 ② 远端旧产物已清除 ③ 产物 mtime ≥ 本次构建起点（远端时钟）' +
      '\n             ④ 拉回后本地 sha256 与远端逐字相同，且本地 mtime 回写为远端构建完成时刻',
  );
  return 0;
}

/* ── 分流 ─────────────────────────────────────────────────────────────── */

function usage() {
  console.log(
    [
      '用法：node scripts/run-gradle.mjs <gradle 任务>… [--dry-run]',
      '',
      '  Windows            → 本机 gradlew.bat（逐字不变，**不会**递归回远程模式）',
      '  macOS / Linux      → 同步工作树 → ssh 远端构建 → 产物 scp 回本地原路径',
      '  HEYTA_ANDROID_LOCAL_GRADLE=1 → 显式本机执行（例外；输出里会大字标注）',
      '  HEYTA_ANDROID_HOST / HEYTA_ANDROID_REMOTE_ROOT → 换构建主机 / 换远端仓库根',
      '  --dry-run          → 只打印计划，不发任何网络写操作、不写任何本地文件',
    ].join('\n'),
  );
}

/**
 * 只有**被当成命令执行**时才分流。被 `import` 进来时（门禁
 * `scripts/check-android-gradle-remote.mjs` 要读 `deriveArtifacts` 做跨文件对账）
 * 只导出函数、不碰 process.argv、也不 exit —— 否则"跑一次门禁"会顺手起一次构建。
 */
const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(0);
  }
  if (gradleArgs.length === 0) {
    console.error('run-gradle: 需要至少一个 Gradle 任务名，例如 assembleDebug');
    process.exit(2);
  }
  if (isWindows) {
    // 🔴 承重的一支：远端（windows-pc）跑的还是同一批 pnpm 脚本，
    //    它必须落在这里，否则"远程构建"会在远端再发起一次"远程构建"（递归）。
    process.exit(runLocal('Windows 本机 —— 远程模式的对侧，行为逐字不变'));
  }
  if (process.env.HEYTA_ANDROID_LOCAL_GRADLE === '1') {
    console.warn(
      [
        '',
        '╔═══════════════════════════════════════════════════════════════════',
        '║ 🔴 这是**本机执行**（macOS/Linux 上直接起 gradle）。',
        '║    规则要求 Android 任务走远程构建主机（默认 ssh windows-pc）。',
        '║    触发条件：显式设置了 HEYTA_ANDROID_LOCAL_GRADLE=1。',
        '║    它是**逃生门，不是兜底** —— 远程失败时本文件不会自己走到这里。',
        '╚═══════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
    process.exit(runLocal('显式例外 HEYTA_ANDROID_LOCAL_GRADLE=1'));
  }
  process.exit(runRemote());
}
