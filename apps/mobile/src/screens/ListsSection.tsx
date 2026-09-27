/**
 * 清单管理（「我的」页里的一段）
 * ==============================
 *
 * 补的是"能日常用"里最后一块结构性缺口：**任务无法归类**。
 *
 * 在此之前移动端能建任务、设日期、设优先级、设重复，但**所有任务都只能待在
 * 「收集箱」**——`TaskActions.moveToProject()` 早就写好了，`ProjectActions`
 * 也早在 `@heyta/app-host` 里，缺的一直是入口。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 三个刻意的决定
 *
 * 1. **这里列的是「真实体」，不是「收集箱」。**
 *    「收集箱」在数据上**不是一条清单** —— 它就是 `Task.projectId === undefined`。
 *    把它混进这个列表会让人以为它可删可改名，而删掉它没有任何东西可删。
 *    所以它在详情页里是**选项之一**（`TaskDetailSheet`），在这里**不出现**。
 *
 * 2. **删除按钮旁边必须说明"任务不会一起删"。**
 *    `ProjectActions.removeProject()` 刻意不级联（见 `project-actions.ts` 文件头第 2 条），
 *    但用户不知道这件事时会**不敢删**——一个不敢用的功能等于没有。
 *    所以 `mobile.lists.removeHint` 是这一段的必需品，不是装饰。
 *
 * 3. **不改名、不归档。**
 *    `renameProject` / `archiveProject` 在 app-host 里是有的，但这一轮不接 ——
 *    改名要一个内联编辑态，归档要一个"显示已归档"的开关，
 *    两者都会把这一段的交互重量翻倍。**先让"建/删/归类"这条主线真的能用**，
 *    能用了再谈这两个。没做的不假装做了。
 *
 * ⚠️ 界面结构（卡片 / 空态 / 行 / 删除按钮 / 输入框 / 新建按钮）已经抽到
 * `OrganizerSection` —— 标签那一段是同一个形状。本文件只负责"清单"的语义：
 * 读哪些数据、调哪个动作、说什么话。
 *
 * 🔴 本文件里**没有一行业务逻辑**：能不能建（空名字抛错）、删了任务去哪、
 * 无父清单写 `parentId: null` 还是省略，全部由 `@heyta/app-host` 决定。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Project } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createProjectActions, type AppHost, type ProjectActions } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { OrganizerSection, type OrganizerItem } from './OrganizerSection';

export function ListsSection(): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 **必须订阅 `dataRevision`**，理由有两条，第二条才是关键：
   *
   *   1. 门禁会拦（`scripts/check-materialized-reads.mjs`：任何屏只要调用了
   *      读物化状态的 API，就必须在同一个文件里引用 `dataRevision`）。
   *   2. **它才是真正让这段界面正确的那个东西。** `listProjects()` 读的是
   *      **已物化的内存状态**，同步在后台改了状态**不会**触发 React 重渲染。
   *      不订阅的话：在另一台设备上建的清单，这台设备**同步完了也看不见**，
   *      而且没有任何报错 —— 界面只是"看起来没这个清单"。
   *      这与"列表页读出 0 条"是同一类静默不一致（AGENTS.md §3.4 末尾）。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void openTaskHost().then((opened) => {
      // 🔴 卸载后 `setState` 是无声的脏写入：面板关掉时若正好开完库，
      // 状态会落在一个已经不存在的组件上。`alive` 是这一行存在的全部理由。
      if (alive) setHost(opened);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 与 `TasksScreen` 同一条规则：动作集从宿主派生，不在界面里新造。
  const actions = useMemo<ProjectActions | null>(
    () => (host ? createProjectActions(host) : null),
    [host],
  );

  const read = useCallback((): void => {
    if (actions === null) return;
    // ⚠️ `listProjects()` 是**同步**的（读已物化状态），不是 Promise。
    setProjects(actions.listProjects());
  }, [actions]);

  useEffect(read, [read, dataRevision]);

  const run = useCallback(
    (p: Promise<unknown>) => {
      setBusy(true);
      void p
        .then(read)
        .finally(() => {
          setBusy(false);
        });
    },
    [read],
  );

  const add = useCallback(
    (name: string): void => {
      if (actions === null) return;
      run(actions.createProject(name));
    },
    [actions, run],
  );

  const remove = useCallback(
    (item: OrganizerItem): void => {
      if (actions === null) return;
      run(actions.removeProject(item.id));
    },
    [actions, run],
  );

  return (
    <OrganizerSection
      icon="task.project"
      title={t('mobile.profile.section.lists')}
      items={projects}
      emptyText={t('mobile.lists.empty')}
      emptyHint={t('mobile.lists.empty.hint')}
      removeLabel={(name) => t('mobile.lists.remove', { name })}
      removeHint={t('mobile.lists.removeHint')}
      nameLabel={t('mobile.lists.nameLabel')}
      placeholder={t('mobile.lists.newPlaceholder')}
      addLabel={t('mobile.lists.add')}
      busy={busy}
      onAdd={add}
      onRemove={remove}
    />
  );
}