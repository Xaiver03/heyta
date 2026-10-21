#!/usr/bin/env node
/**
 * 收银台两道新闸门的变异验证（ADR-0054 §10.2 那两格的牙）
 * ========================================================
 *
 * 用法：`pnpm check:checkout-tier-gates`（**串行**跑；载体是单文件 vitest × 臂数，很快，
 * 它在 `pnpm check` 链里 —— 不进链的变异台架就是"写了没人跑"的那一类，见
 * `scripts/check-gate-wiring.mjs` 头部那条理由）
 *
 * ## 为什么需要它，而不是"用例已经写了"
 *
 * `server/tests/billing-checkout.routes.spec.ts` 里 ④′ 那组用例断言的是**拒单**（条数由
 * vitest 自己打印，别在这里抄）。
 * 而"拒单"这件事有一种很难看见的坏法：**整段判断被删掉**。删掉之后不会有任何一条
 * 用例红着报错说"我少了一条判据" —— 只会有一批 409 变成 200。所以每条臂都要
 * 现场把源码改坏一次，并指名**哪几条具名用例**必须因此变红；抓错地方算漏。
 *
 * 🔴 还有**第三种坏法只靠拒单用例永远抓不到**：把守卫写得比该拒的更宽。
 * ④′ 的正确形状是**非对称**的 —— 只有"已有能力被这单判小"才拒，能力**变宽**（¥5 有效期内买 ¥12）
 * 必须照卖。写成对称差（两个集合不相等就拒）时，上面那些 409 用例**一条都不会红**，
 * 而 ¥5→¥12 会静默变拒单 —— 这一档明明是最该被升上来的那一档。所以 C6 与那条具名"升档"
 * 的 200 用例是一对：**一个方向有牙，另一个方向也得有牙**。
 *
 * ## 臂的形状：两道门各三条边
 *
 * 每道门都有**两种各自独立**的坏法：整段失效（该拒的没拒 = 收钱不交付 / 把人已付的
 * 能力判小）与判据错对象（不该拒的拒了 = 凭空挡单）。只测前一种，门被写成"拒掉所有单"
 * 照样全绿 —— 那正是本文件 C2 与 C5 存在的全部理由。
 *
 * ## 红集合从哪儿读
 *
 * 用 vitest 的 **json reporter**（`--outputFile`），不解析彩色输出：pretty 输出里
 * `×` 那一行的形状随 reporter 版本变，而这个仓里有两条判据就是栽在"探针读不到自己的传感器"上
 * （AGENTS §7 元规则 1：先怀疑探针）。报告读不出来时**退 1 并说明是探针坏了**，
 * 不当成"臂存活"，也不当成"判据没牙"。
 *
 * ## 臂数与用例数别抄进任何文档
 *
 * 这套臂会随判据长，两个数都由脚本自己打印（要读数就跑它）。
 *
 * ⚠️ 只碰 `server/src/billing/checkout.routes.ts` 一个文件的字节。每条臂跑完**立刻**
 *    按原文写回并校验 sha256；写回之前会再读一次，这期间若有别的进程改过它就停下报错，
 *    而不是拿我这一轮的副本覆盖掉别人的编辑（共享工作树）。
 *    测试闸门（宿主内存护栏）拒绝启动 vitest 时**整轮判为没跑成**（退 2），
 *    沿用 `scripts/mutate-calendar-event-source.mjs` 里同一枚 `BAILED` 与同一个理由。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'server', 'src', 'billing', 'checkout.routes.ts');
const SPEC = 'tests/billing-checkout.routes.spec.ts';
const temporary = mkdtempSync(join(tmpdir(), 'heyta-checkout-gate-mutations-'));

const ARMS = [
  {
    name: 'C1 ②′ 整段失效（该拒的没拒 = 收 ¥12、用户每次请求拿一个 503）',
    from: '      if (requestedGrants.includes(MANAGED_AI_CAPABILITY) && !managedAiConfigured) {',
    to: '      if (false) {',
    expect: ['那一档 409 PRICE_NOT_SELLABLE'],
  },
  {
    name: 'C2 ②′ 判据错对象（不判这一档买不买云端 AI，见 ai 档就拒 = 凭空挡单）',
    from: '      if (requestedGrants.includes(MANAGED_AI_CAPABILITY) && !managedAiConfigured) {',
    to: '      if (!managedAiConfigured) {',
    expect: ['¥5 那一档照卖'],
  },
  {
    name: 'C3 ②′ 的默认值翻成放行（下一个注册点忘了传这个选项时不再 fail-closed）',
    from: '  const managedAiConfigured = options.managedAiConfigured ?? false;',
    to: '  const managedAiConfigured = options.managedAiConfigured ?? true;',
    expect: ['根本没传'],
  },
  {
    name: 'C4 ④′ 整段失效（付过钱的 `ai`/`automation` 被一次 ¥5 续费整行替换掉）',
    from: '      if (entitledGrants !== null && lostGrants.length > 0) {',
    to: '      if (false) {',
    expect: ['PRICE_TIER_LOSES_GRANTS'],
  },
  {
    name: 'C5 ④′ 读错行（provider 不进 WHERE = 别家那一行也被当成会被覆盖的行）',
    from:
      "    'SELECT status, current_period_end, grants FROM subscriptions WHERE user_id = $1 AND provider = $2 LIMIT 1',\n" +
      '    [userId, provider],',
    to: "    'SELECT status, current_period_end, grants FROM subscriptions WHERE user_id = $1 LIMIT 1',\n    [userId],",
    expect: ['另一家 provider 的那一行'],
  },
  {
    name: 'C6 ④′ 写成对称差（能力**变宽**也拒 = ¥5 有效期内买 ¥12 静默变拒单）',
    from: '      const lostGrants = (entitledGrants ?? []).filter((g) => !requestedGrants.includes(g));',
    to:
      '      const allGrants = [...new Set([...(entitledGrants ?? []), ...requestedGrants])];\n' +
      '      const lostGrants = allGrants.filter((g) => !((entitledGrants ?? []).includes(g) && requestedGrants.includes(g)));',
    expect: ['升档'],
  },
];

const digest = (text) => createHash('sha256').update(text).digest('hex');
/** 载体被宿主内存护栏挡在外面：那是环境，不是判据（同 `mutate-calendar-event-source.mjs`）。 */
const BAILED = /内存闸门拒绝启动|tfa-test\.lock/;

