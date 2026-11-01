/**
 * 助手设置面 = **出境披露**，不是权限档
 * ====================================
 *
 * ADR-0082 删掉了"只读 / 执行"两档（`assistantTier`），这一节因此**只剩一件事**：
 * 在任何一次对话之前，把这一次**最多**会送出的东西说清楚 —— 字段并集、工具名、
 * 三个硬上界。判据有两条方向相反的：
 *
 *   1. 🔴 那个控件**不许回来**：`assistant-tier-group` / `assistant-tier-*` 再出现，
 *      就说明有人把"用户先选权限再聊天"这一套重新装了回来。
 *   2. 🔴 披露里的字段名与工具名必须**逐字来自目录**（`planAssistantEgress()`），
 *      不是界面里另抄一份 —— 抄件会漂，漂了用户看到的"会送出这些"就成了假话。
 *
 * ⚠️ 这里刻意不再断言"两档的差别"：没有两档。写工具也**在**披露里（它们的结果
 * 不回送模型，所以通常不贡献字段，但工具名本身是出境数据）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { planAssistantEgress } from '@heyta/app-host';

import {
  AI_SETTINGS_STORAGE_KEY,
  createSessionSecretStore,
  defaultAiSettings,
  loadAiSettings,
  type PersistedAiSettings,
} from '../src/features/settings/aiStore.js';

const { AiSettings } = await import('../src/features/settings/AiSettings.js');

const CJK = /[㐀-䶿一-鿿]/;

/** 助手这一块在 `routing.enabled` 里面（AI 都没开时无处可授权）。 */
function enabledSettings(overrides: Partial<PersistedAiSettings> = {}): PersistedAiSettings {
  const base = defaultAiSettings();
  return {
    ...base,
    routing: { ...base.routing, enabled: true },
    ...overrides,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(
  initial: PersistedAiSettings,
  locale?: 'en',
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props = { initial, secrets: createSessionSecretStore() };
  act(() => {
    root?.render(
      locale === 'en' ? <I18nProvider locale="en"><AiSettings {...props} /></I18nProvider> : <AiSettings {...props} />,
    );
  });
  return container;
}

/** 披露行用语言相关的分隔符（`LIST_SEPARATOR`），所以比的是去分隔符后的集合。 */
function names(text: string): string[] {
  return text
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴 没有"助手权限"这个设置', () => {
  it('出厂设置里没有 `assistantTier` 字段', () => {
    expect(Object.keys(defaultAiSettings())).not.toContain('assistantTier');
  });

  it('旧配置里存着的 `assistantTier` 读回时被丢掉，不会漏给调用方', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...defaultAiSettings(), assistantTier: 'read-only' }),
    );
    expect(Object.keys(loadAiSettings())).not.toContain('assistantTier');
  });

  it('🔴 界面上没有单选组、没有档位下拉（ADR-0082：控件再回来这条就红）', () => {
    const el = render(enabledSettings());
    expect(el.querySelector('[data-testid="ai-assistant-section"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="assistant-tier-group"]')).toBeNull();
    expect(el.querySelector('[data-testid="assistant-tier-read-only"]')).toBeNull();
    expect(el.querySelector('[data-testid="assistant-tier-read-and-propose"]')).toBeNull();
    expect(el.querySelector('input[name="assistant-tier"]')).toBeNull();
  });

  it('🔴 AI 总开关关着时这一块**不出现**（没有路由就没有可披露的出境）', () => {
    const el = render(defaultAiSettings());
    expect(el.querySelector('[data-testid="ai-assistant-section"]')).toBeNull();
  });
});

describe('披露：界面说的是目录，不是自己抄的一份', () => {
  it('🔴 字段名与工具名逐字来自 `planAssistantEgress()`', () => {
    const el = render(enabledSettings());
    const fields = el.querySelector('[data-testid="assistant-egress-fields"]')?.textContent ?? '';
    const tools = el.querySelector('[data-testid="assistant-tools"]')?.textContent ?? '';
    const plan = planAssistantEgress();
    expect(new Set(names(fields))).toEqual(new Set(plan.fields));
    expect(new Set(names(tools))).toEqual(new Set(plan.tools));
  });

  it('披露里有正文（`task.body`）与 `tool.error` 信封 —— 这是事实，不是遗漏', () => {
    const plan = planAssistantEgress();
    expect(plan.fields).toContain('task.body');
    expect(plan.fields).toContain('tool.error');
  });

  it('🔴 写工具也在披露里（没有只读档，就没有"只报一部分"的理由）', () => {
    const plan = planAssistantEgress();
    for (const name of ['list_tasks', 'create_task', 'complete_task']) {
      expect(plan.tools).toContain(name);
    }
  });

  it('上界在界面上说得出数字（触顶时用户知道上限是多少，而不是"不知道卡在哪儿"）', () => {
    const el = render(enabledSettings());
    const limits = el.querySelector('[data-testid="assistant-limits"]')?.textContent ?? '';
    const plan = planAssistantEgress();
    expect(limits).toContain(String(plan.maxRequests));
    expect(limits).toContain(String(plan.maxMessages));
    expect(limits).toContain(String(plan.maxBytesPerRequest));
  });

  it('🔴 明说"这里只管内置助手"（不写这句，用户会以为这就是总开关）', () => {
    const el = render(enabledSettings());
    const split = el.querySelector('[data-testid="assistant-mcp-split"]')?.textContent ?? '';
    expect(split).toContain('本机 API');
  });
});

describe('英文界面', () => {
  it('🔴 助手这一块不露中文', () => {
    const el = render(enabledSettings(), 'en');
    const section = el.querySelector('[data-testid="ai-assistant-section"]');
    expect(section).not.toBeNull();
    expect(CJK.test(section?.textContent ?? '')).toBe(false);
  });
});
