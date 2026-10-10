import { CalendarDays, Check, Clock3 } from 'lucide-react';
import { useI18n } from '@heyta/i18n';

/** A small plan takes shape once on entry; no account data or looping attention cues. */
export function AuthPlanScene(): React.JSX.Element {
  const { t } = useI18n();
  return <aside className="ht-sheet__auth-plan" aria-hidden="true" data-testid="auth-plan-scene">
    <svg className="ht-auth-plan-backdrop" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" focusable="false">
      <g className="ht-auth-plan-backdrop-lines" fill="none" stroke="currentColor">
        <path d="M-40 580C30 470 110 530 168 394S248 270 408 212" />
        <path d="M-70 548C20 438 94 502 140 368S224 238 398 180" />
        <path d="M-100 516C10 406 78 474 112 342S200 206 388 148" />
      </g>
      <circle className="ht-auth-plan-backdrop-node" cx="167" cy="396" r="10" fill="currentColor" />
      <circle className="ht-auth-plan-backdrop-node ht-auth-plan-backdrop-node--next" cx="280" cy="244" r="5" fill="currentColor" />
    </svg>
    <div className="ht-auth-plan-intro">
      <span className="ht-sheet__auth-plan-kicker">{t('web.auth.plan.kicker')}</span>
      <h2 className="ht-type-section-title">{t('web.auth.plan.title')}</h2>
      <p className="ht-sheet__auth-plan-lead ht-type-row-meta">{t('web.auth.plan.lead')}</p>
    </div>
    <div className="ht-auth-plan-stack">
      <div className="ht-auth-plan-paper" />
      <div className="ht-sheet__auth-preview">
        <div className="ht-sheet__auth-preview-heading ht-type-headline">
          <CalendarDays /><span>{t('web.auth.plan.previewTitle')}</span>
        </div>
        <div className="ht-auth-plan-days">{Array.from({ length: 7 }, (_, i) => <span key={i} className={i === 2 ? 'ht-auth-plan-day--today' : undefined}>{String(i + 1).padStart(2, '0')}</span>)}</div>
        <div className="ht-sheet__auth-preview-row">
          <span className="ht-sheet__auth-preview-check"><Check /></span><span>{t('web.auth.plan.previewFirst')}</span>
        </div>
        <div className="ht-sheet__auth-preview-row">
          <span className="ht-sheet__auth-preview-check"><Check /></span><span>{t('web.auth.plan.previewSecond')}</span>
        </div>
        <div className="ht-sheet__auth-preview-row">
          <Clock3 /><span>{t('web.auth.plan.previewThird')}</span>
        </div>
        <div className="ht-auth-plan-progress"><span /></div>
      </div>
    </div>
    <p className="ht-sheet__auth-plan-local ht-type-caption">{t('web.auth.plan.local')}</p>
  </aside>;
}
