#!/usr/bin/env node
/**
 * 鸿蒙 · **RNOH 原生侧探针**，在 `windows-pc` 上跑。
 *
 * 这条脚本补的是上一轮留下的那句边界：
 *
 *      「产物 `entry-default-unsigned.hap` 400,390 字节，**不含 `.so`、不含 hermes bundle**；
 *        这是 entry 模块的 HAP，不是 RNOH 全量包。」
 *
 * 它把 `scripts/verify-harmony-rnoh.sh`（macOS 版，写死
 * `/Applications/DevEco-Studio.app/Contents`，**在本机从来跑不了**）搬到那台真装了
 * DevEco 的机器上，判据一条不改。
 *
 * ## 🔴 它回答什么、不回答什么
 *
 * 回答：**RNOH 的 C++ 在 `windows-pc` 上能不能编译，并真的打进 HAP**。
 * 不回答："RN 应用能跑起来"、"codegen 对不对"（本脚本用桩顶替 codegen/autolinking，
 * 与 mac 版同一条边界；那一环是 `scripts/verify-harmony-rnoh-js.sh` 的事）。
 *
 * ## 🔴 不静默回落本机
 *
 * 与 `build-harmony-windows.mjs` 同一条纪律：连不上、工具链缺失、构建失败，都**响亮失败并点名**。
 * 本机没有 DevEco，所以"回落本机"在这里连一个能跑的东西都不是。
 *
 * ## 用法
 *
 *   node scripts/build-harmony-rnoh-windows.mjs            # 推过去跑，输出原样回显
 *   node scripts/build-harmony-rnoh-windows.mjs --pull     # 再把产出的 HAP 拉回 dist/harmony/
 *   node scripts/build-harmony-rnoh-windows.mjs --dry-run  # 只打印计划
 *
 * 环境变量：
 *   HEYTA_WIN_HOST            默认 `windows-pc`
 *   HEYTA_DEVECO              默认 `C:\Program Files\Huawei\DevEco Studio`
 *   HEYTA_HARMONY_RN_WORK     默认 `C:\hx-rnoh`（**必须短**：hvigor 内部 pnpm 深路径 ENAMETOOLONG）
 *   RNOH_VERSION              默认 `0.84.4`
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const PULL = argv.includes('--pull');

const HOST = process.env.HEYTA_WIN_HOST || 'windows-pc';
const DEVECO = process.env.HEYTA_DEVECO || 'C:\\Program Files\\Huawei\\DevEco Studio';
const WORK = process.env.HEYTA_HARMONY_RN_WORK || 'C:\\hx-rnoh';
const RNOH_VERSION = process.env.RNOH_VERSION || '0.84.4';
const NODE_EXE = `${DEVECO}\\tools\\node\\node.exe`;
const REMOTE_SCRIPT = 'C:\\hx-rnoh-runner.mjs';

const RUNNER = join(here, 'harmony-rnoh-windows-runner.mjs');

/** ssh 到那台机，stdin 可选；`cmd /c` 的引号规则比 PowerShell 好预测。 */
function ssh(args, input) {
  const result = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST, ...args],
    { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 },
  );
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const step = (t, d) => console.log(`\n▶ ${t}｜${d}`);
const fail = (t, d, raw) => {
  console.error(`\n🔴 ${t} 失败：${d}`);
  if (raw) console.error(String(raw).trim().split('\n').slice(-15).join('\n'));
  process.exit(2);
};

const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim();

step('计划', `${HOST}｜RNOH CLI ${RNOH_VERSION}｜工作目录 ${WORK}`);
[
  `ssh 探活 ${HOST}`,
  `确认 DevEco 在 ${DEVECO}（含 ohpm / hvigorw / NDK cmake+ninja+llvm）`,
  `把探针脚本推到 ${REMOTE_SCRIPT}（用 DevEco 自带 node 跑，那台没有 python）`,
  `npm pack @react-native-oh/react-native-harmony-cli@${RNOH_VERSION} → 官方模板`,
  '写四个 codegen 桩（autolinking / PackageProvider / 包工厂 / 入口页）',
  'ohpm install → hvigorw assembleHap（会真编 C++）',
  '验产物：librnoh_core.so / librnoh_app.so / libreactnative.so + modules.abc 体积',
  ...(PULL ? ['scp 把 .hap 拉回 dist/harmony/'] : []),
].forEach((line, i) => console.log(`   ${i + 1}. ${line}`));

