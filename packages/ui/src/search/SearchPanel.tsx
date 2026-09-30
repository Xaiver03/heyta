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
 * ## 🔴 与顶栏那个输入框的**分工**（两个都在，不是重复）
 *
 * | | 顶栏输入框 | 本浮层 |
 * |---|---|---|
 * | 范围 | **当前任务列表**（受当前筛选约束） | **全部任务 + 全部便签** |
 * | 结果 | 就地过滤，列表自己变 | 分组列出，点一条跳过去 |
 * | 用途 | "在这个清单里找那条" | "我记过这么一句话，在哪？" |
 *
 * 两者都保留是刻意的：删掉顶栏那个是**功能倒退**（它在任务页上更快），
 * 而只有顶栏那个则**够不到便签**。这一条写在这里，免得下一个读的人以为是重复建设。
 *
 * ## 🔴 它是"面板"而不是"浮层"
 *
 * 曾经叫 `SearchOverlay`（照滴答的浮层形状起的名）。改名是因为**摆在哪是宿主的决定**：
 * 本组件只是一张带边框的卡片（输入、分组结果、两种空态）。
 * 2026-09-30 起 web 宿主把它包进 `.ht-search-overlay`（居中 + scrim，
 * §11.5"透出下层视图"）；mobile 宿主仍按自己的页面结构摆。
 * **卡片归本层，浮层归宿主** —— 所以"点 scrim 关 / Esc 关"这些浮层行为
 * 也都在宿主（`apps/web/src/App.tsx`）那边，不在这里。
 *
 * ## 结果怎么排
 *
 * **任务在前、便签在后**，各自内部沿用**它们自己的展示序**
 *（任务走 `TaskList` 的排序、便签走 `sortNotesForDisplay`）——
 * 本层不重新排序：那会让"搜索结果里的顺序"与"去那一页看到的顺序"不一致。
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Note, Task } from '@heyta/domain';
import { Search, X } from 'lucide';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon } from '../icon/Icon.js';
import { toNoteRows } from '../notes/model.js';
import { TaskList, type TaskListLabels } from '../task-list/TaskList.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';

/**
 * 浮层的全部文案 —— **宿主注入**（本层不许 `import '@heyta/i18n'`，
 * 理由见 `calendar/model.ts` 文件头：会拖进第二份 React）。
 */
export interface SearchPanelLabels {
  readonly title: string;
  readonly placeholder: string;
  readonly close: string;
  readonly tasksSection: string;
  readonly notesSection: string;
  /** 一个字都没输入时的提示（不是"没找到" —— 那两件事不一样）。 */
  readonly prompt: string;
  /** 搜了但没结果。 */
  readonly noResults: string;
  /** 结果条数，如「3 条」。 */
  readonly count: (n: number) => string;
  /** 任务行自己的文案（勾选框读屏名等）—— 原样转交给共享 `TaskList`。 */
  readonly taskRow: TaskListLabels;
}

export interface SearchPanelProps {
  readonly query: string;
  readonly onQueryChange: (q: string) => void;
  readonly onClose: () => void;
  /** **已经过滤好的**任务（宿主用 `searchTasks`）。 */
  readonly tasks: readonly Task[];
  /** **已经过滤好的**便签（宿主用 `searchNotes`）。 */
  readonly notes: readonly Note[];
  readonly onToggleTask: (taskId: string) => void;
  readonly onOpenTask?: ((taskId: string) => void) | undefined;
  readonly onOpenNote?: ((noteId: string) => void) | undefined;
  readonly busyTaskId?: string | null | undefined;
  readonly labels: SearchPanelLabels;
  readonly testID?: string | undefined;
}

export function SearchPanel({
  query,
  onQueryChange,
  onClose,
  tasks,
  notes,
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
  const total = tasks.length + notes.length;

  return (
    <View
      style={[
        styles.panel,
        {
          gap: tokens['space.3'],
          padding: tokens['space.4'],
          borderRadius: tokens['radius.lg'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.border'],
          backgroundColor: tokens['color.surface'],
        },
      ]}
      testID={testID}
      // 浮层是**一层**语义单元：读屏进去先说"搜索"，而不是从头念 40 个结果。
      accessibilityRole="none"
      accessibilityLabel={labels.title}
    >
      <View style={styles.head}>
        <HeytaIcon data={Search} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
        <Text style={[text['section-title'], styles.title]}>{labels.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.close}
          onPress={onClose}
          style={styles.closeButton}
          testID={`${testID}-close`}
        >
          <HeytaIcon data={X} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
        </Pressable>
      </View>

      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder={labels.placeholder}
        placeholderTextColor={tokens['color.foreground-subtle']}
        // 自动聚焦：用户点「搜索」就是要打字，再让他点一下输入框是多余的。
        autoFocus
        // 🔴 `onSubmitEditing` 不关浮层 —— 回车是"搜完了"，不是"关掉"。
        style={[
          text['row-title'],
          styles.input,
          {
            minHeight: tokens['touch-target.min'],
            paddingHorizontal: tokens['space.3'],
            borderRadius: tokens['radius.sm'],
            borderWidth: tokens['border-width.thin'],
            borderColor: tokens['color.border'],
            color: tokens['color.foreground'],
            backgroundColor: tokens['color.background'],
          },
        ]}
        testID={`${testID}-input`}
      />

      {trimmed === '' ? (
        // ⚠️ "还没输入"与"没找到"是**两件事**，文案不同 —— 合并成一句
        // 会让用户以为自己的库里真的什么都没有。
        <Text
          style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}
          testID={`${testID}-prompt`}
        >
          {labels.prompt}
        </Text>
      ) : total === 0 ? (
        <EmptyState title={labels.noResults} testID={`${testID}-empty`} />
      ) : (
        <ScrollView style={styles.results} testID={`${testID}-results`}>
          {tasks.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[text['row-title'], styles.sectionTitle]}>{labels.tasksSection}</Text>
                <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
                  {labels.count(tasks.length)}
                </Text>
              </View>
              <TaskList
                tasks={[...tasks]}
                onToggleTask={onToggleTask}
                onOpenTask={onOpenTask}
                busyTaskId={busyTaskId ?? null}
                labels={labels.taskRow}
                testID={`${testID}-tasks`}
              />
            </View>
          ) : null}

          {noteRows.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[text['row-title'], styles.sectionTitle]}>{labels.notesSection}</Text>
                <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
                  {labels.count(noteRows.length)}
                </Text>
              </View>
              {noteRows.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  // 读屏时一屏十几行摘要没有意义 —— 每行自带它自己的那句话。
                  accessibilityLabel={row.excerpt}
                  onPress={() => onOpenNote?.(row.id)}
                  disabled={onOpenNote === undefined}
                  style={[
                    styles.noteRow,
                    {
                      minHeight: tokens['touch-target.min'],
                      gap: tokens['space.2'],
                      paddingVertical: tokens['space.2'],
                    },
                  ]}
                  testID={`${testID}-note-${row.id}`}
                >
                  <Text
                    style={[text['row-title'], { color: tokens['color.foreground'] }]}
                    numberOfLines={2}
                  >
                    {row.excerpt}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    panel: {},
    head: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
    title: { flex: 1 },
    closeButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
    },
    input: {},
    results: { maxHeight: tokens['layout.panel-max-height'] },
    section: { gap: tokens['space.2'], marginBottom: tokens['space.3'] },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
    sectionTitle: { flex: 1 },
    noteRow: { justifyContent: 'center' },
  });
}
