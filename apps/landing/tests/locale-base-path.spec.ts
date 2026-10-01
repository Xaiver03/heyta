/**
 * 子路径部署下的语言寻址（把 §七 第 2 条从"未验证"变成判据）。
 *
 * `apps/landing/src/site/paths.ts` 的 `BASE` 取自 Vite 的 `import.meta.env.BASE_URL`，
 * 而 `localeFromPath` 与 `siteHref` 都过它一道。文件头注释写着理由：
 * "写死会让子路径部署时所有互链全部 404"。**这句话此前没有任何测试撑着。**
 *
 * 🔴 为什么要 `vi.resetModules()` + 动态 import：`BASE` 是**模块顶层常量**，
 * import 那一刻就被定住了。先 import 再 stubEnv 会得到一个
 * "看起来在测子路径、其实测的是根路径"的假判据 —— 那比没有判据更糟。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SITE_PAGES } from '../src/site/pages.js';

type PathsModule = typeof import('../src/site/paths.js');

/** 首页（`path === '/'`）—— 它的两版地址是这条判据的锚。 */
const home = SITE_PAGES.find((p) => p.path === '/');

async function loadWithBase(base: string): Promise<PathsModule> {
  vi.resetModules();
  vi.stubEnv('BASE_URL', base);
  return await import('../src/site/paths.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('非 / 的 base 下，语言仍由 URL 决定', () => {
  it('前提：首页在注册表里，且只有一页是 /', () => {
    expect(home).toBeDefined();
    expect(SITE_PAGES.filter((p) => p.path === '/')).toHaveLength(1);
  });

  it('子路径 + /en/ 前缀 ⇒ en；子路径 + 根 ⇒ zh-CN', async () => {
    const { localeFromPath } = await loadWithBase('/landing/');
    expect(localeFromPath('/landing/en/')).toBe('en');
    expect(localeFromPath('/landing/en/features/')).toBe('en');
    expect(localeFromPath('/landing/')).toBe('zh-CN');
    expect(localeFromPath('/landing/features/')).toBe('zh-CN');
  });

  it('英文段必须是**完整一段**（`/landing/enx/` 不算 en）', async () => {
    const { localeFromPath } = await loadWithBase('/landing/');
    expect(localeFromPath('/landing/enx/')).toBe('zh-CN');
  });

  it('生成侧与解析侧在子路径下自洽：siteHref 产出的地址，localeFromPath 认得回来', async () => {
    const { localeFromPath, siteHref } = await loadWithBase('/landing/');
    const en = siteHref(home!, 'en');
    const zh = siteHref(home!, 'zh-CN');
    expect(en).toBe('/landing/en/');
    expect(zh).toBe('/landing/');
    expect(localeFromPath(en)).toBe('en');
    expect(localeFromPath(zh)).toBe('zh-CN');
  });

  it('对照组：根 base 下同一对函数给出**没有 /landing 前缀**的地址（两种部署都成立）', async () => {
    const { localeFromPath, siteHref } = await loadWithBase('/');
    expect(siteHref(home!, 'en')).toBe('/en/');
    expect(siteHref(home!, 'zh-CN')).toBe('/');
    expect(localeFromPath('/en/features/')).toBe('en');
    expect(localeFromPath('/features/')).toBe('zh-CN');
  });
});
