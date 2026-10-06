/**
 * 法务条款第三节那张「逐功能、逐字段」的表 ↔ 代码真正披露出去的 `fields` 对账
 * ==========================================================================
 *
 * ## 为什么要有这个文件（它不是"多测一遍披露"）
 *
 * `packages/legal/src/documents/ai-and-transfer.ts` 第三节开头写的是封闭句式：
 *
 * > 下表是**全部**出境面。……每一个 AI 功能各自只喂这几列里的字段。
 *
 * 而 s9 的第一条触发写得更明白：**加任何一个新的出境字段，那张表必须先扩、再上线。**
 * 这句话今天靠人记 —— 而本仓库已经吃过两次同一类账（`check:legal-tools` 那条：
 * 「文档里出现『未列出即视为未授权』这类封闭句式，它指的那个集合就必须有一条对账门禁，
 * 否则句式本身就是一个会悄悄烂掉的断言」）。W4 往三条链路加 `today` 正好踩在这条线上：
 * 代码里加一个字段名只是**一行 `fields.push`**，代码评审看不见它，
 * `check:legal-copy` 也看不见（它只比生成物与真源）。
 *
 * ## 三条判据分别挡什么
 *
 *   1. **代码的字段集合 == 表里声明的字段集合**（逐功能、逐序）。
 *      少一行 = 对用户少说一项；多一行 = 条款承诺了代码没送的东西（也是说谎）。
 *   2. **中英两版逐行同序**。集合相等挡不住"行贴错对象"，
 *      而中英漂移在页面上**看不出来**（少一列读起来仍然通顺）。
 *   3. **阳性对照**：分母必须真的数得出那 5 行。一条都没扫到 = 探针坏了，
 *      不是文案干净（§7 元规则二）。
 *
 * ⚠️ **作用面边界（别读多）**：本文件只核对**四个 `buildXxxInvocation` 功能**。
 * 「工具选择」那一行只核对 `today` 在不在 —— 它的完整字段集合是
 * `assistantEgressFields()`（按授权档位从工具目录推导），那张表住在第六节，
 * 由 `check:legal-tools` 逐条对账，不在这里重复一遍第二套口径。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderPreferenceHints, type PreferenceSet } from '@heyta/domain';

import {
  buildBreakdownInvocation,
  buildCaptureInvocation,
  buildDurationInvocation,
  buildPrioritizeInvocation,
  type PrioritizeTaskInput,
} from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `packages/app-host/tests` → 仓库根（上三级）。 */
const DOC_PATH = path.resolve(HERE, '../../../packages/legal/src/documents/ai-and-transfer.ts');
const DOC = readFileSync(DOC_PATH, 'utf8');

const ZH_HEAD = "head: ['功能', '出境的字段', '发出去的是什么', '上限'],";
const EN_HEAD = "head: ['Feature', 'Fields that leave', 'What is actually sent', 'Cap'],";

