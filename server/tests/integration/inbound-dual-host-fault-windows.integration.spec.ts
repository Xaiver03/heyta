/**
 * AC-3 的故障注入窗口：**两枚各自独立的真 SQLite 文件宿主** + 真 Fastify HTTP + 真 PostgreSQL，
 * 逐格跑 `docs/plans/inbound-automation.md`「AC-3 的故障注入窗口」那张表。
 *
 * 为什么这一档必须存在（而不是把窗口清单再抄一遍到别的层）：
 * 仓库里已有的相关判据**全部只到服务端那一侧** —— `inbound-worker-identity.integration.spec.ts`
 * 里的 clientA/clientB 只是两枚 clientId 字符串加服务端注册的 worker 行，没有任何客户端存储；
 * `inbound-process.spec.ts` 用的是 `MemoryDbAdapter` + `vi.fn` 假传输；`task-batch.spec.ts:141`
 * 那条"响应丢失"只有一个设备、没有回执/journal 参与。也就是说
 * **"两个独立宿主 + 真文件 + 真中断"这一格从来没被任何一层同时具备过**，
 * 而 AC-3 的原话要的正是这个形状（"两个独立真实宿主与独立数据库…观察任务数、op 数、回执与计量"）。
 *
 * 🔴 三件刻意的事：
 * ① **真进程终止**（窗口 2/4/5）由 `inbound-dual-host-child.mjs` 那一枚真子进程 SIGKILL 自己做。
 *    进程内"可控抛错 + 重开句柄"测的不是同一件事：抛错时内存态还在原地。父进程因此必须
 *    **数到** `KILLED_*` 那一行且退出形状是 `signal=SIGKILL` —— 否则"注入了"只是断言，不是读数。
 * ② **响应丢失**不是 sleep，而是请求真的发出去、服务端真的处理，然后把响应丢掉
 *    （`dropResponse`：读干 body 再抛网络错误 ⇒ 服务端已提交、客户端永别）。
 * ③ **租约到期不靠等墙钟**：直接把 `lease_expires_at` 推到过去。等 60 秒会把这一格变成
 *    "跑得慢就算通过"的那类判据。
 *
 * 每格打印 `WINDOW=<计划里的编号> RESULT=PASS <证据摘要>`，由
 * `research/tools/verify-inbound-dual-host.py` 拿**现量自计划的分母**逐号对账；
 * 那一侧还会拒绝 `Tests 0 passed`、任何 SKIP、以及"套件报了计划里没有的号"。
 *
 * 🔴 凭据：worker 令牌、收件私钥、E2EE 口令全是这一趟现造的合成值，只在内存与 stdin 管道里，
 * 不进 stdout、不进日志、不进证据文件。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as jwt from 'jsonwebtoken';
import { setArgon2ParamsForTesting } from '@heyta/sync-core';
import {
  claimAutomationEvent, createInboundRulesRemote, createTaskActions,
  openAppHost, publishAutomationResult, renewAutomationLease, requestCommitPermitAndJournal,
  type AppHost, type AutomationWorkerCredential, type InboundAutomationField,
} from '@heyta/app-host';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { signWebhook } from '@heyta/inbound-core';

const DATABASE_URL = process.env.DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const childPath = join(here, 'inbound-dual-host-child.mjs');

/**
 * 排障旋钮走**环境变量**，不往 vitest 的命令行里塞未知参数（那会变成一个和
 * “套件真跑不起来”长得一模一样的失败形状，归因会糊）。不带它 ⇒ 13 格全跑。
 * 🔴 它**不能**变成“安静消失”：被排除的格仍在做事之前报 SKIP，装置按 SKIP 判红，
 * 所以这一档只可能让人少花一次时间，不可能把“没验”读成“验过”。
 */
const only = (() => {
  const flag = process.env.HEYTA_DUAL_HOST_ONLY;
  if (flag === undefined || flag.trim() === '') return undefined;
  return new Set(flag.split(',').map((value) => Number(value.trim())).filter(Number.isFinite));
})();
const skipWindow = (window: number): boolean => {
  if (only === undefined || only.has(window)) return false;
  process.stdout.write(`WINDOW=${window} RESULT=SKIP 不在 HEYTA_DUAL_HOST_ONLY 里（排障旋钮，不算验收）\n`);
  return true;
};
const report = (window: number, evidence: string): void => {
  process.stdout.write(`WINDOW=${window} RESULT=PASS ${evidence}\n`);
};

type Tasks = Record<string, unknown>[];
const keyringValue = '22'.repeat(32);
const KEY_V1 = 'inbound-v1';
const KEY_V2 = 'inbound-v2';

