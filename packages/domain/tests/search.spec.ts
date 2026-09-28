/**
 * 任务搜索语义
 * ==============
 *
 * 这个文件钉的是 `packages/domain/src/search.ts` 里那三个**判断题**
 * （不是实现细节）：匹配哪些字段、大小写怎么处理、多个词是 AND 还是 OR。
 * 它们错了不会崩、不会报错，只会让用户"搜不到自己明明记得写过的东西"。
 */

import { describe, expect, it } from 'vitest';

import type { Task } from '../src/entities.js';
import { haystackOf, matchesQuery, searchTasks } from '../src/search.js';

function task(over: Partial<Task> & { id: string }): Task {
  return { title: over.id, createdAt: 0, updatedAt: 0, ...over } as Task;
}

describe('matchesQuery', () => {
  it('空查询匹配一切 —— 清空搜索框不该让列表变空', () => {
    expect(matchesQuery({ title: '写周报' }, '')).toBe(true);
    // 纯空白也算空
    expect(matchesQuery({ title: '写周报' }, '   ')).toBe(true);
  });

  it('🔴 中日韩按**子串**匹配，不需要分词', () => {
    // "中文搜索要不要分词"是个假问题：子串就够。
    expect(matchesQuery({ title: '给客户写周报' }, '周报')).toBe(true);
    expect(matchesQuery({ title: '给客户写周报' }, '客户')).toBe(true);
    // 被拆开的两段不算匹配
    expect(matchesQuery({ title: '给客户写周报' }, '客周')).toBe(false);
  });

  it('大小写不敏感（拉丁）', () => {
    expect(matchesQuery({ title: 'Write Weekly Report' }, 'weekly')).toBe(true);
    expect(matchesQuery({ title: 'write weekly report' }, 'WEEKLY')).toBe(true);
    // 查询串那边也要折叠
    expect(matchesQuery({ title: 'WRITE' }, 'write')).toBe(true);
  });

  it('🔴 多个词是 **AND**：多打一个词应当让结果**变少**', () => {
    const t = { title: '给客户写周报' };
    expect(matchesQuery(t, '客户 周报')).toBe(true);
    // 有一个词不在 → 不匹配（若是 OR，这里会是 true，而用户会以为搜索坏了）
    expect(matchesQuery(t, '客户 月报')).toBe(false);
  });

  it('多个词可以落在**不同字段**里', () => {
    const t = { title: '周报', note: '记得带上客户反馈' };
    expect(matchesQuery(t, '周报 客户')).toBe(true);
  });

  it('🔴 备注也参与匹配（用户记得自己写过什么）', () => {
    expect(matchesQuery({ title: '周报', note: '指标：转化率 3.2%' }, '转化率')).toBe(true);
  });

  it('没有备注不会崩（老数据没有这个字段）', () => {
    expect(matchesQuery({ title: '周报' }, '周报')).toBe(true);
    expect(matchesQuery({ title: '周报' }, '指标')).toBe(false);
  });

  it('🔴 不做跨字段拼接匹配 —— 拼出来的匹配用户找不到自己在搜哪一段', () => {
    // 标题以"结尾"结尾、备注以"开头"开头时，**不该**因为拼接而命中"尾开"。
    const t = { title: '这是结尾', note: '开头是这样' };
    expect(matchesQuery(t, '尾开')).toBe(false);
    // 两个词各自在自己的字段里 → 命中
    expect(matchesQuery(t, '结尾 开头')).toBe(true);
  });

  it('多余空白被忽略', () => {
    expect(matchesQuery({ title: '给客户写周报' }, '  客户   周报  ')).toBe(true);
  });
});

describe('searchTasks', () => {
  it('🔴 空查询返回**全部**（含已完成），由调用方决定还要不要筛', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', completedAt: 1 })];
    expect(searchTasks(tasks, '').map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('按查询过滤，但**不排序** —— 顺序是 app-host 定的规范顺序', () => {
    const tasks = [task({ id: 'b', title: '周报' }), task({ id: 'a', title: '周报草稿' })];
    expect(searchTasks(tasks, '周报').map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('没有命中的返回空数组', () => {
    expect(searchTasks([task({ id: 'a', title: '周报' })], '月报')).toEqual([]);
  });
});

describe('haystackOf', () => {
  it('只摊平 title 与 note，且**都转小写**', () => {
    expect(haystackOf({ title: 'Report', note: 'Weekly' })).toBe('report\nweekly');
    expect(haystackOf({ title: 'Report' })).toBe('report\n');
  });
});
