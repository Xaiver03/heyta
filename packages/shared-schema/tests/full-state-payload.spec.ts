import { describe, expect, it } from 'vitest';
import { isHeytaFullStatePayload } from '../src/full-state-payload.js';
import { SuperSyncUploadOpsResponseSchema } from '../src/supersync-http-contract.js';

describe('versioned maintenance snapshot envelope', () => {
  const valid = { isFullState: true, heytaStateVersion: 1, state: {}, repairBaseServerSeq: 0 };
  it('accepts a versioned envelope without attempting reducer validation', () => {
    expect(isHeytaFullStatePayload(valid)).toBe(true);
  });
  it.each([null, [], {}, { ...valid, isFullState: false }, { ...valid, heytaStateVersion: 2 },
    { ...valid, state: null }, { ...valid, repairBaseServerSeq: -1 },
    { ...valid, repairBaseServerSeq: 1.5 }, { ...valid, repairBaseServerSeq: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects incomplete or unsupported envelopes: %j', (payload) => {
    expect(isHeytaFullStatePayload(payload)).toBe(false);
  });
  it('preserves a piggyback gap as a typed protocol diagnostic', () => {
    expect(SuperSyncUploadOpsResponseSchema.parse({ results: [], latestSeq: 7, gapDetected: true }))
      .toMatchObject({ gapDetected: true });
    expect(SuperSyncUploadOpsResponseSchema.safeParse({ results: [], latestSeq: 7, gapDetected: 'true' }).success)
      .toBe(false);
  });
});
