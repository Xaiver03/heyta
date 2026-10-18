#!/usr/bin/env node
/**
 * `verify:artifact-facts` —— 桶里那几枚产物**自己内部**说的版本与架构。
 * ==================================================================
 *
 * ## 它补的是哪一格
 *
 * `check:version-declarations` 管"**五个壳的声明互相一致**"（源码层，离线）；
 * `check-release-version-guard.mjs` 管"**批次号不许倒退**"（比的是文件名/清单，**从不读产物**）；
 * `verify:downloads-servable` 管"**页面给的链接下得到**"。⇒ 中间那一格一直是空的：
 *
 *   **一枚产物自己说它是哪个版本、给哪种机器。**
 *
 * 🔴 **它今天会红，而那个红在两种口径下都成立**（所以不是替谁拍板）：
 * 桶里这一批的文件名与 `latest.json` 都写着 `1.0.1-test.20261008.4`，
 * 而实测 `.deb` 的 `control` 是 `Version: 1.0.0`、dmg 里 `CFBundleShortVersionString` 也是 `1.0.0`。
 * ⇒ 不论最后定"以批次号为准"还是"以产物内部为准"，**"文件名说 X、内容说 Y"都是缺陷**。
 * （对账件 **B11** 记的就是这件事，含"其实有三个号"。）
 *
 * ## 🔴 覆盖边界**说出来**，不静默
 *
 * 本判据今天只能读两种格式：`.deb`（`control`）与 `.dmg`（`Info.plist`，靠 `hdiutil` 挂载）。
 * `.zip`（98 MB）与 `.apk`（68 MB，版本号在二进制 AXML 里）**没覆盖** ——
 * 脚本会**响亮地列出未覆盖项**，而不是让"全部通过"读成"五端都对过账"。
 * ⚠️ 这与 `check:crosslang-contract` 那次"跳过 = 退出 0"是**同一族问题**，
 * 所以这里刻意让**未覆盖这件事出现在输出里**。
 *
 * ## 用法
 *
 *   node scripts/verify-artifact-facts.mjs              # 拉桶里那份 latest.json 并逐条读
 *   node scripts/verify-artifact-facts.mjs --self-test   # 证明比较逻辑真的会红
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BUCKET_MANIFEST =
  'https://heyta-dist-1445543984.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/latest.json';

/** 只有这两端能被本脚本读出版本；其余**明确列为未覆盖**。 */
export const COVERED = {
  macos: 'dmg：挂载后读 Info.plist 的 CFBundleShortVersionString',
  linux: 'deb：解 control.tar.zst 读 Version',
};
export const UNCOVERED = {
  windows: 'zip 内嵌 msix（98 MB），且版本在 AppxManifest 里，本轮没做',
  android: 'apk 的版本号在二进制 AXML 里，本轮没做',
};

/** `1.0` / `1.0.0` / `1.0.0.0` 是同一个版本：按段比，尾部零不参与。 */
export function sameVersion(a, b) {
  const parts = (v) => String(v).trim().split('.').map((s) => Number(s));
  const [x, y] = [parts(a), parts(b)];
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return false;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return false;
  return true;
}

/** 纯判据：给 `{ platform: { declared, actual } }`，返回问题列表。 */
export function artifactVersionProblems(readings) {
  const problems = [];
  for (const [platform, r] of Object.entries(readings)) {
    if (r.actual === undefined) {
      problems.push(`${platform}：读不出产物内部的版本（${r.why ?? '原因未知'}）`);
      continue;
    }
    if (!sameVersion(r.declared, r.actual)) {
      problems.push(
        `${platform}：**文件名/清单说 ${r.declared}，而产物内部说 ${r.actual}** —— ` +
          '报障时用户引哪个数都对不上那枚字节',
      );
    }
  }
  return problems;
}

