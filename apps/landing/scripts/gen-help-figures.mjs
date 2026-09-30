#!/usr/bin/env node
/**
 * 文档中心配图生成器 —— 把 `screenshots/` 的真截图复制进落地页的 `public/`
 * ========================================================================
 *
 * 映射的唯一事实源是 `apps/landing/src/site/helpFigures.ts`；
 * 源图的目录与命名规则的唯一事实源是 `scripts/screenshots/targets.mjs`。
 * **这里两样都不重述**：只查表、只复制、只验证。
 *
 * 两种模式：
 *
 * ```
 * node apps/landing/scripts/gen-help-figures.mjs          # 写
 * node apps/landing/scripts/gen-help-figures.mjs --check  # 只判，不写（门禁）
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **为什么需要这么一道闸**
 *
 * 复制品与源图是两份文件，而"改了源忘了重跑生成器"是复制这件事的默认结局。
 * 所以 `--check` 比的是 **sha256**（`inspectPng` 顺手算出来的那个），
 * 不是 mtime —— mtime 过一次 `git clone` 就全废了。
 *
 * 🔴 **写模式是全有或全无**：先把每一条都验完，任何一条不过就**一个字节都不写**。
 * 半套配图比没配图更糟 —— 页面渲染得出来、构建也过，只有访客知道少了图，
 * 而那正是"没人会发现"那一类缺陷（AGENTS §7 三条元规则里的第五种死法）。
 *
 * ⚠️ **图号不在这里算。** `图 14-1` 的"章"来自注册表顺序，那件事住在
 * `docs.ts` 的 `docsFiguresOf()`，由渲染时算。这里再实现一遍就是两套编号，
 * 而文件名里根本没有编号 —— 生成器不需要知道它。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_ROOT,
  TARGETS,
  artifactName,
  expectedGroups,
} from '../../../scripts/screenshots/targets.mjs';
import { inspectPng, looksBlank, looksSmeared } from '../../../scripts/screenshots/png-stats.mjs';
import {
  HELP_FIGURES,
  HELP_FIGURE_ROOT,
  helpFigureDir,
  helpFigureFile,
} from '../src/site/helpFigures.ts';
import { SITE_PAGES } from '../src/site/pages.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const checkOnly = process.argv.slice(2).includes('--check');
const GROUPS = expectedGroups();

/** 注册表里"是文章"的 id。配图只许挂在文章上。 */
const ARTICLE_IDS = new Set(
  SITE_PAGES.filter((page) => page.docsKind === 'article').map((page) => page.id),
);

/**
 * 一张图 → `{ source, dest, target, stats }`，任何一步不对就 `throw`。
 *
 * ⚠️ 尺寸判据用**分组自己的 device**，与 `verify-artifacts.mjs` 同一套算法
 * （`viewport × deviceScaleFactor`）。在这里另写一个"1440×900"的字面量，
 * 下次改设备预设就会变成一张永远对不上的判据。
 */
function resolveFigure(articleId, figure) {
  const target = TARGETS.find((t) => t.id === figure.targetId);
  if (target === undefined) {
    throw new Error(
      `targetId "${figure.targetId}" 不在 scripts/screenshots/targets.mjs 的 TARGETS 里`,
    );
  }
  const group = GROUPS.find((g) => g.targets.some((t) => t.id === target.id));
  if (group === undefined) {
    throw new Error(`目标 "${figure.targetId}" 不属于任何截图分组（expectedGroups 出问题）`);
  }
  const source = join(repoRoot, ARTIFACT_ROOT, group.folder, artifactName(target));
  if (!existsSync(source)) {
    throw new Error(
      `找不到源图 ${relative(repoRoot, source)} —— 先跑 pnpm screenshot:capture 采这一张`,
    );
  }

  const stats = inspectPng(source);
  const scale = group.device.deviceScaleFactor ?? 1;
  const expected = {
    width: group.device.viewport.width * scale,
    height: group.device.viewport.height * scale,
  };
  if (stats.width !== expected.width || stats.height !== expected.height) {
    throw new Error(
      `${relative(repoRoot, source)} 尺寸 ${stats.width}×${stats.height}，` +
        `期望 ${expected.width}×${expected.height}（分组「${group.label}」的设备预设）`,
    );
  }
  if (stats.hasTransparency) {
    throw new Error(`${relative(repoRoot, source)} 含真实透明像素，不能当文章配图`);
  }
  if (looksBlank(stats)) {
    throw new Error(
      `${relative(repoRoot, source)} 是空白图（contentRatio ${stats.contentRatio.toFixed(4)} / ` +
        `colorSpan ${stats.colorSpan}），不能当文章配图`,
    );
  }
  if (looksSmeared(stats)) {
    throw new Error(
      `${relative(repoRoot, source)} 疑似横向涂抹（edgeOnContent ${stats.edgeOnContent.toFixed(3)}），` +
        '文字渲染是坏的，不能当文章配图',
    );
  }

  return {
    articleId,
    figure,
    source,
    dest: join(repoRoot, helpFigureDir(articleId), helpFigureFile(figure)),
    stats,
  };
}

