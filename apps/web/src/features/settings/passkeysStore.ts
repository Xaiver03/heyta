/**
 * 通行密钥自助管理 store（Web 壳）
 * ================================
 *
 * 服务端此前只有注册 / 登录 / 恢复三组端点，用户**没有任何办法看到自己
 * 还有哪些凭据、也没法删掉一条已知丢失/泄露的**。恢复流程是"注册新凭据 +
 * 删掉全部旧凭据"的全量覆盖，不是管理。这个 store 是补上的那一半的**状态一侧**。
 *
 * ## 职责边界（AGENTS.md §3.5）
 *
 * 这里**不做协议判断**，也不做产品判断：
 *   - 打哪个端点、带什么令牌、失败怎么归类 —— `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "最后一条能不能删" —— **服务端**说了算（403/409 那个码）；
 *   - 用户看到的句子 —— 界面按结构化 `reason` 取词条。
 * 本文件只负责"什么时候调用一次"以及把结果放进 state。
 *
 * ## 🔴 删除后列表以**服务端**为准，不做本地减法
 *
 * 删成功后重新拉一次列表，而不是从本地数组里 `filter` 掉。理由：本地减法
 * 会在"这条其实已经被别的设备删掉了"时显示出一个服务端并不存在的世界，
 * 而用户下一步操作就基于那个错的世界。重拉一次是最便宜的真相。
 */

import { create } from 'zustand';

import {
  beginPasskeyEnrollment,
  completePasskeyEnrollment,
  deletePasskey,
  listPasskeys,
  type HostedAuthFailureReason,
  type HostedPasskeySummary,
} from '@heyta/app-host';

import {
  createPasskeyCredential,
  detectPasskeyBrowser,
  type PasskeyBrowser,
} from '../auth/passkey-browser.js';

/**
 * 列表状态。
 *
 * 🔴 `loaded` 与 `failed` 是**两种不同的世界**：前者可以放心画"还没有凭据"，
 * 后者不行 —— 把加载失败画成空列表，用户会以为自己刚丢光了所有凭据。
 */
export type PasskeysStatus =
  /** 还没有加载过（未登录时停留在这里）。 */
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; passkeys: HostedPasskeySummary[] }
  | { kind: 'failed'; reason: HostedAuthFailureReason };

export interface PasskeysStoreState {
  status: PasskeysStatus;
  /** 正在删除的凭据行 id（用来禁用那一行）。 */
  deletingId?: string;
  /** 删除失败的结构化原因。与加载失败分开：失败的动作不同，用户要做的事也不同。 */
  deleteFailure?: HostedAuthFailureReason;
  /** 刚删掉一条 —— 给一句确认，而不是静默。 */
  justDeleted: boolean;
  /** 正在"添加一条新的"（含系统弹窗那一段）。 */
  adding: boolean;
  /** 添加失败的结构化原因。与删除失败分开：`passkey-unsupported` 只可能来自添加。 */
  addFailure?: HostedAuthFailureReason;
  /** 刚添加成功。注意：它只在服务端**真的写入**之后才会置位。 */
  justAdded: boolean;

  load: (baseUrl: string, token: string | undefined) => Promise<void>;
  remove: (baseUrl: string, token: string | undefined, id: string) => Promise<void>;
  /**
   * 给当前账号再添一条通行密钥。
   *
   * 🔴 三步：(1) 向已认证端点要 options；(2) **平台调用**（系统弹窗，
   * 只能发生在浏览器里，见 `../auth/passkey-browser.js`）；(3) 交回服务端
   * 写入。任何一步失败都**绝不**置 `justAdded`。
   *
   * `browser` 可注入（jsdom 没有 `navigator.credentials`）；不传时自动探测。
   * 不支持的设备在**发任何请求之前**就返回 —— 与认证 store 里同一形状。
   */
  add: (
    baseUrl: string,
    token: string | undefined,
    browser?: PasskeyBrowser,
  ) => Promise<void>;
  dismissNotice: () => void;
  reset: () => void;
}

