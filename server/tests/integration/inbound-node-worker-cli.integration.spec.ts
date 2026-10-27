/**
 * A2 的判据：自动收集 worker 在**真 CLI 进程**里跑通一次「起宿主 → 投一条 → 落库 → 回执」。
 *
 * 为什么这一档必须存在，而 `inbound-dual-host-fault-windows.integration.spec.ts` 没把它覆盖掉：
 * 那一套（以及全部既有判据）驱动 worker 的方式，是测试**自己在进程内**调
 * `host.processInboundAutomation(...)`。可"生产里谁调它"这一格从来没人量过 ——
 * `host.ts` 的 `startInboundWorker` 全仓唯一的调用者就是一枚测试，于是这台"永远在线"的
 * 无头宿主上，那枚循环**从来没有被打开过**。进程内的调用恰好绕过并掩盖了这件事：
 * 它证明协议能走通，不证明有启动者。
 *
 * 所以正臂**不碰任何宿主 API**：只有 `spawn(node, [apps/node-host/dist/cli.js, …, 'worker', 'run'])`。
 * 收件密钥、worker 注册、领取、解密、模型调用、落待办、回执，全部由那个子进程自己做。
 *
 * 🔴 三条臂各自挡的失法不一样，缺一条，另外两条就会说谎：
 *  · 正臂        —— 启动者存在，且能把一条事件做到"这台机器的库里有一条任务、服务端有一张许可"。
 *  · 反向臂（不起）—— 给正臂定归因：落库/许可/上游命中这三件事都不是服务端替它做的，
 *                   也不是上一条用例留下的余数。
 *  · 出境闸臂     —— 同一条命令、同一个事件，只少了操作者写下的那句授权 ⇒ 一个请求都不发。
 *                   它挡的是"为了让这条链跑绿，给无头壳默认放行出境"那种改法。
 *
 * 口令与令牌只走子进程的 env（不上 argv、不进 stdout），全是这一趟现造的合成值。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as jwt from 'jsonwebtoken';
import { createInboundRulesRemote, openAppHost, type AppHost } from '@heyta/app-host';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { signWebhook } from '@heyta/inbound-core';

const DATABASE_URL = process.env.DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'apps/node-host/dist/cli.js');

interface Exit { code: number | null; signal: string | null; stdout: string; stderr: string }

/** 等一件异步事实出现；超时就把**当前读数**（和可选的现场输出）一起报出来，否则失败只说"没等到"，归因还得再跑一趟。 */
const waitFor = async <T>(read: () => Promise<T>, decided: (value: T) => boolean, timeoutMs: number, label: string, scene?: () => string): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!decided(value) && Date.now() < deadline) {
    await new Promise((resolveWait) => { setTimeout(resolveWait, 200); });
    value = await read();
  }
  expect(decided(value), `${label}：等待 ${String(timeoutMs)}ms 后读数为 ${JSON.stringify(value)}${scene === undefined ? '' : `\n子进程现场：${scene()}`}`).toBe(true);
  return value;
};

