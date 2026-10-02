/**
 * W1：本机端点拒绝宿主来源时，失败态要**说出该放行的那个值**
 * ==========================================================
 *
 * ## 这条通道原来在说谎
 *
 * `packages/ai` 在 `network` 这一档只知道"fetch 抛了"，**不知道是什么让它抛的**。
 * 而实测（2026-10-02，Ollama 0.23.2，[ADR-0045](../../../docs/adr/0045-conversational-assistant-split-authorization-from-catalog.md) §4）：
 * 回环端点对**非回环来源**回 403 且不带 `Access-Control-Allow-Origin` ⇒
 * 浏览器把它拦成 `TypeError: Failed to fetch` ⇒ 这里收到的就是 `network`。
 *
 * 于是原来的界面说："检查你的网络" —— 并且**不给任何下一步**
 * （`CAUSE_SETTINGS_TARGET.network` 是 `undefined`，注释写着"设置里改什么都修不好"）。
 * 对本机端点而言这两句都错：既不暂时，也确实有该说的话
 * （把宿主 Origin 加进 `OLLAMA_ORIGINS`）。
 *
 * ## 本文件钉住什么
 *
 *   1. **诊断成立时**：主文案换成那句具体的、"去设置"落点是端点区块、
 *      界面上**出现那个 Origin 的具体值**（不是"有一条提示"）；
 *   2. **诊断不成立时**（回环宿主 / 远程端点 / 缺字段 / 非 network 原因码）：
 *      一个字都不许多渲染 —— 给一次真网络抖动附上"去加白名单"，
 *      是教用户做一个不需要做的安全决定；
 *   3. 🔴 **五个入口形状一致**：五个工厂吃同一个 `AiFailureContext`，
 *      同一份输入必须给出同一份输出。这条是防"第 5 个又漏了"那次漂移的
 *      （`ai-failure-copy.ts` 文件头记着它，`ai-failure-parity.spec.tsx` 是同一族的另一条）；
 *   4. 值是**数据不是文案**：原样渲染，不去尾斜杠、不转小写。
 *
 * ⚠️ 界面那两条走 jsdom（`currentHostOrigin()` 读 `window.location.origin`，
 * 测试里按既有做法把它换成一个非回环来源）。**真浏览器**那条属于
 * `e2e/`（W5 + 假端点要能按白名单拒绝，见 ai-assistant-closure.md W1 判据），
 * 本文件不冒充它。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, translate } from '@heyta/i18n';
import type { AiFailureReason, AiRoutingConfig, SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';

import {
  breakdownFailureCopy,
  captureFailureCopy,
  durationFailureCopy,
  prioritizeFailureCopy,
  toolRunFailureCopy,
  type AiFailureContext,
  type AiFailureCopy,
} from '../src/features/ai/ai-failure-copy.js';

const { AiBreakdown } = await import('../src/features/ai/AiBreakdown.js');

/** 有没有汉字。 */
const CJK = /[㐀-䶿一-鿿]/;

/** 生产 Web 壳那样的非回环来源。 */
const PROD_ORIGIN = 'https://heyta.example.test';
/** 内置预设（Ollama）：字面回环。 */
const LOOPBACK_ENDPOINT_URL = 'http://localhost:11434/v1';

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

const LOOPBACK_ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: false,
  endpoints: [
    {
      id: 'ollama',
      label: 'Ollama',
      endpoint: LOOPBACK_ENDPOINT_URL,
      model: 'qwen3',
      capabilities: ['structured_output', 'long_context'] as const,
    },
  ],
  routes: { breakdown: [{ endpointId: 'ollama' }] },
};

const TASK = {
  id: 't1',
  title: 'Write the weekly report',
  note: 'Attach the numbers.',
  createdAt: 0,
  updatedAt: 0,
} as Task;

function ctx(
  cause: AiFailureReason | undefined,
  endpointUrl: string | undefined,
): AiFailureContext {
  return { cause, endpointUrl };
}

/**
 * 临时将宿主的 `location.origin` 换成给定值（`currentHostOrigin()` 的唯一输入）。
 *
 * ⚠️ 与 `auth-endpoint.spec.ts` 同一手法：换掉整个 `window.location`，
 * `finally` 里换回来。用 `vi.stubGlobal` 也行，但那个只在 mock 层生效，
 * 而这里要的是 `host-origin.ts` 真读到它。
 */
