/**
 * 全局错误信封的**行为**判据（2026-10-10 晚，回答"真的全部归一了吗"）
 * ================================================================
 *
 * 门禁 `check-server-error-shape.mjs` 只能拦**字面量**的旧形状；这一份钉的是
 * 真实注入下的响应体。起因是复核时抓到的两个真洞：
 *
 *   1. **404 不走 setErrorHandler**（Fastify 的路由器 404 交给 not-found
 *      handler，默认形状是 `{message, error, statusCode}`）—— 打一个不存在的
 *      /api 路径就能看到旧形状；
 *   2. **`FST_ERR_*` 框架码外泄**（坏 JSON 的响应带着 Fastify 内部码出线）。
 *
 * 两处都已修（`attachErrorEnvelope`）；这一份用**穷举注入**保证它们不会回来，
 * 且每一条响应体都过 `isApiErrorBody`（shared-schema 的唯一形状判据）——
 * 任何一条带上 `error`/`statusCode` 旧键，这里当场红。
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { isApiErrorBody } from '@heyta/shared-schema';

import { attachErrorEnvelope } from '../src/api-error.js';

const buildApp = async (): Promise<ReturnType<typeof Fastify>> => {
  const app = Fastify({ logger: false });
  attachErrorEnvelope(app);
  app.post('/echo', async (req) => ({ echoed: req.body }));
  app.post('/boom', async () => {
    throw new Error('数据库主机名 db.internal 不可达'); // 5xx：原始细节必须脱敏
  });
  app.get('/conflicted', async () => {
    // 路由自己抛的、带状态码与稳定码的错误：信封要认它，不折成通用码。
    const err = Object.assign(new Error('version bumped concurrently'), { statusCode: 409, code: 'version_mismatch' });
    throw err;
  });
  await app.ready();
  return app;
};

describe('全局错误信封（真实注入）', () => {
  it('未知路径（404）也是信封 —— 此前它是 {message, error, statusCode} 旧形状', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/no-such-route' });
    expect(res.statusCode).toBe(404);
    const body = res.json() as Record<string, unknown>;
    expect(isApiErrorBody(body)).toBe(true);
    expect(body).toEqual({ code: 'not_found', message: 'Not Found' });
    await app.close();
  });

  it('坏 JSON（400）走通用码，FST_ERR_* 框架码不出线', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not-json',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as Record<string, unknown>;
    expect(isApiErrorBody(body)).toBe(true);
    expect(String(body['code'])).not.toMatch(/^FST_/);
    expect(String(body['code'])).toBe('validation_failed');
    await app.close();
  });

  it('5xx：脱敏成 internal_error，原始细节（DB 主机名）一个字都不出线', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/boom', payload: {} });
    expect(res.statusCode).toBe(500);
    const body = res.json() as Record<string, unknown>;
    expect(isApiErrorBody(body)).toBe(true);
    expect(body['code']).toBe('internal_error');
    expect(res.body).not.toContain('db.internal');
    await app.close();
  });

  it('路由自己抛的稳定码（409 + version_mismatch）被信封认领，不折成通用码', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/conflicted' });
    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({ code: 'version_mismatch', message: 'version bumped concurrently' });
    await app.close();
  });

  it('方法不匹配也落信封（405 档），不带旧键', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: '/echo', payload: {} });
    const body = res.json() as Record<string, unknown>;
    expect(isApiErrorBody(body)).toBe(true);
    expect(body['error']).toBeUndefined();
    expect(body['statusCode']).toBeUndefined();
    await app.close();
  });
});
