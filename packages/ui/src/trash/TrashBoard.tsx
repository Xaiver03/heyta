/**
 * `TrashBoard` —— 回收站的**列表**，四端同一份
 * ==============================================
 *
 * ## 🔴 它消灭的是什么
 *
 * 2026-09-29 实测：**web 与 mobile 各写了一份回收站行** ——
 * 两边都是"标题 + 删除时间 + 还原/彻底删除两个动作"，连注释都一样
 *（"用户自己的字：原样显示、不翻译"）。这正是 `dida-view-unification.md` §4.2
 * 要消灭的形状：**同一个实体的行写成多份 JSX**，而它们之间的漂移不会报错，
 * 只会让"网页上能还原、手机上找不到那个按钮"变成常态。
 *
 * ## 🔴 为什么回收站**不复用** `TaskList`（这是刻意的，不是漏了）
 *
 * `task-list/density.ts` 的契约表写着：密度只能改**空间与次要插槽**，
 * **"行骨架（勾选框 + 标题）一定在"**。而回收站里的行：
 *
 *   · 勾选框**没有意义** —— 一条已删除的任务谈不上"完成"；
 *   · 主操作是**还原**，不是"打开详情"。
 *
 * ⇒ 给它加一个 `showCheckbox` 开关会**违反那条契约**（"骨架一定在"是它明确写的），
 * 而契约放宽之后就没有东西挡得住"下一个容器也顺手去掉一部分骨架"。
 * 所以这里是一块**独立的板**，但它**复用**共享层的文字样式
 *（`row-title` / `row-meta`）与 token —— 视觉上与 `TaskRow` 一致，
 * 差别只在**动作**，而那正是应该不同的地方。
 *
 * ## 确认弹窗**不在**这里
 *
 * 「彻底删除」是不可逆动作，两端都要二次确认 —— 但**呈现方式是真的平台差异**
 *（Web 是自绘 `<div role="dialog">` + 焦点陷阱，移动端是原生 modal）。
 * 所以本板只把 `onPurge` 交出去，**弹确认是宿主的事**。
 * 强行共享一个"通用 Modal"会带来一套跨四端的焦点/滚动/返回键处理，
 * 而那正是各平台原生已经做对的事。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Task } from '@heyta/domain';
import { RotateCcw, Trash2 } from 'lucide';

import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';

/** 本板的全部文案 —— **宿主注入**（本层不引 i18n，理由见 `calendar/model.ts`）。 */
export interface TrashBoardLabels {
  /** 顶部那句"回收站是什么、删了会怎样"。 */
  readonly intro: string;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  /**
   * 一行的时间行。**收整条任务**而不是时间戳：
   * `deletedAt ?? updatedAt` 那条回退规则两端都必须一致，而它属于宿主的展示层
   *（日期格式化是语言相关的）。
   */
  readonly deletedAt: (task: Task) => string;
  readonly restore: (task: Task) => string;
  readonly purge: (task: Task) => string;
}

export interface TrashBoardProps {
  /** 已删除的任务。**顺序由宿主给**（规范序来自动作层）。 */
  readonly items: readonly Task[];
  readonly labels: TrashBoardLabels;
  readonly onRestore: (taskId: string) => void;
  /** 宿主在这里**弹二次确认**，不要直接删（见文件头）。 */
  readonly onPurge: (taskId: string) => void;
  /** 正在处理中的任务 id —— 置灰该行，避免连点。 */
  readonly busyTaskId?: string | null | undefined;
  readonly testID?: string | undefined;
}

export function TrashBoard({
  items,
  labels,
  onRestore,
  onPurge,
  busyTaskId,
  testID = 'trash-board',
}: TrashBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  return (
    <View style={styles.root} testID={testID}>
      <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
        {labels.intro}
      </Text>

      {items.length === 0 ? (
        // 空态走**共享那一个实现**（`check:empty-state` 的判据 3）。
        <EmptyState
          icon={Trash2}
          title={labels.emptyTitle}
          hint={labels.emptyHint}
          testID={`${testID}-empty`}
        />
      ) : (
        <View style={styles.list} testID={`${testID}-list`}>
          {items.map((task, index) => (
            <View key={task.id} style={styles.item}>
              {index > 0 ? (
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: tokens['color.border'] },
                  ]}
                />
              ) : null}
              {/*
                ⚠️ 用户自己的字：**原样显示、不翻译**。
                长标题折行而不是截断 —— 回收站是用户来核对"删掉的是不是这条"的地方，
                看不全就等于没看见。
              */}
              <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>
                {task.title}
              </Text>
              <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
                {labels.deletedAt(task)}
              </Text>

              <View style={[styles.actions, { gap: tokens['space.3'] }]}>
                <Pressable
                  accessibilityRole="button"
                  // 读屏时必须带标题，否则一屏十几行听到的全是"还原"。
                  accessibilityLabel={labels.restore(task)}
                  disabled={busyTaskId === task.id}
                  onPress={() => {
                    onRestore(task.id);
                  }}
                  style={[
                    styles.action,
                    {
                      gap: tokens['space.1'],
                      minHeight: tokens['touch-target.min'],
                      paddingHorizontal: tokens['space.3'],
                      borderRadius: tokens['radius.sm'],
                      borderWidth: tokens['border-width.thin'],
                      borderColor: tokens['color.border'],
                    },
                  ]}
                  testID={`${testID}-restore-${task.id}`}
                >
                  <HeytaIcon
                    data={RotateCcw}
                    size={tokens['icon.sm']}
                    color={tokens['color.foreground']}
                  />
                  <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>
                    {labels.restore(task)}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.purge(task)}
                  disabled={busyTaskId === task.id}
                  // 🔴 这一下**不删** —— 只是把请求交给宿主去弹二次确认。
                  onPress={() => {
                    onPurge(task.id);
                  }}
                  style={[
                    styles.action,
                    {
                      gap: tokens['space.1'],
                      minHeight: tokens['touch-target.min'],
                      paddingHorizontal: tokens['space.3'],
                      borderRadius: tokens['radius.sm'],
                      borderWidth: tokens['border-width.thin'],
                      borderColor: tokens['color.danger'],
                    },
                  ]}
                  testID={`${testID}-purge-${task.id}`}
                >
                  <HeytaIcon data={Trash2} size={tokens['icon.sm']} color={tokens['color.danger']} />
                  <Text style={[text['row-title'], { color: tokens['color.danger'] }]}>
                    {labels.purge(task)}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: { gap: tokens['space.4'] },
    list: { gap: tokens['space.2'] },
    item: { gap: tokens['space.2'] },
    divider: { height: tokens['border-width.thin'] },
    actions: { flexDirection: 'row', flexWrap: 'wrap' },
    action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  });
}
