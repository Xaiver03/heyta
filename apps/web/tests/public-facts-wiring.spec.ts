/**
 * 公共事实在 web 的接线（W4b 宿主那一层）
 * =======================================
 *
 * 拉取本身在 `@heyta/app-host`（那边有 10 条判据）。这里判的是**只有宿主能答错的那几件事**：
 *
 * · 闸门关着时**一个请求都不发**，但缓存照装（G-12 那句"同意之前一个字节都不许出去"
 *   不区分匿名与否 —— 这条请求虽然匿名，它仍然是"这台应用会不会跟服务端说话"）；
 * · 装上/拉到之后**有人敲重算**（`onFactsChanged`）：覆盖表是领域层的模块级状态，
 *   React 看不见它，没人敲的话界面就停在首屏那张"什么标记都没有"的图上；
 * · 失败**不敲**（判据①：拿不到就退回随包表，界面上不许出现"少了一块"的那种闪烁）；
 * · `start()` 幂等（严格模式双调用 / 热重载）。
 *
 * ⚠️ 这里用注入的端口，不起 DOM：这四条都是**分支判断**，jsdom 只会让它们更难读。
 */
import { describe, expect, it } from 'vitest';

import { META_KEYS } from '@heyta/storage';

import { createPublicFactsWiring, type PublicFactsPorts } from '../src/features/calendar/public-facts.js';

const BODY = {
  version: '1730000000000.1.2',
  years: [
    {
      year: 2027,
      papers: ['https://www.gov.cn/gongshu/example-2027'],
      days: [{ day: '2027-01-02', isOffDay: true }],
    },
  ],
};

interface Harness extends PublicFactsPorts {
  fetches: number;
  changed: number;
  values: Map<string, string | number>;
  consentListeners: (() => void)[];
  foregroundListeners: (() => void)[];
  foregroundSubscriptions: number;
  consentSubscriptions: number;
  emitConsent(): void;
  emitForeground(): void;
  setAllowed(value: boolean): void;
  setBaseUrl(value: string): void;
}

