/**
 * 首启隐私同意面板（web 外壳）
 * ============================
 *
 * ## 它补的是哪一条
 *
 * 计划里的 **G-11**：「首次启动没有向用户征求过隐私同意」。此前全应用只有注册
 * 勾选框旁边那一句「我同意该服务端提供的服务条款与隐私政策」，也就是说
 * **只有正在注册的人才会看到条款**，而一个刚打开应用、什么都没点的人，
 * 在他的决定作出之前，Service Worker 注册与实时同步通道已经发过请求了（**G-12**）。
 *
 * ## 🔴 为什么"不同意"是一个**能走完**的选项，而不是一堵墙
 *
 * PIPL 第 16 条禁止"因个人不同意处理其个人信息……拒绝提供产品或者服务"
 * （处理该信息不构成提供产品或服务所必需的除外）。heyta 是本地优先的：
 * 数据先落本机，云端只是同步通道 —— 所以"只用本机"**不是降级模式**，
 * 是同一个完整产品的另一种用法。这个结构性理由是这条合规要求能被满足的唯一原因；
 * 少了它，下面那句"一个功能都不少"就是假话。
 *
 * ## 两条界面纪律
 *
 * 1. **链接必须点开就有内容**，所以分流交给 `resolveLegalLinks()`（链 2）：
 *    官方托管实例指向落地页 `/legal/*`，自建实例指向那台服务端自己的
 *    `/terms.html`、`/privacy.html`。⚠️ 这里**不发任何探测请求**去"看看存不存在" ——
 *    那正是本面板要拦的行为，用一个违规去换一个健壮性是错的。
 * 2. **决定没能落盘时必须说出口**（`notPersisted`）。隐私模式下 `localStorage`
 *    会静默不落地，而"点了同意、下次又问一遍"如果不说，用户读到的是"这应用在骗我"。
 *    🔴 因此这句话**不能靠收起后的界面**承担：`store.ts` 在这种情况下**不收起面板**，
 *    并把两个决定按钮换成一个确认出口。此前这里是坏的 —— 警告写在面板里，
 *    而面板在同一次点击里就 `open: false` 了，那句话**永远不会出现**。
 */

import { useEffect, useRef } from 'react';
import { ShieldCheck, X } from 'lucide-react';

import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { resolveLegalLinks } from '@heyta/app-host';

import { ICON_SIZE } from '@heyta/design-system';
import { authBaseUrl } from '../../lib/auth-endpoint.js';
import { text } from '../../lib/text.js';
import { useSyncStore } from '../sync/store.js';
import { usePrivacyStore } from './store.js';

