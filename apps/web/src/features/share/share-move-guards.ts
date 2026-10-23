/**
 * 「换清单」这个动作在界面上**该不该摆出来** —— 端壳装配（ADR-0067 补二的落地形状）
 * =========================================================================
 *
 * 补二定的是两件事：宿主侧给**具名错误**，而界面在 M2 期间**不提供**这个动作。
 * 后半句以前没做：行尾的整理下拉、详情栏的同一个下拉、批量工具栏那枚移动选择器
 * 都把共享清单端给用户选，选了之后靠派发器抛错。而单条那一支的报错文案是
 * 「这一步没有保存成功。你的改动还在本地，可以重试。」—— 那句在这里是**假**的：
 * 重试多少次都不会成功，也没有任何东西"还在本地等着保存"。
 *
 * 🔴 判断不在这份文件里：`isCrossListMoveBlocked` 住 `@heyta/app-host`，而且它内部
 *    用的就是派发器那一句 `crossesShareBoundary`（同一个判据，两处消费）。这里只做
 *    一件事：把**合并视图**递进去（AGENTS §3.5）。
 *    递个人状态会漂：对面那台建的任务只在合并视图里存在，用个人状态判就会把
 *    "这条在共享清单里"读成"这条不在任何共享清单里"，于是动作照样摆出来。
 */

import { isCrossListMoveBlocked } from '@heyta/app-host';

import { currentState, hasEngine } from '../../lib/oplog.js';

/**
 * 把这条任务移到 `destinationProjectId`（`undefined` = 收集箱）会不会撞上补二那道门。
 *
 * ⚠️ 引擎还没就绪时返回 `false`（= 不挡）：没有状态就没有"归属"可判，而那一刻界面上
 * 也还没有任何一条任务可整理。这一支只在冷启动早期与组件级测试里可达。
 */
export function moveBlockedForTask(
  taskId: string,
  destinationProjectId: string | undefined,
): boolean {
  if (!hasEngine()) return false;
  return isCrossListMoveBlocked(currentState(), 'TASK', taskId, destinationProjectId);
}
