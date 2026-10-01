/**
 * `SearchPanel` —— 全局搜索面板，**四端同一份**
 * =================================================
 *
 * ## 它补的是什么
 *
 * 2026-09-29 实测：两端**都有**搜索，但都是"**当前列表的内联筛选**"
 *（web 顶栏那个输入框、mobile 任务页那个输入框），共用 `@heyta/domain` 的
 * `searchTasks`。而 **便签完全没有搜索入口** ——
 * `NotesView` / `NotesBoard` 里一个 `query` 都没有。
 *
 * ⇒ "我记得写过一条便签，里面有某个词" 这件事**没有任何地方能做**。
 * 滴答的 rail 搜索正是干这个的：它开的是一个**跨实体的浮层**，不是一个列表筛选
 *（`dida-capture/INTERFACE-NOTES.md` §1.3：搜索是"主列③浮层、侧栏②与右栏④透出下层视图"）。
 *
 * ## 🔴 2026-10-01：一个应用**只有一个搜索入口**（产品负责人拍板）
 *
 * 上面那份"顶栏输入框 + 浮层"的分工**已被推翻**，推翻的理由不是审美：
 * 同屏出现两个都能输入搜索词的框，用户必须先回答"我该在哪个里打字"，
 * 而这两个框的结果还不是一回事 —— 那是把内部实现的不一致摆到了界面上。
 * web 顶栏那个输入框已删除，rail 上的「搜索」是**唯一入口**；
 * mobile 任务页的输入框**不是搜索**（它是当前列表的筛选，词也不进这个面板），
 * 它复用 `web.shell.search.*` 那三条词条，本文件与它们无关。
 *
 * ## 形态：macOS 聚焦搜索（Spotlight），内容是我们自己的
 *
 * 借的是**形态**：前置放大镜 + 无边框大字输入、一条发丝分隔线、
 * 分组结果（每组一个标题 + 条数、每行一个图标 + 主文 + 灰色副文）、
 * 底部一排键位提示。**不借内容** —— 分组只有「任务 / 便签 / 快速跳转」，
 * 没有计算器、没有汇率、没有"搜索维基百科"。
 *
 * 🔴 「快速跳转」与 `searchTasks` 的裁决**不冲突**：
 * `domain/search.ts` 文件头第 1 条拒绝的是"在任务搜索里联表匹配清单名/标签名"，
 * 它给出的替代正是"想按清单找就**点清单**"。这一组就是那个"点"的入口 ——
 * 它是**导航**，不是把清单名塞进任务的匹配字段。
 *
 * ## 🔴 键盘光标归宿主，判据归本层
 *
 * 光标（高亮哪一行、回车打开哪一行）**不由本组件监听按键**：
 * RN 0.84.1 的 `TextInput` 类型上**只有 `onKeyPress`、没有 `onKeyDown`**，
 * 而 react-native-web 的 `TextInput` 在 keydown 里无条件 `stopPropagation()`
 * （§7 第 80 条）—— 在输入框里挂键监听这条路根本不通。
 * 于是宿主用**捕获阶段**的 window 监听（`apps/web/src/App.tsx`）算出光标，
 * 把它解析成 `activeEntry` 传进来；上下键怎么走、越界怎么办、
 * 空结果时不许有幽灵光标 —— 全部是 `search/model.ts` 里的**纯函数**，
 * 所以移动端（没有键盘）只要不传 `activeEntry` / `keyHints` 就自动退化成一屏可点列表。
 *
 * ## 结果怎么排
 *
 * **任务在前、便签在后、快速跳转最后**，任务与便签各自内部沿用
 * **它们自己的展示序**（任务走 `TaskList` 的排序、便签走 `sortNotesForDisplay`）——
 * 本层不重新排序：那会让"搜索结果里的顺序"与"去那一页看到的顺序"不一致。
 * 宿主算光标长度用的 `buildResultEntries` 就是这个顺序（同一条判据，只有一处定义）。
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Note, Task } from '@heyta/domain';
import { CornerDownRight, Folder, Search, StickyNote, Tag } from 'lucide';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon, type HeytaIconData } from '../icon/Icon.js';
import { toNoteRows } from '../notes/model.js';
import { TaskList, type TaskListLabels } from '../task-list/TaskList.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { QuickAction, SearchResultEntry } from './model.js';

/**
 * 浮层的全部文案 —— **宿主注入**（本层不许 `import '@heyta/i18n'`，
 * 理由见 `calendar/model.ts` 文件头：会拖进第二份 React）。
 */
