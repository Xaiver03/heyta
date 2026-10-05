/**
 * AI 设置 —— 本地持久化
 * =======================
 *
 * 保存 AI 路由与本地 API 的**本机偏好**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两条硬性纪律，每一条都有 ADR 依据
 *
 * **① 不写 op-log、不参与同步**（ADR-0010 §6.1 / ADR-0011 §5）
 *
 * 这些是"这台设备怎么用 AI"的偏好，不是业务数据：
 * - 进了 op-log 就会被同步到其他设备，而**别的设备可能有完全不同的端点**
 *   （家里有 Ollama、公司没有）→ 同步过去就是把一台设备的配置强加给另一台
 * - 熔断状态、授权时间更是**本机**才有意义的
 *
 * 所以它走 `localStorage`，与主题（`lib/theme.ts`）同一个层次。
 *
 * **② 🔴 API key 绝不进 `localStorage`**（ADR-0005 §3.2.1 / ADR-0010 §3.6）
 *
 * `localStorage` 会被**任何同源脚本**读到（XSS 一次就全丢）。
 * 原生端有系统钥匙串可放；**Web 端没有钥匙串** —— 所以：
 *
 * - 端点的**非敏感部分**（地址、模型名、keyRef）进 `localStorage`
 * - **密钥本身只留在内存里**，且**只活在这个标签页**
 * - 关掉页面 = 密钥没了，用户需要重新输入
 *
 * 🔴 这不是"还没做好"，是 **Web 上 BYOK 在架构上就不牢**（ADR-0005 §3.2.2）。
 * UI 必须**明说**这一点，而不是让用户以为存下来了 ——
 * 后者会导致"下次打开发现要重输"被当成 bug 报上来。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { EMPTY_SECRET_STORE, type SecretStore } from '@heyta/ai';
import {
  createAiSettingsStore,
  defaultAiSettingsState,
  type AiSettingsState,
  type AiSettingsStorePort,
} from '@heyta/app-host';

export const AI_SETTINGS_STORAGE_KEY = 'heyta.ai.settings';

/**
 * 存进 `localStorage` 的形状。**注意这里没有密钥字段。**
 *
 * 🔴 它就是 `@heyta/app-host` 的那一份，**不再在本文件里重复声明**：
 * 字段与默认值是判断（"这台设备上那道闸关没关"），不是存储细节 ——
 * 移动壳接 AI 时必然要读同一个形状，两份类型各写一遍就是漂移的开始
 * （理由见 `packages/app-host/src/ai-settings-store.ts` 文件头）。
 */
export type PersistedAiSettings = AiSettingsState;

/** 再导出，保持既有调用点的名字不变。 */
export { defaultAiSettingsState as defaultAiSettings };

/**
 * Web 的通道：`localStorage` 上那块 JSON。
 *
 * 🔴 这里**只实现 `read` / `write`**。清洗（`enabled` 只认逐字 `true`、
 * 坏端点丢掉、`bindAddress` 永不从磁盘读、解析失败回到全关）在
 * `@heyta/app-host` 的 `createAiSettingsStore()` 里，**所有壳同一份**。
 *
 * ⚠️ 原先这四条住在下面这个文件里（`sanitizeRouting` / `sanitizeLocalApi` /
 * 一段手写三元）。它们被删掉了，不是被复制走的 —— 复制走就还是两份。
 */
function webStoragePort(): AiSettingsStorePort {
  return {
    read: () => {
      try {
        return localStorage.getItem(AI_SETTINGS_STORAGE_KEY) ?? undefined;
      } catch {
        // 隐私模式下 localStorage 会抛。契约是"取不到返回 undefined，不许抛"，
        // 而"取不到"的最安全结果是全关的默认值，不是崩掉。
        return undefined;
      }
    },
    write: (value) => {
      try {
        localStorage.setItem(AI_SETTINGS_STORAGE_KEY, value);
        return true;
      } catch {
        // 存不上就只在本会话生效（与 `theme.ts` 同一条降级策略）。
        return false;
      }
    },
  };
}

const webAiSettingsStore = createAiSettingsStore(webStoragePort());

/** 读取设置（清洗过的那份）。 */
export function loadAiSettings(): PersistedAiSettings {
  return webAiSettingsStore.load();
}

/**
 * 保存设置。
 *
 * ⚠️ 返回**是否真的落盘**。原先这里吞掉了写入失败（"不影响本次会话生效"），
 * 于是"改了设置但下次打开还是旧值"没有一处能说出口。调用方可以忽略返回值，
 * 但**界面要说的那句话现在有条件可判**了。
 */
export function saveAiSettings(settings: PersistedAiSettings): boolean {
  return webAiSettingsStore.save(settings);
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 会话级密钥
// ─────────────────────────────────────────────────────────────────────────

/**
 * 密钥的**会话级**存放处。
 *
 * 🔴 **只在内存里，只活在这个标签页。**
 *
 * 它不是"临时方案"，而是 Web 上**唯一诚实的做法**：
 * `localStorage` 会被任何同源脚本读到，而密钥能解开用户的全部数据
 * （对照 `features/sync/store.ts` 里对同步口令的同一处理）。
 *
 * 原生端会有真的钥匙串实现（`SecretStore` 端口），
 * 本文件在 Web 上**故意实现成内存**，并有测试断言
 * **密钥不会被写进 `localStorage`**。
 */
export interface SessionSecretStore extends SecretStore {
  /** 设置一个密钥。只存内存。 */
  set(keyRef: string, secret: string): void;
  /** 清空（用户点"忘记密钥"时）。 */
  clear(): void;
  /** 当前有哪些 keyRef 有值（**只返回引用名，不返回值**）。 */
  knownRefs(): readonly string[];
}

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
 * 给 UI 用的：Web 端密钥策略的一句话说明。
 *
 * 🔴 这句话**必须显示在密钥输入框旁边**。
 * 不说明的话，"下次打开要重输"会被当成 bug —— 而它其实是设计。
 *
 * ⚠️ 文案本身已经搬进词条表（`web.ai.settings.keyNotice`），由
 * `AiSettings.tsx` 渲染。**这里刻意不留一份字符串副本**：
 * 留副本就会漂移，而两份说明里只要有一份过期，用户看到的就是错的那份。
 * 本文件仍然登记在 `scripts/check-ui-language.mjs` 的 `migratedFiles` 里 ——
 * 登记不是为了这句话（门禁看不见跨行拼接），而是为了让**将来**在这个
 * 存储层文件里新写的硬编码文案立刻被拦下。
 */

/** Web 上没有钥匙串断言用的空 store（未配置任何密钥时）。 */
export const WEB_EMPTY_SECRET_STORE = EMPTY_SECRET_STORE;

/**
 * 供界面直接落盘熔断状态。
 *
 * ⚠️ 在 `aiStore` 里再导出一次，而不是让 `App.tsx` 自己去 `@heyta/ai` 拿 ——
 * "哪个键、什么格式"是存储层的事，界面不该知道。
 */
export { toHealthSnapshot } from '@heyta/ai';
