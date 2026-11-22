/**
 * 结构化输出（非工具任务的 strict JSON 约束 + 失败可读回退）。
 *
 * 用例：拆解/排序/耗时这类"要一份结构化结果"的调用，用 `response_format: json_schema (strict)`
 * 让模型按 schema 出 JSON；模型偶尔仍会回带围栏/多话，所以**解析失败必须回退**到原文，绝不静默吞掉。
 */
import type { WireResponseFormat } from '@heyta/ai';

/** 造一个 strict json_schema 的 `response_format`。 */
export function structuredJson(name: string, schema: Record<string, unknown>): WireResponseFormat {
  return { type: 'json_schema', json_schema: { name, strict: true, schema } };
}

export type StructuredParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly fallback: string };

/** 从模型文本里取 JSON：支持纯 JSON、```json 围栏、前后夹话（取第一个 {…} 或 […]）。 */
export function parseStructuredOutput<T = unknown>(text: string): StructuredParse<T> {
  const raw = text.trim();
  if (raw === '') return { ok: false, reason: 'empty', fallback: text };
  const candidates: string[] = [raw];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence !== null && fence[1] !== undefined) candidates.push(fence[1].trim());
  const firstObj = raw.indexOf('{');
  const lastObj = raw.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(raw.slice(firstObj, lastObj + 1));
  const firstArr = raw.indexOf('[');
  const lastArr = raw.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(raw.slice(firstArr, lastArr + 1));
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as T };
    } catch {
      /* 试下一个候补 */
    }
  }
  return { ok: false, reason: 'invalid-json', fallback: text };
}
