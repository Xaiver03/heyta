/**
 * 快速捕捉（共享视图）
 * ======================
 *
 * M3 第八刀的主角：**"输入一句话 → 看见我读懂了什么 → 逐条确认/取消 → 提交"
 * 这件事只有这一个实现。** web 与 mobile 只决定把它放在页面的哪里、
 * 注入文案，以及挂哪些各端特有的东西（今天只有 web 的 AI 面板走插槽）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前 web 有 `features/capture/CaptureComposer.tsx`（293 行 DOM/CSS 实现），
 * 而 **mobile 一行都没有** —— 快速捕捉是移动端完全缺失的签名功能（计划 §P8）。
 * 它是"把一句话变成任务"的唯一入口，也是**唯一会读懂用户输入**的界面：
 * 两端各自实现的结果是"同一句'明天交周报'在两台设备上被读成两个样子，
 * 而差异不会让任何测试变红"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 解析、判断、换算的分工（每一层都有单一实现）
 *
 *   · 解析（什么算日期 / 优先级 / 谁生效）→ `@heyta/domain#parseCapture`
 *   · 芯片三态 / 忽略清单 / 提交换算     → 本目录 `./model.ts`（node 单测跑穿）
 *   · 措辞（还剩几天 / 优先级叫什么）     → 宿主注入（`labels`）
 *   · 写库（op-log）                      → 宿主 action 层（AGENTS.md §3.5）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 契约：识别结果一律先显示，**绝不替用户删字**
 *
 * `packages/domain/src/capture.ts` 的文件头把这条写成了不变量：
 * 每一个被移除的片段都对应一条 `applied: true` 的记录；同一个字段出现多次时
 * 只有第一条被采纳，**后一条原样留在标题里**。本组件因此有三条硬行为：
 *
 *   1. 有识别就一定渲染出来（`未采用` 的那些也必须出现）；
 *   2. 每一条都能单独取消，取消 = 把那段文字**放回标题**（只动忽略清单，
 *      **绝不动输入框里的字**）；
 *   3. 空标题（只输入"明天"）不许提交。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条写清：证据 + 影响 + 最小一步）
 *
 * 1. **AI 一句话捕获面板**（`apps/web/src/features/ai/AiCapture.tsx`，约 380 行）
 *    留在 web：它是 DOM + `@heyta/ai` 的实现，而 `apps/mobile` 里 AI 是 0 行
 *    （P8 的移动端阻塞在宿主 SecretStore，不在 UI 层）。本组件给的是
 *    `renderAssistant` **插槽**。
 *    · 影响：mobile 只有确定性捕获（规则解析），没有模型兜底。
 *    · 最小一步：M3 `ai` 的"流程型面板族"落地后接进这个插槽
 *      （披露块已经有共享 `AiDisclosure`）。
 *
 * 2. **提交到 op-log 的那一步**（`addTask`）留在宿主。判据是 AGENTS.md §3.5：
 *    本组件产出的是 `CaptureSubmitPlan`（纯数据），"写哪些字段、发什么 op"
 *    由宿主 action 层决定。
 *
 * 3. **输入框的悬停态**：web 迁移前 `.ht-input` 有 `:hover` 换边框色，
 *    RN `TextInput` 没有 hover（移动端本来也没有鼠标）。
 *    · 影响：桌面 web 的输入框悬停反馈消失 —— 这是"RN 原语换 DOM"的必然落差，
 *      与计划 §「已知会卡住的地方」最后一行同一类，**不是实现细节**。
 *    · 最小一步：加 `onHoverIn`/`onHoverOut` 状态 + 边框色，需要产品先定"要不要给鼠标做降级"。
 *
 * 4. **输入框的字号（iOS Safari 聚焦缩放）**：迁移前 web `<input>` 的字号来自
 *    `.ht-input`（`--ht-font-size-sm`）；现在由 RN `TextInput` + `text['row-meta']`
 *    给。两者当前同值，但"≥16px 才不缩放"这条约束**没有任何门禁在盯**
 *    （web 的 `--ht-font-size-sm` 目前小于 16px —— 与迁移前逐字相同，
 *    所以不是本刀引入的）。
 *    · 最小一步：把这条约束写进 `check:design` 或验收脚本，而不是靠注释。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `HabitBoard` / `QuadrantBoard` / `TaskList` 同一个理由：i18n 包自己带过
 * 一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。依赖行内容的
 * 文案（`restoreAria` / `ignoreAria` / `valueLabel`）因此是函数。
 *
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `TextInput` / `Pressable` 在 `react-native-web` 上都有
 * 等价实现；`<input>` 在 iOS 上不存在。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { CaptureExclusion, LocalDate } from '@heyta/domain';
import { Plus, RotateCcw, X } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  captureCanSubmit,
  parseCaptureDraft,
  shouldResetCaptureIgnore,
  toAiCaptureSubmitPlan,
  toCaptureChips,
  toCaptureSubmitPlan,
  toggleCaptureIgnore,
  type CaptureAiFields,
  type CaptureChip,
  type CaptureSubmitPlan,
} from './model.js';

/**
 * 面板全部文案，**每一项都由宿主注入**（见文件头）。
 *
 * ⚠️ 没有"未采用"以外的空态文案：捕获框没有内容时不渲染任何东西 ——
 * 空输入框上挂一句"还没有识别结果"是在制造视觉噪音。
 */
