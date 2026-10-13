/** Windows 小组件文案仅从 packages/i18n 源词条生成。--check 检查漂移。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'packages/i18n/package.json'));
const ts = require('typescript');
const output = resolve(root, 'apps/desktop-windows/Heyta.Windows.Core/widget-strings.generated.json');
const extraKeys = ['web.habits.streak.current', 'web.habits.streak.currentOne'];
for (let slot = 1; slot <= 4; slot++) extraKeys.push(`web.quadrant.q${slot}`);

function catalog(locale) {
  const source = ts.createSourceFile(`${locale}.ts`, readFileSync(resolve(root, `packages/i18n/src/locales/${locale}.ts`), 'utf8'), ts.ScriptTarget.Latest, true);
  const values = {};
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) {
      const key = node.name.text;
      if (key.startsWith('widget.') || extraKeys.includes(key)) {
        if (!ts.isStringLiteral(node.initializer)) throw new Error(`小组件词条必须是静态字符串：${key}`);
        values[key] = node.initializer.text;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
}

const zh = catalog('zh-CN');
const en = catalog('en');
if (!Object.keys(zh).length || JSON.stringify(Object.keys(zh)) !== JSON.stringify(Object.keys(en))) throw new Error('小组件中英文案键不一致');
for (const key of extraKeys) if (!(key in zh)) throw new Error(`缺少小组件词条：${key}`);
const generated = JSON.stringify({ 'zh-CN': zh, en }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== generated) throw new Error('Windows 小组件文案产物过期，请运行 node scripts/gen-windows-widget-strings.mjs');
  console.log('Windows 小组件文案产物与 i18n 源一致');
} else {
  writeFileSync(output, generated);
  console.log('已从 i18n 源生成 Windows 小组件文案');
}
