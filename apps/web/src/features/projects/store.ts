/**
 * 清单与标签 store（Web 壳）
 * ============================
 *
 * 清单（Project）支持**一层嵌套**：顶层文件夹 + 其下清单。
 * 领域层明确不支持任意深度 —— 那会引入循环引用与深度查询。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件被**改造过**：它原先自己拼 `PROJECT` / `TAG` 的 op（6 处
 * `entityType` 字面量），而 op 的构造是产品语义，必须只有一份
 * （ADR-0003 §2.1、AGENTS.md §3.5）。现在全部委托给
 * `@heyta/app-host` 的 `createProjectActions`。
 *
 * 收编时对齐的漂移：
 *
 * | 行为 | 旧（自己拼） | 新（app-host 单一实现） |
 * |---|---|---|
 * | 新实体 id | `project-${Date.now()}-${counter}`（**计数器每刷新页面归零**）| `project-${randomId()}`（带 Hermes 回退）|
 * | 无父清单 | payload 里**不放** `parentId` 键 | `parentId: null`（reducer 转成字段删除）|
 * | 空名字 | 静默 return | 动作层**抛错**；"按键时空回车什么都不做"由界面判断 |
 * | 列表顺序 | 依赖存储返回顺序 | `createdAt` 升序，同刻按 id 字典序（跨端契约）|
 *
 * ⚠️ 任务**不会**随清单删除而级联删除 —— 它们变成"无清单"。
 * 级联删除会让"误删清单"从可恢复变成不可恢复。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';

import type { CategorySlot, Project, Tag } from '@heyta/domain';
import { childProjects, topLevelProjects } from '@heyta/ui';
import { createProjectActions, type ActionContext } from '@heyta/app-host';

import { currentState, dispatchIntent, dispatchChecked, onEngineChange } from '../../lib/oplog.js';

interface ProjectState {
  projects: Project[];
  tags: Tag[];
  /** 🔴 回收站那一路（有墓碑且未彻底删除）；判据与顺序在领域层。 */
  trashed: Project[];

  addProject: (name: string, parentId?: string, color?: CategorySlot) => Promise<string | undefined>;
  renameProject: (id: string, name: string) => Promise<void>;
  /** 归档/取消归档。**目标状态**省略时 = 归档（`app-host` 那边的默认值）。 */
  archiveProject: (id: string, archived?: boolean) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  /**
   * 从回收站还原清单。返回 `false` = 它不在回收站里（不写 op）。
   *
   * ⚠️ "归档过"与"删过"是两件事：一条**归档后被删**的清单还原之后仍然归档，
   *   所以它会回到 `listArchivedProjects()` 而不是侧栏默认可见的那一路。
   *   这不是 bug —— 删它没有顺带改变"它被收起来了"这个事实。
   */
  restoreProject: (id: string) => Promise<boolean>;
  /**
   * 彻底删除一条清单：追加 `purgedAt` 标记；**里面的任务一条都不动**。
   *
   * 返回**有没有真的落成**（`false` = 它早就被彻底删过，这一次没有写 op）。
   */
  purgeProject: (id: string) => Promise<boolean>;
  /** 分类色槽位（1–8），`undefined` 表示清除。存槽位号，不存颜色本身。 */
  setProjectColor: (id: string, slot?: CategorySlot) => Promise<void>;
  /**
   * 移入某个文件夹（省略 = 提为顶级）。
   *
   * 🔴 **薄转发，不在这里判断能不能移** —— 一层/环/自指/文件夹不进文件夹
   *    全在领域层 `validateProjectParentChange`（`app-host` 的 `setParent` 会调它）。
   *    界面自己筛一遍 = 第二套裁决标准，而两端各筛一次就是两套。
   */
  setProjectParent: (id: string, parentId?: string) => Promise<void>;

  addTag: (name: string) => Promise<string | undefined>;
  renameTag: (id: string, name: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
}