export interface CaptureComposerLabels {
  readonly placeholder: string;
  /** 输入框的无障碍名（`<input aria-label>`）。 */
  readonly addLabel: string;
  /** 提交按钮上的字。 */
  readonly add: string;
  /** 识别结果那一组的无障碍名（`<ul aria-label>`）。 */
  readonly matchesAria: string;
  /** 被用户显式忽略的那条显示什么。 */
  readonly rejected: string;
  /** 未被采纳（还在标题里）的那条旁边的说明。 */
  readonly unused: string;
  /** "实际标题："这一句。 */
  readonly previewLead: string;
  /** 标题为空时显示什么（例如"（空）"）。 */
  readonly previewEmpty: string;
  /** 恢复识别的无障碍名。**一整句**，不要用前缀拼 raw。 */
  readonly restoreAria: (raw: string) => string;
  /** 忽略识别的无障碍名。 */
  readonly ignoreAria: (raw: string) => string;
  /**
   * 一条**生效中或未被采纳**的芯片的取值文案。
   *
   * 🔴 `now` 由本组件**同一次渲染**的"现在"传进来 —— 解析结果与这条文案
   * 必须用同一个时间源，否则跨零点时同一屏上的两行会算出不同的日期
   * （与 `TasksScreen` 冻结 `now` 是同一条纪律）。宿主只负责措辞，
   * 天数由 `./model.ts` 的 `captureChipRemainingDays` 算。
   */
  readonly valueLabel: (chip: CaptureChip, now: number) => string;
}

/** AI 面板（或别的宿主内容）渲染时拿到的上下文。 */
export interface CaptureAssistantContext {
  /** 当前草稿（AI 要解析的就是它）。 */
  readonly draft: string;
  /**
   * 把 AI 解析出的字段按**和回车完全相同的那条路**提交，并清空输入框。
   *
   * 🔴 这是"AI 没有旁路"的落点：`onApply` 拿到的东西最终走同一个 `onSubmit`。
   */
  readonly apply: (fields: CaptureAiFields) => Promise<void>;
}

