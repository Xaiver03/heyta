#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

/**
 * Read only the active notification list from `dumpsys notification`.
 *
 * Android also keeps delivered notifications in a history/archive section. A
 * whole-output grep therefore reports an old reminder as currently visible.
 * The active list is bounded by its header and the first same-level queue,
 * snoozed, history, or metadata section; records are then checked
 * independently so a neighbouring package cannot satisfy the match.
 */

function activeNotificationSection(dump) {
  const start = dump.search(/^\s*Notification List:\s*$/im);
  if (start < 0) return '';

  const rest = dump.slice(start);
  const end = rest.search(
    /^\s*(?:Enqueued Notification List|Snoozed notifications|Notification History|Historical Notifications?|Notification Archive|Notification Stats|Notification listeners?|Notification channels?|Notification assistants?|Notification policy|Notification light|Notification access|Notification delegates):?\s*$/im,
  );
  return end < 0 ? rest : rest.slice(0, end);
}

function notificationRecords(section) {
  const starts = [];
  const marker = /^\s*NotificationRecord\(/gim;
  let match;
  while ((match = marker.exec(section)) !== null) starts.push(match.index);
  return starts.map((start, index) => section.slice(start, starts[index + 1]));
}

function hasActiveNotification(dump, { packageName, contains }) {
  if (typeof dump !== 'string' || typeof packageName !== 'string' || typeof contains !== 'string') {
    return false;
  }
  const escapedPackage = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `\\b` is wrong here: the dot in `com.heyta.fake` creates a word boundary
  // after `com.heyta`. Android's pkg field is a token terminated by whitespace,
  // comma, a closing parenthesis, or the end of the record.
  const packagePattern = new RegExp(`(?:^|[\\s,])pkg=${escapedPackage}(?=[\\s,)]|$)`);
  return notificationRecords(activeNotificationSection(dump)).some(
    (record) => packagePattern.test(record) && record.includes(contains),
  );
}

export { activeNotificationSection, hasActiveNotification, notificationRecords };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageName = process.argv[2];
  const contains = process.argv[3];
  if (packageName === undefined || contains === undefined) {
    process.stderr.write('usage: mobile-reminder-notification.mjs <package> <text>\n');
    process.exitCode = 2;
  } else {
    let dump = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { dump += chunk; });
    process.stdin.on('end', () => {
      process.exitCode = hasActiveNotification(dump, { packageName, contains }) ? 0 : 1;
    });
  }
}
