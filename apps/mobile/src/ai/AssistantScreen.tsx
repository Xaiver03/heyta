/** Mobile's single conversational assistant surface. */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { applyScrollIntent, AssistantMark, shouldFollowOnContentChange } from '@heyta/ui';
import { inferPreferences, renderPreferenceHints } from '@heyta/domain';
import {
  assistantEgressFields,
  createAssistantHistoryAccountResolver,
  createLocalApiHost,
  createTaskActions,
  planAssistantEgress,
  resolveAiRoute,
  type AiRouteTarget,
  type AiToolProposal,
  type ChatItem,
  type AppHost,
  createManagedTransport,
} from '@heyta/app-host';
import {
  authorizeEgress,
  buildDisclosure,
  fromHealthSnapshot,
  toHealthSnapshot,
  withManagedEndpoint,
  type AiRoutingConfig,
  type HealthMap,
} from '@heyta/ai';
import type { LocalApiHost, LocalApiWriteResult } from '@heyta/local-api';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { useTokens } from '../theme';
import { Button, Card, Chip, EmptyState, HStack, Screen, Stack, Text } from '../ui/kit';
import { useTaskHost } from '../db/use-task-host';
import { useMobileNavigation } from '../nav/navigation';
import { readSyncConfig } from '../sync/config';
import { AiDisclosureBlock } from './disclosure';
import { ASSISTANT_FAILURE_KEY, AI_CAUSE_KEY, AI_FEATURE_LABEL_KEY, SERVER_CODE_KEY } from './copy';
import { privacyConsent } from '../privacy/consent-gate';
import { createGatedStreamingFetch } from './streaming-fetch';
import { ChatComposer } from './chat-composer';
import {
  createChatController,
  mobileAssistantController,
  type ChatController,
  type ChatRuntime,
} from './chat-controller';
import { ChatTranscript, type ChatTranscriptItem } from './chat-transcript';
import { intentText } from './intent-copy';
import { getAiSettings, isAiConfiguredOnThisDevice, saveAiSettings, useAiSettings, aiSecrets } from './settings-store';
import { useMobileSync } from '../sync/store';

const resolveHistoryAccount = createAssistantHistoryAccountResolver();

/**
 * 托管档的宿主通道 —— **组装只有一份**（`packages/app-host` 的 `createManagedTransport`），
 * 这里只负责接上移动端的同步配置。两个取值器都是**活取值器**
 * （照 `legal-recheck/gate.ts` 那条先例：用户是应用起来之后才填地址/令牌的）。
 */
const managedTransport = createManagedTransport({
  getServerUrl: () => readSyncConfig()?.serverUrl,
  getToken: async () => readSyncConfig()?.token,
});

/**
 * **流式**传输 —— 让助手的回答逐字出现，而不是整段蹦出来。
 *
 * ## 为什么需要单独一个 fetch
 *
 * RN 的 `fetch` 由 XHR 实现、**整份收完才返回**，响应上没有可读 `body`；
 * 而 `packages/ai` 判"能不能按 SSE 读"的第三条正是它（`routing.ts:1290`）。
 * 于是移动端一直只能"整段回来再显示"。
 *
 * 这个实现用 RN 内置 `XMLHttpRequest` 在 `readyState === 3` 时读**累积**的
 * `responseText`，切成增量后包成 `routing.ts` 认得的形状。
 *
 * ## 🔴 为什么必须包闸门、且组装在这里
 *
 * `createGatedStreamingFetch(privacyConsent, …)` 把
 * `createConsentGatedFetch`（`privacy-consent.ts:311`，"没有同意，一个字节都
 * 不出这台设备"）套在 XHR 传输的**外面**。顺序是硬约束 ——
 * 自己 `new XMLHttpRequest()` 而不套闸门就是一处隐私破口。
 *
 * 组装放在壳里（与 `managedTransport` 同一形状），控制器只消费注入进来的
 * `streamingFetch`。理由有两条：① `check:layering` 要求"决定业务上怎么做"
 * 的东西只在 `packages/*`；② 注入进来才测得动。
 *
 * ## 为什么敢接（判据不是"应该没问题"）
 *
 * RN 0.84.1 的 `Libraries/Network/XMLHttpRequest.js` 里读出来的三条：
 *   · `:557-558` 增量事件默认**关闭**，只有挂了 `onreadystatechange` 或
 *     `onprogress` 才开 —— 我们的实现挂了 `onreadystatechange` ⇒ **会被开启**；
 *   · `:621` 那个标志确实传给原生 `sendRequest`；
 *   · `:375-386` `__didReceiveIncrementalData` 做的是 `this._response += responseText`
 *     ⇒ `responseText` **是累积的** ⇒ 我们那份 `diffAccumulated` 是必需的，
 *     不做差分一定重复。
 *
 * ## 退化方向（这条是产品要求，不是可选项）
 *
 * 任何一步不合预期都退回"整段显示"而**不是报错**：
 *   · XHR 不可用（某些测试环境）⇒ 非流式；
 *   · `content-type` 不是 `text/event-stream` ⇒ 按整份读；
 *   · 拿到的不是"旧文本 + 新增"的超集 ⇒ 放弃增量，按整份读。
 * 用户最差拿到的是一份完整回答，只是没有逐字。
 */
