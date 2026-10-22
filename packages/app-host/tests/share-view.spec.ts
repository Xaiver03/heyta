/**
 * 共享清单读侧合并（ADR-0068 裁决二）的判据
 * ==========================================
 *
 * 这批用例钉的是合并视图**坏得掉的方式**，不是"函数会跑"：
 *
 * | 判据 | 坏法（症状） |
 * |---|---|
 * | 共享任务/便签并进视图且 `projectId` 落到本机那一行 | 不落 ⇒ 对方的任务全挤进「未归属」，共享清单看着是空的 |
 * | 同 id 时 **share 侧覆盖个人侧** | 方向反了 ⇒ 成员刚改的那一下被本机那份冻结副本擦掉（界面上"改动又没了"） |
 * | 没发布的存量条目不许从界面上消失 | 拿 share 侧当全集 ⇒ 共享一条已有 30 条的清单，作者自己立刻只看得到发布过的那几条 |
 * | 本机没有清单行 ⇒ 这份共享不可见 | 硬并 ⇒ 内容落进未归属，等于绕过"取消共享"这个动作 |
 * | 清单记录本身不合并 | 并 ⇒ 别人给这份共享起的名字盖掉我这一行（ADR-0068 裁决一） |
 * | 标签只并被引用的、同 id 以本机词表为准 | 整桶并 ⇒ 个人标签管理面凭空长出别人的标签 |
 * | 提醒不合并 | 并 ⇒ 别人的一次重复完成改写我的下一次提醒 |
 * | 缓存按引用相等 | 没有缓存 ⇒ 每次读都复制整张任务表（几千条时界面开始卡，判据全绿） |
 *
 * 变异验证（一次性臂，2026-10-22 实测后已还原，`diff -q` 逐臂确认；登记见 `research/tools/mutation-rigs/`）：
 * ① 摘掉 `applyShareState` 里 tasks 那一行赋值 ⇒ **4 枚**具名红（覆盖那三条 + 缓存里"换引用要重算"那条）；
 * ② 把 `rehome` 改成原样返回 ⇒ **恰好 2 枚**（落点那两条），其余绿；
 * ③ 摘掉 `if (personalTags[id] !== undefined) continue;` ⇒ **恰好 1 枚**（同 id 以本机词表为准）；
 * ④ 摘掉缓存里 `lastPersonal === personal` 这个条件 ⇒ **恰好 1 枚**（"个人状态换引用也重算"）。
 *    ⚠️ 我原本预测这一臂红的是"同一引用返回同一对象"那条 —— 实测是**反过来的那一条**：
 *    去掉条件等于"永远相信缓存"，坏掉的是"该重算时没重算"，不是"该复用时没复用"。
 *    预测错要说出来：那条预测如果照抄进台账，下一个会话会以为缓存失效是"多算了一次"，
 *    而真实症状是**端出旧的合并结果**（那才是危险的形状）。
 */
import { describe, expect, it } from 'vitest';

import { emptyState, type MaterializedState } from '@heyta/op-log';

import {
  createShareViewMerger,
  localRowIdForShare,
  mergeShareView,
  shareIdsOnDevice,
  type ShareStateReader,
} from '../src/share-view.js';

const SHARED = 'share-1';
const OTHER = 'share-2';

/** 本机状态：一条共享清单（`pShared`）+ 一条个人清单 + 各自的任务与两枚标签。 */
function personal(): MaterializedState {
  const state = emptyState();
  Object.assign(state.projects as object, {
    pShared: { id: 'pShared', name: '装修（我的名字）', shareId: SHARED },
    pPersonal: { id: 'pPersonal', name: '私人' },
  });
  Object.assign(state.tasks as object, {
    // 共享清单里**绑定那一刻的冻结副本**：标题是发布前的旧值。
    tShared: { id: 'tShared', title: '买漆（旧）', projectId: 'pShared' },
    // 共享清单里**没发布过**的一条（症状列第三行讲的就是它）。
    tUnpublished: { id: 'tUnpublished', title: '存量没发布', projectId: 'pShared' },
    tPersonal: { id: 'tPersonal', title: '看牙', projectId: 'pPersonal' },
  });
  Object.assign(state.tags as object, {
    tagMine: { id: 'tagMine', name: '我的急' },
    tagUnused: { id: 'tagUnused', name: '没被引用' },
  });
  Object.assign(state.reminders as object, {
    rMine: { id: 'rMine', taskId: 'tShared', triggerAt: 1_700_000_000_000 },
  });
  return state;
}

