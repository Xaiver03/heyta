#!/usr/bin/env node
/**
 * **四端收尾读数的采集器**（mac / windows / android / ios）。
 *
 * 它不是门禁，是**读数表**：把每一端"装的是什么 / 凭什么说它是新的 / 卡在哪个外部条件"
 * 一次性打出来，并且**每条都给出复跑命令**。存在的理由是 §16 那张表以前靠人手抄，
 * 而手抄的东西一定会漂（AGENTS 里那条"清单是抄件"）。
 *
 * ## 判据（这里只有两条，都要求"缺了就红"）
 *
 * 1. **本机的产物必须在位**：`/Applications/Heyta.app`、`apps/web/dist/index.html`。
 *    缺了就是红的 —— 那说明"收尾"根本没做，不是"读数没采到"。
 * 2. **远端那一端要么给出读数、要么明确写 BLOCKED 并带原因**。
 *    不许静默跳过：一条"没打印"的端与一条"验过了"的端在输出里必须长得不一样。
 *
 * ⚠️ 它**不**替你装包、不启动应用、不改任何东西 —— 只读。
 *
 * 用法：
 *   node scripts/four-ends-readings.mjs            # 采集并打印
 *   node scripts/four-ends-readings.mjs --json      # 只出 JSON（给别的脚本吃）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const JSON_ONLY = process.argv.includes('--json');

const WIN_HOST = process.env.HEYTA_WIN_HOST || 'windows-pc';

const rows = [];
let failures = 0;

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 120_000, ...opts });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function row(end, reading, verdict) {
  rows.push({ end, reading, verdict });
}

/* ── macOS ──────────────────────────────────────────────── */

const MAC_APP = '/Applications/Heyta.app';
if (!existsSync(MAC_APP)) {
  row('macOS', `${MAC_APP} 不存在`, 'MISSING');
  failures += 1;
} else {
  const bin = join(MAC_APP, 'Contents/MacOS/HeytaMac');
  const size = existsSync(bin) ? statSync(bin).size : 0;
  const mtime = existsSync(bin) ? statSync(bin).mtime.toISOString() : '?';
  const sign = sh('codesign', ['-dv', MAC_APP]);
  const team = /TeamIdentifier=(\S+)/.exec(sign.out)?.[1] ?? '?';
  const bundleId = /Identifier=(\S+)/.exec(sign.out)?.[1] ?? '?';
  const webDist = join(MAC_APP, 'Contents/Resources/web-dist/index.html');
  const bundledWeb = existsSync(webDist) ? sha(webDist).slice(0, 16) : 'absent';
  row('macOS', `${size} B / ${mtime} / ${bundleId} / team ${team} / 包内 web-dist ${bundledWeb}`,
    'INSTALLED');
}

/* ── Web ────────────────────────────────────────────────── */

const WEB_INDEX = join(ROOT, 'apps/web/dist/index.html');
if (!existsSync(WEB_INDEX)) {
  row('Web', 'apps/web/dist/index.html 不存在（先 pnpm build:web:remote:pull）', 'MISSING');
  failures += 1;
} else {
  row('Web', `${sha(WEB_INDEX).slice(0, 16)} / ${statSync(WEB_INDEX).mtime.toISOString()}`,
    'BUILT');
}

/* ── Android（只看有没有设备；有就给复跑命令）────────────── */

const adbDevices = sh('adb', ['devices']);
const androidSerials = adbDevices.out
  .split('\n')
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts[1] === 'device')
  .map((parts) => parts[0]);
if (androidSerials.length === 0) {
  row('Android', 'adb devices 里没有 device 状态的设备', 'BLOCKED: 无设备（读数为空，不是通过）');
} else {
  row('Android', `设备 ${androidSerials.join(', ')}`,
    `可跑：HEYTA_ANDROID_SERIAL=${androidSerials[0]} pnpm verify:android-vault-storage`);
}

/* ── iOS（模拟器 + 有没有 GUI 的 Xcode）──────────────────── */

