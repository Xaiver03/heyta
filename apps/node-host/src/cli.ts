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
 *   printf '%s' "$登录口令" | node dist/cli.js auth login \
 *     --server http://127.0.0.1:3000 --email you@example.cn     # 拿令牌（不需要 --db）
 *   node dist/cli.js --db heyta.sqlite --server http://127.0.0.1:3000 \
 *     --token <jwt> --password <口令> sync
 *
 * 参数也可以走环境变量：HEYTA_DB / HEYTA_SERVER_URL / HEYTA_TOKEN /
 * HEYTA_PASSWORD / HEYTA_CLIENT_ID。加 `--json` 输出机器可读结果。
 */

import { readFileSync, writeFileSync, writeSync } from 'node:fs';

import { parseLocalDate } from '@heyta/domain';
import {
  parseExportDocument,
  serializeExportDocument,
  type NewTaskFields,
} from '@heyta/app-host';
import { openNodeHost } from './host.js';
import { runAuthCommand } from './cli-auth.js';
import type { SyncStatus } from '@heyta/sync-client';

const VALUE_FLAGS = new Set([
  'db',
  'server',
  'token',
  'password',
  'client-id',
  'due',
  'out',
  'in',
]);
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
      // 🔴 终端界面**不在**三个外壳的本地化范围内（它的输出本来就是中文），
      // 所以这里不接词条表。但已知原因现在**没有 `message`**（那是给壳用的
      // 结构化 `reason`，见 `SyncFailureReason`）—— 所以退回原因码本身：
      // 对看终端的人来说 `not-configured` 比空字符串有用得多。
      return status.message ?? `同步失败（${status.reason}）`;

    default:
      return status.kind;
  }
}

/**
 * 还原失败的结构化原因 → 终端文案。
 *
 * 🔴 `target-not-empty` 那一句是**产品的诚实条款**：还原只做「空库」，
 * 而把这条说成大而化之的"导入失败"，用户会以为文件坏了，
 * 于是去反复重试或去找别的工具 —— 真正该做的是先清空/另开一个库。
 */
function describeRestoreFailure(reason: string, detail?: string): string {
  const base = ((): string => {
    switch (reason) {
      case 'invalid-json':
        return '这个文件不是合法 JSON';
      case 'invalid-document':
        return '这个文件不是一份完整的 heyta 导出';
      case 'wrong-application':
        return '这个文件不是 heyta 导出的';
      case 'unsupported-format-version':
        return '导出格式版本不认识（文件可能来自更新的版本）';
      case 'unsupported-schema-version':
        return 'op schema 版本与本机不同，跨版本还原本轮不支持';
      case 'inconsistent-document':
        return '文件自相矛盾：重放它的操作日志得不到它自己声称的数据';
      case 'target-not-empty':
        return '本机已经有数据 —— 还原只支持空库，现有数据一个字节都没动';
      case 'verification-failed':
        return '写入后结果与导出不一致（数据可能已部分写入，请检查）';
      default:
        return `未知原因（${reason}）`;
    }
  })();
  return detail === undefined ? base : `${base}（${detail}）`;
}

/**
 * `auth` 子命令自己的 argv —— 不在 `auth` 上时返回 `undefined`。
 *
 * 这里**不**用 `parseArgv`：它会拒绝 `--email` / `--terms`（那是 `auth` 的选项，
 * 不是全局的），而取值型参数（`--db`）的值必须跳过，否则
 * `node cli.js --db auth.sqlite sync` 会把库路径当成命令名。
 */
function authArgvOf(argv: readonly string[]): string[] | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? undefined : arg.slice(2);
      if (name !== undefined && VALUE_FLAGS.has(name)) i += 1;
      continue;
    }
    return arg === 'auth' ? argv.slice(i + 1) : undefined;
  }
  return undefined;
}

