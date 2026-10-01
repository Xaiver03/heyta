/**
 * 文档中心配图 —— 「哪一节配哪张图」的唯一事实源
 * =================================================
 *
 * 🔴 **这里只登记意图，不登记图号，也不登记像素。**
 * 图号（`图 14-1`）由 [`docs.ts`](./docs.ts) 的 `docsFiguresOf()` 从**注册表顺序**算出来，
 * 像素住在 `screenshots/`（由 `scripts/screenshots/` 那套采集与验收管），
 * 复制品住在 `public/assets/help/`（由 `scripts/gen-help-figures.mjs` 生成）。
 * 三处各管一件事，所以"改了正文顺序图号还是旧的""图换了她没重跑"
 * 这两类漂移都发生不了 —— 手写编号的保质期是**下一次插入一节**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **为什么是"复制真截图"而不是"引用 screenshots/"**
 *
 * `screenshots/` 不在 `apps/landing` 的构建根里，`public/` 才是能被打进产物的地方。
 * 但复制会造出一个经典事故形状：**两份文件，只有一份是新的**。
 * 所以复制品**不是手抄的**，是生成的，而且 `--check` 拿 **sha256** 比源文件 ——
 * 源图重新截过而没重跑生成器，门禁就红（这道闸跟 `check:entries` 同一个理由）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **为什么只有五张**
 *
 * 判据是**这张图能不能解释它上面那段话**（规格 §6 的装饰图禁令）。
 * 十七个分区里能过这条的只有五处：首屏、习惯、四象限、时间线、回收站 ——
 * 它们回答的都是"那个东西长什么样"，看一眼就懂，不必读三段字。
 * 其余的分区回答的是"这件事怎么办"（口令丢了、冲突判给谁、服务端看得到什么），
 * 那些地方配任何截图都是装饰，而装饰图会让访客学会**跳过图**。
 *
 * ⚠️ **`W08-设置` 与 `L07-登录` 是人眼挑出来排除的，不是没找到位置**：
 * 设置页那张把本机 API 的**配置文件绝对路径与生成 token 的命令**渲染在了界面上，
 * 属于规格 §5 第 16 条那一类（内部标识）；登录页那张是公开站自己的页面，
 * 拿去给产品文章配图是自我指涉。两条都记在 BLOCKED.md。
 *
 * ⚠️ **配图按界面语言成对**（zh / en 各一张，见 `HelpFigure.locale`）。
 * 曾经英文版整片不挂图（BLOCKED.md B1）：不是不想挂，是缺**英文界面的
 * 采集能力**——`capture.mjs` 把 `locale: 'zh-CN'` 写死。那道闸已解：
 * 目标注册表支持按目标声明 locale，en 目标走 `?lang=` 参数截英文界面。
 * 挂中文界面图进英文正文，仍然是错的（访客要脑补"我那个英文按钮在哪儿"），
 * e2e 的反向对照钉着这一点。
 */

import type { MessageKey } from '@heyta/i18n/provider';

import type { DocsArticleId } from './docs.js';

/**
 * 一张配图：挂在哪一节、来自哪个截图目标、复制品叫什么、alt 与题注用哪对词条。
 *
 * ⚠️ `targetId` 是 `scripts/screenshots/targets.mjs` 里 `TARGETS` 的 id，
 * **源文件路径不在这里写**：生成器用它去查那张表的 `site` / `device` / `name`，
 * 再按那套目录与命名约定（`screenshots/<组>/<id>-<中文名>.png`）算出源路径。
 * 在这里抄一遍路径，等于给"截图改名"埋一个只在生成时才炸的雷。
 */
export type HelpFigureLocale = 'zh-CN' | 'en';

export interface HelpFigure {
  /** 这张图是哪个界面语言的截图。英文页挂英文界面图，中文页挂中文界面图。 */
  readonly locale: HelpFigureLocale;
  /** 挂在哪一节（`docs.ts` 里那篇的 `sections[].id`）。 */
  readonly sectionId: string;
  readonly targetId: string;
  /** 复制品文件名的 slug：`<targetId>-<slug>.png`。 */
  readonly slug: string;
  readonly captionKey: MessageKey;
  readonly altKey: MessageKey;
}

/**
 * 配图清单。**总量 = 文章数**（`Record<DocsArticleId, …>`），没有图的文章写空数组。
 *
 * 🔴 之所以要求逐篇表态：新加一篇文章时若这张表是"可选的"，
 * 它就会一直空着 —— 而"这一篇该不该配图"这个问题只有作者能回答，
 * 编译器只能保证**它被问到过**。
 *
 * 🔴 每篇文章里 **zh 与 en 成对出现**（同一节、同一对词条 key、同一 slug，
 * 只有 `locale` 与 `targetId` 不同——英文目标在 `targets.mjs` 里是独立的 id）。
 * 只加 zh 不加 en，`--check` 不会红，但英文页会回到"整篇没有一张图"的旧缺陷
 * —— B1 就是这么来的，所以这里写成**结构上看得出来**的成对形状。
 */
