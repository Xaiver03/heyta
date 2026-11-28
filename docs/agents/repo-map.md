# 仓库地图（脚本生成）

> ⚠️ **本文件由脚本自动生成，禁止手工改正文**；责任描述只改「人工批注」区，重跑不覆盖它。
> 生成时间：`2026-11-28 18:16:50` · 生成命令：`python3 "$CTX_KIT/bin/ctx" map --root . --out docs/agents`
> 代码指纹 tree_hash：`c4dc5c2974d822c1`（代码一变它就变，供漂移检查用）

- 源码文件：**12097** 个 · 约 **88.3 MB**
- 语言分布：C 6375、TS 2176、C++ 1907、TSX 575、JS 516、Shell 231、Python 196、Swift 68、C# 49、Kotlin 3、Ruby 1

## 1. 目录 → 职责 → 能不能改

| 目录 | 源码文件 | 体积 | 能不能改 |
|---|---|---|---|
| `apps/` | 9558 | 53567 KB | ✅ 可改 |
| `packages/` | 1013 | 14604 KB | ✅ 可改 |
| `server/` | 446 | 6547 KB | ✅ 可改 |
| `scripts/` | 385 | 7223 KB | ✅ 可改 |
| `research/` | 378 | 4859 KB | ✅ 可改 |
| `e2e/` | 234 | 2659 KB | ✅ 可改 |
| `品牌资料/` | 42 | 472 KB | ✅ 可改 |
| `tmp/` | 18 | 133 KB | ✅ 可改 |
| `docs/` | 17 | 321 KB | ✅ 可改 |
| `(root)/` | 2 | 28 KB | ✅ 可改 |
| `design-system/` | 2 | 36 KB | ✅ 可改 |
| `design-demos/` | 1 | 1 KB | ✅ 可改 |
| `assets/` | 1 | 2 KB | ✅ 可改 |

> 「职责」脚本推不出，需在人工批注补；「能不能改」按目录名推断，务必核对。

## 2. 关键入口（优先读这些）

- `apps/desktop/src/index.ts`
- `apps/desktop/src/main.ts`
- `apps/landing/src/pages/index.ts`
- `apps/mobile/index.js`
- `apps/mobile/src/App.tsx`
- `apps/node-host/src/index.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/hta/index.ts`
- `packages/ai/src/index.ts`
- `packages/app-host/src/connectors/index.ts`
- `packages/app-host/src/index.ts`
- `packages/design-system/src/index.ts`
- `packages/domain/src/index.ts`
- `packages/i18n/src/index.ts`
- `packages/inbound-core/src/index.ts`
- `packages/legal/src/index.ts`
- `packages/local-api/src/index.ts`
- `packages/local-api/src/server.ts`
- `packages/op-log/src/index.ts`
- `packages/shared-schema/src/index.ts`
- `packages/shared-schema/src/migrations/index.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/indexeddb/index.ts`
- `packages/storage/src/sqlite/index.ts`
- `packages/sync-client/src/index.ts`

## 3. 枢纽文件 Top 15（被别的文件 import 最多 = 改它风险最大）

| 文件 | 被导入次数 | 谁在依赖它 |
|---|---|---|
| `packages/domain/src/index.ts` | 500 | apps/desktop/renderer/main.tsx, apps/desktop/tests/reuse.spec.ts, apps/desktop/tests/tag-alias-filter.spec.ts, apps/mobile/src/ai/AssistantScreen.tsx … |
| `packages/i18n/src/index.ts` | 475 | apps/landing/pitch/main.tsx, apps/landing/src/components/Capabilities.tsx, apps/landing/src/components/FinalCta.tsx, apps/landing/src/components/Footer.tsx … |
| `packages/app-host/src/index.ts` | 299 | apps/mobile/src/App.tsx, apps/mobile/src/ai/AiSettingsSection.tsx, apps/mobile/src/ai/AssistantScreen.tsx, apps/mobile/src/ai/chat-controller.ts … |
| `packages/ui/src/index.ts` | 262 | apps/desktop/renderer/main.tsx, apps/landing/tests/mockup-project-shape.spec.tsx, apps/mobile/src/ai/AssistantScreen.tsx, apps/mobile/src/ai/chat-transcript.tsx … |
| `packages/design-system/src/index.ts` | 225 | apps/landing/src/components/AssistantIcon.tsx, apps/landing/src/components/Capabilities.tsx, apps/landing/src/components/FinalCta.tsx, apps/landing/src/components/Footer.tsx … |
| `packages/sync-core/src/index.ts` | 217 | apps/mobile/hermes-aed-probe-entry.js, apps/mobile/src/screens/JoinShareScreen.tsx, apps/mobile/src/screens/ProfileScreen.tsx, apps/mobile/src/screens/ShareSpaceScreen.tsx … |
| `packages/storage/src/index.ts` | 191 | apps/mobile/hermes-aed-probe-entry.js, apps/mobile/src/db/op-sqlite-driver.ts, apps/mobile/tests/calendar-event-source.spec.ts, apps/mobile/tests/focus-task-source.spec.ts … |
| `packages/shared-schema/src/index.ts` | 170 | apps/mobile/src/auth/account-security-copy.ts, apps/mobile/src/lib/attachment-pick.ts, apps/mobile/src/lib/avatar-prepare.ts, apps/mobile/src/lib/card-export-units.ts … |
| `packages/op-log/src/index.ts` | 148 | apps/mobile/hermes-aed-probe-entry.js, apps/mobile/src/db/open-host.ts, apps/mobile/src/lib/share-activity-copy.ts, apps/mobile/src/share/share-session.ts … |
| `e2e/tests/helpers.ts` | 134 | e2e/_probe/goal-live-b4.spec.ts, e2e/_probe/goal-live.spec.ts, e2e/auth-journey/auth-journey.spec.ts, e2e/auth-journey/helpers.ts … |
| `server/src/db.ts` | 108 | server/scripts/admin.ts, server/scripts/clear-data.ts, server/scripts/delete-user.ts, server/scripts/pricing.ts … |
| `packages/ai/src/index.ts` | 76 | apps/mobile/src/ai/AiSettingsSection.tsx, apps/mobile/src/ai/AssistantScreen.tsx, apps/mobile/src/ai/chat-composer.tsx, apps/mobile/src/ai/chat-controller.ts … |
| `server/src/logger.ts` | 72 | server/scripts/admin.ts, server/scripts/clear-data.ts, server/scripts/delete-user.ts, server/src/account/access-sessions.ts … |
| `apps/mobile/src/ui/kit.tsx` | 65 | apps/mobile/src/ai/AiSettingsSection.tsx, apps/mobile/src/ai/AssistantScreen.tsx, apps/mobile/src/ai/chain-of-thought.tsx, apps/mobile/src/ai/chat-composer.tsx … |
| `server/src/sync/sync.types.ts` | 62 | server/scripts/dry-run-old-ops-sweep.ts, server/src/automation/worker-identity.ts, server/src/sync/cleanup.ts, server/src/sync/conflict.ts … |

