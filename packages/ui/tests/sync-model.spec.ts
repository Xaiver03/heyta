/**
 * 同步 / 冲突共享模型的测试
 * ============================
 *
 * 这里挑的都是**不报错、只会画错**的边界：离线该不该标红、"较新"分不出来时
 * 标到哪一侧、"保留远端"为什么点不了、字段摘要该说哪一句。
 * 它们全都能编译、能运行，只会在屏幕上呈现成另一件事 ——
 * 而这正是本仓库反复吃亏的那一类（`AGENTS.md` M0-1 的教训）。
 *
 * ⚠️ 这个测试跑在 **node** 环境（`vitest.config.ts` 文件头有理由）：
 * `packages/ui` 不引入 DOM 测试栈，所以"有判断"的部分必须留在 `model.ts`。
 * 一旦有人在 `model.ts` 里 import 了 `react-native` / `@heyta/i18n` /
 * `@heyta/sync-client`，这里会立刻失败。
 *
 * 🔴 有几条断言是**针对一次真实漂移**写的（同一个状态两端态度不同）——
 * 它们的注释里写明了迁之前两端各自是什么，别把它们当"随手加的风格断言"。
 */

import { describe, expect, it } from 'vitest';

import {
  CONFLICT_REASON_FALLBACK_KEY,
  CONFLICT_REASON_KEYS,
  ENTITY_LABEL_KEYS,
  NO_CONFLICT_FRESHNESS,
  conflictBlockedReason,
  conflictCanChoose,
  conflictChoiceForSide,
  conflictLookupCode,
  conflictReasonKey,
  conflictReasonLabelOf,
  conflictSummaryStyle,
  entityLabelKey,
  entityLabelOf,
  preferredConflictSide,
  syncFailureMessageKey,
  syncStatusAffordances,
  syncStatusBusy,
  syncStatusColorToken,
  syncStatusGlyph,
  syncStatusSeverity,
  type ConflictFreshness,
  type SyncStatusLike,
} from '../src/sync/model.js';

/** 六种状态各一份最小样本。 */
const EVERY_STATUS: readonly SyncStatusLike[] = [
  { kind: 'idle' },
  { kind: 'syncing', phase: 'upload' },
  { kind: 'synced' },
  { kind: 'offline' },
  { kind: 'conflict', conflicts: [] },
  { kind: 'error', reason: 'not-configured' },
];

describe('syncStatusSeverity', () => {
  it('🔴 离线**不是**错误（web 曾经把它标成警示色，移动端说它是正常状态）', () => {
    expect(syncStatusSeverity({ kind: 'offline' })).toBe('neutral');
    expect(syncStatusSeverity({ kind: 'offline' })).not.toBe('failure');
    expect(syncStatusSeverity({ kind: 'offline' })).not.toBe('attention');
  });

  it('冲突是 attention 而不是 failure（两边数据都在，只是要人选一下）', () => {
    expect(syncStatusSeverity({ kind: 'conflict', conflicts: [] })).toBe('attention');
  });

  it('六种状态各有确定的严重度，一个都不落', () => {
    expect(syncStatusSeverity({ kind: 'idle' })).toBe('neutral');
    expect(syncStatusSeverity({ kind: 'syncing', phase: 'download' })).toBe('progress');
    expect(syncStatusSeverity({ kind: 'synced' })).toBe('success');
    expect(syncStatusSeverity({ kind: 'error', reason: 'upload-rejected' })).toBe('failure');
  });
});

