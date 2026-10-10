/**
 * 托管 AI 服务端代理的**路由级**测试。
 * ======================================
 *
 * ## 这一层证明什么、不证明什么
 *
 * | 证明 | 怎么证 |
 * |---|---|
 * | **闸门顺序**（鉴权 → 权益 → 额度 → 境内 → 网络） | 每一步都用**两个独立观测量**：假上游自己的命中计数 + 库里的计数器行 |
 * | 拒绝时**一次上游都不打** | 假上游是一个真的进程内 HTTP 服务器，命中数是它自己数的（不是响应码推断出来的） |
 * | 拒绝时**额度一字未动** | PGlite = 真 PostgreSQL，直接 `SELECT requests` |
 * | **不保留内容**（ADR-0054 §3） | 提示词与补全各带一个标记串，然后断言它**既不在捕获到的全部日志里，也不在任何一张表的任何一行里** |
 * | 计数是**服务端自己的**（AGENTS §8.10） | 请求体里塞 `userId` / `requests` / `model`，断言它们一个都没生效 |
 *
 * ⚠️ **不**证明"真并发只放行 N 次" —— 那是 PGlite 证不了的（单连接），
 * 已有 `tests/integration/ai-metering-race.integration.spec.ts` 在真库上管这件事；
 * 本文件把额度设成 2 只是为了把"第 3 次被拒、库里还是 2"跑出来，
 * 那是**顺序**语义，不是并发语义（与 `ai-metering.pglite.spec.ts` 同一分工）。
 *
 * ⚠️ **不**证明真实供应商 —— 这台机器上没有境内供应商的可用凭据（ADR-0054 §8 第一条），
 * 所以上游是本文件里那个**假 HTTP 服务器**。它证明的是"这条路由会照白名单办事"，
 * 不是"DeepSeek 真的能被打通"。
 *
 * ## 为什么用真 HTTP 假上游而不是注入一个 `transport` 替身
 *
 * 注入替身只能证明"路由调用了我给的那个函数"；真服务器能证明**发出去的 URL、头与字节**
 * 就是路由自己算出来的那一套（`/chat/completions` 的拼接、`model` 来自配置、
 * `authorization` 只进请求头）。这与 `email-locale-wire.spec.ts` 起一个进程内 SMTP 接收器
 * 是同一条理由：**替身证明调用，载体证明线上形状。**
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import { managedAiProxyRoutes, MANAGED_AI_ERROR_CODES } from '../src/ai/managed-proxy.routes';
import { SERVER_MANAGED_MODEL_HOSTS, type ServerManagedModelHost } from '../src/ai/managed-upstream';
import type { SqlExecutor, SqlRunner } from '../src/billing/pricing-store';
import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/**
 * 计数器表**从发布中的迁移文件读**，不手抄（`ai-metering.pglite.spec.ts` /
 * `pricing-ddl.helper.ts` 同一条纪律：抄一份的测试只能证明"抄本是对的"，
 * 而迁移漂移时它会安静地继续通过）。
 */
const MIGRATION_SUFFIX = '_add_ai_usage_counters';
const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(MIGRATION_SUFFIX))
  .map((entry) => entry.name)
  .sort();
if (migrationDirs.length !== 1) {
  throw new Error(
    `期望恰好一笔 *${MIGRATION_SUFFIX} 迁移，实际 ${String(migrationDirs.length)} 笔：` +
      `${migrationDirs.join(', ') || '（一笔都没有）'}\n` +
      '   🔴 0 笔 = 那笔迁移不在了，本文件的"计数器一字未动"全部失去对象。',
  );
}
const COUNTERS_DDL = readFileSync(
  join(migrationsDir, String(migrationDirs[0]), 'migration.sql'),
  'utf8',
);
for (const anchor of ['CREATE TABLE "ai_usage_counters"', '"requests" INTEGER NOT NULL']) {
  if (!COUNTERS_DDL.includes(anchor)) {
    throw new Error(`迁移里找不到锚点 \`${anchor}\` —— 表结构被改了，请更新本文件的锚点而不是删断言。`);
  }
}

/** 权益判定用的 `subscriptions` **最小替身**（与 `ai-metering.pglite.spec.ts` 同一份形状）。 */
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
/** 本文件把额度设成 2 —— 只为把"第 3 次被拒"跑出来，**不是**改那份 300 的承诺。 */
const TEST_LIMIT = 2;

