/**
 * `/download`：获取 heyta —— 只给点得动的出口
 * ==============================================
 *
 * 判据本体在 `src/site/downloads.ts`（一张表 + 一份清单）。这一文件只画东西。
 *
 * 🔴 三条不许（沿用上一版，判据不变）：
 *   1. 不许在这里出现任何一条 URL —— 直链只能来自发布清单（`scripts/check-downloads.mjs` 的臂 A 抓这条）；
 *   2. 不许给 `pending` / `none` 那一档画带"下载"字样的按钮 —— 点了 404 的按钮比没有按钮更坏；
 *   3. 不许让系统识别**隐藏**别的行 —— 识别只挑一个推荐位，全表照旧排在下面（OBS/VS Code 同形）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-11 版式重做（anti-slop）
 *
 * 上一版是一行识别条 + 两张等宽卡片的网格，读起来像一块设置面板，看不出这是同一款产品
 * 在四个端上的真实样子。这一版拆成五种互不重复的版式族：
 *
 *   ① Hero 非对称分栏：左文案 + 按 UA 落到"你那一端"的主 CTA；右电脑套框 + 手机套框叠放。
 *   ② 平台下载行：图标 + 名称 + 版本/大小 + 按钮的一条条，当前设备高亮（保留全部下载逻辑）。
 *   ③ 各端的样子（核心）：**桌面端**用 `AppWindow` 复现件、**移动端**用 `MobileAppWindow` 复现件，
 *      两边都填同一份 `showcase-data` 的样例数据 —— 访客在每个端都能看到产品是什么样，
 *      而不是只看得到手机。屏幕里是**真实 DOM 组件**，不是假截图，也不是手搓的示意图。
 *   ④ 三步开始。
 *   ⑤ 安全与校验（官方渠道 + 版本/大小/SHA + 校验值）。
 *
 * 铁律：Hero 的主 CTA 落点是**页内锚点**（指向下面那条平台行 / 全部下载），不是文件直链 ——
 * 直链的唯一来源照旧是发布清单；这里多一条外链就等于给这一页加了第二个事实源。
 */

import { ICON_SIZE } from '@heyta/design-system';
import {
  Apple,
  Globe,
  Layers,
  Monitor,
  Server,
  Smartphone,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, useLocale, type MessageKey } from '@heyta/i18n/provider';

import '../styles/download.css';

import { AppWindow } from '../mockup/AppWindow.js';
import { MobileAppWindow, type MobileMockView } from '../mockup/MobileAppWindow.js';
import {
  DOWNLOAD_ROWS,
  detectRow,
  formatReleaseDate,
  formatSize,
  releaseManifest,
  resolveRows,
  type ReleaseFile,
  type ReleaseManifest,
  type ResolvedRow,
} from '../site/downloads.js';
import { KeyText, RichText, SiteSubPage } from '../site/PageSections.js';
import { siteCta, useSelfHostHref } from '../site/cta.js';
import { pageById, type SitePage } from '../site/pages.js';
import { siteHref } from '../site/paths.js';

/** 每一端一枚图标。**这一张表只是视觉映射**，不代表任何"能不能下"的判断（那全在清单里）。 */
const ROW_ICONS: Readonly<Record<string, LucideIcon>> = {
  web: Globe,
  macos: Apple,
  ios: Smartphone,
  android: Smartphone,
  windows: Monitor,
  linux: Terminal,
  harmony: Layers,
  selfhost: Server,
};

