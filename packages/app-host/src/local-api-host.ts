/**
 * 本地 API 宿主适配器
 * ====================
 *
 * 把 `LocalApiHost` 端口接到**真实的** op-log 写入路径与物化状态上。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这个适配器在 `packages/app-host` 而不是 `apps/node-host`
 *
 * ADR-0003 的判据是："这一行在决定**业务上该怎么做**吗？"
 *
 * - `intent.action === 'complete-task'` 该调 `setCompleted` 还是 `rename`
 *   → **是业务决定**，它属于 packages
 * - `dueDate` 是 epoch ms，而 MCP 传的是 `YYYY-MM-DD`，怎么换
 *   → **是业务决定**（而且是个有时区陷阱的决定，见下）
 *
 * 壳那边因此只剩"怎么收字节"。这也让这套语义**同时被三个平台复用**，
 * 而不是每端写一遍然后漂移（本仓库已经发生过两次这种漂移，见 AGENTS.md §3.5）。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 写入只经 `TaskActions` —— 而它内部走 `dispatch`
 *
 * 本文件**不构造 op**，只调 `actions.*`。op 的构造在 `actions.ts` 里，
 * 那是唯一的地方（`check-layering` 的 `no-op-construction-in-apps` 钉着外壳）。
 *
 * ## ⚠️ 时区：本地 API 说的是**本地日期**
 *
 * `Task.dueDate` 是 epoch ms，`LocalApiItem.dueDate` 是 `YYYY-MM-DD`。
 * 这个转换**必须选一个时区**，而选错会安静地差一天 ——
 * 这正是本仓库已经在"模型算错日期"上踩过一次的同一类错误（见计划 §9.8）。
 *
 * 选择：**本地时区**。理由是本地 API 的消费者（编辑器、脚本、AI 助手）
 * 都跑在**同一台机器**上，用同一个本地时区；而用户在界面上看到的也是本地日期。
 * 用 UTC 会让"今天到期"在 UTC+8 的晚上 8 点后变成"明天"。
 */

import type {
  LocalApiHabit,
  LocalApiHost,
  LocalApiItem,
  LocalApiProject,
  LocalApiWriteIntent,
  LocalApiWriteResult,
} from '@heyta/local-api';
import { Priority, type Habit, type HabitGoalType, type Task } from '@heyta/domain';

import type { ActionContext, TaskActions } from './actions.js';
import { createHabitActions, type HabitActions, type NewHabitFields } from './habit-actions.js';
import { createProjectActions, type ProjectActions } from './project-actions.js';

export interface LocalApiHostOptions {
  /**
   * 这条任务的内容能不能被本机工具读。
   *
   * 🔴 **必填，没有默认值。**
   *
   * 它原本缺省为 `() => true`，而"壳没传"和"壳传了 true"于是无法区分 ——
   * 真实产品里 `readable` 恒为 `true`，Bear 范式那条路径**从不执行**，
   * 且没有任何信号。现在壳必须自己回答这个问题。
   *
   * heyta 目前**没有**"受保护条目"这个产品概念（ADR-0011 §6.1 列为唯一产品空白），
   * 所以 `cli-mcp.ts` 现在显式传 `() => true` 并注明理由。
   * 将来有了"标记为受保护"的字段，只需要改**那一处**，协议层一行都不用改。
   *
   * ⚠️ 不要因为"现在恒为 true"就删掉它 —— 删掉之后那段契约
   * （`projectForTool` / `readItemForTool`）就完全没有生产调用点，
   * 而它恰恰是 ADR-0011 最重要的一条。
   */
  isReadable: (task: Task) => boolean;
}

/** `Priority` 枚举 ↔ MCP 字符串。 */
const PRIORITY_TO_NAME: Readonly<Record<number, string>> = {
  [Priority.None]: 'none',
  [Priority.Low]: 'low',
  [Priority.Medium]: 'medium',
  [Priority.High]: 'high',
};

const NAME_TO_PRIORITY: Readonly<Record<string, Priority>> = {
  none: Priority.None,
  low: Priority.Low,
  medium: Priority.Medium,
  high: Priority.High,
};

/**
 * epoch ms → `YYYY-MM-DD`（**本地时区**）。
 *
 * ⚠️ 刻意不用 `toISOString().slice(0,10)` —— 那是 UTC，
 * 会在 UTC+8 的下午之后整体差一天。
 */
export function toLocalDateString(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `YYYY-MM-DD` → epoch ms（**本地时区的当天 0 点**）。
 *
 * 返回 `undefined` 表示格式不合法 —— 由调用方决定怎么报，而不是猜一个日期。
 */
export function fromLocalDateString(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (m === null) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // 反查一遍，挡掉 2026-02-31 这类"格式对但不存在"的日期
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return undefined;
  }
  return date.getTime();
}

