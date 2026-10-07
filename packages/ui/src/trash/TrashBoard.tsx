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
 *   · 勾选框**没有意义** —— 一条已删除的条目谈不上"完成"；
 *   · 主操作是**还原**，不是"打开详情"。
 *
 * ⇒ 给它加一个 `showCheckbox` 开关会**违反那条契约**（"骨架一定在"是它明确写的），
 * 而契约放宽之后就没有东西挡得住"下一个容器也顺手去掉一部分骨架"。
 * 所以这里是一块**独立的板**，但它**复用**共享层的文字样式
 *（`row-title` / `row-meta`）与 token —— 视觉上与 `TaskRow` 一致，
 * 差别只在**动作**，而那正是应该不同的地方。
 *
 * ## W1：`items` 泛化了，`showCheckbox` 仍然没有
 *
 * 回收站从"只装任务"变成"装任务与便签"（W1，下一步是清单与习惯 W4）之后，
 * 有两条路可走：① 给本板加一个"这一类不显示某个插槽"的开关；② 把行的
 * **数据形状**收成一个与实体无关的 `TrashItem`。
 *
 * 走的是 ②，而且**没有**顺手加 ①：① 解决的其实是"两端长得不一样"，
 * 但真正需要统一的只有"这一行是什么、按什么序"两件事 —— 那两件事已经收进
 * `trash/model.ts`。剩下的（徽标文案、时间格式、确认框）本来就归宿主。
 * 改 `items` 类型是 breaking，所以两端**一次改完、不留兼容分支**：
 * 留一条 `Task` 的联合分支，就等于留一条可以绕过那份合并规则的路。
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
import { RotateCcw, Trash2 } from 'lucide';

import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { TrashItem } from '@heyta/domain';

/** 本板的全部文案 —— **宿主注入**（本层不引 i18n，理由见 `calendar/model.ts`）。 */
export interface TrashBoardLabels {
  /**
   * 顶部那句"回收站是什么、删了会怎样"。
   *
   * ⚠️ W1 之后回收站**不止装任务**，这句话不能再点名"任务"
   *（`web.trash.intro` / `mobile.trash.intro` 原来写的就是"已删除的任务"）。
   */
  readonly intro: string;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  /**
   * 一行的种类徽标（任务 / 便签 / …）。
   *
   * 🔴 唯一合规的实现路径是宿主调共享的 `entityLabelOf(kind, t)`
   *（`packages/ui/src/sync/model.ts`，键就是 `common.entity.*`）——
   * 在回收站里另起一套徽标词，同一行就会同时出现两种叫法（P-6 那条否决的理由）。
   */
  readonly kindLabel: (kind: TrashItem['kind']) => string;
  /**
   * 一行的时间行。**收整行**而不是时间戳：回退规则（`deletedAt ?? updatedAt`）
   * 已经收进 `trash/model.ts`，这里要的永远是**已经算完的那一个数**。
   */
  readonly deletedAt: (item: TrashItem) => string;
  readonly restore: (item: TrashItem) => string;
  readonly purge: (item: TrashItem) => string;
}

export interface TrashBoardProps {
  /**
   * 回收站里的全部条目，**顺序即展示顺序**。
   *
   * 🔴 W1 把它从 `readonly Task[]` 泛化成了 `readonly TrashItem[]`（breaking，
   * 两端一次改完、不留兼容分支）：形状是 `{ id, kind, title, deletedAt }`，
   * 由 `toTrashItems()` 产出。刻意**不给 `Task` 留联合分支** ——
   * 留了就有第二条路可以绕过那一份合并规则。
   */
  readonly items: readonly TrashItem[];
  readonly labels: TrashBoardLabels;
  readonly onRestore: (id: string) => void;
  /** 宿主在这里**弹二次确认**，不要直接删（见文件头）。 */
  readonly onPurge: (id: string) => void;
  /** 正在处理中的条目 id —— 置灰该行，避免连点。 */
  readonly busyId?: string | null | undefined;
  readonly testID?: string | undefined;
}

export function TrashBoard({
  items,
  labels,
  onRestore,
  onPurge,
  busyId,
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
          {items.map((item, index) => (
            <View key={item.id} style={styles.item}>
              {index > 0 ? (
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: tokens['color.border'] },
                  ]}
                />
              ) : null}
              <View style={styles.headline} testID={`${testID}-row-${item.id}`}>
                {/*
                  种类徽标：回收站现在装两种东西，而它们的**恢复后果不一样**
                  （便签回来还在原来的归属、任务回来会重新出现在今天/清单里）。
                  没有这一格，用户只能靠"标题像不像便签"来猜。
                */}
                <View style={styles.kindBadge} testID={`${testID}-kind-${item.id}`}>
                  <Text style={[text.badge, styles.kindBadgeText]}>
                    {labels.kindLabel(item.kind)}
                  </Text>
                </View>
                {/*
                  ⚠️ 用户自己的字：**原样显示、不翻译**。
                  长标题折行而不是截断 —— 回收站是用户来核对"删掉的是不是这条"的地方，
                  看不全就等于没看见。
                */}
                <Text style={[text['row-title'], styles.title, { color: tokens['color.foreground'] }]}>
                  {item.title}
                </Text>
              </View>
              <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
                {labels.deletedAt(item)}
              </Text>

              <View style={[styles.actions, { gap: tokens['space.3'] }]}>
                <Pressable
                  accessibilityRole="button"
                  // 读屏时必须带标题，否则一屏十几行听到的全是"还原"。
                  accessibilityLabel={labels.restore(item)}
                  disabled={busyId === item.id}
                  onPress={() => {
                    onRestore(item.id);
                  }}
                  style={[
                    styles.action,
                    {
                      gap: tokens['space.1'],
                      minHeight: tokens['touch-target.min'],
                      paddingHorizontal: tokens['space.3'],
                      borderRadius: tokens['radius.sm'],
                    },
                  ]}
                  testID={`${testID}-restore-${item.id}`}
                >
                  <HeytaIcon
                    data={RotateCcw}
                    size={tokens['icon.sm']}
                    color={tokens['color.foreground']}
                  />
                  <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>
                    {labels.restore(item)}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.purge(item)}
                  disabled={busyId === item.id}
                  // 🔴 这一下**不删** —— 只是把请求交给宿主去弹二次确认。
                  onPress={() => {
                    onPurge(item.id);
                  }}
                  style={[
                    styles.action,
                    {
                      gap: tokens['space.1'],
                      minHeight: tokens['touch-target.min'],
                      paddingHorizontal: tokens['space.3'],
                      borderRadius: tokens['radius.sm'],
                      backgroundColor: tokens['color.danger-subtle'],
                    },
                  ]}
                  testID={`${testID}-purge-${item.id}`}
                >
                  <HeytaIcon data={Trash2} size={tokens['icon.sm']} color={tokens['color.danger']} />
                  <Text style={[text['row-title'], { color: tokens['color.danger'] }]}>
                    {labels.purge(item)}
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
    headline: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
    title: { flexShrink: 1 },
    kindBadge: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['size.badge-height'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    kindBadgeText: {
      color: tokens['color.primary'],
    },
    divider: { height: tokens['border-width.thin'] },
    actions: { flexDirection: 'row', flexWrap: 'wrap' },
    action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  });
}
