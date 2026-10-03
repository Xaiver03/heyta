/**
 * 会话历史这一层的变异验证 —— 四条接线各摘一次，看**恰好该红的那几条**红。
 *
 * 为什么需要它：恢复、失效标记、新会话清盘、存在哪儿的声明，四条都是
 * "界面上看不出没做"的东西 —— 少了任何一条，其余用例照样全绿，
 * 而那正是要防的"永远通过的判据"（AGENTS.md §7 元规则第 2 条）。
 *
 * 用法：`node apps/web/tests/mutate-assistant-history.mjs`
 * 每步用完立刻还原并逐字节校验；中途抛错也会在 finally 里还原。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const PANEL = resolve(PKG, 'src/features/ai/AssistantPanel.tsx');
const HISTORY = resolve(PKG, 'src/features/ai/assistant-history.ts');

const MUTATIONS = [
  {
    file: PANEL,
    name: 'N1 恢复不生效（初始状态无视磁盘）',
    from: 'const [items, setItems] = useState<readonly ChatItem[]>(restored?.items ?? []);',
    to: 'const [items, setItems] = useState<readonly ChatItem[]>([]);',
    expectRed: 5,
  },
  {
    file: HISTORY,
    name: 'N2 未确认的提案恢复后照样可以点确认',
    from: '        ...(unresolved ? { expired: true as const } : {}),',
    to: '',
    expectRed: 1,
  },
  {
    file: PANEL,
    name: 'N3 空会话不再删盘上那份（「新会话」只清状态）',
    from: '    if (items.length === 0) {\n      clearAssistantHistory(props.historyStorage ?? null);\n      return;\n    }\n',
    to: '',
    expectRed: 1,
  },
  {
    file: PANEL,
    name: 'N4 不告诉用户这段历史存在哪儿',
    from: '      {items.length > 0 && (\n        <p className="ht-ai__note" data-testid="ai-assistant-local-only">',
    to: '      {false && (\n        <p className="ht-ai__note" data-testid="ai-assistant-local-only">',
    expectRed: 1,
  },
];

const backups = new Map();
const backupDir = mkdtempSync('mutate-assistant-history-');
for (const [index, file] of [PANEL, HISTORY].entries()) {
  const copy = join(backupDir, `backup-${String(index)}.tsx`);
  copyFileSync(file, copy);
  backups.set(file, { copy, text: readFileSync(file, 'utf8') });
}

let violations = 0;
try {
  for (const mut of MUTATIONS) {
    const source = backups.get(mut.file);
    const hits = source.text.split(mut.from).length - 1;
    if (hits !== 1) {
      console.log(`❌ ${mut.name}\n   锚点命中 ${hits}（必须是 1）⇒ 读数无效，先修脚本`);
      violations += 1;
      continue;
    }
    writeFileSync(mut.file, source.text.replace(mut.from, mut.to));
    let out = '';
    let code = 0;
    try {
      out = execFileSync('npx', ['vitest', 'run', 'tests/assistant-history-panel.spec.tsx'], {
        cwd: PKG,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      out = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`;
      code = typeof e.status === 'number' ? e.status : 1;
    }
    writeFileSync(mut.file, source.text);
    if (readFileSync(mut.file, 'utf8') !== source.text) throw new Error(`还原失败：${mut.file}`);

    const failed = [...new Set([...out.matchAll(/^\s*(?:×|FAIL)\s+\S+\s+>\s+(.+?)(?:\s+\d+ms)?$/gm)].map((x) => x[1].trim()))];
    const red = failed.length;
    const ok = code !== 0 && red === mut.expectRed;
    if (!ok) violations += 1;
    console.log(
      `${ok ? '✅' : '❌'} ${mut.name}\n   rc=${code} 红=${String(red)}（预期 ${String(mut.expectRed)}）` +
        failed.map((f) => `\n     - ${f}`).join(''),
    );
  }
} finally {
  for (const [file, source] of backups) writeFileSync(file, source.text);
  rmSync(backupDir, { recursive: true, force: true });
}

const restored = readFileSync(PANEL, 'utf8') === backups.get(PANEL)?.text;
console.log(`\n还原=${restored ? 'OK（逐字节一致）' : 'FAILED'} 不符预期=${String(violations)}`);
process.exit(restored && violations === 0 ? 0 : 1);
