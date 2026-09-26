/**
 * AI 设置面板 + 本地存储
 * =========================
 *
 * 🔴 本文件最重要的两条断言，都是**"坏掉时用户看不到症状"**的那一类：
 *
 *   1. **出厂状态三道闸全关** —— 如果默认变成"开"，
 *      用户会在完全没同意的情况下开始把任务发给某个端点。
 *   2. **API key 绝不进 `localStorage`** —— `localStorage` 会被任何同源脚本读到。
 *      写进去的那一刻没有任何症状，直到某天 XSS 把密钥带走。
 *
 * 第 2 条只能在这一层测：`packages/ai` 的 `SecretStore` 是个端口，
 * "Web 壳实现成内存"这个决定只有在这里才看得见。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AI_SETTINGS_STORAGE_KEY, defaultAiSettings, loadAiSettings, saveAiSettings, createSessionSecretStore } from '../src/features/settings/aiStore.js';

const { AiSettings, capabilityGaps } = await import('../src/features/settings/AiSettings.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Parameters<typeof AiSettings>[0]): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<AiSettings {...props} />);
  });
  return container;
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

/** 点击一个元素。 */
function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

/** 勾选/取消一个 checkbox。 */
function toggle(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLInputElement | null)?.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────

describe('默认值 —— 三道闸全关', () => {
  it('🔴 出厂设置：AI 关、不允许远程、本机 API 关', () => {
    const d = defaultAiSettings();
    expect(d.routing.enabled).toBe(false);
    expect(d.routing.allowRemote).toBe(false);
    expect(d.localApi.enabled).toBe(false);
  });

  it('🔴 出厂不预置任何功能路由（避免"打开总开关后功能悄悄跑起来"）', () => {
    expect(Object.keys(defaultAiSettings().routing.routes)).toHaveLength(0);
    expect(defaultAiSettings().routing.endpoints).toHaveLength(0);
  });

  it('出厂没有任何出境授权', () => {
    expect(defaultAiSettings().consents).toHaveLength(0);
  });

  it('🔴 默认绑定地址永远是回环', () => {
    expect(defaultAiSettings().localApi.bindAddress).toBe('127.0.0.1');
  });
});

// ── 记忆总开关（ADR-0014）──────────────────────────────────────────────
//
// 🔴 这一组守的是**第四道闸**。它和前三道的区别是：
// 前三道管"数据能不能出去"，这道管"AI 认不认识你"。
// 关掉它 AI 照常工作 —— 所以"关了但没生效"是**没有症状**的，
// 只能靠测试钉住。

describe('记忆总开关', () => {
  it('🔴 出厂默认关闭（第四道闸也是关的）', () => {
    expect(defaultAiSettings().memoryEnabled).toBe(false);
  });

  it('🔴 存成字符串 "true" 不算开 —— 只认真布尔', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...defaultAiSettings(), memoryEnabled: 'true' }),
    );
    expect(loadAiSettings().memoryEnabled).toBe(false);
  });

  it('🔴 字段缺失（旧版本存的配置）→ 关闭，而不是 undefined 漏出去', () => {
    const legacy = { ...defaultAiSettings() } as Record<string, unknown>;
    delete legacy.memoryEnabled;
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(legacy));
    expect(loadAiSettings().memoryEnabled).toBe(false);
  });

  it('数字 1 / null / 对象 都不算开', () => {
    for (const bogus of [1, null, {}, [], 'yes']) {
      localStorage.setItem(
        AI_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...defaultAiSettings(), memoryEnabled: bogus }),
      );
      expect(loadAiSettings().memoryEnabled).toBe(false);
    }
  });

  it('真的存了 true 才开', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...defaultAiSettings(), memoryEnabled: true }),
    );
    expect(loadAiSettings().memoryEnabled).toBe(true);
  });

  it('🔴 界面上的开关存在，且**不依赖 AI 总开关**就能看到', () => {
    const c = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    const box = c.querySelector('#ai-memory-enabled');
    expect(box).not.toBeNull();
  });

  it('🔴 打开记忆开关会回传 memoryEnabled=true（否则改了不生效）', () => {
    const seen: boolean[] = [];
    const c = render({
      initial: defaultAiSettings(),
      secrets: createSessionSecretStore(),
      onChange: (next) => seen.push(next.memoryEnabled),
    });
    toggle(c.querySelector('#ai-memory-enabled'));
    expect(seen.at(-1)).toBe(true);
  });

  it('🔴 关闭记忆开关会回传 false', () => {
    const seen: boolean[] = [];
    const c = render({
      initial: { ...defaultAiSettings(), memoryEnabled: true },
      secrets: createSessionSecretStore(),
      onChange: (next) => seen.push(next.memoryEnabled),
    });
    toggle(c.querySelector('#ai-memory-enabled'));
    expect(seen.at(-1)).toBe(false);
  });
});