if (DRY) {
  console.log('\n✅ [dry-run] 计划已打印，未连接、未推送、未构建。');
  process.exit(0);
}

/* ① 探活 */
step('① 探活', `ssh ${HOST}`);
const alive = ssh([`cmd /c "echo READY"`]);
if (alive.status !== 0 || !alive.out.includes('READY')) fail('① 探活', `连不上 ${HOST}`, alive.out);

/* ② 工具链 */
step('② 工具链', 'DevEco / ohpm / hvigorw 在不在');
/*
 * 🔴 探那台机的路径**不要**用 `cmd /c "if exist \\"...\\" ..."`：两层引号在
 * PowerShell 默认 shell 下转义规则不同（`\"` 不是转义符），路径里的空格会被切断 ⇒ 假阴性。
 * 这里用 `Test-Path` + 单引号字面量，整条命令只有一层引号。
 */
const tool = ssh([`powershell -NoProfile -Command "if (Test-Path '${NODE_EXE}') { 'NODE_OK' } else { 'NODE_MISSING' }"`]);
if (!tool.out.includes('NODE_OK')) fail('② 工具链', `那台上没有 ${NODE_EXE}`, tool.out);
console.log(`   DevEco 在：${DEVECO}`);

/* ③ 推脚本 */
step('③ 推脚本', REMOTE_SCRIPT);
/*
 * 🔴 用 scp，不用 stdin + PowerShell 落盘：探针里全是 `$`、大括号与引号，
 * 经 PowerShell `-Command "..."` 那一层会被**二次插值**（`$s` 先被当变量），
 * 而且 base64 内联会撞 cmd 的 8191 字符命令行上限。scp 一次拷完，零转义。
 */
const push = spawnSync('scp', ['-o', 'BatchMode=yes', RUNNER, `${HOST}:${REMOTE_SCRIPT.replaceAll('\\', '/')}`], { encoding: 'utf8' });
if (push.status !== 0) fail('③ 推脚本', 'scp 失败', `${push.stdout}${push.stderr}`);
console.log(`   已推（${readFileSync(RUNNER).length} 字节）`);

/* ④ 跑探针 */
step('④ 跑探针', '内部会自己打印 OK / BAD 行');
const run = ssh([`"${NODE_EXE}" ${REMOTE_SCRIPT}`]);
console.log(run.out.trimEnd());

/* ⑤ 判据 */
step('⑤ 判据', '按 OK/BAD 行计数，不猜退出码');
const oks = (run.out.match(/^OK {3}/gm) || []).length;
const bads = (run.out.match(/^BAD {2}/gm) || []).length;
console.log(`   OK ${oks} 条，BAD ${bads} 条`);
if (run.status !== 0 || bads > 0) {
  fail('⑤ 判据', `${bads} 条断言红了（HEAD ${head}）`, '看上面 BAD 行');
}
if (oks === 0) fail('⑤ 判据', '一条 OK 都没有 —— 这不是"通过"，是探针没跑到', run.out);

/* ⑥ 拉回 */
if (PULL) {
  step('⑥ 拉回', 'dist/harmony/');
  const hapLine = (run.out.match(/^HAP (.+)$/m) || [])[1];
  if (hapLine === undefined) fail('⑥ 拉回', '输出里没有 HAP 路径行', run.out);
  const target = join(repoRoot, 'dist/harmony');
  mkdirSync(target, { recursive: true });
  const scp = spawnSync(
    'scp',
    ['-o', 'BatchMode=yes', `${HOST}:${hapLine.trim().replaceAll('\\', '/')}`, join(target, 'rnoh-probe.hap')],
    { encoding: 'utf8' },
  );
  if (scp.status !== 0) fail('⑥ 拉回', 'scp 失败', `${scp.stdout}${scp.stderr}`);
  console.log(`   已拉回 ${join(target, 'rnoh-probe.hap')}`);
}

console.log(`\n✅ RNOH 原生侧探针通过（${HOST}，HEAD ${head}）${PULL ? '，HAP 已拉回' : '，HAP 留在远端'}`);
