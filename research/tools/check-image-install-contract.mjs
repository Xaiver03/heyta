#!/usr/bin/env node
/**
 * 镜像里**唯一那一枚手写的版本字面量**与它的两个真源之间的等式。
 * ==============================================================================
 *
 * ## 为什么这一条值得存在（它不是"顺手加的对账"）
 *
 * `server/Dockerfile` 生产阶段有一条 `npm install prisma@5.22.0`。那个 `5.22.0` 是
 * **整个仓库里唯一手写的包版本** —— 它有三份存在形式，而当时没有任何一层知道：
 *
 * | 副本 | 位置 | 谁用它 |
 * |---|---|---|
 * | ① `dependencies["@prisma/client"]` | `server/package.json` | 运行时 `dist/src/index.js` 里真正 import 的那个 client |
 * | ② `devDependencies["prisma"]` | `server/package.json` | 开发者本机跑 `migrate-deploy.sh` / `prisma generate` 用的 CLI |
 * | ③ 字面量 `prisma@5.22.0` | `server/Dockerfile` | **镜像里生成 Prisma client 的那个 CLI** |
 *
 * 🔴 ③ 必须存在的原因也被写在那段注释里，而且它和 G-47 是同一件事的两面：
 * `prisma` 在 **devDependencies**，而生产阶段用 `--omit=dev` —— 所以常规那条
 * `npm install` **永远不会装它**，CLI 只能被显式点名。也就是说
 * **"镜像里的 CLI 版本"这件事只由 ③ 决定，而 ③ 不在任何 lockfile 里。**
 *
 * 于是漂移的形状很具体：有人 bump ①（比如 5.22.0 → 5.23.0）而忘了 ③ ——
 * 镜像里 `npx prisma generate` 用 5.22 的引擎生成 client，运行时 `@prisma/client` 是 5.23。
 * Prisma 对这个组合的行为是**运行时报 schema engine 版本不匹配**（在容器里，
 * 迁移已经在生产库上跑过之后），而 `pnpm check` 全绿 —— 链**从来不构建镜像**。
 * Dockerfile 自己那句注释 "IMPORTANT: prisma version must match @prisma/client in package.json"
 * 说的就是这件事：**它是一句提醒，不是一条判据。**
 *
 * ## 这条判据**不**主张的东西（别读多）
 *
 * 它不解决 G-47 的主体（镜像那 143 条来自 npm 的现场解析、不是 pnpm 的 lockfile）。
 * 那 143 条里只有 `prisma` 这一条是被钉住的，而这条判据钉的是"那枚钉子还对着谁"。
 * 主体仍按 `docs/research/self-host-distribution-audit.md` §8.20 的三步走，
 * 需要 docker 与低负载窗口，与 `verify:selfhost-stack` 同一个窗口。
 *
 * ## 用法
 *
 * ```sh
 * node research/tools/check-image-install-contract.mjs              # pnpm check:image-license 的第三条腿
 * node research/tools/check-image-install-contract.mjs --root <dir> # 注入验证用（只读，不动工作树）
 * ```
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageInstallShape } from './image-install-shape.mjs';

const ROOT_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const root = resolve(argOf('root') ?? ROOT_DEFAULT);

const fail = (title, detail) => {
  console.error(`\n❌ ${title}\n${detail}`);
  process.exit(1);
};

const dockerfilePath = join(root, 'server/Dockerfile');
const serverPkgPath = join(root, 'server/package.json');
const snapshotPath = join(root, 'server/image-npm-tree.json');

const serverPkg = JSON.parse(readFileSync(serverPkgPath, 'utf8'));
const declaredClient = serverPkg.dependencies?.['@prisma/client'];
const declaredCli = serverPkg.devDependencies?.prisma ?? serverPkg.dependencies?.prisma;

if (typeof declaredClient !== 'string') {
  fail(
    '`server/package.json` 里没有 `dependencies["@prisma/client"]`',
    '  这条判据的一侧不见了。服务端不再用 Prisma 的话请把这条判据连同 Dockerfile 那条 `prisma@` 一起撤掉，' +
      '不要让它变成一个永远读不到东西的形状。',
  );
}

// ── 1. Dockerfile 里那枚字面量：从"装法"读，不另抄一份 ────────────────────
const shape = readImageInstallShape(dockerfilePath);
const pinned = shape.installs
  .flatMap((inst) => inst.specs)
  .filter((spec) => /^prisma@\d/.test(spec));

if (pinned.length === 0) {
  fail(
    '生产阶段没有 `npm install prisma@<version>` 这一条了',
    '  `prisma` 住在 devDependencies，而生产装依赖带 `--omit=dev` ⇒ 没有这条点名，' +
      '镜像里**根本不会有 prisma CLI**，`npx prisma generate` 那一层会失败。\n' +
      `  读到的 install：\n${shape.installs.map((i) => `    ${i.raw}`).join('\n')}`,
  );
}
if (pinned.length > 1) {
  fail(
    `生产阶段有 ${String(pinned.length)} 条 ` + '`prisma@<version>` 点名',
    `  ${pinned.join(' / ')}\n  同一个包被钉两次，后一条覆盖前一条 —— 到底装哪个取决于 npm，不是取决于我们。`,
  );
}
const dockerfilePin = pinned[0].slice('prisma@'.length);

// ── 2. 等式：字面量 ↔ 两个真源 ───────────────────────────────────────────
if (dockerfilePin !== declaredClient) {
  fail(
    '镜像里的 prisma CLI 与运行时 @prisma/client 不是同一个版本',
    [
      `  server/Dockerfile 钉的是：prisma@${dockerfilePin}`,
      `  server/package.json 声明：@prisma/client = ${declaredClient}`,
      '',
      '  后果发生在**镜像里、生产库上迁移之后**：`npx prisma generate` 用的是 ' +
        `${dockerfilePin} 的引擎，运行时 import 的 @prisma/client 是 ${declaredClient}。`,
      '  而 `pnpm check` 看不见它 —— 链从来不构建镜像（§8.7 记过同一件事）。',
      '',
      `  修法：把 Dockerfile 那条改成 prisma@${declaredClient}（本地 ` +
        '`pnpm --dir server add -D prisma@' +
        declaredClient +
        '` 之后快照也要重跑 `pnpm check:image-license`）。',
    ].join('\n'),
  );
}
if (declaredCli !== undefined && declaredCli !== dockerfilePin) {
  fail(
    '镜像里的 prisma CLI 与开发者本机的 prisma CLI 不是同一个版本',
    [
      `  server/Dockerfile 钉的是：prisma@${dockerfilePin}`,
      `  server/package.json 声明：prisma = ${declaredCli}`,
      '',
      '  两边会各自生成一次 Prisma client：本机那一份进不了镜像、镜像那一份不在本机，',
      '  于是"我本地跑过迁移没问题"这句话对线上那个容器**不成立**。',
    ].join('\n'),
  );
}

// ── 3. 快照：镜像**实际装到**的那两条 ────────────────────────────────────
/**
 * 这一腿不是重复第 2 步：第 2 步比的是"我们打算装什么"，这一步比的是
 * "上一次真的构建出来的那棵树里装的是什么"。它能单独红的情形很具体 ——
 * 有人只改 Dockerfile 的字面量而不重跑生成（`gen-image-npm-tree.mjs --check`
 * 会先因 install 形状哈希而红，但它只会说"重跑生成"；这一腿说的是**哪一枚钉子对不上谁**）。
 */
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const snapVersion = (name) => snapshot.packages?.find?.((p) => p.name === name)?.version;
const snapCli = snapVersion('prisma');
const snapClient = snapVersion('@prisma/client');

