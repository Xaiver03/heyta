/**
 * 头像「自动压缩」机制：压缩阶梯 + 逐档进预算的驾驶循环。
 *
 * 这一族的被测对象是 `account-profile-contract.ts` 里新增的三样东西：
 * `avatarCompressionLadder` / `avatarEdgeOnlyLadder` / `encodeAvatarWithinBudget`。
 *
 * ## 为什么要单独钉这一组
 *
 * 此前头像的降级逻辑是**没有的**：压一次 512 px，压完超 512 KB 就直接
 * `too-big` 把用户挡回去。而"超不超过"取决于图的**内容**（纯色截图 8 KB、
 * 噪点照片 700 KB），原图尺寸根本不是判据 —— 所以被挡的往往是完全正常的相册照片。
 *
 * 现在承诺的是「**不管原图多大，只要解得开就一定压得进预算**」。这条承诺能成立，
 * 靠的是两条可测的性质：
 * ① 阶梯末档是 128 px，128² × 4 字节（ARGB 原始像素）也 < 512 KB —— **算术**保证；
 * ② 循环对每一档"编码 → 量字节 → 进预算就收、否则降一档"，最终一定走到末档 —— **控制流**保证。
 * 下面把这两条各自钉死，任何一处被改坏都会精确报红。
 */
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_AVATAR_CONTENT_TYPES,
  ACCOUNT_AVATAR_EDGE_PX,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  ACCOUNT_AVATAR_MIN_EDGE_PX,
  avatarCompressionLadder,
  avatarEdgeOnlyLadder,
  base64DecodedBytes,
  encodeAvatarWithinBudget,
  type AvatarCompressionStep,
} from '../src/index.js';

/** 造一段解码后正好 `bytes` 字节的 base64。 */
const b64OfBytes = (bytes: number): string => Buffer.alloc(bytes, 0xab).toString('base64');

/** 一把"指定边长/格式/质量"的档位，方便构造被测阶梯。 */
const step = (
  edgePx: number,
  contentType: AvatarCompressionStep['contentType'] = 'image/jpeg',
  quality?: number,
): AvatarCompressionStep => ({ edgePx, contentType, ...(quality === undefined ? {} : { quality }) });

describe('算术兜底：末档 128 px 一定塞得进 512 KB', () => {
  it('🔴 128² × 4 字节（最坏 ARGB 原始像素）≤ 字节上限 —— 这是"不管多大都能压进去"的证明', () => {
    // PNG 的 DEFLATE 在最坏情况（纯噪点）相对原始像素有极小膨胀，这里用 4 字节/像素
    // 的原始 ARGB 体积当**上界**已经足够松（实际压缩后只更小）。
    const worstCasePngBytes = ACCOUNT_AVATAR_MIN_EDGE_PX * ACCOUNT_AVATAR_MIN_EDGE_PX * 4;
    expect(worstCasePngBytes).toBeLessThanOrEqual(ACCOUNT_AVATAR_MAX_SOURCE_BYTES);
    // 且这个上界不是"刚好卡在边上"：至少留一档余量的一半。
    expect(worstCasePngBytes * 2).toBeLessThanOrEqual(ACCOUNT_AVATAR_MAX_SOURCE_BYTES);
  });

  it('首选档严格大于末档，两者都是正数', () => {
    expect(ACCOUNT_AVATAR_EDGE_PX).toBeGreaterThan(ACCOUNT_AVATAR_MIN_EDGE_PX);
    expect(ACCOUNT_AVATAR_MIN_EDGE_PX).toBeGreaterThan(0);
  });
});

