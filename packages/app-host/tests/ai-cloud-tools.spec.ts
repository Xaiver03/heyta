/**
 * 云端工具客户端测试：证明"工具只打云端"的客户端半边成立，
 * 且产出的 `customTools` 形状可直接喂给 PI 内核 / 原生循环。
 */
import { describe, expect, it } from 'vitest';

import { LOCAL_API_TOOLS, type LocalApiConfig } from '@heyta/local-api';

import {
  createHttpCloudToolTransport,
  createServerToolTransport,
  toCloudAgentTools,
  toCloudToolDescriptors,
  type CloudToolTransport,
} from '../src/ai-cloud-tools.js';

function allGrants(): LocalApiConfig['grants'] {
  return Object.fromEntries(LOCAL_API_TOOLS.map((t) => [t.name, true])) as LocalApiConfig['grants'];
}

describe('云端工具描述（原生循环用）', () => {
  it('全授权时输出全部目录工具', () => {
    const descriptors = toCloudToolDescriptors(allGrants());
    expect(descriptors.length).toBe(LOCAL_API_TOOLS.length);
    for (const d of descriptors) {
      expect(typeof d.name).toBe('string');
      expect(d.parameters).toBeTypeOf('object');
    }
  });

  it('未授权即不可见', () => {
    const grants = { create_task: true, list_tasks: true } as LocalApiConfig['grants'];
    const names = toCloudToolDescriptors(grants).map((d) => d.name).sort();
    expect(names).toEqual(['create_task', 'list_tasks']);
  });
});

describe('PI 内核兼容的 customTools', () => {
  it('execute 经 transport 打云端，成功时返回 JSON 内容', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const transport: CloudToolTransport = {
      async invoke(name, args) {
        calls.push({ name, args });
        return { ok: true, data: [{ title: 'A' }, { title: 'B' }] };
      },
    };
    const tools = toCloudAgentTools(transport, allGrants());
    const listTasks = tools.find((t) => t.name === 'list_tasks');
    expect(listTasks).toBeDefined();
    const out = await listTasks!.execute('call-1', { completed: false });
    expect(calls).toEqual([{ name: 'list_tasks', args: { completed: false } }]);
    expect(out.content[0]?.type).toBe('text');
    expect(JSON.parse(out.content[0]!.text)).toEqual([{ title: 'A' }, { title: 'B' }]);
  });

  it('云端失败时抛错（pi-agent-core 约定：throw → isError 回给模型）', async () => {
    const transport: CloudToolTransport = {
      async invoke() {
        return { ok: false, reason: 'denied', message: '工具未授权。' };
      },
    };
    const tools = toCloudAgentTools(transport, allGrants());
    const create = tools.find((t) => t.name === 'create_task')!;
    await expect(create.execute('c', { title: 'x' })).rejects.toThrow('工具未授权。');
  });
});

describe('HTTP 传输', () => {
  it('构造正确请求（URL/method/Authorization/body）并解析成功信封', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ ok: true, data: { done: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const transport = createHttpCloudToolTransport({
      baseUrl: 'https://heyta.example/',
      getToken: () => 'tok-123',
      fetchImpl,
    });
    const result = await transport.invoke('complete_task', { taskId: 't1' });

    expect(result).toEqual({ ok: true, data: { done: true } });
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe('https://heyta.example/api/agent/tools/complete_task');
    expect(seen!.init.method).toBe('POST');
    expect((seen!.init.headers as Record<string, string>)['authorization']).toBe('Bearer tok-123');
    expect(JSON.parse(String(seen!.init.body))).toEqual({ args: { taskId: 't1' } });
  });

  it('服务端失败信封 → ok:false；网络异常 → ok:false network', async () => {
    const failFetch = (async () =>
      new Response(JSON.stringify({ ok: false, reason: 'rejected', message: '不行' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const r1 = await createHttpCloudToolTransport({ baseUrl: 'https://h', fetchImpl: failFetch }).invoke('x', {});
    expect(r1).toEqual({ ok: false, reason: 'rejected', message: '不行' });

    const throwFetch = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r2 = await createHttpCloudToolTransport({ baseUrl: 'https://h', fetchImpl: throwFetch }).invoke('x', {});
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('network');
  });
});

describe('createServerToolTransport（活取值器，前后端接线）', () => {
  it('每次现取 baseUrl/token；未配置地址 → not-configured', async () => {
    const seen: { url: string; auth?: string }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: String(url), auth: headers['authorization'] });
      return new Response(JSON.stringify({ ok: true, data: { ok: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    let token = 'tok-1';
    const transport = createServerToolTransport({ getBaseUrl: () => 'https://h', getToken: () => token, fetchImpl });
    await transport.invoke('list_tasks', {});
    token = 'tok-2';
    await transport.invoke('list_tasks', {});
    expect(seen[0]!.auth).toBe('Bearer tok-1');
    expect(seen[1]!.auth).toBe('Bearer tok-2');
    expect(seen[0]!.url).toBe('https://h/api/agent/tools/list_tasks');

    const none = createServerToolTransport({ getBaseUrl: () => '', getToken: () => undefined });
    const r = await none.invoke('x', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-configured');
  });
});
