#!/usr/bin/env node

/**
 * Keep Swift module names, ObjC bridge exports, and JS lookups in lockstep.
 * A Swift build can succeed while RCT_EXTERN_MODULE exports a different JS
 * name; NativeModules then becomes undefined and the feature silently degrades.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.HEYTA_BRIDGE_CHECK_ROOT || process.cwd();
const ios = join(root, 'apps/mobile/ios/Heyta');
const bridges = [
  ['HeytaReminderModule.swift', 'HeytaReminderModuleBridge.m', 'HeytaReminder'],
  ['HeytaVaultSecureStorage.swift', 'HeytaVaultSecureStorageBridge.m', 'HeytaVaultSecureStorage'],
];
const failures = [];

// Regex checks are useful here because these declarations are deliberately
// tiny, but a commented-out old name must not satisfy them. Strip comments
// while preserving quoted strings (including URLs and `//` in string data).
function withoutComments(source) {
  let output = '';
  let state = 'code';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === 'line') {
      if (current === '\n') { state = 'code'; output += current; }
      continue;
    }
    if (state === 'block') {
      if (current === '*' && next === '/') { state = 'code'; index += 1; }
      continue;
    }
    if (state === 'string') {
      output += current;
      if (escaped) { escaped = false; continue; }
      if (current === '\\') { escaped = true; continue; }
      if (current === quote) { state = 'code'; quote = ''; }
      continue;
    }
    if (current === '/' && next === '/') { state = 'line'; index += 1; continue; }
    if (current === '/' && next === '*') { state = 'block'; index += 1; continue; }
    if (current === '\'' || current === '"' || current === '`') {
      state = 'string'; quote = current; output += current; continue;
    }
    output += current;
  }
  return output;
}

for (const [swiftName, bridgeName, jsName] of bridges) {
  const swift = withoutComments(readFileSync(join(ios, swiftName), 'utf8'));
  const bridge = withoutComments(readFileSync(join(ios, bridgeName), 'utf8'));
  const classMatch = swift.match(/@objc\(([^)]+)\)\s*\nfinal class\s+([A-Za-z0-9_]+)/);
  const moduleMatch = swift.match(/@objc static func moduleName\(\)\s*->\s*String!\s*\{\s*"([^"]+)"/);
  const remap = bridge.match(/RCT_EXTERN_REMAP_MODULE\(\s*([^,]+)\s*,\s*([^,]+)\s*,/);
  const plain = bridge.match(/RCT_EXTERN_MODULE\(\s*([^,]+)\s*,/);
  const exportedJs = remap?.[1]?.trim() || plain?.[1]?.trim();
  const exportedClass = remap?.[2]?.trim() || plain?.[1]?.trim();
  if (!classMatch) failures.push(`${swiftName}: missing @objc class declaration`);
  if (!moduleMatch) failures.push(`${swiftName}: missing moduleName()`);
  if (classMatch && classMatch[1] !== classMatch[2]) failures.push(`${swiftName}: @objc name differs from class`);
  if (moduleMatch && moduleMatch[1] !== jsName) failures.push(`${swiftName}: moduleName() is ${moduleMatch[1]}, expected ${jsName}`);
  if (exportedJs !== jsName) failures.push(`${bridgeName}: exports JS name ${exportedJs ?? '<none>'}, expected ${jsName}`);
  if (classMatch && exportedClass !== classMatch[1]) failures.push(`${bridgeName}: bridges ObjC class ${exportedClass ?? '<none>'}, expected ${classMatch[1]}`);
}

const reminderLookup = withoutComments(readFileSync(join(root, 'apps/mobile/src/lib/reminder-native.ts'), 'utf8'));
if (!/NativeModules\?\.\s*HeytaReminder\b/u.test(reminderLookup)) {
  failures.push('apps/mobile/src/lib/reminder-native.ts: missing NativeModules?.HeytaReminder lookup');
}
const vaultLookup = withoutComments(readFileSync(join(root, 'apps/mobile/src/lib/vault-secure-storage.ts'), 'utf8'));
if (!/const MODULE_NAME\s*=\s*['"]HeytaVaultSecureStorage['"]/u.test(vaultLookup) ||
    !/NativeModules\?\.\[MODULE_NAME\]/u.test(vaultLookup)) {
  failures.push('apps/mobile/src/lib/vault-secure-storage.ts: missing exact NativeModules?.[MODULE_NAME] lookup');
}

if (failures.length) {
  console.error('❌ iOS native bridge names are inconsistent:');
  for (const failure of failures) console.error(`   - ${failure}`);
  process.exit(1);
}
console.log('✅ iOS native bridge names match Swift, ObjC, and JS');
