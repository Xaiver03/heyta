/**
 * 管理后台 —— AI 网关配置（上游增删改查 / 试连 / 启停）。
 *
 * 与 `admin.routes.ts` 同一道闸门（插件级 `preHandler`），忘写鉴权不可能。
 * 存储与选择逻辑在 `../ai/gateway-store` / `../ai/ai-gateway`。
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { requireAdmin } from './admin.middleware';
import { redactUpstreams, type GatewayUpstream } from '../ai/ai-gateway';
import { loadGatewayUpstreams, saveGatewayUpstreams } from '../ai/gateway-store';

export interface AiGatewayRoutesOptions {
  /** 鉴权钩子（生产默认 `requireAdmin`；测试可注入）。 */
  readonly authenticate?: (request: unknown, reply: unknown) => Promise<unknown> | unknown;
  /** 覆盖存储文件（测试）。 */
  readonly file?: string;
  /** 覆盖 env（测试）。 */
  readonly env?: Record<string, string | undefined>;
  /** 注入 fetch（试连测试）。 */
  readonly fetchImpl?: typeof fetch;
}

function view(upstreams: readonly GatewayUpstream[]) {
  return redactUpstreams(upstreams);
}

export const aiGatewayRoutes: FastifyPluginAsync<AiGatewayRoutesOptions> = async (app, options) => {
  app.addHook('preHandler', (options.authenticate ?? (requireAdmin as unknown as AiGatewayRoutesOptions['authenticate']))!);
  const env = options.env ?? process.env;
  const file = options.file;
  const load = () => loadGatewayUpstreams(env, file ?? undefined);
  const save = (list: readonly unknown[]) => saveGatewayUpstreams(list, env, file ?? undefined);

  app.get('/ai-gateway', async () => {
    const g = load();
    return { ok: true, source: g.source, upstreams: view(g.upstreams), skipped: g.skipped };
  });

  app.put('/ai-gateway', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { upstreams?: unknown } | undefined;
    if (body === undefined || !Array.isArray(body.upstreams)) {
      reply.code(400);
      return { ok: false, code: 'invalid-body', message: 'body.upstreams 必须是数组。' };
    }
    try {
      // 省略/空 apiKey 的条目：按 id 沿用已存密钥（「只改展示名/模型」不该把密钥清空）。
      const existing = load().upstreams;
      const merged = (body.upstreams as unknown[]).map((item) => {
        if (item === null || typeof item !== 'object') return item;
        const u = item as Record<string, unknown>;
        const blank = u['apiKey'] === undefined || u['apiKey'] === '';
        if (blank && typeof u['id'] === 'string') {
          const old = existing.find((e) => e.id === u['id']);
          if (old !== undefined) return { ...u, apiKey: old.apiKey };
        }
        return item;
      });
      const saved = save(merged);
      return { ok: true, upstreams: view(saved.upstreams) };
    } catch (error: unknown) {
      reply.code(400);
      return { ok: false, code: (error as { code?: string }).code ?? 'invalid', message: error instanceof Error ? error.message : '保存失败。' };
    }
  });

  app.post('/ai-gateway/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id?: unknown } | undefined;
    const id = typeof body?.id === 'string' ? body.id : undefined;
    if (id === undefined) {
      reply.code(400);
      return { ok: false, code: 'invalid-body', message: 'body.id 必填。' };
    }
    const target = load().upstreams.find((u) => u.id === id);
    if (target === undefined) {
      reply.code(404);
      return { ok: false, code: 'not-found', message: '没有这条上游。' };
    }
    // 只允许 https（与本仓"明文不走公网"一致）；试连 GET /models。
    if (!target.baseUrl.startsWith('https://')) {
      reply.code(400);
      return { ok: false, code: 'insecure-url', message: '上游必须是 https。' };
    }
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await doFetch(`${target.baseUrl}/models`, {
        method: 'GET',
        headers: target.apiKey === '' ? {} : { authorization: `Bearer ${target.apiKey}` },
        signal: ctrl.signal,
      });
      return { ok: res.ok, status: res.status };
    } catch (error: unknown) {
      return { ok: false, status: 0, message: error instanceof Error ? error.message : '连接失败' };
    } finally {
      clearTimeout(timer);
    }
  });
};
