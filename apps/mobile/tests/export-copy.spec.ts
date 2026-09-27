/**
 * 移动端 Markdown 导出措辞的单测
 * ================================
 *
 * 这个文件测的是**词条 → `TasksMarkdownCopy` 的接线**。格式（有哪些列、
 * 怎么排版）由 `@heyta/app-host` 负责，那边已有自己的测试；这里要钉住的是：
 *
 *   1. 每个字段都真的接到了词条，没有一处漏空（漏了 Markdown 里就是一个空表头）；
 *   2. **页脚那句「这是导出，还不能导回来」必须在**，而且中英都在。
 *      它是"不能把导出当还原点"的唯一防线 —— 这句要是没了，
 *      导出的文件**照样生成**，只是把一个导不回来的东西包装成了备份；
 *   3. 中英两套都完整（en 表漏 key 是编译错误，但把英文写成中文不是）。
 *
 * 🔴 本文件不 import `react-native`（`lib/` 的单测在 node 里跑）。
 */

import { describe, expect, it } from 'vitest';

import { Priority } from '@heyta/domain';
import { translate } from '@heyta/i18n';

import { tasksMarkdownCopy } from '../src/lib/export-copy';
import type { Translate } from '../src/i18n/translate';

const zhT: Translate = (key, vars) => translate('zh-CN', key, vars);
const enT: Translate = (key, vars) => translate('en', key, vars);

describe('tasksMarkdownCopy：字段全部接到词条', () => {
  it('中英两套的每个字段都非空且互不相同', () => {
    const zh = tasksMarkdownCopy(zhT);
    const en = tasksMarkdownCopy(enT);

    const scalars = [
      'heading',
      'generatedAt',
      'empty',
      'open',
      'done',
      'none',
      'footer',
    ] as const;
    for (const key of scalars) {
      expect(zh[key]).not.toBe('');
      expect(en[key]).not.toBe('');
      expect(zh[key]).not.toBe(en[key]);
    }

    const columns = ['title', 'status', 'due', 'priority', 'project', 'tags'] as const;
    for (const key of columns) {
      expect(zh.columns[key]).not.toBe('');
      expect(en.columns[key]).not.toBe('');
      expect(zh.columns[key]).not.toBe(en.columns[key]);
    }
  });

  it('🔴 页脚必须说清「不能导回来」—— 这是导出文件的唯一诚实条款', () => {
    const zh = tasksMarkdownCopy(zhT);
    const en = tasksMarkdownCopy(enT);

    expect(zh.footer).toContain('不能导回来');
    expect(en.footer.toLowerCase()).toContain('cannot import');
  });

  it('优先级四档都有词，且 None 与"空单元格占位符"不是同一句', () => {
    const copy = tasksMarkdownCopy(zhT);
    const labels = [Priority.High, Priority.Medium, Priority.Low].map((p) => copy.priorityLabel(p));

    for (const label of labels) expect(label).not.toBe('');
    expect(new Set(labels).size).toBe(3);

    // `None` 优先级与"这一格没有值"是两件事，混成一句会让导出看起来少了信息。
    expect(copy.priorityLabel(Priority.None)).not.toBe(copy.none);
  });

  it('中英优先级也对得上（不是把中文串到了 en 表里）', () => {
    const zh = tasksMarkdownCopy(zhT);
    const en = tasksMarkdownCopy(enT);
    expect(zh.priorityLabel(Priority.High)).not.toBe(en.priorityLabel(Priority.High));
  });
});
