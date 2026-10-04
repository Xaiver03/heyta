/**
 * 便签板（共享视图）
 * ====================
 *
 * M3 第十刀的共享实现：**"一条便签在列表里长什么样、怎么新建一条"这件事
 * 只有这一个实现。** web 与 mobile 只决定"把它放在页面的哪里"、注入文案，
 * 以及把三个回调接到各自的 action 层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 便签是两端都要有的功能，而"顺序"与"摘要有几行"是最容易各写一份的东西：
 * 迁移前各端各 `sort()` 一次的结果是同一条便签在两端位置不同，
 * 用户会以为"同步把顺序搞乱了" —— 差异**不会让任何测试变红**。
 * 顺序、截断、高亮判定的唯一实现在 `./model.ts`，它内部又只调
 * `@heyta/domain` 的 `sortNotesForDisplay` / `noteExcerpt` / `isNoteHighlighted`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 composer 里**不进任何业务判断**，只挡"看起来是空的"这一种
 *
 * 内容校验的权威在 `@heyta/app-host#createNoteActions`（宿主会调用它：
 * 空白算空 / 超长拒绝都在那里）。共享层是四端共用的**展示**层，
 * 它不能替宿主决定"多长算长"—— 那会让 web 与手机出现两种长度限制。
 *
 * 唯一的例外是**交互挡板**：`trim()` 后为空时**不提交**，否则用户按了回车、
 * 输入框清空了、列表里却没多出任何东西，他会以为"这个按钮坏了"。
 * 这是一条交互规则，不是内容规则。
 *
 * ⚠️ 交回宿主的仍是**原样输入**（不做 trim 后的规范化）：挡板只回答"要不要提交"，
 * "提交什么"由宿主决定。想顺手规范化就会在两端各长出一次，而它们必然分叉。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList` / `HabitBoard` / `OrganizerList` 同一个理由：i18n 包自己带过
 * 一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。所以依赖行内容
 * 的无障碍名是函数（`a11yRemove(excerpt)`），模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `labels.a11yEdit` 与可选 `onEdit`（与任务书的一处不一致，已登记）
 *
 * 任务书把 `a11yEdit(excerpt)` 列进了 `labels`，但 props 清单里**没有**编辑回调。
 * 一个要求存在却没有任何入口的无障碍名是死代码，所以这里补了一个**可选**的
 * `onEdit`：传了就把摘要那一段变成可点的编辑入口，没传就是普通文本。
 * 两端的宿主现在都还没接编辑，因此默认路径下这条文案不会渲染出来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ composer 是**单行**的（一个刻意的取舍）
 *
 * 单行才能让回车 = 提交（`onSubmitEditing`）。便签正文在领域层允许多行，
 * 所以多行输入目前只能在别处产生（导入 / 将来的详情编辑器）。
 * 最小一步：`multiline` + 只留"添加"按钮提交，并在两个端各做一次聚焦验收。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `TextInput` / `Pressable` 在 `react-native-web` 上都有
 * 等价实现；`<textarea>` 在 iOS 上不存在。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Note } from '@heyta/domain';
import { Pin, PinOff, Plus, Trash2 } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { NOTE_EXCERPT_LENGTH, isNoteDraftBlank, toNoteRows } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface NotesBoardLabels {
  /** 一条便签都没有时那一句。 */
  readonly empty: string;
  /** 空态下面那句补充说明（"写点什么，它会留在所有设备上"之类的引导）。 */
  readonly emptyHint: string;
  readonly composerPlaceholder: string;
  readonly add: string;
  /** 未钉选时按钮上的字（点了会钉）。 */
  readonly pin: string;
  /** 已钉选时按钮上的字（点了会取消）。 */
  readonly unpin: string;
  readonly remove: string;
  /** 已钉到「今天」的徽标文字。 */
  readonly badgeToday: string;
  /** 编辑入口的无障碍名（见文件头；只有传了 `onEdit` 才会渲染这个入口）。 */
  readonly a11yEdit: (excerpt: string) => string;
  readonly a11yRemove: (excerpt: string) => string;
  readonly a11yPin: (excerpt: string) => string;
  readonly a11yUnpin: (excerpt: string) => string;
}

