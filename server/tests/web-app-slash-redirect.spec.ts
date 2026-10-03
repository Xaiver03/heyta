import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SERVER_HELMET_CONFIG } from '../src/server';
import { registerWebApp, resolveWebAppMount } from '../src/web-app';

/**
 * `/app`（**无尾斜杠**）必须重定向到 `/app/`，且查询串跟着走。
 *
 * ## 复现读数（改前，同一份最小实例）
 *
 * | 请求 | 改前 | 改后 |
 * |---|---|---|
 * | `GET /app/` | 200 `text/html` | 200 `text/html`（没动） |
 * | `GET /app` | **404 `application/json`** | 307 → `Location: /app/` |
 * | `GET /app?lang=zh` | **404 `application/json`** | 307 → `Location: /app/?lang=zh` |
 *
 * 成因不是"路由没注册"，是 `@fastify/static` 的 `prefix: '/'` 注册出来的是
 * `/app/*` 通配，而 find-my-way 的 `/*` **不匹配没有尾斜杠的父路径**；封装作用域里
 * 那个 `setNotFoundHandler` 又用 `request.url.startsWith('/app/')` 判断，`/app`
 * 连它都进不去 ⇒ 落到默认 404（JSON）。Fastify 自己既不规范、也不重定向。
 *
 * 用户侧的症状是"页面打不开"，而落地页给的入口地址**故意去掉尾斜杠**
 * （`apps/landing/src/lib/app-url.ts`），所以点的正是这条路。
 * 线上此前靠宿主 nginx 的 `location = /app { return 301 /app/$is_args$args; }`
 * （`docs/runbooks/deployment.md` §3.3.1）。界面改由服务端自己挂之后，
 * **这件事必须由服务端自己做** —— 自托管的人不会记得补那条 nginx 规则，
 * 而少它的表现和"服务坏了"长得一模一样（一个 JSON 404，零请求打到应用里）。
 *
 * ## 这份用例里最值钱的三条
 *
 * 1. **反向对照**：重定向必须是**静态精确路径**，不能是 `startsWith` 一类的宽判断 ——
 *    写宽了的形态是 `/api/x` 被重定向成 `/api/x/`，那会把整个 API 打成不可用，
 *    而且症状出现在客户端而不是服务端。所以逐个保留前缀断言"不许有 3xx、不许有 Location"。
 * 2. **不许写死 `/app`**：前缀是每台实例自己配的（`WEB_APP_PATH`）。用第二个前缀
 *    各跑一遍，写死的实现会在这一条上红。
 * 3. **没挂界面时不许变 500**：这条重定向只在挂载时注册；`mount === null` 时
 *    `/app` 的行为必须还是原来那个 404，不能因为"顺手加了个 hook"变成服务端错误。
 *
 * 载体：最小 Fastify + **与生产一致的注册顺序**（全局静态 `/` → `/health` → `/api/*` →
 * 最后 `registerWebApp`），零数据库、零鉴权。这里证的是**路由优先级**，
 * 端到端能不能真打开界面由 `docs/runbooks/` 那条带截图的验收负责（AGENTS §6.2 规定一）。
 */

const tmpDirs: string[] = [];

const makeWebDist = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-slash-dist-'));
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

/** `public/` 的替身：它用 `prefix: '/'` 注册，会抢 `/app` —— 静态路由必须赢过它的通配。 */
const makePublicDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-slash-public-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'recover-passkey.html'), '<p>credential page</p>\n');
  return dir;
};

/** 目录在、但没有 `index.html`：这台实例同样算"没挂界面"。 */
const makeEmptyDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-slash-empty-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 与 `src/server.ts` 同形状的最小实例：静态在前、API 在前、共享 UI 最后挂。 */
const buildServer = async (opts: {
  webAppDir: string | null;
  webAppPath?: string;
}): Promise<FastifyInstance> => {
  const server = Fastify();
  await server.register(helmet, SERVER_HELMET_CONFIG);
  await server.register(fastifyStatic, { root: makePublicDir(), prefix: '/' });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/live', async () => ({ ok: true }));
  server.get('/api/sync/upload', async () => ({ ok: true }));
  await registerWebApp(
    server,
    resolveWebAppMount({
      webAppDir: opts.webAppDir ?? '',
      webAppPath: opts.webAppPath ?? '/app/',
    }),
  );
  await server.ready();
  return server;
};

const locationOf = (response: { headers: Record<string, unknown> | string }): string | null => {
  const raw = (response.headers as Record<string, unknown>)['location'];
  return typeof raw === 'string' ? raw : null;
};

