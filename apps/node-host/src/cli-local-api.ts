/**
 * 本机 API（AI-5）配置的运维命令
 * ==================================
 *
 * ```
 * heyta-ai local-api init [--tools list_tasks,get_task]
 * heyta-ai local-api show
 * heyta-ai local-api off
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 这个文件为什么必须存在
 *
 * 设置面板**能**配本机 API（开关 / token / 逐个工具授权），但它把配置存进
 * **浏览器的 localStorage**。而真正跑起来的 MCP 服务（`cli-mcp.js`）
 * 读的是 **`~/.heyta/local-api.json`**。
 *
 * **在此之前没有任何代码写那个文件。**
 *
 * 于是"在界面上配好了本机 API"是一件**没有效果的事** ——
 * 服务看不到那份配置。用户能配，但配了不生效，而且不会有任何报错。
 *
 * 两条存储各自都对，缺的是把配置**落成服务能读的那份文件**。
 * 这就是本命令的职责。
 *
 * ## 🔴 token 只出现在两个地方：文件（0600）和一次性输出
 *
 * `init` 会把 token 打到 stdout —— 因为用户必须把它贴进 MCP 客户端的
 * `env`，没有别的办法。所以：
 *   - **只打一次**，并明确说明"这是唯一一次显示"
 *   - `show` **永远打码**
 *   - 文件权限 `0600`
 *
 * ⚠️ token 是**生成**的，不是用户传进来的 —— 所以它不会出现在 shell 历史
 * 或 `ps` 里（对比 `key set` 那条从 stdin 读的规则，理由相同）。
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { LOCAL_API_TOOLS, validateLocalApiConfig, type LocalApiConfig } from '@heyta/local-api';

export const DEFAULT_LOCAL_API_PATH = `${process.env['HOME'] ?? ''}/.heyta/local-api.json`;

/** 默认只开一个只读工具 —— 打开就是"全开"是最糟的默认值。 */
export const DEFAULT_GRANTS: Readonly<Record<string, boolean>> = { list_tasks: true };

export interface LocalApiCommandDeps {
  /** 配置文件路径。默认 `~/.heyta/local-api.json`。 */
  configPath?: string;
  /** 生成 token。测试注入固定值。 */
  generateToken?: () => string;
}

export interface LocalApiCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 默认 token：32 字节随机，base64url（无 `+/=`，贴进 shell 不用转义）。 */
function defaultGenerateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 打码：留住前后各 4 位，让人能核对"是不是同一个"，但看不出内容。 */
export function maskToken(token: string): string {
  if (token.length <= 12) return '****';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function readLocalApiConfig(path: string): LocalApiConfig | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return undefined;
    return raw as LocalApiConfig;
  } catch {
    return undefined;
  }
}

/** 写配置，并把权限收紧到 0600。 */
export function writeLocalApiConfig(path: string, config: LocalApiConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  // ⚠️ `mode` 只在**创建**时生效。文件已存在时它不会改权限，
  // 所以这里显式再来一次 —— 否则"改过一次再 init"会留下一个宽松的文件。
  chmodSync(path, 0o600);
}

/** MCP 客户端要贴的那一段。 */
function mcpSnippet(path: string, token: string): string {
  return [
    '  "heyta": {',
    '    "command": "node",',
    '    "args": ["<你的路径>/apps/node-host/dist/cli-mcp.js"],',
    '    "env": {',
    `      "HEYTA_LOCAL_API_TOKEN": "${token}"`,
    '    }',
    '  }',
  ].join('\n');
}

