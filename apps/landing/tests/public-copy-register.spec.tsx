/**
 * 公页语域门禁 —— 落地页与站点子页不许说贡献者语言
 * =================================================
 *
 * ## 起因（2026-09-30，产品负责人实测点名）
 *
 * 首页「自建」那一节里印着这么一段：
 *
 * > **数据库迁移不要直接调 Prisma。** 项目里有 9 个并发建索引的迁移，Prisma 会把
 * > 迁移包进事务，而 PostgreSQL 不允许在事务里建并发索引，跑到第一个这样的迁移就会
 * > 失败。请用仓库里的迁移脚本 `scripts/migrate-deploy.sh`。
 *
 * 这句话不是写错了 —— 它是 [AGENTS.md](../../../AGENTS.md) §4 与
 * `docs/runbooks/deployment.md` 里那条**对贡献者成立的纪律**，被逐字搬到了
 * 面向用户的营销页上。而 `SelfHost.tsx` 的文件头还为它论证过一轮：
 * "把这条'为什么'留在页面上，比只给一行命令有用"。
 *
 * 🔴 **这就是"为什么总是回到 landing page 上"的机制**：runbook 里有一段写得很好的
 * 解释 → 有人觉得"这条重要，用户也该知道" → 逐字抄过去 → 再写一段注释自我论证 →
 * 下一轮改动读到那段注释，以为它是产品决策，于是保留并继续加。
 * 所以本门禁拦的不只是词，而是**"内部纪律有资格上公页"这个推理本身**。
 *
 * ## 判定线（2026-09-30 产品负责人拍板：拦内部工具链）
 *
 * 一句话判据：**用户能不能据此行动？**
 *
 * - ✅ **允许**：他照着做就用得上的**外部**名词与产品名 ——
 *   `Docker Compose`、`GitHub`、`MIT`、"服务端地址"、"数据库口令"、"一条命令"。
 *   这些是"这东西能自建"这个卖点的**内容**，删掉它卖点就讲虚了。
 * - 🔴 **禁止**：只有仓库贡献者用得上的东西 ——
 *   构建与包管理工具及其子命令（`pnpm -r build`、`npm`）、工具链版本钉
 *   （`Node 22`、`pnpm 11.8.0`）、`git clone` 这类可粘贴的命令行、
 *   数据库与迁移机制（`Prisma`、`PostgreSQL`、并发索引、事务）、
 *   仓库内路径与文件名（`scripts/…`、`*.md`、`THIRD_PARTY_LICENSES.md`）、
 *   内部工程黑话（`op-log`、`物化`、`门禁`、`冒烟`）。
 *
 * ⚠️ 刻意**不**拦的三个词，以及为什么（把它们加进词表会立刻造出误报，
 * 而**一条会误报的门禁会教人忽略红色** —— 见 `check-ui-language.mjs` 里同一条纪律）：
 *
 * - 裸 `索引`：页脚有「文档索引」，那是 docs index，不是 database index。
 *   只拦 `建索引` / `并发索引` / `索引迁移`。
 * - 裸 `事务`：中文里它是"affairs"，任务管理页面上写「日常事务」完全正当。
 *   只拦 `在事务` / `事务里` / `事务块` / `包进事务` 这几个数据库语境的搭配。
 * - 裸 `版本`：`landing.sync.ledeLead` 用"版本信息"讲向量时钟，
 *   那正是**该上公页**的写法（用户能懂）。只拦"工具名 + 版本号"这个形状。
 *
 * ## 🔴 唯一豁免：自托管那篇文章页（2026-10-01 产品负责人裁定）
 *
 * 「文档中心绝对不能放开发相关的东西；**唯一例外是自托管那块** ——
 * 自托管说明反而要写给动手的人看（可以详细到开发者级）。」
 *
 * 这道闸 2026-09-30 立、那条裁定 2026-10-01 下，而裁定只写进了**词条表**那道闸
 * （`scripts/check-docs-voice.mjs`）。结果同一天里：自托管篇按裁定扩到 11 节开发者级
 * 内容，本闸把 `selfhost / zh-CN` 与 `selfhost / en` 判红，两道"内容合规"门禁
 * 互相指认对方有误，而 `pnpm check` 带着整条链一起红。
 *
 *  ⇒ 豁免判据现在住在一个中立模块里（`scripts/selfhost-voice.mjs`），**两套观测面共用一份**：
 * 那边按词条 key 判、这里按渲染出的页面判，形状不同、规则同一份。理由是本仓库
 * 已经吃过的那个形状：同一个判断写两遍 → 改一处、另一处过期 → 而过期那处**看起来仍在执法**。
 *
 * ⚠️ 豁免只放开"没有内部工具链语言"这一条；**观测面那条（每页 × 每语言 ≥500 字符）
 * 对豁免页照样生效**，否则摘掉一条判据会顺带把"这页是不是空的"也摘掉。
 *
 * ## 为什么判据钉在**渲染出的文本**上，而不是源码或类名
 *
 * 这条纪律 2026-09-29 就立过一次（见 `scripts/check-claims.mjs` 文件头：
 * 「`*.evidence` 从公页退役，因为 landing page 的受众是用户不是贡献者」），
 * 而 `render.spec.tsx` 当时补的负断言数的是 `.lp-evidence` **这个 CSS 类**。
 * 结果：类名换了（自建区用的是 `.lp-note--warn` 与 `.lp-term__line`），
 * **同一条规则一个字都没拦住**，还连着四轮全绿。
 *
 * 只扫源码也不行：真正漏出去的那三行命令住在组件里的 `COMMANDS` 数组
 * （`<code>{command}</code>`），`check:ui-language` 的 JSX 提取器**看不见**它 ——
 * 那是表达式，不是字面量属性。
 *
 * ⇒ 唯一可靠的观测点是**用户真的读到的那串字**：每一页 × 每一种语言渲染出来的
 * `textContent`，外加读屏软件会念出的 `aria-label` / `alt` / `title`。
 *
 * ## 自检（三条，缺一不可）
 *
 * - **A 观测面**：注册表非空、每一页 × 每一语言都真的渲染出 ≥500 字符 ——
 *   否则本门禁是在对一片空白打分（"扫不到就通过"是禁止的）。
 * - **B 反证**：把 2026-09-30 真实漏出去的那几段原文喂给探测器，必须**每一条都报红**。
 *   这条断言与上面的判据走**同一个函数**，所以它证明的是探测器本身会失败。
 * - **C 正对照**：把判定线上**允许**的说法喂进去，必须一条都不报红。
 *   没有这一条，"能失败"是廉价的 —— 一台只会红的机器同样没有价值，
 *   而且它挡住的正是「Docker Compose / GitHub / MIT」这些卖点本身。
 *
 * 用法：`pnpm --filter @heyta/landing test`（已随 `pnpm -r test` 进 `pnpm check`）
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOCALES, type Locale } from '@heyta/i18n/provider';
import { CATALOGS } from '@heyta/i18n';

import { SELF_HOST_GUIDE_URL } from '../src/lib/repo.js';
import { SITE_PAGES } from '../src/site/pages.js';
import { renderPage } from './helpers/render-page.js';
// 🔴 豁免判据与 `scripts/check-docs-voice.mjs` **共用一份**（分裂的成因与代价写在那个文件头）。
import { SELFHOST_EXEMPT_PAGE_IDS } from '../../../scripts/selfhost-voice.mjs';

/* ══════════════════════════════════════════════════════════════════════
 * 词表与形状（唯一的判据来源；下面的自检与真实扫描共用它）
 * ════════════════════════════════════════════════════════════════════ */

