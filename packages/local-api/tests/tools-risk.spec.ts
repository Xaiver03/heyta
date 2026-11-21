/**
 * 工具目录的**风险档**不变量。
 *
 * 目的：把「破坏性动作被默认当成低风险自动执行」这一类**静默错误**变成会红的判据。
 * - 每个工具都必须声明 `risk`，且取值在封闭词表里；
 * - `read` 工具的 risk 必须是 `read`；
 * - `write` 工具的 risk 不得是 `read`（写工具不许伪造成只读）。
 *
 * 未来新增删除/归档/移动：应声明 `destructive-reversible`；
 * 新增彻底删除（purge）：应声明 `destructive-irreversible` 且**不进 AI 工具目录**（D7）。
 * 若有人漏声明，`LocalApiTool` 的必填字段会让 `tsc` 直接报错；若声明了非法值，本用例红。
 */
import { describe, expect, it } from 'vitest';

import { LOCAL_API_TOOLS } from '../src/index.js';

const VALID_RISKS = new Set([
  'read',
  'write',
  'destructive-reversible',
  'destructive-irreversible',
]);

describe('工具目录风险档（ToolRisk）', () => {
  it('每个工具都声明了合法 risk', () => {
    for (const tool of LOCAL_API_TOOLS) {
      expect(
        VALID_RISKS.has(tool.risk),
        `工具「${tool.name}」的 risk=${String(tool.risk)} 不在封闭词表里`,
      ).toBe(true);
    }
  });

  it('read 工具的 risk 必须是 read', () => {
    for (const tool of LOCAL_API_TOOLS.filter((t) => t.kind === 'read')) {
      expect(tool.risk, `只读工具「${tool.name}」的 risk 必须是 read`).toBe('read');
    }
  });

  it('write 工具的 risk 不得是 read', () => {
    for (const tool of LOCAL_API_TOOLS.filter((t) => t.kind === 'write')) {
      expect(tool.risk, `写工具「${tool.name}」不许声明成只读 risk`).not.toBe('read');
    }
  });

  it('现有写工具里不出现 destructive 档（当前尚无删除/归档/移动工具；新增时改这条并接回溯）', () => {
    // 这是一条**现状钉**：一旦新增 destructive-reversible 工具，本用例会红，
    // 提醒作者：① 同时接上「按 runId 回滚」；② 更新本断言。它在 CI 上挡住"悄悄加个删除工具"。
    const destructive = LOCAL_API_TOOLS.filter((t) => t.risk.startsWith('destructive-'));
    expect(destructive.map((t) => t.name)).toEqual([]);
  });
});
