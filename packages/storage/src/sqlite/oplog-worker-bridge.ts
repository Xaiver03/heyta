/**
 * op-log 存储的 **Worker 桥接**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（不是一个"优化"，是平台约束）
 * ─────────────────────────────────────────────────────────────
 * [ADR-0028](../../../../docs/adr/0028-web-sqlite-must-run-in-worker.md) 实测：
 * 页面主线程**拿不到** `FileSystemFileHandle.prototype.createSyncAccessHandle`
 * （规范 `[Exposed=DedicatedWorker]`），所以 OPFS 的 SAH Pool VFS
 * **只能在 Worker 里装**。于是 web 的 SQLite 必然在 Worker 里。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 边界画在 `OpLogStore`，不画在 `DbAdapter`
 * ─────────────────────────────────────────────────────────────
 * 这是本文件最重要的一个决定，换一种切法就做不成：
 *
 * `DbAdapter.transaction(stores, mode, fn)` **接收一个回调**。
 * 回调**无法跨 Worker 序列化** —— 如果边界画在 `DbAdapter`，
 * 主线程就必须把回调拆成一串单独的请求发过去，那等于**把事务的原子性拆掉**：
 * 中途失败就留下一半写入，而"单个原子事务"正是这个接口的承诺。
 *
 * 所以：**`SqliteAdapter` 和 `DbOpLogStore` 都留在 Worker 里**，
 * 主线程只拿一个 `OpLogStore` 代理。
 *
 * 好处不只是"能跑"：
 * - 事务的原子性**原地保持**，没有被拆成多次往返；
 * - 适配器逻辑**只有一份**（ADR-0003 §2.2）—— Worker 里那份就是契约测试跑过的那份；
 * - 主线程拿到的接口与 `IndexedDbOpLogStore` **完全同型**，
 *   所以 `apps/web` 换过来是**换一个实现**，不是改一层架构。
 *
 * ─────────────────────────────────────────────────────────────
 * 协议为什么是"泛型方法名 + 数组参数"
 * ─────────────────────────────────────────────────────────────
 * 因为 `OpLogStore` 的每个方法都满足两个条件（这是**逐个核对过**的，不是假设）：
 *   1. 返回 `Promise`；
 *   2. 参数全部可**结构化克隆**。
 *
 * 第 2 条里唯一需要留意的是 `markUploaded(ReadonlyMap<string, number>)` ——
 * `Map` **是**可结构化克隆的（`structuredClone` 支持 Map/Set/Date/ArrayBuffer），
 * 所以它原样能过，不需要转成 `[[k,v]]`。
 *
 * 反过来说：**哪天给 `OpLogStore` 加了带回调的方法，这里会静默失效** ——
 * 回调在克隆时直接抛 `DataCloneError`，所以至少不是静默的。
 */

import type { Operation } from '@heyta/sync-core';

import type { OpLogStore } from '../op-log-store.js';

/**
 * Worker 侧要服务的 store。**故意只要 `OpLogStore`** ——
 * 它比 `DbAdapter` 窄，而窄的边界更好守。
 */
export type OpLogWorkerStore<TOperation extends Operation<string> = Operation> =
  OpLogStore<TOperation>;

/** 可以从主线程调到 Worker 的方法名（= `OpLogStore` 的键）。 */
export type OpLogWorkerMethod = keyof OpLogStore<Operation>;

export interface OpLogWorkerRequest {
  readonly id: number;
  readonly method: string;
  readonly args: unknown[];
}

/** 错误也要过一下结构化克隆：`Error` 实例本身过不去，所以拆成普通对象。 */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export type OpLogWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: SerializedError };

/**
 * Worker 侧的**初始化交握**。它没有 `id`，所以不会和请求/响应对撞上。
 *
 * 之所以要交握而不是让主线程盲等：`clientId` 是 LWW 冲突的**决胜依据**
 * （见 `apps/web/src/lib/oplog.ts` 里的教训），必须由**Worker 里那个库**
 * 给出权威值，而不是主线程自己再算一个。
 *
 * 成功时带 `clientId`，失败时带 `error` —— **失败也必须报**，
 * 否则主线程会在一个永远不会好起来的库上一直转圈。
 */
export type OpLogWorkerReady =
  | { readonly type: 'ready'; readonly clientId: string }
  | { readonly type: 'ready'; readonly error: SerializedError };