/** `Task` → `LocalApiItem`。**正文只有 `readable` 时才带。** */
export function taskToItem(task: Task, readable: boolean): LocalApiItem {
  const item: LocalApiItem = {
    id: task.id,
    title: task.title,
    completed: task.completedAt !== undefined,
    readable,
  };
  if (task.dueDate !== undefined) item.dueDate = toLocalDateString(task.dueDate);
  if (task.priority !== undefined) item.priority = PRIORITY_TO_NAME[task.priority] ?? 'none';
  // 🔴 正文只在可读时挂上。不可读时**连字段都不存在** ——
  // 与 `projectForTool` 的白名单重建是同一条纪律的两个执行点。
  if (readable && task.note !== undefined) item.body = task.note;
  return item;
}

/**
 * 达成口径的闭集。与 `@heyta/domain` 的 `HabitGoalType` **同集合 —— 两边一起改**
 * （同 `focus-actions.ts` 的 `KINDS` 那条先例）。
 *
 * 🔴 为什么在**这里**验而不是在协议层：本包零依赖，写不出这个类型；而"不认识的
 * 值"如果原样进 `createHabit` 的载荷，会被 `isAchieved` 当成**默认口径**处理 ——
 * 症状是"我要的是今天一次都不碰，结果它按至少一次算"，而任何一层都不报错。
 */
const GOAL_TYPES: ReadonlySet<string> = new Set<string>(['atLeast', 'atMost', 'exactly']);

/**
 * `Habit` → `LocalApiHabit`。**白名单重建**（同 `taskToItem` / `projectForTool`）：
 * `color` / `icon` / `frequency` / `backfillDays` 一律不出 ——
 * 它们不在 `list_habits` 的 `egressFields` 里，多搬一个字段就是让出境声明说谎。
 */
export function habitToItem(habit: Habit): LocalApiHabit {
  const item: LocalApiHabit = { id: habit.id, name: habit.name };
  if (habit.target !== undefined) item.target = habit.target;
  if (habit.unit !== undefined) item.unit = habit.unit;
  if (habit.goalType !== undefined) item.goalType = habit.goalType;
  return item;
}

