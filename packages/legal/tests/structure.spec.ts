/**
 * 中英结构对账 + 对外承诺的形态闸门
 * ===================================
 *
 * 🔴 **本包不受 `check:ui-language` 管辖**（它扫各端的 `apps` 下的 `src`），
 * 所以"中英不许漂移"这件事**只有这里在管**。这不是补一个空缺，
 * 换的是**一类闸门**：词条表靠 `Record<MessageKey, string>` 的多余属性检查在编译期红，
 * 而"两份语言的结构相同"这种性质类型表达不了（`Record<Locale, LegalSection[]>`
 * 两边都是同一个类型），只能用测试表达。
 *
 * 于是这里钉四件事，前三件都是**类型永远管不到**的：
 *
 *   1. **结构逐段镜像**：小节 id 序列、每节块数、块的 `kind` 顺序、
 *      表格的表头长度与每行单元格数、有序/无序列表的项数、子小节递归 —— 全部一一对应。
 *      漂移的形态是"英文版少一段"，而它**在页面上看不出来**（少一段读起来仍然通顺），
 *      只会让中英两版对外承诺的范围不同 —— 法务场景里这是最坏的一类缺陷。
 *   2. **行内标记平衡**：`**` 与反引号必须成对，且**不许出现** `<`、Markdown 链接、
 *      裸 URL。渲染器（落地页 `RichText`）只支持 `**粗**` 与 `` `代码` `` 两种，
 *      写进别的标记不是"少渲染一个样式"，是**在页面上留下字面的星号或尖括号**。
 *   3. **`docRef` 的目标必须存在**：指向一份不存在的文件，在页面上会渲染成
 *      一段引用了自己也没有的文本的死链接。
 *   4. **主体与备案号**：不得出现**别人的**名字（上游德语 AGB 的服务提供者），
 *      不得出现任何**尚未核准**的 App 备案号，不得留下模板占位符。
 *
 * ⚠️ 这套判据**只保证形态**，不保证"这句话是真的"。
 * 事实性靠 §`docs/plans/legal-compliance-before-filing.md` §1 那张表：
 * 每一条"我们做/不做 X"要能指回一份 `docs/research/legal-dataflow-*.md`。
 * 结构测试挡不住一个结构完整、中英对齐、但**内容编造**的文件 —— 它压根没这个能力。
 */

import { describe, expect, it } from 'vitest';

import type { LegalBlock, LegalDocument, LegalSection } from '../src/types.js';

import { LEGAL_DOCUMENTS, OPERATOR, legalSetVersion, legalTitle } from '../src/index.js';

/**
 * 本包的语言清单**钉死在两个**。
 *
 * 🔴 为什么不用 `LOCALES`（`@heyta/i18n/provider`）：那是**界面文案**的语言集合，
 * 以后加第三种语言时它一定会扩，而对外法律文本加语言是一个**独立的法务决定**
 * （每种语言都要有人对它的措辞负责）。用 `LOCALES` 会让"加了个界面语言"
 * 静默变成"一份没有法务复核的外文法律文本"。
 * 加语言要改这里，改这里就要想一遍。
 */
const LEGAL_LOCALES = ['zh-CN', 'en'] as const;

type LegalShape =
  | { readonly kind: 'block'; readonly type: string }
  | { readonly kind: 'section'; readonly id: string; readonly shape: readonly LegalShape[] };

/** 把一个 locale 的整棵小节树压成**可比较的形状**（文字全部丢掉，只留结构）。 */
function shapeOf(sections: readonly LegalSection[]): readonly LegalShape[] {
  return sections.map((section) => ({
    kind: 'section' as const,
    id: section.id,
    shape: [
      ...(section.blocks ?? []).map((block) => ({ kind: 'block' as const, type: blockType(block) })),
      ...shapeOf(section.subsections ?? []),
    ],
  }));
}

