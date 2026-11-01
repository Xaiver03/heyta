#!/usr/bin/env node
/**
 * 鸿蒙 · **JS 侧全链路（零桩）**：在 `windows-pc` 上跑 codegen → autolinking → Metro/Hermes →
 * release HAP。
 *
 * 补的是上一轮明确留下的那半句：
 *
 *      「`harmony-rnoh-windows-runner.mjs` 用四个桩顶替 codegen/autolinking，
 *        所以它只回答『RNOH 的 C++ 能不能编译并进包』。」
 *
 * 这条把桩全部拿掉：真 `@rnoh/hvigor-plugin`、真 autolinking、真 Metro→Hermes bundle，
 * 最后验 **release HAP 里同时有 `hermes_bundle.hbc` 与三个 `.so`，且体积在成品量级**。
 *
 * ## 用法
 *
 *   node scripts/build-harmony-rnohjs-windows.mjs            # 推过去跑，OK/BAD 原样回显
 *   node scripts/build-harmony-rnohjs-windows.mjs --dry-run   # 只打印计划
 *   node scripts/build-harmony-rnohjs-windows.mjs --pull      # 再把 release HAP 拉回 dist/harmony/
 *
 * 环境变量：`HEYTA_WIN_HOST` / `HEYTA_DEVECO` / `HEYTA_HARMONY_JS_WORK` / `RN` / `RNOH_VERSION` / `RNOH_HAR`
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
const WORK = process.env.HEYTA_HARMONY_JS_WORK || 'C:\\hx-rnjs';
const RN = process.env.RN || '0.84.1';
const RNOH_VERSION = process.env.RNOH_VERSION || '0.84.4';
const RNOH_HAR = process.env.RNOH_HAR || '0.84.3';
const JSC = process.env.JSC || 'hermes';

const NODE_EXE = `${DEVECO}\\tools\\node\\node.exe`;
const REMOTE_SCRIPT = 'C:\\hx-rnjs-runner.mjs';
const RUNNER = join(here, 'harmony-rnohjs-windows-runner.mjs');

function ssh(args) {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST, ...args],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const step = (t, d) => console.log(`\n▶ ${t}｜${d}`);
const fail = (t, d, raw) => {
  console.error(`\n🔴 ${t} 失败：${d}`);
  if (raw) console.error(String(raw).trim().split('\n').slice(-15).join('\n'));
  process.exit(2);
};

const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim();

step('计划', `${HOST}｜RN ${RN} / RNOH CLI ${RNOH_VERSION} / HAR ${RNOH_HAR} / ${JSC}`);
[
  `ssh 探活 ${HOST}`,
  `确认 DevEco 在 ${DEVECO}（含 ohpm / hvigorw / NDK cmake+ninja+llvm）`,
  `把探针推到 ${REMOTE_SCRIPT}（用 DevEco 自带 node，v24 ⇒ 满足 RN 的 styleText 要求）`,
  `npm install 真 react-native ${RN} + RNOH ${RNOH_HAR}（首次几分钟；之后复用）`,
  '官方 CLI 模板 + **真** @rnoh/hvigor-plugin（不写桩）',
  'ohpm install → debug assembleHap（真 codegen + 真 autolinking）',
  'bundle-harmony → 验 Hermes 魔数 0x1F1903C103BC1FC6',
  'release assembleHap → 验 hermes_bundle.hbc + 三个 .so + 体积量级',
  ...(PULL ? ['scp 把 release HAP 拉回 dist/harmony/'] : []),
].forEach((line, i) => console.log(`   ${i + 1}. ${line}`));

if (DRY) {
  console.log('\n✅ [dry-run] 计划已打印，未连接、未推送、未构建。');
  process.exit(0);
}

step('① 探活', `ssh ${HOST}`);
const alive = ssh(['cmd /c "echo READY"']);
if (alive.status !== 0 || !alive.out.includes('READY')) fail('① 探活', `连不上 ${HOST}`, alive.out);

step('② 工具链', 'DevEco / ohpm / hvigorw 在不在');
const tool = ssh([`powershell -NoProfile -Command "if (Test-Path '${NODE_EXE}') { 'NODE_OK' } else { 'NODE_MISSING' }"`]);
if (!tool.out.includes('NODE_OK')) fail('② 工具链', `那台上没有 ${NODE_EXE}`, tool.out);
console.log(`   DevEco 在：${DEVECO}`);

step('③ 推脚本', REMOTE_SCRIPT);
const push = spawnSync('scp', ['-o', 'BatchMode=yes', RUNNER, `${HOST}:${REMOTE_SCRIPT.replaceAll('\\', '/')}`], { encoding: 'utf8' });
if (push.status !== 0) fail('③ 推脚本', 'scp 失败', `${push.stdout}${push.stderr}`);
console.log(`   已推（${readFileSync(RUNNER).length} 字节）`);

step('④ 跑探针', '内部会自己打印 OK / BAD 行');
const run = ssh([`"${NODE_EXE}" ${REMOTE_SCRIPT}`]);
console.log(run.out.trimEnd());

step('⑤ 判据', '按 OK/BAD 行计数，不猜退出码');
const oks = (run.out.match(/^OK {3}/gm) || []).length;
const bads = (run.out.match(/^BAD {2}/gm) || []).length;
console.log(`   OK ${oks} 条，BAD ${bads} 条`);
if (run.status !== 0 || bads > 0) fail('⑤ 判据', `${bads} 条断言红了（HEAD ${head}）`, '看上面 BAD 行');
if (oks === 0) fail('⑤ 判据', '一条 OK 都没有 —— 这不是"通过"，是探针没跑到', run.out);

if (PULL) {
  step('⑥ 拉回', 'dist/harmony/');
  const hapLine = (run.out.match(/^HAP (.+)$/m) || [])[1];
  if (hapLine === undefined) fail('⑥ 拉回', '输出里没有 HAP 路径行', run.out);
  const target = join(repoRoot, 'dist/harmony');
  mkdirSync(target, { recursive: true });
  const scp = spawnSync('scp', ['-o', 'BatchMode=yes', `${HOST}:${hapLine.trim().replaceAll('\\', '/')}`,
    join(target, 'rnoh-js-release.hap')], { encoding: 'utf8' });
  if (scp.status !== 0) fail('⑥ 拉回', 'scp 失败', `${scp.stdout}${scp.stderr}`);
  console.log(`   已拉回 ${join(target, 'rnoh-js-release.hap')}`);
}

console.log(`\n✅ 鸿蒙 JS 侧全链路通过（${HOST}，HEAD ${head}）${PULL ? '，HAP 已拉回' : '，HAP 留在远端'}`);
