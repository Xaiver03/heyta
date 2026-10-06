#!/usr/bin/env node
/**
 * 门禁：e2e 的**载体健康**判定必须在场、必须认得出那四类签名、必须真的会中止。
 *
 * 起因（2026-10-06 一整轮 `check:ai-e2e` 读数作废）：vite dev server 在第 6 条用例之后死了，
 * Playwright 不会因此停下，于是剩下 190 多条逐条 `net::ERR_CONNECTION_REFUSED` 红在 130 ms 上 ——
 * 输出读起来像"后台 / AI 助手 / 拆解 / 捕获 / 估时 / 优先级全坏了"，而真相只有一句：载体不在了。
 * 已有的 `check-ai-e2e-preflight.mjs` 只判**起跑那一刻**端口上是谁的进程，对"跑到一半没了"零覆盖。
 *
 * 用法：
 *   node scripts/check-e2e-carrier.mjs             # 真实检查（三份配置 + 两枚文件 + 接线）
 *   node scripts/check-e2e-carrier.mjs --self-test # 逐臂证明这把尺会红
 *
 * ⚠️ 臂数只由本文件自己打印，不许抄进任何文档（抄了就一定会漂）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARRIER_SIGNATURES, carrierFailureReason } from '../e2e/reporters/carrier-signature.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIGNATURE_FILE = 'e2e/reporters/carrier-signature.mjs';
const REPORTER_FILE = 'e2e/reporters/carrier-health.mjs';

/** 进 `pnpm check` 链的三份 e2e 配置 —— 少一份带上报告器，那一整段就没有这条保护。 */
const CHAINED_CONFIGS = [
  'e2e/playwright.config.ts',
  'e2e/playwright.privacy-consent.config.ts',
  'e2e/playwright.landing.config.ts',
];

/** 真出现过的原文（本轮日志里的字面形状），不是编的。 */
const REAL_REFUSED =
  'Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/\n' +
  'Call log:\n  - navigating to "http://127.0.0.1:4318/", waiting until "load"';

/** 两枚**不是**载体问题的原文：产品断言与负载型超时。 */
const NOT_CARRIER = [
  'Error: expect(received).toContain(expected)\nExpected substring: "启用 AI 功能"\nReceived string: ""',
  'Test timeout of 60000ms exceeded.',
];

function fail(msg) {
  console.error(`🔴 ${msg}`);
  return false;
}

/** 每一份进链配置都必须引用报告器文件（按相对路径名认，不按具体写法）。 */
function configsReferenceReporter(root) {
  const missing = [];
  for (const rel of CHAINED_CONFIGS) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!text.includes('carrier-health.mjs')) missing.push(rel);
  }
  return missing;
}

/**
 * 真跑一次报告器：命中签名 ⇒ 退出码必须非零且带那句"这一轮作废"；
 * 普通断言失败 ⇒ 不许退出（回 0 表示"继续跑，这些红是真的"）。
 */
function probeReporter(message, expectExit) {
  const child = spawnSync(
    process.execPath,
    ['-e', PROBE_CHILD],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HEYTA_PROBE_MESSAGE: message, HEYTA_PROBE_FILE: join(ROOT, REPORTER_FILE) },
    },
  );
  const out = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  if (expectExit) {
    if (child.status !== 160) return `退出码 ${child.status}（期望 160）\n${out}`;
    if (!out.includes('这一轮 e2e **作废**')) return `没有打印那句作废判定：\n${out}`;
    return null;
  }
  if (child.status !== 0) return `不该中止却退了 ${child.status}：\n${out}`;
  if (out.includes('作废')) return '普通断言失败被误判成载体问题';
  return null;
}

const PROBE_CHILD = `
import(process.env.HEYTA_PROBE_FILE)
  .then((mod) => {
    const reporter = new mod.default();
    const test = { titlePath: () => ['探针', '合成用例'] };
    const result = { error: { message: process.env.HEYTA_PROBE_MESSAGE }, errors: [] };
    reporter.onTestEnd(test, result);
    process.exit(0);
  })
  .catch((e) => { console.error(String(e)); process.exit(0); });
`;