describe('loadAiSettings —— 坏配置必须降级到"全关"，不是抛错', () => {
  it('没存过 → 默认值', () => {
    expect(loadAiSettings().routing.enabled).toBe(false);
  });

  it('坏 JSON → 默认值（不抛）', () => {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, '{ 这不是 json');
    expect(loadAiSettings().routing.enabled).toBe(false);
  });

  it('🔴 字符串 "true" 不算 true（不能靠类型强转打开 AI）', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ routing: { enabled: 'true', allowRemote: 'true' } }),
    );
    const loaded = loadAiSettings();
    expect(loaded.routing.enabled).toBe(false);
    expect(loaded.routing.allowRemote).toBe(false);
  });

  it('🔴 存储里的绑定地址被忽略 —— 永远改回回环', () => {
    // 防的是"有人把存储改成 0.0.0.0，于是悄悄暴露到局域网"
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ localApi: { enabled: true, bindAddress: '0.0.0.0', port: 47_119 } }),
    );
    expect(loadAiSettings().localApi.bindAddress).toBe('127.0.0.1');
  });

  it('端点必须字段齐全，缺字段的被丢掉', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        routing: {
          endpoints: [
            { id: 'ok', label: '好的', endpoint: 'http://localhost:11434/v1', model: 'm' },
            { id: 'bad', label: '缺 model' },
            null,
            'not an object',
          ],
        },
      }),
    );
    const loaded = loadAiSettings();
    expect(loaded.routing.endpoints.map((e) => e.id)).toEqual(['ok']);
  });

  it('往返保存/读取保持一致', () => {
    const s = defaultAiSettings();
    const next = {
      ...s,
      routing: { ...s.routing, enabled: true, allowRemote: true },
    };
    saveAiSettings(next);
    const loaded = loadAiSettings();
    expect(loaded.routing.enabled).toBe(true);
    expect(loaded.routing.allowRemote).toBe(true);
  });
});

describe('SessionSecretStore —— 密钥只在内存', () => {
  it('设置后能取到，clear 后取不到', async () => {
    const store = createSessionSecretStore();
    expect(await store.get('k')).toBeUndefined();
    store.set('k', 'sk-secret');
    expect(await store.get('k')).toBe('sk-secret');
    store.clear();
    expect(await store.get('k')).toBeUndefined();
  });

  it('knownRefs 只返回引用名，不返回值', () => {
    const store = createSessionSecretStore();
    store.set('k1', 'sk-secret');
    // 🔴 这个接口刻意不返回值 —— 免得 UI 把它渲染出来
    expect(store.knownRefs()).toEqual(['k1']);
    expect(JSON.stringify(store.knownRefs())).not.toContain('sk-secret');
  });
});