// 🔴 **每条子进程都要有超时**（2026-10-16 修）：`spawnSync` 默认**永不超时**，
//    而 `hdiutil attach/detach` 实测会**永久阻塞**（当天：卷 `/Volumes/heyta` 其实没挂着，
//    `hdiutil detach` 却卡住不动 ⇒ 我的重跑工具**堆了 30 个进程**，每个卡 6–7 分钟）。
//    ⚠️ 一条**会永远挂着的判据**比一条会红的判据更糟：它不会给出任何读数，只会堵住调用它的东西。
const SH_TIMEOUT_MS = 120_000;

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: SH_TIMEOUT_MS, ...opts });
  if (r.error?.code === "ETIMEDOUT") {
    // 🔴 **响亮地报**，不要静默当成空输出 —— 静默会把"没测到"读成"没问题"。
    return {
      code: "TIMEOUT",
      out: `🔴 \`${cmd} ${args.join(" ")}\` 超过 ${SH_TIMEOUT_MS / 1000}s 未返回（已被杀掉）`,
    };
  }
  // ⚠️ 这一行是**原有行为**，2026-10-16 我加超时时**误删过一次**：
  //    按"行数"替换把 `return` 一起盖掉了 ⇒ `sh()` 返回 `undefined` ⇒
  //    `readDmg` 当场 `TypeError: Cannot read properties of undefined (reading 'out')`。
  //    ⇒ 教训：**替换要按内容锚点，不要按行数**（本会话已犯第二次，上一次是 python 嵌套引号）。
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * `.deb` → `{ version, architecture }`。
 *
 * 🔴 **`zstd -dc | tar -xO` 必须留在管道里**（2026-10-16 实测踩过）：
 * 第一版把 `zstd` 的 stdout 取成 JS 字符串再写文件 —— 而 `stdout` 是**二进制 tar**，
 * 经 `encoding: 'utf8'` 往返后字节就坏了，`tar` 于是报"读不出"。
 * 判据那边**如实报成了失败而不是静默跳过**（这一点设计对了），但实现错了。
 * ⚠️ 本仓 `upload-dist.sh` 里也有同族的教训：`Content-Range` 不能按 `$2` 切。
 */
export function readDeb(dir, file) {
  const a = sh('ar', ['x', file], { cwd: dir });
  if (a.code !== 0) return { why: `ar 失败：${a.out.trim().split('\n')[0]}` };
  if (!existsSync(join(dir, 'control.tar.zst'))) {
    return { why: 'control.tar.zst 不存在（打包格式变了？）' };
  }
  // 一次跑完：解压与解包都留在管道里，**不**经过 JS 字符串。
  const t = sh('sh', ['-c', 'zstd -dc control.tar.zst | tar -xO ./control'], { cwd: dir });
  if (t.code !== 0) return { why: `zstd|tar 失败：${t.out.trim().split('\n').slice(-1)[0]}` };
  const version = /^Version:\s*(.+)$/m.exec(t.out)?.[1]?.trim();
  const architecture = /^Architecture:\s*(.+)$/m.exec(t.out)?.[1]?.trim();
  return version === undefined ? { why: 'control 里没有 Version 行' } : { version, architecture };
}

