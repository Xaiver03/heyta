/**
 * 同步状态 store
 * =================
 *
 * 界面必须能看出四种状态（计划 3.3 的判据）：
 * 已同步 / 同步中 / 冲突 / 离线。
 *
 * 🔴 **E2EE 口令绝不明文长期存储。**
 * localStorage 会被任何同源脚本读到，而口令能解开用户全部数据。
 * 这里只在内存里持有（可选"记住"时也只放 sessionStorage，
 * 关闭标签页即失效）。这是一个刻意的取舍：便利性让位于安全性。
 */

import { create } from 'zustand';

import { publishWidgetPlaceholders } from '../../pwa/publish.js';

import {
  applyRemoteOps,
  currentState,
  hasEngine,
  requireEngine,
  requireStore,
} from '../../lib/oplog.js';

import {
  createRetryScheduler,
  type ConflictInfo,
  type RealtimeClient,
  type SyncClient,
  type SyncStatus,
} from '@heyta/sync-client';
// 🔴 接线只有一份。见下方 `buildClient` 的说明。
import { createHostRealtimeClient, createSyncClient } from '@heyta/app-host';

// W4：凭据持久化。**只存 baseUrl 与 token，绝不存口令** —— 见该文件头。
import { clearStoredCredentials, loadCredentials, saveCredentials } from './credential-storage.js';
import { getWebVaultSession, invalidateWebVaultSession } from '../../lib/vault-session.js';

// 🔴 同意闸门（G-12）。这个文件**只**用它做两件事：给客户端注入带闸的 `fetch`，
// 以及在闸门关闭时不建实时通道。判定逻辑全在 `@heyta/app-host`。
import { consentFetch, privacyConsent, subscribePrivacyConsent } from '../privacy/consent-gate.js';
import {
  bindLegalRecheckCredentials,
  clearLegalRecheckCredentials,
  legalRecheck,
  syncLegalRecheckCredentials,
} from '../legal-recheck/gate.js';
import { requireLegalReconfirm } from '../legal-recheck/store.js';
import { requireNetworkConsent } from '../privacy/store.js';
// 🔴 G-27 的第二道闸：装配在 `legal-recheck/gate.ts`，界面状态在同目录的 `store.ts`，
// 判定本身在 `@heyta/app-host`。这里只用它们，不再长出一份。

interface SyncStoreState {
  status: SyncStatus;
  /** 服务端地址。空字符串 = 未配置。 */
  baseUrl: string;
  /** 访问令牌。和口令一样只放内存。 */
  token?: string;
  /**
   * 账号邮箱（头像的首字母靠它）。
   *
   * ⚠️ 它**不是**秘密，所以跟 `token` 一起落盘（见 `credential-storage.ts` 的说明）。
   * 未登录 / 老版本凭据里没有它时是 `undefined` —— 头像退回通用图标。
   */
  email?: string;
  /** Stable authenticated account id; presence selects vault encryption mode. */
  accountId?: string;
  /** E2EE 口令。**只在内存**。 */
  password?: string;
  /** 上次同步时间。 */
  lastSyncedAt?: number;
  /**
   * 冲突对话框是否打开。
   *
   * 🔴 **与 `status` 分开**，因为"有没有冲突"和"正在不正在看冲突"是两件事。
   * 我第一版让关闭对话框把 `status` 改回 `idle`，于是用户一按 Esc，
   * 冲突提示就整个消失了 —— 数据还卡在待上传队列里，
   * 但他再也找不到处理的入口，问题从"没法解决"变成"看不见了"，更糟。
   */
  conflictDialogOpen: boolean;
  /**
   * 同步设置对话框是否打开。
   *
   * 🔴 从 `SyncBar` 的局部 state **提到这里**，是因为现在有两个入口要打开它：
   * 同步条自己的齿轮，以及订阅提示的「改用你自己的服务器」。
   * 让两处各持一份 `open` state 就必然漂移（一处打开、另一处不知道），
   * 而这一条正是 `AGENTS.md §3.5` 反复记过的形状。
   */
  settingsOpen: boolean;
  /**
   * 注册 / 登录面板是否打开。
   *
   * 🔴 从 `SyncBar` 的局部 state **提到这里**（2026-09-29，产品负责人指出
   * "注册/登录该长在头像区，不该顶栏横一块大按钮"）：入口搬进 rail 顶部的
   * **账号区**（`AccountMenu`，未登录时它旁边出现紧凑入口），而面板本体
   * 仍渲染在 `SyncBar`（地址来源的语义都在那边）。触发者在 A、面板在 B，
   * 局部 state 就够不着了 —— 与 `settingsOpen` 同一条搬家理由。
   */
  signInOpen: boolean;

