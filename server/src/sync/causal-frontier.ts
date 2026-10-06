import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VectorClock } from '@heyta/sync-core';
import { expandVectorClockFromFrontier } from '@heyta/sync-core';

/** Versioned wire envelope for a server-confirmed causal frontier. */
interface FrontierEnvelope {
  v: 1;
  userId: number;
  snapshotSeq: number;
  vectorClock: VectorClock;
}

const FRONTIER_PREFIX = 'cf1.';

const secret = (): string | undefined => {
  const value = process.env.JWT_SECRET;
  return value && value.length >= 32 ? value : undefined;
};

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');
const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const sign = (body: string, key: string): string =>
  createHmac('sha256', key).update('heyta:causal-frontier:v1\0').update(body).digest('base64url');

/** Issue a compact, tamper-evident token. The clock is included so validation
 * does not depend on retaining every historical snapshot row. */
export function issueCausalFrontierToken(
  userId: number,
  snapshotSeq: number,
  vectorClock: VectorClock,
): string | undefined {
  const key = secret();
  if (!key) return undefined;
  const envelope: FrontierEnvelope = { v: 1, userId, snapshotSeq, vectorClock };
  const body = encode(JSON.stringify(envelope));
  const token = `${FRONTIER_PREFIX}${body}.${sign(body, key)}`;
  return token.length <= 65536 ? token : undefined;
}

export type VerifiedCausalFrontier = FrontierEnvelope;

/** Verify signature, shape, account binding, and sequence bounds. */
export function verifyCausalFrontierToken(
  token: string,
  userId: number,
  latestSeq: number,
): VerifiedCausalFrontier | undefined {
  const key = secret();
  if (!key || token.length > 65536 || !token.startsWith(FRONTIER_PREFIX)) return undefined;
  const rest = token.slice(FRONTIER_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const body = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return undefined;
  const expected = sign(body, key);
  const actualBytes = Buffer.from(signature, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (
    actualBytes.toString('base64url') !== signature ||
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(decode(body)) as Partial<FrontierEnvelope>;
    if (
      parsed.v !== 1 ||
      parsed.userId !== userId ||
      !Number.isInteger(parsed.snapshotSeq) ||
      parsed.vectorClock === undefined ||
      typeof parsed.vectorClock !== 'object' ||
      parsed.vectorClock === null ||
      Array.isArray(parsed.vectorClock)
    ) {
      return undefined;
    }
    const snapshotSeq = parsed.snapshotSeq;
    if (snapshotSeq === undefined || snapshotSeq < 0 || snapshotSeq > latestSeq) {
      return undefined;
    }
    for (const [clientId, counter] of Object.entries(parsed.vectorClock)) {
      if (
        clientId.length === 0 ||
        clientId.length > 255 ||
        !Number.isSafeInteger(counter) ||
        counter < 0
      ) {
        return undefined;
      }
    }
    return { ...parsed, snapshotSeq } as FrontierEnvelope;
  } catch {
    return undefined;
  }
}

/** Expand only explicitly marked deltas. Full-clock operations are returned
 * untouched so mixed old/new batches remain valid. */
export function expandFrontierDelta<T extends { vectorClock: VectorClock; vectorClockEncoding?: string }>(
  ops: readonly T[],
  frontier: VerifiedCausalFrontier,
): T[] {
  return ops.map((op) => {
    if (op.vectorClockEncoding !== 'frontier-delta') return op;
    for (const [id, value] of Object.entries(op.vectorClock)) {
      if (!id || id.length > 255 || !Number.isSafeInteger(value) || value < 0 || value < (frontier.vectorClock[id] ?? 0)) {
        throw new Error('Invalid causal frontier delta');
      }
    }
    return {
      ...op,
      vectorClock: expandVectorClockFromFrontier(op.vectorClock, frontier.vectorClock),
      vectorClockEncoding: 'full' as const,
    };
  });
}
