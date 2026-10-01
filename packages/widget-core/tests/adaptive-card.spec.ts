/**
 * Windows（PWA widget）的 Adaptive Card 数据与模板。
 *
 * ## 这些测试盯的是什么
 *
 * Windows 这条路的缺陷**在开发机上完全看不见** —— 组件只在 Edge 里渲染，
 * 而本机没有 Windows。所以能自动化的部分必须自动化到底：
 *
 * | 缺陷 | 在这里的表现 |
 * |---|---|
 * | 数据字段与模板对不上 | 模板里出现 `${xxx}` 字面量，而**没有任何报错** |
 * | 磁盘上的模板文件过期 | 改了数据形状但没重新生成 → 组件空白 |
 * | 模板里混进了一句文案 | 换语言时**改不到**（宿主直接取那个静态文件，不经过我们的 JS） |
 * | 构建器里写死了一句中文 | 英文用户的组件仍显示中文，且**没有任何报错** |
 * | 专注组件画了倒计时 | 组件显示一个**错的**剩余时间（见 `buildFocusCardData`） |
 *
 * 🔴 最后两条尤其重要：**它们都不会有症状**。倒计时看起来是对的，写死的中文
 * 在中文界面上看起来是对的 —— 只能靠测试钉着。
 *
 * ## 🔴 为什么这里的 `t` 是「键回执」而不是真词条
 *
 * 本包**不依赖 `@heyta/i18n`**（`check:widgets` 有一条规则管着它的依赖面），
 * 而断言里如果抄一份中文文本，就又造出了一个**文案的第二事实源** ——
 * 那正是 i18n 这一轮要消灭的东西。
 *
 * 所以这里的 `t` 把 `(key, vars)` 原样回显成 `key|{"…":…}`。好处是断言变得
 * **比字符串更精确**：它钉的是"用了哪条词条、带了什么变量"，
 * 而不是"最后显示成什么字"。真词条的渲染（中/英各一版、key 是否真的存在于表里）
 * 钉在 `apps/web/tests/widget-card-copy.spec.ts` —— 那里可以 import `@heyta/i18n`。
 *
 * 全部数据都从**与 iOS / Android 同一份** `v1.golden.plaintext.json` 构建。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUADRANT_META, Quadrant } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  ADAPTIVE_CARD_KINDS,
  ADAPTIVE_CARD_TEMPLATES,
  ADAPTIVE_CARD_VERSION,
  buildAdaptiveCardData,
  buildAdaptiveCardPlaceholder,
  buildFocusCardFallback,
  formatDuration,
  serializeAdaptiveCardTemplates,
} from '../src/adaptive-card.js';
import { parsePayload } from '../src/contract.js';
import type {
  AdaptiveCardData,
  AdaptiveCardKind,
  WidgetCardKey,
  WidgetTranslate,
} from '../src/adaptive-card.js';
import type { WidgetPayload } from '../src/contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FIXTURE = join(HERE, '..', 'fixtures', 'v1.golden.plaintext.json');
const TEMPLATES_DIR = join(REPO, 'apps', 'web', 'public', 'widgets');
const DAY = '2026-09-27';

/**
 * 汉字 + CJK 标点 + 全角字符。
 *
 * ⚠️ 口径与 `scripts/check-ui-language.mjs` 的 `CJK` 一致（含 `，：` 这类全角标点）——
 * 只判 `[一-龥]` 的话，一句 `"今天：没有任务"` 会溜过去。
 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

/** 键回执式翻译：断言"用了哪条词条 + 什么变量"，而不是抄一份文本。 */
const probe: WidgetTranslate = (key, vars) =>
  vars === undefined ? key : `${key}|${JSON.stringify(vars)}`;

/** 夹具原样 → 走真解析器 → 载荷。**不手写对象**：手写就测不到契约本身。 */
function goldenPayload(): WidgetPayload {
  const raw: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const parsed = parsePayload(raw);
  if (!parsed.ok) {
    throw new Error(`黄金夹具没通过 parsePayload：${parsed.reason} / ${parsed.detail}`);
  }
  return parsed.payload;
}

/**
 * 夹具的**纯 ASCII 变体**：把用户数据里的中文换掉，其余一字不改。
 *
 * 🔴 这一份存在的理由只有一个：让"数据里不许出现汉字"这条断言**有意义**。
 * 用原夹具跑，任务标题（`交房租`）本身就是中文，那条断言会恒红；
 * 而把标题换成 ASCII 后，数据里剩下的任何中文都**只可能来自代码**。
 */
