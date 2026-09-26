/**
 * `PUBLIC_URL` 的明文 HTTP 门禁（ADR-0012 §4.2）
 *
 * 这次改动把生产模式的禁令**从"一律禁止"收窄为"公网禁止"**，好让局域网自建
 * （`http://192.168.1.5:3000`）在生产模式下也能直接跑起来 —— 它的明文不出网线，
 * 而 iOS 侧本来就放行（ADR-0007 §6.1）。
 *
 * 🔴 **本文件里最重要的是 `192.168.1.5.evil.com` 那几条负例。**
 *
 *    收窄门禁的方向是"多放行"，所以**写错的后果是静默放行**，不是报错：
 *    把 `isPrivateNetworkHost` 实现成 `host.startsWith('192.168.')` 时，
 *    `192.168.1.5.evil.com` 会被判成私网、明文被放行，而**其余所有测试照样全绿**。
 *    那是一条公网域名 —— 正是这道门要拦的东西。
 *
 *    所以"私网放行"和"前缀相同的公网域名仍被拒"必须**成对**存在；
 *    只有前者的测试等于没测。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isPrivateNetworkHost, loadConfigFromEnv } from '../src/config';

describe('isPrivateNetworkHost', () => {
  describe('私网 / 回环字面量 → true', () => {
    it.each([
      ['回环 127/8', '127.0.0.1'],
      ['私有 10/8', '10.0.0.5'],
      ['私有 192.168/16', '192.168.1.5'],
      ['私有 172.16/12 下界', '172.16.0.1'],
      ['私有 172.16/12 上界', '172.31.255.254'],
      ['链路本地 169.254/16', '169.254.1.1'],
      ['IPv6 回环', '::1'],
      ['IPv6 唯一本地 fd00::/8', 'fd00::1'],
      ['IPv6 唯一本地 fc00::/8', 'fc00::1'],
      ['localhost 这个名字', 'localhost'],
    ])('%s：%s', (_label, host) => {
      expect(isPrivateNetworkHost(host)).toBe(true);
    });
  });

  describe('🔴 公网（含"前缀相同的域名"）→ false', () => {
    it.each([
      ['公网 IP 字面量', '124.223.13.226'],
      ['普通域名', 'example.com'],
      // 下面这两条是本次改动的**承重负例**：任何 startsWith 写法都会在这里挂掉。
      ['前缀是 192.168. 的公网域名', '192.168.1.5.evil.com'],
      ['前缀是 10. 的公网域名', '10.0.0.5.evil.com'],
      // 172.16/12 的边界外——差一位就不是私网
      ['172.32.0.1（在 172.16/12 之外）', '172.32.0.1'],
      ['172.15.0.1（在 172.16/12 之外）', '172.15.0.1'],
      ['192.169.1.1（不是 192.168）', '192.169.1.1'],
    ])('%s：%s', (_label, host) => {
      expect(isPrivateNetworkHost(host)).toBe(false);
    });
  });
});

describe('loadConfigFromEnv 的 PUBLIC_URL 门禁（NODE_ENV=production）', () => {
  const TOUCHED = ['NODE_ENV', 'PUBLIC_URL'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of TOUCHED) saved[k] = process.env[k];
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('局域网明文 → 放行（这是本次改动的目的）', () => {
    process.env.PUBLIC_URL = 'http://192.168.1.5:3000';
    expect(() => loadConfigFromEnv()).not.toThrow();
    expect(loadConfigFromEnv().publicUrl).toBe('http://192.168.1.5:3000');
  });

  it('回环明文 → 放行', () => {
    process.env.PUBLIC_URL = 'http://127.0.0.1:1900';
    expect(() => loadConfigFromEnv()).not.toThrow();
  });

  it('公网 IP 明文 → 仍然拒绝', () => {
    process.env.PUBLIC_URL = 'http://124.223.13.226';
    expect(() => loadConfigFromEnv()).toThrow(/must use HTTPS in production/);
  });

  it('普通域名明文 → 仍然拒绝', () => {
    process.env.PUBLIC_URL = 'http://sync.example.com';
    expect(() => loadConfigFromEnv()).toThrow(/must use HTTPS in production/);
  });

  it('🔴 前缀是私网的公网域名明文 → 仍然拒绝（startsWith 写法会在这里挂）', () => {
    process.env.PUBLIC_URL = 'http://192.168.1.5.evil.com';
    expect(() => loadConfigFromEnv()).toThrow(/must use HTTPS in production/);
  });

  it('https 一律放行（含公网）', () => {
    process.env.PUBLIC_URL = 'https://sync.example.com';
    expect(() => loadConfigFromEnv()).not.toThrow();
  });
});
