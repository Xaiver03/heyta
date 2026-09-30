#!/usr/bin/env node
/**
 * 实时通道的**入站方向**验收（真服务端，零 mock）
 * ================================================
 *
 * ## 🔴 它补的是哪一格
 *
 * `verify-mobile-ios` 的第 6 步验的是"**写入会自己出去**"（出站：本地改动 → 上传）。
 * 而实时通道的另一半从来没验过：**服务端主动推 → 这台不点也会收到**。
 *
 * 那一半在代码里是存在的（`sync-client/src/realtime.ts` 的 `onNewOps`，
 * 以及 web / mobile 两端的接线），但"存在"与"真的会响"是两件事 ——
 * 本仓库最贵的教训就是这一条（"工具返回成功不等于生效"）。
 *
 * ## 它怎么做到"能失败"
 *
 * 两条**互补**的证据，缺一不可：
 *
 * | # | 断言 | 它防的失效 |
 * |---|---|---|
 * | 正例 | 另一个客户端上传之后，**监听端收到 `{type:'new_ops', latestSeq}`** | 服务端没广播 / 客户端收不到 / 协议对不上 |
 * | **反例** | **上传之前那段时间里，一条消息都不该来** | 消息是"无条件定时发"的（那会让正例在服务器什么都没发生时也绿） |
 *
 * ⚠️ 反例不是装饰。没有它的话，一个"每 5 秒推一次心跳"的实现能让正例**永远绿**，
 * 而它根本没有把"有新 op"这件事传出去。
 *
 * ## 怎么造"另一个客户端"
 *
 * 用仓里**已有的笔记本设备**（`apps/node-host/dist/cli.js`）：
 * `add` + `sync` 会真的上传一条 op，而服务端在上传路径的末尾调
 * `notifyNewOps(userId, excludeClientId, latestSeq)` —— 排除**上传者**自己，
 * 广播给同用户的其他连接。所以监听端用一个**独立的 clientId** 即可。
 *
 * 用法：
 *   PORT=3100 node scripts/verify-realtime-push.mjs
 *   HOST_SERVER=http://127.0.0.1:3100 node scripts/verify-realtime-push.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

/**
 * 🔴 **用客户端自己的 `buildRealtimeUrl`，不要在这里手拼。**
 *
 * 手拼的话，这个脚本测的是"我写的那个字符串对不对"，而不是"app 连的那个地址对不对" ——
 * 而这两者恰恰可以不一致：本脚本的第一版手拼了 `/ws`，而服务端把 `wsRoutes`
 * 注册在 `prefix: '/api/sync'` 下（真实端点是 `/api/sync/ws`），
 * 于是它**第一次就红了**，把客户端里一个长期存在的 404 抖了出来
 *（`packages/sync-client/tests/realtime.spec.ts` 把那个错路径逐字断言了下来，
 * 所以测试与实现一起错、一直是绿的）。
 * 现在它直接引那个函数：**客户端改错，这里就红**。
 */
import { buildRealtimeUrl } from '../packages/sync-client/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const PORT = process.env['PORT'] ?? '3000';
const SERVER = process.env['HOST_SERVER'] ?? `http://127.0.0.1:${PORT}`;
const TOKEN_FILE = process.env['HEYTA_TOKEN_FILE'] ?? '/tmp/heyta_mobile_token.txt';
const E2EE_FILE = process.env['HEYTA_E2EE_FILE'] ?? '/tmp/heyta_mobile_e2ee.txt';
const LAPTOP_DB = process.env['LAPTOP_DB'] ?? `/tmp/heyta-realtime-laptop-${String(process.pid)}.sqlite`;

