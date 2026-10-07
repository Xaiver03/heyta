/**
 * `/download`：获取 heyta —— 只给点得动的出口
 * ==============================================
 *
 * 判据本体在 `src/site/downloads.ts`（一张表 + 一份清单）。这一文件只画东西。
 *
 * 🔴 三条不许：
 *   1. 不许在这里出现任何一条 URL —— 直链只能来自发布清单（`scripts/check-downloads.mjs` 的臂 A 抓这条）；
 *   2. 不许给 `pending` / `none` 那一档画带"下载"字样的按钮 —— 点了 404 的按钮比没有按钮更坏，
 *      它花掉的是访客对整站其它说法的信任（`e2e/landing/platforms-install-claim.spec.ts`
 *      在 `/platforms` 那一侧盯的是同一件事）；
 *   3. 不许让系统识别**隐藏**别的行 —— 识别只挑一个推荐位，全表照旧排在下面（OBS/VS Code 同形）。
 */

import { useI18n, useLocale, type MessageKey } from '@heyta/i18n/provider';

import '../styles/download.css';

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

  return (
    <SiteSubPage page={page} sections={[]}>
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
  const { row, state } = resolved;

  return (
    <li
      id={`dl-${row.id}`}
      className="dl-card"
      data-state={state}
      {...(recommended ? { 'data-recommended': 'true' } : {})}
    >
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

      <p className="lp-prose">
        <KeyText messageKey={row.bodyKey} />
      </p>

      {row.archKey === undefined ? null : (
        <p className="dl-arch">
          <KeyText messageKey="site.download.arch" />
          <KeyText messageKey={row.archKey} />
        </p>
      )}

      {state === 'file-ready' ? (
        <FileExit
          file={resolved.file}
          version={version}
          releasedAt={releasedAt}
          locale={locale}
          caveatKey={row.caveatKey}
        />
      ) : null}

      {state === 'store' ? (
        <a className="lp-btn lp-btn--primary" href={resolved.channel.url} rel="noopener noreferrer">
          <KeyText messageKey="site.download.join" />
        </a>
      ) : null}

      {state === 'open' ? (
        <a
          className="lp-btn lp-btn--primary"
          href={cta.href}
          {...(cta.external ? { rel: 'noopener noreferrer' } : {})}
        >
          <KeyText messageKey={cta.labelKey} />
        </a>
      ) : null}

      {state === 'guide' ? (
        <a className="lp-btn lp-btn--secondary" href={selfHostHref}>
          <KeyText messageKey="site.download.selfhost.cta" />
        </a>
      ) : null}

      {state === 'pending' || state === 'none' ? (
        <p className="dl-gap">
          <KeyText messageKey={row.gapKey} />
        </p>
      ) : null}
    </li>
  );
}

/** 一个真存在的文件：名称、大小、版本、发布时间、校验值都要能在页面上核对。 */
function FileExit({
  file,
  version,
  releasedAt,
  locale,
  caveatKey,
}: {
  readonly file: ReleaseFile;
  readonly version: string;
  readonly releasedAt: string;
  readonly locale: 'zh-CN' | 'en';
  readonly caveatKey?: MessageKey;
}): React.JSX.Element {
  return (
    <div className="dl-exit">
      <a className="lp-btn lp-btn--primary" href={file.url}>
        <KeyText messageKey="site.download.get" />
      </a>
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
      {caveatKey === undefined ? null : (
        <p className="dl-caveat">
          <KeyText messageKey={caveatKey} />
        </p>
      )}
    </div>
  );
}

/**
 * 「页面上这个版本号是从哪来的」。
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
    <section id="verify" className="lp-row dl-verify">
      <h2 className="lp-h2">
        <KeyText messageKey="site.download.verify.title" />
      </h2>
      <p className="lp-prose">
        <KeyText messageKey="site.download.verify.body" />
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