function asciiPayload(): WidgetPayload {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  const ascii = JSON.stringify(raw).replace(/[\u3400-\u4DBF\u4E00-\u9FFF]+/g, 'title');
  const parsed = parsePayload(JSON.parse(ascii));
  if (!parsed.ok) throw new Error(`ASCII 变体没通过 parsePayload：${parsed.reason}`);
  return parsed.payload;
}

/**
 * 窄化到某一款的数据。
 *
 * `buildAdaptiveCardData` 返回的是**四款的联合类型**（这样调用方必须显式说明
 * 自己要哪一款，而不是拿到一个"什么字段都可能有"的对象）。测试里同样要窄化 ——
 * 这是**好事**：它让"我在测今日任务却读了 habits 的字段"变成编译错误。
 */
function cardData<K extends AdaptiveCardKind>(
  kind: K,
  payload: WidgetPayload,
  dayStr: string,
): Extract<AdaptiveCardData, { kind: K }> {
  const data = buildAdaptiveCardData(kind, payload, dayStr, probe);
  if (data.kind !== kind) {
    throw new Error(`期望 ${kind} 的数据，拿到 ${data.kind}`);
  }
  return data as Extract<AdaptiveCardData, { kind: K }>;
}

describe('Adaptive Card 数据 —— 由黄金夹具驱动', () => {
  const payload = goldenPayload();

  it('今日任务：6 行、顺序与夹具一致、完成态正确', () => {
    const data = cardData('today', payload, DAY);

    expect(data.kind).toBe('today');
    expect(data.dayStr).toBe(DAY);
    expect(data.count).toBe(6);
    expect(data.isEmpty).toBe(false);
    expect(data.rows.map((row) => row.id)).toEqual([
      't_rent',
      't_write_report',
      't_fix_incident',
      't_buy_tape',
      't_photo',
      't_milk',
    ]);
    expect(data.rows[0]!.title).toBe('交房租');
    // 最后一条在夹具里 isDone: true
    expect(data.rows[5]!.done).toBe(true);
    expect(data.rows[5]!.targetIsDone).toBe(false);
    // 其余都是未完成 → 点击后应写回 true
    expect(data.rows[0]!.targetIsDone).toBe(true);
  });

  it('今日任务的三句文案各自落到**指定的那一条词条**（不是同一条复用）', () => {
    const data = cardData('today', payload, DAY);
    expect(data.titleText).toBe('widget.today.title');
    expect(data.countText).toBe('widget.today.count|{"count":6}');
    expect(data.emptyText).toBe('widget.today.empty');
    expect(data.placeholderText).toBe('widget.placeholder.openApp');
  });

  it('🔴 完成态同时决定视觉与点击目标，两者不能各算各的', () => {
    const data = cardData('today', payload, DAY);
    for (const row of data.rows) {
      // 视觉（勾掉 + 绿色）与"点击要写回什么"必须由同一个 done 派生
      expect(row.strikethrough).toBe(row.done);
      expect(row.style).toBe(row.done ? 'good' : 'default');
      expect(row.targetIsDone).toBe(!row.done);
    }
  });

  it('今日任务为空时 isEmpty 为 true（模板靠它显示"今天没有任务"）', () => {
    const empty: WidgetPayload = { ...payload, today: [] };
    const data = cardData('today', empty, DAY);
    expect(data.count).toBe(0);
    expect(data.isEmpty).toBe(true);
    expect(data.rows).toEqual([]);
    // 计数那句仍然要算 —— 空态显示的是 `emptyText`，但 `count` 变量也得是 0，
    // 否则将来有人把模板改成"两句都显示"时会念出 6。
    expect(data.countText).toBe('widget.today.count|{"count":0}');
  });

  it('四象限：恒定四个槽、键序 1..4、计数与夹具一致', () => {
    const data = cardData('quadrant', payload, DAY);

    expect(data.slots).toHaveLength(4);
    expect(data.slots.map((slot) => slot.key)).toEqual(['1', '2', '3', '4']);
    expect(data.slots.map((slot) => slot.count)).toEqual([3, 1, 3, 1]);
    expect(data.slots.map((slot) => slot.isEmpty)).toEqual([false, false, false, false]);
  });

  it('🔴 四象限的槽序与 `QUADRANT_META` 是同一个顺序（不许各排各的）', () => {
    const data = cardData('quadrant', payload, DAY);
    const canonical = [
      Quadrant.UrgentImportant,
      Quadrant.ImportantNotUrgent,
      Quadrant.UrgentNotImportant,
      Quadrant.Neither,
    ].map(String);

    // 这里钉的是**顺序与身份**；钉**文本**（词条 === `QUADRANT_META.label`）在
    // `apps/web/tests/widget-card-copy.spec.ts` —— 那边才拿得到真词条。
    expect(data.slots.map((slot) => slot.key)).toEqual(canonical);
    expect(QUADRANT_META[Quadrant.UrgentImportant].label).toBe('重要且紧急');
  });

  it('四象限：标签与说明各自走指定词条，整句标题由 `slotHeading` 拼', () => {
    const data = cardData('quadrant', payload, DAY);

    expect(data.titleText).toBe('widget.quadrant.title');
    expect(data.slots.map((slot) => slot.label)).toEqual([
      'web.quadrant.q1',
      'web.quadrant.q2',
      'web.quadrant.q3',
      'web.quadrant.q4',
    ]);
    expect(data.slots.map((slot) => slot.hint)).toEqual([
      'widget.quadrant.hint1',
      'widget.quadrant.hint2',
      'widget.quadrant.hint3',
      'widget.quadrant.hint4',
    ]);
    expect(data.slots[0]!.heading).toBe(
      'widget.quadrant.slotHeading|{"label":"web.quadrant.q1","count":3}',
    );
  });

  it('四象限：空槽也出现（模板不做存在性判断）', () => {
    const empty: WidgetPayload = { ...payload, quadrant: {} };
    const data = cardData('quadrant', empty, DAY);

    expect(data.slots).toHaveLength(4);
    expect(data.slots.every((slot) => slot.isEmpty)).toBe(true);
    // 标签仍然在 —— 空槽也要有标题，否则组件会像渲染坏了
    expect(data.slots[0]!.label).toBe('web.quadrant.q1');
    expect(data.slots[0]!.heading).toBe(
      'widget.quadrant.slotHeading|{"label":"web.quadrant.q1","count":0}',
    );
  });

  it('习惯：连续 0 天不显示"连续 0 天"', () => {
    const data = cardData('habits', payload, DAY);

    expect(data.titleText).toBe('widget.habits.title');
    expect(data.rows.map((row) => row.id)).toEqual(['h_water', 'h_run']);
    expect(data.rows[0]!.streakLabel).toBe('web.habits.streak.current|{"count":3}');
    expect(data.rows[0]!.doneLabel).toBe('widget.habits.doneToday');
    expect(data.rows[1]!.doneLabel).toBe('');

    const zero: WidgetPayload = {
      ...payload,
      habits: [{ id: 'h_x', title: '冥想', doneToday: false, streak: 0 }],
    };
    const zeroData = cardData('habits', zero, DAY);
    expect(zeroData.rows[0]!.streakLabel).toBe('');
    expect(zeroData.emptyText).toBe('widget.habits.empty');
  });

  it('🔴 连续 1 天必须走 `…One` 那条 —— 否则英文念出 "1 days"', () => {
    // 复用 `web.habits.streak.*`（而不是另起一条 `widget.*` 同义句）的理由：
    // 英文单复数那道门禁是**按命名空间前缀**扫的，换个名字就逃出了它的视野。
    const one: WidgetPayload = {
      ...payload,
      habits: [{ id: 'h_x', title: 'x', doneToday: false, streak: 1 }],
    };
    const data = cardData('habits', one, DAY);
    expect(data.rows[0]!.streakLabel).toBe('web.habits.streak.currentOne|{"count":1}');

    const many = cardData('habits', { ...one, habits: [{ id: 'h_x', title: 'x', doneToday: false, streak: 2 }] }, DAY);
    expect(many.rows[0]!.streakLabel).toBe('web.habits.streak.current|{"count":2}');
  });
});

