/**
 * 头像的**客户端纪律**那一半：字节量法、"这张图能不能当头像"的唯一裁决，
 * 以及头像在界面上的两个字节形状（首字母 / data URI）。
 *
 * 为什么这一族判据住在 `@heyta/shared-schema` 而不是两个壳里：
 * `ACCOUNT_AVATAR_MAX_SOURCE_BYTES` 与格式白名单是产品规格，而"怎么量 base64
 * 的字节数"以前住在 `apps/web/src/features/settings/avatar-encode.ts` 里。
 * 移动端接头像时如果它自己再写一遍 `Math.floor(len*3/4) - padding`，
 * 就有了**两套裁决标准**（AGENTS §3.5），而这类重复的漂移症状从来不是报错，
 * 是"web 收得下的图手机收不下"。
 *
 * ⚠️ 本文件 2026-10-03 被重写过一次：一次 `open(path,'w')` 之后编码失败的写盘
 *    把它清空了（`'w'` 先截断、编码在后）。断言逐条与原版等价，另加两族新判据
 *    （`avatarInitialFromEmail`、`avatarDataUri`）。教训已入台账 §4：
 *    批量写盘要**先在内存里生成完再打开目标文件**，或写临时文件再 rename。
 */
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_AVATAR_CONTENT_TYPES,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  avatarDataUri,
  avatarInitialFromEmail,
  base64DecodedBytes,
  isAvatarContentType,
  planAvatarUpload,
} from '../src/index.js';

/** 造一段解码后正好 `bytes` 字节的 base64（含尾部 padding 的真实形状）。 */
const b64OfLength = (bytes: number): string => Buffer.alloc(bytes, 0xab).toString('base64');

describe('base64DecodedBytes（上限那条规则的量法）', () => {
  it('空串是 0，不是 NaN 也不是负数', () => {
    expect(base64DecodedBytes('')).toBe(0);
  });

  it('三种 padding 形状各自数对', () => {
    // `AAAA` 无 padding（3 字节）、`AAA=`（2）、`AA==`（1）。
    expect(base64DecodedBytes('AAAA')).toBe(3);
    expect(base64DecodedBytes('AAA=')).toBe(2);
    expect(base64DecodedBytes('AA==')).toBe(1);
  });

  it('🔴 0..200 逐个数与**真解码器**一致（探针不是另一套口径）', () => {
    for (let bytes = 0; bytes <= 200; bytes += 1) {
      const encoded = b64OfLength(bytes);
      expect(base64DecodedBytes(encoded), `${bytes} 字节时数错了`).toBe(
        Buffer.from(encoded, 'base64').length,
      );
    }
  });
});

