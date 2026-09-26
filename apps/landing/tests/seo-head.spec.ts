/**
 * 落地页两个语言入口的「头部契约」
 * ==================================
 *
 * `index.html` 与 `en/index.html` 是一对**必须互指**的入口。`/en/` 存在的全部理由是
 * 让英文版有独立地址可被收录，而这件事**只有在 head 写对时才成立**：
 *
 *   - 少了 canonical，两个地址会被当成重复内容互相抢排名；
 *   - hreflang 不成对（只有一边声明、或两边声明不一致），搜索引擎会忽略整组；
 *   - `x-default` 缺失时，语言不匹配的访客没有兜底版本；
 *   - 把中文入口**复制**成英文入口却忘了改 title/description —— 英文页顶着中文标题，
 *     这在人工点开时一眼能看出来，但**爬虫看到的就是中文**，而恰恰是爬虫在决定收录。
 *
 * 这些没有一处能被类型系统拦住（全是 HTML 里的字符串），所以在这里钉住。
 *
 * ⚠️ 与 `theme-contract.spec.ts` 的分工：那个只管主题引导脚本、而且**只读中文入口**。
 * 本文件补上它漏掉的那一侧（英文入口的引导脚本），因为"只改了主入口"正是
 * 最容易发生的一类漂移。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const ORIGIN = 'https://heyta.finlaw.cloud';

/** 中文入口是主站，也是 `x-default` 的落点。 */
const ZN_PATH = '/';
const EN_PATH = '/en/';

const CJK = /[\u4e00-\u9fff]/;

interface Head {
  readonly lang: string;
  readonly canonical: string;
  /** hreflang → href，按 hreflang 去重（同一语言声明两次是错误，见下面的断言）。 */
  readonly alternates: Map<string, string>;
  readonly title: string;
  readonly description: string;
}

/**
 * 把 `<head>` 里的空白压平再匹配。
 *
 * 不这么做的话，源码里跨行写的 `<meta\n name="description"\n content="…" />`
 * 会匹配不到 —— 而"匹配不到"的表现是**断言被跳过**（拿到空串后 expect 空串），
 * 不是报错。压平是为了让下面每条断言都真的作用在内容上。
 */
function readHead(relativePath: string): Head {
  const html = readFileSync(resolve(APP, relativePath), 'utf8');
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) throw new Error(`${relativePath} 里没有 </head>`);
  const head = html.slice(0, headEnd).replace(/\s+/g, ' ');

  const lang = /<html lang="([^"]*)"/.exec(head)?.[1];
  if (lang === undefined) throw new Error(`${relativePath} 的 <html> 没有 lang`);

  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(head)?.[1];
  if (canonical === undefined) {
    throw new Error(`${relativePath} 没有 canonical —— 两个语言入口会互相抢排名`);
  }

  const alternates = new Map<string, string>();
  const alternatesRe = /<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = alternatesRe.exec(head)) !== null) {
    const [, hreflang, href] = m;
    if (hreflang === undefined || href === undefined) continue;
    const existing = alternates.get(hreflang);
    if (existing !== undefined) {
      throw new Error(`${relativePath} 把 hreflang="${hreflang}" 声明了两次（${existing} / ${href}）`);
    }
    alternates.set(hreflang, href);
  }

  const title = /<title>([^<]*)<\/title>/.exec(head)?.[1];
  if (title === undefined) throw new Error(`${relativePath} 没有 <title>`);

  const description = /<meta name="description" content="([^"]*)"/.exec(head)?.[1];
  if (description === undefined) throw new Error(`${relativePath} 没有 meta description`);

  return { lang, canonical, alternates, title, description };
}

const zh = readHead('index.html');
const en = readHead('en/index.html');

describe('两个语言入口的 <html lang>', () => {
  it('中文入口是 zh-CN，英文入口是 en —— 这决定屏幕阅读器与搜索引擎怎么读整页', () => {
    expect(zh.lang).toBe('zh-CN');
    expect(en.lang).toBe('en');
  });
});

