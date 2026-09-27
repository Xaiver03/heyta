/**
 * 冲突载荷摘要的测试
 * ====================
 *
 * `describeConflictPayload` 返回的是一句**中文**，而它的一支会把载荷的**字段名**
 * 直接拼进去。这两件事合起来意味着：任何要显示英文的壳都没法复用它，
 * 而门禁也扫不到它（它是跨包的返回值，不是 JSX 里的字面量）。
 *
 * 所以判断被抽成 `summarizeConflictPayload`。这里钉住两件事：
 *
 *   1. **判断本身**（哪种载荷算 `text` / `fields` / `empty`），
 *      包括容易漏的"空白标题要往下找"和"空对象不是 text"；
 *   2. **旧函数的输出逐字不变** —— 它还有调用方没迁完。这一条是防回归的：
 *      重构的判断逻辑如果和原来有一丝不同，用户看到的冲突标题就会变。
 *
 * ⚠️ `fields` 那一支**故意只给壳"数量"和字段对，不给中文句子**：
 * 字段名（`completedAt`）是内部标识符，不该出现在用户可见文案里。
 * 下面的用例把"字段名确实还在结构化结果里"和"旧函数的字符串里仍然有它"
 * 分开断言 —— 前者是数据，后者是历史包袱，两者不是一回事。
 */

import { describe, expect, it } from 'vitest';

import { describeConflictPayload, summarizeConflictPayload } from '../src/client.js';

describe('summarizeConflictPayload：能当标题的用用户自己的字', () => {
  it('title 优先', () => {
    expect(summarizeConflictPayload({ title: '写周报', name: '项目 A' })).toEqual({
      kind: 'text',
      text: '写周报',
    });
  });

  it('title 为空串时往下找 name —— 空标题当标题会让用户看到一片空白', () => {
    expect(summarizeConflictPayload({ title: '', name: '项目 A' })).toEqual({
      kind: 'text',
      text: '项目 A',
    });
  });

  it('纯空白的 title 也要往下找 —— `trim()` 过才算数', () => {
    expect(summarizeConflictPayload({ title: '   ', text: '正文' })).toEqual({
      kind: 'text',
      text: '正文',
    });
  });

  it('优先级顺序是 title → name → text → content → note', () => {
    const payload = { note: '备注', content: '内容', text: '正文', name: '名称', title: '标题' };
    expect(summarizeConflictPayload(payload)).toEqual({ kind: 'text', text: '标题' });
    expect(summarizeConflictPayload({ ...payload, title: undefined })).toEqual({
      kind: 'text',
      text: '名称',
    });
    expect(
      summarizeConflictPayload({ note: '备注', content: '内容', text: '正文' }),
    ).toEqual({ kind: 'text', text: '正文' });
  });

  it('非字符串的 title（数字、对象）不算标题', () => {
    expect(summarizeConflictPayload({ title: 123, name: '项目 A' })).toEqual({
      kind: 'text',
      text: '项目 A',
    });
  });

  it('标量载荷直接转字符串', () => {
    expect(summarizeConflictPayload('纯字符串')).toEqual({ kind: 'text', text: '纯字符串' });
    expect(summarizeConflictPayload(42)).toEqual({ kind: 'text', text: '42' });
  });
});

describe('summarizeConflictPayload：空就是空', () => {
  it('null / undefined / 空对象都是 empty', () => {
    expect(summarizeConflictPayload(null)).toEqual({ kind: 'empty' });
    expect(summarizeConflictPayload(undefined)).toEqual({ kind: 'empty' });
    expect(summarizeConflictPayload({})).toEqual({ kind: 'empty' });
  });
});

describe('summarizeConflictPayload：没有可读标题时只报字段', () => {
  it('结构化载荷给出字段名与值，且不拼中文句子', () => {
    const summary = summarizeConflictPayload({ completedAt: 123, dueDate: '2026-03-02' });
    expect(summary.kind).toBe('fields');
    if (summary.kind !== 'fields') throw new Error('unreachable');
    expect(summary.fields).toEqual([
      { name: 'completedAt', value: '123' },
      { name: 'dueDate', value: '"2026-03-02"' },
    ]);
  });

  it('值是 undefined 的字段拼成 `undefined`，不是空串（与旧实现的隐式转换一致）', () => {
    const summary = summarizeConflictPayload({ fn: undefined });
    expect(summary.kind).toBe('fields');
    if (summary.kind !== 'fields') throw new Error('unreachable');
    expect(summary.fields).toEqual([{ name: 'fn', value: 'undefined' }]);
  });
});

describe('describeConflictPayload：旧输出逐字不变（还有调用方没迁完）', () => {
  it('有标题就用标题', () => {
    expect(describeConflictPayload({ title: '写周报' })).toBe('写周报');
    expect(describeConflictPayload({ name: '项目 A' })).toBe('项目 A');
  });

  it('空载荷是「（空）」', () => {
    expect(describeConflictPayload(null)).toBe('（空）');
    expect(describeConflictPayload({})).toBe('（空）');
  });

  it('没有标题时列出字段，用「、」分隔', () => {
    expect(describeConflictPayload({ completedAt: 123 })).toBe('completedAt: 123');
    expect(describeConflictPayload({ a: 1, b: 2 })).toBe('a: 1、b: 2');
  });

  it('字段最多列 4 个 —— 再多会把标题栏撑成一堵墙', () => {
    const payload = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    expect(describeConflictPayload(payload)).toBe('a: 1、b: 2、c: 3、d: 4');
  });

  it('标量载荷转字符串', () => {
    expect(describeConflictPayload(7)).toBe('7');
  });

  it('🔴 两个函数对同一种载荷的判断必须一致 —— 否则等于有两份规则', () => {
    const payloads: unknown[] = [
      null,
      undefined,
      {},
      'x',
      42,
      { title: 'T' },
      { title: '  ', name: 'N' },
      { completedAt: 123 },
      { a: 1, b: 2, c: 3, d: 4, e: 5 },
    ];
    for (const payload of payloads) {
      const summary = summarizeConflictPayload(payload);
      const text = describeConflictPayload(payload);
      if (summary.kind === 'empty') {
        expect(text, JSON.stringify(payload)).toBe('（空）');
      } else if (summary.kind === 'text') {
        expect(text, JSON.stringify(payload)).toBe(summary.text);
      } else {
        // fields 支：旧函数给的是"字段对拼起来的句子"，
        // 只能断言它由 summary 里的字段构成 —— 而不是断言它等于某个新写的期望。
        for (const field of summary.fields.slice(0, 4)) {
          expect(text, JSON.stringify(payload)).toContain(field.name);
        }
      }
    }
  });
});