/** `.dmg` → 主可执行的架构 + bundle 版本。⚠️ 会挂载/卸载，**必须**在 finally 里 detach。 */
export function readDmg(dir, file) {
  const at = sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', file], { cwd: dir });
  const mount = /(\/Volumes\/[^\n]*)$/m.exec(at.out.trim())?.[1]?.trim();
  if (mount === undefined || !existsSync(mount)) {
    return { why: `hdiutil attach 失败：${at.out.trim().split('\n').slice(-1)[0]}` };
  }
  try {
    const appDir = sh('find', [mount, '-maxdepth', '2', '-name', '*.app']).out.trim().split('\n')[0];
    const plist = join(appDir, 'Contents/Info.plist');
    const version = sh('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])
      .out.trim();
    const exe = sh('find', [join(appDir, 'Contents/MacOS'), '-type', 'f']).out.trim().split('\n')[0];
    const archs = sh('lipo', ['-archs', exe]).out.trim();
    return {
      version: version === '' ? undefined : version,
      architecture: archs === '' ? undefined : archs,
    };
  } finally {
    sh('hdiutil', ['detach', mount]);
  }
}

async function main() {
  let doc;
  try {
    const res = await fetch(BUCKET_MANIFEST, { headers: { 'Cache-Control': 'no-cache' } });
    doc = await res.json();
  } catch (error) {
    console.error(`🔴 拉不到桶里的 latest.json：${String(error)}`);
    process.exit(1);
  }
  const files = doc?.files ?? {};
  if (Object.keys(files).length === 0) {
    console.error('🔴 桶里的 latest.json 一条产物都没有 —— 这条判据正在变成一条空规则。');
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), 'heyta-artifact-facts-'));
  const readings = {};
  try {
    for (const [platform, entry] of Object.entries(files)) {
      const declared = String(entry?.version ?? doc?.version ?? '');
      if (!(platform in COVERED)) {
        console.log(`  ⏭️  ${platform.padEnd(8)} **未覆盖** —— ${UNCOVERED[platform] ?? '本脚本没实现'}`);
        continue;
      }
      const name = String(entry?.name ?? '');
      const url = String(entry?.url ?? '');
      const dest = join(dir, name);
      try {
        await download(url, dest);
      } catch (error) {
        readings[platform] = { declared, actual: undefined, why: `下载失败：${String(error)}` };
        continue;
      }
      const read = platform === 'linux' ? readDeb(dir, name) : readDmg(dir, name);
      readings[platform] = { declared, actual: read.version, why: read.why };
      if (read.version !== undefined) {
        console.log(
          `  📦 ${platform.padEnd(8)} 清单 ${declared} / 产物内部 ${read.version}` +
            (read.architecture === undefined ? '' : ` · 架构 ${read.architecture}`),
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const problems = artifactVersionProblems(readings);
  if (problems.length > 0) {
    console.error(`\n🔴 产物自己说的版本与它的文件名/清单对不上（${problems.length} 条）：`);
    for (const p of problems) console.error(`   · ${p}`);
    console.error(
      '\n   ⇒ **不论版本号最后以谁为准，这一条都成立**：文件名说 X、内容说 Y 就是缺陷。\n' +
        '      对账件 B11 记着口径未决（批次号 / 产物内部 / app 版本，其实是三个号）。',
    );
    process.exit(1);
  }
  console.log(
    `\n✅ 已覆盖的两端（${Object.keys(COVERED).join(' / ')}）内部版本与清单一致。` +
      `⚠️ **未覆盖**：${Object.keys(UNCOVERED).join(' / ')} —— 别把这条读成"五端都对过账"。`,
  );
}

/* ── 自检：证明比较逻辑真的会红 ─────────────────────────────────────── */

function selfTest() {
  const arms = [
    [
      'A 一致（含 1.0 / 1.0.0 / 1.0.0.0 三种写法）⇒ 不报',
      () => artifactVersionProblems({ macos: { declared: '1.0.0', actual: '1.0' }, linux: { declared: '1.0', actual: '1.0.0.0' } }),
      0,
    ],
    [
      'B 🔴 文件名叫批次号、内容说另一个 ⇒ 报（这就是今天的形状）',
      () => artifactVersionProblems({ linux: { declared: '1.0.1-test.20261008.4', actual: '1.0.0' } }),
      1,
    ],
    [
      'C 读不出产物内部 ⇒ 报（不许静默跳过）',
      () => artifactVersionProblems({ macos: { declared: '1.0.0', actual: undefined, why: 'hdiutil 挂了' } }),
      1,
    ],
  ];
  let failures = 0;
  for (const [label, run, expect] of arms) {
    const problems = run();
    const hit = problems.length === expect;
    console.log(`${hit ? '✅' : '❌'} ${label}${hit ? '' : `（${problems.join(' / ') || '(无)'}）`}`);
    if (!hit) failures += 1;
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else await main();
