/**
 * 纪念卡片**成品图**的导出契约（W7 · 判据层 A：node/jsdom 判得动的那部分）
 * ======================================================================
 *
 * 🔴 **为什么这一层必须存在，而不是全交给 e2e 那张图**：
 * e2e 量得到的是"最后那张 PNG 的 IHDR 是多少像素、文件叫什么、有没有发请求"。
 * 它量不到"这一行用的是哪个**排版角色**"与"这个颜色是**哪个 token**" ——
 * 而那两个正是 AGENTS §5 三条硬规则管的东西，且 `check:design` 只拦**字面量**，
 * 拦不住"挑错一个 token"（把模板色当文字色，源码里一个裸值都没有）。
 *
 * 另外 jsdom **没有 2D 画布实现**（`getContext('2d')` 直接返回 `null`），
 * 所以这一层判的是 `buildCardExportLayout()` 这个**纯函数**产出的绘制指令。
 * 像素那一半在 `e2e/tests/countdown-export.spec.ts`。
 *
 * 钉住的九条（每条的变异臂与读数在
 * [`docs/plans/countdown-w7-device-export.md`](../../../docs/plans/countdown-w7-device-export.md) §6）：
 *   1. **尺寸来自契约**：版面宽高 == `EXPORT_CARD_SIZE`（测试里不写像素字面量）。
 *   2. **成品图 = UI 的整倍放大**：每条文字指令的 `fontSize`/`lineHeight` 都恰好等于
 *      某个语义排版角色 × `EXPORT_CARD_SCALE` ⇒ 有人给海报另定一套字号就红。
 *   3. **模板色只画在强调条上**：文字颜色只许 `foreground` / `foreground-muted`。
 *   4. **措辞只有一份**：图上每段字逐字等于共享层 `cardTextsFor` 的产物。
 *   5. **日期行是存在性判据**（W5 那条"逾期卡整行不画日期"的形状）。
 *   6. **主题跟着界面走**：换暗色，每条颜色都跟着换。
 *   7. **文件名按码点截断**（非 BMP 字符才能把"按 `.length` 截"照出来）。
 *   8. **文件名对文件系统安全**：非法字符与控制字符剔除。
 *   9. **零网络是扫出来的**，并且同一把尺子喂已知命中的样本必须数得出非零。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { darkTokens, lightTokens, resolveTextStyle } from '@heyta/design-system';
import {
  EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS,
  EXPORT_CARD_SCALE,
  EXPORT_CARD_SIZE,
} from '@heyta/shared-schema';
import { cardTextsFor, type CountdownFace, type EventCard, type EventCardTexts } from '@heyta/ui';
import { describe, expect, it } from 'vitest';

import {
  buildCardExportLayout,
  cardExportFileName,
  cardExportFileStem,
  wrapCardText,
  type CardExportDrawOp,
} from '@heyta/ui';

const CARD: EventCard = {
  id: 'e1',
  title: '上线那天',
  kind: 'countdown',
  declaredKind: null,
  face: 'until',
  days: 12,
  nextDate: { year: 2026, month: 11, day: 14 },
  anchorDate: { year: 2026, month: 11, day: 14 },
  ageDays: undefined,
  isPinned: false,
  isLunar: false,
  isRepeating: false,
  template: 3,
};

/** 宿主的措辞函数（与 `apps/web` 的 `eventBoardLabels` 同一形状，这里只要那三个）。 */
const TEXT_LABELS = {
  faceText: (face: CountdownFace, days: number) =>
    face === 'until' ? `还有 ${String(days)} 天` : `已经 ${String(days)} 天`,
  formatDate: (date: { year: number; month: number; day: number }) =>
    `${String(date.year)}年${String(date.month)}月${String(date.day)}日`,
  ageText: (days: number) => `已经 ${String(days)} 天`,
};

function wordsOf(card: EventCard): EventCardTexts {
  return cardTextsFor(card, TEXT_LABELS);
}

