/**
 * 便签动作（宿主无关）
 * =====================
 *
 * 与 `habit-actions.ts`（习惯/打卡）、`reminder-actions.ts`（提醒）同一个理由：
 * **op 的构造只能有一份**。
 *
 * 这是**幻觉 #12「笔记模块」**的**写路径** —— 在此之前 `NOTE` 是一个合法实体名、
 * 三处登记齐全、桶已存在、会被 `export-dump.ts` 全量导出、op 能同步到所有设备，
 * 但 `packages/app-host/src` 的 `.ts` 文件里**没有任何一处** `entityType: 'NOTE'`
 * —— **没有任何 action 能生成它**（`scripts/check-reachability.mjs` 的断言 B
 * 抓的就是这个形状，它是全称量化：**每一个**已建模实体都必须有写路径）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 五个由这里**独占**的语义决定：
 *
 * 1. 🔴 **便签的 id 是随机的，而 `habitLogId` / `reminderId` 是复合键 ——
 *    这个差别是刻意的，不是不一致。**
 *    打卡/提醒都有**自然键**（同一天、同一时刻），用复合键能让"重复操作"
 *    自然幂等。便签**没有自然键**：用户完全可以有意建两条内容一样的便签
 *    （"买牛奶"在两个项目下各一条）。
 *    所以**不要**把内容哈希当 id —— 那会把两条合法的便签合并成一条，
 *    而且是在用户看不见的地方。防"连点两下保存"是**界面**的事
 *    （提交期间禁用按钮），不是数据层能替它做主的。
 *
 * 2. **挂项目前先校验项目还在。** 与 `reminder-actions.ts` 的 `taskOf` 同一条：
 *    给一个已软删除的项目挂便签，用户看到的是"便签建好了"，而项目在回收站里
 *    —— 那条便签在界面上会落进一个**看不见的分组**（按 `projectId` 过滤时
 *    没有任何现存项目匹配它）。所以这里在**写之前**查一次。
 *    ⚠️ 但 `projectId: null`（未归属）**永远合法** —— 它是便签的正常状态，
 *    不是"没填"。见 `domain/src/notes.ts` 的 `noteProjectId`。
 *
 * 3. **改正文要过领域层的校验**（`noteRejection`）：空白内容一律拒绝。
 *    一条内容全是空格的便签在列表里是一行看不见的字。
 *
 * 4. **删除是软删除（`DEL` op），不是物理删。** 物理删除会让另一端把便签
 *    **同步回来** —— 用户会看到自己删掉的便签自己复活（同 `habit-actions.ts`
 *    文件头第 3 条）。`restoreNote` 因此只是清墓碑，不重建实体。
 *
 * 5. 🔴 **便签的回收站三件套（进 / 回 / 彻底删）与任务同一套语义，不做特例。**
 *    `listTrashed()` 与 `purgeNote()` 是 W1 补的：只给"能还原、不能彻底删除"
 *    会让便签成为四态模型里唯一的半截公民，而**特例正是漂移的开始** ——
 *    下一次加实体（W4 的清单/习惯）就会有人问"照便签那样？"，答案却没人维护。
 *    两个因此钉死的细节：
 *      · "什么算在回收站里""按什么序"不写第二份，用 `@heyta/domain` 的
 *        `inTrash` / `byDeletedOrder`（见 `entities.ts`）；
 *      · `purgedAt` 之后 `restoreNote` **抛错**而不是返回 `false` ——
 *        "没做成"与"这件事永远做不成"是两句不同的话，界面要说的也是后者
 *        （任务侧 `restore()` 同一个形状）。
 *
 * ⚠️ **本轮刻意没有做 `isLock` / `imgUrl` 的 setter。**
 * 两个字段在 {@link Note} 上有定义，但**没有任何界面要用它们**。
 * 现在补一个没有消费者的 setter，恰好就是本文件开头在修的那个形状
 * （"基础设施做完了、最后一米没接"）—— 只是把它缩小到了一个字段。
 * 接口**故意缺席**：等真有界面要锁便签 / 放图时再一起加，
 * 那时才知道它的语义（锁定是全端锁还是本机锁？图片是本地路径还是远端 URL？）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  aliveNotes,
  isNoteHighlighted,
  noteProjectId,
  noteRejection,
  notesInGroup,
  sortNotesForDisplay,
  trashedIn,
  type Note,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/** 建便签时可覆盖的字段。 */
export interface NewNoteFields {
  /** 所属项目；`null` / 省略 = 未归属。给一个不存在的项目会抛错（见文件头第 2 条）。 */
  projectId?: string | null;
  /** 是否钉到「今天」。默认 `false`。 */
  isPinnedToToday?: boolean;
}

