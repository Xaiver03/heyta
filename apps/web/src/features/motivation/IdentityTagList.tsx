/**
 * 身份标签（L3）
 * ================
 *
 * ## 为什么是"身份"而不是"等级"
 *
 * 这是整份设计里最需要克制的一处。SDT（自我决定论）说内在动机靠三样东西：
 * 自主、胜任、联结 —— 而"等级/段位"喂的是**比较**，不是胜任：
 * 它把"我做到了什么"换成"我排在第几"，一旦排名下滑，
 * 同一份成就立刻变成失败（过度理由效应：外部奖励会把内在动机挤出去）。
 *
 * 所以这里给的是**描述性标签**："连续 30 天""完成 500 件"。
 * 它们描述的是**发生过的事实**，没有名次、没有可被夺走的位置。
 *
 * ## 三条规则
 *
 * 1. 🔴 **不显示已过期/已失去的标签。**
 *    标签一旦到手就永久保留 —— 包括"连续 30 天"。
 *    断掉之后它仍然是真的："你曾经连续 30 天"。把历史最高记录收走，
 *    等于告诉用户"你之前的努力不算数"，而全或无思维正是弃用的主要诱因
 *    （计划 §2 的 abstinence violation effect）。
 *
 * 2. 🔴 **未达成的标签显示"最近的 2 个"，按距离排序。**
 *    全部铺开（8 个里 7 个是灰的）传达的是"你差得远"。
 *    而按距离取最近的两个，传达的是"下一个就在前面"。
 *
 * 3. 🔴 **一个都没有时，不画空位。**
 *    空位列表是一个"你还什么都不是"的清单。这种情况只给一句
 *    事实性的说明，并指出最短的那条路。
 */

import { cssVar } from '@heyta/design-system';
import type { IdentityTagProgress } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { Award } from 'lucide-react';

import { text } from '../../lib/text.js';
import { KIND_COPY, IDENTITY_TAG_COPY } from './copy.js';

export interface IdentityTagListProps {
  tags: IdentityTagProgress[];
}

/** 未达成时最多展示几个 —— 见文件头第 2 条。 */
const NEAR_MISS_COUNT = 2;

export function IdentityTagList({ tags }: IdentityTagListProps) {
  const { t } = useI18n();

  /**
   * 标签 id → 文案。
   *
   * ⚠️ 表里没有的 id **原样显示 id**，不编一个中文名 ——
   * 后者会让"漏翻"看起来像"已经翻了"（与门禁对词条表的要求同一取向）。
   */
  function tagLabel(id: string): string {
    const key = IDENTITY_TAG_COPY[id];
    return key === undefined ? id : t(key);
  }

  const reached = tags.filter((tag) => tag.reached);
  const nearMisses = tags
    .filter((tag) => !tag.reached)
    // 按"还差多少（比例）"排序。用 ratio 而不是绝对值：
    // "还差 2 小时"和"还差 500 件"在绝对值上不可比，比例才可比。
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, NEAR_MISS_COUNT);

  if (reached.length === 0 && nearMisses.length === 0) {
    return (
      <p className="ht-tags__empty" style={text('row-meta')}>
        {t('web.growth.tags.empty')}
      </p>
    );
  }

  return (
    <div className="ht-tags">
      <ul className="ht-tags__list">
        {reached.map((tag) => (
          <li key={tag.id} className="ht-tags__item ht-tags__item--reached">
            <Award size={16} aria-hidden="true" />
            <span style={text('row-title')}>{tagLabel(tag.id)}</span>
          </li>
        ))}
      </ul>

      {nearMisses.length > 0 && (
        <div className="ht-tags__near">
          {nearMisses.map((tag) => {
            const kind = tag.kind === 'streakDays' ? 'activeDays' : tag.kind;
            const unit =
              tag.kind === 'streakDays'
                ? t('web.growth.unit.streakDays')
                : t(KIND_COPY[kind].unitKey);
            return (
              <p key={tag.id} className="ht-tags__near-item" style={text('caption')}>
                {t('web.growth.tags.near', {
                  name: tagLabel(tag.id),
                  gap: Math.max(0, tag.threshold - tag.value),
                  unit,
                })}
              </p>
            );
          })}
        </div>
      )}

      {reached.length === 0 && (
        <p
          className="ht-tags__empty"
          style={{ ...text('caption'), color: cssVar('color.foreground-subtle') }}
        >
          {t('web.growth.tags.nearNote')}
        </p>
      )}
    </div>
  );
}
