/**
 * 复现并钉住「服务端整页 op 都解不开」时的行为
 * =============================================
 *
 * 原始症状（上一轮登记，某台手机）：
 *
 *     Download: 12 ops (sinceSeq=3, latestSeq=15, hasMore=false, gap=false)
 *
 * 服务端确实发了一页，但该客户端 `lastServerSeq` 仍停在 3，且一条 HABIT 都没落库。
 *
 * 那行日志是**服务端**在 `reply.send` 之前打的
 * （`server/src/sync/sync.routes.ts:193-197`），它只证明服务端发了一页，
 * **不证明客户端应用了**。而 `hasMore=false` 又排除了「分页时游标提前推进」
 * 那条已经修掉的 bug（commit 2cf8712 修的是 `hasMore=true` 分支）——
 * 所以流程必然在到达 `client.ts` 的游标推进块（约 1287-1301 行）**之前**
 * 就中断了。`download()` 在到达那里之前只有一处会整体中断：
 * 整页一条都解不开（`client.ts` 约 1237-1250 行，ADR-0016 的 fail-closed）。
 *
 * 本用例把这条完整跑出来：
 *   1. 服务端（桩）上有一页 12 条 op，payload 用**口令 A** 真实 AES-GCM 加密；
 *   2. 客户端用**口令 B** 去下载；
 *   3. 12 条一条都解不开 → 在推进游标之前中断；
 *   4. 游标不动、DB 零行。
 *
 * 哪部分是真、哪部分是桩
 * -----------------------
 * 真：
 *   - `SyncClient`（生产代码，真 `download()` 路径）；
 *   - 真 AES-GCM 加解密（`@heyta/sync-core` 的 `encrypt` / 客户端内部 `decrypt`）；
 *   - 真 `OpLogEngine`（`@heyta/op-log`）；
 *   - 真 SQLite（`node:sqlite` + 临时文件，`NodeSqliteDriver`）。
 * 桩：
 *   - HTTP 传输层与「服务端 op 表」。真实服务端路由依赖 PostgreSQL
 *     （`server/vitest.config.ts` 默认排除 `tests/integration/**`），本机起不来，
 *     故这里按 `sync.routes.ts:184-207` 的分页语义返回，并打出**逐字同形**的日志。
 *     日志在用例里被捕获并断言，作为「与原始日志同形」的证据。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OpType, encrypt } from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';

// ⚠️ 走兄弟包的**预构建 dist**，不在本包 package.json 上加 workspace 依赖：
// `package.json` / `pnpm-lock.yaml` 是与并行会话共享的文件，本任务不碰。
// 运行时解析与 `tsc -p tsconfig.spec.json` 都已实测通过（见交付报告）。
import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  SqliteAdapter,
  STORES,
} from '../../storage/dist/index.js';
import { NodeSqliteDriver } from '../../storage/dist/sqlite/node-sqlite-driver.js';
import { OpLogEngine } from '../../op-log/dist/index.js';

import { SyncClient } from '../src/client.js';

const PASSWORD_A = 'password-A-what-the-data-was-written-with';
const PASSWORD_B = 'password-B-what-this-device-typed';
const CURSOR_KEY = 'lastServerSeq';

/** 线协议里的一页 op（嵌套形状 `{serverSeq, receivedAt, op}`）。 */
interface WireEnvelope {
  serverSeq: number;
  receivedAt: number;
  op: {
    id: string;
    clientId: string;
    actionType: string;
    opType: string;
    entityType: string;
    entityId: string;
    payload: string;
    vectorClock: Record<string, number>;
    timestamp: number;
    schemaVersion: number;
    isPayloadEncrypted: true;
  };
}

/**
 * 服务端桩：只桩传输与存储，不桩任何客户端逻辑。
 *
 * 分页语义逐条对齐 `sync.routes.ts`：取 `sinceSeq` 之后升序、`limit+1` 条，
 * 超出则 `hasMore=true`，`latestSeq` 是全局水位。
 */
class StubServer {
  private readonly ops: WireEnvelope[] = [];
  private latest = 0;
  /** 每次下载请求打出的服务端同形日志。 */
  readonly logLines: string[] = [];