describe('AI 设置界面', () => {
  it('默认渲染时，允许远程与本机 API 的开关都不出现（因为总开关是关的）', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    const enabled = el.querySelector('#ai-enabled') as HTMLInputElement;
    expect(enabled.checked).toBe(false);
    // AI 的下游配置不该出现
    expect(el.querySelector('#ai-allow-remote')).toBeNull();
    // ⚠️ 但**本机 API 的开关必须始终可见** —— 它与 AI 总开关无关，
    // 是反方向的入站面。藏在 AI 开关后面会让人找不到。
    expect(el.querySelector('#local-api-enabled')).toBeTruthy();
  });

  it('🔴 总开关打开后才出现"允许远程"，且默认仍是关的', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#ai-enabled'));
    const allowRemote = el.querySelector('#ai-allow-remote') as HTMLInputElement;
    expect(allowRemote).toBeTruthy();
    expect(allowRemote.checked).toBe(false);
  });

  it('🔴 打开"允许远程"必须出现明文警示（不受端到端加密保护）', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#ai-enabled'));
    expect(el.querySelector('[data-testid="remote-warning"]')).toBeNull();
    toggle(el.querySelector('#ai-allow-remote'));
    const warning = el.querySelector('[data-testid="remote-warning"]');
    expect(warning).toBeTruthy();
    expect(warning?.textContent).toContain('不受端到端加密保护');
  });

  it('添加本机预设后，端点被标为"数据不出设备"且不需要授权', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#ai-enabled'));
    click(el.querySelector('[data-testid="add-preset-ollama"]'));
    const item = el.querySelector('[data-testid="endpoint-ollama"]');
    expect(item).toBeTruthy();
    expect(item?.textContent).toContain('数据不出设备');
  });

  /**
   * 🔴 这条钉的是一个"能力有单测、但零生产调用点"的洞。
   *
   * 密钥输入框的渲染条件是 `endpoint.keyRef !== undefined`，路由层取值
   * 也由它开关。而 `addCustomEndpoint` 曾经**不设 `keyRef`** ——
   * 于是界面上永远不出现密钥输入框，请求永远不带 `authorization` 头，
   * 「自己接入 AI」对有鉴权的服务商完全走不通。
   *
   * 它为什么一直没被发现：本文件其它用例**自己造了带 `keyRef` 的配置**，
   * 于是密钥 UI 一直是绿的。只有"点真界面加一个端点、看有没有输入框"
   * 才能发现 —— 这正是真实用户旅程测试抓出来的。
   */
  it('🔴 新加的自定义端点**必须能输密钥**（否则它无法鉴权）', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#ai-enabled'));
    click(el.querySelector('[data-testid="add-custom-endpoint"]'));
    const item = el.querySelector('[data-testid="endpoint-custom-1"]');
    expect(item, '端点行应该出现').toBeTruthy();
    expect(
      item?.querySelector('[aria-label$="的密钥"]'),
      '没有密钥输入框 → 这个端点根本没法鉴权',
    ).toBeTruthy();
    expect(
      [...(item?.querySelectorAll('button') ?? [])].some((b) =>
        b.textContent?.includes('记住'),
      ),
      '应该有"记住（本次会话）"按钮',
    ).toBe(true);
  });

  it('🔴 keyRef 进 localStorage、密钥本身不进（引用与值分离）', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#ai-enabled'));
    click(el.querySelector('[data-testid="add-custom-endpoint"]'));

    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY) ?? '';
    expect(raw, 'keyRef 要落盘（否则刷新后密钥对不上端点）').toContain('keyRef');
    expect(raw, '端点配置里不能出现密钥字面量').not.toContain('sk-');
  });

  it('🔴 加进来的自定义端点**能改**（否则加进来就是死路）', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#ai-enabled'));
    click(el.querySelector('[data-testid="add-custom-endpoint"]'));
    const item = el.querySelector('[data-testid="endpoint-custom-1"]');
    expect(item).toBeTruthy();
    // 地址、模型、名称都必须可编辑 —— 预设只是起点
    expect(item?.querySelector('[aria-label$="的地址"]')).toBeTruthy();
    expect(item?.querySelector('[aria-label$="的模型"]')).toBeTruthy();
    expect(item?.querySelector('[aria-label$="的名称"]')).toBeTruthy();
  });

  it('🔴 不合法的地址**留在列表里并就地提示**，而且被排除出路由', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      { id: 'bad', label: '明文远端', endpoint: 'http://api.example.com/v1', model: 'm' },
      { id: 'broken', label: '半成品', endpoint: 'https://', model: 'm' },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });

    // 明文远端：必须就地说明"必须是 https"
    const bad = el.querySelector('[data-testid="endpoint-invalid-bad"]');
    expect(bad?.textContent).toContain('https');

    // 半成品：必须说"无法解析"
    const broken = el.querySelector('[data-testid="endpoint-invalid-broken"]');
    expect(broken?.textContent).toContain('无法解析');

    // 两者都还在列表里（用户能改），但都不算合法端点
    expect(el.querySelector('[data-testid="endpoint-bad"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="endpoint-broken"]')).toBeTruthy();
  });

  it('🔴 远端端点旁的标签说明"数据会离开设备"', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.allowRemote = true;
    s.routing.endpoints = [
      { id: 'r', label: '云端', endpoint: 'https://api.example.com/v1', model: 'm' },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    const item = el.querySelector('[data-testid="endpoint-r"]');
    expect(item?.textContent).toContain('数据会离开设备');
  });

  it('本机 API 打开后才出现 token 输入与逐工具开关', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#local-api-enabled'));
    expect(el.querySelector('[aria-label="本机 API 访问 token"]')).toBeTruthy();
    // 逐工具开关：至少要能看到几个工具
    expect(el.querySelector('[aria-label="list_tasks"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="create_task"]')).toBeTruthy();
  });

  it('🔴 本机 API 开着但没 token → 显示错误，且说明防的是本机其他程序', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    toggle(el.querySelector('#local-api-enabled'));
    const err = el.querySelector('[data-testid="local-api-error"]');
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain('任何程序');
  });

  it('🔴 逐工具开关默认全部未勾选', () => {
    const s = defaultAiSettings();
    s.localApi = { ...s.localApi, enabled: true, token: 'tok' };
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    const boxes = el.querySelectorAll<HTMLInputElement>('.ht-settings__tool input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.checked).toBe(false);
    }
  });

  it('🔴 密钥输入框旁必须说明"关掉页面就没了"', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    const notice = el.querySelector('[data-testid="key-notice"]');
    expect(notice?.textContent).toContain('标签页');
    expect(notice?.textContent).toContain('重新输入');
  });

  it('恢复默认会把一切关回去', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.allowRemote = true;
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    click(el.querySelector('[data-testid="reset-ai-settings"]'));
    const enabled = el.querySelector('#ai-enabled') as HTMLInputElement;
    expect(enabled.checked).toBe(false);
  });
});

