/**
 * 工具结果结构化卡片投影（确定性）不变量。
 *
 * 卡片只带**查询原值**（模型不能改写数字）、只对白名单读工具出卡、限量、可序列化。
 */
import { describe, expect, it } from 'vitest';

import { MAX_CARD_ITEMS, projectAssistantCards } from '../src/index.js';

describe('projectAssistantCards', () => {
  it('已知读工具（list_tasks）⇒ 主行标题 + 次行 截止/优先级，都取原值', () => {
    const cards = projectAssistantCards([
      {
        tool: 'list_tasks',
        data: [
          { title: '买牛奶', dueDate: '2026-03-14T09:00:00', priority: 'high' },
          { title: '写周报' },
        ],
      },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.tool).toBe('list_tasks');
    expect(cards[0]?.count).toBe(2);
    expect(cards[0]?.items[0]).toEqual({ primary: '买牛奶', meta: '2026-03-14T09:00:00 · high' });
    expect(cards[0]?.items[1]).toEqual({ primary: '写周报' });
  });

  it('未知工具 / 非数组 / 空 ⇒ 不出卡（不猜形状）', () => {
    expect(projectAssistantCards([{ tool: 'create_task', data: [{ title: 'x' }] }])).toHaveLength(0);
    expect(projectAssistantCards([{ tool: 'list_tasks', data: { nope: 1 } }])).toHaveLength(0);
    expect(projectAssistantCards([{ tool: 'list_tasks', data: [] }])).toHaveLength(0);
  });

  it('包一层的 { items: [...] } 也能读；且按 MAX_CARD_ITEMS 截断', () => {
    const rows = Array.from({ length: MAX_CARD_ITEMS + 5 }, (_u, i) => ({ title: `第 ${String(i)} 条` }));
    const cards = projectAssistantCards([{ tool: 'list_projects', data: { items: rows.map((r) => ({ name: r.title })) } }]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.items).toHaveLength(MAX_CARD_ITEMS);
    expect(cards[0]?.count).toBe(rows.length);
  });

  it('一轮最多两张卡', () => {
    const one = (tool: string) => ({ tool, data: [{ title: 'a', name: 'a' }] });
    const cards = projectAssistantCards([one('list_tasks'), one('list_projects'), one('list_tags')]);
    expect(cards).toHaveLength(2);
  });
});