interface Rule {
  /** 报告里出现的规则名。 */
  readonly name: string;
  /** 为什么这条属于贡献者语言 —— 报错时要能直接说清。 */
  readonly why: string;
  readonly test: (text: string) => RegExpExecArray | null;
}

/** 拉丁词：大小写敏感（`Node` 是工具名，`node` 不是我们要拦的那种写法）。 */
const LATIN_TERMS = [
  'Prisma',
  'prisma',
  'PostgreSQL',
  'postgres',
  'MySQL',
  'SQLite',
  'IndexedDB',
  'pnpm',
  'npx',
  'npm',
  'node_modules',
  'Node.js',
  'Vitest',
  'vitest',
  'ts-node',
  'tsc',
  'CONCURRENTLY',
  'op-log',
  'CRDT',
  'hydration',
  'vendored',
  'THIRD_PARTY_LICENSES',
  'AGENTS.md',
  'CONTRIBUTING.md',
];

/** 中文机制词（内部工程黑话；用户既看不懂也无法据此行动）。 */
const CN_TERMS = [
  '并发索引',
  '建索引',
  '索引迁移',
  '在事务',
  '事务里',
  '事务块',
  '包进事务',
  '迁移脚本',
  '数据库迁移',
  '向量时钟',
  '物化',
  '门禁',
  '冒烟',
  '回归测试',
  '单测',
  '零 mock',
  '全量构建',
  '装完依赖',
  '拉代码',
];

