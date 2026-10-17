#!/usr/bin/env node
/**
 * `check:checkpoint-cadence` —— 把 **B12** 那条读数从对账件里搬出来，变成**可复跑的一条命令**。
 * ==========================================================================================
 *
 * ## 它记的是什么
 *
 * `server/src/sync/checkpoint-gate.ts` 里那条 `MIN_CHECKPOINT_SAFE_APP_VERSION = '18.21.2'`
 * 是**上游 Super Productivity 的版本号**（`server/` 是 vendored 层）。
 * 而 heyta 客户端上报的 `appVersion` 来自仓库根 `package.json`（今天 `0.1.0`）。
 *
 * ⇒ 于是 `isCheckpointSafeAppVersion()` 对 heyta 可能报的**每一个**版本都返回 `false`，
 * `isAccountCheckpointSafe()` **恒为 `false`**，`summarizeCheckpointGate()` 的 `safeAccounts`
 * **恒为 0**；`server/src/sync/cleanup.ts:73` 还会每天打一行
 * 「run only clients >= 18.21.2」—— 对 heyta 是一句**假话**（我们**不存在** 18.x 客户端）。
 *
 * ## 🔴 为什么值得一条判据（而不是只写在对账件里）
 *
 * 它是**fail-safe 的**（那个 cadence 永远不打开），所以**不是危险**，
 * 但它同时意味着：**一条恒为 0 的运维指标 + 一句每天在打的假日志**。
 * 而它只写在文档里时，"这句还成立吗"要靠人记着重读 —— 本会话已经反复吃过这个形状。
 *
 * ⚠️ **本判据断言的是"现状"，不是"应该"**：它把"heyta 今天被排除在那个 cadence 之外"
 * 记成一条**会红的**断言。⇒ 一旦有人把 `MIN_SAFE` 按 heyta 自己的口径重定
 * （那是 B12 的选项 (b)，属**行为**改动），这里会**红**，逼人回来重读 B12 并更新这条记录。
 * 这与 `check:release-version-guard` 同一族：**记录本身要能被违反**，否则它只是注释。
 *
 * ## 🔴 它**必须**带一条阳性对照
 *
 * "heyta 被判不安全"这件事，一个**永远返回 false** 的坏探针也能满足。
 * 所以自检里有一条：**同一次调用里，一个足够新的版本必须判 `true`** ——
 * 那才证明探针真的在读那个函数，而不是卡在某个恒假的分支上。
 *
 * ## 用法
 *
 *   node scripts/check-checkpoint-cadence.mjs             # 真跑（离线）
 *   node scripts/check-checkpoint-cadence.mjs --self-test # 逐臂 + 阳性对照
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
const MODULE = join(ROOT, 'server/src/sync/checkpoint-gate.ts');
const PACKAGE_JSON = join(ROOT, 'package.json');

/** 一个**一定**比任何上游版本新的号，用作阳性对照。 */
export const NEWER_THAN_ANY_UPSTREAM = '99.0.0';

/**
 * 在**真模块**上问一次。返回 `{ min, results }`；探针失败时抛。
 *
 * ⚠️ 走 `--experimental-strip-types` 直接 import 那份 `.ts`：**不重写一遍比较逻辑**。
 * 抄一份 semver 比较就等于给这条判据再开一个会漂的事实源。
 */
export function probe(versions) {
  const script = `
    const m = await import(${JSON.stringify(MODULE)});
    const versions = ${JSON.stringify(versions)};
    const out = { min: m.MIN_CHECKPOINT_SAFE_APP_VERSION,
                  results: Object.fromEntries(versions.map((v) => [v, m.isCheckpointSafeAppVersion(v)])),
                  account: Object.fromEntries(versions.map((v) => [v, m.isAccountCheckpointSafe([{ appVersion: v }])])) };
    console.log('PROBE_JSON:' + JSON.stringify(out));
  `;
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8', cwd: ROOT },
  );
  const hit = /PROBE_JSON:(\{.*\})/.exec(r.stdout ?? '');
  if (hit === null) {
    throw new Error(
      `探针没拿到结果（多半是 vendored 模块换了形状）：\n` +
        `  stderr: ${(r.stderr ?? '').trim().split('\n').slice(-3).join(' / ')}`,
    );
  }
  return JSON.parse(hit[1]);
}

