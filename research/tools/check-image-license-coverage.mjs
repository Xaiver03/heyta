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
//       node research/tools/check-image-license-coverage.mjs --installed-tree <dump.json>
//
// 🔴 **两种载体，别把它们读成同一件事**（2026-10-04 加的第二种，审计 §8.43）：
//  · 不带 `--installed-tree`：对的是 `server/image-npm-tree.json` —— 那是**预测**
//    （`gen-image-npm-tree.mjs` 替 npm 解析出来的树）。它能挂在 `pnpm check` 上，因为它不需要 docker。
//  · 带 `--installed-tree`：对的是 `research/tools/dump-installed-tree.js` 在**跑起来的镜像里**
//    枚举出来的那棵树 —— 那才是发出去的字节。实测两者确实有差（版本漂 1 条、平台变体各一枚），
//    所以"门禁绿"这句话只有第二种载体成立时才是对外承诺。
//    它由 `scripts/verify-selfhost-stack.sh` 在每次全跑时调用（链外门禁，消费者可验：见 §8.19 那套）。
//  · 第二种载体还多一条判定：**包自己声明的 license 必须等于登记表里抄的那一条**。
//    预测快照里没有 license 字段，所以这条只能在真树上跑 —— 它拦的是
//    "上游把 MIT 改成 GPL 而版本号没变，于是没有任何一层会重新看它"。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageInstallShape } from './image-install-shape.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const quiet = process.argv.includes('--quiet');
const SNAPSHOT = join(repoRoot, 'server/image-npm-tree.json');
const treeArgIdx = process.argv.indexOf('--installed-tree');
const INSTALLED_TREE = treeArgIdx < 0 ? null : process.argv[treeArgIdx + 1];
if (treeArgIdx >= 0 && !INSTALLED_TREE) {
  console.error('❌ `--installed-tree` 后面没有路径 —— 参数被吃掉不等于"用预测快照"。');
  process.exit(1);
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// 本仓库自己的包会被打进镜像（`pnpm pack` 出来的三枚 tgz）。它们不可能出现在
// "扫第三方依赖"的集合里，但**不等于免检**：判定要求镜像里那个包自己声明的 license
// 与 `packages/<name>/package.json` 里的声明**逐字相同**，两边都必须宽松。
// 少任何一边 ⇒ 红（"产物里没声明"正是 2026-10-04 量到的那两枚 sync-core / shared-schema 的形状）。
const FIRST_PARTY_IN_IMAGE = {
  '@heyta/sync-core': 'packages/sync-core',
  '@heyta/shared-schema': 'packages/shared-schema',
  '@heyta/domain': 'packages/domain',
};


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
    carrier: 'snapshot',
  },
  '@node-rs/argon2-linux-x64-musl@2.2.1': {
    license: 'MIT',
    source: 'https://registry.npmjs.org/@node-rs/argon2-linux-x64-musl/2.2.1',
    checkedAt: '2026-10-03',
    why: '同上，而这一枚是 Alpine 镜像**实际装的就是的那一枚**（libc=musl）',
    carrier: 'snapshot',
  },
  // 🔴 2026-10-04 现量补：镜像是在 arm64 那台机器上构建的，装的就是这一枚而不是上面两枚 x64。
  // 它由 `--installed-tree`（真树载体）照出来 —— 预测快照钉的是 linux/x64/musl，
  // 所以这条登记在只跑快照的模式里**永远不会被要求**。这正是 G-53 说的那一整类。
  '@node-rs/argon2-linux-arm64-musl@2.2.1': {
    license: 'MIT',
    source: 'https://registry.npmjs.org/@node-rs/argon2-linux-arm64-musl/2.2.1',
    checkedAt: '2026-10-04',
    why: '按宿主架构切的可选原生变体；门禁在 darwin-arm64 上扫 pnpm store，装的是 darwin-arm64 那一枚，' +
      '所以任何 linux 变体都不在扫描集里。license 同时核过镜像内该包自己的 package.json（MIT）',
    carrier: 'installed-tree',
  },

  // 同名不同版本：pnpm-lock.yaml 只在人手动 `pnpm update` 时才前进，
  // 而 npm 每次构建都取 `^` 范围内最新 ⇒ 两条解析路必然漂。
  '@fastify/static@10.1.5': { license: 'MIT', source: 'https://registry.npmjs.org/@fastify/static/10.1.5', checkedAt: '2026-10-03', why: 'pnpm 锁在 10.1.4' },
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
  // 🔴 2026-10-04 由 `--installed-tree`（真树载体）第一次照出来：预测快照钉在 11.3.1，
  // 而**两趟独立构建的镜像里都是 11.3.3**。这条就是"快照在漂"的那一条本身 ——
  // 它以前只能靠人肉比对（审计 §8.38），现在这条门禁会自己说。
  '@fastify/websocket@11.3.3': {
    license: 'MIT',
    source: 'https://registry.npmjs.org/@fastify/websocket/11.3.3',
    checkedAt: '2026-10-04',
    why: 'pnpm-lock 锁在 11.3.1，而 npm 每次构建取 ^11.3.0 范围内最新 ⇒ 两条解析路必然漂',
    carrier: 'installed-tree',
  },
};

