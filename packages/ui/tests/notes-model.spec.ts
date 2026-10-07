/**
 * 便签板的**判断层**测试（跑在 node）
 * ====================================
 *
 * M3 第十刀（notes）。这里测的**不是"渲染得对不对"**，而是那些
 * "写错不会让界面报错、只会静默错"的判断：
 *
 *   1. **顺序与 `sortNotesForDisplay` 逐项相等** —— 各端各 `sort()` 一次
 *      的结果是同一条便签在两端位置不同，用户会以为"同步把顺序搞乱了"。
 *      所以这里拿领域函数做**逐项对照**，而不是只断言几个相邻关系
 *      （后者会让一个"漏掉 id 决胜段"的实现照样绿）。
 *   2. **摘要走 `noteExcerpt`**：多行只取第一段非空行、超长截断带 `…`。
 *      自己 `slice(0, n)` 的实现会在单词/行中间切断，读起来像乱码。
 *   3. `isPinned` 来自领域层的高亮判据（`isNoteHighlighted`），不是
 *      各端各读一次 `note.isPinnedToToday`。
 *   4. **提交结局与 composer 状态机**（W8a）：`onAdd` 的两种失败形态
 *      都要被兜住；失败保草稿、成功才清 —— 无条件清空会把用户写得
 *      最用心的那一次（超长被拒）整个吞掉，且全程无报错。
 */

import { describe, expect, it } from 'vitest';
import { noteExcerpt, sortNotesForDisplay, type Note } from '@heyta/domain';

import { NOTE_EXCERPT_LENGTH } from '@heyta/domain';

import {
  NOTE_COMPOSER_INITIAL,
  noteComposerAfterOutcome,
  noteComposerTyping,
  runNoteSubmit,
  toNoteRows,
} from '../src/notes/model.js';

const NOW = 1_700_000_000_000;

/** 造一条便签。默认未删除、未钉选。 */
function note(partial: Partial<Note> & { id: string; content: string }): Note {
  return { createdAt: NOW, updatedAt: NOW, isPinnedToToday: false, ...partial };
}

describe('toNoteRows：顺序逐项来自 sortNotesForDisplay', () => {
  const notes = [
    note({ id: 'n-old-plain', content: '旧', updatedAt: NOW - 3000 }),
    // 钉选的**更新时间更早**，但它必须排在所有未钉选的前面。
    note({ id: 'n-pinned', content: '钉住的', updatedAt: NOW - 5000, isPinnedToToday: true }),
    note({ id: 'n-new-plain', content: '新', updatedAt: NOW - 1000 }),
    // 同一毫秒更新的两条靠 id 字典序决胜 —— 少了这一段，两端会换位置。
    note({ id: 'n-b', content: '同刻 b', updatedAt: NOW - 2000 }),
    note({ id: 'n-a', content: '同刻 a', updatedAt: NOW - 2000 }),
  ];

  it('行顺序与领域函数的输出逐项相等', () => {
    const expected = sortNotesForDisplay(notes).map((item) => item.id);
    const actual = toNoteRows(notes, NOTE_EXCERPT_LENGTH).map((row) => row.id);
    expect(actual).toEqual(expected);
  });

  it('钉到今天的排在最前，即使它更新时间更早', () => {
    const rows = toNoteRows(notes, NOTE_EXCERPT_LENGTH);
    expect(rows[0]?.id).toBe('n-pinned');
    expect(rows[0]?.isPinned).toBe(true);
  });
});

describe('toNoteRows：摘要走 noteExcerpt', () => {
  it('每一行的 excerpt 都与领域函数相等', () => {
    const notes = [
      note({ id: 'n1', content: '第一行\n第二行' }),
      note({ id: 'n2', content: 'x'.repeat(200) }),
    ];
    const rows = toNoteRows(notes, NOTE_EXCERPT_LENGTH);
    rows.forEach((row, index) => {
      expect(row.excerpt).toBe(
        noteExcerpt(notes[index] as Note, NOTE_EXCERPT_LENGTH),
      );
    });
  });

  it('多行内容只取第一段非空行（跳过开头的空行与缩进）', () => {
    const rows = toNoteRows(
      [note({ id: 'n1', content: '\n\n   买菜   \n西红柿\n鸡蛋' })],
      NOTE_EXCERPT_LENGTH,
    );
    expect(rows[0]?.excerpt).toBe('买菜');
  });

  it('超长内容截断并以 … 结尾，长度等于摘要上限', () => {
    const rows = toNoteRows([note({ id: 'n1', content: 'x'.repeat(200) })], NOTE_EXCERPT_LENGTH);
    const excerpt = rows[0]?.excerpt ?? '';
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toHaveLength(NOTE_EXCERPT_LENGTH);
  });

  it('刚好等于上限时不截断（没有多余的 …）', () => {
    const content = 'x'.repeat(NOTE_EXCERPT_LENGTH);
    const rows = toNoteRows([note({ id: 'n1', content })], NOTE_EXCERPT_LENGTH);
    expect(rows[0]?.excerpt).toBe(content);
    expect(rows[0]?.excerpt.endsWith('…')).toBe(false);
  });

  it('显式传入的摘要长度生效（截断算法仍只有一处）', () => {
    const rows = toNoteRows([note({ id: 'n1', content: 'x'.repeat(200) })], 10);
    expect(rows[0]?.excerpt).toHaveLength(10);
    expect(rows[0]?.excerpt.endsWith('…')).toBe(true);
  });
});

