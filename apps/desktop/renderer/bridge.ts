/**
 * 渲染进程侧那座桥的**唯一**声明（`window.heytaDesktop`）。
 *
 * 🔴 为什么单独一个文件而不是各页自己写一遍：桌面端有**两个**渲染页
 * （主界面 `main.tsx` 与快速添加 `quick-add.tsx`），而 `declare global` 里
 * 同一个属性声明两次时，TypeScript 要求两份**类型完全一致** ——
 * 抄两遍的话，改一边不会报错，另一边就悄悄变成另一座桥（这正是本仓反复吃亏的
 * "能编译，但结果不对"那一族）。所以形状只留一份。
 *
 * ⚠️ 方法名一律**从契约派生**，不在这里重述：契约是 `src/ipc-contract.ts`。
 */

import type { DesktopCommand, DesktopRequest } from '../src/ipc-contract';

export interface DesktopBridge {
  request(request: DesktopRequest): Promise<unknown>;
  /**
   * 订阅主进程推来的命令（托盘与全局热键的落点都从这里进界面）。
   *
   * 没有返回值：`contextBridge` 不能把主世界的函数递回给页面，
   * 而这两条命令都是幂等的"重新看一眼"，本来也不需要退订。
   */
  onCommand(handler: (command: DesktopCommand) => void): void;
}

declare global {
  interface Window {
    readonly heytaDesktop: DesktopBridge;
  }
}