describe('🔴🔴 能力声明 —— 界面必须能声明，否则功能永远没有路', () => {
  it('🔴 每个端点都有四项能力勾选', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      { id: 'e1', label: '本机', endpoint: 'http://localhost:11434/v1', model: 'm' },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    for (const cap of ['structured_output', 'long_context', 'vision', 'tool_calling']) {
      expect(el.querySelector(`[aria-label="本机 的能力 ${cap}"]`), cap).toBeTruthy();
    }
  });

  it('🔴 未声明的端点，能力勾选**默认全不勾**（保守失败，不是乐观假设）', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      { id: 'e1', label: '本机', endpoint: 'http://localhost:11434/v1', model: 'm' },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    const boxes = el.querySelectorAll<HTMLInputElement>('.ht-settings__caps input[type="checkbox"]');
    expect(boxes.length).toBe(4);
    for (const b of boxes) expect(b.checked).toBe(false);
  });

  it('🔴 勾上 long_context 后提示里说明它影响"拆解任务"', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      { id: 'e1', label: '本机', endpoint: 'http://localhost:11434/v1', model: 'm' },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    const label = el.querySelector('[aria-label="本机 的能力 long_context"]')?.closest('label');
    expect(label?.textContent).toContain('拆解任务');
  });

  it('🔴 勾选后的能力真的进了配置（不是只改了个 checkbox）', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      { id: 'e1', label: '本机', endpoint: 'http://localhost:11434/v1', model: 'm' },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    toggle(el.querySelector('[aria-label="本机 的能力 long_context"]'));
    const saved = loadAiSettings();
    // 存储里必须出现 long_context —— 否则"界面能勾、实际没用"
    expect(saved.routing.endpoints[0]?.capabilities).toContain('long_context');
  });

  it('取消勾选后能力从配置里移除', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      {
        id: 'e1',
        label: '本机',
        endpoint: 'http://localhost:11434/v1',
        model: 'm',
        capabilities: ['structured_output', 'long_context'],
      },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    toggle(el.querySelector('[aria-label="本机 的能力 long_context"]'));
    const saved = loadAiSettings();
    expect(saved.routing.endpoints[0]?.capabilities).not.toContain('long_context');
    expect(saved.routing.endpoints[0]?.capabilities).toContain('structured_output');
  });

  it('🔴 已声明的能力会被渲染成已勾选', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      {
        id: 'e1',
        label: '本机',
        endpoint: 'http://localhost:11434/v1',
        model: 'm',
        capabilities: ['structured_output', 'long_context'],
      },
    ];
    const el = render({ initial: s, secrets: createSessionSecretStore() });
    expect(
      (el.querySelector('[aria-label="本机 的能力 long_context"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (el.querySelector('[aria-label="本机 的能力 vision"]') as HTMLInputElement).checked,
    ).toBe(false);
  });
});

