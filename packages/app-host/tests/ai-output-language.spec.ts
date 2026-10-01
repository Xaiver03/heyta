/**
 * AI 输出语言测试
 * =================
 *
 * 🔴 这里钉的是**一条数据污染通道**，不是提示词的文风。
 *
 * 提示词本身一直是中文（它是给模型的指令，不是界面文案）。但模型会跟着指令的
 * 语言回话 —— 于是英文界面用户点下「确认」之后，**中文标题 / 中文子项清单会
 * 写进用户数据并同步到所有设备**。泄漏出去的不是界面文案，是存量数据。
 *
 * 所以钉四件事，按重要性排：
 *
 *   1. 指令跟着 `locale` 走（两种语言各自的句子真的出现在 `system` 里）
 *   2. **机器可读部分不许翻译** —— 漏了这条，结果是解析失败，比语言错更糟
 *   3. `locale` 只进 `system`：换语言**不得**改动 `user` 与 `fields`
 *      （`fields` 是出境披露的词表，披露跟着语言变就是界面在说谎）
 *   4. 未知语言在**装配这一步**就炸 —— 不炸的话会发出一条写着
 *      「输出语言：undefined」的真请求，而探针照常判绿
 *
 * ⚠️ 判据边界：这里能证的是**我们发出去了什么**。模型是否真的用英文回话是
 * 概率性的，要靠真端点跑（`HEYTA_AI_LOCALE=en pnpm verify:ai-breakdown-live`），
 * 见 `docs/plans/i18n-multilingual.md` §10.3。
 */

import { describe, expect, it } from 'vitest';

import { buildBreakdownInvocation } from '../src/ai-breakdown.js';
import { buildCaptureInvocation } from '../src/ai-capture.js';
import { buildDurationInvocation } from '../src/ai-duration.js';
import { buildPrioritizeInvocation } from '../src/ai-prioritize.js';
import {
  outputLanguageDirective,
  type AiOutputLocale,
} from '../src/ai-output-language.js';

/** 固定时刻 —— 两个语言必须拿到**同一个** now，否则 user 差异说不清是谁造成的。 */
const NOW = Date.parse('2026-10-01T09:00:00.000Z');

const TASKS = [
  { id: 't1', title: '写周报' },
  { id: 't2', title: '回复邮件', dueDate: NOW + 3_600_000 },
];

/**
 * 四个构建器 + 各自最小输入。`locale` 由调用方填。
 *
 * 🔴 这里刻意用**构建器**而不是 `request*`：要钉的是"发出去的字"，
 * 而 `request*` 那条路要造假 fetch、过出境闸门，会把这条测试变成集成测试。
 * 出境链路的集成侧已经有 `fields` 逐字段核对（各 `ai-*.spec.ts`）。
 */
const builders = [
  {
    name: 'capture',
    build: (locale: AiOutputLocale) =>
      buildCaptureInvocation({ text: '明天下午三点和张总开周会', now: NOW, locale }),
  },
  {
    name: 'breakdown',
    build: (locale: AiOutputLocale) => buildBreakdownInvocation({ title: '上线新版本', locale }),
  },
  {
    name: 'duration',
    build: (locale: AiOutputLocale) =>
      buildDurationInvocation({
        title: '写周报',
        locale,
        history: [{ plannedMs: 30 * 60_000, actualMs: 54 * 60_000 }],
      }),
  },
  {
    name: 'prioritize',
    build: (locale: AiOutputLocale) => buildPrioritizeInvocation({ tasks: TASKS, locale }),
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// 1) 指令跟着界面语言走
// ─────────────────────────────────────────────────────────────────────────

describe('输出语言指令：跟着界面语言走', () => {
  for (const { name, build } of builders) {
    it(`🔴 ${name}：英文界面 ⇒ 要 English，不许出现「一律用简体中文」`, () => {
      const { system } = build('en');
      expect(system).toContain('界面语言是 English');
      expect(system).toContain('一律用 English');
      expect(system).not.toContain('一律用简体中文');
    });

    it(`${name}：中文界面 ⇒ 简体中文那条，不是英文那条`, () => {
      const { system } = build('zh-CN');
      expect(system).toContain('界面语言是简体中文');
      expect(system).toContain('一律用简体中文');
      expect(system).not.toContain('一律用 English');
    });
  }

  it('🔴 英文那条必须明说"指令是中文也要用英文回"—— 这是这条修正的全部意义', () => {
    const en = outputLanguageDirective('en');
    expect(en).toContain('即使本提示词的其余部分是中文');
    expect(en).toContain('不要把标题写成中文');
  });

  it('🔴 prioritize 的理由指令不许再自相矛盾（原来写"用一两句中文"）', () => {
    expect(buildPrioritizeInvocation({ tasks: TASKS, locale: 'en' }).system).not.toContain(
      '用一两句中文',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2) 机器可读部分不许翻译
// ─────────────────────────────────────────────────────────────────────────

describe('机器可读字节与语言无关', () => {
  for (const locale of ['zh-CN', 'en'] satisfies readonly AiOutputLocale[]) {
    it(`🔴 ${locale}：键名 / 枚举 / id / 日期格式都点名不许翻译`, () => {
      const directive = outputLanguageDirective(locale);
      expect(directive).toContain('机器可读的部分保持原样');
      expect(directive).toContain('JSON 的键名');
      expect(directive).toContain('任务 id');
      expect(directive).toContain('"high" / "medium" / "low"');
      expect(directive).toContain('日期格式');
    });

    it(`${locale}：每个构建器的 system 里都带着这一段`, () => {
      for (const { name, build } of builders) {
        expect(build(locale).system, name).toContain('机器可读的部分保持原样');
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 3) 换语言不得改动出境面
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 locale 只进 system，不进 user / fields', () => {
  for (const { name, build } of builders) {
    it(`${name}：两个语言的 user 逐字相同`, () => {
      expect(build('en').user).toBe(build('zh-CN').user);
    });

    it(`${name}：两个语言的 fields 完全相同（披露不跟着语言变）`, () => {
      expect(build('en').fields).toEqual(build('zh-CN').fields);
    });

    it(`${name}：fields 里不许出现语言参数 —— 它不是用户提交的数据`, () => {
      expect(build('en').fields).not.toContain('locale');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 4) 未知语言：装配当场炸
// ─────────────────────────────────────────────────────────────────────────

describe('未知语言不许悄悄发出去', () => {
  it('🔴 表里没有的 locale ⇒ 抛错，而不是拼出「输出语言：undefined」', () => {
    // 运行时才可能出现：无类型的 JS 调用方（scripts/*.mjs 直接 import dist）。
    const unknown = 'ja' as AiOutputLocale;
    expect(() => outputLanguageDirective(unknown)).toThrow(/不支持的 AI 输出语言/);
    expect(() => outputLanguageDirective(unknown)).toThrow(/ja/);
    expect(() => outputLanguageDirective(undefined as unknown as AiOutputLocale)).toThrow(
      /zh-CN \/ en/,
    );
  });

  it('构建器同样把异常传出来（不会退回中文）', () => {
    const broken = 'ja' as AiOutputLocale;
    expect(() => buildBreakdownInvocation({ title: 'x', locale: broken })).toThrow();
    expect(() => buildCaptureInvocation({ text: 'x', now: NOW, locale: broken })).toThrow();
  });
});
