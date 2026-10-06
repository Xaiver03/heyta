#!/usr/bin/env node
/**
 * 壳侧 SQLite 驱动的「WAL ⇔ removeDatabase」对账门禁（批次 E / E2）。
 *
 * 它判的是这一件事：**一个把库开成 WAL 的壳侧驱动，必须同时把 `removeDatabase` 递给 JS 侧。**
 * 🔴 **成功那一支也必须成对**：`removeDatabase` 只删主文件是不够的 —— WAL 模式下明文不只住在主文件里，
 *   `-wal` 里那些没落盘的帧能把旧内容重放出来（node/Swift/C# 三份驱动都是逐枚 `['', '-wal', '-shm']`）。
 *   而**失败那一支**（驱动没这个方法）拿到的是 `containerRemoved:false`：DROP + VACUUM 之后
 *   文件本体还在，`sqlite-adapter.ts:273` 自己写明这个补救"不完备"—— 空闲页里仍可能翻出旧明文。
 * ⇒ 「驱动没配对」在输出上长得和「诚实的半清」一样，而全仓没有任何一层会因此变红。
 *
 * 🔴 分母从**树**里推导，不从记忆推导：壳侧驱动的所有者 = 源码里出现 `__heytaDriver`
 *   （JS 侧注入名；`__heytaDriverFactory` 含它，一并命中）的扫描根下一级目录。
 *   新增一个壳 = 自动进这张表；删掉一个壳 = 它的登记项会变陈旧从而报红。
 *
 * 已登记的例外（`REGISTERED_GAPS`）不是豁免表：每一项都必须在**今天仍然成立**，
 * 否则报「登记已过期，摘掉它」。这与 `check:gate-wiring` 的 `ALLOWED_OUTSIDE_CHAIN`、
 * `license-inventory.mjs` 的 `REVIEWED_OTHER` 是同一个模式 —— 加一条登记的成本是刻意的。
 *
 * 用法：
 *   node scripts/check-shell-erasure-parity.mjs            # 对真实仓库
 *   node scripts/check-shell-erasure-parity.mjs --root DIR # 对指定树（自检/排障用）
 *   node scripts/check-shell-erasure-parity.mjs --self-test # 四臂夹具：证明这四条规则各有牙
 *
 * 退出码：0 全部对账成立 / 1 有未配对的壳、有陈旧的登记、分母为空，或自检臂不符。
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** 壳侧驱动可能用的语言；`.md` 与生成物不算（文档里提一句不构成「装了驱动」）。 */
const SOURCE_EXTENSIONS = ['.c', '.h', '.m', '.mm', '.swift', '.cs', '.kt', '.java', '.cpp', '.hpp'];

/** 构建产物 / vendored 编译单元 —— 它们里面出现 `journal_mode` 是 SQLite 自己的事。 */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.build',
  '.cxx',
  '.gradle',
  '.next',
  'out',
  'Pods',
  'intermediates',
  'generated',
  'android',
  'ios',
  'DerivedData',
]);

const INJECTION_NAME = '__heytaDriver';
const WAL_PATTERN = /journal_mode\s*=\s*WAL/i;
const REMOVER_PATTERN = /\bremoveDatabase\b/;

/**
 * 已登记缺口。**必须**带「为什么不是缺陷」与「摘掉它的判据」两句实话，缺一句就是我自己
 * 在制造下一轮要重新查的东西。
 */
const REGISTERED_GAPS = [
  {
    owner: 'desktop-linux',
    // 实测：`heyta_driver.c:421-426` 只装 exec/run/all/close，`removeDatabase` 在该目录源码里 0 命中，
    // 而 `:415` 确实开的是 WAL。⇒ 注销在那台机器上只会得到 `containerRemoved:false`：
    //   DROP + VACUUM 之后**库文件本体还在盘上**（这个补救按 `sqlite-adapter.ts:273` 的说法"不完备"）。
    reason:
      'Linux 壳的定位是「同架构但不做专项功能」（AGENTS §1 仓库地图），且它的驱动在 macOS 上编不出来' +
      '（`check:linux-shell` 在非 Linux 响亮跳过）⇒ 补了 C 也拿不到读数，不写没证过的代码。',
    closingCheck:
      '在 `apps/desktop-linux/src/heyta_driver.c` 装上 `removeDatabase`（先 close，再 unlink 主文件 + ' +
      '`-wal` + `-shm`，返回 `SqliteContainerRemoval` 形状的 JSON 字符串），并在 Linux 机器上跑出 ' +
      '「销毁后那三个文件都不在盘上」的冒烟读数 ⇒ 届时摘掉本登记项。',
  },
];

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(full, acc);
      continue;
    }
    if (!SOURCE_EXTENSIONS.includes(entry.name.slice(entry.name.lastIndexOf('.')))) continue;
    acc.push(full);
  }
  return acc;
}