/** 每一行都在**同一行**上写完整（表格行里的换行会让解析器读到半行 —— 那条也钉住）。 */
const ROW = /^\s*\['([^']+)',\s*'([^']+)',/gm;

/**
 * 「可选」标记。
 *
 * 🔴 **不许加 `\\b`**：JS 的 `\\w` 不含汉字，`可选 ` 里"选"和空格都是非字符，
 * 中间根本没有词边界 —— 加了 `\\b` 的结果是中文那一列**永远匹配不上**，
 * 于是 `可选 note` 被读成必填，整张表的中文侧解析出一个假的字段集合。
 * （第一版就是这么坏的，被"中英两版同一行"那条抓出来。）
 */
const OPTIONAL_WORD = /^(?:可选|optionally)/;

function tableRows(headLiteral: string): { label: string; cell: string }[] {
  const at = DOC.indexOf(headLiteral);
  expect(at, `条款里找不到那张表的表头：${headLiteral}`).toBeGreaterThan(-1);
  const rowsAt = DOC.indexOf('rows: [', at);
  expect(rowsAt, '表头之后找不到 rows: [').toBeGreaterThan(-1);
  const block = DOC.slice(rowsAt, DOC.indexOf('\n        ],', rowsAt));
  const rows = [...block.matchAll(ROW)].map((m) => ({ label: m[1] as string, cell: m[2] as string }));
  // 🔴 阳性对照：分母。这一句坏了，下面所有"零违规"都什么都不是。
  expect(rows, `那张表应当有 5 行，实际数出 ${String(rows.length)} 行`).toHaveLength(5);
  return rows;
}

/**
 * 单元格里的字段名：反引号包住。
 *
 * ⚠️ 那张表的写法约定是**必发的在前、可选的在后**，而「可选」只管到它后面那几格
 * （中文写的是 `可选 \`note\`、\`history\``，英文是 `optionally \`note\`, \`history\`` ——
 * 第二格都不再重复标记）。所以从**第一次**见到标记起，剩下的全部按可选算。
 * 按字面逐格判定会把 `history` 读成必填，那既不是条款的意思，也不是代码的意思。
 */
function parseCell(cell: string): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  let sawOptional = false;
  for (const rawPart of cell.split(/[、，,]/)) {
    const part = rawPart.trim();
    if (part === '') continue;
    const name = part.match(/`([a-z.]+)`/u)?.[1];
    expect(name, `单元格片段没解析出字段名（反引号写法变了？）：${part}`).toBeDefined();
    if (OPTIONAL_WORD.test(part)) sawOptional = true;
    (sawOptional ? optional : required).push(name as string);
  }
  return { required, optional };
}

// ─────────────────────────────────────────────────────────────────────────
// 代码侧：每条链路的**最小**与**最大**字段集合
// ─────────────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-09-25T12:00:00');
const TASKS: readonly PrioritizeTaskInput[] = [{ id: 't1', title: '做发布', dueDate: NOW }];

const withPrefs = (): PreferenceSet => ({
  memoryEnabled: true,
  estimateBias: {
    id: 'estimate-bias',
    value: 1.8,
    sampleSize: 30,
    confidence: 0.9,
    evidenceFacts: { kind: 'estimate-bias', multiplier: 1.8, samples: 30 },
    evidence: '基于 30 次专注，你倾向低估任务耗时',
  },
  deepWorkWindow: {
    id: 'deep-work-window',
    value: { startHour: 8, endHour: 11, concentration: 0.8 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: {
      kind: 'deep-work-window',
      startHour: 8,
      endHour: 11,
      concentration: 0.8,
      samples: 40,
    },
    evidence: '基于 40 次专注，80% 集中在 08:00–11:00',
  },
  leadTime: {
    id: 'lead-time',
    value: 2,
    sampleSize: 20,
    confidence: 0.9,
    evidenceFacts: { kind: 'lead-time', days: 2, samples: 20 },
    evidence: '基于 20 条任务，你习惯提前 2 天',
  },
  granularity: {
    id: 'granularity',
    value: 6,
    sampleSize: 12,
    confidence: 0.9,
    evidenceFacts: { kind: 'granularity', items: 6, samples: 12 },
    evidence: '你的 12 条带清单任务，中位数是 6 项',
  },
  // 🔴 四个功能都要能**真的**产出一条偏好，否则 `max()` 里根本没有 `preferences`，
  // 上面那条"全部字段 == 代码最大集合"就会因为夹具不全而红 —— 那是夹具的 bug，
  // 不是判据的。capture 只吃 title-style，所以这一格不能省。
  titleStyle: {
    id: 'title-style',
    value: { cjkShare: 1, medianTitleLength: 12, emojiShare: 0 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: {
      kind: 'title-style',
      cjkShare: 1,
      medianTitleLength: 12,
      emojiShare: 0,
      samples: 40,
    },
    evidence: '基于 40 条任务，你的标题以中文为主，平均 12 个字',
  },
  withheld: [],
});

/** 四个功能：条款里的行名（中英）↔ 代码里最小/最大的字段集合。 */
const CHAINS: readonly {
  readonly zhLabel: string;
  readonly enLabel: string;
  readonly min: () => readonly string[];
  readonly max: () => readonly string[];
}[] = [
  {
    zhLabel: '一句话捕获',
    enLabel: 'One-line capture',
    min: () => buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: NOW }).fields,
    max: () =>
      buildCaptureInvocation(
        { locale: 'zh-CN', text: '买牛奶', now: NOW },
        renderPreferenceHints(withPrefs(), 'capture'),
      ).fields,
  },
  {
    zhLabel: '拆解任务',
    enLabel: 'Task breakdown',
    min: () => buildBreakdownInvocation({ locale: 'zh-CN', title: '做发布', now: NOW }).fields,
    max: () =>
      buildBreakdownInvocation(
        { locale: 'zh-CN', title: '做发布', note: '别忘灰度', now: NOW },
        renderPreferenceHints(withPrefs(), 'breakdown'),
      ).fields,
  },
  {
    zhLabel: '优先级建议',
    enLabel: 'Prioritisation',
    min: () => buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: NOW }).fields,
    max: () =>
      buildPrioritizeInvocation(
        { locale: 'zh-CN', tasks: TASKS, now: NOW },
        renderPreferenceHints(withPrefs(), 'prioritize'),
      ).fields,
  },
  {
    zhLabel: '估时',
    enLabel: 'Duration estimate',
    min: () => buildDurationInvocation({ locale: 'zh-CN', title: '写周报', now: NOW }).fields,
    max: () =>
      buildDurationInvocation(
        { locale: 'zh-CN', title: '写周报', note: '别忘附数据', history: [{ plannedMs: 1_800_000, actualMs: 3_240_000 }], now: NOW },
        renderPreferenceHints(withPrefs(), 'duration-estimate'),
      ).fields,
  },
];

