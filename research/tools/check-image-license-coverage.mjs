// `check:image-license-coverage` —— 发布镜像里那棵依赖树，逐条对到许可证门禁的扫描集上。
//
// 为什么要有它（现量结论见 docs/research/self-host-distribution-audit.md §8.8）：
// `check:licenses` 扫的是**根 + e2e 两个 pnpm store**，而 `server/Dockerfile` 的
// 生产阶段用 **npm** 装依赖，仓库里**没有 npm lockfile** —— 于是"门禁绿"证明的是
// 开发机上那棵树，**不是发出去的那一棵**。2026-10-03 实测：镜像树 143 条里
// 有 16 条门禁从没见过（2 个 name 从没出现过，14 个是同名不同版本）。
// 今天这 16 条**逐条查过都是 MIT**，但那是一次人工查的 —— 没有任何一层会拦住
// 下一次漂进来一个 GPL 的传递依赖，也不会有人知道它进来了。
//
// 这条对账补的就是"会有人知道"：
//   · 快照（`server/image-npm-tree.json`，由 `gen-image-npm-tree.mjs` 生成）里的每一条
//     必须在门禁扫描集里**按 name@version** 出现，否则必须在下面这张
//     `IMAGE_ONLY_PACKAGES` 表里**逐条登记过 license 与理由**。
//   · 登记过的每一条都要**仍然成立**：它对应的包仍然不在扫描集里、仍然在快照里。
//     ⇒ 这张表只能跟着现实变小，不会变成一堆谎话（与 `check:server-env` 的豁免同一设计）。
//   · 快照的 `inputs` 哈希对不上当下的 `server/package.json` 或 Dockerfile 那三条
//     `npm install` ⇒ 红，并给出重跑命令。
//
// 🔴 它**没有**把洞补上 —— 补上要把镜像那棵树钉住（`pnpm deploy --prod`，G-47）。
// 快照描述的是"2026-10-03 这一次解析出来的树"，而每次镜像构建都会重解一遍。
// 它保证的是：**这件事不再是静默的** —— 只要有人重跑生成（改了直接依赖就必须重跑），
// 漂移就会现形；纯传递依赖的上游发新版这一类漂移，仍然只有真去构建镜像才能发现，
// 那条已登记成 G-47 而没有假装这里已经做到。
//
// 用法：node research/tools/check-image-license-coverage.mjs [--quiet]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageInstallShape } from './image-install-shape.mjs';
// 新鲜度指纹与生成器共用同一份（两套实现 = 两套裁决标准）。
import { depsFingerprint } from './image-deps-fingerprint.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const quiet = process.argv.includes('--quiet');
const SNAPSHOT = join(repoRoot, 'server/image-npm-tree.json');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// 镜像里装了、但**结构上不可能**出现在 pnpm 扫描集里的包，逐条登记。
// 每条都要写：注册表上声明的 license、在哪个 URL 查到的、查的日期、以及"为什么
// 门禁看不见它"。**不许写"应该没问题"** —— 那一栏是这个文件存在的意义。
const IMAGE_ONLY_PACKAGES = {
  // 平台专属的原生二进制：门禁在 macOS/arm64 上扫 store，装的是 darwin-arm64 那一枚，
  // 所以 linux 变体在两个 pnpm store 里**从来不存在**。
  '@node-rs/argon2-linux-x64-gnu@2.2.1': {
    license: 'MIT',
    source: 'https://registry.npmjs.org/@node-rs/argon2-linux-x64-gnu/2.2.1',
    checkedAt: '2026-10-03',
    why: 'linux-x64 的可选原生变体；本机（darwin-arm64）的 pnpm store 里没有它',
  },
  '@node-rs/argon2-linux-x64-musl@2.2.1': {
    license: 'MIT',
    source: 'https://registry.npmjs.org/@node-rs/argon2-linux-x64-musl/2.2.1',
    checkedAt: '2026-10-03',
    why: '同上，而这一枚是 Alpine 镜像**实际装的就是的那一枚**（libc=musl）',
  },
  // 同名不同版本：pnpm-lock.yaml 只在人手动 `pnpm update` 时才前进，
  // 而 npm 每次构建都取 `^` 范围内最新 ⇒ 两条解析路必然漂。
  '@fastify/static@10.1.5': { license: 'MIT', source: 'https://registry.npmjs.org/@fastify/static/10.1.5', checkedAt: '2026-10-03', why: 'pnpm 锁在 10.1.4' },
  '@fastify/websocket@11.3.3': { license: 'MIT', source: 'https://registry.npmjs.org/@fastify/websocket/11.3.3', checkedAt: '2026-10-04', why: 'npm 镜像解析到 2026-10-03 新发布的 11.3.3，pnpm store 未含此版本；已核对发布 tarball 的 package/LICENSE 为 MIT' },
  '@peculiar/asn1-android@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-android/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-cms@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-cms/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-csr@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-csr/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-ecc@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-ecc/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-pfx@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-pfx/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-pkcs8@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-pkcs8/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-pkcs9@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-pkcs9/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-rsa@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-rsa/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-schema@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-schema/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-x509-attr@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-x509-attr/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  '@peculiar/asn1-x509@2.10.0': { license: 'MIT', source: 'https://registry.npmjs.org/@peculiar/asn1-x509/2.10.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 2.9.5' },
  'pino@10.4.0': { license: 'MIT', source: 'https://registry.npmjs.org/pino/10.4.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 10.3.1' },
  'ws@8.22.0': { license: 'MIT', source: 'https://registry.npmjs.org/ws/8.22.0', checkedAt: '2026-10-03', why: 'pnpm 锁在 8.21.3' },
};

