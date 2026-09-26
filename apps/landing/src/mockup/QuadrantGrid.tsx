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

import { CheckCircle2 } from 'lucide-react';

interface Quadrant {
  title: string;
  hint: string;
  swatch: string;
  cards: string[];
}

const QUADRANTS: Quadrant[] = [
  {
    title: '马上做',
    hint: '重要且紧急',
    swatch: 'mk-swatch--q1',
    cards: ['回复客户关于报价的邮件', '整理本周周报，发给团队'],
  },
  {
    title: '计划做',
    hint: '重要不紧急',
    swatch: 'mk-swatch--q2',
    cards: ['写 Q4 目标拆解初稿', '读完《高效能人士的七个习惯》第 3 章', '准备季度复盘的材料'],
  },
  {
    title: '交给别人',
    hint: '紧急不重要',
    swatch: 'mk-swatch--q3',
    cards: ['预约牙医，确认下周三上午'],
  },
  {
    title: '先不做',
    hint: '不重要不紧急',
    swatch: 'mk-swatch--q4',
    cards: [],
  },
];

export function QuadrantGrid(): React.JSX.Element {
  return (
    <div className="mk-quadrant">
      {QUADRANTS.map((q) => (
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
                拖任务到这里
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
