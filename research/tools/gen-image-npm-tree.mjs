// 生成 `server/image-npm-tree.json` —— **镜像会装什么**的一份快照，
// 由**提交物锁 `server/package-lock.json` 导出**（不再联网重解，见下面的历史）。
//
// ── 历史：这份东西为什么长这样，以及它 2026-10-04 变了什么 ───────────────
// 以前它是"替 npm 现场解一遍"的**预测**，因为那时仓库里没有 npm 的 lockfile，
// 而 `server/Dockerfile` 生产阶段用 `npm install` ⇒ 那棵树每次构建从 registry 重解。
// 预测与产物之间于是有一整族漂移（2026-10-04 第一次拿真镜像对账量出来，审计 §8.38）：
//   ① 按平台切的二进制包：真镜像（本机 arm64）里是 `@node-rs/argon2-linux-arm64-musl`，
//      而快照按 `linux/x64/musl` 那一枚列 ⇒ "镜像里有而门禁没扫过"这一整类见 G-53。
//   ② `^` 范围在两次解析之间会走：`@fastify/websocket` 快照 `11.3.1` / 真镜像 `11.3.3`。
// 那个洞的**正确出口**当时就写在本文件末尾那段 `fail` 里（"把树钉住，然后改读那把锁"），
// 2026-10-04 走完了：锁成为构建输入（`server/Dockerfile` 生产阶段 COPY 它），
// 而本脚本改成读它。为什么不是 `npm ci` —— 实测两档都不成立（冷缓存 EINTEGRITY 当场炸 /
// 热缓存 rc=0 却静默装上一版本地代码），全部读数在审计 §8.46。
//
// 🔴 现在还剩什么漂移面，说准：
//  · **锁与镜像里那棵树**对不对 ⇒ 由 `check-image-license-coverage.mjs --installed-tree`
//    的双载体判据守（磁盘枚举 × npm 自己写的锁，审计 §8.45），消费者是 `verify:selfhost-stack`；
//  · **锁与 `server/package.json` 的声明**对不对 ⇒ 由 `check-image-install-contract.mjs`
//    第 4 步守（在场 / COPY 在生产阶段 / 逐条盖住声明），消费者是 `pnpm check`；
//  · 快照与锁本身 ⇒ `inputs.packageLockSha256`，改了锁没重跑快照会红在 `--check`。
// 平台过滤（①）仍然在：快照描述的是 `linux/x64/musl` 那一档，也就是发布 workflow 钉的架构。
//
// 用法（**不联网**，它只读仓库里的两枚文件）：
//   node research/tools/gen-image-npm-tree.mjs             # 写快照
//   node research/tools/gen-image-npm-tree.mjs --stdout     # 只打印，不落盘
//   node research/tools/gen-image-npm-tree.mjs --check      # 只验新鲜度：**不落盘**
//
// 🔴 `--check` 是那道"快照还代不代表当下"的**门禁本体**（挂在 `check:image-license`
// 前面，所以 `pnpm check` 一定会跑到它）。它只读文件、只比 `inputs` 里的哈希，
// 因此没有网络、没有 docker 的机器上也在判。原先只有对账脚本比 `server/package.json`
// 与 install 形状两枚哈希，**三枚被 npm pack 进镜像的本地包的依赖漂了没人红**。
//
// 什么时候要重跑生成（写快照那条）：改了 `server/package.json`、三枚被打包进镜像的
// 工作区包之一的 package.json、`server/package-lock.json`，或 Dockerfile 里那三条
// `npm install` 的形状 —— 四者都会改 `inputs` 里的某一枚哈希，`--check` 会点名到具体是哪一枚。
// 而**重生成锁**是另一件事：它要一次真构建，从镜像里取 `/app/package-lock.json`
// （不在宿主机另解一份 —— 那是第二事实源，理由写在 `server/Dockerfile` 那段 COPY 注释里）。


import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageInstallShape } from './image-install-shape.mjs';
import { gateAllowsTarget, readImageLock } from './image-lock-platform.mjs';

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
// 🔴 2026-10-04：这把锁从"不该存在"变成**必需的输入**（审计 §8.46 结论四）。
// 以前这里是一条 `fail`：仓库里出现 npm 的 lockfile ⇒ 这份"每次重解都要重新量"的快照
// 就是多余的第二事实源，正确动作是改读那把锁。**那句话现在被执行了** ——
// 下面第 3 步不再联网重解，而是直接读提交物锁。守卫反过来：锁**不在**才是问题，
// 因为 `server/Dockerfile` 生产阶段 COPY 它当安装输入，而镜像那棵树的第三方层全靠它钉。
const committedLockPath = join(repoRoot, 'server/package-lock.json');
if (!existsSync(committedLockPath)) {
  fail(
    '仓库里没有 `server/package-lock.json` —— 本脚本已经没有对象可读了。',
    '  镜像那棵树的第三方层现在每次构建由 npm 现场重解（"外人晚半年 build 老 tag 拿到同一棵树"这句不成立），\n' +
      '  而快照退回到"预测"性质。重生成：跑一次 `pnpm verify:selfhost-stack`，从镜像里取\n' +
      '  `/app/package-lock.json` 落成提交物（形状与理由写在 server/Dockerfile 那段 COPY 注释里）。',
  );
}
const committedLockText = readFileSync(committedLockPath, 'utf8');

