#!/usr/bin/env node
/**
 * `check:release-version-guard` —— 发布版本**不许倒号**这条判据的守卫。
 *
 * ## 它挡的是什么
 *
 * 2026-10-16 实测：根 `package.json` = `0.1.0`，而桶里已经发出
 * `1.0.1-test.20261008.4`。`upload-dist.sh` 每轮都会把
 * `latest.json` 的顶层 `version` 覆盖成本轮的号 —— 所以照根取号的那一批会让
 * **版本号往回走**，而**没有任何一层会报错**：落地页按钮指向更小的版本，
 * 用户装到旧字节，一切看起来正常。
 *
 * ## 🔴 为什么它值得一条常驻门禁：上一版守卫是**死的**
 *
 * 第一版只比逐端 `files[p].version`。可**桶里旧条目本来就没有这个字段**
 * （老清单把版本只挂在顶层），逐端那个值全靠 `backfill()` 从**文件名**反推；
 * 文件名不合形状时 `old_core` 是 `None`，代码**静默放行**。
 * 直接对着桶里的 JSON 读，四端 `version` **全是 `None`** ⇒
 * **那条守卫一次也不会响**，是一条"永远通过"的判据（§7 元规则二）。
 *
 * ⇒ 所以这里把"**同时看顶层**"这件事钉成**可离线复跑**的判据（臂 A/B/C/D），
 *   并额外钉死"发布脚本**真的调了这个工具**"（臂 E）——
 *   否则有人删掉那一行调用，前面几条臂全绿而守卫已经不在了。
 *
 * ## 用法
 *
 *   node check-release-version-guard.mjs --self-test     # 逐臂证明会红 + 阳性对照
 *   node check-release-version-guard.mjs                 # 真检查（离线，见下）
 *   node check-release-version-guard.mjs --version 1.0.1 --platform macos \
 *        --manifest /path/to/latest.json                 # 发布脚本在**上传前**调这个
 *
 * 真检查是**离线**的：它只读仓库里的三样东西（快照、根 `package.json`、
 * 发布脚本），不联网、不拉桶 —— 联网那一半由发布脚本在**它自己那一刻**调本工具完成。
 * （`check:*` 那一族是离线的；要联网的是 `verify:*` 那一族。）
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

export const MANIFEST_SNAPSHOT = 'apps/landing/src/site/release-manifest.json';
export const RELEASE_SCRIPT = 'scripts/upload-dist.sh';

/** 版本内核 `X.Y.Z`。取不到就 `undefined` —— **不许猜一个**。 */
export function core(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 比大小；任一侧取不到内核时返回 `0`（= 不比，而非"相等"）。 */
function compare(a, b) {
  if (a === undefined || b === undefined) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 本轮要发的版本 vs 已发布版本，返回问题列表（空 = 放行）。
 *
 * 🔴 `published` 里**必须**包含顶层那一份。只给逐端是不够的 ——
 * 老清单的版本只挂在顶层，逐端那个值要么不存在、要么是从文件名反推的。
 *
 * @param {{version: string, platforms: readonly string[], published: {top?: unknown, platforms?: Record<string, unknown>}}} input
 */
export function versionRegressionProblems({ version, platforms, published }) {
  const problems = [];
  const next = core(version);
  if (next === undefined) {
    return [`--version「${version}」不是 X.Y.Z 形状，无法与已发布版本对账`];
  }

  const seen = [['顶层 latest.json', published.top]];
  for (const p of platforms) seen.push([`端 ${p}`, published.platforms?.[p]]);

  for (const [where, old] of seen) {
    const prev = core(old);
    if (prev !== undefined && compare(next, prev) < 0) {
      problems.push(
        `版本倒号：${where} 已经发布 ${String(old)}，本轮要发 ${version} —— ` +
          'latest.json 的版本会往回改，而没有任何一层会报错',
      );
    }
  }
  return problems;
}

/* ── 发布脚本调用的那一半（联网时由脚本喂它桶里那份 JSON）────────────── */

function runCli(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const version = get('--version');
  const manifestPath = get('--manifest');
  const platforms = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--platform') platforms.push(argv[i + 1]);
  }

  if (version === undefined || manifestPath === undefined) {
    console.error('🔴 用法：--version <X.Y.Z> --manifest <latest.json> [--platform <p>]…');
    process.exit(2);
  }

  let doc = {};
  if (manifestPath !== '-') {
    if (!existsSync(manifestPath)) {
      console.error(`🔴 读不到已发布清单：${manifestPath}`);
      process.exit(2);
    }
    try {
      doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      console.error(`🔴 已发布清单不是 JSON：${String(error)}`);
      process.exit(2);
    }
  }

  const problems = versionRegressionProblems({
    version,
    platforms,
    published: { top: doc?.version, platforms: doc?.files ?? {} },
  });
  if (problems.length > 0) {
    console.error(`🔴 发布版本守卫拦下了这一批（${problems.length} 条）：`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('   要发就发一个更大的版本号。这一条**不替人决定**发哪个号。');
    process.exit(1);
  }
  console.log(`✅ 版本守卫放行：${version}（已发布顶层 = ${String(doc?.version ?? '(无)')}）`);
}

/* ── 自检：五臂各自必须能红，另有一条阳性对照 ───────────────────────── */

const ARMS = [
  [
    'A 顶层倒号',
    () => versionRegressionProblems({ version: '0.1.0', platforms: ['macos'], published: { top: '1.0.0' } }),
    '版本倒号',
  ],
  [
    // 🔴 这一臂就是第一版守卫**唯一**能看见的东西；它必须仍然能红，
    // 但它**单独不足以**覆盖真实处境（真实处境里逐端 version 往往是 undefined）。
    'B 逐端倒号（顶层缺失）',
    () => versionRegressionProblems({ version: '1.0.0', platforms: ['macos'], published: { platforms: { macos: '1.2.0' } } }),
    '版本倒号',
  ],
  [
    'C 不是 X.Y.Z',
    () => versionRegressionProblems({ version: '1.0', platforms: ['macos'], published: { top: '0.9.0' } }),
    '不是 X.Y.Z 形状',
  ],
  [
    // 🔴 真实处境的那一格：顶层写了版本、逐端**没有** version 字段。
    // 第一版只读逐端 ⇒ 这里会**静默放行**。这条臂就是用来钉死那个形状的。
    'D 顶层倒号 + 逐端无 version（第一版的盲区）',
    () =>
      versionRegressionProblems({
        version: '0.1.0',
        platforms: ['macos', 'android'],
        published: { top: '1.0.1-test.20261008.4', platforms: { macos: {}, android: {} } },
      }),
    '版本倒号',
  ],
  [
    'E 发布脚本没调这个工具',
    (dir) => {
      mkdirSync(dirname(join(dir, RELEASE_SCRIPT)), { recursive: true });
      writeFileSync(join(dir, RELEASE_SCRIPT), '#!/usr/bin/env bash\necho "上传并通过"\n');
      return scriptGuardProblems(dir);
    },
    '没有调用版本守卫',
  ],
];

/** 阳性对照：一份"相等"的版本必须零报红（相等不是倒退）。 */
const CLEAN = () =>
  versionRegressionProblems({
    version: '1.0.1-test.20261016.1',
    platforms: ['macos', 'android'],
    published: { top: '1.0.1-test.20261008.4', platforms: { macos: {}, android: {} } },
  });

/** 发布脚本必须真的调用本工具 —— 否则前面几条臂全绿而守卫已经不在了。 */
export function scriptGuardProblems(root) {
  const path = join(root, RELEASE_SCRIPT);
  if (!existsSync(path)) return [`找不到发布脚本 ${RELEASE_SCRIPT}`];
  const code = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  return code.includes('check-release-version-guard.mjs')
    ? []
    : ['发布脚本没有调用版本守卫（check-release-version-guard.mjs）—— 它就等于不在'];
}

function fixtureTree() {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-version-guard-'));
  return dir;
}

function selfTest() {
  let arms = 0;
  let failures = 0;
  for (const [label, run, expect] of ARMS) {
    arms += 1;
    const dir = fixtureTree();
    let problems;
    try {
      problems = run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const hit = problems.some((p) => p.includes(expect));
    if (hit) console.log(`✅ 臂 ${label} 报红：${problems.find((p) => p.includes(expect))}`);
    else console.log(`❌ 臂 ${label} 没有报红：${problems.join(' / ') || '(无问题)'}`);
    if (!hit) failures += 1;
  }

  const clean = CLEAN();
  if (clean.length > 0) {
    console.log(`❌ 阳性对照失败：合法的"版本相等/前进"被报红 ${clean.length} 条\n  ${clean.join('\n  ')}`);
    failures += 1;
  } else {
    console.log('✅ 阳性对照：版本相等/前进零报红');
  }

  console.log(`\n臂数 ${arms}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

/* ── 真检查（离线） ───────────────────────────────────────────────── */

function realCheck() {
  const problems = [...scriptGuardProblems(ROOT)];

  // 快照自身必须能被本工具读懂（顶层与逐端版本都要能取到或确认为空）。
  const manifestPath = join(ROOT, MANIFEST_SNAPSHOT);
  if (!existsSync(manifestPath)) {
    problems.push(`找不到发布清单快照 ${MANIFEST_SNAPSHOT}`);
  } else {
    let doc;
    try {
      doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      problems.push(`${MANIFEST_SNAPSHOT} 不是 JSON：${String(error)}`);
      doc = undefined;
    }
    if (doc !== undefined && core(doc.version) === undefined) {
      problems.push(`${MANIFEST_SNAPSHOT} 的顶层 version「${String(doc.version)}」不是 X.Y.Z 形状`);
    }
  }

  if (problems.length > 0) {
    console.error(`🔴 发布版本守卫门禁红了（${problems.length} 条）：\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(
    `✅ 版本守卫在位：发布脚本调用点 1 处，快照顶层 ${doc.version} 形状合法（逐臂自检见 --self-test）`,
  );
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else if (argv.includes('--version')) runCli(argv);
else realCheck();