const PERMISSIVE_LICENSES = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', '0BSD', 'Unlicense', 'CC0-1.0',
]);
const REGEN = 'node research/tools/gen-image-npm-tree.mjs';
const findings = [];
const report = (title, lines) => findings.push({ title, lines });

// ── 输入层：读不到就响亮失败，不许"没东西可对"变成绿 ────────────────
let snapshot;
try {
  snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
} catch (e) {
  console.error(`❌ 读不到镜像依赖快照 server/image-npm-tree.json：${e.message}`);
  console.error(`   生成：${REGEN}（要联网）`);
  process.exit(1);
}
if (!Array.isArray(snapshot.packages) || snapshot.packages.length === 0) {
  console.error('❌ 快照里没有 packages 数组或它是空的 —— 对账没有输入，不能算通过。');
  process.exit(1);
}
// 哨兵：解析层悄悄退化时，`[].filter()` 会一路绿。这两个 needle 必须在。
if (snapshot.packages.length < 100) {
  console.error(`❌ 快照只有 ${snapshot.packages.length} 条，不像一棵真的生产树 ⇒ 解析或生成层坏了。`);
  process.exit(1);
}
for (const needle of ['fastify', '@prisma/client', 'zod']) {
  if (!snapshot.packages.some((p) => p.name === needle)) {
    console.error(`❌ 快照里找不到 ${needle} —— 它一定在服务端生产树里，说明生成器读错了东西。`);
    process.exit(1);
  }
}

// ── 新鲜度：快照描述的必须是**当下**这套声明 ──────────────────────
const stale = [];
const currentPkgSha = depsFingerprint(readFileSync(join(repoRoot, 'server/package.json'), 'utf8'));
if (currentPkgSha !== snapshot.inputs?.serverPackageJsonSha256) {
  stale.push('server/package.json 变了（快照里的哈希与当下不一致）');
}
let currentShapeSha = null;
try {
  currentShapeSha = sha256(readImageInstallShape(join(repoRoot, 'server/Dockerfile')).normalizedShape);
} catch (e) {
  stale.push(`Dockerfile 的生产阶段读不出来了：${e.message}`);
}
if (currentShapeSha && currentShapeSha !== snapshot.inputs?.installShapeSha256) {
  stale.push('server/Dockerfile 里生产阶段那几条 install 命令的形状变了');
}
if (stale.length > 0) {
  report('快照已经不代表当下的声明', [
    ...stale,
    `重跑：${REGEN}（联网），然后按它给出的新差集更新本脚本的 IMAGE_ONLY_PACKAGES`,
  ]);
}

