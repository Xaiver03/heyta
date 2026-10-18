#!/usr/bin/env node
/**
 * `check:app-version` —— 客户端版本号**只有一个真源**，生成物必须还对得上它。
 * ============================================================================
 *
 * ## 为什么需要一枚"真源"，而不是让各宿主自己传
 *
 * `appVersion` 这条查询参数**有消费者没有生产者**已经很久了（台账 G-44）：
 * 服务端逐设备记它（`server/src/sync/checkpoint-gate.ts`）、运营面那张设备清单读它
 * （`server/src/admin/admin.routes.ts`），而全仓库没有任何一处发过它。
 * 上一轮把机制补到"宿主注入、缺省一个字都不发"（`b467e758`），然后**停在原地**：
 * 每个宿主都得记得传一个值，而没有一个宿主有值可传 —— 各 `package.json` 都是 `0.0.0` 占位。
 *
 * 🔴 "让每个宿主记得传"正是这件事烂在原地的成因。按 AGENTS §3.5 的边界，
 * 版本号**不是平台差异**（平台差异只有一个：注入哪个 SQLite 驱动），它是产品语义。
 * 所以真源在仓库根，生成物在 `packages/app-host`，宿主一个字都不用传。
 *
 * ## 三件事各自归谁
 *
 * | 事实 | 真源 | 消费者 |
 * |---|---|---|
 * | heyta 的版本号 | 根 `package.json` 的 `version` | 本脚本 |
 * | 各端构建里的那个值 | `packages/app-host/src/app-version.generated.ts`（**生成物，不手改**） | `createSyncClient()` |
 * | "这个形状服务端收不收" | `server/src/sync/checkpoint-gate.ts` 的 `parseAppVersion` | `server/tests/version-coupling.spec.ts` 的 C3 |
 *
 * ⚠️ 本脚本**不抄**服务端那条版本正则 —— 抄一份就等于再造一个会漂的判据。
 * 它只挡两种当场可判的坏态：真源缺失，以及**把占位值当版本**（`0.0.0` 是"还没有版本"，
 * 不是版本 `0.0.0`；发出去就是把假版本写进运营面那份清单）。
 * "形状服务端解不解得开"由 C3 用服务端自己的函数判（那里才 import 得到）。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/gen-app-version.mjs            # 生成/更新
 * node scripts/gen-app-version.mjs --check    # 只比对（门禁，`check:app-version`）
 * node scripts/gen-app-version.mjs --print    # 只把当前真源打到 stdout
 * ```
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REL = 'package.json';
const TARGET_REL = 'packages/app-host/src/app-version.generated.ts';
/** 还没定版本时真源取值 —— 出现它就必须红，不许把它当版本号发出去。 */
const PLACEHOLDER = '0.0.0';

/**
 * 生成物应有的**逐字内容**。抽成纯函数，好让 `--self-test` 拿它做正面对照
 * （2026-10-16：这条门禁此前落在 B25 的"无证明"那一档）。
 */
export function renderBody(version) {
  return `/**
 * 🔴 **生成物 —— 不要手改。** 改版本号去改仓库根 \`package.json\` 的 \`version\`，
 * 然后 \`node scripts/gen-app-version.mjs\` 重新生成。
 *
 * 真源、消费者与"为什么不让各宿主自己传"的理由都写在 \`scripts/gen-app-version.mjs\` 文件头。
 * \`pnpm check:app-version\`（= 本脚本 \`--check\`）钉住这份与真源逐字相同。
 */
export const HEYTA_APP_VERSION = '${version}';
`;
}

/**
 * 纯判据：真源版本号是否可用 + 生成物是否与真源**逐字相同**。
 * @returns {string[]} 问题列表（空数组 = 通过）
 */
export function versionProblems({ sourceVersion, targetText }) {
  const problems = [];
  const v = typeof sourceVersion === 'string' ? sourceVersion.trim() : '';
  if (v === '') {
    problems.push(`${SOURCE_REL} 里没有 version —— 客户端版本号的真源就是这一个字段`);
    return problems;
  }
  if (v === PLACEHOLDER) {
    problems.push(
      `${SOURCE_REL} 的 version 还是占位值 ${PLACEHOLDER}。占位值不是版本号：` +
        '随下载请求上报它，等于把假版本写进运营面那份设备清单（台账 §8.257）。' +
        '要发版本就正式定一个（`0.1.0` 起），不要发占位值。',
    );
    return problems;
  }
  if (targetText !== undefined && targetText !== renderBody(v)) {
    problems.push(
      `${TARGET_REL} 与真源不一致（真源 ${SOURCE_REL}=\`${v}\`）。\n` +
        '   生成物被手改了，或者真源动过没重跑生成 —— 两种都是本门禁要抓的形状。',
    );
  }
  return problems;
}

/**
 * 逐臂证明这道门禁**真的会红**（两侧都变异过，见 §8.8.6）。返回失败臂数。
 */
