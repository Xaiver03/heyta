// 生成 `server/image-npm-tree.json` —— **镜像里实际装了什么**的一份快照。
//
// 为什么需要它（现量结论写在 docs/research/self-host-distribution-audit.md §8.8）：
// `server/Dockerfile` 的**生产阶段**用 `npm install`（不是 pnpm），而仓库里**没有任何
// npm lockfile** —— 所以那棵树每次构建都从 registry 重解一遍。许可证门禁
// `research/tools/license-inventory.mjs` 扫的是根/e2e 两个 **pnpm** store，它量的是
// 开发机上那棵树，不是发布出去的那一棵。2026-10-03 实测差 16/139 条。
//
// 这份快照不"修好"那个洞 —— 修好它要把镜像那棵树钉住（G-47）。它的作用是把洞变成
// **一条会红的对账**：`check:image-license-coverage` 拿它逐条去门禁的扫描集里查，
// 查不到又没被逐条登记 ⇒ 红。
//
// 用法（**要联网**，它就是在问 registry 要解析结果）：
//   node research/tools/gen-image-npm-tree.mjs             # 写快照（**要联网**）
//   node research/tools/gen-image-npm-tree.mjs --stdout     # 只打印，不落盘（要联网）
//   node research/tools/gen-image-npm-tree.mjs --check      # 只验新鲜度：**不联网、不落盘**
//
// 🔴 `--check` 是那道"快照还代不代表当下"的**门禁本体**（挂在 `check:image-license`
// 前面，所以 `pnpm check` 一定会跑到它）。它只读文件、只比 `inputs` 里的哈希，
// 因此没有网络、没有 docker 的机器上也在判。原先只有对账脚本比 `server/package.json`
// 与 install 形状两枚哈希，**三枚被 npm pack 进镜像的本地包的依赖漂了没人红**。
//
// 什么时候要重跑生成（写快照那条）：改了 `server/package.json`、三枚被打包进镜像的
// 工作区包之一的 package.json（含 `dependencies`），或 Dockerfile 里那三条 `npm install`
// 的形状 —— 三者都会改 `inputs` 里的某一枚哈希，`--check` 会点名到具体是哪一枚。

import { readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageInstallShape } from './image-install-shape.mjs';

// ⚠️ 必须走 fileURLToPath：`new URL(...).pathname` 不解码百分号，而这个仓库的父目录名
// 带空格（"All in one Data"）—— 直接拿 pathname 会得到 `All%20in%20one`，
// 症状是一句 ENOENT，看起来像"文件没建"。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const dockerfile = join(repoRoot, 'server/Dockerfile');
const serverPkgPath = join(repoRoot, 'server/package.json');
const outPath = join(repoRoot, 'server/image-npm-tree.json');
const TARGET = { os: 'linux', cpu: 'x64', libc: 'musl' };

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * 🔴 新鲜度哈希只盖**依赖相关字段**，不盖整个文件（2026-10-04 收窄）。
 *
 * 原先哈希整个 package.json ⇒ 加一条测试脚本名也会让 `--check` 红，
 * 而那个改动**不影响镜像里装出来的任何东西**。一杆对无关改动乱响的尺子
 * 会训练人忽略它——真到依赖漂移那天反而当噪声放过去。
 * 收窄后仍然盖住全部会改变安装结果的面：dependencies / devDependencies /
 * optionalDependencies / peerDependencies / overrides / engines / packageManager。
 * ⚠️ 改这个函数的取值集合 = 换了指纹口径 ⇒ 必须重跑生成器落新快照，
 * 且要在这里写明为什么新集合仍然盖住"真进镜像的东西"。
 */
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
  'engines',
  'packageManager',
];
function depsFingerprint(pkgJsonText) {
  const pkg = JSON.parse(pkgJsonText);
  const picked = {};
  for (const key of DEP_FIELDS) {
    if (pkg[key] !== undefined) picked[key] = pkg[key];
  }
  return sha256(JSON.stringify(picked));
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// ── 1. 装法本身要从 Dockerfile 读，不许抄第二份 ────────────────────
const shape = readImageInstallShape(dockerfile);
if (shape.installs.length === 0) fail('生产阶段一条 install 命令都没读到 —— 对账已经没有对象。');
for (const inst of shape.installs) {
  if (inst.usesPnpm) {
    fail(
      '生产阶段现在用 pnpm 装了。镜像那棵树一旦来自 `pnpm-lock.yaml`，' +
        '它就和许可证门禁扫的是**同一棵树** —— 这条快照与对账应当**撤掉**，不是改成读别的文件。' +
        `\n   那一行：${inst.raw}`,
    );
  }
  if (!inst.omitDev) {
    fail(
      '生产阶段有一条 install 不带 `--omit=dev` 了 —— 那意味着**构建依赖会进发布镜像**，' +
        '比许可证盲区严重，先把那一行改回去再谈对账。' +
        `\n   那一行：${inst.raw}`,
    );
  }
}
for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'server/package-lock.json']) {
  if (existsSync(join(repoRoot, lock))) {
    fail(
      `仓库里出现了 npm 的 lockfile（${lock}）—— 镜像那棵树被钉住了，` +
        '这份"每次重解都要重新量"的快照就是多余的第二事实源。' +
        '正确动作是把对账改成直接读那个 lockfile，并删掉本脚本。',
    );
  }
}
const pinnedSpecs = shape.installs
  .flatMap((i) => i.specs)
  .filter((s) => !s.endsWith('.tgz') && !s.startsWith('"') && !s.startsWith('$'))
  .map((s) => s.replace(/^"|"$/g, ''));
