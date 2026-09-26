/**
 * 时间线视图 —— 把任务列表接成一张可看的甘特图
 * ==============================================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件是"AI 自动生成甘特图"**真正成立的那一段**。
 *
 * 前面两个文件（`buildTimeline.ts` / `GanttChart.tsx`）都是纯函数与纯展示：
 * 写得再对，只要**没有任何地方挂载它们**，真实用户就永远点不到 ——
 * 那正是本仓库栽过十几次的失败形状：能力实现了、单测全绿、生产里零调用点。
 *
 * 所以这里负责把三件事接起来：
 *
 *   1. 任务的备注 → 清单条目（`parseChecklistFromNote`）
 *   2. 任务的备注 → AI 估时（`readDurationFromNote`，**分钟**，与排程同单位）
 *   3. 排好之后 → `GanttChart`
 *
 * 数据流一句话：
 *
 *   用户在任务行点「AI 估时」→ 写进备注（`预计耗时：90 分钟`）
 *   → 时间线读回来 → 条变宽
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 为什么每个任务一张图，而不是全塞进一张
 *
 * 每个任务的清单是**它自己的计划**：条目名会撞（两个任务都有"评审"），
 * 依赖也只在任务内部成立。塞进一张图会造出"跨任务的假依赖"。
 *
 * ⚠️ 但每张图各自归一化会带来一个陷阱：90 分钟的任务和 30 分钟的任务
 * **都会占满整行**（各自 100%），反而看不出谁更长。所以所有图共用
 * 一把尺子（`spanMinutes` = 所有任务里最大的跨度），条就可以互相比。
 *
 * ## 🔴 整条任务的估时，怎么落到条上（这是本文件最需要说清楚的一件事）
 *
 * `readDurationFromNote` 返回的是**整条任务**的一个数（备注里只有一行），
 * 而清单可能有 N 个条目。一个数怎么分给 N 个条目？**分不了。**
 *
 * 任何"按比例摊""平均分""都给一份"的做法都是在**编一个用户没给过的工期**，
 * 而编出来的数字会以事实的样子出现在图上 —— 用户没法分辨，也就没法纠正。
 *
 * 所以规则是**能落就落，落不了就明说**：
 *
 *   - 备注里**没有清单** → 整条任务自己算一条，估时直接落上去（最常见的形态）
 *   - 清单**只有 1 条** → 估时就是这一条的（不发生分摊）
 *   - 清单**有 N > 1 条** → 估时是整条的，**分摊不了**：子条目按默认时长排，
 *     并在块头**明说**"这个估时是整条的，没有摊到子条目上"
 *
 * ## 🔴 没有可排期内容的任务不静默跳过
 *
 * 一条既没有清单、也没被估时的任务如果直接不画，用户会以为视图坏了。
 * 所以它照样出现，并**显式说明**"还没有可排期的清单"。
 */

import { readDurationFromNote } from '@heyta/app-host';
import { cssVar } from '@heyta/design-system';
import type { LocalDate } from '@heyta/domain';

import {
  MIN_DURATION_MINUTES,
  buildTimeline,
  parseChecklistFromNote,
  type ChecklistItem,
  type TimelinePlan,
} from './buildTimeline.js';
import { GanttChart, formatMinutes } from './GanttChart.js';

/** 空态文案。**一句人话**，并告诉用户下一步去哪做。 */
const DEFAULT_EMPTY_HINT =
  '还没有任务可以排 —— 先在收集箱建一个任务，再给它写几条清单（或让 AI 拆解一次），时间线就有东西可排了。';

/**
 * 时间线需要的最小任务形状。
 *
 * ⚠️ 刻意**不** import `Task`：结构类型就够了，少一层耦合。
 * store 里的 `Task` 天然满足它（有 `id` / `title` / 可选 `note`）。
 */
export interface TimelineTask {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
}

export interface TimelineViewProps {
  /** 要排的任务。顺序 = 块序。 */
  tasks: readonly TimelineTask[];
  /**
   * 计划的起始日（本地日历日）。给了就显示真实日期与钟点。
   * ⚠️ 内存里的展示参数，不是持久化字段。
   */
  startDate?: LocalDate;
  /** 今天的本地日历日。给了才画"今天"。 */
  today?: LocalDate;
  /** 用于日期格式化的时间戳。默认 `Date.now()`。 */
  now?: number;
  /** 覆盖空态文案。 */
  emptyHint?: string;
}

/** 一个任务的排程结果，连带"估时能不能落到条上"的判断。 */
interface TaskBlock {
  task: TimelineTask;
  plan: TimelinePlan;
  /** 备注里 AI 估的分钟数（原样，**未夹**）。`undefined` = 没估过。 */
  aiMinutes: number | undefined;
  /** 备注里有没有可排期的清单条目。 */
  hasChecklist: boolean;
  /** 参与排程的单元数（没有清单时是 1 —— 整条任务自己算一条）。 */
  unitCount: number;
  /** 整条任务的估时无法分摊到多个子条目。 */
  unattributable: boolean;
}

