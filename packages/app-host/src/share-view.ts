/**
 * 共享清单的**读侧合并视图**（ADR-0068 裁决二的唯一实现处）。
 * ==========================================================
 *
 * ## 它解决的那一格
 *
 * M2 把共享清单里任务/便签/评论的**写**送进 share log 之后，这些实体的权威历史
 * 就不在个人状态里了。而全应用的视图读的是个人引擎那份 `MaterializedState`
 * （各端 `store.ts` 把 `currentState()` 直接塞进 store）。
 * ⇒ 不建这一层，接完写侧的后果是**作者自己都看不见自己的改动** ——
 * 数据在 share 日志里、界面一片空白、不报错。那是这条线一直在防的静默失效形状。
 *
 * ## 为什么按 `shareId` 归并，而不是给共享清单立一枚跨成员唯一的清单 id
 *
 * 因为 share 域里根本没有"清单"这个实体：`Share` 表没有任何指向清单的列，
 * 每个成员的那条清单行是**各自设备上、各自 id** 建的（ADR-0068 事实 1/2）。
 * 而一条 shareId 在一台设备上最多对应一行（加入流程那段"同一时刻只建一行"的独占注释钉的）。
 * ⇒ "这本日志里的全部内容都属于那一行"是**无歧义**的，不需要 id 别名层，
 * 也就不需要动不可逆层。
 *
 * ## 三条不显然的规则（每条都有反面判据，见 `tests/share-view.spec.ts`）
 *
 * 1. **同 id 时 share 侧整条覆盖个人侧。** 方向不能反：共享之后这些实体的写**不再进个人 log**，
 *    个人那份是绑定那一刻的冻结副本；让冻结副本盖回来就等于把成员的改动擦掉。
 * 2. **`projectId` 重定位到本机那一行**，否则对面对方的任务会落进"未归属"。
 *    ⚠️ 这是视图层的重定位，线上那条 op 的 payload 仍写着作者本机的 id ——
 *    要审计"这条任务原本挂在谁的哪条清单"必须读 share log 原文，不能读合并视图。
 * 3. **标签只在"被这份共享的任务引用到"且"本机词表里没有同 id"时才补进来。**
 *    本机同 id 的那条以本机为准：发布的本来就是同一条目，而本机可能后来改过名字，
 *    个人词表是权威（ADR-0067 补一登记的泄露口径不因合并而扩大）。
 *
 * 清单这条记录本身**不合并**（ADR-0068 裁决一）：名字/归档/颜色是本机视图，不跨成员同步。
 */
import type { MaterializedState } from '@heyta/op-log';
import type { Note, Task } from '@heyta/domain';

/**
 * 一份 share 在**本机已重放**的物化状态。
 *
 * 🔴 读不抛：没加载过、密钥没解锁、还没拉下来 ⇒ 给空状态。
 * 这与 `ShareCommentsHost.stateFor` 是同一条纪律 —— 视图层每次渲染都会走这里，
 * 一次抛错等于"整条清单打不开"，而真实情况只是"这份共享这会儿还没有本地副本"。
 */
export interface ShareStateReader {
  stateFor(shareId: string): MaterializedState;
}

/**
 * 本机**在册且可显示**的 shareId → 清单行 id。
 *
 * 这一枚映射是读侧的全部判据：一条 shareId 只有在"本机有一条没删的清单行挂着它"时才进来。
 * 所以"取消共享 ⇒ 这份内容在本机消失"不是合并里的一条特例，而是这张表的**构造**本身
 * （判据与写侧 `shareId` 在册那一枚同源，都读 `Project.shareId`）。
 *
 * 多条行挂同一个 shareId 时取 id 最小的一条 —— 不是"随便取"，是**可复现**：
 * 加入流程本来就该挡住重复建行（那是一段独占注释的职责），真挡住了还长出两行，
 * 读侧必须给出确定答案，否则两台设备同一份日志会渲染成两种分组。
 */
export function shareRowsOnDevice(personal: MaterializedState): Map<string, string> {
  const rows = new Map<string, string>();
  for (const [id, project] of Object.entries(personal.projects)) {
    if (project.deletedAt !== undefined) continue;
    const shareId = (project as { shareId?: string }).shareId;
    if (shareId === undefined || shareId.trim() === '') continue;
    const key = shareId.trim();
    const current = rows.get(key);
    if (current === undefined || id < current) rows.set(key, id);
  }
  return rows;
}

/** 本机在册的 shareId 全集（**排序确定**，所以合并结果的字段决胜顺序可复现）。 */
export function shareIdsOnDevice(personal: MaterializedState): string[] {
  return [...shareRowsOnDevice(personal).keys()].sort();
}

