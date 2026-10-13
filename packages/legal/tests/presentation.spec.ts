import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, legalDocumentById, legalDocumentPresentation, legalSetVersion } from '../src/index.js';
import { formalizeLegalText } from '../src/presentation.js';
import type { LegalSection } from '../src/types.js';

const ids = (sections: readonly LegalSection[]): string[] => sections.flatMap((s) => [s.id, ...ids(s.subsections ?? [])]);

/**
 * 展示适配只允许改写编号、状态符和条款引用；正文内容与块形状必须逐块保留。
 * 这里把那三类展示差异归一化后递归对账，避免只比较顶层 kind 导致表格/列表
 * 内部被截断时仍然假绿。
 */
function canonicalText(value: string): string {
  return formalizeLegalText(value)
    .replace(/^\d+[a-z]?(?:\.\d+)*\.\s+/, '')
    .replace(/[❌✅🔴⚠📌📍🟡🟢⏸]\uFE0F?\s*/gu, '')
    .replace(/\bs\d+[a-z]?(?:-\d+)?\b/g, '§REF§')
    .replace(/第\d+[a-z]?(?:\.\d+)*条|Section \d+[a-z]?(?:\.\d+)*/g, '§REF§');
}

function canonicalBlock(block: NonNullable<LegalSection['blocks']>[number]): unknown {
  switch (block.kind) {
    case 'p':
    case 'callout':
    case 'docRef':
      return { kind: block.kind, text: canonicalText(block.text), ...(block.kind === 'docRef' ? { docId: block.docId } : {}) };
    case 'ul':
    case 'ol':
      return { kind: block.kind, items: block.items.map(canonicalText) };
    case 'table':
      return {
        kind: block.kind,
        head: block.head.map(canonicalText),
        rows: block.rows.map((row) => row.map(canonicalText)),
      };
  }
}

function canonicalSection(section: LegalSection): unknown {
  return {
    id: section.id,
    title: canonicalText(section.title),
    blocks: (section.blocks ?? []).map(canonicalBlock),
    subsections: (section.subsections ?? []).map(canonicalSection),
  };
}

describe('法律文本展示与同意事实分离', () => {
  it('九份中英文本原对象、版本和锚点不变，每一种块都仍然存在', () => {
    const originals = JSON.stringify(LEGAL_DOCUMENTS);
    const version = legalSetVersion();
    for (const document of LEGAL_DOCUMENTS) {
      const presented = legalDocumentPresentation(document);
      expect(presented.version).toBe(document.version);
      expect(presented.status).toBe(document.status);
      expect(presented.updatedDate).toBe(document.updatedDate);
      for (const locale of ['zh-CN', 'en'] as const) {
        expect(ids(presented.sections[locale]).sort()).toEqual(ids(document.sections[locale]).sort());
        presented.sections[locale].forEach((section) => {
          const original = document.sections[locale].find((s) => s.id === section.id);
          const stable = /^s(\d+[a-z]?)$/.exec(section.id)?.[1];
          expect(section.title).toMatch(stable ? new RegExp(`^${stable}\\. `) : /^\d+\. /);
          expect(section.blocks?.map((b) => b.kind)).toEqual(original?.blocks?.map((b) => b.kind));
        });
        expect(JSON.stringify(presented.sections[locale])).not.toMatch(/[❌✅🔴⚠📌🟡🟢⏸]/u);
      }
    }
    expect(JSON.stringify(LEGAL_DOCUMENTS)).toBe(originals);
    expect(legalSetVersion()).toBe(version);
  });

  it('条款引用遵循稳定条款号，新增条款不会改写原有引用的含义', () => {
    const document = legalDocumentById('terms');
    const presented = legalDocumentPresentation(document);
    const historyIndex = presented.sections['zh-CN'].findIndex((s) => s.id === 's12');
    expect(historyIndex).toBe(11);
    const body = JSON.stringify(presented.sections['zh-CN']);
    expect(body).toContain('第12条');
    expect(presented.sections['zh-CN'][historyIndex]?.id).toBe('s12');
  });

  it('去除状态符但保留否定事实，不改写代码中的字段或版本示例', () => {
    const document = legalDocumentById('terms');
    const presented = legalDocumentPresentation(document);
    const table = presented.sections['zh-CN'][0]?.blocks?.find((b) => b.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') throw new Error('missing scope table');
    expect(table.rows[0]).toEqual(['heyta 应用本体（全部功能）', '不受，MIT 许可', '免费']);
    const codes = (value: unknown): string[] => JSON.stringify(value).match(/`[^`]+`/g) ?? [];
    expect(codes(presented)).toEqual(codes(document));
  });

  it('递归保留每个条款的正文、列表项、表格单元格与子条款', () => {
    for (const document of LEGAL_DOCUMENTS) {
      const presented = legalDocumentPresentation(document);
      for (const locale of ['zh-CN', 'en'] as const) {
        const originalById = new Map(ids(document.sections[locale]).map((id) => [id, id]));
        const find = (sections: readonly LegalSection[], id: string): LegalSection | undefined => {
          for (const section of sections) {
            if (section.id === id) return section;
            const nested = find(section.subsections ?? [], id);
            if (nested !== undefined) return nested;
          }
          return undefined;
        };
        for (const id of originalById.keys()) {
          const original = find(document.sections[locale], id);
          const next = find(presented.sections[locale], id);
          expect(next, `${document.id}/${locale}/${id} 展示后丢失`).toBeDefined();
          expect(original === undefined ? undefined : canonicalSection(next as LegalSection)).toEqual(
            original === undefined ? undefined : canonicalSection(original),
          );
        }
      }
    }
  });
});