/**
 * 从提交物锁里导出"镜像生产阶段会装的那棵树"（按目标平台过滤 + 按 name@version 去重）。
 * 单一所有者：`--check` 与生成都走这里 —— 两边各写一遍就是下一次漂移的起点。
 */
function deriveFromLock(lockText) {
  let parsed;
  try {
    parsed = readImageLock(lockText);
  } catch (e) {
    fail(`\`server/package-lock.json\` 读不出可用形状：${e.message}`,
      '  它是镜像那棵树的钉子，坏了不能当"没有差异"。');
  }
  const seen = new Map();
  let skippedOtherPlatform = 0;
  for (const entry of parsed.entries) {
    if (!gateAllowsTarget(entry.gate, TARGET)) {
      skippedOtherPlatform += 1;
      continue;
    }
    const id = entry.id;
    // 🔴 `license` 必须一起带出去：`check-image-license-coverage` 那条"登记的 license
    //  ≠ 产物自己声明的 license"判定在**两种载体上都要有输入**。以前快照里没有本地包，
    //  它只在真树上有效；锁成为事实源之后，三枚 `@heyta/*` 进了快照，
    //  漏读 license 会让那一条对自家包**无条件判红**（2026-10-04 实测：第一次就是这样红的，
    //  而它当时抓到的其实是"锁取自补声明之前的那趟构建"—— 两个问题叠在一起，
    //  只修一个就会把这条读数当成"已修"）。
    if (!seen.has(id)) {
      seen.set(id, {
        name: entry.name,
        version: entry.version,
        optional: entry.optional,
        license: entry.license,
      });
    }
  }
  return {
    packages: [...seen.values()].sort((a, b) =>
      `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
    ),
    skippedOtherPlatform,
    entryCount: parsed.totalKeys,
  };
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
  packedPackageJson[rel] = sha256(text);
  sources[dir] = JSON.parse(text);
}
const INPUTS_BASE = {
  targetPlatform: TARGET,
  registry,
  serverPackageJsonSha256: sha256(readFileSync(serverPkgPath, 'utf8')),
  installShapeSha256: sha256(shape.normalizedShape),
  packedWorkspaceDeps: packedNames,
  packedPackageJsonSha256: packedPackageJson,
  // 🔴 快照现在描述的是**这把锁**，不再是一次现场解析。把锁本身的哈希写进 inputs，
  //  否则"改了锁没重跑快照"这一整类失真没有任何一层会知道（`--check` 只比得上面那几项）。
  packageLockSha256: sha256(committedLockText),
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
    packageLockSha256: 'server/package-lock.json（镜像那棵树的钉子）',
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
    console.error('   分两种情形，别混着修：');
    console.error(
      '   ① 只有 `server/package-lock.json` 变了 ⇒ 直接重跑 ' +
        '`node research/tools/gen-image-npm-tree.mjs`（不联网，它现在读的就是这把锁）。',
    );
    console.error(
      '   ② `server/package.json` / 三枚本地包 / Dockerfile 的装法变了 ⇒ 锁本身过期了，' +
        '重跑生成器**不会**造出新锁。要跑一次 `pnpm verify:selfhost-stack`，' +
        '从镜像里取 `/app/package-lock.json` 落成提交物（`check:image-license` 的第 4 步会先在这里判红）。',
    );
    console.error('   然后按 check:image-license 给出的新差集更新 IMAGE_ONLY_PACKAGES。');
    process.exit(1);
  }
  console.log(
    `✅ 镜像依赖快照的输入仍然对得上当下声明：server/package.json + Dockerfile install 形状 + ` +
      `${Object.keys(packedPackageJson).length} 枚打进镜像的本地包（${Object.keys(packedPackageJson).join(' / ')}）`,
  );
  process.exit(0);
}

// ── 3. 快照 = 提交物锁导出的一棵树（**不再联网重解**）───────────────────
// 以前这一步是"替 npm 现场解一遍"，所以它天生是**预测**，而预测与产物之间的差
// 就是那 16/143 一族（审计 §8.30 / §8.38 / §8.43）。现在锁已经是构建输入
// （`server/Dockerfile` 生产阶段 COPY 它），快照与镜像之间不再有"两次解析"这一步，
// 剩下的唯一漂移面是"锁与镜像里的树对不对"，那一面由
// `check-image-license-coverage.mjs --installed-tree` 的双载体判据守（审计 §8.45）。
const derived = deriveFromLock(committedLockText);
const { packages, skippedOtherPlatform } = derived;
const snapshot = {
  _what: '镜像生产阶段（`server/Dockerfile` 的 FROM … AS production）会装的那棵依赖树，**由提交物锁 `server/package-lock.json` 导出**。不是清单、不是许可判定 —— 判定在 research/tools/check-image-license-coverage.mjs。',
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
  fail(
    `从提交物锁里只导出 ${packages.length} 条 —— 不像一棵真的生产树（上次实测 143）。`,
    '  要么锁被截断/改坏，要么平台过滤器读不到 `os`/`cpu`/`libc` 了。别落盘。',
  );
}
if (process.argv.includes('--stdout')) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `✅ 写出 ${outPath.replace(`${repoRoot}/`, '')}：${packages.length} 个包` +
      `（来自提交物锁的 ${derived.entryCount} 条，按 ${TARGET.os}/${TARGET.cpu}/${TARGET.libc} 过滤，` +
      `跳过其他平台变体 ${skippedOtherPlatform} 条）`,
  );
}
