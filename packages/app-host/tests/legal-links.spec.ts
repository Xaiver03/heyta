/**
 * 条款链接的分流（链 2）
 * ======================
 *
 * 这条链接的全部风险都集中在**一个判断**上：用户连的是不是官方托管实例。
 * 判错的两种后果不对称，所以两边都要钉：
 *
 *   - 把官方实例判成第三方 ⇒ 官方域上的 `<baseUrl>/privacy.html`，而生产没配
 *     `PRIVACY_*` ⇒ **点开 404**，用户同意一份读不到的政策（PIPL 第 17 条的"公开"没做到）。
 *   - 把第三方判成官方 ⇒ 在别人实例的勾选框旁边显示 **heyta 署名的**政策，
 *     而隐私政策自己写着"自建部署时承担处理者义务的是你"⇒ 替别人作出没有依据的承诺。
 *
 * ⚠️ 这里**不发任何请求**，也不该发：同意之前不许有网络活动（计划 G-12）。
 * 所以判据只能是纯字符串的输入输出 —— 每种"地址写得不太标准"的形状都要各来一条，
 * 因为分流靠的就是提取主机名，而那是最容易在一处对、另一处错的地方。
 */

import { describe, expect, it } from 'vitest';

import {
  LEGAL_SITE_PATHS,
  OFFICIAL_SITE_ORIGIN,
  OPERATOR_LEGAL_PATHS,
  resolveLegalLinks,
} from '../src/legal-links.js';

const OFFICIAL_TERMS = `${OFFICIAL_SITE_ORIGIN}${LEGAL_SITE_PATHS.terms}`;

describe('resolveLegalLinks：官方托管实例', () => {
  it('连官方域时指向落地页 `/legal/*`', () => {
    const links = resolveLegalLinks('https://heyta.waytofuture.cn');
    expect(links).not.toBeNull();
    expect(links!.terms).toBe(OFFICIAL_TERMS);
    expect(links!.privacy).toBe(`${OFFICIAL_SITE_ORIGIN}${LEGAL_SITE_PATHS.privacy}`);
  });

  it('地址带末尾斜杠 / 路径 / 查询串 / 端口 / 大写时，仍然认得出官方（**判的是主机名**）', () => {
    for (const written of [
      'https://heyta.waytofuture.cn/',
      'https://heyta.waytofuture.cn/api',
      'https://heyta.waytofuture.cn/api/',
      'https://heyta.waytofuture.cn/?lang=en',
      'https://heyta.waytofuture.cn:443',
      'https://Heyta.WaytoFuture.CN',
      '  https://heyta.waytofuture.cn  ',
    ]) {
      expect(resolveLegalLinks(written)?.terms, `「${written}」应判为官方`).toBe(OFFICIAL_TERMS);
    }
  });

  it('官方域名上写 userinfo 也算官方（主机名是最后一个 @ 之后那段）', () => {
    expect(resolveLegalLinks('https://user:pw@heyta.waytofuture.cn')?.terms).toBe(OFFICIAL_TERMS);
  });

  it('英文界面落到 `/en/legal/*`，中文不带前缀', () => {
    expect(resolveLegalLinks('https://heyta.waytofuture.cn', 'en')!.terms).toBe(
      'https://heyta.waytofuture.cn/en/legal/terms/',
    );
    expect(resolveLegalLinks('https://heyta.waytofuture.cn', 'zh-CN')!.terms).toBe(OFFICIAL_TERMS);
    expect(resolveLegalLinks('https://heyta.waytofuture.cn')!.terms).toBe(OFFICIAL_TERMS);
  });
});

describe('resolveLegalLinks：别人的服务端（自建 / 第三方）', () => {
  it('非官方 host 一律拼到该服务端自己的 `/terms.html` 与 `/privacy.html`', () => {
    const links = resolveLegalLinks('https://sync.example.com')!;
    expect(links.terms).toBe('https://sync.example.com/terms.html');
    expect(links.privacy).toBe('https://sync.example.com/privacy.html');
  });

  it('末尾斜杠不产生双斜杠（拼接复用 `joinEndpointUrl`）', () => {
    expect(resolveLegalLinks('https://sync.example.com///')!.terms).toBe(
      'https://sync.example.com/terms.html',
    );
  });

  it('🔴 官方域名的**兄弟**一律不算官方（前缀匹配是这里最像对的错）', () => {
    for (const lookalike of [
      'https://heyta.waytofuture.cn.evil.net',
      'https://not-heyta.waytofuture.cn',
      'https://heyta.waytofuture.co',
      'https://waytofuture.cn',
      'http://heyta.waytofuture.cn.localhost:3000',
    ]) {
      const links = resolveLegalLinks(lookalike)!;
      expect(links.terms, `「${lookalike}」不该算官方`).not.toBe(OFFICIAL_TERMS);
      expect(links.terms.startsWith(lookalike.replace(/\/+$/, '')), `「${lookalike}」应落在它自己那台`).toBe(
        true,
      );
    }
  });

  it('局域网 / 明文地址按明文补齐 scheme，与传输安全判定的口径一致', () => {
    const links = resolveLegalLinks('127.0.0.1:3000')!;
    expect(links.privacy).toBe('http://127.0.0.1:3000/privacy.html');
  });

  it('IPv6 字面量取得到主机名，不会被端口截断', () => {
    expect(resolveLegalLinks('http://[::1]:3000')!.privacy).toBe('http://[::1]:3000/privacy.html');
  });
});

describe('resolveLegalLinks：没有服务端就没有"该服务端"', () => {
  it('空串与全空白返回 `null`（界面因此**不渲染**链接，而不是渲染一条坏链接）', () => {
    expect(resolveLegalLinks('')).toBeNull();
    expect(resolveLegalLinks('   ')).toBeNull();
  });
});