describe.skipIf(!DATABASE_URL)('inbound worker started by the real node-host CLI', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const prior = {
    secret: process.env.JWT_SECRET, commit: process.env.AUTOMATION_COMMIT_KEYS,
    webhook: process.env.AUTOMATION_WEBHOOK_KEYS, mode: process.env.AUTOMATION_ENTITLEMENT_MODE,
    nodeEnv: process.env.NODE_ENV,
  };
  const signing = { instanceId: randomUUID(), activeKeyId: 'test', keys: { test: '11'.repeat(32) } };
  const keyringValue = '22'.repeat(32);
  const KEY_ID = 'inbound-v1';

  const hosts = new Set<AppHost>();
  const directories: string[] = [];
  const users = new Set<number>();
  const children = new Set<ReturnType<typeof spawn>>();
  let base = '';
  let providerPort = 0;
  let provider: Server;
  /** 假上游**真的**收到过的请求体。反向臂与出境闸臂都靠它证明"一次都没发"。 */
  let upstreamHits: string[] = [];

  const openDirectory = async (prefix: string): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    directories.push(directory);
    return directory;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'inbound-node-worker-cli-secret-32';
    process.env.NODE_ENV = 'test';
    process.env.AUTOMATION_COMMIT_KEYS = JSON.stringify(signing);
    process.env.AUTOMATION_WEBHOOK_KEYS = JSON.stringify({ keys: { [KEY_ID]: keyringValue } });
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    // 🔴 这里**不能**调 `setArgon2ParamsForTesting`。那枚旋钮改的是**当前进程**的模块状态，
    // 而本档的被测物是一枚**生产 CLI 子进程** —— 它没有、也不该有那行调用。父进程把参数调弱
    // 之后，两边从同一条口令派生出的密钥就不是同一把，症状却毫无暗示性：子进程在解锁那一步
    // 抛 `OperationError: The operation failed for an operation-specific reason`，
    // 看起来像端到端加密坏了，实际是探针自己造的第二把尺（2026-10-27 现量到）。
    // 对照：`inbound-dual-host-child.mjs` 那枚子进程**自己**也调了同一组弱参数，所以它能量。

    upstreamHits = [];
    provider = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        upstreamHits.push(raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ title: 'Capture from CLI' }] }) } }] }));
      });
    });
    await new Promise<void>((resolveListen) => { provider.listen({ host: '127.0.0.1', port: 0 }, () => { resolveListen(); }); });
    providerPort = (provider.address() as { port: number }).port;

    const { initSyncService } = await import('../../src/sync/sync.service');    const { syncRoutes } = await import('../../src/sync/sync.routes');
    const { apiRoutes } = await import('../../src/api');
    const { inboundAutomationRoutes } = await import('../../src/automation/inbound.routes');
    // 🔴 服务端那些模块只能在 `JWT_SECRET` 写进环境**之后**加载：`src/auth.ts` 把它读成模块级
    // 常量，一条静态 import 会让它在 beforeAll 之前就被求值。症状与令牌毫无关系 —— 401 TOKEN_INVALID
    // （本文件第一版撞在这上面，故留这一句）。
    initSyncService();
    // 端口先占后注册：`serverOrigin` 进的是信封 AAD，宿主按自己那条 origin 解，
    // 两边必须逐字相同 —— listen 之后再取就来不及了（教训同源：双宿主套件那一档的注释）。
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      const probe = createServer();
      probe.once('error', rejectPort);
      probe.listen({ host: '127.0.0.1', port: 0 }, () => {
        const taken = (probe.address() as { port: number }).port;
        probe.close(() => { resolvePort(taken); });
      });
    });
    base = `http://127.0.0.1:${port}`;
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(inboundAutomationRoutes, { prefix: '/api', serverOrigin: base });
    await app.register(syncRoutes, { prefix: '/api/sync' });
    // ⚠️ 这里**不**注册托管代理：worker 那一趟走的是自带端点（见下面 spawnWorker 的理由）。
    // 托管档在明文 http 的回环服务器上是**被共享层正确拒掉的**那一种 ——
    // `classifyDestination` 算不出 heyta-cloud（不在境内白名单），而明文发到"非 heyta 的远端"
    // 违反 https 那条承诺。硬要让它跑通就得把白名单或明文例外改掉，那是拿测试改产品语义。
    // 托管 CLI 档的翻译与授权矩阵由 `apps/node-host/tests/inbound-worker-plan.spec.ts` 逐臂钉住。
    await app.listen({ host: '127.0.0.1', port });
    await app.ready();
  }, 120_000);

  afterEach(async () => {
    for (const child of children) { child.kill('SIGKILL'); }
    children.clear();
    for (const host of [...hosts]) { hosts.delete(host); host.close(); }
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
    for (const userId of users) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    users.clear();
    upstreamHits = [];
  });

  afterAll(async () => {
    await app.close();
    provider?.close();
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db');
    await disconnectDb();
    for (const [key, value] of Object.entries({
      JWT_SECRET: prior.secret, AUTOMATION_COMMIT_KEYS: prior.commit, AUTOMATION_WEBHOOK_KEYS: prior.webhook,
      AUTOMATION_ENTITLEMENT_MODE: prior.mode, NODE_ENV: prior.nodeEnv,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  interface Scenario { userId: number; token: string; passphrase: string; ruleId: string; eventId: string }

  /**
   * 先造一个"用户已经用有界面的设备把号建好、规则也开好了"的世界，**然后才**轮到被测的命令。
   *
   * Vault 由一台进程内宿主创建 —— 这是诚实的而不是取巧：这台无头壳没有创建 Vault 的入口，
   * 现实里也是别的设备先建好、它拿口令来解锁。那一格缺口另记（本档不去粉饰它）。
   *
   * `publishRecipientKey` 决定收件公钥由谁发布，两臂要的正好是相反的形状，所以它必须是入参：
   *  · `false`（正臂）—— 公钥只能由那枚 CLI 进程自己发布。发布之前这条事件根本投不进去
   *                       （服务端 503：没有公钥就封不了信封），于是"启动者不存在"这一格
   *                       在读数上是可看见的，不是猜的。
   *  · `true`（反向臂）—— 由别的设备把公钥与 worker 都登记好，**只是没有循环在跑**。
   *                       这一臂因此量的不是"没注册所以领不了"，而是"注册了也没人替它走一步"。
   */
  const scenario = async (options: { publishRecipientKey?: boolean } = {}): Promise<Scenario> => {
    const passphrase = `node-worker-${randomUUID()}`;
    const user = await db.user.create({ data: { email: `node-worker-${randomUUID()}@test.local`, isVerified: 1 } });
    users.add(user.id);
    await db.subscription.create({ data: { userId: user.id, status: 'active', grants: ['ai', 'automation'],
      currentPeriodEnd: BigInt(Date.now() + 86_400_000) } });
    const token = jwt.sign({ userId: user.id, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!);

    const directory = await openDirectory('heyta-node-worker-provision-');
    const dbPath = join(directory, 'provision.sqlite');
    const provisioner = await openAppHost({
      dbPath, driverFactory: () => new NodeSqliteDriver(dbPath), clientId: 'provisioner',
      serverUrl: base, token, accountId: String(user.id),
    });
    hosts.add(provisioner);
    const vault = await provisioner.getVaultSession();
    if (vault === undefined) throw new Error('no vault session on the provisioning device');
    const pending = await vault.beginCreation(passphrase);
    // 第三枚参数是**当场**把 key package 发布到服务端；不发布的话 CLI 那头找不到可解的包。
    await vault.confirmAndPublish(pending, pending.recoveryCode, provisioner.getVaultKeyPackageRemote());
    if (options.publishRecipientKey === true) {
      await provisioner.ensureInboundRecipientKey();
      await provisioner.registerInboundWorker({ userId: String(user.id), databaseEpoch: randomUUID() });
    }

    const rules = createInboundRulesRemote({ baseUrl: base, getToken: async () => token });
    const rule = await rules.create(KEY_ID, { allowedFields: ['title'], timezone: null, parseVersion: 1, maxItems: 50 });
    await rules.setEnabled(rule.id, true);

    return { userId: user.id, token, passphrase, ruleId: rule.id, eventId: randomUUID() };
  };

  /** 真发送方：签名 + 真 POST。服务端收下后封成信封入库，明文只进信封。 */
  const deliver = async (s: Scenario): Promise<number> => {
    const path = `/api/automation/v1/hooks/${s.ruleId}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhook(Uint8Array.from(Buffer.from(keyringValue, 'hex')), {
      method: 'POST', path, ruleId: s.ruleId, keyId: KEY_ID, timestamp, eventId: s.eventId,
      contentType: 'application/json', body: new TextEncoder().encode(JSON.stringify({ title: 'Inbox note', secret: 'must-not-leave' })),
    });
    const response = await fetch(`${base}${path}`, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-heyta-key-id': KEY_ID, 'x-heyta-timestamp': timestamp,
        'x-heyta-event-id': s.eventId, 'x-heyta-signature': signature },
      body: JSON.stringify({ title: 'Inbox note', secret: 'must-not-leave' }),
    });
    return response.status;
  };

  const eventRow = (s: Scenario) => db.automationEvent.findFirst({ where: { userId: s.userId, eventId: s.eventId } });
  const permitCount = (s: Scenario) => db.automationCommitPermit.count({ where: { userId: s.userId, eventId: s.eventId } });

  /**
   * 起那条**被测**的命令：一枚真子进程。本文件不调任何宿主 API 来替它做事。
   * 口令走 env（`HEYTA_PASSWORD`）而不是 argv —— argv 会进 `ps` 与 shell 历史。
   */
  /**
   * 起那条**被测**的命令：一枚真子进程。本文件不调任何宿主 API 来替它做事。
   * 口令走 env（`HEYTA_PASSWORD`）而不是 argv —— argv 会进 `ps` 与 shell 历史。
   *
   * 这一趟走**自带端点**那一档，而且这个选择不是我挑便宜的那一条：
   * 托管档在本地**量不到** —— `classifyDestination({mode:'managed'})` 只认境内白名单，
   * 一台明文回环测试服务器算不出 `heyta-cloud`，而共享层又（正确地）拒绝把明文发到
   * 任何非回环地址。要跑托管档得真上白名单 + https，那是发布那一格，不是这一档。
   * 换成自带端点之后：真 HTTP、真模型调用、真解析、真回执，一样不缺。
   *
   * `HEYTA_KEYCHAIN_PATH` 指到一个**不存在的**钥匙串文件：`get()` 读不到就退化成
   * "没有密钥"（那是那枚存储自己的既有行为），于是这一趟既不碰登录钥匙串、也不写任何钥匙串。
   */
  const spawnWorker = (dbPath: string, s: Scenario, options: { approveEgress?: string; once?: boolean } = {}): {
    child: ReturnType<typeof spawn>; exited: Promise<Exit>; output: () => string;
  } => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(`找不到 ${CLI_PATH} —— 本档判的就是那条 CLI，不能拿源码顶替。先跑 pnpm --filter @heyta/node-host build`);
    }
    const args = ['--db', dbPath, '--server', base, '--token', s.token, '--account-id', String(s.userId),
      'worker', 'run', '--json',
      '--ai-endpoint', `http://127.0.0.1:${providerPort}/v1`, '--ai-model', 'capture-test', '--ai-key-id', 'cli-integration'];
    if (options.approveEgress !== undefined) args.push('--approve-egress', options.approveEgress);
    if (options.once === true) args.push('--once');
    else args.push('--interval-ms', '800');
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HEYTA_PASSWORD: s.passphrase, HEYTA_KEYCHAIN_PATH: join(dirname(dbPath), 'absent.keychain') },
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const exited = new Promise<Exit>((finish) => {
      child.on('close', (code, signal) => {
        children.delete(child);
        finish({ code, signal, stdout, stderr });
      });
    });
    return { child, exited, output: () => `stdout=${stdout}\nstderr=${stderr}`.slice(-2_500) };
  };

  /** 同一条 CLI 的另一次调用（读回本地库 / 同步）。与用户手敲的完全同形。 */
  const runCli = (dbPath: string, args: readonly string[], passphrase?: string): Promise<Exit> =>
    new Promise((finish) => {
      const child = spawn(process.execPath, [CLI_PATH, '--db', dbPath, ...args], {
        cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
        env: passphrase === undefined ? { ...process.env } : { ...process.env, HEYTA_PASSWORD: passphrase },
      });
      children.add(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('close', (code, signal) => {
        children.delete(child);
        finish({ code, signal, stdout, stderr });
      });
    });

  it('正臂：CLI 起宿主 → 投一条 → 这台机器的库里落一条待办 → 服务端有许可与 op', async () => {
    // 这一趟**不**预先发布收件公钥：公钥只能由被测的那枚 CLI 进程自己建、自己发。
    const s = await scenario();
    expect(await db.automationRecipientKey.count({ where: { userId: s.userId } })).toBe(0);
    // 先证明"没有公钥就投不进去"，否则下面"公钥是 CLI 弄出来的"这句没有对照。
    expect(await deliver(s), '没有收件公钥时服务端不该收下这条事件').toBe(503);

    const directory = await openDirectory('heyta-node-worker-cli-');
    const dbPath = join(directory, 'worker.sqlite');
    const { child, exited, output } = spawnWorker(dbPath, s);

    // 「起宿主」这一格在读数上是看得见的：公钥行与 worker 行都只可能来自那枚子进程。
    expect(await waitFor(() => db.automationRecipientKey.count({ where: { userId: s.userId } }),
      (count) => count >= 1, 30_000, 'CLI 起来后服务端该有收件公钥', output)).toBe(1);
    expect(await waitFor(() => db.automationWorker.count({ where: { userId: s.userId } }),
      (count) => count >= 1, 15_000, 'CLI 起来后服务端该有已登记的 worker', output)).toBe(1);

    expect(await deliver(s)).toBe(202);
    expect((await eventRow(s))?.status).toBe('queued');

    // 「回执」：提交许可是服务端裁决的那一张，事件必须离开 queued。
    const scene = () => `${output()}\n上游命中=${String(upstreamHits.length)} 次`;
    expect(await waitFor(() => permitCount(s), (count) => count >= 1, 40_000, '服务端应出现 1 行提交许可', scene)).toBe(1);
    const row = await waitFor(() => eventRow(s), (value) => value?.status !== 'queued', 20_000, '事件该离开 queued', scene);
    expect(row?.leaseWorkerId, '领取这张许可的必须是那台子进程真注册过的 worker').not.toBeNull();

    // 常驻循环由 SIGTERM 停下，停下才打印那份 JSON 报告 —— 顺带把"停得下来"也量了。
    child.kill('SIGTERM');
    const stop = await waitFor(async () => exited, (value) => value.code !== null || value.signal !== null, 20_000, 'worker 该在 SIGTERM 后退出');
    expect(stop.code, `退出码非 0；stdout=${stop.stdout} stderr=${stop.stderr.slice(0, 500)}`).toBe(0);
    const report = JSON.parse(stop.stdout.trim().split('\n').at(-1)!) as {
      ok: boolean; cycles: number; createdItems: number; lastState: string; enabledRules: number; keyEpoch: number;
    };
    expect(report.ok).toBe(true);
    expect(report.enabledRules).toBe(1);
    expect(report.keyEpoch).toBeGreaterThanOrEqual(1);
    expect(report.cycles, `循环至少要走一趟；stdout=${stop.stdout}`).toBeGreaterThanOrEqual(1);
    expect(report.createdItems).toBe(1);
    expect(report.lastState).toBe('submitted');
    // 🔴 那句"要往哪儿送明文"必须当人说写过：这台壳上没有任何界面替用户点过同意。
    expect(`${stop.stdout}\n${stop.stderr}`).toContain('明文正文');

    // 「落库」在那台宿主**自己的** SQLite 文件里读回来 —— 用另一条 CLI 命令，不借测试进程的宿主。
    const listed = await runCli(dbPath, ['list', '--json']);
    expect(listed.code, listed.stderr.slice(0, 500)).toBe(0);
    const tasks = (JSON.parse(listed.stdout) as { tasks: { title: string }[] }).tasks;
    expect(tasks.map((task) => task.title), `本地库里应只有一条由 worker 建出的待办；list=${listed.stdout}`)
      .toEqual(['Capture from CLI']);

    // 那条待办是真的 op：同步之后服务端读得到它（回执的另一半）。
    const synced = await runCli(dbPath, ['--server', base, '--token', s.token, '--account-id', String(s.userId), 'sync', '--json'], s.passphrase);
    expect(synced.code, `${synced.stdout}\n${synced.stderr.slice(0, 500)}`).toBe(0);
    expect(await db.operation.count({ where: { id: { startsWith: `inbound:${s.eventId}` } } })).toBe(1);
    expect(upstreamHits.length, '托管档应该真的经由服务端把这一次解析发到上游').toBe(1);
  }, 240_000);

  it('反向臂：公钥与 worker 都登记好了、唯独没有启动者 ⇒ 队列原样不动，许可 0、上游 0', async () => {
    // 🔴 这条臂不是"证明不跑就不落库"那句废话：它把"没注册所以领不了"这条捷径堵死
    // （这一趟公钥与 worker 都在），剩下的唯一差别就是**没人替它走一步**。
    // 它也替正臂定归因：许可、上游命中、本地待办都不能是服务端自动做的或上一趟的余数。
    const s = await scenario({ publishRecipientKey: true });
    expect(await deliver(s)).toBe(202);
    await new Promise((resolveWait) => { setTimeout(resolveWait, 4_000); });
    expect((await eventRow(s))?.status).toBe('queued');
    expect(await permitCount(s)).toBe(0);
    expect(upstreamHits.length).toBe(0);
  }, 120_000);

  it('出境闸臂：给一条根本不出境的路挂一句"授权" ⇒ 拒绝启动、上游 0 次、事件仍在队列', async () => {
    // 这一臂钉的是"同意记录不许变成装饰"那一格：回环端点的目的地是 none（共享层算的），
    // 命令行上却写了 user-endpoint —— 放行就等于允许一份与事实不符的同意记录存在。
    // （"要出境而没写授权 ⇒ 拒"那一臂在 `apps/node-host/tests/inbound-worker-plan.spec.ts`，
    //   那里可以造出真要出境的端点而不必把字节发到任何地址上。）
    const s = await scenario({ publishRecipientKey: true });
    expect(await deliver(s)).toBe(202);
    const directory = await openDirectory('heyta-node-worker-egress-');
    const dbPath = join(directory, 'worker.sqlite');
    const refused = await spawnWorker(dbPath, s, { approveEgress: 'user-endpoint', once: true }).exited;
    expect(refused.code, `挂了一句用不上的授权时本该拒绝启动，实得 code=${String(refused.code)}；stdout=${refused.stdout}`).not.toBe(0);
    expect(`${refused.stderr}${refused.stdout}`).toContain('明文不出这台设备');
    expect(upstreamHits.length, '拒绝启动就不能把一个字节发出去').toBe(0);
    expect(await permitCount(s)).toBe(0);
    expect((await eventRow(s))?.status).toBe('queued');
  }, 120_000);
});
