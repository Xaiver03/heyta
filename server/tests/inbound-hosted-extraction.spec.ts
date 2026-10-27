/**
 * 「接收即抽取」那一档的判据（ADR-0077）
 * =====================================
 *
 * 这一档让服务端在收到 webhook 的那一刻读正文、抽字段、把**结果**封回账号的收件人公钥。
 * 它换来的东西只有一句"设备不必开着也能把内容抽好"，代价是"我们那一次确实读了明文" ——
 * 所以这里每一枚 `it` 判的都是**代价没扩大**：
 *
 * · 正文那一列在抽取成功后被写成 `NULL`（库里不再有位子放它），标记串除那枚密文外
 *   不在任何一次写、任何一条日志里；
 * · 结果封的是**账号自己的公钥**，用真实 HPKE 打开验（不是"长度看起来对"）；
 * · 领不到活 / 模型拒绝 / 结果不合规 ⇒ 一行退回 `queued` 且密文不动，
 *   设备那条老路接管 —— 这条就是"只可能更早、不可能更少"那句话的载体；
 * · 服务端那条租约过期后设备**不静默重抽**（宁可用户点一次重试，不可同一份内容烧两次额度）；
 * · 授权字段以外的内容**根本不进那次提示词**（字段授权在服务端这条腿上同样生效）；
 * · 以及一条结构性门槛：`server/src` 里只许有**一枚** `/chat/completions` 的拼接点。
 *
 * ⚠️ 这一档不测闸门顺序（白名单预检、额度在发送之前、发送点复算）—— 那些由
 * `managed-proxy.routes.spec.ts` 在那条**唯一的**发送腿上钉着；本文件注入替身补全，
 * 只为本模块自己的四条红线。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { generateInboundKeyPair, inboundTaskDigest, openInbound } from '@heyta/inbound-core';
import type { ManagedAiCompletionContext, ManagedAiCompletionResult } from '../src/ai/managed-completion';

const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn() }, logger: { warn: vi.fn(), audit: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/logger', () => ({ Logger: mocks.logger }));

const ruleId = randomUUID();
const eventId = 'source-event-1';
const pair = generateInboundKeyPair();
const MARKER = 'MARKER-正文不许出现在任何一处-42';

const rule = { id: ruleId, userId: 7, version: 3, allowedFields: ['title'] as const,
  targetProjectId: null, timezone: 'UTC', parseVersion: 1, maxItems: 50 };

/** 注入用的上下文：补全被替身接管，这里只需要**不被默认那枚去读环境**。 */
const inertContext = {} as ManagedAiCompletionContext;

const completionWith = (tasks: unknown[], needsConfirmation = false): ManagedAiCompletionResult => ({
  ok: true, streaming: false, status: 200, contentType: 'application/json',
  text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks, ...(needsConfirmation ? { needsConfirmation: true } : {}) }) } }] }),
});

/**
 * 一个最小的那一行状态机替身：`findFirst` 返回给定行，`update` 记录每一次写入并把它
 * 回放到行上（所以下游读到的状态就是上游写过的状态，而不是各自编一份）。
 */
function eventRowStore(row: Record<string, unknown> | null) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const state = { row, updates };
  return {
    state,
    tx: () => ({
      $queryRaw: vi.fn(async () => []),
      automationEvent: {
        findFirst: vi.fn(async () => state.row),
        update: vi.fn(async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
          updates.push({ where, data });
          state.row = { ...(state.row as Record<string, unknown>), ...data };
          return state.row;
        }),
      },
      automationRule: { findFirst: vi.fn(async () => ({ enabled: true, deletedAt: null, version: rule.version })) },
    }),
  };
}