const streamingFetch = createGatedStreamingFetch(privacyConsent);

/**
 * **发送那一刻**现算的路由配置（见 `ChatRuntime.resolveRouting` 的注释）。
 *
 * 🔴 它与 `settings.routing` 的区别就是托管档能不能用：落盘的那一份里
 * **没有**托管端点（那条端点由 `withManagedEndpoint` 从同步服务器合成），
 * 所以拿落盘那份去调 `invokeRouted`，选托管的人只会得到 `no-route`。
 *
 * ⚠️ 每次调用都读一次同步配置 —— 那是**同步的本地存储读**，而这一次调用的
 * 代价远小于一次网络往返；缓存它反而会让"刚登录完就用"落进旧值。
 */
const resolveRouting = (): AiRoutingConfig =>
  withManagedEndpoint(getAiSettings().routing, readSyncConfig()?.serverUrl);

export function AssistantScreen({
  onBack,
  visible = true,
  onOpenSettings,
  onOpenPrivacy,
  controller = mobileAssistantController,
}: {
  onBack: () => void;
  visible?: boolean;
  onOpenSettings?: () => void;
  onOpenPrivacy?: () => void;
  /** Test and host injection seam; the default controller survives settings navigation. */
  controller?: ChatController;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const navigation = useMobileNavigation();
  const settings = useAiSettings();
  const syncConfig = readSyncConfig();
  // Manual tokens have no verified account identity. Never reuse an old email
  // label or a shared "unidentified" history slot across those sessions.
  // The resolver retains the session across settings remounts, only in memory.
  const account = resolveHistoryAccount(syncConfig === undefined ? undefined : {
    serverUrl: syncConfig.serverUrl,
    accountId: syncConfig.accountId,
    token: syncConfig.token,
  });
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
  // 🔴 走钩子取宿主：本机数据被销毁后（主动注销 / 别的设备注销）宿主会换代，
  // 这个钩子自动重取；原来的一次性 effect 在换代后会让本屏永久拿着已作废的
  // adapter（崩溃审计 §H.4 第 2 层）。
  const { host } = useTaskHost({ onError: (message) => setHostError(message) });
  const [hostError, setHostError] = useState<string>();
  const transcriptRef = useRef<ScrollView>(null);
  const keyboardFrameRef = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    controller.syncAccount(account);
  }, [account, controller]);

  
  /**
   * 同步状态 —— 只为了**在服务器地址变化后重新算一次披露**。
   * 见下面 `route` 那条 memo 的依赖注释：AI 设置不会因为登录而变，
   * 不挂这个订阅，刚登录完回到助手会拿到一份"按没配服务器算"的预览。
   */
  const sync = useMobileSync();

  const toolHost = useMemo<LocalApiHost | null>(
    () => (host === null ? null : createToolHost(host, settings.memoryEnabled)),
    [host, settings.memoryEnabled],
  );
  const persistHealth = (health: HealthMap): void => {
    const live = getAiSettings();
    saveAiSettings({ ...live, health: toHealthSnapshot(health, Date.now()) });
  };
  const runtime = useMemo<ChatRuntime>(
    () => ({
      settings,
      host: toolHost,
      secretStore: aiSecrets,
      managedTransport,
      /**
       * 🔴 接上流式 ⇒ 助手的回答逐字出现。见模块顶部 `streamingFetch` 的注释
       * （含"为什么敢接"的三条 RN 源码判据与退化方向）。
       */
      streamingFetch,
      // 🔴 现算的那一份（不是 `settings.routing`）—— 见模块顶部 `resolveRouting` 的注释。
      resolveRouting,
      localize: (key, vars) => t(key as MessageKey, vars),
      onHealth: persistHealth,
    }),
    [settings, t, toolHost],
  );
  useEffect(() => {
    controller.configure(runtime);
  }, [controller, runtime]);

  /**
   * 是否跟随最新内容（流式期间自动滚到底）。
   *
   * 🔴 用 ref 而不是 state：每收到一个 scroll 事件都要读它，而绝大多数事件
   * 不改变它。用 state 会让每次滚动都可能触发重渲染 —— 那正是"滚动时卡顿"
   * 的经典成因。判据在 `@heyta/ui` 的 `shouldFollowOnContentChange`
   * （纯函数、两端共用、有独立测试）。
   */
  const followRef = useRef(true);

  /**
   * 🔴 依赖数组里有 `live?.text`：这是**流式跟随**的关键。
   *
   * 改之前是 `[snapshot.items.length, snapshot.phase]` —— 两者都只在
   * "一轮开始/结束"时变，于是**流式期间新到的字一个都不会触发滚动**：
   * 回答长过一屏之后，用户只能眼看着文字在屏幕外继续生成。
   * 这与 web 端 `AssistantPanel.tsx` 修的是**同一个缺口**。
   *
   * ⚠️ 用 `live?.text` 而不是 `live`（对象）：后者每个事件都是新对象，
   * 会让 effect 每片都跑一次；而 effect 里要做的只是"滚到底"，
   * 文本没变就不必滚。
   */
  const liveText = snapshot.live?.text;
  useEffect(() => {
    if (snapshot.items.length === 0 && (liveText === undefined || liveText === '')) return;
    if (!shouldFollowOnContentChange(followRef.current)) return;
    transcriptRef.current?.scrollToEnd({ animated: true });
  }, [snapshot.items.length, snapshot.phase, liveText]);

  useEffect(() => {
    if (!visible) return undefined;
    const handler = (): boolean => {
      if (snapshot.phase === 'running') return true;
      if (snapshot.phase === 'disclose') { controller.cancelDisclosure(); return true; }
      onBack();
      return true;
    };
    navigation.setBackHandler(handler);
    return () => navigation.setBackHandler(null);
  }, [controller, navigation, onBack, snapshot.phase, visible]);

  /**
   * 披露预览读的也必须是**现算的那一份**。
   *
   * 🔴 用落盘的 `settings.routing` 会造出一种最坏的错位：**界面说"没有可用的路"，
   * 而实际发送能成功**（或反过来）。用户纠正不了 —— 他看不到任何配置能改。
   *
   * ⚠️ `sync.status` 进依赖是必需的：服务器地址是用户**应用起来之后**才填的，
   * 而 AI 设置那一刻不会变。不挂这个依赖，刚登录完回到助手，
   * 预览仍然按"没配服务器"算 —— 而 `resolveRouting()` 明明已经能拿到地址。
   */
  const route = useMemo(
    () =>
      resolveAiRoute(resolveRouting(), 'tool-calling', {
        health: fromHealthSnapshot(settings.health, snapshot.routeTime),
      }),
    [settings.health, settings.routing, snapshot.routeTime, sync.status],
  );
  const plan = planAssistantEgress();
  const configured = isAiConfiguredOnThisDevice(settings);

  /**
   * 进行中那一轮的**已完成部分**（`items`）与 `renderItems` 的映射。
   * 流式未完成的那一段由下面的 `liveItems` 追加 —— 两者拼起来才是屏幕上该有的顺序。
   */
  const renderItems = snapshot.items.map<ChatTranscriptItem>((entry) => {
    const privacyBlocked = entry.role === 'error' && entry.message.includes('privacy-consent-not-granted');
    const detail =
      entry.role === 'error'
        ? privacyBlocked ? t('mobile.ai.privacyBlocked.hint') : entry.message
        : entry.role === 'assistant' && entry.steps.length > 0
          ? t('web.ai.chat.trace', { n: entry.steps.length })
          : undefined;
    return {
      id: entry.id,
      role: entry.role,
      // 🔴 **原因码优先**（`AI_CAUSE_KEY`），面板级那张粗码表只在**没有原因码**时兜底。
      //    这是 rig45 那条修复（2026-10-06）：旧多模式面的六处失败落点里五处写了
      //    `outcome.cause !== undefined ? AI_CAUSE_KEY[cause] : 面板表[reason]`，只有助手那
      //    一处直接查了面板表 —— 于是闸门拒绝（`cause='consent-not-granted'`）被印成
      //    「AI 服务暂时不可用。」，而 heyta 的 AI 是用户自己填端点（BYOK），没有这么一回事：
      //    **界面在说谎**。
      //    ⚠️ main 侧重写 `d49f77e3` 把那一代界面连同这处修复一起换掉了，于是这一处又退回成
      //    "直接查粗码表"（`AI_CAUSE_KEY` 在 `apps/mobile/src` 里一度**零消费者**）——
      //    2026-10-16 按老口径搬回来。判据 = `check:mobile-ai-anchors` 的 ㉕。
      text:
        entry.role === 'error'
          ? t(
              privacyBlocked
                ? 'mobile.ai.privacyBlocked.title'
                : // 🔴 **服务端稳定码最优先**：`402 SUBSCRIPTION_REQUIRED`（去买）与
                  // `409 AI_QUOTA_EXCEEDED`（等下一周期）在失败词表里**都落进 `http-error`**，
                  // 按下面那条 `cause` 取词条会把这两件事说成同一句 —— 而修复动作相反。
                  // 服务端既然给了码，就按码说话。
                  entry.serverCode !== undefined && SERVER_CODE_KEY[entry.serverCode] !== undefined
                  ? (SERVER_CODE_KEY[entry.serverCode] as MessageKey)
                  : entry.cause !== undefined
                    ? AI_CAUSE_KEY[entry.cause]
                    : ASSISTANT_FAILURE_KEY[entry.reason],
            )
          : entry.text,
      detail,
      proposal: entry.role === 'proposal' ? (
        <ProposalCard
          proposal={entry.proposal}
          confirmed={entry.confirmed}
          error={snapshot.proposalErrors[entry.id]}
          expired={entry.expired === true}
          disabled={snapshot.phase !== 'idle'}
          expanded={snapshot.expandedEntry === entry.id}
          onToggle={() => controller.toggleExpandedEntry(entry.id)}
          onConfirm={() => controller.confirmProposal(entry.id)}
        />
      ) : undefined,
      action: entry.role === 'error' ? (
        <Stack gap="tight">
          {privacyBlocked && onOpenPrivacy !== undefined ? (
            <Button label={t('mobile.ai.privacyBlocked.action')} tone="ghost" onPress={onOpenPrivacy} />
          ) : null}
          <Button label={t('web.ai.action.retry')} tone="ghost" onPress={() => controller.retry(entry.id)} />
          {entry.cause === 'egress-not-authorized' && onOpenSettings !== undefined ? (
            <Button label={t('mobile.ai.goSettings')} tone="ghost" onPress={onOpenSettings} />
          ) : null}
        </Stack>
      ) : undefined,
    };
  });

  /**
   * 进行中那一轮（流式）—— **列表里的最后一项**，不是另一个区块。
   *
   * 🔴 它在屏幕上必须与最终那条回答占**同一个位置**，否则一轮结束时
   * 会先"跳走"再"出现"，而用户刚读完的正是被跳走的那段。
   * （web 版 `AssistantPanel.tsx` 的 `ai-chat-live` 是同一条判断。）
   *
   * ⚠️ 拼进 `items` 数组而不是改 `ChatTranscript`：后者要适配一个新的
   * "进行中"状态，而它现在只认 `role`。追加一项的代价小得多，
   * 且顺序天然正确（列表末尾 = 最新）。
   *
   * ⚠️ 移动端**目前多半拿不到流式**：RN 的 `fetch` 响应没有可读 body，
   * `routing.ts` 会退回整份读取，于是 `live` 一直是 `undefined`、
   * 这里什么都不加（界面走的还是老路）。真正让它有值需要
   * `streaming-fetch.ts` 那条 XHR 通道接上 —— 见那里的"未接线"说明。
   */
  const liveItems: ChatTranscriptItem[] =
    snapshot.live !== undefined && snapshot.live.text !== ''
      ? [
          {
            id: 'live',
            role: 'assistant',
            text: snapshot.live.text,
            /**
             * 🔴 标成"还在生成" ⇒ 正文末尾画光标。
             *
             * 判据用 `live` 存在（它在 `finally` 里被清成 undefined），
             * 而不是"文本长度有没有变" —— 那需要在渲染体里记住上一帧，
             * 而这里已经有更准的信号：**live 还在 = 这一轮还没结束**。
             */
            streaming: true,
            /**
             * 🔴 过程行（工具调用）也显示出来，与 web 的 `TraceRows` 同一语义：
             * "过程可见"（ADR-0045）说的是用户能看到它查了什么。
             * 只给条数而不给内容的话，这一项就与最终那条重复了。
             */
            detail:
              snapshot.live.rows.length > 0
                ? snapshot.live.rows
                    .map((row) => `${row.tool}${row.ok === false ? ' ✗' : ''}`)
                    .join(' · ')
                : undefined,
          },
        ]
      : [];

  if (hostError !== undefined) {
    return (
      <Screen title={t('mobile.ai.title')} titleLeading={<AssistantMark size={tokens['icon.md']} color={tokens['color.foreground']} />} actions={[{ icon: 'action.back', label: t('mobile.ai.back'), onPress: onBack }]}>
        <EmptyState icon="conflict.warning" title={t('mobile.ai.hostFailed.title')} hint={t('mobile.ai.hostFailed.hint')} detail={hostError} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('mobile.ai.title')}
      titleLeading={<AssistantMark size={tokens['icon.md']} color={tokens['color.foreground']} />}
      scroll={false}
      bottomInset={false}
      actions={[
        { icon: 'assistant.new-session', label: t('web.ai.chat.newSession'), testID: 'assistant-new-session', disabled: snapshot.phase !== 'idle', onPress: () => controller.newSession() },
        { icon: 'action.back', label: t('mobile.ai.back'), testID: 'assistant-back', disabled: snapshot.phase === 'running', onPress: () => snapshot.phase === 'disclose' ? controller.cancelDisclosure() : onBack() },
      ]}
    >
      <View
        ref={keyboardFrameRef}
        collapsable={false}
        style={{ flex: 1 }}
        onLayout={() => keyboardFrameRef.current?.measureInWindow((_x, y) => setKeyboardOffset(y))}
      >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        keyboardVerticalOffset={keyboardOffset}
        // MainActivity declares adjustResize, but Android 16 enforces
        // edge-to-edge: while the IME is visible the activity frame remains
        // the full 1080x2400 viewport with zero visible insets. Leaving the
        // Android behavior undefined therefore leaves the composer underneath
        // the keyboard. Height avoidance uses the keyboard event directly;
        // iOS keeps its previously verified padding path and measured offset.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View testID="assistant-screen" style={{ flex: 1, paddingBottom: tokens['space.2'] }}>
          {!configured ? (
            <HStack gap="tight" align="center">
              <Text variant="caption" tone="subtle" style={{ flex: 1 }}>{t('mobile.ai.notConfigured')}</Text>
              {onOpenSettings !== undefined ? <Button label={t('mobile.ai.goSettings')} tone="ghost" onPress={onOpenSettings} /> : null}
            </HStack>
          ) : null}
          <HStack gap="tight" align="center" style={{ flexWrap: 'wrap' }}>
            <Button label={t('web.ai.chat.history.open')} tone="ghost" onPress={() => controller.toggleHistory()} testID="assistant-history" />
          </HStack>
          {snapshot.historyOpen ? (
            <Card gap="tight">
              <Text variant="row-title">{t('web.ai.chat.history.title')}</Text>
              <Text variant="caption" tone="subtle">{t('web.ai.chat.history.current')}</Text>
              <Button label={t('web.ai.chat.newSession')} tone="ghost" disabled={snapshot.phase !== 'idle'} onPress={() => controller.newSession()} />
            </Card>
          ) : null}
          <ScrollView
            ref={transcriptRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: tokens['space.3'], paddingVertical: tokens['space.3'] }}
            keyboardShouldPersistTaps="handled"
            testID="assistant-transcript"
            /**
             * 🔴 用户滚离底部 ⇒ 停止跟随。
             *
             * 这条挡的是"用户往上翻历史时被流式内容拽回底部" —— 那是最容易
             * 被误当成"它就爱跳"的一类缺陷，而代码里只有一句看起来无害的
             * "滚到底"。
             *
             * 判据复用共享层的 `applyScrollIntent`（纯函数、有独立测试），
             * 两端同一套规则。RN 与 DOM 的几何字段不同，所以这里做一次映射：
             *   DOM: scrollTop / scrollHeight / clientHeight
             *   RN : contentOffset.y / contentSize.height / layoutMeasurement.height
             */
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const decision = applyScrollIntent(followRef.current, {
                offset: contentOffset.y,
                contentHeight: contentSize.height,
                viewportHeight: layoutMeasurement.height,
              });
              followRef.current = decision.follow;
            }}
            scrollEventThrottle={16}
          >
            <ChatTranscript
              items={[...renderItems, ...liveItems]}
              generatedLabel={t('common.ai.generatedLabel')}
              empty={
                <Stack gap="tight">
                  <Text variant="section-title">{t('web.ai.chat.greeting')}</Text>
                  <Text variant="row-meta" tone="subtle">{t('web.ai.chat.greetingHint')}</Text>
                  <HStack gap="tight" style={{ flexWrap: 'wrap' }}>
                    {(['today', 'capture', 'summary', 'plan'] as const).map((suggestion) => (
                      <Chip tone="quiet" key={suggestion} label={t(`web.ai.chat.suggestion.${suggestion}.label`)} onPress={() => controller.setDraft(t(`web.ai.chat.suggestion.${suggestion}`))} />
                    ))}
                  </HStack>
                </Stack>
              }
            />
            {snapshot.phase === 'disclose' ? <DisclosureCard target={route.target} plan={plan} consents={settings.consents} onConfirm={() => controller.confirmDisclosure()} onCancel={() => controller.cancelDisclosure()} onOpenSettings={onOpenSettings} /> : null}
          </ScrollView>
          <ChatComposer value={snapshot.draft} onChangeText={(value) => controller.setDraft(value)} onSubmit={() => controller.send()} disabled={snapshot.phase !== 'idle' || toolHost === null} busy={snapshot.phase === 'running'} />
          <Text variant="caption" tone="subtle" style={{ paddingBottom: tokens['space.2'] }}>{t('web.ai.chat.disclaimer')}</Text>
        </View>
      </KeyboardAvoidingView>
      </View>
    </Screen>
  );
}

