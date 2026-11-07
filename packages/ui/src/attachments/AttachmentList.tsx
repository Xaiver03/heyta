/**
 * 附件列表（共享视图）
 * ======================
 *
 * 这一格是**"一条任务下面挂着哪几个文件、每个多大、能加能删"在界面上的唯一一份**。
 * web 详情面与 mobile 任务详情页各自决定**把它放在页面的哪里**、注入文案、
 * 把三个回调接到各自的动作层 —— 剩下的全在这里。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 附件的**领域规则**早就在一处（`@heyta/domain` 的 `attachments.ts`：
 * 过滤、顺序、档位、拒绝原因），**写路径**也在一处
 * （`app-host` 的 `createAttachmentActions`：先传字节再发 op、缺端口就说清是哪件事没有）。
 * 缺的正好是中间那一层：**同一份数据在两个端上被画成两个样子**。
 *
 * 移动端先落地（`apps/mobile/src/screens/TaskDetailSheet.tsx`，约 :1444-1494），
 * web 侧是零 —— 所以这次是**把已有实现抬到共享层**，不是新造一个。
 * 抬上来的判据是"这段代码里有没有任何一行在决定业务上该怎么做"（AGENTS §3.5）：
 * 没有。它只照着 `items` 摆、照着 `labels` 说话、照着手上的回调转发。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 空态整块由宿主注入（`labels.empty`），本文件不 import `@heyta/i18n`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 与 `EmptyState` / `ReminderList` / `TaskList` 同一个理由：i18n 包自己带过一份
 * React，四个端会同时中招（`check:mobile-bundle` 盯着）。
 *
 * ⚠️ 槽位是 `React.ReactNode` 而**不是一个 `emptyTitle: string`**，这不是随手的选择：
 * web 那一格必须渲染**共享的 `<EmptyState>`**（`check:empty-state` 的唯一修法：
 * "新的空态不许在视图里手写"），而那段 JSX 必须写在宿主的文件里 —— 它的
 * `title` 是 `t('…')` 的调用点，`check-empty-state.mjs` 的断言 B 只认
 * **落在 `<EmptyState …>` 元素之内**的空态词条（元素之外 ⇒ 记成一处新的手写空态）。
 * 把一个字符串塞进来、让本文件去画空态，就会把那条判据的合规写法挤成违规。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 删除的**确认**不在这里：本文件只发 `onRemove(id)`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "要不要先问一句、问多重"是宿主那一侧的裁决（`@heyta/domain` 的
 * `resolveDangerTier` + `docs/agents/overlay-feedback.md` 的危险四档），
 * 而两端的确认形态本来就不同：web 走模态确认件
 * （`apps/web/src/lib/dialog/DangerConfirmDialog.tsx`），移动端走按钮两态
 * （文件头记着"撤销做不到，只能把摩擦挪到动作前面"）。
 * ⚠️ 两端**结果必须一致**（都问过），**手段允许不同** —— 这与
 * `check:dirty-form-policy` 那条"两端的结果一致、手段不同"是同一条口径。
 * 所以本文件刻意**不**持有任何 `confirmingId` 状态：那一格放进来就等于替两端
 * 决定"用什么方式问"，而它不是展示。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签；零裸值
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现，
 * `<button>` 在 iOS 上不存在。尺度全部走 token（`check:design` 与
 * `check:text-color` 会拦"没有颜色的 `<Text>`"）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { Plus } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { attachmentSizeLabelOf, type AttachmentItem, type AttachmentSizeLabels } from './model.js';

/**
 * 这一格的全部文案，**每一项都由宿主注入**（见文件头）。
 *
 * 没有 `title` / `count`：区块头（「附件 · 3」）是**宿主的解剖**，不是这一格的 ——
 * web 详情面的每一格都用 `blockLabelStyle` 的 `h3` 说字段名（备注 / 截止 /
 * 子任务 / 优先级……），附件跟着它才不在一栏里长出第二种字段标签；
 * 移动端那一格用的是 `caption` 的小字头。两处形状不同、语义同一，
 * 把它收进来反而要造一个"标题长什么样"的开关。
 */
export interface AttachmentListLabels {
  /**
   * 一个附件都没有时画什么 —— **整块**，由宿主给（见文件头 🔴）。
   *
   * web 传共享的 `<EmptyState size="line" …/>`；移动端传它自己那一句。
   */
  readonly empty: React.ReactNode;
  /** 「添加附件」那枚入口（上传中换成 {@link uploading}）。 */
  readonly add: string;
  /** 上传在途时那枚入口念的字（"正在上传…"）。 */
  readonly uploading: string;
  /** 一行的移除动作。 */
  readonly remove: string;
  /** 体积模板（档位判断在领域层，见 `./model.ts`）。 */
  readonly size: AttachmentSizeLabels;
}

