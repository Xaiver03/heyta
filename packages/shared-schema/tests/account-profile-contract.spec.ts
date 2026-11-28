/**
 * 账号资料的**服务端裁决**契约 —— 判据面
 * ====================================
 *
 * `account-avatar-plan.spec.ts` 覆盖的是**客户端纪律**那一半（字节量法 / planAvatarUpload /
 * 首字母 / data URI）。本组补的是**没被它覆盖的服务端裁决**，这些正是"服务端是唯一裁决者"
 * 的落点（文件头：客户端的 maxLength 只是少打几个字，真正拒绝必须发生在契约校验里）：
 *
 *   · `accountDisplayNameSchema`：trim 后非空、**按码点数**不超 32（emoji 不能被 `.length`
 *     数成两个码点，否则 emoji 昵称凭空少一半额度）；
 *   · `accountProfileUpdateSchema`：`null`（清除）与 `''`/全空白（无效）是**两件不同的事**，
 *     前者必须通过、后者必须拒 —— 合二为一就是"删掉所有字母点保存也成功"的功能缺陷；
 *   · `parseAvatarPayload`：任何一步不对都回 null、**永不抛**；
 *   · `accountAvatarUpdateSchema`：服务端拒非标准 base64 / 长度非 4 倍数 / 超上传体上限 /
 *     超原图上限 / 非白名单类型。
 *
 * 每条断言都对着一个"删掉/放宽即红"的实现点。
 */
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  ACCOUNT_AVATAR_MAX_UPLOAD_BASE64_BYTES,
  ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS,
  accountAvatarUpdateSchema,
  accountDisplayNameSchema,
  accountProfileUpdateSchema,
  parseAvatarPayload,
} from '../src/account-profile-contract.js';

describe('accountDisplayNameSchema —— trim + 码点数上限', () => {
  it('返回 trim 后的值', () => {
    const r = accountDisplayNameSchema.safeParse('  Alice  ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('Alice');
  });

  it('🔴 全空白 / 空串被拒（漏掉 trim 或 min(1) 即红）', () => {
    expect(accountDisplayNameSchema.safeParse('   ').success).toBe(false);
    expect(accountDisplayNameSchema.safeParse('').success).toBe(false);
  });

  it('🔴 上限按**码点**：20 个 emoji 通过（.length 为 40，会误拒 ⇒ 用 .length 即红）', () => {
    const emoji20 = '👍'.repeat(20);
    expect(emoji20.length).toBe(40); // 证明这不是靠 UTF-16 长度过的
    expect(accountDisplayNameSchema.safeParse(emoji20).success).toBe(true);
  });

  it('🔴 恰好 32 码点通过、33 码点拒绝（阈值从常量来）', () => {
    const max = ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS;
    expect(accountDisplayNameSchema.safeParse('a'.repeat(max)).success).toBe(true);
    expect(accountDisplayNameSchema.safeParse('a'.repeat(max + 1)).success).toBe(false);
  });
});

describe('accountProfileUpdateSchema —— null（清除）≠ 空串（无效）', () => {
  it('🔴 displayName: null ⇒ 通过且值为 null（清除昵称是合法的显式删）', () => {
    const r = accountProfileUpdateSchema.safeParse({ displayName: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.displayName).toBeNull();
  });

  it('🔴 displayName: "" / 全空白 ⇒ 拒绝（把空串当"清除"即红）', () => {
    expect(accountProfileUpdateSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(accountProfileUpdateSchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });

  it('🔴 缺 displayName 键 ⇒ 拒绝（nullable 不等于 optional，"不传"与"清除"是两件事）', () => {
    expect(accountProfileUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('合法昵称 ⇒ 通过', () => {
    const r = accountProfileUpdateSchema.safeParse({ displayName: '邓湘雷' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.displayName).toBe('邓湘雷');
  });
});

describe('parseAvatarPayload —— 任何一步不对都回 null，永不抛', () => {
  it('坏 JSON ⇒ null（不抛）', () => {
    expect(parseAvatarPayload('{ not json')).toBeNull();
  });

  it('JSON 不是对象（数组 / null）⇒ null', () => {
    expect(parseAvatarPayload('[]')).toBeNull();
    expect(parseAvatarPayload('null')).toBeNull();
  });

  it('🔴 白名单外 contentType ⇒ null', () => {
    expect(parseAvatarPayload(JSON.stringify({ contentType: 'image/gif', dataBase64: 'AAAA' }))).toBeNull();
  });

  it('🔴 缺 dataBase64 / 空 dataBase64 ⇒ null', () => {
    expect(parseAvatarPayload(JSON.stringify({ contentType: 'image/png' }))).toBeNull();
    expect(parseAvatarPayload(JSON.stringify({ contentType: 'image/png', dataBase64: '' }))).toBeNull();
  });

  it('合法载荷 ⇒ 返回同一形状', () => {
    expect(parseAvatarPayload(JSON.stringify({ contentType: 'image/png', dataBase64: 'AAAA' }))).toEqual({
      contentType: 'image/png',
      dataBase64: 'AAAA',
    });
  });
});

describe('accountAvatarUpdateSchema —— 服务端对上传体的硬校验', () => {
  it('合法小图 ⇒ 通过', () => {
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/png', dataBase64: 'AAAA' }).success).toBe(true);
  });

  it('🔴 非标准 base64 字符 ⇒ 拒（删掉 regex 即红：否则解码会静默丢字符）', () => {
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/png', dataBase64: 'AAA!' }).success).toBe(false);
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/png', dataBase64: 'AA-_' }).success).toBe(false);
  });

  it('🔴 长度非 4 的倍数 ⇒ 拒（删掉 %4 校验即红）', () => {
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/png', dataBase64: 'AAA' }).success).toBe(false);
  });

  it('🔴 解码后超过原图上限 ⇒ 拒（80 万 base64 字符 < 1MiB 上传体，但解码 60 万 > 512KiB；删掉 source 上限即红）', () => {
    const decodedOverSource = 'A'.repeat(800_000);
    expect(decodedOverSource.length % 4).toBe(0);
    expect((decodedOverSource.length * 3) / 4).toBeGreaterThan(ACCOUNT_AVATAR_MAX_SOURCE_BYTES);
    expect(decodedOverSource.length).toBeLessThanOrEqual(ACCOUNT_AVATAR_MAX_UPLOAD_BASE64_BYTES);
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/png', dataBase64: decodedOverSource }).success).toBe(
      false,
    );
  });

  it('🔴 超过上传体上限（base64 串字节数）⇒ 拒', () => {
    const overUpload = 'A'.repeat(ACCOUNT_AVATAR_MAX_UPLOAD_BASE64_BYTES + 4);
    expect(overUpload.length % 4).toBe(0);
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/png', dataBase64: overUpload }).success).toBe(false);
  });

  it('🔴 content type 不在白名单 ⇒ 拒', () => {
    expect(accountAvatarUpdateSchema.safeParse({ contentType: 'image/svg+xml', dataBase64: 'AAAA' }).success).toBe(false);
  });
});
