/**
 * 移动端的 AI 设置通道 + 会话级密钥
 * =================================
 *
 * 🔴 这里**没有判断**，只有通道。四道闸的 fail-closed 清洗、出厂默认、
 * "哪些字段不许从磁盘读"全在 `@heyta/app-host` 的 `createAiSettingsStore()`
 * （AGENTS.md §3.5：默认值与归一方向决定"这一次模型能不能改用户的数据"，
 * 那是产品语义；每个壳各写一遍就会漂，而且**没有任何一层会报错**）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两条硬性纪律，与 web 侧 `features/settings/aiStore.ts` 逐字同源
 *
 * **① 不写 op-log、不参与同步**（ADR-0010 §6.1 / ADR-0011 §5）。
 * 这些是"**这台设备**怎么用 AI"的偏好：家里有 Ollama、公司没有，
 * 同步过去就是把一台设备的配置强加给另一台。熔断状态、授权时间同理。
 * 所以它走 `prefs/device-prefs.ts` 那块**设备本地**偏好库
 * —— 那里已经是"永不进同步"的先例（`welcome.hasSeen`）。
 *
 * **② API key 绝不落盘。**
 * web 的理由是"`localStorage` 会被任何同源脚本读到"；原生端**有**钥匙串，
 * 但接它要先解决三件事：iOS Keychain / Android Keystore 的两套访问组与
 * 解锁语义、E2EE root key 那套 `vault-secure-storage.ts` 已经占用的条目命名、
 * 以及"模型密钥算不算要随登出清除的秘密"这个产品判断。
 * 在这一刀之前它们都没有被拍过，所以本端与 web 走**同一条诚实的降级**：
 * 密钥只活在这一次会话的内存里，界面上必须明说（词条 `mobile.ai.keyNotice`），
 * 而不是让用户以为存下来了 —— 后者会把"下次打开要重输"变成没人解释得清的 bug。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useSyncExternalStore } from 'react';
import type { SecretStore } from '@heyta/ai';
import {
  createAiSettingsStore,
  defaultAiSettingsState,
  type AiSettingsState,
  type AiSettingsStorePort,
} from '@heyta/app-host';
import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/** 设备偏好库里的键名。与 web 的 `heyta.ai.settings` 同名，跨端读得出同一件事。 */
export const AI_SETTINGS_PREF_KEY = 'heyta.ai.settings';

/** 壳侧的通道：一行 SQLite 文本。**读写都不许抛**（契约见 app-host 的端口注释）。 */
const mobilePort: AiSettingsStorePort = {
  read: () => readDevicePref(AI_SETTINGS_PREF_KEY),
  write: (value) => writeDevicePref(AI_SETTINGS_PREF_KEY, value),
};

const store = createAiSettingsStore(mobilePort);

let current: AiSettingsState = store.load();

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 订阅"AI 设置变了"。返回退订函数。 */
export function subscribeAiSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前那份设置（内存里的，已清洗）。 */
export function getAiSettings(): AiSettingsState {
  return current;
}

/** React 侧读取。与 `sync/store.ts` 同一个取向：不引状态库。 */
export function useAiSettings(): AiSettingsState {
  return useSyncExternalStore(subscribeAiSettings, getAiSettings);
}

/**
 * 写入一份新设置并落盘。
 *
 * @returns **是否真的落盘**。`false` = 本次会话生效、重启回到旧值 ——
 * 界面必须把这句说出来，不能静默假装成功（`writeDevicePref` 的返回值
 * 就是为这件事存在的，`App.tsx` 里欢迎页那条注释记着同一个理由）。
 */
export function saveAiSettings(next: AiSettingsState): boolean {
  // 🔴 **先替换内存、再落盘**，且落盘失败**不回滚**：
  // 用户在界面上改完立刻生效（这是本地优先），而"存不上"是另一件事 ——
  // 回滚会让界面跳回旧值，读成"我刚才那一下没点上"，比"没记住"更难解释。
  current = next;
  notify();
  return store.save(next);
}

/** 从磁盘重读（冷启动之外一般不需要；测试与"清库后重建"用）。 */
export function reloadAiSettings(): AiSettingsState {
  current = store.load();
  notify();
  return current;
}

/**
 * 这台设备**有没有**配 AI：总开关开 + 至少一个端点。
 *
 * 只决定助手里的配置提示，不控制入口是否可见。
 * 未配置端点仍可查询本机任务；模型请求继续经过出境与联网授权。
 */
export function isAiConfiguredOnThisDevice(settings: AiSettingsState = current): boolean {
  return settings.routing.enabled && settings.routing.endpoints.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// 会话级密钥（见文件头纪律 ②）
// ─────────────────────────────────────────────────────────────────────────

export interface SessionSecretStore extends SecretStore {
  set(keyRef: string, secret: string): void;
  clear(): void;
  /** 只返回**引用名**，不返回任何密钥内容。 */
  knownRefs(): readonly string[];
}

/**
 * 内存里的密钥表。
 *
 * 🔴 它**不是**"还没做持久化"，而是这一版刻意只做到这里：
 * 不落盘 = 不泄漏，代价是每次冷启动要重输。界面上必须明说
 * （`mobile.ai.keyNotice`），否则用户把它当 bug 报上来。
 */
export function createSessionSecretStore(): SessionSecretStore {
  const secrets = new Map<string, string>();
  return {
    get: (keyRef) => Promise.resolve(secrets.get(keyRef)),
    set: (keyRef, secret) => {
      secrets.set(keyRef, secret);
    },
    clear: () => {
      secrets.clear();
    },
    knownRefs: () => [...secrets.keys()],
  };
}

/**
 * 本壳**唯一**的密钥实例。
 *
 * 单例是必须的：设置面写进去、面板读不出来，表现是"配了密钥仍然 401"，
 * 而两个 store 各自都是合法的 —— 没有任何一层会报错。
 */
export const aiSecrets = createSessionSecretStore();

/** 出厂默认（"退回全关"这个动作要有一个不猜的出处）。 */
export function defaultMobileAiSettings(): AiSettingsState {
  return defaultAiSettingsState();
}
