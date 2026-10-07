import { beforeEach, describe, expect, it } from 'vitest';
import { clearRailPreference, loadRailPreference, saveRailPreference, type RailPreference } from '../src/features/shell/rail-pref.js';

const preference: RailPreference = {
  primary: ['tasks', 'search', 'calendar'],
  overflow: ['quadrant', 'habits'],
};

describe('rail 设备本地偏好', () => {
  beforeEach(() => localStorage.clear());

  it('保存后可恢复，且只保存视图 key', () => {
    saveRailPreference(preference);
    expect(loadRailPreference()).toEqual(preference);
  });

  it('坏 JSON、错误形状和空值都回退到默认裁决', () => {
    localStorage.setItem('heyta.shell.rail', '{bad');
    expect(loadRailPreference()).toBeUndefined();
    localStorage.setItem('heyta.shell.rail', JSON.stringify({ primary: ['unknown'], overflow: [] }));
    expect(loadRailPreference()).toBeUndefined();
    localStorage.setItem('heyta.shell.rail', JSON.stringify(null));
    expect(loadRailPreference()).toBeUndefined();
  });

  it('恢复默认会清除偏好', () => {
    saveRailPreference(preference);
    clearRailPreference();
    expect(loadRailPreference()).toBeUndefined();
  });
});
