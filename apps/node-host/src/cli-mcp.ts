/**
 * MCP stdio 的命令行入口
 * =========================
 *
 * MCP 客户端（Claude Desktop 等）是这样拉起一个 stdio 服务的：
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "heyta": {
 *       "command": "node",
 *       "args": ["/path/to/heyta/apps/node-host/dist/cli-mcp.js"],
 *       "env": { "HEYTA_LOCAL_API_TOKEN": "<在 heyta 设置里生成的那个>" }
 *     }
 *   }
 * }
 * ```
 *
 * ## 🔴 这个文件只做组装
 *
 * 开数据库、建宿主、建适配器 —— 都是**接线**，不是判断。
 * 所有判断（授权、工具过滤、受保护条目、写入路径）在 `@heyta/local-api`
 * 和 `@heyta/app-host` 里，且已有测试钉住。
 *
 * ## 🔴 配置从哪来
 *
 * 本地 API 的开关与逐工具授权存在 heyta 自己的设置里（与界面共用一份）。
 * 这个进程是**被客户端拉起来的**，没有界面可问，所以：
 *
 * - 没有配置文件 → **拒绝启动**（不是"默认全开"）
 * - `enabled: false` → **拒绝启动**，并在 stderr 说明怎么开
 *
 * ⚠️ 这与 HTTP 壳同一条纪律：**默认关**，且关着时不静默降级成一个能用的东西。
 */

import { readFileSync } from 'node:fs';

import { type LocalApiConfig } from '@heyta/local-api';
import { createLocalApiHost, createTaskActions } from '@heyta/app-host';

import { openNodeHost } from './host.js';
import { describeStdioStartup, startMcpStdioServer } from './mcp-stdio-server.js';

/** 配置文件路径：`HEYTA_LOCAL_API_CONFIG`，或默认的 `~/.heyta/local-api.json`。 */
export const DEFAULT_CONFIG_PATH = `${process.env['HOME'] ?? ''}/.heyta/local-api.json`;

function loadConfig(path: string): LocalApiConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `找不到本地 API 配置：${path}\n` +
        '先在 heyta 的「设置 → 本机 API」里打开总开关并逐个授权工具，' +
        '或设置环境变量 HEYTA_LOCAL_API_CONFIG 指向配置文件。',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`本地 API 配置不是合法 JSON：${path}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`本地 API 配置必须是一个对象：${path}`);
  }

  const record = parsed as Record<string, unknown>;
  const config: LocalApiConfig = {
    enabled: record['enabled'] === true,
    // 🔴 绑定地址**不从文件读** —— 与 Web 设置同样的理由：
    // 一个可被写坏的字段不该决定"监听哪里"。stdio 本来也不监听。
    bindAddress: '127.0.0.1',
    port: typeof record['port'] === 'number' ? record['port'] : 47_119,
    ...(typeof record['token'] === 'string' ? { token: record['token'] } : {}),
    ...(typeof record['grants'] === 'object' && record['grants'] !== null
      ? { grants: record['grants'] as NonNullable<LocalApiConfig['grants']> }
      : {}),
  };
  return config;
}

async function main(): Promise<void> {
  const configPath = process.env['HEYTA_LOCAL_API_CONFIG'] ?? DEFAULT_CONFIG_PATH;
  // 数据库路径。默认放在 ~/.heyta/，可用 HEYTA_DB_PATH 覆盖（测试用）。
  const dbPath =
    process.env['HEYTA_DB_PATH'] ?? `${process.env['HOME'] ?? ''}/.heyta/heyta.db`;

  let config: LocalApiConfig;
  try {
    config = loadConfig(configPath);
  } catch (error) {
    // 🔴 启动失败也走 stderr —— stdout 是协议专用的。
    process.stderr.write(`[heyta-mcp] ${(error as Error).message}\n`);
    process.exit(1);
  }

  if (!config.enabled) {
    process.stderr.write(
      '[heyta-mcp] 本地 API 总开关是关着的，拒绝启动。\n' +
        '  去 heyta 的「设置 → 本机 API」打开它，并逐个授权你要暴露的工具。\n',
    );
    process.exit(1);
  }

  const host = await openNodeHost({ dbPath });
  const actions = createTaskActions({
    dispatch: host.dispatch,
    getState: () => host.engine.getState(),
  });
  const apiHost = createLocalApiHost(
    { dispatch: host.dispatch, getState: () => host.engine.getState() },
    actions,
    {
      // 🔴 **显式传，而不是靠默认值。**
      //
      // 现在恒为 `true`：heyta 还没有"受保护条目"这个产品概念
      // （ADR-0011 §6.1 列为唯一产品空白），所以本机也没有任何条目是读不出来的。
      //
      // 但这件事必须**写在这里**，因为它是**产品现状**，不是实现细节：
      // 一旦有了"标记为受保护"的字段，改的就是这一行。
      isReadable: () => true,
    },
  );

  // 说明走 stderr，不污染 stdout。
  process.stderr.write(`${describeStdioStartup(apiHost, config)}\n`);

  const server = startMcpStdioServer({ host: apiHost, config });

  const shutdown = (): void => {
    server.close();
    host.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.done;
  host.close();
}

// ⚠️ 只有直接被运行时才执行（被 import 时不执行）。
if (process.argv[1] !== undefined && process.argv[1].endsWith('cli-mcp.js')) {
  void main();
}
