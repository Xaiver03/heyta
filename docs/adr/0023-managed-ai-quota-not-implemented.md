# ADR-0023：托管 AI 的「300 次/月」**本轮不实现** —— 先把承诺与实现绑起来

> 状态：**已接受**
> 日期：2026-09-29
> 取代：无。本 ADR **不**改动 [ADR-0020](0020-ai-subscription-two-tiers.md) /
> [ADR-0021](0021-managed-ai-model-deepseek-flash.md) 的任何价格、额度或模型结论 ——
> 它判定的是**这些结论的落地顺序**：额度先记在文档里，计量与端点后做。
> 相关：[ADR-0013](0013-cloud-ai-and-maas.md) §2（会提供统一云端 AI 并按此收费）。

## 1. 背景与约束

ADR-0020/0021 已经把「¥12 / 月 · 300 次/月 · `deepseek-flash`」定成一个**卖的结论**。
但把仓库按事实摊开，这档**交付不了**：

| 要交付「300 次/月」，至少需要 | 仓库现状 | 证据 |
|---|---|---|
| 一个我们的云端 AI **端点**（用户不带 key 也能用） | **不存在** | `server/src/routes/` 目录不存在；`packages/ai/src/` 只有 `provider.ts` / `routing.ts` / `egress.ts` / `presets.ts` / `supply.ts` / `health-store.ts` —— **全部是自带端点（BYO）那一层** |
| 计量（每周期用了几次） | **不存在** | 全仓 `quota` / `metering` 只命中**同步存储配额**（`server/src/sync/sync.routes.quota.ts` 等），与 AI 次数无关 |
| 模型的真实调用 | **不存在** | `grep -rn deepseek server/src packages/*/src` → **0 命中**。模型 id 只写在 ADR 与文档里 |
| 一个能卖 ¥12 的收银台 | **收银台已通，但 ¥12 档被主动禁售** | `POST /api/billing/checkout` 已注册（[pricing-and-coupons.md](../reference/pricing-and-coupons.md) §7 第 18 条）；`price-book.ts` 的 `NOT_YET_DELIVERABLE_SKUS` 让 `hosted-ai-monthly` 在报价前就回 `409`（`checkout.routes.ts` 调用 `notSellableReason`），并由 `check:ai-quota` §3b 钉住 |
| 设置页的「本周期已用 X / 300 次」 | **不存在** | 法务 §5.3 承诺了它 |

而**对外的承诺已经发出去了**，至少 5 处：

- `packages/i18n/src/locales/zh-CN.ts` : `landing.pricing.hostedAi.feature2` = 「云端 AI，每月 300 次」
- `packages/i18n/src/locales/en.ts` : `landing.pricing.hostedAi.feature2` = 「Cloud AI, 300 actions a month」
- `server/legal/terms-of-service.ai.heyta.md` §5.3/§6：「设置页可以查到本周期已用 X / 300 次」「到点即停」
- `docs/reference/pricing-and-entitlements.md` §3 的能力矩阵、§3.5 的单位经济
- `docs/adr/0020-ai-subscription-two-tiers.md` §3.2/§3.6

**这就是本 ADR 要解决的问题**：不是"要不要做云端 AI"，而是
**"已经写下的承诺"与"代码里的实现"之间现在没有任何绑定**。
后果具体且昂贵：谁照着落地页去接线收银台，谁就会卖出一档**收了钱交付不了**的服务，
而 `pnpm check` 的每一道门禁都会是绿的 —— 因为门禁校验的是**收多少钱**与**怎么写文案**，
没有任何一道校验**承诺的东西是否存在**。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 本轮不实现，写进 ADR + 加一条"承诺 ↔ 实现"可失败门禁** | 与仓库现状一致；把"不做"变成一个**有终点、可复算**的决定；承诺漂移立刻变红 | 读者要读 ADR 才知道"300 次现在用不上" | 上表：五个前置条件里**一个都没有** |
| B. 现在补计量（表 + 计数器 + 闸门），端点后做 | 端点来时额度已经能用了 | 计量为**不存在的调用**而建：次数永远为 0，测试只能自证。是"空转的代码" —— 本仓库已经因为 `settleOrderPaid` 无调用方吃过一次这个教训 | `settleOrderPaid` 曾长期无生产调用方（§7 第 9 条；**已于 2026-09-27 接通**） |
| C. 现在就建云端 AI 端点 + 计量 + 收银台 | 一步到位 | 这是**一个独立工作流**（provider 客户端、出口与内容审核、成本熔断、鉴权、路由、收银台），不是"补一个计数器"；在收银台本身还不存在时开工，顺序是错的 | `server/src/routes/` 不存在 |
| D. 把「300 次/月」从文案与法务里撤掉 | 承诺与实现立刻一致 | 与**已锁定的产品决定**冲突（用户已定：¥12 含 AI，300 次/月）。而且撤掉文案不等于不欠交付 —— 决定依然要做 | ADR-0020 §3.2 |