  openSignIn: () => void;
  closeSignIn: () => void;

  configure: (baseUrl: string, token: string, password: string) => void;
  /**
   * 认证成功后写回同步配置。
   *
   * 🔴 **只动 `baseUrl` 与 `token`。** 口令是用户在设置里另填的一件事，
   * 这里"顺手"把它清掉的话，症状是"登录明明成功了，同步却说自己没配置" ——
   * 而用户刚在上一屏把口令输进去过。所以它是一条**专门的、窄的**动作，
   * 而不是复用 `configure(baseUrl, token, '')`。
   */
  applyAuthToken: (baseUrl: string, token: string, email?: string, accountId?: string) => void;
  clearCredentials: () => void;
  syncNow: () => Promise<SyncStatus>;
  /**
   * 按**当前**凭据启动实时通道。幂等。
   *
   * 🔴 宿主必须在 **op-log 初始化之后**调一次：
   * 冷启动时 `baseUrl`/`token` 是从磁盘读回来的，而通道要拿 `engine.clientId`
   * 才会建连（`requireEngine()` 在引擎就绪前会抛）。
   * 不调的话症状是"**刷新页面之后就再也没有实时同步了**，而重新登录一次又能好" ——
   * 那是这类缺陷最难归因的形态。
   */
  startRealtime: () => void;
  /** 用户手动解决一处冲突。两个方向都走 op-log（重新派发），不直接改状态。 */
  resolveConflict: (
    conflict: ConflictInfo,
    choice: 'keep-local' | 'keep-remote',
  ) => Promise<SyncStatus>;
  openConflictDialog: () => void;
  closeConflictDialog: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  startAutoRetry: () => void;
  stopAutoRetry: () => void;
}

let retry: { start: () => void; stop: () => void } | undefined;

/**
 * 「没配置同步服务」的**错误码**。
 *
 * 🔴 这是个**数据值**，不是文案。这一条错误是我们自己产生的、而且用户能自己修好，
 * 所以它值得一条专门的词条（告诉用户"去填地址和令牌"），但句子属于壳 ——
 * 见 `SyncBar` 的 `describeSyncStatus`。store 里塞中文句子的话，
 * 英文界面会永远漏出一句中文（这正是本轮要修的缺陷）。
 */
// 🔴 原来这里有一个 `SYNC_NOT_CONFIGURED` 哨兵字符串塞在 `message` 里 ——
// 那是"类型里没有结构化原因"的绕路。`SyncStatus` 现在有 `reason` 了，
// 哨兵整个删掉：`message` 是字符串字段，拿它当码用没有任何类型保护。

/**
 * 游标读写**已删除**。
 *
 * 这里原先自己开第二个 `IndexedDbAdapter('heyta')` 去读 `meta` store ——
 * 既重复了 `OpLogStore` 已经提供的 `getLastServerSeq`/`setLastServerSeq`，
 * 又把「游标存在哪个键」这个知识复制了第二份。
 * 现在游标由 `requireStore()` 提供，键名只在 `packages/storage` 里定义一次。
 */

