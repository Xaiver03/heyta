#!/usr/bin/env node
/**
 * 包管理器缓存路径**不得再进 `HEAD`**。
 *
 * 为什么需要这条门禁（不是顺手加的）
 * ----------------------------------
 * gitee 那枚镜像的 push 被服务端按仓库体积拒（`Repo size: …, exceeds quota 1024MB`）。
 * 体积账在 `BLOCKED.md` **B243 追记三** 里逐把尺量过，其中决定性的那一刀是：
 * `.pnpm-store/v11`（186.2 MB）与 `research/standalone/.npm-cache`（130.1 MB）**合计 316.3 MB
 * 只被历史里的旧代际需要**，引入提交是同一枚 `b59dfb627`（2026-09-25）。
 *
 * 🔴 而 `.gitignore` **挡不住已经写进历史的东西**：`:60`/`:65` 钉住了这两个前缀，可那只挡未来的
 * 默认 `git add`；当初那次 `git rm --cached` 也只摘指针、对象仍全仓可达。更糟的是
 * **`git add -f` 今天照样能把它们再塞回来一次** —— 那时新增的不是"一点体积"，是**把同一个错误重新
 * 提交进历史**，而这一档错误事后请不出去（要请就得重写历史、双端强推，那是另一个量级的动作）。
 *
 * 所以这条门禁判的是**唯一还能便宜守住的时点**：`HEAD` 里不许出现这两个前缀。
 * 它**不要阈值、不要豁免名单** —— 命中集合非空就是红。
 *
 * 判据形状与"为什么它能红"
 * ------------------------
 *   · 对象：`HEAD` 的整棵树的**路径清单**（`git ls-tree -r --name-only HEAD`），不是工作树、不是索引；
 *   · `-c core.quotePath=false` 是必须的：默认 git 会把非 ASCII 路径**包成带引号的八进制串**，
 *     那副形状下 `^\.pnpm-store/` 这种锚点会**静默打空**（读起来像"没有命中"，实际是"没看清"）；
 *   · 🔴 **取不到清单 ≠ 零命中**。`ls-tree` 失败、`HEAD` 不存在、输出为空 —— 都判**探针坏了**并红退，
 *     绝不退 0。这是本仓那条元规则的又一处："一条永远通过的判据比没有判据更糟"。
 *
 * 用法
 * ```sh
 * pnpm check:repo-cache-paths              # 正常跑（在 pnpm check 链里）
 * node scripts/check-repo-cache-paths.mjs --self-test   # 跑三条臂：注入违规必须被抓住
 * ```
 *
 * `--self-test` 的三条臂都在**同一把谓词**上，不碰工作树：
 *   A 注入两枚违规路径 ⇒ 必须逐枚点名（谓词写坏／前缀漏一枚 ⇒ 这臂红）；
 *   B 一份干净清单 ⇒ 必须零命中（锚点过宽、把 `docs/` 也算进去 ⇒ 这臂红）；
 *   C 空清单／取不到 ⇒ 必须判"探针坏了"（把读不到当成通过 ⇒ 这臂红）。
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 不许出现在 `HEAD` 里的前缀（历史里那 316.3 MB 的两枚来源）。 */
const FORBIDDEN_PREFIXES = ['.pnpm-store/', 'research/standalone/.npm-cache/'];

const SELF_TEST = process.argv.includes('--self-test');

/**
 * 在一份路径清单里找违规成员。
 *
 * 逐行前缀匹配而**不是**一个正则alternation：前缀集合要能一枚一枚点名，
 * 而"命中数"单独印出来时，下一位必须能看出是哪一枚、从哪条前缀判的。
 */
const findViolations = (paths) => {
  const hits = [];
  for (const p of paths) {
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (p.startsWith(prefix)) hits.push({ path: p, prefix });
    }
  }
  return hits;
};

/**
 * 采集侧的守卫：把"看不见"和"没有"分开。
 *
 * 🔴 三种读不到都要判**探针坏了**（红），不许退 0：命令失败、`HEAD` 取不到、清单为空。
 * 一棵有内容的树不会输出 0 行；把它读成"零命中 ⇒ 通过"就是那条元规则说的"永远通过的判据"。
 */
