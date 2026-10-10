import { ICON_SIZE } from '@heyta/design-system';
/**
 * 清单与标签面板（侧栏）—— **只剩接线**
 * ==========================================
 *
 * M3 第九刀（projects）：行的骨架 / 层级 / 计数口径全部搬进
 * `@heyta/ui` 的 `OrganizerList` + `projects/model.ts`（与移动端同一份源码）。
 * 本文件现在只回答四件**宿主才有答案**的事：
 *
 *   1. 文案（`web.projects.*` / `web.tags.*`）；
 *   2. 数据从哪来（`useProjectStore` / `useTaskStore`）；
 *   3. 平台特有物：创建对话框 + `<ColorSlotPicker>`；
 *   4. 点一行之后要做什么 —— **必须经由 `onFilterWith`，不能直接 `tasks.setFilter`**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 点清单必须经由 `onFilterWith`，不能直接 `tasks.setFilter`
 *
 * 侧栏在**所有视图**下都渲染（任务 / 四象限 / 习惯 / 番茄 / 时间线 / 成长 / 设置），
 * 而清单筛选只对**任务视图**有意义。直接 `setFilter` 会让"人在习惯页、点某个清单"
 * 看起来**点了没反应** —— 筛选真的变了，但当前视图不读它。
 * 所以"点清单 = 切回任务视图 + 改筛选"这件事由宿主（`App.tsx` 的 `goToFilter`）
 * 统一决定；本组件只负责把**用户选了哪个**报上去。
 *
 * 用 prop 而不是在这里 `import` 视图切换，是因为"当前在哪个视图"是宿主的
 * 状态 —— 组件去猜它就会在下一个视图加进来时漂移。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 必须挂在本文件内
 *
 * 侧栏与 `App.tsx` 里 `tasks` 那棵树的 Provider 是**兄弟节点**，不会互相覆盖。
 * 少这一层时类型与单测都不会红，只有运行时抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。」——
 * `check:ui-provider` 盯的就是这件事（`OrganizerList` 已登记）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条：证据 + 影响 + 最小一步）
 *
 *   1. **新建清单 / 标签的输入框与按钮**：web 是 DOM `<form><input>`（要处理
 *      iOS Safari 聚焦缩放：字号 ≥16px），mobile 是 kit `TextField` + `Button`。
 *      与 `HabitsView` 同一条处置（composer 留宿主），理由见
 *      `packages/ui/src/projects/model.ts` 文件头第 1 条。
 *   2. **取色入口**：`ColorSlotPicker` 是 DOM 实现（展开式 + `Esc`），
 *      mobile 目前没有清单取色入口 —— 经 `renderItemExtra` 插槽接入。
 *   3. **删除前的二次确认**：迁移前后都是**直接删**（软删除墓碑），本刀不变。
 *
 * ⚠️ 计数位现在**只在 > 0 时渲染**（共享层统一，与 `App.tsx` 的 `NavButton`
 * 同一条规则）。迁移前空清单上会常驻一个 `0` —— 这是**可见的行为变化**。
 */

