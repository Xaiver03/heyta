/**
 * `/download` 的判据 —— 盯的是"只在顺利时看起来对"那一族
 * ==========================================================
 *
 * 这一页最可能的失效不是"画错了"，而是**给访客一个点不动的出口**：
 * 一条 404 的直链、一个装了打不开的包、一句没有落点的"可安装"。
 * 所以下面每一条负向断言都配了一条**正向对照**（同一把尺在"应该有"的状态下确实量得出东西），
 * 否则"页面根本没画出口"也会让它绿灯 —— 那是本仓库反复记过的那种假绿。
 *
 * 清单的两种状态都用**同一份脚手架**渲染（`renderPage` 的 `pageProps` 注入点），
 * 而不是各自 `createRoot` 一次：脚手架的三个前提只住在一处（见那个文件头）。
 */

import { describe, expect, it } from 'vitest';

import { CATALOGS } from '@heyta/i18n';
import { LOCALES, type MessageKey } from '@heyta/i18n/provider';

import {
  DOWNLOAD_ROWS,
  OFFICIAL_STORE_HOSTS,
  detectRow,
  releaseManifest,
  resolveRows,
  type ReleaseManifest,
} from '../src/site/downloads.js';
import { installPageRenderer, renderPage } from './helpers/render-page.js';

installPageRenderer();

/** 分发桶的域名。**这一条字符串只许出现在测试里**：源码里出现就意味着有人手写了直链。 */
const BUCKET = 'heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com';

function fileAt(platform: string, version: string) {
  const name = `heyta-${version}-${platform}.bin`;
  return {
    name,
    url: `https://${BUCKET}/app-releases/heyta/latest/${name}`,
    versionedUrl: `https://${BUCKET}/app-releases/heyta/${version}/${name}`,
    sha256: 'a'.repeat(64),
    size: 1234567,
  };
}

/** 已发布状态：正式通道 + 四个端的产物 + iOS 的 TestFlight 入口。 */
const PUBLISHED: ReleaseManifest = {
  version: '1.0.0',
  releasedAt: '2026-10-07T02:00:00+00:00',
  files: {
    macos: fileAt('macos', '1.0.0'),
    android: fileAt('android', '1.0.0'),
    windows: fileAt('windows', '1.0.0'),
    linux: fileAt('linux', '1.0.0'),
  },
  channels: {
    ios: {
      url: 'https://testflight.apple.com/join/EXAMPLETOKEN',
      name: 'TestFlight',
      addedAt: '2026-10-07T02:00:00+00:00',
    },
  },
};

/** 今天桶里的真状态：字节在，但那是 `0.0.0-dev` 的那一轮试传。 */
const DEV_CHANNEL: ReleaseManifest = {
  ...PUBLISHED,
  version: '0.0.0-dev',
  files: { macos: fileAt('macos', '0.0.0-dev'), android: fileAt('android', '0.0.0-dev') },
};

/** 桶里一个字节都没有（下一次清空之后、第一次发布之前）。 */
const EMPTY: ReleaseManifest = {
  version: '1.0.0',
  releasedAt: '2026-10-07T02:00:00+00:00',
  files: {},
};

function bucketLinks(view: HTMLElement): string[] {
  return [...view.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => href.includes(BUCKET));
}

function cardCount(view: HTMLElement): number {
  return view.querySelectorAll('.dl-card').length;
}

