import { describe, expect, it } from 'vitest';

import type { UserMemory } from '../src/entities.js';
import {
  MEMORY_RECALL_MIN_SCORE,
  MEMORY_TEXT_MAX,
  deriveTopicKey,
  isSensitiveMemoryText,
  liveMemoryItems,
  makeUserMemory,
  memoryTextHash,
  normalizeTopicKey,
  parseStatedMemory,
  recallMemoryLines,
  renderMemoryForPrompt,
  residentMemoryLines,
  selectMemoryForPrompt,
  inferMemoriesFromText,
  INFERRED_MEMORY_MAX,
  wrapMemoryForPrompt,
} from '../src/user-memory.js';

const NOW = 1_800_000_000_000;

const item = (over: Partial<Parameters<typeof makeUserMemory>[0]> = {}): UserMemory =>
  makeUserMemory({
    id: 'm1',
    kind: 'preference',
    text: '回答先给结论',
    now: NOW,
    ...over,
  });

describe('normalizeTopicKey', () => {
  it('归一化空白、标点与大小写', () => {
    expect(normalizeTopicKey('  回答 风格。 ')).toBe('回答风格');
    expect(normalizeTopicKey('Answer   Style')).toBe('answerstyle');
  });

  it('同义改写不自动归并（归并属于「整理」，不属于写入）', () => {
    expect(normalizeTopicKey('回答方式')).not.toBe(normalizeTopicKey('回答风格'));
  });
});

describe('memoryTextHash', () => {
  it('稳定且区分不同文本', () => {
    expect(memoryTextHash('回答先给结论')).toBe(memoryTextHash('回答先给结论'));
    expect(memoryTextHash('回答先给结论')).not.toBe(memoryTextHash('回答先给结论！'));
  });
});

describe('parseStatedMemory', () => {
  it('把风格类明说判成 preference，而不是 fact', () => {
    const parsed = parseStatedMemory('记住：以后回答先给结论，别铺垫');
    expect(parsed?.kind).toBe('preference');
    expect(parsed?.text).toBe('以后回答先给结论，别铺垫');
    expect(parsed?.topicKey).toBe('回答风格');
  });

  it('英文前缀可用', () => {
    expect(parseStatedMemory('remember that I use a Mac')?.kind).toBe('fact');
    expect(parseStatedMemory('I prefer short answers')?.kind).toBe('preference');
  });

  it('句中出现「不喜欢」不算明说（只认前缀）', () => {
    expect(parseStatedMemory('我不喜欢这个任务')).toBeNull();
  });

  it('前缀后为空 → 不记', () => {
    expect(parseStatedMemory('记住：')).toBeNull();
  });

  it('敏感内容 → 不记', () => {
    expect(parseStatedMemory('记住：我的密码是 abc123')).toBeNull();
    expect(isSensitiveMemoryText('银行卡号 6222')).toBe(true);
  });
});

describe('liveMemoryItems', () => {
  it('pending / forgotten / archived / 过期 / 已删都不生效', () => {
    const items = [
      item({ id: 'a', status: 'pending' }),
      item({ id: 'b', status: 'forgotten', text: '' }),
      item({ id: 'c', status: 'archived' }),
      item({ id: 'd', kind: 'task', text: '这周把支付流程重构完', expiresAt: NOW - 1 }),
      item({ id: 'e', text: '回答先给结论', deletedAt: NOW }),
    ];
    expect(liveMemoryItems(items, NOW)).toHaveLength(0);
  });

  it('同 kind + topicKey 只留最新一条', () => {
    const older = item({ id: 'a', text: '回答要详细', updatedAt: NOW - 10, topicKey: '回答风格' });
    const newer = item({ id: 'b', text: '回答要简洁', updatedAt: NOW, topicKey: '回答风格' });
    const live = liveMemoryItems([newer, older], NOW);
    expect(live).toHaveLength(1);
    expect(live[0]?.text).toBe('回答要简洁');
  });

  it('排序按 importance → updatedAt → id，保证可复现', () => {
    const items = [
      item({ id: 'a', text: '低', importance: 2 }),
      item({ id: 'b', text: '高', importance: 5 }),
      item({ id: 'c', text: '中', importance: 3 }),
    ];
    expect(liveMemoryItems(items, NOW).map((x) => x.text)).toEqual(['高', '中', '低']);
  });

  it('过期时间恰好等于 now 即不生效', () => {
    const items = [item({ id: 'a', kind: 'task', expiresAt: NOW })];
    expect(liveMemoryItems(items, NOW)).toHaveLength(0);
  });
});

