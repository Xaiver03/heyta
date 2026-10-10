/**
 * 设置页的「隐私同意」面板 —— **撤回同意的那个入口**
 * ====================================================
 *
 * ## 它补的是哪一条
 *
 * PIPL 第 15 条：个人有权撤回同意，且"**应当提供便捷的撤回同意的方式**"。
 * 同意面板（`features/privacy/PrivacyConsentSheet.tsx`）解决的是"要问"，
 * 本面板解决的是"要能改回来"。只做前半件事等于把用户的一次点击变成永久决定 ——
 * 那种同意在法务上站不住（撤回比同意难做 = 默认项被锁死了）。
 *
 * ## 🔴 为什么这里**不复制**一套同意状态
 *
 * 状态只有一份，在 `privacyConsent` 那道闸里（`consent-gate.ts`）。
 * 本面板读它、订阅它，**不往 store 里再存一份"同意了吗"**：
 * 存了就出现第二个事实源，而两处不一致时的症状恰好是
 * "界面上说已撤回、请求照发"（那是比不撤回更坏的状态）。
 *
 * ## 撤回之后为什么还留一个「重新作出选择」
 *
 * `revoke()` 把状态清回"没问过"，界面上那条**闸门关闭的说明**不能变成死胡同：
 * 用户改主意的动作也得有一个入口，否则第 15 条只满足了前半句。
 */

import { useEffect, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { formatPrivacyDecisionTime, type PrivacyConsentRecord } from '@heyta/app-host';

import { privacyConsent, privacyConsentActions, readPrivacyConsentPersistence, subscribePrivacyConsent } from '../privacy/consent-gate.js';
import { usePrivacyStore } from '../privacy/store.js';
import { SettingsNotice } from './SettingsNotice.js';
import './privacy-settings.css';

export function PrivacyPanel({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useI18n();

  /**
   * 订阅那道闸，而不是挂载时读一次。
   *
   * 🔴 为什么必须订阅：点「撤回」之后本面板要**当场**改口。
   * 只读一次的话，症状是"按钮按下去了、字没变"，而闸门其实已经关了 ——
   * 界面与事实不一致，正是这一类缺陷最难查的形状。
   */
  const [record, setRecord] = useState<PrivacyConsentRecord | null>(() => privacyConsent.current());
  const [consentNotPersisted, setConsentNotPersisted] = useState(() => !readPrivacyConsentPersistence());

  useEffect(() => {
    if (!active) return undefined;
    setRecord(privacyConsent.current());
    // 隐藏期间不订阅，恢复时读取最后一次真实保存回执；切换页面不能抹去失败。
    setConsentNotPersisted(!readPrivacyConsentPersistence());
    return subscribePrivacyConsent(({ persisted }) => {
      setRecord(privacyConsent.current());
      // 只有新的决定确实写入设备后，才清掉上一条失败提示；再次失败时保留提示。
      setConsentNotPersisted(!persisted);
    });
  }, [active]);

  const stateKey =
    record === null
      ? 'common.privacy.settings.undecided'
      : record.decision === 'accepted'
        ? 'common.privacy.settings.accepted'
        : 'common.privacy.settings.localOnly';

  return (
    <section className="ht-settings privacy-settings" data-testid="privacy-panel" aria-labelledby="privacy-settings-title">
      <h2 id="privacy-settings-title" className="ht-settings__title ht-type-section-title">{t('common.privacy.settings.title')}</h2>

      <fieldset className="privacy-settings__fieldset" aria-labelledby="privacy-status-title">
        <legend id="privacy-status-title" className="privacy-settings__legend">{t('common.privacy.settings.statusTitle')}</legend>
        <p className="privacy-settings__hint">{t('common.privacy.settings.statusHint')}</p>
        <SettingsNotice
          title={t(stateKey)}
          tone={record === null ? 'warning' : record.decision === 'accepted' ? 'success' : 'info'}
          testId="privacy-state"
        >
          {record === null ? null : t('common.privacy.settings.decidedAt', {
            time: formatPrivacyDecisionTime(record.decidedAt),
          })}
        </SettingsNotice>
      </fieldset>

      <fieldset className="privacy-settings__fieldset" aria-labelledby="privacy-action-title">
        <legend id="privacy-action-title" className="privacy-settings__legend">{t('common.privacy.settings.actionTitle')}</legend>
        <p className="privacy-settings__hint">{t(record?.decision === 'accepted' ? 'common.privacy.settings.revokeHint' : 'common.privacy.settings.chooseHint')}</p>
        <div className="privacy-settings__actions">
          {record?.decision !== 'accepted' ? (
            // 尚未同意联网（包括明确只用本机）：把同意面板再打开一次。
            // ⚠️ 这里开的是**同一张**面板，不是第二份"同意界面"（AGENTS §3.5）。
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="privacy-choose-again"
              onClick={() => usePrivacyStore.getState().openSheet('settings')}
            >
              {t('common.privacy.settings.chooseAgain')}
            </button>
          ) : (
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="privacy-revoke"
              onClick={() => privacyConsentActions.revoke()}
            >
              {t('common.privacy.settings.revoke')}
            </button>
          )}
        </div>

        {/* 撤回没能落盘时必须说出口：会话闸门已关，但下次冷启动仍会再问。 */}
        {consentNotPersisted ? (
          <SettingsNotice tone="warning" live testId="privacy-revoke-not-persisted" title={t('common.privacy.consent.notPersisted')} />
        ) : null}
      </fieldset>
    </section>
  );
}
