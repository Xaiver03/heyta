#!/usr/bin/env node
/**
 * 门禁：e2e 的**载体健康**判定必须在场、必须认得出那四类签名、必须真的会中止；
 * 载体的**端口必须是一个槽**（唯一所有者 `e2e/ports.ts`），不许散成十几处字面量。
 *
 * 起因（2026-10-06 一整轮 `check:ai-e2e` 读数作废）：vite dev server 在第 6 条用例之后死了，
 * Playwright 不会因此停下，于是剩下 190 多条逐条 `net::ERR_CONNECTION_REFUSED` 红在 130 ms 上 ——
 * 输出读起来像"后台 / AI 助手 / 拆解 / 捕获 / 估时 / 优先级全坏了"，而真相只有一句：载体不在了。
 * 已有的 `check-ai-e2e-preflight.mjs` 只判**起跑那一刻**端口上是谁的进程，对"跑到一半没了"零覆盖。
 *
 * 第二半（同一夜定源）：那轮 vite 是**被本仓自己的跑前清场杀掉的** —— 归属判定按子串比路径，
 * 而本机有 `…/heyta` 与 `…/heyta-wt-merge` 这对互为前缀的兄弟检出。清场修好之后还留一个问题：
 * **两棵树本来就不该共用同一对端口**。端口散在十几处字面量里时，"换个槽再跑"这条路不存在，
 * 于是唯一的处置只能是"抢"或"等"。所以这道门禁同时钉住槽的形状（见 `e2e/ports.ts` 的头注释）。
 *
 * 用法：
 *   node scripts/check-e2e-carrier.mjs             # 真实检查（三份配置 + 两枚文件 + 接线 + 端口槽）
 *   node scripts/check-e2e-carrier.mjs --self-test # 逐臂证明这把尺会红
 *
 * ⚠️ 臂数只由本文件自己打印，不许抄进任何文档（抄了就一定会漂）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

  // 臂 8：端口槽的所有者在场且两个旋钮都读 env（只导出不读 ⇒ 换槽这条路还是不存在）。
  check('端口所有者两个旋钮都读 env', (() => {
    if (!existsSync(join(ROOT, PORT_OWNER))) return `${PORT_OWNER} 不在场`;
    const unread = ownerReadsEnv(realRead(join(ROOT, PORT_OWNER)));
    return unread.length ? `没读：${unread.join(', ')}` : null;
  })());

  // 臂 9：扫描的**阳性对照** —— 喂两份把端口写死的假 spec（一份是 URL、一份是 `--port`），
  // 必须各自点名。URL 那一枚就是本仓真实出现过、且被"剥注释"误放过一次的形状。
  check('扫描抓得住抄进去的字面量（阳性对照：URL 与 --port 两种形状）', (() => {
    const cases = [
      [`await page.goto('http://127.0.0.1:4318/');`, 1],
      [`  command: 'pnpm exec vite --host 127.0.0.1 --port 4319 --strictPort',`, 1],
      [`const a = 1;\nconst b = 'http://localhost:4318';`, 1],
      [`// 只是注释里的 http://127.0.0.1:4318`, 0],
    ];
    for (const [text, expectHits] of cases) {
      const hit = portLiteralViolations(() => `${text}\n`, ['e2e/tests/__fake__.spec.ts']);
      if (hit.length !== expectHits) return `样本「${text.slice(0, 40)}…」回的是 ${JSON.stringify(hit)}`;
    }
    return null;
  })());

  // 臂 10：扫描的**反向对照** —— 注释里提到号不路由任何东西，不许把它判成违规
  // （否则这把尺会红一片，下一个动它的人会直接把判据删掉）。
  check('扫描不把注释里的号当违规（反向对照）', (() => {
    const fake = ['// 主配置起的是 http://127.0.0.1:4318/', ' * vite --port 4318', 'const u = "x"; // :4319'].join('\n');
    const hit = portLiteralViolations(() => fake, ['e2e/tests/__fake__.spec.ts']);
    return hit.length === 0 ? null : `注释行被当成了违规：${JSON.stringify(hit)}`;
  })());

  // 臂 11：分母自检 —— 真扫到的文件数必须远大于零，且真实树上零违规。
  // （臂 9/10 证的是"会抓/不冤枉"，这一臂证的是"它真的抓了整棵树"。）
  check('扫描的分母非零且真实树干净', (() => {
    const files = e2eSourceFiles();
    if (files.length < 30) return `只扫到 ${files.length} 份 e2e 源文件 ⇒ 遍历大概率漏了目录`;
    const violations = portLiteralViolations(realRead, files);
    return violations.length ? `这 ${violations.length} 处抄了字面量：${violations.join(', ')}` : null;
  })());

  // 臂 12：主配置必须从所有者拿端口（自己写死一枚就是第二个所有者）。
  check('主配置从所有者拿端口', (() => {
    const problems = mainConfigSlotProblems(realRead(join(ROOT, 'e2e/playwright.config.ts')));
    return problems.length ? problems.join('；') : null;
  })());

  // 臂 13（臂 12 的阳性对照）：把 import 换成写死的 `--port 4318`，同一条判据必须变红。
  check('主配置写死端口时同一条判据会红（阳性对照）', (() => {
    const broken = realRead(join(ROOT, 'e2e/playwright.config.ts'))
      .replace(/from '\.\/ports'/, "from './not-ports'")
      .replace('--port ${String(APP_PORT)}', '--port 4318');
    const problems = mainConfigSlotProblems(broken);
    return problems.length === 2 ? null : `改坏之后回的是 ${JSON.stringify(problems)}`;
  })());

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

/** 端口槽的唯一所有者。 */
const PORT_OWNER = 'e2e/ports.ts';

