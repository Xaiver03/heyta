/**
 * AI 设置的持久化语义 —— **隐私闸的 fail-closed 判据面**
 * =========================================================
 *
 * `parseAiSettingsState` / `createAiSettingsStore` 此前没有任何直接单测。
 * 这一层不是"存哪儿"，而是**四道闸是否关得上**的判断（文件头声称的四条）：
 *   1. `enabled` / `allowRemote` / `memoryEnabled` / `localApi.enabled` **只认逐字 true**
 *      —— `"true"`、`1`、`"yes"` 一律算关（ADR-0010/0014 的 fail-closed）；
 *   2. `localApi.bindAddress` **永不从存储里读**（只回落到回环地址）——
 *      读回来就是"一次配置篡改把本机服务静默暴露到局域网"（ADR-0011 §3.1）；
 *   3. 不合法端点 / 词表外的路由**直接丢掉**；
 *   4. 解析失败回全关默认值，**永不抛**。
 *
 * 这些点单独看都很小，但任何一处写宽松一点，症状都是"这台设备上那道闸其实没关上"，
 * 且**没有任何一层会报错**。每条断言都对着一个"删掉/改宽松即红"的实现点。
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_FEATURE_CAPABILITIES } from '@heyta/ai';

import {
  createAiSettingsStore,
  defaultAiSettingsState,
  parseAiSettingsState,
  type AiSettingsStorePort,
} from '../src/ai-settings-store.js';

/** 取两个真实存在的功能键（验证"只认词表内的路由 / 空链丢掉"）。 */
const FEATURE_KEYS = Object.keys(DEFAULT_FEATURE_CAPABILITIES);
const A_FEATURE_KEY = FEATURE_KEYS[0]!;
const B_FEATURE_KEY = FEATURE_KEYS[1]!;

describe('parseAiSettingsState —— 解析失败一律回全关默认值，永不抛', () => {
  it('undefined ⇒ 出厂默认（四道闸全关）', () => {
    expect(parseAiSettingsState(undefined)).toEqual(defaultAiSettingsState());
  });

  it('🔴 坏 JSON ⇒ 默认值，不抛（把 try/catch 去掉即抛红）', () => {
    expect(parseAiSettingsState('{ not json')).toEqual(defaultAiSettingsState());
  });

  it('🔴 顶层不是对象（123 / null / "x"）⇒ 默认值', () => {
    expect(parseAiSettingsState('123')).toEqual(defaultAiSettingsState());
    expect(parseAiSettingsState('null')).toEqual(defaultAiSettingsState());
    expect(parseAiSettingsState('"x"')).toEqual(defaultAiSettingsState());
  });
});

describe('parseAiSettingsState —— 布尔闸只认逐字 true（fail-closed）', () => {
  it('🔴 真值但非 true（"true" / 1 / "yes"）一律算关（把 ===true 改成真值判断即红）', () => {
    const raw = JSON.stringify({
      routing: { enabled: 'true', allowRemote: 1 },
      localApi: { enabled: 'yes' },
      memoryEnabled: 1,
    });
    const s = parseAiSettingsState(raw);
    expect(s.routing.enabled).toBe(false);
    expect(s.routing.allowRemote).toBe(false);
    expect(s.localApi.enabled).toBe(false);
    expect(s.memoryEnabled).toBe(false);
  });

  it('逐字 true 才真的打开（阳性对照，防"永远返回关"的假绿）', () => {
    const raw = JSON.stringify({
      routing: { enabled: true, allowRemote: true },
      localApi: { enabled: true },
      memoryEnabled: true,
    });
    const s = parseAiSettingsState(raw);
    expect(s.routing.enabled).toBe(true);
    expect(s.routing.allowRemote).toBe(true);
    expect(s.localApi.enabled).toBe(true);
    expect(s.memoryEnabled).toBe(true);
  });
});

describe('parseAiSettingsState —— bindAddress 永不从存储读（安全边界）', () => {
  it('🔴 存储里的 bindAddress=0.0.0.0 被无视，回落回环地址（读它即红）', () => {
    const s = parseAiSettingsState(JSON.stringify({ localApi: { bindAddress: '0.0.0.0', port: 8080 } }));
    expect(s.localApi.bindAddress).toBe(defaultAiSettingsState().localApi.bindAddress);
    expect(s.localApi.bindAddress).not.toBe('0.0.0.0');
    // 合法整数端口仍被保留。
    expect(s.localApi.port).toBe(8080);
  });

  it('🔴 端口必须是整数：小数 / 字符串 / 缺失 ⇒ 回落默认端口（删掉 isInteger 即红）', () => {
    const base = defaultAiSettingsState().localApi.port;
    expect(parseAiSettingsState(JSON.stringify({ localApi: { port: 1.5 } })).localApi.port).toBe(base);
    expect(parseAiSettingsState(JSON.stringify({ localApi: { port: '8080' } })).localApi.port).toBe(base);
    expect(parseAiSettingsState(JSON.stringify({ localApi: {} })).localApi.port).toBe(base);
  });

  it('token：空串被丢弃，非空字符串保留', () => {
    expect(parseAiSettingsState(JSON.stringify({ localApi: { token: '' } })).localApi.token).toBeUndefined();
    expect(parseAiSettingsState(JSON.stringify({ localApi: { token: 'abc' } })).localApi.token).toBe('abc');
  });
});