export function DownloadPage({
  page,
  manifest = releaseManifest(),
}: {
  readonly page: SitePage;
  /**
   * 注入点。**默认值就是真源**（`release-manifest.json`），生产与 `main.tsx` 一个字都不用传 ——
   * 它存在的唯一理由是让"清单为空"与"清单有货"两种状态都能在同一套脚手架下被渲染出来
   * （判据在 `tests/downloads.spec.tsx`：这一页最容易出的错，是只在顺利时看起来对）。
   */
  readonly manifest?: ReleaseManifest;
}): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const rows = resolveRows(manifest);
  const cta = siteCta(page, locale);
  const selfHostHref = useSelfHostHref();
  const detected = detectRow(window.navigator.userAgent);
  const recommendedId = detected?.id ?? null;
  const recommended =
    recommendedId === null ? undefined : rows.find((entry) => entry.row.id === recommendedId);
  const heroCta = resolveHeroCta(recommended, cta, t);

  return (
    <SiteSubPage page={page} sections={[]} visual={<HeroStage />} primaryCta={heroCta}>
      <div className="dl-body">
        <Finder
          labelKey={
            recommendedId === null
              ? null
              : (DOWNLOAD_ROWS.find((row) => row.id === recommendedId)?.labelKey ??
                ('site.download.row.web.name' as MessageKey))
          }
          confident={detected?.confident ?? false}
          webHref={cta.href}
        />

        <section id="download-all" className="dl-block" aria-labelledby="dl-rows-title">
          <h2 id="dl-rows-title" className="lp-h2 dl-h2 dl-block__title">
            <KeyText messageKey="site.download.rows.title" />
          </h2>
          <ul className="dl-rows">
            {rows.map((resolved) => (
              <DownloadCard
                key={resolved.row.id}
                resolved={resolved}
                recommended={resolved.row.id === recommendedId}
                version={manifest.version}
                releasedAt={manifest.releasedAt}
                locale={locale}
                cta={cta}
                selfHostHref={selfHostHref}
              />
            ))}
          </ul>
        </section>

        <ScreensShowcase />

        <StepsSection />

        <VerifyBlock version={manifest.version} releasedAt={manifest.releasedAt} locale={locale} />

        <p className="lp-note">
          <RichText text={t('site.download.note')} />{' '}
          <a className="dl-link" href={siteHref(pageById('platforms'), locale)}>
            <KeyText messageKey="site.download.platforms.link" />
          </a>
        </p>
      </div>
    </SiteSubPage>
  );
}

/**
 * Hero 主 CTA 落点 —— **只落在页内锚点**。
 *
 * 规则：认出你这一端就落到那条平台行（真实出口就在那一行里），认不出就落到"全部下载"。
 * 全程不产生第二条文件/商店直链 —— 那是发布清单的事，见文件头铁律。
 */
function resolveHeroCta(
  recommended: ResolvedRow | undefined,
  cta: ReturnType<typeof siteCta>,
  t: (key: MessageKey) => string,
): { href: string; label: string; external?: boolean } {
  if (recommended === undefined) {
    return { href: '#download-all', label: t('site.download.hero.ctaAll') };
  }
  const { row } = recommended;
  const name = t(row.labelKey);
  switch (recommended.state) {
    case 'file-ready':
      return { href: `#dl-${row.id}`, label: `${t('site.download.get')} ${name}` };
    case 'store':
      return { href: `#dl-${row.id}`, label: `${t('site.download.join')} ${name}` };
    case 'open':
      return { href: cta.href, label: t(cta.labelKey), external: cta.external };
    case 'guide':
      return { href: `#dl-${row.id}`, label: t('site.download.selfhost.cta') };
    default:
      return { href: `#dl-${row.id}`, label: t('site.download.hero.ctaView') };
  }
}

/**
 * 「你这台机器」那一条。
 *
 * 🔴 没认出来时它也必须有用（一句"下面按端列全"），而不是整块消失 ——
 * 只在顺利时出现的区块，等于把识别失败藏起来。
 */