describe('planAvatarUpload（这张图能不能当头像的唯一裁决）', () => {
  it('白名单里的每一种格式都能过', () => {
    for (const contentType of ACCOUNT_AVATAR_CONTENT_TYPES) {
      const dataBase64 = b64OfLength(64);
      expect(planAvatarUpload({ contentType, dataBase64 })).toEqual({
        action: 'accept',
        payload: { contentType, dataBase64 },
      });
    }
    // 正向对照：白名单不是空的（空的循环会让这一条恒真）。
    expect(ACCOUNT_AVATAR_CONTENT_TYPES.length).toBeGreaterThan(0);
  });

  it('白名单外一律 bad-type（大小写、带参数、尾随空格都算外）', () => {
    for (const contentType of [
      'image/gif',
      'image/avif',
      'application/pdf',
      '',
      'IMAGE/JPEG',
      'image/webp;q=0.9',
      'image/png ',
    ]) {
      expect(planAvatarUpload({ contentType, dataBase64: b64OfLength(16) })).toEqual({
        action: 'reject',
        reason: 'bad-type',
      });
    }
  });

  it('空 base64 是 empty，不是 accept', () => {
    expect(planAvatarUpload({ contentType: 'image/png', dataBase64: '' })).toEqual({
      action: 'reject',
      reason: 'empty',
    });
  });

  it('🔴 上限两侧：恰好 MAX 收得下、MAX+1 拒 —— 阈值从契约常量推导，不是抄来的数字', () => {
    expect(
      planAvatarUpload({
        contentType: 'image/jpeg',
        dataBase64: b64OfLength(ACCOUNT_AVATAR_MAX_SOURCE_BYTES),
      }).action,
    ).toBe('accept');
    expect(
      planAvatarUpload({
        contentType: 'image/jpeg',
        dataBase64: b64OfLength(ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 1),
      }),
    ).toEqual({ action: 'reject', reason: 'too-big' });
  });

  it('判序是 bad-type → empty → too-big（先说最该改的那件事）', () => {
    // 一张"格式不对且是空的"的图，界面该说格式，而不是说"没内容"。
    expect(planAvatarUpload({ contentType: 'image/gif', dataBase64: '' })).toEqual({
      action: 'reject',
      reason: 'bad-type',
    });
    // 一张"格式对但是空的"，也不会走到 too-big。
    expect(planAvatarUpload({ contentType: 'image/png', dataBase64: '' })).toEqual({
      action: 'reject',
      reason: 'empty',
    });
    // 格式对、有内容、超上限 —— 这才轮到 too-big。
    expect(
      planAvatarUpload({
        contentType: 'image/png',
        dataBase64: b64OfLength(ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 1),
      }),
    ).toEqual({ action: 'reject', reason: 'too-big' });
  });

  it('🔴 防漂移对：isAvatarContentType 与 planAvatarUpload 必须给同一个答案', () => {
    // 两处判据分开的后果是"界面放行、契约拒收"，症状是一次按下去没反应的按钮。
    for (const contentType of [
      ...ACCOUNT_AVATAR_CONTENT_TYPES,
      'image/gif',
      'text/plain',
      '',
      'IMAGE/JPEG',
    ]) {
      const listed = isAvatarContentType(contentType);
      const outcome = planAvatarUpload({ contentType, dataBase64: b64OfLength(16) });
      if (listed) expect(outcome.action, `${contentType} 被白名单放行却被契约拒`).toBe('accept');
      else expect(outcome).toEqual({ action: 'reject', reason: 'bad-type' });
    }
  });
});

describe('avatarInitialFromEmail（没有头像时圈里那个字母）', () => {
  it('取 @ 之前第一段的第一个码点并转大写', () => {
    expect(avatarInitialFromEmail('you@example.test')).toBe('Y');
    expect(avatarInitialFromEmail('  leading@example.test')).toBe('L');
  });

  it('🔴 拿不到邮箱时**不编一个字母**：空 local、只有 @、undefined 都回 undefined', () => {
    for (const email of [undefined, '', '@example.test', '   @example.test']) {
      expect(avatarInitialFromEmail(email)).toBeUndefined();
    }
  });

  it('emoji 邮箱给的是**整个码点**，不是半个代理对', () => {
    // 这就是抽进共享层的理由：web 原来的两处有一处写 `.charAt(0)`，
    // 它会取出孤立的半代理（屏幕上是一个方块），另一处是别的写法。
    // 同一个账号在两个圈里长得不一样，而没有任何一层会报错。
    const initial = avatarInitialFromEmail('\u{1F44D}x@example.test');
    expect(initial).toBe('\u{1F44D}');
    expect(initial === undefined ? 0 : initial.length).toBe(2);
  });

  it('两个不同的邮箱给出两个不同的字母（探针不是恒真）', () => {
    expect(avatarInitialFromEmail('a@x')).not.toBe(avatarInitialFromEmail('b@x'));
  });
});

describe('avatarDataUri（头像在界面上的字节形状）', () => {
  it('拼出 `data:<contentType>;base64,<dataBase64>` 的精确形状', () => {
    expect(avatarDataUri({ contentType: 'image/jpeg', dataBase64: 'AAA=' })).toBe(
      'data:image/jpeg;base64,AAA=',
    );
  });

  it('🔴 把 contentType 与 dataBase64 **互换**，结果必须不同（否则拼错位也照样绿）', () => {
    const a = avatarDataUri({ contentType: 'image/png', dataBase64: 'BBB=' });
    const b = avatarDataUri({ contentType: 'image/webp', dataBase64: 'CCC=' });
    const swapped = avatarDataUri({ contentType: 'image/webp', dataBase64: 'BBB=' });
    expect(a).not.toBe(b);
    expect(swapped).not.toBe(a);
    expect(swapped).not.toBe(b);
  });
});
