/**
 * 用**官方 MCP SDK** 当客户端，验证我们的 stdio 服务
 * ====================================================
 *
 * ```
 * pnpm verify:mcp-real
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 这个脚本存在的唯一理由：排除"自洽的误解"
 *
 * `apps/node-host/tests/mcp-stdio-e2e.spec.ts` 已经是**真的**端到端：
 * 真的 spawn 子进程、真的走管道、真的读写数据库。
 *
 * 但它有个结构性的盲点：**两端都是我写的。**
 *
 * 如果我对 MCP 规范的理解错了（字段名、必需能力、通知语义、
 * 错误码该用哪个），我会把**同一个误解同时写进"客户端"和"服务端"**，
 * 然后两边一起通过。真实客户端一接就挂，而我的测试**永远绿**。
 *
 * > 测试能证明"我按我想的实现了"，
 * > **不能证明"别人能用"。**
 *
 * 所以这里换掉客户端那一半：用 `@modelcontextprotocol/sdk`
 * ——**参考实现**，不是我的理解。服务端那一半仍然是我们的真实产物。
 *
 * ## ⚠️ SDK 是**临时安装**的，不进仓库依赖
 *
 * 它只是验证工具，不是 heyta 的运行时依赖。所以：
 *
 * ```bash
 * npm i --no-save @modelcontextprotocol/sdk
 * # 或者装到任意临时目录，用 NODE_PATH 指过来
 * ```
 *
 * 脚本找不到它会**明确告诉你**怎么装，而不是抛一个模块解析错误。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_CLI = join(ROOT, 'apps/node-host/dist/cli-mcp.js');
const LOCAL_API_CLI = join(ROOT, 'apps/node-host/dist/cli-local-api.js');

let Client;
let StdioClientTransport;
try {
  ({ Client } = await import('@modelcontextprotocol/sdk/client/index.js'));
  ({ StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js'));
} catch {
  process.stderr.write(
    '\n🔴 找不到官方 MCP SDK。这个脚本需要它当**客户端**（参考实现）。\n\n' +
      '  npm i --no-save @modelcontextprotocol/sdk\n\n' +
      '它只是验证工具，不进 heyta 的运行时依赖。\n' +
      '另外需要先构建：pnpm --filter @heyta/node-host build\n\n',
  );
  process.exit(2);
}

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass += 1;
    process.stdout.write(`   ✅ ${name}${extra === '' ? '' : `  ${extra}`}\n`);
  } else {
    fail += 1;
    process.stdout.write(`   ❌ ${name}${extra === '' ? '' : `  ${extra}`}\n`);
  }
};

const dir = mkdtempSync(join(tmpdir(), 'heyta-real-mcp-'));
const configPath = join(dir, 'local-api.json');
const dbPath = join(dir, 'heyta.db');
const env = { ...process.env, HEYTA_LOCAL_API_CONFIG: configPath, HEYTA_DB_PATH: dbPath };

/** 起一个客户端。`token === null` = 完全不带 token。 */
async function connect(token) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_CLI],
    env: token === null ? env : { ...env, HEYTA_LOCAL_API_TOKEN: token },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'heyta-verify-real-client', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

const WRITTEN_TITLE = 'MCP 真实客户端写入的任务';

try {
  // ── 0. 配置由我们自己的 CLI 生成（生成端也是真货）
  const out = execFileSync(
    process.execPath,
    [LOCAL_API_CLI, 'local-api', 'init', '--tools', 'list_tasks,create_task'],
    { env, encoding: 'utf8' },
  );
  const token = JSON.parse(readFileSync(configPath, 'utf8')).token;
  ok('配置由 heyta-ai local-api init 生成', out.includes('权限 0600') && token.length > 20);

  // ── 1. 真实握手（initialize + notifications/initialized 由 SDK 自己走）
  process.stdout.write('   · initialize / notifications/initialized（SDK 内部完成）\n');
  const client = await connect(token);
  ok('serverInfo.name 是 heyta', client.getServerVersion()?.name === 'heyta');

  // ── 2. tools/list
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  ok(
    '工具列表恰好等于授权集合（未授权的一个都不出现）',
    JSON.stringify(names) === JSON.stringify(['create_task', 'list_tasks']),
    names.join(','),
  );
  ok('每个工具都带 inputSchema', tools.every((t) => t.inputSchema?.type === 'object'));

  // ── 3. 读
  const before = await client.callTool({ name: 'list_tasks', arguments: {} });
  ok('tools/call 读返回 content 数组', Array.isArray(before.content) && before.content.length > 0);
  ok('初始是空库', !String(before.content[0]?.text).includes(WRITTEN_TITLE));

  // ── 4. 写（真实落库）
  const written = await client.callTool({ name: 'create_task', arguments: { title: WRITTEN_TITLE } });
  ok('tools/call 写成功', written.isError !== true);

  // ── 5. 读回
  const after = await client.callTool({ name: 'list_tasks', arguments: {} });
  ok('读回刚写进去的内容', String(after.content[0]?.text).includes(WRITTEN_TITLE));

  // ── 6. 未授权的工具被拒
  // 注意：拒绝用的是 -32601（"没有这个方法"），与"方法不存在"不可区分 ——
  // 这是刻意的：不向未授权方泄漏"存在哪些工具"。
  let denied = false;
  try {
    const r = await client.callTool({ name: 'complete_task', arguments: { taskId: 'x' } });
    denied = r.isError === true;
  } catch {
    denied = true;
  }
  ok('未授权的写工具被拒', denied);

  await client.close();

  // ── 7. token 鉴权
  for (const [label, bad] of [
    ['错误 token', 'WRONG_TOKEN_xxxxxxxxxxxxxxxxxxxxxx'],
    ['完全不带 token', null],
  ]) {
    let rejected = false;
    try {
      const c = await connect(bad);
      await c.listTools();
      await c.close();
    } catch {
      rejected = true;
    }
    ok(`${label} 被拒`, rejected);
  }

  process.stdout.write(`\n${fail === 0 ? '✅' : '🔴'} 官方 MCP 客户端：${pass} 通过 / ${fail} 失败\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(fail === 0 ? 0 : 1);
