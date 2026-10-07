import { describe, expect, it } from 'vitest';
import { splitRailTabs, VIEW_TABS } from '../src/features/shell/view-tabs.js';

describe('rail 主段与更多入口', () => {
  it('目的地超过五个时只保留四个主入口', () => {
    const result = splitRailTabs(VIEW_TABS.filter((tab) => tab.key !== 'settings' && tab.key !== 'trash'), 'tasks');
    expect(result.primary).toHaveLength(4);
    expect(result.overflow.length).toBeGreaterThan(0);
    expect(result.primary.map((tab) => tab.key)).toContain('tasks');
  });

  it('当前位于低频视图时会提升到主段并保留其余入口', () => {
    const tabs = VIEW_TABS.filter((tab) => tab.key !== 'settings' && tab.key !== 'trash');
    const result = splitRailTabs(tabs, 'notes');
    expect(result.primary.map((tab) => tab.key)).toContain('notes');
    expect(result.overflow.map((tab) => tab.key)).not.toContain('notes');
    expect([...result.primary, ...result.overflow].map((tab) => tab.key).sort()).toEqual(
      tabs.map((tab) => tab.key).sort(),
    );
  });

  it('五个以内不渲染更多入口', () => {
    const tabs = VIEW_TABS.slice(0, 5);
    const result = splitRailTabs(tabs, 'tasks');
    expect(result.primary).toEqual(tabs);
    expect(result.overflow).toEqual([]);
  });
});
