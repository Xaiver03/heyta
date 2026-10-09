import { STORES, type DbAdapter } from '@heyta/storage';
import { AutomationTicketError, type AutomationInstallationStore } from './inbound-entitlement-tickets.js';

/**
 * 安装身份的落盘键。
 *
 * 🔴 它**没有**登记在 `packages/storage` 的 `META_KEYS` 里，而仓库的惯例是把每个 META
 * 键名都登记在那张表（`INBOUND_*` 三枚都在）。这里之所以能自持一份：这条线不许改
 * `packages/storage`，而这个键**只有本模块读写**（不像 `lastServerSeq` 那样由存储层与
 * 宿主两端各读一遍），所以"改键名时有一端静默读到旧值"那个事故形状在这里不成立。
 * 把这一行搬进登记表是 `BLOCKED.md` 那条待办，不是可以忘掉的整洁问题。
 */
export const AUTOMATION_INSTALLATION_META_KEY = 'automationInstallationIdV1';

/** 与 `inbound-entitlement-tickets.ts` 同一个形状，落盘判据必须只有一份。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 用宿主已有的 `DbAdapter` 持久化**安装身份**（Web 的 `heyta-inbound` 库、Node 的 SQLite 文件
 * 都是同一个形状，所以这条不需要各壳写一份 —— AGENTS §3.5）。
 *
 * 三条刻意的语义：
 * 1. **只写一次**。已有一枚不同的身份时 `save` 直接判错，不覆盖。安装身份是服务端
 *    `officialSubject ↔ installation ↔ 本地账号` 那条绑定的依据，换掉它等于换掉一台设备
 *    （旧 worker 会被 `databaseEpoch` 一并作废），而两个并发首次调用都"读到空"时，
 *    静默覆盖会让其中一个拿着没人认的身份去取票。
 * 2. **坏值不覆盖**。读到形状不对的行就抛 `STORED_INSTALLATION_ID_INVALID`：按空处理会把
 *    一次数据损坏读成"换了一台新设备"，那正是绑定悄悄漂移的形状。
 * 3. **退出登录不清**。它标识的是这台安装，不是这个账号，也不是秘密（取票要先过账号 JWT）。
 *    清掉它会让同一个人重新登录后被当成新实例，付费绑定跟着漂。
 */
export function createAutomationInstallationMetaStore(adapter: DbAdapter): AutomationInstallationStore {
  return {
    async load(): Promise<string | undefined> {
      const row = await adapter.get<{ key: string; value: unknown }>(STORES.META, AUTOMATION_INSTALLATION_META_KEY);
      if (row === undefined) return undefined;
      if (typeof row.value !== 'string') throw new AutomationTicketError('STORED_INSTALLATION_ID_INVALID', false);
      return row.value;
    },
    async save(installationId: string): Promise<void> {
      if (!UUID.test(installationId)) throw new AutomationTicketError('INVALID_INSTALLATION_ID', false);
      await adapter.transaction([STORES.META], 'readwrite', async (tx) => {
        const current = await tx.get<{ key: string; value: unknown }>(STORES.META, AUTOMATION_INSTALLATION_META_KEY);
        if (current !== undefined) {
          if (current.value === installationId) return;
          throw new AutomationTicketError('INSTALLATION_ID_ALREADY_BOUND', false);
        }
        await tx.put(STORES.META, { key: AUTOMATION_INSTALLATION_META_KEY, value: installationId });
      });
    },
  };
}
