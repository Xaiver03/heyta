#!/usr/bin/env node
/**
 * 鸿蒙（RNOH）构建：在 **`windows-pc`** 上跑 `hvigorw assembleHap`，产物留那边（`--pull` 才拉回）。
 *
 * ## 为什么是 Windows Dev
 *
 * DevEco Studio 与它的 SDK/NDK/hvigor 在 `windows-pc`（`C:\Program Files\Huawei\DevEco Studio`），
 * **这台 Mac 上没有**（`/Applications/DevEco-Studio.app` 不存在）。所以鸿蒙的构建天然属于那台机器：
 * 在本机跑只会在 `步 0 前置检查` 就红。
 *
 * ⚠️ 三个既有的 `verify-harmony-*.sh` **写死了 macOS 路径**
 * （`DEVECO_HOME=/Applications/DevEco-Studio.app/Contents`），它们证的是"mac 上能不能出包"；
 * 这条脚本走的是另一台机器，两者**不要混着读**。
 *
 * ## 🔴 不静默回落本机
 *
 * 与 `run-gradle.mjs` / `remote-web-build.mjs` 同一条纪律：Windows 连不上、或那台上没装
 * DevEco，就**响亮失败并点名是哪一步**。绝不"远端不行就在本机跑"——本机根本没有工具链。
 *
 * ## 用法
 *
 *   node scripts/build-harmony-windows.mjs            # 同步 + 构建（HAP 留在远端）
 *   node scripts/build-harmony-windows.mjs --pull     # 再把 .hap 拉回 dist/harmony/
 *   node scripts/build-harmony-windows.mjs --dry-run  # 只打印计划
 *
 * 环境变量：
 *   HEYTA_WIN_HOST      默认 `windows-pc`
 *   HEYTA_WIN_REPO      默认 `C:\src\heyta`（那台上已有的检出，带 node_modules）
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const PULL = argv.includes('--pull');

const HOST = process.env.HEYTA_WIN_HOST || 'windows-pc';
const WIN_REPO = process.env.HEYTA_WIN_REPO || 'C:\\src\\heyta';
const DEVECO = 'C:\\Program Files\\Huawei\\DevEco Studio';
const HVIGORW = `${DEVECO}\\tools\\hvigor\\bin\\hvigorw.bat`;

/** ssh 到那台机跑一条 cmd（`cmd /c` 的引号规则比 PowerShell 好预测，靠它跑顺序命令）。 */
function win(command) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', HOST, `cmd /c "${command}"`], { encoding: 'utf8' });
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function step(title, detail) {
  console.log(`\n▶ ${title}｜${detail}`);
}

function fail(title, detail, raw) {
  console.error(`\n🔴 ${title} 失败：${detail}`);
  if (raw) console.error(String(raw).trim().split('\n').slice(-12).join('\n'));
  process.exit(2);
}

const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim();

const plan = [
  `ssh 探活 ${HOST}`,
  `确认 DevEco 在 ${DEVECO}`,
  `那台上把 ${WIN_REPO} 对齐到本仓 HEAD (${head})`,
  '（只在 lockfile 变了时）pnpm install --frozen-lockfile',
  `hvigorw assembleHap（工作目录 ${WIN_REPO}\\apps\\mobile\\harmony）`,
  '读回 .hap 的路径/体积/sha256',
  ...(PULL ? ['scp 把 .hap 拉回 dist/harmony/'] : []),
];
step('计划', `${HOST}（${WIN_REPO}）`);
plan.forEach((line, index) => console.log(`   ${index + 1}. ${line}`));

if (DRY) {
  console.log('\n✅ [dry-run] 计划已打印，未连接、未同步、未构建。');
  process.exit(0);
}

/* ① 探活 */
step('① 探活', `ssh ${HOST}`);
const alive = win('echo READY');
if (alive.status !== 0 || !alive.out.includes('READY')) fail('① 探活', `连不上 ${HOST}`, alive.out);

/* ② 工具链 */
step('② 工具链', 'DevEco / hvigorw 在不在');
const tool = win(`if exist "${HVIGORW}" (echo HVIGORW_OK) else (echo HVIGORW_MISSING)`);
if (!tool.out.includes('HVIGORW_OK')) {
  fail('② 工具链', `那台上没有 ${HVIGORW}`, tool.out);
}
console.log(`   DevEco 在：${DEVECO}`);

