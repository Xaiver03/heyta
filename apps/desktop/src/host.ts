/**
 * 桌面宿主：**唯一**的平台差异是「库文件放在哪」
 * ================================================
 *
 * ADR-0003 §2.1 要求所有业务逻辑在 `packages/` 里，`apps/*` 只放平台外壳。
 * 桌面端的判据与 `@heyta/node-host` 共用同一句话：
 *
 * > **这个文件里有没有任何一行在决定"业务上该怎么做"？**
 * > 有，就说明提取得不够。
 *
 * 这里只有两件事：把库文件放到 Electron 的 `userData` 目录下、
 * 然后把请求转发给 `@heyta/node-host`。SQLite 驱动、op-log、同步编排、
 * 设备 id、游标 —— 全部来自共享层，本文件一行都不碰。
 */

import { join } from 'node:path';

import { openNodeHost, type NodeHost, type NodeHostOptions } from '@heyta/node-host';

/**
 * 库文件名。**不要改** —— 改了等于让所有既有用户的本地数据"消失"
 * （应用会新建一个空库，旧库还在磁盘上但没人读它）。
 */
export const DESKTOP_DB_FILENAME = 'heyta.sqlite';

/**
 * 桌面库文件位置：`<userData>/heyta.sqlite`。
 *
 * 为什么用 `userData` 而不是可执行文件旁边：桌面应用安装目录通常**不可写**
 * （macOS 的 `/Applications`、Windows 的 `Program Files`），
 * 而且升级会整个替换掉它 —— 数据放那里等于每次升级都丢数据。
 */
export function desktopDbPath(userDataDir: string): string {
  return join(userDataDir, DESKTOP_DB_FILENAME);
}

/**
 * 打开桌面宿主。
 *
 * 参数**不包含** `dbPath` —— 那是本壳从 `userDataDir` 推出来的，
 * 调用方（渲染进程）**无权**指定。让渲染进程能传路径就等于让它写任意文件。
 */
export async function openDesktopHost(
  options: Omit<NodeHostOptions, 'dbPath'> & { userDataDir: string },
): Promise<NodeHost> {
  const { userDataDir, ...rest } = options;
  return openNodeHost({ dbPath: desktopDbPath(userDataDir), ...rest });
}
