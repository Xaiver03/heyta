/**
 * 语言路由
 * ========
 *
 * 语言**由路径决定**，所以这段判断是整站双语的唯一开关：它错了，
 * 英文用户会看到中文，或者中文用户分享出去的链接在别人那里变成英文。
 *
 * 最值得钉住的是**前缀不能当子串匹配**：`/energy`、`/enigma` 这类路径
 * 开头也是 `en`。用 `startsWith('en')` 写会静默把它们当成英文版 ——
 * 这种 bug 在手工点几下时几乎不会碰到，但一旦有别的路径就会发作。
 *
 * ⚠️ 本文件跑在 vitest 里，`import.meta.env.BASE_URL` 是 `/`，
 * 所以"子路径部署"（`/landing/en/`）这一支**没有被真正覆盖** ——
 * 覆盖它需要把 base 注入成参数，而那会为了测试改变生产 API。
 * 这里如实标注，不假装覆盖到了。
 */

import { describe, expect, it } from 'vitest';

import { localeFromPath, otherLocaleHref } from '../src/lib/locale.js';

describe('localeFromPath', () => {
  it('根路径是中文', () => {
    expect(localeFromPath('/')).toBe('zh-CN');
  });

  it('/en/ 与 /en 都是英文', () => {
    expect(localeFromPath('/en/')).toBe('en');
    expect(localeFromPath('/en')).toBe('en');
  });

  it('/en/ 下的更深路径也是英文', () => {
    expect(localeFromPath('/en/pricing/')).toBe('en');
  });

  it('🔴 前缀不能当子串匹配：/energy 不是英文', () => {
    // 用 startsWith('en') 写会在这里静默出错。
    expect(localeFromPath('/energy')).toBe('zh-CN');
    expect(localeFromPath('/enigma/')).toBe('zh-CN');
    expect(localeFromPath('/engineering')).toBe('zh-CN');
  });

  it('其它路径一律回落到中文', () => {
    expect(localeFromPath('/anything')).toBe('zh-CN');
    expect(localeFromPath('/zh-CN/')).toBe('zh-CN');
  });
});

describe('otherLocaleHref', () => {
  it('中文版切到 /en/，英文版切回 /', () => {
    expect(otherLocaleHref('zh-CN')).toBe('/en/');
    expect(otherLocaleHref('en')).toBe('/');
  });

  it('互切两次回到原处 —— 切换器不能把人送进死胡同', () => {
    expect(localeFromPath(otherLocaleHref('zh-CN'))).toBe('en');
    expect(localeFromPath(otherLocaleHref('en'))).toBe('zh-CN');
  });
});
