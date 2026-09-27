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
  deletePasskey,
  listPasskeys,
  type HostedAuthFailureReason,
  type HostedPasskeySummary,
} from '@heyta/app-host';

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

  load: (baseUrl: string, token: string | undefined) => Promise<void>;
  remove: (baseUrl: string, token: string | undefined, id: string) => Promise<void>;
  dismissNotice: () => void;
  reset: () => void;
}

export const usePasskeysStore = create<PasskeysStoreState>((set, get) => ({
  status: { kind: 'idle' },
  justDeleted: false,

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

  dismissNotice: () => {
    set({ justDeleted: false, deleteFailure: undefined });
  },

  reset: () => {
    set({
      status: { kind: 'idle' },
      deletingId: undefined,
      deleteFailure: undefined,
      justDeleted: false,
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
  });
}
