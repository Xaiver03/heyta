/**
 * 服务器地址传输安全等级 —— 判定表
 * ==================================
 *
 * 这里的每条用例都对应一个**真实会有人这么填**的地址。
 * 重点不在"正则写对了"，而在边界：
 * `172.16/12` 的**上界是 31 不是 255**、CGNAT 的 `100.64/10` 上界是 `127`、
 * `10.0.2.2`（Android 模拟器指向宿主机的别名）必须落在私有段里。
 * 这些边界错一格，界面就会对一个公网明文地址保持沉默，或者对一个局域网地址乱报警告。
 */

import { describe, expect, it } from 'vitest';

import { classifyTransportSecurity, isPrivateHost } from '../src/server-url.js';

describe('服务器地址 — 传输安全等级', () => {
  it('HTTPS 一律算安全，不管主机是哪里', () => {
    expect(classifyTransportSecurity('https://example.com')).toBe('secure');
    expect(classifyTransportSecurity('https://10.0.2.2:3000')).toBe('secure');
    expect(classifyTransportSecurity('HTTPS://Example.COM')).toBe('secure');
  });

  it('🔴 模拟器地址 http://10.0.2.2:3000 是「本机明文」，不是公网明文', () => {
    // 这是默认值，也是每次真机/模拟器验证都要填的地址。
    // 判成 plaintext 会让默认配置一打开就报高危警告 —— 警报疲劳。
    expect(classifyTransportSecurity('http://10.0.2.2:3000')).toBe('plaintext-local');
  });

  it('回环与私有网段都算本机明文', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://127.1.2.3:3000',
      'http://192.168.1.10:3000',
      'http://172.16.0.1:3000',
      'http://172.31.255.254:3000', // 172.16/12 的上界
      'http://169.254.1.1',
      'http://100.64.0.1', // CGNAT 下界
      'http://100.127.255.255', // CGNAT 上界
      'http://nas.local:3000', // 家庭 NAS 的典型名字
      'http://[::1]:3000',
      'http://[fd00::1]:3000',
    ]) {
      expect(classifyTransportSecurity(url), url).toBe('plaintext-local');
    }
  });

  it('🔴 公网明文必须被认出来（这些是真的危险）', () => {
    for (const url of [
      'http://example.com',
      'http://203.0.113.5:3000',
      'http://8.8.8.8',
      'http://172.32.0.1', // 刚好在 172.16/12 之外
      'http://100.128.0.1', // 刚好在 CGNAT 之外
      'http://11.0.0.1', // 刚好在 10/8 之外
      'http://192.169.1.1', // 刚好在 192.168/16 之外
    ]) {
      expect(classifyTransportSecurity(url), url).toBe('plaintext');
    }
  });

  it('bearer 里的 userinfo 不参与主机判定', () => {
    // http://user:pass@192.168.1.5:3000 —— 取 @ 之后的部分
    expect(classifyTransportSecurity('http://user:pass@192.168.1.5:3000')).toBe('plaintext-local');
    expect(classifyTransportSecurity('http://user:pass@example.com:3000')).toBe('plaintext');
  });

  it('路径与查询不影响判定', () => {
    expect(classifyTransportSecurity('http://10.0.2.2:3000/api/sync?x=1')).toBe('plaintext-local');
    expect(classifyTransportSecurity('http://example.com/api/sync')).toBe('plaintext');
  });

  it('🔴 写错/没写 scheme 时倾向报警，而不是沉默', () => {
    // 解析不出来时返回 plaintext 是刻意的：地址填错时用户需要看到提示，
    // 而不是因为"解析失败所以当它安全"而被静默放过。
    expect(classifyTransportSecurity('')).toBe('plaintext');
    expect(classifyTransportSecurity('example.com:3000')).toBe('plaintext');
    expect(classifyTransportSecurity('ftp://example.com')).toBe('plaintext');
  });

  it('isPrivateHost 的边界', () => {
    expect(isPrivateHost('10.0.0.1')).toBe(true);
    expect(isPrivateHost('9.255.255.255')).toBe(false);
    expect(isPrivateHost('172.15.0.1')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('192.167.1.1')).toBe(false);
    expect(isPrivateHost('192.168.0.1')).toBe(true);
    expect(isPrivateHost('')).toBe(false);
    expect(isPrivateHost('  ')).toBe(false);
    expect(isPrivateHost('LOCALHOST')).toBe(true);
  });
});
