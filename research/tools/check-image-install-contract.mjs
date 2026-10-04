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

console.log(
  `✅ 镜像安装合同：prisma CLI 三处同源（package.json @prisma/client ${declaredClient} ` +
    `= Dockerfile 字面量 ${dockerfilePin}${declaredCli ? ` = devDeps prisma ${declaredCli}` : ''}` +
    `，快照 ${String(snapCli)} / ${String(snapClient)}）`,
);
