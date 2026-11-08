import { readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.kt', '.kts', '.cs', '.ets', '.c', '.h', '.cpp', '.m', '.mm']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'obj', 'bin', '.build', 'target', 'generated', '.git', 'evidence', '__tests__', '__mocks__', '.expo', 'Pods', 'styles', 'locales', 'documents', 'mockup-data']);
const SKIP_FILE = /(\.generated\.ts|\.spec\.tsx?|\.test\.tsx?|\.stories\.tsx?|\.d\.ts)$/;

function walk(dir, pred = () => true, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries.sort()) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, pred, acc);
    else {
      const dot = e.lastIndexOf('.');
      if (EXTS.has(e.slice(dot)) && !SKIP_FILE.test(e) && pred(p)) acc.push({ p, size: st.size });
    }
  }
  return acc;
}
const kb = fs => Math.round(fs.reduce((a, f) => a + f.size, 0) / 1024);
const topFiles = dir => walk(dir).filter(f => !f.p.slice(dir.length + 1).includes('/'));
const letter = (lo, hi) => p => { const c = basename(p)[0].toLowerCase(); return c >= lo && c <= hi; };
const re = rx => p => rx.test(basename(p));
const oneOf = names => p => names.includes(basename(p));
const inDirs = ds => p => ds.some(d => p === d || p.startsWith(d + '/'));
const splitBySize = (files, maxKb) => {
  const groups = [[]];
  for (const f of files) {
    if (kb(groups[groups.length - 1]) + Math.round(f.size / 1024) > maxKb && groups[groups.length - 1].length) groups.push([]);
    groups[groups.length - 1].push(f);
  }
  return groups;
};

const AH = 'packages/app-host/src';
const MOB = 'apps/mobile/src';
const WEBF = 'apps/web/src/features';
const UI = 'packages/ui/src';
const SRV = 'server/src';
const SS = SRV + '/sync';

const units = [];
const add = (unit_id, pathsDesc, files, tech, entries, cross) => {
  units.push({ unit_id, paths: pathsDesc, files: files.map(f => f.p), kb: kb(files), tech_stack: tech, entry_points: entries, cross_unit_dependencies: cross });
};