  /** 模拟「服务端上已有 op」：seq 从 `startSeq` 起，payload 用口令 A 真加密。 */
  async seedEncryptedWithPasswordA(count: number, startSeq: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const seq = startSeq + i;
      const cipher = await encrypt(
        JSON.stringify({ title: `习惯 ${String(seq)}`, done: false }),
        PASSWORD_A,
      );
      this.ops.push({
        serverSeq: seq,
        receivedAt: seq,
        op: {
          id: `habit-op-${String(seq)}`,
          clientId: 'device-A',
          actionType: 'CREATE_HABIT',
          opType: OpType.Create,
          entityType: 'HABIT',
          entityId: `habit-${String(seq)}`,
          payload: cipher,
          // 真设备的时钟逐条递增；12 条都用同一个时钟会被引擎判成"已知道"而跳过
          vectorClock: { 'device-A': i + 1 },
          timestamp: 1_000 + seq,
          schemaVersion: 1,
          isPayloadEncrypted: true,
        },
      });
      this.latest = seq;
    }
  }

  respond(url: string): Response {
    const u = new URL(url);
    const sinceSeq = Number(u.searchParams.get('sinceSeq') ?? '0');
    const limit = Number(u.searchParams.get('limit') ?? '500');

    const matching = this.ops
      .filter((o) => o.serverSeq > sinceSeq)
      .sort((a, b) => a.serverSeq - b.serverSeq);
    const page = matching.slice(0, limit);
    const hasMore = matching.length > limit;
    const latestSeq = this.latest;
    const gap = false;

    // 与 server/src/sync/sync.routes.ts:193-197 同形（去掉 `[user:N] ` 前缀）。
    this.logLines.push(
      `Download: ${String(page.length)} ops ` +
        `(sinceSeq=${String(sinceSeq)}, latestSeq=${String(latestSeq)}, ` +
        `hasMore=${String(hasMore)}, gap=${String(gap)})`,
    );

    return new Response(
      JSON.stringify({ ops: page, hasMore, latestSeq, serverTime: Date.now() }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
}

interface Device {
  adapter: SqliteAdapter;
  engine: OpLogEngine;
  client: SyncClient;
}

/** 真引擎 + 真 SQLite + 真 SyncClient 的一台「设备」。 */
async function makeDevice(
  server: StubServer,
  password: string,
  cursorSeed: number,
  dir: string,
  name: string,
): Promise<Device> {
  const adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(join(dir, `${name}.sqlite`)),
  });
  await adapter.init();
  await adapter.put(STORES.META, { key: CURSOR_KEY, value: cursorSeed });

  const store = new DbOpLogStore<Operation<string>>(adapter);
  const engine = new OpLogEngine({ clientId: name, store });
  await engine.recover();

  const client = new SyncClient({
    baseUrl: 'http://127.0.0.1:3000',
    clientId: name,
    getToken: async () => 'test-token',
    getPassword: async () => password,
    getLastServerSeq: async () => {
      const row = await adapter.get<{ key: string; value: number }>(STORES.META, CURSOR_KEY);
      return row?.value ?? 0;
    },
    setLastServerSeq: async (seq) => {
      await adapter.put(STORES.META, { key: CURSOR_KEY, value: seq });
    },
    getLocalOps: () => engine.getPendingUpload(),
    markUploaded: (m) => engine.markUploaded(m),
    applyRemote: async (ops) => {
      await engine.applyRemote(ops);
    },
    redispatch: async (op) => {
      await engine.redispatch(op);
    },
    discardLocal: (ids) => engine.discardPendingUpload(ids),
    markRejected: (ids) => engine.markRejected(ids),
    getOpsForEntity: (entityType, entityId) =>
      engine.getOpsForEntity(entityType as never, entityId),
    getOpById: (opId) => engine.getOpById(opId),
    redispatchPayload: async () => undefined,
    fetchImpl: (async (input: string | URL | Request) =>
      server.respond(String(input))) as unknown as typeof fetch,
  });

  return { adapter, engine, client };
}

async function readCursor(adapter: SqliteAdapter): Promise<number> {
  const row = await adapter.get<{ key: string; value: number }>(STORES.META, CURSOR_KEY);
  return row?.value ?? -1;
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-undec-page-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('复现：服务端整页 op 都解不开（口令不匹配）', () => {
  it('🔴 12 条全解不开 → 服务端日志同形 + 游标不动 + 零落库 + 有分类的失败原因', async () => {
    const dir = tempDir();
    const server = new StubServer();
    await server.seedEncryptedWithPasswordA(12, 4);

    const { adapter, engine, client } = await makeDevice(
      server,
      PASSWORD_B,
      3,
      dir,
      'device-B',
    );

    const status = await client.sync();

    // ① 与原始日志**逐字同形**的服务端证据
    console.info(`[stub-server] ${server.logLines[0] ?? '(无日志)'}`);
    expect(server.logLines[0]).toBe(
      'Download: 12 ops (sinceSeq=3, latestSeq=15, hasMore=false, gap=false)',
    );

    // ② 症状复现：游标原地不动（ADR-0016：一次口令手滑不能静默跳过整段历史）
    expect(await readCursor(adapter)).toBe(3);

    // ③ 症状复现：零落库 —— op 日志与物化状态里都没有 HABIT
    expect(await adapter.count(STORES.OPS)).toBe(0);
    expect(Object.keys(engine.getState().habits)).toHaveLength(0);

    // ④ 客户端失败，且**有分类** —— 不是与网络抖动无法区分的 'unexpected'
    expect(status.kind).toBe('error');
    if (status.kind !== 'error') throw new Error('unreachable: sync 必须是 error');
    expect(status.reason).toBe('undecryptable-page');
    expect(status.retryable).toBe(false);
    // 诊断文本必须可机器定位，且**不得混进我们写的中文**（否则英文界面会中英混排）
    expect(status.message ?? '').not.toMatch(/[\u4e00-\u9fff]/);

    // ⑤ 再同步一次仍从 3 开始 —— 没有静默跳过
    const second = await client.sync();
    expect(second.kind).toBe('error');
    expect(server.logLines[1]).toBe(
      'Download: 12 ops (sinceSeq=3, latestSeq=15, hasMore=false, gap=false)',
    );
    expect(await readCursor(adapter)).toBe(3);
    expect(await adapter.count(STORES.OPS)).toBe(0);
  });

  it('对照：同一页换**正确口令** → 12 条全部落库、游标推进到 15', async () => {
    const dir = tempDir();
    const server = new StubServer();
    await server.seedEncryptedWithPasswordA(12, 4);

    const { adapter, engine, client } = await makeDevice(
      server,
      PASSWORD_A,
      3,
      dir,
      'device-A2',
    );

    const status = await client.sync();

    expect(status).toEqual({ kind: 'synced', at: expect.any(Number) });
    expect(await readCursor(adapter)).toBe(15);
    expect(await adapter.count(STORES.OPS)).toBe(12);
    expect(Object.keys(engine.getState().habits)).toHaveLength(12);
  });
});
