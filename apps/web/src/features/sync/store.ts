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
  applyAuthToken: (baseUrl: string, token: string, email?: string) => void;
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
 * 🔴 W4：冷启动时把**已保存的凭据**读回来。
 *
 * 没有这一步，用户每次刷新都要重新登录一次 —— 而那让"完整旅程"不成立。
 * ⚠️ 只读 `baseUrl` 与 `token`；口令**永远**是 `undefined`（见 credential-storage.ts）。
 */
const persisted = loadCredentials();

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: { kind: 'idle' },
  baseUrl: persisted?.baseUrl ?? '',
  token: persisted?.token,
  email: persisted?.email,
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
    set({ baseUrl, token, password, status: { kind: 'idle' } });
    // 🔴 W4：口令**不进** saveCredentials 的参数 —— 它只在内存。
    // ⚠️ 邮箱**保留已有的那个**：手填凭据这条路径不知道账号是谁，
    //    而它不该把上一次登录留下的标签抹掉。
    if (baseUrl !== '' && token !== '') {
      saveCredentials({ baseUrl, token, email: get().email });
    }
    // 地址/令牌变了 ⇒ 实时连接必须跟着重建（见 restartRealtime 的说明）。
    restartRealtime(get);
  },

  applyAuthToken: (baseUrl, token, email) => {
    // 口令与上次同步时间原样保留 —— 见接口上的说明。
    //
    // ⚠️ `email` 是**可选**的：手填凭据那条路径没有邮箱，此时**保留已有的那个**
    //（`email ?? get().email`）—— 否则重新登录一次会把头像的标签抹掉。
    set({ baseUrl, token, email: email ?? get().email, status: { kind: 'idle' } });
    // 🔴 W4：登录成功即落盘 ⇒ "登录后重开还在"。
    saveCredentials({ baseUrl, token, email: email ?? get().email });
    // 🔴 登录之后才**开始**实时连接 —— 这是"实时同步"对用户真正生效的那一刻。
    restartRealtime(get);
  },

  startRealtime: () => {
    restartRealtime(get);
  },

  clearCredentials: () => {
    retry?.stop();
    retry = undefined;
    // 🔴 登出必须断开实时通道 —— 否则那个连接会**带着已失效的令牌**继续重连，
    // 而 realtime.ts 的退避会让它在后台一直撞（服务端的重连冷却正是为这种客户端准备的）。
    realtime?.dispose();
    realtime = undefined;
    set({ token: undefined, email: undefined, password: undefined, status: { kind: 'idle' } });
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
