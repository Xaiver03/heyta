import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SERVER_HELMET_CONFIG } from '../src/server';
import { WEB_APP_CSP, registerWebApp, resolveWebAppMount } from '../src/web-app';

/**
 * 共享 UI 挂在服务端时**必须守住的边界**。
 *
 * ## 为什么这份用例的形状是"最小 Fastify + 真实注册顺序"
 *
 * 这里要证的不是业务，是**路由优先级与响应头归属**：`public/` 已经用 `prefix: '/'`
 * 注册过一次静态（它会注册一个 `/*` 通配），共享 UI 再注册一个 `/app/*`，
 * 谁赢由 find-my-way 的"静态段优先于通配"决定 —— 而这件事与数据库、鉴权、计费都无关，
 * 把它们拖进来只会让失败原因更难读。真实镜像里端到端能不能注册、能不能登录同步，
 * 由 `docs/runbooks/` 那条带截图的验收负责（AGENTS §6.2 规定一），不在这里冒充已证。
 *
 * ## 两条最值钱的判据
 *
 * - **兜底不许吞掉 API**：SPA fallback 如果挂在全局，`/api/nope` 会拿到
 *   `200 + HTML`，客户端随后报出来的是"MIME 不是 JSON" —— 归因成本极高。
 *   所以这里断言的是 404 且正文不是 HTML。
 * - **CSP 只改给应用**：`SERVER_HELMET_CONFIG` 那份是为凭据页写的，没有
 *   `'wasm-unsafe-eval'`（SQLite 存储就是 wasm）。用同一个 `onSend` 手法把全局那份
 *   盖到 `/health` 上，是把"过度放权"变成可失败的断言，而不是靠注释约束。
 */

const tmpDirs: string[] = [];

/** 造一份产物目录（index.html + 一个带哈希的资源）。 */
const makeWebDist = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-web-dist-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><title>heyta</title><div id="root"></div>' +
      '<script type="module" src="/app/assets/index-ABC123.js"></script>\n',
  );
  fs.writeFileSync(path.join(dir, 'assets', 'index-ABC123.js'), 'console.log("heyta");\n');
  return dir;
};

/** `public/` 的替身：只有一个凭据页，用来证明全局静态仍然工作。 */
const makePublicDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-public-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'recover-passkey.html'), '<p>credential page</p>\n');
  return dir;
};

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const buildServer = async (webAppDir: string | null): Promise<FastifyInstance> => {
  const server = Fastify();
  await server.register(helmet, SERVER_HELMET_CONFIG);
  await server.register(fastifyStatic, { root: makePublicDir(), prefix: '/' });
  server.get('/health', async () => ({ status: 'ok' }));
  // 与生产一致：这些是真实存在的前缀，用来验证兜底没有把它们吃掉。
  server.get('/api/sync/upload', async () => ({ ok: true }));
  await registerWebApp(server, resolveWebAppMount({ webAppDir: webAppDir ?? '', webAppPath: '/app/' }));
  await server.ready();
  return server;
};

describe('共享 UI 的服务端挂载', () => {
  it('产物存在时：前缀内给 index.html，且带的是应用那份 CSP', async () => {
    const server = await buildServer(makeWebDist());
    const response = await server.inject({ method: 'GET', url: '/app/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('id="root"');
    expect(String(response.headers['content-security-policy'])).toBe(WEB_APP_CSP);
    expect(WEB_APP_CSP).toContain('wasm-unsafe-eval');
    await server.close();
  });

  it('带哈希的资源能取到（这是"挂在 /app/ 而不是 /"的直接后果）', async () => {
    const server = await buildServer(makeWebDist());
    const response = await server.inject({ method: 'GET', url: '/app/assets/index-ABC123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('heyta');
    await server.close();
  });

  it('前缀内的未知路径走 SPA 兜底，且兜底页不许被长期缓存', async () => {
    const server = await buildServer(makeWebDist());
    const response = await server.inject({ method: 'GET', url: '/app/tasks/123' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('id="root"');
    expect(response.headers['cache-control']).toBe('no-cache');
    await server.close();
  });

  it('🔴 兜底不许吃掉 API：拼错的前缀仍然是 404，且正文不是 HTML', async () => {
    const server = await buildServer(makeWebDist());
    const response = await server.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('id="root"');
    expect(response.headers['content-type'] ?? '').not.toContain('text/html');
    await server.close();
  });

  it('🔴 CSP 只改给应用：/health 与凭据页仍然是全局那份（没有 wasm 权限）', async () => {
    const server = await buildServer(makeWebDist());
    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(String(health.headers['content-security-policy'])).not.toContain('wasm-unsafe-eval');
    const credential = await server.inject({ method: 'GET', url: '/recover-passkey.html' });
    expect(credential.statusCode).toBe(200);
    expect(String(credential.headers['content-security-policy'])).not.toContain('wasm-unsafe-eval');
    await server.close();
  });

  it('没有产物时不挂：前缀内就是 404，而不是一个看起来能用的空页面', async () => {
    const server = await buildServer(null);
    const response = await server.inject({ method: 'GET', url: '/app/' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('id="root"');
    await server.close();
  });

  it('目录在但缺 index.html 也不算"挂着"（这是开关的全部判据）', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-web-empty-'));
    tmpDirs.push(empty);
    expect(resolveWebAppMount({ webAppDir: empty, webAppPath: '/app/' })).toBeNull();
  });

  it('🔴 占用保留前缀是**报错**，不是退到别处', () => {
    for (const bad of ['/', '/api/', '/health/', '/ws/']) {
      expect(() => resolveWebAppMount({ webAppDir: makeWebDist(), webAppPath: bad })).toThrow(
        /保留路径/,
      );
    }
  });

  /**
   * 形状的校验住在 `loadConfigFromEnv`，**不在** `resolveWebAppMount` ——
   * 所以这里的判据必须打到 config 那一层。
   * （先前一版把它写成对 `resolveWebAppMount` 断"不抛错"，那是一条永远绿的空判据：
   * 它既没测到校验，又把"没有校验"固定成了期望。）
   */
  describe('env 取值严格：拼错要报错，不许静默落到"没界面"', () => {
    const originalEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...originalEnv };
    });

    const load = async (env: Record<string, string>) => {
      process.env = { ...originalEnv, ...env };
      const { loadConfigFromEnv } = await import('../src/config');
      return loadConfigFromEnv();
    };

    it('WEB_APP_PATH 首尾缺斜杠 ⇒ 启动就报错', async () => {
      await expect(load({ WEB_APP_PATH: 'app/' })).rejects.toThrow(/WEB_APP_PATH/);
      await expect(load({ WEB_APP_PATH: '/app' })).rejects.toThrow(/WEB_APP_PATH/);
    });

    it('WEB_APP_DIR 给了相对路径 ⇒ 报错；空串是合法的"显式不挂"', async () => {
      await expect(load({ WEB_APP_DIR: 'web-dist' })).rejects.toThrow(/WEB_APP_DIR/);
      const config = await load({ WEB_APP_DIR: '' });
      expect(config.webAppDir).toBe('');
    });

    it('两个都不设时用默认值（官方与自托管同一档，不需要谁去开）', async () => {
      const config = await load({});
      expect(config.webAppDir).toBe('/app/web-dist');
      expect(config.webAppPath).toBe('/app/');
    });
  });
});
