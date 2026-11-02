/**
 * `assistantNeedsEgressDisclosure` 的判据测试
 * =========================================
 *
 * 这条判定现在有两个消费者（助手循环 + 对话面板），而它们必须给出同一个答案 ——
 * 所以它钉的是**判定本身**，不是某一个界面。面板那一侧的接线由
 * `apps/web/tests/ai-assistant-panel.spec.tsx` 钉（摘掉面板里的短路 ⇒ 那枚用例转红）。
 */

import { describe, expect, it } from 'vitest';

import { assistantNeedsEgressDisclosure } from '../src/index.js';

describe('规则先跑 ⇒ 不要求出境批准', () => {
  it('🔴 本机就答得出的清单类问句 ⇒ 不需要披露', () => {
    for (const text of ['今天有什么任务', '列出所有任务', '我有哪些习惯']) {
      expect(assistantNeedsEgressDisclosure(text), text).toBe(false);
    }
  });

  it('🔴 规则答不出的句子 ⇒ 必须披露', () => {
    for (const text of ['随便说点什么吧', '帮我把这周排个优先级', '']) {
      expect(assistantNeedsEgressDisclosure(text), text).toBe(true);
    }
  });

  it('🔴 两条规则命中**不同工具** ⇒ 不替用户挑，照旧走披露', () => {
    // 「列出任务」与「有哪些习惯」各命中一个工具 → `ambiguous`（不猜）。
    expect(
      assistantNeedsEgressDisclosure('列出任务，还有我有哪些习惯'),
    ).toBe(true);
  });

  it('⚠️ 多条规则命中**同一个工具** ⇒ 算一个候选，短路照旧可用', () => {
    // 这条钉的是去重语义：`看看/有哪些/今天有什么` 都能指到"列今天的待办"，
    // 去重后是一个候选而不是"歧义"。把它写成断言是因为第一版测试在这里猜错过一次。
    expect(assistantNeedsEgressDisclosure('看看今天有什么任务')).toBe(false);
  });

  it('🔴 注入的规则集 replaces 默认表，不叠加', () => {
    const text = '今天有什么任务';
    expect(
      assistantNeedsEgressDisclosure(text, { rules: [] }),
      '给了空规则集还命中，说明规则是"默认表 + 注入"两份在跑',
    ).toBe(true);
  });
});
