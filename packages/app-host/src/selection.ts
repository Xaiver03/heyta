/**
 * 跨视图、跨端的**选中态**。
 *
 * 为什么在 `packages/app-host` 而不是各壳里：
 *
 * 1. 它在语义上是**每个宿主都要做、且一模一样**的那类管道（AGENTS §3.5），
 *    不是平台差异。此前它散成三份：web 任务侧**根本没有**（行体不可点）、
 *    web 习惯侧是 `HabitsView` 的一个 `useState`、移动端任务侧是
 *    `TasksScreen` 的 `detailTaskId: useState`。三份 = 三套回落规则，
 *    而"选中对象消失时怎么办"这种边界条件恰恰是最容易各写各的。
 * 2. 详情面（第四栏）要能在任务/习惯/便签之间统一渲染，
 *    前提是"当前选中了什么"有一个共同的答案。
 *
 * 🔴 **它不是数据。** 不进 op-log、不参与向量时钟、不同步 ——
 * 另一台设备上的选中与本机无关。所以这里**不构造任何 op**，
 * 也不许有调用方把它当事实源（AGENTS §3.4）。
 *
 * 本包零 UI 依赖（`package.json` 里没有 react/zustand），所以订阅模型
 * 用最朴素的 listener 集合；各壳自己决定怎么把它接进渲染层
 * （web 的 store 是 zustand，移动端是 `useSyncExternalStore`）。
 */

/**
 * 可以被选中的实体类别。新增一类要同时改这里 —— 它是封闭词表。
 *
 * 🔴 **只有"界面会指出现在看的是哪一条"的那些类别才许进来。**
 * `pnpm check:selection-single-source` 的断言 D 会逐类查宿主有没有消费者，
 * 加一个没有消费者的 kind 直接红。这条纪律拦的是本仓库记过的那个形状：
 * 词表里先写好「清单 / 标签 / 纪念日」，槽位建了、`pruneSelection` 的谓词也写了，
 * 但界面上没有任何一处会选中它们 —— 于是"有这个功能"变成一个自欺的读数。
 * 清单与标签今天在两侧都是**筛选/导航**（点它换中间那一栏的内容），不是"看哪一条"；
 * `EVENT` 还不在物化状态里。它们各自等到真有详情面时再加。
 */
export type SelectableKind = 'task' | 'habit' | 'note';

export const SELECTABLE_KINDS: readonly SelectableKind[] = ['task', 'habit', 'note'];

export type SelectionSnapshot = Readonly<Partial<Record<SelectableKind, string>>>;

export interface SelectionStore {
  /** 某一类当前选中的实体 id；没选中返回 `null`。 */
  get(kind: SelectableKind): string | null;
  /** 全量快照（订阅回调里用得到，避免逐类再查）。 */
  snapshot(): SelectionSnapshot;
  /**
   * 选中某一条。**同一类里再选另一条是替换，不是叠加** ——
   * 每一类至多一个选中项。传 `null` 等价于 `clear(kind)`。
   */
  select(kind: SelectableKind, id: string | null): void;
  /** 取消某一类的选中；不带 `kind` = 清空全部（切账号/退出登录时用）。 */
  clear(kind?: SelectableKind): void;
  /** 订阅变化，返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

export function createSelectionStore(
  initial?: Readonly<Partial<Record<SelectableKind, string | null>>>,
): SelectionStore {
  const slots = new Map<SelectableKind, string>();
  const listeners = new Set<() => void>();
  /**
   * 🔴 快照**必须缓存**。宿主是用 `useSyncExternalStore(subscribe, store.snapshot)`
   * 接的，而它靠 `Object.is` 比较两次 `getSnapshot()` 的返回值来决定要不要重渲染 ——
   * 每次新建对象会让 React 判定"永远在变"，直接死循环报警
   * （`The result of getSnapshot should be cached`）。
   * `apps/web/src/App.tsx` 里 zustand 那段注释记的是同一个坑的第二次出现。
   */
  let cached: SelectionSnapshot | null = null;

  for (const kind of SELECTABLE_KINDS) {
    const seed = initial?.[kind];
    if (seed) slots.set(kind, seed);
  }
  cached = build();

  function build(): SelectionSnapshot {
    const out: Record<SelectableKind, string> = {} as Record<SelectableKind, string>;
    for (const [kind, id] of slots) out[kind] = id;
    return out;
  }

  /** 任何会改变 `slots` 的动作之后都要走这里：换掉缓存并通知。 */
  const commit = () => {
    cached = build();
    // 复制一份再遍历：订阅者在回调里退订（组件卸载是常态）会在
    // Set 迭代过程中删元素，直接迭代会跳过邻居。
    for (const listener of [...listeners]) listener();
  };