## 3. 结论

**托管 AI（¥12 档 · 300 次/月）在本轮不实现。** 决定按这个顺序落地：

1. **`hosted-ai-monthly` 在「计量存在」之前不得被售卖。**
   落地页**可以**继续描述它（产品决定已锁定），但收银台不许把它变成一笔可支付的订单。
   🔴 这条是硬约束：违反它等于收钱不交付。
2. **「300 次/月」只有一个数字源。** 5 处承诺里的数字必须永远一致，
   由一条可失败的门禁钉住（见 §4 第 1 条）。
3. **实现它的最小清单已写在本 ADR 里**（§5），所以"不做"不是拖延，
   而是一个**有终点的决定**：清单清空之日，就是这条 ADR 被取代之日。

> ⚠️ **为什么"不实现"在这里是负责任的答案**：五个前置条件一个都不具备，
> 而承诺已经在文案与法务里。此刻正确的动作是**把决定与现状写清楚、
> 把漂移变成红灯**，而不是在一个不存在的端点上建一个永远为 0 的计数器。

## 4. 后果

1. **新增门禁 `pnpm check:ai-quota`**（`scripts/check-ai-quota-consistency.mjs`）。
   它做三件可失败的事：
   - 从 **i18n（中/英）、法务、参考文档、本 ADR** 五处抽出额度数字，**全部相等**才通过；
   - 本 ADR 必须存在且声明 `enforcement = not-implemented`（状态是**被声明的**，不是被推断的）；
   - `pricing-and-entitlements.md` 必须带上「未启用 / 不可售卖」的显式标记。
   改数字只改一处 → 红；删掉状态声明 → 红；把状态改成 `enforced` 而计量仍不存在 → 红。
2. **`pricing-and-coupons.md` §7 增一条**（承诺 ↔ 实现的缺口），
   与既有的第 14 条（管理面鉴权缺口）并列 —— 两条都是"文档承诺了、代码没有"的同一类问题。
3. **没有引入任何死代码。** 本 ADR 不新增 `ai-quota.ts` 之类"没人调用"的模块 ——
   那是选项 B 的缺点，本仓库已经吃过一次。
4. **上游调价的时间压力被解除了。** ADR-0021 §5 第 2 条的"外部失效条件"仍然成立，
   但在计量与端点落地之前，它**不会**造成损失 —— 因为这一档卖不出去。

## 5. 实现它的最小清单（清空即取代本 ADR）

按依赖顺序，每一项都要有自己的可失败验证：

1. **云端 AI 端点**：一个需要鉴权的路由，出口经 `packages/ai/src/egress.ts` 的那条纪律。
   验证：路由存在 + 未鉴权返回 401/402。
2. **`ai` 能力闸门**：路由用 `createEntitlementGuard({ capability: 'ai' })`。
   *这一半已经就绪* —— `hosted-ai-monthly` 的 `grants` 已含 `ai`，
   只买 ¥5 的订阅会被判 `GRANT_NOT_INCLUDED`（见本 ADR 同期的订阅行改动）。
3. **计量**：`(userId, periodStart, usedCount)` 三元组，**一个计费周期一行**；
   原子自增（`UPDATE … SET used = used + 1 WHERE used < 300`，靠 `WHERE` 守住并发）。
   验证：PGlite 上并发 N 次只放行 300 次；第 301 次返回明确的"额度用尽"而不是 500。
4. **`到点即停` 的可见性**：设置页的「本周期已用 X / 300 次」。
   法务 §5.3 已经承诺了它 —— 它是**承诺的一部分**，不是可选 UI。
5. **收银台**：`quoteOrder` → `createOrderWithReservation` → `createCheckout` 的接线，
   且 `settleOrderPaid` 成为金额的权威判定处（§7 第 9 条）。
   只有到这一步，`hosted-ai-monthly` 才允许被售卖（§3 第 1 条解除）。

## 6. 未核实项

1. **「300 次/月」没有用户行为数据支撑**（ADR-0020 §5 第 5 条）——
   额度是否够用、是否过大，都要等真实用户。
2. **单次 token 成本是估算**（ADR-0021 §5 第 1 条），误差可能达数倍。
3. **本 ADR 的触发条件是"有人要接云端 AI 端点"**，而不是日历时间。
   如果三个前置条件（端点 / 计量 / 收银台）长期无人认领，
   那么更该被重新审视的是**要不要保留 ¥12 这一档**，而不是本 ADR 的结论。
   这个问题已经记在 `pricing-and-coupons.md` §7。