export interface SearchPanelLabels {
  /** 面板的无障碍名（宿主同时用它做浮层的 `aria-label`）。界面上**不出现**这行字。 */
  readonly title: string;
  readonly placeholder: string;
  /** 一个字都没输入时的提示（不是"没找到" —— 那两件事不一样）。 */
  readonly prompt: string;
  /** 搜了但没结果。 */
  readonly noResults: string;
  readonly tasksSection: string;
  readonly notesSection: string;
  readonly quickSection: string;
  /** 结果条数，如「3 条」。 */
  readonly count: (n: number) => string;
  /** 任务行自己的文案（勾选框读屏名等）—— 原样转交给共享 `TaskList`。 */
  readonly taskRow: TaskListLabels;
  /**
   * 底部键位提示。**不给就不渲染** —— 触屏端没有这些键，
   * 把「esc 关闭」画在手机上是谎报能力。
   *
   * 🔴 每一项是**一整句**（含键位符号，如「↑↓ 导航」），由宿主的词条表给：
   * 键位符号与词是一个语义单元，拆开拼就会出现英文侧 "Navigate ↑↓" 那种倒装。
   */
  readonly keyHints?: {
    readonly navigate: string;
    readonly open: string;
    readonly close: string;
  };
}

export interface SearchPanelProps {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  /** **已经过滤好的**任务（宿主用 `searchTasks`）。 */
  readonly tasks: readonly Task[];
  /** **已经过滤好的**便签（宿主用 `searchNotes`）。 */
  readonly notes: readonly Note[];
  /**
   * **已经过滤、已经限量**的快速跳转项（宿主用 `filterQuickActions`）。
   * 每一项自带 `onSelect` —— 跳转去哪是宿主的决定，本层只负责画和点。
   */
  readonly quick?: readonly QuickAction[];
  /**
   * 键盘光标当前指着哪一条（宿主从 `buildResultEntries` + `moveCursor` 解析）。
   * `null` / 不传 = 没有光标（焦点在输入框里，或根本没有键盘）。
   */
  readonly activeEntry?: SearchResultEntry | null;
  readonly onToggleTask: (taskId: string) => void;
  readonly onOpenTask?: ((taskId: string) => void) | undefined;
  readonly onOpenNote?: ((noteId: string) => void) | undefined;
  readonly busyTaskId?: string | null | undefined;
  readonly labels: SearchPanelLabels;
  readonly testID?: string | undefined;
}

/** 分组 → 图标。**只用到 `lucide` 的数据**（`Icon.tsx` 文件头那条理由）。 */
const QUICK_ICON: Record<QuickAction['group'], HeytaIconData> = {
  view: CornerDownRight,
  project: Folder,
  tag: Tag,
};

