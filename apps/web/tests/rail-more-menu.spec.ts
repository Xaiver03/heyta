import { describe, expect, it } from 'vitest';
import { splitRailTabs, VIEW_TABS } from '../src/features/shell/view-tabs.js';
import type { RailPreference } from '../src/features/shell/rail-pref.js';

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

  it('用户偏好决定顺序，当前视图不会被随机提升', () => {
    const tabs = VIEW_TABS.filter((tab) => tab.key !== 'settings' && tab.key !== 'trash');
    const preference: RailPreference = {
      primary: ['tasks', 'search', 'notes', 'calendar'],
      overflow: ['quadrant', 'habits', 'timeline'],
    };
    const result = splitRailTabs(tabs, 'timeline', preference);
    expect(result.primary.map((tab) => tab.key)).toEqual(['tasks', 'search', 'notes', 'calendar']);
    expect(result.overflow.map((tab) => tab.key)).toEqual(['quadrant', 'habits', 'timeline', 'focus', 'growth', 'countdown']);
  });

  it('任务与搜索始终留在主段，重复或关闭的 key 不会重新出现', () => {
    const tabs = VIEW_TABS.filter((tab) => !['settings', 'trash', 'notes'].includes(tab.key));
    const preference: RailPreference = {
      primary: ['quadrant', 'quadrant', 'calendar'],
      overflow: ['tasks', 'search', 'habits'],
    };
    const result = splitRailTabs(tabs, 'tasks', preference);
    expect(result.primary.map((tab) => tab.key)).toEqual(['quadrant', 'calendar', 'tasks', 'search']);
    expect(result.overflow.map((tab) => tab.key)).toEqual(['habits', 'timeline', 'focus', 'growth', 'countdown']);
    expect(result.primary.map((tab) => tab.key)).not.toContain('notes');
  });
  it('主动固定超过四个入口不会挤走任何已固定视图', () => {
    const tabs = VIEW_TABS.filter((tab) => tab.key !== 'settings' && tab.key !== 'trash');
    const primary = ['tasks', 'calendar', 'habits', 'search', 'notes', 'quadrant'] as const;
    const result = splitRailTabs(tabs, 'tasks', { primary, overflow: ['timeline'] });
    expect(result.primary.map((tab) => tab.key)).toEqual(primary);
    expect([...result.primary, ...result.overflow]).toHaveLength(tabs.length);
  });

});
