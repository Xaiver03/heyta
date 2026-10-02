/**
 * 任务动作（宿主无关）
 * =====================
 *
 * 🔴 这个文件修的是一个**真实的架构违规**，不是"顺手整理"。
 *
 * ADR-0003 §2.1 说业务逻辑必须在 `packages/` 里。但"新建任务"到底是哪些字段、
 * "完成"是写 `completedAt` 还是 `completed`、软删除该发 `DEL` 还是改标志位 ——
 * 这些**全是产品语义**，而它们原本在应用壳里各写了一份：
 *
 *   apps/web/src/features/tasks/store.ts   7 处 op 构造
 *   apps/node-host/src/host.ts             3 处 op 构造
 *
 * 两边的行为**已经不一致了**（例如 entityId 的生成方式），而且移动端落地
 * 就会变成第三份。分歧本身不一定立刻出 bug，但它保证了**同一个操作在不同
 * 平台上产生不同的 op** —— 而这正是同步系统里最难查的一类问题：
 * 两台设备看起来在做同一件事，op 日志里却不是同一种东西。
 *
 * 所以：**op 的构造只有这里一份。** 宿主的 UI 层只负责收集用户输入并调用它。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两个不能改的细节（都是踩过的坑，不是风格偏好）：
 *
 * 1. **"完成"用 `completedAt` 的有无表示，不另设 `completed` 布尔。**
 *    两个字段必然会在某个路径上不一致，而那时没有"对的"那个。
 *
 * 2. **清除类字段要写 `null`，不能写 `undefined`。**
 *    `undefined` 会被 `JSON.stringify` 丢掉，于是载荷里那个键**根本不存在**，
 *    对端收到后既不会设置也不会清除 —— 「取消完成」/「清除截止时间」在另一端
 *    **静默失效**（本地看起来是对的，因为本地状态还留着旧值）。
 *    reducer 负责把 `null` 变成真正的字段删除。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  Priority,
  isValidRecurrenceRule,
  nextOccurrence,
  parseLocalDate,
  startOfDay,
  toLocalDate,
  today,
  validateParentChange,
  type QuadrantDropPlan,
  type Task,
} from '@heyta/domain';
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import { newTaskId } from './ids.js';
/**
 * 🔴 任务完成一个**重复**任务时，它的提醒要跟着新的截止走
 * （见 `reminder-actions.ts` 里那个函数的文件头）。
 *
 * ⚠️ 这**不构成运行时循环依赖**：`reminder-actions.ts` 对 `./actions.js` 的引用是
 * `import type`（编译后被抹掉），所以运行时只有一条边 `actions → reminder-actions`。
 */
import { rescheduleRemindersForRepeat } from './reminder-actions.js';

/**
 * 动作层需要引擎能力的最小面。
 *
 * 刻意**不用**具体的 `OpLogEngine` 类型：动作层只该知道"我能派发 intent、
 * 我能读状态"。收窄接口让这个文件能在不搭起整个引擎的情况下被测试，
 * 也让它不可能不小心绕开 op-log 去改状态（它压根没有 `setState`）。
 */
export interface ActionContext {
  dispatch(intent: OpIntent): Promise<unknown>;
  getState(): MaterializedState;
}

/** 建任务时可覆盖的字段。与 `addTask` 的 `over` 参数同义。 */
export interface NewTaskFields {
  priority?: Priority;
  dueDate?: number;
  projectId?: string;
  important?: boolean;
  /**
   * 备注（Markdown）。
   *
   * 🔴 **字段名是 `note`（单数），必须与 `Task.note` 一致。**
   * 这里曾经叫 `notes` —— 而 `payload: { title, priority, ...over }` 会把它
   * **原样**写成载荷里的 `notes` 字段。实测确认：`create(t, { notes: 'x' })` 之后
   * `task.note === undefined`、`task.notes === 'x'`。
   * 也就是说这条备注**会同步到每一台设备，而没有任何视图读得到它**
   * （视图读的是 `Task.note`）—— 数据没丢，但那和丢了没区别。
   *
   * 这正是 AGENTS.md #20 的形状：字段名差一个字母，静默失效，不报错。
   * ⚠️ **拦住改名的不是测试，是 `typecheck`**（接口字段名，`TS2561`）；
   * `repeat-actions.spec.ts` 里那条测试守的是**运行时落点**（载荷键 → `Task` 字段）。
   * 别把功劳记错 —— 我最初就写成了"测试会红"，实测它是绿的。
   */
  note?: string;
  /**
   * 排期起点（epoch ms，ADR-0043）。「点空白建任务带日期」（goal §3.2 手势 4）
   * 的落点：既有建任务 op **带上日期字段**，一次 CRT 完成、不 fan-out。
   */
  startDate?: number;
}

