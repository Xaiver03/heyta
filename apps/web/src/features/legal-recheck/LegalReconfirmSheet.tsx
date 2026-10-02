/**
 * 账号级"重新确认"面板（web 外壳，G-27）
 * ====================================
 *
 * 形态沿用 `privacy/PrivacyConsentSheet.tsx`（置顶、遮罩、`role="dialog"` +
 * `aria-modal`、链接排在按钮**外面**），但**动作集不同**，而那处不同是全部的要点：
 *
 * ## 🔴 这里没有「只用本机」
 *
 * 隐私面板必须给两个**同等可达**的动作，因为"不同意"是一个合法决定（PIPL 第 16 条）；
 * 而"文本更新了要不要重新确认"不是一个可以选择同意的方向 —— 它是那句已经对外
 * 说出去的话（`packages/legal/src/documents/terms.ts` s10）在要求一次动作。
 * 在这里摆一个"不同意"，要么它什么都不做（那是骗人的按钮），要么它把用户永久锁在
 * 用不了的账号上（那是《认定方法》点名的"不同意即无法使用"）。
 * 所以：**一个肯定动作 + 一条明确的"稍后再说"**。
 *
 * ## 🔴 但"稍后再说"必须说清它不放开闸门
 *
 * 只留一个按钮、不给出口，会造出一种新的坏：确认要发一次请求，而**离线时它发不出去** ——
 * 那时一个不可关的面板就是把整个应用锁死，而 heyta 的立场是本地数据永远可读可用。
 * 所以这条出口是**推迟**，不是**拒绝**：词条把后果写在按钮上（"继续不同步"），
 * 闸门保持关闭（判据在 `tests/legal-reconfirm-sheet.spec.tsx`），
 * 而启动与每次登录都会重新问一遍 —— 它不会被"点掉"就消失。
 *
 * ## 为什么确认失败时面板不收起
 *
 * 与隐私面板那句"落盘失败不许静默"同一条纪律：`store.ts` 的 `confirm()` 在闸门仍然
 * 拦着时**保持打开**，并把失败按结构化原因翻成一句人话。收起来就等于"点了没反应"。
 *
 * ## 样式为什么在 `styles/app/sheets.css` 里，而排版为什么不在
 *
 * `check:l4` 的判据是"features 里的内联样式 `style={{…}}` 只减不增"，且明写不许为了
 * 变绿把基线调高 —— 所以布局与颜色搬进了 CSS，取值全部来自 token（CSS 变量）。
 * 搬过去之后 `check:design` 又抓了一道：字号+字重在 CSS 里成对自拼 = "档位表外的
 * 第二套排版"，而 `sm+regular`/`base+regular` 恰好就是语义档位的取值。
 * ⇒ 排版**不写在 CSS 里**：JSX 成对挂 `.ht-type-section-title` / `-row-title` /
 * `-row-meta`（AGENTS §5 第三条"要新变量先加 token"的同一条纪律，对象是文字档位）。
 * 第三道是 `check:row-single-source` 断言 B：顶层 `ht-*` 前缀族只减不增（基线 28），
 * 所以类名挂在既有的 `.ht-sheet` 族下（`.ht-sheet__reconfirm-*`），不自开一族。
 */

