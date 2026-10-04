/**
 * AI 面板"跨挂载点不掉状态"这一层的变异验证 —— 三条臂，各摘一次。
 *
 * 为什么需要它（AGENTS.md §7 元规则第 2 条：不能失败的检查没有价值）：
 * 这八条判据断言的都是**界面上少了一样东西**（披露没了、草稿没了）。
 * 而"少了"最容易写成一条永远通过的判据 —— 所以每条臂都要打在
 * **落地后真会跑的那一份源码**上，并且断言红的是**恰好那几条**。
 *
 * 三条臂对应三个形状，其中两条正是**被读数否证掉的旧修法**：
 * · M1 状态回到每次挂载（= 改造前的形状，`78cdff67` 带出缺陷那一版）
 * · M2 状态住在进程级变量上（= 被否证的第一条修法：同进程反复挂载互相串）
 * · M3 摘掉账号绑定（= 让"换账号带一个字"这条安全判据失效）
 *
 * ⚠️ 臂的期望集合按**面板**列（助手三条 + 单步两条 …）：把两个面板钉在同一条
 *   存储上是这层的整个理由，所以"只红一个面板"就是判据没覆盖到另一半。
 *
 * 用法：`node apps/web/tests/mutate-panel-ephemeral.mjs`
 * 每步用完立刻还原并逐字节校验；中途抛错也会在 finally 里还原。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const EPHEMERAL = resolve(PKG, 'src/features/ai/panel-ephemeral.tsx');
const SPEC = 'tests/ai-panel-remount.spec.tsx';

/** 八条判据的**身份串**（用标题里独有的片段，不用整句 —— 整句会被措辞改动撞坏）。 */
const T = {
  disclosure: '披露已经摆在眼前',
  draft: '那句草稿',
  running: '正在飞时换挂载点',
  account: '上一个人的草稿',
  module: '整棵树卸载重装',
  toolDisclosure: '单步面板的未决披露',
  toolDraft: '单步面板的草稿',
  toolAccount: '单步面板的账号绑定',
};

const MUTATIONS = [
  {
    file: EPHEMERAL,
    name: 'M1 未决状态回到每次挂载（改造前的形状）',
    from: `  const visible = entry !== undefined && entry.owner === account ? entry.value : initial;
  return {
    owner: entry?.owner,
    value: visible as T,
    write,
  };`,
    to: `  const [localValue, setLocalValue] = useState<T>(initial);
  const [localOwner, setLocalOwner] = useState<string | null | undefined>(undefined);
  return {
    owner: localOwner,
    value: localValue,
    write(nextAccount: string | null, patch: Partial<T>): void {
      setLocalOwner(nextAccount);
      setLocalValue((previous) =>
        localOwner !== nextAccount ? { ...initial, ...patch } : { ...previous, ...patch },
      );
    },
  };`,
    // 两个面板都退回组件内状态 ⇒ 跨挂载点那五条红；助手的账号那条与"新 Provider"那条
    // 反而**过**（每次挂载都是新的，本来就不会串）—— 这正是 M2/M3 各自要单独钉的原因。
    // ⚠️ 单步那条账号判据**也**红，但红在换挂载点**之前**：M1 的 write 用闭包里的
    //   `localOwner` 而不是 `previous.owner`，同一次点击连写两样（清输入 + 置阶段）时
    //   后一次把前一次覆盖掉 —— 助手那条恰好把 `setPhase` 写在最后所以躲过，单步是先写
    //   阶段。这不是判据过严，是"同拍多次写必须走函数式 updater"这条约束的现形。
    expectRed: [T.disclosure, T.draft, T.running, T.toolDisclosure, T.toolDraft, T.toolAccount],
  },
  {
    file: EPHEMERAL,
    name: 'M2 未决状态住在进程级变量上（被否证的那条修法）',
    from: `  const [entries, setEntries] = useState<Record<string, Entry>>({});`,
    to: `  const [entries, setEntriesRaw] = useState<Record<string, Entry>>(
    (globalThis as unknown as { __HT_PANEL_EPH_LEAK?: Record<string, Entry> }).__HT_PANEL_EPH_LEAK ?? {},
  );
  const setEntries: typeof setEntriesRaw = (update) => {
    setEntriesRaw((previous) => {
      const next = update(previous);
      (globalThis as unknown as { __HT_PANEL_EPH_LEAK?: Record<string, Entry> }).__HT_PANEL_EPH_LEAK = next;
      return next;
    });
  };`,
    expectRed: [T.module],
  },
  {
    file: EPHEMERAL,
    name: 'M3 摘掉账号绑定（换账号照样带字）',
    from: `  const visible = entry !== undefined && entry.owner === account ? entry.value : initial;`,
    to: `  const visible = entry?.value ?? initial;`,
    // 绑定摘掉 ⇒ 两个面板的账号判据都要红（只红一个 = 另一半没被这条守住）。
    expectRed: [T.account, T.toolAccount],
  },
];

const files = [...new Set(MUTATIONS.map((m) => m.file))];
const backups = new Map();
const backupDir = mkdtempSync('mutate-panel-ephemeral-');
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

    // 红的是**哪几条**：把失败行的用例名取出来（`× … > describe > 标题` 与 `× 标题` 两种形状都吃）。
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