// ── 门禁的扫描集 ─────────────────────────────────────────────────
let inventory;
try {
  inventory = JSON.parse(
    execFileSync('node', [join(repoRoot, 'research/tools/license-inventory.mjs'), '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
} catch (e) {
  console.error(`❌ 跑 license-inventory.mjs --json 失败：${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  console.error('   没有扫描集，这条对账证明不了任何事 —— 判红而不是跳过。');
  process.exit(1);
}
const scanned = new Map();
for (const e of inventory.all || []) scanned.set(`${e.name}@${e.version}`, e);
const reviewedOther = new Set((inventory.reviewedOther || []).map((e) => `${e.name}@${e.version}`));
if (scanned.size < 100) {
  console.error(`❌ 门禁扫描集只有 ${scanned.size} 条（上次实测 961）⇒ 读错了东西，判红。`);
  process.exit(1);
}

// ── 判定 1：快照的每一条都要有出处 ────────────────────────────────
const covered = [];
const exempted = [];
const unexplained = [];
const badLicense = [];
for (const p of snapshot.packages) {
  const id = `${p.name}@${p.version}`;
  const hit = scanned.get(id);
  if (hit) {
    covered.push(id);
    const ok = hit.kind === 'permissive' || reviewedOther.has(id);
    if (!ok) badLicense.push(`${id}  门禁分类=${hit.kind}  license=${hit.license}`);
    continue;
  }
  const rec = IMAGE_ONLY_PACKAGES[id];
  if (!rec) {
    unexplained.push(`${id}${p.optional ? '  [optional]' : ''}`);
    continue;
  }
  exempted.push(id);
  if (!PERMISSIVE_LICENSES.has(rec.license)) {
    badLicense.push(`${id}  登记里的 license=${rec.license} 不在宽松表里 —— 这种条目不该进镜像`);
  }
}
if (unexplained.length > 0) {
  report(`镜像装了 ${unexplained.length} 条许可证门禁**从没见过**的包`, [
    ...unexplained,
    '逐条查注册表的 license，判过的写进 check-image-license-coverage.mjs 的 IMAGE_ONLY_PACKAGES' +
      '（要带 license / URL / 日期 / 为什么门禁看不见它）；不宽松的就别让它进镜像。',
  ]);
}
if (badLicense.length > 0) report('有不是宽松许可的条目', badLicense);

// ── 判定 2：登记表不能只增不减 ───────────────────────────────────
const snapshotIds = new Set(snapshot.packages.map((p) => `${p.name}@${p.version}`));
const rot = [];
for (const id of Object.keys(IMAGE_ONLY_PACKAGES)) {
  if (!snapshotIds.has(id)) rot.push(`${id} 已经不在快照里了（登记该删）`);
  else if (scanned.has(id)) rot.push(`${id} 现在**已经**在门禁扫描集里 ⇒ 豁免不再成立，删掉这条登记`);
}
if (rot.length > 0) report(`IMAGE_ONLY_PACKAGES 里有 ${rot.length} 条已经不成立`, rot);

// ── 判定 3：算术恒等式，不许"两边各数各的" ─────────────────────────
if (covered.length + exempted.length !== snapshot.packages.length) {
  report('计数不闭合', [
    `covered(${covered.length}) + 豁免(${exempted.length}) ≠ 快照总数(${snapshot.packages.length})`,
  ]);
}

if (findings.length > 0) {
  for (const { title, lines } of findings) {
    console.error(`\n❌ ${title}`);
    for (const line of lines) console.error(`   ${line}`);
  }
  console.error(`\n共 ${findings.length} 层判定失败。`);
  process.exit(1);
}
if (!quiet) {
  console.log(
    `✅ 镜像依赖对账：快照 ${snapshot.packages.length} 条 = 门禁扫描集里 ${covered.length} 条 ` +
      `+ 逐条登记过的镜像独有 ${exempted.length} 条（无解释 0 · 非宽松 0 · 失效登记 0）`,
  );
  console.log(
    `   ⚠️ 这**不是**"镜像的树被钉住了"：快照描述 ${snapshot.generatedAt} 那一次 npm 解析的结果，` +
      '而每次构建 npm 都会重解（没有 lockfile）。把树钉住才是闭合，已登记 G-47。',
  );
}
process.exit(0);
