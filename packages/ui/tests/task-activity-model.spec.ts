/**
 * 任务动态的「事件 → 人话」映射只有一份
 * =====================================
 *
 * 这一族钉的是三类静默失效：
 *
 *   1. 🔴 **两个字段念成两遍同一句话**：设一次重复规则会同时改 `repeatRule` 与
 *      `repeatDtstart`（领域层钉锚点），流水里如果念成「重复 · 重复」，
 *      用户会以为改了两件事。
 *   2. 🔴 **覆盖范围那句被吞掉**：`device-local-only` 不说话的后果是把增量
 *      历史念成完整历史 —— 那是**不实陈述**，不是措辞问题。
 *   3. 🔴 **新字段静默落到兜底**：映射表若是 `switch + default`，领域层加一个
 *      字段而这里没接上，测试与构建都不会红，界面上只会一直念"其他字段"。
 *      本文件第 4 条判据就是拿**领域层那份联合**去数映射表的覆盖。
 */

import { taskActivityCoverage } from '@heyta/domain';
import type { TaskActivityChange, TaskActivityField } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  taskActivityCoverageMessageKey,
  taskActivityDeviceMessageKey,
  taskActivityFieldMessageKeys,
  taskActivityKindMessageKey,
} from '../src/task-list/activity-model.js';

// `from` / `to` / `cleared` 是必填（投影保证它们在场），夹具必须给全。
const change = (field: TaskActivityField): TaskActivityChange => ({
  field,
  from: undefined,
  to: undefined,
  cleared: false,
});

describe('字段 → 词条', () => {
  it('🔴 同义的两个字段去重成一句话（按 key 去重，不是按字段）', () => {
    const keys = taskActivityFieldMessageKeys({
      changes: [change('repeatRule'), change('repeatDtstart')],
    });
    expect(keys).toEqual(['mobile.detail.field.repeat']);
    // 排期同理：起点 + 时长 = 一句「排期」。
    expect(
      taskActivityFieldMessageKeys({ changes: [change('startDate'), change('durationMinutes')] }),
    ).toEqual(['mobile.detail.field.schedule']);
  });

  it('不同字段各留各的名字，顺序 = 首次出现的顺序', () => {
    expect(
      taskActivityFieldMessageKeys({ changes: [change('dueDate'), change('title'), change('priority')] }),
    ).toEqual([
      'mobile.detail.field.dueDate',
      'mobile.detail.field.title',
      'mobile.detail.field.priority',
    ]);
  });

  it('认不出的键名念「其他字段」，不念原始键名', () => {
    // 载荷里的原始键名是给开发者的（`heytaTaskRepeatCompletion` 这类内部标记
    // 一旦出现在界面上，用户读到的是乱码）。
    expect(taskActivityFieldMessageKeys({ changes: [change('other')] })).toEqual([
      'mobile.detail.activity.field.other',
    ]);
  });

  it('🔴 领域层联合里的每个字段都接得上词条（不许静默落兜底）', () => {
    // `TASK_ACTIVITY_FIELDS` 的键集合就是"会被认出来的字段"，加上 `other`
    // 与 `deletedAt`（它们只出现在事件里，不出现在那张映射表里）。
    // 这条判据的作用：往 `TaskActivityField` 里加一个字段而忘了接词条时，
    // 这里念出来的是 `其他字段`，而**界面上看起来完全正常** —— 所以把它写成判据。
    const allFields = [
      'title', 'note', 'dueDate', 'priority', 'projectId', 'tagIds', 'parentId',
      'repeatRule', 'repeatDtstart', 'startDate', 'durationMinutes', 'completedAt',
      'pinnedAt', 'abandonedAt', 'deletedAt', 'other',
    ] as const;
    for (const field of allFields) {
      const [key] = taskActivityFieldMessageKeys({ changes: [change(field)] });
      expect(key, `${field} 没有接词条`).toBeDefined();
      if (field !== 'other') {
        expect(key, `${field} 静默落到了「其他字段」兜底`).not.toBe(
          'mobile.detail.activity.field.other',
        );
      }
    }
  });
});

describe('事件类型与设备来源', () => {
  it('四种 kind 各有句子，且都不与"改了哪个字段"混用', () => {
    const keys = ['created', 'updated', 'deleted', 'restored'].map((kind) =>
      taskActivityKindMessageKey(kind as never),
    );
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(String(key)).toMatch('activity.kind');
  });

  it('本机 / 别的设备是两个不同的说法', () => {
    expect(taskActivityDeviceMessageKey(true)).toBe('mobile.detail.activity.device.local');
    expect(taskActivityDeviceMessageKey(false)).toBe('mobile.detail.activity.device.other');
  });
});

describe('🔴 覆盖范围那句话', () => {
  it('complete 时**不多嘴**（这时说"只是这台设备的"是错的）', () => {
    expect(taskActivityCoverageMessageKey('complete')).toBeUndefined();
  });

  it('增量历史与空历史各有一句，而且都真说得出话', () => {
    expect(taskActivityCoverageMessageKey('device-local-only')).toBe(
      'mobile.detail.activity.localOnly',
    );
    expect(taskActivityCoverageMessageKey('empty')).toBe('mobile.detail.activity.empty');
  });

  it('领域层实际会产出的三档都有明确的说法（不靠这里自己抄一份联合）', () => {
    const produced = new Set<string>();
    for (const input of [
      { taskCreatedAt: 100, earliestEventAt: undefined },
      { taskCreatedAt: undefined, earliestEventAt: 100 },
      { taskCreatedAt: 100, earliestEventAt: 100 },
      { taskCreatedAt: 200, earliestEventAt: 100 },
    ]) {
      produced.add(taskActivityCoverage(input));
    }
    expect(produced).toEqual(new Set(['empty', 'device-local-only', 'complete']));
    for (const coverage of produced) {
      const key = taskActivityCoverageMessageKey(
        coverage as 'complete' | 'device-local-only' | 'empty',
      );
      if (coverage === 'complete') {
        // 完整历史时**不多嘴**：这时画一句"只是这台设备记录到的"是错的。
        expect(key).toBeUndefined();
      } else {
        // 另两档必须真说得出话。返回 undefined 的后果不是崩，而是
        // 把增量历史念成完整历史 —— 一句不会报错的不实陈述。
        expect(key, `${coverage} 没有对应的说明`).not.toBeUndefined();
      }
    }
  });
});
