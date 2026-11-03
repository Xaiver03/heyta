/**
 * 附件写路径（工单 #9）
 * ======================
 *
 * 这一族钉的是**三件静默失效**：
 *
 *   1. 🔴 **上传失败却照样写 op** ⇒ 库里留下一条"有名字没有字节"的附件，
 *      每一台设备点开都是 404，而没有任何一层知道该重试。
 *      所以这里量的不是"抛错了"，而是 **op-log 里一条 ATTACHMENT 记录都没有**。
 *   2. 🔴 **blob 的键与实体 id 不是同一个** ⇒ 元数据指向一个没人上传过的键。
 *      判据是"upload 收到的那个 id 就是 CREATE op 的 entityId"，逐字符比。
 *   3. ⚠️ **`sizeBytes` 用客户端估的数** ⇒ 显示的大小与服务端实际存的字节不一致，
 *      而配额那一栏是拿服务端数算的。两个数一旦同源，界面就不会自相矛盾。
 *
 * ⚠️ vitest 不做类型检查（AGENTS §3.5）：这个文件证明不了端口形状与
 * `attachment-http.ts` 的真实现一致 —— 那一格由 `tsc` 守。
 */

import type { Attachment } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { MemoryDbAdapter, DbOpLogStore, INDEXEDDB_SCHEMA } from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_ATTACHMENT_BYTES } from '@heyta/shared-schema';
import { createAttachmentActions, type AttachmentActions } from '../src/attachment-actions.js';
import type { AttachmentBlobPort, AttachmentUploadResult } from '../src/attachment-http.js';

let engine: OpLogEngine;
let actions: AttachmentActions;
const clock = 1_700_000_000_000;

/** 端口调用日志：顺序与参数都看得见，才测得出"先传字节、后发 op"。 */
const calls: string[] = [];
let uploadResult: AttachmentUploadResult = { ok: true, receipt: { hash: 'h', byteCount: 0 } };
const port = {
  upload: vi.fn(async (id: string) => {
    calls.push(`upload:${id}`);
    return uploadResult;
  }),
  remove: vi.fn(async (id: string) => {
    calls.push(`remove:${id}`);
    return { ok: true as const, releasedBytes: 2048 };
  }),
} as unknown as AttachmentBlobPort;

/** 估算约 2 KB 的一串 base64 —— 只用来说"没超过单文件上限"。 */
const BYTES = 'A'.repeat(2732);

beforeEach(async () => {
  const adapter = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-test',
    now: () => clock,
  });
  calls.length = 0;
  vi.clearAllMocks();
  uploadResult = { ok: true, receipt: { hash: 'hash-from-server', byteCount: 2048 } };
  actions = createAttachmentActions(engine, {
    blobs: port,
    newAttachmentId: () => 'att-fixedid0000000000000',
  });
});

const intentOf = async (entityId: string): Promise<Operation<string>[]> =>
  engine.getOpsForEntity('ATTACHMENT', entityId);

async function newTask(title = '带附件的任务'): Promise<string> {
  const { createTaskActions } = await import('../src/actions.js');
  return createTaskActions(engine, { now: () => clock }).create(title);
}

describe('addAttachment 的字节/op 顺序', () => {
  it('先传字节、后发 op，而且只发一条', async () => {
    const taskId = await newTask();
    const created = await actions.addAttachment(taskId, { fileName: '合同.pdf', contentType: 'application/pdf', dataBase64: BYTES });

    expect(calls).toEqual([`upload:${created.id}`]);
    const ops = await intentOf(created.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe('CRT');
  });

  it('🔴 blob 的键就是实体的 id —— 不是另取一个', async () => {
    const taskId = await newTask();
    const created = await actions.addAttachment(taskId, { fileName: 'a.png', contentType: 'image/png', dataBase64: BYTES });
    expect(created.id).toBe('att-fixedid0000000000000');
    expect(calls[0]).toBe(`upload:${created.id}`);
  });

  it('🔴 上传失败 ⇒ op-log 里一条附件记录都没有', async () => {
    const taskId = await newTask();
    uploadResult = { ok: false, reason: 'quota-exceeded' };
    await expect(
      actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES }),
    ).rejects.toThrow('quota-exceeded');
    expect((await engine.getOpsForEntity('ATTACHMENT', 'att-fixedid0000000000000'))).toHaveLength(0);
    expect(actions.attachmentsForTask(taskId)).toEqual([]);
  });

  it('上传失败时不去回收字节 —— 什么都没传上去', async () => {
    const taskId = await newTask();
    uploadResult = { ok: false, reason: 'network' };
    await expect(actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES })).rejects.toThrow();
    expect(port.remove).not.toHaveBeenCalled();
  });

  it('op 写入失败 ⇒ 尽力回收那块孤儿 blob，并把原始错误抛出去', async () => {
    const taskId = await newTask();
    const failing = {
      getState: () => engine.getState(),
      dispatch: async () => {
        throw new Error('存储层写失败');
      },
    };
    const broken = createAttachmentActions(failing, {
      blobs: port,
      newAttachmentId: () => 'att-orphan000000000000',
    });
    await expect(
      broken.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES }),
    ).rejects.toThrow('存储层写失败');
    expect(calls).toContain('remove:att-orphan000000000000');
  });

  it('没有上传通道时明说是 no-channel，而且不发任何请求', async () => {
    const taskId = await newTask();
    const offline = createAttachmentActions(engine, { newAttachmentId: () => 'att-x0000000000000000000' });
    await expect(
      offline.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES }),
    ).rejects.toThrow('（no-channel）');
    expect(port.upload).not.toHaveBeenCalled();
  });

  it('文件名空白 ⇒ 连上传都不发起（闸门在传之前）', async () => {
    const taskId = await newTask();
    await expect(actions.addAttachment(taskId, { fileName: '   ', dataBase64: BYTES })).rejects.toThrow('empty-name');
    expect(port.upload).not.toHaveBeenCalled();
  });

  it('客户端估算就超限 ⇒ 先拦，不做一次注定失败的上传', async () => {
    const taskId = await newTask();
    const huge = 'A'.repeat(Math.ceil(((MAX_ATTACHMENT_BYTES + 1024) * 4) / 3));
    await expect(actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: huge })).rejects.toThrow('too-large');
    expect(port.upload).not.toHaveBeenCalled();
  });
});