describe('🔴 专注组件不许画倒计时', () => {
  it('active 时只给会话标题与**目标**时长，不给剩余', () => {
    const payload = goldenPayload();
    const data = cardData('focus', payload, DAY);

    expect(data.state).toBe('active');
    expect(data.sessionTitle).toBe('写周报');
    // 夹具里 targetSeconds = 1500 → 25 分钟
    expect(data.targetLabel).toBe(
      'widget.focus.target|{"duration":"widget.focus.minutes|{\\"minutes\\":25}"}',
    );

    // 🔴 整个数据对象里**不能出现**任何与"剩余/秒"有关的东西。
    //    这条断言看起来很笨，但它盯的是一个**没有任何症状**的缺陷：
    //    倒计时画出来是"对的"，所以不会被任何人报上来。
    const json = JSON.stringify(data);
    expect(json).not.toContain('remaining');
    expect(json).not.toContain('720');
  });

  it('模板里也没有 remaining 的绑定', () => {
    // 数据里没有、模板里却绑了 → 组件显示字面量 `${remainingSeconds}`。
    // 上半条测试只看数据，这条看模板，两条合起来才封住这个洞。
    expect(JSON.stringify(ADAPTIVE_CARD_TEMPLATES.focus)).not.toContain('remaining');
  });

  it('active 为 false → idle（不能因为快照里还有别的字段就说"专注中"）', () => {
    const payload = goldenPayload();
    const idle: WidgetPayload = {
      ...payload,
      focus: { ...payload.focus, active: false },
    };
    const data = cardData('focus', idle, DAY);

    expect(data.state).toBe('idle');
    expect(data.sessionTitle).toBe('');
    expect(data.targetLabel).toBe('');
    // 四句状态文案**都在**数据里（模板靠 `isVisible` 选一句），
    // 所以 idle 态也带着 stale 那句 —— 它被挡住，不是不存在。
    expect(data.staleText).toBe('widget.focus.stale');
    expect(data.idleText).toBe('widget.focus.idle');
  });

  it('没有快照 / 过期 → placeholder / stale，且**不留** dayStr 之外的任何信息', () => {
    for (const state of ['placeholder', 'stale'] as const) {
      const data = buildFocusCardFallback(state, probe);
      expect(data.state).toBe(state);
      expect(data.dayStr).toBeNull();
      expect(data.sessionTitle).toBe('');
      expect(data.targetLabel).toBe('');
    }
  });

  it('formatDuration：向上取整', () => {
    expect(formatDuration(1500, probe)).toBe('widget.focus.minutes|{"minutes":25}');
    expect(formatDuration(61, probe)).toBe('widget.focus.minutes|{"minutes":2}');
    expect(formatDuration(60, probe)).toBe('widget.focus.minutes|{"minutes":1}');
    expect(formatDuration(1, probe)).toBe('widget.focus.minutes|{"minutes":1}');
  });
});

