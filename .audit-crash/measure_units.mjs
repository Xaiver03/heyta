import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.kt', '.kts', '.cs', '.ets', '.c', '.h', '.cpp', '.m', '.mm', '.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'obj', 'bin', '.build', 'target', 'generated', '.git', 'evidence', '__tests__', '__mocks__', '.expo', 'Pods']);
const SKIP_FILE = /(\.generated\.ts|\.spec\.ts|\.spec\.tsx|\.test\.ts|\.test\.tsx|\.stories\.tsx?|\.d\.ts)$/;

function walk(dir, pred = () => true, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, pred, acc);
    else {
      const dot = e.lastIndexOf('.');
      const ext = dot >= 0 ? e.slice(dot) : '';
      if (EXTS.has(ext) && !SKIP_FILE.test(e) && pred(p)) acc.push({ p, size: st.size });
    }
  }
  return acc;
}
const kb = fs => Math.round(fs.reduce((a, f) => a + f.size, 0) / 1024);
const report = (name, files) => ({ unit: name, files: files.length, kb: kb(files) });

const letter = (lo, hi) => p => { const c = basename(p)[0].toLowerCase(); return c >= lo && c <= hi; };
const re = rx => p => rx.test(basename(p));
const inDir = d => p => p.startsWith(d + '/');
const notInDirs = ds => p => !ds.some(d => p.startsWith(d + '/'));
const oneOf = names => p => names.includes(basename(p));

const AH = 'packages/app-host/src';
const SC = 'packages/sync-core/src';
const SS = 'server/src/sync';
const WEBF = 'apps/web/src/features';
const MOB = 'apps/mobile/src';

const u06a = p => letter('m', 'z')(p) && /^(vault-|share-)/.test(basename(p));
const u06b = p => letter('m', 'z')(p) && /^(native-|sync-wiring|reminder-|ticktick-|privacy-consent|public-facts|payload-mode|managed-ai-usage|motivation)/.test(basename(p));
const u06c = p => letter('m', 'z')(p) && !u06a(p) && !u06b(p);

const candidates = [
  report('U01a-sqlite', walk('packages/storage/src/sqlite')),
  report('U01b-idb-memory', []),
  report('U02-oplog-domain', [...walk('packages/op-log/src'), ...walk('packages/domain/src'), ...walk('packages/shared-schema/src')]),
  report('U03a-conflict-replay', walk(SC, oneOf(['conflict-resolution.ts', 'conflict-classification.ts', 'remote-apply.ts', 'replay-coordinator.ts', 'operation.types.ts', 'apply.types.ts', 'causal-clock.ts', 'vector-clock.ts', 'entity-frontier.ts', 'lww-update-action-types.ts', 'full-state-op-types.ts']))),
  report('U03b-encryption-keys', walk(SC, p => inDir(SC + '/encryption')(p) || oneOf(['encryption.ts', 'share-keys.ts', 'key-lifecycle.ts', 'entity-key.util.ts', 'sha256-text.ts', 'web-crypto-error.ts'])(p))),
  report('U03c-planning-misc', walk(SC, p => !oneOf(['conflict-resolution.ts', 'conflict-classification.ts', 'remote-apply.ts', 'replay-coordinator.ts', 'operation.types.ts', 'apply.types.ts', 'causal-clock.ts', 'vector-clock.ts', 'entity-frontier.ts', 'lww-update-action-types.ts', 'full-state-op-types.ts', 'encryption.ts', 'share-keys.ts', 'key-lifecycle.ts', 'entity-key.util.ts', 'sha256-text.ts', 'web-crypto-error.ts'])(p) && !inDir(SC + '/encryption')(p))),
  report('U04a-sync-client', walk('packages/sync-client/src')),
  report('U04b-ai', walk('packages/ai/src')),
  report('U05-apphost-a-l', walk(AH, letter('a', 'l'))),
  report('U06a-vault-share', walk(AH, u06a)),
  report('U06b-native-sync', walk(AH, u06b)),
  report('U06c-apphost-rest', walk(AH, u06c)),
  report('U07-localapi-inbound', [...walk('packages/local-api/src'), ...walk('packages/inbound-core/src'), ...walk('packages/widget-core/src')]),
  report('U08a-sync-routes', walk(SS, notInDirs([SS + '/services']))),
  report('U08b-sync-services', [...walk(SS + '/services'), ...walk(SS, oneOf(['cleanup.ts']))]),
  report('U09-server-billing-auth', [...walk('server/src/billing'), ...walk('server/src/central-auth'), ...walk('server/src/password'), ...walk('server/src/account'), ...walk('server/src/admin')]),
  report('U11-nodehost-desktop', [...walk('apps/node-host/src'), ...walk('apps/desktop/src'), ...walk('apps/desktop/renderer')]),
  report('U12-web-shell', walk('apps/web/src', notInDirs([WEBF]))),
  report('U15-ui-shared', walk('packages/ui/src')),
  report('U16-mobile-shell', walk(MOB, notInDirs([MOB + '/screens', MOB + '/lib', MOB + '/ai', MOB + '/share', MOB + '/inbound', MOB + '/auth', MOB + '/widgets']))),
  report('U17-mobile-features', [...walk(MOB + '/screens'), ...walk(MOB + '/lib'), ...walk(MOB + '/ai'), ...walk(MOB + '/share'), ...walk(MOB + '/inbound'), ...walk(MOB + '/auth'), ...walk(MOB + '/widgets')]),
  report('U18-native-macos', walk('apps/desktop-macos/Sources')),
  report('U19-native-windows', [...walk('apps/desktop-windows/Heyta.Windows.Core'), ...walk('apps/desktop-windows/HeytaWindows')]),
  report('U20-native-mobile', [...walk('apps/mobile/ios'), ...walk('apps/mobile/android/app/src/main/java'), ...walk('apps/mobile/harmony/entry/src/main/ets')]),
  report('U21-landing-legal', [...walk('apps/landing/src'), ...walk('packages/legal/src'), ...walk('packages/i18n/src'), ...walk('packages/design-system/src')]),
];