describe('syncStatusColorToken', () => {
  it('🔴 用 `*-strong` 那一档 —— 那是设计系统登记过的**正文文字色**', () => {
    // `color.success` / `color.warning` / `color.info` 是图形色，
    // 与 surface 的对比度只保证 3:1（非文字）。状态条里是小号正文，必须 4.5:1。
    expect(syncStatusColorToken({ kind: 'synced' })).toBe('color.success-strong');
    expect(syncStatusColorToken({ kind: 'error', reason: 'not-configured' })).toBe(
      'color.danger-strong',
    );
    expect(syncStatusColorToken({ kind: 'conflict', conflicts: [] })).toBe('color.warning-strong');
    expect(syncStatusColorToken({ kind: 'syncing', phase: 'upload' })).toBe('color.info-strong');
  });

  it('中性状态用 foreground-muted（离线与"还没同步"都不催人）', () => {
    expect(syncStatusColorToken({ kind: 'idle' })).toBe('color.foreground-muted');
    expect(syncStatusColorToken({ kind: 'offline' })).toBe('color.foreground-muted');
  });

  it('每一种状态的色调都是**颜色** token（拼错在别处会静默失效）', () => {
    for (const status of EVERY_STATUS) {
      expect(syncStatusColorToken(status)).toMatch(/^color\./);
    }
  });
});

describe('syncStatusGlyph', () => {
  it('转圈只在真的在同步时；冲突与错误共用警示字形', () => {
    expect(syncStatusGlyph({ kind: 'syncing', phase: 'download' })).toBe('spinner');
    expect(syncStatusGlyph({ kind: 'synced' })).toBe('check');
    expect(syncStatusGlyph({ kind: 'conflict', conflicts: [] })).toBe('alert');
    expect(syncStatusGlyph({ kind: 'error', reason: 'not-signed-in' })).toBe('alert');
  });

  it('🔴 还没同步过时**不能**打勾（打勾会让人以为数据已经上云）', () => {
    expect(syncStatusGlyph({ kind: 'idle' })).toBe('cloud-off');
    expect(syncStatusGlyph({ kind: 'offline' })).toBe('cloud-off');
  });
});

describe('syncStatusAffordances / syncStatusBusy', () => {
  it('🔴 同步中不给「立即同步」——`SyncClient` 没有为并发调用设计', () => {
    expect(syncStatusAffordances({ kind: 'syncing', phase: 'upload' }).canSyncNow).toBe(false);
    expect(syncStatusBusy({ kind: 'syncing', phase: 'upload' })).toBe(true);
    for (const status of EVERY_STATUS.filter((s) => s.kind !== 'syncing')) {
      expect(syncStatusAffordances(status).canSyncNow).toBe(true);
      expect(syncStatusBusy(status)).toBe(false);
    }
  });

  it('只有冲突才给「处理冲突」入口，只有错误才给帮助链接', () => {
    for (const status of EVERY_STATUS) {
      const a = syncStatusAffordances(status);
      expect(a.needsResolution).toBe(status.kind === 'conflict');
      expect(a.showsHelp).toBe(status.kind === 'error');
    }
    // 🔴 离线旁边本来就有可点的出路（重试），再给帮助链接会稀释它。
    expect(syncStatusAffordances({ kind: 'offline' }).showsHelp).toBe(false);
  });
});

describe('syncFailureMessageKey', () => {
  it('每一种已知原因都路由到共享的 `common.sync.error.*` 词条', () => {
    const reasons = [
      'not-configured',
      'not-signed-in',
      'no-encryption-password',
      'local-op-missing',
      'remote-version-unavailable',
      'undecryptable-ops',
      'undecryptable-page',
      'upload-rejected',
      'unauthorized',
    ] as const;
    const seen = new Set<string>();
    for (const reason of reasons) {
      const key = syncFailureMessageKey(reason);
      expect(key).toMatch(/^common\.sync\.error\./);
      // 每一种原因必须各有各的句子：全都一样就等于没结构。
      expect(seen.has(String(key))).toBe(false);
      seen.add(String(key));
    }
    expect(seen.size).toBe(reasons.length);
  });

  /**
   * 🔴 `unauthorized` 与 `not-signed-in` **不许合并**。
   *
   * 两个原因下用户手上的东西不同：后者是这台设备**从来没有**凭据（可能压根没配过），
   * 前者是**有过、现在被服务端拒了**（别处登出、改过口令、令牌过期）。
   * 合并成一句就等于对第二种人说"你还没登录"，而那人明明登录过 ——
   * 他会去找那个"从来不存在的登录"，而不是重新证明身份。
   */
  it('unauthorized 与 not-signed-in 是**两句不同的话**', () => {
    expect(syncFailureMessageKey('unauthorized')).not.toBe(syncFailureMessageKey('not-signed-in'));
  });

  it('🔴 意外异常与未知原因都返回 undefined（走宿主自己的诊断通道，不编一句）', () => {
    expect(syncFailureMessageKey('unexpected')).toBeUndefined();
    expect(syncFailureMessageKey('未来新增的原因')).toBeUndefined();
    expect(syncFailureMessageKey(undefined)).toBeUndefined();
  });
});

