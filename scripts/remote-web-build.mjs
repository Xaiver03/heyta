#!/usr/bin/env node
/**
 * 把 **Web / 共享包** 的构建搬到 `linux-dev` 上跑，产物留在那边（`--pull` 才拉回来）。
 *
 * ## 为什么要它
 *
 * 本机（Mac）磁盘与内存都紧张：`pnpm -r build` + `apps/web` 打包本身要占几个 GB 的
 * 中间产物，而 `linux-dev` 有 12 核 / 15 GB / 700 GB 空闲。构建是**可搬**的活；
 * 只有需要本机产物的那一步（打 macOS .app、跑需要 GUI 的验收）才该留在本机。
 *
 * ## 🔴 不静默回落本机
 *
 * 与 `run-gradle.mjs` 同一条纪律：远端连不上就**响亮失败并点名是哪一步**，
 * 绝不"远程不行就在本机跑"。悄悄在本机构建会让"这个产物来自哪批源码"重新变成猜的。
 * 唯一的逃生门是显式 `HEYTA_REMOTE_FALLBACK_LOCAL=1`，它会把"本机执行"大字印出来。
 *
 * ## 用法
 *
 *   node scripts/remote-web-build.mjs                 # 同步 + 构建（产物留远端）
 *   node scripts/remote-web-build.mjs --pull          # 再拉回 apps/web/dist（给 macOS 打包用）
 *   node scripts/remote-web-build.mjs --dry-run       # 只打印计划，一个字节都不动
 *   node scripts/remote-web-build.mjs --run "pnpm typecheck"   # 跑别的 pnpm 脚本（同一套同步）
 *
 * 环境变量：
 *   HEYTA_REMOTE_HOST       默认 `linux-dev`
 *   HEYTA_REMOTE_ROOT       默认 `/home/xaiver/heyta-web-build`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const PULL = argv.includes('--pull');
/** `--run "<命令>"`：在同步好的远端树上执行任意命令（默认是构建链）。 */
const runIndex = argv.indexOf('--run');
const CUSTOM = runIndex >= 0 ? argv[runIndex + 1] : undefined;
const FALLBACK = process.env.HEYTA_REMOTE_FALLBACK_LOCAL === '1';

const HOST = process.env.HEYTA_REMOTE_HOST || 'linux-dev';
const REMOTE_ROOT = process.env.HEYTA_REMOTE_ROOT || '/home/xaiver/heyta-web-build';

/** rsync 排除项：这些在远端由 `pnpm install` 重新生成，同步过去只是白花时间与带宽。 */
const EXCLUDES = [
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'tmp',
  'e2e/test-results',
  'e2e/vault-results',
  'apps/web/dist',
  'apps/mobile/android/app/build',
  'apps/mobile/android/.cxx',
  'apps/mobile/ios/build',
  'apps/desktop-macos/.build',
  'credentials',
];

function say(step, message) {
  console.log(`\n▶ ${step}｜${message}`);
}

function fail(step, message, detail) {
  console.error(`\n🔴 ${step} 失败：${message}`);
  if (detail) console.error(String(detail).trim().split('\n').slice(0, 12).join('\n'));
  console.error(`\n   ⇒ 这一步没有静默回落本机（那会让"产物来自哪批源码"重新变成猜的）。`);
  process.exit(2);
}

function run(command, args, options = {}) {
  if (DRY) {
    console.log(`   [dry-run] ${command} ${args.join(' ')}`);
    return { status: 0, stdout: '' };
  }
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  return result;
}

const plan = [
  'ssh 探活（连不上就停，不回落本机）',
  `rsync 源码 → ${HOST}:${REMOTE_ROOT}`,
  '远端 pnpm install --frozen-lockfile（只在 lockfile 或 node_modules 变化时真跑）',
  '远端 pnpm -r build && pnpm --filter @heyta/web build',
  '读回产物指纹（远端 apps/web/dist/index.html 的 sha256 与体积）',
  ...(PULL ? ['rsync 拉回 apps/web/dist'] : []),
];
say('计划', `载体 ${HOST}:${REMOTE_ROOT}`);
for (const [index, line] of plan.entries()) console.log(`   ${index + 1}. ${line}`);

if (FALLBACK) {
  console.log('\n🔴🔴 本机执行（HEYTA_REMOTE_FALLBACK_LOCAL=1）—— 这一趟的产物**不是**载体机产的，别当远端读数记。');
}

