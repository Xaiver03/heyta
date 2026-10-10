/**
 * 整站冒烟测试（每一页）
 * ========================
 *
 * 目的有两个，而且第二个比第一个重要得多：
 *
 *   1. **证明这棵组件树在真实 DOM 里能渲染出来**。构建通过 ≠ 页面能渲染：
 *      类型系统看不见 hook 调用顺序、`useScroll` 的 target 为空、
 *      某个子组件在渲染期抛错、以及"文案写对了但根本没挂上去"。
 *
 *   2. 🔴 **证明没有孤立路由**（N2）。这条以前不可能测 —— 整站只有一页，
 *      "有没有人链得到它"是个空问题。现在站点有 7 个页面，而"加了一页、
 *      组件写好了、HTML 也生成了，就是没有任何地方链得到它"是这类站点的
 *      典型事故：页面能打开、返回 200、测试全绿，而线上没人到得了。
 *      所以这里从**每一页**出发收集站内链接，逐个反解回注册表，
 *      再看有没有哪个注册页面一次都没被指向。
 *
 * ⚠️ 计划 §9 曾把 `check:site-reachability` 列为一门独立的门禁脚本，**它尚未落地**
 * （归 W4/A8）。所以**本用例就是当前唯一的站点内可达性判据**，
 * 而且这是**故意**的：这道门禁要管的不只是渲染出来的链接，还有
 * "应用 → 站点"那一半（`apps/web` 里的链接，渲染在另一个 app 里）。
 * 这里管的是"站点内部不自成孤岛"，那条脚本管的是"两个产品不是一个孤岛"。
 *
 * 🔴 **渲染脚手架不住在本文件**，在 `helpers/render-page.tsx` —— 因为
 * `public-copy-register.spec.tsx`（公页语域门禁）要跑同一套脚手架。那套东西的
 * 每一处细节都是踩出来的（重复 `#main`、jsdom 缺 `ResizeObserver`、env 桩没清），
 * 抄第二份就会有一份过期，而"门禁看起来在跑、跑的却是过期脚手架"是最难查的红。
 *
 * 🔴 **刻意不挂载 WebGL 那一节**（由 helper 里那个永不触发的 `IntersectionObserver`
 * 保证）：jsdom 没有 WebGL，`three` 会抛 "Error creating WebGL context" ——
 * 那是**测试环境**的限制，不是产品缺陷。让它在 jsdom 里"通过"只能靠把
 * WebGL 整个 mock 掉，那种测试验证的是 mock，不是代码。
 * 所以 3D 那一节的验证方式是构建产物 + 真实浏览器。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { signInHref } from '../src/lib/app-url.js';
import { pageFromPath } from '../src/site/paths.js';
import { SITE_PAGES } from '../src/site/pages.js';
import {
  cleanupPage,
  installPageRenderer,
  internalHrefs,
  renderPage,
} from './helpers/render-page.js';

installPageRenderer();

/**
 * 全部页面 —— 每一个用例都跑一遍。
 *
 * 不逐个写用例：那样"加了第八页忘了补测试"就会静默发生，
 * 而这一整个文件的意义正是**不留下可以静默漏掉的东西**。
 */
const ALL_PAGE_IDS = SITE_PAGES.map((page) => page.id);