export interface NotesBoardProps {
  /** 未删除的便签（由宿主从 action 层取，`listNotes()` 已经是）。 */
  readonly notes: readonly Note[];
  /** 摘要长度。省略 = {@link NOTE_EXCERPT_LENGTH}（窄屏可收短）。 */
  readonly excerptLength?: number;
  /**
   * 新建。**内容校验的权威是宿主的 `createNoteActions`**（见文件头）——
   * 这里只在 `trim()` 后为空时不调用它。
   */
  readonly onAdd: (content: string) => void;
  /** 移除某一条。收便签 id。 */
  readonly onRemove: (entityId: string) => void;
  /** 切换钉选。`pinned` 是**目标值**（不是"切换一下"）。收便签 id。 */
  readonly onTogglePinned: (entityId: string, pinned: boolean) => void;
  /**
   * 打开编辑。**可选**：任务书的 props 清单里没有它，但 `labels.a11yEdit`
   * 又要求存在 —— 不传就不渲染编辑入口（见文件头）。
   */
  readonly onEdit?: (entityId: string) => void;
  /**
   * 🔴 **选中/光标在哪一条**（工单 W1c，与 `TaskRowProps.active`、web 习惯面的
   * `aria-current` 是同一个口径）。默认 `undefined` = 一行都不标，也就是本 prop
   * 出现之前的行为，所以移动端不接它不会有任何变化。
   *
   * 它表达的是"编辑器开的是哪一条 / 键盘光标停在哪儿"，**不是**钉选、不是今天徽标：
   * 那两件事已经有各自的通道（`note-today-*` 徽标 + 图标本身）。
   * 底色同样只用 `color.primary-subtle`（与 `TaskRow.rowActive` 同一个 token），
   * 因为便签摘要里可能带宿主不管的文字色。
   */
  readonly activeNoteId?: string;
  readonly labels: NotesBoardLabels;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: {
      gap: tokens['space.3'],
    },
    /** 输入行：输入框吃掉剩余宽度，按钮贴右。 */
    composer: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: tokens['space.2'],
    },
    input: {
      flex: 1,
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
      color: tokens['color.foreground'],
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
    },
    /** 空内容时按钮**仍然可见但置灰**：完全隐藏会让用户找不到"怎么加"。 */
    addDisabled: {
      opacity: tokens['state.disabled-opacity'],
    },
    addText: {
      color: tokens['color.on-primary'],
    },
    empty: {
      gap: tokens['space.1'],
    },
    list: {
      gap: tokens['space.2'],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    /**
     * 选中那一行的底色（见 `activeNoteId`）。与 `TaskRow.rowActive` 同 token、同形状：
     * **只加底色与圆角，不动任何几何** —— 光标上下移动时摘要的位置和宽度都不能跳。
     */
    rowActive: {
      backgroundColor: tokens['color.primary-subtle'],
      borderRadius: tokens['radius.md'],
    },
    /** 摘要 + 徽标，吃掉剩余宽度。 */
    main: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: tokens['space.2'],
    },
    excerpt: {
      flexShrink: 1,
    },
    badge: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['size.badge-height'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    badgeText: {
      color: tokens['color.primary'],
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      minWidth: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: 'transparent',
    },
    actionText: {
      color: tokens['color.foreground'],
    },
  });
}