/** 与 `managed-proxy.routes.ts` 里那两个常量同值（那里是判据，这里是断言）。 */
const CONFLICT_STATUS = 409;
const UPGRADE_REQUIRED_STATUS = 402;

const SERVER_MODEL_ID = 'the-server-configured-model';
const UPSTREAM_API_KEY = 'sk-upstream-secret-should-never-appear';
const PROMPT_MARKER = 'PROMPT-MARKER-8f21c0';
const COMPLETION_MARKER = 'COMPLETION-MARKER-44b7ad';
const ECHO_MARKER = 'UPSTREAM-ECHOES-9d5f';

// ── 假上游：一个真的进程内 HTTP 服务器 ────────────────────────────────────
interface UpstreamHit {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

interface FakeUpstream {
  readonly baseUrl: string;
  hits(): UpstreamHit[];
  drain(): void;
  setMode(mode: 'json' | 'sse' | 'echo-error'): void;
  close(): Promise<void>;
}

const startFakeUpstream = (): Promise<FakeUpstream> => {
  const received: UpstreamHit[] = [];
  let mode: 'json' | 'sse' | 'echo-error' = 'json';

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'] as string | undefined,
        body,
      });

      if (mode === 'echo-error') {
        // 🔴 供应商的 4xx/5xx **经常把请求内容抄回来**（`Invalid 'messages[0].content: …'`）。
        // 这一支存在的意义就是打这条泄露口子。
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `${ECHO_MARKER} saw: ${body}` } }));
        return;
      }

      if (mode === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"part1"}}]}\n\n');
        res.end('data: {"choices":[{"delta":{"content":"part2"}}]}\n\n');
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl-1',
          model: SERVER_MODEL_ID,
          choices: [{ index: 0, message: { role: 'assistant', content: COMPLETION_MARKER } }],
        }),
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        hits: () => received.slice(),
        drain: () => {
          received.length = 0;
        },
        setMode: (next) => {
          mode = next;
        },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
};

// ── 记录用的 SQL 面：包一层，数出"这条路由发过几句" ──────────────────────
const createRecordingExecutor = (pglite: PGlite): { sql: SqlExecutor; statements: string[] } => {
  const statements: string[] = [];
  const base: SqlExecutor = {
    query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
      statements.push(sql);
      const res = await pglite.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    execute: async (sql: string, params: readonly unknown[] = []): Promise<number> => {
      statements.push(sql);
      const res = await pglite.query(sql, params as unknown[]);
      return res.affectedRows ?? 0;
    },
    transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => {
      await pglite.exec('BEGIN');
      try {
        const result = await fn(base);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sql: base, statements };
};

// ── 日志捕获 ──────────────────────────────────────────────────────────────
let logSpy: ReturnType<typeof vi.spyOn>[] = [];
const capturedLogs = (): string =>
  logSpy
    .flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => String(a)).join(' ')))
    .join('\n');

let pglite: PGlite;
let recording: { sql: SqlExecutor; statements: string[] };
let upstream: FakeUpstream;
let app: FastifyInstance | undefined;

/** 路由用的那一份选项。**除测试外没人传 `hosts` / `plaintextHosts`** —— 见 `src/server.ts`。 */
const buildApp = async (
  overrides: Partial<{
    upstream: { baseUrl: string; apiKey: string; modelId: string } | undefined;
    hosts: readonly ServerManagedModelHost[];
    plaintextHosts: readonly string[];
  }> = {},
): Promise<void> => {
  app = Fastify();
  // 🔴 用 `in` 而不是 `??` 判"有没有传 upstream"：`{ upstream: undefined }` 是这条
  // 用例**故意**给的形状（"这台实例没配上游"）。用 `??` 会把它当成"没传"、
  // 于是拿默认的那份合格配置去跑，测试就在测一件不存在的事 —— 而且是**绿**的。
  const upstreamValue =
    'upstream' in overrides
      ? overrides.upstream
      : {
          baseUrl: upstream.baseUrl,
          apiKey: UPSTREAM_API_KEY,
          modelId: SERVER_MODEL_ID,
        };
  await app.register(managedAiProxyRoutes, {
    prefix: '/api/ai',
    upstream: upstreamValue,
    sql: recording.sql,
    limit: TEST_LIMIT,
    now: () => NOW,
    // 生产表里没有回环地址 ⇒ 测试必须注入一张合成表，否则"假上游合格"这件事
    // 本身就是一次例外。（这正是 `packages/ai` 把表做成入参的同一条理由。）
    hosts: overrides.hosts ?? [
      {
        host: '127.0.0.1',
        provider: '本文件的假上游（进程内 HTTP 服务器）',
        jurisdiction: 'cn',
        evidence: '合成表：只为把这条路由接到本地假上游；生产表里没有回环地址。',
      },
    ],
    plaintextHosts: overrides.plaintextHosts ?? ['127.0.0.1'],
  });
  await app.ready();
};

