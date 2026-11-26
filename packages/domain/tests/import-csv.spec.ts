/**
 * 通用 CSV / Todoist 导入解析判据
 * ==============================
 * 列名中英、优先级映射、日期、标签/清单去重、跳过计数、Todoist 语义。
 */

import { describe, expect, it } from 'vitest';

import { parseCsvImport, parseGenericCsv, parseTodoistCsv } from '../src/import-csv.js';
import { dueDateToEpoch } from '../src/capture.js';
import { Priority } from '../src/entities.js';

const NOW = Date.UTC(2026, 10, 24);

describe('parseGenericCsv', () => {
  it('中英表头、日期、优先级、清单/标签去重、空标题跳过', () => {
    const csv = [
      'title,due,priority,list,tags,note,completed',
      '写周报,2026-11-24,high,工作,"重要,紧急",备注,false',
      ' ,2026-11-25,,,,"",false',
      '会议,2026-11-24 10:00,2,工作,,,false',
    ].join('\n');
    const result = parseGenericCsv(csv, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks).toHaveLength(2);
    expect(result.plan.projects.map((p) => p.name)).toEqual(['工作']);
    expect(result.plan.tags.map((t) => t.name).sort()).toEqual(['紧急', '重要'].sort());
    const first = result.plan.tasks[0]!;
    expect(first.title).toBe('写周报');
    expect(first.priority).toBe(Priority.High);
    expect(first.note).toBe('备注');
    expect(first.dueDate).toBe(dueDateToEpoch('2026-11-24'));
    expect(first.projectId).toBe(result.plan.projects[0]!.id);
    // 第二条有具体时刻：dueDate 是 10:00（本地）=> 与同一天零点不同。
    const meeting = result.plan.tasks[1]!;
    expect(meeting.priority).toBe(Priority.Medium);
    expect(meeting.dueDate).toBe(dueDateToEpoch('2026-11-24', '10:00'));
    expect(result.report.dataRows).toBe(3);
    expect(result.report.tasks).toBe(2);
    expect(result.report.skipped).toHaveLength(1);
    expect(result.report.skipped[0]!.reason).toBe('empty-title');
  });

  it('无 title 列 → no-header；只有表头无数据 → no-tasks', () => {
    expect(parseGenericCsv('a,b\n1,2', { now: NOW })).toMatchObject({ ok: false, reason: 'no-header' });
    expect(parseGenericCsv('title,due\n', { now: NOW })).toMatchObject({ ok: false, reason: 'no-tasks' });
  });
});

describe('parseTodoistCsv', () => {
  it('TYPE=task 才导；Todoist 优先级 4/3/2/1；标签分号/逗号；已完成计数', () => {
    const csv = [
      'TYPE,CONTENT,DESCRIPTION,PRIORITY,DUE_DATE,LABELS,PROJECT_NAME,IS_COMPLETED',
      'task,买牛奶,记得买低脂,4,2026-11-24,家;采购,生活,false',
      'section,分组行,,0,,, ,false',
      'task,交报告,,3,2026-11-24 10:00,工作,项目,true',
    ].join('\n');
    const result = parseTodoistCsv(csv, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks).toHaveLength(2);
    expect(result.plan.tasks[0]!.priority).toBe(Priority.High);
    expect(result.plan.tasks[0]!.note).toBe('记得买低脂');
    expect(result.plan.tasks[0]!.tagIds).toHaveLength(2);
    expect(result.plan.tasks[1]!.priority).toBe(Priority.Medium);
    expect(result.plan.tasks[1]!.completedAt).toBe(NOW);
    expect(result.report.completedTasks).toBe(1);
  });

  it('parseCsvImport 分派', () => {
    const csv = 'title\n任务A';
    expect(parseCsvImport('generic', csv, { now: NOW }).ok).toBe(true);
    const bad = parseCsvImport('todoist', csv, { now: NOW });
    expect(bad.ok).toBe(false);
  });
});
