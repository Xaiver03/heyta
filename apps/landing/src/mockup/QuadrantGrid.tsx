/**
 * 真实界面复现：四象限（艾森豪威尔矩阵）
 * ========================================
 *
 * 复现对象：`apps/web/src/features/quadrant/QuadrantBoard.tsx`。
 *
 * 🔴 象限的**两个名字都要保留** —— 这是产品里刻意的一处设计：
 *   - 大标题是行动指令（「马上做」），回答"我现在该干什么"
 *   - 小字是象限定义（「重要且紧急」），回答"为什么它在这一格"
 * 只留一个的话，要么用户不知道判断标准，要么得自己把标准翻译成行动。
 *
 * 取值全部走 `color.quadrant-*` 语义 token，**不碰原始色阶** ——
 * 换色系时象限语义不变，组件不用改（MASTER.md 规则 2）。
 */

import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

interface Quadrant {
  title: string;
  hint: string;
  swatch: string;
  cards: string[];
}

export function QuadrantGrid(): React.JSX.Element {
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const quadrants = useMemo<Quadrant[]>(
    () => [
      {
        title: t('landing.quadrant.do'),
        hint: t('landing.quadrant.q1'),
        swatch: 'mk-swatch--q1',
        cards: [t('landing.mock.task.quote'), t('landing.mock.task.weeklyReport')],
      },
      {
        title: t('landing.quadrant.plan'),
        hint: t('landing.quadrant.q2'),
        swatch: 'mk-swatch--q2',
        cards: [
          t('landing.mock.task.q4Draft'),
          t('landing.mock.task.bookChapter'),
          t('landing.mock.task.quarterlyReview'),
        ],
      },
      {
        title: t('landing.quadrant.delegate'),
        hint: t('landing.quadrant.q3'),
        swatch: 'mk-swatch--q3',
        cards: [t('landing.mock.task.dentist')],
      },
      {
        title: t('landing.quadrant.drop'),
        hint: t('landing.quadrant.q4'),
        swatch: 'mk-swatch--q4',
        cards: [],
      },
    ],
    [t],
  );

  return (
    <div className="mk-quadrant">
      {quadrants.map((q) => (
        <section key={q.title} className="mk-quad">
          <div className="mk-quad__head">
            <span className={`mk-swatch ${q.swatch}`} />
            {q.title}
          </div>
          <p className="mk-quad__hint">{q.hint}</p>

          <div className="mk-quad__list">
            {q.cards.map((card) => (
              <div key={card} className="mk-quad__card">
                {card}
              </div>
            ))}
            {q.cards.length === 0 && (
              <div className="mk-quad__empty">
                <CheckCircle2 size={16} />
                {t('landing.quadrant.dropHere')}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
