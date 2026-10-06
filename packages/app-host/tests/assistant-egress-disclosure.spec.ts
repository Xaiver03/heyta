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

const READ_AND_PROPOSE = 'read-and-propose';
const READ_ONLY = 'read-only';

describe('规则先跑 ⇒ 不要求出境批准', () => {
  it('🔴 本机就答得出的清单类问句 ⇒ 不需要披露', () => {
    for (const text of ['今天有什么任务', '列出所有任务', '我有哪些习惯']) {
      expect(assistantNeedsEgressDisclosure(text, { tier: READ_AND_PROPOSE }), text).toBe(false);
    }
  });

  it('🔴 规则答不出的句子 ⇒ 必须披露', () => {
    for (const text of ['随便说点什么吧', '帮我把这周排个优先级', '']) {
      expect(assistantNeedsEgressDisclosure(text, { tier: READ_AND_PROPOSE }), text).toBe(true);
    }
  });

  it('🔴 两条规则命中**不同工具** ⇒ 不替用户挑，照旧走披露', () => {
    // 「列出任务」与「有哪些习惯」各命中一个工具 → `ambiguous`（不猜）。
    expect(
      assistantNeedsEgressDisclosure('列出任务，还有我有哪些习惯', { tier: READ_AND_PROPOSE }),
    ).toBe(true);
  });

  it('⚠️ 多条规则命中**同一个工具** ⇒ 算一个候选，短路照旧可用', () => {
    // 这条钉的是去重语义：`看看/有哪些/今天有什么` 都能指到"列今天的待办"，
    // 去重后是一个候选而不是"歧义"。把它写成断言是因为第一版测试在这里猜错过一次。
    expect(assistantNeedsEgressDisclosure('看看今天有什么任务', { tier: READ_AND_PROPOSE })).toBe(false);
  });

  it('⚠️ 档位收窄时判定跟着收窄：低档拿不到的工具不算"本机可答"', () => {
    // 同一句话，档位决定 grants，grants 决定规则候选是否可见 ——
    // 这条钉的是"判定不绕过第二授权前端"，而不是"规则表是静态的"。
    const text = '我有哪些标签';
    expect(assistantNeedsEgressDisclosure(text, { tier: READ_ONLY })).toBe(false);
    expect(assistantNeedsEgressDisclosure(text, { tier: READ_AND_PROPOSE })).toBe(false);
    // 一句规则根本不管的话，两个档位都必须披露。
    expect(assistantNeedsEgressDisclosure('随便说点什么吧', { tier: READ_ONLY })).toBe(true);
  });

  it('🔴 注入的规则集 replaces 默认表，不叠加', () => {
    const text = '今天有什么任务';
    expect(
      assistantNeedsEgressDisclosure(text, { tier: READ_AND_PROPOSE, rules: [] }),
      '给了空规则集还命中，说明规则是"默认表 + 注入"两份在跑',
    ).toBe(true);
  });
});
