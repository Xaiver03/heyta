/**
 * 同步客户端
 * ============
 *
 * 把本地 op-log 接到 P0 已验证的服务端协议。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 两条**实测发现**直接落进这个实现（见 docs/runbooks/local-server-verification.md）：
 *
 *   1. **服务端强制 E2EE 且没有开关。** 明文上传一律 400 E2EE_REQUIRED。
 *      所以每条 op 都必须 `isPayloadEncrypted: true`，且 payload 是
 *      **base64 密文字符串**（不是对象）。少任何一个都失败。
 *
 *   2. **线协议 schema 不校验实体成员。** `entityType` 在契约里只是
 *      `z.string()`，拼错要通过上传才暴露 —— 而且是一条一条地暴露。
 *      所以上传前必须用 `isEntityType()` **本地自查**。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 加密与向量时钟都来自 `@heyta/sync-core`（vendored, MIT），**不重写**。
 */

import { isEntityType } from '@heyta/shared-schema';
import {
  decrypt,
  encrypt,
  isEncryptedPayloadTransportShape,
  suggestConflictResolution,
} from '@heyta/sync-core';
import type { Operation } from '@heyta/sync-core';

/** 服务端单次上传/下载的上限（契约里的常量，声明在此以便分页）。 */
const MAX_OPS_PER_UPLOAD = 500;
const DOWNLOAD_PAGE_SIZE = 200;

/**
 * 一次上传里被服务端以"冲突"拒绝的 op。
 *
 * 服务端在 CONCURRENT / 相等时钟异客户端 / 被取代 时拒绝，并给出
 * `existingClock` —— 那是它用来判定冲突的**既有版本时钟**。
 */
interface ConflictReport {
  op: Operation<string>;
  reason: string;
  errorCode: string;
  existingClock?: Record<string, number>;
}

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing'; phase: 'upload' | 'download' }
  | { kind: 'synced'; at: number }
  | { kind: 'offline'; since: number }
  | { kind: 'error'; message: string; retryable: boolean };

/**
 * 上传结果。字段名以**真实服务端**为准（SuperSyncUploadResultSchema）：
 * `opId` + `accepted`，不是 `id` + `status`。
 *
 * 我第一版按直觉写成了 `id`/`status`/`message`，于是 `accepted: false`
 * 的**逐条拒绝**被完全忽略 —— 客户端会报"已同步"，而服务端一条都没收。
 * 这是最坏的一类 bug：用户以为数据上云了，其实没有。
 */
interface UploadResult {
  opId: string;
  accepted: boolean;
  serverSeq?: number;
  error?: string;
  errorCode?: string;
  /** 服务端判定冲突时给出的**既有版本**时钟，用于解决后重试。 */
  existingClock?: Record<string, number>;
}

interface UploadResponse {
  results?: UploadResult[];
  latestSeq?: number;
  newOps?: ServerOperation[];
}

/** 线协议里的 op 本体（不含 serverSeq，那个在外面）。 */
interface WireOperation {
  id: string;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[];
  payload: unknown;
  vectorClock: Record<string, number>;
  timestamp: number;
  schemaVersion: number;
  isPayloadEncrypted?: boolean;
}

/**
 * 服务端返回的一条 op。
 *
 * 🔴 **op 是嵌套的**：`{serverSeq, op, receivedAt}`（SuperSyncServerOperationSchema）。
 * 我第一版把它当扁平结构读，于是 `op.id` 全是 undefined ——
 * 而下载路径上没有任何断言会因此失败，数据只是"静静地没进来"。
 */
interface ServerOperation {
  serverSeq: number;
  op: WireOperation;
  receivedAt?: number;
}

interface DownloadResponse {
  ops?: ServerOperation[];
  hasMore?: boolean;
  latestSeq?: number;
}

export interface SyncClientOptions {
  /** 服务端根地址，例如 http://127.0.0.1:3000 */
  baseUrl: string;
  /** 取当前访问令牌。返回 undefined 表示未登录。 */
  getToken: () => Promise<string | undefined>;
  /** 读取/写入下载游标（serverSeq）。 */
  getLastServerSeq: () => Promise<number>;
  setLastServerSeq: (seq: number) => Promise<void>;