/**
 * 英文机制词。
 *
 * 🔴 单独一组而不是塞进 `LATIN_TERMS`：那一组走的是"词首无边界"的精确匹配，
 * 而这里需要**短语**（`build indexes` 是两个词）。
 * ⚠️ 刻意不含裸 `migration` / `index` —— 英文页面上「migrate your data from
 * TickTick」与「docs index」都是正当的用户文案，跟中文那边不拦裸 `事务`
 * 与裸 `索引` 是同一条理由。
 */
const EN_PHRASES = [
  'build(?:ing)? indexes?',
  'index creation',
  'concurrent(?:ly)? build',
  'concurrent(?:ly)? index',
  'in(?:side)? a transaction',
  'transaction block',
  'migration script',
  'database migration',
  'run(?:s|ning)? migrations?',
  'wraps? migrations?',
  'migrations? (?:that|directly|fail)',
  'vector clock',
  'event sourcing',
  'smoke test',
  'unit test',
  'regression test',
  // 中文侧早就拦了「门禁」，英文侧以前漏了它的对应说法 —— 真实失误：更新日志里
  // "the reachability gate went from red to fully green" 大摇大摆过了两轮。
  // 只加这一个说法而不是裸 `gate`：`payment gateway`、`Gateway` 都是正当用户文案。
  'reachability gate',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const latinRule = (): Rule => ({
  name: '内部工具链名词',
  why: '只有仓库贡献者用得上；用户复制了也不知道在干什么',
  test: (text) => new RegExp(`(?<![\\w-])(${LATIN_TERMS.map(escapeRe).join('|')})`).exec(text),
});

const cnRule = (): Rule => ({
  name: '内部工程黑话',
  why: '这是写给贡献者的纪律，不是给用户看的卖点',
  test: (text) => new RegExp(`(${CN_TERMS.join('|')})`).exec(text),
});

const enRule = (): Rule => ({
  name: '内部机制说法（英文）',
  why: '英文版同样不许讲数据库与迁移机制 —— 两种语言是同一个判定线',
  // ⚠️ 大小写不敏感：句中的 "build indexes" 与句首的 "Build indexes" 都得抓到。
  test: (text) => new RegExp(`(${EN_PHRASES.join('|')})`, 'i').exec(text),
});

/**
 * 形状判据 —— 拦的是**形态**，所以新工具名不需要来加词表。
 *
 * ⚠️ 每条都带一条"为什么不会误伤"的说明：这一组最容易造出假红。
 */
const SHAPES: readonly { name: string; why: string; re: RegExp }[] = [
  {
    name: 'shell 连接符',
    // 正常文案里不会出现 `&&`；它一出现就说明这是一行可粘贴执行的命令。
    why: '公页上出现 `&&` 就是在贴命令行',
    re: /&&/,
  },
  {
    name: '终端提示符',
    // `$ git clone …`。要求 `$` 后面**有空格**再接字母 ——
    // 价格是 `$5` / `$12`，没有空格，所以不会被误伤。
    why: '带提示符的终端行是给用户照抄的，不是给用户读的',
    re: /\$\s+[A-Za-z]/,
  },
  {
    name: '可粘贴的 git/docker 命令',
    // 注意区分：`一条 docker compose` 是**产品事实**（允许），
    // `docker compose up -d` 是**命令行**（禁止）。
    why: '命令本身该在仓库的自建指南里，公页给入口就够',
    re: /\b(git (clone|push|init|pull)|docker[ -]compose (up|down|build)|\bcd\s+\S+\s+&&)/,
  },
  {
    name: '仓库内路径',
    // 只认"目录名 + 斜杠"，且要求前面是行首/空白/引号类字符 ——
    // 免得英文句子里的 `apps` 之类被误抓。
    why: '仓库目录结构对用户没有意义',
    re: /(?:^|[\s(（「"'`])(?:scripts|docs|packages|apps|server|e2e|research|design-system)\//,
  },
  {
    name: '源码文件名',
    // `*.sh` / `*.md` / `*.mjs` / `schema.prisma` …… 是仓库里的文件，不是界面元素。
    why: '文件名是仓库内部坐标，用户打不开它',
    re: /[\w./-]+\.(?:sh|mjs|cjs|prisma|tsx?|jsx?|ya?ml|toml|json|lock|md)\b/,
  },
  {
    name: '工具链版本钉',
    // `Node 22` / `pnpm 11.8.0` / `postgres:16` / `docker 27`。
    // ⚠️ 刻意**不含** iOS / Android —— 那是用户设备的系统要求，属于用户能据此
    //    行动的事实（「需要 iOS 15 以上」写在平台页上是正当的）。
    why: '构建环境的版本要求是贡献者信息；用户不需要为了用产品去装某个版本',
    re: /\b(?:node|pnpm|npm|npx|postgres(?:ql)?|docker|compose)\s*[:v≥>=]*\s*\d+(?:\.\d+)*/i,
  },
];

interface Violation {
  readonly rule: string;
  readonly why: string;
  readonly hit: string;
  readonly context: string;
}

const shapeRule = (shape: { name: string; why: string; re: RegExp }): Rule => ({
  name: shape.name,
  why: shape.why,
  test: (text) => shape.re.exec(text),
});

/**
 * 探测器 —— **纯函数**。自检（B/C 两组）与真实扫描共用它，
 * 所以"自检过了"不可能是在为另一套逻辑背书。
 */
export function findViolations(text: string): Violation[] {
  const rules: readonly Rule[] = [latinRule(), cnRule(), enRule(), ...SHAPES.map(shapeRule)];
  const out: Violation[] = [];
  for (const rule of rules) {
    const m = rule.test(text);
    if (m === null) continue;
    const at = m.index + (m[0].startsWith(' ') ? 1 : 0);
    out.push({
      rule: rule.name,
      why: rule.why,
      hit: m[1] ?? m[0],
      context: text.slice(Math.max(0, at - 24), at + m[0].length + 40).replace(/\s+/g, ' '),
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
 * 观测面：用户真的读到的那串字
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 收集一页里**会被用户读到或听到**的全部文本。
 *
 * - `textContent`：可见正文（含 `<code>` 里的命令 —— 那正是上次漏出去的地方）。
 * - `aria-label` / `alt` / `title`：读屏软件会念出来、鼠标悬停会显示，
 *   同样是对用户说话。`check:ui-language` 只管这些**有没有走词条**，
 *   不管词条**说的是哪种语言域**，所以这里必须补上。
 */
function collectRenderedText(view: HTMLElement): string {
  const parts: string[] = [view.textContent ?? ''];
  for (const el of view.querySelectorAll<HTMLElement>('[aria-label], [alt], [title]')) {
    for (const attr of ['aria-label', 'alt', 'title'] as const) {
      const value = el.getAttribute(attr);
      if (value !== null) parts.push(value);
    }
  }
  return parts.join('\n');
}

const PAGE_IDS = SITE_PAGES.map((page) => page.id);
const LOCALE_IDS = [...LOCALES] as readonly Locale[];

/* ══════════════════════════════════════════════════════════════════════
 * 判据
 * ════════════════════════════════════════════════════════════════════ */

describe('🔴 公页不许说贡献者语言', () => {
  /**
   * 断言 A：观测面必须真的存在。
   *
   * 一条"每一页都扫了、但每页都只扫到 3 个字符"的门禁，与没有门禁等价。
   * 而观测面塌掉的原因通常不是本文件 —— 是 `helpers/render-page.tsx` 的脚手架
   * 坏了、或注册表被清空了。所以这里**响亮地失败**，而不是继续报"✅ 全部合规"。
   */
  it.each(PAGE_IDS.flatMap((pageId) => LOCALE_IDS.map((locale) => [pageId, locale] as const)))(
    '%s / %s：确实渲染出可读文本（否则本门禁是在对空白打分）',
    (pageId, locale) => {
      const text = collectRenderedText(renderPage(pageId, locale));
      expect(
        text.length,
        `${pageId} / ${locale} 只渲染出 ${String(text.length)} 个字符 —— 观测面塌了`,
      ).toBeGreaterThan(500);
    },
  );

  /**
   * 真实判据：每一页 × 每一语言。
   *
   * 🔴 **唯一豁免 = 自托管那篇文章页**（`SELFHOST_EXEMPT_PAGE_IDS`），依据是产品负责人
   * 2026-10-01 的裁定：「文档中心绝对不能放开发相关的东西；唯一例外是自托管那块 ——
   * 自托管说明就是写给动手的人看的，可以详细到开发者级。」
   *
   * 这条豁免以前**只写在词条表那道闸里**（`scripts/check-docs-voice.mjs`），本闸不知道，
   * 于是同一天里出现"一篇被裁定为合规的内容被另一道合规门禁判红"，而两道的理由互相
   * 指认对方有误。现在判据从 `scripts/selfhost-voice.mjs` 取，两份观测面共用一条规则。
   *
   * ⚠️ 豁免**只放开这一条断言**（B）。上面那条 A（每一页 × 每一语言必须渲染出 ≥500 字符）
   * 对豁免页同样生效 —— 否则"把整页从判据里摘出去"就会顺带把"这页是不是空的"
   * 也摘出去，而空页面恰恰是这一轮法务页面最贵的那种事故。
   */
  it.each(
    PAGE_IDS.flatMap((pageId) =>
      SELFHOST_EXEMPT_PAGE_IDS.includes(pageId)
        ? []
        : LOCALES.map((locale) => [pageId, locale] as const),
    ),
  )('%s / %s：正文与无障碍名里没有内部工具链语言', (pageId, locale) => {
    const view = renderPage(pageId, locale);
    const violations = findViolations(collectRenderedText(view));
    expect(
      violations,
      `${pageId} / ${locale} 上贡献者语言泄漏：\n` +
        violations
          .map((v) => `  · [${v.rule}]「${v.hit}」—— ${v.why}\n    上下文：…${v.context}…`)
          .join('\n') +
        '\n\n  ⇒ 改法：换成用户能据此行动的说法；开发细节留在 docs/runbooks 与仓库 README。',
    ).toEqual([]);
  });

  /**
   * 豁免区自身的防呆 —— 没有这一条，"豁免"就是一种可以悄悄变质的东西。
   *
   * 拦的三件事：
   *   1. **豁免了一个不存在的页面 id**（改名时会发生：`/help` → `/docs` 那一轮
   *      就把一条断言留在了旧地址上）。后果是豁免圈不住任何内容，而它看起来仍在生效。
   *   2. **豁免范围扩大**。这一条不是"越少越好"的洁癖：判定线是产品负责人拍的，
   *      只有自托管那一篇在例外里。多加一个 id 就是有人在没有裁定的情况下放开了一个面。
   *   3. **豁免页变成空页**（由上面的断言 A 兜住，这里再钉一次它是**注册表里的文章页**）。
   */
  it('豁免区恰好是自托管那篇文章页，而且它在注册表里真实存在', () => {
    expect(SELFHOST_EXEMPT_PAGE_IDS).toEqual(['selfhost']);
    for (const pageId of SELFHOST_EXEMPT_PAGE_IDS) {
      const page = SITE_PAGES.find((candidate) => candidate.id === pageId);
      expect(page, `豁免区里的 "${pageId}" 在站点注册表里不存在 —— 这条豁免圈不住任何东西`).toBeDefined();
    }
  });
});

describe('自检 B（反证）：探测器对真实漏出去过的原文必须报红', () => {
  /**
   * 🔴 这些不是编的对抗样本，是 **2026-09-30 真实印在首页上**的句子与当时
   * 一起漏出去的形态。把它们钉在这里，是因为"门禁能失败"这件事不能只写在注释里
   * —— 注释会过期，探测器的判据会被下一次"顺手放宽一点"改掉，
   * 而**一条永远通过的判据比没有判据更糟**。
   */
  const MUST_CATCH: readonly string[] = [
    // 自建区那条警告（zh / en 两版，形状各不同，都要抓到）
    '数据库迁移不要直接调 Prisma。',
    '项目里有 9 个并发建索引的迁移，Prisma 会把迁移包进事务，而 PostgreSQL 不允许在事务里建并发索引',
    '迁移脚本 scripts/migrate-deploy.sh。',
    'Do not run Prisma migrations directly.',
    'The project has 9 migrations that build indexes concurrently.',
    'heyta is MIT licensed; third-party attribution is itemised in THIRD_PARTY_LICENSES.md.',
    // 自建区三步说明与终端块
    '需要 Node 22 以上、pnpm 11.8.0。装完依赖跑一次全量构建。',
    'Needs Node 22+ and pnpm 11.8.0.',
    'git clone https://github.com/Xaiver03/heyta.git',
    'cd heyta && pnpm install && pnpm -r build',
    'cd server && docker compose up -d',
    // 中文侧的「门禁」在词表里，英文侧的对应说法以前抓不到 —— 钉一条真实的更新日志句子
    'The same batch turned the reachability gate from长期红 to fully green.',
    // 这一类以后最可能以"新工具名"的形式回来 —— 靠形状而不是词表抓住它
    '跑一下 bun install 再 tsc --noEmit',
    '详见 packages/sync-core/src/index.ts',
  ];

  it.each(MUST_CATCH)('抓到：%s', (sample) => {
    expect(findViolations(sample).length, `探测器对这条完全无感：${sample}`).toBeGreaterThan(0);
  });
});

describe('自检 C（正对照）：判定线上允许的说法一条都不许报红', () => {
  /**
   * 🔴 这一组与上面那组**同样重要**。没有它，"能失败"是廉价的：
   * 把裸 `索引`、裸 `事务`、`docker compose`、`GitHub` 全塞进词表，
   * 探测器立刻变得"很严"，而它挡住的正是「自建永久免费、一条命令起全套」
   * 这个卖点本身 —— 那种门禁的下场是被人关掉，不是被人遵守。
   */
  const MUST_NOT_CATCH: readonly string[] = [
    '自己的服务器，一条命令的事',
    '一条 docker compose 把全套服务跑在你自己的机器上。密钥与数据库口令要自己配',
    '用 Docker Compose 一条命令起全套服务。',
    '代码在 GitHub 上，MIT 许可。',
    'heyta is MIT licensed; third-party attribution is itemised.',
    '文档索引',
    '第三方许可证',
    '在 GitHub 看源码',
    '每次改动都是一条独立记录，带着“我见过哪些改动”的版本信息。',
    '两个版本并排摆出来，选择权在你手里',
    '帮你管理日常事务',
    '首屏快：¥5 / 月、$5 / month',
    '需要 iOS 15 以上',
    'The sync server runs entirely on your own machine.',
  ];

  it.each(MUST_NOT_CATCH)('不误伤：%s', (sample) => {
    expect(findViolations(sample), `这条被误判成贡献者语言：${sample}`).toEqual([]);
  });
});

/**
 * ## 公页指向的**仓库文档**（2026-10-03，缺口 G-40③）
 *
 * 上面那批规则管的是"公页上印的字"。这一批管的是**公页把人带去的那个文件**。
 *
 * 起因是实测：落地页把"要逐条执行的命令、依赖与配置文件都写在自建指南里，
 * 跟着跑一遍就能起来"这句话挂在 `SELF_HOST_GUIDE_URL` 上，而它以前指向
 * `docs/runbooks/local-server-verification.md` —— 那是给 **P0 验收**写的手册，
 * 它的第一节是一张本团队内部机器表（SSH 别名、公网 IP、哪台同时是我们的部署机）。
 * 于是那条链接**两头都不对**：对外承诺的路径上没有面向陌生人的部署路径，
 * 而内部运维现场被公开页面直链带了出去。
 *
 * 四条判据（注入表原本记在 `docs/research/self-host-distribution-audit.md` §8.9；
 * 2026-10-03 第 1、2 条各被现实改了一次形状，改动理由写在 §8.13）：
 *  1. `apps/landing/src` 里每个 `blob/main/<路径>` 必须在**已推送的默认分支**上存在 ——
 *     🔴 原来只 `existsSync` 本地工作树，于是"文件只活在没合入的分支上"判绿、线上 404；
 *  2. 自建指南那一头不许含内部主机名 / 公网 IP。目标现在是**站内那篇文章**，
 *     所以扫的是它的正文（从词条表按前缀取，中英两版），并且抽取层自己带哨兵与阳性对照；
 *  3. 同一条 needle 扫描在一份**确实**含内部机器的文档上必须命中 ——
 *     没有这条对照，第 2 条的"零命中"可能只是 needle 表或扫描坏了；
 *  4. 页面上**渲染出来的那个 href** 必须就是常量 —— 前三条都只读常量，
 *     而缺陷的形状恰恰是"常量改了、某个组件自己抄了一份旧路径"（`Footer.tsx` 以前就自己抄过）。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/** 内部运维现场的标记。每一条都在 `deployment.md` / `local-server-verification.md` 里真实出现过。 */
const INTERNAL_OPS_NEEDLES = ['ubuntu-jcli', 'sanjiaozhou', 'finlaw', '124.223.13.226'];

const listTsFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(child));
    else if (/\.tsx?$/.test(entry.name)) out.push(child);
  }
  return out;
};

/**
 * 只认**代码行**里的 `blob/main/<路径>`。
 *
 * 🔴 为什么必须剥整行注释：2026-10-03 把自建指南的链接改成站内路径之后，
 * `lib/repo.ts` 的注释里留着"它以前指 `…/blob/main/docs/runbooks/self-host.md`"这段历史，
 * 扫描器把它当成一条真链接 ⇒ 判据红在一段解释自己为什么改的散文上。
 * 注释不是链接。⚠️ 边界：只剥**整行**注释（`//`、`/*`、`*` 开头），
 * 因为代码行里 `https://` 含有 `//`，按行内位置剥会把真链接削掉。
 * ⚠️ 这里刻意不用"一个正则搞定"：`^\s*(?!…)[^*]` 那种写法会因为 `\s*` 回溯而
 * 把 ` * 注释` 判成代码行（实测就是这样让第一条判据红在一段散文上的）。
 */
const isCodeLine = (line: string): boolean => {
  const t = line.trimStart();
  return !(
    t.startsWith('//') || t.startsWith('/*') || t.startsWith('*/') || t.startsWith('*')
  );
};

const blobPathsReferencedByLandingSrc = (): string[] => {
  const found: string[] = [];
  for (const file of listTsFiles(join(REPO_ROOT, 'apps/landing/src'))) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (!isCodeLine(line)) continue;
      for (const m of line.matchAll(/blob\/main\/([A-Za-z0-9._/-]+)/g)) {
        const path = m[1];
        if (path !== undefined) found.push(path);
      }
    }
  }
  return found;
};

/**
 * 该路径在**已推送的默认分支**（本地记录的 `origin/main`）上是否存在。
 *
 * ⚠️ 它读的是本地的 remote-tracking ref，所以"刚推上去"要 `git fetch` 之后才反映得出来。
 * 这不是缺陷而是边界：这条判据防的是"文件只活在我这棵树上"，而那正好是出事当时的形状。
 * ref 取不到时**响亮地失败**，不静默放行（静默放行 = 这条判据变成装饰）。
 */
const pushedDefaultBranchHas = (path: string): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    throw new Error('本地没有 origin/main 这个 ref —— 这条判据没法判断，不静默放行（先 git fetch）');
  }
  try {
    execFileSync('git', ['cat-file', '-e', `origin/main:${path}`], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * 站内那篇自建指南的 href 必须**就是**页面注册表里那条 path 加尾斜杠。
 * 不抄第二份路径：以前页脚自己抄过一遍，于是"指南搬家"要改两处而漏一处。
 */
const guideHrefFromRegistry = (): string => {
  const page = SITE_PAGES.find((p) => p.id === 'selfhost');
  expect(page, '页面注册表里没有 id="selfhost" —— 这条链接无人可核对').toBeDefined();
  expect(
    SELF_HOST_GUIDE_URL,
    `SELF_HOST_GUIDE_URL 不再是注册表里那条 path 加尾斜杠（现在=${SELF_HOST_GUIDE_URL}，` +
      `注册表=${String(page?.path)}/）⇒ 要么指南又搬家了，要么这里抄了第二份`,
  ).toBe(`${String(page?.path)}/`);
  return SELF_HOST_GUIDE_URL;
};

/**
 * 站内那篇文章的**正文**（中英两版），从词条表按前缀取。
 * 🔴 不拿正则去啃 TS 源文件：那会变成第二套转义规则（`server-copy` 生成器踩过）。
 *    取到多少条、里面必须有什么，都由下面两条判据各自带对照。
 */
const selfHostArticleValues = (): string[] => {
  const out: string[] = [];
  for (const catalog of [CATALOGS['zh-CN'], CATALOGS.en]) {
    for (const [key, value] of Object.entries(catalog)) {
      if (key.startsWith('site.docs.selfhost.')) out.push(value);
    }
  }
  return out;
};

describe('公页指向的仓库文档', () => {
  it('每个 blob/main/<路径> 都在**已推送的默认分支**上存在（工作树里有不算）', () => {
    const paths = blobPathsReferencedByLandingSrc();
    // 解析层哨兵：一条都没扫到**不算通过** —— 那说明遍历或正则坏了。
    expect(paths.length, 'apps/landing/src 里一个 blob/main/ 链接都没扫到').toBeGreaterThan(0);
    // 剥注释那一步的阳性对照：页脚的真链接必须仍在集合里。
    // 没有这条，"整行注释都剥掉"会把扫描器削成空集，而下面两条判据会一起变成装饰。
    expect(
      paths,
      `扫到的 blob 路径里没有 CONTRIBUTING.md（实得 ${paths.join(', ') || '空'}）⇒ 剥注释剥过头了`,
    ).toContain('CONTRIBUTING.md');
    const missingLocally = paths.filter((p) => !existsSync(join(REPO_ROOT, p)));
    expect(missingLocally, `公页指向了仓库里不存在的文档：${missingLocally.join(', ')}`).toEqual([]);
    // 🔴 这一段是补 2026-10-03 那次实测的：链接指向的是**公开远端的 main**，
    // 而原来这条判据只 `existsSync` 本地工作树 —— 于是"文件只活在没合入的分支上"
    // 会判绿，线上是 404（自建指南那条当时就是这样死的）。
    const missingUpstream = paths.filter((p) => !pushedDefaultBranchHas(p));
    expect(
      missingUpstream,
      `公页直链的文档在 origin/main 上不存在（本地有、没推上去 = 外人点开就是 404）：${missingUpstream.join(', ')}` +
        '。要么把它合进并推到默认分支，要么别在公页上直链。',
    ).toEqual([]);
  });

  it('自建指南的链接指向站内那篇文章，且那篇文章不含内部主机名 / 公网 IP', () => {
    const href = guideHrefFromRegistry();
    expect(href, `自建指南链接不再是站内路径：${href}`).toMatch(/^\/docs\/[a-z-]+\/$/);
    const values = selfHostArticleValues();
    // 抽取层哨兵：文章有 20+ 段，只抽到个位数说明前缀或目录结构变了。
    expect(values.length, `只从词条表里抽到 ${String(values.length)} 条自建指南正文`).toBeGreaterThanOrEqual(
      20,
    );
    // 同趟阳性对照：抽取本身坏了的话，下面那条"零命中"就不构成证据。
    expect(
      values.some((v) => v.includes('三个必填项')),
      '抽取到的正文里没有「三个必填项」⇒ 抽取层坏了，"不含内部标记"这条判据在空转',
    ).toBe(true);
    const hits = INTERNAL_OPS_NEEDLES.filter((n) => values.some((v) => v.includes(n)));
    expect(hits, `站内自建指南（${href}）里出现内部运维标记：${hits.join(', ')}`).toEqual([]);
  });

  it('正面对照：同一条 needle 扫描在内部运维手册上必然命中', () => {
    const internal = readFileSync(
      join(REPO_ROOT, 'docs/runbooks/local-server-verification.md'),
      'utf8',
    );
    const hits = INTERNAL_OPS_NEEDLES.filter((n) => internal.includes(n));
    expect(
      hits.length,
      'needle 表在一份确实含内部机器的文档上也零命中 ⇒ needle 表或扫描本身坏了，' +
        '上一条的"零命中"因此不构成证据',
    ).toBeGreaterThanOrEqual(3);
  });

  it('首页与页脚渲染出来的 href 就是那个常量，且没有一个 a 直连内部验收手册', () => {
    // 🔴 前三条读的都是常量；这条读**DOM**。缺陷的真实形状是"常量改了、某个组件自己抄了一份旧路径"
    //（页脚的文档分组以前就自己抄过一遍路径，于是"指南搬家"要改两处而漏一处）。
    const renderedHrefs = ['zh-CN', 'en'].flatMap((locale) => {
      const view = renderPage('home', locale as Locale);
      return [...view.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.getAttribute('href') ?? '');
    });

    const toGuide = renderedHrefs.filter((h) => h === SELF_HOST_GUIDE_URL);
    expect(
      toGuide.length,
      `渲染出来的页面上一个指向自建指南的链接都没有（中英两版共 ${String(renderedHrefs.length)} 个 a）` +
        ' ⇒ 常量没被渲染出来，这条判据会变成空转',
    ).toBeGreaterThan(0);

    // 🔴 上面那一条**单独是不够的**：2026-10-03 实测，把 `Footer.tsx` 改成自己抄一份
    // `/docs/selfhost`（少一个尾斜杠）时它照样绿 —— 因为自建区那一处仍然用的常量，
    // "至少有一个链接等于常量"就成立了。真正要判的是**集合**：
    // 页面上所有指向自建指南的 href，只许有常量这一个值。
    const guideish = [
      ...new Set(
        renderedHrefs.filter((h) => !h.startsWith('#') && /selfhost/i.test(h)),
      ),
    ].sort();
    expect(
      guideish,
      `公页上指向自建指南的 href 不止一个值（实得 ${guideish.join(' , ')}）` +
        ` ⇒ 有组件自己抄了一份路径，而"指南搬家"就又要改两处了`,
    ).toEqual([SELF_HOST_GUIDE_URL]);

    const internal = [...new Set(renderedHrefs.filter((h) => h.includes('local-server-verification')))];
    expect(
      internal,
      `公页上有链接直连内部 P0 验收手册（它开头是一张内部机器表）：${internal.join(', ')}`,
    ).toEqual([]);
  });
});