> 枢纽=被其它文件 import 的次数（尽力解析相对/模块路径）。改这些文件前先看清调用方。

## 4. 关键文件里定义了什么（枢纽 + 入口）

- `packages/domain/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/i18n/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/app-host/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/ui/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/design-system/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/sync-core/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/storage/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/shared-schema/src/index.ts` → （无顶层定义 / 未抽出）
- `packages/op-log/src/index.ts` → （无顶层定义 / 未抽出）
- `e2e/tests/helpers.ts` → （无顶层定义 / 未抽出）
- `server/src/db.ts` → `prisma`, `disconnectDb`
- `packages/ai/src/index.ts` → （无顶层定义 / 未抽出）
- `server/src/logger.ts` → `writeToFile`, `AuditLogEntry`, `Logger`
- `apps/mobile/src/ui/kit.tsx` → `TextTone`, `TextProps`, `Text`, `AppBarAction`, `AppBar`, `IconButton`, `Screen`, `SectionHeader`, `ProgressBar`, `Checkbox`, `BadgeProps`, `Badge` …(+16)
- `server/src/sync/sync.types.ts` → `MAX_ACCEPTED_VECTOR_CLOCK_ENTRIES`, `CAUSAL_FULL_STATE_OPERATION_WHERE`, `latestCausalFullStateSql`, `LatestCausalFullStateRow`, `agedPrefixCausalFullStateSql`, `isFullStateOpType`, `SYNC_ERROR_CODES`, `STATE_REPLACEMENT_REQUIRED_ERROR`, `SyncErrorCode`, `ConflictType`, `ConflictResult`, `OP_TYPES` …(+31)
- `apps/desktop/src/index.ts` → （无顶层定义 / 未抽出）
- `apps/desktop/src/main.ts` → `reportFatal`, `guardedLoad`, `armReminders`, `bootHost`, `settingsSectionFromEnv`, `resolveWebRoot`, `sendToMainWindow`, `flushPendingCommands`, `showMainWindow`, `hideMainWindow`, `toggleMainWindow`, `showToday` …(+4)
- `apps/landing/src/pages/index.ts` → `PAGE_COMPONENTS`
- `apps/mobile/index.js` → （无顶层定义 / 未抽出）
- `apps/mobile/src/App.tsx` → `Shell`, `App`, `LocaleHost`, `Root`
- `apps/node-host/src/index.ts` → （无顶层定义 / 未抽出）
- `apps/web/src/App.tsx` → `isSettingsSectionId`, `resolveSettingsSection`, `SettingsSectionNav`, `App`, `onKeyDown`, `onKeyDown`, `focusable`, `onKey`, `onKey`, `onKey`, `onKey`, `onKey`
- `apps/web/src/components/hta/index.ts` → （无顶层定义 / 未抽出）
- `packages/app-host/src/connectors/index.ts` → （无顶层定义 / 未抽出）
- `packages/inbound-core/src/index.ts` → （无顶层定义 / 未抽出）

> 只列这些关键文件的顶层定义（模块级 API），不做全库符号排行——后者按词频排会被通用名淹没，无意义。

## 5. 人工批注（重跑不覆盖）

<!-- MANUAL:BEGIN -->
（写：每个目录的真实职责 / 哪个模块最容易出事 / 新人从哪看起。脚本不动这一段。）
<!-- MANUAL:END -->
