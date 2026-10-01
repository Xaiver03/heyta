/**
 * `matchLocale`：系统语言标签 → 支持的语言
 * ==========================================
 *
 * 🔴 这个文件存在的理由：**语言认错，用户会看到自己读不懂的界面** ——
 * 症状不是崩溃，而是整个界面变成另一种语言，且没有任何一层报错。
 *
 * 用例从 `apps/mobile/tests/locale.spec.ts` 的 `classifyLocale` 组**整体迁来**
 * （2026-10-01：web 的 `navigator.language` 首启层与移动端设备标签改用同一个
 * 函数，判定只有这一个定义处，用例也只留这一份）。迁入时逐条保留，
 * 并补了「整串精确匹配优先」那一遍的用例。
 */

import { describe, expect, it } from 'vitest';

import { matchLocale } from '../src/match.js';
import { DEFAULT_LOCALE, LOCALES } from '../src/types.js';

describe('matchLocale：中文', () => {
  it('各种写法都归到 `zh-CN`', () => {
    for (const raw of ['zh-CN', 'zh-Hans-CN', 'zh_CN', 'zh', 'ZH', 'zh-Hant-TW']) {
      expect(matchLocale(raw), raw).toBe('zh-CN');
    }
  });
});

describe('matchLocale：英文', () => {
  it('各种写法都归到 `en`', () => {
    for (const raw of ['en-US', 'en', 'EN_GB', 'en-AU', 'EN']) {
      expect(matchLocale(raw), raw).toBe('en');
    }
  });
});

describe('matchLocale：兜底', () => {
  it('🔴 不认识的、空的、没有的一律回落到默认语言（产品明确：兜底是中文）', () => {
    // `undefined` 是"系统没告诉我"，不是"用户选了法语" —— 两者都该走默认。
    for (const raw of ['fr-FR', 'ja-JP', 'de', '', '   ', undefined, null]) {
      expect(matchLocale(raw), String(raw)).toBe(DEFAULT_LOCALE);
    }
  });

  it('前缀相同的语言不会被误判（`en` 不是 `eng` 也不是 `et`）', () => {
    // 这条防的是"用 `startsWith('en')` 做判定"：`'et-EE'`（爱沙尼亚语）
    // 以 `et` 开头但与 `en` 无关，误判会让界面变成英文而不是默认语言。
    expect(matchLocale('et-EE')).toBe(DEFAULT_LOCALE);
    expect(matchLocale('zhu')).toBe(DEFAULT_LOCALE);
  });
});

describe('matchLocale：列表与子标签', () => {
  it('🔴 列表形态取**第一个可识别的**候选，不是第一段', () => {
    // 只切第一段的话 `fr-FR,en-US` 会被错判成默认语言 ——
    // 而那正是用户明明把英文列在了里面的场合。
    expect(matchLocale('zh-Hans-CN,en-US')).toBe('zh-CN');
    expect(matchLocale('fr-FR,en-US')).toBe('en');
    expect(matchLocale('fr-FR,zh-CN')).toBe('zh-CN');
    // 大小写与空格同样不敏感。
    expect(matchLocale('FR-fr, ZH-hant')).toBe('zh-CN');
    // 空候选（前后逗号）不该让整串变成"认不出来"。
    expect(matchLocale(' , en-GB ,')).toBe('en');
  });

  it('只认主语言子标签：地区与文字脚本不影响判定', () => {
    expect(matchLocale('zh-Hant-HK')).toBe('zh-CN');
    expect(matchLocale('en-Latn-US')).toBe('en');
  });

  it('整串精确匹配优先于主语言前缀', () => {
    // 当前 LOCALES = ['zh-CN', 'en']，没有同主语言的兄弟项，
    // 这条钉的是「先精确后前缀」的遍历顺序本身 —— 将来加了 en-GB 之类，
    // `en-GB` 设备应精确命中而不是被前缀吃掉。
    expect(matchLocale('zh-CN')).toBe('zh-CN');
    expect(matchLocale('EN')).toBe('en');
    // 大小写不敏感的精确匹配：
    expect(matchLocale('ZH-CN')).toBe('zh-CN');
  });
});

describe('matchLocale：返回值域', () => {
  it('永远返回 LOCALES 之一（不发明不支持的语言）', () => {
    for (const raw of ['zh-CN', 'en', 'fr', '', null, undefined, 'xx-YY', 'zh-Hant']) {
      expect(LOCALES).toContain(matchLocale(raw));
    }
  });
});
