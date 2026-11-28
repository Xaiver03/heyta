/**
 * Web 首启欢迎 / 功能导览（#69）
 * =============================
 *
 * 移动端冷启动有一屏 `WelcomeScreen`（背景动效 + 四个功能面 + 底部动作区），
 * Web 此前**没有**任何首启导览 —— 冷启动直接进主界面。这一屏补上那一步。
 *
 * ## 复用移动端的思路，不新造文案
 *
 * 四个功能面的**标题**与**一句话**直接复用移动端已有的词条
 * （`mobile.tab.*` / `mobile.welcome.line.*`）—— 那几句已经是"只写事实、
 * 不堆说明文字"的形状（§0.2）。这里只新增三个界面动作词条（下一步 / 开始 / 跳过）。
 *
 * ## 浮层纪律
 *
 * 走共享的 `WebModalShell`（与隐私面板、冲突对话框同一张关闭策略表）：
 * 选 `modal-readonly`（只读、丢弃无代价 ⇒ 背景 / Esc / × 都是出口）。
 * 关闭即记"这台设备看过了"（`first-run.ts`），之后不再打扰。
 *
 * ⚠️ 它是**导览**，不是登录墙，也不是隐私同意层：不拦任何动作，随时可关。
 */

import { useState } from 'react';

import { BarChart3, CalendarDays, ListTodo, Timer, type LucideIcon } from 'lucide-react';

import { ICON_SIZE, cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button } from '../../components/hta/index.js';
import { WebModalShell } from '../../lib/dialog/WebModalShell.js';
import { hasSeenWelcome, markWelcomeSeen } from './first-run.js';
import { usePrivacyStore } from '../privacy/store.js';
import { wantsSignInOnLoad } from '../../lib/auth-deep-link.js';

interface Slide {
  readonly titleKey: MessageKey;
  readonly lineKey: MessageKey;
  readonly icon: LucideIcon;
}

const SLIDES: readonly Slide[] = [
  { titleKey: 'mobile.tab.tasks', lineKey: 'mobile.welcome.line.tasks', icon: ListTodo },
  { titleKey: 'mobile.tab.calendar', lineKey: 'mobile.welcome.line.calendar', icon: CalendarDays },
  { titleKey: 'mobile.tab.focus', lineKey: 'mobile.welcome.line.focus', icon: Timer },
  { titleKey: 'mobile.tab.categories', lineKey: 'mobile.welcome.line.stats', icon: BarChart3 },
];

export function WelcomeTour(): React.JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(() => !hasSeenWelcome());
  const [index, setIndex] = useState(0);
  // 隐私同意未处理时导览让位：两者都是 z.modal 浮层，导览盖住隐私同意会让用户无法先同意（先合规、后引导）。
  const privacyOpen = usePrivacyStore((s) => s.open);
  // 登录深链落地不弹导览：用户意图是登录，导览会盖住登录面板（同意落下后尤其会回来盖住）。
  const signinIntent = wantsSignInOnLoad();

  if (!open || privacyOpen || signinIntent) return null;

  const close = (): void => {
    markWelcomeSeen();
    setOpen(false);
  };

  const slide = SLIDES[index] ?? SLIDES[0]!;
  const Icon = slide.icon;
  const last = index === SLIDES.length - 1;

  return (
    <WebModalShell
      policy="modal-readonly"
      testId="welcome-tour"
      labelledBy="welcome-tour-title"
      onCancel={close}
      overlayStyle={{
        position: 'fixed',
        inset: 0,
        background: cssVar('color.overlay'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: cssVar('space.4'),
        zIndex: cssVar('z.modal'),
      }}
      dialogStyle={{
        width: '100%',
        maxWidth: cssVar('layout.modal-max'),
        display: 'flex',
        flexDirection: 'column',
        gap: cssVar('space.4'),
        background: cssVar('color.surface-raised'),
        borderRadius: cssVar('radius.dialog'),
        boxShadow: cssVar('shadow.lg'),
        padding: cssVar('space.6'),
        color: cssVar('color.foreground'),
      }}
    >
      <h2 id="welcome-tour-title" className="ht-type-section-title">
        {t('web.welcome.title')}
      </h2>

      <div
        data-testid="welcome-slide"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: cssVar('space.3'),
          padding: `${cssVar('space.6')} 0`,
          textAlign: 'center',
        }}
      >
        <Icon size={ICON_SIZE.xl} aria-hidden="true" color={cssVar('color.primary')} />
        <p className="ht-type-row-title">{t(slide.titleKey)}</p>
        <p className="ht-type-body" style={{ color: cssVar('color.foreground-muted') }}>
          {t(slide.lineKey)}
        </p>
      </div>

      {/* 圆点：跟当前这一张走（与移动端同一套形状）。 */}
      <div style={{ display: 'flex', gap: cssVar('space.2'), justifyContent: 'center' }} aria-hidden="true">
        {SLIDES.map((item, i) => (
          <span
            key={item.titleKey}
            style={{
              width: cssVar('space.2'),
              height: cssVar('space.2'),
              borderRadius: cssVar('radius.full'),
              background: i === index ? cssVar('color.primary') : cssVar('color.border-strong'),
              opacity: i === index ? 1 : 0.5,
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: cssVar('space.2') }}>
        <Button tone="ghost" data-testid="welcome-skip" onClick={close}>
          {t('web.welcome.skip')}
        </Button>
        <Button
          tone="primary"
          data-testid={last ? 'welcome-start' : 'welcome-next'}
          onClick={() => {
            if (last) close();
            else setIndex((i) => i + 1);
          }}
        >
          {last ? t('web.welcome.start') : t('web.welcome.next')}
        </Button>
      </div>
    </WebModalShell>
  );
}
