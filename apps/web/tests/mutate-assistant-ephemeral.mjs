/**
 * AI 面"跨挂载点不掉状态"这一层的变异验证 —— 三条臂，各摘一次。
 *
 * 为什么需要它（AGENTS.md §7 元规则第 2 条：不能失败的检查没有价值）：
 * 这五条判据断言的都是**界面上少了一样东西**（披露没了、草稿没了）。
 * 而"少了"最容易写成一条永远通过的判据 —— 所以每条臂都要打在
 * **落地后真会跑的那一份源码**上，并且断言红的是**恰好那几条**。
 *
 * 三条臂对应三个形状，其中两条正是**被读数否证掉的旧修法**：
 * · M1 状态回到每次挂载（= 改造前的形状，`78cdff67` 带出缺陷那一版）
 * · M2 状态住在进程级变量上（= 被否证的第一条修法：同进程反复挂载互相串）
 * · M3 摘掉账号绑定（= 让"换账号带一个字"这条安全判据失效）
 *
 * 用法：`node apps/web/tests/mutate-assistant-ephemeral.mjs`
 * 每步用完立刻还原并逐字节校验；中途抛错也会在 finally 里还原。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const EPHEMERAL = resolve(PKG, 'src/features/ai/assistant-ephemeral.tsx');
const PANEL = resolve(PKG, 'src/features/ai/AssistantPanel.tsx');
const SPEC = 'tests/ai-assistant-remount.spec.tsx';

/** 五条判据的**身份串**（用标题里独有的片段，不用整句 —— 整句会被措辞改动撞坏）。 */
const T = {
  disclosure: '披露已经摆在眼前',
  draft: '那句草稿',
  running: '正在飞时换挂载点',
  account: '上一个人的草稿',
  module: '整棵树卸载重装',
};

const MUTATIONS = [
  {
    file: EPHEMERAL,
    name: 'M1 未决状态回到每次挂载（改造前的形状）',
    from: `  const value = useContext(AssistantEphemeralContext);
  if (value === null) {
    throw new Error('AssistantPanel 必须包在 <AssistantEphemeralProvider> 里');
  }
  return value;`,
    to: `  if (useContext(AssistantEphemeralContext) === null) {
    throw new Error('AssistantPanel 必须包在 <AssistantEphemeralProvider> 里');
  }
  const [local, setLocal] = useState<AssistantEphemeralState>({ ...EMPTY, owner: undefined });
  return {
    ...local,
    write(account: string | null, patch: Partial<typeof EMPTY>): void {
      setLocal((previous) =>
        previous.owner !== account ? { ...EMPTY, owner: account, ...patch } : { ...previous, ...patch },
      );
    },
  };`,
    expectRed: [T.disclosure, T.draft, T.running],
  },
  {
    file: EPHEMERAL,
    name: 'M2 未决状态住在进程级变量上（被否证的那条修法）',
    from: `  const [state, setState] = useState<AssistantEphemeralState>({ ...EMPTY, owner: undefined });`,
    to: `  const [state, setStateRaw] = useState<AssistantEphemeralState>(
    (globalThis as unknown as { __HT_EPH_LEAK?: AssistantEphemeralState }).__HT_EPH_LEAK ?? {
      ...EMPTY,
      owner: undefined,
    },
  );
  const setState: typeof setStateRaw = (update) => {
    setStateRaw((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      (globalThis as unknown as { __HT_EPH_LEAK?: AssistantEphemeralState }).__HT_EPH_LEAK = next;
      return next;
    });
  };`,
    expectRed: [T.module],
  },
  {
    file: PANEL,
    name: 'M3 摘掉账号绑定（换账号照样带字）',
    from: `  const stale = ephemeral.owner !== undefined && ephemeral.owner !== session.account;`,
    to: `  const stale = false;`,
    expectRed: [T.account],
  },
];

const files = [...new Set(MUTATIONS.map((m) => m.file))];
const backups = new Map();
const backupDir = mkdtempSync('mutate-assistant-ephemeral-');
for (const [index, file] of files.entries()) {
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
      console.log(`❌ ${mut.name}\n   锚点命中 ${String(hits)}（必须是 1）⇒ 读数无效，先修脚本`);
      violations += 1;
      continue;
    }
    writeFileSync(mut.file, source.text.replace(mut.from, mut.to));

    let out = '';
    let code = 0;
    try {
      out = execFileSync('npx', ['vitest', 'run', SPEC], {
        cwd: PKG,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', TFA_ALLOW_CONCURRENT_TEST: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      out = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`;
      code = typeof e.status === 'number' ? e.status : 1;
    }
    writeFileSync(mut.file, source.text);
    if (readFileSync(mut.file, 'utf8') !== source.text) throw new Error(`还原失败：${mut.file}`);

    // 红的是**哪几条**：取每条失败行的用例名（`× … > describe > 标题`），只留最后一段。
    const failed = [
      ...new Set(
        [...out.matchAll(/^\s*(?:×|FAIL)\s+.*> (.+)$/gm)]
          .map((m) => m[1].trim())
          .concat([...out.matchAll(/^\s*× (.+)$/gm)].map((m) => m[1].trim())),
      ),
    ];
    const redKeys = Object.values(T).filter((key) => failed.some((line) => line.includes(key)));
    const missing = mut.expectRed.filter((key) => !redKeys.includes(key));
    const extra = redKeys.filter((key) => !mut.expectRed.includes(key));
    const ok = code !== 0 && missing.length === 0 && extra.length === 0;
    if (!ok) violations += 1;
    console.log(
      `${ok ? '✅' : '❌'} ${mut.name}\n   rc=${String(code)} 红的判据=${String(redKeys.length)}：` +
        `${redKeys.join(' / ') || '（一条都没红 —— 那就是永远通过的判据）'}` +
        (missing.length > 0 ? `\n   🔴 该红没红：${missing.join(' / ')}` : '') +
        (extra.length > 0 ? `\n   🔴 不该红却红了：${extra.join(' / ')}` : ''),
    );
  }
} finally {
  for (const [file, source] of backups) writeFileSync(file, source.text);
  rmSync(backupDir, { recursive: true, force: true });
}

const restored = files.every(
  (file) => readFileSync(file, 'utf8') === backups.get(file)?.text,
);
console.log(`\n还原=${restored ? 'OK（逐字节一致）' : 'FAIL'} 不符预期=${String(violations)}`);
process.exit(restored && violations === 0 ? 0 : 1);
