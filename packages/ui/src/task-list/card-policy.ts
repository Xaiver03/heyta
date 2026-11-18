/**
 * `TaskList` 的 `listCard` 开关 —— **"是否画卡"的唯一判断处**
 * ========================================================
 *
 * 背景：`TaskList` 的 `listCard` 会把整张任务列表画成一张白卡（仅移动端任务页使用，
 * 对齐滴答的"分组卡"观感）。但列表为空时，空状态会被这张白卡包住 —— 观感像一张
 * 孤零零的框。空态应当**直接落在页面上**，而不是被白卡包起来，所以：空列表不画卡。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这个判断单独放在本文件（而不是写在 `TaskList.tsx` 里）
 *
 * 它是一段**纯逻辑**：只由 `listCard` 与列表项数量决定，无副作用，
 * 不 import `react-native`、不 import 任何 UI/样式、不含裸设计值。
 *
 * 把它抽到这样一个不含 RN 的模块里，是为了让"卡画不画"这条判断能在 node 环境被
 * vitest 直接测 —— 这与 `density.ts` 文件头关于 node 测试的说明是同一类理由：
 * `TaskList.tsx` / `TaskRow.tsx` import 了 `react-native`（Flow 源码，node 解析不了），
 * 任何 import 它们的测试必然挂；把判断挪到这个纯模块，"空列表不画卡"才能被单测钉住
 * （见 `tests/card-policy.spec.ts`）。
 *
 * ⚠️ 本文件不新增、也不引用任何 token 或样式：它只回答"画不画卡"，
 * 卡长什么样仍然在 `TaskList.tsx` 的 `StyleSheet` 里。
 */

/**
 * 列表在**当前内容**下是否应该画成一张白卡。
 *
 * 语义：只有 `listCard === true` 且列表里至少有一项（`itemCount > 0`）时才画卡；
 * 其余一律返回 `false` —— 未开启 `listCard`、或列表为空（防御性地连负数
 * `itemCount` 也一并落到 `false`）。空态不应被白卡包住，应直接落在页面上。
 */
export function shouldShowListCard(listCard: boolean, itemCount: number): boolean {
  return listCard === true && itemCount > 0;
}
