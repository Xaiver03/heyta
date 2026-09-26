/**
 * heyta Node 宿主的 CLI
 * =======================
 *
 * 给人用的最小界面。存在的理由不是「做个产品」，而是让「非 Web 宿主」
 * 这句话可以被**真的敲一遍**：每条命令都是一个新的进程，数据来自真实的
 * SQLite 文件 —— 这恰好也是本地优先最需要证明的那件事（重启不丢数据）。
 *
 * 🔴 所有写入都经 `host.dispatch()` / `host.addTask()`，最终落到
 * `OpLogEngine.dispatch()`。CLI 里没有任何一处直接改状态
 * （AGENTS.md §3.4：op-log 是唯一写入口）。
 *
 * 用法：
 *   node dist/cli.js --db heyta.sqlite add "买牛奶"
 *   node dist/cli.js --db heyta.sqlite list
 *   node dist/cli.js --db heyta.sqlite --server http://127.0.0.1:3000 \
 *     --token <jwt> --password <口令> sync
 *
 * 参数也可以走环境变量：HEYTA_DB / HEYTA_SERVER_URL / HEYTA_TOKEN /
 * HEYTA_PASSWORD / HEYTA_CLIENT_ID。加 `--json` 输出机器可读结果。
 */

import { writeSync } from 'node:fs';

import { parseLocalDate } from '@heyta/domain';
import type { NewTaskFields } from '@heyta/app-host';
import { openNodeHost } from './host.js';
import type { SyncStatus } from '@heyta/sync-client';

const VALUE_FLAGS = new Set(['db', 'server', 'token', 'password', 'client-id', 'due']);
const BOOL_FLAGS = new Set(['json', 'all', 'help']);

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgv(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (VALUE_FLAGS.has(name)) {
        if (eq >= 0) {
          flags[name] = arg.slice(eq + 1);
        } else {
          const value = argv[i + 1];
          if (value === undefined) throw new Error(`--${name} 缺少取值`);
          flags[name] = value;
          i += 1;
        }
      } else if (BOOL_FLAGS.has(name)) {
        flags[name] = true;
      } else {
        throw new Error(`未知参数 --${name}`);
      }
    } else if (command === undefined) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** 同步写入 fd 1。用 writeSync 而不是 console.log，保证 process.exit 前已刷出。 */
function out(text: string): void {
  writeSync(1, `${text}\n`);
}
function err(text: string): void {
  writeSync(2, `${text}\n`);
}

function describeSyncStatus(status: SyncStatus): string {
  switch (status.kind) {
    case 'synced':
      return '已同步';
    case 'conflict':
      return `有 ${String(status.conflicts.length)} 处改动需要人工决定（CLI 不替你选）`;
    case 'offline':
      return '离线：改动已排队，联网后重试';
    case 'error':
      return status.message;
    default:
      return status.kind;
  }
}

const USAGE = `heyta node-host —— 非 Web 宿主（真实 SQLite + 真实同步）

用法：
  node dist/cli.js [全局参数] <命令> [参数]

全局参数：
  --db <路径>          SQLite 文件（或 HEYTA_DB）—— 必填
  --server <url>       同步服务端（或 HEYTA_SERVER_URL）
  --token <jwt>        访问令牌（或 HEYTA_TOKEN）
  --password <口令>    E2EE 口令（或 HEYTA_PASSWORD）
  --client-id <id>     覆盖设备 id（或 HEYTA_CLIENT_ID）
  --json               机器可读输出

命令：
  add <标题> [--due 2026-10-05]  创建一个任务（--due 是**本地日期**）
  list [--all]              列出任务（默认只列未完成）
  rename <id> <标题>        改标题
  complete <id>             标记完成
  reopen <id>               取消完成
  sync                      与真实服务端同步一次
  pending                   打印待上传队列长度
`;