export interface NoteActionsOptions {
  /** 便签 id 生成器。可注入，理由见 `TaskActionsOptions.newTaskId`。 */
  newNoteId?: () => string;
  /**
   * 时钟。`purgeNote` 要把删除时刻写进载荷，因此与 `TaskActionsOptions.now`
   * 同一个理由：**结构性断言不能靠 `Date.now()` 的容差**。
   */
  now?: () => number;
}

export interface NoteActions {
  /** 新建便签。返回新实体 id。内容为空白时**抛错**（见文件头第 3 条）。 */
  createNote(content: string, over?: NewNoteFields): Promise<string>;
  /** 改正文。空内容**抛错**（不是清空 —— 要清空就删掉这条便签）。 */
  updateNoteContent(entityId: string, content: string): Promise<void>;
  /** 改归属。`null` = 未归属（正常状态，不是"清除"）。 */
  setNoteProject(entityId: string, projectId: string | null): Promise<void>;
  /** 钉到「今天」/ 取消。 */
  setNotePinnedToToday(entityId: string, pinned: boolean): Promise<void>;
  /** 软删除（见文件头第 4 条）。 */
  removeNote(entityId: string): Promise<void>;
  /**
   * 撤销删除。**未删除时返回 `false`** 且不写 op（不产生空 op）。
   *
   * 🔴 **已彻底删除（`purgedAt`）的便签抛错**，不是返回 `false`：
   * "这条现在不用恢复"与"这条永远恢复不了"是两句话，界面对第二句要说"不可恢复"
   * 而不是"没反应"（任务侧 `restore()` 同一个形状，见 `actions.ts` 的注释）。
   */
  restoreNote(entityId: string): Promise<boolean>;
  /**
   * 彻底删除 —— 回收站里的**不可逆**动作，与任务侧 `purge()` 同一套语义：
   * 只追加可加性标记 `purgedAt`，**墓碑 `deletedAt` 保留**（清掉它会让离线端
   * 把这条便签当成"从未删除"又同步回来）。
   *
   * ⚠️ 它**不**抹掉 op-log 里的历史载荷，也不是加密擦除（`EntityBase.purgedAt`
   * 与 ADR-0048 写明了这条边界）。确认框里那句"这不是物理擦除"是承重的。
   *
   * 只能对**已软删除**的便签用：对一条活着的便签发 purge 会让它在没有墓碑的
   * 情况下从视图里消失，而离线端完全不知道发生过什么 ⇒ **抛错**。
   *
   * **已经 purge 过返回 `false`** 且不重复写 op（与 `restoreNote` 的 `false`
   * 同一句话：这次调用没有改变任何事实，调用方不该把它报成"已彻底删除"）。
   */
  purgeNote(entityId: string): Promise<boolean>;
  /** 未删除的便签，**规范顺序**（`sortNotesForDisplay`：钉选 → 更新时间 → id）。 */
  listNotes(): Note[];
  /**
   * 回收站里的便签（有墓碑、未被彻底删除），**最近删除的在前**。
   *
   * ⚠️ 判据与顺序来自动作层之外（`@heyta/domain` 的 `inTrash` / `byDeletedOrder`），
   * 宿主**不要**自己 `filter(n => n.deletedAt)` —— 那会漏掉 `purgedAt` 那一半，
   * 把"彻底删除"变成一个界面上没有产出的动作。
   */
  listTrashed(): Note[];
  /** 某个归属下（`null` = 未归属）的便签，顺序同上。 */
  notesOf(projectId: string | null): Note[];
  /** 钉到「今天」的那些 —— 界面上的"今日便签"分组直接用它，不要自己 filter。 */
  highlightedNotes(): Note[];
}

