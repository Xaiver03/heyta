/**
 * 任务搜索语义
 * ==============
 *
 * 这个文件钉的是 `packages/domain/src/search.ts` 里那三个**判断题**
 * （不是实现细节）：匹配哪些字段、大小写怎么处理、多个词是 AND 还是 OR。
 * 它们错了不会崩、不会报错，只会让用户"搜不到自己明明记得写过的东西"。
 */

import { describe, expect, it } from 'vitest';

import type { Note, Task } from '../src/entities.js';
import { haystackOf, matchesQuery, noteSearchText, searchNotes, searchTasks } from '../src/search.js';

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

  /**
   * 🔴 墓碑不进搜索结果（缺陷 D9 的钉子）。
   *
   * 这一组之所以断言**原始表整个递进来**：此前 `searchTasks` 自己不滤，
   * 滤不滤取决于调用方 —— Web 的搜索面板递 `Object.values(store.entities.tasks)`
   * （含墓碑），移动端递已过滤的列表。症状是"网页能搜出已彻底删除的任务、
   * 手机搜不到"，而两端**都没有报错**。判据必须能独立于调用方成立。
   *
   * ⚠️ `purgedAt` 的形态按 `entities.ts` 的四态语义**带着** `deletedAt`
   *（清掉 `deletedAt` 会让离线对端把数据复活），不是"只有 purgedAt"。
   */
  describe('墓碑不进结果', () => {
    const rows = [
      task({ id: 'alive', title: '周报' }),
      task({ id: 'trashed', title: '周报', deletedAt: 10 }),
      task({ id: 'purged', title: '周报', deletedAt: 10, purgedAt: 20 }),
    ];

    it('查询命中的回收站任务与已彻底删除任务都不出现', () => {
      // 三条标题完全相同 ⇒ 匹配判据对它们一视同仁，被排除的**唯一**理由是墓碑。
      // 阳性对照在下一条：同样这张表里活着的那条必须还在（否则"0 条墓碑"
      // 可能只是搜索整体坏了）。
      expect(searchTasks(rows, '周报').map((t) => t.id)).toEqual(['alive']);
    });

    it('🔴 空查询（"返回全部"那条分支）同样不返回墓碑', () => {
      // 这是**第二个**可以单独漏掉的点：只在 filter 里加条件，
      // 早退的 `return [...tasks]` 仍然会整张表交出去。
      expect(searchTasks(rows, '').map((t) => t.id)).toEqual(['alive']);
      expect(searchTasks(rows, '   ').map((t) => t.id)).toEqual(['alive']);
    });

    it('已完成（不是删除）的任务仍然搜得到 —— 别把两种隐藏混成一个条件', () => {
      expect(
        searchTasks(
          [task({ id: 'done', title: '周报', completedAt: 5 }), task({ id: 'gone', title: '周报', deletedAt: 7 })],
          '周报',
        ).map((t) => t.id),
      ).toEqual(['done']);
    });
  });
});

describe('haystackOf', () => {
  it('只摊平 title 与 note，且**都转小写**', () => {
    expect(haystackOf({ title: 'Report', note: 'Weekly' })).toBe('report\nweekly');
    expect(haystackOf({ title: 'Report' })).toBe('report\n');
  });
});

/**
 * 便签搜索 —— **"我记得写过一句话，在哪？"**
 * ==============================================
 *
 * 🔴 这一组存在的理由：便签**没有 `title`**（正文在 `content`），所以
 * 不能把 `Note` 直接传给 `matchesQuery`。在它之前，"按内容找一条便签"
 * 在两个宿主里都**没有任何入口** —— 而那不是"少一个按钮"，
 * 是那一整类查询做不到。
 *
 * ⚠️ 这里断言的是**匹配语义**（AND、大小写、空查询）；
 * "宿主真的把结果画出来了"由 `apps/web/tests/search-panel.spec.tsx` 钉。
 */
function note(over: Partial<Note> & { id: string }): Note {
  return {
    createdAt: 0,
    updatedAt: 0,
    isPinnedToToday: false,
    content: '',
    ...over,
  };
}

describe('searchNotes', () => {
  it('按 `content` 匹配（便签没有 title）', () => {
    const notes = [note({ id: 'a', content: '买咖啡豆' }), note({ id: 'b', content: '季度复盘' })];
    expect(searchNotes(notes, '咖啡').map((n) => n.id)).toEqual(['a']);
  });

  it('多词是 AND —— 与 `searchTasks` 同一套语义（只有一处定义）', () => {
    const notes = [
      note({ id: 'a', content: '写 周报 的素材' }),
      note({ id: 'b', content: '写 月报 的素材' }),
    ];
    expect(searchNotes(notes, '写 周报').map((n) => n.id)).toEqual(['a']);
  });

  it('大小写不敏感', () => {
    expect(searchNotes([note({ id: 'a', content: 'Weekly Report' })], 'weekly').map((n) => n.id))
      .toEqual(['a']);
  });

  it('🔴 空查询返回**全部**（与 `searchTasks` 同一条契约）', () => {
    // 契约统一很重要：让调用方各判各的空，漏写的那一处会表现成
    // "清空搜索框之后列表空了"。
    const notes = [note({ id: 'a' }), note({ id: 'b' })];
    expect(searchNotes(notes, '').map((n) => n.id)).toEqual(['a', 'b']);
    expect(searchNotes(notes, '   ').map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('顺序不动（排序是调用方的事）', () => {
    const notes = [note({ id: 'b', content: '周报' }), note({ id: 'a', content: '周报草稿' })];
    expect(searchNotes(notes, '周报').map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('noteSearchText', () => {
  it('把 `content` 放进 `title` 位 —— `SearchableText.title` 的语义是"主要文本"，不是"标题"', () => {
    // 这条注释很重要：不写明的话，下一个人看到 `{ title: note.content }`
    // 会以为这是个 bug（"便签哪来的 title？"）。
    expect(noteSearchText(note({ id: 'a', content: '正文在这里' }))).toEqual({
      title: '正文在这里',
    });
  });
});
