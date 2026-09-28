/**
 * `AiDisclosure` —— 「发送前披露」的**唯一实现**
 * ==============================================
 *
 * ## 它替代了什么
 *
 * web 里原本有 **5 份**手抄的披露 JSX（`AiBreakdown` / `AiPrioritize` /
 * `AiDuration` / `AiCapture` / `AiToolRun`）。前四份归一化 testid 后只差注释，
 * 各约 45 行；**第 5 份漂移了**：`AiToolRun` 缺「回退链」与「E2EE 警告」，
 * 而它拿到的 `target` 确实带 `fallbacks`、`invokeRouted()` 确实会多端点回退。
 *
 * ⇒ 一处**真实的隐私披露缺口**，而且**没有任何测试会红**。
 * 本组件把"必须披露哪些维度"变成一份可测的纯逻辑（`./model.ts`），
 * 五个面板共用它 —— 第 5 份的缺口因此**在结构上不可能再出现**。
 *
 * ## 🔴 共享层不 import `@heyta/i18n`（会拖进第二份 React）
 *
 * 与 `TaskList` / `FocusPanel` / `EmptyState` / `SyncStatusBar` 同一条纪律：
 * i18n 包曾自带一份 React，让 Android 产物出现两个 React 实例，
 * `check:mobile-bundle` 盯着这件事。共享层被四个端共用，它一中招四端同时中招。
 * 所以文案**全部由宿主注入 `labels`**（`apps/web` 侧的适配器是
 * `features/ai/AiDisclosureHost.tsx`）。
 *
 * ## 🔴 只用 RN 原语，token 全走 `useHeytaTokens` / `useHeytaText`
 *
 * 没有 `<div>` / `<p>` / `<strong>` / `<code>`（iOS 上不存在），
 * 也没有裸色值 / 裸间距（`check:design` 会拦）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 诚实记账：**没有装进共享层的东西**（逐条，附影响与最小下一步）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **面板外壳（root + head + 关闭按钮 + 动作按钮）** 留在各宿主。
 *    实测差异：root testid 是 `ai-disclosure` / `prioritize-disclosure` / …；
 *    关闭按钮 testid 四份里只有 3 份有（`prioritize-disclosure-close` /
 *    `capture-dismiss` / `ai-tool-disclosure-close`），aria-label 也逐面板不同。
 *    ⇒ 影响：外壳仍可能各自漂移（但外壳**不承载隐私维度**）。
 *    最小下一步：把 root 的 `role="dialog"` + aria-label 与关闭按钮
 *    提成一个 `AiPanelFrame`，关闭按钮 testid 走 `renderClose` 插槽。
 *
 * 2. **`no-target` 分支**留在宿主。四个面板渲染 web 的 `RouteUnavailable`
 *    （依赖 i18n 词条 + `SettingsTarget` 导航 + 重试），第 5 个
 *    （`AiToolRun`）渲染的是一句 `<p data-testid="ai-tool-no-target">` ——
 *    形状本就不同。⇒ 影响：`ai-tool-no-target` 至今没有"去设置"入口。
 *    最小下一步：把 `RouteExplanation` 也挪进共享层，`RouteUnavailable`
 *    变成共享组件的 web 适配器。
 *
 * 3. **`AiPrioritize` 的一行 count 与 `AiDuration` 的 `renderBasis()`**
 *    不进来（它们是面板专有内容），但通过 `children` 插槽摆在
 *    `fields` 与 `e2ee-warning` 之间 —— 与改造前的顺序逐字相同。
 *
 * 4. **文案模板**（`t('web.ai.disclosure.model', { model })`）留在宿主：
 *    共享层收到的是已经渲染好的 `labels.model`。理由是 i18n 不能进共享层，
 *    而"模型：{model}"这条模板的插值只能在有 i18n 的那一侧做。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Cloud, HardDrive, TriangleAlert } from 'lucide';

import { HeytaIcon, type HeytaIconData } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  aiDisclosureTestIds,
  toAiDisclosureViewModel,
  type AiDisclosureInput,
} from './model.js';

export type { AiDisclosureInput, AiDisclosureTarget } from './model.js';

/**
 * 宿主注入的文案。**每一项都是一整句**（或已经插值好的整句），
 * 共享层不拼模板 —— 理由见文件头第 4 条。
 */
export interface AiDisclosureLabels {
  /** 「会发给」这类引导语。 */
  readonly destinationLead: string;
  readonly local: string;
  readonly remote: string;
  /** 已经插值好的「模型：qwen3:8b」。 */
  readonly model: string;
  /** 「首选端点失败时会依次回退到」这类引导语。 */
  readonly fallbackLead: string;
  readonly retentionLead: string;
  readonly fieldsLead: string;
  readonly e2eeLead: string;
  readonly e2eeStrong: string;
}