export interface TaskActionsOptions {
  /**
   * 时间源。默认 `Date.now`。
   *
   * 可注入的理由与 `OpLogEngine.now` 相同：`completedAt` 是**写进载荷的数据**，
   * 不是日志元数据；若它来自真实时钟而引擎用注入时钟，测试里两者会不一致，
   * 于是"完成时间"这类断言只能靠容忍误差 —— 那等于没断言。
   */
  now?: () => number;
  /**
   * 实体 id 生成器。默认 `newTaskId()`。
   *
   * 可注入的理由和 `now` 一样，但更硬：**不注入就没法稳定地断言顺序**。
   * 列表按 (createdAt, id) 排序，而 id 是随机的 —— 三条随机 id 恰好已经是
   * 升序的概率是 1/6，于是"排序真的生效了吗"这类断言会**随机变红**。
   * 一个随机失败的测试比没有测试更糟：它教人忽略红色。
   */
  newTaskId?: () => string;
}

export interface TaskActions {
  /**
   * 新建任务。返回新实体 id。
   *
   * 空标题**抛错**而不静默忽略：这个 API 的调用方是程序（测试、CLI、脚本），
   * 静默返回会让调用方以为建成功了。UI 层要"用户按了空回车就什么都不做"，
   * 应当自己在调用前判断 —— 那是**交互**决策，不是**数据**决策。
   */
  create(title: string, over?: NewTaskFields): Promise<string>;
  /** 改标题。 */
  rename(entityId: string, title: string): Promise<void>;
  /** 显式设置完成态（幂等，不像 `toggle` 依赖当前状态）。 */
  setCompleted(entityId: string, completed: boolean): Promise<void>;
  /** 在完成/未完成之间切换。 */
  toggleCompleted(entityId: string): Promise<void>;
  /** 软删除（发 `DEL` op，由 reducer 转成墓碑 `deletedAt`）。 */
  remove(entityId: string): Promise<void>;
  /**
   * 从回收站恢复。
   *
   * ═════════════════════════════════════════════════════════════════════
   * 🔴 **为什么是"写一条新 op 覆盖"，而不是"清墓碑"或"只改本地状态"。**
   *
   * 1. **必须发 op。** 只把本地的 `deletedAt` 抹掉，另一台设备回放不到任何东西，
   *    它那边条目仍是删除状态 —— 而且下次同步会把墓碑再推回来。
   *    这就是"本地生效了但没同步"的那半个 bug（op-log 纪律，§3.4）。
   *
   * 2. **发的是一条普通 `UPD`，payload 是 `{ deletedAt: null }`。**
   *    reducer 早有约定：**载荷里某个键为 `null` = 显式清除该字段**
   *    （见 `op-log/src/state.ts` 的 `toDelete`）。于是 `deletedAt` 真的消失、
   *    条目回到存活状态。**不需要新的 op 类型、不需要改 reducer、不需要
   *    bump schema** —— 老客户端回放同一条 `UPD` 会得到**逐字相同**的结果
   *    （`null` → 删字段是既有语义），这就是可加性/向前兼容。
   *
   *    反过来，"清墓碑"（真去删 op-log 里那条 DEL / 删实体记录）做不到同步：
   *    op-log 是只追加的事实日志，删掉一条本地事实不会让别的设备也删；
   *    而"写一个 `deleted: false` 之类的布尔"会引入**第二个删除真相来源**，
   *    两个字段迟早不一致 —— 与 `completedAt` 不设 `completed` 布尔同一条理由。
   *
   * 3. **原字段全都在。** DELETE 分支只往墓碑上盖 `deletedAt` / `updatedAt` /
   *    时钟（`{ ...existing, deletedAt }`），标题、备注、清单、标签、日期、
   *    重复规则**一个都没丢**。所以恢复能把它们全部还原 —— 见
   *    `trash-actions.spec.ts` 里逐字段的断言。
   * ═════════════════════════════════════════════════════════════════════
   *
   * 已经彻底删除（`purgedAt` 存在）的条目**拒绝恢复**：那是不可逆的。
   * 本来就没被删除时**不发 op**（没有用户意图要落库，发空 op 只是噪声）。
   */
  restore(entityId: string): Promise<void>;
  /**
   * 彻底删除（purge）—— 回收站里的**不可逆**动作。
   *
   * 发一条 `UPD`，写入可加性标记 `purgedAt`（见 `EntityBase.purgedAt`）：
   *   - 回收站按 `purgedAt` 过滤，所以它从这里消失；
   *   - `deletedAt` **保留** —— 墓碑不能被清掉，否则离线端会把它当成
   *     "从未删除"又同步回来；
   *   - `restore()` 从此拒绝它，因此对用户而言是真的不可恢复。
   *
   * 🔴 **对依赖诚实**：这**不**抹掉 op-log 里的历史载荷（只追加的日志），
   * 也不是加密擦除。它关闭的是"恢复"这条路，以及"回收站里继续看得到"。
   * 真要物理擦除需要协议级支持，不在本轮范围。
   *
   * 只能对**已软删除**的条目用：对一条活着的任务发 purge 会让它在
   * 没有任何墓碑的情况下从视图里消失，而离线端完全不知道发生过什么。
   */
  purge(entityId: string): Promise<void>;
  setPriority(entityId: string, priority: Priority): Promise<void>;
  /** 四象限的"重要"维度。 */
  setImportant(entityId: string, important: boolean): Promise<void>;
  /**
   * **一次拖放 = 一条 op。**
   *
   * 拖进某个象限同时决定"重要"和"紧急"两件事，而紧急是从 `dueDate` 推导的 ——
   * 所以一个拖放意图天然要写两个字段。
   *
   * 🔴 **为什么不能拆成 `setImportant` + `setDueDate` 两次调用**：
   *   - 那是**两条 op**，而 AGENTS.md §3.4 要求"一个用户意图 = 一个 op"；
   *   - 更糟的是**中间态是可见的**：第一秒"重要但截止时间还没改"，
   *     如果这时同步或崩溃，用户会得到一个"改了一半"的任务。
   *     `apps/web` 的 `QuadrantBoard` 原来就是这么写的，注释还写着
   *     "一次操作 = 一条 op"，而代码是两次 `await`。
   *
   * 投放计划由领域层的纯函数 `planQuadrantDrop` 算出来 —— 那是产品语义，
   * 有穷举测试（4 象限 × 3 种截止时间状态）。这里只负责**原子地写下去**。
   */
  setQuadrantDrop(entityId: string, plan: QuadrantDropPlan): Promise<void>;
  /** 传 `undefined` 表示清除截止时间（会写成 `null`，见文件头第 2 条）。 */
  setDueDate(entityId: string, dueDate: number | undefined): Promise<void>;
  /**
   * 顺延：把**逾期**任务的截止时间推到**今天**，保留原来的时刻
   * （"昨天 09:00 逾期" → "今天 09:00"）。滴答的分组「顺延」就是这个语义。
   *
   * 🔴 **"推到哪、保不保留时刻"是产品语义**，所以它住在这里而不是界面里 ——
   * 界面只说"用户要顺延这一条"。写成 `setDueDate(id, 今天零点)` 那种
   * 界面自己算日期的形状，下一端抄第二遍时就会有一端丢掉时刻。
   *
   * 幂等边界（都不产生 op，直接 return）：
   *   - 任务不存在或已删除（`taskOf` 过滤）；
   *   - 没有截止时间 —— 没有日期就无所谓"延"；
   *   - 已完成 —— 完成的任务不该被改日期；
   *   - **不逾期**（截止在今天或未来）—— "顺延到今天"对它们是倒退。
   *     界面上的按钮只出现在逾期分组头，但动作层不信任这一点：
   *     按钮会过时（同步刚把任务改成非逾期，列表还没重渲染），
   *     让动作层把"只能顺延逾期任务"钉死才是真的钉死。
   */
  postponeToToday(entityId: string): Promise<void>;
  /**
   * 排期（时间线 P2，[ADR-0043](../docs/adr/0043-timeline-p2-task-start-date-duration.md)）。
   *
   * 🔴 **一次拖放意图 = 一条 op**，与 `setQuadrantDrop` 同一条纪律：
   * 「泳道拖上轴」「拖条移动」「拖边改时长」在界面上是三种手势，
   * 但它们都是"写这个任务的时间坐标"这一个意图 —— 拆成多次调用就会产生
   * 中间态可见的半截排期（那条注释里的"改了一半"事故在排期面上会重演）。
   *
   * 🔴 **「字段在不在对象里」是有语义的**（与整组覆盖的 `setTags` 相反）：
   *   - `{ startDate }` —— 移动：只改起点，**时长不动**；
   *   - `{ durationMinutes }` —— 改时长：起点不动；
   *   - `{ startDate, durationMinutes }` —— 从泳道拖上轴：一次定两个；
   *   - `{ startDate: undefined }` —— 显式清除该字段（写成 `null`，老约定）。
   *   没有出现在对象里的字段**绝不进 payload**（字段级 LWW 不碰它）。
   *
   * 产品语义（住在这里，不在界面里 —— §3.5）：
   *   - `durationMinutes` **夹取**到 `[MIN, MAX]` 并取整（与 `buildTimeline` 同一档）：
   *     拖边算出来的像素时长不该原样进库；
   *   - 非法值（NaN / Infinity / ≤ 0 的起点）**写之前 throw** —— 让动作层把
   *     "垃圾不进 op-log"钉死，界面算错时不会静默写坏一条排期。
   *
   * ⚠️ `dueDate` **不在本动作的管辖区**：它是"什么时候到期"（日历/提醒/象限），
   * 排期拖拽不碰它 —— 归 `setDueDate` / `setQuadrantDrop`。
   */
  setSchedule(
    entityId: string,
    schedule: { startDate?: number; durationMinutes?: number },
  ): Promise<void>;
  /**
   * 改备注（Markdown）。传 `undefined` 表示清除（同样写成 `null`）。
   *
   * 🔴 **为什么必须有这个动作**：`create` 能带 `note`，但改不了 ——
   * 于是"把 AI 拆解出的清单写进备注"这类能力**没有任何落点**。
   * 一个只能创建时写一次的字段，会让所有"事后生成内容"的功能无处可去。
   *
   * ⚠️ 字段名是 `note`（单数），与 `Task.note` 一致 ——
   * 理由见 `NewTaskFields.note` 上那段（曾经写成 `notes`，
   * 数据同步到了每台设备却没有任何视图读得到）。
   */
  setNote(entityId: string, note: string | undefined): Promise<void>;
  /** 传 `undefined` 表示移出项目（会写成 `null`）。 */
  moveToProject(entityId: string, projectId: string | undefined): Promise<void>;

