/**
 * 恢复产物的**信封**必须是客户端导入器收得下的那一套
 * =====================================================
 *
 * 钉的是批次 E（工单 E5 追加）实测出来的缺陷 E：`recover-user.ts` 过去直接
 * `JSON.stringify(state)`，产出一句 `formatVersion` 都没有的裸对象，而
 * `server/docs/backup-and-recovery.md` 教的路径是"用 Settings → Import/Export →
 * Import from File 导回去"。那条路**从来没通过**（`parseExportDocument` 报
 * `unsupported-format-version`），而且没有任何一层会红 —— 因为没有一层 import 它。
 *
 * 四条判据：
 *   1. 产物**没有 `entities` 这一格**（缺陷 D 的修法：实体只能由客户端 reducer 物化，
 *      服务端那份 `DEL` 是 `delete`，由它填出来的产物结构上不可能有墓碑）；
 *   2. 真导入器**收得下**它（正向腿，用 `@heyta/app-host` 的 `parseExportDocument` 本体，
 *      不是照抄它的规则）；
 *   3. `formatVersion` / `app.name` 两个**字面量**与 app-host 的常量逐字相同
 *      （这里必须写死字面量：app-host 是 server 的 **devDependency**，生产镜像
 *      `--omit=dev` 装，运行时 import 它会让 `docker exec` 那条路直接挂）；
 *   4. 反向腿：把版本改坏时导入器仍然拒 —— 否则第 2 条可能是在量一个恒真。
 */

import { describe, expect, it } from 'vitest';
import { EXPORT_APP_NAME, EXPORT_FORMAT_VERSION, parseExportDocument } from '@heyta/app-host';
import { CURRENT_SCHEMA_VERSION } from '@heyta/shared-schema';

import { buildRecoverArtifact, type RecoveredOperationRow } from '../scripts/recover-user';

/** 两行最小的真实形状：一条 CREATE + 一条 Delete（墓碑就在那条 Delete 里，不在实体里）。 */
function rows(): RecoveredOperationRow[] {
  return [
    {
      id: 'op-1',
      serverSeq: 1,
      clientId: 'device-a',
      vectorClock: { 'device-a': 1 },
      clientTimestamp: BigInt(1_700_000_000_000),
      opType: 'CRT',
      entityType: 'TASK',
      entityId: 'task-1',
      entityIds: [],
      payload: { title: '活着的任务' },
      schemaVersion: CURRENT_SCHEMA_VERSION,
      isPayloadEncrypted: false,
      repairBaseServerSeq: null,
    },
    {
      id: 'op-2',
      serverSeq: 2,
      clientId: 'device-a',
      vectorClock: { 'device-a': 2 },
      clientTimestamp: BigInt(1_700_000_000_500),
      // 线协议词表里删除是 `DEL`（sync-core 的 OpType.Delete）。
      // 客户端 reducer 对它的语义是 field-level `deletedAt`（op-log/state.ts），
      // 服务端 replay 是 `delete state[type][id]`（op-replay.ts）—— 这个差别就是缺陷 D。
      opType: 'DEL',
      entityType: 'TASK',
      entityId: 'task-1',
      entityIds: [],
      payload: {},
      schemaVersion: CURRENT_SCHEMA_VERSION,
      isPayloadEncrypted: false,
      repairBaseServerSeq: null,
    },
  ];
}

describe('recover-user 的恢复产物信封', () => {
  it('🔴 不声明 entities —— 实体只能由客户端 reducer 物化（否则产物结构上没有墓碑）', () => {
    const artifact = buildRecoverArtifact(rows(), new Map(), '2026-10-04T00:00:00.000Z');
    expect(Object.hasOwn(artifact, 'entities')).toBe(false);
    // 唯一能被 op-log 自己证明的计数。写别的数字就是造第二套事实源。
    expect(artifact.counts).toEqual({ totalOps: 2 });
    expect(JSON.stringify(artifact)).not.toContain('deletedAt');
  });

  it('真导入器收得下它（正向腿，用 app-host 本体而不是照抄规则）', () => {
    const artifact = buildRecoverArtifact(rows(), new Map(), '2026-10-04T00:00:00.000Z');
    const parsed = parseExportDocument(JSON.stringify(artifact));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.document.opLog).toHaveLength(2);
    expect(parsed.document.entities).toBeUndefined();
  });

  it('两个必须写死的字面量与 app-host 的常量逐字相同（devDep 不能进运行时，所以靠这条对账）', () => {
    const artifact = buildRecoverArtifact(rows(), new Map(), '2026-10-04T00:00:00.000Z');
    expect(artifact.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(artifact.app.name).toBe(EXPORT_APP_NAME);
    expect(artifact.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('反向腿：版本被改坏时导入器仍然拒（否则上一条是在量恒真）', () => {
    const artifact = buildRecoverArtifact(rows(), new Map(), '2026-10-04T00:00:00.000Z');
    const wrong = { ...artifact, formatVersion: artifact.formatVersion + 1 };
    const parsed = parseExportDocument(JSON.stringify(wrong));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toBe('unsupported-format-version');
  });

  it('线协议字段齐备且 BigInt 不落进 JSON（少一个就是导入器报"缺 clientId/timestamp"）', () => {
    const artifact = buildRecoverArtifact(rows(), new Map(), '2026-10-04T00:00:00.000Z');
    const first = artifact.opLog[0] as Record<string, unknown>;
    expect(first.clientId).toBe('device-a');
    expect(first.vectorClock).toEqual({ 'device-a': 1 });
    expect(first.timestamp).toBeTypeOf('number');
    expect(() => JSON.stringify(artifact)).not.toThrow();
  });

  it('解密后的 payload 进产物、加密标记不外泄（产物必须是本机可读的明文）', () => {
    const secret = { title: '解开之后的标题' };
    const artifact = buildRecoverArtifact(rows(), new Map([[0, secret]]), '2026-10-04T00:00:00.000Z');
    const first = artifact.opLog[0] as Record<string, unknown>;
    expect(first.payload).toEqual(secret);
  });
});