/**
 * 构造一个同步客户端。
 *
 * 🔴 **接线只有一份**，在 `@heyta/app-host` 的 `createSyncClient`。
 * 这里此前手写了全部 12 个回调 —— 与 `packages/app-host/src/host.ts`
 * 里那份**逐字相同，连注释都是复制的**。两套接线一定会漂移，
 * 而 `ids.ts` 已经记过一次同形状的事故。
 *
 * 现在宿主能决定的只剩真正的平台差异：
 * 地址、令牌、口令，以及「应用远端之后要不要通知 UI」。
 *
 * ⚠️ **每次重建，不缓存。** 缓存的话 configure() 改了地址/令牌后旧客户端
 * 还在用旧值 —— 而"令牌过期后同步一直失败"是最难排查的一类问题。
 */
function buildClient(
  get: () => SyncStoreState,
  _set: (partial: Partial<SyncStoreState>) => void,
): SyncClient | undefined {
  const { baseUrl, token } = get();
  if (baseUrl === '' || token === undefined) return undefined;

  const accountId = get().accountId;
  if (accountId !== undefined && accountId !== '') {
    return createSyncClient({
      engine: requireEngine(),
      store: requireStore(),
      baseUrl,
      getToken: async () => get().token,
      getPassword: async () => undefined,
      encryptionMode: 'vault',
      getPayloadCipher: async () => {
        const current = get();
        if (current.accountId === undefined || current.accountId === '') return undefined;
        const session = await getWebVaultSession(
          current.accountId,
          current.baseUrl,
          async () => get().token,
        );
        return session.getPayloadCipher();
      },
      applyRemote: applyRemoteOps,
      fetchImpl: consentFetch,
    });
  }

  return createSyncClient({
    engine: requireEngine(),
    store: requireStore(),
    baseUrl,
    getToken: async () => get().token,
    getPassword: async () => get().password,
    // 🔴 Web 宿主特有的那一步：应用完远端 op 必须通知订阅者。
    // 不通知的话数据到了、界面不动 —— 而原生宿主没有这层订阅，
    // 所以它是**注入项**而不是接线内部的固定行为。
    applyRemote: applyRemoteOps,
    /**
     * 🔴 带同意闸门的 `fetch`（G-12）。
     *
     * 这里**显式**传它，而不是只靠 `main.tsx` 换掉 `window.fetch`：
     * `SyncClient` 在构造时做 `options.fetchImpl ?? globalThis.fetch.bind(globalThis)`，
     * 只换全局的话这一层就变成"靠装配顺序成立"—— 而那正是本仓库反复记过的
     * "看起来在保护一件事，其实保护的是另一件"。两处都做，判据才能在**这一层**数得出次数。
     */
    fetchImpl: consentFetch,
  });
}

/* ========================================================================
 * 实时通道（WS）—— 补上 #10「实时多设备同步」的最后一米
 * ====================================================================== */

/**
 * 🔴 **`packages/sync-client/src/realtime.ts` 早就写完了，而宿主一行都没接。**
 * 这与本仓反复记过的形状完全一样："能力齐全、用户收不到"：
 * 服务端的 WS 广播、连接服务、快照通知都在，客户端也有 450 行
 * （指数退避 + 抖动 + 上限 + 令牌活取值），**但没有任何地方 `createRealtimeClient()`**。
 * 症状是"改了另一台设备要等很久才出现，而且看起来像同步坏了"。
 *
 * ## 这一层只做三件事
 *
 * 1. **拿真值建连**：`getToken` 是**活取值器**（用户是应用起来之后才填地址/令牌的，
 *    静态传一次的结果是"永远以未登录失败，而界面上只是看不到同步"）；
 *    `clientId` 取自引擎（LWW 的决胜依据，协议要求每个请求带上）。
 * 2. **把信号翻成一次普通同步**：`onNewOps` → `syncNow()`。
 *    🔴 契约见 `realtime.ts` 文件头：**这条通道只传"有新 op 了"，不传内容**，
 *    真正的 op 密文仍走 `/api/sync/ops`。不要顺手把内容搬进来。
 * 3. **合并并发**：`syncNow()` **没有**在途保护（它每次都会新建客户端并发请求），
 *    而服务端可能连续推。所以在途时**直接丢掉这一次信号**而不是排队 ——
 *    下一次推送会把状态带过来，排队只会把"几次变化"放大成"几次全量同步"。
 */
