/**
 * 真实界面复现：任务列表
 * =========================
 *
 * 复现对象：`apps/web` 的任务列表一行一条任务，
 * 每行是「勾选框 + 标题 + 截止徽标 + 优先级 + AI 拆解 + 删除」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这里**不是** `@heyta/ui` 的真组件（试过，有实测数字）
 *
 * 最直接的做法是 import `@heyta/ui` 的 `TaskList`。它是 RN 组件，Web 端要靠
 * `react-native-web` 才能渲染，而实测（2026-09-28，`vite build` + `gzip -c`）
 * 这会怎样：
 *
 * | 方案 | 首屏 `main-*.js` | 另取 |
 * |---|---|---|
 * | 静态 import 真组件 | 642,666 B → **845,748 B** raw（199,000 → **260,897 B** gzip，**+31%**） | — |
 * | 懒加载孤岛 | 198,975 B gzip（**不变**） | `TaskListLive-*.js` **274,522 B** raw / **83,578 B** gzip |
 *
 * 孤岛看起来解决了首屏，但**本页用不了**：`Hero.tsx` 也渲染 `<AppWindow view="tasks" />`，
 * 而展厅那块的 `getBoundingClientRect().top` 在 1280×800 下是 **529px** ——
 * **就在首屏里**。实测（Playwright）chunk 在 `load` 之后约 90ms 就被取回，
 * 于是总字节变成 199+84 = **283 kB gzip**，比静态 import 的 262 kB 还多
 *（gzip 是按文件做的，拆开反而压不动），只换来"不阻塞首屏渲染"。
 *
 * 落地页存在的理由之一是**首屏快**（仓库已经为同一个理由把 131 kB gzip 的
 * `three` 拆成按需 chunk），所以为一个**不可交互的展示件**在首屏挂上
 * `react-native-web` 是划不来的。**结论：真组件不进落地页。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 那漂移怎么办：**形状钉在同一份契约上**
 *
 * 手抄的危险不是"抄"，是"抄完没有任何东西会发现两边不一样"。
 * `docs/research/dida-view-unification.md` §4.5 说的正是这个形状：
 * 落地页画的是**旧样子**，而它不会报错。
 *
 * 实测那次已经漂了两处（见 `packages/design-system/src/task-row-shape.ts` 的表）：
 * 勾选框抄成 20px 的圆、标题抄成 `font-size-sm`，而共享行是 22px 圆角方 + `row-title`。
 *
 * 现在这一行的**几何与排版不再自己挑 token**：用的是
 * `@heyta/design-system` 的 `TASK_ROW_SHAPE` / `TASK_ROW_TEXT` 登记的那一组，
 * 而共享行（`packages/ui/src/task-list/TaskList.tsx`）**从同一份常量取值**；
 * `tests/mockup-task-row.spec.tsx` 把 `mockup.css` 的每一个 token 名与契约逐项比对。
 * 代价 0 字节，约束是**可判定的**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 行数据也从**唯一一份**样例任务派生
 *
 * 复刻的**任务列表**与**四象限**原来各用一份样例任务（列表 7 条、看板 6 条，
 * 有两条只在一边），于是"侧栏计数该等于什么"根本没有唯一答案。
 * 现在两者都从 `./showcase-data.js` 的 `SHOWCASE_TASKS` 派生 ——
 * 侧栏计数、看板卡片数、列表行数是**同一批任务**的三种视图。
 *
 * ⚠️ 边界（写在明处）：
 *   - **颜色**不走契约，走 `--ht-*` token（跟随主题）。
 *   - **卡片外壳**（背景/描边/圆角/左右内边距）是**容器**的事，不是"行"的事：
 *     共享的 `TaskList` 明确不自带背景与水平内边距（`packages/ui` 的
 *     `ListSurface` 还没落地）。这里自带一层外壳，与 mobile 的 `<Screen>`
 *     自带 gutter 是同一类宿主决策。
 *   - **截止档位与文案是手工编排的示例**，不是从 `@heyta/domain` 的
 *     `computeCountdown()` 算出来的。**这是明确留下的残差**，理由：贵的是
 *     `@heyta/design-system` 的整包入口（**+24.4 kB gzip**），而 `@heyta/domain`
 *     的 `Priority` + `computeCountdown` 只值 **~0.3 kB gzip**。所以这不是"引不起"，
 *     是**这一次没引**：展厅的截止文案本身就是手写的示例（`landing.mock.due.*`），
 *     档位必须与那句文案成对，否则会出现"还剩 5 天"却是危险色这种自相矛盾的展示。
 *     ⚠️ 残留的漂移面：产品那侧的阈值在 `@heyta/domain`，展厅这侧的档位写死在
 *     `showcase-data.ts` 里；"档位 → 颜色"这一步 `apps/web/src/lib/due-display.ts`
 *     里也有一份。共享层当前**没有**"档位 → 颜色"的单点 —— 登记在报告里。
 *     真要把这一条也收敛掉，代价约 0.3 kB gzip，比本页为了省下的 62 kB
 *     完全划得来 —— 那是**下一步**（需要 `packages/ui` 先有档位→颜色的单点）。
 *   - **排序**仍是复刻件自己的（样例数据是手工编排的固定顺序）。
 */

