/**
 * 门禁：**Linux 原生壳的跨语言那一层**。
 *
 * 与 `check-windows-shell.mjs` / `check-macos-shell.mjs` 同构：
 * 打包 TS 门面 → 编译 → 跑那个平台上的无头冒烟。
 * **三个壳加载的是同一个 bundle** ⇒ 顺带证明了"一份产物、多个原生壳"。
 *
 * ⚠️ 如实标注的两条边界：
 *   · 非 Linux → **显式报告"已跳过"**（GTK4 / libjavascriptcoregtk 在 macOS/Windows 上装不上）；
 *   · 窗口那一档（④）在**没有 X 的服务器上未取证**（响亮地报"未取证"，不是静默通过），
 *     无头冒烟（③）则刻意不依赖任何显示 —— 那一枚在没有 X 的 CI 上也要能跑。
 *     这一条是刻意分开的：把两件事并成一档，就会变成"没有 X 的机器上连 C↔TS 都不验"。
 *
 * 🔴 严格档 `HEYTA_REQUIRE_LINUX_SHELL=1`：跳过一律变红。
 *   理由是一条实测出来的形状：这条门禁**在任何载体上都没有真正执行过** ——
 *   macOS 上走平台分支跳过，而 `gate-ssh` 那枚 alpine 载体上 `pkg-config` 缺 gtk4
 *   也走跳过分支，两边都 `exit 0`。于是"Linux 壳的 C ↔ TS 那一层"长期是一枚
 *   **永远不会失败的判据**（AGENTS §7 元规则 2：那比没有判据更糟）。
 *   严格档给"在真 Linux 载体上跑"一个能红的开关，默认不变、不打死别的平台。
 *   用法见 docs/runbooks/linux-dev-box.md。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredModules } from './linux/shell-modules.mjs';
import { countBrandBlue, inspectPng, looksBlank } from './screenshots/png-stats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'apps/desktop-linux');
const BUNDLE_SCRIPT = join(ROOT, 'packages/app-host/scripts/build-native-bridge.mjs');
const BUNDLE = join(ROOT, 'packages/app-host/bridge-bundle/native-bridge.js');

/** 严格档：把"跳过"折成红。默认关 —— 打开它的必须是真 Linux 载体（见文件头）。 */
const REQUIRED = process.env.HEYTA_REQUIRE_LINUX_SHELL !== undefined;

// ⓪ 原生系统库登记对账。**放在所有平台分支之前**：它读的是提交物文本（.deb 的 Depends
// 与登记册），不需要 GTK、不需要 Linux，所以它在 mac / CI 载体上都必须执行。
// 放在跳过分支之后就会变成又一枚"只在某台机上跑"的判据 —— 而那正是本文件头记录的那格失效。
const REGISTRY_CHECK = join(ROOT, 'research/tools/check-native-lib-registry.mjs');
const reg = spawnSync(process.execPath, [REGISTRY_CHECK], { stdio: 'inherit', cwd: ROOT });
if (reg.error || reg.status !== 0) {
  console.error('❌ 原生系统库许可登记对账不通过（见上）。');
  process.exit(reg.status ?? 1);
}

// ⓪b shell 里 host-specific 工具的债务账本对账。**同一条放置理由**：一枚"Linux 可移植性"判据
// 如果只在 Linux 上跑，那它在 mac 上写错的那一天不会响 —— 而 BSD-only 工具（`md5 -q`）
// 的症状恰好就是"在 mac 上一切正常"。它读的是提交物文本，不需要 GTK，也不需要 Linux。
const PORTABILITY_CHECK = join(ROOT, 'research/tools/check-shell-portability.mjs');
const port = spawnSync(process.execPath, [PORTABILITY_CHECK], { stdio: 'inherit', cwd: ROOT });
if (port.error || port.status !== 0) {
  console.error('❌ shell 可移植性对账不通过（见上）。');
  process.exit(port.status ?? 1);
}

if (process.platform !== 'linux') {
  if (REQUIRED) {
    console.error(
      `❌ 要求验 Linux 原生壳（HEYTA_REQUIRE_LINUX_SHELL），但当前平台是 ${process.platform}。` +
        `\n    ⇒ 载体选错了：这一档必须在 Linux 上跑，跳过不许被当成通过。`,
    );
    process.exit(1);
  }
  console.log(`⚠️  当前平台是 ${process.platform} —— Linux 原生壳的冒烟**已跳过**。`);
  console.log('    （本壳依赖 GTK4 / JavaScriptCoreGTK / SQLite / WebKitGTK 6.0，装不到 macOS/Windows 上。）');
  process.exit(0);
}

