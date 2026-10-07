import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { equalBytes } from '@noble/curves/utils.js';

export const INBOUND_MAX_REQUEST_BYTES = 64 * 1024;
export const INBOUND_SIGNATURE_SKEW_SECONDS = 300;
export const INBOUND_JSON_MAX_DEPTH = 8;
export const INBOUND_JSON_MAX_KEYS = 512;

export type InboundContentType = 'application/json' | 'text/plain';
export interface WebhookSignatureInput {
  method: 'POST' | 'GET';
  /** Actual raw path, with no query string or alternate normalization. */
  path: string;
  ruleId: string;
  keyId: string;
  timestamp: string;
  eventId: string;
  contentType: InboundContentType;
  body: Uint8Array;
}

export class InboundRequestError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'BODY_TOO_LARGE' | 'INVALID_SIGNATURE' | 'SIGNATURE_EXPIRED' | 'INVALID_UTF8' | 'INVALID_JSON') {
    super(code);
    this.name = 'InboundRequestError';
  }
}

const reject = (code: InboundRequestError['code']): never => { throw new InboundRequestError(code); };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const encoder = (): TextEncoder => new TextEncoder();

function checkInput(input: WebhookSignatureInput): void {
  if (!idPattern.test(input.ruleId) || !idPattern.test(input.keyId) || !idPattern.test(input.eventId) ||
      !/^(0|[1-9][0-9]{0,12})$/.test(input.timestamp) ||
      !Number.isSafeInteger(Number(input.timestamp)) ||
      (input.contentType !== 'application/json' && input.contentType !== 'text/plain') ||
      !(input.body instanceof Uint8Array)) reject('INVALID_REQUEST');
  if (input.body.byteLength > INBOUND_MAX_REQUEST_BYTES) reject('BODY_TOO_LARGE');
  const base = `/api/automation/v1/hooks/${input.ruleId}`;
  if (input.method === 'POST') {
    if (input.path !== base) reject('INVALID_REQUEST');
  } else if (input.method === 'GET') {
    if (input.path !== `${base}/events/${input.eventId}` || input.body.byteLength !== 0 || input.contentType !== 'application/json') reject('INVALID_REQUEST');
  } else reject('INVALID_REQUEST');
}

export function inboundBodyDigest(body: Uint8Array): string { return bytesToHex(sha256(body)); }

export function webhookSigningBytes(input: WebhookSignatureInput): Uint8Array {
  checkInput(input);
  return encoder().encode([
    'heyta-inbound-v1', input.method, input.path, input.keyId, input.timestamp,
    input.eventId, input.contentType, inboundBodyDigest(input.body),
  ].join('\n'));
}

export function signWebhook(secret: Uint8Array, input: WebhookSignatureInput): string {
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) reject('INVALID_REQUEST');
  return bytesToHex(hmac(sha256, secret, webhookSigningBytes(input)));
}

export function verifyWebhook(secret: Uint8Array, input: WebhookSignatureInput, signature: string, nowMs: number): void {
  checkInput(input);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) reject('INVALID_REQUEST');
  if (Math.abs(nowMs / 1000 - Number(input.timestamp)) > INBOUND_SIGNATURE_SKEW_SECONDS) reject('SIGNATURE_EXPIRED');
  if (!/^[0-9a-f]{64}$/.test(signature)) reject('INVALID_SIGNATURE');
  const expected = hexToBytes(signWebhook(secret, input));
  const actual = hexToBytes(signature);
  if (!equalBytes(expected, actual)) reject('INVALID_SIGNATURE');
}

/** Node/HTTP adapters must pass rawHeaders; a folded header map loses duplicates. */
export function readWebhookHeaders(rawHeaders: readonly string[]): {
  keyId: string; timestamp: string; eventId: string; signature: string; contentType: InboundContentType;
} {
  if (rawHeaders.length % 2 !== 0) reject('INVALID_REQUEST');
  const required = ['x-heyta-key-id', 'x-heyta-timestamp', 'x-heyta-event-id', 'x-heyta-signature', 'content-type'];
  const values = new Map<string, string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i]!.toLowerCase();
    if (name === 'content-encoding') reject('INVALID_REQUEST');
    if (!required.includes(name)) continue;
    if (values.has(name)) reject('INVALID_REQUEST');
    values.set(name, rawHeaders[i + 1]!);
  }
  if (required.some((name) => !values.has(name))) reject('INVALID_REQUEST');
  const type = values.get('content-type')!;
  if (!/^(application\/json|text\/plain)(; charset=utf-8)?$/.test(type)) reject('INVALID_REQUEST');
  return {
    keyId: values.get('x-heyta-key-id')!, timestamp: values.get('x-heyta-timestamp')!,
    eventId: values.get('x-heyta-event-id')!, signature: values.get('x-heyta-signature')!,
    contentType: type.startsWith('application/json') ? 'application/json' : 'text/plain',
  };
}

/** Roundtrip catches invalid UTF-8 even when a host's TextDecoder ignores fatal. */
export function decodeInboundUtf8(bytes: Uint8Array): string {
  if (bytes.byteLength > INBOUND_MAX_REQUEST_BYTES) reject('BODY_TOO_LARGE');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // BOM is intentionally rejected: signatures and parsed bytes have one spelling.
    if (!equalBytes(encoder().encode(text), bytes)) reject('INVALID_UTF8');
    return text;
  } catch { return reject('INVALID_UTF8'); }
}

/** Validate syntax, duplicate keys and complexity before returning mapped input. */
export function parseInboundJson(bytes: Uint8Array): Record<string, unknown> {
  const text = decodeInboundUtf8(bytes);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return reject('INVALID_JSON'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) reject('INVALID_JSON');
  let cursor = 0;
  let keys = 0;
  const space = () => { while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++; };
  const readString = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') return JSON.parse(text.slice(start, cursor)) as string;
    }
    return reject('INVALID_JSON');
  };
  const visit = (depth: number): void => {
    if (depth > INBOUND_JSON_MAX_DEPTH) reject('INVALID_JSON');
    space();
    const character = text[cursor];
    if (character === '{') {
      cursor++; space();
      const seen = new Set<string>();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        space(); const key = readString();
        if (seen.has(key) || ++keys > INBOUND_JSON_MAX_KEYS) reject('INVALID_JSON');
        seen.add(key); space(); cursor++; // ':' (syntax already verified)
        visit(depth + 1); space();
        if (text[cursor++] === '}') return;
      }
    } else if (character === '[') {
      cursor++; space();
      if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) {
        visit(depth + 1); space();
        if (text[cursor++] === ']') return;
      }
    } else if (character === '"') { readString(); }
    else { while (cursor < text.length && !/[\s,}\]]/.test(text[cursor]!)) cursor++; }
  };
  visit(0);
  return parsed as Record<string, unknown>;
}