export function createLocalApiHost(
  ctx: ActionContext,
  actions: TaskActions,
  // 🔴🔴 **第三个参数是必填的，不是可选的 —— 这是刻意的。**
  //
  // 它原本是 `options: LocalApiHostOptions = {}`，而 `isReadable` 缺省为
  // `() => true`。后果：**真实运行的程序里 `readable` 永远是 `true`**，
  // Bear 范式（可列举但不可读）那条路径**从来不执行**，
  // 而任何地方都不会提示这件事。
  //
  // 全仓库只有 `cli-mcp.ts` 一个真实调用点，且它**从来没有传过** `isReadable`
  // —— 也就是说这条隐私特性在产品里是死的。
  //
  // 一个隐私相关的开关**不允许静默地失败在"open"那一侧**。
  // 现在壳必须**显式**回答"哪些条目读不出来"，答不出来就编译不过。
  options: LocalApiHostOptions,
): LocalApiHost {
  const isReadable = options.isReadable;

  // 🔴 清单与习惯的动作**在这里内部构造**，不从壳注入 —— 这两个动作集只需要
  // `ActionContext`（`dispatch` + `getState`），而 `ctx` 已经在参数里。
  // 为什么不做成 `options.projectActions`：那样每个宿主都要多接一根线，
  // 而**漏接的那一个只会让 `submit` 少一条分支**（AGENTS §3.5 的"每端一份、
  // 各自漂移"就是这么长出来的）。内部构造 ⇒ 三个宿主（Web / node-host CLI / MCP stdio）
  // 接到的行为逐字相同，且 op 的构造仍然只在 `project-actions.ts` / `habit-actions.ts` 里有一份。
  const projectActions = createProjectActions(ctx);
  const habitActions = createHabitActions(ctx);

  return {
    listTasks: (args) => {
      let tasks = actions.listTasks();
      if (args.projectId !== undefined) {
        tasks = tasks.filter((t) => t.projectId === args.projectId);
      }
      if (args.completed !== undefined) {
        tasks = tasks.filter((t) => (t.completedAt !== undefined) === args.completed);
      }

      // 🔴🔴 日期过滤**必须排在 limit 之前**。这条顺序就是 `list.today` 那条缺陷的
      // 另一半：先 `slice(0, 50)` 再筛，"今天的任务"只要排在第 50 条之后就查不到，
      // 而用户拿到的是一个**空列表** —— 那不是"今天没任务"，那是筛错了。
      // 契约把这件事写在 `LocalApiHost.listTasks` 的注释上（本包看不见截断，
      // 也补不回来），这里就是它唯一的执行点。
      //
      // ⚠️ 过滤发生在**内存里已物化的状态**上，所以它是本地操作 ——
      // 不该退回协议层再做一遍（那会出现"同一句『今天』两层各筛一次"）。
      const { dueOn, dueFrom, dueTo } = args;
      if (dueOn !== undefined || dueFrom !== undefined || dueTo !== undefined) {
        tasks = tasks.filter((task) => {
          // 没有截止日的任务**不属于任何一天**（"今天有什么任务"不该把收件箱倒出来）。
          if (task.dueDate === undefined) return false;
          // 用的是**投影时同一个**换算（`taskToItem` → `toLocalDateString`），
          // 所以"拿来比的日子"与"返回里显示的日子"必然是同一个日子 ——
          // 不会出现"筛 15 号，而返回里写着 15 号的那条被漏掉"。
          const day = toLocalDateString(task.dueDate);
          // 🔴 `YYYY-MM-DD` 的字典序就是时间序（四位年 + 补零月日），
          // 所以闭区间比较不需要再做任何日历算术。两端都**含**。
          if (dueOn !== undefined) return day === dueOn;
          if (dueFrom !== undefined && day < dueFrom) return false;
          if (dueTo !== undefined && day > dueTo) return false;
          return true;
        });
      }

      // 上限默认 50：列表是给模型看的，一次几百条会直接吃掉上下文。
      const limit = args.limit ?? 50;
      return Promise.resolve(tasks.slice(0, Math.max(0, limit)).map((t) => taskToItem(t, isReadable(t))));
    },

    getTask: (taskId) => {
      const task = actions.findTask(taskId);
      if (task === undefined) return Promise.resolve(undefined);
      return Promise.resolve(taskToItem(task, isReadable(task)));
    },

    listProjects: () => {
      const state = ctx.getState();
      const counts = new Map<string, number>();
      for (const task of Object.values(state.tasks)) {
        if (task.deletedAt !== undefined || task.projectId === undefined) continue;
        counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
      }
      const projects: LocalApiProject[] = Object.values(state.projects)
        .filter((p) => p.deletedAt === undefined)
        .map((p) => ({ id: p.id, name: p.name, taskCount: counts.get(p.id) ?? 0 }));
      return Promise.resolve(projects);
    },

    // 顺序与 `listTasks()` 同一条规则（`habit-actions.ts` 的 `listHabits` 已经排过），
    // 所以"AI 看到的第 N 个习惯"与界面上的第 N 个是同一个 —— 不是实现细节，
    // 是跨端一致的那条（见 `actions.ts` 的 `byCanonicalOrder`）。
    listHabits: () => Promise.resolve(habitActions.listHabits().map(habitToItem)),

    submit: (intent) => submitIntent(ctx, actions, projectActions, habitActions, intent),
  };
}

/**
 * 把一个写入意图翻译成动作调用。
 *
 * 🔴 **这是 `LocalApiWriteIntent` 唯一被解释的地方。**
 * 译不出来（或参数不合法）就返回 `invalid`，**绝不"尽力而为"地猜**。
 *
 * ⚠️ 联合类型**没有 `default` 分支**是刻意的：加一个写入动作而不在这里表态，
 * 编译就过不去（那正是"每个宿主都被逼着表态"的落点，而三个宿主共用这一个实现）。
 */
