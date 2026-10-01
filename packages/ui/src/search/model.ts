/**
 * 搜索面板的**判断** —— 跳转项怎么筛、结果怎么排成一条可走的光标
 * =================================================================
 *
 * 放在共享层而不是宿主，理由与 `../task-list/model.ts` 同一条：这两件事
 * 都决定"用户看到什么顺序、↑↓ 走到哪"，而四个端各写一遍必然漂移
 *（漂移的表现不是报错，是"手机上能按到、网页上按不到"）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 「快速跳转」匹配清单名 / 标签名，而任务搜索**刻意不匹配** —— 两者不打架
 *
 * `packages/domain/src/search.ts` 文件头第 1 条写明：搜任务时不联表，
 * 所以清单名、标签名不在任务的 haystack 里。它当时的结论是
 * 「用户想按清单找就该点清单，而不是在一个全局搜索框里碰运气」。
 *
 * 本模块正是那个「点清单」的入口：**跳转项不是搜索结果，是导航**。
 * 匹配到「工作」后进的是"任务视图 + 按该清单筛选"，不是"打开一条任务"。
 * 所以它不违反那条裁决 —— 那条裁决禁的是**把联表塞进任务匹配**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 切词复用 `@heyta/domain` 的 `termsOf`，本文件**没有**第二套 split 规则
 *
 * 多词 = AND、大小写不敏感、按连续空白切 —— 这三条在同一个搜索框里
 * 必须对任务、便签、跳转项**同时成立**。各写一份的表现是"同一个词
 * 在任务里搜得到、在跳转项里搜不到"，而且不会报错。
 */

import { termsOf } from '@heyta/domain';

/** 跳转项属于哪一类 —— 决定宿主给它配哪个图标与副标题。 */
export type QuickActionGroup = 'view' | 'project' | 'tag';

/**
 * 一条可跳转的入口。**内容由宿主给**（本层不认识 i18n，也不认识路由）：
 * `label` 是已本地化的名字，`onSelect` 是宿主的导航动作。
 */
export interface QuickAction {
  readonly id: string;
  /** 已本地化的名字（参与匹配，也是行上显示的那句）。 */
  readonly label: string;
  readonly group: QuickActionGroup;
  /** 副标题，如「视图」「清单」「标签」。也参与匹配 —— 用户可能打的是类别词。 */
  readonly hint?: string;
  /**
   * 额外匹配词（不参与显示）。
   *
   * 存在的理由：宿主本地化后的名字未必覆盖用户会打的同义词
   *（「日历」这一项，有人会打 `calendar`）。⚠️ 只放**同义词**，
   * 放了会匹配到几十项的泛词，就等于把筛掉的结果又捞回来。
   */
  readonly keywords?: readonly string[];
  /** 宿主的导航动作。 */
  readonly onSelect: () => void;
}

/**
 * 一次最多列出几条跳转项。
 *
 * 从面板高度推导而不是拍一个数：结果区上限 `layout.panel-max-height`，
 * 一行的可视高度约 `touch-target.min`，两者相除 ≈ 8。
 * 取**更少**（而不是正好占满）是因为任务/便签两组同屏竞争，
 * 而跳转项排最后 —— 给它一整屏会把要看的搜索结果挤到滚动区外面。
 */
export const MAX_QUICK_ACTIONS = 8;

/** 跳转项的 haystack：名字 + 类别 + 同义词，用换行隔开避免跨字段假匹配（同 domain 的纪律）。 */
function quickHaystack(action: QuickAction): string {
  return [action.label, action.hint ?? '', ...(action.keywords ?? [])].join('\n').toLowerCase();
}

/**
 * 按查询筛跳转项。
 *
 * - **AND**：每个词都必须在 haystack 里出现（复用 `termsOf`）。
 * - **前缀优先**：名字**以查询开头**的排前面，其余保持宿主给定的顺序。
 *   排序规则只有一条且稳定，因为"同一批结果两次打开顺序不同"
 *   会让用户以为列表在变。
 * - **截断到 `MAX_QUICK_ACTIONS`**：跳转是"挑一个"，不是"看全部"。
 *   ⚠️ 截断对任务/便签**不成立** —— 那两组是搜索结果，静默截断会让人
 *   把"没显示"读成"没有"。
 */
export function filterQuickActions(
  actions: readonly QuickAction[],
  query: string,
): QuickAction[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const matched = actions.filter((action) => {
    const hay = quickHaystack(action);
    return terms.every((term) => hay.includes(term));
  });
  const needle = terms[terms.length - 1] ?? '';
  const startsWithQuery = matched.filter((a) => a.label.toLowerCase().startsWith(needle));
  const rest = matched.filter((a) => !a.label.toLowerCase().startsWith(needle));
  return [...startsWithQuery, ...rest].slice(0, MAX_QUICK_ACTIONS);
}

/** 结果里可被光标停下的三种东西。 */
export type SearchResultKind = 'task' | 'note' | 'quick';

/**
 * 光标所在的一条结果。
 *
 * 🔴 只需要 `kind` + `id`：面板不复制实体，宿主拿 id 自己去开任务 / 开便签 /
 * 跑跳转项。把整条 `Task` 塞进游标会让"游标"与"数据"有两份真相。
 */
export interface SearchResultEntry {
  readonly kind: SearchResultKind;
  readonly id: string;
}

/** 三组已经排好序的结果（顺序即展示顺序）。 */
export interface SearchGroups {
  readonly tasks: readonly { readonly id: string }[];
  readonly notes: readonly { readonly id: string }[];
  readonly quick: readonly QuickAction[];
}

/**
 * 把三组结果摊平成"一条 ↑↓ 能走完整张面板"的序列。
 *
 * **组序 = 展示序**（任务 → 便签 → 快速跳转），这里不重新排序：
 * 光标走的顺序必须和用户眼睛扫的顺序一致，否则"按三下"在两边指向不同的行。
 */
export function buildResultEntries(groups: SearchGroups): SearchResultEntry[] {
  return [
    ...groups.tasks.map((t) => ({ kind: 'task' as const, id: t.id })),
    ...groups.notes.map((n) => ({ kind: 'note' as const, id: n.id })),
    ...groups.quick.map((q) => ({ kind: 'quick' as const, id: q.id })),
  ];
}

/**
 * 光标特殊值：**在输入框里**，不在任何一行上。
 *
 * 必须有一个"输入框"档，否则第一次按 ↓ 会没有起点，
 * 而"从第一行再按 ↑"没有地方可回 —— 用户想改一个字时会卡住。
 */
export const CURSOR_IN_INPUT = -1;

/**
 * 移动光标（`delta` 通常为 ±1）。
 *
 * 规则（三条都能被 `tests/search-model.spec.ts` 钉住）：
 * 1. 没有任何结果 → 永远停在输入框（`-1`）。此时按方向键不该"选中一条不存在的行"。
 * 2. 从输入框按 ↓ 进第一行；从第一行按 ↑ 回输入框。
 * 3. 行内到底/到顶时**环绕**（末行按 ↓ 回第一行）。
 *    选环绕而不是"卡在末行"：面板高度有限，卡住时用户无法判断
 *    "是到底了"还是"按键没生效"。
 */
export function moveCursor(current: number, length: number, delta: number): number {
  if (length === 0) return CURSOR_IN_INPUT;
  const step = delta >= 0 ? 1 : -1;
  if (current === CURSOR_IN_INPUT) return step === 1 ? 0 : CURSOR_IN_INPUT;
  const next = current + step;
  if (next < 0) return CURSOR_IN_INPUT;
  if (next >= length) return step === 1 ? 0 : length - 1;
  return next;
}
