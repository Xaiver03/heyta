/**
 * 这台手机会话里**唯一**的一份共享清单实例（与 web 的 `features/share/share-session.ts`
 * 是同一件事的另一份装配；三段理由原样成立，这里只补移动端自己的那一半）。
 * =========================================================================
 *
 * ## 为什么必须是单例
 * 一份 share 的重放结果按实例缓存在 `createShareCommentDispatch` 里，而这一份缓存
 * **同时是**合并视图的数据源和写路由的 `stateFor()`。两处实例就是两个答案。
 *
 * ## 谁都能问，但问的是同一份
 * - `wiring.channel`（装进 `share/wiring.ts` 的路由派发器）：每次派发现问一次，
 *   🔴 且是**异步**的 —— 载荷密钥要等 vault 会话建好才拿得到，同步版会把"刚开机
 *   那几百毫秒"报成"这台设备用不了共享通道"，那句是假的。
 * - 移动端比 web 多一条：`clientId` 与 vault 会话都要**已打开的宿主**才有
 *   （`getOpenTaskHostIfReady()`），宿主没就绪 = 这一刻没有共享上下文，
 *   与 web 的 `hasEngine()` 同一档；下一个问的人（界面、或路由那一问）会再催建。
 *
 * ## 换账号、退出登录 ⇒ 先摘再建
 * 摘掉旧实例（连带它那份**已解密**的共享内容）必须发生在建新实例之前；
 * 反过来做的那几毫秒里，`getState()` 会把上一个人的任务并进这个人的界面 ——
 * 那是隐私问题，不是刷新问题。
 */
import { createShareViewMerger } from '@heyta/app-host';
import { CURRENT_SCHEMA_VERSION } from '@heyta/shared-schema';
import type { MaterializedState } from '@heyta/op-log';
import type { SyncPayloadCipher } from '@heyta/sync-client';
import type { ShareKeyStoragePort, ShareLogStorage } from '@heyta/app-host';

import { getOpenTaskHostIfReady } from '../db/open-host';
import { onCredentialsCleared, readSyncConfig } from '../sync/config';
import { createMobileShareComments, type MobileShareComments } from './comment-actions';
import { attachMobileShareWiring, type MobileShareWiring } from './wiring';

/** 拼键的分隔符：accountId/serverUrl/token 里都不可能出现 NUL，拼接不会歧义。 */
const SEP = String.fromCharCode(0);

/**
 * 密钥落盘与出站闸门的端口（M6-1 交付的 `apps/mobile/src/lib/share-key-store.ts`
 * 接上后由入口调 `armMobileShareSession(ports)` 时递进来）。
 * 🔴 没递端口就**不建**实例（而不是偷偷用 `globalThis.fetch` 绕过同意闸）。
 */
export interface MobileSharePorts {
  readonly keyPort: ShareKeyStoragePort;
  readonly shareLog: ShareLogStorage;
  readonly fetchImpl: typeof fetch;
}

interface BuiltSession {
  readonly depKey: string;
  readonly comments: MobileShareComments;
  readonly mergeView: (personal: MaterializedState) => MaterializedState;
}

let ports: MobileSharePorts | undefined;
let built: BuiltSession | undefined;
let building: Promise<BuiltSession | undefined> | undefined;
let armed = false;

/** 当前这一刻能不能建共享实例，以及建出来的是"哪一个人、哪一台服务端"的。 */
function currentDepKey(): string | undefined {
  const config = readSyncConfig();
  if (config === undefined) return undefined;
  const accountId = config.accountId ?? '';
  if (accountId === '') return undefined;
  if (config.serverUrl.trim() === '') return undefined;
  const token = config.token ?? '';
  if (token.trim() === '') return undefined;
  // clientId 是 share op 的署名；宿主没就绪时它还不存在（web 的 hasEngine() 同一档）。
  const host = getOpenTaskHostIfReady();
  if (host === undefined) return undefined;
  return [accountId, config.serverUrl, token, host.clientId].join(SEP);
}