/** 那份共享日志重放出来的状态：别人的改动 + 对方新加的一条任务 + 对方的标签与提醒。 */
function shareState(): MaterializedState {
  const state = emptyState();
  // 作者本机那条清单记录（id 与本机不同：ADR-0068 事实 2）。它**不该**被并进来。
  Object.assign(state.projects as object, {
    pAuthorsRow: { id: 'pAuthorsRow', name: 'Renovation（作者起的名）', shareId: SHARED },
  });
  Object.assign(state.tasks as object, {
    // 同 id、新值 ⇒ 这一条要盖住个人侧那份冻结副本。projectId 是**作者本机**的 id。
    tShared: { id: 'tShared', title: '买漆（成员刚改的）', projectId: 'pAuthorsRow' },
    // 成员新建的一条，本机个人 log 里根本没有。
    tTheirs: { id: 'tTheirs', title: '买刷子', projectId: 'pAuthorsRow', tagIds: ['tagTheirs', 'tagMine'] },
    // 墓碑：对方删掉了一条已发布的任务。
    tGone: { id: 'tGone', title: '删掉的', projectId: 'pAuthorsRow', deletedAt: 1 },
  });
  Object.assign(state.notes as object, {
    nTheirs: { id: 'nTheirs', text: '对方的便签', projectId: 'pAuthorsRow' },
  });
  Object.assign(state.tags as object, {
    tagTheirs: { id: 'tagTheirs', name: '急（对方的）' },
    tagMine: { id: 'tagMine', name: '我的急（发布时那份）' },
    tagOrphan: { id: 'tagOrphan', name: '这份共享里没人引用' },
  });
  Object.assign(state.comments as object, {
    cTheirs: { id: 'cTheirs', taskId: 'tShared', text: '这句只有 share log 里有' },
  });
  Object.assign(state.reminders as object, {
    rTheirs: { id: 'rTheirs', taskId: 'tShared', triggerAt: 2 },
  });
  return state;
}

function readerFor(shares: Record<string, MaterializedState>): ShareStateReader {
  return { stateFor: (shareId) => shares[shareId] ?? emptyState() };
}

const reader = readerFor({ [SHARED]: shareState() });

describe('在册 shareId 的取法（读侧的判据必须与写侧同一枚字段）', () => {
  it('个人状态里挂了 shareId 的清单行 ⇒ 排序确定的全集；空串与墓碑行都剔掉', () => {
    const state = personal();
    Object.assign(state.projects as object, {
      pOther: { id: 'pOther', name: '另一份', shareId: OTHER },
      pBlank: { id: 'pBlank', name: '空串', shareId: '  ' },
      pGone: { id: 'pGone', name: '已删', shareId: OTHER, deletedAt: 9 },
    });
    expect(shareIdsOnDevice(state)).toEqual([SHARED, OTHER]);
  });

  it('一条 shareId 挂了两行 ⇒ 取 id 最小的那行（两台设备必须渲染成同一个分组）', () => {
    const state = personal();
    Object.assign(state.projects as object, { aDup: { id: 'aDup', name: '重复行', shareId: SHARED } });
    expect(localRowIdForShare(state, SHARED)).toBe('aDup');
  });

  it('本机没有清单行挂它 ⇒ undefined', () => {
    expect(localRowIdForShare(personal(), 'share-nope')).toBeUndefined();
  });
});

describe('共享内容并进视图', () => {
  it('成员改的标题在本机可见，且落回本机那一行（不是作者的 projectId）', () => {
    const merged = mergeShareView(personal(), reader);
    const task = merged.tasks['tShared'] as { title: string; projectId: string };
    expect(task.title).toBe('买漆（成员刚改的）');
    expect(task.projectId).toBe('pShared');
  });

  it('成员新建的任务/便签并进视图，`projectId` 同样重定位到本机那一行', () => {
    const merged = mergeShareView(personal(), reader);
    expect((merged.tasks['tTheirs'] as { title: string; projectId: string }).projectId).toBe('pShared');
    expect((merged.notes['nTheirs'] as { projectId: string }).projectId).toBe('pShared');
  });

  it('成员的墓碑也覆盖本机那一份（共享内容里删了就是删了，界面上不许还留着）', () => {
    const merged = mergeShareView(personal(), reader);
    expect((merged.tasks['tGone'] as { deletedAt?: number }).deletedAt).toBe(1);
  });

  it('评论并进视图 —— 个人 log 里从来不会有 COMMENT，不并就永远看不见', () => {
    const merged = mergeShareView(personal(), reader);
    expect(Object.keys(merged.comments)).toContain('cTheirs');
  });

  it('个人清单的任务不受这份共享影响（不同 id 不覆盖、projectId 不动）', () => {
    const merged = mergeShareView(personal(), reader);
    expect((merged.tasks['tPersonal'] as { projectId: string }).projectId).toBe('pPersonal');
  });
});