describe('冲突：哪一侧 / 能不能点', () => {
  const TIE: ConflictFreshness = { localNewer: false, remoteNewer: false };

  it('🔴 平手或拿不到对端时**不挑边**（分不出来就如实说分不出来）', () => {
    expect(preferredConflictSide(TIE)).toBeUndefined();
    expect(preferredConflictSide(NO_CONFLICT_FRESHNESS)).toBeUndefined();
  });

  it('严格更晚才强调', () => {
    expect(preferredConflictSide({ localNewer: true, remoteNewer: false })).toBe('local');
    expect(preferredConflictSide({ localNewer: false, remoteNewer: true })).toBe('remote');
  });

  it('两侧的名字与选择值一一对应，顺序只有一处定义', () => {
    expect(conflictChoiceForSide('local')).toBe('keep-local');
    expect(conflictChoiceForSide('remote')).toBe('keep-remote');
  });

  it('🔴 取不到对端时「保留远端」点不了，且**有理由可说**', () => {
    expect(conflictBlockedReason(false, 'keep-remote')).toBe('remote-missing');
    expect(conflictBlockedReason(false, 'keep-local')).toBeUndefined();
    expect(conflictBlockedReason(true, 'keep-remote')).toBeUndefined();
    expect(conflictCanChoose(false, 'keep-remote')).toBe(false);
    expect(conflictCanChoose(false, 'keep-local')).toBe(true);
  });

  it('🔴 查表用码是 `errorCode ?? reason`（服务端有码；LWW 的 reason 本身就是码）', () => {
    expect(conflictLookupCode({ errorCode: 'CONFLICT_CONCURRENT', reason: 'Concurrent…' })).toBe(
      'CONFLICT_CONCURRENT',
    );
    expect(conflictLookupCode({ reason: 'remote-archive' })).toBe('remote-archive');
  });
});

describe('conflictSummaryStyle', () => {
  it('用户自己的字原样透出（不翻译）', () => {
    expect(conflictSummaryStyle({ kind: 'text', text: '买菜' })).toEqual({
      kind: 'text',
      text: '买菜',
    });
  });

  it('🔴 结构化的载荷**只报数量** —— 字段名绝不进界面', () => {
    const style = conflictSummaryStyle({
      kind: 'fields',
      fields: [{ name: 'completedAt', value: '123' }, { name: 'dueDate', value: '"x"' }],
    });
    expect(style).toEqual({ kind: 'fieldCount', count: 2 });
    // 投影里根本没有字段名，宿主即便想拼也拼不出来。
    expect(JSON.stringify(style)).not.toContain('completedAt');
  });

  it('空载荷与「取不到这一侧」是两回事：这里只产出 `empty`', () => {
    expect(conflictSummaryStyle({ kind: 'empty' })).toEqual({ kind: 'empty' });
  });

  it('边界：`fields` 为空数组时报 0，不悄悄变成 `empty`', () => {
    expect(conflictSummaryStyle({ kind: 'fields', fields: [] })).toEqual({
      kind: 'fieldCount',
      count: 0,
    });
  });
});