/**
 * 会**真的**把流量指到端口的字面量形状，只认主套件那一族（4318 / 4319）。
 *
 * ⚠️ 刻意不扩到 4320 / 4322 那些段：它们各有自己的号、本轮没有跨树相撞的证据，
 * 而"把所有槽一次参数化"要动的文件与撞车面都大得多。同一形状的其余槽位登记在计划里。
 */
const PORT_LITERAL = /(?:127\.0\.0\.1|localhost):431[89]|--port\s+431[89]\b/;

/** 目录遍历里直接跳过的东西（产物目录不是源代码）。 */
const NAME_SKIP = new Set(['node_modules', 'test-results', 'playwright-report', '.git']);

/**
 * 一行代码里"真参与路由"的那部分。
 *
 * 🔴 剥行尾注释时**不能**把 `http://` 里的那两个斜杠当注释起点 —— 拿 `indexOf('//')` 一刀切会
 * 把 `page.goto('http://127.0.0.1:4318/')` 切成 `page.goto('http:`，于是最需要抓的形状**正好被放过**。
 * 本臂的阳性对照第一次跑就抓到这件事（红的是判据自己，不是被测代码）。
 * 规则：注释起点是第一个**前面不是冒号**的 `//`。
 */
function codePartOf(line) {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return '';
  for (let at = line.indexOf('//'); at !== -1; at = line.indexOf('//', at + 1)) {
    if (line[at - 1] !== ':') return line.slice(0, at);
  }
  return line;
}

function e2eSourceFiles(dir = join(ROOT, 'e2e'), base = 'e2e') {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (NAME_SKIP.has(name)) continue;
    const abs = join(dir, name);
    const rel = `${base}/${name}`;
    if (statSync(abs).isDirectory()) out.push(...e2eSourceFiles(abs, rel));
    else if (/\.(ts|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

/**
 * 端口字面量的分母扫描：所有者之外，任何代码行里出现主族端口都算"第二个所有者"。
 * `files` / `readText` 是注入点 —— 反证臂喂一份假内容，不改工作树。
 */
function portLiteralViolations(readText, files) {
  const found = [];
  for (const rel of files) {
    if (rel === PORT_OWNER) continue;
    const lines = readText(join(ROOT, rel), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (PORT_LITERAL.test(codePartOf(lines[i]))) found.push(`${rel}:${String(i + 1)}`);
    }
  }
  return found;
}

/** 所有者必须两个旋钮都读 env —— 只导出不读，"换槽"这条路就还是不存在。 */
function ownerReadsEnv(text) {
  return ['HEYTA_E2E_APP_PORT', 'HEYTA_E2E_STUB_PORT'].filter((env) => !text.includes(env));
}

/** 主配置必须**从所有者拿**端口；自己写死一枚就是第二个所有者。 */
function mainConfigSlotProblems(text) {
  const problems = [];
  if (!/from '\.\/ports'/.test(text)) problems.push('没有 `from \'./ports\'` ⇒ 用例连的端口与 webServer 起的端口会各说各话');
  if (/--port\s+431[89]/.test(text)) problems.push('命令串里写死了 `--port 431x`');
  return problems;
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

  // 端口槽：必须有单一所有者、两个旋钮都读 env、主配置从它拿端口，且别处零字面量。
  if (!existsSync(join(ROOT, PORT_OWNER))) {
    fail(`端口槽的所有者不在场：${PORT_OWNER}`);
    bad += 1;
  } else {
    const unread = ownerReadsEnv(readFileSync(join(ROOT, PORT_OWNER), 'utf8'));
    if (unread.length) {
      fail(`${PORT_OWNER} 没读这些旋钮：${unread.join(', ')} ⇒ "换槽"这条路根本不存在，两棵树只能抢同一对端口`);
      bad += 1;
    }
  }
  for (const problem of mainConfigSlotProblems(readFileSync(join(ROOT, 'e2e/playwright.config.ts'), 'utf8'))) {
    fail(`主配置：${problem}`);
    bad += 1;
  }
  const violations = portLiteralViolations((p) => readFileSync(p, 'utf8'), e2eSourceFiles());
  if (violations.length) {
    fail(
      `这 ${violations.length} 处代码行把主族端口写成了字面量（槽的唯一所有者是 ${PORT_OWNER}）：\n   ` +
        violations.join('\n   ') +
        '\n   ⇒ 换槽之后漏改的那几处不会报错，只会连到**别的树**的 server（traps #358）。',
    );
    bad += 1;
  }

  if (bad) process.exit(1);
  console.log(
    `✅ e2e 载体判定在场：${CHAINED_CONFIGS.length} 份进链配置各引用 ${relative(ROOT, join(ROOT, REPORTER_FILE))}，` +
      `签名表 ${CARRIER_SIGNATURES.length} 枚，端口槽唯一所有者 ${PORT_OWNER}（扫描 ${e2eSourceFiles().length} 份 e2e 源文件）` +
      ' —— 分母自检由 --self-test 逐臂证明',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else realCheck();