describe('canonical 必须指向自己', () => {
  it('中文入口指 /', () => {
    expect(zh.canonical).toBe(`${ORIGIN}${ZN_PATH}`);
  });

  it('英文入口指 /en/ —— 指错了等于自己声明"我不是正版"', () => {
    expect(en.canonical).toBe(`${ORIGIN}${EN_PATH}`);
  });
});

describe('hreflang 必须成对且互指', () => {
  it('两边声明的 hreflang 集合逐条相同', () => {
    // 只比 key 集合：一组 hreflang 里只要有一条不一致，搜索引擎会**整组忽略**，
    // 而忽略是静默的 —— 页面照常打开，只是不再算多语言版本。
    expect([...en.alternates.keys()].sort()).toEqual([...zh.alternates.keys()].sort());
  });

  it('三种语言声明齐全：zh-CN / en / x-default', () => {
    expect([...zh.alternates.keys()].sort()).toEqual(['en', 'x-default', 'zh-CN']);
  });

  it('每个 hreflang 的落点在两边**逐条一致**（不能一边指 / 一边指 /en/）', () => {
    for (const [hreflang, href] of zh.alternates) {
      expect(en.alternates.get(hreflang), `hreflang=${hreflang} 两边不一致`).toBe(href);
    }
  });

  it('zh-CN 指中文入口、en 指英文入口', () => {
    expect(zh.alternates.get('zh-CN')).toBe(`${ORIGIN}${ZN_PATH}`);
    expect(zh.alternates.get('en')).toBe(`${ORIGIN}${EN_PATH}`);
  });

  it('x-default 指主站（语言不匹配时的兜底）', () => {
    expect(zh.alternates.get('x-default')).toBe(`${ORIGIN}${ZN_PATH}`);
  });

  it('每个语言版本都把自己**也**列进 hreflang —— 自指是规范要求，不是冗余', () => {
    // 规范要求每个语言版本都列出**包括自己**在内的全部版本。
    // 只列对方是很常见的写法，而它会被判为不完整。
    expect(zh.alternates.get('zh-CN')).toBe(zh.canonical);
    expect(en.alternates.get('en')).toBe(en.canonical);
  });
});

describe('标题与描述必须真的分语言', () => {
  it('两个入口的 <title> 不同 —— 复制过去忘了改，英文页就会顶着中文标题', () => {
    expect(zh.title).not.toBe('');
    expect(en.title).not.toBe('');
    expect(en.title).not.toBe(zh.title);
  });

  it('两个入口的 description 不同', () => {
    expect(zh.description).not.toBe('');
    expect(en.description).not.toBe('');
    expect(en.description).not.toBe(zh.description);
  });

  it('中文入口的标题与描述含汉字', () => {
    expect(zh.title).toMatch(CJK);
    expect(zh.description).toMatch(CJK);
  });

  it('英文入口的标题与描述**不含**汉字 —— 与词条表规则 3 同一套判据', () => {
    // `apps/mobile` 与 `apps/landing` 的词条表都有这条规则（en 不许含汉字），
    // 但 head 里的文案不在词条表里、门禁也扫不到，所以在这里单独钉一次。
    expect(en.title).not.toMatch(CJK);
    expect(en.description).not.toMatch(CJK);
  });
});

describe('主题引导脚本两个入口都有，且逐字相同', () => {
  /**
   * `theme-contract.spec.ts` 只查中文入口的引导脚本。而"只改了主入口"
   * 恰恰是最常见的漂移：加了英文入口之后，英文访客就成了唯一会看到
   * 一帧亮色的那群人 —— 而他们正是最不可能来报这个 bug 的人。
   */
  it('英文入口的引导脚本与中文入口完全一致', () => {
    const bootstrap = (relativePath: string): string => {
      const html = readFileSync(resolve(APP, relativePath), 'utf8');
      const start = html.indexOf('<script>');
      const end = html.indexOf('</script>', start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return html.slice(start, end);
    };

    expect(bootstrap('en/index.html')).toBe(bootstrap('index.html'));
  });
});