export const usePasskeysStore = create<PasskeysStoreState>((set, get) => ({
  status: { kind: 'idle' },
  justDeleted: false,
  adding: false,
  justAdded: false,

  load: async (baseUrl, token) => {
    set({ status: { kind: 'loading' } });
    const outcome = await listPasskeys({ baseUrl }, token ?? '');
    set({
      status: outcome.ok
        ? { kind: 'loaded', passkeys: outcome.passkeys }
        : { kind: 'failed', reason: outcome.reason },
    });
  },

  remove: async (baseUrl, token, id) => {
    // 清掉上一条通知，否则"上次删除失败"会和这一次的进行中状态同时挂着。
    set({ deletingId: id, deleteFailure: undefined });
    const outcome = await deletePasskey({ baseUrl }, { token: token ?? '', id });

    if (!outcome.ok) {
      set({ deletingId: undefined, deleteFailure: outcome.reason });
      // `passkey-not-found` = 这条本来就不在了（多半别的设备删过）：
      // 重拉一次，界面不会再显示一条服务端并不存在的行。
      if (outcome.reason === 'passkey-not-found') {
        await get().load(baseUrl, token);
      }
      return;
    }

    set({ deletingId: undefined, justDeleted: true });
    await get().load(baseUrl, token);
  },

  add: async (baseUrl, token, browser) => {
    // 🔴 能力探测必须在**发任何请求之前**。不支持的设备上先要 options
    // 是白问，而且会把"这台设备不支持"伪装成一次失败的网络请求。
    const resolved = browser ?? detectPasskeyBrowser();
    if (resolved === undefined || !resolved.supported) {
      set({ addFailure: 'passkey-unsupported', justAdded: false });
      return;
    }

    // 清掉上一条通知，并进入进行中；此时**还没有**任何成功可言。
    set({ adding: true, addFailure: undefined, justAdded: false });

    // ① 向已认证端点要 options（协议在 app-host）
    const begun = await beginPasskeyEnrollment({ baseUrl }, token ?? '');
    if (!begun.ok) {
      set({ adding: false, addFailure: begun.reason });
      return;
    }

    // ② 平台那一步：用户在系统弹窗上操作，可能停住很久。
    const created = await createPasskeyCredential(begun.options, resolved);
    if (!created.ok) {
      // 用户在弹窗里取消 / 超时 —— 这里**绝不**说成功。
      set({ adding: false, addFailure: created.reason });
      return;
    }

    // ③ 交回服务端写入。服务端 2xx ⟺ 真的写进了 Passkey 行。
    const completed = await completePasskeyEnrollment(
      { baseUrl },
      { token: token ?? '', credential: created.credential },
    );
    if (!completed.ok) {
      set({ adding: false, addFailure: completed.reason });
      return;
    }

    set({ adding: false, justAdded: true });
    // 与删除同一条纪律：列表以**服务端**为准重拉，不做本地乐观新增。
    await get().load(baseUrl, token);
  },

  dismissNotice: () => {
    set({ justDeleted: false, deleteFailure: undefined, addFailure: undefined, justAdded: false });
  },

  reset: () => {
    set({
      status: { kind: 'idle' },
      deletingId: undefined,
      deleteFailure: undefined,
      justDeleted: false,
      adding: false,
      addFailure: undefined,
      justAdded: false,
    });
  },
}));

/**
 * 测试用：把 store 归零。
 *
 * 与其它 feature store 的 `__resetXxxForTests` 同名同形 ——
 * 跨测试残留的状态是"随机变红"的常见来源（AGENTS.md #25）。
 */
export function __resetPasskeysForTests(): void {
  usePasskeysStore.setState({
    status: { kind: 'idle' },
    deletingId: undefined,
    deleteFailure: undefined,
    justDeleted: false,
    adding: false,
    addFailure: undefined,
    justAdded: false,
  });
}
