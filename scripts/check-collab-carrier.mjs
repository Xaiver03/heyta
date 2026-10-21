#!/usr/bin/env node
/**
 * 门禁：协作线每一套验收都必须**有载具**（计划 §9.3 M7）
 * =====================================================
 *
 * ## 它防的失效
 *
 * 这条线以前坏过一次：脚本写了、文档里写着"有 `verify:collab-*` 五套验收"，
 * 但**没有任何东西自动跑它们** —— 于是"有验收"的真实形状是"上次有人手动跑过，
 * 读数写在某个文档里"。判据不常驻，绿就会过期，而下一个人读到的是那句"有验收"。
 *
 * ## 载具只有两种合法形状
 *
 * | 形状 | 谁能用 | 为什么 |
 * |---|---|---|
 * | ① 进 `pnpm check` 链 | 便宜的（`verify:collab-keys` 实测 0.3s、只要构建产物） | 每次全量门禁都跑，不需要人记得 |
 * | ② 进 `verify:collab-suite` 名册 | 贵的（要真 PostgreSQL / 真浏览器那四套） | 串行跑一次就有全套读数；登记在 `docs/agents/commands.md` |
 *
 * 🔴 名册本身也要有载具：`pnpm verify:collab-suite` 必须在 `commands.md` 里有一行 ——
 * 否则"有载具"变成"有一张没人会执行的名单"。
 *
 * ## 为什么不直接扩 `check:gate-wiring`
 *
 * 那把尺今天只审 `check:*`（现量：`grep -c verify scripts/check-gate-wiring.mjs` = 0）。
 * 把它扩到全部 `verify:*` 会一次牵动别的线的**判据口径**（它们那几十套验收今天同样没有载具，
 * 一扩就是别人的链红）。所以本线先立自己这一道，扩公共那把尺的事登记在计划里，
 * 不在这里替别人定口径。
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();

const PKG = 'package.json';
const SUITE = 'scripts/verify-collab-suite.mjs';
const COMMANDS = 'docs/agents/commands.md';

/** 套件脚本名 —— 它自己不吃"① 或 ②"这条判据，它吃"必须有可验消费方"。 */
const SUITE_KEY = 'verify:collab-suite';

const problems = [];

const read = (rel) => {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

const pkgText = read(PKG);
const suiteText = read(SUITE);
const commandsText = read(COMMANDS);

if (pkgText === null) {
  console.error(`❌ collab-carrier：读不到 ${PKG}`);
  process.exit(1);
}
let pkg;
try {
  pkg = JSON.parse(pkgText);
} catch {
  console.error(`❌ collab-carrier：${PKG} 不是合法 JSON，判据问不到任何东西`);
  process.exit(1);
}
const scripts = pkg.scripts ?? {};
const chain = scripts.check ?? '';

if (suiteText === null) {
  problems.push(['suite-missing', `${SUITE} 不见了 —— 贵验收那四套的载具本体没了。`]);
}
if (commandsText === null) {
  problems.push(['suite-no-consumer', `读不到 ${COMMANDS}，无法确认套件有没有可验消费方。`]);
}

/* ── 名册：从套件脚本里读出来，不在这里抄第二份 ─────────────────────── */
const rosterMatch = suiteText?.match(/const\s+ROSTER\s*=\s*\[([^\]]*)\]/);
const roster = rosterMatch
  ? rosterMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter((s) => s !== '')
  : null;
if (roster === null && suiteText !== null) {
  problems.push(['suite-missing', `${SUITE} 里找不到 \`const ROSTER = [...]\` —— 载具名册读不出来。`]);
}

const collabKeys = Object.keys(scripts).filter((k) => k.startsWith('verify:collab-') && k !== SUITE_KEY);
if (collabKeys.length === 0) {
  problems.push(['no-gates', 'package.json 里一枚 `verify:collab-*` 都没有 —— 这条线的验收全被删了？']);
}

/* ── ① / ②：每套验收都得有一种载具 ─────────────────────────────── */
for (const key of collabKeys) {
  const inChain = chain.includes(`pnpm ${key}`);
  const inRoster = roster !== null && key.startsWith('verify:collab-') && roster.includes(key.slice('verify:collab-'.length));
  if (inChain || inRoster) continue;
  problems.push([
    'no-carrier',
    `${key} 既不在 \`pnpm check\` 链里，也不在 ${SUITE} 的名册里 —— ` +
      `它是一套**没人自动跑**的验收。便宜的（零服务端）就进链，贵的就进名册，别让它当"已有验收"。`,
  ]);
}

/* ── 名册里的每一项都得真存在（防空名册 / 指错脚本） ──────────────── */
for (const name of roster ?? []) {
  const key = `verify:collab-${name}`;
  if (!(key in scripts)) {
    problems.push(['roster-dangling', `${SUITE} 名册里的 ${name} 没有对应的 ${key} 脚本定义。`]);
  }
  if (!existsSync(join(ROOT, 'scripts', `verify-collab-${name}.mjs`))) {
    problems.push(['roster-dangling', `${SUITE} 名册里的 ${name} 对应的脚本文件不存在。`]);
  }
}