/* ========================================================================
 * 实体名 / 冲突原因 → 共享词条 key（M3 第四刀 sync 收尾）
 *
 * 🔴 这些断言钉的是**下一条真实漂移**：实体的集合本身曾经有两份
 * （web `ConflictDialog.tsx` 与 mobile `conflict-view.ts`），
 * 加一个新实体只改一端不会让任何测试变红。这里把"表只有一份、
 * 认不出来必须回落/兜底"定死。
 *
 * ⚠️ 与 `@heyta/op-log` 的实体清单对齐的那条断言不在这个文件 ——
 * 这里不能 import `@heyta/op-log`（不是 `@heyta/ui` 声明的依赖）。
 * 它在 `apps/mobile/tests/conflict-keys.spec.ts`，那里能同时拿到
 * 清单与共享表的源码（理由见那个文件的文件头）。
 * ====================================================================== */

describe('entityLabelKey / entityLabelOf', () => {
  it('已知实体映射到共享 `common.entity.*` key', () => {
    expect(entityLabelKey('TASK')).toBe('common.entity.TASK');
    expect(entityLabelKey('AI_FEEDBACK')).toBe('common.entity.AI_FEEDBACK');
  });

  it('🔴 表里每个 key 都在共享命名空间下（不再借 `mobile.*`）', () => {
    for (const key of Object.values(ENTITY_LABEL_KEYS)) {
      expect(key).toMatch(/^common\.entity\./);
    }
  });

  it('🔴 认不出来的实体原样返回类型名（不编一个，也不吞掉）', () => {
    expect(entityLabelKey('SOMETHING_NEW')).toBeUndefined();
    // 传一个只回显 key 的取词函数：正好看出"查到了哪条 key"。
    const echo = (key: string): string => key;
    expect(entityLabelOf('TASK', echo)).toBe('common.entity.TASK');
    expect(entityLabelOf('SOMETHING_NEW', echo)).toBe('SOMETHING_NEW');
  });
});

describe('conflictReasonKey / conflictReasonLabelOf', () => {
  it('服务端错误码与 LWW 编码共用同一张表', () => {
    expect(conflictReasonKey('CONFLICT_CONCURRENT')).toBe('common.conflict.reason.concurrent');
    expect(conflictReasonKey('remote-archive')).toBe('common.conflict.reason.remoteArchive');
    // 两条 LWW 编码刻意指向同一句（同一件事的不同来源）。
    expect(conflictReasonKey('local-archive-sibling')).toBe(
      conflictReasonKey('local-archive'),
    );
  });

  it('🔴 查不到时走兜底 key，**绝不**回落成原始字符串（那是英文诊断）', () => {
    const raw = 'Concurrent modification detected for TASK:t1';
    expect(conflictReasonKey(raw)).toBeUndefined();
    const echo = (key: string): string => key;
    expect(conflictReasonLabelOf(raw, echo)).toBe(CONFLICT_REASON_FALLBACK_KEY);
    expect(conflictReasonLabelOf(raw, echo)).not.toBe(raw);
    expect(conflictReasonLabelOf('CONFLICT_CONCURRENT', echo)).toBe(
      'common.conflict.reason.concurrent',
    );
  });

  it('🔴 查表用码是 `errorCode ?? reason`（与 `conflictLookupCode` 同一条）', () => {
    const withCode = { errorCode: 'CONFLICT_CONCURRENT', reason: 'Concurrent…' };
    const echo = (key: string): string => key;
    expect(conflictReasonLabelOf(conflictLookupCode(withCode), echo)).toBe(
      'common.conflict.reason.concurrent',
    );
    expect(conflictReasonLabelOf(conflictLookupCode({ reason: 'remote-archive' }), echo)).toBe(
      'common.conflict.reason.remoteArchive',
    );
  });
});