/**
 * 仓库根。**用这个惯用法而不是 `new URL(相对路径, import.meta.url)`**：
 * 后者的结果取决于 Vite 把该模块当文件模块还是当 dev-server 资源（实测同一个
 * `tests/` 目录里两种都出现过），而跨 `apps/` 读源码的判据不能建在会变的锚点上。
 * 同一写法已在 `tests/mockup-focus-ring.spec.tsx` 用了很久。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

describe('每一页都能渲染，且外壳完整', () => {
  it.each(ALL_PAGE_IDS)('%s：渲染不抛错，有 #main、有 H1、有页脚', (pageId) => {
    const view = renderPage(pageId);
    expect(view.querySelector('#main')).not.toBeNull();

    const h1 = view.querySelector('h1');
    expect(h1?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

    expect(view.querySelector('footer')).not.toBeNull();
  });

  /**
   * 🔴 「正文有实质内容」这一条对**每一页**成立，除了一页：`signin`。
   *
   * 2026-10-03 那一页被改成纯跳板（产品负责人实测：点「登录」先读到一段说明是错的
   * 形状，说明该在文档中心）。而"标题 + 两个出口"的页面**按定义**凑不满 500 字。
   * 这里的空不叫空壳：它的判据换成"有没有能点的出口"，写在下面的 signin 专项用例里。
   * ⚠️ 刻意不把 500 调低 —— 调低阈值会让真正的空壳页从这条判据里溜过去，
   * 而这条判据存在的意义正是抓住"页面在、内容不在"。
   */
  const CONTENT_PAGE_IDS = ALL_PAGE_IDS.filter((id) => id !== 'signin');

  it.each(CONTENT_PAGE_IDS)('%s：正文有实质内容（不是空壳）', (pageId) => {
    const view = renderPage(pageId);
    expect(view.textContent?.length ?? 0).toBeGreaterThan(500);
  });

  it.each(ALL_PAGE_IDS)('%s：主题按钮可点击，并会把 data-theme 写到 <html> 上', (pageId) => {
    const view = renderPage(pageId);
    const toggle = view.querySelector<HTMLButtonElement>('button[aria-label*="主题"]');
    expect(toggle).not.toBeNull();

    const before = document.documentElement.dataset['theme'];
    act(() => {
      toggle?.click();
    });
    expect(document.documentElement.dataset['theme']).not.toBe(before);
  });

  it.each(ALL_PAGE_IDS)('%s：GitHub 外链必须带 rel=noopener，也没有 target=_blank', (pageId) => {
    const view = renderPage(pageId);

    // 🔴 2026-09-29 仓库转公开，导航的 GitHub 图标回来了 —— 这条测试的判据
    // 随之更换：私有时期拦的是"出现仓库地址 = 死链接"；现在仓库可达，
    // 要拦的回归为**外链规范**：非站内链接必须带 `rel=noopener`
    //（语言切换是同站跳转，豁免）。
    for (const anchor of view.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#') || href.startsWith('/')) continue;
      const isLanguageSwitch = anchor.getAttribute('hrefLang') !== null;
      const rel = anchor.getAttribute('rel') ?? '';
      expect(
        isLanguageSwitch || rel.includes('noopener'),
        `外链既不是语言切换、也没带 rel=noopener：${href}`,
      ).toBe(true);
    }

    // 每一页的导航都有 GitHub 入口（真地址；rel 由上面的循环统一验过）。
    // 自建区那行可复制的 `git clone` 是同一条恢复链路的另一端，见 SelfHost.tsx ——
    // 哪天仓库再转私有，这两处要一起摘（见 Nav.tsx 文件头的清单）。
    expect(
      view.querySelector('a[href="https://github.com/Xaiver03/heyta"]'),
    ).not.toBeNull();

    expect([...view.querySelectorAll('a[target="_blank"]')]).toEqual([]);
  });
});

describe('🔴 没有孤立路由（N2）', () => {
  /**
   * 从每一页出发能到达的注册页面。
   *
   * ⚠️ 这里**只算导航与页脚**（外加页面正文里的站内链接）—— 也就是
   * "一个真实访客能点到的东西"。手打 URL 不算可达：那正是孤立路由的定义。
   */
  function reachablePageIds(): Set<string> {
    const seen = new Set<string>();
    for (const pageId of ALL_PAGE_IDS) {
      const view = renderPage(pageId);
      for (const href of internalHrefs(view)) {
        seen.add(pageFromPath(href).id);
      }
      cleanupPage();
    }
    return seen;
  }

  it('每一个注册页面都至少被某一页的某条站内链接指向', () => {
    const reachable = reachablePageIds();
    const orphans = ALL_PAGE_IDS.filter((id) => !reachable.has(id));
    // 报出**具体是哪些**页面孤立：只说"有孤立路由"会让人去猜。
    expect(orphans).toEqual([]);
  });

  it('首页一定可达 —— 字标指向它，而字标在每一页的导航与页脚里', () => {
    for (const pageId of ALL_PAGE_IDS) {
      const view = renderPage(pageId);
      const hrefs = internalHrefs(view);
      expect(hrefs.filter((href) => pageFromPath(href).id === 'home').length).toBeGreaterThan(0);
    }
  });

  it('顶部导航里的每一条都指向一个注册页面（不是手写的死地址）', () => {
    const view = renderPage('home');
    const navHrefs = [
      ...view.querySelectorAll<HTMLAnchorElement>('.lp-nav__links a[href]'),
    ].map((anchor) => anchor.getAttribute('href') ?? '');
    expect(navHrefs.length).toBeGreaterThanOrEqual(4);
    for (const href of navHrefs) {
      // 反解回注册表：如果导航里出现一条注册表没有的地址，
      // `pageFromPath` 会把它当成首页 —— 所以这里同时断言"不是首页"。
      expect(pageFromPath(href).id).not.toBe('home');
    }
  });

  it('页脚包含每一个 `inFooter` 的页面', () => {
    const view = renderPage('home');
    const footerHrefs = internalHrefs(view.querySelector<HTMLElement>('.lp-footer') ?? view);
    const footerPageIds = new Set(footerHrefs.map((href) => pageFromPath(href).id));
    for (const page of SITE_PAGES) {
      if (!page.inFooter) continue;
      expect(footerPageIds.has(page.id), `页脚里没有 ${page.id}`).toBe(true);
    }
  });
});

