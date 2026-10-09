import { describe, expect, it } from 'vitest';
import { buildInboundModelInput, freezeInboundTaskBatch, prepareInboundAutomationResult, inboundTaskDigest } from '../src/parser';

describe('inbound automation parser', () => {
  it.each(['2026-02-30', '2026-02-30T10:00:00Z', '2026-10-08T10:00:00', '2024-11-03T01:30:00', '2024-03-10T02:30:00'])
    ('preserves invalid/ambiguous date %s in a non-operation draft', (dueDate) => {
      const result = prepareInboundAutomationResult({ eventId: 'evt', ruleId: 'rule', ruleVersion: 1, parseVersion: 1,
        receivedAt: 1, timezone: 'America/New_York', targetProjectId: 'project', modelResult: { tasks: [{ title: 'Check', dueDate }] } });
      expect(result.needsConfirmation).toBe(true);
      expect(result.payload).toMatchObject({ heytaInboundDraft: 1, tasks: [{ id: 'inbound:evt:0', title: 'Check', dueDate, projectId: 'project' }] });
      expect('heytaTaskBatch' in result.payload).toBe(false);
      expect(inboundTaskDigest(result.payload.tasks)).toBe(result.resultDigest);
    });
  it('does not use an invalid date to smuggle extra model fields into a draft', () => {
    expect(() => prepareInboundAutomationResult({ eventId: 'evt', ruleId: 'rule', ruleVersion: 1, parseVersion: 1,
      receivedAt: 1, modelResult: { tasks: [{ title: 'Check', dueDate: 'invalid', projectId: 'injected' }] } })).toThrow();
  });
  it('projects only the rule allowlist', () => {
    expect(buildInboundModelInput({ title: 'x', note: 'n', secret: 'drop' }, ['title'])).toEqual({ title: 'x' });
    expect(() => buildInboundModelInput({ title: 'x' }, ['secret'])).toThrow();
  });
  it('freezes an explicit confirmation flag without changing the task digest', () => {
    const input = { eventId: 'evt', ruleId: 'rule', ruleVersion: 1, parseVersion: 1,
      modelResult: { tasks: [{ title: 'Check date' }] }, receivedAt: 1 };
    const ordinary = freezeInboundTaskBatch(input);
    const draft = freezeInboundTaskBatch({ ...input, modelResult: { ...input.modelResult, needsConfirmation: true } });
    expect(ordinary.needsConfirmation).toBe(false);
    expect(draft.needsConfirmation).toBe(true);
    expect(draft.resultDigest).toBe(ordinary.resultDigest);
    expect(() => freezeInboundTaskBatch({ ...input, modelResult: { ...input.modelResult, needsConfirmation: 'yes' } })).toThrow();
  });
  it('freezes stable task identities and date semantics', () => {
    const frozen = freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      modelResult: { tasks: [{ title: 'x', dueDate: '2026-10-08', priority: 2 }, { title: 'y', dueDate: '2026-10-08T10:00:00+08:00' }] }, receivedAt: 1 });
    expect(frozen.itemCount).toBe(2);
    expect(frozen.payload.tasks.map((task) => task.id)).toEqual(['inbound:evt:0', 'inbound:evt:1']);
    expect(frozen.payload.tasks[0]?.dueDate).toBe(Date.UTC(2026, 9, 8));
    expect(frozen.payload.tasks[0]?.dueDateLocal).toBe('2026-10-08');
    expect(frozen.payload.tasks[1]?.dueDateLocal).toBeUndefined();
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
    expect(frozen.payload.tasks[0]?.dueDateLocal).toBe('2026-10-08');
    expect(() => freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      timezone: 'Not/AZone', modelResult: { tasks: [{ title: 'x', dueDate: '2026-10-08' }] }, receivedAt: 1 })).toThrow();
  });
  it('uses the zone offset in effect at DST boundaries and stays deterministic', () => {
    const freeze = (date: string) => freezeInboundTaskBatch({ eventId: 'evt', ruleId: '11111111-1111-4111-8111-111111111111', ruleVersion: 1, parseVersion: 1,
      timezone: 'America/New_York', modelResult: { tasks: [{ title: 'x', dueDate: date }] }, receivedAt: 1 });
    expect(freeze('2024-03-10').payload.tasks[0]?.dueDate).toBe(Date.UTC(2024, 2, 10, 5));
    expect(freeze('2024-03-10').payload.tasks[0]?.dueDateLocal).toBe('2024-03-10');
    expect(freeze('2024-11-03').payload.tasks[0]?.dueDate).toBe(Date.UTC(2024, 10, 3, 4));
    expect(freeze('2024-11-03').resultDigest).toBe(freeze('2024-11-03').resultDigest);
  });
});


describe('inbound output authorization', () => {
  const scope = { eventId: 'event', ruleId: 'rule', ruleVersion: 1, parseVersion: 1, receivedAt: 1 };
  it('injects the rule target before freezing the digest', () => {
    const input = { ...scope, modelResult: { tasks: [{ title: 'Captured' }] } };
    const inbox = freezeInboundTaskBatch(input);
    const targeted = freezeInboundTaskBatch({ ...input, targetProjectId: 'authorized-project' });
    expect(targeted.payload.tasks[0]?.projectId).toBe('authorized-project');
    expect(targeted.resultDigest).not.toBe(inbox.resultDigest);
  });
  it.each(['projectId', 'id', 'tools', 'unknown'])('rejects model-supplied %s', (field) => {
    expect(() => freezeInboundTaskBatch({ ...scope, modelResult: { tasks: [{ title: 'Captured', [field]: 'untrusted' }] } })).toThrow();
  });
  it('rejects extra top-level output', () => {
    expect(() => freezeInboundTaskBatch({ ...scope, modelResult: { tasks: [{ title: 'Captured' }], toolCalls: [] } })).toThrow();
  });
});
