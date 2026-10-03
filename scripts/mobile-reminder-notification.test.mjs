import test from 'node:test';
import assert from 'node:assert/strict';

import { activeNotificationSection, hasActiveNotification } from './mobile-reminder-notification.mjs';

const dump = `
Notification List:
  NotificationRecord(0x1: pkg=com.other user=UserHandle{0})
    title=ring-e2e-other
  NotificationRecord(0x2: pkg=com.heyta user=UserHandle{0})
    title=ring-e2e-active
Enqueued Notification List:
  NotificationRecord(0x4: pkg=com.heyta user=UserHandle{0})
    title=ring-e2e-enqueued
Snoozed notifications:
  NotificationRecord(0x5: pkg=com.heyta user=UserHandle{0})
    title=ring-e2e-snoozed
Notification History:
  NotificationRecord(0x3: pkg=com.heyta user=UserHandle{0})
    title=ring-e2e-archived
`;

test('active notification parser excludes history/archive records', () => {
  assert.match(activeNotificationSection(dump), /ring-e2e-active/);
  assert.doesNotMatch(activeNotificationSection(dump), /ring-e2e-archived/);
  assert.equal(
    hasActiveNotification(dump, { packageName: 'com.heyta', contains: 'ring-e2e-active' }),
    true,
  );
  assert.equal(
    hasActiveNotification(dump, { packageName: 'com.heyta', contains: 'ring-e2e-archived' }),
    false,
  );
  assert.equal(
    hasActiveNotification(dump, { packageName: 'com.heyta', contains: 'ring-e2e-enqueued' }),
    false,
  );
  assert.equal(
    hasActiveNotification(dump, { packageName: 'com.heyta', contains: 'ring-e2e-snoozed' }),
    false,
  );
});

test('active notification parser keeps package records isolated', () => {
  assert.equal(
    hasActiveNotification(dump, { packageName: 'com.heyta', contains: 'ring-e2e-other' }),
    false,
  );
  assert.equal(
    hasActiveNotification(dump, { packageName: 'com.other', contains: 'ring-e2e-other' }),
    true,
  );
  assert.equal(
    hasActiveNotification(
      'Notification List:\n  NotificationRecord(0x9: pkg=com.heyta.fake)\n    title=ring-e2e-fake',
      { packageName: 'com.heyta', contains: 'ring-e2e-fake' },
    ),
    false,
  );
});

test('active parser stops at a same-level section even without history', () => {
  const noHistory = `
Notification List:
  NotificationRecord(0x1: pkg=com.heyta user=UserHandle{0})
    title=ring-e2e-active
Snoozed notifications:
  NotificationRecord(0x2: pkg=com.heyta user=UserHandle{0})
    title=ring-e2e-snoozed
`;
  assert.equal(
    hasActiveNotification(noHistory, { packageName: 'com.heyta', contains: 'ring-e2e-snoozed' }),
    false,
  );
});