let realtime: RealtimeClient | undefined;
/** 在途同步标记（见上面第 3 条）。 */
let syncInFlight = false;

/**
 * 按**当前**凭据重建实时连接。
 *
 * ⚠️ **每次重建，不缓存**（与 `buildClient` 同一个理由）：
 * 缓存的话 configure() 改了地址/令牌后旧连接还在用旧值，
 * 而"令牌过期后实时一直连不上"是最难排查的一类问题。
 * `dispose()` 之后那个客户端**绝不再连**（realtime.ts 的既定语义）。
 */
function restartRealtime(get: () => SyncStoreState): void {
  realtime?.dispose();
  realtime = undefined;

  /**
   * 🔴 **闸门关闭就不连，而且这条必须排在 `dispose()` 之后**（G-12）。
   *
   * WebSocket 不经 `window.fetch`，所以带闸的那层 fetch 罩不到它 —— 这一处就是它唯一的闸。
   * 排在 dispose 之后是为了让**撤回同意**真的把连接断掉：先判后 dispose 的话，
   * 界面说"已撤回"而那条连接还挂着，那是比不撤回更坏的状态
   * （`privacy-consent.ts` 的 `revoke()` 写的是同一条纪律）。
   *
   * ⚠️ 全仓只有这一个 `createHostRealtimeClient()` 调用点（已 grep 确认），
   * 所以这一条闸对 WS 是**穷尽**的 —— 新增第二个构造点时必须同样调它。
   */
  if (!privacyConsent.networkAllowed()) return;

  // 🔴 G-27：账号还没补签 ⇒ 实时通道也不连。WS 本身只传"有新 op 了"的信号，
  // 但那个信号会触发 `syncNow()`，而它会被 `reconfirmGate()` 拦下 ——
  // 与其留一条"连着但每次都不干活"的通道，不如当场不建。
  // 补签完成后 `legalRecheck.subscribe()` 那个订阅者会按新状态重建。
  if (!legalRecheck.dataEgressAllowed()) return;

  const { baseUrl, token } = get();
  // 未配置/未登录就**不连**。登录之后再调一次本函数即可 ——
  // 这正是 `configure` / `applyAuthToken` 里两处调用的意义。
  if (baseUrl === '' || token === undefined) return;

  /**
   * 🔴 **先问"引擎就绪了吗"，而不是让 `requireEngine()` 抛了再 catch。**
   *
   * "还没初始化"是**正常状态**（冷启动早期，以及任何在 `initOpLog()` 之前
   * 调 `applyAuthToken()` 的路径）。用 try/catch 兜的话，那条 catch 分不清
   * "正常的还没就绪"与"真的接线坏了" —— 两者会打**同一句警告**，
   * 于是在日志里（以及 `check:journey-coverage` 的输出里）变成噪声，
   * 而**噪声里的警告等于没有警告**。
   *
   * ⚠️ 这也解释了为什么这里**不**在未就绪时排队等待：`main.tsx` 会在
   * `initOpLog()` 之后显式调一次 `startRealtime()`（冷启动那条路），
   * 所以"现在没连上"迟早会被补上，而在这里 sleep/重试只是多一条要维护的路径。
   */
  if (!hasEngine()) return;

  // 🔴 **实时是增强，不是功能前提。**
  //
  // `requireEngine()` 在 op-log 就绪前会抛，而本函数是从 `configure` /
  // `applyAuthToken` 里调的 —— 那两处分别是"用户填了凭据"与"用户刚登录成功"。
  // 让一次实时通道的接线问题把**登录**搞挂，是明确的错误优先级：
  // 没有实时同步时数据仍然是安全的（用户动作照样触发同步），
  // 而"登录点了没反应"是用户立刻看得见的坏。
  //
  // ⚠️ 但**不能静默**：失败要留痕，否则将来排查时完全看不出这里跑过。
  try {
    // 🔴 **走共享接线**（`@heyta/app-host` 的 `createHostRealtimeClient`）——
    // 与 `createSyncClient` 同一份文件、同一个 `clientId` 来源。
    // 这个文件头写过"接线只有一份，两套一定会漂移"，实时通道没有理由例外。
    realtime = createHostRealtimeClient({
      engine: requireEngine(),
      baseUrl,
      // 🔴 活取值器，不是当下的值。
      getToken: async () => get().token,
      onNewOps: () => {
        if (syncInFlight) return;
        syncInFlight = true;
        void get()
          .syncNow()
          .finally(() => {
            syncInFlight = false;
          });
      },
    });
    realtime.connect();
  } catch (error: unknown) {
    realtime = undefined;
    console.warn('[sync] 实时通道没能建立（不影响登录与手动同步）：', error);
  }
}

