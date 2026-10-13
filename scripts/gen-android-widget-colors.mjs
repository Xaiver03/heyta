#!/usr/bin/env node
/**
 * Android RemoteViews 小组件颜色生成器
 * =====================================
 *
 * Android 小组件是在启动器进程里重新充气的，不能把启动器的
 * `?android:attr/colorBackground` 当成 heyta 设计系统颜色。这里把同一份
 * `packages/design-system/src/tokens.css` 生成成 Android 的 values / values-night
 * 资源；不在脚本里复制任何颜色值。
 *
 * 用法：
 *   node scripts/gen-android-widget-colors.mjs          # 生成资源
 *   node scripts/gen-android-widget-colors.mjs --check  # 逐字节检查漂移
 *
 * 这是资源生成检查，不替代 `pnpm check:tokens`：后者先确认 design-system 的
 * Swift / ArkTS / JSON / RN 生成物与 tokens.css 同步，本脚本再从 tokens.css 直接
 * 生成 Android 资源，避免 tokens.json 过期时被继续传播。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CHECK = process.argv.includes('--check');
const require = createRequire(join(ROOT, 'apps/web/package.json'));
const { extractVars, resolveAllVars } = require('@heyta/design-system');

const SOURCE = join(ROOT, 'packages/design-system/src/tokens.css');
const RES = join(ROOT, 'apps/mobile/android/app/src/main/res');
const css = readFileSync(SOURCE, 'utf8');

const TOKENS = {
  surface: 'color.surface',
  foreground: 'color.foreground',
  foreground_muted: 'color.foreground-muted',
};

function token(name, theme) {
  const vars = extractVars(css, theme === 'light' ? undefined : theme);
  const cssName = `--ht-${name.replaceAll('.', '-')}`;
  const value = vars.get(cssName);
  if (value === undefined) throw new Error(`${theme} 档缺少 design-system token ${name}`);
  return resolveAllVars(value, vars);
}

function androidColor(value, name, theme) {
  const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
  if (!hex) throw new Error(`${theme} ${name} 不是 #rrggbb：${value}`);
  return `#FF${hex[1].toUpperCase()}`;
}

function resource(theme) {
  const values = Object.entries(TOKENS).map(([resourceName, tokenName]) => {
    const value = androidColor(token(tokenName, theme), tokenName, theme);
    return `    <color name="heyta_widget_${resourceName}">${value}</color>`;
  });
  const qualifier = theme === 'light' ? 'values' : 'values-night';
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- HEYTA-ANDROID-WIDGET-COLORS:BEGIN 生成物，请勿手改 —— scripts/gen-android-widget-colors.mjs -->
<!-- source: packages/design-system/src/tokens.css; theme: ${theme}; qualifier: ${qualifier} -->
<resources>
    <!-- color.surface / color.foreground / color.foreground-muted -->
${values.join('\n')}
</resources>
<!-- HEYTA-ANDROID-WIDGET-COLORS:END -->
`;
}

const targets = [
  [join(RES, 'values/colors.xml'), resource('light'), 'values/colors.xml'],
  [join(RES, 'values-night/colors.xml'), resource('dark'), 'values-night/colors.xml'],
];
const drift = [];
const written = [];

for (const [path, content, label] of targets) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (CHECK) {
    if (existing !== content) drift.push(label);
  } else if (existing !== content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    written.push(label);
  }
}

if (CHECK) {
  if (drift.length > 0) {
    console.error(`🔴 Android 小组件颜色与 design-system 漂移：${drift.join('、')}`);
    console.error('   闭合命令：node scripts/gen-android-widget-colors.mjs');
    process.exit(1);
  }
  console.log('✅ Android 小组件亮暗颜色与 tokens.css 逐字节对账通过（2 份）');
} else {
  console.log(`✅ Android 小组件颜色生成完成（${written.length} 份变更）`);
}
