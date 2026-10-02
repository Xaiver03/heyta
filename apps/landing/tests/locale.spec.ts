/**
 * 站点寻址：URL ↔ (页面, 语言)
 * ==============================
 *
 * 🔴 **这是全站寻址的唯一实现**（`src/lib/locale.ts` 只是它的门面），
 * 所以它错的时候，错法是**成片**的：语言切换器、hreflang、sitemap、
 * 导航里的每一条链接都从它算出来。
 *
 * 本文件钉住三件事，每一件都对应一种真实发生过的错：
 *
 *   1. **前缀不能当子串匹配** —— `/energy`、`/enigma` 开头也是 `en`。
 *      用 `startsWith('en')` 写会静默把它们当成英文版：手工点几下几乎
 *      碰不到，一旦有别的路径就发作。
 *   2. 🔴 **切语言必须保持当前页面**。这里曾经返回写死的 `/` 或 `/en/`：
 *      当时整站只有一页，所以那是对的；有了子页面之后，在 `/features` 上点
 *      English 会被丢回**英文首页** —— 页面换了语言**也换了页面**，
 *      而地址栏看起来完全合理（`/en/` 确实存在）。
 *   3. **认不出的路径回落到首页**而不是抛错：访客可能访问了一个旧链接
 *      或拼错的地址，那时应当渲染首页，而不是白屏。
 *
 * ⚠️ 本文件跑在 vitest 里，`import.meta.env.BASE_URL` 是 `/`，
 * 所以"子路径部署"（`/landing/en/`）这一支**没有被真正覆盖** ——
 * 覆盖它需要把 base 注入成参数，而那会为了测试改变生产 API。
 * 这里如实标注，不假装覆盖到了。
 */

import { describe, expect, it } from 'vitest';

import { localeFromPath } from '../src/lib/locale.js';
import {
  localeFromPath as localeFromPaths,
  otherLocaleHrefFor,
  pageFromPath,
  siteHref,
} from '../src/site/paths.js';
import { SITE_PAGES } from '../src/site/pages.js';

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

  it('`src/lib/locale.ts` 的门面导出的是**同一个函数**，不是另一份实现', () => {
    // 🔴 判据是 `toBe`（引用相等），不是 `toBeTypeOf('function')`。
    // 后者只要门面里再写一份实现就仍然绿 —— 而两份实现漂移的表现正是
    // "main.tsx 认一种语言、导航认另一种"。R9 把这条测试从自证改成真判据。
    expect(localeFromPath).toBe(localeFromPaths);
  });
});

describe('pageFromPath', () => {
  it('每个页面自己的路径都能解析回它自己', () => {
    for (const page of SITE_PAGES) {
      expect(pageFromPath(page.path === '/' ? '/' : `${page.path}/`).id).toBe(page.id);
    }
  });

  it('语言前缀不影响页面解析 —— 语言是路径的另一个维度', () => {
    expect(pageFromPath('/en/features/').id).toBe('features');
    expect(pageFromPath('/en').id).toBe('home');
  });

  it('更深但**未注册**的路径落到父级枢纽，而不是弹回首页', () => {
    // `pageFromPath` 认的是整条注册路径（深度优先），所以 `/docs/xxx/` 这种
    // 「枢纽下面一篇不存在的文章」会落在枢纽 `help` 上 —— 人还在文档中心里，
    // 只是那一篇不存在。这比弹回首页好，也比"只取第一段"准：
    // 只取第一段时 `/docs/passphrase/` 会被解析成枢纽，访客点开文章链接看到目录。
    // ⚠️ 这里写的是 `help` 而不是 `docs`：`id` 是注册表里那个**稳定**的名字，
    //    改名只动 `path`（见 `src/site/pages.ts`）。
    expect(pageFromPath('/docs/some-article/').id).toBe('help');
  });

  it('🔴 认不出的路径回落到首页，而不是抛错', () => {
    // 旧链接、拼错的地址、将来被删掉的页面 —— 那时应当渲染首页
    // （nginx 的 SPA 兜底本来也是这样），白屏是最坏的答案。
    expect(pageFromPath('/deleted-page').id).toBe('home');
    expect(pageFromPath('/featuresx').id).toBe('home');
    expect(pageFromPath('/feature').id).toBe('home');
  });
});

describe('otherLocaleHrefFor：切语言**保持当前页面**', () => {
  it('🔴 子页面切语言后仍是同一个页面 —— 不是被丢回首页', () => {
    // 这是本文件存在的主要理由。写死 `/` 或 `/en/` 时这条会红：
    // 那时 `/features` → 英文得到 `/en/`，即"英文首页"。
    const features = SITE_PAGES.find((page) => page.id === 'features');
    expect(features).toBeDefined();
    if (features === undefined) return;

    expect(otherLocaleHrefFor(features, 'zh-CN')).toBe('/en/features/');

    const enFeatures = SITE_PAGES.find((page) => page.id === 'features');
    expect(enFeatures).toBeDefined();
    if (enFeatures === undefined) return;
    expect(otherLocaleHrefFor(enFeatures, 'en')).toBe('/features/');
  });

  it('首页切语言就是 / 与 /en/（与只有一个页面时的行为一致）', () => {
    const home = pageFromPath('/');
    expect(otherLocaleHrefFor(home, 'zh-CN')).toBe('/en/');
    expect(otherLocaleHrefFor(home, 'en')).toBe('/');
  });

  it('每一页都有两个语言版本，且互切两次回到原处', () => {
    for (const page of SITE_PAGES) {
      for (const locale of ['zh-CN', 'en'] as const) {
        const href = otherLocaleHrefFor(page, locale);
        // 切过去之后：语言变了、页面没变。
        expect(localeFromPath(href)).not.toBe(locale);
        expect(pageFromPath(href).id).toBe(page.id);
        // 再切一次回到出发点 —— 切换器不能把人送进死胡同。
        const back = otherLocaleHrefFor(pageFromPath(href), localeFromPath(href));
        expect(back).toBe(siteHref(page, locale));
      }
    }
  });
});
