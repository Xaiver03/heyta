/**
 * R6「全局唤出」的界面腿（Electron 壳）
 * =====================================
 *
 * 这一支测的是**操作系统那一段**，所以它和仓库里绝大多数 e2e 不一样：
 * 键不是发给应用的，是**从外面**按的（`System Events` 合成一次真按键），
 * 被测应用当时**不在前台**。这正是判据①的全部要点 ——
 * 「应用在后台（主窗不可见）时热键能唤出」。
 *
 * 🔴 三条纪律，后来者不要删：
 *
 * 1. **判据只认行为，不认日志。** 本文件不读 `HEYTA_SUMMON` 那一行来判断任何事，
 *    因为"注册成功了"是壳自己的说法，而用户能不能唤出来才是事实。
 *    把注册注掉 ⇒ 按下去窗口不动 ⇒ 判据①②④全红（变异读数以手工跑法记在
 *    `docs/plans/r6-global-summon.md`）。
 * 2. **截图先于断言**（`ui-acceptance.md` §6.2 规定一）。
 *    ⚠️ 只对**可见**的窗口截图：`page.screenshot()` 打在隐藏窗口上会挂住，
 *    而"窗口收起来了"这件事本来就由可见性读数说，不由图说。
 * 3. **默认不抢前台**（规定二）：所有腿都带 `HEYTA_DESKTOP_NO_FOCUS=1`。
 *    唯一一只需要真焦点的腿（`① 焦点`）在 `HEYTA_SUMMON_FOCUS_LEG=1` 之下才跑，
 *    且收场时把前台还给原来那个应用 —— 因为它测的**就是**"拿到前台"这件事本身，
 *    让它默认常驻就等于每天都把用户踢出他正在做的事。
 *
 * ⚠️ 与 `desktop-window.spec.ts` 同一个前置：`HEYTA_DESKTOP_WINDOW=1`，
 *    否则**响亮跳过**。跳过不等于"这一格被验过"。
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DESKTOP_DIR = join(ROOT, 'apps', 'desktop');

/** 截图落点：固定路径，不随测试名变（§6.2 规定一第 2 条）。 */
const SHOT_DIR = join(ROOT, 'e2e', 'test-results');
const shot = (name: string): string => join(SHOT_DIR, `r6-global-summon-${name}.png`);

function ensureShotDir(): void {
  mkdirSync(SHOT_DIR, { recursive: true });
}

/* ── Electron 二进制：只查路径，绝不触发下载（同 desktop-window.spec.ts 那道门）── */

const desktopRequire = createRequire(join(DESKTOP_DIR, 'package.json'));
const ELECTRON_DIR = dirname(desktopRequire.resolve('electron'));
const ELECTRON_PATH_TXT = join(ELECTRON_DIR, 'path.txt');
const electronBinary = existsSync(ELECTRON_PATH_TXT)
  ? (desktopRequire('electron') as unknown as string)
  : '';

const GUI_ENABLED = process.env['HEYTA_DESKTOP_WINDOW'] === '1';
const FOCUS_LEG = process.env['HEYTA_SUMMON_FOCUS_LEG'] === '1';
const MAC = process.platform === 'darwin';

const SKIP_GUI =
  '需要 GUI 会话：置 `HEYTA_DESKTOP_WINDOW=1` 再跑（见 docs/runbooks/desktop.md §4、' +
  'docs/reference/environment-traps.md #580）。⚠️ 跳过不等于 R6 被验过。';
const SKIP_MAC = '这一支的按键合成用 macOS 的 System Events 与虚拟键码表，只能在 macOS 上跑。';
const SKIP_BINARY =
  `Electron 二进制没装（${ELECTRON_PATH_TXT} 不存在）。补装：` +
  '`node apps/desktop/node_modules/electron/install.js`（要代理 + NODE_USE_ENV_PROXY=1）。';

/* ── 按键合成 ───────────────────────────────────────────────────────── */

