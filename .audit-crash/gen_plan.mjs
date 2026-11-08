import { writeFileSync } from 'node:fs';
const U = (unit_id, repos, paths, tech_stack, entry_points, cross) => ({unit_id, repos, paths, tech_stack, entry_points, cross_unit_dependencies: cross});
const units = [
  U('U01-storage','packages/storage, packages/shared-schema','packages/storage/src/**','TypeScript / IndexedDB + node:sqlite + sqlite-wasm(will not be audited in dist) / tsup','packages/storage/src/index.ts, packages/storage/src/sqlite/*, packages/storage/src/indexeddb/*',['U02','U03','U09']),
  U('U02-oplog-domain','packages/op-log, packages/domain, packages/shared-schema','packages/op-log/src/**, packages/domain/src/** (skip src/generated), packages/shared-schema/src/**','TypeScript / zod / tsup','packages/op-log/src/engine.ts, packages/domain/src/entities.ts',['U01','U03']),
  U('U03-sync-core','packages/sync-core','packages/sync-core/src/**','TypeScript (vendored Super Productivity, MIT)','packages/sync-core/src/index.ts, conflict-resolution.ts, remote-apply.ts, replay-coordinator.ts',['U02','U06']),
  U('U04-sync-client-ai','packages/sync-client, packages/ai','packages/sync-client/src/**, packages/ai/src/**','TypeScript / fetch / SSE','packages/sync-client/src/client.ts, packages/ai/src/stream.ts, provider.ts, routing.ts',['U06','U12']),
  U('U05-apphost-a','packages/app-host','packages/app-host/src/ 中 A–L 开头的文件（含 host.ts / actions.ts / local-api-host.ts / ai-* / event-*, habit-*, project-*, note-*, inbox*）','TypeScript / tsup','packages/app-host/src/host.ts, index.ts, local-api-host.ts',['U02','U04','U06','U07']),
  U('U06-apphost-b','packages/app-host','packages/app-host/src/ 中 M–Z 开头的文件（share-* / vault-* / hosted-auth / reminder-* / ticktick-* / export-dump / import-dump / sync-wiring / privacy-consent / native-bridge 等）','TypeScript / tsup','packages/app-host/src/share-client.ts, vault-session.ts, hosted-auth.ts, native-bridge.ts',['U03','U05','U08']),
  U('U07-localapi-inbound','packages/local-api, packages/inbound-core, packages/widget-core','packages/local-api/src/**, packages/inbound-core/src/**, packages/widget-core/src/**','TypeScript / JSON-RPC','packages/local-api/src/server.ts, mcp.ts, tools/*; packages/inbound-core/src/webhook.ts, parser.ts',['U06','U11']),
  U('U08-server-sync','server','server/src/sync/**, server/prisma/**（只读 schema 与 migrations 名称，不改）','TypeScript / Fastify / Prisma / PostgreSQL (vendored MIT)','server/src/sync/sync.routes.ts, sync.service.ts, services/*',['U03','U12']),
  U('U09-server-billing-auth','server','server/src/billing/**, server/src/central-auth/**, server/src/password/**, server/src/account/**, server/src/admin/**','TypeScript / Fastify / Prisma','server/src/billing/webhook.routes.ts, checkout.routes.ts, wechat.adapter.ts, paycenter.adapter.ts',['U12']),
  U('U10-server-api-misc','server','server/src/server.ts, api.ts, config.ts, middleware.ts, auth.ts, auth-cache.ts, ai/**, push/**, shares/**, automation/**, attachments/**, announcements/**, entitlement.ts, email.ts, activity/**, holidays/**, util/**','TypeScript / Fastify','server/src/server.ts, api.ts, index.ts',['U08','U09','U11']),
  U('U11-nodehost-desktop','apps/node-host, apps/desktop','apps/node-host/src/**, apps/desktop/src/**, apps/desktop/renderer/**','TypeScript / Electron / node:sqlite','apps/node-host/src/cli.ts, apps/desktop/src/main.ts, preload.ts, renderer/bridge.ts',['U05','U06']),
  U('U12-web-shell','apps/web','apps/web/src/main.tsx, App.tsx, lib/**, pwa/**, worker/**, boot-splash.ts','TypeScript / React / Vite / react-native-web','apps/web/src/main.tsx, App.tsx, pwa/sw.ts, pwa/sw-core.ts',['U01','U05','U13']),
  U('U13-web-features-a','apps/web','apps/web/src/features/{shell,tasks,calendar,habits,focus,categories,projects,inbox,quadrant,countdown,motivation,reminders}/**','TypeScript / React','apps/web/src/features/tasks/**, shell/**',['U12']),
  U('U14-web-features-b','apps/web','apps/web/src/features/{settings,ai,auth,sync,admin,share,privacy,subscription}/**','TypeScript / React','apps/web/src/features/settings/AiSettings.tsx, ai/**, auth/**',['U12']),
  U('U15-ui-shared','packages/ui','packages/ui/src/**','TypeScript / React Native + react-native-web','packages/ui/src/index.ts, sync/**, task-list/**',['U02']),
  U('U16-mobile-shell','apps/mobile','apps/mobile/src/**, apps/mobile/index.js, metro.config.js','TypeScript / React Native 0.84 / op-sqlite','apps/mobile/src/App.tsx, db/**, sync/**',['U01','U05']),
  U('U17-mobile-features','apps/mobile','apps/mobile/src/screens/**, apps/mobile/src/lib/**, apps/mobile/src/ai/**, apps/mobile/src/share/**, apps/mobile/src/inbound/**, apps/mobile/src/auth/**, apps/mobile/src/widgets/**','TypeScript / React Native','apps/mobile/src/screens/**, lib/**',['U16']),
  U('U18-native-macos','apps/desktop-macos','apps/desktop-macos/Sources/**','Swift / SwiftPM / JavaScriptCore / libsqlite3 / WKWebView','HeytaMacApp.swift, HeytaShellCore/*',['U11']),
  U('U19-native-windows','apps/desktop-windows','apps/desktop-windows/Heyta.Windows.Core/**, HeytaWindows/**（跳过 obj/ bin/）','C# / WinUI 3 / Windows App SDK','HeytaWindows/*.xaml.cs, Heyta.Windows.Core/*',['U11']),
  U('U20-native-mobile','apps/mobile/ios, apps/mobile/android, apps/mobile/harmony','apps/mobile/ios/**（跳过 .build）.kt/.swift 源, android/app/src/main/java/com/heytamobile/**, harmony/entry/src/main/ets/**','Swift / Kotlin(JVM) / ArkTS','WidgetBridge, WidgetStore, EntryAbility.ets, MainActivity',['U16']),
  U('U21-landing-legal','apps/landing, packages/legal, packages/i18n, packages/design-system','apps/landing/src/**, packages/legal/src/**, packages/i18n/src/**, packages/design-system/src/**（仅运行时解析路径）','TypeScript / Vite / 纯数据','apps/landing/src/main.tsx',['U12']),
];
const excluded = [
  'node_modules/**, **/dist/**, **/build/**, **/obj/**, **/bin/**, **/.build/**, **/target/**, .venv',
  'packages/x/**, packages/y/** (空目录，0 文件)',
  'apps/desktop-linux/** (C/GTK，本轮不在 22 个单元内 —— 见报告 A 节)',
  'research/**, scripts/**, docs/**, e2e/**, .run-logs/**, evidence/**, probe/** (非运行时产物或一次性探针)',
  'packages/sync-core 与 server/ 的 vendored 上游代码本身不重写，仅审计 heyta 已改造路径',
  '**/generated/**, **/*.generated.ts (生成代码)',
];
writeFileSync('audit_plan.json', JSON.stringify({audited_repo: 'heyta (monorepo, pnpm workspace)', generated_at: new Date().toISOString(), exclusion_rules: excluded, units}, null, 2));
console.log('units:', units.length);