const hasPkgConfig = (name) => {
  try {
    execFileSync('pkg-config', ['--exists', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const hasCommand = (name, args = ['--version']) => {
  try {
    execFileSync(name, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const NOT_VERIFIED = '    ⇒ C ↔ TS 那一层这一轮**没有被验过**，不要当成"壳已经能跑"。';

const REQUIRED_PKGS = (() => {
  // 🔴 清单不写在本文字面量里：编译用的是 `apps/desktop-linux/Makefile` 的 `PKGS`，
  //    检查的必须是**同一份**（改之前这里是三个地方各抄一遍，见 scripts/linux/shell-modules.mjs 文件头）。
  //    P2 给壳加 WebKitGTK 之后，这枚门禁才会跟着检查它 —— 而不是继续报"缺 gtk4/JSC/sqlite3"。
  try {
    return requiredModules(ROOT);
  } catch {
    console.error('❌ 读不到 Linux 壳的依赖清单（上面已点名是哪一个锚点对不上）⇒ 这一轮不验，也不放行。');
    console.error(NOT_VERIFIED);
    process.exit(1);
  }
})();

const REMEDY =
  `    sudo bash scripts/linux/setup-build-host.sh --step gtk   # 装的就是点名的这些 -dev 包\n` +
  '    清单同源，可自查：node scripts/linux/shell-modules.mjs --pairs';

if (!hasCommand('pkg-config')) {
  // 单独报这一格：否则下面逐枚 --exists 全失败，读数会伪装成"这些开发包都缺"，
  // 而真实缺的只是那个查询工具本身。
  const line = `机器上没有 \`pkg-config\` 这个工具，无法判断 ${REQUIRED_PKGS.join(' / ')} 的 -dev 包是否就位`;
  if (REQUIRED) {
    console.error(`❌ 要求验 Linux 原生壳（HEYTA_REQUIRE_LINUX_SHELL），但${line} ⇒ 严格档判红。\n${REMEDY}`);
    process.exit(1);
  }
  console.log(`⚠️  ${line} —— Linux 原生壳的冒烟**已跳过**。\n${NOT_VERIFIED}\n${REMEDY}`);
  process.exit(0);
}

// 全部缺的都点名（不是只报第一个）：一台新载体上通常一次缺好几枚。
const missing = REQUIRED_PKGS.filter((pkg) => !hasPkgConfig(pkg));
if (missing.length > 0) {
  const line = `缺少 ${missing.map((p) => `\`${p}\``).join(' / ')} 的 pkg-config 条目`;
  if (REQUIRED) {
    console.error(`❌ 要求验 Linux 原生壳（HEYTA_REQUIRE_LINUX_SHELL），但${line} ⇒ 严格档判红。\n${REMEDY}`);
    process.exit(1);
  }
  console.log(`⚠️  ${line} —— Linux 原生壳的冒烟**已跳过**。\n${NOT_VERIFIED}\n${REMEDY}`);
  process.exit(0);
}

// ① 打包门面（三个壳的门禁共用同一个脚本与产物）
const bundled = spawnSync(process.execPath, [BUNDLE_SCRIPT], { stdio: 'inherit', cwd: ROOT });
if (bundled.error || bundled.status !== 0) {
  console.error('❌ 打包 TS 门面失败');
  process.exit(bundled.status ?? 1);
}
if (!existsSync(BUNDLE)) {
  console.error(`❌ 打包脚本跑完了但产物不存在：${BUNDLE}`);
  process.exit(1);
}

// ② 编译（-Werror：警告即失败，与仓库其它端一致）
//
// 🔴 这里编译的是**两枚**产物，不是只有冒烟那一枚。
//    以前只 `make heyta-smoke` ⇒ 窗口那一半（`heyta-linux`，含 M2 的 WebView 那一条）
//    在**任何**门禁里都没被编译过 —— 它坏了不会有任何东西变红，
//    而"壳门禁绿"会被读成"这个壳能用"。判据覆盖不到的那一格要自己说出来。
const build = spawnSync('make', [], { stdio: 'inherit', cwd: PACKAGE_DIR });
if (build.error || build.status !== 0) {
  console.error('❌ 编译 Linux 壳失败');
  process.exit(build.status ?? 1);
}
for (const bin of ['heyta-smoke', 'heyta-linux']) {
  const st = statSync(join(PACKAGE_DIR, bin), { throwIfNoEntry: false });
  if (!st) {
    console.error(`❌ make 退 0 但产物 ${bin} 不在 —— 这一枚从来没被编出来`);
    process.exit(1);
  }
  console.log(`✅ 编译产物：${bin}（${st.size} B）`);
}

// ③ 无头冒烟。跑**一次**：输出原样转给人看，同时读回它自报的条数。
// 🔴 rc=0 不够 —— 一条都没执行的冒烟照样退 0（AGENTS §7 元规则 2）。
//    条数由冒烟自己报（`HEYTA_LINUX_SMOKE=OK n/n`）；判据读这个数，不读文档里抄的数。
const smoke = spawnSync(join(PACKAGE_DIR, 'heyta-smoke'), [], {
  encoding: 'utf8',
  cwd: PACKAGE_DIR,
  env: { ...process.env, HEYTA_BRIDGE_BUNDLE: BUNDLE },
});
if (smoke.error) {
  console.error(`❌ 冒烟没能启动：${smoke.error.message}`);
  process.exit(1);
}
if (smoke.stdout) process.stdout.write(smoke.stdout);
if (smoke.stderr) process.stderr.write(smoke.stderr);
if ((smoke.status ?? 1) !== 0) process.exit(smoke.status ?? 1);

const m = /HEYTA_LINUX_SMOKE=OK (\d+)\/(\d+)/.exec(smoke.stdout ?? '');
if (!m) {
  console.error('❌ 冒烟退 0，但没有报出 HEYTA_LINUX_SMOKE=OK n/n —— 判据读不到条数，不放行。');
  process.exit(1);
}
if (Number(m[2]) === 0) {
  console.error('❌ 冒烟报出 0/0：一条断言都没有执行。这不是通过。');
  process.exit(1);
}
console.log(`✅ C ↔ TS 那一层真执行了 ${m[1]}/${m[2]} 条断言（这个数字由冒烟自报，不住文档里）。`);

/* ④ M2 那一半：壳里装的是不是"与其他端同一个 heyta"。
 *
 * 这一档以前**不存在**，于是"Linux 壳门禁绿"被读成"这个壳能用"，而窗口那一侧
 * 从来没被任何判据碰过。现在按 §6.2 规定一做：真起窗口、真截图、**先看像素再看断言**。
 *
 * 🔴 判据的**承重那一格不是像素**。实测（2026-10-07 03:3x，那台 Ubuntu）：
 *   共享 UI 的**启动屏**是一整块品牌蓝的 logo —— 主蓝命中 3858，
 *   而挂载完成之后那张是 3987。也就是说「非空白 + 主蓝命中」在这一端
 *   **分不开"卡在启动屏"与"应用真起来了"**（§7 第 82 条那一族的新一面）。
 *   真正区分它们的是页侧自己上报的事实：`M2_SETTLED_AFTER`（端口在、
 *   `backend=shell`、clientId 由库给出、`#root` 里真的有子节点）。
 *   像素那两条仍然要跑 —— 它们挡的是"结算行有了但画布是空的"那一类。
 *
 * ⚠️ 沙箱：这台载体上 `kernel.apparmor_restrict_unprivileged_userns=1` ⇒ bwrap 起不来，
 *   而 WebKit 的 dbus-proxy 起不来是**致命**的（`g_error` → SIGTRAP，rc=133）。
 *   所以默认档跑一次，若日志里出现 bwrap 那句就**明确改跑无沙箱档**并把用了哪一档打出来，
 *   不静默降级。产品用户跑在有 userns 的桌面上，与本档无关。
 */
const WEB_DIST = join(ROOT, 'apps/web/dist');
const SHELL_BIN = join(PACKAGE_DIR, 'heyta-linux');
const shotPath = join(tmpdir(), `heyta-linux-m2-${process.pid}.png`);

const unverified = (why) => {
  const line = `M2 窗口这一档**未取证**：${why}`;
  if (REQUIRED) {
    console.error(`❌ 要求验 Linux 壳的 M2（HEYTA_REQUIRE_LINUX_SHELL），但${why} ⇒ 严格档判红。`);
    process.exit(1);
  }
  console.log(`⚠️  ${line}`);
  console.log('    ⇒ 不要把它读成"M2 已经成立"。闭合条件见 docs/runbooks/linux-dev-box.md 的 §5.7。');
  process.exit(0);
};

if (!existsSync(join(WEB_DIST, 'index.html'))) {
  unverified('没有 `apps/web/dist/index.html`（先 `pnpm --filter @heyta/web build`）');
}
// ⚠️ 探它要用 `--help`：`xvfb-run --version` 在**装着**的机器上也回 rc=1
//    （"未识别的选项"，实测 07 03:4x），拿默认的 `--version` 探会把有的机器报成"没有"。
if (!hasCommand('xvfb-run', ['--help'])) {
  // 只要 xvfb-run，不要裸 Xvfb：后者要自己挑显示号、自己收尾，而"按名字 kill"会误伤
  // 别人正在用的显示。xvfb-run 自带分配与回收，是唯一不需要碰别人资源的那条路。
  unverified('机器上没有 xvfb-run（`--with-x11` 那一档：scripts/linux/provision-user-prefix.sh）');
}

/** 起一次窗口，返回 { rc, out, sandboxOff }。 */
function runShellOnce(sandboxOff) {
  const env = {
    ...process.env,
    HEYTA_BRIDGE_BUNDLE: BUNDLE,
    HEYTA_WEB_ROOT: WEB_DIST,
    HEYTA_LINUX_SNAPSHOT: shotPath,
    HEYTA_EXIT_AFTER_MS: '12000',
    // 取证跑法：页侧的 console / worker 失败也回收进日志（产品路径不注这一段）。
    HEYTA_WEB_PROBE: '1',
  };
  if (sandboxOff) env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS = '1';

  // ⚠️ 形状由 `xvfb-run --help` 现量得来：`-a` 自己挑空闲号（不去碰别人在用的 :0/:1/:1024），
  //    `-s` 才是给 Xvfb 的参数。第一版按记忆写成 `-f 1280x800x24 -n -exitval nowait` ——
  //    后两个选项**根本不存在**，rc=1 而日志一个字没有，症状与"壳起不来"长得一模一样。
  const args = ['-a', '-s', '-screen 0 1280x800x24', SHELL_BIN];
  const run = spawnSync('xvfb-run', args, { encoding: 'utf8', cwd: PACKAGE_DIR, env });
  return { rc: run.status ?? 1, out: `${run.stdout ?? ''}${run.stderr ?? ''}`, sandboxOff };
}

let run = runShellOnce(false);
if (/bwrap|dbus-proxy/i.test(run.out) && run.rc !== 0) {
  const first = /bwrap[^\n]*|Failed to fully launch dbus-proxy[^\n]*/.exec(run.out);
  console.log(`⚠️ M2 窗口默认档起不来（${first ? first[0] : 'bwrap 相关'}）⇒ 改跑**无沙箱档**取证。`);
  run = runShellOnce(true);
}
console.log(`M2_GATE_SANDBOX=${run.sandboxOff ? 'off（上面那行点名了原因）' : 'on（默认档）'}`);

const fail = (why, extra) => {
  console.error(`❌ M2 窗口这一档不通过：${why}`);
  const probe = /M2_PROBE#\d+=[^\n]*/g.exec(run.out);
  console.error(`   页侧读数：${probe ? probe[0] : '(一发探针都没落回来)'}`);
  if (extra) console.error(`   ${extra}`);
  const tail = run.out.split('\n').filter((l) => /M2_|SHELL_UI|STORAGE|ERROR/.test(l)).slice(-6);
  if (tail.length > 0) console.error(`   壳的证据行尾部：\n     ${tail.join('\n     ')}`);
  process.exit(1);
};

if (!/SHELL_UI=web-dist/.test(run.out)) {
  const fb = /SHELL_UI=fallback[^\n]*/.exec(run.out);
  fail('壳没走 M2 这条路', fb ? fb[0] : `没打出 SHELL_UI= 任何一行（rc=${run.rc}）`);
}
if (/M2_SETTLE_TIMEOUT/.test(run.out) || !/M2_SETTLED_AFTER=\d+/.test(run.out)) {
  fail('页面到点没落定（端口/backend/clientId/挂载 里有一格不成立）');
}
const snap = /M2_SNAPSHOT=(\S+) (\d+)x(\d+)/.exec(run.out);
if (!snap) {
  const sf = /M2_SNAPSHOT_FAIL=[^\n]*/.exec(run.out);
  fail('壳没交出快照', sf ? sf[0] : undefined);
}
if (!existsSync(shotPath)) fail(`壳说快照在 ${shotPath}，但文件不在`);

const stats = inspectPng(shotPath);
const brandBlue = countBrandBlue(shotPath);
if (looksBlank(stats)) fail(`快照是空白的（contentRatio=${stats.contentRatio}）`);
if (brandBlue <= 0) fail(`快照里数不出 heyta 主蓝（命中 ${brandBlue}）⇒ 画的可能不是我们的界面`);
const settled = /M2_SETTLED_AFTER=(\d+)/.exec(run.out);
console.log(
  `✅ M2 窗口这一档成立：SHELL_UI=web-dist、${settled ? settled[1] : '?'} 发落定、` +
    `快照 ${stats.width}x${stats.height} 非空白（contentRatio=${stats.contentRatio.toFixed(3)}）、主蓝命中 ${brandBlue}。`,
);
console.log(
  '   ⚠️ 记住这条判据的边界：**主蓝命中分不开"启动屏"与"挂载后"**（实测启动屏 3858 / 挂载后 3987），' +
    '\n      承重的是页侧那行 SETTLED。像素那两条只挡"有结算行但画布是空的"。',
);
rmSync(shotPath, { force: true });
process.exit(0);
