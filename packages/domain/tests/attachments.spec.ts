/**
 * 附件的领域规则（工单 #9）
 * ==========================
 *
 * 这里钉的是**跨端必须一致**的三件事，与 `comments.spec.ts` 同一立场：
 * 过滤、顺序、闸门各只有的一份定义，写第二遍的表现从来不是报错，
 * 而是"电脑上删掉的附件在手机上还在"或"同一任务两个端显示的大小不一样"。
 */
import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_NAME_MAX_LENGTH,
  aliveAttachmentsForTask,
  attachmentBytesTotal,
  attachmentRejection,
  attachmentSizeIn,
  byAttachmentOrder,
  isImageAttachment,
  type AttachmentLike,
} from '../src/index.js';

const row = (over: Partial<AttachmentLike> & { id: string }): AttachmentLike => ({
  taskId: 'task-1',
  createdAt: 1_000,
  ...over,
});

describe('文件名闸门', () => {
  it('正常名字放行', () => {
    expect(attachmentRejection('合同 第三版.PDF')).toBeUndefined();
  });

  it('🔴 空白算空，不算"一个空名字的文件"', () => {
    // 一个没有名字的附件在列表里是一行空白，用户既不知道它是什么也没有别的线索可点。
    expect(attachmentRejection('')).toBe('empty-name');
    expect(attachmentRejection('   ')).toBe('empty-name');
    expect(attachmentRejection('\t\n')).toBe('empty-name');
  });

  it('超长被拒，上限只有一处定义', () => {
    expect(attachmentRejection('a'.repeat(ATTACHMENT_NAME_MAX_LENGTH))).toBeUndefined();
    expect(attachmentRejection('a'.repeat(ATTACHMENT_NAME_MAX_LENGTH + 1))).toBe('name-too-long');
  });

  it('首尾空白不计入长度（粘贴来的名字常带一个空格）', () => {
    const padded = `${'x'.repeat(ATTACHMENT_NAME_MAX_LENGTH)}   `;
    expect(attachmentRejection(padded)).toBeUndefined();
  });
});

describe('线程顺序与过滤', () => {
  it('软删的不进列表', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', deletedAt: 2_000 })];
    expect(aliveAttachmentsForTask(rows, 'task-1').map((r) => r.id)).toEqual(['a']);
  });

  it('别的任务的附件一条都不进（跨任务串数据是最难查的那种错）', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', taskId: 'task-2' })];
    expect(aliveAttachmentsForTask(rows, 'task-1').map((r) => r.id)).toEqual(['a']);
  });

  it('🔴 先加的在上（升序），不是"最近加的在上"', () => {
    // 一个任务的附件是一组材料，用户靠位置回忆"我先放了合同、后来补了图"。
    // 倒序会让每次上传都把整个列表下移一行，而附件区常就在滚动边界上。
    const rows = [row({ id: 'new', createdAt: 3_000 }), row({ id: 'old', createdAt: 1_000 })];
    expect(aliveAttachmentsForTask(rows, 'task-1').map((r) => r.id)).toEqual(['old', 'new']);
  });

  it('同一毫秒按 id 字典序定 —— 两台设备的到达顺序不能影响结果', () => {
    const a = row({ id: 'att-b', createdAt: 1_000 });
    const b = row({ id: 'att-a', createdAt: 1_000 });
    // 比较器对**两个方向**都给确定答案，否则 sort 会按引擎的稳定性留下第二个未定义。
    expect(byAttachmentOrder(a, b)).toBeGreaterThan(0);
    expect(byAttachmentOrder(b, a)).toBeLessThan(0);
    expect(aliveAttachmentsForTask([a, b], 'task-1').map((r) => r.id)).toEqual(['att-a', 'att-b']);
  });

  it('缺 createdAt 的旧数据按 0 处理，不抛错、也不丢条目', () => {
    const noStamp: AttachmentLike = { id: 'a', taskId: 'task-1' };
    const rows = [noStamp, row({ id: 'b', createdAt: 5 })];
    expect(aliveAttachmentsForTask(rows, 'task-1').map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('不改动传进来的那个数组（排序在副本上做）', () => {
    const rows = [row({ id: 'z', createdAt: 9 }), row({ id: 'y', createdAt: 1 })];
    const before = rows.map((r) => r.id);
    aliveAttachmentsForTask(rows, 'task-1');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('字节合计', () => {
  it('把活着的附件加总', () => {
    const rows = [row({ id: 'a', sizeBytes: 100 }), row({ id: 'b', sizeBytes: 250 })];
    expect(attachmentBytesTotal(aliveAttachmentsForTask(rows, 'task-1'))).toBe(350);
  });

  it('⚠️ 缺 sizeBytes 的条目按 0 计入 —— 这是显示降级，不是丢数据', () => {
    const rows = [row({ id: 'a', sizeBytes: 100 }), row({ id: 'b' })];
    expect(attachmentBytesTotal(rows)).toBe(100);
  });

  it('空列表是 0 而不是 undefined', () => {
    expect(attachmentBytesTotal([])).toBe(0);
  });
});

describe('档位换算（体积该显示成哪一档）', () => {
  it('不到 1000 字节就用字节，不写成 "0 KB"', () => {
    expect(attachmentSizeIn(0)).toEqual({ value: 0, unit: 'bytes' });
    expect(attachmentSizeIn(500)).toEqual({ value: 500, unit: 'bytes' });
    expect(attachmentSizeIn(999)).toEqual({ value: 999, unit: 'bytes' });
  });

  it('1000 起进 KB 档（1000 进制，与系统设置里的写法一致）', () => {
    expect(attachmentSizeIn(1_000)).toEqual({ value: 1, unit: 'kb' });
    expect(attachmentSizeIn(2_048)).toEqual({ value: 2, unit: 'kb' });
  });

  it('1 MB 起进 MB 档，保留一位小数', () => {
    expect(attachmentSizeIn(1_000_000)).toEqual({ value: 1, unit: 'mb' });
    expect(attachmentSizeIn(1_500_000)).toEqual({ value: 1.5, unit: 'mb' });
  });

  it('🔴 999_999 不能显示成 "1000 KB"', () => {
    // 四舍五入后确实是 1000 KB，但没有人会那样写 —— 它会让人以为还有单位没换过来。
    expect(attachmentSizeIn(999_999)).toEqual({ value: 1, unit: 'mb' });
  });

  it('负数与 NaN 都落回 0，不显示成 "-1 KB" 或 "NaN MB"', () => {
    expect(attachmentSizeIn(-5)).toEqual({ value: 0, unit: 'bytes' });
    expect(attachmentSizeIn(Number.NaN)).toEqual({ value: 0, unit: 'bytes' });
  });
});

describe('图片判定', () => {
  it('image/* 判成图片，其余不是', () => {
    expect(isImageAttachment('image/png')).toBe(true);
    expect(isImageAttachment('application/pdf')).toBe(false);
    expect(isImageAttachment(undefined)).toBe(false);
  });

  it('🔴 MIME 大小写不敏感（各平台写法不一致）', () => {
    // 只判小写的后果是某些设备上图片显示成通用文件图标 ——
    // 一个"看起来像 bug"的降级，而没人会为此报错。
    expect(isImageAttachment('Image/PNG')).toBe(true);
  });
});
