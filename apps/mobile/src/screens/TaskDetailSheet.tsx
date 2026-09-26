/**
 * 任务详情面板
 * ==============
 *
 * 🔴 **这个面板补的是"能日常用"里最大的一块缺口。**
 *
 * 在此之前移动端只能做三件事：建一个**只有标题**的任务、勾完成、删除。
 * 也就是说：
 *   - 截止日期设不了 → 所有任务都落在「收集箱」，「今天」永远是空的；
 *   - 优先级设不了 → `TaskActions.setPriority` / `setImportant` 写好了却没入口；
 *   - 标题改不了 → 打错一个字只能删掉重建。
 *
 * 「今天」是这个产品的核心视图（`TasksScreen` 文件头写着"这个产品的核心问题是
 * 今天该干什么"），而**没有截止日期就永远到不了今天** —— 数据层早就齐了
 * （`TaskActions` 有 `rename` / `setDueDate` / `setPriority` / `moveToProject`），
 * 缺的一直是这个界面。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 两个刻意的交互决定
 *
 * 1. **点任务行打开详情，不再切换完成。** 行上的主操作应该是"打开它"；
 *    切换完成有专门的勾选框 —— 那也**更可达**：勾选框有独立的
 *    `accessibilityLabel`，读屏用户能直接说"完成：买牛奶"，
 *    而不是先打开详情再找完成按钮。
 * 2. **每个控件改完立即写**（一处意图 = 一个 op，AGENTS.md §3.4）。
 *    攒起来最后统一提交会让"改了日期然后直接退出"丢掉改动。
 *    标题是**唯一**例外：它必须等内容确定，所以离开输入框 / 收起面板时才提交 ——
 *    每敲一个字写一个 op 会把 op-log 灌满噪音。
 *
 * 🔴 本文件里**没有一行业务逻辑**：写哪些字段、清除写成 `null` 还是 `undefined`、
 * 删除是软删还是硬删，全部来自 `@heyta/app-host` 的 `createTaskActions`。
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { Priority, describeRecurrence, dueDateToEpoch, toLocalDate, type Task } from '@heyta/domain';
import {
  REPEAT_PRESET_IDS,
  repeatPresetRule,
  type RepeatPresetId,
  type TaskActions,
} from '@heyta/app-host';

import { PRIORITY_LABELS, PRIORITY_ORDER, priorityColorToken } from '../lib/priority';
import { useText, useTheme, useTokens } from '../theme';
import { DatePicker } from '../ui/DatePicker';
import { Button, Chip, IconButton, SectionHeader, Text } from '../ui/kit';

/**
 * 重复预设的**显示文字**。
 *
 * ⚠️ 这里只有文字。"每周到底是哪一天"、"工作日是哪几天"是产品语义，
 * 在 `@heyta/app-host` 的 `repeat-presets.ts` 里（§3.5 的判据）。
 * 把语义放在界面里的后果是 Web 端落地时出现第二份，两份对"工作日"的理解
 * 只要差一天，同一个用户在两台设备上就会看到不同的重复日期，且都不报错。
 */
const REPEAT_LABELS: Record<RepeatPresetId, string> = {
  daily: '每天',
  weekly: '每周',
  weekdays: '工作日',
  monthly: '每月',
};

/** 不重复。它不是一条规则，所以不属于预设清单。 */
const NO_REPEAT_LABEL = '不重复';

