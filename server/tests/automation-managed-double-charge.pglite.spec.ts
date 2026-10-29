/**
 * A4：一次托管自动收集到底扣几下额度（现状取证）。
 * ==============================================
 *
 * 托管档的自动收集在**同一次物理调用**上碰得到两个 `consumeManagedAiRequest` 调用点：
 *
 * | 扣点 | 位置 | 触发者 |
 * |---|---|---|
 * | ① 预留 | `server/src/automation/ai-metering.ts`（`billingSource === 'managed'` 那一支） | 宿主 `POST /api/automation/events/:id/ai-attempt/reserve` |
 * | ② 代理 | `server/src/ai/managed-proxy.routes.ts`（放行前那次原子裁决） | 同一枚宿主随后打出的 `POST /api/ai/managed/chat` |
 *
 * 客户端那两条腿都真实存在：预留由 `packages/app-host/src/inbound-process.ts` 的
 * `reserve:` 装配、物理调用由 `packages/ai` 的托管档 transport 拼出 `managedChatUrl()`。
 *
 * 本文件用**真库**（PGlite）把这两条腿按宿主实际的先后顺序跑一遍，读的是
 * `ai_usage_counters.requests` 那一列本身 —— 不是语句桩、不是推断。
 *
 * ⚠️ 这条判据在 2026-10-29 从"钉现状（+2）"改成"钉承诺（+1）"：修法取
 * 「预留那一侧记为权威」——代理侧扣费前先原子认领一枚刚预留过、尚未被认领的
 * managed 尝试（`server/src/ai/managed-completion.ts::claimReservedAutomationCharge`），
 * 领到就跳过那一笔。认领标记是 `automation_ai_attempts.proxy_billed`（可空、无默认、无索引）。
 *
 * 载体形状沿用 `managed-proxy.routes.spec.ts`（真进程内 HTTP 假上游 + 真 Fastify 路由）
 * 与 `automation-ai-metering.pglite.spec.ts`（DDL 从发布中的迁移文件读，不手抄）。
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import { advanceAutomationAiAttempt, reconcileAutomationAiMetering, reserveAutomationAiAttempt } from '../src/automation/ai-metering';
import { invokeManagedAiCompletion } from '../src/ai/managed-completion';
import { managedAiProxyRoutes } from '../src/ai/managed-proxy.routes';
import { SERVER_MANAGED_AI_FEATURES } from '../src/ai/managed-upstream';
import type { SqlExecutor, SqlRunner } from '../src/billing/pricing-store';
import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/** 按**后缀**在盘上找迁移目录，不写死日期前缀（合流时编号会重排，写死会 ENOENT 红在探针自己身上）。 */
const migrationSqlFor = (suffix: string, anchors: readonly string[]): string => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort();
  if (dirs.length !== 1) throw new Error(`期望恰好一笔 *${suffix} 迁移，实际 ${String(dirs.length)} 笔：${dirs.join(', ') || '（一笔都没有）'}`);
  const sql = readFileSync(join(migrationsDir, String(dirs[0]), 'migration.sql'), 'utf8');
  for (const anchor of anchors) {
    if (!sql.includes(anchor)) throw new Error(`${dirs[0]}/migration.sql 里找不到 \`${anchor}\` —— 迁移被改名/重构时请更新锚点，别删断言`);
  }
  return sql;
};

const COUNTERS_DDL = migrationSqlFor('_add_ai_usage_counters', ['CREATE TABLE "ai_usage_counters"']);
const ATTEMPTS_DDL = migrationSqlFor('_add_automation_ai_attempts', ['CREATE TABLE "automation_ai_attempts"']);
const ATTEMPTS_DIRECT_DDL = migrationSqlFor('_separate_direct_automation_ai_attempts', ['ADD COLUMN "billing_source"']);
const ATTEMPTS_LOCAL_DDL = migrationSqlFor('_allow_local_automation_ai_attempts', ['automation_ai_attempts_billing_source_known']);
const ATTEMPTS_PROXY_BILLED_DDL = migrationSqlFor('_add_automation_attempt_proxy_billed', ['ADD COLUMN "proxy_billed"']);