describe('清单决定出口：三种状态，同一把尺', () => {
  it('正向对照：已发布时每一条产物都在页面上给出逐字相同的直链', () => {
    const view = renderPage('download', 'zh-CN', { manifest: PUBLISHED });
    const expected = Object.values(PUBLISHED.files).map((file) => file.url);
    expect(bucketLinks(view).sort()).toEqual([...expected].sort());
  });

  it('今天桶里那批 0.0.0-dev 的字节**一个都不许成为直链**（那个 mac 包装上打不开）', () => {
    const view = renderPage('download', 'zh-CN', { manifest: DEV_CHANNEL });
    expect(bucketLinks(view)).toEqual([]);
    // 正向对照：卡片确实画全了 —— 否则"零链接"只是因为页面是空的。
    expect(cardCount(view)).toBe(DOWNLOAD_ROWS.length);
  });

  it('清单为空时也不许冒出一条链接', () => {
    const view = renderPage('download', 'zh-CN', { manifest: EMPTY });
    expect(bucketLinks(view)).toEqual([]);
    expect(cardCount(view)).toBe(DOWNLOAD_ROWS.length);
  });

  it('拿不到出口的那一行，不许有一个看起来能点的按钮', () => {
    const view = renderPage('download', 'zh-CN', { manifest: DEV_CHANNEL });
    for (const resolved of resolveRows(DEV_CHANNEL)) {
      if (resolved.state !== 'pending' && resolved.state !== 'none') continue;
      const card = view.querySelector(`#dl-${resolved.row.id}`);
      expect(card, `#${resolved.row.id} 这一张卡应当存在`).not.toBeNull();
      expect(
        card?.querySelectorAll('.lp-btn').length,
        `${resolved.row.id} 没有产物却画了按钮`,
      ).toBe(0);
    }
    // 正向对照：同一批卡在已发布状态下**就是**有按钮（判据不是恒成立）。
    const published = renderPage('download', 'zh-CN', { manifest: PUBLISHED });
    expect(published.querySelectorAll('#dl-macos .lp-btn').length).toBe(1);
    expect(published.querySelectorAll('#dl-windows .lp-btn').length).toBe(1);
  });

  it('TestFlight 那一行只认清单里的通道，入口文案与直链不同', () => {
    const withChannel = renderPage('download', 'zh-CN', { manifest: PUBLISHED });
    const href = withChannel.querySelector('#dl-ios .lp-btn')?.getAttribute('href');
    expect(href).toBe(PUBLISHED.channels?.ios?.url);

    const noChannel = renderPage('download', 'zh-CN', {
      manifest: { ...PUBLISHED, channels: undefined },
    });
    // 注意是**出口按钮**为空：这一档合法地留着一条"这一端到哪一步了"的说明链接。
    expect(noChannel.querySelector('#dl-ios a.lp-btn')).toBeNull();
    expect(storeExits(noChannel)).toBe(0);
  });

  it('同一份清单里各端可以不同轮：只有正式通道那一端出按钮', () => {
    // 合并式清单的真实形状：macOS 发了 1.0.0，Android 那一条还挂着去年试传的 0.0.0-dev。
    // 批次号是 1.0.0 —— 所以"看批次号"会错，"看这一枚文件自己的版本"才对。
    const mixed: ReleaseManifest = {
      ...PUBLISHED,
      channels: undefined,
      files: {
        macos: { ...PUBLISHED.files.macos, version: '1.0.0' },
        android: {
          name: 'heyta-0.0.0-dev-android.bin',
          url: `https://${BUCKET}/app-releases/heyta/latest/heyta-0.0.0-dev-android.bin`,
          versionedUrl: 'x',
          sha256: 'c'.repeat(64),
          size: 66049508,
          version: '0.0.0-dev',
        },
      },
    };
    const view = renderPage('download', 'zh-CN', { manifest: mixed });
    expect(bucketLinks(view)).toEqual([PUBLISHED.files.macos.url]);
    expect(view.querySelector('#dl-android a.lp-btn')).toBeNull();
    // 正向对照：另一端的按钮真的画出来了 —— 否则"只有一条"会因为整页没按钮而恒绿。
    expect(view.querySelector('#dl-macos a.lp-btn')).not.toBeNull();
  });

  it('真源此刻是什么状态，页面就是什么状态（这一条会随发布而变，变之前它拦住手改）', () => {
    const view = renderPage('download', 'zh-CN');
    const live = resolveRows(releaseManifest()).filter(
      (entry) => entry.state === 'file-ready' || entry.state === 'store',
    );
    expect(bucketLinks(view).length + storeExits(view)).toBe(live.length);
  });
});

// 商店那一档的出口是**按钮**，不是行内那条"这端到哪一步了"的说明链接 —— 数错了会把
// "没有通道"这一档读成"有出口"，而那正是这一族判据要避免的方向。
function storeExits(view: HTMLElement): number {
  return [...view.querySelectorAll<HTMLAnchorElement>('#dl-ios a.lp-btn')].filter((a) =>
    a.getAttribute('href')?.includes('apple.com'),
  ).length;
}

describe('系统识别：只挑推荐位，不改页面内容', () => {
  it('认出 macOS 时也把另外七端全画出来，并把推荐位标在 mac 卡上', () => {
    const original = window.navigator.userAgent;
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      configurable: true,
    });
    try {
      const view = renderPage('download', 'zh-CN', { manifest: PUBLISHED });
      expect(cardCount(view)).toBe(DOWNLOAD_ROWS.length);
      expect(view.querySelector('.dl-card[data-recommended="true"]')?.id).toBe('dl-macos');
      // Mac 只能"疑似"：芯片读不出来，而包是分芯片的 —— 所以它必须是 ask 而不是 sure。
      expect(view.querySelector('.dl-finder')?.getAttribute('data-state')).toBe('ask');
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { value: original, configurable: true });
    }
  });

  const TABLE: readonly [string, string | null, boolean][] = [
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'android', true],
    // 兼容模式的鸿蒙 UA 里同时有 Android 字样 —— 顺序判据就在这里。
    ['Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Android 12', 'harmony', true],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'ios', true],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'ios', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows', true],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'linux', true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos', false],
    ['curl/8.4.0', null, false],
  ];
  it.each(TABLE)('UA「%s」→ %s', (userAgent, expected, confident) => {
    const detected = detectRow(userAgent);
    expect(detected?.id ?? null).toBe(expected);
    if (expected !== null) expect(detected?.confident).toBe(confident);
  });
});

