/**
 * 真实界面复现：四象限（艾森豪威尔矩阵）
 * ========================================
 *
 * 复现对象：`apps/web/src/features/quadrant/QuadrantBoard.tsx` 经
 * `@heyta/ui` 的共享 `QuadrantBoard` 渲染出来的那一屏。
 *
 * 🔴 象限的**两个名字都要保留** —— 这是产品里刻意的一处设计：
 *   - 大标题是行动指令（「马上做」），回答"我现在该干什么"
 *   - 小字是象限定义（「重要且紧急」），回答"为什么它在这一格"
 * 只留一个的话，要么用户不知道判断标准，要么得自己把标准翻译成行动。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一块的"事实"全部来自 `./quadrant-shape.ts`（纯数据登记处）
 *
 * 四格的**顺序 / 色块 / 标题 key / 说明 key** 不再散写在本文件里，而是登记在
 * `quadrant-shape.ts`；`apps/landing/tests/mockup-quadrant-shape.spec.tsx`
 * 把它与共享 `@heyta/ui` 的 `model.ts`（`QUADRANT_ORDER` / `QUADRANT_SLOT` /
 * `QUADRANT_SLOT_TOKEN`）和 web 的 `features/quadrant/copy.ts` **源码文本**逐项对账。
 * 真实现改了而复刻没跟 → 红。**为什么不是直接换成真组件**见该文件头（§9.1）。
 *
 * 🔴 **卡不是手写的一张张名字**：四格的内容与侧栏的计数一样，
 * 从 `./showcase-data.js` 的**同一份** `SHOWCASE_TASKS` 派生 ——
 * 判据用领域层自己的 `bucketByQuadrant()` 重算每格的成员与**格内顺序**
 * （截止升序、优先级降序），所以"摆错格"和"格内顺序漂了"都会红。
 *
 * ⚠️ **仍然存在的保真度差距**（如实记账，不要以为这里已经"等于真实现"）：
 * 真实现里每一格直接渲染共享 `TaskList`（勾选框 + 标题 + 宿主插槽），
 * 而这里是一张**只有标题的静态卡**。原因是 §9.1：`@heyta/ui` 不能静态进来，
 * 而行/密度的复刻需要另一套契约（`task-row-shape.ts` 现在只覆盖任务列表那一节）。
 * 这一条已登记在报告与计划文档里，不是遗漏。
 *
 * 取值全部走语义 token，**不碰原始色阶**（MASTER.md 规则 2）。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n/provider';

import { MOCK_QUADRANT_KEYS, MOCK_QUADRANT_SHAPE } from './quadrant-shape.js';
import { showcaseTasksByQuadrant } from './showcase-data.js';

export function QuadrantGrid(): React.JSX.Element {
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const quadrants = useMemo(() => {
    const buckets = showcaseTasksByQuadrant();
    // 顺序与每个槽位的文案取登记处 —— 成员与格内顺序由 `showcase-data.ts` 派生。
    return MOCK_QUADRANT_SHAPE.map((shape) => {
      const title = t(shape.titleKey);
      const hint = t(shape.hintKey);
      return {
        id: shape.quadrant,
        swatch: `mk-swatch--${shape.swatch}`,
        title,
        hint,
        // 整格给屏幕阅读器的一句话。真实现把它放在 `accessibilityRole="summary"`
        // 的格子上（`labels.cellA11y`），复刻用 `aria-label` 落在同一个语义位置。
        a11yLabel: t(MOCK_QUADRANT_KEYS.cellA11y, { title, hint }),
        cards: buckets[shape.quadrant].map((task) => t(task.titleKey)),
      };
    });
  }, [t]);

  return (
    <div className="mk-quadrant">
      <div className="mk-quadrant__grid">
        {quadrants.map((q) => (
          <section key={q.id} className="mk-quad" aria-label={q.a11yLabel}>
            <div className="mk-quad__head">
              {/* 色块尺寸有两族：侧栏 `.mk-swatch`（= `.ht-swatch`，space.2），
                  看板这一处是真实现的 `icon.sm`。见 `mockup.css` 的 `.mk-quad__swatch`。 */}
              <span className={`mk-swatch mk-quad__swatch ${q.swatch}`} />
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
                  {/* 空格不是"什么都没有"，它说的是"这一类现在没有要处理的事"。
                      🔴 真实现的空态（`TaskList` 的 `ListEmptyComponent`）**没有图标**，
                      这里曾经自己加了一只 `CheckCircle2` 并谎称"与真应用同一个图标"。
                      判据 `mockup-quadrant-shape.spec.tsx` 守着这一条
                      （登记处 `MOCK_QUADRANT_EMPTY_HAS_ICON = false`）。 */}
                  {t(MOCK_QUADRANT_KEYS.empty)}
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
      <p className="mk-quadrant__footnote">{t(MOCK_QUADRANT_KEYS.footnote)}</p>
    </div>
  );
}