function layoutOf(card: EventCard, words: EventCardTexts, dark = false, rasterScale = EXPORT_CARD_SCALE) {
  const tokens = dark ? darkTokens : lightTokens;
  return buildCardExportLayout({
    texts: words,
    theme: {
      tokens,
      text: {
        'screen-title': resolveTextStyle('screen-title', tokens),
        'section-title': resolveTextStyle('section-title', tokens),
        headline: resolveTextStyle('headline', tokens),
        'row-title': resolveTextStyle('row-title', tokens),
        'row-meta': resolveTextStyle('row-meta', tokens),
        caption: resolveTextStyle('caption', tokens),
        'group-label': resolveTextStyle('group-label', tokens),
        'tab-label': resolveTextStyle('tab-label', tokens),
        'panel-title': resolveTextStyle('panel-title', tokens),
        badge: resolveTextStyle('badge', tokens),
        'numeric-display': resolveTextStyle('numeric-display', tokens),
        'numeric-body': resolveTextStyle('numeric-body', tokens),
      },
    },
    accentColor: tokens['color.primary'],
    dateStem: words.date,
  }, rasterScale);
}

const isText = (op: CardExportDrawOp): boolean => op.kind === 'text';
const textOps = (ops: readonly CardExportDrawOp[]): CardExportDrawOp[] => ops.filter(isText);
const countText = (
  ops: readonly CardExportDrawOp[],
  value: string,
): number => ops.filter((op) => op.text === value).length;

describe('W7 成品图版面：尺寸与排版都来自唯一事实源', () => {
  it('版面尺寸 == 契约的 EXPORT_CARD_SIZE（测试里不出现像素字面量）', () => {
    const layout = layoutOf(CARD, wordsOf(CARD));
    expect({ width: layout.width, height: layout.height }).toEqual(EXPORT_CARD_SIZE);
    // 阳性对照：契约那一对数不是两个独立字面量 —— 高由宽 × 比例推出来。
    expect(EXPORT_CARD_SIZE.height).toBeGreaterThan(EXPORT_CARD_SIZE.width);
  });

  it('每条文字指令的 (字号|行高) 都是某个语义角色 × EXPORT_CARD_SCALE 的结果', () => {
    const tokens = lightTokens;
    const allowed = new Set(
      (
        [
          'screen-title',
          'section-title',
          'headline',
          'row-title',
          'row-meta',
          'caption',
          'group-label',
          'tab-label',
          'panel-title',
          'badge',
          'numeric-display',
          'numeric-body',
        ] as const
      ).map((role) => {
        const style = resolveTextStyle(role, tokens);
        return `${String(style.fontSize * EXPORT_CARD_SCALE)}|${String(
          style.lineHeight * EXPORT_CARD_SCALE,
        )}`;
      }),
    );
    const drawn = textOps(layoutOf(CARD, wordsOf(CARD)).ops);
    expect(drawn.length, '一张成品图至少有标题/天数/日期三行').toBeGreaterThanOrEqual(3);
    for (const op of drawn) {
      const key = `${String(op.fontSize)}|${String(op.lineHeight)}`;
      expect(
        allowed.has(key),
        `(字号|行高)=${key} 不是任何语义角色放大 ${String(EXPORT_CARD_SCALE)} 倍的结果 —— 海报自己定了一套排版`,
      ).toBe(true);
    }
  });

  it('大数字用 numeric-display、标题用 row-title（不是"挑一个大的"）', () => {
    const tokens = lightTokens;
    const ops = layoutOf(CARD, wordsOf(CARD)).ops;
    const byText = new Map(ops.filter(isText).map((op) => [op.text ?? '', op]));
    expect(byText.get(TEXT_LABELS.faceText(CARD.face, CARD.days))?.fontSize).toBe(
      resolveTextStyle('numeric-display', tokens).fontSize * EXPORT_CARD_SCALE,
    );
    expect(byText.get(CARD.title)?.fontSize).toBe(
      resolveTextStyle('row-title', tokens).fontSize * EXPORT_CARD_SCALE,
    );
  });
});