/** 把任意异常压成可克隆的形状。 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // `stack` 只在存在时带上 —— 某些引擎/包装下它可能没有。
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Error', message: String(error) };
}

/** 在调用方重建异常。保留 `name` 与 `stack`，否则堆栈会断在桥这里。 */
function deserializeError(error: SerializedError): Error {
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name;
  if (error.stack !== undefined) rebuilt.stack = error.stack;
  return rebuilt;
}

/**
 * **Worker 侧**：处理一条请求。
 *
 * 单独导出（而不只是内联在入口里）是为了它能被**直接测试** ——
 * 不需要真的起一个 Worker 就能验"方法名不认识时报什么错"这类分支。
 */
export async function handleOpLogWorkerRequest(
  store: OpLogWorkerStore,
  request: OpLogWorkerRequest,
): Promise<OpLogWorkerResponse> {
  const fn = (store as unknown as Record<string, unknown>)[request.method];
  if (typeof fn !== 'function') {
    /**
     * ⚠️ 这里**不要**悄悄返回 undefined。
     * 方法名打错（或 `OpLogStore` 改名而桥上没跟上）时，
     * 静默返回 undefined 会让调用方拿到一个"假的空结果"，
     * 而真实原因是"这个方法压根没被转发" —— 又是一次"什么都没发生"。
     */
    return {
      id: request.id,
      ok: false,
      error: {
        name: 'TypeError',
        message: `OpLogStore 上没有方法 "${request.method}"。请核对 OpLogStore 是否改名、以及桥上的转发列表是否跟上。`,
      },
    };
  }

  try {
    const value = await (fn as (...a: unknown[]) => Promise<unknown>).apply(store, request.args);
    return { id: request.id, ok: true, value };
  } catch (error) {
    return { id: request.id, ok: false, error: serializeError(error) };
  }
}

/**
 * **Worker 侧**：把 store 接到一个 `postMessage` 端口上。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 为什么要收一个 `Promise` 而不是已经建好的 store
 * ─────────────────────────────────────────────────────────────
 * 因为 worker 里"开库"是**异步**的（装 OPFS VFS、建表），而主线程可能**立刻**
 * 就发起请求。两种写法都错：
 *   - 等开完库再挂 `onmessage` → 期间到达的消息**直接丢失**，表现为"第一次写入不见了"；
 *   - 挂上但不管顺序 → 请求在库还没好时被处理 → 报一个和真实原因无关的错。
 *
 * 所以这里**先挂监听、把请求缓冲起来**，等 `ready` 决议后再排空队列。
 * 消息顺序由此**不依赖**两边的启动快慢 —— 那本来就是不确定的。
 *
 * 排空是**按到达顺序串行**的（`await` 前一条再处理下一条）：`SqliteAdapter`
 * 内部虽然有 FIFO 队列，但让请求按原顺序进入它更不容易出意外，而且代价是一次
 * 微任务。这里的串行只影响"发出去的顺序"，不影响吞吐 —— 每条仍是独立 Promise。
 */
export function serveOpLogWorker(
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(message: unknown): void;
  },
  ready: Promise<{ readonly store: OpLogWorkerStore; readonly clientId: string }>,
): void {
  /** 开库完成前到达的请求。 */
  const backlog: OpLogWorkerRequest[] = [];
  let store: OpLogWorkerStore | null = null;

  const dispatch = async (request: OpLogWorkerRequest): Promise<void> => {
    if (store === null) {
      backlog.push(request);
      return;
    }
    const response = await handleOpLogWorkerRequest(store, request);
    port.postMessage(response);
  };

  // 🔴 先挂监听，再等 ready —— 顺序不能反。
  port.onmessage = (event) => {
    void dispatch(event.data as OpLogWorkerRequest);
  };

  ready.then(
    (opened) => {
      store = opened.store;
      // 先报 ready：主线程的 `ready` Promise 由此决议。
      port.postMessage({ type: 'ready', clientId: opened.clientId } satisfies OpLogWorkerReady);
      /**
       * 排空缓冲。**先整批取走再逐条处理** —— 处理过程中还会有新消息进来，
       * 它们在 `dispatch` 里看到 `store !== null` 会直接走，不会插进这一批。
       */
      const pendingRequests = backlog.splice(0, backlog.length);
      void (async () => {
        for (const request of pendingRequests) {
          const response = await handleOpLogWorkerRequest(opened.store, request);
          port.postMessage(response);
        }
      })();
    },
    (error: unknown) => {
      // 开库失败：**必须让主线程也失败**，否则它的请求会永远悬着（界面一直转圈）。
      port.postMessage({ type: 'ready', error: serializeError(error) } satisfies OpLogWorkerReady);
      const failure = serializeError(error);
      const pendingRequests = backlog.splice(0, backlog.length);
      for (const request of pendingRequests) {
        port.postMessage({ id: request.id, ok: false, error: failure });
      }
    },
  );
}

