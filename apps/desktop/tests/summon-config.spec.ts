/**
 * 键位配置的判断（R6 判据④「键位可配置且重启后保留」的那半：形状与冲突）。
 *
 * 这里**不起 Electron**：注册成功与否要真按键盘才看得见（在 e2e 里），
 * 但"什么算合法、什么算抢 ⌘,、配置文件坏了怎么办"全是纯判断，
 * 它们必须能在毫秒级、无 GUI 的环境里红。
 */

import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_SUMMON_CONFIG,
  SUMMON_COMMANDS,
  normalizeAccelerator,
  parseSummonConfig,
  readSummonConfigFile,
  reservedSettingsAccelerator,
  serializeSummonConfig,
  summonConfigPath,
  validateSummonConfig,
  writeSummonConfigFile,
} from '../src/summon-config.js';

const mac = 'darwin';
const win = 'win32';

it('同一个键在两个平台上归一到同一个形状（CommandOrControl 展开成各自的修饰键）', () => {
  expect(normalizeAccelerator('CommandOrControl+Alt+Shift+S', mac)).toBe('alt+meta+shift+s');
  expect(normalizeAccelerator('CommandOrControl+Alt+Shift+S', win)).toBe('alt+ctrl+shift+s');
});

it('写法不同但同一个键，必须归一成同一串 —— 冲突判据全靠这个', () => {
  expect(normalizeAccelerator('Cmd+Shift+A', mac)).toBe(normalizeAccelerator('Shift+Command+A', mac));
  expect(normalizeAccelerator('Option+Shift+A', mac)).toBe(normalizeAccelerator('Alt+Shift+a', mac));
});

it('没有键名 / 只有修饰键 / 两个键名，都不是合法组合键', () => {
  expect(normalizeAccelerator('CommandOrControl+Alt+Shift', mac)).toBeUndefined();
  expect(normalizeAccelerator('S', mac)).toBe('s');
  expect(normalizeAccelerator('Cmd+A+B', mac)).toBeUndefined();
  expect(normalizeAccelerator('', mac)).toBeUndefined();
});

it('🔴 保留键 ⌘,（Windows 是 Ctrl+,）不许被全局命令抢走', () => {
  expect(reservedSettingsAccelerator(mac)).toBe('meta+,');
  expect(reservedSettingsAccelerator(win)).toBe('ctrl+,');

  expect(validateSummonConfig({ showHide: 'Command+,', quickAdd: 'Alt+Shift+A' }, mac)).toEqual([
    expect.stringContaining('与设置窗口的 ⌘, 冲突'),
  ]);
  expect(validateSummonConfig({ showHide: 'Command+,', quickAdd: 'Alt+Shift+A' }, win)).toEqual([]);
  expect(validateSummonConfig({ showHide: 'Control+,', quickAdd: 'Alt+Shift+A' }, win)).toEqual([
    expect.stringContaining('与设置窗口的 Ctrl+, 冲突'),
  ]);
});

it('不带修饰键的裸键一律拒绝（全局热键会吞掉用户打字）', () => {
  const problems = validateSummonConfig({ showHide: 'S', quickAdd: 'Alt+Shift+A' }, mac);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('缺少修饰键');
});

it('两条命令撞同一个键要红，而且一次报出来', () => {
  const problems = validateSummonConfig(
    { showHide: 'CommandOrControl+Alt+Shift+S', quickAdd: 'Cmd+Shift+Alt+S' },
    mac,
  );
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('同一个组合键');
});

it('合法配置返回空问题表（这条不许改成"永远为空"）', () => {
  expect(validateSummonConfig(DEFAULT_SUMMON_CONFIG, mac)).toEqual([]);
  expect(validateSummonConfig(DEFAULT_SUMMON_CONFIG, win)).toEqual([]);
});

it('默认键位本身不许与 ⌘, 撞，且两条互不相同', () => {
  const normalized = SUMMON_COMMANDS.map((c) => normalizeAccelerator(DEFAULT_SUMMON_CONFIG[c], mac));
  expect(new Set(normalized).size).toBe(SUMMON_COMMANDS.length);
  expect(normalized).not.toContain(reservedSettingsAccelerator(mac));
});

it('配置文件缺失 = 默认键位，且 present 为假（"用户没设过"与"设过又坏了"是两件事）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-summon-'));
  try {
    const file = readSummonConfigFile(summonConfigPath(dir));
    expect(file.present).toBe(false);
    expect(file.config).toEqual(DEFAULT_SUMMON_CONFIG);
    expect(file.problems).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('JSON 写坏了不崩：整份退回默认 + 把原因带回来', () => {
  const parsed = parseSummonConfig('{ 这不是 json');
  expect(parsed.config).toEqual(DEFAULT_SUMMON_CONFIG);
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]).toContain('不是合法 JSON');
});

it('坏掉的那一项单独退回默认，其余照常生效（一处手滑不许抹掉全部设置）', () => {
  const parsed = parseSummonConfig('{"showHide": 42, "quickAdd": "CommandOrControl+Alt+Shift+K"}');
  expect(parsed.config.showHide).toBe(DEFAULT_SUMMON_CONFIG.showHide);
  expect(parsed.config.quickAdd).toBe('CommandOrControl+Alt+Shift+K');
  expect(parsed.problems.join()).toContain('showHide');
});

it('认不出的项被忽略但要说出来（静默忽略 = 用户改了没反应还不知道为什么）', () => {
  const parsed = parseSummonConfig('{"showHide":"CommandOrControl+Alt+Shift+S","showhide":"x"}');
  expect(parsed.config.showHide).toBe('CommandOrControl+Alt+Shift+S');
  expect(parsed.problems.join()).toContain('不认识');
});

it('🔴 判据④的后半：写进去的键位，重启（= 再读一次同一个文件）读回来还是它', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-summon-'));
  try {
    const path = summonConfigPath(dir);
    const custom = { showHide: 'CommandOrControl+Alt+Shift+K', quickAdd: 'CommandOrControl+Alt+Shift+J' };
    writeSummonConfigFile(path, custom, mac);

    // "重启"在壳侧就是一件事：下一次启动重新读这份文件。
    const reread = readSummonConfigFile(path);
    expect(reread.present).toBe(true);
    expect(reread.config).toEqual(custom);
    expect(validateSummonConfig(reread.config, mac)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('校验不过的配置**不落盘**，也不许把已有文件改坏', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-summon-'));
  try {
    const path = summonConfigPath(dir);
    writeSummonConfigFile(path, DEFAULT_SUMMON_CONFIG, mac);
    const before = readFileSync(path, 'utf8');

    expect(() => writeSummonConfigFile(path, { ...DEFAULT_SUMMON_CONFIG, showHide: 'Command+,' }, mac)).toThrow(
      /未写入/,
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('序列化形状是人可以直接手改的（没有这格用户就只能在设置页等）', () => {
  const text = serializeSummonConfig(DEFAULT_SUMMON_CONFIG);
  expect(JSON.parse(text)).toEqual(DEFAULT_SUMMON_CONFIG);
  expect(text).toContain('\n  "showHide"');
});