describe('与 /platforms 的分界（下载动作只住在一页）', () => {
  it('/platforms 上不许出现任何一条直链', () => {
    const view = renderPage('platforms', 'zh-CN');
    expect(bucketLinks(view)).toEqual([]);
    // 正向对照：这一页不是空白页，否则上一条会因为"什么都没渲染"而恒绿。
    expect(view.querySelectorAll('section#web').length).toBe(1);
  });

  it('下载面不许自带一份状态口径（徽标只属于状态页）', () => {
    const view = renderPage('download', 'zh-CN', { manifest: PUBLISHED });
    expect(view.querySelectorAll('.lp-status').length).toBe(0);
  });

  it('状态页的入口整页只有一条（三端同指 #desktop 的那种重复链接已经摘掉）', () => {
    const view = renderPage('download', 'zh-CN', { manifest: EMPTY });
    // 只数正文区：页脚那条「平台」链接是注册表派生的，每一页都有一条，与本判据无关。
    const toPlatforms = [...view.querySelectorAll<HTMLAnchorElement>('.dl-body a[href]')].filter(
      (a) => (a.getAttribute('href') ?? '').includes('/platforms/'),
    );
    expect(toPlatforms, '正文区应当只留页末那一条说明链接').toHaveLength(1);
    // 每一张拿不到包的卡，仍然必须自己说清差在哪一步（不能只靠那条外链）。
    for (const id of ['windows', 'linux', 'harmony', 'ios']) {
      const gap = view.querySelector(`#dl-${id} .dl-gap`);
      expect(gap?.textContent?.trim().length ?? 0, `${id} 的原因不能是一句占位`).toBeGreaterThan(8);
    }
  });
});

describe('公页承诺与文案', () => {
  it('网页行不许出现「可安装」（G-51 那条承诺的延伸：没有载体的话不上公页）', () => {
    for (const locale of LOCALES) {
      const view = renderPage('download', locale, { manifest: PUBLISHED });
      const webRow = view.querySelector('#dl-web')?.textContent ?? '';
      expect(webRow.length, '网页行不能是空串，否则下面的负断言无条件成立').toBeGreaterThan(0);
      expect(webRow).not.toContain('可安装');
      expect(webRow).not.toContain('Installable');
    }
  });

  it('每一端的"差在哪一步"都写在两张表里，且不许是"敬请期待"', () => {
    const forbidden = ['敬请期待', '即将推出', 'coming soon', 'Coming Soon'];
    for (const row of DOWNLOAD_ROWS) {
      for (const locale of LOCALES) {
        const catalog = CATALOGS[locale];
        for (const key of [row.labelKey, row.bodyKey, row.gapKey] as MessageKey[]) {
          const text = catalog[key];
          expect(text, `${locale} 缺词条 ${key}`).toBeTruthy();
          // 端名（Web / macOS / 鸿蒙）本来就只有几个字，短不是问题；
          // 正文与"差在哪一步"必须是句子，否则就是占位文案。
          if (key === row.labelKey) continue;
          expect(text.length, `${key} 太短，读起来像占位文案`).toBeGreaterThan(8);
          for (const needle of forbidden) {
            expect(text, `${key} 不许出现「${needle}」`).not.toContain(needle);
          }
        }
      }
    }
  });

  it('已发布那一行要把版本、大小、精确字节与校验值都摆在页面上', () => {
    const view = renderPage('download', 'zh-CN', { manifest: PUBLISHED });
    const card = view.querySelector('#dl-macos');
    expect(card?.textContent).toContain('1.0.0');
    expect(card?.textContent).toContain('1,234,567 B');
    expect(card?.querySelector('.dl-hash__value')?.textContent).toBe('a'.repeat(64));
    expect(card?.querySelector('time')?.getAttribute('dateTime')).toBe(PUBLISHED.releasedAt);
  });
});

describe('发布清单的校验（错了要响亮，不要安静地画出一个坏按钮）', () => {
  it('接受真源现在这份', () => {
    expect(() => releaseManifest()).not.toThrow();
  });

  const BAD: readonly [string, unknown][] = [
    ['缺 sha256', { ...PUBLISHED, files: { macos: { ...PUBLISHED.files.macos, sha256: 'zz' } } }],
    ['http 直链', { ...PUBLISHED, files: { macos: { ...PUBLISHED.files.macos, url: 'http://x/y' } } }],
    [
      'name 与 version 不同轮',
      { ...PUBLISHED, files: { macos: { ...PUBLISHED.files.macos, name: 'heyta-0.9.0-macos.bin' } } },
    ],
    ['未登记的产物', { ...PUBLISHED, files: { ...PUBLISHED.files, watchos: fileAt('watchos', '1.0.0') } }],
    ['未登记的通道', { ...PUBLISHED, channels: { macos: PUBLISHED.channels!.ios } }],
    [
      '通道域名不在白名单',
      { ...PUBLISHED, channels: { ios: { ...PUBLISHED.channels!.ios, url: 'https://evil.example/a' } } },
    ],
    ['缺 version', { ...PUBLISHED, version: '' }],
  ];
  it.each(BAD)('%s ⇒ 抛错', (_label, raw) => {
    expect(() => releaseManifest(raw)).toThrow();
  });

  it('阳性对照：白名单本身不是空的，且合法通道不会误抛', () => {
    expect(OFFICIAL_STORE_HOSTS.length).toBeGreaterThan(0);
    expect(() => releaseManifest(PUBLISHED)).not.toThrow();
  });
});