describe('🔴 模板与数据不能漂移', () => {
  /**
   * 收集模板里所有**简单标识符**绑定（`${name}`），不含表达式（`${a == 'b'}`）。
   *
   * 表达式故意跳过：它们引用的是模板自己的绑定作用域，
   * 静态判断不了，硬判会得到假阳性 —— 而假阳性会让这条测试被人关掉。
   */
  function collectBindings(node: unknown, out: Set<string> = new Set()): Set<string> {
    if (typeof node === 'string') {
      for (const match of node.matchAll(/\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g)) {
        out.add(match[1]!);
      }
      return out;
    }
    if (Array.isArray(node)) {
      for (const item of node) collectBindings(item, out);
      return out;
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) collectBindings(value, out);
    }
    return out;
  }

  it.each(ADAPTIVE_CARD_KINDS)('%s：模板绑的每个字段在数据里都存在', (kind) => {
    const payload = goldenPayload();
    const data = buildAdaptiveCardData(kind, payload, DAY, probe);
    // 用序列化后的文本判断"字段存在" —— 嵌套在数组里的行字段也能被覆盖
    const dataJson = JSON.stringify(data);

    const missing = [...collectBindings(ADAPTIVE_CARD_TEMPLATES[kind])].filter((name) => {
      // 顶层键 或 出现在任何一行/槽里
      return !(name in data) && !dataJson.includes(`"${name}"`);
    });

    expect(
      missing,
      `模板引用了数据里没有的字段：${missing.join('、')} —— ` +
        `组件会显示字面量 \${${missing[0] ?? ''}}，且没有任何报错`,
    ).toEqual([]);
  });

  it.each(ADAPTIVE_CARD_KINDS)('%s：模板是合法 JSON 且版本号是 1.5', (kind) => {
    const template = ADAPTIVE_CARD_TEMPLATES[kind];
    expect(template.type).toBe('AdaptiveCard');
    // 版本写高了不会报错，只会让组件在某些宿主版本上整个渲染不出来
    expect(template.version).toBe(ADAPTIVE_CARD_VERSION);
    expect(ADAPTIVE_CARD_VERSION).toBe('1.5');
    expect(() => JSON.parse(JSON.stringify(template))).not.toThrow();
  });
});