function createToolHost(host: AppHost, memoryEnabled: boolean): LocalApiHost {
  return createLocalApiHost(
    { dispatch: host.dispatch, getState: host.getState },
    createTaskActions(host),
    {
      isReadable: () => true,
      memoryEnabled,
      getDurationPreferenceHints: () => {
        if (memoryEnabled !== true) return [];
        const state = host.getState();
        const preferences = inferPreferences({
          memoryEnabled: true,
          tasks: Object.values(state.tasks),
          focusSessions: Object.values(state.focusSessions),
          now: Date.now(),
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
        });
        return renderPreferenceHints(preferences, 'duration-estimate')
          .map(({ id, text }) => ({ id, text }));
      },
    },
  );
}

function ProposalCard({ proposal, confirmed, error, expired, expanded, disabled, onToggle, onConfirm }: { proposal: AiToolProposal; confirmed: LocalApiWriteResult | undefined; error?: string; expired: boolean; expanded: boolean; disabled: boolean; onToggle: () => void; onConfirm: () => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  return (
    <Stack gap="tight">
      <Text variant="caption" tone="warning">{t('web.ai.tools.proposalLead')}</Text>
      <Text variant="row-meta">{intentText(proposal.intent, (key, vars) => t(key, vars), locale)}</Text>
      <Button label={t('web.ai.chat.fieldsTitle')} tone="ghost" onPress={onToggle} />
      {expanded ? <Text variant="caption" tone="subtle" selectable>{proposal.tool}</Text> : null}
      {error !== undefined ? <Text variant="caption" tone="danger">{t('web.ai.tools.confirmedFail', { message: error })}</Text> : null}
      {confirmed !== undefined ? <Text variant="caption" tone={confirmed.ok ? 'success' : 'danger'}>{confirmed.ok ? t('web.ai.tools.confirmedOk') : t('web.ai.tools.confirmedFail', { message: confirmed.message })}</Text> : null}
      {confirmed === undefined && !expired ? <Button label={t('web.ai.tools.confirm')} tone="primary" onPress={onConfirm} disabled={disabled} testID="assistant-confirm-proposal" /> : null}
      {expired ? <Text variant="caption" tone="warning">{t('web.ai.chat.expiredProposal')}</Text> : null}
    </Stack>
  );
}

function DisclosureCard({ target, plan, consents, onConfirm, onCancel, onOpenSettings }: { target: AiRouteTarget | undefined; plan: ReturnType<typeof planAssistantEgress>; consents: ReturnType<typeof useAiSettings>['consents']; onConfirm: () => void; onCancel: () => void; onOpenSettings?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  if (target === undefined) {
    return (
      <Stack gap="tight">
        <Text variant="row-meta" tone="subtle">{t('mobile.ai.needsSetup')}</Text>
        <HStack gap="tight" style={{ flexWrap: 'wrap' }}>
          {onOpenSettings !== undefined ? <Button label={t('mobile.ai.goSettings')} tone="ghost" onPress={onOpenSettings} /> : null}
          <Button label={t('web.ai.action.cancel')} tone="ghost" onPress={onCancel} />
        </HStack>
      </Stack>
    );
  }
  const fields = assistantEgressFields();
  // 🔴 「出境的是哪个功能」只在这一处取字面量：闸门、披露块与同意提示**同源**。
  //    三处各写一遍 `'tool-calling'` 的话，改了一处就会让提示念着别的功能。
  const feature = 'tool-calling' as const;
  const disclosure = buildDisclosure({ feature, destination: target.destination, fields });
  const decision = authorizeEgress({ feature, destination: target.destination, fields }, consents as Parameters<typeof authorizeEgress>[1]);
  return <Stack gap="tight" testID="assistant-disclosure"><AiDisclosureBlock testIdPrefix="assistant-" target={target} fields={fields} retentionDisclosure={disclosure.retentionDisclosure}><Text variant="caption" tone="subtle">{t('web.ai.chat.limits', { requests: plan.maxRequests, messages: plan.maxMessages, bytes: plan.maxBytesPerRequest })}</Text></AiDisclosureBlock>{!decision.allowed ? <Text variant="caption" tone="warning">{t('web.ai.settings.consentLead', { feature: t(AI_FEATURE_LABEL_KEY[feature]) })}</Text> : null}<HStack gap="tight"><Button label={t('web.ai.action.send')} tone="primary" onPress={onConfirm} testID="assistant-disclosure-send" /><Button label={t('web.ai.action.cancel')} tone="ghost" onPress={onCancel} /></HStack></Stack>;
}