export function createNoteActions(
  ctx: ActionContext,
  options: NoteActionsOptions = {},
): NoteActions {
  const makeNoteId = options.newNoteId ?? ((): string => `note-${randomId()}`);
  const now = options.now ?? ((): number => Date.now());

  const noteOf = (entityId: string): Note | undefined => {
    const note = ctx.getState().notes[entityId];
    if (note === undefined || note.deletedAt !== undefined) return undefined;
    return note;
  };

  /** 见文件头第 2 条：挂项目前校验项目还在。`null` 直接放行。 */
  const assertProject = (projectId: string | null): void => {
    if (projectId === null) return;
    const project = ctx.getState().projects[projectId];
    if (project === undefined || project.deletedAt !== undefined) {
      throw new Error(`找不到清单「${projectId}」（便签不能挂到已删除的清单上）`);
    }
  };

  /** 见文件头第 3 条：正文校验单点定义在领域层。 */
  const assertContent = (content: string): void => {
    const rejection = noteRejection(content);
    if (rejection === undefined) return;
    const detail =
      rejection === 'empty'
        ? '正文不能为空（空白也算空）'
        : `正文超过 ${String(content.length)} 字符，上限见 domain/src/notes.ts`;
    throw new Error(`便签内容不合法：${detail}`);
  };

  const aliveOf = (): Note[] => aliveNotes(Object.values(ctx.getState().notes));

  return {
    async createNote(content, over = {}) {
      assertContent(content);
      // `over.projectId` 省略与显式 `null` 都是"未归属"（见 `noteProjectId`）。
      const resolvedProject = over.projectId ?? null;
      assertProject(resolvedProject);

      const entityId = makeNoteId();
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          // `trim()` 掉首尾空白：粘贴进来常常带一个尾随换行，
          // 留着它会让"正文长度"与用户看到的差一，也会让摘要行多出一个空行。
          content: content.trim(),
          // 🔴 `null` 而不是省略 `projectId`：reducer 对 `CRT` 是**合并**语义，
          // 省略一个键等于"不动它"，而新建时没有任何东西可保留。
          projectId: resolvedProject,
          isPinnedToToday: over.isPinnedToToday ?? false,
        },
      });
      return entityId;
    },

    async updateNoteContent(entityId, content) {
      const current = noteOf(entityId);
      if (current === undefined) throw new Error(`找不到便签「${entityId}」`);
      assertContent(content);
      const next = content.trim();
      /**
       * 🔴 **正文没变就不写 op** —— 这条闸门只能住在这里，不能下放到界面。
       *
       * `UPD` 会推进 `updatedAt`，而 `updatedAt` 是 `sortNotesForDisplay` 的第二段。
       * 于是"点开便签、什么都没改、点一下保存"会让这条便签**跳到列表最前面**，
       * 而用户看到的现象是"我只是看了一眼，顺序就变了"—— 全程没有任何一处报错。
       * 两端共用这一个入口之后，界面上少写一次判断、这里多挡一次，
       * 比"两个端各自记得挡"便宜得多（AGENTS §3.5）。
       */
      if (next === current.content) return;
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { content: next },
      });
    },

    async setNoteProject(entityId, projectId) {
      if (noteOf(entityId) === undefined) throw new Error(`找不到便签「${entityId}」`);
      assertProject(projectId);
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Update,
        // 清归属写 `null`，不写"不放这个键" —— 后者在 reducer 里是"不改"，
        // 用户会以为"移出清单"没生效（同 `habit-actions.ts` 的清色写法）。
        payload: { projectId },
      });
    },

    async setNotePinnedToToday(entityId, pinned) {
      if (noteOf(entityId) === undefined) throw new Error(`找不到便签「${entityId}」`);
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { isPinnedToToday: pinned },
      });
    },

    async removeNote(entityId) {
      if (noteOf(entityId) === undefined) throw new Error(`找不到便签「${entityId}」`);
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async restoreNote(entityId) {
      // 注意这里读的是**含墓碑**的原始记录：`noteOf` 会滤掉墓碑，
      // 用它会让"撤销删除"永远判定成"找不到便签"。
      const raw = ctx.getState().notes[entityId];
      if (raw === undefined) throw new Error(`找不到便签「${entityId}」`);
      // 🔴 不可逆必须在动作层真的拦住，而不是只靠界面不画那个按钮
      //（同一台设备上还有 CLI / 本机 API 两条路会调到这个方法）。
      if (raw.purgedAt !== undefined) {
        throw new Error(`便签「${entityId}」已被彻底删除，无法恢复`);
      }
      if (raw.deletedAt === undefined) return false;
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Update,
        // 清墓碑写 `null`：`undefined` 会被 JSON 丢掉，对端既不清除也不设置
        // （同 `reminder-actions.ts` 的 `undoDismissReminder`）。
        payload: { deletedAt: null },
      });
      return true;
    },

    async purgeNote(entityId) {
      const raw = ctx.getState().notes[entityId];
      if (raw === undefined) throw new Error(`找不到便签「${entityId}」`);
      if (raw.deletedAt === undefined) {
        throw new Error(`便签「${entityId}」不在回收站里，不能彻底删除`);
      }
      // 已彻底删除：幂等，不重复发 op。
      if (raw.purgedAt !== undefined) return false;
      // 只加标记，**不清 `deletedAt`** —— 墓碑留着，离线端才不会复活它。
      await ctx.dispatch({
        entityType: 'NOTE' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { purgedAt: now() },
      });
      return true;
    },

    listNotes() {
      return sortNotesForDisplay(aliveOf());
    },

    listTrashed() {
      // 判据、顺序、"挑 + 排"这一遍都在领域层（`trashedIn`），这里不重写。
      return trashedIn(Object.values(ctx.getState().notes));
    },

    notesOf(projectId) {
      // 顺序与过滤都在领域层（单点定义，见 `domain/src/notes.ts`）。
      return notesInGroup(aliveOf(), projectId);
    },

    highlightedNotes() {
      return sortNotesForDisplay(aliveOf().filter(isNoteHighlighted));
    },
  };
}