import { useMemo, useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { folderTargetsFor, parseCategorySlot } from '@heyta/domain';
import { Archive, Folder, Plus, Tag as TagIcon } from 'lucide-react';
import {
  archivedProjects,
  FolderPicker,
  folderRejectionMessageKey,
  HeytaUiProvider,
  OrganizerList,
  liveTaskCountsByTag,
  openTagCounts,
  openTaskCounts,
  toOrganizerNodes,
  toOrganizerTree,
  toTagItems,
} from '@heyta/ui';

import { ColorSlotPicker } from '../categories/ColorSlotPicker.js';
import { CategoryCreateDialog, type CategoryCreateKind } from '../categories/CategoryCreateDialog.js';
import { useTaskStore, type TaskFilter } from '../tasks/store.js';
import { useProjectStore } from './store.js';

export function ProjectsPanel({
  onFilterWith,
}: {
  /** 用户选了某个清单 / 标签。宿主负责切视图并落筛选（见文件头）。 */
  onFilterWith: (filter: TaskFilter) => void;
}) {
  const { t } = useI18n();
  const projects = useProjectStore();
  const tasks = useTaskStore();
  const [createKind, setCreateKind] = useState<CategoryCreateKind | null>(null);
  /**
   * 「移入文件夹」被领域层拒绝时那一句人话（候选集本来就按同一条规则筛过，
   * 走到这里通常是**另一端刚改了这棵树**）。
   * 🔴 不许吞：吞掉的后果是"点了没反应"，而数据什么都没变。
   */
  const [folderError, setFolderError] = useState('');
  /**
   * 「显示已归档」。默认关 —— 与迁移前那个选择器逐字一致（归档 = 从列表里消失）。
   *
   * 🔴 它不是装饰，是**归档这扇门的一半**：`toOrganizerTree` 不开这个开关就把
   *    `archived === true` 全滤掉，而侧栏之外再没有已归档视图。少了这一半，
   *    界面上每一次归档都是**单向门** —— 数据还在、也照样同步，就是永远回不来。
   * ⚠️ 按钮只在真有一条已归档时出现：一个点开永远什么都不会变多的按钮，
   *    是"这按钮是不是坏了"那种噪音。
   */
  const [showArchived, setShowArchived] = useState(false);
  // 层级与计数口径都在共享层（`toOrganizerTree` / `openTaskCounts`）。
  const archivedCount = useMemo(
    () => archivedProjects(projects.projects).length,
    [projects.projects],
  );
  const tree = useMemo(
    () => toOrganizerTree(projects.projects, { includeArchived: showArchived }),
    [projects.projects, showArchived],
  );
  /**
   * 「移入文件夹」的候选集 —— 与移动端调的是**同一个领域函数**
   * （`folderTargetsFor` = `validateProjectParentChange` 的逐目标展开）。
   * 两端各筛一遍迟早漂成两套标准，而漂移的症状是"手机上能选、电脑上不能选"。
   */
  const folderTargets = useMemo(
    () =>
      new Map(
        projects.projects.map((project) => [
          project.id,
          folderTargetsFor(projects.projects, project.id),
        ]),
      ),
    [projects.projects],
  );
  const parentOf = (id: string): string | undefined =>
    projects.projects.find((project) => project.id === id)?.parentId ?? undefined;
  const tagNodes = useMemo(
    () => toOrganizerNodes(toTagItems(projects.tags)),
    [projects.tags],
  );
  const counts = useMemo(
    () => openTaskCounts(Object.values(tasks.entities.tasks)),
    [tasks.entities.tasks],
  );
  /**
   * 标签那一节**此前一个计数都没有**（`OrganizerList` 的 `counts` 是可选项，
   * 清单传了、标签没传）。滴答清单的侧栏每一行右侧都有数字，而我们连取数都不存在 ——
   * 缺口不在"把数字挪位置"，在"这个数字根本没被算出来"（台账 R6）。
   * 口径走共享层同一个 `open*Counts`，与清单那节不会漂。
   */
  const tagCounts = useMemo(
    () => openTagCounts(Object.values(tasks.entities.tasks)),
    [tasks.entities.tasks],
  );
  /**
   * 删除确认里那句"它挂在几条任务上"（W4b）。
   *
   * 🔴 **不是** `tagCounts` 换个名字：那个滤掉了已完成的任务，而这个必须含 ——
   * 一条挂满已完成任务的标签，删它照样会让那些任务失去归属，
   * 用 `tagCounts` 顶替就会在界面上说"没有任务受影响"。口径只有一处
   * （`@heyta/ui#liveTaskCountsByTag`），移动端拿的是同一个函数。
   */
  const tagRemoveImpact = useMemo(
    () => liveTaskCountsByTag(Object.values(tasks.entities.tasks)),
    [tasks.entities.tasks],
  );

  /**
   * 清单 id → 当前色槽。渲染时按 id 查，而不是把 map 塞进行模型 ——
   * "清单长什么样"是领域字段，不属于行的展示模型。
   */
  function slotOf(projectId: string) {
    return parseCategorySlot(projects.projects.find((p) => p.id === projectId)?.color);
  }

  return (
    <HeytaUiProvider>
      <aside aria-label={t('web.projects.ariaLabel')} style={asideStyle}>
        <section>
          <div className="ht-sidebar__organizer-heading">
            <h2 className="ht-nav__section ht-type-group-label">{t('web.projects.heading')}</h2>
            {archivedCount === 0 ? null : (
              <button
                type="button"
                className="ht-sidebar__organizer-add"
                aria-label={
                  showArchived ? t('common.organizer.hideArchived') : t('common.organizer.showArchived')
                }
                aria-pressed={showArchived}
                onClick={() => {
                  setShowArchived((prev) => !prev);
                }}
              >
                <Archive size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="ht-sidebar__organizer-add"
              aria-label={t('web.projects.addNew')}
              aria-expanded={createKind === 'project'}
              onClick={() => {
                setCreateKind((current) => (current === 'project' ? null : 'project'));
              }}
            >
              <Plus size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
          </div>

          <OrganizerList
            kind="project"
            items={tree}
            counts={counts}
            labels={{
              removeLabel: (name) => t('web.projects.delete', { name }),
              rename: {
                button: (name) => t('common.organizer.rename.button', { name }),
                save: t('common.organizer.rename.save'),
                cancel: t('common.organizer.rename.cancel'),
              },
              archive: {
                button: (name) => t('common.organizer.archive.button', { name }),
                unarchive: (name) => t('common.organizer.archive.unarchive', { name }),
              },
              // 空态此前**根本没接线**（共享层注释写着"宿主不传就什么都不渲染"），
              // 于是侧栏里一块空白被当成"这个功能没东西"。词条与移动端同一套
              // （`common.organizer.*`）—— 同一句话不许有两个端各写一份。
              empty: t('common.organizer.lists.empty'),
              emptyHint: t('common.organizer.lists.empty.hint'),
            }}
            onFilterWith={(item) => {
              onFilterWith({ kind: 'project', projectId: item.id });
            }}
            onRename={(item, name) => {
              void projects.renameProject(item.id, name);
            }}
            onArchive={(item, archived) => {
              // 传的是**目标状态**（共享层按这一行的 `archived` 推出来的），
              // 不是"切换一下" —— 两个写"归档"的按钮里有一个其实在取消归档。
              void projects.archiveProject(item.id, archived);
            }}
            onRemove={(item) => {
              void projects.deleteProject(item.id);
            }}
            // 顶层画文件夹、子级不画 —— "层级"的一部分，与缩进一起。
            renderLeading={(_item, context) =>
              context.isChild ? null : <Folder size={ICON_SIZE.xs} aria-hidden="true" />
            }
            renderItemExtra={(item) => (
              <>
                <ColorSlotPicker
                  value={slotOf(item.id)}
                  onChange={(slot) => {
                    void projects.setProjectColor(item.id, slot);
                  }}
                  targetName={item.name}
                />
                {/*
                  ✅ 「移入文件夹」用的是共享层**已有**的 `renderItemExtra` 插槽
                  （取色入口本来就走这条）⇒ `OrganizerList` 的行骨架一行没改。
                  候选集来自领域层，与移动端同一个函数，所以两端不会出现
                  "这边能选那边不能选"。
                */}
                <FolderPicker
                  item={item}
                  candidates={(folderTargets.get(item.id) ?? []).map((target) => ({
                    id: target.id,
                    name: target.name,
                  }))}
                  currentParentId={parentOf(item.id)}
                  labels={{
                    button: (name) => t('common.organizer.folder.button', { name }),
                    title: t('common.organizer.folder.title'),
                    none: t('common.organizer.folder.none'),
                    current: t('common.organizer.folder.current'),
                  }}
                  onSelect={(targetId) => {
                    setFolderError('');
                    void projects
                      .setProjectParent(item.id, targetId)
                      .catch((cause: unknown) => {
                        setFolderError(t(folderRejectionMessageKey(cause) as MessageKey));
                      });
                  }}
                  testID={`web-list-folder-${item.id}`}
                />
              </>
            )}
            testID="projects-list"
          />
          {folderError === '' ? null : (
            // 复用 `.ht-settings__danger`（定义在 `ai-panels.css` 那组共享选择器里）
            // 而不是新造一个类 —— 新增 CSS 类会去动 `check:design` / 行样式单一来源那几道
            // 棘轮，而这里需要的只是"一句红字"，不是新的视觉语汇。
            <p className="ht-settings__danger" role="alert" data-testid="list-folder-failed">
              {folderError}
            </p>
          )}
        </section>

        <section>
          <div className="ht-sidebar__organizer-heading">
            <h2 className="ht-nav__section ht-type-group-label">{t('web.tags.heading')}</h2>
            <button
              type="button"
              className="ht-sidebar__organizer-add"
              aria-label={t('web.tags.addNew')}
              aria-expanded={createKind === 'tag'}
              onClick={() => {
                setCreateKind((current) => (current === 'tag' ? null : 'tag'));
              }}
            >
              <Plus size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
          </div>

          {/*
            🔴 标签名此前是一个**不可点的 `<span>`** —— 于是 `TaskFilter` 的
            `{ kind: 'tag' }` 分支虽然存在于共享层（`packages/domain/src/task-filter.ts`）
            并有单测，**却没有任何界面能把筛选切过去**。现在它与清单走同一份
            `OrganizerList`，`onFilterWith` 必须传下去 —— 否则这个空洞会静默回来。
          */}
          <OrganizerList
            kind="tag"
            items={tagNodes}
            counts={tagCounts}
            removeImpact={tagRemoveImpact}
            labels={{
              removeLabel: (name) => t('web.tags.delete', { name }),
              /*
                标签**只接改名、不接归档**：`Tag` 领域实体里没有 `archived` 字段
                （`Project` 有），所以这里没有"归档"这个意图可表达 —— 共享层
                因此不渲染那个按钮（`labels.archive` 省略即不画）。
              */
              rename: {
                button: (name) => t('common.organizer.rename.button', { name }),
                save: t('common.organizer.rename.save'),
                cancel: t('common.organizer.rename.cancel'),
              },
              confirmRemove: {
                ask: (name) => t('common.organizer.confirm.ask', { name }),
                impact: (count) => t('common.organizer.confirm.impactTags', { count }),
                confirm: t('common.organizer.confirm.delete'),
                cancel: t('common.organizer.confirm.cancel'),
              },
              empty: t('common.organizer.tags.empty'),
              emptyHint: t('common.organizer.tags.empty.hint'),
            }}
            onFilterWith={(item) => {
              onFilterWith({ kind: 'tag', tagId: item.id });
            }}
            onRename={(item, name) => {
              void projects.renameTag(item.id, name);
            }}
            onRemove={(item) => {
              void projects.deleteTag(item.id);
            }}
            renderLeading={() => <TagIcon size={ICON_SIZE.xs} aria-hidden="true" />}
            testID="tags-list"
          />
        </section>

        <CategoryCreateDialog
          open={createKind !== null}
          kind={createKind ?? 'project'}
          existingNames={createKind === 'tag' ? projects.tags.map((item) => item.name) : projects.projects.map((item) => item.name)}
          supportsColor={createKind === 'project'}
          onClose={() => setCreateKind(null)}
          onCreate={async ({ name, color }) => {
            if (createKind === 'project') {
              const id = await projects.addProject(name, undefined, color);
              if (id !== undefined) onFilterWith({ kind: 'project', projectId: id });
            } else {
              const id = await projects.addTag(name);
              if (id !== undefined) onFilterWith({ kind: 'tag', tagId: id });
            }
          }}
        />
      </aside>
    </HeytaUiProvider>
  );
}

const asideStyle: React.CSSProperties = {
  padding: cssVar('space.3'),
  /*
    🔴 这里**不许**再写 `minWidth: cssVar('layout.sidebar-width')`。
    那一行把这一列钉死在 15rem —— 2026-09-30 侧栏改成可拖宽之后，它就是
    "拖不动"的直接原因（子元素的 min-width 会把网格列撑回去）。
    宽度由列决定，内容只负责填满它（`minWidth: 0` 让长清单名能省略号而不是撑列）。
  */
  width: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.4'),
};
