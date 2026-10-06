import { describe, expect, it } from 'vitest';

import { classifyOperationRelation } from '../src/conflict-classification';

describe('protocol conflict taxonomy', () => {
  it.each([
    ['causal-successor', { a: 2 }, { a: 1 }, 'a', 'a'],
    ['retry', { a: 1 }, { a: 1 }, 'a', 'a'],
    ['equal-different-client', { a: 1 }, { a: 1 }, 'b', 'a'],
    ['concurrent', { a: 1 }, { b: 1 }, 'a', 'b'],
    ['superseded', { a: 1 }, { a: 2 }, 'b', 'a'],
  ] as const)('%s is classified once and consistently', (expected, incoming, existing, incomingClient, existingClient) => {
    expect(classifyOperationRelation(incoming, existing, incomingClient, existingClient)).toBe(expected);
  });

  it('does not call equal clocks from different clients a retry', () => {
    expect(classifyOperationRelation({ a: 4 }, { a: 4 }, 'client-b', 'client-a')).toBe(
      'equal-different-client',
    );
  });
});
