/**
 * 个人中心概览（不是个人资料编辑页）。
 *
 * 这里故意只做三件事：身份摘要、近期状态、成就预览。昵称/头像的写入仍由
 * `ProfilePanel` 负责，完整成长仍由 `GrowthView` 负责。这样头像菜单、设置和成长
 * 只有一条事实链，也不会因为再造一个页面而产生第二套统计口径。
 */
import { useMemo } from 'react';
import { ArrowRight, LockKeyhole, Settings2, UserRoundPen } from 'lucide-react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { useTaskStore } from '../tasks/store.js';
import { useSyncStore } from '../sync/store.js';
import { useAccountIdentity } from './useAccountIdentity.js';
import { selectMilestones, selectWeeklyReview } from '../motivation/selectors.js';
import { growthBoardLabels } from '../motivation/GrowthView.js';

export function ProfileOverview({
  onEditProfile,
  onOpenSettings,
  onOpenGrowth,
  growthEnabled = false,
}: {
  onEditProfile: () => void;
  onOpenSettings: () => void;
  onOpenGrowth: () => void;
  /** A disabled module must not expose a deep link into its view. */
  growthEnabled?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const identity = useAccountIdentity();
  const token = useSyncStore((state) => state.token);
  const entities = useTaskStore((state) => state.entities);
  const now = useTaskStore((state) => state.now);
  const review = useMemo(() => selectWeeklyReview(entities, now), [entities, now]);
  const milestones = useMemo(() => selectMilestones(entities), [entities]);
  const labels = useMemo(() => growthBoardLabels(t), [t]);
  const reachedMilestones = milestones.filter((milestone) => milestone.reached).length;
  const nextMilestone = milestones.find((milestone) => !milestone.reached);

  const signedIn = token !== undefined && token !== '';

  return (
    <div className="ht-profile-overview" data-testid="profile-center">
      <section className="ht-profile-overview__identity" aria-labelledby="profile-center-identity-title">
        <div className="ht-profile-overview__avatar" aria-hidden="true">
          {identity.avatarDataUri === undefined
            ? identity.initial ?? <UserRoundPen size={ICON_SIZE.lg} />
            : <img src={identity.avatarDataUri} alt="" />}
        </div>
        <div className="ht-profile-overview__identity-copy">
          <h2 className="ht-type-section-title" id="profile-center-identity-title">
            {identity.displayName ?? identity.email ?? t('web.profile.overview.local')}
          </h2>
          {identity.displayName && identity.email ? (
            <p className="ht-profile-overview__note">{identity.email}</p>
          ) : null}
          <p className="ht-profile-overview__status">
            <LockKeyhole size={ICON_SIZE.xs} aria-hidden="true" />
            {signedIn ? t('web.profile.overview.signedIn') : t('web.profile.overview.local')}
          </p>
          {identity.status === 'loading' ? (
            <p className="ht-profile-overview__note" role="status">
              {t('web.profile.overview.identityLoading')}
            </p>
          ) : identity.status === 'error' ? (
            <div className="ht-profile-overview__note" role="status">
              <span>{t('web.profile.overview.identityUnavailable')}</span>{' '}
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="profile-center-identity-retry"
                onClick={identity.retry}
              >
                {t('web.profile.overview.identityRetry')}
              </button>
            </div>
          ) : null}
          <p className="ht-profile-overview__note">{t('web.profile.overview.localOnly')}</p>
          {identity.avatarState === 'needs-password' ? (
            <p className="ht-profile-overview__note">{t('common.profile.avatar.needPassword')}</p>
          ) : identity.avatarState === 'undecryptable' || identity.avatarState === 'unreadable' ? (
            <p className="ht-profile-overview__note">{t('common.profile.avatar.unreadable')}</p>
          ) : null}
        </div>
        {signedIn ? (
          <button type="button" className="ht-btn ht-btn--ghost" onClick={onEditProfile}>
            <UserRoundPen size={ICON_SIZE.sm} aria-hidden="true" />
            {t('web.profile.overview.edit')}
          </button>
        ) : null}
      </section>

      <section className="ht-profile-overview__section" aria-labelledby="profile-center-recent-title">
        <div className="ht-profile-overview__section-heading">
          <h2 className="ht-type-section-title" id="profile-center-recent-title">
            {t('web.profile.overview.recent')}
          </h2>
        </div>
        <div className="ht-profile-overview__stats">
          <div className="ht-profile-overview__stat">
            <span className="ht-profile-overview__value">{review.tasksCompleted}</span>
            <span className="ht-profile-overview__label">{t('web.profile.overview.tasks')}</span>
          </div>
          <div className="ht-profile-overview__stat">
            <span className="ht-profile-overview__value">{review.focusMinutes}</span>
            <span className="ht-profile-overview__label">{t('web.profile.overview.focus')}</span>
          </div>
          <div className="ht-profile-overview__stat">
            <span className="ht-profile-overview__value">{review.checkIns}</span>
            <span className="ht-profile-overview__label">{t('web.profile.overview.checkIns')}</span>
          </div>
        </div>
      </section>

      {growthEnabled ? (
        <section className="ht-profile-overview__section" aria-labelledby="profile-center-achievements-title">
          <div className="ht-profile-overview__section-heading">
            <div>
              <h2 className="ht-type-section-title" id="profile-center-achievements-title">
                {t('web.profile.overview.achievements')}
              </h2>
              <p className="ht-profile-overview__note">{t('web.profile.overview.achievementsHint')}</p>
            </div>
            <button
              type="button"
              className="ht-btn ht-btn--ghost ht-profile-overview__achievement-action"
              data-testid="profile-center-growth"
              onClick={onOpenGrowth}
            >
              <ArrowRight size={ICON_SIZE.sm} aria-hidden="true" />
              {t('web.profile.overview.growth')}
            </button>
          </div>
          <div className="ht-profile-overview__achievement" data-testid="profile-achievements">
            <span className="ht-profile-overview__value">
              {reachedMilestones}/{milestones.length}
            </span>
            <div className="ht-profile-overview__achievement-copy">
              <span className="ht-profile-overview__label">
                {nextMilestone === undefined
                  ? labels.milestones.maxed
                  : labels.milestones.next({
                      threshold: nextMilestone.threshold,
                      unit: labels.milestones.kindUnit?.(nextMilestone.kind) ?? '',
                      gap: Math.max(0, nextMilestone.threshold - nextMilestone.value),
                    })}
              </span>
              <span className="ht-profile-overview__note">
                {nextMilestone === undefined
                  ? t('web.profile.overview.achievements')
                  : labels.milestones.kindName(nextMilestone.kind)}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <nav className="ht-profile-overview__actions" aria-label={t('web.profile.overview.title')}>
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="profile-center-settings"
          onClick={onOpenSettings}
        >
          <Settings2 size={ICON_SIZE.sm} aria-hidden="true" />
          {t('web.profile.overview.settings')}
        </button>
      </nav>
    </div>
  );
}
