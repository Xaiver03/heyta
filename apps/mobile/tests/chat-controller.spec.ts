import { beforeEach, describe, expect, it, vi } from 'vitest';

const appHostMocks = vi.hoisted(() => ({
  requestAssistantTurn: vi.fn(),
  confirmAiToolProposal: vi.fn(),
}));

vi.mock('@heyta/app-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@heyta/app-host')>();
  return {
    ...actual,
    requestAssistantTurn: appHostMocks.requestAssistantTurn,
    confirmAiToolProposal: appHostMocks.confirmAiToolProposal,
  };
});

import {
  ASSISTANT_HISTORY_STORAGE_KEY,
  defaultAiSettingsState,
  saveAssistantHistory,
  type AiSettingsState,
  type AssistantOutcome,
  type ChatItem,
  type HistoryStorage,
} from '@heyta/app-host';
import type { LocalApiHost } from '@heyta/local-api';

import {
  createChatController,
  type ChatController,
  type ChatRuntime,
} from '../src/ai/chat-controller';

function memoryStorage(): HistoryStorage & { raw: (key?: string) => string | null } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    raw: (key = ASSISTANT_HISTORY_STORAGE_KEY) => values.get(key) ?? null,
  };
}

function runtime(overrides: Partial<ChatRuntime> = {}): ChatRuntime {
  const settings: AiSettingsState = {
    ...defaultAiSettingsState(),
    assistantTier: 'read-only',
  };
  return {
    settings,
    host: {} as LocalApiHost,
    localize: (key) => key,
    secretStore: { get: async () => undefined },
    onHealth: vi.fn(),
    onTierChange: vi.fn(),
    ...overrides,
  };
}

function routedSettings(
  endpoint: string,
  assistantTier: AiSettingsState['assistantTier'],
): AiSettingsState {
  return {
    ...defaultAiSettingsState(),
    assistantTier,
    routing: {
      enabled: true,
      allowRemote: true,
      endpoints: [
        {
          id: 'assistant-endpoint',
          label: '测试端点',
          endpoint,
          model: 'test-model',
          capabilities: ['tool_calling'],
        },
      ],
      routes: { 'tool-calling': [{ endpointId: 'assistant-endpoint' }] },
    },
  };
}

function answer(text = '回答'): AssistantOutcome {
  return {
    ok: true,
    kind: 'answer',
    text,
    steps: [],
    appended: [],
    health: {},
  };
}

function proposalOutcome(): AssistantOutcome {
  return {
    ok: true,
    kind: 'proposal',
    text: '我准备创建任务：买牛奶',
    proposal: {
      ruleId: 'create-task-rule',
      tool: 'create_task',
      intent: { action: 'create-task', title: '买牛奶' },
    },
    steps: [],
    appended: [],
    health: {},
    stopsHere: true,
  };
}