/**
 * 🔴 同意状态一变，实时通道**当场**按新闸门重建（G-12 的另一半）。
 *
 * 少了这一条会出两种静默失效，而且方向相反：
 *   · 用户在首启面板点「同意」→ 已经跑过的 `startRealtime()` 早就 return 了，
 *     **不重连的话他要刷新一次才有实时同步**（"这次好了下次又坏了"）；
 *   · 用户在设置页**撤回**→ 不重连的话那条 WS 会继续带着旧令牌重连，
 *     而界面上写的是"已撤回"。
 *
 * 为什么放在同步 store 而不是隐私面板：`realtime` 这个变量归本文件所有，
 * 让外部去 `dispose()` 它等于把所有权漏出去（同一个理由见上面的 `restartRealtime`）。
 */
subscribePrivacyConsent(() => {
  restartRealtime(() => useSyncStore.getState());
});

/**
 * 🔴 补签闸门（G-27）的**另一半**，与上面那条同形：答案回来时要当场重建。
 *
 * 少了它会出两种坏，方向相反：
 *   · 登录后那次询问还在路上 ⇒ `restartRealtime()` 停在 `checking` 直接 return，
 *     答案回来后**没人再叫它** ⇒ 这个账号直到刷新前都没有实时同步；
 *   · 用户在面板上点「我已读完并确认」⇒ 闸门放开，同样没人重连。
 *
 * ⚠️ 通知在 `checking` 这一次也会到达，于是**在途询问会先把连接断掉**。
 * 这不是浪费，是那条闸的语义：一次"结果还不知道"的重新裁决期间留一条活连接，
 * 等于留着它去触发一个必然被 `reconfirmGate()` 拦下的 `syncNow()` ——
 * 那正是上面注释里"连着但每次都不干活"的状态。询问一般在几百毫秒内落定，
 * 而触发的四个时机（冷启动、换地址、换令牌、点确认）本来就该重建连接。
 */
legalRecheck.subscribe(() => {
  restartRealtime(() => useSyncStore.getState());
});

/**
 * 🔴 W4：冷启动时把**已保存的凭据**读回来。
 *
 * 没有这一步，用户每次刷新都要重新登录一次 —— 而那让"完整旅程"不成立。
 * ⚠️ 只读 `baseUrl` 与 `token`；口令**永远**是 `undefined`（见 credential-storage.ts）。
 */
const persisted = loadCredentials();

