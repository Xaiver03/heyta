/**
 * @heyta/desktop
 *
 * 程序化入口。**只导出与 Electron 无关的部分**（宿主定位 + IPC 契约），
 * 所以它能被 Node 环境的测试直接 import —— 不需要起 Electron。
 *
 * `main.ts` / `preload.ts` 依赖 `electron`，**刻意不从这里导出**：
 * 一旦导出，任何 import 本包的地方都会被迫解析 `electron`。
 */
export { DESKTOP_DB_FILENAME, desktopDbPath, openDesktopHost } from './host.js';
export {
  DESKTOP_CHANNELS,
  handleDesktopRequest,
  type DesktopRequest,
} from './ipc-contract.js';
