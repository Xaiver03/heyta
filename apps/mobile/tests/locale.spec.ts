/**
 * 设备语言识别测试
 * ==================
 *
 * 🔴 这个文件存在的理由：**语言认错，用户会看到自己读不懂的界面。**
 *
 * 移动端没有 URL 可读（落地页靠 `/` 与 `/en/` 区分），只能问系统。
 * 两个平台给的形状还不一样：
 *
 *   - iOS `SettingsManager.settings.AppleLocale` → `zh-Hans-CN`；
 *   - iOS `AppleLanguages[0]` → `zh-Hans-CN`（列表形态）；
 *   - Android `I18nManager.localeIdentifier` → `zh_CN`。
 *
 * 所以"认哪些语言、怎么切子标签"必须有测试兜住 —— 认错的症状不是崩溃，
 * 而是整个界面变成用户看不懂的语言。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '@heyta/i18n';

import { classifyLocale, resolveDeviceLocale } from '../src/i18n/locale';

describe('classifyLocale', () => {
  it('中文的各种写法都归到 `zh-CN`', () => {
    for (const raw of ['zh-CN', 'zh-Hans-CN', 'zh_CN', 'zh', 'ZH', 'zh-Hant-TW']) {
      expect(classifyLocale(raw), raw).toBe('zh-CN');
    }
  });

  it('英文的各种写法都归到 `en`', () => {
    for (const raw of ['en-US', 'en', 'EN_GB', 'en-AU', 'EN']) {
      expect(classifyLocale(raw), raw).toBe('en');
    }
  });

  it('🔴 不认识的、空的、没有的一律回落到默认语言', () => {
    // `undefined` 是"系统没告诉我"，不是"用户选了法语" —— 两者都该走默认。
    for (const raw of ['fr-FR', 'ja-JP', 'de', '', '   ', undefined, null]) {
      expect(classifyLocale(raw), String(raw)).toBe(DEFAULT_LOCALE);
    }
  });

  it('🔴 列表形态取**第一个可识别的**候选，不是第一段', () => {
    // 只切第一段的话 `fr-FR,en-US` 会被错判成默认语言 ——
    // 而那正是用户明明把英文列在了里面的场合。
    expect(classifyLocale('zh-Hans-CN,en-US')).toBe('zh-CN');
    expect(classifyLocale('fr-FR,en-US')).toBe('en');
    expect(classifyLocale('fr-FR,zh-CN')).toBe('zh-CN');
    // 大小写与空格同样不敏感。
    expect(classifyLocale('FR-fr, ZH-hant')).toBe('zh-CN');
    // 空候选（前后逗号）不该让整串变成"认不出来"。
    expect(classifyLocale(' , en-GB ,')).toBe('en');
  });

  it('只认主语言子标签：地区与文字脚本不影响判定', () => {
    // `zh-Hans-CN` / `zh_CN` 的主语言都是 `zh`；把整串拿去比较会漏掉它们。
    expect(classifyLocale('zh-Hant-HK')).toBe('zh-CN');
    expect(classifyLocale('en-Latn-US')).toBe('en');
  });

  it('前缀相同的语言不会被误判（`en` 不是 `eng` 也不是 `et`）', () => {
    // 这条防的是"用 `startsWith('en')` 做判定"：`'et-EE'`（爱沙尼亚语）
    // 以 `et` 开头但与 `en` 无关，误判会让界面变成英文而不是默认语言。
    expect(classifyLocale('et-EE')).toBe(DEFAULT_LOCALE);
    expect(classifyLocale('zhu')).toBe(DEFAULT_LOCALE);
  });

  it('返回值永远是我们支持的两种语言之一', () => {
    for (const raw of ['zh-CN', 'en', 'fr', '', null, undefined, 'xx-YY']) {
      expect(['zh-CN', 'en']).toContain(classifyLocale(raw));
    }
  });
});

describe('resolveDeviceLocale', () => {
  it('🔴 在没有 react-native 的环境里不抛异常，回落到默认语言', () => {
    // 本套件跑在 node 里，`require('react-native')` 不可用（或加载失败）——
    // `resolveDeviceLocale` 必须把"读不到系统语言"当成正常情况，
    // 否则 `App.tsx` 的初始化会直接崩在启动路径上。
    expect(() => resolveDeviceLocale()).not.toThrow();
    expect(resolveDeviceLocale()).toBe(DEFAULT_LOCALE);
  });
});