function controllerWith(
  storage = memoryStorage(),
  account = 'alice@example.com',
  overrides: Partial<ChatRuntime> = {},
): ChatController {
  const controller = createChatController({ account, storage });
  controller.configure(runtime(overrides));
  return controller;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function seedDisclosed(storage: HistoryStorage, account = 'alice@example.com'): void {
  const item: ChatItem = { id: 1, role: 'user', text: '上一句' };
  saveAssistantHistory({ account, disclosed: true, items: [item] }, storage);
}

describe('移动端 Chatbot controller 行为', () => {
  beforeEach(() => {
    appHostMocks.requestAssistantTurn.mockReset();
    appHostMocks.confirmAiToolProposal.mockReset();
  });

  it('未同意披露前不请求，并且取消会恢复草稿而移除临时用户消息', () => {
    const controller = controllerWith();
    controller.setDraft('随便说点什么吧');

    controller.send();

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'disclose',
      draft: '',
      items: [{ role: 'user', text: '随便说点什么吧' }],
    });
    expect(appHostMocks.requestAssistantTurn).not.toHaveBeenCalled();

    controller.cancelDisclosure();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', draft: '随便说点什么吧', items: [] });
  });

  it('披露确认连点时只运行一次，完成后仍可发送下一轮', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    let resolve: ((value: AssistantOutcome) => void) | undefined;
    appHostMocks.requestAssistantTurn.mockImplementation(
      () => new Promise<AssistantOutcome>((done) => {
        resolve = done;
      }),
    );
    const controller = controllerWith(storage);
    controller.setDraft('第一轮请求');
    controller.send();
    controller.send();

    expect(appHostMocks.requestAssistantTurn).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('disclose');
    controller.confirmDisclosure();
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe('running');
    resolve?.(answer('第一轮完成'));
    await flush();
    expect(controller.getSnapshot().phase).toBe('idle');

    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(answer('第二轮完成'));
    controller.setDraft('第二轮请求');
    controller.send();
    await flush();
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(2);
  });

  it('本机规则命中时直接进入执行，不弹出出境披露，也不走确认写入', async () => {
    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(answer('今天有两项任务'));
    const controller = controllerWith();
    controller.setDraft('今天有什么任务');

    controller.send();

    expect(controller.getSnapshot().phase).toBe('running');
    expect(controller.getSnapshot().items).toEqual([{ id: 1, role: 'user', text: '今天有什么任务' }]);
    await flush();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(appHostMocks.confirmAiToolProposal).not.toHaveBeenCalled();
  });

  it('请求失败后 retry 只恢复原文，重新发送才发起下一次请求', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    appHostMocks.requestAssistantTurn
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(answer('重试成功'));
    const controller = controllerWith(storage);
    controller.setDraft('请重试这一句');
    controller.send();
    controller.confirmDisclosure();
    await flush();

    const failed = controller.getSnapshot().items.find((item) => item.role === 'error');
    expect(failed?.role).toBe('error');
    expect(controller.getSnapshot().phase).toBe('idle');

    controller.retry(failed!.id);
    expect(controller.getSnapshot()).toMatchObject({ draft: '请重试这一句', phase: 'idle' });
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(1);

    controller.send();
    await flush();
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().items.some((item) => item.role === 'assistant' && item.text === '重试成功')).toBe(true);
  });

  it('只读档收到提案时只展示提案，不自动确认或写入', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(proposalOutcome());
    const confirm = vi.fn();
    const controller = controllerWith(storage, 'alice@example.com', { host: { submit: confirm } as unknown as LocalApiHost });
    controller.setDraft('记一下买牛奶');
    controller.send();
    controller.confirmDisclosure();
    await flush();

    expect(controller.getSnapshot().items.some((item) => item.role === 'proposal')).toBe(true);
    expect(appHostMocks.confirmAiToolProposal).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('高风险提案确认连点只写一次，并在完成后标记 confirmed', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(proposalOutcome());
    let resolve: ((value: { ok: true; taskId: string }) => void) | undefined;
    appHostMocks.confirmAiToolProposal.mockImplementation(
      () => new Promise<{ ok: true; taskId: string }>((done) => {
        resolve = done;
      }),
    );
    const controller = controllerWith(storage, 'alice@example.com', {
      settings: { ...defaultAiSettingsState(), assistantTier: 'read-and-propose' },
    });
    controller.setDraft('记一下买牛奶');
    controller.send();
    controller.confirmDisclosure();
    await flush();
    const proposal = controller.getSnapshot().items.find((item) => item.role === 'proposal');
    expect(proposal?.role).toBe('proposal');

    controller.confirmProposal(proposal!.id);
    controller.confirmProposal(proposal!.id);
    expect(appHostMocks.confirmAiToolProposal).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe('running');

    resolve?.({ ok: true, taskId: 'task-1' });
    await flush();
    const confirmed = controller.getSnapshot().items.find((item) => item.id === proposal!.id);
    expect(confirmed?.role === 'proposal' && confirmed.confirmed).toEqual({ ok: true, taskId: 'task-1' });
    expect(controller.getSnapshot().phase).toBe('idle');
  });

  it('确认失败后保留提案，允许再次确认', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(proposalOutcome());
    appHostMocks.confirmAiToolProposal
      .mockResolvedValueOnce({ ok: false, reason: 'rejected', message: '授权已撤销' })
      .mockResolvedValueOnce({ ok: true, taskId: 'task-2' });
    const controller = controllerWith(storage, 'alice@example.com', {
      settings: { ...defaultAiSettingsState(), assistantTier: 'read-and-propose' },
    });
    controller.setDraft('记一下买牛奶');
    controller.send();
    controller.confirmDisclosure();
    await flush();
    const proposal = controller.getSnapshot().items.find((item) => item.role === 'proposal');
    expect(proposal?.role).toBe('proposal');

    controller.confirmProposal(proposal!.id);
    await flush();
    expect(controller.getSnapshot().items.find((item) => item.id === proposal!.id)).toMatchObject({
      role: 'proposal',
      confirmed: undefined,
    });
    expect(controller.getSnapshot().proposalErrors[proposal!.id]).toBe('授权已撤销');

    controller.confirmProposal(proposal!.id);
    await flush();
    expect(controller.getSnapshot().items.find((item) => item.id === proposal!.id)).toMatchObject({
      role: 'proposal',
      confirmed: { ok: true, taskId: 'task-2' },
    });
    expect(appHostMocks.confirmAiToolProposal).toHaveBeenCalledTimes(2);
  });

  it('档位设置只在 idle 时转交给宿主', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    let resolve: ((value: AssistantOutcome) => void) | undefined;
    appHostMocks.requestAssistantTurn.mockImplementation(
      () => new Promise<AssistantOutcome>((done) => {
        resolve = done;
      }),
    );
    const onTierChange = vi.fn();
    const controller = controllerWith(storage, 'alice@example.com', { onTierChange });

    controller.setTier('read-and-propose');
    expect(onTierChange).toHaveBeenCalledWith('read-and-propose');
    expect(controller.getSnapshot().disclosed).toBe(false);

    controller.setDraft('今天有什么任务');
    controller.send();
    controller.setTier('read-only');
    expect(onTierChange).toHaveBeenCalledTimes(1);
    resolve?.(answer());
    await flush();
  });

  it('切换账号时丢弃在途结果，旧请求完成后新账号仍可发起请求', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage, 'alice@example.com');
    const results: Array<(value: AssistantOutcome) => void> = [];
    let staleGetGrants: (() => Record<string, boolean> | undefined) | undefined;
    appHostMocks.requestAssistantTurn.mockImplementation(
      (_source, deps) => {
        staleGetGrants = deps.getGrants;
        return new Promise<AssistantOutcome>((resolve) => {
        results.push(resolve);
        });
      },
    );
    const controller = controllerWith(storage);
    controller.setDraft('Alice 的请求');
    controller.send();
    controller.confirmDisclosure();
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(1);

    controller.syncAccount('bob@example.com');
    expect(staleGetGrants?.()).toEqual({});
    results[0]?.(answer('不应显示给 Bob'));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ account: 'bob@example.com', items: [], phase: 'idle' });

    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(answer('Bob 的回答'));
    controller.setDraft('今天有什么任务');
    controller.send();
    await flush();
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().items.some((item) => item.role === 'assistant' && item.text === '不应显示给 Bob')).toBe(false);
  });

  it('新会话可重复执行，下一轮执行标识仍不会复用', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    const executionIds: string[] = [];
    appHostMocks.requestAssistantTurn.mockImplementation((_source, deps) => {
      executionIds.push((deps as { executionId: string }).executionId);
      return Promise.resolve(answer());
    });
    const controller = controllerWith(storage);
    controller.setDraft('第一轮');
    controller.send();
    controller.confirmDisclosure();
    await flush();
    controller.newSession();
    controller.newSession();
    expect(controller.getSnapshot().items).toEqual([]);
    controller.setDraft('今天有什么任务');
    controller.send();
    await flush();

    expect(executionIds).toHaveLength(2);
    expect(executionIds[0]).not.toBe(executionIds[1]);
  });

  it('切换账号只切换可见会话，原账号历史仍可恢复', () => {
    const storage = memoryStorage();
    saveAssistantHistory(
      { account: 'alice@example.com', disclosed: true, items: [{ id: 1, role: 'user', text: 'Alice 私密内容' }] },
      storage,
    );
    const controller = controllerWith(storage);

    controller.syncAccount('bob@example.com');
    expect(controller.getSnapshot()).toMatchObject({ account: 'bob@example.com', items: [], disclosed: false });
    controller.syncAccount('alice@example.com');
    expect(controller.getSnapshot()).toMatchObject({
      account: 'alice@example.com',
      items: [{ role: 'user', text: 'Alice 私密内容' }],
      disclosed: false,
    });
  });

  it('Alice 写入历史后，Bob 草稿并发送不会覆盖 Alice，切回仍能恢复 Alice', async () => {
    const storage = memoryStorage();
    appHostMocks.requestAssistantTurn
      .mockResolvedValueOnce(answer('Alice 的回答'))
      .mockResolvedValueOnce(answer('Bob 的回答'));
    const controller = controllerWith(storage, 'alice@example.com');

    controller.setDraft('Alice 的请求');
    controller.send();
    expect(controller.getSnapshot().phase).toBe('disclose');
    controller.confirmDisclosure();
    await flush();
    expect(controller.getSnapshot().items.some((item) => item.role === 'assistant' && item.text === 'Alice 的回答')).toBe(true);

    controller.syncAccount('bob@example.com');
    controller.setDraft('Bob 的私密请求');
    controller.send();
    expect(controller.getSnapshot()).toMatchObject({ account: 'bob@example.com', phase: 'disclose', draft: '' });
    controller.cancelDisclosure();
    expect(controller.getSnapshot().draft).toBe('Bob 的私密请求');
    controller.send();
    controller.confirmDisclosure();
    await flush();
    expect(controller.getSnapshot().items.some((item) => item.role === 'assistant' && item.text === 'Bob 的回答')).toBe(true);

    controller.syncAccount('alice@example.com');
    expect(controller.getSnapshot().items.some((item) => item.role === 'user' && item.text === 'Alice 的请求')).toBe(true);
    expect(controller.getSnapshot().items.some((item) => item.role === 'assistant' && item.text === 'Alice 的回答')).toBe(true);
    expect(controller.getSnapshot().items.some((item) => item.role === 'user' && item.text === 'Bob 的私密请求')).toBe(false);
    expect(appHostMocks.requestAssistantTurn).toHaveBeenCalledTimes(2);
  });

  it('configure 改变目的地或档位后，下一句必须重新披露', async () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    appHostMocks.requestAssistantTurn.mockResolvedValueOnce(answer('初始配置回答'));
    const controller = controllerWith(storage, 'alice@example.com', {
      settings: routedSettings('https://provider-a.example/v1', 'read-only'),
    });
    expect(controller.getSnapshot().disclosed).toBe(false);

    controller.setDraft('初始配置请求');
    controller.send();
    controller.confirmDisclosure();
    await flush();

    controller.configure(
      runtime({ settings: routedSettings('https://provider-b.example/v1', 'read-and-propose') }),
    );
    appHostMocks.requestAssistantTurn.mockClear();
    controller.setDraft('请帮我安排一下这周');
    controller.send();

    expect(controller.getSnapshot()).toMatchObject({ phase: 'disclose', draft: '' });
    expect(appHostMocks.requestAssistantTurn).not.toHaveBeenCalled();
  });

  it('新会话清除当前内容与本机历史', () => {
    const storage = memoryStorage();
    seedDisclosed(storage);
    const controller = controllerWith(storage);
    controller.setDraft('尚未发送');
    controller.toggleHistory();

    controller.newSession();

    expect(controller.getSnapshot()).toMatchObject({
      draft: '',
      items: [],
      disclosed: false,
      historyOpen: false,
      proposalErrors: {},
    });
    expect(storage.raw()).toBeNull();
  });
});
