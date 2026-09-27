# PROGRESS — 补上隐私闸门的缺口

## 理解的目标／顺序／最大风险（≤10 行）

1. 目标：让 `packages/ai/src/egress.ts` 的 `retainValidConsents()` 有真实生产调用点，
   并让 `AiSettings.tsx` 的授权目的地由 `classifyDestination()` 推导，不再硬编码。
2. 修的是：删掉远端端点后旧授权留在存储里，再配一个新远端端点时被自动放行
   （用户没同意过的组合）。
3. 顺序：任务 0 核对基线 → 写红测试 → 改 `AiSettings.tsx` → 贴绿 → 反向验证（改回不调用）→ 复跑三条基线。
4. 最大风险：`retainValidConsents(consents, currentDestination)` 只收一个目的地，
   而界面可同时挂多个端点；按功能分组后仍必须只由它做目的地过滤，不得另写一套过滤。
5. 只改 `packages/ai/src/**`、`packages/ai/tests/**`、`apps/web/src/features/settings/**`、`apps/web/tests/**`。
6. 算得对 > 改得少 > 做得快；拿不准进 BLOCKED.md，不停下等。

## 任务 0 基线（2026-09-27 要求值）

| 命令 | 要求 | 实测（交付前） | 结论 |
|---|---|---|---|
| `pnpm --filter @heyta/ai test` | 4 文件 / 144 passed | 4 passed / 144 passed | ✅ 未变差 |
| `pnpm --filter @heyta/web test` | 23 文件 / 478 passed ｜ 12 skipped | 23 passed ｜ 2 skipped；479 passed ｜12 skipped | ✅ 未变差（+1 为本次新增测试） |
| `pnpm check` | exit 0 | exit 0（build + typecheck + 全门禁 + e2e 13 passed） | ✅ |
| `pnpm --filter @heyta/web typecheck` | —（额外） | exit 0 | ✅ |

> 说明：`pnpm check` 第一次跑时 exit 1（并发 agent 未跟踪的 doc 引用失效），
> 复跑已 exit 0；经过记在 BLOCKED.md。
> web 第一次跑出 3 个失败文件，原因是并发 agent 正在重建
> `packages/design-system/dist`（chunk 竞态）；复跑即回到基线。

## 改动

- `apps/web/src/features/settings/AiSettings.tsx`
  - 新增 `destinationForFeature()`：由 `classifyDestination()` 推导目的地（替换硬编码）。
  - 新增 `recomputeConsents()`：**唯一**通过 `retainValidConsents()` 做目的地过滤；
    按功能归堆后逐功能调用，不另写比对规则。
  - 新增 `updateRouting()`：所有端点/路由改动都走它 → 顺手重算授权并写回。
  - `grant()` 用推导目的地；本地端点不产生授权记录。`revoke()` 清干净该功能授权。
  - `routeTouchesRemote()` / `hasConsent()` 改用推导目的地。
- `apps/web/tests/ai-settings.spec.tsx`
  - 新增一条红→绿测试：删旧远端端点 → 授权即刻清空 → 配新远端端点并接上路由 →
    必须重新征求同意（不出现 `granted`，出现 `consent`）。

## 进度

- [x] 任务 0：核对基线
- [x] 新增红测试（改前红，证据见对话）
- [x] 实现：目的地推导 + `retainValidConsents` 写回
- [x] 反向验证：改回"不调用" → 红；还原 → 全绿
- [x] 复跑三条基线（`pnpm check` exit 0）
- [x] BLOCKED.md（无待裁决）

## 已知边界（非缺陷，设计粒度）

授权记录的类型是 `(feature, EgressDestination)`，而 `EgressDestination` 是**粗粒度**枚举
（`none` / `user-endpoint` / `heyta-cloud`）—— 这与 `authorizeEgress()` 运行时比对的粒度一致。
因此"远端 A 的 URL 直接改成远端 B"仍是同一目的地类别，不会触发重新征求；
本次修的是跨类别/经过 `none` 的陈旧授权复活（删端点→加新端点是典型路径）。
若要按 URL 逐端点授权，需要先扩 `EgressConsent` 的类型，属于超出本任务范围的决策。