function Finder({
  labelKey,
  confident,
  webHref,
}: {
  readonly labelKey: MessageKey | null;
  readonly confident: boolean;
  readonly webHref: string;
}): React.JSX.Element {
  if (labelKey === null) {
    return (
      <p className="dl-finder" data-state="unknown">
        <KeyText messageKey="site.download.finder.unknown" />
      </p>
    );
  }
  return (
    <p className="dl-finder" data-state={confident ? 'sure' : 'ask'}>
      <span className="dl-finder__label">
        <KeyText messageKey={labelKey} />
      </span>
      {/* sure 与 ask 的区别只有一句：Mac 那一行既读不出芯片，iPad 也自称 Macintosh。 */}
      <KeyText messageKey={confident ? 'site.download.finder.sure' : 'site.download.finder.ask'} />
      {!confident && (
        <a className="dl-link" href={webHref}>
          <KeyText messageKey="site.download.finder.web" />
        </a>
      )}
    </p>
  );
}

/**
 * Hero 里的套框舞台：一台电脑 + 一台手机叠在一起。
 *
 * 屏幕内容都是**真实复现件**：桌面用 `AppWindow`（复现 `apps/web`），手机用 `MobileAppWindow`
 * （复现 `apps/mobile`），填同一份样例数据。整个舞台由 `PageHead` 的 `visual` 槽承载，
 * 那里已经 `aria-hidden`；套框本身再 `pointer-events: none`（样式在 `.dl-desktop` / `.dl-phone`）。
 */
function HeroStage(): React.JSX.Element {
  return (
    <div className="dl-hero-devices">
      <div className="dl-desktop">
        <BrowserBar />
        <div className="dl-desktop__screen">
          <AppWindow view="tasks" />
        </div>
      </div>
      <div className="dl-phone dl-phone--hero">
        <span className="dl-phone__island" aria-hidden="true" />
        <div className="dl-phone__screen">
          <MobileAppWindow view="tasks" />
        </div>
      </div>
    </div>
  );
}

/** 电脑套框的浏览器条：三颗窗点 + 地址胶囊。 */
function BrowserBar(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="dl-browser" aria-hidden="true">
      <span className="dl-browser__dots">
        <i />
        <i />
        <i />
      </span>
      <span className="dl-browser__addr">{t('common.brand')}</span>
    </div>
  );
}