const seedEntitlement = async (grants: readonly string[] = ['hosting', 'ai']): Promise<void> => {
  await pglite.query(
    `INSERT INTO subscriptions (user_id, status, grants, current_period_end)
     VALUES ($1, 'active', $2::text[], $3)`,
    [1, grants as unknown[], PERIOD_END],
  );
};

const counterRow = async (): Promise<{ requests: number; user_id: number } | null> => {
  const res = await pglite.query<{ requests: number; user_id: number }>(
    'SELECT user_id, requests FROM ai_usage_counters',
  );
  return res.rows[0] ?? null;
};

/**
 * 库里**任何一张表的任何一行**都不许出现标记串（ADR-0054 §3）。
 *
 * 遍历而不是点名查 `ai_usage_counters`：只盯着那一张，就等于假设"内容只可能被存在
 * 我们想到的那张表里"—— 而 ADR-0054 §2 说的正是**下一次想加的列**不在黑名单上。
 */
const dumpAllRows = async (): Promise<string> => {
  const tables = await pglite.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const parts: string[] = [];
  for (const row of tables.rows) {
    const res = await pglite.query(`SELECT * FROM "${row.table_name}"`);
    for (const record of res.rows as unknown[]) {
      // 🔴 replacer 是必需的，不是保险丝：`int8`/`bigint` 列在部分驱动下真的是 `bigint`，
      // 而 `JSON.stringify(bigint)` **抛异常** —— 那会让整条"不保留内容"的判据
      // 变成一个看不懂的 setup 错误，最容易被误读成"测试坏了"。
      parts.push(
        JSON.stringify(record, (_key, value) =>
          typeof value === 'bigint' ? String(value) : value,
        ) ?? '',
      );
    }
  }
  return parts.join('\n');
};

const chatBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  feature: 'capture',
  messages: [{ role: 'user', content: `今天的任务：${PROMPT_MARKER}` }],
  ...extra,
});

const authHeaders = { authorization: 'Bearer mock-token', 'content-type': 'application/json' };

const post = (body: unknown, headers: Record<string, string> = authHeaders) =>
  app!.inject({
    method: 'POST',
    url: '/api/ai/managed/chat',
    headers,
    payload: body,
  });

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(MINIMAL_USERS_DDL);
  await pglite.exec(MINIMAL_SUBSCRIPTIONS_DDL);
  await pglite.exec(COUNTERS_DDL);
  await pglite.query('INSERT INTO users (id, email) VALUES (1, $1)', ['owner@example.test']);
  recording = createRecordingExecutor(pglite);
  upstream = await startFakeUpstream();
});

afterAll(async () => {
  await app?.close();
  await upstream.close();
  await pglite.exec('DROP TABLE IF EXISTS ai_usage_counters; DROP TABLE IF EXISTS subscriptions; DROP TABLE IF EXISTS users;');
  await pglite.close();
});

