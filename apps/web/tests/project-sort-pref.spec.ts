import { afterEach, describe, expect, it } from 'vitest';
import { loadProjectTaskSort, saveProjectTaskSort } from '../src/features/projects/project-sort-pref';

const originalStorage = globalThis.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
});

describe('清单级排序偏好', () => {
  it('不同清单互不污染，且非法值回退为未设置', () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    saveProjectTaskSort('p1', 'priority');
    saveProjectTaskSort('p2', 'display');
    expect(loadProjectTaskSort('p1')).toBe('priority');
    expect(loadProjectTaskSort('p2')).toBe('display');

    values.set('heyta.projectTaskSort', JSON.stringify({ p1: 'invalid', p2: 'addedAt' }));
    expect(loadProjectTaskSort('p1')).toBeUndefined();
    expect(loadProjectTaskSort('p2')).toBe('addedAt');
  });

  it('localStorage 读写失败时不把当前列表打崩', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
      },
    });
    expect(loadProjectTaskSort('p1')).toBeUndefined();
    expect(() => saveProjectTaskSort('p1', 'priority')).not.toThrow();
  });
});
