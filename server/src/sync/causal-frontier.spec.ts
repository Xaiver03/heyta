import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expandFrontierDelta,
  issueCausalFrontierToken,
  verifyCausalFrontierToken,
} from './causal-frontier';

describe('causal frontier wire protocol', () => {
  const originalSecret = process.env.JWT_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-frontier';
  });

  it('round-trips a signed frontier and expands only marked deltas', () => {
    const clock = { a: 4, b: 2 };
    const token = issueCausalFrontierToken(7, 12, clock);
    expect(token).toBeDefined();
    const frontier = verifyCausalFrontierToken(token!, 7, 20);
    expect(frontier?.vectorClock).toEqual(clock);
    expect(
      expandFrontierDelta(
        [
          { vectorClock: { a: 5 }, vectorClockEncoding: 'frontier-delta' },
          { vectorClock: { z: 1 } },
        ],
        frontier!,
      ),
    ).toEqual([
      { vectorClock: { a: 5, b: 2 }, vectorClockEncoding: 'full' },
      { vectorClock: { z: 1 } },
    ]);
  });

  it('rejects tampering, wrong account, and a future frontier', () => {
    const token = issueCausalFrontierToken(7, 12, { a: 4 })!;
    expect(verifyCausalFrontierToken(`${token}x`, 7, 20)).toBeUndefined();
    expect(verifyCausalFrontierToken(token, 8, 20)).toBeUndefined();
    expect(verifyCausalFrontierToken(token, 7, 11)).toBeUndefined();
  });

  it('rejects coercion or a delta below its base instead of silently raising it', () => {
    const token = issueCausalFrontierToken(7, 12, { a: 4 })!;
    const frontier = verifyCausalFrontierToken(token, 7, 12)!;
    for (const vectorClock of [{ a: 2 }, { b: -1 }, { b: NaN }, { b: '4' }]) {
      expect(() => expandFrontierDelta([{ vectorClock: vectorClock as unknown as Record<string, number>, vectorClockEncoding: 'frontier-delta' }], frontier)).toThrow();
    }
  });

  it('fails closed when the signing secret is unavailable', () => {
    delete process.env.JWT_SECRET;
    expect(issueCausalFrontierToken(7, 1, { a: 1 })).toBeUndefined();
  });
});