const judgeCollection = (status, stdout) => {
  if (status !== 0) return { ok: false, lines: [], reason: `git ls-tree 退出 ${status}，取不到 HEAD 的清单` };
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length === 0) return { ok: false, lines: [], reason: 'HEAD 的路径清单取到 0 行 —— 一棵有内容的树不会是这样' };
  return { ok: true, lines, reason: `${lines.length} 条` };
};

const selfTest = () => {
  let failed = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed += 1;
  };

  // 臂 A：注入两枚违规路径，必须**逐枚**点名（一枚都没抓到＝谓词是装饰）。
  const injected = [
    'AGENTS.md',
    '.pnpm-store/v11/files/ab/def',
    'research/standalone/.npm-cache/_cacache/index-v5/00/11',
    'apps/web/evidence/renew-20261022/shot.png',
  ];
  const a = findViolations(injected);
  check(
    `臂 A 注入违规必须被抓住（注入 2 枚，抓到 ${a.length} 枚）`,
    a.length === 2 &&
      a.some((h) => h.path.startsWith('.pnpm-store/')) &&
      a.some((h) => h.path.startsWith('research/standalone/.npm-cache/')),
    a.map((h) => h.prefix).join(' / ') || '一枚都没抓到 ⇒ 谓词失效',
  );

  // 臂 B：一份干净清单必须零命中（锚点写得过宽也会红，这里防的是"永远红"那一边）。
  const clean = [
    'AGENTS.md',
    'research/standalone/README.md',
    'research/standalone/.npmrc-mirror/x',
    'pnpm-store-notes.md',
    'packages/i18n/src/locales/zh-CN.ts',
  ];
  const b = findViolations(clean);
  check(`臂 B 干净清单必须零命中（命中 ${b.length} 枚）`, b.length === 0, b.map((h) => h.path).join(', '));

  // 臂 C：采集侧的三种"读不到"必须全判红，而正常那一格必须判可评。
  //（把这句抽成函数就是为了这臂能红：写死在 main 里的话，它永远没有机会失败。）
  const c1 = judgeCollection(128, '');
  const c2 = judgeCollection(0, '');
  const c3 = judgeCollection(0, 'AGENTS.md\n');
  check(
    `臂 C 读不到必须判探针坏了（ls-tree 失败=${c1.ok ? '误判通过' : '红'}；0 行=${c2.ok ? '误判通过' : '红'}；正常=${c3.ok ? '可评' : '误判红'}）`,
    !c1.ok && !c2.ok && c3.ok,
  );

  console.log(`\nself-test 臂数=3 失败=${failed}`);
  return failed === 0;
};

const main = () => {
  if (SELF_TEST) return selfTest() ? 0 : 1;

  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  });
  const collected = judgeCollection(r.status, r.stdout);
  if (!collected.ok) {
    console.error(`🔴 探针坏了：${collected.reason} ⇒ 这一维现在**判不了**，不许当成通过。`);
    const err = (r.stderr || '').trim();
    if (err) console.error(`   git 的原话：${err}`);
    return 1;
  }

  const hits = findViolations(collected.lines);
  console.log(`HEAD 路径清单=${collected.lines.length} 条；禁行前缀 ${FORBIDDEN_PREFIXES.length} 枚 ⇒ 命中 ${hits.length} 枚。`);
  if (hits.length > 0) {
    console.error('🔴 包管理器缓存路径进了 HEAD（这一档错误事后请不出去，只能重写历史）：');
    for (const h of hits.slice(0, 20)) console.error(`   · ${h.path}  ← 前缀「${h.prefix}」`);
    if (hits.length > 20) console.error(`   …（共 ${hits.length} 枚，只列前 20）`);
    console.error('   修法：把这一枚提交里的缓存路径摘出去（`git rm --cached -r <前缀>`），**不要**用 -f 再塞回来。');
    return 1;
  }
  console.log('✓ HEAD 里没有包管理器缓存路径（这两枚前缀在历史里的一次性错已经登记在 B243，本门只防回潮）。');
  return 0;
};

process.exit(main());
