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
  defaultAiSettingsState,
  type AiSettingsState,
  type AssistantOutcome,
  type HistoryStorage,
} from '@heyta/app-host';
import type { LocalApiHost } from '@heyta/local-api';

import { createChatController, type ChatController, type ChatRuntime } from '../src/ai/chat-controller';

function memoryStorage(): HistoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function runtime(): ChatRuntime {
  const settings: AiSettingsState = { ...defaultAiSettingsState() };
  return {
    settings,
    host: {} as LocalApiHost,
    localize: (key: string) => key,
    secretStore: { get: async () => undefined },
    managedTransport: async () => undefined,
    onHealth: vi.fn(),
    resolveRouting: () => settings.routing,
  } as ChatRuntime;
}

function answer(text: string): AssistantOutcome {
  return { ok: true, kind: 'answer', text, steps: [], appended: [], health: {} };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function say(controller: ChatController, text: string, reply: string): Promise<void> {
  appHostMocks.requestAssistantTurn.mockResolvedValueOnce(answer(reply));
  controller.setDraft(text);
  controller.send();
  if (controller.getSnapshot().phase === 'disclose') controller.confirmDisclosure();
  await flush();
}

describe('移动端 Chatbot 多会话', () => {
  beforeEach(() => {
    appHostMocks.requestAssistantTurn.mockReset();
    appHostMocks.confirmAiToolProposal.mockReset();
  });

  it('新会话保留上一段；切换回来正文还在；改名生效', async () => {
    const storage = memoryStorage();
    const controller = createChatController({ account: 'alice@example.com', storage });
    controller.configure(runtime());

    await say(controller, '第一段请求', '第一段回答');
    const first = controller.getSnapshot().activeSessionId!;
    expect(controller.getSnapshot().sessions).toHaveLength(1);
    expect(controller.getSnapshot().items.some((i) => i.role === 'assistant' && i.text === '第一段回答')).toBe(true);

    controller.newSession();
    const second = controller.getSnapshot().activeSessionId!;
    expect(second).not.toBe(first);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.getSnapshot().sessions).toHaveLength(2);

    await say(controller, '第二段请求', '第二段回答');
    expect(controller.getSnapshot().items.some((i) => i.text === '第二段回答')).toBe(true);

    controller.switchSession(first);
    expect(controller.getSnapshot().activeSessionId).toBe(first);
    expect(controller.getSnapshot().items.some((i) => i.text === '第一段回答')).toBe(true);
    expect(controller.getSnapshot().items.some((i) => i.text === '第二段回答')).toBe(false);

    controller.renameSession(first, '我的第一段');
    const named = controller.getSnapshot().sessions.find((s) => s.id === first);
    expect(named?.title).toBe('我的第一段');
  });

  it('重新挂载（新控制器、同一存储）能恢复两段会话并可切回', async () => {
    const storage = memoryStorage();
    const controller = createChatController({ account: 'alice@example.com', storage });
    controller.configure(runtime());
    await say(controller, 'A 请求', 'A 回答');
    const first = controller.getSnapshot().activeSessionId!;
    controller.newSession();
    await say(controller, 'B 请求', 'B 回答');

    const remounted = createChatController({ account: 'alice@example.com', storage });
    remounted.configure(runtime());
    const restored = remounted.getSnapshot();
    expect(restored.sessions.length).toBe(2);
    // 恢复后 activeId 指向 B 那段；切回 A 仍能读到 A 的回答。
    remounted.switchSession(first);
    expect(remounted.getSnapshot().items.some((i) => i.text === 'A 回答')).toBe(true);
  });

  it('运行中不允许切换会话', async () => {
    const storage = memoryStorage();
    const controller = createChatController({ account: 'alice@example.com', storage });
    controller.configure(runtime());
    await say(controller, '第一段', '回答');
    const first = controller.getSnapshot().activeSessionId!;
    controller.newSession();
    // 挂起一轮，进入 running
    let resolve: ((v: AssistantOutcome) => void) | undefined;
    appHostMocks.requestAssistantTurn.mockImplementationOnce(
      () => new Promise<AssistantOutcome>((done) => { resolve = done; }),
    );
    controller.setDraft('进行中');
    controller.send();
    if (controller.getSnapshot().phase === 'disclose') controller.confirmDisclosure();
    expect(controller.getSnapshot().phase).toBe('running');
    controller.switchSession(first);
    expect(controller.getSnapshot().activeSessionId).not.toBe(first);
    resolve?.(answer('收尾'));
    await flush();
  });
});
