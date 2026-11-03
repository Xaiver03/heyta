/**
 * 附件线协议契约的自检（工单 #9）
 * ===============================
 *
 * 这个文件钉的是**推导关系**，不是"值等于某个字面量"。理由：契约里最容易腐烂的
 * 不是数字本身，而是"两个数其实是同一个意思"这件事 —— 它一旦断掉，症状是
 * "文件明明没超限却总被拒"（或反过来：超限的文件被收下），
 * 而两端各自看都自洽，谁也不会报错。
 *
 * 三条推导链：
 *   1. base64 上限 **必须由源字节上限推出来**（4/3 膨胀）。
 *   2. 服务端注册用的 `ATTACHMENT_ROUTE_PATTERN` 与客户端拼的
 *      `ATTACHMENT_ROUTES.*(id)` **必须指向同一条路**。
 *   3. `ATTACHMENT_ID_REGEX` 必须接受 `att-${randomId()}` 的**两种运行时形状**
 *      （UUID 与 base36 回退），否则回退路径上的设备上传会 400。
 *      ⚠️ 那条回退在 Hermes（RN）上真会走到 —— `ids.ts` 的文件头写了为什么。
 */
import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_ID_REGEX,
  ATTACHMENT_ROUTES,
  ATTACHMENT_ROUTE_PATTERN,
  ENTITY_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_UPLOAD_BASE64_BYTES,
  attachmentUploadSchema,
} from '../src/index.js';

const ID = 'att-0f6d3a1b-2c4d-4e5f-8a9b-0c1d2e3f4a5b';

describe('两个上限是同一个意思', () => {
  it('base64 上限由源字节上限按 4/3 推导，不是另写一遍', () => {
    expect(MAX_ATTACHMENT_UPLOAD_BASE64_BYTES).toBe(Math.ceil((MAX_ATTACHMENT_BYTES / 3) * 4));
  });

  it('4/3 取整不会让"刚好到顶的文件"被误拒', () => {
    // 解码后的长度最多是 base64 长度的 3/4；这条断言保证两个上限之间
    // 不会因为取整而出现"谁也够不着"的那 1~3 字节缝。
    const decodedAtMost = Math.floor((MAX_ATTACHMENT_UPLOAD_BASE64_BYTES / 4) * 3);
    expect(decodedAtMost).toBeGreaterThanOrEqual(MAX_ATTACHMENT_BYTES);
  });

  it('单文件上限小于账号默认额度（否则一个文件就塞满账号）', () => {
    // 100 MiB 是 `getDefaultStorageQuotaBytes()` 的默认档；这条断言的意义是
    // "最多五个文件就满"这个量级**成立**，而不是靠注释说。
    expect(MAX_ATTACHMENT_BYTES * 5).toBeLessThanOrEqual(100 * 1024 * 1024);
  });
});

describe('服务端模式与客户端路径不漂移', () => {
  it('把模式里的参数段换成真 id，就是客户端拼出来的那条路', () => {
    expect(`/api${ATTACHMENT_ROUTE_PATTERN.replace(':attachmentId', ID)}`).toBe(
      ATTACHMENT_ROUTES.upload(ID),
    );
  });

  it('上传与回收指向同一个地址（方法才是区别）', () => {
    expect(ATTACHMENT_ROUTES.remove(ID)).toBe(ATTACHMENT_ROUTES.upload(ID));
  });

  it('🔴 这条通道上没有 GET —— 没有能用它的界面，就先不开那条路', () => {
    // 「点开附件」需要原生把响应直接落进本机文件（base64 过 RN 桥对 20 MB 的图
    // 是不可接受的卡顿）。那一刀没做之前，读端点是一件**没人调**的事，
    // 而"没人调的端点"正是这个仓库反复清理的那一类形状。
    // 这条断言的作用：以后有人补 GET 时这里会红，逼他同时补上消费者与理由。
    expect(Object.keys(ATTACHMENT_ROUTES)).toEqual(['upload', 'remove']);
  });

  it('id 出现在路径段里，不会掉进查询串', () => {
    expect(ATTACHMENT_ROUTES.upload(ID)).toBe(`/api/attachments/${ID}`);
  });
});

describe('id 的形状闸门', () => {
  it('接受 UUID 形态的附件 id', () => {
    expect(ATTACHMENT_ID_REGEX.test(ID)).toBe(true);
  });

  it('🔴 接受 ids.ts 回退路径的那种形状', () => {
    // Hermes 上没有 crypto.randomUUID 时走这条；被闸门误杀的后果是
    // "在这台设备上永远传不上去"，而其它设备一切正常。
    expect(ATTACHMENT_ID_REGEX.test('att-lz4k9x2-3-mnbvqa1z')).toBe(true);
  });

  it('拒绝空串、非 att- 前缀、路径穿越与超长串', () => {
    for (const bad of ['', 'attachment-1', 'att-', 'att-../../etc/passwd', `att-${'x'.repeat(70)}`]) {
      expect(ATTACHMENT_ID_REGEX.test(bad), bad).toBe(false);
    }
  });
});

describe('请求/响应体的形状', () => {
  it('收下合法的一对字段', () => {
    const parsed = attachmentUploadSchema.safeParse({
      dataBase64: 'aGV5',
      contentType: 'image/png',
    });
    expect(parsed.success).toBe(true);
  });

  it('空的 base64 不算"一个空文件"', () => {
    expect(
      attachmentUploadSchema.safeParse({ dataBase64: '', contentType: 'image/png' }).success,
    ).toBe(false);
  });

  it('非标准 base64（带空格 / URL 字符）被拒', () => {
    for (const bad of ['aGV5 ', 'aGV5\n', 'aGV-__', 'aGV+__']) {
      expect(attachmentUploadSchema.safeParse({ dataBase64: bad, contentType: 'x/y' }).success, bad).toBe(false);
    }
  });

  it('缺 contentType 被拒（下载时要靠它回填 Content-Type）', () => {
    expect(attachmentUploadSchema.safeParse({ dataBase64: 'aGV5' }).success).toBe(false);
  });
});

describe('实体登记', () => {
  it('ATTACHMENT 在 ENTITY_TYPES 里且只出现一次', () => {
    const hits = ENTITY_TYPES.filter((t) => t === 'ATTACHMENT');
    expect(hits).toHaveLength(1);
  });
});
