import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isProfileAssistantVisible,
  popNavigationEntry,
  pushNavigationEntry,
  type NavigationStacks,
} from '../src/nav/navigation-state';

const emptyStacks: NavigationStacks = {
  tasks: [],
  calendar: [],
  focus: [],
  categories: [],
  profile: [],
};

const profileScreenSource = readFileSync(
  new URL('../src/screens/ProfileScreen.tsx', import.meta.url),
  'utf8',
);

describe('移动端二级导航栈', () => {
  it('push 后可以回退，并且回退不会改动其他 tab', () => {
    const withTask = pushNavigationEntry(emptyStacks, 'tasks', 'task-detail');
    const withProfile = pushNavigationEntry(withTask, 'profile', 'settings');
    expect(withProfile.tasks).toEqual([{ key: 'task-detail' }]);
    expect(withProfile.profile).toEqual([{ key: 'settings' }]);

    const afterTaskPop = popNavigationEntry(withProfile, 'tasks');
    expect(afterTaskPop.tasks).toEqual([]);
    expect(afterTaskPop.profile).toEqual([{ key: 'settings' }]);
  });

  it('空栈 pop 是无操作，避免 Android 返回键误退出页面状态', () => {
    expect(popNavigationEntry(emptyStacks, 'tasks')).toBe(emptyStacks);
  });

  it('「我的」功能域二级页使用 profile 栈，硬件返回只 pop 回个人中心', () => {
    const withFeature = pushNavigationEntry(emptyStacks, 'profile', 'feature:growth');
    const afterBack = popNavigationEntry(withFeature, 'profile');

    expect(afterBack.profile).toEqual([]);
    expect(afterBack.tasks).toEqual([]);
  });

  it('切换 tab 时不会把其他 tab 的二级页解释成个人中心页面', () => {
    const withTask = pushNavigationEntry(emptyStacks, 'tasks', 'task-detail');
    const withFeature = pushNavigationEntry(withTask, 'profile', 'feature:growth');

    expect(withFeature.tasks).toEqual([{ key: 'task-detail' }]);
    expect(withFeature.profile).toEqual([{ key: 'feature:growth' }]);
  });

  it('助手跨 tab 保留 profile 栈，但隐藏时不应视为可见页面或拦截返回', () => {
    const withAssistant = pushNavigationEntry(emptyStacks, 'profile', 'profile:assistant');

    expect(isProfileAssistantVisible('profile', withAssistant)).toBe(true);
    expect(isProfileAssistantVisible('tasks', withAssistant)).toBe(false);
    // The route remains in the profile stack while tasks is active; the
    // AssistantScreen receives visible=false and therefore owns no Back handler.
    expect(withAssistant.profile).toEqual([{ key: 'profile:assistant' }]);
  });

  it('助手隐藏时的可见性判断只由 active tab 改变，不能破坏草稿所在的 profile 栈', () => {
    const withAssistant = pushNavigationEntry(emptyStacks, 'profile', 'profile:assistant');
    const whileOnTasks = { ...withAssistant, tasks: [{ key: 'task-detail' }] };

    expect(isProfileAssistantVisible('tasks', whileOnTasks)).toBe(false);
    expect(whileOnTasks.profile).toEqual([{ key: 'profile:assistant' }]);
    expect(isProfileAssistantVisible('profile', whileOnTasks)).toBe(true);
  });

  it('ProfileScreen 的功能域入口和摘要入口都写入 profile 栈', () => {
    expect(profileScreenSource).toContain('navigation.push(featureRouteKey(entry.key));');
    expect(profileScreenSource).toContain("navigation.push(featureRouteKey('growth'));" );
    expect(profileScreenSource).toContain('return featureScreen(');
    expect(profileScreenSource).toContain('navigation.pop();');
    expect(profileScreenSource).not.toContain(
      'useState<MobileFeatureEntryKey | null>(null)',
    );
  });
});