/**
 * macOS 虚拟键码（kVK_ANSI_* / kVK_Space）。
 *
 * 🔴 这张表**只服务于测试夹具**（把 accelerator 翻成一次真按键），产品代码没有一处读它。
 * 表写错的症状是"按下没反应 ⇒ 判据红"，而不是假绿，所以它可以安全地留在测试侧。
 * 只登记本文件用到的那几个键；缺了**直接抛**，不许静默按成别的键。
 */
const VKEY: Record<string, number> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  o: 31,
  u: 32,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  k: 40,
  n: 45,
  m: 46,
  return: 36,
  space: 49,
  escape: 53,
};

const APPLESCRIPT_MODIFIERS: Record<string, string> = {
  meta: 'command down',
  ctrl: 'control down',
  alt: 'option down',
  shift: 'shift down',
};

/**
 * 按一次组合键。按键发给**当前前台应用**，而全局热键在系统层就被截走，
 * 所以前台是谁不影响结果 —— 那正是"全局"两个字的含义，也是这条判据要的东西。
 */
function pressAccelerator(accelerator: string): void {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase());
  const key = parts[parts.length - 1];
  if (key === undefined || VKEY[key] === undefined) {
    throw new Error(`按键合成不认识这个键：${accelerator}（把它的虚拟键码补进 VKEY，别让它按成别的键）`);
  }
  const mods = parts
    .slice(0, -1)
    .map((part) => (part === 'commandorcontrol' ? 'meta' : part === 'option' ? 'alt' : part))
    .filter((part) => part in APPLESCRIPT_MODIFIERS)
    .map((part) => APPLESCRIPT_MODIFIERS[part]);
  const code = VKEY[key];
  const script =
    mods.length > 0
      ? `tell application "System Events" to key code ${String(code)} using {${mods.join(', ')}}`
      : `tell application "System Events" to key code ${String(code)}`;
  const run = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(
      `按键合成失败（**探针问题，不是产品问题**）：${script}\n${run.stderr.trim()}\n` +
        '   这台机器要给当前会话放行「辅助功能」（系统设置 → 隐私与安全性 → 辅助功能）。',
    );
  }
}

/** 当前前台应用的名字，用来证明"唤出过程没把人从他正在做的事里踢出来"。 */
function frontmostApp(): string {
  const run = spawnSync(
    'osascript',
    ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
    { encoding: 'utf8' },
  );
  return run.status === 0 ? run.stdout.trim() : `(读不到：${run.stderr.trim()})`;
}

function activateApp(name: string): void {
  spawnSync('osascript', ['-e', `tell application "${name}" to activate`], { encoding: 'utf8' });
}

/* ── 被测应用的窗口实况 ─────────────────────────────────────────────── */

interface WindowInfo {
  readonly title: string;
  readonly visible: boolean;
  readonly focused: boolean;
}

function windows(app: ElectronApplication): Promise<WindowInfo[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((win) => ({
      title: win.getTitle(),
      visible: win.isVisible(),
      focused: win.isFocused(),
    })));
}

function winOf(app: ElectronApplication, title: string): Promise<WindowInfo | undefined> {
  return windows(app).then((all) => all.find((w) => w.title === title));
}

const mainVisible = (app: ElectronApplication): Promise<boolean> =>
  winOf(app, 'heyta').then((w) => w !== undefined && w.visible);

/**
 * 起一次应用。
 *
 * @param opts.config 预先写进 userData 的键位文件（判据④用）；不传 = 用默认值。
 * @param opts.noFocus 默认 `true`（规定二）；只有焦点那条腿显式传 `false`。
 */