const runExtraction = async (row: Record<string, unknown> | null, result: ManagedAiCompletionResult | (() => Promise<never>),
  plaintext = Buffer.from(JSON.stringify({ title: MARKER, note: '不该被授权的字段' }), 'utf8')) => {
  const store = eventRowStore(row);
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(store.tx()));
  const complete = typeof result === 'function' ? result : vi.fn(async () => result);
  const { runHostedExtractionAtIngest } = await import('../src/automation/hosted-extraction');
  const outcome = await runHostedExtractionAtIngest({
    rule, eventId, contentType: 'application/json', plaintext,
    publicKey: pair.publicKey, keyEpoch: 2, accountId: 'user-7',
    serverOrigin: 'https://example.test', receivedAt: 1_800_000_000_000,
  }, { complete: complete as never, context: inertContext });
  return { outcome, store, complete };
};

const queuedRow = () => ({ eventId, ruleId, userId: 7, ruleVersion: rule.version, status: 'queued', attempt: 0,
  leaseGeneration: 1, payloadCiphertext: '{"sealed-input":true}', resultCiphertext: null, resultDigest: null,
  resultItemCount: null, reasonCode: null, expiresAt: new Date(1_900_000_000_000) });

describe('接收即抽取：正文不落库、结果封给账号自己的公钥', () => {
  it('抽取成功 ⇒ 那一行的 payload_ciphertext 被写成 NULL，而结果能用收件人私钥打开', async () => {
    const { outcome, store } = await runExtraction(queuedRow(), completionWith([{ title: MARKER }]));
    expect(outcome.state).toBe('prepared');
    const final = store.state.updates.at(-1)!;
    expect(final.data.payloadCiphertext).toBeNull();
    expect(final.data.status).toBe('prepared');
    const envelope = JSON.parse(String(final.data.resultCiphertext));
    const opened = new TextDecoder().decode(await openInbound(envelope, pair.privateKey, {
      accountId: 'user-7', serverOrigin: 'https://example.test', ruleId, eventId, purpose: 'result', keyEpoch: 2,
    }));
    expect(JSON.parse(opened).tasks[0].title).toBe(MARKER);
  });

  it('结果回执上的 digest / itemCount 与冻结的那份一致 —— 设备领到时按它校验，不是各算一遍', async () => {
    const { outcome, store } = await runExtraction(queuedRow(), completionWith([{ title: MARKER }]));
    if (outcome.state !== 'prepared') throw new Error('预期是 prepared');
    const final = store.state.updates.at(-1)!.data;
    expect(final.resultDigest).toBe(outcome.resultDigest);
    expect(final.resultItemCount).toBe(1);
    expect(final.parseVersion).toBe(rule.parseVersion);
    // 回执里那枚 digest 必须由**同一族**函数算出来（`inboundTaskDigest`），
    // 否则设备那条校验会把它读成"结果与服务端回执不符"。
    const envelope = JSON.parse(String(final.resultCiphertext));
    const payload = JSON.parse(new TextDecoder().decode(await openInbound(envelope, pair.privateKey, {
      accountId: 'user-7', serverOrigin: 'https://example.test', ruleId, eventId, purpose: 'result', keyEpoch: 2,
    })));
    expect(inboundTaskDigest(payload.tasks)).toBe(outcome.resultDigest);
  });

  it('标记串除那枚结果密文外，不在任何一次写、也不在任何一条日志里', async () => {
    const { store } = await runExtraction(queuedRow(), completionWith([{ title: MARKER }]));
    for (const update of store.state.updates) {
      const { resultCiphertext, ...withoutEnvelope } = update.data;
      expect(JSON.stringify(withoutEnvelope), '写库的某一列带上了正文').not.toContain(MARKER);
    }
    const logged = JSON.stringify([mocks.logger.warn.mock.calls, mocks.logger.audit.mock.calls,
      mocks.logger.info.mock.calls, mocks.logger.error.mock.calls]);
    expect(logged).not.toContain(MARKER);
  });

  it('授权的字段以外**根本不进那次提示词**：note 没被授权，模型就读不到它', async () => {
    const plaintext = Buffer.from(JSON.stringify({ title: '买牛奶', note: '这行不该被送到模型' }), 'utf8');
    const { complete } = await runExtraction(queuedRow(), completionWith([{ title: '买牛奶' }]), plaintext);
    const call = (complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const sent = JSON.stringify((call[1] as { messages: unknown }).messages);
    expect(sent).toContain('买牛奶');
    expect(sent).not.toContain('这行不该被送到模型');
  });
});

describe('抽取没成时，那一行退回设备那条老路（"只可能更早，不可能更少"）', () => {
  it('额度用尽 ⇒ 退回 queued、reasonCode 清掉、正文密文一字未动，也不写任何结果列', async () => {
    const refusal: ManagedAiCompletionResult = { ok: false, status: 409, code: 'AI_QUOTA_EXCEEDED', reason: 'QUOTA_EXCEEDED' };
    const { outcome, store } = await runExtraction(queuedRow(), refusal);
    expect(outcome).toEqual({ state: 'failed', reason: 'model-quota-exhausted' });
    const final = store.state.updates.at(-1)!.data;
    expect(final.status).toBe('queued');
    expect(final).not.toHaveProperty('payloadCiphertext');
    expect(final).not.toHaveProperty('resultCiphertext');
    expect((store.state.row as Record<string, unknown>).payloadCiphertext).toBe('{"sealed-input":true}');
  });

  it('模型给了没授权的字段 ⇒ 也算这一次没成，退回去而不是把半成品冻进库', async () => {
    const bad: ManagedAiCompletionResult = { ok: true, streaming: false, status: 200, contentType: 'application/json',
      text: JSON.stringify({ choices: [{ message: { content: '{"tasks":[{"projectId":"x"}]}' } }] }) };
    const { outcome, store } = await runExtraction(queuedRow(), bad);
    expect(outcome).toEqual({ state: 'failed', reason: 'model-result-unreadable' });
    expect(store.state.updates.at(-1)!.data.status).toBe('queued');
  });

  it('上游把补全回成非 JSON ⇒ model-result-unreadable，错误文本一个字符都不落', async () => {
    const { outcome, store } = await runExtraction(queuedRow(), { ok: true, streaming: false, status: 200,
      contentType: 'application/json', text: 'upstream exploded near ' + MARKER });
    expect(outcome).toEqual({ state: 'failed', reason: 'model-result-unreadable' });
    expect(JSON.stringify(store.state.updates)).not.toContain(MARKER);
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(MARKER);
  });

  it('日期不合规则冻成"待确认"那一档，而不是替用户猜一个日期', async () => {
    const { outcome, store } = await runExtraction(queuedRow(), completionWith([{ title: '开会', dueDate: '明天下午' }], true));
    expect(outcome.state).toBe('needs-confirmation');
    const final = store.state.updates.at(-1)!.data;
    expect(final.status).toBe('needs-confirmation');
    expect(final.reasonCode).toBe('needs-confirmation');
    expect(final.payloadCiphertext).toBeNull();
  });

  it('那一行已经不是 queued（设备先领走了）⇒ 一次模型请求都不发，额度一枚不烧', async () => {
    const taken = { ...queuedRow(), status: 'leased', leaseWorkerId: 'worker-1' };
    const { outcome, complete } = await runExtraction(taken, completionWith([{ title: MARKER }]));
    expect(outcome).toEqual({ state: 'failed', reason: 'result-conflict' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('落终态时租约已被接走 ⇒ 匹配 0 行，这份结果直接丢弃', async () => {
    const store = eventRowStore(queuedRow());
    let calls = 0;
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      calls += 1;
      if (calls === 1) return fn(store.tx());
      return fn({ $queryRaw: vi.fn(async () => []), automationEvent: { findFirst: vi.fn(async () => null) },
        automationRule: { findFirst: vi.fn(async () => ({ enabled: true, deletedAt: null, version: rule.version })) } });
    });
    const { runHostedExtractionAtIngest } = await import('../src/automation/hosted-extraction');
    const outcome = await runHostedExtractionAtIngest({ rule, eventId, contentType: 'application/json',
      plaintext: Buffer.from(JSON.stringify({ title: MARKER }), 'utf8'), publicKey: pair.publicKey, keyEpoch: 2,
      accountId: 'user-7', serverOrigin: 'https://example.test', receivedAt: 1_800_000_000_000 },
    { complete: vi.fn(async () => completionWith([{ title: MARKER }])) as never, context: inertContext });
    expect(outcome).toEqual({ state: 'failed', reason: 'result-conflict' });
    expect(store.state.updates).toHaveLength(1);
    expect(store.state.updates[0]!.data.status).toBe('leased');
  });
});

describe('设备那条路不会把服务端那条租约当成"再抽一遍"', () => {
  const identity = { credentialHash: 'a'.repeat(64), databaseEpoch: 'epoch', tokenVersion: 0 };

  it('服务端租约过期 ⇒ 转 model-result-uncertain 要用户显式重试（台账里没有这一腿的行也照样拦）', async () => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ event_id: 'event', rule_id: 'rule',
        rule_version: 1, payload_ciphertext: '{"sealed-input":true}', status: 'leased', lease_worker_id: 'hosted-extraction',
        lease_expires_at: new Date(1), expires_at: new Date(1_900_000_000_000) }]),
      automationWorker: { findFirst: vi.fn().mockResolvedValue({ id: 'worker' }) },
      // 🔴 这一支的关键：台账**空的**（服务端那条腿不写它）。摘掉持有者判定，设备就会
      // 在这里重新领走并再发一次物理调用 —— 那条变异臂就是把下面这枚 findFirst 的
      // 返回值改成 null 之外什么都不动，用例照样绿才算没牙。
      automationAiAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
      automationEvent: { update },
    };
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const { claimAutomationEvent } = await import('../src/automation/events');
    expect(await claimAutomationEvent(7, 'client', identity, new Date(1_800_000_000_000))).toBeUndefined();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'needs-confirmation', reasonCode: 'model-result-uncertain' }) }));
  });
});