  /**
   * 改任务的**父**（子任务语义，B1-3 的写路径）。
   *
   * `undefined` = 提为顶级任务（写成 `null`，与 `setDueDate` / `setNote` 同一条约定）。
   *
   * 🔴 **失败时 `throw`，且必须在写之前 throw。** 拒绝原因见
   * `ParentChangeRejection`，其中 `cycle` 最要紧：把 A 的父设成 A 的后代
   * 会造出一个**环**，后果是树构建/折叠/计数**无限递归**（栈溢出，整屏打不开）。
   *
   * ⚠️ 校验用领域层的 `validateParentChange`，**不在这里自己算** ——
   * 那是四端必须给出一致答案的产品语义（AGENTS.md §3.5）。
   */
  setParent(entityId: string, parentId: string | undefined): Promise<void>;

  /**
   * 覆盖式设置任务的标签集合（**一次调用 = 一条 op**）。
   *
   * 🔴 **为什么是"整组覆盖"而不是 `addTag` / `removeTag`。**
   * `Task.tagIds` 对 reducer 而言是**普通字段**，合并语义是字段级 LWW
   * （`op-log/src/state.ts` 只覆盖 payload 里出现的字段，数组整体替换）。
   * 若做成 add/remove，就必须让 reducer 认识"数组求并集/差集"这种**新的合并语义**
   * —— 那是线协议级别的改动。而"一个用户意图 = 一条 op"（AGENTS.md §3.4）
   * 用整组覆盖就能满足：界面上点亮一个标签，由界面算出新的整组，写**一条** op。
   *
   * ⚠️ **代价要如实说，不要粉饰**：两台设备**同时**给同一个任务加**不同**的标签时，
   * 字段级 LWW 会丢掉一边（后写的那一组赢）。这与 `projectId` / `note` 的冲突行为
   * 同类，**不是这里新引入的**；要真正做集合合并需要给 reducer 加集合语义，
   * 那是另一份 ADR。本轮不假装它能合并。
   *
   * 传**空数组**表示清空（写成 `null`，与 `setDueDate` / `setNote` 同一条约定：
   * `[]` 和"没有这个字段"是同一件事的两种表示，只留一种）。
   */
  setTags(entityId: string, tagIds: string[]): Promise<void>;

