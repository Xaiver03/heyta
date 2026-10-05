/**
 * 移动端的 AI 助手面 —— 五个功能都从这里走
 * =======================================
 *
 * 🔴 本文件**没有一行业务判断**（AGENTS.md §3.5）。五个功能各自那条链路
 * （出境闸门 → 路由 → 回退 → 解析 → 夹取）全在 `@heyta/app-host` 的 `request*()` 里；
 * 这里只做四件事：**冻结用户刚说的那句话、渲染披露、把候选摆成可确认的样子、
 * 用户点头之后把字段交给动作层。**
 *
 * ## 五个功能 → 五个入口（`pnpm check:ai-coverage` 的分子就是这么数的）
 *
 * | 功能 | 入口（app-host） | 确认后的落点 |
 * |---|---|---|
 * | `capture` | `requestCapture` | `TaskActions.create`（日期经共享 `toAiCaptureSubmitPlan` 换算） |
 * | `breakdown` | `requestBreakdown` | `TaskActions.setNote`（`mergeChecklistIntoNote`） |
 * | `prioritize` | `requestPrioritize` | 逐条 `TaskActions.setPriority`（用户勾了几条就几条） |
 * | `duration-estimate` | `requestDuration` | `TaskActions.setNote`（`writeDurationIntoNote`，**不加持久化字段**） |
 * | `tool-calling` | `requestToolCall` + `requestAssistantTurn` | 读工具即执行；写工具**只出提案**，`confirmAiToolProposal` 才落库 |
 *
 * ## 🔴 三条被本文件守着的隐私不变量
 *
 * 1. **发送前必须披露，且披露与请求用的是同一个 source。**
 *    点"发送"那一步只**冻结**输入与 `now`，界面切到披露态，一个字节都不发；
 *    用户看完整份披露再按「发送」才真的出去。同一次点击里既算披露又发请求，
 *    跨过午夜时两边会是**两个不同的"今天"**。
 * 2. **写路径永远停在候选上。** 本文件构造不出 op：建任务 / 改备注 / 改优先级
 *    都走 `TaskActions`，工具写入走 `confirmAiToolProposal()`。
 *    `host.submit(` 在 `apps/*` 里一个调用点都没有（`check:ai-tools` 钉着那份清单）。
 * 3. **本文件不写 `consents`。** 授权只有设置面那一个前端；
 *    面板里放一个"同意"勾就是第二套事实源（web 侧 `route-explanation.ts`
 *    记的正是上一轮刚修掉的那个形状）。没授权时照实失败，文案指向设置面。
 *
 * ## ⚠️ 本端与 web 的两处**真实差别**（登记，不是遗漏）
 *
 * · `preferences`（记忆层偏好提示）**没传**。"忘了传"的失效方向是**少发偏好**，
 *   是 fail-closed 那一侧（见 `RequestCaptureDeps.preferences` 的注释）；
 *   移动端的记忆接线不在这一刀里。
 * · `duration` 的 `history` **没传**，与 web 同一条选择（"不传的语义是这次估时没有
 *   历史可用"）。编一份假历史比不传更糟。
 * · 拆解候选的**逐条取舍**没做（整组采用 / 整组放弃）；排序做了逐条勾选。
 *   差别在界面里看得见，不影响出境的数据集。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  authorizeEgress,
  buildDisclosure,
  fromHealthSnapshot,
  toHealthSnapshot,
  type AiFeature,
  type HealthMap,
} from '@heyta/ai';
import {
  MAX_CAPTURE_INPUT_LENGTH,
  MAX_TOOL_CALL_TEXT_LENGTH,
  buildBreakdownInvocation,
  buildCaptureInvocation,
  buildDurationInvocation,
  buildPrioritizeInvocation,
  buildToolCallInvocation,
  confirmAiToolProposal,
  createLocalApiHost,
  createTaskActions,
  mergeChecklistIntoNote,
  planAssistantEgress,
  requestAssistantTurn,
  requestBreakdown,
  requestCapture,
  requestDuration,
  requestPrioritize,
  requestToolCall,
  resolveAiRoute,
  toToolDescriptors,
  writeDurationIntoNote,
  type AiRouteTarget,
  type AppHost,
  type AssistantOutcome,
  type BreakdownProposal,
  type CaptureProposal,
  type DurationProposal,
  type PrioritizeProposal,
  type TaskActions,
  type ToolCallOutcome,
} from '@heyta/app-host';
import { Priority, type Task } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import type { LocalApiHost } from '@heyta/local-api';
import { toAiCaptureSubmitPlan } from '@heyta/ui';

import { useTokens } from '../theme';
import { Button, Card, Chip, EmptyState, Screen, SectionHeader, Stack, Text, TextField } from '../ui/kit';
import { HStack } from '../ui/kit';
import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { AiDisclosureBlock } from './disclosure';
import { intentText } from './intent-copy';
import {
  AI_CAUSE_KEY,
  AI_FEATURE_LABEL_KEY,
  AI_NO_TARGET_KEY,
  AI_ROUTE_EXPLAIN_KEY,
  ASSISTANT_FAILURE_KEY,
  BREAKDOWN_FAILURE_KEY,
  CAPTURE_FAILURE_KEY,
  DURATION_FAILURE_KEY,
  PRIORITIZE_FAILURE_KEY,
  TOOL_CALL_FAILURE_KEY,
} from './copy';
import {
  aiSecrets,
  getAiSettings,
  isAiConfiguredOnThisDevice,
  saveAiSettings,
  useAiSettings,
} from './settings-store';

/** 界面顺序 = 用户说话的顺序：先记下来，再拆开，再排序，再估时，最后让它动手。 */
const MODES = [
  'capture',
  'breakdown',
  'prioritize',
  'duration-estimate',
  'tool-calling',
] as const satisfies readonly AiFeature[];

