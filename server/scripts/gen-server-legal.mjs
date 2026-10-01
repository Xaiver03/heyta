#!/usr/bin/env node
/**
 * 从 `@heyta/legal` 生成**服务端**要用的对外文本版本快照。
 * =======================================================
 *
 * ```sh
 * node server/scripts/gen-server-legal.mjs          # 写盘
 * node server/scripts/gen-server-legal.mjs --check  # 只校验（门禁用）
 * ```
 *
 * ## 🔴 为什么是"生成 + 提交生成物"，而不是运行时 import `@heyta/legal`
 *
 * 同意留痕要往 `users.terms_document_version` 里写**整套对外文本的版本指纹**，
 * 那个指纹的权威在 `@heyta/legal` 的 `legalSetVersion()`。
 * 但 `server/Dockerfile` 只打包 `packages/{sync-core,shared-schema,domain}` ——
 * **镜像里没有 `@heyta/legal`**（它是九份文本的全量 AST，五十余万字节，
 * 同步服务进程没有理由为了一串版本号把它装进生产镜像）。
 *
 * 所以走仓库里已经用过三次的模式：**生成物 + 门禁**
 * （先例：`gen-server-design.mjs`、`gen-server-copy.ts`、`gen-og-card.mjs`）。
 * 真源仍然只有一份，这里只是把两个值搬过来。
 *
 * ❌ **不要在这里重新拼版本号字符串** —— 那会变成第二套定义，
 * 而"同一个判断写两遍"正是本仓库反复出事的那类缺陷
 * （`license-inventory.mjs` 的判据抄三遍、clientId 回退逻辑两份…）。
 * 本脚本**调用真函数** `legalSetVersion()`，形状由它自己决定。
 *
 * ## ⚠️ 读的是 `dist/`，所以 stale dist 会喂出错值（AGENTS §7 第 27 条同族）
 *
 * 生成物来自 `packages/legal/dist/index.js` 而不是 `src/`。
 * `pnpm check` 的第一件事就是 `pnpm build`（`pnpm -r build`），所以门禁里拿到的是新 dist；
 * 但**单独**跑这条门禁时如果没先 build，可能拿旧 dist 生成旧版本号。
 * 这里不假装能防住这件事，只把要求写进门禁的输出与失败信息里。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..');
const REPO = join(SERVER, '..');
const LEGAL_DIST = join(REPO, 'packages/legal/dist/index.js');
const TARGET = join(SERVER, 'src/legal.generated.ts');

const CHECK = process.argv.includes('--check');

const loadLegal = async () => {
  if (!existsSync(LEGAL_DIST)) {
    console.error(
      `❌ 找不到 ${relative(REPO, LEGAL_DIST)}。\n` +
        '   本脚本读的是 @heyta/legal 的**构建产物**（版本号由真函数算出，不在这里重拼）。\n' +
        '   先跑：pnpm --filter @heyta/legal build',
    );
    process.exit(1);
  }
  return import(pathToFileURL(LEGAL_DIST).href);
};

const render = (setVersion, hostedDomain) => `/**
 * 🔴 **生成物 —— 不要手改。**
 *
 * 由 \`server/scripts/gen-server-legal.mjs\` 从 \`@heyta/legal\` 生成，
 * \`pnpm check:server-legal\` 钉住它与真源一致。
 *
 * 为什么要生成而不是 import：\`server/Dockerfile\` 不打包 \`@heyta/legal\`
 * （九份对外文本的全量 AST，同步服务进程不该为两个字符串装它）。
 * 真源只有一份，理由与写法见 \`server/scripts/gen-server-legal.mjs\` 文件头。
 */

/**
 * **整套对外文本的版本指纹**，形如 \`terms@1.0;privacy@1.0;…\`（按 id 排序）。
 *
 * 它是 \`users.terms_document_version\` 里写进去的那个值，也就是对外文本
 * 「同意留痕」那一条承诺的东西：用户勾选时同意的是一**套**文件，
 * 所以钉住的是整套指纹，而不是单份文件的版本。
 *
 * ⚠️ 只有**官方托管实例**才有权写它（判定在 \`src/legal-consent.ts\`）：
 * 自托管机器对外发布的是运营者自己的文本，它的版本我们无法命名。
 */
export const LEGAL_SET_VERSION = ${JSON.stringify(setVersion)};

/**
 * 官方托管实例的域名 —— \`@heyta/legal\` 的 \`OPERATOR.hostedDomain\`。
 *
 * ⚠️ 这是这个域名的**第三份**拷贝（前两份：\`@heyta/legal\` 本体、
 * \`packages/app-host/src/legal-links.ts\` 的 \`OFFICIAL_SITE_ORIGIN\`）。
 * \`pnpm check:legal-host\` 逐字对账三份，漂移即红 ——
 * 客户端与服务端在这件事上给出不同答案，就是"注册时展示的文本"与
 * "留痕里写下的版本"指向两套东西，而那正是留痕要防的事。
 */
export const OFFICIAL_HOSTED_DOMAIN = ${JSON.stringify(hostedDomain)};
`;

const main = async () => {
  const legal = await loadLegal();
  const setVersion = legal.legalSetVersion();
  const hostedDomain = legal.OPERATOR.hostedDomain;
  // 版本指纹不许是空串：真源里删光文档时，生成物会变成"同意了一套空文本"，
  // 而那看起来和正常记录一模一样。
  if (typeof setVersion !== 'string' || setVersion.split(';').length < 2) {
    console.error(`❌ legalSetVersion() 返回的形状不像版本指纹：${JSON.stringify(setVersion)}`);
    process.exit(1);
  }

  const expected = render(setVersion, hostedDomain);
  const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';

  if (CHECK) {
    if (current !== expected) {
      console.error(
        `❌ server/${relative(SERVER, TARGET)} 与 @heyta/legal 不一致。\n` +
          `   当前版本指纹：${setVersion}\n` +
          '   修复：node server/scripts/gen-server-legal.mjs（改了对外文本的版本号就要重生成）',
      );
      process.exit(1);
    }
    console.log(`✅ 服务端对外文本快照与真源一致：${setVersion}`);
    return;
  }

  writeFileSync(TARGET, expected);
  console.log(`✅ 已生成 server/${relative(SERVER, TARGET)}（${setVersion}）`);
};

await main();