  /**
   * 设置重复规则（RFC 5545 RRULE 串）。传 `undefined` 表示取消重复。
   *
   * 🔴 **规则串由调用方从 `Recurrence.*` 构造，不要手拼** ——
   * `setRepeat(id, 'FREQ=WEEKLY;BYDAY=MO')` 这种字面串在调用点看不出对错，
   * 而拼错一个分号只会静默变成另一条规则。
   *
   * 产品语义（都在这里，不在界面里）：
   *   - **锚点钉一次**：`repeatDtstart` 取"设规则那一刻的截止日"，之后不再变。
   *     不这么做的话，"每两周的周三"会随着 `dueDate` 每次推进而整体漂移。
   *   - **重复需要一个起点**：任务原本没有截止日时，顺手把它设成**今天**。
   *     否则会出现"有规则、没日子"的任务 —— 它在任何一个日期视图里都不出现。
   */
  setRepeat(entityId: string, rule: string | undefined): Promise<void>;

  /**
   * 取某个任务的重复规则；没有规则（或规则串已损坏）时返回 `undefined`。
   *
   * 视图层要靠它决定"要不要画那个重复图标"，也要靠它显示 `describeRecurrence`。
   * 规则串损坏时返回 `undefined` 而不是把坏串透出去：`occurrencesInRange`
   * 遇到非法规则会**抛错**，而 "这一条任务的规则坏了" 不该让整个日期视图白屏。
   */
  repeatOf(entityId: string): { rule: string; dtstart: string } | undefined;

