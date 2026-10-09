import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { heytaTaskBatchPayloadSchema, inboundDraftPayloadSchema, taskBatchItemId, type HeytaTaskBatchPayload,
  type InboundDraftPayload } from '@heyta/shared-schema';

export const INBOUND_AUTOMATION_FIELDS = ['title', 'note', 'priority', 'projectId', 'dueDate', 'startDate', 'durationMinutes'] as const;
export type InboundAutomationField = (typeof INBOUND_AUTOMATION_FIELDS)[number];

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const copy = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(copy);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, copy(v)]));
  return undefined;
};
const canonicalJson = (value: unknown): string => JSON.stringify(copy(value));

/** The receipt binds the full frozen task list, independent of JSON key order. */
export function inboundTaskDigest(tasks: HeytaTaskBatchPayload['tasks'] | InboundDraftPayload['tasks']): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(tasks))));
}
function dateOnlyEpoch(value: string, timezone: string): number {
  const [year, month, day] = value.split('-').map(Number);
  const guess = Date.UTC(year!, month! - 1, day!);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const numberField = (name: string): number => {
      const value = fields[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid automation date');
      return value;
    };
    const rendered = Date.UTC(numberField('year'), numberField('month') - 1, numberField('day'), numberField('hour'), numberField('minute'), numberField('second'));
    const result = guess - (rendered - guess);
    const check = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(result));
    if (check !== value) throw new Error('Invalid automation date');
    return result;
  } catch { throw new Error('Invalid automation timezone or date'); }
}

const dateValue = (value: unknown, timezone: string): { epoch: number; localDate?: string } | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value)) return { epoch: value };
  if (typeof value !== 'string') throw new Error('Invalid automation date');
  if (dateOnly.test(value)) {
    return { epoch: dateOnlyEpoch(value, timezone), localDate: value };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
  const match = iso.exec(value);
  if (match === null) throw new Error('Automation instant requires a valid date and explicit offset');
  const [, y, m, d, h, minute, seconds] = match;
  const calendar = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (calendar.getUTCFullYear() !== Number(y) || calendar.getUTCMonth() + 1 !== Number(m) ||
      calendar.getUTCDate() !== Number(d) || Number(h) > 23 || Number(minute) > 59 || Number(seconds ?? 0) > 59) {
    throw new Error('Invalid automation date');
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error('Invalid automation date');
  return { epoch };
};

/** Project the raw event to the exact fields a model is authorized to see. */
export function buildInboundModelInput(raw: unknown, allowedFields: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Inbound payload must be an object');
  const allowed = new Set(allowedFields);
  if (allowed.size === 0 || [...allowed].some((field) => !(INBOUND_AUTOMATION_FIELDS as readonly string[]).includes(field))) throw new Error('Invalid automation field policy');
  const source = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of INBOUND_AUTOMATION_FIELDS) if (allowed.has(field) && Object.hasOwn(source, field)) result[field] = copy(source[field]);
  return result;
}

/** Invalid/ambiguous dates are retained as encrypted review data, never dropped. */
export function prepareInboundAutomationResult(input: Parameters<typeof freezeInboundTaskBatch>[0]): {
  payload: HeytaTaskBatchPayload | InboundDraftPayload; resultDigest: string; itemCount: number; needsConfirmation: boolean;
} {
  // Validate non-date fields and scope before allowing the review path.
  const raw = input.modelResult;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid automation model result');
  const result = raw as Record<string, unknown>;
  if (Object.keys(result).some((k) => k !== 'tasks' && k !== 'needsConfirmation') ||
      (result.needsConfirmation !== undefined && typeof result.needsConfirmation !== 'boolean') || !Array.isArray(result.tasks)) {
    throw new Error('Invalid automation model result');
  }
  const maxItems = input.maxItems ?? 50;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50 || result.tasks.length > maxItems ||
      !Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) throw new Error('Invalid automation model result');
  const tasks = result.tasks.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid automation task');
    const row = candidate as Record<string, unknown>;
    if (Object.keys(row).some((k) => !['title', 'note', 'priority', 'dueDate', 'startDate', 'durationMinutes'].includes(k))) {
      throw new Error('Unexpected automation task field');
    }
    return { ...row, id: taskBatchItemId(input.eventId, index), priority: row.priority === undefined ? 0 : row.priority,
      ...(input.targetProjectId === undefined ? {} : { projectId: input.targetProjectId }) };
  });
  const draft = inboundDraftPayloadSchema.parse({ heytaInboundDraft: 1,
    source: { version: 1, eventId: input.eventId, ruleId: input.ruleId, ruleVersion: input.ruleVersion,
      parseVersion: input.parseVersion, digest: '0'.repeat(64) }, tasks });
  let invalidDate = false;
  for (const task of draft.tasks) for (const field of ['dueDate', 'startDate'] as const) {
    try { dateValue(task[field], input.timezone ?? 'UTC'); }
    catch { invalidDate = true; }
  }
  if (!invalidDate) return freezeInboundTaskBatch(input);
  const resultDigest = inboundTaskDigest(draft.tasks);
  draft.source.digest = resultDigest;
  return { payload: draft, resultDigest, itemCount: draft.tasks.length, needsConfirmation: true };
}

