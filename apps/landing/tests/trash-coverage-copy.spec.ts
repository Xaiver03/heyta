/**
 * 回收站覆盖面：帮助文档说的那几类 == 代码真的支持的那几类 == 拍板的那几类
 * ========================================================================
 *
 * 起因：W4 把清单与习惯接进回收站之后，帮助中心那一节还写着只有任务。那句不是
 * 措辞问题 —— 它是对外的一条**能力声明**。声明过期与从未实现过的表现在访客眼里
 * 一模一样（他按文档去找便签的还原入口，找不到），属于本仓库反复踩到的"界面在说谎"
 * 那一族，只是这一次说谎的是文档。
 *
 * 🔴 三本账，两两对账，而不是"文档 == 我以为的集合"：
 *   · **拍板**：P-1（[计划](../../../docs/plans/trash-and-archive.md) §7.1）——
 *     任务/便签/清单/习惯进，标签/提醒/专注记录不进。这是决定，不来自代码，
 *     所以它**必须**写死在本文件里；从代码派生它就等于取消了对代码的约束。
 *   · **代码**：`packages/ui` 的 `TRASH_KINDS`（回收站那一行的唯一所有者，
 *     两端宿主那张穷尽路由表的类型就是从它派生的）。
 *   · **文档**：`site.docs.trash.s1*` 那一段正文 + 注册表实际引用的键。
 *   本文件的每一条都只比其中两本，所以红的时候能指出是哪两本在打架。
 *
 * ⚠️ 深路径 import 的是 `packages/ui` 的**源码**而不是包入口：落地页的测试环境
 *   解析不了 RN 组件（同一个理由见 `apps/landing/vite.config.ts` 文件头那段
 *   "测试里也不要 import `@heyta/ui`"）。
 */

import { describe, expect, it } from 'vitest';

import { en } from '@heyta/i18n/en';
import { zhCN } from '@heyta/i18n/zh-CN';

import { docsArticleById, docsFiguresOf } from '../src/site/docs.js';
import { TRASH_KINDS } from '../../../packages/domain/src/trash-rows';

const TABLES: Record<'zh-CN' | 'en', Record<string, string>> = { 'zh-CN': zhCN, en };
const LOCALES = ['zh-CN', 'en'] as const;

/** P-1 拍板：进回收站的四类。写死是刻意的，理由见文件头。 */
const RULED_IN = ['TASK', 'NOTE', 'PROJECT', 'HABIT'] as const;
/** P-1 拍板：不进的三类。 */
const RULED_OUT = ['TAG', 'REMINDER', 'FOCUS_SESSION'] as const;

const ARTICLE = docsArticleById('trash');

/** 「回收站里有什么」那一节的正文键（能力声明就在这一节，不对整篇）。 */
function firstSectionKeys(): string[] {
  const [first] = ARTICLE.sections;
  if (first === undefined) throw new Error('回收站那一篇没有第一节 —— 键名全部按它来对账');
  return [...(first.bodyKeys ?? []), ...(first.itemKeys ?? [])].map(String);
}

/** 整篇引用到的全部键（含各节标题），反向对账用。 */
function referencedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const section of ARTICLE.sections) {
    keys.add(String(section.titleKey));
    for (const key of section.bodyKeys ?? []) keys.add(String(key));
    for (const key of section.itemKeys ?? []) keys.add(String(key));
  }
  return keys;
}

function trashCopy(locale: 'zh-CN' | 'en'): string {
  // 🔴 只取**那句列举本身**（s1p1），不是整节拼接：拼接会让"某一类只在下面解释
  // 归属的段落里出现过"也算通过，而那恰好是这条判据要拦的形状（声明里漏了一类）。
  const claim = TABLES[locale]['site.docs.trash.s1p1'];
  if (claim === undefined) throw new Error('词条表里没有 site.docs.trash.s1p1');
  return claim;
}