describe('切语言保持当前页面（子页面上最容易错的一处）', () => {
  /**
   * 🔴 2026-09-29 语言切换从单链接改成 globe 下拉：菜单默认收起，
   * 所以先点开触发钮（`act` 驱动真实的 React 状态），再断言菜单内容。
   * 原有的判据原样保留：英文项必须落在**本页**的英文版上 ——
   * 写死 `/en/` 时这条对子页面会红。
   */
  it.each(ALL_PAGE_IDS)('%s：切换器菜单里英文项落在本页的英文版', (pageId) => {
    const view = renderPage(pageId);
    const trigger = view.querySelector<HTMLButtonElement>('.lp-lang button');
    expect(trigger).not.toBeNull();
    act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const items = [...view.querySelectorAll<HTMLAnchorElement>('.lp-lang__item')];
    // 两种语言各一项；落点都是本页，各自带着自己的 hrefLang。
    expect(items.length).toBe(2);
    expect(items.map((item) => item.getAttribute('hrefLang')).sort()).toEqual(['en', 'zh-CN']);

    const enItem = items.find((item) => item.getAttribute('hrefLang') === 'en');
    const href = enItem?.getAttribute('href') ?? '';
    // 语言变了、页面没变。
    expect(href).toContain('/en/');
    expect(pageFromPath(href).id).toBe(pageId);

    // 当前语言单通道标记：aria-current 必须恰好落在其中一项上。
    const currents = items.filter((item) => item.getAttribute('aria-current') === 'true');
    expect(currents.length).toBe(1);
    expect(currents[0]?.getAttribute('hrefLang')).toBe('zh-CN');
  });
});

describe('富文本：`**粗**` 与反引号不能被原样显示', () => {
  /**
   * 词条表里写了大量 `**强调**` 与 `` `命令` ``。**不处理它们的后果是把星号和
   * 反引号直接显示给用户**，而那种错误在所有测试里都不会红：文本非空、
   * key 存在、门禁只看有没有硬编码。
   */
  it.each(ALL_PAGE_IDS)('%s：整页文本里没有 `**`，且确实渲染出了 <strong>', (pageId) => {
    const view = renderPage(pageId);
    expect(view.textContent ?? '').not.toContain('**');
  });

  it('首页之后的功能页有粗体', () => {
    const features = renderPage('features');
    expect(features.querySelectorAll('strong').length).toBeGreaterThan(0);
    // 🔴 这里**曾经**还有一条"公页不许出现 `pnpm …` 命令与仓库路径"的负断言，
    // 但它数的是 `.lp-evidence` 这个**类名** —— 而 2026-09-30 实际漏出去的
    // 那段贡献者语言（自建区的终端命令块 + Prisma 迁移警告）用的是别的类名，
    // 于是它一路绿灯。判据钉在类名上 = 改个类名就能绕过，而文案门禁要管的是
    // **用户读到的那串字**。该意图现在住在 `public-copy-register.spec.tsx`
    // （按每一页 × 每一语言渲染出的真实 textContent 执法），这里不再留第二份。
  });
});