function harness(options: { allowed?: boolean; baseUrl?: string; respond?: () => Response } = {}): Harness {
  const values = new Map<string, string | number>();
  const consentListeners: (() => void)[] = [];
  const foregroundListeners: (() => void)[] = [];
  const state = {
    allowed: options.allowed ?? false,
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:3100',
    fetches: 0,
    changed: 0,
    consentSubscriptions: 0,
    foregroundSubscriptions: 0,
  };

  return {
    get fetches() {
      return state.fetches;
    },
    get changed() {
      return state.changed;
    },
    get consentSubscriptions() {
      return state.consentSubscriptions;
    },
    get foregroundSubscriptions() {
      return state.foregroundSubscriptions;
    },
    values,
    consentListeners,
    foregroundListeners,
    baseUrl: () => state.baseUrl,
    cache: () => ({
      getMetaValue: async (key: string) => values.get(key),
      setMetaValue: async (key: string, value: string | number) => {
        values.set(key, value);
      },
    }),
    fetchImpl: () =>
      (async () => {
        state.fetches += 1;
        return (
          options.respond?.() ??
          new Response(JSON.stringify(BODY), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      }) as typeof fetch,
    networkAllowed: () => state.allowed,
    onNetworkAllowed: (listener) => {
      state.consentSubscriptions += 1;
      consentListeners.push(listener);
      return () => {
        const at = consentListeners.indexOf(listener);
        if (at >= 0) consentListeners.splice(at, 1);
      };
    },
    onForeground: (listener) => {
      state.foregroundSubscriptions += 1;
      foregroundListeners.push(listener);
      return () => {
        const at = foregroundListeners.indexOf(listener);
        if (at >= 0) foregroundListeners.splice(at, 1);
      };
    },
    onFactsChanged: () => {
      state.changed += 1;
    },
    log: () => undefined,
    emitConsent: () => {
      for (const listener of [...consentListeners]) listener();
    },
    emitForeground: () => {
      for (const listener of [...foregroundListeners]) listener();
    },
    setAllowed: (value) => {
      state.allowed = value;
    },
    setBaseUrl: (value) => {
      state.baseUrl = value;
    },
  };
}

/**
 * 把 `void syncNow()` 那条链跑到收尾。
 *
 * ⚠️ **必须是宏任务**：那条链上有 fetch、`response.json()`、三次顺序写盘，
 * 数微任务的轮数是在猜它有几层 —— 猜少了就是"看着像没写进去"的假红（本轮真踩到）。
 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('公共事实的 web 接线', () => {
  it('🔴 闸门关着：零请求，但缓存照装、并且**敲了重算**（这条链不能因为没同意就整条不跑）', async () => {
    const ports = harness({ allowed: false });
    // 先塞一份缓存，模拟"上次同意时拉到过"。
    ports.values.set(META_KEYS.PUBLIC_FACTS_JSON, JSON.stringify(BODY));
    ports.values.set(META_KEYS.PUBLIC_FACTS_ETAG, BODY.version);

    const wiring = createPublicFactsWiring(ports);
    wiring.start();
    await flush();

    expect(ports.fetches, `闸门关着却发了 ${String(ports.fetches)} 个请求 —— G-12 那条前提就没了`).toBe(0);
    expect(ports.changed, '缓存装上了却没敲重算：日历会一直停在首屏那张没有标记的图上').toBe(1);
  });

  it('未配置服务端：同样零请求（自托管不该因为这条通道产生流量）', async () => {
    const ports = harness({ allowed: true, baseUrl: '' });
    const result = await createPublicFactsWiring(ports).syncNow();
    expect(result?.kind).toBe('unconfigured');
    expect(ports.fetches).toBe(0);
  });

  it('闸门开着 + 配了地址：拉到 ⇒ 写缓存 ⇒ 敲一次重算', async () => {
    const ports = harness({ allowed: true });
    const wiring = createPublicFactsWiring(ports);
    wiring.start();
    await flush();

    expect(ports.fetches).toBe(1);
    expect(typeof ports.values.get(META_KEYS.PUBLIC_FACTS_JSON)).toBe('string');
    expect(ports.changed).toBe(1);
  });

  it('刚点「同意」：补跑一次（订阅而不是让面板直接调）', async () => {
    const ports = harness({ allowed: false });
    const wiring = createPublicFactsWiring(ports);
    wiring.start();
    await flush();
    expect(ports.fetches).toBe(0);

    ports.setAllowed(true);
    ports.emitConsent();
    await flush();
    expect(ports.fetches, '用户点了同意之后这条链不会补跑 ⇒ 只有重启浏览器才看得到调休标记').toBe(1);
  });

  it('回前台：再拉一次（带 ETag 的条件请求，服务端没变就是 304）', async () => {
    const ports = harness({ allowed: true });
    const wiring = createPublicFactsWiring(ports);
    wiring.start();
    await flush();
    expect(ports.fetches).toBe(1);

    ports.emitForeground();
    await flush();
    expect(ports.fetches).toBe(2);
    // 第二次该带上第一次的 ETag —— 否则每次回前台都整份重传。
    expect(String(ports.values.get(META_KEYS.PUBLIC_FACTS_ETAG))).toBe(BODY.version);
  });

  it('🔴 拿不到（网络断了）：不敲重算、不抛、缓存不动 —— 判据①在宿主这一层的形状', async () => {
    const ports = harness({ allowed: true, respond: () => new Response(null, { status: 500 }) });
    const result = await createPublicFactsWiring(ports).syncNow();
    expect(result.kind).toBe('unavailable');
    expect(ports.changed).toBe(0);
    expect(ports.values.has(META_KEYS.PUBLIC_FACTS_JSON)).toBe(false);
  });

  it('start() 幂等：两套监听只装一份（严格模式会双调 effect）', () => {
    const ports = harness({ allowed: false });
    const wiring = createPublicFactsWiring(ports);
    wiring.start();
    wiring.start();
    wiring.start();
    expect(ports.consentSubscriptions).toBe(1);
    expect(ports.foregroundSubscriptions).toBe(1);

    wiring.stop();
    expect(ports.consentListeners).toHaveLength(0);
    expect(ports.foregroundListeners).toHaveLength(0);
  });
});
