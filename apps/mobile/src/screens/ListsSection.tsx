/**
 * 清单管理（「我的」页里的一段）—— **只剩接线**
 * =================================================
 *
 * M3 第九刀（projects）：行的骨架 / 层级 / 计数口径全部搬进
 * `@heyta/ui` 的 `OrganizerList` + `projects/model.ts`（与 web 同一份源码）。
 * 本文件现在只回答移动端自己的四件事：读哪些数据、调哪个动作、说什么话、
 * 周边挂什么。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 补的是"能日常用"里最后一块结构性缺口：**任务无法归类**
 *
 * 在此之前移动端能建任务、设日期、设优先级、设重复，但**所有任务都只能待在
 * 「收集箱」**——`TaskActions.moveToProject()` 早就写好了，`ProjectActions`
 * 也早在 `@heyta/app-host` 里，缺的一直是入口。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 这一刀之后**移动端第一次真的按层级渲染清单**
 *
 * 迁移前本文件直接把 `listProjects()` 的原数组渲染成一段**平表** —— 子清单
 * 与顶层清单长得一模一样。web 则是分层的（`selectChildProjects`）。
 * "清单有且只有一层嵌套"这条领域规则因此在两端有两种界面表现，而差异
 * **不会让任何测试变红**。现在层级由共享 `toOrganizerTree` 决定，两端一致。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 入口走「我的」页里的一段，**不加 tab**（P10）
 *
 * ADR-0015 §4 的判决是"四象限是同一份任务的另一种投影，不新增 tab"，
 * 而 P10 已把移动端第 6 个 tab 判为要撤销。清单与标签不同 —— 它们读的是
 * **另一批实体**（PROJECT / TAG）—— 但"不重排标签栏"这条同样适用：
 * 底部标签**保持 5 个**（任务 / 日历 / 专注 / 分类 / 我的），
 * 清单/标签是本页内的两段（与同步、语言同一个容器形状）。
 *
 * ⚠️ **这里与任务书的一处出入（如实登记）**：任务书写"从零建屏"，
 * 但移动端**此前已经有**清单/标签管理 —— `ListsSection` / `TagsSection` 在
 * 「我的」页里，且 `verify-mobile-lists.sh` / `verify-mobile-tags.sh`
 * 两个验收脚本**按「我的」页就地寻址**（`scroll_to_desc "清单名称"`）。
 * 把这两段挪进独立第二层屏会同时：① 与既有验收脚本（不在本刀白名单）冲突；
 * ② 制造第二份"清单在哪"的答案。所以本刀是**换装共享实现**，不是新建屏。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的决定（迁移前就有，本刀保留）
 *
 * 1. **这里列的是「真实体」，不是「收集箱」。**
 *    「收集箱」在数据上**不是一条清单** —— 它就是 `Task.projectId === undefined`。
 *    把它混进这个列表会让人以为它可删可改名，而删掉它没有任何东西可删。
 * 2. **删除按钮旁边必须说明"任务不会一起删"。**
 *    `ProjectActions.removeProject()` 刻意不级联，但用户不知道时会**不敢删**。
 * 3. **不改名、不归档。** 改名要内联编辑态、归档要"显示已归档"开关，
 *    两者都会把交互重量翻倍。没做的不假装做了。
 *
 * 🔴 本文件里**没有一行业务逻辑**：能不能建（空名字由 app-host 抛错）、
 * 删了任务去哪、无父清单写 `parentId: null` 还是省略 —— 全部由
 * `@heyta/app-host` 决定。这里连 `Project` 的字段都不读，只把
 * `toOrganizerTree()` 的输出交给共享组件。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { Project } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createProjectActions, type AppHost, type ProjectActions } from '@heyta/app-host';
import { OrganizerList, toOrganizerTree } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { Button, Card, SectionHeader, Text, TextField } from '../ui/kit';

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
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
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

  /**
   * 层级由共享层决定（`toOrganizerTree`）—— 本文件**不再自己拼平表**。
   * 那正是迁移前两端界面不同的来源。
   */
  const tree = useMemo(() => toOrganizerTree(projects), [projects]);

  const add = useCallback((): void => {
    const trimmed = name.trim();
    // 「按了空回车什么都不做」是**交互**决定，由界面自己判断 ——
    // 业务层对空名字是抛错的，不能让它抛到这里。
    if (trimmed === '' || actions === null) return;
    setName('');
    run(actions.createProject(trimmed));
  }, [actions, name, run]);

  return (
    <>
      <SectionHeader icon="task.project" title={t('mobile.profile.section.lists')} />
      <Card>
        {/*
          🔴 行骨架来自共享 `OrganizerList` —— 本文件**不许**自己画一行。
          一旦画了，移动端与 web 的清单行就会开始漂移，而那件事不会有任何
          测试变红（判据见 `apps/web/tests/projects-panel.spec.tsx`）。

          ⚠️ 不传 `onSelect`：移动端没有"侧栏筛选"这个概念（筛的是
          `TasksScreen` 自己的分节），点一行没有去处就不做成可点 ——
          一个点了没反应的按钮比不可点更坏。也不传 `counts`：
          移动端此前不显示未完成任务数，本刀不顺手加。
        */}
        <OrganizerList
          kind="project"
          items={tree}
          labels={{
            removeLabel: (label) => t('mobile.lists.remove', { name: label }),
            empty: t('mobile.lists.empty'),
            emptyHint: t('mobile.lists.empty.hint'),
          }}
          onRemove={(item) => {
            if (actions === null) return;
            run(actions.removeProject(item.id));
          }}
          busy={busy}
          testID="mobile-projects-list"
        />
      </Card>
      <Text variant="caption" tone="subtle">
        {t('mobile.lists.removeHint')}
      </Text>

      <TextField
        label={t('mobile.lists.nameLabel')}
        value={name}
        onChangeText={setName}
        placeholder={t('mobile.lists.newPlaceholder')}
        autoCapitalize="sentences"
      />
      <Button
        label={t('mobile.lists.add')}
        tone="secondary"
        icon="task.add"
        loading={busy}
        // 空名字时**禁用**而不是点了没反应：禁用态本身就是"还差什么"的提示。
        disabled={name.trim() === ''}
        onPress={add}
      />
    </>
  );
}
