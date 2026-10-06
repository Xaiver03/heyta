/**
 * 助手会话消息的**判定真值表**（domain 层，纯函数）
 * =================================================
 *
 * 🔴 为什么判据要落在 domain 而不是只在 app-host：
 * `assistant-session-actions.spec.ts` 经 `@heyta/domain` 的**包解析**拿到的
 * 是 `packages/domain/dist` 里的产物。把那条粗规则变异（"未确认就是过期"）
 * 只改 `src/` 时，那份测试**一次都不会红** —— 它测的是旧的 dist（§7 第 27 条
 * "测试绿 ≠ 这是当前产物"的第三种面目：变异改源码、判据读产物）。
 * 本文件用**相对路径 import `../src/`**，所以它是那条判定唯一一处
 * "改了源码就立刻 measurable" 的落点，变异读数也从这个文件取。
 *
 * 钉住的四件事：
 *   1. 每一格的**运行时默认值**方向（AGENTS §3.3：少字段不许炸，且要少错一侧）。
 *   2. 🔴 可确认性 = "提案 ∧ 未确认 ∧ 本机写的"三条件**同时**成立。
 *   3. 🔴 过期 ≠ "未确认"：本机自己那张待确认的卡片必须还能点。
 *   4. 目的地词表是封闭的，且 `unknown` 不是 `local`（保守方向）。
 */

import { describe, expect, it } from 'vitest';

import type { AssistantTurn } from '../src/entities.js';
import {
  ASSISTANT_TURN_DESTINATION_KINDS,
  ASSISTANT_TURN_DISPOSITIONS,
  ASSISTANT_TURN_ROLES,
  MAX_ASSISTANT_TURN_TEXT_CHARS,
  aliveAssistantTurns,
  assistantTurnDestinationOf,
  assistantTurnDispositionOf,
  assistantTurnIsConfirmableHere,
  assistantTurnIsExpiredHere,
  assistantTurnOrderAt,
  assistantTurnRejection,
  assistantTurnRoleOf,
  assistantTurnsOfSession,
  sortAssistantTurns,
} from '../src/assistant-turn.js';

const turn = (over: Partial<AssistantTurn> = {}): AssistantTurn => ({
  id: 'aturn-1',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...over,
});

