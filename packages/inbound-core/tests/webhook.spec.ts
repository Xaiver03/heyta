import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  signWebhook, verifyWebhook, readWebhookHeaders, decodeInboundUtf8, parseInboundJson,
  INBOUND_MAX_REQUEST_BYTES, INBOUND_JSON_MAX_KEYS, type WebhookSignatureInput,
} from '../src/index.js';

const secret = new Uint8Array(32).fill(1);
const body = (text: string) => new TextEncoder().encode(text);
const request = (): WebhookSignatureInput => ({
  method: 'POST', path: '/api/automation/v1/hooks/rule', ruleId: 'rule', keyId: 'key',
  timestamp: '1800000000', eventId: 'source-event', contentType: 'application/json', body: body('{"text":"计划"}'),
});
const headers = () => [
  'X-Heyta-Key-Id', 'key', 'X-Heyta-Timestamp', '1800000000', 'X-Heyta-Event-Id', 'source-event',
  'X-Heyta-Signature', signWebhook(secret, request()), 'Content-Type', 'application/json; charset=utf-8',
];

describe('byte-level request signatures', () => {
  it('matches independent Node HMAC and preserves raw bytes rather than reserialized JSON', () => {
    const input = request();
    const digest = createHash('sha256').update(input.body).digest('hex');
    const canonical = `heyta-inbound-v1\nPOST\n/api/automation/v1/hooks/rule\nkey\n1800000000\nsource-event\napplication/json\n${digest}`;
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    const vector = JSON.parse(readFileSync(new URL('../fixtures/webhook-v1.json', import.meta.url), 'utf8')) as { signatureHex: string; canonicalUtf8: string };
    expect(vector.canonicalUtf8 === canonical).toBe(true);
    expect(vector.signatureHex === expected).toBe(true);
    expect(signWebhook(secret, input) === expected).toBe(true);
    expect(() => verifyWebhook(secret, input, expected, 1_800_000_000_000)).not.toThrow();
    expect(() => verifyWebhook(secret, { ...input, body: body('{ "text": "计划" }') }, expected, 1_800_000_000_000)).toThrow('INVALID_SIGNATURE');
  });

  it('accepts both exact time-window edges and rejects beyond either edge', () => {
    const input = request(); const signature = signWebhook(secret, input);
    for (const delta of [-300_000, 300_000]) expect(() => verifyWebhook(secret, input, signature, 1_800_000_000_000 + delta)).not.toThrow();
    for (const delta of [-300_001, 300_001]) expect(() => verifyWebhook(secret, input, signature, 1_800_000_000_000 + delta)).toThrow('SIGNATURE_EXPIRED');
  });

  it('binds every identity/header and rejects alternate path spellings', () => {
    const input = request(); const signature = signWebhook(secret, input);
    const altered: Partial<WebhookSignatureInput>[] = [
      { eventId: 'other' }, { keyId: 'other' }, { timestamp: '1800000001' }, { contentType: 'text/plain' },
      { ruleId: 'other', path: '/api/automation/v1/hooks/other' },
      { path: `${input.path}?q=1` }, { path: `${input.path}/` }, { path: '/api/automation/v1/hooks/%72ule' },
    ];
    for (const change of altered) expect(() => verifyWebhook(secret, { ...input, ...change }, signature, 1_800_000_000_000)).toThrow();
    for (const invalid of [signature.toUpperCase(), signature.slice(1), `${signature}\n`, 'z'.repeat(64)]) {
      expect(() => verifyWebhook(secret, input, invalid, 1_800_000_000_000)).toThrow('INVALID_SIGNATURE');
    }
  });

  it('signs an authenticated query, but not a query with a body or a mismatched event', () => {
    const input: WebhookSignatureInput = { ...request(), method: 'GET', path: '/api/automation/v1/hooks/rule/events/source-event', body: new Uint8Array() };
    expect(() => verifyWebhook(secret, input, signWebhook(secret, input), 1_800_000_000_000)).not.toThrow();
    expect(() => signWebhook(secret, { ...input, body: body('{}') })).toThrow();
    expect(() => signWebhook(secret, { ...input, eventId: 'other' })).toThrow();
  });

  it('enforces request size and fixed secret length', () => {
    expect(() => signWebhook(secret, { ...request(), body: new Uint8Array(INBOUND_MAX_REQUEST_BYTES) })).not.toThrow();
    expect(() => signWebhook(secret, { ...request(), body: new Uint8Array(INBOUND_MAX_REQUEST_BYTES + 1) })).toThrow('BODY_TOO_LARGE');
    expect(() => signWebhook(new Uint8Array(31), request())).toThrow();
  });

  it('reads raw headers and rejects every duplicate protected header, encoding, and missing field', () => {
    expect(readWebhookHeaders(headers()).contentType).toBe('application/json');
    for (let i = 0; i < headers().length; i += 2) {
      expect(() => readWebhookHeaders([...headers(), headers()[i]!.toLowerCase(), headers()[i + 1]!])).toThrow();
      const missing = headers(); missing.splice(i, 2);
      expect(() => readWebhookHeaders(missing)).toThrow();
    }
    expect(() => readWebhookHeaders([...headers(), 'Content-Encoding', 'identity'])).toThrow();
    expect(() => readWebhookHeaders([...headers(), 'unpaired'])).toThrow();
  });
});

describe('bounded JSON and UTF-8 input', () => {
  it('accepts nested objects, escaped strings and repeated names in different objects', () => {
    const valid = { a: { same: 1 }, b: [{ same: 2 }], c: 'quoted " text' };
    expect(parseInboundJson(body(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each([
    '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":{"b":1,"b":2}}',
    '{"a":[{"b":1,"b":2}]}', '[]', 'null', '3', '"text"', '{"a":undefined}',
  ])('rejects ambiguous or invalid JSON %#', (text) => {
    expect(() => parseInboundJson(body(text))).toThrow('INVALID_JSON');
  });

  it('enforces total key and depth bounds at the edge', () => {
    const atLimit = Object.fromEntries(Array.from({ length: INBOUND_JSON_MAX_KEYS }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(parseInboundJson(body(JSON.stringify(atLimit))))).toHaveLength(INBOUND_JSON_MAX_KEYS);
    expect(() => parseInboundJson(body(JSON.stringify({ ...atLimit, extra: 1 })))).toThrow('INVALID_JSON');
    const nested = (depth: number) => '{"a":'.repeat(depth) + '0' + '}'.repeat(depth);
    expect(() => parseInboundJson(body(nested(8)))).not.toThrow();
    expect(() => parseInboundJson(body(nested(9)))).toThrow('INVALID_JSON');
  });

  it('rejects bad UTF-8, BOM, overlong encodings and over-sized raw bytes', () => {
    for (const bad of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xef, 0xbb, 0xbf, 0x61]]) {
      expect(() => decodeInboundUtf8(new Uint8Array(bad))).toThrow('INVALID_UTF8');
    }
    expect(decodeInboundUtf8(body('合法 replacement \ufffd'))).toBe('合法 replacement \ufffd');
    expect(() => decodeInboundUtf8(new Uint8Array(INBOUND_MAX_REQUEST_BYTES + 1))).toThrow('BODY_TOO_LARGE');
  });
});
