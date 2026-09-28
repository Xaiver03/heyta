/**
 * 今日进度条（Web 壳的接线层，L1）
 * ==================================
 *
 * 🔴 M3 第十一刀之后，卡片本身来自 `@heyta/ui`（与 mobile 同一份实现），
 * 这里**只剩接线**：投影从哪来、文案从哪来、Provider 包在哪。
 *
 * 为什么不把这段直接写进 `App.tsx`：`App.tsx` 是外壳（L3），而这张卡是
 * **跨视图常驻**的一块激励视图。放在 `features/motivation/` 与
 * `HabitsView` / `CategoryBreakdown` 的接线层同一个位置，
 * `check:ui-provider` 也能顺着相对 import 找到它（Provider 在同一个文件里）。
 *
 * ⚠️ 迁移前的 `TodayProgressCard.tsx`（180 行 DOM/CSS）**已删** ——
 * 这份接线的宿主侧文案统一在 `./labels.js`，不在这里再造一份。
 *
 * ⚠️ `HeytaUiProvider` 必须包在**这一处**：它渲染的 `TodayProgressCard` 会
 * `useHeytaTokens()`，缺了会**运行时抛错**而类型与单测都不红
 * （`check:ui-provider` 拦这个）。别把它提到 `App.tsx` 之后又忘了对应关系。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n';
import { HeytaUiProvider, TodayProgressCard } from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';
import { todayProgressLabels } from './labels.js';
import { selectTodayProgress } from './selectors.js';

export function TodayProgressBanner() {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const now = useTaskStore((s) => s.now);

  const progress = selectTodayProgress(entities, now);
  const labels = useMemo(() => todayProgressLabels(t), [t]);

  return (
    <HeytaUiProvider>
      {/*
        ⚠️ 共享卡片自身**不带**区域名（它不知道自己是"今日进度"还是别的什么），
        所以这层 `aria-label` 由宿主给 —— 迁移前 `.ht-today` 上就有它。
      */}
      <section aria-label={t('web.progress.aria')}>
        <TodayProgressCard progress={progress} labels={labels} testID="today-progress" />
      </section>
    </HeytaUiProvider>
  );
}
