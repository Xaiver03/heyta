/**
 * 真实界面复现：任务列表
 * =========================
 *
 * 复现对象：`apps/web/src/App.tsx` 的 `.ht-tasklist` 一行一条任务，
 * 每行是「勾选框 + 标题 + 截止徽标 + 优先级 + AI 拆解 + 删除」。
 *
 * 🔴 三条从真实组件里继承下来的规则，这里必须一起复现，
 * 否则展示出来的界面与产品**气质不一致**：
 *   1. 完成态用**删除线 + 弱化色**双重表达，不只靠颜色（色盲可辨）。
 *   2. 数字（天数、优先级）一律 `.tabular-nums`，否则数值变化时宽度会跳。
 *   3. 紧迫度只把颜色当**冗余通道**，语义由文字承载
 *      （「已逾期 2 天」这几个字已经说清了一切）。
 */

import { Check, Sparkles, Trash2 } from 'lucide-react';

type DueTone = 'overdue' | 'today' | 'soon' | 'none';

interface MockTask {
  title: string;
  done?: boolean;
  due?: { text: string; tone: DueTone };
  priority?: number;
  ai?: boolean;
}

/**
 * 展示用的任务数据。
 *
 * ⚠️ 这是**手工编排的示例数据**，不是从某个真实账号导出的。
 * 挑的都是任务管理里典型的一天：一件逾期的、一件今天的、两件本周的、
 * 一件委派出去的、一件先不做的，外加一件已完成的 —— 这样列表里
 * 四种紧迫度和三种优先级都能被看到，而不是清一色的「今天」。
 */
const TASKS: MockTask[] = [
  {
    title: '回复客户关于报价的邮件',
    due: { text: '已逾期 2 天', tone: 'overdue' },
    priority: 1,
  },
  {
    title: '整理本周周报，发给团队',
    due: { text: '今天 18:00', tone: 'today' },
    priority: 1,
    ai: true,
  },
  {
    title: '写 Q4 目标拆解初稿',
    due: { text: '还剩 3 天', tone: 'soon' },
    priority: 2,
  },
  {
    title: '读完《高效能人士的七个习惯》第 3 章',
    due: { text: '还剩 5 天', tone: 'soon' },
    priority: 3,
  },
  {
    title: '预约牙医，确认下周三上午',
    due: { text: '明天', tone: 'soon' },
    priority: 2,
  },
  {
    title: '整理上个月的照片备份',
  },
  {
    title: '提交 9 月报销单',
    done: true,
    due: { text: '已完成', tone: 'none' },
  },
];

function DueBadge({ due }: { due: { text: string; tone: DueTone } }): React.JSX.Element {
  const toneClass = due.tone === 'none' ? '' : ` mk-due--${due.tone}`;
  return <span className={`mk-due${toneClass}`}>{due.text}</span>;
}

export function TaskList(): React.JSX.Element {
  return (
    <div className="mk-tasklist">
      {TASKS.map((task) => (
        <div
          key={task.title}
          className={`mk-task${task.done === true ? ' mk-task--done' : ''}`}
        >
          <span className="mk-task__check">
            <Check size={12} />
          </span>

          <span className="mk-task__title">{task.title}</span>

          <span className="mk-task__meta">
            {task.due !== undefined && <DueBadge due={task.due} />}
            {task.priority !== undefined && (
              <span className="mk-prio">P{task.priority}</span>
            )}
          </span>

          {/* AI 拆解入口。应用里配置关着时它**仍然在**，点了会说明该去开什么 ——
              "找不到入口"和"入口说为什么不可用"是两件事。 */}
          {task.ai === true && (
            <span className="mk-iconbtn">
              <Sparkles size={16} />
            </span>
          )}

          <span className="mk-iconbtn">
            <Trash2 size={16} />
          </span>
        </div>
      ))}
    </div>
  );
}