async function main(): Promise<number> {
  const { command, positionals, flags } = parseArgv(process.argv.slice(2));
  const json = flags['json'] === true;

  if (command === undefined || command === 'help' || flags['help'] === true) {
    out(USAGE);
    return command === undefined && flags['help'] !== true ? 1 : 0;
  }

  const dbPath = stringFlag(flags, 'db') ?? process.env['HEYTA_DB'];
  if (dbPath === undefined) {
    throw new Error('缺少 --db <路径>（或 HEYTA_DB）—— 宿主必须打开一个真实 SQLite 文件');
  }

  const serverUrl = stringFlag(flags, 'server') ?? process.env['HEYTA_SERVER_URL'];
  const token = stringFlag(flags, 'token') ?? process.env['HEYTA_TOKEN'];
  const password = stringFlag(flags, 'password') ?? process.env['HEYTA_PASSWORD'];
  const clientId = stringFlag(flags, 'client-id') ?? process.env['HEYTA_CLIENT_ID'];

  if (command === 'sync') {
    // 在打开库之前就把配置错误说清楚。反过来的话，baseUrl='' 会让 fetch
    // 抛 TypeError，而 SyncClient 会把它归类成「离线」——看起来像网络问题，
    // 实际是参数没给。诊断方向直接被带偏。
    if (serverUrl === undefined) throw new Error('sync 需要 --server <url>（或 HEYTA_SERVER_URL）');
    if (token === undefined) throw new Error('sync 需要 --token <jwt>（或 HEYTA_TOKEN）');
    if (password === undefined) {
      throw new Error('sync 需要 --password <口令>（或 HEYTA_PASSWORD）；没有口令不会以明文上传');
    }
  }

  const host = await openNodeHost({
    dbPath,
    ...(serverUrl !== undefined ? { serverUrl } : {}),
    ...(token !== undefined ? { token } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
  });

  try {
    switch (command) {
      case 'add': {
        const title = positionals[0];
        if (title === undefined) throw new Error('add 需要 <标题>');
        // `--due` 收的是**本地日期**（`2026-10-05`），不是时间戳。
        // 理由与 `NewTaskFields.dueDate` 的语义词一致：截止时间在领域层是
        // "哪一天"，交给 `parseLocalDate` 落地成本地午夜。
        // 🔴 不自己切分字符串：`parseLocalDate` 会校验格式并抛错，
        // 而手写的 `split('-')` 遇到 `2026-1-5` 或手滑的 `2026-13-40`
        // 会安静地算出别的日子（`Date` 会自动进位），脚本却以为自己传对了。
        const due = stringFlag(flags, 'due');
        const over: NewTaskFields = {};
        if (due !== undefined) over.dueDate = parseLocalDate(due).getTime();
        const id = await host.addTask(title, Object.keys(over).length > 0 ? over : undefined);
        if (json) out(JSON.stringify({ ok: true, command: 'add', id, due: due ?? null }));
        else out(`已创建任务 ${id}：${title}${due !== undefined ? `（截止 ${due}）` : ''}`);
        return 0;
      }

      case 'list': {
        const includeCompleted = flags['all'] === true;
        const tasks = host
          .listTasks()
          .filter((task) => includeCompleted || task.completedAt === undefined);
        if (json) {
          out(
            JSON.stringify({
              ok: true,
              command: 'list',
              tasks: tasks.map((task) => ({
                id: task.id,
                title: task.title,
                completedAt: task.completedAt ?? null,
                // 验收要能断言"截止日期/优先级真的同步到了另一台设备"。
                // 在此之前 list 只吐 title/completedAt，于是跨设备只能证明标题同步 ——
                // 而这两项恰恰是"能日常用"的核心字段。
                dueDate: task.dueDate ?? null,
                priority: task.priority ?? null,
                // 重复规则也要能看到：验收要证明"在手机上设的重复，笔记本上读到了"。
                // 没有这两项时，跨设备只能证到截止时间，重复规则同步没同步**无法断言** ——
                // 而"没法断言的字段"正是最可能在半路上丢掉的。
                repeatRule: task.repeatRule ?? null,
                repeatDtstart: task.repeatDtstart ?? null,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
              })),
            }),
          );
        } else if (tasks.length === 0) {
          out('（没有任务）');
        } else {
          for (const task of tasks) {
            const mark = task.completedAt === undefined ? '[ ]' : '[x]';
            out(`${mark} ${task.title}  (${task.id})`);
          }
        }
        return 0;
      }

      case 'rename': {
        const [id, title] = positionals;
        if (id === undefined || title === undefined) throw new Error('rename 需要 <id> <标题>');
        await host.renameTask(id, title);
        if (json) out(JSON.stringify({ ok: true, command: 'rename', id }));
        else out(`已改标题 ${id}：${title}`);
        return 0;
      }

      case 'complete':
      case 'reopen': {
        const id = positionals[0];
        if (id === undefined) throw new Error(`${command} 需要 <id>`);
        await host.setCompleted(id, command === 'complete');
        if (json) out(JSON.stringify({ ok: true, command, id }));
        else out(`${command === 'complete' ? '已完成' : '已重新打开'} ${id}`);
        return 0;
      }

      case 'pending': {
        const pending = await host.pendingUploadCount();
        if (json) out(JSON.stringify({ ok: true, command: 'pending', pending }));
        else out(`待上传：${String(pending)} 条`);
        return 0;
      }

      case 'sync': {
        const status = await host.sync();
        if (status.kind !== 'synced') {
          if (json) {
            out(JSON.stringify({ ok: false, command: 'sync', status }));
          } else {
            err(`同步未成功：${describeSyncStatus(status)}`);
          }
          return 1;
        }
        if (json) {
          out(JSON.stringify({ ok: true, command: 'sync', status }));
        } else {
          out(`已同步（${new Date(status.at).toISOString()}）`);
        }
        return 0;
      }

      default:
        throw new Error(`未知命令「${command}」。\n\n${USAGE}`);
    }
  } finally {
    host.close();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const json = process.argv.includes('--json');
    if (json) err(JSON.stringify({ ok: false, error: message }));
    else err(`❌ ${message}`);
    process.exit(1);
  });