describe('🔴🔴 密钥绝不进 localStorage（本文件最重要的一条）', () => {
  it('通过界面设置的密钥不会被写入存储', () => {
    const secrets = createSessionSecretStore();
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      {
        id: 'remote',
        label: '云端',
        endpoint: 'https://api.example.com/v1',
        model: 'm',
        keyRef: 'remote-key',
      },
    ];
    const el = render({ initial: s, secrets });

    const input = el.querySelector<HTMLInputElement>('[aria-label="云端 的密钥"]');
    expect(input).toBeTruthy();
    act(() => {
      // React 受控输入：用原生 setter 触发 onChange
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'sk-super-secret');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // 点"记住（本次会话）"
    const remember = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('记住'),
    );
    click(remember);

    // 密钥进了内存
    expect(secrets.knownRefs()).toEqual(['remote-key']);

    // 🔴 但**没有**进 localStorage —— 这是整条纪律的核心
    const all = JSON.stringify(localStorage);
    expect(all).not.toContain('sk-super-secret');
    expect(all).not.toContain('super-secret');
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const value = key === null ? '' : localStorage.getItem(key) ?? '';
      expect(value).not.toContain('sk-super-secret');
    }
  });

  it('存储形状里没有 key 字段（类型层面也没有）', () => {
    const s = defaultAiSettings();
    s.routing.enabled = true;
    s.routing.endpoints = [
      { id: 'r', label: 'x', endpoint: 'https://api.example.com/v1', model: 'm', keyRef: 'ref' },
    ];
    saveAiSettings(s);
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY) ?? '';
    // 存的是 keyRef（引用名），不是密钥本身
    expect(raw).toContain('keyRef');
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('"secret"');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 能力缺口：能配、但配了也跑不起来', () => {
  /** 一个端点 + 一条到「AI 拆解」的路由，但**没声明长上下文**。 */
  function withBreakdownRoute(capabilities: readonly string[]) {
    const base = defaultAiSettings();
    return {
      ...base,
      routing: {
        enabled: true,
        allowRemote: false,
        endpoints: [
          {
            id: 'e1',
            label: '本机端点',
            endpoint: 'http://localhost:11434/v1',
            model: 'm',
            capabilities: capabilities as never,
          },
        ],
        routes: { breakdown: [{ endpointId: 'e1' }] },
      },
    };
  }

  it('🔴🔴 端点没声明长上下文 → 界面**必须**说出来', () => {
    const el = render({ initial: withBreakdownRoute(['structured_output']), secrets: createSessionSecretStore() });
    const warn = el.querySelector('[data-testid="cap-gap-breakdown"]');
    expect(warn).toBeTruthy();
    // 要说清"缺什么"，不是只说"配置有问题"
    expect(warn?.textContent).toContain('长上下文');
    expect(warn?.textContent).toContain('本机端点');
  });

  it('🔴 声明齐了 → 不出现提示', () => {
    const el = render({
      initial: withBreakdownRoute(['structured_output', 'long_context']),
      secrets: createSessionSecretStore(),
    });
    expect(el.querySelector('[data-testid="cap-gap-breakdown"]')).toBeNull();
  });

  it('🔴🔴 一键补上：点了之后能力真的存进设置里', () => {
    const el = render({ initial: withBreakdownRoute(['structured_output']), secrets: createSessionSecretStore() });
    click(el.querySelector('[data-testid="cap-fix-breakdown"]'));

    const saved = loadAiSettings();
    expect(saved.routing.endpoints[0]?.capabilities).toContain('long_context');
    // 🔴 原有的能力不能被顶掉
    expect(saved.routing.endpoints[0]?.capabilities).toContain('structured_output');
  });

  it('🔴 补上之后提示消失（不是一直挂着）', () => {
    const el = render({ initial: withBreakdownRoute(['structured_output']), secrets: createSessionSecretStore() });
    expect(el.querySelector('[data-testid="cap-gap-breakdown"]')).toBeTruthy();
    click(el.querySelector('[data-testid="cap-fix-breakdown"]'));
    expect(el.querySelector('[data-testid="cap-gap-breakdown"]')).toBeNull();
  });

  it('🔴 功能没配端点时**不**报能力缺口（那是另一回事）', () => {
    const base = defaultAiSettings();
    const settings = {
      ...base,
      routing: {
        enabled: true,
        allowRemote: false,
        endpoints: [
          { id: 'e1', label: 'A', endpoint: 'http://localhost:11434/v1', model: 'm', capabilities: ['structured_output'] as never },
        ],
        routes: {},
      },
    };
    const el = render({ initial: settings, secrets: createSessionSecretStore() });
    expect(el.querySelector('[data-testid="cap-gap-breakdown"]')).toBeNull();
  });

  it('🔴 路由里有多个端点时，只要**一个**能满足就不提示', () => {
    const base = defaultAiSettings();
    const settings = {
      ...base,
      routing: {
        enabled: true,
        allowRemote: false,
        endpoints: [
          { id: 'weak', label: '弱端点', endpoint: 'http://localhost:11434/v1', model: 'm', capabilities: ['structured_output'] as never },
          { id: 'strong', label: '强端点', endpoint: 'http://localhost:1234/v1', model: 'm2', capabilities: ['structured_output', 'long_context'] as never },
        ],
        routes: { breakdown: [{ endpointId: 'weak' }, { endpointId: 'strong' }] },
      },
    };
    const el = render({ initial: settings, secrets: createSessionSecretStore() });
    expect(el.querySelector('[data-testid="cap-gap-breakdown"]')).toBeNull();
  });
});