/** 某份 share 在本机对应哪条清单行；本机没有 ⇒ `undefined`（这份共享在本机不可见）。 */
export function localRowIdForShare(personal: MaterializedState, shareId: string): string | undefined {
  return shareRowsOnDevice(personal).get(shareId);
}

/** 把一条共享实体的清单归属重定位到本机那一行。 */
function rehome<T extends Task | Note>(entity: T, rowId: string): T {
  return { ...entity, projectId: rowId } as T;
}

/** 这份共享的任务引用到的 tagId（合并只补这些，见文件头规则 3）。 */
function referencedTagIds(shareState: MaterializedState): Set<string> {
  const used = new Set<string>();
  for (const task of Object.values(shareState.tasks)) {
    for (const tagId of task.tagIds ?? []) used.add(tagId);
  }
  return used;
}

/**
 * 合并一份共享状态进个人状态（就地写进传入的那几个桶，调用方负责给新副本）。
 */
function applyShareState(
  target: {
    tasks: Record<string, Task>;
    notes: Record<string, Note>;
    tags: MaterializedState['tags'];
    comments: MaterializedState['comments'];
  },
  personalTags: MaterializedState['tags'],
  shareState: MaterializedState,
  rowId: string,
): void {
  for (const [id, task] of Object.entries(shareState.tasks)) target.tasks[id] = rehome(task, rowId);
  for (const [id, note] of Object.entries(shareState.notes)) target.notes[id] = rehome(note, rowId);
  // 评论的 `taskId` 是跨成员一致的（op 带着 id 复制），所以不需要重定位。
  Object.assign(target.comments, shareState.comments);

  const used = referencedTagIds(shareState);
  for (const [id, tag] of Object.entries(shareState.tags)) {
    if (!used.has(id)) continue;
    if (personalTags[id] !== undefined) continue; // 本机词表是权威
    target.tags[id] = tag;
  }
}

/**
 * 派生**合并视图**（纯函数，不写任何东西）。
 *
 * 输入只有两样：个人物化状态 + 一枚"按 shareId 读物化状态"的函数。
 * 端壳不许在这里之外再判一次"这条内容算不算共享的"（AGENTS §3.5）。
 *
 * 没有任何 share 在册时**原样返回个人状态那一个对象**（不是它的复制）——
 * 这样个人清单上的一次合并调用零分配，界面读到的还是引擎那份引用。
 */
export function mergeShareView(personal: MaterializedState, reader: ShareStateReader): MaterializedState {
  const rows = [...shareRowsOnDevice(personal).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (rows.length === 0) return personal;

  const tasks = { ...personal.tasks };
  const notes = { ...personal.notes };
  const tags = { ...personal.tags };
  const comments = { ...personal.comments };

  for (const [shareId, rowId] of rows) {
    applyShareState({ tasks, notes, tags, comments }, personal.tags, reader.stateFor(shareId), rowId);
  }
  return { ...personal, tasks, notes, tags, comments };
}

/**
 * 带缓存的合并器。
 *
 * 🔴 为什么必须有这层缓存而不是每次现算：合并要复制整张 `tasks` 表。
 * `currentState()` 在一次派发里会被多处读到（store 订阅、提醒层、小组件、导出面板），
 * 不缓存等于每次读都 O(全库任务) 复制一遍 —— 而这正是"本地优先"最怕的那类回归
 * （库里几千条任务时界面开始卡顿，而所有判据照旧全绿）。
 *
 * 缓存的正确性只依赖**引用相等**：引擎每次 `applyOperation` 都返回新状态对象，
 * share 侧每次落盘重放也换新对象，所以"引用没变 ⇒ 内容没变"在这里成立。
 */
export function createShareViewMerger(reader: ShareStateReader): (personal: MaterializedState) => MaterializedState {
  let lastPersonal: MaterializedState | undefined;
  let lastResult: MaterializedState | undefined;
  let lastShareIds: readonly string[] | undefined;
  let lastShareStates: readonly MaterializedState[] | undefined;

  return (personal: MaterializedState): MaterializedState => {
    const shareIds = shareIdsOnDevice(personal);
    const states = shareIds.map((shareId) => reader.stateFor(shareId));
    if (
      lastResult !== undefined &&
      lastPersonal === personal &&
      sameRefs(shareIds, lastShareIds ?? []) &&
      sameStates(states, lastShareStates ?? [])
    ) {
      return lastResult;
    }
    lastPersonal = personal;
    lastShareIds = shareIds;
    lastShareStates = states;
    lastResult = mergeShareView(personal, reader);
    return lastResult;
  };
}

function sameRefs(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameStates(a: readonly MaterializedState[], b: readonly MaterializedState[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
