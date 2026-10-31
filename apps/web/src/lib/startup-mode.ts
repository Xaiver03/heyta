/**
 * 这次启动该走哪一条路径 —— **唯一的判定**。
 *
 * ## 为什么是一枚纯函数
 *
 * `main.tsx` 有四个渲染出口，而且它们的**顺序本身**就是契约：
 * `?shell=` / `?slice=` 是验证入口，谁在前面谁就赢；
 * `/admin` 与主应用共用同一个 bundle，只有地址能分开它们（ADR-0038）。
 * 这段判定此前写在入口的 `if / else if` 链里，而入口**不可测**
 * （`apps/web/tests/locale-host.tsx` 记着为什么：import 它就会真去建 root）。
 * 抽出来之后，"`/admin` 走 console 而不是 app" 这件事可以在 jsdom 里逐形状喂。
 *
 * ## 优先级（顺序不能变）
 *
 * 1. `?shell=` —— 原生壳打包后加载的验证入口；
 * 2. `?slice=` —— 通用切片验证入口；
 * 3. `/admin`（含 `/app/admin`）—— 管理后台页；
 * 4. 其余 —— 主应用。
 *
 * ⚠️ `console` 与 `app` 的区别不只是"画哪个壳"：`console` 不初始化本地 op-log
 * （ADR-0078）。把这条分支挪到 `app` 之后，后台页会重新被 OPFS 的排他锁挡住。
 */
import { isAdminConsolePath } from '../features/admin/route.js';

export type StartupMode = 'shell' | 'slice' | 'console' | 'app';

export function startupMode(search: string, pathname: string): StartupMode {
  const params = new URLSearchParams(search);
  if (params.has('shell')) return 'shell';
  if (params.has('slice')) return 'slice';
  // 🔴 必须用与 `AdminConsolePage` 同一个判定（整段相等），不许在这里另写一份
  // `endsWith('/admin')` —— 那会让自托管用户自己的路径把 heyta 切进后台壳。
  if (isAdminConsolePath(pathname)) return 'console';
  return 'app';
}