export function TaskDetailSheet({
  task,
  visible,
  onClose,
  actions,
  onChanged,
  now,
}: {
  /** 当前打开的任务。`undefined` = 没有选中任何任务。 */
  task: Task | undefined;
  visible: boolean;
  onClose: () => void;
  actions: TaskActions;
  onChanged: () => void;
  now: number;
}): React.JSX.Element | null {
  const t = useTokens();
  const text = useText();
  const { native } = useTheme();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const taskId = task?.id;

  // 🔴 只按**任务 id 与可见性**重同步，依赖里**刻意没有** `task.title`。
  // 带上它的话，正在打字时只要有一次后台同步回来（或冲突解决改了标题），
  // 输入框里的草稿会被直接冲掉 —— 而且用户看到的只是"字自己变了"。
  // 代价是：面板开着时别处改了标题，这里不会实时跟着变。这个取舍是刻意的，
  // 因为"保住用户正在打的字"比"显示别处的最新值"重要。
  useEffect(() => {
    setTitle(task?.title ?? '');
  }, [taskId, visible]);

  const run = useCallback(
    (p: Promise<unknown>) => {
      setBusy(true);
      void p
        .then(onChanged)
        .finally(() => {
          setBusy(false);
        });
    },
    [onChanged],
  );

  /**
   * 提交标题。**空标题不提交** —— `rename` 会抛错，而用户把标题清空
   * 通常只是打字过程中的一步，不是"我要一个没有标题的任务"。
   */
  const commitTitle = useCallback((): void => {
    if (task === undefined) return;
    const next = title.trim();
    if (next === '' || next === task.title) return;
    run(actions.rename(task.id, next));
  }, [task, title, run, actions]);

  const close = useCallback((): void => {
    commitTitle();
    onClose();
  }, [commitTitle, onClose]);

  if (task === undefined) return null;

  const dueLocal = task.dueDate === undefined ? undefined : toLocalDate(task.dueDate);
  const todayLocal = toLocalDate(now);
  const done = task.completedAt !== undefined;

  /**
   * 重复规则的锚点。
   *
   * 🔴 **必须与 `TaskActions.setRepeat` 将要钉的锚点一模一样**
   * （`dueDate ? toLocalDate(dueDate) : today()`）。差一天的话，
   * 面板上"每周"高亮着的那一项，对应的却是锚点那一周的另一天 ——
   * 用户点「每周」得到的是"每周二"，而界面上没有任何地方会显示这件事。
   */
  const repeatAnchor = dueLocal ?? todayLocal;
  const repeat = actions.repeatOf(task.id);
  /** 当前规则恰好等于哪个预设（都不是则为 `undefined`，走"自定义"那条展示）。 */
  const activePreset = repeat === undefined
    ? undefined
    : REPEAT_PRESET_IDS.find((id) => repeatPresetRule(id, repeatAnchor) === repeat.rule);
  /** 规则存在、但不属于任何预设（例如另一台设备上设的"每两周"）。 */
  const customRule = repeat !== undefined && activePreset === undefined ? repeat.rule : undefined;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      {/* 遮罩。**刻意不进无障碍树。**
          理由有两条，第二条是实测踩出来的：

          1. 它的作用只是"点空白处关掉"，而读屏用户已经有右上角那个
             **有名字的**关闭按钮。两个控件共用一个可访问名，读屏会把同一个
             名字念两遍，而它们做的是同一件事。
          2. 它的 bounds 覆盖整屏，于是"中心点"落在下半部分 ——
             而面板从底部升起、最高占 90%，中心点就压在**面板上**。
             按坐标点"关闭任务详情"会打到面板，面板关不掉
             （验收脚本实测：连点 5 步都没关掉，后面每一步都在面板还开着的
             状态下找列表行）。 */}
      <Pressable
        style={{ flex: 1, backgroundColor: t['material.scrim'] }}
        onPress={close}
        accessible={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            backgroundColor: t['color.surface'],
            borderTopLeftRadius: t['radius.xl'],
            borderTopRightRadius: t['radius.xl'],
            // ⚠️ 只给纵向内边距，不给固定 height ——
            // 同一节点上同时给 height 与 padding 会让内容在被压缩的盒子里居中。
            paddingTop: t['space.4'],
            paddingBottom: t['space.8'],
            gap: t['space.3'],
            maxHeight: '90%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: t['screen.gutter'],
            }}
          >
            <Text variant="section-title">任务详情</Text>
            <IconButton
              icon="action.close"
              label="关闭任务详情"
              color={t['color.foreground-muted']}
              onPress={close}
            />
          </View>

          <ScrollView
            style={{ paddingHorizontal: t['screen.gutter'] }}
            contentContainerStyle={{ gap: t['space.4'], paddingBottom: t['space.2'] }}
            // 键盘弹起时，点快捷项/日期格应当直接生效而不是先收键盘
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: t['space.1'] }}>
              <Text variant="row-meta" tone="muted">
                标题
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                onBlur={commitTitle}
                onSubmitEditing={commitTitle}
                returnKeyType="done"
                accessibilityLabel="任务标题"
                placeholder="要做什么？"
                placeholderTextColor={t['color.foreground-subtle']}
                style={[
                  text['row-title'],
                  {
                    minHeight: t['touch-target.min'],
                    paddingHorizontal: t['space.3'],
                    borderRadius: t['radius.md'],
                    borderWidth: t['border-width.thin'],
                    borderColor: t['color.border'],
                    backgroundColor: t['color.surface-sunken'],
                    color: t['color.foreground'],
                    // ⚠️ 走归一化访问器。直接传 `t['font.sans']` 会把整条
                    // CSS 字体栈交给 RN，字体解析失败且**不报错**（已实测）。
                    fontFamily: native.fontSans,
                  },
                ]}
              />
            </View>

            <View style={{ gap: t['space.2'] }}>
              <SectionHeader icon="task.due" title="截止日期" />
              <DatePicker
                value={dueLocal}
                today={todayLocal}
                onChange={(date) => {
                  // 🔴 清除传 `undefined`，由 app-host 写成 `null`
                  // （见 `TaskActions.setDueDate` 的注释）。
                  run(actions.setDueDate(task.id, date === undefined ? undefined : dueDateToEpoch(date)));
                }}
              />
            </View>

            <View style={{ gap: t['space.2'] }}>
              <SectionHeader icon="task.repeat" title="重复" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t['space.2'] }}>
                <Chip
                  label={NO_REPEAT_LABEL}
                  selected={repeat === undefined}
                  onPress={() => {
                    run(actions.setRepeat(task.id, undefined));
                  }}
                />
                {REPEAT_PRESET_IDS.map((id) => (
                  <Chip
                    key={id}
                    label={REPEAT_LABELS[id]}
                    selected={activePreset === id}
                    onPress={() => {
                      const rule = repeatPresetRule(id, repeatAnchor);
                      // 锚点非法时 `repeatPresetRule` 返回 undefined。
                      // 这里**什么都不做**而不是发一条垃圾规则：一条
                      // `BYDAY=undefined` 能通过 `isValidRecurrenceRule`
                      // （FREQ 还在），但一次都不命中 —— 静默的空规则最难查。
                      if (rule === undefined) return;
                      run(actions.setRepeat(task.id, rule));
                    }}
                  />
                ))}
                {/* 不属于任何预设的规则（例如另一台设备设的"每两周"）。
                    **必须显示出来**，否则面板看上去像"这条任务不重复"，
                    而用户一点「每天」就把那条规则悄悄换掉了。 */}
                {customRule !== undefined && (
                  <Chip
                    label={describeRecurrence(customRule)}
                    selected
                    icon="task.repeat"
                    onPress={() => {
                      run(actions.setRepeat(task.id, undefined));
                    }}
                  />
                )}
              </View>
              {repeat !== undefined && (
                <Text variant="row-meta" tone="muted">
                  {`当前：${describeRecurrence(repeat.rule)}`}
                </Text>
              )}
            </View>

            <View style={{ gap: t['space.2'] }}>
              <SectionHeader icon="task.priority" title="优先级" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t['space.2'] }}>
                {PRIORITY_ORDER.map((p) => (
                  <Chip
                    key={String(p)}
                    label={PRIORITY_LABELS[p]}
                    selected={(task.priority ?? Priority.None) === p}
                    color={t[priorityColorToken(p)]}
                    onPress={() => {
                      run(actions.setPriority(task.id, p));
                    }}
                  />
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: t['space.2'] }}>
              <Button
                label={done ? '标记为未完成' : '标记为完成'}
                tone="secondary"
                icon={done ? 'task.reopen' : 'task.done'}
                loading={busy}
                onPress={() => {
                  run(actions.setCompleted(task.id, !done));
                }}
                style={{ flex: 1 }}
              />
              <Button
                label="删除"
                tone="danger"
                icon="task.delete"
                loading={busy}
                onPress={() => {
                  // 删除后立刻收起面板：留在一个"不存在的任务"详情上是死路
                  run(actions.remove(task.id));
                  onClose();
                }}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
