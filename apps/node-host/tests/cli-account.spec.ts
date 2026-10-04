/**
 * `account close`（批次 E3 的 CLI 面）的判据
 * ==========================================
 *
 * 这组用例钉的四件事，每件都对应一种**已经发生过**的事故形状：
 *
 *   1. 不带 `--confirm` 时**一个请求都不发、一条数据都不清**（"默认动手"是
 *      不可逆命令最常见的错法）。
 *   2. 本机还有**没上传**的 op 时，带了 `--confirm` 也照样拒绝，而且**没有逃生门**。
 *   3. 服务端**没删成 ⇒ 本机一个字节都没动**（这条顺序在 app-host 里钉，
 *      这里钉的是"这个宿主真的走了那条路"）。
 *   4. 全部放行时，**真实的 SQLite 文件不见了**，重开读不到任何东西 ——
 *      §10.2 要的"逐宿主取证"就是这一条：抽象层绿不代表这台设备清掉了。
 *
 * ⚠️ 夹具一律注入 `fetchImpl`，绝不真发请求；库文件一律是临时目录里的真文件。
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportDocument } from '@heyta/app-host';
import { registerLocalEraser } from '@heyta/app-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAccountCommand, type AccountCommandTarget } from '../src/cli-account.js';
import { openNodeHost, type NodeHost } from '../src/host.js';

let dir: string;
let dbPath: string;
let host: NodeHost | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heyta-account-'));
  dbPath = join(dir, 'heyta.db');
});

afterEach(() => {
  host?.close();
  host = undefined;
  // 🔴 必须**注销销毁器**，不能留给下一个用例：注册表是模块级单例，
  // 而上一个用例的临时目录已经被 rmSync 掉了 —— 留着它，下一个宿主开起来时
  // `openAppHost` 的 `if (!hasLocalEraser())` 就不会再注册，于是销毁动作
  // 打在**上一台宿主**的路径上。本轮实测：那条路径报的是
  // `unable to open database file`（目录没了），而目录还在时它会把**上一台**的
  // 库删掉并回报 `containerRemoved: true` —— 谎报"本机已清"。
  // 见 `packages/app-host/src/local-erasure.ts:40`（"传 undefined 是注销，测试收尾要用"）。
  registerLocalEraser(undefined);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * 开一个真宿主并写进一条任务。
 *
 * ⚠️ 这里也注入 fetch（统一回 404）：这条路径上任何一次"意外真发请求"都应该
 * 变成一次可看见的失败，而不是一次真的打到网上的请求。
 */
async function hostWithData(): Promise<NodeHost> {
  const opened = await openNodeHost({
    dbPath,
    serverUrl: 'https://sync.example.test',
    token: 'token-1',
    fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
  });
  await opened.addTask('只在这台设备上的那条');
  return opened;
}

/** 把真宿主包成命令要的那个小面；`pendingOverride` 用来演"已经同步过的设备"。 */
function targetFor(
  opened: NodeHost,
  overrides: { pendingUploads?: number; serverUrl?: string; token?: string } = {},
): AccountCommandTarget {
  return {
    serverUrl: overrides.serverUrl ?? 'https://sync.example.test',
    token: overrides.token ?? 'token-1',
    pendingUploadCount: async () => overrides.pendingUploads ?? (await opened.pendingUploadCount()),
    exportDocument: () => opened.exportDocument(),
  };
}

