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
  //
  // 🔴 象限**标题与副标题**用应用自己的 key（`web.quadrant.*`，来源
  // `features/quadrant/QuadrantBoard.tsx`）—— 原来走的是 `landing.quadrant.*`，
  // 两边的值逐字相同，那正是下一个漂移源。
  // **任务标题**（`landing.mock.task.*`）保持 landing 命名空间：那是示例数据，
  // 产品里没有对应物，本来就得由我们编。
  const quadrants = useMemo<Quadrant[]>(
    () => [
      {
        title: t('web.quadrant.do'),
        hint: t('web.quadrant.q1'),
        swatch: 'mk-swatch--q1',
        cards: [t('landing.mock.task.quote'), t('landing.mock.task.weeklyReport')],
      },
      {
        title: t('web.quadrant.plan'),
        hint: t('web.quadrant.q2'),
        swatch: 'mk-swatch--q2',
        cards: [
          t('landing.mock.task.q4Draft'),
          t('landing.mock.task.bookChapter'),
          t('landing.mock.task.quarterlyReview'),
        ],
      },
      {
        title: t('web.quadrant.delegate'),
        hint: t('web.quadrant.q3'),
        swatch: 'mk-swatch--q3',
        cards: [t('landing.mock.task.dentist')],
      },
      {
        title: t('web.quadrant.drop'),
        hint: t('web.quadrant.q4'),
        swatch: 'mk-swatch--q4',
        cards: [],
      },
    ],
    [t],
  );

  return (
    <div className="mk-quadrant">
      <div className="mk-quadrant__grid">
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
                  {/* 与真应用 `QuadrantBoard.tsx` 同一个图标、同一段文案 */}
                  <CheckCircle2 size={16} />
                  {t('web.quadrant.dropHere')}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {/*
        🔴 底部注释。真应用 `QuadrantBoard.tsx` 的四宫格下面有这一条
        （`web.quadrant.footnote`，讲"拖拽同时会改截止时间"），复刻原来没有。
        它不只是装饰：**它解释了这张界面的核心不变量** ——
        紧急度不是手选的，是从截止时间推导的。少了它，四象限看起来就只是个普通看板。
      */}
      <p className="mk-quadrant__footnote">{t('web.quadrant.footnote')}</p>
    </div>
  );
}
