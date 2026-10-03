/**
 * 本机数据销毁器：宿主注册、同步层触发。
 * ==========================================================
 *
 * 这里放的是**一个注册表**，而不是"销毁代码"。理由要说清，否则它看起来像
 * 为了绕开一个不该绕的开：
 *
 * 🔴 **触发点与"清哪些东西"分属两个包，而中间那一段今天是断的。**
 *   · 触发点在 `@heyta/sync-client`：它是唯一看得见服务端 `ACCOUNT_CLOSED`
 *     的地方。
 *   · 清哪些东西只有**宿主**知道（Web 是 IndexedDB + OPFS + localStorage +
 *     Service Worker 缓存四类；移动端是 op-sqlite 的文件；node-host 是一个
 *     SQLite 文件）。sync-client 里既没有 `indexedDB` 也没有 `localStorage`，
 *     AGENTS §3.5 也不允许它去猜。
 *   · 而把回调**逐端传下去**这条直路今天走不通：所有原生宿主都经
 *     `openAppHost()` 构造同步客户端，那个文件正被另一条线改；Web 那两处
 *     `createSyncClient({...})` 在 `apps/web/src/features/sync/store.ts`，
 *     同一个原因。
 *
 * 所以：宿主在**自己的启动路径**里注册销毁器（那是平台接线，位置正确），
 * `createSyncClient()` 在共享接缝处装上"读这个注册表"的默认回调。
 * 效果是**任何走共享接缝的宿主都自动获得这条反应**，包括那些我改不动的调用点。
 *
 * ⚠️ 这个间接**不放松"必须有人注册"这件事**：没注册时 `eraseLocalData()`
 * 是**抛错**的，而抛错会被 `SyncClient` 响亮地写进状态与 `console.error`。
 * 静默跳过才是这条路径原来的病。
 */

import type { DbDestroyReport } from '@heyta/storage';

/** 一个宿主的销毁动作：清掉它自己知道的那些存储，并逐类交回凭据。 */
export type LocalEraser = () => Promise<DbDestroyReport[]>;

let registered: LocalEraser | undefined;

/** 最近一次销毁的逐类凭据（取证与判据读它，不读日志）。 */
let lastReports: DbDestroyReport[] = [];

/**
 * 注册宿主的销毁器。传 `undefined` 是**注销**（测试收尾要用，别留全局状态）。
 *
 * 返回被替换掉的那一个：注册表是全局的，而"谁覆盖了谁"在排查
 * "为什么销毁器没生效"时是唯一能看到的信息。
 */
export function registerLocalEraser(next: LocalEraser | undefined): LocalEraser | undefined {
  const previous = registered;
  registered = next;
  if (next === undefined) lastReports = [];
  return previous;
}

/** 当前有没有注册表（判据用它钉"这台设备真的装了销毁器"）。 */
export function hasLocalEraser(): boolean {
  return registered !== undefined;
}

/** 最近一次 `eraseLocalData()` 的逐类结果。没跑过就是空数组。 */
export function lastErasureReports(): readonly DbDestroyReport[] {
  return lastReports;
}

/**
 * 执行本机销毁。
 *
 * 🔴 **没注册 = 抛错，不是空操作。** 这条路径的原始缺陷就是"信号收到了、
 * 本机什么都没少"，而它不报错；把它做成静默返回就等于把那个缺陷搬进新代码。
 *
 * 🔴 **抛错与"部分失败"是两件事，别混：**
 *   · 某一类存储没清掉，**由销毁器自己报进数组**（`containerRemoved: false` + 原因），
 *     不抛 —— 抛了就会让剩下的几类根本不做。Web 的销毁器就是这个形状。
 *   · 销毁器整体抛错（宿主代码坏了）→ 不吞，直接向外抛，由 `SyncClient`
 *     写成「没能清干净」。
 * 所以判据读的是**数组里每一类的 containerRemoved**，不是"有没有抛"。
 */
export async function eraseLocalData(): Promise<DbDestroyReport[]> {
  const eraser = registered;
  if (eraser === undefined) {
    throw new Error(
      '本机没有注册数据销毁器（registerLocalEraser）：ACCOUNT_CLOSED 收到了，但明文仍在。',
    );
  }
  // 先清空再跑：销毁器抛错时不能留下**上一次**的凭据 ——
  // 那会让一次失败的销毁被读成"上一轮清过了"。
  lastReports = [];
  const reports = await eraser();
  lastReports = reports;
  return reports;
}
