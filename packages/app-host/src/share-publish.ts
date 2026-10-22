/**
 * 把一条**已有内容**的清单发布进它的共享（ADR-0068 裁决三）。
 * ==========================================================
 *
 * ## 这一片补的是哪种"不报错的错"
 *
 * 共享一条已经有 30 条任务的清单时，那 30 条的历史在**个人 log** 里，
 * share log 是空的。成员加入后看到 0 条还算直观；真正难受的是下一幕：
 * 作者改第 7 条 ⇒ 路由把一条 `TASK UPD` 发进 share log ⇒ 对面物化出一条
 * **只有那一个字段**的任务（reducer 的逐字段版本化对不存在的实体也是"新增这一格的版本"）
 * ⇒ 成员界面里多出一枚解不出标题的残条目，而作者这边一切正常。
 *
 * 所以"共享"这个动作必须包含**把存量交出去**。这一片就是那一次交出。
 *
 * ## 三条形状约束
 *
 * 1. **逐实体一条 `Create`，不是一条批量 op。** 批量那条形状（`state.ts` 的
 *    `hasTaskBatchMarker`）会把每条成员强制成 `Create` 并盖上 `automationSource`
 *    —— 那是入站自动化的出处（ADR-0064），把"共享发布"伪装成自动化是错的账。
 *    逐实体一条让每个对象之后可独立寻址，也让重发布天然幂等。
 * 2. **幂等判据 = 这个 id 在这份 share 里出现过没有**（含墓碑）。
 *    已在册的不重发：重发一条不带 `deletedAt` 的 `Create` 不会让删掉的复活，
 *    只会在这本日志里并排放两条同 id 的历史，那是噪音不是状态。
 * 3. **只发"本机这一行"名下的条目**，且本机没有这一行就一条都不发。
 *    路由与读侧合并按同一枚 `shareId` 认清单，这里再认第三次才是同源
 *    （所以判据来自 {@link shareRowsOnDevice}，不是一份新的"哪些算这条 share"的实现）。
 *
 * 发出去的每条 intent 走的是**路由派发器**（`createShareRoutingDispatcher` 的产物），
 * 于是标签补发（0067 补一）与分流判定都自动复用，这里不重写第二条"该进哪本 log"。
 */
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';
import type { Note, Task } from '@heyta/domain';

import { shareRowsOnDevice } from './share-view.js';

/** 一条已发布条数的账，加"还剩几条没发出去"。界面按这份报告说话，不猜。 */
export interface SharePublishReport {
  readonly shareId: string;
  /** 真的发出去的条数（任务 + 便签；标签由路由那条另计，它不是"清单里的条目"）。 */
  readonly published: number;
  /** 跳过多少条（这份 share 里已在册）。 */
  readonly skipped: number;
  /**
   * 失败后**没再尝试**的条数（含失败的那一条本身）。
   *
   * 🔴 中途失败时**不继续**：一条都发不出去多半是通道坏了（未登录、密钥没解锁、离线），
   * 继续循环只会在每条任务上撞一次网络超时，把一次点击变成 N 次等待。
   */
  readonly remaining: number;
  /** 失败那一条的 id；成功时为 `undefined`。 */
  readonly failedEntityId?: string;
}

export interface SharePublishPorts {
  /** 个人物化状态：存量条目从这儿读。 */
  getState(): MaterializedState;
  /** **路由**派发器（不是引擎的 `dispatch`）—— 见文件头约束 3 末段。 */
  dispatch(intent: OpIntent): Promise<void>;
  /** 这份 share **已重放**的物化状态（幂等判据用）。 */
  stateFor(shareId: string): MaterializedState;
}

/** 去掉 `id` 之后的实体字段 —— `entityId` 已经带着身份走线了。 */
function fieldsOf(entity: Task | Note): Record<string, unknown> {
  const { id: _id, ...rest } = entity;
  return rest;
}

/**
 * 把这条共享清单的存量任务与便签发布进 share log。
 *
 * 可重复调用：第二次只会补上第一次没发出去的那些（幂等判据见文件头约束 2）。
 */
export async function publishSharedListContents(
  shareId: string,
  ports: SharePublishPorts,
): Promise<SharePublishReport> {
  const personal = ports.getState();
  const rowId = shareRowsOnDevice(personal).get(shareId);
  const empty: SharePublishReport = { shareId, published: 0, skipped: 0, remaining: 0 };
  // 本机没有这一行（没加入过 / 已取消共享）⇒ 没有"这条清单的存量"这个东西可发。
  if (rowId === undefined) return empty;

  const shareState = ports.stateFor(shareId);
  const queue: { entityType: 'TASK' | 'NOTE'; entityId: string; payload: Record<string, unknown> }[] = [];
  let skipped = 0;

  const collect = (
    bucket: Record<string, Task> | Record<string, Note>,
    entityType: 'TASK' | 'NOTE',
    alreadyInShare: Record<string, unknown>,
  ): void => {
    for (const entity of Object.values(bucket)) {
      if (entity.projectId !== rowId) continue;
      // 回收站与彻底删除里的条目不是共享内容（成员不该在本机的清单里看见它们）。
      if (entity.deletedAt !== undefined || entity.purgedAt !== undefined) continue;
      if (alreadyInShare[entity.id] !== undefined) {
        skipped += 1;
        continue;
      }
      queue.push({ entityType, entityId: entity.id, payload: fieldsOf(entity) });
    }
  };
  collect(personal.tasks, 'TASK', shareState.tasks);
  collect(personal.notes, 'NOTE', shareState.notes);

  // 确定顺序：id 字典序。失败时"剩几条"必须是可复现的数，而不是对象插入顺序的副产品。
  queue.sort((a, b) => (a.entityId < b.entityId ? -1 : 1));

  let published = 0;
  for (const [index, item] of queue.entries()) {
    try {
      await ports.dispatch({
        entityType: item.entityType,
        entityId: item.entityId,
        opType: OpType.Create,
        payload: item.payload,
      });
      published += 1;
    } catch (error) {
      throw new SharePublishIncompleteError(
        { shareId, published, skipped, remaining: queue.length - index, failedEntityId: item.entityId },
        error,
      );
    }
  }
  return { shareId, published, skipped, remaining: 0 };
}

/**
 * 发布中途失败的**具名**错误：带上已经发出的条数与还剩几条，让界面能说"发到一半"。
 *
 * 🔴 为什么**必须抛**而不是只返回一份报告：调用方漏读报告的那个形状，
 * 症状恰好就是这条线一直在防的"共享按了、界面没报错、对面只拿到半份"。
 * 抛出之后 `report` 是附带的账，不是"要不要看"的选项。
 *
 * 原始错误挂在标准 `cause` 上（ES2022）—— 上层要能分清"通道压根没装上"（第一条就抛）、
 * 网络断了、还是服务端按 role 拒了。所以一条都没发出去时这句别说成"发到一半"。
 */
export class SharePublishIncompleteError extends Error {
  readonly code = 'SHARE_PUBLISH_INCOMPLETE' as const;
  readonly report: SharePublishReport;
  constructor(report: SharePublishReport, cause: unknown) {
    super(
      report.published === 0
        ? `发布共享清单 ${report.shareId} 一条都没发出去（${String(report.remaining)} 条待发，第一条 ${String(report.failedEntityId)} 就失败了）`
        : `发布共享清单 ${report.shareId} 中断：已发 ${String(report.published)} 条，` +
          `剩 ${String(report.remaining)} 条未发出（卡在 ${String(report.failedEntityId)}）`,
      { cause },
    );
    this.name = 'SharePublishIncompleteError';
    this.report = report;
  }
}
