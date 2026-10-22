/**
 * 共享清单存量发布（ADR-0068 裁决三）的判据
 * ==========================================
 *
 * | 判据 | 坏法（症状） |
 * |---|---|
 * | 存量任务/便签逐条发一条 `Create` | 不发 ⇒ 成员看到空清单，而作者之后的一次编辑会在对面物化出**只有那一个字段**的残条目 |
 * | 已在册的跳过 | 重发 ⇒ 同一 id 在两本日志里各有历史，成员侧一次幂等重放变成"又覆盖一遍"，`remaining` 也再不可信 |
 * | 墓碑与彻底删除的不发 | 发 ⇒ 成员的本机清单里凭空出现回收站条目 |
 * | 只发这一条清单名下的 | 全库发 ⇒ 把个人清单的内容交给这份共享的密钥，那是对外泄密，不是发布 |
 * | 本机没有清单行 ⇒ 零发布 | 猜一条 ⇒ 往一份本机并不在册的 share 里写 |
 * | 中途失败要报"发了几条、剩几条"，且**不继续** | 继续 ⇒ 一次点击撞 N 次网络超时；静默 ⇒ 用户以为共享好了，对面只拿到半份 |
 * | 发布复用**路由**派发器 | 自己拼 share 调用 ⇒ 标签补发（0067 补一）这条职责被绕过，成员侧解不出标签名 |
 *
 * 变异验证（一次性臂，2026-10-22 实测后已还原，`diff -q` 逐臂确认；登记见 `research/tools/mutation-rigs/`）：
 * ① 摘掉 `alreadyInShare` 那三行 ⇒ **2 枚**红（幂等那两条）；
 * ② 把 `entity.projectId !== rowId` 的 continue 摘掉 ⇒ **4 枚**红
 *    （"只发这一条清单名下的"本身 + 三条被多发明细带偏的计数/清单）；
 * ③ 把 `catch` 里的 `throw` 换成"吞掉继续"⇒ **3 枚**红（失败报告三条，含通道未装那一形）；
 * ④ 把 `fieldsOf` 改成整条返回（含 id）⇒ **恰好 1 枚**红（payload 那一条）。
 */
import { describe, expect, it } from 'vitest';

import { emptyState, type MaterializedState, type OpIntent } from '@heyta/op-log';

import {
  publishSharedListContents,
  SharePublishIncompleteError,
  type SharePublishPorts,
} from '../src/share-publish.js';
import {
  createShareRoutingDispatcher,
  ShareChannelUnavailableError,
  type ShareWriteChannel,
} from '../src/share-routing.js';

const SHARED = 'share-1';

type Row = Record<string, unknown>;

/** 一条共享清单（3 条存量：2 活 + 1 墓碑）+ 一条个人清单 + 另一份共享清单。 */
function personal(shareStateTasks: Row = {}): { state: MaterializedState; share: MaterializedState } {
  const state = emptyState();
  Object.assign(state.projects as object, {
    pShared: { id: 'pShared', name: '装修', shareId: SHARED, createdAt: 1, updatedAt: 1 },
    pPersonal: { id: 'pPersonal', name: '私人', createdAt: 1, updatedAt: 1 },
    pOther: { id: 'pOther', name: '另一份共享', shareId: 'share-2', createdAt: 1, updatedAt: 1 },
  });
  Object.assign(state.tasks as object, {
    tB: { id: 'tB', title: '买漆', projectId: 'pShared', createdAt: 1, updatedAt: 1, tagIds: ['tagUrgent'] },
    tA: { id: 'tA', title: '量房', projectId: 'pShared', createdAt: 1, updatedAt: 1 },
    tGone: { id: 'tGone', title: '删掉的', projectId: 'pShared', deletedAt: 9, createdAt: 1, updatedAt: 1 },
    tPersonal: { id: 'tPersonal', title: '看牙', projectId: 'pPersonal', createdAt: 1, updatedAt: 1 },
    tOtherShare: { id: 'tOtherShare', title: '另一份的', projectId: 'pOther', createdAt: 1, updatedAt: 1 },
  });
  Object.assign(state.notes as object, {
    nA: { id: 'nA', text: '预算', projectId: 'pShared', createdAt: 1, updatedAt: 1 },
  });
  Object.assign(state.tags as object, {
    tagUrgent: { id: 'tagUrgent', name: '急', createdAt: 1, updatedAt: 1 },
  });

  const share = emptyState();
  Object.assign(share.tasks as object, shareStateTasks);
  return { state, share };
}

