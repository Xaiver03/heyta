/**
 * E2 壳侧：`oplog-destroy` 这一发在**原生壳的 realm** 里真的把库文件删掉
 * ==========================================================
 *
 * ## 它防的是什么
 *
 * macOS / Windows 壳的明文不在 WebView 的存储里，而在壳自己的 `heyta.sqlite`
 * （计划 §10.11 的"第二轮读数"）。页侧收不到 `ACCOUNT_CLOSED` 那一下的销毁
 * 就等于没做，而"看起来做了"的形状有两种，两种都必须能红：
 *
 * 1. **把 `close` 当 `destroy`**：连接断了、表还在、文件还在 ——
 *    `db.types.ts:257` 明写这是本条契约存在的历史原因。
 * 2. **`wrapDriver` 无条件挂 `removeDatabase` 键**：原生没实现时
 *    `SqliteAdapter` 的 `driver.removeDatabase === undefined` 判定失效，
 *    于是"文件仍在"被折叠成一次静默成功。下面第 3 条用例专打这一枪。
 *
 * ## 为什么这里用真库文件
 *
 * 判据是"从磁盘上数文件"，不是"mock 说删了"。驱动用的是
 * `NodeSqliteDriver`（真 SQLite），只是按原生桥的约定包成
 * "参数与结果都走 JSON 字符串"的那层形状（见 `native-bridge-order.spec.ts` 的同一层）。
 * 库路径由**驱动工厂**决定，所以报告里的 `target` 就是这条真路径 —— 判据读它，
 * 不读标签。
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { close, handleHostMessage, openOpLog } from '../src/native-bridge.js';

let dir: string;
let dbPath: string;

type NativeShape = {
  exec(sql: string): unknown;
  run(sql: string, paramsJson: string): unknown;
  all(sql: string, paramsJson: string): unknown;
  close(): void;
  removeDatabase?(): unknown;
};

/**
 * 按 `removeMode` 装一个驱动工厂。
 *
 * · `yes` —— 真的删（主文件 + `-wal` + `-shm`）
 * · `no` —— **不提供** `removeDatabase` 这个键（原生壳今天的形状）
 * · `error` —— 提供了，但回的是驱动错误信封（磁盘上删不动，比如权限）
 */
function installDriver(
  removeMode: 'yes' | 'no' | 'error',
  onRemove?: () => void,
): void {
  (globalThis as { __heytaDriverFactory?: unknown }).__heytaDriverFactory = (): NativeShape => {
    const inner = new NodeSqliteDriver(dbPath);
    const params = (paramsJson: string): Parameters<NodeSqliteDriver['all']>[1] =>
      JSON.parse(paramsJson) as Parameters<NodeSqliteDriver['all']>[1];
    const driver: NativeShape = {
      exec: (sql) => inner.exec(sql),
      run: (sql, paramsJson) => inner.run(sql, params(paramsJson)),
      all: (sql, paramsJson) => JSON.stringify(inner.all(sql, params(paramsJson))),
      close: () => inner.close(),
    };
    if (removeMode === 'no') return driver;
    driver.removeDatabase = () => {
      onRemove?.();
      if (removeMode === 'error') {
        return JSON.stringify({ __heytaDriverError: 'read-only file system' });
      }
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          rmSync(dbPath + suffix, { force: true });
        } catch {
          // 删不掉的那一条由下面的 existsSync 说了算，不在这里编原因。
        }
      }
      return JSON.stringify({
        target: dbPath,
        containerRemoved: !existsSync(dbPath),
        ...(existsSync(dbPath) ? { reason: 'still-on-disk' } : {}),
      });
    };
    return driver;
  };
}

/** 发一条消息给壳侧，拿回它要发回去的那些串。 */
async function send(message: unknown): Promise<Record<string, unknown>[]> {
  const { outboundJson } = await handleHostMessage({ messageJson: JSON.stringify(message) });
  return outboundJson.map((json) => JSON.parse(json) as Record<string, unknown>);
}

/** 取第一条回包（`noUncheckedIndexedAccess` 下不解构，见 §7 第 162 条同一族）。 */
async function sendOne(message: unknown): Promise<Record<string, unknown>> {
  const [reply] = await send(message);
  return reply ?? {};
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heyta-bridge-destroy-'));
  dbPath = join(dir, 'heyta.sqlite');
});

afterEach(() => {
  close();
  delete (globalThis as { __heytaDriverFactory?: unknown }).__heytaDriverFactory;
  rmSync(dir, { recursive: true, force: true });
});