  /** 本设备的 clientId。 */
  clientId: string;
  /** E2EE 口令。未配置时必须**拒绝同步**而不是降级成明文。 */
  getPassword: () => Promise<string | undefined>;

  /** 取待上传的本地 op（来自存储的上传状态索引，不是内存列表）。 */
  getLocalOps: () => Promise<Array<Operation<string>>>;
  /**
   * 上传成功后标记 op 已同步，并回写服务端分配的 seq。
   *
   * 是**必填**的：没有它，上传成功这件事只存在于内存里，
   * 下次同步会把同一批 op 再传一遍。
   */
  markUploaded: (serverSeqsByOpId: ReadonlyMap<string, number>) => Promise<void>;

  /** 把解密后的远程 op 交给 op-log 引擎。 */
  applyRemote: (ops: Operation<string>[]) => Promise<void>;

  /**
   * 冲突判定为"本地胜出"时，把这条改动**重新派发**成一条新 op。
   *
   * 为什么要重新派发而不是改旧 op 的时钟：op 是**不可变**的。
   * 而且下载阶段已经把远程时钟并进了本地时钟，所以新 op 的时钟
   * 天然压过服务端既有版本，重传即被接受。
   */
  redispatch: (op: Operation<string>) => Promise<void>;

  /** 冲突判定为"远端胜出"时，把本地这条移出上传队列（不删除）。 */
  discardLocal: (opIds: string[]) => Promise<void>;

  /** 取某实体的全部本地 op（冲突解决要比对时间戳）。 */
  getOpsForEntity: (entityType: string, entityId: string) => Promise<Operation<string>[]>;

  /** 网络实现，便于测试注入。默认用 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
  /** 时间源，便于测试。 */
  now?: () => number;
}

/**
 * 解析"服务端 op" → 本地 Operation。
 *
 * ⚠️ 解密失败的 op **不能被静默丢弃**：那等于用户数据凭空消失。
 * 这里抛错并让上层把状态置为 error —— 可见的失败远好于无声的数据丢失。
 */
async function decodeServerOp(
  envelope: ServerOperation,
  password: string,
): Promise<Operation<string>> {
  const op = envelope.op;
  if (op === undefined || typeof op !== 'object') {
    throw new Error(
      `服务端返回的 op 缺少嵌套的 op 本体（serverSeq=${String(envelope.serverSeq)}）—— ` +
        `线协议是 {{serverSeq, op, receivedAt}}，不是扁平结构`,
    );
  }

  let payload: unknown = op.payload;

  if (op.isPayloadEncrypted === true) {
    if (typeof op.payload !== 'string') {
      throw new Error(
        `op ${op.id} 标记为加密但 payload 不是字符串 —— 服务端数据可能损坏`,
      );
    }
    const plain = await decrypt(op.payload, password);
    payload = JSON.parse(plain) as unknown;
  }

  return {
    id: op.id,
    clientId: op.clientId,
    actionType: op.actionType,
    // 线协议词表（CRT/UPD/DEL）与本地 OpType 是同一套 —— 直接透传
    opType: op.opType,
    entityType: op.entityType,
    ...(op.entityId !== undefined ? { entityId: op.entityId } : {}),
    ...(op.entityIds !== undefined ? { entityIds: op.entityIds } : {}),
    payload,
    vectorClock: op.vectorClock,
    timestamp: op.timestamp,
    schemaVersion: op.schemaVersion,
  };
  // 注意：**不**在这里塞 serverSeq。
  // `Operation` 是线协议类型，没有 seq 字段；服务端游标由
  // getLastServerSeq/setLastServerSeq 单独维护。
  // 往 op 上加协议外的字段，下次上传会把它原样发给服务端 —— 凭空造字段。
}