describe('首页（原有断言，一个都不放松）', () => {
  it('页内锚点全部有落点 —— 导航与页脚的链接不会指向空处', () => {
    const view = renderPage('home');
    // 把锚点**从 DOM 里读出来**再逐个查落点，而不是硬编码一份 id 清单：
    // 硬编码的清单会在加了一个区块之后仍然全绿（"以为管住了，其实没管"），
    // 而写错/删掉一个区块 id 的后果就是"点了没反应"。
    const hrefs = [...view.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map(
      (a) => a.getAttribute('href') ?? '',
    );
    expect(hrefs.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    const missing = hrefs.filter((href) => view.querySelector(href) === null);
    expect(missing).toEqual([]);
    // 价格那一节必须有锚点：导航、页脚、以及它自己都指向它。
    expect(view.querySelector('#pricing')).not.toBeNull();
    // 被推迟挂载的那一节，**落点**同样必须在场（里面的 canvas 不在场，两回事）。
    expect(view.querySelector('#sync')).not.toBeNull();
  });

  it('每个区块都有二级标题 —— 页面结构对读屏软件是可导航的', () => {
    const view = renderPage('home');
    expect(view.querySelectorAll('h2').length).toBeGreaterThanOrEqual(6);
  });

  it('真实界面的复现件挂上了（任务列表、四象限、热力图）', () => {
    const view = renderPage('home');
    expect(view.querySelector('.mk-frame')).not.toBeNull();
    expect(view.querySelector('.lp-mini-quad')).not.toBeNull();
    expect(view.querySelector('.lp-mini-heat')).not.toBeNull();
  });

  it('WebGL 那一节在 jsdom 下**没有**被挂载（Deferred 的桩永不触发）', () => {
    const view = renderPage('home');
    // canvas 属于 SyncScene；它不该出现，因为 Deferred 没触发
    expect(view.querySelector('.lp-sync__canvas')).toBeNull();
  });

  it('价格区：两个付费档的价格都在，且没有假的购买按钮', () => {
    const view = renderPage('home');
    const pricing = view.querySelector('#pricing');
    expect(pricing).not.toBeNull();
    const text = pricing?.textContent ?? '';

    // ADR-0020：月付两个档（¥5 托管 / ¥12 含云端 AI），两种币都必须在页面上。
    expect(text).toContain('¥5');
    expect(text).toContain('¥12');
    expect(text).toContain('$5');
    expect(text).toContain('$12');
    expect(text).toContain('都不阉割功能');
    expect(text).toContain('云端 AI');

    // 唯一的可点元素是免费档的 CTA，指向自建那一节；托管档没有任何按钮/链接。
    expect(pricing?.querySelectorAll('button').length).toBe(0);
    const anchors = [...(pricing?.querySelectorAll('a[href]') ?? [])];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['#selfhost']);
  });

  /**
   * 🔴 应用入口的**默认状态**：没配置 `VITE_APP_URL` 时，页面里**不许**
   * 出现任何指向应用的链接。
   *
   * 这条是防"提前把按钮放上去"的：应用还没部署时放一个「立即使用」，
   * 点下去就是 404 —— 比没有入口更坏，因为它看起来是能用的。
   */
  it('未配置应用地址时，页面里没有任何指向应用的入口', () => {
    const view = renderPage('home');
    const hrefs = [...view.querySelectorAll<HTMLAnchorElement>('a[href]')].map(
      (a) => a.getAttribute('href') ?? '',
    );
    // GitHub 仓库链接（2026-09-29 恢复）与应用部署无关，它**无条件**存在 ——
    // 这条判据只管"应用入口"，把它排除后再断言没有别的外链。
    expect(
      hrefs.filter((href) => href.startsWith('http') && !href.includes('github.com')),
    ).toEqual([]);
    expect(view.textContent ?? '').not.toContain('立即使用');
  });

  /**
   * 应用入口的**上线状态**：配了 `VITE_APP_URL` 就必须真的多出那个入口，
   * 而且是**外链 + rel=noopener**。
   *
   * 这条与上面那条是**一对**：只有两条都在，才能证明"配置与否真的改变了页面"，
   * 而不是"两边都没做、测试照样绿"。变异验证：把 `startCta()` 写死成返回
   * `#selfhost`，这条立刻红。
   */
  it('配置了应用地址时，导航与收尾 CTA 都出现指向应用的「立即使用」', () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.example.com/');

    const view = renderPage('home');
    // 按 **pathname** 认，不按整串相等：入口 href 现在一定带 `?lang=`（默认语言也带，
    // 理由见 `app-url.ts`），拿整串比会把"真的多出了入口"读成"一条都没有"。
    const appAnchors = [
      ...view.querySelectorAll<HTMLAnchorElement>('a[href]')
    ].flatMap((a) => {
      try {
        const url = new URL(a.getAttribute('href') ?? '');
        return url.origin + url.pathname === 'https://app.example.com/' ? [{ a, url }] : [];
      } catch {
        return [];
      }
    });
    // 同一个 pathname 上住着**两个意图**：「立即使用」（新访客）与「登录」
    // （回访用户，带 `?signin`，且宽屏操作位 + 窄屏菜单各一条 ⇒ 两条）。
    // 不分开数就会把 4 当成"入口多了一条"—— 那正是这条判据要抓的事。
    const ctas = appAnchors.filter(({ url }) => !url.searchParams.has('signin'));
    const signins = appAnchors.filter(({ url }) => url.searchParams.has('signin'));

    // 两处：导航一条 + 收尾 CTA 一条。
    expect(ctas.length).toBe(2);
    expect(signins.length).toBe(2);
    for (const { a: anchor, url } of appAnchors) {
      expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
      // 每一条应用入口（两个意图都算）都要带 `lang=zh-CN` —— 不带的话英文浏览器的访客
      // 点中文落地页会被静默换成英文界面（`0aa6cb0e` 给应用解析链加了系统语言那一层）。
      expect(url.searchParams.get('lang')).toBe('zh-CN');
    }
    for (const { a: anchor } of ctas) {
      expect(anchor.textContent).toContain('立即使用');
    }
  });

  it('子页面上配了应用地址时，正文里就有应用入口（不是只有导航）', () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.example.com/');

    const view = renderPage('features');
    const appLinks = [...view.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
      (a) => a.getAttribute('href')?.startsWith('https://app.example.com') === true,
    );
    // 四条：导航「立即使用」+ 导航「登录」（这两条在窄屏菜单里各再出现一次）
    // + 页头一条。2026-10-03 之前是两条 —— 多的那两条是「登录」改指应用带来的。
    expect(appLinks.length).toBe(4);
    // 🔴 真正要钉的是**正文里那条存在**：少了它，访客读完一整页必须滚回顶部
    // 才有入口。只数总数会被"导航多了一条"顶掉，数"正文里有几条"才是判据本身。
    expect(appLinks.filter((a) => a.closest('#main') !== null).length).toBe(1);
  });
});

