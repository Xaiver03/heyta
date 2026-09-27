/**
 * "本地刚写了一条 op"的信号
 * ============================
 *
 * 🔴 存在的理由是一个**循环依赖**：数据库层要通知"写入了"，
 * 而自动同步要调 `syncNow()`，`syncNow()` 又要开宿主（`openTaskHost`），
 * 宿主又回到数据库层 —— `open-host → auto-sync → store → open-host`。
 *
 * 循环在 ESM 的活绑定下**能跑**（只要不在模块求值期调用），但它是脆的：
 * 换打包器、换求值顺序、或者哪天有人在模块顶层调用一次，就会变成
 * "拿到了 undefined 然后静默什么都不做" —— 而症状又是**同步不触发**，
 * 和自动同步根本不生效长得一模一样。
 *
 * 所以把它拆成**零依赖**的一层：
 *   · 数据库层只管喊一声"写了"（`emitLocalWrite`），它不知道同步的存在；
 *   · 自动同步订阅（`onLocalWrite`），它不知道数据库的存在。
 *
 * 这也不是"造轮子"：这是 15 行的依赖倒置，没有现成库里能拿来用的对应物
 * （本仓库的 `sync/store.ts` 里也是同一个 `Set` + 订阅的形状）。
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** 订阅"本地写入"。返回退订函数。 */
export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 宣告一次本地写入（op **已经落库**之后才调）。
 *
 * ⚠️ 必须在 `await dispatch(...)` **成功之后**调：写在之前的话，
 * 同步可能先跑去查队列，而那条 op 还没提交 —— 于是这次写入要等到
 * 下一次触发才出去（静默延迟，不报错）。
 */
export function emitLocalWrite(): void {
  for (const listener of listeners) listener();
}