import { useMemo } from 'react';
import { Check, Sparkles, Trash2 } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { SHOWCASE_TASKS, type ShowcaseDueTone } from './showcase-data.js';

/**
 * 档位 → 语义色类名。
 *
 * ⚠️ 这一步**必须**在宿主里做：契约是框架无关的"形状"，颜色类名是 CSS 侧的东西。
 * 映射本身是小抄，与 `apps/web/src/lib/due-display.ts` 的 `URGENCY_CLASS` 同构 ——
 * 见文件头"残差"。
 */
const URGENCY_CLASS: Record<ShowcaseDueTone, string> = {
  overdue: ' mk-due--overdue',
  today: ' mk-due--today',
  soon: ' mk-due--soon',
  later: '',
};

export function TaskList(): React.JSX.Element {
  const { t } = useI18n();

  /**
   * 「现在」**冻结一次**，不每次渲染取。
   *
   * 一次渲染里的所有行必须用同一个"现在"，否则跨零点时同一屏上的两行
   * 会算出不同的档位（同 web 的 `DueBadge` 纪律）。展厅是静态展示品，
   * 挂载那一刻的时间就是全部 —— 而它的"现在"冻结在
   * `showcase-data.ts` 的 `SHOWCASE_NOW`（计数与象限分类依赖它）。
   */
  const rows = useMemo(
    () =>
      SHOWCASE_TASKS.map((demo) => ({
        demo,
        title: t(demo.titleKey),
      })),
    [t],
  );

  return (
    <div className="mk-tasklist">
      {rows.map(({ demo, title }) => (
        <div
          key={demo.id}
          className={`mk-task${demo.done === true ? ' mk-task--done' : ''}`}
        >
          <span className="mk-task__check">
            <Check size={12} />
          </span>

          <span className="mk-task__body">
            <span className="mk-task__title">
              {title}
            </span>

            {demo.dueKey === undefined && demo.priority === undefined ? null : (
              <span className="mk-task__meta">
                {demo.dueKey === undefined ? null : (
                  <span className={`mk-due${URGENCY_CLASS[demo.dueTone ?? 'later']}`}>
                    {t(demo.dueKey)}
                  </span>
                )}
                {demo.priority === undefined ? null : (
                  <span className="mk-prio">P{demo.priority}</span>
                )}
              </span>
            )}
          </span>

          {/* AI 拆解入口。应用里配置关着时它**仍然在**，点了会说明该去开什么 ——
              "找不到入口"和"入口说为什么不可用"是两件事。 */}
          {demo.ai === true ? (
            <span className="mk-iconbtn">
              <Sparkles size={16} />
            </span>
          ) : null}

          <span className="mk-iconbtn">
            <Trash2 size={16} />
          </span>
        </div>
      ))}
    </div>
  );
}