export function NotesBoard({
  notes,
  excerptLength = NOTE_EXCERPT_LENGTH,
  onAdd,
  onRemove,
  onTogglePinned,
  onEdit,
  activeNoteId,
  labels,
  testID,
}: NotesBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const rows = useMemo(() => toNoteRows(notes, excerptLength), [notes, excerptLength]);
  const [draft, setDraft] = useState('');

  /**
   * 提交。**只挡"看起来是空的"**（见文件头）：
   * `trim()` 后为空则不调用 `onAdd`，也不清空输入框 ——
   * 清空会让用户以为自己写的空格被当成了一张便签。
   */
  function submit(): void {
    if (isNoteDraftBlank(draft)) return;
    onAdd(draft);
    setDraft('');
  }

  return (
    <View style={styles.board} testID={testID}>
      <View style={styles.composer} testID="notes-composer">
        <TextInput
          style={[text['row-meta'], styles.input]}
          value={draft}
          placeholder={labels.composerPlaceholder}
          placeholderTextColor={tokens['color.foreground-subtle']}
          accessibilityLabel={labels.composerPlaceholder}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          returnKeyType="done"
          testID="notes-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.add}
          // 空内容时置灰不可点：与 `submit()` 的挡板同一个判据，只是提前到视觉上。
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
          aria-disabled={isNoteDraftBlank(draft)}
          disabled={isNoteDraftBlank(draft)}
          onPress={submit}
          style={[styles.addButton, isNoteDraftBlank(draft) ? styles.addDisabled : null]}
          testID="notes-submit"
        >
          <HeytaIcon data={Plus} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
          <Text style={[text.caption, styles.addText]}>{labels.add}</Text>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <View style={styles.empty} testID="notes-empty">
          <Text style={[text['row-title'], { color: tokens['color.foreground-muted'] }]}>
            {labels.empty}
          </Text>
          <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
            {labels.emptyHint}
          </Text>
        </View>
      ) : (
        <View style={styles.list} accessibilityRole="list" testID="notes-list">
          {rows.map((row) => {
            const active = row.id === activeNoteId;
            /** 摘要那一段：宿主接了编辑就是可点入口，否则是纯文本（见文件头）。 */
            const excerptText = (
              <Text
                style={[text['row-meta'], styles.excerpt, { color: tokens['color.foreground'] }]}
                numberOfLines={2}
              >
                {row.excerpt}
              </Text>
            );

            return (
              <View
                key={row.id}
                style={active ? [styles.row, styles.rowActive] : styles.row}
                aria-current={active ? 'true' : undefined}
                testID={`note-row-${row.id}`}
              >
                <View style={styles.main}>
                  {onEdit === undefined ? (
                    excerptText
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={labels.a11yEdit(row.excerpt)}
                      onPress={() => {
                        onEdit(row.id);
                      }}
                      style={styles.excerpt}
                      testID={`note-edit-${row.id}`}
                    >
                      {excerptText}
                    </Pressable>
                  )}
                  {/*
                    「今天」徽标只在钉选时出现。判据是模型给的 `isPinned`
                    （它来自 `isNoteHighlighted`），组件不读 `note.isPinnedToToday`。
                  */}
                  {row.isPinned ? (
                    <View style={styles.badge} testID={`note-today-${row.id}`}>
                      <Text style={[text.badge, styles.badgeText]}>{labels.badgeToday}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  {/*
                    钉选切换。图标随状态变（`Pin` / `PinOff`），**不只靠颜色**；
                    无障碍名与可见文字各自都换成对应的那一句（"钉选" / "取消钉选"）。
                  */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      row.isPinned ? labels.a11yUnpin(row.excerpt) : labels.a11yPin(row.excerpt)
                    }
                    onPress={() => {
                      onTogglePinned(row.id, !row.isPinned);
                    }}
                    style={styles.actionButton}
                    testID={`note-pin-${row.id}`}
                  >
                    <HeytaIcon
                      data={row.isPinned ? PinOff : Pin}
                      size={tokens['icon.xs']}
                      color={row.isPinned ? tokens['color.primary'] : tokens['color.foreground']}
                    />
                    <Text style={[text.caption, styles.actionText]}>
                      {row.isPinned ? labels.unpin : labels.pin}
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.a11yRemove(row.excerpt)}
                    onPress={() => {
                      onRemove(row.id);
                    }}
                    style={styles.actionButton}
                    testID={`note-remove-${row.id}`}
                  >
                    <HeytaIcon data={Trash2} size={tokens['icon.xs']} color={tokens['color.danger']} />
                    <Text style={[text.caption, styles.actionText]}>{labels.remove}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