export interface CaptureComposerProps {
  readonly labels: CaptureComposerLabels;
  /** 提交。字段已换算成 `Task` 约定（`dueDate` = epoch ms）。 */
  readonly onSubmit: (plan: CaptureSubmitPlan) => void | Promise<void>;
  /**
   * **锚点日**（R11 批五：日历里"说一句话落进选中那一格"）。
   *
   * 🔴 语义是**兜底**，不是覆盖：输入里解析出的日期赢，其次才是锚点，
   *   都没有才不带 `dueDate`（优先级与理由在 `toCaptureSubmitPlan`）。
   *   ⚠️ 给了锚点就**必须在界面上说出来**（宿主负责，见它的 placeholder）——
   *   悄悄改变一条任务的落点，是"界面没说谎但用户以为没说"那一类缺陷。
   */
  readonly anchorDate?: LocalDate | undefined;
  /**
   * 宿主内容（web 是 AI 一句话捕获）。不传就不渲染。
   *
   * ⚠️ 它在**输入行与预览之下**，且只有在宿主自己决定渲染时才出现 ——
   * "空输入框上挂一个 AI 按钮"是宿主该拒绝的交互（点下去必然失败）。
   */
  readonly renderAssistant?: (ctx: CaptureAssistantContext) => React.ReactNode;
  /**
   * 时间源（epoch ms）。默认 `Date.now()`（每次渲染取一次）。
   * 显式传入才能让"跨零点/今天是几号"可复现（与 `parseCapture` 同一约定）。
   */
  readonly now?: number;
  /**
   * 输入框自动聚焦。
   *
   * 🔴 移动端把它放在**新建任务面板**里（一个 modal），弹出即该打字；
   * 而 web 把它内联在列表顶部 —— 一进页面就抢焦点会打断读屏与滚动。
   * 所以它是宿主决定的事，不是共享层的默认值。
   */
  readonly autoFocus?: boolean;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    wrap: {
      gap: tokens['space.2'],
    },
    /** 输入行：输入框吃掉剩余宽度，按钮贴右。 */
    compose: {
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
    },
    addEnabled: {
      backgroundColor: tokens['color.primary'],
    },
    addDisabled: {
      backgroundColor: tokens['color.primary'],
      opacity: tokens['state.disabled-opacity'],
    },
    addText: {
      color: tokens['color.on-primary'],
    },
    /** 芯片行：可换行，与 web 迁移前的 `flex-wrap` 一致。 */
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['size.chip-height'],
      paddingHorizontal: tokens['size.chip-padding-x'],
      borderRadius: tokens['radius.full'],
      borderWidth: tokens['border-width.thin'],
      backgroundColor: tokens['color.primary-subtle'],
      borderColor: tokens['color.border-subtle'],
    },
    /**
     * 未被采纳 / 已忽略：用**虚线边框 + 弱化色**。
     * 不能让它消失 —— 它会消失就等于告诉用户"这条生效了"。
     * ⚠️ RN 的 `borderStyle: 'dashed'` 只在四边等宽时可靠，这里正是四边等宽。
     */
    chipOff: {
      backgroundColor: 'transparent',
      borderStyle: 'dashed',
    },
    chipRaw: {
      color: tokens['color.foreground'],
    },
    /**
     * 未被采纳 / 已忽略的芯片里，**原文也跟着弱化** —— 迁移前
     * `.ht-capture__chip--off { color: …subtle }` 是靠 CSS **继承**做到这一点的，
     * RN 没有继承，必须显式给（不给的话 off 芯片的原文会比迁移前更抢眼，
     * 而它恰恰是"还没生效"的那一条）。
     */
    chipRawOff: {
      color: tokens['color.foreground-subtle'],
    },
    chipArrow: {
      color: tokens['color.foreground-subtle'],
    },
    chipValue: {
      color: tokens['color.primary'],
    },
    chipValueOff: {
      color: tokens['color.foreground-subtle'],
    },
    chipHint: {
      color: tokens['color.foreground-subtle'],
      fontSize: tokens['font-size.2xs'],
    },
    /** 数字（日期、计数）等宽 —— 否则同一个芯片在两次渲染里宽度会跳。 */
    numeric: {
      fontVariant: ['tabular-nums'],
    },
    /** 取消 / 恢复按钮：一个圆形可点区域。 */
    chipToggle: {
      alignItems: 'center',
      justifyContent: 'center',
      width: tokens['icon.sm'],
      height: tokens['icon.sm'],
      borderRadius: tokens['radius.full'],
    },
    preview: {
      color: tokens['color.foreground-subtle'],
    },
    previewTitle: {
      color: tokens['color.foreground'],
    },
  });
}