describe('W7 成品图版面：颜色只有 token，模板色不当文字色', () => {
  it('文字指令的颜色只许是 foreground / foreground-muted', () => {
    const tokens = lightTokens;
    const allowed = new Set([tokens['color.foreground'], tokens['color.foreground-muted']]);
    for (const op of textOps(layoutOf(CARD, wordsOf(CARD)).ops)) {
      expect(
        allowed.has(op.color),
        `文字用了 ${String(op.color)}：模板色/分类色当文字色没有被对比度测试覆盖（check:text-color 同一条红线）`,
      ).toBe(true);
    }
  });

  it('accentColor 只出现在矩形上，而且**一定**出现在某一条上（强调条不许整条消失）', () => {
    const accent = lightTokens['color.primary'];
    const ops = layoutOf(CARD, wordsOf(CARD)).ops;
    const withAccent = ops.filter((op) => op.color === accent);
    expect(withAccent.length, '强调条没画出来 ⇒ 图与卡就不是同一张东西').toBeGreaterThanOrEqual(1);
    for (const op of withAccent) expect(op.kind).toBe('rect');
  });

  it('换暗色主题时每条颜色都跟着换（这里没有第二套配色）', () => {
    const words = wordsOf(CARD);
    const light = layoutOf(CARD, words, false).ops;
    const dark = layoutOf(CARD, words, true).ops;
    expect(light.length).toBe(dark.length);
    let changed = 0;
    light.forEach((op, index) => {
      const other = dark[index]!;
      expect(other.text, '两个主题的绘制指令序列必须同构').toBe(op.text);
      if (other.color !== op.color) changed += 1;
    });
    // 亮↔暗至少让背景、卡片底、前景、弱化前景四样变；一样都没变就是有一处把颜色抄成了常量。
    expect(changed, '换主题而图上一个颜色都没变').toBeGreaterThanOrEqual(4);
  });
});

describe('W7 成品图版面：措辞与行数（存在性判据）', () => {
  it('图上每一段字都逐字来自 cardTextsFor，一个多余的字符串都没有', () => {
    const words = wordsOf(CARD);
    const drawn = textOps(layoutOf(CARD, words).ops)
      .map((op) => op.text ?? '')
      .sort();
    expect(drawn).toEqual([words.title, words.face, words.date].sort());
    // 空行在图上是看得见的错位，上面那条按"集合相等"挡不住 `''`，单独判。
    expect(drawn.some((value) => value === ''), '图上出现了空行').toBe(false);
  });

  it('日期行**永远在**；「已经 N 天」只在该有时出现', () => {
    const withAge: EventCard = { ...CARD, ageDays: 400, isRepeating: true };
    const dateText = TEXT_LABELS.formatDate(CARD.nextDate!);
    expect(countText(layoutOf(withAge, wordsOf(withAge)).ops, dateText)).toBe(1);
    expect(countText(layoutOf(CARD, wordsOf(CARD)).ops, dateText)).toBe(1);
    expect(countText(layoutOf(withAge, wordsOf(withAge)).ops, TEXT_LABELS.ageText(400))).toBe(1);
    expect(countText(layoutOf(CARD, wordsOf(CARD)).ops, TEXT_LABELS.ageText(400))).toBe(0);
  });

  it('一次性且已过去的倒数日：没有"下一次"也要画出锚点那一天', () => {
    const past: EventCard = {
      ...CARD,
      face: 'since',
      nextDate: undefined,
      anchorDate: { year: 2020, month: 5, day: 6 },
    };
    expect(countText(layoutOf(past, wordsOf(past)).ops, TEXT_LABELS.formatDate(past.anchorDate))).toBe(
      1,
    );
  });
});