function detach(): void {
  built = undefined;
  attachMobileShareWiring(undefined);
}

/** 递给路由装配点的那一份（两条都是**读当下**的闭包，理由与 web 逐字相同）。 */
const wiring: MobileShareWiring = {
  channel: async () => (await ensure())?.comments.channel,
  mergeView: (personal) => (built === undefined ? personal : built.mergeView(personal)),
};

async function buildNow(): Promise<BuiltSession | undefined> {
  if (ports === undefined) return undefined;
  const depKey = currentDepKey();
  if (depKey === undefined) {
    detach();
    return undefined;
  }
  if (built !== undefined && built.depKey === depKey) return built;
  // 🔴 先摘后建（见文件头"换账号"那一节）。
  if (built !== undefined) detach();
  const [accountId, baseUrl, token] = depKey.split(SEP);
  const host = getOpenTaskHostIfReady();
  if (host === undefined) return undefined;

  let vaultCipher: SyncPayloadCipher | undefined;
  try {
    const session = await host.getVaultSession();
    vaultCipher = await session?.getPayloadCipher();
  } catch {
    // vault 没解锁 / 会话建不出来：这一刻没有共享上下文。
    return undefined;
  }
  const comments = createMobileShareComments({
    baseUrl: baseUrl ?? '',
    token: token ?? '',
    userId: accountId ?? '',
    clientId: host.clientId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    vaultCipher,
    keyPort: ports.keyPort,
    shareLog: ports.shareLog,
    fetchImpl: ports.fetchImpl,
  });
  if (comments === undefined) return undefined;

  built = {
    depKey,
    comments,
    mergeView: createShareViewMerger({ stateFor: (shareId) => comments.channel.stateFor(shareId) }),
  };
  attachMobileShareWiring(wiring);
  return built;
}

/** 并发问一次只建一次。 */
function ensure(): Promise<BuiltSession | undefined> {
  if (building !== undefined) return building;
  building = buildNow().finally(() => {
    building = undefined;
  });
  return building;
}

/** 已经建好的那一份；没建好就是 `undefined`（读它的人不许等）。 */
export function mobileShareSession(): MobileShareComments | undefined {
  return built?.comments;
}

/** 建好（或"这一刻确实建不出来"）。 */
export async function ensureMobileShareSession(): Promise<MobileShareComments | undefined> {
  return (await ensure())?.comments;
}

/**
 * 装一次（幂等）：入口在宿主打开后调一次，并把密钥/日志/出站端口递进来。
 *
 * 移动端与 web 的差别只在"谁被订阅"：web 订阅同步 store（zustand 有订阅层），
 * 移动端凭据只活内存、写入没有事件（`sync/config.ts` 文件头那条裁决——逐字符写
 * 会每敲一键问一次），所以这里只订"清空"那一刀：**登出必须立刻摘**，
 * 换账号后的重建由下一个问的人（面板、或路由那一问）催出来。
 */
export function armMobileShareSession(next?: MobileSharePorts): void {
  if (next !== undefined) ports = next;
  if (armed) {
    void ensure();
    return;
  }
  armed = true;
  onCredentialsCleared(() => {
    detach();
  });
  void ensure();
}

/**
 * 丢掉这一份实例（连同那份已解密的共享内容），然后**重问一次**。
 * 离场（`forgetShareLocally`）与"退出登录"都要走这里；没登录上下文时
 * `ensure()` 自己就停在"什么都没有"上，所以这里无条件踢。
 */
export function resetMobileShareSession(): void {
  detach();
  void ensure();
}

/**
 * 已装入的落盘/出站端口（信号消费者读 `shareLog` 枚举本机 share 与算活动差集 ——
 * 必须与会话同一个实例，第二份存储就是第二份真相）。没 `arm` 过 ⇒ `undefined`。
 */
export function mobileSharePorts(): MobileSharePorts | undefined {
  return ports;
}