async function launchSummon(opts: {
  userDataDir: string;
  config?: { showHide: string; quickAdd: string };
  noFocus?: boolean;
}): Promise<ElectronApplication> {
  if (opts.config !== undefined) {
    writeFileSync(join(opts.userDataDir, 'summon.json'), JSON.stringify(opts.config), 'utf8');
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.noFocus === false) delete env['HEYTA_DESKTOP_NO_FOCUS'];
  else env['HEYTA_DESKTOP_NO_FOCUS'] = '1';

  return electron.launch({
    executablePath: electronBinary,
    /**
     * `--no-sandbox` 与 `--user-data-dir` 的理由逐字同 `desktop-window.spec.ts`：
     * 前者是本机运行环境的限制（不是放宽被测应用的沙箱策略），
     * 后者保证每一腿都用自己的临时库，不往真实用户库里写东西。
     */
    args: [join(DESKTOP_DIR, 'dist', 'main.cjs'), '--no-sandbox', `--user-data-dir=${opts.userDataDir}`],
    cwd: DESKTOP_DIR,
    env,
  });
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 挂上控制台收集：白窗口的根因几乎全在这里（§6.2 规定一第 2 条）。 */
function attachLogs(page: Page, sink: string[]): void {
  page.on('console', (message) => sink.push(`[console.${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => sink.push(`[pageerror] ${error.message}`));
}

async function pageOf(app: ElectronApplication, urlPart: string, timeout = 20_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = app.windows().find((page) => page.url().includes(urlPart));
    if (found !== undefined) return found;
    await wait(100);
  }
  const current = app.windows().map((page) => page.url());
  throw new Error(
    `没有哪个窗口加载了「${urlPart}」。\n   现在的窗口：${current.join(' | ') || '（一个都没有）'}\n` +
      '   ⚠️ 先怀疑探针：这一腿跑的是 `dist/main.cjs` + `renderer-dist/`，两样都得先 `pnpm --filter @heyta/desktop build`。',
  );
}

/** 默认键位（与 `summon-config.ts` 的 `DEFAULT_SUMMON_CONFIG` 同一串）。 */
const DEFAULT_SHOW_HIDE = 'CommandOrControl+Alt+Shift+S';
const DEFAULT_QUICK_ADD = 'CommandOrControl+Alt+Shift+A';

/**
 * 按热键，直到状态变成要的样子；返回用了几次。
 *
 * ⚠️ 为什么要**有界重试**：一次合成按键就是一个事件，macOS 在窗口切换或负载高的
 * 瞬间会把它丢掉，而"丢了一次"与"根本没注册"的症状**完全一样**（本机实测：
 * 同一套腿连跑三轮，第一下丢过一次）。不重试的话，这条判据会因为探针而红，
 * 那比它红得更贵 —— 没人会去查一个"看起来像产品坏了"的环境红。
 *
 * 🔴 重试**不削弱**判据：注册被注掉时三次全不动，照样红（变异读数记在
 * `docs/plans/r6-global-summon.md`）。次数打进读数，不藏起来。
 */
async function pressUntil(
  app: ElectronApplication,
  accelerator: string,
  read: () => Promise<boolean>,
  want: boolean,
  attempts = 3,
): Promise<number> {
  let last: boolean | undefined;
  for (let i = 1; i <= attempts; i += 1) {
    pressAccelerator(accelerator);
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      last = await read();
      if (last === want) return i;
      await wait(80);
    }
  }
  throw new Error(
    `按了 ${String(attempts)} 次「${accelerator}」，状态仍停在 ${String(last)}（要的是 ${String(want)}）。` +
      ' 两种可能：热键没注册上（产品），或这台机器把合成按键一直丢掉（探针）——' +
      ' 先跑 `pnpm --filter @heyta/desktop test` 里那两条纯判断，再看 osascript 是否还报权限。',
  );
}

/* ── 读库的小工具：一律走**既有 IPC 契约**，测试不碰 SQL、也不碰引擎 ── */

interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly projectId?: string;
  readonly dueDate?: number;
}

/**
 * 在渲染进程里调一次 IPC 契约。
 *
 * 🔴 只调**既有**那两条方法（`listTasks` / `addTask`），不新开口子：
 * 测试要的只是"界面能做的事，我也能做"，而不是给自己造一条后门。
 */
function request(page: Page, payload: unknown): Promise<unknown> {
  return page.evaluate((body: unknown) => {
    const host = (globalThis as unknown as {
      window: { heytaDesktop: { request(request: unknown): Promise<unknown> } };
    }).window.heytaDesktop;
    return host.request(body);
  }, payload) as Promise<unknown>;
}

async function listTasks(page: Page): Promise<TaskRow[]> {
  return (await request(page, { method: 'listTasks' })) as TaskRow[];
}

async function makeTask(page: Page, title: string, over?: { dueDate: number }): Promise<void> {
  await request(page, { method: 'addTask', title, over });
  await wait(500);
}

test.describe('R6 全局唤出（Electron 壳）', () => {
  test.skip(!MAC, SKIP_MAC);
  test.skip(electronBinary === '', SKIP_BINARY);
  test.skip(!GUI_ENABLED, SKIP_GUI);

  test('① 主窗不可见时，从系统层按全局热键能唤出（并读③：不抢前台）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heyta-r6-summon-'));
    const logs: string[] = [];
    const app = await launchSummon({ userDataDir: dir });
    try {
      const main = await pageOf(app, 'index.html');
      attachLogs(main, logs);
      ensureShotDir();
      await wait(1_500);
      await main.screenshot({ path: shot('1-before-hide') });

      expect(await mainVisible(app), '起点：主窗口应当是可见的').toBe(true);

      const frontBefore = frontmostApp();

      // 第一下 = 收起（显示与隐藏是同一条键的两个方向）。
      const hideTries = await pressUntil(app, DEFAULT_SHOW_HIDE, () => mainVisible(app), false);

      // 第二下 = 唤出。这一步能过，说明按键真的穿过操作系统走到了注册过的回调。
      const showTries = await pressUntil(app, DEFAULT_SHOW_HIDE, () => mainVisible(app), true);
      console.log(`   · ① 唤出读数：收起用了 ${String(hideTries)} 次按键，唤出用了 ${String(showTries)} 次`);
      await main.screenshot({ path: shot('2-after-summon') });

      // 🔴 判据③：整段唤出过程（NO_FOCUS 档）不许把用户从他的前台应用里踢出来。
      const frontAfter = frontmostApp();
      console.log(`   · ③ 前台应用读数：按之前「${frontBefore}」→ 按之后「${frontAfter}」`);
      expect(frontAfter, '不抢前台：唤出之后前台应用应当还是原来那个').toBe(frontBefore);

      // 窗口"出现但没拿到焦点"是这一档的正确形态；反过来才是抢前台。
      const mainWin = await winOf(app, 'heyta');
      expect(mainWin?.visible).toBe(true);
      expect(mainWin?.focused, 'NO_FOCUS 档下窗口不许拿到焦点').toBe(false);
    } catch (failure) {
      console.error(`──── 控制台 / 页面错误 ────\n${logs.join('\n') || '（无输出 —— 那更可疑）'}`);
      throw failure;
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('① 焦点那一半：唤出后窗口真的拿到焦点（要 HEYTA_SUMMON_FOCUS_LEG=1）', async () => {
    test.skip(!FOCUS_LEG, '这条测的就是"拿到前台"，所以默认不常驻：置 HEYTA_SUMMON_FOCUS_LEG=1 才跑（见文件头第 3 条）');
    const dir = mkdtempSync(join(tmpdir(), 'heyta-r6-focus-'));
    const frontBefore = frontmostApp();
    const app = await launchSummon({ userDataDir: dir, noFocus: false });
    try {
      const main = await pageOf(app, 'index.html');
      await wait(1_500);

      await pressUntil(app, DEFAULT_SHOW_HIDE, () => mainVisible(app), false);

      // 让别的应用到前台，模拟"用户正在用别的软件"。
      activateApp(frontBefore === 'Finder' ? 'System Settings' : 'Finder');
      await wait(1_000);

      await pressUntil(app, DEFAULT_SHOW_HIDE, () => mainVisible(app), true);
      const mainWin = await winOf(app, 'heyta');
      expect(mainWin?.focused, '判据①：唤出之后窗口要拿到焦点').toBe(true);
      ensureShotDir();
      await main.screenshot({ path: shot('3-focus-leg') });
      console.log(`   · ① 焦点读数：focused=${String(mainWin?.focused)}，前台原本是「${frontBefore}」`);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      // 收场把前台还给原来的应用：这一腿的副作用由它自己负责擦掉。
      activateApp(frontBefore);
    }
  });

  test('② 快速添加：不打开主窗也落一条 op（落完主窗看得到，且落点无清单归属）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heyta-r6-quickadd-'));
    const logs: string[] = [];
    const app = await launchSummon({ userDataDir: dir });
    const title = `R6 快速添加 ${String(Date.now())}`;
    try {
      const main = await pageOf(app, 'index.html');
      attachLogs(main, logs);
      ensureShotDir();
      await wait(1_500);

      // 先把主窗收起来 —— 之后所有动作都必须在"主窗不可见"之下完成。
      await pressUntil(app, DEFAULT_SHOW_HIDE, () => mainVisible(app), false);

      const before = await listTasks(main);
      expect(before.some((task) => task.title === title), '夹具标题撞上了库里已有的行').toBe(false);

      await pressUntil(app, DEFAULT_QUICK_ADD, () => winOf(app, '快速添加').then((w) => w?.visible ?? false), true);
      const panel = await pageOf(app, 'quick-add.html');
      attachLogs(panel, logs);

      // 🔴 面板出来了，而**主窗仍然不可见**：这一句就是"不打开主窗"。
      await expect
        .poll(() => winOf(app, '快速添加').then((w) => w?.visible ?? false), {
          message: '快速添加面板没出现',
          timeout: 12_000,
        })
        .toBe(true);
      expect(await mainVisible(app), '面板出来时主窗必须还是藏着的').toBe(false);
      await panel.screenshot({ path: shot('4-quick-add-panel') });

      await panel.getByTestId('quick-add-input').fill(title);
      await panel.keyboard.press('Enter');

      // 回执要说得出这条标题 —— 只写"存好了"三个字的话，它什么也没证明。
      await expect(panel.getByTestId('quick-add-receipt')).toContainText(title, { timeout: 15_000 });
      await expect(panel.getByTestId('quick-add-error')).toHaveCount(0);
      await panel.screenshot({ path: shot('5-quick-add-receipt') });

      // 🔴 落库：库才是权威，所以**重新读一次**，而不是信回执。
      const after = await listTasks(main);
      const created = after.find((task) => task.title === title);
      expect(created, `快速添加的那条没进库（前 ${String(before.length)} 条 / 后 ${String(after.length)} 条）`).toBeDefined();
      // 落点 =「收集箱」= 无清单归属。判据落在字段上，不落在"看着在那一列里"。
      expect(created?.projectId, '这条任务不该有清单归属（收集箱 = 没有 projectId）').toBeUndefined();

      // 主窗重新可见时看得到它（判据②的后半句）。
      await pressUntil(app, DEFAULT_SHOW_HIDE, () => mainVisible(app), true);
      await expect(
        main.locator('[data-testid^="task-row-"]').filter({ hasText: title }),
        '主窗可见后看不到那条任务',
      ).toHaveCount(1, { timeout: 15_000 });
      await main.screenshot({ path: shot('6-main-sees-it') });
    } catch (failure) {
      console.error(`──── 控制台 / 页面错误 ────\n${logs.join('\n') || '（无输出 —— 那更可疑）'}`);
      throw failure;
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('④ 键位可配置：默认键失灵、新键生效；重启（再读一次同一份文件）还在', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heyta-r6-config-'));
    const custom = { showHide: 'CommandOrControl+Alt+Shift+K', quickAdd: 'CommandOrControl+Alt+Shift+J' };
    try {
      // ── 第一次启动：userData 里是自定义键位 ──
      const app = await launchSummon({ userDataDir: dir, config: custom });
      try {
        const main = await pageOf(app, 'index.html');
        ensureShotDir();
        await wait(1_500);
        expect(await mainVisible(app), '起点：主窗应当可见').toBe(true);

        await pressUntil(app, custom.showHide, () => mainVisible(app), false);

        /**
         * 默认键应当**失灵**。
         *
         * ⚠️ 这是一条**反向**断言，而反向断言分不出"键位真的没绑上"与
         * "合成按键被丢掉"——两种都是"什么都没动"。所以它只能当补充读数，
         * 判据④的正向承重是**下一句**：自定义键能起作用。配置文件若没被读，
         * 注册的就是默认那两个键，自定义键必然不动 ⇒ 那一句才是会红的。
         */
        pressAccelerator(DEFAULT_SHOW_HIDE);
        await wait(1_500);
        const defaultStillInert = !(await mainVisible(app));
        console.log(`   · ④ 补充读数（反向，见上）：默认键按下去主窗仍藏着 = ${String(defaultStillInert)}`);
        expect(await mainVisible(app), '改了键位之后默认键还在起作用 ⇒ 配置文件没被读').toBe(false);

        await pressUntil(app, custom.showHide, () => mainVisible(app), true);
        await main.screenshot({ path: shot('7-custom-key') });

        // 自定义的快速添加键也认（这一句与上面那句合起来 = 两份键位都从文件里来）。
        await pressUntil(
          app,
          custom.quickAdd,
          () => winOf(app, '快速添加').then((w) => w?.visible ?? false),
          true,
        );
        const panel = await pageOf(app, 'quick-add.html');
        await expect(panel.getByTestId('quick-add-root')).toBeVisible();
        /**
         * Esc 关掉面板。
         *
         * ⚠️ 这里**不能**等 `keyboard.press` 成功返回：处理函数里就调了
         * `window.close()`，窗口在按键送达的同一拍被销毁，Playwright 只会报
         * "Target page has been closed"。所以这条按键的结果要看**窗口没了没有**，
         * 而不是看那次调用有没有顺利回来。
         */
        await panel.keyboard.press('Escape').catch(() => undefined);
        await expect
          .poll(() => winOf(app, '快速添加').then((w) => w?.visible ?? false), { message: 'Esc 没能关掉面板' })
          .toBe(false);
      } finally {
        await app.close();
      }

      // ── 重启：换一个进程、读同一份 userData，键位必须还在 ──
      const again = await launchSummon({ userDataDir: dir });
      try {
        const main = await pageOf(again, 'index.html');
        await wait(1_500);
        expect(await mainVisible(again), '重启后起点：主窗应当可见').toBe(true);
        await pressUntil(
          again,
          custom.showHide,
          () => mainVisible(again),
          false,
        );
      } finally {
        await again.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('托盘：菜单栏里真的有一枚图标（截图为证）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heyta-r6-tray-'));
    const app = await launchSummon({ userDataDir: dir });
    try {
      await pageOf(app, 'index.html');
      await wait(2_000);

      // 菜单栏的尺寸从**应用自己**读，不抄一个数：有刘海的机器上那一行不止 24 像素。
      const bar = await app.evaluate(({ screen }) => {
        const display = screen.getPrimaryDisplay();
        return {
          y: display.bounds.y,
          width: display.bounds.width,
          // 菜单栏那一行的高度 = 工作区顶边到屏幕上边的距离。
          height: display.workArea.y - display.bounds.y + 8,
        };
      });
      /**
       * 🔴 裁多宽是有实测的：新状态项插在**第三方图标的最左边**，
       * 本机实测一枚图标把整簇往右推了一格 ⇒ 只裁右上角 620 点时
       * heyta 那枚**落在裁切区外面**（第一版就是这么"截到了菜单栏却没截到图标"）。
       * 1000 点是本机现量（1728 宽、约 11 枚图标 + 时钟）够包住整簇的取整值；
       * 仍然只裁顶部那一条，不拍用户窗口内容。
       */
      const cropWidth = 1000;
      const right = Math.max(0, bar.width - cropWidth);
      const out = shot('8-menu-bar-tray');
      ensureShotDir();
      if (existsSync(out)) rmSync(out);
      const run = spawnSync('screencapture', ['-x', '-R', `${String(right)},${String(bar.y)},${String(cropWidth)},${String(bar.height)}`, out], {
        encoding: 'utf8',
      });
      expect(run.status, `screencapture 退 ${String(run.status)}：${run.stderr}`).toBe(0);
      expect(existsSync(out), `截图没落盘：${out}`).toBe(true);
      console.log(`📷 菜单栏截图（只裁右上角，不含用户内容）：${out}`);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('托盘「今天」的落点：界面切到今天那一档，判据来自共享筛选', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heyta-r6-today-'));
    const logs: string[] = [];
    const app = await launchSummon({ userDataDir: dir });
    const stamp = String(Date.now());
    const todayTitle = `R6 今天到期 ${stamp}`;
    const inboxTitle = `R6 无到期日 ${stamp}`;
    try {
      const main = await pageOf(app, 'index.html');
      attachLogs(main, logs);
      ensureShotDir();
      await wait(1_500);

      /**
       * 夹具用**既有的契约参数**造数据（`addTask` 的 `over.dueDate`），
       * 产品路径没有为这条判据新增任何入口。
       * ⚠️ 截止日按本地日历日算，所以取"今天 12:00"而不是 `Date.now()`：
       *    深夜跑也不会滑到明天那一档去。
       */
      const noon = new Date();
      noon.setHours(12, 0, 0, 0);
      await makeTask(main, todayTitle, { dueDate: noon.getTime() });
      await makeTask(main, inboxTitle);

      /**
       * 「今天」由主进程推 `{kind:'showToday'}` 进来 —— 与托盘中那条点下去之后
       * 走的是**同一个命令**（映射表在 `summon-commands.ts`，由
       * `apps/desktop/tests/summon-commands.spec.ts` 逐条钉住）。
       * 🔴 这里没有替托盘"作弊"：被测的是**命令到界面**那一段；
       *    菜单到命令那一段由那张表 + 单测负责，两段拼起来才是整条路。
       */
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .filter((win) => win.getTitle() === 'heyta')
          .forEach((win) => win.webContents.send('heyta:shell:command', { kind: 'showToday' }));
      });

      const rows = main.locator('[data-testid^="task-row-"]');
      await expect(rows.filter({ hasText: todayTitle }), '今天那一档里没有今天到期的那条').toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(rows.filter({ hasText: inboxTitle }), '无到期日的任务不该出现在今天那一档').toHaveCount(0);
      // 🔴 用户要看得见自己在哪一档：这一行不在，「今天」就是一扇单向门。
      await expect(main.getByTestId('desktop-view-label')).toHaveText('当前视图：今天');
      await main.screenshot({ path: shot('9-today-view') });

      // 回得去：界面上「全部」那颗按钮必须能换回来（单向门不算做完）。
      await main.getByTestId('desktop-view-all').click();
      await expect(rows.filter({ hasText: inboxTitle })).toHaveCount(1, { timeout: 15_000 });
      await expect(main.getByTestId('desktop-view-label')).toHaveText('当前视图：全部');
      await main.screenshot({ path: shot('10-back-to-all') });
    } catch (failure) {
      console.error(`──── 控制台 / 页面错误 ────\n${logs.join('\n') || '（无输出 —— 那更可疑）'}`);
      throw failure;
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
