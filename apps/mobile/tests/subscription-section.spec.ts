/**
 * 移动端「订阅」独立页的**形状**判据（2026-10-24）
 * =================================================
 *
 * 产品负责人原话：「需要卖的，而且需要有**单独的订阅界面**。移动端和桌面端都要有。」
 * Web 侧已有判据（`apps/web/tests/renew-panel.spec.tsx` + `e2e/tests/renew-panel.spec.ts`
 * 真浏览器）；移动壳没有组件级测试载体（`apps/mobile/tests/*` 全是源码正则或纯函数），
 * 所以这里钉**结构**，行为仍由 `packages/app-host/tests/checkout.spec.ts` 负责 ——
 * 分工是刻意的：**同一个判断只在一个地方有牙**。
 *
 * 五条断言，每条都对着一个**真的会发生**的回退：
 *
 * | 断言 | 回退长什么样 |
 * |---|---|
 * | ① 订阅页只编排、不重写收银台 | 有人图省事在这一屏里写 `fetch('/api/billing/checkout')` ⇒ 第二套收银台 |
 * | ② 两端同源：标价取自落地页那几条被钉住的词条 | 有人把 `¥5 / 月` 抄进 TSX ⇒ 价格出现第二份会漂的副本 |
 * | ③「我的」只有**一个**订阅入口 | 有人把 `EntitlementSection` 再塞回本屏 ⇒ 同一件事两个入口，其中一个先过期 |
 * | ④ 设置目录里真的有这一节 | 加了 `SubscriptionSection.tsx` 却没接进 `SettingsScreen` ⇒ 写了但到不了 |
 * | ⑤ 新词条两种语言都在，且英文里没有中文 | 只加 zh ⇒ 英文界面上漏中文（`check:ui-language` 不查词条值） |
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate, type MessageKey } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

/** 去掉注释再断言源码 —— 注释里写"这里不许 fetch"是在**描述**纪律，不该被判红。 */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/[^\n]*/gu, '$1');

const CJK = /[\u4e00-\u9fff]/u;

describe('移动端「订阅」独立页', () => {
  const subscription = src('../src/screens/SubscriptionSection.tsx');
  const renew = src('../src/screens/RenewSection.tsx');
  const settings = src('../src/screens/SettingsScreen.tsx');
  const profile = src('../src/screens/ProfileScreen.tsx');

  it('① 订阅页只编排：状态与收银台都来自现成组件，自己不请求', () => {
    expect(subscription).toContain("import { EntitlementSection } from './EntitlementSection'");
    expect(subscription).toContain("import { RenewSection } from './RenewSection'");
    expect(subscription).toContain('<EntitlementSection />');
    expect(subscription).toContain('<RenewSection />');
    // 🔴 这一屏里**不许**出现任何网络调用或收银台接线：那两件事各有一份实现。
    const body = code(subscription);
    expect(body).not.toContain('fetch(');
    expect(body).not.toContain('startCheckout');
    expect(body).not.toContain('fetchHostedEntitlementReading');
  });

  it('② 标价与要点同源：两条价格词条 + 三条 feature 词条，且不写金额字面量', () => {
    expect(renew).toContain("price: 'landing.pricing.hosted.priceCny'");
    expect(renew).toContain("price: 'landing.pricing.hostedAi.priceCny'");
    expect(renew).toContain("'landing.pricing.hosted.feature1'");
    expect(renew).toContain("'landing.pricing.hostedAi.feature3'");
    // 收银台里仍然只有**一处**金额来源：服务端报价。金额字面量一个都不许有。
    expect(code(renew)).not.toMatch(/[¥$]\s*\d/u);
    // 移动壳的订阅页也不许借 web 的词条（两端的词条账各自独立，`check:ui-language` 按前缀查）。
    expect(code(subscription)).not.toMatch(/t\(\s*'web\./u);
  });

  it('③「我的」只留一个订阅入口，且不再内联挂那两块', () => {
    const body = code(profile);
    expect(body).toContain("testID: 'profile-entry-subscription'");
    expect(body).toContain("setSettingsSection('subscription')");
    // 回退形态：又把两块直接摊回本屏 ⇒ 入口与内容同时存在。
    expect(body).not.toContain('<EntitlementSection />');
    expect(body).not.toContain('<RenewSection />');
  });

  it('④ 设置目录里真的有这一节（写了却到不了，等于没写）', () => {
    expect(settings).toContain("| 'subscription'");
    expect(settings).toContain("subscription: t('mobile.settings.section.subscription')");
    expect(settings).toContain("case 'subscription':");
    expect(settings).toContain('<SubscriptionSection />');
    expect(settings).toContain("import { SubscriptionSection } from './SubscriptionSection'");
  });

  it('⑤ 新词条两种语言都在，英文里没有中文', () => {
    const keys = [
      'mobile.settings.section.subscription',
      'mobile.subscription.lead',
      'mobile.subscription.plans.hint',
      'mobile.subscription.footnote',
      'mobile.subscription.renew.subscribe',
      'mobile.subscription.entry.hint',
    ] as const satisfies readonly MessageKey[];
    for (const key of keys) {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      // 英文值里漏中文是"只加了一半"的典型形状；两种语言同形（如专有名词）除外。
      expect(CJK.test(en), `en 里出现了中文：${en}`).toBe(false);
    }
  });
});
