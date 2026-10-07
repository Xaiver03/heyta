#!/usr/bin/env node
/** 可重复的产品体验性能基线：任务读侧 + op-log 恢复。 */
import { filterTasks, sortTasks } from '../packages/domain/dist/index.js';

const sizes = process.argv.slice(2).map(Number);
if (sizes.length === 0) sizes.push(500, 1000, 5000);
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1)) {
  throw new Error('Expected positive integer task counts');
}

const now = Date.UTC(2026, 9, 6, 12);
const task = (index) => ({
  id: `task-${index}`,
  title: `任务 ${index}`,
  createdAt: now - index * 60_000,
  updatedAt: now - index * 60_000,
  dueDate: index % 3 === 0 ? now + (index % 14) * 86_400_000 : undefined,
  completedAt: index % 11 === 0 ? now - 1_000 : undefined,
  priority: index % 4,
});

const measure = (fn) => {
  // 预热一次，避免把模块首次执行算进用户动作。
  fn();
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return Number(samples[Math.floor(samples.length / 2)].toFixed(2));
};

const results = sizes.map((size) => {
  const tasks = Array.from({ length: size }, (_, index) => task(index));
  const sortMs = measure(() => sortTasks(tasks, 'display').length);
  const filterMs = measure(() => filterTasks(tasks, { kind: 'next7Days' }, { now }).length);
  return { tasks: size, sortDisplayMs: sortMs, filterNext7DaysMs: filterMs };
});

console.log(JSON.stringify({ runtime: process.version, platform: process.platform, results }, null, 2));
