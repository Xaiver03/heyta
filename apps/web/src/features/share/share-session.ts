/**
 * 这台浏览器会话里**唯一**的一份共享清单实例（M2 的路由与合并视图都读它）。
 * =========================================================================
 *
 * ## 为什么必须是单例
 *
 * 一份 share 的重放结果按实例缓存在 `createShareCommentDispatch` 里（命中就不再看盘）。
 * M2 之前有两处各自 `createWebShareComments(...)`：评论区一份、M5 信号消费者一份。
 * 那时只是"各看各的缓存"，而 M2 之后这一份缓存**同时是**：
 * - `currentState()` 合并视图的数据源（界面上的共享任务从这儿来）；
 * - 写路由的 `channel.stateFor()`（"这份清单里已经有这枚标签了吗"从这儿判）。
 * 两处实例就是两个答案：信号那一份拉回了 A 的任务，界面这一份没有 ⇒ 用户看不见，
 * 而**写路由也看不见** ⇒ 他把那条任务当成"本机没有的条目"处理。
 *
 * ## 谁都能问，但问的是同一份
 *
 * - `webShareChannel`：交给 `lib/oplog.ts` 的路由派发器（每次派发现问一次）。
 *   🔴 它是**异步**的：载荷密钥要等 vault 会话建好才拿得到；同步版会把"刚开机那几百毫秒"
 *   报成"这台设备用不了共享通道"—— 那句是假的。
 * - `ensureWebShareSession()`：界面用它（评论区、信号消费者），拿到的是同一份。
 * - `armWebShareSession()`：入口调一次，之后登录态/服务端一改就重建。
 *
 * ## 换账号、退出登录 ⇒ 先摘再建
 *
 * 摘掉旧实例（连带它那份**已解密**的共享内容）必须发生在建新实例之前。
 * 反过来做的那几毫秒里，`currentState()` 会把上一个人的任务并进这个人的界面 ——
 * 那是隐私问题，不是刷新问题。
 */
import { createShareViewMerger } from '@heyta/app-host';
import { CURRENT_SCHEMA_VERSION } from '@heyta/shared-schema';
import type { MaterializedState } from '@heyta/op-log';
import type { SyncPayloadCipher } from '@heyta/sync-client';

import { attachShareWiring, hasEngine, requireEngine, type ShareWiring } from '../../lib/oplog.js';
import { getWebVaultSession } from '../../lib/vault-session.js';
import { useSyncStore } from '../sync/store.js';
import { createWebShareComments, type WebShareComments } from './comment-actions.js';

/** 拼键的分隔符：accountId/baseUrl/token 里都不可能出现 NUL，所以拼接不会歧义。 */
const SEP = String.fromCharCode(0);

interface BuiltSession {
  readonly depKey: string;
  readonly comments: WebShareComments;
  readonly mergeView: (personal: MaterializedState) => MaterializedState;
}

let built: BuiltSession | undefined;
let building: Promise<BuiltSession | undefined> | undefined;
let armed = false;

/**
 * 当前这一刻能不能建共享实例，以及建出来的是"哪一个人、哪一台服务端"的。
 * `undefined` = 这一刻没有共享上下文（没配服务端 / 没登录 / 引擎还没就绪）。
 */
function currentDepKey(): string | undefined {
  const { baseUrl, token, authTransport, accountId } = useSyncStore.getState();
  if (accountId === undefined || accountId === '') return undefined;
  if (baseUrl.trim() === '') return undefined;
  if (token === undefined || token.trim() === '') return undefined;
  // clientId 是 share op 的署名，引擎没就绪时它还不存在。
  if (!hasEngine()) return undefined;
  return [accountId, baseUrl, token, authTransport ?? 'bearer', requireEngine().getClientId()].join(SEP);
}

function detach(): void {
  built = undefined;
  attachShareWiring(undefined);
}

/**
 * 递给 `lib/oplog.ts` 的那一份装配（两条都是**读当下**的闭包）。
 *
 * 🔴 为什么不是建好实例时抓一份死值：实例会随登录态换（换账号、退出、解锁密钥），
 * 而路由派发器在模块加载时就装配好了。抓死值等于"换账号之后还在用上一个人的通道"。
 */