/** 监听端**刻意**用一个与笔记本不同的 clientId —— 服务端会排除上传者自己。 */
const LISTENER_CLIENT_ID = `realtime-probe-${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;
const ok = (m) => {
  passed += 1;
  console.log(`   ✅ ${m}`);
};
const bad = (m) => {
  failed += 1;
  console.log(`   ❌ ${m}`);
};
const step = (m) => {
  console.log(`\n════ ${m} ════`);
};

function readTrimmed(path, label) {
  if (!existsSync(path)) {
    bad(`缺 ${label}：${path}（先跑 build/verify 的建号步骤）`);
    process.exit(1);
  }
  return readFileSync(path, 'utf8').trim();
}

const TOKEN = readTrimmed(TOKEN_FILE, '访问令牌');
const E2EE = readTrimmed(E2EE_FILE, 'E2EE 口令');

/** 笔记本设备的一条命令。返回解析后的 JSON（失败时返回 `{ok:false}`）。 */
function laptop(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, 'apps/node-host/dist/cli.js'),
        ...args,
        '--db',
        LAPTOP_DB,
        '--server',
        SERVER,
        '--token',
        TOKEN,
        '--password',
        E2EE,
        '--json',
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (c) => {
      out += String(c);
    });
    child.on('close', () => {
      const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolvePromise(JSON.parse(line));
      } catch {
        resolvePromise({ ok: false, raw: line });
      }
    });
  });
}

const wsUrl = buildRealtimeUrl(SERVER, TOKEN, LISTENER_CLIENT_ID);
const received = [];
let socket;
let opened = false;

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolvePromise) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) return resolvePromise(true);
      if (Date.now() > deadline) return resolvePromise(false);
      setTimeout(tick, 100);
    };
    tick();
    void label;
  });
}

async function main() {
  console.log('=== 实时通道入站方向验收（真服务端，零 mock）===');
  console.log(`  服务端: ${SERVER}`);
  console.log(`  监听 clientId: ${LISTENER_CLIENT_ID}`);
  console.log(`  端点（客户端 buildRealtimeUrl 给的）: ${wsUrl.replace(/token=[^&]+/, 'token=***')}`);
  console.log(`  写入方: 笔记本设备 CLI（apps/node-host）`);

  step('0. 服务端活着');
  const health = await fetch(`${SERVER}/health`).catch(() => undefined);
  if (health?.ok === true) ok('服务端 /health 返回 ok');
  else {
    bad(`服务端 ${SERVER}/health 不可达 —— 先 bash scripts/mobile-e2e-up.sh`);
    return;
  }

  step('1. 监听端连上 /ws');
  socket = new WebSocket(wsUrl);
  socket.on('open', () => {
    opened = true;
  });
  socket.on('message', (data) => {
    try {
      received.push(JSON.parse(String(data)));
    } catch {
      received.push({ type: '<非 JSON>', raw: String(data).slice(0, 120) });
    }
  });
  socket.on('error', (e) => {
    bad(`WebSocket 出错：${e.message}`);
  });

  const didOpen = await waitFor(() => opened, 8000);
  if (didOpen) ok('WebSocket 已建立（令牌被服务端接受了）');
  else {
    bad('8 秒内没连上 —— 令牌无效 / 端点不对 / 服务端没注册 /ws');
    return;
  }

  step('2. 🔴 反例：**还没人上传**，这段时间里不该有 `new_ops`');
  /**
   * ⚠️ 判据是"**没有 `new_ops`**"，不是"一条消息都没有"。
   *
   * 服务端在连接建立时会先发一条 `{type:'connected', userId, timestamp}` 握手
   *（实测）。第一版把它算成"无条件推送"，于是反例**假红** ——
   * 而那是我的断言太宽，不是产品的问题。**反例要排掉握手，只盯那条业务消息。**
   */
  const quiet = 3000;
  const gotSpurious = await waitFor(() => received.some((m) => m.type === 'new_ops'), quiet);
  const handshakes = received.filter((m) => m.type === 'connected').length;
  if (gotSpurious) {
    bad(
      `${String(quiet)}ms 内就收到了 new_ops，而**没有任何人上传** —— ` +
        `那条推送是无条件发的（正例会被它骗绿）。已收到：${JSON.stringify(received)}`,
    );
  } else {
    ok(
      `${String(quiet)}ms 里没有 new_ops —— 推送不是无条件发的` +
        `（期间收到 ${String(handshakes)} 条 connected 握手，已按设计排除）`,
    );
  }

  step('3. 另一个客户端上传一条 op（笔记本设备）');
  const title = `realtime-push-${Date.now().toString(36)}`;
  const added = await laptop(['add', title]);
  if (added.ok === true) ok(`笔记本建了一条任务：${title}`);
  else {
    bad(`笔记本 add 失败：${JSON.stringify(added).slice(0, 200)}`);
    return;
  }
  const synced = await laptop(['sync']);
  if (synced.ok === true) ok('笔记本 sync 成功（这条 op 真的上传了）');
  else {
    bad(`笔记本 sync 失败：${JSON.stringify(synced).slice(0, 200)}`);
    return;
  }

  step('4. 🔴 正例：监听端必须收到 `new_ops`');
  const gotPush = await waitFor(
    () => received.some((m) => m.type === 'new_ops'),
    15000,
  );
  if (!gotPush) {
    bad(
      `15 秒内没收到 new_ops —— 服务端没广播，或客户端收不到。` +
        `已收到：${JSON.stringify(received).slice(0, 200)}`,
    );
    return;
  }

  const push = received.find((m) => m.type === 'new_ops');
  if (typeof push.latestSeq === 'number' && push.latestSeq > 0) {
    ok(`收到 new_ops，latestSeq=${String(push.latestSeq)}（> 0，是真实序号）`);
  } else {
    bad(`new_ops 里的 latestSeq 不是正整数：${JSON.stringify(push)}`);
  }

  /**
   * 🔴 契约：那条消息**只回答"有没有新 op、到第几号了"**，**不带任何内容**。
   *
   * `realtime.ts` 的文件头写明"这条通道只传'有新 op 了'，不传内容 ——
   * 真正的 op 密文仍走 `/api/sync/ops`"。所以判据是：
   *   · **必须**有 `type` 与 `latestSeq`；
   *   · **不许**出现任何承载内容的字段（`ops` / `payload` / `data` / `ciphertext`…）。
   *
   * ⚠️ 第一版写的是"字段集合恰好等于 `{type, latestSeq}`"，而服务端还带了
   * `timestamp`（服务器发这条消息的时刻）—— 那**不是内容**，于是那条断言**假红**。
   * 判据要盯"有没有内容"，不是"字段数对不对"：**白名单数数会把合法的元信息也拦下，
   * 而它对真正的泄漏（多一个 `payload`）并不比黑名单更敏感。**
   */
  const keys = Object.keys(push);
  const CONTENT_KEYS = ['ops', 'op', 'payload', 'data', 'ciphertext', 'envelope', 'changes'];
  const leaked = keys.filter((k) => CONTENT_KEYS.includes(k));
  if (!keys.includes('type') || !keys.includes('latestSeq')) {
    bad(`new_ops 缺必需字段：${keys.join(', ')}`);
  } else if (leaked.length > 0) {
    bad(`new_ops 带了**内容**字段：${leaked.join(', ')}（这条通道只该传"有新 op"）`);
  } else {
    ok(`消息带 ${keys.join(' + ')} —— 没有把内容搬进这条通道`);
  }
}

main()
  .catch((e) => {
    bad(`脚本本身抛了：${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(() => {
    socket?.close();
    console.log('\n════════════════════════════════════════');
    console.log(`  通过 ${String(passed)} 项，失败 ${String(failed)} 项`);
    if (failed === 0) console.log('  ✅ 实时通道入站方向：服务端推、监听端收得到');
    process.exit(failed === 0 ? 0 : 1);
  });