describe('子页面的正文真的挂上了', () => {
  it('/features 把注册表里的分区都渲染出来（不是只有页头）', () => {
    const view = renderPage('features');
    // 八个能力模块 + 「还没做的」+「明确不做的」。
    expect(view.querySelectorAll('.lp-row').length).toBeGreaterThanOrEqual(10);
    expect(view.querySelectorAll('.lp-list__item').length).toBeGreaterThanOrEqual(15);
  });

  /**
   * 🔴 A1-2：每个能力模块配**真实界面素材**，而且判据是"**不用截图**"。
   *
   * 截图会过期（改了设计系统就对不上），DOM 复现件跟着设计系统走。
   * 所以这里断言的是**复现件挂上了**（`.mk-frame` 是复现件的外框），
   * 而不是"页面里有张图"。
   */
  it('/features 的能力模块挂着真实界面的 DOM 复现件（不是截图）', () => {
    const view = renderPage('features');
    // 正文四种视图各一件（任务 / 四象限 / 习惯 / 专注），页头两栏 hero 另有一件
    //（四象限，见下一条）—— 共 5。
    expect(view.querySelectorAll('.mk-frame').length).toBe(5);
    // 一张 `<img>` 都不许有 —— 有图就说明有人贴了截图。
    expect(view.querySelectorAll('img').length).toBe(0);
  });

  /**
   * 🔴 2026-09-29：「验证方式」从公页退役（缘由见 `scripts/check-claims.mjs` 文件头）。
   * 这一条改为钉住页头的**两栏 hero**：/features 必须有真实界面的复现件，
   * 而不是一段悬空的标题加一片空白 —— 那种形状读起来像"页面到这儿就结束了"
   * （假地板），也是用户点名要修的布局。
   */
  it('/features 页头是两栏 hero：有产品复现件，能力模块一节不少', () => {
    const view = renderPage('features');
    expect(view.querySelector('.lp-page__head--split')).not.toBeNull();
    expect(view.querySelectorAll('.lp-page__visual .mk-frame').length).toBe(1);
    // 八个能力模块 + 「还没做的」+ 「明确不做的」= 10 节。
    expect(view.querySelectorAll('.lp-row').length).toBe(10);
  });

  it('/signin 在配了应用地址时给出找回通行密钥的入口，未配置时不猜地址', () => {
    // 未配置：没有那条链接（猜一个地址点下去是 404，比没有入口更坏）。
    const bare = renderPage('signin');
    expect(bare.querySelector('a[href$="/recover-passkey"]')).toBeNull();

    // 配了：链接落在**域名的根**上（那三张凭据页是服务端渲染的，不在 /app/ 下）。
    vi.stubEnv('VITE_APP_URL', 'https://heyta.finlaw.cloud/app/');
    const wired = renderPage('signin');
    const link = wired.querySelector<HTMLAnchorElement>('a[href$="/recover-passkey"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://heyta.finlaw.cloud/recover-passkey');
  });

  it('/platforms 六端各一节', () => {
    const view = renderPage('platforms');
    // 六端：Web / Android / iOS / 桌面 / 鸿蒙 / 自建。
    expect(view.querySelectorAll('.lp-row').length).toBe(6);
  });

  /**
   * 🔴 A7：`/integrations` 是**数据主权**那一页。九条能力一节不少 ——
   * 少一条就说明有人把某个能力从页面结构里拿掉了，而那时页面看起来仍然"有内容"。
   * （「验证方式」已从公页退役，见 `scripts/check-claims.mjs` 文件头。）
   */
  it('/integrations 九条能力各有一节', () => {
    const view = renderPage('integrations');
    expect(view.querySelectorAll('.lp-row').length).toBe(9);
  });

  it('/pricing 有对照表、有 FAQ，而且**没有购买按钮**', () => {
    const view = renderPage('pricing');
    expect(view.querySelectorAll('.lp-compare__row').length).toBe(6);
    expect(view.querySelectorAll('.lp-faq__item').length).toBe(4);
    // 对照表里"功能"与"锁定"两行跨列渲染（同一句话不做两遍）。
    expect(view.querySelectorAll('.lp-compare__cell--same').length).toBe(2);
    expect(view.querySelectorAll('.lp-pricing__card').length).toBe(3);
    // 两个 button：主题切换 + 语言切换的触发钮（语言菜单项是链接不是按钮，
    // 所以"没有购买按钮"的判据仍然成立 —— 计数从 1 到 2 是 2026-09-29 语言
    // 下拉带来的，不是购买入口回来了）。
    expect(view.querySelectorAll('button').length).toBe(2);
  });

  it('/help 的每一条问题都有答案，且答案在页面上（没被折叠起来）', () => {
    const view = renderPage('help');
    const questions = view.querySelectorAll('.lp-faq__q');
    const answers = view.querySelectorAll('.lp-faq__a');
    // 🔴 A4-2：首批必须覆盖**用户最会撞到的 10 个问题**。数到这个数 是刻意的 ——
    // 少一条就说明有人把某个问题从清单里拿掉了，而页面看起来仍然"有内容"。
    // 2026-10-08 工单 W4 加了「怎么换绑登录邮箱」与「怎么退出某一台设备」两条 ⇒ 10 → 12。
    // 加一个数就要加一条真答案：这两条各自对应一层（`content.ts` 的 pairs 与 i18n 的 q/a 键）。
    expect(questions.length).toBe(12);
    expect(answers.length).toBe(questions.length);
    // ⚠️ 只查正文：导航里那个窄屏折叠菜单**就是** `<details>`（见 `Nav.tsx`），
    // 它是导航，不是"被折起来的答案"。
    expect(view.querySelector('#main')?.querySelectorAll('details').length).toBe(0);
    // A4-1：按**功能模块**组织 —— 至少有 5 个模块小标题。
    expect(view.querySelectorAll('.lp-help__module').length).toBeGreaterThanOrEqual(5);
  });

  it('/changelog 每条都有机器可读的日期', () => {
    const view = renderPage('changelog');
    const times = [...view.querySelectorAll('time[datetime]')];
    expect(times.length).toBeGreaterThanOrEqual(5);
    for (const time of times) {
      expect(time.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * 🔴 `/signin` 是一页**出口**，不是一段说明（2026-10-03 产品负责人实测否掉了旧形状）。
   *
   * 判据数的是**说明的渲染形状**（能力行 `.lp-row`、方式卡 `.lp-methods__item`、
   * 折叠块 `<details>`），不是某句话的措辞 —— 措辞会改，而"这一页没有阅读材料"
   * 不会改。当初那一页排着两张方式卡 + 两节解释 + 一条 ⚠️ 注脚，
   * 想登录的人点开先读了一篇说明；解释现在住在文档中心那篇《账号、令牌与登录方式》。
   */
  it('/signin 只剩出口，正文里没有一节说明', () => {
    const view = renderPage('signin');
    const body = view.querySelector('#main')!;
    expect(body.querySelectorAll('.lp-row').length).toBe(0);
    expect(body.querySelectorAll('.lp-methods__item').length).toBe(0);
    expect(body.querySelectorAll('details').length).toBe(0);

    // 未配置应用：主行动退回站内的自建那一节（不猜地址），但**仍然有出口**。
    const primary = view.querySelector<HTMLAnchorElement>('.lp-page__cta a');
    expect(primary).not.toBeNull();
    expect(primary!.getAttribute('href')).toBe('#selfhost');

    // 说明的去处：文档中心那一页必须在这一页上链得到（用 `pageFromPath` 反解，
    // 而不是把 `/docs/account/` 写死 —— 语言前缀与尾斜杠由注册表决定）。
    const docsLink = [...view.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
      (a) => pageFromPath(a.getAttribute('href')!).id === 'account',
    );
    expect(docsLink, '公页上没有任何链接指向文档中心的「账号、令牌与登录方式」').toBeDefined();
  });

  /**
   * 🔴 两个包各抄了一份 `signin` 这个**参数名字面量**：
   * `apps/landing/src/lib/app-url.ts` 写，`apps/web/src/lib/auth-deep-link.ts` 读
   * （落地页不能 import 应用里的模块，那会把整个领域包拖进落地页的 bundle）。
   *
   * 所以这里不写死那个名字，而是**读回应用那一侧的源码**，用它解析出来的参数名
   * 去查落地页生成的 URL。任何一边改名都会红 —— 而不是等到用户点了没反应才发现。
   */
  it('落地页加的那个参数名，就是应用那一侧读的那个名', () => {
    const webSource = readFileSync(
      join(REPO, 'apps/web/src/lib/auth-deep-link.ts'),
      'utf8',
    );
    const defined = /SIGNIN_QUERY_PARAM\s*=\s*'([^']+)'/.exec(webSource);
    const paramName = defined?.[1];
    if (paramName === undefined) {
      throw new Error(
        'apps/web/src/lib/auth-deep-link.ts 里没有 SIGNIN_QUERY_PARAM 的定义 —— 那一侧改名或删了这个常量，' +
          '这条判据要跟着改，不能空转。',
      );
    }

    vi.stubEnv('VITE_APP_URL', 'https://heyta.finlaw.cloud/app/');
    const href = signInHref('zh-CN');
    if (href === null) {
      throw new Error('配了 VITE_APP_URL 而 signInHref() 返回 null —— 这一侧坏了，比对无从做起');
    }
    expect(new URL(href).searchParams.get(paramName)).toBe('1');
  });

  /**
   * 🔴 那段说明**真的渲染出来了**，不是只进了字典。
   *
   * 这是本仓库最高发的那类"看起来搬完了"：词条加进 `site.docs.account.s5`、
   * 中英同步、`check:ui-language` 全绿，而 `docs.ts` 的分区清单里没挂它 ——
   * 于是那句话在**任何页面上都不存在**，而 `/signin` 那页已经把它删了。
   * 两侧一起改的那次改动，恰好是这种断链最容易发生的时候。
   */
  it('文档中心那篇「账号、令牌与登录方式」把每一节真的挂上了', () => {
    const view = renderPage('account');
    // 七节：三个框 / 三条登录方式 / 桌面壳跳浏览器 / 条款归谁 / 为什么登录在应用里 /
    // 换绑邮箱 / 登录设备（后两节 2026-10-08 工单 W4 加）。
    expect(view.querySelectorAll('.lp-row').length).toBe(7);
    // 取一句**只可能来自那段说明**的话做 needle（措辞改了要跟着改这里，这是刻意的：
    // 它意味着"这段内容真的在页面上"这件事有一个会红的判据）。
    expect(view.textContent).toContain('对着 A 服务器登录');
    // 锚点由 `docs.ts` 的 section id 给，链接要能指到这一节。
    expect(view.querySelector('#why-in-app')).not.toBeNull();
    // 🔴 新加的两节各自要有一句**只可能来自那一节**的话 —— 计数会跟着涨，
    // 但"内容真的在页面上"这件事只对被点名的那一节成立。
    for (const [anchor, needle] of [
      ['#rebinding-email', '任何一边没点就什么都不变'],
      ['#sign-in-sessions', '每一条都可以单独登出'],
    ] as const) {
      expect(view.querySelector(anchor), `文档中心缺锚点 ${anchor}（docs.ts 的 section id 没挂上）`).not.toBeNull();
      expect(view.textContent, `第 ${anchor} 节的正文没真的出现在页面上`).toContain(needle);
    }
  });

  /**
   * 🔴 导航那个「登录」的落点随构建期配置换**意图的目标**，但意图本身不换：
   * 配了应用 → 应用（带打开认证面板的参数）；没配 → 站内那一页。
   * 两种状态都必须出现过（与 `app-url.spec.ts` 文件头那条纪律同一条）。
   */
  it('导航「登录」：配了应用直接进应用，没配才落站内那一页', () => {
    const bare = renderPage('home');
    const bareLink = bare.querySelector<HTMLAnchorElement>('.lp-nav__signin')!;
    expect(bareLink.getAttribute('href')).toBe('/signin/');
    // 站内链接不许带 rel（它是同源导航，`noopener` 会拦掉本该保留的引用）。
    expect(bareLink.getAttribute('rel')).toBeNull();
    cleanupPage();

    vi.stubEnv('VITE_APP_URL', 'https://heyta.finlaw.cloud/app/');
    const wired = renderPage('home');
    const wiredLink = wired.querySelector<HTMLAnchorElement>('.lp-nav__signin')!;
    expect(wiredLink.getAttribute('href')).toBe('https://heyta.finlaw.cloud/app?lang=zh-CN&signin=1');
    expect(wiredLink.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('🔴 /platforms 只有散文、没有状态 —— 徽标与图例', () => {
  /**
   * 🔴 这一页叫「平台状态」，而在此之前它**没有状态**。
   *
   * `site.platforms.status.*` 与 `site.platforms.legend.*` 六条词条写好了、
   * 门禁也绿，但 `SectionSpec` 上没有 `status` 字段 —— **结构上渲染不出来**。
   * 访客只能逐段读散文才知道某个平台到底能不能用，而这一页存在的全部意义
   * 就是让他一眼看出来。这是"看起来有、其实没有"里最贵的一种：
   * **页面在，但它要传达的那件事不在。**
   */
  it('六个平台各有一个状态徽标，且档位与页面正文的说法一致', () => {
    const view = renderPage('platforms');

    const badges = [...view.querySelectorAll<HTMLElement>('.lp-status')];
    // 6 个平台 + 3 条图例
    expect(badges.length).toBe(9);

    const byStatus = (s: string): number =>
      badges.filter((b) => b.dataset['status'] === s).length;
    // 平台上：web 可用；android/ios/desktop/selfhost 进行中；harmony 阻塞
    expect(byStatus('available')).toBe(1 + 1); // 1 个平台 + 1 条图例
    expect(byStatus('partial')).toBe(4 + 1);
    expect(byStatus('blocked')).toBe(1 + 1);
  });

  it('三个档位都有中文说法 —— 徽标不能是三个没有定义的词', () => {
    const text = renderPage('platforms').textContent ?? '';
    expect(text).toContain('能用，且有端到端验收');
    expect(text).toContain('进行中');
    expect(text).toContain('有明确的外部依赖没解决');
  });

  it('其它页面**不**出现状态徽标（它只属于 /platforms）', () => {
    for (const id of ALL_PAGE_IDS) {
      if (id === 'platforms') continue;
      expect(
        renderPage(id).querySelectorAll('.lp-status').length,
        `${id} 上不该有平台状态徽标`,
      ).toBe(0);
    }
  });
});