const USAGE = `heyta node-host —— 非 Web 宿主（真实 SQLite + 真实同步）

用法：
  node dist/cli.js [全局参数] <命令> [参数]

全局参数：
  --db <路径>          SQLite 文件（或 HEYTA_DB）—— 除 auth 外必填
  --server <url>       同步服务端（或 HEYTA_SERVER_URL）
  --token <jwt>        访问令牌（或 HEYTA_TOKEN）
  --password <口令>    **端到端加密口令**（或 HEYTA_PASSWORD）—— 与「auth」收的那条登录口令**不是同一个秘密**
  --client-id <id>     覆盖设备 id（或 HEYTA_CLIENT_ID）
  --json               机器可读输出

命令：
  auth register --server <url> --email <邮箱> --terms [--invite <码>]
                            注册。**口令从 stdin 读**：printf '%s' "$口令" | …
                            没给 --terms 时**一个请求都不发**（不替你勾同意）
  auth login --server <url> --email <邮箱>
                            登录并**打印令牌**（口令同样从 stdin 读）
                            🔴 这一步只产出令牌：同步还要**另一个**口令，见 --password
  add <标题> [--due 2026-10-05]  创建一个任务（--due 是**本地日期**）
  list [--all]              列出任务（默认只列未完成）
  trash                     列出回收站里的任务（有墓碑且未彻底删除）
                            🔴 remove 与 purge 都会让 list 变空，没有这条
                            就区分不开"进了回收站"和"彻底删掉"——判据会在只做了
                            前者时照样绿
  rename <id> <标题>        改标题
  complete <id>             标记完成
  reopen <id>               取消完成
  remove <id>               软删除（DEL op ⇒ 墓碑，进回收站）
  purge <id>                彻底删除（只能对已软删除的条目；回收站里也不再可见）
                            🔴 这两条是给**取证探针收尾**用的：没有删除通道，
                            探针写进真实库的任务就永远留在用户看得见的界面上
  sync                      与真实服务端同步一次
  pending                   打印待上传队列长度
  projects                  列出清单
  tags                      列出标签
  export --out <路径>       导出全部数据到 JSON 文件（含已删除记录与完整操作日志）
  import --in <路径>        从导出的 JSON 还原 —— **只支持还原到空库**；
                            本机已有数据时拒绝，且不会改动任何现有数据
`;

/**
 * ⚠️ 帮助文本**必须与 `case` 分支保持同步**。
 *
 * 它一度只列到 `pending`，而 `projects` 早就实现了 —— 于是验收脚本的作者
 * 会以为"没有列清单的命令"，转而用界面上有没有那个名字去推断跨设备同步，
 * 而那正是本仓库反复栽过的那种证据。**少写一行帮助文本的代价，是让别人
 * 选错判据。** 新增命令时同时改这里。
 */

