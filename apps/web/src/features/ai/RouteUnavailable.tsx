import { ICON_SIZE, cssVar } from '@heyta/design-system';
/**
 * 「这个功能现在没有路可走」的统一呈现
 * ======================================
 *
 * 四个 AI 面板的 `no-target` 分支都渲染**这一个组件**，理由与
 * `route-explanation.ts` 同源：同一件事两套实现一定会漂移，
 * 而这里漂移的后果是"四个功能对同一场故障说四种话"。
 *
 * 它做两件事：
 *   1. 说清**为什么**没有可用端点（词条来自 `RouteExplanation`）；
 *   2. 给一个**真的能点**的"去设置"—— 落在设置页对应的区块上。
 *
 * 🔴 它**只导航，不代授权**。授权只能经 `AiSettings` 已有的
 * `updateRouting` / `grant()` 路径写入；在 AI 面板里直接改 `consents`
 * 会造出第二套事实源 —— 那正是上一轮刚修掉的 bug 形状。
 */

import { AlertTriangle } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { text } from '../../lib/text.js';

import type { RouteExplanation, SettingsTarget } from './route-explanation.js';

/**
 * 哪些原因**再点一次就可能好**。
 *
 * 🔴 只有熔断。冷却到点之后重新解析，端点就会回到候选里；
 * 其余五条（远端闸关着 / 能力没声明 / 被停用 / 地址非法 / 端点不存在）
 * 再点一百次也还是同一句 —— 给它们配一个"重试"，就是在教用户做一件
 * **永远不会成功**的事，那比没有按钮更糟。
 *
 * ⚠️ 键的类型必须是 `RouteExplanation['reason']`，**不能**写成
 * `CandidateExclusionReason`：后者少了 `'unconfigured'` 与 `'unknown'`
 * 这两个只存在于解释层的取值，写成窄的那个会让下面 `.has(...)` 编译不过
 * （实测 `TS2345: Argument of type 'CandidateExclusionReason | "unconfigured" | "unknown"'`）。
 * 而 `vitest` 不做类型检查 —— 那个错误是单测全绿之后才被 `tsc -b` 抓到的。
 */
const RETRYABLE: ReadonlySet<RouteExplanation['reason']> = new Set(['circuit-open']);

export interface RouteUnavailableProps {
  explanation: RouteExplanation;
  /** 未传时不渲染按钮（例如单测里只关心文案）。 */
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
  /**
   * 重新解析一次路由（熔断冷却到点后的"再试一次"）。
   *
   * 未传、或原因不满足 `RETRYABLE` 时不渲染。
   */
  onRetry?: (() => void) | undefined;
  /** 沿用各面板已有的 `data-testid`（`ai-no-target` / `duration-no-target`…）。 */
  testId: string;
}

export function RouteUnavailable({
  explanation,
  onOpenSettings,
  onRetry,
  testId,
}: RouteUnavailableProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="ht-ai__warn" data-testid={testId} data-route-reason={explanation.reason}>
      <p className="ht-ai__warn-line">
        <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
        {t(explanation.key, explanation.params)}
      </p>
      {/* 🔴 只做导航：把用户送到能修它的那个控件前面，**不替他做决定**。 */}
      {onOpenSettings !== undefined && (
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid={`${testId}-settings`}
          onClick={() => onOpenSettings(explanation.settingsTarget)}
        >
          {t('web.ai.action.openSettings')}
        </button>
      )}
      {onRetry !== undefined && RETRYABLE.has(explanation.reason) && (
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
        >
          {t('web.ai.action.retry')}
        </button>
      )}
    </div>
  );
}