const okResponse = (): Response =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('account close：默认是预览', () => {
  it('🔴 不带 --confirm：一个请求都不发，本机数据一条不少，退 1', async () => {
    host = await hostWithData();
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await runAccountCommand(
      { action: 'close', confirm: false, json: false },
      targetFor(host),
      { fetchImpl },
    );

    expect(result.code).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    // 前提：这台设备上确实有东西可清（否则"没清"是空的断言）。
    expect(host.listTasks()).toHaveLength(1);
    expect(existsSync(dbPath)).toBe(true);
    expect(result.stderr).toContain('还没上传');
    expect(result.stderr).toContain('export --out');
    // ⚠️ 句子不许说"没有改动任何文件"：打开库这件事本身就会建文件。
    // 它能承诺的是"没删"。见 cli-account.ts 里 `NOT_EXECUTED` 那段。
    expect(result.stderr).toContain('没有清除任何本机数据');
    expect(result.stderr).not.toContain('没有改动任何文件');
  });

  it('--json 的预览是机器可读的，而且数的是真库', async () => {
    host = await hostWithData();
    const real = await host.exportDocument();

    const result = await runAccountCommand(
      { action: 'close', confirm: false, json: true },
      targetFor(host),
      { fetchImpl: async () => okResponse() },
    );

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      preview: boolean;
      reason: string;
      records: number;
      deletedRecords: number;
      ops: number;
      pendingUploads: number;
    };
    expect(payload.ok).toBe(false);
    expect(payload.preview).toBe(true);
    expect(payload.reason).toBe('needs-confirm');
    // 🔴 数对得上真库，且**非零**。零的话这几行断言就只是"两边都读了个空"。
    expect(payload.records).toBe(real.counts.totalEntities);
    expect(payload.ops).toBe(real.counts.totalOps);
    expect(payload.records).toBeGreaterThan(0);
    expect(payload.pendingUploads).toBeGreaterThan(0);
  });

  it('未知子命令：报错、不发请求（"没给子命令"不许被猜成注销）', async () => {
    host = await hostWithData();
    const fetchImpl = vi.fn(async () => okResponse());

    for (const action of [undefined, 'close-everything']) {
      const result = await runAccountCommand(
        { action, confirm: true, json: false },
        targetFor(host),
        { fetchImpl },
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('只认识子命令 close');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(existsSync(dbPath)).toBe(true);
  });
});

describe('account close：未上传的数据是硬闸门', () => {
  it('🔴 带了 --confirm，但本机有没上传的 op ⇒ 照样拒绝，且什么都没清', async () => {
    host = await hostWithData();
    const pending = await host.pendingUploadCount();
    // 前提：这条用例演的是"有没传出去的数据"这个状态本身。
    expect(pending).toBeGreaterThan(0);
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await runAccountCommand(
      { action: 'close', confirm: true, json: false },
      targetFor(host),
      { fetchImpl },
    );

    expect(result.code).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(result.stderr).toContain(`还有 ${pending} 条操作没有上传`);
    // 没有逃生门：文案里不许出现"再加一个开关就能强推"的话。
    expect(result.stderr).toContain('没有逃生门');
    expect(host.listTasks()).toHaveLength(1);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('--json 拒绝时给的是结构化 reason，不是句子', async () => {
    host = await hostWithData();
    const result = await runAccountCommand(
      { action: 'close', confirm: true, json: true },
      targetFor(host),
      { fetchImpl: async () => okResponse() },
    );
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    // 🔴 用 toEqual 钉**整枚对象**，所以信封的两枚键也要写进来：`command`/`action`
    // 是这台壳把结构化输出交给脚本时用来认领"这行是哪条命令打的"的（`--json` 的
    // 预览那档同样带它们）。漏写就等于把契约写成"没有信封"。
    expect(payload).toEqual({
      ok: false,
      command: 'account',
      action: 'close',
      reason: 'pending-uploads',
      pendingUploads: 1,
    });
  });
});

describe('account close：放行之后', () => {
  it('🔴 服务端 200：真的 DELETE /api/account，且**这个 SQLite 文件不见了**', async () => {
    host = await hostWithData();
    expect(existsSync(dbPath)).toBe(true);
    const calls: { method: string; url: string; authorization?: string | null }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input as string, init);
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get('authorization'),
      });
      return okResponse();
    });

    const result = await runAccountCommand(
      { action: 'close', confirm: true, json: true },
      // pendingUploads: 0 = 这台设备已经把所有 op 送出去了（上面那条用例测的是非 0）。
      targetFor(host, { pendingUploads: 0 }),
      { fetchImpl },
    );

    expect(result.code).toBe(0);
    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: 'https://sync.example.test/api/account',
        authorization: 'Bearer token-1',
      },
    ]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      disposition: string;
      reports: { target: string; containerRemoved: boolean }[];
    };
    expect(payload.disposition).toBe('closed-and-erased');
    expect(payload.reports).toHaveLength(1);
    expect(payload.reports[0]?.containerRemoved).toBe(true);

    // 🔴 这行是 §10.2 要的那台设备的证据：不是"报告说删了"，是**盘上没有了**。
    expect(existsSync(dbPath)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    host.close();
    host = undefined;

    // 重开（会重新建一个空库）读不到任何东西 ⇒ 删掉的确实是那份数据。
    const reopened = await openNodeHost({ dbPath });
    try {
      expect(reopened.listTasks()).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('🔴 服务端 500：账号还在，本机一个字节都没动（顺序在 CLI 这一侧也成立）', async () => {
    host = await hostWithData();
    const fetchImpl = vi.fn(async () => new Response('{"error":"boom"}', { status: 500 }));

    const result = await runAccountCommand(
      { action: 'close', confirm: true, json: false },
      targetFor(host, { pendingUploads: 0 }),
      { fetchImpl },
    );

    expect(result.code).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.stdout).toContain('没有注销');
    expect(result.stdout).not.toContain('已注销');
    // 本机数据必须**原样还在**：这是这条路径唯一真正的不可逆之处。
    expect(existsSync(dbPath)).toBe(true);
    expect(host.listTasks()).toHaveLength(1);
    host.close();
    host = undefined;
    const reopened = await openNodeHost({ dbPath });
    try {
      expect(reopened.listTasks().map((task) => task.title)).toEqual(['只在这台设备上的那条']);
    } finally {
      reopened.close();
    }
  });

  it('没有服务端地址：unconfigured，一个请求都不发，本机不动', async () => {
    host = await hostWithData();
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await runAccountCommand(
      { action: 'close', confirm: true, json: false },
      targetFor(host, { pendingUploads: 0, serverUrl: '' }),
      { fetchImpl },
    );

    expect(result.code).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(result.stdout).toContain('没有服务端地址');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('令牌为空串：unauthorized 那一档，也不发请求', async () => {
    host = await hostWithData();
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await runAccountCommand(
      { action: 'close', confirm: true, json: false },
      targetFor(host, { pendingUploads: 0, token: '   ' }),
      { fetchImpl },
    );

    expect(result.code).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('🔴 句子永远不说"彻底销毁"：四种结局里只有一种能声称本机已清', async () => {
    host = await hostWithData();
    const texts = {
      closed: (await runAccountCommand({ action: 'close', confirm: true, json: false },
        targetFor(host, { pendingUploads: 0 }), { fetchImpl: async () => okResponse() })).stdout,
      notClosed: (await runAccountCommand({ action: 'close', confirm: true, json: false },
        targetFor(host, { pendingUploads: 0 }), { fetchImpl: async () => new Response('{}', { status: 500 }) })).stdout,
    };
    // 成功那一档说清了作用域边界（别的设备与备份不在里面）。
    expect(texts.closed).toContain('别的设备上的副本与备份不在这次动作里');
    expect(texts.notClosed).toContain('服务端没删成');
    for (const text of Object.values(texts)) {
      expect(text).not.toMatch(/彻底(删除|销毁)所有/);
    }
  });
});

/**
 * `runAccountCommand` 的 target 只有四个成员。这条断言的存在理由是：
 * 如果将来 `cli.ts` 里传进去的是别的形状（比如自己拼一个假的 exportDocument），
 * 上面那批"数的是真库"的断言会失去意义。这里钉住**导出的数来自真适配器**。
 */
describe('account close 读的是真适配器', () => {
  it('exportDocument() 的 counts 与 ops 实体对得上', async () => {
    host = await hostWithData();
    const doc: ExportDocument = await host.exportDocument();
    expect(doc.counts.totalEntities).toBe(1);
    expect(doc.counts.totalOps).toBeGreaterThanOrEqual(1);
    expect(doc.counts.totalDeleted).toBe(0);
  });
});
