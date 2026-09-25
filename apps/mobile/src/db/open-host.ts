/**
 * 移动端宿主打开
 * ==============
 *
 * 🔴 这是 `apps/mobile` 里**唯一**允许存在平台差异的地方（AGENTS.md §3.5 / ADR-0003 §2.1）：
 * 注入哪个 SQLite 驱动。
 *
 * 除此之外这里什么都不做 —— `clientId` 的读取与持久化、同步游标、schema 初始化顺序、
 * 任务 op 的构造，全部在 `@heyta/app-host` 里。判断标准：
 * **这段代码里有没有任何一行在决定"业务上该怎么做"？**
 *
 * 原来这段逻辑内联在 `App.tsx` 里。抽出来的原因是它要被多个屏复用 ——
 * 两处各写一份 `openAppHost({...})` 就是漂移的开始（本项目已经因此吃过一次亏，
 * 见 AGENTS.md §3.5 末尾那两段真实的漂移）。
 */

import { openAppHost, type AppHost } from '@heyta/app-host';
import { opSqliteDriverFactory } from './op-sqlite-driver';

/** 同步服务端地址。真机调试时改成局域网 IP。 */
export const SERVER_URL = 'http://127.0.0.1:3000';

const DB_NAME = 'heyta.sqlite';

let pending: Promise<AppHost> | null = null;

/**
 * 打开（或复用一个已打开的）应用宿主。
 *
 * 🔴 **必须单例。** 每个屏幕各自 `openAppHost()` 会开出**多个 SQLite 连接
 * 与多条 op-log 重放路径**，表现为：在一个 tab 建的任务，切到另一个 tab 看不见，
 * 而且两条写入路径会互相覆盖向量时钟 —— 数据损坏且极难定位。
 *
 * 缓存的是 **Promise 而不是结果**：并发调用（两个屏幕同时挂载）时，
 * 缓一个已 resolve 的值会让第二次调用拿到 null 并再开一次连接。
 * 缓 Promise 让两次调用等的是同一个打开过程。
 */
export function openTaskHost(): Promise<AppHost> {
  if (pending === null) {
    pending = openAppHost({
      // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开。
      driverFactory: opSqliteDriverFactory({ name: DB_NAME }),
      dbPath: DB_NAME,
      serverUrl: SERVER_URL,
    });
  }
  return pending;
}

/** 仅供测试与"重开数据库"这类显式场景使用。 */
export function resetTaskHostCache(): void {
  pending = null;
}