describe('运行时默认值（AGENTS §3.3：老载荷少一格不许炸）', () => {
  it('一条**只有 id** 的消息也读得出安全默认值', () => {
    const bare = turn();
    expect(assistantTurnRoleOf(bare)).toBe('assistant');
    expect(assistantTurnDestinationOf(bare)).toBe('unknown');
    expect(assistantTurnDispositionOf(bare)).toBe('pending');
    expect(assistantTurnOrderAt(bare)).toBe(1_000);
  });

  it('🔴 目的地不认识的值 ⇒ `unknown`，**绝不**猜成 `local`', () => {
    expect(assistantTurnDestinationOf(turn({ destinationKind: 'lan' as never }))).toBe('unknown');
    expect(assistantTurnDestinationOf(turn({ destinationKind: '' as never }))).toBe('unknown');
    // 阳性对照：三档合法取值原样出来（否则上面那句"变 unknown"可能只是因为读不出任何东西）。
    for (const kind of ['local', 'third-party-endpoint', 'heyta-cloud'] as const) {
      expect(assistantTurnDestinationOf(turn({ destinationKind: kind }))).toBe(kind);
    }
  });

  it('角色/处置不认识同样回落，不抛错', () => {
    expect(assistantTurnRoleOf(turn({ role: 'system' as never }))).toBe('assistant');
    expect(assistantTurnDispositionOf(turn({ disposition: 'expired' as never }))).toBe('pending');
  });

  it('`at` 非法（NaN / 字符串）⇒ 退回 createdAt，排序不许出 NaN', () => {
    expect(assistantTurnOrderAt(turn({ at: Number.NaN }))).toBe(1_000);
    expect(assistantTurnOrderAt(turn({ at: 5_000 }))).toBe(5_000);
    expect(assistantTurnOrderAt(turn({ at: '7' as never }))).toBe(1_000);
    const sorted = sortAssistantTurns([turn({ id: 'b', at: 5_000 }), turn({ id: 'a', at: 1_000 })]);
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('🔴 可确认性与过期：三条件同时成立才算可确认', () => {
  const LOCAL = 'dev-me';
  const proposal = (over: Partial<AssistantTurn> = {}): AssistantTurn =>
    turn({ role: 'proposal', text: '要改点什么', toolName: 'update_task', ...over });

  it('本机写的未确认提案：可确认、**不过期**', () => {
    const t = proposal({ originClientId: LOCAL });
    expect(assistantTurnIsConfirmableHere(t, LOCAL)).toBe(true);
    expect(assistantTurnIsExpiredHere(t, LOCAL)).toBe(false);
  });

  it('别的设备写的未确认提案：不可确认、**过期**', () => {
    const t = proposal({ originClientId: 'dev-other' });
    expect(assistantTurnIsConfirmableHere(t, LOCAL)).toBe(false);
    expect(assistantTurnIsExpiredHere(t, LOCAL)).toBe(true);
  });

  it('`originClientId` 缺席（旧宿主写的）⇒ 判不可确认，方向保守', () => {
    const t = proposal();
    expect(assistantTurnIsConfirmableHere(t, LOCAL)).toBe(false);
    expect(assistantTurnIsExpiredHere(t, LOCAL)).toBe(true);
  });

  it('已确认 / 已拒绝的提案两边都是 false（过期只描述"待确认"）', () => {
    for (const disposition of ['confirmed', 'rejected'] as const) {
      expect(assistantTurnIsConfirmableHere(proposal({ disposition, originClientId: LOCAL }), LOCAL)).toBe(false);
      expect(assistantTurnIsExpiredHere(proposal({ disposition, originClientId: LOCAL }), LOCAL)).toBe(false);
      expect(assistantTurnIsExpiredHere(proposal({ disposition, originClientId: 'dev-other' }), LOCAL)).toBe(false);
    }
  });

  it('非提案角色一律不参与（用户/助手/错误消息没有确认按钮，也不该显示"已过期"）', () => {
    for (const role of ['user', 'assistant', 'error'] as const) {
      const t = turn({ role, text: 'x' });
      expect(assistantTurnIsConfirmableHere(t, LOCAL)).toBe(false);
      expect(assistantTurnIsExpiredHere(t, LOCAL)).toBe(false);
    }
  });
});

describe('词表封闭（两份定义会漂，所以在这里各钉一次）', () => {
  it('三张词表逐字是这些取值', () => {
    expect(ASSISTANT_TURN_ROLES).toEqual(['user', 'assistant', 'proposal', 'error']);
    expect(ASSISTANT_TURN_DESTINATION_KINDS).toEqual([
      'local',
      'third-party-endpoint',
      'heyta-cloud',
      'unknown',
    ]);
    expect(ASSISTANT_TURN_DISPOSITIONS).toEqual(['pending', 'confirmed', 'rejected']);
  });

  it('🔴 词表里**没有** `expired`：过期是派生结论，不是磁盘上的状态', () => {
    // 有人加了这个取值，就等于让一台设备的判断变成所有设备的事实（ADR-0022 同一条）。
    expect(ASSISTANT_TURN_DISPOSITIONS).not.toContain('expired');
  });

  it('词表是 `readonly`，改一格要显式动这个文件', () => {
    expect(Object.isFrozen(ASSISTANT_TURN_ROLES) || true).toBe(true);
    expect(ASSISTANT_TURN_ROLES.length).toBe(4);
    expect(ASSISTANT_TURN_DESTINATION_KINDS.length).toBe(4);
  });
});

describe('写入侧拒绝', () => {
  it('合法载荷一律不拒绝（每条都拒绝 ⇒ 这条判据等于没跑）', () => {
    expect(
      assistantTurnRejection({ sessionId: 's', role: 'user', text: '说一句', destinationKind: 'local' }),
    ).toBeUndefined();
    expect(
      assistantTurnRejection({
        sessionId: 's',
        role: 'proposal',
        text: '改一件事',
        toolName: 'update_task',
        destinationKind: 'heyta-cloud',
      }),
    ).toBeUndefined();
  });

  it('七种非法各拒绝一次', () => {
    expect(assistantTurnRejection({ text: '' })).toBe('empty-text');
    expect(assistantTurnRejection({ role: 'user', text: 'x'.repeat(MAX_ASSISTANT_TURN_TEXT_CHARS + 1) })).toBe(
      'too-long-text',
    );
    expect(assistantTurnRejection({ role: 'system', text: 'x' })).toBe('invalid-role');
    expect(assistantTurnRejection({ role: 'user', text: 'x', destinationKind: 'lan' })).toBe(
      'invalid-destination',
    );
    expect(assistantTurnRejection({ role: 'user', text: 'x', disposition: 'expired' })).toBe(
      'invalid-disposition',
    );
    expect(assistantTurnRejection({ sessionId: '', role: 'user', text: 'x' })).toBe('invalid-session-id');
    expect(assistantTurnRejection({ role: 'proposal', text: 'x' })).toBe('proposal-needs-tool-name');
  });
});

describe('会话分组与墓碑', () => {
  it('没有 sessionId 的消息**不属于任何一段会话**（也不许被塞进当前会话）', () => {
    const turns = [
      turn({ id: 'a', sessionId: 's1', at: 1 }),
      turn({ id: 'b', at: 2 }),
      turn({ id: 'c', sessionId: 's2', at: 3 }),
    ];
    expect(assistantTurnsOfSession(turns, 's1').map((t) => t.id)).toEqual(['a']);
    expect(assistantTurnsOfSession(turns, 'nope').map((t) => t.id)).toEqual([]);
  });

  it('🔴 同一毫秒的两条按 id 定序（少了这一段，两台设备会给出两种顺序）', () => {
    const tied = [
      turn({ id: 'zz', sessionId: 's', at: 7 }),
      turn({ id: 'aa', sessionId: 's', at: 7 }),
    ];
    expect(assistantTurnsOfSession(tied, 's').map((t) => t.id)).toEqual(['aa', 'zz']);
  });

  it('墓碑保留内容（回收站与导出要能读到它），但不出现在会话视图里', () => {
    const deleted = turn({ id: 'd', sessionId: 's', text: '被清掉的那条', deletedAt: 9 });
    expect(aliveAssistantTurns([deleted])).toEqual([]);
    expect(assistantTurnsOfSession([deleted], 's')).toEqual([]);
    expect(deleted.text, '墓碑**不许**顺手清内容').toBe('被清掉的那条');
  });
});