const mismatches = [];
if (typeof snapCli === 'string' && snapCli !== dockerfilePin) {
  mismatches.push(`快照里的 prisma=${snapCli} ≠ Dockerfile 钉的 prisma@${dockerfilePin}`);
}
if (typeof snapClient === 'string' && snapClient !== declaredClient) {
  mismatches.push(`快照里的 @prisma/client=${snapClient} ≠ package.json 声明的 ${declaredClient}`);
}
if (mismatches.length > 0) {
  fail(
    '镜像依赖树快照与这两处声明不一致',
    [
      ...mismatches.map((m) => `  · ${m}`),
      '',
      `  快照：${snapshotPath}（generatedAt=${String(snapshot.generatedAt)}）`,
      '  要么镜像的装法变了而快照没重跑，要么快照代表的是**上一版镜像** ——',
      '  两种情况都意味着 `check:image-license-coverage` 现在对着一个没人装过的树打分。',
    ].join('\n'),
  );
}

// ── 4. 提交物锁：在场、真的被生产阶段读、且覆盖每一条声明 ────────────────
/**
 * G-47 这一批选的形状（审计 §8.46 结论四）：把**提交物锁当构建输入**塞进 /app，
 * 而三条安装命令一个字不改（仍是 `npm install`，不是 `npm ci` —— `npm ci` 在这里
 * 要么冷缓存 EINTEGRITY 当场炸、要么热缓存 rc=0 **静默装上一版我们自己的代码**）。
 *
 * 🔴 这个形状的全部价值压在一件事上：**锁还对着当下的声明**。
 * 一旦有人给 `server/package.json` 加了一条依赖而没重生成锁，
 * `npm install` 照样成功（它把缺的那条现解一次，只有那一条不钉），
 * 于是锁退化成一份没人读的装饰品 —— 而"装饰品"和"钉子"在构建日志里长得一模一样。
 * 所以这一腿不是"顺手加的对账"：它是这个形状成立的前提。
 */