/** 把一个任务算成一块可渲染的结果。**纯函数**，不读时钟、不联网。 */
function planTask(task: TimelineTask): TaskBlock {
  const checklist = parseChecklistFromNote(task.note);
  const hasChecklist = checklist.length > 0;

  // 没有清单时，**整条任务自己就是一条**：否则这条任务会在时间线上
  // 完全消失，而它恰恰是最需要看到"要花多久"的那一类。
  const units: ChecklistItem[] = hasChecklist ? checklist : [{ title: task.title }];

  // 🔴 显式判断 `undefined`，**不要**用 `||` / 真值判断：
  // `0` 是"估了 0 分钟"，与"没估过"是两件事（见 `duration-note.ts`）。
  const aiMinutes = readDurationFromNote(task.note);

  // 只有"整条任务 = 一个可排单元"时，估时才能**不发生分摊**地落下去。
  const single = units.length === 1 ? units[0] : undefined;
  const durationsInMinutes =
    single !== undefined && aiMinutes !== undefined ? { [single.title]: aiMinutes } : undefined;

  const plan = buildTimeline(units, {
    ...(durationsInMinutes === undefined ? {} : { durationsInMinutes }),
    // 🔴 告诉排程层这些数是 AI 估的 —— 界面才能说「AI 估时」而不是含糊的"约 N 分钟"。
    durationOrigin: 'ai',
  });

  return {
    task,
    plan,
    aiMinutes,
    hasChecklist,
    unitCount: units.length,
    unattributable: aiMinutes !== undefined && units.length > 1,
  };
}

export function TimelineView(props: TimelineViewProps): React.JSX.Element {
  const { tasks, startDate, today, now, emptyHint } = props;
  const clock = now ?? Date.now();

  if (tasks.length === 0) {
    return (
      <div data-testid="timeline-view" role="group" aria-label="时间线">
        <p
          data-testid="timeline-view-empty"
          style={{
            margin: 0,
            color: cssVar('color.foreground-muted'),
            fontSize: cssVar('font-size.xs'),
          }}
        >
          {emptyHint ?? DEFAULT_EMPTY_HINT}
        </p>
      </div>
    );
  }

  const blocks = tasks.map(planTask);

  // 🔴 所有任务共用一把尺子。否则每张图各自归一化，90 分钟与 30 分钟的条
  // 都会占满整行 —— 用户看不出谁更长（见 GanttChart.spanMinutes）。
  let sharedSpan = MIN_DURATION_MINUTES;
  for (const block of blocks) sharedSpan = Math.max(sharedSpan, block.plan.totalMinutes);

  return (
    <div
      data-testid="timeline-view"
      role="group"
      aria-label={`时间线：共 ${String(tasks.length)} 条任务`}
      style={{ display: 'grid', gap: cssVar('space.5') }}
    >
      {blocks.map((block) => (
        <section
          key={block.task.id}
          data-testid={`timeline-block-${block.task.id}`}
          style={{ display: 'grid', gap: cssVar('space.2') }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: cssVar('space.2'),
            }}
          >
            <h2
              data-testid={`timeline-task-title-${block.task.id}`}
              style={{
                margin: 0,
                fontSize: cssVar('font-size.base'),
                color: cssVar('color.foreground'),
              }}
            >
              {block.task.title}
            </h2>
            {block.aiMinutes !== undefined && (
              <span
                data-testid={`timeline-ai-${block.task.id}`}
                style={{
                  fontSize: cssVar('font-size.xs'),
                  color: cssVar('color.foreground-muted'),
                }}
              >
                AI 估时：{formatMinutes(block.aiMinutes)}（整条任务）
              </span>
            )}
          </div>

          {/* 🔴 没有可排期内容也**不静默跳过** —— 用户会以为视图坏了。 */}
          {!block.hasChecklist && (
            <p
              data-testid={`timeline-no-checklist-${block.task.id}`}
              style={{
                margin: 0,
                fontSize: cssVar('font-size.xs'),
                color: cssVar('color.foreground-muted'),
              }}
            >
              这条任务还没有可排期的清单 —— 先在备注里写几条待办，或让 AI 拆解一次；
              下面先按整条任务排一条。
            </p>
          )}

          {/* 🔴 分摊不了就明说，而不是平均分下去编一个工期。 */}
          {block.unattributable && (
            <p
              data-testid={`timeline-unattributable-${block.task.id}`}
              style={{
                margin: 0,
                fontSize: cssVar('font-size.xs'),
                color: cssVar('color.warning'),
              }}
            >
              AI 估的 {formatMinutes(block.aiMinutes ?? 0)} 是整条任务的估计，摊不到{' '}
              {block.unitCount} 个子条目上 —— 子条目按默认时长排，不替你猜每一步占多少。
            </p>
          )}

          <GanttChart
            entries={[...block.plan.entries]}
            spanMinutes={sharedSpan}
            {...(startDate === undefined ? {} : { startDate })}
            {...(today === undefined ? {} : { today })}
            now={clock}
          />
        </section>
      ))}
    </div>
  );
}
