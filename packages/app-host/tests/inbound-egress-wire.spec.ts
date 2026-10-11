/**
 * 自动收集「实际出境请求符合披露」的**线级**取证。
 *
 * `inbound-runner.spec.ts` 已经把投影层钉到键集合逐字相等，但它走的是注入的 `fetchImpl`
 * —— 那回答的是"生产代码交给 transport 的那枚对象长什么样"，回答不了：
 * ① 真 HTTP 层发出去的**字节**里有没有多出别的东西（包装层、遥测、第二个端点）；
 * ② 整趟是不是**只有一次**物理请求；
 * ③ 账号侧的东西（同步服务地址、输入私钥）有没有混进模型请求。
 * 所以这一枚刻意**不注入 fetchImpl**，把端点指到本机回环上真起的一枚 http 服务器，
 * 判据全部打在它收到的原始报文上。
 */
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { generateInboundKeyPair, openInbound, sealInbound } from '@heyta/inbound-core';
import { runInboundAutomationEvent, type InboundAutomationRunOptions } from '../src/inbound-runner.js';

const NOTE = 'NOTE-SENTINEL-must-not-leave';
const PROJECT = 'PROJECT-SENTINEL-must-not-leave';
const DUE = 'DUE-SENTINEL-2026-03-04';
const TITLE = 'TITLE-SENTINEL-buy-oat-milk';
const SYNC_SERVER = 'https://sync.my-own-host.example';
// 键名必须落在 INBOUND_AUTOMATION_FIELDS 上，否则"没上线"是因为名字不对而不是因为没勾 —— 见文件末那条对照。
const EXCLUDED = [NOTE, PROJECT, DUE];

async function listen(): Promise<{ port: number; hits: { method: string; url: string; raw: string }[]; close: () => Promise<void> }> {
  const hits: { method: string; url: string; raw: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', raw: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ title: TITLE }] }) } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('loopback capture server did not get a port');
  return { port: address.port, hits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function cycle(allowedFields: InboundAutomationRunOptions['allowedFields'], port: number) {
  const pair = generateInboundKeyPair();
  const privateCopy = pair.privateKey.slice();
  const sealed = await sealInbound(
    new TextEncoder().encode(JSON.stringify({ title: TITLE, note: NOTE, projectId: PROJECT, dueDate: DUE })),
    pair.publicKey,
    { accountId: 'account', serverOrigin: SYNC_SERVER, ruleId: 'rule-1', eventId: 'event-wire', purpose: 'input', keyEpoch: 1 },
  );
  const options: InboundAutomationRunOptions = {
    claimed: { eventId: 'event-wire', ruleId: 'rule-1', ruleVersion: 1, contentType: 'application/json',
      payloadCiphertext: JSON.stringify(sealed), receivedAt: 1_700_000_000_000, leaseGeneration: 1,
      leaseExpiresAt: '2030-01-01T00:00:00Z', attempt: 1, allowedFields, parseVersion: 1, maxItems: 50 },
    privateKey: pair.privateKey, accountId: 'account', serverOrigin: SYNC_SERVER, keyEpoch: 1, allowedFields,
    routing: { enabled: true, allowRemote: false,
      endpoints: [{ id: 'loopback', label: 'loopback', endpoint: `http://127.0.0.1:${port}/v1`, model: 'wire-probe' }],
      routes: { 'inbound-automation': [{ endpointId: 'loopback' }] } },
    consents: [], systemPrompt: 'Return tasks JSON', parseVersion: 1, now: () => 1_800_000_000_000,
    publish: async () => undefined,
  };
  return { options, privateCopy, sealed };
}

describe('inbound automation egress on the wire', () => {
  it('🔴 先证明被排除的字段确实躺在明文里（否则"没上线"是空话）', async () => {
    const { sealed, privateCopy } = await cycle(['title'], 1);
    const opened = await openInbound(sealed, privateCopy, { accountId: 'account', serverOrigin: SYNC_SERVER,
      ruleId: 'rule-1', eventId: 'event-wire', purpose: 'input', keyEpoch: 1 });
    const plaintext = new TextDecoder().decode(opened);
    for (const sentinel of [TITLE, ...EXCLUDED]) expect(plaintext).toContain(sentinel);
    privateCopy.fill(0);
  });

  it('🔴 线上只出现白名单字段，且整趟只有一次物理请求', async () => {
    const { port, hits, close } = await listen();
    const { options, privateCopy } = await cycle(['title'], port);
    try {
      await runInboundAutomationEvent(options);
      expect(hits.map((hit) => hit.method)).toEqual(['POST']);
      const wire = hits[0]!.raw;
      expect(wire).toContain(TITLE);
      for (const sentinel of EXCLUDED) expect(wire, `未勾的 ${sentinel} 上了线`).not.toContain(sentinel);
      const sent = JSON.parse(wire) as { messages: { content: string }[] };
      const outgoing = JSON.parse(sent.messages.at(-1)!.content) as { source: Record<string, unknown> };
      expect(Object.keys(outgoing.source)).toEqual(['title']);
    } finally { await close(); privateCopy.fill(0); }
  });

  it('🔴 账号侧的东西不上模型请求：同步服务地址与输入私钥都不在线上', async () => {
    const { port, hits, close } = await listen();
    const { options, privateCopy } = await cycle(['title'], port);
    const keyAsText = [Buffer.from(privateCopy).toString('base64'), Buffer.from(privateCopy).toString('hex')];
    try {
      await runInboundAutomationEvent(options);
      const raw = hits.map((hit) => `${hit.method} ${hit.url}\n${hit.raw}`).join('\n');
      expect(raw).not.toContain(SYNC_SERVER);
      for (const form of keyAsText) expect(raw, '输入私钥出现在模型请求里').not.toContain(form);
    } finally { await close(); privateCopy.fill(0); }
  });

  it('⚠️ 反面对照：勾上 notes 之后它必须上线（否则上面那条"没上线"永远红不了）', async () => {
    const { port, hits, close } = await listen();
    const { options, privateCopy } = await cycle(['title', 'note'], port);
    try {
      await runInboundAutomationEvent(options);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.raw).toContain(NOTE);
    } finally { await close(); privateCopy.fill(0); }
  });
});