describe('avatarCompressionLadder（web 用的完整阶梯：可降质量也可降边长）', () => {
  it('白名单外的源类型回空数组（调用方据此说"格式不支持"）', () => {
    for (const type of ['image/gif', 'application/pdf', '', 'IMAGE/JPEG', 'image/webp;q=1']) {
      expect(avatarCompressionLadder(type)).toEqual([]);
    }
  });

  it('PNG 源只出 PNG 档、且不带质量（无损，转 JPEG 会把透明铺黑底）', () => {
    const ladder = avatarCompressionLadder('image/png');
    expect(ladder.length).toBeGreaterThan(0);
    for (const s of ladder) {
      expect(s.contentType).toBe('image/png');
      expect(s.quality).toBeUndefined();
    }
  });

  it('JPEG / webp 源输出 JPEG 档，每档都带 0–1 的质量值', () => {
    for (const type of ['image/jpeg', 'image/webp']) {
      const ladder = avatarCompressionLadder(type);
      expect(ladder.length).toBeGreaterThan(0);
      for (const s of ladder) {
        expect(s.contentType).toBe('image/jpeg');
        expect(typeof s.quality).toBe('number');
        expect(s.quality as number).toBeGreaterThan(0);
        expect(s.quality as number).toBeLessThanOrEqual(1);
      }
    }
  });

  it('每一档的输出格式都在白名单内（否则引擎会编出一个服务端不认的格式）', () => {
    for (const type of [...ACCOUNT_AVATAR_CONTENT_TYPES]) {
      for (const s of avatarCompressionLadder(type)) {
        expect(ACCOUNT_AVATAR_CONTENT_TYPES as readonly string[]).toContain(s.contentType);
      }
    }
  });

  it('🔴 首档是 512、末档是 128，且边长单调不增（先保清晰度、再降尺寸）', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const edges = avatarCompressionLadder(type).map((s) => s.edgePx);
      expect(edges[0]).toBe(ACCOUNT_AVATAR_EDGE_PX);
      expect(edges[edges.length - 1]).toBe(ACCOUNT_AVATAR_MIN_EDGE_PX);
      for (let i = 1; i < edges.length; i += 1) {
        expect(edges[i]).toBeLessThanOrEqual(edges[i - 1]);
      }
      // 末档必须真的 == 兜底值，否则"必然收得下"就不成立。
      expect(Math.min(...edges)).toBe(ACCOUNT_AVATAR_MIN_EDGE_PX);
    }
  });

  it('JPEG 在同一档边长上先把质量从高到低试完，再跳到下一档边长', () => {
    const ladder = avatarCompressionLadder('image/jpeg');
    // 每个边长至少出现一次，且质量序列随档位递减（不会出现"低质在前、高质在后"）。
    const firstEdge = ladder[0].edgePx;
    const sameEdgeQualities = ladder.filter((s) => s.edgePx === firstEdge).map((s) => s.quality as number);
    expect(sameEdgeQualities.length).toBeGreaterThan(1);
    for (let i = 1; i < sameEdgeQualities.length; i += 1) {
      expect(sameEdgeQualities[i]).toBeLessThan(sameEdgeQualities[i - 1]);
    }
  });
});

describe('avatarEdgeOnlyLadder（移动端用：只降边长，与 web 保底同一串边长）', () => {
  it('白名单外回空数组；每种源都出对应输出格式', () => {
    expect(avatarEdgeOnlyLadder('image/gif')).toEqual([]);
    expect(avatarEdgeOnlyLadder('image/png').every((s) => s.contentType === 'image/png')).toBe(true);
    expect(avatarEdgeOnlyLadder('image/jpeg').every((s) => s.contentType === 'image/jpeg')).toBe(true);
  });

  it('每档只出现一次、不带质量', () => {
    const ladder = avatarEdgeOnlyLadder('image/jpeg');
    expect(ladder.every((s) => s.quality === undefined)).toBe(true);
    const edges = ladder.map((s) => s.edgePx);
    expect(new Set(edges).size).toBe(edges.length);
  });

  it('🔴 与 web 的完整阶梯走**同一串边长**（否则"网页能传、手机传不上"就回来了）', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const fullDistinct = [...new Set(avatarCompressionLadder(type).map((s) => s.edgePx))];
      const edgeOnly = avatarEdgeOnlyLadder(type).map((s) => s.edgePx);
      expect(edgeOnly).toEqual(fullDistinct);
      expect(edgeOnly[0]).toBe(ACCOUNT_AVATAR_EDGE_PX);
      expect(edgeOnly[edgeOnly.length - 1]).toBe(ACCOUNT_AVATAR_MIN_EDGE_PX);
    }
  });
});