/** Validate a model's structured result and freeze it into the task-batch contract. */
export function freezeInboundTaskBatch(input: {
  eventId: string; ruleId: string; ruleVersion: number; parseVersion: number;
  modelResult: unknown; receivedAt: number; maxItems?: number; timezone?: string; targetProjectId?: string;
}): { payload: HeytaTaskBatchPayload; resultDigest: string; itemCount: number; needsConfirmation: boolean } {
  if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) throw new Error('Invalid automation receive time');
  if (input.modelResult === null || typeof input.modelResult !== 'object' || Array.isArray(input.modelResult)) throw new Error('Invalid automation model result');
  const raw = input.modelResult as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== 'tasks' && key !== 'needsConfirmation')) throw new Error('Unexpected automation result field');
  if (raw.needsConfirmation !== undefined && typeof raw.needsConfirmation !== 'boolean') throw new Error('Invalid automation confirmation state');
  const maxItems = input.maxItems ?? 50;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50 || !Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > maxItems) throw new Error('Invalid automation model result');
  const tasks = raw.tasks.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid automation task');
    const row = candidate as Record<string, unknown>;
    const outputFields = ['title', 'priority', 'note', 'dueDate', 'startDate', 'durationMinutes'];
    if (Object.keys(row).some((key) => !outputFields.includes(key))) throw new Error('Unexpected automation task field');
    if (typeof row.title !== 'string' || row.title.trim() !== row.title || row.title.length < 1) throw new Error('Invalid automation task');
    const priority = row.priority === undefined ? 0 : row.priority;
    if (priority !== 0 && priority !== 1 && priority !== 2 && priority !== 3) throw new Error('Invalid automation priority');
    const item: Record<string, unknown> = { id: taskBatchItemId(input.eventId, index), title: row.title, priority };
    if (row.note !== undefined) item.note = row.note;
    if (input.targetProjectId !== undefined) item.projectId = input.targetProjectId;
    for (const field of ['dueDate', 'startDate'] as const) {
      if (row[field] === undefined) continue;
      const parsed = dateValue(row[field], input.timezone ?? 'UTC');
      if (parsed === undefined) continue;
      item[field] = parsed.epoch;
      if (parsed.localDate !== undefined) item[`${field}Local`] = parsed.localDate;
    }
    if (row.durationMinutes !== undefined) item.durationMinutes = row.durationMinutes;
    return item;
  });
  const source = { version: 1 as const, eventId: input.eventId, ruleId: input.ruleId, ruleVersion: input.ruleVersion, parseVersion: input.parseVersion, digest: '0'.repeat(64) };
  const provisional = { heytaTaskBatch: 1 as const, source, tasks };
  const payload = heytaTaskBatchPayloadSchema.parse(provisional);
  const resultDigest = inboundTaskDigest(payload.tasks);
  payload.source.digest = resultDigest;
  return { payload, resultDigest, itemCount: tasks.length, needsConfirmation: raw.needsConfirmation === true };
}
