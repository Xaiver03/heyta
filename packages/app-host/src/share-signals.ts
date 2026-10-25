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
 *     见过哪些 share"是本地事实。拿一个本地没有的 shareId 去 `downloadOps` 只会 404
 *     ⇒ 抛错 ⇒ 被实时回调吞掉 ⇒ 变成一条永远不会出读数的死路。
 *     ⚠️ "认得"有**两条**本地途径，两条都算（缺一都会静默不响，而且各对应一种真形状）：
 *       · `knownShareIds()` —— 这台设备上有清单行绑着这份 share（`shareIdsOnDevice`）。
 *         🔴 这是**刚入群那台设备**唯一的痕迹：它一条 op 都还没拉过，所以落盘日志的索引
 *         是空的。只认索引的话，第一份别人写的内容会因为"本机还不认识它"被丢掉，而
 *         这个判据是自锁的 —— 不拉就永远不进索引，进了索引才允许拉。M2 的界面腿
 *         （`verify:collab-journey` 两台互见那一格）实测到的就是这一形。
 *       · `storage.list()` —— 这份日志在本机落过盘（拉过或写过）。
 *     边界不变的那一半：这台设备**从没绑定过**这份 share（在另一台设备上被邀请）仍不由
 *     这条路径带来 —— 它靠共享面板那趟 `GET /api/shares`。
 *  2. **一次信号只吵一次。** 活动是从**日志的差集**算出来的（按 op id），不是从
 *     `SharePullResult.added` 猜的：折叠会把重复吃掉，同一条 op 被信号推两次
 *     （服务端不去抖，见 `websocket-connection.service.ts` 那段注释）时
 *     第二次差集为空 ⇒ 不响。按 `added` 数响就会把同一条评论吵两遍。
 *  3. **自己不吵自己。** 按 `clientId` 滤掉本设备写的 op —— 自己动手的事不需要通知自己。
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
 *   这里刻意**不含** `'completed'`：那是"共享任务被勾完成"。M2（ADR-0067 裁决一/补三）之后
 *   `TASK` 的 op **已经**在这份共享日志里了，缺的不再是输入而是**档位本身** —— 通知偏好表里
 *   还没有"有人加了任务 / 有人勾了完成"那两句措辞，而给它们造映射属另一件要单独判的事
 *   （见 `tests/share-signals.spec.ts` 的"非 COMMENT 的 op ⇒ 不响"那一臂）。
 */
export type ShareSignalActivity = 'added' | 'deleted';

export interface ShareSignalReading {
  readonly shareId: string;
  /** 这台设备认不认得这份 share（本机清单行绑定 或 落盘日志索引，两条途径之一）。 */
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
  /** share 日志的本地存储：在拉取前后各读一次差集，并作为"认得"的第二条途径。 */
  readonly storage: ShareLogStorage;
  /**
   * 这台设备**绑定着**的 shareId 名单（web 递 `shareIdsOnDevice(currentState())`）。
   * 🔴 必填而不是可选：漏了它就退回"只认落盘索引"，症状是**刚入群那台设备永远收不到
   * 第一份内容**，而这条链上除了界面腿没有任何东西会红。
   */
  readonly knownShareIds: () => readonly string[];
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
      const knownLocally = ports.knownShareIds().includes(shareId) || ports.storage.list().includes(shareId);
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

/** `pullSharedListOnOpen` 的端口：只需要"拉"这一件事，与信号那一路共用同一个 `pullShareOps`。 */
export interface ShareOpenPullPorts {
  readonly pull: (shareId: string) => Promise<SharePullResult>;
}

export interface ShareOpenPullReading {
  readonly shareId: string;
  /** 这一趟真的发了拉取（装配缺席时为 `false`）。 */
  readonly pulled: boolean;
  readonly added: number;
  readonly error?: unknown;
}

/**
 * **打开一份共享清单 ⇒ 把既有下行拉一次**（M6 设备腿 L2 抓出来的洞，两壳同形）。
 *
 * 为什么要有这一枚：`new_share_ops` 只在**有人新写**的时候响，而"这份清单里本来就有
 * 的东西"没有任何一条路径会带来。加入那台设备拿到信封、建好本地清单行之后，
 * 屏幕上就是空的 —— 而且它**一直**空到有人在对面新写一条为止（信号才会把它叫醒）。
 * 2026-10-25 iOS 设备腿第一次把这一格量出来（`07-看不到owner的任务.png`：成员名册已经
 * 下来了，评论区那一节写「这条共享清单里还没有任务」）。web 那侧同一个洞，只是
 * `verify:collab-journey` 从来只测"加入之后写的东西互见"，测不到"加入之前就有的东西"。
 *
 * 三条口径：
 *  · **每次打开都拉**，不判"这台设备以前拉过没有"。游标在 `pullShareOps` 里，
 *    追平时那一趟只是取回零条 —— 与 ADR-0070 对成员信号"人按一次按钮的量级，不去抖"
 *    同一条判断；而"离线一段时间再打开"这一形只有无条件拉才盖得住。
 *  · **不抛穿**。调用点是界面挂载的那一趟，抛出去会变成"打开清单弹错误"，
 *    而这条路径上失败是常态（保险库锁着 ⇒ 解不开）。失败如实留在 `error` 里。
 *  · **这一枚只决定"要不要拉、拉了算不算成"**（业务语义，AGENTS §3.5 不许进壳）；
 *    "什么时候算打开"由各壳自己说，两壳各只有一处调用点。
 */
export async function pullSharedListOnOpen(
  ports: ShareOpenPullPorts,
  shareId: string,
): Promise<ShareOpenPullReading> {
  if (shareId.trim() === '') return { shareId, pulled: false, added: 0 };
  try {
    const result = await ports.pull(shareId);
    return { shareId, pulled: true, added: result.added };
  } catch (error: unknown) {
    return { shareId, pulled: true, added: 0, error };
  }
}