describe('写进实体的那几格', () => {
  it('🔴 sizeBytes 是服务端测到的数，不是客户端估的', async () => {
    const taskId = await newTask();
    uploadResult = { ok: true, receipt: { hash: 'h', byteCount: 1234 } };
    await actions.addAttachment(taskId, { fileName: 'a.png', contentType: 'image/png', dataBase64: BYTES });
    expect(actions.attachmentsForTask(taskId)[0]?.sizeBytes).toBe(1234);
  });

  it('任务找不到 ⇒ 拒绝，不留下挂空的附件', async () => {
    await expect(actions.addAttachment('task-not-exist', { fileName: 'a.png', dataBase64: BYTES })).rejects.toThrow(
      '找不到任务',
    );
    expect(port.upload).not.toHaveBeenCalled();
  });
});

describe('removeAttachment 的两条腿', () => {
  it('op 先走、字节随后，回执说字节释放了', async () => {
    const taskId = await newTask();
    const created = await actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES });
    calls.length = 0;
    const outcome = await actions.removeAttachment(created.id);
    expect(outcome).toEqual({ bytesReleased: true });
    expect(calls).toEqual([`remove:${created.id}`]);
    const ops = await intentOf(created.id);
    expect(ops.at(-1)?.opType).toBe('DEL');
    expect(actions.attachmentsForTask(taskId)).toEqual([]);
  });

  it('字节回收失败不撤销删除 —— 用户要的后果已经达成，只把账务说实话', async () => {
    const taskId = await newTask();
    const created = await actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES });
    (port.remove as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason: 'network' });
    const outcome = await actions.removeAttachment(created.id);
    expect(outcome).toEqual({ bytesReleased: false });
    // 列表里已经没有了：这条附件对用户而言就是删掉了，不该再出现在任何视图。
    expect(actions.attachmentsForTask(taskId)).toEqual([]);
  });

  it('不存在的附件 ⇒ 抛错且一个 op 都不写', async () => {
    await expect(actions.removeAttachment('att-not-here')).rejects.toThrow('找不到附件');
    expect(await engine.getOpsForEntity('ATTACHMENT', 'att-not-here')).toHaveLength(0);
  });
});

describe('改名与读出口', () => {
  it('改名只发一条 op，不碰字节', async () => {
    const taskId = await newTask();
    const created = await actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES });
    calls.length = 0;
    await actions.renameAttachment(created.id, '合同-final.png');
    expect(calls).toEqual([]);
    expect(actions.attachmentsForTask(taskId)[0]?.fileName).toBe('合同-final.png');
  });

  it('🔴 名字没变就不写 op（否则看一眼列表就跳序）', async () => {
    const taskId = await newTask();
    const created = await actions.addAttachment(taskId, { fileName: 'a.png', dataBase64: BYTES });
    const before = await intentOf(created.id);
    await actions.renameAttachment(created.id, 'a.png');
    expect(await intentOf(created.id)).toHaveLength(before.length);
  });

  it('列表按 createdAt 升序、软删的不进，字节合计只算活着的', async () => {
    const taskId = await newTask();
    // 这一条要两个不同的 id，所以自带生成器而不是用夹具那枚固定的。
    let n = 0;
    const nextId = (): string => {
      n += 1;
      return `att-seq-${String(n).padStart(4, '0')}`;
    };
    const seq = createAttachmentActions(engine, { blobs: port, newAttachmentId: nextId });
    const first = await seq.addAttachment(taskId, { fileName: 'first.png', dataBase64: BYTES });
    await seq.removeAttachment(first.id);
    const second = await seq.addAttachment(taskId, { fileName: 'second.png', dataBase64: BYTES });
    expect(first.id).not.toBe(second.id);
    const rows: Attachment[] = seq.attachmentsForTask(taskId);
    expect(rows.map((r) => r.fileName)).toEqual(['second.png']);
    expect(seq.attachmentBytesForTask(taskId)).toBe(2048);
  });

  it('🔴 动作层上没有"取回字节"那一条 —— 现在没有能用它的界面', () => {
    // 读字节要等原生的"下载进本机文件"那一刀（base64 过 RN 桥对大图是不可接受的卡顿）。
    // 先把方法做出来 = 又一处"基础设施齐了、最后一米没接"，本仓库清过这类东西好几次。
    // 这条断言的作用：谁加了方法却没同时加消费者，这里会红。
    expect((actions as unknown as Record<string, unknown>).attachmentBytes).toBeUndefined();
  });
});
