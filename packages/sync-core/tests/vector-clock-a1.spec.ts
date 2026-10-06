import { describe, expect, it, vi } from 'vitest';

import {
  MAX_VECTOR_CLOCK_SIZE,
  limitVectorClockSize,
  mergeVectorClocks,
} from '../src/vector-clock';
import type { VectorClock } from '../src/vector-clock';

const makeClock = (size: number): VectorClock => {
  const clock: VectorClock = {};
  for (let i = 0; i < size; i += 1) {
    clock[`client-${String(i).padStart(3, '0')}`] = 1;
  }
  return clock;
};

describe('A1: bounded clocks cannot self-heal every dropped causal key', () => {
  it('shows that a damaged client clock loses one historical key at 101 clients', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = makeClock(MAX_VECTOR_CLOCK_SIZE + 1);
    const damaged = limitVectorClockSize(full, ['client-100']);
    warn.mockRestore();

    expect(Object.keys(full)).toHaveLength(MAX_VECTOR_CLOCK_SIZE + 1);
    expect(Object.keys(damaged)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);
    expect(Object.keys(full).some((id) => damaged[id] === undefined)).toBe(true);
  });

  it('shows that the current bounded snapshot response cannot carry all 101 keys back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = makeClock(MAX_VECTOR_CLOCK_SIZE + 1);
    const damaged = limitVectorClockSize(full, ['client-100']);
    const boundedSnapshot = limitVectorClockSize(full, ['client-100', 'snapshot-author']);
    const repaired = mergeVectorClocks(damaged, boundedSnapshot);
    warn.mockRestore();

    // The current server download path applies limitVectorClockSize to the
    // persisted aggregate before returning snapshotVectorClock. Merging that
    // bounded response cannot recreate every 101-key frontier.
    expect(Object.keys(boundedSnapshot)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);
    expect(Object.keys(repaired)).toHaveLength(MAX_VECTOR_CLOCK_SIZE);
    expect(Object.keys(full).some((id) => repaired[id] === undefined)).toBe(true);
  });
});