  /** 未删除的任务，按创建时间排序（同刻按 id 字典序，保证跨端顺序一致）。 */
  listTasks(): Task[];
  /**
   * 回收站：**已软删除且未彻底删除**的任务，最近删除的排在最前面。
   *
   * 排序必须跨端一致（同刻按 id 字典序），否则同一份数据在两台设备上
   * 顺序不同而没有任何一处报错 —— 与 `listTasks()` 的同一条理由。
   */
  listTrashed(): Task[];
  /**
   * 未删除**且未完成**的任务，顺序同 `listTasks()`。
   *
   * 🔴 存在的理由是"未完成"是**产品语义**：它此前在两处各写了一遍
   * （`apps/web` 的 `selectVisibleTasks` 与 `apps/mobile` 的 `TasksScreen` 分组），
   * 而专注页要选任务时会变成第三遍。`completedAt === undefined` 看起来只有一行，
   * 但"什么算完成"一旦改动（比如将来允许"部分完成"），三处就会分叉。
   */
  listPendingTasks(): Task[];
  /** 取单个未删除任务；不存在或已删除返回 `undefined`。 */
  findTask(entityId: string): Task | undefined;
}

export function createTaskActions(
  ctx: ActionContext,
  options: TaskActionsOptions = {},
): TaskActions {
  const now = options.now ?? Date.now;
  const makeId = options.newTaskId ?? newTaskId;

  const taskOf = (entityId: string): Task | undefined => {
    const task = ctx.getState().tasks[entityId];
    if (task === undefined || task.deletedAt !== undefined) return undefined;
    return task;
  };

  const update = async (entityId: string, payload: Record<string, unknown>): Promise<void> => {
    await ctx.dispatch({
      entityType: 'TASK' as EntityType,
      entityId,
      opType: OpType.Update,
      payload,
    });
  };

  /**
   * 读任务的重复规则。规则缺失**或规则串已损坏**都返回 `undefined`。
   *
   * 为什么不把坏串透出去：`occurrencesInRange` / `nextOccurrence` 对非法规则会**抛错**，
   * 而"某一条任务的规则坏了"不该让整个日期视图白屏。坏规则在读取侧退化成"不重复"，
   * 数据仍在 op-log 里，用户可以把规则重设一遍。
   */
  const repeatOf = (task: Task | undefined): { rule: string; dtstart: string } | undefined => {
    if (task === undefined) return undefined;
    const { repeatRule, repeatDtstart } = task;
    if (repeatRule === undefined || repeatDtstart === undefined) return undefined;
    if (!isValidRecurrenceRule(repeatRule)) return undefined;
    return { rule: repeatRule, dtstart: repeatDtstart };
  };

  /**
   * 勾选/取消勾选一个任务 —— 重复任务走的是**另一条语义**。
   *
   * 🔴 **完成一个重复任务 = 把到期日推进到下一次，而不是写 `completedAt`。**
   *
   * 写 `completedAt` 会让它掉进「已完成」分组并且**再也不出来** —— 而"每周一"的任务
   * 恰恰是下周还要做的。上游 `nextAfterCompletion` 的注释把这层说得很清楚：
   * 重复的是一条**实例**，不是那条任务本身。
   *
   * ⚠️ **推进的基准是"当前到期日"，不是"完成时刻"。**
   * 用完成时刻的话：一条 9/14(周一) 的任务在 9/13(周日) 被提前勾掉，
   * "下一个 9/14 之后的周一"仍然是 9/14 —— 到期日纹丝不动，用户会以为勾选没生效。
   * 所以固定排期一律从当前到期日往后推，"每周一"永远落在周一。
   *
   * 规则已经走到尽头（`UNTIL`/`COUNT` 用尽 → `nextOccurrence` 返回 `undefined`）时
   * **退回普通完成**：这一次是最后一件，之后就没有了。
   */
  const completeTask = async (entityId: string, task: Task): Promise<void> => {
    const repeat = repeatOf(task);
    if (repeat === undefined) {
      await update(entityId, { completedAt: now() });
      return;
    }

    const from = task.dueDate !== undefined ? toLocalDate(task.dueDate) : repeat.dtstart;
    const next = nextOccurrence(repeat.rule, repeat.dtstart, from);
    if (next === undefined) {
      await update(entityId, { completedAt: now() });
      return;
    }

    // 只动到期日：`completedAt` 保持不存在，任务仍然是"待办"。
    // 要把它标成完成必须显式清掉规则，否则两种状态会互相打架。
    const nextDueMs = parseLocalDate(next).getTime();
    await update(entityId, { dueDate: nextDueMs });

    /**
     * 🔴 **提醒必须跟着新的截止走** —— 见 `reminder-actions.ts` 的
     * `rescheduleRemindersForRepeat`。
     *
     * 带 `offsetMs` 的提醒重置到"新截止 − 提前量"；**绝对时刻**的提醒不动
     * （"每天 9 点提醒我"里的 9 点是绝对时间，跟着 `dueDate` 漂移反而是错的）。
     * 这两句话就是 `nextTriggerAfterRepeat` 的定义，这里**不重写**它 —— 只调用。
     *
     * 不接这一步的后果（本仓"最后一米"的又一个实例）：用户给"每周一的会"
     * 挂了"提前 30 分钟"，勾掉之后任务顺延到下周，而那条提醒**仍然钉在上一个周一**
     * —— 到点弹一条通知，点进去是下周的任务。而所有 op 都是对的、
     * 相关单测也是绿的，因为"任务顺延"与"提醒顺延"之间**没有任何调用边**。
     */
    await rescheduleRemindersForRepeat(ctx, entityId, nextDueMs);
  };

  return {
    async create(title, over = {}) {
      const trimmed = title.trim();
      if (trimmed === '') throw new Error('任务标题不能为空');

      const entityId = makeId();
      await ctx.dispatch({
        entityType: 'TASK' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: { title: trimmed, priority: Priority.None, ...over },
      });
      return entityId;
    },

    async rename(entityId, title) {
      const trimmed = title.trim();
      if (trimmed === '') throw new Error('任务标题不能为空');
      if (taskOf(entityId) === undefined) throw new Error(`找不到任务「${entityId}」`);
      await update(entityId, { title: trimmed });
    },

    async setCompleted(entityId, completed) {
      const task = taskOf(entityId);
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);
      if (completed) {
        await completeTask(entityId, task);
        return;
      }
      // null 而不是 undefined —— 见文件头第 2 条。
      await update(entityId, { completedAt: null });
    },

    async toggleCompleted(entityId) {
      const task = taskOf(entityId);
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);
      if (task.completedAt === undefined) {
        await completeTask(entityId, task);
        return;
      }
      await update(entityId, { completedAt: null });
    },

    async remove(entityId) {
      // 软删除（墓碑）。物理删除会让同步端永远看不到这次删除。
      await ctx.dispatch({
        entityType: 'TASK' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async restore(entityId) {
      // 直接读桶，**不用 `taskOf`**：那个辅助函数把墓碑过滤掉了，
      // 而这里恰恰要处理墓碑。
      const task = ctx.getState().tasks[entityId];
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);
      if (task.purgedAt !== undefined) {
        // 不可逆是 purge 的核心语义，必须在动作层真的拦住，
        // 而不是只靠界面不画那个按钮。
        throw new Error(`任务「${entityId}」已被彻底删除，无法恢复`);
      }
      // 本来就没删除：不产生 op。见 `TaskActions.restore` 的注释。
      if (task.deletedAt === undefined) return;

      // 🔴 `null` = 显式清除 `deletedAt`（reducer 的既有约定）。
      // 不要写 `deletedAt: undefined` —— 那会被 JSON 丢掉，
      // 对端既不清除也不报错，"恢复"在另一台设备上静默失效。
      // 原字段（标题/备注/清单/标签/日期/重复规则）本来就在墓碑里，无需重写。
      await update(entityId, { deletedAt: null });
    },

    async purge(entityId) {
      const task = ctx.getState().tasks[entityId];
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);
      if (task.deletedAt === undefined) {
        throw new Error(`任务「${entityId}」不在回收站里，不能彻底删除`);
      }
      // 已彻底删除：幂等，不重复发 op。
      if (task.purgedAt !== undefined) return;

      // 只加标记，**不清 `deletedAt`** —— 墓碑留着，离线端才不会复活它。
      await update(entityId, { purgedAt: now() });
    },

    setPriority(entityId, priority) {
      return update(entityId, { priority });
    },

    setImportant(entityId, important) {
      return update(entityId, { important });
    },

    setQuadrantDrop(entityId, plan) {
      // ⚠️ **只有 `dueDate !== undefined` 时才把 dueDate 放进 payload。**
      //    `undefined` 在这里的语义是"不用改"，而 `null` 是"清除" ——
      //    把 `undefined` 直接塞进 payload 会让 reducer 把它当成一次
      //    "写入 undefined"，在 `dueDate` 这个 `?: number` 字段上表现为
      //    **静默清除**（同 AGENTS.md #20 的形状）。
      const payload: Record<string, unknown> = { important: plan.important };
      if (plan.dueDate !== undefined) {
        payload.dueDate = plan.dueDate;
      }
      return update(entityId, payload);
    },

    setDueDate(entityId, dueDate) {
      // undefined → null：null 能穿过 JSON 表达"清除"。
      return update(entityId, { dueDate: dueDate ?? null });
    },

    async postponeToToday(entityId) {
      const task = taskOf(entityId);
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);
      // 幂等边界见接口注释：这些情况不产生 op。
      if (
        task.dueDate === undefined ||
        task.completedAt !== undefined ||
        startOfDay(task.dueDate) >= startOfDay(now())
      ) {
        return;
      }
      const timeOfDay = task.dueDate - startOfDay(task.dueDate);
      await update(entityId, { dueDate: startOfDay(now()) + timeOfDay });
    },

    async setSchedule(entityId, schedule) {
      // 存在性 throw（与 rename 同一条纪律）：静默成功会让用户以为排上了。
      if (taskOf(entityId) === undefined) throw new Error(`找不到任务「${entityId}」`);
      const payload: Record<string, unknown> = {};
      // 「字段在不在」见接口注释：只有调用方**点名**的字段才进 payload。
      if ('startDate' in schedule) {
        const v = schedule.startDate;
        if (v === undefined) {
          payload.startDate = null; // 显式清除（老约定：null 穿过 JSON）
        } else if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          throw new Error(`非法的排期起点：${String(v)}`);
        } else {
          payload.startDate = v;
        }
      }
      if ('durationMinutes' in schedule) {
        const v = schedule.durationMinutes;
        if (v === undefined) {
          payload.durationMinutes = null;
        } else if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          throw new Error(`非法的排期时长：${String(v)}`);
        } else {
          // 拖边算出来的像素时长在这里夹取：与 buildTimeline 同一档 [5, 480]。
          payload.durationMinutes = Math.min(
            MAX_DURATION_MINUTES,
            Math.max(MIN_DURATION_MINUTES, Math.round(v)),
          );
        }
      }
      if (Object.keys(payload).length === 0) return; // 幂等：没点名任何字段就不写
      return update(entityId, payload);
    },

    setNote(entityId, note) {
      // undefined → null：与 setDueDate 同一个理由，null 能穿过 JSON 表达"清除"。
      return update(entityId, { note: note ?? null });
    },

    // 🔴 **必须是 `async`**：校验失败时 `throw` 要变成一个被拒绝的 Promise，
    // 与接口签名一致。非 async 会同步抛出，而调用方 `void actions.setParent(...)`
    // 接不住（与 `setTags` 同一个坑，那条注释里有完整记录）。
    async setParent(entityId, parentId) {
      const verdict = validateParentChange(
        Object.values(ctx.getState().tasks),
        entityId,
        parentId,
      );
      if (!verdict.ok) {
        // 把领域层的封闭集合翻成一句能定位的话。**不吞、不降级成静默空操作** ——
        // 静默的后果是"用户以为移好了，树没变"，而本仓吃过这一类。
        throw new Error(`改父被拒绝（${verdict.reason}）：${entityId} → ${parentId ?? '顶级'}`);
      }
      // `undefined` → `null`：null 能穿过 JSON 表达"清除"（与 setNote 同）。
      return update(entityId, { parentId: verdict.parentId ?? null });
    },

    moveToProject(entityId, projectId) {
      return update(entityId, { projectId: projectId ?? null });
    },

    // 🔴 **必须是 `async`。** 校验失败时 `throw` 会变成一个**被拒绝的 Promise** ——
    // 与接口签名（`Promise<void>`）一致。写成非 async 的话它会**同步抛出**：
    // 调用方 `void actions.setTags(...)` 或 `.catch(...)` 都接不住，
    // 异常会直接穿过 React 的事件处理函数冒到顶层。
    // （这是本仓库"接口说的是 Promise、实际同步抛"的第 N 次 —— 测试当场抓到了。）
    async setTags(entityId, tagIds) {
      // 去重：界面上"点两次同一个标签"不该写出 `[a, a]` —— 那样这条任务的
      // 标签数会比标签总数还多，而没有任何一处会报错。
      const unique = [...new Set(tagIds)];

      /**
       * 🔴 **每个标签都必须真的存在且没被删。**
       *
       * 写进一个悬空 id 的后果是"任务上挂着一个任何视图都查不到的标签"：
       * 界面上表现为"标签数对不上"，而 op-log 里只有一条看起来完全正常的 UPD。
       * 这类"数据里有个引用、视图里找不到目标"最难查，所以在**写入侧**就拦住。
       *
       * （`setDueDate` / `setNote` 之类的同类动作不校验任务是否存在 —— 这里
       *   保持与它们一致的形状：只校验**本动作新引入**的那个风险，即标签引用。）
       */
      for (const id of unique) {
        const tag = ctx.getState().tags[id];
        if (tag === undefined || tag.deletedAt !== undefined) {
          throw new Error(`找不到标签「${id}」`);
        }
      }

      // 空集合写 `null` 而不是 `[]` —— 见接口注释。
      await update(entityId, { tagIds: unique.length === 0 ? null : unique });
    },

    async setRepeat(entityId, rule) {
      const task = taskOf(entityId);
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);

      if (rule === undefined) {
        // 两个字段一起清：只清一个会留下"有锚点、没规则"的半截状态。
        await update(entityId, { repeatRule: null, repeatDtstart: null });
        return;
      }

      if (!isValidRecurrenceRule(rule)) throw new Error(`无效的重复规则：${rule}`);

      // 锚点钉一次：已有截止日就用它，否则用今天 —— 并顺手把截止日补上。
      // 不补的话会出现"有规则、没日子"的任务，它在任何日期视图里都不出现。
      const anchor = task.dueDate !== undefined ? toLocalDate(task.dueDate) : today(now());
      await update(entityId, {
        repeatRule: rule,
        repeatDtstart: anchor,
        ...(task.dueDate === undefined ? { dueDate: startOfDay(now()) } : {}),
      });
    },

    repeatOf(entityId) {
      return repeatOf(taskOf(entityId));
    },

    listTasks(): Task[] {
      return listAlive(ctx.getState().tasks).sort(byCanonicalOrder);
    },

    listPendingTasks(): Task[] {
      // 与 listTasks 同一份顺序、同一个"未删除"判据 —— 只有"未完成"是新增的。
      return listAlive(ctx.getState().tasks)
        .filter((task) => task.completedAt === undefined)
        .sort(byCanonicalOrder);
    },

    listTrashed(): Task[] {
      // 回收站 = 有墓碑、且没有被彻底删除。
      // `purgedAt` 之后 `deletedAt` 仍然在（墓碑必须留着），所以两个条件都要。
      return Object.values(ctx.getState().tasks)
        .filter((task) => task.deletedAt !== undefined && task.purgedAt === undefined)
        .sort(byDeletedOrder);
    },

    findTask: taskOf,
  };
}