if (DRY) {
  // dry-run 的承诺是"一个字节都不写"：连探活也只打印、不真连（探活虽然只读，
  // 但它会把 ssh 的交互/超时行为带进一条本该零副作用的路径）。
  console.log('\n✅ [dry-run] 计划已打印，未连接、未同步、未构建。');
  process.exit(0);
}

/* ── 1. 探活 ──────────────────────────────────────────────────────────── */

say('① 探活', `ssh ${HOST}`);
if (FALLBACK) {
  console.log('   跳过远端，直接在本机执行');
} else {
  const probe = run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, 'echo READY; node -v; pnpm -v']);
  if (probe.status !== 0 || !String(probe.stdout).includes('READY')) {
    fail('① 探活', `连不上 ${HOST}`, probe.stderr || probe.stdout);
  }
  console.log(`   远端就绪：${String(probe.stdout).trim().split('\n').join(' / ')}`);
}

/* ── 2. 同步源码 ──────────────────────────────────────────────────────── */

say('② 同步', 'rsync 源码（排除 node_modules / dist / 证据 / 凭据）');
if (!FALLBACK) {
  const mk = run('ssh', ['-o', 'BatchMode=yes', HOST, `mkdir -p ${REMOTE_ROOT}`]);
  if (mk.status !== 0) fail('② 同步', '远端建目录失败', mk.stderr);

  const rsyncArgs = ['-az', '--delete'];
  for (const pattern of EXCLUDES) rsyncArgs.push('--exclude', pattern);
  rsyncArgs.push(`${repoRoot}/`, `${HOST}:${REMOTE_ROOT}/`);
  const sync = run('rsync', rsyncArgs);
  if (sync.status !== 0) fail('② 同步', 'rsync 失败', sync.stderr);
  console.log('   源码已同步');
}

/* ── 3+4. 远端安装与构建 ──────────────────────────────────────────────── */

const buildScript = [
  'set -euo pipefail',
  `cd ${REMOTE_ROOT}`,
  'if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then pnpm install --frozen-lockfile --reporter append-only; fi',
  CUSTOM ?? 'pnpm -r build && pnpm --filter @heyta/web build',
  'sha256sum apps/web/dist/index.html',
  'du -sh apps/web/dist',
].join(' && ');

say('③④ 构建', CUSTOM === undefined ? '远端 pnpm install + pnpm -r build + web build' : `远端执行：${CUSTOM}`);
if (FALLBACK) {
  const local = run('bash', ['-lc', buildScript.replaceAll(REMOTE_ROOT, repoRoot)]);
  if (local.status !== 0) fail('本机构建', '命令失败', local.stderr);
  console.log(String(local.stdout).trim());
} else {
  const build = run('ssh', ['-o', 'BatchMode=yes', HOST, `bash -lc ${JSON.stringify(buildScript)}`], { stdio: 'inherit', encoding: 'utf8' });
  if (build.status !== 0) fail('③④ 构建', '远端构建失败（看上面对应步骤的输出）');
}

/* ── 5. 指纹 ──────────────────────────────────────────────────────────── */

if (!FALLBACK) {
  say('⑤ 指纹', '远端产物读数');
  const probe = run('ssh', ['-o', 'BatchMode=yes', HOST, `cd ${REMOTE_ROOT} && sha256sum apps/web/dist/index.html && du -sh apps/web/dist && ls apps/web/dist/assets | head -3`]);
  if (probe.status !== 0) fail('⑤ 指纹', '读不到远端产物', probe.stderr);
  console.log(String(probe.stdout).trim());
}

/* ── 6. 可选拉回 ──────────────────────────────────────────────────────── */

if (PULL) {
  say('⑥ 拉回', 'rsync apps/web/dist → 本机');
  const target = join(repoRoot, 'apps/web/dist');
  if (!DRY && existsSync(target)) rmSync(target, { recursive: true, force: true });
  const pull = run('rsync', ['-az', '--delete', `${HOST}:${REMOTE_ROOT}/apps/web/dist/`, `${target}/`]);
  if (pull.status !== 0) fail('⑥ 拉回', 'rsync 失败', pull.stderr);
  console.log(`   已拉回 ${target}`);
}

console.log(`\n✅ 远端构建完成（${FALLBACK ? '本机执行' : `${HOST}:${REMOTE_ROOT}`}）${PULL ? '，产物已拉回本机' : '，产物留在远端'}`);