const MINIMAL_SUBSCRIPTIONS_DDL = `
  CREATE TABLE subscriptions (
    id                  serial PRIMARY KEY,
    user_id             integer NOT NULL,
    status              text,
    grants              text[] NOT NULL DEFAULT ARRAY[]::text[],
    current_period_end  bigint
  );
`;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;
const PERIOD_END = NOW + 30 * DAY_MS;
/** 与生产那枚 300 无关：这里只要求"够放行这一次"，读数判的是**增量**。 */
const TEST_LIMIT = 300;
const RULE = '11111111-1111-4111-8111-111111111111';
const EVENT = 'evt-a4-double-charge-1';
const SERVER_MODEL_ID = 'the-server-configured-model';
const COMPLETION_MARKER = 'COMPLETION-MARKER-a4c0ffee';

const ATTEMPT_KEY = { userId: 1, ruleId: RULE, eventId: EVENT, parseVersion: 1, attempt: 1 };

// ── 假上游：一个真的进程内 HTTP 服务器（沿用 managed-proxy 那份载体理由）──
const upstreamHits: number[] = [];
let upstreamServer: Server;
let upstreamBaseUrl = '';

const startFakeUpstream = (): Promise<void> =>
  new Promise((resolve) => {
    upstreamServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        upstreamHits.push(Buffer.concat(chunks).byteLength);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'cmpl-1', model: SERVER_MODEL_ID, choices: [{ index: 0, message: { role: 'assistant', content: COMPLETION_MARKER } }] }));
      });
    });
    upstreamServer.listen(0, '127.0.0.1', () => {
      const { port } = upstreamServer.address() as AddressInfo;
      upstreamBaseUrl = `http://127.0.0.1:${String(port)}/v1`;
      resolve();
    });
  });

// ── PGlite 包一层 SqlExecutor（两条腿共用同一个数据库）─────────────────
let pglite: PGlite;
const createExecutor = (db: PGlite): SqlExecutor => {
  const base: SqlExecutor = {
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => (await db.query(sql, params as unknown[])).rows as T[],
    execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => ((await db.query(sql, params as unknown[])).affectedRows ?? 0),
    transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
      await db.exec('BEGIN');
      try {
        const result = await fn(base);
        await db.exec('COMMIT');
        return result;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return base;
};
let executor: SqlExecutor;

let app: FastifyInstance | undefined;

const buildApp = async (): Promise<void> => {
  app = Fastify();
  await app.register(managedAiProxyRoutes, {
    prefix: '/api/ai',
    upstream: { baseUrl: upstreamBaseUrl, apiKey: 'sk-upstream-secret-should-never-appear', modelId: SERVER_MODEL_ID },
    sql: executor,
    limit: TEST_LIMIT,
    now: () => NOW,
    // 生产表里没有回环地址 ⇒ 注入一张合成表，否则"假上游合格"这件事本身是例外。
    hosts: [{ host: '127.0.0.1', provider: '本文件的假上游（进程内 HTTP 服务器）', jurisdiction: 'cn', evidence: '合成表：只为把这条路由接到本地假上游；生产表里没有回环地址。' }],
    plaintextHosts: ['127.0.0.1'],
  });
  await app.ready();
};

const counterRequests = async (): Promise<number> => {
  const res = await pglite.query<{ requests: number }>('SELECT requests FROM ai_usage_counters WHERE user_id = 1');
  return Number(res.rows[0]?.requests ?? 0);
};

/** 托管档那条物理调用：feature 就是自动收集用的那枚。 */
const managedChat = () => app!.inject({
  method: 'POST',
  url: '/api/ai/managed/chat',
  headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
  payload: { feature: 'inbound-automation', messages: [{ role: 'user', content: '把这条告警解析成待办' }] },
});

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(MINIMAL_USERS_DDL);
  await pglite.exec(MINIMAL_SUBSCRIPTIONS_DDL);
  await pglite.exec(COUNTERS_DDL);
  await pglite.exec(ATTEMPTS_DDL);
  await pglite.exec(ATTEMPTS_DIRECT_DDL);
  await pglite.exec(ATTEMPTS_LOCAL_DDL);
  await pglite.exec(ATTEMPTS_PROXY_BILLED_DDL);
  await pglite.query('INSERT INTO users (id, email) VALUES (1, $1)', ['owner@example.test']);
  executor = createExecutor(pglite);
  await startFakeUpstream();
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((done) => upstreamServer.close(() => done()));
  await pglite.close();
});