// 🔴 G-27：冷启动就把落盘回来的凭据交给第二道闸（**只交值、不问**）。
// 问的时机在启动序列的 `arm()` —— 那之前设备级闸门多半还是关的，问了也是白问
// （而且那一问本身就是一个出站请求，正被 G-12 拦着）。
// 不交值则是另一种坏：`arm()` 来问的时候闸门手里没有令牌，直接判成 `anonymous`。
bindLegalRecheckCredentials({
  token: persisted?.token,
  baseUrl: persisted?.baseUrl ?? '',
});

/**
 * 用户**主动**发起一次出站动作时的那道闸（G-12）。
 *
 * 🔴 位置：**在真正会发请求的那一行之前，但在"本地配置齐不齐"那一项之后**。
 * 两条理由分别是：
 *   · 排在 `c.sync()` 之前 ⇒ 没同意时一个字节都出不去（这是 G-12 本身）。
 *   · 排在 `buildClient()` 之后 ⇒ 没配服务端的用户拿到的是 `not-configured`，
 *     不是 `consent-required`。读 baseUrl/token 是**纯本机**动作，不涉及出境，
 *     而"你还没配同步服务"对着一个什么都没配的人来说是真话、且可操作；
 *     反过来让他先去处理隐私面板，是在让他做一件此刻不必要的事。
 *     ⚠️ 这不等于他没有面板 —— 首启仍然会问（`shouldAskOnFirstLaunch`）。
 *
 * 单独一种 `consent-required` 的理由见 `packages/sync-client/src/client.ts`。
 *
 * @returns 被拦下时要写进 `status` 的那条错误（同时把面板弹起来）；放行时 `null`。
 */
function consentGate(): SyncStatus | null {
  if (requireNetworkConsent()) return null;
  return { kind: 'error', reason: 'consent-required', retryable: false };
}

/**
 * 🔴 **第二道闸：账号级补签（G-27）**。与上面那道**串联**，不是它的替身。
 *
 * 排在 `consentGate()` **之后**：设备级同意是更前置的事实（没同意时连这个请求
 * 都不该发出去，也就无从知道要不要补签），而且它的句子是"去作出隐私选择" ——
 * 让一个从没被问过的人先去处理账号条款，是在让他做一件此刻不必要的事。
 *
 * 判据用 `dataEgressAllowed()`，**不在这里重判 `phase`**：漏掉 `checking` 就是
 * "冷启动先把数据推出去、再收到要补签"，那道闸只剩弹个窗。
 *
 * 🔴 但先要 `await legalRecheck.settled()`。原来这里是同步判的，于是
 * "还没问到答案"被写成了 `legal-reconfirm-required`，界面上那句话是
 * "条款文本已经更新，而这个账号还没有重新确认" —— 而实测（自建栈真浏览器，
 * 全新设备登录后第一次点同步）服务端对同一账号已答 `needsReconfirm:false`，
 * 下载请求一个都没发，再点一次才同步成功。**既谎了，又拦住了一件本来该成的事。**
 * 等一问落定再判不是新增等待：那一问在登录时就已经发出去了，等的是同一个请求。
 */
