import { AppState } from 'react-native';
import {
  INBOUND_AUTOMATION_SYSTEM_PROMPT,
  startInboundWorkerLoop,
  type AppHost,
  type InboundAutomationHostOptions,
} from '@heyta/app-host';
import { readSyncConfig } from '../sync/config';
import { openTaskHost } from '../db/open-host';
import { getAiSettings, aiSecrets } from '../ai/settings-store';
import { publishInboundCycle, publishInboundReadiness } from './status';

/**
 * Foreground-only mobile worker. It deliberately does not create keys or
 * silently enable AI: the recipient key, worker registration, route and
 * egress consent must already exist. A locked Vault or missing registration
 * leaves the queue untouched for the next foreground attempt.
 */
export function startMobileInboundWorker(): () => void {
  let stopped = false;
  let host: AppHost | undefined;
  let binding = '';
  let options: InboundAutomationHostOptions | undefined;
  const processOnce = async (): Promise<void> => {
    if (stopped || AppState.currentState !== 'active') return;
    const config = readSyncConfig();
    if (config === undefined || !config.accountId?.trim() || !config.serverUrl.trim() || !config.token) {
      publishInboundReadiness('signedOut');
      return;
    }
    try {
      host ??= await openTaskHost();
      const currentBinding = `${config.accountId}\u0000${config.serverUrl}\u0000${host.clientId}`;
      if (binding !== currentBinding) {
        binding = currentBinding;
        // The client id is persisted inside this SQLite database. Using it as
        // the database epoch makes replacement of the database revoke the old
        // worker while keeping foreground restarts idempotent.
        await host.registerInboundWorker({ userId: config.accountId, databaseEpoch: `mobile-${host.clientId}` });
      }
      const recipient = await host.getInboundRecipientRegistration();
      // 🔴 没有密钥就什么都收不了，而这件事以前**没人说**：直接 return 的话，界面只是
      // 安静着，用户分不清"这台还没准备好"和"准备好了但没有新内容"。现在把原因交出去。
      if (recipient === undefined) {
        publishInboundReadiness('noRecipientKey');
        return;
      }
      publishInboundReadiness('ready');
      const ai = getAiSettings();
      options = {
        userId: config.accountId,
        keyEpoch: recipient.keyEpoch,
        allowedFields: ['title'],
        routing: ai.routing,
        consents: ai.consents,
        secretStore: aiSecrets,
        systemPrompt: INBOUND_AUTOMATION_SYSTEM_PROMPT,
        parseVersion: 1,
      };
      publishInboundCycle(await host.processInboundAutomation(options));
    } catch {
      // A failed foreground pass is recoverable: the server lease fences any
      // partial attempt and the next focus/tick retries the same event.
      binding = '';
    }
  };
  const loop = startInboundWorkerLoop({
    intervalMs: 20_000,
    isRunnable: () => !stopped && AppState.currentState === 'active',
    processOnce,
    onError: () => undefined,
  });
  const wake = (): void => { void loop.wake(); };
  const focus = AppState.addEventListener('change', (state) => { if (state === 'active') wake(); });
  wake();
  return () => { stopped = true; focus.remove(); loop(); host = undefined; options = undefined; };
}