export interface FailureSettingsActionProps {
  /**
   * 来自 `AiFailureCopy.settingsTarget`。`undefined` = 设置里没有能修它的东西
   * （网络抖动、端点为空的响应……），此时**不渲染按钮**。
   */
  settingsTarget: SettingsTarget | undefined;
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
  /**
   * 来自 `AiFailureCopy.originHint`：**该加进端点白名单的那个 Origin 原文**。
   *
   * 🔴 **必填**（不是可选参数）：这个组件是五个 AI 面板共用的失败态渲染点，
   * 写成可选就会重演 `ai-failure-copy.ts` 文件头记着的那次漂移 ——
   * 四个入口改好了、第 5 个没人管，而没有任何测试会红。必填让五个调用点
   * 必须被编译器逐个改到。
   *
   * `undefined` = 这次失败与来源无关（真的网络抖动），此时**一个字都不渲染** ——
   * 给一次网络抖动附上"去把你的 Origin 加白名单"，是教用户做一个
   * 不需要做的安全决定。
   */
  originHint: string | undefined;
  testId: string;
}

/**
 * 失败态里的"下一步"。
 *
 * 与 `RouteUnavailable` 分开，是因为触发条件不同：那个只在"一个候选都没有"
 * 时渲染，这个只在"请求真的失败了、而且失败原因能在设置里修"时渲染。
 * 但两处**共用同一个 `SettingsTarget` 类型与同一份原因→目标的映射**
 * （`ai-failure-copy.ts`），所以它们不可能对同一场故障指向不同的地方。
 *
 * 🔴 现在它渲染两件事，顺序是**先给值、再给按钮**：
 *   1. 端点拒绝了宿主来源时，把**该放行的 Origin 原文**打出来（+ 一行说明）；
 *   2. "去设置"按钮 —— 落在端点区块，那里才放得下白名单这个控件。
 * 这两件事由**同一个诊断**触发（`settingsTargetFor` / `originHintFor` 都读
 * `diagnoseNetworkFailure` 的结果），所以不会出现"有按钮没有值"或反过来。
 *
 * ⚠️ 值是**数据不是文案**：原样渲染，不翻译、不去尾斜杠、不转小写 ——
 * 端点比对的是请求头里那个串，加工过的值复制过去是**用不了的**。
 * 所以它不进 i18n（标题与说明进），并与 `ErrorScreen` 的原始错误文本同一处置。
 */
export function FailureSettingsAction({
  settingsTarget,
  onOpenSettings,
  originHint,
  testId,
}: FailureSettingsActionProps): React.JSX.Element | null {
  const { t } = useI18n();

  // 按钮要"有落点"且"宿主给了导航"；值只要诊断成立就该出现 ——
  // 宿主没接 `onOpenSettings`（例如单测里）时，那句话仍然对用户有用。
  const showValue = originHint !== undefined;
  const showButton = settingsTarget !== undefined && onOpenSettings !== undefined;
  if (!showValue && !showButton) return null;

  return (
    <>
      {showValue && (
        <div
          className="ht-ai__note"
          data-testid="ai-failure-origin-hint"
          style={{ maxWidth: cssVar('layout.prose-max'), width: '100%' }}
        >
          <p style={{ ...text('panel-title'), margin: 0 }}>{t('web.ai.failure.originToAllow')}</p>
          {/* 🔴 原样显示的那个值：等宽 + 可选中（键盘/鼠标都能整段复制）。
              刻意不放进 `<details>` —— 它是这次失败的**结论**，不是诊断噪音。 */}
          <p
            data-testid="ai-failure-origin-value"
            style={{
              ...text('row-meta'),
              margin: 0,
              marginTop: cssVar('space.1'),
              fontFamily: cssVar('font.mono'),
              userSelect: 'text',
              overflowWrap: 'anywhere',
            }}
          >
            {originHint}
          </p>
          <p style={{ ...text('caption'), margin: 0, marginTop: cssVar('space.1') }}>
            {t('web.ai.failure.originToAllowNote')}
          </p>
        </div>
      )}
      {showButton && (
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid={testId}
          onClick={() => onOpenSettings(settingsTarget)}
        >
          {t('web.ai.action.openSettings')}
        </button>
      )}
    </>
  );
}