async function reconfirmGate(): Promise<SyncStatus | null> {
  await legalRecheck.settled();
  if (requireLegalReconfirm()) return null;
  return { kind: 'error', reason: 'legal-reconfirm-required', retryable: false };
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: { kind: 'idle' },
  baseUrl: persisted?.baseUrl ?? '',
  token: persisted?.token,
  email: persisted?.email,
  accountId: persisted?.accountId,
  conflictDialogOpen: false,
  settingsOpen: false,
  signInOpen: false,

  openConflictDialog: () => {
    set({ conflictDialogOpen: true });
  },

  closeConflictDialog: () => {
    // 只关窗口，**不动 status** —— 冲突还在，SyncBar 仍会提示，还能再打开
    set({ conflictDialogOpen: false });
  },

  openSettings: () => {
    set({ settingsOpen: true });
  },

  closeSettings: () => {
    set({ settingsOpen: false });
  },

  openSignIn: () => {
    set({ signInOpen: true });
  },

  closeSignIn: () => {
    set({ signInOpen: false });
  },

  configure: (baseUrl, token, password) => {
    // A server/token edit changes the authentication binding. Fence any
    // in-flight vault load before the new credentials can be used.
    const previous = get();
    if (previous.baseUrl !== baseUrl || previous.token !== token) invalidateWebVaultSession();
    set({ baseUrl, token, password, status: { kind: 'idle' } });
    // 🔴 W4：口令**不进** saveCredentials 的参数 —— 它只在内存。
    // ⚠️ 邮箱**保留已有的那个**：手填凭据这条路径不知道账号是谁，
    //    而它不该把上一次登录留下的标签抹掉。
    if (baseUrl !== '' && token !== '') {
      saveCredentials({ baseUrl, token, email: get().email, accountId: get().accountId });
    }
    // 🔴 凭据变了 ⇒ 补签状态必须**重问**（上一个账号的答案不属于这个账号）。
    syncLegalRecheckCredentials({ token, baseUrl });
    // 地址/令牌变了 ⇒ 实时连接必须跟着重建（见 restartRealtime 的说明）。
    restartRealtime(get);
  },

  applyAuthToken: (baseUrl, token, email, accountId) => {
    invalidateWebVaultSession();
    // 口令与上次同步时间原样保留 —— 见接口上的说明。
    //
    // ⚠️ `email` 是**可选**的：手填凭据那条路径没有邮箱，此时**保留已有的那个**
    //（`email ?? get().email`）—— 否则重新登录一次会把头像的标签抹掉。
    set({
      baseUrl,
      token,
      email: email ?? get().email,
      accountId: accountId ?? get().accountId,
      status: { kind: 'idle' },
    });
    // 🔴 W4：登录成功即落盘 ⇒ "登录后重开还在"。
    saveCredentials({
      baseUrl,
      token,
      email: email ?? get().email,
      accountId: accountId ?? get().accountId,
    });
    // 🔴 登录后**先问补签状态，再**建实时连接（顺序有意义：`refresh()` 同步把闸门
    // 置成 `checking`，于是新连接不会在"还没问到答案"的窗口里建立起来）。
    // 答案回来后由 `legalRecheck.subscribe()` 重建，不需要这里等它。
    syncLegalRecheckCredentials({ token, baseUrl });
    // 🔴 登录之后才**开始**实时连接 —— 这是"实时同步"对用户真正生效的那一刻。
    restartRealtime(get);
  },

  startRealtime: () => {
    restartRealtime(get);
  },

  clearCredentials: () => {
    // Logout must not await/open the host or let a pending GET/loader install
    // a session after the token has been cleared.
    invalidateWebVaultSession();
    retry?.stop();
    retry = undefined;
    // 🔴 登出必须断开实时通道 —— 否则那个连接会**带着已失效的令牌**继续重连，
    // 而 realtime.ts 的退避会让它在后台一直撞（服务端的重连冷却正是为这种客户端准备的）。
    realtime?.dispose();
    realtime = undefined;
    // 🔴 G-27：登出要把补签状态一起清掉 —— 不许留着**上一个人**的版本与答案，
    // 否则下一个人（可能是另一次登录的另一个账号）会看到不相干的面板。
    clearLegalRecheckCredentials();
    set({
      token: undefined,
      email: undefined,
      accountId: undefined,
      password: undefined,
      status: { kind: 'idle' },
    });
    // 🔴 W4：登出必须把**落盘的那份**也清掉。
    // 只清内存的话，刷新一次令牌就"活"回来了 —— 用户以为登出了，其实没有。
    clearStoredCredentials();

    // 🔴 **登出必须同时把桌面的四款小组件置成占位态（决策 D6）。**
    //
    // 少了这一步，**组件会在用户已经登出之后继续显示他的任务** ——
    // 而这是这一类缺陷里最严重的一种：用户以为"我登出了"，屏幕上却还挂着
    // 他的任务标题。⚠️ 而且它**不会报错**、不会崩、看起来一切正常，
    // 只有"组件上的内容"与"用户的心智模型"不一致 —— 而那一处没有断言。
    //
    // ⚠️ **刻意不 `await`、也不让失败冒泡**：
    //    登出这个动作本身必须成功（用户点了就要生效），
    //    而推送占位只是它的一个副作用。`void` + `catch` 是有意的：
    //    原生/浏览器端推不动时，**用户仍然登出成功**，只是组件可能还挂着旧内容 ——
    //    那是一个可接受的降级，而"登出点了没反应"不是。
    // ⚠️ 但**不能静默**：失败要留痕，否则将来排查时完全看不出这里跑过。
    void publishWidgetPlaceholders().catch((error: unknown) => {
      console.warn('[widget] 登出后推送占位态失败（用户已登出，组件可能仍显示旧内容）：', error);
    });
  },

  syncNow: async () => {
    const c = buildClient(get, set);
    if (c === undefined) {
      const s: SyncStatus = {
        kind: 'error',
        reason: 'not-configured',
        retryable: false,
      };
      set({ status: s });
      return s;
    }

    const blocked = consentGate();
    if (blocked !== null) {
      set({ status: blocked });
      return blocked;
    }

    // 🔴 第二道闸（G-27）。两处出站动作都要过，一处理由见 `reconfirmGate()`。
    const reconfirm = await reconfirmGate();
    if (reconfirm !== null) {
      set({ status: reconfirm });
      return reconfirm;
    }

    const status = await c.sync((s) => {
      set({ status: s });
    });

    // 出现冲突就自动打开一次 —— 否则用户只会看到状态栏变了字，
    // 不知道需要自己去点一下
    if (status.kind === 'conflict') set({ conflictDialogOpen: true });
    if (status.kind === 'synced') set({ lastSyncedAt: status.at });
    return status;
  },

  resolveConflict: async (conflict, choice) => {
    const c = buildClient(get, set);
    if (c === undefined) {
      const s: SyncStatus = {
        kind: 'error',
        reason: 'not-configured',
        retryable: false,
      };
      set({ status: s });
      return s;
    }

    const blocked = consentGate();
    if (blocked !== null) {
      set({ status: blocked });
      return blocked;
    }

    // 🔴 第二道闸（G-27）。两处出站动作都要过，一处理由见 `reconfirmGate()`。
    const reconfirm = await reconfirmGate();
    if (reconfirm !== null) {
      set({ status: reconfirm });
      return reconfirm;
    }

    set({ status: { kind: 'syncing', phase: 'upload' } });
    const status = await c.resolveConflict(conflict, choice);

    // 解决完后把剩下的冲突（可能还有别的）一并反映到状态里
    set({ status });
    if (status.kind === 'synced') set({ lastSyncedAt: status.at });
    return status;
  },

  startAutoRetry: () => {
    retry ??= createRetryScheduler(() => get().syncNow());
    retry.start();
  },

  stopAutoRetry: () => {
    retry?.stop();
  },
}));

/**
 * ⚠️ 「状态 → 语义色」的映射**已经不在这里**。
 *
 * 它原来叫 `statusColorToken`，是 web 独有的一份；移动端另有一份
 * （`apps/mobile/src/sync/status-text.ts` 的 `statusTone`），
 * 而两份**三行对不上**（`offline` 一端警示一端中性、`syncing` 一端信息一端普通、
 * `conflict` 一端警示一端危险）—— 同一个状态在两端呈现成三种态度，
 * 且没有任何测试会红。
 *
 * 现在它是 `@heyta/ui` 的 `syncStatusSeverity` / `syncStatusColorToken`
 * （`packages/ui/src/sync/model.ts`，有单测）。store 只管状态，不管怎么画。
 */
