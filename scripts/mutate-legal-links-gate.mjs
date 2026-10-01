/**
 * 链 2 判据的变异验证
 * ====================
 *
 * 四个真实漏法，每个都必须让**对应**那侧的测试转红：
 *
 *   M1 官方判定改成前缀匹配        → `packages/app-host` 的兄弟域名用例红
 *   M2 两条链接整块删掉            → `apps/web` 的链接用例红（真渲染，读 `@heyta/ui` 的 dist）
 *   M3 把链接移进同意项的可点区域  → `packages/ui` 的形状判据红
 *   M4 一律按官方域处理（自建实例也被挂上 heyta 的政策）
 *                                 → **真浏览器**那一组红（`e2e/legal-links`）
 *
 * M4 为什么单独要真浏览器那一层：M1 抓的是"判定写成前缀"，而 M4 抓的是
 * "判定整个被拿掉"。前者在决策层就能看见，后者在决策层的测试里**同样**会红 ——
 * 但链 2 的验收判据是"点下去到了哪"，所以必须证明**那一条**也能红，
 * 而不是只有下面两层能红。
 *
 * 🔴 **M2/M3 的锚点 2026-10-02 从 `AuthPanel.tsx` 搬到了 `AuthForm.tsx`**。
 * 面板变成薄壳之后，那两条链接**不在 web 里了**（`git grep legalBlock -- apps/web` 为 0），
 * 旧锚点会抛"截不到两条链接那一块"。判据也跟着换：M3 原来钉的是
 * `label a[href]` 计数，而共享表单**一个 `<label>` 都没有** ⇒ 那条恒为 0（装饰）。
 * 现在 M3 由 `packages/ui/tests/auth-form.spec.ts` 那条容器判据抓，
 * 真浏览器侧另有一条带分母的同款（见 `e2e/legal-links/legal-links.spec.ts`）。
 *
 * 本脚本会**临时改写工作树**，所以每个变异跑完立刻还原并核对字节；
 * 还原前先比对磁盘内容，不一致就停手（共享工作树里别人可能正在改同一批文件）。
 *
 * ⚠️ M2/M4 会重跑 `build`：改的是 `src/`，而消费者读 `dist/`。
 * 所以这个脚本运行的**那几十秒**里，`packages/app-host/dist` 与
 * `packages/ui/dist` 是变异产物 —— 别在并行会话跑测试时按它（BLOCKED.md B8
 * 记的就是共享 dist 被一次 build 关掉的窗口）。
 *
 * 用法：`node scripts/mutate-legal-links-gate.mjs [--skip-browser]`
 *   退出码非 0 = 有判据**抓不到**，或有判据**没验证成**（基线红 / 被跳过）。
 *   两种都要当真：后者不是"通过"。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const RESOLVER = `${ROOT}/packages/app-host/src/legal-links.ts`;
const FORM = `${ROOT}/packages/ui/src/auth/AuthForm.tsx`;

const pristine = new Map([
  [RESOLVER, readFileSync(RESOLVER, 'utf8')],
  [FORM, readFileSync(FORM, 'utf8')],
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
const WEB_CMD = ['--filter', '@heyta/web', 'exec', 'vitest', 'run', 'tests/auth-form.spec.tsx'];
const UI_SHAPE_CMD = ['--filter', '@heyta/ui', 'exec', 'vitest', 'run', 'tests/auth-form.spec.ts'];

/** 从表单原文里截出"两条条款链接"那一整块（含前后换行，便于原样搬进同意项里）。 */
function legalBlock() {
  const src = pristine.get(FORM);
  const start = src.indexOf('{labels.legal !== undefined ? (');
  // 闭合以它后面那个 `</>` 定位：块内还有一个 `) : null}`（邀请码那一栏），
  // 只往前找第一个会截半块 —— 半个文件的变异和"锚点没命中"在结果上长得不一样，
  // 但都证明不了这条判据抓的是整块删除。
  const end = src.indexOf(') : null}\n            </>', start);
  if (start < 0 || end < start) throw new Error('截不到两条链接那一块');
  return src.slice(src.lastIndexOf('\n', start) + 1, end + ') : null}'.length + 1);
}

