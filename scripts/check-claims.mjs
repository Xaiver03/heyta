#!/usr/bin/env node
/**
 * 「平台页讲到的平台，路线图里必须存在」
 * =======================================
 *
 * 🔴 **2026-09-29 范围收缩（产品决策，留痕）**：本门禁原先有两部分 ——
 *
 *   1. ~~「验证方式」（`site.*.evidence`）的值必须是真实存在的命令 / 路径~~；
 *   2. `/platforms` 讲到的每个平台，`docs/plans/roadmap.md` 里必须提到。
 *
 * 第 1 部分随「验证方式」**从公页退役**而一并退役。缘由：landing page 的受众是
 * 用户，不是贡献者 —— `pnpm --filter @heyta/domain test`、`docs/adr/….md`
 * 这类行出现在公页上是在对用户说内部黑话（产品负责人 2026-09-29 的原话：
 * "很多开发的东西不需要放上去，放 GitHub 就好了"）。词条表里的 25 条
 * `*.evidence` 已删除，渲染层（`PageSections.tsx` 的 `.lp-evidence`）同日移除。
 *
 * ⚠️ "声称可核对"的**意图**没有死，只是换了管法：
 *   - 内容纪律（只写已实现的能力）仍由 `apps/landing/src/site/content.ts`
 *     的文件头与代码评审管；
 *   - 平台状态的口径仍靠人工对照 roadmap（见下方 C 部分的注释）；
 *   - `check:ui-language` 里 `*.evidence` 的后缀豁免成为无害残留 ——
 *     没有键再匹配它，留着不为它单独改一次测试。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **C2 只核对"roadmap 里提到过这个平台"，不核对状态口径。**
 *
 * roadmap 是散文（进度表里是 ✅/🔄/🔴 加上一大段解释），没有机器可读的
 * 状态字段；硬造一个就有两份状态、两份状态必然漂移 —— 而漂移的那一份
 * 恰恰是访客读到的那一份。
 *
 * 所以状态口径仍然靠**人工**，判据是：
 * > 改动 `/platforms` 上任何一个平台的状态时，必须同时改 roadmap 里那一行。
 *
 * ⚠️ 为什么"读不到平台清单"要报错而不是通过：跟原来一样，一条在某次重构后
 * 永远绿的空规则，比没有门禁更坏 —— 它让人以为有人管着。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.HEYTA_CHECK_ROOT ?? process.cwd();
const problems = [];

const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

/* ── C2：平台页讲到的每个平台，roadmap 里必须提到 ──────────────── */

/**
 * 平台 id → roadmap 里可能出现的写法。
 *
 * ⚠️ `移动端` 同时覆盖 android 与 ios —— roadmap 把两端合在一起讲。
 * 这让 C2 对这两端**偏弱**（提到"移动端"就算过）。如实写在这里，
 * 而不是假装它对每一端都同样严格。
 */
const PLATFORM_ALIASES = {
  web: ['Web'],
  android: ['Android', '安卓', '移动端'],
  ios: ['iOS', '移动端'],
  desktop: ['桌面'],
  harmony: ['鸿蒙', 'HarmonyOS'],
  selfhost: ['自建'],
};

/** 平台页有哪些平台 —— 从**页面的结构定义**读，不是从文案读。 */
function readPlatformIds() {
  const source = read('apps/landing/src/site/content.ts');
  const start = source.indexOf('PLATFORM_SECTIONS');
  if (start === -1) return [];
  const end = source.indexOf('];', start);
  const body = source.slice(start, end === -1 ? source.length : end);
  return [...body.matchAll(/^\s*id:\s*'([a-z0-9\-]+)'/gm)].map((m) => m[1]);
}

const platformIds = readPlatformIds();
if (platformIds.length === 0) {
  problems.push(
    '读不到 `/platforms` 的平台清单 —— 页面结构可能改了，' +
      '这道门禁正在变成一条空规则。见 scripts/check-claims.mjs 的 readPlatformIds()。',
  );
}

const roadmapPath = 'docs/plans/roadmap.md';
if (!existsSync(join(ROOT, roadmapPath))) {
  problems.push(`${roadmapPath} 不存在 —— 平台对照没有可核对的另一侧`);
}
const roadmap = existsSync(join(ROOT, roadmapPath)) ? read(roadmapPath) : '';
for (const id of platformIds) {
  const aliases = PLATFORM_ALIASES[id];
  if (aliases === undefined) {
    problems.push(
      `平台 "${id}" 没有登记 roadmap 里的写法。` +
        '新增平台时要同时在这里登记别名（并确认 roadmap 真的会讲到它）。',
    );
    continue;
  }
  if (!aliases.some((alias) => roadmap.includes(alias))) {
    problems.push(
      `/platforms 讲了 "${id}"，但 docs/plans/roadmap.md 里一次都没提到` +
        `（试过：${aliases.join(' / ')}）—— 站点讲了一个路线图上不存在的平台`,
    );
  }
}

/* ── 报告 ─────────────────────────────────────────────────── */

if (problems.length > 0) {
  process.stderr.write(
    [
      '',
      '🔴 平台页与路线图对不上：',
      ...problems.map((p) => `   · ${p}`),
      '',
      '改 `/platforms` 上任何一个平台的状态时，必须同时改 roadmap 里那一行。',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

process.stdout.write(
  `✅ 平台状态可核对：${platformIds.length} 个平台都能在 roadmap 里找到对应条目。\n`,
);
