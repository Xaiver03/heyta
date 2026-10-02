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
 *   3. 平台特有物：DOM `<form><input>` + `<ColorSlotPicker>`；
 *   4. 点一行之后要做什么 —— **必须经由 `onSelect`，不能直接 `tasks.setFilter`**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 点清单必须经由 `onSelect`，不能直接 `tasks.setFilter`
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { parseCategorySlot } from '@heyta/domain';
import { Check, Folder, Plus, Tag as TagIcon } from 'lucide-react';
import {
  HeytaUiProvider,
  OrganizerList,
  openTagCounts,
  openTaskCounts,
  toOrganizerNodes,
  toOrganizerTree,
  toTagItems,
} from '@heyta/ui';

import { ColorSlotPicker } from '../categories/ColorSlotPicker.js';
import { useTaskStore, type TaskFilter } from '../tasks/store.js';
import { useProjectStore } from './store.js';

export function ProjectsPanel({
  onSelect,
}: {
  /** 用户选了某个清单 / 标签。宿主负责切视图并落筛选（见文件头）。 */
  onSelect: (filter: TaskFilter) => void;
}) {
  const { t } = useI18n();
  const projects = useProjectStore();
  const tasks = useTaskStore();
  const [draft, setDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  // 输入框**默认不出现**（点标题右侧的 + 才展开）。与草稿分开存：
  // 收起不清草稿，重新点开还能接着打 —— 只有 Esc 才明确丢弃。
  const [addingProject, setAddingProject] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  /*
     🔴 收起挂在**面板外的 pointerdown**上：不是 `blur`（会和标题 `+` 打架 ——
     点按钮时 `blur` 先收起，`click` 又把 toggle 判成"重新展开"，症状是
     "再点一次关不掉"），也**不是"另一个区块"**。
     后者是本轮 e2e 抓出来的真缺陷：两个区块上下排着，点「标签」的 + 时，
     "清单区块外 ⇒ 收起"在 `pointerdown` 就删掉了上面那 52px，标题整块**往上跳**，
     `mouseup` 落在别处 ⇒ `click` 根本不派发给那个按钮。用户看到的是
     "清单输入框消失了，标签输入框没出来" —— 第一下点击白点。
     所以区块之间的互斥放进各自的 onClick（同一个事件里批量更新，点击已经成立了），
     这里只管"点到面板以外"。
   */
  useEffect(() => {
    if (!addingProject && !addingTag) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target === null) return;
      if (asideRef.current?.contains(target)) return;
      setAddingProject(false);
      setAddingTag(false);
    }
    // 捕获：共享层里若有控件在冒泡阶段 `stopPropagation`（§7 第 80 条同源），
    // 冒泡监听会收不到，症状又是"点了没反应"。
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [addingProject, addingTag]);

  // 层级与计数口径都在共享层（`toOrganizerTree` / `openTaskCounts`）。
  const tree = useMemo(() => toOrganizerTree(projects.projects), [projects.projects]);
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
   * 清单 id → 当前色槽。渲染时按 id 查，而不是把 map 塞进行模型 ——
   * "清单长什么样"是领域字段，不属于行的展示模型。
   */
  function slotOf(projectId: string) {
    return parseCategorySlot(projects.projects.find((p) => p.id === projectId)?.color);
  }

  return (
    <HeytaUiProvider>
      <aside ref={asideRef} aria-label={t('web.projects.ariaLabel')} style={asideStyle}>
        <section>
          <div className="ht-sidebar__organizer-heading">
            <h2 className="ht-nav__section">{t('web.projects.heading')}</h2>
            <button
              type="button"
              className="ht-sidebar__organizer-add"
              aria-label={t('web.projects.addNew')}
              aria-expanded={addingProject}
              onClick={() => {
                // 互斥放在**这里**而不是 pointerdown 的收起逻辑里：同一个 click
                // 事件内批量更新，点击已经成立，不会把下一区块的标题顶走。
                const next = !addingProject;
                setAddingProject(next);
                if (next) setAddingTag(false);
              }}
            >
              <Plus size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
          </div>
          {addingProject ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void projects.addProject(draft);
                setDraft('');
                // 建完**不收起**：连建几条清单是常态，收起会逼用户每建一条
                // 就重新点一次开。收起只有两条路：Esc（连草稿一起丢）或点到面板外（留着草稿）。
              }}
              style={formStyle}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setDraft('');
                    setAddingProject(false);
                  }
                }}
                placeholder={t('web.projects.newPlaceholder')}
                aria-label={t('web.projects.newLabel')}
                style={inputStyle}
              />
              <button type="submit" aria-label={t('web.projects.add')} style={iconButtonStyle}>
                <Check size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </form>
          ) : null}

          <OrganizerList
            kind="project"
            items={tree}
            counts={counts}
            labels={{
              removeLabel: (name) => t('web.projects.delete', { name }),
              // 空态此前**根本没接线**（共享层注释写着"宿主不传就什么都不渲染"），
              // 于是侧栏里一块空白被当成"这个功能没东西"。词条与移动端同一套
              // （`common.organizer.*`）—— 同一句话不许有两个端各写一份。
              empty: t('common.organizer.lists.empty'),
              emptyHint: t('common.organizer.lists.empty.hint'),
            }}
            onSelect={(item) => {
              onSelect({ kind: 'project', projectId: item.id });
            }}
            onRemove={(item) => {
              void projects.deleteProject(item.id);
            }}
            // 顶层画文件夹、子级不画 —— "层级"的一部分，与缩进一起。
            renderLeading={(_item, context) =>
              context.isChild ? null : <Folder size={ICON_SIZE.xs} aria-hidden="true" />
            }
            renderItemExtra={(item) => (
              <ColorSlotPicker
                value={slotOf(item.id)}
                onChange={(slot) => {
                  void projects.setProjectColor(item.id, slot);
                }}
                targetName={item.name}
              />
            )}
            testID="projects-list"
          />
        </section>

        <section>
          <div className="ht-sidebar__organizer-heading">
            <h2 className="ht-nav__section">{t('web.tags.heading')}</h2>
            <button
              type="button"
              className="ht-sidebar__organizer-add"
              aria-label={t('web.tags.addNew')}
              aria-expanded={addingTag}
              onClick={() => {
                const next = !addingTag;
                setAddingTag(next);
                if (next) setAddingProject(false);
              }}
            >
              <Plus size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
          </div>
          {addingTag ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void projects.addTag(tagDraft);
                setTagDraft('');
              }}
              style={formStyle}
            >
              <input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTagDraft('');
                    setAddingTag(false);
                  }
                }}
                placeholder={t('web.tags.newPlaceholder')}
                aria-label={t('web.tags.newLabel')}
                style={inputStyle}
              />
              <button type="submit" aria-label={t('web.tags.add')} style={iconButtonStyle}>
                <Check size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </form>
          ) : null}

          {/*
            🔴 标签名此前是一个**不可点的 `<span>`** —— 于是 `TaskFilter` 的
            `{ kind: 'tag' }` 分支虽然存在于共享层（`packages/domain/src/task-filter.ts`）
            并有单测，**却没有任何界面能把筛选切过去**。现在它与清单走同一份
            `OrganizerList`，`onSelect` 必须传下去 —— 否则这个空洞会静默回来。
          */}
          <OrganizerList
            kind="tag"
            items={tagNodes}
            counts={tagCounts}
            labels={{
              removeLabel: (name) => t('web.tags.delete', { name }),
              empty: t('common.organizer.tags.empty'),
              emptyHint: t('common.organizer.tags.empty.hint'),
            }}
            onSelect={(item) => {
              onSelect({ kind: 'tag', tagId: item.id });
            }}
            onRemove={(item) => {
              void projects.deleteTag(item.id);
            }}
            renderLeading={() => <TagIcon size={ICON_SIZE.xs} aria-hidden="true" />}
            testID="tags-list"
          />
        </section>
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

const formStyle: React.CSSProperties = {
  display: 'flex',
  gap: cssVar('space.1'),
  marginBottom: cssVar('space.2'),
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minHeight: cssVar('touch-target.min'),
  padding: `0 ${cssVar('space.2')}`,
  borderRadius: cssVar('radius.md'),
  border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
  background: cssVar('color.background'),
  color: cssVar('color.foreground'),
  // ≥16px，否则 iOS 聚焦时自动放大页面
  fontSize: cssVar('font-size.base'),
  fontFamily: cssVar('font.sans'),
  minWidth: 0,
};

const iconButtonStyle: React.CSSProperties = {
  minWidth: cssVar('touch-target.min'),
  minHeight: cssVar('touch-target.min'),
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  color: cssVar('color.foreground-muted'),
  borderRadius: cssVar('radius.md'),
};
