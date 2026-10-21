/**
 * 共享清单的**下行信号**（`new_share_ops`）怎么变成"去拉一次"，以及拉回来之后
 * 到底有什么**值得吵人**的活动 —— M5（ADR-0062 决策 7）。
 * =================================================================
 *
 * 服务端那条信号里只有 `shareId` 与那一代的 `latestSeq`，**没有内容**（端到端加密下
 * 它也拿不到内容）。所以"响了之后做什么"整段是本地判断，而本地判断不许长在端壳里
 * （AGENTS §3.5）⇒ 住这里。端壳只做注入与投递。
 *
 * 三条纪律，每条都有对应判据：
 *
 *  1. **这台设备不认识那份 share ⇒ 零请求。** 信号是按**账号**扇出的，而"这台设备
 *     见过哪些 share"是本地事实（`ShareLogStorage.list()`）。拿一个本地没有的 shareId
 *     去 `downloadOps` 只会 404 ⇒ 抛错 ⇒ 被实时回调吞掉 ⇒ 变成一条永远不会出读数的死路。
 *     更别说不该为一份本机没有的数据出一次网。
 *     ⚠️ 边界：这台设备**从没见过**的 share（在另一台设备上被邀请）不会由这条路径带来 ——
 *        它靠共享面板那趟 `GET /api/shares`。这条handler 只管"本机已有的 share 有新内容"。
 *  2. **一次信号只吵一次。** 活动是从**日志的差集**算出来的（按 op id），不是从
 *     `SharePullResult.added` 猜的：折叠会把重复吃掉，同一条 op 被信号推两次
 *     （服务端不去抖，见 `websocket-connection.service.ts` 那段注释）时
 *     第二次差集为空 ⇒ 不响。按 `added` 数响就会把同一条评论吵两遍。
 *  3. **自己不吵自己。** 按 `clientId` 滤掉本设备写的 op（与 `shouldNotifyTaskReminder`
 *     里"自己动手的事不需要通知自己"同一条理由）。
 *
 * 拉取失败**不抛穿**：这条回调是从 WebSocket 的消息处理里进来的，而那一层对宿主回调的
 * 契约是"你不能掀掉连接"（`realtime.ts` 里 `onNewOps` 那段 try/catch）。
 * 失败如实留在读数的 `error` 字段里，界面无感是**设计**，下一轮信号或下一次进评论区会再试。
 */

import { OpType } from '@heyta/sync-core';

import type { ShareLogStorage } from './share-comments.js';
import type { SharePullResult } from './share-client.js';
import type { DecryptedShareOp } from './share-replay.js';

/**
 * 一条拉回来的活动类别。
 *
 * ⚠️ 它的**名字**与 `@heyta/ui` 里 `ShareActivityKind` 的同形成员是结构性兼容的
 *   （壳里把这份读数直接喂给 `shouldNotifyActivity` / `selectNotifiedActivities`，
 *   两边一旦分家，web 那一行就编译不过 —— 不需要在这里复制那个联合类型，
 *   也不需要 app-host 反向依赖 ui 包）。
 *   这里刻意**不含** `'completed'`：那是"共享任务被勾完成"，而 `TASK` 的 op 今天
 *   仍然进个人日志（那是 M2 路由那一步），共享日志里根本没有这种 op 可映射 ——
 *   写一条映射就是给拿不到输入的代码做判据。
 */
export type ShareSignalActivity = 'added' | 'deleted';

export interface ShareSignalReading {
  readonly shareId: string;
  /** 这台设备上有没有这一份 share 的落盘痕迹。 */
  readonly knownLocally: boolean;
  /** 这一趟真的发过拉取（`knownLocally` 为假时必定是 `false`）。 */
  readonly pulled: boolean;
  /** 折叠后新增的条数（来自 `SharePullResult`，`pulled` 为假时是 0）。 */
  readonly added: number;
  /** 去重之后的活动类别；空 = 不值得吵。 */
  readonly activities: readonly ShareSignalActivity[];
  /** 拉取抛了什么（不抛穿，只登记）。 */
  readonly error?: unknown;
}

