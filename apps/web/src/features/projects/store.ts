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

import type { Project, Tag } from '@heyta/domain';
import { createProjectActions, type ActionContext } from '@heyta/app-host';

import { currentState, dispatchIntent, onEngineChange } from '../../lib/oplog.js';

interface ProjectState {
  projects: Project[];
  tags: Tag[];

  addProject: (name: string, parentId?: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  addTag: (name: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
}

/** 与任务 / 专注 store 同一个形状。只含两个函数引用，不含任何判断。 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

const projectActions = createProjectActions(actionContext);

export const useProjectStore = create<ProjectState>(() => ({
  projects: [],
  tags: [],

  addProject: async (name, parentId) => {
    // ⚠️ 交互决策，不是数据决策：用户按了空回车就该什么都不发生。
    // 动作层对空名字抛错（它不知道调用方是"用户按了回车"还是"程序写错了"）。
    if (name.trim() === '') return;
    await projectActions.createProject(name, parentId);
  },

  renameProject: async (id, name) => {
    if (name.trim() === '') return;
    await projectActions.renameProject(id, name);
  },

  archiveProject: async (id) => {
    await projectActions.archiveProject(id);
  },

  deleteProject: async (id) => {
    // 软删除（墓碑）。⚠️ 不级联删任务，见文件头。
    await projectActions.removeProject(id);
  },

  addTag: async (name) => {
    if (name.trim() === '') return;
    await projectActions.createTag(name);
  },

  deleteTag: async (id) => {
    await projectActions.removeTag(id);
  },
}));

function syncProjects(): void {
  // 列表来自动作层 —— "哪些算未删除""按什么顺序"都是产品语义，不在这里决定。
  useProjectStore.setState({
    projects: projectActions.listProjects(),
    tags: projectActions.listTags(),
  });
}

onEngineChange(syncProjects);

// ─────────────────────────────────────────────────────────────
// 选择器（纯读，不改状态）
// ─────────────────────────────────────────────────────────────

/** 顶层清单（无 parentId）。 */
export function selectTopLevelProjects(state: ProjectState): Project[] {
  return state.projects.filter((p) => p.archived !== true && p.parentId === undefined);
}

/** 某个清单下的子清单。 */
export function selectChildProjects(state: ProjectState, parentId: string): Project[] {
  return state.projects.filter((p) => p.archived !== true && p.parentId === parentId);
}