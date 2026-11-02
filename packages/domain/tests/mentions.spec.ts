/**
 * `@` 提及的文本语法
 * ==================
 *
 * 这份测试的重点不是"能解析出张三"，而是**四条会被最省事的实现破坏的边界**：
 *
 * 1. **邮箱不能触发**（`zhang@example.com`）—— 一条 `/\S*@(\S*)$/` 就会把它当成提及。
 * 2. **中文没有 `\b`** —— `@张三的会` 必须切出「张三的会」而不是「张三」，
 *    所以终止符是**显式集合**，不是正则的单词边界。
 * 3. **光标离开 token 之后不能再补全** —— 否则用户每敲一个字都会弹候选。
 * 4. **引号形态**（带空格的任务标题）必须能解析回来 —— 否则这类任务永远 @ 不到。
 */

import { describe, expect, it } from 'vitest';

import {
  activeMention,
  applyMention,
  findMentions,
  formatMention,
  rankMentionCandidates,
} from '../src/mentions.js';

describe('activeMention —— 什么时候弹出候选', () => {
  it('行首的 @ 触发了空查询（刚敲下 @ 的那一刻）', () => {
    expect(activeMention('@', 1)).toEqual({
      prefix: '@',
      query: '',
      quoted: false,
      start: 0,
      end: 1,
    });
  });

  it('空白之后的 @ 是提及', () => {
    const text = '提醒我 @买牛';
    expect(activeMention(text, text.length)?.query).toBe('买牛');
  });

  it('中文标点之后的 @ 也是提及', () => {
    const text = '两件事（@张';
    expect(activeMention(text, text.length)?.query).toBe('张');
  });

  it('🔴 邮箱里的 @ 不是提及', () => {
    const text = 'zhang@example.com';
    expect(activeMention(text, text.length)).toBeUndefined();
    expect(findMentions(text)).toEqual([]);
  });

  it('🔴 光标离开 token 之后不再补全', () => {
    const text = '@张三 ';
    // 光标在空格之后 —— 用户已经把这句话说完了
    expect(activeMention(text, text.length)).toBeUndefined();
  });

  it('🔴 中文没有单词边界：中文标点切开，字母数字不切', () => {
    const text = '看 @张三，下午三点';
    expect(activeMention(text, text.indexOf('，'))?.query).toBe('张三');
    // 没有标点时「张三的会」整段都是查询（这是对的行为：用户可能就在打这个标题）
    const opened = '@张三的会';
    expect(activeMention(opened, opened.length)?.query).toBe('张三的会');
  });

  it('空格结束普通形态（带空格的标题必须用引号）', () => {
    const text = '@买牛奶 明天';
    expect(activeMention(text, '@买牛奶'.length)?.query).toBe('买牛奶');
    // 光标越过空格 ⇒ 不再是那个 token
    expect(activeMention(text, text.length)).toBeUndefined();
  });

  it('引号形态能带空格', () => {
    const text = '@"下周三 评审会';
    expect(activeMention(text, text.length)).toMatchObject({
      query: '下周三 评审会',
      quoted: true,
    });
  });

  it('引号闭合之后仍然算这个记号（光标在引号内）', () => {
    const text = '@"下周三 评审会"';
    expect(activeMention(text, text.length)?.prefix).toBe('@"下周三 评审会"');
  });

  it('光标位置被夹到合法区间', () => {
    const text = '@张三';
    expect(activeMention(text, 999)?.query).toBe('张三');
    expect(activeMention(text, -5)).toBeUndefined();
  });
});

describe('formatMention —— 写回去的形态', () => {
  it('不带空格的标签用裸形态', () => {
    expect(formatMention('买牛奶')).toBe('@买牛奶');
    expect(formatMention(' 买牛奶 ')).toBe('@买牛奶');
  });

  it('带空格的标签用引号形态', () => {
    expect(formatMention('下周三 评审会')).toBe('@"下周三 评审会"');
  });

  it('🔴 表示不了的标签返回 undefined（不是插进去一个解析不回来的东西）', () => {
    expect(formatMention('')).toBeUndefined();
    expect(formatMention('   ')).toBeUndefined();
    expect(formatMention('带"引号')).toBeUndefined();
    expect(formatMention('带@符号')).toBeUndefined();
    expect(formatMention('换\n行')).toBeUndefined();
  });
});

describe('applyMention —— 替换区间与光标', () => {
  it('替换整段 token，光标落在插入内容之后', () => {
    const text = '提醒我 @买牛 明天';
    const active = activeMention(text, '提醒我 @买牛'.length);
    expect(active).toBeDefined();
    if (active === undefined) return;

    const out = applyMention(text, active, '买牛奶');
    expect(out).toEqual({ text: '提醒我 @买牛奶 明天', caret: '提醒我 @买牛奶'.length });
  });

  it('旧 token 是引号形态时整段被替换（不会留下孤立的引号）', () => {
    const text = '@"旧 标题"';
    const active = activeMention(text, text.length);
    expect(active).toBeDefined();
    if (active === undefined) return;

    expect(applyMention(text, active, '新标题')?.text).toBe('@新标题');
  });

  it('标签表示不了时拒绝替换', () => {
    const text = '@买';
    const active = activeMention(text, text.length);
    if (active === undefined) throw new Error('应当有活动记号');
    expect(applyMention(text, active, '带"引号')).toBeUndefined();
  });
});

describe('findMentions —— 发送前还原引用', () => {
  it('多处提及都找出来，含中文与引号形态', () => {
    const spans = findMentions('@买牛奶 和 @"下周三 评审会" 还有 @交房租');
    expect(spans.map((s) => s.label)).toEqual(['买牛奶', '下周三 评审会', '交房租']);
  });

  it('🔴 邮箱与空标签不算提及', () => {
    expect(findMentions('抄送 zhang@example.com')).toEqual([]);
    expect(findMentions('只有一个 @ 符号')).toEqual([]);
  });

  it('同一个标签出现两次就是两处（不去重）', () => {
    expect(findMentions('@甲 和 @甲')).toHaveLength(2);
  });

  it('区间能直接切回原文', () => {
    const text = '先说 @买牛奶 再说';
    const [span] = findMentions(text);
    expect(span).toBeDefined();
    if (span === undefined) return;
    expect(text.slice(span.start, span.end)).toBe('@买牛奶');
  });
});

describe('rankMentionCandidates —— 打两个字就要看到想选的那个', () => {
  const tasks = ['买牛奶', '买咖啡豆', '整理买菜的清单', '开会', '牛奶发票'];

  it('空查询返回全部（刚敲下 @ 时不该是空列表）', () => {
    expect(rankMentionCandidates(tasks, '', (t) => t)).toHaveLength(5);
  });

  it('前缀优先于子串', () => {
    expect(rankMentionCandidates(tasks, '买', (t) => t).slice(0, 3)).toEqual([
      '买牛奶',
      '买咖啡豆',
      '整理买菜的清单',
    ]);
  });

  it('只给子串命中的排在前缀之后', () => {
    expect(rankMentionCandidates(tasks, '牛奶', (t) => t)).toEqual(['牛奶发票', '买牛奶']);
  });

  it('limit 生效', () => {
    expect(rankMentionCandidates(tasks, '买', (t) => t, 2)).toHaveLength(2);
  });

  it('大小写不敏感（对拉丁字符）', () => {
    expect(rankMentionCandidates(['Buy MILK', 'read book'], 'buy', (t) => t)).toEqual([
      'Buy MILK',
    ]);
  });
});