/** 一个候选目录的壳侧驱动读数。 */
function measureOwner(appsDir, name) {
  const files = walk(join(appsDir, name), []);
  const owner = {
    name,
    filesScanned: 0,
    injectionFiles: [],
    walFiles: [],
    removerFiles: [],
  };
  for (const file of files) {
    let text;
    try {
      if (!statSync(file).isFile()) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    owner.filesScanned += 1;
    const shown = relative(REPO, file);
    const rel = shown.startsWith('..') ? file : shown;
    text.split('\n').forEach((line, index) => {
      const at = `${rel}:${index + 1}`;
      if (line.includes(INJECTION_NAME)) owner.injectionFiles.push(at);
      if (WAL_PATTERN.test(line)) owner.walFiles.push(at);
      if (REMOVER_PATTERN.test(line)) owner.removerFiles.push(at);
    });
  }
  return owner;
}

/** 返回 `{ owners, problems, readings }`；problems 空 = 对账成立。 */
export function checkShellErasureParity(appsDir) {
  const problems = [];
  const readings = [];
  let shellDirs;
  try {
    shellDirs = readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return {
      owners: [],
      readings: [`  扫描根读不出来：${error.message}`],
      problems: [`扫描根 ${appsDir} 列不出来 —— 分母拿不到就不能报「全过」。`],
    };
  }

  const owners = [];
  for (const name of shellDirs) {
    const owner = measureOwner(appsDir, name);
    // 「所有者」的判据是它**注入过** `__heytaDriver`，不是它长得像个壳。
    if (owner.injectionFiles.length === 0) continue;
    owners.push(owner);
    const opensWal = owner.walFiles.length > 0;
    const exposesRemover = owner.removerFiles.length > 0;
    readings.push(
      `  ${owner.name}: wal=${opensWal ? 'Y' : 'N'} remover=${exposesRemover ? 'Y' : 'N'} ` +
        `files=${owner.filesScanned} walAt=${owner.walFiles[0] ?? '-'} removerAt=${owner.removerFiles[0] ?? '-'}`,
    );
    const registered = REGISTERED_GAPS.find((gap) => gap.owner === owner.name);
    if (opensWal && !exposesRemover && registered === undefined) {
      problems.push(
        `${owner.name} 把库开成 WAL（${owner.walFiles[0]}）却没有把 \`removeDatabase\` 递给 JS 侧。` +
          '⇒ 注销在那端只会报 containerRemoved:false：DROP + VACUUM 之后**文件本体留在盘上**，' +
          '而这个补救不完备 —— 空闲页里仍可能翻出旧明文（`sqlite-adapter.ts:273` 自己就写了"不完备"）。' +
          '要登记成缺口就在 REGISTERED_GAPS 里写清「为什么不是缺陷」与「摘掉它的判据」。',
      );
    }
    if (registered && (!opensWal || exposesRemover)) {
      problems.push(
        `${owner.name} 的登记项已过期（wal=${opensWal ? 'Y' : 'N'} remover=${exposesRemover ? 'Y' : 'N'}）` +
          '—— 从 REGISTERED_GAPS 摘掉它，别让它继续替一个已经不存在的事实作证。',
      );
    }
  }

  if (owners.length === 0) {
    problems.push(
      `分母为空：${appsDir} 下没有任何源码出现 ${INJECTION_NAME} —— 要么注入名改了，要么排除表把壳的源码整棵剪掉了，` +
        '不是「没有壳所以全过」。',
    );
  }

  const ownerNames = new Set(owners.map((owner) => owner.name));
  for (const gap of REGISTERED_GAPS) {
    if (!ownerNames.has(gap.owner)) {
      problems.push(
        `登记了 ${gap.owner}，但它在 ${INJECTION_NAME} 的所有者清单里不存在 —— 那个壳已删/改名，登记项要一起摘掉。`,
      );
    }
  }

  return { owners, readings, problems };
}

function writeFixture(appsDir, name, contents) {
  const full = join(appsDir, name, 'driver.c');
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

/** 夹具用的两种驱动：配对的、开了 WAL 却没配对的。 */
const DRIVER_PAIRED = `globalThis.${INJECTION_NAME} = obj;\nconst char *p = "PRAGMA journal_mode=WAL;";\nchar *removeDatabase(void) { return 0; }\n`;
const DRIVER_NO_REMOVER = `globalThis.${INJECTION_NAME} = obj;\nconst char *p = "PRAGMA journal_mode=WAL;";\nvoid close_db(void) {}\n`;

/** 四臂夹具：每条规则各被单独证一次会红，外加一条「全部成立 ⇒ 0 问题」。 */
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'heyta-shell-parity-'));
  const appsDir = join(root, 'apps');
  const arms = [];
  try {
    // 臂 1：开 WAL 却不给 removeDatabase、也没登记 ⇒ 必须点名它
    writeFixture(appsDir, 'shell-broken', DRIVER_NO_REMOVER);
    arms.push({ name: 'wal-without-remover', expectHit: 'shell-broken', ...checkShellErasureParity(appsDir) });
    rmSync(join(appsDir, 'shell-broken'), { recursive: true, force: true });

    // 臂 2：登记项还在，而 desktop-linux 其实已经配对了 ⇒ 「登记已过期」必须报红
    writeFixture(appsDir, 'desktop-linux', DRIVER_PAIRED);
    arms.push({ name: 'stale-registration', expectHit: '登记项已过期', ...checkShellErasureParity(appsDir) });
    rmSync(join(appsDir, 'desktop-linux'), { recursive: true, force: true });

    // 臂 3：什么都扫不到 ⇒ 不许当成全过
    arms.push({ name: 'empty-denominator', expectHit: '分母为空', ...checkShellErasureParity(appsDir) });

    // 臂 4：一个配对的新壳 + 一个成立的老登记 ⇒ 0 问题（这条保证前三条不是恒红夹具）
    writeFixture(appsDir, 'shell-paired', DRIVER_PAIRED);
    writeFixture(appsDir, 'desktop-linux', DRIVER_NO_REMOVER);
    arms.push({ name: 'all-rules-hold', expectHit: null, ...checkShellErasureParity(appsDir) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  let failures = 0;
  for (const arm of arms) {
    const hit = arm.problems.find((problem) => arm.expectHit === null || problem.includes(arm.expectHit));
    const ok = arm.expectHit === null ? arm.problems.length === 0 : hit !== undefined;
    if (!ok) failures += 1;
    console.log(
      `  [${ok ? 'OK' : 'BAD'}] ${arm.name}: owners=${arm.owners.length} problems=${arm.problems.length}` +
        (arm.expectHit === null ? ' (期望 0 问题)' : ` (期望含「${arm.expectHit}」)`) +
        (hit === undefined ? '' : ` ⇒ ${hit.slice(0, 90)}…`),
    );
  }
  if (failures > 0) {
    console.error(`❌ SELF-TEST: ${failures} 个臂不符（规则或夹具坏了）`);
    process.exit(1);
  }
  console.log('SELF_TEST arms=4 ok=4');
}

/**
 * 给别的门禁用的**行形状**读数（`check:legal-closure-truth` 用它把政策里那些平台名
 * 逐一对到树上）。返回的是纯数据，不打印、不退出 —— 打印与退出只属于 CLI 那一支。
 */
export function shellErasureRows(appsDir) {
  const { owners } = checkShellErasureParity(appsDir);
  return owners.map((owner) => ({
    name: owner.name,
    wal: owner.walFiles.length > 0,
    remover: owner.removerFiles.length > 0,
    files: owner.filesScanned,
  }));
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
    process.exit(0);
  }

  const rootIndex = args.indexOf('--root');
  const appsDir = rootIndex === -1 ? join(REPO, 'apps') : join(resolve(args[rootIndex + 1]), 'apps');

  const { owners, readings, problems } = checkShellErasureParity(appsDir);
  for (const line of readings) console.error(line);
  console.log(
    `SHELL_ERASURE_PARITY root=${appsDir} owners=${owners.length} gaps=${REGISTERED_GAPS.length} problems=${problems.length}`,
  );
  if (problems.length > 0) {
    for (const line of problems) console.error(`❌ ${line}`);
    process.exit(1);
  }
  console.log('✅ 每个开 WAL 的壳侧驱动都把 removeDatabase 递给了 JS 侧（例外逐条带理由与摘除判据）');
}

/** 只有作为脚本直接运行时才走 CLI（被 import 时不许打印、更不许 process.exit）。 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