describe('不许从界面上消失的那一格：未发布的存量条目', () => {
  it('share 状态里没有这条 ⇒ 个人那份照旧可见（共享一条已有内容的清单不会把没发布的条目藏起来）', () => {
    const merged = mergeShareView(personal(), reader);
    expect(Object.keys(merged.tasks)).toContain('tUnpublished');
  });
});

describe('清单这条记录本身不合并（ADR-0068 裁决一）', () => {
  it('share 状态里那条作者的本机行，既不并进视图也不覆盖我这一行的名字', () => {
    const merged = mergeShareView(personal(), reader);
    expect(merged.projects['pAuthorsRow']).toBeUndefined();
    expect((merged.projects['pShared'] as { name: string }).name).toBe('装修（我的名字）');
  });

  it('提醒不合并：别人那份提醒改写不了本机的提醒（服务端可写词表里就没有 REMINDER）', () => {
    const merged = mergeShareView(personal(), reader);
    expect(merged.reminders['rTheirs']).toBeUndefined();
    expect(Object.keys(merged.reminders)).toEqual(['rMine']);
  });
});

describe('标签：只并被引用的，同 id 以本机词表为准', () => {
  it('被这份共享的任务引用到、本机没有的名字 ⇒ 补进来（不然渲染成一枚解不出名字的空白标签）', () => {
    const merged = mergeShareView(personal(), reader);
    expect((merged.tags['tagTheirs'] as { name: string }).name).toBe('急（对方的）');
  });

  it('同 id 时保留本机的名字（个人词表是权威，本机后来改过名不该被共享里那份旧的盖掉）', () => {
    const merged = mergeShareView(personal(), reader);
    expect((merged.tags['tagMine'] as { name: string }).name).toBe('我的急');
  });

  it('这份共享里没人引用的标签 ⇒ 不进本机词表（个人标签管理面不许凭空长别人的标签）', () => {
    const merged = mergeShareView(personal(), reader);
    expect(merged.tags['tagOrphan']).toBeUndefined();
  });
});

describe('没有共享在册 ⇒ 零开销、零改写', () => {
  it('返回个人状态**那一个对象**（不是复制）', () => {
    const state = personal();
    Object.assign(state.projects as object, { pShared: { id: 'pShared', name: '装修' } }); // 解绑
    expect(mergeShareView(state, reader)).toBe(state);
  });

  it('那份共享**还没拉到本地**（空状态）⇒ 一条本机条目都不许丢', () => {
    const state = personal();
    const merged = mergeShareView(state, readerFor({}));
    expect(Object.keys(merged.tasks).sort()).toEqual(Object.keys(state.tasks).sort());
    expect(Object.keys(merged.tags).sort()).toEqual(Object.keys(state.tags).sort());
    expect(Object.keys(merged.comments)).toHaveLength(0);
  });

  it('本机解绑（清单行还在、`shareId` 没了）⇒ 共享内容从视图里消失，本机条目全部留下', () => {
    const state = personal();
    Object.assign(state.projects as object, { pShared: { id: 'pShared', name: '装修（我的名字）' } });
    const merged = mergeShareView(state, reader);
    expect(merged.tasks['tTheirs']).toBeUndefined();
    expect(merged.comments['cTheirs']).toBeUndefined();
    expect(merged.tags['tagTheirs']).toBeUndefined();
    expect(Object.keys(merged.tasks)).toHaveLength(3);
    expect((merged.tasks['tShared'] as { title: string }).title).toBe('买漆（旧）');
  });
});

describe('缓存（判据是"重复读不重算"，不是"读得出来"）', () => {
  it('同一个个人状态、同一份共享状态 ⇒ 返回同一个合并对象', () => {
    const merger = createShareViewMerger(reader);
    const state = personal();
    expect(merger(state)).toBe(merger(state));
  });

  it('共享状态换了引用（一次 pull 落盘）⇒ 必须重算，不许把旧合并结果端出来', () => {
    // reader 每次返回"当前那一份"，模拟宿主缓存被一次拉取覆盖：引用变、id 不变。
    let current = shareState();
    const merger = createShareViewMerger({ stateFor: () => current });
    const state = personal();
    expect((merger(state).tasks['tShared'] as { title: string }).title).toBe('买漆（成员刚改的）');

    const fresh = shareState();
    Object.assign(fresh.tasks as object, {
      tShared: { id: 'tShared', title: '买漆（第三次改）', projectId: 'pAuthorsRow' },
    });
    current = fresh;
    expect((merger(state).tasks['tShared'] as { title: string }).title).toBe('买漆（第三次改）');
  });

  it('个人状态换了引用（本机一次写） ⇒ 也重算', () => {
    const merger = createShareViewMerger(reader);
    const a = personal();
    const b = personal();
    expect(merger(a)).not.toBe(merger(b));
  });
});