/**
 * 四个面板共用的相位机。
 * `disclose` 单独一相是**刻意的** —— 那一相里一个请求都没发；
 * 少了它，"用户看见披露"与"数据已经出去"就是同一个瞬间。
 */
type Phase = 'input' | 'disclose' | 'sending' | 'proposal' | 'failed';

const MAX_PICKER_ROWS = 12;

export function AssistantScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const settings = useAiSettings();
  const { dataRevision } = useMobileSync();
  const [mode, setMode] = useState<AiFeature>('capture');
  const [host, setHost] = useState<AppHost | null>(null);
  const [hostError, setHostError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((error: unknown) => {
        if (alive) setHostError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, []);

  const actions = useMemo<TaskActions | null>(
    () => (host === null ? null : createTaskActions(host)),
    [host],
  );
  /**
   * 工具宿主与 MCP / CLI 是**同一个** `createLocalApiHost()`（ADR-0035：
   * 工具执行语义只有一份）。`isReadable` 必须**显式**回答 —— 与 web 的
   * `createAiToolHost()` 同一个如实值：本产品还没有"受保护条目"这个概念。
   */
  const toolHost = useMemo<LocalApiHost | null>(
    () =>
      host === null
        ? null
        : createLocalApiHost(
            { dispatch: host.dispatch, getState: host.getState },
            createTaskActions(host),
            { isReadable: () => true },
          ),
    [host],
  );

  const tasks = useMemo<readonly Task[]>(
    // 🔴 依赖里有 `dataRevision`：同步完不重读，候选集会一直停在旧数据上。
    () => (actions === null ? [] : actions.listPendingTasks()),
    [actions, dataRevision],
  );

  /**
   * 熔断状态落盘。**成功与失败都要落**（失败正是计数器 +1 的那一次）。
   *
   * 🔴 读的是 `getAiSettings()`（模块里那份活值）而不是闭包里的 `settings`：
   * 请求返回之前用户可能刚在设置面改了端点，写回旧快照会把他的修改**吞掉**。
   * web 侧那条"点保存把内存配置覆盖成空地址"的事故就是同一类。
   */
  const persistHealth = useCallback((health: HealthMap) => {
    const live = getAiSettings();
    saveAiSettings({ ...live, health: toHealthSnapshot(health, Date.now()) });
  }, []);

  /**
   * 首选项 —— 走 `resolveAiRoute`（与 web 同一份实现，判据也同一份：
   * 没有候选就没有"发送"按钮，披露也就永远不会指向一个打不到的端点）。
   */
  const route = useMemo(
    () =>
      resolveAiRoute(settings.routing, mode, {
        health: fromHealthSnapshot(settings.health, Date.now()),
      }),
    [settings.routing, settings.health, mode],
  );

  const configured = isAiConfiguredOnThisDevice(settings);

  return (
    <Screen
      title={t('mobile.ai.title')}
      actions={[
        {
          icon: 'action.back',
          label: t('mobile.ai.back'),
          testID: 'assistant-back',
          onPress: onBack,
        },
      ]}
    >
      <View testID="assistant-screen">
        {hostError !== undefined ? (
          <EmptyState
            icon="conflict.warning"
            title={t('mobile.ai.hostFailed.title')}
            hint={t('mobile.ai.hostFailed.hint')}
            detail={hostError}
          />
        ) : null}

        {!configured ? (
          /**
           * 走到这里通常意味着"用户在面板还挂着时把总开关关了"。
           * 说一句真话，而不是渲染五个点了没反应的面板。
           */
          <Card gap="loose">
            <Text variant="section-title">{t('mobile.ai.notConfigured.title')}</Text>
            <Text variant="row-meta" tone="subtle">
              {t('mobile.ai.notConfigured')}
            </Text>
          </Card>
        ) : (
          <>
            <SectionHeader icon="action.more" title={t('mobile.ai.section.mode')} />
            <HStack gap="tight">
              {MODES.map((feature) => (
                <Chip
                  key={feature}
                  label={t(AI_FEATURE_LABEL_KEY[feature])}
                  selected={feature === mode}
                  onPress={() => {
                    setMode(feature);
                  }}
                />
              ))}
            </HStack>

            {host === null ? (
              <Text variant="row-meta" tone="subtle">
                {t('web.ai.loading.waiting')}
              </Text>
            ) : (
              /**
               * 🔴 `key={mode}` 是承重的：换功能时整棵子树重挂，
               * 上一个功能的未决候选与冻结输入不会跟着过来。
               * 共用一份 state 的话，"切了标签但按发送发的还是上一条那句话"
               * 是可以发生的，而它看起来像正常行为。
               */
              <Panel
                key={mode}
                mode={mode}
                route={route}
                actions={actions}
                toolHost={toolHost}
                tasks={tasks}
                persistHealth={persistHealth}
              />
            )}
          </>
        )}

        <Text variant="caption" tone="subtle" style={{ color: tokens['color.foreground-subtle'] }}>
          {t('mobile.ai.proposalNeverAuto')}
        </Text>
      </View>
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 面板分发
// ─────────────────────────────────────────────────────────────────────────

interface PanelProps {
  readonly mode: AiFeature;
  readonly route: ReturnType<typeof resolveAiRoute>;
  readonly actions: TaskActions | null;
  readonly toolHost: LocalApiHost | null;
  readonly tasks: readonly Task[];
  readonly persistHealth: (health: HealthMap) => void;
}

function Panel({ mode, route, actions, toolHost, tasks, persistHealth }: PanelProps): React.JSX.Element {
  const settings = useAiSettings();
  const shared = {
    route,
    routing: settings.routing,
    consents: settings.consents,
    healthSnapshot: settings.health,
    persistHealth,
    actions,
    tasks,
  };
  // 判别式穷尽：加一个 `AiFeature` 而这里没接 ⇒ 编译不过。
  // 这一条挡的就是"联合类型加了成员、设置界面照旧渲染那一行、面板什么都不发"。
  switch (mode) {
    case 'capture':
      return <CapturePanel {...shared} />;
    case 'breakdown':
      return <BreakdownPanel {...shared} />;
    case 'prioritize':
      return <PrioritizePanel {...shared} />;
    case 'duration-estimate':
      return <DurationPanel {...shared} />;
    case 'tool-calling':
      return <ToolPanel {...shared} toolHost={toolHost} tier={settings.assistantTier} />;
  }
}

type SharedPanelProps = {
  readonly route: ReturnType<typeof resolveAiRoute>;
  readonly routing: ReturnType<typeof useAiSettings>['routing'];
  readonly consents: ReturnType<typeof useAiSettings>['consents'];
  readonly healthSnapshot: ReturnType<typeof useAiSettings>['health'];
  readonly persistHealth: (health: HealthMap) => void;
  readonly actions: TaskActions | null;
  readonly tasks: readonly Task[];
};

/** 每次请求都要带上的一组依赖。密钥走内存 store，熔断快照走**发送那一刻**解析。 */
function routedDeps(healthSnapshot: ReturnType<typeof useAiSettings>['health']) {
  return {
    secretStore: aiSecrets,
    healthSeed: fromHealthSnapshot(healthSnapshot, Date.now()),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 共用的三块：披露 / 失败 / 任务选择器
// ─────────────────────────────────────────────────────────────────────────

interface DisclosureStepProps {
  readonly feature: AiFeature;
  readonly target: AiRouteTarget | undefined;
  readonly fields: readonly string[];
  readonly consents: SharedPanelProps['consents'];
  readonly routing: SharedPanelProps['routing'];
  readonly testIdPrefix: string;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  /** 字段清单与 E2EE 警告之间那一行（面板专有内容）。 */
  readonly children?: React.ReactNode;
}

function DisclosureStep({
  feature,
  target,
  fields,
  consents,
  testIdPrefix,
  onSend,
  onCancel,
  children,
}: DisclosureStepProps): React.JSX.Element {
  const { t } = useI18n();

  if (target === undefined) {
    return (
      <Card gap="loose">
        <Text variant="row-title">{t(AI_NO_TARGET_KEY[feature])}</Text>
        <Text variant="row-meta" tone="subtle">
          {t('mobile.ai.goSettings')}
        </Text>
      </Card>
    );
  }

  const disclosure = buildDisclosure({ feature, destination: target.destination, fields });
  const decision = authorizeEgress(
    { feature, destination: target.destination, fields },
    consents as Parameters<typeof authorizeEgress>[1],
  );

  return (
    <Stack gap="loose" testID={`${testIdPrefix}disclosure`}>
      <AiDisclosureBlock
        testIdPrefix={testIdPrefix}
        target={target}
        fields={fields}
        retentionDisclosure={disclosure.retentionDisclosure}
      >
        {children}
      </AiDisclosureBlock>
      {/*
        🔴 "还没有授权"这句话**必须显示**，而且不能由这里判成别的：
        判据用的是 `packages/ai` 的 `authorizeEgress()`（与真正发请求时同一个函数），
        所以界面说的和闸门做的是**一次判断**，不是两份口径。
      */}
      {!decision.allowed ? (
        <Text variant="row-meta" tone="warning">
          {t('web.ai.settings.consentLead')}
        </Text>
      ) : null}
      <HStack gap="tight">
        <Button
          label={t('web.ai.action.send')}
          tone="primary"
          testID={`${testIdPrefix}send`}
          onPress={onSend}
        />
        <Button label={t('web.ai.action.cancel')} tone="ghost" onPress={onCancel} />
      </HStack>
    </Stack>
  );
}

function FailureStep({
  failure,
  testIdPrefix,
  onRetry,
}: {
  failure: { key: MessageKey; detail?: string };
  testIdPrefix: string;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Stack gap="loose" testID={`${testIdPrefix}failed`}>
      <Text variant="row-title" tone="danger">
        {t(failure.key)}
      </Text>
      {/* 原文是**诊断数据**，不当界面文案、不翻译（与 web 的折叠诊断块同一条纪律）。 */}
      {failure.detail !== undefined && failure.detail !== '' ? (
        <Text variant="caption" tone="subtle" selectable>
          {t('web.ai.failure.details')}
          {failure.detail}
        </Text>
      ) : null}
      <Button label={t('web.ai.action.retry')} tone="secondary" onPress={onRetry} />
    </Stack>
  );
}

function TaskPicker({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: readonly Task[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  if (tasks.length === 0) {
    return (
      <Text variant="row-meta" tone="subtle">
        {t('mobile.ai.task.none')}
      </Text>
    );
  }
  const rows = tasks.slice(0, MAX_PICKER_ROWS);
  return (
    <Stack gap="tight">
      <Text variant="group-label">{t('mobile.ai.task.label')}</Text>
      <HStack gap="tight">
        {rows.map((task) => (
          <Chip
            key={task.id}
            label={task.title}
            selected={task.id === selectedId}
            onPress={() => {
              onSelect(task.id);
            }}
          />
        ))}
      </HStack>
      {tasks.length > rows.length ? (
        <Text variant="caption" tone="subtle">
          {t('mobile.ai.task.more', { count: String(tasks.length - rows.length) })}
        </Text>
      ) : null}
    </Stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ① 一句话捕获
// ─────────────────────────────────────────────────────────────────────────

function CapturePanel(props: SharedPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [frozen, setFrozen] = useState<{ text: string; now: number }>({ text: '', now: 0 });
  const [proposal, setProposal] = useState<CaptureProposal | undefined>(undefined);
  const [draftTitle, setDraftTitle] = useState('');
  const [failure, setFailure] = useState<{ key: MessageKey; detail?: string } | undefined>(undefined);
  const [applied, setApplied] = useState(false);

  // 🔴 披露与请求共用**同一个 source 对象**（`frozen`）—— 两次算就是两个"今天"。
  const source = { text: frozen.text, now: frozen.now, locale };
  const invocation = buildCaptureInvocation(source, []);

  async function send(): Promise<void> {
    setPhase('sending');
    const outcome = await requestCapture(source, {
      routing: props.routing,
      consents: props.consents,
      routed: routedDeps(props.healthSnapshot),
    });
    props.persistHealth(outcome.health);
    if (outcome.ok) {
      setProposal(outcome.proposal);
      setDraftTitle(outcome.proposal.title);
      setPhase('proposal');
      return;
    }
    setFailure({
      key: outcome.cause !== undefined ? AI_CAUSE_KEY[outcome.cause] : CAPTURE_FAILURE_KEY[outcome.reason],
      detail: outcome.message,
    });
    setPhase('failed');
  }

  async function apply(): Promise<void> {
    if (props.actions === null || draftTitle.trim() === '') return;
    // 🔴 日期换算走**共享层那一张计划**：AI 建的任务与回车建的任务在数据上
    //    不许有任何区别（AI 没有旁路）。
    const plan = toAiCaptureSubmitPlan({
      title: draftTitle.trim(),
      ...(proposal?.dueDate === undefined ? {} : { dueDate: proposal.dueDate }),
      ...(proposal?.priority === undefined ? {} : { priority: proposal.priority }),
    });
    await props.actions.create(plan.title, {
      ...(plan.dueDate === undefined ? {} : { dueDate: plan.dueDate }),
      ...(plan.priority === undefined ? {} : { priority: plan.priority }),
    });
    setApplied(true);
    setPhase('input');
    setText('');
    setProposal(undefined);
  }

  if (phase === 'disclose') {
    return (
      <DisclosureStep
        feature="capture"
        target={props.route.target}
        fields={invocation.fields}
        consents={props.consents}
        routing={props.routing}
        testIdPrefix="capture-"
        onSend={() => {
          void send();
        }}
        onCancel={() => {
          setPhase('input');
        }}
      />
    );
  }

  if (phase === 'failed' && failure !== undefined) {
    return (
      <FailureStep
        failure={failure}
        testIdPrefix="capture-"
        onRetry={() => {
          setPhase('disclose');
        }}
      />
    );
  }

  return (
    <Stack gap="loose">
      <TextField
        label={t('mobile.ai.input.capture')}
        value={text}
        multiline
        lines={3}
        onChangeText={setText}
        placeholder={t('mobile.ai.input.capture.placeholder')}
        hint={t('web.ai.capture.noteLead')}
        testID="capture-input"
      />
      {applied ? (
        <Text variant="row-meta" tone="success">
          {t('web.ai.capture.applied')}
        </Text>
      ) : null}
      {phase === 'proposal' && proposal !== undefined ? (
        <Card gap="loose">
          <Text variant="row-title">{t('web.ai.capture.proposalHead')}</Text>
          <TextField
            label={t('web.ai.capture.field.title')}
            value={draftTitle}
            onChangeText={setDraftTitle}
            testID="capture-draft-title"
          />
          {proposal.dueDate !== undefined ? (
            <Text variant="row-meta">
              {t('web.ai.capture.field.dueDate')}
              {'\n'}
              {proposal.dueDate}
            </Text>
          ) : null}
          {proposal.priority !== undefined ? (
            <Text variant="row-meta">{t(`web.ai.capture.priority.${priorityWord(proposal.priority)}`)}</Text>
          ) : null}
          {proposal.dropped.length > 0 ? (
            <Text variant="caption" tone="warning">
              {t('web.ai.capture.droppedLead')}
              {proposal.dropped.join('、')}
              {t('web.ai.capture.droppedTail')}
            </Text>
          ) : null}
          <HStack gap="tight">
            <Button
              label={t('web.ai.capture.apply')}
              tone="primary"
              testID="capture-apply"
              onPress={() => {
                void apply();
              }}
            />
            <Button
              label={t('web.ai.action.discard')}
              tone="ghost"
              onPress={() => {
                setPhase('input');
                setProposal(undefined);
              }}
            />
          </HStack>
        </Card>
      ) : null}
      {phase === 'sending' ? (
        <Text variant="row-meta" tone="subtle">
          {t('web.ai.loading.waiting')}
        </Text>
      ) : (
        <Button
          label={t('web.ai.capture.button')}
          tone="primary"
          testID="capture-start"
          disabled={text.trim() === '' || props.route.target === undefined}
          onPress={() => {
            // 🔴 只冻结，不发。
            setFrozen({ text, now: Date.now() });
            setApplied(false);
            setPhase('disclose');
          }}
        />
      )}
      <Text variant="caption" tone="subtle">
        {t('mobile.ai.input.limit', { max: String(MAX_CAPTURE_INPUT_LENGTH) })}
      </Text>
    </Stack>
  );
}

function priorityWord(priority: Priority | undefined): 'none' | 'low' | 'medium' | 'high' {
  if (priority === undefined || priority === Priority.None) return 'none';
  if (priority === Priority.Low) return 'low';
  if (priority === Priority.Medium) return 'medium';
  return 'high';
}

// ─────────────────────────────────────────────────────────────────────────
// ② 拆解
// ─────────────────────────────────────────────────────────────────────────

function BreakdownPanel(props: SharedPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('input');
  const [frozen, setFrozen] = useState<{ taskId: string; title: string; note: string | undefined; now: number }>({
    taskId: '',
    title: '',
    note: undefined,
    now: 0,
  });
  const [proposal, setProposal] = useState<BreakdownProposal | undefined>(undefined);
  const [failure, setFailure] = useState<{ key: MessageKey; detail?: string } | undefined>(undefined);
  const [applied, setApplied] = useState(false);

  const source = { title: frozen.title, locale, ...(frozen.note === undefined ? {} : { note: frozen.note }), now: frozen.now };
  const invocation = buildBreakdownInvocation(source, []);

  async function send(): Promise<void> {
    setPhase('sending');
    const outcome = await requestBreakdown(source, {
      routing: props.routing,
      consents: props.consents,
      routed: routedDeps(props.healthSnapshot),
    });
    props.persistHealth(outcome.health);
    if (outcome.ok) {
      setProposal(outcome.proposal);
      setPhase('proposal');
      return;
    }
    setFailure({
      key:
        outcome.cause !== undefined
          ? AI_CAUSE_KEY[outcome.cause]
          : BREAKDOWN_FAILURE_KEY[outcome.reason],
      detail: outcome.message,
    });
    setPhase('failed');
  }

  async function apply(): Promise<void> {
    if (props.actions === null || proposal === undefined) return;
    const task = props.tasks.find((row) => row.id === frozen.taskId);
    if (task === undefined) return;
    await props.actions.setNote(task.id, mergeChecklistIntoNote(task.note, proposal.items));
    setApplied(true);
    setPhase('input');
    setProposal(undefined);
  }

  if (phase === 'disclose') {
    return (
      <DisclosureStep
        feature="breakdown"
        target={props.route.target}
        fields={invocation.fields}
        consents={props.consents}
        routing={props.routing}
        testIdPrefix="ai-"
        onSend={() => {
          void send();
        }}
        onCancel={() => {
          setPhase('input');
        }}
      />
    );
  }

  if (phase === 'failed' && failure !== undefined) {
    return (
      <FailureStep
        failure={failure}
        testIdPrefix="ai-"
        onRetry={() => {
          setPhase('disclose');
        }}
      />
    );
  }

  return (
    <Stack gap="loose">
      <TaskPicker
        tasks={props.tasks}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setApplied(false);
        }}
      />
      {applied ? (
        <Text variant="row-meta" tone="success">
          {t('web.ai.breakdown.applied')}
        </Text>
      ) : null}
      {phase === 'proposal' && proposal !== undefined ? (
        <Card gap="loose">
          <Text variant="row-title">{t('web.ai.breakdown.proposalHead')}</Text>
          {proposal.items.map((item, index) => (
            <Text key={`${item}-${String(index)}`} variant="row-meta">
              {item}
            </Text>
          ))}
          {proposal.truncated ? (
            <Text variant="caption" tone="warning">
              {t('web.ai.breakdown.truncated')}
            </Text>
          ) : null}
          <HStack gap="tight">
            <Button
              label={t('web.ai.breakdown.apply')}
              tone="primary"
              testID="breakdown-apply"
              onPress={() => {
                void apply();
              }}
            />
            <Button
              label={t('web.ai.action.discard')}
              tone="ghost"
              onPress={() => {
                setPhase('input');
                setProposal(undefined);
              }}
            />
          </HStack>
        </Card>
      ) : null}
      {phase === 'sending' ? (
        <Text variant="row-meta" tone="subtle">
          {t('web.ai.loading.waiting')}
        </Text>
      ) : (
        <Button
          label={t('web.ai.breakdown.button')}
          tone="primary"
          testID="breakdown-start"
          disabled={selectedId === undefined || props.route.target === undefined}
          onPress={() => {
            const task = props.tasks.find((row) => row.id === selectedId);
            if (task === undefined) return;
            setFrozen({ taskId: task.id, title: task.title, note: task.note, now: Date.now() });
            setApplied(false);
            setPhase('disclose');
          }}
        />
      )}
    </Stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ③ 排序（批量）
// ─────────────────────────────────────────────────────────────────────────

function PrioritizePanel(props: SharedPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>('input');
  const [frozen, setFrozen] = useState<{ tasks: readonly Task[]; now: number }>({ tasks: [], now: 0 });
  const [proposal, setProposal] = useState<PrioritizeProposal | undefined>(undefined);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<{ key: MessageKey; detail?: string } | undefined>(undefined);
  const [applied, setApplied] = useState(false);

  const source = {
    tasks: frozen.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
      ...(task.priority === undefined ? {} : { priority: task.priority }),
    })),
    locale,
    now: frozen.now,
  };
  const invocation = buildPrioritizeInvocation(source, []);

  async function send(): Promise<void> {
    setPhase('sending');
    const outcome = await requestPrioritize(source, {
      routing: props.routing,
      consents: props.consents,
      routed: routedDeps(props.healthSnapshot),
    });
    props.persistHealth(outcome.health);
    if (outcome.ok) {
      setProposal(outcome.proposal);
      // 默认**全不勾**：采纳是用户的动作，不是系统的默认值。
      setKept({});
      setPhase('proposal');
      return;
    }
    setFailure({
      key:
        outcome.cause !== undefined
          ? AI_CAUSE_KEY[outcome.cause]
          : PRIORITIZE_FAILURE_KEY[outcome.reason],
      detail: outcome.message,
    });
    setPhase('failed');
  }

  async function apply(): Promise<void> {
    if (props.actions === null || proposal === undefined) return;
    /**
     * 🔴 逐条一个 intent，**刻意不合并成一个批量 op**：
     * 用户可能只采纳其中三条（AGENTS §3.4 那条"一个意图一个 op"在这里的读法就是
     * "每一条被留下的建议都是单独一个决定"）。与 web 那条逐字同一条理由。
     */
    for (const suggestion of proposal.suggestions) {
      if (kept[suggestion.id] !== true) continue;
      await props.actions.setPriority(suggestion.id, suggestion.priority);
    }
    setApplied(true);
    setPhase('input');
    setProposal(undefined);
  }

  if (phase === 'disclose') {
    return (
      <DisclosureStep
        feature="prioritize"
        target={props.route.target}
        fields={invocation.fields}
        consents={props.consents}
        routing={props.routing}
        testIdPrefix="prioritize-"
        onSend={() => {
          void send();
        }}
        onCancel={() => {
          setPhase('input');
        }}
      >
        <Text variant="row-meta">
          {t('web.ai.prioritize.countLead')}
          {String(invocation.fields.length === 0 ? 0 : frozen.tasks.length)}
          {t('web.ai.prioritize.countTail')}
        </Text>
      </DisclosureStep>
    );
  }

  if (phase === 'failed' && failure !== undefined) {
    return (
      <FailureStep
        failure={failure}
        testIdPrefix="prioritize-"
        onRetry={() => {
          setPhase('disclose');
        }}
      />
    );
  }

  return (
    <Stack gap="loose">
      <Text variant="row-meta" tone="subtle">
        {t('mobile.ai.prioritize.scope')}
        {'\n'}
        {t('web.ai.prioritize.noteLead')}
        {String(props.tasks.length)}
        {t('web.ai.prioritize.noteMid')}
      </Text>
      {applied ? (
        <Text variant="row-meta" tone="success">
          {t('web.ai.prioritize.applied')}
        </Text>
      ) : null}
      {phase === 'proposal' && proposal !== undefined ? (
        <Card gap="loose">
          <Text variant="row-title">{t('web.ai.prioritize.proposalHead')}</Text>
          {proposal.suggestions.map((suggestion) => {
            const title = frozen.tasks.find((task) => task.id === suggestion.id)?.title ?? suggestion.id;
            return (
              <View key={suggestion.id}>
                <HStack gap="tight" align="center">
                  <Chip
                    label={t(`web.ai.prioritize.priority.${priorityWord(suggestion.priority)}`)}
                    selected={kept[suggestion.id] === true}
                    onPress={() => {
                      setKept((previous) => ({ ...previous, [suggestion.id]: previous[suggestion.id] !== true }));
                    }}
                  />
                  <Text variant="row-title" grow numberOfLines={1}>
                    {title}
                  </Text>
                </HStack>
                {/* 理由不是数据（不进 op-log），但它必须可读 —— 否则用户是在盲勾。 */}
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {suggestion.reason}
                </Text>
              </View>
            );
          })}
          {proposal.truncated ? (
            <Text variant="caption" tone="warning">
              {t('web.ai.prioritize.truncated')}
            </Text>
          ) : null}
          <HStack gap="tight">
            <Button
              label={t('web.ai.prioritize.apply')}
              tone="primary"
              testID="prioritize-apply"
              disabled={Object.values(kept).every((value) => value !== true)}
              onPress={() => {
                void apply();
              }}
            />
            <Button
              label={t('web.ai.action.discard')}
              tone="ghost"
              onPress={() => {
                setPhase('input');
                setProposal(undefined);
              }}
            />
          </HStack>
        </Card>
      ) : null}
      {phase === 'sending' ? (
        <Text variant="row-meta" tone="subtle">
          {t('web.ai.loading.waiting')}
        </Text>
      ) : (
        <Button
          label={t('web.ai.prioritize.button')}
          tone="primary"
          testID="prioritize-start"
          disabled={props.tasks.length === 0 || props.route.target === undefined}
          onPress={() => {
            setFrozen({ tasks: props.tasks, now: Date.now() });
            setApplied(false);
            setPhase('disclose');
          }}
        />
      )}
    </Stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ④ 估时
// ─────────────────────────────────────────────────────────────────────────

function DurationPanel(props: SharedPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('input');
  const [frozen, setFrozen] = useState<{ taskId: string; title: string; note: string | undefined; now: number }>({
    taskId: '',
    title: '',
    note: undefined,
    now: 0,
  });
  const [proposal, setProposal] = useState<DurationProposal | undefined>(undefined);
  const [failure, setFailure] = useState<{ key: MessageKey; detail?: string } | undefined>(undefined);
  const [applied, setApplied] = useState(false);

  const source = { title: frozen.title, locale, ...(frozen.note === undefined ? {} : { note: frozen.note }) };
  const invocation = buildDurationInvocation(source, []);

  async function send(): Promise<void> {
    setPhase('sending');
    const outcome = await requestDuration(source, {
      routing: props.routing,
      consents: props.consents,
      routed: routedDeps(props.healthSnapshot),
    });
    props.persistHealth(outcome.health);
    if (outcome.ok) {
      setProposal(outcome.proposal);
      setPhase('proposal');
      return;
    }
    setFailure({
      key:
        outcome.cause !== undefined ? AI_CAUSE_KEY[outcome.cause] : DURATION_FAILURE_KEY[outcome.reason],
      detail: outcome.message,
    });
    setPhase('failed');
  }

  async function apply(): Promise<void> {
    if (props.actions === null || proposal === undefined) return;
    const task = props.tasks.find((row) => row.id === frozen.taskId);
    if (task === undefined) return;
    // 🔴 结果**写进备注**，不新增持久化字段（§3.3：加字段要产品先拍）。
    await props.actions.setNote(task.id, writeDurationIntoNote(task.note, proposal.minutes));
    setApplied(true);
    setPhase('input');
    setProposal(undefined);
  }

  if (phase === 'disclose') {
    return (
      <DisclosureStep
        feature="duration-estimate"
        target={props.route.target}
        fields={invocation.fields}
        consents={props.consents}
        routing={props.routing}
        testIdPrefix="duration-"
        onSend={() => {
          void send();
        }}
        onCancel={() => {
          setPhase('input');
        }}
      >
        <Text variant="row-meta">{t('web.ai.duration.basis.none')}</Text>
      </DisclosureStep>
    );
  }

  if (phase === 'failed' && failure !== undefined) {
    return (
      <FailureStep
        failure={failure}
        testIdPrefix="duration-"
        onRetry={() => {
          setPhase('disclose');
        }}
      />
    );
  }

  return (
    <Stack gap="loose">
      <TaskPicker
        tasks={props.tasks}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setApplied(false);
        }}
      />
      {applied ? (
        <Text variant="row-meta" tone="success">
          {t('web.ai.duration.applied')}
        </Text>
      ) : null}
      {phase === 'proposal' && proposal !== undefined ? (
        <Card gap="loose">
          <Text variant="row-title">{t('web.ai.duration.proposalLead')}</Text>
          <Text variant="numeric-body">{t('web.ai.duration.minutes', { minutes: String(proposal.minutes) })}</Text>
          {proposal.clamped ? (
            <Text variant="caption" tone="warning">
              {t('web.ai.duration.clamped')}
            </Text>
          ) : null}
          <HStack gap="tight">
            <Button
              label={t('web.ai.duration.apply')}
              tone="primary"
              testID="duration-apply"
              onPress={() => {
                void apply();
              }}
            />
            <Button
              label={t('web.ai.action.discard')}
              tone="ghost"
              onPress={() => {
                setPhase('input');
                setProposal(undefined);
              }}
            />
          </HStack>
        </Card>
      ) : null}
      {phase === 'sending' ? (
        <Text variant="row-meta" tone="subtle">
          {t('web.ai.loading.waiting')}
        </Text>
      ) : (
        <Button
          label={t('web.ai.duration.button')}
          tone="primary"
          testID="duration-start"
          disabled={selectedId === undefined || props.route.target === undefined}
          onPress={() => {
            const task = props.tasks.find((row) => row.id === selectedId);
            if (task === undefined) return;
            setFrozen({ taskId: task.id, title: task.title, note: task.note, now: Date.now() });
            setApplied(false);
            setPhase('disclose');
          }}
        />
      )}
    </Stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ⑤ 工具调用（单步 + 对话助手）
// ─────────────────────────────────────────────────────────────────────────

function ToolPanel(
  props: SharedPanelProps & { readonly toolHost: LocalApiHost | null; readonly tier: SharedTier },
): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [frozenText, setFrozenText] = useState('');
  /** `assistant = true` 走多轮循环；`false` 走单步（那条有"规则命中零出境"的短路）。 */
  const [assistantTurn, setAssistantTurn] = useState(false);
  const [toolOutcome, setToolOutcome] = useState<ToolCallOutcome | undefined>(undefined);
  const [assistantOutcome, setAssistantOutcome] = useState<AssistantOutcome | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<{ key: MessageKey; detail?: string } | undefined>(undefined);
  /** 本轮会话的历史（只活在这次挂载里，见文件头登记的差别）。 */
  const [history, setHistory] = useState<readonly { role: 'user' | 'assistant'; text: string }[]>([]);

  const grants = useAiSettings().localApi.grants;
  const invocation = buildToolCallInvocation({ text: frozenText }, toToolDescriptors(grants));
  const assistantPlan = planAssistantEgress(props.tier);
  const fields = assistantTurn ? assistantPlan.fields : invocation.fields;

  async function send(): Promise<void> {
    setPhase('sending');
    setConfirmed(undefined);
    if (props.toolHost === null) return;

    if (assistantTurn) {
      const outcome = await requestAssistantTurn(
        { text: frozenText },
        {
          routing: props.routing,
          consents: props.consents,
          tier: props.tier,
          host: props.toolHost,
          history,
          routed: routedDeps(props.healthSnapshot),
        },
      );
      props.persistHealth(outcome.health);
      setAssistantOutcome(outcome);
      if (!outcome.ok) {
        setFailure({ key: ASSISTANT_FAILURE_KEY[outcome.reason], detail: outcome.message });
        setPhase('failed');
        return;
      }
      setHistory((previous) => [...previous, ...outcome.appended]);
      setPhase('proposal');
      return;
    }

    const outcome = await requestToolCall(
      { text: frozenText },
      {
        routing: props.routing,
        consents: props.consents,
        grants,
        host: props.toolHost,
        routed: routedDeps(props.healthSnapshot),
      },
    );
    props.persistHealth(outcome.health);
    setToolOutcome(outcome);
    if (!outcome.ok) {
      setFailure({
        key: outcome.cause !== undefined ? AI_CAUSE_KEY[outcome.cause] : TOOL_CALL_FAILURE_KEY[outcome.reason],
        detail: outcome.message,
      });
      setPhase('failed');
      return;
    }
    setPhase('proposal');
  }

  async function confirm(): Promise<void> {
    const proposal =
      assistantOutcome !== undefined && assistantOutcome.ok && assistantOutcome.kind === 'proposal'
        ? assistantOutcome.proposal
        : toolOutcome?.ok === true && toolOutcome.result.kind === 'proposal'
          ? toolOutcome.result.proposal
          : undefined;
    if (props.toolHost === null || proposal === undefined) return;
    // 🔴 唯一能把提案变成写入的那一步，而它调的是 app-host 的
    // `confirmAiToolProposal()` —— `host.submit(` 在本壳里仍然一个都没有。
    const result = await confirmAiToolProposal(props.toolHost, proposal);
    setConfirmed(result.ok ? t('web.ai.tools.confirmedOk') : t('web.ai.tools.confirmedFail'));
    setPhase('input');
    setToolOutcome(undefined);
    setAssistantOutcome(undefined);
  }

  const pendingProposal =
    assistantOutcome !== undefined && assistantOutcome.ok && assistantOutcome.kind === 'proposal'
      ? assistantOutcome.proposal
      : toolOutcome?.ok === true && toolOutcome.result.kind === 'proposal'
        ? toolOutcome.result.proposal
        : undefined;

  if (phase === 'disclose') {
    return (
      <DisclosureStep
        feature="tool-calling"
        target={props.route.target}
        fields={fields}
        consents={props.consents}
        routing={props.routing}
        testIdPrefix="ai-tool-"
        onSend={() => {
          void send();
        }}
        onCancel={() => {
          setPhase('input');
        }}
      >
        {assistantTurn ? (
          <Text variant="caption" tone="subtle">
            {t('web.ai.assistant.maxRequests', { count: String(assistantPlan.maxRequests) })}
          </Text>
        ) : null}
      </DisclosureStep>
    );
  }

  if (phase === 'failed' && failure !== undefined) {
    return (
      <FailureStep
        failure={failure}
        testIdPrefix="ai-tool-"
        onRetry={() => {
          setPhase('disclose');
        }}
      />
    );
  }

  return (
    <Stack gap="loose">
      <TextField
        label={t('mobile.ai.input.tool')}
        value={text}
        multiline
        lines={2}
        onChangeText={setText}
        placeholder={t('web.ai.tools.placeholder')}
        testID="tool-input"
      />
      {confirmed !== undefined ? (
        <Text variant="row-meta" tone="success">
          {confirmed}
        </Text>
      ) : null}
      {phase === 'sending' ? (
        <Text variant="row-meta" tone="subtle">
          {t('web.ai.loading.waiting')}
        </Text>
      ) : (
        <HStack gap="tight">
          <Button
            label={t('web.ai.tools.run')}
            tone="primary"
            testID="tool-start-single"
            disabled={text.trim() === '' || props.route.target === undefined}
            onPress={() => {
              setAssistantTurn(false);
              setFrozenText(text);
              setPhase('disclose');
            }}
          />
          <Button
            label={t('web.ai.chat.send')}
            tone="secondary"
            testID="tool-start-assistant"
            disabled={text.trim() === '' || props.route.target === undefined}
            onPress={() => {
              setAssistantTurn(true);
              setFrozenText(text);
              setPhase('disclose');
            }}
          />
        </HStack>
      )}
      {phase === 'proposal' ? <ToolResultCard t={t} outcome={toolOutcome} assistant={assistantOutcome} /> : null}
      {pendingProposal !== undefined ? (
        <Card gap="loose">
          <Text variant="row-title">{t('web.ai.tools.proposalLead')}</Text>
          <Text variant="row-meta">{intentText(pendingProposal.intent, t)}</Text>
          <HStack gap="tight">
            <Button
              label={t('web.ai.tools.confirm')}
              tone="primary"
              testID="tool-confirm"
              onPress={() => {
                void confirm();
              }}
            />
            <Button
              label={t('web.ai.action.discard')}
              tone="danger"
              onPress={() => {
                setPhase('input');
                setToolOutcome(undefined);
                setAssistantOutcome(undefined);
              }}
            />
          </HStack>
        </Card>
      ) : null}
      <Text variant="caption" tone="subtle">
        {t('mobile.ai.tools.grantsHint', { max: String(MAX_TOOL_CALL_TEXT_LENGTH) })}
      </Text>
    </Stack>
  );
}

/** 单步与多轮的观察结果都渲染成一句"本机读到的"，原文作为诊断数据可复制。 */
function ToolResultCard({
  t,
  outcome,
  assistant,
}: {
  t: ReturnType<typeof useI18n>['t'];
  outcome: ToolCallOutcome | undefined;
  assistant: AssistantOutcome | undefined;
}): React.JSX.Element | null {
  if (assistant !== undefined && assistant.ok) {
    return (
      <Card gap="loose">
        <Text variant="row-title">{assistant.kind === 'answer' ? t('web.ai.chat.title') : t('web.ai.tools.resultAria')}</Text>
        <Text variant="row-meta" selectable>
          {assistant.text}
        </Text>
        {assistant.steps.length > 0 ? (
          <Text variant="caption" tone="subtle">
            {t('web.ai.chat.trace')}
            {assistant.steps.map((step) => `${step.tool}${step.ok ? '' : '✗'}`).join(' → ')}
          </Text>
        ) : null}
      </Card>
    );
  }
  if (outcome === undefined || !outcome.ok) return null;
  const result = outcome.result;
  if (result.kind === 'observation') {
    return (
      <Card gap="loose">
        <Text variant="row-title">{t('web.ai.tools.observationLead')}</Text>
        <Text variant="row-meta" selectable numberOfLines={6}>
          {JSON.stringify(result.data)}
        </Text>
        <Text variant="caption" tone="subtle">
          {outcome.via === 'rule' ? t('web.ai.tools.viaRule') : t('web.ai.tools.viaModel')}
        </Text>
      </Card>
    );
  }
  if (result.kind === 'denied') {
    return (
      <Text variant="row-meta" tone="warning" selectable>
        {t('web.ai.tools.deniedLead')}
        {result.message}
      </Text>
    );
  }
  if (result.kind === 'failed') {
    return (
      <Text variant="row-meta" tone="danger" selectable>
        {t('web.ai.tools.failedLead')}
        {result.message}
      </Text>
    );
  }
  if (result.kind === 'ambiguous') {
    return (
      <Text variant="row-meta" tone="muted">
        {t('web.ai.tools.ambiguousLead')}
        {result.candidates.map((candidate) => candidate.tool).join('、')}
      </Text>
    );
  }
  return null;
}

type SharedTier = ReturnType<typeof useAiSettings>['assistantTier'];