describe('回收站覆盖面：三本账两两对账', () => {
  it('🔴 代码里的类别集合 == P-1 拍板的四类', () => {
    // 两个方向都要红：加一类而 P-1 没改（有人越过拍板），或减一类而文档还留着。
    expect([...TRASH_KINDS].sort()).toEqual([...RULED_IN].sort());
  });

  it('🔴 每一类都有实体名词条，并且那句话把它点名了（中英各一遍）', () => {
    // 这一条同时挡三种坏法：
    //   · 加了一类却忘了词条（取不到值，界面上就是裸 key）；
    //   · 加了词条却忘了在文档里说；
    //   · 改了类别名或改了叫法（P-6「统一叫便签」）而文档还留着旧名。
    for (const locale of LOCALES) {
      const copy = trashCopy(locale).toLowerCase();
      for (const kind of RULED_IN) {
        const label = TABLES[locale][`common.entity.${kind}`];
        if (label === undefined) throw new Error(`${locale} 没有 common.entity.${kind} 词条`);
        expect(
          copy.includes(label.toLowerCase()),
          `${locale} 那句列举没有点名「${label}」（P-1 里的类别：${RULED_IN.join(', ')}）`,
        ).toBe(true);
      }
    }
  });

  it('🔴 不进的三类都被写成「不进」，而且给出理由', () => {
    // 理由必须在场：只写"没有"，下一轮就会有人把它当遗漏补上（P-1 是被拍板
    // 排除的，不是没做完的）。中文那句同时给出「不是遗漏」这个明示。
    expect(
      RULED_IN.filter((kind) => (RULED_OUT as readonly string[]).includes(kind)),
    ).toEqual([]);

    const zh = trashCopy('zh-CN');
    expect(zh).toContain('**不进**');
    expect(zh).toContain('不是遗漏');
    const enCopy = trashCopy('en');
    expect(enCopy).toContain('deliberately do **not**');

    for (const locale of LOCALES) {
      const copy = trashCopy(locale).toLowerCase();
      for (const kind of RULED_OUT) {
        const label = TABLES[locale][`common.entity.${kind}`];
        if (label === undefined) throw new Error(`${locale} 没有 common.entity.${kind} 词条`);
        expect(
          copy.includes(label.toLowerCase()),
          `${locale} 那句列举里的"不进"半句没有点名「${label}」`,
        ).toBe(true);
      }
    }
  });

  it('新写的正文真的挂在页面上：注册表与词条表双向对账', () => {
    const referenced = referencedKeys();
    // 正对照 + 本工单新增的那一段：按**名字**钉，不写条数（条数会在下一段落地时假红）。
    const firstSectionParagraphs = firstSectionKeys().filter((key) => /\.s\d+p\d+$/.test(key));
    expect(firstSectionParagraphs).toContain('site.docs.trash.s1p1');
    expect(firstSectionParagraphs).toContain('site.docs.trash.s1p3');

    // 反向：整篇里存在的正文键（sNpM / sNwM）若没被注册表引用，用户永远读不到。
    const declared = Object.keys(TABLES['zh-CN'])
      .filter((key) => key.startsWith('site.docs.trash.s'))
      .filter((key) => /\.s\d+(p|w)\d+$/.test(key));
    expect(declared.length, '这一篇的正文键一条都没扫到，判据就是空的').toBeGreaterThan(0);
    const orphans = declared.filter((key) => !referenced.has(key));
    expect(orphans, '这些正文段落写了却没挂到页面上').toEqual([]);

    // 注册表引用的键必须两边都取得到值（缺一个就渲染成裸 key）。
    for (const locale of LOCALES) {
      for (const key of referenced) {
        expect(TABLES[locale][key], `${locale} 缺 ${key}`).toBeTruthy();
      }
    }
  });
  it('🔴 分区锚点改名不许把配图甩掉（这一篇在两种语言下都还得有图）', () => {
    // 本批把第一节改名（`tasks-only` → `what-the-trash-holds`，3 个文件 5 处）。
    // `docsFiguresOf` 对找不到分区的映射是**抛错**而不是静默丢图 —— 而"页面上少一张图"
    // 本来没有任何判据会喊（段落数、目录、卡片数都不看它）。这条就是那道抛错的常驻消费者：
    // 漏改一处 ⇒ 这里红，不用等那趟很贵又必须串行的浏览器验收。
    for (const locale of LOCALES) {
      const figures = docsFiguresOf(ARTICLE, locale);
      expect(figures.length, `${locale} 这一篇现在一张配图都没有 —— 映射被改断了`).toBeGreaterThan(0);
      for (const figure of figures) {
        expect(
          ARTICLE.sections.some((section) => section.id === figure.sectionId),
          `${locale} 的配图 ${figure.targetId} 挂在不存在分区 "${figure.sectionId}" 上`,
        ).toBe(true);
      }
    }
  });
});