describe.skipIf(!DATABASE_URL)('inbound fault windows across two independent real SQLite hosts', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const prior = { secret: process.env.JWT_SECRET, commit: process.env.AUTOMATION_COMMIT_KEYS,
    webhook: process.env.AUTOMATION_WEBHOOK_KEYS, mode: process.env.AUTOMATION_ENTITLEMENT_MODE, nodeEnv: process.env.NODE_ENV };
  const signing = { instanceId: randomUUID(), activeKeyId: 'test', keys: { test: '11'.repeat(32) } };
  const hosts = new Set<AppHost>();
  const directories: string[] = [];
  const users = new Set<number>();
  let base = '';
  let providerPort = 0;
  let server: Server;

  // 桩模型供给方：一条**真的** HTTP 服务器（被测的是宿主与服务端的协议，模型本来就在我方之外）。
  // 它能演三种真事：正常应答、收到请求后把连接打断、先挂着等放行。
  const provider = {
    sources: [] as Record<string, unknown>[],
    queue: [[{ title: 'Capture one' }]] as Tasks[],
    mode: 'ok' as 'ok' | 'drop' | 'hold',
    gate: null as null | Promise<void>,
    release: null as null | (() => void),
    reset(tasks: Record<string, unknown>[]) {
      this.sources = []; this.queue = [tasks]; this.mode = 'ok'; this.gate = null; this.release = null;
    },
    holdUntilReleased(tasks: Record<string, unknown>[]) {
      this.reset(tasks); this.mode = 'hold';
      this.gate = new Promise<void>((resolve) => { this.release = resolve; });
    },
  };

  /**
   * 等桩模型**真的**收到了请求。撤销/删规则这类注入必须落在"解析中"这一档：
   * 落在之前，测到的是另一条边界（凭据校验、规则未启用），而且会把后面的读数带偏 ——
   * 窗口 8 第一版就是这样：注入抢在 claim 之前，事件还停在 queued，于是接手那台**合法地**
   * 重新买了一次模型，而那一格承诺的恰好是"同一事件不多买一次"。
   */
  const waitProviderHit = async (expected = 1): Promise<void> => {
    for (let waited = 0; provider.sources.length < expected && waited < 5_000; waited += 25) {
      await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
    expect(provider.sources.length, `注入点之前供给方应已收到 ${expected} 次真实请求`).toBeGreaterThanOrEqual(expected);
  };

  const openDevice = async (name: string, userId: number, token: string,
    transport?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    options: { identityFromStore?: boolean } = {}): Promise<AppHost> => {
    const directory = await mkdtemp(join(tmpdir(), 'heyta-dual-host-'));
    directories.push(directory);
    const dbPath = join(directory, `${name}.sqlite`);
    const inner: typeof fetch = transport ?? ((input, init) => globalThis.fetch(input, init));
    const logged: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      try {
        const response = await inner(input, init);
        if (process.env.HEYTA_DUAL_HOST_DEBUG === '1') {
          process.stderr.write(`FETCH ${url} -> ${response.status} ${response.ok ? '' : await response.clone().text().catch(() => '')}\n`);
          if (url.includes('ai-attempt/reserve') || url.includes('commit-permit')) {
            process.stderr.write(`DBG body ${String((init as { body?: unknown })?.body)}\n`);
            process.stderr.write(`DBG events ${JSON.stringify(await db.$queryRawUnsafe(
              'SELECT event_id, rule_id, status, attempt, rule_version, lease_generation, '
              + '(lease_expires_at < now()) AS lease_stale, (expires_at < now()) AS event_expired '
              + 'FROM automation_events ORDER BY created_at DESC LIMIT 3'))}\n`);
            process.stderr.write(`DBG rules ${JSON.stringify(await db.$queryRawUnsafe(
              'SELECT id, version, enabled, parse_version, (deleted_at IS NOT NULL) AS deleted '
              + 'FROM automation_rules ORDER BY created_at DESC LIMIT 3'))}\n`);
            process.stderr.write(`DBG workers ${JSON.stringify(await db.$queryRawUnsafe(
              'SELECT id, sync_client_id, database_epoch, (revoked_at IS NOT NULL) AS revoked '
              + 'FROM automation_workers ORDER BY created_at DESC LIMIT 3'))}\n`);
          }
        }
        return response;
      } catch (error) {
        if (process.env.HEYTA_DUAL_HOST_DEBUG === '1') process.stderr.write(`FETCH-ERR ${url} :: ${String(error)}\n`);
        throw error;
      }
    };
    const host = await openAppHost({
      dbPath, driverFactory: () => new NodeSqliteDriver(dbPath),
      // 🔴 默认传固定 clientId 只是**让并行窗口一眼认出设备**；传它时宿主**不会写进 META**
      // （`host.ts` 的 `options.clientId ?? resolveClientId(adapter)`），于是"重启后 clientId 是否
      // 还是同一枚"这件事永远量不到。窗口 5 要的正是这件事，所以那一格显式要求**不传**，
      // 让 id 从库里读出来 —— 这才和生产一致（生产没有任何宿主传 clientId）。
      ...(options.identityFromStore ? {} : { clientId: `dual-host-${name}` }),
      serverUrl: base, token, accountId: String(userId),
      fetchImpl: logged,
    });
    hosts.add(host);
    return host;
  };
  const closeDevice = (host: AppHost): void => { hosts.delete(host); host.close(); };

  const signed = async (path: string, ruleId: string, eventId: string, keyId: string,
    method: 'POST' | 'GET', body: string): Promise<{ status: number; json: unknown }> => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhook(Uint8Array.from(Buffer.from(keyringValue, 'hex')), {
      method, path, ruleId, keyId, timestamp, eventId,
      contentType: 'application/json', body: new TextEncoder().encode(body),
    });
    const response = await fetch(`${base}${path}`, {
      method, redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-heyta-key-id': keyId,
        'x-heyta-timestamp': timestamp, 'x-heyta-event-id': eventId, 'x-heyta-signature': signature },
      ...(method === 'GET' ? {} : { body }),
    });
    return { status: response.status, json: await response.json().catch(() => undefined) };
  };
  const hookPath = (ruleId: string): string => `/api/automation/v1/hooks/${ruleId}`;
  const statusPath = (ruleId: string, eventId: string): string => `${hookPath(ruleId)}/events/${eventId}`;
  /** 真发送方。`loseResponse` 那一腿 = 服务端已答，客户端把响应丢了（窗口 1、窗口 6 的注入点）。 */
  const deliver = async (ruleId: string, eventId: string, body: string, keyId = KEY_V1,
    options: { loseResponse?: boolean } = {}): Promise<{ status: number; json: unknown; networkFailed: boolean }> => {
    const path = hookPath(ruleId);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhook(Uint8Array.from(Buffer.from(keyringValue, 'hex')), {
      method: 'POST', path, ruleId, keyId, timestamp, eventId,
      contentType: 'application/json', body: new TextEncoder().encode(body),
    });
    try {
      const response = await fetch(`${base}${path}`, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-heyta-key-id': keyId,
          'x-heyta-timestamp': timestamp, 'x-heyta-event-id': eventId, 'x-heyta-signature': signature },
        body,
      });
      if (options.loseResponse === true) {
        await response.arrayBuffer();
        throw new TypeError('injected response loss after the server answered');
      }
      return { status: response.status, json: await response.json(), networkFailed: false };
    } catch {
      if (options.loseResponse === true) return { status: 0, json: undefined, networkFailed: true };
      throw new Error(`webhook delivery failed for ${eventId}`);
    }
  };

  /** 一台新设备**真正**入组：用同一口令解开远端已存在的 key package，不是另造一枚 root。 */
  const joinVault = async (host: AppHost, passphrase: string): Promise<void> => {
    const session = await host.getVaultSession();
    if (session === undefined) throw new Error('no vault session');
    if (session.state === 'unlocked') return;
    await session.unlockWithPassphrase(passphrase);
  };
  const createVault = async (host: AppHost, passphrase: string): Promise<void> => {
    const session = await host.getVaultSession();
    if (session === undefined) throw new Error('no vault session');
    if (session.state === 'unlocked') return;
    const pending = await session.beginCreation(passphrase);
    // 第三枚参数是**现在就往服务端发布** key package。不带它时发布排在下一次 sync 之后，
    // 而第二台设备在 sync 之前就要用同一口令解包 ⇒ 读到的是 `Vault key package is missing`。
    await session.confirmAndPublish(pending, pending.recoveryCode, host.getVaultKeyPackageRemote());
  };

  const runChildHost = (recipe: Record<string, unknown>): Promise<{ stdout: string; code: number | null; signal: string | null }> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [childPath], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code, signal) => { resolve({ stdout: stdout + (stderr.trim() === '' ? '' : `\n[stderr] ${stderr.trim().slice(0, 500)}`), code, signal }); });
      child.stdin.end(JSON.stringify(recipe));
    });
  const childRecipe = (host: AppHost, s: Scenario, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    base, token: s.token, userId: String(s.userId), accountId: String(s.userId),
    dbPath: host.dbPath, clientId: host.clientId, passphrase: s.passphrase, databaseEpoch: s.epoch,
    providerPort, registerWorker: false, allowedFields: s.allowedFields, ...extra,
  });
  const expectKilled = (killed: { stdout: string; code: number | null; signal: string | null }, token: string): void => {
    expect(killed.signal, `子进程该被 SIGKILL，实得 code=${killed.code}；输出：${killed.stdout}`).toBe('SIGKILL');
    expect(killed.stdout).toContain(token);
    expect(killed.stdout).not.toContain('FAIL ');
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'inbound-dual-host-integration-secret-32';
    process.env.NODE_ENV = 'test';
    process.env.AUTOMATION_COMMIT_KEYS = JSON.stringify(signing);
    process.env.AUTOMATION_WEBHOOK_KEYS = JSON.stringify({ keys: { [KEY_V1]: keyringValue, [KEY_V2]: keyringValue } });
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });

    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let source: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(raw) as { messages?: { content?: string }[] };
          source = (JSON.parse(String(parsed.messages?.at(-1)?.content ?? '{}')) as { source?: Record<string, unknown> }).source ?? {};
        } catch { /* 计数仍要成立 */ }
        provider.sources.push(source);
        const respond = () => {
          const tasks = provider.queue.length > 1 ? provider.queue.shift() : provider.queue[0];
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks }) } }] }));
        };
        if (provider.mode === 'drop') { res.destroy(); return; }
        if (provider.mode === 'hold') { void provider.gate?.then(respond); return; }
        respond();
      });
    });
    await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, () => resolve()));
    providerPort = (server.address() as { port: number }).port;

    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    const { apiRoutes } = await import('../../src/api');
    const { inboundAutomationRoutes } = await import('../../src/automation/inbound.routes');
    initSyncService();
    // 🔴 Fastify 一旦 boot 就再也 register 不进东西（症状是 `Root plugin has already booted`），
    // 而 `serverOrigin` 进的是**信封 AAD**：接收端按它封，宿主按自己那条 origin 解，
    // 两边必须逐字相同。所以 origin 不能在 listen 之后再取，只能**先占定端口再注册**。
    // 端口是先探后用（有一次让出），若被别进程抢走 listen 会响亮失败，不会静默换端口。
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen({ host: '127.0.0.1', port: 0 }, () => {
        const taken = (probe.address() as { port: number }).port;
        probe.close(() => { resolve(taken); });
      });
    });
    base = `http://127.0.0.1:${port}`;
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(inboundAutomationRoutes, { prefix: '/api', serverOrigin: base });
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.listen({ host: '127.0.0.1', port });
    await app.ready();
  }, 90_000);

  afterEach(async () => {
    for (const host of [...hosts]) closeDevice(host);
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
    for (const userId of users) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    users.clear();
    provider.reset([{ title: 'Capture one' }]);
  });

  afterAll(async () => {
    await app.close();
    server?.close();
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db'); await disconnectDb();
    for (const [key, value] of Object.entries({ JWT_SECRET: prior.secret, AUTOMATION_COMMIT_KEYS: prior.commit,
      AUTOMATION_WEBHOOK_KEYS: prior.webhook, AUTOMATION_ENTITLEMENT_MODE: prior.mode, NODE_ENV: prior.nodeEnv })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  interface Scenario {
    userId: number; token: string; epoch: string; passphrase: string; rule: { id: string; version: number };
    eventId: string; body: string; devices: Map<string, AppHost>; workerA: AutomationWorkerCredential;
    recipientPrivateKey: Uint8Array | undefined; allowedFields: readonly InboundAutomationField[];
    deliverEvent: (options?: { loseResponse?: boolean }) => Promise<{ status: number; json: unknown; networkFailed: boolean }>;
    rules: ReturnType<typeof createInboundRulesRemote>;
  }

  /** 一账号 + 一条活跃订阅（官方模式的权益来源）+ 设备 A（建 Vault、登记 worker、发布收件公钥）+ 一条启用规则。 */
  const scenario = async (options: {
    devices?: readonly string[]; timezone?: string | null; allowedFields?: readonly InboundAutomationField[];
    tasks?: Record<string, unknown>[]; loseSyncAck?: boolean; identityFromStore?: boolean;
  } = {}): Promise<Scenario> => {
    const passphrase = `dual-host-${randomUUID()}`;
    const user = await db.user.create({ data: { email: `dual-${randomUUID()}@test.local`, isVerified: 1 } });
    users.add(user.id);
    await db.subscription.create({ data: { userId: user.id, status: 'active', grants: ['ai', 'automation'],
      currentPeriodEnd: BigInt(Date.now() + 86400000) } });
    const token = jwt.sign({ userId: user.id, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!);
    const epoch = randomUUID();
    const allowedFields = options.allowedFields ?? ['title'];
    const devices = new Map<string, AppHost>();
    let workerA!: AutomationWorkerCredential;
    let recipientPrivateKey: Uint8Array | undefined;
    for (const name of options.devices ?? ['a']) {
      const host = await openDevice(name, user.id, token,
        name === 'a' && options.loseSyncAck === true ? dropSyncAck : undefined,
        { identityFromStore: options.identityFromStore === true });
      if (name === 'a') {
        await createVault(host, passphrase);
        workerA = await host.registerInboundWorker({ userId: String(user.id), databaseEpoch: epoch });
        await host.ensureInboundRecipientKey();
        recipientPrivateKey = await host.loadInboundRecipientKey({ accountId: String(user.id), serverOrigin: base, keyEpoch: 1 });
      } else {
        await joinVault(host, passphrase);
        await host.registerInboundWorker({ userId: String(user.id), databaseEpoch: randomUUID() });
        // 这一枚"把 A 现读的私钥交给 B"是**宿主安全存储桥**的模拟（saveInboundRecipientKey 的注释就写着
        // "private key supplied by the host's secure-store bridge"）。真设备上这条桥长什么样是窗口 10 那格
        // 单独在量的事，不在这里当成既成事实。
        if (recipientPrivateKey !== undefined) {
          await host.saveInboundRecipientKey({ accountId: String(user.id), serverOrigin: base, keyEpoch: 1 }, recipientPrivateKey);
        }
      }
      devices.set(name, host);
    }
    const rules = createInboundRulesRemote({ baseUrl: base, getToken: async () => token });
    const rule = await rules.create(KEY_V1, { allowedFields, timezone: options.timezone ?? null, parseVersion: 1, maxItems: 50 });
    await rules.setEnabled(rule.id, true);
    provider.reset(options.tasks ?? [{ title: 'Capture one' }]);
    const eventId = randomUUID();
    const body = JSON.stringify({ title: 'Inbox note', secret: 'must-not-leave' });
    return { userId: user.id, token, epoch, passphrase, rule, eventId, body, devices, workerA,
      recipientPrivateKey, allowedFields, rules,
      deliverEvent: (deliverOptions = {}) => deliver(rule.id, eventId, body, KEY_V1, deliverOptions) };
  };

  /** 上传那一次：服务端真收下之后，把响应丢掉 —— 这就是"ACK 丢失"，不是 sleep。 */
  const dropSyncAck: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const response = await globalThis.fetch(input, init);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.includes('/api/sync/')) {
      await response.arrayBuffer();
      throw new TypeError('injected sync ACK loss');
    }
    return response;
  };

  // 🔴 路由与同意这两项**默认逐字不变**（回环桩 + 空同意），只有明确要量出境闸门的格子才覆盖它们。
  // 类型取自宿主自己的入参，不另从 `@heyta/ai` 引一遍 —— 那会让服务端测试依赖一个它没有的包。
  type CycleInput = Parameters<AppHost['processInboundAutomation']>[0];
  const cycle = (s: Scenario, name: string, extra: {
    timezone?: string; eventId?: string; routing?: CycleInput['routing']; consents?: CycleInput['consents'];
  } = {}) =>
    s.devices.get(name)!.processInboundAutomation({
      userId: String(s.userId), keyEpoch: 1, allowedFields: s.allowedFields,
      routing: extra.routing ?? {
        enabled: true, allowRemote: false,
        endpoints: [{ id: 'stub', label: 'stub', endpoint: `http://127.0.0.1:${providerPort}/v1`, model: 'test' }],
        routes: { 'inbound-automation': [{ endpointId: 'stub' }] },
      },
      consents: extra.consents ?? [], systemPrompt: 'Return tasks JSON', parseVersion: 1,
      ...(extra.timezone === undefined ? {} : { timezone: extra.timezone }),
      ...(extra.eventId === undefined ? {} : { eventId: extra.eventId }),
    });

  const inboundOps = async (host: AppHost) => (await host.readOpLog()).filter((op) => String(op.id).startsWith('inbound:'));
  const batchOf = async (host: AppHost) => {
    const raw = (await inboundOps(host))[0]!.payload;
    // 读回来的 payload 是**对象**（引擎在本机已经把 JSON 解开了），发到线上才是字符串。
    // 以前这里无脑 `JSON.parse(String(...))`，于是把 `{}` 读成 `"[object Object]"` —— 报的是
    // SyntaxError，看上去像"界面/协议坏了"，其实是探针自己读错了形状。
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      tasks: { id: string; title: string; dueDate?: number; startDate?: number }[];
    };
  };
  const serverOps = (eventId: string) => db.operation.findMany({ where: { id: { startsWith: `inbound:${eventId}` } } });
  const eventRow = (userId: number, eventId: string) => db.automationEvent.findFirst({ where: { userId, eventId } });
  const expireLease = (userId: number, eventId: string) => db.automationEvent.update({
    where: { userId_eventId: { userId, eventId } }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  const synced = async (host: AppHost) => {
    const status = await host.sync();
    expect(status, JSON.stringify(status)).not.toMatchObject({ kind: 'error' });
    return status;
  };

  it('W0 基线：A 收进队列 → 真模型调用 → 一枚批 op → 同步 → B 拉到同一条任务', async () => {
    // W0 是分母外的对照格（基线）：排障旋钮下它也要**响一声**再退出，不许安静消失。
    if (only !== undefined && !only.has(0)) {
      process.stdout.write('BASELINE=SKIP 不在 HEYTA_DUAL_HOST_ONLY 里（对照格，不算验收）\n');
      return;
    }
    const s = await scenario({ devices: ['a', 'b'], tasks: [{ title: 'Capture one', priority: 1 }, { title: 'Capture two' }] });
    expect((await s.deliverEvent()).status).toBe(202);
    expect((await cycle(s, 'a')).state).toBe('submitted');
    expect(await batchOf(s.devices.get('a')!)).toMatchObject({ tasks: [{ title: 'Capture one' }, { title: 'Capture two' }] });
    await synced(s.devices.get('a')!);
    expect((await serverOps(s.eventId)).length).toBe(1);
    await synced(s.devices.get('b')!);
    expect((await inboundOps(s.devices.get('b')!)).length).toBe(1);
    expect(createTaskActions(s.devices.get('b')!).findTask(`inbound:${s.eventId}:0`)?.title).toBe('Capture one');
  }, 90_000);

  it('W1 队列已落盘、接收 HTTP 响应丢失；发送方以原键重试', async () => {
    if (skipWindow(1)) return;
    const s = await scenario();
    const lost = await s.deliverEvent({ loseResponse: true });
    expect(lost.networkFailed).toBe(true);
    const row = await eventRow(s.userId, s.eventId);
    expect(row?.status).toBe('queued');
    expect(row?.payloadCiphertext).not.toBeNull();
    expect((await s.deliverEvent()).status).toBe(202);
    expect(await db.automationEvent.count({ where: { userId: s.userId, eventId: s.eventId } })).toBe(1);
    const conflict = await deliver(s.rule.id, s.eventId, JSON.stringify({ title: 'different bytes' }));
    expect(conflict.status).toBe(409);
    expect(await db.automationEvent.count({ where: { userId: s.userId, eventId: s.eventId } })).toBe(1);
    report(1, `响应丢失后仍有 1 行 queued 且密文非空；原键重试 202 仍 1 行；异体重试 409（${conflict.status}）`);
  }, 90_000);

  it('W2 已领取、解析前【真进程终止】；租约到期后另一台真宿主接手', async () => {
    if (skipWindow(2)) return;
    const s = await scenario({ devices: ['a'], tasks: [{ title: 'After takeover' }] });
    expect((await s.deliverEvent()).status).toBe(202);
    const a = s.devices.get('a')!;
    closeDevice(a);
    const killed = await runChildHost(childRecipe(a, s, { killAfter: '/api/automation/events/claim' }));
    expectKilled(killed, `KILLED_AFTER /api/automation/events/claim`);
    expect(killed.stdout).not.toContain('v1/chat/completions');
    const claimed = await eventRow(s.userId, s.eventId);
    expect(claimed?.leaseGeneration).toBe(1);
    expect(claimed?.leaseWorkerId).toBe(s.workerA.workerId);
    expect(provider.sources.length).toBe(0);
    await expireLease(s.userId, s.eventId);
    const b = await openDevice('takeover', s.userId, s.token);
    await joinVault(b, s.passphrase);
    await b.registerInboundWorker({ userId: String(s.userId), databaseEpoch: randomUUID() });
    await b.saveInboundRecipientKey({ accountId: String(s.userId), serverOrigin: base, keyEpoch: 1 }, s.recipientPrivateKey!);
    expect((await cycle({ ...s, devices: new Map([['b', b]]) }, 'b')).state).toBe('submitted');
    const after = await eventRow(s.userId, s.eventId);
    expect(after?.leaseGeneration).toBe(2);
    expect(provider.sources.length).toBe(1);
    expect((await inboundOps(b)).length).toBe(1);
    expect(await db.automationCommitPermit.count({ where: { eventId: s.eventId } })).toBe(1);
    report(2, `子进程 claim 之后 SIGKILL（signal=${killed.signal}）⇒ gen=1、模型 0 次；过期转派给第二台真宿主 ⇒ gen=2、模型 1 次、1 op、1 许可`);
  }, 120_000);

  it('W3 模型已计量、结果响应丢失 ⇒ attempt=unknown；重试不得再买一次', async () => {
    if (skipWindow(3)) return;
    const s = await scenario({ tasks: [{ title: 'Metered' }] });
    expect((await s.deliverEvent()).status).toBe(202);
    provider.mode = 'drop';
    await expect(cycle(s, 'a')).rejects.toThrow();
    const attempts = await db.automationAiAttempt.findMany({ where: { userId: s.userId, eventId: s.eventId } });
    expect(attempts.map((row) => `${row.attempt}:${row.state}`)).toEqual(['1:unknown']);
    expect(await inboundOps(s.devices.get('a')!)).toHaveLength(0);
    // 第二腿：**同一台**设备立刻再跑一次。这一格要的从来不是宿主报哪个状态词，而是它
    // **没再买一次** —— 模型调用次数与账本行数都必须停在 1。
    provider.mode = 'ok';
    expect((await cycle(s, 'a')).state).toBe('empty');
    expect(provider.sources.length).toBe(1);
    expect(await db.automationAiAttempt.count({ where: { userId: s.userId, eventId: s.eventId } })).toBe(1);
    // 第三腿：租约到期、换**另一台真宿主**来领。这一腿才走到 `server/src/automation/events.ts:209-221`
    // 那条分支（代码注释原话："A new lease generation is not authorization to buy another model request"）。
    // 它的形状是"不给活，但把事件收成一个确定终态并带上可见原因"，而不是再发一次活。
    await expireLease(s.userId, s.eventId);
    const b = await openDevice('recover', s.userId, s.token);
    await joinVault(b, s.passphrase);
    await b.registerInboundWorker({ userId: String(s.userId), databaseEpoch: randomUUID() });
    await b.saveInboundRecipientKey({ accountId: String(s.userId), serverOrigin: base, keyEpoch: 1 }, s.recipientPrivateKey!);
    expect((await cycle({ ...s, devices: new Map([['b', b]]) }, 'b')).state).toBe('empty');
    const settled = await eventRow(s.userId, s.eventId);
    expect(settled?.status).toBe('needs-confirmation');
    expect(settled?.reasonCode).toBe('model-result-uncertain');
    expect(settled?.leaseWorkerId).toBeNull();
    expect(provider.sources.length).toBe(1);
    expect(await db.automationAiAttempt.count({ where: { userId: s.userId, eventId: s.eventId } })).toBe(1);
    expect(await inboundOps(b)).toHaveLength(0);
    report(3, `响应丢失 ⇒ attempt 1=unknown、零 op；同设备再跑读成"没活"且模型仍 1 次、账本仍 1 行；租约到期后**另一台真宿主**领取被拒 ⇒ 事件收成为 needs-confirmation + model-result-uncertain（确定终态+可见原因）、租约清空、账本仍 1 行`);
  }, 90_000);

  it('W4 结果已冻结、提交许可前【真进程终止】；接手方不得重新解释', async () => {
    if (skipWindow(4)) return;
    const s = await scenario({ devices: ['a'], tasks: [{ title: 'Frozen before permit' }] });
    expect((await s.deliverEvent()).status).toBe(202);
    const a = s.devices.get('a')!;
    closeDevice(a);
    const killed = await runChildHost(childRecipe(a, s, { killAfter: `/api/automation/events/${s.eventId}/result` }));
    expectKilled(killed, `KILLED_AFTER /api/automation/events/${s.eventId}/result`);
    const frozen = await eventRow(s.userId, s.eventId);
    expect(frozen?.status).toBe('prepared');
    expect(frozen?.resultCiphertext).not.toBeNull();
    expect(await db.automationCommitPermit.count({ where: { eventId: s.eventId } })).toBe(0);
    // 接手方给一个**不同**的候选答案 + 另一个处理时区：若它重新解释了结果就会再调一次模型。
    provider.queue = [[{ title: 'REEXPLAINED' }]];
    const b = await openDevice('recover', s.userId, s.token);
    await joinVault(b, s.passphrase);
    await b.registerInboundWorker({ userId: String(s.userId), databaseEpoch: randomUUID() });
    await b.saveInboundRecipientKey({ accountId: String(s.userId), serverOrigin: base, keyEpoch: 1 }, s.recipientPrivateKey!);
    expect((await cycle({ ...s, devices: new Map([['b', b]]) }, 'b', { timezone: 'Asia/Tokyo' })).state).toBe('submitted');
    expect(provider.sources.length).toBe(1);
    expect((await batchOf(b)).tasks.map((task) => task.title)).toEqual(['Frozen before permit']);
    report(4, `发布之后 SIGKILL ⇒ prepared 且 0 许可；第二台真宿主走恢复腿（模型调用仍 1 次）、本地 op 里是冻结那条标题而非 REEXPLAINED`);
  }, 120_000);

  it('W5 本地 op 已落盘、上传 ACK 未落地；同设备重启不再派发第二枚 op', async () => {
    if (skipWindow(5)) return;
    const s = await scenario({ devices: ['a'], identityFromStore: true,
      tasks: [{ title: 'Written locally' }, { title: 'Second item' }] });
    expect((await s.deliverEvent()).status).toBe(202);
    const a = s.devices.get('a')!;
    closeDevice(a);
    // 注入在上传**在途**时死：服务端可能已收也可能没收到，这正是"回执未完成"的含义；
    // 所以这一格判的是设备侧重启后的行为 —— 不许派发第二枚，也不许在服务端凑出两枚。
    const killed = await runChildHost(childRecipe(a, s, { killBefore: '/api/sync/ops', killBeforeMethod: 'POST', syncAfterCycle: true }));
    expect(killed.signal, killed.stdout).toBe('SIGKILL');
    expect(killed.stdout).toContain('CYCLE');
    const same = await openAppHost({ dbPath: a.dbPath, driverFactory: () => new NodeSqliteDriver(a.dbPath),
      serverUrl: base, token: s.token, accountId: String(s.userId) });
    hosts.add(same);
    // 🔴 这一句是这一格里**唯一**能证明"重开的还是同一台设备"的读数：id 没从测试传进去，
    // 只能从这条 SQLite 文件的 META 里读出来。传固定值时宿主根本不写 META
    // （`host.ts:397` 的 `options.clientId ?? resolveClientId(...)`），断言就退化成"我传什么它返回什么"。
    expect(same.clientId).toBe(a.clientId);
    // 重启后 Vault 是锁着的（root 只在这次运行的内存里），补传要先把口令放回去。
    await joinVault(same, s.passphrase);
    expect((await inboundOps(same)).length).toBe(1);
    expect(await db.operation.count({ where: { id: { startsWith: `inbound:${s.eventId}` } } })).toBeLessThanOrEqual(1);
    expect(['empty', 'submitted']).toContain((await cycle({ ...s, devices: new Map([['a', same]]) }, 'a')).state);
    expect((await inboundOps(same)).length).toBe(1);
    await synced(same);
    expect((await serverOps(s.eventId)).length).toBe(1);
    const batch = await batchOf(same);
    expect(batch.tasks.map((task) => task.title)).toEqual(['Written locally', 'Second item']);
    report(5, `ACK 在途 SIGKILL ⇒ 同库重开从 META 读回**同一枚** clientId（没传固定值）、本地仍 1 op、再跑一次仍 1 op；补传后服务端恰好 1 枚（两标题在同一 op 里）`);
  }, 120_000);

  it('W6 本地 op 已落盘未上传、ACK 丢失，A 租约过期后 B 领取：不得两次创建、不得偷偷降级成两枚 op', async () => {
    if (skipWindow(6)) return;
    const s = await scenario({ devices: ['a', 'b'], tasks: [{ title: 'Owned by A' }, { title: 'Also A' }] });
    const a = s.devices.get('a')!;
    const b = s.devices.get('b')!;
    expect((await s.deliverEvent()).status).toBe(202);
    expect((await cycle(s, 'a')).state).toBe('submitted');
    expect((await inboundOps(a)).length).toBe(1);
    expect(await db.operation.count({ where: { id: { startsWith: `inbound:${s.eventId}` } } })).toBe(0);
    await expireLease(s.userId, s.eventId);
    expect(['empty', 'needs-confirmation', 'waiting-entitlement']).toContain((await cycle(s, 'b')).state);
    expect((await inboundOps(b)).length).toBe(0);
    await synced(a);
    const uploaded = await serverOps(s.eventId);
    expect(uploaded.length).toBe(1);
    expect(uploaded[0]!.opType).toBe('BATCH');
    expect(String(uploaded[0]!.entityIds)).toContain(`inbound:${s.eventId}:1`);
    await synced(b);
    expect((await inboundOps(b)).length).toBe(1);
    expect(await db.operation.count({ where: { id: { startsWith: `inbound:${s.eventId}` } } })).toBe(1);
    report(6, `A 未上传时 B 领取后 0 op；A 带 owner receipt 补传 ⇒ 服务端恰好 1 枚 BATCH（两个 entityId 在同一 op 内，没降级成两枚），B 收敛到同一条`);
  }, 120_000);

  it('W7 A 持过期 lease 恢复、B 已获新 generation：A 的续租/发布/提交各按边界拒', async () => {
    if (skipWindow(7)) return;
    const s = await scenario({ devices: ['a', 'b'], tasks: [{ title: 'By B' }] });
    const b = s.devices.get('b')!;
    expect((await s.deliverEvent()).status).toBe(202);
    const claimed = await claimAutomationEvent({ baseUrl: base, token: s.token, worker: s.workerA });
    expect(claimed?.leaseGeneration).toBe(1);
    await expireLease(s.userId, s.eventId);
    expect((await cycle(s, 'b')).state).toBe('submitted');
    expect((await eventRow(s.userId, s.eventId))?.leaseGeneration).toBe(2);
    await expect(renewAutomationLease({ baseUrl: base, token: s.token, worker: s.workerA,
      eventId: s.eventId, leaseGeneration: 1 })).rejects.toThrow();
    await expect(publishAutomationResult({ baseUrl: base, token: s.token, worker: s.workerA, eventId: s.eventId,
      leaseGeneration: 1, parseVersion: 1, itemCount: 1, resultDigest: 'a'.repeat(64), resultCiphertext: 'stale' })).rejects.toThrow();
    await expect(requestCommitPermitAndJournal({ baseUrl: base, token: s.token, worker: s.workerA,
      request: { clientId: s.workerA.clientId, databaseEpoch: s.workerA.databaseEpoch, eventId: s.eventId,
        opId: `inbound:${s.eventId}`, ruleId: s.rule.id, ruleVersion: s.rule.version, parseVersion: 1,
        resultDigest: 'b'.repeat(64), itemCount: 1 },
      journal: { load: async () => undefined, save: async () => undefined, remove: async () => undefined } })).rejects.toThrow();
    expect(await db.automationCommitPermit.count({ where: { eventId: s.eventId } })).toBe(1);
    expect((await inboundOps(s.devices.get('a')!)).length).toBe(0);
    expect((await inboundOps(b)).length).toBe(1);
    report(7, `B 拿到 gen=2 后，A 用 gen=1 的 renew / publish / commit-permit 三条全拒；许可总数仍 1，A 本地 0 op、B 本地 1 op`);
  }, 120_000);

  it('W8 撤销族在解析中与提交前：权益到期（派发前/解析中两种顺序）、撤回同意、撤销凭据、删除规则、Vault 锁定 ⇒ 全部零多买零多写', async () => {
    if (skipWindow(8)) return;
    const s = await scenario({ devices: ['a', 'b'], tasks: [{ title: 'Blocked' }] });
    const a = s.devices.get('a')!;
    expect((await s.deliverEvent()).status).toBe(202);
    // ── ①a 权益在**派发那一步**就到期。不占桩模型的挂起：这一档要量的就是"没资格 ⇒ 一次都不发"。
    // `updateMany` 而不是 `update`：这一格要按 userId 改订阅，而 Prisma 的 `update` 只认唯一键
    // （`id` / `externalSubscriptionId`），拿 userId 当 where 是**校验期就炸**，不是数据库拒的。
    await db.subscription.updateMany({ where: { userId: s.userId }, data: { currentPeriodEnd: BigInt(Date.now() - 1000) } });
    expect((await cycle(s, 'a')).state).toBe('waiting-entitlement');
    expect(provider.sources.length).toBe(0);
    expect((await inboundOps(a)).length).toBe(0);
    // 恢复之后同一事件能走完：一次真模型 + 一枚 op。
    await db.subscription.updateMany({ where: { userId: s.userId }, data: { currentPeriodEnd: BigInt(Date.now() + 86400000) } });
    provider.reset([{ title: 'After restore' }]);
    expect((await cycle(s, 'a')).state).toBe('submitted');
    expect((await inboundOps(a)).length).toBe(1);

    // ── ①b 权益在**解析中**到期（模型已经买掉之后才拒）。这一档与 ①a 不是同一件事：
    // 钱已经花了，闸门要量的不是"发没发出去"，而是"花过一次之后不许再花第二次、也不许落一半"。
    const midEvent = randomUUID();
    expect((await deliver(s.rule.id, midEvent, s.body, KEY_V1)).status).toBe(202);
    provider.holdUntilReleased([{ title: 'Entitlement lapsed mid parse' }]);
    const midParsing = cycle(s, 'a', { eventId: midEvent });
    await waitProviderHit();
    await db.subscription.updateMany({ where: { userId: s.userId }, data: { currentPeriodEnd: BigInt(Date.now() - 1000) } });
    provider.release?.();
    expect((await midParsing).state).toBe('waiting-entitlement');
    expect(provider.sources.length).toBe(1);
    expect((await inboundOps(a)).length).toBe(1);
    expect(await db.automationCommitPermit.count({ where: { userId: s.userId, eventId: midEvent } })).toBe(0);
    const midAttempt = await db.automationAiAttempt.findFirst({ where: { userId: s.userId, eventId: midEvent }, select: { state: true } });
    expect(midAttempt, '模型已经买过 ⇒ 计量账本必须留下一行（这是"不多买"的前提）').toBeDefined();
    // 恢复权益、租约过期后再跑：接手那一趟**不该**为同一事件再买一次模型。
    await db.subscription.updateMany({ where: { userId: s.userId }, data: { currentPeriodEnd: BigInt(Date.now() + 86400000) } });
    await expireLease(s.userId, midEvent);
    expect((await cycle(s, 'a', { eventId: midEvent })).state).toBe('empty');
    expect(provider.sources.length).toBe(1);
    const midSettled = await eventRow(s.userId, midEvent);
    expect([midSettled?.status, midSettled?.reasonCode]).toEqual(['needs-confirmation', 'model-result-uncertain']);

    const b = s.devices.get('b')!;
    await synced(b);
    (await b.getVaultSession())?.lock();
    await expect(cycle(s, 'b')).rejects.toThrow();
    expect((await inboundOps(b)).length).toBe(0);

    // ── 撤回模型同意（出境闸门）。这一档要**两条腿**才量得出闸门在拦：
    // 只证"没同意⇒不发"，可能其实是 URL 坏、路由没配、或者目标不可达造成的。
    // 所以第二腿把同意给上，失败原因必须从 `egress-not-authorized` **挪走**。
    // 目的地选一个非回环的 https 域名（`.invalid` 按 RFC 6761 保证解析不了）：
    // 回环地址会被分类成 `none`（不需要同意），而 `http:` 非回环会被路由层直接判成
    // `plaintext-remote` —— 那既不是出境闸门的形状，也不会有稳定的读数。
    const remoteRouting = {
      enabled: true, allowRemote: true,
      endpoints: [{ id: 'remote', label: 'remote', endpoint: 'https://heyta-dual-host.invalid/v1', model: 'test' }],
      routes: { 'inbound-automation': [{ endpointId: 'remote' }] },
    };
    const deniedEvent = randomUUID();
    expect((await deliver(s.rule.id, deniedEvent, s.body, KEY_V1)).status).toBe(202);
    provider.reset([{ title: 'Must-not-egress' }]);
    await expect(cycle(s, 'a', { eventId: deniedEvent, routing: remoteRouting, consents: [] }))
      .rejects.toThrow(/egress-not-authorized/);
    // 真模型一次都没被调用、计量账本一行都没写 —— 这两条是"闸门在网络之前"的读数本身。
    expect(provider.sources.length).toBe(0);
    expect(await db.automationAiAttempt.count({ where: { userId: s.userId, eventId: deniedEvent } })).toBe(0);
    expect((await inboundOps(a)).length).toBe(1);

    const grantedEvent = randomUUID();
    expect((await deliver(s.rule.id, grantedEvent, s.body, KEY_V1)).status).toBe(202);
    provider.reset([{ title: 'Would-have-egressed' }]);
    const grantedFailure = await cycle(s, 'a', {
      eventId: grantedEvent, routing: remoteRouting,
      consents: [{ feature: 'inbound-automation', destination: 'user-endpoint', grantedAt: Date.now() }],
    }).then(() => undefined, (error: unknown) => String((error as { message?: string }).message));
    expect(grantedFailure, '同意给了之后这一腿应当走到网络那一层再失败').toBeDefined();
    expect(grantedFailure).not.toMatch(/egress-not-authorized/);
    // 🔴 这一腿顺手量到一件事：同意之后真的**买了**那一次（账本落在 sent/unknown），
    // 而发出去失败之后没有回滚成 reserved —— 也就是"撤回同意"之后再点一次才是新的一买。
    const grantedAttempt = await db.automationAiAttempt.findFirst({ where: { userId: s.userId, eventId: grantedEvent }, select: { state: true } });
    expect(['sent', 'unknown']).toContain(grantedAttempt?.state);
    expect(provider.sources.length).toBe(0);

    // ── 撤销凭据（这一台设备的 worker）在解析中。放在删除规则之前：删规则会把这一格
    // 要的账本一起抹掉，那时"撤销后不多买一次"就没东西可读了。
    const revokedEvent = randomUUID();
    expect((await deliver(s.rule.id, revokedEvent, s.body, KEY_V1)).status).toBe(202);
    await joinVault(b, s.passphrase);
    const workerB = await db.automationWorker.findFirst({ where: { userId: s.userId, syncClientId: b.clientId, revokedAt: null }, select: { id: true } });
    expect(workerB, 'B 的 worker 应当已登记').not.toBeNull();
    provider.holdUntilReleased([{ title: 'Revoked mid parse' }]);
    const revokedCycle = cycle(s, 'b', { eventId: revokedEvent });
    // 🔴 撤销必须落在**模型请求真的到达供给方之后**。第一版没等这一步，于是 revoke（一次 await 的
    // DB 写）抢先落在 B 的第一笔 HTTP 之前 —— 实测那一笔是 `GET /events/<id>/result?clientId=dual-host-b`
    // 直接 403 `Automation worker authorization failed`，B 连 claim 都没走到：没有 attempt 行、事件还
    // 是 queued，下一腿 A 来接手就**合法地**重新买了一次模型、回 `submitted`。那种读数测的是凭据校验，
    // 不是"撤销族"，而且会把"同一事件不多买一次"这条承诺量反。
    await waitProviderHit();
    await db.automationWorker.update({ where: { id: workerB!.id }, data: { revokedAt: BigInt(Date.now()) } });
    provider.release?.();
    const revokedFailure = await revokedCycle.then((result) => JSON.stringify(result), (error: unknown) => String((error as { message?: string }).message));
    expect(revokedFailure).not.toMatch(/submitted/);
    expect((await inboundOps(b)).length).toBe(0);
    expect(await db.automationCommitPermit.count({ where: { userId: s.userId, eventId: revokedEvent } })).toBe(0);
    const revokedAttempt = await db.automationAiAttempt.findFirst({ where: { userId: s.userId, eventId: revokedEvent }, select: { state: true } });
    // 撤销落在"模型已经买过、结果正在往回收"的那一档：账本停在 sent，没人能把它读成 consumed。
    expect(revokedAttempt?.state).toBe('sent');
    // 租约让给另一台设备再跑一次：那一台**不该**为同一事件再买一次模型。
    await expireLease(s.userId, revokedEvent);
    expect((await cycle(s, 'a', { eventId: revokedEvent })).state).toBe('empty');
    expect(provider.sources.length).toBe(1);
    const settled = await eventRow(s.userId, revokedEvent);
    expect([settled?.status, settled?.reasonCode]).toEqual(['needs-confirmation', 'model-result-uncertain']);

    // ── 解析中删除规则（最后一档：它会把这条规则的事件/账本/许可整片抹掉）。
    const deletedRuleEvent = randomUUID();
    expect((await deliver(s.rule.id, deletedRuleEvent, s.body, KEY_V1)).status).toBe(202);
    provider.holdUntilReleased([{ title: 'Rule deleted mid parse' }]);
    const deletingCycle = cycle(s, 'a', { eventId: deletedRuleEvent });
    await waitProviderHit();
    await s.rules.remove(s.rule.id);
    provider.release?.();
    const deletedRuleFailure = await deletingCycle.then((result) => JSON.stringify(result), (error: unknown) => String((error as { message?: string }).message));
    expect(deletedRuleFailure).not.toMatch(/submitted/);
    expect((await inboundOps(a)).length).toBe(1);
    expect(await db.automationEvent.count({ where: { userId: s.userId, eventId: deletedRuleEvent } })).toBe(0);
    // 🔴 规则删除把这条规则的**许可与计量账本一起抹走**（`rules.ts` 里那四条 deleteMany）。
    // 所以这里数到 0 不是"什么都没发生过"，而是服务端已无账可查 —— 本地那枚已提交的 op
    // 之后能上行，靠的是宿主手里那张 owner 收据（`worker-identity.ts` 的授权分支），
    // 这一句就是那条路径的入口读数。
    expect(await db.automationCommitPermit.count({ where: { userId: s.userId } })).toBe(0);
    expect(await db.automationAiAttempt.count({ where: { userId: s.userId } })).toBe(0);
    report(8, `六档都有读数：①a 派发前权益到期 ⇒ waiting-entitlement、真模型 0 次、A 零 op（恢复后同一事件补跑得 submitted、1 op）；` +
      `①b 解析中权益到期（模型已买）⇒ waiting-entitlement、模型恰好 1 次、零许可、零新 op，计量行 state=${midAttempt?.state}；恢复权益 + 租约过期后再跑 ⇒ ${midSettled?.status}/${midSettled?.reasonCode}，模型仍 1 次；` +
      `② 提交前 Vault 锁定 ⇒ 抛出且 B 零 op；` +
      `③ 没同意就出境 ⇒ 拒 \`egress-not-authorized\`、真模型 0 次、计量 0 行；把同意给上 ⇒ 失败原因挪到网络那一层(${grantedFailure})、计量落 1 行 ${grantedAttempt?.state}；` +
      `④ 解析中撤销 B 的凭据（模型已到达供给方之后才撤）⇒ 抛错(${revokedFailure.slice(0, 60)})、B 零 op、零许可，计量行停在 ${revokedAttempt?.state}；租约过期后 A 来接手回 ${settled?.status}/${settled?.reasonCode}、真模型仍 1 次（同一事件不多买一次）；` +
      `⑤ 解析中删除规则 ⇒ 抛错(${deletedRuleFailure.slice(0, 60)})、A 仍 1 op，而该事件行与这条规则的许可/计量账本被删除整片抹走（本用户两张账表都数到 0）`);
  }, 240_000);

  it('W9 用户已编辑/已删除、队列正文过期后上游重试：既不覆盖编辑，也不复活墓碑', async () => {
    if (skipWindow(9)) return;
    const s = await scenario({ tasks: [{ title: 'Original' }] });
    const a = s.devices.get('a')!;
    expect((await s.deliverEvent()).status).toBe(202);
    expect((await cycle(s, 'a')).state).toBe('submitted');
    const actions = createTaskActions(a);
    const id = (await batchOf(a)).tasks[0]!.id;
    await actions.rename(id, 'user edited');
    // 这一腿承诺的内容**不是**"状态词不许是 submitted"，而是三件实测得出来的事：
    // 不覆盖用户的编辑、不再买一次模型、不多写一枚 op。第二趟走的是 recover 腿
    // （`/api/automation/events/recover?clientId=` —— 认证设备补传），它把同一条持久 op
    // 再提交一次，幂等闸门让重放产生不了新状态。
    const second = await cycle(s, 'a');
    expect(provider.sources.length).toBe(1);
    expect((await inboundOps(a)).length).toBe(1);
    expect(actions.findTask(id)?.title).toBe('user edited');
    await actions.remove(id);
    const third = await cycle(s, 'a');
    expect(provider.sources.length).toBe(1);
    expect((await inboundOps(a)).length).toBe(1);
    // 🔴 墓碑不能用 `findTask` 量：`actions.ts:414` 对 `deletedAt !== undefined` 直接返回
    // `undefined`，所以 `findTask(id)?.deletedAt` 在"已删"和"根本不存在"两种情况下都是 null ——
    // 这条判据当时**永远红**，红得像是产品复活了任务。要看墓碑只能读物化状态本体。
    expect(actions.findTask(id), '墓碑不该出现在活动列表里').toBeUndefined();
    expect(a.getState().tasks[id]?.deletedAt ?? null).not.toBeNull();
    await db.automationEvent.update({ where: { userId_eventId: { userId: s.userId, eventId: s.eventId } },
      data: { expiresAt: new Date(Date.now() - 1000), payloadCiphertext: null } });
    const retry = await deliver(s.rule.id, s.eventId, s.body);
    expect([202, 409, 410, 503]).toContain(retry.status);
    expect(actions.findTask(id)).toBeUndefined();
    expect(a.getState().tasks[id]?.deletedAt ?? null).not.toBeNull();
    // 🔴 只看"重试这一次回什么码"不够：承诺是**不重建已删任务**，而那要再跑一趟才量得到 ——
    // 重试若把事件重新排进队列，下一趟就会带着那份正文去解析，墓碑才见真章。
    const fourth = await cycle(s, 'a');
    expect(actions.findTask(id), '重试后再跑也不许把已删任务放回活动列表').toBeUndefined();
    expect(a.getState().tasks[id]?.deletedAt ?? null).not.toBeNull();
    expect(await inboundOps(a)).toHaveLength(1);
    report(9, `编辑后再跑不覆盖（仍 "user edited"）、删除后再跑不复活（活动列表读不到、物化状态里 deletedAt 仍在），` +
      `三趟都只 1 枚 op、模型仍 1 次；实测状态词：编辑后=${second.state}、删除后=${third.state}；` +
      `正文清空后上游重试回 ${retry.status}，重试后再跑一趟=${fourth.state}，墓碑仍在`);
  }, 120_000);

  it('W10 新设备无收件私钥 ⇒ 确定终态与可见原因；根密钥轮换后原设备仍能处理', async () => {
    if (skipWindow(10)) return;
    const s = await scenario({ tasks: [{ title: 'Before rotation' }, { title: 'After rotation' }] });
    const a = s.devices.get('a')!;
    expect((await s.deliverEvent()).status).toBe(202);
    const stranger = await openDevice('stranger', s.userId, s.token);
    await joinVault(stranger, s.passphrase);
    await stranger.registerInboundWorker({ userId: String(s.userId), databaseEpoch: randomUUID() });
    await expect(stranger.ensureInboundRecipientKey()).rejects.toThrow(/recovery is required/i);
    expect((await inboundOps(stranger)).length).toBe(0);
    expect((await eventRow(s.userId, s.eventId))?.leaseWorkerId).toBeNull();
    expect((await cycle(s, 'a')).state).toBe('submitted');
    expect((await inboundOps(a)).length).toBe(1);
    const pending = await a.beginVaultRootRotation(`rotated-${randomUUID()}`);
    if (pending === undefined) throw new Error('root rotation unavailable');
    await a.confirmVaultRootRotation(pending, pending.recoveryCode);
    expect((await a.getVaultSession())?.state).toBe('unlocked');
    const second = randomUUID();
    expect((await deliver(s.rule.id, second, JSON.stringify({ title: 'rotated body' }))).status).toBe(202);
    expect((await cycle(s, 'a', { eventId: second })).state).toBe('submitted');
    expect((await inboundOps(a)).length).toBe(2);
    expect(await serverOps(second).then((rows) => rows.length)).toBeLessThanOrEqual(1);
    report(10, `无钥新设备响亮拒（"recovery is required"）且 0 op、没把事件抢走；root 轮换后 worker 凭据与收件私钥重包成功，第二件事照样落 1 op`);
  }, 150_000);

  it('W11 后半：许可先给、规则随后暂停 ⇒ 已发许可仍能补传，暂停中的规则不再收新格', async () => {
    if (skipWindow(11)) return;
    const s = await scenario({ devices: ['a', 'b'], tasks: [{ title: 'Permit first' }] });
    const a = s.devices.get('a')!;
    expect((await s.deliverEvent()).status).toBe(202);
    expect((await cycle(s, 'a')).state).toBe('submitted');
    expect(await db.automationCommitPermit.count({ where: { eventId: s.eventId } })).toBe(1);
    await s.rules.setEnabled(s.rule.id, false);
    await synced(a);
    expect((await serverOps(s.eventId)).length).toBe(1);
    const third = randomUUID();
    expect((await deliver(s.rule.id, third, JSON.stringify({ title: 'after pause' }))).status).toBe(403);
    expect((await cycle(s, 'b')).state).not.toBe('submitted');
    report(11, `许可先落 ⇒ 规则暂停后 owner receipt 仍补传成功（服务端 1 op）；暂停中的规则公网接收回 403、B 领不到新格`);
  }, 120_000);

  it('W12 换 keyId 后同事件重试仍命中原事件；旧钥接收与旧钥查询都被拒', async () => {
    if (skipWindow(12)) return;
    const s = await scenario();
    expect((await s.deliverEvent()).status).toBe(202);
    // 🔴 产品**没有**改规则 keyId 的接口（`PUT /rules/:id/config` 不带 keyId），所以这一格的"换 key"
    // 只能落在数据层。这是被测事实，写在这里免得被读成"界面上能换 key"。
    await db.automationRule.update({ where: { id: s.rule.id }, data: { keyId: KEY_V2 } });
    expect((await deliver(s.rule.id, s.eventId, s.body, KEY_V2)).status).toBe(202);
    expect(await db.automationEvent.count({ where: { userId: s.userId, eventId: s.eventId } })).toBe(1);
    expect((await deliver(s.rule.id, s.eventId, s.body, KEY_V1)).status).toBe(403);
    expect((await signed(statusPath(s.rule.id, s.eventId), s.rule.id, s.eventId, KEY_V1, 'GET', '')).status).toBe(403);
    expect((await signed(statusPath(s.rule.id, s.eventId), s.rule.id, s.eventId, KEY_V2, 'GET', '')).status).toBe(200);
    report(12, `换 keyId 后新钥重试命中同一行（仍 1 行）、旧钥接收 403、旧钥查询 403 / 新钥查询 200`);
  }, 90_000);

  it('W13 date-only 与 start-only 跟着规则时区锚定，两规则两时区各回同日；编辑往返不漂', async () => {
    if (skipWindow(13)) return;
    const s = await scenario({ devices: ['a', 'b'], timezone: 'Asia/Shanghai',
      allowedFields: ['title', 'dueDate', 'startDate'],
      tasks: [{ title: 'Due date-only', dueDate: '2026-11-30' }, { title: 'Start only', startDate: '2026-03-08' }] });
    const a = s.devices.get('a')!;
    expect((await s.deliverEvent()).status).toBe(202);
    expect((await cycle(s, 'a')).state).toBe('submitted');
    const shanghai = await batchOf(a);
    const dayOf = (epoch: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch));
    expect(dayOf(shanghai.tasks[0]!.dueDate!, 'Asia/Shanghai')).toBe('2026-11-30');
    expect(dayOf(shanghai.tasks[0]!.dueDate!, 'UTC')).toBe('2026-11-29');
    expect(shanghai.tasks[1]!.startDate).toBeTypeOf('number');
    expect(shanghai.tasks[1]!.dueDate).toBeUndefined();
    // 同一条 date-only 输入换一条**别的规则时区**：锚点跟着规则走，不跟着处理机走。
    const losAngeles = await s.rules.create(KEY_V1, { allowedFields: ['title', 'dueDate'], timezone: 'America/Los_Angeles', parseVersion: 1, maxItems: 50 });
    await s.rules.setEnabled(losAngeles.id, true);
    const other = randomUUID();
    expect((await deliver(losAngeles.id, other, JSON.stringify({ title: 'Due date-only' }))).status).toBe(202);
    provider.reset([{ title: 'Due date-only', dueDate: '2026-11-30' }]);
    expect((await cycle(s, 'b', { eventId: other })).state).toBe('submitted');
    const batchB = await batchOf(s.devices.get('b')!);
    expect(dayOf(batchB.tasks[0]!.dueDate!, 'America/Los_Angeles')).toBe('2026-11-30');
    expect(batchB.tasks[0]!.dueDate).not.toBe(shanghai.tasks[0]!.dueDate);
    const actions = createTaskActions(a);
    const shanghaiMidnight = Date.parse('2027-01-01T00:00:00+08:00');
    await actions.setDueDate(shanghai.tasks[0]!.id, shanghaiMidnight, '2027-01-01');
    expect(dayOf(actions.findTask(shanghai.tasks[0]!.id)!.dueDate!, 'Asia/Shanghai')).toBe('2027-01-01');
    report(13, `date-only 在 Asia/Shanghai 规则下锚回 2026-11-30（UTC 读成 11-29，证明跟规则不跟机器）；换 America/Los_Angeles 规则仍回 2026-11-30 且 epoch 不同；start-only 不产生 dueDate；编辑到 2027-01-01 往返不漂`);
  }, 150_000);
});
