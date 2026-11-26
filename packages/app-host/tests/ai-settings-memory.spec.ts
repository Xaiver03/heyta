/**
 * 记忆相关的 AI 设置：默认关、只认字面 true
 * =========================================
 *
 * `autoExtractMemories` 是 M9 的闸。它必须与 `memoryEnabled` 同一条纪律：
 * 缺省 = 关，`"true"` / `1` 这些"看起来像真"的值一律不算 ——
 * 一个不认识的写法不该悄悄打开一条往记忆里写东西的路径。
 */

import { describe, expect, it } from 'vitest';

import { defaultAiSettingsState, parseAiSettingsState } from '../src/ai-settings-store.js';

describe('autoExtractMemories', () => {
  it('出厂默认是关的', () => {
    expect(defaultAiSettingsState().autoExtractMemories).toBe(false);
  });

  it('没写过 / 坏 JSON / 顶层不是对象 ⇒ 关', () => {
    expect(parseAiSettingsState(undefined).autoExtractMemories).toBe(false);
    expect(parseAiSettingsState('{').autoExtractMemories).toBe(false);
    expect(parseAiSettingsState('[]').autoExtractMemories).toBe(false);
  });

  it('只认字面 true：字符串 "true"、数字 1 都不算', () => {
    expect(parseAiSettingsState(JSON.stringify({ autoExtractMemories: true })).autoExtractMemories).toBe(true);
    expect(parseAiSettingsState(JSON.stringify({ autoExtractMemories: 'true' })).autoExtractMemories).toBe(false);
    expect(parseAiSettingsState(JSON.stringify({ autoExtractMemories: 1 })).autoExtractMemories).toBe(false);
  });
});