describe('🔴 模板里不许有一个字的文案（i18n P1-3）', () => {
  /**
   * `ms_ac_template` 是**一个静态 URL**：组件宿主自己去取，不经过我们的 JS，
   * 也拿不到任何 locale 信号。所以模板对全部语言只能是同一份 ——
   * 里面每写死一个字，那句话就**永远不会被翻译**。
   *
   * ⚠️ 这里查的是**代码里的模板对象**，磁盘上那四份 JSON 由下面那组测试查。
   *    两处都要查：只查磁盘的话，改了代码没重新生成就会漏掉（而那正是漂移的形状）。
   */
  it.each(ADAPTIVE_CARD_KINDS)('%s 的模板序列化后不含汉字', (kind) => {
    const json = JSON.stringify(ADAPTIVE_CARD_TEMPLATES[kind]);
    const hit = json.match(new RegExp(`${CJK.source}[^",]*`));
    expect(
      hit,
      `模板里写死了文案「${hit?.[0] ?? ''}」 —— 它对所有语言都会是这一句。` +
        '正确做法：把那句话放进**数据**（`build*CardData` 里 `t(key)`），模板只写绑定。',
    ).toBeNull();
  });

  it('四款的可见文本全部是绑定（`${…}`）或平台枚举', () => {
    // 汉字之外再钉一层：`text:` 不许是裸字符串。
    // 裸 `"·"` 这种**非文案**的排印符号是唯一例外（它不是任何语言里的"话"）。
    const offenders: string[] = [];
    const walk = (node: unknown, where: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${where}[${String(i)}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'text' && typeof value === 'string') {
          if (!value.startsWith('${') && value !== '·') offenders.push(`${where}.text = ${value}`);
          continue;
        }
        walk(value, `${where}.${key}`);
      }
    };
    for (const kind of ADAPTIVE_CARD_KINDS) walk(ADAPTIVE_CARD_TEMPLATES[kind], kind);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 构建器里不许写死文案', () => {
  it('用纯 ASCII 的用户数据构建时，四款数据里出现不了汉字', () => {
    // 把用户数据换成 ASCII 之后，数据里剩下的每一个汉字都**只可能来自代码**：
    // 写死一句 `titleText: '今日任务'` 立刻在这里红。
    const payload = asciiPayload();
    const states: AdaptiveCardData[] = [
      ...ADAPTIVE_CARD_KINDS.map((kind) => buildAdaptiveCardData(kind, payload, DAY, probe)),
      ...ADAPTIVE_CARD_KINDS.map((kind) => buildAdaptiveCardPlaceholder(kind, probe)),
      buildFocusCardFallback('stale', probe),
    ];
    for (const data of states) {
      const json = JSON.stringify(data);
      expect(CJK.test(json), `数据里出现了汉字：${json.slice(0, 200)}`).toBe(false);
    }
  });

  it('探针回显出来的每一个字符串都是 `词条key` 或 `词条key|{vars}`', () => {
    // 这一条把上一条**反过来**钉一次：不只是"没有中文"，
    // 而是"界面文案字段确实走的是词条"。写死一句英文也能从这里被抓出来。
    const payload = asciiPayload();
    const data = buildAdaptiveCardData('today', payload, DAY, probe);
    // 🔴 先断**前提**：返回类型是联合，`titleText` / `countText` 不是每个成员都有
    //    （focus 无 titleText、quadrant 无 countText）。前提不成立时这条判据会
    //    退化成"什么都没测"，所以这里宁可红，也不要静默跳过。
    if (!('titleText' in data) || !('countText' in data)) {
      throw new Error('today 卡的数据里没有 titleText/countText —— 这条判据的前提不成立');
    }
    expect(data.titleText).toMatch(/^[a-z][\w-]*(?:\.[\w-]+)+(?:\{.*\})?$/);
    expect(data.countText).toMatch(/^widget\.today\.count\|\{"count":\d+\}$/);
  });
});

describe('词条 key 联合 ↔ 真实使用（双向）', () => {
  /**
   * 🔴 这是一份**手抄的快照**，不是从类型推出来的（类型在运行时不存在）。
   *
   * 为什么手抄反而是有价值的：`WidgetCardKey` 加一条而没人用它 → 这里红；
   * 构建器里用了一条没登记的 → 编译期红（`WidgetTranslate` 的形参就是那个联合）。
   * 与 `packages/ui/tests/auth-model.spec.ts` 的 `ALL_REASONS` 同一个理由 ——
   * **自动跟随会让"看一眼这条新词条该说什么话"这个决定消失。**
   */
  const DECLARED: WidgetCardKey[] = [
    'widget.placeholder.openApp',
    'widget.today.title',
    'widget.today.count',
    'widget.today.empty',
    'widget.quadrant.title',
    'widget.quadrant.slotHeading',
    'widget.quadrant.hint1',
    'widget.quadrant.hint2',
    'widget.quadrant.hint3',
    'widget.quadrant.hint4',
    'web.quadrant.q1',
    'web.quadrant.q2',
    'web.quadrant.q3',
    'web.quadrant.q4',
    'widget.habits.title',
    'widget.habits.empty',
    'widget.habits.doneToday',
    'web.habits.streak.current',
    'web.habits.streak.currentOne',
    'widget.focus.stale',
    'widget.focus.idle',
    'widget.focus.target',
    'widget.focus.minutes',
  ];

  /** 把四款 + 四种状态全跑一遍，收集真正被用到的 key。 */
  function usedKeys(): Set<string> {
    const out = new Set<string>();
    const KEY_SHAPE = /^[a-z][\w-]*(?:\.[\w-]+)+$/;

    /**
     *  peel 出探针的形状 `key|{json}`。
     *
     * 🔴 必须**递归**：`widget.focus.minutes` 是**嵌在** `widget.focus.target`
     * 的 `duration` 变量里的（`formatDuration` 先算一句再当变量传进去）。
     * 只按外层切一刀的话，那条 key 看起来"从来没被用过"，
     * 于是"死词条"这条判据会**指着一个真的在用着的 key 报红**。
     */
    const collectString = (value: string): void => {
      const bar = value.indexOf('|{');
      const head = bar === -1 ? value : value.slice(0, bar);
      if (KEY_SHAPE.test(head)) out.add(head);
      if (bar === -1) return;
      let vars: unknown;
      try {
        vars = JSON.parse(value.slice(bar + 1));
      } catch {
        return;
      }
      collect(vars);
    };

    const collect = (node: unknown): void => {
      if (typeof node === 'string') {
        collectString(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) collect(item);
        return;
      }
      if (node && typeof node === 'object') {
        for (const value of Object.values(node)) collect(value);
      }
    };
    const payload = asciiPayload();
    const cases: WidgetPayload[] = [
      payload,
      // 连续 1 天（`…One`）与 0 天
      { ...payload, habits: [{ id: 'h', title: 'x', doneToday: true, streak: 1 }] },
      { ...payload, habits: [{ id: 'h', title: 'x', doneToday: false, streak: 0 }] },
      // 今日 / 习惯为空
      { ...payload, today: [], habits: [] },
      // 专注三态
      { ...payload, focus: { ...payload.focus, active: false } },
      { ...payload, focus: { ...payload.focus, active: true, targetSeconds: 0 } },
      { ...payload, focus: undefined },
    ];
    for (const p of cases) {
      for (const kind of ADAPTIVE_CARD_KINDS) collect(buildAdaptiveCardData(kind, p, DAY, probe));
    }
    for (const kind of ADAPTIVE_CARD_KINDS) collect(buildAdaptiveCardPlaceholder(kind, probe));
    collect(buildFocusCardFallback('stale', probe));
    return out;
  }

  it('联合里声明的每一条都**真的会被用到**（没有只登记不渲染的死词条）', () => {
    const used = usedKeys();
    const dead = DECLARED.filter((key) => !used.has(key));
    expect(dead, `这些 key 在任何状态下都不会出现在卡片上：${dead.join('、')}`).toEqual([]);
  });

  it('卡片上用到的每一条都在联合里（没有绕过类型偷用的）', () => {
    const declared = new Set<string>(DECLARED);
    const stray = [...usedKeys()].filter((key) => !declared.has(key));
    expect(stray, `数据里出现了没登记的词条：${stray.join('、')}`).toEqual([]);
  });
});

describe('磁盘上的模板文件与代码一致（生成物漂移锁）', () => {
  const rebuilt = serializeAdaptiveCardTemplates();

  it('四份文件都在', () => {
    expect(Object.keys(rebuilt).sort()).toEqual([
      'focus.json',
      'habits.json',
      'quadrant.json',
      'today.json',
    ]);
  });

  it.each(Object.keys(serializeAdaptiveCardTemplates()))('%s 逐字节等于重新生成的结果', (name) => {
    let committed: string;
    try {
      committed = readFileSync(join(TEMPLATES_DIR, name), 'utf8');
    } catch {
      throw new Error(
        `模板文件 apps/web/public/widgets/${name} 不存在。重建：\n` +
          '  pnpm --filter @heyta/widget-core build && pnpm --filter @heyta/widget-core gen:adaptive-cards',
      );
    }

    expect(
      committed === rebuilt[name],
      `apps/web/public/widgets/${name} 与代码不一致。重建：\n` +
        '  pnpm --filter @heyta/widget-core build && pnpm --filter @heyta/widget-core gen:adaptive-cards\n' +
        '⚠️ 重建后看一眼 diff —— 如果变化不是你有意造成的，那是 bug 不是模板过期。',
    ).toBe(true);
  });

  it.each(Object.keys(serializeAdaptiveCardTemplates()))('%s 落盘的字节里不含汉字', (name) => {
    // 上面那条只保证"磁盘 == 代码"。这一条保证"磁盘 == 可翻译的形状"。
    // 两条都要：代码里混进中文而没重新生成时，漂移锁红；生成之后，这条红。
    const text = readFileSync(join(TEMPLATES_DIR, name), 'utf8');
    expect(CJK.test(text), `${name} 里有汉字，换语言改不到`).toBe(false);
  });
});

describe('🔴 占位态：不知道的时候不能装作知道', () => {
  it.each(ADAPTIVE_CARD_KINDS)('%s 的占位数据是最小但形状完整的', (kind) => {
    const normal = buildAdaptiveCardData(kind, goldenPayload(), DAY, probe);
    const placeholder = buildAdaptiveCardPlaceholder(kind, probe);

    // ① kind 必须对 —— 用一款的占位数据去填另一款，模板绑定的字段一个都对不上，
    //    组件会显示一堆空白，而且**只在 Windows 上看得见**
    expect(placeholder.kind).toBe(kind);
    expect(placeholder.showPlaceholder).toBe(true);

    // ② 键集合必须与正常数据**完全一致**。少一个键，模板里那条绑定就会
    //    渲染成字面量 `${x}`；多一个键说明有人改了正常数据却忘了占位数据。
    expect(Object.keys(placeholder).sort()).toEqual(Object.keys(normal).sort());
  });

  it('正常构建出来的数据 showPlaceholder 一律为 false', () => {
    const payload = goldenPayload();
    for (const kind of ADAPTIVE_CARD_KINDS) {
      expect(buildAdaptiveCardData(kind, payload, DAY, probe).showPlaceholder).toBe(false);
    }
  });

  it('stale 不是占位 —— 它有自己的文案', () => {
    // 快照过期时说"打开 Heyta 以显示小组件"是错的：应用**已经**打开过了，
    // 用户会去重装应用。过期要说"数据已过期，打开 Heyta 刷新"。
    expect(buildFocusCardFallback('stale', probe).showPlaceholder).toBe(false);
    expect(buildFocusCardFallback('placeholder', probe).showPlaceholder).toBe(true);
    expect(buildFocusCardFallback('stale', probe).staleText).toBe('widget.focus.stale');
  });

  it.each(ADAPTIVE_CARD_KINDS)('%s 的模板有占位绑定、且真实内容被 showPlaceholder 挡住', (kind) => {
    const json = JSON.stringify(ADAPTIVE_CARD_TEMPLATES[kind]);
    // 四款都必须绑那句占位文案 —— 漏掉一款，登出之后那一款还在显示旧任务。
    // ⚠️ 断的是**绑定**而不是文本：文案在数据里（见"模板里不许有一个字的文案"）。
    expect(json).toContain('${placeholderText}');
    // 真实内容整块被挡在 `!showPlaceholder` 后面
    expect(json).toContain('${!showPlaceholder}');
  });
});