export function SearchPanel({
  query,
  onQueryChange,
  tasks,
  notes,
  quick = [],
  activeEntry = null,
  onToggleTask,
  onOpenTask,
  onOpenNote,
  busyTaskId,
  labels,
  testID = 'search-overlay',
}: SearchPanelProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const noteRows = useMemo(() => toNoteRows(notes), [notes]);

  const trimmed = query.trim();
  const total = tasks.length + noteRows.length + quick.length;

  /**
   * 🔴 三组各拿自己那一份光标：判据是 `kind` **且** `id`，
   * 少一半就会让"任务 id 恰好等于某个标签 id"时两组同时高亮。
   */
  const activeTaskId = activeEntry?.kind === 'task' ? activeEntry.id : null;

  return (
    <View
      style={[
        styles.panel,
        {
          borderRadius: tokens['radius.lg'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.border'],
          /**
           * 🔴 **玻璃 = 半透明底色（这里）+ 背景模糊（宿主的 CSS）**，两半缺一不可。
           *
           * 为什么底色放在共享层而不由宿主覆盖：RN-web 把 `backgroundColor` 编译成
           * 它自己注入的原子类，宿主的样式表**未必赢得了注入顺序** —— 把材质做在
           * 组件消费的那个 token 上，四个端拿到的才是同一个材质。
           * 为什么模糊放在宿主：`backdrop-filter` 只在 CSS 里合法，RN 没有这个属性
           * （与 `native-values.ts` 里 shadow / cubic-bezier 同一类划分）。
           *
           * ⚠️ 设计系统的材质规则第 2 条写着"禁止把亮色半透明面叠在另一个半透明面上"。
           * 这里**是**叠在 scrim 上，靠的就是那层模糊：模糊把底下的文字抹成匀质色板，
           * 于是前景对比不再取决于"下面恰好有什么字"—— 这正是 Apple 材质把 tint 与
           * blur 配成一对的原因。少了 blur，这条材质就不该用。
           */
          backgroundColor: tokens['material.chrome-tint'],
        },
      ]}
      testID={testID}
      // 浮层是**一层**语义单元：读屏进去先说"搜索"，而不是从头念 40 个结果。
      accessibilityRole="none"
      accessibilityLabel={labels.title}
    >
      {/**
       * 输入行：放大镜 + **无边框**输入。
       *
       * 🔴 字号走 `section-title`（lg + semibold）而不是 `row-title`：
       * 顶栏标题行删掉之后，这一行就是面板唯一的标题级文本。
       * 只挑 `font-size.lg` 会违反排版纪律（语义样式必须整条消费）。
       */}
      <View style={styles.field}>
        <HeytaIcon
          data={Search}
          size={tokens['icon.md']}
          color={tokens['color.foreground-muted']}
        />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder={labels.placeholder}
          placeholderTextColor={tokens['color.foreground-subtle']}
          // 自动聚焦：用户点「搜索」就是要打字，再让他点一下输入框是多余的。
          autoFocus
          // 🔴 `onSubmitEditing` 不关浮层 —— 回车是"打开高亮的那一条"（宿主判），不是"关掉"。
          style={[text['section-title'], styles.input]}
          testID={`${testID}-input`}
        />
      </View>

      {trimmed === '' ? (
        // ⚠️ "还没输入"与"没找到"是**两件事**，文案不同 —— 合并成一句
        // 会让用户以为自己的库里真的什么都没有。
        <Text style={[text['row-meta'], styles.prompt]} testID={`${testID}-prompt`}>
          {labels.prompt}
        </Text>
      ) : total === 0 ? (
        <EmptyState title={labels.noResults} testID={`${testID}-empty`} />
      ) : (
        <ScrollView style={styles.results} testID={`${testID}-results`}>
          {tasks.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[text['panel-title'], styles.sectionTitle]}>{labels.tasksSection}</Text>
                <Text style={[text['caption'], styles.sectionCount]}>{labels.count(tasks.length)}</Text>
              </View>
              <TaskList
                tasks={[...tasks]}
                onToggleTask={onToggleTask}
                onOpenTask={onOpenTask}
                busyTaskId={busyTaskId ?? null}
                activeTaskId={activeTaskId}
                labels={labels.taskRow}
                testID={`${testID}-tasks`}
              />
            </View>
          ) : null}

          {noteRows.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[text['panel-title'], styles.sectionTitle]}>
                  {labels.notesSection}
                </Text>
                <Text style={[text['caption'], styles.sectionCount]}>{labels.count(noteRows.length)}</Text>
              </View>
              {noteRows.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  // 读屏时一屏十几行摘要没有意义 —— 每行自带它自己的那句话。
                  accessibilityLabel={row.excerpt}
                  accessibilityState={{ selected: isRowActive(activeEntry, 'note', row.id) }}
                  onPress={() => onOpenNote?.(row.id)}
                  disabled={onOpenNote === undefined}
                  style={[
                    styles.row,
                    isRowActive(activeEntry, 'note', row.id) ? styles.rowActive : null,
                  ]}
                  testID={`${testID}-note-${row.id}`}
                >
                  <HeytaIcon
                    data={StickyNote}
                    size={tokens['icon.sm']}
                    color={tokens['color.foreground-muted']}
                  />
                  <Text style={[text['row-title'], styles.rowMain]} numberOfLines={2}>
                    {row.excerpt}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {quick.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[text['panel-title'], styles.sectionTitle]}>{labels.quickSection}</Text>
              </View>
              {quick.map((action) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  // 副文（视图 / 清单 / 标签）拼进读屏名：只念"工作"会听不出它是清单还是标签。
                  accessibilityLabel={
                    action.hint === undefined ? action.label : `${action.label} ${action.hint}`
                  }
                  accessibilityState={{ selected: isRowActive(activeEntry, 'quick', action.id) }}
                  onPress={action.onSelect}
                  style={[
                    styles.row,
                    isRowActive(activeEntry, 'quick', action.id) ? styles.rowActive : null,
                  ]}
                  testID={`${testID}-quick-${action.id}`}
                >
                  <HeytaIcon
                    data={QUICK_ICON[action.group]}
                    size={tokens['icon.sm']}
                    color={tokens['color.foreground-muted']}
                  />
                  <Text style={[text['row-title'], styles.rowMain]} numberOfLines={1}>
                    {action.label}
                  </Text>
                  {action.hint === undefined ? null : (
                    <Text style={[text['caption'], styles.rowHint]} numberOfLines={1}>
                      {action.hint}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      {labels.keyHints ? (
        <View style={styles.keys} testID={`${testID}-keys`}>
          <Text style={[text['caption'], styles.keyChip]}>{labels.keyHints.navigate}</Text>
          <Text style={[text['caption'], styles.keyChip]}>{labels.keyHints.open}</Text>
          <Text style={[text['caption'], styles.keyChip]}>{labels.keyHints.close}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 光标指的是不是这一行 —— `kind` 与 `id` 必须同时成立（见调用处那段）。 */
function isRowActive(
  activeEntry: SearchResultEntry | null | undefined,
  kind: SearchResultEntry['kind'],
  id: string,
): boolean {
  return activeEntry !== null && activeEntry !== undefined && activeEntry.kind === kind && activeEntry.id === id;
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    panel: { paddingVertical: tokens['space.2'] },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.4'],
      paddingVertical: tokens['space.2'],
      borderBottomWidth: tokens['border-width.thin'],
      borderBottomColor: tokens['color.border-subtle'],
    },
    input: {
      flex: 1,
      // 🔴 无边框、无底色：分隔由 `field` 那条发丝线承担。
      borderWidth: 0,
      outlineWidth: 0,
      color: tokens['color.foreground'],
      backgroundColor: 'transparent',
      minHeight: tokens['touch-target.min'],
      paddingVertical: 0,
    },
    prompt: { color: tokens['color.foreground-subtle'], paddingHorizontal: tokens['space.4'] },
    results: { maxHeight: tokens['layout.panel-max-height'] },
    section: { marginBottom: tokens['space.2'] },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      paddingHorizontal: tokens['space.4'],
      paddingTop: tokens['space.2'],
      paddingBottom: tokens['space.1'],
    },
    sectionTitle: { color: tokens['color.foreground-muted'] },
    sectionCount: { color: tokens['color.foreground-subtle'] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.4'],
      paddingVertical: tokens['space.2'],
    },
    rowActive: {
      // 与 `TaskRow` 的 `active` 同一档底色：三组共用一个"键盘选中"的样子。
      backgroundColor: tokens['color.primary-subtle'],
    },
    rowMain: { flex: 1, color: tokens['color.foreground'] },
    rowHint: { color: tokens['color.foreground-subtle'] },
    keys: {
      flexDirection: 'row',
      gap: tokens['space.2'],
      paddingHorizontal: tokens['space.4'],
      paddingTop: tokens['space.2'],
      borderTopWidth: tokens['border-width.thin'],
      borderTopColor: tokens['color.border-subtle'],
    },
    keyChip: { color: tokens['color.foreground-subtle'] },
  });
}