/** 与任务 / 专注 store 同一个形状。只含两个函数引用，不含任何判断。 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  dispatchChecked,
  getState: currentState,
};

const projectActions = createProjectActions(actionContext);

export const useProjectStore = create<ProjectState>(() => ({
  projects: [],
  tags: [],
  trashed: [],

  addProject: async (name, parentId, color) => {
    // ⚠️ 交互决策，不是数据决策：用户按了空回车就该什么都不发生。
    // 动作层对空名字抛错（它不知道调用方是"用户按了回车"还是"程序写错了"）。
    if (name.trim() === '') return undefined;
    return projectActions.createProject(name, parentId, color);
  },

  renameProject: async (id, name) => {
    if (name.trim() === '') return;
    await projectActions.renameProject(id, name);
  },

  archiveProject: async (id, archived) => {
    await projectActions.archiveProject(id, archived);
  },

  deleteProject: async (id) => {
    // 软删除（墓碑）。⚠️ 不级联删任务，见文件头。
    await projectActions.removeProject(id);
  },

  restoreProject: async (id) => {
    const changed = await projectActions.restoreProject(id);
    syncProjects();
    return changed;
  },

  purgeProject: async (id) => {
    // 不 catch：不可逆动作被拒绝必须让界面说给用户。
    const purged = await projectActions.purgeProject(id);
    syncProjects();
    return purged;
  },

  setProjectColor: async (id, slot) => {
    // 槽位合法性由动作层校验（它会对 0 或 9 抛错）——
    // 界面这一侧不做第二份判断，两份判断迟早不一致。
    await projectActions.setProjectColor(id, slot);
    syncProjects();
  },

  setProjectParent: async (id, parentId) => {
    // 与 setProjectColor 同一个理由：被领域层拒绝时**让它抛**，
    // 界面负责把错误显示出来（`ProjectsPanel` 里那条候选集本来就是按同一条规则筛的，
    // 所以正常操作走不到拒绝分支；走到了就是真有第二套标准，不许在这里吞掉）。
    await projectActions.setParent(id, parentId);
  },

  addTag: async (name) => {
    if (name.trim() === '') return undefined;
    return projectActions.createTag(name);
  },

  renameTag: async (id, name) => {
    // 与 renameProject 同一条交互决策：空回车什么都不发生，动作层负责抛错。
    if (name.trim() === '') return;
    await projectActions.renameTag(id, name);
  },

  deleteTag: async (id) => {
    await projectActions.removeTag(id);
  },
}));

function syncProjects(): void {
  // 列表来自动作层 —— "哪些算未删除""哪条算已归档""按什么顺序"都是产品语义，不在这里决定。
  //
  // 🔴 用 `listAllProjects()`（可见 + 已归档合并）而不是 `listProjects()`：
  //   后者从 W9 起**不含归档**，而本面板的「显示已归档」开关与 `archivedCount`
  //   都要求归档那一路**在数据里**（开关只是决定画不画出来）。
  //   只接一路的症状不是报错，是"开关按了什么都没出现"—— 归档变成单向门。
  useProjectStore.setState({
    projects: projectActions.listAllProjects(),
    tags: projectActions.listTags(),
    trashed: projectActions.listTrashedProjects(),
  });
}

onEngineChange(syncProjects);

// ─────────────────────────────────────────────────────────────
// 选择器（纯读，不改状态）
// ─────────────────────────────────────────────────────────────

/**
 * 🔴 M3 第九刀（projects）：这两个选择器的**判断搬到了 `@heyta/ui`**。
 *
 * 它们原先只存在于这里，于是移动端拿不到 —— `ListsSection` 直接把
 * `listProjects()` 的原数组渲染成一段平表，而 web 分层渲染。
 * "清单有且只有一层嵌套"这条领域规则因此在两端有两种界面表现，
 * 而且差异不会让任何测试变红。
 *
 * 现在它们是**薄转发**（保留导出是为了 `TaskOrganizer.tsx` 与
 * `tests/stores.spec.ts` 的既有调用点，也为了不把一次迁移变成一次改名）。
 * 新代码请直接 import `@heyta/ui` 的 `topLevelProjects` / `childProjects`。
 */

/** 顶层清单（无 `parentId`、未归档）。 */
export function selectTopLevelProjects(state: ProjectState): Project[] {
  return topLevelProjects(state.projects);
}

/** 某个清单下的一层子清单（未归档）。 */
export function selectChildProjects(state: ProjectState, parentId: string): Project[] {
  return childProjects(state.projects, parentId);
}