async function main(): Promise<number> {
  const rawArgv = process.argv.slice(2);

  // 🔴 `auth` **自己解析参数**，而且**在 `--db` 检查之前**分派。两个理由都是结构性的：
  //   · 它的合法选项与全局那套不同（`--email` / `--terms` 不是全局参数），
  //     先过 `parseArgv` 会得到一句「未知参数 --email」；
  //   · 注册/登录**根本不碰本地库** —— 要求先给一个 SQLite 路径，等于让用户
  //     在拿到账号之前先决定数据放哪。
  const authArgv = authArgvOf(rawArgv);
  if (authArgv !== undefined) {
    const result = await runAuthCommand(authArgv);
    if (result.stdout !== '') writeSync(1, result.stdout);
    if (result.stderr !== '') writeSync(2, result.stderr);
    return result.code;
  }

  const { command, positionals, flags } = parseArgv(rawArgv);
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
    if (token === undefined) {
      throw new Error('sync 需要 --token <jwt>（或 HEYTA_TOKEN）—— 没有的话先跑一条命令拿：auth login');
    }
    if (password === undefined) {
      throw new Error(
        'sync 需要 --password <端到端加密口令>（或 HEYTA_PASSWORD）；没有口令不会以明文上传。\n' +
          '🔴 这一个**不是**登录口令（那条在 `auth login` 的 stdin 里）：' +
          '拿登录口令当加密口令的症状是"能登录、同步却解不开自己的数据"。',
      );
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
                // 清单归属也要能断言：没有它，"手机把任务放进清单后
                // 另一台设备读到了吗"就只能靠界面上有没有那个名字来猜 ——
                // 而界面上"看起来有"正是本仓库反复栽过的那种证据。
                projectId: task.projectId ?? null,
                // 标签也要能断言，理由与 `projectId` 完全一样：
                // 没有它，"手机给任务打的标签另一台设备读到了吗"就只能看
                // 界面上有没有那个名字 —— 而"看起来有"是本仓库反复栽过的证据。
                tagIds: task.tagIds ?? null,
                // 备注也要能断言。在此之前它**不在**这里，而移动端那时也没有写备注的
                // 入口 —— 于是"用户自己写的备注有没有跨设备到达"这件事根本没有判据。
                // 现在两端都能写备注了（Web 的任务行 + 移动端详情面板），
                // 而没有这一项就只能靠界面上"看起来有字"来猜。
                note: task.note ?? null,
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

      case 'trash': {
        const trashed = host.listTrashed();
        if (json) {
          out(
            JSON.stringify({
              ok: true,
              command: 'trash',
              tasks: trashed.map((task) => ({
                id: task.id,
                title: task.title,
                deletedAt: task.deletedAt ?? null,
                purgedAt: task.purgedAt ?? null,
              })),
            }),
          );
        } else if (trashed.length === 0) {
          out('（回收站为空）');
        } else {
          for (const task of trashed) {
            out(`${task.title}  (${task.id})`);
          }
        }
        return 0;
      }

      case 'projects': {
        const projects = host.listProjects();
        if (json) {
          out(
            JSON.stringify({
              ok: true,
              command: 'projects',
              projects: projects.map((project) => ({
                id: project.id,
                name: project.name,
                parentId: project.parentId ?? null,
                archived: project.archived ?? false,
              })),
            }),
          );
        } else if (projects.length === 0) {
          out('（没有清单）');
        } else {
          for (const project of projects) out(`${project.name}  (${project.id})`);
        }
        return 0;
      }

      case 'tags': {
        const tags = host.listTags();
        if (json) {
          out(
            JSON.stringify({
              ok: true,
              command: 'tags',
              tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
            }),
          );
        } else if (tags.length === 0) {
          out('（没有标签）');
        } else {
          for (const tag of tags) out(`${tag.name}  (${tag.id})`);
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

      case 'remove':
      case 'purge': {
        const id = positionals[0];
        if (id === undefined) throw new Error(`${command} 需要 <id>`);
        // 语义全在 `@heyta/app-host`（remove 发 DEL op；purge 只接受已软删除的条目，
        // 对活着的任务会抛错）—— 本壳不判断，只递参数。
        if (command === 'remove') await host.removeTask(id);
        else await host.purgeTask(id);
        if (json) out(JSON.stringify({ ok: true, command, id }));
        else out(`${command === 'remove' ? '已软删除（进回收站）' : '已彻底删除'} ${id}`);
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

      case 'export': {
        const outPath = stringFlag(flags, 'out');
        if (outPath === undefined) {
          throw new Error('export 需要 --out <路径>（把 JSON 写到哪里）');
        }
        // 导出形状全部来自 `@heyta/app-host` —— CLI 只负责落盘与汇报计数。
        const doc = await host.exportDocument();
        writeFileSync(outPath, serializeExportDocument(doc), 'utf8');
        if (json) {
          out(
            JSON.stringify({
              ok: true,
              command: 'export',
              file: outPath,
              counts: doc.counts,
              exportedAt: doc.exportedAt,
            }),
          );
        } else {
          out(
            `已导出到 ${outPath}：${String(doc.counts.totalEntities)} 条记录` +
              `（其中已删除 ${String(doc.counts.totalDeleted)} 条）、` +
              `${String(doc.counts.totalOps)} 条操作日志`,
          );
        }
        return 0;
      }

      case 'import': {
        const inPath = stringFlag(flags, 'in');
        if (inPath === undefined) {
          throw new Error('import 需要 --in <路径>（从哪个 JSON 还原）');
        }
        // 解析与"能不能导、导到哪里"全是 `@heyta/app-host` 的产品语义；
        // CLI 只负责读文件、把结构化 reason 翻译成人话、如实报数。
        const parsed = parseExportDocument(readFileSync(inPath, 'utf8'));
        if (!parsed.ok) {
          if (json) {
            out(
              JSON.stringify({
                ok: false,
                command: 'import',
                reason: parsed.reason,
                detail: parsed.detail ?? null,
              }),
            );
          } else {
            err(`❌ 拒绝还原：${describeRestoreFailure(parsed.reason, parsed.detail)}`);
          }
          return 1;
        }

        const result = await host.restoreExport(parsed.document);
        if (!result.ok) {
          if (json) {
            out(
              JSON.stringify({
                ok: false,
                command: 'import',
                reason: result.reason,
                detail: result.detail ?? null,
              }),
            );
          } else {
            err(`❌ 拒绝还原：${describeRestoreFailure(result.reason, result.detail)}`);
          }
          return 1;
        }

        if (json) {
          out(
            JSON.stringify({
              ok: true,
              command: 'import',
              file: inPath,
              importedOps: result.importedOps,
              skippedOps: result.skippedOps,
              entities: result.entities,
              deleted: result.deleted,
            }),
          );
        } else {
          out(
            `已还原 ${String(result.entities)} 条记录` +
              `（其中已删除 ${String(result.deleted)} 条）、` +
              `${String(result.importedOps)} 条操作日志` +
              (result.skippedOps > 0 ? `（已有 ${String(result.skippedOps)} 条，跳过）` : ''),
          );
          // 🔴 诚实条款：导入的 op 带着原来那台设备的 clientId，
          // 服务端会拒绝它们，所以**这台设备不会把它们上传**。
          out('注意：还原只作用在本机。服务端不会因此收到这些数据。');
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