const lockPath = join(root, 'server/package-lock.json');
let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (e) {
  fail(
    '读不到提交物锁 `server/package-lock.json`',
    `  ${e.message}\n` +
      '  镜像那棵树的第三方层现在**没有钉子**了：每次构建由 npm 现场重解，' +
      '而"外人晚半年 build 老 tag 拿到同一棵树"这句不再成立。\n' +
      '  重生成：`pnpm verify:selfhost-stack` 跑完从镜像里取 ' +
      '`/app/package-lock.json`（理由见 server/Dockerfile 那段注释与审计 §8.46）。',
  );
}
if (lock.lockfileVersion !== 3) {
  fail(
    `提交物锁的 lockfileVersion=${String(lock.lockfileVersion)}，不是 3`,
    '  下面那几条判据（键是 `node_modules/<name>` 路径、名字不在值里）是按 v3 的形状写的。' +
      'npm 大版本换了锁的形状，就得先改这条判据，不能让它悄悄读不到东西。',
  );
}
const lockPkgs = lock.packages || {};
const lockEntryCount = Object.keys(lockPkgs).filter((k) => k).length;
if (lockEntryCount < 100) {
  fail(
    `提交物锁里只有 ${lockEntryCount} 个条目，不像一棵真的生产树`,
    '  上次实测 320 条（含 dev 标记的那 162 条）。读空了这条判据就变成永真。',
  );
}

// 4a. 锁必须真的被生产阶段读 —— COPY 要落在**最后一个 FROM 之后**，否则它进的是构建器阶段，
//     镜像里那三条 install 根本看不到它（"提交了锁"与"锁生效"是两件事）。
const dockerfileText = readFileSync(dockerfilePath, 'utf8');
const copyIdx = dockerfileText.search(/^[^\S\n]*COPY[^\n]*package-lock\.json[^\n]*$/m);
const lastFromIdx = dockerfileText.lastIndexOf('\nFROM');
if (copyIdx < 0) {
  fail(
    '`server/Dockerfile` 里没有 COPY 提交物锁这一行',
    '  锁在仓库里躺着但进不了镜像 ⇒ 它是一份没人读的装饰品，而 `pnpm check` 会一直绿。',
  );
}
if (copyIdx < lastFromIdx) {
  fail(
    'COPY 锁那一行落在生产阶段**之前**（最后一个 FROM 之前）',
    '  那意味着它进的是 builder/web 阶段，生产阶段那三条 install 看不到它 —— ' +
      '"锁被读到了"这件事必须由 COPY 的位置来保证，不能靠注释。',
  );
}