describe('runNoteSubmit：两种失败形态都兜住（W8a）', () => {
  it('onAdd 返回的 Promise reject ⇒ failed（工单用例 a 的裁决半）', async () => {
    const outcome = await runNoteSubmit('买牛奶', () =>
      Promise.reject(new Error('便签内容不合法：正文超过上限')),
    );
    expect(outcome).toBe('failed');
  });

  it('onAdd 同步 throw ⇒ failed（工单用例 b 的裁决半）', async () => {
    const thrower = (): void => {
      throw new Error('同步炸的');
    };
    const outcome = await runNoteSubmit('买牛奶', thrower);
    expect(outcome).toBe('failed');
  });

  it('onAdd 正常返回 / 返回兑现的 Promise ⇒ saved（工单用例 c 的裁决半）', async () => {
    expect(await runNoteSubmit('买牛奶', () => undefined)).toBe('saved');
    expect(await runNoteSubmit('买牛奶', () => Promise.resolve())).toBe('saved');
  });

  it('空白挡板 ⇒ 不调用 onAdd、结局 blank（工单用例 d）', async () => {
    const calls: string[] = [];
    const outcome = await runNoteSubmit('   \n\t ', (content) => {
      calls.push(content);
    });
    expect(outcome).toBe('blank');
    expect(calls).toEqual([]);
  });

  it('交给宿主的是原样输入（不替宿主做 trim 规范化）', async () => {
    const seen: string[] = [];
    await runNoteSubmit('  买牛奶  ', (content) => {
      seen.push(content);
    });
    expect(seen).toEqual(['  买牛奶  ']);
  });
});

describe('noteComposerAfterOutcome：失败保草稿、成功才清（W8a 核心）', () => {
  it('失败 ⇒ 草稿原样保留 + 亮提示（用例 a/b 的呈现半）', () => {
    const next = noteComposerAfterOutcome(
      { draft: '买牛奶', saveFailed: false },
      '买牛奶',
      'failed',
    );
    expect(next).toEqual({ draft: '买牛奶', saveFailed: true });
  });

  it('成功 ⇒ 草稿清空且提示熄灭（用例 c 的呈现半）', () => {
    const next = noteComposerAfterOutcome({ draft: '买牛奶', saveFailed: true }, '买牛奶', 'saved');
    expect(next).toEqual({ draft: '', saveFailed: false });
  });

  it('成功，但草稿已在落库期间被接着改 ⇒ 在途输入不吞，只清仍是所提交内容的那份', () => {
    const next = noteComposerAfterOutcome(
      { draft: '买牛奶、鸡蛋', saveFailed: false },
      '买牛奶',
      'saved',
    );
    expect(next.draft).toBe('买牛奶、鸡蛋');
    expect(next.saveFailed).toBe(false);
  });

  it('失败，且草稿在落库期间被接着改 ⇒ 整份当前草稿都保留（在途输入同样是用户的）', () => {
    const next = noteComposerAfterOutcome(
      { draft: '买牛奶、鸡蛋', saveFailed: false },
      '买牛奶',
      'failed',
    );
    expect(next).toEqual({ draft: '买牛奶、鸡蛋', saveFailed: true });
  });

  it('空白挡板 ⇒ 状态原样、不亮提示（用例 d 的呈现半）', () => {
    const state = { draft: '   ', saveFailed: false };
    expect(noteComposerAfterOutcome(state, '   ', 'blank')).toBe(state);
  });

  it('失败后再输入 ⇒ 提示保留（noteComposerTyping 不在打字时熄它）', () => {
    const next = noteComposerTyping({ draft: '买牛奶', saveFailed: true }, '买牛奶、');
    expect(next).toEqual({ draft: '买牛奶、', saveFailed: true });
  });

  it('失败后原稿重试成功 ⇒ 草稿清空、提示熄灭（闭环到干净状态）', () => {
    const next = noteComposerAfterOutcome({ draft: '买牛奶', saveFailed: true }, '买牛奶', 'saved');
    expect(next).toEqual({ draft: '', saveFailed: false });
  });

  it('初始状态：空草稿、无提示', () => {
    expect(NOTE_COMPOSER_INITIAL).toEqual({ draft: '', saveFailed: false });
  });
});
