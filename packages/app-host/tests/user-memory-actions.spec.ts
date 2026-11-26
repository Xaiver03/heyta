import { describe, expect, it } from 'vitest';

import type { UserMemory } from '@heyta/domain';

import type { ActionContext } from '../src/actions.js';
import {
  captureInferredMemories,
  captureStatedMemory,
  createUserMemoryActions,
} from '../src/user-memory-actions.js';

interface FakeState {
  userMemories: Record<string, UserMemory>;
}

/**
 * 假上下文：真的把 Create/Update 合并进状态。
 *
 * 不用「只记 intent」的假上下文 —— 幂等、确认、忘记三条都依赖
 * `getState()` 读到上一笔；只记 intent 的假上下文会让它们全变成假绿。
 */
function fakeCtx(seed: Record<string, UserMemory> = {}): {
  ctx: ActionContext;
  intents: unknown[];
  state: FakeState;
} {
  const state: FakeState = { userMemories: { ...seed } };
  const intents: unknown[] = [];
  const now = 1_800_000_000_000;
  return {
    state,
    intents,
    ctx: {
      dispatch: (intent) => {
        intents.push(intent);
        const op = intent as {
          entityType: string;
          entityId: string;
          opType: string;
          payload: Record<string, unknown>;
        };
        if (op.entityType !== 'USER_MEMORY') return Promise.resolve(undefined);
        if (op.opType === 'CRT') {
          state.userMemories[op.entityId] = {
            id: op.entityId,
            createdAt: now,
            updatedAt: now,
            ...op.payload,
          } as UserMemory;
        } else if (op.opType === 'UPD') {
          const prev = state.userMemories[op.entityId];
          if (prev !== undefined) {
            state.userMemories[op.entityId] = { ...prev, ...op.payload, updatedAt: now };
          }
        } else if (op.opType === 'DEL') {
          delete state.userMemories[op.entityId];
        }
        return Promise.resolve(undefined);
      },
      getState: () => state as never,
    },
  };
}

const memory = (over: Partial<UserMemory> = {}): UserMemory => ({
  id: 'm1',
  kind: 'preference',
  topicKey: '回答风格',
  text: '回答先给结论',
  origin: 'stated',
  status: 'active',
  importance: 3,
  scope: 'global',
  textHash: 'hash',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('新增陈述记忆', () => {
  it('写 USER_MEMORY 创建 op，风格句落成 preference', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'a1' });
    const id = await actions.add({ kind: 'preference', text: '回答先给结论' });

    expect(id).toBe('a1');
    expect(intents[0]).toMatchObject({
      entityType: 'USER_MEMORY',
      entityId: 'a1',
      opType: 'CRT',
      payload: {
        kind: 'preference',
        text: '回答先给结论',
        status: 'active',
        origin: 'stated',
        scope: 'global',
      },
    });
  });

  it('推断（extracted）一律先落 pending', async () => {
    const { ctx, state } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'a2' });
    await actions.add({ kind: 'fact', text: '主力设备是 Mac', origin: 'extracted' });
    expect(state.userMemories.a2?.status).toBe('pending');
  });

  it('同 kind + topic + 文本指纹幂等：返回旧 id，不写第二条 op', async () => {
    const { ctx, intents, state } = fakeCtx({
      a1: memory({ id: 'a1', text: '回答先给结论', topicKey: '回答风格' }),
    });
    const actions = createUserMemoryActions(ctx, { newId: () => 'a9' });
    const id = await actions.add({ kind: 'preference', text: '回答先给结论' });
    expect(id).toBe('a1');
    expect(intents).toHaveLength(0);
    expect(Object.keys(state.userMemories)).toHaveLength(1);
  });

  it('空文本与敏感内容都拒绝，且不写 op', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    await expect(actions.add({ kind: 'preference', text: '   ' })).rejects.toThrow();
    await expect(actions.add({ kind: 'fact', text: '我的密码是 abc123' })).rejects.toThrow();
    expect(intents).toHaveLength(0);
  });

  it('超长正文截到 300 字符', async () => {
    const { ctx, state } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'a3' });
    await actions.add({ kind: 'fact', text: '字'.repeat(400) });
    expect([...(state.userMemories.a3?.text ?? '')]).toHaveLength(300);
  });
});

