import { OpType } from '@heyta/sync-core';
/**
 * 清单与标签 store
 * ==================
 *
 * 清单（Project）支持**一层嵌套**：顶层文件夹 + 其下清单。
 * 领域层明确不支持任意深度 —— 那会引入循环引用与深度查询。
 *
 * 写入全部经 `dispatchIntent`（D4）。
 */

import { create } from 'zustand';

import type { Project, Tag } from '@heyta/domain';

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

let projectCounter = 0;
let tagCounter = 0;

export const useProjectStore = create<ProjectState>(() => ({
  projects: [],
  tags: [],

  addProject: async (name, parentId) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    projectCounter += 1;
    await dispatchIntent({
      entityType: 'PROJECT',
      entityId: `project-${String(Date.now())}-${String(projectCounter)}`,
      opType: OpType.Create,
      // parentId 为 undefined 时不要放进 payload ——
      // 展开运算会带上它，而 null 在我们的语义里表示"清除该字段"
      payload: parentId === undefined ? { name: trimmed } : { name: trimmed, parentId },
    });
  },

  renameProject: async (id, name) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    await dispatchIntent({
      entityType: 'PROJECT',
      entityId: id,
      opType: OpType.Update,
      payload: { name: trimmed },
    });
  },

  archiveProject: async (id) => {
    await dispatchIntent({
      entityType: 'PROJECT',
      entityId: id,
      opType: OpType.Update,
      payload: { archived: true },
    });
  },

  deleteProject: async (id) => {
    // 软删除。⚠️ 任务不会级联删除 —— 它们变成"无清单"。
    // 级联删除会让"误删清单"变成不可逆的数据损失。
    await dispatchIntent({
      entityType: 'PROJECT',
      entityId: id,
      opType: OpType.Delete,
      payload: {},
    });
  },

  addTag: async (name) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    tagCounter += 1;
    await dispatchIntent({
      entityType: 'TAG',
      entityId: `tag-${String(Date.now())}-${String(tagCounter)}`,
      opType: OpType.Create,
      payload: { name: trimmed },
    });
  },

  deleteTag: async (id) => {
    await dispatchIntent({
      entityType: 'TAG',
      entityId: id,
      opType: OpType.Delete,
      payload: {},
    });
  },
}));

function syncProjects(): void {
  const s = currentState();
  useProjectStore.setState({
    projects: Object.values(s.projects).filter((p) => p.deletedAt === undefined),
    tags: Object.values(s.tags).filter((t) => t.deletedAt === undefined),
  });
}

onEngineChange(syncProjects);

/** 顶层清单（无 parentId）。 */
export function selectTopLevelProjects(state: ProjectState): Project[] {
  return state.projects.filter((p) => p.archived !== true && p.parentId === undefined);
}

/** 某个清单下的子清单。 */
export function selectChildProjects(state: ProjectState, parentId: string): Project[] {
  return state.projects.filter((p) => p.archived !== true && p.parentId === parentId);
}