/* ── 套件的载体：必须在 commands.md 里有一行 ────────────────────── */
if (commandsText !== null && !commandsText.includes('verify:collab-suite')) {
  problems.push([
    'suite-no-consumer',
    `${COMMANDS} 里没有 ${SUITE_KEY} 这一行 —— 名册有了，但没有人知道要跑它，` +
      '"有载具"就变成了"有一张没人执行的名单"。',
  ]);
}
if (!(SUITE_KEY in scripts)) {
  problems.push(['suite-missing', `package.json 里没有 ${SUITE_KEY} 的定义。`]);
}

/* ── 自检：每臂都必须红，另有一条阳性对照 ────────────────────────
 *
 * 🔴 这道尺量的是"接线形状"，而接线类判据最典型的坏法是**恒绿**
 * （名册读空、链里搜错字符串、分母取错）。不注入病灶就没人知道它到底在不在看。
 * 每臂改的都是临时副本（`HEYTA_CHECK_ROOT` 指过去），工作树零改动。
 */
const FIXTURE_FILES = [PKG, SUITE, COMMANDS];

function fixtureRoot(apply) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-collab-carrier-'));
  const files = {};
  for (const rel of FIXTURE_FILES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) throw new Error(`夹具缺文件：${rel}`);
    files[rel] = readFileSync(abs, 'utf8');
  }
  if (apply) apply(files);
  for (const rel of Object.keys(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, files[rel]);
  }
  // 名册项的存在性判据要看真脚本文件 —— 把它们也拷过去（只拷用到的那几枚）。
  for (const name of ['keys', 'sync', 'revoke', 'conflict', 'journey']) {
    const rel = `scripts/verify-collab-${name}.mjs`;
    const abs = join(ROOT, rel);
    if (existsSync(abs)) {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, rel), readFileSync(abs, 'utf8'));
    }
  }
  return dir;
}

function runGate(root) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, HEYTA_CHECK_ROOT: root },
    encoding: 'utf8',
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

const MUTATIONS = {
  'no-carrier-keys': (files) => {
    files[PKG] = files[PKG].replace('pnpm verify:collab-keys && ', '');
  },
  'no-carrier-journey': (files) => {
    files[SUITE] = files[SUITE].replace("'conflict', 'journey'", "'conflict'");
  },
  'no-carrier-new': (files) => {
    files[PKG] = files[PKG].replace(
      '"verify:collab-keys":',
      '"verify:collab-newly-added": "node scripts/verify-collab-newly-added.mjs",\n    "verify:collab-keys":',
    );
  },
  'suite-no-consumer': (files) => {
    files[COMMANDS] = files[COMMANDS].replace(/pnpm verify:collab-suite/g, 'pnpm verify:something-else');
  },
  'roster-dangling': (files) => {
    files[SUITE] = files[SUITE].replace("'conflict', 'journey'", "'conflict', 'journey', 'ghost'");
  },
};

const ARMS = [
  ['A 把 keys 从链里摘掉 ⇒ 红并点名 no-carrier', 'no-carrier-keys', 'no-carrier'],
  ['B 从名册里摘掉 journey ⇒ 红并点名 no-carrier', 'no-carrier-journey', 'no-carrier'],
  ['C 新加一枚验收而两处都没接 ⇒ 红并点名 no-carrier', 'no-carrier-new', 'no-carrier'],
  ['D 删掉 commands.md 里那行 ⇒ 红并点名 suite-no-consumer', 'suite-no-consumer', 'suite-no-consumer'],
  ['E 名册里写一个不存在的腿 ⇒ 红并点名 roster-dangling', 'roster-dangling', 'roster-dangling'],
];

function selfTest() {
  let failures = 0;
  const clean = fixtureRoot(null);
  try {
    const out = runGate(clean);
    if (out.includes('❌')) {
      console.log(`❌ 阳性对照失败：现状被报红\n${out.slice(0, 240)}`);
      failures += 1;
    } else {
      console.log('✅ 阳性对照：现状（keys 进链 + 四腿进名册 + 套件登记在 commands.md）⇒ 零报红');
    }
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
  for (const [label, mutation, expectCode] of ARMS) {
    let dir;
    let out = '';
    let applied = false;
    try {
      dir = fixtureRoot((files) => {
        const before = JSON.stringify(files);
        MUTATIONS[mutation](files);
        applied = JSON.stringify(files) !== before;
      });
      if (!applied) {
        console.log(`❌ 臂 ${label} —— 病灶没注进去（被改的文件形状变了，臂要跟着改）`);
        failures += 1;
        continue;
      }
      out = runGate(dir);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    const hit = out.includes('❌') && out.includes(`${expectCode}：`);
    console.log(`${hit ? '✅' : '❌'} 臂 ${label}${hit ? '' : ` —— 实际输出：${out.trim().slice(0, 200)}`}`);
    if (!hit) failures += 1;
  }
  console.log(`\n臂数 ${ARMS.length}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

if (problems.length > 0) {
  console.error('❌ 协作线有验收没有载具：\n');
  for (const [code, text] of problems) console.error(`   ${code}：${text}\n`);
  console.error(
    '   判据见 scripts/check-collab-carrier.mjs 文件头（两种合法载具）与\n' +
      `   docs/plans/collaboration-shared-lists.md §9.3 M7。现状：check 链共 ${chain.split('&&').length} 段。`,
  );
  process.exit(1);
}

console.log(
  `✅ 协作线 ${collabKeys.length} 套验收全有载具：链内 ${
    collabKeys.filter((k) => chain.includes(`pnpm ${k}`)).length
  } 套 / 名册内 ${roster.length} 腿，套件已登记在 ${COMMANDS}`,
);