/**
 * 块的形状标识 —— **把表格与列表的"几列几行几项"也算进形状**。
 *
 * 只比 `kind` 是不够的：英文版把一张六行的表写成五行，`kind` 完全相同，
 * 而页面上访客看到的清单少一项 —— 那正是"两版对外承诺范围不同"的形状。
 */
function blockType(block: LegalBlock): string {
  switch (block.kind) {
    case 'table':
      return `table(${block.head.length}x${block.rows.length}[${block.rows
        .map((row) => row.length)
        .join(',')}])`;
    case 'ul':
    case 'ol':
      return `${block.kind}(${block.items.length})`;
    case 'docRef':
      return `docRef(${block.docId})`;
    default:
      return block.kind;
  }
}

/** 遍历整棵树上的每一段可渲染文字（含标题、摘要、表格单元格）。 */
function allTexts(document: LegalDocument): readonly string[] {
  const texts: string[] = [
    ...Object.values(document.title),
    ...Object.values(document.summary),
  ];
  const walk = (sections: readonly LegalSection[]): void => {
    for (const section of sections) {
      texts.push(section.title);
      for (const block of section.blocks ?? []) {
        switch (block.kind) {
          case 'p':
          case 'callout':
            texts.push(block.text);
            break;
          case 'docRef':
            texts.push(block.text);
            break;
          case 'ul':
          case 'ol':
            texts.push(...block.items);
            break;
          case 'table':
            texts.push(...block.head, ...block.rows.flat());
            break;
        }
      }
      walk(section.subsections ?? []);
    }
  };
  walk(document.sections['zh-CN']);
  walk(document.sections.en);
  return texts;
}

const ids = LEGAL_DOCUMENTS.map((document) => document.id);

describe('@heyta/legal 的注册表自身', () => {
  it('id 唯一，且是 URL 安全的小写短横线', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `id "${id}" 会直接进 URL（/legal/<id>/）`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('每份文件在两种语言下都有标题与摘要，且都不为空', () => {
    for (const document of LEGAL_DOCUMENTS) {
      for (const locale of LEGAL_LOCALES) {
        expect(document.title[locale]?.trim(), `${document.id} 缺标题`).toBeTruthy();
        expect(document.summary[locale]?.trim(), `${document.id} 缺摘要`).toBeTruthy();
        expect(legalTitle(document.id, locale)).toBe(document.title[locale]);
      }
    }
  });

  it('legalSetVersion() 含每份文件的 id@version，且与数组顺序无关', () => {
    const version = legalSetVersion();
    for (const document of LEGAL_DOCUMENTS) {
      expect(version).toContain(`${document.id}@${document.version}`);
    }
    expect(version.split(';').length).toBe(LEGAL_DOCUMENTS.length);
    // 排序拼接：字典序，所以与声明顺序无关（声明顺序变了不该改变指纹）。
    expect(version).toBe(
      [...LEGAL_DOCUMENTS]
        .map((document) => `${document.id}@${document.version}`)
        .sort()
        .join(';'),
    );
  });
  it('docRef 指向的文件必须真的存在', () => {
    // 🔴 这条管的是本包**唯一**的跨文件引用机制。渲染器从注册表解析 URL，
    // 所以目标写错的表现不是编译期红（`docId` 是 `string`，不是联合类型），
    // 而是页面上出现一句"见《…」"却点不出东西 —— 法务文本里的死链接
    // 与"没有这条引用"一样是可达性缺陷。
    const refs: { from: string; to: string }[] = [];
    const walk = (document: LegalDocument, sections: readonly LegalSection[]): void => {
      for (const section of sections) {
        for (const block of section.blocks ?? []) {
          if (block.kind === 'docRef') refs.push({ from: document.id, to: block.docId });
        }
        walk(document, section.subsections ?? []);
      }
    };
    for (const document of LEGAL_DOCUMENTS) walk(document, document.sections['zh-CN']);
    expect(refs.length, '一条 docRef 都没有 = 这条判据是装饰，先确认它抓过东西').toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ids, `${ref.from} 引用了注册表里不存在的 ${ref.to}`).toContain(ref.to);
    }
  });
});

