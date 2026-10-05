/**
 * 每个 `*.integration.spec.ts` 都必须被某条 `test:integration*` 脚本点名 ——
 * 否则它**永远不会跑**。
 *
 * 🔴 为什么需要这条门禁（机制，不是风格问题）：
 * `server/vitest.config.ts` 的 `exclude` 把整个 `tests/integration` 子树里的
 * `*.integration.spec.ts` 都挡在默认通道外
 * （理由写在它旁边的注释里：那些用例要真实 PostgreSQL，`pnpm -r test` 跑不了）。
 * 于是**默认通道看不见它们**，而唯一能让它们跑起来的，是 `server/package.json` 里
 * 那几条 `test:integration*` 脚本**逐个点名**的文件参数。
 *
 * 这就留下了一个静默失效面：**新建一个集成用例、没往脚本里加名字 —— 什么都不发生。**
 * 文件在、`vitest run` 单点它能绿、CI 不会红、`pnpm -r test` 报"全部通过"，
 * 而那条用例从落地那天起一次都没执行过。它保护的东西因此没有任何一层在守，
 * 而它的存在会让人以为有。
 *
 * 本仓库已经踩到过：`ai-metering-race.integration.spec.ts`（托管额度"同一条语句里
 * 读占用 + 裁决 + 自增"的**真库并发**证据，AGENTS §8 第 15 条要求的那种判据）
 * 2026-10-05 写完后就没出现在任何脚本里；同一天 `check:ai-quota` 打印的是
 * 「计量**已实现**」。两句同时成立，因为门禁核的是代码在不在，而"跑没跑过"
 * 不属任何一层的判据。
 *
 * ⚠️ 两个方向都要查，只查一个会漏一半：
 *   - 盘上有、脚本没点名 ⇒ 永不执行（上面那个事故）。
 *   - 脚本点名了、盘上没有 ⇒ 那条脚本跑到这里就报错或被忽略，而清单读起来"覆盖到了"
 *     （改名/删文件都会落在这里 —— 而删掉的用例不会自己通知任何人）。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'server');
const INTEGRATION_DIR = join(SERVER, 'tests/integration');
const SUFFIX = '.integration.spec.ts';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// 1. 枚举盘上的集成用例。目录缺失或为空 = 探针够不着，不是"没有违规"。
if (!existsSync(INTEGRATION_DIR)) {
  fail(
    '`server/tests/integration` 这个目录不存在 —— 本门禁无从判定。\n' +
      `     这不是"没有违规"，这是探针够不着：检查目录是否被移动或改名。`,
  );
}
const onDisk = readdirSync(INTEGRATION_DIR)
  .filter((f) => f.endsWith(SUFFIX))
  .sort();
if (onDisk.length === 0) {
  fail(
    '`server/tests/integration/` 里一个 `*.integration.spec.ts` 都没有 —— 本门禁无从判定。\n' +
      '     要么整个真库测试通道被删了（那要响亮地知道），要么命名约定变了\n' +
      '     （`vitest.config.ts` 的 exclude 与本脚本都按 `*.integration.spec.ts` 匹配）—— 两处必须一起改。',
  );
}

// 2. 收集所有 `test:integration*` 脚本点到的文件名。
const pkg = JSON.parse(readFileSync(join(SERVER, 'package.json'), 'utf8'));
const integrationScripts = Object.entries(pkg.scripts ?? {}).filter(([key]) =>
  /^test:integration/.test(key),
);
if (integrationScripts.length === 0) {
  fail(
    '`server/package.json` 里没有任何 `test:integration*` 脚本 —— 那真库用例就**没有运行通道**。\n' +
      '     （默认 `pnpm test` 会 exclude 掉它们，理由见 `server/vitest.config.ts`。）',
  );
}

const listed = new Map(); // filename -> [script key, ...]
for (const [key, command] of integrationScripts) {
  for (const token of String(command).split(/\s+/)) {
    const base = token.split('/').pop();
    if (base?.endsWith(SUFFIX)) {
      if (!listed.has(base)) listed.set(base, []);
      listed.get(base).push(key);
    }
  }
}

const neverRun = onDisk.filter((f) => !listed.has(f));
const dangling = [...listed.keys()].filter((f) => !onDisk.includes(f)).sort();

if (neverRun.length > 0 || dangling.length > 0) {
  const parts = [];
  if (neverRun.length > 0) {
    parts.push(
      `🔴 **盘上有、没有脚本点名**（${String(neverRun.length)} 个，它们从建立起一次都不会跑）：\n` +
        neverRun.map((f) => `     - ${f}`).join('\n'),
    );
  }
  if (dangling.length > 0) {
    parts.push(
      `🔴 **脚本点名了、盘上没有**（${String(dangling.length)} 个 —— 用例被改名或删除，而清单还写着它）：\n` +
        dangling
          .map((f) => `     - ${f}（${listed.get(f).join(' / ')}）`)
          .join('\n'),
    );
  }
  fail(
    `真库集成用例与运行脚本**没有对上**（盘上 ${String(onDisk.length)} 个，被点名 ${String(listed.size)} 个）：\n\n` +
      parts.join('\n\n') +
      '\n\n     修法：把文件名加进（或从中删掉）`server/package.json` 的 `test:integration:postgres`。\n' +
      '     需要外部服务（真 SMTP 之类）的，另开一条 `test:integration:<名字>` 也算点名 ——\n' +
      '     🔴 **不许为了变绿把它们塞进 `pnpm -r test`**：那 `exclude` 是对的（那些用例要真实\n' +
      '     PostgreSQL，默认通道跑不了），要改的是点名，不是把闸门拆掉。',
  );
}

console.log(
  `✅ 真库集成用例逐一对上运行脚本：盘上 ${String(onDisk.length)} 个，全部被 ${integrationScripts
    .map(([k]) => k)
    .join(' / ')} 点名。`,
);