describe('capabilityGaps（纯函数）', () => {
  it('没配路由 → undefined', () => {
    const base = defaultAiSettings();
    expect(capabilityGaps('breakdown', base.routing)).toBeUndefined();
  });

  it('🔴 breakdown 需要 long_context，缺了就算出来', () => {
    const routing = {
      enabled: true,
      allowRemote: false,
      endpoints: [
        { id: 'e1', label: 'A', endpoint: 'http://localhost:11434/v1', model: 'm', capabilities: ['structured_output'] as never },
      ],
      routes: { breakdown: [{ endpointId: 'e1' }] },
    };
    const gaps = capabilityGaps('breakdown', routing);
    expect(gaps?.[0]?.missing).toEqual(['long_context']);
  });

  it('🔴 capture 只需 structured_output —— 什么都不缺', () => {
    const routing = {
      enabled: true,
      allowRemote: false,
      endpoints: [
        { id: 'e1', label: 'A', endpoint: 'http://localhost:11434/v1', model: 'm', capabilities: ['structured_output'] as never },
      ],
      routes: { capture: [{ endpointId: 'e1' }] },
    };
    expect(capabilityGaps('capture', routing)?.[0]?.missing).toEqual([]);
  });

  it('端点不存在时跳过（不留一条假的缺口）', () => {
    const routing = {
      enabled: true,
      allowRemote: false,
      endpoints: [],
      routes: { breakdown: [{ endpointId: 'ghost' }] },
    };
    expect(capabilityGaps('breakdown', routing)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 熔断的端点必须在设置里看得出来', () => {
  /** 一个有端点、且落盘了熔断状态的设置。 */
  function withHealth(circuitOpenUntil: number, endpointId = 'e1') {
    const base = defaultAiSettings();
    return {
      ...base,
      routing: {
        ...base.routing,
        // 🔴 必须打开总开关，否则端点区根本不渲染（见本文件前面的用例）
        enabled: true,
        endpoints: [
          { ...(base.routing.endpoints[0] ?? {
            id: endpointId, label: '本机端点', endpoint: 'http://localhost:11434/v1', model: 'm',
          }) },
        ],
      },
      health: {
        version: 1,
        entries: [{ endpointId, consecutiveFailures: 3, circuitOpenUntil }],
      },
    };
  }

  it('🔴🔴 跳闸中的端点要显示出来（否则界面和实际不一致）', () => {
    const el = render({
      initial: withHealth(Date.now() + 60_000),
      secrets: createSessionSecretStore(),
    });
    const warn = el.querySelector('[data-testid="endpoint-unhealthy-e1"]');
    expect(warn).toBeTruthy();
    // 🔴 要说人话：不是哪个端点失败了，而是"多久之后会再试"
    expect(warn?.textContent).toContain('暂时停止使用');
    expect(warn?.textContent).toContain('秒后重试');
  });

  it('🔴 过期的跳闸**不该**继续显示（否则用户以为还坏着）', () => {
    const el = render({
      initial: withHealth(Date.now() - 60_000),
      secrets: createSessionSecretStore(),
    });
    expect(el.querySelector('[data-testid="endpoint-unhealthy-e1"]')).toBeNull();
  });

  it('🔴 没有健康数据时不显示任何警告（不制造噪音）', () => {
    const el = render({
      initial: defaultAiSettings(),
      secrets: createSessionSecretStore(),
    });
    expect(el.querySelector('[data-testid="endpoint-unhealthy-e1"]')).toBeNull();
  });

  it('🔴 坏快照不该让设置面板崩掉', () => {
    const base = defaultAiSettings();
    const el = render({
      initial: { ...base, health: { version: 999, entries: 'garbage' } as never },
      secrets: createSessionSecretStore(),
    });
    // 面板仍然渲染出来
    expect(el.querySelector('[data-testid="ai-settings"]')).toBeTruthy();
  });

  it('🔴 文案里不出现原始时间戳（那对用户没有意义）', () => {
    const until = Date.now() + 60_000;
    const el = render({
      initial: withHealth(until),
      secrets: createSessionSecretStore(),
    });
    const text = el.querySelector('[data-testid="endpoint-unhealthy-e1"]')?.textContent ?? '';
    expect(text).not.toContain(String(until));
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 本机 API 面板必须说清"配在哪里才生效"', () => {
  function withLocalApi() {
    const base = defaultAiSettings();
    return { ...base, localApi: { ...base.localApi, enabled: true, token: 'abcdefghijklmnop' } };
  }

  it('🔴🔴 明确写出真正生效的是配置文件，不是这里', () => {
    const el = render({ initial: withLocalApi(), secrets: createSessionSecretStore() });
    const note = el.querySelector('[data-testid="local-api-source-note"]');
    expect(note).toBeTruthy();
    // 必须给出**具体路径**，不能只说"配置文件"
    expect(note?.textContent).toContain('~/.heyta/local-api.json');
    // 必须给出**可执行的命令**
    expect(note?.textContent).toContain('local-api init');
  });

  it('🔴 明说两边不会自动同步（否则用户以为配了就生效）', () => {
    const el = render({ initial: withLocalApi(), secrets: createSessionSecretStore() });
    expect(el.querySelector('[data-testid="local-api-source-note"]')?.textContent).toContain(
      '不会自动同步',
    );
  });

  it('🔴 总开关关着时也要能看到（这不是"高级选项"，是必要说明）', () => {
    const base = defaultAiSettings();
    const el = render({ initial: base, secrets: createSessionSecretStore() });
    // 本机 API 区块的开关在 AI 总开关关闭时依然可见（既有设计），说明也应在
    expect(el.querySelector('[data-testid="local-api-source-note"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 必须说清"我们只提供两种供给方式中的哪一种"', () => {
  function enabled() {
    const base = defaultAiSettings();
    return { ...base, routing: { ...base.routing, enabled: true } };
  }

  it('🔴🔴 说清托管 AI **会来**（曾经这里写的是"我们不做"）', () => {
    const el = render({ initial: enabled(), secrets: createSessionSecretStore() });
    const note = el.querySelector('[data-testid="managed-ai-note"]');
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain('即将提供');
  });

  it('🔴🔴 明说托管模式**不是端到端加密**（ADR-0006 的核心结论）', () => {
    const el = render({ initial: enabled(), secrets: createSessionSecretStore() });
    const text = el.querySelector('[data-testid="managed-ai-note"]')?.textContent ?? '';
    // 这句不能省：托管 AI 是这个 E2EE 产品里唯一"必须解开才能用"的口子
    expect(text).toContain('明文到达');
    expect(text).toContain('不是');
    expect(text).toContain('端到端加密');
  });

  it('🔴 不能再说"我们没有提供托管 AI"（那会变成对用户的错误承诺）', () => {
    const el = render({ initial: enabled(), secrets: createSessionSecretStore() });
    const text = el.querySelector('[data-testid="managed-ai-note"]')?.textContent ?? '';
    expect(text).not.toContain('没有');
  });

  it('🔴🔴 不能出现字面量星号（JSX 里 ** 不会变粗体）', () => {
    const el = render({ initial: enabled(), secrets: createSessionSecretStore() });
    const text = el.querySelector('[data-testid="managed-ai-note"]')?.textContent ?? '';
    expect(text).not.toContain('**');
    // 而且确实用了 <strong>
    expect(el.querySelector('[data-testid="managed-ai-note"] strong')).toBeTruthy();
  });

  it('🔴 AI 总开关关着时不显示（那是"还没启用"，不是"缺功能"）', () => {
    const el = render({ initial: defaultAiSettings(), secrets: createSessionSecretStore() });
    expect(el.querySelector('[data-testid="managed-ai-note"]')).toBeNull();
  });
});