export function runLocalApiCommand(
  argv: readonly string[],
  deps: LocalApiCommandDeps = {},
): LocalApiCommandResult {
  const path = deps.configPath ?? process.env['HEYTA_LOCAL_API_CONFIG'] ?? DEFAULT_LOCAL_API_PATH;
  const generateToken = deps.generateToken ?? defaultGenerateToken;
  const [sub] = argv;

  switch (sub) {
    case 'init': {
      const force = argv.includes('--force');
      if (existsSync(path) && !force) {
        return {
          code: 1,
          stdout: '',
          stderr:
            `${path} 已存在。\n` +
            '不覆盖是刻意的：覆盖会**换掉 token**，而已经配好的 MCP 客户端会立刻失效。\n' +
            '确实要重来请加 --force。\n',
        };
      }

      // `--tools a,b,c` —— 不给就用默认（只开一个只读工具）。
      const toolsIndex = argv.indexOf('--tools');
      let grants: Record<string, boolean>;
      if (toolsIndex >= 0 && argv[toolsIndex + 1] !== undefined) {
        const names = String(argv[toolsIndex + 1])
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n !== '');
        const known = new Set(LOCAL_API_TOOLS.map((t) => t.name));
        const unknown = names.filter((n) => !known.has(n));
        if (unknown.length > 0) {
          return {
            code: 1,
            stdout: '',
            stderr:
              `不认识的工具：${unknown.join('、')}\n` +
              `可用的有：${[...known].join('、')}\n`,
          };
        }
        grants = Object.fromEntries(names.map((n) => [n, true]));
      } else {
        grants = { ...DEFAULT_GRANTS };
      }

      const token = generateToken();
      const config: LocalApiConfig = {
        enabled: true,
        // 🔴 不信命令行、也不信环境 —— 回环是唯一允许的监听地址。
        bindAddress: '127.0.0.1',
        port: 43117,
        token,
        grants,
      };

      const verdict = validateLocalApiConfig(config);
      if (!verdict.ok) {
        return { code: 1, stdout: '', stderr: `生成的配置没通过校验：${verdict.message}\n` };
      }

      writeLocalApiConfig(path, config);

      const enabled = Object.keys(grants);
      return {
        code: 0,
        stdout:
          `已写入 ${path}（权限 0600）。\n` +
          `监听 127.0.0.1:${String(config.port)}，已授权工具：${enabled.join('、')}\n` +
          '\n' +
          '⚠️ 下面这个 token **只显示这一次**，请立刻贴进 MCP 客户端：\n' +
          '\n' +
          `${token}\n` +
          '\n' +
          '在客户端的配置里加一段（token 通过 env 传，不写进命令参数）：\n' +
          '\n' +
          `${mcpSnippet(path, token)}\n`,
        stderr: '',
      };
    }

    case 'show': {
      const config = readLocalApiConfig(path);
      if (config === undefined) {
        return { code: 0, stdout: `还没有配置（${path} 不存在）。先跑 local-api init。\n`, stderr: '' };
      }
      const enabled = Object.entries(config.grants ?? {})
        .filter(([, on]) => on === true)
        .map(([name]) => name);
      return {
        code: 0,
        stdout:
          `配置：${path}\n` +
          `开关：${config.enabled ? '开' : '关'}\n` +
          `监听：${config.bindAddress}:${String(config.port)}\n` +
          // 🔴 永远打码 —— `show` 会被贴进 issue、聊天记录、截图
          `token：${config.token === undefined ? '（无）' : maskToken(config.token)}\n` +
          `已授权工具：${enabled.length === 0 ? '（一个都没开）' : enabled.join('、')}\n`,
        stderr: '',
      };
    }

    case 'off': {
      const config = readLocalApiConfig(path);
      if (config === undefined) {
        return { code: 1, stdout: '', stderr: `还没有配置（${path} 不存在）。\n` };
      }
      writeLocalApiConfig(path, { ...config, enabled: false });
      return { code: 0, stdout: '已关闭本机 API（token 与授权保持不变）。\n', stderr: '' };
    }

    default:
      return {
        code: 1,
        stdout: '',
        stderr:
          '用法：\n' +
          '  local-api init [--tools list_tasks,get_task] [--force]\n' +
          '  local-api show\n' +
          '  local-api off\n',
      };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // 允许 `heyta-ai local-api init` 与 `heyta-ai init` 两种写法
  // （与 `cli-ai.ts` 的 `key` 前缀同一约定）。
  const normalized = argv[0] === 'local-api' ? argv.slice(1) : argv;
  const result = runLocalApiCommand(normalized);
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exit(result.code);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('cli-local-api.js')) {
  void main();
}
