import { describe, expect, it } from 'vitest';

import {
  compactVectorClockAgainstFrontier,
  expandVectorClockFromFrontier,
  compareVectorClocks,
} from '../src/index';

describe('causal-safe vector-clock compaction', () => {
  it('drops only entries covered by the acknowledged frontier', () => {
    const compacted = compactVectorClockAgainstFrontier(
      { stableA: 7, stableB: 2, active: 4 },
      { stableA: 7, stableB: 2 },
    );
    expect(compacted).toEqual({ active: 4 });
    expect(expandVectorClockFromFrontier(compacted, { stableA: 7, stableB: 2 })).toEqual({
      stableA: 7,
      stableB: 2,
      active: 4,
    });
  });

  it('never drops a key absent from the frontier or above its frontier counter', () => {
    const clock = { known: 8, unknown: 1, active: 5 };
    const frontier = { known: 7 };
    const compacted = compactVectorClockAgainstFrontier(clock, frontier);
    expect(compacted).toEqual(clock);
  });

  it('preserves causal comparisons after expansion', () => {
    const frontier = { a: 4, b: 2 };
    const original = { a: 4, b: 2, c: 3 };
    const compacted = compactVectorClockAgainstFrontier(original, frontier);
    const expanded = expandVectorClockFromFrontier(compacted, frontier);

    expect(compareVectorClocks(expanded, original)).toBe('EQUAL');
    expect(compareVectorClocks(expanded, { a: 4, b: 2, c: 2 })).toBe('GREATER_THAN');
  });

  it('refuses to invent dependencies in an older or concurrent operation', () => {
    for (const clock of ([{ a: 1 }, { a: 1, b: 4 }, { a: 2 }] as Array<Record<string, number>>)) {
      expect(() => compactVectorClockAgainstFrontier(clock, { a: 2, c: 1 })).toThrow();
    }
  });

  it('round-trips generated dominated clocks without changing any comparison', () => {
    for (let seed = 0; seed < 100; seed++) {
      const frontier = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`d${i}`, (i + seed) % 7]));
      const original = Object.fromEntries(Object.entries(frontier).map(([id, value], i) => [id, value + (i % 3)]));
      const expanded = expandVectorClockFromFrontier(compactVectorClockAgainstFrontier(original, frontier), frontier);
      expect(expanded).toEqual(original);
      expect(compareVectorClocks(expanded, { ...frontier, unseen: seed + 1 })).toBe(compareVectorClocks(original, { ...frontier, unseen: seed + 1 }));
    }
  });

  it('keeps the local author even when its counter is covered', () => {
    expect(
      compactVectorClockAgainstFrontier(
        { local: 3, stable: 8 },
        { local: 3, stable: 8 },
        ['local'],
      ),
    ).toEqual({ local: 3 });
  });
});
