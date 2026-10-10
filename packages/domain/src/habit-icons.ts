/**
 * 习惯图标（闭集词表）
 * ====================
 *
 * 习惯列表每一行前面那个圆形图标。数据里存的是**下面这个词**（`'drop'`），
 * 不是字形 —— 字形（Lucide 的 `Droplets`）是各端自己的事：web 用 `lucide-react`，
 * 共享层用 `lucide` 的数据 + `HeytaIcon`，鸿蒙/SwiftUI 壳以后各画各的。
 * 把字形名写进磁盘，等于让一次换库把用户数据改掉。
 *
 * ## 🔴 为什么是**闭集**，而且为什么这些图标不替用户评判
 *
 * 与分类色同一条立场（`docs/plans/activity-categories-and-colors.md` §2）：
 * **App 永不判断某个活动健康／不健康。** 颜色靠"不给它起名"守住这条，
 * 图标守不住 —— 一个水杯就是水杯。所以这条红线只能落在**词表本身**上：
 * 这 24 个必须是中性的日常主题，**不许**出现带有价值判断的标签。加一个字形
 * = 替用户判断了一件事。
 *
 * 闭集还有一层作用：它让"图标"这个字段**能被校验**。自由文本的话，
 * 每个壳都会遇到"这个字符串该画成什么"，而答案只能是"画不出来"。
 *
 * ## 没设过图标的习惯画什么
 *
 * 画 `deriveHabitIcon` 算出来的那个。它不是随机数，也不是列表下标：
 *
 * - 随机 ⇒ 每次渲染换一个，看起来像界面在抖；
 * - 列表下标 ⇒ 删掉第一个习惯，后面每条的图标**全部往左挪一格**，
 *   而用户刚建立的"这条是水滴"的记忆就错位了。
 *
 * 所以它取 id 的哈希 —— **同一台设备上、同一条习惯，任何时候都算出同一个**，
 * 且与别的习惯的存在与否无关。这不是"持久化"：界面上没有的东西不必进磁盘
 * （ADR-0022 同一条推论），而用户**真的选过**的那个才需要。
 */

/**
 * 旧版已落盘习惯的派生图标集合。顺序与长度都必须稳定：没有显式 icon
 * 的历史习惯要继续显示原来的图形，即使选择器后来增加了新图标。
 */
const DERIVED_HABIT_ICONS = [
  'drop',
  'activity',
  'book',
  'moon',
  'leaf',
  'pencil',
  'sun',
  'music',
] as const;

/** 可用的图标 key。前八项是历史闭集，后面的 key 只用于显式选择。 */
export const HABIT_ICONS = [
  ...DERIVED_HABIT_ICONS,
  'heart',
  'strength',
  'meditation',
  'tea',
  'fruit',
  'cycling',
  'camera',
  'art',
  'code',
  'dental',
  'pet',
  'savings',
  'home',
  'language',
  'journal',
  'walking',
] as const;

export type HabitIcon = (typeof HABIT_ICONS)[number];

/**
 * 把持久化字段里的值读成图标 key。
 *
 * 🔴 **不认识的值一律当作"没设过"**（返回 `undefined`），不回退到第一项、也不抛错 ——
 * 与 `parseCategorySlot` 同一条理由：磁盘上会有别的写入方（更老的版本、别的壳、
 * 手改的数据），悄悄画成第一个图标会让一堆不相干的习惯看起来是一类。
 */
export function parseHabitIcon(raw: unknown): HabitIcon | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return HABIT_ICONS.find((icon) => icon === trimmed);
}

/**
 * 没设过图标时**派生**一个（见文件头：为什么既不能随机、也不能按下标）。
 *
 * FNV-1a 32 位：纯整数、无依赖、Hermes 与浏览器逐位一致 ——
 * 同一条习惯在四个端上必须画出同一个图标，而 `Math.random()` 或
 * `hash` 里混入的浮点都会让这件事静默地不成立。
 */
export function deriveHabitIcon(habitId: string): HabitIcon {
  let hash = 0x811c9dc5;
  for (let i = 0; i < habitId.length; i += 1) {
    hash ^= habitId.charCodeAt(i);
    // `Math.imul` 而不是 `*` + `|0`：后者在超过 2^53 时丢精度，
    // 丢精度的结果是不同 id 算出同一个值 —— 那正是这条哈希要避免的。
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return DERIVED_HABIT_ICONS[hash % DERIVED_HABIT_ICONS.length]!;
}

/**
 * 这条习惯**实际该画**的图标：用户选过的优先，没选过用派生的。
 *
 * 一个函数收口，四个端不许各写这个三元表达式 —— 写两份的结局是
 * 一端显示选过的、另一端显示派生的，而两边都"有图标"，没人会报 bug。
 */
export function habitIconOf(habit: { id: string; icon?: string }): HabitIcon {
  return parseHabitIcon(habit.icon) ?? deriveHabitIcon(habit.id);
}