/**
 * 新到的一批 op ⇒ 该报哪些活动。
 *
 * `COMMENT` 的 `CRT` 是"有人写了条评论"，`DEL` 是"有人删了条评论"；
 * `UPD`（编辑评论正文）**今天不报** —— 偏好里没有"编辑"这一档，
 * 把它塞进 `added` 会让一次改字变成"新评论"那种假读数（宁可不响，不可响错）。
 */
export function shareActivitiesFromOps(
  ops: readonly DecryptedShareOp[],
  myClientId: string,
): readonly ShareSignalActivity[] {
  const kinds = new Set<ShareSignalActivity>();
  for (const op of ops) {
    if (op.clientId === myClientId) continue;
    if (op.entityType !== 'COMMENT') continue;
    if (op.opType === OpType.Create) kinds.add('added');
    else if (op.opType === OpType.Delete) kinds.add('deleted');
  }
  return [...kinds];
}

/**
 * 拉完之后**新增**的那几条（按 op id 与拉之前的日志作差）。
 *
 * ⚠️ 这一处 `as` 是本包既有的那条线：`ShareLogStorage.load` 声明的是纯核折叠产物的
 * 基类形状（`ShareLogOp`：id/clientId/timestamp/vectorClock），而"该不该吵"要看
 * `entityType`/`opType`。写这份盘的只有 `foldShareOps`，它原样收下已解密 op ⇒ 这两格
 * 实盘上就在，只是纯核的类型**故意**不认识它们（同 `share-replay.ts` 喂 reducer 前那一行）。
 * 判据把这条断言钉住了：`tests/share-signals.spec.ts` 里"字段活着过磁盘"那一臂 ——
 * 哪天某份 `ShareLogStorage` 真的把这两格丢了，那臂会红，而不是让通知静默不响。
 *
 * 🔴 先转类型**再** `filter`：`filter` 把 `readonly T[]` 收成可变 `T[]`，
 * 那时这一行会因为可变性而不是因为类型成立与否报错（我第一次就踩在上面，
 * 报错读起来像"这两个类型不重叠"，其实是 `readonly` 丢了）。
 */
function readFreshOps(
  storage: ShareLogStorage,
  shareId: string,
  before: ReadonlySet<string>,
): readonly DecryptedShareOp[] {
  const ops = (storage.load(shareId)?.ops ?? []) as readonly DecryptedShareOp[];
  return ops.filter((op) => !before.has(op.id));
}

export interface ShareOpsSignalPorts {
  /** share 日志的本地存储：枚举本机已有的 share、并在拉取前后各读一次差集。 */
  readonly storage: ShareLogStorage;
  /** 真正的拉取（宿主递 `pullShareOps` 进来）。 */
  readonly pull: (shareId: string) => Promise<SharePullResult>;
  readonly myClientId: string;
}

export interface ShareOpsSignalHandler {
  onShareOpsSignal(shareId: string): Promise<ShareSignalReading>;
}

export function createShareOpsSignalHandler(
  ports: ShareOpsSignalPorts,
): ShareOpsSignalHandler {
  const idsOf = (shareId: string): ReadonlySet<string> =>
    new Set((ports.storage.load(shareId)?.ops ?? []).map((op) => op.id));

  return {
    onShareOpsSignal: async (shareId) => {
      const knownLocally = ports.storage.list().includes(shareId);
      if (!knownLocally) {
        return { shareId, knownLocally: false, pulled: false, added: 0, activities: [] };
      }

      const before = idsOf(shareId);
      try {
        const result = await ports.pull(shareId);
        const fresh = readFreshOps(ports.storage, shareId, before);
        return {
          shareId,
          knownLocally: true,
          pulled: true,
          added: result.added,
          activities: shareActivitiesFromOps(fresh, ports.myClientId),
        };
      } catch (error: unknown) {
        // 拉不成也要有读数：`error` 是这一趟唯一的痕迹。
        return {
          shareId,
          knownLocally: true,
          pulled: true,
          added: 0,
          activities: [],
          error,
        };
      }
    },
  };
}