// storage
add('U01a-sqlite', 'packages/storage/src/sqlite/**', walk('packages/storage/src/sqlite'), 'TS / node:sqlite / sqlite-wasm', 'sqlite/*', ['U02a', 'U16a']);
add('U01b-idb-memory', 'packages/storage/src/{indexeddb,memory}/** + 顶层*.ts', walk('packages/storage/src').filter(f => !f.p.startsWith('packages/storage/src/sqlite/')), 'TS / IndexedDB', 'index.ts, stores.ts, op-log-store.ts', ['U02a', 'U12a']);
// op-log + schema / domain
add('U02a-oplog-schema', 'packages/op-log/src/** + packages/shared-schema/src/**', [...walk('packages/op-log/src'), ...walk('packages/shared-schema/src')], 'TS / zod', 'op-log/src/engine.ts', ['U01a', 'U03']);
const domainGroups = splitBySize(walk('packages/domain/src'), 360);
domainGroups.forEach((g, i) => add(`U02${'bc'[i]}-domain-${i + 1}`, g.map(f => f.p).join(', '), g, 'TS / domain 语义', 'entities.ts 及各自文件', ['U02a']));
// sync-core（vendored 但 heyta 深度改造，审计不改动）
add('U03-sync-core', 'packages/sync-core/src/**', walk('packages/sync-core/src'), 'TS (vendored MIT, heyta-modified)', 'conflict-resolution.ts, remote-apply.ts, replay-coordinator.ts, encryption.ts', ['U02a', 'U08a']);
add('U04a-sync-client', 'packages/sync-client/src/**', walk('packages/sync-client/src'), 'TS / fetch', 'client.ts', ['U03', 'U12a']);
add('U04b-ai', 'packages/ai/src/**', walk('packages/ai/src'), 'TS / fetch / SSE', 'stream.ts, provider.ts, routing.ts', ['U05a', 'U14b']);
// app-host A–L 按字母序累计切三块
const ahGroups = splitBySize(walk(AH, letter('a', 'l')), 330);
if (ahGroups.length > 1 && kb(ahGroups[ahGroups.length - 1]) < 120) {
  ahGroups[ahGroups.length - 2].push(...ahGroups.pop());
}
ahGroups.forEach((g, i) => add(`U05${'abc'[i]}-apphost-${i + 1}`, g.map(f => f.p).join(', '), g, 'TS / app-host', 'host.ts, actions.ts, local-api-host.ts', ['U02a', 'U04a', 'U07']));
const u06a = p => letter('m', 'z')(p) && /^(vault-|share-)/.test(basename(p));
const u06bc = p => letter('m', 'z')(p) && !u06a(p);
add('U06a-vault-share', `${AH}/{vault-*,share-*}.ts`, walk(AH, u06a), 'TS / 加密共享', 'vault-session.ts, share-client.ts', ['U03', 'U08a']);
add('U06b-apphost-mz', `${AH} 其余 M–Z 文件`, walk(AH, u06bc), 'TS / native bridge / reminder / sync wiring', 'native-bridge.ts, sync-wiring.ts, reminder-scheduler.ts', ['U03', 'U16a', 'U20a']);
add('U07-localapi-inbound', 'packages/{local-api,inbound-core,widget-core}/src/**', [...walk('packages/local-api/src'), ...walk('packages/inbound-core/src'), ...walk('packages/widget-core/src')], 'TS / JSON-RPC / webhook', 'local-api/server.ts, mcp.ts; inbound-core/webhook.ts, parser.ts', ['U06b', 'U11']);
// server
add('U08a-sync-routes', `${SS} 顶层（不含 services/）`, walk(SS, p => !p.startsWith(SS + '/services/')), 'TS / Fastify / Prisma', 'sync.routes.ts, sync.service.ts, op-replay.ts', ['U03', 'U10a']);
add('U08b-sync-services', `${SS}/services/** + cleanup.ts`, [...walk(SS + '/services'), ...walk(SS, oneOf(['cleanup.ts']))], 'TS / Fastify / Prisma', 'services/*', ['U08a']);
add('U09a-billing', `${SRV}/billing/**`, walk(SRV + '/billing'), 'TS / Fastify / 支付适配', 'webhook.routes.ts, checkout.routes.ts, wechat.adapter.ts', ['U10a']);
add('U09b-auth-account-admin', `${SRV}/{central-auth,password,account,admin}/**`, [...walk(SRV + '/central-auth'), ...walk(SRV + '/password'), ...walk(SRV + '/account'), ...walk(SRV + '/admin')], 'TS / Fastify / Prisma', 'central-auth/*, admin/*', ['U10a']);
const srvCore = topFiles(SRV).filter(f => ['server.ts', 'index.ts', 'config.ts', 'middleware.ts', 'db.ts', 'logger.ts', 'api-error.ts', 'auth-cache.ts', 'auth-tokens.ts', 'request-locale.ts', 'email-allowlist.ts', 'web-app.ts', 'test-routes.ts'].includes(basename(f.p)));
const srvApi = topFiles(SRV).filter(f => ['api.ts', 'auth.ts', 'entitlement.ts', 'passkey.ts', 'email.ts', 'legal-consent.ts', 'legal-recheck.ts', 'pages.ts', 'design-html.ts'].includes(basename(f.p)));
add('U10a-server-core', srvCore.map(f => f.p).join(', '), srvCore, 'TS / Fastify 启动与中间件', 'server.ts, index.ts, config.ts', ['U08a', 'U09a']);
add('U10b-server-api-auth', srvApi.map(f => f.p).join(', '), srvApi, 'TS / Fastify 路由与鉴权', 'api.ts, auth.ts, passkey.ts', ['U10a']);
add('U10c-automation-ai-push', `${SRV}/{automation,ai,push}/**`, [...walk(SRV + '/automation'), ...walk(SRV + '/ai'), ...walk(SRV + '/push')], 'TS / Fastify / SSE / webpush', 'automation/*, ai/*, push/*', ['U10b', 'U04b']);
add('U10d-server-misc', `${SRV}/{shares,activity,holidays,attachments,announcements,util}/**`, [...walk(SRV + '/shares'), ...walk(SRV + '/activity'), ...walk(SRV + '/holidays'), ...walk(SRV + '/attachments'), ...walk(SRV + '/announcements'), ...walk(SRV + '/util')], 'TS / Fastify', 'shares/*, activity/*', ['U10b']);
// desktop / web shell
add('U11-nodehost-desktop', 'apps/node-host/src/** + apps/desktop/{src,renderer}/**', [...walk('apps/node-host/src'), ...walk('apps/desktop/src'), ...walk('apps/desktop/renderer')], 'TS / Electron / node:sqlite', 'node-host/cli.ts, desktop/main.ts, preload.ts', ['U05a', 'U07']);
const webShell = walk('apps/web/src', p => !p.startsWith(WEBF + '/'));
const webShellGroups = splitBySize(webShell, 380);
webShellGroups.forEach((g, i) => add(`U12${'abc'[i]}-web-shell-${i + 1}`, g.map(f => f.p).join(', '), g, 'TS / React / Vite / PWA', 'main.tsx, App.tsx, pwa/sw.ts', ['U01b', 'U05a']));
// web features 按语义打包
const wf = d => walk(join(WEBF, d));
const pack = (id, ds, entries) => add(id, ds.map(d => `${WEBF}/${d}/**`).join(' + '), ds.flatMap(wf), 'TS / React', entries, ['U12a']);
pack('U13a-web-settings', ['settings'], 'settings/*');
pack('U13b-web-ai-auth', ['ai', 'auth'], 'ai/*, auth/*');
pack('U13c-web-tasks-shell', ['tasks', 'shell'], 'tasks/*, shell/*');
pack('U13d-web-sync-admin', ['sync', 'admin'], 'sync/*, admin/*');
pack('U13e-web-share-misc', ['share', 'subscription', 'privacy', 'capture', 'trash', 'notes', 'kanban', 'legal-recheck', 'tags', 'timeline', 'announcements'], 'share/*, capture/*, trash/*');
pack('U13f-web-habits-cal', ['habits', 'calendar', 'reminders', 'projects', 'inbox'], 'habits/*, calendar/*');
pack('U13g-web-small-features', ['focus', 'categories', 'quadrant', 'countdown', 'motivation'], 'focus/*, countdown/*');
// packages/ui 按语义打包
const ui = d => walk(join(UI, d));
const uiPack = (id, ds, extra = []) => add(id, ds.map(d => `${UI}/${d}/**`).join(' + '), [...ds.flatMap(ui), ...extra], 'TS / React Native + react-native-web', ds[0] + '/*', ['U02b']);
uiPack('U15a-ui-auth-sync', ['auth', 'sync'], topFiles(UI));
uiPack('U15b-ui-task-list', ['task-list', 'categories', 'subtasks', 'trash', 'form', 'icon', 'material', 'control']);
uiPack('U15c-ui-habits-focus', ['habits', 'focus', 'reminders', 'quadrant']);
uiPack('U15d-ui-calendar-countdown', ['calendar', 'date-picker', 'countdown']);
uiPack('U15e-ui-motivation-projects', ['motivation', 'projects', 'notes']);
uiPack('U15f-ui-capture-search', ['capture', 'search', 'timeline', 'attachments']);
uiPack('U15g-ui-overlay-feedback', ['overlay', 'feedback', 'empty-state']);
uiPack('U15h-ui-ai-settings', ['ai', 'settings']);
// mobile
add('U16a-mobile-shell', `${MOB}/{App.tsx,theme.tsx,db,nav,prefs,privacy,i18n,legal-recheck,ui}/** + index.js + metro.config.js`, walk(MOB, p => !['screens', 'lib', 'ai', 'share', 'inbound', 'auth', 'widgets'].some(d => p.startsWith(`${MOB}/${d}/`))), 'TS / RN 0.84 / op-sqlite', 'App.tsx, db/*, sync/*', ['U01a', 'U05a']);
const screenGroups = splitBySize(walk(MOB + '/screens'), 300);
screenGroups.forEach((g, i) => add(`U17${'abc'[i]}-mobile-screens-${i + 1}`, g.map(f => f.p).join(', '), g, 'TS / React Native', 'screens/*', ['U16a']));
add('U17d-mobile-lib', `${MOB}/lib/**`, walk(MOB + '/lib'), 'TS / RN 工具与状态', 'lib/*', ['U16a']);
add('U17e-mobile-features', `${MOB}/{ai,share,inbound,auth,widgets}/**`, [...walk(MOB + '/ai'), ...walk(MOB + '/share'), ...walk(MOB + '/inbound'), ...walk(MOB + '/auth'), ...walk(MOB + '/widgets')], 'TS / RN', 'ai/*, share/*, widgets/*', ['U16a', 'U04b']);
// native shells
add('U18-native-macos', 'apps/desktop-macos/Sources/**', walk('apps/desktop-macos/Sources'), 'Swift / JavaScriptCore / libsqlite3 / WKWebView', 'HeytaMacApp.swift, HeytaShellCore/*', ['U11']);
add('U19-native-windows', 'apps/desktop-windows/{Heyta.Windows.Core,HeytaWindows}/**', [...walk('apps/desktop-windows/Heyta.Windows.Core'), ...walk('apps/desktop-windows/HeytaWindows')], 'C# / WinUI 3', 'HeytaWindows/*.xaml.cs', ['U11']);
add('U20a-native-ios', 'apps/mobile/ios/{Heyta,HeytaWidgetCore,HeytaWidgetExtension}/**（跳过 Pods/build）', [...walk('apps/mobile/ios/Heyta'), ...walk('apps/mobile/ios/HeytaWidgetCore'), ...walk('apps/mobile/ios/HeytaWidgetExtension')], 'Swift / WidgetKit', 'WidgetBridge, WidgetStore', ['U16a']);
add('U20b-native-android-harmony', 'apps/mobile/android/app/src/main/java/** + apps/mobile/harmony/entry/src/main/ets/**', [...walk('apps/mobile/android/app/src/main/java'), ...walk('apps/mobile/harmony/entry/src/main/ets')], 'Kotlin / ArkTS', 'MainActivity, EntryAbility.ets, widget/*', ['U16a']);
// landing / design-system
add('U21a-landing-site', 'apps/landing/src/{site,pages}/** + 顶层文件', [...walk('apps/landing/src/site'), ...walk('apps/landing/src/pages'), ...topFiles('apps/landing/src')], 'TS / Vite 静态站', 'main.tsx, site/*, pages/*', []);
add('U21b-landing-components', 'apps/landing/src/{components,lib,mockup}/**', [...walk('apps/landing/src/components'), ...walk('apps/landing/src/lib'), ...walk('apps/landing/src/mockup')], 'TS / React', 'components/*', ['U21a']);
add('U21c-design-system', 'packages/design-system/src/**（不含 generated）', walk('packages/design-system/src'), 'TS / tokens 运行时解析', 'index.ts', ['U15a']);

