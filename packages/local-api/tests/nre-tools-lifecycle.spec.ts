/**
 * NOTE / REMINDER / EVENT 生命周期写工具的单测（契约 §3）
 * ========================================================
 *
 * 覆盖 8 个新增写工具：`delete_note` / `restore_note` / `move_note` /
 * `update_reminder` / `delete_reminder` / `delete_event` / `restore_event` / `archive_event`。
 *
 * 每个工具三件事（外加 update_reminder 的数值边界）：
 *   1. **正常路径**：合法参数产出契约 §1 对应的 intent（形状逐字断言，不只 `.ok`）；
 *   2. **未知参数拒绝**：多给一个键 ⇒ `ok: false`（严格白名单，忽略它等于替用户猜意图）；
 *   3. **缺必填拒绝**：不给必填字段 ⇒ `ok: false`；
 *   4. `update_reminder` 额外断言 `triggerAt` 非数值 / 非正数 / 非有限数都被拒。
 *
 * ⚠️ 这里只测 `toWriteIntent` 这个**纯函数**（目录 → pack → toIntent），不碰宿主：
 * "这条便签/提醒/事件是否真的存在""该不该落 op"是 `local-api-host` 的事（seam-owner），
 * 不在本文件的判据里。
 */

import { describe, expect, it } from 'vitest';

import { hasInputSchemaFor, LOCAL_API_TOOLS, toWriteIntent } from '../src/index.js';

/** 取一次成功意图；被拒时把 pack 给出的原因带进断言消息，免得红得没头绪。 */
function intentOf(name: string, args: Record<string, unknown>) {
  const outcome = toWriteIntent(name, args);
  if (!outcome.ok) throw new Error(`期望「${name}」通过，实际被拒：${outcome.message}`);
  return outcome.intent;
}

/** 断言某组参数被拒。 */
function expectRejected(name: string, args: Record<string, unknown>): void {
  expect(toWriteIntent(name, args).ok, `「${name}」应当拒绝 ${JSON.stringify(args)}`).toBe(false);
}

const REGISTERED = [
  { name: 'delete_note', risk: 'destructive-reversible' },
  { name: 'restore_note', risk: 'write' },
  { name: 'move_note', risk: 'write' },
  { name: 'update_reminder', risk: 'write' },
  { name: 'delete_reminder', risk: 'destructive-reversible' },
  { name: 'delete_event', risk: 'destructive-reversible' },
  { name: 'restore_event', risk: 'write' },
  { name: 'archive_event', risk: 'destructive-reversible' },
] as const;

describe('8 个生命周期写工具都进了目录，且档位符合契约 §3', () => {
  it('默认关、写工具、出境面为空、有参数 schema、风险档一致', () => {
    for (const { name, risk } of REGISTERED) {
      const tool = LOCAL_API_TOOLS.find((t) => t.name === name);
      expect(tool, `「${name}」应当登记在目录里`).toBeDefined();
      expect(tool, `「${name}」的档位不对`).toMatchObject({
        kind: 'write',
        risk,
        defaultEnabled: false,
        egressFields: [],
      });
      expect(hasInputSchemaFor(name), `「${name}」应当有参数 schema`).toBe(true);
    }
  });
});

describe('delete_note / restore_note / move_note', () => {
  it('delete_note 产出 delete-note', () => {
    expect(intentOf('delete_note', { noteId: 'n1' })).toEqual({
      action: 'delete-note',
      noteId: 'n1',
    });
  });

  it('restore_note 产出 restore-note', () => {
    expect(intentOf('restore_note', { noteId: 'n1' })).toEqual({
      action: 'restore-note',
      noteId: 'n1',
    });
  });

  it('move_note 产出 move-note：省略 projectId = 移出清单，给了就带上', () => {
    expect(intentOf('move_note', { noteId: 'n1' })).toEqual({
      action: 'move-note',
      noteId: 'n1',
    });
    expect(intentOf('move_note', { noteId: 'n1', projectId: 'p1' })).toEqual({
      action: 'move-note',
      noteId: 'n1',
      projectId: 'p1',
    });
  });

  it('三个便签工具都拒绝未知参数', () => {
    expectRejected('delete_note', { noteId: 'n1', extra: true });
    expectRejected('restore_note', { noteId: 'n1', extra: true });
    expectRejected('move_note', { noteId: 'n1', projectId: 'p1', extra: true });
  });

  it('三个便签工具都拒绝缺必填 / 空白必填', () => {
    expectRejected('delete_note', {});
    expectRejected('delete_note', { noteId: '   ' });
    expectRejected('restore_note', {});
    expectRejected('restore_note', { noteId: 1 });
    expectRejected('move_note', {});
    expectRejected('move_note', { noteId: 'n1', projectId: '   ' });
  });
});

describe('update_reminder / delete_reminder', () => {
  it('update_reminder 产出 update-reminder（date + time 原样带出，换算交给宿主）', () => {
    expect(intentOf('update_reminder', { reminderId: 'r1', date: '2026-10-04', time: '09:00' })).toEqual({
      action: 'update-reminder',
      reminderId: 'r1',
      date: '2026-10-04',
      time: '09:00',
    });
  });

  it('delete_reminder 产出 delete-reminder', () => {
    expect(intentOf('delete_reminder', { reminderId: 'r1' })).toEqual({
      action: 'delete-reminder',
      reminderId: 'r1',
    });
  });

  it('两个提醒工具都拒绝未知参数', () => {
    expectRejected('update_reminder', { reminderId: 'r1', date: '2026-10-04', time: '09:00', extra: true });
    expectRejected('delete_reminder', { reminderId: 'r1', extra: true });
  });

  it('两个提醒工具都拒绝缺必填', () => {
    expectRejected('update_reminder', { reminderId: 'r1' });
    expectRejected('update_reminder', { date: '2026-10-04', time: '09:00' });
    expectRejected('update_reminder', { reminderId: 'r1', date: '2026-10-04' });
    expectRejected('update_reminder', { reminderId: 'r1', time: '09:00' });
    expectRejected('update_reminder', {});
    expectRejected('delete_reminder', {});
    expectRejected('delete_reminder', { reminderId: '   ' });
  });

  it('update_reminder 拒绝空串 date / time', () => {
    expectRejected('update_reminder', { reminderId: 'r1', date: '   ', time: '09:00' });
    expectRejected('update_reminder', { reminderId: 'r1', date: '2026-10-04', time: '  ' });
  });
});

describe('delete_event / restore_event / archive_event', () => {
  it('delete_event 产出 delete-event', () => {
    expect(intentOf('delete_event', { eventId: 'e1' })).toEqual({
      action: 'delete-event',
      eventId: 'e1',
    });
  });

  it('restore_event 产出 restore-event', () => {
    expect(intentOf('restore_event', { eventId: 'e1' })).toEqual({
      action: 'restore-event',
      eventId: 'e1',
    });
  });

  it('archive_event 产出 archive-event', () => {
    expect(intentOf('archive_event', { eventId: 'e1' })).toEqual({
      action: 'archive-event',
      eventId: 'e1',
    });
  });

  it('三个事件工具都拒绝未知参数', () => {
    expectRejected('delete_event', { eventId: 'e1', extra: true });
    expectRejected('restore_event', { eventId: 'e1', extra: true });
    expectRejected('archive_event', { eventId: 'e1', extra: true });
  });

  it('三个事件工具都拒绝缺必填 / 空白必填', () => {
    expectRejected('delete_event', {});
    expectRejected('restore_event', {});
    expectRejected('archive_event', {});
    expectRejected('archive_event', { eventId: '   ' });
  });
});