/** 纯判据：给一次探针结果，返回问题列表。 */
export function checkpointCadenceProblems(reading, heytaVersion) {
  const problems = [];

  // 🔴 先立阳性对照：探针要是恒假，下面那条"heyta 不安全"就毫无意义。
  if (reading.results[NEWER_THAN_ANY_UPSTREAM] !== true) {
    problems.push(
      `阳性对照失败：${NEWER_THAN_ANY_UPSTREAM} 本应判"安全"，实际是 ${String(
        reading.results[NEWER_THAN_ANY_UPSTREAM],
      )} —— 探针可能恒假，这一整条判据不作数`,
    );
    return { problems, safe: undefined };
  }

  const safe = reading.results[heytaVersion];
  if (safe !== false) {
    problems.push(
      `heyta 的版本 ${heytaVersion} 现在被判为**安全**了（MIN_SAFE=${reading.min}）—— ` +
        '这与 B12 记的现状不符。要么 MIN_SAFE 被按 heyta 口径重定过（那是**行为**改动），' +
        '要么探针坏了。**先回去重读对账件的 B12**，再决定这条判据该怎么写。',
    );
    return { problems, safe };
  }
  if (reading.account[heytaVersion] !== false) {
    problems.push(`账号级判据与设备级不一致（${heytaVersion}）—— vendored 那层改过`);
  }
  return { problems, safe };
}

function heytaVersion() {
  try {
    return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;
  } catch {
    return undefined;
  }
}

function main() {
  const v = heytaVersion();
  if (typeof v !== 'string' || v === '') {
    console.error('🔴 读不到根 package.json 的 version —— 这条判据没有可对账的那一侧');
    process.exit(1);
  }

  let reading;
  try {
    reading = probe([v, NEWER_THAN_ANY_UPSTREAM]);
  } catch (error) {
    console.error(`🔴 ${String(error instanceof Error ? error.message : error)}`);
    process.exit(1);
  }

  const { problems } = checkpointCadenceProblems(reading, v);
  if (problems.length > 0) {
    console.error(`🔴 checkpoint cadence 的现状与 B12 记的不符（${problems.length} 条）：`);
    for (const p of problems) console.error(`   · ${p}`);
    process.exit(1);
  }

  console.log(
    `✅ checkpoint cadence：heyta 今天仍被排除在它之外（MIN_SAFE=${reading.min}，` +
      `而 heyta 上报 ${v} ⇒ 判"不安全"）。⚠️ 这不是"正常"，是**记录**：`,
  );
  console.log(
    '   ⇒ `isAccountCheckpointSafe` 对 heyta 恒为 false ⇒ `safeAccounts` 恒为 0，' +
      '而 `cleanup.ts` 每天会打一行「run only clients >= ' +
      `${reading.min}」—— 对 heyta 是一句**假话**（我们不存在 18.x 客户端）。`,
  );
  console.log('   对账件的 B12 记着两个选项（不要那个 cadence / 按 heyta 口径重定 MIN_SAFE），待拍板。');
}

/* ── 自检：三臂 + 一条阳性对照 ───────────────────────────────────────── */

function selfTest() {
  const ok = {
    min: '18.21.2',
    results: { '0.1.0': false, [NEWER_THAN_ANY_UPSTREAM]: true },
    account: { '0.1.0': false },
  };
  const arms = [
    ['A 现状（heyta 不安全 + 阳性对照成立）⇒ 不报', () => checkpointCadenceProblems(ok, '0.1.0'), 0],
    [
      'B heyta 突然被判"安全" ⇒ 报（这正是要人回来看 B12 的那一下）',
      () => checkpointCadenceProblems({ ...ok, results: { ...ok.results, '0.1.0': true } }, '0.1.0'),
      1,
    ],
    [
      'C 🔴 探针恒假（阳性对照也假）⇒ 报，且**不再**拿"heyta 不安全"当结论',
      () => checkpointCadenceProblems({ ...ok, results: { '0.1.0': false, [NEWER_THAN_ANY_UPSTREAM]: false } }, '0.1.0'),
      1,
    ],
    [
      'D 账号级与设备级不一致 ⇒ 报',
      () => checkpointCadenceProblems({ ...ok, account: { '0.1.0': true } }, '0.1.0'),
      1,
    ],
  ];
  let failures = 0;
  for (const [label, run, expectCount] of arms) {
    const { problems } = run();
    const hit = problems.length === expectCount;
    console.log(`${hit ? '✅' : '❌'} ${label}${hit ? '' : `（问题：${problems.join(' / ') || '(无)'}）`}`);
    if (!hit) failures += 1;
  }
  // 阳性对照：臂 C 报出来的必须是"探针不作数"，不能只是"版本对不上"
  const { problems: cProblems } = checkpointCadenceProblems(
    { ...ok, results: { '0.1.0': false, [NEWER_THAN_ANY_UPSTREAM]: false } },
    '0.1.0',
  );
  const distinct = cProblems.some((p) => p.includes('阳性对照'));
  console.log(`${distinct ? '✅' : '❌'} 阳性对照：探针恒假被单独报出（不与"版本对不上"混成一句）`);
  if (!distinct) failures += 1;

  console.log(`\n臂数 ${arms.length}（由本脚本自己打印）+ 阳性对照，失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