describe('W7 成品图文件名', () => {
  it(`标题段按**码点**截到 ${String(EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS)} 个，且不劈开代理对`, () => {
    // 非 BMP：一个码点 = 两个 UTF-16 单元。按 `.length` 截的实现在这里被照出来。
    const astral = '𐋀'.repeat(EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS + 20);
    const stem = cardExportFileStem(astral);
    expect(Array.from(stem)).toHaveLength(EXPORT_CARD_FILE_STEM_MAX_CODE_POINTS);
    // 劈开代理对会得到一个落单的替换字符 —— 逐字符回读才能确认没有。
    for (const character of Array.from(stem)) expect(character).toBe('𐋀');
    // 阳性对照：短标题不该被截。
    expect(cardExportFileStem('短名字')).toBe('短名字');
  });

  it('文件系统非法字符与控制字符全部剔除；空标题不许产出空串', () => {
    expect(cardExportFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(cardExportFileStem('   ')).toBe('heyta');
    expect(cardExportFileStem('\u0000\u001f坏\u0001名字')).toBe('坏名字');
  });

  it('文件名 = `heyta-<标题>-<日期>.png`', () => {
    const date = TEXT_LABELS.formatDate(CARD.nextDate!);
    expect(cardExportFileName(cardExportFileStem(CARD.title), date)).toBe(
      `heyta-${CARD.title}-${date}.png`,
    );
    // 日期段为空（宿主没给）时不许留一个悬空的分隔符。
    expect(cardExportFileName('名字', '')).toBe('heyta-名字.png');
  });
});

describe('W7 折行：行数上限与卡片同一个数，溢出留省略号', () => {
  /** 每字符 10 单位宽的假画布 —— 让"宽度"这件事在 node 里可判。 */
  const ctx = { measureText: (value: string) => ({ width: Array.from(value).length * 10 }) };

  it('放得下不折；放不下按宽度折；超上限的末行带省略号', () => {
    expect(wrapText(ctx, 'abc', 100, 2)).toEqual(['abc']);
    expect(wrapText(ctx, 'abcd', 30, 2)).toEqual(['abc', 'd']);
    const overflow = wrapText(ctx, 'abcdefghij', 30, 2);
    expect(overflow).toHaveLength(2);
    expect(overflow[1]?.endsWith('…')).toBe(true);
    // 阳性对照：测量真在起作用 —— 同一串给放得下的宽度就**不该折**。
    expect(wrapText(ctx, 'abcdefghij', 100, 2)).toHaveLength(1);
    expect(wrapText(ctx, 'abcdefghij', 60, 2)).toHaveLength(2);
  });

  it('空串与零宽都不产出 `[""]`（那会在图上白占一行）', () => {
    expect(wrapText(ctx, '', 100, 2)).toEqual([]);
    expect(wrapText(ctx, 'abc', 0, 2)).toEqual([]);
  });
});

describe('W7 · 判据④：零网络是**扫出来**的，不是主张的', () => {
  /**
   * 导出这条路径上的源文件：**逐个点名**，不靠目录枚举（目录里混着别人的文件）。
   *
   * 🔴 为什么 web 的测试要扫到 `packages/ui` 与 `apps/mobile`：这一单要证的"零出网"
   * 是**成品图这件事**的，不是 web 这一端的。三端各扫各的 = 每一端都只证明了自己那一截，
   * 而版面/落盘那两截谁都没管。这一条是"非零对照"同一把尺子的取样范围。
   */
  const SOURCES = [
    '../src/features/countdown/card-export.ts',
    '../src/features/countdown/CountdownView.tsx',
    '../../../packages/ui/src/countdown/card-export-layout.ts',
    '../../../packages/ui/src/countdown/EventBoard.tsx',
    '../../../apps/mobile/src/lib/card-export.tsx',
    '../../../apps/mobile/src/lib/card-export-native.ts',
  ];

  /** 只匹配**调用形状**（`fetch(` / `new X` / `.sendBeacon(`），否则注释里提一个词就红。 */
  const NETWORK_CALL = /\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendBeacon\s*\(/gu;
  const hitsOf = (source: string): string[] =>
    [...source.matchAll(NETWORK_CALL)].map((match) => match[0] ?? '');

  it('🔴 尺子先自检：喂一条已知命中的样本必须数得出 4 条', () => {
    expect(
      hitsOf("fetch('/x'); new XMLHttpRequest(); new WebSocket('wss://y'); navigator.sendBeacon('/z', b);"),
    ).toHaveLength(4);
  });

  it('导出路径上的源文件里一个网络调用都没有', () => {
    for (const relative of SOURCES) {
      const file = fileURLToPath(new URL(relative, import.meta.url));
      // 去块注释：文档里写"不 fetch 外链字体"是**说明**，不是调用。
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
      const hits = hitsOf(source);
      expect(hits, `${relative} 里出现了网络调用：${JSON.stringify(hits)}`).toEqual([]);
    }
  });
});
