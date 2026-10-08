/** Read-only executable counterexamples for the inbound plan review.
 * Bundle with the workspace esbuild, then run under TZ=Asia/Shanghai and
 * TZ=America/New_York. These probe existing primitives, not inbound delivery.
 */
import assert from 'node:assert/strict';
import { OpType, type Operation } from '../../packages/sync-core/src/index';
import { emptyState, replayOperations } from '../../packages/op-log/src/state';
import { calendarDayBuckets, groupTasksByCalendarDate, groupTasksByDueDate } from '../../packages/ui/src/calendar/model';
import { toLocalDate } from '../../packages/domain/src/date';

const operation = (id: string, entityId: string, clientId: string): Operation<string> => ({
  id, entityId, clientId, opType: OpType.Create, actionType: 'CRT_TASK',
  entityType: 'TASK', payload: { title: 'synthetic-event' },
  vectorClock: { [clientId]: 1 }, timestamp: 1_800_000_000_000, schemaVersion: 1,
});

const a = operation('op-a', 'task-a', 'device-a');
const b = operation('op-b', 'task-b', 'device-b');
const duplicate = replayOperations(emptyState(), [a, b]);
assert.equal(Object.keys(duplicate.tasks).length, 2);

const shared = replayOperations(emptyState(), [{ ...a, opType: OpType.Batch, entityIds: ['task-b'] }]);
assert.equal(shared.tasks['task-a']?.title, shared.tasks['task-b']?.title);

const timestamp = Date.parse('2026-10-08T09:00:00+08:00');
const task = { ...duplicate.tasks['task-a']!, startDate: timestamp, durationMinutes: 90 };
const day = toLocalDate(timestamp);
const monthCount = groupTasksByCalendarDate([task], day, day).get(day)?.length ?? 0;
const buckets = calendarDayBuckets([task], day);
const dayCount = buckets.allDay.length + buckets.hours.flat().length;
const yearCount = groupTasksByDueDate([task]).get(day)?.length ?? 0;
assert.equal(monthCount, 1);
assert.equal(dayCount, 0);
assert.equal(yearCount, 0);

// A Shanghai date-only midnight changes date and ceases to be midnight in NY.
const dateOnly = new Date('2026-10-08T00:00:00+08:00');
const dateOnlyProjection = { day: toLocalDate(dateOnly.getTime()), hour: dateOnly.getHours() };
if (process.env.TZ === 'Asia/Shanghai') assert.deepEqual(dateOnlyProjection, { day: '2026-10-08', hour: 0 });
if (process.env.TZ === 'America/New_York') assert.deepEqual(dateOnlyProjection, { day: '2026-10-07', hour: 12 });

console.log(JSON.stringify({
  timezone: process.env.TZ,
  duplicateTasksAfterDistinctDeviceCreates: Object.keys(duplicate.tasks).length,
  existingBatchUsesSharedPayload: true,
  startOnlyTaskVisibility: { monthCount, dayCount, yearCount },
  dateOnlyProjection,
  scope: 'existing-source-primitives-only; no inbound worker or crash injection',
}));
