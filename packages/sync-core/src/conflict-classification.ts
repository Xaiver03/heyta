import { compareVectorClocks, type VectorClock } from './vector-clock';

/** Protocol-level relationship between two operations touching one entity. */
export type OperationConflictClassification =
  | 'causal-successor'
  | 'retry'
  | 'equal-different-client'
  | 'concurrent'
  | 'superseded';

/**
 * Classifies only what vector clocks and client identity prove. UI policy
 * (timestamp LWW, delete precedence, manual review) stays above this layer.
 */
export function classifyOperationRelation(
  incomingClock: VectorClock,
  existingClock: VectorClock,
  incomingClientId: string,
  existingClientId: string,
): OperationConflictClassification {
  const comparison = compareVectorClocks(incomingClock, existingClock);
  if (comparison === 'GREATER_THAN') return 'causal-successor';
  if (comparison === 'EQUAL') {
    return incomingClientId === existingClientId ? 'retry' : 'equal-different-client';
  }
  if (comparison === 'CONCURRENT') return 'concurrent';
  return 'superseded';
}