const PERMISSIVE_LICENSES = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', '0BSD', 'Unlicense', 'CC0-1.0',
]);
const REGEN = 'node research/tools/gen-image-npm-tree.mjs';
const findings = [];
const report = (title, lines) => findings.push({ title, lines });

// ── 输入层：读不到就响亮失败，不许"没东西可对"变成绿 ────────────────
let snapshot;
let carrier;
if (INSTALLED_TREE) {
  let dump;
  try {
    dump = JSON.parse(readFileSync(INSTALLED_TREE, 'utf8'));
  } catch (e) {
    console.error(`❌ 读不到镜像现量树 ${INSTALLED_TREE}：${e.message}`);
    console.error('   生成：docker run --rm -i --entrypoint node <image> --input-type=commonjs - < ' +
      'research/tools/dump-installed-tree.js > ' + INSTALLED_TREE);
    process.exit(1);
  }
  if (!Array.isArray(dump.packages) || dump.packages.length === 0) {
    console.error('❌ 这棵现量树里没有 packages —— 对账没有输入，不能算通过。');
    process.exit(1);
  }
  if (typeof dump.root !== 'string' || typeof dump.scannedEntries !== 'number') {
    console.error('❌ 现量树缺 root / scannedEntries —— 无法证明它真的遍历过镜像里的目录。');
    process.exit(1);
  }
  // 归一成与快照同形，好让下面三层判定只有一份实现。
  snapshot = {
    packages: dump.packages.map((p) => ({ name: p.name, version: p.version, license: p.license ?? null })),
    generatedAt: `镜像内 ${dump.root}（扫到 ${dump.scannedEntries} 个目录项）`,
    installedTree: true,
  };
  carrier = '真镜像里装上的那棵树';
} else {
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  } catch (e) {
    console.error(`❌ 读不到镜像依赖快照 server/image-npm-tree.json：${e.message}`);
    console.error(`   生成：${REGEN}（要联网）`);
    process.exit(1);
  }
  carrier = '预测快照';
}
if (!Array.isArray(snapshot.packages) || snapshot.packages.length === 0) {
  console.error('❌ 快照里没有 packages 数组或它是空的 —— 对账没有输入，不能算通过。');
  process.exit(1);
}
// 哨兵：解析层悄悄退化时，`[].filter()` 会一路绿。这两个 needle 必须在。
if (snapshot.packages.length < 100) {
  console.error(`❌ 只有 ${snapshot.packages.length} 条，不像一棵真的生产树 ⇒ 解析或生成层坏了。`);
  process.exit(1);
}
for (const needle of ['fastify', '@prisma/client', 'zod']) {
  if (!snapshot.packages.some((p) => p.name === needle)) {
    console.error(`❌ 找不到 ${needle} —— 它一定在服务端生产树里，说明读错了东西。`);
    process.exit(1);
  }
}
// 现量树的 license 那一列必须有牙：全 null 意味着 dump 脚本退化成了只读名字，
// 那样"登记 vs 声明"那条判定会静默变成永真。
if (snapshot.installedTree && snapshot.packages.filter((p) => typeof p.license === 'string').length < 100) {
  console.error(
    `❌ 现量树里声明了 license 的只有 ${String(
      snapshot.packages.filter((p) => typeof p.license === 'string').length,
    )} 条（<100）⇒ dump 脚本没把包自己的 license 字段读出来，"登记=声明"那条判定会假绿。`,
  );
  process.exit(1);
}

