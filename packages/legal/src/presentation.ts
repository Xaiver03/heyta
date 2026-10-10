/**
 * 法律长文的展示适配。原文、锚点、版本及同意指纹保持不变。
 * 各端只在阅读时消费此派生值，不把排版结果写回同意记录。
 */
import type { LegalBlock, LegalDocument, LegalSection } from './types.js';
import type { Locale } from '@heyta/i18n';

/**
 * 协议正文使用正式、可执行的法律句式；这一步只作用于阅读投影，
 * 不改变正文事实源、版本或同意指纹。规则刻意只替换明显的口语连接词，
 * 不把“简单易懂”改成堆砌法律术语。
 */
const FORMAL_WORDING: readonly (readonly [string, string])[] = [
  ['换句话说：', '据此：'],
  ['换句话说,', '据此，'],
  ['先说一句不客气的话：', '现作如下事实说明：'],
  ['一句一定会被问到的话：', '关于适用范围，说明如下：'],
  ['一句诚实的话：', '现作事实说明：'],
  ['一句要提前说清的提醒：', '特别说明：'],
  ['一句容易被误读的话：', '为避免歧义，说明如下：'],
  ['一句必须说清的边界：', '特别说明：'],
  ['一句放在最前面的坦白：', '首先说明：'],
  ['两点核验上的坦白：', '关于核验，说明如下：'],
  ['这不是客套话', '该说明具有事实依据'],
  ['不是文字游戏', '并非文字区分'],
  ['我们不藏', '本公司不作隐瞒'],
  ['我们不写', '本文件不作此项表述'],
  ['你能做的补救只有', '可采取的补救措施仅包括'],
  ['请先看它，再看后面任何一条', '应结合该表理解后续条款'],
  ['不要混着读', '不得混同理解'],
  ['别把两个读成同一个旋钮', '不得将两者视为同一事项'],
  ['看一眼', '查阅'],
  ['打得开', '启用'],
  ['安静地结束', '自动终止'],
  ['一句“我们完全符合”帮不了任何人。', '不得以笼统的合规表述替代逐项说明。'],
  ['一句"我们完全符合"帮不了任何人。', '不得以笼统的合规表述替代逐项说明。'],
  ['这句话是假的', '该表述不准确'],
  ['这句话不能写', '本文件不作该项表述'],
  ['我们敢确定地写', '本文件据此明确记载'],
  ['读错', '误解'],
  ['读成', '理解为'],
  ['好听的清单', '概括性表述'],
  ['看不见', '不可读取'],
  ['看得到', '可读取'],
  ['什么都看不到', '不具备读取能力'],
  ['One honest limitation:', 'The following limitation applies:'],
  ['In other words:', 'Accordingly:'],
  ['Please read', 'Users should read'],
  ['do not conflate', 'must not be treated as the same matter'],
  ['We do not hide this:', 'This limitation is expressly disclosed:'],
];

export function formalizeLegalText(value: string): string {
  return FORMAL_WORDING.reduce((current, [from, to]) => current.replaceAll(from, to), value);
}

function sectionNumbers(sections: readonly LegalSection[]): ReadonlyMap<string, string> {
  const numbers = new Map<string, string>();
  const walk = (items: readonly LegalSection[], prefix = ''): void => {
    let nextExtra = Math.max(0, ...items.map((s) => Number(/^s(\d+)/.exec(s.id)?.[1] ?? 0)));
    items.forEach((section, index) => {
      const stable = /^s(\d+[a-z]?)$/.exec(section.id)?.[1];
      const number = prefix ? `${prefix}.${index + 1}` : stable ?? `${++nextExtra}`;
      numbers.set(section.id, number);
      walk(section.subsections ?? [], number);
    });
  };
  walk(sections);
  return numbers;
}

/** 装饰性状态符不承担法律含义；肯定/否定等原有文字完整保留。 */
function plainText(value: string, numbers: ReadonlyMap<string, string>, locale: Locale): string {
  // 代码片段是文档标识、字段或事实示例，不能按普通条款引用改写。
  return value.split(/(`[^`]*`)/g).map((part) => {
    if (part.startsWith('`')) return part;
    return formalizeLegalText(part)
      // 这些符号在原始事实源里曾用来标记状态，但在协议阅读器中会被
      // 误读成产品徽章。统一移除后，由正文中的“停止/受约束/不删除”等
      // 文字承担法律含义；暂停符号也必须走同一规则。
      .replace(/[❌✅🔴⚠📌📍🟡🟢⏸]\uFE0F?\s*/gu, '')
      .replace(/\bs\d+[a-z]?(?:-\d+)?\b/g, (id) => {
        const number = numbers.get(id);
        if (number === undefined) return id;
        return locale === 'zh-CN' ? `第${number}条` : `Section ${number}`;
      });
  }).join('');
}

function presentBlock(block: LegalBlock, text: (value: string) => string): LegalBlock {
  switch (block.kind) {
    case 'p': case 'callout': case 'docRef':
      return { ...block, text: text(block.text) };
    case 'ul': case 'ol':
      return { ...block, items: block.items.map(text) };
    case 'table':
      return { ...block, head: block.head.map(text), rows: block.rows.map((row) => row.map(text)) };
  }
}

/** 九份文档中英同一套编号、引用与文字展示语法，原文与内容块不变。 */
export function legalDocumentPresentation(document: LegalDocument): LegalDocument {
  const presentSections = (locale: Locale): readonly LegalSection[] => {
    const numbers = sectionNumbers(document.sections[locale]);
    const text = (value: string): string => plainText(value, numbers, locale);
    // 后加的条款在源数据中可能排在变更记录之前；阅读顺序按稳定条款号排列。
    // 不按数组位置重编号，否则正文已有的“第十三节”将指向错误条款。
    const ordered = (sections: readonly LegalSection[]): readonly LegalSection[] => [...sections].sort((a, b) => {
      const left = /^s(\d+)([a-z]?)$/.exec(a.id);
      const right = /^s(\d+)([a-z]?)$/.exec(b.id);
      if (left && right) return Number(left[1]) - Number(right[1]) || (left[2] ?? '').localeCompare(right[2] ?? '');
      return left ? -1 : right ? 1 : 0;
    });
    const walk = (sections: readonly LegalSection[]): readonly LegalSection[] => ordered(sections).map((section) => ({
      ...section,
      title: `${numbers.get(section.id)}. ${text(section.title)}`,
      ...(section.blocks ? { blocks: section.blocks.map((block) => presentBlock(block, text)) } : {}),
      ...(section.subsections ? { subsections: walk(section.subsections) } : {}),
    }));
    return walk(document.sections[locale]);
  };
  return {
    ...document,
    summary: {
      'zh-CN': formalizeLegalText(document.summary['zh-CN']),
      en: formalizeLegalText(document.summary.en),
    },
    sections: { 'zh-CN': presentSections('zh-CN'), en: presentSections('en') },
  };
}
