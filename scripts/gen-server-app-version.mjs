#!/usr/bin/env node
/**
 * `check:app-version-server` —— 服务端要有一份「自己部署的 app 版本」，
 * 用作版本策略接口 `latestVersion` 的**默认值**，且必须与根 `package.json` 同源。
 * ============================================================================
 *
 * ## 为什么服务端需要这个数
 *
 * 版本策略接口（`GET /api/app-version`）的 `latestVersion` 默认要取「当前部署的
 * app 版本」——发版后自动变化，不要每次手工改配置。但 `server/` 是一个**独立 package**，
 * 它的 `package.json` 版本（`1.0.0`）是服务端自己的号，不是客户端应用的发版号。
 *
 * 客户端发版号的唯一真源是**仓库根 `package.json` 的 `version`**（`scripts/gen-app-version.mjs`
 * 已把它生成到 `packages/app-host`）。本脚本把**同一个真源**再生成一份到服务端，
 * 让服务端在**不依赖客户端代码**的前提下也知道发版号。
 *
 * 🔴 这不是「第二份版本号」：真源仍只有根 `package.json` 一处。这里是**同一真源的第二个消费者**。
 * 两份生成物（app-host 与 server）都由各自的 `--check` 钉住与真源逐字相同。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/gen-server-app-version.mjs             # 生成/更新
 * node scripts/gen-server-app-version.mjs --check     # 只比对（门禁）
 * node scripts/gen-server-app-version.mjs --print     # 只打印当前真源
 * node scripts/gen-server-app-version.mjs --self-test # 逐臂证明会红
 * ```
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REL = 'package.json';
const TARGET_REL = 'server/src/app-version/deployed-app-version.generated.ts';
const PLACEHOLDER = '0.0.0';

/** 生成物应有的逐字内容（纯函数，供 `--self-test` 正面对照）。 */
export function renderBody(version) {
  return `/**
 * 🔴 **生成物 —— 不要手改。** 改版本号去改仓库根 \`package.json\` 的 \`version\`，
 * 然后 \`node scripts/gen-server-app-version.mjs\` 重新生成。
 *
 * 用途：版本策略接口（\`GET /api/app-version\`）\`latestVersion\` 的**默认值**（可被 env 覆盖）。
 * 真源与理由见 \`scripts/gen-server-app-version.mjs\` 文件头。
 * \`pnpm check:app-version-server\`（= 本脚本 \`--check\`）钉住这份与真源逐字相同。
 */
export const HEYTA_DEPLOYED_APP_VERSION = '${version}';
`;
}

/**
 * 纯判据：真源可用 + 生成物逐字相同。返回问题列表（空 = 通过）。
 */
export function versionProblems({ sourceVersion, targetText }) {
  const problems = [];
  const v = typeof sourceVersion === 'string' ? sourceVersion.trim() : '';
  if (v === '') {
    problems.push(`${SOURCE_REL} 里没有 version —— 发版号的唯一真源就是这一个字段`);
    return problems;
  }
  if (v === PLACEHOLDER) {
    problems.push(
      `${SOURCE_REL} 的 version 还是占位值 ${PLACEHOLDER}。占位值不是版本号 —— ` +
        '它会让版本策略接口把「还没有版本」当成「版本 0.0.0」下发给所有客户端。',
    );
    return problems;
  }
  if (targetText !== undefined && targetText !== renderBody(v)) {
    problems.push(
      `${TARGET_REL} 与真源不一致（真源 ${SOURCE_REL}=\`${v}\`）。` +
        '生成物被手改了，或者真源动过没重跑生成 —— 两种都要红。',
    );
  }
  return problems;
}

/** 逐臂证明会红。 */
export function selfTest() {
  const arms = [];
  const arm = (name, ok) => arms.push({ name, ok });
  const ok = (v, t) => versionProblems({ sourceVersion: v, targetText: t }).length === 0;
  arm('真源没有 version ⇒ 报', !ok('', renderBody('0.1.0')));
  arm('占位值 0.0.0 ⇒ 报', !ok('0.0.0', renderBody('0.0.0')));
  arm('正面对照：一致 ⇒ 不报', ok('0.1.0', renderBody('0.1.0')));
  arm('生成物被改成别的版本 ⇒ 报', !ok('0.1.0', renderBody('9.9.9')));
  arm('只差一个换行 ⇒ 也报', !ok('0.1.0', `${renderBody('0.1.0')}\n`));
  arm('真源带首尾空白 ⇒ 当同一版本', ok('  0.1.0  ', renderBody('0.1.0')));
  let failed = 0;
  for (const a of arms) {
    if (!a.ok) failed += 1;
    console.log(`  ${a.ok ? '✅' : '🔴'} ${a.name}`);
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failed}`);
  return failed;
}

const args = new Set(process.argv.slice(2));
const KNOWN = new Set(['--check', '--print', '--self-test']);
const unknown = [...args].filter((a) => !KNOWN.has(a));
if (args.has('--self-test')) process.exit(selfTest());
if (unknown.length > 0) {
  console.error(`🔴 不认识的参数：${unknown.join(' ')}（只认 ${[...KNOWN].join(' / ')}）`);
  process.exit(1);
}

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

const source = JSON.parse(readFileSync(join(repoRoot, SOURCE_REL), 'utf8'));
const version = typeof source.version === 'string' ? source.version.trim() : '';
const body = version ? renderBody(version) : '';
const target = join(repoRoot, TARGET_REL);

if (args.has('--print')) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (args.has('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const problems = versionProblems({ sourceVersion: version, targetText: current ?? undefined });
  if (current === null) problems.push(`${TARGET_REL} 不存在 —— 跑一次 node scripts/gen-server-app-version.mjs`);
  if (problems.length) {
    for (const p of problems) console.error(`  ${p}`);
    fail(`${TARGET_REL} 校验失败（${problems.length} 处）`);
  }
  console.log(`✅ 服务端发版号：${version}（真源 ${SOURCE_REL} 与生成物逐字相同）`);
  process.exit(0);
}

const problems = versionProblems({ sourceVersion: version });
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  fail('真源版本号不可用，拒绝生成');
}
writeFileSync(target, body, 'utf8');
console.log(`✅ 已生成 ${TARGET_REL}（${version}）`);
