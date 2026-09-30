#!/usr/bin/env node
/**
 * Windows 桌面壳里的认证旅程验收：注册 → 登录 → 同步 → 新设备恢复 → 退出登录
 * ==========================================================================
 *
 * 被测对象是 **Windows 机器（默认 `windows-pc`）上真壳里的真应用**：
 * `apps/desktop-windows` 的 WinUI 3 壳，WebView2 里加载 `apps/web/dist`。
 * Playwright **不启动任何浏览器** —— 它经 CDP 附着到那个 WebView2 上。
 *
 * 它关的是 `scripts/check-journey-coverage.mjs` 里 **windows 那一格**的缺口：
 * 「注册/登录之后的链路」。在此之前那一格登记的是"需要 SSH 到 windows-pc，
 * 没有接进 pnpm check 链路"。
 *
 * 用法：
 *   pnpm verify:windows-auth
 *
 * ## 它一共做了 8 件事（每一步失败都当场报，不往下走）
 *
 * 1. 端口体检：CDP 隧道要用的**本机**端口必须空着；
 * 2. 起真服务端（本机 Postgres，TEST_MODE，WebAuthn 三元组按 `heyta.local` 配）；
 * 3. 同步当前工作树 → `C:\src\heyta`，并用 sha256 对账**远端 = 本地现在**；
 * 4. 开两条 SSH 隧道：
 *    - `-L 127.0.0.1:<cdp> → Windows 127.0.0.1:<cdp>`（Playwright 附着用）
 *    - `-R 127.0.0.1:3211 → 本机 127.0.0.1:3211`（**反向**：让壳里的应用够得到服务端）
 * 5. 在 Windows 上发布壳，并**投进交互式桌面会话**启动它（SSH 会话里起不了 GUI）；
 * 6. 确认 CDP 上有 `https://heyta.local/` 的页面目标；
 * 7. 跑 `e2e/windows-shell/`（每个旅程前重置"设备"，截图落固定路径）；
 * 8. 把截图收进 `apps/desktop-windows/evidence/journey/`，并**如实报告边界**。
 *
 * ## 🔴 为什么服务端要经**反向**隧道放在 Windows 的 loopback 上
 *
 * 壳里的应用跑在 `https://heyta.local`。它去连 `http://<Mac 的 ZeroTier IP>:3211`
 * 会被浏览器按**混内容**直接拦掉（2026-09-30 实测：
 * `Mixed Content: The page at 'https://heyta.local/index.html' ... has been blocked`）。
 * 而 `http://127.0.0.1:<port>` 被 Chromium 视为**可信来源**，不算混内容。
 * ⇒ 所以把服务端反向映射到 Windows 的 loopback，应用填的地址就是
 * `http://127.0.0.1:3211`。**这个字符串在两侧都成立**：在 Mac 上是本机服务端，
 * 在 Windows 上是那条反向隧道 —— 用例里的服务端地址因此可以只有一份。
 *
 * ## 🔴 为什么本机端口要先体检
 *
 * 2026-09-30 实测：探针选了 9223，而**本机 Chrome 正好也监听 9223**（用户自己的
 * 浏览器，24 个标签页）。`connectOverCDP` 连上去一切"正常"，测的却是别人的界面。
 * 隧道那侧还会更隐蔽：`-L` 在 IPv4 被占时会**退到 IPv6**，于是
 * `127.0.0.1:<port>` 落到本机 Chrome、`[::1]:<port>` 才到 Windows。
 * ⇒ 端口体检 + 套件里的身份闸门（`assertCdpIsOurShell`）两道都要有。
 */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  databaseUrlFor,
  ensureDatabase,
  ensureServerBuilt,
  installCleanup,
  resolveNode,
  startServer,
} from './lib/auth-journey-server.mjs';

