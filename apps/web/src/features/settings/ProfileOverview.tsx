/**
 * 个人中心概览（不是个人资料编辑页）。
 *
 * 这里故意只做三件事：身份摘要、近期状态、成就预览。昵称/头像的写入仍由
 * `ProfilePanel` 负责，完整成长仍由 `GrowthView` 负责。这样头像菜单、设置和成长
 * 只有一条事实链，也不会因为再造一个页面而产生第二套统计口径。
 */
import { useMemo } from 'react';
import { ArrowRight, ChevronRight, LockKeyhole, LogOut, Settings2, UserRoundPen } from 'lucide-react';

import { HEYTA_APP_VERSION } from '@heyta/app-host';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';

import { SettingsInfoTip } from './SettingsInfoTip.js';
import { useTaskStore } from '../tasks/store.js';
import { useSyncStore } from '../sync/store.js';
import { useAccountIdentity } from './useAccountIdentity.js';
import { selectMilestones, selectWeeklyReview } from '../motivation/selectors.js';
import { growthBoardLabels } from '../motivation/GrowthView.js';
import { Button } from '../../components/hta/index.js';

export function ProfileOverview({
  onEditProfile,
  onOpenSettings,
  onOpenGrowth,
  onSignOut,
  growthEnabled = false,
}: {
  onEditProfile: () => void;
  onOpenSettings: () => void;
  onOpenGrowth: () => void;
  /**
   * 退出登录。R13a 定的主入口在这里（我的页最后一位）；头像菜单那条已删。
   * 不传就不渲染 —— 独立设置窗口之类没有账号面的宿主不该出现这个按钮。
   */
  onSignOut?: (() => void) | undefined;
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
    <div className="ht-settings__profile" data-testid="profile-center">
      <section className="ht-settings__profile-identity" aria-labelledby="profile-center-identity-title">
        <div className="ht-settings__profile-avatar" aria-hidden="true">
          {identity.avatarDataUri === undefined
            ? identity.initial ?? <UserRoundPen size={ICON_SIZE.lg} />
            : <img src={identity.avatarDataUri} alt="" />}
        </div>
        <div className="ht-settings__profile-identity-copy">
          <h2 className="ht-type-section-title" id="profile-center-identity-title">
            {identity.displayName ?? identity.email ?? t('web.profile.overview.local')}
            {/*
              这句解释的是这一节本身（"这台设备上的资料不会上传"），所以挂在节标题旁 ——
              原来它排在状态行之后当独立一块，屏幕上是一枚没有归属的问号。
            */}
            <SettingsInfoTip
              testId="tip-profile-local-only"
              label={t('web.profile.overview.title')}
              text={t('web.profile.overview.localOnly')}
            />
          </h2>
          {identity.displayName && identity.email ? (
            <p className="ht-settings__profile-note" role="status">{identity.email}</p>
          ) : null}
          <p className="ht-settings__profile-status">
            <LockKeyhole size={ICON_SIZE.xs} aria-hidden="true" />
            {signedIn ? t('web.profile.overview.signedIn') : t('web.profile.overview.local')}
          </p>
          {identity.status === 'loading' ? (
            <p className="ht-settings__profile-note" role="status">
              {t('web.profile.overview.identityLoading')}
            </p>
          ) : identity.status === 'error' ? (
            <div className="ht-settings__profile-note" role="status">
              <span>{t('web.profile.overview.identityUnavailable')}</span>{' '}
              <Button
                tone="ghost"
                data-testid="profile-center-identity-retry"
                onClick={identity.retry}
              >
                {t('web.profile.overview.identityRetry')}
              </Button>
            </div>
          ) : null}
          {identity.avatarState === 'unreadable' ? (
            <p className="ht-settings__profile-note" role="status">
              {t('common.profile.avatar.unreadable')}
            </p>
          ) : null}
        </div>
        {signedIn ? (
          <Button tone="ghost" onClick={onEditProfile}>
            <UserRoundPen size={ICON_SIZE.sm} aria-hidden="true" />
            {t('web.profile.overview.edit')}
          </Button>
        ) : null}
      </section>

      <section className="ht-settings__profile-section" aria-labelledby="profile-center-recent-title">
        <div className="ht-settings__profile-section-heading">
          <h2 className="ht-type-section-title" id="profile-center-recent-title">
            {t('web.profile.overview.recent')}
          </h2>
        </div>
        <div className="ht-settings__profile-stats">
          {[
            { key: 'tasks', value: review.tasksCompleted, label: t('web.profile.overview.tasks') },
            { key: 'focus', value: review.focusMinutes, label: t('web.profile.overview.focus') },
            { key: 'checkIns', value: review.checkIns, label: t('web.profile.overview.checkIns') },
          ].map((stat) => {
            /*
              三个数字都是「本周回顾」的入口：点任意一格进入完整明细（成长视图里
              同一份 `selectWeeklyReview` 投影出本周/上周对照、专注最久的一天、
              完成最多的清单，另含里程碑、热力图与分类时长）。成长模块关闭时退回
              纯读数，不提供绕过开关的深链。
            */
            const body = (
              <>
                <span className="ht-settings__profile-value">{stat.value}</span>
                <span className="ht-settings__profile-stat-label">
                  <span className="ht-settings__profile-label">{stat.label}</span>
                  {growthEnabled ? (
                    <ChevronRight size={ICON_SIZE.xs} aria-hidden="true" />
                  ) : null}
                </span>
              </>
            );
            return growthEnabled ? (
              <button
                key={stat.key}
                type="button"
                className="ht-settings__profile-stat ht-settings__profile-stat--action"
                data-testid={`profile-center-stat-${stat.key}`}
                onClick={onOpenGrowth}
              >
                {body}
              </button>
            ) : (
              <div key={stat.key} className="ht-settings__profile-stat">
                {body}
              </div>
            );
          })}
        </div>
      </section>

      {growthEnabled ? (
        <section className="ht-settings__profile-section" aria-labelledby="profile-center-achievements-title">
          <div className="ht-settings__profile-section-heading">
            <div>
              <h2 className="ht-type-section-title" id="profile-center-achievements-title">
                {t('web.profile.overview.achievements')}
                <SettingsInfoTip
                  testId="tip-profile-achievements"
                  label={t('web.profile.overview.achievements')}
                  text={t('web.profile.overview.achievementsHint')}
                />
              </h2>
            </div>
            <Button
              tone="ghost" className="ht-settings__profile-achievement-action"
              data-testid="profile-center-growth"
              onClick={onOpenGrowth}
            >
              <ArrowRight size={ICON_SIZE.sm} aria-hidden="true" />
              {t('web.profile.overview.growth')}
            </Button>
          </div>
          <div className="ht-settings__profile-achievement" data-testid="profile-achievements">
            <span className="ht-settings__profile-value">
              {reachedMilestones}/{milestones.length}
            </span>
            <div className="ht-settings__profile-achievement-copy">
              <span className="ht-settings__profile-label">
                {nextMilestone === undefined
                  ? labels.milestones.maxed
                  : labels.milestones.next({
                      threshold: nextMilestone.threshold,
                      unit: labels.milestones.kindUnit?.(nextMilestone.kind) ?? '',
                      gap: Math.max(0, nextMilestone.threshold - nextMilestone.value),
                    })}
              </span>
              <span className="ht-settings__profile-note" role="status">
                {nextMilestone === undefined
                  ? t('web.profile.overview.achievements')
                  : labels.milestones.kindName(nextMilestone.kind)}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <nav className="ht-settings__profile-actions" aria-label={t('web.profile.overview.title')}>
        <Button
          tone="ghost"
          data-testid="profile-center-settings"
          onClick={onOpenSettings}
        >
          <Settings2 size={ICON_SIZE.sm} aria-hidden="true" />
          {t('web.profile.overview.settings')}
        </Button>
      </nav>

      {/*
        🔴 最后两位是「版本 / 退出」（R13a）。它们是"找得到"的锚点：不管上面长了多少内容，
        这两块永远在最后。版本号读 `@heyta/app-host` 的生成物（真源是根 package.json，
        `check:app-version` 盯着），**不许在这里写死**；也**不做**「检查更新」按钮 ——
        `web.about.updateNote` 明写这个版本没有该按钮。
      */}
      <section className="ht-settings__profile-section" aria-labelledby="profile-center-version-title">
        <div className="ht-settings__profile-section-heading">
          <h2 className="ht-type-section-title" id="profile-center-version-title">
            {t('web.profile.overview.version')}
          </h2>
        </div>
        <p className="ht-settings__profile-note" data-testid="profile-center-version">
          {`heyta ${HEYTA_APP_VERSION}`}
        </p>
      </section>

      {signedIn && onSignOut !== undefined ? (
        <div className="ht-settings__profile-actions">
          <Button
            tone="danger"
            data-testid="profile-center-signout"
            onClick={onSignOut}
          >
            <LogOut size={ICON_SIZE.sm} aria-hidden="true" />
            {t('web.shell.account.signOut')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
