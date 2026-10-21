#!/usr/bin/env node
/**
 * 移动壳续费那一屏的**形状判据**的变异验证（ADR-0054 §10 / 交接物 §10.2 那行的牙）
 * ==============================================================================
 *
 * 用法：`pnpm check:mobile-renew-shape`（串行；载体是 96ms 级的源码正则套件）
 *
 * ## 为什么这道判据特别需要臂
 *
 * `apps/mobile/tests/renew-entry.spec.ts` 全部是**源码形状**断言（读文件 + 正则 / indexOf），
 * 因为移动壳没有组件级测试载体。这类断言有两种各自独立的失效方式，而且**都不会自己报错**：
 *
 *   · 判据被**注释**满足 —— 该套件的 D1 臂第一版就是这么活下来的（文件头写着闸门的名字，
 *     `indexOf` 的下标永远比代码小），后来靠 `codeOnly()` 才把注释剔掉；
 *   · 断言写成了**恒真**的形状（负向正则少了 `g`、`?? []` 后面忘了判长度…）。
 *
 * 所以这里每条臂都注入一次**真实的坏法**，要求具名用例变红。臂数由脚本自己打印。
 *
 * ## 与 `mutate-checkout-tier-gates.mjs` 的分工
 *
 * 那套管的是服务端**该不该卖这一单**（整段被删是最安静的坏法）；这套管的是移动壳**有没有自己
 * 抄一份收银台**。两边不重叠：同一个判断只在一个地方有牙（该套件头部那条纪律）。
 *
 * ⚠️ 只碰 `apps/mobile/src/screens/RenewSection.tsx` 一枚文件，跑完立刻按原文写回并校验 sha256；
 *    写回前再读一次，有并发写者就停下报错（共享工作树）。宿主内存护栏拒绝启动 vitest 时
 *    整轮判为**没跑成**（退 2），沿用同族那枚 `BAILED`。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'apps', 'mobile', 'src', 'screens', 'RenewSection.tsx');
const SPEC = 'tests/renew-entry.spec.ts';
const temporary = mkdtempSync(join(tmpdir(), 'heyta-mobile-renew-mutations-'));

const ARMS = [
  {
    name: 'R1 下单路径上的出境同意闸门被删（不同意也照发请求）',
    from: '    if (!privacyConsent.networkAllowed()) return;',
    to: '',
    expect: ['出境同意闸门排在下单之前'],
  },
  {
    name: 'R2 壳里自己抄一份 priceId（app-host 那张表改了它不会跟着改）',
    from: '      priceId: CHECKOUT_TIER_PRICE_IDS[tierId],',
    to: "      priceId: tierId === 'hostedAi' ? 'hosted-ai-monthly' : 'hosted-monthly',",
    expect: ['档位只从'],
  },
  {
    name: 'R3 屏上写死金额（价格是服务端报价之后才落屏的那条线被破）',
    // ⚠️ 锚点带上第二行：`<Text variant="row-meta" tone="subtle">` 在本文件出现 2 次，
    //    单拿它当锚会被脚本自己的"恰好 1 次"检查挡下（那是好事：注入点含糊 = 臂讲的不是这件事）。
    from: '      <Text variant="row-meta" tone="subtle">\n        {t(TIER_KEYS[tierId].detail)}',
    to: "      <Text variant=\"row-meta\" tone=\"subtle\">{'¥12 '}\n        {t(TIER_KEYS[tierId].detail)}",
    expect: ['档位只从'],
  },
  {
    name: 'R4 把 `web.*` 词条读进移动壳（命名空间说的是壳，不是事；那本"既存 179 处"的账又长大）',
    from: "        label={t('mobile.entitlement.renew.action')}",
    to: "        label={t('web.entitlement.renew.action')}",
    expect: ['键都不读'],
  },
  {
    // 这一臂打的是**闸门 ① 那一支**：这台实例没配托管上游时，`PRICE_NOT_SELLABLE` 是用户**今天真会拿到**的码。
    // 删掉这一行不会有任何编译错，界面只是把服务端机器码当人话印出去 —— 所以必须有具名用例红在它上面。
    name: 'R5 闸门 ① 的码没有词条（用户屏幕上出现「下单失败（PRICE_NOT_SELLABLE）。」）',
    from: "  PRICE_NOT_SELLABLE: 'mobile.entitlement.renew.fail.sellable',\n",
    to: '',
    expect: ['各有自己的词条'],
  },
];

const digest = (text) => createHash('sha256').update(text).digest('hex');
const BAILED = /内存闸门拒绝启动|tfa-test\.lock/;

function runCarrier(label) {
  const report = join(temporary, 'result.json');
  rmSync(report, { force: true });
  const result = spawnSync('npx', ['vitest', 'run', SPEC, '--reporter=json', `--outputFile=${report}`], {
    cwd: join(ROOT, 'apps', 'mobile'),
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
      console.error(`⏸  ${label}：载体被宿主内存护栏挡在外面 —— 这一轮**没跑成**，不是判据没牙。`);
      process.exit(2);
    }
    console.error(`❌  ${label}：拿不到 json 报告 —— 这是**探针坏了**，不是判据没牙。`);
    console.error(out.split('\n').slice(-20).join('\n'));
    process.exit(1);
  }
  const failed = parsed.testResults.flatMap((file) =>
    (file.assertionResults ?? []).filter((a) => a.status === 'failed').map((a) => a.fullName ?? a.title),
  );
  return { code: result.status ?? 1, failed, passed: parsed.numPassedTests, total: parsed.numTotalTests, out };
}

const pristine = readFileSync(SOURCE, 'utf8');
const pristineDigest = digest(pristine);
/**
 * 🔴 **字节还原不等于状态还原**。仓里 `scripts/check-mobile-ai-anchors.mjs` 那句臂注释写得很直白：
 *    "动 `apps/«壳»/src` 会把 mtime 抬起来，下一趟设备验收会被新鲜度门顶成 rc=3；那是探针自己把路堵死"
 *    —— 那三条臂因此打在 `tmp/` 副本上。本脚本必须碰真树（判据读的就是这个路径），
 *    所以起跑前把 atime/mtime 取下来，写回原文之后**连时间戳一起还回去**。
 *    不还的后果不红：它只会让下一位莫名其妙地被新鲜度门挡一次。
 */