/** 跑一次载体：返回退出码、具名红集合、通过数与原始输出。 */
function runCarrier(label) {
  const report = join(temporary, 'result.json');
  rmSync(report, { force: true });
  const result = spawnSync('npx', ['vitest', 'run', SPEC, '--reporter=json', `--outputFile=${report}`], {
    cwd: join(ROOT, 'server'),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 600_000,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    if (BAILED.test(out)) {
      console.error(`⏸  ${label}：载体被宿主内存护栏挡在外面 —— 这一轮**没跑成**。`);
      console.error('    不是"臂存活"，也不是"判据没牙"；等串行窗口重跑（退 2 与退 1 对 `pnpm check` 都是红）。');
      console.error(out.split('\n').filter((l) => BAILED.test(l)).join('\n'));
      process.exit(2);
    }
    console.error(`❌  ${label}：拿不到 json 报告 —— 这是**探针坏了**，不是判据没牙。停下，别继续跑下一臂。`);
    console.error(out.split('\n').slice(-20).join('\n'));
    process.exit(1);
  }

  const failed = parsed.testResults.flatMap((file) =>
    (file.assertionResults ?? []).filter((a) => a.status === 'failed').map((a) => a.fullName ?? a.title),
  );
  return {
    code: result.status ?? 1,
    failed,
    passed: parsed.numPassedTests,
    total: parsed.numTotalTests,
    out,
  };
}

const pristine = readFileSync(SOURCE, 'utf8');
const pristineDigest = digest(pristine);
/**
 * 🔴 **字节还原不等于状态还原**：写回之后文件的 mtime 已经被抬起，而仓里对这件事有一句明话
 *    （`scripts/check-mobile-ai-anchors.mjs` 的臂注释："动 `apps/«壳»/src` 会把 mtime 抬起来，
 *    下一趟设备验收会被新鲜度门顶成 rc=3；那是探针自己把路堵死"）。本脚本碰的是 `server/src`，
 *    当下没有一枚 mtime 尺指着它，但**同一枚副作用不该留给下一位去踩** ⇒ 起跑前取 atime/mtime，
 *    写回原文之后连时间戳一起还回去，并且**验一遍还得回去没有**（判"没还成"就退 1）。
 */
const stamp = statSync(SOURCE);

function restore(mutatedDigest) {
  const now = readFileSync(SOURCE, 'utf8');
  if (digest(now) !== mutatedDigest) {
    console.error(
      `❌  ${SOURCE}\n   在这期间被**别的进程**改过（digest 与我写进去的那份不一致）。` +
        '\n   变异脚本停在这里，不覆盖那份编辑 —— 请确认没有并发写者后重跑。',
    );
    process.exit(1);
  }
  writeFileSync(SOURCE, pristine);
  if (digest(readFileSync(SOURCE, 'utf8')) !== pristineDigest) {
    console.error('❌  写回后 digest 与起跑时不一致 —— 停在这里，别继续跑下一臂。');
    process.exit(1);
  }
  utimesSync(SOURCE, stamp.atime, stamp.mtime);
  // 比的是 `mtime`（Date，毫秒精度）而不是 `mtimeMs`：`utimesSync` 这条通道能送达的最高精度就是毫秒，
  // 而 APFS 存的是纳秒 ⇒ 拿 `mtimeMs` 的小数尾去比会**恒判"没还成"**（本脚本第一版就是这么红的）。
  if (statSync(SOURCE).mtime.getTime() !== stamp.mtime.getTime()) {
    console.error('❌  mtime 没能还回起跑时的值 —— 抬起的时间戳会顶红下一趟按 mtime 判新鲜度的门。');
    process.exit(1);
  }
}

try {
  console.log(`变异验证：共 ${ARMS.length} 臂（臂数由本脚本打印，别抄进文档）`);
  console.log('载体：`server` 的 vitest 单文件 + json reporter\n');

  console.log('── 阳性对照（不注入变异，载体必须是绿的）──────────────────────');
  const control = runCarrier('阳性对照');
  console.log(`   对照：${control.passed}/${control.total} 通过，exit ${control.code}`);
  if (control.code !== 0 || control.failed.length > 0) {
    console.error('❌  对照组基线就是红的 —— 先修基线，再来问"变异能不能红"。');
    console.error(`   基线红集合：\n     ${control.failed.join('\n     ') || '（空，但退出码非 0）'}`);
    process.exit(1);
  }

  const survived = [];
  for (const arm of ARMS) {
    const occurrences = pristine.split(arm.from).length - 1;
    if (occurrences !== 1) {
      console.error(`❌  ${arm.name}：目标字节在 checkout.routes.ts 里出现 ${occurrences} 次（需要恰好 1 次）。`);
      process.exit(1);
    }
    const mutated = pristine.replace(arm.from, arm.to);
    const mutatedDigest = digest(mutated);
    writeFileSync(SOURCE, mutated);

    let carrier;
    try {
      carrier = runCarrier(arm.name);
    } finally {
      restore(mutatedDigest);
    }

    const missing = arm.expect.filter((needle) => !carrier.failed.some((title) => title.includes(needle)));
    // 🔴 退出码非 0 而红集合为空 = **载体没跑到用例就坏了**（语法错、夹具炸、报告缺字段）。
    //    这跟"臂存活"是两件事：存活是判据没牙，这是探针读不到自己的传感器（元规则 1）。
    if (carrier.code !== 0 && carrier.failed.length === 0) {
      console.error(`❌  ${arm.name}：exit ${carrier.code} 但红集合为空 —— 探针读不出红集合，停下别继续跑下一臂。`);
      console.error(carrier.out.split('\n').slice(-20).join('\n'));
      process.exit(1);
    }
    if (carrier.code === 0 || missing.length > 0) {
      survived.push({ name: arm.name, missing });
      console.log(`❌ 存活 ${arm.name}`);
      console.log(`     exit ${carrier.code}；没看到的具名判据：${missing.join(' / ') || '（无）'}`);
      console.log(`     本轮红集合（${carrier.failed.length} 条）：\n       ${carrier.failed.join('\n       ')}`);
    } else {
      console.log(`✅ 抓到 ${arm.name}`);
      console.log(`     红：${carrier.failed.filter((t) => arm.expect.some((e) => t.includes(e))).join(' | ')}`);
    }
  }

  console.log(`\n收尾校验：写回后的 checkout.routes.ts digest = ${digest(readFileSync(SOURCE, 'utf8'))}`);
  if (survived.length > 0) {
    console.error(`\n❌ ${survived.length} 臂存活 —— 那些承诺当下没有任何一层在守。`);
    process.exit(1);
  }
  console.log(`✅ 全部 ${ARMS.length} 臂都被具名判据抓到（载体单文件 ${control.total} 条用例）。`);
} finally {
  // 🔴 反正是走出去，先把源码还原再删临时目录：臂中途报错退出去时，
  //    树里**不许**留下被改坏的 `checkout.routes.ts`（下一趟构建打的会是那份字节）。
  if (digest(readFileSync(SOURCE, 'utf8')) !== pristineDigest) {
    writeFileSync(SOURCE, pristine);
    utimesSync(SOURCE, stamp.atime, stamp.mtime);
  }
  rmSync(temporary, { recursive: true, force: true });
}