/** 递归列出 `public/assets/help/` 下全部 PNG（用于抓孤儿文件）。 */
function listAssets(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listAssets(path, out);
    else if (entry.name.endsWith('.png')) out.push(path);
  }
  return out;
}

// ── 1. 先把每一条都解析完（一条不过 ⇒ 一个字节都不写）─────────────────────
const problems = [];
const items = [];

for (const [articleId, figures] of Object.entries(HELP_FIGURES)) {
  if (!ARTICLE_IDS.has(articleId)) {
    problems.push(
      `"${articleId}" 不是注册表里的文章（pages.ts 里要有这条 id 且标 docsKind: 'article'）`,
    );
    continue;
  }
  for (const figure of figures) {
    try {
      items.push(resolveFigure(articleId, figure));
    } catch (error) {
      problems.push(`${articleId} / ${figure.sectionId}：${error.message}`);
    }
  }
}

if (items.length === 0 && problems.length === 0) {
  problems.push('HELP_FIGURES 里一张图都没有 —— 判据不该静默通过，请确认这是有意的');
}

if (problems.length > 0) {
  console.error('❌ 配图映射有问题，未写入任何文件：');
  for (const line of problems) console.error(`   · ${line}`);
  process.exit(1);
}

// ── 2. 孤儿：产物目录里有、映射里没有的，一律算没清干净 ────────────────────
const expectedDests = new Set(items.map((item) => item.dest));
const orphans = listAssets(join(repoRoot, HELP_FIGURE_ROOT)).filter(
  (path) => !expectedDests.has(path),
);

if (checkOnly) {
  let stale = 0;
  for (const item of items) {
    if (!existsSync(item.dest)) {
      console.error(`❌ 缺少复制品 ${relative(repoRoot, item.dest)} —— 跑 gen-help-figures.mjs`);
      stale += 1;
      continue;
    }
    const destStats = inspectPng(item.dest);
    if (destStats.hash !== item.stats.hash) {
      console.error(
        `❌ 内容漂移 ${relative(repoRoot, item.dest)}\n` +
          `     源图 sha256 ${item.stats.hash.slice(0, 16)}…\n` +
          `     产物 sha256 ${destStats.hash.slice(0, 16)}…\n` +
          '     源图重新截过而没重跑生成器（或反过来）。',
      );
      stale += 1;
    }
  }
  for (const path of orphans) {
    console.error(`❌ 孤儿复制品 ${relative(repoRoot, path)} —— 映射里没有它，删掉再跑生成器`);
    stale += 1;
  }
  if (stale > 0) {
    console.error(`\n${stale} 处与映射不一致。`);
    process.exit(1);
  }
  console.log(`✅ 配图产物与映射一致：${items.length} 张（sha256 逐张对过）`);
  for (const item of items) {
    console.log(
      `   ${relative(repoRoot, item.dest)}  ←  ${relative(repoRoot, item.source)}` +
        `  ${item.stats.width}×${item.stats.height}`,
    );
  }
  process.exit(0);
}

// ── 3. 写 ────────────────────────────────────────────────────────────────
for (const path of orphans) {
  rmSync(path);
  console.log(`🗑  删掉孤儿复制品 ${relative(repoRoot, path)}`);
}
let written = 0;
for (const item of items) {
  const same =
    existsSync(item.dest) &&
    statSync(item.dest).size === item.stats.bytes &&
    inspectPng(item.dest).hash === item.stats.hash;
  if (same) continue;
  mkdirSync(dirname(item.dest), { recursive: true });
  copyFileSync(item.source, item.dest);
  written += 1;
  console.log(
    `📋 ${relative(repoRoot, item.source)}\n   → ${relative(repoRoot, item.dest)}` +
      `（${item.articleId} 的「${item.figure.sectionId}」一节）`,
  );
}
console.log(
  `\n✅ 配图产物就绪：${items.length} 张，本次写入 ${written} 张` +
    (orphans.length > 0 ? `，清掉孤儿 ${orphans.length} 张` : ''),
);
