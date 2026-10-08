import { describe, expect, it } from 'vitest';
import { buildInboundModelInput, freezeInboundTaskBatch } from '../src/parser';

describe('inbound automation parser', () => {
  it('projects only the rule allowlist', () => {
    expect(buildInboundModelInput({ title: 'x', note: 'n', secret: 'drop' }, ['title'])).toEqual({ title: 'x' });
    expect(() => buildInboundModelInput({ title: 'x' }, ['secret'])).toThrow();
  });
  it('freezes stable task identities and date semantics', () => {
    const frozen = freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      modelResult: { tasks: [{ title: 'x', dueDate: '2026-10-08', priority: 2 }, { title: 'y', dueDate: '2026-10-08T10:00:00+08:00' }] }, receivedAt: 1 });
    expect(frozen.itemCount).toBe(2);
    expect(frozen.payload.tasks.map((task) => task.id)).toEqual(['inbound:evt:0', 'inbound:evt:1']);
    expect(frozen.payload.tasks[0]?.dueDate).toBe(Date.UTC(2026, 9, 8));
    expect(frozen.resultDigest).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects local timezone timestamps and invalid output', () => {
    expect(() => freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      modelResult: { tasks: [{ title: 'x', dueDate: '2026-10-08T10:00:00' }] }, receivedAt: 1 })).toThrow();
  });
  it('anchors date-only values at the rule timezone midnight', () => {
    const frozen = freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      timezone: 'Asia/Shanghai', modelResult: { tasks: [{ title: 'x', dueDate: '2026-10-08' }] }, receivedAt: 1 });
    expect(frozen.payload.tasks[0]?.dueDate).toBe(Date.UTC(2026, 9, 7, 16));
    expect(() => freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      timezone: 'Not/AZone', modelResult: { tasks: [{ title: 'x', dueDate: '2026-10-08' }] }, receivedAt: 1 })).toThrow();
  });
  it('uses the zone offset in effect at DST boundaries and stays deterministic', () => {
    const freeze = (date: string) => freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      timezone: 'America/New_York', modelResult: { tasks: [{ title: 'x', dueDate: date }] }, receivedAt: 1 });
    expect(freeze('2024-03-10').payload.tasks[0]?.dueDate).toBe(Date.UTC(2024, 2, 10, 5));
    expect(freeze('2024-11-03').payload.tasks[0]?.dueDate).toBe(Date.UTC(2024, 10, 3, 4));
    expect(freeze('2024-11-03').resultDigest).toBe(freeze('2024-11-03').resultDigest);
  });
});
