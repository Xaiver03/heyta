import { z } from 'zod';
import { inboundEnvelopeSchema } from './inbound-crypto-contract';
import { taskAutomationSourceSchema, taskBatchItemId, TASK_BATCH_MAX_ITEMS, TASK_BATCH_MAX_TITLE_LENGTH,
  TASK_BATCH_MAX_NOTE_LENGTH, TASK_MIN_DURATION_MINUTES, TASK_MAX_DURATION_MINUTES } from './task-batch-contract';

export const inboundDraftEventIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
// Keep ciphertext as the original wire string; retries must not re-encrypt it.
const ciphertext = z.string().min(1).max(1_000_000).refine((value) => {
  try { return inboundEnvelopeSchema.safeParse(JSON.parse(value)).success; }
  catch { return false; }
});
export const inboundDraftSnapshotSchema = z.object({
  eventId: inboundDraftEventIdSchema, ruleId: z.string().uuid(), ruleVersion: revision,
  parseVersion: revision, attempt: revision, resultDigest: digest,
  resultItemCount: z.number().int().min(1).max(50), resultCiphertext: ciphertext,
}).strict();
const expected = {
  expectedAttempt: revision, expectedRuleVersion: revision, expectedDigest: digest,
};
export const inboundDraftDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ ...expected, decision: z.literal('confirm'), resultDigest: digest,
    resultItemCount: z.number().int().min(1).max(50), resultCiphertext: ciphertext }).strict(),
  z.object({ ...expected, decision: z.literal('cancel') }).strict(),
]);
export const inboundDraftDecisionResponseSchema = z.object({
  eventId: inboundDraftEventIdSchema, state: z.enum(['prepared', 'cancelled']),
}).strict();
export type InboundDraftSnapshot = z.infer<typeof inboundDraftSnapshotSchema>;
export type InboundDraftDecision = z.infer<typeof inboundDraftDecisionSchema>;
export type InboundDraftDecisionResponse = z.infer<typeof inboundDraftDecisionResponseSchema>;

// This is an encrypted review document, never a business operation payload.
// Dates remain uninterpreted until the account user corrects and confirms them.
const draftIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/);
const draftDate = z.union([z.string().min(1).max(128), z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000)]);
export const inboundDraftTaskSchema = z.object({
  id: draftIdentity, title: z.string().min(1).max(TASK_BATCH_MAX_TITLE_LENGTH).refine((v) => v.trim() === v),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  note: z.string().max(TASK_BATCH_MAX_NOTE_LENGTH).optional(), projectId: draftIdentity.optional(),
  dueDate: draftDate.optional(), startDate: draftDate.optional(),
  durationMinutes: z.number().int().min(TASK_MIN_DURATION_MINUTES).max(TASK_MAX_DURATION_MINUTES).optional(),
}).strict();
export const inboundDraftPayloadSchema = z.object({
  heytaInboundDraft: z.literal(1), source: taskAutomationSourceSchema,
  tasks: z.array(inboundDraftTaskSchema).min(1).max(TASK_BATCH_MAX_ITEMS),
}).strict().superRefine(({ source, tasks }, ctx) => {
  if (tasks.some((task, index) => task.id !== taskBatchItemId(source.eventId, index)) ||
      tasks.some((task) => task.projectId !== tasks[0]?.projectId)) {
    ctx.addIssue({ code: 'custom', message: 'Draft tasks must retain event identity and one target' });
  }
});
export type InboundDraftTask = z.infer<typeof inboundDraftTaskSchema>;
export type InboundDraftPayload = z.infer<typeof inboundDraftPayloadSchema>;
