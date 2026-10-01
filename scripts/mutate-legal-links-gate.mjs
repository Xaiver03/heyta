/**
 * 链 2 判据的变异验证
 * ====================
 *
 * 四个真实漏法，每个都必须让**对应**那侧的测试转红：
 *
 *   M1 官方判定改成前缀匹配        → `packages/app-host` 的兄弟域名用例红
 *   M2 两条链接整块删掉            → `apps/web` 的链接用例红
 *   M3 把链接移进 `<label>`        → `apps/web` 的"点链接不切勾选"红
 *   M4 一律按官方域处理（自建实例也被挂上 heyta 的政策）
 *                                 → **真浏览器**那一组红（`e2e/legal-links`）
 *
 * M4 为什么单独要真浏览器那一层：M1 抓的是"判定写成前缀"，而 M4 抓的是
 * "判定整个被拿掉"。前者在决策层就能看见，后者在决策层的测试里**同样**会红 ——
 * 但链 2 的验收判据是"点下去到了哪"，所以必须证明**那一条**也能红，
 * 而不是只有下面两层能红。
 *
 * 本脚本会**临时改写工作树**，所以每个变异跑完立刻还原并核对字节；
 * 还原前先比对磁盘内容，不一致就停手（共享工作树里别人可能正在改同一批文件）。
 *
 * 用法：`node scripts/mutate-legal-links-gate.mjs`（退出码非 0 = 有判据抓不到）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const RESOLVER = `${ROOT}/packages/app-host/src/legal-links.ts`;
const PANEL = `${ROOT}/apps/web/src/features/auth/AuthPanel.tsx`;

const pristine = new Map([
  [RESOLVER, readFileSync(RESOLVER, 'utf8')],
  [PANEL, readFileSync(PANEL, 'utf8')],
]);

function replaceIn(file, from, to) {
  const src = pristine.get(file);
  if (!src.includes(from)) throw new Error(`变异锚点没命中：${from.slice(0, 50)}`);
  writeFileSync(file, src.replace(from, to));
}

/** 还原并核对字节。 */
function restore(file) {
  const want = pristine.get(file);
  if (readFileSync(file, 'utf8') !== want) writeFileSync(file, want);
  if (readFileSync(file, 'utf8') !== want) throw new Error(`还原失败：${file}`);
}

const APP_HOST_CMD = ['--filter', '@heyta/app-host', 'exec', 'vitest', 'run', 'tests/legal-links.spec.ts'];
const WEB_CMD = ['--filter', '@heyta/web', 'exec', 'vitest', 'run', 'tests/auth-panel.spec.tsx'];

/** 从面板原文里截出"两条链接"那一整块（含前后换行，便于原样搬进 label）。 */
function legalBlock() {
  const src = pristine.get(PANEL);
  const start = src.indexOf('        {legalLinks === null ? null : (');
  const end = src.indexOf('        <div style={{ display: \'flex\', gap: cssVar(\'space.2\') }}>', start);
  if (start < 0 || end < start) throw new Error('截不到两条链接那一块');
  return src.slice(start, end);
}

const cases = [
  {
    name: 'M1 官方判定改成前缀匹配（兄弟域名会被误判成官方）',
    files: [RESOLVER],
    apply: () =>
      replaceIn(
        RESOLVER,
        "host !== '' && host === hostFromServerUrl(OFFICIAL_SITE_ORIGIN)",
        "host !== '' && host.startsWith(hostFromServerUrl(OFFICIAL_SITE_ORIGIN))",
      ),
    cmd: APP_HOST_CMD,
    cwd: `${ROOT}/packages/app-host`,
  },
  {
    name: 'M2 两条链接整块删掉（要求用户同意一份读不到的政策）',
    files: [PANEL],
    apply: () => {
      const block = legalBlock();
      const src = pristine.get(PANEL).replace(block, '');
      if (src === pristine.get(PANEL)) throw new Error('M2 没删掉任何东西');
      writeFileSync(PANEL, src);
    },
    cmd: WEB_CMD,
    cwd: `${ROOT}/apps/web`,
  },
  {
    name: 'M3 把链接移进 <label>（点链接就等于勾选同意）',
    files: [PANEL],
    apply: () => {
      const block = legalBlock();
      const withoutBlock = pristine.get(PANEL).replace(block, '');
      const anchor = "          {t('web.auth.terms.label')}\n        </label>";
      if (!withoutBlock.includes(anchor)) throw new Error('M3 锚点没命中');
      writeFileSync(
        PANEL,
        withoutBlock.replace(anchor, `          {t('web.auth.terms.label')}\n${block}        </label>`),
      );
    },
    cmd: WEB_CMD,
    cwd: `${ROOT}/apps/web`,
  },
  {
    name: 'M4 一律按官方域处理（自建实例也被挂上 heyta 署名的政策）',
    files: [RESOLVER],
    apply: () =>
      replaceIn(
        RESOLVER,
        "host !== '' && host === hostFromServerUrl(OFFICIAL_SITE_ORIGIN)",
        // 把比较整个拿掉：所有 baseUrl 都走落地页分支。这正是 D-09 明令不许的那种改法。
        'true',
      ),
    bin: 'npx',
    cmd: ['playwright', 'test', '--config', 'playwright.legal-links.config.ts'],
    cwd: `${ROOT}/e2e`,
    // 🔴 改的是 `src/`，而浏览器加载的是 `dist/`（`packages/app-host/package.json`
    //    的 `exports` 只指向 dist）—— 不重 build，这个变异**根本不会生效**，
    //    于是"抓到了"与"没抓到"都测不出真相。AGENTS §7 第 27 条的同一种失效形态。
    rebuild: true,
  },
];

/** 重新构建 `@heyta/app-host`（变异改的是 src，而消费者读 dist）。 */
function rebuildAppHost() {
  execFileSync('pnpm', ['--filter', '@heyta/app-host', 'build'], {
    cwd: ROOT,
    stdio: 'pipe',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

let missed = 0;
for (const c of cases) {
  c.apply();
  if (c.rebuild) rebuildAppHost();
  let red = false;
  let out = '';
  try {
    execFileSync(c.bin ?? 'pnpm', c.cmd, {
      cwd: c.cwd,
      stdio: 'pipe',
      // 真浏览器那一组会把 vite build 的产物清单全打出来，默认 1 MB 缓冲会截断。
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (e) {
    red = true;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  // 打印**具体哪几条**转红：只报"退出码非 0"证明不了是这条判据抓到的
  // —— 加载期崩溃与判据红在退出码上长得一模一样。
  const failedTests = out
    .split('\n')
    .map((line) => line.replace(/\s{2,}$/, ''))
    .filter((line) => /(^\s*[×✕✗✘]\s)|(^\s*FAIL)/.test(line))
    .slice(0, 4)
    .map((line) => line.trim());
  console.log(`${red ? '✅ 被抓到' : '🔴 没抓到'} | ${c.name}`);
  if (red) {
    console.log(failedTests.length > 0 ? `        ${failedTests.join('\n        ')}` : '        (没解析到失败用例名)');
  }
  if (!red) missed += 1;
  for (const f of c.files) restore(f);
  // 还原 src 之后必须把 dist 也还原回去，否则**下一位消费者**读到的是变异产物。
  if (c.rebuild) rebuildAppHost();
}

console.log(
  missed === 0
    ? `结论：${cases.length} 个变异全部被抓到，工作树已还原`
    : `结论：${missed}/${cases.length} 个变异没被抓到 —— 那条判据是装饰`,
);
process.exit(missed === 0 ? 0 : 1);