export interface AttachmentListProps {
  /**
   * 这一条任务下的附件。**顺序与过滤由动作层给**
   * （`attachmentsForTask` → 领域层的 `aliveAttachmentsForTask`：软删的不进、
   * `createdAt` 升序、同刻按 id）—— 本文件不排、不筛。
   */
  readonly items: readonly AttachmentItem[];
  readonly labels: AttachmentListLabels;
  /**
   * 有动作在途（上传 / 删除）。两个入口一起禁用 —— 与移动端同一条：
   * 上传中再点一次「移除」会在同一个账号上并发两次字节回收。
   */
  readonly busy?: boolean;
  /** 打开选文件的入口。**本文件不碰文件系统**（那是端差异）。 */
  readonly onAdd: () => void;
  /** 移除某一个。确认已由宿主问过（见文件头）。 */
  readonly onRemove: (id: string) => void;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: {
      gap: tokens['space.2'],
    },
    /** 空态槽：整块由宿主给，这里只保证它不贴住下面那枚按钮。 */
    empty: {
      gap: tokens['space.1'],
    },
    /** 一列行。`list` role 给读屏，视觉上只是一列（与 `ReminderList` 同形）。 */
    list: {
      gap: tokens['space.1'],
    },
    /**
     * 一行 = **左（名字 + 体积）右（移除）**。
     *
     * 🔴 `alignItems: 'flex-start'` 而不是 `'center'`：文件名可以很长，
     * 换行之后若按中心对齐，右侧那枚「移除」会漂到两行之间的中线上 ——
     * 而它属于**第一行**（用户读到名字的同时就要能点到它）。
     */
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    /** 名字 + 体积那一列：吃掉剩余宽度，长文件名自己换行。 */
    main: {
      flexShrink: 1,
      flexGrow: 1,
      gap: tokens['space.1'],
    },
    /**
     * 文件名。长名字靠 `main` 的 `flexShrink` 一行行换下去；
     * 刻意不写 `overflowWrap`/`wordBreak` —— 那两个在 RN 的 `TextStyle` 里
     * 不存在，web 上能看到效果、原生上无效，写成它会造出"两端不一样"的第三种风险。
     */
    name: {
      color: tokens['color.foreground'],
    },
    /** 体积：辅助档（比文件名低一档，`AGENTS §5` 的辅助/说明那一行）。 */
    meta: {
      color: tokens['color.foreground-subtle'],
      fontVariant: ['tabular-nums'],
    },
    /** 移除：行内动作（透明底 + 危险色字，`CONTROL_PALETTE` 的 `danger`/`inline` 那一档）。 */
    removeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      minWidth: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      backgroundColor: 'transparent',
    },
    removeText: {
      color: tokens['color.danger'],
    },
    /** 「添加附件」那一行：靠左，不与列表同宽（它不是列表的一部分）。 */
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
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
    addText: {
      color: tokens['color.on-primary'],
    },
  });
}

export function AttachmentList({
  items,
  labels,
  busy = false,
  onAdd,
  onRemove,
  testID,
}: AttachmentListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  return (
    <View style={styles.board} testID={testID}>
      {items.length === 0 ? (
        <View style={styles.empty}>{labels.empty}</View>
      ) : (
        <View
          style={styles.list}
          accessibilityRole="list"
          // ⚠️ 列表容器**不给** `accessibilityLabel`：能给的候选只有「添加附件」
          // 那枚按钮的字，而把入口的字当成列表名会让读屏把整块念成一个控件。
          // 每一行自己的文件名就是那一行的名字。
        >
          {items.map((item) => {
            const sizeLabel = attachmentSizeLabelOf(item, labels.size);
            return (
              <View key={item.id} style={styles.row} testID={`attachment-row-${item.id}`}>
                <View style={styles.main}>
                  <Text style={[text['row-title'], styles.name]}>{item.fileName}</Text>
                  {/* 缺体积的老数据整行不画 —— 不是画一个 `0 字节`（见 `./model.ts`）。 */}
                  {sizeLabel === undefined ? null : (
                    <Text style={[text['row-meta'], styles.meta]}>{sizeLabel}</Text>
                  )}
                </View>
                <Pressable
                  /*
                   * 🔴 无障碍名与可见文字同句（「移除」）—— 与移动端现状一致，
                   * 这是一处**已知缺口**而不是设计：一列按钮读屏念出来会是
                   * 分不清哪一个的「移除」×N。补它需要一条带文件名的词条
                   * （`移除 {name}`），而 `packages/i18n` 不在这一单的范围。
                   * 刻意**不**在这里拼 `labels.remove + ' ' + fileName`：语序是
                   * 各语言的事，共享层拼串就是替宿主写死一种语序。
                   */
                  accessibilityLabel={labels.remove}
                  disabled={busy}
                  onPress={() => {
                    onRemove(item.id);
                  }}
                  style={styles.removeButton}
                  testID={`attachment-remove-${item.id}`}
                >
                  <Text style={[text.caption, styles.removeText]}>{labels.remove}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.addRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.add}
          disabled={busy}
          onPress={onAdd}
          style={styles.addButton}
          testID="attachment-add"
        >
          <HeytaIcon data={Plus} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
          {/* 上传中念「正在上传…」：与移动端同一个两态文案（`labels.uploading`）。 */}
          <Text style={[text.caption, styles.addText]}>{busy ? labels.uploading : labels.add}</Text>
        </Pressable>
      </View>
    </View>
  );
}