const plan = {
  audited_repo: 'heyta (monorepo, pnpm workspace)',
  generated_at: new Date().toISOString(),
  supersedes: 'audit_plan.json @ 2026-11-08T05:18Z（21 单元版；其中 U02/U05/U09/U10/U12/U13/U14/U15/U17/U20/U21 实测超 400KB，按 handoff §4 与本轮实测再切）',
  exclusion_rules: [
    'node_modules/**, **/dist/**, **/build/**, **/obj/**, **/bin/**, **/.build/**, **/target/**, Pods/**, .expo, .venv',
    '**/generated/**, **/*.generated.ts, **/*.d.ts（生成代码与纯类型）',
    '**/*.spec.ts(x), **/*.test.ts(x), **/*.stories.ts(x), __tests__/, __mocks__/（测试代码不在运行时崩溃审计面）',
    'packages/x/**, packages/y/**（空目录）',
    'apps/desktop-linux/**（C/GTK 壳，沿用上一轮排除决定，见报告 A 节）',
    'packages/i18n/src/locales/**（987KB 纯翻译数据）, packages/legal/src/documents/**（687KB 纯法律文本）——运行时只是字符串 lookup，未深审，见 coverage',
    'apps/web/src/styles/**, apps/landing/src/styles/**（纯 CSS）',
    'research/**, scripts/**, docs/**, e2e/**, .run-logs/**, evidence/**（非运行时产物）',
    'packages/sync-core 与 server/ 为 vendored(MIT) 但经 heyta 深度改造：审计只读、不改上游',
  ],
  size_measurement: '.audit-crash/unit-sizes.json + .audit-crash/finalize_plan.mjs（可重跑）',
  units: units.map(({ files, ...rest }) => rest),
};
writeFileSync('audit_plan.json', JSON.stringify(plan, null, 2));
copyFileSync('audit_plan.json', '.audit-crash/audit_plan.json');
writeFileSync('.audit-crash/dispatch_manifest.json', JSON.stringify(units, null, 2));
let over = 0;
for (const u of units) { console.log(`${u.unit_id.padEnd(28)} ${String(u.files.length).padStart(3)} files ${String(u.kb).padStart(4)} KB${u.kb > 440 ? ' << OVER' : ''}`); if (u.kb > 440) over++; }
console.log(`\nTOTAL units: ${units.length}, total KB: ${units.reduce((a, u) => a + u.kb, 0)}, over-440KB: ${over}`);