// ── 新鲜度：快照描述的必须是**当下**这套声明（只对预测快照成立）──────
const stale = [];
const currentPkgSha = sha256(readFileSync(join(repoRoot, 'server/package.json'), 'utf8'));
if (!INSTALLED_TREE && currentPkgSha !== snapshot.inputs?.serverPackageJsonSha256) {
  stale.push('server/package.json 变了（快照里的哈希与当下不一致）');
}
let currentShapeSha = null;
if (!INSTALLED_TREE) {
  try {
    currentShapeSha = sha256(readImageInstallShape(join(repoRoot, 'server/Dockerfile')).normalizedShape);
  } catch (e) {
    stale.push(`Dockerfile 的生产阶段读不出来了：${e.message}`);
  }
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

// ── 判定 1：树里的每一条都要有出处 ────────────────────────────────
const covered = [];
const exempted = [];
const unexplained = [];
const badLicense = [];
const firstParty = [];
const declaredMismatch = [];
// 本仓库自己的包：源码侧声明与**镜像里那个包**的声明必须逐字相同且宽松。
// 这一条只在现量树上有意义（快照里没有 license 字段），但它抓到过真东西：
// 2026-10-04 现量，@heyta/sync-core 与 @heyta/shared-schema 在镜像里 license=null，
// 而它们的 LICENSE 文件确实是 MIT —— 也就是"发出去的产物自称无授权"。
const sourceLicense = (dirRel) => {
  const file = join(repoRoot, dirRel, 'package.json');
  if (!existsSync(file)) return `（源码侧读不到 ${dirRel}/package.json）`;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).license ?? '(缺 license 字段)';
  } catch {
    return '(解析失败)';
  }
};
// 声明是否"可以接受"的**唯一裁决**：与门禁其余部分同一套权威 —— 宽松表，或
// `license-inventory.mjs` 的 `REVIEWED_OTHER` 里逐条登记过的具体 name@version。
// 🔴 这里**不许**再抄一份更严的策略：第一版我写成"只看 PERMISSIVE_LICENSES"，于是
// glob/lru-cache/minimatch/minipass/path-scurry（BlueOak-1.0.0）与 nodemailer（MIT-0）
// 被这条新腿判红 —— 而它们在 pnpm store 里早就被 `REVIEWED_OTHER` 逐条判过。
// 两套定义 = 一个会漂移的策略，而且这次是"更严的那套在真树载体上先响"，
// 症状看起来像"镜像里混进了不合格许可"，实际是这条腿自己另立了政策。
const declaredAcceptable = (id, declared) =>
  (declared && PERMISSIVE_LICENSES.has(declared)) || reviewedOther.has(id);

