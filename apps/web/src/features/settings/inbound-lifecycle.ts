import { useSyncExternalStore } from 'react';
import {
  INBOUND_AUTOMATION_SYSTEM_PROMPT,
  startInboundWorkerLoop,
  type InboundAutomationCycleState,
  type InboundWorkerLoop,
} from '@heyta/app-host';
import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import { useSyncStore } from '../sync/store.js';
import { getWebInboundRecipientKey, hasWebInboundWorker, processWebInboundOnce } from './inbound-runtime.js';

/** 宿主交给循环的三样闸门：路由、出境同意、端点密钥存储。每次开工现读，不冻结在闭包里。 */
export type WebInboundDeps = { routing: AiRoutingConfig; consents: readonly EgressConsent[]; secretStore?: SecretStore };

/**
 * 循环与设置面板共用的那一枚快照。
 *
 * 🔴 为什么必须住在两者之外：这条循环原先挂在设置面板上，于是"离开设置视图就没人在收"。
 * 循环提到应用级之后，产出它的人和显示它的人不再是同一个组件；状态若还留在面板里，
 * 界面上那句"上一次处理成什么样"就变成组件自己编的。
 */
export type WebInboundSnapshot = {
  keyEpoch: number | undefined;
  workerRegistered: boolean;
  processing: boolean;
  cycle: 'idle' | 'failed' | InboundAutomationCycleState;
  /** 最近一趟抛了：面板把它换成那条红色回执，而不是某句状态回显。 */
  failure: boolean;
};

const EMPTY: WebInboundSnapshot = { keyEpoch: undefined, workerRegistered: false, processing: false, cycle: 'idle', failure: false };
const listeners = new Set<() => void>();
let snapshot: WebInboundSnapshot = EMPTY;