describe('oplog-destroy（原生壳 realm 的本机销毁）', () => {
  it('① 驱动有 removeDatabase ⇒ 报告 true，且库文件从磁盘上数不出来', async () => {
    installDriver('yes');
    const ready = await sendOne({ type: 'oplog-hello' });
    expect(existsSync(dbPath), '开库后文件必须在磁盘上').toBe(true);
    expect(ready.clientId, 'clientId 是持久化内容，它证明库里确实有东西').toBeTruthy();

    const reply = await sendOne({ type: 'oplog-destroy' });
    expect(reply.type).toBe('oplog-destroyed');
    const report = reply.report as Record<string, unknown>;
    expect(report.containerRemoved, JSON.stringify(report)).toBe(true);
    expect(report.target, '凭据必须对上真正那个容器').toBe(dbPath);
    expect(report.storesCleared as number).toBeGreaterThan(0);
    expect(existsSync(dbPath)).toBe(false);
    expect(readdirSync(dir), `销毁后残留：${readdirSync(dir).join(', ')}`).toEqual([]);
  });

  it('② 销毁后重开读到的是空库：持久 clientId 换了新的', async () => {
    installDriver('yes');
    const before = (await sendOne({ type: 'oplog-hello' })).clientId;
    await send({ type: 'oplog-destroy' });
    const after = (await sendOne({ type: 'oplog-hello' })).clientId;
    // 🔴 这条判的是"库里那行 clientId 没了"，不是"连接重开成功"。
    //    只 close 不删文件时，重开拿到的是**同一个** id ⇒ 这条会红。
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect(existsSync(dbPath), '销毁后的下一次使用应当开出一份新的空库').toBe(true);
  });

  it('③ 🔴 驱动没有 removeDatabase ⇒ 如实报"文件仍在"，不许静默成功', async () => {
    installDriver('no');
    await send({ type: 'oplog-hello' });

    const [reply] = await send({ type: 'oplog-destroy' });
    const report = reply?.report as Record<string, unknown>;
    expect(report.containerRemoved, JSON.stringify(report)).toBe(false);
    expect(String(report.reason), '原因里必须写清是驱动没实现').toMatch(/removeDatabase/);
    expect(existsSync(dbPath), '这一档下文件本来就该还在（判据不许顺手删它）').toBe(true);
  });

  it('④ 原生删不掉（错误信封）⇒ 回一条 false，而不是把异常抛给页侧', async () => {
    installDriver('error');
    await send({ type: 'oplog-hello' });

    const [reply] = await send({ type: 'oplog-destroy' });
    const report = reply?.report as Record<string, unknown>;
    expect(report.containerRemoved, JSON.stringify(report)).toBe(false);
    expect(String(report.reason)).toMatch(/read-only file system/);
  });

  it('⑤ 销毁句柄在 openOpLog 的幂等门后面也必须装着（接线 bug 要响亮）', async () => {
    installDriver('yes');
    // 走 openOpLog（壳启动时的那一发），再直接销毁：证明句柄不是只在 hello 路径上装的。
    const { clientId } = await openOpLog({ dbPath: '' });
    expect(clientId).toBeTruthy();
    const [reply] = await send({ type: 'oplog-destroy' });
    expect((reply?.report as Record<string, unknown>).containerRemoved).toBe(true);
  });

  it('⑥ 连发两次销毁不炸：第二次是对一份新空库的销毁', async () => {
    installDriver('yes');
    await send({ type: 'oplog-hello' });
    const [first] = await send({ type: 'oplog-destroy' });
    const [second] = await send({ type: 'oplog-destroy' });
    expect((first?.report as Record<string, unknown>).containerRemoved).toBe(true);
    expect((second?.report as Record<string, unknown>).containerRemoved).toBe(true);
  });

  it('⑦ 旁挂文件（-wal / -shm）跟着一起走，只删主文件等于没删', async () => {
    installDriver('yes');
    await send({ type: 'oplog-hello' });
    // 造出 WAL 旁挂：真库在有写入时自己会建，这里再补一份，确保"漏删旁挂"能被抓到。
    writeFileSync(join(dir, 'heyta.sqlite-wal'), 'plain text that must not survive');
    expect(existsSync(join(dir, 'heyta.sqlite-wal'))).toBe(true);

    await send({ type: 'oplog-destroy' });
    expect(readdirSync(dir), `销毁后残留：${readdirSync(dir).join(', ')}`).toEqual([]);
  });

  it('⑧ 🔴 收发两侧的线码串必须成对（只改一边必红）', async () => {
    // 页侧发的是 'oplog-destroy'、壳侧回的是 'oplog-destroyed'：两个串各只有一处真源。
    const senderSource = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../src/host-storage-erasure.ts', import.meta.url), 'utf8'),
    );
    const handlerSource = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../src/native-bridge.ts', import.meta.url), 'utf8'),
    );
    expect(senderSource).toContain("'oplog-destroy'");
    expect(senderSource).toContain("'oplog-destroyed'");
    expect(handlerSource).toContain("'oplog-destroy'");
    expect(handlerSource).toContain("'oplog-destroyed'");

    // 反向腿：页侧真发出去的那条消息，壳侧必须认（不是只比字符串比上了）。
    const replies = await sendAfterInstallFromSender();
    expect(replies.map((r) => r.type)).toContain('oplog-destroyed');
  });
});

/**
 * 第 ⑧ 条的反向腿：装一个**记录出站消息**的驱动与端口，用页侧的真发信方
 * （`eraseHostStoragePortData`）驱动壳侧的 `handleHostMessage`，
 * 于是"串对不上"表现为这一条红，而不是两份源码各自都还写着同一个串。
 */
async function sendAfterInstallFromSender(): Promise<Record<string, unknown>[]> {
  installDriver('yes');
  await openOpLog({ dbPath: '' });

  const { eraseHostStoragePortData } = await import('../src/host-storage-erasure.js');
  const outbound: Record<string, unknown>[] = [];
  const listeners: ((event: { data: unknown }) => void)[] = [];
  (globalThis as { window?: unknown }).window = {
    __heytaHostStoragePort: {
      postMessage: (message: unknown) => {
        const data = message as { type?: string };
        if (data.type !== 'oplog-destroy') return;
        void send(message)
          .then((replies) => {
            outbound.push(...replies);
            for (const listener of listeners) listener({ data: replies[0] });
          })
          .catch(() => undefined);
      },
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => {
        listeners.push(listener);
      },
    },
  };
  try {
    const reports = await eraseHostStoragePortData();
    expect(reports, JSON.stringify(outbound)).toHaveLength(1);
    expect(reports[0]?.containerRemoved, JSON.stringify(reports[0])).toBe(true);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
  return outbound;
}