describe('每份文本的元信息纪律', () => {
  for (const document of LEGAL_DOCUMENTS) {
    it(`${document.id}：版本、日期、状态三者自洽`, () => {
      expect(document.version, '版本号要写进同意记录，不许空').toMatch(/^\d+\.\d+/);
      expect(document.updatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (document.status === 'draft') {
        // 🔴 草案没有生效日期。写了就等于宣布"这一版已经对用户发生效力"。
        expect(document.effectiveDate, 'draft 文本不许有生效日期').toBeUndefined();
      } else {
        expect(document.effectiveDate, 'effective 文本必须有生效日期').toBeTruthy();
      }
    });

    it(`${document.id}：小节 id 在同一份文件里唯一`, () => {
      const seen: string[] = [];
      const walk = (sections: readonly LegalSection[]): void => {
        for (const section of sections) {
          seen.push(section.id);
          walk(section.subsections ?? []);
        }
      };
      walk(document.sections['zh-CN']);
      expect(new Set(seen).size, `重复的锚点 id 会让深链接指错地方：${seen.join(',')}`).toBe(
        seen.length,
      );
    });
  }
});

describe('中英逐段镜像（本包唯一的语言对齐闸门）', () => {
  for (const document of LEGAL_DOCUMENTS) {
    it(`${document.id}：两版结构逐一对应`, () => {
      const zh = shapeOf(document.sections['zh-CN']);
      const en = shapeOf(document.sections.en);
      // 逐字比对而不是 toEqual：形状以 `table(5x6[5,5,5,5,5])` 这种形式出现，
      // 差异一眼能读出是"哪一节哪张表少了一行"，不必再去翻对象。
      expect(JSON.stringify(en), `${document.id} 英文版结构与中文版不一致`).toBe(
        JSON.stringify(zh),
      );
    });

    it(`${document.id}：两版都只声明 ${LEGAL_LOCALES.join('/')} 这两种语言`, () => {
      expect(Object.keys(document.sections).sort()).toEqual([...LEGAL_LOCALES].sort());
      expect(Object.keys(document.title).sort()).toEqual([...LEGAL_LOCALES].sort());
      expect(Object.keys(document.summary).sort()).toEqual([...LEGAL_LOCALES].sort());
    });
  }
});

describe('行内标记与渲染器能表达的东西一致', () => {
  for (const document of LEGAL_DOCUMENTS) {
    it(`${document.id}：标记成对、无 HTML、无裸链接、无占位符`, () => {
      for (const text of allTexts(document)) {
        const label = text.slice(0, 32);
        // `**` 的计数按"星号对的个数"算：连续的 *** 会算出奇数，那正是想要的报错。
        const stars = (text.match(/\*/g) ?? []).length;
        expect(stars % 2, `${label}… 里有落单的星号`).toBe(0);
        const ticks = (text.match(/`/g) ?? []).length;
        expect(ticks % 2, `${label}… 里有落单反引号`).toBe(0);
        // 🔴 下面三条查的是**散文**，所以先把 `` `代码` `` 摘掉。
        // 理由不是宽容，是那条标记本来就只支持两种：代码段里的 `<path>`、
        // `http://…`、`[x](y)` 会**按字面渲染**，而那正是想要的效果
        // （法律文本里在讲"命令行参数长什么样"、"自建地址是 http:// 开头"）。
        // 不摘掉它们，闸门会在真实内容上判红 —— 而一个总在红闸门上的
        // 后果不是"没人写代码段"，是"下次真违规也被人当噪音跳过"。
        const prose = text.replace(/`[^`]*`/g, '');
        expect(prose, `${label}… 不许在散文里出现 HTML（渲染器不解析它）`).not.toMatch(/[<][a-zA-Z/]/);
        expect(prose, `${label}… 不许在散文里出现 Markdown 链接`).not.toMatch(/\]\(/);
        expect(prose, `${label}… 不许在散文里出现裸 URL（指向另一份文件走 docRef 块）`).not.toMatch(
          /https?:\/\//,
        );
        // 模板占位符：服务端那份英文模板就是这么把 "[Contact Name]" 发出去的。
        // 这条**不摘代码段** —— 占位符写在哪都是占位符。
        expect(text, `${label}… 是未替换的占位符`).not.toMatch(
          /\{\{|\[Contact|TODO|TBD|待填|XXX|示例\.com/,
        );
      }
    });
  }
});

describe('对外承诺里的主体不许错', () => {
  const allText = LEGAL_DOCUMENTS.flatMap((document) => allTexts(document));

  it.each([
    ['Super Productivity', '那是上游项目的名字，不是 heyta 的'],
    ['SuperSync', '同上：服务端 vendored 自它，但对外主体不是它'],
    ['Johannes Millan', '上游德语 AGB 的服务提供者，与 heyta 无关'],
    ['[Your Company', '模板占位符'],
  ])('正文里不出现 %s（%s）', (needle, why) => {
    const hits = allText.filter((text) => text.includes(needle));
    expect(hits, `${why}；命中 ${hits.length} 处：${hits.map((h) => h.slice(0, 40)).join(' | ')}`)
      .toEqual([]);
  });

  it('备案号：正文里出现的每一个 ICP 编号都必须就是 OPERATOR 那一个', () => {
    // 🔴 这条管的**不是**"不许印备案号" —— 隐私政策本来就该公布备案号
    //（《互联网信息服务管理办法》与商店提审都看这一行）。管的是**漂移**：
    // 编号在 `OPERATOR.icpNumber` 有一份，在九份文件的正文里各有一份，
    // 换主体/换号时改一处漏八处，而对外承诺里一个错的备案号比不写更坏
    //（它把责任指向一个不存在的备案）。所以判据是"只能等于那一个"。
    const seen = new Set<string>();
    for (const text of allText) {
      for (const match of text.matchAll(/[京津沪粤浙苏鲁闽桂]{1}ICP备\d{6,}号/g)) {
        seen.add(match[0]);
      }
    }
    for (const number of seen) {
      expect(number, `正文里的备案号与 OPERATOR.icpNumber 不一致`).toBe(OPERATOR.icpNumber);
    }
    // 反向也要成立：本主体**有**已核准的 ICP 备案号（`OPERATOR.icpNumber`
    // 不是可空字段，它就是备案主体那份事实），九份正文里却一处都没印 = 漏写。
    expect(seen.size, 'OPERATOR 有 ICP 备案号，但九份正文里一处都没出现').toBeGreaterThan(0);
  });

  it('App 备案号：核准之前正文里不许出现任何编号，核准之后必须就是 OPERATOR 那一个', () => {
    // 未核准时写一个编号 = 编造。核准后如果正文与字段不一致 = 漂移。两种都要红。
    const numbered = allText.filter((text) => /App\s*备案号\s*[浙京沪粤]\s*ICP|\[[^\]]*待核准[^\]]*\]/.test(text));
    if (OPERATOR.appFilingNumber === null) {
      expect(numbered, 'App 备案号尚未核准，正文却出现了编号').toEqual([]);
    } else {
      for (const text of numbered) {
        expect(text).toContain(OPERATOR.appFilingNumber);
      }
    }
  });

  it('联系邮箱与 OPERATOR 那份一致，不在九份文件里各写一遍', () => {
    // 🔴 TLD 必须是**字母**：`[\w.]+` 会把同意指纹 `terms@1.0` 也当成邮箱
    //（那个字符串就出现在权利行使那一份里，讲的是"你同意的是哪一套文本"）。
    const emails = new Set(
      allText.flatMap((text) => [
        ...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g),
      ]).map((m) => m[0]),
    );
    for (const email of emails) {
      expect(email, `正文里出现了 OPERATOR 之外的联系邮箱 ${email}`).toBe(OPERATOR.contactEmail);
    }
  });
});
