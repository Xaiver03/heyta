/**
 * 共享清单的**写路径路由**（ADR-0067 裁决一与其两条补充裁决、ADR-0068 裁决一的唯一实现处）。
 *
 * ## 它钉的判断
 *
 * 一个用户意图要么进**个人 op-log**，要么进**这份共享清单的 share log**，二选一。
 * 判据只有一条：这条实体所属清单的 `Project.shareId` 是否在册
 * （不按实体类型、不按成员角色 —— 角色是服务端上传边界的事）。
 *
 * 🔴 这份逻辑**只许住在这里**。它此前住在 `comment-actions.ts` 的闭包里
 * （`routeShareId` / `shareIdForTask` / `shareIdOfTask`），只吃 `taskId`。
 * 任务族也要用同一条判据时，如果各自再写一遍"这条清单是不是共享的"，
 * 两份实现迟早对"什么算共享"给出不同答案 —— 那正是这条线一直在防的漂移。
 *
 * ## 三条不显然的形状约束
 *
 * 1. **清单这条记录本身不是共享内容**（ADR-0068 裁决一，收窄 0067 裁决一的 PROJECT 那一支）：
 *    `entityType === 'PROJECT'` 一律 `kind-not-routable` ⇒ 走个人 log，`shareId` 在册也不例外。
 *    判据只留这一处：挂接（`shareId` 写进去）与解绑都是同一条 PROJECT 规则的形状，
 *    不再单开一个"这条 intent 在改绑定"的守卫 —— 两处判同一件事，迟早给出两个答案。
 * 2. **跨边界移动一律具名拒绝**（0067 补二）：`moveToProject` 把 `projectId` 从共享清单改成
 *    个人清单（或反向、或两条共享清单之间）时，一侧回放得到残缺实体，而"移出"在 E2EE
 *    追加日志上**收不回已经复制出去的密文**。宁可拒绝，不许悄悄只写一半。
 * 3. **标签发布是一条独立意图**（补一）：`Tag` 没有清单归属，裁决一解析不出它；
 *    共享任务的 `tagIds` 若不带对应标签进 share log，对面就渲染出一枚解不出名字的空白标签。
 *    所以写共享任务的 `tagIds` 时，**尚未在这份 share 里**的 tagId 各补一条 TAG 创建 op。
 *    它是另一条 op，因为它是另一个意图（"这份清单里得先有这个名字"），不是同一个意图拆两条。
 */
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';

import type { ShareOpDispatchIntent } from './share-client.js';

/** 解析不出 shareId 的原因。读侧只需要"没有可路由的"，写侧要能说出是哪一格。 */
export type ShareRouteBlock =
  | 'entity-not-found'
  | 'has-no-project'
  | 'project-not-found'
  | 'project-not-shared'
  | 'kind-not-routable'
  | 'channel-unavailable';

export type ShareRoute = { readonly shareId: string } | { readonly blocked: ShareRouteBlock };

/**
 * 实体属于共享清单，但这台设备**没有装上 share 写通道**（未登录、密钥没解锁、
 * 或该端还没接线）⇒ 具名拒绝。
 *
 * 🔴 **不许退回个人 log。** 那正是这条线一直在防的形状：写"成功"了、界面也更新了，
 * 但对面的成员永远看不到 —— 症状与 M2 之前一模一样，只是这次连错误都没有。
 *
 * ⚠️ 已知边界（登记在计划里，不在本批解）：share 通道今天是**先上传再落本地**，
 * 而个人引擎是先落盘再补传。所以离线时对共享清单的写会撞到这个错误上 ——
 * 那与"本地优先"是有张力的，因此 M2 期间共享入口仍留在实验开关后面（P-1 不翻案）。
 */
export class ShareChannelUnavailableError extends Error {
  readonly code = 'SHARE_CHANNEL_UNAVAILABLE' as const;
  constructor(entityType: string, entityId: string, shareId: string) {
    super(`条目 ${entityType} ${entityId} 属于共享清单 ${shareId}，但这台设备当前用不了共享写通道（未登录或密钥未解锁）`);
    this.name = 'ShareChannelUnavailableError';
  }
}

