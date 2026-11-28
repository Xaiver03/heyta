/**
 * web 壳的服务端 run/session journal 传输（ADR-0093，仅托管档）。
 *
 * 组装规则只有一份：core 在 `@heyta/app-host` 的 `startAssistantJournal`；这里只负责
 * 「web 的地址/令牌从 `useSyncStore` 现取」+ fetch。未登录/未配同步 ⇒ 返回 undefined，
 * 整套 journal 自动停用（本地/自备端点照常，不写服务端）。
 */
import type { JournalTransport } from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

function base(): { url: string; token: string } | undefined {
  const { baseUrl, token } = useSyncStore.getState();
  const url = baseUrl.trim();
  const tok = token?.trim();
  if (url === '' || tok === undefined || tok === '') return undefined;
  return { url: url.replace(/\/$/, ''), token: tok };
}

async function call(path: string, method: string, body?: unknown): Promise<unknown> {
  const cfg = base();
  if (cfg === undefined) throw new Error('sync-not-configured');
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`journal-http-${String(res.status)}`);
  return res.json();
}

export function createWebJournalTransport(): JournalTransport | undefined {
  if (base() === undefined) return undefined;
  return {
    createSession: async (input) => {
      const json = (await call('/api/ai/agent/sessions', 'POST', input)) as { data: { id: string } };
      return json.data.id;
    },
    createRun: async (sessionId) => {
      const json = (await call(`/api/ai/agent/sessions/${sessionId}/runs`, 'POST', {})) as { data: { id: string } };
      return json.data.id;
    },
    postEvent: async (input) => {
      await call(`/api/ai/agent/runs/${input.runId}/events`, 'POST', {
        seq: input.seq,
        type: input.type,
        payload: input.payload,
      });
    },
    finishRun: async (input) => {
      await call(`/api/ai/agent/runs/${input.runId}/finish`, 'POST', {
        status: input.status,
        ...(input.error === undefined ? {} : { error: input.error }),
      });
    },
  };
}