describe('encodeAvatarWithinBudget（逐档编码、逐档量字节的驾驶循环）', () => {
  it('🔴 第一档进预算就用它，且只调用了到那一档为止的编码次数', async () => {
    const ladder = [step(512), step(384), step(256)];
    const calls: number[] = [];
    const encode = (s: AvatarCompressionStep): string => {
      calls.push(s.edgePx);
      // 512 太大、384 起进预算。
      return b64OfBytes(s.edgePx >= 400 ? ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 10 : 1_000);
    };
    const outcome = await encodeAvatarWithinBudget(ladder, encode);
    expect(outcome).toEqual({
      action: 'accept',
      payload: { contentType: 'image/jpeg', dataBase64: b64OfBytes(1_000) },
    });
    expect(calls).toEqual([512, 384]); // 384 一进预算就停，不再试 256
  });

  it('`null` 与空串（这一档压不出来）被跳过，继续试下一档，不算"太大"', async () => {
    const ladder = [step(512), step(384), step(256)];
    const encode = (s: AvatarCompressionStep): string | null =>
      s.edgePx === 512 ? null : s.edgePx === 384 ? '' : b64OfBytes(50);
    await expect(encodeAvatarWithinBudget(ladder, encode)).resolves.toEqual({
      action: 'accept',
      payload: { contentType: 'image/jpeg', dataBase64: b64OfBytes(50) },
    });
  });

  it('恰好等于上限收得下、上限 +1 就继续降（阈值来自契约常量，不是抄来的数）', async () => {
    await expect(
      encodeAvatarWithinBudget([step(512)], () => b64OfBytes(ACCOUNT_AVATAR_MAX_SOURCE_BYTES)),
    ).resolves.toEqual({
      action: 'accept',
      payload: { contentType: 'image/jpeg', dataBase64: b64OfBytes(ACCOUNT_AVATAR_MAX_SOURCE_BYTES) },
    });
    await expect(
      encodeAvatarWithinBudget([step(512)], () => b64OfBytes(ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 1)),
    ).resolves.toEqual({ action: 'reject', reason: 'too-big' });
  });

  it('全程都有产物但都超预算 ⇒ too-big（防御分支，正常阶梯到 128 px 不该走到）', async () => {
    const ladder = [step(512), step(384)];
    await expect(
      encodeAvatarWithinBudget(ladder, () => b64OfBytes(ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 1)),
    ).resolves.toEqual({ action: 'reject', reason: 'too-big' });
  });

  it('全程一档都产出不了（全 null / 空串）⇒ undecodable，而不是 too-big', async () => {
    await expect(encodeAvatarWithinBudget([step(512), step(384)], () => null)).resolves.toEqual({
      action: 'reject',
      reason: 'undecodable',
    });
    await expect(encodeAvatarWithinBudget([step(512), step(384)], () => '')).resolves.toEqual({
      action: 'reject',
      reason: 'undecodable',
    });
  });

  it('🔴 "不管多大"的模拟：按每档最坏体积产出，也会自动降到合适档位并成功', async () => {
    // 用 PNG 完整阶梯；encode 产出"该档最坏 ARGB 原始体积"的 base64，模拟最不利的内容。
    const ladder = avatarCompressionLadder('image/png');
    const encode = (s: AvatarCompressionStep): string => b64OfBytes(s.edgePx * s.edgePx * 4);
    const outcome = await encodeAvatarWithinBudget(ladder, encode);
    expect(outcome.action).toBe('accept');
    if (outcome.action !== 'accept') throw new Error('unreachable');
    const chosenBytes = base64DecodedBytes(outcome.payload.dataBase64);
    // 选中的那一档，其最坏体积必须 ≤ 上限；且它确实比首档小（说明真的降了档）。
    expect(chosenBytes).toBeLessThanOrEqual(ACCOUNT_AVATAR_MAX_SOURCE_BYTES);
    expect(chosenBytes).toBeLessThan(ACCOUNT_AVATAR_EDGE_PX * ACCOUNT_AVATAR_EDGE_PX * 4);
  });

  it('编码器按阶梯顺序被调用（不会跳档或乱序）', async () => {
    const ladder = avatarCompressionLadder('image/jpeg').slice(0, 4).map((s) => s);
    const seen: AvatarCompressionStep[] = [];
    await encodeAvatarWithinBudget(ladder, (s) => {
      seen.push(s);
      return b64OfBytes(ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 1); // 全超，逼它走完
    });
    expect(seen).toEqual(ladder);
  });
});