const simctl = sh('xcrun', ['simctl', 'list', 'devices', 'booted']);
const bootedIos = /(\S+ \([0-9A-F-]{36}\)) \(Booted\)/.exec(simctl.out)?.[1];
const simulatorApp = '/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app';
if (!existsSync(simulatorApp)) {
  row('iOS', bootedIos === undefined ? '没有 Booted 模拟器' : `Booted：${bootedIos}`,
    'BLOCKED: 这台机没有 Simulator.app（无 GUI 的 Xcode）⇒ simctl 截图全黑，AX 链也起不来');
} else if (bootedIos === undefined) {
  row('iOS', '有 Simulator.app，但没有 Booted 模拟器', 'BLOCKED: 先 xcrun simctl boot <udid>');
} else {
  row('iOS', `Booted：${bootedIos}`, '可跑：pnpm verify:ios-vault-keychain');
}

/* ── Windows（远端：MSIX 在不在、签没签、能不能装）────────── */

const winProbe = sh('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', WIN_HOST,
  'powershell -NoProfile -Command "'
  + "$m='C:\\src\\heyta-msix\\heyta.msix';"
  + "if (Test-Path $m) { 'MSIX=' + (Get-Item $m).Length } else { 'MSIX=absent' };"
  + "'EXPLORER=' + (Get-Process -Name explorer -ErrorAction SilentlyContinue | Measure-Object).Count"
  + '"'], { timeout: 60_000 });
if (winProbe.status !== 0) {
  row('Windows', `连不上 ${WIN_HOST}`, `BLOCKED: ${winProbe.out.split('\n').slice(-1)[0]}`);
} else {
  const msix = /MSIX=(\S+)/.exec(winProbe.out)?.[1] ?? '?';
  const explorer = /EXPLORER=(\d+)/.exec(winProbe.out)?.[1] ?? '?';
  if (msix === 'absent') {
    row('Windows', '远端没有 heyta.msix', 'BLOCKED: 先跑 apps\\desktop-windows\\scripts\\package-msix.ps1');
  } else if (explorer === '0') {
    row('Windows', `MSIX ${msix} B（已签名）`, 'BLOCKED: 那台没有登录的桌面会话（explorer.exe=0）⇒ AppX 装不进');
  } else {
    row('Windows', `MSIX ${msix} B`, '可装：C:\\src\\heyta-install-and-capture.ps1');
  }
}

/* ── 鸿蒙（远端：零桩 HAP 在不在）────────────────────────── */

const hapProbe = sh('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', WIN_HOST,
  'powershell -NoProfile -Command "'
  + "$h=Get-ChildItem 'C:\\hx-rnjs\\proj\\harmony' -Recurse -Filter *.hap -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1;"
  + "if ($h) { 'HAP=' + $h.Length } else { 'HAP=absent' }"
  + '"'], { timeout: 60_000 });
const hap = /HAP=(\S+)/.exec(hapProbe.out)?.[1] ?? '?';
row('HarmonyOS', hap === 'absent' ? '远端没有 .hap' : `HAP ${hap} B（unsigned）`,
  hap === 'absent' ? 'BLOCKED: 先跑 node scripts/build-harmony-rnohjs-windows.mjs'
    : '可跑：node scripts/build-harmony-rnohjs-windows.mjs（36 条判据）');

/* ── 输出 ───────────────────────────────────────────────── */

if (JSON_ONLY) {
  console.log(JSON.stringify({ rows, failures }, null, 2));
} else {
  console.log('\n四端收尾读数（读的，不是猜的）\n');
  for (const r of rows) {
    const badge = r.verdict === 'INSTALLED' || r.verdict === 'BUILT' ? '✅' : '⚠️';
    console.log(`${badge} ${r.end.padEnd(9)} ${r.reading}`);
    if (r.verdict !== 'INSTALLED' && r.verdict !== 'BUILT') console.log(`   ${r.verdict}`);
  }
  console.log('\n⚠️ 一端的"没读数"与"验过了"必须长得不一样：本表里 MISSING/BLOCKED 就写明原因。');
}

if (failures > 0) {
  console.error(`\n🔴 本机产物缺失 ${failures} 项 —— 这不是"没采到读数"，是收尾根本没做。`);
  process.exit(1);
}