/* ③ 对齐源码 */
step('③ 对齐源码', `tar 覆盖 ${WIN_REPO} 的源码（保留那边的 node_modules）`);
/*
 * 🔴 那台上的 `C:\src\heyta` **不是 origin 的克隆**：它的 tip 是
 * `bootstrap: source snapshot from macOS working tree`，`git fetch origin` 无从谈起
 * （第一次跑就是这样卡住的）。所以源码用 tar 覆盖过去，`node_modules` 原地不动。
 */
const tar = spawnSync('bash', ['-lc',
  // 🔴 两条踩过的坑，都在这条管道上：
  //   ① `tar -czf -` 直接打工作树：macOS 的 AppleDouble/扩展属性会让 Windows 的 bsdtar 报
  //      `Archive entry has empty or unreadable filename` 并非零退出；
  //   ② 连 `git archive` 打**全仓**也不行：`apps/mobile/evidence/` 下那些**中文文件名**的 png
  //      在 Windows tar 上是 `Invalid empty pathname`（rc 仍是 0，但那些文件没落地）。
  //   ⇒ 只打鸿蒙构建真正需要的路径，且用 `git archive`（只含已跟踪文件、无 AppleDouble）。
  /* `:!apps/mobile/evidence`：证据目录里有**中文文件名**的 png，Windows tar 认不了
     （报 `Invalid empty pathname`，整条管道非零退出）。它们与构建无关，排除掉。 */
  `git archive --format=tar HEAD ':!apps/mobile/evidence' apps/mobile packages package.json pnpm-lock.yaml pnpm-workspace.yaml | ssh -o BatchMode=yes ${HOST} 'tar -xf - -C ${WIN_REPO}'`,
], { encoding: 'utf8' });
if (tar.status !== 0) fail('③ 对齐源码', 'git archive 管道失败', `${tar.stdout}${tar.stderr}`);
const align = win(`cd /d "${WIN_REPO}" && git rev-parse --short HEAD`);
console.log(`   源码已覆盖（那台的 git HEAD 仍停在 ${String(align.out).trim()}，源码以 tar 为准）`);

/* ④ 依赖（只在 lockfile 变化时真装） */
step('④ 依赖', 'pnpm install（按需）');
const deps = win(`cd /d "${WIN_REPO}" && if exist node_modules (echo DEPS_PRESENT) else (call pnpm install --frozen-lockfile)`);
if (deps.status !== 0) fail('④ 依赖', 'pnpm install 失败', deps.out);
console.log('   node_modules 就绪');

/* ⑤ 构建 HAP */
step('⑤ 构建', 'hvigorw assembleHap');
/*
 * 🔴 `DEVECO_SDK_HOME` 必须显式设：非交互的 ssh 会话**不继承**用户在图形会话里设的环境变量，
 * 而 hvigor 会直接报 `00303217 Configuration Error: Invalid value of 'DEVECO_SDK_HOME'`。
 */
const build = win(`set "DEVECO_SDK_HOME=${DEVECO}\\sdk" && cd /d "${WIN_REPO}\\apps\\mobile\\harmony" && call "${HVIGORW}" assembleHap --no-daemon`);
if (build.status !== 0) fail('⑤ 构建', 'hvigorw assembleHap 失败（看上面那几行）', build.out);

/* ⑥ 产物 */
step('⑥ 产物', '.hap 读数');
const artifact = win(`cd /d "${WIN_REPO}\\apps\\mobile\\harmony" && dir /s /b entry\\build\\default\\outputs\\*.hap 2>nul`);
const hap = String(artifact.out).split(/\r?\n/).map((l) => l.trim()).find((l) => l.toLowerCase().endsWith('.hap'));
if (hap === undefined) fail('⑥ 产物', '构建说成功，但没找到 .hap（判据不能只看退出码）', artifact.out);
const size = win(`for %F in ("${hap}") do @echo %~zF`);
console.log(`   ${hap}（${String(size.out).trim()} bytes）`);

if (PULL) {
  step('⑦ 拉回', 'dist/harmony/');
  const target = join(repoRoot, 'dist/harmony');
  mkdirSync(target, { recursive: true });
  const scp = spawnSync('scp', ['-o', 'BatchMode=yes', `${HOST}:${hap.replaceAll('\\', '/')}`, target], { encoding: 'utf8' });
  if (scp.status !== 0) fail('⑦ 拉回', 'scp 失败', `${scp.stdout}${scp.stderr}`);
  console.log(`   已拉回 ${target}`);
}

console.log(`\n✅ 鸿蒙构建完成（${HOST}），HEAD ${head}${PULL ? '，HAP 已拉回' : '，HAP 留在远端'}`);