describe('共享 UI 的无尾斜杠入口（/app → /app/）', () => {
  it('GET /app → 307，Location 指向 /app/（不是 404 JSON，用户看到的"页面打不开"就是它）', async () => {
    const server = await buildServer({ webAppDir: makeWebDist() });
    const response = await server.inject({ method: 'GET', url: '/app' });
    // 307 而不是 301/308：301 会把 POST 改写成 GET，308 会被浏览器长期缓存 ——
    // 而挂载前缀是每台实例自己配的（WEB_APP_PATH），缓存住就等于改了前缀也解不开。
    // 要换成别的码，连这条断言和 web-app.ts 上面那段理由一起改。
    expect(response.statusCode).toBe(307);
    expect(locationOf(response)).toBe('/app/');
    await server.close();
  });

  it('查询串逐字节保留（?lang=en 必须跟着走，否则英文用户又回到中文应用）', async () => {
    const server = await buildServer({ webAppDir: makeWebDist() });
    const cases: Array<[string, string]> = [
      ['/app?lang=zh', '/app/?lang=zh'],
      ['/app?lang=en', '/app/?lang=en'],
      // 多个参数 + 已编码的字符：要原样透传，不许重新编码、不许只留第一个。
      ['/app?a=1&b=%2F2', '/app/?a=1&b=%2F2'],
      // 无值参数也要跟着走（`?debug` 不是 `无查询串`）。
      ['/app?debug', '/app/?debug'],
    ];
    for (const [url, expected] of cases) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(307);
      expect(locationOf(response), url).toBe(expected);
    }
    // 只有一个 `?`：空查询串在 HTTP 解析层就已经不存在了（不是这里丢的），
    // 所以两种落点都算对 —— 钉死其中一种就是拿测试载体当规格书。
    const bareQuestion = await server.inject({ method: 'GET', url: '/app?' });
    expect(bareQuestion.statusCode).toBe(307);
    expect(['/app/', '/app/?']).toContain(locationOf(bareQuestion));
    await server.close();
  });

  it('带斜杠的入口不受影响：/app/ 与 /app/?lang=zh 仍然是 200 的 HTML', async () => {
    const server = await buildServer({ webAppDir: makeWebDist() });
    for (const url of ['/app/', '/app/?lang=zh']) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type'], url).toContain('text/html');
      expect(response.body, url).toContain('id="root"');
    }
    // 资源与 SPA 深链也不许被这条新路由抢走。
    const asset = await server.inject({ method: 'GET', url: '/app/assets/index-ABC123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    const deep = await server.inject({ method: 'GET', url: '/app/tasks/123' });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('id="root"');
    await server.close();
  });

  it('🔴 反向对照：保留前缀一条都不许被重定向吞掉（尤其 /api/x 不许变成 /api/x/）', async () => {
    const server = await buildServer({ webAppDir: makeWebDist() });
    const urls = [
      '/api',
      '/api/',
      '/api/nope',
      '/api/sync/upload',
      '/health',
      '/live',
      '/ws',
      '/recover-passkey.html',
      '/',
      '/appp', // 前缀相似但不是那个路径
      '/app2',
      '/app/extra',
    ];
    for (const url of urls) {
      const response = await server.inject({ method: 'GET', url });
      // 只钉"不是 3xx、没有 Location"，不钉具体码：`/` 在这份夹具里本来就是 404
      // （public/ 替身里没有 index.html），那是夹具形状不是新缺陷。
      // 3xx 一条都不许出现 —— 重定向写宽了的形态是 `/api/x → /api/x/`，
      // 那会把整个 API 打成不可用，而症状出现在客户端、不在服务端。
      expect(response.statusCode >= 300 && response.statusCode < 400, url).toBe(false);
      expect(locationOf(response), url).toBeNull();
    }
    // 真路由仍然到得了（不只是"没被重定向"，还要"没被 404 掉"）。
    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const upload = await server.inject({ method: 'GET', url: '/api/sync/upload' });
    expect(upload.statusCode).toBe(200);
    await server.close();
  });

  it('🔴 前缀不写死：挂到 /ui/ 时重定向的是 /ui，而 /app 一个字都不该动', async () => {
    const server = await buildServer({ webAppDir: makeWebDist(), webAppPath: '/ui/' });
    const bare = await server.inject({ method: 'GET', url: '/ui?lang=zh' });
    expect(bare.statusCode).toBe(307);
    expect(locationOf(bare)).toBe('/ui/?lang=zh');
    const indexed = await server.inject({ method: 'GET', url: '/ui/' });
    expect(indexed.statusCode).toBe(200);
    expect(indexed.body).toContain('id="root"');
    // 写死成 `/app` 的实现会在这一句上红。
    const stale = await server.inject({ method: 'GET', url: '/app' });
    expect(stale.statusCode).toBe(404);
    expect(locationOf(stale)).toBeNull();
    await server.close();
  });

  it('🔴 没挂界面的实例：/app 不许变成 500（mount 为 null 时这条重定向压根不注册）', async () => {
    // 两种"没有产物"：WEB_APP_DIR 为空串（显式不挂）与目录存在但没有 index.html。
    const servers = [
      await buildServer({ webAppDir: null }),
      await buildServer({ webAppDir: makeEmptyDir() }),
    ];

    for (const server of servers) {
      for (const url of ['/app', '/app?lang=zh', '/app/']) {
        const response = await server.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBeLessThan(500);
        // 行为与加这条重定向**之前逐字相同**：仍然是那个 JSON 404。
        expect(response.statusCode, url).toBe(404);
        // 也不许凭空造出一个指向 404 页面的重定向。
        expect(locationOf(response), url).toBeNull();
      }
      await server.close();
    }
  });

  it('HEAD /app 同样重定向（浏览器预取与部分代理会用它，Fastify 对 GET 路由自动镜像 HEAD）', async () => {
    const server = await buildServer({ webAppDir: makeWebDist() });
    const response = await server.inject({ method: 'HEAD', url: '/app?lang=zh' });
    expect(response.statusCode).toBe(307);
    expect(locationOf(response)).toBe('/app/?lang=zh');
    await server.close();
  });
});