function publish(patch: Partial<WebInboundSnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (next.keyEpoch === snapshot.keyEpoch && next.workerRegistered === snapshot.workerRegistered
    && next.processing === snapshot.processing && next.cycle === snapshot.cycle && next.failure === snapshot.failure) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

export function getWebInboundSnapshot(): WebInboundSnapshot {
  return snapshot;
}

export function subscribeWebInbound(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 面板读循环的产出，与移动壳 `apps/mobile/src/inbound/status.ts` 同形。 */
export function useWebInboundWorker(): WebInboundSnapshot {
  return useSyncExternalStore(subscribeWebInbound, getWebInboundSnapshot, getWebInboundSnapshot);
}
const bindingOf = (state: { accountId?: string; baseUrl: string; token?: string }): string | undefined =>
  state.accountId === undefined || state.token === undefined || state.token.trim() === '' || state.baseUrl.trim() === ''
    ? undefined : JSON.stringify([state.accountId, state.baseUrl, state.token]);


let liveDeps: WebInboundDeps | undefined;
let readinessBinding: string | undefined;
let running = false;
let stopped = true;
let loop: InboundWorkerLoop | undefined;
let owners = 0;
let wakeOnVisible: (() => void) | undefined;

/** 循环要用的三样闸门由宿主每次改设置时写进来；面板与应用级各写一次，写的是同一份事实。 */
export function configureWebInboundDeps(deps: WebInboundDeps): void {
  liveDeps = deps;
}

/** 没登录/没会话就没有绑定可言：连带把上一会话的事实清掉，别让另一个人看见。 */
const currentBinding = (): string | undefined => bindingOf(useSyncStore.getState());

/**
 * 收件包与 worker 在册这两样事实的唯一读法。
 *
 * 每次开工前现问一次，而不是挂在面板上：密钥可能在另一台设备上刚轮换，而那一刻面板
 * 并没有打开着 —— 面板不挂载时没人替循环刷新，就会出现"拿着旧 epoch 解不开"的假失败。
 */
export async function refreshWebInboundReadiness(): Promise<void> {
  const binding = currentBinding();
  if (binding === undefined) {
    readinessBinding = undefined;
    publish({ keyEpoch: undefined, workerRegistered: false });
    return;
  }
  const { accountId, baseUrl, token } = useSyncStore.getState();
  const recipient = await getWebInboundRecipientKey({ accountId: accountId as string, baseUrl, token: token as string });
  const workerRegistered = await hasWebInboundWorker({ accountId: accountId as string, baseUrl, token: token as string });
  if (currentBinding() !== binding) return;
  readinessBinding = binding;
  publish({ keyEpoch: recipient?.keyEpoch, workerRegistered });
}

/** 协议里那句边界：标签页可见才处理；离开设置视图不算离开应用。 */
const gatesOpen = (): boolean => !stopped && document.visibilityState === 'visible' && (liveDeps?.routing.enabled ?? false);

async function runPass(): Promise<void> {
  const binding = currentBinding();
  const deps = liveDeps;
  if (binding === undefined || deps === undefined || !gatesOpen() || running) return;
  if (readinessBinding !== binding) await refreshWebInboundReadiness().catch(() => undefined);
  const { keyEpoch, workerRegistered } = snapshot;
  if (keyEpoch === undefined || !workerRegistered) return;
  const { accountId, baseUrl, token } = useSyncStore.getState();
  running = true;
  publish({ processing: true, cycle: 'idle', failure: false });
  try {
    const result = await processWebInboundOnce({
      accountId: accountId as string, baseUrl, token: token as string, keyEpoch,
      allowedFields: ['title'], maxItems: 50, parseVersion: 1,
      routing: deps.routing, consents: deps.consents, secretStore: deps.secretStore,
      systemPrompt: INBOUND_AUTOMATION_SYSTEM_PROMPT,
      // 服务端那份租约才是权威；这里只保证不拿换了账号/看不见了的会话去提交一次处理。
      assertCurrent: () => {
        if (currentBinding() !== binding || !gatesOpen()) throw new Error('Inbound processing session changed');
      },
    });
    publish({ cycle: result.state });
  } catch {
    publish({ cycle: 'failed', failure: true });
  } finally {
    running = false;
    publish({ processing: false });
  }
}
/**
 * 应用级的前台常驻循环。整页只允许一枚（React StrictMode 会把挂载 effect 跑两遍），
 * 所以这里按"认领者计数"启停：返回的 disposer 只摘掉自己这一位，最后一位走时才真停。
 *
 * 🔴 起点从设置面板挪到这里，改的是一句产品边界：以前离开设置视图面板就卸载，
 * 那条循环跟着停 —— 用户以为"开着 heyta 就会收"，实际是"得守着那一屏"。
 * 协议里承诺的边界（`docs/reference/inbound-automation-protocol.md` §8）是前台执行，
 * 前台指的是应用可见，不是某一屏正显示着。
 */
export function startWebInboundWorker(): () => void {
  owners++;
  if (owners === 1) {
    stopped = false;
    loop = startInboundWorkerLoop({ processOnce: () => runPass(), isRunnable: gatesOpen, onError: () => undefined });
    wakeOnVisible = (): void => { void loop?.wake(); };
    window.addEventListener('focus', wakeOnVisible);
    document.addEventListener('visibilitychange', wakeOnVisible);
  }
  return () => {
    owners--;
    if (owners > 0) return;
    stopped = true;
    if (wakeOnVisible !== undefined) {
      window.removeEventListener('focus', wakeOnVisible);
      document.removeEventListener('visibilitychange', wakeOnVisible);
      wakeOnVisible = undefined;
    }
    loop?.();
    loop = undefined;
    readinessBinding = undefined;
    liveDeps = undefined;
    publish({ keyEpoch: undefined, workerRegistered: false, processing: false, cycle: 'idle', failure: false });
  };
}

/**
 * 面板上那颗「处理一条待收件」的唯一入口：在途就不排队，循环没起（单元用例里单独挂面板）
 * 就当场跑一趟。它必须和循环走同一枚 `running` 闸门，否则手动与后台会同时领同一条事件。
 */
export function triggerWebInboundPass(): void {
  if (running) return;
  if (loop !== undefined) void loop.wake();
  else void runPass();
}

