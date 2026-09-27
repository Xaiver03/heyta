/**
 * 里程碑地图（L3）
 * =================
 *
 * 解决的问题（计划 §5）：heyta 现在做完一件事，做完就消失了 ——
 * 三年前的打卡和昨天的打卡在界面上没有区别。**没有累积感，就没有"我在建设什么"的感觉。**
 *
 * ## 三条刻意的设计取舍
 *
 * 1. 🔴 **只增不减，没有惩罚项。**
 *    滴答清单的成就会因为没完成而**扣分**。我们不做 ——
 *    扣分制造的是"别掉下去"的焦虑，而不是"我在往上走"的动力，
 *    而且它和"中断不等于归零"这条核心立场直接冲突（计划 §4）。
 *    领域层的 `deriveMilestones` 里因此**根本没有**惩罚项这个概念。
 *
 * 2. 🔴 **已达成的那一档，进度条指向"下一档"，而不是停在 100%。**
 *    一个永远停在 100% 的横条会变成一个死掉的装饰。更重要的原因：
 *    目标梯度效应说的是"看得见终点时动力最强" ——
 *    已达成之后不给出下一个可见目标，动力就断在这里了。
 *
 * 3. 🔴 **每一档都显示，不隐藏未达成的。**
 *    隐藏未达成 = 用户不知道有这条路，也就无从规划。
 *    但**未达成不用红色**：那会把"还没到"表达成"你做错了"。
 */

import { cssVar } from '@heyta/design-system';
import type { MilestoneProgress } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { Check } from 'lucide-react';

import { text } from '../../lib/text.js';
import { KIND_COPY } from './copy.js';
import { ProgressBar } from './ProgressBar.js';

export interface MilestoneMapProps {
  milestones: MilestoneProgress[];
}

export function MilestoneMap({ milestones }: MilestoneMapProps) {
  const { t } = useI18n();

  /**
   * 按维度分组。
   *
   * ⚠️ 分组顺序跟着 `milestones` 的**首次出现顺序**走，而不是自己排一份 ——
   * 顺序是领域层 `MILESTONE_DEFINITIONS` 的决定（它把"最容易够到的"排在前面），
   * 这里再排一次就多了一个需要同步的真相。
   */
  const groups: Array<{ kind: MilestoneProgress['kind']; items: MilestoneProgress[] }> = [];
  for (const m of milestones) {
    const last = groups.at(-1);
    if (last !== undefined && last.kind === m.kind) {
      last.items.push(m);
    } else {
      groups.push({ kind: m.kind, items: [m] });
    }
  }

  return (
    <div className="ht-milestones">
      {groups.map((group) => {
        const copy = KIND_COPY[group.kind];
        const name = t(copy.nameKey);
        const unit = t(copy.unitKey);
        const reached = group.items.filter((m) => m.reached);
        const next = group.items.find((m) => !m.reached);
        // 全部达成：进度条指向满格，而不是消失 —— "已经到顶"也是信息。
        const current = reached.at(-1);

        return (
          <section key={group.kind} className="ht-milestones__group">
            <div className="ht-milestones__head">
              <h3 style={text('row-title')}>{name}</h3>
              <span className="ht-milestones__value" style={text('numeric-body')}>
                {current?.value ?? next?.value ?? 0}
                {unit}
              </span>
            </div>

            <ProgressBar
              ratio={next?.ratio ?? (current === undefined ? 0 : 1)}
              tone={next === undefined ? 'success' : 'primary'}
              label={
                next === undefined
                  ? t('web.growth.milestone.allReached', { name })
                  : // 可访问名里必须同时有**目标**和**差距** ——
                    // 只说「距离下一档」读屏用户不知道下一档是多少。
                    // （这里用直角引号而不是英文引号：门禁按源码扫描，
                    //   会把注释里成对的 `"` 当成一个字符串字面量。）
                    t('web.growth.milestone.nextLabel', {
                      name,
                      threshold: next.threshold,
                      unit,
                      gap: next.threshold - next.value,
                    })
              }
            />

            <ol className="ht-milestones__steps">
              {group.items.map((m) => (
                <li
                  key={m.id}
                  className={`ht-chip${m.reached ? ' ht-chip--reached' : ''}`}
                  style={text('caption')}
                >
                  {m.reached && <Check size={12} aria-hidden="true" />}
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{m.threshold}</span>
                </li>
              ))}
            </ol>

            {next !== undefined && (
              <p className="ht-milestones__next" style={text('caption')}>
                {t('web.growth.milestone.next', {
                  threshold: next.threshold,
                  unit,
                  gap: next.threshold - next.value,
                })}
              </p>
            )}

            {next === undefined && current !== undefined && (
              <p
                className="ht-milestones__next"
                style={{ ...text('caption'), color: cssVar('color.success') }}
              >
                {t('web.growth.milestone.dimensionDone')}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