/** 同意项从 checkbox 角色到它自己的闭合标签（M3 搬进去的那个容器）。 */
function termsContainer(src) {
  const start = src.indexOf('accessibilityRole="checkbox"');
  const end = src.indexOf('</Pressable>', start);
  if (start < 0 || end < start) throw new Error('截不到同意项那一块');
  return { start, end };
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
    files: [FORM],
    apply: () => {
      const block = legalBlock();
      const src = pristine.get(FORM).replace(block, '');
      if (src === pristine.get(FORM)) throw new Error('M2 没删掉任何东西');
      writeFileSync(FORM, src);
    },
    cmd: WEB_CMD,
    cwd: `${ROOT}/apps/web`,
    // 🔴 同 M4：web 的 spec 从 `@heyta/ui` 的 **dist** 里拿组件，不重 build 这个变异不生效。
    rebuildUi: true,
  },
  {
    name: 'M3 把链接移进同意项的可点区域（点条款就等于勾选同意）',
    files: [FORM],
    apply: () => {
      const block = legalBlock();
      const withoutBlock = pristine.get(FORM).replace(block, '');
      if (withoutBlock === pristine.get(FORM)) throw new Error('M3 没搬出任何东西');
      const { end } = termsContainer(withoutBlock);
      // 搬到 `</Pressable>` **之前** = 成为同意项的子节点：
      // 于是点条款的那一下同时命中父级的 checkbox 处理器，"读条款"变成"我同意了"。
      writeFileSync(
        FORM,
        `${withoutBlock.slice(0, end)}${block}${withoutBlock.slice(end)}`,
      );
    },
    cmd: UI_SHAPE_CMD,
    cwd: `${ROOT}/packages/ui`,
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
    browser: true,
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

/** 重新构建 `@heyta/ui`：M2 改的是 `packages/ui/src`，而 web 的 spec 读它的 dist。 */
function rebuildUi() {
  execFileSync('pnpm', ['--filter', '@heyta/ui', 'build'], {
    cwd: ROOT,
    stdio: 'pipe',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * 跑一次判据，返回它是否**全绿**。
 *
 * 只看退出码不看"哪几条红"是不够的：加载期崩溃与判据红在退出码上长得一模一样，
 * 所以下面要把转红的用例名打印出来。
 */
function run(c) {
  try {
    execFileSync(c.bin ?? 'pnpm', c.cmd, {
      cwd: c.cwd,
      stdio: 'pipe',
      // 真浏览器那一组会把 vite build 的产物清单全打出来，默认 1 MB 缓冲会截断。
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { red: false, out: '' };
  } catch (e) {
    return { red: true, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** 从输出里挑出转红的用例名（最多 4 条）。 */
function failedTestsOf(out) {
  return out
    .split('\n')
    .map((line) => line.replace(/\s{2,}$/, ''))
    .filter((line) => /(^\s*[×✕✗✘]\s)|(^\s*FAIL)/.test(line))
    .slice(0, 4)
    .map((line) => line.trim());
}

/**
 * 🔴 **先跑基线**：判据在**没有变异**的源码上必须是绿的，否则"这个变异被抓到了"
 * 这句话没有任何内容。
 *
 * 这不是理论担忧 —— 2026-10-02 实测：工作树里有一条**别人未提交**的隐私同意遮罩
 * （BLOCKED.md B9），它把真浏览器那一组**全部**判红，红的地方是首屏第一次点击。
 * 那种状态下 M4 的输出正好是"✅ 被抓到"，而它抓到的是遮罩，不是那条分流判据。
 * **一条永远红的判据和一条永远绿的判据一样是装饰**，只是反过来的装饰。
 */
function baseline(c) {
  const { red, out } = run(c);
  if (!red) return true;
  console.log(`⚠️ 基线就是红的，这条变异本轮**无法验证** | ${c.name}`);
  console.log(`        ${failedTestsOf(out).join('\n        ') || '(没解析到失败用例名)'}`);
  return false;
}

/**
 * `--skip-browser`：跳过 M4。真浏览器那一组要一个**干净工作树**（B9），
 * 在共享工作树里跑它只会得到一个不可解释的"抓到/没抓到"。
 * 跳过会被记成"没验证"并以非 0 收尾 —— 不假装成"全部抓到"。
 */
const skipBrowser = process.argv.includes('--skip-browser');

let missed = 0;
let unverified = 0;
for (const c of cases) {
  for (const f of c.files) {
    // 别人可能在我读快照之后写了同一个文件；那种情况下 restore 会把**他们的**版本
    // 覆盖成我这份旧快照。所以停手，而不是继续。
    if (readFileSync(f, 'utf8') !== pristine.get(f)) {
      throw new Error(`${f} 在本次运行开始后被改过 —— 停手（共享工作树里不覆盖别人的版本）`);
    }
  }
  if (c.browser && skipBrowser) {
    console.log(`⏭️ 跳过（真浏览器那一条需要干净工作树）| ${c.name}`);
    unverified += 1;
    continue;
  }
  if (!baseline(c)) {
    unverified += 1;
    continue;
  }
  c.apply();
  if (c.rebuild) rebuildAppHost();
  if (c.rebuildUi) rebuildUi();
  const { red, out } = run(c);
  console.log(`${red ? '✅ 被抓到' : '🔴 没抓到'} | ${c.name}`);
  if (red) {
    const names = failedTestsOf(out);
    console.log(names.length > 0 ? `        ${names.join('\n        ')}` : '        (没解析到失败用例名)');
  }
  if (!red) missed += 1;
  for (const f of c.files) restore(f);
  // 还原 src 之后必须把 dist 也还原回去，否则**下一位消费者**读到的是变异产物。
  if (c.rebuild) rebuildAppHost();
  if (c.rebuildUi) rebuildUi();
}

const verdict = [];
if (missed > 0) verdict.push(`${missed} 个变异**没被抓到** —— 那条判据是装饰`);
if (unverified > 0) verdict.push(`${unverified} 个变异**没验证成**（基线红或被跳过）—— 不等于抓到了`);
console.log(
  verdict.length === 0
    ? `结论：${cases.length} 个变异全部被抓到，工作树已还原`
    : `结论：${verdict.join('；')}；工作树已还原`,
);
process.exit(missed === 0 && unverified === 0 ? 0 : 1);