/** 跨边界移动被拒（ADR-0067 补二）。具名错误：静默忽略会让用户以为"移动成功了"。 */
export class ShareCrossListMoveError extends Error {
  readonly code = 'SHARE_CROSS_LIST_MOVE_NOT_SUPPORTED' as const;
  constructor(entityId: string, fromProjectId: string | undefined, toProjectId: string | undefined) {
    super(
      `共享清单里的条目暂不支持跨清单移动（实体 ${entityId}：${String(fromProjectId ?? '未归属')} → ${String(toProjectId ?? '未归属')}）。` +
        '移出共享清单不能收回已经发给其他成员的副本，见 ADR-0067 补二。',
    );
    this.name = 'ShareCrossListMoveError';
  }
}

const live = <T extends { deletedAt?: number | undefined }>(entity: T | undefined): entity is T =>
  entity !== undefined && entity.deletedAt === undefined;

/** 这条实体挂在**哪条清单**上；`undefined` = 没有清单归属（标签、未归属便签）。 */
function owningProjectId(state: MaterializedState, entityType: string, entityId: string): string | undefined {
  switch (entityType) {
    case 'TASK': {
      const task = state.tasks[entityId];
      return live(task) ? task.projectId : undefined;
    }
    case 'NOTE': {
      const note = state.notes[entityId];
      return live(note) ? note.projectId : undefined;
    }
    case 'COMMENT': {
      const comment = state.comments[entityId];
      if (!live(comment)) return undefined;
      const task = state.tasks[(comment as { taskId?: string }).taskId ?? ''];
      return live(task) ? task.projectId : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * 这条实体的类型**能不能**按清单归属路由。
 *
 * 🔴 没有 `PROJECT`：清单这条记录本身不是共享内容（ADR-0068 裁决一）——
 * share 域里没有"清单"这个实体，每个成员的那条行是各自设备上各自 id 建的，
 * 把 A 的 `PROJECT UPD` 发进 share log，对面物化出的是一条本机没有对应行的记录。
 * 也没有 `TAG`：它没有清单归属（0067 补一），只能靠"发布"那条形进 share log。
 */
function isRoutableKind(entityType: string): boolean {
  return entityType === 'TASK' || entityType === 'NOTE' || entityType === 'COMMENT';
}

/**
 * 某条**清单行**是不是共享的、属于哪份共享；不是 ⇒ `undefined`。
 *
 * 这枚是"清单 → shareId"这一跳的**唯一**出处：路由判据与跨边界判定都要读它，
 * 各写一份就会对"这条清单算不算共享的"给出不同答案。
 */
export function shareIdOfProject(state: MaterializedState, projectId: string | undefined): string | undefined {
  if (projectId === undefined) return undefined;
  const project = state.projects[projectId];
  if (!live(project)) return undefined;
  const shareId = (project as { shareId?: string }).shareId;
  // 空串按"没有"处理：`setProjectShareId` 会拒绝空串，但物化状态可能来自远端 op，不能假定它守规矩。
  if (shareId === undefined || shareId.trim() === '') return undefined;
  return shareId.trim();
}

/**
 * 两跳解析（实体 → 所属清单 → `shareId`）—— 全仓**唯一**一份。
 *
 * 它只解析、不决定说什么：写侧拿它决定进哪本 log（进 share 时要能说出原因），
 * 读侧拿它返回 `undefined`（"这里没有共享内容可拉"不是错误）。
 */
export function routeShareIdForEntity(state: MaterializedState, entityType: string, entityId: string): ShareRoute {
  if (!isRoutableKind(entityType)) return { blocked: 'kind-not-routable' };
  const projectId = owningProjectId(state, entityType, entityId);
  if (projectId === undefined) {
    const exists = entityType === 'TASK' ? live(state.tasks[entityId])
      : entityType === 'NOTE'
        ? live(state.notes[entityId])
        : live(state.comments[entityId]);
    return { blocked: exists ? 'has-no-project' : 'entity-not-found' };
  }
  if (!live(state.projects[projectId])) return { blocked: 'project-not-found' };
  const shareId = shareIdOfProject(state, projectId);
  if (shareId === undefined) return { blocked: 'project-not-shared' };
  return { shareId };
}

/**
 * 这条意图是不是**跨边界移动**（0067 补二）。
 *
 * 只在 payload 真写了 `projectId` 时判（`undefined` = 这次没碰那一格）。
 * 两端都算：进共享、出共享、两条共享之间 —— 第三形虽然两侧都在 share log 里，
 * 但**两份 share 的密钥不同**，跨过去等于把内容从一把钥后搬到另一把钥后，属 M3/M4 那一族。
 *
 * ⚠️ 两跳都走 {@link shareIdOfProject}，**不走** `routeShareIdForEntity`：
 * 目的地是一个 `projectId`，而 PROJECT 这个类型按裁决一不进共享 —— 拿它去解析会永远
 * 返回 `kind-not-routable`，于是"移入共享清单"被读成"从共享移到没有"，判据反向失效。
 */
export function crossesShareBoundary(state: MaterializedState, intent: OpIntent): boolean {
  if (intent.entityType !== 'TASK' && intent.entityType !== 'NOTE') return false;
  const payload = intent.payload as Record<string, unknown> | undefined;
  if (payload === undefined || !('projectId' in payload)) return false;
  const fromShare = shareIdOfProject(state, owningProjectId(state, intent.entityType, intent.entityId));
  const to = payload.projectId;
  const toShare = shareIdOfProject(state, typeof to === 'string' && to !== '' ? to : undefined);
  return fromShare !== toShare;
}

/** 这条意图在写 `tagIds` 吗？是的话返回那组 tagId。 */
function tagIdsIn(intent: OpIntent): string[] | undefined {
  if (intent.entityType !== 'TASK') return undefined;
  const payload = intent.payload as Record<string, unknown> | undefined;
  const raw = payload?.['tagIds'];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : undefined;
}

/** 一条已经装好的 share 写通道（`createShareCommentDispatch` 交出来的那两件事）。 */
export interface ShareWriteChannel {
  dispatch(shareId: string, intent: ShareOpDispatchIntent): Promise<void>;
  /** 某份 share **已重放**的物化状态；没加载过时给空状态（`stateFor` 的既有语义）。 */
  stateFor(shareId: string): MaterializedState;
}

export interface ShareRoutingPorts {
  /** 个人 op-log 的唯一写入口（引擎的 `dispatch`）。 */
  personalDispatch(intent: OpIntent): Promise<unknown>;
  /**
   * share 通道的**晚绑定**提供者。
   *
   * 🔴 为什么不直接把通道函数传进来：动作层在模块加载时就装配好了，而 share 通道
   * 要等登录、解锁密钥之后才存在。传死值等于"登录前装的动作永远拿不到通道"；
   * 传提供者则每次派发现问一次"这会儿有没有"。
   */
  channel(): ShareWriteChannel | undefined;
  getState(): MaterializedState;
}

/**
 * 装配出一个与引擎 `dispatch` 同形状的**路由**派发器。
 *
 * 端壳只负责把它交给动作层（装配），**不**在这里之外再判一次"该进哪本 log"。
 */
export function createShareRoutingDispatcher(ports: ShareRoutingPorts): (intent: OpIntent) => Promise<void> {
  return async (intent: OpIntent): Promise<void> => {
    const state = ports.getState();
    if (crossesShareBoundary(state, intent)) {
      const payload = intent.payload as Record<string, unknown>;
      const from = routeShareIdForEntity(state, intent.entityType, intent.entityId);
      throw new ShareCrossListMoveError(
        intent.entityId,
        'shareId' in from ? from.shareId : owningProjectId(state, intent.entityType, intent.entityId),
        typeof payload.projectId === 'string' ? payload.projectId : undefined,
      );
    }
    const route = routeShareIdForEntity(state, intent.entityType, intent.entityId);
    if (!('shareId' in route)) {
      await ports.personalDispatch(intent);
      return;
    }
    const shareId = route.shareId;
    const channel = ports.channel();
    if (channel === undefined) throw new ShareChannelUnavailableError(intent.entityType, intent.entityId, shareId);
    // 补一：先把这份清单还解不出名字的标签发进去，再写那条 tagIds。
    const wanted = tagIdsIn(intent);
    if (wanted !== undefined) {
      const shareState = channel.stateFor(shareId);
      for (const tagId of wanted) {
        if (live(shareState.tags[tagId])) continue;
        const tag = state.tags[tagId];
        if (!live(tag)) continue; // 个人侧都没有 ⇒ 不猜，交给对面那枚空白自己去显形
        await channel.dispatch(shareId, {
          entityType: 'TAG',
          entityId: tagId,
          opType: OpType.Create,
          payload: { name: tag.name, ...(tag.color === undefined ? {} : { color: tag.color }) },
        });
      }
    }
    await channel.dispatch(shareId, {
      entityType: intent.entityType,
      entityId: intent.entityId,
      opType: intent.opType,
      ...(intent.payload === undefined ? {} : { payload: intent.payload }),
    });
  };
}
