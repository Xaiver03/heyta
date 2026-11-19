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
import { IMAGE_BUDGET, type AiImagePart } from '@heyta/ai';
import type { LocalApiHost } from '@heyta/local-api';

import { createChatController, type ChatController, type ChatRuntime } from '../src/ai/chat-controller';

function memoryStorage(): HistoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => { values.set(k, v); },
    removeItem: (k) => { values.delete(k); },
  };
}

function runtime(): ChatRuntime {
  const settings: AiSettingsState = { ...defaultAiSettingsState() };
  return {
    settings,
    host: {} as LocalApiHost,
    localize: (k: string) => k,
    secretStore: { get: async () => undefined },
    managedTransport: async () => undefined,
    onHealth: vi.fn(),
    resolveRouting: () => settings.routing,
  } as ChatRuntime;
}

function answer(text: string): AssistantOutcome {
  return { ok: true, kind: 'answer', text, steps: [], appended: [], health: {} };
}

const img = (n: number): AiImagePart => ({ mediaType: 'image/png', base64: `QQ==${String(n)}` });

describe('移动端 Chatbot 图片附件', () => {
  beforeEach(() => {
    appHostMocks.requestAssistantTurn.mockReset();
    appHostMocks.confirmAiToolProposal.mockReset();
  });

  it('addImages 按出境张数上界截断', () => {
    const controller = createChatController({ account: 'a@x.io', storage: memoryStorage() });
    controller.configure(runtime());
    controller.addImages([img(1), img(2), img(3)]);
    expect(controller.getSnapshot().images).toHaveLength(IMAGE_BUDGET.maxImagesPerRequest);
    controller.removeImage(0);
    expect(controller.getSnapshot().images).toHaveLength(IMAGE_BUDGET.maxImagesPerRequest - 1);
  });

  it('只有图没有字也是合法提问；带图先披露；确认后把图发给端点并清空', async () => {
    let captured: unknown;
    appHostMocks.requestAssistantTurn.mockImplementation((source: unknown) => {
      captured = source;
      return Promise.resolve(answer('看图'));
    });
    const controller = createChatController({ account: 'a@x.io', storage: memoryStorage() });
    controller.configure(runtime());
    controller.addImages([img(1)]);
    controller.setDraft('');
    controller.send();
    // 带图必须披露，哪怕文字为空。
    expect(controller.getSnapshot().phase).toBe('disclose');
    expect(controller.getSnapshot().items).toEqual([{ id: 1, role: 'user', text: '' }]);
    controller.confirmDisclosure();
    await Promise.resolve();
    await Promise.resolve();
    expect(captured).toMatchObject({ text: '', images: [{ mediaType: 'image/png' }] });
    expect(controller.getSnapshot().images).toEqual([]);
  });

  it('披露阶段取消会还原图片与草稿', () => {
    const controller = createChatController({ account: 'a@x.io', storage: memoryStorage() });
    controller.configure(runtime());
    controller.addImages([img(1)]);
    controller.setDraft('这是什么');
    controller.send();
    expect(controller.getSnapshot().phase).toBe('disclose');
    controller.cancelDisclosure();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(controller.getSnapshot().draft).toBe('这是什么');
    expect(controller.getSnapshot().images).toHaveLength(1);
    expect(controller.getSnapshot().items).toEqual([]);
  });
});