function contentIds(
  calls: readonly { shareId: string; intent: { entityType: string; entityId: string; opType: string } }[],
): string[] {
  return calls.filter((c) => c.intent.entityType !== 'TAG').map((c) => c.intent.entityId).sort();
}

function portsFor(
  fixture: { state: MaterializedState; share: MaterializedState },
  opts: { failOn?: string; channel?: boolean } = {},
): {
  ports: SharePublishPorts;
  intents: OpIntent[];
  shareIntents: { shareId: string; intent: { entityType: string; entityId: string; opType: string } }[];
} {
  const intents: OpIntent[] = [];
  const shareIntents: { shareId: string; intent: { entityType: string; entityId: string; opType: string } }[] = [];
  const channel: ShareWriteChannel | undefined = opts.channel === false
    ? undefined
    : {
      dispatch: async (shareId, intent) => { shareIntents.push({ shareId, intent }); },
      stateFor: () => fixture.share,
    };
  const dispatch = createShareRoutingDispatcher({
    personalDispatch: async (intent) => { intents.push(intent); },
    channel: () => channel,
    getState: () => fixture.state,
  });
  const ports: SharePublishPorts = {
    getState: () => fixture.state,
    stateFor: () => fixture.share,
    dispatch: async (intent) => {
      if (opts.failOn !== undefined && intent.entityId === opts.failOn) throw new Error('离线');
      await dispatch(intent);
    },
  };
  return { ports, intents, shareIntents };
}

describe('存量逐条发一条 Create', () => {
  it('两条活任务 + 一条便签 ⇒ 三条都发，墓碑/个人/另一份共享的一条都不发', async () => {
    const { ports, shareIntents } = portsFor(personal());
    const report = await publishSharedListContents(SHARED, ports);
    expect(report.published).toBe(3);
    // 标签那条是路由补发的（下一条用例专门钉它），这里只看清单条目。
    expect(contentIds(shareIntents)).toEqual(['nA', 'tA', 'tB']);
    expect(shareIntents.every((c) => c.intent.opType === 'CRT')).toBe(true);
    expect(report.remaining).toBe(0);
  });

  it('payload 是这条实体的字段但**不含 id**（身份由 entityId 走线）', async () => {
    const { ports, shareIntents } = portsFor(personal());
    await publishSharedListContents(SHARED, ports);
    const tA = shareIntents.find((c) => c.intent.entityId === 'tA');
    expect(Object.keys(tA!.intent.payload as object)).not.toContain('id');
    expect((tA!.intent.payload as { title: string }).title).toBe('量房');
    expect((tA!.intent.payload as { projectId: string }).projectId).toBe('pShared');
  });

  it('发布走的是**路由**派发器 ⇒ 任务引用的标签自动补发（0067 补一不被绕过）', async () => {
    const { ports, shareIntents } = portsFor(personal());
    await publishSharedListContents(SHARED, ports);
    const tags = shareIntents.filter((c) => c.intent.entityType === 'TAG');
    expect(tags.map((c) => c.intent.entityId)).toEqual(['tagUrgent']);
  });
});

