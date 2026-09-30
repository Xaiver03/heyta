#!/usr/bin/env node
/**
 * Web 认证旅程验收：注册 → 登录 → 同步 → 新设备恢复 → 退出登录
 * ================================================================
 *
 * 起一个真实服务端（TEST_MODE + WebAuthn 环境变量），然后跑
 * `e2e/auth-journey/` 的真浏览器套件。链路里**没有 mock**：
 * 真注册端点 → 真 PostgreSQL 账号 → 真 JWT → 真 op 上传/下载；
 * 唯一被替掉的是 WebAuthn 的"系统弹窗"（CDP 虚拟认证器真实应答，
 * challenge/签名/origin 校验全部真实发生 —— 见 helpers.ts 的说明）。
 *
 * 为什么必须有它：在此之前，
 *   - `apps/web/tests/`（jsdom）验过注册/登录的**逻辑**，但 jsdom 里
 *     连布局都没有，"系统弹窗"那一步本来就是注入的；
 *   - `pnpm verify:multi-end` 验过**同步**，但凭据是 shell 建号后注入的，
 *     界面上的注册/登录入口一次都没被点过。
 * 于是"一个新用户从打开应用到他的数据出现在第二台设备上"这条完整的
 * 旅程，没有任何一层真正走过 —— 本脚本就是补上这一层的。
 *
 * 用法：
 *   pnpm verify:web-auth
 *
 * 前置：本机 Postgres（127.0.0.1:5432，与 verify:p1 同一套约定）、
 *       server/dist 已构建（没有就自动构建一次）、Playwright chromium 已安装。
 *
 * ⚠️ 服务端引导（建库 / 迁移 / 启动 / WebAuthn 三元组）住在
 *    `scripts/lib/auth-journey-server.mjs` —— 桌面壳那条路（
 *    `scripts/verify-windows-shell-journey.mjs`）用的是**同一份**。
 *    改这里之前先想清楚会不会把那边一起改坏。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  databaseUrlFor,
  ensureDatabase,
  ensureServerBuilt,
  installCleanup,
  resolveNode,
  startServer,
} from './lib/auth-journey-server.mjs';

const NODE = resolveNode();

// ⚠️ 必须用 fileURLToPath：`new URL(...).pathname` 会把路径里的空格转义成 %20，
// 而 heyta 的检出路径里**真的有空格**（"All in one Data"）。
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const PORT = process.env['HEYTA_AUTH_JOURNEY_PORT'] ?? '3211';
const WEB_PORT = '4329'; // 与 playwright.auth-journey.config.ts 保持一致
const BASE = `http://127.0.0.1:${PORT}`;

// 🔴 独立的验收库：与 verify:p1 的 `heyta_sync_smoke`、移动端的
// `heyta_mobile_smoke` 互不踩。每轮换新账号（见套件文件头），但库本身复用。
const DB_NAME = process.env['HEYTA_VERIFY_DB_NAME'] ?? 'heyta_web_auth_smoke';
const DB_URL = databaseUrlFor(DB_NAME);

console.log('\n=== Web 认证旅程验收（真浏览器 + 真服务端 + 真 WebAuthn）===\n');

if (process.env['DATABASE_URL']) {
  console.log('⚠️  检测到环境变量 DATABASE_URL，已用验收库覆盖（避免污染）');
}

console.log(`· node: ${NODE}`);
console.log(`· 数据库: ${DB_NAME}`);
console.log(`· 服务端: ${BASE}   Web 应用: http://localhost:${WEB_PORT}`);

ensureDatabase({ root: ROOT, dbUrl: DB_URL, dbName: DB_NAME });
ensureServerBuilt({ root: ROOT, dbUrl: DB_URL });

const server = await startServer({
  root: ROOT,
  node: NODE,
  port: PORT,
  dbUrl: DB_URL,
  // 🔴 **CORS 默认只放行上游域名**（`DEFAULT_CORS_ORIGINS = ['https://app.super-productivity.com']`）
  // —— 不设这条，浏览器侧的注册请求会被预检拦掉，界面报"连不上服务端"
  // 而服务端日志一片干净（`verify:multi-end` 已记录过同一个坑）。
  corsOrigins: [`http://localhost:${WEB_PORT}`],
  // 🔴 WebAuthn 三元组必须与**浏览器侧的 origin** 一致，否则服务端验签必然失败
  // （expectedOrigin 不匹配）。Web 应用跑在 **`localhost:4329`** ——
  // **不能用 `127.0.0.1`**：RP ID 必须是 origin 的域名后缀，而 Chromium
  // **拒收 IP 字面量**做 RP ID（2026-09-30 实测：那条旅程因此走不到注册成功）。
  rpId: 'localhost',
  origin: `http://localhost:${WEB_PORT}`,
});

installCleanup([server]);

console.log('· 跑认证旅程套件（注册 → 登录 → 同步 → 新设备 → 退出）…\n');
const test = spawn(
  'pnpm',
  ['--dir', 'e2e', 'exec', 'playwright', 'test', '--config=playwright.auth-journey.config.ts'],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      HEYTA_AUTH_JOURNEY_SERVER: BASE,
      // 供 vitest/pnpm 内部解析：确保用同一个 node。
      HEYTA_NODE: NODE,
    },
    stdio: 'inherit',
  },
);

const code = await new Promise((resolve) => test.on('exit', resolve));

server.stop();

if (code === 0) {
  console.log('\n✅ 认证旅程验收通过：注册 → 登录 → 同步 → 新设备恢复 → 退出登录\n');
} else {
  console.log('\n❌ 认证旅程验收失败（截图在 e2e/test-results/，trace 已按失败保留）\n');
}
process.exit(code ?? 1);