/** `createWorkerOpLogSession` 的返回值。 */
export interface WorkerOpLogSession<TOperation extends Operation<string> = Operation> {
  /** 与本地直连**同型**的 store 代理。 */
  readonly store: OpLogStore<TOperation>;
  /**
   * Worker 完成开库、并给出**权威 `clientId`** 后决议。
   *
   * 🔴 调用方**必须先 await 它再构造引擎** —— 否则会拿着一个还没定的
   * `clientId` 去建向量时钟，那正是"两份 clientId 实现"那类 bug 的温床。
   */
  readonly ready: Promise<{ readonly clientId: string }>;
}

/**
 * **主线程侧**：`OpLogStore` 的 Worker 代理 + 初始化交握。
 *
 * 它实现的是**同一个接口**，所以 `apps/web` 那边换过来只是换一个实现 ——
 * `OpLogEngine`、同步客户端、各 feature store 都不知道后面换了引擎。
 */
export function createWorkerOpLogSession<TOperation extends Operation<string> = Operation>(
  worker: { postMessage(message: unknown): void },
): WorkerOpLogSession<TOperation> {
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  let resolveReady: (value: { readonly clientId: string }) => void = () => undefined;
  let rejectReady: (error: unknown) => void = () => undefined;
  const ready = new Promise<{ readonly clientId: string }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // 没人 await `ready` 时不要让 Node 报 unhandled rejection（host 侧仍在跑）。
  ready.catch(() => undefined);

  /**
   * ⚠️ 这里必须**自己挂着** `onmessage`，不能依赖调用方去转。
   * 代理持有 Promise 决议权，消息一旦被别人消费掉，这里就永远悬着 ——
   * 表现为"界面一直转圈"，而不是一个错误。
   */
  const receiver = worker as unknown as {
    onmessage: ((event: { data: unknown }) => void) | null;
    addEventListener?: (type: string, listener: (event: { data: unknown }) => void) => void;
  };

  const onMessage = (event: { data: unknown }): void => {
    const data = event.data as OpLogWorkerResponse | OpLogWorkerReady;

    /**
     * 🔴 **先判是不是交握消息**。它没有 `id`，若按响应处理，
     * `pending.get(undefined)` 会得到 undefined 然后被静默忽略 ——
     * 于是 `ready` 永远不决议，表现为"应用卡在启动"。
     */
    if ('type' in data && data.type === 'ready') {
      if ('clientId' in data) resolveReady({ clientId: data.clientId });
      else rejectReady(deserializeError(data.error));
      return;
    }

    const response = data as OpLogWorkerResponse;
    const waiter = pending.get(response.id);
    if (waiter === undefined) return;
    pending.delete(response.id);
    if (response.ok) waiter.resolve(response.value);
    else waiter.reject(deserializeError(response.error));
  };

  // `addEventListener` 优先：`onmessage` 是单槽的，被覆盖就静默失去接收能力。
  if (typeof receiver.addEventListener === 'function') {
    receiver.addEventListener('message', onMessage);
  } else {
    receiver.onmessage = onMessage;
  }

  const call = (method: string, args: unknown[]): Promise<unknown> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args } satisfies OpLogWorkerRequest);
    });
  };

  /**
   * 代理本体。
   *
   * 🔴 **方法名逐个列出来，不用 `Proxy` 自动转发**：
   * 自动转发会让"接口加了方法但桥上忘了转发"变成运行时才发现的事，
   * 而且 TypeScript 也帮不上忙。显式列出时，接口一改这里**编译就过不去**。
   */
  const store: OpLogStore<TOperation> = {
    appendLocal: (ops) => call('appendLocal', [ops]) as Promise<number[]>,
    appendImported: (ops) => call('appendImported', [ops]) as ReturnType<
      OpLogStore<TOperation>['appendImported']
    >,
    getOpsSince: (sinceSeq, limit, excludeClient) =>
      call('getOpsSince', [sinceSeq, limit, excludeClient]) as ReturnType<
        OpLogStore<TOperation>['getOpsSince']
      >,
    getOpsForEntity: (entityType, entityId) =>
      call('getOpsForEntity', [entityType, entityId]) as ReturnType<
        OpLogStore<TOperation>['getOpsForEntity']
      >,
    getLastLocalSeq: () => call('getLastLocalSeq', []) as Promise<number>,
    getAllOps: (range, limit) =>
      call('getAllOps', [range, limit]) as ReturnType<OpLogStore<TOperation>['getAllOps']>,
    findPendingApply: () =>
      call('findPendingApply', []) as ReturnType<OpLogStore<TOperation>['findPendingApply']>,
    findPendingUpload: () =>
      call('findPendingUpload', []) as ReturnType<OpLogStore<TOperation>['findPendingUpload']>,
    markUploaded: (serverSeqsByOpId) =>
      call('markUploaded', [serverSeqsByOpId]) as Promise<number>,
    discardPendingUpload: (opIds) => call('discardPendingUpload', [opIds]) as Promise<number>,
    markRejected: (opIds) => call('markRejected', [opIds]) as Promise<number>,
    archiveUpTo: (upToSeq) => call('archiveUpTo', [upToSeq]) as Promise<number>,
    readCheckpoint: () => call('readCheckpoint', []) as ReturnType<
      NonNullable<OpLogStore<TOperation>['readCheckpoint']>
    >,
    writeCheckpoint: (checkpoint) => call('writeCheckpoint', [checkpoint]) as ReturnType<
      NonNullable<OpLogStore<TOperation>['writeCheckpoint']>
    >,
    readObservedClock: () => call('readObservedClock', []) as ReturnType<
      NonNullable<OpLogStore<TOperation>['readObservedClock']>
    >,
    mergeObservedClock: (clock) => call('mergeObservedClock', [clock]) as ReturnType<
      NonNullable<OpLogStore<TOperation>['mergeObservedClock']>
    >,
    hasIncompleteHistory: () => call('hasIncompleteHistory', []) as ReturnType<
      NonNullable<OpLogStore<TOperation>['hasIncompleteHistory']>
    >,
    markHistoryIncomplete: () => call('markHistoryIncomplete', []) as ReturnType<
      NonNullable<OpLogStore<TOperation>['markHistoryIncomplete']>
    >,

    // ── 簿记（同步游标）──
    getLastServerSeq: () => call('getLastServerSeq', []) as Promise<number>,
    setLastServerSeq: (seq) => call('setLastServerSeq', [seq]) as Promise<void>,

    // ── 继承自 `RemoteOperationApplyStorePort` ──
    appendBatchSkipDuplicates: (ops, source, options) =>
      call('appendBatchSkipDuplicates', [ops, source, options]) as ReturnType<
        OpLogStore<TOperation>['appendBatchSkipDuplicates']
      >,
    mergeRemoteOpClocks: (ops) => call('mergeRemoteOpClocks', [ops]) as Promise<void>,
    markReducersCommittedAndMergeClocks: (seqs, ops, rejectedOpIds) =>
      call('markReducersCommittedAndMergeClocks', [seqs, ops, rejectedOpIds]) as Promise<void>,
    markApplied: (seqs) => call('markApplied', [seqs]) as Promise<void>,
    markFailed: (opIds) => call('markFailed', [opIds]) as Promise<void>,
    clearFullStateOpsExcept: (excludeIds) =>
      call('clearFullStateOpsExcept', [excludeIds]) as Promise<number>,
  };

  return { store, ready };
}

/**
 * 只要 store、不要交握 Promise 的便捷写法。
 *
 * ⚠️ **只在"调用方自己能保证 Worker 已就绪"时用它**（例如契约测试里
 * 端口是同步挂上的）。生产代码应当用 `createWorkerOpLogSession` 并
 * `await ready` —— 那里带出来的 `clientId` 才是权威值。
 */
export function createWorkerOpLogStore<TOperation extends Operation<string> = Operation>(
  worker: { postMessage(message: unknown): void },
): OpLogStore<TOperation> {
  return createWorkerOpLogSession<TOperation>(worker).store;
}
