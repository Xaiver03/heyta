import { compareVectorClocks, type VectorClock } from './vector-clock';

/**
 * Compact a vector clock only against a frontier that the receiver has
 * already acknowledged AND which this operation dominates. A later download
 * cannot retroactively add causality to an offline operation. Entries absent from the frontier are retained. This
 * is the key safety rule: ordinary top-K pruning is not causal compression.
 */
export function compactVectorClockAgainstFrontier(
  clock: VectorClock,
  stableFrontier: VectorClock,
  preserveClientIds: readonly string[] = [],
): VectorClock {
  const relation = compareVectorClocks(clock, stableFrontier);
  if (relation !== 'EQUAL' && relation !== 'GREATER_THAN') {
    throw new Error('Cannot compact a clock that does not dominate its frontier');
  }
  const preserve = new Set(preserveClientIds);
  const compacted: VectorClock = {};
  for (const [clientId, counter] of Object.entries(clock)) {
    const frontierCounter = stableFrontier[clientId];
    if (
      preserve.has(clientId) ||
      frontierCounter === undefined ||
      counter !== frontierCounter
    ) {
      compacted[clientId] = counter;
    }
  }
  return compacted;
}

/** Reconstruct the comparison clock from a compact delta and its frontier. */
export function expandVectorClockFromFrontier(
  compactedClock: VectorClock,
  stableFrontier: VectorClock,
): VectorClock {
  const expanded: VectorClock = { ...stableFrontier };
  for (const [clientId, counter] of Object.entries(compactedClock)) {
    expanded[clientId] = Math.max(expanded[clientId] ?? 0, counter);
  }
  return expanded;
}