function withHostOrigin(origin: string, run: () => void): void {
  const original = window.location;
  Object.defineProperty(window, 'location', {
    value: { origin },
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    Object.defineProperty(window, 'location', {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

describe('诊断成立（回环端点 + 非回环宿主）的三条一起成立', () => {
  it('主文案换成具体那句，"去设置"落点是端点区块，originHint 是那个值本身', () => {
    withHostOrigin(PROD_ORIGIN, () => {
      const copy = breakdownFailureCopy('ai-unavailable', '无法连接端点「Ollama」：Failed to fetch', ctx('network', LOOPBACK_ENDPOINT_URL));
      expect(copy.key).toBe('web.ai.failure.cause.networkOriginRejected');
      // 🔴 这条就是 ADR-0045 §4 里那句"设置里改什么都修不好"被推翻的地方。
      expect(copy.settingsTarget).toBe('endpoints');
      expect(copy.originHint).toBe(PROD_ORIGIN);
      // `Failed to fetch` 那句原文仍留在诊断块里 —— 它是证据。
      expect(copy.showDetail).toBe(true);
    });
  });

  it('中英词条都在、英文不含汉字，且不是同一句（诊断这条不许只写中文）', () => {
    const zh = translate('zh-CN', 'web.ai.failure.cause.networkOriginRejected');
    const en = translate('en', 'web.ai.failure.cause.networkOriginRejected');
    expect(zh).not.toBe('');
    expect(CJK.test(zh), 'zh 词条里没有汉字').toBe(true);
    expect(CJK.test(en), `en 词条里有汉字：${en}`).toBe(false);
    expect(en).not.toBe(zh);
    // 标题与说明两条也双语齐备（界面上渲染的就是这两条）。
    for (const key of ['web.ai.failure.originToAllow', 'web.ai.failure.originToAllowNote'] as const) {
      expect(translate('zh-CN', key), `${key} 缺中文`).not.toBe('');
      const copy = translate('en', key);
      expect(copy, `${key} 缺英文`).not.toBe('');
      expect(CJK.test(copy), `${key} 的英文里有汉字：${copy}`).toBe(false);
    }
  });

  it('🔴 值是数据：原样给出，不去尾斜杠、不转小写', () => {
    withHostOrigin('https://Heyta.Example.TEST:8443/', () => {
      const copy = breakdownFailureCopy('ai-unavailable', 'x', ctx('network', LOOPBACK_ENDPOINT_URL));
      expect(copy.originHint).toBe('https://Heyta.Example.TEST:8443/');
    });
  });
});

describe('🔴 诊断不成立时一个字都不许多（保守方向）', () => {
  const negatives: readonly { name: string; origin: string; endpointUrl: string | undefined }[] = [
    { name: '宿主自己就在回环上（开发机 localhost，实测被放行）', origin: 'http://127.0.0.1:5173', endpointUrl: LOOPBACK_ENDPOINT_URL },
    { name: '宿主是 localhost 写法', origin: 'http://localhost:5173', endpointUrl: LOOPBACK_ENDPOINT_URL },
    { name: '端点是远程的（跨源解释不了这次失败）', origin: PROD_ORIGIN, endpointUrl: 'https://api.example.com/v1' },
    { name: '端点地址非法（判不成回环）', origin: PROD_ORIGIN, endpointUrl: 'not-a-url' },
    { name: '🔴 壳没带出 endpointUrl —— 未知量不猜', origin: PROD_ORIGIN, endpointUrl: undefined },
  ];

  for (const { name, origin, endpointUrl } of negatives) {
    it(`${name} ⇒ 沿用"检查网络"、没有按钮、没有 originHint`, () => {
      withHostOrigin(origin, () => {
        const copy = breakdownFailureCopy('ai-unavailable', '无法连接端点', ctx('network', endpointUrl));
        expect(copy.key, name).toBe('web.ai.failure.cause.network');
        expect(copy.settingsTarget, name).toBeUndefined();
        expect(copy.originHint, name).toBeUndefined();
      });
    });
  }

  it('非 network 的原因码不被诊断插嘴（http-error 走它自己那条）', () => {
    withHostOrigin(PROD_ORIGIN, () => {
      const copy = breakdownFailureCopy('ai-unavailable', '端点报错', ctx('http-error', LOOPBACK_ENDPOINT_URL));
      expect(copy.key).toBe('web.ai.failure.cause.httpError');
      expect(copy.settingsTarget).toBe('endpoints');
      expect(copy.originHint).toBeUndefined();
    });
  });

  it('本地就能判定的失败（unparseable）永远没有 originHint', () => {
    withHostOrigin(PROD_ORIGIN, () => {
      const copy = breakdownFailureCopy('unparseable', '模型返回的内容没法读', ctx(undefined, undefined));
      expect(copy.key).toBe('web.ai.failure.breakdown.unparseable');
      expect(copy.settingsTarget).toBeUndefined();
      expect(copy.originHint).toBeUndefined();
    });
  });
});

describe('🔴 五个入口吃同一个上下文（第 5 个不许再漏一次）', () => {
  const factories: readonly [string, (detail: string, c: AiFailureContext) => AiFailureCopy][] = [
    ['breakdown', (d, c) => breakdownFailureCopy('ai-unavailable', d, c)],
    ['capture', (d, c) => captureFailureCopy('ai-unavailable', d, c)],
    ['duration', (d, c) => durationFailureCopy('ai-unavailable', d, c)],
    ['prioritize', (d, c) => prioritizeFailureCopy('ai-unavailable', d, c)],
    ['tool-run', (d, c) => toolRunFailureCopy('ai-unavailable', d, c)],
  ];

  it('同一份失败输入 ⇒ 五个工厂给出同一份 key / settingsTarget / originHint / showDetail', () => {
    withHostOrigin(PROD_ORIGIN, () => {
      const first = factories[0]![1]('x', ctx('network', LOOPBACK_ENDPOINT_URL));
      for (const [name, build] of factories) {
        const copy = build('x', ctx('network', LOOPBACK_ENDPOINT_URL));
        expect(copy.key, `${name} 的主文案与其他入口不一致`).toBe(first.key);
        expect(copy.settingsTarget, `${name} 的设置落点与其他入口不一致`).toBe(first.settingsTarget);
        expect(copy.originHint, `${name} 没把 originHint 带出来`).toBe(first.originHint);
        expect(copy.showDetail, `${name} 的诊断块策略与其他入口不一致`).toBe(first.showDetail);
      }
    });
  });

  it('反方向同样齐：诊断不成立时五个入口都没有 originHint', () => {
    withHostOrigin('http://localhost:5173', () => {
      for (const [name, build] of factories) {
        const copy = build('x', ctx('network', LOOPBACK_ENDPOINT_URL));
        expect(copy.originHint, `${name} 在不该说话时说了话`).toBeUndefined();
        expect(copy.settingsTarget, `${name} 在不该给按钮时给了按钮`).toBeUndefined();
      }
    });
  });
});

describe('界面：失败块里出现那个 Origin 的具体值', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function render(): HTMLDivElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <I18nProvider locale="zh-CN">
          <AiBreakdown
            task={TASK}
            routing={LOOPBACK_ROUTING}
            consents={[]}
            secrets={EMPTY_SECRETS}
            onApplyNote={() => Promise.resolve()}
            fetchImpl={(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch}
            onOpenSettings={() => undefined}
          />
        </I18nProvider>,
      );
    });
    return container;
  }

  /** 进披露态 → 按"发送" → 等失败态落定（fetch 抛 ⇒ cause = network）。 */
  async function sendAndFail(el: HTMLDivElement): Promise<void> {
    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="ai-breakdown-t1"]')?.click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="ai-send"]')?.click();
      await Promise.resolve();
    });
  }

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('非回环宿主 + 回环端点 ⇒ 屏幕上出现那个值，并且能点去设置', async () => {
    let el: HTMLDivElement | undefined;
    await withHostOriginAsync(PROD_ORIGIN, async () => {
      el = render();
      await sendAndFail(el);
    });
    const node = el!.querySelector('[data-testid="ai-failure-origin-value"]');
    expect(node, '失败块里没有渲染那个 Origin —— 诊断这条在界面上断了').toBeTruthy();
    // 断言**具体值**，不是"有一条提示"。
    expect(node?.textContent).toBe(PROD_ORIGIN);
    // 标题与说明走词条（界面里不许出现硬编码文案）。
    expect(el!.querySelector('[data-testid="ai-failure-origin-hint"]')?.textContent).toContain(
      translate('zh-CN', 'web.ai.failure.originToAllow'),
    );
    // 主文案换成那句具体的。
    expect(el!.querySelector('[data-testid="ai-failure-message"]')?.textContent).toBe(
      translate('zh-CN', 'web.ai.failure.cause.networkOriginRejected'),
    );
    // 同一条诊断给的落点。
    expect(el!.querySelector('[data-testid="ai-failure-settings"]')).toBeTruthy();
  });

  it('🔴 宿主自己在回环上（开发机）⇒ 那个值一个字都不出现', async () => {
    let el: HTMLDivElement | undefined;
    await withHostOriginAsync('http://localhost:5173', async () => {
      el = render();
      await sendAndFail(el);
    });
    expect(el!.querySelector('[data-testid="ai-failure-message"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="ai-failure-origin-hint"]')).toBeNull();
    expect(el!.querySelector('[data-testid="ai-failure-settings"]')).toBeNull();
  });
});

/** `withHostOrigin` 的异步版（`act` 里那些 await 必须在覆盖生效期间跑完）。 */
async function withHostOriginAsync(origin: string, run: () => Promise<void>): Promise<void> {
  const original = window.location;
  Object.defineProperty(window, 'location', {
    value: { origin },
    configurable: true,
    writable: true,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(window, 'location', {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}