const wiring: ShareWiring = {
  // 🔴 这一问会**催建**：路由是在用户敲下回车那一刻才发现"这条属于共享清单"的，
  // 而那一刻实例可能还在路上（首启的 vault 会话、或刚登录还没人问过）。
  // 只读 `built` 的话，"密钥其实就在盘上"会被报成"这台设备用不了共享通道"。
  channel: async () => (await ensure())?.comments.channel,
  mergeView: (personal) => (built === undefined ? personal : built.mergeView(personal)),
};

async function buildNow(): Promise<BuiltSession | undefined> {
  const depKey = currentDepKey();
  if (depKey === undefined) {
    detach();
    return undefined;
  }
  if (built !== undefined && built.depKey === depKey) return built;
  // 🔴 先摘后建（见文件头"换账号"那一节）。
  if (built !== undefined) detach();
  const [accountId, baseUrl, token, authTransport, clientId] = depKey.split(SEP);

  let vaultCipher: SyncPayloadCipher | undefined;
  try {
    const session = await getWebVaultSession(
      accountId ?? '',
      baseUrl ?? '',
      async () => token,
      authTransport === 'cookie' ? 'cookie' : 'bearer',
    );
    vaultCipher = await session.getPayloadCipher();
  } catch {
    // vault 没解锁 / 服务端地址不合法：这一刻没有共享上下文。
    return undefined;
  }
  const comments = createWebShareComments({
    baseUrl: baseUrl ?? '',
    token: token ?? '',
    authTransport: authTransport === 'cookie' ? 'cookie' : 'bearer',
    userId: accountId ?? '',
    clientId: clientId ?? '',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    vaultCipher,
    storage: window.localStorage,
  });
  if (comments === undefined) return undefined;

  built = {
    depKey,
    comments,
    mergeView: createShareViewMerger({ stateFor: (shareId) => comments.channel.stateFor(shareId) }),
  };
  attachShareWiring(wiring);
  return built;
}

/** 并发问一次只建一次（`getWebVaultSession` 自己也会并轨，但那不能省掉这一层的重入）。 */
function ensure(): Promise<BuiltSession | undefined> {
  if (building !== undefined) return building;
  building = buildNow().finally(() => {
    building = undefined;
  });
  return building;
}

/** 已经建好的那一份；没建好就是 `undefined`（读它的人不许等）。 */
export function webShareSession(): WebShareComments | undefined {
  return built?.comments;
}

/** 建好（或"这一刻确实建不出来"）。 */
export async function ensureWebShareSession(): Promise<WebShareComments | undefined> {
  return (await ensure())?.comments;
}

/**
 * 装一次（幂等）：入口在 `initOpLog()` 之后调。
 *
 * 订阅同步 store 而不是让每个改动登录态的地方都记得踢一脚：登录、退出、换服务端
 * 都只有一处所有者，漏踢等于"换账号之后还在读上一个人的共享内容"。
 */
export function armWebShareSession(): void {
  if (armed) return;
  armed = true;
  void ensure();
  useSyncStore.subscribe(() => {
    const depKey = currentDepKey();
    if (depKey === undefined) {
      detach();
      return;
    }
    if (built !== undefined && built.depKey === depKey) return;
    void ensure();
  });
}

/**
 * 丢掉这一份实例（连同那份已解密的共享内容），然后**重问一次**。
 *
 * 离场（`forgetShareLocally`）与"退出登录"都要走这里：删盘上的日志不删内存里那一份，
 * 界面上别人的评论还在 —— 读的就是这份缓存。
 *
 * ⚠️ 为什么重问：这台设备上可能还有**别的**共享清单在册。只摘不重建的话，
 * 它们的内容会从合并视图里消失，直到下一次有人恰好问起 —— 那是"删一条、丢一片"。
 * 没登录上下文时 `ensure()` 自己就停在"什么都没有"上，所以这里无条件踢。
 */
export function resetWebShareSession(): void {
  detach();
  void ensure();
}