for (const p of snapshot.packages) {
  const id = `${p.name}@${p.version}`;
  const declared = typeof p.license === 'string' ? p.license : null;
  if (
    declared &&
    !FIRST_PARTY_IN_IMAGE[p.name] &&
    !declaredAcceptable(id, declared) &&
    !(scanned.get(id) && (scanned.get(id).kind === 'permissive' || reviewedOther.has(id)))
  ) {
    badLicense.push(
      `${id}  包自己声明的 license=${declared} —— 既不在宽松表，也没有在 REVIEWED_OTHER 或镜像独有表里逐条判过`,
    );
  }
  if (FIRST_PARTY_IN_IMAGE[p.name]) {
    const src = sourceLicense(FIRST_PARTY_IN_IMAGE[p.name]);
    firstParty.push(id);
    if (!declared) {
      declaredMismatch.push(
        `${id}  镜像里那个包**没有声明 license**（源码侧 ${FIRST_PARTY_IN_IMAGE[p.name]}/package.json 写的是 ${src}）`,
      );
    } else if (declared !== src) {
      declaredMismatch.push(`${id}  镜像里声明=${declared} 而源码侧声明=${src}`);
    } else if (!PERMISSIVE_LICENSES.has(declared)) {
      declaredMismatch.push(`${id}  两边一致但 ${declared} 不是宽松许可`);
    }
    continue;
  }
  const hit = scanned.get(id);
  if (hit) {
    covered.push(id);
    const ok = hit.kind === 'permissive' || reviewedOther.has(id);
    if (!ok) badLicense.push(`${id}  门禁分类=${hit.kind}  license=${hit.license}`);
    if (declared && hit.license && declared !== hit.license) {
      declaredMismatch.push(
        `${id}  包自己声明=${declared} 而门禁从 pnpm store 读到=${hit.license} —— 两条路看到的不是同一件事`,
      );
    }
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
  // 登记是**人抄的**，所以它自己会漂：镜像里那个包声明的必须与抄的这条相同。
  if (declared && declared !== rec.license) {
    declaredMismatch.push(`${id}  登记=${rec.license} 而镜像里包自己声明=${declared}（登记过期或上游改了）`);
  }
}
if (unexplained.length > 0) {
  report(`${carrier}里有 ${unexplained.length} 条许可证门禁**从没见过**的包`, [
    ...unexplained,
    '逐条查注册表的 license，判过的写进 check-image-license-coverage.mjs 的 IMAGE_ONLY_PACKAGES' +
      '（要带 license / URL / 日期 / 为什么门禁看不见它）；不宽松的就别让它进镜像。',
  ]);
}
if (badLicense.length > 0) report('有不是宽松许可的条目', badLicense);
if (declaredMismatch.length > 0) {
  report(`有 ${declaredMismatch.length} 条"声明"对不上（抄件过期 / 产物里没声明）`, declaredMismatch);
}


// ── 判定 2：登记表不能只增不减 ───────────────────────────────────
const treeIds = new Set(snapshot.packages.map((p) => `${p.name}@${p.version}`));
// 现量树只覆盖"**这台机器这次构建出来的那一枚镜像**"。平台专属变体在别的架构上才会出现，
// 所以"本次树里没有"不能直接判成过期 —— 那会让同一张表在 arm64 与 x64 上互相打脸。
// 判过期的条件是：**两棵树里都没有**（快照是预测，真树是现量，两边都不出现才是真的没了）。
let snapshotIds = treeIds;
if (INSTALLED_TREE && existsSync(SNAPSHOT)) {
  try {
    const s = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    snapshotIds = new Set([...treeIds, ...(s.packages || []).map((p) => `${p.name}@${p.version}`)]);
  } catch { /* 读不到快照就用现量树自己判 —— 下面仍会响亮地报缺项 */ }
}
const rot = [];
// 🔴 一条登记"只在哪种载体上会出现"必须写明 —— 这是这次加第二载体时唯一站得住的过期规则。
//  预测快照钉死一个 `TARGET`（linux/x64/musl）且把版本钉在它自己那次解析上，
//  所以"真树有而快照没有"（arm64 变体、npm 取到比 pnpm 锁更新的版本）与反过来
//  那两种情形**都不是过期**，按单枚判会让同一张表在两种载体上互相打脸。
//  规则：登记项声明了 `carrier` 且当前跑的不是那种载体 ⇒ 跳过"不在树里就算过期"；
//  `carrier` 写了别的值 ⇒ 直接红（不许拿这个字段当逃避过期检查的后门）。
//  没写 `carrier` 的登记项仍然在**两种**载体下都要求出现 —— 绝大多数条目该这样。
const KNOWN_CARRIERS = new Set(['snapshot', 'installed-tree']);
const currentCarrier = INSTALLED_TREE ? 'installed-tree' : 'snapshot';
for (const id of Object.keys(IMAGE_ONLY_PACKAGES)) {
  const rec = IMAGE_ONLY_PACKAGES[id];
  if (rec.carrier !== undefined && !KNOWN_CARRIERS.has(rec.carrier)) {
    rot.push(`${id}  登记的 carrier=${rec.carrier} 不是 ${[...KNOWN_CARRIERS].join(' / ')} 之一 —— 这不是"跳过检查"的开关`);
    continue;
  }
  if (rec.carrier !== undefined && rec.carrier !== currentCarrier) continue;
  if (!snapshotIds.has(id)) {
    rot.push(`${id} 已经不在${INSTALLED_TREE ? '真树' : '快照'}里了（登记该删，或给它写 carrier）`);
  } else if (scanned.has(id)) rot.push(`${id} 现在**已经**在门禁扫描集里 ⇒ 豁免不再成立，删掉这条登记`);

}
if (rot.length > 0) report(`IMAGE_ONLY_PACKAGES 里有 ${rot.length} 条已经不成立`, rot);

// ── 判定 3：算术恒等式，不许"两边各数各的" ─────────────────────────
if (covered.length + exempted.length + firstParty.length !== snapshot.packages.length) {
  report('计数不闭合', [
    `covered(${covered.length}) + 豁免(${exempted.length}) + 本仓库自己的包(${firstParty.length}) ` +
      `≠ 树的总数(${snapshot.packages.length})`,
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
    `✅ 镜像依赖对账（载体：${carrier}）：${snapshot.packages.length} 条 = 门禁扫描集里 ${covered.length} 条 ` +
      `+ 逐条登记过的镜像独有 ${exempted.length} 条 + 本仓库自己的包 ${firstParty.length} 条` +
      '（无解释 0 · 非宽松 0 · 声明对不上 0 · 失效登记 0）',
  );
  console.log(
    INSTALLED_TREE
      ? '   载体是**跑起来的镜像里那棵树**，所以这句是对着发出去的字节说的。'
      : `   ⚠️ 这**不是**"镜像的树被钉住了"：快照描述 ${snapshot.generatedAt} 那一次 npm 解析的结果，` +
        '而每次构建 npm 都会重解（没有 lockfile）。把树钉住才是闭合，已登记 G-47；' +
        '`scripts/verify-selfhost-stack.sh` 会用 --installed-tree 对真树再跑一遍。',
  );
}
process.exit(0);
