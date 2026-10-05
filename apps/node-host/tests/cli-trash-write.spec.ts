/**
 * CLI 的三类实体写命令**参数解析**行为（§10.223 留的那条边界的另一半）
 * ==================================================================
 *
 * §10.223 那条用例打的是 `NodeHost` 的公开通道；这个文件打的是**命令行本身**：
 * 子命令怎么分流、缺参数怎么响亮失败、`--json` 那条信封长什么样。
 *
 * 🔴 为什么这两层都要有：`host.trashRows()` 有牙不代表 `notes remove` 真的把参数递到了它身上。
 * 本批给 CLI 新加的六个分支（`notes|projects|habits` × `add|remove`）如果只在类型检查里过过，
 * 那么"seed 时四类各建一条删一条"这条路会在**下一次真跑的人**手上才第一次现形 ——
 * 而 seed 失败的界面症状是"回收站里只画了任务"，长得和"功能没做"一模一样（§10.219 那条教训）。
 *
 * ⚠️ 这里 spawn 的是 **`dist/cli.js`（构建产物）**，不是源码 —— 与 `cli-ai-e2e.spec.ts` 同一把尺。
 *    所以跑之前必须 `pnpm --filter @heyta/node-host build`，否则测的是旧产物（AGENTS §7 第 27 条那个形状）。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli.js');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[], db: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, '--db', db, ...args], {
      env: process.env as Record<string, string>,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-cli-trash-'));
  dirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('CLI 写子命令：notes / projects / habits 的 add 与 remove', () => {
  it('add 回 id、remove 认这个 id、`trash --json` 里出现这一行（四类各走一遍）', async () => {
    const db = tempDb();
    const cases = [
      { kind: 'notes', verbArg: '命令行便签正文' },
      { kind: 'projects', verbArg: '命令行清单' },
      { kind: 'habits', verbArg: '命令行习惯' },
      { kind: 'add', verbArg: '命令行任务' },
    ] as const;

    for (const { kind, verbArg } of cases) {
      const addArgs = kind === 'add' ? ['add', verbArg, '--json'] : [kind, 'add', verbArg, '--json'];
      const added = await runCli(addArgs, db);
      expect(added.code, `${kind} add 没退 0：${added.stderr}`).toBe(0);
      const id = String(JSON.parse(added.stdout).id);
      expect(id.length, `${kind} add 的 --json 信封里没有 id`).toBeGreaterThan(0);

      const removeArgs = kind === 'add' ? ['remove', id, '--json'] : [kind, 'remove', id, '--json'];
      const removed = await runCli(removeArgs, db);
      expect(removed.code, `${kind} remove 没退 0：${removed.stderr}`).toBe(0);

      const trashed = await runCli(['trash', '--json'], db);
      expect(trashed.code, `trash 没退 0：${trashed.stderr}`).toBe(0);
      const rows = JSON.parse(trashed.stdout).rows as { id: string }[];
      expect(rows.map((row) => row.id), `${kind} 删掉了却没在回收站里列出来`).toContain(id);
    }
  }, 120_000);

  it('缺参数与不认识的子命令都必须响亮失败（不许静默当成"列出"）', async () => {
    const db = tempDb();
    const missing = await runCli(['notes', 'add', '--json'], db);
    expect(missing.code, '`notes add` 少正文却退 0 ⇒ 命令自己把缺参数咽下去了').not.toBe(0);
    expect(missing.stderr + missing.stdout).toContain('需要');

    const badVerb = await runCli(['habits', 'list'], db);
    expect(badVerb.code, '`habits list` 不是这条命令，却被当成成功').not.toBe(0);
    expect(badVerb.stderr + badVerb.stdout).toContain('需要');
  }, 60_000);
});