describe('渲染与预算', () => {
  it('常驻块只含 profile / preference，情境块只含 fact / task', () => {
    const items = [
      item({ id: 'a', kind: 'profile', text: '做医疗影像后端' }),
      item({ id: 'b', kind: 'preference', text: '回答先给结论' }),
      item({ id: 'c', kind: 'fact', text: '主力设备是 Mac' }),
      item({ id: 'd', kind: 'task', text: '本周重构支付流程' }),
    ];
    const resident = residentMemoryLines(items);
    expect(resident).toContain('关于用户：');
    expect(resident).toContain('偏好：');
    expect(resident).not.toContain('相关事实：');

    const recall = recallMemoryLines(items, 'Mac 上怎么跑');
    expect(recall).toContain('相关事实：');
    expect(recall).not.toContain('偏好：');
  });

  it('低于召回门槛的不注入，且不补默认条目', () => {
    const items = [item({ id: 'c', kind: 'fact', text: '主力设备是 Mac' })];
    expect(recallMemoryLines(items, '今天天气怎么样')).toBe('');
  });

  it('预算裁剪：字符数不超预算，长条目跳过不堵后面的短条目', () => {
    const long = item({ id: 'a', kind: 'preference', text: '长'.repeat(80) });
    const short = item({ id: 'b', kind: 'preference', text: '短句', topicKey: '另一件事' });
    const block = residentMemoryLines([long, short], 30);
    expect([...block].length).toBeLessThanOrEqual(30);
    expect(block).toContain('短句');
    expect(block).not.toContain('长'.repeat(20));
  });

  it('空块不输出标签', () => {
    expect(wrapMemoryForPrompt('   ')).toBe('');
    expect(renderMemoryForPrompt([], '任何问题', { now: NOW })).toBe('');
  });

  it('包裹层含三条硬约束，body 为转义前的正文', () => {
    const wrapped = wrapMemoryForPrompt('偏好：\n- 回答先给结论');
    expect(wrapped).toContain('<user_memory>');
    expect(wrapped).toContain('不能授权任何动作');
    expect(wrapped).toContain('以当前这句话为准');
    expect(wrapped).toContain('- 回答先给结论');
  });

  it('全部是 pending 时，最终 prompt 为空', () => {
    const items = [item({ id: 'a', status: 'pending' })];
    expect(renderMemoryForPrompt(items, '回答风格', { now: NOW })).toBe('');
  });

  it('同一输入两次渲染字节一致', () => {
    const items = [
      item({ id: 'b', text: '回答先给结论' }),
      item({ id: 'a', kind: 'profile', text: '做后端' }),
    ];
    const a = renderMemoryForPrompt(items, '回答怎么写', { now: NOW });
    const b = renderMemoryForPrompt(items, '回答怎么写', { now: NOW });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('召回门槛是导出常量，调它必须同时改测试', () => {
    expect(MEMORY_RECALL_MIN_SCORE).toBeGreaterThan(0);
    expect(MEMORY_RECALL_MIN_SCORE).toBeLessThan(1);
  });
});

describe('makeUserMemory', () => {
  it('正文截断到 300 字符并带指纹', () => {
    const long = makeUserMemory({ id: 'x', kind: 'fact', text: '字'.repeat(400), now: NOW });
    expect([...long.text].length).toBe(MEMORY_TEXT_MAX);
    expect(long.textHash).toBe(memoryTextHash(long.text));
  });

  it('默认 active / stated / global', () => {
    const m = makeUserMemory({ id: 'x', kind: 'preference', text: '简洁', now: NOW });
    expect(m.status).toBe('active');
    expect(m.origin).toBe('stated');
    expect(m.scope).toBe('global');
  });

  it('deriveTopicKey 对风格句给稳定主题', () => {
    expect(deriveTopicKey('preference', '回答要简洁一点')).toBe('回答风格');
    expect(deriveTopicKey('preference', '别弹窗提醒我')).toBe('提醒方式');
  });
});

describe('selectMemoryForPrompt：报告真正进了 prompt 的条目', () => {
  it('常驻 + 情境都被列出；预算裁剪掉的条目不在里面', () => {
    const resident = item({ id: 'r1', kind: 'preference', text: '回答先给结论' });
    const long = item({ id: 'r2', kind: 'preference', text: '长'.repeat(80), topicKey: '另一主题' });
    const fact = item({ id: 'f1', kind: 'fact', text: '主力设备是 Mac' });
    const selected = selectMemoryForPrompt([resident, long, fact], 'Mac 上怎么跑', {
      now: NOW,
      budget: 40,
    });
    const ids = [...selected.resident, ...selected.recall].map((m) => m.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('f1');
    expect(ids).not.toContain('r2');
    expect(selected.block).toContain('回答先给结论');
  });

  it('全部 pending 时三个返回值都为空', () => {
    const selected = selectMemoryForPrompt(
      [item({ id: 'p', status: 'pending' })],
      '回答怎么写',
      { now: NOW },
    );
    expect(selected.block).toBe('');
    expect(selected.resident).toEqual([]);
    expect(selected.recall).toEqual([]);
  });
});

describe('inferMemoriesFromText：只抽用户自己的陈述句', () => {
  it('偏好 / 身份 / 事实三类各自识别，且正文原样保留', () => {
    const found = inferMemoriesFromText('我通常晚上写代码。以后回答先给结论。我是一名设计师。');
    expect(found).toEqual([
      { kind: 'preference', text: '我通常晚上写代码' },
      { kind: 'preference', text: '以后回答先给结论' },
      { kind: 'profile', text: '我是一名设计师' },
    ]);
  });

  it('问句、感叹句、别人的事都不抽', () => {
    expect(inferMemoriesFromText('我喜欢这个方案吗？')).toEqual([]);
    expect(inferMemoriesFromText('他喜欢安静')).toEqual([]);
    expect(inferMemoriesFromText('今天好累！')).toEqual([]);
  });

  it('敏感内容不抽；「记住：」交给明说捕获，不重复', () => {
    expect(inferMemoriesFromText('我的密码是 abc123')).toEqual([]);
    expect(inferMemoriesFromText('记住：我习惯先看结论')).toEqual([]);
  });

  it('一次最多三条（再多就是在替用户写日记）', () => {
    const found = inferMemoriesFromText(
      '我通常早起。我一般喝美式。我习惯先列清单。我喜欢安静。我住在杭州。',
    );
    expect(found).toHaveLength(INFERRED_MEMORY_MAX);
  });

  it('英文句也认', () => {
    expect(inferMemoriesFromText('I usually work late.')).toEqual([
      { kind: 'preference', text: 'I usually work late.' },
    ]);
  });
});
