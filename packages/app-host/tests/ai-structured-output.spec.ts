import { describe, expect, it } from 'vitest';
import { parseStructuredOutput, structuredJson } from '../src/ai-structured-output.js';

describe('structured output', () => {
  it('strict json_schema 形状', () => {
    expect(structuredJson('breakdown', { type: 'object' })).toEqual({ type: 'json_schema', json_schema: { name: 'breakdown', strict: true, schema: { type: 'object' } } });
  });
  it('纯 JSON / json 围栏 / 前后夹话都能解析', () => {
    expect(parseStructuredOutput('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseStructuredOutput('```json\n{"a":2}\n```')).toEqual({ ok: true, value: { a: 2 } });
    expect(parseStructuredOutput('好的：{"a":3} 以上')).toEqual({ ok: true, value: { a: 3 } });
  });
  it('解析失败 → 可读回退原文', () => {
    const r = parseStructuredOutput('不是 JSON');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('invalid-json'); expect(r.fallback).toBe('不是 JSON'); }
  });
});