function selfTest() {
  let arms = 0;
  let bad = 0;
  const check = (name, problem) => {
    arms += 1;
    if (problem) {
      bad += 1;
      console.error(`  ❌ 臂 ${arms} ${name} —— ${problem}`);
    } else {
      console.log(`  ✅ 臂 ${arms} ${name}`);
    }
  };

  // 臂 1：阳性对照。真原文必须被认出来 —— 否则这把尺恒绿，比没有更糟。
  check('真实原文被判成载体问题（不是恒不命中）', (() => {
    const v = carrierFailureReason(REAL_REFUSED);
    return v ? null : 'ERR_CONNECTION_REFUSED 没有被认出';
  })());

  // 臂 2：反向对照。产品断言与超时**不许**被认成载体 —— 那会把真红洗成"环境问题"。
  check('产品断言与超时不被误判成载体（不是恒命中）', (() => {
    const wrong = NOT_CARRIER.filter((m) => carrierFailureReason(m));
    return wrong.length ? `误判 ${wrong.length} 条` : null;
  })());

  // 臂 3：分母自检。签名表每一枚都要有样本喂进去并命中；漏一枚说明加了表却没加判据。
  check('签名表逐枚都有样本且逐枚命中（分母自检）', (() => {
    const missed = CARRIER_SIGNATURES.filter((s) => !carrierFailureReason(`page.goto: ${s.needle} at x`));
    return missed.length ? `这 ${missed.length} 枚签名认不出：${missed.map((s) => s.needle).join(', ')}` : null;
  })());

  // 臂 4：三份进链配置逐份引用报告器。
  check('三份进链配置都带上了报告器', (() => {
    const missing = configsReferenceReporter(ROOT);
    return missing.length ? `这 ${missing.length} 份没引用：${missing.join(', ')}` : null;
  })());

  // 臂 5（臂 4 的反证）：把其中一份摘掉，同一条判据必须变红 —— 证明臂 4 有牙而不是恒真。
  check('摘掉一份配置的引用后，同一条判据会红（阳性对照）', (() => {
    const stub = { readFileSync: (p) => (String(p).endsWith('playwright.config.ts') ? '' : realRead(p)) };
    const orig = configsReferenceReporterWith(stub);
    return orig.length === 1 && orig[0] === 'e2e/playwright.config.ts'
      ? null
      : `摘掉一份后回的是 ${JSON.stringify(orig)}`;
  })());

  // 臂 6：命中时**真的中止**（子进程退出码 160 + 那句作废判定）。
  check('报告器命中时以 160 中止并打印作废判定', probeReporter(REAL_REFUSED, true));

  // 臂 7：不命中时**不许**中止（否则一次真红就把整轮洗成环境问题）。
  check('报告器对普通断言不中止', probeReporter(NOT_CARRIER[0], false));

  console.log(`\n自检 ${arms} 臂 ｜ 失败 ${bad} 臂`);
  process.exit(bad ? 1 : 0);
}

function realRead(p) {
  return readFileSync(p, 'utf8');
}

/** 臂 5 用同一份逻辑、换一个 readFileSync，避免把判据抄第二遍。 */
function configsReferenceReporterWith(fakeFs) {
  const missing = [];
  for (const rel of CHAINED_CONFIGS) {
    if (!fakeFs.readFileSync(join(ROOT, rel), 'utf8').includes('carrier-health.mjs')) missing.push(rel);
  }
  return missing;
}

function realCheck() {
  let bad = 0;
  for (const rel of [SIGNATURE_FILE, REPORTER_FILE]) {
    if (!existsSync(join(ROOT, rel))) {
      bad += 1;
      fail(`判据的输入不在场：${rel}`);
    }
  }
  if (bad) process.exit(1);

  // 签名文件必须零 import：它是根门禁（不在 e2e 工作区内）唯一能引的那一半。
  const sig = readFileSync(join(ROOT, SIGNATURE_FILE), 'utf8');
  if (/^import\s/m.test(sig)) {
    fail(`${SIGNATURE_FILE} 里有 import ⇒ 根门禁引不动它（e2e 刻意不在 pnpm 工作区内）`);
    bad += 1;
  }
  if (CARRIER_SIGNATURES.length === 0) {
    fail('签名表是空的 ⇒ 这条判据恒不命中');
    bad += 1;
  }
  const missing = configsReferenceReporter(ROOT);
  if (missing.length) {
    fail(`这 ${missing.length} 份进链配置没带载体健康报告器：\n   ${missing.join('\n   ')}`);
    bad += 1;
  }
  if (bad) process.exit(1);
  console.log(
    `✅ e2e 载体判定在场：${CHAINED_CONFIGS.length} 份进链配置各引用 ${relative(ROOT, join(ROOT, REPORTER_FILE))}，` +
      `签名表 ${CARRIER_SIGNATURES.length} 枚（分母自检由 --self-test 逐臂证明）`,
  );
}

if (process.argv.includes('--self-test')) selfTest();
else realCheck();
