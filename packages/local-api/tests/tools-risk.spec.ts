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

  it('破坏性（destructive-reversible）工具必须是**已登记的那一批**，且不含 irreversible', () => {
    // 删除→回收站 / 归档 / 移动 = destructive-reversible：直接执行，靠 op-log 版本回溯兜底（D1 裁决）。
    // 本断言把"允许的破坏性集合"钉成清单：新增一个删除类工具而没登记 ⇒ 红；顺手把不可逆动作（purge）漏进来 ⇒ 红。
    const destructive = LOCAL_API_TOOLS.filter((t) => t.risk.startsWith('destructive-'));
    expect(destructive.map((t) => t.name).sort()).toEqual(
      [
        'trash_task',
        'trash_tasks',
        'delete_habit',
        'move_tasks',
        'abandon_task',
        'move_task',
        'archive_project',
        'delete_project',
        'delete_tag',
        'delete_note',
        'delete_reminder',
        'delete_event',
        'archive_event',
        'delete_task_comment',
      ].sort(),
    );
    // 🔴 绝不允许 irreversible（彻底删除 purge）进目录 —— 那是 D1 明确不给 AI 的动作。
    const irreversible = LOCAL_API_TOOLS.filter((t) => t.risk === 'destructive-irreversible');
    expect(irreversible.map((t) => t.name)).toEqual([]);
  });
});