const NODE = resolveNode();
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const WIN_HOST = process.env['HEYTA_WIN_HOST'] ?? 'windows-pc';
const CDP_PORT = Number(process.env['HEYTA_WIN_CDP_PORT'] ?? '9287');
const SERVER_PORT = Number(process.env['HEYTA_AUTH_JOURNEY_PORT'] ?? '3211');
/**
 * 🔴 壳里应用的 **origin** —— 也是 WebAuthn 的 rpId 来源。
 * 它与服务端地址是两件事：服务端在 `http://127.0.0.1:<port>`（见文件头）。
 */
const SHELL_ORIGIN = 'https://heyta.local';

const DB_NAME = process.env['HEYTA_VERIFY_DB_NAME'] ?? 'heyta_web_auth_smoke';
const DB_URL = databaseUrlFor(DB_NAME);

const EVIDENCE_DIR = `${ROOT}apps/desktop-windows/evidence/journey`;
const PLAYWRIGHT_RESULTS = `${ROOT}e2e/test-results`;

const CDP_URL = `http://127.0.0.1:${String(CDP_PORT)}`;
const SERVER_URL = `http://127.0.0.1:${String(SERVER_PORT)}`;

let failed = false;
function step(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 64 - title.length))}`);
}
function die(msg, detail) {
  console.error(`\n❌ ${msg}`);
  if (detail !== undefined && detail !== '') console.error(detail.trim().slice(-1500));
  failed = true;
}

/** SSH 的 stderr 里混着 post-quantum 告警，别让它污染判读。 */
const SSH_NOISE = /post-quantum|store now|openssh\.com|may need to be upgraded|CLIXML/i;
function ssh(args, { capture = true } = {}) {
  const r = spawnSync('ssh', ['-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', ...args], {
    encoding: 'utf8',
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => !SSH_NOISE.test(l))
    .join('\n');
  return { ok: r.status === 0, out, status: r.status };
}

function localListenersOn(port) {
  const r = spawnSync('lsof', ['-nP', `-i:${String(port)}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return (r.stdout ?? '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
}

/* ══ 3b. 共享 UI 产物 ═════════════════════════════════════════════════ */
/**
 * 从当前源码**重打** `apps/web/dist`。
 *
 * 🔴 为什么必须重打，而不是用现成的：2026-09-30 实测踩到 —— `apps/web/dist`
 * 里躺着一份**别的会话留下的实验产物**：`index.html` 引的是
 * `/app/assets/...`，而文件在 dist **根**下，于是壳里页面一片空白
 * （`ERR_FILE_NOT_FOUND`），6 条用例全部卡在"等输入框"。
 *
 * 更值得记的是**为什么它没被挡住**：第 6 步的 sha256 对账比的是
 * **本地 vs 远端** —— 而两边是**同一份错的产物**，所以对账"通过"。
 * 一致性判据挡不住"一致地错"。⇒ 所以这里加两条**自洽**判据（见下），
 * 并把"重打"变成固定动作（与 §6.1.1「清旧包 → 重打」同一条纪律）。
 */
