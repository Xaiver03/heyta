/**
 * 云端 Agent 工具 API —— 契约见 `docs/reference/agent-tools-api.md`。
 *
 * 本插件只做**网关语义**：鉴权、按账号授权过滤、风险档拦截、幂等、错误信封。
 * **工具的实际执行由注入的 `execute` 提供**（读/写落在服务端数据层，属独立实现），
 * 避免把业务执行逻辑塞进 vendored 路由层。
 *
 * ⚠️ 本文件**尚未在 `server/src/api.ts` 注册**：注册需要把"账号授权来源(grants)"与
 * "工具执行器(execute)"接到真实服务端数据层（当前服务端无逐实体业务 REST），属独立工作。
 * 这里先固定端点形状 + 语义，并用注入测试钉住判据。
 */
import type { FastifyPluginAsync } from 'fastify';

export type AgentToolRisk = 'read' | 'write' | 'destructive-reversible' | 'destructive-irreversible';

export interface AgentToolCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly risk: AgentToolRisk;
}

export type AgentToolExecuteResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export interface AgentToolsRoutesOptions {
  /** canonical 工具目录（来自唯一事实源 `@heyta/local-api` 生成，勿手抄）。 */
  readonly catalog: readonly AgentToolCatalogEntry[];
  /** 该账号逐工具授权（服务端权威）。 */
  resolveGrants: (userId: string) => Promise<Record<string, boolean>> | Record<string, boolean>;
  /** 工具执行器；缺省则 POST 返回 501（尚未接入数据层）。 */
  execute?: (name: string, args: Record<string, unknown>, ctx: { userId: string }) => Promise<AgentToolExecuteResult>;
}

function userIdOf(request: unknown): string | undefined {
  const user = (request as { user?: { id?: number | string } }).user;
  if (user === undefined || user.id === undefined) return undefined;
  return String(user.id);
}

export const agentToolsRoutes: FastifyPluginAsync<AgentToolsRoutesOptions> = async (app, options) => {
  // 幂等缓存：写成功结果按 (userId, tool, idempotency-key) 复用。进程内、有界、够覆盖重试。
  const idempotency = new Map<string, AgentToolExecuteResult>();
  const MAX_IDEMPOTENCY = 2048;

  app.get('/api/agent/tools', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) {
      reply.code(401);
      return { ok: false, reason: 'unauthorized', message: '未登录。' };
    }
    const grants = await options.resolveGrants(userId);
    const tools = options.catalog
      .filter((tool) => grants[tool.name] === true && tool.risk !== 'destructive-irreversible')
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters, risk: tool.risk }));
    return { ok: true, data: { tools } };
  });

  app.post('/api/agent/tools/:name', async (request, reply) => {
    const userId = userIdOf(request);
    if (userId === undefined) {
      reply.code(401);
      return { ok: false, reason: 'unauthorized', message: '未登录。' };
    }
    const name = (request.params as { name: string }).name;
    const entry = options.catalog.find((tool) => tool.name === name);
    if (entry === undefined) {
      reply.code(404);
      return { ok: false, reason: 'not-found', message: '没有这个工具。' };
    }
    const grants = await options.resolveGrants(userId);
    if (grants[name] !== true) {
      reply.code(403);
      return { ok: false, reason: 'not-granted', message: '这个工具没有授权给该账号。' };
    }
    if (entry.risk === 'destructive-irreversible') {
      reply.code(403);
      return { ok: false, reason: 'irreversible-blocked', message: '该动作不可由 AI 执行。' };
    }
    if (options.execute === undefined) {
      reply.code(501);
      return { ok: false, reason: 'not-implemented', message: '工具执行尚未接入服务端数据层。' };
    }

    const header = request.headers['idempotency-key'];
    const idemKey =
      typeof header === 'string' && header !== '' ? `${userId}:${name}:${header}` : undefined;
    if (idemKey !== undefined) {
      const cached = idempotency.get(idemKey);
      if (cached !== undefined) return cached;
    }

    const body = request.body as { args?: Record<string, unknown> } | undefined;
    const args = body?.args ?? {};
    const result = await options.execute(name, args, { userId });

    if (idemKey !== undefined && result.ok) {
      if (idempotency.size >= MAX_IDEMPOTENCY) {
        const oldest = idempotency.keys().next().value;
        if (oldest !== undefined) idempotency.delete(oldest);
      }
      idempotency.set(idemKey, result);
    }
    return result;
  });
};
