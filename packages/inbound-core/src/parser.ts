import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { heytaTaskBatchPayloadSchema, taskBatchItemId, type HeytaTaskBatchPayload } from '@heyta/shared-schema';

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

const dateValue = (value: unknown, timezone: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string') throw new Error('Invalid automation date');
  if (dateOnly.test(value)) {
    return dateOnlyEpoch(value, timezone);
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) throw new Error('Automation instant requires an explicit offset');
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error('Invalid automation date');
  return epoch;
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

/** Validate a model's structured result and freeze it into the task-batch contract. */
export function freezeInboundTaskBatch(input: {
  eventId: string; ruleId: string; ruleVersion: number; parseVersion: number;
  modelResult: unknown; receivedAt: number; maxItems?: number; timezone?: string;
}): { payload: HeytaTaskBatchPayload; resultDigest: string; itemCount: number } {
  if (!Number.isSafeInteger(input.receivedAt) || input.receivedAt < 0) throw new Error('Invalid automation receive time');
  if (input.modelResult === null || typeof input.modelResult !== 'object' || Array.isArray(input.modelResult)) throw new Error('Invalid automation model result');
  const raw = input.modelResult as Record<string, unknown>;
  const maxItems = input.maxItems ?? 50;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50 || !Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > maxItems) throw new Error('Invalid automation model result');
  const tasks = raw.tasks.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid automation task');
    const row = candidate as Record<string, unknown>;
    if (typeof row.title !== 'string' || row.title.trim() !== row.title || row.title.length < 1) throw new Error('Invalid automation task');
    const priority = row.priority === undefined ? 0 : row.priority;
    if (priority !== 0 && priority !== 1 && priority !== 2 && priority !== 3) throw new Error('Invalid automation priority');
    const item: Record<string, unknown> = { id: taskBatchItemId(input.eventId, index), title: row.title, priority };
    for (const field of ['note', 'projectId'] as const) if (row[field] !== undefined) item[field] = row[field];
    for (const field of ['dueDate', 'startDate'] as const) if (row[field] !== undefined) item[field] = dateValue(row[field], input.timezone ?? 'UTC');
    if (row.durationMinutes !== undefined) item.durationMinutes = row.durationMinutes;
    return item;
  });
  const source = { version: 1 as const, eventId: input.eventId, ruleId: input.ruleId, ruleVersion: input.ruleVersion, parseVersion: input.parseVersion, digest: '0'.repeat(64) };
  const provisional = { heytaTaskBatch: 1 as const, source, tasks };
  const resultDigest = bytesToHex(sha256(new TextEncoder().encode(canonicalJson(tasks))));
  const payload = heytaTaskBatchPayloadSchema.parse({ ...provisional, source: { ...source, digest: resultDigest } });
  return { payload, resultDigest, itemCount: tasks.length };
}