function DownloadCard({
  resolved,
  recommended,
  version,
  releasedAt,
  locale,
  cta,
  selfHostHref,
}: {
  readonly resolved: ResolvedRow;
  readonly recommended: boolean;
  readonly version: string;
  readonly releasedAt: string;
  readonly locale: 'zh-CN' | 'en';
  readonly cta: ReturnType<typeof siteCta>;
  readonly selfHostHref: string;
}): React.JSX.Element {
  const { row } = resolved;
  const Icon = ROW_ICONS[row.id] ?? Globe;
  const hasExit =
    resolved.state === 'file-ready' ||
    resolved.state === 'store' ||
    resolved.state === 'open' ||
    resolved.state === 'guide';

  return (
    <li
      id={`dl-${row.id}`}
      className="dl-card"
      data-state={resolved.state}
      {...(recommended ? { 'data-recommended': 'true' } : {})}
    >
      <span className="dl-card__icon" aria-hidden="true">
        <Icon size={ICON_SIZE.md} />
      </span>

      <div className="dl-card__main">
        <div className="dl-card__head">
          <h2 className="lp-h2 dl-card__name">
            <KeyText messageKey={row.labelKey} />
          </h2>
          {recommended ? (
            <span className="dl-card__pick">
              <KeyText messageKey="site.download.pick" />
            </span>
          ) : null}
        </div>

        <p className="lp-prose dl-card__body">
          <KeyText messageKey={row.bodyKey} />
        </p>

        {row.archKey === undefined ? null : (
          <p className="dl-arch">
            <KeyText messageKey="site.download.arch" />
            <KeyText messageKey={row.archKey} />
          </p>
        )}

        {resolved.state === 'file-ready' ? (
          <FileMeta file={resolved.file} version={version} releasedAt={releasedAt} locale={locale} />
        ) : null}

        {resolved.state === 'pending' || resolved.state === 'none' ? (
          <p className="dl-gap">
            <KeyText messageKey={row.gapKey} />
          </p>
        ) : null}

        {row.caveatKey !== undefined && hasExit ? (
          <p className="dl-caveat">
            <KeyText messageKey={row.caveatKey} />
          </p>
        ) : null}
      </div>

      <div className="dl-card__action">
        {resolved.state === 'file-ready' ? (
          <a className="lp-btn lp-btn--primary" href={resolved.file.url} rel="noopener noreferrer">
            <KeyText messageKey="site.download.get" />
          </a>
        ) : null}
        {resolved.state === 'store' ? (
          <a
            className="lp-btn lp-btn--primary"
            href={resolved.channel.url}
            rel="noopener noreferrer"
          >
            <KeyText messageKey="site.download.join" />
          </a>
        ) : null}
        {resolved.state === 'open' ? (
          <a
            className="lp-btn lp-btn--primary"
            href={cta.href}
            {...(cta.external ? { rel: 'noopener noreferrer' } : {})}
          >
            <KeyText messageKey={cta.labelKey} />
          </a>
        ) : null}
        {resolved.state === 'guide' ? (
          <a className="lp-btn lp-btn--secondary" href={selfHostHref}>
            <KeyText messageKey="site.download.selfhost.cta" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** 一个真存在的文件：名称、大小、版本、发布时间、校验值都要能在页面上核对。 */
function FileMeta({
  file,
  version,
  releasedAt,
  locale,
}: {
  readonly file: ReleaseFile;
  readonly version: string;
  readonly releasedAt: string;
  readonly locale: 'zh-CN' | 'en';
}): React.JSX.Element {
  return (
    <div className="dl-filemeta">
      <dl className="dl-meta">
        <div className="dl-meta__row">
          <dt>
            <KeyText messageKey="site.download.meta.file" />
          </dt>
          <dd className="dl-meta__name">{file.name}</dd>
        </div>
        <div className="dl-meta__row">
          <dt>
            <KeyText messageKey="site.download.meta.version" />
          </dt>
          <dd>{version}</dd>
        </div>
        <div className="dl-meta__row">
          <dt>
            <KeyText messageKey="site.download.meta.size" />
          </dt>
          {/* 舍入过的数字不能用来核对文件，所以精确字节数并排给出。 */}
          <dd>
            {formatSize(file.size)} · {file.size.toLocaleString('en-US')} B
          </dd>
        </div>
        <div className="dl-meta__row">
          <dt>
            <KeyText messageKey="site.download.meta.released" />
          </dt>
          <dd>
            <time dateTime={releasedAt}>{formatReleaseDate(releasedAt, locale)}</time>
          </dd>
        </div>
      </dl>
      <details className="dl-hash">
        <summary>
          <KeyText messageKey="site.download.meta.hash" />
        </summary>
        <code className="dl-hash__value">{file.sha256}</code>
      </details>
    </div>
  );
}

/**
 * 「各端的样子」：桌面端（macOS / Windows / Linux 同一个桌面壳）与移动端（iOS / Android 同一个手机壳）
 * 各用一台真实复现件展示，交错排布。每屏配一句标题 + 说明。
 */
function ScreensShowcase(): React.JSX.Element {
  return (
    <section className="dl-gallery" aria-labelledby="dl-gallery-title">
      <header className="dl-gallery__head">
        <h2 id="dl-gallery-title" className="lp-h2 dl-h2">
          <KeyText messageKey="site.download.screens.title" />
        </h2>
        <p className="lp-prose">
          <KeyText messageKey="site.download.screens.lede" />
        </p>
      </header>

      <div className="dl-gallery__grid">
        <figure className="dl-gallery__item dl-gallery__item--wide">
          <div className="dl-desktop" aria-hidden="true">
            <BrowserBar />
            <div className="dl-desktop__screen">
              <AppWindow view="tasks" />
            </div>
          </div>
          <figcaption className="dl-gallery__cap">
            <h3 className="dl-gallery__cap-title">
              <KeyText messageKey="site.download.screens.desktop.title" />
            </h3>
            <p className="dl-gallery__cap-body">
              <KeyText messageKey="site.download.screens.desktop.body" />
            </p>
          </figcaption>
        </figure>

        <GalleryPhone
          view="tasks"
          stagger="s1"
          titleKey="site.download.screens.today.title"
          bodyKey="site.download.screens.today.body"
        />

        <GalleryPhone
          view="quadrant"
          stagger="s2"
          titleKey="site.download.screens.quadrant.title"
          bodyKey="site.download.screens.quadrant.body"
        />

        <figure className="dl-gallery__item dl-gallery__item--wide">
          <div className="dl-desktop" aria-hidden="true">
            <BrowserBar />
            <div className="dl-desktop__screen">
              <AppWindow view="timeline" />
            </div>
          </div>
          <figcaption className="dl-gallery__cap">
            <h3 className="dl-gallery__cap-title">
              <KeyText messageKey="site.download.screens.habits.title" />
            </h3>
            <p className="dl-gallery__cap-body">
              <KeyText messageKey="site.download.screens.habits.body" />
            </p>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function GalleryPhone({
  view,
  stagger,
  titleKey,
  bodyKey,
}: {
  readonly view: MobileMockView;
  readonly stagger: 's1' | 's2';
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
}): React.JSX.Element {
  return (
    <figure className={`dl-gallery__item dl-gallery__item--${stagger}`}>
      <div className="dl-phone dl-phone--card" aria-hidden="true">
        <span className="dl-phone__island" />
        <div className="dl-phone__screen">
          <MobileAppWindow view={view} />
        </div>
      </div>
      <figcaption className="dl-gallery__cap">
        <h3 className="dl-gallery__cap-title">
          <KeyText messageKey={titleKey} />
        </h3>
        <p className="dl-gallery__cap-body">
          <KeyText messageKey={bodyKey} />
        </p>
      </figcaption>
    </figure>
  );
}

/** 三步开始。 */
function StepsSection(): React.JSX.Element {
  const steps = [1, 2, 3] as const;
  return (
    <section className="dl-steps" aria-labelledby="dl-steps-title">
      <h2 id="dl-steps-title" className="lp-h2 dl-h2">
        <KeyText messageKey="site.download.steps.title" />
      </h2>
      <ol className="dl-steps__grid">
        {steps.map((index) => (
          <li key={index} className="dl-step">
            <span className="dl-step__index" aria-hidden="true">
              {String(index).padStart(2, '0')}
            </span>
            <h3 className="dl-step__title">
              <KeyText messageKey={`site.download.steps.${index}.title` as MessageKey} />
            </h3>
            <p className="dl-step__body">
              <KeyText messageKey={`site.download.steps.${index}.body` as MessageKey} />
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * 安全与校验：「页面上这个版本号是从哪来的」。
 *
 * 没有这一块，`1.0.0` 就是一个无来源的数字：访客无法判断它是否与桶里那份字节同一轮，
 * 而我们自己在评审时也看不出它漂了。
 */
function VerifyBlock({
  version,
  releasedAt,
  locale,
}: {
  readonly version: string;
  readonly releasedAt: string;
  readonly locale: 'zh-CN' | 'en';
}): React.JSX.Element {
  return (
    <section id="verify" className="dl-verify" aria-labelledby="dl-verify-title">
      <h2 id="dl-verify-title" className="lp-h2 dl-h2">
        <KeyText messageKey="site.download.verify.title" />
      </h2>
      <p className="lp-prose">
        <KeyText messageKey="site.download.verify.body" />
      </p>
      <p className="dl-verify__official">
        <KeyText messageKey="site.download.verify.official" />
      </p>
      <p className="dl-verify__stamp">
        <KeyText messageKey="site.download.verify.channel" />
        <code>{version}</code>
        <KeyText messageKey="site.download.verify.at" />
        <time dateTime={releasedAt}>{formatReleaseDate(releasedAt, locale)}</time>
      </p>
    </section>
  );
}