/** 未软删除的任务（顺序未定义，调用方自己 sort）。 */
function listAlive(tasks: Record<string, Task>): Task[] {
  return Object.values(tasks).filter((task) => task.deletedAt === undefined);
}

/**
 * 回收站顺序：**最近删除的在前**，同刻按 id 字典序。
 *
 * 决胜项与 `byCanonicalOrder` 同一个理由：`deletedAt` 来自毫秒时钟，
 * 同一台设备连续删两条经常落在同一毫秒里，此时顺序会退化成
 * `Object.values` 的枚举顺序 —— 那是**各端不同**的。
 */
function byDeletedOrder(a: Task, b: Task): number {
  const ad = a.deletedAt ?? 0;
  const bd = b.deletedAt ?? 0;
  if (ad !== bd) return bd - ad;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 跨端一致的规范顺序：创建时间升序，同刻按 id 字典序。
 *
 * 🔴 **不要去掉那个 id 决胜**：`createdAt` 来自毫秒时钟，同一台设备连续建两条
 * 经常落在同一毫秒里，此时排序结果取决于 `Object.values` 的枚举顺序 ——
 * 那是**各端不同**的（IndexedDB 按索引键、SQLite 按主键，见 AGENTS.md §7 第 16 条）。
 * 表现是同一份数据在两台设备上顺序不同，而没有任何一处报错。
 */
function byCanonicalOrder(a: Task, b: Task): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