const tarballSpecs = shape.installs.flatMap((i) => i.specs).filter((s) => s.endsWith('.tgz'));
const registry =
  (shape.installs.find((i) => i.registry && !i.registry.startsWith('"')) || {}).registry ||
  'https://registry.npmjs.org/';

// ── 2. 三个被打包进镜像的工作区包：它们的三方依赖也是镜像的一部分 ──────
const serverPkg = JSON.parse(readFileSync(serverPkgPath, 'utf8'));
const packedNames = Object.keys(serverPkg.dependencies || {}).filter((n) => n.startsWith('@heyta/'));
const mergedDeps = {};
const sources = { server: serverPkg };
// 🔴 这三枚包**的内容哈希**要进快照的 inputs：Dockerfile 的构建阶段会把它们各自
// `npm pack` 成 tgz 装进镜像，而本文件又把它们各自的 `dependencies` 并进了 mergedDeps
// （`@heyta/domain` 当前就带着 `ical.js`）。只哈希 `server/package.json` 的话，
// **改这三枚里的任何一枚依赖都不会让任何一层变红** —— 快照描述的已经不是镜像里的
// 那棵树了，而它看起来仍然自洽。这就是"新鲜度哈希没盖住真正被打进镜像的东西"。
const packedPackageJson = {};
for (const name of packedNames) {
  const dir = name.slice('@heyta/'.length);
  const p = join(repoRoot, 'packages', dir, 'package.json');
  const rel = `packages/${dir}/package.json`;
  if (!existsSync(p)) {
    fail(
      `server/package.json 依赖 ${name}，但 \`${rel}\` 不在。` +
        '包名 → 目录名的映射（@heyta/<目录>）被打破了，快照会漏掉这一整包依赖。',
    );
  }
  const text = readFileSync(p, 'utf8');
  packedPackageJson[rel] = depsFingerprint(text);
  sources[dir] = JSON.parse(text);
}
const INPUTS_BASE = {
  targetPlatform: TARGET,
  registry,
  serverPackageJsonSha256: depsFingerprint(readFileSync(serverPkgPath, 'utf8')),
  installShapeSha256: sha256(shape.normalizedShape),
  packedWorkspaceDeps: packedNames,
  packedPackageJsonSha256: packedPackageJson,
};
if (Object.keys(packedPackageJson).length === 0) {
  fail('一枚 @heyta/ 工作区包都没读到 —— 镜像里那三个 tgz 就是从它们来的，读空了快照会假装镜像没有本地包。');
}

for (const [label, pkg] of Object.entries(sources)) {
  for (const [dep, range] of Object.entries(pkg.dependencies || {})) {
    if (dep.startsWith('@heyta/')) continue; // 自家包由 tarball 供给，不是 registry 的事
    if (mergedDeps[dep] && mergedDeps[dep] !== range) {
      // 不静默取一个：两处范围不同时，npm 的解析结果取决于谁先装，快照会假装它是确定的。
      fail(
        `${dep} 在两处声明了不同的范围（${mergedDeps[dep]} vs ${range}，来自 ${label}）。` +
          '把镜像里应当生效的那一个写进 package.json 的 resolutions 或统一范围，再重跑。',
      );
    }
    mergedDeps[dep] = range;
  }
}
for (const spec of pinnedSpecs) {
  const at = spec.lastIndexOf('@');
  if (at <= 0) fail(`读出来的安装目标 ${spec} 不是 name@version 形状，无法并进快照。`);
  mergedDeps[spec.slice(0, at)] = spec.slice(at + 1);
}