const stamp = statSync(SOURCE);

function restore(mutatedDigest) {
  const now = readFileSync(SOURCE, 'utf8');
  if (digest(now) !== mutatedDigest) {
    console.error(`❌  ${SOURCE}\n   在这期间被**别的进程**改过 —— 停在这里，不覆盖那份编辑（共享工作树）。`);
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
    console.error('❌  mtime 没能还回起跑时的值 —— 下一趟设备验收会被新鲜度门顶红，停在这里。');
    process.exit(1);
  }
}

try {
  console.log(`变异验证：共 ${ARMS.length} 臂（臂数由本脚本打印，别抄进文档）`);
  console.log('载体：`apps/mobile` 的 vitest 单文件 + json reporter\n');

  console.log('── 阳性对照（不注入变异，载体必须是绿的）──────────────────────');
  const control = runCarrier('阳性对照');
  console.log(`   对照：${control.passed}/${control.total} 通过，exit ${control.code}`);
  if (control.code !== 0 || control.failed.length > 0) {
    console.error('❌  对照组基线就是红的 —— 先修基线，再来问"变异能不能红"。');
    process.exit(1);
  }
  // 🔴 基线绿还不够，得证明**载体真的在跑用例**：一条恒真的断言在"整个文件没被解析"时也是绿的，
  //    所以这里只立一条不可自造的下界 —— 报告里的用例数不许是 0（阈值不是我编的规模，是"有没有数"）。
  if (control.total === 0) {
    console.error('❌  对照报告里一条用例都没有 —— 探针没接到载体上，先修探针。');
    process.exit(1);
  }

  const survived = [];
  for (const arm of ARMS) {
    const occurrences = pristine.split(arm.from).length - 1;
    if (occurrences !== 1) {
      console.error(`❌  ${arm.name}：目标字节在 RenewSection.tsx 里出现 ${occurrences} 次（需要恰好 1 次）。`);
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
    if (carrier.code !== 0 && carrier.failed.length === 0) {
      console.error(`❌  ${arm.name}：exit ${carrier.code} 但红集合为空 —— 探针读不出红集合，停下。`);
      console.error(carrier.out.split('\n').slice(-20).join('\n'));
      process.exit(1);
    }
    if (carrier.code === 0 || missing.length > 0) {
      survived.push(arm.name);
      console.log(`❌ 存活 ${arm.name}`);
      console.log(`     exit ${carrier.code}；没看到的具名判据：${missing.join(' / ') || '（无）'}`);
      console.log(`     本轮红集合（${carrier.failed.length} 条）：\n       ${carrier.failed.join('\n       ') || '（空）'}`);
    } else {
      console.log(`✅ 抓到 ${arm.name}`);
      console.log(`     红：${carrier.failed.filter((t) => arm.expect.some((e) => t.includes(e))).join(' | ')}`);
    }
  }

  console.log(`\n收尾校验：写回后的 RenewSection.tsx digest = ${digest(readFileSync(SOURCE, 'utf8'))}`);
  if (survived.length > 0) {
    console.error(`\n❌ ${survived.length} 臂存活 —— 那些承诺当下没有任何一层在守。`);
    process.exit(1);
  }
  console.log(`✅ 全部 ${ARMS.length} 臂都被具名判据抓到（载体单文件 ${control.total} 条用例）。`);
} finally {
  if (digest(readFileSync(SOURCE, 'utf8')) !== pristineDigest) {
    writeFileSync(SOURCE, pristine);
    utimesSync(SOURCE, stamp.atime, stamp.mtime);
  }
  rmSync(temporary, { recursive: true, force: true });
}