describe('门槛：这条腿不许长出第二套实现，也不许碰任务写回', () => {
  // vitest 的 cwd 就是 `server` 这一档（与 `apps/web` 那几枚源码读同一办法），
  // 所以这里一律按 `src/...` 相对 cwd 读，不跟着 import.meta.url 绕。
  const read = (rel: string) => readFileSync(rel, 'utf8');
  const sourceTree = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceTree(full);
    return /\.ts$/u.test(entry) ? [full] : [];
  });

  it('`/chat/completions` 的拼接点在整个 server/src 里恰好一枚（第二套发送腿的门槛）', () => {
    const sites = sourceTree('src').filter((file) => read(file).includes('/chat/completions'));
    // 分母自己站在判据里：扫到 0 枚也是红（改名或换写法不等于重复没了）。
    expect(sites, `扫到的拼接点：${sites.join(' , ') || '一处都没有'}`).toHaveLength(1);
    expect(sites[0]!.endsWith('managed-completion.ts')).toBe(true);
  });

  it('服务端这条腿不写 commit permit、不碰 op 写入，也没有第二份正文出口', () => {
    // 🔴 先剥注释：本文件的表头就把 `automation_commit_permit` 这个名字**当作禁令引用**写了一遍。
    // 不剥注释的源码读只能证明"注释里没提过这件事"，那是每个写文档的人都会红到自己和必须
    // 改回来说明的形状 —— 与 `apps/mobile/tests/source-reading.ts` 同一条纪律。
    const src = read('src/automation/hosted-extraction.ts')
      .replace(/\/\*[\S\s]*?\*\//gu, '')
      .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
    expect(src).not.toMatch(/automationCommitPermit|commit_permit|createTaskBatch|dispatchValidated/u);
    // 唯一一次给 `payloadCiphertext` 赋值必须是写成 null。
    expect(src).toMatch(/payloadCiphertext: null/u);
    expect(src).not.toMatch(/payloadCiphertext:\s*(?!null)[,\n}]/u);
  });

  it('这条腿自己限时、且不开任何明文主机（超时与白名单的形状不许漂）', () => {
    const src = read('src/automation/hosted-extraction.ts');
    expect(src).toMatch(/managedAiFetchTransport\(HOSTED_EXTRACTION_TIMEOUT_MS\)/u);
    expect(src).toMatch(/plaintextHosts: \[\]/u);
  });
});
