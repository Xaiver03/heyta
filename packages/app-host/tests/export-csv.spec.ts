import { Priority } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { renderTasksCsv, type ExportTaskRow, type TasksCsvCopy } from '../src/export-dump.js';

/**
 * 与 CLI / Web / 移动壳同一套措辞：列名取 `web.export.markdown.col*`，
 * 状态取 `web.export.markdown.open|done|none`，优先级取 `web.capture.priority.*`。
 */
const copy: TasksCsvCopy = {
  open: '未完成',
  done: '已完成',
  none: '（无）',
  columns: { title: '标题', status: '状态', due: '截止', priority: '优先级', project: '清单', tags: '标签' },
  priorityLabel: (p) =>
    p === Priority.High
      ? '高优先级'
      : p === Priority.Medium
        ? '中优先级'
        : p === Priority.Low
          ? '低优先级'
          : '无优先级',
};

const row = (over: Partial<ExportTaskRow> = {}): ExportTaskRow => ({
  id: 't-1',
  title: '买牛奶',
  completed: false,
  tagNames: [],
  createdAt: 1,
  ...over,
});

/** 去掉 BOM 后按 CRLF 切行，方便逐行断言。 */
const lines = (csv: string): string[] => csv.replace(/^\uFEFF/, '').split('\r\n');

describe('renderTasksCsv', () => {
  it('以 UTF-8 BOM 开头、行尾一律是 CRLF', () => {
    const csv = renderTasksCsv([row()], copy);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    // 去掉 CRLF 后不应再残留裸 \n 或裸 \r。
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    expect(csv.replace(/\r\n/g, '')).not.toContain('\r');
  });

  it('表头是六列，顺序为 title,status,due,priority,project,tags', () => {
    const header = lines(renderTasksCsv([], copy))[0];
    expect(header).toBe('标题,状态,截止,优先级,清单,标签');
  });

  it('截止列把 dueDate + dueTime 合成一格，无 dueDate 时用 none 占位', () => {
    const timed = lines(renderTasksCsv([row({ dueDate: '2026-10-04', dueTime: '16:00' })], copy))[1];
    expect(timed).toContain('2026-10-04 16:00');

    const noDue = lines(renderTasksCsv([row()], copy))[1] ?? '';
    expect(noDue.split(',')[2]).toBe(copy.none);
  });

  it('标题以 = 或 + 开头时被前置单引号保护（CSV 注入防护）', () => {
    const csv = renderTasksCsv(
      [row({ title: '=SUM(A1)' }), row({ id: 't-2', title: '+危险' })],
      copy,
    );
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'+危险");
  });

  it('完成状态、优先级翻译与标签连接都正确', () => {
    const rows = [
      row({ completed: true, priority: Priority.High, projectName: '生活', tagNames: ['工作', '紧急'] }),
      row({ id: 't-2', completed: false, priority: Priority.Low }),
      row({ id: 't-3', priority: Priority.None, tagNames: ['单'] }),
    ];
    const [, first, second, third] = lines(renderTasksCsv(rows, copy));

    // 标签用 ', ' 连接并因此被引号包裹。
    expect(first).toBe('买牛奶,已完成,（无）,高优先级,生活,"工作, 紧急"');
    expect(first).toContain('"工作, 紧急"');
    expect(second).toBe('买牛奶,未完成,（无）,低优先级,（无）,（无）');
    expect(third).toBe('买牛奶,未完成,（无）,无优先级,（无）,单');
  });
});