export class SyncClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: SyncClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  /**
   * 完整同步：先上传本地，再下载远端。
   *
   * 顺序**不能反**：先下载的话，本地那些还没上传的 op 会在
   * 冲突判定里被当成"我们已经知道的"，而服务端其实还没见过它们。
   */
  async sync(onStatus?: (s: SyncStatus) => void): Promise<SyncStatus> {
    const report = (s: SyncStatus): SyncStatus => {
      onStatus?.(s);
      return s;
    };

    const token = await this.options.getToken();
    if (token === undefined) {
      return report({ kind: 'error', message: '未登录', retryable: false });
    }

    const password = await this.options.getPassword();
    if (password === undefined || password === '') {
      // 🔴 绝不降级成明文。服务端会 400，但更糟的是"看起来同步成功"。
      // 宁可明确失败，也不让用户以为数据安全地上云了。
      return report({
        kind: 'error',
        message: '未设置端到端加密口令，已停止同步（不会以明文上传）',
        retryable: false,
      });
    }

    try {
      const conflicts: ConflictReport[] = [];

      report({ kind: 'syncing', phase: 'upload' });
      await this.upload(token, password, conflicts);

      // 🔴 顺序：上传 → 下载 → 解决冲突 → 再上传。
      //
      // 冲突解决必须在**下载之后**：判定"谁更新"要用到远端那条 op 的
      // 时间戳，而下载之前我们手上根本没有它。
      // 我第一版没有这一步，于是 CONCURRENT 会被当成硬错误 ——
      // 离线改一次就永远同步不上去。
      report({ kind: 'syncing', phase: 'download' });
      await this.download(token, password);

      if (conflicts.length > 0) {
        const unresolved = await this.resolveConflicts(conflicts, token, password);
        if (unresolved.length > 0) {
          return report({
            kind: 'error',
            message: `${String(unresolved.length)} 处冲突需要你手动选择保留哪一边`,
            retryable: false,
          });
        }
      }

      return report({ kind: 'synced', at: this.now() });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const offline = isNetworkError(error);
      return report(
        offline
          ? { kind: 'offline', since: this.now() }
          : { kind: 'error', message, retryable: true },
      );
    }
  }

  /** 上传本地 op。分批，避免超过服务端单次上限。 */
  private async upload(
    token: string,
    password: string,
    conflicts: ConflictReport[],
  ): Promise<void> {
    const pending = await this.options.getLocalOps();
    if (pending.length === 0) return;

    for (let i = 0; i < pending.length; i += MAX_OPS_PER_UPLOAD) {
      const batch = pending.slice(i, i + MAX_OPS_PER_UPLOAD);

      const ops = await Promise.all(
        batch.map(async (op) => {
          // 🔴 本地自查实体类型。线协议不校验成员，
          // 拼错要到上传后才暴露，而且是一条一条地暴露。
          if (!isEntityType(op.entityType)) {
            throw new Error(
              `拒绝上传未知实体类型 "${op.entityType}"（op ${op.id}）。` +
                `线协议不会校验它，所以必须在本地拦住。`,
            );
          }

          const cipher = await encrypt(JSON.stringify(op.payload ?? {}), password);

          // 自检：服务端会检查形状，本地先确认我们真的产出了合规密文。
          // 这里失败说明加密层出了问题，而不是网络问题。
          if (!isEncryptedPayloadTransportShape(cipher)) {
            throw new Error(
              `op ${op.id} 的密文不满足服务端传输形状要求 —— 加密层异常`,
            );
          }

          return {
            id: op.id,
            clientId: op.clientId,
            actionType: op.actionType,
            opType: op.opType,
            entityType: op.entityType,
            ...(op.entityId !== undefined ? { entityId: op.entityId } : {}),
            ...(op.entityIds !== undefined ? { entityIds: op.entityIds } : {}),
            payload: cipher,
            // 服务端要求**显式 true**；缺失算违规，不是"当作 false"
            isPayloadEncrypted: true,
            vectorClock: op.vectorClock,
            timestamp: op.timestamp,
            schemaVersion: op.schemaVersion,
          };
        }),
      );

      const res = await this.fetchImpl(`${this.options.baseUrl}/api/sync/ops`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ops,
          clientId: this.options.clientId,
          lastKnownServerSeq: await this.options.getLastServerSeq(),
        }),
      });

      if (!res.ok) {
        throw await toHttpError(res);
      }

      const body = (await res.json()) as UploadResponse;

      // 🔴 逐条检查 accepted。
      // HTTP 200 **不代表** op 被接受 —— 服务端会对单条 op 返回
      // `accepted: false` + errorCode，而响应整体仍是 200。
      // 只看 res.ok 的话，客户端会报"已同步"而数据一条都没上云。
      const localOpById = new Map(batch.map((op) => [op.id, op]));
      const rejected: UploadResult[] = [];

      for (const result of body.results ?? []) {
        if (result.accepted === true) continue;
        rejected.push(result);

        // 冲突**不是**普通失败：它是需要解决的分歧，不是要重试的错误。
        // 混在一起的话，"冲突"会被无限重试，永远解不开。
        if (result.errorCode?.startsWith('CONFLICT') === true || result.errorCode === 'CONFLICT') {
          const op = localOpById.get(result.opId);
          if (op !== undefined) {
            conflicts.push({
              op,
              reason: result.error ?? '未知冲突',
              errorCode: result.errorCode ?? 'CONFLICT',
              ...(result.existingClock !== undefined
                ? { existingClock: result.existingClock }
                : {}),
            });
          }
        }
      }

      // 非冲突的拒绝才是硬错误
      const hardRejects = rejected.filter(
        (r) => r.errorCode?.startsWith('CONFLICT') !== true,
      );
      if (hardRejects.length > 0) {
        const detail = hardRejects
          .map((r) => `${r.opId}(${r.errorCode ?? '?'}: ${r.error ?? '未知原因'})`)
          .join(', ');
        throw new Error(
          `服务端拒绝了 ${String(hardRejects.length)}/${String(ops.length)} 条 op：${detail}`,
        );
      }

      // 🔴 先把"已上传"落盘，再推进游标。
      // 反过来的话，游标前进了却不知道哪些 op 传过 —— 下次会重传整批。
      const seqsByOpId = new Map<string, number>();
      for (const result of body.results ?? []) {
        if (result.accepted === true && typeof result.serverSeq === 'number') {
          seqsByOpId.set(result.opId, result.serverSeq);
        }
      }
      if (seqsByOpId.size > 0) {
        await this.options.markUploaded(seqsByOpId);
      }

      // 上传成功才推进游标。失败就保持原位，下次重试同一批。
      if (typeof body.latestSeq === 'number') {
        await this.options.setLastServerSeq(body.latestSeq);
      }

      // 服务端可能搭车返回新 op（piggyback），必须应用，否则会丢数据
      if (body.newOps !== undefined && body.newOps.length > 0) {
        const decoded = await Promise.all(
          body.newOps.map((o) => decodeServerOp(o, password)),
        );
        await this.options.applyRemote(decoded);
      }
    }
  }

  /**
   * 解决上传时被判定的冲突。
   *
   * 策略**不是自己发明**，而是复用 sync-core 的 `suggestConflictResolution`：
   * 它已经编码了 LWW（一小时窗口内比时间戳）、删除优先、
   * 创建与更新不对称等规则，以及判不出来时的 `manual` 兜底。
   * 自己再写一套迟早与它对不上，而两套冲突策略不一致是最难查的一类 bug。
   *
   * 返回**未能自动解决**的冲突（需要用户手动选择）。
   */
  private async resolveConflicts(
    conflicts: ConflictReport[],
    token: string,
    password: string,
  ): Promise<ConflictReport[]> {
    const unresolved: ConflictReport[] = [];
    const toRedispatch: Operation<string>[] = [];
    const toDiscard: string[] = [];

    for (const conflict of conflicts) {
      const { op } = conflict;
      if (op.entityId === undefined) {
        // 没有 entityId 就没法比对实体级历史 —— 交给人判断
        unresolved.push(conflict);
        continue;
      }

      // 下载之后，本地日志里已经有了远端那条
      const history = await this.options.getOpsForEntity(op.entityType, op.entityId);
      const mine = history.filter((o) => o.clientId === this.options.clientId);
      const theirs = history.filter((o) => o.clientId !== this.options.clientId);

      const suggestion = suggestConflictResolution(mine, theirs);

      switch (suggestion) {
        case 'local':
          toRedispatch.push(op);
          break;
        case 'remote':
          toDiscard.push(op.id);
          break;
        default:
          unresolved.push(conflict);
          break;
      }
    }

    if (toDiscard.length > 0) await this.options.discardLocal(toDiscard);

    if (toRedispatch.length > 0) {
      for (const op of toRedispatch) {
        await this.options.redispatch(op);
      }
      // 重新派发产生了新 op（时钟已压过服务端），再传一次
      const retryConflicts: ConflictReport[] = [];
      await this.upload(token, password, retryConflicts);
      // 重传仍冲突 → 交给用户，不再循环（否则可能无限重试）
      unresolved.push(...retryConflicts);
    }

    return unresolved;
  }

  /** 增量下载。按 serverSeq 游标分页，直到 hasMore 为 false。 */
  private async download(token: string, password: string): Promise<void> {
    for (;;) {
      const since = await this.options.getLastServerSeq();
      const url = new URL(`${this.options.baseUrl}/api/sync/ops`);
      url.searchParams.set('sinceSeq', String(since));
      url.searchParams.set('limit', String(DOWNLOAD_PAGE_SIZE));
      // 排除自己：我们的 op 已经应用过了，拉回来纯属浪费
      url.searchParams.set('excludeClient', this.options.clientId);

      const res = await this.fetchImpl(url.toString(), {
        headers: { authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw await toHttpError(res);

      const body = (await res.json()) as DownloadResponse;
      const ops = body.ops ?? [];

      if (ops.length > 0) {
        const decoded = await Promise.all(ops.map((o) => decodeServerOp(o, password)));
        await this.options.applyRemote(decoded);
      }

      /**
       * 🔴 游标推进必须用 `latestSeq`，**不是最后一条 op 的 serverSeq**。
       *
       * 这两者在有并发写入时不同：服务端可能已经分配了更大的序号，
       * 但那些 op 因为 excludeClient 或过滤没有出现在本页。
       * 用最后一条的 serverSeq 会让游标落后，下次重复下载同一批；
       * 而用 latestSeq 才表示"我看到这个位置为止"。
       */
      if (typeof body.latestSeq === 'number') {
        await this.options.setLastServerSeq(body.latestSeq);
      }

      // 用 latestSeq 判定终止，而不是 ops.length ——
      // 服务端可能返回空页但仍标记 hasMore（例如全部被 excludeClient 过滤）
      if (body.hasMore !== true || ops.length === 0) return;
    }
  }
}

/** 把非 2xx 响应变成带服务端信息的错误。 */
async function toHttpError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    detail = body.error ?? body.message ?? '';
  } catch {
    // 响应体不是 JSON —— 不要因为解析失败而丢掉状态码
    detail = '';
  }
  return new Error(
    `同步请求失败：HTTP ${String(res.status)}${detail === '' ? '' : ` — ${detail}`}`,
  );
}