export function PrivacyConsentSheet(): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const open = usePrivacyStore((s) => s.open);
  const reason = usePrivacyStore((s) => s.reason);
  const notPersisted = usePrivacyStore((s) => s.notPersisted);
  const closeSheet = usePrivacyStore((s) => s.closeSheet);
  const accept = usePrivacyStore((s) => s.accept);
  const chooseLocalOnly = usePrivacyStore((s) => s.chooseLocalOnly);
  const acknowledgeNotPersisted = usePrivacyStore((s) => s.acknowledgeNotPersisted);
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * 条款链接的分流（链 2）。
   *
   * 🔴 用 `authBaseUrl(baseUrl)` 而不是裸 `baseUrl`：那一条的唯一职责就是回答
   * "这次要发给哪台服务端"（`VITE_SYNC_URL` → 已配置地址 → 当前来源），
   * 而面板必须在用户**还没配过任何东西**的时候就能给出可读的条款 ——
   * 官方托管的用户不该被要求先知道自家服务器域名才能读到政策。
   * ⚠️ 这里只是**拼字符串**，一个请求都不发（见文件头第 1 条纪律）。
   */
  const links = resolveLegalLinks(authBaseUrl(baseUrl), locale);

  // Esc 关掉面板：决定仍然是"没问过"，闸门保持关闭 —— 关掉不等于同意。
  //
  // 🔴 挂在**捕获**阶段：`apps/web` 里的输入框（react-native-web 的 `TextInput`）
  // 会在冒泡阶段无条件 `stopPropagation()`（§7 第 80 条），本面板没有输入框，
  // 但捕获阶段让"以后往这里加个搜索框"不会把 Esc 弄丢。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, closeSheet]);

  // 打开时把焦点移进对话框 —— 否则键盘用户还停在背后那页上。
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  /**
   * 「required-for-action」时多说一句**为什么现在又弹一次**：
   * 用户刚点了同步，界面却跳出一个隐私面板 —— 不解释的话，那看起来像弹窗广告。
   */
  const whyNow =
    reason === 'required-for-action'
      ? t('common.privacy.consent.whyRequiredForAction')
      : reason === 'revoked'
        ? t('common.privacy.consent.whyRevoked')
        : null;

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: cssVar('color.overlay'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: cssVar('space.4'),
        zIndex: cssVar('z.modal'),
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        data-testid="privacy-consent-dialog"
        aria-modal="true"
        aria-labelledby="ht-privacy-title"
        style={{
          width: '100%',
          maxWidth: cssVar('layout.modal-max'),
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.4'),
          background: cssVar('color.surface-raised'),
          borderRadius: cssVar('radius.lg'),
          boxShadow: cssVar('shadow.lg'),
          padding: cssVar('space.6'),
          color: cssVar('color.foreground'),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: cssVar('space.3') }}>
          <span
            style={{ display: 'flex', color: cssVar('color.primary'), paddingTop: cssVar('space.1') }}
          >
            <ShieldCheck size={ICON_SIZE.md} aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              id="ht-privacy-title"
              style={{ margin: 0, ...text('section-title') }}
            >
              {t('common.privacy.consent.title')}
            </h2>
            {whyNow === null ? null : (
              <p
                style={{
                  margin: `${cssVar('space.1')} 0 0`,
                  ...text('row-meta'),
                  color: cssVar('color.foreground-muted'),
                }}
              >
                {whyNow}
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="privacy-consent-close"
            aria-label={t('common.privacy.consent.close')}
            className="ht-btn ht-btn--ghost"
            onClick={closeSheet}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        <p style={{ margin: 0, ...text('row-title') }}>
          {t('common.privacy.consent.intro')}
        </p>

        {/* 两条对照着摆：不同意保住什么、同意才会发出什么。
            分成两段而不是合成一句，是因为用户要比较的是两个选项，不是读一段说明。 */}
        <ul
          style={{
            margin: 0,
            padding: `0 ${cssVar('space.4')}`,
            display: 'flex',
            flexDirection: 'column',
            gap: cssVar('space.2'),
            ...text('row-meta'),
            color: cssVar('color.foreground-muted'),
            listStyle: 'disc',
          }}
        >
          <li>{t('common.privacy.consent.localOnlyGuarantee')}</li>
          <li>{t('common.privacy.consent.acceptedGuarantee')}</li>
        </ul>

        {links === null ? null : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: cssVar('space.2'),
              ...text('row-meta'),
            }}
          >
            <span style={{ color: cssVar('color.foreground-muted') }}>
              {t('common.privacy.consent.readFirst')}
            </span>
            {/* 🔴 放在 `<label>` / 按钮**外面**：链接在勾选框或按钮里时，
                点链接会顺带触发那个控件（链 2 的 M3 变异抓的就是这个）。 */}
            <a
              data-testid="privacy-consent-terms"
              href={links.terms}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: cssVar('color.primary') }}
            >
              {t('common.privacy.consent.termsLink')}
            </a>
            <a
              data-testid="privacy-consent-privacy"
              href={links.privacy}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: cssVar('color.primary') }}
            >
              {t('common.privacy.consent.privacyLink')}
            </a>
          </div>
        )}

        {notPersisted ? (
          <p
            role="status"
            style={{
              margin: 0,
              ...text('row-meta'),
              color: cssVar('color.warning-strong'),
            }}
          >
            {t('common.privacy.consent.notPersisted')}
          </p>
        ) : null}

        {notPersisted ? (
          // 🔴 决定已经生效（本次会话内闸门该开就开、该关就关），只是这台设备记不住它。
          // 这时**不再摆两个决定按钮** —— 再点一次「同意」会被读成"刚才那下没生效"，
          // 而它确实生效了。这里要的是一次确认，不是一次重新选择。
          <button
            type="button"
            data-testid="privacy-consent-acknowledge"
            className="ht-btn ht-btn--primary"
            onClick={acknowledgeNotPersisted}
          >
            {t('common.privacy.consent.acknowledge')}
          </button>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: cssVar('space.2') }}>
            {/* 🔴 两个动作**并排、同等可达**（不是"同意"是按钮、"不同意"是一行小字）：
                《认定方法》把"不同意即无法使用"与诱导同意列为违规，而 Apple 4.2 / PIPL 16
                要求拒绝与同意一样容易点。这里刻意不给「只用本机」加危险色 ——
                它不是一个惩罚选项。 */}
            <button
              type="button"
              data-testid="privacy-consent-accept"
              className="ht-btn ht-btn--primary"
              onClick={accept}
            >
              {t('common.privacy.consent.accept')}
            </button>
            <button
              type="button"
              data-testid="privacy-consent-local-only"
              className="ht-btn"
              onClick={chooseLocalOnly}
            >
              {t('common.privacy.consent.localOnly')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