export function CaptureComposer({
  labels,
  onSubmit,
  anchorDate,
  renderAssistant,
  now,
  autoFocus,
  testID,
}: CaptureComposerProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const [draft, setDraft] = useState('');
  /** 用户显式忽略的识别。**是"这段字是标题的一部分"，不是"删掉这几个字"。** */
  const [ignored, setIgnored] = useState<readonly CaptureExclusion[]>([]);

  /**
   * 同一次渲染里的"现在"。
   *
   * 🔴 解析与 `valueLabel` 必须共用它（跨零点时同一屏上的两行不能算出不同的日期）。
   * `now` 不传时每次渲染取一次 —— 与迁移前 `previewNow = Date.now()` 同一行为。
   */
  const renderNow = now ?? Date.now();
  const parsed = useMemo(() => parseCaptureDraft(draft, ignored, now), [draft, ignored, now]);
  const chips = useMemo(() => toCaptureChips(parsed), [parsed]);
  const canSubmit = captureCanSubmit(parsed);

  function submit(): void {
    const plan = toCaptureSubmitPlan(parsed, anchorDate);
    if (plan === undefined) return;
    void onSubmit(plan);
    setDraft('');
    setIgnored([]);
  }

  /** 忽略 / 恢复一条识别。只动"忽略清单"，**绝不动输入框里的字**。 */
  function toggleIgnore(chip: CaptureChip): void {
    setIgnored((list) => toggleCaptureIgnore(list, chip));
  }

  /** 输入变了，旧的忽略清单可能已经指向不存在的文字 —— 清掉以免残留状态。 */
  function onDraftChange(value: string): void {
    setDraft(value);
    if (shouldResetCaptureIgnore(ignored)) setIgnored([]);
  }

  /**
   * AI / 宿主内容提交的那条路。
   *
   * 🔴 与 `submit` 共用 `onSubmit`，并同样清空输入 —— "AI 应用"与"回车"
   * 必须是同一种结果，否则残留的文字会让下一次回车建出重复任务。
   */
  const apply = useCallback(
    async (fields: CaptureAiFields): Promise<void> => {
      await onSubmit(toAiCaptureSubmitPlan(fields));
      setDraft('');
      setIgnored([]);
    },
    [onSubmit],
  );

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.compose}>
        <TextInput
          style={[text['row-meta'], styles.input]}
          value={draft}
          placeholder={labels.placeholder}
          placeholderTextColor={tokens['color.foreground-subtle']}
          accessibilityLabel={labels.addLabel}
          onChangeText={onDraftChange}
          onSubmitEditing={submit}
          returnKeyType="done"
          {...(autoFocus === undefined ? {} : { autoFocus })}
          testID="capture-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.add}
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
          aria-disabled={!canSubmit}
          disabled={!canSubmit}
          onPress={submit}
          style={[styles.addButton, canSubmit ? styles.addEnabled : styles.addDisabled]}
          testID="capture-submit"
        >
          <HeytaIcon data={Plus} size={tokens['icon.sm']} color={tokens['color.on-primary']} />
          <Text style={[text['row-meta'], styles.addText]}>{labels.add}</Text>
        </Pressable>
      </View>

      {chips.length > 0 ? (
        <View
          style={styles.chips}
          accessibilityLabel={labels.matchesAria}
          testID="capture-matches"
        >
          {chips.map((chip, index) => {
            const off = chip.action !== 'ignore';
            return (
              <View
                key={chip.key}
                style={[styles.chip, off ? styles.chipOff : null]}
                testID={`capture-chip-${String(index)}`}
              >
                <Text style={[text.caption, styles.chipRaw, off ? styles.chipRawOff : null]}>
                  {chip.raw}
                </Text>
                <Text
                  style={[text.caption, styles.chipArrow]}
                  aria-hidden
                >
                  →
                </Text>
                <Text
                  style={[text.caption, styles.numeric, chip.action === 'ignore' ? styles.chipValue : styles.chipValueOff]}
                  testID="capture-chip-value"
                >
                  {chip.action === 'restore' ? labels.rejected : labels.valueLabel(chip, renderNow)}
                </Text>
                {chip.action === 'restore' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.restoreAria(chip.raw)}
                    onPress={() => {
                      toggleIgnore(chip);
                    }}
                    style={styles.chipToggle}
                    testID="capture-chip-toggle"
                  >
                    <HeytaIcon
                      data={RotateCcw}
                      size={tokens['icon.xs']}
                      color={tokens['color.foreground-subtle']}
                    />
                  </Pressable>
                ) : chip.action === 'ignore' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={labels.ignoreAria(chip.raw)}
                    onPress={() => {
                      toggleIgnore(chip);
                    }}
                    style={styles.chipToggle}
                    testID="capture-chip-toggle"
                  >
                    <HeytaIcon
                      data={X}
                      size={tokens['icon.xs']}
                      color={tokens['color.foreground-subtle']}
                    />
                  </Pressable>
                ) : (
                  <Text
                    style={[text.caption, styles.chipHint]}
                    testID="capture-chip-hint"
                  >
                    {labels.unused}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {chips.length > 0 ? (
        <Text style={[text.caption, styles.preview]} testID="capture-preview">
          {labels.previewLead}{' '}
          <Text style={styles.previewTitle}>
            {parsed.title === '' ? labels.previewEmpty : parsed.title}
          </Text>
        </Text>
      ) : null}

      {renderAssistant === undefined ? null : renderAssistant({ draft, apply })}
    </View>
  );
}
