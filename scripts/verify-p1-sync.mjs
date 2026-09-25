#!/usr/bin/env node
/**
 * P1 验收：单端闭环 + 同步到 P0 协议
 * =====================================
 *
 * 起一个真实服务端（TEST_MODE），然后跑 apps/web 的端到端同步测试。
 * 这条链路里**没有 mock**：真 OpLogEngine → 真 IndexedDB → 真 SyncClient
 * → 真 HTTP → 真 Fastify 服务端 → 真 PostgreSQL。
 *
 * 为什么必须有它：单元测试的 mock 是**按实现者自己对协议的理解**写的。
 * 理解错了，mock 就跟着错，测试照样全绿。
 * 本次开发中正是这条测试抓出了三个 mock 掩盖不了的真实缺陷：
 *   1. opType 词表用了 CREATE/UPD/DELETE，而线协议是 CRT/UPD/DEL
 *   2. 上传结果字段读的 id/serverSeq，实际是 opId/accepted
 *   3. 下载的 op 是嵌套的 {serverSeq, op}，被当扁平结构读
 * 以及一个更严重的：
 *   4. 向量时钟不含本次递增 → 每台设备的第一条 op 被对端静默丢弃
 *
 * 用法：
 *   node scripts/verify-p1-sync.mjs
 *   node scripts/verify-p1-sync.mjs --port 3200
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * 找一个**可以真正 spawn** 的 node。
 *
 * 不要直接用 `process.execPath`：在某些封装环境（例如桌面 Agent 的私有
 * 运行时垫片）里它指向一个不能独立启动的包装器，spawn 会以 ENOENT 失败，
 * 而错误信息完全不指向真正的原因。也不要写死 'node' —— PATH 里未必有。
 */
function resolveNode() {
  if (process.env.HEYTA_NODE) return process.env.HEYTA_NODE;

  const home = process.env.HOME ?? '';
  const candidates = [
    // 明确的真 node 优先于 PATH：
    // 封装运行时的私有垫片也叫 "node" 且位于 PATH 最前，但它不能被 spawn。
    `${home}/.nvm/versions/node/v22.22.3/bin/node`,
    `${home}/.nvm/versions/node/v22.22.0/bin/node`,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  for (const c of candidates) if (existsSync(c)) return c;

  // 再找 PATH，但跳过封装运行时的垫片
  try {
    const found = execFileSync('sh', ['-c', 'which -a node'], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => !/DSH Desktop|runtime-commands/.test(p));
    for (const f of found) if (existsSync(f)) return f;
  } catch {
    // 没找到
  }

  return process.execPath;
}

const NODE = resolveNode();

// ⚠️ 必须用 fileURLToPath，不能用 `new URL(...).pathname`。
// 后者会把路径里的空格转义成 %20；cwd 因此不存在，
// 而 spawn 抛出的却是 `ENOENT ... spawn <node 二进制>` ——
// 报错指向一个明明存在的可执行文件，完全误导排查方向。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? args[portIdx + 1] : '3210';
const BASE = `http://127.0.0.1:${PORT}`;

// ⚠️ 宿主机上残留的 DATABASE_URL 会覆盖 .env（见 AGENTS.md §7）。
// 这里是本地验收用的库，与 P0 的一致。
const DB_URL =
  process.env.HEYTA_VERIFY_DATABASE_URL ??
  'postgresql://rocalight@127.0.0.1:5432/heyta_sync_smoke?schema=public&connection_limit=5&pool_timeout=10';

let server;

const cleanup = () => {
  if (server && server.exitCode === null) server.kill('SIGTERM');
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

console.log('\n=== P1 验收：单端闭环 + 真实同步 ===\n');

if (process.env.DATABASE_URL) {
  console.log('⚠️  检测到环境变量 DATABASE_URL，已用验收库覆盖（避免污染）');
}

console.log(`· node: ${NODE}`);
console.log(`· 启动服务端（端口 ${PORT}，TEST_MODE）…`);
// 用 process.execPath，不要写死 'node' ——
// PATH 里没有 node 时 spawn 会以 ENOENT 失败，而错误信息毫无指向性。
server = spawn(
  NODE,
  ['dist/src/index.js'],
  {
    cwd: `${ROOT}server`,
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      NODE_ENV: 'test',
      TEST_MODE: 'true',
      TEST_MODE_CONFIRM: 'yes-i-understand-the-risks',
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d.toString()));
server.stderr.on('data', (d) => (serverLog += d.toString()));

// 等服务端就绪
let ready = false;
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  try {
    const res = await fetch(`${BASE}/api/test/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 口令至少 8 位：服务端会 400，而"就绪探测一直失败"看起来像服务端没起来 ——
      // 我第一版用 'p'，于是白等了 20 秒才看出来真正原因是校验。
      body: JSON.stringify({
        email: `ready-${Date.now()}@example.com`,
        password: 'ready-probe-password',
      }),
    });
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    // 还没起来
  }
  if (server.exitCode !== null) break;
}

if (!ready) {
  console.error('❌ 服务端未能就绪。日志尾部：\n');
  console.error(serverLog.split('\n').slice(-20).join('\n'));
  cleanup();
  process.exit(1);
}
console.log('✅ 服务端就绪');

console.log('· 跑端到端同步测试…\n');
const test = spawn(
  process.env.npm_execpath ? NODE : 'pnpm',
  process.env.npm_execpath
    ? [process.env.npm_execpath, 'exec', 'vitest', 'run', 'tests/e2e-sync.integration.spec.ts']
    : ['exec', 'vitest', 'run', 'tests/e2e-sync.integration.spec.ts'],
  {
    cwd: `${ROOT}apps/web`,
    env: { ...process.env, HEYTA_E2E_URL: BASE },
    stdio: 'inherit',
  },
);

const code = await new Promise((resolve) => test.on('exit', resolve));

cleanup();

if (code === 0) {
  console.log('\n✅ P1 验收通过：本地写入 → 加密上传 → 增量下载 → 对端可见\n');
} else {
  console.log('\n❌ P1 验收失败\n');
}
process.exit(code ?? 1);