describe('parseAiSettingsState —— 端点 / 路由清洗（丢掉无效项）', () => {
  it('🔴 缺字段 / 非对象的端点被丢弃，只留完整的那条（保留全部即红）', () => {
    const s = parseAiSettingsState(
      JSON.stringify({
        routing: {
          endpoints: [
            { id: 'e1', label: 'L1', endpoint: 'http://localhost/v1', model: 'm1' },
            { id: 'e2', label: 'L2' }, // 缺 endpoint/model
            'not-an-object',
            null,
          ],
        },
      }),
    );
    expect(s.routing.endpoints.map((e) => e.id)).toEqual(['e1']);
  });

  it('🔴 路由只认词表内的功能键，词表外的丢掉；空候选链也丢掉', () => {
    const s = parseAiSettingsState(
      JSON.stringify({
        routing: {
          routes: {
            [A_FEATURE_KEY]: [{ endpointId: 'e1' }],
            [B_FEATURE_KEY]: [], // 已知功能键，但空链 ⇒ 丢掉
            'definitely-not-a-feature': [{ endpointId: 'e2' }], // 词表外 ⇒ 丢掉
          },
        },
      }),
    );
    const routes = s.routing.routes as Record<string, unknown>;
    expect(routes[A_FEATURE_KEY]).toEqual([{ endpointId: 'e1' }]);
    expect(B_FEATURE_KEY in routes).toBe(false);
    expect('definitely-not-a-feature' in routes).toBe(false);
  });

  it('🔴 mode 被保留：managed 原样、off/未知回落 own（2026-11-21 回归：丢 mode 会让托管账号没路由）', () => {
    expect(parseAiSettingsState(JSON.stringify({ routing: { mode: 'managed' } })).routing.mode).toBe('managed');
    expect(parseAiSettingsState(JSON.stringify({ routing: { mode: 'off' } })).routing.mode).toBe('own');
    expect(parseAiSettingsState(JSON.stringify({ routing: {} })).routing.mode).toBe('own');
  });

  it('健康快照：坏值不抛，版本回落到当前版本', () => {
    const s = parseAiSettingsState(JSON.stringify({ health: 'garbage' }));
    expect(s.health.version).toBe(defaultAiSettingsState().health.version);
    expect(Array.isArray(s.health.entries)).toBe(true);
  });
});

describe('createAiSettingsStore —— 壳通道：load/save/reset', () => {
  function fakePort(initial?: string): AiSettingsStorePort & { written: string[] } {
    let text = initial;
    const written: string[] = [];
    return {
      read: () => text,
      write: (v: string) => {
        text = v;
        written.push(v);
        return true;
      },
      written,
    };
  }

  it('load() 读通道并按同一套规则清洗', () => {
    const port = fakePort(JSON.stringify({ memoryEnabled: 1, routing: { enabled: true } }));
    const store = createAiSettingsStore(port);
    const s = store.load();
    expect(s.memoryEnabled).toBe(false); // 1 不算 true
    expect(s.routing.enabled).toBe(true);
  });

  it('🔴 save() 落盘前**再清洗一遍**：脏 state 写出去也变干净（删掉二次清洗即红）', () => {
    const port = fakePort(undefined);
    const store = createAiSettingsStore(port);
    const base = defaultAiSettingsState();
    const dirty = {
      ...base,
      routing: { ...base.routing, enabled: true },
      memoryEnabled: true,
      localApi: { ...base.localApi, bindAddress: '0.0.0.0' },
    };
    const ok = store.save(dirty);
    expect(ok).toBe(true);
    expect(port.written.length).toBe(1);
    // 写出去的 JSON 里 bindAddress 必须已被强制回环；布尔仍为真。
    const persisted = JSON.parse(port.written[0]!) as ReturnType<typeof defaultAiSettingsState>;
    expect(persisted.localApi.bindAddress).toBe(base.localApi.bindAddress);
    expect(persisted.routing.enabled).toBe(true);
    expect(persisted.memoryEnabled).toBe(true);
  });

  it('🔴 save() 如实返回是否落盘：write 返回 false ⇒ false；write 抛 ⇒ false 不冒泡', () => {
    const failPort: AiSettingsStorePort = { read: () => undefined, write: () => false };
    expect(createAiSettingsStore(failPort).save(defaultAiSettingsState())).toBe(false);

    const throwPort: AiSettingsStorePort = {
      read: () => undefined,
      write: () => {
        throw new Error('disk full');
      },
    };
    expect(createAiSettingsStore(throwPort).save(defaultAiSettingsState())).toBe(false);
  });

  it('reset() 写回出厂默认', () => {
    const port = fakePort('{"memoryEnabled":true}');
    const store = createAiSettingsStore(port);
    expect(store.reset()).toBe(true);
    const persisted = JSON.parse(port.written[0]!) as ReturnType<typeof defaultAiSettingsState>;
    expect(persisted.memoryEnabled).toBe(false);
    expect(persisted.routing.enabled).toBe(false);
  });
});