beforeEach(async () => {
  logSpy = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
  upstream.setMode('json');
  upstream.drain();
  recording.statements.length = 0;
  await pglite.exec('DELETE FROM ai_usage_counters; DELETE FROM subscriptions;');
  await seedEntitlement();
  await buildApp();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('闸门顺序：每一步都有两个独立观测量', () => {
  it('放行：上游命中**恰好一次**、计数器 +1、响应原样透传', async () => {
    const res = await post(chatBody());
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(COMPLETION_MARKER);
    expect(upstream.hits()).toHaveLength(1);
    const row = await counterRow();
    expect(row?.requests).toBe(1);
    expect(row?.user_id).toBe(1);
  });

  it('🔴 无令牌 ⇒ 401，且**一条 SQL 都没发**、上游零命中（证明鉴权排在权益与额度之前）', async () => {
    const res = await post(chatBody(), { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(401);
    expect(recording.statements).toHaveLength(0);
    expect(upstream.hits()).toHaveLength(0);
    expect(await counterRow()).toBeNull();
  });

  it('🔴 没有 `ai` 权益 ⇒ 402 `SUBSCRIPTION_REQUIRED`，**连计数器行都不创建**、上游零命中', async () => {
    await pglite.exec("DELETE FROM subscriptions; INSERT INTO subscriptions (user_id, status, grants, current_period_end) VALUES (1, 'active', ARRAY['hosting'], " + String(PERIOD_END) + ');');
    const res = await post(chatBody());
    expect(res.statusCode).toBe(UPGRADE_REQUIRED_STATUS);
    expect(res.json()).toMatchObject({
      code: MANAGED_AI_ERROR_CODES.ENTITLEMENT_REQUIRED,
      reason: 'GRANT_NOT_INCLUDED',
    });
    expect(upstream.hits()).toHaveLength(0);
    // 「连行都不创建」是权益**排在额度之前**的证据：反过来写的 check-then-consume
    // 会先插一行 requests=1 再判权益，那时这一条就红了。
    expect(await counterRow()).toBeNull();
  });

  it('🔴 额度用满 ⇒ 第 N+1 次 409 `AI_QUOTA_EXCEEDED`，计数**一字未动**、上游**不再被命中**', async () => {
    for (let i = 0; i < TEST_LIMIT; i += 1) {
      const ok = await post(chatBody());
      expect(ok.statusCode).toBe(200);
    }
    expect(upstream.hits()).toHaveLength(TEST_LIMIT);
    expect((await counterRow())?.requests).toBe(TEST_LIMIT);

    const res = await post(chatBody());
    expect(res.statusCode).toBe(CONFLICT_STATUS);
    expect(res.json()).toMatchObject({
      code: MANAGED_AI_ERROR_CODES.QUOTA_EXCEEDED,
      reason: 'QUOTA_EXCEEDED',
      detail: { used: TEST_LIMIT, limit: TEST_LIMIT },
    });
    // 这两行就是"额度检查在上游调用**之前**"的判据：
    // 把顺序挪到转发之后 ⇒ 命中数变 3、used 变 3，本条立刻红。
    expect(upstream.hits()).toHaveLength(TEST_LIMIT);
    expect((await counterRow())?.requests).toBe(TEST_LIMIT);
  });

  it('请求体不合法 ⇒ 400，且**不消耗额度**（格式错误不该算一次使用）', async () => {
    const res = await post({ feature: 'capture' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: MANAGED_AI_ERROR_CODES.INVALID_BODY });
    expect(upstream.hits()).toHaveLength(0);
    expect(await counterRow()).toBeNull();
  });

  it('词表外的 `feature` ⇒ 400（日志里的功能名必须是封闭词表，ADR-0054 §4）', async () => {
    const res = await post(chatBody({ feature: 'read-my-tasks' }));
    expect(res.statusCode).toBe(400);
    expect(capturedLogs()).not.toContain('read-my-tasks');
  });

  it('🔴 体积闸门只看大小、**不回显内容**：超大请求 ⇒ 400 且零消耗', async () => {
    const res = await post(chatBody({
      messages: [{ role: 'user', content: `${PROMPT_MARKER}${'x'.repeat(300 * 1024)}` }],
    }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: MANAGED_AI_ERROR_CODES.INVALID_BODY,
      reason: 'too_large',
    });
    expect(upstream.hits()).toHaveLength(0);
    expect(await counterRow()).toBeNull();
    expect(capturedLogs()).not.toContain(PROMPT_MARKER);
  });
});

describe('境内白名单在服务端强制（不是形容词）', () => {
  it('在表上但所在地是 `foreign` ⇒ 409，且假上游命中数**自己**说 0', async () => {
    await app?.close();
    await buildApp({
      hosts: [
        {
          host: '127.0.0.1',
          provider: '合成：境外主体',
          jurisdiction: 'foreign',
          evidence: '合成表：证明「在表上 ≠ 合格」那一支真的会拒。',
        },
      ],
    });
    const res = await post(chatBody());
    expect(res.statusCode).toBe(CONFLICT_STATUS);
    expect(res.json()).toMatchObject({
      code: MANAGED_AI_ERROR_CODES.UPSTREAM_NOT_DOMESTIC,
      reason: 'not-allowlisted',
    });
    expect(upstream.hits()).toHaveLength(0);
    expect(await counterRow()).toBeNull();
  });

  it('主机不在表上（包括同一个 host 写成别的端口/路径）⇒ 409 + 零命中', async () => {
    await app?.close();
    await buildApp({ hosts: [{ ...SERVER_MANAGED_MODEL_HOSTS[0]!, host: 'localhost' }] });
    const res = await post(chatBody());
    expect(res.statusCode).toBe(CONFLICT_STATUS);
    expect(res.json()).toMatchObject({ reason: 'not-allowlisted' });
    expect(upstream.hits()).toHaveLength(0);
  });

  it('🔴 **默认路由**（不注入 `plaintextHosts`）遇到明文 ⇒ 拒绝，且假上游零命中', async () => {
    // 这一条钉的是"那个默认值真的是空的"：`server.ts` 注册时不传这两个入参，
    // 所以生产上的明文上游走的就是这里这条路，而不是测试里被放行过的那条。
    await app?.close();
    await buildApp({ plaintextHosts: [] });
    const res = await post(chatBody());
    expect(res.statusCode).toBe(CONFLICT_STATUS);
    expect(res.json()).toMatchObject({ reason: 'plaintext' });
    expect(upstream.hits()).toHaveLength(0);
    expect(await counterRow()).toBeNull();
  });

  it('上游未配置 ⇒ 503 `MANAGED_AI_NOT_CONFIGURED`，不消耗额度', async () => {
    await app?.close();
    await buildApp({ upstream: undefined });
    const res = await post(chatBody());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: MANAGED_AI_ERROR_CODES.NOT_CONFIGURED });
    expect(await counterRow()).toBeNull();
  });

  it('🔴 预检与发送点复算**都在**：一次成功的请求恰好把白名单读 **2 趟**', async () => {
    // `domesticUpstreamVerdict` 里唯一读表元素的一步是
    // `table.find((entry) => entry.host === parsed.host)` —— 单元素且命中的表，
    // 每判一次恰好读一次 `host`。所以"读了 2 趟"= 判定跑了 2 次 = ④ 与 ⑥ 都在场。
    // ⚠️ 这一条**能**分清"只留一处"：摘掉 ④ 或 ⑥ 任意一处 ⇒ 趟数变成 1 ⇒ 立刻红，
    // 而下面那条"境外上游一字未动"只在摘掉 ④ 时红 —— 两条各管一个落点。
    let hostReads = 0;
    const probe: ServerManagedModelHost = {
      provider: '合成：读趟数探针',
      jurisdiction: 'cn',
      evidence: '合成表：单元素命中的表，每判一次读一次 host。',
      get host(): string {
        hostReads += 1;
        return '127.0.0.1';
      },
    };
    await app?.close();
    await buildApp({ hosts: [probe] });
    const res = await post(chatBody());
    expect(res.statusCode).toBe(200);
    expect(hostReads).toBe(2);
  });

  it('🔴 更强的那条：摘掉预检就会先扣额度 —— 所以**境外上游必须一字未动**', async () => {
    // 这一条与上面那条是**分工**的：上面那条证"判过"，这一条证"判在消耗之前"。
    // 把 `managed-proxy.routes.ts` 的 ④ 摘掉（只留 ⑥），本条立刻红在 `counterRow()` 上，
    // 而上面那条仍然绿 —— 也就是说"只留发送点那一次"这种写法**骗不过这一组**。
    await app?.close();
    await buildApp({ hosts: [], plaintextHosts: ['127.0.0.1'] });
    const res = await post(chatBody());
    expect(res.statusCode).toBe(CONFLICT_STATUS);
    expect(res.json()).toMatchObject({ reason: 'not-allowlisted' });
    expect(upstream.hits()).toHaveLength(0);
    expect(await counterRow()).toBeNull();
  });
});

describe('计数是服务端自己的，不是客户端自报的（AGENTS §8.10）', () => {
  it('请求体里的 `userId` / `requests` / `limit` / `model` **一个都不生效**', async () => {
    const res = await post(
      chatBody({ userId: 999, requests: 99999, limit: 99999, used: 0, model: 'gpt-whatever' }),
    );
    expect(res.statusCode).toBe(200);
    // 归属来自令牌（users 里只有 id=1；999 会撞外键 ⇒ 这一条同时也是"外键在场"的证据）。
    const row = await counterRow();
    expect(row?.user_id).toBe(1);
    expect(row?.requests).toBe(1);
    // 模型 id 由**服务端配置**决定（ADR-0021「换模型就是改价」）。
    expect(JSON.parse(String(upstream.hits()[0]?.body)).model).toBe(SERVER_MODEL_ID);
  });

  it('🔴 上游只收到 `/chat/completions`、`authorization` 走**请求头**而不是 URL', async () => {
    await post(chatBody());
    const hit = upstream.hits()[0];
    expect(hit?.url).toBe('/v1/chat/completions');
    expect(hit?.method).toBe('POST');
    expect(hit?.authorization).toBe(`Bearer ${UPSTREAM_API_KEY}`);
    expect(hit?.url).not.toContain(UPSTREAM_API_KEY);
  });
});

describe('不保留内容（ADR-0054 §3）', () => {
  it('🔴 标记串既不在日志里，也不在**任何一张表的任何一行**里', async () => {
    const res = await post(chatBody());
    expect(res.statusCode).toBe(200);

    const logs = capturedLogs();
    expect(logs).not.toContain(PROMPT_MARKER);
    expect(logs).not.toContain(COMPLETION_MARKER);
    expect(logs).not.toContain(UPSTREAM_API_KEY);

    const dump = await dumpAllRows();
    expect(dump).not.toContain(PROMPT_MARKER);
    expect(dump).not.toContain(COMPLETION_MARKER);
    expect(dump).not.toContain(UPSTREAM_API_KEY);

    // 反向对照：**元数据确实记下来了** —— 否则"日志里没有内容"可能只是因为
    // 这条路上压根没打日志（AGENTS §7 第 50 条那一族："状态对"在"没生效"时也绿）。
    expect(logs).toContain('AI_PROXY_REQUEST');
    expect(logs).toContain('forwarded');
    expect(dump).toContain(String(PERIOD_END));
  });

  it('🔴 拒绝路径同样不泄露：额度用尽那一次的日志与响应里都没有标记串', async () => {
    for (let i = 0; i < TEST_LIMIT; i += 1) await post(chatBody());
    const res = await post(chatBody());
    expect(res.statusCode).toBe(CONFLICT_STATUS);
    expect(res.payload).not.toContain(PROMPT_MARKER);
    expect(capturedLogs()).not.toContain(PROMPT_MARKER);
  });

  it('🔴 上游把请求内容抄进 4xx 错误文本时，我们**不回显、不落盘**', async () => {
    upstream.setMode('echo-error');
    const res = await post(chatBody());
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      code: MANAGED_AI_ERROR_CODES.UPSTREAM_FAILED,
      reason: 'upstream_status',
    });
    // 这三行是这条用例的全部意义：上游的响应体里同时有 ECHO 与 PROMPT 两个标记。
    expect(res.payload).not.toContain(ECHO_MARKER);
    expect(res.payload).not.toContain(PROMPT_MARKER);
    expect(capturedLogs()).not.toContain(ECHO_MARKER);
    expect(capturedLogs()).not.toContain(PROMPT_MARKER);
    expect(await dumpAllRows()).not.toContain(ECHO_MARKER);
  });

  it('上游不可达时不回显底层错误文本', async () => {
    await app?.close();
    app = Fastify();
    await app.register(managedAiProxyRoutes, {
      prefix: '/api/ai',
      upstream: {
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKey: UPSTREAM_API_KEY,
        modelId: SERVER_MODEL_ID,
      },
      sql: recording.sql,
      limit: TEST_LIMIT,
      now: () => NOW,
      hosts: [
        {
          host: '127.0.0.1',
          provider: '合成',
          jurisdiction: 'cn',
          evidence: '合成表',
        },
      ],
      plaintextHosts: ['127.0.0.1'],
    });
    await app.ready();
    const res = await post(chatBody());
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ reason: 'unreachable' });
    expect(res.payload).not.toContain(PROMPT_MARKER);
    expect(capturedLogs()).not.toContain(PROMPT_MARKER);
  });
});

describe('响应透传', () => {
  it('非流式：客户端拿到的字节 = 上游回的字节（不重新序列化）', async () => {
    const res = await post(chatBody());
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.payload)).toMatchObject({ id: 'cmpl-1' });
  });

  it('流式：`stream: true` 时 SSE 的 content-type 与分片都原样过去', async () => {
    upstream.setMode('sse');
    const res = await post(chatBody({ stream: true }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('part1');
    expect(res.payload).toContain('part2');
    // 发出去的请求体里 `stream` 为真（上游要按 SSE 回）。
    expect(JSON.parse(String(upstream.hits()[0]?.body)).stream).toBe(true);
  });

  it('请求体里没有 `stream` 时**不**带上这个键（供应商会把它当显式 false）', async () => {
    await post(chatBody());
    expect(Object.keys(JSON.parse(String(upstream.hits()[0]?.body)))).toContain('messages');
    expect('stream' in JSON.parse(String(upstream.hits()[0]?.body))).toBe(false);
  });
});