export const HELP_FIGURES: Record<DocsArticleId, readonly HelpFigure[]> = {
  'first-run': [
    {
      locale: 'zh-CN',
      sectionId: 'first-screen',
      targetId: 'W01',
      slug: 'tasks',
      captionKey: 'site.docs.first-run.fig.tasks',
      altKey: 'site.docs.first-run.fig.tasks.alt',
    },
    {
      locale: 'en',
      sectionId: 'first-screen',
      targetId: 'W01-en',
      slug: 'tasks',
      captionKey: 'site.docs.first-run.fig.tasks',
      altKey: 'site.docs.first-run.fig.tasks.alt',
    },
  ],
  concepts: [
    {
      locale: 'zh-CN',
      sectionId: 'habits',
      targetId: 'W03',
      slug: 'habits',
      captionKey: 'site.docs.concepts.fig.habits',
      altKey: 'site.docs.concepts.fig.habits.alt',
    },
    {
      locale: 'en',
      sectionId: 'habits',
      targetId: 'W03-en',
      slug: 'habits',
      captionKey: 'site.docs.concepts.fig.habits',
      altKey: 'site.docs.concepts.fig.habits.alt',
    },
  ],
  how: [],
  account: [],
  passphrase: [],
  conflict: [],
  views: [
    {
      locale: 'zh-CN',
      sectionId: 'quadrant',
      targetId: 'W02',
      slug: 'quadrant',
      captionKey: 'site.docs.views.fig.quadrant',
      altKey: 'site.docs.views.fig.quadrant.alt',
    },
    {
      locale: 'zh-CN',
      sectionId: 'timeline',
      targetId: 'W05',
      slug: 'timeline',
      captionKey: 'site.docs.views.fig.timeline',
      altKey: 'site.docs.views.fig.timeline.alt',
    },
    {
      locale: 'en',
      sectionId: 'quadrant',
      targetId: 'W02-en',
      slug: 'quadrant',
      captionKey: 'site.docs.views.fig.quadrant',
      altKey: 'site.docs.views.fig.quadrant.alt',
    },
    {
      locale: 'en',
      sectionId: 'timeline',
      targetId: 'W05-en',
      slug: 'timeline',
      captionKey: 'site.docs.views.fig.timeline',
      altKey: 'site.docs.views.fig.timeline.alt',
    },
  ],
  repeat: [],
  reminders: [],
  selfhost: [],
  transfer: [],
  trash: [
    {
      locale: 'zh-CN',
      sectionId: 'tasks-only',
      targetId: 'W07',
      slug: 'trash',
      captionKey: 'site.docs.trash.fig.trash',
      altKey: 'site.docs.trash.fig.trash.alt',
    },
    {
      locale: 'en',
      sectionId: 'tasks-only',
      targetId: 'W07-en',
      slug: 'trash',
      captionKey: 'site.docs.trash.fig.trash',
      altKey: 'site.docs.trash.fig.trash.alt',
    },
  ],
  privacy: [],
  loss: [],
};

/**
 * 成对性判据：每个有图的文章里，zh 与 en 的（sectionId, slug）集合必须相等。
 * 🔴 这条拦的是"只给一种语言加了图"—— 上面注释里说的那个 B1 形状。
 * 挂在数据层而不是靠 e2e，是因为生成器与渲染器都从这张表取数：
 * 表里不成对，两边谁也绕不过去。
 */
export function assertHelpFigurePairs(): void {
  const problems: string[] = [];
  for (const [articleId, figures] of Object.entries(HELP_FIGURES)) {
    const bySlug = new Map<string, Set<string>>();
    for (const figure of figures) {
      const key = `${figure.sectionId}/${figure.slug}`;
      const locales = bySlug.get(key) ?? new Set<string>();
      locales.add(figure.locale);
      bySlug.set(key, locales);
    }
    for (const [key, locales] of bySlug) {
      if (locales.size !== 2) {
        problems.push(`${articleId} 的 ${key} 只有 ${[...locales].join('+')}，缺另一种语言`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`配图没有成对：\n  ${problems.join('\n  ')}`);
  }
}

/** 复制品的文件名（生成器与渲染器共用这一条规则，不各写一遍）。 */
export function helpFigureFile(figure: HelpFigure): string {
  return `${figure.targetId}-${figure.slug}.png`;
}

/**
 * 复制品在站点里的**同一件事的两个视图**：访客看到的 URL 与生成器落盘的目录。
 *
 * 🔴 这两行必须留在一起。以前磁盘路径写在生成器里、URL 写在 `docs.ts` 里，
 * 于是 `public/assets/help/` 这条规则有四处表达（映射、生成器、渲染器、孤儿扫描），
 * 而"把 `assets/help` 改名"这种活只需要改一处就能让另外三处悄悄断掉。
 * vite 配置里**没有** `base`，所以根绝对路径就是对的（`pages.ts` 同源）。
 */
const URL_PREFIX = '/assets/help';
const ON_DISK_PREFIX = 'apps/landing/public' + URL_PREFIX;

/** 一张图对访客的地址。 */
export function helpFigureSrc(articleId: DocsArticleId, figure: HelpFigure): string {
  return `${URL_PREFIX}/${articleId}/${helpFigureFile(figure)}`;
}

/** 一张图在仓库里的目录（生成器写、`--check` 扫孤儿都走这里）。 */
export function helpFigureDir(articleId: DocsArticleId): string {
  return `${ON_DISK_PREFIX}/${articleId}`;
}

/** 全部复制品的根目录（孤儿扫描要看的范围）。 */
export const HELP_FIGURE_ROOT = ON_DISK_PREFIX;
