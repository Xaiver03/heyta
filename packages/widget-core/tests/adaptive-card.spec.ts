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
 * | 四象限标签与域不一致 | 同一个象限在 Windows 与手机上叫不同名字 |
 * | 专注组件画了倒计时 | 组件显示一个**错的**剩余时间（见 `buildFocusCardData`） |
 *
 * 🔴 最后一条尤其重要：**它不会有任何症状**。倒计时看起来是对的，
 * 所以没人会报 bug —— 只能靠一条测试钉着。
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
import type { AdaptiveCardData, AdaptiveCardKind } from '../src/adaptive-card.js';
import type { WidgetPayload } from '../src/contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FIXTURE = join(HERE, '..', 'fixtures', 'v1.golden.plaintext.json');
const TEMPLATES_DIR = join(REPO, 'apps', 'web', 'public', 'widgets');
const DAY = '2026-09-27';

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
  const data = buildAdaptiveCardData(kind, payload, dayStr);
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
  });

  it('四象限：恒定四个槽、标签来自 @heyta/domain、计数与夹具一致', () => {
    const data = buildAdaptiveCardData('quadrant', payload, DAY);
    if (data.kind !== 'quadrant') throw new Error('kind 不对');

    expect(data.slots).toHaveLength(4);
    expect(data.slots.map((slot) => slot.key)).toEqual(['1', '2', '3', '4']);

    // 🔴 标签**必须**等于域里的那一份 —— 这条是在 U11 那个"三个手抄本"问题上
    //    防止出现**第四个**手抄本。这里不是抄，是引用。
    expect(data.slots.map((slot) => slot.label)).toEqual([
      QUADRANT_META[Quadrant.UrgentImportant].label,
      QUADRANT_META[Quadrant.ImportantNotUrgent].label,
      QUADRANT_META[Quadrant.UrgentNotImportant].label,
      QUADRANT_META[Quadrant.Neither].label,
    ]);

    expect(data.slots.map((slot) => slot.count)).toEqual([3, 1, 3, 1]);
    expect(data.slots.map((slot) => slot.isEmpty)).toEqual([false, false, false, false]);
  });

  it('四象限：空槽也出现（模板不做存在性判断）', () => {
    const empty: WidgetPayload = { ...payload, quadrant: {} };
    const data = buildAdaptiveCardData('quadrant', empty, DAY);
    if (data.kind !== 'quadrant') throw new Error('kind 不对');

    expect(data.slots).toHaveLength(4);
    expect(data.slots.every((slot) => slot.isEmpty)).toBe(true);
    // 标签仍然在 —— 空槽也要有标题，否则组件会像渲染坏了
    expect(data.slots[0]!.label).toBe('重要且紧急');
  });

  it('习惯：连续 0 天不显示"连续 0 天"', () => {
    const data = cardData('habits', payload, DAY);
    if (data.kind !== 'habits') throw new Error('kind 不对');

    expect(data.rows.map((row) => row.id)).toEqual(['h_water', 'h_run']);
    expect(data.rows[0]!.streakLabel).toBe('连续 3 天');
    expect(data.rows[0]!.doneLabel).toBe('今天已完成');
    expect(data.rows[1]!.doneLabel).toBe('');

    const zero: WidgetPayload = {
      ...payload,
      habits: [{ id: 'h_x', title: '冥想', doneToday: false, streak: 0 }],
    };
    const zeroData = buildAdaptiveCardData('habits', zero, DAY);
    if (zeroData.kind !== 'habits') throw new Error('kind 不对');
    expect(zeroData.rows[0]!.streakLabel).toBe('');
  });
});

describe('🔴 专注组件不许画倒计时', () => {
  it('active 时只给会话标题与**目标**时长，不给剩余', () => {
    const payload = goldenPayload();
    const data = cardData('focus', payload, DAY);
    if (data.kind !== 'focus') throw new Error('kind 不对');

    expect(data.state).toBe('active');
    expect(data.sessionTitle).toBe('写周报');
    // 夹具里 targetSeconds = 1500 → 25 分钟
    expect(data.targetLabel).toBe('目标 25 分钟');

    // 🔴 整个数据对象里**不能出现**任何与"剩余/秒"有关的东西。
    //    这条断言看起来很笨，但它盯的是一个**没有任何症状**的缺陷：
    //    倒计时画出来是"对的"，所以不会被任何人报上来。
    const json = JSON.stringify(data);
    expect(json).not.toContain('remaining');
    expect(json).not.toContain('720');
    expect(json).not.toContain('秒');
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
    const data = buildAdaptiveCardData('focus', idle, DAY);
    if (data.kind !== 'focus') throw new Error('kind 不对');

    expect(data.state).toBe('idle');
    expect(data.sessionTitle).toBe('');
    expect(data.targetLabel).toBe('');
  });

  it('没有快照 / 过期 → placeholder / stale，且**不留** dayStr 之外的任何信息', () => {
    for (const state of ['placeholder', 'stale'] as const) {
      const data = buildFocusCardFallback(state);
      expect(data.state).toBe(state);
      expect(data.dayStr).toBeNull();
      expect(data.sessionTitle).toBe('');
      expect(data.targetLabel).toBe('');
    }
  });

  it('formatDuration：向上取整、0 与非有限值都给出可读文案', () => {
    expect(formatDuration(1500)).toBe('25 分钟');
    expect(formatDuration(61)).toBe('2 分钟');
    expect(formatDuration(60)).toBe('1 分钟');
    expect(formatDuration(0)).toBe('不到 1 分钟');
    expect(formatDuration(Number.NaN)).toBe('不到 1 分钟');
    expect(formatDuration(-5)).toBe('不到 1 分钟');
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
    const data = buildAdaptiveCardData(kind, payload, DAY);
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
});

describe('🔴 占位态：不知道的时候不能装作知道', () => {
  it.each(ADAPTIVE_CARD_KINDS)('%s 的占位数据是最小但形状完整的', (kind) => {
    const normal = buildAdaptiveCardData(kind, goldenPayload(), DAY);
    const placeholder = buildAdaptiveCardPlaceholder(kind);

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
      expect(buildAdaptiveCardData(kind, payload, DAY).showPlaceholder).toBe(false);
    }
  });

  it('stale 不是占位 —— 它有自己的文案', () => {
    // 快照过期时说"打开 Heyta 以显示小组件"是错的：应用**已经**打开过了，
    // 用户会去重装应用。过期要说"数据已过期，打开 Heyta 刷新"。
    expect(buildFocusCardFallback('stale').showPlaceholder).toBe(false);
    expect(buildFocusCardFallback('placeholder').showPlaceholder).toBe(true);
  });

  it.each(ADAPTIVE_CARD_KINDS)('%s 的模板有占位文案、且真实内容被 showPlaceholder 挡住', (kind) => {
    const json = JSON.stringify(ADAPTIVE_CARD_TEMPLATES[kind]);
    // 四款都必须有那句占位文案 —— 漏掉一款，登出之后那一款还在显示旧任务
    expect(json).toContain('打开 Heyta 以显示小组件');
    // 真实内容整块被挡在 `!showPlaceholder` 后面
    expect(json).toContain('${!showPlaceholder}');
  });
});