const zhRows = tableRows(ZH_HEAD);
const enRows = tableRows(EN_HEAD);

describe('🔴🔴 条款第三节的字段表 == 代码实际披露的 fields', () => {
  for (const chain of CHAINS) {
    const zhRow = zhRows.find((r) => r.label === chain.zhLabel);
    const enRow = enRows.find((r) => r.label === chain.enLabel);

    it(`${chain.zhLabel}：条款里那一行存在（不存在 = 表少一行，而封闭句式会把它说成"未授权"）`, () => {
      expect(zhRow, `中文表没有「${chain.zhLabel}」这一行`).toBeDefined();
      expect(enRow, `英文表没有 "${chain.enLabel}" 这一行`).toBeDefined();
    });

    it(`🔴 ${chain.zhLabel}：必发字段逐个对上（少披露一项 = 偷偷多送）`, () => {
      const parsed = parseCell(String(zhRow?.cell));
      expect(parsed.required, '必发字段与代码的最小集合不一致').toEqual([...chain.min()]);
      expect([...parsed.required, ...parsed.optional], '全部字段与代码的最大集合不一致').toEqual([...chain.max()]);
    });

    it(`🔴 ${chain.zhLabel}：中英两版同一行、同序、同集合`, () => {
      expect(parseCell(String(enRow?.cell))).toEqual(parseCell(String(zhRow?.cell)));
    });
  }

  it('🔴 W4：`today` 在四条链路的披露清单与条款表里**都**在（这单交付的正是这一项）', () => {
    for (const chain of CHAINS) {
      expect(chain.min(), `${chain.zhLabel} 的代码没披露 today`).toContain('today');
      expect(parseCell(String(zhRows.find((r) => r.label === chain.zhLabel)?.cell)).required, `${chain.zhLabel} 的条款表没披露 today`).toContain(
        'today',
      );
    }
  });

  it('🔴 工具选择那一行也披露了 today（内置助手早就在送它，表里漏写就是少说一项）', () => {
    const cell = String(zhRows.find((r) => r.label === '工具选择')?.cell);
    expect(parseCell(cell).required).toContain('today');
    expect(parseCell(String(enRows.find((r) => r.label === 'Tool selection')?.cell)).required).toContain('today');
  });

  it('🔴 阳性对照：解析器自己认得"可选"（中英两种写法各一条）', () => {
    // 没有这一条，`OPTIONAL_WORD` 写坏（例如给中文加了 `\b`）会让**所有**字段
    // 落进 required，于是"必发字段 == 代码最小集合"整族变成假的比较对象。
    expect(parseCell('`today`、`title`，可选 `note`')).toEqual({
      required: ['today', 'title'],
      optional: ['note'],
    });
    expect(parseCell('`today`, `title`, optionally `note`')).toEqual({
      required: ['today', 'title'],
      optional: ['note'],
    });
  });

  it('🔴 阳性对照：那张表的行名与分母都不许悄悄换', () => {
    expect(zhRows.map((r) => r.label)).toEqual([
      '一句话捕获',
      '拆解任务',
      '优先级建议',
      '估时',
      '工具选择',
    ]);
    expect(enRows.map((r) => r.label)).toEqual([
      'One-line capture',
      'Task breakdown',
      'Prioritisation',
      'Duration estimate',
      'Tool selection',
    ]);
  });
});