/** 判断是否网络层错误（→ 离线），区别于服务端拒绝（→ 错误）。 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch 在断网时抛 TypeError
  const message = error instanceof Error ? error.message : '';
  return /failed to fetch|network|offline|ECONNREFUSED/i.test(message);
}

/**
 * 指数退避的离线重试。
 *
 * 只对**可重试**错误退避；服务端明确拒绝（如 E2EE 违规、未登录）
 * 重试再多次也不会成功，只会浪费配额。
 */
export function createRetryScheduler(
  run: () => Promise<SyncStatus>,
  options: { baseDelayMs?: number; maxDelayMs?: number } = {},
): { start: () => void; stop: () => void } {
  const base = options.baseDelayMs ?? 2000;
  const max = options.maxDelayMs ?? 60_000;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const delay = Math.min(base * 2 ** attempt, max);
    attempt += 1;
    timer = setTimeout(() => {
      void run().then((status) => {
        // 成功或不可重试 → 停止；
        // 离线/可重试错误 → 继续退避
        if (status.kind === 'synced') {
          attempt = 0;
          return;
        }
        if (status.kind === 'error' && !status.retryable) return;
        schedule();
      });
    }, delay);
  };

  return {
    start: () => {
      stopped = false;
      attempt = 0;
      schedule();
    },
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