// fix U01b: indexeddb + memory + top-level only
const u01bFiles = walk('packages/storage/src').filter(f => !f.p.startsWith('packages/storage/src/sqlite/'));
candidates[1] = report('U01b-idb-memory', u01bFiles);

const webFeatures = readdirSync(WEBF).filter(d => { try { return statSync(join(WEBF, d)).isDirectory(); } catch { return false; } })
  .map(d => report('webfeature:' + d, walk(join(WEBF, d)))).sort((a, b) => b.kb - a.kb);
const serverDirs = readdirSync('server/src').filter(d => { try { return statSync(join('server/src', d)).isDirectory(); } catch { return false; } })
  .map(d => report('serverdir:' + d, walk(join('server/src', d)))).sort((a, b) => b.kb - a.kb);
const mobileDirs = readdirSync(MOB).filter(d => { try { return statSync(join(MOB, d)).isDirectory(); } catch { return false; } })
  .map(d => report('mobiledir:' + d, walk(join(MOB, d)))).sort((a, b) => b.kb - a.kb);
const serverTopFiles = walk('server/src', p => !p.slice('server/src/'.length).includes('/'));

const out = { candidates, webFeatures, serverDirs, mobileDirs, serverTopFiles: report('server-top-files', serverTopFiles) };
writeFileSync('.audit-crash/unit-sizes.json', JSON.stringify(out, null, 2));
for (const c of candidates) console.log(`${c.unit.padEnd(26)} ${String(c.files).padStart(4)} files ${String(c.kb).padStart(6)} KB${c.kb > 400 ? '  << OVER 400KB' : ''}`);
console.log('\n--- web features ---'); webFeatures.forEach(c => console.log(`${c.unit.padEnd(32)} ${String(c.kb).padStart(6)} KB`));
console.log('\n--- server dirs ---'); serverDirs.forEach(c => console.log(`${c.unit.padEnd(32)} ${String(c.kb).padStart(6)} KB`));
console.log('\n--- mobile dirs ---'); mobileDirs.forEach(c => console.log(`${c.unit.padEnd(32)} ${String(c.kb).padStart(6)} KB`));
console.log('\nserver top-level files:', out.serverTopFiles.kb, 'KB,', out.serverTopFiles.files, 'files');