function buildWebDist() {
  if (process.env['HEYTA_SKIP_WEB_BUILD'] === '1') {
    console.log('  ⚠️ HEYTA_SKIP_WEB_BUILD=1：跳过重打（迭代时用，正式跑不要用）');
    return;
  }
  const built = spawnSync('pnpm', ['--filter', '@heyta/web', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (built.status !== 0) {
    die('共享 UI 产物构建失败。', `${built.stdout ?? ''}${built.stderr ?? ''}`);
    process.exit(1);
  }
  console.log('  ✅ apps/web/dist 已从当前源码重打');
}

/**
 * 自洽判据：`index.html` 引用的**本地**资源必须真的在产物里。
 *
 * 它挡的正是上面那种"产物内部自相矛盾"（前缀不对、忘了拷 public/）。
 * 只校验 `index.html` —— 它引用的入口 JS / CSS 是整棵树的根，
 * 根错了，后面全错；而递归解析整张依赖图是构建期的事，不该在这里重做。
 */
function assertWebDistCoherent() {
  const dist = `${ROOT}apps/web/dist`;
  const indexPath = `${dist}/index.html`;
  if (!existsSync(indexPath)) {
    die(`找不到 ${indexPath} —— 共享 UI 产物不存在。`);
    process.exit(1);
  }
  const html = readFileSync(indexPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    // 只看站内绝对路径：外链、data:、协议相对一律不管。
    .filter((u) => u.startsWith('/') && !u.startsWith('//'));

  if (refs.length === 0) {
    die('index.html 里一个本地资源引用都没有 —— 这不是一份可用的产物。');
    process.exit(1);
  }
  const broken = refs.filter((u) => !existsSync(`${dist}${u}`));
  if (broken.length > 0) {
    die(
      '共享 UI 产物**自相矛盾**：index.html 引用的本地资源在产物里不存在。',
      `缺失：\n  ${broken.join('\n  ')}\n\n` +
        '  实测成因（2026-09-30）：产物是用 `--base=/app/` 打的（引 `/app/assets/...`），\n' +
        '  而文件在 dist 根下。壳按 `https://heyta.local/index.html` 加载它，于是\n' +
        '  页面 ERR_FILE_NOT_FOUND、整片空白 —— 而"本地 vs 远端"的 sha256 对账\n' +
        '  照样通过（两边是同一份错的产物）。一致性挡不住"一致地错"。',
    );
    process.exit(1);
  }
  console.log(`  ✅ 产物自洽：index.html 的 ${String(refs.length)} 个本地引用全部存在`);
}

/* ══ 1. 端口体检 ═══════════════════════════════════════════════════════ */
step('1. 本机端口体检（CDP 隧道端口必须空着）');
for (const port of [CDP_PORT, SERVER_PORT]) {
  const listeners = localListenersOn(port);
  if (listeners.length > 0) {
    die(
      `本机端口 ${String(port)} 已被占用 —— 拒绝继续。`,
      listeners.join('\n') +
        '\n\n  2026-09-30 实测过这个坑：本机 Chrome 占着 9223，CDP 探针连上去"一切正常"，\n' +
        '  而测的是用户自己的浏览器。换个端口（HEYTA_WIN_CDP_PORT / HEYTA_AUTH_JOURNEY_PORT）。',
    );
  }
}
console.log(`  ✅ ${String(CDP_PORT)} / ${String(SERVER_PORT)} 在本机都空着`);

/* ══ 2. Windows 可达性 ═════════════════════════════════════════════════ */
step('2. Windows 主机可达性');
const ping = ssh([WIN_HOST, 'echo BACK']);
if (!ping.out.includes('BACK')) {
  console.log('❌ Windows 主机不可达 —— 这是**环境**原因，如实报告，不硬装不降级。');
  console.log(`   host=${WIN_HOST}\n${ping.out.trim()}`);
  process.exit(1);
}
console.log(`  ✅ ${WIN_HOST} 可达`);

/* ══ 3. 服务端（先起，隧道随后挂上） ═══════════════════════════════════ */
step('3. 真服务端（TEST_MODE + WebAuthn 按壳的 origin 配）');
console.log(`· node: ${NODE}`);
console.log(`· 数据库: ${DB_NAME}`);
console.log(`· 服务端: ${SERVER_URL}   壳内应用 origin: ${SHELL_ORIGIN}`);
ensureDatabase({ root: ROOT, dbUrl: DB_URL, dbName: DB_NAME });
ensureServerBuilt({ root: ROOT, dbUrl: DB_URL });

const server = await startServer({
  root: ROOT,
  node: NODE,
  port: SERVER_PORT,
  dbUrl: DB_URL,
  // 🔴 壳里应用的 origin 是 `https://heyta.local` —— 不放行它，注册请求会在预检
  //    被拦掉，界面报"连不上服务端"而服务端日志一片干净。
  corsOrigins: [SHELL_ORIGIN],
  // 🔴 WebAuthn 三元组必须与**应用 origin** 逐字一致。这里是 `heyta.local`
  //    （虚拟主机名，不是 IP 字面量 —— Chromium 拒收 IP 字面量做 RP ID）。
  rpId: 'heyta.local',
  origin: SHELL_ORIGIN,
});

/* ══ 4. 共享 UI 产物 ═══════════════════════════════════════════════════ */
step('4. 重打共享 UI 产物（apps/web/dist），并断言它自洽');
buildWebDist();
assertWebDistCoherent();

/* ══ 5. SSH 隧道 ═══════════════════════════════════════════════════════ */
step('5. SSH 隧道（CDP 正向 + 服务端反向）');
/** 反向隧道：Windows 的 127.0.0.1:3211 → 本机服务端。应用就填这个地址。 */
const reverse = spawn(
  'ssh',
  [
    '-o', 'ConnectTimeout=15',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-N',
    '-R', `127.0.0.1:${String(SERVER_PORT)}:127.0.0.1:${String(SERVER_PORT)}`,
    WIN_HOST,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
/** 正向隧道：本机 127.0.0.1:<cdp> → Windows 的 CDP 端点。显式绑 127.0.0.1，别退到 IPv6。 */
const forward = spawn(
  'ssh',
  [
    '-o', 'ConnectTimeout=15',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-N',
    '-L', `127.0.0.1:${String(CDP_PORT)}:127.0.0.1:${String(CDP_PORT)}`,
    WIN_HOST,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let reverseErr = '';
let forwardErr = '';
reverse.stderr.on('data', (d) => (reverseErr += d.toString()));
forward.stderr.on('data', (d) => (forwardErr += d.toString()));

installCleanup([
  server,
  { stop: () => forward.kill('SIGTERM') },
  { stop: () => reverse.kill('SIGTERM') },
]);

await new Promise((r) => setTimeout(r, 3000));
if (forward.exitCode !== null) {
  die('CDP 隧道没建起来（本机端口被占？）。', forwardErr);
}
console.log('  ✅ 两条隧道已发起（下一步启动壳之后再验它们真的通）');

/* ══ 6. 同步源码 ═══════════════════════════════════════════════════════ */
step('6. 同步当前工作树 → 远端（含 sha256 新鲜度对账）');
/**
 * 🔴 对**瞬时网络**做有限重试，对**确定性判断**不重试。
 *
 * 远端是 ZeroTier 上的机器，实测会中途掉线（`No route to host` / `lost connection`），
 * 那是环境抖动，重试一次就好。而"新鲜度对不上"是**确定性**结论 ——
 * 重试只会把一条明确的红拖成三倍时长，还会让人以为它不稳定。
 */
let syncOk = false;
for (let attempt = 1; attempt <= 3 && !syncOk; attempt += 1) {
  const sync = spawnSync(
    'bash',
    ['-c', `source scripts/lib/sync-windows-sources.sh && sync_windows_sources ${WIN_HOST}`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const out = `${sync.stdout ?? ''}${sync.stderr ?? ''}`;
  process.stdout.write(out);
  if (sync.status === 0) {
    syncOk = true;
    break;
  }
  if (out.includes('不新鲜')) {
    die('远端源码与本地**对不上** —— 确定性判断，不重试。');
    break;
  }
  if (attempt < 3) {
    console.log(`  ⚠️ 第 ${attempt} 次同步失败 —— 按**瞬时网络**重试（远端会掉线）`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
if (!syncOk) {
  die('源码同步/新鲜度对账失败 —— **不打包**（宁可不跑，也不测旧产物）。');
  process.exit(1);
}

/* ══ 7. 发布 + 在交互式会话里启动壳 ════════════════════════════════════ */
step('7. 在 Windows 上发布壳，并投进交互式桌面会话启动（开 CDP 端口）');
const push = spawnSync(
  'scp',
  ['-q', 'scripts/windows/launch-winui-shell-cdp.ps1', `${WIN_HOST}:C:/src/heyta-launch-winui-shell-cdp.ps1`],
  { cwd: ROOT, encoding: 'utf8' },
);
if (push.status !== 0) {
  die('启动脚本送不过去。');
  process.exit(1);
}
console.log('· 远端：dotnet publish → 补 XAML 资源 → 装 web-dist → schtasks 启动（可能要几分钟）');
const launch = ssh([
  WIN_HOST,
  `powershell -NoProfile -ExecutionPolicy Bypass -File C:/src/heyta-launch-winui-shell-cdp.ps1 -CdpPort ${String(CDP_PORT)}`,
]);
console.log(launch.out.trim().split('\n').map((l) => `  ${l}`).join('\n'));
if (!launch.out.includes('RESULT=OK')) {
  die('壳没能带上 `https://heyta.local` 的页面目标起来。', launch.out);
  process.exit(1);
}

/* ══ 8. 确认隧道真的通到壳 ═════════════════════════════════════════════ */
step('8. 确认本机经隧道看得到壳的 CDP');
let cdpVersion = null;
for (let i = 0; i < 20; i += 1) {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    if (res.ok) {
      cdpVersion = await res.json();
      break;
    }
  } catch {
    // 隧道还没热
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (cdpVersion === null) {
  die(
    `隧道没把壳的 CDP 端点带过来（${CDP_URL}/json/version 不通）。`,
    forwardErr,
  );
  process.exit(1);
}
console.log(`  ✅ CDP 通了：Browser=${String(cdpVersion.Browser)}`);
console.log('  （**身份**判据不在这里做 —— 它只有一处，在套件的 assertCdpIsOurShell 里）');

/* ══ 9. 跑套件 ═════════════════════════════════════════════════════════ */
step('9. Playwright：附着到壳里的 WebView2，走 6 条旅程');
console.log('· 每个旅程前重置"设备"（清 origin 全部存储 + 重载，并断言无本地数据留底）');
const test = spawn(
  'pnpm',
  ['--dir', 'e2e', 'exec', 'playwright', 'test', '--config=playwright.windows-shell.config.ts'],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      HEYTA_NODE: NODE,
      HEYTA_WIN_CDP: CDP_URL,
      HEYTA_AUTH_JOURNEY_SERVER: SERVER_URL,
    },
    stdio: 'inherit',
  },
);
const code = await new Promise((resolve) => test.on('exit', resolve));

/* ══ 10. 收证据 ═════════════════════════════════════════════════════════ */
step('10. 收证据');
mkdirSync(EVIDENCE_DIR, { recursive: true });
let copied = 0;
if (existsSync(PLAYWRIGHT_RESULTS)) {
  for (const f of readdirSync(PLAYWRIGHT_RESULTS)) {
    if (/^windows-shell-.*\.png$/.test(f)) {
      copyFileSync(`${PLAYWRIGHT_RESULTS}/${f}`, `${EVIDENCE_DIR}/${f}`);
      copied += 1;
    }
  }
}
console.log(`· 截图 ${String(copied)} 张 → apps/desktop-windows/evidence/journey/`);
if (copied === 0) console.log('  ⚠️ 一张截图都没有 —— 说明套件没跑到落图那一步，别把"没证据"当成"没问题"');

server.stop();
forward.kill('SIGTERM');
reverse.kill('SIGTERM');

console.log('');
if (code === 0 && !failed) {
  console.log('✅ Windows 壳认证旅程验收通过：注册 → 登录 → 同步 → 新设备恢复 → 退出登录');
  console.log('   ⚠️ 壳**仍在 Windows 上开着**（它是常驻应用，本脚本不替你关）。');
  console.log('      要关：ssh windows-pc "powershell -NoProfile -Command \\"Get-Process HeytaWindows | Stop-Process -Force\\""');
  console.log('   ⚠️ 已知边界：壳里真应用的数据落在 **WebView2 自己的 IndexedDB**，');
  console.log('      不在壳的 SQLite 里（M2-D 的已知边界）—— 本验收不声称后者。');
} else {
  console.log('❌ Windows 壳认证旅程验收失败。');
  console.log(`   截图（若有）：apps/desktop-windows/evidence/journey/`);
  console.log('   服务端日志尾部：');
  console.log(server.log().split('\n').slice(-15).join('\n'));
}
process.exit(code === 0 && !failed ? 0 : 1);