describe('修改 / 忘记 / 确认', () => {
  it('改正文会重算 topicKey 与指纹，并把来源标成 manual', async () => {
    const { ctx, state } = fakeCtx({ a1: memory() });
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    await actions.update('a1', { text: '回答要详细展开' });
    expect(state.userMemories.a1?.text).toBe('回答要详细展开');
    expect(state.userMemories.a1?.origin).toBe('manual');
    expect(state.userMemories.a1?.textHash).not.toBe('hash');
  });

  it('忘记：清空正文、留指纹、状态 forgotten；重复忘记不再写 op', async () => {
    const { ctx, intents, state } = fakeCtx({ a1: memory() });
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    await actions.forget('a1');
    expect(state.userMemories.a1?.status).toBe('forgotten');
    expect(state.userMemories.a1?.text).toBe('');
    expect(state.userMemories.a1?.textHash).not.toBe('');
    const before = intents.length;
    await actions.forget('a1');
    expect(intents).toHaveLength(before);
  });

  it('确认 pending → active；非 pending 是空操作', async () => {
    const { ctx, intents, state } = fakeCtx({
      p1: memory({ id: 'p1', status: 'pending', origin: 'extracted' }),
      a1: memory({ id: 'a1', status: 'active' }),
    });
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    await actions.confirm('p1');
    expect(state.userMemories.p1?.status).toBe('active');
    const before = intents.length;
    await actions.confirm('a1');
    expect(intents).toHaveLength(before);
  });

  it('找不到条目时抛错（不静默）', async () => {
    const { ctx } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    await expect(actions.forget('nope')).rejects.toThrow();
    await expect(actions.confirm('nope')).rejects.toThrow();
  });
});

describe('明说捕获', () => {
  it('「记住：…」→ 写一条 preference', async () => {
    const { ctx, state } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 's1' });
    const id = await captureStatedMemory(actions, '记住：以后回答先给结论，别铺垫');
    expect(id).toBe('s1');
    expect(state.userMemories.s1?.kind).toBe('preference');
    expect(state.userMemories.s1?.text).toBe('以后回答先给结论，别铺垫');
  });

  it('不是明说句式 → null，零写入', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    expect(await captureStatedMemory(actions, '今天有什么任务？')).toBeNull();
    expect(intents).toHaveLength(0);
  });

  it('敏感内容 → null，零写入', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    expect(await captureStatedMemory(actions, '记住：我的银行卡号是 6222')).toBeNull();
    expect(intents).toHaveLength(0);
  });
});

describe('规则推断捕获（M9）', () => {
  it('陈述句 → 落 pending，不直接进 prompt', async () => {
    const { ctx, state } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'i1' });
    const ids = await captureInferredMemories(actions, '我通常晚上写代码。');
    expect(ids).toEqual(['i1']);
    expect(state.userMemories.i1).toMatchObject({
      kind: 'preference',
      status: 'pending',
      origin: 'extracted',
    });
  });

  it('同一句再说一遍：幂等，不新增', async () => {
    const { ctx, state } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'i1' });
    await captureInferredMemories(actions, '我通常晚上写代码。');
    const again = await captureInferredMemories(actions, '我通常晚上写代码。');
    expect(again).toEqual(['i1']);
    expect(Object.keys(state.userMemories)).toHaveLength(1);
  });

  it('问句与敏感句零写入', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createUserMemoryActions(ctx, { newId: () => 'x' });
    expect(await captureInferredMemories(actions, '我喜欢这个吗？')).toEqual([]);
    expect(await captureInferredMemories(actions, '我的密码是 abc123')).toEqual([]);
    expect(intents).toHaveLength(0);
  });
});