export function selfTest() {
  const arms = [];
  const arm = (name, ok, detail) => arms.push({ name, ok, detail });
  const ok = (v, t) => versionProblems({ sourceVersion: v, targetText: t }).length === 0;

  // 臂 1–2：**真源有问题必须红**
  arm('真源没有 version ⇒ 报', !ok('', renderBody('0.1.0')), '1 条');
  arm('真源是占位值 0.0.0 ⇒ 报', !ok('0.0.0', renderBody('0.0.0')), '1 条');

  // 臂 3：**正面对照** —— 真源正常 + 生成物逐字相同 ⇒ 不报
  arm('正面对照：一致 ⇒ 不报', ok('0.1.0', renderBody('0.1.0')), '0 条');

  // 臂 4：**生成物被手改 ⇒ 必须报**（第 84 轮那次人工变异的形状）
  arm('生成物被改成别的版本 ⇒ 报', !ok('0.1.0', renderBody('9.9.9')), '1 条');

  // 臂 5：**只差一个字符也算不一致**（"逐字相同"不是"版本号读起来一样"）
  arm('只差一个换行 ⇒ 也报', !ok('0.1.0', `${renderBody('0.1.0')}\n`), '1 条');

  // 臂 6：**真源带空白要能规整**（否则 CI 上会因为空格误红）
  arm('真源带首尾空白 ⇒ 当成同一个版本', ok('  0.1.0  ', renderBody('0.1.0')), '0 条');

  let failed = 0;
  for (const a of arms) {
    if (!a.ok) failed += 1;
    console.log(`  ${a.ok ? '✅' : '🔴'} ${a.name} —— ${a.detail}`);
  }
  console.log(`\n臂数 ${arms.length}（由本脚本自己打印），失败 ${failed}`);
  return failed;
}

const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const print = args.has('--print');

// 🔴 **自检必须最优先**（2026-10-16 加）：第一版没有这个分支，于是
//    `node scripts/gen-app-version.mjs --self-test` **落到了默认模式、真的重跑了生成**
//    （当日实测：打印"✅ 已生成 …"；所幸内容逐字节相同、git 无变化）。
//    ⚠️ 对一个**会写文件**的脚本来说，"未知参数被静默忽略"比只读脚本严重得多。
if (args.has('--self-test')) process.exit(selfTest());

// 🔴 **未知参数一律拒绝**（同上）：没有这道闸，任何拼写错误（`--chekc`、`--printt`）
//    都会**静默地去生成一遍**。宁可报错，也不要"看起来跑成功了"。
const KNOWN = new Set(['--check', '--print', '--self-test']);
const unknown = [...args].filter((a) => !KNOWN.has(a));
if (unknown.length > 0) {
  console.error(`🔴 不认识的参数：${unknown.join(' ')}（只认 ${[...KNOWN].join(' / ')}）`);
  console.error('   ⚠️ 本脚本**默认动作是写文件**，所以不认识的参数必须报错、不许静默忽略。');
  process.exit(1);
}

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

const source = JSON.parse(readFileSync(join(repoRoot, SOURCE_REL), 'utf8'));
const version = typeof source.version === 'string' ? source.version.trim() : '';

if (version === '') fail(`${SOURCE_REL} 里没有 version —— 客户端版本号的真源就是这一个字段`);
if (version === PLACEHOLDER) {
  fail(
    `${SOURCE_REL} 的 version 还是占位值 ${PLACEHOLDER}。占位值不是版本号：` +
      '随下载请求上报它，等于把假版本写进运营面那份设备清单（台账 §8.257）。' +
      '要发版本就正式定一个（`0.1.0` 起），不要发占位值。',
  );
}

const body = `/**
 * 🔴 **生成物 —— 不要手改。** 改版本号去改仓库根 \`package.json\` 的 \`version\`，
 * 然后 \`node scripts/gen-app-version.mjs\` 重新生成。
 *
 * 真源、消费者与"为什么不让各宿主自己传"的理由都写在 \`scripts/gen-app-version.mjs\` 文件头。
 * \`pnpm check:app-version\`（= 本脚本 \`--check\`）钉住这份与真源逐字相同。
 */
export const HEYTA_APP_VERSION = '${version}';
`;

const target = join(repoRoot, TARGET_REL);

if (print) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (check) {
  if (!existsSync(target)) {
    fail(`${TARGET_REL} 不存在 —— 跑一次 node scripts/gen-app-version.mjs 生成它`);
  }
  const current = readFileSync(target, 'utf8');
  if (current !== body) {
    fail(
      `${TARGET_REL} 与真源不一致（真源 ${SOURCE_REL}=\`${version}\`）。\n` +
        '   生成物被手改了，或者真源动过没重跑生成 —— 两种都是本门禁要抓的形状。',
    );
  }
  console.log(`✅ 客户端版本号：${version}（真源 ${SOURCE_REL} 与生成物逐字相同）`);
  process.exit(0);
}

writeFileSync(target, body, 'utf8');
console.log(`✅ 已生成 ${TARGET_REL}（${version}）`);