describe('幂等：已在册的不重发', () => {
  it('share 里已经有 tA ⇒ 只发 tB / nA，skipped 记 1', async () => {
    const fixture = personal({ tA: { id: 'tA', title: '量房（已在册）', projectId: 'pX' } });
    const { ports, shareIntents } = portsFor(fixture);
    const report = await publishSharedListContents(SHARED, ports);
    expect(report.skipped).toBe(1);
    expect(contentIds(shareIntents)).toEqual(['nA', 'tB']);
  });

  it('可重复调用：第二次一条都不发（补发布与首次发布共用同一条判据）', async () => {
    const fixture = personal();
    const { ports } = portsFor(fixture);
    const first = await publishSharedListContents(SHARED, ports);
    expect(first.published).toBe(3);
    // 把第一次发出去的落成"已在册"，模拟 share 状态被这次发布喂满。
    Object.assign(fixture.share.tasks as object, {
      tA: { id: 'tA', title: '量房', projectId: 'pShared' },
      tB: { id: 'tB', title: '买漆', projectId: 'pShared' },
    });
    Object.assign(fixture.share.notes as object, { nA: { id: 'nA', text: '预算', projectId: 'pShared' } });
    const second = await publishSharedListContents(SHARED, ports);
    expect(second.published).toBe(0);
    expect(second.skipped).toBe(3);
  });
});

describe('本机没有这一行 ⇒ 一条都不发', () => {
  it('未知 shareId ⇒ 全零，且不碰派发器', async () => {
    const { ports, shareIntents } = portsFor(personal());
    const report = await publishSharedListContents('share-nope', ports);
    expect(report).toEqual({ shareId: 'share-nope', published: 0, skipped: 0, remaining: 0 });
    expect(shareIntents).toHaveLength(0);
  });
});

describe('通道没装上 ⇒ 一条都不发（不退回个人 log）', () => {
  it('抛 ShareChannelUnavailableError，个人侧零调用', async () => {
    const { ports, intents, shareIntents } = portsFor(personal(), { channel: false });
    const error = await publishSharedListContents(SHARED, ports).catch((e: unknown) => e);
    // 抛的是发布的具名错误（一条都没发出去），但**原因不能被包丢**：
    // 界面对"没登录/没解锁"与"网络断了"要说不同的话。
    expect(error).toBeInstanceOf(SharePublishIncompleteError);
    expect((error as SharePublishIncompleteError).cause).toBeInstanceOf(ShareChannelUnavailableError);
    expect((error as SharePublishIncompleteError).report.published).toBe(0);
    expect(intents).toHaveLength(0);
    expect(shareIntents).toHaveLength(0);
  });
});

describe('中途失败要能说出"发了几条、剩几条"', () => {
  it('第二条失败 ⇒ 抛具名错误，report 里 published=1 / remaining=2，第三条不再尝试', async () => {
    const { ports, shareIntents } = portsFor(personal(), { failOn: 'tA' });
    const error = await publishSharedListContents(SHARED, ports).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharePublishIncompleteError);
    const report = (error as SharePublishIncompleteError).report;
    expect(report.published).toBe(1);
    expect(report.remaining).toBe(2);
    expect(report.failedEntityId).toBe('tA');
    // 只试到 tA 就停：nA 是成功的那一条，tB 根本没再试（否则一次点击等于 N 次超时）。
    expect(contentIds(shareIntents)).toEqual(['nA']);
  });

  it('原始错误挂在 `cause` 上（界面要能区分"离线"与"服务端按 role 拒了"）', async () => {
    const { ports } = portsFor(personal(), { failOn: 'tA' });
    const error = await publishSharedListContents(SHARED, ports).catch((e: unknown) => e);
    expect((error as SharePublishIncompleteError).cause).toBeInstanceOf(Error);
    expect(((error as SharePublishIncompleteError).cause as Error).message).toBe('离线');
  });
});

describe('顺序确定（id 字典序）', () => {
  it('同一次发布内的 entityId 是排好序的，失败报告的"剩几条"才可复现', async () => {
    const { ports, shareIntents } = portsFor(personal());
    await publishSharedListContents(SHARED, ports);
    const ids = shareIntents.filter((c) => c.intent.entityType !== 'TAG').map((c) => c.intent.entityId);
    expect(ids).toEqual([...ids].sort());
  });
});
