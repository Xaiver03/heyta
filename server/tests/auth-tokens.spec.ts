/**
 * `hashToken()` 自身的判据。
 *
 * 它只有一行，但它决定这四列令牌**以及 W3 的找回令牌**的存储形态，
 * 而它的坏法属于"两边一致就看不出来"那一类 —— 所以钉的是性质，不是实现。
 *
 * ⚠️ 下面的对照值是**用 crypto 独立算出来后写死的常量**，不是"再跑一遍被测函数"。
 *    拿实现算期望值等于没测 —— 实现换成 MD5 也照样全绿。
 */
import { describe, expect, it } from 'vitest';

import { hashToken } from '../src/auth-tokens';

describe('hashToken', () => {
  it('就是按 UTF-8 的 SHA-256 十六进制，逐条对照已知取值', () => {
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hashToken('correct horse battery staple')).toBe(
      'c4bbcb1fbec99d65bf59d85c8cb62ee2db963f0fe106f483d9afa73bd4e39a8a',
    );
    expect(hashToken('token-0001')).toBe(
      'e9c9495cb7218d435e9d9f083dc1b2aeacdc84d8db37a769820dbf6c540def92',
    );
  });

  it('是确定性的，且输出形状固定为 64 个小写十六进制字符', () => {
    const token = 'a'.repeat(64);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('输出既不等于输入、也不包含输入', () => {
    // "库里 grep 不到令牌明文"这条验收标准在函数层的对应物。
    for (const token of ['deadbeef'.repeat(8), 'x']) {
      const hashed = hashToken(token);
      expect(hashed).not.toBe(token);
      expect(hashed).not.toContain(token);
    }
  });

  it('区分 NFC 与 NFD（编码约定是确定的，不是碰巧）', () => {
    // 签名令牌本身是 hex，没有非 ASCII —— 这条钉的不是今天的令牌，是**约定**：
    // W3 的找回令牌若改成带前缀的可读串，走的仍是同一个函数。
    // 到那时"按 utf8 编码"必须是两边一致的取值，否则发信侧与校验侧算出不同哈希，
    // 症状还是那句最难归因的"链接已过期"。
    // 'é' 的 NFC 是 U+00E9，NFD 是 U+0065 + U+0301 ⇒ 两个摘要必须不同。
    const nfc = 'café'.normalize('NFC');
    const nfd = 'café'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(hashToken(nfc)).toBe(
      '850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e',
    );
    expect(hashToken(nfd)).toBe(
      '81ef060bcd98adc7824eb5c1ada83c32491b16018e11e79f00ab9d09e04b015a',
    );
  });

  it('一位之差就换掉整个摘要', () => {
    const a = hashToken('token-0001');
    const b = hashToken('token-0002');
    expect(b).toBe(
      '5732eb528dfceded77fff98015ce240405acf14beac96ca87dde58d301d714d3',
    );
    // 公共前缀长度必须是 0。若实现哪天变成"截断/可预测前缀"，这条先红。
    let common = 0;
    while (common < a.length && a[common] === b[common]) common += 1;
    expect(common).toBe(0);
  });
});