beforeEach(async () => {
  upstreamHits.length = 0;
  await pglite.exec('DELETE FROM ai_usage_counters; DELETE FROM subscriptions; DELETE FROM automation_ai_attempts;');
  await pglite.query(
    `INSERT INTO subscriptions (user_id, status, grants, current_period_end) VALUES (1, 'active', $1::text[], $2)`,
    [['hosting', 'ai', 'automation'], PERIOD_END],
  );
  await buildApp();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('A4：托管档一次完整自动收集周期的额度增量', () => {
  it('托管代理确实认 `inbound-automation` 这枚 feature（否则下面那条读数测的是一件不存在的事）', async () => {
    expect(SERVER_MANAGED_AI_FEATURES).toContain('inbound-automation');
    const res = await managedChat();
    expect(res.statusCode).toBe(200);
    expect(await counterRequests()).toBe(1);
  });

  it('🔴 修法后：预留 + 物理调用 = 一次 managed 周期只扣 **1** 下', async () => {
    // ① 宿主先预留（生产里是 POST /api/automation/events/:id/ai-attempt/reserve，
    //    路由体就是转调这个函数；见 server/src/api.ts 的 ai-attempt/reserve）。
    const reserved = await reserveAutomationAiAttempt(ATTEMPT_KEY, NOW, TEST_LIMIT, executor, undefined, 'managed');
    expect(reserved.billingSource).toBe('managed');
    expect(await counterRequests()).toBe(1);

    // ② 再生产顺序：`inbound-runner.ts` 的 `meteredFetch` 是**先**把行推到 `sent`，**然后**才发请求。
    //    （老版本这条用例把这一步排在物理调用之后，测的是一张生产里不会出现的中间态。）
    expect(await advanceAutomationAiAttempt(ATTEMPT_KEY, 'reserved', 'sent', executor)).toBe(true);

    // ③ 宿主再把那一枚物理请求打到托管代理（packages/ai 的 managedChatUrl）。
    const chat = await managedChat();
    expect(chat.statusCode).toBe(200);
    expect(chat.payload).toContain(COMPLETION_MARKER);
    expect(upstreamHits).toHaveLength(1);

    // ④ 结算（sent → consumed）不产生新的扣点。
    expect(await advanceAutomationAiAttempt(ATTEMPT_KEY, 'sent', 'consumed', executor)).toBe(true);

    // 一次物理调用 = 1：代理侧认领了那一枚预留，没有扣第二笔。
    expect(await counterRequests()).toBe(1);

    // 对账读路径同戳读数：账本 1 次占用、计数器 1 次 —— 两本账现在对得上。
    const ledger = await reconcileAutomationAiMetering({ userId: 1, sql: executor });
    expect(ledger.periods).toHaveLength(1);
    expect(ledger.periods[0]?.chargedAttempts).toBe(1);
    expect(ledger.periods[0]?.counterRequests).toBe(1);
    expect(ledger.periods[0]?.short).toBe(false);
    expect(ledger.periods[0]?.unexplainedByAutomation).toBe(0);
  });

  it('认领只发生一次：同一枚预留之后再来一发不带预留的调用，照常扣（没有免票通道）', async () => {
    await reserveAutomationAiAttempt(ATTEMPT_KEY, NOW, TEST_LIMIT, executor, undefined, 'managed');
    await advanceAutomationAiAttempt(ATTEMPT_KEY, 'reserved', 'sent', executor);
    await managedChat();
    expect(await counterRequests()).toBe(1);
    // 这一发没有任何"刚预留过"的尝试可认领 ⇒ 走正常扣费。
    await managedChat();
    expect(await counterRequests()).toBe(2);
    expect(upstreamHits).toHaveLength(2);
  });

  it('两趟完整周期 = +2（不是 +4）：每枚预留各被认领一次', async () => {
    for (const attempt of [1, 2]) {
      const key = { ...ATTEMPT_KEY, attempt };
      await reserveAutomationAiAttempt(key, NOW, TEST_LIMIT, executor, undefined, 'managed');
      await advanceAutomationAiAttempt(key, 'reserved', 'sent', executor);
      await managedChat();
      await advanceAutomationAiAttempt(key, 'sent', 'consumed', executor);
    }
    expect(await counterRequests()).toBe(2);
    expect(upstreamHits).toHaveLength(2);
  });

  it('反向臂：摘掉预留那一步（只发物理调用）⇒ 恰好 +1，证明第二下来自预留', async () => {
    const chat = await managedChat();
    expect(chat.statusCode).toBe(200);
    expect(await counterRequests()).toBe(1);
  });

  it('对照组：`direct`（自带端点）那档预留不碰托管计数器', async () => {
    const reserved = await reserveAutomationAiAttempt(ATTEMPT_KEY, NOW, TEST_LIMIT, executor, undefined, 'direct');
    expect(reserved.billingSource).toBe('direct');
    expect(await counterRequests()).toBe(0);
    const ledger = await reconcileAutomationAiMetering({ userId: 1, sql: executor });
    expect(ledger.periods).toHaveLength(0);
  });

  it('退款臂：预留后没发出去（reserved → released）只退预留那一格，物理调用没发生 ⇒ 归零', async () => {
    await reserveAutomationAiAttempt(ATTEMPT_KEY, NOW, TEST_LIMIT, executor, undefined, 'managed');
    expect(await counterRequests()).toBe(1);
    expect(await advanceAutomationAiAttempt(ATTEMPT_KEY, 'reserved', 'released', executor, undefined, NOW)).toBe(true);
    expect(await counterRequests()).toBe(0);
  });
});

describe('A4：认领只属于设备走代理那条腿', () => {
  /** 服务端抽取那条腿（hosted-extraction）不写台账，所以它进补全时不许带 `claimReservedAttempt`。 */
  const hostedShapeCompletion = () => invokeManagedAiCompletion({
    upstream: { baseUrl: upstreamBaseUrl, apiKey: 'sk-stub', modelId: SERVER_MODEL_ID },
    sql: executor, limit: TEST_LIMIT, now: () => NOW,
    transport: async () => ({
      status: 200, contentType: 'application/json',
      text: async () => JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: COMPLETION_MARKER } }] }),
      stream: () => { throw new Error('not a stream'); },
    }),
    hosts: [{ host: '127.0.0.1', provider: '本文件的假上游', jurisdiction: 'cn', evidence: '合成表' }],
    plaintextHosts: ['127.0.0.1'],
    startedAt: NOW,
  }, { userId: 1, feature: 'inbound-automation', messages: [{ role: 'user', content: '把这条告警解析成待办' }] });

  it('不带认领标记（服务端抽取的形状）⇒ 即使有一枚孤儿 sent 预留在，也照常扣一次', async () => {
    // 造一枚"预留了但没发出去"的孤儿：state 推到 sent，然后没人再用它。
    await reserveAutomationAiAttempt(ATTEMPT_KEY, NOW, TEST_LIMIT, executor, undefined, 'managed');
    await advanceAutomationAiAttempt(ATTEMPT_KEY, 'reserved', 'sent', executor);
    const before = await counterRequests();

    const result = await hostedShapeCompletion();
    expect(result.ok).toBe(true);
    expect(await counterRequests(), '服务端抽取冒领了设备的预留 ⇒ 这一发白送').toBe(before + 1);
    // 那枚预留没有被标记成已结算 —— 它仍然属于设备那一次。
    const rows = await pglite.query<{ proxy_billed: boolean | null }>('SELECT proxy_billed FROM automation_ai_attempts');
    expect(rows.rows[0]?.proxy_billed).toBeNull();
  });
});
