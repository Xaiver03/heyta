/**
 * 助手能力档位（第二个授权前端）
 * ================================
 *
 * 🔴 这个面板存在理由不是"多一个开关"，而是**内置助手与外部程序共用一张
 * 逐工具授权表**这件事必须被拆开（ADR-0045 §2.2）：拆不开，用户为了用助手
 * 就得开一个他并不想开给别的进程的口子。所以本文件最要紧的三条都是
 * **"两个前端互不越界"**那一类的：
 *
 *   1. 默认档必须是 `read-only`，且**坏值一律落回默认**（不接受"看起来像真"）。
 *   2. 切档**不许碰到** `localApi.grants` —— 碰到了就是"两个前端合成一个开关"，
 *      而症状是用户关掉 MCP 时把助手也关了（或反过来）。
 *   3. 界面披露的字段与工具名必须来自目录，不是界面里另抄一份 ——
 *      抄件会漂，漂了用户看到的"会送出这些"就成了假话。
 *
 * ⚠️ 档位切换**不改变出境字段**（两档相同）：写工具只产出提案、结果不回送模型，
 * 所以它们不贡献字段。这一点在下面显式断言了 —— 不然读代码的人会以为
 * "切到只读就不送正文了"，那是错的期待。
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
  onChange?: (next: PersistedAiSettings) => void,
  locale?: 'en',
): { container: HTMLDivElement; changes: PersistedAiSettings[] } {
  const changes: PersistedAiSettings[] = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    initial,
    secrets: createSessionSecretStore(),
    ...(onChange === undefined
      ? { onChange: (next: PersistedAiSettings) => changes.push(next) }
      : { onChange: (next: PersistedAiSettings) => {
          changes.push(next);
          onChange(next);
        } }),
  };
  act(() => {
    root?.render(
      locale === 'en' ? <I18nProvider locale="en"><AiSettings {...props} /></I18nProvider> : <AiSettings {...props} />,
    );
  });
  return { container, changes };
}

function radioOf(container: HTMLDivElement, tier: string): HTMLInputElement | null {
  const label = container.querySelector<HTMLElement>(`[data-testid="assistant-tier-${tier}"]`);
  return label?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
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

describe('默认值与读回', () => {
  it('🔴 出厂档 = 只读（"让模型能改数据"必须是用户明确选过的状态）', () => {
    expect(defaultAiSettings().assistantTier).toBe('read-only');
  });

  it('🔴 字段缺失（旧版本存的配置）→ 只读，不是 undefined 漏给调用方', () => {
    const legacy = { ...defaultAiSettings() } as Record<string, unknown>;
    delete legacy.assistantTier;
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(legacy));
    expect(loadAiSettings().assistantTier).toBe('read-only');
  });

  it('🔴 不接受"看起来像真"的值：布尔 / 下划线写法 / 大小写 / 数字 一律落回只读', () => {
    for (const bogus of [true, 1, null, {}, [], 'read_and_propose', 'READ-AND-PROPOSE', 'propose']) {
      localStorage.setItem(
        AI_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...defaultAiSettings(), assistantTier: bogus }),
      );
      expect(loadAiSettings().assistantTier).toBe('read-only');
    }
  });

  it('逐字等于 `read-and-propose` 才算开写，并且能存回去', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...defaultAiSettings(), assistantTier: 'read-and-propose' }),
    );
    expect(loadAiSettings().assistantTier).toBe('read-and-propose');
  });
});

describe('界面上的两个前端', () => {
  it('助手这一块存在，两档都在，默认选中只读', () => {
    const { container } = render(enabledSettings());
    expect(container.querySelector('[data-testid="ai-assistant-section"]')).not.toBeNull();
    const readOnly = radioOf(container, 'read-only');
    const propose = radioOf(container, 'read-and-propose');
    expect(readOnly?.checked).toBe(true);
    expect(propose?.checked).toBe(false);
  });

  it('🔴 AI 总开关关着时这一块**不出现**（没有路由就没有可披露的出境）', () => {
    const base = defaultAiSettings();
    const { container } = render({ ...base, assistantTier: 'read-and-propose' });
    expect(container.querySelector('[data-testid="ai-assistant-section"]')).toBeNull();
  });

  it('切档 ⇒ 回调里是新档，而 `localApi.grants` 一个字节都没动', () => {
    const initial = enabledSettings({ localApi: { ...defaultAiSettings().localApi, grants: { list_tasks: true } } });
    const { container, changes } = render(initial);
    act(() => {
      radioOf(container, 'read-and-propose')?.click();
    });
    const next = changes.at(-1);
    expect(next?.assistantTier).toBe('read-and-propose');
    // 🔴 这一条是"两个前端"的**边界**：切助手档不许顺手改外部程序的授权。
    expect(next?.localApi.grants).toEqual({ list_tasks: true });
    expect(next?.localApi.enabled).toBe(false);
  });

  it('没有 onChange 时写回 localStorage（关掉设置页也认这个档）', () => {
    const own = document.createElement('div');
    document.body.appendChild(own);
    const ownRoot = createRoot(own);
    // 不传 `onChange` ⇒ 组件走默认的 `saveAiSettings` 分支（真写盘，不是回调假象）。
    act(() => {
      ownRoot.render(<AiSettings initial={enabledSettings()} secrets={createSessionSecretStore()} />);
    });
    act(() => {
      radioOf(own, 'read-and-propose')?.click();
    });
    expect(loadAiSettings().assistantTier).toBe('read-and-propose');
    act(() => {
      ownRoot.unmount();
    });
    own.remove();
  });
});

describe('披露：界面说的是目录，不是自己抄的一份', () => {
  it('🔴 字段名与工具名逐字来自 `planAssistantEgress(当前档)`', () => {
    const { container } = render(enabledSettings());
    const fields = container.querySelector('[data-testid="assistant-egress-fields"]')?.textContent ?? '';
    const tools = container.querySelector('[data-testid="assistant-tools"]')?.textContent ?? '';
    const plan = planAssistantEgress('read-only');
    // 分隔符随语言（`LIST_SEPARATOR`），所以比的是**去掉分隔符后的集合**，不是整串。
    const names = (text: string): string[] =>
      text
        .split(/[,，、\s]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '');
    expect(new Set(names(fields))).toEqual(new Set(plan.fields));
    expect(new Set(names(tools))).toEqual(new Set(plan.tools));
  });

  it('两档都披露正文（`task.body`）与 `tool.error` 信封 —— 这是事实，不是遗漏', () => {
    // 只读档同样会走 `get_task`，正文一样出境；写工具不贡献字段（结果不回送模型）。
    // 明写这条是为了挡掉"切到只读就不送正文了"这个错误期待。
    for (const tier of ['read-only', 'read-and-propose'] as const) {
      const plan = planAssistantEgress(tier);
      expect(plan.fields).toContain('task.body');
      expect(plan.fields).toContain('tool.error');
    }
    expect(planAssistantEgress('read-only').fields).toEqual(
      planAssistantEgress('read-and-propose').fields,
    );
  });

  it('🔴 档位之间**唯一**的可见差别是工具集合：写工具只在高一级出现', () => {
    const low = planAssistantEgress('read-only').tools;
    const high = planAssistantEgress('read-and-propose').tools;
    expect(low).not.toContain('create_task');
    expect(high).toContain('create_task');
    // 三个读工具两档都在 —— 否则"只读档"根本没法回答问题。
    for (const name of ['list_tasks', 'get_task', 'list_projects']) expect(low).toContain(name);
  });

  it('上界在界面上说得出数字（触顶时用户知道上限是多少，而不是"不知道卡在哪儿"）', () => {
    const { container } = render(enabledSettings());
    const limits = container.querySelector('[data-testid="assistant-limits"]')?.textContent ?? '';
    const plan = planAssistantEgress('read-only');
    expect(limits).toContain(String(plan.maxRequests));
    expect(limits).toContain(String(plan.maxMessages));
    expect(limits).toContain(String(plan.maxBytesPerRequest));
  });

  it('🔴 明说"这里只管内置助手"（不写这句，用户会以为这就是总开关）', () => {
    const { container } = render(enabledSettings());
    const split = container.querySelector('[data-testid="assistant-mcp-split"]')?.textContent ?? '';
    expect(split).toContain('本机 API');
  });
});

describe('英文界面', () => {
  it('🔴 助手这一块不露中文', () => {
    const { container } = render(enabledSettings(), undefined, 'en');
    const section = container.querySelector('[data-testid="ai-assistant-section"]');
    expect(section).not.toBeNull();
    expect(CJK.test(section?.textContent ?? '')).toBe(false);
  });
});