async function submitIntent(
  ctx: ActionContext,
  actions: TaskActions,
  projectActions: ProjectActions,
  habitActions: HabitActions,
  intent: LocalApiWriteIntent,
): Promise<LocalApiWriteResult> {
  switch (intent.action) {
    case 'create-task': {
      if (intent.title.trim() === '') {
        return { ok: false, reason: 'invalid', message: '标题不能为空。' };
      }
      const over: {
        dueDate?: number;
        priority?: Priority;
        projectId?: string;
      } = {};
      if (intent.dueDate !== undefined) {
        const epoch = fromLocalDateString(intent.dueDate);
        if (epoch === undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `截止日期格式应为 YYYY-MM-DD，收到「${intent.dueDate}」。`,
          };
        }
        over.dueDate = epoch;
      }
      if (intent.priority !== undefined) {
        const p = NAME_TO_PRIORITY[intent.priority.toLowerCase()];
        if (p === undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `优先级应为 none / low / medium / high，收到「${intent.priority}」。`,
          };
        }
        over.priority = p;
      }
      if (intent.projectId !== undefined) over.projectId = intent.projectId;

      const id = await actions.create(intent.title, over);
      return { ok: true, taskId: id };
    }

    case 'update-task': {
      const task = actions.findTask(intent.taskId);
      if (task === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      // 逐字段处理，**不认识的一律拒绝而不是忽略** ——
      // 静默忽略会让调用方以为改成功了。
      const unknown = Object.keys(intent.fields).filter(
        (k) => !['title', 'completed', 'dueDate', 'priority'].includes(k),
      );
      if (unknown.length > 0) {
        return {
          ok: false,
          reason: 'invalid',
          message: `不支持修改这些字段：${unknown.join('、')}。`,
        };
      }

      const f = intent.fields;
      if (typeof f['title'] === 'string') await actions.rename(intent.taskId, f['title']);
      if (typeof f['completed'] === 'boolean') await actions.setCompleted(intent.taskId, f['completed']);
      if (typeof f['priority'] === 'string') {
        const p = NAME_TO_PRIORITY[f['priority'].toLowerCase()];
        if (p === undefined) {
          return { ok: false, reason: 'invalid', message: `未知优先级「${f['priority']}」。` };
        }
        await actions.setPriority(intent.taskId, p);
      }
      if (typeof f['dueDate'] === 'string') {
        const epoch = fromLocalDateString(f['dueDate']);
        if (epoch === undefined) {
          return { ok: false, reason: 'invalid', message: `截止日期格式应为 YYYY-MM-DD。` };
        }
        await actions.setDueDate(intent.taskId, epoch);
      }
      return { ok: true, taskId: intent.taskId };
    }

    case 'complete-task': {
      const task = actions.findTask(intent.taskId);
      if (task === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      await actions.setCompleted(intent.taskId, true);
      return { ok: true, taskId: intent.taskId };
    }

    case 'create-project': {
      const name = intent.name.trim();
      // 空名**不落到 `projectActions.createProject`** —— 它会 throw，而 throw 会顺着
      // 两个壳的 catch 变成一句"工具执行失败"。这里返回 `invalid`，用户看到的是原因。
      // （同 `create-task` 那条"标题不能为空"。）
      if (name === '') {
        return { ok: false, reason: 'invalid', message: '清单名称不能为空。' };
      }
      if (intent.parentId !== undefined) {
        const parent = ctx.getState().projects[intent.parentId];
        if (parent === undefined || parent.deletedAt !== undefined) {
          return {
            ok: false,
            reason: 'not-found',
            message: `找不到要放进的那个清单（parentId「${intent.parentId}」）。`,
          };
        }
        // 🔴 领域层明确**只支持一层**（`Project.parentId` 的注释 + `packages/ui/src/projects/model.ts:72`），
        // 而界面只渲染"顶层 + 其下一级"。挂到一个本身已是子级的清单下面，
        // 建出来的清单在四个端上**都看不见** —— 写成功、读不出、不报错。
        if (parent.parentId !== undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `「${parent.name}」已经在一个清单下面了，清单只支持一层。`,
          };
        }
      }
      const id = await projectActions.createProject(name, intent.parentId);
      return { ok: true, taskId: id, entityId: id, entityType: 'PROJECT' };
    }

    case 'create-habit': {
      const name = intent.name.trim();
      if (name === '') {
        return { ok: false, reason: 'invalid', message: '习惯名称不能为空。' };
      }

      const over: NewHabitFields = {};

      if (intent.target !== undefined) {
        // 下界是 **0 而不是 1**：`goalType: 'atMost'` 时"目标 0 次"是合法习惯
        // （"今天一次都不碰"）。同 `setHabitGoal` 那条判定 —— 两边必须同口径，
        // 否则"AI 能建、界面不能改"这种分裂就会出现。
        if (!Number.isFinite(intent.target) || intent.target < 0) {
          return {
            ok: false,
            reason: 'invalid',
            message: `目标数值必须是不小于 0 的有限数，收到「${String(intent.target)}」。`,
          };
        }
        over.target = intent.target;
      }

      if (intent.unit !== undefined) {
        const unit = intent.unit.trim();
        if (unit === '') {
          // 空单位**拒绝**而不是落成空串：界面上会渲染成「8 」（少一个字的观感），
          // 而 `setHabitGoal` 对同一个输入的处理是"清除单位"—— 两条路对同一句话
          // 给两种结果就是漂移。要单位就别给空的。
          return { ok: false, reason: 'invalid', message: '单位不能是空白；要没有单位就别传这个字段。' };
        }
        over.unit = unit;
      }

      if (intent.goalType !== undefined) {
        if (!GOAL_TYPES.has(intent.goalType)) {
          return {
            ok: false,
            reason: 'invalid',
            message: `达成口径应为 atLeast / atMost / exactly，收到「${intent.goalType}」。`,
          };
        }
        over.goalType = intent.goalType as HabitGoalType;
      }

      const id = await habitActions.createHabit(name, over);
      return { ok: true, taskId: id, entityId: id, entityType: 'HABIT' };
    }
  }
}