import { useEffect, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { resolveLegalLinks } from '@heyta/app-host';

import { authBaseUrl } from '../../lib/auth-endpoint.js';
import { legalRecheck } from './gate.js';
import { useLegalReconfirmStore } from './store.js';
import { useSyncStore } from '../sync/store.js';

export function LegalReconfirmSheet(): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const open = useLegalReconfirmStore((s) => s.open);
  const reason = useLegalReconfirmStore((s) => s.reason);
  const submitting = useLegalReconfirmStore((s) => s.submitting);
  const confirm = useLegalReconfirmStore((s) => s.confirm);
  const defer = useLegalReconfirmStore((s) => s.defer);
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const dialogRef = useRef<HTMLDivElement>(null);
  /**
   * 闸门的状态在这里**不是** React state —— 它是订阅式的。
   * 不订阅的话，界面会在"点了确认、闸门已经放开"之后仍然显示那一句旧的拦提示。
   */
  const [failure, setFailure] = useState<ReturnType<typeof legalRecheck.current>['confirmFailure']>(
    legalRecheck.current().confirmFailure,
  );
  useEffect(() => legalRecheck.subscribe(() => setFailure(legalRecheck.current().confirmFailure)), []);

  const links = resolveLegalLinks(authBaseUrl(baseUrl), locale);

  useEffect(() => {
    if (!open) return;
    // Esc = 推迟（与那个按钮同义），不是"同意"，也不是"不同意"。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') defer();
    };
    // 🔴 捕获阶段：react-native-web 的输入框会在冒泡阶段吞掉 keydown（§7 第 80 条）。
    window.addEventListener('keydown', onKey, true);
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, defer]);

  if (!open) return null;

  const failureLine =
    failure === 'network'
      ? t('common.legal.reconfirm.failNetwork')
      : failure === 'unauthorized'
        ? t('common.legal.reconfirm.failUnauthorized')
        : failure === 'rejected'
          ? t('common.legal.reconfirm.failRejected')
          : null;

  return (
    <div role="presentation" className="ht-sheet__reconfirm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        data-testid="legal-reconfirm-dialog"
        aria-modal="true"
        aria-labelledby="ht-legal-reconfirm-title"
        className="ht-sheet__reconfirm-dialog"
      >
        <div className="ht-sheet__reconfirm-head">
          <span className="ht-sheet__reconfirm-icon">
            <ScrollText size={ICON_SIZE.md} aria-hidden="true" />
          </span>
          <div className="ht-sheet__reconfirm-titles">
            <h2 id="ht-legal-reconfirm-title" className="ht-sheet__reconfirm-title ht-type-section-title">
              {t('common.legal.reconfirm.title')}
            </h2>
            {reason === 'required-for-action' ? (
              // 用户刚点了同步，界面却拦下来 —— 不解释为什么，那看起来像坏了。
              <p className="ht-sheet__reconfirm-reason ht-type-row-meta">
                {t('common.sync.error.legalReconfirmRequired')}
              </p>
            ) : null}
          </div>
        </div>

        <p className="ht-sheet__reconfirm-intro ht-type-row-title">{t('common.legal.reconfirm.intro')}</p>

        <p className="ht-sheet__reconfirm-note ht-type-row-meta">{t('common.legal.reconfirm.localDataSafe')}</p>

        {links === null ? null : (
          <div className="ht-sheet__reconfirm-links ht-type-row-meta">
            <span className="ht-sheet__reconfirm-links-label">
              {t('common.legal.reconfirm.readFirst')}
            </span>
            {/* 🔴 链接排在按钮外面：链在按钮里时点链接会顺带触发那个控件（链 2 的 M3 变异抓的就是这个）。 */}
            <a
              data-testid="legal-reconfirm-terms"
              className="ht-sheet__reconfirm-link"
              href={links.terms}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('common.privacy.consent.termsLink')}
            </a>
            <a
              data-testid="legal-reconfirm-privacy"
              className="ht-sheet__reconfirm-link"
              href={links.privacy}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('common.privacy.consent.privacyLink')}
            </a>
          </div>
        )}

        {failureLine === null ? null : (
          <p
            role="status"
            data-testid="legal-reconfirm-failure"
            className="ht-sheet__reconfirm-failure ht-type-row-meta"
          >
            {failureLine}
          </p>
        )}

        <div className="ht-sheet__reconfirm-actions">
          <button
            type="button"
            data-testid="legal-reconfirm-action"
            className="ht-btn ht-btn--primary"
            disabled={submitting}
            onClick={() => void confirm()}
          >
            {submitting
              ? t('common.legal.reconfirm.pending')
              : t('common.legal.reconfirm.action')}
          </button>
          {/* 🔴 一条**从属**的文字按钮，不是与上面同等的第二个决定：
              它的语义是"推迟"，措辞里必须自带后果（"继续不同步"），
              否则它会读起来像"不同意"，而这里没有"不同意"这个选项。 */}
          <button
            type="button"
            data-testid="legal-reconfirm-defer"
            className="ht-btn ht-btn--ghost"
            onClick={defer}
          >
            {t('common.legal.reconfirm.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
