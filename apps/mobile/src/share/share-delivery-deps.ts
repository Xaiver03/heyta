/**
 * 共享投递装配的**依赖垫片**（`share-activity-notify.ts` 的 `requireModule()` 读的就是本模块）。
 * ============================================================================================
 *
 * 为什么隔这一层：`installMobileShareActivityDelivery` 必须保证两条信号 sink 已装上
 * （否则"零件都在、线没接"——信号一路打进垫片而垫片没人订，一个错都不报）。
 * 但它**不该静态引** `share-signals` → `wiring` → op-log 那条依赖链 ——
 * 判据要在纯 node 进程里验"装完之后有人在收"，隔一层垫片就能整块换替身
 * （`bindShareDeliveryDeps`），生产侧走的就是这份静态图。
 */
export { installMobileShareSignals } from './share-signals';