export interface AiDisclosureProps extends AiDisclosureInput {
  /**
   * testid 前缀。各面板实测值：
   * `ai-` / `prioritize-` / `duration-` / `capture-` / `ai-tool-`。
   * 拼出来的 testid **必须与改造前逐字一致**，否则 `apps/web/tests/ai-*.spec.tsx`
   * 的定位钩子会同时静默消失。
   */
  readonly testIdPrefix: string;
  readonly labels: AiDisclosureLabels;
  /**
   * `fields` 与 `e2ee-warning` 之间的一行（`AiPrioritize` 的 count、
   * `AiDuration` 的 `renderBasis()`）。**不给就什么都不渲染** —— 不开分支。
   */
  readonly children?: React.ReactNode;
}

const GLYPHS = {
  local: HardDrive,
  remote: Cloud,
  warn: TriangleAlert,
} satisfies Record<string, HeytaIconData>;

/** 装饰性图标 —— 旁边已有文字，不给 label，免得读屏念两遍。 */
function DecorativeIcon({ data, color }: { data: HeytaIconData; color: string }): React.JSX.Element {
  const tokens = useHeytaTokens();
  return (
    <HeytaIcon
      data={data}
      size={tokens['icon.xs']}
      color={color}
      strokeWidth={1.5}
    />
  );
}

export function AiDisclosure({
  testIdPrefix,
  labels,
  target,
  fields,
  retentionText,
  separator,
  children,
}: AiDisclosureProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const ids = aiDisclosureTestIds(testIdPrefix);
  const view = toAiDisclosureViewModel({ target, fields, retentionText, separator });

  /**
   * token 里的字重是**数字**（`600`），而 RN 的 `fontWeight` 只接受字符串联合。
   * 直接塞数字会编译不过（实测 `TS2322`）—— 转换收在这一行，
   * 与 `design-system/src/typography.ts:201` 同一套写法。
   */
  const strongWeight = String(tokens['font-weight.semibold']) as TextStyle['fontWeight'];

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: tokens['space.1'] },
        row: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: tokens['space.2'],
        },
        // 危险行（回退链 / E2EE 警告）用 danger 色。**不只靠颜色**：
        // 字形本身也是警告三角，色觉障碍用户靠形状就能分辨。
        warn: { color: tokens['color.danger'] },
        subtle: { color: tokens['color.foreground-subtle'] },
        strong: { fontWeight: strongWeight },
        tag: { color: tokens['color.foreground-muted'] },
      }),
    [tokens],
  );

  return (
    <View style={styles.root}>
      {/* ① 发给谁 —— 含端点地址、模型、以及"本地还是远端"。 */}
      <View style={styles.row} testID={ids.destination}>
        <DecorativeIcon
          data={view.isLocal ? GLYPHS.local : GLYPHS.remote}
          color={tokens['color.foreground-muted']}
        />
        <Text style={text['row-meta']}>
          {labels.destinationLead}
          <Text style={styles.strong}>{view.label}</Text>
          <Text style={styles.subtle}>{view.endpoint}</Text>
          <Text>{labels.model}</Text>
          <Text style={styles.tag} testID={ids.destinationKind}>
            {view.isLocal ? labels.local : labels.remote}
          </Text>
        </Text>
      </View>

      {/* ② 🔴 回退链必须披露 —— 首选失败时会自动换一个端点，而那是**另一家公司**，
          成功了就没有任何提示，所以只能在这里先说清楚（ai-architecture §5.1）。 */}
      {view.fallbacks.length === 0 ? null : (
        <View style={styles.row} testID={ids.fallbacks}>
          <DecorativeIcon data={GLYPHS.warn} color={tokens['color.danger']} />
          <Text style={[text['row-meta'], styles.warn]}>
            {labels.fallbackLead}
            <Text style={styles.strong} testID={ids.fallbackList}>
              {view.fallbackText}
            </Text>
          </Text>
        </View>
      )}

      {/* ③ 「留多久」是披露的三维之一（发给谁 / 发什么 / 留多久）。 */}
      {view.retentionText === undefined ? null : (
        <View style={styles.row} testID={ids.retention}>
          <Text style={text['row-meta']}>
            {labels.retentionLead}
            <Text style={styles.strong} testID={ids.retentionText}>
              {view.retentionText}
            </Text>
          </Text>
        </View>
      )}

      {/* ④ 发什么 —— 逐项列出，不许 `['*']`（ai-architecture §4.5 / 判据 8）。 */}
      <View style={styles.row} testID={ids.fields}>
        <Text style={text['row-meta']}>
          {labels.fieldsLead}
          <Text style={styles.strong} testID={ids.fieldList}>
            {view.fieldsText}
          </Text>
        </Text>
      </View>

      {/* ⑤ 面板专有的一行（count / 估时依据）。不开分支，用插槽。 */}
      {children}

      {/* ⑥ 🔴 远端必须出现"不受端到端加密保护"的明文警告（ai-architecture §2.4）。 */}
      {view.isLocal ? null : (
        <View style={styles.row} testID={ids.e2eeWarning}>
          <DecorativeIcon data={GLYPHS.warn} color={tokens['color.danger']} />
          <Text style={[text['row-meta'], styles.warn]}>
            {labels.e2eeLead}
            <Text style={styles.strong}>{labels.e2eeStrong}</Text>
          </Text>
        </View>
      )}
    </View>
  );
}
