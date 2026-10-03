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
//   node research/tools/gen-image-npm-tree.mjs            # 写快照
//   node research/tools/gen-image-npm-tree.mjs --stdout    # 只打印，不落盘
//
// 什么时候要重跑：改了 `server/package.json`、三个被打包进镜像的工作区包之一的依赖，
// 或者 Dockerfile 里那三条 `npm install` 的形状 —— 前两者会改 `inputs` 里的哈希，
// 第三者会改 `installShapeSha256`，对账脚本对不上就红。

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
for (const name of packedNames) {
  const dir = name.slice('@heyta/'.length);
  const p = join(repoRoot, 'packages', dir, 'package.json');
  if (!existsSync(p)) {
    fail(
      `server/package.json 依赖 ${name}，但 \`packages/${dir}/package.json\` 不在。` +
        '包名 → 目录名的映射（@heyta/<目录>）被打破了，快照会漏掉这一整包依赖。',
    );
  }
  sources[dir] = JSON.parse(readFileSync(p, 'utf8'));
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
      targetPlatform: TARGET,
      registry,
      serverPackageJsonSha256: sha256(readFileSync(serverPkgPath, 'utf8')),
      installShapeSha256: sha256(shape.normalizedShape),
      packedWorkspaceDeps: packedNames,
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