  return {
    get: (kind) => slots.get(kind) ?? null,

    snapshot: () => cached as SelectionSnapshot,

    select: (kind, id) => {
      if (id === null) {
        if (!slots.delete(kind)) return;
      } else if (slots.get(kind) === id) {
        // 重复选中同一条**不通知** —— 否则宿主会因为"点了已经选中的行"
        // 白重渲染一次详情面。
        return;
      } else {
        slots.set(kind, id);
      }
      commit();
    },

    clear: (kind) => {
      const before = slots.size;
      if (kind === undefined) slots.clear();
      else slots.delete(kind);
      if (slots.size !== before) commit();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 选中的实体**已经不存在了**就把选中丢掉，否则原样返回。
 *
 * 🔴 `exists` 必须是"**这条实体还在不在**"，**不是**"它在当前筛选下可不可见"。
 * 两者混用会造出一个真实的坏行为：用户切一下筛选（比如从「今天」切到「收集箱」），
 * 正在详情面里编辑的那条任务就被判定"不存在"、选中被清空、详情面关掉。
 * 而实体被删除（或被彻底删除）时**必须**清空，否则详情面会继续显示一条
 * 已经不存在的东西 —— 那是界面在说谎。
 *
 * 单独导出成纯函数是因为这条规则是**本模块唯一会出错的地方**，
 * 它得能被独立地判红。
 */
export function pruneMissingSelection(
  selected: string | null,
  exists: (id: string) => boolean,
): string | null {
  if (selected === null) return null;
  return exists(selected) ? selected : null;
}

/**
 * 对**每一类**选中项跑一次 {@link pruneMissingSelection}。
 *
 * 为什么要有这一份而不是让每个视图各写一遍循环：回落规则只有一条，
 * 而"哪几类要回落"是词表决定的。视图各写循环的结果是新增一类时漏掉一处，
 * 症状是"删了那条，右边还在显示它" —— 只在漏掉的那一类上出现，最难复现。
 *
 * 调用时机由宿主决定（它在自己的数据变化时调），因为**事实源在各宿主手里**：
 * 本包不认识宿主的 store。传进来的谓词同样受上面那条红线约束 ——
 * 谓词要问"实体在不在"，不许问"当前视图筛不筛得到它"。
 */
export function pruneSelection(
  store: SelectionStore,
  existsByKind: Partial<Record<SelectableKind, (id: string) => boolean>>,
): void {
  for (const kind of SELECTABLE_KINDS) {
    const exists = existsByKind[kind];
    if (!exists) continue;
    const kept = pruneMissingSelection(store.get(kind), exists);
    if (kept === null && store.get(kind) !== null) store.select(kind, null);
  }
}

/** 键盘光标的移动方向：`-1` 上、`+1` 下。封闭成两值，不许传任意整数。 */
export type CursorDelta = -1 | 1;

/**
 * 在**当前视图渲染出来的那一串 id** 里移动选中，返回该选中的 id（列表为空返回 `null`）。
 *
 * 🔴 它只吃一串已经排好序的 id，**不自己排**。理由与 {@link pruneSelection} 同源：
 * "列表按什么顺序显示"的唯一所有者是那个视图（任务侧是日期分组 + 组内排序，
 * 习惯侧是面板顺序，便签侧是列表顺序）。这里再排一遍就是第二个所有者，
 * 症状是"界面上 ↓ 走到第 3 行，选中却跳到了第 5 行" —— 而且两边都不报错。
 * 所以宿主必须把**渲染顺序**传进来，不许传"数据顺序"。
 *
 * 四条规则，每条都有理由（也都有一条判据）：
 *
 * 1. **没选中时按方向进列表**：`+1` → 第一项，`-1` → 最后一项。
 *    光标从"用户按的那一下的方向"进来，而不是落到中间或什么都不做 ——
 *    按 ↓ 的人预期看到顶部，按 ↑ 的人预期看到底部。
 * 2. **到端点就夹住，不环绕**。环绕会让连按 ↓ 突然跳回顶部，
 *    而这正是长列表里最容易迷失的一刻；"已经到底了"本身是有用的信息。
 * 3. **选中的那条不在当前列表里**（切了筛选、或列表刚变）：同样按方向进列表
 *    （规则 1），**不去猜它"本来该在哪"** —— 猜的结果是跳到一个用户没指向的地方。
 * 4. **返回值可能等于当前值**。这不是浪费：调用方走 `select()`，而它对
 *    "同一类里重复选同一条"是**不通知**的（见上面那条注释），
 *    所以端点上连按不会让详情面白重渲染一次。
 *
 * ⚠️ 纯函数：不读 store、不写 store、不碰 DOM。"哪个视图、哪一类、
 * 焦点在不在输入框里"这些是宿主的判断，不是产品语义。
 */
export function moveSelectionInList(opts: {
  orderedIds: readonly string[];
  current: string | null;
  delta: CursorDelta;
}): string | null {
  const { orderedIds, current, delta } = opts;
  if (orderedIds.length === 0) return null;

  const at = current === null ? -1 : orderedIds.indexOf(current);
  if (at === -1) return delta > 0 ? (orderedIds[0] as string) : (orderedIds.at(-1) as string);

  const next = Math.min(orderedIds.length - 1, Math.max(0, at + delta));
  return orderedIds[next] as string;
}