// 4b. 覆盖：`server/package.json` 每条 dependencies 都要在锁里有对应条目，且版本对得上范围。
const cmpVer = (a, b) => {
  const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
};
const unsatisfied = [];
const undetermined = [];
let checked = 0;
for (const [name, range] of Object.entries(serverPkg.dependencies || {})) {
  if (name.startsWith('@heyta/')) continue; // 自家包由 tarball 供给，不进锁的 registry 层
  const entry = lockPkgs[`node_modules/${name}`];
  if (!entry || typeof entry.version !== 'string') {
    unsatisfied.push(`${name}（声明 ${range}）—— 锁里**没有这一条**`);
    continue;
  }
  checked += 1;
  const r = String(range).trim();
  const v = entry.version;
  if (r === '*' || r === 'latest') {
    undetermined.push(`${name}@${v}（声明 ${r}：范围里没有可判的下界）`);
  } else if (r.startsWith('^')) {
    const base = r.slice(1);
    if (v.split('.')[0] !== base.split('.')[0] || cmpVer(v, base) < 0) {
      unsatisfied.push(`${name}@${v} 不落在 ${r} 里（主版本不同，或比下界旧）`);
    }
  } else if (r.startsWith('~')) {
    const base = r.slice(1);
    if (`${v.split('.')[0]}.${v.split('.')[1]}` !== `${base.split('.')[0]}.${base.split('.')[1]}` || cmpVer(v, base) < 0) {
      unsatisfied.push(`${name}@${v} 不落在 ${r} 里`);
    }
  } else if (r.startsWith('>=')) {
    if (cmpVer(v, r.slice(2).trim()) < 0) unsatisfied.push(`${name}@${v} 比 ${r} 旧`);
  } else if (cmpVer(v, r) !== 0) {
    unsatisfied.push(`${name}@${v} ≠ 钉死的 ${r}`);
  }
}
if (unsatisfied.length > 0) {
  fail(
    `提交物锁与 server/package.json 的声明对不上（${unsatisfied.length} 处）`,
    [
      ...unsatisfied.map((s) => `  · ${s}`),
      '',
      '  后果不是"构建失败"，是**这一条依赖每次构建现解一次** —— 而 `npm install` 会照常成功。',
      '  锁于是从"钉子"退化成"装饰品"，而这两种状态在构建日志里长得一模一样。',
      '  重生成：见 `server/Dockerfile` 里 COPY 锁那段注释与审计 §8.46（锁取自构建产物，不在宿主机另解一份）。',
    ].join('\n'),
  );
}
// 4c. 反向：锁的根条目不许凭空多出声明里没有的依赖。构建期会改写 package.json，
//     所以**合法例外只有两类**：那三枚 `@heyta/*`（声明形态是 "*"，锁里是 file:），
//     和 `prisma`（Dockerfile 显式点名，见上面第 1/2 步）。其余多出来的一条都要问"谁加的"。
const rootDeps = Object.keys(lockPkgs['']?.dependencies || {});
const declaredDeps = Object.keys(serverPkg.dependencies || {});
const ALLOWED_EXTRA = new Set(['prisma']);
const extraRoot = rootDeps.filter(
  (k) => !declaredDeps.includes(k) && !ALLOWED_EXTRA.has(k) && !k.startsWith('@heyta/'),
);
const missingRoot = declaredDeps.filter((k) => !rootDeps.includes(k));
if (extraRoot.length > 0 || missingRoot.length > 0) {
  fail(
    '锁的根条目与 server/package.json 的依赖清单互相缺项',
    [
      ...extraRoot.map((k) => `  · 锁里多出来：${k}（声明里没有 —— 谁把它加进锁的？）`),
      ...missingRoot.map((k) => `  · 声明里有但锁的根条目没有：${k}`),
      '',
      '  例外只有两类：三枚 `@heyta/*`（构建期被改写成 file:）与 `prisma`（Dockerfile 点名）。',
      '  要加第三类例外就把它写进 `ALLOWED_EXTRA` 并在审计文档里说清为什么。',
    ].join('\n'),
  );
}

console.log(
  `✅ 镜像安装合同：prisma CLI 三处同源（package.json @prisma/client ${declaredClient} ` +
    `= Dockerfile 字面量 ${dockerfilePin}${declaredCli ? ` = devDeps prisma ${declaredCli}` : ''}` +
    `，快照 ${String(snapCli)} / ${String(snapClient)}）\n` +
    `   提交物锁：${lockEntryCount} 条、COPY 在生产阶段、逐条盖住 ${checked} 条声明` +
    `（不判定 ${undetermined.length} 条${undetermined.length > 0 ? `：${undetermined.join('；')}` : ''}）` +
    ' —— 锁不在场或漏一条声明都会红在这里，而不是变成一次没人注意的现解。',
);