// ── 2b. `--check`：**纯文件系统**的新鲜度门禁（不联网、不落盘）──────────
// 为什么放在生成器里而不是对账脚本里：`check:image-license-coverage.mjs` 只比
// `server/package.json` 与 install 形状这两枚哈希，而"哪些输入算变了"这件事
// 归生成器所有 —— 它才是读这些输入的人。再加一份判断到对面那个文件，
// 就是同一个条件抄两遍（下一次漂移的起点）。
if (process.argv.includes('--check')) {
  let snap;
  try {
    snap = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch (e) {
    fail(`读不到快照 ${outPath.replace(`${repoRoot}/`, '')}：${e.message}`);
  }
  const got = snap.inputs || {};
  const stale = [];
  const INPUT_LABEL = {
    serverPackageJsonSha256: 'server/package.json',
    installShapeSha256: 'server/Dockerfile 生产阶段那几条 install 命令的形状',
    registry: 'install 命令里的 registry',
    targetPlatform: '目标平台',
    packedWorkspaceDeps: '@heyta/ 工作区包的清单',
  };
  for (const [key, text] of Object.entries(INPUT_LABEL)) {
    if (JSON.stringify(got[key]) !== JSON.stringify(INPUTS_BASE[key])) {
      stale.push(`${text} 变了（快照里的 ${key} 与当下不一致）`);
    }
  }
  if (!got.packedPackageJsonSha256) {
    stale.push('快照里**没有** packedPackageJsonSha256 这一档 ⇒ 它早于"三枚本地包也要盖住"这条判据');
  } else {
    for (const [rel, hash] of Object.entries(packedPackageJson)) {
      if (got.packedPackageJsonSha256[rel] !== hash) {
        stale.push(`${rel} 变了 —— 它被 npm pack 成 tgz 装进镜像，它的 dependencies 也在快照描述的那棵树里（快照哈希 ${String(got.packedPackageJsonSha256[rel]).slice(0, 12)}… ≠ 当下 ${hash.slice(0, 12)}…）`);
      }
    }
    for (const rel of Object.keys(got.packedPackageJsonSha256)) {
      if (!(rel in packedPackageJson)) {
        stale.push(`快照里有 ${rel} 的哈希，但当下已经没有这一枚本地包 —— 清单与现实漂移了`);
      }
    }
  }
  if (stale.length > 0) {
    console.error(`❌ 镜像依赖快照已经不代表当下的声明（${stale.length} 处失真）：`);
    for (const s of stale) console.error(`   - ${s}`);
    console.error(`   重跑：${'node research/tools/gen-image-npm-tree.mjs'}（要联网），`);
    console.error('   然后按 check:image-license 给出的新差集更新 IMAGE_ONLY_PACKAGES。');
    process.exit(1);
  }
  console.log(
    `✅ 镜像依赖快照的输入仍然对得上当下声明：server/package.json + Dockerfile install 形状 + ` +
      `${Object.keys(packedPackageJson).length} 枚打进镜像的本地包（${Object.keys(packedPackageJson).join(' / ')}）`,
  );
  process.exit(0);
}

// ── 3. 让 npm 自己解一遍（就是镜像里那一步的解析结果） ────────────────
const dir = mkdtempSync(join(tmpdir(), 'heyta-image-tree-'));
try {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { name: 'heyta-image-tree-probe', version: '0.0.0', dependencies: mergedDeps },
      null,
      2,
    ),
  );
  execFileSync(
    'npm',
    ['install', '--package-lock-only', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${registry}`],
    { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const seen = new Map();
  let skippedOtherPlatform = 0;
  for (const [key, v] of Object.entries(lock.packages || {})) {
    const at = key.lastIndexOf('node_modules/');
    if (at < 0) continue; // 根条目 ""
    const name = key.slice(at + 'node_modules/'.length);
    if (!v.version) continue;
    if (v.dev) continue;
    const osList = Array.isArray(v.os) && v.os.length ? v.os : null;
    const cpuList = Array.isArray(v.cpu) && v.cpu.length ? v.cpu : null;
    const libc = v.engines && Array.isArray(v.engines.libc) && v.engines.libc.length ? v.engines.libc : null;
    if ((osList && !osList.includes(TARGET.os)) || (cpuList && !cpuList.includes(TARGET.cpu)) || (libc && !libc.includes(TARGET.libc))) {
      skippedOtherPlatform += 1;
      continue;
    }
    const id = `${name}@${v.version}`;
    if (!seen.has(id)) seen.set(id, { name, version: v.version, optional: !!v.optional });
  }
  const packages = [...seen.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
  const snapshot = {
    _what: '镜像生产阶段（`server/Dockerfile` 的 FROM … AS production）经 npm 解析出来的依赖树快照。不是清单、不是许可判定 —— 判定在 research/tools/check-image-license-coverage.mjs。',
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    generator: 'research/tools/gen-image-npm-tree.mjs',
    inputs: {
      ...INPUTS_BASE,
      localTarballs: tarballSpecs,
      registryResolvedDeps: Object.keys(mergedDeps).sort().length,
      skippedForOtherPlatform: skippedOtherPlatform,
    },
    packages,
  };
  if (packages.length < 100) {
    fail(`只解析出 ${packages.length} 个包 —— 不像一棵真的生产树（上次实测 139）。解析层坏了，别落盘。`);
  }
  if (process.argv.includes('--stdout')) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(
      `✅ 写出 ${outPath.replace(`${repoRoot}/`, '')}：${packages.length} 个包` +
        `（按 ${TARGET.os}/${TARGET.cpu}/${TARGET.libc} 过滤，跳过其他平台变体 ${skippedOtherPlatform} 条）`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
