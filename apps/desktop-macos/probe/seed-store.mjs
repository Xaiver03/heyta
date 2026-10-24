/**
 * macOS 横幅取证的**数据准备**（不是产品代码，不入库使用）。
 *
 * 它做一件事：用**发货的那条写入口**（`@heyta/app-host` 的 `createTaskActions` /
 * `createReminderActions` → op-log `Create` op）在一个**真 SQLite 本地仓**里造出
 * **恰好一条已到点、未投递**的提醒。
 *
 * 🔴 为什么不用 `sqlite3` CLI 直接塞行：那样造出来的"提醒"是**手写的形状**，
 *    横幅弹出来只能证明"Swift 会调 UN API"，证明不了"发货的 `due()` 选中了它"。
 *    走动作层 ⇒ 后面壳里 `deliverReminders()` 读到的是同一份事实。
 *
 * 用法：node apps/desktop-macos/probe/seed-store.mjs <db 绝对路径>
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = `${pathToFileURL(process.cwd()).href.replace(/\/$/, '')}/`;
const DB = process.argv[2];
if (!DB || !DB.startsWith('/')) {
  console.error(`用法：seed-store.mjs <db 绝对路径>（实测值：${DB ?? '缺失'}）`);
  process.exit(2);
}

const { openAppHost, createTaskActions, createReminderActions } = await import(
  `${REPO}packages/app-host/dist/index.js`
);
const { NodeSqliteDriver } = await import(
  `${REPO}packages/storage/dist/sqlite/node-sqlite-driver.js`
);

mkdirSync(dirname(DB), { recursive: true });

const host = await openAppHost({
  dbPath: DB,
  driverFactory: () => new NodeSqliteDriver(DB),
});

const tasks = createTaskActions(host);
const reminders = createReminderActions(host);

const TITLE = 'macOS 横幅取证 · 只此一条';
const taskId = await tasks.create(TITLE);
// 落在「现在 − 1s」：在 `REMINDER_PAST_GRACE_MS`（60s）窗口内 ⇒ 建得出来，
// 而打开仓的那一刻它**已经到点**，不需要等定时器。
const triggerAt = Date.now() - 1000;
const reminderId = await reminders.createReminder(taskId, triggerAt);

const due = reminders.due();
const alive = reminders.listForTask(taskId);
host.close();

const report = {
  db: DB,
  clientId: host.clientId,
  taskId,
  taskTitle: TITLE,
  reminderId,
  triggerAt,
  seededAt: new Date().toISOString(),
  aliveReminders: alive.length,
  dueCount: due.length,
  dueIds: due.map((r) => r.id),
};
console.log(JSON.stringify(report, null, 2));

if (due.length !== 1 || due[0].id !== reminderId) {
  console.error(`🔴 造出来的不是「恰好一条到点提醒」（due=${due.length}）`);
  process.exit(1);
}
console.log('✅ 本地仓里恰好一条到点提醒（经发货的 op-log 写入口落盘）');
