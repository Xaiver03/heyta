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

import type { RouteExplanation, SettingsTarget } from './route-explanation.js';

export interface RouteUnavailableProps {
  explanation: RouteExplanation;
  /** 未传时不渲染按钮（例如单测里只关心文案）。 */
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
  /** 沿用各面板已有的 `data-testid`（`ai-no-target` / `duration-no-target`…）。 */
  testId: string;
}

export function RouteUnavailable({
  explanation,
  onOpenSettings,
  testId,
}: RouteUnavailableProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="ht-ai__warn" data-testid={testId} data-route-reason={explanation.reason}>
      <p className="ht-ai__warn-line">
        <AlertTriangle size={12} aria-hidden="true" />
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
    </div>
  );
}

export interface FailureSettingsActionProps {
  /**
   * 来自 `AiFailureCopy.settingsTarget`。`undefined` = 设置里没有能修它的东西
   * （网络抖动、端点为空的响应……），此时**不渲染任何东西**。
   */
  settingsTarget: SettingsTarget | undefined;
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
  testId: string;
}

/**
 * 失败态里的"去设置"。
 *
 * 与 `RouteUnavailable` 分开，是因为触发条件不同：那个只在"一个候选都没有"
 * 时渲染，这个只在"请求真的失败了、而且失败原因能在设置里修"时渲染。
 * 但两处**共用同一个 `SettingsTarget` 类型与同一份原因→目标的映射**
 * （`ai-failure-copy.ts`），所以它们不可能对同一场故障指向不同的地方。
 */
export function FailureSettingsAction({
  settingsTarget,
  onOpenSettings,
  testId,
}: FailureSettingsActionProps): React.JSX.Element | null {
  const { t } = useI18n();
  if (settingsTarget === undefined || onOpenSettings === undefined) return null;

  return (
    <button
      type="button"
      className="ht-btn ht-btn--ghost"
      data-testid={testId}
      onClick={() => onOpenSettings(settingsTarget)}
    >
      {t('web.ai.action.openSettings')}
    </button>
  );
}
