/**
 * 结构化 AI 工具（拆解 / 排序 / 估时）在移动端的**装配缝**。
 *
 * 三个面板（`AiBreakdown` / `AiPrioritize` / `AiDuration`）都只是把
 * `packages/app-host` 的 `request*()` 接到手指上的那一层 —— 业务规则留在
 * `packages/app-host`，这里只负责把移动端的活取值器接上去（与
 * `AssistantScreen` 顶部的 `resolveRouting` / `managedTransport` 同一套姿势）。
 *
 * 🔴 为什么装配收在一处：三个面板各读一次路由 / 各拼一次托管端点，
 * 就会出现"某一面用的是落盘那份（没有托管端点）"的漂移 —— 选托管的人只在那
 * 一面上得到 `no-route`，而另外两面正常。收在一个 hook 里，三面必然一致。
 */

import { useMemo } from 'react';

import { toHealthSnapshot, withManagedEndpoint } from '@heyta/ai';
import type {
  AiHealthSnapshot,
  AiRoutingConfig,
  EgressConsent,
  HealthMap,
  SecretStore,
} from '@heyta/ai';
import { createManagedTransport } from '@heyta/app-host';

import { readSyncConfig } from '../sync/config';
import { aiSecrets, getAiSettings, saveAiSettings, useAiSettings } from './settings-store';

/**
 * 托管档的宿主通道 —— 组装只有一份（`createManagedTransport`），
 * 三个面板共用这一个实例。取值器是**活取值器**：用户可能起来之后才填地址/令牌。
 */
export const toolboxManagedTransport = createManagedTransport({
  getServerUrl: () => readSyncConfig()?.serverUrl,
  getToken: async () => readSyncConfig()?.token,
});

/** 三个面板共同需要的一整套依赖。 */
export interface ToolboxDeps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  healthSnapshot: AiHealthSnapshot;
}

/**
 * 现算依赖（挂到 `useAiSettings` 上，设置一改三面一起更新）。
 *
 * `withManagedEndpoint` 与 `resolveRouting()`（AssistantScreen）同一条理由：
 * 落盘的 routing 里**没有**托管端点，拿它去调 `invokeRouted` 会让选托管的人
 * 得到 `no-route`。这里每次渲染合成一次，代价是一次本地存储读。
 */
export function useToolboxDeps(): ToolboxDeps {
  const settings = useAiSettings();
  const routing = useMemo(
    () => withManagedEndpoint(settings.routing, readSyncConfig()?.serverUrl),
    [settings.routing],
  );
  return {
    routing,
    consents: settings.consents,
    secrets: aiSecrets,
    healthSnapshot: settings.health,
  };
}

/**
 * 熔断状态落盘 —— 与 `AssistantScreen` 的 `persistHealth` 同法。
 * 成功失败都要写：失败那次通常正是熔断计数刚 +1 的那一次。
 */
export function persistToolboxHealth(health: HealthMap): void {
  const live = getAiSettings();
  saveAiSettings({ ...live, health: toHealthSnapshot(health, Date.now()) });
}
